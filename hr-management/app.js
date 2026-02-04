(function () {
  'use strict';

  // 구글 스프레드시트 연동을 위한 데이터 구조
  // 각 인력 정보는 객체로 저장되며, 스프레드시트의 행(row)에 대응됩니다
  const STORAGE_KEY = 'hr-management-data';
  
  // DOM 요소
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const addBtn = document.getElementById('add-btn');
  const tableBody = document.getElementById('table-body');
  const modal = document.getElementById('modal');
  const closeModalBtn = document.getElementById('close-modal');
  const cancelBtn = document.getElementById('cancel-btn');
  const hrForm = document.getElementById('hr-form');
  const modalTitle = document.getElementById('modal-title');
  const totalCountEl = document.getElementById('total-count');
  const activeCountEl = document.getElementById('active-count');
  const birthY = document.getElementById('birthdate-y');
  const birthM = document.getElementById('birthdate-m');
  const birthD = document.getElementById('birthdate-d');
  const acqY = document.getElementById('acquisition-y');
  const acqM = document.getElementById('acquisition-m');
  const acqD = document.getElementById('acquisition-d');
  const lossY = document.getElementById('loss-y');
  const lossM = document.getElementById('loss-m');
  const lossD = document.getElementById('loss-d');
  const excelInput = document.getElementById('excel-input');
  const excelUploadBtn = document.getElementById('excel-upload-btn');
  const legacyExcelInput = document.getElementById('legacy-excel-input');
  const legacyExcelBtn = document.getElementById('legacy-excel-btn');
  const statusAll = document.getElementById('status-all');
  const statusEmployed = document.getElementById('status-employed');
  const statusRetired = document.getElementById('status-retired');
  const companySubButtons = document.getElementById('company-sub-buttons');
  const pityYear = document.getElementById('pity-year');
  const pityMonth = document.getElementById('pity-month');
  const pityQueryBtn = document.getElementById('pity-query-btn');
  const pitySummaryCard = document.getElementById('pity-summary-card');
  const pitySummaryText = document.getElementById('pity-summary-text');
  const filterResetBtn = document.getElementById('filter-reset-btn');

  const UI_STATE_KEY = 'hr-management-ui-state';

  let hrData = loadData();
  let editingId = null;
  let filteredData = [...hrData];
  let statusFilter = '전체';
  let companyFilter = null;
  let pointInTimeResult = null;

  // 데이터 로드 (로컬스토리지 또는 구글 스프레드시트에서)
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('데이터 로드 실패:', e);
      return [];
    }
  }

  // 데이터 저장 (로컬스토리지 또는 구글 스프레드시트로)
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hrData));
      saveUIState();
      // TODO: 구글 스프레드시트 연동 시 여기에 API 호출 추가
      updateStats();
    } catch (e) {
      console.error('데이터 저장 실패:', e);
    }
  }

  // UI 상태 저장 (필터·통계 조회 상태)
  function saveUIState() {
    try {
      var yearEl = document.getElementById('pity-year');
      var monthEl = document.getElementById('pity-month');
      var state = {
        statusFilter: statusFilter,
        companyFilter: companyFilter,
        searchQuery: searchInput ? searchInput.value.trim() : '',
        statsYear: yearEl ? yearEl.value : '',
        statsMonth: monthEl ? monthEl.value : '',
        hasPointInTime: !!pointInTimeResult
      };
      if (pointInTimeResult) {
        state.refDateStr = pointInTimeResult.refDateStr;
        state.label = pointInTimeResult.label;
        state.mode = pointInTimeResult.mode; // 'cumulative' | 'monthly'
      }
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('UI 상태 저장 실패:', e);
    }
  }

  // UI 상태 복원
  function loadUIState() {
    try {
      var raw = localStorage.getItem(UI_STATE_KEY);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (state.statusFilter) statusFilter = state.statusFilter;
      if (state.companyFilter !== undefined) companyFilter = state.companyFilter;
      if (state.searchQuery !== undefined && searchInput) searchInput.value = state.searchQuery;
      var yearEl = document.getElementById('pity-year');
      var monthEl = document.getElementById('pity-month');
      if (yearEl && state.statsYear) yearEl.value = state.statsYear;
      if (monthEl && state.statsMonth !== undefined) monthEl.value = state.statsMonth;
      if (state.hasPointInTime && state.refDateStr && state.label) {
        var refDateStr = state.refDateStr;
        var mode = state.mode || 'cumulative';
        var list;
        if (mode === 'monthly' && state.statsYear && state.statsMonth) {
          list = getMonthlyFilterList(parseInt(state.statsYear, 10), parseInt(state.statsMonth, 10));
        } else {
          list = hrData.filter(function (item) { return isEmployedAtRef(item, refDateStr); });
        }
        pointInTimeResult = { refDateStr: refDateStr, label: state.label, list: list, mode: mode };
        if (pitySummaryCard) pitySummaryCard.hidden = false;
      }
    } catch (e) {
      console.error('UI 상태 복원 실패:', e);
    }
  }

  // 구글 스프레드시트 연동을 위한 데이터 구조 변환
  // 스프레드시트의 행 배열로 변환 (헤더 제외)
  function convertToSheetRows(data) {
    return data.map(item => [
      item.no,
      item.division,
      item.name,
      item.department,
      item.birthdate,
      item.ssn,
      item.gender,
      item.acquisitionDate,
      item.lossDate || '',
      item.age
    ]);
  }

  // 스프레드시트 행 배열을 객체 배열로 변환
  function convertFromSheetRows(rows) {
    return rows.map((row, index) => ({
      id: `hr-${Date.now()}-${index}`,
      no: index + 1,
      division: row[1] || '',
      name: row[2] || '',
      department: row[3] || '',
      birthdate: row[4] || '',
      ssn: row[5] || '',
      gender: row[6] || '',
      acquisitionDate: row[7] || '',
      lossDate: row[8] || '',
      age: calculateAge(row[4])
    }));
  }

  // 생년월일로부터 만나이 계산
  function calculateAge(birthdate) {
    if (!birthdate) return '';
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  // 주민등록번호 포맷팅
  function formatSSN(ssn) {
    if (!ssn) return '';
    const cleaned = ssn.replace(/[^0-9]/g, '');
    if (cleaned.length === 13) {
      return cleaned.substring(0, 6) + '-' + cleaned.substring(6);
    }
    return ssn;
  }

  function getGenderFromSSN(ssn) {
    if (!ssn) return '';
    const cleaned = ssn.replace(/[^0-9]/g, '');
    if (cleaned.length < 7) return '';
    const code = cleaned.charAt(6);
    if (code === '1' || code === '3' || code === '5') return '남';
    if (code === '2' || code === '4' || code === '6') return '여';
    return '';
  }

  // 엑셀 날짜 값을 YYYY-MM-DD 문자열로 변환 (Excel 시리얼, Date, 문자열 지원)
  function normalizeExcelDate(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number') {
      // Excel 시리얼: 1900-01-01 기준 일수 (1970-01-01 = 25569)
      const date = new Date((val - 25569) * 86400 * 1000);
      if (Number.isNaN(date.getTime())) return null;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    if (val instanceof Date) {
      if (Number.isNaN(val.getTime())) return null;
      return val.toISOString().slice(0, 10);
    }
    const str = String(val).trim().replace(/[./]/g, '-');
    if (!str) return null;
    const match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      let y, m, d;
      if (match[1].length === 4) {
        y = match[1];
        m = match[2].padStart(2, '0');
        d = match[3].padStart(2, '0');
      } else {
        y = match[3];
        m = match[1].padStart(2, '0');
        d = match[2].padStart(2, '0');
      }
      return y + '-' + m + '-' + d;
    }
    return null;
  }

  // 셀 문자열이 키워드 중 하나를 포함하는지 확인 (공백 무시, 대소문자 무시)
  function cellMatchesKeyword(cell, keywords) {
    const normalized = String(cell != null ? cell : '').trim().replace(/\s+/g, '').toLowerCase();
    if (!normalized) return false;
    return keywords.some(function (k) {
      const kw = k.replace(/\s+/g, '').toLowerCase();
      return kw && normalized.indexOf(kw) !== -1;
    });
  }

  // 한 행에서 키워드 중 하나라도 포함된 셀이 있는 열 인덱스 찾기 (유연 매칭)
  function findColumnIndexInRow(row, keywords) {
    const len = Array.isArray(row) ? row.length : 0;
    for (let c = 0; c < len; c++) {
      if (cellMatchesKeyword(row[c], keywords)) return c;
    }
    return -1;
  }

  // 시트 전체 스캔: '성명'(또는 '이름'), '자격취득일'(또는 '취득일'), '자격상실일'(또는 '상실일')이
  // 같은 행에 있으면 그 행을 헤더로 사용. 없으면 서로 다른 행에 있어도 각 키워드가 나온 첫 위치를 모아 사용.
  function findHeaderRow(rows) {
    const nameKeywords = ['성명', '이름', 'name'];
    const acqKeywords = ['자격취득일', '취득일', '입사일'];
    const lossKeywords = ['자격상실일', '상실일', '퇴사일'];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      const nameCol = findColumnIndexInRow(row, nameKeywords);
      const acqCol = findColumnIndexInRow(row, acqKeywords);
      const lossCol = findColumnIndexInRow(row, lossKeywords);
      if (nameCol >= 0 && acqCol >= 0 && lossCol >= 0) {
        return { headerRowIndex: r, nameCol: nameCol, acqCol: acqCol, lossCol: lossCol };
      }
    }

    var nameFound = { row: -1, col: -1 };
    var acqFound = { row: -1, col: -1 };
    var lossFound = { row: -1, col: -1 };
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (nameFound.row < 0 && cellMatchesKeyword(cell, nameKeywords)) { nameFound = { row: r, col: c }; }
        if (acqFound.row < 0 && cellMatchesKeyword(cell, acqKeywords)) { acqFound = { row: r, col: c }; }
        if (lossFound.row < 0 && cellMatchesKeyword(cell, lossKeywords)) { lossFound = { row: r, col: c }; }
      }
    }
    if (nameFound.row < 0 || acqFound.row < 0 || lossFound.row < 0) return null;
    var headerRowIndex = Math.max(nameFound.row, acqFound.row, lossFound.row);
    return {
      headerRowIndex: headerRowIndex,
      nameCol: nameFound.col,
      acqCol: acqFound.col,
      lossCol: lossFound.col
    };
  }

  // 엑셀 파일 전체 스캔 후 키워드 행을 헤더로 인식해 성명·자격취득일·자격상실일 데이터만 추출
  function parseExcelFile(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === 'undefined') {
        reject(new Error('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheet = workbook.SheetNames[0];
          if (!firstSheet) {
            resolve([]);
            return;
          }
          const sheet = workbook.Sheets[firstSheet];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!rows.length) {
            resolve([]);
            return;
          }
          const headerInfo = findHeaderRow(rows);
          if (!headerInfo) {
            reject(new Error('엑셀에서 "성명"(또는 "이름"), "자격취득일"(또는 "취득일"), "자격상실일"(또는 "상실일")을 찾을 수 없습니다. 같은 행에 있거나 서로 다른 행에 있어도 됩니다. 셀 안 공백(예: 자격상실 일)은 무시됩니다.'));
            return;
          }
          const headerRowIndex = headerInfo.headerRowIndex;
          const nameCol = headerInfo.nameCol;
          const acqCol = headerInfo.acqCol;
          const lossCol = headerInfo.lossCol;
          const result = [];
          for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            const name = String(row[nameCol] != null ? row[nameCol] : '').trim();
            if (!name) continue;
            result.push({
              name: name,
              acquisitionDate: normalizeExcelDate(row[acqCol]),
              lossDate: normalizeExcelDate(row[lossCol])
            });
          }
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  // 엑셀 데이터와 기존 데이터 비교: 있으면 변경분만 업데이트, 없으면 새 인력으로 추가
  function applyExcelUpdate(rows) {
    let updated = 0;
    let skipped = 0;
    let added = 0;
    rows.forEach(function (row) {
      const existing = hrData.find(function (item) {
        return item.name && item.name.trim() === row.name;
      });
      if (!existing) {
        var newItem = {
          id: 'hr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          no: hrData.length + 1,
          division: '',
          name: row.name,
          department: '',
          birthdate: null,
          ssn: '',
          gender: '',
          acquisitionDate: row.acquisitionDate || null,
          lossDate: row.lossDate || null,
          age: ''
        };
        hrData.push(newItem);
        added++;
        return;
      }
      const newAcq = row.acquisitionDate || null;
      const newLoss = row.lossDate || null;
      const curAcq = existing.acquisitionDate || null;
      const curLoss = existing.lossDate || null;
      const acqChanged = newAcq !== curAcq;
      const lossChanged = newLoss !== curLoss;
      if (!acqChanged && !lossChanged) {
        skipped++;
        return;
      }
      if (acqChanged) existing.acquisitionDate = newAcq;
      if (lossChanged) existing.lossDate = newLoss;
      updated++;
    });
    if (updated > 0 || added > 0) {
      hrData.forEach(function (item, index) { item.no = index + 1; });
      saveData();
    }
    return { updated: updated, skipped: skipped, added: added, total: rows.length };
  }

  // 날짜 포맷팅 (YYYY-MM-DD -> YYYY.MM.DD)
  function formatDate(dateString) {
    if (!dateString) return '';
    return dateString.replace(/-/g, '.');
  }

  function pad2(v) {
    return String(v || '').padStart(2, '0');
  }

  function buildDateString(y, m, d) {
    const yy = String(y || '').trim();
    const mm = String(m || '').trim();
    const dd = String(d || '').trim();

    if (!yy && !mm && !dd) return null;
    if (yy.length !== 4 || mm.length !== 2 || dd.length !== 2) return null;

    const iso = `${yy}-${mm}-${dd}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;

    // new Date가 2025-02-31 같은 값을 보정할 수 있어, 원문과 일치하는지 확인
    const actual = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    if (actual !== iso) return null;

    return iso;
  }

  function setDateParts(prefix, isoDate) {
    const yEl = document.getElementById(`${prefix}-y`);
    const mEl = document.getElementById(`${prefix}-m`);
    const dEl = document.getElementById(`${prefix}-d`);
    if (!yEl || !mEl || !dEl) return;

    if (!isoDate) {
      yEl.value = '';
      mEl.value = '';
      dEl.value = '';
      return;
    }

    const [y, m, d] = String(isoDate).split('-');
    yEl.value = y || '';
    mEl.value = m || '';
    dEl.value = d || '';
  }

  function attachNumericAutoMove(inputs) {
    inputs.forEach((el, idx) => {
      if (!el) return;

      el.addEventListener('input', () => {
        const max = Number(el.getAttribute('maxlength') || '0');
        const digitsOnly = el.value.replace(/[^0-9]/g, '');
        el.value = max ? digitsOnly.slice(0, max) : digitsOnly;

        if (max && el.value.length === max) {
          const next = inputs[idx + 1];
          if (next) next.focus();
        }
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && el.value.length === 0) {
          const prev = inputs[idx - 1];
          if (prev) prev.focus();
        }
      });
    });
  }

  // 통계 업데이트
  function updateStats() {
    const total = hrData.length;
    const active = hrData.filter(item => !item.lossDate).length;
    totalCountEl.textContent = total;
    activeCountEl.textContent = active;
  }

  // 테이블 렌더링
  function renderTable(data = filteredData) {
    tableBody.innerHTML = '';
    
    if (data.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="13" class="empty-state">
          <p>등록된 인력 정보가 없습니다.</p>
        </td>
      `;
      tableBody.appendChild(tr);
      return;
    }

    data.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.no}</td>
        <td>${item.division}</td>
        <td>${item.lossDate ? '퇴직' : '재직'}</td>
        <td>${item.name}</td>
        <td>${item.department}</td>
        <td>${formatDate(item.birthdate)}</td>
        <td>${formatSSN(item.ssn)}</td>
        <td>${item.gender}</td>
        <td>${formatDate(item.acquisitionDate)}</td>
        <td>${item.lossDate ? formatDate(item.lossDate) : '-'}</td>
        <td>${item.age}세</td>
        <td>${item.remark ? item.remark : '-'}</td>
        <td>
          <div class="action-buttons">
            <button type="button" class="btn-edit" data-id="${item.id}" title="수정"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button type="button" class="btn-delete" data-id="${item.id}" title="삭제"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    // 이벤트 리스너 추가
    tableBody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        editItem(id);
      });
    });

    tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        deleteItem(id);
      });
    });
  }

  // 자격상실일 비어있음 여부 (null, '', 공백만 구분)
  function hasLossDate(item) {
    var v = item.lossDate;
    return v != null && String(v).trim() !== '';
  }

  // 기준일(refDateStr, YYYY-MM-DD) 시점에 재직인지: 자격취득일 <= 기준일 이고 (자격상실일 없음 OR 자격상실일 > 기준일)
  function isEmployedAtRef(item, refDateStr) {
    var acq = item.acquisitionDate;
    if (acq == null || String(acq).trim() === '') return false;
    if (String(acq).trim() > refDateStr) return false;
    if (!hasLossDate(item)) return true;
    return String(item.lossDate).trim() > refDateStr;
  }

  // 기준일(refDateStr) 시점에 이미 퇴직한 사람: 자격취득일 <= 기준일 이고 자격상실일 있음 이고 자격상실일 <= 기준일
  function isRetiredAtRef(item, refDateStr) {
    var acq = item.acquisitionDate;
    if (acq == null || String(acq).trim() === '') return false;
    if (String(acq).trim() > refDateStr) return false;
    if (!hasLossDate(item)) return false;
    return String(item.lossDate).trim() <= refDateStr;
  }

  // 해당 연·월에 입사(취득일) 또는 퇴사(상실일)한 인원 목록 (실시간 계산)
  function getMonthlyFilterList(year, month) {
    if (!year || !month) return [];
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    if (isNaN(y) || isNaN(m)) return [];
    var prefix = y + '-' + pad2(m) + '-';
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      var loss = item.lossDate;
      var joinedInMonth = acq && String(acq).substring(0, 7) === (y + '-' + pad2(m));
      var leftInMonth = loss && String(loss).substring(0, 7) === (y + '-' + pad2(m));
      return joinedInMonth || leftInMonth;
    });
  }

  // 해당 연도 12월 31일 기준 누적 입사자 수 (자격취득일 <= 12/31)
  function getCumulativeJoinedByEndOfYear(year) {
    var refStr = year + '-12-31';
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      return acq && String(acq).trim() <= refStr;
    }).length;
  }

  // 해당 연도 12월 31일 기준 누적 퇴사자 수 (자격상실일 <= 12/31)
  function getCumulativeLeftByEndOfYear(year) {
    var refStr = year + '-12-31';
    return hrData.filter(function (item) {
      var loss = item.lossDate;
      return loss && String(loss).trim() <= refStr;
    }).length;
  }

  // 해당 연·월 입사자 수 (취득일 기준)
  function getJoinedInMonth(year, month) {
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    if (isNaN(y) || isNaN(m)) return 0;
    var ym = y + '-' + pad2(m);
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      return acq && String(acq).substring(0, 7) === ym;
    }).length;
  }

  // 해당 연·월 퇴사자 수 (상실일 기준)
  function getLeftInMonth(year, month) {
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    if (isNaN(y) || isNaN(m)) return 0;
    var ym = y + '-' + pad2(m);
    return hrData.filter(function (item) {
      var loss = item.lossDate;
      return loss && String(loss).substring(0, 7) === ym;
    }).length;
  }

  // 말일자 계산 (년, 월 1-based) -> YYYY-MM-DD
  function getLastDayOfMonth(year, month) {
    var d = new Date(year, month, 0);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // 필터 적용: 검색어 + 현황(전체/재직/퇴직) + 회사 + (말일자 기준 결과 있으면 해당 연월 기준으로 재직/퇴직 구분)
  function applyFilters() {
    var baseList;
    if (pointInTimeResult) {
      if (pointInTimeResult.mode === 'monthly') {
        baseList = pointInTimeResult.list.slice();
      } else {
        var refStr = pointInTimeResult.refDateStr;
        if (statusFilter === '재직') baseList = pointInTimeResult.list;
        else if (statusFilter === '퇴직') baseList = hrData.filter(function (item) { return isRetiredAtRef(item, refStr); });
        else baseList = pointInTimeResult.list.concat(hrData.filter(function (item) { return isRetiredAtRef(item, refStr); }));
      }
    } else {
      baseList = hrData.slice();
      if (statusFilter === '재직') baseList = baseList.filter(function (item) { return !hasLossDate(item); });
      else if (statusFilter === '퇴직') baseList = baseList.filter(function (item) { return hasLossDate(item); });
    }
    var list = baseList.slice();

    var query = searchInput.value.trim().toLowerCase();
    if (query) {
      list = list.filter(function (item) {
        return (item.name && item.name.toLowerCase().includes(query)) ||
          (item.department && item.department.toLowerCase().includes(query)) ||
          (item.division && item.division.toLowerCase().includes(query));
      });
    }

    if (companyFilter) {
      list = list.filter(function (item) { return item.division === companyFilter; });
    }

    filteredData = list;
    filteredData.forEach(function (item, index) { item.no = index + 1; });
    renderTable();
    if (!pointInTimeResult) updateStats();
    updateFilterCounts();
    updatePitySummaryText();
    saveUIState();
  }

  // 현황·회사 버튼 옆 인원수 갱신 (연월 조회 시에는 해당 시점 기준 재직/퇴직 인원수)
  function updateFilterCounts() {
    var baseList = pointInTimeResult ? pointInTimeResult.list : hrData;
    var total, employed, retired, listByStatus;
    if (pointInTimeResult) {
      if (pointInTimeResult.mode === 'monthly') {
        total = pointInTimeResult.list.length;
        employed = pointInTimeResult.list.filter(function (item) { return !hasLossDate(item); }).length;
        retired = pointInTimeResult.list.filter(function (item) { return hasLossDate(item); }).length;
        listByStatus = statusFilter === '재직' ? pointInTimeResult.list.filter(function (item) { return !hasLossDate(item); }) : statusFilter === '퇴직' ? pointInTimeResult.list.filter(function (item) { return hasLossDate(item); }) : pointInTimeResult.list;
      } else {
        var refStr = pointInTimeResult.refDateStr;
        employed = pointInTimeResult.list.length;
        retired = hrData.filter(function (item) { return isRetiredAtRef(item, refStr); }).length;
        total = employed + retired;
        if (statusFilter === '재직') listByStatus = pointInTimeResult.list;
        else if (statusFilter === '퇴직') listByStatus = hrData.filter(function (item) { return isRetiredAtRef(item, refStr); });
        else listByStatus = pointInTimeResult.list.concat(hrData.filter(function (item) { return isRetiredAtRef(item, refStr); }));
      }
    } else {
      total = baseList.length;
      employed = baseList.filter(function (item) { return !hasLossDate(item); }).length;
      retired = baseList.filter(function (item) { return hasLossDate(item); }).length;
      listByStatus = statusFilter === '재직' ? baseList.filter(function (item) { return !hasLossDate(item); }) : statusFilter === '퇴직' ? baseList.filter(function (item) { return hasLossDate(item); }) : baseList;
    }
    setCountEl('count-all', total);
    setCountEl('count-employed', employed);
    setCountEl('count-retired', retired);
    var companies = ['식스티', '굿뉴스', '패리티'];
    companies.forEach(function (company) {
      var n = listByStatus.filter(function (item) { return item.division === company; }).length;
      setCountEl('count-company-' + company, n);
    });
  }

  // 통계 조회 시 요약 문구 갱신 (누적/월별 실시간 계산)
  function updatePitySummaryText() {
    if (!pitySummaryCard || !pitySummaryText || !pointInTimeResult) return;
    var label = pointInTimeResult.label;
    var companySuffix = companyFilter ? ' (' + companyFilter + ')' : '';
    if (pointInTimeResult.mode === 'monthly') {
      var y = document.getElementById('pity-year') ? document.getElementById('pity-year').value : '';
      var m = document.getElementById('pity-month') ? document.getElementById('pity-month').value : '';
      var joined = getJoinedInMonth(y, m);
      var left = getLeftInMonth(y, m);
      pitySummaryText.textContent = label + ' 입사 ' + joined + '명, 퇴사 ' + left + '명 (표시: ' + filteredData.length + '명)';
    } else {
      var yearStr = (pointInTimeResult.refDateStr || '').substring(0, 4);
      var cumJoined = getCumulativeJoinedByEndOfYear(yearStr);
      var cumLeft = getCumulativeLeftByEndOfYear(yearStr);
      var employed = pointInTimeResult.list.length;
      var retired = hrData.filter(function (item) { return isRetiredAtRef(item, pointInTimeResult.refDateStr); }).length;
      if (statusFilter === '재직') pitySummaryText.textContent = label + ' 기준 재직자' + companySuffix + ': ' + filteredData.length + '명 (누적 입사 ' + cumJoined + '명, 누적 퇴사 ' + cumLeft + '명)';
      else if (statusFilter === '퇴직') pitySummaryText.textContent = label + ' 기준 퇴직자' + companySuffix + ': ' + filteredData.length + '명 (누적 입사 ' + cumJoined + '명, 누적 퇴사 ' + cumLeft + '명)';
      else pitySummaryText.textContent = label + ' 기준: 재직 ' + employed + '명, 퇴직 ' + retired + '명 · 누적 입사 ' + cumJoined + '명, 누적 퇴사 ' + cumLeft + '명 (표시: ' + filteredData.length + '명)';
    }
  }

  function setCountEl(id, n) {
    var el = document.getElementById(id);
    if (el) el.textContent = '(' + n + ')';
  }

  function search() {
    applyFilters();
  }

  // 모달 열기
  function openModal(isEdit = false) {
    modal.classList.add('active');
    if (isEdit) {
      modalTitle.textContent = '인력 정보 수정';
    } else {
      modalTitle.textContent = '신규 인력 등록';
      hrForm.reset();
      setDateParts('birthdate', null);
      setDateParts('acquisition', null);
      setDateParts('loss', null);
      editingId = null;
    }
  }

  // 모달 닫기
  function closeModal() {
    modal.classList.remove('active');
    hrForm.reset();
    setDateParts('birthdate', null);
    setDateParts('acquisition', null);
    setDateParts('loss', null);
    editingId = null;
  }

  // 신규 인력 추가
  function addItem(formData) {
    const newItem = {
      id: `hr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      no: hrData.length + 1,
      division: formData.division,
      name: formData.name,
      department: formData.department,
      birthdate: formData.birthdate,
      ssn: formatSSN(formData.ssn),
      gender: getGenderFromSSN(formData.ssn),
      acquisitionDate: formData.acquisitionDate,
      lossDate: formData.lossDate || null,
      age: calculateAge(formData.birthdate)
    };

    hrData.push(newItem);
    saveData();
    search(); // 검색 결과도 업데이트
    closeModal();
  }

  // 인력 정보 수정
  function editItem(id) {
    const item = hrData.find(i => i.id === id);
    if (!item) return;

    editingId = id;
    document.getElementById('division').value = item.division;
    document.getElementById('name').value = item.name;
    document.getElementById('department').value = item.department;
    setDateParts('birthdate', item.birthdate);
    document.getElementById('ssn').value = item.ssn.replace(/-/g, '');
    document.getElementById('gender').value = item.gender || getGenderFromSSN(item.ssn);
    setDateParts('acquisition', item.acquisitionDate);
    setDateParts('loss', item.lossDate || null);
    
    openModal(true);
  }

  // 인력 정보 업데이트
  function updateItem(id, formData) {
    const item = hrData.find(i => i.id === id);
    if (!item) return;

    item.division = formData.division;
    item.name = formData.name;
    item.department = formData.department;
    item.birthdate = formData.birthdate;
    item.ssn = formatSSN(formData.ssn);
    item.gender = getGenderFromSSN(formData.ssn);
    item.acquisitionDate = formData.acquisitionDate;
    item.lossDate = formData.lossDate || null;
    item.age = calculateAge(formData.birthdate);

    saveData();
    search(); // 검색 결과도 업데이트
    closeModal();
  }

  // 인력 정보 삭제
  function deleteItem(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    hrData = hrData.filter(item => item.id !== id);
    
    // 번호 재정렬
    hrData.forEach((item, index) => {
      item.no = index + 1;
    });

    saveData();
    search(); // 검색 결과도 업데이트
  }

  // 폼 제출 처리
  hrForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const birthdate = buildDateString(birthY.value, birthM.value, birthD.value);
    const acquisitionDate = buildDateString(acqY.value, acqM.value, acqD.value);
    const lossDate = buildDateString(lossY.value, lossM.value, lossD.value);

    if (!birthdate) {
      alert('생년월일을 YYYY-MM-DD 형식으로 정확히 입력해 주세요.');
      birthY.focus();
      return;
    }

    if (!acquisitionDate) {
      alert('자격취득일을 YYYY-MM-DD 형식으로 정확히 입력해 주세요.');
      acqY.focus();
      return;
    }

    const formData = {
      division: document.getElementById('division').value,
      name: document.getElementById('name').value.trim(),
      department: document.getElementById('department').value.trim(),
      birthdate,
      ssn: document.getElementById('ssn').value,
      acquisitionDate,
      lossDate
    };

    if (editingId) {
      updateItem(editingId, formData);
    } else {
      addItem(formData);
    }
  });

  // 주민등록번호 자동 포맷팅
  document.getElementById('ssn').addEventListener('input', (e) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length > 6) {
      value = value.substring(0, 6) + '-' + value.substring(6, 13);
    }
    e.target.value = value;
    document.getElementById('gender').value = getGenderFromSSN(value);
  });

  // 날짜 입력: 숫자만 + 4자리/2자리/2자리 자동 포커스 이동
  attachNumericAutoMove([birthY, birthM, birthD]);
  attachNumericAutoMove([acqY, acqM, acqD]);
  attachNumericAutoMove([lossY, lossM, lossD]);

  // 이벤트 리스너
  searchBtn.addEventListener('click', search);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      search();
    }
  });

  addBtn.addEventListener('click', function () { openModal(false); });
  closeModalBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  excelUploadBtn.addEventListener('click', function () {
    if (excelInput) excelInput.click();
  });

  excelInput.addEventListener('change', function () {
    const file = excelInput.files && excelInput.files[0];
    if (!file) return;
    parseExcelFile(file)
      .then(function (rows) {
        if (rows.length === 0) {
          alert('엑셀에서 읽은 데이터가 없습니다. 성명, 자격취득일, 자격상실일 열이 있는지 확인해 주세요.');
          excelInput.value = '';
          return;
        }
        const result = applyExcelUpdate(rows);
        search();
        renderTable();
        var msg = '엑셀 업로드 완료\n';
        msg += '• 읽은 행: ' + result.total + '건\n';
        msg += '• 변경 반영: ' + result.updated + '건\n';
        msg += '• 변경 없음(스킵): ' + result.skipped + '건\n';
        msg += '• 새로 추가: ' + result.added + '건';
        alert(msg);
        excelInput.value = '';
      })
      .catch(function (err) {
        alert('엑셀 처리 중 오류가 발생했습니다.\n\n' + (err && err.message ? err.message : String(err)));
        excelInput.value = '';
      });
  });

  // 모달 외부 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // 현황 카드·하위 회사 버튼 UI 갱신
  function updateStatusCardsUI() {
    [statusAll, statusEmployed, statusRetired].forEach(function (el) {
      if (!el) return;
      var status = el.getAttribute('data-status');
      el.classList.toggle('active', status === statusFilter);
    });
    if (companySubButtons) {
      if (statusFilter === '전체') {
        companySubButtons.classList.remove('visible');
        companySubButtons.setAttribute('aria-hidden', 'true');
      } else {
        companySubButtons.classList.add('visible');
        companySubButtons.setAttribute('aria-hidden', 'false');
      }
    }
    var companyBtns = companySubButtons ? companySubButtons.querySelectorAll('.company-btn') : [];
    companyBtns.forEach(function (btn) {
      var company = btn.getAttribute('data-company');
      btn.classList.toggle('active', company === companyFilter);
    });
  }

  // 연·월 셀렉트 초기화 (월 '전체' 옵션 포함)
  function initPointInTimeSelects() {
    var y = new Date().getFullYear();
    var i;
    if (pityYear) {
      pityYear.innerHTML = '';
      for (i = y - 15; i <= y + 1; i++) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i + '년';
        if (i === y) opt.selected = true;
        pityYear.appendChild(opt);
      }
    }
    if (pityMonth) {
      pityMonth.innerHTML = '';
      var optAll = document.createElement('option');
      optAll.value = '';
      optAll.textContent = '전체';
      pityMonth.appendChild(optAll);
      for (i = 1; i <= 12; i++) {
        var optM = document.createElement('option');
        optM.value = i;
        optM.textContent = i + '월';
        if (i === new Date().getMonth() + 1) optM.selected = true;
        pityMonth.appendChild(optM);
      }
    }
  }

  if (statusAll) statusAll.addEventListener('click', function () {
    statusFilter = '전체';
    companyFilter = null;
    pointInTimeResult = null;
    if (pitySummaryCard) pitySummaryCard.hidden = true;
    applyFilters();
    updateStatusCardsUI();
  });
  if (statusEmployed) statusEmployed.addEventListener('click', function () {
    statusFilter = '재직';
    applyFilters();
    updateStatusCardsUI();
  });
  if (statusRetired) statusRetired.addEventListener('click', function () {
    statusFilter = '퇴직';
    applyFilters();
    updateStatusCardsUI();
  });
  if (companySubButtons) {
    companySubButtons.querySelectorAll('.company-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var company = btn.getAttribute('data-company');
        companyFilter = companyFilter === company ? null : company;
        applyFilters();
        updateStatusCardsUI();
      });
    });
  }

  if (filterResetBtn) {
    filterResetBtn.addEventListener('click', function () {
      pointInTimeResult = null;
      statusFilter = '전체';
      companyFilter = null;
      if (searchInput) searchInput.value = '';
      if (pitySummaryCard) pitySummaryCard.hidden = true;
      if (pityYear && pityMonth) {
        pityYear.value = new Date().getFullYear();
        pityMonth.value = '';
      }
      saveUIState();
      applyFilters();
      updateStatusCardsUI();
    });
  }

  if (pityQueryBtn && pityYear && pityMonth && pitySummaryCard && pitySummaryText) {
    pityQueryBtn.addEventListener('click', function () {
      var year = parseInt(pityYear.value, 10);
      var monthVal = pityMonth.value;
      var month = monthVal === '' ? 0 : parseInt(monthVal, 10);
      if (isNaN(year)) return;
      if (monthVal === '' || month === 0) {
        var refDateStr = year + '-12-31';
        var list = hrData.filter(function (item) { return isEmployedAtRef(item, refDateStr); });
        var label = year + '년 12월 31일 기준';
        pointInTimeResult = { refDateStr: refDateStr, label: label, list: list, mode: 'cumulative' };
      } else {
        var refDateStrM = getLastDayOfMonth(year, month);
        var listM = getMonthlyFilterList(year, month);
        var labelM = year + '년 ' + month + '월';
        pointInTimeResult = { refDateStr: refDateStrM, label: labelM, list: listM, mode: 'monthly' };
      }
      pitySummaryCard.hidden = false;
      saveUIState();
      applyFilters();
    });
  }

  initPointInTimeSelects();
  loadUIState();

  // 초기 렌더링 (applyFilters가 renderTable, updateStats, updateFilterCounts 호출)
  updateStatusCardsUI();
  applyFilters();

  // 구글 스프레드시트 연동을 위한 전역 함수 (나중에 사용)
  window.syncFromGoogleSheets = async function(rows) {
    hrData = convertFromSheetRows(rows);
    saveData();
    search();
    renderTable();
  };

  window.syncToGoogleSheets = function() {
    return convertToSheetRows(hrData);
  };

  // 기존 엑셀 업로드: 현재 목록과 동일한 형식의 엑셀을 읽어 목록 전체를 교체 (임시 기능)
  function findFullHeaderRow(rows) {
    var info = findHeaderRow(rows);
    if (!info) return null;
    var headerRow = rows[info.headerRowIndex];
    if (!headerRow || !Array.isArray(headerRow)) return info;
    info.divisionCol = findColumnIndexInRow(headerRow, ['회사']);
    info.departmentCol = findColumnIndexInRow(headerRow, ['소속']);
    info.birthdateCol = findColumnIndexInRow(headerRow, ['생년월일']);
    info.ssnCol = findColumnIndexInRow(headerRow, ['주민등록번호']);
    info.genderCol = findColumnIndexInRow(headerRow, ['성별']);
    info.remarkCol = findColumnIndexInRow(headerRow, ['비고']);
    return info;
  }

  function parseFullExcelFile(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === 'undefined') {
        reject(new Error('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          var workbook = XLSX.read(data, { type: 'array', cellDates: true });
          var firstSheet = workbook.SheetNames[0];
          if (!firstSheet) { resolve([]); return; }
          var sheet = workbook.Sheets[firstSheet];
          var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!rows.length) { resolve([]); return; }
          var headerInfo = findFullHeaderRow(rows);
          if (!headerInfo) {
            reject(new Error('엑셀에서 "성명"(또는 "이름"), "자격취득일", "자격상실일"이 포함된 행을 찾을 수 없습니다.'));
            return;
          }
          var r = headerInfo.headerRowIndex + 1;
          var result = [];
          var baseId = 'hr-' + Date.now();
          for (; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            var name = String(row[headerInfo.nameCol] != null ? row[headerInfo.nameCol] : '').trim();
            if (!name) continue;
            var birthdate = headerInfo.birthdateCol >= 0 ? normalizeExcelDate(row[headerInfo.birthdateCol]) : null;
            var item = {
              id: baseId + '-' + result.length,
              no: result.length + 1,
              division: headerInfo.divisionCol >= 0 ? String(row[headerInfo.divisionCol] != null ? row[headerInfo.divisionCol] : '').trim() : '',
              name: name,
              department: headerInfo.departmentCol >= 0 ? String(row[headerInfo.departmentCol] != null ? row[headerInfo.departmentCol] : '').trim() : '',
              birthdate: birthdate,
              ssn: headerInfo.ssnCol >= 0 ? formatSSN(String(row[headerInfo.ssnCol] != null ? row[headerInfo.ssnCol] : '')) : '',
              gender: headerInfo.genderCol >= 0 ? String(row[headerInfo.genderCol] != null ? row[headerInfo.genderCol] : '').trim() : '',
              acquisitionDate: normalizeExcelDate(row[headerInfo.acqCol]) || null,
              lossDate: normalizeExcelDate(row[headerInfo.lossCol]) || null,
              age: calculateAge(birthdate),
              remark: headerInfo.remarkCol >= 0 ? String(row[headerInfo.remarkCol] != null ? row[headerInfo.remarkCol] : '').trim() : ''
            };
            result.push(item);
          }
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  legacyExcelBtn.addEventListener('click', function () {
    if (legacyExcelInput) legacyExcelInput.click();
  });

  legacyExcelInput.addEventListener('change', function () {
    var file = legacyExcelInput.files && legacyExcelInput.files[0];
    if (!file) return;
    parseFullExcelFile(file)
      .then(function (items) {
        if (items.length === 0) {
          alert('엑셀에서 읽은 데이터가 없습니다. 현재 목록과 동일한 형식(성명, 자격취득일, 자격상실일 등)인지 확인해 주세요.');
          legacyExcelInput.value = '';
          return;
        }
        hrData = items;
        saveData();
        search();
        renderTable();
        alert('기존 엑셀 업로드 완료. 목록이 ' + items.length + '건으로 교체되었습니다.');
        legacyExcelInput.value = '';
      })
      .catch(function (err) {
        alert('엑셀 처리 중 오류가 발생했습니다.\n\n' + (err && err.message ? err.message : String(err)));
        legacyExcelInput.value = '';
      });
  });
})();

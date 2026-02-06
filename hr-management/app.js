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
  const deleteAllBtn = document.getElementById('delete-all-btn');
  const statusAll = document.getElementById('status-all');
  const statusEmployed = document.getElementById('status-employed');
  const statusRetired = document.getElementById('status-retired');
  const companySubButtons = document.getElementById('company-sub-buttons');
  const pityYear = document.getElementById('pity-year');
  const pityMonth = document.getElementById('pity-month');
  const pityQueryBtn = document.getElementById('pity-query-btn');
  const pitySummaryCard = document.getElementById('pity-summary-card');
  const pitySummaryText = document.getElementById('pity-summary-text');
  const pityClearBtn = document.getElementById('pity-clear-btn');
  const dualBtn = document.getElementById('dual-btn');
  const filterResetBtn = document.getElementById('filter-reset-btn');
  const statsYearEl = document.getElementById('stats-year');
  const statsMonthEl = document.getElementById('stats-month');
  const statsJoinedEl = document.getElementById('stats-joined');
  const statsLeftEl = document.getElementById('stats-left');
  const statsJoinedYearEl = document.getElementById('stats-joined-year');
  const statsLeftYearEl = document.getElementById('stats-left-year');
  const todayDateEl = document.getElementById('today-date');
  const periodQueryHintEl = document.getElementById('period-query-hint');
  const detailSidebar = document.getElementById('detail-sidebar');
  const detailSidebarBody = document.getElementById('detail-sidebar-body');
  const detailSidebarClose = document.getElementById('detail-sidebar-close');
  const thName = document.getElementById('th-name');
  const thAge = document.getElementById('th-age');
  const pageHr = document.getElementById('page-hr');
  const pagePayroll = document.getElementById('page-payroll');
  const navHr = document.getElementById('nav-hr');
  const navPayroll = document.getElementById('nav-payroll');

  const UI_STATE_KEY = 'hr-management-ui-state';

  // 라우팅: 해시(#/hr, #/payroll)에 따라 메인 영역 페이지 전환
  function getPageFromHash() {
    var h = (window.location.hash || '#/hr').replace(/^#\/?/, '');
    return h === 'payroll' ? 'payroll' : 'hr';
  }
  function renderRoute() {
    var page = getPageFromHash();
    if (pageHr) {
      pageHr.classList.toggle('active', page === 'hr');
      pageHr.hidden = page !== 'hr';
    }
    if (pagePayroll) {
      pagePayroll.classList.toggle('active', page === 'payroll');
      pagePayroll.hidden = page !== 'payroll';
    }
    if (navHr) navHr.classList.toggle('active', page === 'hr');
    if (navPayroll) navPayroll.classList.toggle('active', page === 'payroll');
  }
  window.addEventListener('hashchange', renderRoute);
  if (!window.location.hash || window.location.hash === '#') {
    window.location.hash = '#/hr';
  }
  renderRoute();

  let hrData = loadData();
  let editingId = null;
  let filteredData = [...hrData];
  let statusFilter = '재직';
  let companyFilter = null;
  let pointInTimeResult = null;
  let selectedRowId = null;
  // 어떤 섹션이 현재 테이블 필터의 주도권을 갖는지: 'section1' | 'section2' | 'section3'
  let activeFilterSection = 'section1';
  // 테이블 정렬 상태: null | 'name' | 'age'
  let tableSortKey = null;
  let tableSortDir = 'asc';
  // 섹션1 겸직 전용 모드 여부
  let dualMode = false;

  function getStartYear() {
    return 2020;
  }

  function formatTodayYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '. ' + m + '. ' + day;
  }

  function updateYearLabelUI() {
    if (!todayDateEl) return;
    var y = new Date().getFullYear();
    todayDateEl.textContent = y + ' 누적 현황';
  }

  function updateYearCumulativeUI() {
    var y = new Date().getFullYear();
    // 'YYYY 누적 현황' = 해당 연도 입/퇴사 건수
    if (statsJoinedYearEl) statsJoinedYearEl.textContent = String(getJoinedInYear(y));
    if (statsLeftYearEl) statsLeftYearEl.textContent = String(getLeftInYear(y));
    updateYearLabelUI();
  }

  function updatePeriodQueryHintUI(label) {
    if (!periodQueryHintEl) return;
    periodQueryHintEl.textContent = label || '조회 결과';
  }

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

  function deleteAllData() {
    hrData = [];
    filteredData = [];
    pointInTimeResult = null;
    selectedRowId = null;
    editingId = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(UI_STATE_KEY);
    } catch (e) {
      console.error('전체 삭제 실패:', e);
    }
    if (pitySummaryCard) pitySummaryCard.hidden = true;
    if (searchInput) searchInput.value = '';
    applyFilters();
    updateStatusCardsUI();
  }

  // UI 상태 저장 (필터·통계 조회 상태)
  function saveUIState() {
    try {
      var pityYearEl = document.getElementById('pity-year');
      var pityMonthEl = document.getElementById('pity-month');
      var state = {
        statusFilter: statusFilter,
        companyFilter: companyFilter,
        searchQuery: searchInput ? searchInput.value.trim() : '',
        statsYear: statsYearEl ? statsYearEl.value : '',
        statsMonth: statsMonthEl ? statsMonthEl.value : '',
        pityYear: pityYearEl ? pityYearEl.value : '',
        pityMonth: pityMonthEl ? pityMonthEl.value : '',
        hasPointInTime: !!pointInTimeResult
      };
      if (pointInTimeResult) {
        state.refDateStr = pointInTimeResult.refDateStr;
        state.label = pointInTimeResult.label;
        state.mode = pointInTimeResult.mode;
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
      if (statsYearEl && state.statsYear) statsYearEl.value = state.statsYear;
      if (statsMonthEl && state.statsMonth !== undefined) statsMonthEl.value = state.statsMonth;
      var pityYearEl = document.getElementById('pity-year');
      var pityMonthEl = document.getElementById('pity-month');
      if (pityYearEl && state.pityYear) pityYearEl.value = state.pityYear;
      if (pityMonthEl && state.pityMonth !== undefined) pityMonthEl.value = state.pityMonth;
      if (state.hasPointInTime && state.refDateStr && state.label) {
        var refDateStr = state.refDateStr;
        var mode = state.mode || 'cumulative';
        var list;
        if (mode === 'monthly' && state.pityYear && state.pityMonth) {
          list = getMonthlyFilterList(parseInt(state.pityYear, 10), parseInt(state.pityMonth, 10));
          pointInTimeResult = { refDateStr: refDateStr, label: state.label, list: list, mode: mode };
        } else if (mode === 'snapshot') {
          var employedList = hrData.filter(function (item) { return isEmployedAtRef(item, refDateStr); });
          var retiredList = hrData.filter(function (item) { return isRetiredAtRef(item, refDateStr); });
          pointInTimeResult = { refDateStr: refDateStr, label: state.label, list: employedList, employedList: employedList, retiredList: retiredList, mode: 'snapshot' };
        } else {
          list = hrData.filter(function (item) { return isEmployedAtRef(item, refDateStr); });
          pointInTimeResult = { refDateStr: refDateStr, label: state.label, list: list, mode: mode };
        }
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
    let birth;
    const s = String(birthdate);
    // YYYY-MM-DD 형식
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      birth = new Date(s);
    } else if (/^\d{8}$/.test(s)) {
      // YYYYMMDD
      const y = s.slice(0, 4);
      const m = s.slice(4, 6);
      const d = s.slice(6, 8);
      birth = new Date(y + '-' + m + '-' + d);
    } else if (/^\d{6}$/.test(s)) {
      // YYMMDD → 19xx 또는 20xx 추정 (단순 규칙: 00~29 → 2000~, 그 외 1900~)
      const yy = parseInt(s.slice(0, 2), 10);
      const year = yy <= 29 ? 2000 + yy : 1900 + yy;
      const m = s.slice(2, 4);
      const d = s.slice(4, 6);
      birth = new Date(year + '-' + m + '-' + d);
    } else {
      birth = new Date(birthdate);
    }
    if (Number.isNaN(birth.getTime())) return '';
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
      // Excel 시리얼: 1899-12-30 기준 일수 (1900-01-01 = 1, 1970-01-01 = 25569)
      // UTC 기준 + KST(+9h)로 변환해서 타임존/서머타임에 따른 하루 오차를 제거한다.
      var utcMillis = (val - 25569) * 86400 * 1000;
      var kstMillis = utcMillis + (9 * 60 * 60 * 1000);
      var date = new Date(kstMillis);
      if (Number.isNaN(date.getTime())) return null;
      var y = date.getUTCFullYear();
      var m = String(date.getUTCMonth() + 1).padStart(2, '0');
      var d = String(date.getUTCDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    if (val instanceof Date) {
      if (Number.isNaN(val.getTime())) return null;
      // Date 인스턴스도 KST(+9h) 기준으로 보정 후 UTC 기준으로 잘라 사용
      var kstDate = new Date(val.getTime() + (9 * 60 * 60 * 1000));
      var y2 = kstDate.getUTCFullYear();
      var m2 = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
      var d2 = String(kstDate.getUTCDate()).padStart(2, '0');
      return y2 + '-' + m2 + '-' + d2;
    }
    var str = String(val).trim();
    if (!str) return null;
    // 구분자를 통일
    var s = str.replace(/[.\s/]/g, '-');
    // YYYY-MM-DD 또는 MM-DD-YYYY
    var match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      var y3, m3, d3;
      if (match[1].length === 4) {
        y3 = match[1];
        m3 = match[2].padStart(2, '0');
        d3 = match[3].padStart(2, '0');
      } else {
        y3 = match[3];
        m3 = match[1].padStart(2, '0');
        d3 = match[2].padStart(2, '0');
      }
      return y3 + '-' + m3 + '-' + d3;
    }
    // 구분자가 전혀 없는 8자리(YYYYMMDD)도 지원
    var digits = s.replace(/[^0-9]/g, '');
    if (digits.length === 8) {
      var y4 = digits.slice(0, 4);
      var m4 = digits.slice(4, 6);
      var d4 = digits.slice(6, 8);
      return y4 + '-' + m4 + '-' + d4;
    }
    // 마지막 수단: 원본 문자열을 그대로 반환 (UI에서라도 볼 수 있도록)
    return str;
  }

  // 엑셀에서 읽은 핸드폰 번호를 010-xxxx-xxxx 형식의 문자열로 정리
  function normalizePhoneNumber(val) {
    if (val == null || val === '') return '';
    let s = String(val).trim();
    // 이미 하이픈이 포함되어 있으면 숫자만 정리 후 재포맷
    s = s.replace(/[^0-9]/g, '');
    if (!s) return '';
    // 앞자리 0 유지, 10~11자리 기준 처리
    if (s.length === 10) {
      return s.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    }
    if (s.length === 11) {
      return s.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    }
    // 그 외 길이는 원본 숫자 그대로 반환
    return s;
  }

  // 엑셀에서 읽은 생년월일을 문자열로 보존하면서 가능한 경우 날짜 형식으로도 쓸 수 있게 정리
  function normalizeBirthFromExcel(val) {
    if (val == null || val === '') return null;
    // 먼저 일반 날짜/시리얼 처리 시도
    var iso = normalizeExcelDate(val);
    if (iso) return iso;
    // 그렇지 않으면 숫자/문자열에서 6~8자리 숫자만 추출
    var s = typeof val === 'number' ? String(Math.floor(val)) : String(val);
    s = s.replace(/[^0-9]/g, '');
    if (!s) return null;
    if (s.length === 8) {
      // YYYYMMDD → YYYY-MM-DD
      return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    }
    if (s.length === 6) {
      // YYMMDD → YYYY-MM-DD (간단 추정 규칙 재사용)
      var yy = parseInt(s.slice(0, 2), 10);
      var year = yy <= 29 ? 2000 + yy : 1900 + yy;
      return year + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
    }
    return s;
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
          originalIndex: hrData.length,
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
        <td colspan="14" class="empty-state">
          <p>등록된 인력 정보가 없습니다.</p>
        </td>
      `;
      tableBody.appendChild(tr);
      return;
    }

    var rows = data.slice();

    // 정렬 우선 적용 (성명/만나이)
    if (tableSortKey && rows.length) {
      rows = rows.slice().sort(function (a, b) {
        var dir = tableSortDir === 'desc' ? -1 : 1;
        if (tableSortKey === 'name') {
          var an = (a.name || '').toString();
          var bn = (b.name || '').toString();
          var cmp = an.localeCompare(bn, 'ko', { sensitivity: 'base' });
          if (cmp !== 0) return cmp * dir;
        } else if (tableSortKey === 'age') {
          var aa = Number(a.age || 0);
          var ba = Number(b.age || 0);
          if (aa !== ba) return (aa < ba ? -1 : 1) * dir;
        }
        // tie-breaker: originalIndex 유지
        var ai = a.originalIndex != null ? a.originalIndex : 0;
        var bi = b.originalIndex != null ? b.originalIndex : 0;
        return (ai - bi) * dir;
      });
    } else if (rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'originalIndex')) {
      // 기본: 엑셀에서 읽은 원본 순서를 유지
      rows = rows.slice().sort(function (a, b) {
        var ai = a.originalIndex != null ? a.originalIndex : 0;
        var bi = b.originalIndex != null ? b.originalIndex : 0;
        return ai - bi;
      });
    }

    rows.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', item.id);
      if (selectedRowId === item.id) tr.classList.add('selected');
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${getDisplayStatus(item)}</td>
        <td>${item.name}</td>
        <td>${item.department}</td>
        <td>${formatDate(item.birthdate)}</td>
        <td>${item.gender}</td>
        <td>${formatDate(item.acquisitionDate)}</td>
        <td>${item.lossDate ? formatDate(item.lossDate) : '-'}</td>
        <td>${item.researcherId || '-'}</td>
        <td>${item.finalDegree || '-'}</td>
        <td class="cell-major" title="${item.major ? item.major : ''}">${item.major || '-'}</td>
        <td class="cell-remark">${item.remark ? item.remark : '-'}</td>
        <td><button type="button" class="btn-detail" data-id="${item.id}">상세</button></td>
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
    tableBody.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-id');
        const item = filteredData.find(function (i) { return i.id === id; }) || hrData.find(function (i) { return i.id === id; });
        if (item) openDetailSidebar(item);
      });
    });

    tableBody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        editItem(id);
      });
    });

    tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-id');
        deleteItem(id);
      });
    });

    tableBody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation());
    });

    tableBody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('.btn-edit') || e.target.closest('.btn-delete')) return;
        const id = tr.getAttribute('data-id');
        const item = filteredData.find(function (i) { return i.id === id; }) || hrData.find(function (i) { return i.id === id; });
        if (item) openDetailSidebar(item);
      });
    });
  }

  function setTableSort(key) {
    if (tableSortKey === key) {
      tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      tableSortKey = key;
      tableSortDir = 'asc';
    }

    // 헤더 정렬 표시 업데이트
    if (thName) {
      thName.classList.remove('sort-asc', 'sort-desc');
      if (tableSortKey === 'name') {
        thName.classList.add(tableSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    }
    if (thAge) {
      thAge.classList.remove('sort-asc', 'sort-desc');
      if (tableSortKey === 'age') {
        thAge.classList.add(tableSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    }

    renderTable();
  }

  function openDetailSidebar(item) {
    selectedRowId = item.id;
    tableBody.querySelectorAll('tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-id') === item.id);
    });
    if (detailSidebarBody) {
      detailSidebarBody.innerHTML = ''
        + '<div class="detail-row"><span class="detail-label">성명</span><span class="detail-value">' + (item.name || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">회사</span><span class="detail-value">' + (item.division || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">구분</span><span class="detail-value">' + getDisplayStatus(item) + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">소속</span><span class="detail-value">' + (item.department || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">생년월일</span><span class="detail-value">' + formatDate(item.birthdate) + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">주민등록번호</span><span class="detail-value">' + formatSSN(item.ssn) + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">성별</span><span class="detail-value">' + (item.gender || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">자격취득일</span><span class="detail-value">' + formatDate(item.acquisitionDate) + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">자격상실일</span><span class="detail-value">' + (item.lossDate ? formatDate(item.lossDate) : '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">만나이</span><span class="detail-value">' + (item.age !== undefined && item.age !== '' ? item.age + '세' : '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">핸드폰번호</span><span class="detail-value">' + (item.phoneNumber || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">연구자번호</span><span class="detail-value">' + (item.researcherId || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">최종학위</span><span class="detail-value">' + (item.finalDegree || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">학교</span><span class="detail-value">' + (item.school || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">학과</span><span class="detail-value">' + (item.major || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">학위번호</span><span class="detail-value">' + (item.degreeNumber || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">학위 수여일</span><span class="detail-value">' + (item.degreeAwardDate ? formatDate(item.degreeAwardDate) : '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">주소</span><span class="detail-value">' + (item.address || '-') + '</span></div>'
        + '<div class="detail-row"><span class="detail-label">비고</span><span class="detail-value">' + (item.remark || '-') + '</span></div>';
    }
    if (detailSidebar) {
      detailSidebar.classList.add('open');
      detailSidebar.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDetailSidebar() {
    selectedRowId = null;
    if (detailSidebar) {
      detailSidebar.classList.remove('open');
      detailSidebar.setAttribute('aria-hidden', 'true');
    }
    tableBody.querySelectorAll('tr.selected').forEach(function (tr) { tr.classList.remove('selected'); });
  }

  // 자격상실일 비어있음 여부 (null, '', 공백만 구분)
  function hasLossDate(item) {
    var v = item.lossDate;
    return v != null && String(v).trim() !== '';
  }

  // '겸직' 여부: 비고에 "겸직"이 포함된 경우
  function isDualEmployment(item) {
    var remark = item && item.remark ? String(item.remark) : '';
    return remark.indexOf('겸직') !== -1;
  }

  // 화면용 구분 텍스트: 기본은 재직/퇴직, '겸직'은 별도 표시
  function getDisplayStatus(item) {
    if (isDualEmployment(item)) return '겸직';
    return hasLossDate(item) ? '퇴직' : '재직';
  }

  // 기준일(refDateStr, YYYY-MM-DD) 시점에 재직인지: 자격취득일 <= 기준일 이고 (자격상실일 없음 OR 자격상실일 > 기준일)
  function isEmployedAtRef(item, refDateStr) {
    var acq = item.acquisitionDate;
    if (acq == null || String(acq).trim() === '') return false;
    var acqStr = String(acq).trim();
    if (acqStr > refDateStr) return false;

    // 겸직 인원은 자격취득일 이후에는 자격상실일과 상관 없이 항상 재직으로 간주
    if (isDualEmployment(item)) {
      return true;
    }

    // 일반 인원: 자격상실일이 없거나 기준일 이후인 경우만 재직
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

  // 해당 연도 입사자 수 (취득일이 YYYY- 로 시작)
  function getJoinedInYear(year) {
    var y = parseInt(year, 10);
    if (isNaN(y)) return 0;
    var prefix = String(y) + '-';
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      return acq && String(acq).trim().indexOf(prefix) === 0;
    }).length;
  }

  // 해당 연도 퇴사자 수 (상실일이 YYYY- 로 시작)
  function getLeftInYear(year) {
    var y = parseInt(year, 10);
    if (isNaN(y)) return 0;
    var prefix = String(y) + '-';
    return hrData.filter(function (item) {
      var loss = item.lossDate;
      return loss && String(loss).trim().indexOf(prefix) === 0;
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

  // 해당 연도 입/퇴사 이벤트가 있었던 인원 목록 (연도 전체)
  function getYearlyFilterList(year) {
    var y = parseInt(year, 10);
    if (isNaN(y)) return [];
    var yStr = String(y);
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      var loss = item.lossDate;
      var joinedInYear = acq && String(acq).substring(0, 4) === yStr;
      var leftInYear = loss && String(loss).substring(0, 4) === yStr;
      return joinedInYear || leftInYear;
    });
  }

  // 선택한 연도 기준 YTD(1월1일~해당 월 말) 입사/퇴사 수
  function getYtdJoined(year, month) {
    var y = parseInt(year, 10);
    var m = month == null || month === '' ? 12 : parseInt(month, 10);
    if (isNaN(y) || isNaN(m)) return 0;
    var end = getLastDayOfMonth(y, m);
    var start = y + '-01-01';
    return hrData.filter(function (item) {
      var acq = item.acquisitionDate;
      if (!acq) return false;
      var s = String(acq).trim();
      return s >= start && s <= end;
    }).length;
  }

  function getYtdLeft(year, month) {
    var y = parseInt(year, 10);
    var m = month == null || month === '' ? 12 : parseInt(month, 10);
    if (isNaN(y) || isNaN(m)) return 0;
    var end = getLastDayOfMonth(y, m);
    var start = y + '-01-01';
    return hrData.filter(function (item) {
      var loss = item.lossDate;
      if (!loss) return false;
      var s = String(loss).trim();
      return s >= start && s <= end;
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

  // 필터 적용: 검색어 + 현황(전체/재직/퇴직) + 회사 + (시점 조회 또는 중앙 연월 통계)
  function applyFilters() {
    // 상단 '올해 누적'은 기간별 조회(하단)와 무관하게 고정 표시
    updateYearCumulativeUI();

    var baseList;
    if (activeFilterSection === 'section3' && pointInTimeResult) {
      // 섹션3: 말일 스냅샷 기준 재직 명단
      baseList = (pointInTimeResult.employedList || pointInTimeResult.list || []).slice();
    } else if (activeFilterSection === 'section2') {
      // 섹션2: 선택된 연/월 기준 기간 필터
      var sy = statsYearEl ? statsYearEl.value : '';
      var sm = statsMonthEl ? statsMonthEl.value : '';
      if (sy) {
        if (sm === '' || sm === '0') {
          // 연도 전체(1~12월) 기간 조회: 해당 연도에 입/퇴사 이벤트가 있었던 인원만
          baseList = getYearlyFilterList(parseInt(sy, 10)).slice();
        } else {
          baseList = getMonthlyFilterList(parseInt(sy, 10), parseInt(sm, 10)).slice();
        }
      } else {
        baseList = hrData.slice();
      }
      // 상태 필터는 섹션1 기준으로 그대로 적용
      if (statusFilter === '재직') baseList = baseList.filter(function (item) { return !hasLossDate(item); });
      else if (statusFilter === '퇴직') baseList = baseList.filter(function (item) { return hasLossDate(item); });
    } else {
      // 기본: 섹션1이 주도권. 다른 섹션 필터는 무시하고 hrData + 상태/회사/겸직 필터만 적용
      if (dualMode) {
        // 겸직 모드: 겸직 인원만
        baseList = hrData.filter(function (item) { return isDualEmployment(item); });
      } else {
        // 일반 모드: 겸직은 제외하고 재직/퇴직/전체
        baseList = hrData.filter(function (item) { return !isDualEmployment(item); });
        if (statusFilter === '재직') baseList = baseList.filter(function (item) { return !hasLossDate(item); });
        else if (statusFilter === '퇴직') baseList = baseList.filter(function (item) { return hasLossDate(item); });
      }
    }
    var list = baseList.slice();

    var query = searchInput.value.trim().toLowerCase();
    if (query) {
      list = list.filter(function (item) {
        return (item.name && item.name.toLowerCase().includes(query)) ||
          (item.department && item.department.toLowerCase().includes(query)) ||
          (item.division && item.division.toLowerCase().includes(query)) ||
          (item.finalDegree && item.finalDegree.toLowerCase().includes(query));
      });
    }

    if (companyFilter) {
      list = list.filter(function (item) {
        var div = item && item.division ? String(item.division).trim() : '';
        return div === companyFilter;
      });
    }

    filteredData = list;
    renderTable();
    updateStatsBigNumbers();
    if (!pointInTimeResult) updateStats();
    updateFilterCounts();
    updatePitySummaryText();
    saveUIState();
  }

  // 중앙 영역 입사/퇴사 숫자 갱신 (실시간 계산)
  function updateStatsBigNumbers() {
    if (!statsJoinedEl || !statsLeftEl) return;
    var sy = statsYearEl ? statsYearEl.value : '';
    var sm = statsMonthEl ? statsMonthEl.value : '';
    if (!sy) {
      statsJoinedEl.textContent = '0';
      statsLeftEl.textContent = '0';
      updatePeriodQueryHintUI('조회 결과');
      return;
    }
    // 연도 전체(월=전체): 해당 연도 1~12월 누적(YTD)
    if (sm === '' || sm === '0') {
      statsJoinedEl.textContent = getYtdJoined(sy, '');
      statsLeftEl.textContent = getYtdLeft(sy, '');
      updatePeriodQueryHintUI(sy + '년 누적');
    } else {
      // 월 선택 시: 해당 월 한 달치 값만
      statsJoinedEl.textContent = getJoinedInMonth(sy, sm);
      statsLeftEl.textContent = getLeftInMonth(sy, sm);
      updatePeriodQueryHintUI(sy + '년 ' + sm + '월');
    }
  }

  // 현황·회사 버튼 옆 인원수 갱신
  // 섹션1 전용: 항상 전체 hrData 기준으로 재직/퇴직/회사별 인원수를 계산한다.
  function updateFilterCounts() {
    var baseList = hrData.slice();

    // 겸직 인원은 총 인원/재직/퇴직 카운트에서 제외
    var nonDual = baseList.filter(function (item) { return !isDualEmployment(item); });
    var dualOnly = baseList.filter(function (item) { return isDualEmployment(item); });

    var total = nonDual.length;
    var employed = nonDual.filter(function (item) { return !hasLossDate(item); }).length;
    var retired = nonDual.filter(function (item) { return hasLossDate(item); }).length;

    // 섹션1에서 실제로 보고 있는 리스트(상태 필터 반영, 겸직 제외)
    var listByStatus;
    if (statusFilter === '재직') {
      listByStatus = nonDual.filter(function (item) { return !hasLossDate(item); });
    } else if (statusFilter === '퇴직') {
      listByStatus = nonDual.filter(function (item) { return hasLossDate(item); });
    } else {
      listByStatus = nonDual;
    }
    setCountEl('count-all', total);
    setCountEl('count-employed', employed);
    setCountEl('count-retired', retired);

    var companies = ['식스티', '굿뉴스', '패리티'];
    companies.forEach(function (company) {
      var n = listByStatus.filter(function (item) {
        var div = item && item.division ? String(item.division).trim() : '';
        return div === company;
      }).length;
      setCountEl('count-company-' + company, n);
    });

    // 겸직 인원 수
    setCountEl('count-dual', dualOnly.length);
  }

  // 통계 조회 시 요약 문구 갱신
  function updatePitySummaryText() {
    if (!pitySummaryCard || !pitySummaryText || !pointInTimeResult) return;
    var label = pointInTimeResult.label;
    var companySuffix = companyFilter ? ' (' + companyFilter + ')' : '';
    if (pointInTimeResult.mode === 'snapshot') {
      var employed = (pointInTimeResult.employedList || pointInTimeResult.list || []).length;

      function byCompany(list) {
        var companies = ['식스티', '굿뉴스', '패리티'];
        var map = {};
        companies.forEach(function (c) { map[c] = 0; });
        (list || []).forEach(function (item) {
          var div = item && item.division ? String(item.division).trim() : '';
          if (map[div] !== undefined) map[div] += 1;
        });
        return map;
      }

      var eMap = byCompany(pointInTimeResult.employedList || pointInTimeResult.list || []);

      // 텍스트 위계: 기준(중간) / 재직·퇴직(가장 큼) / 회사별 상세(작고 옅게)
      pitySummaryText.innerHTML = ''
        + '<div class="pity-result-title">' + label + ' 기준</div>'
        + '<div class="pity-result-main">재직 : <strong>' + employed + '명</strong></div>'
        + '<div class="pity-result-sub">식스티: 재직 ' + eMap['식스티'] + '명</div>'
        + '<div class="pity-result-sub">굿뉴스: 재직 ' + eMap['굿뉴스'] + '명</div>'
        + '<div class="pity-result-sub">패리티: 재직 ' + eMap['패리티'] + '명</div>';
    } else if (pointInTimeResult.mode === 'headcount') {
      // (구버전 유지) 월말 기준 재직자 총원(=headcount)
      pitySummaryText.textContent = label + ' 기준 재직자' + companySuffix + ': ' + filteredData.length + '명';
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
      age: calculateAge(formData.birthdate),
      phoneNumber: formData.phoneNumber || '',
      researcherId: formData.researcherId || '',
      finalDegree: formData.finalDegree || '',
      school: formData.school || '',
      major: formData.major || '',
      degreeNumber: formData.degreeNumber || '',
      degreeAwardDate: formData.degreeAwardDate || '',
      address: formData.address || '',
      remark: formData.remark || ''
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
    var remarkEl = document.getElementById('remark');
    if (remarkEl) remarkEl.value = item.remark || '';
    var phoneEl = document.getElementById('phone-number');
    if (phoneEl) phoneEl.value = item.phoneNumber || '';
    var researcherEl = document.getElementById('researcher-id');
    if (researcherEl) researcherEl.value = item.researcherId || '';
    var degreeEl = document.getElementById('final-degree');
    if (degreeEl) degreeEl.value = item.finalDegree || '';
    var schoolEl = document.getElementById('school');
    if (schoolEl) schoolEl.value = item.school || '';
    var majorEl = document.getElementById('major');
    if (majorEl) majorEl.value = item.major || '';
    var degreeNoEl = document.getElementById('degree-no');
    if (degreeNoEl) degreeNoEl.value = item.degreeNumber || '';
    var degreeDateEl = document.getElementById('degree-award-date');
    if (degreeDateEl) degreeDateEl.value = item.degreeAwardDate || '';
    var addressEl = document.getElementById('address');
    if (addressEl) addressEl.value = item.address || '';
    
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
    item.phoneNumber = formData.phoneNumber || '';
    item.researcherId = formData.researcherId || '';
    item.finalDegree = formData.finalDegree || '';
    item.school = formData.school || '';
    item.major = formData.major || '';
    item.degreeNumber = formData.degreeNumber || '';
    item.degreeAwardDate = formData.degreeAwardDate || '';
    item.address = formData.address || '';
    item.remark = formData.remark || '';

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
      lossDate,
      phoneNumber: (document.getElementById('phone-number').value || '').trim(),
      researcherId: (document.getElementById('researcher-id').value || '').trim(),
      finalDegree: (document.getElementById('final-degree').value || '').trim(),
      school: (document.getElementById('school').value || '').trim(),
      major: (document.getElementById('major').value || '').trim(),
      degreeNumber: (document.getElementById('degree-no').value || '').trim(),
      degreeAwardDate: (document.getElementById('degree-award-date').value || '').trim(),
      address: (document.getElementById('address').value || '').trim(),
      remark: (document.getElementById('remark').value || '').trim()
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

  // 현황 카드·하위 회사 버튼 UI 갱신 (3분할 레이아웃에서는 회사 버튼 항상 표시)
  function updateStatusCardsUI() {
    [statusAll, statusEmployed, statusRetired].forEach(function (el) {
      if (!el) return;
      var status = el.getAttribute('data-status');
      el.classList.toggle('active', status === statusFilter);
    });
    if (companySubButtons) {
      companySubButtons.classList.add('visible');
      companySubButtons.setAttribute('aria-hidden', 'false');
    }
    var companyBtns = companySubButtons ? companySubButtons.querySelectorAll('.company-btn') : [];
    companyBtns.forEach(function (btn) {
      var company = btn.getAttribute('data-company');
      btn.classList.toggle('active', company === companyFilter);
    });
  }

  // 중앙 영역 연·월 셀렉트 초기화 (기본 올해, 월 전체)
  function initStatsSelects() {
    var y = new Date().getFullYear();
    var i;
    if (statsYearEl) {
      statsYearEl.innerHTML = '';
      for (i = getStartYear(); i <= y; i++) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i + '년';
        if (i === y) opt.selected = true;
        statsYearEl.appendChild(opt);
      }
    }
    if (statsMonthEl) {
      statsMonthEl.innerHTML = '';
      var optAll = document.createElement('option');
      optAll.value = '';
      optAll.textContent = '전체';
      statsMonthEl.appendChild(optAll);
      for (i = 1; i <= 12; i++) {
        var optM = document.createElement('option');
        optM.value = i;
        optM.textContent = i + '월';
        statsMonthEl.appendChild(optM);
      }
    }
  }

  // 연·월 셀렉트 초기화 (오른쪽 시점 조회용, 월 '전체' 옵션 포함)
  function initPointInTimeSelects() {
    var y = new Date().getFullYear();
    var i;
    if (pityYear) {
      pityYear.innerHTML = '';
      for (i = getStartYear(); i <= y; i++) {
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
    // 섹션1이 주도권을 가져가고, 다른 섹션 필터는 무시
    activeFilterSection = 'section1';
    dualMode = false;
    statusFilter = '전체';
    companyFilter = null;
    pointInTimeResult = null;
    if (pitySummaryCard) pitySummaryCard.hidden = true;
    applyFilters();
    updateStatusCardsUI();
  });
  if (statusEmployed) statusEmployed.addEventListener('click', function () {
    activeFilterSection = 'section1';
    statusFilter = '재직';
    dualMode = false;
    pointInTimeResult = null;
    if (pitySummaryCard) pitySummaryCard.hidden = true;
    applyFilters();
    updateStatusCardsUI();
  });
  if (statusRetired) statusRetired.addEventListener('click', function () {
    activeFilterSection = 'section1';
    statusFilter = '퇴직';
    dualMode = false;
    pointInTimeResult = null;
    if (pitySummaryCard) pitySummaryCard.hidden = true;
    applyFilters();
    updateStatusCardsUI();
  });
  if (companySubButtons) {
    companySubButtons.querySelectorAll('.company-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var company = btn.getAttribute('data-company');
        activeFilterSection = 'section1';
        companyFilter = companyFilter === company ? null : company;
        dualMode = false;
        pointInTimeResult = null;
        if (pitySummaryCard) pitySummaryCard.hidden = true;
        applyFilters();
        updateStatusCardsUI();
      });
    });
  }

  if (statsYearEl) {
    statsYearEl.addEventListener('change', function () {
      activeFilterSection = 'section2';
      pointInTimeResult = null;
      if (pitySummaryCard) pitySummaryCard.hidden = true;
      updateStatsBigNumbers();
      applyFilters();
    });
  }
  if (statsMonthEl) {
    statsMonthEl.addEventListener('change', function () {
      activeFilterSection = 'section2';
      pointInTimeResult = null;
      if (pitySummaryCard) pitySummaryCard.hidden = true;
      updateStatsBigNumbers();
      applyFilters();
    });
  }

  if (detailSidebarClose) {
    detailSidebarClose.addEventListener('click', closeDetailSidebar);
  }

  // 테이블 헤더 정렬(성명/만나이)
  if (thName) {
    thName.addEventListener('click', function () {
      setTableSort('name');
    });
  }
  if (thAge) {
    thAge.addEventListener('click', function () {
      setTableSort('age');
    });
  }

  if (filterResetBtn) {
    filterResetBtn.addEventListener('click', function () {
      pointInTimeResult = null;
      statusFilter = '전체';
      companyFilter = null;
      if (searchInput) searchInput.value = '';
      if (pitySummaryCard) pitySummaryCard.hidden = true;
      var currentYear = new Date().getFullYear();
      if (statsYearEl) statsYearEl.value = currentYear;
      if (statsMonthEl) statsMonthEl.value = '';
      if (pityYear) pityYear.value = currentYear;
      if (pityMonth) pityMonth.value = '';
      selectedRowId = null;
      if (detailSidebar) {
        detailSidebar.classList.remove('open');
        detailSidebar.setAttribute('aria-hidden', 'true');
      }
      tableBody.querySelectorAll('tr.selected').forEach(function (tr) { tr.classList.remove('selected'); });
      saveUIState();
      applyFilters();
      updateStatusCardsUI();
    });
  }

  // 임시: 전체 삭제 버튼
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', function () {
      var ok = confirm('정말 전체 삭제할까요?\n\n• 표 데이터가 전부 삭제됩니다.\n• 브라우저 로컬 저장소 데이터도 함께 초기화됩니다.');
      if (!ok) return;
      deleteAllData();
      alert('전체 삭제가 완료되었습니다.');
    });
  }

  if (pityQueryBtn && pityYear && pityMonth && pitySummaryCard && pitySummaryText) {
    pityQueryBtn.addEventListener('click', function () {
      activeFilterSection = 'section3';
      var year = parseInt(pityYear.value, 10);
      var monthVal = pityMonth.value;
      var month = monthVal === '' ? 0 : parseInt(monthVal, 10);
      if (isNaN(year)) return;
      // [섹션3] 말일 기준 스냅샷:
      // - 재직: 취득일 <= 기준일 && (상실일 없음 || 상실일 > 기준일)
      // - 퇴직: 상실일 <= 기준일
      var refDateStr = (monthVal === '' || month === 0)
        ? (year + '-12-31')
        : getLastDayOfMonth(year, month);

      var employedList = hrData.filter(function (item) { return isEmployedAtRef(item, refDateStr); });
      var retiredList = hrData.filter(function (item) { return isRetiredAtRef(item, refDateStr); });

      var mm = (monthVal === '' || month === 0) ? '12' : String(month).padStart(2, '0');
      var label = year + '년 ' + mm + '월';

      pointInTimeResult = { refDateStr: refDateStr, label: label, list: employedList, employedList: employedList, retiredList: retiredList, mode: 'snapshot' };
      pitySummaryCard.hidden = false;
      saveUIState();
      applyFilters();
    });
  }

  // 섹션3 결과 지우기 버튼
  if (pityClearBtn && pitySummaryCard && pitySummaryText) {
    pityClearBtn.addEventListener('click', function () {
      // 섹션3 결과만 초기화하고, 섹션1이 다시 주도권을 갖도록 복원
      activeFilterSection = 'section1';
      pointInTimeResult = null;
      pitySummaryText.textContent = '';
      pitySummaryCard.hidden = true;

      // 섹션3의 연/월 선택만 초기화
      var currentYear = new Date().getFullYear();
      if (pityYear) pityYear.value = currentYear;
      if (pityMonth) pityMonth.value = '';

      // 섹션1 기본 상태: 재직 유지
      statusFilter = '재직';
      dualMode = false;
      updateStatusCardsUI();
      applyFilters();
    });
  }

  // 섹션1 겸직 버튼
  if (dualBtn) {
    dualBtn.addEventListener('click', function () {
      activeFilterSection = 'section1';
      // 토글 형식: 이미 겸직 모드면 해제 → 재직 모드
      dualMode = !dualMode;
      if (dualMode) {
        // 상단 재직/퇴직 버튼은 모두 비활성
        statusFilter = '전체';
        companyFilter = null;
      } else {
        statusFilter = '재직';
      }
      if (pitySummaryCard) pitySummaryCard.hidden = true;
      updateStatusCardsUI();
      applyFilters();

      // 겸직 버튼 자체 active 스타일
      dualBtn.classList.toggle('active', dualMode);
    });
  }

  initStatsSelects();
  initPointInTimeSelects();
  loadUIState();
  updateYearCumulativeUI();

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
    info.phoneCol = findColumnIndexInRow(headerRow, ['핸드폰번호', '휴대폰번호', '연락처']);
    info.remarkCol = findColumnIndexInRow(headerRow, ['비고']);
    // 부가 정보(연구자번호, 학위 등) 컬럼 탐색
    info.researcherIdCol = findColumnIndexInRow(headerRow, ['연구자번호', '연구자 번호']);
    info.finalDegreeCol = findColumnIndexInRow(headerRow, ['최종학위', '최종 학위']);
    info.schoolCol = findColumnIndexInRow(headerRow, ['학교']);
    info.majorCol = findColumnIndexInRow(headerRow, ['학과']);
    info.degreeNumberCol = findColumnIndexInRow(headerRow, ['학위번호', '학위 번호']);
    info.degreeAwardDateCol = findColumnIndexInRow(headerRow, ['학위수여일', '학위 수여일']);
    info.addressCol = findColumnIndexInRow(headerRow, ['주소', 'Address']);
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
            var birthRaw = headerInfo.birthdateCol >= 0 ? row[headerInfo.birthdateCol] : null;
            var birthdate = normalizeBirthFromExcel(birthRaw);
            var item = {
              id: baseId + '-' + result.length,
              no: result.length + 1,
              originalIndex: result.length, // 엑셀에서 읽어온 실제 행 순서
              division: headerInfo.divisionCol >= 0 ? String(row[headerInfo.divisionCol] != null ? row[headerInfo.divisionCol] : '').trim() : '',
              name: name,
              department: headerInfo.departmentCol >= 0 ? String(row[headerInfo.departmentCol] != null ? row[headerInfo.departmentCol] : '').trim() : '',
              birthdate: birthdate,
              ssn: headerInfo.ssnCol >= 0 ? formatSSN(String(row[headerInfo.ssnCol] != null ? row[headerInfo.ssnCol] : '')) : '',
              gender: headerInfo.genderCol >= 0 ? String(row[headerInfo.genderCol] != null ? row[headerInfo.genderCol] : '').trim() : '',
              acquisitionDate: normalizeExcelDate(row[headerInfo.acqCol]) || null,
              lossDate: normalizeExcelDate(row[headerInfo.lossCol]) || null,
              age: calculateAge(birthdate),
              // 부가 정보는 컬럼이 있는 경우에만 채움
              phoneNumber: headerInfo.phoneCol >= 0 ? normalizePhoneNumber(row[headerInfo.phoneCol]) : '',
              researcherId: headerInfo.researcherIdCol >= 0 ? String(row[headerInfo.researcherIdCol] != null ? row[headerInfo.researcherIdCol] : '').trim() : '',
              finalDegree: headerInfo.finalDegreeCol >= 0 ? String(row[headerInfo.finalDegreeCol] != null ? row[headerInfo.finalDegreeCol] : '').trim() : '',
              school: headerInfo.schoolCol >= 0 ? String(row[headerInfo.schoolCol] != null ? row[headerInfo.schoolCol] : '').trim() : '',
              major: headerInfo.majorCol >= 0 ? String(row[headerInfo.majorCol] != null ? row[headerInfo.majorCol] : '').trim() : '',
              degreeNumber: headerInfo.degreeNumberCol >= 0 ? String(row[headerInfo.degreeNumberCol] != null ? row[headerInfo.degreeNumberCol] : '').trim() : '',
              degreeAwardDate: headerInfo.degreeAwardDateCol >= 0 ? normalizeExcelDate(row[headerInfo.degreeAwardDateCol]) || null : null,
              address: headerInfo.addressCol >= 0 ? String(row[headerInfo.addressCol] != null ? row[headerInfo.addressCol] : '').trim() : '',
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

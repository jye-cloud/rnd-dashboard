/* ============================================================
 * project-budget-export.js
 * ------------------------------------------------------------
 * 인건비 예산 페이지의 "참여연구원 표 내보내기" 기능.
 *
 * 두 가지 표 양식 지원:
 *   - form1 : 참여연구원 현황 (정부 R&D 표준 양식, 상세 컬럼 多)
 *   - form2 : 인건비 계상 합계 ((A/12)×B×(C/100) 자동 계산)
 *
 * 다운로드:
 *   - 📊 엑셀(.xlsx) : SheetJS(XLSX 전역)
 *   - 📄 한글(.hwpx) : JSZip으로 OWPML 패키지 생성
 *
 * 의존성 (전역):
 *   - XLSX                 (이미 페이지에 추가됨)
 *   - JSZip                (CDN으로 추가됨)
 *   - window.__pbExport    (project-budget.js가 노출하는 데이터 액세스 API)
 *     {
 *       getProject()      : { id, projectName, company, startDate, endDate, ... }
 *       getCurrentYear()  : { yearIndex, period: {startDate,endDate,months} }
 *       getRows()         : [...current year's rows]
 *       getPersonById(id) : person object (jspersons)
 *       getAllPersons()   : person[] (회사 필터 적용)
 *     }
 *
 * UI 흐름:
 *   1. 사용자가 양식 드롭다운 변경 → 미리보기 즉시 갱신
 *   2. 인력별 체크박스 토글 → 미리보기 갱신
 *   3. [📊 엑셀] / [📄 한글] 버튼 → 파일 다운로드
 *
 * 데이터 매핑 (row → 표 컬럼):
 *   row.personId        → person.name, person.birthDate, person.gender, etc.
 *   row.position        → 직위
 *   row.actualPay       → 월급 (급여총액 = actualPay × 12)
 *   row.rate            → 인건비계상률(%)
 *   row.participMonths  → 참여기간(개월)
 *   row.cashOrInkind    → 현금/현물
 *   row.newOrExisting   → 기존/신규
 *   row.role            → 담당역할
 * ============================================================ */
(function () {
  'use strict';

  // localStorage 키
  var LS_SELECTED_KEY = 'rnd-pb-export-selected'; // { [projectId+yearIndex]: [personId,...] } - 체크된 인력
  var LS_FORM_KEY     = 'rnd-pb-export-form';     // 'form1' | 'form2'
  var LS_PERIOD_KEY   = 'rnd-pb-export-period';   // { [rowId]: 'YYYY-MM ~ YYYY-MM' } - 인력별 참여기간 오버라이드
  var LS_ROLE_KEY     = 'rnd-pb-export-role';     // { [rowId]: '담당역할' } - 인력별 담당역할 (row.role과 별도 - export 전용)

  // 상태
  var _state = {
    form: 'form1',                // 현재 선택 양식
    selectedRowIds: null,         // Set<rowId> | null (null=전체)
    periodOverride: {},           // { [rowId]: 'YYYY.MM ~ YYYY.MM' }
    roleOverride: {},             // { [rowId]: '담당역할' }
  };

  // ========================================================================
  // 유틸
  // ========================================================================
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function fmtMoney(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('ko-KR');
  }

  function fmtDateCompact(iso) {
    // 'YYYY-MM-DD' → 'YYYY.MM.DD'
    if (!iso) return '';
    return String(iso).replace(/-/g, '.');
  }

  function fmtPeriodYM(startIso, endIso) {
    // 'YYYY-MM-DD', 'YYYY-MM-DD' → 'YYYY.MM ~ YYYY.MM'
    if (!startIso || !endIso) return '';
    var s = String(startIso).slice(0, 7).replace('-', '.');
    var e = String(endIso).slice(0, 7).replace('-', '.');
    return s + ' ~ ' + e;
  }

  function ymdToDateParts(iso) {
    if (!iso) return { y: '', m: '', d: '' };
    var p = String(iso).split('-');
    return { y: p[0] || '', m: p[1] || '', d: p[2] || '' };
  }

  function genderLabel(g) {
    if (g === 'M' || g === '남') return '남';
    if (g === 'F' || g === '여') return '여';
    return '';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function toast(msg, isError) {
    var el = $('pb-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? '#dc2626' : '#059669';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2200);
  }

  // ========================================================================
  // localStorage I/O
  // ========================================================================
  function getStorageKey(projectId, yearIndex) {
    return (projectId || '') + '#' + (yearIndex || 1);
  }

  function loadSelectedRows(projectId, yearIndex) {
    try {
      var raw = localStorage.getItem(LS_SELECTED_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      var k = getStorageKey(projectId, yearIndex);
      var arr = data[k];
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  }

  function saveSelectedRows(projectId, yearIndex, rowIds) {
    try {
      var raw = localStorage.getItem(LS_SELECTED_KEY);
      var data = raw ? JSON.parse(raw) : {};
      var k = getStorageKey(projectId, yearIndex);
      data[k] = Array.from(rowIds);
      localStorage.setItem(LS_SELECTED_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function loadForm() {
    try {
      var v = localStorage.getItem(LS_FORM_KEY);
      return (v === 'form2') ? 'form2' : 'form1';
    } catch (e) { return 'form1'; }
  }

  function saveForm(v) {
    try { localStorage.setItem(LS_FORM_KEY, v); } catch (e) {}
  }

  function loadOverrides(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveOverrides(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  // ========================================================================
  // 행 → 표 데이터 변환
  // ========================================================================
  /**
   * 현재 연차의 row들을 표 양식에 맞게 가공.
   * @returns {Array} 각 항목 = { rowId, personId, included, mapped: {...} }
   */
  function buildRowDataset() {
    var api = window.__pbExport;
    if (!api) return [];
    var project = api.getProject();
    if (!project) return [];
    var year = api.getCurrentYear();
    var rows = api.getRows() || [];

    var defaultPeriod = '';
    if (project.startDate && project.endDate) {
      defaultPeriod = fmtPeriodYM(project.startDate, project.endDate);
    } else if (year && year.period) {
      defaultPeriod = fmtPeriodYM(year.period.startDate, year.period.endDate);
    }

    var selectedIds = _state.selectedRowIds; // Set | null

    return rows.map(function (row, idx) {
      var person = row.personId ? api.getPersonById(row.personId) : null;
      var included = selectedIds ? selectedIds.has(row.id) : true;

      // row.actualPay = 월급(단일 기준). 폴백 row.monthlySalary 는 급여총액(연봉)이므로 ÷12.
      //   (원 단위 무조건 올림 — 마스터 페이지 Math.ceil(연봉/12)와 동일)
      var monthly  = Number(row.actualPay)
        || (Number(row.monthlySalary) ? Math.ceil(Number(row.monthlySalary) / 12) : 0)
        || (person && person.monthlySalary) || 0;
      var annual   = monthly * 12; // 급여총액(A)
      var rate     = Number(row.rate) || 0;
      var months   = Number(row.participMonths) || 0;
      // 합계 = (A/12) × B × (C/100) = monthly × months × rate/100
      //   단, 예산 페이지에서 총액을 수동 수정(totalOverride)했으면 그 값을 사용 (원단위 조정 등)
      var total    = (row.totalOverride != null && !isNaN(row.totalOverride))
        ? Math.round(Number(row.totalOverride))
        : Math.round(monthly * months * rate / 100);

      // 참여기간: 인력별 오버라이드 → 프로젝트 기본
      var period = _state.periodOverride[row.id] || defaultPeriod;
      // 담당역할: row.role > export 오버라이드
      var role = (row.role && row.role.trim()) || _state.roleOverride[row.id] || '';

      // 청년/신규 컬럼 라벨
      var newOrExist = row.newOrExisting || (person && person.isNew ? '신규' : '기존');
      var youthLabel = '';
      if (person && person.isYouth) {
        youthLabel = (newOrExist === '신규') ? '신규(청년)' : '청년';
      } else {
        youthLabel = newOrExist === '신규' ? '신규' : '기존';
      }

      // 학위
      var degree = (person && person.finalDegree) || '';
      var major  = (person && person.major) || '';
      var degYr  = '';
      if (person && person.degreeDate) {
        degYr = String(person.degreeDate).slice(0, 4);
      }

      // 생년월일 / 성별 → "YYYY.MM.DD(남/여)" 표기
      var birth = (person && person.birthDate) || '';
      var gender = person ? genderLabel(person.gender) : '';
      var birthGender = birth
        ? (fmtDateCompact(birth) + (gender ? '(' + gender + ')' : ''))
        : (gender ? '(' + gender + ')' : '');

      // 성명(국적) → 일단 국적 데이터가 없으므로 (한국)
      var nameNat = (row.personName || (person && person.name) || '') + '(한국)';

      // 소속기관(역할): 회사 + role 으로 구성. 단, 표1은 [소속기관(역할)] 한 컬럼.
      var company = (person && person.company) || project.company || '';
      var orgRole = company + (role ? '(' + role + ')' : '');

      // 직위
      var position = row.position || (person && person.position) || '';

      // 인력 구분(표2): "내부 / 기존(청년)" 식
      var personType  = '내부'; // 외부 데이터가 없으면 기본 내부
      var newDetail   = youthLabel; // '기존' | '신규' | '청년' | '신규(청년)'

      return {
        rowId: row.id,
        personId: row.personId || '',
        rowType: row.type || 'normal', // normal | youth_required | youth_additional
        included: included,
        mapped: {
          // 공통
          name:        row.personName || (person && person.name) || '',
          nameNat:     nameNat,
          orgRole:     orgRole,        // 소속기관(역할)
          newOrExist:  youthLabel,     // 기존/신규(청년/일반)/시간선택/외부
          position:    position,
          birthGender: birthGender,
          // 학위
          degree:      degree,
          major:       major,
          degreeYear:  degYr,
          // 역할/기간
          role:        role,
          period:      period,
          // 인건비계상률
          rateA:       rate,           // 본 연구개발사업
          rateB:       0,              // 타 사업 (현재 데이터 없음)
          rateAB:      rate,
          projectCnt:  '',             // 국가연구개발사업 수
          // 표2 추가 컬럼
          personType:  personType,     // 인력 구분
          inOut:       '내부',         // 내외부 및 지원구분
          annualSalary: annual,        // 급여총액(A)
          months:      months,         // 참여기간(B, 개월)
          rateC:       rate,           // 해당 차수 인건비계상률(C)
          totalCash:   row.cashOrInkind === '현금' ? total : 0,
          totalInkind: row.cashOrInkind === '현물' ? total : 0,
          totalSum:    total,
        },
      };
    });
  }

  /**
   * 표1 (참여연구원 현황) 헤더 정의.
   * 정부 R&D 양식 - 첫 캡처 기준.
   */
  function getForm1HeaderRows() {
    // 헤더는 '\n'으로 줄바꿈 힌트 (RTF는 \line으로 변환, HTML은 <br>)
    // 정부 양식 매칭: 세로 A4에 우겨넣기 위해 짧게 / 줄나눔
    return {
      headers: [
        '번호',
        '소속기관\n(역할)',
        '기존/신규\n(청년,일반)\n·시간선택/\n외부',
        '성명\n(국적)',
        '직위',
        '생년월일\n(성별)',
        '최종\n학위',
        '전공',
        '취득\n연도',
        '담당역할',
        '참여기간\n(년/월)',
        '본\n연구개발사업\n인건비\n계상률(%)\n(A)',
        '타\n국가연구\n개발사업\n인건비\n계상률(%)\n(B)',
        '전체\n인건비\n계상률\n합계(%)\n(A+B)',
        '국가연구\n개발사업\n수(건)\n(3책/5공)',
      ],
      // 상단 그룹 헤더 정보 (정부 양식: "학위 및 전공"이 최종학위/전공/취득연도 위에 병합)
      // groupSpans: [{ start, end, label }] - 컬럼 인덱스 기준
      groupSpans: [
        { start: 6, end: 8, label: '학위 및 전공' },
      ],
      keys: [
        '_no', 'orgRole', 'newOrExist', 'nameNat', 'position',
        'birthGender', 'degree', 'major', 'degreeYear', 'role',
        'period', 'rateA', 'rateB', 'rateAB', 'projectCnt',
      ],
    };
  }

  /**
   * 표2 (인건비 계상 합계) 헤더 정의.
   * 두 번째 캡처: 인력구분 / 성명(국적) / 직위 / 내외부 / 기존·신규 / 급여총액(A)
   *               / 참여기간(B,개월) / 인건비계상률(C) / 합계(현금/현물/계)
   */
  function getForm2HeaderRows() {
    return {
      headers: [
        '인력구분',
        '성명(국적)',
        '직위',
        '내·외부 및 지원구분',
        '기존/신규(청년,일반)·시간선택/외부',
        '급여총액(A)',
        '참여기간 (B, 개월)',
        '해당 차수 인건비계상률(%) (C)',
        '합계 현금 ((A/12)×B×(C/100))',
        '합계 현물',
        '합계 계',
      ],
      keys: [
        'personType', 'nameNat', 'position', 'inOut', 'newOrExist',
        'annualSalary', 'months', 'rateC',
        'totalCash', 'totalInkind', 'totalSum',
      ],
    };
  }

  /**
   * 포함된(included=true) 행만 가지고, 양식에 맞춰 2D 배열 형태로 변환.
   * 표 미리보기 + 엑셀 + HWPX 가 같은 데이터를 공유.
   * @returns {{ headers: string[], rows: any[][], money: Set<number> }}
   */
  function buildTableMatrix() {
    var dataset = buildRowDataset().filter(function (d) { return d.included; });
    var spec = (_state.form === 'form2') ? getForm2HeaderRows() : getForm1HeaderRows();

    var rows = dataset.map(function (d, i) {
      var row = [];
      spec.keys.forEach(function (k) {
        if (k === '_no') {
          row.push(String(i + 1));
        } else {
          row.push(d.mapped[k] == null ? '' : d.mapped[k]);
        }
      });
      return row;
    });

    // 표2 합계 행 추가
    if (_state.form === 'form2' && rows.length > 0) {
      var sumAnnual = 0, sumMonths = 0, sumCash = 0, sumInkind = 0, sumTotal = 0;
      dataset.forEach(function (d) {
        sumAnnual += Number(d.mapped.annualSalary) || 0;
        sumMonths += Number(d.mapped.months) || 0;
        sumCash += Number(d.mapped.totalCash) || 0;
        sumInkind += Number(d.mapped.totalInkind) || 0;
        sumTotal += Number(d.mapped.totalSum) || 0;
      });
      rows.push([
        '합계', '', '', '', '',
        sumAnnual, sumMonths, '',
        sumCash, sumInkind, sumTotal,
      ]);
    }

    // 금액 컬럼 인덱스 (스타일링용)
    var moneyColIdx = new Set();
    if (_state.form === 'form2') {
      // 급여총액(5), 합계 현금(8), 현물(9), 계(10)
      [5, 8, 9, 10].forEach(function (i) { moneyColIdx.add(i); });
    }

    return {
      headers: spec.headers,
      rows: rows,
      money: moneyColIdx,
      groupSpans: spec.groupSpans || [], // 상단 그룹 헤더 (학위 및 전공 등)
    };
  }

  // ========================================================================
  // 미리보기 렌더링
  // ========================================================================
  function renderPreview() {
    var wrap = $('pb-export-preview');
    if (!wrap) return;

    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();

    if (!project || !year) {
      wrap.innerHTML = '<div class="pb-export-empty">과제와 연차를 먼저 선택해 주세요.</div>';
      return;
    }

    // 인력 체크리스트
    renderRowCheckList();

    var m = buildTableMatrix();
    if (m.rows.length === 0) {
      wrap.innerHTML = '<div class="pb-export-empty">표시할 인력이 없습니다. (체크박스로 인력을 선택해 주세요)</div>';
      return;
    }

    var html = '';
    html += '<div class="pb-export-table-title">' + escapeHtml(getTableTitle()) + '</div>';
    html += '<table class="pb-export-table"><thead>';

    // 상단 그룹 헤더 행 (form1의 "학위 및 전공" 같은 병합 헤더)
    if (m.groupSpans && m.groupSpans.length > 0) {
      html += '<tr>';
      var ci = 0;
      while (ci < m.headers.length) {
        var grp = m.groupSpans.find(function (g) { return g.start === ci; });
        if (grp) {
          var span = grp.end - grp.start + 1;
          html += '<th colspan="' + span + '" style="background:#dde4ee;">' + escapeHtml(grp.label) + '</th>';
          ci = grp.end + 1;
        } else {
          // 단일 컬럼은 rowspan=2로 다음 행과 합쳐짐
          html += '<th rowspan="2">' + escapeHtml(m.headers[ci]).replace(/\n/g, '<br>') + '</th>';
          ci++;
        }
      }
      html += '</tr>';
    }

    // 메인 헤더 행 (그룹에 속한 컬럼만 표시 — 그룹 외 컬럼은 위에서 rowspan=2로 처리됨)
    html += '<tr>';
    m.headers.forEach(function (h, idx) {
      var inGroup = m.groupSpans && m.groupSpans.some(function (g) {
        return idx >= g.start && idx <= g.end;
      });
      if (m.groupSpans && m.groupSpans.length > 0) {
        // 그룹 헤더 존재 → 그룹 안 컬럼만 이 행에 그림
        if (inGroup) {
          html += '<th>' + escapeHtml(h).replace(/\n/g, '<br>') + '</th>';
        }
      } else {
        // 그룹 헤더 없음 → 단일 행 헤더
        html += '<th>' + escapeHtml(h).replace(/\n/g, '<br>') + '</th>';
      }
    });
    html += '</tr></thead><tbody>';

    m.rows.forEach(function (r, ri) {
      var isSum = (_state.form === 'form2') && (ri === m.rows.length - 1);
      html += isSum ? '<tr class="pb-export-row--sum">' : '<tr>';
      r.forEach(function (cell, ci) {
        var v = cell;
        if (m.money.has(ci) && typeof v === 'number') {
          v = fmtMoney(v);
        }
        html += '<td>' + escapeHtml(v) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function getTableTitle() {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    var formName = (_state.form === 'form2') ? '인건비 계상 합계' : '참여연구원 현황';
    var projName = project ? (project.projectName || '') : '';
    var yi = year ? year.yearIndex : 1;
    return '[' + projName + '] ' + yi + '차년도 ' + formName;
  }

  function renderRowCheckList() {
    var list = $('pb-export-row-list');
    if (!list) return;
    var api = window.__pbExport;
    var rows = api ? api.getRows() : [];

    if (!rows.length) {
      list.innerHTML = '<div class="pb-export-empty">예산 표에 행이 없습니다.</div>';
      return;
    }

    var selected = _state.selectedRowIds;
    var html = rows.map(function (row) {
      var person = row.personId ? api.getPersonById(row.personId) : null;
      var name = row.personName || (person && person.name) || '<이름 미입력>';
      var checked = selected ? selected.has(row.id) : true;
      var typeBadge = '';
      if (row.type === 'youth_required') typeBadge = '<span class="pb-export-badge pb-export-badge--req">청년필수</span>';
      else if (row.type === 'youth_additional') typeBadge = '<span class="pb-export-badge pb-export-badge--add">청년추가</span>';
      var months = Number(row.participMonths) || 0;
      var rate = Number(row.rate) || 0;
      var sub = months + '개월 · ' + rate + '%';
      return '' +
        '<label class="pb-export-row-item">' +
          '<input type="checkbox" class="pb-export-row-cb" data-row-id="' + escapeHtml(row.id) + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="pb-export-row-name">' + escapeHtml(name) + '</span>' +
          typeBadge +
          '<span class="pb-export-row-sub">' + escapeHtml(sub) + '</span>' +
        '</label>';
    }).join('');

    list.innerHTML = html;

    // 체크박스 이벤트
    list.querySelectorAll('.pb-export-row-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var rid = cb.dataset.rowId;
        if (!_state.selectedRowIds) {
          // 처음 토글하면 현재 전체 체크 상태에서 시작
          _state.selectedRowIds = new Set(rows.map(function (r) { return r.id; }));
        }
        if (cb.checked) {
          _state.selectedRowIds.add(rid);
        } else {
          _state.selectedRowIds.delete(rid);
        }
        persistSelection();
        renderPreview();
      });
    });
  }

  function persistSelection() {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    if (!project || !year) return;
    if (_state.selectedRowIds) {
      saveSelectedRows(project.id, year.yearIndex, _state.selectedRowIds);
    }
  }

  function restoreSelection() {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    var rows = api ? api.getRows() : [];
    if (!project || !year) {
      _state.selectedRowIds = null;
      return;
    }
    var saved = loadSelectedRows(project.id, year.yearIndex);
    if (saved && rows.length > 0) {
      // 현재 존재하는 row id만 필터
      var validIds = new Set(rows.map(function (r) { return r.id; }));
      _state.selectedRowIds = new Set(saved.filter(function (rid) { return validIds.has(rid); }));
    } else {
      _state.selectedRowIds = null; // 전체 선택
    }
  }

  // 외부에서 호출: 데이터 갱신 시 미리보기 새로 그리기
  function refresh() {
    restoreSelection();
    renderPreview();
  }

  // ========================================================================
  // 엑셀 다운로드
  // ========================================================================
  function downloadExcel() {
    if (typeof XLSX === 'undefined') {
      toast('엑셀 라이브러리를 로드하지 못했습니다.', true);
      return;
    }
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    if (!project || !year) {
      toast('과제와 연차를 먼저 선택해 주세요.', true);
      return;
    }

    var m = buildTableMatrix();
    if (m.rows.length === 0) {
      toast('내보낼 데이터가 없습니다.', true);
      return;
    }

    // 시트 데이터: 제목 + 빈줄 + 헤더 + 데이터
    var aoa = [];
    aoa.push([getTableTitle()]);
    aoa.push([]);
    aoa.push(m.headers);
    m.rows.forEach(function (r) {
      aoa.push(r.slice());
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // 열 너비 (대략)
    var colCount = m.headers.length;
    var colWidths = [];
    for (var c = 0; c < colCount; c++) {
      var h = m.headers[c] || '';
      var width = Math.min(Math.max(h.length * 2.2 + 4, 10), 24);
      colWidths.push({ wch: width });
    }
    ws['!cols'] = colWidths;

    // 제목 행 병합 (A1:끝열1)
    ws['!merges'] = ws['!merges'] || [];
    ws['!merges'].push({
      s: { r: 0, c: 0 },
      e: { r: 0, c: colCount - 1 },
    });

    // 숫자 셀 포맷 (money 컬럼)
    m.rows.forEach(function (r, ri) {
      r.forEach(function (cell, ci) {
        if (m.money.has(ci) && typeof cell === 'number') {
          var addr = XLSX.utils.encode_cell({ r: ri + 3, c: ci }); // +3: 제목+빈+헤더
          if (ws[addr]) {
            ws[addr].t = 'n';
            ws[addr].z = '#,##0';
          }
        }
      });
    });

    var wb = XLSX.utils.book_new();
    var sheetName = (_state.form === 'form2') ? '인건비계상합계' : '참여연구원현황';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    var fname = makeFilename('xlsx');
    XLSX.writeFile(wb, fname);
    toast('엑셀 다운로드 완료');
  }

  function makeFilename(ext) {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    var projName = project ? (project.projectName || 'project') : 'project';
    var yi = year ? year.yearIndex : 1;
    var formName = (_state.form === 'form2') ? '인건비계상합계' : '참여연구원현황';
    // 파일명 안전화
    var safe = projName.replace(/[\\/:*?"<>|]/g, '_');
    var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return safe + '_' + yi + '차년도_' + formName + '_' + today + '.' + ext;
  }


  // ========================================================================
  // RTF 표 빌더 (한글이 가장 잘 인식하는 외부 포맷)
  // ------------------------------------------------------------------------
  // 한글은 HTML clipboard를 일관되게 받지 않지만 (특히 한컴오피스 2022 이하),
  // RTF는 표 + 한글 + 셀 병합까지 안정적으로 인식한다.
  // .rtf 확장자로 다운로드해도 되고 .hwp 로 저장해도 한글이 자동 변환하여 연다.
  //
  // RTF 표 핵심 구조:
  //   {\rtf1\ansi\ansicpg949\deff0\uc1
  //     {\fonttbl{\f0\fcharset129 함초롬바탕;}{\f1\fcharset0 Arial;}}
  //     \fs22                                       // 11pt
  //     {제목 문단}\par
  //     \par
  //     \trowd\trgaph108\trleft0                    // 행 정의 시작
  //       \clcbpat2                                 // 헤더 배경색 (color 2)
  //       \clbrdrt\brdrs\brdrw10                    // 셀 테두리 4면
  //       \clbrdrl\brdrs\brdrw10
  //       \clbrdrb\brdrs\brdrw10
  //       \clbrdrr\brdrs\brdrw10
  //       \cellx1500                                // 셀 우측 경계 (twips)
  //       ... 컬럼 수만큼 반복
  //     \intbl\b 헤더1\b0\cell                      // 셀 내용
  //     \intbl\b 헤더2\b0\cell
  //     ...
  //     \row                                        // 행 종료
  //   ...
  // ========================================================================

  /**
   * 텍스트 한 조각을 RTF에 안전하게 넣을 수 있는 형태로 변환.
   *   - { } \ → \{ \} \\
   *   - ASCII가 아닌 모든 문자 → \uNNNN? (16-bit signed decimal)
   *   - 줄바꿈 → \line
   *
   * @param {string} s
   * @returns {string}
   */
  function rtfEscape(s) {
    if (s == null) return '';
    var out = '';
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      var c = str.charAt(i);
      if (c === '\\' || c === '{' || c === '}') {
        out += '\\' + c;
      } else if (c === '\n') {
        out += '\\line ';
      } else if (c === '\r') {
        // skip
      } else if (c === '\t') {
        out += '\\tab ';
      } else if (ch < 0x80) {
        out += c; // ASCII 그대로
      } else if (ch <= 0xFFFF) {
        // RTF \uN 은 16-bit signed decimal
        var signed = (ch > 32767) ? (ch - 65536) : ch;
        out += '\\u' + signed + '?';
      } else {
        // BMP 밖 - 한글 한자는 모두 BMP 내라 거의 사용 안 됨, 그래도 처리
        // UTF-16 surrogate pair
        var hi = 0xD800 + ((ch - 0x10000) >> 10);
        var lo = 0xDC00 + ((ch - 0x10000) & 0x3FF);
        var hiS = (hi > 32767) ? (hi - 65536) : hi;
        var loS = (lo > 32767) ? (lo - 65536) : lo;
        out += '\\u' + hiS + '?\\u' + loS + '?';
      }
    }
    return out;
  }

  /**
   * RTF 표 문서를 통째로 만든다.
   * 정부 양식 매칭: 세로 A4에 우겨넣기 위해 폰트 작게, 컬럼 좁게.
   * 그룹 헤더(예: "학위 및 전공") 가 있으면 2단 헤더 (셀 병합) 처리.
   * @returns {string} 완전한 RTF 문서
   */
  function buildTableRtf() {
    var m = buildTableMatrix();
    var title = getTableTitle();
    var headers = m.headers;
    var rows = m.rows;
    var moneyCols = m.money;
    var groupSpans = m.groupSpans || [];
    var nCols = headers.length;
    var hasGroups = groupSpans.length > 0;

    // ── 컬럼 너비 계산 ──
    // A4 세로 가용폭 약 9000 twips (1twip=1/1440인치)
    // 정부 양식 매칭: 모든 컬럼이 페이지 안에 들어가야 함
    // 헤더 줄바꿈 후 가장 긴 줄 길이를 기준
    var totalWidth = 9000;
    var headerLens = headers.map(function (h) {
      var lines = String(h).split('\n');
      var maxLineLen = lines.reduce(function (acc, line) {
        return Math.max(acc, line.length);
      }, 0);
      // 한글 한 글자 = 영문 약 2자, 가중치
      return Math.max(maxLineLen * 1.5, 2);
    });
    var lenSum = headerLens.reduce(function (a, b) { return a + b; }, 0);
    var colWidths = headerLens.map(function (l) {
      var w = Math.round(totalWidth * l / lenSum);
      // 좁은 컬럼 허용 (최소 400 ≈ 7mm), 너무 넓지 않게 (최대 1200 ≈ 21mm)
      return Math.max(400, Math.min(w, 1200));
    });
    // 합이 totalWidth와 다르면 비례 재조정 (페이지 가용폭 정확히 사용)
    var actualSum = colWidths.reduce(function (a, b) { return a + b; }, 0);
    var scale = totalWidth / actualSum;
    colWidths = colWidths.map(function (w) { return Math.round(w * scale); });

    // 누적 cellx 위치
    var cellxList = [];
    var acc = 0;
    colWidths.forEach(function (w) {
      acc += w;
      cellxList.push(acc);
    });

    // ── RTF 본문 시작 ──
    var rtf = '{\\rtf1\\ansi\\ansicpg949\\deff0\\uc1\n';

    // 폰트 테이블
    rtf += '{\\fonttbl' +
           '{\\f0\\fnil\\fcharset129 ' + rtfEscape('함초롬바탕') + ';}' +
           '{\\f1\\fswiss\\fcharset0 Arial;}}\n';

    // 색상 테이블
    rtf += '{\\colortbl;' +
           '\\red0\\green0\\blue0;' +              // 1: 검정 테두리
           '\\red229\\green231\\blue235;' +        // 2: 헤더 배경 (연 회색)
           '\\red254\\green243\\blue199;' +        // 3: 합계 배경 (연 황색)
           '\\red221\\green228\\blue238;' +        // 4: 그룹 헤더 배경 (살짝 다른 연 회색)
           '}\n';

    // 기본 폰트 9pt (\fs18) — 정부 양식 매칭 작은 글씨
    rtf += '\\fs18\\f0\n';

    // 제목 (굵게, 가운데, 12pt)
    rtf += '{\\qc\\b\\fs24 ' + rtfEscape(title) + '\\par}\n';
    rtf += '\\pard\\par\n';

    // ── 헬퍼: 행 정의 (각 셀의 위치/테두리/배경) ──
    // cellSpecs: [{ x: cellxValue, bgColor: 0|2|3|4, isMergeFirst: bool, isMergePart: bool }]
    // - isMergeFirst: 가로 병합 시작 셀 (\clmgf)
    // - isMergePart : 가로 병합 이후 셀 (\clmrg)
    // - isVertMergeFirst: 세로 병합 시작 (\clvmgf)
    // - isVertMergePart : 세로 병합 이후 (\clvmrg)
    function buildRowDef(cellSpecs) {
      var s = '\\trowd\\trgaph60\\trleft0\\trqc\n';
      cellSpecs.forEach(function (sp) {
        if (sp.bgColor) s += '\\clcbpat' + sp.bgColor + ' ';
        if (sp.isMergeFirst) s += '\\clmgf ';
        if (sp.isMergePart) s += '\\clmrg ';
        if (sp.isVertMergeFirst) s += '\\clvmgf ';
        if (sp.isVertMergePart) s += '\\clvmrg ';
        s += '\\clbrdrt\\brdrs\\brdrw10\\brdrcf1';
        s += '\\clbrdrl\\brdrs\\brdrw10\\brdrcf1';
        s += '\\clbrdrb\\brdrs\\brdrw10\\brdrcf1';
        s += '\\clbrdrr\\brdrs\\brdrw10\\brdrcf1';
        s += '\\clvertalc'; // vertical align middle
        s += '\\cellx' + sp.x + '\n';
      });
      return s;
    }

    function buildCellContent(text, opts) {
      opts = opts || {};
      var align = opts.align === 'right' ? '\\qr' : '\\qc';
      var bold = opts.bold ? '\\b' : '';
      var unbold = opts.bold ? '\\b0' : '';
      var fs = opts.fontSize ? ('\\fs' + opts.fontSize) : '';
      // 셀 내용 - \line으로 줄바꿈
      var content = rtfEscape(text);
      return '\\pard\\intbl' + align + fs + ' ' + bold + ' ' + content + unbold + '\\cell\n';
    }

    // ── 헤더 렌더링 ──
    if (hasGroups) {
      // 2단 헤더: 1단 = 그룹 헤더(가로 병합) + 단독 컬럼(세로 병합 시작), 2단 = 그룹 안 컬럼만
      // 1단: 모든 컬럼에 대해 specs 생성
      var row1Specs = [];
      var ci = 0;
      while (ci < nCols) {
        var grp = groupSpans.find(function (g) { return g.start === ci; });
        if (grp) {
          // 그룹 시작 셀 - \clmgf, 이후 셀들은 \clmrg
          for (var gc = grp.start; gc <= grp.end; gc++) {
            row1Specs.push({
              x: cellxList[gc],
              bgColor: 4,
              isMergeFirst: (gc === grp.start),
              isMergePart: (gc !== grp.start),
            });
          }
          ci = grp.end + 1;
        } else {
          // 단독 컬럼 - 세로 병합 시작
          row1Specs.push({
            x: cellxList[ci],
            bgColor: 2,
            isVertMergeFirst: true,
          });
          ci++;
        }
      }

      rtf += buildRowDef(row1Specs);
      // 셀 내용 채우기
      ci = 0;
      while (ci < nCols) {
        var grpC = groupSpans.find(function (g) { return g.start === ci; });
        if (grpC) {
          // 그룹 첫 셀에 그룹 라벨, 나머지 셀들은 빈 내용
          rtf += buildCellContent(grpC.label, { bold: true, align: 'center', fontSize: 16 });
          for (var k = grpC.start + 1; k <= grpC.end; k++) {
            rtf += buildCellContent('', { bold: true, align: 'center' });
          }
          ci = grpC.end + 1;
        } else {
          // 단독 컬럼 - 헤더 내용 (이 셀이 2행에 걸쳐 표시됨)
          rtf += buildCellContent(headers[ci], { bold: true, align: 'center', fontSize: 16 });
          ci++;
        }
      }
      rtf += '\\row\n';

      // 2단: 그룹 안 컬럼 + (단독 컬럼은 세로 병합 이어짐)
      var row2Specs = [];
      for (var c2 = 0; c2 < nCols; c2++) {
        var inGroup = groupSpans.some(function (g) {
          return c2 >= g.start && c2 <= g.end;
        });
        row2Specs.push({
          x: cellxList[c2],
          bgColor: 2,
          isVertMergePart: !inGroup, // 단독 컬럼이면 이어받기
        });
      }
      rtf += buildRowDef(row2Specs);
      for (var c2b = 0; c2b < nCols; c2b++) {
        var inGroupB = groupSpans.some(function (g) {
          return c2b >= g.start && c2b <= g.end;
        });
        if (inGroupB) {
          // 그룹 안 컬럼의 헤더 내용
          rtf += buildCellContent(headers[c2b], { bold: true, align: 'center', fontSize: 16 });
        } else {
          // 단독 컬럼 - 세로 병합 이어받기 (빈 내용)
          rtf += buildCellContent('', { bold: true, align: 'center' });
        }
      }
      rtf += '\\row\n';
    } else {
      // 그룹 없음 - 단일 헤더 행
      var simpleHeaderSpecs = cellxList.map(function (x) {
        return { x: x, bgColor: 2 };
      });
      rtf += buildRowDef(simpleHeaderSpecs);
      headers.forEach(function (h) {
        rtf += buildCellContent(h, { bold: true, align: 'center', fontSize: 16 });
      });
      rtf += '\\row\n';
    }

    // ── 데이터 행 ──
    rows.forEach(function (row, ri) {
      var isSum = (_state.form === 'form2') && (ri === rows.length - 1);
      var dataSpecs = cellxList.map(function (x) {
        return { x: x, bgColor: isSum ? 3 : 0 };
      });
      rtf += buildRowDef(dataSpecs);
      row.forEach(function (cell, ci) {
        var v = cell;
        if (moneyCols.has(ci) && typeof v === 'number') {
          v = fmtMoney(v);
        }
        var align = moneyCols.has(ci) ? 'right' : 'center';
        rtf += buildCellContent(v, { bold: isSum, align: align, fontSize: 18 });
      });
      rtf += '\\row\n';
    });

    rtf += '\\pard\\par\n';
    rtf += '}';

    return rtf;
  }

  /**
   * RTF 파일 다운로드.
   *   - 한글이 .rtf 를 직접 열 수 있음 (자동 변환 후 .hwp 로 저장 권장)
   *   - 또는 다른 도구(Word 등)로 열어 표 복사 → 한글에 붙여넣기도 가능
   */
  function downloadRtf() {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    if (!project || !year) {
      toast('과제와 연차를 먼저 선택해 주세요.', true);
      return;
    }

    var m = buildTableMatrix();
    if (m.rows.length === 0) {
      toast('내보낼 데이터가 없습니다.', true);
      return;
    }

    var rtf = buildTableRtf();
    // RTF 는 ASCII 기반이라 BOM 불필요
    var blob = new Blob([rtf], { type: 'application/rtf' });
    var fname = makeFilename('rtf');
    downloadBlob(blob, fname);
    toast('한글용 RTF 파일 다운로드 완료. 한글에서 그대로 열거나 .hwp로 저장하세요.');
  }

  /**
   * 한글에 직접 붙여넣기용 클립보드 복사.
   * 한글 2022 이하는 HTML clipboard 무시 → RTF clipboard 도 비표준이라 안정적이지 않음.
   * 따라서 가장 보편적으로 동작하는 방법: 
   *   plain text (탭 구분) + HTML 둘 다 클립보드에 넣음.
   *   한글이 HTML 못 받으면 평문이라도 들어가게.
   * 표 정확도가 중요하면 사용자는 RTF 다운로드 버튼을 쓰면 됨.
   */
  function copyForHwp() {
    var api = window.__pbExport;
    var project = api && api.getProject();
    var year = api && api.getCurrentYear();
    if (!project || !year) {
      toast('과제와 연차를 먼저 선택해 주세요.', true);
      return;
    }

    var m = buildTableMatrix();
    if (m.rows.length === 0) {
      toast('내보낼 데이터가 없습니다.', true);
      return;
    }

    var html = buildClipboardHtml(m);
    var plain = buildPlainText(m);

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        var item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        navigator.clipboard.write([item]).then(function () {
          toast('표 복사 완료! 한글에서 Ctrl+V (안 되면 RTF 다운로드 사용)');
        }).catch(function (err) {
          console.warn('[Clipboard API] failed:', err);
          copyForHwpFallback(html);
        });
        return;
      } catch (err) {
        console.warn('[ClipboardItem] not supported:', err);
      }
    }
    copyForHwpFallback(html);
  }

  function copyForHwpFallback(html) {
    var div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = html;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    div.style.top = '0';
    div.style.opacity = '0';
    document.body.appendChild(div);
    try {
      var range = document.createRange();
      range.selectNodeContents(div);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = document.execCommand('copy');
      sel.removeAllRanges();
      if (ok) {
        toast('표 복사 완료! 한글에서 Ctrl+V (안 되면 RTF 다운로드 사용)');
      } else {
        toast('복사 실패. RTF 다운로드 버튼을 사용하세요.', true);
      }
    } catch (err) {
      console.error('[copy fallback] error', err);
      toast('복사 실패. RTF 다운로드 버튼을 사용하세요.', true);
    } finally {
      document.body.removeChild(div);
    }
  }

  /**
   * 클립보드용 HTML (간결 버전, inline style).
   * 세로 A4에 우겨넣는 정부 양식 스타일.
   */
  function buildClipboardHtml(m) {
    var title = getTableTitle();
    // 작은 폰트 + 작은 padding (정부 양식 매칭)
    var thStyle = 'border:1px solid #000;padding:2px 3px;background:#E5E7EB;font-weight:bold;text-align:center;font-size:8pt;line-height:1.2;font-family:\'함초롬바탕\',\'맑은 고딕\',sans-serif;vertical-align:middle;';
    var tdStyle = 'border:1px solid #000;padding:3px 4px;text-align:center;font-size:9pt;line-height:1.3;font-family:\'함초롬바탕\',\'맑은 고딕\',sans-serif;vertical-align:middle;';
    var tdSumStyle = tdStyle + 'background:#FEF3C7;font-weight:bold;';

    var html = '';
    html += '<p style="font-size:11pt;font-weight:bold;text-align:center;margin:0 0 6px 0;font-family:\'함초롬바탕\',\'맑은 고딕\',sans-serif;">' +
            escapeHtml(title) + '</p>';
    html += '<table border="1" cellspacing="0" cellpadding="0" ' +
            'style="border-collapse:collapse;border:1px solid #000;width:100%;table-layout:fixed;">';

    // 헤더 (그룹 있으면 2단)
    html += '<thead>';
    if (m.groupSpans && m.groupSpans.length > 0) {
      // 1단: 그룹 + 단독 컬럼(rowspan)
      html += '<tr>';
      var ci = 0;
      while (ci < m.headers.length) {
        var grp = m.groupSpans.find(function (g) { return g.start === ci; });
        if (grp) {
          var span = grp.end - grp.start + 1;
          html += '<th colspan="' + span + '" style="' + thStyle + 'background:#dde4ee;">' +
                  escapeHtml(grp.label) + '</th>';
          ci = grp.end + 1;
        } else {
          html += '<th rowspan="2" style="' + thStyle + '">' +
                  escapeHtml(m.headers[ci]).replace(/\n/g, '<br>') + '</th>';
          ci++;
        }
      }
      html += '</tr>';
      // 2단: 그룹 안 컬럼만
      html += '<tr>';
      m.headers.forEach(function (h, idx) {
        var inGroup = m.groupSpans.some(function (g) {
          return idx >= g.start && idx <= g.end;
        });
        if (inGroup) {
          html += '<th style="' + thStyle + '">' + escapeHtml(h).replace(/\n/g, '<br>') + '</th>';
        }
      });
      html += '</tr>';
    } else {
      // 그룹 없음 - 단일 헤더 행
      html += '<tr>';
      m.headers.forEach(function (h) {
        html += '<th style="' + thStyle + '">' + escapeHtml(h).replace(/\n/g, '<br>') + '</th>';
      });
      html += '</tr>';
    }
    html += '</thead>';

    // 데이터 행
    html += '<tbody>';
    m.rows.forEach(function (r, ri) {
      var isSum = (_state.form === 'form2') && (ri === m.rows.length - 1);
      var style = isSum ? tdSumStyle : tdStyle;
      html += '<tr>';
      r.forEach(function (cell, ci) {
        var v = cell;
        if (m.money.has(ci) && typeof v === 'number') v = fmtMoney(v);
        var alignStyle = m.money.has(ci) ? style.replace('text-align:center', 'text-align:right') : style;
        html += '<td style="' + alignStyle + '">' + escapeHtml(v) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /**
   * 평문(탭 구분) 표 생성 - 클립보드 plain 형식.
   */
  function buildPlainText(m) {
    var lines = [];
    lines.push(getTableTitle());
    lines.push('');
    lines.push(m.headers.join('\t'));
    m.rows.forEach(function (r) {
      lines.push(r.map(function (cell, ci) {
        if (m.money.has(ci) && typeof cell === 'number') return fmtMoney(cell);
        return String(cell == null ? '' : cell);
      }).join('\t'));
    });
    return lines.join('\n');
  }


  // ========================================================================
  // 이벤트 바인딩
  // ========================================================================
  function bindEvents() {
    // 양식 드롭다운
    var formSel = $('pb-export-form-select');
    if (formSel) {
      formSel.value = _state.form;
      formSel.addEventListener('change', function () {
        _state.form = formSel.value;
        saveForm(_state.form);
        renderPreview();
      });
    }

    // 다운로드 버튼
    var xlsxBtn = $('pb-export-xlsx-btn');
    if (xlsxBtn) xlsxBtn.addEventListener('click', downloadExcel);

    var hwpBtn = $('pb-export-hwp-copy-btn');
    if (hwpBtn) hwpBtn.addEventListener('click', copyForHwp);

    var rtfBtn = $('pb-export-rtf-btn');
    if (rtfBtn) rtfBtn.addEventListener('click', downloadRtf);

    // 전체 선택 / 해제
    var selAllBtn = $('pb-export-select-all');
    var unselAllBtn = $('pb-export-unselect-all');
    if (selAllBtn) {
      selAllBtn.addEventListener('click', function () {
        var api = window.__pbExport;
        var rows = api ? api.getRows() : [];
        _state.selectedRowIds = new Set(rows.map(function (r) { return r.id; }));
        persistSelection();
        renderPreview();
      });
    }
    if (unselAllBtn) {
      unselAllBtn.addEventListener('click', function () {
        _state.selectedRowIds = new Set();
        persistSelection();
        renderPreview();
      });
    }
  }

  // ========================================================================
  // 초기화 - project-budget.js가 준비된 후 호출됨
  // ========================================================================
  function init() {
    _state.form = loadForm();
    _state.periodOverride = loadOverrides(LS_PERIOD_KEY);
    _state.roleOverride = loadOverrides(LS_ROLE_KEY);

    bindEvents();
    refresh();

    // project-budget.js가 데이터 갱신 시 호출하도록 노출
    window.__pbExportRefresh = refresh;
  }

  // project-budget.js가 노출하는 API가 준비될 때까지 기다림
  function waitForApi() {
    if (window.__pbExport) {
      init();
    } else {
      setTimeout(waitForApi, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForApi);
  } else {
    waitForApi();
  }

})();

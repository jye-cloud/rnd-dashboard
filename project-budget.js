/**
 * project-budget.js — 프로젝트별 인건비 예산 페이지
 *
 * 구현 범위:
 *  - projects 컬렉션 구독 (laborManaged === true 인 과제만)
 *  - persons 컬렉션 구독
 *  - projectBudget 컬렉션에서 연차별 인건비 예산 로드/저장
 *    · 문서 ID: {projectId}_year{N}  (N = 1, 2, 3 ...)
 *    · 구조: {
 *        projectId, yearIndex,
 *        period: { startDate, endDate, months },
 *        rows: [
 *          { id, type, newOrExisting, cashOrInkind, personId, personName,
 *            role, threeOrFiveGong, position,
 *            monthlySalary, actualPay, rate, participMonths }
 *        ],
 *        budgetCash, budgetInkind, updatedAt
 *      }
 *  - "인건비 예상 분배" 버튼 → 해당 연차 행들을 projectLabor/{projectId}_planned 의
 *    cells[projectId_ym_personId] 에 분배 (rate, cash, inkind)
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _allProjects = [];   // Firestore projects 전체
  var _filteredProjects = []; // laborManaged === true 인 것만
  var _allPersons = [];

  // ====================================================================
  // 회사 필터 — 모든 인건비 페이지에서 공유 (localStorage)
  // ====================================================================
  var COMPANY_FILTER_KEY = 'rnd-company-filter';
  function loadCompanyFilter() {
    try {
      var v = localStorage.getItem(COMPANY_FILTER_KEY) || '';
      if (v === '' || v === '식스티' || v === '굿뉴스' || v === '패리티') return v;
      return '';
    } catch (e) { return ''; }
  }
  function saveCompanyFilter(c) {
    try { localStorage.setItem(COMPANY_FILTER_KEY, c || ''); } catch (e) {}
  }

  var state = {
    projectId: '',
    yearIndex: 1,           // 현재 활성 연차 (1부터 시작)
    yearsData: {},          // { 1: { rows, period, budgetCash, budgetInkind }, 2: {...} }
    company:   loadCompanyFilter(),  // '' (전체) | '식스티' | '굿뉴스' | '패리티'
    loading: false,
    saveTimer: null,
    // 인력 검색 모달 컨텍스트
    modalRowId: null,       // 어느 행의 인력을 채울지
  };

  // ====================================================================
  // Firestore 컬렉션 참조
  // ====================================================================
  var BUDGET_COLL = 'projectBudget';
  var LABOR_COLL = 'projectLabor';

  function db() {
    return window.__firebaseDb;
  }

  function isFirestoreReady() {
    return !!(window.__firebaseConfigured && window.__firebaseDb);
  }

  // ====================================================================
  // 유틸
  // ====================================================================
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function parseNum(v) {
    if (v == null || v === '') return 0;
    var s = String(v).replace(/[^\d.-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function fmtMoneyFull(n) {
    if (!n && n !== 0) return '0';
    return Math.round(n).toLocaleString('ko-KR');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return (prefix || 'row') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // 두 날짜 사이의 월수 계산 (YYYY-MM-DD)
  function monthsBetween(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return 0;
    var s = startDateStr.slice(0, 7); // YYYY-MM
    var e = endDateStr.slice(0, 7);
    var sy = parseInt(s.slice(0, 4), 10), sm = parseInt(s.slice(5, 7), 10);
    var ey = parseInt(e.slice(0, 4), 10), em = parseInt(e.slice(5, 7), 10);
    if (isNaN(sy) || isNaN(ey)) return 0;
    return (ey - sy) * 12 + (em - sm) + 1;
  }

  // 연차 기간 문자열 (예: "26.04~26.12")
  function fmtPeriodShort(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return '';
    var sy = startDateStr.slice(2, 4);
    var sm = startDateStr.slice(5, 7);
    var ey = endDateStr.slice(2, 4);
    var em = endDateStr.slice(5, 7);
    return sy + '.' + sm + '~' + ey + '.' + em;
  }

  // 연차 startDate~endDate 사이의 ym 목록
  function getYmListInRange(startDateStr, endDateStr) {
    var list = [];
    if (!startDateStr || !endDateStr) return list;
    var sy = parseInt(startDateStr.slice(0, 4), 10);
    var sm = parseInt(startDateStr.slice(5, 7), 10);
    var ey = parseInt(endDateStr.slice(0, 4), 10);
    var em = parseInt(endDateStr.slice(5, 7), 10);
    if (isNaN(sy) || isNaN(ey)) return list;
    var y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
      list.push(y + '-' + pad2(m));
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return list;
  }

  // ====================================================================
  // 토스트
  // ====================================================================
  function toast(msg, isError) {
    var el = document.getElementById('pb-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? '#dc2626' : '#059669';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2400);
  }

  function showSaveIndicator(msg) {
    var el = document.getElementById('pb-save-indicator');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 2000);
  }

  function setLoading(val) {
    state.loading = val;
    var el = document.getElementById('pb-loading');
    if (el) el.style.display = val ? 'block' : 'none';
  }

  // ====================================================================
  // 과제 목록 처리
  // ====================================================================
  function filterProjectsForBudget() {
    // 인건비 관리 대상이면서 제안/선정 단계인 과제만
    _filteredProjects = _allProjects.filter(function (p) {
      if (!p || p.laborManaged !== true) return false;
      // 회사 필터
      if (state.company && p.company !== state.company) return false;
      return true;
    });
    // 정렬: 미제출/제출/선정 우선, 그 다음 이름
    _filteredProjects.sort(function (a, b) {
      var na = (a.name || a.projectName || '').toString();
      var nb = (b.name || b.projectName || '').toString();
      return na.localeCompare(nb, 'ko');
    });
  }

  function populateProjectSelect() {
    var sel = document.getElementById('pb-project-select');
    if (!sel) return;
    var prevId = state.projectId;
    sel.innerHTML = '';

    if (_filteredProjects.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '인건비 관리 대상 과제가 없습니다';
      sel.appendChild(opt);
      state.projectId = '';
      return;
    }

    var defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = '-- 과제 선택 --';
    sel.appendChild(defOpt);

    _filteredProjects.forEach(function (proj) {
      var opt = document.createElement('option');
      opt.value = proj.id;
      var name = proj.name || proj.projectName || proj.id;
      var kw = (proj.keywords || proj.keyword || '').toString().trim();
      var label = kw ? '(' + kw + ') ' + name : name;
      var statusBadge = proj.status ? ' [' + proj.status + ']' : '';
      opt.textContent = label + statusBadge;
      sel.appendChild(opt);
    });

    // 이전 선택 유지
    if (prevId && _filteredProjects.some(function (p) { return p.id === prevId; })) {
      sel.value = prevId;
    } else {
      sel.value = '';
      state.projectId = '';
    }
  }

  function getProject() {
    return _filteredProjects.find(function (p) { return p.id === state.projectId; });
  }

  // ====================================================================
  // 연차 탭 생성
  // ====================================================================
  function getProjectYears(project) {
    // project.yearBudgets 또는 annualData 에서 연차별 startDate/endDate 추출
    if (!project) return [];
    var src = project.yearBudgets || project.annualData || [];
    if (!Array.isArray(src)) return [];
    return src
      .filter(function (yb) { return yb && yb.startDate && yb.endDate; })
      .map(function (yb, idx) {
        return {
          yearIndex: idx + 1,
          startDate: yb.startDate,
          endDate: yb.endDate,
          months: monthsBetween(yb.startDate, yb.endDate),
        };
      });
  }

  function renderYearTabs() {
    var wrap = document.getElementById('pb-year-tabs');
    if (!wrap) return;
    wrap.innerHTML = '';
    var project = getProject();
    var years = getProjectYears(project);
    if (years.length === 0) {
      wrap.innerHTML = '<div style="font-size:0.85rem; color:#94a3b8; padding:0.5rem;">연차 정보가 없습니다. 과제 상세에서 연차별 기간을 먼저 등록해주세요.</div>';
      return;
    }
    years.forEach(function (y) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pb-year-tab' + (y.yearIndex === state.yearIndex ? ' is-active' : '');
      btn.dataset.year = y.yearIndex;
      btn.innerHTML =
        '<span>' + y.yearIndex + '차년도</span>' +
        '<span class="pb-year-tab-period">(' + escapeHtml(fmtPeriodShort(y.startDate, y.endDate)) + ')</span>';
      btn.addEventListener('click', function () {
        state.yearIndex = y.yearIndex;
        renderYearTabs();
        renderTable();
      });
      wrap.appendChild(btn);
    });
  }

  // ====================================================================
  // 현재 연차 데이터 가져오기 (없으면 기본 골격)
  // ====================================================================
  function getCurrentYearData() {
    var project = getProject();
    var years = getProjectYears(project);
    var yi = state.yearIndex;
    var ybMeta = years.find(function (y) { return y.yearIndex === yi; });
    var existing = state.yearsData[yi];

    if (existing) {
      // period 메타는 항상 최신 yearBudgets 값으로 동기화 (과제 상세에서 수정될 수 있음)
      if (ybMeta) {
        existing.period = {
          startDate: ybMeta.startDate,
          endDate: ybMeta.endDate,
          months: ybMeta.months,
        };
      }
      return existing;
    }

    var fresh = {
      rows: [],
      period: ybMeta ? {
        startDate: ybMeta.startDate,
        endDate: ybMeta.endDate,
        months: ybMeta.months,
      } : { startDate: '', endDate: '', months: 0 },
      budgetCash: 0,
      budgetSelfCash: 0,
      budgetInkind: 0,
    };
    state.yearsData[yi] = fresh;
    return fresh;
  }

  // ====================================================================
  // 행 추가 (빈 행)
  // ====================================================================
  function addRow(type) {
    // type: 'normal' | 'youth_required' | 'youth_additional'
    var yd = getCurrentYearData();
    var defaults = { newOrExisting: '기존', cashOrInkind: '현금' };
    if (type === 'youth_required' || type === 'youth_additional') {
      // 청년 행은 기본 신규/현금
      defaults.newOrExisting = '신규';
      defaults.cashOrInkind = '현금';
    }
    yd.rows.push({
      id: uid('row'),
      type: type,
      newOrExisting: defaults.newOrExisting,
      cashOrInkind: defaults.cashOrInkind,
      personId: '',
      personName: '',
      role: '',
      threeOrFiveGong: '',
      position: '',
      monthlySalary: 0,
      actualPay: 0,
      rate: 0,
      participMonths: yd.period.months || 0,
    });
    renderTable();
    scheduleSave();
  }

  function removeRow(rowId) {
    var yd = getCurrentYearData();
    yd.rows = yd.rows.filter(function (r) { return r.id !== rowId; });
    renderTable();
    scheduleSave();
  }

  // ====================================================================
  // 계산
  // ====================================================================
  // ====================================================================
  // 표시 라벨 (데이터 키는 그대로, 사용자에게 보이는 문구만 변경)
  // ====================================================================
  // 데이터 모델: cashOrInkind = '현금' | '자부담현금' | '현물'
  // 표시 라벨:   지원금 / 현금 / 현물
  // (※ "현금"이라는 단어가 라벨에서 자부담현금을 가리키게 됩니다.
  //   값 비교/저장은 항상 데이터 키(`'현금'` 등)로 합니다.)
  var FUND_TYPE_LABELS = {
    '현금': '지원금',
    '자부담현금': '현금',
    '현물': '현물'
  };
  function fundTypeLabel(v) { return FUND_TYPE_LABELS[v] || v; }

  function calcRowTotal(row) {
    // 총액 = 실지급액 * (참여율/100) * 참여개월
    var actual = parseNum(row.actualPay);
    var rate = parseNum(row.rate);
    var months = parseNum(row.participMonths);
    return Math.round(actual * (rate / 100) * months);
  }

  function calcRowCash(row) {
    return row.cashOrInkind === '현금' ? calcRowTotal(row) : 0;
  }

  function calcRowSelfCash(row) {
    return row.cashOrInkind === '자부담현금' ? calcRowTotal(row) : 0;
  }

  function calcRowInkind(row) {
    return row.cashOrInkind === '현물' ? calcRowTotal(row) : 0;
  }

  function calcTotals(yd) {
    var sumTotal = 0, sumCash = 0, sumSelfCash = 0, sumInkind = 0;
    yd.rows.forEach(function (r) {
      sumTotal += calcRowTotal(r);
      sumCash += calcRowCash(r);
      sumSelfCash += calcRowSelfCash(r);
      sumInkind += calcRowInkind(r);
    });
    return { total: sumTotal, cash: sumCash, selfCash: sumSelfCash, inkind: sumInkind };
  }

  // ====================================================================
  // 테이블 렌더링
  // ====================================================================
  function renderTable() {
    var emptyEl = document.getElementById('pb-empty');
    var titleEl = document.getElementById('pb-title-box');
    var wrapEl = document.getElementById('pb-table-wrap');
    var summaryEl = document.getElementById('pb-budget-summary');
    var titleText = document.getElementById('pb-title-text');
    var optionsEl = document.getElementById('pb-project-options');
    var selfCashCb = document.getElementById('pb-has-self-cash');

    var project = getProject();
    if (!project) {
      if (emptyEl) emptyEl.style.display = 'block';
      if (titleEl) titleEl.style.display = 'none';
      if (wrapEl) wrapEl.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';
      if (optionsEl) optionsEl.style.display = 'none';
      return;
    }

    // 과제 선택됨 → 옵션 박스 표시 + 체크박스 값 동기화
    if (optionsEl) optionsEl.style.display = 'flex';
    if (selfCashCb) selfCashCb.checked = !!project.hasSelfCash;

    var years = getProjectYears(project);
    if (years.length === 0) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.innerHTML = '연차 정보가 없습니다.<br><small style="color:#cbd5e1;">과제 상세 페이지에서 연차별 기간을 먼저 등록해주세요.</small>';
      }
      if (titleEl) titleEl.style.display = 'none';
      if (wrapEl) wrapEl.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (titleEl) titleEl.style.display = 'flex';
    if (wrapEl) wrapEl.style.display = 'block';
    if (summaryEl) summaryEl.style.display = 'flex';

    var yd = getCurrentYearData();
    var period = yd.period || { startDate: '', endDate: '', months: 0 };

    // 제목 박스
    if (titleText) {
      titleText.textContent =
        '인건비_' + state.yearIndex + '차년도 (' +
        fmtPeriodShort(period.startDate, period.endDate) + ')_' +
        (period.months || 0) + '개월';
    }

    // 테이블
    var table = document.getElementById('pb-table');
    if (!table) return;

    // 행 분리
    var normalRows = yd.rows.filter(function (r) { return r.type === 'normal'; });
    var youthReqRows = yd.rows.filter(function (r) { return r.type === 'youth_required'; });
    var youthAddRows = yd.rows.filter(function (r) { return r.type === 'youth_additional'; });

    var html = '';

    // colgroup
    html += '<colgroup>' +
      '<col class="col-type">' +
      '<col class="col-pay">' +
      '<col class="col-name">' +
      '<col class="col-role">' +
      '<col class="col-3r5g">' +
      '<col class="col-pos">' +
      '<col class="col-salary">' +
      '<col class="col-actual">' +
      '<col class="col-rate">' +
      '<col class="col-months">' +
      '<col class="col-total">' +
      '<col class="col-cash">' +
      '<col class="col-selfcash">' +
      '<col class="col-inkind">' +
      '<col class="col-action">' +
      '</colgroup>';

    // 헤더 (라벨: 지원금/현금/현물, 데이터 키와 다름 주의)
    html += '<thead><tr>' +
      '<th>기존/신규</th>' +
      '<th>재원구분</th>' +
      '<th>성명</th>' +
      '<th>역할</th>' +
      '<th>3책5공</th>' +
      '<th>직위</th>' +
      '<th class="th-input">급여총액</th>' +
      '<th class="th-input-yellow">실지급액</th>' +
      '<th class="th-input">참여율</th>' +
      '<th class="th-input">참여개월</th>' +
      '<th>총액</th>' +
      '<th>' + fundTypeLabel('현금') + '</th>' +
      '<th>' + fundTypeLabel('자부담현금') + '</th>' +
      '<th>' + fundTypeLabel('현물') + '</th>' +
      '<th></th>' +
      '</tr></thead>';

    // tbody
    html += '<tbody>';

    // 일반 인력 행들
    normalRows.forEach(function (r) {
      html += renderRow(r);
    });
    // + 일반 인력 추가
    html += '<tr class="pb-row-add"><td colspan="15">' +
      '<div class="pb-row-add-buttons">' +
        '<button type="button" class="pb-add-btn" data-add-type="normal">+ 일반 인력 추가</button>' +
        '<button type="button" class="pb-add-btn pb-add-btn--youth" data-add-type="youth_required">+ 청년 필수 추가</button>' +
        '<button type="button" class="pb-add-btn pb-add-btn--youth pb-add-btn--youth-add" data-add-type="youth_additional">+ 청년 추가</button>' +
      '</div>' +
    '</td></tr>';

    // 청년 필수 행들 (있을 때만 구분선 그라데이션 헤더)
    youthReqRows.forEach(function (r, idx) {
      html += renderRow(r, idx === 0 ? '청년 필수' : '');
    });

    // 청년 추가 행들
    youthAddRows.forEach(function (r, idx) {
      html += renderRow(r, idx === 0 ? '청년 추가' : '');
    });

    html += '</tbody>';

    // tfoot - 합계
    var totals = calcTotals(yd);
    var project = getProject();
    var hasSelfCash = !!(project && project.hasSelfCash);
    var tfootSelfCashCls = hasSelfCash ? '' : ' pb-cell-selfcash-disabled';
    html += '<tfoot><tr class="pb-tfoot-sum">' +
      '<td class="td-label" colspan="6">직접비 · 인건비 합계</td>' +
      '<td></td>' +
      '<td></td>' +
      '<td></td>' +
      '<td></td>' +
      '<td>' + fmtMoneyFull(totals.total) + '</td>' +
      '<td>' + fmtMoneyFull(totals.cash) + '</td>' +
      '<td class="' + tfootSelfCashCls.trim() + '">' + fmtMoneyFull(totals.selfCash) + '</td>' +
      '<td>' + fmtMoneyFull(totals.inkind) + '</td>' +
      '<td></td>' +
    '</tr></tfoot>';

    table.innerHTML = html;

    // 이벤트 바인딩 (행 입력)
    bindRowEvents();

    // + 버튼 이벤트
    table.querySelectorAll('[data-add-type]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addRow(btn.dataset.addType);
      });
    });

    // 삭제 버튼 이벤트
    table.querySelectorAll('.pb-row-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rowId = btn.dataset.rowId;
        if (rowId && confirm('이 행을 삭제하시겠어요?')) {
          removeRow(rowId);
        }
      });
    });

    // 인력 검색 버튼 이벤트
    table.querySelectorAll('.pb-name-search-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPersonModal(btn.dataset.rowId);
      });
    });

    // 예산 요약 렌더링
    renderBudgetSummary();
  }

  function renderRow(r, labelPrefix) {
    var clsRow = 'pb-row-' + (
      r.type === 'youth_required' ? 'youth-req' :
      r.type === 'youth_additional' ? 'youth-add' : 'normal'
    );
    var nameDisplay = r.personName || '';
    var rowTotal = calcRowTotal(r);
    var rowCash = calcRowCash(r);
    var rowSelfCash = calcRowSelfCash(r);
    var rowInkind = calcRowInkind(r);

    // hasSelfCash=false면 자부담현금 옵션/셀을 비활성 시각
    // (단, 행이 이미 '자부담현금' 값을 갖고 있으면 옵션은 살려두기 — 모순 방지)
    var project = getProject();
    var hasSelfCash = !!(project && project.hasSelfCash);
    var allowSelfCashOption = hasSelfCash || r.cashOrInkind === '자부담현금';
    var selfCashDisabledAttr = allowSelfCashOption ? '' : ' disabled';
    var selfCashCellCls = hasSelfCash ? '' : ' pb-cell-selfcash-disabled';

    var nameCell = '<input type="text" class="pb-cell-text" data-row="' + r.id + '" data-field="personName" value="' + escapeHtml(nameDisplay) + '" placeholder="' +
      (r.type === 'youth_required' ? '청년 필수 ' + (labelPrefix ? '1' : '') :
       r.type === 'youth_additional' ? '청년 추가' : '성명') + '">';

    // 일반 인력만 인력 검색 버튼 노출 (청년 행은 신규라 인력 풀에 없음)
    if (r.type === 'normal') {
      nameCell =
        '<div style="display:flex; align-items:center; gap:0.2rem;">' +
          '<input type="text" class="pb-cell-text" data-row="' + r.id + '" data-field="personName" value="' + escapeHtml(nameDisplay) + '" placeholder="성명" style="flex:1; min-width:0;">' +
          '<button type="button" class="pb-name-search-btn" data-row-id="' + r.id + '" title="인력 검색" style="background:transparent; border:none; cursor:pointer; padding:0.3rem; color:#94a3b8; font-size:0.9rem;">🔍</button>' +
        '</div>';
    }

    return '<tr class="' + clsRow + '" data-row-id="' + r.id + '">' +
      // 기존/신규
      '<td>' +
        '<select class="pb-cell-select" data-row="' + r.id + '" data-field="newOrExisting">' +
          '<option value="기존"' + (r.newOrExisting === '기존' ? ' selected' : '') + '>기존</option>' +
          '<option value="신규"' + (r.newOrExisting === '신규' ? ' selected' : '') + '>신규</option>' +
        '</select>' +
      '</td>' +
      // 재원구분 (데이터 키: 현금/자부담현금/현물 → 라벨: 지원금/현금/현물)
      '<td>' +
        '<select class="pb-cell-select" data-row="' + r.id + '" data-field="cashOrInkind">' +
          '<option value="현금"' + (r.cashOrInkind === '현금' ? ' selected' : '') + '>' + fundTypeLabel('현금') + '</option>' +
          '<option value="자부담현금"' + (r.cashOrInkind === '자부담현금' ? ' selected' : '') + selfCashDisabledAttr + '>' + fundTypeLabel('자부담현금') + '</option>' +
          '<option value="현물"' + (r.cashOrInkind === '현물' ? ' selected' : '') + '>' + fundTypeLabel('현물') + '</option>' +
        '</select>' +
      '</td>' +
      // 성명
      '<td>' + nameCell + '</td>' +
      // 역할
      '<td><input type="text" class="pb-cell-text" data-row="' + r.id + '" data-field="role" value="' + escapeHtml(r.role || '') + '" placeholder="역할"></td>' +
      // 3책5공
      '<td><input type="text" class="pb-cell-text" data-row="' + r.id + '" data-field="threeOrFiveGong" value="' + escapeHtml(r.threeOrFiveGong || '') + '" placeholder=""></td>' +
      // 직위
      '<td><input type="text" class="pb-cell-text" data-row="' + r.id + '" data-field="position" value="' + escapeHtml(r.position || '') + '" placeholder="직위"></td>' +
      // 급여총액 (수정 가능, 강조)
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="monthlySalary" value="' + (r.monthlySalary ? fmtMoneyFull(r.monthlySalary) : '') + '" placeholder="0" inputmode="numeric"></td>' +
      // 실지급액 (수정 가능, 노랑)
      '<td class="td-input-yellow"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="actualPay" value="' + (r.actualPay ? fmtMoneyFull(r.actualPay) : '') + '" placeholder="0" inputmode="numeric"></td>' +
      // 참여율
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="rate" value="' + (r.rate || '') + '" placeholder="0" inputmode="decimal"></td>' +
      // 참여개월
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="participMonths" value="' + (r.participMonths || '') + '" placeholder="0" inputmode="numeric"></td>' +
      // 총액 (계산)
      '<td><div class="pb-cell-readonly">' + fmtMoneyFull(rowTotal) + '</div></td>' +
      // 지원금 (계산, 데이터 키: 현금)
      '<td><div class="pb-cell-readonly">' + fmtMoneyFull(rowCash) + '</div></td>' +
      // 현금 (계산, 데이터 키: 자부담현금) — hasSelfCash=false면 회색
      '<td class="' + selfCashCellCls.trim() + '"><div class="pb-cell-readonly">' + fmtMoneyFull(rowSelfCash) + '</div></td>' +
      // 현물 (계산)
      '<td><div class="pb-cell-readonly">' + fmtMoneyFull(rowInkind) + '</div></td>' +
      // 삭제
      '<td><div class="pb-row-action"><button type="button" class="pb-row-del-btn" data-row-id="' + r.id + '" title="삭제">×</button></div></td>' +
    '</tr>';
  }

  function bindRowEvents() {
    var table = document.getElementById('pb-table');
    if (!table) return;

    table.querySelectorAll('.pb-cell-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var rowId = sel.dataset.row;
        var field = sel.dataset.field;
        updateRowField(rowId, field, sel.value);
      });
    });

    table.querySelectorAll('.pb-cell-text').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var rowId = inp.dataset.row;
        var field = inp.dataset.field;
        updateRowField(rowId, field, inp.value, true /*noRerender*/);
      });
      inp.addEventListener('blur', function () {
        scheduleSave();
      });
    });

    table.querySelectorAll('.pb-cell-number').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var rowId = inp.dataset.row;
        var field = inp.dataset.field;
        var val = parseNum(inp.value);
        updateRowField(rowId, field, val, true /*noRerender, will update sums separately*/);
        // 즉시 합계만 재계산해서 UI 갱신
        updateRowDerivedDisplay(rowId);
        updateFooterTotals();
        renderBudgetSummary();
      });
      inp.addEventListener('blur', function () {
        // 포맷팅 + 저장
        var val = parseNum(inp.value);
        if (val) inp.value = fmtMoneyFull(val);
        scheduleSave();
      });
      inp.addEventListener('focus', function () {
        // 포커스 시 천단위 콤마 제거
        var val = parseNum(inp.value);
        inp.value = val ? String(val) : '';
        inp.select();
      });
    });
  }

  function updateRowField(rowId, field, value, noRerender) {
    var yd = getCurrentYearData();
    var row = yd.rows.find(function (r) { return r.id === rowId; });
    if (!row) return;
    row[field] = value;
    if (!noRerender) {
      renderTable();
      scheduleSave();
    }
  }

  function updateRowDerivedDisplay(rowId) {
    var yd = getCurrentYearData();
    var row = yd.rows.find(function (r) { return r.id === rowId; });
    if (!row) return;
    var tr = document.querySelector('tr[data-row-id="' + rowId + '"]');
    if (!tr) return;
    var readonlyCells = tr.querySelectorAll('.pb-cell-readonly');
    // 순서: 총액, 지원금(현금), 현금(자부담현금), 현물
    if (readonlyCells[0]) readonlyCells[0].textContent = fmtMoneyFull(calcRowTotal(row));
    if (readonlyCells[1]) readonlyCells[1].textContent = fmtMoneyFull(calcRowCash(row));
    if (readonlyCells[2]) readonlyCells[2].textContent = fmtMoneyFull(calcRowSelfCash(row));
    if (readonlyCells[3]) readonlyCells[3].textContent = fmtMoneyFull(calcRowInkind(row));
  }

  function updateFooterTotals() {
    var yd = getCurrentYearData();
    var totals = calcTotals(yd);
    var tfootCells = document.querySelectorAll('#pb-table tfoot tr.pb-tfoot-sum td');
    // 인덱스: 0(label colspan=6), 1~4 빈칸, 5 총액, 6 지원금, 7 현금(자부담현금), 8 현물, 9 빈칸
    if (tfootCells[5]) tfootCells[5].textContent = fmtMoneyFull(totals.total);
    if (tfootCells[6]) tfootCells[6].textContent = fmtMoneyFull(totals.cash);
    if (tfootCells[7]) tfootCells[7].textContent = fmtMoneyFull(totals.selfCash);
    if (tfootCells[8]) tfootCells[8].textContent = fmtMoneyFull(totals.inkind);
  }

  // ====================================================================
  // 예산 요약
  // ====================================================================
  function renderBudgetSummary() {
    var yd = getCurrentYearData();
    var totals = calcTotals(yd);

    // hasSelfCash 토글에 따라 자부담현금 칼럼 활성/비활성
    var project = getProject();
    var hasSelfCash = !!(project && project.hasSelfCash);
    var selfCashCols = document.querySelectorAll('.pb-budget-selfcash-col');
    selfCashCols.forEach(function (el) {
      el.classList.toggle('is-disabled', !hasSelfCash);
    });

    var cashInput = document.getElementById('pb-budget-cash');
    var selfCashInput = document.getElementById('pb-budget-selfcash');
    var inkindInput = document.getElementById('pb-budget-inkind');
    var diffCashEl = document.getElementById('pb-diff-cash');
    var diffSelfCashEl = document.getElementById('pb-diff-selfcash');
    var diffInkindEl = document.getElementById('pb-diff-inkind');

    // 자부담현금 input의 disabled 동기화
    if (selfCashInput) selfCashInput.disabled = !hasSelfCash;

    if (cashInput && document.activeElement !== cashInput) {
      cashInput.value = yd.budgetCash ? fmtMoneyFull(yd.budgetCash) : '';
    }
    if (selfCashInput && document.activeElement !== selfCashInput) {
      selfCashInput.value = yd.budgetSelfCash ? fmtMoneyFull(yd.budgetSelfCash) : '';
    }
    if (inkindInput && document.activeElement !== inkindInput) {
      inkindInput.value = yd.budgetInkind ? fmtMoneyFull(yd.budgetInkind) : '';
    }

    var diffCash = (yd.budgetCash || 0) - totals.cash;
    var diffSelfCash = (yd.budgetSelfCash || 0) - totals.selfCash;
    var diffInkind = (yd.budgetInkind || 0) - totals.inkind;
    if (diffCashEl) {
      diffCashEl.textContent = fmtMoneyFull(diffCash);
      diffCashEl.classList.toggle('is-ok', diffCash >= 0);
    }
    if (diffSelfCashEl) {
      diffSelfCashEl.textContent = fmtMoneyFull(diffSelfCash);
      diffSelfCashEl.classList.toggle('is-ok', diffSelfCash >= 0);
    }
    if (diffInkindEl) {
      diffInkindEl.textContent = fmtMoneyFull(diffInkind);
      diffInkindEl.classList.toggle('is-ok', diffInkind >= 0);
    }
  }

  function bindBudgetInputs() {
    var cashInput = document.getElementById('pb-budget-cash');
    var selfCashInput = document.getElementById('pb-budget-selfcash');
    var inkindInput = document.getElementById('pb-budget-inkind');
    [cashInput, selfCashInput, inkindInput].forEach(function (inp) {
      if (!inp) return;
      inp.addEventListener('focus', function () {
        var v = parseNum(inp.value);
        inp.value = v ? String(v) : '';
        inp.select();
      });
      inp.addEventListener('input', function () {
        var yd = getCurrentYearData();
        var v = parseNum(inp.value);
        if (inp.id === 'pb-budget-cash') yd.budgetCash = v;
        else if (inp.id === 'pb-budget-selfcash') yd.budgetSelfCash = v;
        else yd.budgetInkind = v;
        // 차액만 갱신
        var totals = calcTotals(yd);
        var diffCash = (yd.budgetCash || 0) - totals.cash;
        var diffSelfCash = (yd.budgetSelfCash || 0) - totals.selfCash;
        var diffInkind = (yd.budgetInkind || 0) - totals.inkind;
        var diffCashEl = document.getElementById('pb-diff-cash');
        var diffSelfCashEl = document.getElementById('pb-diff-selfcash');
        var diffInkindEl = document.getElementById('pb-diff-inkind');
        if (diffCashEl) {
          diffCashEl.textContent = fmtMoneyFull(diffCash);
          diffCashEl.classList.toggle('is-ok', diffCash >= 0);
        }
        if (diffSelfCashEl) {
          diffSelfCashEl.textContent = fmtMoneyFull(diffSelfCash);
          diffSelfCashEl.classList.toggle('is-ok', diffSelfCash >= 0);
        }
        if (diffInkindEl) {
          diffInkindEl.textContent = fmtMoneyFull(diffInkind);
          diffInkindEl.classList.toggle('is-ok', diffInkind >= 0);
        }
      });
      inp.addEventListener('blur', function () {
        var v = parseNum(inp.value);
        inp.value = v ? fmtMoneyFull(v) : '';
        scheduleSave();
      });
    });
  }

  // ====================================================================
  // Firestore: 로드
  // ====================================================================
  function loadBudgetData() {
    if (!state.projectId || !isFirestoreReady()) {
      state.yearsData = {};
      renderAll();
      return;
    }
    setLoading(true);
    state.yearsData = {};

    var project = getProject();
    var years = getProjectYears(project);

    // 각 연차 문서를 모두 로드
    var promises = years.map(function (y) {
      var docId = state.projectId + '_year' + y.yearIndex;
      return db().collection(BUDGET_COLL).doc(docId).get().then(function (snap) {
        if (snap.exists) {
          var d = snap.data() || {};
          state.yearsData[y.yearIndex] = {
            rows: Array.isArray(d.rows) ? d.rows : [],
            period: d.period || {
              startDate: y.startDate, endDate: y.endDate, months: y.months,
            },
            budgetCash: d.budgetCash || 0,
            budgetSelfCash: d.budgetSelfCash || 0,
            budgetInkind: d.budgetInkind || 0,
          };
        }
      }).catch(function (e) {
        console.error('예산 로드 실패 (year' + y.yearIndex + '):', e);
      });
    });

    Promise.all(promises).then(function () {
      setLoading(false);
      // 첫 연차 자동 선택
      if (!state.yearsData[state.yearIndex] && years.length > 0) {
        state.yearIndex = years[0].yearIndex;
      }
      renderAll();
    });
  }

  // ====================================================================
  // Firestore: 저장
  // ====================================================================
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      saveBudgetData();
    }, 400);

    // 표 내보내기 미리보기도 동시에 갱신 (디바운스)
    if (state.exportRefreshTimer) clearTimeout(state.exportRefreshTimer);
    state.exportRefreshTimer = setTimeout(function () {
      if (typeof window.__pbExportRefresh === 'function') {
        window.__pbExportRefresh();
      }
    }, 250);
  }

  function saveBudgetData() {
    if (!state.projectId || !isFirestoreReady()) return;

    var project = getProject();
    var years = getProjectYears(project);
    var batch = db().batch();
    var hasAny = false;

    years.forEach(function (y) {
      var yd = state.yearsData[y.yearIndex];
      if (!yd) return; // 빈 연차는 저장 안 함
      var docId = state.projectId + '_year' + y.yearIndex;
      batch.set(db().collection(BUDGET_COLL).doc(docId), {
        projectId: state.projectId,
        yearIndex: y.yearIndex,
        period: {
          startDate: y.startDate,
          endDate: y.endDate,
          months: y.months,
        },
        rows: yd.rows || [],
        budgetCash: yd.budgetCash || 0,
        budgetSelfCash: yd.budgetSelfCash || 0,
        budgetInkind: yd.budgetInkind || 0,
        updatedAt: new Date().toISOString(),
      });
      hasAny = true;
    });

    if (!hasAny) {
      showSaveIndicator('변경 없음');
      return;
    }

    batch.commit().then(function () {
      showSaveIndicator('저장됨 ✓');
    }).catch(function (e) {
      console.error('예산 저장 실패:', e);
      showSaveIndicator('저장 실패 ⚠️');
      toast('저장 실패: ' + e.message, true);
    });
  }

  // 명시적 저장 버튼
  function saveBudgetDataExplicit() {
    if (!state.projectId) {
      toast('과제를 먼저 선택해주세요.', true);
      return;
    }
    if (!isFirestoreReady()) {
      toast('Firestore 연결되지 않았습니다.', true);
      return;
    }
    saveBudgetData();
    toast('저장되었습니다.');
  }

  // ====================================================================
  // 이전 연차 복사
  // ====================================================================
  function copyPreviousYear() {
    var prevYi = state.yearIndex - 1;
    if (prevYi < 1) {
      toast('이전 연차가 없습니다.', true);
      return;
    }
    var prev = state.yearsData[prevYi];
    if (!prev || !prev.rows || prev.rows.length === 0) {
      toast(prevYi + '차년도 데이터가 비어있습니다.', true);
      return;
    }
    var yd = getCurrentYearData();
    if (yd.rows.length > 0) {
      if (!confirm('현재 연차에 ' + yd.rows.length + '행이 있습니다. 덮어쓰시겠어요?')) return;
    }
    // 깊은 복사 + 새 ID 부여
    yd.rows = prev.rows.map(function (r) {
      return {
        id: uid('row'),
        type: r.type,
        newOrExisting: r.newOrExisting,
        cashOrInkind: r.cashOrInkind,
        personId: r.personId || '',
        personName: r.personName || '',
        role: r.role || '',
        threeOrFiveGong: r.threeOrFiveGong || '',
        position: r.position || '',
        monthlySalary: r.monthlySalary || 0,
        actualPay: r.actualPay || 0,
        rate: r.rate || 0,
        // 참여개월은 새 연차의 기간으로 갱신
        participMonths: yd.period.months || r.participMonths || 0,
      };
    });
    yd.budgetCash = prev.budgetCash || 0;
    yd.budgetSelfCash = prev.budgetSelfCash || 0;
    yd.budgetInkind = prev.budgetInkind || 0;
    renderTable();
    scheduleSave();
    toast(prevYi + '차년도에서 ' + yd.rows.length + '행 복사됨');
  }

  // ====================================================================
  // 인건비 예상 탭에 분배
  // ====================================================================
  function distributeToLabor() {
    if (!state.projectId || !isFirestoreReady()) {
      toast('과제를 먼저 선택해주세요.', true);
      return;
    }
    var yd = getCurrentYearData();
    if (!yd || !yd.rows || yd.rows.length === 0) {
      toast('분배할 행이 없습니다.', true);
      return;
    }
    var period = yd.period;
    if (!period || !period.startDate || !period.endDate) {
      toast('연차 기간 정보가 없습니다.', true);
      return;
    }

    // 분배 대상 행: personId 가 있는 행 (인력 매핑된 행만 인건비 예상에 들어감)
    var mappableRows = yd.rows.filter(function (r) { return r.personId && r.rate > 0; });
    if (mappableRows.length === 0) {
      toast('인력 매핑된 행이 없습니다. (성명 옆 🔍로 인력 선택)', true);
      return;
    }

    var ymList = getYmListInRange(period.startDate, period.endDate);
    if (ymList.length === 0) {
      toast('해당 연차의 월 범위를 계산할 수 없습니다.', true);
      return;
    }

    if (!confirm(
      state.yearIndex + '차년도 ' + mappableRows.length + '명의 데이터를\n' +
      '인건비 예상 탭에 분배합니다.\n\n' +
      '대상 월: ' + ymList[0] + ' ~ ' + ymList[ymList.length - 1] + ' (' + ymList.length + '개월)\n' +
      '※ 기존 예상 탭 데이터의 같은 인력·월 셀은 덮어쓰여집니다.\n\n계속하시겠어요?'
    )) return;

    setLoading(true);

    var plannedDocRef = db().collection(LABOR_COLL).doc(state.projectId + '_planned');
    var metaDocRef = db().collection(LABOR_COLL).doc(state.projectId + '_meta');

    Promise.all([
      plannedDocRef.get(),
      metaDocRef.get(),
    ]).then(function (snaps) {
      var plannedData = snaps[0].exists ? (snaps[0].data() || {}) : {};
      var metaData = snaps[1].exists ? (snaps[1].data() || {}) : {};
      var cells = plannedData.cells || {};
      var personIds = Array.isArray(metaData.personIds) ? metaData.personIds.slice() : [];

      mappableRows.forEach(function (r) {
        var participMonths = parseNum(r.participMonths) || ymList.length;
        // 참여 개월 수만큼 앞에서부터 월 채움 (기간 초과 시 잘림)
        var monthsToFill = Math.min(participMonths, ymList.length);
        var rate = parseNum(r.rate);
        var monthlyCash = 0;
        var monthlySelfCash = 0;
        var monthlyInkind = 0;
        var monthlyAmount = Math.round(parseNum(r.actualPay) * (rate / 100));
        if (r.cashOrInkind === '현금') {
          monthlyCash = monthlyAmount;
        } else if (r.cashOrInkind === '자부담현금') {
          monthlySelfCash = monthlyAmount;
        } else {
          monthlyInkind = monthlyAmount;
        }

        for (var i = 0; i < monthsToFill; i++) {
          var ym = ymList[i];
          var key = state.projectId + '_' + ym + '_' + r.personId;
          cells[key] = {
            rate: rate,
            cash: monthlyCash,
            selfCash: monthlySelfCash,
            inkind: monthlyInkind,
            memo: cells[key] && cells[key].memo ? cells[key].memo : '',
          };
        }

        // personIds 에 추가
        if (personIds.indexOf(r.personId) === -1) {
          personIds.push(r.personId);
        }
      });

      var batch = db().batch();
      batch.set(plannedDocRef, {
        cells: cells,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      batch.set(metaDocRef, {
        personIds: personIds,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      return batch.commit();
    }).then(function () {
      setLoading(false);
      toast('✓ 인건비 예상 탭에 ' + mappableRows.length + '명, ' + ymList.length + '개월 분배 완료');
    }).catch(function (e) {
      setLoading(false);
      console.error('분배 실패:', e);
      toast('분배 실패: ' + e.message, true);
    });
  }

  // ====================================================================
  // 인력 검색 모달
  // ====================================================================
  function openPersonModal(rowId) {
    state.modalRowId = rowId;
    var overlay = document.getElementById('pb-person-modal');
    var search = document.getElementById('pb-modal-search');
    if (!overlay) return;
    overlay.hidden = false;
    if (search) {
      search.value = '';
      setTimeout(function () { search.focus(); }, 50);
    }
    renderPersonModalList('');
  }

  function closePersonModal() {
    var overlay = document.getElementById('pb-person-modal');
    if (overlay) overlay.hidden = true;
    state.modalRowId = null;
  }

  function renderPersonModalList(query) {
    var list = document.getElementById('pb-modal-result-list');
    if (!list) return;
    var q = (query || '').trim().toLowerCase();

    // 현재 선택된 프로젝트의 회사 (같은 회사 인력만 후보로 노출)
    var currentProject = getProject();
    var projCompany = currentProject ? currentProject.company : '';

    var matches = _allPersons.filter(function (p) {
      if (!p) return false;
      // 회사 제한: 프로젝트에 회사가 지정되어 있으면 같은 회사만
      if (projCompany && p.company !== projCompany) return false;
      if (!q) return true;
      return ((p.name || '').toLowerCase().indexOf(q) !== -1);
    });

    if (matches.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:1.5rem; color:#94a3b8; font-size:0.85rem;">' +
        (q ? '검색 결과가 없습니다.' : '등록된 인력이 없습니다.') + '</div>';
      return;
    }

    list.innerHTML = matches.slice(0, 50).map(function (p) {
      var badges = '';
      if (p.isYouth) badges += '<span style="font-size:0.65rem; padding:0.1rem 0.35rem; border-radius:999px; background:#ede9fe; color:#5b21b6; margin-left:0.3rem;">청년</span>';
      if (p.isNew) badges += '<span style="font-size:0.65rem; padding:0.1rem 0.35rem; border-radius:999px; background:#dbeafe; color:#1e40af; margin-left:0.3rem;">신규</span>';
      var salary = p.monthlySalary ? fmtMoneyFull(p.monthlySalary) + '원/월' : '-';
      return '<div class="pb-modal-person-row" data-person-id="' + escapeHtml(p.id) + '">' +
        '<div class="pb-modal-person-name">' + escapeHtml(p.name || '(이름없음)') + badges + '</div>' +
        '<div class="pb-modal-person-salary">' + salary + '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.pb-modal-person-row').forEach(function (el) {
      el.addEventListener('click', function () {
        var pid = el.dataset.personId;
        selectPerson(pid);
      });
    });
  }

  function selectPerson(personId) {
    var person = _allPersons.find(function (p) { return p.id === personId; });
    if (!person) return;
    if (!state.modalRowId) return;
    var yd = getCurrentYearData();
    var row = yd.rows.find(function (r) { return r.id === state.modalRowId; });
    if (!row) return;
    row.personId = person.id;
    row.personName = person.name || '';
    if (person.monthlySalary && !row.monthlySalary) {
      row.monthlySalary = person.monthlySalary;
    }
    if (person.monthlySalary && !row.actualPay) {
      row.actualPay = person.monthlySalary;
    }
    // 기존/신규
    row.newOrExisting = person.isNew ? '신규' : '기존';
    closePersonModal();
    renderTable();
    scheduleSave();
  }

  // ====================================================================
  // 전체 렌더링
  // ====================================================================
  function renderAll() {
    populateProjectSelect();
    renderYearTabs();
    renderTable();

    // 안내 배너
    var banner = document.getElementById('pb-info-banner');
    var bannerText = document.getElementById('pb-info-text');
    var project = getProject();
    if (banner && bannerText) {
      if (!state.projectId) {
        banner.style.display = 'none';
      } else if (!project) {
        banner.style.display = 'none';
      } else {
        var status = project.status || '';
        if (status === '선정' || status === '수행') {
          banner.style.display = 'flex';
          banner.className = 'pb-info-banner pb-info-banner--blue';
          bannerText.innerHTML = '이 과제는 <strong>' + escapeHtml(status) + '</strong> 상태입니다. 예산을 수정한 후 <strong>⚡ 인건비 예상 분배</strong>를 실행하면 인건비 예상 탭에 반영됩니다.';
        } else {
          banner.style.display = 'flex';
          banner.className = 'pb-info-banner';
          bannerText.innerHTML = '제안 단계 (<strong>' + escapeHtml(status || '미지정') + '</strong>) 과제의 인건비 예산입니다. 선정 후 분배 버튼으로 인건비 예상 탭에 반영하세요.';
        }
      }
    }

    // 표 내보내기 모듈에 갱신 알림
    if (typeof window.__pbExportRefresh === 'function') {
      window.__pbExportRefresh();
    }
  }

  // ====================================================================
  // Firestore 구독
  // ====================================================================
  function loadProjects() {
    if (window.firestoreService && typeof window.firestoreService.subscribeProjects === 'function') {
      window.firestoreService.subscribeProjects(function (projects) {
        _allProjects = Array.isArray(projects) ? projects : [];
        filterProjectsForBudget();
        populateProjectSelect();
        // 첫 로드 시 자동 선택 안 함 (사용자가 명시적으로 선택)
        renderAll();
      });
    } else {
      renderAll();
    }
  }

  function loadPersons() {
    if (window.firestoreService && typeof window.firestoreService.subscribePersons === 'function') {
      window.firestoreService.subscribePersons(function (persons) {
        _allPersons = Array.isArray(persons) ? persons : [];
      });
    }
  }

  // ====================================================================
  // 이벤트 바인딩
  // ====================================================================
  function bindEvents() {
    // 과제 선택
    var projSel = document.getElementById('pb-project-select');
    if (projSel) {
      projSel.addEventListener('change', function () {
        state.projectId = projSel.value;
        state.yearIndex = 1;
        loadBudgetData();
      });
    }

    // 회사 필터 칩
    var companyChips = document.getElementById('pb-company-chips');
    if (companyChips) {
      companyChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.company-chip');
        if (!btn) return;
        var c = btn.dataset.company || '';
        if (c === state.company) return;
        state.company = c;
        saveCompanyFilter(c);
        companyChips.querySelectorAll('.company-chip').forEach(function (b) {
          b.classList.toggle('is-active', (b.dataset.company || '') === c);
        });
        // 프로젝트 다시 필터 → 셀렉트 갱신 → 첫 프로젝트로
        filterProjectsForBudget();
        populateProjectSelect();
        var proj = getProject();
        if (proj) {
          state.projectId = proj.id;
          state.yearIndex = 1;
          loadBudgetData();
        } else {
          state.projectId = '';
          state.yearsData = {};
          renderAll();
        }
      });
    }

    // 액션 버튼
    var copyBtn = document.getElementById('pb-copy-prev-year-btn');
    if (copyBtn) copyBtn.addEventListener('click', copyPreviousYear);

    var distBtn = document.getElementById('pb-distribute-btn');
    if (distBtn) distBtn.addEventListener('click', distributeToLabor);

    var saveBtn = document.getElementById('pb-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveBudgetDataExplicit);

    // 자부담 현금 사용 체크박스 (과제별 설정, 즉시 저장)
    var selfCashCb = document.getElementById('pb-has-self-cash');
    if (selfCashCb) {
      selfCashCb.addEventListener('change', function () {
        var project = getProject();
        if (!project) return;
        var next = !!selfCashCb.checked;
        if (!!project.hasSelfCash === next) return; // 변화 없음

        // _allProjects 안의 객체 직접 mutate (filteredProjects와 동일 참조)
        project.hasSelfCash = next;

        // 예산표 + 행 단위(드롭다운 옵션/합계 셀) 모두 갱신
        renderTable();

        if (window.firestoreService && typeof window.firestoreService.saveProjects === 'function') {
          window.firestoreService.saveProjects(_allProjects, {
            reason: 'project-budget: hasSelfCash toggled to ' + next + ' (projectId=' + project.id + ')'
          }).catch(function (e) {
            console.error('hasSelfCash 저장 실패:', e);
            // 실패 시 UI 롤백
            project.hasSelfCash = !next;
            selfCashCb.checked = !next;
            renderTable();
            alert('자부담 현금 설정 저장에 실패했습니다.');
          });
        }
      });
    }

    // 인력 검색 모달
    var modalClose = document.getElementById('pb-modal-close');
    var modalCancel = document.getElementById('pb-modal-cancel');
    if (modalClose) modalClose.addEventListener('click', closePersonModal);
    if (modalCancel) modalCancel.addEventListener('click', closePersonModal);

    var modalSearch = document.getElementById('pb-modal-search');
    if (modalSearch) {
      modalSearch.addEventListener('input', function () {
        renderPersonModalList(modalSearch.value);
      });
    }

    var modalOverlay = document.getElementById('pb-person-modal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closePersonModal();
      });
    }

    // Esc로 모달 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var ov = document.getElementById('pb-person-modal');
        if (ov && !ov.hidden) closePersonModal();
      }
    });

    // 예산 입력 이벤트
    bindBudgetInputs();
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    bindEvents();

    // 회사 칩 초기 상태 동기화 (localStorage 복원값)
    var companyChips = document.getElementById('pb-company-chips');
    if (companyChips) {
      companyChips.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === state.company);
      });
    }

    // ----- 표 내보내기 모듈에 데이터 액세스 API 노출 -----
    // project-budget-export.js 가 이 API를 통해 현재 화면 상태를 읽음.
    window.__pbExport = {
      getProject: function () {
        return getProject();
      },
      getCurrentYear: function () {
        var project = getProject();
        if (!project) return null;
        var years = getProjectYears(project);
        var ybMeta = years.find(function (y) { return y.yearIndex === state.yearIndex; });
        if (!ybMeta) return null;
        return {
          yearIndex: state.yearIndex,
          period: {
            startDate: ybMeta.startDate,
            endDate: ybMeta.endDate,
            months: ybMeta.months,
          },
        };
      },
      getRows: function () {
        var yd = state.yearsData[state.yearIndex];
        return (yd && yd.rows) ? yd.rows.slice() : [];
      },
      getPersonById: function (id) {
        return _allPersons.find(function (p) { return p.id === id; }) || null;
      },
      getAllPersons: function () {
        return _allPersons.slice();
      },
    };

    loadProjects();
    loadPersons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

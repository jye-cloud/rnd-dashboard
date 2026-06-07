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
 *            monthlySalary, actualPay, rate, participMonths,
 *            salarySlot }   // C6 2단계: 불러온 연봉 항목 기억(숫자만 분배에 쓰여 무영향)
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
  // C6 2단계 — 연봉 프로파일(공유 슬롯) 예산 불러오기
  //   · persons.salarySlots = { 슬롯명: 연봉(원) }, 월급 = ceil(연봉/12)
  //   · '실제' = annualSalary(없으면 monthlySalary 폴백) → 항상 존재
  //   · 빈 슬롯 = 실제 폴백. 폴백 정책 = 하이브리드(차단+경고+실제로 채우기)
  //   · 행에 row.salarySlot(문자열) 기억 — 숫자만 분배/C1/내보내기에 쓰여 무영향
  // ====================================================================
  var DEFAULT_SALARY_SLOTS = ['제안서용(공개 가능)'];
  var SLOT_ACTUAL = '__actual__';   // 셀렉트 값: 실제 연봉(예약, 슬롯명과 충돌 없음)

  // 가용 슬롯 = 기본 ∪ 전 인력 salarySlots 키 (정렬: 기본 먼저, 그 외 가나다)
  // persons-master.getAvailableSlotNames 와 동일 로직
  function getAvailableSlotNames() {
    var seen = {};
    var defaults = [];
    DEFAULT_SALARY_SLOTS.forEach(function (n) { if (!seen[n]) { seen[n] = 1; defaults.push(n); } });
    var others = [];
    (_allPersons || []).forEach(function (p) {
      var slots = p && p.salarySlots;
      if (slots && typeof slots === 'object') {
        Object.keys(slots).forEach(function (k) {
          if (k && k !== '실제' && !seen[k]) { seen[k] = 1; others.push(k); }
        });
      }
    });
    others.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    return defaults.concat(others);
  }

  function findPerson(personId) {
    if (!personId) return null;
    return _allPersons.find(function (p) { return p && p.id === personId; }) || null;
  }

  // 실제 연봉의 월급 = monthlySalary 우선, 없으면 ceil(annualSalary/12)
  function getPersonActualMonthly(p) {
    if (!p) return 0;
    if (p.monthlySalary != null && !isNaN(p.monthlySalary)) return Math.ceil(p.monthlySalary);
    if (p.annualSalary != null && !isNaN(p.annualSalary)) return Math.ceil(p.annualSalary / 12);
    return 0;
  }

  // 실제 '연봉'(급여총액에 넣을 값) = annualSalary 우선, 없으면 monthlySalary*12
  function getPersonActualAnnual(p) {
    if (!p) return 0;
    if (p.annualSalary != null && !isNaN(p.annualSalary)) return Math.round(Number(p.annualSalary));
    if (p.monthlySalary != null && !isNaN(p.monthlySalary)) return Math.round(Number(p.monthlySalary) * 12);
    return 0;
  }

  // 월급 = ceil(연봉/12). 마스터 페이지와 동일(원 단위 올림 → …334/…667).
  //   예: 100,504,000 / 12 = 8,375,333.33 → 8,375,334
  function monthlyFromAnnual(annual) {
    var a = Number(annual) || 0;
    return a > 0 ? Math.ceil(a / 12) : 0;
  }

  // 슬롯 월급. slotName === SLOT_ACTUAL → 실제. 그 외 → salarySlots[slotName] 의 ceil/12.
  // 반환값:
  //   { monthly: 숫자 }        — 불러올 값 있음
  //   { monthly: null, fallback: true } — 슬롯 비어 실제로 폴백해야 함(하이브리드 차단 대상)
  function getSlotMonthly(p, slotName) {
    if (!p) return { monthly: null, annual: null, fallback: false };
    if (!slotName || slotName === SLOT_ACTUAL) {
      return { monthly: getPersonActualMonthly(p), annual: getPersonActualAnnual(p), fallback: false };
    }
    var slots = (p.salarySlots && typeof p.salarySlots === 'object') ? p.salarySlots : {};
    var v = slots[slotName];
    if (v != null && !isNaN(v) && Number(v) > 0) {
      return { monthly: Math.ceil(Number(v) / 12), annual: Math.round(Number(v)), fallback: false };
    }
    // 슬롯 비어 있음 → 실제로 폴백해야 하는 상태(차단)
    return { monthly: null, annual: null, fallback: true };
  }

  // 슬롯이 지정된 인력 행인데 슬롯 값이 비어(실제 폴백) 아직 급여가 0인 상태 = 경고 대상
  function isRowSalaryFallbackPending(r) {
    if (!r || !r.personId) return false;
    if (!r.salarySlot || r.salarySlot === SLOT_ACTUAL) return false;
    var p = findPerson(r.personId);
    if (!p) return false;
    var res = getSlotMonthly(p, r.salarySlot);
    if (!res.fallback) return false;       // 슬롯 값이 있으면 폴백 아님
    return !parseNum(r.monthlySalary);     // 이미 채워졌으면(수동/실제로 채우기) 경고 해제
  }

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
    // 총액 직접 입력값(totalOverride)이 있으면 우선. 비우면(0/없음) 자동계산.
    if (row.totalOverride != null && Number(row.totalOverride) > 0) {
      return Math.round(Number(row.totalOverride));
    }
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
    var salaryBar = document.getElementById('pb-salary-load-bar');

    var project = getProject();
    if (!project) {
      if (emptyEl) emptyEl.style.display = 'block';
      if (titleEl) titleEl.style.display = 'none';
      if (wrapEl) wrapEl.style.display = 'none';
      if (summaryEl) summaryEl.style.display = 'none';
      if (optionsEl) optionsEl.style.display = 'none';
      if (salaryBar) salaryBar.style.display = 'none';
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
      if (salaryBar) salaryBar.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (titleEl) titleEl.style.display = 'flex';
    if (wrapEl) wrapEl.style.display = 'block';
    if (summaryEl) summaryEl.style.display = 'flex';
    if (salaryBar) salaryBar.style.display = 'flex';

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
    var tfootSelfCashCls = '';   // 자부담현금 합계 항상 정상
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

    // C6 2단계 — 슬롯 셀렉트 채우기 + 폴백 경고 상태 갱신
    populateSlotSelect();
    updateSalaryBarState();
  }

  function renderRow(r, labelPrefix) {
    var clsRow = 'pb-row-' + (
      r.type === 'youth_required' ? 'youth-req' :
      r.type === 'youth_additional' ? 'youth-add' : 'normal'
    );
    // C2 §4.8: 3책5공 관리 과제의 책임자 행 색 강조
    var _projForMgr = getProject();
    if (_projForMgr && _projForMgr.is3ch5gManaged && r.personId && r.personId === _projForMgr.managerPersonId) {
      clsRow += ' pb-row-manager';
    }
    // C6 2단계: 슬롯 비어 실제 폴백 대기 중인 행 경고색
    if (isRowSalaryFallbackPending(r)) {
      clsRow += ' pb-row-salary-fallback';
    }
    var nameDisplay = r.personName || '';
    var rowTotal = calcRowTotal(r);
    var rowCash = calcRowCash(r);
    var rowSelfCash = calcRowSelfCash(r);
    var rowInkind = calcRowInkind(r);

    // hasSelfCash=false면 자부담현금 옵션/셀을 비활성 시각
    // (단, 행이 이미 '자부담현금' 값을 갖고 있으면 옵션은 살려두기 — 모순 방지)
    var project = getProject();
    var hasSelfCash = !!(project && project.hasSelfCash);
    var allowSelfCashOption = true;   // 자부담현금은 항상 입력 가능(별도/합산 무관). 체크박스는 표시 방식만.
    var selfCashDisabledAttr = '';
    var selfCashCellCls = '';         // 자부담현금 셀 항상 정상(비활성 회색 제거)

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
      // 급여총액 (수정 가능, 강조) — 인력 지정 행은 위에 연봉 항목 드롭다운(C6 2단계)
      '<td class="td-input">' +
        (r.personId
          ? '<select class="pb-row-slot-select" data-row="' + r.id + '" title="이 인력의 연봉 항목 선택">' + buildRowSlotOptions(r.salarySlot) + '</select>'
          : '') +
        '<input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="monthlySalary" value="' + (r.monthlySalary ? fmtMoneyFull(r.monthlySalary) : '') + '" placeholder="0" inputmode="numeric">' +
      '</td>' +
      // 실지급액 (수정 가능, 노랑)
      '<td class="td-input-yellow"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="actualPay" value="' + (r.actualPay ? fmtMoneyFull(r.actualPay) : '') + '" placeholder="0" inputmode="numeric"></td>' +
      // 참여율
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="rate" value="' + (r.rate || '') + '" placeholder="0" inputmode="decimal"></td>' +
      // 참여개월
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="participMonths" value="' + (r.participMonths || '') + '" placeholder="0" inputmode="numeric"></td>' +
      // 총액 (직접 입력 가능 — 비우면 실지급액×참여율×참여개월 자동계산)
      '<td class="td-input"><input type="text" class="pb-cell-number" data-row="' + r.id + '" data-field="totalOverride" value="' + (rowTotal ? fmtMoneyFull(rowTotal) : '') + '" placeholder="자동" inputmode="numeric"></td>' +
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

    // C6 2단계 — 행별 연봉 항목 셀렉트
    table.querySelectorAll('.pb-row-slot-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        applySlotToRow(sel.dataset.row, sel.value);
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
        // 급여총액(연봉) 입력 → 실지급액(월급) 자동계산 = ceil(연봉/12). 마스터 페이지와 동일.
        if (field === 'monthlySalary') {
          var monthly = monthlyFromAnnual(val);
          updateRowField(rowId, 'actualPay', monthly, true);
          var payInp = document.querySelector('.pb-cell-number[data-row="' + rowId + '"][data-field="actualPay"]');
          if (payInp && document.activeElement !== payInp) {
            payInp.value = monthly ? fmtMoneyFull(monthly) : '';
          }
        }
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
    // 총액 입력칸: 포커스 중 아닐 때만 calcRowTotal(override 또는 자동) 표시
    var totalInput = tr.querySelector('.pb-cell-number[data-field="totalOverride"]');
    if (totalInput && document.activeElement !== totalInput) {
      var t = calcRowTotal(row);
      totalInput.value = t ? fmtMoneyFull(t) : '';
    }
    var readonlyCells = tr.querySelectorAll('.pb-cell-readonly');
    // 이제 readonly는 지원금/현금/현물 3개 (총액은 입력칸으로 분리됨)
    if (readonlyCells[0]) readonlyCells[0].textContent = fmtMoneyFull(calcRowCash(row));
    if (readonlyCells[1]) readonlyCells[1].textContent = fmtMoneyFull(calcRowSelfCash(row));
    if (readonlyCells[2]) readonlyCells[2].textContent = fmtMoneyFull(calcRowInkind(row));
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
    // 자부담현금 칼럼: 항상 정상(비활성 회색 제거). 체크박스는 별도/합산 표시만 결정.
    var selfCashCols = document.querySelectorAll('.pb-budget-selfcash-col');
    selfCashCols.forEach(function (el) {
      el.classList.remove('is-disabled');
    });

    var cashInput = document.getElementById('pb-budget-cash');
    var selfCashInput = document.getElementById('pb-budget-selfcash');
    var inkindInput = document.getElementById('pb-budget-inkind');
    var diffCashEl = document.getElementById('pb-diff-cash');
    var diffSelfCashEl = document.getElementById('pb-diff-selfcash');
    var diffInkindEl = document.getElementById('pb-diff-inkind');

    // 자부담현금 input: 항상 입력 가능 (별도/합산 무관)
    if (selfCashInput) selfCashInput.disabled = false;

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

    // 합산(자부담 별도 OFF) 보기 줄 — 입력 핸들러에서도 같이 부르려고 함수로 분리
    renderCombinedNote(yd, diffCash, diffSelfCash);
  }

  // 합산(hasSelfCash=false) 모드에서 예산 요약 아래 '현금 합계 + 환급기준/환급가능(지원금)' 줄 갱신.
  // 별도 모드면 숨김. renderBudgetSummary + 예산 입력 핸들러 양쪽에서 호출(입력 즉시 반영).
  function renderCombinedNote(yd, diffCash, diffSelfCash) {
    var summaryWrap = document.getElementById('pb-budget-summary');
    if (!summaryWrap) return;
    var project = getProject();
    var hasSelfCash = !!(project && project.hasSelfCash);
    var note = document.getElementById('pb-combined-note');
    if (hasSelfCash) { if (note) note.style.display = 'none'; return; }

    var cashBudgetSum = (yd.budgetCash || 0) + (yd.budgetSelfCash || 0);
    var cashDiffSum   = (diffCash || 0) + (diffSelfCash || 0);
    var refundable    = Math.max(0, diffCash || 0);   // 환급 가능 = 지원금 차액(음수면 0)
    var noteHtml =
      '<div style="margin-top:0.5rem; padding:0.5rem 0.65rem; background:#f8fafc; border:1px solid var(--border-color,#e5e7eb); border-radius:0.45rem; font-size:0.82rem; line-height:1.65;">' +
        '<strong>합산 보기 — 현금 = 지원금 + 자부담</strong><br>' +
        '현금 예산 <strong>' + fmtMoneyFull(cashBudgetSum) + '원</strong> ' +
        '<span style="opacity:0.65;">└ 환급기준(지원금) ' + fmtMoneyFull(yd.budgetCash || 0) + '원</span><br>' +
        '현금 차액 <strong>' + fmtMoneyFull(cashDiffSum) + '원</strong> ' +
        '<span style="opacity:0.65;">└ 환급 가능(지원금) ' + fmtMoneyFull(refundable) + '원</span>' +
      '</div>';
    if (!note) {
      note = document.createElement('div');
      note.id = 'pb-combined-note';
      summaryWrap.appendChild(note);
    }
    note.style.display = '';
    note.innerHTML = noteHtml;
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
        // 합산 보기 줄도 즉시 갱신 (저장/페이지 이동 없이 반영)
        renderCombinedNote(yd, diffCash, diffSelfCash);
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
            // 기간은 항상 최신 연차(yearBudgets) 기준 — 문서에 저장된 옛 period(연차 날짜 수정 전 값)는 신뢰하지 않음.
            // (이전엔 d.period를 우선 써서, 연차 탭은 2025인데 전송은 문서의 묵은 2026 기간으로 나가던 버그.)
            period: {
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
      }, { merge: true });   // merge: 인건비 페이지에서 넣은 carryoverCash/SelfCash(이월금) 보존
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
        salarySlot: r.salarySlot || '',
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
  // C6 2단계 — 슬롯 불러오기 UI 동작
  // ====================================================================

  // 툴바 슬롯 셀렉트 채우기 (실제 연봉 + 가용 슬롯). 현재 선택 보존.
  function populateSlotSelect() {
    var sel = document.getElementById('pb-salary-slot-select');
    if (!sel) return;
    var prev = sel.value || SLOT_ACTUAL;
    var names = getAvailableSlotNames();
    var html = '<option value="' + SLOT_ACTUAL + '">실제 연봉</option>';
    names.forEach(function (n) {
      html += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
    });
    sel.innerHTML = html;
    // 이전 선택이 여전히 유효하면 유지
    var hasPrev = prev === SLOT_ACTUAL || names.indexOf(prev) !== -1;
    sel.value = hasPrev ? prev : SLOT_ACTUAL;
  }

  // 행별 슬롯 셀렉트 옵션 HTML (현재 행 선택 표시)
  function buildRowSlotOptions(selected) {
    var names = getAvailableSlotNames();
    var cur = selected || SLOT_ACTUAL;
    var html = '<option value="' + SLOT_ACTUAL + '"' + (cur === SLOT_ACTUAL ? ' selected' : '') + '>실제</option>';
    names.forEach(function (n) {
      html += '<option value="' + escapeHtml(n) + '"' + (cur === n ? ' selected' : '') + '>' + escapeHtml(n) + '</option>';
    });
    return html;
  }

  // 폴백(빈 슬롯) 경고 행 수 세기 + 바 상태 갱신
  function updateSalaryBarState() {
    var bar = document.getElementById('pb-salary-load-bar');
    if (!bar) return;
    var yd = getCurrentYearData();
    var rows = (yd && yd.rows) || [];
    var pending = rows.filter(isRowSalaryFallbackPending).length;

    var fillBtn = document.getElementById('pb-salary-fill-actual-btn');
    var hint = document.getElementById('pb-salary-hint');
    if (fillBtn) {
      if (pending > 0) {
        fillBtn.style.display = '';
        fillBtn.textContent = '빈 항목 실제로 채우기 (' + pending + ')';
      } else {
        fillBtn.style.display = 'none';
      }
    }
    if (hint) {
      hint.textContent = pending > 0
        ? '⚠️ ' + pending + '명은 선택한 항목에 연봉이 없어 비워뒀습니다(실제 연봉 유출 방지).'
        : '';
    }
  }

  // 슬롯 하나를 한 행에 적용 (행별 드롭다운 / 전체 적용 공용)
  //   반환: 'filled' | 'fallback' | 'skip'(인력 없음)
  function applySlotToRowData(row, slotName) {
    if (!row || !row.personId) return 'skip';
    var p = findPerson(row.personId);
    if (!p) return 'skip';
    row.salarySlot = slotName;
    var res = getSlotMonthly(p, slotName);
    if (res.fallback) {
      // 하이브리드 차단: 실제값 유입 막기 위해 0으로 비움
      row.monthlySalary = 0;
      row.actualPay = 0;
      return 'fallback';
    }
    var annual = res.annual || 0;
    row.monthlySalary = annual;                 // 급여총액 = 연봉(연 단위)
    row.actualPay = monthlyFromAnnual(annual);  // 실지급액 = 월급 = ceil(연봉/12)
    return 'filled';
  }

  // 행별 드롭다운 변경 → 그 행만 즉시 적용
  function applySlotToRow(rowId, slotName) {
    var yd = getCurrentYearData();
    var row = yd.rows.find(function (r) { return r.id === rowId; });
    if (!row) return;
    var result = applySlotToRowData(row, slotName);
    renderTable();
    scheduleSave();
    if (result === 'fallback') {
      toast('「' + (slotName === SLOT_ACTUAL ? '실제 연봉' : slotName) + '」 항목이 비어 있어 급여를 비웠습니다. 필요 시 실제로 채우세요.', true);
    }
  }

  // 전체 적용 — 인력이 지정된 모든 행에 선택 슬롯 적용
  function applySlotToAllRows() {
    var sel = document.getElementById('pb-salary-slot-select');
    if (!sel) return;
    var slotName = sel.value || SLOT_ACTUAL;
    var label = slotName === SLOT_ACTUAL ? '실제 연봉' : slotName;
    var yd = getCurrentYearData();
    var rows = (yd && yd.rows) || [];
    var targets = rows.filter(function (r) { return r.personId; });
    if (targets.length === 0) {
      toast('인력이 지정된 행이 없습니다. 🔍로 인력을 먼저 선택해주세요.', true);
      return;
    }
    if (!confirm('인력이 지정된 ' + targets.length + '개 행의 급여총액·실지급액을 「' + label + '」 기준으로 불러옵니다.\n기존 급여 값은 덮어쓰며, 항목이 빈 인력은 비워둡니다(나중에 "실제로 채우기" 가능). 계속할까요?')) return;

    var filled = 0, fallback = 0;
    targets.forEach(function (r) {
      var res = applySlotToRowData(r, slotName);
      if (res === 'filled') filled++;
      else if (res === 'fallback') fallback++;
    });
    renderTable();
    scheduleSave();
    var msg = '「' + label + '」 불러오기: ' + filled + '명 적용';
    if (fallback > 0) msg += ' · ' + fallback + '명 비움(항목 없음)';
    toast(msg, fallback > 0);
  }

  // 빈 항목(폴백 대기) 행을 실제 연봉으로 채우기
  function fillFallbackRowsWithActual() {
    var yd = getCurrentYearData();
    var rows = (yd && yd.rows) || [];
    var pending = rows.filter(isRowSalaryFallbackPending);
    if (pending.length === 0) return;
    if (!confirm(pending.length + '명의 빈 항목을 실제 연봉으로 채웁니다. 제안서에 실제 연봉이 노출될 수 있어요. 계속할까요?')) return;
    var n = 0;
    pending.forEach(function (r) {
      var p = findPerson(r.personId);
      if (!p) return;
      var annual = getPersonActualAnnual(p);
      r.monthlySalary = annual;                 // 급여총액 = 연봉
      r.actualPay = monthlyFromAnnual(annual);  // 실지급액 = 월급
      n++;
    });
    renderTable();
    scheduleSave();
    toast(n + '명을 실제 연봉으로 채웠습니다.');
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
      var personRoles = metaData.personRoles || {};

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
        // 분류 전달: 기존/신규 + 현금/자부담/현물 → personRoles (기존 role 필드 보존)
        var existRole = personRoles[r.personId] || {};
        personRoles[r.personId] = Object.assign({}, existRole, {
          newOrExisting: r.newOrExisting || existRole.newOrExisting || '기존',
          cashOrInkind:  r.cashOrInkind  || existRole.cashOrInkind  || '현금',
        });
      });

      // 명단 순서: 기존 순서는 그대로 보존. 새로 분배한 인력은 위 루프(personIds.push)에서 이미 맨 뒤에 추가됨.
      // personIds는 연차 공용(메타 문서)이라, 보낸 사람을 앞으로 끌어올리면 다른 연차 화면의 순서까지 흐트러짐 → 재정렬 금지.

      var batch = db().batch();
      batch.set(plannedDocRef, {
        cells: cells,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      batch.set(metaDocRef, {
        personIds: personIds,
        personRoles: personRoles,
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
  // C1-b: 선택 전송 (budget → project-labor) — 모달
  //   ① 인력 선택 ② 필드(이름만/+참여율/+금액) ③ 금액 출처(예산 vs 인건비 급여)
  //   ④ 월 범위 ⑤ 쓰기 방식(빈 셀만/덮어쓰기)
  //   - 명단(personIds)은 항상 merge. cells 는 필드가 'name'이면 손대지 않음(비파괴).
  //   - C1-a(이름만)는 이 모달의 '이름만' 필드 옵션으로 흡수됨.
  // ====================================================================
  function getSendPersonRows() {
    var yd = getCurrentYearData();
    if (!yd || !yd.rows) return [];
    var seen = {};
    return yd.rows.filter(function (r) {
      if (!r.personId || seen[r.personId]) return false;
      seen[r.personId] = true;
      return true;
    });
  }

  function openSendModal() {
    if (!state.projectId || !isFirestoreReady()) {
      toast('과제를 먼저 선택해주세요.', true);
      return;
    }
    var yd = getCurrentYearData();
    if (!yd || !yd.rows || yd.rows.length === 0) {
      toast('보낼 행이 없습니다.', true);
      return;
    }
    var rows = getSendPersonRows();
    if (rows.length === 0) {
      toast('인력 매핑된 행이 없습니다. (성명 옆 🔍로 인력 선택)', true);
      return;
    }
    var overlay = document.getElementById('pb-send-modal');
    if (!overlay) return;

    // ① 인력 목록(기본 전체 체크)
    var listEl = document.getElementById('pb-send-people');
    if (listEl) {
      listEl.innerHTML = rows.map(function (r) {
        var nm = r.personName || '(이름 없음)';
        var meta = (r.rate ? r.rate + '%' : '0%') + ' · ' + fundTypeLabel(r.cashOrInkind || '현금') +
          (r.actualPay ? ' · ' + fmtMoneyFull(r.actualPay) + '원' : '');
        return '<label class="pb-send-person">' +
          '<input type="checkbox" class="pb-send-person-cb" value="' + r.personId + '" checked>' +
          '<span class="pb-send-person-name">' + nm + '</span>' +
          '<span class="pb-send-person-meta">' + meta + '</span>' +
        '</label>';
      }).join('');
    }

    // ④ 월 범위 셀렉트 채우기
    var period = yd.period || {};
    var ymList = (period.startDate && period.endDate) ? getYmListInRange(period.startDate, period.endDate) : [];
    var startSel = document.getElementById('pb-send-start');
    var endSel = document.getElementById('pb-send-end');
    if (startSel && endSel) {
      var opts = ymList.map(function (ym) { return '<option value="' + ym + '">' + ym + '</option>'; }).join('');
      startSel.innerHTML = opts;
      endSel.innerHTML = opts;
      if (ymList.length) {
        startSel.value = ymList[0];
        endSel.value = ymList[ymList.length - 1];
      }
    }

    // 기본 옵션값 복원
    var fAmount = overlay.querySelector('input[name="pb-send-field"][value="amount"]');
    if (fAmount) fAmount.checked = true;
    var sBudget = overlay.querySelector('input[name="pb-send-source"][value="budget"]');
    if (sBudget) sBudget.checked = true;
    var mEmpty = overlay.querySelector('input[name="pb-send-mode"][value="empty"]');
    if (mEmpty) mEmpty.checked = true;

    overlay.hidden = false;
    updateSendModalUI();
  }

  function closeSendModal() {
    var overlay = document.getElementById('pb-send-modal');
    if (overlay) overlay.hidden = true;
  }

  function getSendField() {
    var el = document.querySelector('input[name="pb-send-field"]:checked');
    return el ? el.value : 'amount';
  }

  // 필드에 따라 금액 출처/월 범위 섹션 노출 + 안내문 갱신
  function updateSendModalUI() {
    var field = getSendField();
    var srcSec = document.getElementById('pb-send-source-section');
    var rngSec = document.getElementById('pb-send-range-section');
    var hint = document.getElementById('pb-send-hint');
    if (srcSec) srcSec.hidden = (field !== 'amount');     // 금액 출처는 +금액일 때만
    if (rngSec) rngSec.hidden = (field === 'name');        // 월 범위는 셀 쓸 때만
    if (hint) {
      if (field === 'name') hint.textContent = '명단만 추가합니다. 참여율·금액·기존 셀은 건드리지 않습니다.';
      else if (field === 'rate') hint.textContent = '참여율만 보냅니다(금액 0). 구분은 예산 행의 분류를 따릅니다.';
      else hint.textContent = '참여율 + 금액을 보냅니다. 구분은 예산 행의 분류를 따릅니다.';
    }
  }

  function doSendToLabor() {
    if (!state.projectId || !isFirestoreReady()) { toast('과제를 먼저 선택해주세요.', true); return; }
    var yd = getCurrentYearData();
    if (!yd) { toast('연차 데이터가 없습니다.', true); return; }

    var rowsByPid = {};
    getSendPersonRows().forEach(function (r) { rowsByPid[r.personId] = r; });

    var checked = Array.prototype.slice.call(document.querySelectorAll('.pb-send-person-cb:checked'));
    var selPids = checked.map(function (c) { return c.value; }).filter(function (pid) { return rowsByPid[pid]; });
    if (selPids.length === 0) { toast('선택된 인력이 없습니다.', true); return; }

    var field = getSendField();   // 'name' | 'rate' | 'amount'
    var sourceEl = document.querySelector('input[name="pb-send-source"]:checked');
    var amountSource = sourceEl ? sourceEl.value : 'budget';   // 'budget' | 'labor'
    var modeEl = document.querySelector('input[name="pb-send-mode"]:checked');
    var writeMode = modeEl ? modeEl.value : 'empty';            // 'empty' | 'overwrite'

    // 월 범위(셀 쓸 때만)
    var ymList = [];
    var outOfRangeYms = [];
    if (field !== 'name') {
      var period = yd.period || {};
      var fullYm = (period.startDate && period.endDate) ? getYmListInRange(period.startDate, period.endDate) : [];
      var startSel = document.getElementById('pb-send-start');
      var endSel = document.getElementById('pb-send-end');
      var s = startSel ? startSel.value : (fullYm[0] || '');
      var e = endSel ? endSel.value : (fullYm[fullYm.length - 1] || '');
      var si = fullYm.indexOf(s), ei = fullYm.indexOf(e);
      // v8.8: 시작/종료를 못 찾으면 — 예전엔 연차 전체로 폴백해서 '안 고른 달까지' 써버리는 버그가 있었음 → 안전 중단.
      if (si === -1 || ei === -1) { toast('월 범위를 인식하지 못했습니다. 시작/종료 월을 다시 선택해주세요.', true); return; }
      if (si > ei) { var t = si; si = ei; ei = t; }
      ymList = fullYm.slice(si, ei + 1);
      if (ymList.length === 0) { toast('월 범위를 확인해주세요.', true); return; }
      // v8.8: 범위 밖(안 고른) 연차 월 — 선택 인력 한정으로 0 클리어 (사용자 요청: 안 체크한 달은 0).
      var inRangeSet = {}; ymList.forEach(function (y) { inRangeSet[y] = true; });
      outOfRangeYms = fullYm.filter(function (y) { return !inRangeSet[y]; });
    }

    setLoading(true);
    var plannedRef = db().collection(LABOR_COLL).doc(state.projectId + '_planned');
    var metaRef = db().collection(LABOR_COLL).doc(state.projectId + '_meta');

    Promise.all([plannedRef.get(), metaRef.get()]).then(function (snaps) {
      var plannedData = snaps[0].exists ? (snaps[0].data() || {}) : {};
      var metaData = snaps[1].exists ? (snaps[1].data() || {}) : {};
      var cells = plannedData.cells || {};
      var personRoles = metaData.personRoles || {};
      var personIds = Array.isArray(metaData.personIds) ? metaData.personIds.slice() : [];

      var cellsWritten = 0;
      var cellsSkipped = 0;
      var cellsCleared = 0;

      selPids.forEach(function (pid) {
        var r = rowsByPid[pid];
        // 분류 전달: 기존/신규 + 현금/자부담/현물 → personRoles (기존 role 필드는 보존)
        var existRole = personRoles[pid] || {};
        personRoles[pid] = Object.assign({}, existRole, {
          newOrExisting: r.newOrExisting || existRole.newOrExisting || '기존',
          cashOrInkind:  r.cashOrInkind  || existRole.cashOrInkind  || '현금',
        });
        if (field === 'name') return;

        var rate = parseNum(r.rate);

        // 금액(원/월) 계산
        var monthlyAmount = 0;
        if (field === 'amount') {
          if (amountSource === 'labor') {
            var roles = personRoles[pid] || {};
            var eff = (typeof roles.monthlySalaryOverride === 'number' && roles.monthlySalaryOverride > 0)
              ? roles.monthlySalaryOverride
              : (laborMasterSalary(pid) || 0);
            monthlyAmount = Math.round(eff * (rate / 100));
          } else {
            monthlyAmount = Math.round(parseNum(r.actualPay) * (rate / 100));
          }
        }

        // 구분 버킷 = 예산 행 분류
        var cash = 0, selfCash = 0, inkind = 0;
        if (r.cashOrInkind === '현금') cash = monthlyAmount;
        else if (r.cashOrInkind === '자부담현금') selfCash = monthlyAmount;
        else inkind = monthlyAmount;

        ymList.forEach(function (ym) {
          var key = state.projectId + '_' + ym + '_' + pid;
          var ex = cells[key];
          var exHasData = ex && ((ex.rate || 0) > 0 || (ex.cash || 0) > 0 || (ex.selfCash || 0) > 0 || (ex.inkind || 0) > 0);
          if (writeMode === 'empty' && exHasData) { cellsSkipped++; return; }   // 비파괴: 값 있는 셀은 건너뜀
          cells[key] = {
            rate: rate,
            cash: cash,
            selfCash: selfCash,
            inkind: inkind,
            memo: (ex && ex.memo) ? ex.memo : '',   // 메모 보존
          };
          cellsWritten++;
        });
        // v8.8: 범위 밖(안 고른) 월은 0으로 비움 — 선택 인력 한정 ("고른 범위가 이 인력의 연차를 정의").
        outOfRangeYms.forEach(function (ym) {
          var okey = state.projectId + '_' + ym + '_' + pid;
          var oex = cells[okey];
          var oHad = oex && ((oex.rate || 0) > 0 || (oex.cash || 0) > 0 || (oex.selfCash || 0) > 0 || (oex.inkind || 0) > 0);
          cells[okey] = { rate: 0, cash: 0, selfCash: 0, inkind: 0, memo: (oex && oex.memo) ? oex.memo : '' };
          if (oHad) cellsCleared++;
        });
      });

      // 명단 순서: 기존 순서는 그대로 보존하고, 새로 보낸 인력(기존에 없던 사람)만 맨 뒤에 추가.
      // personIds는 연차 공용 — 보낸 사람을 앞으로 끌어올리면 다른 연차 화면의 순서까지 흐트러짐.
      var existingSet = {};
      personIds.forEach(function (p) { existingSet[p] = true; });
      selPids.forEach(function (p) { if (!existingSet[p]) { existingSet[p] = true; personIds.push(p); } });

      var batch = db().batch();
      batch.set(plannedRef, { cells: cells, updatedAt: new Date().toISOString() }, { merge: true });
      batch.set(metaRef, { personIds: personIds, personRoles: personRoles, updatedAt: new Date().toISOString() }, { merge: true });
      return batch.commit().then(function () { return { written: cellsWritten, skipped: cellsSkipped, cleared: cellsCleared }; });
    }).then(function (res) {
      var written = res.written, skipped = res.skipped, cleared = res.cleared || 0;
      setLoading(false);
      closeSendModal();
      if (field === 'name') {
        toast('✓ ' + selPids.length + '명 명단 전송 (셀 무변경)');
      } else if (written === 0 && skipped > 0) {
        // 비파괴(빈 셀만)인데 선택 인력의 셀에 이미 값이 있어 전부 건너뜀 — 소프트 경고
        toast('⚠ 기록 0개 — 선택 인력의 해당 월 셀에 이미 값이 있어 건너뜀(' + skipped + '개). 덮어쓰려면 ⑤에서 "덮어쓰기"를 선택하세요.', true);
      } else {
        toast('✓ ' + selPids.length + '명 전송 · 셀 ' + written + '개 기록'
          + (skipped > 0 ? ' · 기존값 ' + skipped + '개 건너뜀' : '')
          + (cleared > 0 ? ' · 범위 밖 ' + cleared + '개 비움' : ''));
      }
    }).catch(function (e) {
      setLoading(false);
      console.error('선택 전송 실패:', e);
      toast('전송 실패: ' + e.message, true);
    });
  }

  // 인건비 탭 급여 재계산(ⓑ)용 — 인력 마스터 월급(오버라이드는 doSendToLabor에서 _meta로 적용)
  function laborMasterSalary(personId) {
    var p = (_allPersons || []).find(function (x) { return x.id === personId; });
    return p ? (p.monthlySalary || 0) : 0;
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
    var pAnnual = getPersonActualAnnual(person);
    if (pAnnual && !row.monthlySalary) {
      row.monthlySalary = pAnnual;                       // 급여총액 = 연봉
    }
    if (pAnnual && !row.actualPay) {
      row.actualPay = monthlyFromAnnual(pAnnual);         // 실지급액 = 월급
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
        // C6 2단계: 인력(슬롯) 로드 후 툴바 셀렉트 갱신
        populateSlotSelect();
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

    // C6 2단계 — 연봉 불러오기 바
    var salaryApplyBtn = document.getElementById('pb-salary-apply-btn');
    if (salaryApplyBtn) salaryApplyBtn.addEventListener('click', applySlotToAllRows);
    var salaryFillBtn = document.getElementById('pb-salary-fill-actual-btn');
    if (salaryFillBtn) salaryFillBtn.addEventListener('click', fillFallbackRowsWithActual);
    // C1-b: 선택 전송 모달
    var sendModalBtn = document.getElementById('pb-send-modal-btn');
    if (sendModalBtn) sendModalBtn.addEventListener('click', openSendModal);
    var sendClose = document.getElementById('pb-send-modal-close');
    if (sendClose) sendClose.addEventListener('click', closeSendModal);
    var sendCancel = document.getElementById('pb-send-cancel');
    if (sendCancel) sendCancel.addEventListener('click', closeSendModal);
    var sendGo = document.getElementById('pb-send-go');
    if (sendGo) sendGo.addEventListener('click', doSendToLabor);
    var sendOverlay = document.getElementById('pb-send-modal');
    if (sendOverlay) {
      sendOverlay.addEventListener('click', function (e) { if (e.target === sendOverlay) closeSendModal(); });
      sendOverlay.addEventListener('change', function (e) {
        if (e.target && e.target.name === 'pb-send-field') updateSendModalUI();
      });
    }
    var sendCheckAll = document.getElementById('pb-send-check-all');
    if (sendCheckAll) sendCheckAll.addEventListener('click', function () {
      document.querySelectorAll('.pb-send-person-cb').forEach(function (c) { c.checked = true; });
    });
    var sendUncheckAll = document.getElementById('pb-send-uncheck-all');
    if (sendUncheckAll) sendUncheckAll.addEventListener('click', function () {
      document.querySelectorAll('.pb-send-person-cb').forEach(function (c) { c.checked = false; });
    });

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

    // ── 셀 방향키/엔터 이동 (인건비 페이지와 동일 UX) ──────────────
    //   대상: 표 본문의 입력칸(.pb-cell-number / .pb-cell-text). 셀렉트는 제외(드롭다운 화살표 보존).
    //   ↑↓: 같은 열(같은 data-field)에서 위/아래 행. ←→: 값 전체선택 시에만 좌우 셀. Enter: 아래(Shift+Enter: 위).
    function pbGetCellInputs() {
      var table = document.getElementById('pb-table');
      if (!table) return [];
      var list = table.querySelectorAll('tbody .pb-cell-number, tbody .pb-cell-text');
      return Array.prototype.slice.call(list).filter(function (el) {
        return !el.disabled && !el.readOnly && el.offsetParent !== null; // 보이는 입력칸만
      });
    }
    function pbMoveFocus(cur, dir) {
      var inputs = pbGetCellInputs();
      if (!inputs.length) return;
      var idx = inputs.indexOf(cur);
      if (idx < 0) return;
      var target = null;
      if (dir === 'next') {
        target = inputs[idx + 1] || inputs[0];
      } else if (dir === 'prev') {
        target = inputs[idx - 1] || inputs[inputs.length - 1];
      } else { // up / down — 같은 열(field)에서 위아래
        var field = cur.dataset.field;
        var sameCol = inputs.filter(function (i) { return i.dataset.field === field; });
        var ci = sameCol.indexOf(cur);
        if (ci < 0) {
          target = inputs[idx + (dir === 'down' ? 1 : -1)];
        } else {
          var ni = dir === 'down' ? ci + 1 : ci - 1;
          if (ni >= 0 && ni < sameCol.length) target = sameCol[ni];
          else target = dir === 'down' ? sameCol[0] : sameCol[sameCol.length - 1]; // wrap
        }
      }
      if (target) { target.focus(); if (target.select) target.select(); }
    }
    document.addEventListener('keydown', function (e) {
      var el = document.activeElement;
      if (!el || !el.classList) return;
      var typable = el.classList.contains('pb-cell-number') || el.classList.contains('pb-cell-text');
      if (!typable) return;
      if (e.key === 'Enter') { e.preventDefault(); pbMoveFocus(el, e.shiftKey ? 'up' : 'down'); return; }
      var len = el.value ? el.value.length : 0;
      var allSel = (el.selectionStart === 0 && el.selectionEnd === len);
      if (e.key === 'ArrowDown')       { e.preventDefault(); pbMoveFocus(el, 'down'); }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); pbMoveFocus(el, 'up'); }
      else if (e.key === 'ArrowRight' && allSel) { e.preventDefault(); pbMoveFocus(el, 'next'); }
      else if (e.key === 'ArrowLeft'  && allSel) { e.preventDefault(); pbMoveFocus(el, 'prev'); }
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

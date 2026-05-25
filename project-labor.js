/**
 * project-labor.js — 2단계: Firestore 연동
 *
 * 구현 범위:
 *  - projects 컬렉션에서 해당 연도 수행 과제 실시간 구독
 *  - persons 컬렉션에서 인력 목록 실시간 구독
 *  - projectLabor 컬렉션에서 인건비 데이터 로드/저장
 *    · 문서 ID: {projectId}_planned / {projectId}_actual
 *    · 구조: { cells: { [key]: { rate, cash, inkind, memo } }, meta: { [ym]: { sysReg, amtConf } } }
 *  - 셀 변경 시 debounce 300ms 후 자동 저장
 *  - 이 프로젝트에 배정된 인력 목록 (projectPersons 서브필드)
 *
 * 다음 단계:
 *  - 인력 추가 모달
 *  - 이전 분기 복사
 *  - 키보드 조작
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _allProjects      = [];  // Firestore projects 전체
  var _filteredProjects = [];  // 연도 필터 후
  var _allPersons       = [];  // Firestore persons 전체

  // ====================================================================
  // 회사 필터 — 모든 인건비 페이지에서 공유 (localStorage)
  // ====================================================================
  var COMPANY_FILTER_KEY = 'rnd-company-filter';
  function loadCompanyFilter() {
    try {
      var v = localStorage.getItem(COMPANY_FILTER_KEY) || '';
      // 유효성 체크: 빈 문자열(전체) 또는 셋 중 하나
      if (v === '' || v === '식스티' || v === '굿뉴스' || v === '패리티') return v;
      return '';
    } catch (e) { return ''; }
  }
  function saveCompanyFilter(c) {
    try { localStorage.setItem(COMPANY_FILTER_KEY, c || ''); } catch (e) {}
  }

  var state = {
    projectId:  '',
    year:       new Date().getFullYear(),
    quarter:    Math.ceil((new Date().getMonth() + 1) / 3),
    company:    loadCompanyFilter(),  // '' (전체) | '식스티' | '굿뉴스' | '패리티'
    activeTab:  'planned',
    diffOnly:   false,
    planned:    {},   // { [key]: { rate, cash, inkind, memo } }
    actual:     {},
    meta:       {},   // { [ym]: { sysReg, amtConf } }
    // 이 프로젝트에 배정된 personId 목록 (순서 포함)
    personIds:  [],
    loading:    false,
    saveTimer:  null,
  };

  // ====================================================================
  // Firestore 컬렉션 참조
  // ====================================================================
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
  function getMonths(year, quarter) {
    var start = (quarter - 1) * 3 + 1;
    return [start, start + 1, start + 2].map(function (m) {
      return { year: year, month: m, ym: year + '-' + pad2(m) };
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtMoney(n) {
    if (!n && n !== 0) return '-';
    if (n === 0) return '0';
    return (n / 10000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '만';
  }

  function fmtMoneyFull(n) {
    if (!n && n !== 0) return '-';
    if (n === 0) return '0';
    return n.toLocaleString('ko-KR');
  }

  function fmtSalary(n) {
    if (!n) return '-';
    return n.toLocaleString('ko-KR') + '원';
  }

  function getLaborKey(projectId, ym, personId) {
    return projectId + '_' + ym + '_' + personId;
  }

  function getCell(dataMap, projectId, ym, personId) {
    var key = getLaborKey(projectId, ym, personId);
    return dataMap[key] || { rate: 0, cash: 0, inkind: 0, memo: '' };
  }

  function setCell(dataMap, projectId, ym, personId, patch) {
    var key = getLaborKey(projectId, ym, personId);
    if (!dataMap[key]) dataMap[key] = { rate: 0, cash: 0, inkind: 0, memo: '' };
    Object.assign(dataMap[key], patch);
  }

  // ====================================================================
  // 프로젝트 필터 (해당 연도 수행 중)
  // ====================================================================
  function isProjectActiveInYear(proj, year) {
    // 인건비 관리 대상이 아니면 제외
    if (!proj.laborManaged) return false;

    var s = String(proj.status || '');
    if (s.indexOf('수행') < 0) return false;
    var yb = proj.yearBudgets || proj.budgets || [];
    if (!Array.isArray(yb) || yb.length === 0) {
      var start = proj.researchStart || proj.startDate || proj.submitDate || '';
      var end   = proj.researchEnd   || proj.endDate   || '';
      if (!start) return true;
      var sy = parseInt(start.substring(0, 4), 10);
      var ey = end ? parseInt(end.substring(0, 4), 10) : sy;
      return sy <= year && year <= ey;
    }
    return yb.some(function (b) {
      var bs = parseInt((b.start || b.startDate || '').substring(0, 4), 10);
      var be = parseInt((b.end   || b.endDate   || '').substring(0, 4), 10);
      if (!bs) return true;
      if (!be) be = bs;
      return bs <= year && year <= be;
    });
  }

  function filterProjectsByYear(year) {
    _filteredProjects = _allProjects.filter(function (p) {
      if (!isProjectActiveInYear(p, year)) return false;
      // 회사 필터: state.company 가 비어있으면 전체, 아니면 일치하는 것만
      if (state.company && p.company !== state.company) return false;
      return true;
    });
  }

  // ====================================================================
  // 현재 프로젝트/인력
  // ====================================================================
  function getProjectList() {
    return _filteredProjects.length ? _filteredProjects : [];
  }

  function getProject() {
    var list = getProjectList();
    return list.find(function (p) { return p.id === state.projectId; }) || list[0] || null;
  }

  function getPersons() {
    // 이 프로젝트에 배정된 인력만 (personIds 순서 기준)
    // personIds가 비어있으면 빈 배열
    if (!state.personIds.length) return [];
    return state.personIds
      .map(function (id) {
        return _allPersons.find(function (p) { return p.id === id; });
      })
      .filter(Boolean);
  }

  // ====================================================================
  // Firestore: 인건비 로드
  // ====================================================================
  function loadLaborData() {
    if (!state.projectId) return;

    setLoading(true);

    if (!isFirestoreReady()) {
      // Firestore 미연결: 빈 데이터로 시작
      state.planned   = {};
      state.actual    = {};
      state.meta      = {};
      state.personIds = [];
      setLoading(false);
      renderAll();
      return;
    }

    var docId = state.projectId;
    Promise.all([
      db().collection(LABOR_COLL).doc(docId + '_planned').get(),
      db().collection(LABOR_COLL).doc(docId + '_actual').get(),
      db().collection(LABOR_COLL).doc(docId + '_meta').get(),
    ]).then(function (snaps) {
      var plannedDoc = snaps[0];
      var actualDoc  = snaps[1];
      var metaDoc    = snaps[2];

      state.planned   = (plannedDoc.exists && plannedDoc.data().cells)   ? plannedDoc.data().cells   : {};
      state.actual    = (actualDoc.exists  && actualDoc.data().cells)    ? actualDoc.data().cells    : {};
      state.meta      = (metaDoc.exists    && metaDoc.data().meta)       ? metaDoc.data().meta       : {};
      state.personIds = (metaDoc.exists    && metaDoc.data().personIds)  ? metaDoc.data().personIds  : [];

      setLoading(false);
      renderAll();
    }).catch(function (e) {
      console.error('인건비 로드 실패:', e);
      state.planned   = {};
      state.actual    = {};
      state.meta      = {};
      state.personIds = [];
      setLoading(false);
      renderAll();
    });
  }

  // ====================================================================
  // Firestore: 인건비 저장 (debounce 300ms)
  // ====================================================================
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      saveLaborData();
    }, 300);
  }

  function saveLaborData() {
    if (!state.projectId || !isFirestoreReady()) return;

    var docId = state.projectId;
    var batch = db().batch();

    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_planned'),
      { cells: state.planned, updatedAt: new Date().toISOString() }
    );
    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_actual'),
      { cells: state.actual, updatedAt: new Date().toISOString() }
    );
    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_meta'),
      { meta: state.meta, personIds: state.personIds, updatedAt: new Date().toISOString() }
    );

    batch.commit().then(function () {
      showSaveIndicator('저장됨');
    }).catch(function (e) {
      console.error('인건비 저장 실패:', e);
      showSaveIndicator('저장 실패 ⚠️');
    });
  }

  // ====================================================================
  // 저장 상태 표시
  // ====================================================================
  function showSaveIndicator(msg) {
    var el = document.getElementById('pl-save-indicator');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 2000);
  }

  // ====================================================================
  // 로딩 상태
  // ====================================================================
  function setLoading(val) {
    state.loading = val;
    var el = document.getElementById('pl-loading');
    if (el) el.style.display = val ? 'block' : 'none';
  }

  // ====================================================================
  // 프로젝트 드롭다운 채우기
  // ====================================================================
  function populateProjectSelect() {
    var sel = document.getElementById('pl-project-select');
    if (!sel) return;

    var list   = getProjectList();
    var prevId = state.projectId;

    sel.innerHTML = '';

    if (list.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '해당 연도 수행 과제 없음';
      sel.appendChild(opt);
      state.projectId = '';
      return;
    }

    list.forEach(function (proj) {
      var opt = document.createElement('option');
      opt.value = proj.id;
      var name = proj.name || proj.projectName || proj.id;
      var kw = (proj.keywords || proj.keyword || '').toString().trim();
      opt.textContent = kw ? '(' + kw + ') ' + name : name;
      sel.appendChild(opt);
    });

    var stillExists = list.some(function (p) { return p.id === prevId; });
    if (stillExists) {
      sel.value = prevId;
    } else {
      state.projectId = list[0].id;
      sel.value = state.projectId;
    }
  }

  // ====================================================================
  // 프로젝트/인력 Firestore 구독
  // ====================================================================
  function loadProjects() {
    if (window.firestoreService) {
      window.firestoreService.subscribeProjects(function (projects) {
        _allProjects = Array.isArray(projects) ? projects : [];
        filterProjectsByYear(state.year);
        populateProjectSelect();

        // 첫 로드 or 프로젝트 변경 시 인건비 로드
        var proj = getProject();
        if (proj && proj.id !== state._lastLoadedProjectId) {
          state._lastLoadedProjectId = proj.id;
          state.projectId = proj.id;
          loadLaborData();
        } else if (!proj) {
          renderAll();
        }
      });
    } else {
      renderAll();
    }
  }

  function loadPersons() {
    if (window.firestoreService) {
      window.firestoreService.subscribePersons(function (persons) {
        _allPersons = Array.isArray(persons) ? persons : [];
        renderAll();
      });
    }
  }

  // ====================================================================
  // 신규 채용 배너
  // ====================================================================
  function renderHireBanner() {
    var project = getProject();
    var banner  = document.getElementById('pl-hire-banner');
    var text    = document.getElementById('pl-hire-text');
    if (!banner || !text || !project || !project.requiredNew) {
      if (banner) banner.style.display = 'none';
      return;
    }
    var hired = state.personIds.filter(function (id) {
      var p = _allPersons.find(function (x) { return x.id === id; });
      return p && p.isNew && p.status === 'active';
    }).length;
    var hiredYouth = state.personIds.filter(function (id) {
      var p = _allPersons.find(function (x) { return x.id === id; });
      return p && p.isNew && p.isYouth && p.status === 'active';
    }).length;

    banner.style.display = 'flex';
    text.innerHTML =
      '신규 채용 필수: <strong>' + hired + ' / ' + project.requiredNew + '명</strong>' +
      ' &nbsp;|&nbsp; 청년: <strong>' + hiredYouth + ' / ' + (project.requiredYouth || 0) + '명</strong>' +
      ' &nbsp;<span class="pl-hire-badge ' + (hired >= project.requiredNew ? 'pl-hire-badge--done' : 'pl-hire-badge--progress') + '">' +
        (hired >= project.requiredNew ? '✅ 완료' : '⏳ 진행중') + '</span>';
  }

  // ====================================================================
  // 전체 렌더링
  // ====================================================================
  function renderAll() {
    renderHireBanner();
    buildTable(document.getElementById('pl-table-planned'), 'planned');
    buildTable(document.getElementById('pl-table-actual'),  'actual');
    buildTable(document.getElementById('pl-table-compare'), 'compare');
    updateTabCounts();
  }

  function updateTabCounts() {
    var persons = getPersons();
    ['planned', 'actual', 'compare'].forEach(function (tab) {
      var el = document.getElementById('tab-count-' + tab);
      if (el) el.textContent = tab === 'compare' ? '-' : persons.length + '명';
    });
  }

  // ====================================================================
  // 렌더링: 공통 테이블 빌더
  // ====================================================================
  function buildTable(tableEl, mode) {
    if (!tableEl) return;
    var months  = getMonths(state.year, state.quarter);
    var persons = getPersons();
    var project = getProject();
    var dataMap = mode === 'actual' ? state.actual : state.planned;

    // 환급 여부: project.laborRefund === false 이면 참여율만, 그 외 환급 있음
    var hasRefund = !project || project.laborRefund !== false;

    tableEl.innerHTML = '';

    if (!project) {
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 2 + months.length * 3;
      tdEmpty.className = 'pl-empty';
      tdEmpty.textContent = '과제를 선택해주세요.';
      trEmpty.appendChild(tdEmpty);
      var tbody0 = document.createElement('tbody');
      tbody0.appendChild(trEmpty);
      tableEl.appendChild(tbody0);
      return;
    }

    // colgroup
    var cg = document.createElement('colgroup');
    cg.innerHTML = '<col class="col-name"><col class="col-salary">';
    months.forEach(function () {
      if (mode === 'compare') {
        cg.innerHTML += '<col class="col-rate"><col class="col-cash"><col class="col-rate"><col class="col-cash"><col class="col-cash">';
      } else if (hasRefund) {
        cg.innerHTML += '<col class="col-rate"><col class="col-cash"><col class="col-inkind">';
      } else {
        // 환급 없음: 참여율만
        cg.innerHTML += '<col class="col-rate">';
      }
    });
    tableEl.appendChild(cg);

    // thead
    var thead = document.createElement('thead');
    var trMonth = document.createElement('tr');
    trMonth.className = 'pl-thead-month';

    var thName = document.createElement('th');
    thName.textContent = '인력';
    thName.rowSpan = 2;
    thName.className = 'th-fixed';
    trMonth.appendChild(thName);

    var thSalary = document.createElement('th');
    thSalary.textContent = '월급';
    thSalary.rowSpan = 2;
    thSalary.className = 'th-fixed';
    trMonth.appendChild(thSalary);

    months.forEach(function (m, mi) {
      var isLast = mi === months.length - 1;
      var th = document.createElement('th');
      th.colSpan = mode === 'compare' ? 5 : 3;
      th.className = 'th-month' + (!isLast ? ' month-sep' : '');
      th.innerHTML =
        '<div style="font-size:0.85rem;">' + m.year + '년 ' + m.month + '월</div>' +
        '<div class="pl-month-meta">' +
          '<label><input type="checkbox" class="chk-sys" data-ym="' + m.ym + '"' +
            ((state.meta[m.ym] && state.meta[m.ym].sysReg) ? ' checked' : '') + '> 시스템등록</label>' +
          '<label><input type="checkbox" class="chk-amt" data-ym="' + m.ym + '"' +
            ((state.meta[m.ym] && state.meta[m.ym].amtConf) ? ' checked' : '') + '> 금액확인</label>' +
        '</div>';
      trMonth.appendChild(th);
    });
    thead.appendChild(trMonth);

    var trSub = document.createElement('tr');
    trSub.className = 'pl-thead-sub';
    months.forEach(function (m, mi) {
      var isLast = mi === months.length - 1;
      var cols = mode === 'compare'
        ? ['예상%', '예상현금', '실제%', '실제현금', '차이']
        : hasRefund
          ? ['참여율', '현금', '현물']
          : ['참여율'];
      cols.forEach(function (label, li) {
        var th = document.createElement('th');
        th.textContent = label;
        if (li === cols.length - 1 && !isLast) th.className = 'month-sep';
        trSub.appendChild(th);
      });
    });
    thead.appendChild(trSub);
    tableEl.appendChild(thead);

    // tbody
    var tbody = document.createElement('tbody');

    if (persons.length === 0) {
      var trEmp = document.createElement('tr');
      var tdEmp = document.createElement('td');
      tdEmp.colSpan = 2 + months.length * (mode === 'compare' ? 5 : hasRefund ? 3 : 1);
      tdEmp.className = 'pl-empty';
      tdEmp.textContent = '+ 인력 추가 버튼으로 인력을 추가하세요.';
      trEmp.appendChild(tdEmp);
      tbody.appendChild(trEmp);
    } else {
      persons.forEach(function (person) {
        if (mode === 'compare') {
          buildCompareRows(tbody, person, months, project);
        } else {
          buildDataRow(tbody, person, months, project, dataMap, mode, hasRefund);
        }
      });
    }

    // + 인력 추가 행
    if (mode !== 'compare') {
      var trAdd = document.createElement('tr');
      trAdd.className = 'pl-row-add';
      var tdAdd = document.createElement('td');
      tdAdd.colSpan = 2 + months.length * (hasRefund ? 3 : 1);
      tdAdd.innerHTML = '<button type="button" class="pl-add-person-btn pl-add-inline-btn">＋ 인력 추가</button>';
      trAdd.appendChild(tdAdd);
      tbody.appendChild(trAdd);
    }

    tableEl.appendChild(tbody);

    // tfoot 합계
    if (mode !== 'compare') {
      var tfoot = document.createElement('tfoot');
      var trSum = document.createElement('tr');
      trSum.className = 'pl-tfoot-sum';

      var tdLabel = document.createElement('td');
      tdLabel.colSpan = 2;
      tdLabel.className = 'td-fixed';
      tdLabel.textContent = hasRefund ? '월별 합계 (환급 예정)' : '월별 합계 (참여율)';
      trSum.appendChild(tdLabel);

      months.forEach(function (m, mi) {
        var isLast = mi === months.length - 1;
        var fields = hasRefund ? ['rate', 'cash', 'inkind'] : ['rate'];
        fields.forEach(function (field, fi) {
          var td = document.createElement('td');
          td.id = 'sum-' + field + '-' + mode + '-' + m.ym;
          td.textContent = '-';
          if (fi === fields.length - 1 && !isLast) td.className = 'month-sep';
          trSum.appendChild(td);
        });
      });

      tfoot.appendChild(trSum);
      tableEl.appendChild(tfoot);
      recalcSums(mode, months, persons, project, dataMap);
    }
  }

  // ---- 일반 행 ----
  function buildDataRow(tbody, person, months, project, dataMap, mode, hasRefund) {
    var isExited = (person.status === 'exited');
    var tr = document.createElement('tr');
    if (isExited) tr.className = 'pl-row--exited';
    tr.dataset.personId = person.id;

    var tdName = document.createElement('td');
    tdName.className = 'td-fixed pl-td-name';
    var badgesHtml = '';
    if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
    if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';
    if (isExited)       badgesHtml += '<span class="pl-badge pl-badge--exit">퇴사</span>';
    tdName.innerHTML =
      '<div class="pl-name-row">' +
        '<span class="pl-name-text">' + person.name + '</span>' +
        (badgesHtml ? '<span class="pl-name-badges-inline">' + badgesHtml + '</span>' : '') +
      '</div>';
    tr.appendChild(tdName);

    var tdSalary = document.createElement('td');
    tdSalary.className = 'td-fixed pl-td-salary';
    tdSalary.textContent = fmtSalary(person.monthlySalary);
    tr.appendChild(tdSalary);

    months.forEach(function (m, mi) {
      var isLast   = mi === months.length - 1;
      var cell     = getCell(dataMap, project.id, m.ym, person.id);
      var inactive = isExited && !cell.cash;

      // 참여율
      var tdRate = document.createElement('td');
      tdRate.className = inactive ? 'pl-cell--inactive' : '';
      var inputRate = document.createElement('input');
      inputRate.type = 'number';
      inputRate.className = 'pl-cell-input pl-input-rate';
      inputRate.min = 0; inputRate.max = 100; inputRate.step = 1;
      inputRate.value = cell.rate || '';
      inputRate.placeholder = '0';
      inputRate.readOnly = isExited;
      inputRate.dataset.personId = person.id;
      inputRate.dataset.ym = m.ym;
      inputRate.dataset.field = 'rate';
      inputRate.dataset.mode = mode;
      applyRateColor(inputRate, cell.rate || 0);
      tdRate.appendChild(inputRate);
      if (cell.memo) {
        var memoSpan = document.createElement('span');
        memoSpan.className = 'pl-memo-text';
        memoSpan.textContent = cell.memo;
        tdRate.appendChild(memoSpan);
      }
      tr.appendChild(tdRate);

      if (hasRefund) {
        // 현금
        var tdCash = document.createElement('td');
        tdCash.className = inactive ? 'pl-cell--inactive' : '';
        var inputCash = document.createElement('input');
        inputCash.type = 'number';
        inputCash.className = 'pl-cell-input pl-input-cash';
        inputCash.min = 0; inputCash.step = 1000;
        inputCash.value = cell.cash || '';
        inputCash.placeholder = '0';
        inputCash.readOnly = isExited;
        inputCash.dataset.personId = person.id;
        inputCash.dataset.ym = m.ym;
        inputCash.dataset.field = 'cash';
        inputCash.dataset.mode = mode;
        tdCash.appendChild(inputCash);
        tr.appendChild(tdCash);

        // 현물
        var tdInkind = document.createElement('td');
        tdInkind.className = (inactive ? 'pl-cell--inactive ' : '') + (!isLast ? 'month-sep' : '');
        var inputInkind = document.createElement('input');
        inputInkind.type = 'number';
        inputInkind.className = 'pl-cell-input pl-input-inkind';
        inputInkind.min = 0; inputInkind.step = 1000;
        inputInkind.value = cell.inkind || '';
        inputInkind.placeholder = '0';
        inputInkind.readOnly = isExited;
        inputInkind.dataset.personId = person.id;
        inputInkind.dataset.ym = m.ym;
        inputInkind.dataset.field = 'inkind';
        inputInkind.dataset.mode = mode;
        tdInkind.appendChild(inputInkind);
        tr.appendChild(tdInkind);
      } else {
        // 환급 없음: 참여율 셀에 month-sep만 추가
        if (!isLast) tdRate.classList.add('month-sep');
      }
    });

    tbody.appendChild(tr);
  }

  // ---- 비교 행 ----
  function buildCompareRows(tbody, person, months, project) {
    var rowTypes = state.diffOnly
      ? [{ key: 'diff', cls: 'pl-row-diff' }]
      : [
          { key: 'planned', cls: 'pl-row-planned' },
          { key: 'actual',  cls: 'pl-row-actual'  },
          { key: 'diff',    cls: 'pl-row-diff'     },
        ];

    rowTypes.forEach(function (rowType, ri) {
      var tr = document.createElement('tr');
      tr.className = rowType.cls;

      var isFirst = (ri === 0);
      if (isFirst) {
        var tdName = document.createElement('td');
        tdName.className = 'td-fixed pl-td-name';
        tdName.rowSpan = rowTypes.length;
        var badgesHtml = '';
        if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
        if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';
        tdName.innerHTML =
          '<div class="pl-name-row">' +
            '<span class="pl-name-text">' + person.name + '</span>' +
            (badgesHtml ? '<span class="pl-name-badges-inline">' + badgesHtml + '</span>' : '') +
          '</div>';
        tr.appendChild(tdName);

        var tdSalary = document.createElement('td');
        tdSalary.className = 'td-fixed pl-td-salary';
        tdSalary.rowSpan = rowTypes.length;
        tdSalary.textContent = fmtSalary(person.monthlySalary);
        tr.appendChild(tdSalary);
      }

      months.forEach(function (m, mi) {
        var isLast    = mi === months.length - 1;
        var planned   = getCell(state.planned, project.id, m.ym, person.id);
        var actual    = getCell(state.actual,  project.id, m.ym, person.id);
        var hasActual = !!state.actual[getLaborKey(project.id, m.ym, person.id)];

        if (rowType.key === 'planned') {
          appendCompareCell(tr, planned.rate, '%', false, '');
          appendCompareCell(tr, planned.cash, '원', false, !isLast ? 'month-sep' : '');
        } else if (rowType.key === 'actual') {
          appendCompareCell(tr, hasActual ? actual.rate : null, '%', false, '');
          appendCompareCell(tr, hasActual ? actual.cash : null, '원', false, !isLast ? 'month-sep' : '');
        } else {
          var diffRate = hasActual ? (actual.rate - planned.rate) : null;
          var diffCash = hasActual ? (actual.cash - planned.cash) : null;
          appendCompareCell(tr, diffRate, '%', true, '');
          appendCompareCell(tr, diffCash, '원', true, !isLast ? 'month-sep' : '');
        }
      });

      tbody.appendChild(tr);
    });
  }

  function appendCompareCell(tr, value, unit, isDiff, extraClass) {
    var td = document.createElement('td');
    td.style.textAlign = 'right';
    td.style.padding = '0.55rem 0.5rem';
    td.style.fontSize = '0.82rem';
    td.style.fontVariantNumeric = 'tabular-nums';
    if (extraClass) td.className = extraClass;

    if (value === null || value === undefined) {
      td.textContent = '-';
      td.style.color = '#cbd5e1';
    } else if (isDiff) {
      if (value > 0) {
        td.textContent = '+' + (unit === '원' ? fmtMoney(value) : value + '%');
        td.className += ' diff-pos';
      } else if (value < 0) {
        td.textContent = unit === '원' ? fmtMoney(value) : value + '%';
        td.className += ' diff-neg';
      } else {
        td.textContent = '0';
        td.className += ' diff-zero';
      }
    } else {
      td.textContent = unit === '원' ? fmtMoney(value) : (value ? value + '%' : '-');
    }
    tr.appendChild(td);
  }

  // ====================================================================
  // 참여율 색상
  // ====================================================================
  function applyRateColor(input, rate) {
    input.classList.remove('rate-safe', 'rate-warn', 'rate-danger');
    if (rate >= 100)     input.classList.add('rate-danger');
    else if (rate >= 90) input.classList.add('rate-warn');
    else if (rate > 0)   input.classList.add('rate-safe');
  }

  // ====================================================================
  // 합계 재계산
  // ====================================================================
  function recalcSums(mode, months, persons, project, dataMap) {
    var hasRefund = !project || project.laborRefund !== false;
    months.forEach(function (m) {
      var totalRate = 0, totalCash = 0, totalInkind = 0;
      persons.forEach(function (p) {
        var cell = getCell(dataMap, project.id, m.ym, p.id);
        totalRate   += (cell.rate   || 0);
        totalCash   += (cell.cash   || 0);
        totalInkind += (cell.inkind || 0);
      });
      var elRate   = document.getElementById('sum-rate-'   + mode + '-' + m.ym);
      var elCash   = document.getElementById('sum-cash-'   + mode + '-' + m.ym);
      var elInkind = document.getElementById('sum-inkind-' + mode + '-' + m.ym);
      if (elRate)   elRate.textContent   = totalRate ? totalRate + '%' : '-';
      if (hasRefund) {
        if (elCash)   elCash.textContent   = totalCash   ? fmtMoneyFull(totalCash)   + '원' : '-';
        if (elInkind) elInkind.textContent = totalInkind ? fmtMoneyFull(totalInkind) + '원' : '-';
      }
    });
  }

  // ====================================================================
  // 입력 이벤트: 참여율 → 현금 자동 계산 + 저장
  // ====================================================================
  function onCellInput(e) {
    var input = e.target;
    if (!input.classList.contains('pl-cell-input')) return;

    var personId = input.dataset.personId;
    var ym       = input.dataset.ym;
    var field    = input.dataset.field;
    var mode     = input.dataset.mode;
    if (!personId || !ym || !field || !mode) return;

    var dataMap = mode === 'actual' ? state.actual : state.planned;
    var project = getProject();
    if (!project) return;

    var person = _allPersons.find(function (p) { return p.id === personId; });
    if (!person) return;

    var val = parseFloat(input.value) || 0;

    if (field === 'rate') {
      if (val > 100) {
        input.value = 100;
        val = 100;
        input.classList.add('rate-danger');
        alert('참여율은 100%를 초과할 수 없습니다.');
        return;
      }
      applyRateColor(input, val);

      var autoCash = Math.round((person.monthlySalary || 0) * val / 100);
      setCell(dataMap, project.id, ym, personId, { rate: val, cash: autoCash });

      var tr = input.closest('tr');
      if (tr) {
        var cashInput = tr.querySelector('.pl-input-cash[data-ym="' + ym + '"]');
        if (cashInput) cashInput.value = autoCash || '';
      }
    } else {
      var patch = {};
      patch[field] = val;
      setCell(dataMap, project.id, ym, personId, patch);
    }

    var months = getMonths(state.year, state.quarter);
    recalcSums(mode, months, getPersons(), project, dataMap);
    scheduleSave();
  }

  // 체크박스 (시스템등록 / 금액확인)
  function onMetaCheck(e) {
    var input = e.target;
    var ym    = input.dataset.ym;
    if (!ym) return;
    if (!state.meta[ym]) state.meta[ym] = {};
    if (input.classList.contains('chk-sys')) state.meta[ym].sysReg  = input.checked;
    if (input.classList.contains('chk-amt')) state.meta[ym].amtConf = input.checked;
    scheduleSave();
  }

  // ====================================================================
  // 탭 전환
  // ====================================================================
  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.history-tab').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.pl-tab-content').forEach(function (div) {
      div.classList.toggle('is-active', div.id === 'tab-' + tab);
    });
  }

  // ====================================================================
  // 분기 레이블
  // ====================================================================
  function updateQuarterLabel() {
    var label = document.getElementById('pl-quarter-label');
    if (label) label.textContent = state.quarter + '분기';
  }

  // ====================================================================
  // 이벤트 바인딩
  // ====================================================================
  function bindEvents() {
    // 프로젝트 선택
    var projectSel = document.getElementById('pl-project-select');
    if (projectSel) {
      projectSel.addEventListener('change', function () {
        state.projectId = this.value;
        loadLaborData();
      });
    }

    // 연도
    var yearInput = document.getElementById('pl-year-input');
    if (yearInput) {
      yearInput.addEventListener('change', function () {
        state.year = parseInt(this.value, 10) || new Date().getFullYear();
        filterProjectsByYear(state.year);
        populateProjectSelect();
        var proj = getProject();
        if (proj) {
          state.projectId = proj.id;
          loadLaborData();
        } else {
          renderAll();
        }
      });
    }

    // 회사 필터 칩
    var companyChips = document.getElementById('pl-company-chips');
    if (companyChips) {
      companyChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.company-chip');
        if (!btn) return;
        var c = btn.dataset.company || '';
        if (c === state.company) return; // 이미 선택된 칩
        state.company = c;
        saveCompanyFilter(c);
        // 칩 시각 상태 갱신
        companyChips.querySelectorAll('.company-chip').forEach(function (b) {
          b.classList.toggle('is-active', (b.dataset.company || '') === c);
        });
        // 프로젝트 다시 필터 → 셀렉트 갱신 → 첫 프로젝트로 이동
        filterProjectsByYear(state.year);
        populateProjectSelect();
        var proj = getProject();
        if (proj) {
          state.projectId = proj.id;
          loadLaborData();
        } else {
          // 해당 회사에 과제가 없으면
          state.projectId = '';
          state.planned = {};
          state.actual = {};
          state.meta = {};
          state.personIds = [];
          renderAll();
        }
      });
    }

    // 분기 이동
    var prevBtn = document.getElementById('pl-quarter-prev');
    var nextBtn = document.getElementById('pl-quarter-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (state.quarter > 1) { state.quarter--; }
        else { state.quarter = 4; state.year--; document.getElementById('pl-year-input').value = state.year; }
        updateQuarterLabel();
        renderAll();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (state.quarter < 4) { state.quarter++; }
        else { state.quarter = 1; state.year++; document.getElementById('pl-year-input').value = state.year; }
        updateQuarterLabel();
        renderAll();
      });
    }

    // 탭
    document.querySelectorAll('.history-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(this.dataset.tab); });
    });

    // 셀 입력 (이벤트 위임)
    document.addEventListener('input', onCellInput);

    // 체크박스 (이벤트 위임)
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('chk-sys') || e.target.classList.contains('chk-amt')) {
        onMetaCheck(e);
      }
    });

    // 차이만 보기
    var diffOnly = document.getElementById('pl-diff-only');
    if (diffOnly) {
      diffOnly.addEventListener('change', function () {
        state.diffOnly = this.checked;
        var chip = document.getElementById('pl-diff-only-chip');
        if (chip) chip.classList.toggle('is-active', this.checked);
        buildTable(document.getElementById('pl-table-compare'), 'compare');
      });
    }

    // 일괄 자동 계산
    var calcBtn = document.getElementById('pl-calc-all-btn');
    if (calcBtn) {
      calcBtn.addEventListener('click', function () {
        var project = getProject();
        if (!project) return;
        var months  = getMonths(state.year, state.quarter);
        var mode    = state.activeTab === 'actual' ? 'actual' : 'planned';
        var dataMap = mode === 'actual' ? state.actual : state.planned;

        getPersons().forEach(function (person) {
          months.forEach(function (m) {
            var cell = getCell(dataMap, project.id, m.ym, person.id);
            if (cell.rate > 0) {
              setCell(dataMap, project.id, m.ym, person.id, {
                cash: Math.round((person.monthlySalary || 0) * cell.rate / 100)
              });
            }
          });
        });

        buildTable(document.getElementById('pl-table-' + mode), mode);
        scheduleSave();
        showSaveIndicator('일괄 계산 완료 ✅');
      });
    }

    // 이전 분기 복사
    var copyBtn = document.getElementById('pl-copy-prev-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyPrevQuarter();
      });
    }

    // + 인력 추가 버튼
    document.addEventListener('click', function (e) {
      if (e.target.id === 'pl-add-person-top-btn' || e.target.classList.contains('pl-add-inline-btn')) {
        openAddModal();
      }
    });
  }

  // ====================================================================
  // 키보드 조작
  //
  // Tab / Enter      → 같은 행에서 다음 셀 (마지막이면 다음 행 첫 셀)
  // Shift+Tab        → 이전 셀
  // 화살표 ↑↓←→     → 상하좌우 셀 이동
  // Ctrl+C           → 현재 셀 값 클립보드 복사
  // Ctrl+V           → 클립보드 값 붙여넣기 (숫자만)
  // Ctrl+Z           → 직전 셀 변경 되돌리기 (undo 스택)
  // Esc              → 편집 취소 (포커스 이전의 원래 값 복원)
  // ====================================================================
  var _undoStack  = [];      // { key, mode, field, oldVal, newVal }
  var _cellOrigin = null;    // 포커스 시점 원본값 (Esc 복원용)
  var _clipboard  = null;    // Ctrl+C 복사 값

  function bindKeyboard() {
    // 모든 셀 input에 포커스 진입 시 원본값 저장
    document.addEventListener('focusin', function (e) {
      if (!e.target.classList.contains('pl-cell-input')) return;
      _cellOrigin = e.target.value;
      e.target.select();
    });

    // 포커스 이탈 시 undo 스택에 push (값이 바뀐 경우만)
    document.addEventListener('focusout', function (e) {
      var input = e.target;
      if (!input.classList.contains('pl-cell-input')) return;
      if (_cellOrigin !== null && input.value !== _cellOrigin) {
        _undoStack.push({
          input:   input,
          oldVal:  _cellOrigin,
          newVal:  input.value,
          personId: input.dataset.personId,
          ym:      input.dataset.ym,
          field:   input.dataset.field,
          mode:    input.dataset.mode,
        });
        // 스택 최대 50개 유지
        if (_undoStack.length > 50) _undoStack.shift();
      }
      _cellOrigin = null;
    });

    document.addEventListener('keydown', function (e) {
      var input = document.activeElement;
      var isCellInput = input && input.classList.contains('pl-cell-input');

      // ── Ctrl+Z: 되돌리기 ──────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // 모달 열려있으면 패스
        var modal = document.getElementById('pl-add-modal');
        if (modal && !modal.hidden) return;

        e.preventDefault();
        undoLastCell();
        return;
      }

      // ── Ctrl+C: 셀 값 복사 ───────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && isCellInput) {
        _clipboard = input.value;
        // 브라우저 기본 복사도 허용 (선택 텍스트)
        return;
      }

      // ── Ctrl+V: 클립보드 붙여넣기 ────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && isCellInput) {
        if (_clipboard !== null && _clipboard !== '') {
          e.preventDefault();
          var num = parseFloat(_clipboard);
          if (!isNaN(num)) {
            input.value = num;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        return;
      }

      if (!isCellInput) return;

      // ── Tab / Shift+Tab ───────────────────────────────
      if (e.key === 'Tab') {
        e.preventDefault();
        moveFocus(input, e.shiftKey ? 'prev' : 'next');
        return;
      }

      // ── Enter → 다음 셀 (아래 행 같은 컬럼) ──────────
      if (e.key === 'Enter') {
        e.preventDefault();
        moveFocus(input, 'down');
        return;
      }

      // ── Esc → 원본값 복원 ─────────────────────────────
      if (e.key === 'Escape') {
        if (_cellOrigin !== null) {
          input.value = _cellOrigin;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          _cellOrigin = input.value;
        }
        input.blur();
        return;
      }

      // ── 화살표 키 ─────────────────────────────────────
      // 숫자 입력 중에는 좌우 화살표는 커서 이동이 자연스러우므로
      // 값이 전체 선택 상태일 때만 좌우도 셀 이동으로 처리
      var allSelected = (input.selectionStart === 0 && input.selectionEnd === input.value.length);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(input, 'down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(input, 'up');
      } else if (e.key === 'ArrowRight' && allSelected) {
        e.preventDefault();
        moveFocus(input, 'next');
      } else if (e.key === 'ArrowLeft' && allSelected) {
        e.preventDefault();
        moveFocus(input, 'prev');
      }
    });
  }

  // ── 셀 이동 ──────────────────────────────────────────
  function getAllCellInputs() {
    // 현재 활성 탭 테이블의 셀 input만 (compare 탭은 readonly라 제외)
    var mode = state.activeTab === 'actual' ? 'actual' : 'planned';
    var table = document.getElementById('pl-table-' + mode);
    if (!table) return [];
    return Array.from(table.querySelectorAll('.pl-cell-input:not([readonly])'));
  }

  function moveFocus(currentInput, direction) {
    var inputs = getAllCellInputs();
    if (!inputs.length) return;

    var idx = inputs.indexOf(currentInput);
    if (idx < 0) return;

    var target = null;

    if (direction === 'next') {
      target = inputs[idx + 1] || inputs[0];
    } else if (direction === 'prev') {
      target = inputs[idx - 1] || inputs[inputs.length - 1];
    } else if (direction === 'down' || direction === 'up') {
      // 같은 컬럼(field) 기준으로 한 행 위/아래
      var field = currentInput.dataset.field;
      var ym    = currentInput.dataset.ym;

      // 같은 ym + 같은 field인 inputs만 → 행 인덱스로 이동
      var sameCol = inputs.filter(function (inp) {
        return inp.dataset.field === field && inp.dataset.ym === ym;
      });
      var colIdx = sameCol.indexOf(currentInput);
      if (colIdx < 0) { target = inputs[idx + (direction === 'down' ? 1 : -1)]; }
      else {
        var nextColIdx = direction === 'down' ? colIdx + 1 : colIdx - 1;
        if (nextColIdx >= 0 && nextColIdx < sameCol.length) {
          target = sameCol[nextColIdx];
        } else {
          // 끝에 도달하면 wrap
          target = direction === 'down' ? sameCol[0] : sameCol[sameCol.length - 1];
        }
      }
    }

    if (target) {
      target.focus();
      target.select();
    }
  }

  // ── Ctrl+Z 되돌리기 ──────────────────────────────────
  function undoLastCell() {
    if (!_undoStack.length) {
      showToast('더 이상 되돌릴 내용이 없습니다.', 'info');
      return;
    }

    var entry   = _undoStack.pop();
    var dataMap = entry.mode === 'actual' ? state.actual : state.planned;
    var project = getProject();
    if (!project) return;

    // 값 복원
    var patch = {};
    patch[entry.field] = parseFloat(entry.oldVal) || 0;
    setCell(dataMap, project.id, entry.ym, entry.personId, patch);

    // 현금도 같이 복원 (rate 되돌리기 시)
    if (entry.field === 'rate') {
      var person = _allPersons.find(function (p) { return p.id === entry.personId; });
      if (person) {
        var oldRate  = parseFloat(entry.oldVal) || 0;
        var oldCash  = Math.round((person.monthlySalary || 0) * oldRate / 100);
        setCell(dataMap, project.id, entry.ym, entry.personId, { cash: oldCash });
      }
    }

    // 테이블 해당 셀만 업데이트
    var mode  = entry.mode === 'actual' ? 'actual' : 'planned';
    var table = document.getElementById('pl-table-' + mode);
    if (table) {
      var targetInput = table.querySelector(
        '.pl-cell-input[data-person-id="' + entry.personId + '"][data-ym="' + entry.ym + '"][data-field="' + entry.field + '"]'
      );
      if (targetInput) {
        targetInput.value = entry.oldVal;
        if (entry.field === 'rate') applyRateColor(targetInput, parseFloat(entry.oldVal) || 0);
        // 현금 셀도 갱신
        if (entry.field === 'rate') {
          var tr = targetInput.closest('tr');
          if (tr) {
            var cashInput = tr.querySelector('.pl-input-cash[data-ym="' + entry.ym + '"]');
            if (cashInput) {
              var person2 = _allPersons.find(function (p) { return p.id === entry.personId; });
              if (person2) cashInput.value = Math.round((person2.monthlySalary || 0) * (parseFloat(entry.oldVal) || 0) / 100) || '';
            }
          }
        }
        targetInput.focus();
        targetInput.select();
      }
    }

    var months = getMonths(state.year, state.quarter);
    recalcSums(mode, months, getPersons(), project, dataMap);
    scheduleSave();
    showToast('↩️ 되돌리기 (' + (_undoStack.length) + '개 남음)', 'info');
  }
  // 이전 분기 = 현재 분기 - 1 (1분기면 전년도 4분기)
  // 복사 대상: planned / actual 둘 다
  // 되돌리기: 복사 전 스냅샷 저장 → "되돌리기" 토스트 버튼 제공
  // ====================================================================
  var _copySnapshot = null; // 되돌리기용 스냅샷

  function copyPrevQuarter() {
    var project = getProject();
    if (!project) return;

    // 이전 분기 계산
    var prevYear    = state.year;
    var prevQuarter = state.quarter - 1;
    if (prevQuarter < 1) { prevQuarter = 4; prevYear--; }

    var prevMonths = getMonths(prevYear, prevQuarter);
    var currMonths = getMonths(state.year, state.quarter);
    var persons    = getPersons();

    // 복사할 데이터가 있는지 확인
    var hasPrevData = persons.some(function (p) {
      return prevMonths.some(function (m) {
        var key = getLaborKey(project.id, m.ym, p.id);
        return !!(state.planned[key] || state.actual[key]);
      });
    });

    if (!hasPrevData) {
      showToast('이전 분기(' + prevYear + '년 ' + prevQuarter + '분기)에 데이터가 없습니다.', 'warn');
      return;
    }

    // 덮어쓸 데이터가 있으면 확인
    var hasCurrData = persons.some(function (p) {
      return currMonths.some(function (m) {
        var key = getLaborKey(project.id, m.ym, p.id);
        return !!(state.planned[key] || state.actual[key]);
      });
    });

    if (hasCurrData) {
      if (!confirm(
        state.year + '년 ' + state.quarter + '분기에 이미 입력된 데이터가 있습니다.\n' +
        '이전 분기(' + prevYear + '년 ' + prevQuarter + '분기) 데이터로 덮어쓸까요?'
      )) return;
    }

    // 복사 전 스냅샷 저장 (되돌리기용)
    _copySnapshot = {
      planned:   JSON.parse(JSON.stringify(state.planned)),
      actual:    JSON.parse(JSON.stringify(state.actual)),
      year:      state.year,
      quarter:   state.quarter,
      prevYear:  prevYear,
      prevQuarter: prevQuarter,
    };

    // 이전 분기 → 현재 분기 복사 (월 인덱스 매핑: 0→0, 1→1, 2→2)
    persons.forEach(function (p) {
      prevMonths.forEach(function (pm, idx) {
        var cm = currMonths[idx];

        // planned 복사
        var pKey = getLaborKey(project.id, pm.ym, p.id);
        var cKey = getLaborKey(project.id, cm.ym, p.id);
        if (state.planned[pKey]) {
          state.planned[cKey] = Object.assign({}, state.planned[pKey], { memo: '' });
        }

        // actual은 복사 안 함 (실제 지급은 해당 월 것만 의미 있음)
      });
    });

    renderAll();
    scheduleSave();
    showToast(
      '✅ ' + prevYear + '년 ' + prevQuarter + '분기 → ' + state.year + '년 ' + state.quarter + '분기 복사 완료',
      'success',
      true // 되돌리기 버튼 표시
    );
  }

  function undoCopy() {
    if (!_copySnapshot) return;
    state.planned = _copySnapshot.planned;
    state.actual  = _copySnapshot.actual;
    _copySnapshot = null;
    renderAll();
    scheduleSave();
    showToast('↩️ 복사가 취소되었습니다.', 'info');
  }

  // ====================================================================
  // 토스트 알림
  // ====================================================================
  var _toastTimer = null;

  function showToast(msg, type, showUndo) {
    var toast = document.getElementById('pl-toast');
    if (!toast) return;

    toast.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);

    if (showUndo) {
      var undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.textContent = '되돌리기';
      undoBtn.style.cssText =
        'margin-left:0.75rem; padding:0.2rem 0.6rem; border-radius:0.3rem;' +
        'border:1px solid rgba(255,255,255,0.5); background:transparent;' +
        'color:#fff; font-size:0.78rem; font-weight:600; cursor:pointer; font-family:inherit;';
      undoBtn.addEventListener('click', function () {
        undoCopy();
        hideToast();
      });
      toast.appendChild(undoBtn);
    }

    var bgMap = { success: '#059669', warn: '#d97706', info: '#2563eb', error: '#dc2626' };
    toast.style.background = bgMap[type] || bgMap.info;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, showUndo ? 6000 : 3000);
  }

  function hideToast() {
    var toast = document.getElementById('pl-toast');
    if (!toast) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
  }

  // ====================================================================
  // 인력 추가 모달
  // ====================================================================
  function openAddModal() {
    var modal = document.getElementById('pl-add-modal');
    if (!modal) return;
    modal.hidden = false;
    renderModalList('');
    var searchInput = document.getElementById('pl-modal-search');
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    var clearBtn = document.getElementById('pl-modal-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  function closeAddModal() {
    var modal = document.getElementById('pl-add-modal');
    if (modal) modal.hidden = true;
  }

  function renderModalList(keyword) {
    var resultList   = document.getElementById('pl-modal-result-list');
    var emptyEl      = document.getElementById('pl-modal-empty');
    var addedSection = document.getElementById('pl-modal-added-section');
    var addedList    = document.getElementById('pl-modal-added-list');
    if (!resultList) return;

    var kw = (keyword || '').trim().toLowerCase();

    // 이미 추가된 인력 목록 (상단)
    var addedPersons = state.personIds
      .map(function (id) { return _allPersons.find(function (p) { return p.id === id; }); })
      .filter(Boolean);

    if (addedList) {
      addedList.innerHTML = '';
      addedPersons.forEach(function (person) {
        addedList.appendChild(makePersonRow(person, true));
      });
    }
    if (addedSection) addedSection.style.display = addedPersons.length ? 'block' : 'none';

    // 전체 인력 필터
    // 현재 선택된 프로젝트의 회사 (같은 회사 인력만 후보로 노출)
    var currentProject = getProject();
    var projCompany = currentProject ? currentProject.company : '';

    var filtered = _allPersons.filter(function (p) {
      if (p.status === 'exited') return false; // 퇴사자 제외
      if (kw && p.name.toLowerCase().indexOf(kw) < 0) return false;
      // 회사 제한: 프로젝트에 회사가 지정되어 있으면 같은 회사만
      if (projCompany && p.company !== projCompany) return false;
      return true;
    });

    resultList.innerHTML = '';
    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      filtered.forEach(function (person) {
        var isAdded = state.personIds.indexOf(person.id) >= 0;
        resultList.appendChild(makePersonRow(person, false, isAdded));
      });
    }
  }

  function makePersonRow(person, isAddedSection, isAdded) {
    var row = document.createElement('div');
    row.className = 'pl-modal-person-row' + (isAdded && !isAddedSection ? ' is-added' : '');

    var badgesHtml = '';
    if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
    if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';

    var nameDiv = document.createElement('div');
    nameDiv.style.flex = '1';
    nameDiv.innerHTML =
      '<div class="pl-modal-person-name">' + person.name +
        (badgesHtml ? ' ' + badgesHtml : '') +
      '</div>' +
      '<div class="pl-modal-person-meta">' +
        (person.monthlySalary ? fmtSalary(person.monthlySalary) + '/월' : '월급 미등록') +
      '</div>';
    row.appendChild(nameDiv);

    var btn = document.createElement('button');
    btn.type = 'button';

    if (isAddedSection) {
      // 추가된 인력 섹션 → 제거 버튼
      btn.className = 'pl-modal-remove-btn';
      btn.textContent = '제거';
      btn.addEventListener('click', function () {
        removePersonFromProject(person.id);
        renderModalList(document.getElementById('pl-modal-search').value);
      });
    } else if (isAdded) {
      btn.className = 'pl-modal-add-btn';
      btn.textContent = '추가됨';
      btn.disabled = true;
      btn.style.opacity = '0.5';
    } else {
      btn.className = 'pl-modal-add-btn';
      btn.textContent = '+ 추가';
      btn.addEventListener('click', function () {
        addPersonToProject(person.id);
        renderModalList(document.getElementById('pl-modal-search').value);
      });
    }

    row.appendChild(btn);
    return row;
  }

  function addPersonToProject(personId) {
    if (state.personIds.indexOf(personId) >= 0) return; // 중복 방지
    state.personIds.push(personId);
    renderAll();
    scheduleSave();
  }

  function removePersonFromProject(personId) {
    state.personIds = state.personIds.filter(function (id) { return id !== personId; });
    renderAll();
    scheduleSave();
  }

  function bindModalEvents() {
    // 닫기
    var closeBtn  = document.getElementById('pl-modal-close');
    var cancelBtn = document.getElementById('pl-modal-cancel');
    if (closeBtn)  closeBtn.addEventListener('click',  closeAddModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddModal);

    // 오버레이 클릭으로 닫기
    var overlay = document.getElementById('pl-add-modal');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeAddModal();
      });
    }

    // ESC 키
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAddModal();
    });

    // 검색 입력
    var searchInput = document.getElementById('pl-modal-search');
    var clearBtn    = document.getElementById('pl-modal-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var kw = this.value.trim();
        if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';
        renderModalList(kw);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        this.style.display = 'none';
        renderModalList('');
      });
    }
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    var now = new Date();
    state.year    = now.getFullYear();
    state.quarter = Math.ceil((now.getMonth() + 1) / 3);

    var yearInput = document.getElementById('pl-year-input');
    if (yearInput) yearInput.value = state.year;
    updateQuarterLabel();

    // 회사 칩 초기 상태 동기화 (localStorage 복원값)
    var companyChips = document.getElementById('pl-company-chips');
    if (companyChips) {
      companyChips.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === state.company);
      });
    }

    loadPersons();
    loadProjects();
    bindEvents();
    bindModalEvents();
    bindKeyboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

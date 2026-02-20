// ParticipationManagement.js
// 참여율 관리 상세 입력 뷰를 단순하고 안전한 구조로 재구성한 버전입니다.
// - Shell/터미널 명령은 전혀 사용하지 않고, 이 파일 하나만으로 동작하도록 작성했습니다.
// - state: selectedYear, projects
// - projects: [{ id, title, members: [{ personId, rates: {1:0,...,12:0} }] }]

(function () {
  'use strict';
  console.log('=== DATE CLEANING START ===');

  var HR_STORAGE_KEY = 'hr-management-data';
  var PARTICIPATION_STORAGE_KEY = 'hr-participation-data-v2';

  var viewProject = document.getElementById('participation-view-project');
  var viewAnnual = document.getElementById('participation-view-annual');
  var tabProject = document.getElementById('participation-tab-project');
  var tabAnnual = document.getElementById('participation-tab-annual');

  var yearSelect = document.getElementById('participation-year');
  var annualYearSelect = document.getElementById('participation-annual-year');
  var annualSearchInput = document.getElementById('participation-annual-search');
  var projectCardsEl = document.getElementById('participation-project-cards');
  var annualTableWrap = document.getElementById('participation-annual-table-wrap');
  var addProjectBtn = document.getElementById('participation-add-project-btn');

  // ====== 데이터 원천: Firestore 또는 LocalStorage ======
  function getHrData() {
    try {
      if (window.firestoreService) return window.firestoreService.getHrData();
      var raw = localStorage.getItem(HR_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('인력 데이터 로드 실패:', e);
      return [];
    }
  }

  function extractYearsFromHrData(hrData) {
    var years = [];
    hrData.forEach(function (p) {
      var acq = p.acquisitionDate || p['입사일자'] || '';
      if (!acq) return;
      var parts = String(acq).trim().split(/[-/.]/);
      var y = parseInt(parts[0], 10);
      if (!isNaN(y)) years.push(y);
    });
    if (years.length === 0) {
      return [2024, 2025, 2026];
    }
    var uniq = [];
    years.forEach(function (y) {
      if (uniq.indexOf(y) === -1) uniq.push(y);
    });
    uniq.sort(function (a, b) { return b - a; }); // 최신 연도 먼저
    return uniq;
  }

  // ====== 입사/퇴사 기준 헬퍼 ======
  function parseYMD(dateStr) {
    if (!dateStr) return null;
    var parts = String(dateStr).trim().split(/[-/.]/);
    var y = parseInt(parts[0], 10);
    var m = parts[1] ? parseInt(parts[1], 10) : 1;
    if (isNaN(y) || isNaN(m)) return null;
    return { year: y, month: m };
  }

  function isMonthDisabledForPerson(person, year, month) {
    if (!person) return false;
    var acq = parseYMD(person.acquisitionDate || person['입사일자']);
    if (acq) {
      if (year < acq.year) return true;
      if (year === acq.year && month < acq.month) return true;
    }
    var loss = parseYMD(person.lossDate || person['자격상실일']);
    if (loss) {
      if (year > loss.year) return true;
      if (year === loss.year && month > loss.month) return true;
    }
    return false;
  }

  function normalizeDateStr(dateStr, fallback) {
    if (!dateStr || typeof dateStr !== 'string') return fallback || '9999-12-31';
    var s = dateStr.trim().replace(/\./g, '-');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s || (fallback || '9999-12-31');
  }

  // 입사일 >= 기준일 → 신규, 입사일 < 기준일 → 기존
  function isNewPersonnel(person, baseDateStr) {
    if (!person) return false;
    var acqStr = normalizeDateStr(person.acquisitionDate || person['입사일자'], null);
    if (!acqStr) return false;
    if (!baseDateStr || typeof baseDateStr !== 'string') return false;
    var baseStr = normalizeDateStr(baseDateStr, null);
    if (!baseStr) return false;
    return acqStr >= baseStr;
  }

  function getPersonType(person, baseDateStr) {
    return isNewPersonnel(person, baseDateStr) ? '신규' : '기존';
  }

  function getMonthlyTotalsForPerson(personId, projects) {
    var projs = projects || (state.projects || []).filter(function (p) { return p.includeInSummary !== false; });
    var totals = {};
    for (var m = 1; m <= 12; m++) totals[m] = 0;
    projs.forEach(function (proj) {
      (proj.members || []).forEach(function (memb) {
        if (memb.personId !== personId) return;
        ensureMemberRates(memb);
        for (var mm = 1; mm <= 12; mm++) {
          var v = parseFloat(memb.rates[mm] || 0);
          if (!isNaN(v)) totals[mm] += v;
        }
      });
    });
    return totals;
  }

  function get35ChGongForPerson(personId) {
    var projects = (state.projects || []).filter(function (p) { return p.is3Ch5GongTarget === true; });
    var ch = 0;
    var gong = 0;
    projects.forEach(function (proj) {
      (proj.members || []).forEach(function (memb) {
        if (memb.personId !== personId) return;
        var r = memb.role || '참여';
        if (r === '책임') ch++;
        else gong++;
      });
    });
    return { ch: ch, gong: gong };
  }

  function getMonthlyTotalsByTypeForPerson(personId, projects) {
    var projs = projects || (state.projects || []).filter(function (p) { return p.includeInSummary !== false; });
    var cash = {};
    var kind = {};
    for (var m = 1; m <= 12; m++) {
      cash[m] = 0;
      kind[m] = 0;
    }
    projs.forEach(function (proj) {
      (proj.members || []).forEach(function (memb) {
        if (memb.personId !== personId) return;
        ensureMemberRates(memb);
        var isKind = (memb.type2 || '현금') === '현물';
        for (var mm = 1; mm <= 12; mm++) {
          var v = parseFloat(memb.rates[mm] || 0);
          if (!isNaN(v)) {
            if (isKind) kind[mm] += v;
            else cash[mm] += v;
          }
        }
      });
    });
    return { cash: cash, kind: kind };
  }

  function getSortedPersonsForYear(hrData, year) {
    var withIndex = hrData.map(function (p, idx) { return { person: p, idx: idx }; });
    var filtered = withIndex.filter(function (wrap) {
      var p = wrap.person;
      var acq = parseYMD(p.acquisitionDate || p['입사일자']);
      if (!acq) return false;
      var loss = parseYMD(p.lossDate || p['자격상실일']);
      // 해당 연도와 재직 기간이 1일이라도 겹치면 포함
      var yearStart = year + '-01-01';
      var yearEnd = year + '-12-31';
      var acqStr = normalizeDateStr(p.acquisitionDate || p['입사일자'], null);
      if (!acqStr) return false;
      var lossStr = loss ? normalizeDateStr(p.lossDate || p['자격상실일'], null) : '';
      if (lossStr && lossStr < yearStart) return false; // 연도 시작 전 퇴사자 제외
      if (acqStr > yearEnd) return false;              // 연도 이후 입사자 제외
      return true;
    });
    filtered.sort(function (a, b) {
      var da = normalizeDateStr(a.person.acquisitionDate || a.person['입사일자'], '9999-12-31');
      var db = normalizeDateStr(b.person.acquisitionDate || b.person['입사일자'], '9999-12-31');
      if (da < db) return -1;
      if (da > db) return 1;
      return a.idx - b.idx;
    });
    return filtered.map(function (w) { return w.person; });
  }

  // ====== 상태 관리 (selectedYear, projects) ======
  var state = loadState();

  // 키보드 네비게이션 후, 리렌더링이 일어나더라도 포커스를 복구하기 위한 정보
  var pendingFocus = null; // { projectId, rowIndex, colIndex }

  // 투입 후보군 리스트 열림 상태: { projectId, filter: 'new'|'existing' }
  var openedCandidateState = { projectId: null, filter: null };

  // 인력별 연간 요약 필터: 'all' | 'cash' | 'kind'
  var annualTypeFilter = 'all';

  // 플로팅 패널: 현재 포커스된 인원/월 정보
  var currentFocusPersonId = null;
  var currentFocusMonth = null; // 1~12
  var focusOverride = null; // { personId, month, value } - 입력 중 임시 값
  var clickListenerBound = false;

  // 프로젝트별 정렬 상태 관리 (구분1/구분2 정렬용)
  // 예: sortState[projectId] = { key: 'type1' | 'type2', dir: 'asc' | 'desc' }
  var sortState = {};

  function setPendingFocus(projectId, rowIndex, colIndex) {
    pendingFocus = {
      projectId: String(projectId),
      rowIndex: rowIndex,
      colIndex: colIndex
    };
  }

  function focusRateInput(projectId, rowIndex, colIndex) {
    setPendingFocus(projectId, rowIndex, colIndex);
    // 즉시 시도
    var selector =
      '.participation-project-card[data-project-id="' + projectId + '"] ' +
      '.participation-person-row[data-row-index="' + rowIndex + '"] ' +
      '.participation-rate-input[data-col-index="' + colIndex + '"]';
    var el = document.querySelector(selector);
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  }

  function applyPendingFocus() {
    if (!pendingFocus) return;
    focusRateInput(pendingFocus.projectId, pendingFocus.rowIndex, pendingFocus.colIndex);
    pendingFocus = null;
  }

  function getSortConfig(projectId) {
    return sortState[String(projectId)] || null;
  }

  function toggleSort(projectId, key) {
    var id = String(projectId);
    var current = sortState[id] || null;
    if (!current || current.key !== key) {
      sortState[id] = { key: key, dir: 'asc' };
    } else if (current.dir === 'asc') {
      sortState[id] = { key: key, dir: 'desc' };
    } else {
      delete sortState[id]; // 정렬 해제 → 추가순으로 복귀
    }
    renderProjectView();
  }

  function normalizeParticipationState(s, defaultYear) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.selectedYear !== 'number') s.selectedYear = defaultYear;
    if (!Array.isArray(s.projects) || s.projects.length === 0) {
      s.projects = [{ id: 1, title: '새 과제', includeInSummary: true, members: [] }];
    }
    s.projects = s.projects.map(function (p) {
      if (p.includeInSummary === undefined) p.includeInSummary = true;
      if (p.is3Ch5GongTarget === undefined) p.is3Ch5GongTarget = false;
      if (!Array.isArray(p.members)) p.members = [];
      p.members = (p.members || []).map(function (m) {
        if (m.role === undefined) m.role = '참여';
        return m;
      });
      var baseYear = s.selectedYear || defaultYear;
      var rawBaseDate = (p.newPersonnelBaseDate && String(p.newPersonnelBaseDate)) || (baseYear + '-01-01');
      var cleanedBase = String(rawBaseDate).replace(/\(.*\)/g, '').trim();
      var normalizedBase = normalizeDateStr(cleanedBase, baseYear + '-01-01').slice(0, 10);
      p.newPersonnelBaseDate = normalizedBase;
      return p;
    });
    return s;
  }

  function loadState() {
    var hrData = getHrData();
    var years = extractYearsFromHrData(hrData);
    var defaultYear = years.indexOf(2026) !== -1 ? 2026 : years[0];
    var defaultState = {
      selectedYear: defaultYear,
      projects: [{ id: 1, title: '새 과제', includeInSummary: true, members: [] }]
    };
    try {
      var raw;
      if (window.firestoreService && window.firestoreService.isConfigured()) {
        raw = window.firestoreService.getParticipationState();
        if (raw && (raw.projects || raw.selectedYear != null)) {
          var normalized = normalizeParticipationState(JSON.parse(JSON.stringify(raw)), defaultYear);
          if (normalized) return normalized;
        }
        return defaultState;
      }
      raw = localStorage.getItem(PARTICIPATION_STORAGE_KEY);
      if (!raw) return defaultState;
      var s = JSON.parse(raw);
      var out = normalizeParticipationState(s, defaultYear);
      return out || defaultState;
    } catch (e) {
      console.warn('참여율 state 초기화 오류, 기본값 사용:', e);
      return { selectedYear: defaultYear, projects: [{ id: 1, title: '새 과제', includeInSummary: true, members: [], newPersonnelBaseDate: defaultYear + '-01-01' }] };
    }
  }

  function saveState() {
    try {
      if (window.firestoreService && window.firestoreService.isConfigured()) {
        window.firestoreService.saveParticipationState(state);
      } else {
        localStorage.setItem(PARTICIPATION_STORAGE_KEY, JSON.stringify(state));
      }
    } catch (e) {
      console.error('참여율 state 저장 실패:', e);
    }
  }

  function setSelectedYear(year) {
    state.selectedYear = year;
    saveState();
    renderAll();
  }

  function setProjects(projects) {
    state.projects = projects;
    saveState();
    renderProjectView(); // 연간 요약은 기존 구조를 유지하기 위해 별도 사용 가능
    // 데이터 변경 후에도 마지막 포커스 위치 복구
    applyPendingFocus();
  }

  // ====== 렌더링 ======
  function renderYearSelect() {
    if (!yearSelect && !annualYearSelect) return;
    var hrData = getHrData();
    var years = extractYearsFromHrData(hrData);
    if (years.indexOf(state.selectedYear) === -1) {
      state.selectedYear = years[0];
      saveState();
    }
    var opts = '';
    years.forEach(function (y) {
      opts += '<option value="' + y + '"' + (y === state.selectedYear ? ' selected' : '') + '>' + y + '년</option>';
    });
    if (yearSelect) yearSelect.innerHTML = opts;
    if (annualYearSelect) annualYearSelect.innerHTML = opts;
  }

  function ensureMemberRates(member) {
    if (!member) return;
    if (!member.type1) member.type1 = '기존'; // 구분1
    if (!member.type2) member.type2 = '현금'; // 구분2
    if (!member.role) member.role = '참여'; // 3책 5공 역할
    if (member.note == null) member.note = '';
    if (!member.rates) member.rates = {};
    for (var m = 1; m <= 12; m++) {
      if (member.rates[m] == null) member.rates[m] = 0;
    }
  }

  // 플로팅 패널: 현재 포커스된 인원의 월별 참여율 (합산 반영 / 미합산 반영 구분)
  function updateMonitorPanel(personId, month) {
    if (personId != null && month != null) {
      currentFocusPersonId = String(personId);
      currentFocusMonth = month;
    }

    var panel = document.getElementById('participation-floating-panel');
    var innerEl = document.getElementById('participation-floating-panel-inner');

    if (!panel || !innerEl) return;

    if (!currentFocusPersonId || !currentFocusMonth) {
      panel.hidden = true;
      return;
    }

    var hrData = getHrData();
    var year = state.selectedYear || new Date().getFullYear();
    var person = hrData.find(function (p) { return p.id === currentFocusPersonId; }) || {};
    var name = person.name || person.id || currentFocusPersonId;

    var sumIncludedCash = {};
    var sumIncludedKind = {};
    var sumExcludedCash = {};
    var sumExcludedKind = {};
    for (var m = 1; m <= 12; m++) {
      sumIncludedCash[m] = 0;
      sumIncludedKind[m] = 0;
      sumExcludedCash[m] = 0;
      sumExcludedKind[m] = 0;
    }

    var projects = Array.isArray(state.projects) ? state.projects : [];
    projects.forEach(function (proj) {
      var isIncluded = proj.includeInSummary !== false;
      (proj.members || []).forEach(function (memb) {
        if (memb.personId !== currentFocusPersonId) return;
        ensureMemberRates(memb);
        var isKind = (memb.type2 || '현금') === '현물';
        for (var mm = 1; mm <= 12; mm++) {
          var v;
          if (
            focusOverride &&
            focusOverride.personId === memb.personId &&
            focusOverride.month === mm
          ) {
            v = focusOverride.value;
          } else {
            v = parseFloat(memb.rates[mm] || 0);
          }
          if (isNaN(v)) v = 0;
          var disabled = isMonthDisabledForPerson(person, year, mm);
          if (disabled) v = 0;
          if (isIncluded) {
            if (isKind) sumIncludedKind[mm] += v;
            else sumIncludedCash[mm] += v;
          } else {
            if (isKind) sumExcludedKind[mm] += v;
            else sumExcludedCash[mm] += v;
          }
        }
      });
    });

    panel.hidden = false;

    function buildRow(label, labelCls, bulletCls, values, isIncluded) {
      var cells = '';
      for (var i = 1; i <= 12; i++) {
        var v = values[i] || 0;
        var total = isIncluded ? (sumIncludedCash[i] + sumIncludedKind[i]) : (sumExcludedCash[i] + sumExcludedKind[i]);
        var cellCls = total > 100 ? ' participation-floating-cell--over' : '';
        if (i === currentFocusMonth) cellCls += ' participation-floating-cell--focus';
        cells += '<td class="participation-floating-cell ' + labelCls + cellCls + '">' + (v ? v.toFixed(1) + '%' : '') + '</td>';
      }
      return '<tr><td class="participation-floating-label ' + labelCls + '"><span class="participation-floating-bullet ' + bulletCls + '"></span>' + label + '</td>' + cells + '</tr>';
    }

    var c35 = get35ChGongForPerson(currentFocusPersonId);
    var c35Text = (c35.ch > 0 || c35.gong > 0) ? (c35.ch + '책 ' + c35.gong + '공') : '-';
    var c35Cls = (c35.ch > 3 || c35.gong > 5) ? ' participation-floating-35--over' : '';
    var title = '<strong>' + name + '</strong>님의 참여율';
    var c35Span = '<span class="participation-floating-35' + c35Cls + '">' + c35Text + '</span>';
    var headerCells = '';
    for (var h = 1; h <= 12; h++) {
      var hCls = h === currentFocusMonth ? ' participation-floating-th--focus' : '';
      headerCells += '<th class="participation-floating-th' + hCls + '">' + h + '월</th>';
    }

    var row1 = buildRow('합산 반영 - 현금', 'participation-floating-label--included', 'participation-floating-bullet--included', sumIncludedCash, true);
    var row2 = buildRow('합산 반영 - 현물', 'participation-floating-label--included', 'participation-floating-bullet--included', sumIncludedKind, true);
    var row3 = buildRow('미합산 반영 - 현금', 'participation-floating-label--excluded', 'participation-floating-bullet--excluded', sumExcludedCash, false);
    var row4 = buildRow('미합산 반영 - 현물', 'participation-floating-label--excluded', 'participation-floating-bullet--excluded', sumExcludedKind, false);

    innerEl.innerHTML =
      '<div class="participation-floating-panel-title">' + title + ' ' + c35Span + '</div>' +
      '<table class="participation-floating-table">' +
      '<thead><tr><th class="participation-floating-th-label">항목</th>' + headerCells + '</tr></thead>' +
      '<tbody>' + row1 + row2 + row3 + row4 + '</tbody></table>';
  }

  // 페이지 바깥(카드/입력 영역 밖)을 클릭하면 플로팅 패널을 숨기는 전역 클릭 핸들러
  function bindGlobalClickListener() {
    if (clickListenerBound) return;
    clickListenerBound = true;

    document.addEventListener('click', function (e) {
      // 참여율 페이지가 아니라면 무시
      var hash = (window.location.hash || '').replace(/^#\/?/, '');
      if (hash !== 'participation') return;

      // 현재 활성 포커스 정보가 없으면 할 일 없음
      if (!currentFocusPersonId || !currentFocusMonth) return;

      var target = e.target;
      if (!target) return;

      // 아래 영역 안을 클릭하는 경우에는 패널을 유지
      if (
        target.closest('.participation-project-card') || // 카드/테이블 영역
        target.closest('.participation-floating-panel') || // 패널 자체
        target.closest('.participation-person-search') || // 검색 영역
        target.closest('.participation-card-bottom-toggles') || // 3책 5공, 참여율 합산 미반영 토글
        target.closest('.participation-candidate-area')   // 투입 후보군 리스트
      ) {
        return;
      }

      // 완전히 바깥 영역 클릭 → 포커스 정보 초기화 및 패널 숨김
      currentFocusPersonId = null;
      currentFocusMonth = null;
      focusOverride = null;
      updateMonitorPanel();
    });
  }

  function renderProjectView() {
    if (!projectCardsEl) return;
    var hrData = getHrData();
    var year = state.selectedYear || new Date().getFullYear();
    var personsSorted = getSortedPersonsForYear(hrData, year);

    projectCardsEl.innerHTML = '';

    state.projects.forEach(function (proj) {
      var card = document.createElement('div');
      card.className = 'participation-project-card';
      card.setAttribute('data-project-id', proj.id);

      // 과제명 인라인 편집 + 우측 삭제 버튼 행
      var titleRow = document.createElement('div');
      titleRow.className = 'participation-project-card-title-row';

      var title = document.createElement('div');
      title.className = 'participation-project-card-title';
      title.textContent = proj.title || proj.name || '새 과제';
      title.contentEditable = 'true';
      title.spellcheck = false;
      title.addEventListener('blur', function () {
        var text = title.textContent.trim() || '새 과제';
        var newProjects = state.projects.map(function (p) {
          if (p.id === proj.id) return Object.assign({}, p, { title: text, name: text });
          return p;
        });
        setProjects(newProjects);
      });

      var deleteProjBtn = document.createElement('button');
      deleteProjBtn.type = 'button';
      deleteProjBtn.textContent = 'X';
      deleteProjBtn.title = '프로젝트 삭제';
      deleteProjBtn.className = 'participation-project-delete-btn';

      deleteProjBtn.addEventListener('click', function () {
        if (!window.confirm('정말 삭제하시겠습니까?')) return;
        var newProjects = (state.projects || []).filter(function (p) {
          return p.id !== proj.id;
        });
        setProjects(newProjects);
        updateMonitorPanel();
      });

      // 신규 인력 기준일 DatePicker + 조회 버튼들 (카드별 독립)
      var headerControls = document.createElement('div');
      headerControls.className = 'participation-card-header-controls';

      var baseDateWrap = document.createElement('div');
      baseDateWrap.className = 'participation-base-date-wrap';
      var baseDateLabel = document.createElement('label');
      baseDateLabel.className = 'participation-base-date-label';
      baseDateLabel.textContent = '신규 인력 기준일';

      var baseDateInput = document.createElement('input');
      // 1. UX를 위해 text 타입으로 고정
      baseDateInput.setAttribute('type', 'text');
      baseDateInput.type = 'text';
      baseDateInput.className = 'participation-base-date-input';
      baseDateInput.placeholder = 'YYYY.MM.DD';

      // 공통 포맷팅 유틸 (YYYY, MM, DD 추출 후 YYYY.MM.DD / YYYY-MM-DD 반환)
      function normalizeDateForCard(raw) {
        var src = String(raw || '').replace(/[()]/g, '').trim();
        // 숫자/구분자 외 제거
        src = src.replace(/[^0-9\-\/.]/g, '');
        var digits = src.replace(/\D/g, '');
        var y = '', m = '', d = '';
        if (digits.length >= 8) {
          y = digits.slice(0, 4);
          m = digits.slice(4, 6);
          d = digits.slice(6, 8);
        } else {
          // 자리수가 부족하면 selectedYear 기준 기본값
          y = String(state.selectedYear || new Date().getFullYear());
          m = '01';
          d = '01';
        }
        var yi = parseInt(y, 10);
        var mi = Math.min(Math.max(parseInt(m || '1', 10), 1), 12);
        var di = Math.min(Math.max(parseInt(d || '1', 10), 1), 31);
        function pad2(n) { return n < 10 ? '0' + n : String(n); }
        var mm = pad2(mi);
        var dd = pad2(di);
        return {
          display: yi + '.' + mm + '.' + dd, // 화면용
          store: yi + '-' + mm + '-' + dd    // 저장용
        };
      }

      // 4. 로드 시: 저장된 하이픈 포맷을 점 포맷으로 변환하여 중앙 정렬로 보여줌
      var rawCardBaseDate = proj.newPersonnelBaseDate || (state.selectedYear + '-01-01');
      var normalized = normalizeDateForCard(rawCardBaseDate);
      console.log('Cleaning Result (baseDateInput):', rawCardBaseDate, '=>', normalized.display, '/', normalized.store);
      baseDateInput.value = normalized.display;

      // 3. Blur 시 스마트 포맷팅 + 저장 동기화
      baseDateInput.addEventListener('blur', function (e) {
        var val = (e && e.target && e.target.value) ? String(e.target.value) : '';
        var norm = normalizeDateForCard(val);
        baseDateInput.value = norm.display; // 화면에는 항상 YYYY.MM.DD

        var newProjects = state.projects.map(function (p) {
          if (p.id !== proj.id) return p;
          // DB/저장소에는 항상 YYYY-MM-DD (하이픈) 포맷으로 저장
          return Object.assign({}, p, { newPersonnelBaseDate: norm.store });
        });
        setProjects(newProjects);
      });

      // 1. 엔터 키 입력 시 blur 강제 호출 → 위 blur 로직(포맷팅+저장) 재사용
      baseDateInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          baseDateInput.blur();
        }
      });
      baseDateWrap.appendChild(baseDateLabel);
      baseDateWrap.appendChild(baseDateInput);

      var btnNew = document.createElement('button');
      btnNew.type = 'button';
      btnNew.className = 'ui-btn ui-btn--ghost participation-candidate-btn';
      btnNew.textContent = '신규 인력 조회';
      btnNew.addEventListener('click', function () {
        var next = openedCandidateState.projectId === proj.id && openedCandidateState.filter === 'new'
          ? { projectId: null, filter: null }
          : { projectId: proj.id, filter: 'new' };
        openedCandidateState.projectId = next.projectId;
        openedCandidateState.filter = next.filter;
        renderProjectView();
      });

      var btnExisting = document.createElement('button');
      btnExisting.type = 'button';
      btnExisting.className = 'ui-btn ui-btn--ghost participation-candidate-btn';
      btnExisting.textContent = '기존 인력 조회';
      btnExisting.addEventListener('click', function () {
        var next = openedCandidateState.projectId === proj.id && openedCandidateState.filter === 'existing'
          ? { projectId: null, filter: null }
          : { projectId: proj.id, filter: 'existing' };
        openedCandidateState.projectId = next.projectId;
        openedCandidateState.filter = next.filter;
        renderProjectView();
      });

      headerControls.appendChild(baseDateWrap);
      headerControls.appendChild(btnNew);
      headerControls.appendChild(btnExisting);

      titleRow.appendChild(title);
      titleRow.appendChild(headerControls);
      titleRow.appendChild(deleteProjBtn);

      var list = document.createElement('div');
      list.className = 'participation-project-card-list';

      // 헤더: 이름 | 구분2 | 1~12월 | 비고 | 삭제 (구분1 제거, 성명에 배지로 대체)
      var headerRow = document.createElement('div');
      headerRow.className = 'participation-person-row participation-person-row--header';

      var nameHead = document.createElement('span');
      nameHead.className = 'participation-person-name participation-header-sortable';
      nameHead.textContent = '이름';
      nameHead.addEventListener('click', function () {
        toggleSort(proj.id, 'type1');
      });
      if (conf && conf.key === 'type1') {
        var nameArrow = document.createElement('span');
        nameArrow.className = 'participation-header-arrow';
        nameArrow.textContent = conf.dir === 'asc' ? '▲' : '▼';
        nameHead.appendChild(nameArrow);
      }
      headerRow.appendChild(nameHead);

      var type2Head = document.createElement('span');
      type2Head.className = 'participation-month-label participation-header-sortable';
      type2Head.textContent = '구분';
      type2Head.addEventListener('click', function () {
        toggleSort(proj.id, 'type2');
      });
      headerRow.appendChild(type2Head);

      // 정렬 상태에 따라 헤더에 화살표 표시
      var conf = getSortConfig(proj.id);
      if (conf && conf.key === 'type2') {
        var arrowSpan = document.createElement('span');
        arrowSpan.className = 'participation-header-arrow';
        arrowSpan.textContent = conf.dir === 'asc' ? '▲' : '▼';
        type2Head.appendChild(arrowSpan);
      }

      for (var mm = 1; mm <= 12; mm++) {
        var monthHead = document.createElement('span');
        monthHead.className = 'participation-month-label';
        monthHead.textContent = mm + '월';
        headerRow.appendChild(monthHead);
      }

      var noteHead = document.createElement('span');
      noteHead.className = 'participation-month-label';
      noteHead.textContent = '비고';
      headerRow.appendChild(noteHead);

      var delHead = document.createElement('span');
      delHead.className = 'participation-month-label';
      delHead.textContent = '삭제';
      headerRow.appendChild(delHead);

      list.appendChild(headerRow);

      // members는 기본적으로 추가한 순서(원본 순서)를 유지
      var members = Array.isArray(proj.members) ? proj.members.slice() : [];
      members.forEach(ensureMemberRates);

      var baseDate = proj.newPersonnelBaseDate || (state.selectedYear + '-01-01');
      // 정렬 설정이 있으면 구분1(배지 기준)/구분2 기준으로 그룹 정렬
      if (conf && (conf.key === 'type1' || conf.key === 'type2')) {
        var keyed = members.map(function (m, idx) {
          var p = hrData.find(function (x) { return x.id === m.personId; });
          var autoType1 = getPersonType(p, baseDate);
          return { m: m, idx: idx, autoType1: autoType1 };
        });
        keyed.sort(function (a, b) {
          function getRank(item) {
            if (conf.key === 'type1') {
              if (item.autoType1 === '기존') return 0;
              if (item.autoType1 === '신규') return 1;
              return 2;
            } else {
              var v = item.m.type2 || '';
              if (v === '현금') return 0;
              if (v === '현물') return 1;
              return 2;
            }
          }
          var ra = getRank(a);
          var rb = getRank(b);
          var diff = conf.dir === 'asc' ? (ra - rb) : (rb - ra);
          if (diff !== 0) return diff;
          return a.idx - b.idx;
        });
        members = keyed.map(function (x) { return x.m; });
      }

      members.forEach(function (member, idx) {
        ensureMemberRates(member);
        var person = hrData.find(function (p) { return p.id === member.personId; });
        var row = document.createElement('div');
        row.className = 'participation-person-row';
        row.setAttribute('data-project-id', proj.id);
        row.setAttribute('data-person-id', member.personId);
        row.setAttribute('data-idx', String(idx));
        row.setAttribute('data-row-index', String(idx));

        // 성명 셀: 책/공 배지(클릭 토글, 상시 노출) + 신규/기존 배지 + 이름
        var nameCell = document.createElement('span');
        nameCell.className = 'participation-person-name participation-person-name-with-badge';
        var role35 = (member.role || '참여') === '책임' ? '책' : '공';
        var badge35 = document.createElement('span');
        badge35.className = 'participation-badge participation-badge--3ch5g participation-badge--3ch5g-' + (member.role === '책임' ? 'ch' : 'gong') + ' participation-badge--toggle';
        badge35.textContent = role35;
        badge35.title = '클릭 시 역할 전환 (책임 ↔ 참여)';
        badge35.addEventListener('click', function (e) {
          e.stopPropagation();
          var nextRole = (member.role || '참여') === '책임' ? '참여' : '책임';
          var newProjects2 = state.projects.map(function (p) {
            if (p.id !== proj.id) return p;
            var newMembers2 = (p.members || []).map(function (m) {
              if (m.personId !== member.personId) return m;
              return Object.assign({}, m, { role: nextRole });
            });
            return Object.assign({}, p, { members: newMembers2 });
          });
          setProjects(newProjects2);
          renderProjectView();
          if (annualTableWrap && viewAnnual && !viewAnnual.hidden) renderAnnualView();
          updateMonitorPanel();
        });
        nameCell.appendChild(badge35);
        var personType = getPersonType(person, baseDate);
        var badge = document.createElement('span');
        badge.className = 'participation-badge participation-badge--' + (personType === '신규' ? 'new' : 'existing');
        badge.textContent = personType;
        nameCell.appendChild(badge);
        var nameTxt = document.createElement('span');
        nameTxt.className = 'participation-person-name-text';
        nameTxt.textContent = person ? (person.name || member.personId) : member.personId;
        nameCell.appendChild(nameTxt);
        row.appendChild(nameCell);

        // 구분2 셀렉트 (현금/현물)
        var type2Select = document.createElement('select');
        type2Select.className = 'participation-type-select';
        ['현금', '현물'].forEach(function (label2) {
          var opt2 = document.createElement('option');
          opt2.value = label2;
          opt2.textContent = label2;
          if (member.type2 === label2) opt2.selected = true;
          type2Select.appendChild(opt2);
        });
        type2Select.addEventListener('change', function () {
          var newProjects2 = state.projects.map(function (p) {
            if (p.id !== proj.id) return p;
            var newMembers2 = (p.members || []).map(function (m) {
              if (m.personId !== member.personId) return m;
              return Object.assign({}, m, { type2: type2Select.value });
            });
            return Object.assign({}, p, { members: newMembers2 });
          });
          setProjects(newProjects2);
          updateMonitorPanel();
        });
        // 구분2에서 Tab 시, 바로 오른쪽 첫 번째 참여율 칸(1월)로 이동
        type2Select.addEventListener('keydown', function (e) {
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            focusRateInput(proj.id, idx, 0);
          }
        });
        row.appendChild(type2Select);

        // 1~12월 입력 (숫자 입력 + % 자동 표시, 방향키 이동)
        for (var m = 1; m <= 12; m++) {
          (function (month, colIndex) {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'participation-rate-input';
            input.setAttribute('data-col-index', String(colIndex));
            input.setAttribute('data-row-index', String(idx));
            input.setAttribute('data-project-id', String(proj.id));
            var disabled = isMonthDisabledForPerson(person, year, month);
            if (disabled) {
              input.disabled = true;
              input.classList.add('participation-rate-input--disabled');
            }
            var baseVal = member.rates[month] != null ? member.rates[month] : 0;
            input.value = disabled ? '0' : (baseVal ? baseVal + '%' : '');

            input.addEventListener('focus', function () {
              var v = input.value.replace('%', '').trim();
              input.value = v;
              input.select();
              // 현재 포커스 위치를 기록해 리렌더 후 복구
              setPendingFocus(proj.id, idx, colIndex);
              // 플로팅 패널 기준 인원/월 설정
              updateMonitorPanel(member.personId, month);
            });

            input.addEventListener('blur', function () {
              var n = parseFloat(input.value);
              if (isNaN(n)) n = 0;
              var newProjects = state.projects.map(function (p) {
                if (p.id !== proj.id) return p;
                var newMembers = (p.members || []).map(function (memb) {
                  if (memb.personId !== member.personId) return memb;
                  var newRates = Object.assign({}, memb.rates);
                  newRates[month] = n;
                  return Object.assign({}, memb, { rates: newRates });
                });
                return Object.assign({}, p, { members: newMembers });
              });
              setProjects(newProjects);
              input.value = n ? n + '%' : '';
              // 입력값이 확정되었으므로 override 초기화 후 재계산
              focusOverride = null;
              updateMonitorPanel(member.personId, month);
            });

            // 입력 중에도 실시간으로 플로팅 패널 합계 갱신
            input.addEventListener('input', function () {
              var n = parseFloat(input.value);
              if (isNaN(n)) n = 0;
              focusOverride = {
                personId: member.personId,
                month: month,
                value: n
              };
              updateMonitorPanel(member.personId, month);
            });

            input.addEventListener('keydown', function (e) {
              var cardEl = row.closest('.participation-project-card');
              var rowIndex = idx;
              var colIdx = colIndex;

              // Tab: 엑셀처럼 12월 -> 다음 행 1월
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                if (colIdx === 11) {
                  // 다음 행 첫 번째 월
                  var dataRows = cardEl ? cardEl.querySelectorAll('.participation-person-row:not(.participation-person-row--header)') : null;
                  if (dataRows) {
                    var nextRowIndex = rowIndex + 1;
                    if (nextRowIndex < dataRows.length) {
                      focusRateInput(proj.id, nextRowIndex, 0);
                    }
                  }
                } else {
                  // 같은 행 다음 월
                  focusRateInput(proj.id, rowIndex, colIdx + 1);
                }
                return;
              }

              if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (colIdx < 11) {
                  focusRateInput(proj.id, rowIndex, colIdx + 1);
                }
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (colIdx > 0) {
                  focusRateInput(proj.id, rowIndex, colIdx - 1);
                }
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (rowIndex > 0) {
                  focusRateInput(proj.id, rowIndex - 1, colIdx);
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                var dataRows2 = cardEl ? cardEl.querySelectorAll('.participation-person-row:not(.participation-person-row--header)') : null;
                if (dataRows2 && rowIndex < dataRows2.length - 1) {
                  focusRateInput(proj.id, rowIndex + 1, colIdx);
                }
              }
            });

            row.appendChild(input);
          })(m, m - 1);
        }

        // 비고
        var noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.className = 'participation-note-input';
        noteInput.value = member.note || '';
        noteInput.addEventListener('blur', function () {
          var newProjects = state.projects.map(function (p) {
            if (p.id !== proj.id) return p;
            var newMembers = (p.members || []).map(function (memb) {
              if (memb.personId !== member.personId) return memb;
              return Object.assign({}, memb, { note: noteInput.value });
            });
            return Object.assign({}, p, { members: newMembers });
          });
          setProjects(newProjects);
        });
        row.appendChild(noteInput);

        // 삭제 버튼 (행 삭제)
        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ui-btn participation-remove-person-btn';
        deleteBtn.textContent = '삭제';
        deleteBtn.addEventListener('click', function () {
          if (!window.confirm('정말 삭제하시겠습니까?')) return;
          var newProjects = state.projects.map(function (p) {
            if (p.id !== proj.id) return p;
            var newMembers = (p.members || []).filter(function (memb) {
              return memb.personId !== member.personId;
            });
            return Object.assign({}, p, { members: newMembers });
          });
          setProjects(newProjects);
          updateMonitorPanel();
        });
        row.appendChild(deleteBtn);

        list.appendChild(row);
      });

      // 인원 추가: 검색형 드롭다운 (searchable select) + 연간 요약 포함 여부 토글
      var addRow = document.createElement('div');
      addRow.className = 'participation-add-person-row';

      var searchWrap = document.createElement('div');
      searchWrap.className = 'participation-person-search';

      var searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'participation-person-search-input';
      searchInput.placeholder = '인력 추가 : 이름 검색 후 선택';
      searchInput.setAttribute('autocomplete', 'off');

      var dropdown = document.createElement('div');
      dropdown.className = 'participation-person-search-list';
      dropdown.setAttribute('data-project-id', proj.id);

      var existingIds = members.map(function (m) { return m.personId; });
      var activeIndex = -1;

      function addMemberToProject(personId) {
        if (!personId) return;
        if (existingIds.indexOf(personId) !== -1) return;
        var newMember = { personId: personId, rates: {} };
        ensureMemberRates(newMember);
        var newProjects = state.projects.map(function (p) {
          if (p.id !== proj.id) return p;
          var newMembers = (p.members || []).slice();
          // 새 인원은 항상 목록의 맨 마지막에 추가
          newMembers.push(newMember);
          return Object.assign({}, p, { members: newMembers });
        });
        setProjects(newProjects);
        // 입력창 초기화 및 목록 업데이트
        searchInput.value = '';
        activeIndex = -1;
        existingIds.push(personId);
        renderDropdown(); // 아래에서 정의
        searchInput.focus();

        // 인원 리스트 맨 아래로 부드럽게 스크롤
        var cardEl = document.querySelector('.participation-project-card[data-project-id="' + proj.id + '"]');
        if (cardEl) {
          var lastRow = cardEl.querySelector('.participation-person-row:last-of-type');
          if (lastRow) {
            lastRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }

      function getPersonTotalParticipationForMonth(personId, month) {
        var projects = Array.isArray(state.projects)
          ? state.projects.filter(function (p) { return p.includeInSummary !== false; })
          : [];
        var total = 0;
        projects.forEach(function (proj) {
          (proj.members || []).forEach(function (m) {
            if (m.personId !== personId) return;
            ensureMemberRates(m);
            var v = parseFloat(m.rates[month] || 0);
            if (!isNaN(v)) total += v;
          });
        });
        return total;
      }

      function renderDropdown() {
        dropdown.innerHTML = '';
        var term = searchInput.value.trim().toLowerCase();
        var newCandidates = [];
        var existingCandidates = [];

        if (!term) {
          activeIndex = -1;
          return;
        }

        var editMonth = (new Date().getMonth() + 1);
        var baseDate = proj.newPersonnelBaseDate || (state.selectedYear + '-01-01');

        personsSorted.forEach(function (p) {
          if (existingIds.indexOf(p.id) !== -1) return;
          var name = p.name || p.id;
          if (name && name.toLowerCase().indexOf(term) === -1) return;
          var isNew = isNewPersonnel(p, baseDate);
          if (isNew) {
            newCandidates.push(p);
          } else {
            existingCandidates.push(p);
          }
        });

        var allCandidates = newCandidates.concat(existingCandidates);
        if (allCandidates.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'participation-person-search-empty';
          empty.textContent = '검색 결과가 없습니다.';
          dropdown.appendChild(empty);
          activeIndex = -1;
          return;
        }

        if (activeIndex >= allCandidates.length) activeIndex = allCandidates.length - 1;

        function addSection(title, list) {
          if (list.length === 0) return;
          var section = document.createElement('div');
          section.className = 'participation-person-search-section';
          var header = document.createElement('div');
          header.className = 'participation-person-search-section-header';
          header.textContent = title;
          section.appendChild(header);
          list.forEach(function (p) {
            var item = document.createElement('div');
            item.className = 'participation-person-search-item';
            var idx = allCandidates.indexOf(p);
            if (idx === activeIndex) item.classList.add('participation-person-search-item--active');
            var rate = getPersonTotalParticipationForMonth(p.id, editMonth);
            var typeLabel = isNewPersonnel(p, baseDate) ? '신규' : '기존';
            var rateStr = editMonth + '월 총 참여율: ' + rate.toFixed(1) + '%';
            item.innerHTML = '<span class="participation-search-item-name">' + (p.name || p.id) + ' [' + typeLabel + ']</span> <span class="participation-search-item-rate">(' + rateStr + ')</span>';
            item.setAttribute('data-person-id', p.id);
            item.setAttribute('data-candidate-index', String(idx));
            item.addEventListener('mousedown', function (e) {
              e.preventDefault();
              addMemberToProject(p.id);
            });
            section.appendChild(item);
          });
          dropdown.appendChild(section);
        }

        addSection('신규 인력', newCandidates);
        addSection('기존 인력', existingCandidates);
      }

      searchInput.addEventListener('input', function () {
        activeIndex = 0;
        renderDropdown();
      });

      searchInput.addEventListener('focus', function () {
        renderDropdown();
      });

      searchInput.addEventListener('keydown', function (e) {
        var items = dropdown.querySelectorAll('.participation-person-search-item');
        if (e.key === 'ArrowDown') {
          if (items.length === 0) return;
          e.preventDefault();
          activeIndex = (activeIndex + 1) % items.length;
          renderDropdown();
        } else if (e.key === 'ArrowUp') {
          if (items.length === 0) return;
          e.preventDefault();
          activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
          renderDropdown();
        } else if (e.key === 'Enter') {
          if (items.length === 0) return;
          e.preventDefault();
          var target = items[activeIndex >= 0 ? activeIndex : 0];
          if (target) {
            var pid = target.getAttribute('data-person-id');
            addMemberToProject(pid);
          }
        }
      });

      searchWrap.appendChild(searchInput);
      searchWrap.appendChild(dropdown);
      addRow.appendChild(searchWrap);

      // 투입 후보군 리스트 (신규/기존 조회 버튼 클릭 시 펼침)
      var candidateArea = document.createElement('div');
      candidateArea.className = 'participation-candidate-area';
      candidateArea.setAttribute('data-project-id', proj.id);

      if (openedCandidateState.projectId === proj.id && openedCandidateState.filter) {
        candidateArea.hidden = false;
        candidateArea.classList.add('participation-candidate-area--open');

        var existingIds = (proj.members || []).map(function (m) { return m.personId; });
        var baseDate = proj.newPersonnelBaseDate || (state.selectedYear + '-01-01');
        var projects = (state.projects || []).filter(function (p) { return p.includeInSummary !== false; });

        var candidates = personsSorted.filter(function (p) {
          if (existingIds.indexOf(p.id) !== -1) return false;
          var isNew = isNewPersonnel(p, baseDate);
          return openedCandidateState.filter === 'new' ? isNew : !isNew;
        });

        var tableWrap = document.createElement('div');
        tableWrap.className = 'participation-candidate-table-wrap';

        var table = document.createElement('table');
        table.className = 'participation-candidate-table';

        var thead = document.createElement('thead');
        var headerTr = document.createElement('tr');
        var thName = document.createElement('th');
        thName.className = 'participation-candidate-th-name';
        thName.textContent = '성명';
        headerTr.appendChild(thName);
        var thJoin = document.createElement('th');
        thJoin.className = 'participation-candidate-th-join';
        thJoin.textContent = '입사일';
        headerTr.appendChild(thJoin);
        for (var mm = 1; mm <= 12; mm++) {
          var th = document.createElement('th');
          th.textContent = mm + '월';
          th.className = 'participation-candidate-th-month';
          headerTr.appendChild(th);
        }
        var thAdd = document.createElement('th');
        thAdd.className = 'participation-candidate-th-add';
        thAdd.textContent = '추가';
        headerTr.appendChild(thAdd);
        thead.appendChild(headerTr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        if (candidates.length === 0) {
          var emptyRow = document.createElement('tr');
          emptyRow.innerHTML = '<td colspan="15" class="participation-candidate-empty">해당 조건의 후보가 없습니다.</td>';
          tbody.appendChild(emptyRow);
        } else {
          candidates.forEach(function (person) {
            var tr = document.createElement('tr');
            var personType = getPersonType(person, baseDate);
            var badgeCls = personType === '신규' ? 'participation-badge participation-badge--new' : 'participation-badge participation-badge--existing';
            var nameTd = document.createElement('td');
            nameTd.className = 'participation-candidate-td-name';
            nameTd.innerHTML = '<span class="' + badgeCls + '">' + personType + '</span> ' + (person.name || person.id || '-');
            tr.appendChild(nameTd);

            var joinTd = document.createElement('td');
            joinTd.className = 'participation-candidate-td-join';
            joinTd.textContent = person.acquisitionDate || person['입사일자'] || '-';
            tr.appendChild(joinTd);

            var totals = getMonthlyTotalsForPerson(person.id, projects);
            var year = state.selectedYear || new Date().getFullYear();

            for (var mmm = 1; mmm <= 12; mmm++) {
              var cellTd = document.createElement('td');
              cellTd.className = 'participation-candidate-td-month';
              var v = totals[mmm] || 0;
              var disabled = isMonthDisabledForPerson(person, year, mmm);
              if (disabled) {
                cellTd.classList.add('participation-annual-cell--disabled');
                v = 0;
              }
              if (!disabled && v > 100) {
                cellTd.classList.add('participation-annual-cell--over');
              }
              cellTd.textContent = v ? v.toFixed(1) + '%' : '';
              tr.appendChild(cellTd);
            }

            var addTd = document.createElement('td');
            addTd.className = 'participation-candidate-td-add';
            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'ui-btn participation-candidate-add-btn';
            addBtn.textContent = '+';
            addBtn.title = '프로젝트에 추가';
            addBtn.addEventListener('click', function () {
              addMemberToProject(person.id);
            });
            addTd.appendChild(addBtn);
            tr.appendChild(addTd);

            tbody.appendChild(tr);
          });
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        candidateArea.appendChild(tableWrap);
      } else {
        candidateArea.hidden = true;
      }

      // 우측 하단 체크박스 통합: 3책 5공 | 참여율 합산 미반영
      var togglesWrap = document.createElement('div');
      togglesWrap.className = 'participation-card-bottom-toggles';

      var ch35Wrap = document.createElement('label');
      ch35Wrap.className = 'participation-3ch5g-target-wrap';
      var ch35Check = document.createElement('input');
      ch35Check.type = 'checkbox';
      ch35Check.checked = proj.is3Ch5GongTarget === true;
      ch35Check.addEventListener('change', function () {
        var newProjects = state.projects.map(function (p) {
          if (p.id !== proj.id) return p;
          return Object.assign({}, p, { is3Ch5GongTarget: ch35Check.checked });
        });
        setProjects(newProjects);
        renderProjectView();
        if (annualTableWrap && viewAnnual && !viewAnnual.hidden) renderAnnualView();
      });
      var ch35Text = document.createElement('span');
      ch35Text.textContent = '3책 5공';
      ch35Wrap.appendChild(ch35Check);
      ch35Wrap.appendChild(ch35Text);

      var summaryWrap = document.createElement('label');
      summaryWrap.className = 'participation-summary-toggle';

      var summaryCheckbox = document.createElement('input');
      summaryCheckbox.type = 'checkbox';
      summaryCheckbox.checked = proj.includeInSummary === false;
      summaryCheckbox.addEventListener('change', function () {
        var newProjects = (state.projects || []).map(function (p) {
          if (p.id !== proj.id) return p;
          return Object.assign({}, p, { includeInSummary: !summaryCheckbox.checked });
        });
        setProjects(newProjects);
        renderAnnualView();
      });

      var summaryText = document.createElement('span');
      summaryText.textContent = '참여율 합산 미반영';

      summaryWrap.appendChild(summaryCheckbox);
      summaryWrap.appendChild(summaryText);
      togglesWrap.appendChild(ch35Wrap);
      togglesWrap.appendChild(summaryWrap);
      addRow.appendChild(togglesWrap);

      card.appendChild(titleRow);
      card.appendChild(list);
      card.appendChild(candidateArea);
      card.appendChild(addRow);
      projectCardsEl.appendChild(card);
    });

    // 카드 렌더링 후 모니터링 패널 갱신
    updateMonitorPanel();
  }

  // ====== 인력별 연간 요약 뷰 렌더링 ======
  function renderAnnualView() {
    if (!annualTableWrap) return;

    var hrData = getHrData();
    var year = state.selectedYear || new Date().getFullYear();
    var persons = getSortedPersonsForYear(hrData, year);

    var searchTerm = (annualSearchInput && annualSearchInput.value) ? annualSearchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
      persons = persons.filter(function (p) {
        var name = (p.name || p.id || '').toLowerCase();
        return name.indexOf(searchTerm) !== -1;
      });
    }

    var projects = Array.isArray(state.projects)
      ? state.projects.filter(function (p) { return p.includeInSummary !== false; })
      : [];

    // 테이블 기본 구조 (이름 | 3책 5공 | 구분 | 1~12월)
    var html = '';
    html += '<table class="participation-annual-table">';
    html += '<thead><tr>';
    html += '<th>이름</th>';
    html += '<th class="participation-annual-th-35">3책 5공</th>';
    html += '<th>구분</th>';
    for (var m = 1; m <= 12; m++) {
      html += '<th>' + m + '월</th>';
    }
    html += '</tr></thead>';
    html += '<tbody>';

    if (!persons || persons.length === 0) {
      var emptyMsg = searchTerm ? '검색 결과가 없습니다.' : '데이터가 없습니다.';
      html += '<tr><td colspan="15" class="participation-annual-empty">' + emptyMsg + '</td></tr>';
      html += '</tbody></table>';
      annualTableWrap.innerHTML = html;
      return;
    }

    persons.forEach(function (person) {
      var byType = getMonthlyTotalsByTypeForPerson(person.id, projects);
      var c35 = get35ChGongForPerson(person.id);
      var name = person.name || person.id || '-';
      var loss = person.lossDate || person['자격상실일'];
      if (loss) name += ' (퇴사)';

      var showCash = (annualTypeFilter === 'all' || annualTypeFilter === 'cash');
      var showKind = (annualTypeFilter === 'all' || annualTypeFilter === 'kind');
      var useRowspan = annualTypeFilter === 'all';

      var c35Text = (c35.ch > 0 || c35.gong > 0) ? (c35.ch + '책 ' + c35.gong + '공') : '-';
      var c35Cls = 'participation-annual-35';
      if (c35.ch > 3 || c35.gong > 5) c35Cls += ' participation-annual-35--over';

      function buildRow(typeLabel, values, isKindRow) {
        var rowHtml = '';
        var includeRow = (isKindRow && showKind) || (!isKindRow && showCash);
        if (includeRow) {
          var nameCell;
          var c35Cell;
          if (useRowspan) {
            nameCell = isKindRow ? '' : ('<td rowspan="2" class="participation-annual-name participation-annual-name-cell">' + name + '</td>');
            c35Cell = isKindRow ? '' : ('<td rowspan="2" class="' + c35Cls + '">' + c35Text + '</td>');
          } else {
            nameCell = '<td class="participation-annual-name participation-annual-name-cell">' + name + '</td>';
            c35Cell = '<td class="' + c35Cls + '">' + c35Text + '</td>';
          }
          var typeCell = '<td class="participation-annual-type participation-annual-type--' + (isKindRow ? 'kind' : 'cash') + '">' + typeLabel + '</td>';
          rowHtml = '<tr>' + nameCell + c35Cell + typeCell;
          for (var mm = 1; mm <= 12; mm++) {
            var v = values[mm] || 0;
            var cls = 'participation-annual-cell';
            var disabled = isMonthDisabledForPerson(person, year, mm);
            if (disabled) {
              cls += ' participation-annual-cell--disabled';
              v = 0;
            }
            if (!disabled && v > 100) cls += ' participation-annual-cell--over';
            if (isKindRow) cls += ' participation-annual-row--kind';
            rowHtml += '<td class="' + cls + '">' + (v ? v.toFixed(1) + '%' : '') + '</td>';
          }
          rowHtml += '</tr>';
        }
        return rowHtml;
      }

      html += buildRow('현금', byType.cash, false);
      html += buildRow('현물', byType.kind, true);
    });

    html += '</tbody></table>';
    annualTableWrap.innerHTML = html;
  }

  function renderAll() {
    renderYearSelect();
    renderProjectView();
    applyPendingFocus();
  }

  // ====== 라우팅 / 초기화 ======
  function switchView(view) {
    if (viewProject) {
      viewProject.hidden = view !== 'project';
      viewProject.setAttribute('aria-hidden', view !== 'project');
    }
    if (viewAnnual) {
      viewAnnual.hidden = view !== 'annual';
      viewAnnual.setAttribute('aria-hidden', view !== 'annual');
      if (view === 'annual') {
        renderYearSelect();
        renderAnnualView();
      }
    }

    // 탭 버튼 active 상태 동기화 (activeTab 역할)
    if (tabProject && tabAnnual) {
      if (view === 'project') {
        tabProject.classList.add('active');
        tabAnnual.classList.remove('active');
      } else if (view === 'annual') {
        tabAnnual.classList.add('active');
        tabProject.classList.remove('active');
      }
    }
  }

  function onParticipationRoute() {
    var hash = (window.location.hash || '').replace(/^#\/?/, '');
    if (hash !== 'participation') return;
    // 참여율 페이지 진입 시 전역 클릭 리스너 바인딩
    bindGlobalClickListener();
    switchView('project');
    renderAll();
  }

  if (yearSelect) {
    yearSelect.addEventListener('change', function () {
      var v = parseInt(yearSelect.value, 10);
      if (!isNaN(v)) setSelectedYear(v);
    });
  }

  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', function () {
      var baseDate = (state.selectedYear || new Date().getFullYear()) + '-01-01';
      var newProj = { id: Date.now(), title: '새 과제', includeInSummary: true, members: [], newPersonnelBaseDate: baseDate };
      setProjects((state.projects || []).concat([newProj]));
    });
  }

  if (tabProject) tabProject.addEventListener('click', function () { switchView('project'); });
  if (tabAnnual) tabAnnual.addEventListener('click', function () { switchView('annual'); });

  if (annualSearchInput) {
    annualSearchInput.addEventListener('input', function () {
      var viewAnnualEl = document.getElementById('participation-view-annual');
      if (viewAnnualEl && !viewAnnualEl.hidden) renderAnnualView();
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest('.participation-annual-filter-btn');
    if (!btn) return;
    annualTypeFilter = btn.getAttribute('data-filter') || 'all';
    document.querySelectorAll('.participation-annual-filter-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-filter') === annualTypeFilter);
    });
    var viewAnnualEl = document.getElementById('participation-view-annual');
    if (viewAnnualEl && !viewAnnualEl.hidden) renderAnnualView();
  });

  window.addEventListener('hashchange', onParticipationRoute);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onParticipationRoute);
  } else {
    onParticipationRoute();
  }

  if (window.firestoreService && window.firestoreService.subscribeParticipation) {
    window.firestoreService.subscribeParticipation(function (newState) {
      if (!newState || typeof newState !== 'object') return;
      var hrData = getHrData();
      var years = extractYearsFromHrData(hrData);
      var defaultYear = years.indexOf(2026) !== -1 ? 2026 : years[0];
      var normalized = normalizeParticipationState(JSON.parse(JSON.stringify(newState)), defaultYear);
      if (normalized) {
        state = normalized;
        renderAll();
      }
    });
  }
})();


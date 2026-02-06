// ParticipationManagement.js
// 참여율 관리 상세 입력 뷰를 단순하고 안전한 구조로 재구성한 버전입니다.
// - Shell/터미널 명령은 전혀 사용하지 않고, 이 파일 하나만으로 동작하도록 작성했습니다.
// - state: selectedYear, projects
// - projects: [{ id, title, members: [{ personId, rates: {1:0,...,12:0} }] }]

(function () {
  'use strict';

  var HR_STORAGE_KEY = 'hr-management-data';
  var PARTICIPATION_STORAGE_KEY = 'hr-participation-data-v2';

  var viewProject = document.getElementById('participation-view-project');
  var viewAnnual = document.getElementById('participation-view-annual');
  var tabProject = document.getElementById('participation-tab-project');
  var tabAnnual = document.getElementById('participation-tab-annual');

  var yearSelect = document.getElementById('participation-year');
  var annualYearSelect = document.getElementById('participation-annual-year');
  var projectCardsEl = document.getElementById('participation-project-cards');
  var annualTableWrap = document.getElementById('participation-annual-table-wrap');
  var addProjectBtn = document.getElementById('participation-add-project-btn');

  // ====== 데이터 원천: hrData ======
  function getHrData() {
    try {
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

  function loadState() {
    var hrData = getHrData();
    var years = extractYearsFromHrData(hrData);
    var defaultYear = years.indexOf(2026) !== -1 ? 2026 : years[0];
    try {
      var raw = localStorage.getItem(PARTICIPATION_STORAGE_KEY);
      if (!raw) {
        return {
          selectedYear: defaultYear,
          projects: [{ id: 1, title: '새 과제', includeInSummary: true, members: [] }]
        };
      }
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') throw new Error('bad state');
      if (typeof s.selectedYear !== 'number') s.selectedYear = defaultYear;
      if (!Array.isArray(s.projects) || s.projects.length === 0) {
        s.projects = [{ id: 1, title: '새 과제', includeInSummary: true, members: [] }];
      }
      // 프로젝트 기본 필드 보정 (includeInSummary 기본 true)
      s.projects = s.projects.map(function (p) {
        if (p.includeInSummary === undefined) p.includeInSummary = true;
        if (!Array.isArray(p.members)) p.members = [];
        return p;
      });
      return s;
    } catch (e) {
      console.warn('참여율 state 초기화 오류, 기본값 사용:', e);
      return {
        selectedYear: defaultYear,
        projects: [{ id: 1, title: '새 과제', includeInSummary: true, members: [] }]
      };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(PARTICIPATION_STORAGE_KEY, JSON.stringify(state));
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
    if (member.note == null) member.note = '';
    if (!member.rates) member.rates = {};
    for (var m = 1; m <= 12; m++) {
      if (member.rates[m] == null) member.rates[m] = 0;
    }
  }

  // 우측 하단 플로팅 패널: 현재 포커스된 인원의 해당 월 합계 (현금/현물 분리)
  function updateMonitorPanel(personId, month) {
    // personId, month가 넘어오면 현재 포커스 정보로 갱신
    if (personId != null && month != null) {
      currentFocusPersonId = String(personId);
      currentFocusMonth = month;
    }

    var panel = document.getElementById('participation-floating-panel');
    var titleEl = document.getElementById('participation-floating-name'); // 기존 구조 활용
    var sumEl = document.getElementById('participation-floating-sum');
    var titleBarEl = document.querySelector('.participation-floating-panel-title');

    if (!panel || !titleEl || !sumEl || !titleBarEl) return;

    if (!currentFocusPersonId || !currentFocusMonth) {
      panel.hidden = true;
      return;
    }

    var hrData = getHrData();
    var year = state.selectedYear || new Date().getFullYear();
    var person = hrData.find(function (p) { return p.id === currentFocusPersonId; }) || {};
    var name = person.name || person.id || currentFocusPersonId;

    var cashTotal = 0;
    var kindTotal = 0;

    // includeInSummary 가 false 인 프로젝트는 플로팅 패널 합산에서도 제외
    var projects = Array.isArray(state.projects)
      ? state.projects.filter(function (p) { return p.includeInSummary !== false; })
      : [];

    projects.forEach(function (proj) {
      (proj.members || []).forEach(function (m) {
        if (m.personId !== currentFocusPersonId) return;
        ensureMemberRates(m);
        var v;
        if (
          focusOverride &&
          focusOverride.personId === m.personId &&
          focusOverride.month === currentFocusMonth
        ) {
          v = focusOverride.value;
        } else {
          v = parseFloat(m.rates[currentFocusMonth] || 0);
        }
        if (isNaN(v)) v = 0;

        var disabled = isMonthDisabledForPerson(person, year, currentFocusMonth);
        if (disabled) v = 0;

        if (m.type2 === '현물') {
          kindTotal += v;
        } else {
          cashTotal += v;
        }
      });
    });

    panel.hidden = false;
    // 제목: "[이름]님의 [n]월 참여율 합계" (이름과 n월만 굵게)
    titleBarEl.innerHTML =
      '<strong>' + name + '</strong>' +
      '님의 ' +
      '<strong>' + currentFocusMonth + '월</strong>' +
      ' 참여율 합계';
    // 두 번째 줄: "현금: n% / 현물: n%"
    titleEl.textContent = ''; // 이름 라인은 사용하지 않음

    var total = cashTotal + kindTotal;
    sumEl.textContent =
      '현금: ' + cashTotal.toFixed(1) + '%  /  현물: ' + kindTotal.toFixed(1) + '%';

    // 100% 초과 경고 스타일 적용
    if (total > 100) {
      sumEl.style.color = '#ff0000';
      sumEl.style.fontWeight = '800';
      sumEl.style.fontSize = '1.25rem';
    } else {
      sumEl.style.color = '#1d4ed8'; // 신뢰감 있는 블루 (기본)
      sumEl.style.fontWeight = '700';
      sumEl.style.fontSize = '1.1rem';
    }
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
        target.closest('.participation-summary-toggle')   // 요약 포함 토글
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

      titleRow.appendChild(title);
      titleRow.appendChild(deleteProjBtn);

      var list = document.createElement('div');
      list.className = 'participation-project-card-list';

      // 헤더: 이름 | 구분1 | 구분2 | 1~12월 | 비고 | 삭제
      var headerRow = document.createElement('div');
      headerRow.className = 'participation-person-row participation-person-row--header';

      var nameHead = document.createElement('span');
      nameHead.className = 'participation-person-name';
      nameHead.textContent = '이름';
      headerRow.appendChild(nameHead);

      var type1Head = document.createElement('span');
      type1Head.className = 'participation-month-label participation-header-sortable';
      type1Head.textContent = '구분1';
      type1Head.addEventListener('click', function () {
        toggleSort(proj.id, 'type1');
      });
      headerRow.appendChild(type1Head);

      var type2Head = document.createElement('span');
      type2Head.className = 'participation-month-label participation-header-sortable';
      type2Head.textContent = '구분2';
      type2Head.addEventListener('click', function () {
        toggleSort(proj.id, 'type2');
      });
      headerRow.appendChild(type2Head);

      // 정렬 상태에 따라 헤더에 화살표 표시
      var conf = getSortConfig(proj.id);
      if (conf && (conf.key === 'type1' || conf.key === 'type2')) {
        var arrowSpan = document.createElement('span');
        arrowSpan.className = 'participation-header-arrow';
        arrowSpan.textContent = conf.dir === 'asc' ? '▲' : '▼';
        if (conf.key === 'type1') {
          type1Head.appendChild(arrowSpan);
        } else {
          type2Head.appendChild(arrowSpan);
        }
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

      // 정렬 설정이 있으면 구분1/구분2 기준으로 그룹 정렬 (그룹 내 순서는 원래 추가 순서 유지)
      if (conf && (conf.key === 'type1' || conf.key === 'type2')) {
        var keyed = members.map(function (m, idx) { return { m: m, idx: idx }; });
        keyed.sort(function (a, b) {
          function getRank(member) {
            var v = conf.key === 'type1' ? (member.type1 || '') : (member.type2 || '');
            if (conf.key === 'type1') {
              if (v === '기존') return 0;
              if (v === '신규') return 1;
              return 2;
            } else {
              if (v === '현금') return 0;
              if (v === '현물') return 1;
              return 2;
            }
          }
          var ra = getRank(a.m);
          var rb = getRank(b.m);
          var diff = conf.dir === 'asc' ? (ra - rb) : (rb - ra);
          if (diff !== 0) return diff;
          // 같은 그룹 내에서는 추가 순서를 유지
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

        var nameCell = document.createElement('span');
        nameCell.className = 'participation-person-name';
        nameCell.textContent = person ? (person.name || member.personId) : member.personId;
        row.appendChild(nameCell);

        // 구분1 셀렉트 (기존/신규)
        var type1Select = document.createElement('select');
        type1Select.className = 'participation-type-select';
        ['기존', '신규'].forEach(function (label) {
          var opt = document.createElement('option');
          opt.value = label;
          opt.textContent = label;
          if (member.type1 === label) opt.selected = true;
          type1Select.appendChild(opt);
        });
        type1Select.addEventListener('change', function () {
          var newProjects = state.projects.map(function (p) {
            if (p.id !== proj.id) return p;
            var newMembers = (p.members || []).map(function (m) {
              if (m.personId !== member.personId) return m;
              return Object.assign({}, m, { type1: type1Select.value });
            });
            return Object.assign({}, p, { members: newMembers });
          });
          setProjects(newProjects);
          updateMonitorPanel();
        });
        // 구분1에서 Tab 시, 바로 오른쪽 첫 번째 참여율 칸(1월)로 이동
        type1Select.addEventListener('keydown', function (e) {
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            focusRateInput(proj.id, idx, 0);
          }
        });
        row.appendChild(type1Select);

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

      function renderDropdown() {
        dropdown.innerHTML = '';
        var term = searchInput.value.trim().toLowerCase();
        var candidates = [];

        // 검색어가 없으면 리스트를 표시하지 않음
        if (!term) {
          activeIndex = -1;
          return;
        }

        personsSorted.forEach(function (p) {
          if (existingIds.indexOf(p.id) !== -1) return;
          var name = p.name || p.id;
          if (name && name.toLowerCase().indexOf(term) === -1) return;
          candidates.push(p);
        });

        if (candidates.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'participation-person-search-empty';
          empty.textContent = '검색 결과가 없습니다.';
          dropdown.appendChild(empty);
          activeIndex = -1;
          return;
        }

        if (activeIndex >= candidates.length) activeIndex = candidates.length - 1;

        candidates.forEach(function (p, idx) {
          var item = document.createElement('div');
          item.className = 'participation-person-search-item';
          if (idx === activeIndex) item.classList.add('participation-person-search-item--active');
          var nameTxt = p.name || p.id;
          var company = p.division || p['회사'] || '';
          var dept = p.department || p['소속'] || '';
          var meta = '';
          if (company || dept) {
            meta = ' (' + [company, dept].filter(Boolean).join('/') + ')';
          }
          item.textContent = nameTxt + meta;
          item.setAttribute('data-person-id', p.id);
          item.addEventListener('mousedown', function (e) {
            // mousedown 단계에서 바로 처리하여 blur 전에 선택되도록
            e.preventDefault();
            addMemberToProject(p.id);
          });
          dropdown.appendChild(item);
        });
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

      // 연간 요약 포함 체크박스
      var summaryWrap = document.createElement('label');
      summaryWrap.className = 'participation-summary-toggle';

      var summaryCheckbox = document.createElement('input');
      summaryCheckbox.type = 'checkbox';
      // 기본값: includeInSummary === true → 체크 해제(요약에 포함)
      summaryCheckbox.checked = proj.includeInSummary === false;
      summaryCheckbox.addEventListener('change', function () {
        var newProjects = (state.projects || []).map(function (p) {
          if (p.id !== proj.id) return p;
          // 체크되었을 때만 요약에서 미반영(includeInSummary: false)
          return Object.assign({}, p, { includeInSummary: !summaryCheckbox.checked });
        });
        setProjects(newProjects);
        // 연간 요약 뷰가 열려 있다면 즉시 재계산
        renderAnnualView();
      });

      var summaryText = document.createElement('span');
      summaryText.textContent = '참여율 합산 미반영 프로젝트';

      summaryWrap.appendChild(summaryCheckbox);
      summaryWrap.appendChild(summaryText);
      addRow.appendChild(summaryWrap);

      card.appendChild(titleRow);
      card.appendChild(list);
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

    // projects에서 personId 기준 월별 합계를 계산
    // includeInSummary 가 false 인 프로젝트는 연간 요약 계산에서 제외
    var projects = Array.isArray(state.projects)
      ? state.projects.filter(function (p) { return p.includeInSummary !== false; })
      : [];

    function getMonthlyTotalsForPerson(personId) {
      var totals = {};
      for (var m = 1; m <= 12; m++) totals[m] = 0;

      projects.forEach(function (proj) {
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

    // 테이블 기본 구조
    var html = '';
    html += '<table class="participation-annual-table">';
    html += '<thead><tr>';
    html += '<th>이름</th>';
    html += '<th>구분</th>';
    for (var m = 1; m <= 12; m++) {
      html += '<th>' + m + '월</th>';
    }
    html += '</tr></thead>';
    html += '<tbody>';

    if (!persons || persons.length === 0) {
      // 이름(1) + 구분(1) + 1~12월(12) = 14 컬럼
      html += '<tr><td colspan="14" class="participation-annual-empty">데이터가 없습니다.</td></tr>';
      html += '</tbody></table>';
      annualTableWrap.innerHTML = html;
      return;
    }

    persons.forEach(function (person) {
      var totals = getMonthlyTotalsForPerson(person.id);
      html += '<tr>';
      var name = person.name || person.id || '-';
      var loss = person.lossDate || person['자격상실일'];
      if (loss) name += ' (퇴사)';
      html += '<td class="participation-annual-name">' + name + '</td>';
      html += '<td class="participation-annual-dept">' + (person.department || person['소속'] || '') + '</td>';

      for (var mm = 1; mm <= 12; mm++) {
        var v = totals[mm] || 0;
        var cls = '';
        var disabled = isMonthDisabledForPerson(person, year, mm);
        if (disabled) {
          cls = 'participation-annual-cell--disabled';
          v = 0;
        }
        // 월별 합계가 100%를 초과하면 빨간색 경고 스타일
        if (!disabled && v > 100) {
          cls += (cls ? ' ' : '') + 'participation-annual-cell--over';
        }
        html += '<td class="' + cls + '">' + (v ? v.toFixed(1) + '%' : '') + '</td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';
    annualTableWrap.innerHTML = html;
  }

  function renderAll() {
    renderYearSelect();
    renderProjectView();
    // 전체 렌더 이후 포커스 복구 시도
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
      var newProj = { id: Date.now(), title: '새 과제', includeInSummary: true, members: [] };
      setProjects((state.projects || []).concat([newProj]));
    });
  }

  if (tabProject) tabProject.addEventListener('click', function () { switchView('project'); });
  if (tabAnnual) tabAnnual.addEventListener('click', function () { switchView('annual'); });

  window.addEventListener('hashchange', onParticipationRoute);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onParticipationRoute);
  } else {
    onParticipationRoute();
  }
})();


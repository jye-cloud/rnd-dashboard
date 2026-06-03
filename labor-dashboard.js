/**
 * labor-dashboard.js — 인건비 대시보드
 *
 * 데이터 소스:
 *  - persons       (window.firestoreService.subscribePersons)
 *  - projects      (window.firestoreService.subscribeProjects)
 *  - projectLabor  (직접 fetch: {projectId}_planned / _actual / _meta)
 *  - projectBudget (직접 fetch: {projectId}_year{N})
 *
 * 단계 1 (현재): 데이터 로드 + 골격 placeholder 채우기
 *   ※ 집계 로직은 단계별로 채워나감 (1번 카드부터 7번 액션 아이템까지)
 */
(function () {
  'use strict';

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

  // ====================================================================
  // 상태
  // ====================================================================
  var state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    company: loadCompanyFilter(),  // '' (전체) | '식스티' | '굿뉴스' | '패리티'

    persons:  [],   // Firestore persons
    projects: [],   // Firestore projects (laborManaged && 수행)
    laborMap: {},   // { [projectId]: { planned: {cells}, actual: {cells}, meta: {meta, personIds} } }
    budgetMap: {},  // { [projectId]: { 1: {rows, budgetCash, ...}, 2: {...} } }

    // 차트 인스턴스 (재렌더링 시 destroy)
    charts: {
      trend: null,
      util:  null,
    },

    // 로드 상태
    loaded: {
      persons:  false,
      projects: false,
      labor:    false,
      budget:   false,
    },
  };

  // ====================================================================
  // 유틸
  // ====================================================================
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymOf(year, month) { return year + '-' + pad2(month); }
  function fmtMoney(n) {
    if (!n && n !== 0) return '-';
    if (n === 0) return '0';
    return (n / 10000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '만';
  }
  function fmtMoneyFull(n) {
    if (!n && n !== 0) return '-';
    return n.toLocaleString('ko-KR');
  }
  function db() { return window.__firebaseDb; }
  function isFirestoreReady() {
    return !!(window.__firebaseConfigured && window.__firebaseDb);
  }

  // ====================================================================
  // 프로젝트 필터 (project-labor.js 와 동일 로직)
  //   - laborManaged === true
  //   - status 가 '수행' 포함
  //   - 해당 연도가 yearBudgets/budgets 범위 안
  // ====================================================================
  function isProjectActiveInYear(proj, year) {
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

  function getActiveProjects() {
    return state.projects.filter(function (p) {
      if (!isProjectActiveInYear(p, state.year)) return false;
      // 회사 필터
      if (state.company && p.company !== state.company) return false;
      return true;
    });
  }

  /**
   * 회사 필터를 통과한 인력 목록.
   * state.company 가 비어있으면 전체 인력, 아니면 해당 회사 소속만.
   */
  function getScopedPersons() {
    if (!state.company) return state.persons;
    return state.persons.filter(function (p) { return p && p.company === state.company; });
  }

  // ====================================================================
  // Firestore 로드: projectLabor / projectBudget
  //   (구독 안 하고 1회 fetch — 진입 시 + 연도 바뀔 때 + 새로고침 시)
  // ====================================================================
  function loadLaborData(projectIds) {
    if (!isFirestoreReady() || !projectIds.length) {
      state.laborMap = {};
      state.loaded.labor = true;
      return Promise.resolve();
    }
    var promises = projectIds.map(function (pid) {
      return Promise.all([
        db().collection('projectLabor').doc(pid + '_planned').get(),
        db().collection('projectLabor').doc(pid + '_actual').get(),
        db().collection('projectLabor').doc(pid + '_meta').get(),
      ]).then(function (snaps) {
        state.laborMap[pid] = {
          planned:   (snaps[0].exists && snaps[0].data().cells) ? snaps[0].data().cells : {},
          actual:    (snaps[1].exists && snaps[1].data().cells) ? snaps[1].data().cells : {},
          meta:      (snaps[2].exists && snaps[2].data().meta)  ? snaps[2].data().meta  : {},
          personIds: (snaps[2].exists && snaps[2].data().personIds) ? snaps[2].data().personIds : [],
          personRoles: (snaps[2].exists && snaps[2].data().personRoles) ? snaps[2].data().personRoles : {},
        };
      }).catch(function (e) {
        console.warn('[labor-dashboard] projectLabor 로드 실패:', pid, e);
        state.laborMap[pid] = { planned: {}, actual: {}, meta: {}, personIds: [], personRoles: {} };
      });
    });
    return Promise.all(promises).then(function () {
      state.loaded.labor = true;
    });
  }

  function loadBudgetData(projectIds) {
    if (!isFirestoreReady() || !projectIds.length) {
      state.budgetMap = {};
      state.loaded.budget = true;
      return Promise.resolve();
    }
    // projectBudget 은 {projectId}_year{N} 형태 → prefix 조회
    var promises = projectIds.map(function (pid) {
      return db().collection('projectBudget')
        .where(window.firebase.firestore.FieldPath.documentId(), '>=', pid + '_year1')
        .where(window.firebase.firestore.FieldPath.documentId(), '<',  pid + '_year~')
        .get()
        .then(function (snap) {
          var byYearIndex = {};
          snap.forEach(function (doc) {
            var d = doc.data();
            if (d && typeof d.yearIndex === 'number') {
              byYearIndex[d.yearIndex] = d;
            }
          });
          state.budgetMap[pid] = byYearIndex;
        })
        .catch(function (e) {
          console.warn('[labor-dashboard] projectBudget 로드 실패:', pid, e);
          state.budgetMap[pid] = {};
        });
    });
    return Promise.all(promises).then(function () {
      state.loaded.budget = true;
    });
  }

  // ====================================================================
  // 데이터 모두 준비되면 렌더
  // ====================================================================
  function refreshAll() {
    var activeProjects = getActiveProjects();
    var projectIds = activeProjects.map(function (p) { return p.id; });

    // labor / budget 동시 로드
    state.loaded.labor = false;
    state.loaded.budget = false;
    state.laborMap = {};
    state.budgetMap = {};

    Promise.all([
      loadLaborData(projectIds),
      loadBudgetData(projectIds),
    ]).then(function () {
      renderAll();
      updateLoadedAt();
    });
  }

  function updateLoadedAt() {
    var el = document.getElementById('ld-updated-at');
    if (!el) return;
    var now = new Date();
    var hh = pad2(now.getHours());
    var mm = pad2(now.getMinutes());
    var ss = pad2(now.getSeconds());
    el.textContent = '업데이트: ' + hh + ':' + mm + ':' + ss;
  }

  // ====================================================================
  // 렌더링 (v8 재설계): 상단 카드 5 + 채용 의무 표 + 할 일/점검
  //   페이지 역할 = "사람·규정" 홈. 돈 지표(추이·과제별 진척)는 자금 관리로 이관.
  // ====================================================================
  function renderAll() {
    renderSummaryCards();
    renderHireTable();      // 채용 의무 표 (+ 카드 5·연간 합계줄 집계)
    renderTodoChecks();     // 할 일 / 점검 (구 액션 아이템)
    render3ch5gAlerts();    // C2 §4.8: 3책5공 점검 (한도 임박/초과 인력)
  }

  // ── 청년 판정: persons-summary.js 의 getYouthInfo(만 34세 자동)로 일원화 ──
  function isYouthPerson(p) {
    if (window.PersonsSummary && typeof window.PersonsSummary.getYouthInfo === 'function') {
      return !!window.PersonsSummary.getYouthInfo(p).youth;
    }
    // 폴백 (PersonsSummary 미로드 시): 만 34세 이하 근사
    if (!p || !p.birthDate) return false;
    var by = parseInt(String(p.birthDate).substring(0, 4), 10);
    if (!by) return false;
    return (new Date().getFullYear() - by) <= 34;
  }

  function personById(id) {
    return state.persons.find(function (x) { return x.id === id; });
  }

  // 과제 표시명: 키워드 우선(짧음), 없으면 과제명/이름/id (project-labor 와 동일 관례)
  function projName(proj) {
    if (!proj) return '-';
    var kw = (proj.keywords || proj.keyword || '').toString().trim();
    var nm = (proj.projectName || proj.name || '').toString().trim();
    return kw || nm || proj.id || '-';
  }

  // -------- 1) 상단 요약 카드 (5개) --------
  function renderSummaryCards() {
    var scopedPersons = getScopedPersons();
    var active = scopedPersons.filter(function (p) { return p.status === 'active'; });

    // 카드 1: 재직 인력
    setText('ld-stat-active', active.length + '명');

    // 카드 2: 과제 등록 인원 (활성 과제 personIds ∩ 재직)
    var assignedSet = {};
    Object.keys(state.laborMap).forEach(function (pid) {
      (state.laborMap[pid].personIds || []).forEach(function (id) { assignedSet[id] = true; });
    });
    var assignedActive = active.filter(function (p) { return assignedSet[p.id]; });
    setText('ld-stat-assigned', assignedActive.length + ' / ' + active.length + '명');
    var pct = active.length ? Math.round(assignedActive.length / active.length * 100) : 0;
    setText('ld-stat-assigned-sub', '전체 재직 인력 중 ' + pct + '%');

    // 카드 3·4: 기준 월 합산 참여율로 미참여 / 여유 / 100% 분할 (겹침 없음)
    var ym = ymOf(state.year, state.month);
    var rateByPerson = computePersonRatesForMonth(ym);
    var idleN = 0, spareN = 0, fullN = 0;
    active.forEach(function (p) {
      var r = rateByPerson[p.id] || 0;
      if (r <= 0) idleN++;
      else if (r < 100) spareN++;
      else fullN++;
    });
    setText('ld-stat-idle', idleN + '명');
    setText('ld-stat-spare', spareN + '명');
    setText('ld-stat-full', fullN + '명');
    setText('ld-stat-full-sub', fullN > 0 ? '추가 참여 불가' : '여유 있음');

    // 카드 5: 채용 의무 — renderHireTable 의 집계 결과를 사용 (해당 함수가 채움)
  }

  function setText(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /**
   * 기준 월의 인력별 합산 참여율
   * @param {string} ym  'YYYY-MM'
   * @returns {Object}  { [personId]: sumRate }
   */
  function computePersonRatesForMonth(ym) {
    var result = {};
    Object.keys(state.laborMap).forEach(function (pid) {
      var planned = state.laborMap[pid].planned || {};
      // cell key = '{projectId}_{ym}_{personId}'
      var prefix = pid + '_' + ym + '_';
      Object.keys(planned).forEach(function (key) {
        if (key.indexOf(prefix) !== 0) return;
        var personId = key.substring(prefix.length);
        var rate = +planned[key].rate || 0;
        result[personId] = (result[personId] || 0) + rate;
      });
    });
    return result;
  }

  /* __HIRE_BLOCK__ */
  // ====================================================================
  // 채용 의무 (신규 인력 유지) — 집계 + 표 (§3.5(c))
  //   기준일 = 과제 시작일(첫 연차 startDate) 1일, 유지 기간(기본 12개월) 머릿수 기준·교체 허용.
  //   과제 시작일이 없으면 등록 시작월(첫 참여율 입력 월)로 폴백.
  //   유지 기간 충족 시 ✅ 유지완료(경고 해제).
  // ====================================================================

  // 과제 시작월 ('YYYY-MM') — 첫 연차 startDate 우선, 없으면 proj.startDate
  function getProjectStartMonthYm(proj) {
    if (!proj) return null;
    var s = proj.startDate;
    if (!s && Array.isArray(proj.yearBudgets) && proj.yearBudgets[0]) {
      s = proj.yearBudgets[0].startDate || proj.yearBudgets[0].start;
    }
    if (!s) return null;
    var m = String(s).match(/^(\d{4})[-\/.](\d{1,2})/);
    if (!m) return null;
    var mm = parseInt(m[2], 10);
    if (mm < 1 || mm > 12) return null;
    return m[1] + '-' + pad2(mm);
  }

  // 과제 등록 시작월 = 그 과제 planned 셀에서 참여율>0 이 처음 잡히는 월 ('YYYY-MM') — 폴백용
  function getProjectStartYm(pid) {
    var planned = (state.laborMap[pid] || {}).planned || {};
    var prefix = pid + '_';
    var min = null;
    Object.keys(planned).forEach(function (key) {
      if ((+planned[key].rate || 0) <= 0) return;
      var ym = key.substring(prefix.length, prefix.length + 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      if (min === null || ym < min) min = ym;
    });
    return min;
  }

  // 'YYYY-MM' + months → 그 결과 월의 1일 Date
  function deadlineDate(startYm, months) {
    var y = parseInt(startYm.substring(0, 4), 10);
    var m = parseInt(startYm.substring(5, 7), 10);
    var total = (y * 12 + (m - 1)) + (months || 12);
    return new Date(Math.floor(total / 12), total % 12, 1);
  }

  function fmtYmd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 한 과제의 채용 의무 상태 계산
  function computeHireRow(proj) {
    var requiredNew   = +proj.requiredNew   || 0;
    var requiredYouth = +proj.requiredYouth || 0;
    var months = (proj.requiredRetention && proj.requiredRetention.months != null)
      ? +proj.requiredRetention.months : 12;

    var data = state.laborMap[proj.id] || {};
    var personIds = data.personIds || [];
    var roles = data.personRoles || {};

    // 그 과제에서 '신규'로 분류된 재직 인력
    var newActive = personIds.filter(function (id) {
      var role = roles[id];
      if (!role || role.newOrExisting !== '신규') return false;
      var p = personById(id);
      return p && p.status === 'active';
    });
    var hiredNew = newActive.length;
    var hiredYouth = newActive.filter(function (id) { return isYouthPerson(personById(id)); }).length;

    var startYm = getProjectStartMonthYm(proj) || getProjectStartYm(proj.id);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var dl = startYm ? deadlineDate(startYm, months) : null;
    var retentionMet = !!(dl && today >= dl);
    var daysLeft = dl ? Math.ceil((dl - today) / 86400000) : null;

    // 유지 기한 전에 퇴사(예정)로 미달 위험: 신규 재직 중 exitDate 가 미래 & 기한 이내
    var afterExits = newActive.filter(function (id) {
      var p = personById(id);
      if (!p || !p.exitDate) return true;
      var ex = new Date(String(p.exitDate));
      if (isNaN(ex)) return true;
      return !(dl && ex >= today && ex < dl);  // 기한 전 퇴사예정이면 빠짐
    }).length;

    var meetsNow = (hiredNew >= requiredNew) && (hiredYouth >= requiredYouth);
    var atRisk = !retentionMet && meetsNow && (dl != null) &&
                 ((afterExits < requiredNew) ||
                  (newActive.filter(function (id) {
                     var p = personById(id);
                     if (!isYouthPerson(p)) return false;
                     if (!p.exitDate) return true;
                     var ex = new Date(String(p.exitDate));
                     if (isNaN(ex)) return true;
                     return !(dl && ex >= today && ex < dl);
                   }).length) < requiredYouth);

    var status;
    if (retentionMet) status = { key: 'done', label: '✅ 유지완료' };
    else if (!meetsNow) status = { key: 'short', label: '🔴 미달' };
    else if (atRisk)  status = { key: 'risk', label: '⚠️ 위험' };
    else status = { key: 'ok', label: '✅ 충족' };

    return {
      proj: proj,
      requiredNew: requiredNew, requiredYouth: requiredYouth,
      hiredNew: hiredNew, hiredYouth: hiredYouth,
      startYm: startYm, deadline: dl, daysLeft: daysLeft,
      retentionMet: retentionMet, status: status,
    };
  }

  // -------- 채용 의무 표 + 카드 5 + 연간 합계줄 --------
  function renderHireTable() {
    var tbody = document.getElementById('ld-hire-tbody');
    var summaryEl = document.getElementById('ld-hire-summary');

    var rows = getActiveProjects()
      .filter(function (p) { return (+p.requiredNew || 0) > 0 || (+p.requiredYouth || 0) > 0; })
      .map(computeHireRow);

    // 연간 합계 (카드 5 + 합계줄)
    var sumReqN = 0, sumHireM = 0, sumReqY = 0, sumHireMy = 0, riskX = 0;
    rows.forEach(function (r) {
      sumReqN += r.requiredNew;
      sumHireM += Math.min(r.hiredNew, r.requiredNew);
      sumReqY += r.requiredYouth;
      sumHireMy += Math.min(r.hiredYouth, r.requiredYouth);
      if (r.status.key === 'risk') riskX++;
    });
    var remainK = Math.max(0, sumReqN - sumHireM);

    // 카드 5
    setText('ld-stat-hire', sumHireM + ' / ' + sumReqN + '명');
    var card5sub = '남음 ' + remainK + '명';
    if (sumReqY > 0) card5sub += ' · 청년 ' + sumHireMy + '/' + sumReqY;
    if (riskX > 0)   card5sub += ' · ⚠️유지위험 ' + riskX;
    setText('ld-stat-hire-sub', card5sub);

    // 표
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="ld-empty">채용 의무가 설정된 수행 과제가 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    var statusClass = {
      done: 'ld-hire-badge--done', ok: 'ld-hire-badge--done',
      short: 'ld-hire-badge--none', risk: 'ld-hire-badge--progress',
    };

    tbody.innerHTML = rows.map(function (r) {
      var reqText = (r.requiredYouth > 0)
        ? '일반 ' + r.requiredNew + ' · 청년 ' + r.requiredYouth
        : r.requiredNew + '명';
      var hireText = (r.requiredYouth > 0)
        ? '일반 ' + r.hiredNew + '/' + r.requiredNew + ' · 청년 ' + r.hiredYouth + '/' + r.requiredYouth
        : r.hiredNew + '/' + r.requiredNew;
      var dlText = r.deadline
        ? fmtYmd(r.deadline) + (r.retentionMet ? '' : ' <span style="color:#9ca3af">(D' + (r.daysLeft >= 0 ? '-' + r.daysLeft : '+' + (-r.daysLeft)) + ')</span>')
        : '<span style="color:#9ca3af">미시작</span>';
      return ''
        + '<tr>'
        +   '<td><a href="project-labor.html?projectId=' + r.proj.id + '" style="color:inherit;text-decoration:none;">'
        +     escapeHtml(projName(r.proj)) + '</a></td>'
        +   '<td class="ld-hire-num">' + reqText + '</td>'
        +   '<td class="ld-hire-num">' + hireText + '</td>'
        +   '<td class="ld-hire-num" style="white-space:nowrap;">' + dlText + '</td>'
        +   '<td><span class="ld-hire-badge ' + (statusClass[r.status.key] || '') + '">' + r.status.label + '</span></td>'
        + '</tr>';
    }).join('');

    if (summaryEl) {
      summaryEl.innerHTML =
        '올해 필수 <strong>' + sumReqN + '명</strong> · 채용 <strong>' + sumHireM + '명</strong> · '
        + '남음 <strong' + (remainK > 0 ? ' style="color:#dc2626"' : '') + '>' + remainK + '명</strong>'
        + (sumReqY > 0 ? ' · 청년 <strong>' + sumHireMy + '/' + sumReqY + '명</strong>' : '')
        + (riskX > 0 ? ' · <strong style="color:#b45309">⚠️ 유지위험 ' + riskX + '건</strong>' : '');
    }

    // 카드 5 집계가 다른 함수보다 늦게 끝날 수 있어 여기서 한 번 더 보강 (renderSummaryCards 와 순서 무관하게)
    state._hireTotals = { sumReqN: sumReqN, sumHireM: sumHireM, remainK: remainK, riskX: riskX };
  }

  // -------- 할 일 / 점검 (구 액션 아이템, D6) --------
  //   카드에 있는 요약(100% 도달 등)은 빼고, 고칠 항목 + 바로가기만.
  //   분류: 채용의무 / 확정(confirmed) / 입력.
  function renderTodoChecks() {
    var listEl = document.getElementById('ld-action-list');
    if (!listEl) return;

    var items = [];
    var ym = ymOf(state.year, state.month);
    var activeProjects = getActiveProjects();

    // 🔴/⚠️ 채용 의무 — 미달·유지위험
    activeProjects
      .filter(function (p) { return (+p.requiredNew || 0) > 0 || (+p.requiredYouth || 0) > 0; })
      .forEach(function (proj) {
        var r = computeHireRow(proj);
        if (r.status.key === 'short') {
          var lack = [];
          if (r.hiredNew < r.requiredNew) lack.push('일반 ' + (r.requiredNew - r.hiredNew) + '명');
          if (r.hiredYouth < r.requiredYouth) lack.push('청년 ' + (r.requiredYouth - r.hiredYouth) + '명');
          items.push({
            level: 'urgent', cat: '채용의무',
            text: projName(proj) + ' 신규 필수 ' + lack.join(' · ') + ' 미달'
              + (r.deadline && r.daysLeft != null ? ' — 유지기한 D' + (r.daysLeft >= 0 ? '-' + r.daysLeft : '+' + (-r.daysLeft)) : ''),
            link: 'project-labor.html?projectId=' + proj.id,
          });
        } else if (r.status.key === 'risk') {
          items.push({
            level: 'warn', cat: '채용의무',
            text: projName(proj) + ' 신규 인력 퇴사 예정 — 유지기한 내 미달 위험'
              + (r.deadline && r.daysLeft != null ? ' (D-' + r.daysLeft + ')' : ''),
            link: 'project-labor.html?projectId=' + proj.id,
          });
        }
      });

    // ⚠️ 미확정 (confirmed 기준) — actual 입력이 있는데 그 달 confirmed=false
    activeProjects.forEach(function (proj) {
      var pData = state.laborMap[proj.id];
      if (!pData) return;
      var meta = (pData.meta || {})[ym] || {};
      if (meta.confirmed) return;
      var prefix = proj.id + '_' + ym + '_';
      var lockedCash = 0;
      Object.keys(pData.actual || {}).forEach(function (key) {
        if (key.indexOf(prefix) !== 0) return;
        lockedCash += (+pData.actual[key].cash || 0);
      });
      if (lockedCash > 0) {
        items.push({
          level: 'warn', cat: '확정',
          text: projName(proj) + ' ' + state.month + '월 미확정 — 환급 ' + fmtMoney(lockedCash) + ' 묶임',
          link: 'project-labor.html?projectId=' + proj.id,
        });
      }
    });

    // ℹ️ 기준 월 인건비 미입력
    activeProjects.forEach(function (proj) {
      var pData = state.laborMap[proj.id];
      if (!pData) return;
      var prefix = proj.id + '_' + ym + '_';
      var hasPlanned = Object.keys(pData.planned || {}).some(function (key) {
        return key.indexOf(prefix) === 0 && (+pData.planned[key].rate > 0);
      });
      if (!hasPlanned && (pData.personIds || []).length > 0) {
        items.push({
          level: 'info', cat: '입력',
          text: projName(proj) + ' ' + state.month + '월 인건비 미입력',
          link: 'project-labor.html?projectId=' + proj.id,
        });
      }
    });

    if (!items.length) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">✅</div>점검이 필요한 항목이 없습니다.</div>';
      return;
    }

    var levelOrder = { urgent: 0, warn: 1, info: 2 };
    items.sort(function (a, b) { return levelOrder[a.level] - levelOrder[b.level]; });

    var labelMap = { urgent: '긴급', warn: '주의', info: '알림' };
    listEl.innerHTML = items.map(function (it) {
      return ''
        + '<div class="ld-action-row">'
        +   '<span class="ld-action-level ld-action-level--' + it.level + '">' + labelMap[it.level] + '</span>'
        +   '<span class="ld-action-text"><span class="ld-action-cat">[' + escapeHtml(it.cat) + ']</span> ' + escapeHtml(it.text) + '</span>'
        +   (it.link
              ? '<a class="ld-action-btn" href="' + it.link + '">바로가기 →</a>'
              : '<span></span>')
        + '</div>';
    }).join('');
  }

  // ====================================================================
  // C2 §4.8: 3책5공 점검 — 한도 임박/초과 인력 안내
  //   책 ≤ 3, 책 + 공 ≤ 5. 수행 과제(is3ch5gManaged) 기준.
  //   안내 기준: 책 ≥ 2(임박) / 책 = 3(한도) / 책 > 3(초과) / 공 ≥ 4(임박) / 책+공 > 5(초과)
  // ====================================================================
  function render3ch5gAlerts() {
    var listEl = document.getElementById('ld-ch5g-list');
    if (!listEl) return;
    if (!window.ThreeFiveRule) {
      listEl.innerHTML = '<div class="ld-empty">3책5공 모듈을 불러오지 못했습니다.</div>';
      return;
    }

    // 명단(roster) = 그 과제 laborMap.personRoles 키. 책임자는 명단 무관 인정(헬퍼 처리).
    function getRoster(p) {
      var d = state.laborMap[p.id];
      if (d && d.personRoles) return Object.keys(d.personRoles);
      if (Array.isArray(p.personIds)) return p.personIds;
      return [];
    }

    // 관리·수행 과제 (회사 필터 반영)
    var managed = state.projects.filter(function (p) {
      if (!window.ThreeFiveRule.isManagedActive(p)) return false;
      if (state.company && p.company !== state.company) return false;
      return true;
    });
    if (managed.length === 0) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">📚</div>3책5공 관리 대상(수행) 과제가 없습니다.</div>';
      return;
    }

    // 후보 인력 = 관리 과제 명단 + 책임자 전원 (중복 제거), 회사 필터 반영
    var candIds = {};
    managed.forEach(function (p) {
      getRoster(p).forEach(function (id) { candIds[id] = true; });
      if (p.managerPersonId) candIds[p.managerPersonId] = true;
    });

    var rows = [];
    Object.keys(candIds).forEach(function (pid) {
      var person = personById(pid);
      if (state.company && person && person.company !== state.company) return;
      var c = window.ThreeFiveRule.countForPerson(pid, managed, getRoster);
      if (c.total === 0) return;
      var over = window.ThreeFiveRule.isOverLimit(c.chaek, c.gong);
      var nearChaek = c.chaek >= 2;          // 2책 이상
      var nearGong  = c.gong >= 4;           // 4공 이상
      if (!over && !nearChaek && !nearGong) return;   // 임박/초과만 노출
      rows.push({
        name: (person && person.name) || pid,
        chaek: c.chaek, gong: c.gong, total: c.total, over: over
      });
    });

    if (rows.length === 0) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">✅</div>3책5공 한도에 임박하거나 초과한 인력이 없습니다.</div>';
      return;
    }

    // 정렬: 초과 → 책 많은 순 → 총합 많은 순
    rows.sort(function (a, b) {
      if (a.over !== b.over) return a.over ? -1 : 1;
      if (b.chaek !== a.chaek) return b.chaek - a.chaek;
      return b.total - a.total;
    });

    listEl.innerHTML = rows.map(function (r) {
      var level, label, note;
      if (r.over) {
        level = 'urgent'; label = '초과';
        note = (r.chaek > 3 ? '책 ' + r.chaek + '건(3책 초과)' : '')
             + (r.chaek > 3 && (r.chaek + r.gong) > 5 ? ' · ' : '')
             + ((r.chaek + r.gong) > 5 ? '책+공 ' + r.total + '건(5 초과)' : '');
      } else if (r.chaek >= 3) {
        level = 'warn'; label = '한도'; note = '책 3건(3책 도달)';
      } else if (r.chaek >= 2) {
        level = 'warn'; label = '임박'; note = '책 ' + r.chaek + '건(3책 임박)';
      } else {
        level = 'info'; label = '임박'; note = '공 ' + r.gong + '건';
      }
      return ''
        + '<div class="ld-action-row">'
        +   '<span class="ld-action-level ld-action-level--' + level + '">' + label + '</span>'
        +   '<span class="ld-action-text"><span class="ld-action-cat">[' + escapeHtml(r.name) + ']</span> '
        +     '책/공 <strong>' + r.chaek + '/' + r.gong + '</strong>'
        +     (note ? ' — ' + escapeHtml(note) : '')
        +   '</span>'
        +   '<a class="ld-action-btn" href="participation-summary.html">참여율 →</a>'
        + '</div>';
    }).join('');
  }

  // ====================================================================
  // 유틸: HTML escape
  // ====================================================================
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ====================================================================
  // 컨트롤 바 이벤트
  // ====================================================================
  function bindControls() {
    var yearSel  = document.getElementById('ld-year');
    var monthSel = document.getElementById('ld-month');
    if (yearSel) {
      yearSel.value = String(state.year);
      yearSel.addEventListener('change', function () {
        state.year = parseInt(yearSel.value, 10);
        refreshAll();
      });
    }
    if (monthSel) {
      monthSel.value = String(state.month);
      monthSel.addEventListener('change', function () {
        state.month = parseInt(monthSel.value, 10);
        // 월만 바뀐 건 다시 fetch 필요 없음 — 같은 데이터로 재렌더만
        renderAll();
      });
    }

    // 회사 필터 칩
    var companyChips = document.getElementById('ld-company-chips');
    if (companyChips) {
      // 초기 시각 상태 동기화 (localStorage 복원값)
      companyChips.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === state.company);
      });
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
        // 회사 바뀌면 활성 프로젝트가 달라지므로 labor/budget 다시 fetch
        refreshAll();
      });
    }
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    bindControls();

    if (!window.firestoreService) {
      console.error('[labor-dashboard] firestoreService 가 없습니다. firestore-service.js 로드 확인 필요.');
      return;
    }

    // persons 구독
    if (typeof window.firestoreService.subscribePersons === 'function') {
      window.firestoreService.subscribePersons(function (list) {
        state.persons = list || [];
        state.loaded.persons = true;
        if (state.loaded.projects) refreshAll();
      });
    } else {
      console.warn('[labor-dashboard] subscribePersons 가 없어요.');
    }

    // projects 구독
    if (typeof window.firestoreService.subscribeProjects === 'function') {
      window.firestoreService.subscribeProjects(function (list) {
        state.projects = list || [];
        state.loaded.projects = true;
        if (state.loaded.persons) refreshAll();
      });
    } else {
      console.warn('[labor-dashboard] subscribeProjects 가 없어요.');
    }
  }

  // DOM 준비되면 init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

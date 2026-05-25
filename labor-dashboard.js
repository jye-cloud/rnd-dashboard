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
        };
      }).catch(function (e) {
        console.warn('[labor-dashboard] projectLabor 로드 실패:', pid, e);
        state.laborMap[pid] = { planned: {}, actual: {}, meta: {}, personIds: [] };
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
  // 렌더링: 7개 섹션
  //   ※ 현재는 placeholder 만 채움. 단계별로 진짜 집계 로직 구현 예정.
  // ====================================================================
  function renderAll() {
    renderSummaryCards();
    renderTrendChart();
    renderProjectProgress();
    renderPersonList();
    renderHireTable();
    renderUtilization();
    renderActionItems();
  }

  // -------- 1) 상단 요약 카드 --------
  function renderSummaryCards() {
    // 회사 전체 인력 (회사 필터 적용)
    var scopedPersons = getScopedPersons();
    var totalEl    = document.getElementById('ld-stat-total');
    var totalSubEl = document.getElementById('ld-stat-total-sub');
    var active = scopedPersons.filter(function (p) { return p.status === 'active'; });
    var exited = scopedPersons.filter(function (p) { return p.status === 'exited'; });
    totalEl.textContent = scopedPersons.length + '명';
    totalSubEl.textContent = '재직 ' + active.length + ' · 퇴직 ' + exited.length;

    // 과제 등록 인원 — 활성 프로젝트의 personIds 합집합 중 재직 인력
    var assignedSet = {};
    Object.keys(state.laborMap).forEach(function (pid) {
      (state.laborMap[pid].personIds || []).forEach(function (id) {
        assignedSet[id] = true;
      });
    });
    var assignedActive = active.filter(function (p) { return assignedSet[p.id]; });
    var assignedEl    = document.getElementById('ld-stat-assigned');
    var assignedSubEl = document.getElementById('ld-stat-assigned-sub');
    assignedEl.textContent = assignedActive.length + ' / ' + active.length + '명';
    var pct = active.length ? Math.round(assignedActive.length / active.length * 100) : 0;
    assignedSubEl.textContent = '전체 재직 인력 중 ' + pct + '%';

    // 여유 가용 참여율 / 100% 인원 — 기준 월의 합산 참여율 계산
    var ym = ymOf(state.year, state.month);
    var rateByPerson = computePersonRatesForMonth(ym);

    var capacity = 0;
    var fullCount = 0;
    active.forEach(function (p) {
      var r = rateByPerson[p.id] || 0;
      capacity += Math.max(0, 100 - r);
      if (r >= 100) fullCount++;
    });
    document.getElementById('ld-stat-capacity').textContent = capacity.toLocaleString('ko-KR') + '%';
    document.getElementById('ld-stat-full').textContent = fullCount + '명';
    document.getElementById('ld-stat-full-sub').textContent =
      fullCount > 0 ? '추가 참여 불가' : '여유 있음';
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

  // -------- 2) 월별 환급 추이 그래프 --------
  function renderTrendChart() {
    var canvas = document.getElementById('ld-trend-chart');
    if (!canvas || !window.Chart) return;

    // TODO: 단계 2에서 실제 데이터 집계
    var months = Array.from({ length: 12 }, function (_, i) { return (i + 1) + '월'; });
    var planned = new Array(12).fill(0);
    var actual  = new Array(12).fill(0);

    Object.keys(state.laborMap).forEach(function (pid) {
      var pData = state.laborMap[pid];
      var prefix = pid + '_';
      Object.keys(pData.planned || {}).forEach(function (key) {
        // key = {pid}_{YYYY-MM}_{personId}
        var rest = key.substring(prefix.length);
        var ym = rest.substring(0, 7);
        if (ym.indexOf(state.year + '-') !== 0) return;
        var m = parseInt(ym.substring(5, 7), 10);
        planned[m - 1] += (+pData.planned[key].cash || 0);
      });
      Object.keys(pData.actual || {}).forEach(function (key) {
        var rest = key.substring(prefix.length);
        var ym = rest.substring(0, 7);
        if (ym.indexOf(state.year + '-') !== 0) return;
        // 시스템 등록 완료한 월만 actual 로 인정
        var meta = (pData.meta || {})[ym] || {};
        if (!meta.sysReg) return;
        var m = parseInt(ym.substring(5, 7), 10);
        actual[m - 1] += (+pData.actual[key].cash || 0);
      });
    });

    if (state.charts.trend) {
      state.charts.trend.destroy();
    }
    state.charts.trend = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: '예상',
            data: planned,
            backgroundColor: 'rgba(96, 165, 250, 0.55)',
            borderColor: 'rgba(96, 165, 250, 1)',
            borderWidth: 1,
          },
          {
            label: '실제 (시스템 등록 완료)',
            data: actual,
            backgroundColor: 'rgba(37, 99, 235, 0.85)',
            borderColor: 'rgba(37, 99, 235, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + fmtMoneyFull(ctx.parsed.y) + '원';
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function (v) { return fmtMoney(v); },
            },
          },
        },
      },
    });
  }

  // -------- 3) 프로젝트별 환급 진척 --------
  function renderProjectProgress() {
    var listEl = document.getElementById('ld-project-list');
    if (!listEl) return;

    var activeProjects = getActiveProjects();
    if (!activeProjects.length) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">📋</div>해당 연도 수행 과제가 없습니다.</div>';
      return;
    }

    var html = activeProjects.map(function (proj) {
      var pData = state.laborMap[proj.id] || { planned: {}, actual: {}, meta: {} };
      // 연간 예상/실제 환급 합계
      var plannedSum = 0;
      var actualSum = 0;
      Object.keys(pData.planned || {}).forEach(function (key) {
        var rest = key.substring(proj.id.length + 1);
        var ym = rest.substring(0, 7);
        if (ym.indexOf(state.year + '-') !== 0) return;
        plannedSum += (+pData.planned[key].cash || 0);
      });
      Object.keys(pData.actual || {}).forEach(function (key) {
        var rest = key.substring(proj.id.length + 1);
        var ym = rest.substring(0, 7);
        if (ym.indexOf(state.year + '-') !== 0) return;
        var meta = (pData.meta || {})[ym] || {};
        if (!meta.sysReg) return;
        actualSum += (+pData.actual[key].cash || 0);
      });

      var pct = plannedSum > 0 ? Math.min(100, Math.round(actualSum / plannedSum * 100)) : 0;
      var fillClass = pct >= 100 ? 'ld-bar-fill--done'
                    : pct >= 70  ? ''
                    : pct >= 30  ? 'ld-bar-fill--warn'
                    : 'ld-bar-fill--danger';

      return ''
        + '<div class="ld-bar-row">'
        +   '<div class="ld-bar-name" title="' + escapeHtml(proj.title || proj.name || '-') + '">'
        +     escapeHtml(proj.title || proj.name || '-')
        +   '</div>'
        +   '<div class="ld-bar-track">'
        +     '<div class="ld-bar-fill ' + fillClass + '" style="width:' + pct + '%"></div>'
        +   '</div>'
        +   '<div class="ld-bar-meta">'
        +     '<strong>' + fmtMoney(actualSum) + '</strong>'
        +     ' / ' + fmtMoney(plannedSum)
        +     ' <span style="color:#9ca3af">(' + pct + '%)</span>'
        +   '</div>'
        + '</div>';
    }).join('');

    listEl.innerHTML = html;
  }

  // -------- 4) 인력 참여율 현황 (기준 월) --------
  function renderPersonList() {
    var listEl = document.getElementById('ld-person-list');
    var subEl  = document.getElementById('ld-person-sub');
    if (!listEl) return;

    var ym = ymOf(state.year, state.month);
    if (subEl) {
      subEl.textContent = state.year + '년 ' + state.month + '월 · 합산 참여율 높은 순';
    }

    // 인력별 참여율 + 어느 프로젝트에 들어가 있는지
    var byPerson = {};   // { personId: { rate, projects: [name] } }
    Object.keys(state.laborMap).forEach(function (pid) {
      var planned = state.laborMap[pid].planned || {};
      var proj = state.projects.find(function (p) { return p.id === pid; });
      var pname = proj ? (proj.title || proj.name || '-') : '-';
      var prefix = pid + '_' + ym + '_';
      Object.keys(planned).forEach(function (key) {
        if (key.indexOf(prefix) !== 0) return;
        var personId = key.substring(prefix.length);
        var rate = +planned[key].rate || 0;
        if (rate <= 0) return;
        if (!byPerson[personId]) byPerson[personId] = { rate: 0, projects: [] };
        byPerson[personId].rate += rate;
        byPerson[personId].projects.push(pname + ' ' + rate + '%');
      });
    });

    // 재직 인력만, 참여율 높은 순 (회사 필터 적용)
    var rows = getScopedPersons()
      .filter(function (p) { return p.status === 'active' && byPerson[p.id]; })
      .map(function (p) {
        var entry = byPerson[p.id];
        return { person: p, rate: entry.rate, projects: entry.projects };
      })
      .sort(function (a, b) { return b.rate - a.rate; });

    if (!rows.length) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">👥</div>해당 월에 참여 중인 인력이 없습니다.</div>';
      return;
    }

    var maxRate = Math.max(100, rows[0].rate);

    var html = rows.map(function (r) {
      var rateClass = r.rate >= 100 ? 'ld-person-rate--full'
                    : r.rate >= 90  ? 'ld-person-rate--warn'
                    : 'ld-person-rate--ok';
      var fillClass = r.rate >= 100 ? 'ld-bar-fill--danger'
                    : r.rate >= 90  ? 'ld-bar-fill--warn'
                    : '';
      var widthPct = Math.min(100, Math.round(r.rate / maxRate * 100));
      return ''
        + '<div class="ld-person-row">'
        +   '<div class="ld-person-name">' + escapeHtml(r.person.name) + '</div>'
        +   '<div class="ld-bar-track">'
        +     '<div class="ld-bar-fill ' + fillClass + '" style="width:' + widthPct + '%"></div>'
        +   '</div>'
        +   '<div class="ld-person-rate ' + rateClass + '">' + r.rate + '%</div>'
        +   '<div class="ld-person-projects" title="' + escapeHtml(r.projects.join(' · ')) + '">'
        +     escapeHtml(r.projects.join(' · '))
        +   '</div>'
        + '</div>';
    }).join('');

    listEl.innerHTML = html;
  }

  // -------- 5) 신규 채용 필수 인력 진척 --------
  function renderHireTable() {
    var tbody = document.getElementById('ld-hire-tbody');
    var summaryEl = document.getElementById('ld-hire-summary');
    if (!tbody) return;

    var projects = getActiveProjects().filter(function (p) {
      return p.requiredNew && p.requiredNew > 0;
    });

    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="ld-empty">신규 채용 필수 인원이 설정된 과제가 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    var totalRequired = 0;
    var totalHired = 0;

    var rowsHtml = projects.map(function (proj) {
      var personIds = (state.laborMap[proj.id] && state.laborMap[proj.id].personIds) || [];
      var hired = personIds.filter(function (id) {
        var person = state.persons.find(function (x) { return x.id === id; });
        return person && person.isNew && person.status === 'active';
      }).length;
      var hiredYouth = personIds.filter(function (id) {
        var person = state.persons.find(function (x) { return x.id === id; });
        return person && person.isNew && person.isYouth && person.status === 'active';
      }).length;

      totalRequired += proj.requiredNew;
      totalHired    += Math.min(hired, proj.requiredNew);

      var pct = proj.requiredNew > 0 ? Math.round(hired / proj.requiredNew * 100) : 0;
      var badgeClass = hired >= proj.requiredNew
        ? 'ld-hire-badge--done'
        : hired > 0
          ? 'ld-hire-badge--progress'
          : 'ld-hire-badge--none';
      var badgeText = hired >= proj.requiredNew
        ? '✅ 완료'
        : hired > 0
          ? '⏳ 진행중 (' + pct + '%)'
          : '⚠️ 미착수';

      return ''
        + '<tr>'
        +   '<td>' + escapeHtml(proj.title || proj.name || '-') + '</td>'
        +   '<td class="ld-hire-num">' + proj.requiredNew + '</td>'
        +   '<td class="ld-hire-num">' + (proj.requiredYouth || 0) + '</td>'
        +   '<td class="ld-hire-num">'
        +     hired + '/' + proj.requiredNew
        +     (proj.requiredYouth ? ' <span style="color:#9ca3af">(청년 ' + hiredYouth + '/' + proj.requiredYouth + ')</span>' : '')
        +   '</td>'
        +   '<td><span class="ld-hire-badge ' + badgeClass + '">' + badgeText + '</span></td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = rowsHtml;

    if (summaryEl) {
      var remain = Math.max(0, totalRequired - totalHired);
      summaryEl.innerHTML =
        '합계 <strong>' + totalRequired + '명</strong> 채용 필요 · ' +
        '현재 <strong>' + totalHired + '명</strong> 완료' +
        (remain > 0 ? ' · <strong style="color:#dc2626">' + remain + '명</strong> 추가 채용 필요' : ' · ✅ 모두 완료');
    }
  }

  // -------- 6) 회사 인력 활용도 --------
  function renderUtilization() {
    var scoped = getScopedPersons();
    var active = scoped.filter(function (p) { return p.status === 'active'; });
    var youth  = active.filter(function (p) { return p.isYouth; });
    var newbie = active.filter(function (p) { return p.isNew; });

    // 기준 월에 어떤 과제든 참여하고 있는 사람
    var ym = ymOf(state.year, state.month);
    var rates = computePersonRatesForMonth(ym);
    var participating = active.filter(function (p) { return (rates[p.id] || 0) > 0; });

    document.getElementById('ld-util-active').textContent        = active.length + '명';
    document.getElementById('ld-util-participating').textContent = participating.length + '명';
    document.getElementById('ld-util-idle').textContent          = (active.length - participating.length) + '명';
    document.getElementById('ld-util-youth').textContent         = youth.length + '명';
    document.getElementById('ld-util-new').textContent           = newbie.length + '명';

    // 월별 참여 인원 추이 (선 차트)
    var canvas = document.getElementById('ld-util-chart');
    if (!canvas || !window.Chart) return;

    var months = Array.from({ length: 12 }, function (_, i) { return (i + 1) + '월'; });
    var participatingByMonth = new Array(12).fill(0).map(function (_, i) {
      var mYm = ymOf(state.year, i + 1);
      var set = {};
      Object.keys(state.laborMap).forEach(function (pid) {
        var planned = state.laborMap[pid].planned || {};
        var prefix = pid + '_' + mYm + '_';
        Object.keys(planned).forEach(function (key) {
          if (key.indexOf(prefix) !== 0) return;
          if ((+planned[key].rate || 0) > 0) {
            set[key.substring(prefix.length)] = true;
          }
        });
      });
      return Object.keys(set).length;
    });

    if (state.charts.util) state.charts.util.destroy();
    state.charts.util = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: '과제 참여 인원',
          data: participatingByMonth,
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 },
          },
        },
      },
    });
  }

  // -------- 7) 액션 아이템 --------
  function renderActionItems() {
    var listEl = document.getElementById('ld-action-list');
    if (!listEl) return;

    var items = [];
    var ym = ymOf(state.year, state.month);
    var rates = computePersonRatesForMonth(ym);
    var activeProjects = getActiveProjects();

    // 긴급: 100% 도달 인원 (회사 필터 적용)
    getScopedPersons().forEach(function (p) {
      if (p.status !== 'active') return;
      if ((rates[p.id] || 0) >= 100) {
        items.push({
          level: 'urgent',
          text: state.month + '월 ' + p.name + ' 합산 참여율 ' + (rates[p.id]) + '% (100% 도달)',
        });
      }
    });

    // 주의: 시스템 등록 미완료 (기준 월 기준)
    activeProjects.forEach(function (proj) {
      var pData = state.laborMap[proj.id];
      if (!pData) return;
      var meta = (pData.meta || {})[ym] || {};
      if (meta.sysReg) return;
      // actual cell 에 입력이 있는데 시스템 등록 안 된 경우
      var prefix = proj.id + '_' + ym + '_';
      var hasActual = Object.keys(pData.actual || {}).some(function (key) {
        return key.indexOf(prefix) === 0 && (+pData.actual[key].cash > 0);
      });
      if (hasActual) {
        items.push({
          level: 'warn',
          text: (proj.title || proj.name) + ' ' + state.month + '월 시스템 등록 미완료',
          link: 'project-labor.html?projectId=' + proj.id,
        });
      }
    });

    // 알림: 기준 월 인건비 미입력
    activeProjects.forEach(function (proj) {
      var pData = state.laborMap[proj.id];
      if (!pData) return;
      var prefix = proj.id + '_' + ym + '_';
      var hasPlanned = Object.keys(pData.planned || {}).some(function (key) {
        return key.indexOf(prefix) === 0 && (+pData.planned[key].rate > 0);
      });
      if (!hasPlanned && (pData.personIds || []).length > 0) {
        items.push({
          level: 'info',
          text: (proj.title || proj.name) + ' ' + state.month + '월 인건비 미입력',
          link: 'project-labor.html?projectId=' + proj.id,
        });
      }
    });

    if (!items.length) {
      listEl.innerHTML = '<div class="ld-empty"><div class="ld-empty-icon">✅</div>주의가 필요한 항목이 없습니다.</div>';
      return;
    }

    var levelOrder = { urgent: 0, warn: 1, info: 2 };
    items.sort(function (a, b) { return levelOrder[a.level] - levelOrder[b.level]; });

    var labelMap = { urgent: '긴급', warn: '주의', info: '알림' };
    var html = items.map(function (it) {
      return ''
        + '<div class="ld-action-row">'
        +   '<span class="ld-action-level ld-action-level--' + it.level + '">' + labelMap[it.level] + '</span>'
        +   '<span class="ld-action-text">' + escapeHtml(it.text) + '</span>'
        +   (it.link
              ? '<a class="ld-action-btn" href="' + it.link + '">바로가기 →</a>'
              : '<span></span>')
        + '</div>';
    }).join('');

    listEl.innerHTML = html;
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

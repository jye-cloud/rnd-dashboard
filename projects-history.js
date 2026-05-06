/**
 * 과제 수행 현황 페이지 (projects-history.js)
 * - 일반 사용자가 조회하는 페이지
 * - 등록/수정 기능 없음 (조회 전용)
 * - 수행 중 / 종료 / 예정 카드 클릭으로 필터
 * - 미선정 과제는 표시하지 않음
 */
(function () {
  'use strict';

  // ===== Utilities =====

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatNum(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '0';
    return Number(n).toLocaleString();
  }

  function formatMoneyParts(n) {
    var num = Number(n) || 0;
    if (num >= 100000000) {
      var eok = num / 100000000;
      return { value: eok.toFixed(eok >= 100 ? 0 : 1).replace(/\.0$/, ''), unit: '억' };
    }
    if (num >= 10000) {
      var man = Math.round(num / 10000);
      return { value: formatNum(man), unit: '만' };
    }
    return { value: formatNum(num), unit: '원' };
  }

  function formatMoneyShort(n) {
    var p = formatMoneyParts(n);
    return p.value + p.unit;
  }

  // ===== Data helpers =====

  function projectOverlapsYear(it, year) {
    var y = String(year);
    var start = (it.startDate || it.start || '').toString().slice(0, 10);
    var end = (it.endDate || it.end || '').toString().slice(0, 10);
    if (!start && !end) return true;
    var yearStart = y + '-01-01';
    var yearEnd = y + '-12-31';
    if (start && start > yearEnd) return false;
    if (end && end < yearStart) return false;
    return true;
  }

  /**
   * 진행 여부 정규화 — 예정/대기/수행/종료/미선정 5종으로 통일.
   * 기존 데이터의 "수행"/"수행중"은 "수행"으로 자동 변환.
   */
  function normalizeStatus(it) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    var n = raw.replace(/\s/g, '');
    if (n === '수행중' || n === '수행') return '수행';
    // "예정" + 제출일 지남 → 자동으로 "대기"로 표시 (저장 데이터는 그대로 "예정")
    if (raw === '예정') {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submitDate) {
        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
          String(today.getMonth() + 1).padStart(2, '0') + '-' +
          String(today.getDate()).padStart(2, '0');
        if (todayStr > submitDate) return '대기';
      }
      return '예정';
    }
    if (raw === '대기' || raw === '종료' || raw === '미선정' || raw === '미제출') return raw;
    return raw || '미정';
  }

  function getStatusBadgeClass(status) {
    if (status === '수행')   return 'projects-badge--ongoing';
    if (status === '예정')   return 'projects-badge--scheduled';
    if (status === '대기')   return 'projects-badge--waiting';
    if (status === '종료')   return 'projects-badge--end';
    if (status === '미선정') return 'projects-badge--end';
    if (status === '미제출') return 'projects-badge--unsubmitted';
    return 'projects-badge--end';
  }

  /**
   * 수행 현황 페이지에 표시할 과제만 필터:
   *   - 수행 중 / 종료 / 예정 만 포함 (미선정 제외)
   */
  function isVisibleProject(it) {
    var s = normalizeStatus(it);
    return s === '수행' || s === '대기' || s === '종료' || s === '예정';
  }

  // ===== 검색 매칭 =====

  function projectMatchesSearch(it, query) {
    if (!query) return true;
    var q = String(query).toLowerCase().trim();
    if (!q) return true;
    var fields = [
      it.projectName, it['과제명'],
      it.manager, it['책임자'],
      it.department, it['부처'],
      it.business, it['사업명'],
      it.institution, it['기관명'],
      it.keywords, it.keyword, it['키워드'],
      it.no
    ];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f != null && String(f).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  // 분류(division1) 매칭
  function projectMatchesDivision(it, division) {
    if (!division) return true;
    return (it.division1 || it['구분1'] || '') === division;
  }

  // ===== 통계 계산 =====

  function computeStats(visibleItems) {
    var ongoing = 0, ended = 0, scheduled = 0;
    var totalSum = 0;

    visibleItems.forEach(function (it) {
      var s = normalizeStatus(it);
      if (s === '수행') ongoing++;
      else if (s === '종료') ended++;
      else if (s === '예정') scheduled++;

      var st = it.supportTotal != null ? Number(it.supportTotal)
             : (it.budget != null ? Number(it.budget) : 0);
      if (!isNaN(st)) totalSum += st;
    });

    return { ongoing: ongoing, ended: ended, scheduled: scheduled, totalSum: totalSum };
  }

  // ===== Renderers =====

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function renderStats(stats) {
    setText('stat-ongoing', stats.ongoing);
    setText('stat-ended', stats.ended);
    setText('stat-scheduled', stats.scheduled);

    var sumParts = formatMoneyParts(stats.totalSum);
    setText('stat-total-sum', sumParts.value);
    setText('stat-total-sum-unit', ' ' + sumParts.unit);
  }

  function renderTable(items) {
    var tbody = document.getElementById('history-tbody');
    var empty = document.getElementById('history-empty');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (items.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    items.forEach(function (it, idx) {
      var status = normalizeStatus(it);
      var badgeClass = getStatusBadgeClass(status);
      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var name = it.projectName || it['과제명'] || it.keywords || '-';
      var manager = it.manager || it['책임자'] || '-';
      var dept = it.department || it['부처'] || '-';
      var business = it.business || it['사업명'] || '-';
      var institution = it.institution || it['기관명'] || '-';
      var supportTotal = it.supportTotal != null ? Number(it.supportTotal)
                      : (it.budget != null ? Number(it.budget) : 0);

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(no) + '</td>' +
        '<td class="col-status"><span class="projects-badge ' + badgeClass + '">' + escapeHtml(status) + '</span></td>' +
        '<td>' + escapeHtml(submitDate || '-') + '</td>' +
        '<td>' + escapeHtml(name) + '</td>' +
        '<td>' + escapeHtml(manager) + '</td>' +
        '<td>' + escapeHtml(dept) + '</td>' +
        '<td>' + escapeHtml(business) + '</td>' +
        '<td>' + escapeHtml(institution) + '</td>' +
        '<td>' + escapeHtml(start || '-') + '</td>' +
        '<td>' + escapeHtml(end || '-') + '</td>' +
        '<td class="col-amount">' + formatMoneyShort(supportTotal) + '</td>';
      tbody.appendChild(tr);
    });
  }

  // ===== Init =====

  function init() {
    // sidebar toggle
    var sidebar = document.getElementById('sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('sidebar--collapsed');
        try { localStorage.setItem('hr-sidebar-collapsed', sidebar.classList.contains('sidebar--collapsed') ? '1' : ''); } catch (e) {}
      });
      try { if (localStorage.getItem('hr-sidebar-collapsed') === '1') sidebar.classList.add('sidebar--collapsed'); } catch (e) {}
    }

    // 페이지 상태
    var latestItems = [];
    var activeStatusFilter = null;   // '수행' | '종료' | '예정' | null
    var activeDivisionFilter = null; // '과제' | '지원사업' | '용역' | '기타' | null
    var activeSearchQuery  = '';
    var yearFilterEl   = document.getElementById('history-year-filter');
    var metaEl         = document.getElementById('history-meta');
    var searchInput    = document.getElementById('history-search');
    var searchClearBtn = document.getElementById('history-search-clear');
    var searchWrap     = document.getElementById('history-search-wrap');
    var activeFiltersWrap = document.getElementById('history-active-filters');

    function getFilterYear() {
      var v = yearFilterEl ? yearFilterEl.value : '';
      return v || null;
    }

    function updateActiveCardUI() {
      document.querySelectorAll('.history-stat-card.clickable').forEach(function (card) {
        var f = card.getAttribute('data-filter');
        var isActive = (f === activeStatusFilter);
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function updateActiveDivisionUI() {
      document.querySelectorAll('.division-pill').forEach(function (pill) {
        var d = pill.getAttribute('data-division');
        var isActive = (d === activeDivisionFilter);
        pill.classList.toggle('is-active', isActive);
        pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function renderFilterChip() {
      if (!activeFiltersWrap) return;
      activeFiltersWrap.innerHTML = '';

      var chips = [];
      if (activeStatusFilter)   chips.push({ label: activeStatusFilter, clear: function () { activeStatusFilter = null; } });
      if (activeDivisionFilter) chips.push({ label: activeDivisionFilter, clear: function () { activeDivisionFilter = null; } });

      chips.forEach(function (c) {
        var chip = document.createElement('span');
        chip.className = 'history-filter-chip';
        chip.innerHTML = '필터: ' + escapeHtml(c.label) +
          ' <button type="button" class="history-filter-chip-clear" aria-label="필터 해제">×</button>';
        activeFiltersWrap.appendChild(chip);
        chip.querySelector('.history-filter-chip-clear').addEventListener('click', function () {
          c.clear();
          applyAndRender();
        });
      });
    }

    function applyAndRender() {
      var items = Array.isArray(latestItems) ? latestItems : [];

      // 1단계: 미선정 등 비표시 항목 제외
      var visible = items.filter(isVisibleProject);

      // 2단계: 연도 필터
      var filterYear = getFilterYear();
      if (filterYear) {
        visible = visible.filter(function (it) { return projectOverlapsYear(it, filterYear); });
      }

      // 분류 카운트는 (연도 필터까지만 적용된) 풀에서 계산
      var divisionCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
      visible.forEach(function (it) {
        var d = (it.division1 || it['구분1'] || '').toString();
        if (divisionCounts.hasOwnProperty(d)) divisionCounts[d]++;
      });

      // 통계는 카드/검색/분류 필터를 무시하고 위 결과(연도 적용 후)로 계산
      var stats = computeStats(visible);
      renderStats(stats);

      // '총 N건' 갱신 (연도 적용 후 전체)
      var totalEl = document.getElementById('stat-history-total');
      if (totalEl) totalEl.textContent = visible.length;

      // 분류 pill 카운트 갱신
      Object.keys(divisionCounts).forEach(function (d) {
        var el = document.getElementById('stat-div-' + d);
        if (el) el.textContent = divisionCounts[d];
      });

      // 3단계: 카드(상태) 필터
      var listItems = visible;
      if (activeStatusFilter) {
        listItems = listItems.filter(function (it) {
          return normalizeStatus(it) === activeStatusFilter;
        });
      }

      // 4단계: 분류 필터
      if (activeDivisionFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesDivision(it, activeDivisionFilter);
        });
      }

      // 5단계: 검색
      if (activeSearchQuery) {
        listItems = listItems.filter(function (it) {
          return projectMatchesSearch(it, activeSearchQuery);
        });
      }

      renderTable(listItems);

      // 메타 텍스트 업데이트
      if (metaEl) {
        var label = filterYear ? filterYear + '년 수행 과제' : '전체 기간 수행 과제';
        if (activeStatusFilter || activeDivisionFilter || activeSearchQuery) {
          label += ' · 결과 ' + listItems.length + '건';
        } else {
          label += ' · 총 ' + visible.length + '건';
        }
        metaEl.textContent = label;
      }

      updateActiveCardUI();
      updateActiveDivisionUI();
      renderFilterChip();
    }

    // 연도 필터
    if (yearFilterEl) {
      yearFilterEl.addEventListener('change', function () {
        applyAndRender();
      });
    }

    // 카드 클릭 → 상태 필터 토글
    document.querySelectorAll('.history-stat-card.clickable').forEach(function (card) {
      var status = card.getAttribute('data-filter');
      function handle() {
        if (activeStatusFilter === status) {
          activeStatusFilter = null;
        } else {
          activeStatusFilter = status;
        }
        applyAndRender();
      }
      card.addEventListener('click', handle);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handle();
        }
      });
    });

    // 분류 pill 클릭 → 분류 필터 토글 (다른 필터와 AND 조건)
    document.querySelectorAll('.division-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var d = pill.getAttribute('data-division');
        if (activeDivisionFilter === d) {
          activeDivisionFilter = null;
        } else {
          activeDivisionFilter = d;
        }
        applyAndRender();
      });
    });

    // "총 N건" 헤더 클릭 → 분류 필터 해제 (전체 보기)
    var divisionClearTrigger = document.getElementById('division-clear-trigger');
    if (divisionClearTrigger) {
      function clearDivision() {
        if (activeDivisionFilter !== null) {
          activeDivisionFilter = null;
          applyAndRender();
        }
      }
      divisionClearTrigger.addEventListener('click', clearDivision);
      divisionClearTrigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clearDivision();
        }
      });
    }

    // 검색
    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var v = searchInput.value || '';
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          activeSearchQuery = v.trim();
          if (searchWrap) searchWrap.classList.toggle('has-value', !!v);
          applyAndRender();
        }, 100);
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = '';
          activeSearchQuery = '';
          if (searchWrap) searchWrap.classList.remove('has-value');
          applyAndRender();
        }
      });
    }
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        activeSearchQuery = '';
        if (searchWrap) searchWrap.classList.remove('has-value');
        applyAndRender();
        if (searchInput) searchInput.focus();
      });
    }

    // Firestore 구독
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        latestItems = Array.isArray(items) ? items : [];
        applyAndRender();
      });
    } else {
      applyAndRender();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

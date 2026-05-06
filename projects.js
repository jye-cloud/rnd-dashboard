/**
 * 과제 관리 페이지 - Firestore 실시간 연동
 */
(function () {
  'use strict';

  var CUTOFF = '2026-01-01';
  var STAT_YEAR = 2026;
  var COL_KEYS = ['부처', '예산', '과제명', '기관명', '연구기간', '지원금당해', '지원금총', '비고'];

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
  var COL_FIELDS = { '부처': 'department', '예산': 'budget', '과제명': 'projectName', '기관명': 'institution', '연구기간': 'researchPeriod', '지원금당해': 'supportYear', '지원금총': 'supportTotal', '비고': 'note' };

  function getVal(item, key) {
    var f = COL_FIELDS[key];
    return item[f] != null ? String(item[f]) : (item[key] != null ? String(item[key]) : '');
  }

  function getResearchPeriodDisplay(item, filterYear) {
    var fallbackStart = (item.startDate || item.start || '').toString().slice(0, 10);
    var fallbackEnd = (item.endDate || item.end || '').toString().slice(0, 10);
    var yearStr = filterYear ? String(filterYear) : null;
    var arr = item.annualData || item.yearBudgets || [];
    if (!Array.isArray(arr)) arr = [];
    for (var i = 0; i < arr.length; i++) {
      var y = arr[i];
      var s = (y.start || y.startDate || '').toString().slice(0, 10);
      var e = (y.end || y.endDate || '').toString().slice(0, 10);
      if (!s && !e) continue;
      var sYear = s ? s.slice(0, 4) : '';
      var eYear = e ? e.slice(0, 4) : '';
      if (yearStr && sYear && eYear && sYear <= yearStr && yearStr <= eYear) {
        return (s || '-') + ' ~ ' + (e || '-');
      }
    }
    if (fallbackStart || fallbackEnd) return (fallbackStart || '-') + ' ~ ' + (fallbackEnd || '-');
    return '-';
  }

  function getDivision2Class(status) {
    var s = (status || '').trim().toLowerCase();
    if (s === '종료') return 'projects-badge--end';
    if (s === '수행' || s === '수행중') return 'projects-badge--ongoing';
    if (s === '예정') return 'projects-badge--scheduled';
    if (s === '대기') return 'projects-badge--waiting';
    if (s === '미선정') return 'projects-badge--unselected';
    if (s === '미제출') return 'projects-badge--unsubmitted';
    return 'projects-badge--end';
  }

  // 진행 여부 정규화 — 자동 "대기" 전환 포함
  // 저장된 데이터의 status는 그대로 두고, 표시할 때 "예정 + 제출일 지남" → "대기"로 변환
  function normalizeStatus(it) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    var n = raw.replace(/\s/g, '');
    if (n === '수행중' || n === '수행') return '수행';
    // "예정" + 제출일 지남 → 자동으로 "대기" 표시 (저장 데이터는 "예정" 그대로)
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

  function getKeywordHtml(item) {
    var isRd = item.isRd === true || item.rd === true || item['R&D 여부'] === true;
    var kw = item.keywords || item.keyword || '';
    if (typeof kw !== 'string') kw = Array.isArray(kw) ? kw.join(', ') : String(kw);
    var rdTag = isRd ? '<span class="projects-badge projects-badge--rd">[R&D]</span>' : '';
    return rdTag + escapeHtml(kw || '-');
  }

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

  function updateStats(items, year) {
    year = year || STAT_YEAR;
    var hasYearFilter = !!year;  // 항상 true (year는 fallback)
    var rawYear = year;
    var filtered = items.filter(function (it) { return projectOverlapsYear(it, year); });
    var total = filtered.length;
    var ongoingAll = 0;   // 수행 중 전체 (전체 연도 모드에서 사용)
    var continueCnt = 0;
    var newCnt = 0;
    var unselectedCnt = 0;
    var yearSum = 0;
    var totalSum = 0;
    var cutoff = year + '-01-01';

    filtered.forEach(function (it) {
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var status = (it.status || it['진행 여부'] || '').toString().trim();
      var statusNorm = status.replace(/\s/g, '');
      if (statusNorm === '수행중' || status === '수행') {
        ongoingAll++;
        if (start && start < cutoff) continueCnt++;
        else newCnt++;
      }
      if (statusNorm === '미선정' || status === '미선정') unselectedCnt++;

      var sy = 0;
      if (Number(year) === 2026 && it.supportYear != null && !isNaN(Number(it.supportYear))) {
        sy = Number(it.supportYear);
      } else if (it.yearBudgets && Array.isArray(it.yearBudgets)) {
        it.yearBudgets.forEach(function (y) {
          var s = (y.startDate || '').slice(0, 4);
          var e = (y.endDate || '').slice(0, 4);
          if ((s && s <= String(year)) && (e && e >= String(year))) sy += Number(y.support || 0);
        });
      }
      yearSum += sy;
      var st = it.supportTotal != null ? Number(it.supportTotal) : (it.budget != null ? Number(it.budget) : 0);
      if (!isNaN(st)) totalSum += st;
    });

    setEl('stat-total', total);
    setEl('stat-ongoing-all', ongoingAll);
    setEl('stat-continue', continueCnt);
    setEl('stat-new', newCnt);
    setEl('stat-unselected', unselectedCnt);
    setEl('stat-year-sum', formatNum(yearSum));
    setEl('stat-total-sum', formatNum(totalSum));
  }

  function setEl(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function getColVisibility() {
    var vis = {};
    COL_KEYS.forEach(function (k) {
      var cb = document.querySelector('#col-panel input[data-col="' + k + '"]');
      vis[k] = cb ? cb.checked : false;
    });
    return vis;
  }

  function saveColVisibility(vis) {
    COL_KEYS.forEach(function (k) {
      var cb = document.querySelector('#col-panel input[data-col="' + k + '"]');
      if (cb) cb.checked = !!vis[k];
    });
  }

  function loadColVisibility() {
    try {
      var raw = localStorage.getItem('projects-col-visibility');
      if (raw) {
        var vis = JSON.parse(raw);
        saveColVisibility(vis);
      }
    } catch (e) {}
  }

  function applyColVisibility(vis) {
    var ths = document.querySelectorAll('#projects-table thead th.col-opt');
    var rows = document.querySelectorAll('#projects-table tbody tr');
    var showVal = 'table-cell';
    ths.forEach(function (th) {
      var col = th.getAttribute('data-col');
      var show = vis[col];
      th.style.display = show ? showVal : 'none';
    });
    rows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td.col-opt');
      cells.forEach(function (td) {
        var col = td.getAttribute('data-col');
        var show = vis[col];
        td.style.display = show ? showVal : 'none';
      });
    });
  }

  function renderTable(items, colVis, filterYear, onEdit) {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    items.forEach(function (it, idx) {
      var id = it.id || it.docId || 'item-' + idx;
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      var div1 = (it.division1 || '').toString() || (start && start < CUTOFF ? '계속' : (start ? '신규' : '-'));
      var div2 = (it.division2 || '').toString() || (start && start < CUTOFF ? '계속' : (start ? '신규' : '-'));
      // 진행 여부: 저장된 raw 값 대신 자동 전환된 표시값 사용 (예정 + 제출일 지남 → 대기)
      var status = normalizeStatus(it);
      var badgeClass = getDivision2Class(status);
      var div1Display = div1 === '신규' ? '<strong>[신규]</strong>' : escapeHtml(div1 || '-');

      var tr = document.createElement('tr');
      tr.setAttribute('data-id', id);

      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var cells = [
        '<td>' + escapeHtml(no) + '</td>',
        '<td>' + div1Display + '</td>',
        '<td>' + escapeHtml(div2 || '-') + '</td>',
        '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(status || '-') + '</span></td>',
        '<td>' + escapeHtml(submitDate || '-') + '</td>',
        '<td>' + getKeywordHtml(it) + '</td>',
        '<td>' + escapeHtml(it.manager || it.책임자 || '-') + '</td>',
        '<td>' + escapeHtml(start || '-') + '</td>',
        '<td>' + escapeHtml(end || '-') + '</td>'
      ];

      COL_KEYS.forEach(function (k) {
        var val = k === '연구기간' ? getResearchPeriodDisplay(it, filterYear) : (getVal(it, k) || '-');
        cells.push('<td class="col-opt" data-col="' + k + '">' + escapeHtml(val) + '</td>');
      });

      cells.push('<td style="text-align:center"><button type="button" class="ui-btn ui-btn--ghost project-edit-btn" data-id="' + escapeHtml(id) + '">수정</button></td>');
      tr.innerHTML = cells.join('');

      var editBtn = tr.querySelector('.project-edit-btn');
      if (editBtn && typeof onEdit === 'function') {
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          onEdit(it);
        });
      }

      tbody.appendChild(tr);
    });

    applyColVisibility(colVis || getColVisibility());
  }

  function init() {
    var sidebar = document.getElementById('sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('sidebar--collapsed');
        try { localStorage.setItem('hr-sidebar-collapsed', sidebar.classList.contains('sidebar--collapsed') ? '1' : ''); } catch (e) {}
      });
      try { if (localStorage.getItem('hr-sidebar-collapsed') === '1') sidebar.classList.add('sidebar--collapsed'); } catch (e) {}
    }
    loadColVisibility();
    var colVis = getColVisibility();

    var colToggle = document.getElementById('col-toggle-btn');
    var colPanel = document.getElementById('col-panel');
    if (colToggle && colPanel) {
      colToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        colPanel.classList.toggle('open');
      });
      document.addEventListener('click', function () {
        colPanel.classList.remove('open');
      });
      colPanel.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      colPanel.querySelectorAll('input').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var vis = getColVisibility();
          applyColVisibility(vis);
          try { localStorage.setItem('projects-col-visibility', JSON.stringify(vis)); } catch (e) {}
        });
      });
    }

    var svc = window.firestoreService;
    var latestItems = [];
    var yearFilter = document.getElementById('project-year-filter');
    var filterHint = document.getElementById('project-filter-hint');
    var activeFiltersWrap = document.getElementById('project-active-filters');

    // ----- 활성 필터 상태 -----
    // activeCardFilter: 'continue' | 'new' | 'unselected' (카드 클릭으로 활성화)
    // activeStatusFilter: '수행' | '예정' | '종료' (URL ?status= 진입 시, 카드와 매칭 안 되는 status용)
    // activeDivisionFilter: '과제' | '지원사업' | '용역' | '기타' (분류 pill 클릭으로 활성화)
    // activeSearchQuery: 검색 입력 키워드
    var activeCardFilter = null;
    var activeStatusFilter = null;
    var activeDivisionFilter = null;
    var activeSearchQuery = '';
    var lastFilteredItems = []; // 엑셀 내보내기용 — 현재 화면에 보이는 아이템들

    // 페이지 로드 시 URL 파라미터에서 초기 필터 읽기
    (function readInitialFilter() {
      var params = new URLSearchParams(location.search);
      var filter = params.get('filter');
      var status = params.get('status');
      var division = params.get('division');

      if (filter === 'ongoing' || filter === 'continue' || filter === 'new' || filter === 'unselected') {
        activeCardFilter = filter;
      }

      if (status) {
        var trimmed = decodeURIComponent(status).trim();
        var trimmedNorm = trimmed.replace(/\s/g, '');
        // 카드와 매칭 가능한 것은 카드 활성화로 매핑
        if (trimmedNorm === '미선정') {
          activeCardFilter = 'unselected';
        } else if (trimmedNorm === '수행' || trimmedNorm === '수행중') {
          // '수행'은 카드가 계속/신규로 분리되어 있으므로 별도 status 필터 사용
          activeStatusFilter = '수행';
        } else if (trimmedNorm === '예정' || trimmedNorm === '종료') {
          activeStatusFilter = trimmed;
        }
      }

      if (division) {
        var d = decodeURIComponent(division).trim();
        if (d === '과제' || d === '지원사업' || d === '용역' || d === '기타') {
          activeDivisionFilter = d;
        }
      }
    })();

    function getFilterYear() {
      var v = yearFilter ? yearFilter.value : '';
      return v || null;
    }
    function getStatsYear() {
      var y = getFilterYear();
      return y ? parseInt(y, 10) : STAT_YEAR;
    }

    // 카드 필터(ongoing/continue/new/unselected) 매칭
    function projectMatchesCardFilter(it, filter, cutoff) {
      if (!filter) return true;
      var status = (it.status || it['진행 여부'] || '').toString();
      var statusNorm = status.replace(/\s/g, '');
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var isOngoing = statusNorm === '수행중' || status === '수행';

      if (filter === 'ongoing')  return isOngoing;
      if (filter === 'continue') return isOngoing && !!start && start < cutoff;
      if (filter === 'new')      return isOngoing && (!start || start >= cutoff);
      if (filter === 'unselected') return statusNorm === '미선정';
      return true;
    }

    // status 필터(수행 중/예정/종료) 매칭
    function projectMatchesStatusFilter(it, status) {
      if (!status) return true;
      var s = (it.status || it['진행 여부'] || it.division2 || '').toString().trim();
      var sNorm = s.replace(/\s/g, '');
      var targetNorm = status.replace(/\s/g, '');
      return s === status || sNorm === targetNorm;
    }

    // 검색 매칭 — 여러 필드를 합쳐서 substring 검색 (대소문자 무시)
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

    // 카드 활성 상태 UI 동기화
    function updateActiveCardUI() {
      document.querySelectorAll('.projects-stat-card.clickable').forEach(function (card) {
        var f = card.getAttribute('data-filter');
        var isActive = (f === activeCardFilter);
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    // 분류 pill 활성 상태 UI 동기화
    function updateActiveDivisionUI() {
      document.querySelectorAll('.division-pill').forEach(function (pill) {
        var d = pill.getAttribute('data-division');
        var isActive = (d === activeDivisionFilter);
        pill.classList.toggle('is-active', isActive);
        pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    // 활성 필터 chip 렌더 (카드/status/분류 모두 표시 가능)
    function renderActiveFilterChip() {
      if (!activeFiltersWrap) return;
      activeFiltersWrap.innerHTML = '';

      var chips = [];
      if (activeCardFilter === 'ongoing')          chips.push({ label: '수행',         clear: function () { activeCardFilter = null; } });
      else if (activeCardFilter === 'continue')    chips.push({ label: '수행 (계속)',  clear: function () { activeCardFilter = null; } });
      else if (activeCardFilter === 'new')         chips.push({ label: '수행 (신규)',  clear: function () { activeCardFilter = null; } });
      else if (activeCardFilter === 'unselected')  chips.push({ label: '미선정',          clear: function () { activeCardFilter = null; } });
      if (activeStatusFilter)                     chips.push({ label: activeStatusFilter, clear: function () { activeStatusFilter = null; } });
      if (activeDivisionFilter)                   chips.push({ label: activeDivisionFilter, clear: function () { activeDivisionFilter = null; } });

      chips.forEach(function (c) {
        var chip = document.createElement('span');
        chip.className = 'projects-filter-chip';
        chip.innerHTML = '필터: ' + escapeHtml(c.label) +
          ' <button type="button" class="projects-filter-chip-clear" aria-label="필터 해제">×</button>';
        activeFiltersWrap.appendChild(chip);
        chip.querySelector('.projects-filter-chip-clear').addEventListener('click', function () {
          c.clear();
          syncURL();
          applyFilterAndRender(latestItems);
        });
      });
    }

    // URL 파라미터 동기화 (페이지 새로고침해도 필터 유지)
    function syncURL() {
      var params = new URLSearchParams(location.search);
      params.delete('filter');
      params.delete('status');
      params.delete('division');
      if (activeCardFilter)     params.set('filter', activeCardFilter);
      if (activeStatusFilter)   params.set('status', activeStatusFilter);
      if (activeDivisionFilter) params.set('division', activeDivisionFilter);
      var query = params.toString();
      var newUrl = location.pathname + (query ? '?' + query : '') + location.hash;
      try { history.replaceState(null, '', newUrl); } catch (e) {}
    }

    function applyFilterAndRender(items) {
      items = Array.isArray(items) ? items : [];
      latestItems = items;
      var filterYear = getFilterYear();
      var statsYear = getStatsYear();
      var cutoff = statsYear + '-01-01';

      // 1단계: 연도 필터
      var listItems = filterYear ? items.filter(function (it) { return projectOverlapsYear(it, filterYear); }) : items;

      // 분류별 카운트는 (연도 필터까지만 적용된) 풀에서 계산 — pill 숫자가 의미 가지도록
      var divisionCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
      listItems.forEach(function (it) {
        var d = (it.division1 || it['구분1'] || '').toString();
        if (divisionCounts.hasOwnProperty(d)) divisionCounts[d]++;
      });

      // 2단계: 카드 필터
      if (activeCardFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesCardFilter(it, activeCardFilter, cutoff);
        });
      }

      // 3단계: status 필터 (URL 진입용)
      if (activeStatusFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesStatusFilter(it, activeStatusFilter);
        });
      }

      // 4단계: 분류(division1) 필터
      if (activeDivisionFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesDivision(it, activeDivisionFilter);
        });
      }

      // 5단계: 검색 키워드 필터
      if (activeSearchQuery) {
        listItems = listItems.filter(function (it) {
          return projectMatchesSearch(it, activeSearchQuery);
        });
      }

      // 엑셀 내보내기를 위해 현재 보이는 아이템 보관
      lastFilteredItems = listItems;

      // 통계는 항상 연도 기준 전체 (모든 필터 무시 — 그래야 카드/pill 숫자가 의미를 가짐)
      updateStats(items, statsYear);
      // 분류 pill 카운트 갱신
      Object.keys(divisionCounts).forEach(function (d) {
        var el = document.getElementById('stat-div-' + d);
        if (el) el.textContent = divisionCounts[d];
      });

      // 연도 필터 모드에 따라 카드 가시성 결정:
      //   - 특정 연도 → 계속/신규 카드 표시, 통합 "수행" 카드 숨김
      //   - "전체"   → 통합 "수행" 카드 표시, 계속/신규 카드 숨김
      var cardOngoingAll = document.getElementById('card-ongoing-all');
      var cardContinue   = document.getElementById('card-continue');
      var cardNew        = document.getElementById('card-new');
      if (filterYear) {
        if (cardOngoingAll) cardOngoingAll.style.display = 'none';
        if (cardContinue)   cardContinue.style.display   = '';
        if (cardNew)        cardNew.style.display        = '';
        // ongoing 필터가 활성 상태에서 특정 연도로 전환 → 필터 해제
        if (activeCardFilter === 'ongoing') {
          activeCardFilter = null;
          syncURL();
        }
      } else {
        if (cardOngoingAll) cardOngoingAll.style.display = '';
        if (cardContinue)   cardContinue.style.display   = 'none';
        if (cardNew)        cardNew.style.display        = 'none';
        // continue/new 필터가 활성 상태에서 전체로 전환 → ongoing 으로 통합
        if (activeCardFilter === 'continue' || activeCardFilter === 'new') {
          activeCardFilter = 'ongoing';
          syncURL();
        }
      }

      renderTable(listItems, colVis, filterYear || STAT_YEAR, projectEditHandler);

      if (filterHint) {
        var listLabel = filterYear ? filterYear + '년' : '전체';
        var statsLabel = filterYear ? filterYear + '년' : STAT_YEAR + '년';
        var hintText = '리스트: ' + listLabel + ' / 통계: ' + statsLabel + ' 기준';
        if (activeSearchQuery || activeCardFilter || activeStatusFilter || activeDivisionFilter) {
          hintText += ' · 결과 ' + listItems.length + '건';
        }
        filterHint.textContent = hintText;
      }

      updateActiveCardUI();
      updateActiveDivisionUI();
      renderActiveFilterChip();
    }

    if (yearFilter) {
      yearFilter.addEventListener('change', function () {
        applyFilterAndRender(latestItems);
      });
    }

    // 카드 클릭 → 필터 토글 (수행 중-계속/신규, 미선정만)
    document.querySelectorAll('.projects-stat-card.clickable').forEach(function (card) {
      var f = card.getAttribute('data-filter');
      function handle() {
        if (activeCardFilter === f) {
          // 같은 카드 재클릭: 토글 해제
          activeCardFilter = null;
        } else {
          // 다른 카드 클릭: 카드 필터 전환 (status 필터도 같이 해제)
          activeCardFilter = f;
          activeStatusFilter = null;
        }
        syncURL();
        applyFilterAndRender(latestItems);
      }
      card.addEventListener('click', handle);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handle();
        }
      });
    });

    // 분류 pill 클릭 → 분류 필터 토글 (다른 필터와 AND 조건으로 결합)
    document.querySelectorAll('.division-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var d = pill.getAttribute('data-division');
        if (activeDivisionFilter === d) {
          activeDivisionFilter = null;
        } else {
          activeDivisionFilter = d;
        }
        syncURL();
        applyFilterAndRender(latestItems);
      });
    });

    // "총 제안" 헤더 클릭 → 분류 필터 해제 (전체 보기)
    var divisionClearTrigger = document.getElementById('division-clear-trigger');
    if (divisionClearTrigger) {
      function clearDivision() {
        if (activeDivisionFilter !== null) {
          activeDivisionFilter = null;
          syncURL();
          applyFilterAndRender(latestItems);
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

    // 과제 등록 버튼: 상세 페이지로 이동
    var addBtn = document.getElementById('project-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        window.location.href = 'project-detail.html';
      });
    }

    // 테이블 행 "수정" 버튼: 상세 페이지로 이동 (편집 모드)
    var projectEditHandler = function (item) {
      var id = item.id || item.docId;
      if (!id) return;
      window.location.href = 'project-detail.html?id=' + encodeURIComponent(id);
    };

    // 검색 입력 — 입력하는 즉시 필터 적용 (debounce 약간)
    var searchInput = document.getElementById('project-search');
    var searchClear = document.getElementById('search-clear');
    var searchWrap  = document.getElementById('search-wrap');
    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var v = searchInput.value || '';
        // 입력 중에는 빠른 입력 보호를 위해 100ms debounce
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          activeSearchQuery = v.trim();
          if (searchWrap) searchWrap.classList.toggle('has-value', !!v);
          applyFilterAndRender(latestItems);
        }, 100);
      });
      // ESC 키로 검색 초기화
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = '';
          activeSearchQuery = '';
          if (searchWrap) searchWrap.classList.remove('has-value');
          applyFilterAndRender(latestItems);
        }
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        activeSearchQuery = '';
        if (searchWrap) searchWrap.classList.remove('has-value');
        applyFilterAndRender(latestItems);
        if (searchInput) searchInput.focus();
      });
    }

    // 엑셀 다운로드 버튼
    var exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportToExcel(lastFilteredItems);
      });
    }

    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        applyFilterAndRender(items);
      });
    } else {
      applyFilterAndRender([]);
    }
  }

  // ===== 엑셀 내보내기 =====

  function exportToExcel(items) {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리(SheetJS)가 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
      return;
    }
    if (!items || items.length === 0) {
      alert('내보낼 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    // 한글 헤더로 행 구성
    var rows = items.map(function (it, idx) {
      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      var status = normalizeStatus(it);  // 자동 전환 적용
      var isRd = !!(it.isRd || it.rd || it['R&D 여부']);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var unsubReason = it.unsubmittedReason || it['미제출 사유'] || '';
      return {
        'No': no,
        '구분 1': it.division1 || it['구분1'] || '',
        '구분 2': it.division2 || it['구분2'] || '',
        '진행 여부': status,
        '제출일': submitDate,
        '미제출 사유': unsubReason,
        'R&D 여부': isRd ? 'Y' : 'N',
        '키워드': it.keywords || it.keyword || it['키워드'] || '',
        '과제명': it.projectName || it['과제명'] || '',
        '책임자': it.manager || it['책임자'] || '',
        '시작일': start,
        '종료일': end,
        '부처': it.department || it['부처'] || '',
        '사업명': it.business || it['사업명'] || '',
        '전문기관': it.institution || it['기관명'] || '',
        '지원금 (당해)': Number(it.supportYear || 0),
        '지원금 (총)': Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0))
      };
    });

    var ws = XLSX.utils.json_to_sheet(rows);

    // 열 너비 지정 (헤더 순서와 일치)
    ws['!cols'] = [
      { wch: 5 },   // No
      { wch: 9 },   // 구분 1
      { wch: 7 },   // 구분 2
      { wch: 10 },  // 진행 여부
      { wch: 12 },  // 제출일
      { wch: 24 },  // 미제출 사유
      { wch: 9 },   // R&D 여부
      { wch: 22 },  // 키워드
      { wch: 42 },  // 과제명
      { wch: 10 },  // 책임자
      { wch: 12 },  // 시작일
      { wch: 12 },  // 종료일
      { wch: 16 },  // 부처
      { wch: 26 },  // 사업명
      { wch: 18 },  // 전문기관
      { wch: 16 },  // 지원금 (당해)
      { wch: 16 }   // 지원금 (총)
    ];

    // 지원금 열은 숫자 포맷 적용
    var range = XLSX.utils.decode_range(ws['!ref']);
    for (var R = range.s.r + 1; R <= range.e.r; R++) {
      // P열(16)과 Q열(17)이 지원금 (제출일/미제출 사유 컬럼이 추가되어 N,O에서 P,Q로 이동)
      ['P', 'Q'].forEach(function (col) {
        var cellRef = col + (R + 1);
        if (ws[cellRef]) {
          ws[cellRef].t = 'n';
          ws[cellRef].z = '#,##0';
        }
      });
    }

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '과제 목록');

    // 파일명: 과제목록_YYYY-MM-DD.xlsx
    var today = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var dateStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    var filename = '과제목록_' + dateStr + '.xlsx';

    try {
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('엑셀 내보내기 실패:', err);
      alert('엑셀 내보내기에 실패했습니다. 다시 시도해 주세요.');
    }
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

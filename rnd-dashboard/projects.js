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
    if (s === '수행 중' || s === '수행중') return 'projects-badge--ongoing';
    if (s === '예정') return 'projects-badge--scheduled';
    if (s === '미선정') return 'projects-badge--unselected';
    return 'projects-badge--end';
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
    var filtered = items.filter(function (it) { return projectOverlapsYear(it, year); });
    var total = filtered.length;
    var continueCnt = 0;
    var newCnt = 0;
    var unselectedCnt = 0;
    var yearSum = 0;
    var totalSum = 0;
    var cutoff = year + '-01-01';

    filtered.forEach(function (it) {
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var status = (it.status || it['진행 여부'] || it.division2 || '').toString().trim();
      var statusNorm = status.replace(/\s/g, '');
      if (statusNorm === '수행중' || status === '수행 중') {
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
      var status = (it.status || it['진행 여부'] || it.division2 || '').toString();
      var badgeClass = getDivision2Class(status);
      var div1Display = div1 === '신규' ? '<strong>[신규]</strong>' : escapeHtml(div1 || '-');

      var tr = document.createElement('tr');
      tr.setAttribute('data-id', id);

      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var cells = [
        '<td>' + escapeHtml(no) + '</td>',
        '<td>' + div1Display + '</td>',
        '<td>' + escapeHtml(div2 || '-') + '</td>',
        '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(status || '-') + '</span></td>',
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
    function getFilterYear() {
      var v = yearFilter ? yearFilter.value : '';
      return v || null;
    }
    function getStatsYear() {
      var y = getFilterYear();
      return y ? parseInt(y, 10) : STAT_YEAR;
    }
    function applyFilterAndRender(items) {
      items = Array.isArray(items) ? items : [];
      latestItems = items;
      var filterYear = getFilterYear();
      var listItems = filterYear ? items.filter(function (it) { return projectOverlapsYear(it, filterYear); }) : items;
      var statsYear = getStatsYear();
      updateStats(items, statsYear);
      renderTable(listItems, colVis, filterYear || STAT_YEAR, projectEditHandler);
      if (filterHint) {
        filterHint.textContent = filterYear ? '리스트: ' + filterYear + '년 / 통계: ' + filterYear + '년 기준' : '리스트: 전체 / 통계: ' + STAT_YEAR + '년 기준';
      }
    }
    if (yearFilter) {
      yearFilter.addEventListener('change', function () {
        applyFilterAndRender(latestItems);
      });
    }
    var projectEditHandler = null;
    initProjectModal(svc, colVis, function (handler) { projectEditHandler = handler; });

    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        applyFilterAndRender(items);
      });
    } else {
      applyFilterAndRender([]);
    }
  }

  function initProjectModal(svc, colVis, onReady) {
    var modal = document.getElementById('project-modal');
    var modalTitle = document.getElementById('project-modal-title');
    var addBtn = document.getElementById('project-add-btn');
    var closeBtn = document.getElementById('project-modal-close');
    var cancelBtn = document.getElementById('project-modal-cancel');
    var form = document.getElementById('project-form');
    var addYearBtn = document.getElementById('project-add-year-btn');
    var tbody = document.getElementById('year-budget-tbody');
    var totalEl = document.getElementById('year-budget-total');
    var editingId = null;

    function openModal() {
      if (modal) {
        editingId = null;
        if (modalTitle) modalTitle.textContent = '과제 등록';
        modal.classList.add('active');
        modal.removeAttribute('aria-hidden');
        resetForm();
      }
    }
    function openEditModal(item) {
      if (!modal || !item) return;
      editingId = item.id || item.docId;
      if (modalTitle) modalTitle.textContent = '과제 수정';
      resetForm();
      setFormValue('project-keywords', item.keywords || item.keyword);
      setFormValue('project-name', item.projectName || item.과제명);
      setFormValue('project-business', item.business || item.사업명);
      setFormValue('project-department', item.department || item.부처);
      setFormValue('project-institution', item.institution || item.기관명);
      setFormValue('project-manager', item.manager || item.책임자);
      setFormValue('project-status', item.status || item['진행 여부']);
      var isRd = document.getElementById('project-isRd');
      if (isRd) isRd.checked = !!(item.isRd || item.rd || item['R&D 여부']);
      setRadio('project-division1', item.division1 || item.구분1);
      setRadio('project-division2', item.division2 || item.구분2);
      var years = item.yearBudgets || item.annualData || [];
      if (!Array.isArray(years)) years = [];
      tbody.innerHTML = '';
      years.forEach(function (y) {
        addYearRow();
        var lastRow = tbody.querySelector('tr:last-child');
        if (lastRow) {
          var s = (y.start || y.startDate || '').toString().slice(0, 10);
          var e = (y.end || y.endDate || '').toString().slice(0, 10);
          var sup = (y.support != null ? y.support : 0);
          var cash = (y.cash != null ? y.cash : 0);
          var ink = (y.inKind != null ? y.inKind : 0);
          var inpStart = lastRow.querySelector('.yb-start');
          var inpEnd = lastRow.querySelector('.yb-end');
          var inpSup = lastRow.querySelector('.yb-support');
          var inpCash = lastRow.querySelector('.yb-cash');
          var inpInk = lastRow.querySelector('.yb-inkind');
          if (inpStart) inpStart.value = s;
          if (inpEnd) inpEnd.value = e;
          if (inpSup) inpSup.value = sup ? formatNum(sup) : '';
          if (inpCash) inpCash.value = cash ? formatNum(cash) : '';
          if (inpInk) inpInk.value = ink ? formatNum(ink) : '';
          updateRowSubtotal(lastRow);
        }
      });
      if (years.length === 0) addYearRow();
      modal.classList.add('active');
      modal.removeAttribute('aria-hidden');
    }
    function setFormValue(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val != null ? String(val) : '';
    }
    function setRadio(name, val) {
      if (!val) return;
      var v = String(val);
      document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
        r.checked = r.value === v;
      });
    }
    function closeModal() {
      if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
      }
    }
    function resetForm() {
      if (form) form.reset();
      if (tbody) tbody.innerHTML = '';
      updateTotalDisplay();
    }

    function parseNum(val) {
      var n = Number(String(val).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
    function updateRowSubtotal(row) {
      var support = parseNum((row.querySelector('.yb-support') || {}).value);
      var cash = parseNum((row.querySelector('.yb-cash') || {}).value);
      var inKind = parseNum((row.querySelector('.yb-inkind') || {}).value);
      var sub = support + cash + inKind;
      var subEl = row.querySelector('.yb-subtotal');
      if (subEl) subEl.textContent = formatNum(sub);
      updateTotalDisplay();
    }
    function updateTotalDisplay() {
      if (!totalEl || !tbody) return;
      var rows = tbody.querySelectorAll('tr');
      var total = 0;
      rows.forEach(function (r) {
        var subEl = r.querySelector('.yb-subtotal');
        if (subEl) total += parseNum(subEl.textContent);
      });
      totalEl.textContent = '총 사업비: ' + formatNum(total) + '원';
    }
    function formatDateInput(val) {
      var s = String(val || '').replace(/\D/g, '');
      if (s.length >= 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
      if (s.length >= 6) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6);
      if (s.length >= 4) return s.slice(0, 4) + '-' + s.slice(4);
      return s;
    }
    function onDateInput(e) {
      var inp = e.target;
      var formatted = formatDateInput(inp.value);
      inp.value = formatted;
      inp.setSelectionRange(formatted.length, formatted.length);
    }
    function onAmountInput(e) {
      var inp = e.target;
      var raw = String(inp.value || '').replace(/\D/g, '');
      var formatted = raw === '' ? '' : formatNum(parseInt(raw, 10) || 0);
      inp.value = formatted;
      inp.setSelectionRange(formatted.length, formatted.length);
      var row = inp.closest('tr');
      if (row) updateRowSubtotal(row);
    }
    function addYearRow() {
      if (!tbody) return;
      var cnt = tbody.querySelectorAll('tr').length + 1;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="yb-num">' + cnt + '</td>' +
        '<td><input type="text" class="yb-start yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td><input type="text" class="yb-end yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-support" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-cash" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-inkind" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-subtotal">0</td>' +
        '<td class="yb-del-cell"><button type="button" class="close-btn yb-del" aria-label="삭제" style="font-size:1rem;padding:0.2rem">&times;</button></td>';
      tr.querySelectorAll('.yb-start, .yb-end').forEach(function (inp) {
        inp.addEventListener('input', onDateInput);
        inp.addEventListener('blur', function () {
          var v = inp.value.replace(/\D/g, '');
          if (v.length === 8) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
        });
      });
      tr.querySelectorAll('.yb-support, .yb-cash, .yb-inkind').forEach(function (inp) {
        inp.addEventListener('input', onAmountInput);
      });
      tr.querySelector('.yb-del').addEventListener('click', function () {
        tr.remove();
        renumberRows();
        updateTotalDisplay();
      });
      tbody.appendChild(tr);
      updateRowSubtotal(tr);
    }
    function renumberRows() {
      var rows = tbody.querySelectorAll('tr');
      rows.forEach(function (r, i) {
        var numEl = r.querySelector('.yb-num');
        if (numEl) numEl.textContent = i + 1;
      });
    }

    if (addBtn) addBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    if (addYearBtn) addYearBtn.addEventListener('click', addYearRow);

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var keywords = document.getElementById('project-keywords');
        var projectName = document.getElementById('project-name');
        var manager = document.getElementById('project-manager');
        if (!keywords || !keywords.value.trim()) { alert('별칭(키워드)을 입력해 주세요.'); return; }
        if (!projectName || !projectName.value.trim()) { alert('과제명을 입력해 주세요.'); return; }
        if (!manager || !manager.value.trim()) { alert('책임자를 입력해 주세요.'); return; }

        var div1 = document.querySelector('input[name="project-division1"]:checked');
        var div2 = document.querySelector('input[name="project-division2"]:checked');
        var status = document.getElementById('project-status');
        var years = [];
        var startDate = '';
        var endDate = '';
        var supportTotal = 0;
        tbody.querySelectorAll('tr').forEach(function (row) {
          var s = (row.querySelector('.yb-start') || {}).value || '';
          var e = (row.querySelector('.yb-end') || {}).value || '';
          var sup = parseNum((row.querySelector('.yb-support') || {}).value);
          var cash = parseNum((row.querySelector('.yb-cash') || {}).value);
          var ink = parseNum((row.querySelector('.yb-inkind') || {}).value);
          var sub = sup + cash + ink;
          years.push({ startDate: s, endDate: e, support: sup, cash: cash, inKind: ink, subtotal: sub });
          if (s && (!startDate || s < startDate)) startDate = s;
          if (e && (!endDate || e > endDate)) endDate = e;
          supportTotal += sub;
        });

        var supportYear = 0;
        var statYear = 2026;
        years.forEach(function (y) {
          var s = (y.startDate || '').slice(0, 4);
          var e = (y.endDate || '').slice(0, 4);
          if ((s && s <= String(statYear)) && (e && e >= String(statYear))) supportYear += (y.support || 0);
        });
        var items = (svc && svc.getProjectsData ? svc.getProjectsData() : []) || [];
        items = Array.isArray(items) ? items.slice() : [];
        var item;
        if (editingId) {
          var idx = items.findIndex(function (x) { return (x.id || x.docId) === editingId; });
          var existing = idx >= 0 ? items[idx] : null;
          item = {
            id: editingId,
            no: existing && existing.no != null ? String(existing.no) : String(idx + 1),
          keywords: (keywords || {}).value.trim(),
          projectName: (projectName || {}).value.trim(),
          business: (document.getElementById('project-business') || {}).value || '',
          department: (document.getElementById('project-department') || {}).value || '',
          institution: (document.getElementById('project-institution') || {}).value || '',
          manager: (manager || {}).value.trim(),
          isRd: (document.getElementById('project-isRd') || {}).checked || false,
          division1: div1 ? div1.value : '',
          division2: div2 ? div2.value : '',
          status: (status && status.value) ? status.value : '',
          startDate: startDate,
          endDate: endDate,
          supportTotal: supportTotal,
          supportYear: supportYear,
          budget: supportTotal,
          yearBudgets: years
        };
          if (idx >= 0) items[idx] = item;
          else items.push(item);
        } else {
          var nextNo = items.length + 1;
          item = {
            id: 'proj-' + Date.now(),
            no: String(nextNo),
            keywords: (keywords || {}).value.trim(),
            projectName: (projectName || {}).value.trim(),
            business: (document.getElementById('project-business') || {}).value || '',
            department: (document.getElementById('project-department') || {}).value || '',
            institution: (document.getElementById('project-institution') || {}).value || '',
            manager: (manager || {}).value.trim(),
            isRd: (document.getElementById('project-isRd') || {}).checked || false,
            division1: div1 ? div1.value : '',
            division2: div2 ? div2.value : '',
            status: (status && status.value) ? status.value : '',
            startDate: startDate,
            endDate: endDate,
            supportTotal: supportTotal,
            supportYear: supportYear,
            budget: supportTotal,
            yearBudgets: years
          };
          items.push(item);
        }

        if (svc && typeof svc.saveProjects === 'function') {
          svc.saveProjects(items);
        }
        closeModal();
      });
    }
    if (typeof onReady === 'function') onReady(openEditModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

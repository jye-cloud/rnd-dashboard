/**
 * 과제 상세 (등록/수정) 페이지
 * - URL: project-detail.html (등록) / project-detail.html?id=XXX (수정)
 * - 기존 firestore-service 의 subscribeProjects / saveProjects / getProjectsData 사용
 */
(function () {
  'use strict';

  var STAT_YEAR = 2026;

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

  function parseNum(val) {
    var n = Number(String(val == null ? '' : val).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function setFormValue(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val != null ? String(val) : '';
  }

  function setRadio(name, val) {
    if (!val) return;
    var v = String(val);
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
      r.checked = (r.value === v);
    });
  }

  // ===== 페이지 상태 =====

  var editingId = null;   // 수정 모드일 때 편집 대상 id
  var isNewMode = true;
  var loaded = false;     // 첫 데이터 도착 여부 (이중 로드 방지)
  var unsubscribe = null; // Firestore 구독 해제 함수
  var tbodyEl, totalEl;

  function readURL() {
    var params = new URLSearchParams(location.search);
    var id = params.get('id');
    if (id) {
      editingId = id;
      isNewMode = false;
    }
  }

  function setHeaderTexts() {
    var titleEl = document.getElementById('detail-title');
    var subtitleEl = document.getElementById('detail-subtitle');
    if (isNewMode) {
      if (titleEl) titleEl.textContent = '[R&DM] 과제 등록';
      if (subtitleEl) subtitleEl.textContent = '새 R&D 과제 정보를 입력합니다.';
      document.title = '[R&DM] 과제 등록';
    } else {
      if (titleEl) titleEl.textContent = '[R&DM] 과제 수정';
      if (subtitleEl) subtitleEl.textContent = '과제 정보를 수정합니다.';
      document.title = '[R&DM] 과제 수정';
    }
  }

  // ===== 연차별 예산 행 로직 =====

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
    try { inp.setSelectionRange(formatted.length, formatted.length); } catch (err) {}
  }

  function onAmountInput(e) {
    var inp = e.target;
    var raw = String(inp.value || '').replace(/\D/g, '');
    var formatted = raw === '' ? '' : formatNum(parseInt(raw, 10) || 0);
    inp.value = formatted;
    try { inp.setSelectionRange(formatted.length, formatted.length); } catch (err) {}
    var row = inp.closest('tr');
    if (row) updateRowSubtotal(row);
  }

  function updateRowSubtotal(row) {
    var support = parseNum((row.querySelector('.yb-support') || {}).value);
    var cash    = parseNum((row.querySelector('.yb-cash')    || {}).value);
    var inKind  = parseNum((row.querySelector('.yb-inkind')  || {}).value);
    var sub = support + cash + inKind;
    var subEl = row.querySelector('.yb-subtotal');
    if (subEl) subEl.textContent = formatNum(sub);
    updateTotalDisplay();
  }

  function updateTotalDisplay() {
    if (!totalEl || !tbodyEl) return;
    var rows = tbodyEl.querySelectorAll('tr');
    var total = 0;
    rows.forEach(function (r) {
      var subEl = r.querySelector('.yb-subtotal');
      if (subEl) total += parseNum(subEl.textContent);
    });
    totalEl.textContent = '총 사업비: ' + formatNum(total) + '원';
  }

  function renumberRows() {
    if (!tbodyEl) return;
    tbodyEl.querySelectorAll('tr').forEach(function (r, i) {
      var numEl = r.querySelector('.yb-num');
      if (numEl) numEl.textContent = i + 1;
    });
  }

  function addYearRow(values) {
    if (!tbodyEl) return null;
    var cnt = tbodyEl.querySelectorAll('tr').length + 1;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="yb-num">' + cnt + '</td>' +
      '<td><input type="text" class="yb-start yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
      '<td><input type="text" class="yb-end yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
      '<td class="yb-amount"><input type="text" class="yb-support" placeholder="0" inputmode="numeric"></td>' +
      '<td class="yb-amount"><input type="text" class="yb-cash" placeholder="0" inputmode="numeric"></td>' +
      '<td class="yb-amount"><input type="text" class="yb-inkind" placeholder="0" inputmode="numeric"></td>' +
      '<td class="yb-subtotal">0</td>' +
      '<td class="yb-del-cell"><button type="button" class="yb-del" aria-label="연차 삭제">×</button></td>';

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

    tbodyEl.appendChild(tr);

    // 초기값 채우기
    if (values) {
      var s = (values.start || values.startDate || '').toString().slice(0, 10);
      var e = (values.end || values.endDate || '').toString().slice(0, 10);
      var sup  = values.support != null ? values.support : 0;
      var cash = values.cash != null ? values.cash : 0;
      var ink  = values.inKind != null ? values.inKind : 0;
      var inpStart = tr.querySelector('.yb-start');
      var inpEnd   = tr.querySelector('.yb-end');
      var inpSup   = tr.querySelector('.yb-support');
      var inpCash  = tr.querySelector('.yb-cash');
      var inpInk   = tr.querySelector('.yb-inkind');
      if (inpStart) inpStart.value = s;
      if (inpEnd)   inpEnd.value   = e;
      if (inpSup)   inpSup.value   = sup  ? formatNum(sup)  : '';
      if (inpCash)  inpCash.value  = cash ? formatNum(cash) : '';
      if (inpInk)   inpInk.value   = ink  ? formatNum(ink)  : '';
    }

    updateRowSubtotal(tr);
    return tr;
  }

  // ===== 데이터 로드 =====

  function fillFormWithItem(item) {
    setFormValue('project-keywords',   item.keywords || item.keyword || item['키워드']);
    setFormValue('project-name',       item.projectName || item['과제명']);
    setFormValue('project-business',   item.business || item['사업명']);
    setFormValue('project-department', item.department || item['부처']);
    setFormValue('project-institution',item.institution || item['기관명']);
    setFormValue('project-manager',    item.manager || item['책임자']);
    setFormValue('project-status',     item.status || item['진행 여부']);

    var isRd = document.getElementById('project-isRd');
    if (isRd) isRd.checked = !!(item.isRd || item.rd || item['R&D 여부']);

    setRadio('project-division1', item.division1 || item['구분1']);
    setRadio('project-division2', item.division2 || item['구분2']);

    // year budgets
    if (tbodyEl) tbodyEl.innerHTML = '';
    var years = item.yearBudgets || item.annualData || [];
    if (!Array.isArray(years)) years = [];
    if (years.length === 0) {
      addYearRow();
    } else {
      years.forEach(function (y) { addYearRow(y); });
    }
  }

  function loadProject(items) {
    if (loaded) return;
    loaded = true;

    if (isNewMode) {
      // 빈 폼: 첫 연차 1개 미리 추가
      addYearRow();
      return;
    }

    items = Array.isArray(items) ? items : [];
    var item = items.find(function (x) { return (x.id || x.docId) === editingId; });
    if (!item) {
      alert('해당 과제를 찾을 수 없습니다. 새 등록으로 진행합니다.');
      isNewMode = true;
      editingId = null;
      setHeaderTexts();
      addYearRow();
      return;
    }

    fillFormWithItem(item);
  }

  // ===== 저장 =====

  function collectYears() {
    var years = [];
    var startDate = '';
    var endDate = '';
    var supportTotal = 0;
    if (!tbodyEl) return { years: years, startDate: startDate, endDate: endDate, supportTotal: supportTotal };

    tbodyEl.querySelectorAll('tr').forEach(function (row) {
      var s   = (row.querySelector('.yb-start')   || {}).value || '';
      var e   = (row.querySelector('.yb-end')     || {}).value || '';
      var sup = parseNum((row.querySelector('.yb-support') || {}).value);
      var cash = parseNum((row.querySelector('.yb-cash')   || {}).value);
      var ink  = parseNum((row.querySelector('.yb-inkind') || {}).value);
      var sub = sup + cash + ink;
      // 완전히 빈 행은 건너뜀
      if (!s && !e && sup === 0 && cash === 0 && ink === 0) return;
      years.push({ startDate: s, endDate: e, support: sup, cash: cash, inKind: ink, subtotal: sub });
      if (s && (!startDate || s < startDate)) startDate = s;
      if (e && (!endDate || e > endDate)) endDate = e;
      supportTotal += sub;
    });

    return { years: years, startDate: startDate, endDate: endDate, supportTotal: supportTotal };
  }

  function buildItem(existingItems) {
    var keywords    = (document.getElementById('project-keywords')    || {}).value || '';
    var projectName = (document.getElementById('project-name')        || {}).value || '';
    var business    = (document.getElementById('project-business')    || {}).value || '';
    var department  = (document.getElementById('project-department')  || {}).value || '';
    var institution = (document.getElementById('project-institution') || {}).value || '';
    var manager     = (document.getElementById('project-manager')     || {}).value || '';
    var status      = (document.getElementById('project-status')      || {}).value || '';
    var isRd        = (document.getElementById('project-isRd')        || {}).checked || false;
    var div1El = document.querySelector('input[name="project-division1"]:checked');
    var div2El = document.querySelector('input[name="project-division2"]:checked');
    var division1 = div1El ? div1El.value : '';
    var division2 = div2El ? div2El.value : '';

    var collected = collectYears();
    var years        = collected.years;
    var startDate    = collected.startDate;
    var endDate      = collected.endDate;
    var supportTotal = collected.supportTotal;

    // 당해 (STAT_YEAR) 지원금 계산
    var supportYear = 0;
    years.forEach(function (y) {
      var s = (y.startDate || '').slice(0, 4);
      var e = (y.endDate || '').slice(0, 4);
      if (s && e && s <= String(STAT_YEAR) && e >= String(STAT_YEAR)) {
        supportYear += (y.support || 0);
      }
    });

    var existingArr = Array.isArray(existingItems) ? existingItems : [];
    var idx = -1;
    var existing = null;
    if (editingId) {
      idx = existingArr.findIndex(function (x) { return (x.id || x.docId) === editingId; });
      existing = idx >= 0 ? existingArr[idx] : null;
    }

    var no;
    if (existing && existing.no != null && existing.no !== '') {
      no = String(existing.no);
    } else {
      no = String(existingArr.length + (idx >= 0 ? 0 : 1));
    }

    return {
      id: editingId || ('proj-' + Date.now()),
      no: no,
      keywords: keywords.trim(),
      projectName: projectName.trim(),
      business: business,
      department: department,
      institution: institution,
      manager: manager.trim(),
      isRd: isRd,
      division1: division1,
      division2: division2,
      status: status,
      startDate: startDate,
      endDate: endDate,
      supportTotal: supportTotal,
      supportYear: supportYear,
      budget: supportTotal,
      yearBudgets: years
    };
  }

  function validateForm() {
    var keywords    = (document.getElementById('project-keywords')    || {}).value || '';
    var projectName = (document.getElementById('project-name')        || {}).value || '';
    var manager     = (document.getElementById('project-manager')     || {}).value || '';

    if (!keywords.trim())    { alert('별칭(키워드)을 입력해 주세요.'); var el1 = document.getElementById('project-keywords'); if (el1) el1.focus(); return false; }
    if (!projectName.trim()) { alert('과제명을 입력해 주세요.');       var el2 = document.getElementById('project-name');     if (el2) el2.focus(); return false; }
    if (!manager.trim())     { alert('책임자를 입력해 주세요.');       var el3 = document.getElementById('project-manager');  if (el3) el3.focus(); return false; }
    return true;
  }

  function saveProject() {
    if (!validateForm()) return;

    var svc = window.firestoreService;
    if (!svc || typeof svc.saveProjects !== 'function') {
      alert('데이터 저장 서비스에 연결할 수 없습니다.');
      return;
    }

    var items = (svc.getProjectsData ? svc.getProjectsData() : []) || [];
    items = Array.isArray(items) ? items.slice() : [];

    var item = buildItem(items);

    if (editingId) {
      var idx = items.findIndex(function (x) { return (x.id || x.docId) === editingId; });
      if (idx >= 0) items[idx] = item;
      else items.push(item);
    } else {
      items.push(item);
    }

    try {
      svc.saveProjects(items);
    } catch (err) {
      console.error('저장 실패:', err);
      alert('저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
      return;
    }

    // 저장 후 목록 페이지로 복귀
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
    window.location.href = 'projects.html';
  }

  function cancelAndGoBack() {
    // 사용자가 폼에 입력한 내용이 있을 때 confirm — 간단히 생략 (필요 시 추가)
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
    window.location.href = 'projects.html';
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

    // DOM refs
    tbodyEl = document.getElementById('year-budget-tbody');
    totalEl = document.getElementById('year-budget-total');

    // URL 파싱
    readURL();
    setHeaderTexts();

    // 버튼 이벤트
    var addYearBtn      = document.getElementById('add-year-btn');
    var saveTopBtn      = document.getElementById('detail-save-top');
    var saveBottomBtn   = document.getElementById('detail-save-bottom');
    var cancelTopBtn    = document.getElementById('detail-cancel-top');
    var cancelBottomBtn = document.getElementById('detail-cancel-bottom');
    var formEl          = document.getElementById('project-detail-form');
    var backLink        = document.getElementById('detail-back-link');

    if (addYearBtn) addYearBtn.addEventListener('click', function () { addYearRow(); });
    if (saveTopBtn) saveTopBtn.addEventListener('click', saveProject);
    if (saveBottomBtn) saveBottomBtn.addEventListener('click', function (e) { e.preventDefault(); saveProject(); });
    if (cancelTopBtn) cancelTopBtn.addEventListener('click', cancelAndGoBack);
    if (cancelBottomBtn) cancelBottomBtn.addEventListener('click', cancelAndGoBack);
    if (backLink) {
      backLink.addEventListener('click', function (e) {
        e.preventDefault();
        cancelAndGoBack();
      });
    }
    if (formEl) {
      formEl.addEventListener('submit', function (e) {
        e.preventDefault();
        saveProject();
      });
    }

    // Firestore에서 데이터 로드
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      var loadingEl = document.getElementById('detail-loading');
      if (!isNewMode && loadingEl) loadingEl.style.display = 'block';

      unsubscribe = svc.subscribeProjects(function (items) {
        if (loadingEl) loadingEl.style.display = 'none';
        loadProject(items);
      });
    } else {
      // Firestore 미연결 — 빈 폼
      loadProject([]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

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

  // status 값에 따라 제출일 / 미제출 사유 입력란 표시/숨김
  function updateStatusConditionalInputs() {
    var statusEl = document.getElementById('project-status');
    var submitWrap = document.getElementById('project-submit-date-wrap');
    var unsubWrap  = document.getElementById('project-unsubmitted-wrap');
    if (!statusEl) return;
    var v = statusEl.value;
    if (submitWrap) submitWrap.style.display = (v === '예정') ? '' : 'none';
    if (unsubWrap)  unsubWrap.style.display  = (v === '미제출') ? '' : 'none';
  }

  function fillFormWithItem(item) {
    setFormValue('project-keywords',   item.keywords || item.keyword || item['키워드']);
    setFormValue('project-name',       item.projectName || item['과제명']);
    setFormValue('project-business',   item.business || item['사업명']);
    // 정부부처 → 전문기관 순서로 (전문기관은 부처에 따라 옵션이 결정됨)
    setDeptValue(item.department || item['부처'] || '');
    setInstitutionValue(item.institution || item['기관명'] || '');
    setFormValue('project-manager',    item.manager || item['책임자']);

    // 진행 여부 — 저장된 값이 "수행 중" 이면 "수행" 옵션이 매칭됨 (정규화)
    var savedStatus = item.status || item['진행 여부'] || '';
    var statusNorm = String(savedStatus).replace(/\s/g, '');
    if (statusNorm === '수행중' || statusNorm === '수행') savedStatus = '수행';
    if (statusNorm === '대기') savedStatus = '예정';  // 자동 전환된 값이 저장되어 있을 경우 대비
    setFormValue('project-status', savedStatus);

    // 제출일 / 미제출 사유 로드
    setFormValue('project-submit-date', item.submitDate || item['제출일'] || '');
    setFormValue('project-unsubmitted-reason', item.unsubmittedReason || item['미제출 사유'] || '');

    // 입력란 가시성 갱신
    updateStatusConditionalInputs();

    var isRd = document.getElementById('project-isRd');
    if (isRd) isRd.checked = !!(item.isRd || item.rd || item['R&D 여부']);

    setRadio('project-division1', item.division1 || item['구분1']);
    // division2(계속/신규)는 자동 계산이므로 입력 필드 없음 — 무시

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
    var submitDate  = (document.getElementById('project-submit-date') || {}).value || '';
    var unsubReason = (document.getElementById('project-unsubmitted-reason') || {}).value || '';
    var div1El = document.querySelector('input[name="project-division1"]:checked');
    var division1 = div1El ? div1El.value : '';
    // division2(계속/신규)는 startDate 기준으로 자동 계산되므로 저장하지 않음

    // status가 "예정" 아닐 때는 submitDate 저장 안 함 (불필요한 데이터 방지)
    if (status !== '예정') submitDate = '';
    // status가 "미제출" 아닐 때는 사유 저장 안 함
    if (status !== '미제출') unsubReason = '';

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
      // division2 (계속/신규) 는 startDate 기준 자동 판정 — 저장 안 함
      status: status,
      submitDate: submitDate,            // 예정일 때만 값 있음
      unsubmittedReason: unsubReason,    // 미제출일 때만 값 있음
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
    var status      = (document.getElementById('project-status')      || {}).value || '';
    var submitDate  = (document.getElementById('project-submit-date') || {}).value || '';

    if (!keywords.trim())    { alert('별칭(키워드)을 입력해 주세요.'); var el1 = document.getElementById('project-keywords'); if (el1) el1.focus(); return false; }
    if (!projectName.trim()) { alert('과제명을 입력해 주세요.');       var el2 = document.getElementById('project-name');     if (el2) el2.focus(); return false; }
    if (!manager.trim())     { alert('책임자를 입력해 주세요.');       var el3 = document.getElementById('project-manager');  if (el3) el3.focus(); return false; }
    // 진행 여부가 "예정"이면 제출일 필수
    if (status === '예정' && !submitDate) {
      alert('진행 여부가 "예정"인 경우 제출일을 입력해 주세요.');
      var el4 = document.getElementById('project-submit-date');
      if (el4) el4.focus();
      return false;
    }
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

  function deleteProject() {
    // 신규 모드에서는 호출되지 않아야 함 (버튼이 hidden 처리됨)
    if (isNewMode || !editingId) {
      alert('삭제할 과제를 찾을 수 없습니다.');
      return;
    }

    var svc = window.firestoreService;
    if (!svc || typeof svc.saveProjects !== 'function') {
      alert('데이터 저장 서비스에 연결할 수 없습니다.');
      return;
    }

    var items = (svc.getProjectsData ? svc.getProjectsData() : []) || [];
    items = Array.isArray(items) ? items.slice() : [];

    var idx = items.findIndex(function (x) { return (x.id || x.docId) === editingId; });
    if (idx < 0) {
      alert('삭제할 과제를 찾을 수 없습니다. (이미 삭제되었을 수 있습니다)');
      return;
    }

    var target = items[idx];
    var label = target.projectName || target['과제명'] || target.keywords || '(이름 없음)';
    var confirmMsg = '"' + label + '" 과제를 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 모든 사용자에게 즉시 반영됩니다.';
    if (!window.confirm(confirmMsg)) return;

    items.splice(idx, 1);

    try {
      svc.saveProjects(items);
    } catch (err) {
      console.error('삭제 실패:', err);
      alert('삭제 중 오류가 발생했습니다. 다시 시도해 주세요.');
      return;
    }

    // 삭제 후 목록 페이지로 복귀
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
    window.location.href = 'projects.html';
  }

  function cancelAndGoBack() {
    // 사용자가 폼에 입력한 내용이 있을 때 confirm — 간단히 생략 (필요 시 추가)
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
    window.location.href = 'projects.html';
  }

  // ===== Init =====

  // ===== 정부부처 / 전문기관 드롭다운 =====

  var DEFAULT_AGENCIES = Object.freeze({
    '과학기술정보통신부': ['정보통신기획평가원', '정보통신산업진흥원'],
    '중소벤처기업부':     ['중소기업기술정보진흥원'],
    '기상청':             ['한국기상산업기술원'],
    '기후에너지환경부':   ['한국에너지공단', '한국에너지기술평가원', '한국환경산업기술원'],
    '산업통상부':         []
  });

  var agencyMap = {}; // 작업용 (기본 + custom 합본)

  function cloneDefaultAgencies() {
    var out = {};
    Object.keys(DEFAULT_AGENCIES).forEach(function (k) {
      out[k] = DEFAULT_AGENCIES[k].slice();
    });
    return out;
  }

  function rebuildDeptSelect() {
    var sel = document.getElementById('project-department');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">선택하세요</option>';
    Object.keys(agencyMap).forEach(function (dept) {
      var opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      sel.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add__';
    addOpt.textContent = '+ 직접 입력';
    sel.appendChild(addOpt);
    // 이전 값 복원 (옵션이 사라졌으면 빈 값)
    if (prev && prev !== '__add__' && agencyMap.hasOwnProperty(prev)) {
      sel.value = prev;
    } else if (prev !== '__add__') {
      sel.value = prev || '';
    }
  }

  function rebuildInstSelect(dept) {
    var sel = document.getElementById('project-institution');
    if (!sel) return;
    var prev = sel.value;
    if (!dept) {
      sel.innerHTML = '<option value="">먼저 정부부처를 선택하세요</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">선택하세요</option>';
    var list = (agencyMap[dept] || []);
    list.forEach(function (inst) {
      var opt = document.createElement('option');
      opt.value = inst;
      opt.textContent = inst;
      sel.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add__';
    addOpt.textContent = '+ 직접 입력';
    sel.appendChild(addOpt);
    if (prev && prev !== '__add__' && list.indexOf(prev) >= 0) {
      sel.value = prev;
    }
  }

  // 데이터 로드 시 호출 — 기존에 저장된 부처/기관이 옵션에 없으면 자동 추가
  function setDeptValue(value) {
    var deptSel = document.getElementById('project-department');
    if (!deptSel) return;
    if (value && !agencyMap.hasOwnProperty(value)) {
      agencyMap[value] = [];
    }
    rebuildDeptSelect();
    deptSel.value = value || '';
    rebuildInstSelect(value);
  }

  function setInstitutionValue(value) {
    var instSel = document.getElementById('project-institution');
    if (!instSel) return;
    var dept = (document.getElementById('project-department') || {}).value || '';
    if (value && dept) {
      if (!agencyMap[dept]) agencyMap[dept] = [];
      if (agencyMap[dept].indexOf(value) < 0) {
        agencyMap[dept].push(value);
        rebuildInstSelect(dept);
      }
    }
    instSel.value = value || '';
  }

  function setupDeptInstitutionDropdowns() {
    agencyMap = cloneDefaultAgencies();
    rebuildDeptSelect();
    rebuildInstSelect(null);

    var deptSel    = document.getElementById('project-department');
    var instSel    = document.getElementById('project-institution');
    var deptCustom = document.getElementById('project-department-custom');
    var instCustom = document.getElementById('project-institution-custom');

    // 부처 select 변경
    if (deptSel) {
      deptSel.addEventListener('change', function () {
        var v = deptSel.value;
        if (v === '__add__') {
          if (deptCustom) {
            deptCustom.style.display = '';
            deptCustom.value = '';
            deptCustom.focus();
          }
          deptSel.value = '';
          rebuildInstSelect(null);
        } else {
          if (deptCustom) deptCustom.style.display = 'none';
          rebuildInstSelect(v);
        }
      });
    }

    // 부처 직접 입력 — Enter 키
    if (deptCustom) {
      deptCustom.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var newDept = deptCustom.value.trim();
          if (newDept) {
            if (!agencyMap[newDept]) agencyMap[newDept] = [];
            rebuildDeptSelect();
            if (deptSel) deptSel.value = newDept;
            deptCustom.style.display = 'none';
            rebuildInstSelect(newDept);
            saveCustomAgency(newDept);
          }
        } else if (e.key === 'Escape') {
          deptCustom.style.display = 'none';
        }
      });
    }

    // 전문기관 select 변경
    if (instSel) {
      instSel.addEventListener('change', function () {
        var v = instSel.value;
        if (v === '__add__') {
          if (instCustom) {
            instCustom.style.display = '';
            instCustom.value = '';
            instCustom.focus();
          }
          instSel.value = '';
        } else {
          if (instCustom) instCustom.style.display = 'none';
        }
      });
    }

    // 전문기관 직접 입력 — Enter 키
    if (instCustom) {
      instCustom.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var newInst = instCustom.value.trim();
          var dept = deptSel ? deptSel.value : '';
          if (newInst && dept) {
            if (!agencyMap[dept]) agencyMap[dept] = [];
            if (agencyMap[dept].indexOf(newInst) < 0) {
              agencyMap[dept].push(newInst);
            }
            rebuildInstSelect(dept);
            if (instSel) instSel.value = newInst;
            instCustom.style.display = 'none';
            saveCustomAgency(dept);
          } else if (!dept) {
            alert('정부부처를 먼저 선택해 주세요.');
          }
        } else if (e.key === 'Escape') {
          instCustom.style.display = 'none';
        }
      });
    }

    // Firestore에서 사용자가 추가한 부처/기관 로드
    loadCustomAgenciesAsync();
  }

  function loadCustomAgenciesAsync() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    try {
      firebase.firestore().collection('config').doc('agencies').get()
        .then(function (doc) {
          if (!doc.exists) return;
          var data = doc.data();
          if (!data || !data.customAgencies) return;
          var custom = data.customAgencies;
          Object.keys(custom).forEach(function (dept) {
            if (!agencyMap[dept]) agencyMap[dept] = [];
            (custom[dept] || []).forEach(function (inst) {
              if (agencyMap[dept].indexOf(inst) < 0) agencyMap[dept].push(inst);
            });
          });
          // 현재 선택값 보존하면서 옵션 갱신
          var deptSel = document.getElementById('project-department');
          var currentDept = deptSel ? deptSel.value : '';
          rebuildDeptSelect();
          if (currentDept) {
            if (deptSel) deptSel.value = currentDept;
            rebuildInstSelect(currentDept);
          }
        })
        .catch(function (e) {
          console.warn('[project-detail] custom agencies 로드 실패:', e);
        });
    } catch (e) {
      console.warn('[project-detail] firestore 호출 실패:', e);
    }
  }

  function saveCustomAgency(dept) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    try {
      // 해당 부처의 전체 기관 목록을 저장 (merge)
      var payload = {};
      payload[dept] = (agencyMap[dept] || []).slice();
      firebase.firestore().collection('config').doc('agencies').set({
        customAgencies: payload
      }, { merge: true }).catch(function (e) {
        console.warn('[project-detail] custom agency 저장 실패:', e);
      });
    } catch (e) {
      console.warn('[project-detail] firestore set 실패:', e);
    }
  }

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

    // 정부부처 / 전문기관 드롭다운 셋업 (Firestore 데이터 로드 전에 옵션 채움)
    setupDeptInstitutionDropdowns();

    // 진행 여부 변경 → 제출일/미제출 사유 입력란 가시성 토글
    var statusSelectEl = document.getElementById('project-status');
    if (statusSelectEl) {
      statusSelectEl.addEventListener('change', updateStatusConditionalInputs);
    }
    // 신규 등록 모드에서도 초기 상태 적용 (초기엔 모두 숨김)
    updateStatusConditionalInputs();

    // URL 파싱
    readURL();
    setHeaderTexts();

    // 버튼 이벤트
    var addYearBtn      = document.getElementById('add-year-btn');
    var saveTopBtn      = document.getElementById('detail-save-top');
    var saveBottomBtn   = document.getElementById('detail-save-bottom');
    var cancelTopBtn    = document.getElementById('detail-cancel-top');
    var cancelBottomBtn = document.getElementById('detail-cancel-bottom');
    var deleteTopBtn    = document.getElementById('detail-delete-top');
    var deleteBottomBtn = document.getElementById('detail-delete-bottom');
    var formEl          = document.getElementById('project-detail-form');
    var backLink        = document.getElementById('detail-back-link');

    if (addYearBtn) addYearBtn.addEventListener('click', function () { addYearRow(); });
    if (saveTopBtn) saveTopBtn.addEventListener('click', saveProject);
    if (saveBottomBtn) saveBottomBtn.addEventListener('click', function (e) { e.preventDefault(); saveProject(); });
    if (cancelTopBtn) cancelTopBtn.addEventListener('click', cancelAndGoBack);
    if (cancelBottomBtn) cancelBottomBtn.addEventListener('click', cancelAndGoBack);
    if (deleteTopBtn) deleteTopBtn.addEventListener('click', deleteProject);
    if (deleteBottomBtn) deleteBottomBtn.addEventListener('click', deleteProject);

    // 편집 모드일 때만 삭제 버튼 표시 (신규 등록 모드에서는 숨김)
    if (!isNewMode) {
      if (deleteTopBtn) deleteTopBtn.style.display = '';
      if (deleteBottomBtn) deleteBottomBtn.style.display = '';
    }
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

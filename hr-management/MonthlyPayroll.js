(function () {
  'use strict';

  // 인력 데이터 키(기존 HR 페이지와 동일) — 연봉은 이 키에 저장하지 않음
  var HR_STORAGE_KEY = 'hr-management-data';
  // 연봉·실제지급액·과제배분은 이 키에만 저장 (인력 정보 페이지에 노출되지 않음)
  var PAYROLL_STORAGE_KEY = 'hr-payroll-data';

  var payrollYear = document.getElementById('payroll-year');
  var payrollMonth = document.getElementById('payroll-month');
  var payrollTbody = document.getElementById('payroll-tbody');
  var payrollSaveMonthBtn = document.getElementById('payroll-save-month-btn');
  var payrollUnlockMonthBtn = document.getElementById('payroll-unlock-month-btn');
  var payrollLoadPrevBtn = document.getElementById('payroll-load-prev-btn');
  var editingSalaryId = null;

  // 상단 요약 카드 필터: null | 'allocation' | 'actual' | 'net' (확장용)
  var activeSummaryFilter = null;

  // 권한: 테스트용 true. 추후 실제 권한 시스템과 연결 시 canFinalizePayroll/canUnfinalizePayroll만 교체
  var isAdmin = true;
  function canFinalizePayroll() {
    return !!isAdmin;
  }
  function canUnfinalizePayroll() {
    return !!isAdmin;
  }

  function getHrData() {
    try {
      var raw = localStorage.getItem(HR_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('인력 데이터 로드 실패:', e);
      return [];
    }
  }

  function getPayrollState() {
    try {
      var raw = localStorage.getItem(PAYROLL_STORAGE_KEY);
      var state = raw ? JSON.parse(raw) : {};
      return normalizePayrollState(state);
    } catch (e) {
      console.error('인건비 데이터 로드 실패:', e);
      return { snapshots: {}, draft: {} };
    }
  }

  // 기존 형식(월 키가 최상위) → snapshots/draft/contractSalaries 형식으로 마이그레이션
  function normalizePayrollState(state) {
    if (!state) state = {};
    var snapshots = state.snapshots || {};
    var draft = state.draft || {};
    var contractSalaries = state.contractSalaries || {};
    if (state.snapshots == null || state.draft == null) {
      Object.keys(state).forEach(function (key) {
        if (key === 'snapshots' || key === 'draft' || key === 'contractSalaries') return;
        if (/^\d{4}-\d{2}$/.test(key) && state[key] && typeof state[key] === 'object') draft[key] = state[key];
      });
    }
    migrateContractSalariesFromSnapshotsAndDraft(state, contractSalaries, snapshots, draft);
    return { snapshots: snapshots, draft: draft, contractSalaries: contractSalaries };
  }

  function migrateContractSalariesFromSnapshotsAndDraft(state, contractSalaries, snapshots, draft) {
    function setIfMissing(id, val) {
      if (id && (val !== '' && val !== null && val !== undefined) && (contractSalaries[id] === undefined || contractSalaries[id] === '')) contractSalaries[id] = val;
    }
    Object.keys(snapshots).forEach(function (ym) {
      var persons = snapshots[ym].persons || {};
      Object.keys(persons).forEach(function (id) {
        if (persons[id].contractSalary != null) setIfMissing(id, persons[id].contractSalary);
      });
    });
    Object.keys(draft).forEach(function (ym) {
      var persons = draft[ym];
      Object.keys(persons).forEach(function (id) {
        if (persons[id].contractSalary != null) setIfMissing(id, persons[id].contractSalary);
      });
    });
  }

  function savePayrollState(state) {
    var normalized = normalizePayrollState(state);
    try {
      localStorage.setItem(PAYROLL_STORAGE_KEY, JSON.stringify(normalized));
    } catch (e) {
      console.error('인건비 데이터 저장 실패:', e);
    }
  }

  function getSnapshot(state, ymKey) {
    return (state.snapshots && state.snapshots[ymKey]) || null;
  }

  function getDraft(state, ymKey) {
    return (state.draft && state.draft[ymKey]) || null;
  }

  // 해당 월 이하(과거) 스냅샷 키 중 가장 최근 키 (예: 2025-08 조회 시 2025-07, 2025-06 중 최대)
  function getLatestSnapshotKeyBefore(state, ymKey) {
    if (!state.snapshots) return null;
    var keys = Object.keys(state.snapshots).filter(function (k) { return k <= ymKey; });
    if (keys.length === 0) return null;
    keys.sort();
    return keys[keys.length - 1];
  }

  // allocations: [{ project_id, project_name, participation_rate, amount }]
  // 나중에 과제비 관리 시트에서 project_id 기반으로 fetch 예정. 수동 입력(isManual: true) / 자동 불러오기(isManual: false) 전환 가능.
  function normalizeAllocationList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (a, idx) {
      var projectId = a.projectId != null ? a.projectId : (a.project_id != null ? a.project_id : 'p-' + idx + '-' + Date.now());
      var projectName = a.projectName != null ? a.projectName : (a.project_name != null ? a.project_name : '');
      var participationRate = a.participationRate != null ? a.participationRate : (a.participation_rate != null ? a.participation_rate : '');
      var amount = a.amount != null ? a.amount : '';
      var isManual = typeof a.isManual === 'boolean' ? a.isManual : true;
      return { projectId: projectId, projectName: projectName, participationRate: participationRate, amount: amount, isManual: isManual };
    });
  }

  // 계약 연봉은 인물별 마스터(contractSalaries)에서만 사용. 월별 데이터는 actualPay/remark/allocationList만.
  function getMasterSalary(state, personId) {
    return (state.contractSalaries && state.contractSalaries[personId]) != null ? state.contractSalaries[personId] : '';
  }

  // 해당 월 표시용 행 데이터: 계약 연봉·월 기준급은 마스터/계산, actualPay/remark/allocationList는 스냅샷·드래프트·기본값
  function getRowStateForMonth(state, ymKey, personId) {
    var masterSalary = getMasterSalary(state, personId);
    var base = monthlyBase(masterSalary);
    var actualPay = '';
    var remark = '';
    var rawList = [];
    var fromSnapshot = false;
    var snap = getSnapshot(state, ymKey);
    if (snap && snap.persons && snap.persons[personId]) {
      var row = snap.persons[personId];
      actualPay = row.actualPay != null ? row.actualPay : '';
      remark = row.remark || '';
      rawList = row.allocationList || row.allocationData || [];
      fromSnapshot = true;
    } else {
      var dr = getDraft(state, ymKey);
      if (dr && dr[personId]) {
        actualPay = dr[personId].actualPay != null ? dr[personId].actualPay : '';
        remark = dr[personId].remark || '';
        rawList = dr[personId].allocationList || dr[personId].allocationData || [];
      } else {
        var latestKey = getLatestSnapshotKeyBefore(state, ymKey);
        if (latestKey && state.snapshots[latestKey].persons[personId]) {
          var prev = state.snapshots[latestKey].persons[personId];
          actualPay = prev.actualPay != null ? prev.actualPay : '';
          remark = prev.remark || '';
          rawList = prev.allocationList || prev.allocationData || [];
        }
      }
    }
    var allocationList = normalizeAllocationList(rawList);
    return {
      contractSalary: masterSalary,
      monthlyBase: base,
      actualPay: actualPay,
      remark: remark,
      allocationList: allocationList,
      fromSnapshot: fromSnapshot
    };
  }

  function sumAllocationAmount(list) {
    if (!Array.isArray(list)) return 0;
    return list.reduce(function (sum, a) {
      var n = parseAmount(a.amount);
      return sum + (n === '' ? 0 : n);
    }, 0);
  }

  /**
   * [Stub] 나중에 이 함수를 통해 과제 관리 페이지의 데이터를 가져올 예정.
   * 외부 연동 시 allocationList를 반환하고 isManual: false로 구분하며,
   * UI의 '덮어쓰기'/'새로고침' 버튼으로 불러온 데이터를 반영할 수 있도록 확장 예정.
   * @param {string} userId - 인력 ID (person id)
   * @param {string} month - yyyy-mm
   * @returns {Promise<Array<{projectId, projectName, amount, isManual}>>} allocationList (isManual: false)
   */
  function fetchProjectAllocation(userId, month) {
    return Promise.resolve([]);
  }

  // 해당 월 1일 / 말일 문자열 (YYYY-MM-DD)
  function monthFirstDay(year, month) {
    return year + '-' + String(month).padStart(2, '0') + '-01';
  }
  function monthLastDay(year, month) {
    var d = new Date(year, month, 0);
    return year + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 해당 월에 하루라도 재직했던 인원 (중도 퇴사자 포함)
  // 취득일 <= 해당월말 && (상실일 없음 || 상실일 >= 해당월초)
  /**
   * 상단 요약 카드 필터 조건 함수 (확장용)
   * @param {string} filterType - 'allocation' | 'actual' | 'net'
   * @param {object} state - getPayrollState()
   * @param {string} ymKey - 'YYYY-MM'
   * @returns {function(item): boolean} 해당 행을 표시할지 여부
   */
  function getFilterPredicate(filterType, state, ymKey) {
    if (!filterType || !state || !ymKey) return null;
    switch (filterType) {
      case 'allocation':
        return function (item) {
          var rowState = getRowStateForMonth(state, ymKey, item.id);
          return sumAllocationAmount(rowState.allocationList || []) > 0;
        };
      case 'actual':
        return function (item) {
          var rowState = getRowStateForMonth(state, ymKey, item.id);
          var v = parseAmount(rowState.actualPay);
          return v !== '' && v > 0;
        };
      case 'net':
        return function (item) {
          var rowState = getRowStateForMonth(state, ymKey, item.id);
          var alloc = sumAllocationAmount(rowState.allocationList || []);
          return alloc === 0;
        };
      default:
        return null;
    }
  }

  function getEmployedInMonth(hrData, year, month) {
    var first = monthFirstDay(year, month);
    var last = monthLastDay(year, month);
    return hrData.filter(function (item) {
      var acq = (item.acquisitionDate || '').trim();
      var loss = (item.lossDate || '').trim();
      if (!acq) return false;
      if (acq > last) return false;
      if (loss === '' || loss === null) return true;
      return loss >= first;
    });
  }

  function getCurrentYearMonth() {
    var y = payrollYear && payrollYear.value ? parseInt(payrollYear.value, 10) : new Date().getFullYear();
    var m = payrollMonth && payrollMonth.value ? payrollMonth.value : String(new Date().getMonth() + 1).padStart(2, '0');
    return { year: y, month: m };
  }

  function getYmKey(year, month) {
    return year + '-' + String(month).padStart(2, '0');
  }

  function getPrevYmKey(year, month) {
    var m = parseInt(month, 10);
    var y = parseInt(year, 10);
    if (m <= 1) return (y - 1) + '-12';
    return y + '-' + String(m - 1).padStart(2, '0');
  }

  // 월 기준급 = 연봉/12 소수점 절삭
  function monthlyBase(salary) {
    if (salary === '' || salary === null || isNaN(Number(salary))) return 0;
    return Math.floor(Number(salary) / 12);
  }

  function formatAmount(v) {
    if (v === '' || v === null || v === undefined) return '';
    var n = parseInt(String(v).replace(/\D/g, ''), 10);
    if (isNaN(n)) return '';
    return n.toLocaleString();
  }

  function parseAmount(s) {
    if (s === '' || s === null || s === undefined) return '';
    var n = parseInt(String(s).replace(/\D/g, ''), 10);
    return isNaN(n) ? '' : n;
  }

  // 자격 취득일 → YYYY-MM-DD 형식 (입사일 표시용)
  function formatDateYYYYMMDD(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '-';
    var s = dateStr.trim().replace(/\./g, '-');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s || '-';
  }

  function initYearMonthSelects() {
    var startYear = 2020;
    var endYear = new Date().getFullYear();
    var current = new Date();
    var i;
    if (payrollYear && payrollYear.options.length === 0) {
      for (i = endYear; i >= startYear; i--) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i + '년';
        payrollYear.appendChild(opt);
      }
      payrollYear.value = current.getFullYear();
    }
    if (payrollMonth && payrollMonth.options.length === 0) {
      for (i = 1; i <= 12; i++) {
        var mOpt = document.createElement('option');
        mOpt.value = String(i).padStart(2, '0');
        mOpt.textContent = i + '월';
        payrollMonth.appendChild(mOpt);
      }
      payrollMonth.value = String(current.getMonth() + 1).padStart(2, '0');
    }
  }

  function renderPayrollTable() {
    if (!payrollTbody) return;
    var hrData = getHrData();
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var year = _ym.year;
    var month = _ym.month;
    var ymKey = getYmKey(year, month);
    var list = getEmployedInMonth(hrData, year, month);
    var predicate = getFilterPredicate(activeSummaryFilter, state, ymKey);
    if (predicate) list = list.filter(predicate);
    var snapshot = getSnapshot(state, ymKey);
    var isLocked = !!snapshot;

    updatePayrollBadgeAndButton(ymKey, isLocked);

    var payrollTable = document.getElementById('payroll-table');
    if (payrollTable) payrollTable.classList.toggle('payroll-table--locked', isLocked);

    var isJanuaryEditMode = (month === 1 || month === '01');
    if (payrollTable) payrollTable.classList.toggle('payroll-table--january-edit', isJanuaryEditMode);

    payrollTbody.innerHTML = '';
    var totalActual = 0;

    list.forEach(function (item) {
      var rowState = getRowStateForMonth(state, ymKey, item.id);
      var base = rowState.monthlyBase != null ? rowState.monthlyBase : monthlyBase(rowState.contractSalary);
      var actual = parseInt(rowState.actualPay, 10) || 0;
      totalActual += actual;

      var tr = document.createElement('tr');
      tr.className = 'payroll-row' + (isLocked ? ' payroll-row--locked' : '');
      tr.setAttribute('data-id', item.id);

      // 성명(소속) — 읽기 전용
      var nameCell = document.createElement('td');
      var dept = (item.department || '').trim() || '-';
      nameCell.textContent = (item.name || '-') + '(' + dept + ')';
      nameCell.className = 'payroll-name';
      tr.appendChild(nameCell);

      // 입사일 — hrData 자격 취득일(acquisitionDate) 표시, YYYY-MM-DD
      var joinDateCell = document.createElement('td');
      joinDateCell.className = 'payroll-join-date';
      joinDateCell.textContent = formatDateYYYYMMDD(item.acquisitionDate);
      tr.appendChild(joinDateCell);

      // 계약 연봉 — 1월은 자동 수정 모드, 2~12월은 수정 아이콘 클릭 시에만 입력창
      var salaryCell = document.createElement('td');
      salaryCell.className = 'payroll-salary-cell';
      salaryCell.setAttribute('data-id', item.id);
      var isEditingSalary = editingSalaryId === item.id || (isJanuaryEditMode && !isLocked);
      var salaryVal = rowState.contractSalary === '' || rowState.contractSalary === null ? '' : rowState.contractSalary;
      if (isEditingSalary && !isLocked) {
        var salaryInput = document.createElement('input');
        salaryInput.type = 'text';
        salaryInput.inputMode = 'numeric';
        salaryInput.className = 'payroll-input payroll-salary' + (isJanuaryEditMode ? ' payroll-salary--january' : '');
        salaryInput.placeholder = '0';
        salaryInput.value = formatAmount(salaryVal);
        salaryInput.setAttribute('data-id', item.id);
        salaryCell.appendChild(salaryInput);
      } else {
        var salaryText = document.createElement('span');
        salaryText.className = 'payroll-salary-readonly';
        salaryText.textContent = salaryVal ? formatAmount(salaryVal) : '-';
        salaryCell.appendChild(salaryText);
      }
      tr.appendChild(salaryCell);

      // 수정 — 계약 연봉 옆, 아이콘만 (인력 관리 페이지와 동일 연필 아이콘)
      var editCell = document.createElement('td');
      editCell.className = 'payroll-edit-salary-cell';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ui-btn payroll-edit-salary-btn';
      editBtn.setAttribute('data-id', item.id);
      editBtn.setAttribute('title', '연봉 수정');
      if (isLocked) {
        editBtn.disabled = true;
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      } else if (isEditingSalary) {
        editBtn.textContent = '저장';
        editBtn.classList.add('payroll-save-salary-btn');
      } else {
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      }
      editCell.appendChild(editBtn);
      tr.appendChild(editCell);

      // 월 기준급 (자동)
      var baseCell = document.createElement('td');
      baseCell.className = 'payroll-base payroll-base-cell';
      baseCell.textContent = base > 0 ? base.toLocaleString() : '-';
      baseCell.setAttribute('data-id', item.id);
      tr.appendChild(baseCell);

      // 실제 지급액
      var actualCell = document.createElement('td');
      actualCell.className = 'payroll-actual-cell';
      var actualInput = document.createElement('input');
      actualInput.type = 'text';
      actualInput.inputMode = 'numeric';
      actualInput.className = 'payroll-input payroll-actual';
      actualInput.placeholder = '0';
      actualInput.value = rowState.actualPay === '' || rowState.actualPay === null ? '' : formatAmount(rowState.actualPay);
      actualInput.setAttribute('data-id', item.id);
      if (isLocked) actualInput.disabled = true;
      actualCell.appendChild(actualInput);
      tr.appendChild(actualCell);

      // 과제 배분액 (자동 합산) — allocationList의 amount 합계
      var allocSum = sumAllocationAmount(rowState.allocationList);
      var allocSumCell = document.createElement('td');
      allocSumCell.className = 'payroll-allocation-sum';
      allocSumCell.setAttribute('data-id', item.id);
      allocSumCell.textContent = allocSum > 0 ? allocSum.toLocaleString() : '-';
      tr.appendChild(allocSumCell);

      // 비고
      var remarkCell = document.createElement('td');
      var remarkInput = document.createElement('input');
      remarkInput.type = 'text';
      remarkInput.className = 'payroll-input payroll-remark';
      remarkInput.placeholder = '급여 변동 사유 등';
      remarkInput.value = rowState.remark || '';
      remarkInput.setAttribute('data-id', item.id);
      if (isLocked) remarkInput.disabled = true;
      remarkCell.appendChild(remarkInput);
      tr.appendChild(remarkCell);

      // 과제 배분 (확장) — 확정 시 버튼만 보이되 열어도 읽기 전용
      var allocCell = document.createElement('td');
      allocCell.className = 'th-allocation';
      var allocBtn = document.createElement('button');
      allocBtn.type = 'button';
      allocBtn.className = 'ui-btn ui-btn--ghost payroll-allocation-btn';
      allocBtn.textContent = '환급 상세';
      allocBtn.setAttribute('data-id', item.id);
      if (isLocked) allocBtn.disabled = true;
      allocCell.appendChild(allocBtn);
      tr.appendChild(allocCell);

      payrollTbody.appendChild(tr);

      // 확장 행: 과제 배분 상세 — allocations: [{ project_id, project_name, participation_rate, amount }]
      var expandTr = document.createElement('tr');
      expandTr.className = 'payroll-expand-row';
      expandTr.hidden = true;
      expandTr.setAttribute('data-for-id', item.id);
      var expandTd = document.createElement('td');
      expandTd.colSpan = 9;
      expandTd.className = 'payroll-expand-cell';

      var allocContainer = document.createElement('div');
      allocContainer.className = 'payroll-allocation-list';

      // 외부 연동: 나중에 project_id 기반 fetch 시 수동/자동 전환
      var externalPlaceholder = document.createElement('div');
      externalPlaceholder.className = 'payroll-allocation-external-placeholder';
      externalPlaceholder.innerHTML = '<span class="payroll-allocation-external-hint">외부 연동 시 덮어쓰기/새로고침 버튼 표시</span>';
      var itemsContainer = document.createElement('div');
      itemsContainer.className = 'payroll-allocation-items';

      var headerRow = document.createElement('div');
      headerRow.className = 'payroll-allocation-header';
      headerRow.innerHTML = '<span class="payroll-allocation-header-col allocation-col-name">과제명</span><span class="payroll-allocation-header-col allocation-col-rate">참여율(%)</span><span class="payroll-allocation-header-col allocation-col-amount">환급액</span>';
      allocContainer.appendChild(headerRow);
      allocContainer.appendChild(externalPlaceholder);
      allocContainer.appendChild(itemsContainer);

      function renderAllocationRows() {
        var existingAddBtn = allocContainer.querySelector('.payroll-add-allocation');
        itemsContainer.innerHTML = '';
        (rowState.allocationList || []).forEach(function (a, idx) {
          var row = document.createElement('div');
          row.className = 'payroll-allocation-item';
          var nameIn = document.createElement('input');
          nameIn.type = 'text';
          nameIn.className = 'payroll-input allocation-name';
          nameIn.placeholder = '과제명';
          nameIn.value = (a.projectName != null ? a.projectName : '') || '';
          if (isLocked) nameIn.disabled = true;
          var rateIn = document.createElement('input');
          rateIn.type = 'text';
          rateIn.inputMode = 'decimal';
          rateIn.className = 'payroll-input allocation-rate';
          rateIn.placeholder = '0';
          rateIn.value = (a.participationRate != null ? a.participationRate : '') || '';
          if (isLocked) rateIn.disabled = true;
          var amountIn = document.createElement('input');
          amountIn.type = 'text';
          amountIn.inputMode = 'numeric';
          amountIn.className = 'payroll-input allocation-amount';
          amountIn.placeholder = '0';
          amountIn.value = (a.amount != null && a.amount !== '' ? a.amount : '');
          if (isLocked) amountIn.disabled = true;
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'ui-btn payroll-remove-allocation allocation-del-icon';
          delBtn.setAttribute('data-id', item.id);
          delBtn.setAttribute('data-idx', String(idx));
          delBtn.setAttribute('aria-label', '삭제');
          delBtn.textContent = '\u00D7';
          if (isLocked) delBtn.disabled = true;
          row.appendChild(nameIn);
          row.appendChild(rateIn);
          row.appendChild(amountIn);
          row.appendChild(delBtn);
          itemsContainer.appendChild(row);
        });
        if (!existingAddBtn) {
          var addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'ui-btn ui-btn--ghost payroll-add-allocation';
          addBtn.textContent = '+ 과제 추가';
          addBtn.setAttribute('data-id', item.id);
          if (isLocked) addBtn.disabled = true;
          allocContainer.appendChild(addBtn);
        }
      }

      renderAllocationRows();
      expandTd.appendChild(allocContainer);
      expandTr.appendChild(expandTd);
      payrollTbody.appendChild(expandTr);

      allocBtn.addEventListener('click', function () {
        expandTr.hidden = !expandTr.hidden;
        allocBtn.textContent = expandTr.hidden ? '환급 상세' : '접기';
      });
    });

    updateSummaryCards();
    updateSummaryCardFilterUI();

    attachPayrollInputListeners();
  }

  function updateSummaryCardFilterUI() {
    var section = document.querySelector('.payroll-summary-cards');
    if (!section) return;
    section.querySelectorAll('.payroll-summary-card').forEach(function (card) {
      var filterType = card.getAttribute('data-filter');
      card.classList.toggle('payroll-summary-card--filter-active', filterType && filterType === activeSummaryFilter);
    });
  }

  function onSummaryCardClick(filterType) {
    if (activeSummaryFilter === filterType) {
      activeSummaryFilter = null;
    } else {
      activeSummaryFilter = filterType;
    }
    renderPayrollTable();
  }

  function loadPrevMonthActualPay() {
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var ymKey = getYmKey(_ym.year, _ym.month);
    if (getSnapshot(state, ymKey)) return;
    var prevYmKey = getPrevYmKey(_ym.year, _ym.month);
    var hrData = getHrData();
    var list = getEmployedInMonth(hrData, _ym.year, _ym.month);
    if (!state.draft) state.draft = {};
    if (!state.draft[ymKey]) state.draft[ymKey] = {};
    var count = 0;
    list.forEach(function (item) {
      var rowState = getRowStateForMonth(state, prevYmKey, item.id);
      var prevActual = rowState.actualPay != null ? rowState.actualPay : '';
      var current = state.draft[ymKey][item.id] || { actualPay: '', remark: '', allocationList: [] };
      state.draft[ymKey][item.id] = {
        actualPay: prevActual,
        remark: current.remark || '',
        allocationList: normalizeAllocationList(current.allocationList || current.allocationData || [])
      };
      if (prevActual !== '') count++;
    });
    savePayrollState(state);
    renderPayrollTable();
    if (count > 0) {
      var msg = '전월(' + prevYmKey + ') 실제 지급액을 ' + count + '명분 불러왔습니다.';
      if (typeof alert === 'function') alert(msg);
    }
  }

  function updatePayrollBadgeAndButton(ymKey, isLocked) {
    var saveBtn = document.getElementById('payroll-save-month-btn');
    var unlockBtn = document.getElementById('payroll-unlock-month-btn');
    var loadPrevBtn = document.getElementById('payroll-load-prev-btn');
    if (saveBtn) {
      saveBtn.hidden = false;
      saveBtn.disabled = isLocked || !canFinalizePayroll();
      saveBtn.title = isLocked ? '' : (canFinalizePayroll() ? '해당 월의 과제비 환급이 완료되면 본 버튼을 클릭합니다.' : '권한이 없습니다.');
      if (isLocked) {
        saveBtn.classList.add('payroll-save-complete');
        saveBtn.innerHTML = '마감 완료';
      } else {
        saveBtn.classList.remove('payroll-save-complete');
        saveBtn.innerHTML = '<span class="payroll-save-btn-text">월 마감</span> <svg class="payroll-save-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      }
    }
    if (unlockBtn) {
      if (isLocked && canUnfinalizePayroll()) {
        unlockBtn.style.display = '';
        unlockBtn.disabled = false;
      } else {
        unlockBtn.style.display = 'none';
        unlockBtn.disabled = true;
      }
    }
    if (loadPrevBtn) {
      loadPrevBtn.hidden = isLocked;
      loadPrevBtn.disabled = isLocked;
    }
  }

  function showToast(message) {
    var toast = document.getElementById('payroll-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add('payroll-toast--visible');
    clearTimeout(toast._toastTimer);
    toast._toastTimer = setTimeout(function () {
      toast.classList.remove('payroll-toast--visible');
      setTimeout(function () { toast.hidden = true; }, 300);
    }, 3000);
  }

  function onSaveMonthClick() {
    if (!canFinalizePayroll()) return;
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var ymKey = getYmKey(_ym.year, _ym.month);
    if (getSnapshot(state, ymKey)) return;
    var msg = _ym.year + '년 ' + _ym.month + '월 과제비 정산이 완료되었습니다. 월 마감 하시겠습니까?\n\n※ 마감 후에는 데이터 수정이 제한됩니다.';
    if (typeof confirm !== 'function' || !confirm(msg)) return;
    saveSnapshotForCurrentMonth();
  }

  function saveSnapshotForCurrentMonth() {
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var ymKey = getYmKey(_ym.year, _ym.month);
    if (getSnapshot(state, ymKey)) return;
    var persons = {};
    var draft = getDraft(state, ymKey) || {};
    var rowEls = payrollTbody ? payrollTbody.querySelectorAll('.payroll-row') : [];
    for (var i = 0; i < rowEls.length; i++) {
      var row = rowEls[i];
      var id = row.getAttribute('data-id');
      if (!id) continue;
      var actualIn = row.querySelector('.payroll-actual');
      var remarkIn = row.querySelector('.payroll-remark');
      var actualNum = actualIn ? parseAmount(actualIn.value) : '';
      var actual = actualNum !== '' ? String(actualNum) : '';
      var remark = remarkIn ? remarkIn.value : '';
      var rowDraft = draft[id] || {};
      persons[id] = {
        actualPay: actual,
        remark: remark,
        allocationList: normalizeAllocationList(rowDraft.allocationList || rowDraft.allocationData || [])
      };
    }
    if (!state.snapshots) state.snapshots = {};
    state.snapshots[ymKey] = { savedAt: new Date().toISOString(), persons: persons };
    if (state.draft && state.draft[ymKey]) delete state.draft[ymKey];
    savePayrollState(state);
    renderPayrollTable();
    showToast('과제비 환급이 완료되었습니다. 해당 월의 데이터가 확정되어 저장되었습니다.');
  }

  function rollbackUnlockCurrentMonth() {
    if (!canUnfinalizePayroll()) return;
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var ymKey = getYmKey(_ym.year, _ym.month);
    var snapshot = getSnapshot(state, ymKey);
    if (!snapshot || !snapshot.persons) return;
    var msg = '정말로 마감을 취소하시겠습니까? 데이터가 수정 가능한 상태로 변경됩니다.';
    if (typeof confirm !== 'function' || !confirm(msg)) return;
    if (!state.draft) state.draft = {};
    state.draft[ymKey] = {};
    Object.keys(snapshot.persons).forEach(function (id) {
      state.draft[ymKey][id] = Object.assign({}, snapshot.persons[id]);
    });
    delete state.snapshots[ymKey];
    savePayrollState(state);
    renderPayrollTable();
    showToast('마감이 해제되었습니다. 데이터를 수정할 수 있습니다.');
  }

  function attachPayrollInputListeners() {
    if (!payrollTbody) return;

    function onActualBlurFormat() {
      var v = this.value;
      if (v !== '') this.value = formatAmount(v);
    }

    function persistRow(id) {
      var state = getPayrollState();
      var _ym = getCurrentYearMonth();
      var ymKey = getYmKey(_ym.year, _ym.month);
      if (getSnapshot(state, ymKey)) return;
      if (!state.draft) state.draft = {};
      if (!state.draft[ymKey]) state.draft[ymKey] = {};
      var rowState = state.draft[ymKey][id] || { actualPay: '', remark: '', allocationList: [] };

      var row = payrollTbody.querySelector('.payroll-row[data-id="' + id + '"]');
      if (row) {
        var actualIn = row.querySelector('.payroll-actual');
        var remarkIn = row.querySelector('.payroll-remark');
        var actualVal = actualIn ? parseAmount(actualIn.value) : '';
        rowState.actualPay = actualVal !== '' ? String(actualVal) : '';
        rowState.remark = remarkIn ? remarkIn.value : rowState.remark;
      }

      state.draft[ymKey][id] = rowState;
      savePayrollState(state);
      updateSummaryCards();
    }

    function saveSalaryAndUpdateBase(personId, valueStr) {
      var num = parseAmount(valueStr);
      var val = num !== '' ? String(num) : '';
      var state = getPayrollState();
      if (!state.contractSalaries) state.contractSalaries = {};
      state.contractSalaries[personId] = val;
      savePayrollState(state);
      var row = payrollTbody.querySelector('.payroll-row[data-id="' + personId + '"]');
      var baseCell = row ? row.querySelector('.payroll-base-cell') : null;
      if (baseCell) baseCell.textContent = val !== '' && monthlyBase(val) > 0 ? monthlyBase(val).toLocaleString() : '-';
    }

    function onSalaryEnter(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var row = this.closest('.payroll-row');
      if (!row) return;
      onSalaryBlurFormat.call(this);
      var id = this.getAttribute('data-id');
      var rows = payrollTbody.querySelectorAll('.payroll-row');
      var idx = Array.prototype.indexOf.call(rows, row);
      saveSalaryAndUpdateBase(id, this.value);
      updateSummaryCards();
      if (editingSalaryId === id) {
        editingSalaryId = null;
        renderPayrollTable();
      }
      rows = payrollTbody.querySelectorAll('.payroll-row');
      var nextRow = rows[idx + 1];
      if (nextRow) {
        var nextIn = nextRow.querySelector('input.payroll-salary');
        if (nextIn && !nextIn.disabled) nextIn.focus();
      } else {
        this.blur();
      }
    }

    payrollTbody.querySelectorAll('.payroll-salary').forEach(function (el) {
      el.removeEventListener('input', onSalaryInput);
      el.removeEventListener('blur', onSalaryBlur);
      el.removeEventListener('blur', onSalaryBlurFormat);
      el.removeEventListener('keydown', onSalaryEnter);
      el.addEventListener('input', onSalaryInput);
      el.addEventListener('blur', onSalaryBlur);
      el.addEventListener('blur', onSalaryBlurFormat);
      el.addEventListener('keydown', onSalaryEnter);
    });
    function onActualEnter(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var row = this.closest('.payroll-row');
      if (!row) return;
      onActualBlurFormat.call(this);
      persistRow(this.getAttribute('data-id'));
      var rows = payrollTbody.querySelectorAll('.payroll-row');
      var idx = Array.prototype.indexOf.call(rows, row);
      var nextRow = rows[idx + 1];
      if (nextRow) {
        var nextInput = nextRow.querySelector('.payroll-actual');
        if (nextInput && !nextInput.disabled) nextInput.focus();
      } else {
        this.blur();
      }
    }
    function onRemarkEnter(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var row = this.closest('.payroll-row');
      if (!row) return;
      persistRow(this.getAttribute('data-id'));
      var rows = payrollTbody.querySelectorAll('.payroll-row');
      var idx = Array.prototype.indexOf.call(rows, row);
      var nextRow = rows[idx + 1];
      if (nextRow) {
        var nextInput = nextRow.querySelector('.payroll-remark');
        if (nextInput && !nextInput.disabled) nextInput.focus();
      } else {
        this.blur();
      }
    }

    payrollTbody.querySelectorAll('.payroll-actual').forEach(function (el) {
      el.removeEventListener('input', onActualInput);
      el.removeEventListener('blur', onActualBlur);
      el.removeEventListener('blur', onActualBlurFormat);
      el.removeEventListener('keydown', onActualEnter);
      el.addEventListener('input', onActualInput);
      el.addEventListener('blur', onActualBlur);
      el.addEventListener('blur', onActualBlurFormat);
      el.addEventListener('keydown', onActualEnter);
    });
    payrollTbody.querySelectorAll('.payroll-remark').forEach(function (el) {
      el.removeEventListener('blur', onRemarkBlur);
      el.removeEventListener('keydown', onRemarkEnter);
      el.addEventListener('blur', onRemarkBlur);
      el.addEventListener('keydown', onRemarkEnter);
    });

    function onSalaryInput() {
      var row = this.closest('.payroll-row');
      var baseCell = row && row.querySelector('.payroll-base');
      var num = parseAmount(this.value);
      if (baseCell) baseCell.textContent = num !== '' && monthlyBase(num) > 0 ? monthlyBase(num).toLocaleString() : '-';
    }
    function onSalaryBlurFormat() {
      var v = this.value;
      if (v !== '') this.value = formatAmount(v);
    }
    function onSalaryBlur() {
      var id = this.getAttribute('data-id');
      saveSalaryAndUpdateBase(id, this.value);
      persistRow(id);
    }
    function onActualInput() {
      updateSummaryCards();
    }
    function onActualBlur() {
      persistRow(this.getAttribute('data-id'));
    }
    function onRemarkBlur() {
      persistRow(this.getAttribute('data-id'));
    }

    // 과제 배분 추가/삭제·변경은 이벤트 위임으로 한 번만 등록 (attachPayrollInputListeners가 매 렌더마다 호출되므로 여기서는 제거)
  }

  function attachPayrollDelegatedListeners() {
    if (!payrollTbody || payrollTbody._payrollDelegated) return;
    payrollTbody._payrollDelegated = true;

    payrollTbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var target = e.target;
      if (!target.matches('input.payroll-salary') && !target.matches('input.payroll-actual') && !target.matches('input.payroll-remark')) return;
      var row = target.closest('.payroll-row');
      if (!row) return;
      var salaryIn = row.querySelector('input.payroll-salary');
      var actualIn = row.querySelector('input.payroll-actual');
      var remarkIn = row.querySelector('input.payroll-remark');
      var inputs = [salaryIn, actualIn, remarkIn].filter(function (el) { return el && !el.disabled; });
      var idx = inputs.indexOf(target);
      if (idx === -1) return;
      if (e.shiftKey) {
        if (idx > 0) {
          e.preventDefault();
          inputs[idx - 1].focus();
        }
      } else {
        if (idx < inputs.length - 1) {
          e.preventDefault();
          inputs[idx + 1].focus();
        }
      }
    });

    payrollTbody.addEventListener('click', function (e) {
      var editSaveBtn = e.target.closest('.payroll-edit-salary-btn');
      if (editSaveBtn && !editSaveBtn.disabled) {
        var id = editSaveBtn.getAttribute('data-id');
        if (editSaveBtn.classList.contains('payroll-save-salary-btn') || editSaveBtn.textContent.trim() === '저장') {
          var row = editSaveBtn.closest('.payroll-row');
          var salaryIn = row ? row.querySelector('.payroll-salary') : null;
          var val = salaryIn ? (parseAmount(salaryIn.value) !== '' ? String(parseAmount(salaryIn.value)) : '') : '';
          var state = getPayrollState();
          if (!state.contractSalaries) state.contractSalaries = {};
          state.contractSalaries[id] = val;
          savePayrollState(state);
          editingSalaryId = null;
          renderPayrollTable();
        } else {
          editingSalaryId = id;
          renderPayrollTable();
        }
        return;
      }

      var addBtn = e.target.closest('.payroll-add-allocation');
      var delBtn = e.target.closest('.payroll-remove-allocation');
      var state = getPayrollState();
      var _ym = getCurrentYearMonth();
      var ymKey = getYmKey(_ym.year, _ym.month);
      if (getSnapshot(state, ymKey)) return;
      if (!state.draft) state.draft = {};
      if (!state.draft[ymKey]) state.draft[ymKey] = {};
      if (addBtn) {
        var id = addBtn.getAttribute('data-id');
        if (!state.draft[ymKey][id]) state.draft[ymKey][id] = { actualPay: '', remark: '', allocationList: [] };
        state.draft[ymKey][id].allocationList = state.draft[ymKey][id].allocationList || [];
        state.draft[ymKey][id].allocationList.push({ projectId: 'p-' + Date.now(), projectName: '', participationRate: '', amount: '', isManual: true });
        savePayrollState(state);
        renderPayrollTable();
        var expandTr = payrollTbody.querySelector('.payroll-expand-row[data-for-id="' + id + '"]');
        if (expandTr) expandTr.hidden = false;
        var btn = payrollTbody.querySelector('.payroll-allocation-btn[data-id="' + id + '"]');
        if (btn) btn.textContent = '접기';
      }
      if (delBtn) {
        var id = delBtn.getAttribute('data-id');
        var idx = parseInt(delBtn.getAttribute('data-idx'), 10);
        if (state.draft[ymKey] && state.draft[ymKey][id] && state.draft[ymKey][id].allocationList) {
          state.draft[ymKey][id].allocationList.splice(idx, 1);
          savePayrollState(state);
          renderPayrollTable();
        }
      }
    });

    payrollTbody.addEventListener('change', function (e) {
      if (!e.target.closest('.allocation-name') && !e.target.closest('.allocation-rate') && !e.target.closest('.allocation-amount')) return;
      var itemRow = e.target.closest('.payroll-expand-row');
      if (!itemRow) return;
      var id = itemRow.getAttribute('data-for-id');
      var container = itemRow.querySelector('.payroll-allocation-list');
      if (!container || !id) return;
      persistAllocationFromExpand(id, container);
    });

    payrollTbody.addEventListener('input', function (e) {
      if (!e.target.closest('.allocation-amount')) return;
      var itemRow = e.target.closest('.payroll-expand-row');
      if (!itemRow) return;
      var id = itemRow.getAttribute('data-for-id');
      if (id) updateAllocationSumCell(id);
      updateSummaryCards();
    });

    payrollTbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var target = e.target;
      if (!target.closest('.payroll-expand-row')) return;
      if (!target.matches('.allocation-name') && !target.matches('.allocation-rate') && !target.matches('.allocation-amount')) return;
      e.preventDefault();
      var itemRow = target.closest('.payroll-expand-row');
      var id = itemRow.getAttribute('data-for-id');
      var container = itemRow.querySelector('.payroll-allocation-list');
      if (container && id) persistAllocationFromExpand(id, container);
      var inputs = itemRow.querySelectorAll('.allocation-name, .allocation-rate, .allocation-amount');
      var idx = Array.prototype.indexOf.call(inputs, target);
      var next = inputs[idx + 1];
      if (next && !next.disabled) next.focus(); else target.blur();
    });
  }

  function persistAllocationFromExpand(personId, allocListContainer) {
    var state = getPayrollState();
    var _ym = getCurrentYearMonth();
    var ymKey = getYmKey(_ym.year, _ym.month);
    if (getSnapshot(state, ymKey)) return;
    if (!state.draft) state.draft = {};
    if (!state.draft[ymKey]) state.draft[ymKey] = {};
    if (!state.draft[ymKey][personId]) state.draft[ymKey][personId] = { actualPay: '', remark: '', allocationList: [] };
    var items = allocListContainer.querySelectorAll('.payroll-allocation-item');
    state.draft[ymKey][personId].allocationList = [];
    items.forEach(function (item) {
      var nameEl = item.querySelector('.allocation-name');
      var rateEl = item.querySelector('.allocation-rate');
      var amountEl = item.querySelector('.allocation-amount');
      state.draft[ymKey][personId].allocationList.push({
        projectId: 'p-' + Date.now(),
        projectName: nameEl ? nameEl.value : '',
        participationRate: rateEl ? rateEl.value : '',
        amount: amountEl ? amountEl.value : '',
        isManual: true
      });
    });
    savePayrollState(state);
    updateAllocationSumCell(personId);
    updateSummaryCards();
  }

  function updateAllocationSumCell(personId) {
    if (!payrollTbody) return;
    var expandRow = payrollTbody.querySelector('.payroll-expand-row[data-for-id="' + personId + '"]');
    if (!expandRow) return;
    var container = expandRow.querySelector('.payroll-allocation-list');
    if (!container) return;
    var amountInputs = container.querySelectorAll('.allocation-amount');
    var sum = 0;
    amountInputs.forEach(function (el) {
      var n = parseAmount(el.value);
      if (n !== '') sum += n;
    });
    var dataRow = payrollTbody.querySelector('.payroll-row[data-id="' + personId + '"]');
    var sumCell = dataRow ? dataRow.querySelector('.payroll-allocation-sum') : null;
    if (sumCell) sumCell.textContent = sum > 0 ? sum.toLocaleString() : '-';
  }

  function updateSummaryCards() {
    var cardActual = document.getElementById('payroll-card-total-actual');
    var cardAllocation = document.getElementById('payroll-card-total-allocation');
    var cardNet = document.getElementById('payroll-card-net-burden');
    var cardRate = document.getElementById('payroll-card-refund-rate');
    if (!payrollTbody || !cardActual || !cardAllocation || !cardNet || !cardRate) return;

    var totalActual = 0;
    payrollTbody.querySelectorAll('.payroll-actual').forEach(function (el) {
      var v = parseAmount(el.value);
      if (v !== '') totalActual += v;
    });

    var totalAllocation = 0;
    payrollTbody.querySelectorAll('.payroll-row').forEach(function (row) {
      var sumCell = row.querySelector('.payroll-allocation-sum');
      if (!sumCell || !sumCell.textContent || sumCell.textContent === '-') return;
      var n = parseInt(String(sumCell.textContent).replace(/,/g, ''), 10);
      if (!isNaN(n)) totalAllocation += n;
    });

    var net = totalActual - totalAllocation;
    if (isNaN(net)) net = 0;

    var rate = 0;
    if (totalActual > 0 && isFinite(totalAllocation)) {
      rate = (totalAllocation / totalActual) * 100;
    }

    cardActual.textContent = totalActual > 0 ? totalActual.toLocaleString() : '0';
    cardAllocation.textContent = totalAllocation > 0 ? totalAllocation.toLocaleString() : '0';
    cardNet.textContent = net !== 0 ? net.toLocaleString() : '0';
    cardRate.textContent = rate > 0 ? rate.toFixed(1) : '0';
  }

  function onPayrollRoute() {
    var hash = (window.location.hash || '').replace(/^#\/?/, '');
    if (hash !== 'payroll') return;
    initYearMonthSelects();
    attachPayrollDelegatedListeners();
    renderPayrollTable();
  }

  function onYearMonthChange() {
    renderPayrollTable();
  }

  if (payrollYear) payrollYear.addEventListener('change', onYearMonthChange);
  if (payrollMonth) payrollMonth.addEventListener('change', onYearMonthChange);
  if (payrollSaveMonthBtn) payrollSaveMonthBtn.addEventListener('click', onSaveMonthClick);
  if (payrollUnlockMonthBtn) payrollUnlockMonthBtn.addEventListener('click', rollbackUnlockCurrentMonth);
  if (payrollLoadPrevBtn) payrollLoadPrevBtn.addEventListener('click', loadPrevMonthActualPay);

  var summaryCardsSection = document.querySelector('.payroll-summary-cards');
  if (summaryCardsSection) {
    summaryCardsSection.addEventListener('click', function (e) {
      var card = e.target.closest('.payroll-summary-card[data-filter]');
      if (!card) return;
      var filterType = card.getAttribute('data-filter');
      if (filterType) onSummaryCardClick(filterType);
    });
    summaryCardsSection.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var card = e.target.closest('.payroll-summary-card[data-filter]');
      if (!card) return;
      e.preventDefault();
      var filterType = card.getAttribute('data-filter');
      if (filterType) onSummaryCardClick(filterType);
    });
  }

  window.addEventListener('hashchange', onPayrollRoute);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      onPayrollRoute();
    });
  } else {
    onPayrollRoute();
  }
})();

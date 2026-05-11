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

  /**
   * yearBudget 행이 특정 연도에 차지하는 지원금 (일별 비례 분배)
   * 단일 연도 행이면 전액, 다년 행이면 그 연도와 겹친 일수 비율만큼.
   */
  function autoSupportInYear(yb, year) {
    if (!yb) return 0;
    var s = (yb.startDate || '').toString().slice(0, 10);
    var e = (yb.endDate   || '').toString().slice(0, 10);
    if (!s || !e) return 0;

    var support = Number(yb.support || 0);
    if (!support) return 0;

    var sd = new Date(s + 'T00:00:00');
    var ed = new Date(e + 'T00:00:00');
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return 0;
    if (ed < sd) return 0;

    var yearStart = new Date(year + '-01-01T00:00:00');
    var yearEnd   = new Date(year + '-12-31T00:00:00');
    var overlapStart = sd > yearStart ? sd : yearStart;
    var overlapEnd   = ed < yearEnd   ? ed : yearEnd;
    if (overlapStart > overlapEnd) return 0;

    var totalDays   = ((ed - sd) / 86400000) + 1;
    var overlapDays = ((overlapEnd - overlapStart) / 86400000) + 1;

    if (sd.getFullYear() === ed.getFullYear()) {
      return Number(year) === sd.getFullYear() ? support : 0;
    }
    return Math.round(support * overlapDays / totalDays);
  }

  /**
   * yearBudgets 배열 전체에서 특정 연도의 자동 비례 지원금 합계
   */
  function autoSupportSumInYear(yearBudgets, year) {
    var sum = 0;
    if (!Array.isArray(yearBudgets)) return 0;
    yearBudgets.forEach(function (yb) {
      sum += autoSupportInYear(yb, year);
    });
    return sum;
  }

  /**
   * yearBudgets에 걸치는 모든 캘린더 연도 추출 (정렬됨)
   */
  function getCalendarYearsForBudgets(yearBudgets) {
    if (!Array.isArray(yearBudgets) || !yearBudgets.length) return [];
    var minY = null, maxY = null;
    yearBudgets.forEach(function (yb) {
      var s = (yb.startDate || '').toString().slice(0, 4);
      var e = (yb.endDate || '').toString().slice(0, 4);
      if (s) {
        var ys = parseInt(s, 10);
        if (!isNaN(ys)) {
          if (minY === null || ys < minY) minY = ys;
          if (maxY === null || ys > maxY) maxY = ys;
        }
      }
      if (e) {
        var ye = parseInt(e, 10);
        if (!isNaN(ye)) {
          if (minY === null || ye < minY) minY = ye;
          if (maxY === null || ye > maxY) maxY = ye;
        }
      }
    });
    if (minY === null || maxY === null) return [];
    var years = [];
    for (var y = minY; y <= maxY; y++) years.push(y);
    return years;
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
    var supportSum = 0, cashSum = 0, inKindSum = 0;
    rows.forEach(function (r) {
      supportSum += parseNum((r.querySelector('.yb-support') || {}).value || '0');
      cashSum    += parseNum((r.querySelector('.yb-cash')    || {}).value || '0');
      inKindSum  += parseNum((r.querySelector('.yb-inkind')  || {}).value || '0');
    });
    var total = supportSum + cashSum + inKindSum;
    totalEl.innerHTML =
      '<span style="color:#6b7280; font-weight:400; margin-right:0.5rem;">' +
        '정부지원금 <strong style="color:#111;">' + formatNum(supportSum) + '</strong>' +
        ' &nbsp;|&nbsp; ' +
        '자부담 현금 <strong style="color:#111;">' + formatNum(cashSum) + '</strong>' +
        ' &nbsp;|&nbsp; ' +
        '자부담 현물 <strong style="color:#111;">' + formatNum(inKindSum) + '</strong>' +
      '</span> &nbsp;&nbsp; ' +
      '총 사업비: <strong>' + formatNum(total) + '</strong>원';
    updateBudgetPercent();
  }

  // 비중 계산: 우리 분담(연차별 정부지원금 합) / 총 지원금(입력값)
  function updateBudgetPercent() {
    var hintEl  = document.getElementById('our-budget-percent');
    var totalEl_ = document.getElementById('consortium-total-budget');
    if (!hintEl || !totalEl_) return;
    var grandTotal = parseNum(totalEl_.value);

    // 우리 분담 = 연차별 예산의 정부지원금 합
    var ourSupport = 0;
    if (tbodyEl) {
      tbodyEl.querySelectorAll('tr').forEach(function (r) {
        ourSupport += parseNum((r.querySelector('.yb-support') || {}).value || '0');
      });
    }

    if (!ourSupport && !grandTotal) {
      hintEl.textContent = '연차별 예산의 정부지원금 합과 비교한 비중을 표시합니다';
      return;
    }
    if (!grandTotal) {
      hintEl.textContent = '우리 분담: ' + formatNum(ourSupport) + '원 (총 지원금 입력 시 비중 표시)';
      return;
    }
    if (!ourSupport) {
      hintEl.textContent = '총 지원금 ' + formatNum(grandTotal) + '원';
      return;
    }
    var pct = (ourSupport / grandTotal * 100);
    var pctText = (pct > 100 ? pct.toFixed(0) : pct.toFixed(1)) + '%';
    hintEl.textContent = '총 ' + formatNum(grandTotal) + '원 중 우리 분담 ' + formatNum(ourSupport) + '원 (' + pctText + ')';
  }

  // 참여 형태 라디오 변경 → 컨소시엄 추가 입력란 토글
  function updateParticipationVisibility() {
    var checked = document.querySelector('input[name="participation-type"]:checked');
    var isCons = checked && checked.value === '컨소';
    var roleWrap = document.getElementById('consortium-role-wrap');
    var extraWrap = document.getElementById('consortium-extra-wrap');
    if (roleWrap) roleWrap.style.display = isCons ? '' : 'none';
    if (extraWrap) extraWrap.style.display = isCons ? '' : 'none';
  }

  function renumberRows() {
    if (!tbodyEl) return;
    tbodyEl.querySelectorAll('tr').forEach(function (r, i) {
      var numEl = r.querySelector('.yb-num');
      if (numEl) numEl.textContent = i + 1;
    });
  }

  // ===== 책임자 히스토리 (이전 책임자 관리) =====

  function addManagerHistoryRow(values) {
    var container = document.getElementById('manager-history-container');
    if (!container) return null;

    var row = document.createElement('div');
    row.className = 'manager-history-row';
    row.innerHTML =
      '<input type="text" class="mh-name" placeholder="이전 책임자 이름">' +
      '<input type="text" class="mh-date mh-start" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric">' +
      '<span class="mh-tilde">~</span>' +
      '<input type="text" class="mh-date mh-end" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric">' +
      '<button type="button" class="mh-del" aria-label="이전 책임자 삭제" title="삭제">×</button>';

    // 날짜 자동 포맷팅 (blur 시점 — 입력 중에는 자유롭게)
    row.querySelectorAll('.mh-date').forEach(function (inp) {
      inp.addEventListener('blur', function () {
        var v = inp.value.replace(/\D/g, '');
        if (v.length === 8) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
        else if (v.length === 6) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6);
        else if (v.length === 4) inp.value = v.slice(0, 4);
        else if (v.length === 0) inp.value = '';
        else if (inp.value.indexOf('-') < 0) inp.value = v;
      });
    });

    // 삭제 버튼
    row.querySelector('.mh-del').addEventListener('click', function () {
      row.remove();
    });

    container.appendChild(row);

    // 초기값 채우기 (수정 모드)
    if (values) {
      var nameEl = row.querySelector('.mh-name');
      var startEl = row.querySelector('.mh-start');
      var endEl = row.querySelector('.mh-end');
      if (nameEl) nameEl.value = values.name || '';
      if (startEl) startEl.value = (values.startDate || '').toString().slice(0, 10);
      if (endEl) endEl.value = (values.endDate || '').toString().slice(0, 10);
    }

    return row;
  }

  function clearManagerHistory() {
    var container = document.getElementById('manager-history-container');
    if (container) container.innerHTML = '';
  }

  function getManagerHistoryFromForm() {
    var rows = document.querySelectorAll('#manager-history-container .manager-history-row');
    var list = [];
    rows.forEach(function (row) {
      var name = (row.querySelector('.mh-name') || {}).value || '';
      var startDate = (row.querySelector('.mh-start') || {}).value || '';
      var endDate = (row.querySelector('.mh-end') || {}).value || '';
      name = name.trim();
      if (name) {
        list.push({ name: name, startDate: startDate.trim(), endDate: endDate.trim() });
      }
    });
    return list;
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
      // 자동 포맷팅은 blur(포커스 잃을 때)에만 — 사용자가 자유롭게 입력/수정 가능
      inp.addEventListener('blur', function () {
        var v = inp.value.replace(/\D/g, '');
        if (v.length === 8) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
        else if (v.length === 6) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6);
        else if (v.length === 4) inp.value = v.slice(0, 4);
        else if (v.length === 0) inp.value = '';
        // 이미 - 가 들어간 형태면 그대로 두기
        else if (inp.value.indexOf('-') < 0) inp.value = v;
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

  // ===== 캘린더 분배 =====

  // 현재 yearBudget 테이블의 raw 데이터를 읽어 [{startDate, endDate, support}] 반환
  function readCurrentYearBudgets() {
    var out = [];
    if (!tbodyEl) return out;
    tbodyEl.querySelectorAll('tr').forEach(function (row) {
      var s   = (row.querySelector('.yb-start')   || {}).value || '';
      var e   = (row.querySelector('.yb-end')     || {}).value || '';
      var sup = parseNum((row.querySelector('.yb-support') || {}).value);
      out.push({ startDate: s, endDate: e, support: sup });
    });
    return out;
  }

  /**
   * 단일 yearBudget이 걸치는 캘린더 연도 목록
   */
  function getYearsInBudget(yb) {
    if (!yb || !yb.startDate || !yb.endDate) return [];
    var ys = parseInt((yb.startDate || '').slice(0, 4), 10);
    var ye = parseInt((yb.endDate || '').slice(0, 4), 10);
    if (isNaN(ys) || isNaN(ye)) return [];
    var arr = [];
    for (var y = ys; y <= ye; y++) arr.push(y);
    return arr;
  }

  /**
   * 한 차수 그룹의 입력 합을 정부지원금과 비교하여 메시지 갱신
   * - 모든 칸이 입력된 경우만 검증 (일부 빈 칸은 자동 비례라 검증 의미 없음)
   * @param {HTMLElement} groupEl - .cal-breakdown-group 요소
   */
  function updateBreakdownSum(groupEl) {
    if (!groupEl) return;
    var msgEl = groupEl.querySelector('.cal-breakdown-sum-msg');
    if (!msgEl) return;

    var support = Number(groupEl.getAttribute('data-support') || 0);
    var inputs = groupEl.querySelectorAll('input.cal-budget-input');

    var sum = 0;
    var filledCount = 0;
    inputs.forEach(function (inp) {
      var raw = (inp.value || '').trim();
      if (raw === '') return;
      filledCount++;
      sum += parseNum(raw);
    });

    // 검증 케이스:
    // 1) 빈 칸 0개 (모두 입력) → 합 검증
    // 2) 빈 칸 있음 → 검증 안 함 (자동 비례 혼합)
    // 3) 정부지원금 0 → 검증 안 함
    if (filledCount === 0 || filledCount < inputs.length || support === 0) {
      msgEl.classList.remove('show', 'cal-breakdown-sum-ok', 'cal-breakdown-sum-error');
      msgEl.innerHTML = '';
      return;
    }

    var diff = sum - support;
    if (diff === 0) {
      msgEl.className = 'cal-breakdown-sum-msg show cal-breakdown-sum-ok';
      msgEl.innerHTML = '✓ 입력 합 ' + formatNum(sum) + '원 — 정부지원금과 일치합니다.';
    } else {
      msgEl.className = 'cal-breakdown-sum-msg show cal-breakdown-sum-error';
      var sign = diff > 0 ? '초과' : '부족';
      msgEl.innerHTML = '⚠️ 입력 합 <strong>' + formatNum(sum) + '원</strong> — 정부지원금 ' +
        formatNum(support) + '원 대비 <strong>' + formatNum(Math.abs(diff)) + '원 ' + sign + '</strong>';
    }
  }

  /**
   * 캘린더 분배 입력란을 연차별 그룹으로 다시 그림
   * @param {Object} keepValues - 이미 입력된 사용자 값들 { '0:2024': 'xxx', ... } (yb_index:year 키)
   */
  function renderCalendarBreakdown(keepValues) {
    var container = document.getElementById('cal-breakdown-groups');
    if (!container) return;

    // 현재 사용자 입력값 보존 (전달 안 됐으면 DOM에서 읽음)
    if (!keepValues) {
      keepValues = {};
      container.querySelectorAll('input.cal-budget-input').forEach(function (inp) {
        var key = inp.getAttribute('data-yb-idx') + ':' + inp.getAttribute('data-year');
        if (inp.value && inp.value.trim() !== '') keepValues[key] = inp.value;
      });
    }

    var ybs = readCurrentYearBudgets();
    // 유효한 yearBudget만 (시작일/종료일 있는 것)
    var validYbs = ybs
      .map(function (yb, idx) { return { yb: yb, idx: idx }; })
      .filter(function (x) { return x.yb.startDate && x.yb.endDate; });

    if (!validYbs.length) {
      container.innerHTML = '<div class="cal-breakdown-empty">연차별 예산을 먼저 입력하세요 (시작일/종료일).</div>';
      return;
    }

    container.innerHTML = validYbs.map(function (x) {
      var yb = x.yb;
      var idx = x.idx;
      var years = getYearsInBudget(yb);
      if (!years.length) return '';

      var headerSupport = yb.support > 0 ? '<span class="cal-group-support">정부지원금 ' + formatNum(yb.support) + '원</span>' : '';
      var header =
        '<div class="cal-breakdown-group-header">' +
          '<span class="cal-group-badge">' + (idx + 1) + '차</span>' +
          '<span class="cal-group-period">' + escapeHtml(yb.startDate) + ' ~ ' + escapeHtml(yb.endDate) + '</span>' +
          headerSupport +
        '</div>';

      var items = years.map(function (y) {
        var auto = autoSupportInYear(yb, y);
        var key = idx + ':' + y;
        var userVal = keepValues[key];
        var displayVal = (userVal != null && userVal !== '') ? userVal : '';
        return (
          '<div class="cal-breakdown-item">' +
            '<label>' + y + '년</label>' +
            '<input type="text" class="cal-budget-input" ' +
              'data-yb-idx="' + idx + '" data-year="' + y + '" ' +
              'value="' + escapeHtml(displayVal) + '" ' +
              'placeholder="자동 ' + (auto > 0 ? formatNum(auto) : '0') + '" ' +
              'inputmode="numeric">' +
          '</div>'
        );
      }).join('');

      return '<div class="cal-breakdown-group" data-yb-idx="' + idx + '" data-support="' + (yb.support || 0) + '">' +
        header +
        '<div class="cal-breakdown-grid">' + items + '</div>' +
        '<div class="cal-breakdown-sum-msg"></div>' +
      '</div>';
    }).join('');

    // 입력 시 천단위 콤마 (blur) + 합계 검증
    container.querySelectorAll('input.cal-budget-input').forEach(function (inp) {
      inp.addEventListener('blur', function () {
        var n = parseNum(inp.value);
        inp.value = n > 0 ? formatNum(n) : '';
        // 이 input이 속한 그룹의 합계 갱신
        var groupEl = inp.closest('.cal-breakdown-group');
        updateBreakdownSum(groupEl);
      });
    });

    // 초기 합계 메시지 갱신 (모든 그룹)
    container.querySelectorAll('.cal-breakdown-group').forEach(function (g) {
      updateBreakdownSum(g);
    });
  }

  /**
   * 폼에서 각 yearBudget별 calendarBreakdown 객체 추출
   * 반환: [{ '2025': N, '2026': N }, { '2026': N, ... }] — yearBudget 순서대로
   */
  function getCalendarBreakdownsFromForm() {
    var container = document.getElementById('cal-breakdown-groups');
    if (!container) return [];
    var byIdx = {};
    container.querySelectorAll('input.cal-budget-input').forEach(function (inp) {
      var idx = inp.getAttribute('data-yb-idx');
      var y = inp.getAttribute('data-year');
      var raw = inp.value;
      if (idx == null || !y) return;
      var trimmed = String(raw || '').trim();
      if (trimmed === '') return;  // 빈 칸은 자동 비례
      if (!byIdx[idx]) byIdx[idx] = {};
      byIdx[idx][y] = parseNum(trimmed);
    });
    return byIdx;  // { '0': {...}, '1': {...} }
  }

  // ===== 입금 일정 =====

  /**
   * 옛 payments 배열을 plannedPayments + actualPayments로 분리 (자동 마이그레이션)
   */
  function migratePayments(yb) {
    var planned = Array.isArray(yb.plannedPayments) ? yb.plannedPayments.slice() : [];
    var actual = Array.isArray(yb.actualPayments) ? yb.actualPayments.slice() : [];
    if (Array.isArray(yb.payments)) {
      yb.payments.forEach(function (p) {
        if (p.plannedDate || (p.plannedAmount && p.plannedAmount > 0)) {
          planned.push({
            date: p.plannedDate || '',
            amount: Number(p.plannedAmount || 0)
          });
        }
        if (p.actualDate || (p.actualAmount && p.actualAmount > 0)) {
          actual.push({
            date: p.actualDate || '',
            amount: Number(p.actualAmount || 0)
          });
        }
      });
    }
    return { planned: planned, actual: actual };
  }

  /**
   * 입금 일정을 yearBudget별 그룹으로 다시 그림
   * @param {Object} initialByIdx - 각 yearBudget의 { planned: [...], actual: [...] } (yb index 키)
   */
  function renderPayments(initialByIdx) {
    var container = document.getElementById('payment-groups');
    if (!container) return;

    var ybs = readCurrentYearBudgets();
    var validYbs = ybs
      .map(function (yb, idx) { return { yb: yb, idx: idx }; })
      .filter(function (x) { return x.yb.startDate && x.yb.endDate; });

    // 사용자 입력값 보존 (initialByIdx 없으면 DOM에서 읽음)
    var payByIdx;
    if (initialByIdx && typeof initialByIdx === 'object') {
      payByIdx = initialByIdx;
    } else {
      payByIdx = getAllPaymentsFromForm();
    }

    if (!validYbs.length) {
      container.innerHTML = '<div class="payment-empty">연차별 예산을 먼저 입력하세요 (시작일/종료일).</div>';
      return;
    }

    container.innerHTML = validYbs.map(function (x) {
      var yb = x.yb;
      var idx = x.idx;
      var pays = payByIdx[idx] || { planned: [], actual: [] };

      var headerSupport = yb.support > 0 ? '<span class="cal-group-support">정부지원금 ' + formatNum(yb.support) + '원</span>' : '';
      var header =
        '<div class="payment-group-header">' +
          '<span class="cal-group-badge">' + (idx + 1) + '차</span>' +
          '<span class="cal-group-period">' + escapeHtml(yb.startDate) + ' ~ ' + escapeHtml(yb.endDate) + '</span>' +
          headerSupport +
        '</div>';

      var plannedRows = (pays.planned || []).length
        ? pays.planned.map(function (p) { return plannedRowHtml(idx, p); }).join('')
        : '';
      var actualRows = (pays.actual || []).length
        ? pays.actual.map(function (p) { return actualRowHtml(idx, p); }).join('')
        : '';

      // 예정 입금 섹션
      var plannedSection =
        '<div class="payment-section payment-section--planned">' +
          '<div class="payment-section-header">' +
            '<div class="payment-section-title"><span class="pay-section-emoji">📋</span>예정 입금</div>' +
            '<div class="payment-section-actions">' +
              '<button type="button" class="payment-auto-btn pay-auto-btn" data-yb-idx="' + idx + '" title="정부지원금을 분기 마지막 날 기준으로 균등 분배">⚡ 자동 분배</button>' +
              '<button type="button" class="payment-add-btn pay-add-planned-btn" data-yb-idx="' + idx + '">+ 예정 입금 추가</button>' +
            '</div>' +
          '</div>' +
          '<table class="payment-table payment-planned-table">' +
            '<thead><tr>' +
              '<th style="width:60px">분기</th>' +
              '<th style="width:140px">예정일</th>' +
              '<th style="text-align:right">예정 금액</th>' +
              '<th style="width:32px"></th>' +
            '</tr></thead>' +
            '<tbody class="planned-tbody">' + plannedRows + '</tbody>' +
          '</table>' +
          '<div class="payment-sum-msg planned-sum-msg"></div>' +
        '</div>';

      // 실제 수령 섹션
      var actualSection =
        '<div class="payment-section payment-section--actual">' +
          '<div class="payment-section-header">' +
            '<div class="payment-section-title"><span class="pay-section-emoji">💰</span>실제 수령</div>' +
            '<div class="payment-section-actions">' +
              '<button type="button" class="payment-add-btn pay-add-actual-btn" data-yb-idx="' + idx + '">+ 실제 수령 추가</button>' +
            '</div>' +
          '</div>' +
          '<table class="payment-table payment-actual-table">' +
            '<thead><tr>' +
              '<th style="width:60px">분기</th>' +
              '<th style="width:140px">수령일</th>' +
              '<th style="text-align:right">수령 금액</th>' +
              '<th style="width:32px"></th>' +
            '</tr></thead>' +
            '<tbody class="actual-tbody">' + actualRows + '</tbody>' +
          '</table>' +
          '<div class="payment-sum-msg actual-sum-msg"></div>' +
        '</div>';

      return '<div class="payment-group" data-yb-idx="' + idx + '" data-support="' + (yb.support || 0) + '">' +
        header +
        plannedSection +
        actualSection +
        '<div class="payment-quarterly-wrap"></div>' +
      '</div>';
    }).join('');

    // 이벤트 바인딩
    bindPaymentEvents();

    // 합계 + 분기 요약 (모든 그룹)
    container.querySelectorAll('.payment-group').forEach(function (g) {
      updatePaymentSum(g);
      updateQuarterlySummary(g);
    });
  }

  function plannedRowHtml(ybIdx, p) {
    p = p || {};
    var date = (p.date || '').toString();
    var amount = p.amount != null && p.amount !== '' ? formatNum(p.amount) : '';
    var qLabel = getQuarterLabel(date);
    return (
      '<tr class="payment-row planned-row" data-yb-idx="' + ybIdx + '">' +
        '<td class="pay-q-label">' + qLabel + '</td>' +
        '<td><input type="text" class="pay-date pay-planned-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric" value="' + escapeHtml(date) + '"></td>' +
        '<td><input type="text" class="pay-amount pay-planned-amount" inputmode="numeric" value="' + escapeHtml(amount) + '"></td>' +
        '<td class="pay-del"><button type="button" class="pay-del-btn" title="이 행 삭제">×</button></td>' +
      '</tr>'
    );
  }

  function actualRowHtml(ybIdx, p) {
    p = p || {};
    var date = (p.date || '').toString();
    var amount = p.amount != null && p.amount !== '' ? formatNum(p.amount) : '';
    var qLabel = getQuarterLabel(date);
    return (
      '<tr class="payment-row actual-row" data-yb-idx="' + ybIdx + '">' +
        '<td class="pay-q-label">' + qLabel + '</td>' +
        '<td><input type="text" class="pay-date pay-actual-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric" value="' + escapeHtml(date) + '"></td>' +
        '<td><input type="text" class="pay-amount pay-actual-amount" inputmode="numeric" value="' + escapeHtml(amount) + '"></td>' +
        '<td class="pay-del"><button type="button" class="pay-del-btn" title="이 행 삭제">×</button></td>' +
      '</tr>'
    );
  }

  // 날짜에서 분기 라벨 추출 (예: '2026-04-15' → '2Q')
  function getQuarterLabel(dateStr) {
    if (!dateStr) return '-';
    var m = parseInt(String(dateStr).slice(5, 7), 10);
    if (isNaN(m) || m < 1 || m > 12) return '-';
    var q = Math.ceil(m / 3);
    return q + 'Q';
  }

  // YYYY-MM-DD 문자열을 로컬 Date로 파싱
  function parseLocalDate(s) {
    if (!s) return null;
    var parts = String(s).slice(0, 10).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    var dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function formatLocalDate(dt) {
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
  }

  /**
   * yearBudget을 분기별 균등 분배 → 예정 입금 배열 반환
   * - 분기 종료일 기준 (3/31, 6/30, 9/30, 12/31)
   * - yb 종료일이 분기 종료일보다 빠르면 yb 종료일 사용
   * - 천원 단위로 떨어지게 분배 (마지막 분기에서 차이 조정)
   */
  function autoDistributeQuarterly(yb) {
    if (!yb || !yb.startDate || !yb.endDate) return [];
    var support = Number(yb.support || 0);
    if (!support || support <= 0) return [];

    var sd = parseLocalDate(yb.startDate);
    var ed = parseLocalDate(yb.endDate);
    if (!sd || !ed || ed < sd) return [];

    var quarters = [];
    var year = sd.getFullYear();
    var qIdx = Math.floor(sd.getMonth() / 3);  // 0~3

    while (true) {
      var qEndMonth = (qIdx + 1) * 3;  // 3,6,9,12
      var qEnd = new Date(year, qEndMonth, 0);  // 분기 마지막 날 (예: 3월 31일)

      // 분기 종료일 vs yb 종료일 중 빠른 것
      var payDate = qEnd <= ed ? qEnd : ed;
      // yb 시작일보다 분기 종료일이 빠르면 건너뜀 (이 케이스는 거의 없음)
      if (qEnd >= sd) {
        quarters.push({ date: formatLocalDate(payDate) });
      }

      // 다음 분기로
      qIdx++;
      if (qIdx > 3) { qIdx = 0; year++; }
      var nextQStart = new Date(year, qIdx * 3, 1);
      if (nextQStart > ed) break;
    }

    if (!quarters.length) return [];

    // 천원 단위 균등 분배 (마지막 분기에서 차이 조정)
    var n = quarters.length;
    var perQ = Math.floor(support / n / 1000) * 1000;  // 천원 단위 내림
    var partialSum = perQ * (n - 1);

    quarters.forEach(function (q, i) {
      q.amount = (i < n - 1) ? perQ : (support - partialSum);
    });

    return quarters;
  }

  /**
   * plannedPayments + actualPayments 배열을 분기별로 그룹화하여 요약 데이터 반환
   * 반환: [{ year, q, planned, actual, plannedCnt, actualCnt }, ...]
   */
  function computeQuarterlySummary(planned, actual) {
    var quarters = {};

    function ensureBin(y, q) {
      var key = y + '-Q' + q;
      if (!quarters[key]) {
        quarters[key] = {
          year: parseInt(y, 10), q: q,
          planned: 0, actual: 0,
          plannedCnt: 0, actualCnt: 0
        };
      }
      return quarters[key];
    }

    (planned || []).forEach(function (p) {
      if (!p.date) return;
      var y = p.date.toString().slice(0, 4);
      var m = parseInt(p.date.toString().slice(5, 7), 10);
      if (!y || isNaN(m) || m < 1) return;
      var bin = ensureBin(y, Math.ceil(m / 3));
      var amt = Number(p.amount || 0);
      if (amt > 0) {
        bin.planned += amt;
        bin.plannedCnt += 1;
      }
    });

    (actual || []).forEach(function (p) {
      if (!p.date) return;
      var y = p.date.toString().slice(0, 4);
      var m = parseInt(p.date.toString().slice(5, 7), 10);
      if (!y || isNaN(m) || m < 1) return;
      var bin = ensureBin(y, Math.ceil(m / 3));
      var amt = Number(p.amount || 0);
      if (amt > 0) {
        bin.actual += amt;
        bin.actualCnt += 1;
      }
    });

    return Object.keys(quarters).sort().map(function (k) { return quarters[k]; });
  }

  /**
   * 분기 요약 표 HTML 생성
   */
  function renderQuarterlyHtml(quarters) {
    if (!quarters.length) {
      return '<div class="quarterly-empty">입금 일정을 입력하면 분기별 요약이 자동 표시됩니다.</div>';
    }

    var head = '<tr><th></th>';
    var rowPlanned = '<tr><td>예정 금액</td>';
    var rowActual  = '<tr><td>수령 금액</td>';
    var rowCount   = '<tr><td>수령 건수</td>';
    var rowDiff    = '<tr><td>잔액</td>';

    var totals = { planned: 0, actual: 0, plannedCnt: 0, actualCnt: 0 };

    quarters.forEach(function (q) {
      head += '<th>' + q.year + ' ' + q.q + 'Q</th>';
      rowPlanned += '<td>' + (q.planned > 0 ? formatNum(q.planned) : '-') + '</td>';
      rowActual  += '<td>' + (q.actual > 0 ? formatNum(q.actual) : '-') + '</td>';
      var countOk = (q.actualCnt === q.plannedCnt && q.plannedCnt > 0);
      rowCount += '<td' + (countOk ? ' class="q-ok"' : '') + '>' +
        q.actualCnt + '/' + q.plannedCnt + (countOk ? ' ✓' : '') + '</td>';
      var diff = q.planned - q.actual;
      rowDiff += '<td' + (diff > 0 ? ' class="q-diff-warn"' : '') + '>' + formatNum(diff) + '</td>';
      totals.planned += q.planned;
      totals.actual += q.actual;
      totals.plannedCnt += q.plannedCnt;
      totals.actualCnt += q.actualCnt;
    });

    head += '<th>합계</th></tr>';
    rowPlanned += '<td><strong>' + formatNum(totals.planned) + '</strong></td></tr>';
    rowActual  += '<td><strong>' + (totals.actual > 0 ? formatNum(totals.actual) : '-') + '</strong></td></tr>';
    var totalCountOk = totals.actualCnt === totals.plannedCnt && totals.plannedCnt > 0;
    rowCount   += '<td' + (totalCountOk ? ' class="q-ok"' : '') + '><strong>' +
      totals.actualCnt + '/' + totals.plannedCnt + (totalCountOk ? ' ✓' : '') + '</strong></td></tr>';
    var totalDiff = totals.planned - totals.actual;
    rowDiff    += '<td><strong' + (totalDiff > 0 ? ' class="q-diff-warn"' : '') + '>' + formatNum(totalDiff) + '</strong></td></tr>';

    return '<table class="quarterly-summary"><thead>' + head + '</thead><tbody>' +
      rowPlanned + rowActual + rowCount + rowDiff + '</tbody></table>';
  }

  /**
   * 특정 yb 그룹의 분기 요약 다시 그리기 (입금 행 변경 시 호출)
   */
  function updateQuarterlySummary(groupEl) {
    if (!groupEl) return;
    var wrapEl = groupEl.querySelector('.payment-quarterly-wrap');
    if (!wrapEl) return;
    var idx = groupEl.getAttribute('data-yb-idx');
    var allPays = getAllPaymentsFromForm();
    var pays = allPays[idx] || { planned: [], actual: [] };
    var quarters = computeQuarterlySummary(pays.planned, pays.actual);
    wrapEl.innerHTML = '<div class="payment-quarterly-title">분기별 요약</div>' + renderQuarterlyHtml(quarters);
  }

  function autoFormatDateOnBlur(inp) {
    var v = (inp.value || '').replace(/\D/g, '');
    if (v.length === 8) {
      inp.value = v.slice(0,4) + '-' + v.slice(4,6) + '-' + v.slice(6,8);
    }
  }

  function bindPaymentEvents() {
    var container = document.getElementById('payment-groups');
    if (!container) return;

    // 예정 행 추가
    container.querySelectorAll('.pay-add-planned-btn').forEach(function (btn) {
      btn.onclick = function () {
        var idx = btn.getAttribute('data-yb-idx');
        var group = container.querySelector('.payment-group[data-yb-idx="' + idx + '"]');
        if (!group) return;
        var tbody = group.querySelector('.planned-tbody');
        if (!tbody) return;
        tbody.insertAdjacentHTML('beforeend', plannedRowHtml(idx, {}));
        bindPaymentEvents();
        updatePaymentSum(group);
        updateQuarterlySummary(group);
      };
    });

    // 자동 분배 버튼
    container.querySelectorAll('.pay-auto-btn').forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute('data-yb-idx'), 10);
        var ybs = readCurrentYearBudgets();
        var yb = ybs[idx];
        if (!yb) return;
        if (!yb.startDate || !yb.endDate || !yb.support) {
          alert('해당 연차의 시작일/종료일/정부지원금을 먼저 입력하세요.');
          return;
        }
        // 기존 예정 입금이 있으면 덮어쓰기 확인
        var existingRows = container.querySelectorAll('.payment-group[data-yb-idx="' + idx + '"] .planned-row');
        if (existingRows.length > 0) {
          if (!confirm('이 연차의 기존 예정 입금 ' + existingRows.length + '건이 모두 삭제되고 새로 채워집니다. 진행할까요?')) return;
        }
        var quarters = autoDistributeQuarterly(yb);
        if (!quarters.length) {
          alert('분배할 분기를 계산할 수 없습니다. 시작일/종료일을 확인하세요.');
          return;
        }
        // 새 데이터로 다시 렌더 (기존 actual은 보존)
        var allPays = getAllPaymentsFromForm();
        if (!allPays[idx]) allPays[idx] = { planned: [], actual: [] };
        allPays[idx].planned = quarters;
        renderPayments(allPays);
      };
    });

    // 실제 행 추가
    container.querySelectorAll('.pay-add-actual-btn').forEach(function (btn) {
      btn.onclick = function () {
        var idx = btn.getAttribute('data-yb-idx');
        var group = container.querySelector('.payment-group[data-yb-idx="' + idx + '"]');
        if (!group) return;
        var tbody = group.querySelector('.actual-tbody');
        if (!tbody) return;
        tbody.insertAdjacentHTML('beforeend', actualRowHtml(idx, {}));
        bindPaymentEvents();
        updatePaymentSum(group);
        updateQuarterlySummary(group);
      };
    });

    // 행 삭제 (공통)
    container.querySelectorAll('.pay-del-btn').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('.payment-row');
        var group = btn.closest('.payment-group');
        if (row) row.remove();
        if (group) {
          updatePaymentSum(group);
          updateQuarterlySummary(group);
        }
      };
    });

    // 금액 input blur: 콤마 + 합계 + 분기 요약
    container.querySelectorAll('input.pay-amount').forEach(function (inp) {
      inp.onblur = function () {
        var n = parseNum(inp.value);
        inp.value = n > 0 ? formatNum(n) : '';
        var group = inp.closest('.payment-group');
        if (group) {
          updatePaymentSum(group);
          updateQuarterlySummary(group);
        }
      };
    });

    // 날짜 input blur: 자동 YYYY-MM-DD + 분기 라벨 갱신 + 요약 갱신
    container.querySelectorAll('input.pay-date').forEach(function (inp) {
      inp.onblur = function () {
        autoFormatDateOnBlur(inp);
        // 분기 라벨 (행 첫 칸) 갱신
        var row = inp.closest('.payment-row');
        if (row) {
          var qCell = row.querySelector('.pay-q-label');
          if (qCell) qCell.textContent = getQuarterLabel(inp.value);
        }
        var group = inp.closest('.payment-group');
        if (group) updateQuarterlySummary(group);
      };
    });
  }

  function updatePaymentSum(groupEl) {
    if (!groupEl) return;
    var support = Number(groupEl.getAttribute('data-support') || 0);

    // 예정 합
    var plannedSum = 0;
    groupEl.querySelectorAll('.planned-row .pay-planned-amount').forEach(function (inp) {
      plannedSum += parseNum(inp.value);
    });
    // 실제 합
    var actualSum = 0;
    groupEl.querySelectorAll('.actual-row .pay-actual-amount').forEach(function (inp) {
      actualSum += parseNum(inp.value);
    });

    // 예정 합계 메시지 (정부지원금 비교)
    var plannedMsgEl = groupEl.querySelector('.planned-sum-msg');
    if (plannedMsgEl) {
      if (plannedSum === 0) {
        plannedMsgEl.className = 'payment-sum-msg planned-sum-msg';
        plannedMsgEl.innerHTML = '';
      } else if (support > 0) {
        var diff = plannedSum - support;
        if (diff === 0) {
          plannedMsgEl.className = 'payment-sum-msg planned-sum-msg payment-sum-ok';
          plannedMsgEl.innerHTML = '✓ 예정 합 ' + formatNum(plannedSum) + '원 (정부지원금 일치)';
        } else {
          plannedMsgEl.className = 'payment-sum-msg planned-sum-msg payment-sum-warn';
          var sign = diff > 0 ? '초과' : '부족';
          plannedMsgEl.innerHTML = '⚠️ 예정 합 ' + formatNum(plannedSum) + '원 — 정부지원금 ' + formatNum(support) + '원 대비 ' + formatNum(Math.abs(diff)) + '원 ' + sign;
        }
      } else {
        plannedMsgEl.className = 'payment-sum-msg planned-sum-msg';
        plannedMsgEl.innerHTML = '예정 합 ' + formatNum(plannedSum) + '원';
      }
    }

    // 실제 합계 메시지 (잔액 계산)
    var actualMsgEl = groupEl.querySelector('.actual-sum-msg');
    if (actualMsgEl) {
      if (actualSum === 0) {
        actualMsgEl.className = 'payment-sum-msg actual-sum-msg';
        actualMsgEl.innerHTML = '';
      } else if (plannedSum > 0) {
        var remain = plannedSum - actualSum;
        if (remain <= 0) {
          actualMsgEl.className = 'payment-sum-msg actual-sum-msg payment-sum-ok';
          actualMsgEl.innerHTML = '✓ 실제 수령 ' + formatNum(actualSum) + '원 (전액 수령 완료)';
        } else {
          actualMsgEl.className = 'payment-sum-msg actual-sum-msg';
          actualMsgEl.innerHTML = '실제 수령 ' + formatNum(actualSum) + '원 · 잔액 ' + formatNum(remain) + '원';
        }
      } else {
        actualMsgEl.className = 'payment-sum-msg actual-sum-msg';
        actualMsgEl.innerHTML = '실제 수령 ' + formatNum(actualSum) + '원';
      }
    }
  }

  /**
   * 폼에서 모든 yearBudget의 plannedPayments + actualPayments 추출
   * 반환: { '0': { planned: [{date, amount}, ...], actual: [...] }, '1': {...} }
   */
  function getAllPaymentsFromForm() {
    var container = document.getElementById('payment-groups');
    if (!container) return {};
    var byIdx = {};

    function ensureIdx(idx) {
      if (!byIdx[idx]) byIdx[idx] = { planned: [], actual: [] };
      return byIdx[idx];
    }

    container.querySelectorAll('.planned-row').forEach(function (row) {
      var idx = row.getAttribute('data-yb-idx');
      if (idx == null) return;
      var date = ((row.querySelector('.pay-planned-date') || {}).value || '').trim();
      var amount = parseNum((row.querySelector('.pay-planned-amount') || {}).value);
      if (!date && !amount) return;
      var p = {};
      if (date) p.date = date;
      if (amount > 0) p.amount = amount;
      ensureIdx(idx).planned.push(p);
    });

    container.querySelectorAll('.actual-row').forEach(function (row) {
      var idx = row.getAttribute('data-yb-idx');
      if (idx == null) return;
      var date = ((row.querySelector('.pay-actual-date') || {}).value || '').trim();
      var amount = parseNum((row.querySelector('.pay-actual-amount') || {}).value);
      if (!date && !amount) return;
      var p = {};
      if (date) p.date = date;
      if (amount > 0) p.amount = amount;
      ensureIdx(idx).actual.push(p);
    });

    return byIdx;
  }

  // ===== 데이터 로드 =====

  // status 값에 따라 제출일 / 미제출 사유 입력란 표시/숨김
  function updateStatusConditionalInputs() {
    var statusEl = document.getElementById('project-status');
    var unsubWrap = document.getElementById('project-unsubmitted-wrap');
    if (!statusEl) return;
    var v = statusEl.value;
    if (unsubWrap) unsubWrap.style.display = (v === '미제출') ? '' : 'none';
  }

  function fillFormWithItem(item) {
    setFormValue('project-keywords',   item.keywords || item.keyword || item['키워드']);
    setFormValue('project-name',       item.projectName || item['과제명']);
    setFormValue('project-business',   item.business || item['사업명']);
    // 정부부처 → 전문기관 순서로 (전문기관은 부처에 따라 옵션이 결정됨)
    setDeptValue(item.department || item['부처'] || '');
    setInstitutionValue(item.institution || item['기관명'] || '');
    setFormValue('project-manager',    item.manager || item['책임자']);
    setFormValue('project-charge',     item.charge || item['담당자'] || '');

    // 참여 형태 로드
    var pType = item.participationType || '단독';
    var pTypeEl = document.querySelector('input[name="participation-type"][value="' + pType + '"]');
    if (pTypeEl) pTypeEl.checked = true;

    var cRole = item.consortiumRole || '';
    if (cRole) {
      var cRoleEl = document.querySelector('input[name="consortium-role"][value="' + cRole + '"]');
      if (cRoleEl) cRoleEl.checked = true;
    }
    setFormValue('consortium-partners', item.consortiumPartners || '');
    // 총 지원금 (컨소시엄 전체) — legacy: ourBudget 도 폴백
    var totalBudget = item.consortiumTotalBudget != null ? item.consortiumTotalBudget : (item.ourBudget != null ? item.ourBudget : '');
    setFormValue('consortium-total-budget', totalBudget !== '' ? String(totalBudget) : '');

    // 토글 + 비중 갱신은 끝에서 처리

    // 책임자 히스토리 (이전 책임자) 로드
    clearManagerHistory();
    var history = item.managerHistory || [];
    if (Array.isArray(history)) {
      history.forEach(function (h) { addManagerHistoryRow(h); });
    }

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
    updateParticipationVisibility();

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

    // 캘린더 분배 — 각 yearBudget의 calendarBreakdown에서 keepValues 구성
    var keepValues = {};
    years.forEach(function (yb, idx) {
      var cb = yb && yb.calendarBreakdown;
      if (cb && typeof cb === 'object') {
        Object.keys(cb).forEach(function (k) {
          var v = cb[k];
          if (v != null && v !== '') keepValues[idx + ':' + k] = formatNum(v);
        });
      }
    });
    renderCalendarBreakdown(keepValues);

    // 입금 일정 — plannedPayments + actualPayments 로드 (옛 payments 자동 마이그레이션)
    var paymentsByIdx = {};
    years.forEach(function (yb, idx) {
      if (yb) {
        paymentsByIdx[idx] = migratePayments(yb);
      }
    });
    renderPayments(paymentsByIdx);
  }

  function loadProject(items) {
    if (loaded) return;
    loaded = true;

    if (isNewMode) {
      // 빈 폼: 첫 연차 1개 미리 추가
      addYearRow();
      renderCalendarBreakdown();
      renderPayments();
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

    // 각 yearBudget별 캘린더 분배 추출
    var breakdownsByIdx = getCalendarBreakdownsFromForm();
    // 각 yearBudget별 입금 일정 추출 (예정/실제 분리)
    var paymentsByIdx = getAllPaymentsFromForm();

    var rows = tbodyEl.querySelectorAll('tr');
    rows.forEach(function (row, idx) {
      var s   = (row.querySelector('.yb-start')   || {}).value || '';
      var e   = (row.querySelector('.yb-end')     || {}).value || '';
      var sup = parseNum((row.querySelector('.yb-support') || {}).value);
      var cash = parseNum((row.querySelector('.yb-cash')   || {}).value);
      var ink  = parseNum((row.querySelector('.yb-inkind') || {}).value);
      var sub = sup + cash + ink;
      // 완전히 빈 행은 건너뜀
      if (!s && !e && sup === 0 && cash === 0 && ink === 0) return;
      var ybObj = { startDate: s, endDate: e, support: sup, cash: cash, inKind: ink, subtotal: sub };
      // 캘린더 분배 통합
      var cb = breakdownsByIdx[String(idx)];
      if (cb && Object.keys(cb).length) {
        ybObj.calendarBreakdown = cb;
      }
      // 입금 일정 통합 (예정/실제 분리, 옛 payments는 더이상 저장 안 함)
      var ps = paymentsByIdx[String(idx)];
      if (ps) {
        if (ps.planned && ps.planned.length) ybObj.plannedPayments = ps.planned;
        if (ps.actual && ps.actual.length) ybObj.actualPayments = ps.actual;
      }
      years.push(ybObj);
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
    var charge      = (document.getElementById('project-charge')      || {}).value || '';
    var div1El = document.querySelector('input[name="project-division1"]:checked');
    var division1 = div1El ? div1El.value : '';
    // division2(계속/신규)는 startDate 기준으로 자동 계산되므로 저장하지 않음

    // 참여 형태
    var pTypeEl = document.querySelector('input[name="participation-type"]:checked');
    var participationType = pTypeEl ? pTypeEl.value : '단독';
    var consortiumRole = '';
    var consortiumPartners = '';
    var consortiumTotalBudget = 0;
    if (participationType === '컨소') {
      var cRoleEl = document.querySelector('input[name="consortium-role"]:checked');
      consortiumRole = cRoleEl ? cRoleEl.value : '';
      consortiumPartners = ((document.getElementById('consortium-partners') || {}).value || '').trim();
      consortiumTotalBudget = parseNum((document.getElementById('consortium-total-budget') || {}).value || '0');
    }

    // 제출일은 모든 status에서 자유 입력 가능 (저장 시 형식 정규화)
    submitDate = formatDateInput(submitDate);
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
      managerHistory: getManagerHistoryFromForm(),
      charge: charge.trim(),
      participationType: participationType,
      consortiumRole: consortiumRole,
      consortiumPartners: consortiumPartners,
      consortiumTotalBudget: consortiumTotalBudget,
      isRd: isRd,
      division1: division1,
      // division2 (계속/신규) 는 startDate 기준 자동 판정 — 저장 안 함
      status: status,
      submitDate: submitDate,            // 항상 저장 (모든 status에서 입력 가능)
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
    var submitDate  = (document.getElementById('project-submit-date') || {}).value || '';
    var div1El = document.querySelector('input[name="project-division1"]:checked');

    // 유형(과제/지원사업/용역/기타) 필수
    if (!div1El) {
      alert('유형을 선택해 주세요.');
      var radioFirst = document.querySelector('input[name="project-division1"]');
      if (radioFirst) radioFirst.focus();
      return false;
    }

    // 제출일 필수
    if (!submitDate.trim()) {
      alert('제출일을 입력해 주세요.');
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

    // 저장 시작 — saveProjects가 Promise를 반환하면 그 완료를 기다림
    var savePromise;
    try {
      savePromise = svc.saveProjects(items);
    } catch (err) {
      console.error('저장 실패:', err);
      alert('저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
      return;
    }

    // 저장 완료 후 redirect (Firestore 비동기 저장이 끝나기 전 페이지 이동 방지)
    Promise.resolve(savePromise).then(function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
      window.location.href = 'projects.html';
    }).catch(function (err) {
      console.error('저장 실패:', err);
      var msg = (err && err.message) ? err.message : '알 수 없는 오류';
      alert('저장 중 오류가 발생했습니다.\n\n' + msg + '\n\n다시 시도해 주세요.');
    });
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

    // 삭제 시작 — Promise 완료 후 redirect
    var savePromise;
    try {
      savePromise = svc.saveProjects(items);
    } catch (err) {
      console.error('삭제 실패:', err);
      alert('삭제 중 오류가 발생했습니다. 다시 시도해 주세요.');
      return;
    }

    Promise.resolve(savePromise).then(function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
      window.location.href = 'projects.html';
    }).catch(function (err) {
      console.error('삭제 실패:', err);
      var msg = (err && err.message) ? err.message : '알 수 없는 오류';
      alert('삭제 중 오류가 발생했습니다.\n\n' + msg + '\n\n다시 시도해 주세요.');
    });
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
    var deptManageBtn   = document.getElementById('project-department-manage-btn');
    var instManageBtn   = document.getElementById('project-institution-manage-btn');
    var deptManagePanel = document.getElementById('project-department-manage-panel');
    var instManagePanel = document.getElementById('project-institution-manage-panel');

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
        // 전문기관 패널이 열려있으면 갱신
        if (instManagePanel && instManagePanel.style.display !== 'none') {
          renderInstManagePanel();
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
            if (deptManagePanel && deptManagePanel.style.display !== 'none') renderDeptManagePanel();
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
            if (instManagePanel && instManagePanel.style.display !== 'none') renderInstManagePanel();
          } else if (!dept) {
            alert('정부부처를 먼저 선택해 주세요.');
          }
        } else if (e.key === 'Escape') {
          instCustom.style.display = 'none';
        }
      });
    }

    // ===== 부처 관리 패널 =====
    function renderDeptManagePanel() {
      if (!deptManagePanel) return;
      var html = '';
      // 모든 부처 항목 (default + custom)
      Object.keys(agencyMap).forEach(function (name) {
        var isDefault = DEFAULT_AGENCIES.hasOwnProperty(name);
        html += '<div class="dmp-item' + (isDefault ? ' dmp-item--default' : '') + '">';
        html +=   '<span class="dmp-item-name">' + escapeHtml(name) + '</span>';
        if (isDefault) {
          html += '<span class="dmp-item-tag">기본</span>';
        } else {
          html += '<button type="button" class="dmp-del" data-name="' + escapeHtml(name) + '" title="삭제">✕</button>';
        }
        html += '</div>';
      });
      html += '<div class="dmp-divider"></div>';
      html += '<div class="dmp-add-row">';
      html += '<input type="text" class="dmp-add-input" id="dmp-dept-add-input" placeholder="새 부처명">';
      html += '<button type="button" class="dmp-add-btn" id="dmp-dept-add-btn">+ 추가</button>';
      html += '</div>';
      deptManagePanel.innerHTML = html;

      // 삭제 핸들러
      deptManagePanel.querySelectorAll('.dmp-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-name');
          if (!name || DEFAULT_AGENCIES.hasOwnProperty(name)) return;
          if (!confirm('"' + name + '" 부처를 삭제할까요?\n(이 부처의 전문기관 목록도 같이 삭제됩니다)')) return;
          delete agencyMap[name];
          rebuildDeptSelect();
          if (deptSel && deptSel.value === name) {
            deptSel.value = '';
            rebuildInstSelect(null);
          }
          deleteCustomAgency(name);
          renderDeptManagePanel();
        });
      });

      // 추가 핸들러
      var addInput = document.getElementById('dmp-dept-add-input');
      var addBtn = document.getElementById('dmp-dept-add-btn');
      function addDept() {
        var newName = (addInput.value || '').trim();
        if (!newName) return;
        if (agencyMap[newName]) { alert('이미 존재하는 부처입니다.'); return; }
        agencyMap[newName] = [];
        rebuildDeptSelect();
        saveCustomAgency(newName);
        addInput.value = '';
        renderDeptManagePanel();
      }
      if (addBtn) addBtn.addEventListener('click', addDept);
      if (addInput) addInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addDept(); }
      });
    }

    // ===== 전문기관 관리 패널 =====
    function renderInstManagePanel() {
      if (!instManagePanel) return;
      var dept = deptSel ? deptSel.value : '';
      if (!dept || dept === '__add__') {
        instManagePanel.innerHTML = '<div class="dmp-empty">정부부처를 먼저 선택하세요</div>';
        return;
      }
      var insts = agencyMap[dept] || [];
      var defaults = DEFAULT_AGENCIES[dept] || [];
      var html = '<div style="font-size:0.78rem; color:#6b7280; margin-bottom:0.4rem;">현재: ' + escapeHtml(dept) + '</div>';
      if (insts.length === 0) {
        html += '<div class="dmp-empty">등록된 전문기관 없음</div>';
      } else {
        insts.forEach(function (instName) {
          var isDefault = defaults.indexOf(instName) >= 0;
          html += '<div class="dmp-item' + (isDefault ? ' dmp-item--default' : '') + '">';
          html +=   '<span class="dmp-item-name">' + escapeHtml(instName) + '</span>';
          if (isDefault) {
            html += '<span class="dmp-item-tag">기본</span>';
          } else {
            html += '<button type="button" class="dmp-del" data-name="' + escapeHtml(instName) + '" title="삭제">✕</button>';
          }
          html += '</div>';
        });
      }
      html += '<div class="dmp-divider"></div>';
      html += '<div class="dmp-add-row">';
      html += '<input type="text" class="dmp-add-input" id="dmp-inst-add-input" placeholder="새 전문기관명">';
      html += '<button type="button" class="dmp-add-btn" id="dmp-inst-add-btn">+ 추가</button>';
      html += '</div>';
      instManagePanel.innerHTML = html;

      // 삭제 핸들러
      instManagePanel.querySelectorAll('.dmp-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-name');
          if (!name) return;
          if ((DEFAULT_AGENCIES[dept] || []).indexOf(name) >= 0) return;
          if (!confirm('"' + name + '" 전문기관을 "' + dept + '"에서 삭제할까요?')) return;
          var arr = agencyMap[dept] || [];
          var idx = arr.indexOf(name);
          if (idx >= 0) arr.splice(idx, 1);
          rebuildInstSelect(dept);
          saveCustomAgency(dept);
          renderInstManagePanel();
        });
      });

      // 추가 핸들러
      var addInput = document.getElementById('dmp-inst-add-input');
      var addBtn = document.getElementById('dmp-inst-add-btn');
      function addInst() {
        var newName = (addInput.value || '').trim();
        if (!newName) return;
        if (!agencyMap[dept]) agencyMap[dept] = [];
        if (agencyMap[dept].indexOf(newName) >= 0) { alert('이미 존재하는 전문기관입니다.'); return; }
        agencyMap[dept].push(newName);
        rebuildInstSelect(dept);
        saveCustomAgency(dept);
        addInput.value = '';
        renderInstManagePanel();
      }
      if (addBtn) addBtn.addEventListener('click', addInst);
      if (addInput) addInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addInst(); }
      });
    }

    // 토글 버튼
    if (deptManageBtn) {
      deptManageBtn.addEventListener('click', function () {
        var open = deptManagePanel.style.display === 'none';
        if (open) {
          renderDeptManagePanel();
          deptManagePanel.style.display = '';
          deptManageBtn.classList.add('active');
        } else {
          deptManagePanel.style.display = 'none';
          deptManageBtn.classList.remove('active');
        }
      });
    }
    if (instManageBtn) {
      instManageBtn.addEventListener('click', function () {
        var open = instManagePanel.style.display === 'none';
        if (open) {
          renderInstManagePanel();
          instManagePanel.style.display = '';
          instManageBtn.classList.add('active');
        } else {
          instManagePanel.style.display = 'none';
          instManageBtn.classList.remove('active');
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

  function deleteCustomAgency(dept) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    if (!dept) return;
    try {
      // FieldValue.delete() 로 해당 키 제거
      var update = {};
      update['customAgencies.' + dept] = firebase.firestore.FieldValue.delete();
      firebase.firestore().collection('config').doc('agencies').update(update)
        .catch(function (e) {
          console.warn('[project-detail] custom agency 삭제 실패:', e);
        });
    } catch (e) {
      console.warn('[project-detail] firestore delete 실패:', e);
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

    // 진행 여부 변경 → 미제출 사유 입력란 가시성 토글
    var statusSelectEl = document.getElementById('project-status');
    if (statusSelectEl) {
      statusSelectEl.addEventListener('change', updateStatusConditionalInputs);
    }
    // 신규 등록 모드에서도 초기 상태 적용 (초기엔 모두 숨김)
    updateStatusConditionalInputs();

    // 제출일 자유 입력 + blur 시 자동 YYYY-MM-DD 포맷
    var submitDateEl = document.getElementById('project-submit-date');
    if (submitDateEl) {
      submitDateEl.addEventListener('blur', function () {
        submitDateEl.value = formatDateInput(submitDateEl.value);
      });
    }

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

    if (addYearBtn) addYearBtn.addEventListener('click', function () {
      addYearRow();
      renderCalendarBreakdown();
      renderPayments();
    });

    // 캘린더 분배: 토글
    var calToggle = document.getElementById('cal-breakdown-toggle');
    var calWrap   = document.getElementById('cal-breakdown-wrap');
    if (calToggle && calWrap) {
      calToggle.addEventListener('click', function () {
        var expanded = calWrap.classList.toggle('expanded');
        calToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (expanded) renderCalendarBreakdown();  // 펼칠 때 최신 yearBudget으로 갱신
      });
      calToggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); calToggle.click(); }
      });
    }
    // 자동값 다시 계산 (yearBudgets 변경 후 placeholder 갱신)
    var calRefreshBtn = document.getElementById('cal-breakdown-refresh');
    if (calRefreshBtn) calRefreshBtn.addEventListener('click', function () {
      renderCalendarBreakdown();
    });
    // 전체 비우기 (모든 사용자 입력값 제거 → 자동 비례 전체 적용)
    var calClearBtn = document.getElementById('cal-breakdown-clear');
    if (calClearBtn) calClearBtn.addEventListener('click', function () {
      renderCalendarBreakdown({});  // 빈 객체 = 모두 빈 칸
    });

    // yearBudget 행의 시작/종료/지원금이 바뀌면 캘린더 분배 + 입금 일정 그룹 헤더 자동 갱신
    if (tbodyEl) {
      tbodyEl.addEventListener('blur', function (e) {
        if (e.target && e.target.matches && e.target.matches('.yb-start, .yb-end, .yb-support')) {
          // 사용자가 입력한 값은 보존, placeholder/헤더만 갱신
          if (calWrap && calWrap.classList.contains('expanded')) {
            renderCalendarBreakdown();
          }
          renderPayments();
        }
      }, true);
    }

    // 이전 책임자 추가 버튼
    var addManagerHistoryBtn = document.getElementById('add-manager-history-btn');
    if (addManagerHistoryBtn) {
      addManagerHistoryBtn.addEventListener('click', function () { addManagerHistoryRow(); });
    }

    // 참여 형태 라디오 → 컨소시엄 입력란 토글
    document.querySelectorAll('input[name="participation-type"]').forEach(function (r) {
      r.addEventListener('change', function () {
        updateParticipationVisibility();
        updateBudgetPercent();
      });
    });
    // 총 지원금 입력 → 비중 갱신
    var consortiumTotalEl = document.getElementById('consortium-total-budget');
    if (consortiumTotalEl) {
      consortiumTotalEl.addEventListener('input', updateBudgetPercent);
    }
    // 초기 상태
    updateParticipationVisibility();
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

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

  function autoSupportSumInYear(yearBudgets, year) {
    var sum = 0;
    if (!Array.isArray(yearBudgets)) return 0;
    yearBudgets.forEach(function (yb) { sum += autoSupportInYear(yb, year); });
    return sum;
  }

  function getCalendarYearsForBudgets(yearBudgets) {
    if (!Array.isArray(yearBudgets) || !yearBudgets.length) return [];
    var minY = null, maxY = null;
    yearBudgets.forEach(function (yb) {
      var s = (yb.startDate || '').toString().slice(0, 4);
      var e = (yb.endDate || '').toString().slice(0, 4);
      if (s) {
        var ys = parseInt(s, 10);
        if (!isNaN(ys)) { if (minY === null || ys < minY) minY = ys; if (maxY === null || ys > maxY) maxY = ys; }
      }
      if (e) {
        var ye = parseInt(e, 10);
        if (!isNaN(ye)) { if (minY === null || ye < minY) minY = ye; if (maxY === null || ye > maxY) maxY = ye; }
      }
    });
    if (minY === null || maxY === null) return [];
    var years = [];
    for (var y = minY; y <= maxY; y++) years.push(y);
    return years;
  }

  function onDateInput(e) {
    var inp = e.target;
    var formatted = formatDateInput(inp.value);
    inp.value = formatted;
    try { inp.setSelectionRange(formatted.length, formatted.length); } catch (err) {}
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

  var editingId = null;
  var isNewMode = true;
  var loaded = false;
  var unsubscribe = null;
  var tbodyEl, totalEl, headerRowEl;

  // 현재 분류가 '용역'인지 — 예산 입력 모드 결정용
  function isServiceMode() {
    var checked = document.querySelector('input[name="project-division1"]:checked');
    return checked && checked.value === '용역';
  }

  function readURL() {
    var params = new URLSearchParams(location.search);
    var id = params.get('id');
    if (id) { editingId = id; isNewMode = false; }
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

  function formatDateInput(val) {
    var s = String(val || '').replace(/\D/g, '');
    if (s.length >= 8) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    if (s.length >= 6) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6);
    if (s.length >= 4) return s.slice(0, 4) + '-' + s.slice(4);
    return s;
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

  // ===== 테이블 헤더 갱신 (모드별) =====
  function updateBudgetTableHeader() {
    if (!headerRowEl) return;
    var serviceMode = isServiceMode();
    if (serviceMode) {
      headerRowEl.innerHTML =
        '<th style="width:50px">연차</th>' +
        '<th style="min-width:120px">시작일</th>' +
        '<th style="min-width:120px">종료일</th>' +
        '<th style="min-width:130px">총액 (VAT 포함)</th>' +
        '<th style="min-width:130px">공급가 (자동)</th>' +
        '<th style="min-width:130px">부가세 (자동)</th>' +
        '<th style="min-width:120px">소계</th>' +
        '<th style="width:50px"></th>';
    } else {
      headerRowEl.innerHTML =
        '<th style="width:50px">연차</th>' +
        '<th style="min-width:120px">시작일</th>' +
        '<th style="min-width:120px">종료일</th>' +
        '<th style="min-width:130px">지원금</th>' +
        '<th style="min-width:130px">현금</th>' +
        '<th style="min-width:130px">현물</th>' +
        '<th style="min-width:120px">소계</th>' +
        '<th style="width:50px"></th>';
    }
  }

  function updateRowSubtotal(row) {
    if (isServiceMode()) {
      // 용역 모드: 총액 입력 → 공급가/부가세 자동 계산
      var total = parseNum((row.querySelector('.yb-total') || {}).value);
      var supply = Math.round(total / 1.1);     // 공급가 = 총액 / 1.1
      var vat = total - supply;                  // 부가세 = 총액 - 공급가
      var supplyCell = row.querySelector('.yb-supply');
      var vatCell = row.querySelector('.yb-vat');
      if (supplyCell) supplyCell.textContent = formatNum(supply);
      if (vatCell) vatCell.textContent = formatNum(vat);
      var subEl = row.querySelector('.yb-subtotal');
      if (subEl) subEl.textContent = formatNum(supply); // 소계는 공급가 (통계용)
    } else {
      var support = parseNum((row.querySelector('.yb-support') || {}).value);
      var cash    = parseNum((row.querySelector('.yb-cash')    || {}).value);
      var inKind  = parseNum((row.querySelector('.yb-inkind')  || {}).value);
      var sub = support + cash + inKind;
      var subEl2 = row.querySelector('.yb-subtotal');
      if (subEl2) subEl2.textContent = formatNum(sub);
    }
    updateTotalDisplay();
  }

  function updateTotalDisplay() {
    if (!totalEl || !tbodyEl) return;
    var rows = tbodyEl.querySelectorAll('tr');
    if (isServiceMode()) {
      var totalSum = 0, supplySum = 0, vatSum = 0;
      rows.forEach(function (r) {
        var t = parseNum((r.querySelector('.yb-total') || {}).value || '0');
        totalSum += t;
        var sup = Math.round(t / 1.1);
        supplySum += sup;
        vatSum += (t - sup);
      });
      totalEl.innerHTML =
        '<span style="color:#6b7280; font-weight:400; margin-right:0.5rem;">' +
          '공급가 <strong style="color:#111;">' + formatNum(supplySum) + '</strong>' +
          ' &nbsp;|&nbsp; ' +
          '부가세 <strong style="color:#111;">' + formatNum(vatSum) + '</strong>' +
        '</span> &nbsp;&nbsp; ' +
        '총액 (VAT 포함): <strong>' + formatNum(totalSum) + '</strong>원';
    } else {
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
    }
    updateBudgetPercent();
  }

  function updateBudgetPercent() {
    var hintEl  = document.getElementById('our-budget-percent');
    var totalEl_ = document.getElementById('consortium-total-budget');
    if (!hintEl || !totalEl_) return;
    var grandTotal = parseNum(totalEl_.value);

    var ourSupport = 0;
    if (tbodyEl) {
      tbodyEl.querySelectorAll('tr').forEach(function (r) {
        if (isServiceMode()) {
          // 용역 모드는 컨소시엄 잘 안 쓰지만 호환을 위해 공급가 합산
          var t = parseNum((r.querySelector('.yb-total') || {}).value || '0');
          ourSupport += Math.round(t / 1.1);
        } else {
          ourSupport += parseNum((r.querySelector('.yb-support') || {}).value || '0');
        }
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

  // ===== 책임자 히스토리 =====
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
    row.querySelector('.mh-del').addEventListener('click', function () { row.remove(); });
    container.appendChild(row);
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
      if (name) list.push({ name: name, startDate: startDate.trim(), endDate: endDate.trim() });
    });
    return list;
  }

  // ===== 연차 행 생성 — 모드별로 다른 셀 =====
  function addYearRow(values) {
    if (!tbodyEl) return null;
    var cnt = tbodyEl.querySelectorAll('tr').length + 1;
    var tr = document.createElement('tr');
    var serviceMode = isServiceMode();

    if (serviceMode) {
      // 용역 모드: 시작일 / 종료일 / 총액(입력) / 공급가(자동) / 부가세(자동) / 소계
      tr.innerHTML =
        '<td class="yb-num">' + cnt + '</td>' +
        '<td><input type="text" class="yb-start yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td><input type="text" class="yb-end yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-total" placeholder="0 (VAT 포함)" inputmode="numeric"></td>' +
        '<td class="yb-amount yb-supply" style="background:#f8fafc; color:#475569; padding:0.6rem 0.75rem;">0</td>' +
        '<td class="yb-amount yb-vat" style="background:#f8fafc; color:#475569; padding:0.6rem 0.75rem;">0</td>' +
        '<td class="yb-subtotal">0</td>' +
        '<td class="yb-del-cell"><button type="button" class="yb-del" aria-label="연차 삭제">×</button></td>';
    } else {
      // 과제 모드: 시작일 / 종료일 / 지원금 / 현금 / 현물 / 소계
      tr.innerHTML =
        '<td class="yb-num">' + cnt + '</td>' +
        '<td><input type="text" class="yb-start yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td><input type="text" class="yb-end yb-date" placeholder="YYYY-MM-DD" maxlength="10" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-support" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-cash" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-amount"><input type="text" class="yb-inkind" placeholder="0" inputmode="numeric"></td>' +
        '<td class="yb-subtotal">0</td>' +
        '<td class="yb-del-cell"><button type="button" class="yb-del" aria-label="연차 삭제">×</button></td>';
    }

    tr.querySelectorAll('.yb-start, .yb-end').forEach(function (inp) {
      inp.addEventListener('blur', function () {
        var v = inp.value.replace(/\D/g, '');
        if (v.length === 8) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
        else if (v.length === 6) inp.value = v.slice(0, 4) + '-' + v.slice(4, 6);
        else if (v.length === 4) inp.value = v.slice(0, 4);
        else if (v.length === 0) inp.value = '';
        else if (inp.value.indexOf('-') < 0) inp.value = v;
      });
    });
    if (serviceMode) {
      tr.querySelectorAll('.yb-total').forEach(function (inp) {
        inp.addEventListener('input', onAmountInput);
      });
    } else {
      tr.querySelectorAll('.yb-support, .yb-cash, .yb-inkind').forEach(function (inp) {
        inp.addEventListener('input', onAmountInput);
      });
    }
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
      var inpStart = tr.querySelector('.yb-start');
      var inpEnd   = tr.querySelector('.yb-end');
      if (inpStart) inpStart.value = s;
      if (inpEnd)   inpEnd.value   = e;

      if (serviceMode) {
        // 용역 모드: 저장된 total 또는 support×1.1
        var totalAmt = values.totalIncludingVat != null
          ? Number(values.totalIncludingVat)
          : (values.support ? Math.round(Number(values.support) * 1.1) : 0);
        var inpTotal = tr.querySelector('.yb-total');
        if (inpTotal) inpTotal.value = totalAmt ? formatNum(totalAmt) : '';
      } else {
        var sup  = values.support != null ? values.support : 0;
        var cash = values.cash != null ? values.cash : 0;
        var ink  = values.inKind != null ? values.inKind : 0;
        var inpSup   = tr.querySelector('.yb-support');
        var inpCash  = tr.querySelector('.yb-cash');
        var inpInk   = tr.querySelector('.yb-inkind');
        if (inpSup)   inpSup.value   = sup  ? formatNum(sup)  : '';
        if (inpCash)  inpCash.value  = cash ? formatNum(cash) : '';
        if (inpInk)   inpInk.value   = ink  ? formatNum(ink)  : '';
      }
    }

    updateRowSubtotal(tr);
    return tr;
  }

  // 모드 전환 시 전체 행 재생성 (기존 데이터 보존)
  function rebuildBudgetTable() {
    if (!tbodyEl) return;
    // 현재 행 데이터 추출
    var serviceMode = isServiceMode();
    var oldRows = [];
    tbodyEl.querySelectorAll('tr').forEach(function (r) {
      var startDate = (r.querySelector('.yb-start') || {}).value || '';
      var endDate = (r.querySelector('.yb-end') || {}).value || '';
      // 기존 모드에 따라 다른 필드 추출
      var totalInp = r.querySelector('.yb-total');
      var supInp = r.querySelector('.yb-support');
      var cashInp = r.querySelector('.yb-cash');
      var inkInp = r.querySelector('.yb-inkind');

      var data = { startDate: startDate, endDate: endDate };
      if (totalInp) {
        var tv = parseNum(totalInp.value);
        data.totalIncludingVat = tv;
        data.support = Math.round(tv / 1.1);
      } else {
        data.support = parseNum((supInp || {}).value || '0');
        data.cash    = parseNum((cashInp || {}).value || '0');
        data.inKind  = parseNum((inkInp || {}).value || '0');
        data.totalIncludingVat = Math.round(data.support * 1.1);  // 모드 전환 시 변환용
      }
      oldRows.push(data);
    });

    // 헤더 갱신
    updateBudgetTableHeader();
    // tbody 비우고 새 모드로 재생성
    tbodyEl.innerHTML = '';
    if (oldRows.length === 0) {
      addYearRow();
    } else {
      oldRows.forEach(function (d) { addYearRow(d); });
    }
    updateTotalDisplay();
  }

  // ===== 캘린더 분배 =====
  function readCurrentYearBudgets() {
    var out = [];
    if (!tbodyEl) return out;
    tbodyEl.querySelectorAll('tr').forEach(function (row) {
      var s   = (row.querySelector('.yb-start')   || {}).value || '';
      var e   = (row.querySelector('.yb-end')     || {}).value || '';
      var sup;
      if (isServiceMode()) {
        var t = parseNum((row.querySelector('.yb-total') || {}).value);
        sup = Math.round(t / 1.1);  // 캘린더 분배는 공급가 기준
      } else {
        sup = parseNum((row.querySelector('.yb-support') || {}).value);
      }
      out.push({ startDate: s, endDate: e, support: sup });
    });
    return out;
  }

  function getYearsInBudget(yb) {
    if (!yb || !yb.startDate || !yb.endDate) return [];
    var ys = parseInt((yb.startDate || '').slice(0, 4), 10);
    var ye = parseInt((yb.endDate || '').slice(0, 4), 10);
    if (isNaN(ys) || isNaN(ye)) return [];
    var arr = [];
    for (var y = ys; y <= ye; y++) arr.push(y);
    return arr;
  }

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

  function renderCalendarBreakdown(keepValues) {
    var container = document.getElementById('cal-breakdown-groups');
    if (!container) return;
    if (!keepValues) {
      keepValues = {};
      container.querySelectorAll('input.cal-budget-input').forEach(function (inp) {
        var key = inp.getAttribute('data-yb-idx') + ':' + inp.getAttribute('data-year');
        if (inp.value && inp.value.trim() !== '') keepValues[key] = inp.value;
      });
    }
    var ybs = readCurrentYearBudgets();
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

    container.querySelectorAll('input.cal-budget-input').forEach(function (inp) {
      inp.addEventListener('blur', function () {
        var raw = (inp.value || '').trim();
        if (raw === '') { inp.value = ''; }
        else {
          var n = parseNum(inp.value);
          inp.value = formatNum(n);
        }
        var groupEl = inp.closest('.cal-breakdown-group');
        updateBreakdownSum(groupEl);
      });
    });
    container.querySelectorAll('.cal-breakdown-group').forEach(function (g) {
      updateBreakdownSum(g);
    });
  }

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
      if (trimmed === '') return;
      if (!byIdx[idx]) byIdx[idx] = {};
      byIdx[idx][y] = parseNum(trimmed);
    });
    return byIdx;
  }

  // ===== 입금 일정 (기존 그대로 — 공급가 기준 동작) =====
  function migratePayments(yb) {
    var planned = Array.isArray(yb.plannedPayments) ? yb.plannedPayments.slice() : [];
    var actual = Array.isArray(yb.actualPayments) ? yb.actualPayments.slice() : [];
    if (planned.length === 0 && actual.length === 0 && Array.isArray(yb.payments)) {
      yb.payments.forEach(function (p) {
        if (p.plannedDate || (p.plannedAmount && p.plannedAmount > 0)) {
          planned.push({ date: p.plannedDate || '', amount: Number(p.plannedAmount || 0) });
        }
        if (p.actualDate || (p.actualAmount && p.actualAmount > 0)) {
          actual.push({ date: p.actualDate || '', amount: Number(p.actualAmount || 0) });
        }
      });
    }
    return { planned: planned, actual: actual };
  }

  function renderPayments(initialByIdx) {
    var container = document.getElementById('payment-groups');
    if (!container) return;
    var ybs = readCurrentYearBudgets();
    var validYbs = ybs
      .map(function (yb, idx) { return { yb: yb, idx: idx }; })
      .filter(function (x) { return x.yb.startDate && x.yb.endDate; });
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
        header + plannedSection + actualSection +
        '<div class="payment-quarterly-wrap"></div>' +
      '</div>';
    }).join('');
    bindPaymentEvents();
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
  function getQuarterLabel(dateStr) {
    if (!dateStr) return '-';
    var m = parseInt(String(dateStr).slice(5, 7), 10);
    if (isNaN(m) || m < 1 || m > 12) return '-';
    return Math.ceil(m / 3) + 'Q';
  }
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
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function autoDistributeQuarterly(yb) {
    if (!yb || !yb.startDate || !yb.endDate) return [];
    var support = Number(yb.support || 0);
    if (!support || support <= 0) return [];
    var sd = parseLocalDate(yb.startDate);
    var ed = parseLocalDate(yb.endDate);
    if (!sd || !ed || ed < sd) return [];
    var quarters = [];
    var year = sd.getFullYear();
    var qIdx = Math.floor(sd.getMonth() / 3);
    while (true) {
      var qEndMonth = (qIdx + 1) * 3;
      var qEnd = new Date(year, qEndMonth, 0);
      var payDate = qEnd <= ed ? qEnd : ed;
      if (qEnd >= sd) quarters.push({ date: formatLocalDate(payDate) });
      qIdx++;
      if (qIdx > 3) { qIdx = 0; year++; }
      var nextQStart = new Date(year, qIdx * 3, 1);
      if (nextQStart > ed) break;
    }
    if (!quarters.length) return [];
    var n = quarters.length;
    var perQ = Math.floor(support / n / 1000) * 1000;
    var partialSum = perQ * (n - 1);
    quarters.forEach(function (q, i) {
      q.amount = (i < n - 1) ? perQ : (support - partialSum);
    });
    return quarters;
  }
  function computeQuarterlySummary(planned, actual) {
    var quarters = {};
    function ensureBin(y, q) {
      var key = y + '-Q' + q;
      if (!quarters[key]) quarters[key] = { year: parseInt(y, 10), q: q, planned: 0, actual: 0, plannedCnt: 0, actualCnt: 0 };
      return quarters[key];
    }
    (planned || []).forEach(function (p) {
      if (!p.date) return;
      var y = p.date.toString().slice(0, 4);
      var m = parseInt(p.date.toString().slice(5, 7), 10);
      if (!y || isNaN(m) || m < 1) return;
      var bin = ensureBin(y, Math.ceil(m / 3));
      var amt = Number(p.amount || 0);
      if (amt > 0) { bin.planned += amt; bin.plannedCnt += 1; }
    });
    (actual || []).forEach(function (p) {
      if (!p.date) return;
      var y = p.date.toString().slice(0, 4);
      var m = parseInt(p.date.toString().slice(5, 7), 10);
      if (!y || isNaN(m) || m < 1) return;
      var bin = ensureBin(y, Math.ceil(m / 3));
      var amt = Number(p.amount || 0);
      if (amt > 0) { bin.actual += amt; bin.actualCnt += 1; }
    });
    return Object.keys(quarters).sort().map(function (k) { return quarters[k]; });
  }
  function renderQuarterlyHtml(quarters) {
    if (!quarters.length) return '<div class="quarterly-empty">입금 일정을 입력하면 분기별 요약이 자동 표시됩니다.</div>';
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
      rowCount += '<td' + (countOk ? ' class="q-ok"' : '') + '>' + q.actualCnt + '/' + q.plannedCnt + (countOk ? ' ✓' : '') + '</td>';
      var diff = q.planned - q.actual;
      rowDiff += '<td' + (diff > 0 ? ' class="q-diff-warn"' : '') + '>' + formatNum(diff) + '</td>';
      totals.planned += q.planned; totals.actual += q.actual;
      totals.plannedCnt += q.plannedCnt; totals.actualCnt += q.actualCnt;
    });
    head += '<th>합계</th></tr>';
    rowPlanned += '<td><strong>' + formatNum(totals.planned) + '</strong></td></tr>';
    rowActual  += '<td><strong>' + (totals.actual > 0 ? formatNum(totals.actual) : '-') + '</strong></td></tr>';
    var totalCountOk = totals.actualCnt === totals.plannedCnt && totals.plannedCnt > 0;
    rowCount   += '<td' + (totalCountOk ? ' class="q-ok"' : '') + '><strong>' + totals.actualCnt + '/' + totals.plannedCnt + (totalCountOk ? ' ✓' : '') + '</strong></td></tr>';
    var totalDiff = totals.planned - totals.actual;
    rowDiff    += '<td><strong' + (totalDiff > 0 ? ' class="q-diff-warn"' : '') + '>' + formatNum(totalDiff) + '</strong></td></tr>';
    return '<table class="quarterly-summary"><thead>' + head + '</thead><tbody>' + rowPlanned + rowActual + rowCount + rowDiff + '</tbody></table>';
  }
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
    if (v.length === 8) inp.value = v.slice(0,4) + '-' + v.slice(4,6) + '-' + v.slice(6,8);
  }
  function bindPaymentEvents() {
    var container = document.getElementById('payment-groups');
    if (!container) return;
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
        var existingRows = container.querySelectorAll('.payment-group[data-yb-idx="' + idx + '"] .planned-row');
        if (existingRows.length > 0) {
          if (!confirm('이 연차의 기존 예정 입금 ' + existingRows.length + '건이 모두 삭제되고 새로 채워집니다. 진행할까요?')) return;
        }
        var quarters = autoDistributeQuarterly(yb);
        if (!quarters.length) { alert('분배할 분기를 계산할 수 없습니다. 시작일/종료일을 확인하세요.'); return; }
        var allPays = getAllPaymentsFromForm();
        if (!allPays[idx]) allPays[idx] = { planned: [], actual: [] };
        allPays[idx].planned = quarters;
        renderPayments(allPays);
      };
    });
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
    container.querySelectorAll('.pay-del-btn').forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest('.payment-row');
        var group = btn.closest('.payment-group');
        if (row) row.remove();
        if (group) { updatePaymentSum(group); updateQuarterlySummary(group); }
      };
    });
    container.querySelectorAll('input.pay-amount').forEach(function (inp) {
      inp.onblur = function () {
        var n = parseNum(inp.value);
        inp.value = n > 0 ? formatNum(n) : '';
        var group = inp.closest('.payment-group');
        if (group) { updatePaymentSum(group); updateQuarterlySummary(group); }
      };
    });
    container.querySelectorAll('input.pay-date').forEach(function (inp) {
      inp.onblur = function () {
        autoFormatDateOnBlur(inp);
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
    var plannedSum = 0;
    groupEl.querySelectorAll('.planned-row .pay-planned-amount').forEach(function (inp) {
      plannedSum += parseNum(inp.value);
    });
    var actualSum = 0;
    groupEl.querySelectorAll('.actual-row .pay-actual-amount').forEach(function (inp) {
      actualSum += parseNum(inp.value);
    });
    var plannedMsgEl = groupEl.querySelector('.planned-sum-msg');
    if (plannedMsgEl) {
      if (plannedSum === 0) { plannedMsgEl.className = 'payment-sum-msg planned-sum-msg'; plannedMsgEl.innerHTML = ''; }
      else if (support > 0) {
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
    var actualMsgEl = groupEl.querySelector('.actual-sum-msg');
    if (actualMsgEl) {
      if (actualSum === 0) { actualMsgEl.className = 'payment-sum-msg actual-sum-msg'; actualMsgEl.innerHTML = ''; }
      else if (plannedSum > 0) {
        var remain = plannedSum - actualSum;
        if (remain === 0) {
          actualMsgEl.className = 'payment-sum-msg actual-sum-msg payment-sum-ok';
          actualMsgEl.innerHTML = '✓ 실제 수령 ' + formatNum(actualSum) + '원 (전액 수령 완료)';
        } else if (remain < 0) {
          actualMsgEl.className = 'payment-sum-msg actual-sum-msg payment-sum-error';
          actualMsgEl.innerHTML = '⚠️ 실제 수령 ' + formatNum(actualSum) + '원이 예정 ' + formatNum(plannedSum) + '원보다 ' + formatNum(-remain) + '원 많습니다';
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
  function getAllPaymentsFromForm() {
    var container = document.getElementById('payment-groups');
    if (!container) return {};
    var byIdx = {};
    function ensureIdx(idx) { if (!byIdx[idx]) byIdx[idx] = { planned: [], actual: [] }; return byIdx[idx]; }
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
    setDeptValue(item.department || item['부처'] || '');
    setInstitutionValue(item.institution || item['기관명'] || '');
    setFormValue('project-manager',    item.manager || item['책임자']);
    setFormValue('project-charge',     item.charge || item['담당자'] || '');

    var pType = item.participationType || '단독';
    var pTypeEl = document.querySelector('input[name="participation-type"][value="' + pType + '"]');
    if (pTypeEl) pTypeEl.checked = true;

    var cRole = item.consortiumRole || '';
    if (cRole) {
      var cRoleEl = document.querySelector('input[name="consortium-role"][value="' + cRole + '"]');
      if (cRoleEl) cRoleEl.checked = true;
    }
    setFormValue('consortium-partners', item.consortiumPartners || '');
    var totalBudget = item.consortiumTotalBudget != null ? item.consortiumTotalBudget : (item.ourBudget != null ? item.ourBudget : '');
    setFormValue('consortium-total-budget', totalBudget !== '' ? String(totalBudget) : '');

    clearManagerHistory();
    var history = item.managerHistory || [];
    if (Array.isArray(history)) history.forEach(function (h) { addManagerHistoryRow(h); });

    var savedStatus = item.status || item['진행 여부'] || '';
    var statusNorm = String(savedStatus).replace(/\s/g, '');
    if (statusNorm === '수행중' || statusNorm === '수행') savedStatus = '수행';
    if (statusNorm === '대기') savedStatus = '예정';
    setFormValue('project-status', savedStatus);

    setFormValue('project-submit-date', item.submitDate || item['제출일'] || '');
    setFormValue('project-unsubmitted-reason', item.unsubmittedReason || item['미제출 사유'] || '');

    updateStatusConditionalInputs();
    updateParticipationVisibility();

    var isRd = document.getElementById('project-isRd');
    if (isRd) isRd.checked = !!(item.isRd || item.rd || item['R&D 여부']);

    setRadio('project-division1', item.division1 || item['구분1']);
    // 분류가 결정된 후 헤더 갱신 (모드별)
    updateBudgetTableHeader();

    if (tbodyEl) tbodyEl.innerHTML = '';
    var years = item.yearBudgets || item.annualData || [];
    if (!Array.isArray(years)) years = [];
    if (years.length === 0) addYearRow();
    else years.forEach(function (y) { addYearRow(y); });

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

    var paymentsByIdx = {};
    years.forEach(function (yb, idx) {
      if (yb) paymentsByIdx[idx] = migratePayments(yb);
    });
    renderPayments(paymentsByIdx);
  }

  function loadProject(items) {
    if (loaded) return;
    loaded = true;
    if (isNewMode) {
      updateBudgetTableHeader();
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
      updateBudgetTableHeader();
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
    var breakdownsByIdx = getCalendarBreakdownsFromForm();
    var paymentsByIdx = getAllPaymentsFromForm();
    var serviceMode = isServiceMode();
    var rows = tbodyEl.querySelectorAll('tr');
    rows.forEach(function (row, idx) {
      var s   = (row.querySelector('.yb-start')   || {}).value || '';
      var e   = (row.querySelector('.yb-end')     || {}).value || '';
      var ybObj;
      if (serviceMode) {
        var totalAmt = parseNum((row.querySelector('.yb-total') || {}).value);
        if (!s && !e && totalAmt === 0) return;
        var supply = Math.round(totalAmt / 1.1);
        var vat = totalAmt - supply;
        ybObj = {
          startDate: s, endDate: e,
          support: supply,        // 공급가 (통계용 호환)
          cash: 0, inKind: 0,
          totalIncludingVat: totalAmt,
          vat: vat,
          subtotal: supply
        };
        supportTotal += supply;
      } else {
        var sup = parseNum((row.querySelector('.yb-support') || {}).value);
        var cash = parseNum((row.querySelector('.yb-cash')   || {}).value);
        var ink  = parseNum((row.querySelector('.yb-inkind') || {}).value);
        var sub = sup + cash + ink;
        if (!s && !e && sup === 0 && cash === 0 && ink === 0) return;
        ybObj = { startDate: s, endDate: e, support: sup, cash: cash, inKind: ink, subtotal: sub };
        supportTotal += sub;
      }
      var cb = breakdownsByIdx[String(idx)];
      if (cb && Object.keys(cb).length) ybObj.calendarBreakdown = cb;
      var ps = paymentsByIdx[String(idx)];
      if (ps) {
        if (ps.planned && ps.planned.length) ybObj.plannedPayments = ps.planned;
        if (ps.actual && ps.actual.length) ybObj.actualPayments = ps.actual;
      }
      years.push(ybObj);
      if (s && (!startDate || s < startDate)) startDate = s;
      if (e && (!endDate || e > endDate)) endDate = e;
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
    submitDate = formatDateInput(submitDate);
    if (status !== '미제출') unsubReason = '';

    var collected = collectYears();
    var years        = collected.years;
    var startDate    = collected.startDate;
    var endDate      = collected.endDate;
    var supportTotal = collected.supportTotal;

    var supportYear = 0;
    years.forEach(function (y) {
      var s = (y.startDate || '').slice(0, 4);
      var e = (y.endDate || '').slice(0, 4);
      if (s && e && s <= String(STAT_YEAR) && e >= String(STAT_YEAR)) supportYear += (y.support || 0);
    });

    var existingArr = Array.isArray(existingItems) ? existingItems : [];
    var idx = -1;
    var existing = null;
    if (editingId) {
      idx = existingArr.findIndex(function (x) { return (x.id || x.docId) === editingId; });
      existing = idx >= 0 ? existingArr[idx] : null;
    }
    var no;
    if (existing && existing.no != null && existing.no !== '') no = String(existing.no);
    else no = String(existingArr.length + (idx >= 0 ? 0 : 1));

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
      status: status,
      submitDate: submitDate,
      unsubmittedReason: unsubReason,
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
    if (!div1El) {
      alert('유형을 선택해 주세요.');
      var radioFirst = document.querySelector('input[name="project-division1"]');
      if (radioFirst) radioFirst.focus();
      return false;
    }
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
    if (!svc || typeof svc.saveProjects !== 'function') { alert('데이터 저장 서비스에 연결할 수 없습니다.'); return; }
    var items = (svc.getProjectsData ? svc.getProjectsData() : []) || [];
    items = Array.isArray(items) ? items.slice() : [];
    var item = buildItem(items);
    if (editingId) {
      var idx = items.findIndex(function (x) { return (x.id || x.docId) === editingId; });
      if (idx >= 0) items[idx] = item;
      else items.push(item);
    } else { items.push(item); }
    var savePromise;
    try { savePromise = svc.saveProjects(items); }
    catch (err) { console.error('저장 실패:', err); alert('저장 중 오류가 발생했습니다.'); return; }
    Promise.resolve(savePromise).then(function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
      window.location.href = 'projects.html';
    }).catch(function (err) {
      console.error('저장 실패:', err);
      var msg = (err && err.message) ? err.message : '알 수 없는 오류';
      alert('저장 중 오류가 발생했습니다.\n\n' + msg);
    });
  }

  function deleteProject() {
    if (isNewMode || !editingId) { alert('삭제할 과제를 찾을 수 없습니다.'); return; }
    var svc = window.firestoreService;
    if (!svc || typeof svc.saveProjects !== 'function') { alert('데이터 저장 서비스에 연결할 수 없습니다.'); return; }
    var items = (svc.getProjectsData ? svc.getProjectsData() : []) || [];
    items = Array.isArray(items) ? items.slice() : [];
    var idx = items.findIndex(function (x) { return (x.id || x.docId) === editingId; });
    if (idx < 0) { alert('삭제할 과제를 찾을 수 없습니다.'); return; }
    var target = items[idx];
    var label = target.projectName || target['과제명'] || target.keywords || '(이름 없음)';
    var confirmMsg = '"' + label + '" 과제를 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 모든 사용자에게 즉시 반영됩니다.';
    if (!window.confirm(confirmMsg)) return;
    items.splice(idx, 1);
    var savePromise;
    try { savePromise = svc.saveProjects(items); }
    catch (err) { console.error('삭제 실패:', err); alert('삭제 중 오류가 발생했습니다.'); return; }
    Promise.resolve(savePromise).then(function () {
      if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
      window.location.href = 'projects.html';
    }).catch(function (err) {
      console.error('삭제 실패:', err);
      var msg = (err && err.message) ? err.message : '알 수 없는 오류';
      alert('삭제 중 오류가 발생했습니다.\n\n' + msg);
    });
  }

  function cancelAndGoBack() {
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} }
    window.location.href = 'projects.html';
  }

  // ===== 정부부처 / 전문기관 드롭다운 (사용자 업로드 원본 그대로) =====
  var DEFAULT_AGENCIES = Object.freeze({
    '과학기술정보통신부': ['정보통신기획평가원', '정보통신산업진흥원'],
    '중소벤처기업부':     ['중소기업기술정보진흥원'],
    '기상청':             ['한국기상산업기술원'],
    '기후에너지환경부':   ['한국에너지공단', '한국에너지기술평가원', '한국환경산업기술원'],
    '산업통상부':         []
  });
  var agencyMap = {};
  function cloneDefaultAgencies() {
    var out = {};
    Object.keys(DEFAULT_AGENCIES).forEach(function (k) { out[k] = DEFAULT_AGENCIES[k].slice(); });
    return out;
  }
  function rebuildDeptSelect() {
    var sel = document.getElementById('project-department');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">선택하세요</option>';
    Object.keys(agencyMap).forEach(function (dept) {
      var opt = document.createElement('option');
      opt.value = dept; opt.textContent = dept;
      sel.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add__'; addOpt.textContent = '+ 직접 입력';
    sel.appendChild(addOpt);
    if (prev && prev !== '__add__' && agencyMap.hasOwnProperty(prev)) sel.value = prev;
    else if (prev !== '__add__') sel.value = prev || '';
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
      opt.value = inst; opt.textContent = inst;
      sel.appendChild(opt);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add__'; addOpt.textContent = '+ 직접 입력';
    sel.appendChild(addOpt);
    if (prev && prev !== '__add__' && list.indexOf(prev) >= 0) sel.value = prev;
  }
  function setDeptValue(value) {
    var deptSel = document.getElementById('project-department');
    if (!deptSel) return;
    if (value && !agencyMap.hasOwnProperty(value)) agencyMap[value] = [];
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
    if (deptSel) {
      deptSel.addEventListener('change', function () {
        var v = deptSel.value;
        if (v === '__add__') {
          if (deptCustom) { deptCustom.style.display = ''; deptCustom.value = ''; deptCustom.focus(); }
          deptSel.value = ''; rebuildInstSelect(null);
        } else {
          if (deptCustom) deptCustom.style.display = 'none';
          rebuildInstSelect(v);
        }
        if (instManagePanel && instManagePanel.style.display !== 'none') renderInstManagePanel();
      });
    }
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
        } else if (e.key === 'Escape') { deptCustom.style.display = 'none'; }
      });
    }
    if (instSel) {
      instSel.addEventListener('change', function () {
        var v = instSel.value;
        if (v === '__add__') {
          if (instCustom) { instCustom.style.display = ''; instCustom.value = ''; instCustom.focus(); }
          instSel.value = '';
        } else {
          if (instCustom) instCustom.style.display = 'none';
        }
      });
    }
    if (instCustom) {
      instCustom.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var newInst = instCustom.value.trim();
          var dept = deptSel ? deptSel.value : '';
          if (newInst && dept) {
            if (!agencyMap[dept]) agencyMap[dept] = [];
            if (agencyMap[dept].indexOf(newInst) < 0) agencyMap[dept].push(newInst);
            rebuildInstSelect(dept);
            if (instSel) instSel.value = newInst;
            instCustom.style.display = 'none';
            saveCustomAgency(dept);
            if (instManagePanel && instManagePanel.style.display !== 'none') renderInstManagePanel();
          } else if (!dept) alert('정부부처를 먼저 선택해 주세요.');
        } else if (e.key === 'Escape') instCustom.style.display = 'none';
      });
    }
    function renderDeptManagePanel() {
      if (!deptManagePanel) return;
      var html = '';
      Object.keys(agencyMap).forEach(function (name) {
        var isDefault = DEFAULT_AGENCIES.hasOwnProperty(name);
        html += '<div class="dmp-item' + (isDefault ? ' dmp-item--default' : '') + '">';
        html +=   '<span class="dmp-item-name">' + escapeHtml(name) + '</span>';
        if (isDefault) html += '<span class="dmp-item-tag">기본</span>';
        else html += '<button type="button" class="dmp-del" data-name="' + escapeHtml(name) + '" title="삭제">✕</button>';
        html += '</div>';
      });
      html += '<div class="dmp-divider"></div>';
      html += '<div class="dmp-add-row">';
      html += '<input type="text" class="dmp-add-input" id="dmp-dept-add-input" placeholder="새 부처명">';
      html += '<button type="button" class="dmp-add-btn" id="dmp-dept-add-btn">+ 추가</button>';
      html += '</div>';
      deptManagePanel.innerHTML = html;
      deptManagePanel.querySelectorAll('.dmp-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-name');
          if (!name || DEFAULT_AGENCIES.hasOwnProperty(name)) return;
          if (!confirm('"' + name + '" 부처를 삭제할까요?\n(이 부처의 전문기관 목록도 같이 삭제됩니다)')) return;
          delete agencyMap[name];
          rebuildDeptSelect();
          if (deptSel && deptSel.value === name) { deptSel.value = ''; rebuildInstSelect(null); }
          deleteCustomAgency(name);
          renderDeptManagePanel();
        });
      });
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
      if (addInput) addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addDept(); } });
    }
    function renderInstManagePanel() {
      if (!instManagePanel) return;
      var dept = deptSel ? deptSel.value : '';
      if (!dept || dept === '__add__') { instManagePanel.innerHTML = '<div class="dmp-empty">정부부처를 먼저 선택하세요</div>'; return; }
      var insts = agencyMap[dept] || [];
      var defaults = DEFAULT_AGENCIES[dept] || [];
      var html = '<div style="font-size:0.78rem; color:#6b7280; margin-bottom:0.4rem;">현재: ' + escapeHtml(dept) + '</div>';
      if (insts.length === 0) html += '<div class="dmp-empty">등록된 전문기관 없음</div>';
      else {
        insts.forEach(function (instName) {
          var isDefault = defaults.indexOf(instName) >= 0;
          html += '<div class="dmp-item' + (isDefault ? ' dmp-item--default' : '') + '">';
          html +=   '<span class="dmp-item-name">' + escapeHtml(instName) + '</span>';
          if (isDefault) html += '<span class="dmp-item-tag">기본</span>';
          else html += '<button type="button" class="dmp-del" data-name="' + escapeHtml(instName) + '" title="삭제">✕</button>';
          html += '</div>';
        });
      }
      html += '<div class="dmp-divider"></div>';
      html += '<div class="dmp-add-row">';
      html += '<input type="text" class="dmp-add-input" id="dmp-inst-add-input" placeholder="새 전문기관명">';
      html += '<button type="button" class="dmp-add-btn" id="dmp-inst-add-btn">+ 추가</button>';
      html += '</div>';
      instManagePanel.innerHTML = html;
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
      if (addInput) addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addInst(); } });
    }
    if (deptManageBtn) {
      deptManageBtn.addEventListener('click', function () {
        var open = deptManagePanel.style.display === 'none';
        if (open) { renderDeptManagePanel(); deptManagePanel.style.display = ''; deptManageBtn.classList.add('active'); }
        else { deptManagePanel.style.display = 'none'; deptManageBtn.classList.remove('active'); }
      });
    }
    if (instManageBtn) {
      instManageBtn.addEventListener('click', function () {
        var open = instManagePanel.style.display === 'none';
        if (open) { renderInstManagePanel(); instManagePanel.style.display = ''; instManageBtn.classList.add('active'); }
        else { instManagePanel.style.display = 'none'; instManageBtn.classList.remove('active'); }
      });
    }
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
          var deptSel = document.getElementById('project-department');
          var currentDept = deptSel ? deptSel.value : '';
          rebuildDeptSelect();
          if (currentDept) {
            if (deptSel) deptSel.value = currentDept;
            rebuildInstSelect(currentDept);
          }
        })
        .catch(function (e) { console.warn('[project-detail] custom agencies 로드 실패:', e); });
    } catch (e) { console.warn('[project-detail] firestore 호출 실패:', e); }
  }
  function saveCustomAgency(dept) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    try {
      var payload = {};
      payload[dept] = (agencyMap[dept] || []).slice();
      firebase.firestore().collection('config').doc('agencies').set({
        customAgencies: payload
      }, { merge: true }).catch(function (e) { console.warn('[project-detail] custom agency 저장 실패:', e); });
    } catch (e) { console.warn('[project-detail] firestore set 실패:', e); }
  }
  function deleteCustomAgency(dept) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    if (!dept) return;
    try {
      var update = {};
      update['customAgencies.' + dept] = firebase.firestore.FieldValue.delete();
      firebase.firestore().collection('config').doc('agencies').update(update)
        .catch(function (e) { console.warn('[project-detail] custom agency 삭제 실패:', e); });
    } catch (e) { console.warn('[project-detail] firestore delete 실패:', e); }
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

    tbodyEl = document.getElementById('year-budget-tbody');
    totalEl = document.getElementById('year-budget-total');
    // 헤더 row 참조 — JS가 모드별로 채움
    var table = document.getElementById('year-budget-table');
    if (table) {
      var thead = table.querySelector('thead');
      if (thead) {
        var row = thead.querySelector('tr');
        if (row) headerRowEl = row;
      }
    }
    // 초기 헤더 (과제 모드)
    updateBudgetTableHeader();

    setupDeptInstitutionDropdowns();

    var statusSelectEl = document.getElementById('project-status');
    if (statusSelectEl) statusSelectEl.addEventListener('change', updateStatusConditionalInputs);
    updateStatusConditionalInputs();

    var submitDateEl = document.getElementById('project-submit-date');
    if (submitDateEl) {
      submitDateEl.addEventListener('blur', function () { submitDateEl.value = formatDateInput(submitDateEl.value); });
    }

    readURL();
    setHeaderTexts();

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

    var calToggle = document.getElementById('cal-breakdown-toggle');
    var calWrap   = document.getElementById('cal-breakdown-wrap');
    if (calToggle && calWrap) {
      calToggle.addEventListener('click', function () {
        var expanded = calWrap.classList.toggle('expanded');
        calToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (expanded) renderCalendarBreakdown();
      });
      calToggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); calToggle.click(); }
      });
    }
    var calRefreshBtn = document.getElementById('cal-breakdown-refresh');
    if (calRefreshBtn) calRefreshBtn.addEventListener('click', function () { renderCalendarBreakdown(); });
    var calClearBtn = document.getElementById('cal-breakdown-clear');
    if (calClearBtn) calClearBtn.addEventListener('click', function () { renderCalendarBreakdown({}); });

    if (tbodyEl) {
      tbodyEl.addEventListener('blur', function (e) {
        if (e.target && e.target.matches && e.target.matches('.yb-start, .yb-end, .yb-support, .yb-total')) {
          if (calWrap && calWrap.classList.contains('expanded')) renderCalendarBreakdown();
          renderPayments();
        }
      }, true);
    }

    var addManagerHistoryBtn = document.getElementById('add-manager-history-btn');
    if (addManagerHistoryBtn) addManagerHistoryBtn.addEventListener('click', function () { addManagerHistoryRow(); });

    document.querySelectorAll('input[name="participation-type"]').forEach(function (r) {
      r.addEventListener('change', function () { updateParticipationVisibility(); updateBudgetPercent(); });
    });
    // ★ 분류(division1) 라디오 변경 → 예산 테이블 모드 전환 (용역 ↔ 그 외)
    document.querySelectorAll('input[name="project-division1"]').forEach(function (r) {
      r.addEventListener('change', function () {
        rebuildBudgetTable();
        // 캘린더 분배 + 입금 일정도 갱신 (공급가 기준 변경 반영)
        if (calWrap && calWrap.classList.contains('expanded')) renderCalendarBreakdown();
        renderPayments();
      });
    });

    var consortiumTotalEl = document.getElementById('consortium-total-budget');
    if (consortiumTotalEl) consortiumTotalEl.addEventListener('input', updateBudgetPercent);
    updateParticipationVisibility();

    if (saveTopBtn) saveTopBtn.addEventListener('click', saveProject);
    if (saveBottomBtn) saveBottomBtn.addEventListener('click', function (e) { e.preventDefault(); saveProject(); });
    if (cancelTopBtn) cancelTopBtn.addEventListener('click', cancelAndGoBack);
    if (cancelBottomBtn) cancelBottomBtn.addEventListener('click', cancelAndGoBack);
    if (deleteTopBtn) deleteTopBtn.addEventListener('click', deleteProject);
    if (deleteBottomBtn) deleteBottomBtn.addEventListener('click', deleteProject);

    if (!isNewMode) {
      if (deleteTopBtn) deleteTopBtn.style.display = '';
      if (deleteBottomBtn) deleteBottomBtn.style.display = '';
    }
    if (backLink) {
      backLink.addEventListener('click', function (e) { e.preventDefault(); cancelAndGoBack(); });
    }
    if (formEl) {
      formEl.addEventListener('submit', function (e) { e.preventDefault(); saveProject(); });
    }

    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      var loadingEl = document.getElementById('detail-loading');
      if (!isNewMode && loadingEl) loadingEl.style.display = 'block';
      unsubscribe = svc.subscribeProjects(function (items) {
        if (loadingEl) loadingEl.style.display = 'none';
        loadProject(items);
      });
    } else {
      loadProject([]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
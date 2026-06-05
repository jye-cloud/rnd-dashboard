/**
 * 자금 관리 (funding.js)
 * - 카드: 당해 수주 / 당해 입금 / 실제 수령 / 미수
 * - 시기별 cash flow (분기/월 토글)
 * - 과제별 입금 일정 표
 * - "지원금" 섹션(division1 !== '용역')과 "용역" 섹션(division1 === '용역')을 각각 별도로 렌더
 */
(function () {
  'use strict';

  // ===== 유틸 =====
  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function formatNum(n) {
    var num = Number(n);
    if (isNaN(num)) return '0';
    return num.toLocaleString('ko-KR');
  }
  function setEl(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // normalizeStatus — projects.js와 동일
  function normalizeStatus(it) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    var n = raw.replace(/\s/g, '');
    var today = new Date();
    var todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    if (n === '수행중' || n === '수행') {
      var endDate = (it.endDate || it.end || it['종료일'] || '').toString().slice(0, 10);
      if (endDate && todayStr > endDate) return '종료';
      return '수행';
    }
    if (raw === '예정') {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submitDate && todayStr > submitDate) return '대기';
      return '예정';
    }
    if (raw === '대기' || raw === '종료' || raw === '미선정' || raw === '미제출') return raw;
    return raw || '미정';
  }

  // yearBudget의 그 해 입금분 (calendarBreakdown 우선, 없으면 일별 비례)
  function supportInYear(yb, year) {
    if (!yb) return 0;
    var cb = yb.calendarBreakdown;
    if (cb && typeof cb === 'object' && cb[year] != null && cb[year] !== '') {
      return Number(cb[year]) || 0;
    }
    var s = (yb.startDate || '').toString().slice(0, 10);
    var e = (yb.endDate   || '').toString().slice(0, 10);
    if (!s || !e) return 0;
    var support = Number(yb.support || 0);
    if (!support) return 0;
    var sd = new Date(s + 'T00:00:00');
    var ed = new Date(e + 'T00:00:00');
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) return 0;
    var yearStart = new Date(year + '-01-01T00:00:00');
    var yearEnd   = new Date(year + '-12-31T00:00:00');
    var oStart = sd > yearStart ? sd : yearStart;
    var oEnd   = ed < yearEnd   ? ed : yearEnd;
    if (oStart > oEnd) return 0;
    var totalDays = ((ed - sd) / 86400000) + 1;
    var ovDays    = ((oEnd - oStart) / 86400000) + 1;
    if (sd.getFullYear() === ed.getFullYear()) {
      return Number(year) === sd.getFullYear() ? support : 0;
    }
    return Math.round(support * ovDays / totalDays);
  }

  // 한 과제(it)의 그 해 입금 예정 지원금 — dashboard.js의 getYearAmounts().support와 동일 로직
  //   1) yearBudgets 모든 항목의 supportInYear 합
  //   2) 합이 0이고 year === 2026이고 it.supportYear가 있으면 폴백 (옛 데이터 호환)
  function getProjectYearSupport(it, year) {
    var sup = 0;
    if (Array.isArray(it.yearBudgets)) {
      it.yearBudgets.forEach(function (yb) {
        sup += supportInYear(yb, year);
      });
    }
    // dashboard와 동일 — yearBudgets 비어있는 옛 데이터 호환 (2026만)
    if (Number(year) === 2026 && it.supportYear != null && !isNaN(Number(it.supportYear))) {
      if (sup === 0) sup = Number(it.supportYear);
    }
    return sup;
  }

  function getPaymentsFromYb(yb) {
    var planned = Array.isArray(yb.plannedPayments) ? yb.plannedPayments.slice() : [];
    var actual = Array.isArray(yb.actualPayments) ? yb.actualPayments.slice() : [];
    if (Array.isArray(yb.payments)) {
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

  // 연차의 정산 차감(이자 반납 등) 합 + 귀속 연도(가: 마지막 예정 입금 연도, 없으면 종료/시작일 연도)
  function getYbDeduction(yb) {
    var sum = 0;
    if (yb && Array.isArray(yb.deductions)) {
      yb.deductions.forEach(function (d) { sum += Number((d && d.amount) || 0); });
    }
    if (sum <= 0) return { amount: 0, year: '' };
    var pays = getPaymentsFromYb(yb);
    var lastY = '';
    pays.planned.forEach(function (p) {
      var y = getYearFromDate(p.date);
      if (y && Number(p.amount || 0) > 0 && y > lastY) lastY = y;  // 'YYYY' 문자열 비교 = 최신 연도
    });
    var year = lastY || getYearFromDate(yb.endDate) || getYearFromDate(yb.startDate) || '';
    return { amount: sum, year: year };
  }

  function getYearFromDate(s) { return (s || '').toString().slice(0, 4); }
  function getMonthFromDate(s) {
    var v = (s || '').toString().slice(5, 7);
    return v ? parseInt(v, 10) : 0;
  }
  function monthToQuarter(m) {
    if (m >= 1 && m <= 3) return 1;
    if (m >= 4 && m <= 6) return 2;
    if (m >= 7 && m <= 9) return 3;
    if (m >= 10 && m <= 12) return 4;
    return 0;
  }

  // ===== 메인 상태 =====
  var allProjects = [];
  var currentYear = '2026';
  var currentView = 'month';
  var currentTab  = 'payments';   // 'payments' | 'refund' (v6.2)
  var _companyFilter = '';        // '' | '식스티' | '굿뉴스' | '패리티' (두 탭 공통)

  // ===== 지원금 입금 요약 카드 (v6.2 — 6개)
  // 데이터 소스: plannedPayments / actualPayments (표와 동일)
  //   - 입금 예정액 = plannedPayments의 합 (날짜가 currentYear인 것만)
  //   - 입금액      = actualPayments의 합 (날짜가 currentYear인 것만)
  //   - 미수        = max(0, 입금 예정 - 입금)  (음수=예정 초과는 0으로 표시 — 표와 일관)
  //
  // 과제/기타 분리:
  //   - 과제 = it.division1 === '과제'
  //   - 기타 = 그 외 (지원사업, 기타, 빈 값) ※ 용역은 호출자에서 이미 제외됨
  //
  // 이번 달:
  //   - state.year가 오늘 연도면 오늘이 속한 월
  //   - 과거/미래 연도면 12월 (보수적)
  function renderFundingSummary(items) {
    var year = parseInt(currentYear, 10);
    var today = new Date();
    var todayYear = today.getFullYear();
    var todayMonth = today.getMonth() + 1;
    var refMonth = (year === todayYear) ? todayMonth : 12;
    var refYm = currentYear + '-' + String(refMonth).padStart(2, '0');  // 'YYYY-MM'

    // 라벨 갱신 — 풀 표기
    setEl('funding-sum-month-plan-label',   year + '년 ' + refMonth + '월 입금 예정액');
    setEl('funding-sum-month-actual-label', year + '년 ' + refMonth + '월 입금액');
    setEl('funding-sum-month-rate-label',   year + '년 ' + refMonth + '월 미수');
    setEl('funding-sum-year-plan-label',    year + '년 누적 입금 예정액');
    setEl('funding-sum-year-actual-label',  year + '년 누적 입금액');
    setEl('funding-sum-year-rate-label',    year + '년 누적 미수');

    var monthPlanTask = 0, monthPlanOther = 0;
    var monthActTask  = 0, monthActOther  = 0;
    var yearPlanTask  = 0, yearPlanOther  = 0;
    var yearActTask   = 0, yearActOther   = 0;
    var yearDedTask   = 0, yearDedOther   = 0;

    items.forEach(function (it) {
      var isTask = (it.division1 === '과제');
      if (!Array.isArray(it.yearBudgets)) return;
      it.yearBudgets.forEach(function (yb) {
        var pays = getPaymentsFromYb(yb);
        pays.planned.forEach(function (p) {
          var d = (p.date || '').toString();
          var amt = Number(p.amount || 0);
          if (!amt) return;
          if (d.slice(0, 4) !== currentYear) return;
          // 누적
          if (isTask) yearPlanTask += amt; else yearPlanOther += amt;
          // 이번 달
          if (d.slice(0, 7) === refYm) {
            if (isTask) monthPlanTask += amt; else monthPlanOther += amt;
          }
        });
        pays.actual.forEach(function (p) {
          var d = (p.date || '').toString();
          var amt = Number(p.amount || 0);
          if (!amt) return;
          if (d.slice(0, 4) !== currentYear) return;
          if (isTask) yearActTask += amt; else yearActOther += amt;
          if (d.slice(0, 7) === refYm) {
            if (isTask) monthActTask += amt; else monthActOther += amt;
          }
        });
        var ded = getYbDeduction(yb);
        if (ded.amount > 0 && ded.year === currentYear) {
          if (isTask) yearDedTask += ded.amount; else yearDedOther += ded.amount;
        }
      });
    });

    var monthPlan   = monthPlanTask + monthPlanOther;
    var monthAct    = monthActTask  + monthActOther;
    var yearPlan    = yearPlanTask  + yearPlanOther;
    var yearAct     = yearActTask   + yearActOther;

    function unpaid(plan, act) { return Math.max(0, plan - act); }

    // 이번 달
    setEl('funding-sum-month-plan',         formatNum(monthPlan));
    setEl('funding-sum-month-plan-task',    formatNum(monthPlanTask));
    setEl('funding-sum-month-plan-other',   formatNum(monthPlanOther));
    setEl('funding-sum-month-actual',       formatNum(monthAct));
    setEl('funding-sum-month-actual-task',  formatNum(monthActTask));
    setEl('funding-sum-month-actual-other', formatNum(monthActOther));
    // 미수 (입금률 자리 — id는 그대로 'rate'지만 값 의미는 미수액)
    setEl('funding-sum-month-rate',         formatNum(unpaid(monthPlan,      monthAct)));
    setEl('funding-sum-month-rate-task',    formatNum(unpaid(monthPlanTask,  monthActTask)));
    setEl('funding-sum-month-rate-other',   formatNum(unpaid(monthPlanOther, monthActOther)));

    // 누적
    setEl('funding-sum-year-plan',          formatNum(yearPlan));
    setEl('funding-sum-year-plan-task',     formatNum(yearPlanTask));
    setEl('funding-sum-year-plan-other',    formatNum(yearPlanOther));
    setEl('funding-sum-year-actual',        formatNum(yearAct));
    setEl('funding-sum-year-actual-task',   formatNum(yearActTask));
    setEl('funding-sum-year-actual-other',  formatNum(yearActOther));
    setEl('funding-sum-year-rate',          formatNum(Math.max(0, yearPlan      - yearAct      - (yearDedTask + yearDedOther))));
    setEl('funding-sum-year-rate-task',     formatNum(Math.max(0, yearPlanTask  - yearActTask  - yearDedTask)));
    setEl('funding-sum-year-rate-other',    formatNum(Math.max(0, yearPlanOther - yearActOther - yearDedOther)));
  }

  // ===== 과제별 입금 추적 표 (v6.2: 누적 차이 3행 구조)
  // - 예정 / 입금 / 누적차이
  // - 누적차이 = (1월~그 달 예정 합) - (1월~그 달 입금 합)
  //   · 양수: 누적 미수 (빨강)
  //   · 음수: 예정 초과 (예정보다 많이 들어옴) — 보라
  //   · 0: 회색
  // - 분기 미수 해소 / 취소선 / overdue 등 옛 상태 로직 제거 — 누적 차이가 의미를 대신함
  function renderProjectTable(items, containerId, emptyHint) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var isMonth = (currentView === 'month');
    var numBins = isMonth ? 12 : 4;
    var binLabels = isMonth
      ? ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      : ['1분기','2분기','3분기','4분기'];

    function binOfMonth(m) {
      if (m < 1 || m > 12) return -1;
      return isMonth ? (m - 1) : (monthToQuarter(m) - 1);
    }

    var rows = [];

    items.forEach(function (it) {
      if (!Array.isArray(it.yearBudgets)) return;
      it.yearBudgets.forEach(function (yb, ybIdx) {
        var pays = getPaymentsFromYb(yb);
        if (!pays.planned.length && !pays.actual.length) return;

        var bins = [];
        for (var bi = 0; bi < numBins; bi++) bins.push({ p: 0, a: 0, pc: 0, ac: 0 });
        var hasData = false;

        pays.planned.forEach(function (p) {
          var pY = getYearFromDate(p.date);
          var pAmt = Number(p.amount || 0);
          if (pY === currentYear && pAmt > 0) {
            var pM = getMonthFromDate(p.date);
            var idx = binOfMonth(pM);
            if (idx >= 0 && idx < numBins) {
              bins[idx].p += pAmt;
              bins[idx].pc += 1;
              hasData = true;
            }
          }
        });
        pays.actual.forEach(function (p) {
          var aY = getYearFromDate(p.date);
          var aAmt = Number(p.amount || 0);
          if (aY === currentYear && aAmt > 0) {
            var aM = getMonthFromDate(p.date);
            var idx2 = binOfMonth(aM);
            if (idx2 >= 0 && idx2 < numBins) {
              bins[idx2].a += aAmt;
              bins[idx2].ac += 1;
              hasData = true;
            }
          }
        });

        if (!hasData) return;

        // 누적 차이 — bin 순서대로 누적
        var cumDiffs = [];
        var cumP = 0, cumA = 0;
        for (var ci = 0; ci < numBins; ci++) {
          cumP += bins[ci].p;
          cumA += bins[ci].a;
          cumDiffs.push(cumP - cumA);
        }

        var totalP = 0, totalA = 0, totalPc = 0, totalAc = 0;
        bins.forEach(function (b) {
          totalP += b.p; totalA += b.a;
          totalPc += b.pc; totalAc += b.ac;
        });

        var dedInfo = getYbDeduction(yb);
        var rowDeduction = (dedInfo.amount > 0 && dedInfo.year === currentYear) ? dedInfo.amount : 0;

        rows.push({
          name: it.keywords || it.keyword || it['키워드'] || it.projectName || '(이름 없음)',
          cha: (ybIdx + 1) + '차',
          id: it.id,
          division: (it.division1 === '과제') ? 'task' : 'other',   // v6.2: 분류 배지용
          bins: bins,
          cumDiffs: cumDiffs,
          totalP: totalP, totalA: totalA,
          totalPc: totalPc, totalAc: totalAc,
          totalCumDiff: cumDiffs[numBins - 1] || 0,
          deduction: rowDeduction,
          sortDate: (it.startDate || yb.startDate || ''),
          ybIdx: ybIdx
        });
      });
    });

    if (!rows.length) {
      container.innerHTML = '<div class="funding-table" style="padding:0;"><div class="funding-empty">' +
        currentYear + '년 ' + (emptyHint || '입금 일정') + '이 없습니다.<br>' +
        '<span style="font-size:0.82rem;">과제 등록/수정 페이지에서 입금 일정을 입력하세요.</span>' +
        '</div></div>';
      return;
    }

    // 정렬: 분류(과제 먼저) → 시작일 → 차수
    rows.sort(function (a, b) {
      // 1) 분류: 과제 먼저 (task < other)
      if (a.division !== b.division) {
        return a.division === 'task' ? -1 : 1;
      }
      var ad = a.sortDate, bd = b.sortDate;
      if (!ad && !bd) return a.ybIdx - b.ybIdx;
      if (!ad) return 1;
      if (!bd) return -1;
      var cmp = ad.localeCompare(bd);
      if (cmp !== 0) return cmp;
      return a.ybIdx - b.ybIdx;
    });

    // 합계 행 — bin별 합산 + 누적 차이
    var totalBins = [];
    for (var ti = 0; ti < numBins; ti++) totalBins.push({ p: 0, a: 0, pc: 0, ac: 0 });
    rows.forEach(function (r) {
      for (var i = 0; i < numBins; i++) {
        totalBins[i].p  += r.bins[i].p;
        totalBins[i].a  += r.bins[i].a;
        totalBins[i].pc += r.bins[i].pc;
        totalBins[i].ac += r.bins[i].ac;
      }
    });
    var totalCumDiffs = [];
    var tCumP = 0, tCumA = 0;
    for (var tci = 0; tci < numBins; tci++) {
      tCumP += totalBins[tci].p;
      tCumA += totalBins[tci].a;
      totalCumDiffs.push(tCumP - tCumA);
    }
    var totalTotalP = 0, totalTotalA = 0;
    rows.forEach(function (r) { totalTotalP += r.totalP; totalTotalA += r.totalA; });
    var grandDeduction = 0;
    rows.forEach(function (r) { grandDeduction += (r.deduction || 0); });
    var grandTotalCumDiff = totalCumDiffs[numBins - 1] || 0;

    // ── 셀 HTML 헬퍼 (미수 컨셉: 음수는 표시 안 함) ─────────
    function plannedCellHtml(b) {
      if (b.p === 0) return '<td class="f-cell f-cell-empty">-</td>';
      var countTxt = b.pc > 1 ? ' <small>(' + b.pc + '건)</small>' : '';
      return '<td class="f-cell">' + formatNum(b.p) + countTxt + '</td>';
    }
    function actualCellHtml(b) {
      if (b.a === 0) return '<td class="f-cell f-cell-empty">-</td>';
      var countTxt = b.ac > 1 ? ' <small>(' + b.ac + '건)</small>' : '';
      return '<td class="f-cell f-cell-paid">' + formatNum(b.a) + countTxt + '</td>';
    }
    // 미수 = max(0, 누적예정 − 누적입금). 그 달에 예정이 없으면 dash (정보 표시 안 함).
    //   - 예정이 있는 월 + 누적 미수 > 0  → 빨강 미수액
    //   - 예정이 있는 월 + 누적 미수 ≤ 0  → dash (해당 달까지는 다 받음)
    //   - 예정이 없는 월                  → dash (의미 없음)
    function unpaidCellHtml(cumDiff, b) {
      if (!b || b.p === 0) return '<td class="f-cell f-cell-empty">-</td>';
      if (cumDiff <= 0)    return '<td class="f-cell f-cell-empty">-</td>';
      return '<td class="f-cell f-cell-diff-positive">' + formatNum(cumDiff) + '</td>';
    }
    // 미수 합계 셀: 마지막 누적차이 > 0 → 빨강 미수액 / 마지막 ≤ 0 && 입금 있음 → ✓ 완료 / 그 외 dash
    // isCompleted 플래그 함께 반환
    function unpaidTotalResult(lastCumDiff, hasActual) {
      if (lastCumDiff > 0) {
        return { html: '<td class="f-cell f-cell-diff-positive">' + formatNum(lastCumDiff) + '</td>', isCompleted: false };
      }
      if (lastCumDiff <= 0 && hasActual) {
        return { html: '<td class="f-cell"><span class="f-completed-badge">✓ 완료</span></td>', isCompleted: true };
      }
      return { html: '<td class="f-cell f-cell-empty">-</td>', isCompleted: false };
    }
    function unpaidTotalHtml(lastCumDiff, hasActual) {
      return unpaidTotalResult(lastCumDiff, hasActual).html;
    }

    // ── 본문 ─────────────────────────────────────────────
    var tbody = rows.map(function (r) {
      var badgeCls = r.division === 'task' ? 'f-division-badge--task' : 'f-division-badge--other';
      var badgeLabel = r.division === 'task' ? '과제' : '기타';
      var badge = '<span class="f-division-badge ' + badgeCls + '">' + badgeLabel + '</span>';
      var nameHtml = badge +
                     '<a href="project-detail.html?id=' + encodeURIComponent(r.id || '') + '" ' +
                     'style="color:#1d4ed8;text-decoration:none;">' + escapeHtml(r.name) + '</a> ' +
                     '<span class="f-cha">' + r.cha + '</span>';

      var adjCumDiff = r.totalCumDiff - (r.deduction || 0);
      var unpaidTotalRes = unpaidTotalResult(adjCumDiff, (r.totalA > 0 || (r.deduction || 0) > 0));
      var isCompleted = unpaidTotalRes.isCompleted;

      // 완료인 경우 예정 셀에 취소선 + 진한 회색 적용
      function plannedCellCompletedHtml(b) {
        if (b.p === 0) return '<td class="f-cell f-cell-empty">-</td>';
        var countTxt = b.pc > 1 ? ' <small>(' + b.pc + '건)</small>' : '';
        return '<td class="f-cell f-cell-planned-done">' + formatNum(b.p) + countTxt + '</td>';
      }

      var plannedCells = isCompleted
        ? r.bins.map(plannedCellCompletedHtml).join('')
        : r.bins.map(plannedCellHtml).join('');
      var actualCells  = r.bins.map(actualCellHtml).join('');
      var unpaidCells  = r.cumDiffs.map(function (d, i) { return unpaidCellHtml(d, r.bins[i]); }).join('');

      var plannedKindHtml = isCompleted
        ? '<td class="f-kind f-kind-planned f-kind-planned-done">예정</td>'
        : '<td class="f-kind f-kind-planned">예정</td>';
      var plannedTotalHtml = isCompleted
        ? '<td class="f-cell f-cell-total f-cell-planned-done">' + (r.totalP > 0 ? formatNum(r.totalP) : '-') + '</td>'
        : '<td class="f-cell f-cell-total">' + (r.totalP > 0 ? formatNum(r.totalP) : '-') + '</td>';

      var plannedRow = '<tr class="f-row-trio-top' + (isCompleted ? ' f-row-planned-done' : '') + '">' +
        '<td class="f-name" rowspan="3">' + nameHtml + '</td>' +
        plannedKindHtml +
        plannedCells +
        plannedTotalHtml +
      '</tr>';
      var actualRow = '<tr class="f-row-trio-mid">' +
        '<td class="f-kind f-kind-actual">입금</td>' +
        actualCells +
        '<td class="f-cell f-cell-total">' + (r.totalA > 0 ? formatNum(r.totalA) : '-') + '</td>' +
      '</tr>';
      var dedNote = (r.deduction || 0) > 0
        ? '<div style="font-size:0.7rem;color:#f97316;margin-top:2px;font-weight:600;">반납 ' + formatNum(r.deduction) + ' 반영</div>'
        : '';
      var unpaidTotalCell;
      if ((r.deduction || 0) > 0) {
        unpaidTotalCell = (adjCumDiff <= 0)
          ? '<td class="f-cell"><span class="f-completed-badge">✓ 완료</span>' + dedNote + '</td>'
          : '<td class="f-cell f-cell-diff-positive">' + formatNum(adjCumDiff) + dedNote + '</td>';
      } else {
        unpaidTotalCell = unpaidTotalHtml(r.totalCumDiff, r.totalA > 0);
      }
      var unpaidRow = '<tr class="f-row-trio-bot">' +
        '<td class="f-kind f-kind-diff">미수</td>' +
        unpaidCells +
        unpaidTotalCell +
      '</tr>';
      return plannedRow + actualRow + unpaidRow;
    }).join('');

    // 합계 행 (3행)
    var totalPlannedCells = totalBins.map(plannedCellHtml).join('');
    var totalActualCells  = totalBins.map(actualCellHtml).join('');
    var totalUnpaidCells  = totalCumDiffs.map(function (d, i) { return unpaidCellHtml(d, totalBins[i]); }).join('');

    var totalRows =
      '<tr class="f-row-grand-top">' +
        '<td class="f-name" rowspan="3"><strong>전체 합계</strong></td>' +
        '<td class="f-kind f-kind-planned"><strong>예정</strong></td>' +
        totalPlannedCells +
        '<td class="f-cell f-cell-total"><strong>' + (totalTotalP > 0 ? formatNum(totalTotalP) : '-') + '</strong></td>' +
      '</tr>' +
      '<tr class="f-row-grand-mid">' +
        '<td class="f-kind f-kind-actual"><strong>입금</strong></td>' +
        totalActualCells +
        '<td class="f-cell f-cell-total"><strong>' + (totalTotalA > 0 ? formatNum(totalTotalA) : '-') + '</strong></td>' +
      '</tr>' +
      '<tr class="f-row-grand-bot">' +
        '<td class="f-kind f-kind-diff"><strong>미수</strong></td>' +
        totalUnpaidCells +
        (grandDeduction > 0
          ? ((grandTotalCumDiff - grandDeduction) <= 0
              ? '<td class="f-cell"><span class="f-completed-badge">✓ 완료</span><div style="font-size:0.7rem;color:#f97316;margin-top:2px;font-weight:600;">반납 ' + formatNum(grandDeduction) + ' 반영</div></td>'
              : '<td class="f-cell f-cell-diff-positive"><strong>' + formatNum(grandTotalCumDiff - grandDeduction) + '</strong><div style="font-size:0.7rem;color:#f97316;margin-top:2px;font-weight:600;">반납 ' + formatNum(grandDeduction) + ' 반영</div></td>')
          : unpaidTotalHtml(grandTotalCumDiff, totalTotalA > 0)) +
      '</tr>';

    var headerCells = binLabels.map(function (lb) { return '<th>' + lb + '</th>'; }).join('');

    container.innerHTML =
      '<div class="funding-table-info">' +
        '정확한 입금 금액은 사전 확인이 어려우므로, 총 지원금을 균등 배분한 추정값입니다. ' +
        '미수 = 그 달까지 받았어야 할 금액 중 아직 못 받은 금액 (= 누적 예정 − 누적 입금, 양수만). ' +
        '예정보다 미리 받은 경우는 표시되지 않으며, 연간 예정만큼 다 받았으면 합계에 ' +
        '<span class="f-completed-badge">✓ 완료</span> 가 표시됩니다.' +
      '</div>' +
      '<div class="funding-table-wrap">' +
        '<table class="funding-table funding-matrix labor-refund-matrix' + (isMonth ? ' funding-matrix--month' : '') + '">' +
          '<thead><tr>' +
            '<th>과제명</th>' +
            '<th class="f-th-kind">구분</th>' +
            headerCells +
            '<th>합계</th>' +
          '</tr></thead>' +
          '<tbody>' + tbody + totalRows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  // ===== 전체 렌더 (카드만 과제/용역 분리, 시기별/과제별은 지원금 과제만) =====
  function renderAll() {
    // v6.2: 회사 필터를 가장 먼저 한 번 적용 — 이후 모든 분류·렌더가 이 필터된 결과를 받음
    var filteredProjects = _companyFilter
      ? allProjects.filter(function (it) { return it.company === _companyFilter; })
      : allProjects;

    // 지원금(과제) = division1이 '용역'이 아닌 것 (빈 값 포함)
    var supportItems = filteredProjects.filter(function (it) { return it.division1 !== '용역'; });
    // 용역
    var serviceItems = filteredProjects.filter(function (it) { return it.division1 === '용역'; });

    // 요약 카드 (v6.2 — 6개 카드, 이번 달/누적 × 입금 예정/입금/미수, 과제/기타 분리)
    renderFundingSummary(supportItems);

    // 과제별 추적 표
    renderProjectTable(supportItems, 'funding-project-table', '입금 일정');

    // ===== 인건비 환급 추적 (v6.2 — P0-2) =====
    // 인건비 탭이 활성 상태일 때만 로드 (Firestore 호출 절약)
    if (currentTab === 'refund') {
      loadLaborForYear();
    }
  }

  // ============================================================
  // 인건비 환급 추적 — v6.2 P0-2
  // ============================================================
  //
  // 데이터 모델 (project-labor.js와 동일):
  //   - 컬렉션: 'projectLabor'
  //   - 문서: `${projectId}_planned`  → { cells: { `${pid}_${ym}_${personId}`: { rate, cash, inkind, ... } } }
  //           `${projectId}_actual`   → 동일 구조
  //           `${projectId}_meta`     → { meta: { [ym]: { confirmed, confirmedAt, paid, paidAt } }, personRoles, personIds }
  //
  // 한 과제 P, 한 월 M:
  //   - 예상 환급 = Σ planned.cells[`${P.id}_${M}_*`].cash   (모든 인력)
  //   - 실제 환급 = meta.meta[M].confirmed === true 면 Σ actual.cells[`${P.id}_${M}_*`].cash, 아니면 null(미확정)
  //   - 차이 = (실제가 확정된 월에 한해) 예상 - 실제
  //     · 양수: 예상보다 적게 환급(미수) → 빨강
  //     · 음수: 예상보다 많이 환급        → 초록
  //
  // 캐시 정책: participation-summary와 동일.
  //   연도가 바뀌면 _laborCache 비우고 그 연도에 활성인 과제의 3개 문서를 병렬로 가져옴.
  // ============================================================

  var LABOR_COLL = 'projectLabor';
  var _laborCache = {};        // { [projectId]: { planned: cells, actual: cells, meta: {[ym]:{confirmed,...}} } }
  var _laborCacheYear = null;
  var _laborLoading = false;
  // _companyFilter는 메인 상태(상단)에서 선언 — 두 탭 공통

  function db() { return window.__firebaseDb || null; }
  function isFirestoreReady() {
    return !!(window.__firebaseConfigured && window.__firebaseDb);
  }

  // 과제가 해당 연도에 활성인지 — participation-summary.html / project-labor.js와 동일 로직
  function isProjectActiveInYear(proj, year) {
    if (!proj || !proj.laborManaged) return false;
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

  // 회사 필터 + 활성 연도 필터 적용된 과제 목록
  function getRefundTargetProjects() {
    var yearInt = parseInt(currentYear, 10);
    return allProjects.filter(function (p) {
      if (!isProjectActiveInYear(p, yearInt)) return false;
      if (_companyFilter && p.company !== _companyFilter) return false;
      return true;
    });
  }

  // 그 해와 겹치는 yearBudgets의 인덱스+1 → "N차" 라벨용
  // project-labor.js의 getYearIndexForState와 동일 로직
  function getYearIndexForProject(proj, year) {
    if (!proj || !Array.isArray(proj.yearBudgets)) return '';
    for (var i = 0; i < proj.yearBudgets.length; i++) {
      var yb = proj.yearBudgets[i];
      if (!yb) continue;
      var sd = (yb.startDate || yb.start || '').toString();
      var ed = (yb.endDate   || yb.end   || '').toString();
      if (!sd && !ed) continue;
      var sy = parseInt(sd.slice(0, 4), 10);
      var ey = parseInt(ed.slice(0, 4), 10);
      if (!isFinite(sy)) continue;
      if (!isFinite(ey)) ey = sy;
      if (year >= sy && year <= ey) return (i + 1) + '차';
    }
    return '';
  }

  // ── 데이터 로드 ──────────────────────────────────────────────
  function loadLaborForYear() {
    if (!isFirestoreReady()) {
      _laborCache = {};
      _laborCacheYear = currentYear;
      renderLaborRefundTable();
      return;
    }

    // 캐시가 같은 연도면 그대로 사용
    var yearInt = parseInt(currentYear, 10);
    var activeProjects = allProjects.filter(function (p) { return isProjectActiveInYear(p, yearInt); });

    if (_laborCacheYear === currentYear &&
        Object.keys(_laborCache).length >= activeProjects.length) {
      renderLaborRefundTable();
      return;
    }

    if (_laborLoading) return;
    _laborLoading = true;

    showLaborRefundLoading();

    var promises = [];
    activeProjects.forEach(function (proj) {
      var docId = proj.id;
      promises.push(
        db().collection(LABOR_COLL).doc(docId + '_planned').get()
          .then(function (snap) {
            return { projectId: proj.id, kind: 'planned',
                     cells: (snap.exists && snap.data().cells) ? snap.data().cells : {} };
          })
      );
      promises.push(
        db().collection(LABOR_COLL).doc(docId + '_actual').get()
          .then(function (snap) {
            return { projectId: proj.id, kind: 'actual',
                     cells: (snap.exists && snap.data().cells) ? snap.data().cells : {} };
          })
      );
      promises.push(
        db().collection(LABOR_COLL).doc(docId + '_meta').get()
          .then(function (snap) {
            return { projectId: proj.id, kind: 'meta',
                     meta: (snap.exists && snap.data().meta) ? snap.data().meta : {} };
          })
      );
    });

    Promise.all(promises).then(function (results) {
      var cache = {};
      results.forEach(function (r) {
        if (!cache[r.projectId]) cache[r.projectId] = { planned: {}, actual: {}, meta: {} };
        if (r.kind === 'planned')     cache[r.projectId].planned = r.cells;
        else if (r.kind === 'actual') cache[r.projectId].actual  = r.cells;
        else if (r.kind === 'meta')   cache[r.projectId].meta    = r.meta;
      });
      _laborCache = cache;
      _laborCacheYear = currentYear;
      _laborLoading = false;
      renderLaborRefundTable();
    }).catch(function (err) {
      console.error('[funding] projectLabor 로드 실패:', err);
      _laborCache = {};
      _laborCacheYear = currentYear;
      _laborLoading = false;
      renderLaborRefundTable();
    });
  }

  function showLaborRefundLoading() {
    var container = document.getElementById('labor-refund-table');
    if (container) {
      container.innerHTML = '<div class="labor-refund-loading">데이터를 불러오는 중…</div>';
    }
  }

  // ── 핵심 계산: 한 과제, 한 월 → { planned, actual, confirmed } ──
  function getProjectMonthlyRefund(projectId, ym) {
    var bucket = _laborCache[projectId];
    if (!bucket) return { planned: 0, actual: 0, confirmed: false };

    var plannedSum = 0;
    var actualSum  = 0;
    var prefix = projectId + '_' + ym + '_';

    // planned cells 합산
    var pcells = bucket.planned || {};
    Object.keys(pcells).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      var cell = pcells[key];
      if (cell && cell.cash) plannedSum += Number(cell.cash) || 0;
    });

    // actual cells 합산 — confirmed 여부와 무관하게 합산하되, confirmed flag도 같이 반환
    var acells = bucket.actual || {};
    Object.keys(acells).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      var cell = acells[key];
      if (cell && cell.cash) actualSum += Number(cell.cash) || 0;
    });

    var meta = bucket.meta || {};
    var ymMeta = meta[ym] || {};
    var confirmed = !!ymMeta.confirmed;

    return { planned: plannedSum, actual: actualSum, confirmed: confirmed };
  }

  // bin (분기/월) 단위로 합산 — 미확정 월의 actual은 actual에서 빠지고, 확정 월 수는 별도 카운트
  function getProjectBinRefund(projectId, binIdx, isMonth) {
    var planned = 0;
    var actual  = 0;
    var hasUnconfirmed = false;     // 분기 안에 미확정 월이 하나라도 있는지
    var confirmedMonths = 0;        // 분기 안에 확정된 월 수
    var totalMonths = 0;            // 분기 안 월 수 (월별이면 1)

    if (isMonth) {
      var m = binIdx + 1;
      var ym = currentYear + '-' + String(m).padStart(2, '0');
      var r = getProjectMonthlyRefund(projectId, ym);
      return {
        planned: r.planned,
        actual: r.confirmed ? r.actual : 0,
        confirmed: r.confirmed,
        hasUnconfirmed: !r.confirmed && (r.planned > 0 || r.actual > 0),
        confirmedMonths: r.confirmed ? 1 : 0,
        totalMonths: 1
      };
    }

    // 분기 모드: 3개월 합산
    var startMonth = binIdx * 3 + 1;
    for (var dm = 0; dm < 3; dm++) {
      var mm = startMonth + dm;
      var ymm = currentYear + '-' + String(mm).padStart(2, '0');
      var rr = getProjectMonthlyRefund(projectId, ymm);
      planned += rr.planned;
      totalMonths += 1;
      if (rr.confirmed) {
        actual += rr.actual;
        confirmedMonths += 1;
      } else if (rr.planned > 0 || rr.actual > 0) {
        hasUnconfirmed = true;
      }
    }
    return {
      planned: planned,
      actual: actual,
      confirmed: !hasUnconfirmed && confirmedMonths > 0,
      hasUnconfirmed: hasUnconfirmed,
      confirmedMonths: confirmedMonths,
      totalMonths: totalMonths
    };
  }

  // ── 인건비 환급 요약 카드 (v6.2) ────────────────────────
  //
  // 6개 카드:
  //   [이번 달 환급 예정액 / 이번 달 환급액 / 이번 달 환급률]
  //   [올해 누적 환급 예정액 / 올해 누적 환급액 / 올해 누적 환급률]
  //
  // 정의:
  //   - 환급 예정액 = project-labor의 예상(planned) 탭 cash 합 (paid 메타 조건 없음)
  //     · 표의 "예상" 행과 동일 데이터
  //   - 환급액      = meta[ym].confirmed === true 인 월의 actual cash 합 (정부에서 받은 환급)
  //     · 표의 "실제" 행과 동일 데이터
  //   - 환급률      = 환급액 / 환급 예정액 × 100  (예정액 0이면 0%)
  //
  // "이번 달" = state.year가 오늘 연도면 오늘이 속한 월, 아니면 그 해 12월 (보수적)
  // "올해"   = state.year 전체 (1월~12월)
  function renderLaborRefundSummary(targets) {
    var year = parseInt(currentYear, 10);
    var today = new Date();
    var todayYear = today.getFullYear();
    var todayMonth = today.getMonth() + 1;

    // "이번 달" 결정: state.year가 오늘 연도면 그 달, 과거/미래면 12월 (의미는 약하지만 0이 되지 않게)
    var refMonth = (year === todayYear) ? todayMonth : 12;
    var refYm = year + '-' + String(refMonth).padStart(2, '0');

    // 라벨 갱신 — 풀 표기 ("2026년 5월 환급 예정액" / "2026년 누적 환급 예정액")
    setEl('labor-sum-month-pay-label',    year + '년 ' + refMonth + '월 환급 예정액');
    setEl('labor-sum-month-refund-label', year + '년 ' + refMonth + '월 환급액');
    setEl('labor-sum-month-rate-label',   year + '년 ' + refMonth + '월 환급률');
    setEl('labor-sum-year-pay-label',     year + '년 누적 환급 예정액');
    setEl('labor-sum-year-refund-label',  year + '년 누적 환급액');
    setEl('labor-sum-year-rate-label',    year + '년 누적 환급률');

    var monthExpected = 0, monthRefund = 0;
    var yearExpected  = 0, yearRefund  = 0;

    targets.forEach(function (proj) {
      var bucket = _laborCache[proj.id];
      if (!bucket) return;
      var meta = bucket.meta || {};

      // 12개월 순회
      for (var m = 1; m <= 12; m++) {
        var ym = year + '-' + String(m).padStart(2, '0');
        var ymMeta = meta[ym] || {};
        var isConfirmed = !!ymMeta.confirmed;

        // 그 월의 planned cash 합 (환급 예정액용 — paid 조건 없음, 항상 합산)
        var planCash = 0;
        var pcells = bucket.planned || {};
        var prefix = proj.id + '_' + ym + '_';
        Object.keys(pcells).forEach(function (key) {
          if (key.indexOf(prefix) !== 0) return;
          var cell = pcells[key];
          if (cell && cell.cash) planCash += Number(cell.cash) || 0;
        });

        // 그 월의 actual cash 합 (환급액용 — confirmed인 월만)
        var actCash = 0;
        if (isConfirmed) {
          var acells = bucket.actual || {};
          Object.keys(acells).forEach(function (key) {
            if (key.indexOf(prefix) !== 0) return;
            var cell = acells[key];
            if (cell && cell.cash) actCash += Number(cell.cash) || 0;
          });
        }

        // 누적
        yearExpected += planCash;
        yearRefund   += actCash;

        // 이번 달
        if (ym === refYm) {
          monthExpected += planCash;
          monthRefund   += actCash;
        }
      }
    });

    var monthRate = monthExpected > 0 ? (monthRefund / monthExpected * 100) : 0;
    var yearRate  = yearExpected  > 0 ? (yearRefund  / yearExpected  * 100) : 0;

    setEl('labor-sum-month-pay',    formatNum(monthExpected));
    setEl('labor-sum-month-refund', formatNum(monthRefund));
    setEl('labor-sum-month-rate',   monthRate.toFixed(1));
    setEl('labor-sum-year-pay',     formatNum(yearExpected));
    setEl('labor-sum-year-refund',  formatNum(yearRefund));
    setEl('labor-sum-year-rate',    yearRate.toFixed(1));
  }

  // ── 렌더 ──────────────────────────────────────────────
  function renderLaborRefundTable() {
    var container = document.getElementById('labor-refund-table');
    if (!container) return;

    var isMonth = (currentView === 'month');
    var numBins = isMonth ? 12 : 4;
    var binLabels = isMonth
      ? ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
      : ['1분기','2분기','3분기','4분기'];

    var targets = getRefundTargetProjects();

    // 요약 카드 항상 먼저 갱신 (빈 상태에서도 0/0/0%로 표시)
    renderLaborRefundSummary(targets);

    if (!targets.length) {
      container.innerHTML = '<div class="funding-table" style="padding:0;"><div class="funding-empty">' +
        currentYear + '년 인건비 환급 추적 대상 과제가 없습니다.<br>' +
        '<span style="font-size:0.82rem;">' +
        (_companyFilter ? ('회사 「' + escapeHtml(_companyFilter) + '」의 ') : '') +
        '인건비 관리(laborManaged=true) 활성 과제가 필요합니다.' +
        '</span>' +
        '</div></div>';
      return;
    }

    // 정렬: 분류(과제 먼저) → 과제 시작일 → 이름
    targets.sort(function (a, b) {
      // 1) 분류: 과제 먼저
      var ad1 = (a.division1 === '과제') ? 0 : 1;
      var bd1 = (b.division1 === '과제') ? 0 : 1;
      if (ad1 !== bd1) return ad1 - bd1;

      var ad = (a.researchStart || a.startDate || a.submitDate || '');
      var bd = (b.researchStart || b.startDate || b.submitDate || '');
      if (ad !== bd) {
        if (!ad) return 1;
        if (!bd) return -1;
        return ad.localeCompare(bd);
      }
      var an = (a.keywords || a.keyword || a.projectName || '');
      var bn = (b.keywords || b.keyword || b.projectName || '');
      return an.localeCompare(bn);
    });

    // 각 과제의 bin 데이터 계산 + 행 누적
    var rows = [];
    var grandBins = [];
    for (var gi = 0; gi < numBins; gi++) {
      grandBins.push({ planned: 0, actual: 0, confirmed: false, hasUnconfirmed: false, confirmedMonths: 0, totalMonths: 0 });
    }
    var grandTotalPlanned = 0, grandTotalActual = 0;

    targets.forEach(function (p) {
      var bins = [];
      var totalP = 0, totalA = 0;
      var anyData = false;
      for (var bi = 0; bi < numBins; bi++) {
        var b = getProjectBinRefund(p.id, bi, isMonth);
        bins.push(b);
        totalP += b.planned;
        totalA += b.actual;
        if (b.planned > 0 || b.actual > 0) anyData = true;
        // grand 누적
        grandBins[bi].planned += b.planned;
        grandBins[bi].actual  += b.actual;
        if (b.hasUnconfirmed) grandBins[bi].hasUnconfirmed = true;
        grandBins[bi].confirmedMonths += b.confirmedMonths;
        grandBins[bi].totalMonths     += b.totalMonths;
      }
      if (!anyData) return;
      grandTotalPlanned += totalP;
      grandTotalActual  += totalA;

      rows.push({
        name: p.keywords || p.keyword || p.projectName || '(이름 없음)',
        id: p.id,
        cha: getYearIndexForProject(p, parseInt(currentYear, 10)),
        division: (p.division1 === '과제') ? 'task' : 'other',   // v6.2: 분류 배지용
        bins: bins,
        totalP: totalP,
        totalA: totalA
      });
    });

    if (!rows.length) {
      container.innerHTML = '<div class="funding-table" style="padding:0;"><div class="funding-empty">' +
        currentYear + '년 ' +
        (_companyFilter ? ('「' + escapeHtml(_companyFilter) + '」 ') : '') +
        '과제의 인건비 입력 데이터가 없습니다.<br>' +
        '<span style="font-size:0.82rem;">프로젝트별 인건비 페이지에서 데이터를 입력하세요.</span>' +
        '</div></div>';
      return;
    }

    // ── 누적 차이 계산 (옵션 2: 첫 미확정 월 이후 누적 중단) ──
    // 한 과제의 bins[]를 받아서 각 bin에서의 누적차이를 반환.
    //   firstUnconfirmedBin: 누적이 멈춘 첫 bin 인덱스 (-1이면 끝까지 확정)
    function computeCumDiffs(bins) {
      var cumDiffs = new Array(bins.length).fill(null);  // null = dash 표시
      var cumP = 0, cumA = 0;
      var stopped = false;
      var firstUnconfirmed = -1;
      for (var i = 0; i < bins.length; i++) {
        var b = bins[i];
        if (stopped) continue;  // 이미 미확정 bin이 나왔으면 이후는 null 유지
        // bin이 완전히 비어 있으면 누적은 그대로 유지하며 통과
        if (b.planned === 0 && b.actual === 0 && !b.hasUnconfirmed) {
          cumDiffs[i] = cumP - cumA;
          continue;
        }
        // bin에 데이터가 있고 미확정이 섞여 있으면 여기서 중단
        if (b.hasUnconfirmed) {
          stopped = true;
          firstUnconfirmed = i;
          continue;  // 이 bin도 dash
        }
        // 정상 확정 bin
        cumP += b.planned;
        cumA += b.actual;
        cumDiffs[i] = cumP - cumA;
      }
      return { cumDiffs: cumDiffs, firstUnconfirmed: firstUnconfirmed };
    }

    // 셀 HTML 생성
    function plannedCellHtml(b) {
      if (b.planned === 0) return '<td class="f-cell f-cell-empty">-</td>';
      return '<td class="f-cell">' + formatNum(b.planned) + '</td>';
    }
    function actualCellHtml(b) {
      // 미확정 월/분기: 회색 dash
      if (!b.confirmed && b.hasUnconfirmed) {
        var hint = (!isMonth && b.confirmedMonths > 0)
          ? '<small>(' + b.confirmedMonths + '/' + b.totalMonths + '확정)</small> '
          : '';
        if (b.actual === 0) return '<td class="f-cell f-cell-unconfirmed" title="미확정 월 포함">' + hint + '-</td>';
        return '<td class="f-cell f-cell-unconfirmed" title="미확정 월 포함 — 확정분만 표시">' + hint + formatNum(b.actual) + '</td>';
      }
      if (b.actual === 0) return '<td class="f-cell f-cell-empty">-</td>';
      return '<td class="f-cell">' + formatNum(b.actual) + '</td>';
    }
    // 미수 (음수 = 예정 초과는 표시 안 함, 미확정 이후는 null로 회색 dash)
    //   - 미확정 이후 (null)              → 회색 dash + tooltip
    //   - 그 달 예정이 없음               → dash
    //   - 누적 미수 ≤ 0 (이미 충분히 받음) → dash
    //   - 그 외 (예정 있고 누적 미수 > 0)  → 빨강 미수액
    function unpaidCellHtml(diff, b) {
      if (diff === null) {
        return '<td class="f-cell f-cell-unconfirmed" title="미확정 월 이후 — 누적 중단">-</td>';
      }
      if (!b || b.planned === 0) return '<td class="f-cell f-cell-empty">-</td>';
      if (diff <= 0)             return '<td class="f-cell f-cell-empty">-</td>';
      return '<td class="f-cell f-cell-diff-positive">' + formatNum(diff) + '</td>';
    }
    // 미수 합계 셀: 마지막 확정 누적차이 기준
    //   > 0 → 빨강 미수액
    //   ≤ 0 && 실제 합 > 0 → ✓ 완료 배지
    //   그 외 (확정된 bin 없음 등) → dash
    function getLastValidCumDiff(cumDiffs) {
      for (var i = cumDiffs.length - 1; i >= 0; i--) {
        if (cumDiffs[i] !== null) return cumDiffs[i];
      }
      return null;
    }
    function unpaidTotalHtml(cumDiffs, hasActual) {
      var lastValid = getLastValidCumDiff(cumDiffs);
      if (lastValid === null) return '<td class="f-cell f-cell-unconfirmed">-</td>';
      if (lastValid > 0) return '<td class="f-cell f-cell-diff-positive">' + formatNum(lastValid) + '</td>';
      if (hasActual)    return '<td class="f-cell"><span class="f-completed-badge">✓ 완료</span></td>';
      return '<td class="f-cell f-cell-empty">-</td>';
    }

    // 본문 tbody — 각 과제마다 3행 (예상 / 실제 / 미수)
    var tbody = rows.map(function (r) {
      var cumInfo = computeCumDiffs(r.bins);

      var badgeCls = r.division === 'task' ? 'f-division-badge--task' : 'f-division-badge--other';
      var badgeLabel = r.division === 'task' ? '과제' : '기타';
      var badge = '<span class="f-division-badge ' + badgeCls + '">' + badgeLabel + '</span>';
      var nameHtml = badge +
                     '<a href="project-labor.html?projectId=' + encodeURIComponent(r.id || '') + '" ' +
                     'style="color:#1d4ed8;text-decoration:none;">' + escapeHtml(r.name) + '</a>' +
                     (r.cha ? ' <span class="f-cha">' + escapeHtml(r.cha) + '</span>' : '');

      var plannedCells = r.bins.map(plannedCellHtml).join('');
      var actualCells  = r.bins.map(actualCellHtml).join('');
      var unpaidCells  = cumInfo.cumDiffs.map(function (d, i) { return unpaidCellHtml(d, r.bins[i]); }).join('');

      var plannedRow = '<tr class="f-row-trio-top">' +
        '<td class="f-name" rowspan="3">' + nameHtml + '</td>' +
        '<td class="f-kind f-kind-planned">예상</td>' +
        plannedCells +
        '<td class="f-cell f-cell-total">' + (r.totalP > 0 ? formatNum(r.totalP) : '-') + '</td>' +
      '</tr>';

      var actualRow = '<tr class="f-row-trio-mid">' +
        '<td class="f-kind f-kind-actual">실제</td>' +
        actualCells +
        '<td class="f-cell f-cell-total">' + (r.totalA > 0 ? formatNum(r.totalA) : '-') + '</td>' +
      '</tr>';

      var unpaidRow = '<tr class="f-row-trio-bot">' +
        '<td class="f-kind f-kind-diff">미수</td>' +
        unpaidCells +
        unpaidTotalHtml(cumInfo.cumDiffs, r.totalA > 0) +
      '</tr>';

      return plannedRow + actualRow + unpaidRow;
    }).join('');

    // 합계 행 (모든 과제 합)
    var grandCumInfo = computeCumDiffs(grandBins);
    var grandPlannedCells = grandBins.map(plannedCellHtml).join('');
    var grandActualCells  = grandBins.map(actualCellHtml).join('');
    var grandUnpaidCells  = grandCumInfo.cumDiffs.map(function (d, i) { return unpaidCellHtml(d, grandBins[i]); }).join('');

    var grandRows =
      '<tr class="f-row-grand-top">' +
        '<td class="f-name" rowspan="3"><strong>전체 합계</strong></td>' +
        '<td class="f-kind f-kind-planned"><strong>예상</strong></td>' +
        grandPlannedCells +
        '<td class="f-cell f-cell-total"><strong>' + (grandTotalPlanned > 0 ? formatNum(grandTotalPlanned) : '-') + '</strong></td>' +
      '</tr>' +
      '<tr class="f-row-grand-mid">' +
        '<td class="f-kind f-kind-actual"><strong>실제</strong></td>' +
        grandActualCells +
        '<td class="f-cell f-cell-total"><strong>' + (grandTotalActual > 0 ? formatNum(grandTotalActual) : '-') + '</strong></td>' +
      '</tr>' +
      '<tr class="f-row-grand-bot">' +
        '<td class="f-kind f-kind-diff"><strong>미수</strong></td>' +
        grandUnpaidCells +
        unpaidTotalHtml(grandCumInfo.cumDiffs, grandTotalActual > 0) +
      '</tr>';

    var headerCells = binLabels.map(function (lb) { return '<th>' + lb + '</th>'; }).join('');

    container.innerHTML =
      '<div class="funding-table-wrap">' +
        '<table class="funding-table funding-matrix labor-refund-matrix' + (isMonth ? ' funding-matrix--month' : '') + '">' +
          '<thead><tr>' +
            '<th>과제명</th>' +
            '<th class="f-th-kind">구분</th>' +
            headerCells +
            '<th>합계</th>' +
          '</tr></thead>' +
          '<tbody>' + tbody + grandRows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  // ===== 초기화 =====
  function init() {
    var yearFilter = document.getElementById('funding-year-filter');
    if (yearFilter) {
      currentYear = yearFilter.value;
      yearFilter.addEventListener('change', function () {
        currentYear = this.value;
        // 연도가 바뀌면 인건비 캐시 무효화 (renderAll → loadLaborForYear에서 재로드)
        _laborCache = {};
        _laborCacheYear = null;
        renderAll();
      });
    }

    document.querySelectorAll('.view-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.view-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentView = btn.getAttribute('data-view');
        renderAll();
      });
    });

    // 공통 회사 필터 — 두 탭 모두 적용 (v6.2)
    var chipsEl = document.getElementById('funding-company-chips');
    if (chipsEl) {
      chipsEl.querySelectorAll('.company-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          chipsEl.querySelectorAll('.company-chip').forEach(function (c) { c.classList.remove('is-active'); });
          chip.classList.add('is-active');
          _companyFilter = chip.getAttribute('data-company') || '';
          // renderAll: 입금 일정은 즉시 다시 그림, 인건비 환급은 활성 시에만 (캐시 재사용)
          renderAll();
        });
      });
    }

    // ===== 메인 탭 전환 (v6.2) =====
    // [입금 일정] | [인건비 환급]
    // - 인건비 탭은 lazy 로드: 처음 클릭됐을 때 데이터 로드
    // - 탭 전환은 DOM 표시 토글만, 데이터는 캐시되어 있으면 즉시 반영
    document.querySelectorAll('.funding-main-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nextTab = btn.getAttribute('data-tab');
        if (nextTab === currentTab) return;

        // 탭 버튼 활성 토글
        document.querySelectorAll('.funding-main-tab').forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');

        // 패널 표시 토글
        document.querySelectorAll('.funding-tab-panel').forEach(function (p) {
          p.classList.remove('is-active');
        });
        var nextPanel = document.getElementById('funding-tab-' + nextTab);
        if (nextPanel) nextPanel.classList.add('is-active');

        currentTab = nextTab;

        // 인건비 탭으로 들어왔으면 데이터 로드 (캐시되어 있으면 즉시 렌더)
        if (currentTab === 'refund') {
          loadLaborForYear();
        }
      });
    });

    if (typeof window.firestoreService === 'object' && typeof window.firestoreService.subscribeProjects === 'function') {
      window.firestoreService.subscribeProjects(function (projects) {
        allProjects = projects || [];
        renderAll();
      });
    } else {
      allProjects = [];
      renderAll();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
/**
 * 자금 관리 (funding.js)
 * - 카드: 당해 수주 / 당해 입금 / 실제 수령 / 미수
 * - 시기별 cash flow (분기/월 토글)
 * - 과제별 입금 일정 표
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

  // normalizeStatus — 자동 전환 포함 (projects.js와 동일)
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

  // ===== 메인 렌더 =====

  var allProjects = [];
  var currentYear = '2026';
  var currentView = 'quarter';  // 'quarter' | 'month'

  /**
   * yearBudget에서 plannedPayments + actualPayments를 가져옴
   * 옛 payments 형식도 자동 변환
   */
  function getPaymentsFromYb(yb) {
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

  function getYearFromDate(s) {
    return (s || '').toString().slice(0, 4);
  }
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

  function updateCards() {
    // 카드 4종: 수주 / 입금 / 실제 / 미수
    var sujuTotal = 0;
    var ipgmTotal = 0;
    var actualTotal = 0;

    allProjects.forEach(function (it) {
      var status = normalizeStatus(it);
      var isSelected = (status === '수행' || status === '종료' ||
                        status === '선정(기타)' || status === '선정 (기타)');

      if (!Array.isArray(it.yearBudgets)) return;

      it.yearBudgets.forEach(function (yb) {
        // 수주: 그 해에 시작된 연차의 support (status 조건)
        if (isSelected) {
          var ybStartYear = getYearFromDate(yb.startDate);
          if (ybStartYear === currentYear) {
            sujuTotal += Number(yb.support || 0);
          }
        }
        // 입금: 그 해 입금분 (calendarBreakdown 우선)
        ipgmTotal += supportInYear(yb, currentYear);

        // 실제 수령: actualPayments의 그 해 받은 것 (옛 payments도 호환)
        var pays = getPaymentsFromYb(yb);
        pays.actual.forEach(function (p) {
          var actualY = getYearFromDate(p.date);
          if (actualY === currentYear && p.amount) {
            actualTotal += Number(p.amount) || 0;
          }
        });
      });
    });

    var unpaid = ipgmTotal - actualTotal;

    setEl('funding-suju-total', formatNum(sujuTotal));
    setEl('funding-ipgm-total', formatNum(ipgmTotal));
    setEl('funding-actual-total', formatNum(actualTotal));
    setEl('funding-unpaid-total', formatNum(unpaid));
  }

  function renderPeriodBar() {
    var container = document.getElementById('funding-period-bar');
    if (!container) return;

    var bins;  // 분기 또는 월별 bin
    if (currentView === 'quarter') {
      bins = [
        { label: '1분기 (1-3월)', planned: 0, actual: 0 },
        { label: '2분기 (4-6월)', planned: 0, actual: 0 },
        { label: '3분기 (7-9월)', planned: 0, actual: 0 },
        { label: '4분기 (10-12월)', planned: 0, actual: 0 }
      ];
    } else {
      bins = [];
      for (var m = 1; m <= 12; m++) {
        bins.push({ label: m + '월', planned: 0, actual: 0 });
      }
    }

    // 모든 payment 순회 (옛 payments 자동 마이그레이션)
    allProjects.forEach(function (it) {
      if (!Array.isArray(it.yearBudgets)) return;
      it.yearBudgets.forEach(function (yb) {
        var pays = getPaymentsFromYb(yb);
        // 예정 — date가 currentYear인 경우
        pays.planned.forEach(function (p) {
          var pY = getYearFromDate(p.date);
          if (pY === currentYear) {
            var pM = getMonthFromDate(p.date);
            if (pM > 0) {
              var binIdx = currentView === 'quarter' ? (monthToQuarter(pM) - 1) : (pM - 1);
              if (binIdx >= 0 && binIdx < bins.length) {
                bins[binIdx].planned += Number(p.amount || 0);
              }
            }
          }
        });
        // 실제 — date 기준
        pays.actual.forEach(function (p) {
          var aY = getYearFromDate(p.date);
          if (aY === currentYear && p.amount) {
            var aM = getMonthFromDate(p.date);
            if (aM > 0) {
              var binIdx2 = currentView === 'quarter' ? (monthToQuarter(aM) - 1) : (aM - 1);
              if (binIdx2 >= 0 && binIdx2 < bins.length) {
                bins[binIdx2].actual += Number(p.amount || 0);
              }
            }
          }
        });
      });
    });

    var cls = currentView === 'quarter' ? 'period-bar--quarter' : 'period-bar--month';
    container.innerHTML = '<div class="period-bar ' + cls + '">' +
      bins.map(function (b) {
        var actualCls = b.actual > 0 ? '' : 'period-card-actual--zero';
        return '<div class="period-card">' +
          '<div class="period-card-label">' + b.label + '</div>' +
          '<div class="period-card-planned">예정 ' + formatNum(b.planned) + '</div>' +
          '<div class="period-card-actual ' + actualCls + '">실제 ' + formatNum(b.actual) + '</div>' +
        '</div>';
      }).join('') + '</div>';
  }

  function renderProjectTable() {
    var container = document.getElementById('funding-project-table');
    if (!container) return;

    // 현재 뷰에 따라 bin 수 (분기=4, 월=12)
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

    allProjects.forEach(function (it) {
      if (!Array.isArray(it.yearBudgets)) return;
      it.yearBudgets.forEach(function (yb, ybIdx) {
        var pays = getPaymentsFromYb(yb);
        if (!pays.planned.length && !pays.actual.length) return;

        var bins = [];
        for (var bi = 0; bi < numBins; bi++) {
          bins.push({ p: 0, a: 0, pc: 0, ac: 0, status: 'normal' });
        }
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

        // 누적 잔액 계산 (왼쪽부터)
        var balances = [];
        var cumBal = 0;
        for (var bii = 0; bii < numBins; bii++) {
          cumBal += bins[bii].p - bins[bii].a;
          balances.push(cumBal);
        }

        // 상태 판정
        for (var qi = 0; qi < numBins; qi++) {
          var diff = bins[qi].p - bins[qi].a;
          if (diff > 0) {
            // 미수
            // (1) 이전 선입금으로 보충됐는지 — balances[qi] < diff 이면 이전 음수 누적 있음
            if (balances[qi] < diff) {
              bins[qi].status = 'resolved';
              if (balances[qi] > 0) {
                // 부분 보충 — 잔여 표시
                bins[qi].remainingMiss = balances[qi];
              }
              // balances[qi] <= 0 → 완전 보충, 잔여 없음
            } else {
              // (2) 후속 초과로 보충
              var afterExcess = 0;
              for (var qj = qi + 1; qj < numBins; qj++) {
                afterExcess += Math.max(0, bins[qj].a - bins[qj].p);
              }
              if (afterExcess >= diff) {
                bins[qi].status = 'resolved';
              } else if (afterExcess > 0) {
                bins[qi].status = 'resolved';
                bins[qi].remainingMiss = diff - afterExcess;
              } else {
                bins[qi].status = 'overdue';
              }
            }
          } else if (diff < 0) {
            // 초과 — 다른 분기 미수 있으면 보충 중 (paid-fill), 없으면 진짜 초과 (over)
            var hasOtherMiss = false;
            for (var qk = 0; qk < numBins; qk++) {
              if (qk === qi) continue;
              if (bins[qk].p > bins[qk].a) { hasOtherMiss = true; break; }
            }
            bins[qi].status = hasOtherMiss ? 'paid-fill' : 'over';
          } else if (bins[qi].p > 0) {
            bins[qi].status = 'paid';
          }
        }

        if (!hasData) return;

        var totalP = 0, totalA = 0, totalPc = 0, totalAc = 0;
        bins.forEach(function (b) {
          totalP += b.p; totalA += b.a;
          totalPc += b.pc; totalAc += b.ac;
        });

        rows.push({
          name: it.keywords || it.keyword || it['키워드'] || it.projectName || '(이름 없음)',
          cha: (ybIdx + 1) + '차',
          id: it.id,
          bins: bins,
          totalP: totalP, totalA: totalA,
          totalPc: totalPc, totalAc: totalAc,
          balance: totalP - totalA
        });
      });
    });

    if (!rows.length) {
      container.innerHTML = '<div class="funding-table" style="padding:0;"><div class="funding-empty">' +
        currentYear + '년 입금 일정이 없습니다.<br>' +
        '<span style="font-size:0.82rem;">과제 등록/수정 페이지에서 입금 일정을 입력하세요.</span>' +
        '</div></div>';
      return;
    }

    rows.sort(function (a, b) { return b.balance - a.balance; });

    // 합계 bin
    var totalBins = [];
    for (var ti = 0; ti < numBins; ti++) {
      totalBins.push({ p: 0, a: 0, pc: 0, ac: 0, status: 'normal' });
    }
    var totalTotalP = 0, totalTotalA = 0;
    rows.forEach(function (r) {
      for (var i = 0; i < numBins; i++) {
        totalBins[i].p += r.bins[i].p;
        totalBins[i].a += r.bins[i].a;
        totalBins[i].pc += r.bins[i].pc;
        totalBins[i].ac += r.bins[i].ac;
      }
      totalTotalP += r.totalP;
      totalTotalA += r.totalA;
    });

    function plannedCellHtml(qData) {
      if (qData.p === 0) return '<td class="f-cell f-cell-empty">-</td>';
      var countTxt = qData.pc > 1 ? ' <small>(' + qData.pc + '건)</small>' : '';
      var amount = formatNum(qData.p);
      if (qData.status === 'overdue') return '<td class="f-cell f-cell-overdue">' + amount + countTxt + '</td>';
      if (qData.status === 'resolved') {
        var remainHtml = qData.remainingMiss
          ? '<div class="f-cell-remaining">잔여 ' + formatNum(qData.remainingMiss) + '</div>'
          : '';
        return '<td class="f-cell f-cell-resolved"><s>' + amount + '</s>' + countTxt + remainHtml + '</td>';
      }
      return '<td class="f-cell">' + amount + countTxt + '</td>';
    }
    function actualCellHtml(qData) {
      if (qData.a === 0) {
        if (qData.p > 0) return '<td class="f-cell f-cell-unpaid">-</td>';
        return '<td class="f-cell f-cell-empty">-</td>';
      }
      var countTxt = qData.ac > 1 ? ' <small>(' + qData.ac + '건)</small>' : '';
      var amount = formatNum(qData.a);
      if (qData.status === 'over') return '<td class="f-cell f-cell-over">' + amount + countTxt + ' \u2191</td>';
      if (qData.status === 'paid' || qData.status === 'paid-fill') return '<td class="f-cell f-cell-paid">' + amount + countTxt + ' \u2713</td>';
      return '<td class="f-cell">' + amount + countTxt + '</td>';
    }

    var tbody = rows.map(function (r) {
      var link = '<a href="project-detail.html?id=' + encodeURIComponent(r.id || '') + '" style="color:#1d4ed8;text-decoration:none;">' + escapeHtml(r.name) + '</a> <span class="f-cha">' + r.cha + '</span>';
      var balanceCls = r.balance > 0 ? ' f-balance-warn' : ' f-balance-ok';
      var balanceTxt = r.balance > 0 ? formatNum(r.balance) : '0';
      var plannedCells = r.bins.map(plannedCellHtml).join('');
      var actualCells = r.bins.map(actualCellHtml).join('');
      var plannedRow = '<tr class="f-row-pair-top">' +
        '<td class="f-name" rowspan="2">' + link + '</td>' +
        '<td class="f-kind f-kind-planned">예정</td>' +
        plannedCells +
        '<td class="f-cell f-cell-total">' + (r.totalP > 0 ? formatNum(r.totalP) : '-') + '</td>' +
        '<td class="f-balance' + balanceCls + '" rowspan="2">' + balanceTxt + '</td>' +
      '</tr>';
      var actualRow = '<tr class="f-row-pair-bot">' +
        '<td class="f-kind f-kind-actual">입금</td>' +
        actualCells +
        '<td class="f-cell f-cell-total">' + (r.totalA > 0 ? formatNum(r.totalA) : '-') + '</td>' +
      '</tr>';
      return plannedRow + actualRow;
    }).join('');

    var totalBalance = totalTotalP - totalTotalA;
    var totalBalanceCls = totalBalance > 0 ? ' f-balance-warn' : ' f-balance-ok';
    var totalBalanceTxt = totalBalance > 0 ? formatNum(totalBalance) : '0';
    var totalPlannedCells = totalBins.map(plannedCellHtml).join('');
    var totalActualCells = totalBins.map(actualCellHtml).join('');
    var totalRows =
      '<tr class="f-row-total f-row-total-top">' +
        '<td class="f-name" rowspan="2"><strong>합계</strong></td>' +
        '<td class="f-kind f-kind-planned"><strong>예정</strong></td>' +
        totalPlannedCells +
        '<td class="f-cell f-cell-total"><strong>' + (totalTotalP > 0 ? formatNum(totalTotalP) : '-') + '</strong></td>' +
        '<td class="f-balance' + totalBalanceCls + '" rowspan="2"><strong>' + totalBalanceTxt + '</strong></td>' +
      '</tr>' +
      '<tr class="f-row-total f-row-total-bot">' +
        '<td class="f-kind f-kind-actual"><strong>입금</strong></td>' +
        totalActualCells +
        '<td class="f-cell f-cell-total"><strong>' + (totalTotalA > 0 ? formatNum(totalTotalA) : '-') + '</strong></td>' +
      '</tr>';

    var headerCells = binLabels.map(function (lb) { return '<th>' + lb + '</th>'; }).join('');

    container.innerHTML =
      '<div class="funding-table-info">정확한 입금 금액은 사전 확인이 어려우므로, 총 지원금을 균등 배분한 추정값입니다.</div>' +
      '<div class="funding-table-wrap">' +
        '<table class="funding-table funding-matrix' + (isMonth ? ' funding-matrix--month' : '') + '">' +
          '<thead><tr>' +
            '<th style="text-align:left">과제명</th>' +
            '<th class="f-th-kind">구분</th>' +
            headerCells +
            '<th>합계</th>' +
            '<th>잔액</th>' +
          '</tr></thead>' +
          '<tbody>' + tbody + totalRows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function renderAll() {
    updateCards();
    renderPeriodBar();
    renderProjectTable();
  }

  // ===== 초기화 =====

  function init() {
    var yearFilter = document.getElementById('funding-year-filter');
    if (yearFilter) {
      currentYear = yearFilter.value;
      yearFilter.addEventListener('change', function () {
        currentYear = this.value;
        renderAll();
      });
    }

    document.querySelectorAll('.view-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.view-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentView = btn.getAttribute('data-view');
        renderPeriodBar();
        renderProjectTable();
      });
    });

    // Firestore 구독
    if (typeof window.firestoreService === 'object' && typeof window.firestoreService.subscribeProjects === 'function') {
      window.firestoreService.subscribeProjects(function (projects) {
        allProjects = projects || [];
        renderAll();
      });
    } else {
      // firestoreService 없는 경우 — 빈 데이터
      allProjects = [];
      renderAll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
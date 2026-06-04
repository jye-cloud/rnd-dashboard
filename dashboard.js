/**
 * R&D 통합 대시보드 (Overview)
 * - 기존 firestore-service.js 의 subscribeProjects 를 그대로 사용
 * - projects.js 와 동일한 데이터 모델 (yearBudgets, supportTotal 등) 가정
 */
(function () {
  'use strict';

  var DEFAULT_YEAR = 2026;

  // 상태별 색상 — 기존 projects-badge 색상과 톤 일치
  var STATUS_COLORS = {
    '수행': '#10b981',
    '예정':    '#3b82f6',
    '종료':    '#94a3b8',
    '미선정':  '#ef4444'
  };

  // ===== Utilities =====

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatNum(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '0';
    return Number(n).toLocaleString();
  }

  /**
   * 큰 금액을 단위가 붙은 형태로 표현
   * 1,234,567,890 -> { value: '12.3', unit: '억' }
   * 12,345,000   -> { value: '1,235', unit: '만' }
   */
  function formatMoneyParts(n) {
    var num = Number(n) || 0;
    if (num >= 100000000) {
      // 0.1억(천만원) 단위로 내림 — 반올림 없음 (27.96억 → 27.9억)
      var eok = Math.floor(num / 10000000) / 10;
      if (eok >= 100) {
        // 100억 이상은 정수 단위로 (1억 단위 내림)
        return { value: formatNum(Math.floor(num / 100000000)), unit: '억' };
      }
      return { value: eok.toFixed(1).replace(/\.0$/, ''), unit: '억' };
    }
    if (num >= 10000) {
      var man = Math.round(num / 10000);
      return { value: formatNum(man), unit: '만' };
    }
    return { value: formatNum(num), unit: '원' };
  }

  // 억 단위 — 0.1억(천만원) 단위로 내림하여 X.X 형식으로 반환 (반올림 없음)
  // 예: 2,796,000,000원 → "27.9" (28.0 아님)
  function eokFloor(amount) {
    var n = Number(amount) || 0;
    return (Math.floor(n / 10000000) / 10).toFixed(1);
  }

  function formatMoneyShort(n) {
    var p = formatMoneyParts(n);
    return p.value + p.unit;
  }

  // ===== Data helpers (projects.js 와 동일 로직) =====

  function projectOverlapsYear(it, year) {
    var y = String(year);
    var start = (it.startDate || it.start || '').toString().slice(0, 10);
    var end = (it.endDate || it.end || '').toString().slice(0, 10);
    // 시작일/종료일 둘 다 없으면 — 제출일로 매칭 (미선정/대기/선정기타 등 시작 안 한 과제)
    if (!start && !end) {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (!submitDate) return false;  // 제출일도 없으면 매칭 안 함
      return submitDate.slice(0, 4) === y;
    }
    var yearStart = y + '-01-01';
    var yearEnd = y + '-12-31';
    if (start && start > yearEnd) return false;
    if (end && end < yearStart) return false;
    return true;
  }

  function normalizeStatus(it) {
    return statusAsOf(it, null);  // null = 오늘 기준
  }

  /**
   * 주어진 시점 기준 status 판정
   * @param {Object} it - 과제
   * @param {string|null} asOfDate - 'YYYY-MM-DD' 또는 null (null이면 오늘)
   */
  function statusAsOf(it, asOfDate) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    // "선정" 입력값을 "선정(기타)"로 정규화 (옛 데이터 호환)
    if (raw === '선정') raw = '선정(기타)';
    var n = raw.replace(/\s/g, '');

    if (!asOfDate) {
      var today = new Date();
      asOfDate = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    }

    // "수행" 또는 "종료" + 종료일이 asOfDate 이전 → "종료", 이후 → "수행"
    if (n === '수행중' || n === '수행' || raw === '종료') {
      var endDate = (it.endDate || it.end || it['종료일'] || '').toString().slice(0, 10);
      if (endDate && asOfDate > endDate) return '종료';
      return '수행';
    }

    // "예정" + 제출일이 asOfDate 이전 → "대기"
    if (raw === '예정') {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submitDate && asOfDate > submitDate) return '대기';
      return '예정';
    }

    if (raw === '대기' || raw === '종료' || raw === '미선정' || raw === '미제출') return raw;

    // status 비어있을 때 — 시작일/종료일/제출일 기반 자동 판정
    if (!raw) {
      var startD  = (it.startDate || it.start || it['시작일'] || '').toString().slice(0, 10);
      var endD    = (it.endDate || it.end || it['종료일'] || '').toString().slice(0, 10);
      var submitD = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (endD && asOfDate > endD) return '종료';
      if (startD && asOfDate >= startD) {
        if (!endD || asOfDate <= endD) return '수행';
      }
      if (startD && asOfDate < startD) return '예정';
      if (submitD && asOfDate < submitD) return '예정';
      if (submitD && asOfDate > submitD) return '대기';
    }

    return raw || '미정';
  }

  /**
   * statsYear 기준 status 판정용 asOfDate
   *  - 과거 연도: 그 해 마지막 날 (예: 2024 → '2024-12-31')
   *  - 현재/미래 연도: 오늘로 cap (그래야 종료일이 미래면 '종료'로 잡히지 않음)
   */
  function yearEndDate(year) {
    var today = new Date();
    var todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var yearEnd = String(year) + '-12-31';
    return yearEnd > todayStr ? todayStr : yearEnd;
  }

  /**
   * 해당 연도와 겹치는 yearBudgets 항목들의 (support, cash, inKind) 합계
   */
  /**
   * yearBudget 행의 그 연도 지원금 (calendarBreakdown 우선, 없으면 일별 비례)
   */
  function _supportInYear(yb, year) {
    if (!yb) return 0;

    // 사용자 직접 입력값 우선
    var cb = yb.calendarBreakdown;
    if (cb && typeof cb === 'object' && cb[year] != null && cb[year] !== '') {
      return Number(cb[year]) || 0;
    }

    var s = (yb.startDate || yb.start || '').toString().slice(0, 10);
    var e = (yb.endDate   || yb.end   || '').toString().slice(0, 10);
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
   * 그 해 입금 완료액 — yearBudget.actualPayments 합 (date가 그 해인 것만)
   * 데이터 구조 가정: actualPayments = [{date: 'YYYY-MM-DD', amount: number}, ...]
   */
  function getYearActualPayments(it, year) {
    var total = 0;
    var arr = (it.yearBudgets && Array.isArray(it.yearBudgets)) ? it.yearBudgets : [];
    arr.forEach(function (yb) {
      if (!Array.isArray(yb.actualPayments)) return;
      yb.actualPayments.forEach(function (p) {
        if (!p) return;
        var d = (p.date || p.paidDate || '').toString().slice(0, 10);
        if (d.slice(0, 4) === String(year)) {
          total += Number(p.amount || 0);
        }
      });
    });
    return total;
  }

  function getYearAmounts(it, year) {
    var sup = 0, cash = 0, ink = 0;
    var arr = (it.yearBudgets && Array.isArray(it.yearBudgets)) ? it.yearBudgets : [];

    // support: 각 yearBudget의 calendarBreakdown 우선
    arr.forEach(function (y) {
      sup += _supportInYear(y, year);
    });

    // cash/inKind: 일별 비례 분배 (calendarBreakdown은 support만 다룸)
    arr.forEach(function (y) {
      var s = (y.startDate || y.start || '').toString().slice(0, 10);
      var e = (y.endDate   || y.end   || '').toString().slice(0, 10);
      if (!s || !e) return;
      var sd = new Date(s + 'T00:00:00');
      var ed = new Date(e + 'T00:00:00');
      if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) return;
      var yearStart = new Date(year + '-01-01T00:00:00');
      var yearEnd   = new Date(year + '-12-31T00:00:00');
      var oStart = sd > yearStart ? sd : yearStart;
      var oEnd   = ed < yearEnd   ? ed : yearEnd;
      if (oStart > oEnd) return;
      var totalDays = ((ed - sd) / 86400000) + 1;
      var ovDays    = ((oEnd - oStart) / 86400000) + 1;
      var ratio = (sd.getFullYear() === ed.getFullYear())
        ? (Number(year) === sd.getFullYear() ? 1 : 0)
        : (ovDays / totalDays);
      cash += Math.round(Number(y.cash   || 0) * ratio);
      ink  += Math.round(Number(y.inKind || 0) * ratio);
    });

    // yearBudgets 가 비어있는 옛 데이터 호환
    if (Number(year) === 2026 && it.supportYear != null && !isNaN(Number(it.supportYear))) {
      if (sup === 0) sup = Number(it.supportYear);
    }

    return { support: sup, cash: cash, inKind: ink };
  }

  // ===== KPI 계산 =====

  function computeKPIs(items, year) {
    var yearStr = String(year);
    var cutoff = year + '-01-01';
    var asOfDate = yearEndDate(year);  // 그 연도 시점 기준 status

    // 카드 카운트 (projects.js와 동일 로직)
    var waitingCnt = 0;
    var continueCnt = 0;
    var newCnt = 0;
    var endedCnt = 0;
    var selectedOtherCnt = 0;
    var unselectedCnt = 0;

    // 자금
    var sujuTotal = 0;       // 수주 지원금 — 그 해 시작 yearBudget.support 합 (status 수행/종료/선정기타)
    var yearSupport = 0;     // 입금 예정 지원금 — 그 해 입금 예정 금액 (총합)
    var yearSupportTask = 0;    // 입금 예정 지원금 — 과제 분류
    var yearSupportSupport = 0; // 입금 예정 지원금 — 지원사업 분류
    var yearSupportOther = 0;   // 입금 예정 지원금 — 기타 + 빈 값 (용역 제외)
    var yearActual = 0;      // 입금 완료 — 그 해 actualPayments 합
    var yearCash = 0;
    var yearInKind = 0;

    items.forEach(function (it) {
      var status = statusAsOf(it, asOfDate);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end   = (it.endDate || it.end || '').toString().slice(0, 10);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var submitYear = submitDate ? submitDate.slice(0, 4) : '';
      var endYear = end ? end.slice(0, 4) : '';

      // ── 카드 카운트 ──
      if (status === '대기' && submitYear === yearStr) waitingCnt++;
      if (status === '수행' && projectOverlapsYear(it, year)) {
        if (start && start < cutoff) continueCnt++;
        else newCnt++;
      }
      if (status === '종료' && endYear === yearStr) endedCnt++;
      if ((status === '선정(기타)' || status === '선정 (기타)') && submitYear === yearStr) selectedOtherCnt++;
      if (status === '미선정' && submitYear === yearStr) unselectedCnt++;

      // ── 수주 지원금 ── status='수행/종료/선정기타' AND yearBudget.startDate==year
      // (용역은 별도 트랙이므로 지원금 합산에서 제외)
      var isService = (it.division1 === '용역');
      var isSelected = (status === '수행' || status === '종료' ||
                        status === '선정(기타)' || status === '선정 (기타)');
      if (isSelected && !isService) {
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb, ybIdx) {
            var ybStartRaw = yb.startDate || (ybIdx === 0 ? it.startDate : '');
            var ybStartYear = (ybStartRaw || '').toString().slice(0, 4);
            if (ybStartYear !== yearStr) return;
            var sup = Number(yb.support || 0);
            if (!sup && ybIdx === 0) {
              sup = Number(it.supportTotal || it.budget || 0);
            }
            if (sup) sujuTotal += sup;
          });
        } else {
          var itStartYear = (it.startDate || '').toString().slice(0, 4);
          if (itStartYear === yearStr) {
            sujuTotal += Number(it.supportTotal || it.budget || 0);
          }
        }
      }

      // ── 입금 지원금 (그 해 실제 입금되는 금액) ── 용역 제외, 분류별로 분리
      if (!isService) {
        var amt = getYearAmounts(it, year);
        yearSupport += amt.support;
        yearCash    += amt.cash;
        yearInKind  += amt.inKind;
        // 유형별 — 과제 / 지원사업 / 기타(기타 + 빈 값). 용역은 위에서 제외됨
        if (it.division1 === '과제') {
          yearSupportTask += amt.support;
        } else if (it.division1 === '지원사업') {
          yearSupportSupport += amt.support;
        } else {
          yearSupportOther += amt.support;
        }
        // ── 입금 완료 — actualPayments 합 ──
        yearActual += getYearActualPayments(it, year);
      }
    });

    var totalForDonut = waitingCnt + continueCnt + newCnt + endedCnt + selectedOtherCnt + unselectedCnt;

    return {
      // 카드 카운트
      waiting: waitingCnt,
      continueCnt: continueCnt,
      newCnt: newCnt,
      ended: endedCnt,
      selectedOther: selectedOtherCnt,
      unselected: unselectedCnt,
      total: totalForDonut,
      // 자금
      sujuTotal: sujuTotal,
      yearSupport: yearSupport,
      yearSupportTask: yearSupportTask,
      yearSupportSupport: yearSupportSupport,
      yearSupportOther: yearSupportOther,
      yearActual: yearActual,
      yearCash: yearCash,
      yearInKind: yearInKind,
      // 알림/수행과제용 (기존 사용처 호환)
      ongoing: continueCnt + newCnt,
      filteredItems: items.filter(function (it) { return projectOverlapsYear(it, year); })
    };
  }

  // ===== Renderers =====

  // Panel 1: {연도}년 현황 — pill stats (6 카테고리)
  function renderPills(kpis, year) {
    setText('status-total-num', kpis.total);
    setText('pill-waiting', kpis.waiting);
    setText('pill-continue', kpis.continueCnt);
    setText('pill-new', kpis.newCnt);
    setText('pill-ended', kpis.ended);
    setText('pill-selected-other', kpis.selectedOther);
    setText('pill-unselected', kpis.unselected);
    // 제목 동적 (이모지 유지)
    var titleEl = document.getElementById('status-panel-title');
    if (titleEl) titleEl.innerHTML = year + '년 현황 <span aria-hidden="true">📋</span>';
  }

  // Panel 2: 지원금 현황 — 전체(메인) + 과제/지원사업/기타 + 입금 완료율
  function renderFunding(kpis, year) {
    // 카드 1: 전체 — 메인, 큰 숫자
    setText('hero-total-sum', eokFloor(kpis.yearSupport));

    // 카드 2: 과제 / 지원사업 / 기타 (미니)
    setText('hero-task-sum', eokFloor(kpis.yearSupportTask));
    setText('hero-support-sum', eokFloor(kpis.yearSupportSupport));
    setText('hero-other-sum', eokFloor(kpis.yearSupportOther));

    // 카드 3: 입금 완료율 — actualPayments / yearSupport * 100
    var planned = Number(kpis.yearSupport) || 0;
    var actual = Number(kpis.yearActual) || 0;
    var rate = planned > 0 ? (actual / planned * 100) : 0;
    setText('hero-payment-rate', rate.toFixed(1));
    // 50% 이상 → D-3 톤, 100% 이상 → D-day 톤
    var paymentRateEl = document.getElementById('hero-payment-rate');
    var paymentParent = paymentRateEl ? paymentRateEl.parentElement : null;
    if (paymentParent) {
      paymentParent.classList.remove('payment-rate--mid', 'payment-rate--full');
      if (rate >= 100) paymentParent.classList.add('payment-rate--full');
      else if (rate >= 50) paymentParent.classList.add('payment-rate--mid');
    }

    setText('funding-subtitle', year + '년 입금 예정');

    // 자금 구성 (당해) — 가로 누적 막대그래프
    var support = Number(kpis.yearSupport) || 0;
    var cash    = Number(kpis.yearCash)    || 0;
    var inKind  = Number(kpis.yearInKind)  || 0;
    var totalFunds = support + cash + inKind;

    setText('stacked-total', eokFloor(totalFunds) + '억');

    var pSupport = totalFunds > 0 ? (support / totalFunds) * 100 : 0;
    var pCash    = totalFunds > 0 ? (cash    / totalFunds) * 100 : 0;
    var pInkind  = totalFunds > 0 ? (inKind  / totalFunds) * 100 : 0;

    var segS = document.getElementById('seg-support');
    var segC = document.getElementById('seg-cash');
    var segI = document.getElementById('seg-inkind');
    if (segS) segS.style.width = pSupport.toFixed(1) + '%';
    if (segC) segC.style.width = pCash.toFixed(1) + '%';
    if (segI) segI.style.width = pInkind.toFixed(1) + '%';

    setText('legend-val-support', eokFloor(support) + '억');
    setText('legend-val-cash',    eokFloor(cash)    + '억');
    setText('legend-val-inkind',  eokFloor(inKind)  + '억');
    setText('legend-pct-support', pSupport.toFixed(0) + '%');
    setText('legend-pct-cash',    pCash.toFixed(0) + '%');
    setText('legend-pct-inkind',  pInkind.toFixed(0) + '%');

    // 입금 진행 (당해) — 입금 완료 vs 남은 예정 (기준 = 입금 예정 지원금)
    var paid = actual;                                  // 입금 완료(actualPayments 합)
    var remaining = Math.max(0, planned - paid);        // 남은 예정
    var paidW   = planned > 0 ? Math.min(100, paid / planned * 100) : 0;
    var remainW = Math.max(0, 100 - paidW);
    var segPaid = document.getElementById('seg-paid');
    var segRemain = document.getElementById('seg-remain');
    if (segPaid)   segPaid.style.width   = paidW.toFixed(1) + '%';
    if (segRemain) segRemain.style.width = remainW.toFixed(1) + '%';
    setText('legend-val-paid',   eokFloor(paid)      + '억');
    setText('legend-val-remain', eokFloor(remaining) + '억');
    setText('legend-pct-paid',   (planned > 0 ? Math.round(paid / planned * 100)      : 0) + '%');
    setText('legend-pct-remain', (planned > 0 ? Math.round(remaining / planned * 100) : 0) + '%');
  }

  // Panel 3: 임박 알림 — D-7/D-3/D-day (제출 임박 + 마일스톤) + 종료 예정
  function renderAlerts(items, year, kpis, calendarEvents) {
    var listEl = document.getElementById('alert-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString().slice(0, 10);

    // 이번 달 마지막 날 (종료 예정 기간)
    var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    var monthEndStr = monthEnd.toISOString().slice(0, 10);

    var d7Count = 0, d3Count = 0, ddayCount = 0;
    var endingCount = 0;
    var endingList = [];
    var submitList = [];

    items.forEach(function (it) {
      var name = it.projectName || it.keywords || '(제목 없음)';

      // 제출 임박 (상태 무관, D-day 단계별 카운트 — 서로 겹치지 않음)
      var submit = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submit && submit >= todayStr) {
        var diffS = Math.round((new Date(submit) - today) / (1000 * 60 * 60 * 24));
        if (diffS === 0) ddayCount++;
        else if (diffS >= 1 && diffS <= 3) d3Count++;
        else if (diffS >= 4 && diffS <= 7) d7Count++;

        if (diffS >= 0 && diffS <= 7) {
          submitList.push({ name: name, date: submit, dDay: diffS, type: 'submit' });
        }
      }

      // 종료 예정 (수행 상태, 이번 달 안에 종료)
      if (normalizeStatus(it) === '수행') {
        var end = (it.endDate || it.end || '').toString().slice(0, 10);
        if (end && end >= todayStr && end <= monthEndStr) {
          endingCount++;
          var diffE = Math.round((new Date(end) - today) / (1000 * 60 * 60 * 24));
          endingList.push({ name: name, date: end, dDay: Math.max(0, diffE), type: 'end' });
        }
      }
    });

    // 마일스톤 임박 추가 (caleandarEvents 의 type='milestone' + 미완료 + D-7 이내)
    var milestoneList = [];
    (calendarEvents || []).forEach(function (ev) {
      if (ev.type !== 'milestone') return;
      if (ev.done) return;
      var date = (ev.date || '').toString().slice(0, 10);
      if (!date || date < todayStr) return;
      var diffM = Math.round((new Date(date) - today) / (1000 * 60 * 60 * 24));
      if (diffM > 7) return;
      var label = (ev.projectTitle || '') + (ev.item ? ' · ' + ev.item : '');
      if (diffM === 0) ddayCount++;
      else if (diffM >= 1 && diffM <= 3) d3Count++;
      else if (diffM >= 4 && diffM <= 7) d7Count++;
      milestoneList.push({ name: label, date: date, dDay: diffM, type: 'milestone' });
    });

    setText('alert-d7', d7Count);
    setText('alert-d3', d3Count);
    setText('alert-dday', ddayCount);
    setText('alert-ending', endingCount);

    // 통합 알림 리스트 — D-day 가까운 순
    var allAlerts = submitList.concat(milestoneList).concat(endingList);
    allAlerts.sort(function (a, b) { return a.dDay - b.dDay; });

    if (allAlerts.length === 0) {
      listEl.innerHTML = '<div class="alert-empty">임박한 알림이 없습니다.</div>';
      return;
    }

    allAlerts.slice(0, 4).forEach(function (a) {
      var div = document.createElement('div');
      div.className = 'alert-mini-item';
      var icon, label;
      if (a.type === 'end') { icon = '⏰'; label = '종료'; }
      else if (a.type === 'milestone') { icon = '🚩'; label = '마일스톤'; }
      else { icon = '📝'; label = '제출'; }
      div.innerHTML =
        '<span class="alert-mini-icon">' + icon + '</span>' +
        '<div class="alert-mini-text">' +
          '<strong>' + escapeHtml(a.name) + '</strong>' +
          '<div class="alert-mini-meta">D-' + a.dDay + ' · ' + label + ' ' + escapeHtml(a.date) + '</div>' +
        '</div>';
      listEl.appendChild(div);
    });
  }

  // Donut chart — 6 카테고리 (대기/수행계속/수행신규/종료/선정기타/미선정)
  function renderDonut(kpis, year) {
    var data = [
      { key: '대기',         filter: 'waiting',        value: kpis.waiting,       color: '#fef3c7' },
      { key: '수행 (계속)',  filter: 'continue',       value: kpis.continueCnt,   color: '#d1fae5' },
      { key: '수행 (신규)',  filter: 'new',            value: kpis.newCnt,        color: '#ccfbf1' },
      { key: '종료',         filter: 'ended',          value: kpis.ended,         color: '#e5e7eb' },
      { key: '선정 (기타)',  filter: 'selected-other', value: kpis.selectedOther, color: '#ecfccb' },
      { key: '미선정',       filter: 'unselected',     value: kpis.unselected,    color: '#fee2e2' }
    ];
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    setText('donut-total', total);
    setText('donut-meta', '기준 연도: ' + year);

    var svg = document.getElementById('donut-svg');
    if (!svg) return;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var cx = 100, cy = 100, r = 70, sw = 22;
    var C = 2 * Math.PI * r;

    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', cx);
    bg.setAttribute('cy', cy);
    bg.setAttribute('r', r);
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', '#f1f5f9');
    bg.setAttribute('stroke-width', sw);
    svg.appendChild(bg);

    // 외곽선용 반지름 + 색 (안/밖 동그라미는 같은 옅은 회색, 조각 사이 직선은 더 명확)
    var rOuter = r + sw / 2;
    var rInner = r - sw / 2;
    var COuter = 2 * Math.PI * rOuter;
    var CInner = 2 * Math.PI * rInner;
    var ringStroke = '#e2e8f0';   // 안/밖 동그라미
    var sliceStroke = '#e2e8f0';  // 조각 사이 직선 (동일 톤)

    if (total > 0) {
      var offset = 0;
      data.forEach(function (d) {
        if (d.value <= 0) return;
        var frac = d.value / total;
        var len = frac * C;

        // 메인 조각 (파스텔 채움)
        var arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('cx', cx);
        arc.setAttribute('cy', cy);
        arc.setAttribute('r', r);
        arc.setAttribute('fill', 'none');
        arc.setAttribute('stroke', d.color);
        arc.setAttribute('stroke-width', sw);
        arc.setAttribute('stroke-linecap', 'butt');
        arc.setAttribute('stroke-dasharray', len + ' ' + (C - len));
        arc.setAttribute('stroke-dashoffset', String(-offset));
        arc.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
        arc.setAttribute('data-filter', d.filter);  // 카드 호버 매칭용
        // 호버 툴팁 — 브라우저 기본 native tooltip (마우스 가져가면 표시)
        var arcTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        arcTitle.textContent = d.key + ': ' + d.value + '건';
        arc.appendChild(arcTitle);
        svg.appendChild(arc);

        // 도넛 바깥 동그라미 — 옅은 회색
        var lenOut = frac * COuter;
        var arcOuter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arcOuter.setAttribute('cx', cx);
        arcOuter.setAttribute('cy', cy);
        arcOuter.setAttribute('r', rOuter);
        arcOuter.setAttribute('fill', 'none');
        arcOuter.setAttribute('stroke', ringStroke);
        arcOuter.setAttribute('stroke-width', 1);
        arcOuter.setAttribute('stroke-dasharray', lenOut + ' ' + (COuter - lenOut));
        arcOuter.setAttribute('stroke-dashoffset', String(-offset * COuter / C));
        arcOuter.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
        svg.appendChild(arcOuter);

        // 도넛 안쪽 동그라미 — 옅은 회색 (외부와 동일)
        var lenIn = frac * CInner;
        var arcInner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arcInner.setAttribute('cx', cx);
        arcInner.setAttribute('cy', cy);
        arcInner.setAttribute('r', rInner);
        arcInner.setAttribute('fill', 'none');
        arcInner.setAttribute('stroke', ringStroke);
        arcInner.setAttribute('stroke-width', 1);
        arcInner.setAttribute('stroke-dasharray', lenIn + ' ' + (CInner - lenIn));
        arcInner.setAttribute('stroke-dashoffset', String(-offset * CInner / C));
        arcInner.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
        svg.appendChild(arcInner);

        // 조각 시작 지점의 radial 구분선 (안쪽 → 바깥쪽)
        var startAngle = -Math.PI / 2 + (offset / C) * 2 * Math.PI;
        var x1 = cx + rInner * Math.cos(startAngle);
        var y1 = cy + rInner * Math.sin(startAngle);
        var x2 = cx + rOuter * Math.cos(startAngle);
        var y2 = cy + rOuter * Math.sin(startAngle);
        var sliceLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        sliceLine.setAttribute('x1', x1);
        sliceLine.setAttribute('y1', y1);
        sliceLine.setAttribute('x2', x2);
        sliceLine.setAttribute('y2', y2);
        sliceLine.setAttribute('stroke', sliceStroke);
        sliceLine.setAttribute('stroke-width', 1);
        svg.appendChild(sliceLine);

        offset += len;
      });
    }

    var legend = document.getElementById('donut-legend');
    if (!legend) return;
    legend.innerHTML = '';
    data.forEach(function (d) {
      var pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
      var item = document.createElement('div');
      item.className = 'donut-legend-item';
      item.innerHTML =
        '<span class="donut-legend-dot" style="background:' + d.color + '"></span>' +
        '<span class="donut-legend-label">' + escapeHtml(d.key) + '</span>' +
        '<span class="donut-legend-count">' + d.value + '</span>' +
        '<span class="donut-legend-pct">(' + pct + '%)</span>';
      item.addEventListener('click', function () {
        window.location.href = 'projects.html?filter=' + d.filter;
      });
      legend.appendChild(item);
    });
  }

  // 수행 과제 (table) — 키워드 / 과제명 / 당해 지원금, 당해 지원금 내림차순
  function renderRecent(items, year) {
    var table = document.getElementById('recent-table');
    var tbody = document.getElementById('recent-tbody');
    var empty = document.getElementById('recent-empty');
    if (!table || !tbody || !empty) return;

    var asOfDate = yearEndDate(year);
    // 수행 과제만 + 그 해 당해 지원금 사전 계산 (용역은 별도 트랙이므로 제외)
    var ongoing = items.filter(function (it) {
      if (it.division1 === '용역') return false;
      return statusAsOf(it, asOfDate) === '수행' && projectOverlapsYear(it, year);
    }).map(function (it) {
      var amt = getYearAmounts(it, year);
      var amount = amt.support || it.supportYear || 0;
      return { it: it, amount: Number(amount) || 0 };
    });
    // 당해 지원금 내림차순
    ongoing.sort(function (a, b) { return b.amount - a.amount; });
    var top5 = ongoing.slice(0, 5);

    tbody.innerHTML = '';

    if (top5.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    top5.forEach(function (entry) {
      var it = entry.it;
      var keyword = it.keywords || it.keyword || it['키워드'] || '-';
      var name = it.projectName || it['과제명'] || '(제목 없음)';
      var org = it.institution || it['기관명'] || '-';

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><div class="recent-keyword" title="' + escapeHtml(keyword) + '">' + escapeHtml(keyword) + '</div></td>' +
        '<td><div class="recent-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div></td>' +
        '<td><div class="recent-org" title="' + escapeHtml(org) + '">' + escapeHtml(org) + '</div></td>' +
        '<td class="recent-amount">' + formatMoneyShort(entry.amount) + '</td>';
      tr.addEventListener('click', function () {
        window.location.href = 'projects.html';
      });
      tbody.appendChild(tr);
    });
  }

  // 수행 용역 (table) — 키워드 / 용역명 / 기관명 / 종료일, 종료일 가까운 순 (오름차순)
  function renderRecentServices(items, year) {
    var table = document.getElementById('recent-service-table');
    var tbody = document.getElementById('recent-service-tbody');
    var empty = document.getElementById('recent-service-empty');
    if (!table || !tbody || !empty) return;

    var asOfDate = yearEndDate(year);
    // division1 === '용역' AND 수행 중 AND 그 해와 겹치는 것
    var ongoing = items.filter(function (it) {
      if (it.division1 !== '용역') return false;
      return statusAsOf(it, asOfDate) === '수행' && projectOverlapsYear(it, year);
    });
    // 종료일 가까운 순 (오름차순). 종료일 없는 건 가장 아래
    ongoing.sort(function (a, b) {
      var ae = (a.endDate || '').toString();
      var be = (b.endDate || '').toString();
      if (!ae && !be) return 0;
      if (!ae) return 1;
      if (!be) return -1;
      return ae.localeCompare(be);
    });
    var top5 = ongoing.slice(0, 5);

    tbody.innerHTML = '';

    if (top5.length === 0) {
      table.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    top5.forEach(function (it) {
      var keyword = it.keywords || it.keyword || it['키워드'] || '-';
      var name = it.projectName || it['과제명'] || '(제목 없음)';
      var org = it.institution || it['기관명'] || '-';
      var endDate = it.endDate || it['종료일'] || '-';

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><div class="recent-keyword" title="' + escapeHtml(keyword) + '">' + escapeHtml(keyword) + '</div></td>' +
        '<td><div class="recent-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div></td>' +
        '<td><div class="recent-org" title="' + escapeHtml(org) + '">' + escapeHtml(org) + '</div></td>' +
        '<td class="recent-amount">' + escapeHtml(endDate) + '</td>';
      tr.addEventListener('click', function () {
        window.location.href = 'projects.html';
      });
      tbody.appendChild(tr);
    });
  }

  // ===== Init =====

  function init() {
    // Sidebar toggle (기존 패턴과 동일)
    var sidebar = document.getElementById('sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('sidebar--collapsed');
        try {
          localStorage.setItem('hr-sidebar-collapsed', sidebar.classList.contains('sidebar--collapsed') ? '1' : '');
        } catch (e) {}
      });
      try {
        if (localStorage.getItem('hr-sidebar-collapsed') === '1') sidebar.classList.add('sidebar--collapsed');
      } catch (e) {}
    }

    // {연도}년 현황 카드 클릭 → projects.html 카드 필터로 이동
    document.querySelectorAll('.status-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var filter = card.getAttribute('data-filter') || '';
        var url = filter ? 'projects.html?filter=' + encodeURIComponent(filter) : 'projects.html';
        window.location.href = url;
      });
      // 카드 호버 시 도넛의 해당 조각 강조
      var filter = card.getAttribute('data-filter');
      if (filter) {
        card.addEventListener('mouseenter', function () {
          var arc = document.querySelector('#donut-svg circle[data-filter="' + filter + '"]');
          if (arc) arc.classList.add('donut-slice-highlight');
        });
        card.addEventListener('mouseleave', function () {
          var arc = document.querySelector('#donut-svg circle[data-filter="' + filter + '"]');
          if (arc) arc.classList.remove('donut-slice-highlight');
        });
      }
    });

    var yearSelect = document.getElementById('dash-year');
    var latestItems = [];
    var latestCalendarEvents = [];
    var currentYear = DEFAULT_YEAR;

    // 월별 신규 제안 차트 (총 신규 제안 카드 + 분류 pill + 스택 막대 + 월별 총합 라인)
    var monthlyChart = null;
    var datalabelsRegistered = false;

    function renderMonthlyProposalCard(items, year) {
      items = Array.isArray(items) ? items : [];
      var yearStr = String(year);

      // B 기준 — 제출일이 그 연도
      var submitYearItems = items.filter(function (it) {
        var sd = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
        return sd.slice(0, 4) === yearStr;
      });

      // 총 신규 제안 + 분류 카운트
      setText('dash-stat-total', submitYearItems.length);
      var divCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
      submitYearItems.forEach(function (it) {
        var d = (it.division1 || it['구분1'] || '').toString();
        if (divCounts.hasOwnProperty(d)) divCounts[d]++;
      });
      Object.keys(divCounts).forEach(function (d) {
        setText('dash-stat-div-' + d, divCounts[d]);
      });

      // 차트
      var canvas = document.getElementById('dash-monthly-proposal-chart');
      if (!canvas || typeof Chart === 'undefined') return;

      if (!datalabelsRegistered && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
        datalabelsRegistered = true;
      }

      var byType = {
        '과제':     new Array(12).fill(0),
        '지원사업': new Array(12).fill(0),
        '용역':     new Array(12).fill(0),
        '기타':     new Array(12).fill(0)
      };
      submitYearItems.forEach(function (it) {
        var sd = (it.submitDate || it['제출일'] || '').toString();
        if (!sd) return;
        var mo = parseInt(sd.slice(5, 7), 10);
        if (isNaN(mo) || mo < 1 || mo > 12) return;
        var d = (it.division1 || it['구분1'] || '기타').toString();
        if (byType.hasOwnProperty(d)) byType[d][mo - 1] += 1;
      });

      // 월별 총합 (유형별 막대 합계)
      var monthlyTotal = new Array(12).fill(0);
      for (var i = 0; i < 12; i++) {
        monthlyTotal[i] = byType['과제'][i] + byType['지원사업'][i] + byType['용역'][i] + byType['기타'][i];
      }

      if (monthlyChart) {
        try { monthlyChart.destroy(); } catch (e) {}
      }

      var barDatalabels = {
        color: '#374151',
        font: { weight: '700', size: 10 },
        formatter: function (v) { return v > 0 ? v : ''; }
      };

      monthlyChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
          datasets: [
            { label: '과제',     data: byType['과제'],     backgroundColor: '#dbeafe', borderColor: '#bfdbfe', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '지원사업', data: byType['지원사업'], backgroundColor: '#d1fae5', borderColor: '#a7f3d0', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '용역',     data: byType['용역'],     backgroundColor: '#ffedd5', borderColor: '#fed7aa', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '기타',     data: byType['기타'],     backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            {
              type: 'line', label: '월별 총합', data: monthlyTotal,
              borderColor: '#1d4ed8', backgroundColor: 'rgba(29, 78, 216, 0.08)',
              tension: 0, pointBackgroundColor: '#1d4ed8',
              pointRadius: 3, pointHoverRadius: 5, borderWidth: 1.8,
              fill: false, order: 0,
              datalabels: {
                anchor: 'end', align: 'top', offset: 4,
                color: '#1d4ed8', font: { weight: '700', size: 11 },
                formatter: function (v) { return v > 0 ? v : ''; }
              }
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 28 } },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: '#f3f4f6' } }
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 14, boxHeight: 14, padding: 12, font: { size: 12 } }
            },
            tooltip: {
              callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y + '건'; } }
            }
          }
        }
      });
    }

    function rerender() {
      // 회사 필터 (전 페이지 공유)
      var company = (window.CompanyFilter && window.CompanyFilter.get) ? window.CompanyFilter.get() : '';
      var items = company
        ? latestItems.filter(function (it) { return it && it.company === company; })
        : latestItems;

      var kpis = computeKPIs(items, currentYear);
      renderPills(kpis, currentYear);
      renderFunding(kpis, currentYear);
      renderAlerts(items, currentYear, kpis, latestCalendarEvents);
      renderDonut(kpis, currentYear);
      renderRecent(items, currentYear);
      renderRecentServices(items, currentYear);
      renderMonthlyProposalCard(items, currentYear);

      // 동적 링크 갱신 — 현재 연도 인계
      var recentLink = document.getElementById('recent-link');
      if (recentLink) {
        // 수행 과제 전체 보기 = 수행 중 + 용역 제외 + 그 해
        recentLink.href = 'projects.html?filter=ongoing&excludeDivision=' + encodeURIComponent('용역') + '&year=' + currentYear;
      }
      var recentServiceLink = document.getElementById('recent-service-link');
      if (recentServiceLink) {
        // 수행 용역 전체 보기 = 수행 중 + 용역만 + 그 해
        recentServiceLink.href = 'projects.html?filter=ongoing&division=' + encodeURIComponent('용역') + '&year=' + currentYear;
      }
    }

    // 카테고리 pill 클릭 → projects.html?newProposal=1&division=X&year=Y
    document.querySelectorAll('.division-pill[data-division]').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var division = pill.getAttribute('data-division');
        if (!division) return;
        var url = 'projects.html?newProposal=1&division=' + encodeURIComponent(division) + '&year=' + currentYear;
        window.location.href = url;
      });
    });

    // PDF 저장 버튼 — 현재 대시보드 화면을 PDF로
    var pdfBtn = document.getElementById('dash-pdf-btn');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', function () {
        // 푸터에 오늘 날짜 채우기 (YYYY. MM. DD. 형식)
        var footer = document.getElementById('print-footer');
        if (footer) {
          var d = new Date();
          var pad = function (n) { return n < 10 ? '0' + n : String(n); };
          var dateText = d.getFullYear() + '. ' + pad(d.getMonth() + 1) + '. ' + pad(d.getDate()) + '.';
          footer.textContent = '작성일: ' + dateText;
        }
        alert('인쇄 대화상자가 열립니다.\n\n저장 방법:\n1. "프린터" 또는 "대상"에서\n2. "PDF로 저장" 선택\n3. "배경 그래픽" 옵션 활성화 권장 (색상 유지)\n4. 저장 위치 지정 후 저장');
        setTimeout(function () { window.print(); }, 100);
      });
    }

    if (yearSelect) {
      yearSelect.addEventListener('change', function () {
        currentYear = parseInt(yearSelect.value, 10) || DEFAULT_YEAR;
        rerender();
      });
    }

    // 회사 필터 칩 (전 페이지 공유)
    if (window.CompanyFilter) {
      window.CompanyFilter.mountChips('dash-company-chips', function () {
        rerender();
      });
    }

    // Firestore 구독 — projects.js 와 동일 패턴
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        latestItems = Array.isArray(items) ? items : [];
        rerender();
      });
    } else {
      rerender();
    }

    // 캘린더 이벤트 구독 — 마일스톤이 일정 알림 카드에 반영되게
    if (svc && typeof svc.subscribeCalendar === 'function') {
      svc.subscribeCalendar(function (events) {
        latestCalendarEvents = Array.isArray(events) ? events : [];
        rerender();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
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
      var eok = num / 100000000;
      return { value: eok.toFixed(eok >= 100 ? 0 : 1).replace(/\.0$/, ''), unit: '억' };
    }
    if (num >= 10000) {
      var man = Math.round(num / 10000);
      return { value: formatNum(man), unit: '만' };
    }
    return { value: formatNum(num), unit: '원' };
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
    var filtered = items.filter(function (it) { return projectOverlapsYear(it, year); });
    var ongoing = 0, ongoingCont = 0, ongoingNew = 0;
    var planned = 0, ended = 0, unselected = 0;
    var yearSupport = 0, yearCash = 0, yearInKind = 0;
    var totalSum = 0;
    var cutoff = year + '-01-01';
    var asOfDate = yearEndDate(year);  // 그 연도 시점 기준 status

    filtered.forEach(function (it) {
      var status = statusAsOf(it, asOfDate);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);

      if (status === '수행') {
        ongoing++;
        if (start && start < cutoff) ongoingCont++;
        else ongoingNew++;
      } else if (status === '예정') {
        planned++;
      } else if (status === '종료') {
        ended++;
      } else if (status === '미선정') {
        unselected++;
      }

      var amt = getYearAmounts(it, year);
      yearSupport += amt.support;
      yearCash    += amt.cash;
      yearInKind  += amt.inKind;

      var st = it.supportTotal != null ? Number(it.supportTotal)
             : (it.budget != null ? Number(it.budget) : 0);
      if (!isNaN(st)) totalSum += st;
    });

    return {
      total: filtered.length,
      ongoing: ongoing,
      ongoingCont: ongoingCont,
      ongoingNew: ongoingNew,
      planned: planned,
      ended: ended,
      unselected: unselected,
      yearSupport: yearSupport,
      yearCash: yearCash,
      yearInKind: yearInKind,
      yearTotal: yearSupport + yearCash + yearInKind,
      totalSum: totalSum,
      filteredItems: filtered
    };
  }

  // ===== Renderers =====

  // Panel 1: 지원 현황 — pill stats
  function renderPills(kpis, year) {
    setText('pill-total', kpis.total);
    setText('pill-ongoing', kpis.ongoing);
    setText('pill-planned', kpis.planned);
    setText('pill-ended', kpis.ended);
    setText('pill-unselected', kpis.unselected);
    setText('status-subtitle', year + '년 기준');
  }

  // Panel 2: 자금 현황 — big stats + mini bars
  function renderFunding(kpis, year) {
    var yp = formatMoneyParts(kpis.yearSupport);
    setText('hero-year-sum', yp.value);
    setText('hero-year-unit', ' ' + yp.unit);

    var tp = formatMoneyParts(kpis.totalSum);
    setText('hero-total-sum', tp.value);
    setText('hero-total-unit', ' ' + tp.unit);

    setText('funding-subtitle', year + '년 누적 / 전체');

    var support = kpis.yearSupport;
    var cash    = kpis.yearCash;
    var inKind  = kpis.yearInKind;
    var max = Math.max(support, cash, inKind, 1);

    var bs = document.getElementById('mini-bar-support');
    var bc = document.getElementById('mini-bar-cash');
    var bi = document.getElementById('mini-bar-inkind');
    if (bs) bs.style.width = ((support / max) * 100).toFixed(1) + '%';
    if (bc) bc.style.width = ((cash    / max) * 100).toFixed(1) + '%';
    if (bi) bi.style.width = ((inKind  / max) * 100).toFixed(1) + '%';

    setText('mini-val-support', formatMoneyShort(support));
    setText('mini-val-cash',    formatMoneyShort(cash));
    setText('mini-val-inkind',  formatMoneyShort(inKind));
  }

  // Panel 3: 알림 / 임박
  function renderAlerts(items, year, kpis) {
    var listEl = document.getElementById('alert-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var soon = new Date();
    soon.setDate(soon.getDate() + 30);
    var soonStr = soon.toISOString().slice(0, 10);

    var dueSoon = [];
    items.forEach(function (it) {
      if (normalizeStatus(it) !== '수행') return;
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      if (!end) return;
      if (end >= todayStr && end <= soonStr) {
        var name = it.projectName || it.keywords || '(제목 없음)';
        var diff = Math.ceil((new Date(end) - today) / (1000 * 60 * 60 * 24));
        dueSoon.push({ name: name, end: end, dDay: Math.max(0, diff) });
      }
    });

    setText('alert-due-count', dueSoon.length);
    setText('alert-unselected-count', kpis.unselected);

    if (dueSoon.length === 0) {
      listEl.innerHTML = '<div class="alert-empty">임박한 종료 과제가 없습니다.</div>';
      return;
    }

    // 가까운 순으로 정렬, 최대 4개 노출
    dueSoon.sort(function (a, b) { return a.dDay - b.dDay; });
    dueSoon.slice(0, 4).forEach(function (a) {
      var div = document.createElement('div');
      div.className = 'alert-mini-item';
      div.innerHTML =
        '<span class="alert-mini-icon">⏰</span>' +
        '<div class="alert-mini-text">' +
          '<strong>' + escapeHtml(a.name) + '</strong>' +
          '<div class="alert-mini-meta">D-' + a.dDay + ' · 종료 ' + escapeHtml(a.end) + '</div>' +
        '</div>';
      listEl.appendChild(div);
    });
  }

  // Donut chart
  function renderDonut(kpis, year) {
    var data = [
      { key: '수행', value: kpis.ongoing,   color: STATUS_COLORS['수행'] },
      { key: '예정',    value: kpis.planned,    color: STATUS_COLORS['예정'] },
      { key: '종료',    value: kpis.ended,      color: STATUS_COLORS['종료'] },
      { key: '미선정',  value: kpis.unselected, color: STATUS_COLORS['미선정'] }
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

    if (total > 0) {
      var offset = 0;
      data.forEach(function (d) {
        if (d.value <= 0) return;
        var frac = d.value / total;
        var len = frac * C;
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
        svg.appendChild(arc);
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
        window.location.href = 'projects.html?status=' + encodeURIComponent(d.key);
      });
      legend.appendChild(item);
    });
  }

  // 수행 과제 (table)
  function renderRecent(items, year) {
    var table = document.getElementById('recent-table');
    var tbody = document.getElementById('recent-tbody');
    var empty = document.getElementById('recent-empty');
    if (!table || !tbody || !empty) return;

    var asOfDate = yearEndDate(year);
    var ongoing = items.filter(function (it) {
      return statusAsOf(it, asOfDate) === '수행' && projectOverlapsYear(it, year);
    });
    ongoing.sort(function (a, b) {
      var sa = (a.startDate || a.start || '').toString();
      var sb = (b.startDate || b.start || '').toString();
      return sb.localeCompare(sa);
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
      var name = it.projectName || it['과제명'] || it.keywords || it.keyword || '(제목 없음)';
      var manager = it.manager || it['책임자'] || '-';
      var amt = getYearAmounts(it, year);
      var amount = amt.support || it.supportYear || 0;

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="projects-badge projects-badge--ongoing">수행</span></td>' +
        '<td><div class="recent-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div></td>' +
        '<td>' + escapeHtml(manager) + '</td>' +
        '<td class="recent-amount">' + formatMoneyShort(amount) + '</td>';
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

    // 지원 현황 pill 클릭 → projects.html 로 필터 이동
    document.querySelectorAll('.pill-stat').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var status = pill.getAttribute('data-status') || '';
        var url = status ? 'projects.html?status=' + encodeURIComponent(status) : 'projects.html';
        window.location.href = url;
      });
    });

    var yearSelect = document.getElementById('dash-year');
    var latestItems = [];
    var currentYear = DEFAULT_YEAR;

    // 월별 신규 제안 차트 (총 신규 제안 카드 + 분류 pill + 스택 막대 + 누적 라인)
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

      var cumulative = new Array(12).fill(0);
      var cum = 0;
      for (var i = 0; i < 12; i++) {
        cum += byType['과제'][i] + byType['지원사업'][i] + byType['용역'][i] + byType['기타'][i];
        cumulative[i] = cum;
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
            { label: '과제',     data: byType['과제'],     backgroundColor: '#93c5fd', borderColor: '#60a5fa', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '지원사업', data: byType['지원사업'], backgroundColor: '#6ee7b7', borderColor: '#34d399', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '용역',     data: byType['용역'],     backgroundColor: '#fdba74', borderColor: '#fb923c', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '기타',     data: byType['기타'],     backgroundColor: '#cbd5e1', borderColor: '#94a3b8', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            {
              type: 'line', label: '누적', data: cumulative,
              borderColor: '#1d4ed8', backgroundColor: 'rgba(29, 78, 216, 0.08)',
              tension: 0.25, pointBackgroundColor: '#1d4ed8',
              pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5,
              fill: false, order: 1,
              datalabels: {
                anchor: 'end', align: 'top', offset: 4,
                color: '#1d4ed8', font: { weight: '700', size: 11 },
                formatter: function (v, ctx) {
                  var idx = ctx.dataIndex;
                  if (idx === 0) return v;
                  var prev = ctx.dataset.data[idx - 1];
                  return v !== prev ? v : '';
                }
              }
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 16 } },
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
      var kpis = computeKPIs(latestItems, currentYear);
      renderPills(kpis, currentYear);
      renderFunding(kpis, currentYear);
      renderAlerts(latestItems, currentYear, kpis);
      renderDonut(kpis, currentYear);
      renderRecent(latestItems, currentYear);
      renderMonthlyProposalCard(latestItems, currentYear);

      var meta = document.getElementById('dash-meta');
      if (meta) meta.textContent = currentYear + '년 R&D 과제 통합 현황';
    }

    if (yearSelect) {
      yearSelect.addEventListener('change', function () {
        currentYear = parseInt(yearSelect.value, 10) || DEFAULT_YEAR;
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * projects-summary.html 로직
 * 수행 중인 과제/지원사업(용역 제외)을 카드 그리드로 표시
 * - 시작일 오름차순 정렬 (오래된 것부터)
 * - 카드 클릭 시 project-summary.html?id=...로 이동
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString('ko-KR');
  }

  function formatMoneyShort(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '억';
    if (n >= 1e4) return (n / 1e4).toFixed(0) + '만';
    return formatNum(n);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // 진행률 계산 (시간 기반) — 0~100
  function calcProgress(startDate, endDate) {
    if (!startDate || !endDate) return null;
    var today = todayStr();
    if (today < startDate) return 0;
    if (today > endDate) return 100;
    var s = new Date(startDate).getTime();
    var e = new Date(endDate).getTime();
    var t = new Date(today).getTime();
    if (e === s) return 100;
    var pct = ((t - s) / (e - s)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  // 수행 중 판정 — 오늘 기준 startDate ≤ today ≤ endDate AND status='수행' (statusAsOf 단순화)
  function isOngoingNow(item) {
    var status = (item.status || '').toString().trim();
    var start = (item.startDate || '').toString();
    var end = (item.endDate || '').toString();
    var today = todayStr();
    // status가 '수행'이고 오늘이 기간 내
    if (status === '수행' || status === '수행중') {
      if (!start || today < start) return false;
      if (!end || today > end) {
        // 종료일 지났으면 종료로 간주
        if (end && today > end) return false;
      }
      return true;
    }
    return false;
  }

  // 진행률 총액 (정부지원금 + 자부담금 현금/현물 합)
  function calcTotalBudget(item) {
    var ybs = item.yearBudgets || [];
    if (!Array.isArray(ybs) || ybs.length === 0) return Number(item.supportTotal) || Number(item.budget) || 0;
    var total = 0;
    ybs.forEach(function (yb) {
      var support = Number(yb.support) || 0;
      var cash = Number(yb.cash) || 0;
      var inKind = Number(yb.inKind) || 0;
      total += support + cash + inKind;
    });
    return total;
  }

  // 정부지원금 합계만
  function calcSupportTotal(item) {
    var ybs = item.yearBudgets || [];
    if (!Array.isArray(ybs) || ybs.length === 0) return Number(item.supportTotal) || Number(item.budget) || 0;
    return ybs.reduce(function (s, yb) { return s + (Number(yb.support) || 0); }, 0);
  }

  function renderCard(item) {
    var name = item.projectName || item['과제명'] || '(제목 없음)';
    var business = item.business || item['사업명'] || '';
    var division = item.division1 || '';
    var status = item.status || '';
    var keyword = item.keywords || item.keyword || '';
    var manager = item.manager || '';
    var institution = item.institution || '';
    var start = item.startDate || '';
    var end = item.endDate || '';
    var progress = calcProgress(start, end);
    var supportTotal = calcSupportTotal(item);

    var html = '<div class="summary-card" data-id="' + escapeHtml(item.id) + '">';

    // 뱃지들
    html += '<div class="summary-card-badges">';
    if (division) html += '<span class="summary-badge summary-badge--division">' + escapeHtml(division) + '</span>';
    if (status) html += '<span class="summary-badge summary-badge--status">' + escapeHtml(status) + '</span>';
    if (keyword) {
      keyword.split('|').slice(0, 2).forEach(function (k) {
        if (k.trim()) html += '<span class="summary-badge summary-badge--keyword">' + escapeHtml(k.trim()) + '</span>';
      });
    }
    html += '</div>';

    // 과제명
    html += '<h3 class="summary-card-title" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</h3>';

    // 사업명
    if (business) {
      html += '<div class="summary-card-business" title="' + escapeHtml(business) + '">' + escapeHtml(business) + '</div>';
    }

    // 메타 (책임자, 기관)
    html += '<dl class="summary-card-meta">';
    if (manager) {
      html += '<dt>책임자</dt><dd>' + escapeHtml(manager) + '</dd>';
    }
    if (institution) {
      html += '<dt>기관</dt><dd>' + escapeHtml(institution) + '</dd>';
    }
    html += '<dt>기간</dt><dd>' + escapeHtml(start) + ' ~ ' + escapeHtml(end) + '</dd>';
    html += '</dl>';

    // 진행률
    if (progress !== null) {
      html += '<div class="summary-progress">';
      html += '  <div class="summary-progress-bar"><div class="summary-progress-fill" style="width:' + progress + '%"></div></div>';
      html += '  <div class="summary-progress-text"><span>진행률</span><strong>' + progress + '%</strong></div>';
      html += '</div>';
    }

    // 정부지원금
    if (supportTotal > 0) {
      html += '<div class="summary-card-money">';
      html += '  <span class="summary-card-money-label">총 정부지원금</span>';
      html += '  <span class="summary-card-money-value">' + formatMoneyShort(supportTotal) + ' (' + formatNum(supportTotal) + '원)</span>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function render(items) {
    var grid = $('summary-grid');
    var empty = $('summary-empty');
    var count = $('summary-count');
    if (!grid || !empty) return;

    // 필터: 용역 제외 + 수행 중
    var filtered = items.filter(function (it) {
      if ((it.division1 || '') === '용역') return false;
      return isOngoingNow(it);
    });

    // 정렬: 시작일 오름차순 (오래된 것부터)
    filtered.sort(function (a, b) {
      var ad = (a.startDate || '').toString();
      var bd = (b.startDate || '').toString();
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return ad.localeCompare(bd);
    });

    if (count) count.innerHTML = '총 <strong>' + filtered.length + '</strong>건';

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    grid.innerHTML = filtered.map(renderCard).join('');

    // 카드 클릭 → 상세 페이지
    grid.querySelectorAll('.summary-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = card.getAttribute('data-id');
        if (id) location.href = 'project-summary.html?id=' + encodeURIComponent(id);
      });
    });
  }

  function init() {
    // sidebar toggle
    var sidebar = $('sidebar');
    var sidebarToggle = $('sidebar-toggle');
    if (sidebar && sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('sidebar--collapsed');
        try { localStorage.setItem('hr-sidebar-collapsed', sidebar.classList.contains('sidebar--collapsed') ? '1' : ''); } catch (e) {}
      });
      try {
        if (localStorage.getItem('hr-sidebar-collapsed') === '1') sidebar.classList.add('sidebar--collapsed');
      } catch (e) {}
    }

    // 전체 PDF 다운로드 버튼 — 새 탭으로 PDF 전용 페이지 열기
    var pdfBtn = document.getElementById('summary-pdf-btn');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', function () {
        window.open('projects-summary-pdf.html', '_blank');
      });
    }

    // Firestore 구독
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        render(Array.isArray(items) ? items : []);
      });
    } else {
      // 폴백
      firebase.firestore().collection('projects').doc('data').get().then(function (doc) {
        var items = (doc.exists && doc.data() && doc.data().items) || [];
        render(items);
      });
    }
  }

  function waitForFirebase() {
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) init();
      });
    } else {
      setTimeout(waitForFirebase, 100);
    }
  }
  waitForFirebase();
})();

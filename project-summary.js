/**
 * project-summary.html 로직
 * URL: project-summary.html?id=...
 * - Hero: 과제명, 사업명, 기간 + 진행률 바
 * - 정보 카드: 기관 / 책임자/담당자 / 과제 사이트 / 과제비 정보
 * - 사업비 총괄표: 연차별 정부지원금/자부담금
 * - 인쇄/PDF 버튼
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

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

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

  // 두 날짜 사이의 개월 수
  function monthsBetween(start, end) {
    if (!start || !end) return null;
    var s = new Date(start);
    var e = new Date(end);
    var months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (e.getDate() >= s.getDate()) months += 0; // 같거나 큰 날짜면 그대로
    return months + 1; // 두 달 모두 포함하는 식
  }

  // URL에서 id 파라미터 가져오기
  function getProjectId() {
    var params = new URLSearchParams(location.search);
    return params.get('id');
  }

  function renderNotFound() {
    var content = $('ps-content');
    content.innerHTML = '<div class="ps-not-found">' +
      '<h2 style="margin-bottom:0.5rem">과제를 찾을 수 없습니다</h2>' +
      '<p>잘못된 링크이거나 삭제된 과제일 수 있습니다.</p>' +
      '</div>';
  }

  function renderHero(item) {
    var name = item.projectName || item['과제명'] || '(제목 없음)';
    var business = item.business || item['사업명'] || '';
    var division = item.division1 || '';
    var status = item.status || '';
    var keyword = item.keywords || item.keyword || '';
    var start = item.startDate || '';
    var end = item.endDate || '';
    var progress = calcProgress(start, end);
    var months = monthsBetween(start, end);

    var html = '<section class="ps-hero">';

    // 뱃지
    html += '<div class="ps-hero-badges">';
    if (division) html += '<span class="ps-hero-badge">' + escapeHtml(division) + '</span>';
    if (status) html += '<span class="ps-hero-badge">' + escapeHtml(status) + '</span>';
    if (keyword) {
      keyword.split('|').slice(0, 3).forEach(function (k) {
        if (k.trim()) html += '<span class="ps-hero-badge">' + escapeHtml(k.trim()) + '</span>';
      });
    }
    html += '</div>';

    // 제목
    html += '<h1 class="ps-hero-title">' + escapeHtml(name) + '</h1>';
    if (business) {
      html += '<p class="ps-hero-business">' + escapeHtml(business) + '</p>';
    }

    // 기간
    if (start || end) {
      html += '<div class="ps-hero-period">';
      html += '  <span class="ps-hero-period-label">전체 기간</span>';
      html += '  <span class="ps-hero-period-value">' + escapeHtml(start) + ' ~ ' + escapeHtml(end) + '</span>';
      if (months) html += '  <span class="ps-hero-period-duration">(' + months + '개월)</span>';
      html += '</div>';
    }

    // 진행률
    if (progress !== null) {
      html += '<div class="ps-hero-progress"><div class="ps-hero-progress-fill" style="width:' + progress + '%"></div></div>';
      html += '<div class="ps-hero-progress-text"><span>진행률 (오늘 기준)</span><strong>' + progress + '%</strong></div>';
    }

    html += '</section>';
    return html;
  }

  function renderInfoCards(item) {
    var html = '<div class="ps-info-grid">';

    // 카드 1: 참여 기관
    html += '<div class="ps-card">';
    html += '<h2 class="ps-card-title"><span class="ps-card-title-icon">🏢</span>참여 기관</h2>';
    html += '<dl class="ps-info-list">';
    if (item.department) html += '<dt>전문기관</dt><dd>' + escapeHtml(item.department) + '</dd>';
    if (item.institution) html += '<dt>주관기관</dt><dd>' + escapeHtml(item.institution) + '</dd>';
    if (item.participationType === '컨소') {
      if (item.consortiumRole) html += '<dt>역할</dt><dd>' + escapeHtml(item.consortiumRole) + '</dd>';
      if (item.consortiumPartners) html += '<dt>참여기관</dt><dd>' + escapeHtml(item.consortiumPartners) + '</dd>';
    }
    html += '</dl>';
    html += '</div>';

    // 카드 2: 담당자
    html += '<div class="ps-card">';
    html += '<h2 class="ps-card-title"><span class="ps-card-title-icon">👤</span>담당자</h2>';
    html += '<dl class="ps-info-list">';
    if (item.manager) html += '<dt>책임자</dt><dd>' + escapeHtml(item.manager) + '</dd>';
    if (item.charge) html += '<dt>담당자</dt><dd>' + escapeHtml(item.charge) + '</dd>';
    if (item.submitDate) html += '<dt>제출일</dt><dd>' + escapeHtml(item.submitDate) + '</dd>';
    html += '</dl>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderMoneyTable(item) {
    var ybs = item.yearBudgets || [];
    if (!Array.isArray(ybs) || ybs.length === 0) {
      // yearBudgets 없으면 단순 표시
      var total = Number(item.supportTotal) || Number(item.budget) || 0;
      if (total === 0) return '';
      return '<div class="ps-card">' +
        '<h2 class="ps-card-title"><span class="ps-card-title-icon">💰</span>사업비 정보</h2>' +
        '<p style="margin:0;font-size:0.95rem;color:#475569;">총 정부지원금: <strong style="color:#047857">' + formatNum(total) + '원</strong></p>' +
        '</div>';
    }

    var totalSupport = 0, totalCash = 0, totalInKind = 0;
    ybs.forEach(function (yb) {
      totalSupport += Number(yb.support) || 0;
      totalCash += Number(yb.cash) || 0;
      totalInKind += Number(yb.inKind) || 0;
    });
    var grandTotal = totalSupport + totalCash + totalInKind;

    var html = '<div class="ps-card" style="margin-bottom:1.5rem">';
    html += '<h2 class="ps-card-title"><span class="ps-card-title-icon">💰</span>사업비 총괄표</h2>';
    html += '<table class="ps-money-table">';
    html += '<thead><tr>';
    html += '<th style="width:14%">연차</th>';
    html += '<th>기간</th>';
    html += '<th style="width:14%">정부지원금</th>';
    html += '<th style="width:13%">자부담금 현금</th>';
    html += '<th style="width:13%">자부담금 현물</th>';
    html += '<th style="width:14%">합계</th>';
    html += '</tr></thead><tbody>';

    ybs.forEach(function (yb, i) {
      var support = Number(yb.support) || 0;
      var cash = Number(yb.cash) || 0;
      var inKind = Number(yb.inKind) || 0;
      var sum = support + cash + inKind;
      html += '<tr>';
      html += '<td class="label">' + (i + 1) + '차년도</td>';
      html += '<td>' + escapeHtml(yb.startDate || '') + ' ~ ' + escapeHtml(yb.endDate || '') + '</td>';
      html += '<td class="amount">' + (support ? formatNum(support) : '-') + '</td>';
      html += '<td class="amount">' + (cash ? formatNum(cash) : '-') + '</td>';
      html += '<td class="amount">' + (inKind ? formatNum(inKind) : '-') + '</td>';
      html += '<td class="amount"><strong>' + formatNum(sum) + '</strong></td>';
      html += '</tr>';
    });

    // 합계 행
    html += '<tr class="total">';
    html += '<td class="label" colspan="2" style="text-align:center;">총 합계</td>';
    html += '<td class="amount">' + formatNum(totalSupport) + '</td>';
    html += '<td class="amount">' + (totalCash ? formatNum(totalCash) : '-') + '</td>';
    html += '<td class="amount">' + (totalInKind ? formatNum(totalInKind) : '-') + '</td>';
    html += '<td class="amount">' + formatNum(grandTotal) + '</td>';
    html += '</tr>';

    html += '</tbody></table>';
    html += '</div>';

    return html;
  }

  function render(item) {
    var content = $('ps-content');
    var html = '';
    html += renderHero(item);
    html += renderInfoCards(item);
    html += renderMoneyTable(item);
    html += '<div id="ps-milestones-wrap"></div>';
    content.innerHTML = html;

    // 페이지 제목 갱신
    var titleEl = document.querySelector('.header-title');
    if (titleEl) titleEl.textContent = '[과제 요약] ' + (item.projectName || item['과제명'] || '(제목 없음)');
    document.title = '[과제 요약] ' + (item.projectName || '(과제)');

    // 마일스톤 — 캘린더 구독으로 채움
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeCalendar === 'function') {
      svc.subscribeCalendar(function (events) {
        renderMilestones(item.id || item.docId, events || []);
      });
    } else {
      renderMilestones(item.id || item.docId, []);
    }
  }

  function diffDays(targetStr) {
    if (!targetStr) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var t = new Date(targetStr);
    if (isNaN(t.getTime())) return null;
    t.setHours(0, 0, 0, 0);
    return Math.round((t - today) / (1000 * 60 * 60 * 24));
  }

  function renderMilestones(projectId, allEvents) {
    var wrap = $('ps-milestones-wrap');
    if (!wrap) return;
    var milestones = (allEvents || []).filter(function (ev) {
      return ev.type === 'milestone' && ev.projectId === projectId;
    });
    // 날짜 오름차순
    milestones.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '');
    });

    var html = '<div class="ps-card">';
    html += '<h2 class="ps-card-title"><span class="ps-card-title-icon">🚩</span>마일스톤</h2>';

    if (milestones.length === 0) {
      html += '<div class="ps-milestone-empty">등록된 마일스톤이 없습니다.</div>';
      html += '</div>';
      wrap.innerHTML = html;
      return;
    }

    html += '<div class="ps-milestone-list">';
    milestones.forEach(function (ms) {
      var dd = diffDays(ms.date);
      var statusClass = '';
      var badge = '';
      if (ms.done) {
        statusClass = 'done';
        badge = '<span class="ps-milestone-badge ps-milestone-badge--done">✓ 완료</span>';
      } else if (dd !== null) {
        if (dd < 0) {
          statusClass = 'overdue';
          badge = '<span class="ps-milestone-badge ps-milestone-badge--overdue">D+' + Math.abs(dd) + ' (지연)</span>';
        } else if (dd === 0) {
          statusClass = 'upcoming';
          badge = '<span class="ps-milestone-badge ps-milestone-badge--dday">D-day</span>';
        } else if (dd <= 30) {
          statusClass = 'upcoming';
          badge = '<span class="ps-milestone-badge ps-milestone-badge--dday">D-' + dd + '</span>';
        }
      }

      html += '<div class="ps-milestone-item ' + statusClass + '">';
      html += '<div class="ps-milestone-row">';
      html += '<span class="ps-milestone-date">' + escapeHtml(ms.date || '') + '</span>';
      html += '<span class="ps-milestone-name">' + escapeHtml(ms.item || '') + '</span>';
      html += badge;
      html += '</div>';
      if (ms.manager || ms.note) {
        html += '<div class="ps-milestone-meta">';
        if (ms.manager) html += '<span>👤 ' + escapeHtml(ms.manager) + '</span>';
        html += '</div>';
        if (ms.note) html += '<div class="ps-milestone-note">' + escapeHtml(ms.note) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    wrap.innerHTML = html;
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

    // 인쇄 / PDF 버튼
    var printBtn = $('ps-print-btn');
    var pdfBtn = $('ps-pdf-btn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    if (pdfBtn) pdfBtn.addEventListener('click', function () {
      // 브라우저의 "PDF로 저장"은 인쇄 대화상자에서 선택 가능
      alert('인쇄 대화상자가 열립니다.\n\n저장 방법:\n1. "프린터" 또는 "대상" 옵션에서\n2. "PDF로 저장" 또는 "Microsoft Print to PDF" 선택\n3. 저장 위치 지정 후 저장');
      setTimeout(function () { window.print(); }, 100);
    });

    var projectId = getProjectId();
    if (!projectId) {
      renderNotFound();
      return;
    }

    // Firestore 구독
    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        var item = items.find(function (it) { return it.id === projectId; });
        if (item) render(item);
        else renderNotFound();
      });
    } else {
      firebase.firestore().collection('projects').doc('data').get().then(function (doc) {
        var items = (doc.exists && doc.data() && doc.data().items) || [];
        var item = items.find(function (it) { return it.id === projectId; });
        if (item) render(item);
        else renderNotFound();
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

/**
 * projects-summary-pdf.html 로직
 * 수행 중인 모든 과제/지원사업(용역 제외) 요약을 한 페이지에 쭉 렌더
 * - 표지 페이지 (제목, 작성일, 총 건수, 정부지원금 합)
 * - 목차 (번호 + 과제명)
 * - 각 과제별 페이지 (Hero + 정보 + 사업비 + 마일스톤)
 * - 페이지 로드 완료 후 자동 print 대화상자
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

  function todayDisplay() {
    var d = new Date();
    return d.getFullYear() + '. ' +
      String(d.getMonth() + 1).padStart(2, '0') + '. ' +
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
    return Math.max(0, Math.min(100, Math.round(((t - s) / (e - s)) * 100)));
  }

  function monthsBetween(start, end) {
    if (!start || !end) return null;
    var s = new Date(start);
    var e = new Date(end);
    var months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    return months + 1;
  }

  function isOngoingNow(item) {
    var status = (item.status || '').toString().trim();
    var start = (item.startDate || '').toString();
    var end = (item.endDate || '').toString();
    var today = todayStr();
    if (status === '수행' || status === '수행중') {
      if (!start || today < start) return false;
      if (end && today > end) return false;
      return true;
    }
    return false;
  }

  function calcSupportTotal(item) {
    var ybs = item.yearBudgets || [];
    if (!Array.isArray(ybs) || ybs.length === 0) return Number(item.supportTotal) || Number(item.budget) || 0;
    return ybs.reduce(function (s, yb) { return s + (Number(yb.support) || 0); }, 0);
  }

  function renderCover(items, grandTotalSupport) {
    var html = '<div class="pdf-cover">';
    html += '<h1 class="pdf-cover-title">과제 수행 현황 보고서</h1>';
    html += '<p class="pdf-cover-subtitle">현재 수행 중인 과제 및 지원사업 (용역 제외)</p>';
    html += '<div class="pdf-cover-meta">';
    html += '<div class="pdf-cover-meta-item"><div class="pdf-cover-meta-value">' + items.length + '</div><div class="pdf-cover-meta-label">총 과제 수</div></div>';
    html += '<div class="pdf-cover-meta-item"><div class="pdf-cover-meta-value">' + formatMoneyShort(grandTotalSupport) + '</div><div class="pdf-cover-meta-label">총 정부지원금</div></div>';
    html += '<div class="pdf-cover-meta-item"><div class="pdf-cover-meta-value" style="font-size:1.1rem;font-weight:600;">' + todayDisplay() + '</div><div class="pdf-cover-meta-label">작성일</div></div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderToc(items) {
    var html = '<div class="pdf-toc">';
    html += '<h2 class="pdf-toc-title">목차</h2>';
    html += '<ol class="pdf-toc-list">';
    items.forEach(function (item) {
      var name = item.projectName || item['과제명'] || '(제목 없음)';
      var division = item.division1 || '';
      var manager = item.manager || '';
      var start = (item.startDate || '').slice(0, 10);
      var end = (item.endDate || '').slice(0, 10);
      html += '<li class="pdf-toc-item">';
      html += '<span class="pdf-toc-name">' + escapeHtml(name) + '</span>';
      html += '<span class="pdf-toc-meta">' + escapeHtml(division) + (manager ? ' · ' + escapeHtml(manager) : '') + ' · ' + escapeHtml(start) + '~' + escapeHtml(end) + '</span>';
      html += '</li>';
    });
    html += '</ol>';
    html += '</div>';
    return html;
  }

  function renderProjectPage(item, idx, milestones) {
    var name = item.projectName || item['과제명'] || '(제목 없음)';
    var business = item.business || item['사업명'] || '';
    var division = item.division1 || '';
    var status = item.status || '';
    var keyword = item.keywords || item.keyword || '';
    var manager = item.manager || '';
    var charge = item.charge || '';
    var dept = item.department || '';
    var inst = item.institution || '';
    var start = item.startDate || '';
    var end = item.endDate || '';
    var months = monthsBetween(start, end);
    var progress = calcProgress(start, end);
    var submitDate = item.submitDate || '';

    var html = '<div class="pdf-project">';

    // 헤더 (파란 배경)
    html += '<div class="pdf-project-header">';
    html += '<div class="pdf-project-num">No. ' + String(idx + 1).padStart(2, '0') + '</div>';
    html += '<div class="pdf-project-badges">';
    if (division) html += '<span class="pdf-project-badge">' + escapeHtml(division) + '</span>';
    if (status) html += '<span class="pdf-project-badge">' + escapeHtml(status) + '</span>';
    if (keyword) {
      keyword.split('|').slice(0, 3).forEach(function (k) {
        if (k.trim()) html += '<span class="pdf-project-badge">' + escapeHtml(k.trim()) + '</span>';
      });
    }
    html += '</div>';
    html += '<h2 class="pdf-project-title">' + escapeHtml(name) + '</h2>';
    if (business) html += '<p class="pdf-project-business">' + escapeHtml(business) + '</p>';
    html += '</div>';

    // 본문
    html += '<div class="pdf-project-body">';

    // 기간
    if (start || end) {
      html += '<div class="pdf-period">';
      html += '<span class="pdf-period-label">전체 기간</span>';
      html += '<span class="pdf-period-value">' + escapeHtml(start) + ' ~ ' + escapeHtml(end) + '</span>';
      if (months) html += '<span class="pdf-period-duration">(' + months + '개월)</span>';
      html += '</div>';
    }

    // 진행률
    if (progress !== null) {
      html += '<div class="pdf-progress"><div class="pdf-progress-fill" style="width:' + progress + '%"></div></div>';
      html += '<div class="pdf-progress-text"><span>진행률 (오늘 기준)</span><strong>' + progress + '%</strong></div>';
    }

    // 정보 그리드
    html += '<div class="pdf-info-grid">';
    html += '<div class="pdf-info-card">';
    html += '<h3 class="pdf-info-card-title">🏢 참여 기관</h3>';
    html += '<dl class="pdf-info-list">';
    if (dept) html += '<dt>전문기관</dt><dd>' + escapeHtml(dept) + '</dd>';
    if (inst) html += '<dt>주관기관</dt><dd>' + escapeHtml(inst) + '</dd>';
    if (item.participationType === '컨소') {
      if (item.consortiumRole) html += '<dt>역할</dt><dd>' + escapeHtml(item.consortiumRole) + '</dd>';
      if (item.consortiumPartners) html += '<dt>참여기관</dt><dd>' + escapeHtml(item.consortiumPartners) + '</dd>';
    }
    html += '</dl>';
    html += '</div>';

    html += '<div class="pdf-info-card">';
    html += '<h3 class="pdf-info-card-title">👤 담당자</h3>';
    html += '<dl class="pdf-info-list">';
    if (manager) html += '<dt>책임자</dt><dd>' + escapeHtml(manager) + '</dd>';
    if (charge) html += '<dt>담당자</dt><dd>' + escapeHtml(charge) + '</dd>';
    if (submitDate) html += '<dt>제출일</dt><dd>' + escapeHtml(submitDate) + '</dd>';
    html += '</dl>';
    html += '</div>';
    html += '</div>'; // .pdf-info-grid

    // 사업비 표
    var ybs = item.yearBudgets || [];
    if (Array.isArray(ybs) && ybs.length > 0) {
      html += '<div class="pdf-money-section">';
      html += '<h3 class="pdf-section-title">💰 사업비 총괄표</h3>';
      html += '<table class="pdf-money-table">';
      html += '<thead><tr><th style="width:13%">연차</th><th>기간</th><th style="width:15%">정부지원금</th><th style="width:13%">자부담 현금</th><th style="width:13%">자부담 현물</th><th style="width:15%">합계</th></tr></thead><tbody>';
      var totalSupport = 0, totalCash = 0, totalInKind = 0;
      ybs.forEach(function (yb, i) {
        var support = Number(yb.support) || 0;
        var cash = Number(yb.cash) || 0;
        var inKind = Number(yb.inKind) || 0;
        var sum = support + cash + inKind;
        totalSupport += support; totalCash += cash; totalInKind += inKind;
        html += '<tr>';
        html += '<td class="label">' + (i + 1) + '차년도</td>';
        html += '<td>' + escapeHtml(yb.startDate || '') + ' ~ ' + escapeHtml(yb.endDate || '') + '</td>';
        html += '<td class="amount">' + (support ? formatNum(support) : '-') + '</td>';
        html += '<td class="amount">' + (cash ? formatNum(cash) : '-') + '</td>';
        html += '<td class="amount">' + (inKind ? formatNum(inKind) : '-') + '</td>';
        html += '<td class="amount"><strong>' + formatNum(sum) + '</strong></td>';
        html += '</tr>';
      });
      var grand = totalSupport + totalCash + totalInKind;
      html += '<tr class="total"><td class="label" colspan="2" style="text-align:center">총 합계</td>';
      html += '<td class="amount">' + formatNum(totalSupport) + '</td>';
      html += '<td class="amount">' + (totalCash ? formatNum(totalCash) : '-') + '</td>';
      html += '<td class="amount">' + (totalInKind ? formatNum(totalInKind) : '-') + '</td>';
      html += '<td class="amount">' + formatNum(grand) + '</td>';
      html += '</tr>';
      html += '</tbody></table>';
      html += '</div>';
    }

    // 마일스톤
    if (milestones && milestones.length > 0) {
      html += '<div class="pdf-milestones">';
      html += '<h3 class="pdf-section-title">🚩 마일스톤</h3>';
      html += '<div class="pdf-ms-list">';
      milestones.forEach(function (ms) {
        var doneClass = ms.done ? ' done' : '';
        html += '<div class="pdf-ms-item' + doneClass + '">';
        html += '<div class="pdf-ms-row">';
        html += '<span class="pdf-ms-date">' + escapeHtml(ms.date || '') + '</span>';
        html += '<span class="pdf-ms-name">' + escapeHtml(ms.item || '') + (ms.done ? ' ✓' : '') + '</span>';
        html += '</div>';
        if (ms.manager || ms.note) {
          html += '<div class="pdf-ms-meta">';
          if (ms.manager) html += '👤 ' + escapeHtml(ms.manager);
          if (ms.manager && ms.note) html += ' · ';
          if (ms.note) html += escapeHtml(ms.note);
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    html += '</div>'; // .pdf-project-body
    html += '</div>'; // .pdf-project
    return html;
  }

  function buildMilestoneMap(events) {
    var map = {};
    (events || []).forEach(function (ev) {
      if (ev.type !== 'milestone' || !ev.projectId) return;
      if (!map[ev.projectId]) map[ev.projectId] = [];
      map[ev.projectId].push(ev);
    });
    // 각 과제별 마일스톤 날짜 오름차순
    Object.keys(map).forEach(function (pid) {
      map[pid].sort(function (a, b) {
        return (a.date || '').localeCompare(b.date || '');
      });
    });
    return map;
  }

  // 페이지 데이터 수집 — projects + calendarEvents 둘 다 받으면 렌더
  var loaded = { projects: false, calendar: false };
  var data = { projects: [], events: [] };

  function tryRender() {
    if (!loaded.projects || !loaded.calendar) return;

    // 필터: 용역 제외 + 수행 중
    var filtered = data.projects.filter(function (it) {
      if ((it.division1 || '') === '용역') return false;
      return isOngoingNow(it);
    });
    // 정렬: 시작일 오름차순
    filtered.sort(function (a, b) {
      return (a.startDate || '').toString().localeCompare((b.startDate || '').toString());
    });

    var grandTotal = filtered.reduce(function (s, it) { return s + calcSupportTotal(it); }, 0);
    var msMap = buildMilestoneMap(data.events);

    var html = '';
    html += renderCover(filtered, grandTotal);
    html += renderToc(filtered);
    filtered.forEach(function (item, idx) {
      var milestones = msMap[item.id] || [];
      html += renderProjectPage(item, idx, milestones);
    });

    if (filtered.length === 0) {
      html = '<div class="pdf-loading">현재 수행 중인 과제가 없습니다.</div>';
    }

    var content = $('pdf-content');
    if (content) content.innerHTML = html;

    // 페이지 제목 갱신
    document.title = '[R&DM] 과제별 상세 (' + filtered.length + '건) — ' + todayDisplay();

    // 자동 인쇄 대화상자 (약간 지연 — 렌더 완료 후)
    setTimeout(function () {
      window.print();
    }, 700);
  }

  function init() {
    var printBtn = $('pdf-print-btn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    var svc = window.firestoreService;
    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        data.projects = Array.isArray(items) ? items : [];
        loaded.projects = true;
        tryRender();
      });
    } else {
      loaded.projects = true;
      tryRender();
    }

    if (svc && typeof svc.subscribeCalendar === 'function') {
      svc.subscribeCalendar(function (events) {
        data.events = Array.isArray(events) ? events : [];
        loaded.calendar = true;
        tryRender();
      });
    } else {
      loaded.calendar = true;
      tryRender();
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

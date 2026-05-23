// CalendarManagement.js
// 제출 관리 캘린더 페이지 - FullCalendar 기반 일정 등록 및 표시
// + 마일스톤(type='milestone') 시각 구분 + 마일스톤 전용 필드 보존

(function () {
  'use strict';

  var CALENDAR_STORAGE_KEY = 'hr-calendar-events';
  var PARTICIPATION_STORAGE_KEY = 'hr-participation-data-v2';

  // 📅 구글 캘린더 기본 초대 멤버
  // 추가/변경하려면 이 배열을 수정하면 됨 (정보 모달 + 일정 등록 모달 둘 다 적용됨)
  var DEFAULT_INVITEES = [
    'jh.jung@60hz.io',
    'ys.jo@60hz.io'
    // 추후 추가 예: 'rnd@60hz.io', 'team@60hz.io'
  ];

  var HOLIDAY_DATES = [
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30',
    '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06',
    '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09',
    '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18',
    '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
    '2026-06-03', '2026-06-06', '2026-08-15', '2026-08-17',
    '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09',
    '2026-12-25'
  ];

  var HOLIDAY_EVENTS = HOLIDAY_DATES.map(function (d) {
    return {
      start: d,
      display: 'background',
      backgroundColor: '#FFF0F0',
      classNames: ['fc-event-holiday']
    };
  });

  var calendarWrap = null;
  var calendarEl = null;
  var calendar = null;
  var modal = document.getElementById('calendar-event-modal');
  var modalClose = document.getElementById('calendar-event-modal-close');
  var modalCancel = document.getElementById('calendar-event-cancel');
  var modalTitle = document.getElementById('calendar-event-modal-title');
  var dateInput = document.getElementById('calendar-event-date');
  var timeInput = document.getElementById('calendar-event-time');
  var projectInput = document.getElementById('calendar-event-project');
  var projectDatalist = document.getElementById('calendar-event-project-list');
  var itemInput = document.getElementById('calendar-event-item');
  var methodInput = document.getElementById('calendar-event-method');
  var form = document.getElementById('calendar-event-form');
  var submitBtn = document.getElementById('calendar-event-submit');
  var deleteBtn = document.getElementById('calendar-event-delete');
  var selectedDateStr = null;
  var editingEventId = null;
  var editingEventOriginal = null; // 편집 중인 이벤트의 원본 (마일스톤 필드 보존용)
  var currentProjects = []; // R&D 과제 목록 (제출일 자동 표시용)
  var infoModalEl = null;   // 과제 정보 모달 (정적 생성)

  // ===== 헬퍼 =====
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ===== 구글 캘린더 "이벤트 추가" URL 생성 =====
  // 사용자가 클릭하면 구글 캘린더 새 이벤트 페이지가 미리 채워진 상태로 열림
  function buildGoogleCalendarUrl(opts) {
    // opts: { title, date, endDate, details, location, attendees }
    // date/endDate: 'YYYY-MM-DD' 형식 (종일 이벤트로 처리)
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var toCalDate = function (dateStr) {
      // 'YYYY-MM-DD' → 'YYYYMMDD'
      return (dateStr || '').replace(/-/g, '').slice(0, 8);
    };
    var startDate = toCalDate(opts.date);
    // 구글 캘린더 종일 이벤트: end는 다음 날 날짜로 (exclusive)
    var endDateRaw = opts.endDate || opts.date;
    var endDateObj = new Date(endDateRaw + 'T00:00:00');
    endDateObj.setDate(endDateObj.getDate() + 1);
    var endDate = endDateObj.getFullYear() + pad(endDateObj.getMonth() + 1) + pad(endDateObj.getDate());

    var params = {
      action: 'TEMPLATE',
      text: opts.title || '일정',
      dates: startDate + '/' + endDate,
      details: opts.details || '',
      location: opts.location || ''
    };
    // 초대 멤버 (콤마로 구분된 이메일 → 공백 제거 후 콤마)
    if (opts.attendees) {
      var emails = String(opts.attendees)
        .split(/[,;\s]+/)
        .map(function (e) { return e.trim(); })
        .filter(function (e) { return e && /@/.test(e); });
      if (emails.length) params.add = emails.join(',');
    }
    var qs = Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return 'https://calendar.google.com/calendar/render?' + qs;
  }

  function openGoogleCalendar(opts) {
    var url = buildGoogleCalendarUrl(opts);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function formatNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function calcProgressPct(startDate, endDate) {
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

  // ===== 정보 모달 (과제 연결 이벤트 클릭 시 표시) =====
  function getOrCreateInfoModal() {
    if (infoModalEl) return infoModalEl;
    // CSS 주입
    var style = document.createElement('style');
    style.textContent =
      '.ci-modal { position: fixed; inset: 0; z-index: 10000; display: none; align-items: center; justify-content: center; }' +
      '.ci-modal.active { display: flex; }' +
      '.ci-modal-overlay { position: absolute; inset: 0; background: rgba(15,23,42,0.5); }' +
      '.ci-modal-content { position: relative; background: #fff; border-radius: 1rem; box-shadow: 0 20px 50px rgba(0,0,0,0.25); max-width: 520px; width: 92%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }' +
      '.ci-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 1.5rem; border-bottom: 1px solid #f1f5f9; }' +
      '.ci-modal-title { margin: 0; font-size: 1.05rem; font-weight: 700; color: #1e293b; }' +
      '.ci-modal-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #94a3b8; padding: 0.25rem; line-height: 1; }' +
      '.ci-modal-close:hover { color: #1e293b; }' +
      '.ci-modal-body { padding: 1.5rem; overflow-y: auto; flex: 1; }' +
      '.ci-modal-footer { display: flex; gap: 0.5rem; padding: 0.85rem 1.5rem; border-top: 1px solid #f1f5f9; flex-wrap: wrap; justify-content: flex-end; background: #f9fafb; }' +
      '.ci-btn { padding: 0.55rem 1rem; border-radius: 0.45rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #475569; }' +
      '.ci-btn:hover { background: #f1f5f9; }' +
      '.ci-btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }' +
      '.ci-btn-primary:hover { background: #1d4ed8; }' +
      '.ci-btn-warning { background: #fff; color: #d97706; border-color: #f59e0b; }' +
      '.ci-btn-gcal { background: #fff; color: #1a73e8; border-color: #1a73e8; font-weight: 600; }' +
      '.ci-btn-gcal:hover { background: #1a73e8; color: #fff; }' +
      '.ci-btn-warning:hover { background: #fef3c7; }' +
      '.ci-event-type { display: inline-block; font-size: 0.78rem; font-weight: 700; padding: 0.25rem 0.7rem; border-radius: 999px; margin-bottom: 1rem; }' +
      '.ci-event-type--submit { background: #ede9fe; color: #5b21b6; }' +
      '.ci-event-type--milestone { background: #fef3c7; color: #92400e; }' +
      '.ci-badges { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.75rem; }' +
      '.ci-badge { font-size: 0.7rem; padding: 0.18rem 0.55rem; border-radius: 999px; font-weight: 600; }' +
      '.ci-badge--division { background: #eff6ff; color: #1d4ed8; }' +
      '.ci-badge--status { background: #dcfce7; color: #047857; }' +
      '.ci-badge--keyword { background: #f1f5f9; color: #475569; }' +
      '.ci-project-name { font-size: 1.1rem; font-weight: 700; color: #111827; margin: 0 0 0.3rem; line-height: 1.4; }' +
      '.ci-business { font-size: 0.85rem; color: #64748b; margin: 0 0 1.1rem; }' +
      '.ci-info-list { display: grid; grid-template-columns: 90px 1fr; gap: 0.45rem 1rem; margin: 0 0 1.1rem; padding: 0.8rem 0; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; }' +
      '.ci-info-list dt { color: #94a3b8; font-size: 0.82rem; }' +
      '.ci-info-list dd { color: #1e293b; font-size: 0.86rem; margin: 0; font-weight: 500; word-break: break-all; }' +
      '.ci-progress-label { display: flex; justify-content: space-between; font-size: 0.8rem; color: #64748b; margin-bottom: 0.3rem; }' +
      '.ci-progress-label strong { color: #2563eb; font-weight: 700; }' +
      '.ci-progress-bar { height: 6px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }' +
      '.ci-progress-fill { height: 100%; background: linear-gradient(90deg, #60a5fa, #2563eb); border-radius: 999px; transition: width 0.5s; }' +
      '.ci-ms-list { margin-top: 1rem; padding-top: 0.8rem; border-top: 1px solid #f1f5f9; }' +
      '.ci-ms-title { font-size: 0.85rem; font-weight: 700; color: #92400e; margin: 0 0 0.5rem; }' +
      '.ci-ms-item { padding: 0.3rem 0; font-size: 0.82rem; color: #475569; display: flex; gap: 0.6rem; }' +
      '.ci-ms-item.done { color: #94a3b8; text-decoration: line-through; }' +
      '.ci-ms-item-date { color: #94a3b8; font-variant-numeric: tabular-nums; min-width: 95px; }';
    document.head.appendChild(style);

    // 모달 DOM
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="calendar-info-modal" class="ci-modal" aria-hidden="true">' +
      '  <div class="ci-modal-overlay"></div>' +
      '  <div class="ci-modal-content" role="dialog">' +
      '    <div class="ci-modal-header">' +
      '      <h2 class="ci-modal-title" id="ci-modal-title">일정 정보</h2>' +
      '      <button type="button" class="ci-modal-close" aria-label="닫기">✕</button>' +
      '    </div>' +
      '    <div class="ci-modal-body" id="ci-modal-body"></div>' +
      '    <div class="ci-modal-footer">' +
      '      <button type="button" class="ci-btn" id="ci-btn-close">닫기</button>' +
      '      <button type="button" class="ci-btn ci-btn-gcal" id="ci-btn-gcal" title="구글 캘린더에 추가">📅</button>' +
      '      <button type="button" class="ci-btn ci-btn-warning" id="ci-btn-edit" title="수정">✏️</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);
    infoModalEl = document.getElementById('calendar-info-modal');

    // 닫기 이벤트
    infoModalEl.querySelector('.ci-modal-close').addEventListener('click', closeInfoModal);
    infoModalEl.querySelector('.ci-modal-overlay').addEventListener('click', closeInfoModal);
    infoModalEl.querySelector('#ci-btn-close').addEventListener('click', closeInfoModal);

    return infoModalEl;
  }

  function closeInfoModal() {
    if (infoModalEl) {
      infoModalEl.classList.remove('active');
    }
  }

  function openInfoModal(projectId, eventType, eventDate, milestoneItem) {
    var modal = getOrCreateInfoModal();
    var project = currentProjects.find(function (p) { return (p.id || p.docId) === projectId; });
    if (!project) {
      alert('연결된 과제를 찾을 수 없습니다.\n과제가 삭제되었거나 데이터 로드가 아직 안 됐을 수 있습니다.');
      return;
    }
    renderInfoModal(project, eventType, eventDate, milestoneItem);

    // 버튼 핸들러 (매번 갱신)
    modal.querySelector('#ci-btn-edit').onclick = function () {
      if (confirm('과제 편집 페이지로 이동합니다.\n변경 사항은 모든 사용자에게 즉시 반영됩니다.\n계속하시겠습니까?')) {
        window.location.href = 'project-detail.html?id=' + encodeURIComponent(projectId);
      }
    };

    // 📅 구글 캘린더에 추가
    modal.querySelector('#ci-btn-gcal').onclick = function () {
      var pname = (project.projectName || project['과제명'] || '').trim();
      var business = (project.business || project['사업명'] || '').trim();
      var pkeywords = (project.keywords || project.keyword || '').toString();
      var firstKw = pkeywords.split('|')[0].trim();
      // 제목: 키워드 우선, 없으면 과제명, 둘 다 없으면 '(이름 미정)'
      var displayName = firstKw || pname || '(이름 미정)';
      var manager = project.manager || '';
      var charge = project.charge || '';
      var institution = project.institution || '';
      // 제출처/마감시간
      var submitSystem = (project.submitSystem || project['제출처'] || '').toString().trim();
      var submitSystemDetail = (project.submitSystemDetail || project['제출처 상세'] || '').toString().trim();
      var submitDeadline = (project.submitDeadline || project['마감 시간'] || '').toString().trim();
      // 제출처 표시: "직접 입력"이면 상세값 그대로, 시스템/메일이면 "라벨 (상세)"
      var submitSystemDisplay;
      if (submitSystem === '직접 입력') {
        submitSystemDisplay = submitSystemDetail;
      } else if (submitSystem && submitSystemDetail) {
        submitSystemDisplay = submitSystem + ' (' + submitSystemDetail + ')';
      } else {
        submitSystemDisplay = submitSystem;
      }
      // 제목 옆 (제출처, ~마감시간) — 직접 입력일 땐 상세값을 그대로
      var systemForTitle = (submitSystem === '직접 입력') ? submitSystemDetail : submitSystem;
      var extraParts = [];
      if (systemForTitle) extraParts.push(systemForTitle);
      if (submitDeadline) extraParts.push('~' + submitDeadline);
      var extra = extraParts.length ? ' (' + extraParts.join(', ') + ')' : '';

      // 책임자/담당자 한 줄 — 같으면 한 명, 다르면 "A / B" 형태
      var personLine = '';
      if (manager && charge) {
        personLine = (manager === charge) ? manager : (manager + ' / ' + charge);
      } else {
        personLine = manager || charge || '';
      }

      // 참여 형태 표시 문자열
      var gcParticipationType = project.participationType || '단독';
      var gcConsortiumRole = project.consortiumRole || '';
      var gcConsortiumLead = (project.consortiumLead || '').toString().trim();
      var gcConsortiumPartners = (project.consortiumPartners || '').toString().trim();
      var gcParticipationDisplay = '';
      if (gcParticipationType === '컨소') {
        if (gcConsortiumRole === '주관') {
          gcParticipationDisplay = '컨소 (주관)';
        } else if (gcConsortiumRole === '참여') {
          gcParticipationDisplay = '컨소 (참여)';
          if (gcConsortiumLead) gcParticipationDisplay += ' · 주관: ' + gcConsortiumLead;
        } else {
          gcParticipationDisplay = '컨소';
        }
      } else {
        gcParticipationDisplay = '단독';
      }

      // 공통 상세: 사업명 → 과제명 → 책임자/담당자 → 기관 → 참여형태 → 제출처 → 마감시간
      var commonDetails =
        '사업명: ' + (business || '-') + '\n' +
        '과제명: ' + (pname || '-') + '\n' +
        '책임자/담당자: ' + (personLine || '-') + '\n' +
        '기관: ' + (institution || '-') + '\n' +
        '참여 형태: ' + gcParticipationDisplay + '\n' +
        (gcParticipationType === '컨소' && gcConsortiumPartners ? '공동 참여: ' + gcConsortiumPartners + '\n' : '') +
        '제출처: ' + (submitSystemDisplay || '-') + '\n' +
        '마감 시간: ' + (submitDeadline || '-') + '\n';

      var title, details;
      if (eventType === 'submit-virtual') {
        title = '[제출] ' + displayName + extra;
        details = commonDetails + '\n📌 R&DM 시스템에서 자동 생성된 일정입니다.';
      } else if (eventType === 'milestone') {
        title = '🚩 [' + (milestoneItem || '마일스톤') + '] ' + displayName;
        details = commonDetails +
          '마일스톤: ' + (milestoneItem || '-') + '\n' +
          '\n📌 R&DM 시스템에서 자동 생성된 일정입니다.';
      } else {
        title = displayName;
        details = commonDetails;
      }
      // 그룹 메일 받기 (사용자가 직접 입력)
      // 기본 초대 멤버 확인 (다른 멤버는 구글 캘린더 페이지에서 추가)
      var inviteList = DEFAULT_INVITEES.map(function (e) { return '• ' + e; }).join('\n');
      var ok = confirm(
        '📅 구글 캘린더에 추가합니다.\n\n' +
        '기본 초대 멤버:\n' +
        inviteList + '\n\n' +
        '※ 다른 멤버는 캘린더 페이지에서 추가할 수 있어요.'
      );
      if (!ok) return;  // 취소
      openGoogleCalendar({
        title: title,
        date: eventDate,
        endDate: eventDate,
        details: details,
        attendees: DEFAULT_INVITEES.join(',')
      });
    };

    modal.classList.add('active');
  }

  function renderInfoModal(project, eventType, eventDate, milestoneItem) {
    var titleEl = document.getElementById('ci-modal-title');
    var body = document.getElementById('ci-modal-body');
    if (!body) return;

    var projectName = (project.projectName || project['과제명'] || '').trim();
    var name = projectName || '(과제명 미정)';
    var hasProjectName = !!projectName;
    var business = project.business || project['사업명'] || '';
    var division = project.division1 || '';
    var status = project.status || '';
    var keyword = project.keywords || project.keyword || '';
    var manager = project.manager || '';
    var charge = project.charge || '';
    var institution = project.institution || '';
    var dept = project.department || '';
    var start = project.startDate || '';
    var end = project.endDate || '';
    var submitDate = project.submitDate || '';
    var submitSystem = (project.submitSystem || project['제출처'] || '').toString().trim();
    var submitSystemDetail = (project.submitSystemDetail || project['제출처 상세'] || '').toString().trim();
    var submitDeadline = (project.submitDeadline || project['마감 시간'] || '').toString().trim();
    // 표시용 제출처 — "직접 입력"이면 상세값 그대로, 시스템/메일이면 "라벨 (상세)"
    var submitSystemDisplay;
    if (submitSystem === '직접 입력') {
      submitSystemDisplay = submitSystemDetail;
    } else if (submitSystem && submitSystemDetail) {
      submitSystemDisplay = submitSystem + ' (' + submitSystemDetail + ')';
    } else {
      submitSystemDisplay = submitSystem;
    }

    // 참여 형태 표시 문자열
    // 단독 / 컨소 (주관) / 컨소 (참여 · 주관: 한국전기연구원)
    var participationType = project.participationType || '단독';
    var consortiumRole = project.consortiumRole || '';
    var consortiumLead = (project.consortiumLead || '').toString().trim();
    var consortiumPartners = (project.consortiumPartners || '').toString().trim();
    var participationDisplay = '';
    if (participationType === '컨소') {
      if (consortiumRole === '주관') {
        participationDisplay = '컨소 (주관)';
      } else if (consortiumRole === '참여') {
        participationDisplay = '컨소 (참여)';
        if (consortiumLead) participationDisplay += ' · 주관: ' + consortiumLead;
      } else {
        participationDisplay = '컨소';
      }
    } else {
      participationDisplay = '단독';
    }

    var progress = calcProgressPct(start, end);
    var ybs = project.yearBudgets || [];
    var supportTotal = ybs.reduce(function (s, yb) { return s + (Number(yb.support) || 0); }, 0);

    // 헤더 제목
    if (titleEl) {
      if (eventType === 'submit-virtual') titleEl.textContent = '제출 일정 정보';
      else if (eventType === 'milestone') titleEl.textContent = '마일스톤 정보';
      else titleEl.textContent = '일정 정보';
    }

    var html = '';

    // 이벤트 종류 표시
    if (eventType === 'submit-virtual') {
      html += '<div class="ci-event-type ci-event-type--submit">📝 제출일 · ' + escapeHtml(eventDate || submitDate) + '</div>';
    } else if (eventType === 'milestone') {
      html += '<div class="ci-event-type ci-event-type--milestone">🚩 ' + escapeHtml(milestoneItem || '마일스톤') + ' · ' + escapeHtml(eventDate || '') + '</div>';
    }

    // 뱃지
    html += '<div class="ci-badges">';
    if (division) html += '<span class="ci-badge ci-badge--division">' + escapeHtml(division) + '</span>';
    if (status) html += '<span class="ci-badge ci-badge--status">' + escapeHtml(status) + '</span>';
    if (keyword) {
      keyword.split('|').slice(0, 3).forEach(function (k) {
        if (k.trim()) html += '<span class="ci-badge ci-badge--keyword">' + escapeHtml(k.trim()) + '</span>';
      });
    }
    html += '</div>';

    // 제목 (과제명 미정 시 회색 placeholder)
    if (hasProjectName) {
      html += '<h3 class="ci-project-name">' + escapeHtml(name) + '</h3>';
    } else {
      html += '<h3 class="ci-project-name" style="color:#94a3b8;font-weight:500;">' + escapeHtml(name) + '</h3>';
    }
    if (business) html += '<p class="ci-business">' + escapeHtml(business) + '</p>';

    // 정보
    html += '<dl class="ci-info-list">';
    if (manager && charge && manager === charge) {
      // 책임자와 담당자가 같은 사람
      html += '<dt>책임자/담당자</dt><dd>' + escapeHtml(manager) + '</dd>';
    } else {
      if (manager) html += '<dt>책임자</dt><dd>' + escapeHtml(manager) + '</dd>';
      if (charge) html += '<dt>담당자</dt><dd>' + escapeHtml(charge) + '</dd>';
    }
    if (dept) html += '<dt>부처</dt><dd>' + escapeHtml(dept) + '</dd>';
    if (institution) html += '<dt>기관</dt><dd>' + escapeHtml(institution) + '</dd>';
    // 참여 형태 (단독 / 컨소+주관 정보)
    html += '<dt>참여 형태</dt><dd>' + escapeHtml(participationDisplay) + '</dd>';
    // 공동 참여기관 (컨소일 때만)
    if (participationType === '컨소' && consortiumPartners) {
      html += '<dt>공동 참여</dt><dd>' + escapeHtml(consortiumPartners) + '</dd>';
    }
    if (start && end) html += '<dt>기간</dt><dd>' + escapeHtml(start) + ' ~ ' + escapeHtml(end) + '</dd>';
    // 제출 일정 모달일 때만 제출처/마감시간 표시
    if (eventType === 'submit-virtual') {
      if (submitSystemDisplay) html += '<dt>제출처</dt><dd>' + escapeHtml(submitSystemDisplay) + '</dd>';
      if (submitDeadline) html += '<dt>마감 시간</dt><dd>' + escapeHtml(submitDeadline) + '</dd>';
    }
    if (supportTotal > 0) html += '<dt>정부지원금</dt><dd><strong style="color:#047857">' + formatNum(supportTotal) + ' 원</strong></dd>';
    html += '</dl>';

    // 진행률
    if (progress !== null) {
      html += '<div class="ci-progress">';
      html += '<div class="ci-progress-label"><span>진행률</span><strong>' + progress + '%</strong></div>';
      html += '<div class="ci-progress-bar"><div class="ci-progress-fill" style="width:' + progress + '%"></div></div>';
      html += '</div>';
    }

    // 마일스톤 미니 타임라인 (해당 과제의 모든 마일스톤)
    var savedEvents = loadEvents();
    var milestones = (savedEvents || []).filter(function (ev) {
      return ev.type === 'milestone' && ev.projectId === (project.id || project.docId);
    });
    if (milestones.length > 0) {
      milestones.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
      html += '<div class="ci-ms-list">';
      html += '<h4 class="ci-ms-title">🚩 마일스톤 (' + milestones.length + ')</h4>';
      milestones.forEach(function (ms) {
        var doneClass = ms.done ? ' done' : '';
        html += '<div class="ci-ms-item' + doneClass + '">';
        html += '<span class="ci-ms-item-date">' + escapeHtml(ms.date || '') + '</span>';
        html += '<span>' + (ms.done ? '✓ ' : '') + escapeHtml(ms.item || '') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    body.innerHTML = html;
  }


  // 제출일을 가상 calendar event로 변환 (저장 안 함, 표시 전용)
  function buildSubmitEventsFromProjects(projects) {
    return (projects || [])
      .filter(function (p) {
        var s = (p.submitDate || p['제출일'] || '').toString();
        return s && /^\d{4}-\d{2}-\d{2}/.test(s);
      })
      .map(function (p) {
        var status = (p.status || '').toString().trim();
        var statusGroup;
        if (status === '예정' || status === '대기') statusGroup = 'pending';
        else if (status === '수행' || status === '수행중') statusGroup = 'ongoing';
        else if (status === '미선정' || status === '종료' || status === '미제출' || status === '선정(기타)' || status === '선정 (기타)') statusGroup = 'closed';
        else statusGroup = 'unknown';
        // 캘린더 셀 제목: 키워드(첫 번째) 우선, 없으면 과제명. 과제명은 모달에서 따로 표시
        var keywords = (p.keywords || '').toString();
        var firstKeyword = keywords.split('|')[0].trim();
        var projectName = p.projectName || p['과제명'] || '';
        var displayName = firstKeyword || projectName || '(이름 미정)';
        // 제출처/마감시간 — 캘린더 셀에 표시할 부가 정보
        var submitSystem = (p.submitSystem || p['제출처'] || '').toString().trim();
        var submitSystemDetail = (p.submitSystemDetail || p['제출처 상세'] || '').toString().trim();
        var submitDeadline = (p.submitDeadline || p['마감 시간'] || '').toString().trim();
        // "직접 입력"이면 상세값을 제출처로 사용 (라벨 안 보이게)
        var systemDisplay = (submitSystem === '직접 입력') ? submitSystemDetail : submitSystem;
        // "(제출처, ~마감시간)" 형태 조립 (둘 다 비면 ()는 생략)
        var extraParts = [];
        if (systemDisplay) extraParts.push(systemDisplay);
        if (submitDeadline) extraParts.push('~' + submitDeadline);
        var extra = extraParts.length ? ' (' + extraParts.join(', ') + ')' : '';
        var displayTitle = displayName + extra;
        return {
          id: 'submit-' + (p.id || p.docId || ''),
          date: (p.submitDate || p['제출일']).toString().slice(0, 10),
          projectId: p.id || p.docId,
          projectTitle: displayTitle,
          projectName: projectName,
          keywords: keywords,
          submitSystem: submitSystem,
          submitSystemDetail: submitSystemDetail,
          submitDeadline: submitDeadline,
          item: '제출',
          type: 'submit-virtual',
          statusGroup: statusGroup,
          originalStatus: status
        };
      });
  }

  function submitEventsToFullCalendar(events) {
    return (events || []).map(function (ev) {
      return {
        id: ev.id,
        title: '📝 ' + ev.projectTitle,
        start: ev.date,
        allDay: true,
        classNames: ['fc-event-submit', 'fc-event-submit-' + ev.statusGroup],
        extendedProps: {
          type: 'submit-virtual',
          projectId: ev.projectId,
          projectTitle: ev.projectTitle,
          projectName: ev.projectName,
          keywords: ev.keywords,
          item: '제출',
          statusGroup: ev.statusGroup,
          originalStatus: ev.originalStatus
        }
      };
    });
  }


  function loadEvents() {
    try {
      if (window.firestoreService) return window.firestoreService.getCalendarEvents();
      var raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveEvents(events) {
    try {
      if (window.firestoreService && window.firestoreService.isConfigured()) {
        window.firestoreService.saveCalendarEvents(events);
      } else {
        localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
      }
    } catch (e) {
      console.error('캘린더 이벤트 저장 실패:', e);
    }
  }

  function getProjects() {
    try {
      if (window.firestoreService) {
        var state = window.firestoreService.getParticipationState();
        if (state && Array.isArray(state.projects)) return state.projects;
      }
      var raw = localStorage.getItem(PARTICIPATION_STORAGE_KEY);
      var state = raw ? JSON.parse(raw) : null;
      return (state && Array.isArray(state.projects)) ? state.projects : [];
    } catch (e) {
      return [];
    }
  }

  function eventsToFullCalendar(events) {
    return (events || []).map(function (ev) {
      var proj = ev.projectTitle || '';
      var item = ev.item || '';
      var isMilestone = ev.type === 'milestone';
      var prefix = isMilestone ? '🚩 ' : '📌 ';
      var title = prefix + (proj ? (proj + (item ? ' · ' + item : '')) : (item || ''));
      var isNew = !!ev.isNew;
      var classes = [];
      if (isNew) classes.push('fc-event-new');
      if (isMilestone) classes.push('fc-event-milestone');
      return {
        id: ev.id,
        title: title,
        start: ev.date,
        allDay: true,
        classNames: classes,
        extendedProps: {
          projectTitle: ev.projectTitle,
          item: ev.item,
          projectId: ev.projectId,
          submissionMethod: ev.submissionMethod,
          deadlineTime: ev.deadlineTime,
          isNew: isNew,
          type: ev.type || '',
          manager: ev.manager || '',
          note: ev.note || '',
          done: !!ev.done
        }
      };
    });
  }

  function ensureCalendarLegend() {
    if (document.getElementById('calendar-legend')) return;
    var wrap = document.getElementById('calendar-wrap');
    if (!wrap) return;

    // CSS 주입 (한 번만)
    if (!document.getElementById('calendar-legend-style')) {
      var style = document.createElement('style');
      style.id = 'calendar-legend-style';
      style.textContent =
        // 색상 안내 — 캘린더 헤더툴바(< 2026년 5월 >)와 요일 헤더(일/월/화...) 사이에 위치
        '.calendar-legend { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; justify-content: flex-end; ' +
        'padding: 0.15rem 0.5rem 0.45rem; ' +
        'font-size: 0.74rem; color: #475569; }' +
        '.calendar-legend-label { color: #94a3b8; font-weight: 600; margin-right: 0.15rem; }' +
        '.calendar-legend-item { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; }' +
        '.calendar-legend-swatch { display: inline-block; width: 14px; height: 10px; border-radius: 2px; ' +
        'border-left-width: 3px; border-left-style: solid; }' +
        /* 캘린더 이벤트 위에서 포인터 커서 강제 (I-beam 방지) */
        '.fc-event, .fc-event * { cursor: pointer !important; user-select: none; }' +
        '.fc-event-holiday, .fc-event-holiday * { cursor: default !important; }';
      document.head.appendChild(style);
    }
  }

  // FullCalendar 렌더 후 호출 — fc-toolbar(헤더) 와 fc-view(그리드) 사이에 legend 삽입
  function insertLegendInsideCalendar() {
    var wrap = document.getElementById('calendar-wrap');
    if (!wrap) return;
    // 이미 있으면 제거 후 재삽입 (정확한 위치 보장)
    var existing = document.getElementById('calendar-legend');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var toolbar = wrap.querySelector('.fc-header-toolbar') || wrap.querySelector('.fc-toolbar');
    if (!toolbar) return;  // 캘린더가 아직 렌더 안 됨 → 다음에 시도

    var legend = document.createElement('div');
    legend.id = 'calendar-legend';
    legend.className = 'calendar-legend';
    legend.innerHTML =
      '<span class="calendar-legend-label">색상 안내</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#fef3c7;border-left-color:#f59e0b;"></span>🚩 마일스톤</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#ede9fe;border-left-color:#8b5cf6;"></span>📝 예정/대기</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#e0e7ff;border-left-color:#6366f1;"></span>📝 수행 중</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#f1f5f9;border-left-color:#94a3b8;"></span>📝 종료/미선정</span>';

    // 헤더툴바 바로 다음에 삽입 → 헤더와 요일헤더 사이 자리
    if (toolbar.nextSibling) {
      toolbar.parentNode.insertBefore(legend, toolbar.nextSibling);
    } else {
      toolbar.parentNode.appendChild(legend);
    }
  }

  function initCalendar() {
    console.log('=== CALENDAR RENDER START ===');
    var wrap = document.getElementById('calendar-wrap');
    if (!wrap) {
      console.warn('Calendar init skip: calendar-wrap not found');
      return;
    }
    if (typeof FullCalendar === 'undefined') {
      console.warn('FullCalendar not loaded yet, retrying in 1 second...');
      setTimeout(function () {
        if (typeof FullCalendar !== 'undefined') {
          initCalendar();
        } else {
          console.error('FullCalendar 로드 실패. 페이지를 새로고침해 주세요.');
        }
      }, 1000);
      return;
    }
    calendarWrap = wrap;
    if (calendar) {
      if (calendar._resizeHandler) {
        window.removeEventListener('resize', calendar._resizeHandler);
      }
      calendar.destroy();
      calendar = null;
    }
    calendarEl = document.createElement('div');
    calendarEl.id = 'calendar';
    calendarWrap.innerHTML = '';
    // 1) 색상 안내(legend)를 먼저 추가 → calendarEl을 그 다음에 추가하면
    //    legend가 calendar-wrap 안의 첫 자식이 되고, 캘린더 그리드는 그 아래에 옴
    ensureCalendarLegend();
    calendarWrap.appendChild(calendarEl);

    var events = loadEvents();
    var fcEvents = eventsToFullCalendar(events);
    var submitEvents = buildSubmitEventsFromProjects(currentProjects);
    var fcSubmit = submitEventsToFullCalendar(submitEvents);
    var allEvents = fcEvents.concat(fcSubmit).concat(HOLIDAY_EVENTS);

    var holidaySet = {};
    HOLIDAY_DATES.forEach(function (d) { holidaySet[d] = true; });

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      locale: 'ko',
      headerToolbar: { left: 'prev', center: 'title', right: 'next' },
      height: 'auto',           // 콘텐츠 높이에 맞춰 자동 — 페이지 스크롤 가능
      contentHeight: 'auto',
      expandRows: false,        // 빈 셀이 의도치 않게 늘어나지 않게
      handleWindowResize: true,
      fixedWeekCount: true,
      showNonCurrentDates: true,
      // 셀당 최대 이벤트 3개 → 초과 시 "+N more" 링크
      dayMaxEvents: 3,
      moreLinkContent: function (arg) {
        return { html: '+' + arg.num + ' 더보기' };
      },
      // 이벤트 정렬: 종일 > 시작 시간 > 제목
      eventOrder: 'start,-duration,allDay,title',
      // 월 변경(prev/next) 후에도 색상 안내 위치 유지
      datesSet: function () {
        setTimeout(insertLegendInsideCalendar, 0);
      },
      dayCellClassNames: function (arg) {
        var d = arg.date;
        var dateStr = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
        return holidaySet[dateStr] ? ['fc-day-holiday'] : [];
      },
      dayCellContent: function (arg) {
        var num = (arg.dayNumberText || '').replace('일', '');
        return { html: '<span class="fc-daygrid-day-number">' + num + '</span>' };
      },
      editable: false,
      selectable: false,
      dateClick: function (info) {
        info.jsEvent.preventDefault();
        selectedDateStr = info.dateStr;
        editingEventId = null;
        editingEventOriginal = null;
        openModal(selectedDateStr);
      },
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        var ev = info.event;
        var ext = ev.extendedProps || {};
        var dateStr = ev.startStr ? ev.startStr.slice(0, 10) : null;

        // 제출일 가상 이벤트 → 정보 모달
        if (ext.type === 'submit-virtual') {
          openInfoModal(ext.projectId, 'submit-virtual', dateStr);
          return;
        }
        // 마일스톤 → 정보 모달
        if (ext.type === 'milestone') {
          openInfoModal(ext.projectId, 'milestone', dateStr, ext.item);
          return;
        }

        // 일반 일정 → 기존 modal (빠른 수정)
        editingEventId = ev.id;
        selectedDateStr = dateStr;
        var allEvts = loadEvents();
        editingEventOriginal = allEvts.find(function (e) { return e.id === ev.id; }) || null;
        openModal(selectedDateStr, ev);
      },
      events: allEvents,
      eventContent: function (arg) {
        var ext = arg.event.extendedProps || {};
        var proj = ext.projectTitle || '';
        var item = ext.item || '';
        var deadlineTime = (ext.deadlineTime || '').trim();
        var isNew = !!ext.isNew;
        var isMilestone = ext.type === 'milestone';
        var isSubmit = ext.type === 'submit-virtual';
        var isDone = !!ext.done;

        // 제출일 가상 이벤트 — 보라색 톤 (상태별 그룹)
        if (isSubmit) {
          var sLabel = '📝 ' + proj;
          var sSpan = document.createElement('span');
          sSpan.className = 'calendar-event-badge calendar-event-badge--submit';
          var bg, color, border;
          if (ext.statusGroup === 'pending') {
            bg = '#ede9fe'; color = '#5b21b6'; border = '#8b5cf6'; // 진한 보라
          } else if (ext.statusGroup === 'ongoing') {
            bg = '#e0e7ff'; color = '#3730a3'; border = '#6366f1'; // 인디고
          } else {
            bg = '#f1f5f9'; color = '#64748b'; border = '#94a3b8'; // 회색
          }
          sSpan.style.background = bg;
          sSpan.style.color = color;
          sSpan.style.borderLeft = '3px solid ' + border;
          sSpan.style.paddingLeft = '0.35rem';
          if (ext.statusGroup === 'closed') sSpan.style.opacity = '0.7';
          sSpan.appendChild(document.createTextNode(sLabel));
          return { domNodes: [sSpan] };
        }

        var label = proj ? (proj + (item ? ' ' + item : '')) : (item || '');
        if (isMilestone) {
          label = (isDone ? '✓ ' : '🚩 ') + label;
        } else if (isNew) {
          label = '[NEW] ' + label;
        }
        var span = document.createElement('span');
        span.className = 'calendar-event-badge';
        if (isNew && !isMilestone) span.className += ' calendar-event-badge--new';
        if (isMilestone) {
          span.className += ' calendar-event-badge--milestone';
          // 인라인 스타일로 마일스톤 시각 구분 (CSS 파일 변경 없이)
          span.style.background = isDone ? '#d1fae5' : '#fef3c7';
          span.style.color = isDone ? '#065f46' : '#92400e';
          span.style.borderLeft = '3px solid ' + (isDone ? '#10b981' : '#f59e0b');
          span.style.paddingLeft = '0.35rem';
          if (isDone) span.style.textDecoration = 'line-through';
        }
        span.appendChild(document.createTextNode(label));
        if (deadlineTime && !isMilestone) {
          var timeSpan = document.createElement('span');
          timeSpan.className = 'calendar-event-badge-time';
          timeSpan.textContent = label ? ' | ' + deadlineTime : deadlineTime;
          span.appendChild(timeSpan);
        }
        return { domNodes: [span] };
      }
    });
    var resizeHandler = function () {
      if (calendar && document.getElementById('page-calendar') && !document.getElementById('page-calendar').hidden) {
        calendar.updateSize();
      }
    };
    window.addEventListener('resize', resizeHandler);
    calendar._resizeHandler = resizeHandler;

    var el = document.getElementById('calendar');
    var doRender = function () {
      if (!calendar) return;
      calendar.render();
      // 캘린더 렌더 후, 헤더와 요일헤더 사이에 색상 안내 삽입
      insertLegendInsideCalendar();
      window.dispatchEvent(new Event('resize'));
      setTimeout(function () {
        if (calendar) {
          calendar.updateSize();
          // updateSize 후 DOM이 변경될 수 있어 한 번 더 보정
          insertLegendInsideCalendar();
          window.dispatchEvent(new Event('resize'));
          setTimeout(function () {
            if (calendar) calendar.updateSize();
          }, 50);
        }
      }, 100);
      console.log('=== CALENDAR RENDER END ===');
    };
    if (el) {
      doRender();
    } else {
      requestAnimationFrame(function () {
        if (document.getElementById('calendar')) doRender();
      });
    }
  }

  function openModal(dateStr, existingEvent) {
    if (!modal || !dateInput || !projectInput || !itemInput) return;
    selectedDateStr = dateStr;
    var projects = getProjects();
    if (projectDatalist) {
      projectDatalist.innerHTML = '';
      projects.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.title || p.name || '새 과제';
        projectDatalist.appendChild(opt);
      });
    }
    dateInput.value = dateStr ? formatDateDisplay(dateStr) : '';
    timeInput.value = '18:00';
    var typeExisting = document.querySelector('input[name="calendar-event-type"][value="existing"]');
    var typeNew = document.querySelector('input[name="calendar-event-type"][value="new"]');
    if (existingEvent) {
      var ext = existingEvent.extendedProps || {};
      projectInput.value = ext.projectTitle || '';
      itemInput.value = ext.item || '';
      if (methodInput) methodInput.value = ext.submissionMethod || '';
      if (timeInput) timeInput.value = ext.deadlineTime || '18:00';
      if (typeExisting && typeNew) {
        if (ext.isNew) typeNew.checked = true;
        else typeExisting.checked = true;
      }
      // 마일스톤 표시 (편집 가능하지만 안내)
      var isMilestone = ext.type === 'milestone';
      modalTitle.textContent = isMilestone ? '마일스톤 수정' : '일정 수정';
      if (submitBtn) submitBtn.textContent = '수정';
      if (deleteBtn) deleteBtn.style.display = '';
    } else {
      projectInput.value = '';
      itemInput.value = '';
      if (methodInput) methodInput.value = '';
      if (timeInput) timeInput.value = '18:00';
      if (typeExisting && typeNew) typeExisting.checked = true;
      modalTitle.textContent = '일정 등록';
      if (submitBtn) submitBtn.textContent = '등록';
      if (deleteBtn) deleteBtn.style.display = 'none';
    }
    modal.classList.add('active');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function formatDateDisplay(str) {
    if (!str || str.length < 10) return str;
    return str.slice(0, 4) + '.' + str.slice(5, 7) + '.' + str.slice(8, 10);
  }

  function closeModal() {
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('hidden', '');
      modal.setAttribute('aria-hidden', 'true');
    }
    selectedDateStr = null;
    editingEventId = null;
    editingEventOriginal = null;
  }

  function generateId() {
    return 'ce-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!selectedDateStr || !projectInput || !itemInput) return;
    var projectTitle = (projectInput.value || '').trim();
    if (!projectTitle) return;
    var item = (itemInput.value || '').trim();
    var submissionMethod = methodInput ? (methodInput.value || '').trim() : '';
    var deadlineTime = timeInput ? (timeInput.value || '18:00') : '18:00';
    var typeRadio = document.querySelector('input[name="calendar-event-type"]:checked');
    var isNew = typeRadio && typeRadio.value === 'new';
    var projectId = '';
    var projects = getProjects();
    var matched = projects.find(function (p) { return (p.title || p.name) === projectTitle; });
    if (matched) projectId = matched.id || matched.title || '';

    var events = loadEvents();
    if (editingEventId) {
      events = events.map(function (ev) {
        if (ev.id === editingEventId) {
          var base = {
            id: ev.id,
            date: selectedDateStr,
            projectId: ev.projectId || projectId, // 마일스톤은 R&D projectId 유지
            projectTitle: projectTitle,
            item: item,
            submissionMethod: submissionMethod,
            deadlineTime: deadlineTime,
            isNew: isNew
          };
          // 마일스톤 전용 필드 보존
          if (ev.type === 'milestone') {
            base.type = 'milestone';
            base.manager = ev.manager || '';
            base.note = ev.note || '';
            base.done = !!ev.done;
            base.deadlineTime = ''; // 마일스톤은 시간 정보 불필요
          }
          return base;
        }
        return ev;
      });
    } else {
      var newEv = {
        id: generateId(),
        date: selectedDateStr,
        projectId: projectId,
        projectTitle: projectTitle,
        item: item,
        submissionMethod: submissionMethod,
        deadlineTime: deadlineTime,
        isNew: isNew
      };
      events.push(newEv);
    }
    saveEvents(events);
    refreshCalendar();
    closeModal();
  }

  function handleDelete() {
    if (!editingEventId) return;
    var events = loadEvents().filter(function (ev) { return ev.id !== editingEventId; });
    saveEvents(events);
    refreshCalendar();
    closeModal();
  }

  // ===== 일정 알림 카드 (D-14/D-7/D-3/D-day/종료예정) =====
  // 대시보드와 동일한 로직, 캘린더 페이지 전용. 클릭 시 해당 날짜로 캘린더 이동.
  function calcStatusForCalAlert(it) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    if (raw === '선정') raw = '선정(기타)';
    var n = raw.replace(/\s/g, '');
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString().slice(0, 10);
    var start = (it.startDate || it.start || '').toString().slice(0, 10);
    var end = (it.endDate || it.end || '').toString().slice(0, 10);
    var submit = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
    // 자동 전환
    if (n === '수행' && end && end < todayStr) return '종료';
    if (n === '예정' && submit && submit < todayStr) return '대기';
    // 비어있을 때 추론
    if (!raw) {
      if (start && end && start <= todayStr && todayStr <= end) return '수행';
      if (end && end < todayStr) return '종료';
      if (submit && submit >= todayStr) return '예정';
    }
    return raw;
  }

  function escapeHtmlCal(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function refreshAlertCard() {
    var listEl = document.getElementById('cal-alert-list');
    if (!listEl) return;  // 알림 카드 영역 없으면 (다른 페이지) 종료

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString().slice(0, 10);
    var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    var monthEndStr = monthEnd.toISOString().slice(0, 10);

    var d30Count = 0, d14Count = 0, d7Count = 0, d3Count = 0, ddayCount = 0, endingCount = 0;
    var allAlerts = [];

    // 제출 임박 (모든 과제, 상태 무관)
    (currentProjects || []).forEach(function (it) {
      var name = it.projectName || it['과제명'] || it.keywords || '(제목 없음)';
      var pid = it.id || it.docId || '';
      var submit = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submit && submit >= todayStr) {
        var diffS = Math.round((new Date(submit) - today) / (1000 * 60 * 60 * 24));
        if (diffS === 0) ddayCount++;
        else if (diffS >= 1 && diffS <= 3) d3Count++;
        else if (diffS >= 4 && diffS <= 7) d7Count++;
        else if (diffS >= 8 && diffS <= 14) d14Count++;
        else if (diffS >= 15 && diffS <= 30) d30Count++;
        if (diffS >= 0 && diffS <= 30) {
          allAlerts.push({
            name: name, date: submit, dDay: diffS, type: 'submit', projectId: pid
          });
        }
      }
      // 종료 예정 (수행 상태, 이번 달 안에 종료)
      if (calcStatusForCalAlert(it) === '수행') {
        var end = (it.endDate || it.end || '').toString().slice(0, 10);
        if (end && end >= todayStr && end <= monthEndStr) {
          endingCount++;
          var diffE = Math.round((new Date(end) - today) / (1000 * 60 * 60 * 24));
          allAlerts.push({
            name: name, date: end, dDay: Math.max(0, diffE), type: 'end', projectId: pid
          });
        }
      }
    });

    // 마일스톤 임박 (D-30 이내, 미완료)
    var events = loadEvents();
    (events || []).forEach(function (ev) {
      if (ev.type !== 'milestone') return;
      if (ev.done) return;
      var date = (ev.date || '').toString().slice(0, 10);
      if (!date || date < todayStr) return;
      var diffM = Math.round((new Date(date) - today) / (1000 * 60 * 60 * 24));
      if (diffM > 30) return;
      var label = (ev.projectTitle || '') + (ev.item ? ' · ' + ev.item : '');
      if (diffM === 0) ddayCount++;
      else if (diffM >= 1 && diffM <= 3) d3Count++;
      else if (diffM >= 4 && diffM <= 7) d7Count++;
      else if (diffM >= 8 && diffM <= 14) d14Count++;
      else if (diffM >= 15 && diffM <= 30) d30Count++;
      allAlerts.push({
        name: label, date: date, dDay: diffM, type: 'milestone', projectId: ev.projectId || ''
      });
    });

    // 카드 숫자 갱신
    var setNum = function (id, n) {
      var el = document.getElementById(id);
      if (el) el.textContent = n;
    };
    setNum('cal-alert-d30', d30Count);
    setNum('cal-alert-d14', d14Count);
    setNum('cal-alert-d7', d7Count);
    setNum('cal-alert-d3', d3Count);
    setNum('cal-alert-dday', ddayCount);
    setNum('cal-alert-ending', endingCount);

    // 알림 리스트 (D-day 가까운 순, 최대 6개)
    allAlerts.sort(function (a, b) { return a.dDay - b.dDay; });
    listEl.innerHTML = '';
    if (allAlerts.length === 0) {
      listEl.innerHTML = '<div class="cal-alert-empty">임박한 일정이 없습니다.</div>';
      return;
    }
    allAlerts.slice(0, 6).forEach(function (a) {
      var icon, ddayClass;
      if (a.type === 'end') { icon = '⏰'; ddayClass = 'end'; }
      else if (a.type === 'milestone') { icon = '🚩'; ddayClass = a.dDay === 0 ? 'dday' : (a.dDay <= 3 ? 'd3' : ''); }
      else { icon = '📝'; ddayClass = a.dDay === 0 ? 'dday' : (a.dDay <= 3 ? 'd3' : ''); }
      var ddayLabel = a.dDay === 0 ? 'D-day' : 'D-' + a.dDay;
      var div = document.createElement('div');
      div.className = 'cal-alert-item';
      div.setAttribute('data-date', a.date);
      div.setAttribute('data-project-id', a.projectId || '');
      div.innerHTML =
        '<span class="cal-alert-item-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="cal-alert-item-name" title="' + escapeHtmlCal(a.name) + '">' + escapeHtmlCal(a.name) + '</span>' +
        '<span class="cal-alert-item-meta">' + escapeHtmlCal(a.date) + '</span>' +
        '<span class="cal-alert-item-dday cal-alert-item-dday--' + ddayClass + '">' + ddayLabel + '</span>';
      // 클릭 시 캘린더 해당 날짜로 이동
      div.addEventListener('click', function () {
        if (calendar && a.date) {
          try { calendar.gotoDate(a.date); } catch (e) {}
        }
      });
      listEl.appendChild(div);
    });
  }

  // 알림 카드 셀 클릭 → 해당 D-N 일자의 첫 알림 항목 위치로 캘린더 이동
  function bindAlertCellClicks() {
    var cells = document.querySelectorAll('.cal-alert-cell');
    if (!cells.length) return;
    if (cells[0].__bound) return;
    cells.forEach(function (cell) {
      cell.__bound = true;
      cell.addEventListener('click', function () {
        var bucket = cell.getAttribute('data-bucket');
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var target = new Date(today);
        if (bucket === 'd30') target.setDate(target.getDate() + 30);
        else if (bucket === 'd14') target.setDate(target.getDate() + 14);
        else if (bucket === 'd7') target.setDate(target.getDate() + 7);
        else if (bucket === 'd3') target.setDate(target.getDate() + 3);
        else if (bucket === 'dday') { /* 오늘 */ }
        else if (bucket === 'ending') {
          // 이번 달 마지막 날
          target = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        }
        if (calendar) {
          try { calendar.gotoDate(target); } catch (e) {}
        }
      });
    });
  }

  function refreshCalendar() {
    if (!calendar) return;
    var events = loadEvents();
    var fcEvents = eventsToFullCalendar(events);
    var submitEvents = buildSubmitEventsFromProjects(currentProjects);
    var fcSubmit = submitEventsToFullCalendar(submitEvents);
    calendar.removeAllEvents();
    fcEvents.forEach(function (ev) {
      calendar.addEvent(ev);
    });
    fcSubmit.forEach(function (ev) {
      calendar.addEvent(ev);
    });
    HOLIDAY_EVENTS.forEach(function (ev) {
      calendar.addEvent(ev);
    });
    // 알림 카드 동기화
    refreshAlertCard();
  }

  function onPageShow() {
    initCalendar();
    bindAlertCellClicks();
    refreshAlertCard();
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  if (form) form.addEventListener('submit', handleSubmit);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  // 📅 구글 캘린더에 추가 — 일정 등록 모달
  var gcalBtn = document.getElementById('calendar-event-gcal');
  if (gcalBtn) {
    gcalBtn.addEventListener('click', function () {
      var date = (dateInput && dateInput.value || '').trim();
      var time = (timeInput && timeInput.value || '').trim();
      var pname = (projectInput && projectInput.value || '').trim();
      var item = (itemInput && itemInput.value || '').trim();
      var method = (methodInput && methodInput.value || '').trim();

      if (!date) { alert('날짜를 먼저 선택해주세요.'); return; }
      if (!pname) { alert('과제명을 입력해주세요.'); return; }

      // 입력된 과제명과 매칭되는 R&D 과제 찾기 → 사업명/책임자/담당자/기관/제출처/마감시간 자동 채움
      var matched = (currentProjects || []).find(function (p) {
        var pn = (p.projectName || p['과제명'] || '').trim();
        return pn && pn === pname;
      });
      var business = matched ? (matched.business || matched['사업명'] || '').trim() : '';
      var manager = matched ? (matched.manager || '') : '';
      var charge = matched ? (matched.charge || '') : '';
      var institution = matched ? (matched.institution || '') : '';
      var submitSystem = matched ? (matched.submitSystem || '').toString().trim() : '';
      var submitSystemDetail = matched ? (matched.submitSystemDetail || '').toString().trim() : '';
      var submitDeadline = matched ? (matched.submitDeadline || '').toString().trim() : '';
      // 매칭된 과제의 참여 형태
      var gcParticipationType = matched ? (matched.participationType || '단독') : '단독';
      var gcConsortiumRole = matched ? (matched.consortiumRole || '') : '';
      var gcConsortiumLead = matched ? (matched.consortiumLead || '').toString().trim() : '';
      var gcConsortiumPartners = matched ? (matched.consortiumPartners || '').toString().trim() : '';
      var gcParticipationDisplay = '';
      if (gcParticipationType === '컨소') {
        if (gcConsortiumRole === '주관') {
          gcParticipationDisplay = '컨소 (주관)';
        } else if (gcConsortiumRole === '참여') {
          gcParticipationDisplay = '컨소 (참여)';
          if (gcConsortiumLead) gcParticipationDisplay += ' · 주관: ' + gcConsortiumLead;
        } else {
          gcParticipationDisplay = '컨소';
        }
      } else {
        gcParticipationDisplay = '단독';
      }
      // 마감 시간 폼에서 입력된 게 있으면 그 값 우선 사용 (직접 등록 시 자유롭게)
      if (time && !submitDeadline) submitDeadline = time;

      // 책임자/담당자 한 줄
      var personLine = '';
      if (manager && charge) {
        personLine = (manager === charge) ? manager : (manager + ' / ' + charge);
      } else {
        personLine = manager || charge || '';
      }

      // 제출처 표시: "직접 입력"이면 상세값 그대로
      var submitSystemDisplay;
      if (submitSystem === '직접 입력') {
        submitSystemDisplay = submitSystemDetail;
      } else if (submitSystem && submitSystemDetail) {
        submitSystemDisplay = submitSystem + ' (' + submitSystemDetail + ')';
      } else {
        submitSystemDisplay = submitSystem;
      }

      // 제목: 매칭된 과제의 키워드 우선, 없으면 입력한 과제명
      var firstKw = matched
        ? (matched.keywords || '').toString().split('|')[0].trim()
        : '';
      var displayName = firstKw || pname;

      // 제목 옆 (제출처, ~마감시간) — 직접 입력일 땐 상세값을 그대로
      var systemForTitle = (submitSystem === '직접 입력') ? submitSystemDetail : submitSystem;
      var extraParts = [];
      if (systemForTitle) extraParts.push(systemForTitle);
      if (submitDeadline) extraParts.push('~' + submitDeadline);
      var extra = extraParts.length ? ' (' + extraParts.join(', ') + ')' : '';

      var title = '[제출' + (item ? ' · ' + item : '') + '] ' + displayName + extra;
      var details =
        '사업명: ' + (business || '-') + '\n' +
        '과제명: ' + (pname || '-') + '\n' +
        '책임자/담당자: ' + (personLine || '-') + '\n' +
        '기관: ' + (institution || '-') + '\n' +
        '참여 형태: ' + gcParticipationDisplay + '\n' +
        (gcParticipationType === '컨소' && gcConsortiumPartners ? '공동 참여: ' + gcConsortiumPartners + '\n' : '') +
        '제출처: ' + (submitSystemDisplay || '-') + '\n' +
        '마감 시간: ' + (submitDeadline || '-') + '\n' +
        (item ? '제출 항목: ' + item + '\n' : '') +
        (method ? '제출 방법: ' + method + '\n' : '') +
        '\n📌 R&DM 시스템에서 자동 생성된 일정입니다.';

      // 기본 초대 멤버 확인 (다른 멤버는 구글 캘린더 페이지에서 추가)
      var inviteList = DEFAULT_INVITEES.map(function (e) { return '• ' + e; }).join('\n');
      var ok = confirm(
        '📅 구글 캘린더에 추가합니다.\n\n' +
        '기본 초대 멤버:\n' +
        inviteList + '\n\n' +
        '※ 다른 멤버는 캘린더 페이지에서 추가할 수 있어요.'
      );
      if (!ok) return;  // 취소
      openGoogleCalendar({
        title: title,
        date: date,
        endDate: date,
        details: details,
        attendees: DEFAULT_INVITEES.join(',')
      });
    });
  }

  window.CalendarManagement = { onPageShow: onPageShow };

  if (window.firestoreService && window.firestoreService.subscribeCalendar) {
    window.firestoreService.subscribeCalendar(function () {
      if (calendar) refreshCalendar();
    });
  }

  // R&D 과제 구독 — 제출일을 자동으로 캘린더에 표시 (가상 이벤트, 저장 X)
  if (window.firestoreService && window.firestoreService.subscribeProjects) {
    window.firestoreService.subscribeProjects(function (projects) {
      currentProjects = Array.isArray(projects) ? projects : [];
      if (calendar) refreshCalendar();
    });
  }

  if ((window.location.hash || '').replace(/^#\/?/, '') === 'calendar') {
    onPageShow();
  }
})();
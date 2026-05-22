// CalendarManagement.js
// 제출 관리 캘린더 페이지 - FullCalendar 기반 일정 등록 및 표시
// + 마일스톤(type='milestone') 시각 구분 + 마일스톤 전용 필드 보존

(function () {
  'use strict';

  var CALENDAR_STORAGE_KEY = 'hr-calendar-events';
  var PARTICIPATION_STORAGE_KEY = 'hr-participation-data-v2';

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

    modal.classList.add('active');
  }

  function renderInfoModal(project, eventType, eventDate, milestoneItem) {
    var titleEl = document.getElementById('ci-modal-title');
    var body = document.getElementById('ci-modal-body');
    if (!body) return;

    var name = project.projectName || project['과제명'] || '(제목 없음)';
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

    // 제목
    html += '<h3 class="ci-project-name">' + escapeHtml(name) + '</h3>';
    if (business) html += '<p class="ci-business">' + escapeHtml(business) + '</p>';

    // 정보
    html += '<dl class="ci-info-list">';
    if (manager) html += '<dt>책임자</dt><dd>' + escapeHtml(manager) + '</dd>';
    if (charge && charge !== manager) html += '<dt>담당자</dt><dd>' + escapeHtml(charge) + '</dd>';
    if (dept) html += '<dt>부처</dt><dd>' + escapeHtml(dept) + '</dd>';
    if (institution) html += '<dt>기관</dt><dd>' + escapeHtml(institution) + '</dd>';
    if (start && end) html += '<dt>기간</dt><dd>' + escapeHtml(start) + ' ~ ' + escapeHtml(end) + '</dd>';
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
        return {
          id: 'submit-' + (p.id || p.docId || ''),
          date: (p.submitDate || p['제출일']).toString().slice(0, 10),
          projectId: p.id || p.docId,
          projectTitle: p.projectName || p.keywords || p['과제명'] || '(이름 없음)',
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
      var prefix = isMilestone ? '🚩 ' : '';
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
    if (!wrap || !wrap.parentNode) return;

    // CSS 주입 (한 번만)
    if (!document.getElementById('calendar-legend-style')) {
      var style = document.createElement('style');
      style.id = 'calendar-legend-style';
      style.textContent =
        '.calendar-legend { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; justify-content: flex-end; ' +
        'padding: 0.35rem 0.25rem; margin-bottom: 0.35rem; ' +
        'font-size: 0.76rem; color: #475569; }' +
        '.calendar-legend-label { color: #94a3b8; font-weight: 600; margin-right: 0.25rem; }' +
        '.calendar-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap; }' +
        '.calendar-legend-swatch { display: inline-block; width: 18px; height: 12px; border-radius: 3px; ' +
        'border-left-width: 3px; border-left-style: solid; }' +
        /* 캘린더 이벤트 위에서 포인터 커서 강제 (I-beam 방지) */
        '.fc-event, .fc-event * { cursor: pointer !important; user-select: none; }' +
        '.fc-event-holiday, .fc-event-holiday * { cursor: default !important; }';
      document.head.appendChild(style);
    }

    var legend = document.createElement('div');
    legend.id = 'calendar-legend';
    legend.className = 'calendar-legend';
    legend.innerHTML =
      '<span class="calendar-legend-label">색상 안내</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#fef3c7;border-left-color:#f59e0b;"></span>🚩 마일스톤</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#ede9fe;border-left-color:#8b5cf6;"></span>📝 제출 (예정/대기)</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#e0e7ff;border-left-color:#6366f1;"></span>📝 제출 (수행 중)</span>' +
      '<span class="calendar-legend-item"><span class="calendar-legend-swatch" style="background:#f1f5f9;border-left-color:#94a3b8;"></span>📝 제출 (종료/미선정)</span>';

    wrap.parentNode.insertBefore(legend, wrap);
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
    ensureCalendarLegend();
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
      height: 'parent',
      expandRows: true,
      handleWindowResize: true,
      fixedWeekCount: true,
      showNonCurrentDates: true,
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
      window.dispatchEvent(new Event('resize'));
      setTimeout(function () {
        if (calendar) {
          calendar.updateSize();
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
  }

  function onPageShow() {
    initCalendar();
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  if (form) form.addEventListener('submit', handleSubmit);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

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
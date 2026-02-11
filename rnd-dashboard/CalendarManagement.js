// CalendarManagement.js
// 제출 관리 캘린더 페이지 - FullCalendar 기반 일정 등록 및 표시

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
  var selectedDateStr = null;
  var editingEventId = null;

  function loadEvents() {
    try {
      var raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveEvents(events) {
    try {
      localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(events));
    } catch (e) {
      console.error('캘린더 이벤트 저장 실패:', e);
    }
  }

  function getProjects() {
    try {
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
      var title = proj ? (proj + (item ? ' · ' + item : '')) : (item || '');
      var isNew = !!ev.isNew;
      return {
        id: ev.id,
        title: title,
        start: ev.date,
        allDay: true,
        classNames: isNew ? ['fc-event-new'] : [],
        extendedProps: {
          projectTitle: ev.projectTitle,
          item: ev.item,
          projectId: ev.projectId,
          submissionMethod: ev.submissionMethod,
          deadlineTime: ev.deadlineTime,
          isNew: isNew
        }
      };
    });
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
    calendarWrap.appendChild(calendarEl);

    var events = loadEvents();
    var fcEvents = eventsToFullCalendar(events);
    var allEvents = fcEvents.concat(HOLIDAY_EVENTS);

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
        openModal(selectedDateStr);
      },
      eventClick: function (info) {
        info.jsEvent.preventDefault();
        var ev = info.event;
        editingEventId = ev.id;
        selectedDateStr = ev.startStr ? ev.startStr.slice(0, 10) : null;
        openModal(selectedDateStr, ev);
      },
      events: allEvents,
      eventContent: function (arg) {
        var ext = arg.event.extendedProps || {};
        var proj = ext.projectTitle || '';
        var item = ext.item || '';
        var deadlineTime = (ext.deadlineTime || '').trim();
        var isNew = !!ext.isNew;
        var label = proj ? (proj + (item ? ' ' + item : '')) : (item || '');
        if (isNew) label = '[NEW] ' + label;
        var span = document.createElement('span');
        span.className = 'calendar-event-badge' + (isNew ? ' calendar-event-badge--new' : '');
        span.appendChild(document.createTextNode(label));
        if (deadlineTime) {
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
      modalTitle.textContent = '일정 수정';
      if (submitBtn) submitBtn.textContent = '수정';
    } else {
      projectInput.value = '';
      itemInput.value = '';
      if (methodInput) methodInput.value = '';
      if (timeInput) timeInput.value = '18:00';
      if (typeExisting && typeNew) typeExisting.checked = true;
      modalTitle.textContent = '일정 등록';
      if (submitBtn) submitBtn.textContent = '등록';
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
    var newEv = {
      date: selectedDateStr,
      projectId: projectId,
      projectTitle: projectTitle,
      item: item,
      submissionMethod: submissionMethod,
      deadlineTime: deadlineTime,
      isNew: isNew
    };
    if (editingEventId) {
      events = events.map(function (ev) {
        if (ev.id === editingEventId) {
          return { id: ev.id, date: newEv.date, projectId: newEv.projectId, projectTitle: newEv.projectTitle, item: newEv.item, submissionMethod: newEv.submissionMethod, deadlineTime: newEv.deadlineTime, isNew: newEv.isNew };
        }
        return ev;
      });
    } else {
      newEv.id = generateId();
      events.push(newEv);
    }
    saveEvents(events);
    refreshCalendar();
    closeModal();
  }

  function refreshCalendar() {
    if (!calendar) return;
    var events = loadEvents();
    var fcEvents = eventsToFullCalendar(events);
    calendar.removeAllEvents();
    fcEvents.forEach(function (ev) {
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
  if (form) form.addEventListener('submit', handleSubmit);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  window.CalendarManagement = { onPageShow: onPageShow };

  if ((window.location.hash || '').replace(/^#\/?/, '') === 'calendar') {
    onPageShow();
  }
})();

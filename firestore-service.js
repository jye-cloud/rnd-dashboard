/**
 * Firestore 실시간 연동 및 LocalStorage 마이그레이션
 * - configure 되었을 때: Firestore onSnapshot / setDoc 사용
 * - configure 안 되었을 때: LocalStorage 사용 (기존 동작 유지)
 */
(function () {
  'use strict';

  var db = window.__firebaseDb;
  var configured = window.__firebaseConfigured;

  var HR_STORAGE_KEY = 'hr-management-data';
  var UI_STATE_KEY = 'hr-management-ui-state';
  var PAYROLL_STORAGE_KEY = 'hr-payroll-data';
  var PARTICIPATION_STORAGE_KEY = 'hr-participation-data-v2';
  var CALENDAR_STORAGE_KEY = 'hr-calendar-events';
  var PROJECTS_STORAGE_KEY = 'rnd-projects-data';
  var PERSONS_STORAGE_KEY = 'rnd-persons-data';
  var LAB_REGS_STORAGE_KEY = 'rnd-lab-registrations';

  var COLL = {
    hr: 'hrPersonnel',
    payroll: 'payroll',
    participation: 'participation',
    calendar: 'calendarEvents',
    projects: 'projects',
    persons: 'persons',
    labRegs: 'labRegistrations'
  };
  var DOC_ID = 'data';

  var _hrData = [];
  var _payrollState = { snapshots: {}, draft: {}, contractSalaries: {}, contractSalaryByMonth: {} };
  var _participationState = null;
  var _calendarEvents = [];
  var _projectsData = [];
  var _personsData = [];
  var _labRegsData = [];

  var _hrCallbacks = [];
  var _payrollCallbacks = [];
  var _participationCallbacks = [];
  var _calendarCallbacks = [];
  var _projectsCallbacks = [];
  var _personsCallbacks = [];
  var _labRegsCallbacks = [];

  function safeParse(str, fallback) {
    try {
      return str ? JSON.parse(str) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getHrData() {
    if (configured) return _hrData;
    return safeParse(localStorage.getItem(HR_STORAGE_KEY), []);
  }

  function getPayrollState() {
    if (configured) return _payrollState;
    var raw = localStorage.getItem(PAYROLL_STORAGE_KEY);
    var state = raw ? JSON.parse(raw) : {};
    return normalizePayrollState(state);
  }

  function getParticipationState() {
    if (configured) return _participationState;
    return safeParse(localStorage.getItem(PARTICIPATION_STORAGE_KEY), null);
  }

  function getCalendarEvents() {
    if (configured) return _calendarEvents;
    return safeParse(localStorage.getItem(CALENDAR_STORAGE_KEY), []);
  }

  function getProjectsData() {
    if (configured) return _projectsData;
    return safeParse(localStorage.getItem(PROJECTS_STORAGE_KEY), []);
  }

  function getPersonsData() {
    if (configured) return _personsData;
    return safeParse(localStorage.getItem(PERSONS_STORAGE_KEY), []);
  }

  function getLabRegistrationsData() {
    if (configured) return _labRegsData;
    return safeParse(localStorage.getItem(LAB_REGS_STORAGE_KEY), []);
  }

  function normalizePayrollState(state) {
    if (!state) state = {};
    var snapshots = state.snapshots || {};
    var draft = state.draft || {};
    var contractSalaries = state.contractSalaries || {};
    var contractSalaryByMonth = state.contractSalaryByMonth || {};
    Object.keys(state).forEach(function (key) {
      if (key === 'snapshots' || key === 'draft' || key === 'contractSalaries' || key === 'contractSalaryByMonth') return;
      if (/^\d{4}-\d{2}$/.test(key) && state[key] && typeof state[key] === 'object') draft[key] = state[key];
    });
    return { snapshots: snapshots, draft: draft, contractSalaries: contractSalaries, contractSalaryByMonth: contractSalaryByMonth };
  }

  function subscribeHr(callback) {
    if (typeof callback !== 'function') return;
    _hrCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.hr).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var data = snap.exists && snap.data() && snap.data().items ? snap.data().items : [];
          _hrData = Array.isArray(data) ? data : [];
          _hrCallbacks.forEach(function (cb) {
            try { cb(_hrData); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore HR snapshot:', err); }
      );
    } else {
      try { callback(getHrData()); } catch (e) { console.error(e); }
    }
  }

  function saveHr(data) {
    var items = Array.isArray(data) ? data : [];
    if (configured) {
      db.collection(COLL.hr).doc(DOC_ID).set({ items: items }).catch(function (e) {
        console.error('Firestore HR 저장 실패:', e);
      });
    } else {
      try { localStorage.setItem(HR_STORAGE_KEY, JSON.stringify(items)); } catch (e) { console.error(e); }
    }
  }

  function subscribePayroll(callback) {
    if (typeof callback !== 'function') return;
    _payrollCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.payroll).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var raw = snap.exists && snap.data() ? snap.data() : {};
          _payrollState = normalizePayrollState(raw);
          _payrollCallbacks.forEach(function (cb) {
            try { cb(_payrollState); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore Payroll snapshot:', err); }
      );
    } else {
      try { callback(getPayrollState()); } catch (e) { console.error(e); }
    }
  }

  function savePayrollState(state) {
    var normalized = normalizePayrollState(state || {});
    if (configured) {
      db.collection(COLL.payroll).doc(DOC_ID).set(normalized).catch(function (e) {
        console.error('Firestore Payroll 저장 실패:', e);
      });
    } else {
      try { localStorage.setItem(PAYROLL_STORAGE_KEY, JSON.stringify(normalized)); } catch (e) { console.error(e); }
    }
  }

  function subscribeParticipation(callback) {
    if (typeof callback !== 'function') return;
    _participationCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.participation).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          _participationState = snap.exists && snap.data() ? snap.data() : null;
          _participationCallbacks.forEach(function (cb) {
            try { cb(_participationState); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore Participation snapshot:', err); }
      );
    } else {
      try { callback(getParticipationState()); } catch (e) { console.error(e); }
    }
  }

  function saveParticipationState(state) {
    if (configured) {
      db.collection(COLL.participation).doc(DOC_ID).set(state || {}).catch(function (e) {
        console.error('Firestore Participation 저장 실패:', e);
      });
    } else {
      try { localStorage.setItem(PARTICIPATION_STORAGE_KEY, JSON.stringify(state || {})); } catch (e) { console.error(e); }
    }
  }

  function subscribeCalendar(callback) {
    if (typeof callback !== 'function') return;
    _calendarCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.calendar).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var data = snap.exists && snap.data() && snap.data().events ? snap.data().events : [];
          _calendarEvents = Array.isArray(data) ? data : [];
          _calendarCallbacks.forEach(function (cb) {
            try { cb(_calendarEvents); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore Calendar snapshot:', err); }
      );
    } else {
      try { callback(getCalendarEvents()); } catch (e) { console.error(e); }
    }
  }

  function saveCalendarEvents(events) {
    var list = Array.isArray(events) ? events : [];
    if (configured) {
      db.collection(COLL.calendar).doc(DOC_ID).set({ events: list }).catch(function (e) {
        console.error('Firestore Calendar 저장 실패:', e);
      });
    } else {
      try { localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(list)); } catch (e) { console.error(e); }
    }
  }

  // ====================================================================
  // 인력 마스터 (persons 컬렉션) — 2026-05-25 추가
  // 다른 컬렉션과 동일한 패턴: { items: [...] } 형태로 단일 문서에 저장
  //
  // persons 항목 구조:
  //   { id, name, hireDate, exitDate, isYouth, monthlySalary,
  //     memo, status, createdAt, updatedAt }
  //
  // - 신규/기존 판정은 저장 안 함 (프로젝트의 newHireCriteria + hireDate로 화면에서 자동 계산)
  // - 월급(monthlySalary)은 선택 입력
  // - 청년 필수 인력(isYouth)은 수동 체크박스
  // ====================================================================

  function subscribePersons(callback) {
    if (typeof callback !== 'function') return;
    _personsCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.persons).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var data = snap.exists && snap.data() && snap.data().items ? snap.data().items : [];
          _personsData = Array.isArray(data) ? data : [];
          _personsCallbacks.forEach(function (cb) {
            try { cb(_personsData); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore Persons snapshot:', err); }
      );
    } else {
      try { callback(getPersonsData()); } catch (e) { console.error(e); }
    }
  }

  /**
   * 인력 마스터 (persons) 전체 저장 — 다른 컬렉션과 동일한 패턴
   * 전체 배열을 단일 문서에 덮어쓰기
   */
  function savePersons(data) {
    var items = Array.isArray(data) ? data : [];
    if (configured) {
      return db.collection(COLL.persons).doc(DOC_ID).set({ items: items })
        .catch(function (e) {
          console.error('Firestore Persons 저장 실패:', e);
          throw e;
        });
    } else {
      try {
        localStorage.setItem(PERSONS_STORAGE_KEY, JSON.stringify(items));
        return Promise.resolve();
      } catch (e) {
        console.error(e);
        return Promise.reject(e);
      }
    }
  }

  // --------------------------------------------------------------------
  // 기업부설연구소 인력 등록 (labRegistrations)
  //
  // 데이터 구조: 단일 문서에 items 배열 (다른 컬렉션과 동일 패턴)
  // 각 등록 레코드:
  //   {
  //     id: "식스티_2025-04",
  //     company: "식스티",
  //     yearMonth: "2025-04",
  //     uploadedAt: "2025-04-15T...",
  //     uploadedBy: "정지혜",
  //     members: [
  //       { personId, name, ssn6, assignedDate },
  //       ...
  //     ]
  //   }
  // 같은 회사+같은 월이면 id가 같아서 자동으로 교체됨 (upsert)
  // --------------------------------------------------------------------

  function subscribeLabRegistrations(callback) {
    if (typeof callback !== 'function') return;
    _labRegsCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.labRegs).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var data = snap.exists && snap.data() && snap.data().items ? snap.data().items : [];
          _labRegsData = Array.isArray(data) ? data : [];
          _labRegsCallbacks.forEach(function (cb) {
            try { cb(_labRegsData); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore labRegistrations snapshot:', err); }
      );
    } else {
      try { callback(getLabRegistrationsData()); } catch (e) { console.error(e); }
    }
  }

  /**
   * 전체 labRegistrations 배열 저장 (덮어쓰기)
   */
  function saveLabRegistrations(data) {
    var items = Array.isArray(data) ? data : [];
    if (configured) {
      return db.collection(COLL.labRegs).doc(DOC_ID).set({ items: items })
        .catch(function (e) {
          console.error('Firestore labRegistrations 저장 실패:', e);
          throw e;
        });
    } else {
      try {
        localStorage.setItem(LAB_REGS_STORAGE_KEY, JSON.stringify(items));
        return Promise.resolve();
      } catch (e) {
        console.error(e);
        return Promise.reject(e);
      }
    }
  }

  function getCurrentLabRegistrations() {
    return configured
      ? (_labRegsData.length > 0 ? _labRegsData : getLabRegistrationsData())
      : getLabRegistrationsData();
  }

  /**
   * 특정 회사 + 월의 등록 정보 업서트 (있으면 교체, 없으면 추가)
   * registration: { company, yearMonth, members, uploadedBy }
   */
  function upsertLabRegistration(registration) {
    if (!registration || !registration.company || !registration.yearMonth) {
      return Promise.reject(new Error('company, yearMonth 가 필요해요'));
    }
    var current = getCurrentLabRegistrations().slice();
    var id = registration.company + '_' + registration.yearMonth;
    var nowISO = new Date().toISOString();

    var newRecord = {
      id: id,
      company: registration.company,
      yearMonth: registration.yearMonth,
      members: Array.isArray(registration.members) ? registration.members : [],
      approvalDate: registration.approvalDate || '',
      uploadedAt: nowISO,
      uploadedBy: registration.uploadedBy || ''
    };

    // 기존 같은 ID 레코드 제거 후 추가 (upsert)
    var filtered = current.filter(function (r) { return r && r.id !== id; });
    filtered.push(newRecord);

    return saveLabRegistrations(filtered);
  }

  /**
   * 특정 회사 + 월의 등록 정보 조회
   */
  function getLabRegistration(company, yearMonth) {
    var list = getCurrentLabRegistrations();
    var id = company + '_' + yearMonth;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  /**
   * 특정 회사의 모든 월별 등록 정보 (월 정렬)
   */
  function getLabRegistrationsByCompany(company) {
    var list = getCurrentLabRegistrations();
    return list.filter(function (r) {
      return r && r.company === company;
    }).sort(function (a, b) {
      // 월 오름차순
      if (a.yearMonth < b.yearMonth) return -1;
      if (a.yearMonth > b.yearMonth) return 1;
      return 0;
    });
  }

  /**
   * 특정 인력이 가장 최근에 어느 회사의 어느 월에 등록되어 있었는지 찾기
   * @param {string} personId 인력 마스터 ID
   * @returns {{company, yearMonth, assignedDate} | null}
   */
  function findLatestLabRegistrationForPerson(personId) {
    if (!personId) return null;
    var list = getCurrentLabRegistrations();
    // 최신 월부터 역순으로 훑기
    var sorted = list.slice().sort(function (a, b) {
      if (a.yearMonth > b.yearMonth) return -1;
      if (a.yearMonth < b.yearMonth) return 1;
      return 0;
    });
    for (var i = 0; i < sorted.length; i++) {
      var rec = sorted[i];
      if (!rec || !Array.isArray(rec.members)) continue;
      for (var j = 0; j < rec.members.length; j++) {
        if (rec.members[j] && rec.members[j].personId === personId) {
          return {
            company: rec.company,
            yearMonth: rec.yearMonth,
            assignedDate: rec.members[j].assignedDate || null
          };
        }
      }
    }
    return null;
  }

  // --------------------------------------------------------------------
  // persons 편의 함수 (add / update / delete)
  // 내부적으로는 전체 배열을 다시 savePersons 하는 패턴.
  // 항상 현재 메모리(_personsData) 또는 LocalStorage의 최신 값을 기준으로 동작.
  // --------------------------------------------------------------------

  function makePersonId() {
    // p_xxxxxxxx 형태의 짧은 ID (시간 + 랜덤)
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 6);
    return 'p_' + t + r;
  }

  function getCurrentPersons() {
    // 메모리/LocalStorage 중 현재 활성 데이터를 반환 (저장 전 최신 상태 보장용)
    return configured
      ? (Array.isArray(_personsData) ? _personsData.slice() : [])
      : (safeParse(localStorage.getItem(PERSONS_STORAGE_KEY), []) || []);
  }

  /**
   * 인력 추가
   * @param {Object} person - id, createdAt, updatedAt은 자동 채워짐
   * @returns {Promise<Object>} 추가된 person (id 포함)
   */
  function addPerson(person) {
    var p = Object.assign({}, person || {});
    if (!p.id) p.id = makePersonId();
    var now = new Date().toISOString();
    if (!p.createdAt) p.createdAt = now;
    p.updatedAt = now;
    if (!p.status) p.status = 'active';

    var list = getCurrentPersons();
    list.push(p);
    return savePersons(list).then(function () { return p; });
  }

  /**
   * 인력 수정
   * @param {string} id - 인력 ID
   * @param {Object} updates - 변경할 필드만 (id, createdAt은 무시됨)
   * @returns {Promise<Object|null>} 수정된 person, 없으면 null
   */
  function updatePerson(id, updates) {
    if (!id) return Promise.reject(new Error('id is required'));
    var list = getCurrentPersons();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return Promise.resolve(null);

    var merged = Object.assign({}, list[idx], updates || {});
    // id와 createdAt은 보호
    merged.id = list[idx].id;
    merged.createdAt = list[idx].createdAt || merged.createdAt;
    merged.updatedAt = new Date().toISOString();

    list[idx] = merged;
    return savePersons(list).then(function () { return merged; });
  }

  /**
   * 인력 삭제 (배열에서 제거)
   * 주의: 인건비 데이터에서 참조 중인 인력은 삭제 대신 status='exited'로 두는 것을 권장.
   * @param {string} id - 인력 ID
   * @returns {Promise<boolean>} 삭제 성공 여부
   */
  function deletePerson(id) {
    if (!id) return Promise.reject(new Error('id is required'));
    var list = getCurrentPersons();
    var next = list.filter(function (p) { return p && p.id !== id; });
    if (next.length === list.length) return Promise.resolve(false);  // 없었음
    return savePersons(next).then(function () { return true; });
  }

  /**
   * 과제 (projects) 컬렉션 실시간 구독
   * 다른 컬렉션과 동일한 패턴: { items: [...] } 형태로 단일 문서에 저장
   */
  function subscribeProjects(callback) {
    if (typeof callback !== 'function') return;
    _projectsCallbacks.push(callback);
    if (configured) {
      var ref = db.collection(COLL.projects).doc(DOC_ID);
      ref.onSnapshot(
        function (snap) {
          var data = snap.exists && snap.data() && snap.data().items ? snap.data().items : [];
          _projectsData = Array.isArray(data) ? data : [];
          _projectsCallbacks.forEach(function (cb) {
            try { cb(_projectsData); } catch (e) { console.error(e); }
          });
        },
        function (err) { console.error('Firestore Projects snapshot:', err); }
      );
    } else {
      try { callback(getProjectsData()); } catch (e) { console.error(e); }
    }
  }

  // ====================================================================
  // 자동 백업 시스템 (projects 컬렉션 전용)
  // ====================================================================
  // - saveProjects 호출 시 저장 직전 현재 _projectsData를 backups/{ts} 에 보관
  // - 빈 데이터(0건)일 때는 백업 안 함 (의미 없음 + 빈 데이터로 덮어씌우는 실수 방지)
  // - 백업 30개 초과 시 가장 오래된 것 자동 삭제
  // - 실패해도 메인 저장은 진행 (백업 실패가 저장 자체를 막지는 않음)
  // ====================================================================

  function makeBackupTimestampId() {
    var d = new Date();
    function p(n, l) { return String(n).padStart(l || 2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()) +
           '-' + p(d.getMilliseconds(), 3);
  }

  function getCurrentUserEmail() {
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.email || 'unknown';
      }
    } catch (e) {}
    return 'unknown';
  }

  function createProjectsBackup(reason) {
    if (!configured) return Promise.resolve(null);
    var current = Array.isArray(_projectsData) ? _projectsData : [];
    if (current.length === 0) return Promise.resolve(null);  // 빈 데이터면 백업 안 함

    var ts = makeBackupTimestampId();
    return db.collection('backups').doc(ts).set({
      timestamp: new Date().toISOString(),
      reason: reason || 'auto',
      itemCount: current.length,
      items: current,
      createdBy: getCurrentUserEmail()
    }).then(function () { return ts; })
      .catch(function (e) {
        console.error('자동 백업 실패 (메인 저장은 진행):', e);
        return null;
      });
  }

  function cleanupOldBackups() {
    if (!configured) return Promise.resolve();
    return db.collection('backups')
      .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
      .get()
      .then(function (snap) {
        if (snap.size <= 30) return;
        var docs = [];
        snap.forEach(function (d) { docs.push(d); });
        var toDelete = docs.slice(30);  // 31번째부터 (오래된 것들) 삭제
        toDelete.forEach(function (d) {
          d.ref.delete().catch(function () { /* 무시 */ });
        });
      })
      .catch(function (e) { console.error('백업 정리 실패:', e); });
  }

  /**
   * 과제 (projects) 저장 — 자동 백업 포함
   * 전체 배열을 단일 문서에 덮어쓰기 (다른 컬렉션과 동일한 패턴)
   */
  function saveProjects(data, options) {
    var items = Array.isArray(data) ? data : [];
    options = options || {};

    if (configured) {
      // 1) 저장 직전 자동 백업 (현재 데이터 보관)
      var reason = options.reason || (
        items.length < _projectsData.length ? 'auto: count decreased (' + _projectsData.length + ' → ' + items.length + ')' :
        items.length > _projectsData.length ? 'auto: count increased (' + _projectsData.length + ' → ' + items.length + ')' :
        'auto: update (count same)'
      );

      return createProjectsBackup(reason)
        .then(function () {
          // 2) 메인 저장
          return db.collection(COLL.projects).doc(DOC_ID).set({ items: items });
        })
        .then(function () {
          // 3) 가끔(20% 확률) 오래된 백업 정리 — 매번 하면 비용
          if (Math.random() < 0.2) cleanupOldBackups();
        })
        .catch(function (e) {
          console.error('Firestore Projects 저장 실패:', e);
          throw e;
        });
    } else {
      try {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(items));
        return Promise.resolve();
      } catch (e) {
        console.error(e);
        return Promise.reject(e);
      }
    }
  }

  /**
   * total_project_data.json 형식의 객체를 Firestore 각 컬렉션으로 업로드합니다.
   * payload: { personnelData?, salaryData?, participationData?, calendarEvents? } (키 이름 변형 지원)
   * @returns {Promise<{ hr: boolean, payroll: boolean, participation: boolean, calendar: boolean }>}
   */
  function uploadFromProjectJson(payload) {
    if (!configured) {
      return Promise.reject(new Error('Firebase가 설정되지 않았습니다.'));
    }
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('올바른 JSON 형식이 아닙니다.'));
    }
    var personnel = payload.personnelData || payload.hrData || payload.hr || [];
    var salary = payload.salaryData || payload.payrollData || payload.payroll || {};
    var participation = payload.participationData || payload.participation || null;
    var calendar = payload.calendarEvents || payload.calendarData || payload.calendar || [];

    var pHr = Array.isArray(personnel)
      ? db.collection(COLL.hr).doc(DOC_ID).set({ items: personnel })
      : Promise.resolve();
    var pPayroll = salary && typeof salary === 'object' && (Object.keys(salary).length > 0 || salary.snapshots || salary.draft)
      ? db.collection(COLL.payroll).doc(DOC_ID).set(normalizePayrollState(salary))
      : Promise.resolve();
    var pParticipation = participation && typeof participation === 'object' && (participation.projects || participation.selectedYear != null)
      ? db.collection(COLL.participation).doc(DOC_ID).set(participation)
      : Promise.resolve();
    var pCalendar = Array.isArray(calendar)
      ? db.collection(COLL.calendar).doc(DOC_ID).set({ events: calendar })
      : Promise.resolve();

    return Promise.all([pHr, pPayroll, pParticipation, pCalendar]).then(function () {
      return { hr: true, payroll: true, participation: true, calendar: true };
    });
  }

  /**
   * LocalStorage 데이터를 Firestore로 한 번 업로드합니다.
   * Firebase가 설정된 상태에서 한 번만 실행하면 됩니다.
   * @returns {Promise<{ hr: boolean, payroll: boolean, participation: boolean, calendar: boolean }>}
   */
  function migrateFromLocalStorage() {
    if (!configured) {
      return Promise.reject(new Error('Firebase가 설정되지 않았습니다.'));
    }
    var hr = safeParse(localStorage.getItem(HR_STORAGE_KEY), []);
    var payroll = safeParse(localStorage.getItem(PAYROLL_STORAGE_KEY), {});
    var participation = safeParse(localStorage.getItem(PARTICIPATION_STORAGE_KEY), null);
    var calendar = safeParse(localStorage.getItem(CALENDAR_STORAGE_KEY), []);
    var projects = safeParse(localStorage.getItem(PROJECTS_STORAGE_KEY), []);

    var pHr = Array.isArray(hr) && hr.length > 0
      ? db.collection(COLL.hr).doc(DOC_ID).set({ items: hr })
      : Promise.resolve();
    var pPayroll = Object.keys(payroll).length > 0
      ? db.collection(COLL.payroll).doc(DOC_ID).set(normalizePayrollState(payroll))
      : Promise.resolve();
    var pParticipation = participation && (participation.projects || participation.selectedYear != null)
      ? db.collection(COLL.participation).doc(DOC_ID).set(participation)
      : Promise.resolve();
    var pCalendar = Array.isArray(calendar)
      ? db.collection(COLL.calendar).doc(DOC_ID).set({ events: calendar })
      : Promise.resolve();
    var pProjects = Array.isArray(projects) && projects.length > 0
      ? db.collection(COLL.projects).doc(DOC_ID).set({ items: projects })
      : Promise.resolve();

    return Promise.all([pHr, pPayroll, pParticipation, pCalendar, pProjects]).then(function () {
      return { hr: true, payroll: true, participation: true, calendar: true, projects: true };
    });
  }

  function isConfigured() {
    return !!configured;
  }

  // ====================================================================
  // §4.4 — 마스터 연봉 변경 시점(연중 인상) 해석 — 공용 유틸 (window.SalaryUtil)
  //   person.salaryChanges = [{ from:'YYYY-MM', annualSalary:원 }, ...]
  //     · 그 달(from)부터 새 연봉, 그 전까지는 기본 annualSalary (계단식)
  //     · 비어 있으면 1년 내내 기본 annualSalary = 기존 동작과 100% 동일(안전)
  //   ※ 단일 진실 소스. persons-master·project-labor·project-budget가 모두 참조.
  //      (firestore-service는 전 페이지가 먼저 로드하므로 window.SalaryUtil 보장.)
  // ====================================================================

  // 'YYYY-MM' / 'YYYY.M' / 'YYYY/M' → 'YYYY-MM' (월 01~12), 그 외 null
  function salaryNormalizeYm(s) {
    var m = String(s == null ? '' : s).trim().match(/^(\d{4})\s*[-.\/]?\s*(\d{1,2})$/);
    if (!m) return null;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    return m[1] + '-' + (mo < 10 ? '0' + mo : '' + mo);
  }

  // 변경 시점 배열 정규화: from=YYYY-MM·연봉>0만, 같은 달 중복은 마지막 값, from 오름차순
  //   (annualSalary는 숫자 또는 콤마 문자열 '72,000,000' 모두 허용)
  function salarySanitizeChanges(arr) {
    if (!Array.isArray(arr)) return [];
    var map = {};
    arr.forEach(function (c) {
      if (!c) return;
      var ym = salaryNormalizeYm(c.from);
      var digits = String(c.annualSalary == null ? '' : c.annualSalary).replace(/[^\d]/g, '');
      var sal = digits === '' ? null : Math.round(Number(digits));
      if (ym && sal != null && sal > 0) map[ym] = sal;
    });
    return Object.keys(map).sort().map(function (ym) {
      return { from: ym, annualSalary: map[ym] };
    });
  }

  // 특정 월(ym='YYYY-MM')의 연봉 = from<=ym 인 가장 최근 변경값, 없으면 기본 annualSalary
  function salaryAnnualAt(person, ym) {
    if (!person) return 0;
    var base = (person.annualSalary != null && !isNaN(person.annualSalary)) ? Number(person.annualSalary) : 0;
    var changes = salarySanitizeChanges(person.salaryChanges);
    if (!changes.length || !ym) return base;
    var picked = base;
    changes.forEach(function (c) { if (c.from <= ym) picked = c.annualSalary; });
    return picked;
  }
  function salaryMonthlyAt(person, ym) {
    var a = salaryAnnualAt(person, ym);
    return a ? Math.ceil(a / 12) : 0;
  }

  window.SalaryUtil = {
    normalizeYm: salaryNormalizeYm,
    sanitizeSalaryChanges: salarySanitizeChanges,
    getAnnualSalaryAt: salaryAnnualAt,
    getMonthlySalaryAt: salaryMonthlyAt
  };

  // ====================================================================
  // 연도 필터 드롭다운 공용 (window.YearFilterUtil)
  //   과제 데이터(시작/종료/제출일 + 연차 yearBudgets)에서 연도를 모아 드롭다운을
  //   동적 구성. HTML 하드코딩 대신 이걸 호출하면 이후 연도가 자동으로 보임.
  //   ※ 단일 진실 소스. projects·projects-history·dashboard·funding·labor-dashboard 공유.
  // ====================================================================
  function yearCollectFromProjects(items) {
    var ys = {};
    function add(s) {
      var y = String(s == null ? '' : s).slice(0, 4);
      if (/^\d{4}$/.test(y)) ys[y] = true;
    }
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      add(it.startDate || it.start || it['시작일']);
      add(it.endDate || it.end || it['종료일']);
      add(it.submitDate || it['제출일']);
      var arr = it.yearBudgets || it.annualData || it.budgets || [];
      if (Array.isArray(arr)) arr.forEach(function (yb) {
        if (!yb) return;
        add(yb.startDate || yb.start);
        add(yb.endDate || yb.end);
        if (yb.year != null) add(String(yb.year));
      });
    });
    return Object.keys(ys).map(Number).filter(function (n) { return n >= 2000 && n <= 2100; })
      .sort(function (a, b) { return b - a; });
  }

  // selectEl 옵션을 (데이터 연도 ∪ 올해)의 min~max 연속 내림차순으로 재구성.
  //   opts:
  //     includeAll   (bool)        "전체" 옵션을 맨 위에
  //     allLabel     (string)      "전체" 라벨 (기본 '전체')
  //     storageKey   (string|null) sessionStorage 키 — 있으면 저장값 읽어 선택(쓰진 않음)
  //     preferredValue (string|null) 최우선 선택값 (예: URL ?year=)
  //     defaultValue (string|null) 폴백 선택값. '' = 전체, 'YYYY' = 그 연도, 미지정/ null = 올해
  //   선택 우선순위: preferredValue > sessionStorage > defaultValue > 올해 > (전체 or 최신연도)
  //   범위가 그대로면(같은 select) 재구성/포커스 방해 없이 그대로 둠.
  function yearPopulate(selectEl, items, opts) {
    if (!selectEl) return;
    opts = opts || {};
    var includeAll = !!opts.includeAll;
    var allLabel = opts.allLabel || '전체';
    var cur = (new Date()).getFullYear();

    var years = yearCollectFromProjects(items);
    years.push(cur); // 올해는 항상 포함(기본값 보장)
    if (opts.defaultValue != null && /^\d{4}$/.test(String(opts.defaultValue))) years.push(Number(opts.defaultValue));
    var maxY = Math.max.apply(null, years);
    var minY = Math.min.apply(null, years);

    var sig = (includeAll ? 'A:' + allLabel + ':' : '') + minY + '_' + maxY;
    if (selectEl.getAttribute('data-yrange') === sig) return; // 변화 없음 — 그대로
    selectEl.setAttribute('data-yrange', sig);

    var html = includeAll ? '<option value="">' + allLabel + '</option>' : '';
    for (var y = maxY; y >= minY; y--) html += '<option value="' + y + '">' + y + '년</option>';
    selectEl.innerHTML = html;

    function hasOpt(v) {
      if (v == null) return false;
      v = String(v);
      for (var i = 0; i < selectEl.options.length; i++) if (selectEl.options[i].value === v) return true;
      return false;
    }
    var want = (opts.preferredValue != null) ? String(opts.preferredValue) : null;
    if (want == null && opts.storageKey) {
      try { var s = sessionStorage.getItem(opts.storageKey); if (s !== null) want = s; } catch (e) {}
    }
    if (want == null) want = (opts.defaultValue != null) ? String(opts.defaultValue) : String(cur);

    if (hasOpt(want)) selectEl.value = want;
    else if (hasOpt(String(cur))) selectEl.value = String(cur);
    else selectEl.value = includeAll ? '' : String(maxY);
  }

  window.YearFilterUtil = {
    collectYears: yearCollectFromProjects,
    populate: yearPopulate
  };

  window.firestoreService = {
    isConfigured: isConfigured,
    getHrData: getHrData,
    subscribeHr: subscribeHr,
    saveHr: saveHr,
    getPayrollState: getPayrollState,
    subscribePayroll: subscribePayroll,
    savePayrollState: savePayrollState,
    getParticipationState: getParticipationState,
    subscribeParticipation: subscribeParticipation,
    saveParticipationState: saveParticipationState,
    getCalendarEvents: getCalendarEvents,
    subscribeCalendar: subscribeCalendar,
    saveCalendarEvents: saveCalendarEvents,
    getProjectsData: getProjectsData,
    subscribeProjects: subscribeProjects,
    saveProjects: saveProjects,
    // persons (인력 마스터)
    getPersonsData: getPersonsData,
    subscribePersons: subscribePersons,
    savePersons: savePersons,
    addPerson: addPerson,
    updatePerson: updatePerson,
    deletePerson: deletePerson,
    // labRegistrations (기업부설연구소 인력 등록)
    getLabRegistrationsData: getLabRegistrationsData,
    subscribeLabRegistrations: subscribeLabRegistrations,
    saveLabRegistrations: saveLabRegistrations,
    upsertLabRegistration: upsertLabRegistration,
    getLabRegistration: getLabRegistration,
    getLabRegistrationsByCompany: getLabRegistrationsByCompany,
    findLatestLabRegistrationForPerson: findLatestLabRegistrationForPerson,
    migrateFromLocalStorage: migrateFromLocalStorage,
    uploadFromProjectJson: uploadFromProjectJson,
    // 백업 관리 (필요 시 외부에서 호출)
    createProjectsBackup: createProjectsBackup,
    cleanupOldBackups: cleanupOldBackups
  };
})();
/**
 * persons-detail.js
 * 인력 상세 정보 페이지 (HR 정보 관리)
 *
 * 좌측: 인력 테이블 (간략 정보)
 * 우측: 선택된 인력의 모든 HR 정보 상세
 *
 * 데이터: persons 컬렉션 (인력 마스터와 같은 컬렉션, HR 필드만 추가 사용)
 * - 추가 사용 필드: department, position, finalDegree, school, major,
 *   degreeNumber, degreeDate, researcherId, isLabRegistered, labRegisterDate,
 *   phone, email, address, hrMemo
 * - 기본 정보(name, birthDate, company 등)는 인력 마스터에서 관리
 */

(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];
  var _selectedPersonId = null;  // 우측 패널에 표시 중인 인력
  var _editingPerson = null;     // 모달에서 수정 중인 인력
  var _editingCertificates = []; // 모달에서 편집 중인 자격증 배열 (Step 4-2)
  var _saving = false;

  var _filter = {
    keyword: '',                  // 이름/소속/연구자번호 검색
    status: 'active',             // 'all' | 'active' | 'exited'
    company: 'all',               // 'all' | '식스티' | '굿뉴스' | '패리티'
    degree: 'all',                // 'all' | '박사' | '석사' | '학사' | '기타' | 'unset'
    labOnly: false                // true면 연구소 등록자만
  };

  // 부서(소속) 옵션 목록 — 인력 데이터에서 자동 수집 + 사용자 추가
  // 저장은 _persons[i].department에 직접 들어감 (별도 컬렉션 안 만들고 동적 수집)
  var _departmentOptions = [];

  // 직급 옵션 목록 — 기본 직급 + 인력 데이터에서 수집한 사용자 추가분
  var DEFAULT_POSITIONS = ['대표이사', '전무', '상무', '이사', '본부장', '팀장', '매니저'];
  var _positionOptions = [];  // 인력 데이터에서 수집한 추가 직급 (기본과 중복 제외)

  var el = {
    sidebar: null,
    main: null,
    // 검색
    search: null,
    searchClear: null,
    searchWrap: null,
    // 필터
    filterStatus: null,
    filterDegree: null,
    filterLab: null,
    // 카드
    statTotal: null,
    statTotalSub: null,
    statHrComplete: null,
    statHrCompleteSub: null,
    statLab: null,
    // 일괄 다운로드/업로드
    bulkDownloadBtn: null,
    bulkEditBtn: null,
    bulkEditInput: null,
    // 테이블
    tbody: null,
    tableWrap: null,
    empty: null,
    countHint: null,
    // 우측 상세 패널
    detailPanel: null,
    detailEmptyState: null,
    detailContent: null,
    // 모달
    modal: null,
    modalTitle: null,
    modalClose: null,
    modalCancel: null,
    modalSave: null,
    formError: null,
    // 폼 필드 (HR)
    formDepartment: null,
    formDepartmentAddBtn: null,
    formDepartmentManageBtn: null,
    formPosition: null,
    formPositionAddBtn: null,
    formPositionManageBtn: null,
    formFinalDegree: null,
    formSchool: null,
    formMajor: null,
    formDegreeNumber: null,
    formDegreeY: null,
    formDegreeM: null,
    formDegreeD: null,
    formResearcherId: null,
    formIsLabRegistered: null,
    formLabDateRow: null,
    formLabY: null,
    formLabM: null,
    formLabD: null,
    formLabStatus: null,  // 자동 표시 박스 (Step 4-1)
    formPhone: null,
    formEmail: null,
    formAddress: null,
    formHrMemo: null,
    // 자격증 (Step 4-2)
    formCertificatesList: null,
    formCertificateAddBtn: null,
    // 소속 관리 모달
    deptManageModal: null,
    deptManageClose: null,
    deptManageList: null,
    deptManageEmpty: null,
    // 인력 일괄 이동 모달
    deptMoveModal: null,
    deptMoveClose: null,
    deptMoveCancel: null,
    deptMoveApply: null,
    deptMoveSourceName: null,
    deptMoveTarget: null,
    deptMoveTargetNewBtn: null,
    deptMoveList: null,
    deptMoveSelectAll: null,
    deptMoveSelectedCount: null,
    deptMoveTotalCount: null
  };

  // ====================================================================
  // 헬퍼: 공통 유틸
  // ====================================================================
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(s) {
    if (!s) return '-';
    return String(s).slice(0, 10);
  }

  /**
   * 학위 표시 라벨 (저장값 → 화면 표시값)
   * 데이터는 그대로 두고 화면 표시만 괄호 형태로.
   */
  function formatDegree(raw) {
    if (!raw) return '';
    var map = {
      '박사수료': '박사(수료)',
      '석사수료': '석사(수료)',
      '학사재학': '학사(재학)'
    };
    return map[raw] || raw;
  }

  /**
   * 학위 필터 그룹 — 박사 선택 시 박사+박사수료, 석사 선택 시 석사+석사수료, 학사 선택 시 학사+학사재학
   * 그 외 옵션('전문학사', '기타', 'unset')은 정확히 일치.
   */
  function degreeMatchesFilter(personDegree, filterValue) {
    if (filterValue === 'all') return true;
    if (filterValue === 'unset') return !personDegree;
    if (!personDegree) return false;
    var groups = {
      '박사': ['박사', '박사수료'],
      '석사': ['석사', '석사수료'],
      '학사': ['학사', '학사재학']
    };
    var allowed = groups[filterValue] || [filterValue];
    return allowed.indexOf(personDegree) >= 0;
  }

  /**
   * 학위 정렬 우선순위 (작을수록 위)
   * 본 학위가 위, 수료/재학이 아래로 가도록.
   *   박사 → 박사수료 → 석사 → 석사수료 → 학사 → 학사재학 → 전문학사 → 기타 → (미입력)
   */
  function degreeSortKey(raw) {
    var order = {
      '박사': 1, '박사수료': 2,
      '석사': 3, '석사수료': 4,
      '학사': 5, '학사재학': 6,
      '전문학사': 7,
      '기타': 8
    };
    if (!raw) return 99;
    return order[raw] != null ? order[raw] : 50;
  }

  /**
   * 엑셀 업로드 시 학위 입력값 정규화
   * 사용자가 '박사(수료)', '박사수료', '박사 수료' 등 다양하게 입력할 수 있음.
   * 모두 저장값 '박사수료'로 통일.
   */
  function normalizeDegreeInput(raw) {
    if (!raw) return '';
    var s = String(raw).trim();
    if (!s) return '';
    // 괄호 형태: '박사(수료)' → '박사수료'
    var m = s.match(/^(박사|석사|학사)\s*\((수료|재학)\)$/);
    if (m) {
      var combo = m[1] + m[2];
      // '학사(수료)'·'박사(재학)' 같은 어색한 조합은 그대로 두지 않고 무효화
      if (combo === '박사수료' || combo === '석사수료' || combo === '학사재학') return combo;
    }
    // 공백 있는 형태: '박사 수료' → '박사수료'
    var sNoSpace = s.replace(/\s+/g, '');
    if (sNoSpace === '박사수료' || sNoSpace === '석사수료' || sNoSpace === '학사재학') return sNoSpace;
    // 그 외 (박사/석사/학사/전문학사/기타 또는 미정의 값)
    return s;
  }

  /**
   * 학위 표기 일회성 정규화 (마이그레이션)
   * 옛 저장값('박사(수료)', '석사(수료)', '학사(재학)' 등)을
   * 통일된 형태('박사수료', '석사수료', '학사재학')로 일괄 변환.
   * 페이지 로드 시 1회만 실행 (localStorage 플래그).
   */
  var DEGREE_NORMALIZATION_FLAG = '_degreeNormalizationDone_v1';

  function migrateDegreeNormalization(persons) {
    if (!Array.isArray(persons) || persons.length === 0) return;
    try {
      if (localStorage.getItem(DEGREE_NORMALIZATION_FLAG) === '1') return;
    } catch (e) { /* localStorage 접근 실패 — 무시하고 진행 */ }

    var changed = [];
    var updated = persons.map(function (p) {
      if (!p || !p.finalDegree) return p;
      var normalized = normalizeDegreeInput(p.finalDegree);
      if (normalized !== p.finalDegree) {
        changed.push({ name: p.name, before: p.finalDegree, after: normalized });
        return Object.assign({}, p, { finalDegree: normalized, updatedAt: new Date().toISOString() });
      }
      return p;
    });

    if (changed.length === 0) {
      // 변환할 것 없음 — 플래그만 세팅하고 종료
      try { localStorage.setItem(DEGREE_NORMALIZATION_FLAG, '1'); } catch (e) {}
      return;
    }

    console.log('[학위 정규화] ' + changed.length + '건 변환 예정:');
    console.table(changed);

    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      console.warn('[학위 정규화] firestoreService.savePersons 가 없어서 저장 실패');
      return;
    }

    svc.savePersons(updated).then(function () {
      console.log('[학위 정규화] ' + changed.length + '건 저장 완료');
      try { localStorage.setItem(DEGREE_NORMALIZATION_FLAG, '1'); } catch (e) {}
    }).catch(function (err) {
      console.error('[학위 정규화] 저장 실패:', err);
      // 플래그 세팅 안 함 — 다음 로드 시 재시도
    });
  }

  /**
   * 만나이 계산 (한국 기준).
   * 오늘 날짜 기준으로 생일이 지났으면 (올해-생년), 안 지났으면 (올해-생년-1)
   * ※ persons-master.js의 computeAge와 동일한 로직 — 두 페이지에서 같은 결과 보장.
   *
   * @param {string} birthDateIso - 'YYYY-MM-DD' 형식
   * @returns {number | null} 만나이, 또는 null (생년월일 없음/잘못됨)
   */
  function computeAge(birthDateIso) {
    if (!birthDateIso) return null;
    var parts = String(birthDateIso).split('-');
    if (parts.length < 3) return null;
    var by = parseInt(parts[0], 10);
    var bm = parseInt(parts[1], 10);
    var bd = parseInt(parts[2], 10);
    if (isNaN(by) || isNaN(bm) || isNaN(bd)) return null;

    var today = new Date();
    var ty = today.getFullYear();
    var tm = today.getMonth() + 1;
    var td = today.getDate();

    var age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age--;

    if (age < 0 || age > 150) return null;
    return age;
  }

  function pad2(v) { return String(v || '').padStart(2, '0'); }

  function buildDateString(y, m, d) {
    var yy = (y || '').trim();
    var mm = (m || '').trim();
    var dd = (d || '').trim();
    if (!yy && !mm && !dd) return { iso: null, error: null };
    if (yy.length !== 4 || !mm || !dd) return { iso: null, error: 'invalid' };
    var year = parseInt(yy, 10);
    var month = parseInt(mm, 10);
    var day = parseInt(dd, 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return { iso: null, error: 'invalid' };
    if (year < 1900 || year > 2100) return { iso: null, error: 'invalid' };
    if (month < 1 || month > 12) return { iso: null, error: 'invalid' };
    if (day < 1 || day > 31) return { iso: null, error: 'invalid' };
    var dt = new Date(year + '-' + pad2(month) + '-' + pad2(day));
    if (isNaN(dt.getTime())) return { iso: null, error: 'invalid' };
    var actual = dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
    if (actual !== year + '-' + pad2(month) + '-' + pad2(day)) return { iso: null, error: 'invalid' };
    return { iso: actual, error: null };
  }

  function setDateParts(yEl, mEl, dEl, isoDate) {
    if (!yEl || !mEl || !dEl) return;
    if (!isoDate) { yEl.value = ''; mEl.value = ''; dEl.value = ''; return; }
    var parts = String(isoDate).split('-');
    yEl.value = parts[0] || '';
    mEl.value = parts[1] || '';
    dEl.value = parts[2] || '';
  }

  function attachNumericAutoMove(inputs) {
    inputs.forEach(function (inp, idx) {
      if (!inp) return;
      inp.addEventListener('input', function () {
        inp.value = inp.value.replace(/[^0-9]/g, '');
        if (inp.value.length >= parseInt(inp.maxLength, 10)) {
          var next = inputs[idx + 1];
          if (next) next.focus();
        }
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && inp.value === '') {
          var prev = inputs[idx - 1];
          if (prev) { prev.focus(); }
        }
      });
    });
  }

  // ====================================================================
  // 회사
  // ====================================================================
  var COMPANIES = ['식스티', '굿뉴스', '패리티'];
  var COMPANY_BADGE_CLASS = {
    '식스티': 'company-badge--sixty',
    '굿뉴스': 'company-badge--goodnews',
    '패리티': 'company-badge--parity'
  };

  function getCompany(person) {
    if (!person) return null;
    if (COMPANIES.indexOf(person.company) >= 0) return person.company;
    return null;
  }

  function renderCompanyBadge(company) {
    if (company && COMPANY_BADGE_CLASS[company]) {
      return '<span class="company-badge ' + COMPANY_BADGE_CLASS[company] + '">' + escapeHtml(company) + '</span>';
    }
    return '<span class="company-badge company-badge--unset">미지정</span>';
  }

  // ====================================================================
  // 겸직 (persons-master.js와 동일한 로직)
  // - 키: 이름 + 생년월일
  // - 식스티 줄에만 [겸직] 표시 (자회사가 본업)
  // - 메모에 '이동' 포함되어 있으면 행정 이관 → 겸직 표시 안 함
  // ====================================================================

  function getMoonlightKey(person) {
    if (!person) return null;
    var name = (person.name || '').trim();
    if (!name) return null;
    var birth = person.birthDate || '';
    if (!birth) return null;
    return name + '|' + birth;
  }

  function checkAdminTransfer(personsOfSameKey) {
    for (var i = 0; i < personsOfSameKey.length; i++) {
      var memo = (personsOfSameKey[i] && personsOfSameKey[i].memo) || '';
      if (memo.indexOf('이동') >= 0) return true;
    }
    return false;
  }

  function computeMoonlightMap(persons) {
    var map = {};
    for (var i = 0; i < persons.length; i++) {
      var p = persons[i];
      if (!p) continue;
      var key = getMoonlightKey(p);
      if (!key) continue;
      var company = getCompany(p);
      if (!company) continue;
      if (!map[key]) map[key] = { persons: [], companies: [], isAdminTransfer: false };
      map[key].persons.push(p);
      if (map[key].companies.indexOf(company) < 0) map[key].companies.push(company);
    }
    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (entry.persons.length < 2) return;
      entry.isAdminTransfer = checkAdminTransfer(entry.persons);
    });
    return map;
  }

  /**
   * master와 동일한 정책: 식스티 줄에서만 겸직 정보 반환.
   * 자회사 줄에는 isMoonlight=false (자회사가 본업).
   *
   * 테이블 렌더링에서 사용 — 표의 규칙대로:
   *   - 식스티 재직 + 자회사 재직/퇴사 → 재직 + [겸직] 뱃지
   *   - 식스티 퇴사 + 자회사 재직 → 상태 컬럼에 "겸직"(노란글자), 행 회색 X
   *   - 식스티 퇴사 + 자회사 퇴사 → 퇴직 + [겸직] 뱃지, 행 회색
   *   - 메모 '이동' → 일반 처리
   *   - 자회사끼리만 → 일반 (사실상 케이스 없음)
   */
  function getMoonlightInfo(person, moonlightMap) {
    var empty = { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };
    var key = getMoonlightKey(person);
    if (!key || !moonlightMap || !moonlightMap[key]) return empty;
    var entry = moonlightMap[key];
    var myCompany = getCompany(person);
    if (!entry.companies || entry.companies.length < 2) return empty;
    if (entry.isAdminTransfer) return empty;
    if (myCompany !== '식스티') return empty;

    var others = entry.companies.filter(function (c) { return c !== myCompany; });
    var selfActive = (person.status || 'active') !== 'exited';
    var subsidiaryActive = false;
    for (var i = 0; i < entry.persons.length; i++) {
      var rec = entry.persons[i];
      if (!rec) continue;
      if (getCompany(rec) === '식스티') continue;
      if ((rec.status || 'active') !== 'exited') {
        subsidiaryActive = true;
        break;
      }
    }
    return { isMoonlight: true, others: others, selfActive: selfActive, subsidiaryActive: subsidiaryActive };
  }

  /**
   * 인력 상세 패널 전용: 모든 회사 줄에서 "다른 회사 등록" 정보 반환.
   * 자회사 줄을 클릭해서 상세를 봤을 때도 "[겸직: 식스티]" 정보를 표시하기 위함.
   * (테이블 표시 규칙은 master 그대로 — getMoonlightInfo가 담당)
   *
   * 반환: { hasOthers: bool, others: string[] }
   * 행정 이관(메모 '이동')은 hasOthers=false
   */
  function getCrossCompanyInfo(person, moonlightMap) {
    var empty = { hasOthers: false, others: [] };
    var key = getMoonlightKey(person);
    if (!key || !moonlightMap || !moonlightMap[key]) return empty;
    var entry = moonlightMap[key];
    var myCompany = getCompany(person);
    if (!entry.companies || entry.companies.length < 2) return empty;
    if (entry.isAdminTransfer) return empty;
    var others = entry.companies.filter(function (c) { return c !== myCompany; });
    if (others.length === 0) return empty;
    return { hasOthers: true, others: others };
  }

  // 모듈 스코프: 매 render마다 한 번 계산해서 캐시
  var _moonlightMap = null;

  // ====================================================================
  // 부서(소속) 옵션 동적 수집 + 드롭다운 갱신
  // ====================================================================
  function collectDepartmentOptions() {
    var set = {};
    _persons.forEach(function (p) {
      if (p && p.department && typeof p.department === 'string') {
        var d = p.department.trim();
        if (d) set[d] = true;
      }
    });
    _departmentOptions = Object.keys(set).sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    });
  }

  function refreshDepartmentSelect() {
    if (!el.formDepartment) return;
    var current = el.formDepartment.value;
    // 옵션 다시 채움
    el.formDepartment.innerHTML = '';
    var optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '선택 또는 새로 입력';
    el.formDepartment.appendChild(optEmpty);
    _departmentOptions.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      el.formDepartment.appendChild(opt);
    });
    // 이전 값 복원 (있으면)
    if (current) {
      var exists = _departmentOptions.indexOf(current) >= 0;
      if (exists) {
        el.formDepartment.value = current;
      } else if (current.trim()) {
        // 옵션에 없으면 추가하고 선택
        var opt2 = document.createElement('option');
        opt2.value = current;
        opt2.textContent = current;
        el.formDepartment.appendChild(opt2);
        el.formDepartment.value = current;
      }
    }
  }

  function refreshDepartmentFilter() {
    // 현재 필터에는 학위 필터만 있고 소속 필터는 없음 (필요시 나중에 활성화)
  }

  // ====================================================================
  // 직급 옵션 동적 수집 + 드롭다운 갱신
  // (기본 직급은 HTML에 박혀있고, 사용자 추가분만 _positionOptions에 관리)
  // ====================================================================
  function collectPositionOptions() {
    var set = {};
    _persons.forEach(function (p) {
      if (p && p.position && typeof p.position === 'string') {
        var pos = p.position.trim();
        // 기본 직급에 포함된 건 제외
        if (pos && DEFAULT_POSITIONS.indexOf(pos) < 0) {
          set[pos] = true;
        }
      }
    });
    _positionOptions = Object.keys(set).sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    });
  }

  function refreshPositionSelect() {
    if (!el.formPosition) return;
    var current = el.formPosition.value;
    // 옵션 다시 채움 (기본 + 사용자 추가)
    el.formPosition.innerHTML = '';
    var optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '선택';
    el.formPosition.appendChild(optEmpty);
    // 기본 직급
    DEFAULT_POSITIONS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      el.formPosition.appendChild(opt);
    });
    // 사용자 추가 직급
    _positionOptions.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      el.formPosition.appendChild(opt);
    });
    // 이전 값 복원
    if (current) {
      var allOptions = DEFAULT_POSITIONS.concat(_positionOptions);
      var exists = allOptions.indexOf(current) >= 0;
      if (exists) {
        el.formPosition.value = current;
      } else if (current.trim()) {
        // 옵션에 없으면 추가하고 선택
        var opt2 = document.createElement('option');
        opt2.value = current;
        opt2.textContent = current;
        el.formPosition.appendChild(opt2);
        el.formPosition.value = current;
      }
    }
  }

  // ====================================================================
  // HR 정보 완성도 판정
  // ====================================================================
  /**
   * HR 정보 입력 완료 여부 (주요 필드만 체크)
   * 기준: 소속 + 직급 + 최종학위 + (연구자번호 OR 연구소등록)
   * 너무 엄격하지 않게 — 핵심만 채워졌으면 OK
   */
  function isHrComplete(person) {
    if (!person) return false;
    if (!person.department) return false;
    if (!person.position) return false;
    if (!person.finalDegree) return false;
    // 연구자번호 또는 연구소 등록 둘 중 하나는 있어야 함 (둘 다 R&D 표시용)
    if (!person.researcherId && !hasLabRegistered(person)) return false;
    return true;
  }

  function hasResearcher(person) {
    return !!(person && person.researcherId && String(person.researcherId).trim());
  }

  /**
   * 기업부설연구소 등록 여부 — lab.html에 업로드된 명단 기준
   * (옛 person.isLabRegistered 값은 무시하고 lab 데이터로만 판정)
   */
  function hasLabRegistered(person) {
    if (!person || !person.id) return false;
    var svc = window.firestoreService;
    if (!svc || typeof svc.findLatestLabRegistrationForPerson !== 'function') {
      // lab 데이터를 못 가져올 때 옛 값으로 폴백 (안전망)
      return !!(person && person.isLabRegistered);
    }
    return !!svc.findLatestLabRegistrationForPerson(person.id);
  }

  // ====================================================================
  // 필터 + 정렬
  // ====================================================================
  function applyFilter(list) {
    var kw = (_filter.keyword || '').trim().toLowerCase();
    return (list || []).filter(function (p) {
      if (!p) return false;

      // 상태
      if (_filter.status !== 'all') {
        var st = p.status || 'active';
        if (st !== _filter.status) return false;
      }

      // 회사
      if (_filter.company !== 'all') {
        var c = getCompany(p);
        if (c !== _filter.company) return false;
      }

      // 학위 (박사/석사/학사는 (수료)·(재학)도 같이 통과)
      if (!degreeMatchesFilter(p.finalDegree, _filter.degree)) return false;

      // 연구소 등록
      if (_filter.labOnly && !hasLabRegistered(p)) return false;

      // 검색어 (이름 / 소속 / 연구자번호)
      if (kw) {
        var hay = '';
        hay += (p.name || '');
        hay += '|' + (p.department || '');
        hay += '|' + (p.researcherId || '');
        if (hay.toLowerCase().indexOf(kw) < 0) return false;
      }

      return true;
    });
  }

  function sortPersons(filtered) {
    // 학위 필터가 박사/석사/학사일 때만: 본 학위가 위, (수료)/(재학)이 아래로.
    // 그 외에는 평상시처럼 입사일 순.
    var degreeFilter = _filter.degree;
    var pushDownInFilterMode = (degreeFilter === '박사' || degreeFilter === '석사' || degreeFilter === '학사');
    var subValues = { '박사수료': true, '석사수료': true, '학사재학': true };

    return filtered.slice().sort(function (a, b) {
      // 필터 모드에서만 (수료)/(재학)을 뒤로
      if (pushDownInFilterMode) {
        var aSub = !!subValues[a.finalDegree];
        var bSub = !!subValues[b.finalDegree];
        if (aSub !== bSub) return aSub ? 1 : -1;
      }

      // 입사일 빠른 순 (인력 마스터와 동일)
      var ah = a.hireDate || '';
      var bh = b.hireDate || '';
      if (ah && bh) {
        if (ah !== bh) return ah < bh ? -1 : 1;
      } else if (ah && !bh) return -1;
      else if (!ah && bh) return 1;
      var ac = a.createdAt || '';
      var bc = b.createdAt || '';
      if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;
      return 0;
    });
  }

  // ====================================================================
  // 요약 카드
  // ====================================================================
  function updateSummary() {
    var total = _persons.length;
    var active = 0, exited = 0;
    var hrComplete = 0;
    var labCount = 0;

    _persons.forEach(function (p) {
      if (!p) return;
      var st = p.status || 'active';
      if (st === 'exited') {
        exited++;
      } else {
        active++;
        if (isHrComplete(p)) hrComplete++;
      }
      if (hasLabRegistered(p)) labCount++;
    });

    // 한 줄 요약 (각 숫자를 별도 노드에 표시)
    if (el.statTotal)   el.statTotal.textContent = total;
    if (el.statActive)  el.statActive.textContent = active;
    if (el.statExited)  el.statExited.textContent = exited;

    // 호환성: 기존 ID들 (현재는 hidden input이지만, 향후 다시 카드로 부활할 수 있어 그대로 채움)
    if (el.statTotalSub) el.statTotalSub.value = '재직 ' + active + ' · 퇴직 ' + exited;
    if (el.statHrComplete) el.statHrComplete.value = hrComplete;
    if (el.statHrCompleteSub) {
      el.statHrCompleteSub.value = active > 0
        ? '재직 ' + active + '명 중 ' + Math.round(hrComplete / active * 100) + '%'
        : '재직 인력 중';
    }
    if (el.statLab) el.statLab.value = labCount;
  }

  // ====================================================================
  // 테이블 렌더링
  // ====================================================================
  function renderRow(p, idx) {
    var isExited = (p.status === 'exited');
    var isSelected = (p.id === _selectedPersonId);
    var rowClass = isSelected ? 'class="selected"' : '';

    // === 겸직 정보 계산 (master 표 규칙) ===
    // master 정책: 식스티 줄에서만 겸직 처리, 자회사 줄은 일반.
    var mInfo = _moonlightMap ? getMoonlightInfo(p, _moonlightMap) : null;
    // 식스티 퇴사 + 자회사 재직 = "실질 재직". 식스티 줄이지만 회색 처리하지 않고 상태 컬럼에 "겸직" 표시.
    var isMoonlightActiveOnSubsidiary = !!(mInfo && mInfo.isMoonlight && !mInfo.selfActive && mInfo.subsidiaryActive);

    // 행 배경: 퇴직이면 회색, 단 식스티 퇴사+자회사 재직이면 회색 처리 안 함
    var rowStyle = '';
    if (isExited && !isSelected && !isMoonlightActiveOnSubsidiary) {
      rowStyle = 'style="color:#9ca3af;background:#fafafa"';
    }

    var companyHtml = renderCompanyBadge(getCompany(p));

    // 상태 뱃지 (master 표 규칙):
    //  - 식스티 퇴사 + 자회사 재직 → "겸직" (노란글자, 배경 없음)
    //  - 그 외 퇴직 → 회색
    //  - 그 외 → 재직 (파랑)
    var statusBadge;
    if (isMoonlightActiveOnSubsidiary) {
      var othersForStatus = mInfo.others.join(', ');
      statusBadge = '<span class="projects-badge" style="color:#92400e;background:none;padding:0" title="' + escapeHtml(othersForStatus) + '에서 재직 중">겸직</span>';
    } else if (isExited) {
      statusBadge = '<span class="projects-badge projects-badge--end">퇴직</span>';
    } else {
      statusBadge = '<span class="projects-badge projects-badge--active">재직</span>';
    }

    // 이름 + [겸직] 뱃지 (master 표 규칙):
    //  - 식스티 재직 + 자회사 등록 → [겸직] O
    //  - 식스티 퇴사 + 자회사 퇴사 → [겸직] O (이력 표시)
    //  - 식스티 퇴사 + 자회사 재직 → [겸직] X (상태 컬럼에 "겸직" 이미 표시되므로)
    var name = escapeHtml(p.name || '-');
    if (mInfo && mInfo.isMoonlight && !isMoonlightActiveOnSubsidiary) {
      var othersForBadge = mInfo.others.join(', ');
      name += '<span class="moonlight-badge" title="' + escapeHtml(othersForBadge) + '와(과) 겸직">겸직</span>';
    }

    var emptyDash = '<span style="color:#cbd5e1">-</span>';
    var position = p.position ? escapeHtml(p.position) : emptyDash;
    var degree = p.finalDegree ? escapeHtml(formatDegree(p.finalDegree)) : emptyDash;
    var researcherId = p.researcherId
      ? '<span style="font-size:0.8rem">' + escapeHtml(p.researcherId) + '</span>'
      : emptyDash;
    var labBadge = hasLabRegistered(p)
      ? '<span class="projects-badge" style="background:#d1fae5;color:#065f46">✓</span>'
      : emptyDash;

    var pencilIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
      '</svg>';

    return ''
      + '<tr ' + rowClass + ' ' + rowStyle + ' data-person-id="' + escapeHtml(p.id || '') + '">'
        + '<td>' + (idx + 1) + '</td>'
        + '<td>' + companyHtml + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="font-weight:600">' + name + '</td>'
        + '<td>' + position + '</td>'
        + '<td>' + degree + '</td>'
        + '<td>' + researcherId + '</td>'
        + '<td>' + labBadge + '</td>'
        + '<td>'
          + '<button type="button" class="project-edit-btn" '
          +   'data-action="edit" data-person-id="' + escapeHtml(p.id || '') + '" '
          +   'title="인력 상세 정보 수정" aria-label="인력 상세 정보 수정">'
          +   pencilIcon
          + '</button>'
        + '</td>'
      + '</tr>';
  }

  function render() {
    if (!el.tbody) return;

    updateSummary();
    collectDepartmentOptions();
    collectPositionOptions();

    // 겸직 맵을 매 렌더마다 한 번 계산 (renderRow/renderDetailPanel에서 공유)
    _moonlightMap = computeMoonlightMap(_persons);

    var filtered = applyFilter(_persons);
    var sorted = sortPersons(filtered);

    if (el.countHint) {
      el.countHint.textContent = sorted.length + '명';
    }

    if (sorted.length === 0) {
      if (el.tableWrap) el.tableWrap.style.display = 'none';
      if (el.empty) el.empty.style.display = 'block';
      el.tbody.innerHTML = '';
    } else {
      if (el.tableWrap) el.tableWrap.style.display = '';
      if (el.empty) el.empty.style.display = 'none';
      var html = '';
      for (var i = 0; i < sorted.length; i++) {
        html += renderRow(sorted[i], i);
      }
      el.tbody.innerHTML = html;
    }

    // 우측 패널 갱신 (선택된 인력이 필터로 사라지면 비움)
    renderDetailPanel();
  }

  // ====================================================================
  // 우측 상세 패널
  // ====================================================================
  function renderDetailPanel() {
    if (!el.detailContent || !el.detailEmptyState) return;

    if (!_selectedPersonId) {
      el.detailContent.hidden = true;
      el.detailEmptyState.style.display = '';
      return;
    }

    var p = findPersonById(_selectedPersonId);
    if (!p) {
      // 선택했던 인력이 데이터에서 사라짐
      _selectedPersonId = null;
      el.detailContent.hidden = true;
      el.detailEmptyState.style.display = '';
      return;
    }

    el.detailEmptyState.style.display = 'none';
    el.detailContent.hidden = false;

    var company = getCompany(p);
    var companyBadge = renderCompanyBadge(company);

    // 상태 뱃지 — 테이블과 동일한 규칙 (master 표)
    var mInfoDetail = _moonlightMap ? getMoonlightInfo(p, _moonlightMap) : null;
    var isMoonlightActiveOnSubsidiaryDetail = !!(mInfoDetail && mInfoDetail.isMoonlight && !mInfoDetail.selfActive && mInfoDetail.subsidiaryActive);
    var statusBadge;
    if (isMoonlightActiveOnSubsidiaryDetail) {
      var subStatusOthers = mInfoDetail.others.join(', ');
      statusBadge = '<span class="projects-badge" style="color:#92400e;background:none;padding:0" title="' + escapeHtml(subStatusOthers) + '에서 재직 중">겸직</span>';
    } else if (p.status === 'exited') {
      statusBadge = '<span class="projects-badge projects-badge--end">퇴직</span>';
    } else {
      statusBadge = '<span class="projects-badge projects-badge--active">재직</span>';
    }

    // 겸직 뱃지: 다른 회사에도 등록된 경우 (식스티 줄·자회사 줄 양쪽 다 표시).
    // 단 식스티 퇴사 + 자회사 재직 케이스에선 상태 컬럼이 이미 "겸직: 굿뉴스"를 가리키므로 중복 표시 안 함.
    var moonlightBadge = '';
    var crossInfoDetail = _moonlightMap ? getCrossCompanyInfo(p, _moonlightMap) : null;
    if (crossInfoDetail && crossInfoDetail.hasOthers && !isMoonlightActiveOnSubsidiaryDetail) {
      var othersText = crossInfoDetail.others.join(', ');
      moonlightBadge = '<span class="moonlight-badge" title="' + escapeHtml(othersText) + '에서도 재직">겸직: ' + escapeHtml(othersText) + '</span>';
    }

    function fld(label, value, fallback) {
      var hasValue = value != null && value !== '' && value !== false;
      return ''
        + '<div class="detail-field">'
        +   '<div class="detail-field-label">' + escapeHtml(label) + '</div>'
        +   '<div class="detail-field-value' + (hasValue ? '' : ' detail-field-value--empty') + '">'
        +     (hasValue ? escapeHtml(String(value)) : (fallback || '미입력'))
        +   '</div>'
        + '</div>';
    }

    function boolFld(label, value) {
      var icon = value ? '✓' : '—';
      var color = value ? '#047857' : '#cbd5e1';
      return ''
        + '<div class="detail-field">'
        +   '<div class="detail-field-label">' + escapeHtml(label) + '</div>'
        +   '<div class="detail-field-value" style="color:' + color + '">'
        +     icon + ' ' + (value ? '등록' : '미등록')
        +   '</div>'
        + '</div>';
    }

    /**
     * 기업부설연구소 등록 정보 — lab.html 데이터 기준 자동 표시
     */
    function renderLabFields(person) {
      var svc = window.firestoreService;
      var latest = null;
      if (svc && typeof svc.findLatestLabRegistrationForPerson === 'function') {
        latest = svc.findLatestLabRegistrationForPerson(person.id);
      }

      if (!latest) {
        return ''
          + '<div class="detail-field">'
          +   '<div class="detail-field-label">기업부설연구소</div>'
          +   '<div class="detail-field-value" style="color:#cbd5e1">— 미등록</div>'
          + '</div>';
      }

      var monthDisplay = (latest.yearMonth || '').replace('-', '.');
      var html = ''
        + '<div class="detail-field">'
        +   '<div class="detail-field-label">기업부설연구소</div>'
        +   '<div class="detail-field-value" style="color:#047857">'
        +     '✓ 등록 <span style="color:var(--text-secondary);font-size:0.82rem;font-weight:400">('
        +     escapeHtml(latest.company || '-') + ' · ' + escapeHtml(monthDisplay) + ' 기준)</span>'
        +   '</div>'
        + '</div>';

      if (latest.assignedDate) {
        html += ''
          + '<div class="detail-field">'
          +   '<div class="detail-field-label">연구소 발령일</div>'
          +   '<div class="detail-field-value">' + escapeHtml(formatDate(latest.assignedDate)) + '</div>'
          + '</div>';
      }
      return html;
    }

    /**
     * 자격증 목록 (Step 4-2)
     * person.certificates 배열을 자격증 카드 리스트로 렌더링.
     * URL이 있으면 "📎 증빙 보기" 링크를 새 탭으로 열어줌.
     */
    function renderCertificatesDetail(person) {
      var certs = Array.isArray(person.certificates) ? person.certificates : [];
      if (certs.length === 0) {
        return '<div class="detail-cert-empty">— 등록된 자격증 없음</div>';
      }

      var html = '<div class="detail-cert-list">';
      for (var i = 0; i < certs.length; i++) {
        var c = certs[i];
        if (!c) continue;
        html += '<div class="detail-cert-item">'
          + '<span class="detail-cert-name">' + escapeHtml(c.name || '-') + '</span>';
        if (c.memo) {
          html += '<span class="detail-cert-memo">' + escapeHtml(c.memo) + '</span>';
        } else {
          html += '<span class="detail-cert-memo"></span>';
        }
        if (c.url) {
          // 안전한 URL인지 가볍게 체크 (http(s):// 만 허용)
          var url = String(c.url).trim();
          if (/^https?:\/\//i.test(url)) {
            html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="detail-cert-link">📎 증빙</a>';
          } else {
            html += '<span class="detail-cert-link" style="background:#f1f5f9;color:#94a3b8" title="유효하지 않은 URL">📎 링크 오류</span>';
          }
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    var html = ''
      + '<div class="detail-header">'
      +   '<div>'
      +     '<h3 class="detail-name">' + escapeHtml(p.name || '-') + '</h3>'
      +     '<div class="detail-name-sub">' + companyBadge + statusBadge + moonlightBadge + '</div>'
      +   '</div>'
      +   '<div class="detail-header-actions">'
      +     '<button type="button" class="detail-edit-btn" data-action="edit-from-detail" data-person-id="' + escapeHtml(p.id || '') + '">'
      +       '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      +         '<path d="M12 20h9"/>'
      +         '<path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'
      +       '</svg> 수정'
      +     '</button>'
      +     '<button type="button" class="detail-close-btn" data-action="close-detail" title="닫기" aria-label="상세 닫기">✕</button>'
      +   '</div>'
      + '</div>'

      + '<div class="detail-fields">'

      // 기본 정보 (인력 마스터에서 가져옴 — 읽기 전용)
      +   '<div class="detail-section-title">기본 정보 <span style="font-weight:400;color:#94a3b8;font-size:0.7rem">(인력 마스터에서 관리)</span></div>'
      +   fld('생년월일', (function () {
            if (!p.birthDate) return null;
            var age = computeAge(p.birthDate);
            return formatDate(p.birthDate) + (age != null ? ' (만 ' + age + '세)' : '');
          })())
      +   fld('입사일', p.hireDate ? formatDate(p.hireDate) : null)
      +   fld('퇴사일', p.exitDate ? formatDate(p.exitDate) : null, '재직 중')

      // 조직
      +   '<div class="detail-section-title">조직 정보</div>'
      +   fld('소속', p.department)
      +   fld('직급', p.position)

      // 학력
      +   '<div class="detail-section-title">학력</div>'
      +   fld('최종학위', p.finalDegree ? formatDegree(p.finalDegree) : null)
      +   fld('학교', p.school)
      +   fld('학과/전공', p.major)
      +   fld('학위번호', p.degreeNumber)
      +   fld('학위 수여일', p.degreeDate ? formatDate(p.degreeDate) : null)

      // 연구
      +   '<div class="detail-section-title">연구 정보</div>'
      +   fld('연구자번호', p.researcherId)
      +   renderLabFields(p)

      // 연락처
      +   '<div class="detail-section-title">연락처</div>'
      +   fld('핸드폰', p.phone)
      +   fld('이메일', p.email)
      +   fld('주소', p.address)

      // 자격증 (Step 4-2)
      +   '<div class="detail-section-title">자격증</div>'
      +   renderCertificatesDetail(p)

      // 메모
      +   '<div class="detail-section-title">메모</div>'
      +   fld('메모', p.hrMemo, '없음')

      + '</div>';

    el.detailContent.innerHTML = html;
  }

  function findPersonById(id) {
    for (var i = 0; i < _persons.length; i++) {
      if (_persons[i] && _persons[i].id === id) return _persons[i];
    }
    return null;
  }

  function selectPerson(id) {
    _selectedPersonId = id;
    // 테이블 행 클래스 갱신 (전체 재렌더링은 비효율적이라 클래스만)
    if (el.tbody) {
      var rows = el.tbody.querySelectorAll('tr');
      rows.forEach(function (tr) {
        if (tr.getAttribute('data-person-id') === id) {
          tr.classList.add('selected');
        } else {
          tr.classList.remove('selected');
        }
      });
    }
    renderDetailPanel();
  }

  // ====================================================================
  // 모달 (인력 상세 정보 수정)
  // ====================================================================
  function openModal(person) {
    if (!el.modal || !person) return;

    _editingPerson = person;
    clearFormError();

    // 제목: "○○○ — 인력 상세 정보 수정"
    if (el.modalTitle) {
      el.modalTitle.textContent = (person.name || '인력') + ' — 인력 상세 정보 수정';
    }

    fillForm(person);
    el.modal.hidden = false;

    // 포커스: 소속 드롭다운
    setTimeout(function () {
      if (el.formDepartment) el.formDepartment.focus();
    }, 50);
  }

  function closeModal() {
    if (!el.modal) return;
    if (_saving) return;
    el.modal.hidden = true;
    _editingPerson = null;
    _editingCertificates = [];  // 자격증 편집 상태도 초기화
    clearFormError();
  }

  function fillForm(person) {
    // 드롭다운 옵션 갱신 (현재 사람의 부서가 옵션에 없으면 추가됨)
    refreshDepartmentSelect();
    refreshPositionSelect();

    // 소속
    if (el.formDepartment) {
      if (person.department) {
        // 옵션에 없으면 추가
        var found = false;
        for (var i = 0; i < el.formDepartment.options.length; i++) {
          if (el.formDepartment.options[i].value === person.department) {
            found = true;
            break;
          }
        }
        if (!found) {
          var opt = document.createElement('option');
          opt.value = person.department;
          opt.textContent = person.department;
          el.formDepartment.appendChild(opt);
        }
        el.formDepartment.value = person.department;
      } else {
        el.formDepartment.value = '';
      }
    }

    // 직급
    if (el.formPosition) {
      if (person.position) {
        var foundPos = false;
        for (var j = 0; j < el.formPosition.options.length; j++) {
          if (el.formPosition.options[j].value === person.position) {
            foundPos = true;
            break;
          }
        }
        if (!foundPos) {
          var optPos = document.createElement('option');
          optPos.value = person.position;
          optPos.textContent = person.position;
          el.formPosition.appendChild(optPos);
        }
        el.formPosition.value = person.position;
      } else {
        el.formPosition.value = '';
      }
    }

    if (el.formFinalDegree)    el.formFinalDegree.value    = person.finalDegree    || '';
    if (el.formSchool)         el.formSchool.value         = person.school         || '';
    if (el.formMajor)          el.formMajor.value          = person.major          || '';
    if (el.formDegreeNumber)   el.formDegreeNumber.value   = person.degreeNumber   || '';
    if (el.formResearcherId)   el.formResearcherId.value   = person.researcherId   || '';
    if (el.formPhone)          el.formPhone.value          = person.phone          || '';
    if (el.formEmail)          el.formEmail.value          = person.email          || '';
    if (el.formAddress)        el.formAddress.value        = person.address        || '';
    if (el.formHrMemo)         el.formHrMemo.value         = person.hrMemo         || '';

    // 학위 수여일
    setDateParts(el.formDegreeY, el.formDegreeM, el.formDegreeD, person.degreeDate);

    // 기업부설연구소 등록 — 자동 표시 (lab.html의 명단 기준)
    updateLabStatusDisplay(person);

    // 자격증 (Step 4-2)
    // person.certificates를 _editingCertificates에 깊은 복사 → 편집 가능
    _editingCertificates = [];
    if (Array.isArray(person.certificates)) {
      for (var ci = 0; ci < person.certificates.length; ci++) {
        var c = person.certificates[ci];
        if (!c) continue;
        _editingCertificates.push({
          id: c.id || generateCertId(),
          name: c.name || '',
          url: c.url || '',
          memo: c.memo || '',
          createdAt: c.createdAt || null
        });
      }
    }
    renderCertificatesForm();
  }

  /**
   * 기업부설연구소 등록 자동 표시
   *
   * lab.html에 업로드된 명단을 firestoreService.findLatestLabRegistrationForPerson()
   * 으로 조회해서, 현재 인력이 가장 최근에 어느 회사/월에 등록되었는지 표시.
   */
  function updateLabStatusDisplay(person) {
    if (!el.formLabStatus) return;
    if (!person || !person.id) {
      el.formLabStatus.innerHTML = '<span style="color:#94a3b8">—</span>';
      return;
    }

    var svc = window.firestoreService;
    if (!svc || typeof svc.findLatestLabRegistrationForPerson !== 'function') {
      el.formLabStatus.innerHTML = '<span style="color:#94a3b8">— (연구소 데이터를 불러올 수 없어요)</span>';
      return;
    }

    var latest = svc.findLatestLabRegistrationForPerson(person.id);
    if (!latest) {
      el.formLabStatus.innerHTML = '<span style="color:#94a3b8">— 미등록</span>';
      return;
    }

    // 등록됨 — 최신 월 표시
    var monthDisplay = (latest.yearMonth || '').replace('-', '.');
    var assignedPart = '';
    if (latest.assignedDate) {
      assignedPart = ' · 연구소 발령일: ' + String(latest.assignedDate).slice(0, 10);
    }
    el.formLabStatus.innerHTML = ''
      + '<span style="color:#047857;font-weight:600">✓ 등록</span>'
      + ' <span style="color:var(--text-secondary);font-size:0.82rem">('
      + escapeHtml(latest.company || '-') + ' · '
      + escapeHtml(monthDisplay) + ' 기준'
      + ')</span>'
      + (assignedPart ? '<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.2rem">' + escapeHtml(assignedPart) + '</div>' : '');
  }

  // 옛 updateLabDateRow는 더 이상 사용 안 함 (체크박스가 사라졌으니까)
  function updateLabDateRow() {
    // no-op (호환성 위해 남겨둠)
  }

  // ====================================================================
  // 자격증 관리 (Step 4-2)
  // ====================================================================

  /**
   * 자격증 고유 ID 생성 (cert_타임스탬프_난수)
   */
  function generateCertId() {
    return 'cert_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  }

  /**
   * 모달의 자격증 목록 영역 렌더링
   * _editingCertificates 배열을 그대로 화면에 그림.
   * 항목별 input은 onChange로 _editingCertificates를 갱신.
   */
  function renderCertificatesForm() {
    if (!el.formCertificatesList) return;

    if (_editingCertificates.length === 0) {
      el.formCertificatesList.innerHTML =
        '<div class="form-cert-empty">등록된 자격증이 없습니다. 아래 버튼으로 추가하세요.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < _editingCertificates.length; i++) {
      var c = _editingCertificates[i];
      html += ''
        + '<div class="form-cert-item" data-cert-id="' + escapeHtml(c.id) + '">'
        +   '<input type="text" class="form-cert-name" data-field="name" '
        +     'value="' + escapeHtml(c.name) + '" placeholder="자격증 이름" maxlength="80">'
        +   '<input type="text" class="form-cert-url" data-field="url" '
        +     'value="' + escapeHtml(c.url) + '" placeholder="증빙 URL (선택)" maxlength="500">'
        +   '<input type="text" class="form-cert-memo" data-field="memo" '
        +     'value="' + escapeHtml(c.memo) + '" placeholder="메모 (선택)" maxlength="200">'
        +   '<button type="button" class="form-cert-delete" data-action="delete-cert" '
        +     'data-cert-id="' + escapeHtml(c.id) + '" title="삭제">✕</button>'
        + '</div>';
    }
    el.formCertificatesList.innerHTML = html;
  }

  /**
   * 자격증 추가 (빈 항목 1개 추가)
   */
  function addCertificateRow() {
    _editingCertificates.push({
      id: generateCertId(),
      name: '',
      url: '',
      memo: '',
      createdAt: null  // 저장 시점에 세팅
    });
    renderCertificatesForm();
    // 새로 추가된 항목의 이름 input에 포커스
    setTimeout(function () {
      if (!el.formCertificatesList) return;
      var items = el.formCertificatesList.querySelectorAll('.form-cert-item');
      if (items.length > 0) {
        var nameInput = items[items.length - 1].querySelector('.form-cert-name');
        if (nameInput) nameInput.focus();
      }
    }, 30);
  }

  /**
   * 자격증 삭제 (id로 찾아서 배열에서 제거)
   */
  function deleteCertificateRow(certId) {
    if (!certId) return;
    _editingCertificates = _editingCertificates.filter(function (c) {
      return c.id !== certId;
    });
    renderCertificatesForm();
  }

  /**
   * 자격증 input 변경 시 호출 (input 이벤트 위임)
   * @param {string} certId  변경된 항목 id
   * @param {string} field   'name' | 'url' | 'memo'
   * @param {string} value   새 값
   */
  function updateCertificateField(certId, field, value) {
    for (var i = 0; i < _editingCertificates.length; i++) {
      if (_editingCertificates[i].id === certId) {
        _editingCertificates[i][field] = value;
        break;
      }
    }
  }

  /**
   * 저장 직전: _editingCertificates를 최종 형태로 정리
   * - 이름이 비어있는 항목은 제거 (자격증 이름은 필수)
   * - URL/메모 trim
   * - createdAt 없는 새 항목엔 현재 시각 부여
   * - 잘못된 URL은 빈 문자열로 (저장은 됨, 단순 정규화)
   * @returns {Array|null} 정리된 자격증 배열 (없으면 null)
   */
  function finalizeCertificates() {
    var nowIso = new Date().toISOString();
    var result = [];
    for (var i = 0; i < _editingCertificates.length; i++) {
      var c = _editingCertificates[i];
      var name = (c.name || '').trim();
      if (!name) continue;  // 이름 없는 자격증은 저장 안 함

      result.push({
        id: c.id || generateCertId(),
        name: name,
        url: (c.url || '').trim() || null,
        memo: (c.memo || '').trim() || null,
        createdAt: c.createdAt || nowIso
      });
    }
    return result.length > 0 ? result : null;
  }

  function readForm() {
    // 소속
    var department = el.formDepartment ? (el.formDepartment.value || '').trim() : '';
    var position = el.formPosition ? (el.formPosition.value || '').trim() : '';
    var finalDegree = el.formFinalDegree ? (el.formFinalDegree.value || '').trim() : '';
    var school = el.formSchool ? (el.formSchool.value || '').trim() : '';
    var major = el.formMajor ? (el.formMajor.value || '').trim() : '';
    var degreeNumber = el.formDegreeNumber ? (el.formDegreeNumber.value || '').trim() : '';
    var researcherId = el.formResearcherId ? (el.formResearcherId.value || '').trim() : '';
    var phone = el.formPhone ? (el.formPhone.value || '').trim() : '';
    var email = el.formEmail ? (el.formEmail.value || '').trim() : '';
    var address = el.formAddress ? (el.formAddress.value || '').trim() : '';
    var hrMemo = el.formHrMemo ? (el.formHrMemo.value || '').trim() : '';

    // 학위 수여일
    var degreeDateResult = buildDateString(
      el.formDegreeY ? el.formDegreeY.value : '',
      el.formDegreeM ? el.formDegreeM.value : '',
      el.formDegreeD ? el.formDegreeD.value : ''
    );
    if (degreeDateResult.error) {
      showFormError('학위 수여일을 정확한 날짜로 입력하거나 비워주세요.', el.formDegreeY);
      return null;
    }
    var degreeDate = degreeDateResult.iso;

    // 연구소 등록 — 더 이상 form에서 읽지 않음 (자동 계산이라)
    // 기존에 저장돼 있던 person.isLabRegistered / labRegisterDate 값을 유지하려고
    // null 대신 'KEEP' 표시. updatePerson 호출 시 이 키들을 빼면 기존 값이 유지됨.

    return {
      department: department || null,
      position: position || null,
      finalDegree: finalDegree || null,
      school: school || null,
      major: major || null,
      degreeNumber: degreeNumber || null,
      degreeDate: degreeDate,
      researcherId: researcherId || null,
      // isLabRegistered, labRegisterDate 는 반환값에 포함하지 않음 (form에서 안 읽기 때문)
      phone: phone || null,
      email: email || null,
      address: address || null,
      hrMemo: hrMemo || null,
      // 자격증 (Step 4-2) — _editingCertificates를 최종 정리
      certificates: finalizeCertificates()
    };
  }

  function clearFormError() {
    if (el.formError) {
      el.formError.hidden = true;
      el.formError.textContent = '';
    }
  }

  function showFormError(message, focusEl) {
    if (el.formError) {
      el.formError.hidden = false;
      el.formError.textContent = message;
    }
    if (focusEl && focusEl.focus) {
      try { focusEl.focus(); } catch (e) {}
    }
  }

  function setSaving(saving) {
    _saving = saving;
    if (el.modalSave) {
      el.modalSave.disabled = saving;
      el.modalSave.textContent = saving ? '저장 중…' : '저장';
    }
    if (el.modalCancel) el.modalCancel.disabled = saving;
    if (el.modalClose) el.modalClose.disabled = saving;
  }

  function onModalSave() {
    if (_saving) return;
    if (!_editingPerson) return;

    var hrData = readForm();
    if (!hrData) return;

    // 🐛 디버깅: 자격증 저장 흐름 추적 (Step 4-2)
    console.log('[자격증 디버깅] _editingCertificates:', JSON.parse(JSON.stringify(_editingCertificates)));
    console.log('[자격증 디버깅] hrData.certificates:', hrData.certificates);
    console.log('[자격증 디버깅] _editingPerson.id:', _editingPerson.id);

    setSaving(true);

    var svc = window.firestoreService;
    if (!svc || typeof svc.updatePerson !== 'function') {
      setSaving(false);
      alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }

    // updatePerson(id, updates) 시그니처:
    // - hrData는 form에서 읽은 HR 필드만 들어있음
    // - firestore-service의 updatePerson이 기존 person 객체에 hrData를 머지함 (마스터 필드 보존)
    svc.updatePerson(_editingPerson.id, hrData).then(function (saved) {
      setSaving(false);
      // 🐛 디버깅: 저장 후 결과
      console.log('[자격증 디버깅] 저장된 person.certificates:', saved && saved.certificates);
      if (!saved) {
        // 인력을 찾지 못한 경우 (드물지만 안전장치)
        showFormError('인력을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.');
        return;
      }
      closeModal();
    }).catch(function (err) {
      setSaving(false);
      console.error('HR 정보 저장 실패:', err);
      showFormError('저장에 실패했어요. ' + (err && err.message ? err.message : '잠시 후 다시 시도해 주세요.'));
    });
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape' && !_saving) {
      closeModal();
    }
  }

  function onModalOverlayClick(e) {
    if (e.target === el.modal) closeModal();
  }

  // 부서 "+ 추가" 버튼: 사용자가 새 소속명을 입력
  function onDepartmentAddClick() {
    var name = window.prompt('새 소속명을 입력하세요:', '');
    if (!name) return;
    name = name.trim();
    if (!name) return;

    // 옵션에 추가 + 선택
    var found = false;
    for (var i = 0; i < el.formDepartment.options.length; i++) {
      if (el.formDepartment.options[i].value === name) {
        found = true;
        break;
      }
    }
    if (!found) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      el.formDepartment.appendChild(opt);
    }
    el.formDepartment.value = name;
  }

  // ====================================================================
  // 직급 추가/관리 (소속과 동일 패턴)
  // ====================================================================
  function onPositionAddClick() {
    var name = window.prompt('새 직급명을 입력하세요:', '');
    if (!name) return;
    name = name.trim();
    if (!name) return;

    var found = false;
    for (var i = 0; i < el.formPosition.options.length; i++) {
      if (el.formPosition.options[i].value === name) {
        found = true;
        break;
      }
    }
    if (!found) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      el.formPosition.appendChild(opt);
    }
    el.formPosition.value = name;
  }

  /**
   * 직급별 인력 수 카운트
   */
  function countPersonsByPosition() {
    var counts = {};
    _persons.forEach(function (p) {
      if (p && p.position) {
        var pos = p.position.trim();
        if (pos) counts[pos] = (counts[pos] || 0) + 1;
      }
    });
    return counts;
  }

  /**
   * 직급 이름 변경 — 해당 직급을 가진 모든 인력의 position 필드를 일괄 업데이트
   */
  function renamePosition(oldName, newName) {
    if (!oldName || !newName) return Promise.resolve();
    if (oldName === newName) return Promise.resolve();

    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요.');
      return Promise.reject(new Error('no service'));
    }

    var affected = _persons.filter(function (p) { return p && p.position === oldName; });
    if (affected.length === 0) return Promise.resolve();

    var nowISO = new Date().toISOString();
    var updated = _persons.map(function (p) {
      if (!p) return p;
      if (p.position === oldName) {
        var newP = Object.assign({}, p);
        newP.position = newName;
        newP.updatedAt = nowISO;
        return newP;
      }
      return p;
    });
    return svc.savePersons(updated);
  }

  /**
   * 직급 삭제 — 해당 직급을 가진 모든 인력의 position 필드를 null로
   */
  function deletePosition(name) {
    if (!name) return Promise.resolve();
    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요.');
      return Promise.reject(new Error('no service'));
    }

    var nowISO = new Date().toISOString();
    var updated = _persons.map(function (p) {
      if (!p) return p;
      if (p.position === name) {
        var newP = Object.assign({}, p);
        newP.position = null;
        newP.updatedAt = nowISO;
        return newP;
      }
      return p;
    });
    return svc.savePersons(updated);
  }

  function openPositionManageModal() {
    if (!el.deptManageModal) return;
    // 같은 모달을 직급 관리용으로 재활용 — 모드 전환
    _deptManageMode = 'position';
    renderPositionManageList();
    // 제목 변경
    var titleEl = document.getElementById('dept-manage-title');
    if (titleEl) titleEl.textContent = '직급 목록 관리';
    el.deptManageModal.hidden = false;
  }

  function renderPositionManageList() {
    if (!el.deptManageList || !el.deptManageEmpty) return;

    collectPositionOptions();
    var counts = countPersonsByPosition();

    // 표시할 모든 직급 = 기본 + 사용자 추가
    var allPositions = DEFAULT_POSITIONS.concat(_positionOptions);

    if (allPositions.length === 0) {
      el.deptManageList.innerHTML = '';
      el.deptManageEmpty.hidden = false;
      return;
    }
    el.deptManageEmpty.hidden = true;

    var html = '';
    allPositions.forEach(function (name) {
      var count = counts[name] || 0;
      var isDefault = DEFAULT_POSITIONS.indexOf(name) >= 0;
      html += ''
        + '<div class="dept-manage-item" data-dept="' + escapeHtml(name) + '">'
        +   '<span class="dept-manage-item-name">' + escapeHtml(name)
        +     (isDefault ? ' <span style="font-size:0.7rem;color:#94a3b8;font-weight:400">기본</span>' : '')
        +   '</span>'
        +   '<span class="dept-manage-item-count">' + count + '명</span>'
        +   '<button type="button" class="dept-manage-item-btn" data-action="rename-position" data-dept="' + escapeHtml(name) + '">이름 변경</button>'
        +   (isDefault
              ? '<button type="button" class="dept-manage-item-btn" disabled style="opacity:0.4;cursor:not-allowed" title="기본 직급은 삭제할 수 없어요">삭제</button>'
              : '<button type="button" class="dept-manage-item-btn dept-manage-item-btn--danger" data-action="delete-position" data-dept="' + escapeHtml(name) + '">삭제</button>')
        + '</div>';
    });
    el.deptManageList.innerHTML = html;
  }

  // 소속/직급 관리 모달이 현재 어느 모드인지
  var _deptManageMode = 'department';  // 'department' | 'position'

  // ====================================================================
  // 소속 관리 모달 (이름 변경/삭제 + 일괄 업데이트)
  // ====================================================================
  function openDeptManageModal() {
    if (!el.deptManageModal) return;
    _deptManageMode = 'department';
    // 제목 변경
    var titleEl = document.getElementById('dept-manage-title');
    if (titleEl) titleEl.textContent = '소속 목록 관리';
    renderDeptManageList();
    el.deptManageModal.hidden = false;
  }

  function closeDeptManageModal() {
    if (!el.deptManageModal) return;
    el.deptManageModal.hidden = true;
  }

  /**
   * 소속별 인력 수 카운트
   * @returns {{ [department]: number }}
   */
  function countPersonsByDepartment() {
    var counts = {};
    _persons.forEach(function (p) {
      if (p && p.department) {
        var d = p.department.trim();
        if (d) counts[d] = (counts[d] || 0) + 1;
      }
    });
    return counts;
  }

  /**
   * 소속 관리 모달 안의 목록 렌더링
   */
  function renderDeptManageList() {
    if (!el.deptManageList || !el.deptManageEmpty) return;

    collectDepartmentOptions();
    var counts = countPersonsByDepartment();

    if (_departmentOptions.length === 0) {
      el.deptManageList.innerHTML = '';
      el.deptManageEmpty.hidden = false;
      return;
    }
    el.deptManageEmpty.hidden = true;

    var html = '';
    _departmentOptions.forEach(function (name) {
      var count = counts[name] || 0;
      html += ''
        + '<div class="dept-manage-item" data-dept="' + escapeHtml(name) + '">'
        +   '<span class="dept-manage-item-name">' + escapeHtml(name) + '</span>'
        +   '<span class="dept-manage-item-count">' + count + '명</span>'
        +   (count > 0
              ? '<button type="button" class="dept-manage-item-btn" data-action="move-some" data-dept="' + escapeHtml(name) + '" title="이 소속 인원 중 일부를 다른 소속으로 이동">일부 이동</button>'
              : '')
        +   '<button type="button" class="dept-manage-item-btn" data-action="rename" data-dept="' + escapeHtml(name) + '">이름 변경</button>'
        +   '<button type="button" class="dept-manage-item-btn dept-manage-item-btn--danger" data-action="delete" data-dept="' + escapeHtml(name) + '">삭제</button>'
        + '</div>';
    });
    el.deptManageList.innerHTML = html;
  }

  /**
   * 소속 이름 변경 — 해당 소속을 가진 모든 인력의 department 필드를 일괄 업데이트
   */
  function renameDepartment(oldName, newName) {
    if (!oldName || !newName) return Promise.resolve();
    if (oldName === newName) return Promise.resolve();

    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
      return Promise.reject(new Error('no service'));
    }

    // 대상 인력 찾기
    var affected = _persons.filter(function (p) {
      return p && p.department === oldName;
    });
    if (affected.length === 0) {
      console.warn('대상 인력 없음:', oldName);
      return Promise.resolve();
    }

    // 새 목록 생성 (해당 인력의 department 만 변경)
    var nowISO = new Date().toISOString();
    var updated = _persons.map(function (p) {
      if (!p) return p;
      if (p.department === oldName) {
        var newP = Object.assign({}, p);
        newP.department = newName;
        newP.updatedAt = nowISO;
        return newP;
      }
      return p;
    });

    return svc.savePersons(updated);
  }

  /**
   * 소속 삭제 — 해당 소속을 가진 모든 인력의 department 필드를 null로
   */
  function deleteDepartment(name) {
    if (!name) return Promise.resolve();

    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요.');
      return Promise.reject(new Error('no service'));
    }

    var affected = _persons.filter(function (p) {
      return p && p.department === name;
    });
    if (affected.length === 0) return Promise.resolve();

    var nowISO = new Date().toISOString();
    var updated = _persons.map(function (p) {
      if (!p) return p;
      if (p.department === name) {
        var newP = Object.assign({}, p);
        newP.department = null;
        newP.updatedAt = nowISO;
        return newP;
      }
      return p;
    });

    return svc.savePersons(updated);
  }

  /**
   * 소속 관리 모달 클릭 핸들러 (이벤트 위임)
   * 모드별로 분기: 소속(rename/delete/move-some) / 직급(rename-position/delete-position)
   */
  function onDeptManageClick(e) {
    var btn = e.target.closest && e.target.closest('button[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var itemName = btn.getAttribute('data-dept');
    if (!action || !itemName) return;

    // === 직급 모드 ===
    if (action === 'rename-position') {
      var posCounts = countPersonsByPosition();
      var posCount = posCounts[itemName] || 0;
      var newPosName = window.prompt(
        '"' + itemName + '" 직급의 새 이름을 입력하세요.\n' +
        '(현재 ' + posCount + '명의 인력이 이 직급을 가지고 있으며, 모두 일괄 변경됩니다)',
        itemName
      );
      if (!newPosName) return;
      newPosName = newPosName.trim();
      if (!newPosName || newPosName === itemName) return;

      var allPositions = DEFAULT_POSITIONS.concat(_positionOptions);
      if (allPositions.indexOf(newPosName) >= 0) {
        if (!confirm('"' + newPosName + '" 은(는) 이미 존재하는 직급이에요. 합칠까요?\n\n' +
                     '"' + itemName + '" 직급의 ' + posCount + '명을 "' + newPosName + '"으로 옮깁니다.')) {
          return;
        }
      }

      renamePosition(itemName, newPosName).then(function () {
        renderPositionManageList();
        refreshPositionSelect();
        if (el.formPosition && el.formPosition.value === itemName) {
          el.formPosition.value = newPosName;
        }
      }).catch(function (err) {
        console.error('직급 이름 변경 실패:', err);
        alert('변경에 실패했어요. ' + (err && err.message ? err.message : ''));
      });
      return;
    }

    if (action === 'delete-position') {
      var posCounts2 = countPersonsByPosition();
      var posCount2 = posCounts2[itemName] || 0;
      var msg2 = '"' + itemName + '" 직급을 삭제할까요?\n\n';
      if (posCount2 > 0) {
        msg2 += '현재 ' + posCount2 + '명의 인력이 이 직급을 가지고 있어요.\n';
        msg2 += '삭제하면 이 ' + posCount2 + '명의 직급이 모두 비워집니다.\n\n';
      }
      msg2 += '(되돌릴 수 없습니다)';
      if (!confirm(msg2)) return;

      deletePosition(itemName).then(function () {
        renderPositionManageList();
        refreshPositionSelect();
        if (el.formPosition && el.formPosition.value === itemName) {
          el.formPosition.value = '';
        }
      }).catch(function (err) {
        console.error('직급 삭제 실패:', err);
        alert('삭제에 실패했어요. ' + (err && err.message ? err.message : ''));
      });
      return;
    }

    // === 소속 모드 (기존 로직) ===
    var deptName = itemName;
    var counts = countPersonsByDepartment();
    var count = counts[deptName] || 0;

    if (action === 'rename') {
      var newName = window.prompt(
        '"' + deptName + '" 소속의 새 이름을 입력하세요.\n' +
        '(현재 ' + count + '명의 인력이 이 소속을 가지고 있으며, 모두 일괄 변경됩니다)',
        deptName
      );
      if (!newName) return;
      newName = newName.trim();
      if (!newName || newName === deptName) return;

      // 중복 체크
      if (_departmentOptions.indexOf(newName) >= 0) {
        if (!confirm('"' + newName + '" 은(는) 이미 존재하는 소속이에요. 합칠까요?\n\n' +
                     '"' + deptName + '" 소속의 ' + count + '명을 "' + newName + '"으로 옮깁니다.')) {
          return;
        }
      }

      renameDepartment(deptName, newName).then(function () {
        renderDeptManageList();
        // 폼에서도 옵션 갱신
        refreshDepartmentSelect();
        // 폼에서 이전 이름을 보고 있던 사람이 있으면 새 이름으로 갱신
        if (el.formDepartment && el.formDepartment.value === deptName) {
          el.formDepartment.value = newName;
        }
      }).catch(function (err) {
        console.error('소속 이름 변경 실패:', err);
        alert('변경에 실패했어요. ' + (err && err.message ? err.message : ''));
      });
    } else if (action === 'delete') {
      var msg = '"' + deptName + '" 소속을 삭제할까요?\n\n';
      if (count > 0) {
        msg += '현재 ' + count + '명의 인력이 이 소속을 가지고 있어요.\n';
        msg += '삭제하면 이 ' + count + '명의 소속이 모두 비워집니다.\n\n';
      }
      msg += '(되돌릴 수 없습니다)';
      if (!confirm(msg)) return;

      deleteDepartment(deptName).then(function () {
        renderDeptManageList();
        refreshDepartmentSelect();
        // 폼에서 그 이름을 보고 있던 사람이 있으면 비움
        if (el.formDepartment && el.formDepartment.value === deptName) {
          el.formDepartment.value = '';
        }
      }).catch(function (err) {
        console.error('소속 삭제 실패:', err);
        alert('삭제에 실패했어요. ' + (err && err.message ? err.message : ''));
      });
    } else if (action === 'move-some') {
      openDeptMoveModal(deptName);
    }
  }

  // ====================================================================
  // 인력 일괄 이동 모달
  // ====================================================================
  var _deptMoveState = {
    sourceDept: null,        // 원래 소속
    candidates: [],          // 그 소속의 인력 [{ id, name, company }]
    selectedIds: {}          // { personId: true }
  };

  function openDeptMoveModal(sourceDept) {
    if (!el.deptMoveModal) return;
    if (!sourceDept) return;

    // 그 소속의 인력 수집
    var candidates = _persons.filter(function (p) {
      return p && p.department === sourceDept;
    });

    _deptMoveState.sourceDept = sourceDept;
    _deptMoveState.candidates = candidates;
    _deptMoveState.selectedIds = {};

    // 소스 이름 표시
    if (el.deptMoveSourceName) {
      el.deptMoveSourceName.textContent = sourceDept;
    }

    // 대상 소속 드롭다운 채우기 (현재 소스 제외)
    refreshDeptMoveTargetSelect();

    // 인력 목록 렌더링
    renderDeptMoveList();

    el.deptMoveModal.hidden = false;
  }

  function closeDeptMoveModal() {
    if (!el.deptMoveModal) return;
    el.deptMoveModal.hidden = true;
    _deptMoveState.sourceDept = null;
    _deptMoveState.candidates = [];
    _deptMoveState.selectedIds = {};
  }

  function refreshDeptMoveTargetSelect() {
    if (!el.deptMoveTarget) return;
    var current = el.deptMoveTarget.value;
    el.deptMoveTarget.innerHTML = '';

    var optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '선택하세요';
    el.deptMoveTarget.appendChild(optEmpty);

    // 소속 옵션 + "(소속 없음)"
    _departmentOptions.forEach(function (d) {
      if (d === _deptMoveState.sourceDept) return;  // 원래 소속 제외
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      el.deptMoveTarget.appendChild(opt);
    });

    // "(소속 없음)" 옵션 — 소속을 비워버리는 용도
    var optNone = document.createElement('option');
    optNone.value = '__NONE__';
    optNone.textContent = '(소속 없음)';
    el.deptMoveTarget.appendChild(optNone);

    if (current) el.deptMoveTarget.value = current;
  }

  function renderDeptMoveList() {
    if (!el.deptMoveList) return;

    var list = _deptMoveState.candidates;
    el.deptMoveList.innerHTML = '';

    list.forEach(function (p) {
      var item = document.createElement('label');
      item.className = 'dept-move-person-item';
      item.setAttribute('data-person-id', p.id);

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!_deptMoveState.selectedIds[p.id];

      var nameSpan = document.createElement('span');
      nameSpan.className = 'dept-move-person-item-name';
      nameSpan.textContent = p.name || '-';

      var subSpan = document.createElement('span');
      subSpan.className = 'dept-move-person-item-sub';
      subSpan.textContent = p.company || '';

      cb.addEventListener('change', function () {
        if (cb.checked) {
          _deptMoveState.selectedIds[p.id] = true;
          item.classList.add('checked');
        } else {
          delete _deptMoveState.selectedIds[p.id];
          item.classList.remove('checked');
        }
        updateDeptMoveCount();
      });

      item.appendChild(cb);
      item.appendChild(nameSpan);
      item.appendChild(subSpan);
      if (cb.checked) item.classList.add('checked');

      el.deptMoveList.appendChild(item);
    });

    updateDeptMoveCount();
  }

  function updateDeptMoveCount() {
    var selected = Object.keys(_deptMoveState.selectedIds).length;
    var total = _deptMoveState.candidates.length;
    if (el.deptMoveSelectedCount) el.deptMoveSelectedCount.textContent = selected;
    if (el.deptMoveTotalCount) el.deptMoveTotalCount.textContent = total;
  }

  function onDeptMoveSelectAll() {
    var allSelected = Object.keys(_deptMoveState.selectedIds).length === _deptMoveState.candidates.length;
    if (allSelected) {
      _deptMoveState.selectedIds = {};
    } else {
      _deptMoveState.candidates.forEach(function (p) {
        _deptMoveState.selectedIds[p.id] = true;
      });
    }
    renderDeptMoveList();
  }

  function onDeptMoveTargetNew() {
    var name = window.prompt('새 소속명을 입력하세요:', '');
    if (!name) return;
    name = name.trim();
    if (!name) return;

    // 옵션에 추가하고 선택
    var exists = false;
    for (var i = 0; i < el.deptMoveTarget.options.length; i++) {
      if (el.deptMoveTarget.options[i].value === name) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      // (소속 없음) 옵션 앞에 추가
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      // __NONE__ 위치 찾아서 그 앞에 삽입
      var noneOpt = null;
      for (var j = 0; j < el.deptMoveTarget.options.length; j++) {
        if (el.deptMoveTarget.options[j].value === '__NONE__') {
          noneOpt = el.deptMoveTarget.options[j];
          break;
        }
      }
      if (noneOpt) {
        el.deptMoveTarget.insertBefore(opt, noneOpt);
      } else {
        el.deptMoveTarget.appendChild(opt);
      }
    }
    el.deptMoveTarget.value = name;
  }

  function onDeptMoveApply() {
    if (!el.deptMoveTarget) return;
    var target = el.deptMoveTarget.value;
    if (!target) {
      alert('이동할 소속을 선택해 주세요.');
      try { el.deptMoveTarget.focus(); } catch (e) {}
      return;
    }

    var selectedIds = Object.keys(_deptMoveState.selectedIds);
    if (selectedIds.length === 0) {
      alert('이동할 인력을 한 명 이상 선택해 주세요.');
      return;
    }

    var sourceDept = _deptMoveState.sourceDept;
    var newDept = (target === '__NONE__') ? null : target;
    var newDeptLabel = (newDept === null) ? '(소속 없음)' : newDept;

    var msg = ''
      + '"' + sourceDept + '" 소속의 ' + selectedIds.length + '명을\n'
      + '"' + newDeptLabel + '"(으)로 이동할까요?';
    if (!confirm(msg)) return;

    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요.');
      return;
    }

    var nowISO = new Date().toISOString();
    var selectedSet = {};
    selectedIds.forEach(function (id) { selectedSet[id] = true; });

    var updated = _persons.map(function (p) {
      if (!p) return p;
      if (selectedSet[p.id]) {
        var newP = Object.assign({}, p);
        newP.department = newDept;
        newP.updatedAt = nowISO;
        return newP;
      }
      return p;
    });

    svc.savePersons(updated).then(function () {
      closeDeptMoveModal();
      renderDeptManageList();  // 소속 관리 목록도 갱신 (인원 수 변경)
      refreshDepartmentSelect();
    }).catch(function (err) {
      console.error('일괄 이동 실패:', err);
      alert('이동에 실패했어요. ' + (err && err.message ? err.message : ''));
    });
  }

  function onDeptMoveOverlayClick(e) {
    if (e.target === el.deptMoveModal) closeDeptMoveModal();
  }

  function onDeptManageOverlayClick(e) {
    if (e.target === el.deptManageModal) closeDeptManageModal();
  }

  function bindModalEvents() {
    if (el.modalClose)  el.modalClose.addEventListener('click', closeModal);
    if (el.modalCancel) el.modalCancel.addEventListener('click', closeModal);
    if (el.modalSave)   el.modalSave.addEventListener('click', onModalSave);
    if (el.modal) {
      el.modal.addEventListener('click', onModalOverlayClick);
      document.addEventListener('keydown', onModalKeydown);
    }

    // 학위/연구소 등록일 Y/M/D 자동 이동
    attachNumericAutoMove([el.formDegreeY, el.formDegreeM, el.formDegreeD]);
    attachNumericAutoMove([el.formLabY, el.formLabM, el.formLabD]);

    // 연구소 등록 체크박스 → 등록일 행 토글
    if (el.formIsLabRegistered) {
      el.formIsLabRegistered.addEventListener('change', updateLabDateRow);
    }

    // 부서 추가 버튼
    if (el.formDepartmentAddBtn) {
      el.formDepartmentAddBtn.addEventListener('click', onDepartmentAddClick);
    }

    // 부서 관리 버튼
    if (el.formDepartmentManageBtn) {
      el.formDepartmentManageBtn.addEventListener('click', openDeptManageModal);
    }

    // 직급 추가 버튼
    if (el.formPositionAddBtn) {
      el.formPositionAddBtn.addEventListener('click', onPositionAddClick);
    }

    // 직급 관리 버튼
    if (el.formPositionManageBtn) {
      el.formPositionManageBtn.addEventListener('click', openPositionManageModal);
    }

    // 소속 관리 모달
    if (el.deptManageClose) {
      el.deptManageClose.addEventListener('click', closeDeptManageModal);
    }
    if (el.deptManageModal) {
      el.deptManageModal.addEventListener('click', onDeptManageOverlayClick);
    }
    if (el.deptManageList) {
      el.deptManageList.addEventListener('click', onDeptManageClick);
    }

    // 인력 일괄 이동 모달
    if (el.deptMoveClose)        el.deptMoveClose.addEventListener('click', closeDeptMoveModal);
    if (el.deptMoveCancel)       el.deptMoveCancel.addEventListener('click', closeDeptMoveModal);
    if (el.deptMoveApply)        el.deptMoveApply.addEventListener('click', onDeptMoveApply);
    if (el.deptMoveSelectAll)    el.deptMoveSelectAll.addEventListener('click', onDeptMoveSelectAll);
    if (el.deptMoveTargetNewBtn) el.deptMoveTargetNewBtn.addEventListener('click', onDeptMoveTargetNew);
    if (el.deptMoveModal)        el.deptMoveModal.addEventListener('click', onDeptMoveOverlayClick);

    // 자격증 (Step 4-2)
    if (el.formCertificateAddBtn) {
      el.formCertificateAddBtn.addEventListener('click', addCertificateRow);
    }
    if (el.formCertificatesList) {
      // 삭제 버튼 (이벤트 위임)
      el.formCertificatesList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action="delete-cert"]');
        if (!btn) return;
        var certId = btn.getAttribute('data-cert-id');
        deleteCertificateRow(certId);
      });
      // input 변경 (이벤트 위임)
      el.formCertificatesList.addEventListener('input', function (e) {
        var input = e.target;
        if (!input.classList.contains('form-cert-name')
         && !input.classList.contains('form-cert-url')
         && !input.classList.contains('form-cert-memo')) return;
        var item = input.closest('.form-cert-item');
        if (!item) return;
        var certId = item.getAttribute('data-cert-id');
        var field = input.getAttribute('data-field');
        if (!certId || !field) return;
        updateCertificateField(certId, field, input.value);
      });
    }
  }

  // ====================================================================
  // 일괄 다운로드 / 업로드 (상세 정보 전용)
  // ====================================================================
  //
  // 정책:
  // - 다운로드는 마스터 정보(회사·이름·생년월일·입사일·퇴사일)를 읽기 전용 참고용으로 같이 표시
  // - 업로드 시 마스터 필드는 절대 덮어쓰지 않음 (persons-master 책임)
  // - 매칭은 id 기준. id 없는 행은 무시 (신규 인력 추가는 persons-master에서)
  // - 빈 셀은 기존 값 유지 (덮어쓰지 않음).
  //   ※ 단 메모/주소/이메일/핸드폰처럼 사용자가 의도적으로 비울 수 있는 필드는
  //     "셀이 명시적으로 빈 문자열"이면 빈값 저장 — persons-master 패턴과 동일
  // - 자격증은 콤마로 구분된 이름 문자열 ("정보처리기사, 정보보안기사")
  //   → 기존 자격증과 합치지 않고 통째로 교체 (URL/메모는 자격증 페이지나 모달에서 따로 입력)

  var DETAIL_BULK_COLUMNS = [
    { key: 'no',           header: 'No',                width: 5,  readonly: true },
    { key: 'id',           header: 'id (수정금지)',      width: 22, readonly: true },
    // 참고용 (마스터 정보)
    { key: 'company',      header: '회사',               width: 10, readonly: true },
    { key: 'name',         header: '이름',               width: 12, readonly: true },
    { key: 'birthDate',    header: '생년월일',           width: 12, readonly: true },
    { key: 'hireDate',     header: '입사일',             width: 12, readonly: true },
    { key: 'exitDate',     header: '퇴사일',             width: 12, readonly: true },
    // 수정 대상 (상세 정보)
    { key: 'department',   header: '소속',               width: 14 },
    { key: 'position',     header: '직급',               width: 12 },
    { key: 'finalDegree',  header: '최종학위',           width: 10 },
    { key: 'school',       header: '학교',               width: 18 },
    { key: 'major',        header: '전공',               width: 18 },
    { key: 'degreeNumber', header: '학위번호',           width: 16 },
    { key: 'degreeDate',   header: '학위 수여일',         width: 12 },
    { key: 'researcherId', header: '연구자번호',         width: 16 },
    { key: 'phone',        header: '핸드폰',             width: 14 },
    { key: 'email',        header: '이메일',             width: 22 },
    { key: 'address',      header: '주소',               width: 30 },
    { key: 'certificates', header: '자격증(콤마 구분)',   width: 30 },
    { key: 'hrMemo',       header: '메모',               width: 25 }
  ];

  /**
   * 자격증 배열 → 콤마 구분 문자열 (다운로드용)
   * "정보처리기사, 정보보안기사, AWS SAA"
   */
  function certsToCommaString(certs) {
    if (!Array.isArray(certs)) return '';
    return certs
      .filter(function (c) { return c && c.name; })
      .map(function (c) { return String(c.name).trim(); })
      .filter(function (n) { return !!n; })
      .join(', ');
  }

  /**
   * 콤마 구분 문자열 → 자격증 배열 (업로드용)
   * "정보처리기사, 정보보안기사" → [{id, name, url:null, memo:null, createdAt}, ...]
   * 빈 문자열이나 공백뿐인 항목은 제외.
   * 같은 이름이 여러 번 나오면 중복 제거.
   */
  function commaStringToCerts(s) {
    if (s == null) return [];
    var str = String(s).trim();
    if (!str) return [];
    var nowIso = new Date().toISOString();
    var seen = {};
    var result = [];
    str.split(',').forEach(function (raw) {
      var name = String(raw).trim();
      if (!name) return;
      if (seen[name]) return;
      seen[name] = true;
      result.push({
        id: 'cert_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + result.length,
        name: name,
        url: null,
        memo: null,
        createdAt: nowIso
      });
    });
    return result;
  }

  /**
   * 현재 _persons 리스트를 다운로드용 행으로 변환.
   * 회사 → 이름 순 정렬.
   */
  function buildDetailBulkRows(persons) {
    var companyOrder = { '식스티': 0, '굿뉴스': 1, '패리티': 2 };
    var sorted = (persons || []).slice().sort(function (a, b) {
      var ca = companyOrder[a && a.company] != null ? companyOrder[a.company] : 99;
      var cb = companyOrder[b && b.company] != null ? companyOrder[b.company] : 99;
      if (ca !== cb) return ca - cb;
      var na = (a && a.name) || '';
      var nb = (b && b.name) || '';
      return na.localeCompare(nb, 'ko');
    });

    return sorted.map(function (p, idx) {
      return {
        no: idx + 1,
        id: p.id || '',
        company: p.company || '',
        name: p.name || '',
        birthDate: p.birthDate || '',
        hireDate: p.hireDate || '',
        exitDate: p.exitDate || '',
        department: p.department || '',
        position: p.position || '',
        finalDegree: p.finalDegree || '',
        school: p.school || '',
        major: p.major || '',
        degreeNumber: p.degreeNumber || '',
        degreeDate: p.degreeDate || '',
        researcherId: p.researcherId || '',
        phone: p.phone || '',
        email: p.email || '',
        address: p.address || '',
        certificates: certsToCommaString(p.certificates),
        hrMemo: p.hrMemo || ''
      };
    });
  }

  function downloadDetailBulkExcel() {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.');
      return;
    }

    var rows = buildDetailBulkRows(_persons);
    if (!rows.length) {
      alert('다운로드할 인력이 없습니다.');
      return;
    }

    var headers = DETAIL_BULK_COLUMNS.map(function (c) { return c.header; });
    var data = [headers];
    rows.forEach(function (r) {
      data.push(DETAIL_BULK_COLUMNS.map(function (c) { return r[c.key]; }));
    });

    var ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = DETAIL_BULK_COLUMNS.map(function (c) { return { wch: c.width }; });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '인력 상세');

    var d = new Date();
    var ymd = d.getFullYear()
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, '인력_상세_' + ymd + '.xlsx');
  }

  /**
   * 업로드 파일 파싱 → row 배열
   * 헤더 텍스트로 컬럼 인덱스 매핑하므로 컬럼 순서가 바뀌어도 OK.
   */
  function parseDetailBulkFile(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === 'undefined') {
        reject(new Error('엑셀 라이브러리를 불러올 수 없습니다.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          var workbook = XLSX.read(data, { type: 'array', cellDates: true });
          var firstSheet = workbook.SheetNames[0];
          if (!firstSheet) { resolve([]); return; }
          var sheet = workbook.Sheets[firstSheet];
          var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!rows.length) { resolve([]); return; }

          // 헤더 매핑
          var headerRow = rows[0];
          var colIdx = {};
          DETAIL_BULK_COLUMNS.forEach(function (c) { colIdx[c.key] = -1; });
          headerRow.forEach(function (cell, idx) {
            var h = String(cell == null ? '' : cell).trim();
            DETAIL_BULK_COLUMNS.forEach(function (c) {
              if (colIdx[c.key] < 0 && c.header === h) colIdx[c.key] = idx;
            });
          });

          if (colIdx.id < 0) {
            reject(new Error(
              '엑셀 형식이 올바르지 않습니다.\n\n' +
              '"id (수정금지)" 컬럼이 필요해요.\n' +
              '"전체 다운로드" 버튼으로 받은 양식을 사용해 주세요.'
            ));
            return;
          }

          var getCell = function (row, key) {
            if (colIdx[key] < 0) return '';
            var v = row[colIdx[key]];
            return v == null ? '' : String(v);
          };
          var getCellTrimmed = function (row, key) { return getCell(row, key).trim(); };

          var result = [];
          for (var r = 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            var id = getCellTrimmed(row, 'id');
            if (!id) continue;  // id 없는 행은 무시

            // 학위 수여일: 엑셀 날짜 또는 'YYYY-MM-DD' 문자열 가능
            var degreeDate = null;
            var rawDeg = colIdx.degreeDate >= 0 ? row[colIdx.degreeDate] : null;
            if (rawDeg instanceof Date && !isNaN(rawDeg.getTime())) {
              degreeDate = rawDeg.getFullYear() + '-'
                + String(rawDeg.getMonth() + 1).padStart(2, '0') + '-'
                + String(rawDeg.getDate()).padStart(2, '0');
            } else if (rawDeg) {
              var s = String(rawDeg).trim();
              // YYYY-MM-DD 형식만 인정 (그 외엔 그냥 trim된 문자열로 — 사용자가 형식 맞춰서 넣어야)
              if (/^\d{4}-\d{2}-\d{2}/.test(s)) degreeDate = s.slice(0, 10);
            }

            result.push({
              id: id,
              _rowNum: r + 1,
              department:   getCellTrimmed(row, 'department'),
              position:     getCellTrimmed(row, 'position'),
              finalDegree:  normalizeDegreeInput(getCellTrimmed(row, 'finalDegree')),
              school:       getCellTrimmed(row, 'school'),
              major:        getCellTrimmed(row, 'major'),
              degreeNumber: getCellTrimmed(row, 'degreeNumber'),
              degreeDate:   degreeDate,
              researcherId: getCellTrimmed(row, 'researcherId'),
              phone:        getCellTrimmed(row, 'phone'),
              email:        getCellTrimmed(row, 'email'),
              address:      getCellTrimmed(row, 'address'),
              certificates: getCell(row, 'certificates'),  // 콤마 구분 문자열 그대로 (trim은 분리할 때)
              hrMemo:       getCellTrimmed(row, 'hrMemo'),
              // 셀이 비어있었는지 추적 (빈 셀은 기존값 유지하기 위함)
              _isEmpty: (function () {
                var map = {};
                ['department','position','finalDegree','school','major','degreeNumber',
                 'researcherId','phone','email','address','hrMemo','certificates'].forEach(function (k) {
                  map[k] = !getCellTrimmed(row, k);
                });
                map.degreeDate = !degreeDate;
                return map;
              })()
            });
          }
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 업로드 행을 _persons에 머지
   * - id로 매칭. 없는 id는 에러로 표시
   * - 빈 셀은 기존값 유지
   * - 자격증은 빈 셀이면 유지, 비어있지 않으면 콤마 분리해서 교체
   */
  function buildDetailBulkUpdateList(editedRows, current) {
    var list = (current || []).slice();
    var idToPerson = {};
    list.forEach(function (p) { if (p && p.id) idToPerson[p.id] = p; });

    var updated = 0, skipped = 0, errors = [];

    editedRows.forEach(function (row) {
      var existing = idToPerson[row.id];
      if (!existing) {
        errors.push('행 ' + row._rowNum + ': id "' + row.id + '"에 해당하는 인력을 찾을 수 없어요.');
        return;
      }

      var changed = false;

      // 일반 텍스트 필드 — 빈 셀이면 유지, 값 있으면 덮어쓰기
      ['department','position','finalDegree','school','major','degreeNumber',
       'researcherId','phone','email','address','hrMemo'].forEach(function (k) {
        if (row._isEmpty[k]) return;
        if ((existing[k] || '') !== row[k]) {
          existing[k] = row[k];
          changed = true;
        }
      });

      // 학위 수여일
      if (!row._isEmpty.degreeDate) {
        if ((existing.degreeDate || '') !== row.degreeDate) {
          existing.degreeDate = row.degreeDate;
          changed = true;
        }
      }

      // 자격증 — 콤마 구분 문자열 → 배열로 교체
      if (!row._isEmpty.certificates) {
        var newCerts = commaStringToCerts(row.certificates);
        var oldCertNames = certsToCommaString(existing.certificates);
        var newCertNames = certsToCommaString(newCerts);
        if (oldCertNames !== newCertNames) {
          // 기존 자격증 중 같은 이름이 있으면 URL/memo는 살리고 createdAt도 보존
          var oldByName = {};
          (existing.certificates || []).forEach(function (c) {
            if (c && c.name) oldByName[c.name] = c;
          });
          newCerts = newCerts.map(function (nc) {
            var old = oldByName[nc.name];
            if (old) {
              return {
                id: old.id || nc.id,
                name: nc.name,
                url: old.url || null,
                memo: old.memo || null,
                createdAt: old.createdAt || nc.createdAt
              };
            }
            return nc;
          });
          existing.certificates = newCerts;
          changed = true;
        }
      }

      if (changed) {
        existing.updatedAt = new Date().toISOString();
        updated++;
      } else {
        skipped++;
      }
    });

    return {
      list: list,
      summary: {
        updated: updated,
        skipped: skipped,
        total: editedRows.length,
        errors: errors
      }
    };
  }

  function onBulkDownloadClick() {
    downloadDetailBulkExcel();
  }

  // 일괄 업데이트 버튼 — 파일 선택 input을 트리거
  var BULK_EDIT_BTN_INNER_HTML = '';
  function onBulkEditBtnClick() {
    if (!el.bulkEditInput) return;
    el.bulkEditInput.value = '';
    el.bulkEditInput.click();
  }

  function onBulkEditFileChange(e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    handleBulkEditUpload(file);
  }

  function handleBulkEditUpload(file) {
    var svc = window.firestoreService;
    if (!svc || typeof svc.savePersons !== 'function') {
      alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }

    if (el.bulkEditBtn) {
      el.bulkEditBtn.disabled = true;
      el.bulkEditBtn.textContent = '업로드 중…';
    }

    parseDetailBulkFile(file).then(function (rows) {
      if (!rows.length) {
        throw new Error('엑셀에서 인력 데이터를 찾지 못했어요. id 컬럼이 채워져 있는지 확인해 주세요.');
      }

      var merged = buildDetailBulkUpdateList(rows, _persons);
      var s = merged.summary;

      var msgParts = [];
      msgParts.push('총 ' + s.total + '개 행을 읽었어요.');
      if (s.updated) msgParts.push('• 업데이트: ' + s.updated + '명');
      if (s.skipped) msgParts.push('• 변경 없음(건너뜀): ' + s.skipped + '명');
      if (s.errors && s.errors.length) {
        msgParts.push('');
        msgParts.push('⚠️ ' + s.errors.length + '개 행에 문제가 있어요:');
        s.errors.slice(0, 10).forEach(function (er) { msgParts.push('  - ' + er); });
        if (s.errors.length > 10) msgParts.push('  ... 외 ' + (s.errors.length - 10) + '건');
      }

      if (s.updated === 0) {
        msgParts.push('');
        msgParts.push('적용할 변경사항이 없어서 저장하지 않았어요.');
        alert(msgParts.join('\n'));
        return null;
      }

      msgParts.push('');
      msgParts.push('저장할까요?');

      if (!confirm(msgParts.join('\n'))) {
        return null;
      }

      return svc.savePersons(merged.list).then(function () {
        var resultParts = ['일괄 업데이트 완료'];
        if (s.updated) resultParts.push('  업데이트 ' + s.updated + '명');
        alert(resultParts.join('\n'));
      });
    }).catch(function (err) {
      console.error('일괄 업데이트 실패:', err);
      alert((err && err.message) ? err.message : '일괄 업데이트에 실패했어요.');
    }).then(function () {
      if (el.bulkEditBtn) {
        el.bulkEditBtn.disabled = false;
        el.bulkEditBtn.innerHTML = BULK_EDIT_BTN_INNER_HTML || '⬆️ 일괄 업데이트';
      }
    });
  }

  // ====================================================================
  // 이벤트 핸들러 (검색/필터/테이블)
  // ====================================================================
  function onSearchInput() {
    _filter.keyword = (el.search.value || '').trim();
    if (el.searchClear) {
      el.searchClear.style.display = _filter.keyword ? '' : 'none';
    }
    render();
  }

  function onSearchClear() {
    if (el.search) el.search.value = '';
    _filter.keyword = '';
    if (el.searchClear) el.searchClear.style.display = 'none';
    render();
  }

  function onFilterStatusChange() {
    _filter.status = el.filterStatus.value || 'all';
    render();
  }
  function onFilterCompanyChange() {
    // CompanyFilter (회사 칩)로부터 호출됨. 인자: '' (전체) | '식스티' | '굿뉴스' | '패리티'
    var company = (window.CompanyFilter && window.CompanyFilter.get) ? window.CompanyFilter.get() : '';
    _filter.company = company || 'all';
    render();
  }
  function onFilterDegreeChange() {
    _filter.degree = el.filterDegree.value || 'all';
    render();
  }
  function onFilterLabChange() {
    _filter.labOnly = !!el.filterLab.checked;
    render();
  }

  function onTableClick(e) {
    // 수정 버튼 클릭 → 모달 열기
    var editBtn = e.target.closest && e.target.closest('button[data-action="edit"]');
    if (editBtn) {
      e.stopPropagation();
      var id = editBtn.getAttribute('data-person-id');
      var person = findPersonById(id);
      if (person) {
        selectPerson(id);  // 선택도 같이
        openModal(person);
      }
      return;
    }

    // 행 클릭 → 선택 (우측 패널 표시)
    var tr = e.target.closest && e.target.closest('tr[data-person-id]');
    if (tr) {
      var personId = tr.getAttribute('data-person-id');
      if (personId) selectPerson(personId);
    }
  }

  function onDetailPanelClick(e) {
    // 우측 패널의 "닫기" 버튼 — 선택 해제
    var closeBtn = e.target.closest && e.target.closest('button[data-action="close-detail"]');
    if (closeBtn) {
      // 테이블 행의 selected 클래스도 지움
      if (el.tbody) {
        var rows = el.tbody.querySelectorAll('tr.selected');
        rows.forEach(function (tr) { tr.classList.remove('selected'); });
      }
      _selectedPersonId = null;
      renderDetailPanel();
      return;
    }

    // 우측 패널의 "수정" 버튼
    var btn = e.target.closest && e.target.closest('button[data-action="edit-from-detail"]');
    if (btn) {
      var id = btn.getAttribute('data-person-id');
      var person = findPersonById(id);
      if (person) openModal(person);
    }
  }

  function bindEvents() {
    if (el.search)         el.search.addEventListener('input', onSearchInput);
    if (el.searchClear)    el.searchClear.addEventListener('click', onSearchClear);
    if (el.filterStatus)   el.filterStatus.addEventListener('change', onFilterStatusChange);
    if (el.filterDegree)   el.filterDegree.addEventListener('change', onFilterDegreeChange);
    if (el.filterLab)      el.filterLab.addEventListener('change', onFilterLabChange);
    if (el.tbody)          el.tbody.addEventListener('click', onTableClick);
    if (el.detailPanel)    el.detailPanel.addEventListener('click', onDetailPanelClick);
    if (el.bulkDownloadBtn) el.bulkDownloadBtn.addEventListener('click', onBulkDownloadClick);
    if (el.bulkEditBtn)     el.bulkEditBtn.addEventListener('click', onBulkEditBtnClick);
    if (el.bulkEditInput)   el.bulkEditInput.addEventListener('change', onBulkEditFileChange);
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    // DOM 캐시
    el.search        = $('person-search');
    el.searchClear   = $('search-clear');
    el.searchWrap    = $('search-wrap');

    el.filterStatus     = $('filter-status');
    el.filterDegree     = $('filter-degree');
    el.filterLab        = $('filter-lab');

    el.statTotal         = $('stat-total');
    el.statActive        = $('stat-active');
    el.statExited        = $('stat-exited');
    el.statTotalSub      = $('stat-total-sub');
    el.statHrComplete    = $('stat-hr-complete');
    el.statHrCompleteSub = $('stat-hr-complete-sub');
    el.statLab           = $('stat-lab');

    el.bulkDownloadBtn = $('bulk-download-btn');
    el.bulkEditBtn     = $('bulk-edit-btn');
    el.bulkEditInput   = $('bulk-edit-input');
    if (el.bulkEditBtn) BULK_EDIT_BTN_INNER_HTML = el.bulkEditBtn.innerHTML;

    el.tbody       = $('persons-tbody');
    el.tableWrap   = $('persons-table-wrap');
    el.empty       = $('persons-empty');
    el.countHint   = $('person-count-hint');

    el.detailPanel      = $('detail-panel');
    el.detailEmptyState = $('detail-empty-state');
    el.detailContent    = $('detail-content');

    // 모달
    el.modal       = $('person-modal');
    el.modalTitle  = $('person-modal-title');
    el.modalClose  = $('person-modal-close');
    el.modalCancel = $('person-modal-cancel');
    el.modalSave   = $('person-modal-save');
    el.formError   = $('form-error');

    // 폼 필드
    el.formDepartment          = $('form-department');
    el.formDepartmentAddBtn    = $('form-department-add-btn');
    el.formDepartmentManageBtn = $('form-department-manage-btn');
    el.formPosition            = $('form-position');
    el.formPositionAddBtn      = $('form-position-add-btn');
    el.formPositionManageBtn   = $('form-position-manage-btn');
    el.formFinalDegree         = $('form-final-degree');
    el.formSchool              = $('form-school');
    el.formMajor               = $('form-major');
    el.formDegreeNumber        = $('form-degree-number');
    el.formDegreeY             = $('form-degree-y');
    el.formDegreeM             = $('form-degree-m');
    el.formDegreeD             = $('form-degree-d');
    el.formResearcherId        = $('form-researcher-id');
    el.formIsLabRegistered     = $('form-is-lab-registered');  // 제거됨 — null
    el.formLabDateRow          = $('form-lab-date-row');       // 제거됨 — null
    el.formLabY                = $('form-lab-y');               // 제거됨 — null
    el.formLabM                = $('form-lab-m');               // 제거됨 — null
    el.formLabD                = $('form-lab-d');               // 제거됨 — null
    el.formLabStatus           = $('form-lab-status');          // 새로 추가 (자동 표시)
    el.formPhone               = $('form-phone');
    el.formEmail               = $('form-email');
    el.formAddress             = $('form-address');
    el.formHrMemo              = $('form-hr-memo');
    // 자격증 (Step 4-2)
    el.formCertificatesList    = $('form-certificates-list');
    el.formCertificateAddBtn   = $('form-certificate-add-btn');

    // 소속 관리 모달
    el.deptManageModal = $('dept-manage-modal');
    el.deptManageClose = $('dept-manage-close');
    el.deptManageList  = $('dept-manage-list');
    el.deptManageEmpty = $('dept-manage-empty');

    // 인력 일괄 이동 모달
    el.deptMoveModal         = $('dept-move-modal');
    el.deptMoveClose         = $('dept-move-close');
    el.deptMoveCancel        = $('dept-move-cancel');
    el.deptMoveApply         = $('dept-move-apply');
    el.deptMoveSourceName    = $('dept-move-source-name');
    el.deptMoveTarget        = $('dept-move-target');
    el.deptMoveTargetNewBtn  = $('dept-move-target-new-btn');
    el.deptMoveList          = $('dept-move-list');
    el.deptMoveSelectAll     = $('dept-move-select-all');
    el.deptMoveSelectedCount = $('dept-move-selected-count');
    el.deptMoveTotalCount    = $('dept-move-total-count');

    bindEvents();
    bindModalEvents();

    // 회사 필터 칩 (전 페이지 공유)
    if (window.CompanyFilter) {
      var savedCompany = window.CompanyFilter.get();
      _filter.company = savedCompany || 'all';
      window.CompanyFilter.mountChips('pd-company-chips', onFilterCompanyChange);
    }

    // Firestore 구독
    if (window.firestoreService && typeof window.firestoreService.subscribePersons === 'function') {
      var _migrationDone = false;
      window.firestoreService.subscribePersons(function (list) {
        _persons = Array.isArray(list) ? list : [];
        // 첫 로드 시 1회 마이그레이션 (학위 표기 정규화)
        if (!_migrationDone && _persons.length > 0) {
          _migrationDone = true;
          migrateDegreeNormalization(_persons);
        }
        render();
      });
    } else {
      console.error('firestoreService.subscribePersons 가 없어요');
    }

    // 기업부설연구소 등록 데이터 구독 (Step 4-1)
    // lab.html에서 명단 업데이트되면 이쪽도 자동 반영
    if (window.firestoreService && typeof window.firestoreService.subscribeLabRegistrations === 'function') {
      window.firestoreService.subscribeLabRegistrations(function () {
        // 데이터 자체는 firestoreService 내부에 캐시됨. 다시 렌더만 하면 됨.
        render();
        // 모달이 열려있고 현재 편집 person이 있으면 자동 표시도 갱신
        if (_editingPerson) {
          updateLabStatusDisplay(_editingPerson);
        }
      });
    }
  }

  // DOM 준비되면 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();


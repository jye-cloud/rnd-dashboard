/**
 * 인력 마스터 (persons-master.html) 페이지 로직 — Step 2-2 보완
 *
 * 주요 기능:
 *  - Firestore의 persons 컬렉션 실시간 구독
 *  - 목록 렌더링 / 검색 / 상태 필터 / 청년 필터
 *  - 인력 추가/수정/삭제 모달 (Y/M/D 3칸 분리 입력 + 자동 이동)
 *  - 건강보험가입자명부 엑셀 업로드 → 인력 자동 등록/업데이트
 *  - 생년월일 미입력 인력 마이그레이션 경고 배너
 *
 * 인력 항목 구조:
 *   { id, name, birthDate, hireDate, exitDate, isYouth,
 *     annualSalary, monthlySalary, memo, status, createdAt, updatedAt }
 *
 * - birthDate(생년월일)는 신규 등록 시 필수, 동명이인 구분에 사용 (이름+생년월일 조합 유일)
 * - 입사일/퇴사일/생년월일은 'YYYY-MM-DD' ISO 문자열로 저장
 * - annualSalary 입력 시 monthlySalary는 자동으로 Math.ceil(연봉/12)로 같이 저장됨
 *   (원 단위 무조건 올림. 예: 85,000,000 / 12 = 7,083,333.33 → 7,083,334)
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];               // Firestore에서 받아온 원본 배열

  // ====================================================================
  // 연봉 슬롯 (공유 슬롯) — '실제'(annualSalary) 외 용도별 연봉
  //   저장: person.salarySlots = { [슬롯명]: 연봉(원) }  (월급은 사용처에서 ceil/12)
  //   가용 슬롯 = 기본 슬롯 ∪ 전체 인력 salarySlots 키 합집합 (별도 설정 문서 없음)
  // ====================================================================
  var DEFAULT_SALARY_SLOTS = ['제안서용(공개 가능)'];
  var _modalSlotNames = [];        // 현재 열린 모달에서 보여줄 슬롯명 목록
  var _modalSalaryChanges = [];    // §4.4: 현재 모달의 연봉 변경 시점 행 [{from, annualSalary}] (편집 중 raw)
  var _filter = {
    keyword: '',                   // 이름 검색
    status: 'active',              // 'all' | 'active' | 'exited'
    company: 'all',                // 'all' | '식스티' | '굿뉴스' | '패리티' | 'unset'
    gender: 'all',                 // 'all' | 'M' | 'F' | 'unknown'
    ageBucket: 'all',              // 'all' | '20' | '30' | '40' | '50' | 'unknown'
    youthOnly: false,              // true면 isYouth=true만
    missingBirthOnly: false        // true면 birthDate 없는 인력만 (마이그레이션 배너 클릭 시)
  };

  // 정렬 상태 (한 번에 한 컬럼만)
  // key: 'age' | 'hireDate' | 'exitDate' | 'monthlySalary' | null(=정렬 없음)
  // dir: 'asc' | 'desc'
  // 클릭 사이클: 없음 → desc → asc → 없음
  var _sort = {
    key: null,
    dir: 'desc'
  };

  // ====================================================================
  // DOM
  // ====================================================================
  var el = {
    tbody: null,
    tableWrap: null,
    empty: null,
    emptyTitle: null,
    emptyDesc: null,
    countHint: null,
    search: null,
    searchWrap: null,
    searchClear: null,
    filterStatus: null,
    filterGender: null,
    filterAge: null,
    filterYouth: null,
    addBtn: null,
    statTotal: null,
    statTotalSub: null,
    statActive: null,
    statActiveSub: null,
    statYouth: null,
    statExited: null,
    // 명부 업로드
    excelInput: null,
    excelUploadBtn: null,
    // 일괄 다운로드/업로드 (현재 명부 기반)
    bulkDownloadBtn: null,
    bulkEditBtn: null,
    bulkEditInput: null,
    // 마이그레이션 배너
    migrationBanner: null,
    migrationBannerText: null,
    // 모달
    modal: null,
    modalTitle: null,
    modalClose: null,
    modalCancel: null,
    modalSave: null,
    modalDelete: null,
    formName: null,
    formError: null,
    formIsYouth: null,
    formAnnualSalary: null,
    annualSalaryHint: null,
    formExitDateRow: null,
    formMemo: null,
    // 성별 라디오 (name="form-gender")
    formGenderNone: null,
    formGenderM: null,
    formGenderF: null,
    // 주민번호 뒷자리
    formSsnTail: null,
    formSsnFront: null,
    ssnTailHint: null,
    // 회사 라디오 (모달 안)
    formCompanySixty: null,
    formCompanyGoodnews: null,
    formCompanyParity: null,
    // 회사 선택 모달 (명부 업로드용)
    companySelectModal: null,
    companySelectClose: null,
    // Y/M/D 입력칸 (각 prefix별로 3개)
    formBirthY: null, formBirthM: null, formBirthD: null,
    formHireY: null,  formHireM: null,  formHireD: null,
    formExitY: null,  formExitM: null,  formExitD: null
  };

  // ====================================================================
  // 유틸
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

  function formatMoney(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '-';
    var v = Math.round(Number(n));
    return v.toLocaleString('ko-KR') + '원';
  }

  function formatDate(s) {
    if (!s) return '-';
    return String(s).slice(0, 10);
  }

  function pad2(v) { return String(v || '').padStart(2, '0'); }

  /**
   * 만나이 계산 (한국 기준).
   * 오늘 날짜 기준으로 생일이 지났으면 (올해-생년), 안 지났으면 (올해-생년-1)
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
    // 생일이 아직 안 지났으면 -1
    if (tm < bm || (tm === bm && td < bd)) age--;

    if (age < 0 || age > 150) return null;  // 비정상 값 방어
    return age;
  }

  /**
   * 만나이를 연령대 구간으로 변환
   * @param {number} age
   * @returns {string} '10' | '20' | '30' | '40' | '50' (50대 이상은 모두 '50')
   */
  function ageToBucket(age) {
    if (age == null || isNaN(age)) return null;
    if (age < 20) return '10';   // 사실상 발생 안 함
    if (age < 30) return '20';
    if (age < 40) return '30';
    if (age < 50) return '40';
    return '50';                 // 50대 이상 모두 묶음
  }

  /**
   * 청년 여부 판정 (v8 일원화: 만 34세 이하 자동 판정만).
   *  - 자동: 만 34세 이하 (정부 R&D 청년 기준), 기준일 = 오늘
   *  - 수동 person.isYouth 플래그는 더 이상 판정에 반영하지 않음 (persons-summary.js 와 통일)
   *    · 군대 등 예외 보정이 필요하면 추후 재추가.
   *
   * @returns {{ youth: boolean, reason: 'auto' | null }}
   */
  function getYouthInfo(person) {
    if (!person) return { youth: false, reason: null };
    var age = computeAge(person.birthDate);
    var auto = (age != null && age <= 34);
    return auto ? { youth: true, reason: 'auto' } : { youth: false, reason: null };
  }

  // ====================================================================
  // 회사 (식스티 / 굿뉴스 / 패리티)
  // ====================================================================
  var COMPANIES = ['식스티', '굿뉴스', '패리티'];
  var COMPANY_FULL_NAMES = {
    '식스티': '식스티헤르츠',
    '굿뉴스': '굿뉴스에너지',
    '패리티': '패리티빌더즈'
  };
  var COMPANY_BADGE_CLASS = {
    '식스티': 'company-badge--sixty',
    '굿뉴스': 'company-badge--goodnews',
    '패리티': 'company-badge--parity'
  };

  function getCompany(person) {
    if (!person) return null;
    var c = person.company;
    if (COMPANIES.indexOf(c) >= 0) return c;
    return null;  // 미지정
  }

  function renderCompanyBadge(company) {
    if (company && COMPANY_BADGE_CLASS[company]) {
      return '<span class="company-badge ' + COMPANY_BADGE_CLASS[company] + '">' + escapeHtml(company) + '</span>';
    }
    return '<span class="company-badge company-badge--unset">미지정</span>';
  }

  /**
   * 겸직 키: 같은 사람을 회사 간 매칭하기 위한 키.
   * 이름 + 생년월일
   * @returns {string | null} 키 또는 매칭에 사용 못할 데이터면 null
   *
   * 정책: 이름과 생년월일이 같으면 동일인으로 봄.
   * - 주민번호 뒷자리는 회사별로 입력 누락이 있을 수 있어서 키에서 제외
   * - 동명이인이 같은 생일을 가질 확률은 낮음 (만약 발생하면 메모로 구분)
   */
  function getMoonlightKey(person) {
    if (!person) return null;
    var name = (person.name || '').trim();
    if (!name) return null;
    var birth = person.birthDate || '';
    // 생년월일이 있어야 매칭 가능 (이름만으로는 동명이인 위험)
    if (!birth) return null;
    return name + '|' + birth;
  }

  /**
   * 전체 persons 배열에서 겸직 관계를 미리 계산.
   *
   * 결과:
   *   { [moonlightKey]: {
   *       persons: [...],            // 같은 사람의 여러 인력 레코드
   *       companies: [...],          // 회사 목록 (중복 제거)
   *       isAdminTransfer: bool      // true면 행정 이관 (메모에 '이동' 포함)
   *   } }
   */
  function computeMoonlightMap(persons) {
    var map = {};
    // 1단계: 키별로 묶기
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
    // 2단계: 같은 키에 2명 이상이면 행정 이관 여부 검사 (메모 기반)
    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (entry.persons.length < 2) return;
      entry.isAdminTransfer = checkAdminTransfer(entry.persons);
    });
    return map;
  }

  /**
   * 행정 이관 검사:
   * 같은 사람 레코드 중 하나라도 메모에 '이동'이 포함되어 있으면 행정 이관으로 판단.
   *
   * 예: 식스티 김지혜의 메모 = "굿뉴스로 이동" → 행정 이관 → 겸직 표시 X
   *
   * 사용자가 메모에 명시적으로 '이동'이라고 적은 경우만 행정 이관으로 처리.
   * 그 외에는 자동으로 모두 겸직으로 판단 (날짜 우연 일치 같은 자동 판별 X).
   */
  function checkAdminTransfer(personsOfSameKey) {
    for (var i = 0; i < personsOfSameKey.length; i++) {
      var memo = (personsOfSameKey[i] && personsOfSameKey[i].memo) || '';
      if (memo.indexOf('이동') >= 0) return true;
    }
    return false;
  }

  /**
   * 특정 인력이 겸직인지 + 어느 회사들과 겸직인지 (자기 자신 제외)
   *
   * 정책:
   * - 식스티가 모회사, 굿뉴스·패리티가 자회사
   * - 식스티 줄: 자회사에도 등록되어 있으면 → 겸직 표시
   * - 자회사 줄: 본업이므로 겸직 표시 안 함
   * - 행정 이관 (메모에 '이동'): 겸직 표시 X
   *
   * 반환:
   * {
   *   isMoonlight: bool,           // 식스티 줄에서 겸직 관계가 있는가
   *   others: string[],            // 같이 다니는 자회사 목록
   *   selfActive: bool,            // 식스티 본인 레코드가 재직 상태인가
   *   subsidiaryActive: bool       // 같은 사람의 자회사 레코드 중 하나라도 재직 중인가
   * }
   */
  function getMoonlightInfo(person, moonlightMap) {
    var key = getMoonlightKey(person);
    if (!key || !moonlightMap[key]) return { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };
    var entry = moonlightMap[key];
    var myCompany = getCompany(person);
    if (!entry.companies || entry.companies.length < 2) {
      return { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };
    }

    // 행정 이관이면 겸직 아님
    if (entry.isAdminTransfer) return { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };

    // 식스티(모회사) 줄에만 겸직 표시
    if (myCompany !== '식스티') return { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };

    var others = entry.companies.filter(function (c) { return c !== myCompany; });

    // 본인(식스티 줄) 재직 여부
    var selfActive = (person.status || 'active') !== 'exited';

    // 같은 사람의 자회사 레코드 중 하나라도 재직 중인지
    var subsidiaryActive = false;
    for (var i = 0; i < entry.persons.length; i++) {
      var rec = entry.persons[i];
      if (!rec) continue;
      if (getCompany(rec) === '식스티') continue;  // 식스티 외(=자회사)만 검사
      if ((rec.status || 'active') !== 'exited') {
        subsidiaryActive = true;
        break;
      }
    }

    return { isMoonlight: true, others: others, selfActive: selfActive, subsidiaryActive: subsidiaryActive };
  }

  /**
   * 데이터 마이그레이션: company가 없는 기존 인력을 모두 '식스티'로 채우기
   * 한 번만 실행되어야 함. _migrationDone 플래그로 방어.
   */
  var _migrationDone = false;
  function migrateCompanyIfNeeded(persons) {
    if (_migrationDone) return null;  // 이미 처리
    if (!Array.isArray(persons) || persons.length === 0) {
      _migrationDone = true;
      return null;
    }
    var needsMigration = persons.filter(function (p) {
      return p && !p.company;
    });
    if (needsMigration.length === 0) {
      _migrationDone = true;
      return null;
    }

    // 마이그레이션 대상 있음 → 자동으로 식스티로 채우고 저장
    var nowISO = new Date().toISOString();
    var updated = persons.map(function (p) {
      if (!p || p.company) return p;
      var newP = Object.assign({}, p);
      newP.company = '식스티';
      newP.updatedAt = nowISO;
      return newP;
    });

    _migrationDone = true;  // 더 이상 실행 안 되도록

    // 비동기 저장 (블로킹 안 함)
    var svc = window.firestoreService;
    if (svc && typeof svc.savePersons === 'function') {
      svc.savePersons(updated).then(function () {
        console.log('[마이그레이션] company 없는 인력 ' + needsMigration.length + '명 → 식스티로 자동 지정됨');
      }).catch(function (err) {
        console.error('[마이그레이션] 저장 실패:', err);
        _migrationDone = false;  // 실패하면 다시 시도할 수 있게
      });
    }
    return updated;
  }

  /**
   * 월급 계산 방식 마이그레이션:
   * 과거 Math.round로 저장된 monthlySalary를 Math.ceil 기준으로 재계산.
   * - annualSalary 있고, monthlySalary가 ceil 결과와 다른 인력만 대상
   * - 1회만 실행 (_monthlySalaryMigrationDone 플래그)
   * 페이지 로드 후 데이터 도착 시점에 1회 자동 실행됨.
   */
  var _monthlySalaryMigrationDone = false;
  function migrateMonthlySalaryIfNeeded(persons) {
    if (_monthlySalaryMigrationDone) return null;
    if (!Array.isArray(persons) || persons.length === 0) {
      _monthlySalaryMigrationDone = true;
      return null;
    }

    var changedList = [];  // 마이그레이션 대상 (이름과 변경 전후 표시용)
    var updated = persons.map(function (p) {
      if (!p) return p;
      if (p.annualSalary == null || isNaN(p.annualSalary)) return p;
      var correctMonthly = Math.ceil(p.annualSalary / 12);
      if (p.monthlySalary === correctMonthly) return p;  // 이미 맞음
      // 다른 값이거나 누락된 경우 → 갱신
      var newP = Object.assign({}, p);
      var oldMonthly = p.monthlySalary;
      newP.monthlySalary = correctMonthly;
      newP.updatedAt = new Date().toISOString();
      changedList.push({
        name: p.name,
        annual: p.annualSalary,
        old: oldMonthly,
        new: correctMonthly
      });
      return newP;
    });

    if (changedList.length === 0) {
      _monthlySalaryMigrationDone = true;
      return null;
    }

    _monthlySalaryMigrationDone = true;  // 더 이상 실행 안 되도록

    var svc = window.firestoreService;
    if (svc && typeof svc.savePersons === 'function') {
      svc.savePersons(updated).then(function () {
        console.log('[월급 마이그레이션] ' + changedList.length + '명의 monthlySalary를 Math.ceil 기준으로 재계산함');
        console.table(changedList);
      }).catch(function (err) {
        console.error('[월급 마이그레이션] 저장 실패:', err);
        _monthlySalaryMigrationDone = false;  // 실패하면 다시 시도할 수 있게
      });
    }
    return updated;
  }

  // ====================================================================
  // 날짜 유틸 (Y/M/D 3칸 ↔ ISO 문자열)
  // app.js 의 buildDateString / setDateParts 패턴 차용
  // ====================================================================

  /**
   * Y/M/D 3칸 값을 'YYYY-MM-DD' 형식으로 변환.
   * - 셋 다 빈 칸이면 null 반환 (정상 — 선택 입력)
   * - 일부만 채워졌거나 유효하지 않은 날짜면 false 반환 (에러 표시용)
   */
  function buildDateString(y, m, d) {
    var yy = String(y || '').trim();
    var mm = String(m || '').trim();
    var dd = String(d || '').trim();

    if (!yy && !mm && !dd) return null;       // 비어있음 = 정상
    if (!yy || !mm || !dd) return false;       // 일부만 = 에러

    if (yy.length !== 4) return false;
    if (mm.length < 1 || mm.length > 2) return false;
    if (dd.length < 1 || dd.length > 2) return false;

    mm = mm.padStart(2, '0');
    dd = dd.padStart(2, '0');

    var iso = yy + '-' + mm + '-' + dd;
    var date = new Date(iso);
    if (isNaN(date.getTime())) return false;

    var actual = date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
    if (actual !== iso) return false;

    return iso;
  }

  /**
   * 'YYYY-MM-DD' → 각각 Y/M/D 칸에 채우기
   */
  function setDateParts(yEl, mEl, dEl, isoDate) {
    if (!yEl || !mEl || !dEl) return;
    if (!isoDate) {
      yEl.value = '';
      mEl.value = '';
      dEl.value = '';
      return;
    }
    var parts = String(isoDate).split('-');
    yEl.value = parts[0] || '';
    mEl.value = parts[1] || '';
    dEl.value = parts[2] || '';
  }

  /**
   * 3칸 입력 자동 이동 + 백스페이스 처리.
   * app.js 의 attachNumericAutoMove 와 동일한 동작.
   */
  function attachNumericAutoMove(inputs) {
    inputs.forEach(function (elInput, idx) {
      if (!elInput) return;

      elInput.addEventListener('input', function () {
        var max = Number(elInput.getAttribute('maxlength') || '0');
        var digitsOnly = elInput.value.replace(/[^0-9]/g, '');
        elInput.value = max ? digitsOnly.slice(0, max) : digitsOnly;

        if (max && elInput.value.length === max) {
          var next = inputs[idx + 1];
          if (next) next.focus();
        }
      });

      elInput.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && elInput.value.length === 0) {
          var prev = inputs[idx - 1];
          if (prev) {
            prev.focus();
            try {
              var v = prev.value;
              prev.setSelectionRange(v.length, v.length);
            } catch (err) {}
          }
        }
      });
    });
  }

  // ====================================================================
  // 엑셀 파싱 (app.js 패턴 차용 — 명부 업로드)
  // ====================================================================

  function cellMatchesKeyword(cell, keywords) {
    var normalized = String(cell != null ? cell : '').trim().replace(/\s+/g, '').toLowerCase();
    if (!normalized) return false;
    return keywords.some(function (k) {
      var kw = k.replace(/\s+/g, '').toLowerCase();
      return kw && normalized.indexOf(kw) !== -1;
    });
  }

  function findColumnIndexInRow(row, keywords) {
    var len = Array.isArray(row) ? row.length : 0;
    for (var c = 0; c < len; c++) {
      if (cellMatchesKeyword(row[c], keywords)) return c;
    }
    return -1;
  }

  /**
   * 시트 전체를 스캔해서 헤더 행 + 각 컬럼 위치 찾기.
   * 필수: 이름, 자격취득일
   * 선택: 자격상실일, 생년월일, 주민등록번호
   *
   * 명부 형식 예: 주민등록번호 = "820404-2******" (앞6자리: 생년월일, 뒷1자리: 성별 구분)
   */
  function findHeaderRow(rows) {
    var nameKeywords  = ['성명', '이름', 'name'];
    var acqKeywords   = ['자격취득일', '취득일', '입사일'];
    var lossKeywords  = ['자격상실일', '상실일', '퇴사일'];
    var birthKeywords = ['생년월일', '생일', 'birth'];
    var ssnKeywords   = ['주민등록번호', '주민번호', '주민', 'ssn'];

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !Array.isArray(row)) continue;
      var nameCol  = findColumnIndexInRow(row, nameKeywords);
      var acqCol   = findColumnIndexInRow(row, acqKeywords);
      if (nameCol >= 0 && acqCol >= 0) {
        var lossCol  = findColumnIndexInRow(row, lossKeywords);
        var birthCol = findColumnIndexInRow(row, birthKeywords);
        var ssnCol   = findColumnIndexInRow(row, ssnKeywords);
        return {
          headerRowIndex: r,
          nameCol: nameCol, acqCol: acqCol,
          lossCol: lossCol, birthCol: birthCol, ssnCol: ssnCol
        };
      }
    }

    var found = { name: null, acq: null, loss: null, birth: null, ssn: null };
    for (var rr = 0; rr < rows.length; rr++) {
      var rrow = rows[rr];
      if (!rrow || !Array.isArray(rrow)) continue;
      for (var cc = 0; cc < rrow.length; cc++) {
        var cell = rrow[cc];
        if (found.name  === null && cellMatchesKeyword(cell, nameKeywords))  found.name  = { row: rr, col: cc };
        if (found.acq   === null && cellMatchesKeyword(cell, acqKeywords))   found.acq   = { row: rr, col: cc };
        if (found.loss  === null && cellMatchesKeyword(cell, lossKeywords))  found.loss  = { row: rr, col: cc };
        if (found.birth === null && cellMatchesKeyword(cell, birthKeywords)) found.birth = { row: rr, col: cc };
        if (found.ssn   === null && cellMatchesKeyword(cell, ssnKeywords))   found.ssn   = { row: rr, col: cc };
      }
    }
    if (!found.name || !found.acq) return null;

    var maxRow = Math.max(
      found.name.row,
      found.acq.row,
      found.loss  ? found.loss.row  : 0,
      found.birth ? found.birth.row : 0,
      found.ssn   ? found.ssn.row   : 0
    );

    return {
      headerRowIndex: maxRow,
      nameCol:  found.name.col,
      acqCol:   found.acq.col,
      lossCol:  found.loss  ? found.loss.col  : -1,
      birthCol: found.birth ? found.birth.col : -1,
      ssnCol:   found.ssn   ? found.ssn.col   : -1
    };
  }

  function normalizeExcelDate(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number') {
      var utcMillis = (val - 25569) * 86400 * 1000;
      var kstMillis = utcMillis + (9 * 60 * 60 * 1000);
      var dt = new Date(kstMillis);
      if (isNaN(dt.getTime())) return null;
      return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
    }
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return null;
      var kstDate = new Date(val.getTime() + (9 * 60 * 60 * 1000));
      return kstDate.getUTCFullYear() + '-' + pad2(kstDate.getUTCMonth() + 1) + '-' + pad2(kstDate.getUTCDate());
    }
    var str = String(val).trim();
    if (!str) return null;
    var s = str.replace(/[.\s/]/g, '-');
    var match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      var y, m, d;
      if (match[1].length === 4) { y = match[1]; m = pad2(match[2]); d = pad2(match[3]); }
      else { y = match[3]; m = pad2(match[1]); d = pad2(match[2]); }
      return y + '-' + m + '-' + d;
    }
    var digits = s.replace(/[^0-9]/g, '');
    if (digits.length === 8) {
      return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
    }
    return null;
  }

  /**
   * 생년월일은 YYMMDD 6자리 형식도 처리 (엑셀에서 그렇게 들어오는 경우 있음)
   */
  function normalizeBirthFromExcel(val) {
    if (val == null || val === '') return null;
    var iso = normalizeExcelDate(val);
    if (iso) return iso;
    var s = typeof val === 'number' ? String(Math.floor(val)) : String(val);
    s = s.replace(/[^0-9]/g, '');
    if (!s) return null;
    if (s.length === 8) {
      return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    }
    if (s.length === 6) {
      var yy = parseInt(s.slice(0, 2), 10);
      var year = yy <= 29 ? 2000 + yy : 1900 + yy;
      return year + '-' + s.slice(2, 4) + '-' + s.slice(4, 6);
    }
    return null;
  }

  /**
   * 주민등록번호 셀에서 생년월일 + 성별 + 뒷자리 첫 숫자를 추출.
   * 입력 예: "820404-2******", "820404-2", "8204042" 등
   *
   * 뒷자리 첫 숫자로 성별 구분:
   *  - 1, 3, 5, 7 → 남성 (M)
   *  - 2, 4, 6, 8 → 여성 (F)
   *  - 9, 0 → 1800년대생 (구한말, 사실상 없음 — 무시)
   *
   * 출생연도도 함께 정확히 추정 (yy + 뒷자리 첫 숫자 조합):
   *  - 1, 2 → 1900년대생
   *  - 3, 4 → 2000년대생
   *  - 5, 6 → 1900년대생 (외국인)
   *  - 7, 8 → 2000년대생 (외국인)
   *
   * @returns { birthDate: 'YYYY-MM-DD' | null, gender: 'M' | 'F' | null, ssnTail: string | null }
   */
  function parseSsn(val) {
    var result = { birthDate: null, gender: null, ssnTail: null };
    if (val == null || val === '') return result;

    var s = String(val).replace(/[^0-9]/g, '');
    if (s.length < 7) return result;  // 최소 앞6 + 뒤1 = 7자리 필요

    var front = s.slice(0, 6);    // YYMMDD
    var first = s.slice(6, 7);    // 뒷자리 첫 숫자

    var yy = parseInt(front.slice(0, 2), 10);
    var mm = parseInt(front.slice(2, 4), 10);
    var dd = parseInt(front.slice(4, 6), 10);
    if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return result;
    if (mm < 1 || mm > 12) return result;
    if (dd < 1 || dd > 31) return result;

    // 뒷자리 첫 숫자 보존 (성별 추출 후에도 저장용)
    result.ssnTail = first;

    // 세기 결정
    var century = null;
    if (first === '1' || first === '2' || first === '5' || first === '6') {
      century = 1900;
    } else if (first === '3' || first === '4' || first === '7' || first === '8') {
      century = 2000;
    } else if (first === '9' || first === '0') {
      century = 1800;  // 사실상 발생 안 함
    }

    // 성별
    if (first === '1' || first === '3' || first === '5' || first === '7' || first === '9') {
      result.gender = 'M';
    } else if (first === '2' || first === '4' || first === '6' || first === '8' || first === '0') {
      result.gender = 'F';
    }

    if (century !== null) {
      var year = century + yy;
      var iso = year + '-' + pad2(mm) + '-' + pad2(dd);
      // 유효성 한번 더 (2025-02-31 같은 보정 방지)
      var dt = new Date(iso);
      if (!isNaN(dt.getTime())) {
        var actual = dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
        if (actual === iso) result.birthDate = iso;
      }
    }

    return result;
  }

  function parseExcelFile(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === 'undefined') {
        reject(new Error('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.'));
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

          var headerInfo = findHeaderRow(rows);
          if (!headerInfo) {
            reject(new Error(
              '엑셀에서 필수 컬럼을 찾을 수 없어요.\n' +
              '아래 항목이 같은 행 또는 서로 다른 행에 있어야 합니다:\n' +
              '  • 이름 (또는 "성명")\n' +
              '  • 자격취득일 (또는 "취득일", "입사일")\n' +
              '  • 생년월일 (있으면 함께 가져옴)\n' +
              '  • 자격상실일 (있으면 함께 가져옴)'
            ));
            return;
          }

          var result = [];
          for (var r = headerInfo.headerRowIndex + 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            var name = String(row[headerInfo.nameCol] != null ? row[headerInfo.nameCol] : '').trim();
            if (!name) continue;

            // 주민번호에서 생년월일 + 성별 추출 (우선)
            var ssnParsed = headerInfo.ssnCol >= 0
              ? parseSsn(row[headerInfo.ssnCol])
              : { birthDate: null, gender: null };

            // 생년월일: 주민번호 우선, 없으면 별도 생년월일 컬럼
            var birthDate = ssnParsed.birthDate;
            if (!birthDate && headerInfo.birthCol >= 0) {
              birthDate = normalizeBirthFromExcel(row[headerInfo.birthCol]);
            }

            result.push({
              name: name,
              hireDate: normalizeExcelDate(row[headerInfo.acqCol]),
              exitDate: headerInfo.lossCol >= 0 ? normalizeExcelDate(row[headerInfo.lossCol]) : null,
              birthDate: birthDate,
              gender: ssnParsed.gender,    // 'M' | 'F' | null
              ssnTail: ssnParsed.ssnTail   // '1'~'8' 등 1자리 (명부에서는 뒷자리 첫 숫자만 추출됨)
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
   * 엑셀에서 읽어온 행들과 기존 persons 데이터를 비교 매칭.
   * - 매칭은 같은 회사 안에서만 (다른 회사에 같은 사람 있으면 겸직 → 별도 인력으로 추가)
   * - 매칭 키: 이름 + 생년월일 (생년월일 있는 경우)
   * - 생년월일 없으면: 이름만으로 매칭 시도 (느슨한 매칭) — 동명이인 있으면 신규 처리
   */
  function buildMergedPersonsList(excelRows, current) {
    var list = (current || []).slice();
    var added = 0, updated = 0, skipped = 0;
    var addedNames = [];

    excelRows.forEach(function (row) {
      var existing = null;
      var targetCompany = row.company || null;

      // 매칭: 같은 회사 + 이름+생년월일 우선
      if (row.birthDate) {
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (!p) continue;
          if ((p.name || '').trim() === row.name
              && p.birthDate === row.birthDate
              && p.company === targetCompany) {
            existing = p;
            break;
          }
        }
      }
      // 생년월일이 없으면 같은 회사 + 이름만으로 (단, 동명이인 있으면 매칭 안 함)
      if (!existing && !row.birthDate) {
        var nameMatches = list.filter(function (p) {
          return p && (p.name || '').trim() === row.name && p.company === targetCompany;
        });
        if (nameMatches.length === 1) {
          existing = nameMatches[0];
        }
      }

      if (existing) {
        var changed = false;
        if (row.hireDate && row.hireDate !== existing.hireDate) {
          existing.hireDate = row.hireDate;
          changed = true;
        }
        if (row.exitDate !== existing.exitDate) {
          existing.exitDate = row.exitDate || null;
          existing.status = existing.exitDate ? 'exited' : 'active';
          changed = true;
        }
        if (row.birthDate && !existing.birthDate) {
          existing.birthDate = row.birthDate;
          changed = true;
        }
        if (row.gender && !existing.gender) {
          existing.gender = row.gender;
          changed = true;
        }
        if (row.ssnTail && !existing.ssnTail) {
          existing.ssnTail = row.ssnTail;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = new Date().toISOString();
          updated++;
        } else {
          skipped++;
        }
      } else {
        // 신규 추가
        var now = new Date().toISOString();
        list.push({
          id: makeLocalPersonId(),
          name: row.name,
          company: targetCompany,
          birthDate: row.birthDate || null,
          gender: row.gender || null,
          ssnTail: row.ssnTail || null,
          hireDate: row.hireDate || null,
          exitDate: row.exitDate || null,
          isYouth: false,
          annualSalary: null,
          monthlySalary: null,
          memo: '',
          status: row.exitDate ? 'exited' : 'active',
          createdAt: now,
          updatedAt: now
        });
        added++;
        addedNames.push(row.name);
      }
    });

    return {
      list: list,
      summary: { added: added, updated: updated, skipped: skipped, total: excelRows.length, addedNames: addedNames }
    };
  }

  function makeLocalPersonId() {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 6);
    return 'p_' + t + r;
  }

  // ====================================================================
  // 필터링
  // ====================================================================
  function applyFilter(list, moonlightMap) {
    var kw = (_filter.keyword || '').trim().toLowerCase();
    return (list || []).filter(function (p) {
      if (!p) return false;

      if (_filter.missingBirthOnly) {
        // 마이그레이션 배너 클릭 시: 생년월일 미입력만 표시 (다른 필터 무시)
        if (p.birthDate) return false;
      } else {
        // 상태 필터
        if (_filter.status !== 'all') {
          if (_filter.status === 'moonlight') {
            // 겸직 필터: 식스티/자회사 모두 포함해서 표시
            // (테이블 뱃지는 식스티 줄에만 뜨지만, 필터에서는 전체 맥락을 보고 싶음)
            if (!moonlightMap) return false;
            var mKey = getMoonlightKey(p);
            if (!mKey || !moonlightMap[mKey]) return false;
            var mEntry = moonlightMap[mKey];
            if (!mEntry.companies || mEntry.companies.length < 2) return false;
            // 행정 이관은 겸직 필터에서도 제외
            if (mEntry.isAdminTransfer) return false;
          } else {
            // 일반 상태 필터 (재직/퇴직)
            // 식스티 퇴사 + 자회사 재직인 경우 → "재직"으로 취급 (status 컬럼에 '겸직' 표시됨)
            var st = p.status || 'active';
            var effectiveStatus = st;
            if (st === 'exited' && getCompany(p) === '식스티' && moonlightMap) {
              var mInfo2 = getMoonlightInfo(p, moonlightMap);
              if (mInfo2.isMoonlight && mInfo2.subsidiaryActive) {
                effectiveStatus = 'active';
              }
            }
            if (effectiveStatus !== _filter.status) return false;
          }
        }
      }

      // 회사 필터
      if (_filter.company !== 'all') {
        var c = getCompany(p);
        if (_filter.company === 'unset') {
          if (c) return false;       // company 있으면 제외
        } else {
          if (c !== _filter.company) return false;
        }
      }

      // 성별 필터
      if (_filter.gender !== 'all') {
        if (_filter.gender === 'unknown') {
          if (p.gender) return false;
        } else {
          if (p.gender !== _filter.gender) return false;
        }
      }

      // 연령대 필터
      if (_filter.ageBucket !== 'all') {
        var age = computeAge(p.birthDate);
        if (_filter.ageBucket === 'unknown') {
          if (age != null) return false;
        } else {
          var bucket = ageToBucket(age);
          if (bucket !== _filter.ageBucket) return false;
        }
      }

      // 청년 필터 (자동 판정 OR 수동 체크)
      if (_filter.youthOnly) {
        if (!getYouthInfo(p).youth) return false;
      }

      // 이름 검색
      if (kw) {
        var name = (p.name || '').toLowerCase();
        if (name.indexOf(kw) < 0) return false;
      }

      return true;
    });
  }

  // ====================================================================
  // 정렬 (만나이/입사일/퇴사일/월급)
  // ====================================================================

  /**
   * 정렬 키별 값 추출. null/빈 값이면 null 반환.
   * 정렬 시 null은 항상 맨 아래로 보냄 (오름·내림 둘 다).
   */
  function getSortValue(p, key) {
    if (!p) return null;
    if (key === 'age') {
      var age = computeAge(p.birthDate);
      return (age == null) ? null : age;
    }
    if (key === 'hireDate') {
      return p.hireDate || null;  // 'YYYY-MM-DD' 문자열 비교로 충분
    }
    if (key === 'exitDate') {
      return p.exitDate || null;
    }
    if (key === 'monthlySalary') {
      // monthlySalary 우선, 없으면 annualSalary/12로 폴백
      if (p.monthlySalary != null && !isNaN(p.monthlySalary)) return p.monthlySalary;
      if (p.annualSalary != null && !isNaN(p.annualSalary)) return Math.ceil(p.annualSalary / 12);
      return null;
    }
    return null;
  }

  /**
   * 정렬 적용. _sort.key가 null이면 원본 순서 유지.
   * null 값은 항상 맨 아래(방향 무관).
   */
  function applySort(list) {
    if (!_sort.key) return list;
    var key = _sort.key;
    var dir = _sort.dir === 'asc' ? 1 : -1;

    // 안정 정렬 위해 원본 인덱스 보존
    var indexed = list.map(function (p, i) { return { p: p, i: i, v: getSortValue(p, key) }; });
    indexed.sort(function (a, b) {
      // null은 항상 뒤로
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      if (a.v < b.v) return -1 * dir;
      if (a.v > b.v) return 1 * dir;
      return a.i - b.i;  // 동일 값이면 원래 순서 유지 (안정 정렬)
    });
    return indexed.map(function (x) { return x.p; });
  }

  /**
   * 정렬 헤더 클릭 처리.
   * 같은 컬럼 반복 클릭: 없음 → desc → asc → 없음
   * 다른 컬럼 클릭: 그 컬럼의 desc부터 시작
   */
  function onSortHeaderClick(key) {
    if (!key) return;
    if (_sort.key !== key) {
      _sort.key = key;
      _sort.dir = 'desc';
    } else if (_sort.dir === 'desc') {
      _sort.dir = 'asc';
    } else {
      // asc였으면 해제
      _sort.key = null;
      _sort.dir = 'desc';
    }
    render();
  }

  /**
   * 헤더 상태 표시 갱신 (sort-asc / sort-desc 클래스 토글).
   * render() 호출 후 호출됨.
   */
  function updateSortHeaderClasses() {
    var ths = document.querySelectorAll('#persons-table th.th-sortable');
    ths.forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      var k = th.getAttribute('data-sort-key');
      if (k && k === _sort.key) {
        th.classList.add(_sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // ====================================================================
  // 요약 카드 + 마이그레이션 배너
  // ====================================================================
  function updateSummary() {
    var total = _persons.length;
    var active = 0, exited = 0, youth = 0, missingBirth = 0;
    var activeMale = 0, activeFemale = 0, activeUnknown = 0;
    for (var i = 0; i < _persons.length; i++) {
      var p = _persons[i];
      if (!p) continue;
      var st = p.status || 'active';
      if (st === 'exited') {
        exited++;
      } else {
        active++;
        if (p.gender === 'M') activeMale++;
        else if (p.gender === 'F') activeFemale++;
        else activeUnknown++;
        // 청년 (재직 인력 중 자동+수동 종합 판정)
        if (getYouthInfo(p).youth) youth++;
      }
      if (!p.birthDate) missingBirth++;
    }
    if (el.statTotal)    el.statTotal.textContent = total;
    if (el.statTotalSub) el.statTotalSub.textContent = '재직 ' + active + ' · 퇴직 ' + exited;
    if (el.statActive)   el.statActive.textContent = active;
    if (el.statActiveSub) {
      var parts = ['남 ' + activeMale, '여 ' + activeFemale];
      if (activeUnknown > 0) parts.push('미입력 ' + activeUnknown);
      el.statActiveSub.textContent = parts.join(' · ');
    }
    if (el.statYouth)    el.statYouth.textContent = youth;
    if (el.statExited)   el.statExited.textContent = exited;

    // 마이그레이션 배너
    if (el.migrationBanner) {
      if (missingBirth > 0) {
        el.migrationBanner.hidden = false;
        if (el.migrationBannerText) {
          el.migrationBannerText.innerHTML =
            '<strong>생년월일 미입력 ' + missingBirth + '명</strong> · 동명이인 구분을 위해 생년월일을 채워주세요. (클릭하면 해당 인력만 표시)';
        }
      } else {
        el.migrationBanner.hidden = true;
        if (_filter.missingBirthOnly) {
          _filter.missingBirthOnly = false;
          el.migrationBanner.style.boxShadow = '';
        }
      }
    }
  }

  // ====================================================================
  // 렌더링
  // ====================================================================
  function renderRow(p, idx, moonlightMap) {
    var isExited = (p.status === 'exited');
    var missingBirth = !p.birthDate;

    // 겸직 정보 먼저 계산 (상태 뱃지/이름 뱃지/행 배경에 영향)
    var mInfo = moonlightMap ? getMoonlightInfo(p, moonlightMap) : null;
    // 식스티 퇴사 + 자회사 재직 = "실질 재직". 식스티 줄이지만 회색 처리하지 않고 겸직으로 표시.
    var isMoonlightActiveOnSubsidiary = !!(mInfo && mInfo.isMoonlight && !mInfo.selfActive && mInfo.subsidiaryActive);

    // 행 배경: 퇴직이면 옅은 회색, 단 자회사에서 재직 중이면 회색 처리 안 함
    var rowStyle = '';
    if (isExited && !isMoonlightActiveOnSubsidiary) {
      rowStyle = 'style="color:#9ca3af;background:#fafafa"';
    } else if (missingBirth) {
      rowStyle = 'style="background:#fffbeb"';
    }

    // 회사 뱃지
    var company = getCompany(p);
    var companyHtml = renderCompanyBadge(company);

    // 상태 뱃지:
    // - 식스티 퇴사 + 자회사 재직 → "겸직" (진한 노란색 글자, 배경 없음 — 재직/퇴직과 시각적 구분)
    // - 그 외 → 재직/퇴직
    var statusBadge;
    if (isMoonlightActiveOnSubsidiary) {
      var othersForStatus = mInfo.others.join(', ');
      statusBadge = '<span class="projects-badge" style="color:#92400e;background:none;padding:0" title="' + escapeHtml(othersForStatus) + '에서 재직 중">겸직</span>';
    } else if (isExited) {
      statusBadge = '<span class="projects-badge projects-badge--end">퇴직</span>';
    } else {
      statusBadge = '<span class="projects-badge projects-badge--active">재직</span>';
    }

    // 이름 + 생년월일 미입력 경고 + 겸직 뱃지
    // 이름 옆 [겸직] 뱃지가 붙는 경우:
    //  ① 식스티 본인이 재직 중 (자회사 상태 무관)
    //  ② 식스티 퇴사 + 자회사도 퇴사 (양쪽 다 퇴사, 회색 행이지만 겸직 이력이 있었음을 표시)
    // 안 붙는 경우:
    //  ③ 식스티 퇴사 + 자회사 재직 → 상태 컬럼에 "겸직" 표시되므로 중복 X
    var nameContent = escapeHtml(p.name || '-');
    if (missingBirth) {
      nameContent += ' <span title="생년월일 미입력" style="color:#b45309;font-size:0.8rem">⚠️</span>';
    }
    if (mInfo && mInfo.isMoonlight && !isMoonlightActiveOnSubsidiary) {
      var othersForBadge = mInfo.others.join(', ');
      nameContent += '<span class="moonlight-badge" title="' + escapeHtml(othersForBadge) + '와(과) 겸직">겸직</span>';
    }

    // 성별 뱃지
    var genderBadge;
    if (p.gender === 'M') {
      genderBadge = '<span class="gender-badge gender-badge--male">남</span>';
    } else if (p.gender === 'F') {
      genderBadge = '<span class="gender-badge gender-badge--female">여</span>';
    } else {
      genderBadge = '<span class="gender-badge--unknown">-</span>';
    }

    // 메모
    var memoHtml = p.memo
      ? '<span style="color:#64748b;font-size:0.85rem">' + escapeHtml(p.memo) + '</span>'
      : '<span style="color:#cbd5e1">-</span>';

    // 월급: monthlySalary 우선, 없으면 annualSalary/12
    var monthly = (p.monthlySalary != null && !isNaN(p.monthlySalary))
      ? p.monthlySalary
      : (p.annualSalary != null && !isNaN(p.annualSalary) ? Math.ceil(p.annualSalary / 12) : null);

    // 날짜들 (생년월일은 테이블에서 제거됨 — 주민번호 앞자리에 이미 포함되어 있음)
    var hireHtml  = p.hireDate  ? escapeHtml(formatDate(p.hireDate))  : '<span style="color:#cbd5e1">-</span>';
    var exitHtml  = p.exitDate  ? escapeHtml(formatDate(p.exitDate))  : '<span style="color:#cbd5e1">-</span>';

    // 주민번호 표시 (앞자리 YYMMDD - 뒷자리)
    var ssnHtml;
    if (p.birthDate || p.ssnTail) {
      var front = '------';
      if (p.birthDate) {
        var parts = String(p.birthDate).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          front = parts[0].slice(2) + parts[1] + parts[2];
        }
      }
      var tail = p.ssnTail ? escapeHtml(p.ssnTail) : '<span style="color:#cbd5e1">?</span>';
      // tail이 1자리(첫 숫자만 있음)면 ******로 마스킹 표시, 길면 그대로
      var tailDisplay;
      if (p.ssnTail && p.ssnTail.length === 1) {
        tailDisplay = escapeHtml(p.ssnTail) + '<span style="color:#94a3b8">******</span>';
      } else if (p.ssnTail) {
        tailDisplay = escapeHtml(p.ssnTail);
      } else {
        tailDisplay = '<span style="color:#cbd5e1">?</span>';
      }
      ssnHtml = front + '-' + tailDisplay;
    } else {
      ssnHtml = '<span style="color:#cbd5e1">-</span>';
    }

    // 만나이
    var age = computeAge(p.birthDate);
    var ageHtml = (age != null)
      ? '<span style="color:#475569">' + age + '<span style="font-size:0.75rem;color:#94a3b8;margin-left:0.1rem">세</span></span>'
      : '<span style="color:#cbd5e1">-</span>';

    // 연필 아이콘
    var pencilIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
      '</svg>';

    return ''
      + '<tr ' + rowStyle + ' data-person-id="' + escapeHtml(p.id || '') + '">'
        + '<td>' + (idx + 1) + '</td>'
        + '<td>' + companyHtml + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="font-weight:600">' + nameContent + '</td>'
        + '<td>' + genderBadge + '</td>'
        + '<td>' + ssnHtml + '</td>'
        + '<td>' + ageHtml + '</td>'
        + '<td>' + hireHtml + '</td>'
        + '<td>' + exitHtml + '</td>'
        + '<td class="col-num">' + escapeHtml(formatMoney(monthly)) + '</td>'
        + '<td>' + memoHtml + '</td>'
        + '<td>'
          + '<button type="button" class="project-edit-btn" '
          +   'data-action="edit" data-person-id="' + escapeHtml(p.id || '') + '" '
          +   'title="인력 수정" aria-label="인력 수정">'
          +   pencilIcon
          + '</button>'
        + '</td>'
      + '</tr>';
  }

  function render() {
    if (!el.tbody) return;

    updateSummary();

    // 겸직 매핑은 전체 데이터 기준으로 미리 계산 (필터 영향 없음)
    var moonlightMap = computeMoonlightMap(_persons);

    var filtered = applyFilter(_persons, moonlightMap);
    filtered = applySort(filtered);  // 정렬 적용 (정렬 없으면 그대로)
    var totalCount = _persons.length;
    var filteredCount = filtered.length;

    if (totalCount === 0) {
      if (el.tableWrap) el.tableWrap.style.display = 'none';
      if (el.empty) el.empty.style.display = 'block';
      if (el.emptyTitle) el.emptyTitle.textContent = '아직 등록된 인력이 없어요';
      if (el.emptyDesc) {
        el.emptyDesc.innerHTML =
          '오른쪽 위 <strong>"📤 명부 업로드"</strong> 버튼으로 건강보험가입자명부를 올리시거나,<br>' +
          '<strong>"+ 인력 추가"</strong> 버튼으로 한 명씩 직접 등록할 수 있어요.';
      }
      if (el.countHint) el.countHint.textContent = '0명';
      el.tbody.innerHTML = '';
      return;
    }

    if (filteredCount === 0) {
      if (el.tableWrap) el.tableWrap.style.display = 'none';
      if (el.empty) el.empty.style.display = 'block';
      if (el.emptyTitle) el.emptyTitle.textContent = '조건에 맞는 인력이 없어요';
      if (el.emptyDesc) {
        el.emptyDesc.innerHTML = '검색어나 필터를 다시 확인해 보세요.<br>(전체 ' + totalCount + '명 등록됨)';
      }
      if (el.countHint) el.countHint.textContent = '0명 / 전체 ' + totalCount + '명';
      el.tbody.innerHTML = '';
      return;
    }

    if (el.tableWrap) el.tableWrap.style.display = '';
    if (el.empty) el.empty.style.display = 'none';

    // 정렬:
    // - 사용자가 헤더 클릭으로 정렬을 선택했으면(_sort.key 있음) → 위쪽 applySort 결과를 그대로 사용 (기본 정렬 스킵)
    // - 선택 안 했으면 → 기본 정렬(입사일 오래된 순, tie-breaker는 등록순) 적용
    //   → 명부 업로드 시 명부 순서가 자연스럽게 유지됨
    var sorted;
    if (_sort.key) {
      // 이미 위에서 applySort가 적용됨 — 그대로 사용
      sorted = filtered;
    } else {
      sorted = filtered.slice().sort(function (a, b) {
        var ah = a.hireDate || '';
        var bh = b.hireDate || '';
        // 둘 다 있으면 날짜 비교
        if (ah && bh) {
          if (ah !== bh) return ah < bh ? -1 : 1;
        } else if (ah && !bh) {
          return -1;  // 입사일 있는 사람이 위
        } else if (!ah && bh) {
          return 1;
        }
        // tie-breaker: createdAt (먼저 등록된 사람이 위)
        var ac = a.createdAt || '';
        var bc = b.createdAt || '';
        if (ac && bc && ac !== bc) return ac < bc ? -1 : 1;
        return 0;
      });
    }

    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      html += renderRow(sorted[i], i, moonlightMap);
    }
    el.tbody.innerHTML = html;

    if (el.countHint) {
      if (filteredCount === totalCount) {
        el.countHint.textContent = totalCount + '명';
      } else {
        el.countHint.textContent = filteredCount + '명 / 전체 ' + totalCount + '명';
      }
    }

    // 정렬 헤더 시각 표시 갱신 (sort-asc / sort-desc 클래스)
    updateSortHeaderClasses();
  }

  // ====================================================================
  // 모달
  // ====================================================================
  var _editingPerson = null;
  var _saving = false;

  function openModal(person) {
    if (!el.modal) return;

    _editingPerson = person || null;
    var isEdit = !!person;

    if (el.modalTitle)  el.modalTitle.textContent = isEdit ? '인력 수정' : '인력 추가';
    if (el.modalDelete) el.modalDelete.hidden = !isEdit;
    if (el.formExitDateRow) el.formExitDateRow.hidden = !isEdit;

    if (isEdit) {
      el.formName.value = person.name || '';
      setDateParts(el.formBirthY, el.formBirthM, el.formBirthD, person.birthDate);
      setDateParts(el.formHireY,  el.formHireM,  el.formHireD,  person.hireDate);
      setDateParts(el.formExitY,  el.formExitM,  el.formExitD,  person.exitDate);
      el.formIsYouth.checked = !!person.isYouth;
      setGenderRadio(person.gender);
      setCompanyRadio(getCompany(person));
      if (el.formSsnTail) el.formSsnTail.value = person.ssnTail || '';
      var annualVal = (person.annualSalary != null)
        ? person.annualSalary
        : (person.monthlySalary != null ? person.monthlySalary * 12 : '');
      el.formAnnualSalary.value = (annualVal === null || annualVal === undefined || annualVal === '') ? '' : fmtComma(annualVal);
      el.formMemo.value = person.memo || '';
      // 연봉 슬롯: 가용 슬롯 ∪ 본인이 가진 슬롯 키
      _modalSlotNames = getAvailableSlotNames();
      if (person.salarySlots && typeof person.salarySlots === 'object') {
        Object.keys(person.salarySlots).forEach(function (k) {
          if (k && k !== '실제' && _modalSlotNames.indexOf(k) === -1) _modalSlotNames.push(k);
        });
      }
      renderSalarySlots(person);
      // §4.4 연봉 변경 시점
      _modalSalaryChanges = sanitizeSalaryChanges(person.salaryChanges).map(function (c) {
        return { from: c.from, annualSalary: c.annualSalary };
      });
      renderSalaryChanges();
    } else {
      el.formName.value          = '';
      setDateParts(el.formBirthY, el.formBirthM, el.formBirthD, null);
      setDateParts(el.formHireY,  el.formHireM,  el.formHireD,  null);
      setDateParts(el.formExitY,  el.formExitM,  el.formExitD,  null);
      el.formIsYouth.checked     = false;
      setGenderRadio(null);
      setCompanyRadio(null);
      if (el.formSsnTail) el.formSsnTail.value = '';
      el.formAnnualSalary.value  = '';
      el.formMemo.value          = '';
      _modalSlotNames = getAvailableSlotNames();
      renderSalarySlots(null);
      _modalSalaryChanges = [];
      renderSalaryChanges();
    }

    updateAnnualSalaryHint();
    updateSsnFrontDisplay();   // 주민번호 앞자리 표시 갱신
    clearFormError();
    el.modal.hidden = false;

    setTimeout(function () {
      try { el.formName.focus(); } catch (e) {}
    }, 30);
  }

  function closeModal() {
    if (!el.modal) return;
    if (_saving) return;
    el.modal.hidden = true;
    _editingPerson = null;
    clearFormError();
  }

  /**
   * 성별 라디오 버튼 값 채우기 ('M' | 'F' | null)
   */
  function setGenderRadio(gender) {
    var target;
    if (gender === 'M') target = el.formGenderM;
    else if (gender === 'F') target = el.formGenderF;
    else target = el.formGenderNone;
    if (target) target.checked = true;

    // is-checked 클래스 토글 (:has 미지원 브라우저용)
    updateGenderRadioStyles();
  }

  /**
   * 현재 선택된 성별 라디오 값 읽기 ('M' | 'F' | null)
   */
  function getGenderRadio() {
    if (el.formGenderM && el.formGenderM.checked) return 'M';
    if (el.formGenderF && el.formGenderF.checked) return 'F';
    return null;
  }

  /**
   * 라디오 버튼의 부모 label에 is-checked 클래스 갱신 (시각적 강조)
   */
  function updateGenderRadioStyles() {
    [el.formGenderNone, el.formGenderM, el.formGenderF].forEach(function (radio) {
      if (!radio) return;
      var label = radio.closest('label.gender-radio');
      if (!label) return;
      if (radio.checked) label.classList.add('is-checked');
      else label.classList.remove('is-checked');
    });
  }

  /**
   * 회사 라디오 채우기
   * @param {string | null} company - '식스티' | '굿뉴스' | '패리티' | null
   */
  function setCompanyRadio(company) {
    var target = null;
    if (company === '식스티')       target = el.formCompanySixty;
    else if (company === '굿뉴스')  target = el.formCompanyGoodnews;
    else if (company === '패리티')  target = el.formCompanyParity;
    // 모든 라디오 해제
    [el.formCompanySixty, el.formCompanyGoodnews, el.formCompanyParity].forEach(function (r) {
      if (r) r.checked = false;
    });
    if (target) target.checked = true;
    updateCompanyRadioStyles();
  }

  function getCompanyRadio() {
    if (el.formCompanySixty    && el.formCompanySixty.checked)    return '식스티';
    if (el.formCompanyGoodnews && el.formCompanyGoodnews.checked) return '굿뉴스';
    if (el.formCompanyParity   && el.formCompanyParity.checked)   return '패리티';
    return null;
  }

  function updateCompanyRadioStyles() {
    [el.formCompanySixty, el.formCompanyGoodnews, el.formCompanyParity].forEach(function (radio) {
      if (!radio) return;
      var label = radio.closest('label.gender-radio');
      if (!label) return;
      if (radio.checked) label.classList.add('is-checked');
      else label.classList.remove('is-checked');
    });
  }

  /**
   * 주민번호 앞자리 표시 갱신 (생년월일 → YYMMDD 형식)
   * 모달의 form-ssn-front 라벨에 자동 채워짐
   */
  function updateSsnFrontDisplay() {
    if (!el.formSsnFront) return;
    var y = (el.formBirthY && el.formBirthY.value) || '';
    var m = (el.formBirthM && el.formBirthM.value) || '';
    var d = (el.formBirthD && el.formBirthD.value) || '';
    if (y.length === 4 && m && d) {
      // YYMMDD 형식
      var yy = y.slice(2);
      var mm = m.padStart(2, '0');
      var dd = d.padStart(2, '0');
      el.formSsnFront.textContent = yy + mm + dd;
      el.formSsnFront.style.color = 'var(--text-primary)';
    } else {
      el.formSsnFront.textContent = '------';
      el.formSsnFront.style.color = 'var(--text-secondary)';
    }
  }

  /**
   * 주민번호 뒷자리 입력에서 첫 숫자(성별 식별자) 추출
   * 입력 예: "2", "2****", "2123456" → 반환: "2"
   * @returns {string | null} 1~8 (또는 9, 0) 중 하나, 또는 null
   */
  function extractSsnFirstDigit(tailValue) {
    if (!tailValue) return null;
    var s = String(tailValue).replace(/[^0-9]/g, '');
    if (!s) return null;
    return s.charAt(0);
  }

  /**
   * 주민번호 뒷자리 첫 숫자 → 성별 자동 판정
   * @returns {'M' | 'F' | null}
   */
  function ssnFirstToGender(first) {
    if (!first) return null;
    if (first === '1' || first === '3' || first === '5' || first === '7' || first === '9') return 'M';
    if (first === '2' || first === '4' || first === '6' || first === '8' || first === '0') return 'F';
    return null;
  }

  /**
   * 주민번호 뒷자리 입력 시 — 자동으로 성별 라디오 채우기
   */
  function onSsnTailInput() {
    if (!el.formSsnTail) return;
    var raw = el.formSsnTail.value || '';
    // 숫자만 남기기 (자동 정리)
    var digits = raw.replace(/[^0-9]/g, '');
    if (digits !== raw) el.formSsnTail.value = digits;

    var first = extractSsnFirstDigit(digits);
    if (first) {
      var gender = ssnFirstToGender(first);
      if (gender) {
        // 성별 라디오 자동 선택
        setGenderRadio(gender);
        if (el.ssnTailHint) {
          el.ssnTailHint.innerHTML =
            '첫 숫자 <strong>' + first + '</strong> → 성별 <strong>' +
            (gender === 'M' ? '남' : '여') + '</strong>으로 자동 설정됨';
          el.ssnTailHint.style.color = '#047857';
        }
        return;
      }
    }
    // 첫 숫자가 없거나 무효
    if (el.ssnTailHint) {
      el.ssnTailHint.textContent = '첫 숫자만 입력해도 OK (성별 자동 판정). 명부 업로드 시 자동으로 채워집니다.';
      el.ssnTailHint.style.color = '';
    }
  }

  function clearFormError() {
    if (el.formError) {
      el.formError.hidden = true;
      el.formError.textContent = '';
    }
    var inputs = el.modal ? el.modal.querySelectorAll('.person-form-input, .date-parts input') : [];
    inputs.forEach(function (input) {
      input.classList.remove('person-form-input--error');
      input.classList.remove('is-error');
    });
  }

  function showFormError(message, focusEl) {
    if (el.formError) {
      el.formError.textContent = message;
      el.formError.hidden = false;
    }
    if (focusEl) {
      focusEl.classList.add('person-form-input--error');
      focusEl.classList.add('is-error');
      try { focusEl.focus(); } catch (e) {}
    }
  }

  function markDateError(yEl, mEl, dEl) {
    [yEl, mEl, dEl].forEach(function (e) {
      if (e) e.classList.add('is-error');
    });
  }

  function updateAnnualSalaryHint() {
    if (!el.annualSalaryHint || !el.formAnnualSalary) return;
    var v = parseMoney(el.formAnnualSalary.value);
    if (v != null && v > 0) {
      var monthly = Math.ceil(v / 12);
      el.annualSalaryHint.innerHTML =
        '월급 환산: <strong>' + monthly.toLocaleString('ko-KR') + '원/월</strong> (자동 저장됨)';
      el.annualSalaryHint.style.color = '#047857';
    } else {
      el.annualSalaryHint.textContent = '비워두면 인건비 자동 계산에서 제외됩니다 (나중에 입력해도 OK)';
      el.annualSalaryHint.style.color = '';
    }
  }

  // 실제 연봉 입력 → 콤마 포맷(캐럿 끝) + 힌트 갱신
  function onAnnualSalaryInput() {
    if (!el.formAnnualSalary) return;
    var n = parseMoney(el.formAnnualSalary.value);
    el.formAnnualSalary.value = (n == null) ? '' : fmtComma(n);
    updateAnnualSalaryHint();
  }

  // ====================================================================
  // 연봉 슬롯 헬퍼
  // ====================================================================
  // 금액 파싱/포맷 (콤마 표시 ↔ 숫자)
  function parseMoney(s) {
    var d = String(s == null ? '' : s).replace(/[^\d]/g, '');
    return d === '' ? null : Number(d);
  }
  function fmtComma(n) {
    if (n == null || n === '' || isNaN(n)) return '';
    return Number(n).toLocaleString('ko-KR');
  }

  // 슬롯명 정규화/검증 (Firestore 맵 키 안전 + 중복/예약어 방지)
  function sanitizeSlotName(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    if (s === '실제') return null;                 // 예약(실제 연봉)
    if (/[.\/\[\]*~`#$]/.test(s)) return null;     // Firestore 키/표시 안전
    if (s.length > 20) s = s.slice(0, 20);
    return s;
  }

  // 가용 슬롯 = 기본 ∪ 전체 인력 salarySlots 키 (정렬: 기본 먼저, 그 외 가나다)
  function getAvailableSlotNames() {
    var seen = {};
    var defaults = [];
    DEFAULT_SALARY_SLOTS.forEach(function (n) { if (!seen[n]) { seen[n] = 1; defaults.push(n); } });
    var others = [];
    (_persons || []).forEach(function (p) {
      var slots = p && p.salarySlots;
      if (slots && typeof slots === 'object') {
        Object.keys(slots).forEach(function (k) {
          if (k && k !== '실제' && !seen[k]) { seen[k] = 1; others.push(k); }
        });
      }
    });
    others.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    return defaults.concat(others);
  }

  // ====================================================================
  // §4.4 1단계 — 연봉 변경 시점 (연중 인상 등)
  //   person.salaryChanges = [{ from:'YYYY-MM', annualSalary:원 }, ...]
  //     · 그 달(from)부터 새 연봉, 그 전까지는 기본 annualSalary (계단식)
  //     · 비어 있으면 1년 내내 기본 annualSalary = 기존 동작과 100% 동일(안전)
  //   ⚠️ 2단계(project-labor)·3단계(project-budget)에서 같은 해석을 써야 하므로
  //      거기로 갈 때 getAnnualSalaryAt/getMonthlySalaryAt을 공용 위치로 승격 예정.
  // ====================================================================

  // §4.4 해석 함수 — 평소엔 firestore-service.js의 window.SalaryUtil 사용(단일 진실 소스),
  //   미로드 시엔 로컬 폴백으로 동작(연봉 변경 저장/표시가 절대 깨지지 않도록 — 저장 핵심 경로).
  function normalizeYm(s) {
    if (window.SalaryUtil) return window.SalaryUtil.normalizeYm(s);
    var m = String(s == null ? '' : s).trim().match(/^(\d{4})\s*[-.\/]?\s*(\d{1,2})$/);
    if (!m) return null;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    return m[1] + '-' + (mo < 10 ? '0' + mo : '' + mo);
  }
  function sanitizeSalaryChanges(arr) {
    if (window.SalaryUtil) return window.SalaryUtil.sanitizeSalaryChanges(arr);
    if (!Array.isArray(arr)) return [];
    var map = {};
    arr.forEach(function (c) {
      if (!c) return;
      var ym = normalizeYm(c.from);
      var d = String(c.annualSalary == null ? '' : c.annualSalary).replace(/[^\d]/g, '');
      var sal = d === '' ? null : Math.round(Number(d));
      if (ym && sal != null && sal > 0) map[ym] = sal;
    });
    return Object.keys(map).sort().map(function (ym) { return { from: ym, annualSalary: map[ym] }; });
  }
  function getAnnualSalaryAt(person, ym) {
    if (window.SalaryUtil) return window.SalaryUtil.getAnnualSalaryAt(person, ym);
    if (!person) return 0;
    var base = (person.annualSalary != null && !isNaN(person.annualSalary)) ? Number(person.annualSalary) : 0;
    var ch = sanitizeSalaryChanges(person.salaryChanges);
    if (!ch.length || !ym) return base;
    var picked = base;
    ch.forEach(function (c) { if (c.from <= ym) picked = c.annualSalary; });
    return picked;
  }
  function getMonthlySalaryAt(person, ym) {
    if (window.SalaryUtil) return window.SalaryUtil.getMonthlySalaryAt(person, ym);
    var a = getAnnualSalaryAt(person, ym);
    return a ? Math.ceil(a / 12) : 0;
  }

  // 현재 모달의 슬롯 행 렌더 (person=편집 대상 또는 null)
  function renderSalarySlots(person) {
    if (!el.formSalarySlots) return;
    var slots = (person && person.salarySlots && typeof person.salarySlots === 'object') ? person.salarySlots : {};
    if (!_modalSlotNames.length) {
      el.formSalarySlots.innerHTML = '<div class="pm-slots-empty">항목이 없습니다. "+ 항목 추가"로 만들 수 있어요.</div>';
      return;
    }
    el.formSalarySlots.innerHTML = _modalSlotNames.map(function (name) {
      var v = slots[name];
      var val = (v != null && !isNaN(v)) ? v : '';
      var monthly = val !== '' ? Math.ceil(Number(val) / 12) : null;
      return '<div class="pm-slot-row" data-slot="' + escAttr(name) + '">' +
        '<span class="pm-slot-name">' + escHtml(name) + '</span>' +
        '<div class="pm-slot-fields">' +
          '<input type="text" inputmode="numeric" autocomplete="off" class="pm-slot-input" data-slot="' + escAttr(name) + '" ' +
            'placeholder="비우면 실제 연봉 사용" value="' + (val === '' ? '' : fmtComma(val)) + '">' +
          '<span class="pm-slot-monthly">' + (monthly != null ? '월 ' + monthly.toLocaleString('ko-KR') + '원' : '—') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // 슬롯 입력 → 콤마 포맷 + 월급 미리보기 갱신
  function onSlotInput(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('pm-slot-input')) return;
    var n = parseMoney(input.value);
    input.value = (n == null) ? '' : fmtComma(n);          // 콤마 표시(캐럿 끝)
    var row = input.closest('.pm-slot-row');
    if (!row) return;
    var span = row.querySelector('.pm-slot-monthly');
    if (!span) return;
    span.textContent = (n != null && n >= 0) ? ('월 ' + Math.ceil(n / 12).toLocaleString('ko-KR') + '원') : '—';
  }

  // "+ 슬롯 추가"
  function onAddSlot() {
    var raw = window.prompt('예산 전용 연봉 항목 이름을 입력하세요. (예: 제안서용(공개 가능), 낮춤값)');
    if (raw == null) return;
    var name = sanitizeSlotName(raw);
    if (!name) { alert('사용할 수 없는 이름입니다. ("실제"·특수문자 불가)'); return; }
    if (_modalSlotNames.indexOf(name) !== -1) { alert('이미 있는 항목입니다: ' + name); return; }
    _modalSlotNames.push(name);
    // 현재 입력값 보존하며 재렌더
    renderSalarySlots({ salarySlots: collectSalarySlotsFromForm() });
  }

  // 폼의 슬롯 입력값 수집 → { 슬롯명: 연봉 } (빈 값 제외)
  function collectSalarySlotsFromForm() {
    var out = {};
    if (!el.formSalarySlots) return out;
    var inputs = el.formSalarySlots.querySelectorAll('.pm-slot-input');
    Array.prototype.forEach.call(inputs, function (inp) {
      var name = inp.dataset.slot;
      var n = parseMoney(inp.value);
      if (!name || n == null || n < 0) return;
      out[name] = Math.round(n);
    });
    return out;
  }

  // ===== §4.4 연봉 변경 시점 UI =====

  // _modalSalaryChanges 배열로 행 렌더 (편집 중 raw 값 그대로)
  function renderSalaryChanges() {
    if (!el.formSalaryChanges) return;
    if (!_modalSalaryChanges.length) {
      el.formSalaryChanges.innerHTML = '<div class="pm-slots-empty">변경 시점이 없습니다. 연중에 연봉이 바뀌면 "+ 변경 시점 추가".</div>';
      return;
    }
    el.formSalaryChanges.innerHTML = _modalSalaryChanges.map(function (c, i) {
      var fromVal = (c && c.from != null) ? c.from : '';
      var salRaw = (c && c.annualSalary != null && c.annualSalary !== '') ? c.annualSalary : '';
      var salNum = parseMoney(salRaw);
      var salDisp = (salNum == null) ? '' : fmtComma(salNum);
      var monthly = (salNum != null && salNum >= 0) ? Math.ceil(salNum / 12) : null;
      return '<div class="pm-change-row" data-idx="' + i + '">' +
        '<input type="text" inputmode="numeric" autocomplete="off" class="pm-change-from" data-idx="' + i + '" ' +
          'placeholder="2026-07" value="' + escAttr(fromVal) + '" maxlength="7">' +
        '<span class="pm-change-arrow">→</span>' +
        '<input type="text" inputmode="numeric" autocomplete="off" class="pm-change-salary" data-idx="' + i + '" ' +
          'placeholder="새 연봉(원)" value="' + escAttr(salDisp) + '">' +
        '<span class="pm-change-monthly">' + (monthly != null ? '월 ' + monthly.toLocaleString('ko-KR') + '원' : '—') + '</span>' +
        '<button type="button" class="pm-change-del" data-idx="' + i + '" title="삭제">✕</button>' +
      '</div>';
    }).join('');
  }

  // 현재 DOM 입력값을 _modalSalaryChanges 로 동기화 (구조 변경 전 호출)
  function syncSalaryChangesFromDom() {
    if (!el.formSalaryChanges) return;
    var rows = el.formSalaryChanges.querySelectorAll('.pm-change-row');
    var next = [];
    Array.prototype.forEach.call(rows, function (row) {
      var fromInp = row.querySelector('.pm-change-from');
      var salInp = row.querySelector('.pm-change-salary');
      next.push({
        from: fromInp ? (fromInp.value || '').trim() : '',
        annualSalary: salInp ? salInp.value : ''
      });
    });
    _modalSalaryChanges = next;
  }

  function onAddSalaryChange() {
    syncSalaryChangesFromDom();
    _modalSalaryChanges.push({ from: '', annualSalary: '' });
    renderSalaryChanges();
  }

  // 입력 중: 연봉칸 콤마 포맷 + 월급 미리보기 (재렌더 없이 해당 행만)
  function onSalaryChangeInput(e) {
    var input = e.target;
    if (!input || !input.classList) return;
    var row = input.closest('.pm-change-row');
    if (!row) return;
    if (input.classList.contains('pm-change-salary')) {
      var n = parseMoney(input.value);
      input.value = (n == null) ? '' : fmtComma(n);
      var span = row.querySelector('.pm-change-monthly');
      if (span) span.textContent = (n != null && n >= 0) ? ('월 ' + Math.ceil(n / 12).toLocaleString('ko-KR') + '원') : '—';
    }
  }

  // 삭제 버튼 (위임)
  function onSalaryChangeClick(e) {
    var btn = e.target;
    if (!btn || !btn.classList || !btn.classList.contains('pm-change-del')) return;
    syncSalaryChangesFromDom();
    var idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx)) {
      _modalSalaryChanges.splice(idx, 1);
      renderSalaryChanges();
    }
  }

  // 폼 → 정규화된 변경 시점 배열
  function collectSalaryChangesFromForm() {
    syncSalaryChangesFromDom();
    return sanitizeSalaryChanges(_modalSalaryChanges);
  }

  function readForm() {
    // 회사 (필수)
    var company = getCompanyRadio();
    if (!company) {
      showFormError('회사를 선택해 주세요.', null);
      // 첫 라디오에 포커스
      try { if (el.formCompanySixty) el.formCompanySixty.focus(); } catch (e) {}
      return null;
    }

    var name = (el.formName.value || '').trim();
    if (!name) {
      showFormError('이름을 입력해 주세요.', el.formName);
      return null;
    }

    // 생년월일 (필수)
    var birthDate = buildDateString(el.formBirthY.value, el.formBirthM.value, el.formBirthD.value);
    if (birthDate === null) {
      showFormError('생년월일을 입력해 주세요. (동명이인 구분을 위해 필수입니다)', el.formBirthY);
      markDateError(el.formBirthY, el.formBirthM, el.formBirthD);
      return null;
    }
    if (birthDate === false) {
      showFormError('생년월일을 정확한 날짜(YYYY-MM-DD)로 입력해 주세요.', el.formBirthY);
      markDateError(el.formBirthY, el.formBirthM, el.formBirthD);
      return null;
    }

    // 입사일 (선택)
    var hireDate = buildDateString(el.formHireY.value, el.formHireM.value, el.formHireD.value);
    if (hireDate === false) {
      showFormError('입사일을 정확한 날짜로 입력하거나 비워주세요.', el.formHireY);
      markDateError(el.formHireY, el.formHireM, el.formHireD);
      return null;
    }

    // 퇴사일 (수정 모드에서만)
    var exitDate = null;
    if (!el.formExitDateRow.hidden) {
      exitDate = buildDateString(el.formExitY.value, el.formExitM.value, el.formExitD.value);
      if (exitDate === false) {
        showFormError('퇴사일을 정확한 날짜로 입력하거나 비워주세요.', el.formExitY);
        markDateError(el.formExitY, el.formExitM, el.formExitD);
        return null;
      }
    }

    // 입사일/퇴사일 순서
    if (hireDate && exitDate && exitDate < hireDate) {
      showFormError('퇴사일이 입사일보다 빠를 수 없어요.', el.formExitY);
      markDateError(el.formExitY, el.formExitM, el.formExitD);
      return null;
    }
    // 생년월일은 입사일보다 빨라야 함
    if (birthDate && hireDate && hireDate < birthDate) {
      showFormError('입사일이 생년월일보다 빠를 수 없어요. 날짜를 다시 확인해 주세요.', el.formHireY);
      markDateError(el.formHireY, el.formHireM, el.formHireD);
      return null;
    }

    // 중복 체크: 같은 회사 내에서 이름 + 생년월일 조합
    // (다른 회사에 같은 사람이 있는 건 정상 — 겸직)
    var editingId = _editingPerson ? _editingPerson.id : null;
    for (var i = 0; i < _persons.length; i++) {
      var p = _persons[i];
      if (!p) continue;
      if (editingId && p.id === editingId) continue;
      if ((p.name || '').trim() === name && p.birthDate === birthDate && p.company === company) {
        showFormError('"' + company + '" 회사에 이미 같은 이름+생년월일의 인력이 있어요. 기존 인력을 수정하거나, 다른 분이라면 생년월일을 확인해 주세요.', el.formName);
        return null;
      }
    }

    var isYouth = !!el.formIsYouth.checked;

    // 연봉 (콤마 허용)
    var annualSalary = parseMoney(el.formAnnualSalary.value);
    var monthlySalary = null;
    if (annualSalary != null) {
      if (annualSalary < 0) {
        showFormError('연봉은 0 이상의 숫자여야 해요.', el.formAnnualSalary);
        return null;
      }
      annualSalary = Math.round(annualSalary);
      monthlySalary = Math.ceil(annualSalary / 12);
    }

    var memo = (el.formMemo.value || '').trim();
    var status = exitDate ? 'exited' : 'active';
    var gender = getGenderRadio();

    // 주민번호 뒷자리 (숫자만 추출, 비어있으면 null)
    var ssnTailRaw = (el.formSsnTail && el.formSsnTail.value) ? el.formSsnTail.value.replace(/[^0-9]/g, '') : '';
    var ssnTail = ssnTailRaw || null;

    // §4.4: 연봉 변경 시점 검증 — 부분 입력/형식 오류 행을 조용히 버리지 않고 막음
    //   (예: 월을 "2026"만 입력, 연봉만 입력 등 → 저장 시 사라지는 문제 방지)
    syncSalaryChangesFromDom();
    var _scBad = [];
    _modalSalaryChanges.forEach(function (c, i) {
      var fromStr = (c && c.from != null) ? String(c.from).trim() : '';
      var salDigits = String((c && c.annualSalary != null) ? c.annualSalary : '').replace(/[^\d]/g, '');
      if (fromStr === '' && salDigits === '') return;            // 완전 빈 행 — 무시
      var okFrom = !!normalizeYm(fromStr);
      var okSal  = salDigits !== '' && Number(salDigits) > 0;
      if (!okFrom || !okSal) _scBad.push(i + 1);
    });
    if (_scBad.length) {
      showFormError('연봉 변경 시점 ' + _scBad.join(', ') + '행: 월(예: 2026-07)과 새 연봉을 모두 정확히 입력하거나, 빈 행은 ✕로 지워 주세요.', el.formSalaryChanges);
      return null;
    }

    return {
      name: name,
      company: company,
      birthDate: birthDate,
      gender: gender,
      ssnTail: ssnTail,
      hireDate: hireDate,
      exitDate: exitDate,
      isYouth: isYouth,
      annualSalary: annualSalary,
      monthlySalary: monthlySalary,
      salarySlots: collectSalarySlotsFromForm(),
      salaryChanges: collectSalaryChangesFromForm(),
      memo: memo,
      status: status
    };
  }

  function setSaving(saving) {
    _saving = !!saving;
    if (el.modalSave) {
      el.modalSave.disabled = !!saving;
      el.modalSave.textContent = saving ? '저장 중…' : '저장';
    }
    if (el.modalCancel) el.modalCancel.disabled = !!saving;
    if (el.modalDelete) el.modalDelete.disabled = !!saving;
    if (el.modalClose)  el.modalClose.disabled = !!saving;
  }

  function onModalSave() {
    if (_saving) return;
    var data = readForm();
    if (!data) return;

    var svc = window.firestoreService;
    if (!svc) {
      alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }

    setSaving(true);

    var task = _editingPerson
      ? svc.updatePerson(_editingPerson.id, data)
      : svc.addPerson(data);

    task.then(function () {
      setSaving(false);
      closeModal();
    }).catch(function (err) {
      console.error('인력 저장 실패:', err);
      setSaving(false);
      alert('저장에 실패했어요.\n\n' + (err && err.message ? err.message : '잠시 후 다시 시도해 주세요.'));
    });
  }

  function onModalDelete() {
    if (_saving) return;
    if (!_editingPerson) return;

    var name = _editingPerson.name || '(이름 없음)';
    var ok = confirm(
      '"' + name + '" 인력을 완전히 삭제할까요?\n\n' +
      '⚠️ 이 작업은 되돌릴 수 없어요.\n' +
      '퇴직 처리만 원하시면 "취소"를 누르고 퇴사일을 입력해 주세요.'
    );
    if (!ok) return;

    var svc = window.firestoreService;
    if (!svc) {
      alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }

    setSaving(true);
    svc.deletePerson(_editingPerson.id).then(function () {
      setSaving(false);
      closeModal();
    }).catch(function (err) {
      console.error('인력 삭제 실패:', err);
      setSaving(false);
      alert('삭제에 실패했어요.\n\n' + (err && err.message ? err.message : '잠시 후 다시 시도해 주세요.'));
    });
  }

  function onModalKeydown(e) {
    if (!el.modal || el.modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onModalSave(); }
  }

  function onModalOverlayClick(e) {
    if (e.target === el.modal) closeModal();
  }

  function bindModalEvents() {
    if (el.modalClose)  el.modalClose.addEventListener('click', closeModal);
    if (el.modalCancel) el.modalCancel.addEventListener('click', closeModal);
    if (el.modalSave)   el.modalSave.addEventListener('click', onModalSave);
    if (el.modalDelete) el.modalDelete.addEventListener('click', onModalDelete);
    if (el.modal)       el.modal.addEventListener('click', onModalOverlayClick);
    document.addEventListener('keydown', onModalKeydown);

    if (el.formName) {
      el.formName.addEventListener('input', function () {
        if (el.formError && !el.formError.hidden) clearFormError();
      });
    }
    if (el.formAnnualSalary) {
      el.formAnnualSalary.addEventListener('input', onAnnualSalaryInput);
    }
    if (el.formAddSlot) {
      el.formAddSlot.addEventListener('click', onAddSlot);
    }
    if (el.formSalarySlots) {
      el.formSalarySlots.addEventListener('input', onSlotInput);
    }
    if (el.formAddSalaryChange) {
      el.formAddSalaryChange.addEventListener('click', onAddSalaryChange);
    }
    if (el.formSalaryChanges) {
      el.formSalaryChanges.addEventListener('input', onSalaryChangeInput);
      el.formSalaryChanges.addEventListener('click', onSalaryChangeClick);
    }

    // Y/M/D 3칸 자동 이동
    attachNumericAutoMove([el.formBirthY, el.formBirthM, el.formBirthD]);
    attachNumericAutoMove([el.formHireY,  el.formHireM,  el.formHireD]);
    attachNumericAutoMove([el.formExitY,  el.formExitM,  el.formExitD]);

    // 생년월일 변경 시 주민번호 앞자리 표시 자동 갱신
    [el.formBirthY, el.formBirthM, el.formBirthD].forEach(function (input) {
      if (input) input.addEventListener('input', updateSsnFrontDisplay);
    });

    // 주민번호 뒷자리 입력 시 성별 자동 판정
    if (el.formSsnTail) {
      el.formSsnTail.addEventListener('input', onSsnTailInput);
    }

    // 성별 라디오 변경 시 시각 강조 갱신
    [el.formGenderNone, el.formGenderM, el.formGenderF].forEach(function (radio) {
      if (!radio) return;
      radio.addEventListener('change', updateGenderRadioStyles);
    });

    // 회사 라디오 변경 시 시각 강조 갱신
    [el.formCompanySixty, el.formCompanyGoodnews, el.formCompanyParity].forEach(function (radio) {
      if (!radio) return;
      radio.addEventListener('change', updateCompanyRadioStyles);
    });
  }

  // ====================================================================
  // 명부 업로드 (엑셀)
  // ====================================================================
  var _uploading = false;
  var _selectedCompany = null;  // 회사 선택 모달에서 선택한 회사 (업로드 중에만 유지)

  var EXCEL_BTN_INNER_HTML =
    '<svg class="excel-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#217346"/>' +
    '<path d="M14 2v6h6" fill="#1e5c38"/>' +
    '<path d="M8 11v8h8V11H8z" fill="rgba(255,255,255,0.2)"/>' +
    '<path d="M8 13h8M8 16h8M8 19h5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.95"/>' +
    '</svg>명부 업로드';

  /**
   * 명부 업로드 버튼 클릭 → 회사 선택 모달 열기
   */
  function onExcelUploadClick() {
    if (_uploading) return;
    openCompanySelectModal();
  }

  function openCompanySelectModal() {
    if (!el.companySelectModal) return;
    el.companySelectModal.hidden = false;
  }

  function closeCompanySelectModal() {
    if (!el.companySelectModal) return;
    el.companySelectModal.hidden = true;
  }

  /**
   * 회사 선택 → 파일 선택 다이얼로그 열기
   */
  function onCompanyOptionClick(company) {
    _selectedCompany = company;
    closeCompanySelectModal();

    if (!el.excelInput) return;
    el.excelInput.value = '';  // 같은 파일 다시 올려도 동작하게
    el.excelInput.click();
  }

  function onExcelFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) {
      _selectedCompany = null;
      return;
    }
    if (!_selectedCompany) {
      alert('회사가 선택되지 않았어요. 다시 시도해 주세요.');
      return;
    }
    handleExcelUpload(file, _selectedCompany);
  }

  function handleExcelUpload(file, company) {
    _uploading = true;
    if (el.excelUploadBtn) {
      el.excelUploadBtn.disabled = true;
      el.excelUploadBtn.textContent = '업로드 중…';
    }

    parseExcelFile(file).then(function (rows) {
      if (!rows.length) {
        alert(
          '엑셀에서 읽은 인력 데이터가 없어요.\n' +
          '필수 컬럼이 있는지 확인해 주세요:\n' +
          '  • 이름 (또는 "성명")\n' +
          '  • 자격취득일 (또는 "취득일", "입사일")'
        );
        return Promise.resolve();
      }

      // 명부 행에 회사 정보 추가
      rows.forEach(function (row) { row.company = company; });

      var current = _persons.slice();
      var merged = buildMergedPersonsList(rows, current);
      var s = merged.summary;

      // 자동 추출 통계 (성별 / 생년월일 / 주민번호 뒷자리)
      var withGender = 0, withBirth = 0, withSsnTail = 0;
      rows.forEach(function (row) {
        if (row.gender) withGender++;
        if (row.birthDate) withBirth++;
        if (row.ssnTail) withSsnTail++;
      });

      var msg = '';
      msg += '📊 [' + company + '] 명부 업로드 미리보기\n\n';
      msg += '  • 총 ' + s.total + '명 읽음\n';
      msg += '  • 신규 추가: ' + s.added + '명\n';
      msg += '  • 업데이트: ' + s.updated + '명 (자격취득일/상실일 등 변경)\n';
      msg += '  • 변경 없음: ' + s.skipped + '명\n';
      msg += '\n📋 자동 추출:\n';
      msg += '  • 생년월일: ' + withBirth + '/' + s.total + '명\n';
      msg += '  • 성별: ' + withGender + '/' + s.total + '명\n';
      msg += '  • 주민번호 뒷자리(첫숫자): ' + withSsnTail + '/' + s.total + '명\n';
      if (s.added > 0 && s.addedNames.length) {
        var preview = s.addedNames.slice(0, 5).join(', ');
        if (s.addedNames.length > 5) preview += ' 외 ' + (s.addedNames.length - 5) + '명';
        msg += '\n신규: ' + preview + '\n';
      }
      msg += '\n적용할까요?';

      if (!confirm(msg)) {
        return Promise.resolve();
      }

      var svc = window.firestoreService;
      if (!svc) {
        alert('firestoreService 가 없어요. 새로고침 후 다시 시도해 주세요.');
        return Promise.resolve();
      }
      return svc.savePersons(merged.list).then(function () {
        alert(
          '✅ [' + company + '] 명부 업로드 완료!\n\n' +
          '  • 신규 추가: ' + s.added + '명\n' +
          '  • 업데이트: ' + s.updated + '명\n' +
          '  • 변경 없음: ' + s.skipped + '명'
        );
      });
    }).catch(function (err) {
      console.error('명부 업로드 실패:', err);
      alert('업로드에 실패했어요.\n\n' + (err && err.message ? err.message : '잠시 후 다시 시도해 주세요.'));
    }).then(function () {
      _uploading = false;
      _selectedCompany = null;
      if (el.excelUploadBtn) {
        el.excelUploadBtn.disabled = false;
        el.excelUploadBtn.innerHTML = EXCEL_BTN_INNER_HTML;
      }
    });
  }

  // ====================================================================
  // 일괄 다운로드 (현재 명부)
  // ====================================================================

  // 다운로드/업로드 컬럼 정의 (순서 = 엑셀 컬럼 순서)
  // key는 내부 식별자, header는 엑셀에 보이는 헤더, width는 컬럼 너비(px)
  var BULK_COLUMNS = [
    { key: 'no',         header: 'No',              width: 5  },
    { key: 'id',         header: 'id (수정금지)',    width: 22 },
    { key: 'company',    header: '회사',             width: 10 },
    { key: 'name',       header: '이름',             width: 12 },
    { key: 'birthDate',  header: '생년월일',          width: 12 },
    { key: 'gender',     header: '성별',             width: 6  },
    { key: 'ssnTail',    header: '주민번호 뒷자리',    width: 18 },
    { key: 'hireDate',   header: '입사일',           width: 12 },
    { key: 'exitDate',   header: '퇴사일',           width: 12 },
    { key: 'annualSalary', header: '연봉(원)',       width: 14 },
    { key: 'isYouth',    header: '청년(Y/N)',        width: 10 },
    { key: 'memo',       header: '메모',             width: 25 }
  ];

  // C6 3단계 — 예산 전용 연봉(슬롯) 엑셀 컬럼
  //   헤더: '연봉:' + 슬롯명 (예: '연봉:제안서용(공개 가능)')
  //   '연봉(원)'(실제 연봉)은 '연봉(' 로 시작해 충돌 없음 → '연봉:' 접두로 슬롯만 식별
  var SLOT_COL_PREFIX = '연봉:';

  // 가용 슬롯(기본 ∪ 전 인력 키 합집합)을 다운로드/업로드 컬럼 정의로
  function getSlotColumns() {
    return getAvailableSlotNames().map(function (name) {
      return { key: 'slot:' + name, header: SLOT_COL_PREFIX + name, width: 16, slotName: name, isSlot: true };
    });
  }

  // 고정 컬럼 + 슬롯 컬럼 (슬롯은 '연봉(원)' 바로 뒤에 삽입)
  function getBulkColumns() {
    var cols = [];
    var slotCols = getSlotColumns();
    BULK_COLUMNS.forEach(function (c) {
      cols.push(c);
      if (c.key === 'annualSalary') {
        slotCols.forEach(function (sc) { cols.push(sc); });
      }
    });
    return cols;
  }

  // 금액 셀 파싱 (콤마/공백/'원' 제거 → 0 이상 정수, 그 외 null)
  function parseSalaryCell(raw) {
    if (raw === '' || raw == null) return null;
    var s = String(raw).replace(/[,\s원]/g, '');
    var n = Number(s);
    if (!isNaN(n) && n >= 0) return Math.round(n);
    return null;
  }

  function formatGenderForExcel(g) {
    if (g === 'M') return '남';
    if (g === 'F') return '여';
    return '';
  }

  function parseGenderFromExcel(s) {
    var v = String(s == null ? '' : s).trim();
    if (!v) return null;
    if (v === '남' || v === 'M' || v === 'm' || v === '남성') return 'M';
    if (v === '여' || v === 'F' || v === 'f' || v === '여성') return 'F';
    return null;
  }

  function formatBoolForExcel(b) {
    return b ? 'Y' : 'N';
  }

  function parseBoolFromExcel(s) {
    var v = String(s == null ? '' : s).trim().toLowerCase();
    if (!v) return false;
    if (v === 'y' || v === 'yes' || v === 'true' || v === '1' || v === '예' || v === 'o' || v === '청년') return true;
    return false;
  }

  function buildBulkRows(persons) {
    // 회사/이름 순 정렬 (보기 편하게)
    var sorted = (persons || []).slice().sort(function (a, b) {
      var ca = (a && a.company) || '~';
      var cb = (b && b.company) || '~';
      if (ca !== cb) return ca < cb ? -1 : 1;
      var na = (a && a.name) || '';
      var nb = (b && b.name) || '';
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });

    var slotCols = getSlotColumns();
    return sorted.map(function (p, idx) {
      var slots = (p.salarySlots && typeof p.salarySlots === 'object') ? p.salarySlots : {};
      var rowObj = {
        no: idx + 1,
        id: p.id || '',
        company: p.company || '',
        name: p.name || '',
        birthDate: p.birthDate || '',
        gender: formatGenderForExcel(p.gender),
        ssnTail: p.ssnTail || '',
        hireDate: p.hireDate || '',
        exitDate: p.exitDate || '',
        annualSalary: (p.annualSalary != null && !isNaN(p.annualSalary)) ? p.annualSalary : '',
        isYouth: formatBoolForExcel(!!p.isYouth),
        memo: p.memo || ''
      };
      // C6 3단계: 예산 전용 연봉(슬롯) 값
      slotCols.forEach(function (sc) {
        var v = slots[sc.slotName];
        rowObj[sc.key] = (v != null && !isNaN(v)) ? v : '';
      });
      return rowObj;
    });
  }

  function downloadBulkExcel() {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도해 주세요.');
      return;
    }

    var rows = buildBulkRows(_persons);
    if (!rows.length) {
      alert('다운로드할 인력이 없습니다.');
      return;
    }

    // 2D 배열로 변환 (헤더 + 데이터). C6 3단계: 고정 컬럼 + 슬롯 컬럼
    var cols = getBulkColumns();
    var headers = cols.map(function (c) { return c.header; });
    var data = [headers];
    rows.forEach(function (r) {
      data.push(cols.map(function (c) { return r[c.key]; }));
    });

    var ws = XLSX.utils.aoa_to_sheet(data);

    // 컬럼 너비 설정
    ws['!cols'] = cols.map(function (c) { return { wch: c.width }; });

    // 금액 컬럼(실제 연봉 + 슬롯)을 숫자 형식으로 (천단위 콤마)
    var moneyColIdxs = [];
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].key === 'annualSalary' || cols[i].isSlot) moneyColIdxs.push(i);
    }
    moneyColIdxs.forEach(function (ci) {
      for (var r = 1; r < data.length; r++) {
        var cellAddr = XLSX.utils.encode_cell({ r: r, c: ci });
        var cell = ws[cellAddr];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = '#,##0';
        }
      }
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '인력 마스터');

    // 파일명: 인력_마스터_YYYYMMDD.xlsx
    var d = new Date();
    var ymd = d.getFullYear()
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, '인력_마스터_' + ymd + '.xlsx');
  }

  // ====================================================================
  // 일괄 업데이트 (다운로드한 엑셀로 다시 올리기)
  // ====================================================================
  function parseBulkEditFile(file) {
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

          // 헤더 행에서 컬럼 인덱스 매핑 (헤더 텍스트로 찾음 - 컬럼 순서 바뀌어도 OK)
          var headerRow = rows[0];
          var colIdx = {};
          BULK_COLUMNS.forEach(function (c) {
            colIdx[c.key] = -1;
          });
          headerRow.forEach(function (cell, idx) {
            var h = String(cell == null ? '' : cell).trim();
            BULK_COLUMNS.forEach(function (c) {
              if (colIdx[c.key] < 0 && c.header === h) {
                colIdx[c.key] = idx;
              }
            });
          });

          // C6 3단계: '연봉:슬롯명' 헤더 → 슬롯 컬럼 매핑
          //   ('연봉(원)'은 '연봉(' 으로 시작해 '연봉:' 접두와 충돌 없음)
          var slotColMap = [];   // [{ slotName, idx }]
          headerRow.forEach(function (cell, idx) {
            var h = String(cell == null ? '' : cell).trim();
            if (h.indexOf(SLOT_COL_PREFIX) === 0) {
              var slotName = sanitizeSlotName(h.slice(SLOT_COL_PREFIX.length));
              if (slotName) slotColMap.push({ slotName: slotName, idx: idx });
            }
          });

          // 필수 컬럼 확인: id, 이름
          if (colIdx.id < 0 || colIdx.name < 0) {
            reject(new Error(
              '엑셀 형식이 올바르지 않습니다.\n\n' +
              '"id (수정금지)"와 "이름" 컬럼이 필요해요.\n' +
              '"전체 다운로드" 버튼으로 받은 양식을 사용해 주세요.'
            ));
            return;
          }

          var result = [];
          for (var r = 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !Array.isArray(row)) continue;
            var name = String(row[colIdx.name] != null ? row[colIdx.name] : '').trim();
            if (!name) continue;

            var id = String(row[colIdx.id] != null ? row[colIdx.id] : '').trim();

            // 연봉 파싱 (콤마/공백 제거)
            var annualSalary = null;
            if (colIdx.annualSalary >= 0) {
              var rawSalary = row[colIdx.annualSalary];
              if (rawSalary !== '' && rawSalary != null) {
                var salaryStr = String(rawSalary).replace(/[,\s원]/g, '');
                var n = Number(salaryStr);
                if (!isNaN(n) && n >= 0) {
                  annualSalary = Math.round(n);
                }
              }
            }

            // 주민번호 뒷자리 (숫자만 추출)
            var ssnTail = null;
            if (colIdx.ssnTail >= 0) {
              var rawSsn = row[colIdx.ssnTail];
              if (rawSsn !== '' && rawSsn != null) {
                var ssnStr = String(rawSsn).replace(/[^0-9]/g, '');
                if (ssnStr) ssnTail = ssnStr;
              }
            }

            // C6 3단계: 슬롯 컬럼 → salarySlots (양수만, 빈 칸은 미설정)
            var salarySlots = {};
            slotColMap.forEach(function (sc) {
              var sv = parseSalaryCell(row[sc.idx]);
              if (sv != null && sv > 0) salarySlots[sc.slotName] = sv;
            });

            result.push({
              id: id || null,
              name: name,
              company: colIdx.company >= 0 ? String(row[colIdx.company] || '').trim() || null : null,
              birthDate: colIdx.birthDate >= 0 ? normalizeBirthFromExcel(row[colIdx.birthDate]) : null,
              gender: colIdx.gender >= 0 ? parseGenderFromExcel(row[colIdx.gender]) : null,
              ssnTail: ssnTail,
              hireDate: colIdx.hireDate >= 0 ? normalizeExcelDate(row[colIdx.hireDate]) : null,
              exitDate: colIdx.exitDate >= 0 ? normalizeExcelDate(row[colIdx.exitDate]) : null,
              annualSalary: annualSalary,
              isYouth: colIdx.isYouth >= 0 ? parseBoolFromExcel(row[colIdx.isYouth]) : false,
              memo: colIdx.memo >= 0 ? String(row[colIdx.memo] || '').trim() : '',
              salarySlots: salarySlots,
              _rowNum: r + 1  // 사용자가 엑셀에서 보는 행 번호 (에러 메시지용)
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
   * 일괄 업데이트 병합:
   * - id 있는 행 → 해당 id의 인력 업데이트 (덮어쓰기)
   * - id 없는 행 → 신규 추가 (회사·이름·생년월일 모두 있어야 함)
   * - 변경 없는 행은 skip
   */
  function buildBulkUpdateList(editedRows, current) {
    var list = (current || []).slice();
    var idToPerson = {};
    list.forEach(function (p) { if (p && p.id) idToPerson[p.id] = p; });

    var updated = 0, added = 0, skipped = 0, errors = [];
    var addedNames = [];

    editedRows.forEach(function (row) {
      if (row.id) {
        // 업데이트 경로
        var existing = idToPerson[row.id];
        if (!existing) {
          errors.push('행 ' + row._rowNum + ': id "' + row.id + '"에 해당하는 인력을 찾을 수 없어요.');
          return;
        }

        var changed = false;
        // 이름 변경 (드물지만 가능)
        if (row.name && row.name !== existing.name) {
          existing.name = row.name;
          changed = true;
        }
        // 회사
        if (row.company && row.company !== existing.company) {
          existing.company = row.company;
          changed = true;
        }
        // 생년월일
        if (row.birthDate && row.birthDate !== existing.birthDate) {
          existing.birthDate = row.birthDate;
          changed = true;
        }
        // 성별
        if (row.gender && row.gender !== existing.gender) {
          existing.gender = row.gender;
          changed = true;
        }
        // 주민번호 뒷자리 (★ 핵심: 빈 값 아닌 경우만 덮어씀)
        if (row.ssnTail && row.ssnTail !== existing.ssnTail) {
          existing.ssnTail = row.ssnTail;
          changed = true;
        }
        // 입사일
        if (row.hireDate && row.hireDate !== existing.hireDate) {
          existing.hireDate = row.hireDate;
          changed = true;
        }
        // 퇴사일 (빈 값으로 만드는 것도 허용 — 재직 복귀)
        var newExit = row.exitDate || null;
        if (newExit !== (existing.exitDate || null)) {
          existing.exitDate = newExit;
          existing.status = newExit ? 'exited' : 'active';
          changed = true;
        }
        // 연봉 (★ 핵심: 빈 값 아닌 경우만 덮어씀, salaryHistory 보류)
        if (row.annualSalary != null && row.annualSalary !== existing.annualSalary) {
          existing.annualSalary = row.annualSalary;
          existing.monthlySalary = Math.ceil(row.annualSalary / 12);
          changed = true;
        }
        // 청년
        if (row.isYouth !== !!existing.isYouth) {
          existing.isYouth = !!row.isYouth;
          changed = true;
        }
        // 메모 (빈 메모로 덮는 것도 허용)
        if ((row.memo || '') !== (existing.memo || '')) {
          existing.memo = row.memo || '';
          changed = true;
        }
        // C6 3단계: 예산 전용 연봉(슬롯) — 비어있지 않은 슬롯만 병합(비파괴)
        //   (빈 칸은 변경 없음 = 실제 연봉과 동일 규칙. 슬롯 삭제는 편집 모달에서)
        if (row.salarySlots && Object.keys(row.salarySlots).length) {
          var curSlots = (existing.salarySlots && typeof existing.salarySlots === 'object') ? existing.salarySlots : {};
          var mergedSlots = {};
          Object.keys(curSlots).forEach(function (k) { mergedSlots[k] = curSlots[k]; });
          var slotChanged = false;
          Object.keys(row.salarySlots).forEach(function (k) {
            if (mergedSlots[k] !== row.salarySlots[k]) { mergedSlots[k] = row.salarySlots[k]; slotChanged = true; }
          });
          if (slotChanged) { existing.salarySlots = mergedSlots; changed = true; }
        }

        if (changed) {
          existing.updatedAt = new Date().toISOString();
          updated++;
        } else {
          skipped++;
        }
      } else {
        // 신규 추가 경로 — id가 비어있음
        // 필수 검증: 회사, 이름, 생년월일
        if (!row.company) {
          errors.push('행 ' + row._rowNum + ' (' + row.name + '): 신규 추가 행은 "회사"가 필요해요.');
          return;
        }
        if (!row.birthDate) {
          errors.push('행 ' + row._rowNum + ' (' + row.name + '): 신규 추가 행은 "생년월일"이 필요해요.');
          return;
        }
        // 회사값이 우리가 아는 회사인지 확인
        if (row.company !== '식스티' && row.company !== '굿뉴스' && row.company !== '패리티') {
          errors.push('행 ' + row._rowNum + ' (' + row.name + '): 회사는 "식스티", "굿뉴스", "패리티" 중 하나여야 해요.');
          return;
        }
        // 같은 회사 내 이름+생년월일 중복 검사
        var dup = false;
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (!p) continue;
          if ((p.name || '') === row.name && p.birthDate === row.birthDate && p.company === row.company) {
            dup = true;
            break;
          }
        }
        if (dup) {
          errors.push('행 ' + row._rowNum + ' (' + row.name + '): "' + row.company + '" 회사에 이미 같은 이름+생년월일의 인력이 있어요.');
          return;
        }

        var now = new Date().toISOString();
        var newPerson = {
          id: makeLocalPersonId(),
          name: row.name,
          company: row.company,
          birthDate: row.birthDate,
          gender: row.gender || null,
          ssnTail: row.ssnTail || null,
          hireDate: row.hireDate || null,
          exitDate: row.exitDate || null,
          isYouth: !!row.isYouth,
          annualSalary: row.annualSalary,
          monthlySalary: row.annualSalary != null ? Math.ceil(row.annualSalary / 12) : null,
          memo: row.memo || '',
          status: row.exitDate ? 'exited' : 'active',
          createdAt: now,
          updatedAt: now
        };
        // C6 3단계: 신규 인력의 예산 전용 연봉(슬롯)
        if (row.salarySlots && Object.keys(row.salarySlots).length) {
          newPerson.salarySlots = row.salarySlots;
        }
        list.push(newPerson);
        idToPerson[newPerson.id] = newPerson;
        added++;
        addedNames.push(row.name);
      }
    });

    return {
      list: list,
      summary: {
        updated: updated,
        added: added,
        skipped: skipped,
        total: editedRows.length,
        addedNames: addedNames,
        errors: errors
      }
    };
  }

  function onBulkDownloadClick() {
    downloadBulkExcel();
  }

  function onBulkEditBtnClick() {
    if (!el.bulkEditInput) return;
    el.bulkEditInput.value = '';  // 같은 파일 다시 올려도 동작하게
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

    parseBulkEditFile(file).then(function (rows) {
      if (!rows.length) {
        throw new Error('엑셀에서 인력 데이터를 찾지 못했어요. 파일을 확인해 주세요.');
      }

      var merged = buildBulkUpdateList(rows, _persons);
      var s = merged.summary;

      // 미리보기 메시지
      var msgParts = [];
      msgParts.push('총 ' + s.total + '개 행을 읽었어요.');
      if (s.updated) msgParts.push('• 업데이트: ' + s.updated + '명');
      if (s.added) {
        msgParts.push('• 신규 추가: ' + s.added + '명');
        if (s.addedNames && s.addedNames.length) {
          var preview = s.addedNames.slice(0, 5).join(', ');
          if (s.addedNames.length > 5) preview += ' 외 ' + (s.addedNames.length - 5) + '명';
          msgParts.push('   (' + preview + ')');
        }
      }
      if (s.skipped) msgParts.push('• 변경 없음(건너뜀): ' + s.skipped + '명');
      if (s.errors && s.errors.length) {
        msgParts.push('');
        msgParts.push('⚠️ ' + s.errors.length + '개 행에 문제가 있어요:');
        s.errors.slice(0, 10).forEach(function (er) { msgParts.push('  - ' + er); });
        if (s.errors.length > 10) msgParts.push('  ... 외 ' + (s.errors.length - 10) + '건');
      }

      if (s.updated === 0 && s.added === 0) {
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
        if (s.added) resultParts.push('  신규 추가 ' + s.added + '명');
        alert(resultParts.join('\n'));
      });
    }).catch(function (err) {
      console.error('일괄 업데이트 실패:', err);
      alert((err && err.message) ? err.message : '일괄 업데이트에 실패했어요.');
    }).then(function () {
      if (el.bulkEditBtn) {
        el.bulkEditBtn.disabled = false;
        el.bulkEditBtn.innerHTML = BULK_EDIT_BTN_INNER_HTML;
      }
    });
  }

  // 버튼 innerHTML 백업 (업로드 중 텍스트 변경 후 복원용 — init에서 채워짐)
  var BULK_EDIT_BTN_INNER_HTML = '';


  function onMigrationBannerClick() {
    _filter.missingBirthOnly = !_filter.missingBirthOnly;
    if (el.migrationBanner) {
      if (_filter.missingBirthOnly) {
        el.migrationBanner.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.3)';
      } else {
        el.migrationBanner.style.boxShadow = '';
      }
    }
    render();
  }

  // ====================================================================
  // 일반 이벤트
  // ====================================================================
  function onSearchInput() {
    _filter.keyword = el.search.value || '';
    if (el.searchWrap) {
      if (_filter.keyword) el.searchWrap.classList.add('has-value');
      else el.searchWrap.classList.remove('has-value');
    }
    render();
  }

  function onSearchClear() {
    if (!el.search) return;
    el.search.value = '';
    onSearchInput();
    el.search.focus();
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

  function onFilterGenderChange() {
    _filter.gender = el.filterGender.value || 'all';
    render();
  }

  function onFilterAgeChange() {
    _filter.ageBucket = el.filterAge.value || 'all';
    render();
  }

  function onFilterYouthChange() {
    _filter.youthOnly = !!el.filterYouth.checked;
    render();
  }

  function onAddBtnClick() {
    openModal(null);
  }

  function onTableClick(e) {
    var btn = e.target.closest && e.target.closest('button[data-action="edit"]');
    if (!btn) return;
    var id = btn.getAttribute('data-person-id') || '';
    var p = null;
    for (var i = 0; i < _persons.length; i++) {
      if (_persons[i] && _persons[i].id === id) { p = _persons[i]; break; }
    }
    if (!p) {
      alert('해당 인력을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
      return;
    }
    openModal(p);
  }

  function bindEvents() {
    if (el.search)         el.search.addEventListener('input', onSearchInput);
    if (el.searchClear)    el.searchClear.addEventListener('click', onSearchClear);
    if (el.filterStatus)   el.filterStatus.addEventListener('change', onFilterStatusChange);
    if (el.filterGender)   el.filterGender.addEventListener('change', onFilterGenderChange);
    if (el.filterAge)      el.filterAge.addEventListener('change', onFilterAgeChange);
    if (el.filterYouth)    el.filterYouth.addEventListener('change', onFilterYouthChange);
    if (el.addBtn)         el.addBtn.addEventListener('click', onAddBtnClick);
    if (el.tbody)          el.tbody.addEventListener('click', onTableClick);
    if (el.excelUploadBtn) el.excelUploadBtn.addEventListener('click', onExcelUploadClick);
    if (el.excelInput)     el.excelInput.addEventListener('change', onExcelFileChange);
    if (el.bulkDownloadBtn) el.bulkDownloadBtn.addEventListener('click', onBulkDownloadClick);
    if (el.bulkEditBtn)     el.bulkEditBtn.addEventListener('click', onBulkEditBtnClick);
    if (el.bulkEditInput)   el.bulkEditInput.addEventListener('change', onBulkEditFileChange);

    // 정렬 헤더 (만나이/입사일/퇴사일/월급) — 클릭 및 키보드(Enter/Space)
    var sortHeaders = document.querySelectorAll('#persons-table th.th-sortable');
    sortHeaders.forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!key) return;
      th.addEventListener('click', function () { onSortHeaderClick(key); });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSortHeaderClick(key);
        }
      });
    });

    // 회사 선택 모달 이벤트
    if (el.companySelectClose) {
      el.companySelectClose.addEventListener('click', closeCompanySelectModal);
    }
    if (el.companySelectModal) {
      // 오버레이 클릭 시 닫기
      el.companySelectModal.addEventListener('click', function (e) {
        if (e.target === el.companySelectModal) closeCompanySelectModal();
      });
      // 옵션 클릭 시 처리
      el.companySelectModal.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button.company-option');
        if (!btn) return;
        var company = btn.getAttribute('data-company');
        if (!company) return;
        onCompanyOptionClick(company);
      });
    }

    if (el.migrationBanner) {
      el.migrationBanner.addEventListener('click', onMigrationBannerClick);
      el.migrationBanner.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onMigrationBannerClick();
        }
      });
    }
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    el.tbody         = $('persons-tbody');
    el.tableWrap     = $('persons-table-wrap');
    el.empty         = $('persons-empty');
    el.emptyTitle    = $('persons-empty-title');
    el.emptyDesc     = $('persons-empty-desc');
    el.countHint     = $('person-count-hint');
    el.search        = $('person-search');
    el.searchWrap    = $('search-wrap');
    el.searchClear   = $('search-clear');
    el.filterStatus  = $('filter-status');
    el.filterGender  = $('filter-gender');
    el.filterAge     = $('filter-age');
    el.filterYouth   = $('filter-youth');
    el.addBtn        = $('person-add-btn');
    el.statTotal     = $('stat-total');
    el.statTotalSub  = $('stat-total-sub');
    el.statActive    = $('stat-active');
    el.statActiveSub = $('stat-active-sub');
    el.statYouth     = $('stat-youth');
    el.statExited    = $('stat-exited');

    el.excelInput     = $('excel-input');
    el.excelUploadBtn = $('excel-upload-btn');
    el.bulkDownloadBtn = $('bulk-download-btn');
    el.bulkEditBtn     = $('bulk-edit-btn');
    el.bulkEditInput   = $('bulk-edit-input');

    // 일괄 업데이트 버튼 innerHTML 백업 (업로드 중 텍스트 바꿨다가 복원하기 위함)
    if (el.bulkEditBtn) {
      BULK_EDIT_BTN_INNER_HTML = el.bulkEditBtn.innerHTML;
    }

    el.migrationBanner     = $('migration-banner');
    el.migrationBannerText = $('migration-banner-text');

    el.modal             = $('person-modal');
    el.modalTitle        = $('person-modal-title');
    el.modalClose        = $('person-modal-close');
    el.modalCancel       = $('person-modal-cancel');
    el.modalSave         = $('person-modal-save');
    el.modalDelete       = $('person-modal-delete');
    el.formName          = $('form-name');
    el.formError         = $('form-error');
    el.formIsYouth       = $('form-is-youth');
    el.formAnnualSalary  = $('form-annual-salary');
    el.annualSalaryHint  = $('annual-salary-hint');
    el.formSalarySlots   = $('form-salary-slots');
    el.formAddSlot       = $('form-add-slot');
    el.formSalaryChanges = $('form-salary-changes');
    el.formAddSalaryChange = $('form-add-salary-change');
    el.formExitDateRow   = $('form-exit-date-row');
    el.formMemo          = $('form-memo');

    el.formGenderNone = $('form-gender-none');
    el.formGenderM    = $('form-gender-m');
    el.formGenderF    = $('form-gender-f');

    el.formSsnTail  = $('form-ssn-tail');
    el.formSsnFront = $('form-ssn-front');
    el.ssnTailHint  = $('ssn-tail-hint');

    // 회사 라디오 (모달 안)
    el.formCompanySixty    = $('form-company-sixty');
    el.formCompanyGoodnews = $('form-company-goodnews');
    el.formCompanyParity   = $('form-company-parity');

    // 회사 선택 모달
    el.companySelectModal = $('company-select-modal');
    el.companySelectClose = $('company-select-close');

    el.formBirthY = $('form-birth-y'); el.formBirthM = $('form-birth-m'); el.formBirthD = $('form-birth-d');
    el.formHireY  = $('form-hire-y');  el.formHireM  = $('form-hire-m');  el.formHireD  = $('form-hire-d');
    el.formExitY  = $('form-exit-y');  el.formExitM  = $('form-exit-m');  el.formExitD  = $('form-exit-d');

    bindEvents();
    bindModalEvents();

    // 회사 필터 칩 (전 페이지 공유)
    if (window.CompanyFilter) {
      // 1) localStorage에 저장된 회사로 _filter.company 초기 동기화
      var savedCompany = window.CompanyFilter.get();
      _filter.company = savedCompany || 'all';
      // 2) 칩 UI 렌더링 + 클릭 시 재렌더
      window.CompanyFilter.mountChips('pm-company-chips', onFilterCompanyChange);
    }

    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('firestoreService.subscribePersons 가 없습니다. firestore-service.js 가 먼저 로드되었는지 확인하세요.');
      render();
      return;
    }

    window.firestoreService.subscribePersons(function (list) {
      _persons = Array.isArray(list) ? list : [];
      // 마이그레이션: company 없는 인력을 자동으로 식스티로 채움 (한 번만)
      migrateCompanyIfNeeded(_persons);
      // 마이그레이션: 과거 Math.round로 저장된 monthlySalary를 Math.ceil로 재계산 (한 번만)
      migrateMonthlySalaryIfNeeded(_persons);
      render();
    });

    render();
  }

  // ====================================================================
  // 겸직 진단 도구 (콘솔에서 사용)
  // 사용법: 콘솔에서 debugMoonlight() 호출
  // ====================================================================
  window.debugMoonlight = function () {
    console.log('==========================================');
    console.log('겸직 진단 시작 — 전체 인력:', _persons.length, '명');
    console.log('==========================================');

    // 1) 키 생성 진단
    var keyStats = { hasKey: 0, noKey: 0, noBirth: 0, noName: 0, noCompany: 0 };
    var nullKeyPersons = [];
    _persons.forEach(function (p) {
      if (!p) return;
      if (!p.name) { keyStats.noName++; return; }
      if (!p.birthDate) {
        keyStats.noBirth++;
        nullKeyPersons.push({ name: p.name, company: p.company, reason: '생년월일 없음' });
        return;
      }
      if (!getCompany(p)) { keyStats.noCompany++; return; }
      var k = getMoonlightKey(p);
      if (k) keyStats.hasKey++;
      else keyStats.noKey++;
    });
    console.log('[1] 키 생성 통계:', keyStats);
    if (nullKeyPersons.length) {
      console.log('[1-a] 생년월일 없어서 키 못 만든 인력 (겸직 매칭 불가):');
      console.table(nullKeyPersons);
    }

    // 2) 키별 그룹화
    var map = computeMoonlightMap(_persons);
    var keys = Object.keys(map);
    console.log('[2] 만들어진 키 수:', keys.length);

    // 3) 같은 키에 2명 이상인 그룹 찾기 (= 겸직 후보)
    var groups = [];
    keys.forEach(function (k) {
      var entry = map[k];
      if (entry.persons.length >= 2) {
        groups.push({
          key: k,
          count: entry.persons.length,
          companies: entry.companies.join(','),
          isAdminTransfer: entry.isAdminTransfer,
          persons: entry.persons.map(function (p) {
            return p.company + '(입:' + (p.hireDate || '-') + ', 퇴:' + (p.exitDate || '-') + ', 메모:"' + (p.memo || '') + '")';
          }).join(' | ')
        });
      }
    });
    console.log('[3] 같은 키에 2명 이상 묶인 그룹 (겸직 후보):', groups.length);
    if (groups.length) {
      console.table(groups);
    }

    // 4) 현재 뱃지가 표시되는 인력 (식스티 줄, 행정이관 아님, 회사 2개 이상)
    var showing = [];
    _persons.forEach(function (p) {
      if (!p) return;
      var info = getMoonlightInfo(p, map);
      if (info.isMoonlight) {
        showing.push({ name: p.name, company: p.company, others: info.others.join(',') });
      }
    });
    console.log('[4] 실제 화면에 뱃지가 뜨는 인력:', showing.length);
    if (showing.length) {
      console.table(showing);
    }

    // 5) 같은 이름인데 키가 달라서 매칭 못 한 케이스 찾기 (의심 케이스)
    var byName = {};
    _persons.forEach(function (p) {
      if (!p || !p.name || !p.company) return;
      if (!byName[p.name]) byName[p.name] = [];
      byName[p.name].push(p);
    });
    var sameName = [];
    Object.keys(byName).forEach(function (name) {
      var arr = byName[name];
      if (arr.length < 2) return;
      // 같은 이름인데 회사가 둘 이상
      var companies = {};
      arr.forEach(function (p) { companies[p.company] = true; });
      if (Object.keys(companies).length < 2) return;
      // 그런데 키로 묶이지 않은 경우
      var keys = arr.map(getMoonlightKey);
      var uniqueKeys = {};
      keys.forEach(function (k) { uniqueKeys[k || '(null)'] = true; });
      if (Object.keys(uniqueKeys).length > 1) {
        sameName.push({
          name: name,
          records: arr.map(function (p, i) {
            return p.company + ' [생:' + (p.birthDate || '-') + ', 뒷:' + (p.ssnTail || '-') + '] → 키:' + (keys[i] || '(null)');
          }).join('\n')
        });
      }
    });
    console.log('[5] 같은 이름·다른 회사인데 키가 달라서 매칭 실패한 의심 케이스:', sameName.length);
    if (sameName.length) {
      console.table(sameName);
      console.log('   → 위 사람들은 같은 사람일 가능성이 있어요. 생년월일/주민번호 뒷자리를 양쪽 모두 채워야 겸직으로 인식됩니다.');
    }

    console.log('==========================================');
    console.log('진단 끝. 자세히 보고 싶은 그룹이 있으면 알려주세요.');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

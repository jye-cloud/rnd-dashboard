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
 * - annualSalary 입력 시 monthlySalary는 자동으로 (연봉/12)로 같이 저장됨
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];               // Firestore에서 받아온 원본 배열
  var _filter = {
    keyword: '',                   // 이름 검색
    status: 'active',              // 'all' | 'active' | 'exited'
    company: 'all',                // 'all' | '식스티' | '굿뉴스' | '패리티' | 'unset'
    gender: 'all',                 // 'all' | 'M' | 'F' | 'unknown'
    ageBucket: 'all',              // 'all' | '20' | '30' | '40' | '50' | 'unknown'
    youthOnly: false,              // true면 isYouth=true만
    missingBirthOnly: false        // true면 birthDate 없는 인력만 (마이그레이션 배너 클릭 시)
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
    filterCompany: null,
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
   * 청년 여부를 종합 판정 (자동 + 수동 OR 조합)
   *  - 자동: 만 34세 이하 (정부 R&D 청년 기준)
   *  - 수동: person.isYouth === true (특수 케이스)
   * 둘 중 하나라도 해당하면 청년으로 간주.
   *
   * @returns {{ youth: boolean, reason: 'auto' | 'manual' | 'both' | null }}
   */
  function getYouthInfo(person) {
    if (!person) return { youth: false, reason: null };
    var manual = !!person.isYouth;
    var age = computeAge(person.birthDate);
    var auto = (age != null && age <= 34);

    if (auto && manual) return { youth: true, reason: 'both' };
    if (auto)           return { youth: true, reason: 'auto' };
    if (manual)         return { youth: true, reason: 'manual' };
    return { youth: false, reason: null };
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
   * 이름 + 생년월일 + ssnTail 첫 자리 (있는 경우만)
   * @returns {string | null} 키 또는 매칭에 사용 못할 데이터면 null
   */
  function getMoonlightKey(person) {
    if (!person) return null;
    var name = (person.name || '').trim();
    if (!name) return null;
    var birth = person.birthDate || '';
    var ssnFirst = '';
    if (person.ssnTail) {
      var s = String(person.ssnTail).replace(/[^0-9]/g, '');
      ssnFirst = s.charAt(0) || '';
    }
    // 생년월일이 있어야 매칭 가능 (이름만으로는 동명이인 위험)
    if (!birth) return null;
    return name + '|' + birth + '|' + ssnFirst;
  }

  /**
   * 전체 persons 배열에서 겸직 관계를 미리 계산.
   * 결과: { [moonlightKey]: [companyList] }
   * 같은 키에 회사가 2개 이상이면 → 겸직
   */
  function computeMoonlightMap(persons) {
    var map = {};
    for (var i = 0; i < persons.length; i++) {
      var p = persons[i];
      if (!p) continue;
      var key = getMoonlightKey(p);
      if (!key) continue;
      var company = getCompany(p);
      if (!company) continue;
      if (!map[key]) map[key] = [];
      if (map[key].indexOf(company) < 0) map[key].push(company);
    }
    return map;
  }

  /**
   * 특정 인력이 겸직인지 + 어느 회사들과 겸직인지 (자기 자신 제외)
   *
   * 정책: 식스티가 모회사, 굿뉴스·패리티가 자회사.
   * - 식스티 줄: 자회사에도 등록되어 있으면 → 겸직 표시 (본업이 자회사에 있다는 의미)
   * - 자회사 줄: 거기가 본업이므로 → 겸직 표시 안 함
   */
  function getMoonlightInfo(person, moonlightMap) {
    var key = getMoonlightKey(person);
    if (!key || !moonlightMap[key]) return { isMoonlight: false, others: [] };
    var myCompany = getCompany(person);
    var companies = moonlightMap[key];
    if (companies.length < 2) return { isMoonlight: false, others: [] };

    // 식스티(모회사) 줄에만 겸직 표시
    if (myCompany !== '식스티') return { isMoonlight: false, others: [] };

    var others = companies.filter(function (c) { return c !== myCompany; });
    return { isMoonlight: true, others: others };
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
            if (!mKey || !moonlightMap[mKey] || moonlightMap[mKey].length < 2) return false;
          } else {
            // 일반 상태 필터 (재직/퇴직)
            var st = p.status || 'active';
            if (st !== _filter.status) return false;
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

    // 행 배경: 퇴직이면 옅은 회색, 생년월일 미입력이면 옅은 노랑
    var rowStyle = '';
    if (isExited) rowStyle = 'style="color:#9ca3af;background:#fafafa"';
    else if (missingBirth) rowStyle = 'style="background:#fffbeb"';

    // 회사 뱃지
    var company = getCompany(p);
    var companyHtml = renderCompanyBadge(company);

    // 상태 뱃지
    var statusBadge = isExited
      ? '<span class="projects-badge projects-badge--end">퇴직</span>'
      : '<span class="projects-badge projects-badge--ongoing">재직</span>';

    // 이름 + 생년월일 미입력 경고 + 겸직 뱃지
    var nameContent = escapeHtml(p.name || '-');
    if (missingBirth) {
      nameContent += ' <span title="생년월일 미입력" style="color:#b45309;font-size:0.8rem">⚠️</span>';
    }
    if (moonlightMap) {
      var mInfo = getMoonlightInfo(p, moonlightMap);
      if (mInfo.isMoonlight) {
        var others = mInfo.others.join(', ');
        nameContent += '<span class="moonlight-badge" title="' + escapeHtml(others) + '와(과) 겸직">겸직</span>';
      }
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
      : (p.annualSalary != null && !isNaN(p.annualSalary) ? Math.round(p.annualSalary / 12) : null);

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

    // 정렬: 입사일 빠른 순 (오래된 사람이 위, 최근 입사자가 아래)
    // - 입사일 없으면 가장 뒤로
    // - 입사일 같으면 등록된 순서(createdAt)로
    // → 명부 업로드 시 명부 순서가 자연스럽게 유지됨
    var sorted = filtered.slice().sort(function (a, b) {
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
      el.formAnnualSalary.value = (annualVal === null || annualVal === undefined) ? '' : annualVal;
      el.formMemo.value = person.memo || '';
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
    var v = Number(el.formAnnualSalary.value);
    if (!isNaN(v) && v > 0) {
      var monthly = Math.round(v / 12);
      el.annualSalaryHint.innerHTML =
        '월급 환산: <strong>' + monthly.toLocaleString('ko-KR') + '원/월</strong> (자동 저장됨)';
      el.annualSalaryHint.style.color = '#047857';
    } else {
      el.annualSalaryHint.textContent = '비워두면 인건비 자동 계산에서 제외됩니다 (나중에 입력해도 OK)';
      el.annualSalaryHint.style.color = '';
    }
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

    // 연봉
    var salaryStr = (el.formAnnualSalary.value || '').trim();
    var annualSalary = null;
    var monthlySalary = null;
    if (salaryStr !== '') {
      var n = Number(salaryStr);
      if (isNaN(n) || n < 0) {
        showFormError('연봉은 0 이상의 숫자여야 해요.', el.formAnnualSalary);
        return null;
      }
      annualSalary = Math.round(n);
      monthlySalary = Math.round(annualSalary / 12);
    }

    var memo = (el.formMemo.value || '').trim();
    var status = exitDate ? 'exited' : 'active';
    var gender = getGenderRadio();

    // 주민번호 뒷자리 (숫자만 추출, 비어있으면 null)
    var ssnTailRaw = (el.formSsnTail && el.formSsnTail.value) ? el.formSsnTail.value.replace(/[^0-9]/g, '') : '';
    var ssnTail = ssnTailRaw || null;

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
      el.formAnnualSalary.addEventListener('input', updateAnnualSalaryHint);
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
  // 마이그레이션 배너
  // ====================================================================
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
    _filter.company = el.filterCompany.value || 'all';
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
    if (el.filterCompany)  el.filterCompany.addEventListener('change', onFilterCompanyChange);
    if (el.filterGender)   el.filterGender.addEventListener('change', onFilterGenderChange);
    if (el.filterAge)      el.filterAge.addEventListener('change', onFilterAgeChange);
    if (el.filterYouth)    el.filterYouth.addEventListener('change', onFilterYouthChange);
    if (el.addBtn)         el.addBtn.addEventListener('click', onAddBtnClick);
    if (el.tbody)          el.tbody.addEventListener('click', onTableClick);
    if (el.excelUploadBtn) el.excelUploadBtn.addEventListener('click', onExcelUploadClick);
    if (el.excelInput)     el.excelInput.addEventListener('change', onExcelFileChange);

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
    el.filterCompany = $('filter-company');
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

    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('firestoreService.subscribePersons 가 없습니다. firestore-service.js 가 먼저 로드되었는지 확인하세요.');
      render();
      return;
    }

    window.firestoreService.subscribePersons(function (list) {
      _persons = Array.isArray(list) ? list : [];
      // 마이그레이션: company 없는 인력을 자동으로 식스티로 채움 (한 번만)
      migrateCompanyIfNeeded(_persons);
      render();
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

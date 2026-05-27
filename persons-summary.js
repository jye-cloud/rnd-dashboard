/**
 * persons-summary.js
 *
 * 인력(persons) 관련 공통 유틸 모듈.
 * - persons-master, persons-detail, persons-dashboard 등 인력 관련 페이지에서 공유.
 * - 윈도우 글로벌 `window.PersonsSummary`로 노출.
 *
 * 책임:
 *   1. 날짜/나이 유틸 (computeAge, ageToBucket)
 *   2. 회사 상수/유틸 (COMPANIES, getCompany, renderCompanyBadge)
 *   3. 청년 판정 (getYouthInfo) — 만 34세 이하 자동 판정만
 *   4. 겸직 매핑 (getMoonlightKey, computeMoonlightMap, getMoonlightInfo)
 *   5. 카운트 계산 (getEffectiveCounts, getJoinLeaveCounts, getCountsAtDate)
 *
 * 카운팅 정책:
 *   - 전체/재직/퇴직: unique 기준 (같은 이름+생일=1명, "어딘가 재직"이면 재직)
 *   - 회사별: 등록 레코드 기준. 단, 식스티는 자회사 겸직자 제외
 *           (모회사 본업이 아닌 경우 식스티 카운트에서 빠지고 자회사 카운트에 포함됨)
 *   - 굿뉴스/패리티: 본업이므로 그대로 카운트
 *   - 청년: 만 34세 이하 (재직 unique 기준)
 *   - 시점 조회 (월말 기준 재직): 겸직 포함. 각 회사 레코드를 따로 셈
 */

(function (global) {
  'use strict';

  // ====================================================================
  // 1. 날짜 / 나이 유틸
  // ====================================================================

  /**
   * 만나이 계산 (기준일 기준).
   * @param {string} birthDateIso - 'YYYY-MM-DD' 형식
   * @param {Date} [refDate] - 기준일 (기본: 오늘)
   * @returns {number|null} 만나이. 파싱 실패 시 null.
   */
  function computeAge(birthDateIso, refDate) {
    if (!birthDateIso) return null;
    var parts = String(birthDateIso).split('-');
    if (parts.length < 3) return null;
    var by = parseInt(parts[0], 10);
    var bm = parseInt(parts[1], 10);
    var bd = parseInt(parts[2], 10);
    if (isNaN(by) || isNaN(bm) || isNaN(bd)) return null;

    var today = refDate instanceof Date ? refDate : new Date();
    var ty = today.getFullYear();
    var tm = today.getMonth() + 1;
    var td = today.getDate();

    var age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age--;

    if (age < 0 || age > 150) return null;
    return age;
  }

  /**
   * 만나이 → 연령대 ('10'|'20'|'30'|'40'|'50').
   */
  function ageToBucket(age) {
    if (age == null || isNaN(age)) return null;
    if (age < 20) return '10';
    if (age < 30) return '20';
    if (age < 40) return '30';
    if (age < 50) return '40';
    return '50';
  }

  /**
   * 날짜 문자열을 Date로 안전 파싱.
   * 'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/MM/DD', 'YYYYMMDD' 지원.
   * @returns {Date|null}
   */
  function parseDateSafe(str) {
    if (!str) return null;
    if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
    var s = String(str).trim();
    var m;
    // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
    m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (m) {
      var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return isNaN(d.getTime()) ? null : d;
    }
    // YYYYMMDD
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      var d2 = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return isNaN(d2.getTime()) ? null : d2;
    }
    return null;
  }

  /**
   * 어떤 달의 말일을 반환.
   * @param {number} year
   * @param {number} month - 1~12
   * @returns {Date}
   */
  function lastDayOfMonth(year, month) {
    return new Date(year, month, 0); // month는 1~12, Date의 day=0 이면 전월 말일
  }

  /**
   * Date를 'YYYY-MM-DD' 문자열로 변환.
   */
  function formatDateIso(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // ====================================================================
  // 2. 회사 상수 / 유틸
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

  /**
   * 회사 색상 토큰 (style.css와 일치).
   */
  var COMPANY_COLORS = {
    '식스티': { bg: '#e0e7ff', fg: '#1e3a8a' },
    '굿뉴스': { bg: '#ffedd5', fg: '#9a3412' },
    '패리티': { bg: '#d1fae5', fg: '#065f46' }
  };

  /**
   * 인력의 회사 반환. 유효한 회사가 아니면 null.
   */
  function getCompany(person) {
    if (!person) return null;
    var c = person.company;
    if (COMPANIES.indexOf(c) >= 0) return c;
    return null;
  }

  /**
   * 회사 뱃지 HTML 렌더링.
   */
  function renderCompanyBadge(company) {
    if (company && COMPANY_BADGE_CLASS[company]) {
      return '<span class="company-badge ' + COMPANY_BADGE_CLASS[company] + '">' +
             escapeHtml(company) + '</span>';
    }
    return '<span class="company-badge company-badge--unset">미지정</span>';
  }

  // 간단 escape (외부 의존 없이 동작하도록 내부에 둠)
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ====================================================================
  // 3. 청년 판정
  // ====================================================================

  /**
   * 청년 여부 자동 판정 (만 34세 이하).
   * v2 정책: 자동 판정만 사용. 수동 isYouth 체크는 더 이상 반영하지 않음.
   *          (군대 등 예외 케이스가 발생하면 나중에 재추가 가능)
   *
   * @param {object} person
   * @param {Date} [refDate] - 기준일 (기본: 오늘)
   * @returns {{ youth: boolean }}
   */
  function getYouthInfo(person, refDate) {
    if (!person) return { youth: false };
    var age = computeAge(person.birthDate, refDate);
    if (age == null) return { youth: false };
    return { youth: age <= 34 };
  }

  // ====================================================================
  // 4. 겸직 매핑
  // ====================================================================

  /**
   * 겸직 키: 같은 사람을 회사 간 매칭하기 위한 키 (이름 + 생년월일).
   * 생년월일이 없으면 매칭 불가 → null.
   */
  function getMoonlightKey(person) {
    if (!person) return null;
    var name = (person.name || '').trim();
    if (!name) return null;
    var birth = person.birthDate || '';
    if (!birth) return null;
    return name + '|' + birth;
  }

  /**
   * 전체 persons 배열에서 겸직 관계를 미리 계산.
   * 결과: { [moonlightKey]: { persons, companies, isAdminTransfer } }
   */
  function computeMoonlightMap(persons) {
    var map = {};
    if (!Array.isArray(persons)) return map;

    // 1단계: 키별로 묶기
    for (var i = 0; i < persons.length; i++) {
      var p = persons[i];
      if (!p) continue;
      var key = getMoonlightKey(p);
      if (!key) continue;
      var company = getCompany(p);
      if (!company) continue;
      if (!map[key]) {
        map[key] = { persons: [], companies: [], isAdminTransfer: false };
      }
      map[key].persons.push(p);
      if (map[key].companies.indexOf(company) < 0) {
        map[key].companies.push(company);
      }
    }
    // 2단계: 행정 이관 검사 (메모에 '이동' 포함되면 겸직 아님)
    Object.keys(map).forEach(function (key) {
      var entry = map[key];
      if (entry.persons.length < 2) return;
      entry.isAdminTransfer = checkAdminTransfer(entry.persons);
    });
    return map;
  }

  /**
   * 행정 이관 검사: 같은 사람의 레코드 중 하나라도 메모에 '이동'이 포함되면 true.
   */
  function checkAdminTransfer(personsOfSameKey) {
    for (var i = 0; i < personsOfSameKey.length; i++) {
      var memo = (personsOfSameKey[i] && personsOfSameKey[i].memo) || '';
      if (memo.indexOf('이동') >= 0) return true;
    }
    return false;
  }

  /**
   * 특정 인력이 겸직인지 + 어느 회사들과 겸직인지.
   *
   * 정책:
   * - 식스티(모회사) 줄: 자회사에도 같은 사람이 등록 → 겸직 표시
   * - 자회사 줄: 본업 → 겸직 표시 안 함
   * - 행정 이관 (메모 '이동'): 겸직 X
   *
   * @returns {{ isMoonlight, others, selfActive, subsidiaryActive }}
   */
  function getMoonlightInfo(person, moonlightMap) {
    var EMPTY = { isMoonlight: false, others: [], selfActive: false, subsidiaryActive: false };
    if (!person || !moonlightMap) return EMPTY;
    var key = getMoonlightKey(person);
    if (!key || !moonlightMap[key]) return EMPTY;
    var entry = moonlightMap[key];
    var myCompany = getCompany(person);
    if (!entry.companies || entry.companies.length < 2) return EMPTY;
    if (entry.isAdminTransfer) return EMPTY;

    // 식스티 줄에만 겸직 표시
    if (myCompany !== '식스티') return EMPTY;

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
    return {
      isMoonlight: true,
      others: others,
      selfActive: selfActive,
      subsidiaryActive: subsidiaryActive
    };
  }

  // ====================================================================
  // 5. 카운트 계산
  // ====================================================================

  /**
   * 어떤 인력이 "어디든 재직 중인가" 판단 (겸직 케이스 포함).
   * @param {object} person - 대표 레코드 (어느 회사 등록건이든 무관)
   * @param {object} moonlightMap
   * @returns {boolean}
   */
  function isActiveAnywhere(person, moonlightMap) {
    if (!person) return false;
    var key = getMoonlightKey(person);
    if (key && moonlightMap && moonlightMap[key]) {
      return moonlightMap[key].persons.some(function (rec) {
        return (rec.status || 'active') !== 'exited';
      });
    }
    // 키가 없거나 매핑 없으면 자기 자신만 보고 판단
    return (person.status || 'active') !== 'exited';
  }

  /**
   * 전체 persons 배열에서 unique 인력 목록을 추출.
   * - 같은 (이름+생일) 키를 가진 레코드는 1명으로 압축
   * - 대표 레코드: 재직 중인 자회사 레코드 우선, 없으면 첫 레코드
   * - 키가 없는 (생일 미입력) 인력은 개별로 모두 포함
   *
   * @returns {Array} unique 인력 배열
   */
  function getUniquePersons(persons, moonlightMap) {
    if (!Array.isArray(persons)) return [];
    var seen = {};
    var unique = [];
    persons.forEach(function (p) {
      if (!p) return;
      var key = getMoonlightKey(p);
      if (!key) {
        // 키 없음 → 개별
        unique.push(p);
        return;
      }
      if (seen[key]) return;
      seen[key] = true;
      // 대표 레코드 선택
      var entry = moonlightMap[key];
      if (entry && entry.persons.length > 1) {
        // 재직 중인 자회사 레코드 우선
        var subsidiary = entry.persons.find(function (rec) {
          return (rec.status || 'active') !== 'exited' && getCompany(rec) !== '식스티';
        });
        unique.push(subsidiary || entry.persons[0]);
      } else {
        unique.push(p);
      }
    });
    return unique;
  }

  /**
   * 요약카드용 카운트 일괄 계산.
   *
   * @param {Array} persons - 전체 인력 배열
   * @param {object} [options]
   * @param {Date}   [options.refDate] - 청년 판정 기준일 (기본: 오늘)
   *
   * @returns {{
   *   total, active, exited,
   *   gender: { male, female, unknown },
   *   youth: { total, male, female, byCompany: {식스티,굿뉴스,패리티} },
   *   byCompany: {
   *     식스티: { active, exited, male, female, moonlight },
   *     굿뉴스: { active, exited, male, female },
   *     패리티: { active, exited, male, female }
   *   },
   *   moonlight: { count }
   * }}
   */
  function getEffectiveCounts(persons, options) {
    options = options || {};
    var refDate = options.refDate || new Date();

    var result = {
      total: 0, active: 0, exited: 0,
      gender: { male: 0, female: 0, unknown: 0 },
      youth: {
        total: 0, male: 0, female: 0,
        byCompany: { '식스티': 0, '굿뉴스': 0, '패리티': 0 }
      },
      byCompany: {
        '식스티': { active: 0, exited: 0, male: 0, female: 0, moonlight: 0 },
        '굿뉴스': { active: 0, exited: 0, male: 0, female: 0 },
        '패리티': { active: 0, exited: 0, male: 0, female: 0 }
      },
      moonlight: { count: 0 }
    };

    if (!Array.isArray(persons) || persons.length === 0) return result;

    var moonlightMap = computeMoonlightMap(persons);

    // ----- [1] unique 기준 카운트 (전체/재직/퇴직/성별/청년) -----
    var unique = getUniquePersons(persons, moonlightMap);
    unique.forEach(function (p) {
      result.total++;
      var activeNow = isActiveAnywhere(p, moonlightMap);
      if (activeNow) {
        result.active++;
        if (p.gender === 'M') result.gender.male++;
        else if (p.gender === 'F') result.gender.female++;
        else result.gender.unknown++;
        if (getYouthInfo(p, refDate).youth) {
          result.youth.total++;
          if (p.gender === 'M') result.youth.male++;
          else if (p.gender === 'F') result.youth.female++;
        }
      } else {
        result.exited++;
      }
    });

    // ----- [2] 회사별 카운트 (레코드 기준, 식스티는 겸직 제외) -----
    persons.forEach(function (p) {
      if (!p) return;
      var company = getCompany(p);
      if (!company) return;
      var isExited = (p.status || 'active') === 'exited';

      if (company === '식스티') {
        var mInfo = getMoonlightInfo(p, moonlightMap);
        if (mInfo.isMoonlight) {
          result.byCompany.식스티.moonlight++;
          result.moonlight.count++;
          return; // 식스티 카운트에서 제외
        }
      }
      if (isExited) {
        result.byCompany[company].exited++;
      } else {
        result.byCompany[company].active++;
        if (p.gender === 'M') result.byCompany[company].male++;
        else if (p.gender === 'F') result.byCompany[company].female++;
      }
    });

    // ----- [3] 청년 회사별 분해 (재직 기준, 식스티는 겸직 제외) -----
    persons.forEach(function (p) {
      if (!p) return;
      var company = getCompany(p);
      if (!company) return;
      if ((p.status || 'active') === 'exited') return;
      if (company === '식스티') {
        if (getMoonlightInfo(p, moonlightMap).isMoonlight) return;
      }
      if (getYouthInfo(p, refDate).youth) {
        result.youth.byCompany[company]++;
      }
    });

    return result;
  }

  /**
   * 특정 연도(+선택적 월)의 입사/퇴사 카운트.
   *
   * @param {Array} persons
   * @param {number} year - 예: 2025
   * @param {number} [month] - 1~12. 생략 시 연간.
   * @returns {{
   *   joined: { total, byCompany: {식스티,굿뉴스,패리티} },
   *   left:   { total, byCompany: {식스티,굿뉴스,패리티} }
   * }}
   */
  function getJoinLeaveCounts(persons, year, month) {
    var result = {
      joined: { total: 0, byCompany: { '식스티': 0, '굿뉴스': 0, '패리티': 0 } },
      left:   { total: 0, byCompany: { '식스티': 0, '굿뉴스': 0, '패리티': 0 } }
    };
    if (!Array.isArray(persons) || persons.length === 0) return result;

    persons.forEach(function (p) {
      if (!p) return;
      var company = getCompany(p);
      // 입사
      var hire = parseDateSafe(p.hireDate);
      if (hire && hire.getFullYear() === year) {
        if (month == null || (hire.getMonth() + 1) === month) {
          result.joined.total++;
          if (company) result.joined.byCompany[company]++;
        }
      }
      // 퇴사
      var exit = parseDateSafe(p.exitDate);
      if (exit && exit.getFullYear() === year) {
        if (month == null || (exit.getMonth() + 1) === month) {
          result.left.total++;
          if (company) result.left.byCompany[company]++;
        }
      }
    });
    return result;
  }

  /**
   * 특정 시점(date) 기준 재직 인원 카운트.
   *
   * 정책 (사용자 요구사항 5번):
   *   - 겸직 포함 — 각 회사 레코드를 따로 셈
   *   - 재직 판정: hireDate <= date && (exitDate == null || exitDate > date)
   *   - hireDate가 없는 인력: status='active'면 재직으로 간주 (보수적)
   *
   * @param {Array} persons
   * @param {Date|string} date - 기준일
   * @returns {{
   *   activeAtDate: number,
   *   byCompany: { 식스티, 굿뉴스, 패리티 }
   * }}
   */
  function getCountsAtDate(persons, date) {
    var result = {
      activeAtDate: 0,
      byCompany: { '식스티': 0, '굿뉴스': 0, '패리티': 0 }
    };
    if (!Array.isArray(persons) || persons.length === 0) return result;
    var refDate = date instanceof Date ? date : parseDateSafe(date);
    if (!refDate) return result;

    persons.forEach(function (p) {
      if (!p) return;
      var hire = parseDateSafe(p.hireDate);
      var exit = parseDateSafe(p.exitDate);

      // hireDate 있으면 정밀 판정
      // 정책: 퇴사일 당일까지는 재직 (퇴사일이 refDate보다 "이후"여야 재직)
      //       단, exit==refDate 인 경우는 그날도 재직 → exit < refDate 일 때만 제외
      if (hire) {
        if (hire.getTime() > refDate.getTime()) return;       // 아직 입사 전
        if (exit && exit.getTime() < refDate.getTime()) return; // 퇴사일 이후
      } else {
        // hireDate 없는 경우: exitDate가 있고 그날 이전이면 퇴사로 간주, 그 외엔 재직
        // (전체 시점에 재직으로 보는 보수 정책)
        if (exit && exit.getTime() < refDate.getTime()) return;
      }

      result.activeAtDate++;
      var company = getCompany(p);
      if (company) result.byCompany[company]++;
    });
    return result;
  }

  // ====================================================================
  // 글로벌 노출
  // ====================================================================
  global.PersonsSummary = {
    // 날짜/나이
    computeAge: computeAge,
    ageToBucket: ageToBucket,
    parseDateSafe: parseDateSafe,
    lastDayOfMonth: lastDayOfMonth,
    formatDateIso: formatDateIso,
    // 회사
    COMPANIES: COMPANIES,
    COMPANY_FULL_NAMES: COMPANY_FULL_NAMES,
    COMPANY_BADGE_CLASS: COMPANY_BADGE_CLASS,
    COMPANY_COLORS: COMPANY_COLORS,
    getCompany: getCompany,
    renderCompanyBadge: renderCompanyBadge,
    // 청년
    getYouthInfo: getYouthInfo,
    // 겸직
    getMoonlightKey: getMoonlightKey,
    computeMoonlightMap: computeMoonlightMap,
    getMoonlightInfo: getMoonlightInfo,
    // 헬퍼
    isActiveAnywhere: isActiveAnywhere,
    getUniquePersons: getUniquePersons,
    // 카운트
    getEffectiveCounts: getEffectiveCounts,
    getJoinLeaveCounts: getJoinLeaveCounts,
    getCountsAtDate: getCountsAtDate
  };

})(typeof window !== 'undefined' ? window : this);

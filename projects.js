/**
 * 과제 관리 페이지 - Firestore 실시간 연동
 */
(function () {
  'use strict';

  var CUTOFF = '2026-01-01';
  var STAT_YEAR = new Date().getFullYear();  // 기준연도 기본 = 올해(자동)
  var COL_KEYS = ['제출일', '부처', '과제명', '시작일', '종료일', '지원금총', '비고'];

  function projectOverlapsYear(it, year) {
    var y = String(year);
    var start = (it.startDate || it.start || '').toString().slice(0, 10);
    var end = (it.endDate || it.end || '').toString().slice(0, 10);
    // 시작일/종료일 둘 다 없으면 — 제출일로 매칭 (미선정/대기/선정기타 등 시작 안 한 과제)
    if (!start && !end) {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (!submitDate) return false;  // 제출일도 없으면 매칭 안 함
      return submitDate.slice(0, 4) === y;
    }
    var yearStart = y + '-01-01';
    var yearEnd = y + '-12-31';
    if (start && start > yearEnd) return false;
    if (end && end < yearStart) return false;
    return true;
  }
  var COL_FIELDS = { '제출일': 'submitDate', '부처': 'department', '과제명': 'projectName', '시작일': 'startDate', '종료일': 'endDate', '지원금총': 'supportTotal', '비고': 'note' };

  function getVal(item, key) {
    var f = COL_FIELDS[key];
    return item[f] != null ? String(item[f]) : (item[key] != null ? String(item[key]) : '');
  }

  function getResearchPeriodDisplay(item, filterYear) {
    // 연구기간 = 과제 전체 기간 (연차 슬라이스가 아니라 시작~종료 전체).
    //   과제 유형(과제/용역/지원사업)·연차예산 유무와 무관하게 일관 표시하기 위해
    //   상위 startDate/endDate ∪ 연차 yearBudgets 의 최저 시작 ~ 최고 종료를 사용.
    //   (filterYear 인자는 호환 위해 유지하되, 전체 기간 표시이므로 사용 안 함)
    var starts = [], ends = [];
    function pushS(v) { var s = (v || '').toString().slice(0, 10); if (s) starts.push(s); }
    function pushE(v) { var e = (v || '').toString().slice(0, 10); if (e) ends.push(e); }
    pushS(item.startDate || item.start);
    pushE(item.endDate || item.end);
    var arr = item.annualData || item.yearBudgets || [];
    if (Array.isArray(arr)) {
      arr.forEach(function (y) {
        if (!y) return;
        pushS(y.start || y.startDate);
        pushE(y.end || y.endDate);
      });
    }
    var minStart = starts.length ? starts.sort()[0] : '';
    var maxEnd   = ends.length ? ends.sort()[ends.length - 1] : '';
    if (minStart || maxEnd) return (minStart || '-') + ' ~ ' + (maxEnd || '-');
    return '-';
  }

  function getDivision2Class(status) {
    var s = (status || '').trim();
    if (s === '종료') return 'projects-badge--end';
    if (s === '수행' || s === '수행중') return 'projects-badge--ongoing';
    if (s === '예정') return 'projects-badge--scheduled';
    if (s === '대기') return 'projects-badge--waiting';
    if (s === '미선정') return 'projects-badge--unselected';
    if (s === '미제출') return 'projects-badge--unsubmitted';
    if (s === '선정(기타)' || s === '선정 (기타)') return 'projects-badge--other';
    return 'projects-badge--end';
  }

  // 유형(division1) 배지 클래스 — 차트 색상과 통일
  function getTypeBadgeClass(type) {
    var s = (type || '').trim();
    if (s === '과제') return 'projects-badge--type-task';
    if (s === '지원사업') return 'projects-badge--type-grant';
    if (s === '용역') return 'projects-badge--type-service';
    if (s === '기타') return 'projects-badge--type-other';
    return '';
  }

  // 진행 여부 정규화 — 자동 전환 포함
  // 저장된 데이터의 status는 그대로 두고, 표시할 때만 변환:
  //   - "예정" + 제출일 지남 → "대기"
  //   - "수행" + 종료일 지남 → "종료"
  function normalizeStatus(it) {
    return statusAsOf(it, null);  // null = 오늘 기준
  }

  /**
   * 주어진 시점 기준 status 판정
   * @param {Object} it - 과제
   * @param {string|null} asOfDate - 'YYYY-MM-DD' 또는 null (null이면 오늘)
   *
   * 자동 전환:
   *   '수행' + 종료일 < asOfDate → '종료'
   *   '예정' + 제출일 < asOfDate → '대기'
   */
  function statusAsOf(it, asOfDate) {
    var raw = (it.status || it['진행 여부'] || '').toString().trim();
    // "선정" 입력값을 "선정(기타)"로 정규화 (옛 데이터 호환)
    if (raw === '선정') raw = '선정(기타)';
    var n = raw.replace(/\s/g, '');

    // asOfDate 기본값 — 오늘
    if (!asOfDate) {
      var today = new Date();
      asOfDate = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    }

    // "수행" 또는 "종료" + 종료일이 asOfDate 이전 → "종료", 이후 → "수행"
    // (raw가 '종료'여도 asOfDate가 종료일 이전이면 그 시점에는 아직 '수행')
    if (n === '수행중' || n === '수행' || raw === '종료') {
      var endDate = (it.endDate || it.end || it['종료일'] || '').toString().slice(0, 10);
      if (endDate && asOfDate > endDate) return '종료';
      return '수행';
    }

    // "예정" + 제출일이 asOfDate 이전 → "대기"
    if (raw === '예정') {
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (submitDate && asOfDate > submitDate) return '대기';
      return '예정';
    }

    if (raw === '대기' || raw === '종료' || raw === '미선정' || raw === '미제출') return raw;

    // status 비어있을 때 — 시작일/종료일/제출일 기반 자동 판정
    if (!raw) {
      var startD  = (it.startDate || it.start || it['시작일'] || '').toString().slice(0, 10);
      var endD    = (it.endDate || it.end || it['종료일'] || '').toString().slice(0, 10);
      var submitD = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      if (endD && asOfDate > endD) return '종료';
      if (startD && asOfDate >= startD) {
        if (!endD || asOfDate <= endD) return '수행';
      }
      if (startD && asOfDate < startD) return '예정';
      if (submitD && asOfDate < submitD) return '예정';
      if (submitD && asOfDate > submitD) return '대기';
    }

    return raw || '미정';
  }

  /**
   * statsYear 기준 status 판정용 asOfDate
   * - 과거 연도: 그 해 마지막 날 (예: 2024 → '2024-12-31')
   * - 현재/미래 연도: 오늘로 cap (그래야 종료일이 미래면 '종료'로 잡히지 않음)
   */
  function yearEndDate(year) {
    var today = new Date();
    var todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var yearEnd = String(year) + '-12-31';
    // 미래 연도 끝이 오늘보다 늦으면 → 오늘로 cap (아직 안 일어난 일을 종료로 보지 않음)
    return yearEnd > todayStr ? todayStr : yearEnd;
  }

  function getKeywordHtml(item) {
    var isRd = item.isRd === true || item.rd === true || item['R&D 여부'] === true;
    var kw = item.keywords || item.keyword || '';
    if (typeof kw !== 'string') kw = Array.isArray(kw) ? kw.join(', ') : String(kw);
    var rdTag = isRd ? '<span class="projects-badge projects-badge--rd">[R&D]</span>' : '';
    return rdTag + escapeHtml(kw || '-');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatNum(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '0';
    return Number(n).toLocaleString();
  }

  /**
   * yearBudget 행이 특정 연도에 차지하는 지원금
   *   - yearBudget.calendarBreakdown[year] 있으면 그 값 (사용자 직접 입력)
   *   - 없으면 일별 비례 분배 (자동)
   */
  function supportInYear(yb, year) {
    if (!yb) return 0;

    // 사용자 직접 입력값 우선
    var cb = yb.calendarBreakdown;
    if (cb && typeof cb === 'object' && cb[year] != null && cb[year] !== '') {
      return Number(cb[year]) || 0;
    }

    // 자동 비례
    var s = (yb.startDate || '').toString().slice(0, 10);
    var e = (yb.endDate   || '').toString().slice(0, 10);
    if (!s || !e) return 0;

    var support = Number(yb.support || 0);
    if (!support) return 0;

    var sd = new Date(s + 'T00:00:00');
    var ed = new Date(e + 'T00:00:00');
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return 0;
    if (ed < sd) return 0;

    var yearStart = new Date(year + '-01-01T00:00:00');
    var yearEnd   = new Date(year + '-12-31T00:00:00');
    var overlapStart = sd > yearStart ? sd : yearStart;
    var overlapEnd   = ed < yearEnd   ? ed : yearEnd;
    if (overlapStart > overlapEnd) return 0;

    var totalDays   = ((ed - sd) / 86400000) + 1;
    var overlapDays = ((overlapEnd - overlapStart) / 86400000) + 1;

    if (sd.getFullYear() === ed.getFullYear()) {
      return Number(year) === sd.getFullYear() ? support : 0;
    }
    return Math.round(support * overlapDays / totalDays);
  }

  /**
   * 카드 클릭 시 표 위 한 줄 요약 갱신
   *   - 수행/수행(계속)/수행(신규)/종료/미선정 카드 활성 시 표시
   *   - 유형별 카운트 + R&D 카운트 (회고/패턴 발견용)
   */
  function updateFilterSummary(items, activeCardFilter, activeDivision, displayCount) {
    var el = document.getElementById('filter-summary-row');
    if (!el) return;

    var titleMap = {
      'unselected':     '미선정',
      'ongoing':        '수행',
      'continue':       '수행 (계속)',
      'new':            '수행 (신규)',
      'ended':          '종료'
    };

    // 해당 필터가 아니면 숨김 (대기/선정기타 등)
    if (!titleMap[activeCardFilter]) {
      el.style.display = 'none';
      return;
    }

    // 유형별 + R&D 카운트 (분류 선택과 무관하게 항상 전체 분해 — items = 분류 필터 전 모집단)
    var counts   = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
    var rdCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
    items.forEach(function (it) {
      var d = (it.division1 || it['구분1'] || '').toString();
      if (!counts.hasOwnProperty(d)) return;
      counts[d]++;
      var isRd = it.isRd === true || it.rd === true || it['R&D 여부'] === true;
      if (isRd) rdCounts[d]++;
    });
    function pill(div, n, rd) {
      var zero = n === 0 ? ' filter-summary-pill--zero' : '';
      var active = (div === activeDivision) ? ' is-active' : '';
      var rdText = rd > 0 ? '<span class="filter-summary-rd">(R&amp;D ' + rd + ')</span>' : '';
      return '<span class="filter-summary-pill clickable' + zero + active + '" data-summary-division="' + div + '" role="button" tabindex="0">' + div + ' <strong>' + n + '</strong>' + rdText + '</span>';
    }
    var titleCount = (typeof displayCount === 'number') ? displayCount : items.length;
    var titleText = titleMap[activeCardFilter] + (activeDivision ? ' · ' + activeDivision : '') + ' ' + titleCount + '건';
    el.innerHTML =
      '<span class="filter-summary-title">' + titleText + '</span>' +
      '<span class="filter-summary-label">·  유형별 </span>' +
      pill('과제', counts['과제'], rdCounts['과제']) +
      pill('지원사업', counts['지원사업'], rdCounts['지원사업']) +
      pill('용역', counts['용역'], rdCounts['용역']) +
      pill('기타', counts['기타'], rdCounts['기타']);
    el.style.display = '';
  }

  /**
   * 카드 통계 계산
   * @param {Array}  items      전체 과제 데이터
   * @param {number} statsYear  통계 기준 연도 (filterYear || STAT_YEAR)
   * @param {string|null} filterYear  사용자가 선택한 연도 (null = "전체")
   */
  function updateStats(items, statsYear, filterYear) {
    statsYear = statsYear || STAT_YEAR;
    var yearStr = String(statsYear);
    var cutoff = statsYear + '-01-01';
    var hasFilter = !!filterYear;

    // 카운트 변수
    var ongoingAll = 0;
    var continueCnt = 0;
    var newCnt = 0;
    var endedCnt = 0;        // 종료일이 statsYear인 status='종료' 과제
    var waitingCnt = 0;      // 제출일이 statsYear인 대기 상태 과제 ("예정" + 제출일 지남)
    var selectedOtherCnt = 0;// 제출일이 statsYear인 status='선정(기타)' 과제
    var unselectedCnt = 0;
    var yearSum = 0;     // 당해에 입금되는 총 지원금 (calendarBreakdown + 자동 비례)

    // 당해 수주 총 지원금: status가 수주(수행/종료/선정기타) 인 과제 중,
    //   yearBudget.startDate가 statsYear인 연차의 support 합
    //   - 신규: 그 yearBudget이 1차 (index 0) → 과제 자체가 그 해 신규 시작
    //   - 계속: 2차 이상 → 다년 과제가 그 해 새 연차로 진입
    var sujuTotal = 0;
    var sujuContinue = 0;
    var sujuNew = 0;

    // 당해에 입금되는 총 지원금: 모든 과제의 그 해 입금분 합 (yearSum과 동일)
    //   - 신규: 과제 startDate가 그 해 (과제 자체가 그 해 시작)
    //   - 계속: 과제 startDate가 그 해 이전 (다년 과제의 그 해 입금분)
    var ipgmContinue = 0;
    var ipgmNew = 0;

    // 당해 입금 완료: actualPayments의 그 해 받은 합 (옛 payments 자동 호환)
    var actualSum = 0;

    items.forEach(function (it) {
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end   = (it.endDate || it.end || '').toString().slice(0, 10);
      // statsYear 시점 기준 status — 그 해 말 시점에 '수행' / '종료' 등 판정
      var status = statusAsOf(it, yearEndDate(statsYear));
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var submitYear = submitDate ? submitDate.slice(0, 4) : '';
      var startYear = start ? start.slice(0, 4) : '';
      var endYear = end ? end.slice(0, 4) : '';

      // ── 수행 카드 (건수) ── statsYear에 진행 중이었던 status='수행' 과제
      if (status === '수행' && projectOverlapsYear(it, statsYear)) {
        ongoingAll++;
        if (start && start < cutoff) {
          continueCnt++;
        } else {
          newCnt++;
        }
      }

      // ── 종료 (sub-section) ── 종료일이 statsYear인 status='종료' 과제
      // 수행 카드 합계(ongoingAll)에도 포함 — "그 해에 활동했던 과제 전체"
      if (status === '종료' && endYear === yearStr) {
        endedCnt++;
        ongoingAll++;
      }

      // 용역은 별도 트랙 — 카드 카운트에는 포함, 자금 합산에는 제외
      var isService = (it.division1 === '용역');

      // ── 당해 수주 총 지원금 ──
      // 조건: status가 수주(수행/종료/선정기타) AND yearBudget.startDate가 statsYear
      // 합산: 그 연차의 support (정부지원금)
      // 분류: 그 yearBudget이 1차(index 0) → 신규, 2차 이상 → 계속
      var isSelected = (status === '수행' || status === '종료' ||
                        status === '선정(기타)' || status === '선정 (기타)');
      if (isSelected && !isService) {
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb, ybIdx) {
            // yb.startDate 없으면 1차(ybIdx=0)일 때 it.startDate 폴백
            var ybStartRaw = yb.startDate || (ybIdx === 0 ? it.startDate : '');
            var ybStartYear = (ybStartRaw || '').toString().slice(0, 4);
            if (ybStartYear !== yearStr) return;
            // yb.support 없거나 0이고 1차일 때 → it.supportTotal/budget 폴백
            var sup = Number(yb.support || 0);
            if (!sup && ybIdx === 0) {
              sup = Number(it.supportTotal || it.budget || 0);
            }
            if (!sup) return;
            sujuTotal += sup;
            if (ybIdx === 0) {
              sujuNew += sup;       // 1차 = 신규 (과제 자체가 그 해 시작)
            } else {
              sujuContinue += sup;  // 2차 이상 = 계속 (다년 과제의 새 연차)
            }
          });
        } else {
          // yearBudgets 없음 — it.startDate 기준으로 1차(신규)로 처리
          var itStartYear = (it.startDate || '').toString().slice(0, 4);
          if (itStartYear === yearStr) {
            var supItOnly = Number(it.supportTotal || it.budget || 0);
            if (supItOnly) {
              sujuTotal += supItOnly;
              sujuNew += supItOnly;
            }
          }
        }
      }

      // ── 대기 카드 ── 제출일이 statsYear인 status='대기' (= '예정'이지만 제출일 지남)
      if (status === '대기' && submitYear === yearStr) {
        waitingCnt++;
      }

      // ── 선정(기타) 카드 ── 제출일이 statsYear인 status='선정(기타)' 과제
      if ((status === '선정(기타)' || status === '선정 (기타)') && submitYear === yearStr) {
        selectedOtherCnt++;
      }

      // ── 미선정 카드 ── 제출일이 statsYear인 status='미선정' 과제
      if (status === '미선정' && submitYear === yearStr) {
        unselectedCnt++;
      }

      // ── 당해에 입금되는 총 지원금 ── 각 yearBudget의 calendarBreakdown 우선, 없으면 자동 비례
      // 용역은 별도 트랙이므로 제외
      var sy = 0;
      if (!isService) {
        if (it.yearBudgets && Array.isArray(it.yearBudgets)) {
          it.yearBudgets.forEach(function (y) {
            sy += supportInYear(y, statsYear);
          });
        } else if (it.supportYear != null && !isNaN(Number(it.supportYear)) && Number(statsYear) === 2026) {
          // 옛 데이터 폴백 — supportYear(연도 미상 구 데이터)는 2026 기준으로 고정.
          //   STAT_YEAR(기본 기준연도)이 올해 자동으로 바뀌어도 폴백 연도는 따라가지 않게 분리.
          sy = Number(it.supportYear);
        }
      }
      yearSum += sy;

      // 입금 분류 (신규/계속) — 과제 startDate 기준
      // 신규: 과제 startDate.연도 == statsYear (그 해 신규 시작 과제의 그 해 입금분)
      // 계속: 과제 startDate.연도 < statsYear (이전 연도 시작 과제의 그 해 입금분)
      if (sy > 0) {
        if (startYear === yearStr) {
          ipgmNew += sy;
        } else {
          ipgmContinue += sy;
        }
      }

      // 당해 입금 완료 — actualPayments 우선, 없을 때만 옛 payments 폴백 (중복 방지)
      // 한 yb 내 같은 (date+amount) 항목은 중복 카운트하지 않음 (옛 마이그레이션 잔재)
      // 용역은 별도 트랙이므로 제외
      if (Array.isArray(it.yearBudgets) && !isService) {
        it.yearBudgets.forEach(function (yb) {
          // 새 구조 actualPayments 있으면 그것만 사용
          if (Array.isArray(yb.actualPayments) && yb.actualPayments.length > 0) {
            var seen = {};
            yb.actualPayments.forEach(function (p) {
              var aY = (p.date || '').toString().slice(0, 4);
              if (aY !== yearStr || !p.amount) return;
              var key = (p.date || '') + '|' + (Number(p.amount) || 0);
              if (seen[key]) return;  // 한 yb 내 정확히 같은 입금 중복은 무시
              seen[key] = true;
              actualSum += Number(p.amount) || 0;
            });
          } else if (Array.isArray(yb.payments)) {
            // 옛 구조 폴백 (actualPayments 없을 때만)
            var seenP = {};
            yb.payments.forEach(function (p) {
              var aY = (p.actualDate || '').toString().slice(0, 4);
              if (aY !== yearStr || !p.actualAmount) return;
              var key = (p.actualDate || '') + '|' + (Number(p.actualAmount) || 0);
              if (seenP[key]) return;
              seenP[key] = true;
              actualSum += Number(p.actualAmount) || 0;
            });
          }
        });
      }
    });

    // 전체 건수 (참고 — pill 표시용)
    var totalCount = items.length;
    if (hasFilter) {
      totalCount = items.filter(function (it) { return projectOverlapsYear(it, statsYear); }).length;
    }

    setEl('stat-total', totalCount);
    setEl('stat-ongoing-all', ongoingAll);
    setEl('stat-continue', continueCnt);
    setEl('stat-new', newCnt);
    setEl('stat-ended', endedCnt);
    setEl('stat-waiting', waitingCnt);
    setEl('stat-selected-other', selectedOtherCnt);
    setEl('stat-unselected', unselectedCnt);
    setEl('stat-year-sum', formatNum(yearSum));

    // (당해 수주 총 지원금 카드는 v7에서 제거 — 대시보드와 중복. sujuTotal/Continue/New 계산은 표 '당해 수주' 컬럼에서 사용하므로 유지)

    // 당해 입금 총 지원금 + 하위 (계속/신규)
    setEl('stat-continue-ipgm', formatNum(ipgmContinue));
    setEl('stat-new-ipgm', formatNum(ipgmNew));

    // 당해 입금 완료 (실제 수령)
    setEl('stat-actual-sum', formatNum(actualSum));
    // 수령 비율 + 잔액
    var ipgmTotal = ipgmNew + ipgmContinue;  // 예정 입금 합 (yearSum과 동일)
    var rate = ipgmTotal > 0 ? Math.round((actualSum / ipgmTotal) * 100) : 0;
    var remain = Math.max(0, ipgmTotal - actualSum);
    setEl('stat-actual-rate', rate + '%');
    setEl('stat-actual-remain', formatNum(remain));

    // sub-section: filterYear 있을 때만 표시 (입금/실제)
    var ipgmSub = document.getElementById('ipgm-sum-sub');
    if (ipgmSub) ipgmSub.style.display = filterYear ? '' : 'none';
    var actualSub = document.getElementById('actual-sum-sub');
    if (actualSub) actualSub.style.display = filterYear ? '' : 'none';
  }

  function setEl(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function getColVisibility() {
    var vis = {};
    COL_KEYS.forEach(function (k) {
      var cb = document.querySelector('#col-panel input[data-col="' + k + '"]');
      vis[k] = cb ? cb.checked : false;
    });
    return vis;
  }

  function saveColVisibility(vis) {
    COL_KEYS.forEach(function (k) {
      var cb = document.querySelector('#col-panel input[data-col="' + k + '"]');
      if (cb) cb.checked = !!vis[k];
    });
  }

  function loadColVisibility() {
    try {
      var raw = localStorage.getItem('projects-col-visibility');
      if (raw) {
        var vis = JSON.parse(raw);
        saveColVisibility(vis);
      }
    } catch (e) {}
  }

  function applyColVisibility(vis) {
    var ths = document.querySelectorAll('#projects-table thead th.col-opt');
    var rows = document.querySelectorAll('#projects-table tbody tr');
    var showVal = 'table-cell';
    ths.forEach(function (th) {
      var col = th.getAttribute('data-col');
      var show = vis[col];
      th.style.display = show ? showVal : 'none';
    });
    rows.forEach(function (tr) {
      var cells = tr.querySelectorAll('td.col-opt');
      cells.forEach(function (td) {
        var col = td.getAttribute('data-col');
        var show = vis[col];
        td.style.display = show ? showVal : 'none';
      });
    });
  }

  // ── 당해 인건비 환급예정액 (예상 탭 지원금 합) ──────────────────
  //   projectLabor/{id}_planned 의 cells 중 그 해(ym) cash 합. funding의 "환급 예정액"과 동일 정의.
  //   과제 목록은 인건비 문서를 안 읽으므로 여기서 비동기 로드(연도별 캐시) 후 셀 채움.
  var LABOR_COLL = 'projectLabor';
  var _refundCache = {};        // { [projectId]: 그 해 예상 지원금 합 }
  var _refundCacheYear = null;  // 캐시가 담고 있는 연도(문자열)
  var _refundToken = 0;         // 연도 빠르게 바뀔 때 stale 반영 방지

  function laborDb() { return window.__firebaseDb || null; }

  function fillRefundCells() {
    var cells = document.querySelectorAll('#projects-table [data-refund-project]');
    cells.forEach(function (td) {
      var pid = td.getAttribute('data-refund-project');
      if (Object.prototype.hasOwnProperty.call(_refundCache, pid)) {
        var v = _refundCache[pid];
        td.textContent = v > 0 ? formatNum(v) : '0';
      } else {
        td.textContent = '-';   // 인건비 관리 대상 아님 / 데이터 없음
      }
    });
  }

  function loadRefundForYear(items, year) {
    if (!year || !laborDb()) { return; }
    var yStr = String(year);
    if (_refundCacheYear === yStr) { fillRefundCells(); return; }   // 캐시 히트
    var myToken = ++_refundToken;
    _refundCacheYear = yStr;
    _refundCache = {};
    var targets = (items || []).filter(function (p) { return p && p.id && p.laborManaged; });
    if (!targets.length) { fillRefundCells(); return; }
    var db = laborDb();
    var promises = targets.map(function (p) {
      var prefix = p.id + '_';
      return db.collection(LABOR_COLL).doc(p.id + '_planned').get().then(function (snap) {
        if (myToken !== _refundToken) return;   // 그새 연도 바뀜 → 버림
        var data = snap.exists ? snap.data() : null;
        var cellsObj = (data && data.cells) ? data.cells : {};
        var sum = 0;
        Object.keys(cellsObj).forEach(function (key) {
          if (key.indexOf(prefix) !== 0) return;
          var ym = key.slice(prefix.length, prefix.length + 7);   // YYYY-MM
          if (!/^\d{4}-\d{2}$/.test(ym)) return;
          if (ym.slice(0, 4) !== yStr) return;
          var c = cellsObj[key];
          sum += Number((c && c.cash) || 0);
        });
        _refundCache[p.id] = sum;
      }).catch(function () { if (myToken === _refundToken) _refundCache[p.id] = 0; });
    });
    Promise.all(promises).then(function () {
      if (myToken === _refundToken) fillRefundCells();
    });
  }

  function renderTable(items, colVis, filterYear, onEdit) {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    items.forEach(function (it, idx) {
      var id = it.id || it.docId || 'item-' + idx;
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);

      // 유형: division1 (과제/지원사업/용역/기타) — 색상 배지
      var typeText = (it.division1 || it['구분1'] || '').toString() || '-';
      var typeBadgeClass = getTypeBadgeClass(typeText);
      var typeCellHtml = typeBadgeClass
        ? '<span class="projects-badge ' + typeBadgeClass + '">' + escapeHtml(typeText) + '</span>'
        : escapeHtml(typeText);

      // 진행 여부: filterYear 시점 status (선택 연도 시점 기준), 전체 모드면 오늘 기준
      var statusAsOfDate = filterYear ? yearEndDate(filterYear) : null;
      var status = statusAsOf(it, statusAsOfDate);
      var statusDisplay = status;
      var badgeClass = getDivision2Class(status);
      if (status === '수행' && filterYear) {
        var cutoff = filterYear + '-01-01';
        if (start && start < cutoff) {
          statusDisplay = '수행 (계속)';
        } else {
          statusDisplay = '수행 (신규)';
          badgeClass = 'projects-badge--ongoing-new';
        }
      }

      var tr = document.createElement('tr');
      tr.setAttribute('data-id', id);

      var no = idx + 1;  // 필터링된 결과 기준으로 1부터 매김 (it.no DB 값 사용 안 함)
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);

      // 기본 표출 컬럼 — 사전 계산
      var researchPeriod = getResearchPeriodDisplay(it, filterYear);
      var institution = it.institution || it['기관명'] || '-';

      // 당해 입금: 필터연도 있으면 그 해 입금분, 없으면 supportTotal
      var num1 = 0;
      if (filterYear) {
        if (Array.isArray(it.yearBudgets)) {
          it.yearBudgets.forEach(function (yb) { num1 += supportInYear(yb, filterYear); });
        } else if (it.supportYear != null && !isNaN(Number(it.supportYear))) {
          num1 = Number(it.supportYear);
        }
      } else {
        num1 = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
      }
      var thisYearIncome = num1 > 0 ? formatNum(num1) : (filterYear ? '0' : '-');

      // 총 지원금 — 연차별 yearBudgets[].support 의 합
      var sumSupport = 0;
      if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
        it.yearBudgets.forEach(function (yb) {
          sumSupport += Number(yb.support || 0);
        });
      }
      if (sumSupport === 0) {
        sumSupport = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
      }
      var totalSupport = sumSupport > 0 ? formatNum(sumSupport) : '-';

      var cells = [
        '<td>' + escapeHtml(no) + '</td>',
        '<td>' + typeCellHtml + '</td>',
        '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(statusDisplay) + '</span></td>',
        '<td>' + getKeywordHtml(it) + '</td>',
        '<td>' + escapeHtml(it.manager || it.책임자 || '-') + '</td>',
        '<td>' + escapeHtml(researchPeriod) + '</td>',
        '<td>' + escapeHtml(institution) + '</td>',
        '<td class="col-num">' + escapeHtml(totalSupport) + '</td>',
        '<td class="col-num">' + escapeHtml(thisYearIncome) + '</td>',
        '<td class="col-num col-year-only" data-refund-project="' + escapeHtml(id) + '">' + (filterYear ? '…' : '-') + '</td>'
      ];

      COL_KEYS.forEach(function (k) {
        var val;
        if (k === '제출일') {
          val = ((it.submitDate || it['제출일'] || '').toString().slice(0, 10)) || '-';
        } else if (k === '시작일') {
          val = start || '-';
        } else if (k === '종료일') {
          val = end || '-';
        } else if (k === '지원금총') {
          // 당해 수주: 필터연도 있으면 그 해 시작 yearBudget.support 합, 없으면 supportTotal
          var num2 = 0;
          if (filterYear) {
            if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
              it.yearBudgets.forEach(function (yb, ybIdx) {
                var ybStartRaw2 = yb.startDate || (ybIdx === 0 ? it.startDate : '');
                var ybs = (ybStartRaw2 || '').toString().slice(0, 4);
                if (ybs !== filterYear) return;
                var ybSup = Number(yb.support || 0);
                if (!ybSup && ybIdx === 0) {
                  ybSup = Number(it.supportTotal || it.budget || 0);
                }
                num2 += ybSup;
              });
            } else {
              // yearBudgets 없음 — it.startDate 기준 1차로 처리
              var itStartYearRow = (it.startDate || '').toString().slice(0, 4);
              if (itStartYearRow === filterYear) {
                num2 = Number(it.supportTotal || it.budget || 0);
              }
            }
          } else {
            num2 = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
          }
          val = num2 > 0 ? formatNum(num2) : (filterYear ? '0' : '-');
        } else {
          val = getVal(it, k) || '-';
        }
        var classes = 'col-opt' + (k === '지원금총' ? ' col-num' : '');
        cells.push('<td class="' + classes + '" data-col="' + k + '">' + escapeHtml(val) + '</td>');
      });

      cells.push('<td style="text-align:center"><button type="button" class="ui-btn ui-btn--ghost project-edit-btn" data-id="' + escapeHtml(id) + '" title="수정" aria-label="수정"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button></td>');
      tr.innerHTML = cells.join('');

      var editBtn = tr.querySelector('.project-edit-btn');
      if (editBtn && typeof onEdit === 'function') {
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          onEdit(it);
        });
      }

      tbody.appendChild(tr);
    });

    applyColVisibility(colVis || getColVisibility());
  }

  function init() {
    var sidebar = document.getElementById('sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('sidebar--collapsed');
        try { localStorage.setItem('hr-sidebar-collapsed', sidebar.classList.contains('sidebar--collapsed') ? '1' : ''); } catch (e) {}
      });
      try { if (localStorage.getItem('hr-sidebar-collapsed') === '1') sidebar.classList.add('sidebar--collapsed'); } catch (e) {}
    }
    loadColVisibility();
    var colVis = getColVisibility();

    var colToggle = document.getElementById('col-toggle-btn');
    var colPanel = document.getElementById('col-panel');
    if (colToggle && colPanel) {
      colToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        colPanel.classList.toggle('open');
      });
      document.addEventListener('click', function () {
        colPanel.classList.remove('open');
      });
      colPanel.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      colPanel.querySelectorAll('input').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var vis = getColVisibility();
          applyColVisibility(vis);
          try { localStorage.setItem('projects-col-visibility', JSON.stringify(vis)); } catch (e) {}
        });
      });
    }

    var svc = window.firestoreService;
    var latestItems = [];
    var yearFilter = document.getElementById('project-year-filter');
    var filterHint = document.getElementById('project-filter-hint');
    var activeFiltersWrap = document.getElementById('project-active-filters');

    // 페이지 이동(과제 등록 등) 후 돌아왔을 때 연도 필터 유지
    // — sessionStorage에 저장된 값이 있으면 복원
    (function restoreYearFilter() {
      if (!yearFilter) return;
      try {
        var saved = sessionStorage.getItem('projects-filter-year');
        if (saved !== null) {
          // 옵션에 해당 값이 실제 존재하는지 확인 후 적용
          var opts = yearFilter.options;
          for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === saved) { yearFilter.value = saved; break; }
          }
        }
      } catch (e) { /* sessionStorage 접근 실패 시 무시 */ }
    })();

    // ----- 연도 필터 옵션 동적 채움 (공용 window.YearFilterUtil) -----
    //   HTML 하드코딩 대신 데이터(시작/종료/제출일 + 연차)에서 연도를 모아 채움.
    //   기본값 = 올해(자동), 전체 옵션 포함, URL ?year= 최우선, 그다음 sessionStorage.
    function populateYearOptions(items) {
      if (!yearFilter || !window.YearFilterUtil) return;
      var urlYear = null;
      try { urlYear = new URLSearchParams(location.search).get('year'); } catch (e) {}
      window.YearFilterUtil.populate(yearFilter, items, {
        includeAll: true,
        storageKey: 'projects-filter-year',
        preferredValue: urlYear || null,
        defaultValue: String(STAT_YEAR)   // 올해(자동) — STAT_YEAR가 올해로 설정됨
      });
    }

    // ----- 활성 필터 상태 -----
    // activeCardFilter: 'continue' | 'new' | 'unselected' (카드 클릭으로 활성화)
    // activeStatusFilter: '수행' | '예정' | '종료' (URL ?status= 진입 시, 카드와 매칭 안 되는 status용)
    // activeDivisionFilter: '과제' | '지원사업' | '용역' | '기타' (분류 pill 클릭으로 활성화)
    // activeExcludeDivisionFilter: '용역' 등 (대시보드 '수행 과제'에서 진입 시 — 용역 제외)
    // activeNewProposalOnly: boolean (대시보드 '총 신규 제안'에서 진입 시 — 그 해 제출일 있는 것만)
    // activeSearchQuery: 검색 입력 키워드
    var activeCardFilter = null;
    var activeStatusFilter = null;
    var activeDivisionFilter = null;
    var activeSummaryDivision = null;  // filter-summary-row 유형별 클릭 필터 (과제/지원사업/용역/기타), 기존 분류 pill과 독립. 활성 카드필터 ∩ 분류
    var activeExcludeDivisionFilter = null;
    var activeNewProposalOnly = false;
    var activeSubmitMonth = null;   // 대시보드 월별 신규제안 그래프에서 월 클릭 진입 시 (1~12)
    var activeSearchQuery = '';
    var lastFilteredItems = []; // 엑셀 내보내기용 — 현재 화면에 보이는 아이템들

    // 페이지 로드 시 URL 파라미터에서 초기 필터 읽기
    (function readInitialFilter() {
      var params = new URLSearchParams(location.search);
      var filter = params.get('filter');
      var status = params.get('status');
      var division = params.get('division');
      var excludeDivision = params.get('excludeDivision');
      var newProposal = params.get('newProposal');
      var yearParam = params.get('year');

      if (filter === 'ongoing' || filter === 'continue' || filter === 'new' || filter === 'ended' || filter === 'waiting' || filter === 'selected-other' || filter === 'unselected') {
        activeCardFilter = filter;
      }

      if (status) {
        var trimmed = decodeURIComponent(status).trim();
        var trimmedNorm = trimmed.replace(/\s/g, '');
        // 카드와 매칭 가능한 것은 카드 활성화로 매핑
        if (trimmedNorm === '미선정') {
          activeCardFilter = 'unselected';
        } else if (trimmedNorm === '수행' || trimmedNorm === '수행중') {
          // '수행'은 카드가 계속/신규로 분리되어 있으므로 별도 status 필터 사용
          activeStatusFilter = '수행';
        } else if (trimmedNorm === '예정' || trimmedNorm === '종료') {
          activeStatusFilter = trimmed;
        }
      }

      if (division) {
        var d = decodeURIComponent(division).trim();
        if (d === '과제' || d === '지원사업' || d === '용역' || d === '기타') {
          activeDivisionFilter = d;
        }
      }

      var odiv = params.get('odiv');
      if (odiv && activeCardFilter === 'ongoing') {
        var od = decodeURIComponent(odiv).trim();
        if (od === '과제' || od === '지원사업' || od === '기타') {
          activeSummaryDivision = od;
        }
      }

      if (excludeDivision) {
        var ed = decodeURIComponent(excludeDivision).trim();
        if (ed === '과제' || ed === '지원사업' || ed === '용역' || ed === '기타') {
          activeExcludeDivisionFilter = ed;
        }
      }

      if (newProposal === '1' || newProposal === 'true') {
        activeNewProposalOnly = true;
      }

      var submitMonthParam = params.get('submitMonth');
      if (submitMonthParam) {
        var smm = parseInt(submitMonthParam, 10);
        if (smm >= 1 && smm <= 12) activeSubmitMonth = smm;
      }

      // URL year 파라미터 — sessionStorage보다 우선. 대시보드에서 진입 시 사용
      if (yearParam && yearFilter) {
        var opts = yearFilter.options;
        for (var i = 0; i < opts.length; i++) {
          if (opts[i].value === yearParam) {
            yearFilter.value = yearParam;
            try { sessionStorage.setItem('projects-filter-year', yearParam); } catch (e) {}
            break;
          }
        }
      }
    })();

    function getFilterYear() {
      var v = yearFilter ? yearFilter.value : '';
      return v || null;
    }
    function getStatsYear() {
      var y = getFilterYear();
      return y ? parseInt(y, 10) : STAT_YEAR;
    }

    // 카드 필터(ongoing/continue/new/unselected) 매칭
    function projectMatchesCardFilter(it, filter, cutoff) {
      if (!filter) return true;
      var yearStr = cutoff ? cutoff.slice(0, 4) : '';
      // 선택 연도 시점 기준 status (그 해 말 기준), 전체 모드면 오늘 기준
      var asOf = yearStr ? yearEndDate(yearStr) : null;
      var status = statusAsOf(it, asOf);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var isOngoing = status === '수행';

      if (filter === 'ongoing')  {
        // 수행 카드 = status='수행' AND 선택 연도에 진행 중 OR status='종료' AND 종료일이 선택 연도
        if (isOngoing && (!yearStr || projectOverlapsYear(it, yearStr))) return true;
        if (status === '종료' && yearStr) {
          var endYearO = (it.endDate || it.end || '').toString().slice(0, 4);
          return endYearO === yearStr;
        }
        return false;
      }
      if (filter === 'continue') return isOngoing && projectOverlapsYear(it, yearStr) && !!start && start < cutoff;
      if (filter === 'new')      return isOngoing && projectOverlapsYear(it, yearStr) && (!start || start >= cutoff);
      if (filter === 'ended') {
        // 종료 sub-item = status='종료' AND 종료일이 선택 연도
        if (status !== '종료') return false;
        if (!yearStr) return true;
        var endYear = (it.endDate || it.end || '').toString().slice(0, 4);
        return endYear === yearStr;
      }
      if (filter === 'unselected') {
        // 미선정 카드 = status='미선정' AND 제출일이 선택 연도
        if (status !== '미선정') return false;
        if (!yearStr) return true;  // 전체 모드일 때는 모든 미선정
        var submitYear = (it.submitDate || it['제출일'] || '').toString().slice(0, 4);
        return submitYear === yearStr;
      }
      if (filter === 'waiting') {
        // 대기 카드 = status='대기' (예정+제출일지남) AND 제출일이 선택 연도
        if (status !== '대기') return false;
        if (!yearStr) return true;
        var submitYearW = (it.submitDate || it['제출일'] || '').toString().slice(0, 4);
        return submitYearW === yearStr;
      }
      if (filter === 'selected-other') {
        // 선정(기타) 카드 = status='선정(기타)' AND 제출일이 선택 연도
        if (status !== '선정(기타)' && status !== '선정 (기타)') return false;
        if (!yearStr) return true;
        var submitYearS = (it.submitDate || it['제출일'] || '').toString().slice(0, 4);
        return submitYearS === yearStr;
      }
      return true;
    }

    // status 필터(수행 중/예정/종료) 매칭
    function projectMatchesStatusFilter(it, status) {
      if (!status) return true;
      var s = (it.status || it['진행 여부'] || it.division2 || '').toString().trim();
      var sNorm = s.replace(/\s/g, '');
      var targetNorm = status.replace(/\s/g, '');
      return s === status || sNorm === targetNorm;
    }

    // 검색 매칭 — 여러 필드를 합쳐서 substring 검색 (대소문자 무시)
    function projectMatchesSearch(it, query) {
      if (!query) return true;
      var q = String(query).toLowerCase().trim();
      if (!q) return true;
      // 모든 표시 가능 필드 + 자동 판정 status까지 통합 검색
      var fields = [
        it.projectName, it['과제명'],
        it.manager, it['책임자'],
        it.charge, it['담당자'],
        it.department, it['부처'],
        it.business, it['사업명'],
        it.institution, it['기관명'],
        it.keywords, it.keyword, it['키워드'],
        it.no,
        it.division1, it['구분1'],
        it.division2, it['구분2'],
        it.status, it['진행 여부'],
        statusAsOf(it, null),  // 자동 판정 상태 ('수행' 검색 → status 비어있어도 잡힘)
        it.startDate, it.start, it['시작일'],
        it.endDate, it.end, it['종료일'],
        it.submitDate, it['제출일'],
        it.note, it['비고']
      ];
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f != null && String(f).toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    }

    // 분류(division1) 매칭
    function projectMatchesDivision(it, division) {
      if (!division) return true;
      return (it.division1 || it['구분1'] || '') === division;
    }

    // 카드/큰숫자/sub-section 활성 상태 UI 동기화
    function updateActiveCardUI() {
      document.querySelectorAll('[data-filter].clickable').forEach(function (el) {
        var f = el.getAttribute('data-filter');
        var isActive = (f === activeCardFilter);
        el.classList.toggle('is-active', isActive);
        if (el.tagName === 'DIV' || el.classList.contains('projects-stat-card')) {
          el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
      });
    }

    // 분류 pill 활성 상태 UI 동기화
    function updateActiveDivisionUI() {
      document.querySelectorAll('.division-pill').forEach(function (pill) {
        var d = pill.getAttribute('data-division');
        var isActive = (d === activeDivisionFilter);
        pill.classList.toggle('is-active', isActive);
        pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    // 활성 필터 chip 렌더 (카드/status/분류 모두 표시 가능)
    function renderActiveFilterChip() {
      if (!activeFiltersWrap) return;
      activeFiltersWrap.innerHTML = '';

      var chips = [];
      if (activeCardFilter === 'ongoing') {
        var ongoingLabel = activeSummaryDivision ? ('수행 · ' + activeSummaryDivision) : '수행';
        chips.push({ label: ongoingLabel, clear: function () { activeCardFilter = null; activeSummaryDivision = null; } });
      }
      else if (activeCardFilter === 'continue')    chips.push({ label: '수행 (계속)',  clear: function () { activeCardFilter = null; } });
      else if (activeCardFilter === 'new')         chips.push({ label: '수행 (신규)',  clear: function () { activeCardFilter = null; } });
      else if (activeCardFilter === 'unselected')  chips.push({ label: '미선정',          clear: function () { activeCardFilter = null; } });
      if (activeStatusFilter)                     chips.push({ label: activeStatusFilter, clear: function () { activeStatusFilter = null; } });
      if (activeDivisionFilter)                   chips.push({ label: activeDivisionFilter, clear: function () { activeDivisionFilter = null; } });

      chips.forEach(function (c) {
        var chip = document.createElement('span');
        chip.className = 'projects-filter-chip';
        chip.innerHTML = '필터: ' + escapeHtml(c.label) +
          ' <button type="button" class="projects-filter-chip-clear" aria-label="필터 해제">×</button>';
        activeFiltersWrap.appendChild(chip);
        chip.querySelector('.projects-filter-chip-clear').addEventListener('click', function () {
          c.clear();
          syncURL();
          applyFilterAndRender(latestItems);
        });
      });
    }

    // URL 파라미터 동기화 (페이지 새로고침해도 필터 유지)
    function syncURL() {
      var params = new URLSearchParams(location.search);
      params.delete('filter');
      params.delete('status');
      params.delete('division');
      params.delete('odiv');
      if (activeCardFilter)     params.set('filter', activeCardFilter);
      if (activeStatusFilter)   params.set('status', activeStatusFilter);
      if (activeDivisionFilter) params.set('division', activeDivisionFilter);
      if (activeCardFilter === 'ongoing' && activeSummaryDivision) params.set('odiv', activeSummaryDivision);
      var query = params.toString();
      var newUrl = location.pathname + (query ? '?' + query : '') + location.hash;
      try { history.replaceState(null, '', newUrl); } catch (e) {}
    }


    function applyFilterAndRender(items) {
      items = Array.isArray(items) ? items : [];
      latestItems = items;

      // 회사 필터 (전 페이지 공유) — 이후 모든 통계/필터 단계에 적용
      var company = (window.CompanyFilter && window.CompanyFilter.get) ? window.CompanyFilter.get() : '';
      if (company) {
        items = items.filter(function (it) { return it && it.company === company; });
      }

      var filterYear = getFilterYear();
      var statsYear = getStatsYear();
      var cutoff = statsYear + '-01-01';

      // 분류 pill 카운트용 풀 — 항상 "연도 필터까지만" 적용 (카드 클릭과 무관하게 의미 가짐)
      var yearFiltered = filterYear ? items.filter(function (it) { return projectOverlapsYear(it, filterYear); }) : items.slice();

      // 신규 제안 풀 (B 기준 — 제출일이 그 연도) — 총 제안 + 분류 pill + 월별 카드에 사용
      var submitYearItems = filterYear
        ? items.filter(function (it) {
            var sd = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
            return sd.slice(0, 4) === filterYear;
          })
        : items.filter(function (it) {
            return !!(it.submitDate || it['제출일']);
          });

      // 분류별 카운트 갱신 (B 기준)
      var divisionCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
      submitYearItems.forEach(function (it) {
        var d = (it.division1 || it['구분1'] || '').toString();
        if (divisionCounts.hasOwnProperty(d)) divisionCounts[d]++;
      });

      // 표에 표시할 listItems 시작 풀
      //  - 카드 필터 활성: 전체 items에서 시작 (카드 함수가 자체 연도 매칭 → 시작일 없는 미선정도 잡힘)
      //  - 카드 필터 없음: 연도 필터만 적용 (yearFiltered)
      var listItems;
      if (activeCardFilter) {
        listItems = items.filter(function (it) {
          return projectMatchesCardFilter(it, activeCardFilter, cutoff);
        });
      } else {
        listItems = yearFiltered;
      }

      // 3단계: status 필터 (URL 진입용)
      if (activeStatusFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesStatusFilter(it, activeStatusFilter);
        });
      }

      // 4단계: 분류(division1) 필터
      if (activeDivisionFilter) {
        listItems = listItems.filter(function (it) {
          return projectMatchesDivision(it, activeDivisionFilter);
        });
      }

      // 4-b단계: 분류 제외 필터 (대시보드 '수행 과제'에서 진입 시 — 용역 제외용)
      if (activeExcludeDivisionFilter) {
        listItems = listItems.filter(function (it) {
          return !projectMatchesDivision(it, activeExcludeDivisionFilter);
        });
      }

      // 4-c단계: 신규 제안 필터 — 그 해 제출일이 있는 것만 (대시보드 '총 신규 제안'에서 진입 시)
      if (activeNewProposalOnly && filterYear) {
        listItems = listItems.filter(function (it) {
          var submit = (it.submitDate || it['제출일'] || '').toString();
          return submit.slice(0, 4) === String(filterYear);
        });
      }

      // 4-d단계: 제출 월 필터 — 그 해·그 달 제출분만 (대시보드 월별 신규제안 그래프 월 클릭 진입 시)
      if (activeSubmitMonth && filterYear) {
        var smPrefix = String(filterYear) + '-' + (activeSubmitMonth < 10 ? '0' + activeSubmitMonth : '' + activeSubmitMonth);
        listItems = listItems.filter(function (it) {
          return (it.submitDate || it['제출일'] || '').toString().slice(0, 7) === smPrefix;
        });
      }

      // 5단계: 검색 키워드 필터
      if (activeSearchQuery) {
        listItems = listItems.filter(function (it) {
          return projectMatchesSearch(it, activeSearchQuery);
        });
      }

      // 6단계: 제출일 기준 자동 정렬 (최신 → 오래된)
      //  - 제출일 없는 항목은 시작일로 대체
      //  - 둘 다 없으면 가장 아래
      listItems = listItems.slice().sort(function (a, b) {
        var ad = (a.submitDate || a.startDate || '').toString();
        var bd = (b.submitDate || b.startDate || '').toString();
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return bd.localeCompare(ad);
      });

      // 엑셀 내보내기를 위해 현재 보이는 아이템 보관
      // summaryBase = 카드/검색 등으로 필터된 집합 (유형별 분해의 모집단 — 분류 선택과 무관하게 전체 분해 유지)
      var summaryBase = listItems;
      // filter-summary-row 유형별 클릭 시: 활성 카드필터 ∩ 분류 → 표시 목록만 좁힘
      if (activeCardFilter && activeSummaryDivision) {
        listItems = listItems.filter(function (it) {
          return projectMatchesDivision(it, activeSummaryDivision);
        });
      }
      lastFilteredItems = listItems;

      // 통계는 항상 연도 기준 전체 (모든 필터 무시 — 그래야 카드/pill 숫자가 의미를 가짐)
      updateStats(items, statsYear, filterYear);
      // "총 신규 제안" + 분류 pill 카운트 — B 기준 (제출일 = 그 연도)로 덮어쓰기
      setEl('stat-total', submitYearItems.length);
      Object.keys(divisionCounts).forEach(function (d) {
        var el = document.getElementById('stat-div-' + d);
        if (el) el.textContent = divisionCounts[d];
      });

      // 카드 가시성:
      //   - "수행" 통합 카드: 항상 표시
      //   - 그 안의 (계속/신규) sub-section: 특정 연도일 때만 표시
      var ongoingSub = document.getElementById('ongoing-sub');
      if (ongoingSub) {
        ongoingSub.style.display = filterYear ? '' : 'none';
      }
      // 카드 필터가 없으면 유형별 분류 선택도 해제
      if (!activeCardFilter && activeSummaryDivision) {
        activeSummaryDivision = null;
      }
      // 전체 모드로 전환 → sub-section 필터(continue/new/ended)는 모두 ongoing으로 통합 또는 해제
      if (!filterYear && (activeCardFilter === 'continue' || activeCardFilter === 'new' || activeCardFilter === 'ended')) {
        activeCardFilter = activeCardFilter === 'ended' ? null : 'ongoing';
        syncURL();
      }

      // sub-section의 active 상태 표시
      var subContinue = document.querySelector('.ongoing-sub-item[data-filter="continue"]');
      var subNew      = document.querySelector('.ongoing-sub-item[data-filter="new"]');
      var subEnded    = document.querySelector('.ongoing-sub-item[data-filter="ended"]');
      if (subContinue) subContinue.classList.toggle('active', activeCardFilter === 'continue');
      if (subNew)      subNew.classList.toggle('active', activeCardFilter === 'new');
      if (subEnded)    subEnded.classList.toggle('active', activeCardFilter === 'ended');

      renderTable(listItems, colVis, filterYear, projectEditHandler);
      // 당해 환급예정 컬럼: 연도 선택 시만 표시(전체면 숨김). CSS에 의존하지 않고 JS로 직접 토글.
      var showYearCol = !!filterYear;
      var ptable = document.getElementById('projects-table');
      if (ptable) {
        ptable.classList.toggle('projects-table--no-year', !showYearCol);  // CSS 중복 방어
        var yth = ptable.querySelector('thead th.col-year-only');
        if (yth) yth.style.display = showYearCol ? '' : 'none';
        ptable.querySelectorAll('tbody td.col-year-only').forEach(function (td) {
          td.style.display = showYearCol ? '' : 'none';
        });
      }
      if (filterYear) loadRefundForYear(latestItems, filterYear);
      updateFilterSummary(summaryBase, activeCardFilter, activeSummaryDivision, listItems.length);

      if (filterHint) {
        var listLabel = filterYear ? filterYear + '년' : '전체';
        var statsLabel = filterYear ? filterYear + '년' : STAT_YEAR + '년';
        var hintText = '리스트: ' + listLabel + ' / 통계: ' + statsLabel + ' 기준';
        if (activeSubmitMonth) {
          hintText += ' · ' + activeSubmitMonth + '월 제출';
        }
        if (activeSearchQuery || activeCardFilter || activeStatusFilter || activeDivisionFilter || activeSubmitMonth) {
          hintText += ' · 결과 ' + listItems.length + '건';
        }
        filterHint.textContent = hintText;
      }

      updateActiveCardUI();
      updateActiveDivisionUI();
      renderActiveFilterChip();
    }

    if (yearFilter) {
      yearFilter.addEventListener('change', function () {
        // 선택값을 sessionStorage에 저장 (과제 등록 등 다녀와도 유지)
        try { sessionStorage.setItem('projects-filter-year', yearFilter.value || ''); } catch (e) {}
        applyFilterAndRender(latestItems);
      });
    }

    // 카드 클릭 → 필터 토글 (data-filter 가진 모든 clickable: 카드/큰숫자/sub-section)
    document.querySelectorAll('[data-filter].clickable').forEach(function (el) {
      var f = el.getAttribute('data-filter');
      function handle() {
        if (activeCardFilter === f) {
          activeCardFilter = null;
        } else {
          activeCardFilter = f;
          activeStatusFilter = null;
        }
        activeSummaryDivision = null;  // 카드 필터 바뀌면 유형별 분류 선택 초기화
        syncURL();
        applyFilterAndRender(latestItems);
      }
      el.addEventListener('click', handle);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handle();
        }
      });
    });

    // 분류 pill 클릭 → 분류 필터 토글 (다른 필터와 AND 조건으로 결합)
    document.querySelectorAll('.division-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var d = pill.getAttribute('data-division');
        if (activeDivisionFilter === d) {
          activeDivisionFilter = null;
        } else {
          activeDivisionFilter = d;
        }
        syncURL();
        applyFilterAndRender(latestItems);
      });
    });

    // filter-summary-row 유형별 클릭 → 활성 카드필터 ∩ 분류 (위임: 매 렌더마다 innerHTML 재생성되므로)
    var filterSummaryRow = document.getElementById('filter-summary-row');
    if (filterSummaryRow) {
      function summaryDivisionHandle(target) {
        var pill = target.closest ? target.closest('[data-summary-division]') : null;
        if (!pill) return;
        var d = pill.getAttribute('data-summary-division');
        activeSummaryDivision = (activeSummaryDivision === d) ? null : d;
        syncURL();
        applyFilterAndRender(latestItems);
      }
      filterSummaryRow.addEventListener('click', function (e) { summaryDivisionHandle(e.target); });
      filterSummaryRow.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('data-summary-division')) {
          e.preventDefault();
          summaryDivisionHandle(e.target);
        }
      });
    }

    // "총 제안" 헤더 클릭 → 분류 필터 해제 (전체 보기)
    var divisionClearTrigger = document.getElementById('division-clear-trigger');
    if (divisionClearTrigger) {
      function clearDivision() {
        if (activeDivisionFilter !== null) {
          activeDivisionFilter = null;
          syncURL();
          applyFilterAndRender(latestItems);
        }
      }
      divisionClearTrigger.addEventListener('click', clearDivision);
      divisionClearTrigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clearDivision();
        }
      });
    }

    // 과제 등록 버튼: 상세 페이지로 이동
    var addBtn = document.getElementById('project-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        window.location.href = 'project-detail.html';
      });
    }

    // 테이블 행 "수정" 버튼: 상세 페이지로 이동 (편집 모드)
    var projectEditHandler = function (item) {
      var id = item.id || item.docId;
      if (!id) return;
      window.location.href = 'project-detail.html?id=' + encodeURIComponent(id);
    };

    // 검색 입력 — 입력하는 즉시 필터 적용 (debounce 약간)
    var searchInput = document.getElementById('project-search');
    var searchClear = document.getElementById('search-clear');
    var searchWrap  = document.getElementById('search-wrap');
    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var v = searchInput.value || '';
        // 입력 중에는 빠른 입력 보호를 위해 100ms debounce
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          activeSearchQuery = v.trim();
          if (searchWrap) searchWrap.classList.toggle('has-value', !!v);
          applyFilterAndRender(latestItems);
        }, 100);
      });
      // ESC 키로 검색 초기화
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = '';
          activeSearchQuery = '';
          if (searchWrap) searchWrap.classList.remove('has-value');
          applyFilterAndRender(latestItems);
        }
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        activeSearchQuery = '';
        if (searchWrap) searchWrap.classList.remove('has-value');
        applyFilterAndRender(latestItems);
        if (searchInput) searchInput.focus();
      });
    }

    // 엑셀 다운로드 버튼 — 컬럼 선택 모달 거침
    var exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        openDownloadModal('excel');
      });
    }

    // 클립보드 복사 버튼 — 컬럼 선택 모달 거침
    var copyBtn = document.getElementById('copy-clipboard-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        openDownloadModal('copy');
      });
    }

    // ===== 다운로드 컬럼 선택 모달 =====
    var dlModal = document.getElementById('dl-modal');
    var dlModalClose = document.getElementById('dl-modal-close');
    var dlModalCancel = document.getElementById('dl-modal-cancel');
    var dlModalConfirm = document.getElementById('dl-modal-confirm');
    var dlModalTitle = document.getElementById('dl-modal-title');
    var pendingDlAction = null; // 'excel' 또는 'copy'

    function openDownloadModal(action) {
      pendingDlAction = action;
      if (!dlModal) return;

      // 모달 제목 + 확인 버튼 텍스트 갱신
      if (dlModalTitle) {
        dlModalTitle.textContent = action === 'excel' ? '엑셀 다운로드 - 컬럼 선택' : '시트로 복사 - 컬럼 선택';
      }
      if (dlModalConfirm) {
        dlModalConfirm.textContent = action === 'excel' ? '📥 다운로드' : '📋 복사';
      }

      // 화면에서 켠 옵션을 초기값으로 (사용자의 화면 의도를 존중)
      var screenVis = getColVisibility();
      dlModal.querySelectorAll('#dl-modal-options input[type="checkbox"]').forEach(function (cb) {
        var col = cb.getAttribute('data-col');
        cb.checked = !!screenVis[col];
      });

      dlModal.style.display = 'flex';
    }

    function closeDownloadModal() {
      pendingDlAction = null;
      if (dlModal) dlModal.style.display = 'none';
    }

    function getDlModalSelectedCols() {
      var sel = {};
      if (!dlModal) return sel;
      dlModal.querySelectorAll('#dl-modal-options input[type="checkbox"]').forEach(function (cb) {
        sel[cb.getAttribute('data-col')] = cb.checked;
      });
      return sel;
    }

    if (dlModalClose) dlModalClose.addEventListener('click', closeDownloadModal);
    if (dlModalCancel) dlModalCancel.addEventListener('click', closeDownloadModal);
    // 오버레이 바깥 클릭 시 닫기
    if (dlModal) {
      dlModal.addEventListener('click', function (e) {
        if (e.target === dlModal) closeDownloadModal();
      });
    }
    // ESC로 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dlModal && dlModal.style.display === 'flex') {
        closeDownloadModal();
      }
    });
    if (dlModalConfirm) {
      dlModalConfirm.addEventListener('click', function () {
        var override = getDlModalSelectedCols();
        var action = pendingDlAction;
        closeDownloadModal();
        if (action === 'excel') {
          exportToExcel(lastFilteredItems, override);
        } else if (action === 'copy') {
          copyToClipboard(lastFilteredItems, copyBtn, override);
        }
      });
    }

    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        populateYearOptions(items);
        applyFilterAndRender(items);
      });
    } else {
      populateYearOptions([]);
      applyFilterAndRender([]);
    }

    // 회사 필터 칩 (전 페이지 공유)
    if (window.CompanyFilter) {
      window.CompanyFilter.mountChips('projects-company-chips', function () {
        applyFilterAndRender(latestItems);
      });
    }
  }

  // ===== 엑셀 내보내기 =====

  // ===== 화면에 보이는 컬럼 데이터 추출 (엑셀/클립보드 공용) =====
  // override: 모달에서 선택한 옵션 컬럼 {'부처': true, ...}. 미지정 시 화면 옵션 사용.
  function getVisibleColumnsData(items, override) {
    var rows = [];

    items.forEach(function (it, idx) {
      var no = idx + 1;
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      var status = normalizeStatus(it);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var division1 = it.division1 || it['구분1'] || '';
      var keywords = it.keywords || it.keyword || it['키워드'] || '';
      var manager = it.manager || it['책임자'] || '';
      var institution = it.institution || it['기관명'] || '';
      var researchPeriod = (start || '') + (start || end ? ' ~ ' : '') + (end || '');
      if (!start && !end) researchPeriod = '';

      // 당해 입금 (이번 연도 시작 yearBudget.support)
      var thisYear = String(new Date().getFullYear());
      var thisYearIncome = 0;
      if (Array.isArray(it.yearBudgets)) {
        it.yearBudgets.forEach(function (yb, ybIdx) {
          var ybStart = (yb.startDate || (ybIdx === 0 ? it.startDate : '') || '').toString().slice(0, 4);
          if (ybStart === thisYear) {
            var ybSup = Number(yb.support || 0);
            if (!ybSup && ybIdx === 0) ybSup = Number(it.supportTotal || it.budget || 0);
            thisYearIncome += ybSup;
          }
        });
      }

      // 총 지원금 (yearBudgets.support 합)
      var totalSupport = 0;
      if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
        it.yearBudgets.forEach(function (yb) { totalSupport += Number(yb.support || 0); });
      }
      if (totalSupport === 0) totalSupport = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));

      var row = {
        'No': no,
        '유형': division1,
        '진행 여부': status,
        '제출일': submitDate,
        '키워드': keywords,
        '책임자': manager,
        '연구기간': researchPeriod,
        '기관명': institution,
        '당해 입금': thisYearIncome || '',
        '총 지원금': totalSupport || ''
      };

      // 옵션 컬럼: override가 주어졌으면 그걸 사용, 아니면 화면에서 켠 것
      var colVis = (override && typeof override === 'object') ? override : getColVisibility();
      if (colVis['부처'])     row['부처']        = it.department || it['부처'] || '';
      if (colVis['과제명'])   row['과제명']      = it.projectName || it['과제명'] || '';
      if (colVis['시작일'])   row['시작일']      = start;
      if (colVis['종료일'])   row['종료일']      = end;
      if (colVis['지원금총']) row['당해 수주']    = thisYearIncome || '';
      if (colVis['비고'])     row['비고']        = it.note || it['비고'] || '';

      rows.push(row);
    });

    return rows;
  }

  // ===== 엑셀 다운로드 (화면에 보이는 컬럼만) =====
  function exportToExcel(items, override) {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리(SheetJS)가 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
      return;
    }
    if (!items || items.length === 0) {
      alert('내보낼 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    var rows = getVisibleColumnsData(items, override);
    var ws = XLSX.utils.json_to_sheet(rows);

    // 컬럼별 너비 (헤더 이름 기준 매핑)
    var widthMap = {
      'No': 5, '유형': 9, '진행 여부': 11,
      '제출일': 12, '키워드': 22, '책임자': 10,
      '연구기간': 24, '기관명': 18,
      '당해 입금': 16, '총 지원금': 16, '당해 수주': 16,
      '부처': 16, '과제명': 42,
      '시작일': 12, '종료일': 12, '비고': 24
    };
    if (rows.length > 0) {
      var headers = Object.keys(rows[0]);
      ws['!cols'] = headers.map(function (h) { return { wch: widthMap[h] || 14 }; });

      // 숫자 포맷 (금액 컬럼)
      var range = XLSX.utils.decode_range(ws['!ref']);
      headers.forEach(function (h, colIdx) {
        if (h === '당해 입금' || h === '총 지원금' || h === '당해 수주') {
          var colLetter = XLSX.utils.encode_col(colIdx);
          for (var R = range.s.r + 1; R <= range.e.r; R++) {
            var cellRef = colLetter + (R + 1);
            if (ws[cellRef] && ws[cellRef].v !== '' && ws[cellRef].v != null) {
              ws[cellRef].t = 'n';
              ws[cellRef].z = '#,##0';
            }
          }
        }
      });
    }

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '과제 목록');

    // 파일명: 과제목록_YYYY-MM-DD.xlsx
    var today = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var dateStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    var filename = '과제목록_' + dateStr + '.xlsx';

    try {
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('엑셀 내보내기 실패:', err);
      alert('엑셀 내보내기에 실패했습니다. 다시 시도해 주세요.');
    }
  }

  // ===== 클립보드 복사 (화면에 보이는 컬럼만, 탭 구분 TSV) =====
  // 구글 시트/엑셀 빈 셀에 Ctrl+V 하면 그대로 표 형태로 붙여넣어짐
  function copyToClipboard(items, btnEl, override) {
    if (!items || items.length === 0) {
      alert('복사할 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    var rows = getVisibleColumnsData(items, override);
    if (rows.length === 0) return;

    var headers = Object.keys(rows[0]);
    function sanitize(v) {
      if (v == null) return '';
      return String(v).replace(/[\t\r\n]/g, ' ');
    }

    var lines = [headers.join('\t')];
    rows.forEach(function (r) {
      var cols = headers.map(function (h) { return sanitize(r[h]); });
      lines.push(cols.join('\t'));
    });
    var tsv = lines.join('\n');

    var done = function () {
      if (!btnEl) return;
      var originalText = btnEl.dataset.originalText || btnEl.textContent;
      btnEl.dataset.originalText = originalText;
      btnEl.textContent = '✓ 복사됨 (' + rows.length + '건)';
      btnEl.disabled = true;
      setTimeout(function () {
        btnEl.textContent = originalText;
        btnEl.disabled = false;
      }, 1500);
    };
    var fail = function (err) {
      console.error('클립보드 복사 실패:', err);
      alert('클립보드 복사에 실패했습니다.\n브라우저가 클립보드 접근을 허용하는지 확인해 주세요.');
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(done).catch(fail);
    } else {
      try {
        var ta = document.createElement('textarea');
        ta.value = tsv;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done(); else fail(new Error('execCommand returned false'));
      } catch (err) {
        fail(err);
      }
    }
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
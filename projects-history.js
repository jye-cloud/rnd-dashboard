/**
 * 과제 관리 페이지 - Firestore 실시간 연동
 */
(function () {
  'use strict';

  var CUTOFF = '2026-01-01';
  var STAT_YEAR = 2026;
  // 열 선택 옵션 (책임자 / 부처 / 사업명 / 키워드)
  var COL_KEYS = ['책임자', '부처', '사업명', '키워드'];
  var COL_FIELDS = { '책임자': 'manager', '부처': 'department', '사업명': 'business', '키워드': '__keywords' };

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
  var COL_KEYS_OLD_REMOVED = null; // (이전 중복 선언 제거됨 - 위쪽 정의 사용)

  function getVal(item, key) {
    var f = COL_FIELDS[key];
    return item[f] != null ? String(item[f]) : (item[key] != null ? String(item[key]) : '');
  }

  function getResearchPeriodDisplay(item, filterYear) {
    var fallbackStart = (item.startDate || item.start || '').toString().slice(0, 10);
    var fallbackEnd = (item.endDate || item.end || '').toString().slice(0, 10);
    var yearStr = filterYear ? String(filterYear) : null;
    var arr = item.annualData || item.yearBudgets || [];
    if (!Array.isArray(arr)) arr = [];
    for (var i = 0; i < arr.length; i++) {
      var y = arr[i];
      var s = (y.start || y.startDate || '').toString().slice(0, 10);
      var e = (y.end || y.endDate || '').toString().slice(0, 10);
      if (!s && !e) continue;
      var sYear = s ? s.slice(0, 4) : '';
      var eYear = e ? e.slice(0, 4) : '';
      if (yearStr && sYear && eYear && sYear <= yearStr && yearStr <= eYear) {
        return (s || '-') + ' ~ ' + (e || '-');
      }
    }
    if (fallbackStart || fallbackEnd) return (fallbackStart || '-') + ' ~ ' + (fallbackEnd || '-');
    return '-';
  }

  function getTypeBadgeClass(type) {
    var s = (type || '').trim();
    if (s === '과제') return 'projects-badge--type-task';
    if (s === '지원사업') return 'projects-badge--type-grant';
    if (s === '용역') return 'projects-badge--type-service';
    if (s === '기타') return 'projects-badge--type-other';
    return '';
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
      // 우선순위: 종료일 지남 → 종료 / 시작 ≤ 오늘 ≤ 종료 → 수행 / 시작 미래 → 예정 / 제출 미래 → 예정 / 제출 과거 → 대기
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
   * statsYear의 마지막 날 YYYY-MM-DD (statsYear 시점 status 판정용)
   */
  function yearEndDate(year) {
    return String(year) + '-12-31';
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
  function updateFilterSummary(listItems, activeCardFilter) {
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

    // 유형별 + R&D 카운트
    var counts   = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
    var rdCounts = { '과제': 0, '지원사업': 0, '용역': 0, '기타': 0 };
    listItems.forEach(function (it) {
      var d = (it.division1 || it['구분1'] || '').toString();
      if (!counts.hasOwnProperty(d)) return;
      counts[d]++;
      var isRd = it.isRd === true || it.rd === true || it['R&D 여부'] === true;
      if (isRd) rdCounts[d]++;
    });
    function pill(label, n, rd) {
      var zero = n === 0 ? ' filter-summary-pill--zero' : '';
      var rdText = rd > 0 ? '<span class="filter-summary-rd">(R&amp;D ' + rd + ')</span>' : '';
      return '<span class="filter-summary-pill' + zero + '">' + label + ' <strong>' + n + '</strong>' + rdText + '</span>';
    }
    el.innerHTML =
      '<span class="filter-summary-title">' + titleMap[activeCardFilter] + ' ' + listItems.length + '건</span>' +
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

      // ── 당해 수주 총 지원금 ──
      // 조건: status가 수주(수행/종료/선정기타) AND yearBudget.startDate가 statsYear
      // 합산: 그 연차의 support (정부지원금)
      // 분류: 그 yearBudget이 1차(index 0) → 신규, 2차 이상 → 계속
      var isSelected = (status === '수행' || status === '종료' ||
                        status === '선정(기타)' || status === '선정 (기타)');
      if (isSelected && Array.isArray(it.yearBudgets)) {
        it.yearBudgets.forEach(function (yb, ybIdx) {
          // yb.startDate 없으면 1차(ybIdx=0)일 때 it.startDate 폴백
          var ybStartRaw = yb.startDate || (ybIdx === 0 ? it.startDate : '');
          var ybStartYear = (ybStartRaw || '').toString().slice(0, 4);
          if (ybStartYear !== yearStr) return;
          var sup = Number(yb.support || 0);
          if (!sup) return;
          sujuTotal += sup;
          if (ybIdx === 0) {
            sujuNew += sup;       // 1차 = 신규 (과제 자체가 그 해 시작)
          } else {
            sujuContinue += sup;  // 2차 이상 = 계속 (다년 과제의 새 연차)
          }
        });
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
      var sy = 0;
      if (it.yearBudgets && Array.isArray(it.yearBudgets)) {
        it.yearBudgets.forEach(function (y) {
          sy += supportInYear(y, statsYear);
        });
      } else if (it.supportYear != null && !isNaN(Number(it.supportYear)) && Number(statsYear) === STAT_YEAR) {
        // 옛 데이터 폴백
        sy = Number(it.supportYear);
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

      // 당해 입금 완료 — actualPayments + 옛 payments 마이그레이션
      if (Array.isArray(it.yearBudgets)) {
        it.yearBudgets.forEach(function (yb) {
          // 새 구조: actualPayments
          if (Array.isArray(yb.actualPayments)) {
            yb.actualPayments.forEach(function (p) {
              var aY = (p.date || '').toString().slice(0, 4);
              if (aY === yearStr && p.amount) {
                actualSum += Number(p.amount) || 0;
              }
            });
          }
          // 옛 구조: payments에서 actualDate/actualAmount
          if (Array.isArray(yb.payments)) {
            yb.payments.forEach(function (p) {
              var aY = (p.actualDate || '').toString().slice(0, 4);
              if (aY === yearStr && p.actualAmount) {
                actualSum += Number(p.actualAmount) || 0;
              }
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

    // ===== 새 HTML 통계 카드 id (단순화된 5개) =====
    setEl('stat-history-total', totalCount);
    setEl('stat-ongoing', ongoingAll);
    setEl('stat-ended', endedCnt);
    // 예정: statsYear 시점 기준 status='예정' 또는 '대기' 또는 '선정(기타)' (=결과 대기/선정 중)
    var scheduledCnt = 0;
    items.forEach(function (it) {
      var st = statusAsOf(it, yearEndDate(statsYear));
      var sd = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var sy = sd ? sd.slice(0, 4) : '';
      if ((st === '예정' || st === '대기' || st === '선정(기타)') && sy === yearStr) {
        scheduledCnt++;
      }
    });
    setEl('stat-scheduled', scheduledCnt);

    // 총 지원금: yearSum (그 해 입금분) — 자동 단위 (억/만/원)
    var totalSumEl = document.getElementById('stat-total-sum');
    var totalSumUnitEl = document.getElementById('stat-total-sum-unit');
    if (totalSumEl) {
      if (yearSum >= 1e8) {
        totalSumEl.textContent = (yearSum / 1e8).toFixed(1);
        if (totalSumUnitEl) totalSumUnitEl.textContent = '억';
      } else if (yearSum >= 1e4) {
        totalSumEl.textContent = Math.round(yearSum / 1e4).toLocaleString('ko-KR');
        if (totalSumUnitEl) totalSumUnitEl.textContent = '만';
      } else {
        totalSumEl.textContent = formatNum(yearSum);
        if (totalSumUnitEl) totalSumUnitEl.textContent = '원';
      }
    }

    // ===== 옛 통계 카드 id (현재 HTML에는 없음 — 호환용 try) =====
    setEl('stat-total', totalCount);
    setEl('stat-ongoing-all', ongoingAll);
    setEl('stat-continue', continueCnt);
    setEl('stat-new', newCnt);
    setEl('stat-waiting', waitingCnt);
    setEl('stat-selected-other', selectedOtherCnt);
    setEl('stat-unselected', unselectedCnt);
    setEl('stat-year-sum', formatNum(yearSum));

    // 당해 수주 총 지원금 + 하위 (계속/신규)
    setEl('stat-ongoing-sum', formatNum(sujuTotal));
    setEl('stat-continue-sum', formatNum(sujuContinue));
    setEl('stat-new-sum', formatNum(sujuNew));

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

    // sub-section: filterYear 있을 때만 표시 (수주/입금/실제 셋 다)
    var sumSub = document.getElementById('ongoing-sum-sub');
    if (sumSub) sumSub.style.display = filterYear ? '' : 'none';
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
    var ths = document.querySelectorAll('#history-table thead th.col-opt');
    var rows = document.querySelectorAll('#history-table tbody tr');
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

  function renderTable(items, colVis, filterYear, currentTab) {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;

    // thead 전환 (R&D / 용역)
    var theadRd = document.getElementById('thead-rd');
    var theadService = document.getElementById('thead-service');
    var isService = (currentTab === 'service');
    if (theadRd) theadRd.style.display = isService ? 'none' : '';
    if (theadService) theadService.style.display = isService ? '' : 'none';
    // 테이블에 용역 모드 클래스 토글 (CSS에서 컬럼 너비 분기)
    var tableEl = document.getElementById('history-table');
    if (tableEl) tableEl.classList.toggle('is-service', isService);
    // 열 선택 버튼 — 용역 탭에서는 숨김 (옵션 컬럼 없음)
    var colToggleBtn = document.getElementById('col-toggle-btn');
    if (colToggleBtn) colToggleBtn.style.display = isService ? 'none' : '';

    tbody.innerHTML = '';
    items.forEach(function (it, idx) {
      var id = it.id || it.docId || 'item-' + idx;
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);

      // 진행 여부 — 항상 오늘 시점 기준 (과제 관리 페이지와 일관성)
      var status = statusAsOf(it, null);
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

      var no = idx + 1;
      var projectName = it.projectName || it['과제명'] || '-';
      var institution = it.institution || it['기관명'] || '-';
      var researchPeriod = getResearchPeriodDisplay(it, filterYear);

      var cells;

      if (isService) {
        // ===== 용역 탭 =====
        // 사업비 총액(VAT 포함) = yearBudgets[].totalIncludingVat 합
        // 공급가(VAT 제외) = yearBudgets[].support 합 (= total/1.1 자동계산)
        var totalVat = 0, supplySum = 0;
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb) {
            var t = Number(yb.totalIncludingVat || 0);
            var s = Number(yb.support || 0);
            // 옛 데이터(totalIncludingVat 없음) 호환: support×1.1 추정
            if (!t && s) t = Math.round(s * 1.1);
            // 옛 데이터(support 없음) 호환: total/1.1
            if (!s && t) s = Math.round(t / 1.1);
            totalVat += t;
            supplySum += s;
          });
        }
        var totalVatDisplay = totalVat > 0 ? formatNum(totalVat) : '-';
        var supplyDisplay = supplySum > 0 ? formatNum(supplySum) : '-';

        // 코드 (아직 미구현 — 추후 추가 예정)
        var code = it.code || it['코드'] || '-';

        cells = [
          '<td>' + escapeHtml(no) + '</td>',
          '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(statusDisplay) + '</span></td>',
          '<td class="col-projectname"><div class="cell-projectname" title="' + escapeHtml(projectName) + '">' + escapeHtml(projectName) + '</div></td>',
          '<td class="col-institution" title="' + escapeHtml(institution) + '">' + escapeHtml(institution) + '</td>',
          '<td class="col-period">' + escapeHtml(researchPeriod) + '</td>',
          '<td class="col-num">' + escapeHtml(totalVatDisplay) + '</td>',
          '<td class="col-num">' + escapeHtml(supplyDisplay) + '</td>',
          '<td>' + escapeHtml(code) + '</td>'
        ];
      } else {
        // ===== R&D 탭 =====
        var manager = it.manager || it.책임자 || '-';

        // 사업비 총액 = 정부지원금 + 자부담현금 + 자부담현물 (yearBudgets 누적)
        var totalBudget = 0;
        var govSum = 0;
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb) {
            var s = Number(yb.support || 0);
            var c = Number(yb.cash || 0);
            var k = Number(yb.inKind || 0);
            govSum += s;
            totalBudget += s + c + k;
          });
        }
        if (govSum === 0) govSum = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
        if (totalBudget === 0) totalBudget = govSum; // 자부담 없으면 정부지원금만
        var totalBudgetDisplay = totalBudget > 0 ? formatNum(totalBudget) : '-';
        var govDisplay = govSum > 0 ? formatNum(govSum) : '-';

        // 코드 (아직 미구현 — 추후 추가 예정, 용역과 동일하게 처리)
        var rdCode = it.code || it['코드'] || '-';

        cells = [
          '<td>' + escapeHtml(no) + '</td>',
          '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(statusDisplay) + '</span></td>',
          '<td class="col-projectname"><div class="cell-projectname" title="' + escapeHtml(projectName) + '">' + escapeHtml(projectName) + '</div></td>',
          '<td class="col-institution" title="' + escapeHtml(institution) + '">' + escapeHtml(institution) + '</td>',
          '<td class="col-period">' + escapeHtml(researchPeriod) + '</td>',
          '<td class="col-num">' + escapeHtml(govDisplay) + '</td>',
          '<td class="col-num">' + escapeHtml(totalBudgetDisplay) + '</td>',
          '<td>' + escapeHtml(rdCode) + '</td>'
        ];

        COL_KEYS.forEach(function (k) {
          var val;
          if (k === '키워드') {
            // 키워드는 escape 없이 (HTML 포함)
            cells.push('<td class="col-opt" data-col="' + k + '">' + getKeywordHtml(it) + '</td>');
            return;
          } else if (k === '책임자') {
            val = manager;
          } else {
            val = getVal(it, k) || '-';
          }
          cells.push('<td class="col-opt" data-col="' + k + '">' + escapeHtml(val) + '</td>');
        });
      }

      tr.innerHTML = cells.join('');
      tbody.appendChild(tr);
    });

    // R&D 탭에서만 열 토글 적용
    if (!isService) {
      applyColVisibility(colVis || getColVisibility());
    }
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
    var yearFilter = document.getElementById('history-year-filter');
    var filterHint = document.getElementById('history-meta');
    var activeFiltersWrap = document.getElementById('history-active-filters');

    // ----- 활성 필터 상태 -----
    // activeCardFilter: 'continue' | 'new' | 'unselected' (카드 클릭으로 활성화)
    // activeStatusFilter: '수행' | '예정' | '종료' (URL ?status= 진입 시, 카드와 매칭 안 되는 status용)
    // activeDivisionFilter: '과제' | '지원사업' | '용역' | '기타' (분류 pill 클릭으로 활성화)
    // activeSearchQuery: 검색 입력 키워드
    var activeCardFilter = null;
    var activeStatusFilter = null;
    var activeDivisionFilter = null;
    var activeSearchQuery = '';
    var lastFilteredItems = []; // 엑셀 내보내기용 — 현재 화면에 보이는 아이템들
    var currentTab = 'rd';      // 'rd' (R&D 활동) | 'service' (용역)
    var rdOnly = false;         // R&D 활동 탭 안의 NTIS 토글
    // 엑셀/클립보드 함수에서 현재 탭을 알 수 있도록 노출
    window.__currentTabRef = function () { return currentTab; };

    // 페이지 로드 시 URL 파라미터에서 초기 필터 읽기
    (function readInitialFilter() {
      var params = new URLSearchParams(location.search);
      var filter = params.get('filter');
      var status = params.get('status');
      var division = params.get('division');

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
      if (activeCardFilter === 'ongoing')          chips.push({ label: '수행',         clear: function () { activeCardFilter = null; } });
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
      if (activeCardFilter)     params.set('filter', activeCardFilter);
      if (activeStatusFilter)   params.set('status', activeStatusFilter);
      if (activeDivisionFilter) params.set('division', activeDivisionFilter);
      var query = params.toString();
      var newUrl = location.pathname + (query ? '?' + query : '') + location.hash;
      try { history.replaceState(null, '', newUrl); } catch (e) {}
    }

    // Chart.js 인스턴스 (재렌더 시 destroy 후 재생성)
    var monthlyChart = null;
    var datalabelsRegistered = false;

    /**
     * 월별 신규 제안 차트 — 스택 막대(유형별 파스텔) + 누적 라인 + 데이터 라벨
     */
    function renderMonthlyProposalChart(items, filterYear) {
      var canvas = document.getElementById('monthly-proposal-chart');
      if (!canvas || typeof Chart === 'undefined') return;

      // datalabels 플러그인 등록 (1회만)
      if (!datalabelsRegistered && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
        datalabelsRegistered = true;
      }

      // 유형별 12개월 카운트
      var byType = {
        '과제':     new Array(12).fill(0),
        '지원사업': new Array(12).fill(0),
        '용역':     new Array(12).fill(0),
        '기타':     new Array(12).fill(0)
      };
      items.forEach(function (it) {
        var sd = (it.submitDate || it['제출일'] || '').toString();
        if (!sd) return;
        if (filterYear && sd.slice(0, 4) !== filterYear) return;
        var mo = parseInt(sd.slice(5, 7), 10);
        if (isNaN(mo) || mo < 1 || mo > 12) return;
        var d = (it.division1 || it['구분1'] || '기타').toString();
        if (byType.hasOwnProperty(d)) byType[d][mo - 1] += 1;
      });

      // 누적
      var cumulative = new Array(12).fill(0);
      var cum = 0;
      for (var i = 0; i < 12; i++) {
        cum += byType['과제'][i] + byType['지원사업'][i] + byType['용역'][i] + byType['기타'][i];
        cumulative[i] = cum;
      }

      if (monthlyChart) {
        try { monthlyChart.destroy(); } catch (e) {}
      }

      // 막대 datalabels — 안에 흰글씨 숫자, 0이면 표시 안 함
      var barDatalabels = {
        color: '#374151',
        font: { weight: '700', size: 10 },
        formatter: function (v) { return v > 0 ? v : ''; }
      };

      monthlyChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
          datasets: [
            { label: '과제',     data: byType['과제'],     backgroundColor: '#93c5fd', borderColor: '#60a5fa', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '지원사업', data: byType['지원사업'], backgroundColor: '#6ee7b7', borderColor: '#34d399', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '용역',     data: byType['용역'],     backgroundColor: '#fdba74', borderColor: '#fb923c', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            { label: '기타',     data: byType['기타'],     backgroundColor: '#cbd5e1', borderColor: '#94a3b8', borderWidth: 1, stack: 'monthly', order: 2, datalabels: barDatalabels },
            {
              type: 'line',
              label: '누적',
              data: cumulative,
              borderColor: '#1d4ed8',
              backgroundColor: 'rgba(29, 78, 216, 0.08)',
              tension: 0.25,
              pointBackgroundColor: '#1d4ed8',
              pointRadius: 4,
              pointHoverRadius: 6,
              borderWidth: 2.5,
              fill: false,
              order: 1,
              datalabels: {
                anchor: 'end',
                align: 'top',
                offset: 4,
                color: '#1d4ed8',
                font: { weight: '700', size: 11 },
                formatter: function (v, ctx) {
                  // 이전 값과 같으면 표시 안 함 (변동 있을 때만)
                  var idx = ctx.dataIndex;
                  if (idx === 0) return v;
                  var prev = ctx.dataset.data[idx - 1];
                  return v !== prev ? v : '';
                }
              }
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 16 } },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: '#f3f4f6' } }
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 14, boxHeight: 14, padding: 12, font: { size: 12 } }
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ctx.dataset.label + ': ' + ctx.parsed.y + '건';
                }
              }
            }
          }
        }
      });
    }

    // ===== 연도별 트렌드 막대 차트 =====
    function renderTrendChart(items, currentFilterYear) {
      var chart = document.getElementById('trend-chart');
      if (!chart) return;
      // 최근 6년
      var thisYear = new Date().getFullYear();
      var years = [];
      for (var y = thisYear - 5; y <= thisYear; y++) years.push(y);
      // 각 연도 과제 수 계산 (그 연도와 겹치는 과제)
      var counts = years.map(function (yr) {
        return items.filter(function (it) { return projectOverlapsYear(it, yr); }).length;
      });
      var maxCount = Math.max.apply(null, counts.concat([1]));
      var activeYear = currentFilterYear ? parseInt(currentFilterYear, 10) : null;

      chart.innerHTML = '';
      years.forEach(function (yr, idx) {
        var count = counts[idx];
        var heightPct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
        var heightPx = Math.max(4, Math.round((heightPct / 100) * 95)); // 최대 95px
        var isActive = activeYear === yr;
        var wrap = document.createElement('div');
        wrap.className = 'history-trend-bar-wrap' + (isActive ? ' is-active' : '');
        wrap.setAttribute('data-year', yr);
        wrap.innerHTML =
          '<div class="history-trend-bar-num">' + count + '</div>' +
          '<div class="history-trend-bar" style="height:' + heightPx + 'px"></div>' +
          '<div class="history-trend-bar-label">' + yr + '</div>';
        wrap.addEventListener('click', function () {
          var sel = document.getElementById('history-year-filter');
          if (sel) {
            // 같은 연도 다시 클릭 시 해제
            sel.value = isActive ? '' : String(yr);
            sel.dispatchEvent(new Event('change'));
          }
        });
        chart.appendChild(wrap);
      });
    }

    // ===== 입금 예정 지원금 카드 (연도 필터 시만) =====
    function renderFundingCard(items, filterYear) {
      var card = document.getElementById('stat-funding-card');
      if (!card) return;
      if (!filterYear) {
        card.style.display = 'none';
        return;
      }
      card.style.display = 'block';  // 명시적으로 표시 (inline style 우선순위)
      card.removeAttribute('hidden');
      // 그 연도 입금 예정 = yearBudgets 중 그 해 입금분 합
      var total = 0;
      items.forEach(function (it) {
        if (Array.isArray(it.yearBudgets)) {
          it.yearBudgets.forEach(function (yb) { total += supportInYear(yb, filterYear); });
        }
      });
      var labelEl = document.getElementById('stat-funding-label');
      if (labelEl) labelEl.textContent = filterYear + '년 입금 예정 지원금';
      var valueEl = document.getElementById('stat-funding-value');
      var unitEl = document.getElementById('stat-funding-unit');
      if (!valueEl) return;
      if (total >= 1e8) {
        valueEl.textContent = (total / 1e8).toFixed(1);
        if (unitEl) unitEl.textContent = '억';
      } else if (total >= 1e4) {
        valueEl.textContent = Math.round(total / 1e4).toLocaleString('ko-KR');
        if (unitEl) unitEl.textContent = '만';
      } else {
        valueEl.textContent = formatNum(total);
        if (unitEl) unitEl.textContent = '원';
      }
    }

    // ===== 통계 카드 계산 (예정/진행/종료) =====
    function renderSimpleStats(items, statsYear, filterYear) {
      var yearStr = String(statsYear);
      var asOf = null;  // 오늘 기준 (표와 일관성)
      var scheduled = 0, ongoing = 0, ended = 0;

      items.forEach(function (it) {
        var st = statusAsOf(it, asOf);
        var endYear = (it.endDate || it.end || '').toString().slice(0, 4);
        var sd = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
        var submitYear = sd ? sd.slice(0, 4) : '';

        if (st === '수행') {
          // 진행: 오늘 기준 수행 AND 그 해 겹침
          if (filterYear ? projectOverlapsYear(it, filterYear) : true) ongoing++;
        } else if (st === '종료') {
          // 종료: 종료일이 그 해 안 (연도 필터 시), 전체 모드는 모든 종료
          if (filterYear ? endYear === yearStr : true) ended++;
        } else if (st === '예정' || st === '대기') {
          // 예정: 제출일이 그 해 안 (연도 필터 시), 전체 모드는 모든 예정/대기
          if (filterYear ? submitYear === yearStr : true) scheduled++;
        }
      });

      setEl('stat-scheduled', scheduled);
      setEl('stat-ongoing', ongoing);
      setEl('stat-ended', ended);
      setEl('stat-history-total', scheduled + ongoing + ended);

      // 입금 예정 지원금 카드 (제거됐지만 element 없으면 무시)
      renderFundingCard(items, filterYear);
    }

    function applyFilterAndRender(items) {
      items = Array.isArray(items) ? items : [];
      latestItems = items;
      var filterYear = getFilterYear();
      var statsYear = getStatsYear();
      var cutoff = statsYear + '-01-01';

      // ===== 신규: 미선정/미제출/선정(기타) 제외 (전사 공개 페이지) =====
      items = items.filter(function (it) {
        var st = statusAsOf(it, null);
        return st !== '미선정' && st !== '미제출' && st !== '선정(기타)';
      });

      // ===== 신규: 탭별 분리 (R&D / 용역) =====
      // R&D 탭: 과제 + 지원사업만 (기타 제외)
      var rdGroup = items.filter(function (it) {
        var d = (it.division1 || it['구분1'] || '').toString();
        return d === '과제' || d === '지원사업';
      });
      // 용역 탭: 용역만
      var serviceGroup = items.filter(function (it) {
        return (it.division1 || it['구분1'] || '') === '용역';
      });

      // 탭 카운트 (연도 필터 무관, 전체 합)
      setEl('tab-count-rd', rdGroup.length);
      setEl('tab-count-service', serviceGroup.length);

      // 현재 탭의 items
      var tabItems = currentTab === 'service' ? serviceGroup : rdGroup;

      // R&D 토글 (R&D 활동 탭만)
      if (currentTab === 'rd' && rdOnly) {
        tabItems = tabItems.filter(function (it) {
          return !!(it.isRd || it.rd || it['R&D 여부']);
        });
      }

      // 연도별 트렌드 차트 — 제거됨 (사용자 요청)

      // 이후 모든 처리는 탭 적용된 items 기반
      items = tabItems;

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

      // 5단계: 검색 키워드 필터
      if (activeSearchQuery) {
        listItems = listItems.filter(function (it) {
          return projectMatchesSearch(it, activeSearchQuery);
        });
      }

      // 엑셀 내보내기를 위해 현재 보이는 아이템 보관
      lastFilteredItems = listItems;

      // 통계는 항상 연도 기준 전체 (모든 필터 무시 — 그래야 카드/pill 숫자가 의미를 가짐)
      updateStats(items, statsYear, filterYear);
      // "총 신규 제안" + 분류 pill 카운트 — B 기준 (제출일 = 그 연도)로 덮어쓰기
      setEl('stat-total', submitYearItems.length);
      Object.keys(divisionCounts).forEach(function (d) {
        var el = document.getElementById('stat-div-' + d);
        if (el) el.textContent = divisionCounts[d];
      });
      // 월별 신규 제안 차트 렌더
      renderMonthlyProposalChart(submitYearItems, filterYear);

      // 카드 가시성:
      //   - "수행" 통합 카드: 항상 표시
      //   - 그 안의 (계속/신규) sub-section: 특정 연도일 때만 표시
      var ongoingSub = document.getElementById('ongoing-sub');
      if (ongoingSub) {
        ongoingSub.style.display = filterYear ? '' : 'none';
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

      // ===== 신규: 시작일 최신순 정렬 (시작일 없는 건 뒤로) =====
      listItems.sort(function (a, b) {
        var sa = (a.startDate || a.start || '').toString().slice(0, 10);
        var sb = (b.startDate || b.start || '').toString().slice(0, 10);
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
        return sb.localeCompare(sa);
      });

      // ===== 신규: 통계 4개 카드 (예정/진행/완료/전체) + 입금 예정 지원금 =====
      // listItems가 아닌 tabItems(연도+탭만 적용된 풀) 기반으로 통계 계산
      renderSimpleStats(yearFiltered, statsYear, filterYear);

      renderTable(listItems, colVis, filterYear, currentTab);
      // 빈 상태 표시 토글
      var emptyEl = document.getElementById('history-empty');
      if (emptyEl) emptyEl.style.display = listItems.length === 0 ? 'block' : 'none';
      updateFilterSummary(listItems, activeCardFilter);

      if (filterHint) {
        var listLabel = filterYear ? filterYear + '년' : '전체';
        var statsLabel = filterYear ? filterYear + '년' : STAT_YEAR + '년';
        var hintText = '리스트: ' + listLabel + ' / 통계: ' + statsLabel + ' 기준';
        if (activeSearchQuery || activeCardFilter || activeStatusFilter || activeDivisionFilter) {
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
    var searchInput = document.getElementById('history-search');
    var searchClear = document.getElementById('history-search-clear');
    var searchWrap  = document.getElementById('history-search-wrap');
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

    // 엑셀 다운로드 버튼 — R&D 탭이면 컬럼 선택 모달, 용역 탭이면 바로 실행
    var exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (currentTab === 'rd') {
          openDownloadModal('excel');
        } else {
          // 용역 탭: 추가 컬럼 없음 → 바로 실행
          exportToExcel(lastFilteredItems, {});
        }
      });
    }

    // 클립보드 복사 버튼 — R&D 탭이면 컬럼 선택 모달, 용역 탭이면 바로 실행
    var copyBtn = document.getElementById('copy-clipboard-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (currentTab === 'rd') {
          openDownloadModal('copy');
        } else {
          copyToClipboard(lastFilteredItems, copyBtn, {});
        }
      });
    }

    // ===== 다운로드 컬럼 선택 모달 =====
    // R&D 탭에서만 사용. 모달 표시 → 사용자가 옵션 컬럼 선택 → "실행" 클릭 시 엑셀/복사 실행
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

    // ===== 탭 클릭 핸들러 (R&D 활동 / 용역) =====
    document.querySelectorAll('.history-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentTab = btn.getAttribute('data-tab') || 'rd';
        document.querySelectorAll('.history-tab').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        // R&D 토글 영역 표시/숨김 (R&D 탭일 때만 보임)
        var rdToggleWrap = document.getElementById('rd-toggle-wrap');
        if (rdToggleWrap) rdToggleWrap.style.display = currentTab === 'rd' ? 'inline-flex' : 'none';
        applyFilterAndRender(latestItems);
      });
    });

    // ===== R&D 토글 (NTIS만 보기) =====
    var rdToggleCb = document.getElementById('rd-only-toggle');
    if (rdToggleCb) {
      rdToggleCb.addEventListener('change', function () {
        rdOnly = rdToggleCb.checked;
        var wrap = document.getElementById('rd-toggle-wrap');
        if (wrap) wrap.classList.toggle('is-active', rdOnly);
        applyFilterAndRender(latestItems);
      });
    }

    if (svc && typeof svc.subscribeProjects === 'function') {
      svc.subscribeProjects(function (items) {
        applyFilterAndRender(items);
      });
    } else {
      applyFilterAndRender([]);
    }
  }

  // ===== 엑셀 내보내기 =====

  // ===== 화면에 보이는 컬럼 데이터 추출 (엑셀/클립보드 공용) =====
  // 현재 탭(R&D/용역)에 따라 컬럼 구성이 다르고, 옵션에서 켠 것까지 포함
  // override: { '책임자': true, ... } 형태로 옵션 컬럼 강제 지정 (모달에서 사용). 미지정 시 화면 옵션 사용.
  function getVisibleColumnsData(items, currentTab, override) {
    var isService = (currentTab === 'service');
    var rows = [];

    items.forEach(function (it, idx) {
      var no = idx + 1;
      var projectName = it.projectName || it['과제명'] || '';
      var institution = it.institution || it['기관명'] || '';
      // 화면 표시와 동일한 진행 여부 (자동 판정)
      var status = statusAsOf(it, null);
      var researchPeriod = getResearchPeriodDisplay(it, null);
      var code = it.code || it['코드'] || '';

      var row;

      if (isService) {
        // ===== 용역 탭 =====
        var totalVat = 0, supplySum = 0;
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb) {
            var t = Number(yb.totalIncludingVat || 0);
            var s = Number(yb.support || 0);
            if (!t && s) t = Math.round(s * 1.1);
            if (!s && t) s = Math.round(t / 1.1);
            totalVat += t;
            supplySum += s;
          });
        }
        row = {
          'No': no,
          '진행 여부': status,
          '용역명': projectName,
          '발주처': institution,
          '사업기간': researchPeriod,
          '사업비 총액': totalVat || '',
          '공급가': supplySum || '',
          '코드': code
        };
      } else {
        // ===== R&D 탭 =====
        var totalBudget = 0, govSum = 0;
        if (Array.isArray(it.yearBudgets) && it.yearBudgets.length > 0) {
          it.yearBudgets.forEach(function (yb) {
            var s = Number(yb.support || 0);
            var c = Number(yb.cash || 0);
            var k = Number(yb.inKind || 0);
            govSum += s;
            totalBudget += s + c + k;
          });
        }
        if (govSum === 0) govSum = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
        if (totalBudget === 0) totalBudget = govSum;

        row = {
          'No': no,
          '진행 여부': status,
          '과제명': projectName,
          '기관명': institution,
          '연구기간': researchPeriod,
          '지원금 총액': govSum || '',
          '사업비 총액': totalBudget || '',
          '코드': code
        };

        // 옵션 컬럼: override가 주어졌으면 그걸 사용, 아니면 화면에서 켠 것
        var colVis = (override && typeof override === 'object') ? override : getColVisibility();
        if (colVis['책임자']) row['책임자'] = it.manager || it['책임자'] || '';
        if (colVis['부처'])   row['부처']   = it.department || it['부처'] || '';
        if (colVis['사업명']) row['사업명'] = it.business || it['사업명'] || '';
        if (colVis['키워드']) row['키워드'] = it.keywords || it.keyword || it['키워드'] || '';
      }

      rows.push(row);
    });

    return rows;
  }

  // ===== 엑셀 다운로드 (화면에 보이는 컬럼만) =====
  // override: 모달에서 선택한 옵션 컬럼 {'책임자': true, ...}. 미지정 시 화면 옵션 사용.
  function exportToExcel(items, override) {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리(SheetJS)가 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
      return;
    }
    if (!items || items.length === 0) {
      alert('내보낼 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    var rows = getVisibleColumnsData(items, currentTabRef(), override);
    var ws = XLSX.utils.json_to_sheet(rows);

    // 컬럼별 너비 (헤더 이름 기준 매핑)
    var widthMap = {
      'No': 5, '진행 여부': 11,
      '과제명': 42, '용역명': 42,
      '기관명': 22, '발주처': 22,
      '연구기간': 24, '사업기간': 24,
      '지원금 총액': 16, '사업비 총액': 16, '공급가': 16,
      '코드': 12,
      '책임자': 10, '부처': 16, '사업명': 26, '키워드': 22
    };
    if (rows.length > 0) {
      var headers = Object.keys(rows[0]);
      ws['!cols'] = headers.map(function (h) { return { wch: widthMap[h] || 14 }; });

      // 숫자 포맷 (지원금/사업비/공급가)
      var range = XLSX.utils.decode_range(ws['!ref']);
      headers.forEach(function (h, colIdx) {
        if (h === '지원금 총액' || h === '사업비 총액' || h === '공급가') {
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
    var sheetName = (currentTabRef() === 'service') ? '용역 목록' : 'R&D 목록';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // 파일명: 수행현황_R&D_YYYY-MM-DD.xlsx
    var today = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var dateStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    var tabLabel = (currentTabRef() === 'service') ? '용역' : 'R&D';
    var filename = '수행현황_' + tabLabel + '_' + dateStr + '.xlsx';

    try {
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('엑셀 내보내기 실패:', err);
      alert('엑셀 내보내기에 실패했습니다. 다시 시도해 주세요.');
    }
  }

  // ===== 클립보드 복사 (화면에 보이는 컬럼만, 탭 구분 TSV) =====
  // 구글 시트/엑셀 빈 셀에 Ctrl+V 하면 그대로 표 형태로 붙여넣어짐
  // override: 모달에서 선택한 옵션 컬럼 {'책임자': true, ...}. 미지정 시 화면 옵션 사용.
  function copyToClipboard(items, btnEl, override) {
    if (!items || items.length === 0) {
      alert('복사할 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    var rows = getVisibleColumnsData(items, currentTabRef(), override);
    if (rows.length === 0) return;

    var headers = Object.keys(rows[0]);
    // TSV 형태로 직렬화 (탭 구분, 줄바꿈으로 행 분리)
    // 값 안에 탭/줄바꿈이 있으면 공백으로 치환
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

    // 클립보드 API (보안 컨텍스트 필요 — https 또는 localhost)
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
      // 구형 브라우저 폴백: textarea + execCommand
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

  // currentTab 변수에 접근하기 위한 헬퍼 (init 내부의 closure 변수)
  // init() 안에서 window.__currentTabRef 로 노출시킴
  function currentTabRef() {
    return (typeof window !== 'undefined' && window.__currentTabRef) ? window.__currentTabRef() : 'rd';
  }



  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
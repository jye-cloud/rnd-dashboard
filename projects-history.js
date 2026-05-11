/**
 * 과제 관리 페이지 - Firestore 실시간 연동
 */
(function () {
  'use strict';

  var CUTOFF = '2026-01-01';
  var STAT_YEAR = 2026;
  var COL_KEYS = ['부처', '예산', '과제명', '기관명', '연구기간', '지원금당해', '지원금총', '비고'];

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
  var COL_FIELDS = { '부처': 'department', '예산': 'budget', '과제명': 'projectName', '기관명': 'institution', '연구기간': 'researchPeriod', '지원금당해': 'supportYear', '지원금총': 'supportTotal', '비고': 'note' };

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
    var n = raw.replace(/\s/g, '');

    // asOfDate 기본값 — 오늘
    if (!asOfDate) {
      var today = new Date();
      asOfDate = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    }

    // "수행" + 종료일이 asOfDate 이전 → "종료"
    if (n === '수행중' || n === '수행') {
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

    setEl('stat-total', totalCount);
    setEl('stat-ongoing-all', ongoingAll);
    setEl('stat-continue', continueCnt);
    setEl('stat-new', newCnt);
    setEl('stat-ended', endedCnt);
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

  function renderTable(items, colVis, filterYear, onEdit) {
    var tbody = document.getElementById('projects-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    items.forEach(function (it, idx) {
      var id = it.id || it.docId || 'item-' + idx;
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);

      // 유형: division1 (과제/지원사업/용역/기타) — 입력값 그대로
      var typeText = (it.division1 || it['구분1'] || '').toString() || '-';

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

      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var cells = [
        '<td>' + escapeHtml(no) + '</td>',
        '<td>' + escapeHtml(typeText) + '</td>',
        '<td><span class="projects-badge ' + badgeClass + '">' + escapeHtml(statusDisplay) + '</span></td>',
        '<td>' + escapeHtml(submitDate || '-') + '</td>',
        '<td>' + getKeywordHtml(it) + '</td>',
        '<td>' + escapeHtml(it.manager || it.책임자 || '-') + '</td>',
        '<td>' + escapeHtml(start || '-') + '</td>',
        '<td>' + escapeHtml(end || '-') + '</td>'
      ];

      COL_KEYS.forEach(function (k) {
        var val;
        if (k === '연구기간') {
          val = getResearchPeriodDisplay(it, filterYear);
        } else if (k === '지원금당해') {
          // 당해 입금: 필터연도 있으면 그 해 입금분(calendarBreakdown 우선), 없으면 supportTotal
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
          val = num1 > 0 ? formatNum(num1) : (filterYear ? '0' : '-');
        } else if (k === '지원금총') {
          // 당해 수주: 필터연도 있으면 그 해 시작 yearBudget.support 합, 없으면 supportTotal
          var num2 = 0;
          if (filterYear) {
            if (Array.isArray(it.yearBudgets)) {
              it.yearBudgets.forEach(function (yb) {
                var ybs = (yb.startDate || '').toString().slice(0, 4);
                if (ybs === filterYear) num2 += Number(yb.support || 0);
              });
            }
          } else {
            num2 = Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0));
          }
          val = num2 > 0 ? formatNum(num2) : (filterYear ? '0' : '-');
        } else if (k === '예산') {
          // 숫자 컬럼 — 단순 필드 + 콤마
          var raw = getVal(it, k);
          var num3 = Number(raw);
          val = (raw && !isNaN(num3)) ? formatNum(num3) : (raw || '-');
        } else {
          val = getVal(it, k) || '-';
        }
        cells.push('<td class="col-opt" data-col="' + k + '">' + escapeHtml(val) + '</td>');
      });

      cells.push('<td style="text-align:center"><button type="button" class="ui-btn ui-btn--ghost project-edit-btn" data-id="' + escapeHtml(id) + '">수정</button></td>');
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
      var fields = [
        it.projectName, it['과제명'],
        it.manager, it['책임자'],
        it.department, it['부처'],
        it.business, it['사업명'],
        it.institution, it['기관명'],
        it.keywords, it.keyword, it['키워드'],
        it.no
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

    function applyFilterAndRender(items) {
      items = Array.isArray(items) ? items : [];
      latestItems = items;
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

      renderTable(listItems, colVis, filterYear, projectEditHandler);
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

    // 엑셀 다운로드 버튼
    var exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportToExcel(lastFilteredItems);
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

  function exportToExcel(items) {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리(SheetJS)가 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
      return;
    }
    if (!items || items.length === 0) {
      alert('내보낼 데이터가 없습니다. 검색어나 필터를 확인해 주세요.');
      return;
    }

    // 한글 헤더로 행 구성
    var rows = items.map(function (it, idx) {
      var no = (it.no != null && it.no !== '') ? String(it.no) : (idx + 1);
      var start = (it.startDate || it.start || '').toString().slice(0, 10);
      var end = (it.endDate || it.end || '').toString().slice(0, 10);
      var status = normalizeStatus(it);  // 자동 전환 적용
      var isRd = !!(it.isRd || it.rd || it['R&D 여부']);
      var submitDate = (it.submitDate || it['제출일'] || '').toString().slice(0, 10);
      var unsubReason = it.unsubmittedReason || it['미제출 사유'] || '';
      return {
        'No': no,
        '구분 1': it.division1 || it['구분1'] || '',
        '구분 2': it.division2 || it['구분2'] || '',
        '진행 여부': status,
        '제출일': submitDate,
        '미제출 사유': unsubReason,
        'R&D 여부': isRd ? 'Y' : 'N',
        '키워드': it.keywords || it.keyword || it['키워드'] || '',
        '과제명': it.projectName || it['과제명'] || '',
        '책임자': it.manager || it['책임자'] || '',
        '시작일': start,
        '종료일': end,
        '부처': it.department || it['부처'] || '',
        '사업명': it.business || it['사업명'] || '',
        '전문기관': it.institution || it['기관명'] || '',
        '지원금 (당해)': Number(it.supportYear || 0),
        '지원금 (총)': Number(it.supportTotal != null ? it.supportTotal : (it.budget || 0))
      };
    });

    var ws = XLSX.utils.json_to_sheet(rows);

    // 열 너비 지정 (헤더 순서와 일치)
    ws['!cols'] = [
      { wch: 5 },   // No
      { wch: 9 },   // 구분 1
      { wch: 7 },   // 구분 2
      { wch: 10 },  // 진행 여부
      { wch: 12 },  // 제출일
      { wch: 24 },  // 미제출 사유
      { wch: 9 },   // R&D 여부
      { wch: 22 },  // 키워드
      { wch: 42 },  // 과제명
      { wch: 10 },  // 책임자
      { wch: 12 },  // 시작일
      { wch: 12 },  // 종료일
      { wch: 16 },  // 부처
      { wch: 26 },  // 사업명
      { wch: 18 },  // 전문기관
      { wch: 16 },  // 지원금 (당해)
      { wch: 16 }   // 지원금 (총)
    ];

    // 지원금 열은 숫자 포맷 적용
    var range = XLSX.utils.decode_range(ws['!ref']);
    for (var R = range.s.r + 1; R <= range.e.r; R++) {
      // P열(16)과 Q열(17)이 지원금 (제출일/미제출 사유 컬럼이 추가되어 N,O에서 P,Q로 이동)
      ['P', 'Q'].forEach(function (col) {
        var cellRef = col + (R + 1);
        if (ws[cellRef]) {
          ws[cellRef].t = 'n';
          ws[cellRef].z = '#,##0';
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


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
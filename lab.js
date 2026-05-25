/**
 * lab.js
 * 기업부설연구소 인력 관리 페이지
 *
 * 데이터:
 *  - labRegistrations: 월별 등록 인력 (회사+월 단위)
 *  - persons: 인력 마스터 (학위·직급·전공 등 참조용)
 *
 * 탭 1: 월별 현황표 (학위별 인원 추이)
 * 탭 2: 월별 인력 명부 (특정 월 선택해서 보기)
 */

(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];          // 인력 마스터
  var _labRegs = [];          // 모든 회사 × 모든 월의 등록 기록
  var _selectedCompany = '식스티';
  var _selectedYear = new Date().getFullYear();  // 현황표에서 보고있는 연도
  var _selectedMonth = '';    // 명부에서 선택한 월

  // 학위 분류 (현황표의 세로축, 고정)
  var DEGREE_ROWS = ['박사', '석사', '학사', '전문학사', '기타', '기사'];

  var el = {
    company: null,
    yearSelect: null,
    excelUploadBtn: null,
    excelInput: null,
    resetBtn: null,
    // 업데이트 정보
    updateInfo: null,
    updateInfoText: null,
    // 현황표
    historyToggle: null,
    historyBody: null,
    historyTheadRow: null,
    historyTbody: null,
    historyEmpty: null,
    historyWrap: null,
    // 명부 (12개월 카드)
    listMonths: null,
    listEmpty: null,
    // 매칭 실패 모달
    mismatchModal: null,
    mismatchClose: null,
    mismatchCancel: null,
    mismatchList: null,
    // 업로드 확인 모달
    confirmModal: null,
    confirmClose: null,
    confirmCancel: null,
    confirmApply: null,
    confirmDesc: null,
    confirmReplaceWarning: null
  };

  // ====================================================================
  // 헬퍼
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

  /** "2024-01" → "2024.01" */
  function formatMonth(ym) {
    if (!ym) return '';
    return String(ym).replace('-', '.');
  }

  /** persons 중에서 ID로 찾기 */
  function findPersonById(id) {
    if (!id) return null;
    for (var i = 0; i < _persons.length; i++) {
      if (_persons[i] && _persons[i].id === id) return _persons[i];
    }
    return null;
  }

  /** 회사 한정 등록 기록을 월 오름차순으로 */
  function getCompanyRegs(company) {
    return _labRegs.filter(function (r) {
      return r && r.company === company;
    }).sort(function (a, b) {
      if (a.yearMonth < b.yearMonth) return -1;
      if (a.yearMonth > b.yearMonth) return 1;
      return 0;
    });
  }

  /** 어떤 person의 최종학위를 분류 ('박사'/'석사'/'학사'/'전문학사'/'기타'/'기사') */
  function classifyDegree(person) {
    if (!person) return '기타';
    var d = person.finalDegree;
    if (!d) return '기타';
    // 박사수료 → 박사, 석사수료 → 석사, 학사재학 → 학사 으로 묶음
    if (d.indexOf('박사') >= 0) return '박사';
    if (d.indexOf('석사') >= 0) return '석사';
    if (d === '전문학사' || d === '전문') return '전문학사';
    if (d.indexOf('학사') >= 0) return '학사';
    // 기사/산업기사는 모두 '기사'로 묶음
    if (d.indexOf('기사') >= 0) return '기사';
    return '기타';
  }

  // 마지막 업데이트 정보 박스
  function updateLastUpdateInfo() {
    if (!el.updateInfo || !el.updateInfoText) return;
    var regs = getCompanyRegs(_selectedCompany);
    if (regs.length === 0) {
      el.updateInfo.style.display = 'none';
      return;
    }
    // 가장 최근에 업데이트된 레코드
    var sortedByUpdate = regs.slice().sort(function (a, b) {
      var au = a.uploadedAt || '';
      var bu = b.uploadedAt || '';
      if (au > bu) return -1;
      if (au < bu) return 1;
      return 0;
    });
    var latest = sortedByUpdate[0];
    var when = latest.uploadedAt ? String(latest.uploadedAt).slice(0, 10) : '-';
    var who = latest.uploadedBy || '';
    var month = formatMonth(latest.yearMonth);
    var msg = '마지막 업데이트: ' + month + ' 명단 · ' + when;
    if (who) msg += ' (' + escapeHtml(who) + ')';
    el.updateInfoText.textContent = msg;
    el.updateInfo.style.display = '';
  }

  // ====================================================================
  // 연도 선택 드롭다운 갱신
  // (현재 데이터에 있는 연도 + 올해를 함께 옵션으로)
  // ====================================================================
  function refreshYearSelect() {
    if (!el.yearSelect) return;
    var current = String(_selectedYear);

    // 데이터에 등장한 연도들 수집
    var yearSet = {};
    _labRegs.forEach(function (r) {
      if (r && r.yearMonth) {
        var y = r.yearMonth.slice(0, 4);
        if (/^\d{4}$/.test(y)) yearSet[y] = true;
      }
    });

    // 올해는 항상 포함
    var thisYear = String(new Date().getFullYear());
    yearSet[thisYear] = true;

    var years = Object.keys(yearSet).sort(function (a, b) {
      return b.localeCompare(a);  // 최신 연도 위로
    });

    el.yearSelect.innerHTML = '';
    years.forEach(function (y) {
      var opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y + '년';
      el.yearSelect.appendChild(opt);
    });

    // 이전 선택 복원
    if (years.indexOf(current) >= 0) {
      el.yearSelect.value = current;
    } else {
      el.yearSelect.value = years[0];
      _selectedYear = parseInt(years[0], 10);
    }
  }

  // ====================================================================
  // 월별 현황표 (1~12월 고정, 직전월 승계)
  //
  // 로직:
  // - 헤더: 1월~12월 고정
  // - 회사+선택 연도의 등록 기록들을 월 순으로 정렬
  // - 각 학위 행:
  //     업로드 달 → 그 달 수치
  //     비업로드 달 → 직전(업로드된) 달의 수치 그대로
  //     선택 연도의 첫 업로드 달 이전 → "-"
  // - 변경승인일 행:
  //     업로드 달 → 날짜 표시 (없으면 '입력 필요')
  //     비업로드 달 → "—"
  // ====================================================================
  function renderHistoryTable() {
    if (!el.historyTheadRow || !el.historyTbody) return;

    var company = _selectedCompany;
    var year = _selectedYear;

    // 1~12월 헤더
    var headHtml = '<th style="width:90px;position:sticky;left:0;background:#fff;z-index:2">구분</th>';
    for (var m = 1; m <= 12; m++) {
      headHtml += '<th style="min-width:48px">' + m + '월</th>';
    }
    el.historyTheadRow.innerHTML = headHtml;

    // 회사 등록 기록 — 선택 연도까지의 전체를 알아야 함 (직전월 승계 위해)
    var allRegs = getCompanyRegs(company);  // 월 오름차순
    if (allRegs.length === 0) {
      if (el.historyWrap) el.historyWrap.style.display = 'none';
      if (el.historyEmpty) el.historyEmpty.style.display = 'block';
      el.historyTbody.innerHTML = '';
      return;
    }

    // 그 해에 데이터가 있는지 확인 (없으면 빈 상태로)
    // 직전 연도의 12월까지로도 채워질 수 있으니, 일단 표시는 함
    // 현황표를 보일지 여부 — 선택 연도 또는 그 이전에 업로드 된 적 있으면 표시
    var earliestYM = allRegs[0].yearMonth;
    var earliestYear = parseInt(earliestYM.slice(0, 4), 10);
    if (year < earliestYear) {
      // 선택한 연도가 첫 업로드 연도보다 이전 → 비어있음
      if (el.historyWrap) el.historyWrap.style.display = 'none';
      if (el.historyEmpty) el.historyEmpty.style.display = 'block';
      el.historyTbody.innerHTML = '';
      return;
    }

    if (el.historyWrap) el.historyWrap.style.display = '';
    if (el.historyEmpty) el.historyEmpty.style.display = 'none';

    // 각 월에 대해 — "이 월에 적용되는 등록 기록"을 찾아야 함
    // 정확히 그 월에 업로드된 게 있으면 그것
    // 없으면 그보다 이른 가장 최근 등록
    function getApplicableReg(yearNum, monthNum) {
      var targetYM = yearNum + '-' + String(monthNum).padStart(2, '0');
      var applicable = null;
      for (var i = 0; i < allRegs.length; i++) {
        if (allRegs[i].yearMonth <= targetYM) {
          applicable = allRegs[i];
        } else {
          break;
        }
      }
      return applicable;
    }

    function isUploadMonth(yearNum, monthNum) {
      var targetYM = yearNum + '-' + String(monthNum).padStart(2, '0');
      return allRegs.some(function (r) { return r.yearMonth === targetYM; });
    }

    function getUploadReg(yearNum, monthNum) {
      var targetYM = yearNum + '-' + String(monthNum).padStart(2, '0');
      for (var i = 0; i < allRegs.length; i++) {
        if (allRegs[i].yearMonth === targetYM) return allRegs[i];
      }
      return null;
    }

    // 각 학위별 행 생성
    var bodyHtml = '';
    DEGREE_ROWS.forEach(function (deg) {
      bodyHtml += '<tr>';
      bodyHtml += '<td class="lab-history-label">' + escapeHtml(deg) + '</td>';
      for (var m = 1; m <= 12; m++) {
        var reg = getApplicableReg(year, m);
        if (!reg) {
          bodyHtml += '<td style="color:#cbd5e1">-</td>';
          continue;
        }
        var count = 0;
        if (Array.isArray(reg.members)) {
          reg.members.forEach(function (mem) {
            var p = findPersonById(mem.personId);
            if (classifyDegree(p) === deg) count++;
          });
        }
        // 업로드 달이면 진하게, 승계 달이면 흐리게
        var isUpload = isUploadMonth(year, m);
        var cellStyle = isUpload ? '' : 'color:#94a3b8';
        bodyHtml += '<td style="' + cellStyle + '">' + (count > 0 ? count : '-') + '</td>';
      }
      bodyHtml += '</tr>';
    });

    // 총 인원 행
    bodyHtml += '<tr class="lab-history-total">';
    bodyHtml += '<td class="lab-history-label">총 인원</td>';
    for (var mm = 1; mm <= 12; mm++) {
      var rreg = getApplicableReg(year, mm);
      if (!rreg) {
        bodyHtml += '<td style="color:#cbd5e1">-</td>';
        continue;
      }
      var total = Array.isArray(rreg.members) ? rreg.members.length : 0;
      var isUp = isUploadMonth(year, mm);
      var cs = isUp ? '' : 'color:#94a3b8';
      bodyHtml += '<td style="' + cs + '">' + total + '</td>';
    }
    bodyHtml += '</tr>';

    // 변경승인일 행
    bodyHtml += '<tr style="background:#fafbfc">';
    bodyHtml += '<td class="lab-history-label" style="background:#fafbfc;font-size:0.78rem;color:var(--text-secondary)">변경승인일</td>';
    for (var mm2 = 1; mm2 <= 12; mm2++) {
      var ureg = getUploadReg(year, mm2);
      // 그 회사의 첫 업로드 이전 달 → "-" (적용 불가)
      var applicable2 = getApplicableReg(year, mm2);
      if (!applicable2) {
        bodyHtml += '<td style="font-size:0.75rem;color:#cbd5e1">-</td>';
        continue;
      }
      if (ureg) {
        // 업로드 달 — 변경승인일 표시
        var approvalDate = ureg.approvalDate || '';
        if (approvalDate) {
          var dateOnly = approvalDate.slice(0, 10);
          var parts = dateOnly.split('-');
          var shortDate = parts.length >= 3 ? (parts[1] + '.' + parts[2]) : dateOnly;
          bodyHtml += '<td style="font-size:0.75rem;color:var(--text-primary);font-weight:600" title="' + escapeHtml(dateOnly) + '">' + escapeHtml(shortDate) + '</td>';
        } else {
          bodyHtml += '<td style="font-size:0.72rem;color:#f59e0b" title="변경승인일 미입력">입력 필요</td>';
        }
      } else {
        // 비업로드 달 (직전월 데이터 승계 중) — 옅은 빨강 "변경신고 없음"
        bodyHtml += '<td style="font-size:0.72rem;color:#fca5a5;font-style:italic" title="이 월에는 변경 신고가 없었어요. 직전 데이터 사용 중.">변경신고 없음</td>';
      }
    }
    bodyHtml += '</tr>';

    el.historyTbody.innerHTML = bodyHtml;
  }

  // ====================================================================
  // 월별 인력 명부 — 1~12월 카드 형태로 모두 표시
  // 각 카드를 클릭하면 펼침/접힘
  // ====================================================================
  function renderListTable() {
    if (!el.listMonths) return;

    var year = _selectedYear;
    var company = _selectedCompany;
    var allRegs = getCompanyRegs(company);

    if (allRegs.length === 0) {
      el.listMonths.innerHTML = '';
      if (el.listEmpty) el.listEmpty.style.display = 'block';
      return;
    }

    // 선택 연도가 첫 업로드 연도보다 이전 → 빈 상태
    var earliestYM = allRegs[0].yearMonth;
    var earliestYear = parseInt(earliestYM.slice(0, 4), 10);
    if (year < earliestYear) {
      el.listMonths.innerHTML = '';
      if (el.listEmpty) el.listEmpty.style.display = 'block';
      return;
    }
    if (el.listEmpty) el.listEmpty.style.display = 'none';

    // 적용 가능한 등록 찾기 (현황표 로직과 동일)
    function getApplicableRegLocal(monthNum) {
      var targetYM = year + '-' + String(monthNum).padStart(2, '0');
      var applicable = null;
      for (var i = 0; i < allRegs.length; i++) {
        if (allRegs[i].yearMonth <= targetYM) applicable = allRegs[i];
        else break;
      }
      return applicable;
    }
    function isUploadMonthLocal(monthNum) {
      var targetYM = year + '-' + String(monthNum).padStart(2, '0');
      return allRegs.some(function (r) { return r.yearMonth === targetYM; });
    }

    // 오늘 기준 연/월 — 선택 연도가 올해이면 해당 월을 자동 펼침
    var todayDate = new Date();
    var todayYM = todayDate.getFullYear() + '-' + String(todayDate.getMonth() + 1).padStart(2, '0');

    var html = '';
    for (var m = 1; m <= 12; m++) {
      var applicable = getApplicableRegLocal(m);
      var isUpload = isUploadMonthLocal(m);
      var monthLabel = m + '월';
      var ym = year + '-' + String(m).padStart(2, '0');
      var isToday = (ym === todayYM);

      var infoHtml = '';
      var badgeHtml = '';
      var bodyHtml = '';

      if (!applicable) {
        // 데이터 없음
        badgeHtml = '<span class="lab-month-card-badge lab-month-card-badge--empty">데이터 없음</span>';
        infoHtml = '';
        bodyHtml = '<div class="lab-month-card-empty">이 회사의 첫 업로드 이전 달입니다.</div>';
      } else if (isUpload) {
        // 업로드 달
        var approvalDate = applicable.approvalDate ? applicable.approvalDate.slice(0, 10) : '';
        badgeHtml = '<span class="lab-month-card-badge lab-month-card-badge--upload">✓ 업로드</span>';
        infoHtml = applicable.members.length + '명'
          + (approvalDate ? ' · 변경승인일 ' + escapeHtml(approvalDate) : '');
        bodyHtml = renderMonthMemberGrid(applicable.members, ym);
      } else {
        // 변경 없음 (직전월 승계)
        badgeHtml = '<span class="lab-month-card-badge lab-month-card-badge--no-change">변경신고 없음</span>';
        infoHtml = applicable.members.length + '명 · 직전(' + escapeHtml(formatMonth(applicable.yearMonth)) + ') 명단 그대로';
        bodyHtml = renderMonthMemberGrid(applicable.members, ym);
      }

      // 카드 펼침 규칙:
      //  - 데이터 있는 달 + (업로드 달 OR 오늘 월) → 펼침
      //  - 그 외 → 접힘
      var expanded = (applicable && (isUpload || isToday)) ? 'true' : 'false';

      // 오늘 월 카드는 살짝 강조 (테두리 색)
      var cardExtraClass = isToday ? ' lab-month-card--today' : '';

      html += ''
        + '<div class="lab-month-card' + cardExtraClass + '" data-month="' + ym + '" data-expanded="' + expanded + '">'
        +   '<button type="button" class="lab-month-card-header" aria-expanded="' + expanded + '" data-action="toggle-month">'
        +     '<span class="lab-month-card-icon">▶</span>'
        +     '<span class="lab-month-card-title">' + monthLabel + (isToday ? ' <span style="color:#2563eb;font-size:0.7rem;font-weight:500">(이번 달)</span>' : '') + '</span>'
        +     '<span class="lab-month-card-info">' + escapeHtml(infoHtml) + '</span>'
        +     badgeHtml
        +   '</button>'
        +   '<div class="lab-month-card-body">' + bodyHtml + '</div>'
        + '</div>';
    }

    el.listMonths.innerHTML = html;
  }

  /**
   * 월 카드 안의 인력 이름 그리드
   * @param {Array} members - 등록된 인력 목록
   * @param {string} ym - 이 카드가 표시하는 기준 월 (YYYY-MM)
   *                     이 월이 인력 마스터의 퇴사일+1개월 이후면 "퇴사자(누락)" 표시
   */
  function renderMonthMemberGrid(members, ym) {
    if (!members || members.length === 0) {
      return '<div class="lab-month-card-empty">등록된 인력이 없습니다.</div>';
    }

    // 퇴사 판정: 인력 마스터의 exitDate 가 이 카드 월의 직전 달이거나 그 이전이면 "이미 퇴사"
    // 예: exitDate = 2025-05-10 → 6월부터 퇴사자로 표시
    //     exitDate = 2025-05-31 → 6월부터 퇴사자로 표시
    //     ym 형식 = "2025-06"
    function isExitedBefore(person, ym) {
      if (!person || !person.exitDate) return false;
      var exitYM = String(person.exitDate).slice(0, 7);  // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(exitYM)) return false;
      // exitYM < ym 이면 "이미 퇴사" (퇴사 다음 달부터 표시)
      return exitYM < ym;
    }

    var sorted = members.slice().sort(function (a, b) {
      var na = (a && a.name) || '';
      var nb = (b && b.name) || '';
      return na.localeCompare(nb, 'ko');
    });

    // 퇴사 처리된 사람 먼저 카운트
    var exitedCount = 0;
    sorted.forEach(function (m) {
      var p = findPersonById(m.personId);
      if (isExitedBefore(p, ym)) exitedCount++;
    });

    var html = '';

    // 퇴사자가 있으면 카드 본문 상단에 안내
    if (exitedCount > 0) {
      html += '<div style="font-size:0.75rem;color:#dc2626;background:#fef2f2;padding:0.35rem 0.5rem;border-radius:0.35rem;margin-bottom:0.4rem">'
            + '⚠️ ' + exitedCount + '명이 이미 퇴사 처리되었지만 명부에 남아있어요. 다음 업로드 시 빠질 예정인지 확인해 주세요.'
            + '</div>';
    }

    html += '<div class="lab-month-name-grid">';
    sorted.forEach(function (m) {
      var p = findPersonById(m.personId);
      var name = (m.name || (p && p.name) || '-');
      var exited = isExitedBefore(p, ym);
      if (exited) {
        var exitYM = p.exitDate.slice(0, 7);
        html += '<div class="lab-month-name-item lab-month-name-item--exited" '
              + 'title="' + escapeHtml(name) + ' — 퇴사일: ' + escapeHtml(p.exitDate.slice(0, 10)) + ' (이 월 이전에 퇴사)">'
              + escapeHtml(name) + '</div>';
      } else {
        html += '<div class="lab-month-name-item">' + escapeHtml(name) + '</div>';
      }
    });
    html += '</div>';
    return html;
  }

  /**
   * 월 카드 클릭 — 접기/펴기
   */
  function onMonthCardClick(e) {
    var btn = e.target.closest && e.target.closest('[data-action="toggle-month"]');
    if (!btn) return;
    var card = btn.closest('.lab-month-card');
    if (!card) return;
    var current = card.getAttribute('data-expanded') === 'true';
    var next = !current;
    card.setAttribute('data-expanded', next ? 'true' : 'false');
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
  }

  // ====================================================================
  // 전체 렌더링
  // ====================================================================
  function render() {
    updateLastUpdateInfo();
    refreshYearSelect();
    renderHistoryTable();
    renderListTable();
  }

  // ====================================================================
  // 이벤트 핸들러
  // ====================================================================
  function onCompanyChange() {
    _selectedCompany = el.company.value || '식스티';
    render();
  }

  function onYearChange() {
    _selectedYear = parseInt(el.yearSelect.value, 10) || new Date().getFullYear();
    render();
  }

  /**
   * 현황표 토글 (접기/펴기)
   */
  function onHistoryToggle() {
    if (!el.historyToggle || !el.historyBody) return;
    var current = el.historyToggle.getAttribute('aria-expanded') === 'true';
    var next = !current;
    el.historyToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    el.historyBody.style.display = next ? '' : 'none';
  }

  // ====================================================================
  // 전체 삭제 (테스트용)
  //
  // 현재 선택된 회사의 모든 월 등록 데이터를 삭제.
  // 두 번 확인받음:
  //  1) "정말 삭제하시겠어요?" (confirm)
  //  2) 회사명 입력 (정확히 일치해야 진행)
  // ====================================================================
  function onResetClick() {
    var company = _selectedCompany;
    if (!company) return;

    var companyRegs = getCompanyRegs(company);
    if (companyRegs.length === 0) {
      alert(company + ' 회사에 등록된 연구소 데이터가 없어요.');
      return;
    }

    var totalMonths = companyRegs.length;
    var msg = '⚠️ 정말 삭제할까요?\n\n'
      + company + ' 회사의 연구소 등록 데이터를\n'
      + '모두 (' + totalMonths + '개월치) 삭제합니다.\n\n'
      + '※ 이 작업은 되돌릴 수 없어요.';

    if (!confirm(msg)) return;

    // 확실하게 한 번 더 — 회사명 직접 입력
    var typed = window.prompt(
      '확인을 위해 회사명을 정확히 입력해 주세요:\n(예: ' + company + ')',
      ''
    );
    if (!typed || typed.trim() !== company) {
      alert('회사명이 일치하지 않아요. 삭제를 취소했습니다.');
      return;
    }

    var svc = window.firestoreService;
    if (!svc || typeof svc.saveLabRegistrations !== 'function') {
      alert('firestoreService 가 없어요.');
      return;
    }

    // 그 회사 외의 데이터만 남김
    var remaining = _labRegs.filter(function (r) {
      return r && r.company !== company;
    });

    if (el.resetBtn) {
      el.resetBtn.disabled = true;
      el.resetBtn.textContent = '🗑️ 삭제 중…';
    }

    svc.saveLabRegistrations(remaining).then(function () {
      alert('✅ ' + company + '의 연구소 등록 데이터 ' + totalMonths + '개월치를 모두 삭제했어요.');
      if (el.resetBtn) {
        el.resetBtn.disabled = false;
        el.resetBtn.innerHTML = '🗑️ 전체 삭제';
      }
      // 구독이 자동으로 _labRegs를 업데이트하고 render() 호출함
    }).catch(function (err) {
      console.error('연구소 데이터 삭제 실패:', err);
      alert('삭제에 실패했어요.\n' + (err && err.message ? err.message : ''));
      if (el.resetBtn) {
        el.resetBtn.disabled = false;
        el.resetBtn.innerHTML = '🗑️ 전체 삭제';
      }
    });
  }

  // ====================================================================
  // 엑셀 업로드 로직 (KOITA 양식)
  // ====================================================================

  /**
   * 업로드 단계 상태 (확인 모달에서 적용 누르면 실제 저장)
   */
  var _pendingUpload = null;
  // 구조:
  // {
  //   yearMonth: '2025-04',
  //   members: [{ personId, name, ssn6, assignedDate }, ...],
  //   replaceExisting: true/false
  // }

  /**
   * 클릭 → 파일 선택창 열기
   */
  function onExcelUploadClick() {
    if (!el.excelInput) return;
    el.excelInput.value = '';  // 같은 파일 다시 선택 가능하도록
    el.excelInput.click();
  }

  /**
   * 파일 선택됨 → 파싱 시작
   */
  function onExcelFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      alert('엑셀 처리 라이브러리(SheetJS)가 로드되지 않았어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }

    parseExcelFile(file).then(function (rows) {
      handleParsedRows(rows, file.name);
    }).catch(function (err) {
      console.error('엑셀 파싱 실패:', err);
      alert('엑셀 파일을 읽지 못했어요.\n' + (err && err.message ? err.message : ''));
    });
  }

  /**
   * 엑셀 파일을 파싱해서 행 배열로 반환
   */
  function parseExcelFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = new Uint8Array(ev.target.result);
          var wb = XLSX.read(data, { type: 'array', cellDates: true });
          var firstSheetName = wb.SheetNames[0];
          if (!firstSheetName) {
            reject(new Error('시트가 없어요'));
            return;
          }
          var sheet = wb.Sheets[firstSheetName];
          // 헤더를 포함해 raw 데이터로 (행: 배열의 배열)
          var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('파일 읽기 실패')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * KOITA 양식에서 헤더 행을 찾고 우리가 필요한 컬럼 인덱스 식별
   * 필요 컬럼: 성명, 주민등록번호, 연구소 발령일
   */
  function findColumnIndexes(rows) {
    // 헤더 행: 보통 1행 (인덱스 0)이지만 여러 행 위쪽에 안내가 있을 수 있어서 처음 10행 정도 탐색
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var row = rows[i];
      if (!Array.isArray(row)) continue;

      var nameIdx = -1, ssnIdx = -1, dateIdx = -1;
      for (var j = 0; j < row.length; j++) {
        var cell = String(row[j] || '').trim();
        // 헤더 키워드 매칭 (공백 무시)
        var noSpace = cell.replace(/\s+/g, '');
        if (nameIdx < 0 && (noSpace === '성명' || noSpace === '이름')) nameIdx = j;
        if (ssnIdx < 0 && (noSpace.indexOf('주민등록번호') >= 0 || noSpace.indexOf('주민번호') >= 0)) ssnIdx = j;
        if (dateIdx < 0 && (noSpace.indexOf('연구소발령일') >= 0 || noSpace.indexOf('발령일') >= 0)) dateIdx = j;
      }

      if (nameIdx >= 0 && ssnIdx >= 0 && dateIdx >= 0) {
        return { headerRow: i, name: nameIdx, ssn: ssnIdx, date: dateIdx };
      }
    }
    return null;
  }

  /**
   * 주민번호에서 앞 6자리 추출 (구분자 무시)
   */
  function extractSsn6(ssnRaw) {
    if (!ssnRaw) return '';
    var s = String(ssnRaw).replace(/[^0-9]/g, '');
    if (s.length < 6) return '';
    return s.slice(0, 6);
  }

  /**
   * 주민번호 앞 6자리(YYMMDD) → ISO 생년월일 (YYYY-MM-DD)로 변환
   * 인력 마스터의 birthDate와 비교용
   */
  function ssn6ToBirthIso(ssn6) {
    if (!ssn6 || ssn6.length !== 6) return null;
    var yy = parseInt(ssn6.slice(0, 2), 10);
    var mm = ssn6.slice(2, 4);
    var dd = ssn6.slice(4, 6);
    if (isNaN(yy)) return null;
    // 60 이상 → 1900년대, 미만 → 2000년대 (한국 주민번호 관행)
    var year = yy >= 60 ? 1900 + yy : 2000 + yy;
    return year + '-' + mm + '-' + dd;
  }

  /**
   * 엑셀 날짜 셀 → ISO YYYY-MM-DD 문자열
   * XLSX는 cellDates: true 일 때 Date 객체를 주거나, raw: false일 땐 'YYYY-MM-DD' 같은 문자열을 줌
   */
  function normalizeDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) {
      var y = value.getFullYear();
      var m = String(value.getMonth() + 1).padStart(2, '0');
      var d = String(value.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
    var str = String(value).trim();
    if (!str) return null;
    // "2024-01-15", "2024.01.15", "2024/01/15", "2024 01 15" 등 처리
    var m2 = str.match(/(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/);
    if (m2) {
      return m2[1] + '-' + String(m2[2]).padStart(2, '0') + '-' + String(m2[3]).padStart(2, '0');
    }
    return null;
  }

  /**
   * 인력 마스터에서 매칭 (이름 + 주민번호 앞 6자리)
   * @returns 매칭된 person 또는 null
   */
  function matchPerson(name, ssn6) {
    if (!name || !ssn6) return null;
    var trimmedName = String(name).trim();
    var birthIso = ssn6ToBirthIso(ssn6);
    if (!birthIso) return null;

    for (var i = 0; i < _persons.length; i++) {
      var p = _persons[i];
      if (!p) continue;
      // 이름 일치
      if (String(p.name || '').trim() !== trimmedName) continue;
      // 생년월일(birthDate) 일치 비교
      if (String(p.birthDate || '').slice(0, 10) === birthIso) {
        return p;
      }
    }
    return null;
  }

  /**
   * 파싱된 행을 처리: 매칭 + 매칭 실패 처리 + 확인 모달
   */
  function handleParsedRows(rows, filename) {
    if (!rows || rows.length === 0) {
      alert('엑셀이 비어있어요.');
      return;
    }

    var cols = findColumnIndexes(rows);
    if (!cols) {
      alert('엑셀에서 필요한 컬럼을 찾지 못했어요.\n\n다음 컬럼이 모두 있는지 확인해 주세요:\n· 성명\n· 주민등록번호\n· 연구소 발령일');
      return;
    }

    // 헤더 다음 행부터 데이터 행
    var dataRows = rows.slice(cols.headerRow + 1);

    // 행 파싱
    var parsed = [];
    var emptyRows = 0;
    for (var i = 0; i < dataRows.length; i++) {
      var row = dataRows[i];
      if (!Array.isArray(row)) continue;
      var name = String(row[cols.name] || '').trim();
      var ssnRaw = row[cols.ssn];
      var dateRaw = row[cols.date];

      if (!name && !ssnRaw) {
        emptyRows++;
        continue;
      }
      if (!name) continue;  // 이름 없으면 무시

      var ssn6 = extractSsn6(ssnRaw);
      var assignedDate = normalizeDate(dateRaw);

      parsed.push({
        rowIndex: cols.headerRow + 1 + i + 1,  // 사람이 보는 행 번호 (1-based, 헤더 포함)
        name: name,
        ssn6: ssn6,
        assignedDate: assignedDate
      });
    }

    if (parsed.length === 0) {
      alert('유효한 인력 데이터가 없어요. 엑셀 내용을 확인해 주세요.');
      return;
    }

    // 매칭 시도
    var matched = [];
    var unmatched = [];
    parsed.forEach(function (row) {
      var p = matchPerson(row.name, row.ssn6);
      if (p) {
        matched.push({
          personId: p.id,
          name: p.name,
          ssn6: row.ssn6,
          assignedDate: row.assignedDate
        });
      } else {
        unmatched.push(row);
      }
    });

    // 매칭 실패가 하나라도 있으면 → 안내 모달, 업로드 중단
    if (unmatched.length > 0) {
      showMismatchModal(unmatched);
      return;
    }

    // 모두 매칭됨 → 변경승인일 입력 (이 날짜에서 월이 자동 결정)
    var promptedApproval = window.prompt(
      '변경승인일을 입력해 주세요.\n(KOITA에 신고한 날짜)\n\n숫자 8자리로 입력 (예: 20250415 → 2025-04-15)\n\n이 날짜의 월로 등록됩니다.',
      ''
    );
    if (!promptedApproval) return;
    // 숫자만 추출 (사용자가 - 같은 구분자를 넣어도 OK)
    var digitsOnly = String(promptedApproval).replace(/[^0-9]/g, '');
    if (digitsOnly.length !== 8) {
      alert('숫자 8자리로 입력해 주세요. (예: 20250415)');
      return;
    }
    var y = digitsOnly.slice(0, 4);
    var mo = digitsOnly.slice(4, 6);
    var d = digitsOnly.slice(6, 8);
    // 유효성 간단 체크
    var moNum = parseInt(mo, 10);
    var dNum = parseInt(d, 10);
    if (moNum < 1 || moNum > 12 || dNum < 1 || dNum > 31) {
      alert('날짜가 올바르지 않아요. (월: 01-12, 일: 01-31)\n입력한 값: ' + y + '-' + mo + '-' + d);
      return;
    }
    var approvalDate = y + '-' + mo + '-' + d;
    var yearMonth = approvalDate.slice(0, 7);  // YYYY-MM

    // 이미 같은 회사+월 등록되어 있는지 확인
    var existing = _labRegs.find(function (r) {
      return r && r.company === _selectedCompany && r.yearMonth === yearMonth;
    });

    _pendingUpload = {
      yearMonth: yearMonth,
      members: matched,
      approvalDate: approvalDate,
      replaceExisting: !!existing
    };

    showConfirmModal(matched.length, yearMonth, approvalDate, !!existing);
  }

  /**
   * 등록할 월을 추출 — 더 이상 사용 안 함 (변경승인일로 결정)
   */
  function inferYearMonth(matched) {
    // 일단 추출하지 않고 사용자에게 입력받도록 null 반환
    // (자동 추출은 정확도 떨어질 수 있어 명시적 입력이 안전)
    return null;
  }

  /**
   * 매칭 실패 모달 표시
   */
  function showMismatchModal(unmatched) {
    if (!el.mismatchModal || !el.mismatchList) return;

    var html = '';
    unmatched.forEach(function (u) {
      var birthIso = ssn6ToBirthIso(u.ssn6) || '(주민번호 없음)';
      html += ''
        + '<div class="lab-mismatch-item">'
        +   '<span class="lab-mismatch-item-name">' + escapeHtml(u.name) + '</span>'
        +   '<span class="lab-mismatch-item-sub">' + escapeHtml(birthIso) + '</span>'
        + '</div>';
    });
    el.mismatchList.innerHTML = html;
    el.mismatchModal.hidden = false;
  }

  function closeMismatchModal() {
    if (el.mismatchModal) el.mismatchModal.hidden = true;
  }

  /**
   * 업로드 확인 모달 표시
   */
  function showConfirmModal(memberCount, yearMonth, approvalDate, isReplace) {
    if (!el.confirmModal) return;

    if (el.confirmDesc) {
      el.confirmDesc.innerHTML = ''
        + '<strong>' + escapeHtml(_selectedCompany) + '</strong>의 '
        + '<strong>' + escapeHtml(formatMonth(yearMonth)) + '</strong> 연구소 인력으로 '
        + '<strong>' + memberCount + '명</strong>을 등록할게요.'
        + '<br><span style="font-size:0.85rem;color:var(--text-secondary)">변경승인일: ' + escapeHtml(approvalDate || '-') + '</span>';
    }
    if (el.confirmReplaceWarning) {
      el.confirmReplaceWarning.hidden = !isReplace;
    }
    el.confirmModal.hidden = false;
  }

  function closeConfirmModal() {
    if (el.confirmModal) el.confirmModal.hidden = true;
    _pendingUpload = null;
  }

  /**
   * "업로드 적용" 클릭 → 실제 저장
   */
  function onConfirmApply() {
    if (!_pendingUpload) {
      closeConfirmModal();
      return;
    }

    var svc = window.firestoreService;
    if (!svc || typeof svc.upsertLabRegistration !== 'function') {
      alert('firestoreService.upsertLabRegistration 가 없어요. firestore-service.js를 최신본으로 업데이트해 주세요.');
      return;
    }

    var uploadedBy = '';
    try {
      // 로그인 사용자 이메일 시도
      if (window.firebase && window.firebase.auth) {
        var user = window.firebase.auth().currentUrl
          ? null
          : window.firebase.auth().currentUser;
        if (user && user.email) uploadedBy = user.email;
      }
    } catch (e) { /* 무시 */ }

    // 버튼 상태 변경
    if (el.confirmApply) {
      el.confirmApply.disabled = true;
      el.confirmApply.textContent = '저장 중…';
    }

    svc.upsertLabRegistration({
      company: _selectedCompany,
      yearMonth: _pendingUpload.yearMonth,
      members: _pendingUpload.members,
      approvalDate: _pendingUpload.approvalDate || '',
      uploadedBy: uploadedBy
    }).then(function () {
      // 업로드 직후 해당 연도/월로 자동 이동
      _selectedYear = parseInt(_pendingUpload.yearMonth.slice(0, 4), 10);
      _selectedMonth = _pendingUpload.yearMonth;
      closeConfirmModal();
      if (el.confirmApply) {
        el.confirmApply.disabled = false;
        el.confirmApply.textContent = '업로드 적용';
      }
      // Firestore 구독이 자동으로 _labRegs 업데이트 → render() 호출됨
    }).catch(function (err) {
      console.error('연구소 인력 등록 실패:', err);
      alert('저장에 실패했어요.\n' + (err && err.message ? err.message : ''));
      if (el.confirmApply) {
        el.confirmApply.disabled = false;
        el.confirmApply.textContent = '업로드 적용';
      }
    });
  }

  function onMismatchOverlayClick(e) {
    if (e.target === el.mismatchModal) closeMismatchModal();
  }
  function onConfirmOverlayClick(e) {
    if (e.target === el.confirmModal) closeConfirmModal();
  }

  function bindEvents() {
    if (el.company)         el.company.addEventListener('change', onCompanyChange);
    if (el.yearSelect)      el.yearSelect.addEventListener('change', onYearChange);
    if (el.excelUploadBtn)  el.excelUploadBtn.addEventListener('click', onExcelUploadClick);
    if (el.excelInput)      el.excelInput.addEventListener('change', onExcelFileChange);
    if (el.resetBtn)        el.resetBtn.addEventListener('click', onResetClick);

    // 현황표 토글
    if (el.historyToggle)   el.historyToggle.addEventListener('click', onHistoryToggle);

    // 월 카드 클릭 (이벤트 위임)
    if (el.listMonths)      el.listMonths.addEventListener('click', onMonthCardClick);

    // 매칭 실패 모달
    if (el.mismatchClose)  el.mismatchClose.addEventListener('click', closeMismatchModal);
    if (el.mismatchCancel) el.mismatchCancel.addEventListener('click', closeMismatchModal);
    if (el.mismatchModal)  el.mismatchModal.addEventListener('click', onMismatchOverlayClick);

    // 업로드 확인 모달
    if (el.confirmClose)  el.confirmClose.addEventListener('click', closeConfirmModal);
    if (el.confirmCancel) el.confirmCancel.addEventListener('click', closeConfirmModal);
    if (el.confirmApply)  el.confirmApply.addEventListener('click', onConfirmApply);
    if (el.confirmModal)  el.confirmModal.addEventListener('click', onConfirmOverlayClick);
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    // DOM 캐시
    el.company         = $('lab-company');
    el.yearSelect      = $('lab-year-select');
    el.excelUploadBtn  = $('lab-excel-upload-btn');
    el.excelInput      = $('lab-excel-input');
    el.resetBtn        = $('lab-reset-btn');

    el.updateInfo      = $('lab-update-info');
    el.updateInfoText  = $('lab-update-info-text');

    el.historyToggle   = $('lab-history-toggle');
    el.historyBody     = $('lab-history-body');
    el.historyTheadRow = $('lab-history-thead-row');
    el.historyTbody    = $('lab-history-tbody');
    el.historyEmpty    = $('lab-history-empty');
    el.historyWrap     = $('lab-history-wrap');

    el.listMonths      = $('lab-list-months');
    el.listEmpty       = $('lab-list-empty');

    el.mismatchModal   = $('lab-mismatch-modal');
    el.mismatchClose   = $('lab-mismatch-close');
    el.mismatchCancel  = $('lab-mismatch-cancel');
    el.mismatchList    = $('lab-mismatch-list');

    el.confirmModal    = $('lab-confirm-modal');
    el.confirmClose    = $('lab-confirm-close');
    el.confirmCancel   = $('lab-confirm-cancel');
    el.confirmApply    = $('lab-confirm-apply');
    el.confirmDesc     = $('lab-confirm-desc');
    el.confirmReplaceWarning = $('lab-confirm-replace-warning');

    bindEvents();

    // Firestore 구독
    if (window.firestoreService) {
      var svc = window.firestoreService;
      if (typeof svc.subscribePersons === 'function') {
        svc.subscribePersons(function (list) {
          _persons = Array.isArray(list) ? list : [];
          render();
        });
      }
      if (typeof svc.subscribeLabRegistrations === 'function') {
        svc.subscribeLabRegistrations(function (list) {
          _labRegs = Array.isArray(list) ? list : [];
          render();
        });
      } else {
        console.error('firestoreService.subscribeLabRegistrations 가 없어요. firestore-service.js를 최신본으로 업데이트해 주세요.');
      }
    } else {
      console.error('firestoreService 가 없어요.');
    }
  }

  // DOM 준비되면 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

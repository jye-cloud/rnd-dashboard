/**
 * persons-dashboard.js
 *
 * 인력 대시보드 페이지 본체.
 * - 전체/재직/퇴직 + 회사별 + 청년 카드 렌더링
 * - 입·퇴사 현황 (연도/월 선택)
 * - 시점별 재직 인원 (오늘 기본 + 시점 조정)
 *
 * 데이터 소스: window.firestoreService.subscribePersons
 * 계산 로직:   window.PersonsSummary (persons-summary.js)
 */

(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];
  var _snapshotDate = null;   // null = 오늘, 아니면 사용자가 선택한 Date

  // 입·퇴사 조회 상태 (기본: 올해 연간)
  var _jlState = {
    year: new Date().getFullYear(),
    month: null   // null = 연간
  };

  // ====================================================================
  // DOM 참조
  // ====================================================================
  var el = {};

  function $(id) { return document.getElementById(id); }

  function bindElements() {
    // 1단 카드
    el.statTotal = $('pd-stat-total');
    el.statTotalSub = $('pd-stat-total-sub');
    el.statActive = $('pd-stat-active');
    el.statActiveSub = $('pd-stat-active-sub');
    el.statExited = $('pd-stat-exited');
    el.statSixty = $('pd-stat-sixty');
    el.statSixtySub = $('pd-stat-sixty-sub');
    el.statGoodnews = $('pd-stat-goodnews');
    el.statGoodnewsSub = $('pd-stat-goodnews-sub');
    el.statParity = $('pd-stat-parity');
    el.statParitySub = $('pd-stat-parity-sub');
    el.statYouth = $('pd-stat-youth');

    // 2단 좌: 입·퇴사
    el.jlYear = $('pd-jl-year');
    el.jlMonth = $('pd-jl-month');
    el.jlJoined = $('pd-jl-joined');
    el.jlLeft = $('pd-jl-left');
    el.jlByCompany = $('pd-jl-bycompany');

    // 2단 우: 시점 조회
    el.snapMeta = $('pd-snapshot-meta');
    el.snapTotal = $('pd-snapshot-total');
    el.snapSixty = $('pd-snapshot-sixty');
    el.snapGoodnews = $('pd-snapshot-goodnews');
    el.snapParity = $('pd-snapshot-parity');
    el.snapYear = $('pd-snapshot-year');
    el.snapMonth = $('pd-snapshot-month');
    el.snapQueryBtn = $('pd-snapshot-query-btn');
    el.snapTodayBtn = $('pd-snapshot-today-btn');

    // 3단 청년
    el.youthTotal = $('pd-youth-total');
    el.youthGender = $('pd-youth-gender');
    el.youthSixty = $('pd-youth-sixty');
    el.youthSixtyBar = $('pd-youth-sixty-bar');
    el.youthGoodnews = $('pd-youth-goodnews');
    el.youthGoodnewsBar = $('pd-youth-goodnews-bar');
    el.youthParity = $('pd-youth-parity');
    el.youthParityBar = $('pd-youth-parity-bar');

    el.loading = $('pd-loading');
  }

  // ====================================================================
  // 셀렉트 초기화
  // ====================================================================

  /**
   * 연도 셀렉트를 채움. 데이터에서 추출한 연도 범위 + 올해를 합집합으로.
   */
  function populateYearSelects() {
    var thisYear = new Date().getFullYear();
    var years = new Set([thisYear]);

    // persons에서 hire/exit 연도 수집
    _persons.forEach(function (p) {
      if (!p) return;
      var h = PersonsSummary.parseDateSafe(p.hireDate);
      if (h) years.add(h.getFullYear());
      var ex = PersonsSummary.parseDateSafe(p.exitDate);
      if (ex) years.add(ex.getFullYear());
    });

    // 추가로 최근 5년 보장
    for (var y = thisYear; y >= thisYear - 4; y--) years.add(y);

    var sorted = Array.from(years).sort(function (a, b) { return b - a; });

    [el.jlYear, el.snapYear].forEach(function (sel) {
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = '';
      sorted.forEach(function (y) {
        var opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = y + '년';
        sel.appendChild(opt);
      });
      // 입퇴사: 올해 기본 / 시점조회: 올해 기본
      sel.value = prev || String(thisYear);
    });
  }

  /**
   * 월 셀렉트를 채움. 입·퇴사용은 '연간' 옵션 포함, 시점 조회는 12개월.
   */
  function populateMonthSelects() {
    if (el.jlMonth) {
      el.jlMonth.innerHTML = '<option value="">연간</option>';
      for (var m = 1; m <= 12; m++) {
        var opt = document.createElement('option');
        opt.value = String(m);
        opt.textContent = m + '월';
        el.jlMonth.appendChild(opt);
      }
    }
    if (el.snapMonth) {
      el.snapMonth.innerHTML = '';
      var thisMonth = new Date().getMonth() + 1;
      for (var m2 = 1; m2 <= 12; m2++) {
        var opt2 = document.createElement('option');
        opt2.value = String(m2);
        opt2.textContent = m2 + '월';
        if (m2 === thisMonth) opt2.selected = true;
        el.snapMonth.appendChild(opt2);
      }
    }
  }

  // ====================================================================
  // 렌더링
  // ====================================================================

  /**
   * 1단 + 3단 (인원 현황 + 청년) 렌더링.
   */
  function renderHeadlineCards() {
    var counts = PersonsSummary.getEffectiveCounts(_persons, { refDate: new Date() });

    // [1단 - 상단 행] 전체 / 재직 / 퇴직
    setText(el.statTotal, counts.total);
    setText(el.statTotalSub, '재직 ' + counts.active + ' · 퇴직 ' + counts.exited);
    setText(el.statActive, counts.active);
    var actParts = ['남 ' + counts.gender.male, '여 ' + counts.gender.female];
    if (counts.gender.unknown > 0) actParts.push('미입력 ' + counts.gender.unknown);
    setText(el.statActiveSub, actParts.join(' · '));
    setText(el.statExited, counts.exited);

    // [1단 - 하단 행] 회사별 3사 + 청년
    renderCompanyCard('Sixty',    counts.byCompany['식스티']);
    renderCompanyCard('Goodnews', counts.byCompany['굿뉴스']);
    renderCompanyCard('Parity',   counts.byCompany['패리티']);
    setText(el.statYouth, counts.youth.total);

    // [3단] 청년 상세
    setText(el.youthTotal, counts.youth.total);
    setText(el.youthGender, '남 ' + counts.youth.male + ' · 여 ' + counts.youth.female);
    renderYouthBar('Sixty',    counts.youth.byCompany['식스티'], counts.youth.total);
    renderYouthBar('Goodnews', counts.youth.byCompany['굿뉴스'], counts.youth.total);
    renderYouthBar('Parity',   counts.youth.byCompany['패리티'], counts.youth.total);
  }

  function renderCompanyCard(suffix, c) {
    if (!c) c = { active: 0, male: 0, female: 0 };
    setText(el['stat' + suffix], c.active);
    var subParts = ['남 ' + (c.male || 0), '여 ' + (c.female || 0)];
    // 식스티만 겸직 안내
    if (suffix === 'Sixty' && c.moonlight) {
      subParts.push('겸직 ' + c.moonlight);
    }
    setText(el['stat' + suffix + 'Sub'], subParts.join(' · '));
  }

  function renderYouthBar(suffix, count, total) {
    setText(el['youth' + suffix], (count || 0) + '명');
    var pct = total > 0 ? Math.round(((count || 0) / total) * 100) : 0;
    if (el['youth' + suffix + 'Bar']) {
      el['youth' + suffix + 'Bar'].style.width = pct + '%';
    }
  }

  /**
   * 2단 좌: 입·퇴사 현황 렌더링.
   */
  function renderJoinLeave() {
    var month = _jlState.month;
    var jl = PersonsSummary.getJoinLeaveCounts(_persons, _jlState.year, month);

    setText(el.jlJoined, jl.joined.total);
    setText(el.jlLeft, jl.left.total);

    // 회사별 칩
    if (el.jlByCompany) {
      var html = PersonsSummary.COMPANIES.map(function (c) {
        var j = jl.joined.byCompany[c] || 0;
        var l = jl.left.byCompany[c] || 0;
        return '<span class="pd-jl-bycompany-chip">' +
               escapeHtml(c) + ' <strong style="color:#047857">+' + j + '</strong> / <strong style="color:#dc2626">-' + l + '</strong>' +
               '</span>';
      }).join('');
      el.jlByCompany.innerHTML = html;
    }
  }

  /**
   * 2단 우: 시점별 재직 인원 렌더링.
   */
  function renderSnapshot() {
    var refDate = _snapshotDate || new Date();
    var snap = PersonsSummary.getCountsAtDate(_persons, refDate);

    setText(el.snapTotal, snap.activeAtDate);
    setText(el.snapSixty, snap.byCompany['식스티']);
    setText(el.snapGoodnews, snap.byCompany['굿뉴스']);
    setText(el.snapParity, snap.byCompany['패리티']);

    // 메타 라벨
    if (el.snapMeta) {
      if (!_snapshotDate) {
        el.snapMeta.textContent = '📌 오늘 기준 (' + PersonsSummary.formatDateIso(refDate) + ')';
      } else {
        el.snapMeta.textContent = '🕒 ' + PersonsSummary.formatDateIso(refDate) + ' 기준';
      }
    }
  }

  function renderAll() {
    renderHeadlineCards();
    renderJoinLeave();
    renderSnapshot();
  }

  // ====================================================================
  // 이벤트 바인딩
  // ====================================================================
  function bindEvents() {
    // 입·퇴사 연/월 변경
    if (el.jlYear) {
      el.jlYear.addEventListener('change', function () {
        _jlState.year = parseInt(el.jlYear.value, 10) || new Date().getFullYear();
        renderJoinLeave();
      });
    }
    if (el.jlMonth) {
      el.jlMonth.addEventListener('change', function () {
        var v = el.jlMonth.value;
        _jlState.month = v ? parseInt(v, 10) : null;
        renderJoinLeave();
      });
    }

    // 시점 조회: [조회] 버튼
    if (el.snapQueryBtn) {
      el.snapQueryBtn.addEventListener('click', function () {
        var y = parseInt(el.snapYear.value, 10);
        var m = parseInt(el.snapMonth.value, 10);
        if (isNaN(y) || isNaN(m)) return;
        // 선택한 연/월의 말일을 기준일로
        _snapshotDate = PersonsSummary.lastDayOfMonth(y, m);
        renderSnapshot();
      });
    }

    // 시점 조회: [📌 오늘로] 버튼
    if (el.snapTodayBtn) {
      el.snapTodayBtn.addEventListener('click', function () {
        _snapshotDate = null;
        // 시점 셀렉트도 오늘로 되돌림
        var now = new Date();
        if (el.snapYear) el.snapYear.value = String(now.getFullYear());
        if (el.snapMonth) el.snapMonth.value = String(now.getMonth() + 1);
        renderSnapshot();
      });
    }
  }

  // ====================================================================
  // 유틸
  // ====================================================================
  function setText(node, val) {
    if (node) node.textContent = (val == null ? 0 : val);
  }

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
  // 초기화
  // ====================================================================
  function init() {
    bindElements();
    populateMonthSelects();
    bindEvents();

    if (!window.PersonsSummary) {
      console.error('[persons-dashboard] PersonsSummary 모듈이 로드되지 않았습니다. persons-summary.js를 먼저 로드하세요.');
      return;
    }

    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('[persons-dashboard] firestoreService.subscribePersons 가 없습니다. firestore-service.js 가 먼저 로드되었는지 확인하세요.');
      // 데이터 없이도 빈 상태로 렌더
      populateYearSelects();
      renderAll();
      return;
    }

    if (el.loading) el.loading.hidden = false;

    window.firestoreService.subscribePersons(function (list) {
      _persons = Array.isArray(list) ? list : [];
      populateYearSelects();
      renderAll();
      if (el.loading) el.loading.hidden = true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

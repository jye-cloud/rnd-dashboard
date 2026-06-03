/**
 * persons-dashboard.js — 인력 대시보드 (v8 §3.6 재설계)
 *
 * 성격: 인사(HR) 현황 홈. 데이터 소스 = persons 만 (PersonsSummary).
 * 상단 한 행 동일 박스 3개:
 *   1) 인력 현황 (재직 중심 + 회사별·성별)
 *   2) 입·퇴사 현황 (입사/퇴사 + 회사별 + 월별 막대)
 *   3) 시점별 재직 인원
 * 회사 칩 필터(rnd-company-filter 공유)로 페이지 전체 스코프.
 * 청년 카드·청년 상세·데이터 품질·1단 개별 카드는 제거(청년은 인건비 대시보드 §3.5).
 */
(function () {
  'use strict';

  // ====================================================================
  // 회사 필터 — 인건비 페이지들과 공유 (localStorage)
  // ====================================================================
  var COMPANY_FILTER_KEY = 'rnd-company-filter';
  function loadCompanyFilter() {
    try {
      var v = localStorage.getItem(COMPANY_FILTER_KEY) || '';
      if (v === '' || v === '식스티' || v === '굿뉴스' || v === '패리티') return v;
      return '';
    } catch (e) { return ''; }
  }
  function saveCompanyFilter(c) {
    try { localStorage.setItem(COMPANY_FILTER_KEY, c || ''); } catch (e) {}
  }

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];
  var _company = loadCompanyFilter();   // '' | 식스티 | 굿뉴스 | 패리티
  var _snapshotDate = null;             // null = 오늘
  var _jlState = { year: new Date().getFullYear(), month: null };

  var el = {};
  function $(id) { return document.getElementById(id); }

  // 회사 스코프가 걸린 인력 목록
  function scoped() {
    if (!_company) return _persons;
    return _persons.filter(function (p) {
      return p && PersonsSummary.getCompany(p) === _company;
    });
  }

  // ====================================================================
  // DOM 참조
  // ====================================================================
  function bindElements() {
    el.companyChips = $('pd-company-chips');

    // 박스 1: 인력 현황
    el.hcScope     = $('pd-hc-scope');
    el.hcActive    = $('pd-hc-active');
    el.hcGender    = $('pd-hc-gender');
    el.hcByCompany = $('pd-hc-bycompany');
    el.hcSixty     = $('pd-hc-sixty');
    el.hcGoodnews  = $('pd-hc-goodnews');
    el.hcParity    = $('pd-hc-parity');

    // 박스 2: 입·퇴사
    el.jlYear      = $('pd-jl-year');
    el.jlMonth     = $('pd-jl-month');
    el.jlJoined    = $('pd-jl-joined');
    el.jlLeft      = $('pd-jl-left');
    el.jlByCompany = $('pd-jl-bycompany');
    el.jlMonthly   = $('pd-jl-monthly');

    // 박스 3: 시점별
    el.snapMeta      = $('pd-snapshot-meta');
    el.snapTotal     = $('pd-snapshot-total');
    el.snapByWrap    = $('pd-snapshot-bycompany-wrap');
    el.snapSixty     = $('pd-snapshot-sixty');
    el.snapGoodnews  = $('pd-snapshot-goodnews');
    el.snapParity    = $('pd-snapshot-parity');
    el.snapYear      = $('pd-snapshot-year');
    el.snapMonth     = $('pd-snapshot-month');
    el.snapTodayBtn  = $('pd-snapshot-today-btn');

    el.loading = $('pd-loading');
  }

  // ====================================================================
  // 셀렉트 초기화
  // ====================================================================
  function populateYearSelects() {
    var thisYear = new Date().getFullYear();
    var years = new Set([thisYear]);
    _persons.forEach(function (p) {
      if (!p) return;
      var h = PersonsSummary.parseDateSafe(p.hireDate);
      if (h) years.add(h.getFullYear());
      var ex = PersonsSummary.parseDateSafe(p.exitDate);
      if (ex) years.add(ex.getFullYear());
    });
    for (var y = thisYear; y >= thisYear - 4; y--) years.add(y);
    var sorted = Array.from(years).sort(function (a, b) { return b - a; });

    [el.jlYear, el.snapYear].forEach(function (sel) {
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = '';
      sorted.forEach(function (yy) {
        var opt = document.createElement('option');
        opt.value = String(yy);
        opt.textContent = yy + '년';
        sel.appendChild(opt);
      });
      sel.value = prev || String(thisYear);
    });
  }

  function populateMonthSelects() {
    if (el.jlMonth) {
      el.jlMonth.innerHTML = '<option value="">연간</option>';
      for (var m = 1; m <= 12; m++) {
        var opt = document.createElement('option');
        opt.value = String(m); opt.textContent = m + '월';
        el.jlMonth.appendChild(opt);
      }
    }
    if (el.snapMonth) {
      el.snapMonth.innerHTML = '';
      var thisMonth = new Date().getMonth() + 1;
      for (var m2 = 1; m2 <= 12; m2++) {
        var opt2 = document.createElement('option');
        opt2.value = String(m2); opt2.textContent = m2 + '월';
        if (m2 === thisMonth) opt2.selected = true;
        el.snapMonth.appendChild(opt2);
      }
    }
  }

  // ====================================================================
  // 렌더링
  // ====================================================================
  var COMPANY_LABEL = { '': '전체', '식스티': '식스티', '굿뉴스': '굿뉴스', '패리티': '패리티' };

  // 박스 1: 인력 현황 (재직 중심)
  function renderHeadcount() {
    var list = scoped();
    var counts = PersonsSummary.getEffectiveCounts(list, { refDate: new Date() });

    setText(el.hcScope, COMPANY_LABEL[_company] || '전체');
    setText(el.hcActive, counts.active);
    var g = ['남 ' + counts.gender.male, '여 ' + counts.gender.female];
    if (counts.gender.unknown > 0) g.push('미입력 ' + counts.gender.unknown);
    setText(el.hcGender, g.join(' · '));

    // 회사별 분해는 전체 보기에서만
    if (el.hcByCompany) {
      if (_company) {
        el.hcByCompany.style.display = 'none';
      } else {
        el.hcByCompany.style.display = '';
        setText(el.hcSixty,    (counts.byCompany['식스티'] || {}).active || 0);
        setText(el.hcGoodnews, (counts.byCompany['굿뉴스'] || {}).active || 0);
        setText(el.hcParity,   (counts.byCompany['패리티'] || {}).active || 0);
      }
    }
  }

  // 박스 2: 입·퇴사
  function renderJoinLeave() {
    var list = scoped();
    var jl = PersonsSummary.getJoinLeaveCounts(list, _jlState.year, _jlState.month);

    setText(el.jlJoined, jl.joined.total);
    setText(el.jlLeft, jl.left.total);

    // 회사별 칩 (전체 보기에서만 의미 있음; 단일 회사면 그 회사 한 줄)
    if (el.jlByCompany) {
      var companies = _company ? [_company] : PersonsSummary.COMPANIES;
      el.jlByCompany.innerHTML = companies.map(function (c) {
        var j = jl.joined.byCompany[c] || 0;
        var l = jl.left.byCompany[c] || 0;
        return '<span class="pd-jl-bycompany-chip">' + escapeHtml(c) +
               ' <strong style="color:#047857">+' + j + '</strong> / <strong style="color:#dc2626">-' + l + '</strong></span>';
      }).join('');
    }

    renderMonthlyBars(list);
  }

  // 월별 입·퇴사 막대 (선택 연도의 12개월, 의존성 없는 div 막대)
  function renderMonthlyBars(list) {
    if (!el.jlMonthly) return;
    var year = _jlState.year;
    var data = [];
    var maxV = 1;
    for (var m = 1; m <= 12; m++) {
      var jl = PersonsSummary.getJoinLeaveCounts(list, year, m);
      data.push({ m: m, j: jl.joined.total, l: jl.left.total });
      maxV = Math.max(maxV, jl.joined.total, jl.left.total);
    }
    el.jlMonthly.innerHTML = data.map(function (o) {
      var jh = Math.round(o.j / maxV * 100);
      var lh = Math.round(o.l / maxV * 100);
      return '<div class="pd-mbar-col" data-tip="' + o.m + '월 · 입사 ' + o.j + ' · 퇴사 ' + o.l + '">' +
               '<div class="pd-mbar-stack">' +
                 '<div class="pd-mbar-bar pd-mbar-bar--j" style="height:' + jh + '%"></div>' +
                 '<div class="pd-mbar-bar pd-mbar-bar--l" style="height:' + lh + '%"></div>' +
               '</div>' +
               '<div class="pd-mbar-label">' + o.m + '</div>' +
             '</div>';
    }).join('');
  }

  // 박스 3: 시점별 재직 인원
  function renderSnapshot() {
    var list = scoped();
    var refDate = _snapshotDate || new Date();
    var snap = PersonsSummary.getCountsAtDate(list, refDate);

    setText(el.snapTotal, snap.activeAtDate);
    if (el.snapByWrap) {
      if (_company) {
        el.snapByWrap.style.display = 'none';
      } else {
        el.snapByWrap.style.display = '';
        setText(el.snapSixty, snap.byCompany['식스티']);
        setText(el.snapGoodnews, snap.byCompany['굿뉴스']);
        setText(el.snapParity, snap.byCompany['패리티']);
      }
    }
    if (el.snapMeta) {
      el.snapMeta.textContent = (_snapshotDate ? '🕒 ' : '📌 오늘 기준 (') +
        PersonsSummary.formatDateIso(refDate) + (_snapshotDate ? ' 기준' : ')');
    }
  }

  function renderAll() {
    renderHeadcount();
    renderJoinLeave();
    renderSnapshot();
  }

  // ====================================================================
  // 이벤트
  // ====================================================================
  function bindEvents() {
    if (el.companyChips) {
      el.companyChips.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === _company);
      });
      el.companyChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.company-chip');
        if (!btn) return;
        var c = btn.dataset.company || '';
        if (c === _company) return;
        _company = c;
        saveCompanyFilter(c);
        el.companyChips.querySelectorAll('.company-chip').forEach(function (b) {
          b.classList.toggle('is-active', (b.dataset.company || '') === c);
        });
        renderAll();
      });
    }

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
    // 시점 조회: 연/월 드롭다운만 바꿔도 즉시 갱신
    function applySnapshotSelect() {
      var y = parseInt(el.snapYear.value, 10);
      var m = parseInt(el.snapMonth.value, 10);
      if (isNaN(y) || isNaN(m)) return;
      var now = new Date();
      // 올해·이번 달을 고르면 '오늘 기준'으로 (말일이 미래가 되지 않도록)
      if (y === now.getFullYear() && m === now.getMonth() + 1) {
        _snapshotDate = null;
      } else {
        _snapshotDate = PersonsSummary.lastDayOfMonth(y, m);
      }
      renderSnapshot();
    }
    if (el.snapYear)  el.snapYear.addEventListener('change', applySnapshotSelect);
    if (el.snapMonth) el.snapMonth.addEventListener('change', applySnapshotSelect);

    if (el.snapTodayBtn) {
      el.snapTodayBtn.addEventListener('click', function () {
        _snapshotDate = null;
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
  function setText(node, val) { if (node) node.textContent = (val == null ? 0 : val); }
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    bindElements();
    populateMonthSelects();
    bindEvents();

    if (!window.PersonsSummary) {
      console.error('[persons-dashboard] PersonsSummary 모듈이 로드되지 않았습니다.');
      return;
    }
    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('[persons-dashboard] firestoreService.subscribePersons 가 없습니다.');
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

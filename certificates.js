/**
 * certificates.js
 * 자격증 관리 페이지
 *
 * 데이터: persons 컬렉션의 각 인력 안에 있는 certificates 배열을 사람 단위로 묶어서 표시.
 * 한 사람 = 한 행. 자격증은 가로로 나열 (자격증 컬럼 수는 데이터 최대값에 맞춰 동적).
 *
 * 기능:
 *  - 자격증별 보유자 수 칩 (클릭해서 필터)
 *  - 칩 즐겨찾기 ⭐ (Firestore 저장, 전체 사용자 공유)
 *  - 모드 토글: "⭐ 즐겨찾기만" / "전체"
 *  - 회사 필터 (전체/식스티/굿뉴스/패리티)
 *  - 이름/자격증명 검색
 *  - 정렬: 회사 → 이름
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];

  // 즐겨찾기 칩 (자격증명 배열) — Firestore에 저장
  var _favoriteCerts = [];
  var _favoritesLoaded = false;     // Firestore에서 한 번 로드 완료 여부

  var _filter = {
    keyword: '',
    company: 'all',
    certName: null,
    chipMode: 'favorites'           // 'favorites' | 'all'
  };

  // 사람 단위로 묶은 데이터
  // [{ personId, personName, company, certs: [{name, url, memo}, ...] }, ...]
  var _peopleRows = [];

  var el = {
    search: null,
    searchClear: null,
    companyButtons: null,
    chipsContainer: null,
    modeButtons: null,
    thead: null,
    tbody: null,
    emptyState: null,
    meta: null,
    peopleMeta: null
  };

  // ====================================================================
  // Firestore: 즐겨찾기 저장/구독
  // ====================================================================
  var FAV_COLLECTION = 'certificateSettings';
  var FAV_DOC = 'data';
  var FAV_LOCAL_KEY = 'cert-favorites-fallback';   // Firestore 미설정 시 폴백

  function getDb() {
    return window.__firebaseDb || null;
  }

  function isFirestoreConfigured() {
    return !!window.__firebaseConfigured && !!getDb();
  }

  function subscribeFavorites(onChange) {
    if (isFirestoreConfigured()) {
      try {
        getDb().collection(FAV_COLLECTION).doc(FAV_DOC).onSnapshot(function (snap) {
          var data = snap && snap.exists ? snap.data() : null;
          var list = (data && Array.isArray(data.favorites)) ? data.favorites : [];
          onChange(list);
        }, function (err) {
          console.error('[certificates] 즐겨찾기 구독 실패:', err);
          onChange([]);
        });
        return;
      } catch (e) {
        console.error('[certificates] Firestore 구독 예외:', e);
      }
    }
    // 폴백: localStorage
    try {
      var raw = localStorage.getItem(FAV_LOCAL_KEY);
      onChange(raw ? JSON.parse(raw) : []);
    } catch (e) {
      onChange([]);
    }
  }

  function saveFavorites(list) {
    var arr = Array.isArray(list) ? list.slice() : [];
    if (isFirestoreConfigured()) {
      getDb().collection(FAV_COLLECTION).doc(FAV_DOC).set({
        favorites: arr,
        updatedAt: new Date().toISOString()
      }).catch(function (err) {
        console.error('[certificates] 즐겨찾기 저장 실패:', err);
        alert('즐겨찾기 저장에 실패했어요. 콘솔을 확인해 주세요.');
      });
    } else {
      try { localStorage.setItem(FAV_LOCAL_KEY, JSON.stringify(arr)); } catch (e) {}
    }
  }

  function toggleFavorite(certName) {
    if (!certName) return;
    var idx = _favoriteCerts.indexOf(certName);
    if (idx >= 0) {
      _favoriteCerts.splice(idx, 1);
    } else {
      _favoriteCerts.push(certName);
    }
    saveFavorites(_favoriteCerts);
    // 낙관적 업데이트: onSnapshot이 곧 다시 콜되겠지만 화면은 즉시 반영
    renderChips();
  }

  // ====================================================================
  // 유틸
  // ====================================================================
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCompany(person) {
    if (!person) return '식스티';
    return person.company || '식스티';
  }

  function isActive(person) {
    if (!person) return false;
    return person.status !== 'exited';
  }

  // ====================================================================
  // 데이터 가공
  // ====================================================================

  /**
   * _persons → 사람 단위 행 빌드.
   * - 퇴직자 제외
   * - 자격증 없는 사람 제외
   */
  function buildPeopleRows() {
    var rows = [];
    for (var i = 0; i < _persons.length; i++) {
      var p = _persons[i];
      if (!p || !isActive(p)) continue;
      if (!Array.isArray(p.certificates) || p.certificates.length === 0) continue;

      var certs = [];
      for (var j = 0; j < p.certificates.length; j++) {
        var c = p.certificates[j];
        if (!c || !c.name) continue;
        var name = String(c.name).trim();
        if (!name) continue;
        certs.push({ name: name });
      }
      if (certs.length === 0) continue;

      rows.push({
        personId: p.id,
        personName: p.name || '-',
        company: getCompany(p),
        certs: certs
      });
    }
    _peopleRows = rows;
  }

  function getFilteredRows() {
    var keyword = (_filter.keyword || '').trim().toLowerCase();
    var company = _filter.company;
    var certName = _filter.certName;

    var rows = _peopleRows.filter(function (row) {
      if (company !== 'all' && row.company !== company) return false;
      if (certName) {
        var has = row.certs.some(function (c) { return c.name === certName; });
        if (!has) return false;
      }
      if (keyword) {
        var nameMatch = (row.personName || '').toLowerCase().indexOf(keyword) >= 0;
        var certMatch = row.certs.some(function (c) {
          return (c.name || '').toLowerCase().indexOf(keyword) >= 0;
        });
        if (!nameMatch && !certMatch) return false;
      }
      return true;
    });

    // 정렬: 회사 → 이름
    var companyOrder = { '식스티': 0, '굿뉴스': 1, '패리티': 2 };
    rows.sort(function (a, b) {
      var ca = companyOrder[a.company] != null ? companyOrder[a.company] : 99;
      var cb = companyOrder[b.company] != null ? companyOrder[b.company] : 99;
      if (ca !== cb) return ca - cb;
      return (a.personName || '').localeCompare(b.personName || '', 'ko');
    });
    return rows;
  }

  /**
   * 자격증별 보유자 수 집계 (전체 데이터 기준 — 필터 영향 없음)
   * 같은 사람이 같은 자격증을 여러 번 등록한 경우 1명으로 카운트.
   */
  function getCertTypeCounts() {
    var byName = {};
    for (var i = 0; i < _peopleRows.length; i++) {
      var row = _peopleRows[i];
      var seenInThisPerson = {};
      for (var j = 0; j < row.certs.length; j++) {
        var name = row.certs[j].name;
        if (!name) continue;
        if (seenInThisPerson[name]) continue;
        seenInThisPerson[name] = true;
        if (!byName[name]) byName[name] = 0;
        byName[name]++;
      }
    }
    var arr = [];
    Object.keys(byName).forEach(function (name) {
      arr.push({ name: name, count: byName[name] });
    });
    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'ko');
    });
    return arr;
  }

  // ====================================================================
  // 렌더링
  // ====================================================================
  function renderPeopleMeta() {
    if (!el.peopleMeta) return;
    var holderCount = _peopleRows.length;
    var totalActivePersons = 0;
    for (var k = 0; k < _persons.length; k++) {
      if (isActive(_persons[k])) totalActivePersons++;
    }
    el.peopleMeta.innerHTML = '전체 ' + totalActivePersons + '명 중 <strong>' + holderCount + '명</strong> 보유';
  }

  function renderChips() {
    if (!el.chipsContainer) return;
    var allCounts = getCertTypeCounts();

    // 모드 토글 활성 상태
    if (el.modeButtons) {
      var btns = el.modeButtons.querySelectorAll('.cert-type-mode-btn');
      btns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === _filter.chipMode);
      });
    }

    // 표시할 칩 결정
    var visibleCounts;
    if (_filter.chipMode === 'favorites') {
      visibleCounts = allCounts.filter(function (c) {
        return _favoriteCerts.indexOf(c.name) >= 0;
      });
    } else {
      visibleCounts = allCounts;
    }

    if (allCounts.length === 0) {
      el.chipsContainer.innerHTML = '<div class="cert-type-empty">등록된 자격증이 없습니다.</div>';
      return;
    }
    if (visibleCounts.length === 0 && _filter.chipMode === 'favorites') {
      el.chipsContainer.innerHTML = '<div class="cert-type-empty">⭐ 즐겨찾기로 표시한 자격증이 없어요. "전체"로 전환해서 별표를 매겨주세요.</div>';
      return;
    }

    var totalCount = allCounts.reduce(function (s, c) { return s + c.count; }, 0);

    var html = '';
    // "전체" 칩 (필터 해제)
    var allActive = _filter.certName == null ? ' active' : '';
    html += '<button type="button" class="cert-type-chip' + allActive + '" data-cert-name="">'
         +   '전체'
         +   '<span class="cert-type-chip-count">' + totalCount + '</span>'
         + '</button>';

    visibleCounts.forEach(function (c) {
      var active = (_filter.certName === c.name) ? ' active' : '';
      var isFav = _favoriteCerts.indexOf(c.name) >= 0;
      var starClass = isFav ? 'cert-type-chip-star favorited' : 'cert-type-chip-star';
      var starTitle = isFav ? '즐겨찾기에서 제거' : '즐겨찾기에 추가';
      var starGlyph = isFav ? '★' : '☆';

      html += '<span class="cert-type-chip' + active + '" data-cert-name="' + escapeHtml(c.name) + '">'
           +   '<button type="button" class="' + starClass + '" data-action="toggle-favorite" '
           +     'data-cert-name="' + escapeHtml(c.name) + '" '
           +     'title="' + starTitle + '" aria-label="' + starTitle + '">' + starGlyph + '</button>'
           +   '<span class="cert-type-chip-label">' + escapeHtml(c.name) + '</span>'
           +   '<span class="cert-type-chip-count">' + c.count + '</span>'
           + '</span>';
    });
    el.chipsContainer.innerHTML = html;
  }

  function renderTable() {
    if (!el.thead || !el.tbody) return;
    var rows = getFilteredRows();

    if (el.meta) {
      el.meta.textContent = rows.length + '명';
    }

    if (rows.length === 0) {
      el.thead.innerHTML = '';
      el.tbody.innerHTML = '';
      if (el.emptyState) el.emptyState.hidden = false;
      return;
    }
    if (el.emptyState) el.emptyState.hidden = true;

    // 자격증 컬럼 수는 7개로 고정 (균등 분배).
    // 자격증 8개 이상 보유한 사람은 8번째부터 표시되지 않음.
    var maxCerts = 7;

    // 헤더 — 회사/이름은 같은 폭(115px), 자격증 7개는 남은 공간 자동 균등분배
    var theadHtml = '<tr>'
      + '<th style="width:115px;text-align:center">회사</th>'
      + '<th style="width:115px;text-align:center">이름</th>';
    for (var k = 1; k <= maxCerts; k++) {
      theadHtml += '<th style="text-align:center">자격증 ' + k + '</th>';
    }
    theadHtml += '</tr>';
    el.thead.innerHTML = theadHtml;

    // 본문
    var currentCertFilter = _filter.certName;
    var tbodyHtml = '';
    rows.forEach(function (r) {
      var companyBadge = '<span class="cert-company-badge cert-company-badge--' + escapeHtml(r.company) + '">'
                      + escapeHtml(r.company) + '</span>';
      tbodyHtml += '<tr>'
        + '<td style="text-align:center">' + companyBadge + '</td>'
        + '<td style="text-align:center"><a href="persons-detail.html" style="color:#2563eb;text-decoration:none">' + escapeHtml(r.personName) + '</a></td>';

      for (var m = 0; m < maxCerts; m++) {
        var c = r.certs[m];
        if (c) {
          var highlightClass = (currentCertFilter && currentCertFilter === c.name) ? ' cert-name-cell--highlight' : '';
          var safeName = escapeHtml(c.name);
          tbodyHtml += '<td class="cert-name-cell' + highlightClass + '" title="' + safeName + '">' + safeName + '</td>';
        } else {
          tbodyHtml += '<td class="cert-name-cell cert-name-cell--empty"></td>';
        }
      }
      tbodyHtml += '</tr>';
    });
    el.tbody.innerHTML = tbodyHtml;
  }

  function render() {
    buildPeopleRows();
    renderPeopleMeta();
    renderChips();
    renderTable();
  }

  // ====================================================================
  // 이벤트 핸들러
  // ====================================================================
  function onSearchInput() {
    if (!el.search) return;
    _filter.keyword = el.search.value || '';
    if (el.searchClear) el.searchClear.hidden = !_filter.keyword;
    renderTable();
  }

  function onSearchClear() {
    if (!el.search) return;
    el.search.value = '';
    _filter.keyword = '';
    if (el.searchClear) el.searchClear.hidden = true;
    el.search.focus();
    renderTable();
  }

  function onCompanyFilterClick(e) {
    var btn = e.target.closest('.cert-company-btn');
    if (!btn) return;
    var company = btn.getAttribute('data-company');
    if (!company) return;
    _filter.company = company;
    if (el.companyButtons) {
      var buttons = el.companyButtons.querySelectorAll('.cert-company-btn');
      buttons.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-company') === company);
      });
    }
    renderTable();
  }

  function onChipsClick(e) {
    // 별 클릭(즐겨찾기 토글)은 칩 클릭(필터)보다 먼저 처리
    var starBtn = e.target.closest('button[data-action="toggle-favorite"]');
    if (starBtn) {
      e.stopPropagation();
      var name = starBtn.getAttribute('data-cert-name');
      toggleFavorite(name);
      return;
    }
    // 칩 본체 클릭 → 필터 토글
    var chip = e.target.closest('.cert-type-chip');
    if (!chip) return;
    var certName = chip.getAttribute('data-cert-name') || '';
    _filter.certName = certName || null;
    renderChips();
    renderTable();
  }

  function onModeToggleClick(e) {
    var btn = e.target.closest('.cert-type-mode-btn');
    if (!btn) return;
    var mode = btn.getAttribute('data-mode');
    if (!mode) return;
    _filter.chipMode = mode;
    renderChips();
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function $(id) { return document.getElementById(id); }

  function bindEvents() {
    if (el.search)           el.search.addEventListener('input', onSearchInput);
    if (el.searchClear)      el.searchClear.addEventListener('click', onSearchClear);
    if (el.companyButtons)   el.companyButtons.addEventListener('click', onCompanyFilterClick);
    if (el.chipsContainer)   el.chipsContainer.addEventListener('click', onChipsClick);
    if (el.modeButtons)      el.modeButtons.addEventListener('click', onModeToggleClick);
  }

  function init() {
    el.search           = $('cert-search');
    el.searchClear      = $('cert-search-clear');
    el.companyButtons   = document.querySelector('.cert-company-filter');
    el.chipsContainer   = $('cert-type-chips');
    el.modeButtons      = document.querySelector('.cert-type-mode-toggle');
    el.thead            = $('cert-thead');
    el.tbody            = $('cert-tbody');
    el.emptyState       = $('cert-empty-state');
    el.meta             = $('cert-meta');
    el.peopleMeta       = $('cert-people-meta');

    bindEvents();

    // 즐겨찾기 구독
    subscribeFavorites(function (favList) {
      _favoriteCerts = Array.isArray(favList) ? favList : [];
      _favoritesLoaded = true;
      renderChips();
    });

    // persons 구독
    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('firestoreService.subscribePersons 가 없어요. firestore-service.js 가 먼저 로드되었는지 확인해 주세요.');
      render();
      return;
    }
    window.firestoreService.subscribePersons(function (list) {
      _persons = Array.isArray(list) ? list : [];
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

/**
 * certificates.js
 * 자격증 전체 현황 페이지 (Step 4-2)
 *
 * 데이터: persons 컬렉션의 각 인력 안에 있는 certificates 배열을 평탄화(flatten)해서 표시.
 * 1명 = N개의 자격증을 가질 수 있고, 한 행에 자격증 1개씩 표시됨.
 *
 * 기능:
 *  - 상단 요약 카드 (전체 자격증 수 / 보유 인원 / 증빙 URL 보유)
 *  - 자격증별 보유자 수 칩 (클릭해서 필터)
 *  - 회사 필터 (전체/식스티/굿뉴스/패리티)
 *  - 이름/자격증명 검색
 *  - 테이블 정렬: 회사 → 이름 → 자격증 이름
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _persons = [];

  var _filter = {
    keyword: '',                  // 이름/자격증 검색어
    company: 'all',               // 'all' | '식스티' | '굿뉴스' | '패리티'
    certName: null                // 특정 자격증명으로 필터 (칩 클릭 시)
  };

  // 평탄화된 자격증 목록 (한 행 = 자격증 1개 + 보유자 정보)
  // [{ personId, name, company, certId, certName, url, memo, createdAt }, ...]
  var _flatCerts = [];

  var el = {
    search: null,
    searchClear: null,
    companyButtons: null,
    chipsContainer: null,
    tbody: null,
    emptyState: null,
    meta: null,
    peopleMeta: null   // 자격증별 섹션 상단의 "전체 N명 중 n명 보유" 표시
  };

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
    // persons-detail.js와 동일한 패턴: company 필드를 우선, 없으면 식스티 default
    if (!person) return '식스티';
    return person.company || '식스티';
  }

  function isActive(person) {
    // 퇴직자 제외 — status가 'exited'면 퇴직, 그 외엔 재직
    if (!person) return false;
    return person.status !== 'exited';
  }

  function isValidHttpUrl(s) {
    if (!s) return false;
    return /^https?:\/\//i.test(String(s).trim());
  }

  // ====================================================================
  // 데이터 가공
  // ====================================================================

  /**
   * _persons로부터 _flatCerts를 만든다.
   * - 퇴직자 제외
   * - 자격증이 없는 인력은 행으로 표시되지 않음
   */
  function buildFlatCerts() {
    var result = [];
    for (var i = 0; i < _persons.length; i++) {
      var p = _persons[i];
      if (!p || !isActive(p)) continue;
      if (!Array.isArray(p.certificates) || p.certificates.length === 0) continue;

      for (var j = 0; j < p.certificates.length; j++) {
        var c = p.certificates[j];
        if (!c || !c.name) continue;
        result.push({
          personId: p.id,
          personName: p.name || '-',
          company: getCompany(p),
          certId: c.id || ('cert_' + i + '_' + j),
          certName: c.name,
          url: c.url || null,
          memo: c.memo || null,
          createdAt: c.createdAt || null
        });
      }
    }
    _flatCerts = result;
  }

  /**
   * 필터 적용된 결과 반환 (정렬: 회사 → 이름 → 자격증)
   */
  function getFilteredCerts() {
    var keyword = (_filter.keyword || '').trim().toLowerCase();
    var company = _filter.company;
    var certName = _filter.certName;

    var result = _flatCerts.filter(function (row) {
      // 회사 필터
      if (company !== 'all' && row.company !== company) return false;
      // 자격증명 필터 (칩 클릭)
      if (certName && row.certName !== certName) return false;
      // 검색어 (이름 또는 자격증명)
      if (keyword) {
        var nameMatch = (row.personName || '').toLowerCase().indexOf(keyword) >= 0;
        var certMatch = (row.certName || '').toLowerCase().indexOf(keyword) >= 0;
        if (!nameMatch && !certMatch) return false;
      }
      return true;
    });

    // 정렬
    var companyOrder = { '식스티': 0, '굿뉴스': 1, '패리티': 2 };
    result.sort(function (a, b) {
      var ca = companyOrder[a.company] != null ? companyOrder[a.company] : 99;
      var cb = companyOrder[b.company] != null ? companyOrder[b.company] : 99;
      if (ca !== cb) return ca - cb;
      var na = (a.personName || '').localeCompare(b.personName || '', 'ko');
      if (na !== 0) return na;
      return (a.certName || '').localeCompare(b.certName || '', 'ko');
    });
    return result;
  }

  /**
   * 자격증별 보유자 수 집계
   * @returns {Array} [{name, count}, ...] count 내림차순
   *
   * 같은 사람이 같은 자격증을 두 번 등록한 케이스는 합쳐서 1명으로 카운트.
   */
  function getCertTypeCounts() {
    var byName = {};  // { '정보처리기사': Set([personId1, personId2]) }
    for (var i = 0; i < _flatCerts.length; i++) {
      var row = _flatCerts[i];
      if (!row.certName) continue;
      if (!byName[row.certName]) byName[row.certName] = {};
      byName[row.certName][row.personId] = true;
    }

    var arr = [];
    Object.keys(byName).forEach(function (name) {
      arr.push({ name: name, count: Object.keys(byName[name]).length });
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
  /**
   * 자격증별 보유자 섹션 상단의 메타 텍스트 갱신
   * 예: "전체 25명 중 8명 보유"
   */
  function renderPeopleMeta() {
    if (!el.peopleMeta) return;

    // 재직자 중 자격증 보유자 수
    var uniquePeople = {};
    for (var i = 0; i < _flatCerts.length; i++) {
      uniquePeople[_flatCerts[i].personId] = true;
    }
    var holderCount = Object.keys(uniquePeople).length;

    // 전체 재직자 수
    var totalActivePersons = 0;
    for (var k = 0; k < _persons.length; k++) {
      if (isActive(_persons[k])) totalActivePersons++;
    }

    el.peopleMeta.innerHTML = '전체 ' + totalActivePersons + '명 중 <strong>' + holderCount + '명</strong> 보유';
  }

  function renderChips() {
    if (!el.chipsContainer) return;
    var counts = getCertTypeCounts();

    if (counts.length === 0) {
      el.chipsContainer.innerHTML = '<div class="cert-type-empty">등록된 자격증이 없습니다.</div>';
      return;
    }

    var html = '';
    // "전체" 칩 (필터 해제)
    var allActive = _filter.certName == null ? ' active' : '';
    html += '<button type="button" class="cert-type-chip' + allActive + '" data-cert-name="">'
         +   '전체'
         +   '<span class="cert-type-chip-count">' + counts.reduce(function (s, c) { return s + c.count; }, 0) + '</span>'
         + '</button>';

    for (var i = 0; i < counts.length; i++) {
      var c = counts[i];
      var active = (_filter.certName === c.name) ? ' active' : '';
      html += '<button type="button" class="cert-type-chip' + active + '" data-cert-name="' + escapeHtml(c.name) + '">'
           +   escapeHtml(c.name)
           +   '<span class="cert-type-chip-count">' + c.count + '</span>'
           + '</button>';
    }
    el.chipsContainer.innerHTML = html;
  }

  function renderTable() {
    if (!el.tbody) return;
    var rows = getFilteredCerts();

    if (el.meta) {
      el.meta.textContent = '자격증 ' + rows.length + '건';
    }

    if (rows.length === 0) {
      el.tbody.innerHTML = '';
      if (el.emptyState) el.emptyState.hidden = false;
      return;
    }

    if (el.emptyState) el.emptyState.hidden = true;

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var companyBadge = '<span class="cert-company-badge cert-company-badge--' + escapeHtml(r.company) + '">'
                      + escapeHtml(r.company) + '</span>';
      var linkCell;
      if (r.url && isValidHttpUrl(r.url)) {
        linkCell = '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener noreferrer" class="cert-link-btn">📎 보기</a>';
      } else if (r.url) {
        linkCell = '<span class="cert-link-empty" title="유효하지 않은 URL">⚠️</span>';
      } else {
        linkCell = '<span class="cert-link-empty">—</span>';
      }

      html += '<tr>'
        + '<td>' + companyBadge + '</td>'
        + '<td><a href="persons-detail.html" style="color:#2563eb;text-decoration:none">' + escapeHtml(r.personName) + '</a></td>'
        + '<td class="cert-name-cell">' + escapeHtml(r.certName) + '</td>'
        + '<td class="cert-memo-cell">' + (r.memo ? escapeHtml(r.memo) : '<span style="color:#cbd5e1">—</span>') + '</td>'
        + '<td style="text-align:center">' + linkCell + '</td>'
        + '</tr>';
    }
    el.tbody.innerHTML = html;
  }

  function render() {
    buildFlatCerts();
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
    // 버튼 active 갱신
    if (el.companyButtons) {
      var buttons = el.companyButtons.querySelectorAll('.cert-company-btn');
      buttons.forEach(function (b) {
        if (b.getAttribute('data-company') === company) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    renderTable();
  }

  function onChipClick(e) {
    var chip = e.target.closest('.cert-type-chip');
    if (!chip) return;
    var certName = chip.getAttribute('data-cert-name') || '';
    _filter.certName = certName || null;
    renderChips();   // 활성 칩 갱신
    renderTable();
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function $(id) { return document.getElementById(id); }

  function bindEvents() {
    if (el.search) {
      el.search.addEventListener('input', onSearchInput);
    }
    if (el.searchClear) {
      el.searchClear.addEventListener('click', onSearchClear);
    }
    if (el.companyButtons) {
      el.companyButtons.addEventListener('click', onCompanyFilterClick);
    }
    if (el.chipsContainer) {
      el.chipsContainer.addEventListener('click', onChipClick);
    }
  }

  function init() {
    el.search             = $('cert-search');
    el.searchClear        = $('cert-search-clear');
    el.companyButtons     = document.querySelector('.cert-company-filter');
    el.chipsContainer     = $('cert-type-chips');
    el.tbody              = $('cert-tbody');
    el.emptyState         = $('cert-empty-state');
    el.meta               = $('cert-meta');
    el.peopleMeta         = $('cert-people-meta');

    bindEvents();

    if (!window.firestoreService || typeof window.firestoreService.subscribePersons !== 'function') {
      console.error('firestoreService.subscribePersons 가 없습니다. firestore-service.js 가 먼저 로드되었는지 확인하세요.');
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

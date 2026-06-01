/**
 * sidebar.js
 * 모든 페이지에서 사용하는 공통 사이드바.
 *
 * 사용법:
 *   <div id="sidebar-mount"></div>
 *   <script src="sidebar.js"></script>
 *
 * 페이지가 자동으로 현재 URL을 감지해서 해당 메뉴를 active로 표시합니다.
 *
 * 메뉴를 추가/수정할 때는 이 파일 하나만 고치면 모든 페이지에 자동 반영됩니다.
 */

(function () {
  'use strict';

  // ====================================================================
  // 메뉴 정의 — 여기만 수정하면 모든 페이지에 반영됨
  // ====================================================================
  // group: 같은 group은 위아래 구분선 없이 묶여서 표시됨
  // 다른 group 사이에는 구분선이 자동 삽입됨
  // parent: 부모 메뉴의 id. 있으면 들여쓰기되어 표시되고, 부모가 접혀 있으면 숨겨짐
  // expandable: true면 펼침/접힘 토글 버튼이 표시됨 (하위 메뉴가 있는 부모)
  // 참여율 합계 페이지(participation-summary)는 v6.1에서 추가됨
  var MENU_ITEMS = [
    // === 그룹 1: 일정/현황 ===
    { id: 'nav-history',           href: 'projects-history.html',        icon: '📜', label: '수행 현황',         group: 1 },
    { id: 'nav-calendar',          href: 'index.html#/calendar',         icon: '📅', label: '일정 관리',         group: 1 },

    // === 그룹 2: 메인 관리 페이지 ===
    { id: 'nav-dashboard',         href: 'dashboard.html',               icon: '🏠', label: '대시보드',          group: 2 },
    { id: 'nav-funding',           href: 'funding.html',                 icon: '💸', label: '자금 관리',         group: 2 },
    { id: 'nav-projects',          href: 'projects.html',                icon: '📋', label: '과제 관리',         group: 2 },
    { id: 'nav-projects-summary',  href: 'projects-summary.html',        icon: '🪪', label: '과제별 상세',       group: 2 },

    // === 그룹 3: 인력 대시보드 (하위 메뉴 포함) ===
    { id: 'nav-persons-dashboard', href: 'persons-dashboard.html',       icon: '👥', label: '인력 대시보드',     group: 3, expandable: true },
    { id: 'nav-persons-master',    href: 'persons-master.html',          icon: '👤', label: '마스터',            group: 3, parent: 'nav-persons-dashboard' },
    { id: 'nav-persons-detail',    href: 'persons-detail.html',          icon: '📑', label: '상세',              group: 3, parent: 'nav-persons-dashboard' },
    { id: 'nav-participation-summary', href: 'participation-summary.html', icon: '📊', label: '참여율',          group: 3, parent: 'nav-persons-dashboard' },
    { id: 'nav-settlement-report', href: 'settlement-report.html', icon: '🧾', label: '결산 보고서',     group: 3, parent: 'nav-persons-dashboard' },
    { id: 'nav-lab',               href: 'lab.html',                     icon: '🔬', label: '기업부설연구소',    group: 3, parent: 'nav-persons-dashboard' },
    { id: 'nav-certificates',      href: 'certificates.html',            icon: '🗃️', label: '자격증',            group: 3, parent: 'nav-persons-dashboard' },

    // === 그룹 4: 인건비 대시보드 (하위 메뉴 포함) ===
    { id: 'nav-labor-dashboard',   href: 'labor-dashboard.html',         icon: '📈', label: '인건비 대시보드',   group: 4, expandable: true },
    { id: 'nav-project-labor',     href: 'project-labor.html',           icon: '💰', label: '프로젝트별 인건비', group: 4, parent: 'nav-labor-dashboard' },
    { id: 'nav-project-budget',    href: 'project-budget.html',          icon: '💵', label: '인건비 예산',       group: 4, parent: 'nav-labor-dashboard' }
  ];

  var APP_TITLE = 'CI_R&DM';
  var COLLAPSED_KEY = 'rnd-sidebar-collapsed';   // 사용자가 수동 토글한 상태: '1' | '0' | null(미설정)
  var EXPANDED_KEY = 'rnd-sidebar-expanded';     // 부모 메뉴별 펼침 상태 JSON: { 'nav-persons-dashboard': true, ... }
  var AUTO_COLLAPSE_BREAKPOINT = 1420;            // 이 너비 미만이면 자동 접힘
  // ※ 1420 선정 이유: 사이드바 펼침(240px) + .container min-width(1200px) = 1440px
  //   1420px 미만에선 사이드바를 접어야 본문이 가로 스크롤 없이 들어감.

  // ====================================================================
  // 현재 페이지 감지
  // ====================================================================
  function detectCurrentPage() {
    var path = window.location.pathname;
    var hash = window.location.hash || '';

    // 파일명 추출 (예: /persons-master.html → persons-master.html)
    var filename = path.split('/').pop() || 'index.html';
    if (filename === '' || filename === '/') filename = 'index.html';

    // 정확히 매칭되는 메뉴 찾기 (href와 비교)
    // hash가 있으면 hash까지 포함해서 비교
    var currentUrl = filename + hash;

    for (var i = 0; i < MENU_ITEMS.length; i++) {
      var item = MENU_ITEMS[i];
      // index.html#/calendar 같은 hash 포함 URL 처리
      if (item.href === currentUrl) return item.id;
    }

    // 정확 매칭 실패: hash 없이 filename만으로 시도
    for (var j = 0; j < MENU_ITEMS.length; j++) {
      var item2 = MENU_ITEMS[j];
      // hash가 없는 단순 파일명 메뉴만 비교
      if (item2.href.indexOf('#') < 0 && item2.href === filename) return item2.id;
    }

    return null;
  }

  // ====================================================================
  // 사이드바 HTML 생성
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

  function buildSidebarHtml(activeId) {
    var html = '';
    // 첫 페인트부터 올바른 접힘/펼침 상태로 태어나게 한다.
    // (placeholder가 펼친 너비로 먼저 그려졌다가 접히면서 생기는 width 트랜지션 깜빡임 방지)
    var collapsedClass = getEffectiveCollapsed() ? ' sidebar--collapsed' : '';
    html += '<aside class="sidebar' + collapsedClass + '" id="sidebar" aria-label="메인 메뉴" style="height:100vh;overflow-y:auto">';
    html += '  <div class="sidebar-header">';
    html += '    <button type="button" class="sidebar-toggle" id="sidebar-toggle" aria-label="메뉴 접기/펼치기" title="메뉴 접기/펼치기">☰</button>';
    html += '    <h1 class="sidebar-title">' + escapeHtml(APP_TITLE) + '</h1>';
    html += '  </div>';
    html += '  <nav class="sidebar-nav">';

    // 현재 펼침 상태 (부모별)
    var expandedState = getExpandedState();
    // active한 메뉴의 부모는 자동으로 펼침 상태로 (저장은 하지 않음 — 1회용)
    var activeItem = null;
    for (var ai = 0; ai < MENU_ITEMS.length; ai++) {
      if (MENU_ITEMS[ai].id === activeId) { activeItem = MENU_ITEMS[ai]; break; }
    }
    var autoExpandedParent = (activeItem && activeItem.parent) ? activeItem.parent : null;

    function isParentExpanded(parentId) {
      if (autoExpandedParent === parentId) return true;
      // 기본값: 펼침 (사용자가 한 번도 접지 않았으면 펼침으로 보임)
      if (expandedState[parentId] === false) return false;
      return true;
    }

    var lastGroup = null;
    MENU_ITEMS.forEach(function (item) {
      if (lastGroup !== null && lastGroup !== item.group) {
        html += '    <div class="sidebar-divider" aria-hidden="true"></div>';
      }
      lastGroup = item.group;

      // 부모가 접혀 있으면 자식 항목은 렌더링하되 hidden 클래스 부여
      var isChild = !!item.parent;
      var hiddenClass = '';
      if (isChild && !isParentExpanded(item.parent)) {
        hiddenClass = ' sidebar-link--hidden';
      }

      var activeClass = (item.id === activeId) ? ' active' : '';
      var childClass = isChild ? ' sidebar-link--child' : '';
      var parentClass = item.expandable ? ' sidebar-link--parent' : '';

      html += '    <a href="' + escapeHtml(item.href) + '" class="sidebar-link' + activeClass + childClass + parentClass + hiddenClass + '" id="' + escapeHtml(item.id) + '"' + (isChild ? ' data-parent="' + escapeHtml(item.parent) + '"' : '') + '>';
      html += '<span class="sidebar-link-icon" aria-hidden="true">' + escapeHtml(item.icon) + '</span>';
      html += '<span class="sidebar-link-text">' + escapeHtml(item.label) + '</span>';
      if (item.expandable) {
        var expanded = isParentExpanded(item.id);
        var caret = expanded ? '▾' : '▸';
        html += '<button type="button" class="sidebar-expand-toggle" data-parent="' + escapeHtml(item.id) + '" aria-label="하위 메뉴 펼치기/접기" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + caret + '</button>';
      }
      html += '</a>';
    });

    html += '  </nav>';
    html += '</aside>';
    return html;
  }

  // ====================================================================
  // 사이드바 토글 (접기/펼치기)
  // ====================================================================
  // 상태 우선순위:
  //   1. 사용자가 토글 버튼을 누른 적이 있으면(수동 모드) → 그 상태가 절대 우선
  //   2. 누른 적이 없으면(자동 모드) → 창 너비에 따라 자동 결정
  // ====================================================================

  function applyCollapsedState(collapsed) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (collapsed) {
      sidebar.classList.add('sidebar--collapsed');
      document.body.classList.add('sidebar-collapsed');
    } else {
      sidebar.classList.remove('sidebar--collapsed');
      document.body.classList.remove('sidebar-collapsed');
    }
  }

  /** 사용자가 직접 설정한 상태 ('1' / '0' / null=미설정) */
  function getManualState() {
    try {
      var v = localStorage.getItem(COLLAPSED_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
      return null;
    } catch (e) {
      return null;
    }
  }

  function setManualState(collapsed) {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) {}
  }

  // ====================================================================
  // 부모 메뉴 펼침/접힘 상태
  // ====================================================================
  // localStorage 에 { 'nav-persons-dashboard': true/false } 형태로 저장.
  // 키가 없으면 '펼침'이 기본값.
  // ====================================================================
  function getExpandedState() {
    try {
      var raw = localStorage.getItem(EXPANDED_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function setParentExpanded(parentId, expanded) {
    try {
      var state = getExpandedState();
      state[parentId] = !!expanded;
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  /** 부모 펼침/접힘 토글 — DOM 직접 조작으로 즉시 반영 */
  function toggleParentExpanded(parentId) {
    var state = getExpandedState();
    // 기본값이 펼침이므로, 키가 없거나 true면 접기로, false면 펼치기로
    var currentlyExpanded = (state[parentId] !== false);
    var nextExpanded = !currentlyExpanded;
    setParentExpanded(parentId, nextExpanded);
    applyParentExpanded(parentId, nextExpanded);
  }

  function applyParentExpanded(parentId, expanded) {
    // 자식 메뉴들 표시/숨김
    var children = document.querySelectorAll('.sidebar-link[data-parent="' + parentId + '"]');
    for (var i = 0; i < children.length; i++) {
      if (expanded) {
        children[i].classList.remove('sidebar-link--hidden');
      } else {
        children[i].classList.add('sidebar-link--hidden');
      }
    }
    // 부모의 caret 업데이트
    var caretBtn = document.querySelector('.sidebar-expand-toggle[data-parent="' + parentId + '"]');
    if (caretBtn) {
      caretBtn.textContent = expanded ? '▾' : '▸';
      caretBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  /** 자동 모드일 때 창 너비 기준으로 접힘 여부 결정 */
  function shouldAutoCollapse() {
    return window.innerWidth < AUTO_COLLAPSE_BREAKPOINT;
  }

  /** 현재 적용되어야 할 상태 (수동 우선, 없으면 자동) */
  function getEffectiveCollapsed() {
    var manual = getManualState();
    if (manual !== null) return manual;
    return shouldAutoCollapse();
  }

  /** 토글 버튼 클릭 — 사용자가 명시적으로 결정한 거니까 manual 상태 저장 */
  function toggleCollapsed() {
    var next = !getEffectiveCollapsed();
    setManualState(next);
    applyCollapsedState(next);
  }

  /** 창 크기 변경 시 — 수동 상태가 없을 때만 자동 반응 */
  var _resizeRaf = null;
  function onResize() {
    if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(function () {
      _resizeRaf = null;
      // 수동 모드면 무시
      if (getManualState() !== null) return;
      applyCollapsedState(shouldAutoCollapse());
    });
  }

  function bindToggle() {
    var btn = document.getElementById('sidebar-toggle');
    if (btn) btn.addEventListener('click', toggleCollapsed);
  }

  /** 부모 메뉴의 펼침/접힘 토글 버튼 바인딩 */
  function bindExpandToggles() {
    var btns = document.querySelectorAll('.sidebar-expand-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        // 부모 <a> 의 페이지 이동 막기
        e.preventDefault();
        e.stopPropagation();
        var parentId = this.getAttribute('data-parent');
        if (parentId) toggleParentExpanded(parentId);
      });
    }
  }

  function bindResize() {
    window.addEventListener('resize', onResize, { passive: true });
  }

  // ====================================================================
  // 메인: mount 지점에 사이드바 삽입
  //
  // 두 가지 방식 지원:
  // 1) <div id="sidebar-mount"></div> 가 있으면 → 그 위치에 사이드바 삽입
  // 2) 그게 없으면 기존 <aside class="sidebar"> 를 찾아서 통째로 교체
  //    (구버전 HTML과의 호환성 보장)
  // ====================================================================
  function mountSidebar() {
    var activeId = detectCurrentPage();
    var sidebarHtml = buildSidebarHtml(activeId);

    var mount = document.getElementById('sidebar-mount');
    if (mount) {
      // 방식 1: mount 지점 사용
      mount.outerHTML = sidebarHtml;
    } else {
      // 방식 2: 기존 <aside class="sidebar"> 자동 교체 (구버전 호환)
      var existingSidebar = document.querySelector('aside.sidebar');
      if (existingSidebar) {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = sidebarHtml;
        var newSidebar = wrapper.firstChild;
        if (existingSidebar.parentNode && newSidebar) {
          existingSidebar.parentNode.replaceChild(newSidebar, existingSidebar);
        }
      } else {
        // 사이드바 자체가 없는 페이지 (bulk-upload 등) → 아무것도 안 함
        return;
      }
    }

    // 토글 버튼 이벤트
    bindToggle();

    // 부모 메뉴 펼침/접힘 토글 이벤트
    bindExpandToggles();

    // 창 크기 변경 자동 대응
    bindResize();

    // 초기 상태 적용: 수동 우선, 없으면 자동(창 너비 기준)
    // ※ 사이드바 HTML은 buildSidebarHtml에서 이미 올바른 접힘/펼침 클래스로 생성되므로
    //   여기서는 body 클래스 동기화만 일어나고 width 트랜지션은 발생하지 않는다.
    applyCollapsedState(getEffectiveCollapsed());
  }

  // DOM 준비되면 마운트
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountSidebar);
  } else {
    mountSidebar();
  }

  // 외부 공개 (메뉴를 동적으로 변경하고 싶을 때)
  window.appSidebar = {
    toggle:       toggleCollapsed,
    setCollapsed: function (collapsed) {
      setManualState(collapsed);
      applyCollapsedState(collapsed);
    },
    /** 자동 모드로 리셋 (수동 설정 지움) */
    resetAuto: function () {
      try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) {}
      applyCollapsedState(shouldAutoCollapse());
    },
    isCollapsed: getEffectiveCollapsed
  };

})();

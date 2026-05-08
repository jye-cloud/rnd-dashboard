/**
 * floating-buttons.js
 *
 * 모든 페이지에 자동으로 우측 하단 Floating Action Buttons 추가:
 *   ↑  맨 위로
 *   ↓  맨 아래로
 *   +  과제 등록 (projects.html 에서만 표시)
 *
 * 사용법: 각 페이지의 </body> 직전에 <script src="floating-buttons.js"></script>
 */
(function () {
  'use strict';

  if (window.__floatingButtonsLoaded) return;
  window.__floatingButtonsLoaded = true;

  // 페이지에서 실제 스크롤되는 요소 후보들 모두 반환
  function getScrollTargets() {
    var targets = [window];
    if (document.documentElement) targets.push(document.documentElement);
    if (document.body) targets.push(document.body);
    var selectors = ['.app-container', '.main-content', '.dashboard-main', '.detail-main', 'main', '[role="main"]'];
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) targets.push(el);
    });
    return targets;
  }

  function scrollAllTo(y) {
    getScrollTargets().forEach(function (t) {
      try {
        if (t === window) {
          window.scrollTo({ top: y, behavior: 'smooth' });
        } else if (typeof t.scrollTo === 'function') {
          t.scrollTo({ top: y, behavior: 'smooth' });
        } else {
          t.scrollTop = y;
        }
      } catch (e) {
        try {
          if (t === window) window.scrollTo(0, y);
          else t.scrollTop = y;
        } catch (err) {}
      }
    });
  }

  function scrollToTop() { scrollAllTo(0); }

  function scrollToBottom() {
    var maxH = 0;
    [document.body, document.documentElement].forEach(function (el) {
      if (el && el.scrollHeight > maxH) maxH = el.scrollHeight;
    });
    var selectors = ['.app-container', '.main-content', '.dashboard-main', '.detail-main', 'main', '[role="main"]'];
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && el.scrollHeight > maxH) maxH = el.scrollHeight;
    });
    scrollAllTo(maxH);
  }

  function init() {
    // 1. CSS — 모든 버튼 같은 크기, + 버튼은 색만 다름
    var style = document.createElement('style');
    style.textContent = ''
      + '.fab-buttons {'
      +   'position: fixed;'
      +   'bottom: 1.5rem;'
      +   'right: 1.5rem;'
      +   'display: flex;'
      +   'flex-direction: column;'
      +   'gap: 0.5rem;'
      +   'z-index: 1000;'
      + '}'
      + '.fab-btn {'
      +   'width: 44px;'
      +   'height: 44px;'
      +   'border-radius: 50%;'
      +   'background: #ffffff;'
      +   'border: 1px solid #e5e7eb;'
      +   'box-shadow: 0 2px 8px rgba(0,0,0,0.08);'
      +   'cursor: pointer;'
      +   'display: flex;'
      +   'align-items: center;'
      +   'justify-content: center;'
      +   'font-size: 1.1rem;'
      +   'color: #4b5563;'
      +   'transition: all 0.2s ease;'
      +   'padding: 0;'
      +   'line-height: 1;'
      + '}'
      + '.fab-btn:hover {'
      +   'background: #f3f4f6;'
      +   'transform: translateY(-2px);'
      +   'box-shadow: 0 4px 14px rgba(0,0,0,0.15);'
      + '}'
      + '.fab-btn:active {'
      +   'transform: translateY(0);'
      + '}'
      + '.fab-btn--primary {'
      +   'background: #2563eb;'
      +   'color: #ffffff;'
      +   'border-color: #2563eb;'
      +   'box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);'
      +   'font-size: 1.4rem;'
      +   'font-weight: 300;'
      + '}'
      + '.fab-btn--primary:hover {'
      +   'background: #1d4ed8;'
      +   'border-color: #1d4ed8;'
      +   'box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);'
      + '}'
      + '@media (max-width: 640px) {'
      +   '.fab-buttons { bottom: 1rem; right: 1rem; }'
      + '}'
      ;
    document.head.appendChild(style);

    // 2. 페이지 감지
    var path = (location.pathname || '').toLowerCase();
    var isProjectsPage = /projects\.html$/.test(path) || path.endsWith('/projects');

    // 3. 버튼 컨테이너
    var container = document.createElement('div');
    container.className = 'fab-buttons';
    container.setAttribute('aria-label', '페이지 내비게이션 버튼');

    var html = ''
      + '<button type="button" class="fab-btn" id="fab-scroll-top" title="맨 위로" aria-label="맨 위로">↑</button>'
      + '<button type="button" class="fab-btn" id="fab-scroll-bottom" title="맨 아래로" aria-label="맨 아래로">↓</button>';
    if (isProjectsPage) {
      html += '<button type="button" class="fab-btn fab-btn--primary" id="fab-add-project" title="새 과제 등록" aria-label="새 과제 등록">+</button>';
    }
    container.innerHTML = html;
    document.body.appendChild(container);

    // 4. 이벤트
    var topBtn = document.getElementById('fab-scroll-top');
    if (topBtn) topBtn.addEventListener('click', scrollToTop);

    var bottomBtn = document.getElementById('fab-scroll-bottom');
    if (bottomBtn) bottomBtn.addEventListener('click', scrollToBottom);

    if (isProjectsPage) {
      var addBtn = document.getElementById('fab-add-project');
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          window.location.href = 'project-detail.html';
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
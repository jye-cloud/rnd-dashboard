(function () {
  'use strict';

  var fab = document.getElementById('quick-nav-fab');
  var btnTop = document.getElementById('quick-nav-top');
  var btnBottom = document.getElementById('quick-nav-bottom');

  function getPage() {
    var h = (window.location.hash || '').replace(/^#\/?/, '');
    // HR, 참여율, 인건비 페이지에서만 퀵 이동 버튼 노출
    return (h === 'hr' || h === 'payroll' || h === 'participation') ? h : null;
  }

  function scrollToTop() {
    var main = document.getElementById('main-area');
    if (main && main.scrollHeight > main.clientHeight) {
      main.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function scrollToBottom() {
    var main = document.getElementById('main-area');
    if (main && main.scrollHeight > main.clientHeight) {
      main.scrollTo({ top: main.scrollHeight - main.clientHeight, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight - window.innerHeight, behavior: 'smooth' });
    }
  }

  function updateVisibility() {
    if (!fab || !btnTop || !btnBottom || fab.hidden) return;
    var main = document.getElementById('main-area');
    var st = 0, sh = 0, ch = 0;
    if (main) {
      st = main.scrollTop;
      sh = main.scrollHeight;
      ch = main.clientHeight;
    } else {
      st = window.scrollY || document.documentElement.scrollTop;
      sh = document.documentElement.scrollHeight;
      ch = window.innerHeight;
    }
    var atTop = st <= 80;
    var atBottom = st + ch >= sh - 80;
    var noScroll = sh <= ch + 80;
    if (noScroll) {
      btnTop.hidden = false;
      btnBottom.hidden = false;
    } else {
      btnTop.hidden = atTop;
      btnBottom.hidden = atBottom;
    }
  }

  function showFab() {
    if (!fab) return;
    fab.hidden = !getPage();
    if (!fab.hidden) updateVisibility();
  }

  function init() {
    fab = document.getElementById('quick-nav-fab');
    btnTop = document.getElementById('quick-nav-top');
    btnBottom = document.getElementById('quick-nav-bottom');
    if (!fab || !btnTop || !btnBottom) return;
    showFab();
    updateVisibility();
    window.addEventListener('hashchange', showFab);
    btnTop.addEventListener('click', scrollToTop);
    btnBottom.addEventListener('click', scrollToBottom);
    var main = document.getElementById('main-area');
    window.addEventListener('scroll', updateVisibility, { passive: true });
    if (main) main.addEventListener('scroll', updateVisibility, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

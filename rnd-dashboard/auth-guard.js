/**
 * 인증 가드 (auth-guard.js)
 * - Google 로그인 강제
 * - @60hz.io 도메인 계정만 허용
 * - 모든 페이지에서 firebase-config.js 다음, firestore-service.js 이전에 로드
 */
(function () {
  'use strict';

  var ALLOWED_DOMAIN = '60hz.io';
  var STORAGE_PERSISTENCE = 'local'; // 'local' = 브라우저 닫아도 유지, 'session' = 탭 닫으면 해제

  // Firebase Auth 사용 가능한지 확인
  if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
    console.error('[auth-guard] Firebase Auth SDK가 로드되지 않았습니다. firebase-auth-compat.js 를 확인해 주세요.');
    showFatalError('Firebase 인증 SDK가 로드되지 않았습니다.<br>네트워크 또는 스크립트 순서를 확인해 주세요.');
    return;
  }

  var auth;
  try {
    auth = firebase.auth();
  } catch (e) {
    console.error('[auth-guard] firebase.auth() 호출 실패:', e);
    showFatalError('인증을 초기화할 수 없습니다. Firebase 설정을 확인해 주세요.');
    return;
  }

  // 로그인 상태 유지 방식 설정 (브라우저 닫아도 유지)
  try {
    auth.setPersistence(firebase.auth.Auth.Persistence[STORAGE_PERSISTENCE.toUpperCase()]);
  } catch (e) {
    // 일부 브라우저(시크릿 모드)에서 실패할 수 있음 - 무시
  }

  // 가드 스타일 주입
  injectGuardStyles();

  // 인증 상태 감지
  auth.onAuthStateChanged(function (user) {
    if (user && user.email && user.email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      // 인증 통과 — 페이지 표시
      grantAccess(user);
    } else {
      if (user) {
        // 잘못된 도메인으로 로그인된 상태 → 즉시 로그아웃
        var wrongEmail = user.email || '';
        auth.signOut().then(function () {
          showSignInModal('@' + ALLOWED_DOMAIN + ' 도메인 계정만 접근 가능합니다.<br>현재 계정: ' + escapeHtml(wrongEmail));
        });
      } else {
        // 로그인 안 된 상태
        showSignInModal();
      }
    }
  });

  // ===== 인증 통과 처리 =====
  function grantAccess(user) {
    var overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.remove();
    document.documentElement.classList.add('auth-bypass');
    document.body.classList.add('body-ready');

    // 다른 스크립트에서 활용 가능하게 사용자 정보 노출
    window.currentUser = {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.email.split('@')[0],
      photoURL: user.photoURL || null
    };

    // 사용자 정보 변경 이벤트 발행 (선택적 활용)
    try {
      window.dispatchEvent(new CustomEvent('auth:ready', { detail: window.currentUser }));
    } catch (e) {}

    // 사이드바에 사용자 정보 표시 (있으면)
    decorateSidebarWithUser();
  }

  // ===== Google 로그인 시작 =====
  function signInWithGoogle() {
    clearError();

    var provider = new firebase.auth.GoogleAuthProvider();
    // hd 힌트: 사용자에게 60hz.io 계정 선택을 유도 (보안 검증은 onAuthStateChanged 에서 한 번 더)
    provider.setCustomParameters({
      hd: ALLOWED_DOMAIN,
      prompt: 'select_account'
    });

    var btn = document.getElementById('auth-google-signin');
    if (btn) { btn.disabled = true; btn.textContent = '로그인 중…'; }

    auth.signInWithPopup(provider)
      .then(function (result) {
        var email = (result.user && result.user.email) || '';
        if (!email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
          showError('@' + ALLOWED_DOMAIN + ' 도메인 계정만 접근 가능합니다.<br>현재 계정: ' + escapeHtml(email));
          return auth.signOut();
        }
        // 통과 — onAuthStateChanged 가 후속 처리
      })
      .catch(function (err) {
        if (!err) return;
        if (err.code === 'auth/popup-closed-by-user' ||
            err.code === 'auth/cancelled-popup-request' ||
            err.code === 'auth/user-cancelled') {
          // 사용자 취소 — 에러 표시 안 함
          resetButton();
          return;
        }
        if (err.code === 'auth/popup-blocked') {
          showError('팝업이 차단되었습니다. 브라우저의 팝업 차단을 해제해 주세요.');
        } else if (err.code === 'auth/unauthorized-domain') {
          showError('이 도메인은 Firebase에 등록되지 않았습니다. 관리자에게 문의해 주세요.<br>(Firebase Console → Authentication → Settings → Authorized domains)');
        } else {
          showError('로그인에 실패했습니다: ' + escapeHtml(err.message || err.code || '알 수 없는 오류'));
        }
        console.error('[auth-guard] 로그인 에러:', err);
        resetButton();
      });
  }

  function resetButton() {
    var btn = document.getElementById('auth-google-signin');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="auth-google-icon" aria-hidden="true">G</span>Google 계정으로 로그인';
    }
  }

  // ===== 로그인 모달 표시 =====
  function showSignInModal(errorHtml) {
    if (!document.body) {
      // body 가 아직 없으면 DOMContentLoaded 후 다시 시도
      document.addEventListener('DOMContentLoaded', function () { showSignInModal(errorHtml); });
      return;
    }

    document.body.classList.add('body-ready');

    var overlay = document.getElementById('auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-overlay';
      overlay.className = 'auth-overlay';
      overlay.setAttribute('aria-label', 'Google 로그인');
      overlay.innerHTML =
        '<div class="auth-modal">' +
          '<div class="auth-modal-logo">CI_R&amp;DM</div>' +
          '<p class="auth-modal-title">접속하려면 60hz.io Google 계정으로<br>로그인해 주세요</p>' +
          '<button type="button" class="auth-google-btn" id="auth-google-signin">' +
            '<span class="auth-google-icon" aria-hidden="true">G</span>' +
            'Google 계정으로 로그인' +
          '</button>' +
          '<p id="auth-error" class="auth-error" role="alert"></p>' +
        '</div>';
      document.body.appendChild(overlay);

      var btn = document.getElementById('auth-google-signin');
      if (btn) btn.addEventListener('click', signInWithGoogle);
    }

    if (errorHtml) showError(errorHtml);
  }

  // ===== 치명적 오류 (Firebase 자체가 안 됨) =====
  function showFatalError(htmlMsg) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { showFatalError(htmlMsg); });
      return;
    }
    document.body.classList.add('body-ready');
    var overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML =
      '<div class="auth-modal">' +
        '<div class="auth-modal-logo" style="color:#ef4444">⚠ 오류</div>' +
        '<p class="auth-modal-title">' + htmlMsg + '</p>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function showError(htmlMsg) {
    var el = document.getElementById('auth-error');
    if (el) {
      el.innerHTML = htmlMsg;
      el.classList.add('visible');
    }
  }

  function clearError() {
    var el = document.getElementById('auth-error');
    if (el) {
      el.innerHTML = '';
      el.classList.remove('visible');
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ===== 사이드바에 사용자 정보 표시 (선택적) =====
  function decorateSidebarWithUser() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar || !window.currentUser) return;
    if (sidebar.querySelector('.sidebar-user')) return; // 이미 있음

    var userBlock = document.createElement('div');
    userBlock.className = 'sidebar-user';
    userBlock.innerHTML =
      '<div class="sidebar-user-info">' +
        '<div class="sidebar-user-name" title="' + escapeHtml(window.currentUser.email) + '">' +
          escapeHtml(window.currentUser.name) +
        '</div>' +
        '<div class="sidebar-user-email">' + escapeHtml(window.currentUser.email) + '</div>' +
      '</div>' +
      '<button type="button" class="sidebar-logout-btn" title="로그아웃">⏻</button>';
    sidebar.appendChild(userBlock);

    var logoutBtn = userBlock.querySelector('.sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        if (confirm('로그아웃 하시겠습니까?')) {
          window.signOutUser();
        }
      });
    }
  }

  // ===== 가드 전용 스타일 =====
  function injectGuardStyles() {
    if (document.getElementById('auth-guard-styles')) return;
    var style = document.createElement('style');
    style.id = 'auth-guard-styles';
    style.textContent =
      '.auth-google-btn {' +
      '  display: inline-flex; align-items: center; justify-content: center;' +
      '  gap: 0.6rem; width: 100%; margin-top: 1rem;' +
      '  padding: 0.75rem 1rem; background: #fff; color: #1f2937;' +
      '  border: 1px solid #d1d5db; border-radius: 0.5rem;' +
      '  font-size: 1rem; font-weight: 600; cursor: pointer; font-family: inherit;' +
      '  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;' +
      '}' +
      '.auth-google-btn:hover:not(:disabled) {' +
      '  background: #f9fafb; border-color: #9ca3af;' +
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.05);' +
      '}' +
      '.auth-google-btn:disabled { opacity: 0.6; cursor: wait; }' +
      '.auth-google-icon {' +
      '  display: inline-flex; align-items: center; justify-content: center;' +
      '  width: 22px; height: 22px; border-radius: 50%;' +
      '  background: linear-gradient(135deg, #4285F4 0%, #EA4335 33%, #FBBC04 66%, #34A853 100%);' +
      '  color: #fff; font-weight: 700; font-size: 0.9rem; line-height: 1; font-family: Arial, sans-serif;' +
      '}' +
      '.sidebar-user {' +
      '  margin-top: auto; padding: 1rem 0.75rem; border-top: 1px solid rgba(148,163,184,0.2);' +
      '  display: flex; align-items: center; gap: 0.5rem;' +
      '}' +
      '.sidebar-user-info { flex: 1; min-width: 0; overflow: hidden; }' +
      '.sidebar-user-name {' +
      '  font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #1f2937);' +
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' +
      '}' +
      '.sidebar-user-email {' +
      '  font-size: 0.7rem; color: var(--text-secondary, #6b7280);' +
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' +
      '}' +
      '.sidebar-logout-btn {' +
      '  flex-shrink: 0; background: transparent; border: 1px solid rgba(148,163,184,0.3);' +
      '  color: var(--text-secondary, #6b7280); cursor: pointer; padding: 0.4rem 0.55rem;' +
      '  border-radius: 0.4rem; font-size: 0.95rem; line-height: 1; transition: all 0.15s;' +
      '}' +
      '.sidebar-logout-btn:hover {' +
      '  background: #fee2e2; color: #dc2626; border-color: #fca5a5;' +
      '}' +
      '.sidebar.sidebar--collapsed .sidebar-user-info { display: none; }' +
      '';
    document.head.appendChild(style);
  }

  // ===== 전역 로그아웃 함수 =====
  window.signOutUser = function () {
    auth.signOut().then(function () {
      window.location.reload();
    });
  };

})();

/**
 * Firebase + Firestore 초기화
 *
 * - firebase-config.js 의 window.firebaseConfig 를 사용해서 앱을 초기화
 * - Firestore 인스턴스를 window.__firebaseDb 에 노출
 * - 성공 여부를 window.__firebaseConfigured (boolean) 에 노출
 *
 * 이 두 글로벌 변수는 firestore-service.js 가 사용합니다.
 */
(function () {
  'use strict';

  // 1. Firebase SDK 로드 확인
  if (typeof firebase === 'undefined') {
    console.error('[firebase.js] Firebase SDK 가 로드되지 않았습니다. <script src="https://www.gstatic.com/firebasejs/..."> 태그가 firebase.js 보다 먼저 와야 합니다.');
    window.__firebaseConfigured = false;
    return;
  }

  // 2. 설정값 확인
  if (!window.firebaseConfig) {
    console.error('[firebase.js] window.firebaseConfig 가 없습니다. firebase-config.js 가 firebase.js 보다 먼저 로드되어야 합니다.');
    window.__firebaseConfigured = false;
    return;
  }

  // 3. 앱 초기화 (이미 초기화되어 있으면 재사용)
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }
  } catch (e) {
    console.error('[firebase.js] firebase.initializeApp 실패:', e);
    window.__firebaseConfigured = false;
    return;
  }

  // 4. Firestore 인스턴스 생성
  try {
    window.__firebaseDb = firebase.firestore();
    window.__firebaseConfigured = true;
    console.log('[firebase.js] Firestore 초기화 완료 (project: ' + window.firebaseConfig.projectId + ')');
  } catch (e) {
    console.error('[firebase.js] firebase.firestore() 실패:', e);
    window.__firebaseConfigured = false;
  }
})();

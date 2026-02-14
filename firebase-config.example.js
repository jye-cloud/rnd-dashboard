/**
 * Firebase 설정 예시 파일
 * 1. 이 파일을 복사하여 firebase-config.js 를 만드세요.
 * 2. Firebase 콘솔(https://console.firebase.google.com) > 프로젝트 설정 > 일반 > 내 앱
 *    에서 SDK 설정 및 구성 값을 복사해 아래에 채워 넣으세요.
 * 3. firebase-config.js 는 .gitignore 에 포함되어 있으므로 저장소에 올라가지 않습니다.
 */
(function () {
  'use strict';
  window.__FIREBASE_CONFIG__ = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID'
  };
})();

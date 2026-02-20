/**
 * Firebase 앱 초기화 및 Firestore 인스턴스
 * firebase-config.js 로 덮어쓰지 않으면 아래 설정값을 사용합니다.
 */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey: 'AIzaSyB-ZirIyOYC4ljWkc7Y1GRxvr0MmVIIep8',
    authDomain: 'rnd-dashboard-3f7eb.firebaseapp.com',
    projectId: 'rnd-dashboard-3f7eb',
    storageBucket: 'rnd-dashboard-3f7eb.appspot.com',
    messagingSenderId: '135751414699',
    appId: '1:135751414699:web:b94038f244c95e76ff58ee'
  };

  var external = typeof window !== 'undefined' && window.__FIREBASE_CONFIG__;
  var isExternalPlaceholder = external && (external.apiKey === 'YOUR_API_KEY' || external.projectId === 'YOUR_PROJECT_ID');
  var config = (external && !isExternalPlaceholder) ? external : firebaseConfig;
  var app = null;
  var db = null;
  var isPlaceholder = config && (config.apiKey === 'YOUR_API_KEY' || config.projectId === 'YOUR_PROJECT_ID');

  if (config && !isPlaceholder && typeof firebase !== 'undefined') {
    try {
      app = firebase.initializeApp(config);
      db = firebase.firestore();
    } catch (e) {
      console.error('Firebase 초기화 실패:', e);
    }
  } else {
    if (!config) console.warn('Firebase 설정이 없습니다.');
    if (typeof firebase === 'undefined') console.warn('Firebase SDK가 로드되지 않았습니다.');
  }

  window.__firebaseApp = app;
  window.__firebaseDb = db;
  window.__firebaseConfigured = !!db;
})();

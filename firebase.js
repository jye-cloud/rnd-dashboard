/**
 * Firebase 설정 (RND-2026 프로젝트)
 *
 * 주의: apiKey 등은 클라이언트에서 노출되어도 보안상 문제 없습니다.
 *      실제 보안은 Firestore 보안 규칙과 Authentication에서 담당합니다.
 */
window.firebaseConfig = {
  apiKey: "AIzaSyAmBSJjXDbkoYwg8VAoWJTa0764kUdFgbw",
  authDomain: "rnd-2026-d8fb4.firebaseapp.com",
  projectId: "rnd-2026-d8fb4",
  storageBucket: "rnd-2026-d8fb4.firebasestorage.app",
  messagingSenderId: "101672661761",
  appId: "1:101672661761:web:f606216679e96f342ae100"
};
 
// 설정만 노출하고, 초기화는 firebase.js에 맡깁니다.
// (이 파일이 firebase.initializeApp을 직접 호출하면 firebase.js의 초기화와 충돌합니다.)

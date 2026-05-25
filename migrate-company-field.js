/* ============================================================
   기존 프로젝트의 company 필드 일괄 설정 마이그레이션
   ─────────────────────────────────────────────
   사용법:
     1. 인건비 대시보드 또는 과제 관리 페이지 열기 (Firestore 인증된 상태)
     2. 브라우저 개발자 도구 (F12) → Console 탭
     3. 아래 코드 전체 복사해서 붙여넣기 → Enter
     4. 미리보기 확인 후 확인 메시지에 OK 누르면 일괄 저장
   ─────────────────────────────────────────────
   동작:
     - 모든 projects 중 company 필드가 비어있는(또는 없는) 항목을 찾음
     - 전부 '식스티' 로 설정
     - 이미 company 필드가 있는 항목은 건너뜀
   ─────────────────────────────────────────────
*/
(async function migrateCompanyField() {
  var DEFAULT_COMPANY = '식스티';

  var svc = window.firestoreService;
  if (!svc || typeof svc.getProjectsData !== 'function' || typeof svc.saveProjects !== 'function') {
    alert('firestoreService 가 준비되지 않았어요. 페이지가 완전히 로드된 후 다시 시도하세요.');
    return;
  }

  var items = svc.getProjectsData() || [];
  if (!Array.isArray(items) || !items.length) {
    alert('프로젝트가 없습니다.');
    return;
  }

  // 변경 대상 추리기
  var targets = items.filter(function (p) {
    return !p.company || String(p.company).trim() === '';
  });

  console.log('─── 마이그레이션 미리보기 ───');
  console.log('전체 프로젝트:', items.length);
  console.log('company 설정 필요:', targets.length);
  console.log('이미 설정됨:', items.length - targets.length);

  if (!targets.length) {
    alert('모든 프로젝트가 이미 company 필드를 가지고 있어요. 마이그레이션 불필요.');
    return;
  }

  console.log('변경 대상 목록:');
  targets.forEach(function (p, i) {
    console.log('  ' + (i + 1) + '.', p.keywords || p.projectName || p.id);
  });

  if (!confirm(targets.length + '개 프로젝트의 company를 "' + DEFAULT_COMPANY + '"로 일괄 설정합니다.\n계속하시겠습니까?')) {
    console.log('취소되었습니다.');
    return;
  }

  // 모든 items에서 대상만 company 채워서 새 배열 생성
  var updated = items.map(function (p) {
    if (!p.company || String(p.company).trim() === '') {
      return Object.assign({}, p, { company: DEFAULT_COMPANY });
    }
    return p;
  });

  try {
    await svc.saveProjects(updated);
    alert('✅ ' + targets.length + '개 프로젝트의 company가 "' + DEFAULT_COMPANY + '"로 설정되었습니다.');
    console.log('✓ 저장 완료');
  } catch (err) {
    console.error('저장 실패:', err);
    alert('❌ 저장 중 오류가 발생했어요. 콘솔 확인.');
  }
})();

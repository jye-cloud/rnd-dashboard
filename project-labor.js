/**
 * project-labor.js — v5 Phase A Step 3 적용 (월 접기/펼치기 인터랙션)
 *
 * 구현 범위:
 *  - projects 컬렉션에서 해당 연도 수행 과제 실시간 구독
 *  - persons 컬렉션에서 인력 목록 실시간 구독
 *  - projectLabor 컬렉션에서 인건비 데이터 로드/저장
 *    · 문서 ID: {projectId}_planned / {projectId}_actual / {projectId}_meta
 *    · planned/actual: { cells: { [key]: { rate, cash, inkind, memo } } }
 *    · meta: { meta: { [ym]: { confirmed, confirmedAt, paid, paidAt } },     // v5.2: paid/paidAt 추가
 *              personIds: [...],
 *              personRoles: { [pid]: { newOrExisting, cashOrInkind, subRole } }
 *            }
 *  - projectBudget 컬렉션에서 연차별 예산 로드 (sticky 박스용, 읽기 전용)
 *    · 문서 ID: {projectId}_year{N}  (N = projects.yearBudgets 배열의 인덱스+1)
 *  - 셀 변경 시 debounce 300ms 후 자동 저장
 *
 * v5 Step 1 변경사항 (UI 변경 없음, 데이터 모델만 보강):
 *  ✓ state.personRoles 추가
 *  ✓ loadLaborData: personRoles 읽기 + migratePersonRoles() 자동 호출
 *  ✓ saveLaborData: personRoles 저장
 *  ✓ onMetaCheck: sysRegAt/amtConfAt 일자 자동 기록 (체크/해제 시)
 *  ✓ addPersonToProject: personRoles 기본값 부여
 *  ✓ removePersonFromProject: personRoles는 보존 (다시 추가 시 분류 유지)
 *
 * v5 Step 2 변경사항 (12개월 펼치기 + 우측 sticky 박스):
 *  ✓ state.viewMode ('all12' | 'quarter'), 프로젝트별 localStorage 저장
 *  ✓ state.yearBudget 캐시 (projectBudget 컬렉션에서 현재 연도 예산 로드)
 *  ✓ getVisibleMonths() — viewMode에 따라 12개월 or 3개월 반환
 *  ✓ getYearIndexForState() — state.year ↔ yearBudgets 배열 인덱스 매핑
 *  ✓ 예산/누계/차액 헬퍼 재작성 (항목별 분해: cash / selfCash / inkind / total)
 *      · getBudgetBreakdown / getCumulativeBreakdown / getRemainingBreakdown
 *      · selfCash는 셀 스키마에 없어 0 고정 (§6.1 v5 미반영)
 *  ✓ renderViewModeToggle / renderQuarterNavVisibility / renderStickyBoxes
 *  ✓ 셀 변경 / 탭 전환 / 연도 변경 시 sticky 박스 즉시 갱신
 *
 * v5 Step 3 변경사항 (월 접기/펼치기 인터랙션):
 *  ✓ state.collapsedMonths (Set) — 현 프로젝트·연도의 명시적 접힘 캐시
 *  ✓ localStorage 헬퍼: rnd-pl-collapsed-months-{projectId}-{year}
 *  ✓ isMonthCollapsed(month) — 명시적 접힘 OR (분기 모드 AND 현 분기 외)
 *      · state에는 박지 않고 렌더 시 합쳐서 판정 (§4 Phase A.5)
 *  ✓ 월 헤더 클릭으로 접기/펼치기 토글 (체크박스 영역 제외)
 *  ✓ 접힌 컬럼: 폭 ~26px, 가로쓰기 월번호, 회색 배경, body/footer 단일 셀
 *  ✓ "모두 펼치기" 버튼 — 명시적 접힘이 1개 이상일 때만 노출, 카운트 뱃지 포함
 *  ✓ 12개월 모드 / 분기 모드 / 환급 없음 모드 / compare 탭 모두 대응
 *
 * v5.1 Step 3.5 변경사항 (사용자 피드백 반영, Step 4 진입 전 정리):
 *  ✓ 검수 메타 재구성: sysReg/amtConf 2개 체크박스 → "이 월 확정" 버튼 1개
 *      · meta[ym] 스키마: {confirmed, confirmedAt} (기존 sysReg/amtConf 자동 마이그레이션)
 *      · 클릭 시 confirm 다이얼로그 → 예상값 → 실제값 복사
 *      · 예상 탭: 확정 버튼 / 실제 탭: ✓ 확정 뱃지 / 비교 탭: 표시 없음
 *  ✓ 비교 탭 컬럼 축소: 한 월 5컬럼(예상%·예상현금·실제%·실제현금·차이) → 2컬럼(% / 현금)
 *      · 각 행이 자기 값만 표시 (예상행=예상값, 실제행=실제값, 차이행=차이)
 *      · 이름 칸 옆에 행 타입 라벨 [예상]/[실제]/[차이] 표시 (시각적 가시성)
 *      · 비교 탭의 두 번째 고정 컬럼은 "월급" 대신 "구분" (행 타입 라벨)
 *  ✓ 비교 탭 금액 표시: fmtMoney (84만) → fmtMoneyFull (840,000)
 *
 * v5.1 Step 4 변경사항 (인력 분류 드롭다운 + UI 다듬기):
 *  ✓ 인력 셀에 personRoles 인라인 컨트롤 추가
 *      · 이름·뱃지 줄 아래에 [기존/신규][현금/현물] 셀렉트 2개
 *      · '신규' 선택 시 ↳ subRole 자유 텍스트 입력란 추가 노출
 *      · 변경 즉시 state.personRoles 갱신 + scheduleSave(debounce 300ms)
 *      · newOrExisting 토글 시 해당 셀만 부분 재렌더 (subRole show/hide)
 *  ✓ 자동계산 분기 — personRoles.cashOrInkind 에 따라
 *      · '현금' → cash 필드에 (월급×참여율) 자동 채움 (기존 동작)
 *      · '현물' → inkind 필드에 자동 채움 (v5 Step 4 신규)
 *      · onCellInput / 일괄 자동 계산 / undoLastCell 모두 동일 분기 적용
 *  ✓ 컬럼 폭 재조정 (사용자 피드백 #2 — 월급 잘림)
 *      · col-name 115→175, col-salary 82→105, col-cash 78→92, col-inkind 60→88
 *      · 콤마 들어간 금액과 두 줄 드롭다운을 위한 여유 폭
 *  ✓ 셀 input 포맷팅 (사용자 피드백 #3·#4)
 *      · type=number → type=text + inputMode=numeric (콤마/% 표시 가능)
 *      · dataset.raw가 진실의 원천, input.value는 표시용
 *      · focus → raw 숫자로 전환 (편집 편의), blur → 콤마/% 포맷으로 복원
 *      · 참여율: '10%' / 현금·현물: '837,533' / 우측 정렬
 *      · parseCellNumber / fmtCellRateDisplay / fmtCellMoneyDisplay 헬퍼 추가
 *      · _cellOrigin·undoLastCell·Esc·Ctrl+V 모두 raw 기준으로 재정비
 *  ✓ 비교 탭 차이행에 현물 컬럼 복구 (사용자 피드백 #1)
 *      · v5.1 Step 3.5에서 5→2로 줄였던 비교 탭을 2→3으로 (환급 있을 때)
 *      · 환급 없는 과제는 1컬럼(% 만) 유지
 *  ✓ 자동계산 목적지 = personRoles.cashOrInkind (사용자 피드백 #5)
 *      · "현금으로 선택해두면 현금, 현물로 선택해두면 현물"
 *
 * v5.1 Step 4 후속 패치 (사용자 피드백 #1~#3):
 *  ✓ 인력 분류 드롭다운 색 분리 — 선택값별 modifier 클래스 (피드백 #1)
 *      · 기존=슬레이트 회색 / 신규=인디고 보라
 *      · 현금=그린 / 현물=앰버 주황
 *      · is-existing / is-new / is-cash / is-inkind 동적 부여, 화살표 색도 맞춤
 *  ✓ "이 월 확정" → "확정" 버튼 라벨 축소 (피드백 #2)
 *  ✓ ⚠️ personRoles 탭 간 동기화 버그 수정 (피드백 #3)
 *      · 원인: switchTab은 buildTable을 재호출하지 않음 (페이지 로드 시 만든 DOM 유지)
 *        → onRoleChange의 부분 재렌더가 한 탭에만 적용되어 다른 탭은 stale 상태
 *      · 해결: onRoleChange는 renderAll() 호출 (드롭다운 변경은 포커스 유지 불필요)
 *              onSubRoleInput은 포커스 유지 필요 → 다른 탭의 같은 input만 value 동기화
 *
 * v5.2 Step 4.5 변경사항 (지급 완료 메타 + UX 보강):
 *  ✓ meta[ym] 스키마 확장: { paid: bool, paidAt: 'YYYY-MM-DD' }
 *      · 확정과 별개 단계. 확정된 월에만 지급 완료 가능 (실제 탭 한정).
 *      · 지급일은 사용자 입력 (기본값 = 오늘 ISO date).
 *      · 마이그레이션 불필요 (없으면 paid: false로 간주).
 *  ✓ 시각 표식: 확정 청록 뱃지 + 지급 에메랄드 뱃지 (둘 다일 때 나란히)
 *      · 기존 확정 뱃지 초록 → 청록(cyan)으로 색 분리
 *      · 지급 뱃지는 짙은 에메랄드 — 옅은 현금 셀렉트(연초록)와 위계 분리
 *  ✓ onPaidMonthClick / paidMonth() 신설
 *      · 미지급 + 확정됨: 지급일 prompt → 저장
 *      · 이미 지급됨: 수정 ↔ 취소 두 번 confirm 체이닝
 *      · 확정 안 된 월: 버튼 미노출 (UI 단순화)
 *      · 재확정 시 paid도 함께 풀림 (정합성)
 *  ✓ 인력 행 hover 시 ✕ 삭제 버튼 (테스트 편의)
 *      · 기존 removePersonFromProject 재사용, 모달 안 거치고 직접 삭제
 *
 * v5.2 Step 4.6 변경사항 (가로 채우기 — 1월→12월 일괄 입력):
 *  ✓ 예상 탭 참여율 셀: 우클릭 메뉴 "이 월부터 12월까지 참여율 채우기"
 *  ✓ Ctrl+R 단축키 (참여율 셀 포커스 중)
 *  ✓ fillRateToYearEnd(personId, fromYm): 현재 셀 → 12월까지 rate 덮어쓰기
 *      · 각 월의 cash/inkind는 monthlySalary × rate 로 재계산 (personRoles.cashOrInkind 분기)
 *      · 묶음 undo entry — 한 번 Ctrl+Z로 전체 복원
 *      · Toast "N개 월 채움"
 *      · 예상 탭에서만 동작 (실제 탭은 메뉴 노출 안 함)
 *  ✓ 확정 취소 동작 (사용자 피드백):
 *      · 기존: 확정된 월 재클릭 = 재확정(예상→실제 덮어쓰기)
 *      · 변경: 확정된 월 재클릭 = 확정 취소 (실제 탭 해당 월 셀 전부 삭제 + paid도 풀림)
 *      · 명시적 confirm 다이얼로그 (대상 인력 수 표시)
 *      · unconfirmMonth() 함수 신설
 *  ✓ 인력 추가 모달 — 퇴사자 포함 토글 (사용자 피드백):
 *      · 기본은 재직자만 (status !== 'exited')
 *      · "퇴사자도 표시" 체크박스 → 토글 시 퇴사자도 후보 노출
 *      · 퇴사자 행은 옅게(opacity 0.7) + 퇴사 뱃지로 시각 구분
 *      · 모달 열 때마다 false로 초기화 (안전한 기본값)
 *  ✓ 인력 추가 모달 — 점프 방지 (버그 수정):
 *      · 기존: 추가하면 상단 "이미 추가된" 섹션이 새 행으로 늘어나 하단 리스트가
 *        밀려 올라가서, 연속 클릭 시 의도치 않게 다른 행의 [제거] 버튼이 눌리는 버그
 *      · 해결: 모달 열 때 personIds 스냅샷 찍어두고, 상단 섹션의 행 구성을 그 스냅샷으로 고정.
 *        추가/제거해도 상단 행 개수 안 변함 → 모달 높이 일정 → 점프 없음.
 *      · 모달 세션 중 제거한 인력은 옅게 + [제거됨] 비활성 버튼으로 표시 (상태 명확화)
 *  ✓ 인력 추가 모달 — 일괄 추가 (사용자 피드백):
 *      · 기존: 행마다 [+ 추가] 버튼 → 한 명씩만
 *      · 변경: 체크박스 + 행 클릭으로 다중 선택 → 하단 sticky 바의 [+ N명 추가] 클릭
 *      · _modalSelectedIds 별도 상태로 검색/필터 변경 시에도 선택 유지
 *      · bulkAddSelectedPersons() / clearBulkSelection() / renderBulkBar() 신설
 *  ✓ 월급 오버라이드 (과제별, 사용자 피드백):
 *      · 정부 R&D 과제마다 연봉 갱신 시점 차이로 인력 마스터와 다른 월급을 써야 하는 경우
 *      · personRoles[pid].monthlySalaryOverride 필드 추가 (null = 마스터값 사용)
 *      · 예상 탭의 월급 셀이 input으로 — 클릭/포커스해서 수정 가능 (실제/비교 탭은 read-only)
 *      · getEffectiveMonthlySalary(person) 헬퍼 — 자동계산·가로채우기·일괄계산·undo 등 5군데 사용처 일괄 교체
 *      · 변경 시: 그 인력의 모든 예상 cells cash/inkind 자동 재계산 + 묶음 undo entry
 *      · 빈 값 입력 = override 해제 (마스터 값 복원)
 *      · 오버라이드 적용 중인 셀은 파란색 강조 (is-override / .pl-salary-cell--override)
 *      · 한계: 1년 내내 단일 값. 연 중간 변경 미지원 (추후 monthlySalaryOverride를 객체로 확장 가능)
 *  ✓ 인력 추가 모달 — "이미 추가된 인력" 섹션 기본 접힘:
 *      · 추가된 인원수만 카운트 칩으로 노출 → 필요할 때만 펼쳐서 [제거] 가능
 *      · 모달 세로 공간 절약 + 점프 방지 효과 강화
 *
 * 다음 단계 (Step 5):
 *  - 셀 메모 UI (빨간 점, 노란 배경, hover 툴팁, 클릭 시 메모 입력 팝오버)
 */
(function () {
  'use strict';

  // ====================================================================
  // 상태
  // ====================================================================
  var _allProjects      = [];  // Firestore projects 전체
  var _filteredProjects = [];  // 연도 필터 후
  var _allPersons       = [];  // Firestore persons 전체

  // ====================================================================
  // 회사 필터 — 모든 인건비 페이지에서 공유 (localStorage)
  // ====================================================================
  var COMPANY_FILTER_KEY = 'rnd-company-filter';
  function loadCompanyFilter() {
    try {
      var v = localStorage.getItem(COMPANY_FILTER_KEY) || '';
      // 유효성 체크: 빈 문자열(전체) 또는 셋 중 하나
      if (v === '' || v === '식스티' || v === '굿뉴스' || v === '패리티') return v;
      return '';
    } catch (e) { return ''; }
  }
  function saveCompanyFilter(c) {
    try { localStorage.setItem(COMPANY_FILTER_KEY, c || ''); } catch (e) {}
  }

  // v5 Step 2: viewMode localStorage (프로젝트별 분리)
  function viewModeKey(projectId) {
    return 'rnd-pl-view-mode-' + (projectId || 'default');
  }
  function loadViewMode(projectId) {
    try {
      var v = localStorage.getItem(viewModeKey(projectId));
      return (v === 'quarter' || v === 'all12') ? v : 'all12';
    } catch (e) { return 'all12'; }
  }
  function saveViewMode(projectId, mode) {
    try { localStorage.setItem(viewModeKey(projectId), mode); } catch (e) {}
  }

  // v5 Step 3: 월 접기 상태 localStorage (프로젝트·연도별 분리)
  // 값: 접힌 월(1~12) 배열의 JSON. 예: "[1,2,3,9,10,11,12]"
  // 분기 모드의 자동 접힘은 여기 저장하지 않음 — 렌더 시점에 합쳐서 판정 (§4 Phase A.5)
  function collapsedMonthsKey(projectId, year) {
    return 'rnd-pl-collapsed-months-' + (projectId || 'default') + '-' + year;
  }
  function loadCollapsedMonths(projectId, year) {
    try {
      var raw = localStorage.getItem(collapsedMonthsKey(projectId, year));
      if (!raw) return new Set();
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      // 1~12 정수만 받아들임 (스키마 안전성)
      var clean = arr.filter(function (m) { return Number.isInteger(m) && m >= 1 && m <= 12; });
      return new Set(clean);
    } catch (e) { return new Set(); }
  }
  function saveCollapsedMonths(projectId, year, set) {
    try {
      var arr = Array.from(set).sort(function (a, b) { return a - b; });
      localStorage.setItem(collapsedMonthsKey(projectId, year), JSON.stringify(arr));
    } catch (e) {}
  }

  var state = {
    projectId:  '',
    year:       new Date().getFullYear(),
    quarter:    Math.ceil((new Date().getMonth() + 1) / 3),
    company:    loadCompanyFilter(),  // '' (전체) | '식스티' | '굿뉴스' | '패리티'
    activeTab:  'planned',
    planned:    {},   // { [key]: { rate, cash, inkind, memo } }
    actual:     {},
    meta:       {},   // { [ym]: { sysReg, amtConf, sysRegAt, amtConfAt } }  ← v5: sysRegAt/amtConfAt 추가
    // 이 프로젝트에 배정된 personId 목록 (순서 포함)
    personIds:  [],
    // v5 신규: 인력의 과제 내 역할 분류
    // { [personId]: { newOrExisting: '기존'|'신규', cashOrInkind: '현금'|'현물', subRole: string } }
    personRoles: {},

    // v5 Step 2 신규: 화면 모드
    // 'all12' = 1~12월 모두 노출 (기본)
    // 'quarter' = 현재 분기 3개월만 펼치고 나머지 9개월 자동 접힘
    viewMode: 'all12',

    // v5 Step 2 신규: 현재 프로젝트·연도의 예산 캐시 (projectBudget 컬렉션에서 로드)
    // null = 아직 로드 전 / 없음
    yearBudget: null,    // { yearIndex, budgetCash, budgetSelfCash, budgetInkind, period }

    // v5 Step 3 신규: 현재 프로젝트·연도의 명시적 접힘 월 캐시 (Set<number>, 1~12)
    // localStorage에서 매번 읽지 않고 캐시로 두되, 프로젝트/연도 변경 시 즉시 재로드.
    // 분기 모드 자동 접힘은 여기에 저장하지 않음 — isMonthCollapsed()에서 합쳐 판정.
    collapsedMonths: new Set(),

    loading:    false,
    saveTimer:  null,
  };

  // ====================================================================
  // Firestore 컬렉션 참조
  // ====================================================================
  var LABOR_COLL  = 'projectLabor';
  var BUDGET_COLL = 'projectBudget';   // v5: 예산총액 sticky 박스용
  var SNAP_COLL   = 'projectLaborSnapshots';  // v7.4.4 §4.2: 예상 계획 스냅샷 (1 문서 = 1 스냅샷)

  function db() {
    return window.__firebaseDb;
  }

  function isFirestoreReady() {
    return !!(window.__firebaseConfigured && window.__firebaseDb);
  }

  // ====================================================================
  // 유틸
  // ====================================================================
  // 분기 기준 3개월 (기존 시그니처 유지 — 호환성)
  function getMonths(year, quarter) {
    var start = (quarter - 1) * 3 + 1;
    return [start, start + 1, start + 2].map(function (m) {
      return { year: year, month: m, ym: year + '-' + pad2(m) };
    });
  }

  // v5 Step 2 신규: 12개월 전체 반환
  function getAllMonths(year) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      out.push({ year: year, month: m, ym: year + '-' + pad2(m) });
    }
    return out;
  }

  // v5 Step 2 신규: state.viewMode 기준 노출할 월 목록
  // - 'all12'   → 12개월 전체 (월 접기는 별도 Step 3에서)
  // - 'quarter' → 분기 3개월만 (기존 동작 유지)
  function getVisibleMonths() {
    if (state.viewMode === 'quarter') {
      return getMonths(state.year, state.quarter);
    }
    return getAllMonths(state.year);
  }

  // v5 Step 3 신규: 월 접기 판정
  // 두 가지 출처를 OR로 합쳐서 판정:
  //   1. 명시적 접힘 — state.collapsedMonths에 들어있음 (사용자가 헤더 클릭으로 접음)
  //   2. 분기 모드 자동 접힘 — viewMode === 'quarter' AND 그 월이 state.quarter의 3개월 밖
  // 분기 모드의 "현 분기"는 state.quarter 기준 (사용자가 분기 네비로 이동한 분기 따라감).
  // - 분기 모드일 때만 보이는 월(=현 분기 3개월)은 절대 자동 접힘 대상이 아님.
  //   그러나 사용자가 명시적으로 접었다면 접힘 (수동 우선).
  // - 12개월 모드에서 명시적 접힘은 그대로 유지됨.
  // - 분기 모드에서 사용자가 현 분기 3개월 외의 월을 펼치려고 클릭해도, 어차피 화면에
  //   안 보이므로 의미 없음 (getVisibleMonths에서 안 나옴). 자동 접힘과 충돌하지 않음.
  function isMonthCollapsed(month) {
    // 1. 명시적 접힘
    if (state.collapsedMonths.has(month)) return true;
    // 2. 분기 모드 자동 접힘
    if (state.viewMode === 'quarter') {
      var qStart = (state.quarter - 1) * 3 + 1;
      var qEnd   = qStart + 2;
      if (month < qStart || month > qEnd) return true;
    }
    return false;
  }

  // 월 접기 토글 (사용자 헤더 클릭). 명시적 접힘 Set만 건드림.
  // 분기 모드 자동 접힘 영역의 월을 토글해도 의미 없으므로 (어차피 화면 밖) 그대로 처리.
  function toggleMonthCollapsed(month) {
    if (state.collapsedMonths.has(month)) {
      state.collapsedMonths.delete(month);
    } else {
      state.collapsedMonths.add(month);
    }
    saveCollapsedMonths(state.projectId, state.year, state.collapsedMonths);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtMoney(n) {
    if (!n && n !== 0) return '-';
    if (n === 0) return '0';
    return (n / 10000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '만';
  }

  function fmtMoneyFull(n) {
    if (!n && n !== 0) return '-';
    if (n === 0) return '0';
    return n.toLocaleString('ko-KR');
  }

  function fmtSalary(n) {
    if (!n) return '-';
    return n.toLocaleString('ko-KR') + '원';
  }

  // ----------------------------------------------------------------------
  // v5.2 — 월급 오버라이드 헬퍼
  // ----------------------------------------------------------------------
  // 과제마다 연봉 갱신 시점 차이 등으로 인력 마스터의 monthlySalary와 다른 값을
  // 신고해야 하는 경우가 있어, projectLabor 레벨에서 인력별 월급을 덮어쓸 수 있게 함.
  //
  // 우선순위:
  //   1. state.personRoles[pid].monthlySalaryOverride 가 양수면 그 값
  //   2. 아니면 person.monthlySalary
  //   3. 둘 다 없으면 0
  //
  // 참고 — 추후 확장 가능성:
  //   현재는 "과제 × 인력" 단위 단일 값 (1년 내내 같은 월급).
  //   연 중간에 월급이 바뀌는 케이스(예: 4월부터 인상)는 아직 미지원.
  //   필요 시 monthlySalaryOverride를 객체로 확장: { default: N, '2026-04': M, ... }
  //   또는 별도 필드 추가. 이 경우 자동 재계산 정책도 함께 재검토 필요
  //   (현재는 무조건 재계산 — 연중 변경 도입 시 "이미 입력된 금액 보존" 옵션 고려).
  // ====================================================================
  // §4.4 — 마스터 연봉 변경 시점(연중 인상) 해석
  //   person.salaryChanges = [{ from:'YYYY-MM', annualSalary:원 }, ...]
  //   그 달부터 새 연봉, 그 전엔 기본 annualSalary (계단식). 비면 기존과 100% 동일.
  //   ※ persons-master.js 와 동일 알고리즘(공용 위치 승격은 추후). 변경 시 양쪽 동기.
  // ====================================================================
  function normalizeYm(s) {
    var m = String(s == null ? '' : s).trim().match(/^(\d{4})\s*[-.\/]?\s*(\d{1,2})$/);
    if (!m) return null;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    return m[1] + '-' + (mo < 10 ? '0' + mo : '' + mo);
  }
  function sanitizeSalaryChanges(arr) {
    if (!Array.isArray(arr)) return [];
    var map = {};
    arr.forEach(function (c) {
      if (!c) return;
      var ym = normalizeYm(c.from);
      var digits = String(c.annualSalary == null ? '' : c.annualSalary).replace(/[^\d]/g, '');
      var sal = digits === '' ? null : Math.round(Number(digits));
      if (ym && sal != null && sal > 0) map[ym] = sal;
    });
    return Object.keys(map).sort().map(function (ym) { return { from: ym, annualSalary: map[ym] }; });
  }
  function getAnnualSalaryAt(person, ym) {
    if (!person) return 0;
    var base = (person.annualSalary != null && !isNaN(person.annualSalary)) ? Number(person.annualSalary) : 0;
    var changes = sanitizeSalaryChanges(person.salaryChanges);
    if (!changes.length || !ym) return base;
    var picked = base;
    changes.forEach(function (c) { if (c.from <= ym) picked = c.annualSalary; });
    return picked;
  }
  function getMonthlySalaryAt(person, ym) {
    var a = getAnnualSalaryAt(person, ym);
    return a ? Math.ceil(a / 12) : 0;
  }
  // 이 인력이 연중 연봉 변경(변경 시점)을 가지고 있나
  function hasSalaryTimeline(person) {
    return !!(person && sanitizeSalaryChanges(person.salaryChanges).length);
  }

  // 우선순위: ① 과제 오버라이드(평탄, >0) ② 마스터 연봉(그 달 기준) ③ person.monthlySalary
  //   ym 없거나 변경시점 없으면 기존 동작(person.monthlySalary)과 동일 — 안전.
  function getEffectiveMonthlySalary(person, ym) {
    if (!person) return 0;
    var roles = state.personRoles && state.personRoles[person.id];
    if (roles && typeof roles.monthlySalaryOverride === 'number' && roles.monthlySalaryOverride > 0) {
      return roles.monthlySalaryOverride;
    }
    if (ym && hasSalaryTimeline(person)) {
      return getMonthlySalaryAt(person, ym);
    }
    return person.monthlySalary || 0;
  }

  // v5 Step 4: 셀 input의 표시/raw 변환 헬퍼
  //   - 참여율: 표시 '10%' / raw 10 / 빈 값 ''
  //   - 금액(현금/현물): 표시 '837,533' / raw 837533 / 빈 값 ''
  //   - 0 또는 빈 값은 모두 빈 문자열로 (placeholder가 보이게)
  function fmtCellRateDisplay(n) {
    var v = Number(n);
    if (!v) return '';
    return v + '%';
  }
  function fmtCellMoneyDisplay(n) {
    var v = Number(n);
    if (!v) return '';
    return v.toLocaleString('ko-KR');
  }
  // 표시값 → raw 숫자 (콤마/% 제거, 숫자 외 글자 제거)
  function parseCellNumber(s) {
    if (s === null || s === undefined || s === '') return 0;
    var clean = String(s).replace(/[^\d.-]/g, '');
    var v = parseFloat(clean);
    return isFinite(v) ? v : 0;
  }

  // ====================================================================
  // v7.4 §3.4: 금액 3분류 (지원금 / 현금 / 현물)
  //   데이터 키 '현금'      = 정부지원금 (환급 대상, cell.cash)
  //   데이터 키 '자부담현금' = 자부담 현금 (환급 X, cell.selfCash)
  //   데이터 키 '현물'      = 자부담 현물 (환급 X, cell.inkind)
  //   ※ 표시 라벨은 fundTypeLabel로 '지원금/현금/현물'. 값 비교·저장은 항상 데이터 키.
  //   ※ 자부담현금 컬럼/옵션은 과제 단위 플래그 project.hasSelfCash (budget에서 설정) 가 true일 때만 노출.
  // ====================================================================
  var FUND_FIELD       = { '현금': 'cash', '자부담현금': 'selfCash', '현물': 'inkind' };
  var FUND_TYPE_LABELS = { '현금': '지원금', '자부담현금': '현금', '현물': '현물' };
  var MONEY_FIELDS     = ['cash', 'selfCash', 'inkind'];
  function moneyFieldOf(ci) { return FUND_FIELD[ci] || 'cash'; }
  function otherMoneyFields(field) { return MONEY_FIELDS.filter(function (f) { return f !== field; }); }
  function fundTypeLabel(ci) { return FUND_TYPE_LABELS[ci] || ci; }
  function projHasSelfCash(project) { return !!(project && project.hasSelfCash); }
  // cashOrInkind 정규화 — 알 수 없는 값은 '현금'(지원금)으로 폴백
  function normalizeCi(ci) { return (ci === '현물' || ci === '자부담현금') ? ci : '현금'; }

  // v5 Step 4: 인력 행의 personRoles 드롭다운 HTML 빌더
  // - 이름·뱃지 줄 아래에 [기존/신규] [지원금/현금/현물] 셀렉트 2개
  // - newOrExisting==='신규' 일 때만 subRole 자유 텍스트 입력란 표시
  // - 선택값마다 색이 달라지도록 modifier 클래스 (--existing/--new, --cash/--inkind) 부여
  // - 변경 이벤트는 위임으로 처리 (bindEvents의 change/input 핸들러)
  // v7.4: 기존/신규 셀렉트 (이름 줄 왼쪽에 인라인)
  function buildNeSelectHtml(personId) {
    var role = (state.personRoles && state.personRoles[personId]) || { newOrExisting: '기존' };
    var ne = role.newOrExisting === '신규' ? '신규' : '기존';
    var neCls = 'pl-role-select pl-role-select--ne ' + (ne === '신규' ? 'is-new' : 'is-existing');
    return '<select class="' + neCls + '" data-role-field="newOrExisting" data-person-id="' + personId + '" aria-label="기존/신규">' +
        '<option value="기존"' + (ne === '기존' ? ' selected' : '') + '>기존</option>' +
        '<option value="신규"' + (ne === '신규' ? ' selected' : '') + '>신규</option>' +
      '</select>';
  }

  // v7.4: 나눔 토글 — 작은 체크박스만(월급 칸 우측). 실무자용이라 라벨 생략.
  function buildSplitToggleHtml(personId, isSplit) {
    return '<label class="pl-split-toggle" title="분류 나눔 — 지원금/현물(+현금) 줄로 나눠 입력">' +
        '<input type="checkbox" data-role-field="split" data-person-id="' + personId + '"' + (isSplit ? ' checked' : '') + ' />' +
      '</label>';
  }

  // 세부역할(신규일 때만) — 이름 아래 줄. 기존/신규는 이름 줄로 이동(buildNeSelectHtml).
  function buildRoleControlsHtml(personId) {
    var role = (state.personRoles && state.personRoles[personId]) || { newOrExisting: '기존', subRole: '' };
    var ne = role.newOrExisting === '신규' ? '신규' : '기존';
    var sub = role.subRole || '';
    if (ne !== '신규') return '';
    return '<div class="pl-subrole-row">' +
        '<span class="pl-subrole-prefix">↳</span>' +
        '<input type="text" class="pl-subrole-input" data-role-field="subRole" data-person-id="' + personId + '" ' +
          'value="' + escapeAttr(sub) + '" placeholder="청년 필수 1 / 청년 추가 2 / 기타 1 등" />' +
      '</div>';
  }

  // v7.4: 구분(분류) 컬럼 셀 HTML — 분류 드롭다운(지원금/현금/현물)
  //   비교 탭 외 모드에서 이름·월급 다음 고정 컬럼에 렌더.
  function buildClassifyCellHtml(personId) {
    var role = (state.personRoles && state.personRoles[personId]) || { cashOrInkind: '현금' };
    var ci = normalizeCi(role.cashOrInkind);
    var hasSelfCash   = projHasSelfCash(getProject());
    var allowSelfCash = hasSelfCash || ci === '자부담현금';
    var ciCls = 'pl-role-select pl-role-select--ci ' + (ci === '현물' ? 'is-inkind' : ci === '자부담현금' ? 'is-selfcash' : 'is-cash');

    var ciOptions =
      '<option value="현금"' + (ci === '현금' ? ' selected' : '') + '>' + fundTypeLabel('현금') + '</option>';
    if (allowSelfCash) {
      ciOptions +=
        '<option value="자부담현금"' + (ci === '자부담현금' ? ' selected' : '') + '>' + fundTypeLabel('자부담현금') + '</option>';
    }
    ciOptions +=
      '<option value="현물"' + (ci === '현물' ? ' selected' : '') + '>' + fundTypeLabel('현물') + '</option>';

    return '<select class="' + ciCls + '" data-role-field="cashOrInkind" data-person-id="' + personId + '" aria-label="지원금/현금/현물">' +
      ciOptions + '</select>';
  }

  // HTML 속성용 간단 이스케이프 (value="..." 안에 들어가는 사용자 입력 안전 처리)
  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getLaborKey(projectId, ym, personId) {
    return projectId + '_' + ym + '_' + personId;
  }

  function getCell(dataMap, projectId, ym, personId) {
    var key = getLaborKey(projectId, ym, personId);
    return dataMap[key] || { rate: 0, cash: 0, inkind: 0, memo: '' };
  }

  function setCell(dataMap, projectId, ym, personId, patch) {
    var key = getLaborKey(projectId, ym, personId);
    if (!dataMap[key]) dataMap[key] = { rate: 0, cash: 0, inkind: 0, memo: '' };
    Object.assign(dataMap[key], patch);
  }

  // v5.3: 셀별/필드별 글자색 헬퍼
  //   - cell.colors = { rate: 'red', cash: 'blue', inkind: undefined }
  //   - 4색 팔레트: 기본(null)·빨강·파랑·초록
  //   - DOM에 직접 style.color 적용
  var COLOR_PALETTE = {
    'red':   '#dc2626',
    'blue':  '#2563eb',
    'green': '#16a34a'
  };
  function getCellColor(cell, field) {
    if (!cell || !cell.colors) return null;
    return cell.colors[field] || null;
  }
  function applyCellColorToInput(input, colorKey) {
    if (!input) return;
    // 빈 값/없음 → 기본색 복원
    input.style.color = colorKey && COLOR_PALETTE[colorKey] ? COLOR_PALETTE[colorKey] : '';
  }
  function setCellColor(dataMap, projectId, ym, personId, field, colorKey) {
    var key = getLaborKey(projectId, ym, personId);
    if (!dataMap[key]) dataMap[key] = { rate: 0, cash: 0, inkind: 0, memo: '' };
    if (!dataMap[key].colors) dataMap[key].colors = {};
    if (colorKey === null || colorKey === undefined) {
      delete dataMap[key].colors[field];
    } else {
      dataMap[key].colors[field] = colorKey;
    }
  }

  // ====================================================================
  // 프로젝트 필터 (해당 연도 수행 중)
  // ====================================================================
  function isProjectActiveInYear(proj, year) {
    // 인건비 관리 대상이 아니면 제외
    if (!proj.laborManaged) return false;

    var s = String(proj.status || '');
    if (s.indexOf('수행') < 0) return false;
    var yb = proj.yearBudgets || proj.budgets || [];
    if (!Array.isArray(yb) || yb.length === 0) {
      var start = proj.researchStart || proj.startDate || proj.submitDate || '';
      var end   = proj.researchEnd   || proj.endDate   || '';
      if (!start) return true;
      var sy = parseInt(start.substring(0, 4), 10);
      var ey = end ? parseInt(end.substring(0, 4), 10) : sy;
      return sy <= year && year <= ey;
    }
    return yb.some(function (b) {
      var bs = parseInt((b.start || b.startDate || '').substring(0, 4), 10);
      var be = parseInt((b.end   || b.endDate   || '').substring(0, 4), 10);
      if (!bs) return true;
      if (!be) be = bs;
      return bs <= year && year <= be;
    });
  }

  function filterProjectsByYear(year) {
    _filteredProjects = _allProjects.filter(function (p) {
      if (!isProjectActiveInYear(p, year)) return false;
      // 회사 필터: state.company 가 비어있으면 전체, 아니면 일치하는 것만
      if (state.company && p.company !== state.company) return false;
      return true;
    });
  }

  // ====================================================================
  // 현재 프로젝트/인력
  // ====================================================================
  function getProjectList() {
    return _filteredProjects.length ? _filteredProjects : [];
  }

  function getProject() {
    var list = getProjectList();
    return list.find(function (p) { return p.id === state.projectId; }) || list[0] || null;
  }

  function getPersons() {
    // 이 프로젝트에 배정된 인력만 (personIds 순서 기준)
    // personIds가 비어있으면 빈 배열
    if (!state.personIds.length) return [];
    return state.personIds
      .map(function (id) {
        return _allPersons.find(function (p) { return p.id === id; });
      })
      .filter(Boolean);
  }

  // ====================================================================
  // v5 Step 2 헬퍼: 예산총액 / 이월금 / 누계 / 차액
  // ====================================================================
  // state.year ↔ projects.yearBudgets 배열 인덱스 매핑
  // projects.yearBudgets는 배열: [{ startDate, endDate, ... }, ...]
  // 각 원소의 인덱스+1 = yearIndex (projectBudget 문서 ID에 사용: {projectId}_year{N})
  // state.year가 [startDate, endDate] 범위와 겹치는 첫 번째 원소를 매칭.
  function getYearIndexForState() {
    var proj = getProject();
    if (!proj || !Array.isArray(proj.yearBudgets)) return null;
    var year = state.year;
    for (var i = 0; i < proj.yearBudgets.length; i++) {
      var yb = proj.yearBudgets[i];
      if (!yb || !yb.startDate || !yb.endDate) continue;
      var sy = parseInt(String(yb.startDate).slice(0, 4), 10);
      var ey = parseInt(String(yb.endDate).slice(0, 4), 10);
      if (isFinite(sy) && isFinite(ey) && year >= sy && year <= ey) return i + 1;
    }
    return null;
  }

  // 예산총액: state.yearBudget(projectBudget 컬렉션에서 로드된 캐시)에서 항목별 분해
  // 반환: { cash, selfCash, inkind, total }
  // cash = budgetCash (지원금)
  // selfCash = budgetSelfCash (자부담)
  // inkind = budgetInkind (현물)
  // total = 셋 다 합
  function getBudgetBreakdown() {
    var yb = state.yearBudget;
    if (!yb) return { cash: 0, selfCash: 0, inkind: 0, total: 0 };
    var c = yb.budgetCash     || 0;
    var s = yb.budgetSelfCash || 0;
    var k = yb.budgetInkind   || 0;
    return { cash: c, selfCash: s, inkind: k, total: c + s + k };
  }

  // 이월금: projects.yearBudgets[idx-1].carryover 에서 읽음.
  // v5에서는 껍데기 — 입력 UI 없음, 기본 0. 향후 carryover 입력 페이지 결정 시 연결.
  function getCarryover() {
    var proj = getProject();
    if (!proj || !Array.isArray(proj.yearBudgets)) return 0;
    var idx = getYearIndexForState();
    if (!idx) return 0;
    var yb = proj.yearBudgets[idx - 1];
    return (yb && typeof yb.carryover === 'number') ? yb.carryover : 0;
  }

  // 누계: 현재 연도 1~12월의 cell 합산 (state.activeTab 기준 — planned/actual)
  // v5 Step 2: 항목별 분해 반환 {cash, selfCash, inkind, total}
  // - cash    = Σ cell.cash      (지원금, 환급 대상)
  // - selfCash= 0                (셀 스키마에 selfCash 없음 — §6.1 미반영)
  // - inkind  = Σ cell.inkind    (현물)
  // - total   = cash + selfCash + inkind
  // 비교 탭일 때는 planned 기준 (의미상 누계는 계획 진척이 더 자연스러움. 추후 조정 가능)
  function getCumulativeBreakdown() {
    var proj = getProject();
    if (!proj) return { cash: 0, selfCash: 0, inkind: 0, total: 0 };
    var dataMap = state.activeTab === 'actual' ? state.actual : state.planned;
    var sumCash = 0, sumInkind = 0;
    var year = state.year;
    for (var m = 1; m <= 12; m++) {
      var ym = year + '-' + pad2(m);
      for (var i = 0; i < state.personIds.length; i++) {
        var pid = state.personIds[i];
        var key = getLaborKey(proj.id, ym, pid);
        var cell = dataMap[key];
        if (!cell) continue;
        if (typeof cell.cash   === 'number') sumCash   += cell.cash;
        if (typeof cell.inkind === 'number') sumInkind += cell.inkind;
      }
    }
    var selfCash = 0;  // v5 미반영
    return {
      cash:     sumCash,
      selfCash: selfCash,
      inkind:   sumInkind,
      total:    sumCash + selfCash + sumInkind,
    };
  }

  // 차액 = 예산총액 + 이월금 − 누계
  // 항목별 차액 + 총합 차액 모두 반환
  function getRemainingBreakdown() {
    var b = getBudgetBreakdown();
    var c = getCumulativeBreakdown();
    var carry = getCarryover();
    // 이월금은 일단 총합에만 적용 (어떤 항목에 귀속될지 미정 — §6.X)
    return {
      cash:     b.cash     - c.cash,
      selfCash: b.selfCash - c.selfCash,
      inkind:   b.inkind   - c.inkind,
      total:    b.total + carry - c.total,
      carryover: carry,
    };
  }

  // 하위호환: 세션 1에서 만든 기존 이름들 — 다른 곳에서 호출되지 않더라도 남겨둠
  function getBudgetTotal()    { return getBudgetBreakdown().total; }
  function getCumulativeCash() { return getCumulativeBreakdown().cash; }
  function getRemainingBudget(){ return getRemainingBreakdown().total; }

  // v5 Step 3: 현재 프로젝트·연도 기준으로 collapsedMonths 캐시 재로드.
  // 프로젝트 변경 / 연도 변경 / 회사 칩 변경 등 "프로젝트·연도 컨텍스트"가 바뀔 때마다 호출.
  function reloadCollapsedMonths() {
    state.collapsedMonths = loadCollapsedMonths(state.projectId, state.year);
  }

  // ====================================================================
  // Firestore: 인건비 로드
  // ====================================================================
  function loadLaborData() {
    if (!state.projectId) return;

    setLoading(true);

    // v5 Step 3: 프로젝트·연도 컨텍스트가 바뀐 시점 → 접힘 캐시 재로드
    reloadCollapsedMonths();

    if (!isFirestoreReady()) {
      // Firestore 미연결: 빈 데이터로 시작
      state.planned     = {};
      state.actual      = {};
      state.meta        = {};
      state.personIds   = [];
      state.personRoles = {};
      state.yearBudget  = null;
      setLoading(false);
      renderAll();
      return;
    }

    var docId = state.projectId;
    var yearIdx = getYearIndexForState();
    var budgetDocId = (yearIdx != null) ? (docId + '_year' + yearIdx) : null;

    Promise.all([
      db().collection(LABOR_COLL).doc(docId + '_planned').get(),
      db().collection(LABOR_COLL).doc(docId + '_actual').get(),
      db().collection(LABOR_COLL).doc(docId + '_meta').get(),
      // v5 Step 2: 현재 연도의 예산 문서 (sticky 박스용)
      budgetDocId
        ? db().collection(BUDGET_COLL).doc(budgetDocId).get()
        : Promise.resolve(null),
    ]).then(function (snaps) {
      var plannedDoc = snaps[0];
      var actualDoc  = snaps[1];
      var metaDoc    = snaps[2];
      var budgetDoc  = snaps[3];

      state.planned     = (plannedDoc.exists && plannedDoc.data().cells)        ? plannedDoc.data().cells       : {};
      state.actual      = (actualDoc.exists  && actualDoc.data().cells)         ? actualDoc.data().cells        : {};
      state.meta        = (metaDoc.exists    && metaDoc.data().meta)            ? metaDoc.data().meta           : {};
      state.personIds   = (metaDoc.exists    && metaDoc.data().personIds)       ? metaDoc.data().personIds      : [];
      // v5 신규: personRoles 읽기 (없으면 빈 객체)
      state.personRoles = (metaDoc.exists    && metaDoc.data().personRoles)     ? metaDoc.data().personRoles    : {};

      // v5 Step 2: 예산 캐시
      if (budgetDoc && budgetDoc.exists) {
        var d = budgetDoc.data() || {};
        state.yearBudget = {
          yearIndex:      d.yearIndex || yearIdx,
          budgetCash:     d.budgetCash     || 0,
          budgetSelfCash: d.budgetSelfCash || 0,
          budgetInkind:   d.budgetInkind   || 0,
          period:         d.period         || null,
        };
      } else {
        state.yearBudget = null;
      }

      // v5 신규: 마이그레이션 — 기존 데이터에 personRoles 기본값 채우기
      var migrated = migratePersonRoles();
      // v5.1 신규: meta 마이그레이션 — sysReg/amtConf → confirmed
      var migratedMeta = migrateMetaToConfirmed();
      if (migrated || migratedMeta) {
        // 마이그레이션이 일어났으면 저장 예약 (UI에서 보이지 않게 자동 저장)
        scheduleSave();
      }

      setLoading(false);
      renderAll();
    }).catch(function (e) {
      console.error('인건비 로드 실패:', e);
      state.planned     = {};
      state.actual      = {};
      state.meta        = {};
      state.personIds   = [];
      state.personRoles = {};
      state.yearBudget  = null;
      setLoading(false);
      renderAll();
    });
  }

  // v5 Step 2: 연도만 바뀌었을 때 예산 문서만 따로 다시 로드
  // (loadLaborData 전체를 다시 호출해도 되지만, cells/meta는 연도 무관해서 효율 차이)
  function reloadYearBudget() {
    if (!state.projectId || !isFirestoreReady()) {
      state.yearBudget = null;
      renderStickyBoxes();
      return;
    }
    var yearIdx = getYearIndexForState();
    if (yearIdx == null) {
      state.yearBudget = null;
      renderStickyBoxes();
      return;
    }
    var docId = state.projectId + '_year' + yearIdx;
    db().collection(BUDGET_COLL).doc(docId).get().then(function (snap) {
      if (snap.exists) {
        var d = snap.data() || {};
        state.yearBudget = {
          yearIndex:      d.yearIndex || yearIdx,
          budgetCash:     d.budgetCash     || 0,
          budgetSelfCash: d.budgetSelfCash || 0,
          budgetInkind:   d.budgetInkind   || 0,
          period:         d.period         || null,
        };
      } else {
        state.yearBudget = null;
      }
      renderStickyBoxes();
    }).catch(function (e) {
      console.error('예산 로드 실패:', e);
      state.yearBudget = null;
      renderStickyBoxes();
    });
  }

  // ====================================================================
  // v5 마이그레이션: personRoles 기본값 채우기
  // ====================================================================
  // 기존 personIds에 있지만 personRoles에 없는 인력에게 기본값 부여.
  // - 기본값: { newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null }
  // - 이미 personRoles에 있는 인력은 건드리지 않음 (사용자 설정 보존).
  // - personIds에서 빠진 personRoles는 일단 보존 (혹시 인력 다시 추가될 수 있음).
  //   - 정리는 추후 별도 작업 (지금은 잔여 데이터를 안전한 쪽으로 보존).
  // 반환값: 변경이 일어났으면 true, 아니면 false.
  function migratePersonRoles() {
    if (!state.personRoles || typeof state.personRoles !== 'object') {
      state.personRoles = {};
    }
    var changed = false;
    state.personIds.forEach(function (pid) {
      if (!state.personRoles[pid]) {
        state.personRoles[pid] = { newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null };
        changed = true;
      } else {
        // 부분 누락 필드도 보정
        var r = state.personRoles[pid];
        if (typeof r.newOrExisting !== 'string') { r.newOrExisting = '기존'; changed = true; }
        if (typeof r.cashOrInkind  !== 'string') { r.cashOrInkind  = '현금'; changed = true; }
        if (typeof r.subRole       !== 'string') { r.subRole       = '';     changed = true; }
      }
    });
    return changed;
  }

  // ====================================================================
  // Firestore: 인건비 저장 (debounce 300ms)
  // ====================================================================
  function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      saveLaborData();
    }, 300);
  }

  function saveLaborData() {
    if (!state.projectId || !isFirestoreReady()) return;

    var docId = state.projectId;
    var batch = db().batch();

    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_planned'),
      { cells: state.planned, updatedAt: new Date().toISOString() }
    );
    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_actual'),
      { cells: state.actual, updatedAt: new Date().toISOString() }
    );
    batch.set(
      db().collection(LABOR_COLL).doc(docId + '_meta'),
      {
        meta:        state.meta,
        personIds:   state.personIds,
        personRoles: state.personRoles,  // v5 신규
        updatedAt:   new Date().toISOString()
      }
    );

    batch.commit().then(function () {
      showSaveIndicator('저장됨');
    }).catch(function (e) {
      console.error('인건비 저장 실패:', e);
      showSaveIndicator('저장 실패 ⚠️');
    });
  }

  // ====================================================================
  // 저장 상태 표시
  // ====================================================================
  function showSaveIndicator(msg) {
    var el = document.getElementById('pl-save-indicator');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 2000);
  }

  // ====================================================================
  // 로딩 상태
  // ====================================================================
  function setLoading(val) {
    state.loading = val;
    var el = document.getElementById('pl-loading');
    if (el) el.style.display = val ? 'block' : 'none';
  }

  // ====================================================================
  // 프로젝트 드롭다운 채우기
  // ====================================================================
  function populateProjectSelect() {
    var sel = document.getElementById('pl-project-select');
    if (!sel) return;

    var list   = getProjectList();
    var prevId = state.projectId;

    sel.innerHTML = '';

    if (list.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '해당 연도 수행 과제 없음';
      sel.appendChild(opt);
      state.projectId = '';
      return;
    }

    list.forEach(function (proj) {
      var opt = document.createElement('option');
      opt.value = proj.id;
      var name = proj.name || proj.projectName || proj.id;
      var kw = (proj.keywords || proj.keyword || '').toString().trim();
      opt.textContent = kw ? '(' + kw + ') ' + name : name;
      sel.appendChild(opt);
    });

    var stillExists = list.some(function (p) { return p.id === prevId; });
    if (stillExists) {
      sel.value = prevId;
    } else {
      state.projectId = list[0].id;
      sel.value = state.projectId;
    }
  }

  // ====================================================================
  // 프로젝트/인력 Firestore 구독
  // ====================================================================
  function loadProjects() {
    if (window.firestoreService) {
      window.firestoreService.subscribeProjects(function (projects) {
        _allProjects = Array.isArray(projects) ? projects : [];
        filterProjectsByYear(state.year);
        populateProjectSelect();

        // 첫 로드 or 프로젝트 변경 시 인건비 로드
        var proj = getProject();
        if (proj && proj.id !== state._lastLoadedProjectId) {
          state._lastLoadedProjectId = proj.id;
          state.projectId = proj.id;
          state.viewMode = loadViewMode(state.projectId);  // v5 Step 2
          loadLaborData();
        } else if (!proj) {
          renderAll();
        }
      });
    } else {
      renderAll();
    }
  }

  function loadPersons() {
    if (window.firestoreService) {
      window.firestoreService.subscribePersons(function (persons) {
        _allPersons = Array.isArray(persons) ? persons : [];
        renderAll();
      });
    }
  }

  // ====================================================================
  // 신규 채용 배너
  // ====================================================================
  function renderHireBanner() {
    var project = getProject();
    var banner  = document.getElementById('pl-hire-banner');
    var text    = document.getElementById('pl-hire-text');
    if (!banner || !text || !project || !project.requiredNew) {
      if (banner) banner.style.display = 'none';
      return;
    }
    var hired = state.personIds.filter(function (id) {
      var p = _allPersons.find(function (x) { return x.id === id; });
      return p && p.isNew && p.status === 'active';
    }).length;
    var hiredYouth = state.personIds.filter(function (id) {
      var p = _allPersons.find(function (x) { return x.id === id; });
      return p && p.isNew && p.isYouth && p.status === 'active';
    }).length;

    banner.style.display = 'flex';
    text.innerHTML =
      '신규 채용 필수: <strong>' + hired + ' / ' + project.requiredNew + '명</strong>' +
      ' &nbsp;|&nbsp; 청년: <strong>' + hiredYouth + ' / ' + (project.requiredYouth || 0) + '명</strong>' +
      ' &nbsp;<span class="pl-hire-badge ' + (hired >= project.requiredNew ? 'pl-hire-badge--done' : 'pl-hire-badge--progress') + '">' +
        (hired >= project.requiredNew ? '✅ 완료' : '⏳ 진행중') + '</span>';
  }

  // ====================================================================
  // 전체 렌더링
  // ====================================================================
  function renderAll() {
    renderViewModeToggle();   // v5 Step 2
    renderQuarterNavVisibility(); // v5 Step 2: viewMode에 따라 분기네비 표시/숨김
    renderExpandAllBtn();     // v5 Step 3: 접힌 월 있을 때만 노출
    renderHireBanner();
    buildTable(document.getElementById('pl-table-planned'), 'planned');
    buildTable(document.getElementById('pl-table-actual'),  'actual');
    buildTable(document.getElementById('pl-table-compare'), 'compare');
    updateTabCounts();
    renderStickyBoxes();      // v5 Step 2
    renderSnapshotBtnVisibility();  // v7.4.4 §4.2
  }

  // ====================================================================
  // v5 Step 2: 뷰 모드 토글 [전체 12개월 | 분기] 렌더
  // ====================================================================
  function renderViewModeToggle() {
    var wrap = document.getElementById('pl-view-mode');
    if (!wrap) return;
    var btns = wrap.querySelectorAll('.pl-view-mode-btn');
    btns.forEach(function (b) {
      var mode = b.getAttribute('data-mode');
      if (mode === state.viewMode) b.classList.add('is-active');
      else b.classList.remove('is-active');
    });
  }

  // v5 Step 2: 분기 네비게이터는 viewMode === 'quarter'일 때만 노출
  function renderQuarterNavVisibility() {
    var qLabel = document.getElementById('pl-quarter-label');
    var nav    = qLabel ? qLabel.closest('.pl-quarter-nav') : null;
    var qWord  = nav ? nav.previousElementSibling : null; // "분기" label
    var visible = state.viewMode === 'quarter';
    if (nav)   nav.style.display   = visible ? '' : 'none';
    if (qWord && qWord.classList && qWord.classList.contains('history-toolbar-label') && qWord.textContent === '분기') {
      qWord.style.display = visible ? '' : 'none';
    }
    // 이전 분기 복사 버튼도 분기 모드에서만
    var copyBtn = document.getElementById('pl-copy-prev-btn');
    if (copyBtn) copyBtn.style.display = visible ? '' : 'none';
  }

  // v5 Step 3: 모두 펼치기 버튼 가시성/카운트 갱신
  // - 노출 조건: 명시적으로 접힌 월이 1개 이상 (state.collapsedMonths.size > 0).
  // - 분기 모드 자동 접힘은 카운트에 포함하지 않음 (펼치는 대상이 아님 — 분기 모드 자체가 의도).
  // - 버튼 클릭 시 state.collapsedMonths를 비우고 localStorage 저장 + 재렌더.
  function renderExpandAllBtn() {
    var btn = document.getElementById('pl-expand-all-btn');
    if (!btn) return;
    var n = state.collapsedMonths.size;
    if (n === 0) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    var countEl = document.getElementById('pl-expand-all-count');
    if (countEl) countEl.textContent = n;
  }

  function expandAllMonths() {
    if (state.collapsedMonths.size === 0) return;
    state.collapsedMonths = new Set();
    saveCollapsedMonths(state.projectId, state.year, state.collapsedMonths);
    renderAll();
  }

  // ====================================================================
  // v5 Step 2: 우측 sticky 박스 4개 렌더
  //   예산총액 (항목별 분해) / 이월금 / 누계 (항목별 분해) / 차액 (색상)
  // ====================================================================
  function renderStickyBoxes() {
    var wrap = document.getElementById('pl-sticky');
    if (!wrap) return;
    var project = getProject();
    if (!project) {
      wrap.innerHTML = '<div class="pl-sticky-empty">과제를 선택해주세요.</div>';
      return;
    }

    var b = getBudgetBreakdown();
    var c = getCumulativeBreakdown();
    var r = getRemainingBreakdown();
    var carry = r.carryover;
    var yearIdx = getYearIndexForState();

    // 예산 페이지 링크 (있으면)
    var budgetLinkHref = 'project-budget.html';
    var hasYearBudget = (state.yearBudget != null);

    // 차액 색상 (총합 기준)
    var diffClass = 'pl-sticky-box--neutral';
    if (r.total < 0) diffClass = 'pl-sticky-box--neg';
    else if (r.total > 100000) diffClass = 'pl-sticky-box--pos';

    var html = '';

    // ── 박스 1: 예산총액 ──
    html +=
      '<div class="pl-sticky-box">' +
        '<div class="pl-sticky-box-head">' +
          '<span class="pl-sticky-box-title">예산총액</span>' +
          (yearIdx ? '<a class="pl-sticky-link" href="' + budgetLinkHref + '" target="_blank" title="예산 페이지 열기">↗</a>' : '') +
        '</div>' +
        '<div class="pl-sticky-box-amount">' + fmtWon(b.total) + '</div>' +
        '<div class="pl-sticky-box-breakdown">' +
          '<div><span>지원금</span><strong>' + fmtWon(b.cash) + '</strong></div>' +
          '<div><span>자부담</span><strong>' + fmtWon(b.selfCash) + '</strong></div>' +
          '<div><span>현물</span><strong>' + fmtWon(b.inkind) + '</strong></div>' +
        '</div>' +
        (hasYearBudget
          ? ''
          : '<div class="pl-sticky-box-note">' + (yearIdx ? (yearIdx + '차년도 예산 미입력') : '연차 정보 없음') + '</div>') +
      '</div>';

    // ── 박스 2: 이월금 (껍데기) ──
    html +=
      '<div class="pl-sticky-box pl-sticky-box--muted">' +
        '<div class="pl-sticky-box-head">' +
          '<span class="pl-sticky-box-title">이월금</span>' +
          '<span class="pl-sticky-box-hint" title="v5에서는 표시만. 입력 방식은 추후 결정.">(껍데기)</span>' +
        '</div>' +
        '<div class="pl-sticky-box-amount">' + fmtWon(carry) + '</div>' +
      '</div>';

    // ── 박스 3: 누계 ──
    var tabLabel = state.activeTab === 'actual' ? '실제' : '예상';
    html +=
      '<div class="pl-sticky-box">' +
        '<div class="pl-sticky-box-head">' +
          '<span class="pl-sticky-box-title">누계 (' + tabLabel + ' · 12개월)</span>' +
        '</div>' +
        '<div class="pl-sticky-box-amount">' + fmtWon(c.total) + '</div>' +
        '<div class="pl-sticky-box-breakdown">' +
          '<div><span>지원금</span><strong>' + fmtWon(c.cash) + '</strong></div>' +
          '<div class="is-disabled" title="v5 미반영 (셀에 selfCash 없음)"><span>자부담</span><strong>' + fmtWon(c.selfCash) + '</strong></div>' +
          '<div><span>현물</span><strong>' + fmtWon(c.inkind) + '</strong></div>' +
        '</div>' +
      '</div>';

    // ── 박스 4: 차액 ★ ──
    html +=
      '<div class="pl-sticky-box ' + diffClass + '">' +
        '<div class="pl-sticky-box-head">' +
          '<span class="pl-sticky-box-title">차액 ★</span>' +
        '</div>' +
        '<div class="pl-sticky-box-amount">' + fmtWon(r.total) + '</div>' +
        '<div class="pl-sticky-box-breakdown">' +
          '<div><span>지원금</span><strong>' + fmtWon(r.cash) + '</strong></div>' +
          '<div class="is-disabled"><span>자부담</span><strong>' + fmtWon(r.selfCash) + '</strong></div>' +
          '<div><span>현물</span><strong>' + fmtWon(r.inkind) + '</strong></div>' +
        '</div>' +
        '<div class="pl-sticky-box-formula">예산총액 + 이월금 − 누계</div>' +
      '</div>';

    wrap.innerHTML = html;
  }

  // 원 단위 출력 (sticky 박스용): 천 단위 콤마, 마이너스 처리
  function fmtWon(n) {
    if (n == null || isNaN(n)) return '0원';
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(Math.round(n));
    return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
  }

  function updateTabCounts() {
    var persons = getPersons();
    // v5 Step 4 후속: 비교 탭은 count 자리에 "차이만" 토글이 들어가서 갱신 대상 아님
    ['planned', 'actual'].forEach(function (tab) {
      var el = document.getElementById('tab-count-' + tab);
      if (el) el.textContent = persons.length + '명';
    });
  }

  // ====================================================================
  // 렌더링: 공통 테이블 빌더
  // ====================================================================
  function buildTable(tableEl, mode) {
    if (!tableEl) return;
    var months  = getVisibleMonths();   // v5 Step 2: viewMode에 따라 12개월 or 3개월
    var persons = getPersons();
    var project = getProject();
    var dataMap = mode === 'actual' ? state.actual : state.planned;

    // 환급 여부: project.laborRefund === false 이면 참여율만, 그 외 환급 있음
    var hasRefund = !project || project.laborRefund !== false;

    // v5 Step 3: 월 컬럼 총 개수 (접힌 월=1, 펼친 월=mode별)
    // v5.1: compare 5 → 2 → v5 Step 4: 환급 있으면 3(% / 지원금 / 현물), 없으면 1(%)
    // v7.4: hasSelfCash면 자부담현금(현금) 컬럼 추가 → 4(% / 지원금 / 현금 / 현물)
    var hasSelfCash = projHasSelfCash(project);
    var moneyColsCount = hasSelfCash ? 3 : 2;   // 지원금(+현금) + 현물
    function colsPerMonth(m) {
      if (isMonthCollapsed(m.month)) return 1;
      return hasRefund ? (1 + moneyColsCount) : 1;
    }
    var totalMonthCols = months.reduce(function (sum, m) { return sum + colsPerMonth(m); }, 0);
    // v5.3: 우측 합계 컬럼(현금/현물) — hasRefund + compare 아닐 때만. v7.4: hasSelfCash면 +1(현금)
    // v7.4: 고정 왼쪽 컬럼 수 — 이름+월급(+구분, 비교 외)
    var fixedLeftCols = 2 + (mode !== 'compare' ? 1 : 0);
    var totalCols = fixedLeftCols + totalMonthCols + ((hasRefund && mode !== 'compare') ? moneyColsCount : 0);

    tableEl.innerHTML = '';

    if (!project) {
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = totalCols;
      tdEmpty.className = 'pl-empty';
      tdEmpty.textContent = '과제를 선택해주세요.';
      trEmpty.appendChild(tdEmpty);
      var tbody0 = document.createElement('tbody');
      tbody0.appendChild(trEmpty);
      tableEl.appendChild(tbody0);
      return;
    }

    // colgroup
    var cg = document.createElement('colgroup');
    // v7.4: 이름 | 월급 | [구분(분류)] — 구분 컬럼은 비교 탭 외 모드에만 (비교 탭 2번째 고정칸은 행타입 '구분')
    cg.innerHTML = '<col class="col-name"><col class="col-salary">' +
      (mode !== 'compare' ? '<col class="col-classify">' : '');
    months.forEach(function (m) {
      // v5 Step 3: 접힌 월은 단일 좁은 컬럼 1개
      if (isMonthCollapsed(m.month)) {
        cg.innerHTML += '<col class="col-collapsed">';
        return;
      }
      // v5 Step 4: 환급 있으면 지원금/현물(+v7.4 hasSelfCash면 현금) 컬럼, 없으면 참여율만
      if (hasRefund) {
        cg.innerHTML += '<col class="col-rate"><col class="col-cash">' +
          (hasSelfCash ? '<col class="col-selfcash">' : '') +
          '<col class="col-inkind">';
      } else {
        cg.innerHTML += '<col class="col-rate">';
      }
    });
    // v5.3: 우측 합계 컬럼 — hasRefund일 때만 (참여율은 합계 의미 없음). v7.4: hasSelfCash면 현금 합계 추가
    if (hasRefund && mode !== 'compare') {
      cg.innerHTML += '<col class="col-total-cash">' +
        (hasSelfCash ? '<col class="col-total-selfcash">' : '') +
        '<col class="col-total-inkind">';
    }
    tableEl.appendChild(cg);

    // thead
    var thead = document.createElement('thead');
    var trMonth = document.createElement('tr');
    trMonth.className = 'pl-thead-month';

    var thName = document.createElement('th');
    thName.textContent = '이름';
    thName.rowSpan = 2;
    thName.className = 'th-fixed pl-sticky-left';   // v5.3: sticky
    trMonth.appendChild(thName);

    var thSalary = document.createElement('th');
    // v5.1: compare 탭은 행 타입 라벨이 들어가므로 "구분"
    thSalary.textContent = mode === 'compare' ? '구분' : '월급';
    thSalary.rowSpan = 2;
    thSalary.className = 'th-fixed';
    trMonth.appendChild(thSalary);

    // v7.4: 분류 구분 컬럼 헤더 (비교 탭 외)
    if (mode !== 'compare') {
      var thClassify = document.createElement('th');
      thClassify.textContent = '구분';
      thClassify.rowSpan = 2;
      thClassify.className = 'th-fixed';
      trMonth.appendChild(thClassify);
    }

    months.forEach(function (m, mi) {
      var isLast = mi === months.length - 1;
      var collapsed = isMonthCollapsed(m.month);
      var th = document.createElement('th');

      if (collapsed) {
        // 접힌 월 — colspan 없음(컬럼 1개), rowSpan=2 (서브 헤더까지 합침)
        th.colSpan = 1;
        th.rowSpan = 2;
        th.className = 'th-month th-month-collapsed' + (!isLast ? ' month-sep' : '');
        th.title = m.year + '년 ' + m.month + '월 — 클릭해서 펼치기';
        th.dataset.collapseToggle = '1';
        th.dataset.month = String(m.month);
        // 세로쓰기 월번호 + 펼치기 아이콘
        th.innerHTML =
          '<div class="pl-month-collapsed-label">' +
            '<span class="pl-month-collapsed-num">' + m.month + '</span>' +
            '<span class="pl-month-collapsed-icon" aria-hidden="true">+</span>' +
          '</div>';
        trMonth.appendChild(th);
        return;
      }

      // 펼친 월
      th.colSpan = hasRefund ? (1 + moneyColsCount) : 1;
      th.className = 'th-month' + (!isLast ? ' month-sep' : '');

      // v5.1: 확정 메타 — 예상 탭에서만 확정 버튼 노출
      // v5.2: 실제 탭에서 확정된 월에 [지급 완료] 버튼 / 지급 뱃지 추가
      var confMeta = state.meta[m.ym] || {};
      var isConfirmed = !!confMeta.confirmed;
      var isPaid      = !!confMeta.paid;
      var confLabel = '';
      if (mode === 'planned') {
        if (isConfirmed) {
          var atText = confMeta.confirmedAt
            ? ' (' + String(confMeta.confirmedAt).substring(0, 10) + ' 확정)'
            : '';
          confLabel =
            '<div class="pl-month-meta">' +
              '<button type="button" class="pl-month-confirm-btn is-confirmed" data-confirm-month="' + m.ym + '" title="' + m.year + '년 ' + m.month + '월 — 확정됨' + atText + '. 클릭하면 확정 취소(실제 탭 데이터 삭제).">' +
                '<span class="pl-confirm-icon">✓</span> 확정됨' +
              '</button>' +
            '</div>';
        } else {
          confLabel =
            '<div class="pl-month-meta">' +
              '<button type="button" class="pl-month-confirm-btn" data-confirm-month="' + m.ym + '" title="' + m.year + '년 ' + m.month + '월 예상값을 실제 탭으로 복사하고 확정합니다.">' +
                '확정' +
              '</button>' +
            '</div>';
        }
      } else if (mode === 'actual' && isConfirmed) {
        // v5.2: 실제 탭 — 확정된 월에 청록 뱃지 + (미지급) [지급 완료] 버튼 / (지급됨) 에메랄드 뱃지
        var confAt = confMeta.confirmedAt ? String(confMeta.confirmedAt).substring(0, 10) : '';
        var confTip = m.year + '년 ' + m.month + '월 확정됨' + (confAt ? ' (' + confAt + ')' : '');
        var paidPart;
        if (isPaid) {
          var paidAt = confMeta.paidAt || '';
          var paidTip = '지급일 ' + paidAt + ' — 클릭하면 수정/취소';
          paidPart =
            '<span class="pl-month-paid-badge" data-paid-month="' + m.ym + '" title="' + paidTip + '">' +
              '💸 ' + paidAt +
            '</span>';
        } else {
          paidPart =
            '<button type="button" class="pl-month-paid-btn" data-paid-month="' + m.ym + '" title="' + m.year + '년 ' + m.month + '월 지급 완료 처리. 지급일 입력 prompt 표시.">' +
              '지급 완료' +
            '</button>';
        }
        confLabel =
          '<div class="pl-month-meta">' +
            '<span class="pl-month-confirm-badge" title="' + confTip + '">✓ 확정</span>' +
            paidPart +
          '</div>';
      }

      // 월 라벨은 접기 토글 영역
      th.innerHTML =
        '<div class="pl-month-head-label" data-collapse-toggle="1" data-month="' + m.month + '" title="' + m.year + '년 ' + m.month + '월 — 클릭해서 접기">' +
          '<span class="pl-month-collapse-icon" aria-hidden="true">−</span>' +
          '<span>' + m.year + '년 ' + m.month + '월</span>' +
        '</div>' +
        confLabel;
      trMonth.appendChild(th);
    });
    // v5.3: 우측 합계 헤더 (rowSpan=2로 두 헤더 행 합침)
    // v7.4: hasSelfCash면 [합계 지원금 | 합계 현금 | 합계 현물] 3열, 아니면 [합계 지원금 | 합계 현물] 2열
    //   sticky 우측 인덱스: 현물=0(right:0), 현금=1(right:100), 지원금=2(right:200, hasSelfCash) 또는 지원금=1(2열일 때)
    if (hasRefund && mode !== 'compare') {
      var thTotalCash = document.createElement('th');
      thTotalCash.rowSpan = 2;
      thTotalCash.className = 'pl-th-total ' + (hasSelfCash ? 'pl-sticky-right-2' : 'pl-sticky-right-1');
      thTotalCash.textContent = '합계 ' + fundTypeLabel('현금');   // "합계 지원금"
      trMonth.appendChild(thTotalCash);
      if (hasSelfCash) {
        var thTotalSelf = document.createElement('th');
        thTotalSelf.rowSpan = 2;
        thTotalSelf.className = 'pl-th-total pl-sticky-right-1';
        thTotalSelf.textContent = '합계 ' + fundTypeLabel('자부담현금');   // "합계 현금"
        trMonth.appendChild(thTotalSelf);
      }
      var thTotalInkind = document.createElement('th');
      thTotalInkind.rowSpan = 2;
      thTotalInkind.className = 'pl-th-total pl-sticky-right-0';
      thTotalInkind.textContent = '합계 ' + fundTypeLabel('현물');   // "합계 현물"
      trMonth.appendChild(thTotalInkind);
    }
    thead.appendChild(trMonth);

    var trSub = document.createElement('tr');
    trSub.className = 'pl-thead-sub';
    months.forEach(function (m, mi) {
      // v5 Step 3: 접힌 월은 월 헤더가 rowSpan=2로 합쳐 그렸으므로 여기선 스킵
      if (isMonthCollapsed(m.month)) return;

      var isLast = mi === months.length - 1;
      // v7.4: 환급 컬럼 라벨 — 지원금 / (현금) / 현물
      var cols = hasRefund
        ? (hasSelfCash
            ? ['참여율', fundTypeLabel('현금'), fundTypeLabel('자부담현금'), fundTypeLabel('현물')]
            : ['참여율', fundTypeLabel('현금'), fundTypeLabel('현물')])
        : ['참여율'];
      cols.forEach(function (label, li) {
        var th = document.createElement('th');
        th.textContent = label;
        if (li === cols.length - 1 && !isLast) th.className = 'month-sep';
        trSub.appendChild(th);
      });
    });
    thead.appendChild(trSub);
    tableEl.appendChild(thead);

    // tbody
    var tbody = document.createElement('tbody');

    if (persons.length === 0) {
      var trEmp = document.createElement('tr');
      var tdEmp = document.createElement('td');
      tdEmp.colSpan = totalCols;
      tdEmp.className = 'pl-empty';
      tdEmp.textContent = '+ 인력 추가 버튼으로 인력을 추가하세요.';
      trEmp.appendChild(tdEmp);
      tbody.appendChild(trEmp);
    } else {
      persons.forEach(function (person) {
        if (mode === 'compare') {
          buildCompareRows(tbody, person, months, project);
        } else if (state.personRoles && state.personRoles[person.id] && state.personRoles[person.id].split) {
          buildSplitPersonRows(tbody, person, months, project, dataMap, mode, hasRefund);
        } else {
          buildDataRow(tbody, person, months, project, dataMap, mode, hasRefund);
        }
      });
    }

    // + 인력 추가 행
    if (mode !== 'compare') {
      var trAdd = document.createElement('tr');
      trAdd.className = 'pl-row-add';
      var tdAdd = document.createElement('td');
      tdAdd.colSpan = totalCols;
      tdAdd.innerHTML = '<button type="button" class="pl-add-person-btn pl-add-inline-btn">＋ 인력 추가</button>';
      trAdd.appendChild(tdAdd);
      tbody.appendChild(trAdd);
    }

    tableEl.appendChild(tbody);

    // tfoot 합계
    if (mode !== 'compare') {
      var tfoot = document.createElement('tfoot');
      var trSum = document.createElement('tr');
      trSum.className = 'pl-tfoot-sum';

      var tdLabel = document.createElement('td');
      tdLabel.colSpan = 3;   // v7.4: 이름+월급+구분
      tdLabel.className = 'td-fixed pl-sticky-left';   // v5.3: sticky
      tdLabel.textContent = hasRefund ? '월별 합계 (환급 예정)' : '월별 합계 (참여율)';
      trSum.appendChild(tdLabel);

      months.forEach(function (m, mi) {
        var isLast = mi === months.length - 1;

        // v5 Step 3: 접힌 월 — 단일 회색 셀
        if (isMonthCollapsed(m.month)) {
          var tdC = document.createElement('td');
          tdC.className = 'pl-cell-collapsed' + (!isLast ? ' month-sep' : '');
          tdC.dataset.collapseToggle = '1';
          tdC.dataset.month = String(m.month);
          tdC.title = m.year + '년 ' + m.month + '월 (접힘)';
          trSum.appendChild(tdC);
          return;
        }

        var fields = hasRefund
          ? (hasSelfCash ? ['rate', 'cash', 'selfCash', 'inkind'] : ['rate', 'cash', 'inkind'])
          : ['rate'];
        fields.forEach(function (field, fi) {
          var td = document.createElement('td');
          td.id = 'sum-' + field + '-' + mode + '-' + m.ym;
          td.textContent = '-';
          if (fi === fields.length - 1 && !isLast) td.className = 'month-sep';
          trSum.appendChild(td);
        });
      });

      // v5.3: 그랜드 토탈 (전체 인력 × 12개월 합산) — sticky 우측. v7.4: hasSelfCash면 현금 추가
      if (hasRefund) {
        var tdGrandCash = document.createElement('td');
        tdGrandCash.className = 'pl-cell-total ' + (hasSelfCash ? 'pl-sticky-right-2' : 'pl-sticky-right-1');
        tdGrandCash.id = 'grand-cash-' + mode;
        tdGrandCash.textContent = '-';
        trSum.appendChild(tdGrandCash);
        if (hasSelfCash) {
          var tdGrandSelf = document.createElement('td');
          tdGrandSelf.className = 'pl-cell-total pl-sticky-right-1';
          tdGrandSelf.id = 'grand-selfCash-' + mode;
          tdGrandSelf.textContent = '-';
          trSum.appendChild(tdGrandSelf);
        }
        var tdGrandInkind = document.createElement('td');
        tdGrandInkind.className = 'pl-cell-total pl-sticky-right-0';
        tdGrandInkind.id = 'grand-inkind-' + mode;
        tdGrandInkind.textContent = '-';
        trSum.appendChild(tdGrandInkind);
      }

      tfoot.appendChild(trSum);
      tableEl.appendChild(tfoot);
      recalcSums(mode, months, persons, project, dataMap);
    }

    // v5.3: 두 번째 헤더 행(참여율/현금/현물)의 sticky top을 첫 번째 행 높이로 동적 설정
    //   - 두 행 모두 `top: 0`이면 위로 겹쳐서 두 번째 행이 첫 번째를 가림
    //   - 첫 번째 행은 "확정" 버튼 유무에 따라 높이가 달라지므로 측정 필요
    //   - rAF로 다음 프레임에 측정 (방금 추가된 DOM은 height 안 잡힐 수 있음)
    requestAnimationFrame(function () {
      var monthRow = tableEl.querySelector('thead tr.pl-thead-month');
      var subRow   = tableEl.querySelector('thead tr.pl-thead-sub');
      if (!monthRow || !subRow) return;
      var monthH = monthRow.offsetHeight || 0;
      var subThs = subRow.querySelectorAll('th');
      for (var i = 0; i < subThs.length; i++) {
        subThs[i].style.top = monthH + 'px';
      }
    });
  }

  // v5.3: 인력 마스터 데이터에서 날짜를 YYYY-MM으로 추출
  //   - 마스터 데이터의 필드명이 환경에 따라 다를 수 있어 여러 후보를 시도
  //   - "2026-02-24" 같은 ISO 문자열, Date 객체, Firestore Timestamp 모두 대응
  //   - 정책: 퇴사월/입사월 당월은 입력 허용, 그 외 월은 잠금
  function _ymFromAnything(d) {
    if (!d) return null;
    // Firestore Timestamp
    if (typeof d.toDate === 'function') { try { d = d.toDate(); } catch (e) {} }
    // Date 객체
    if (d instanceof Date && !isNaN(d.getTime())) {
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
    // 문자열 — "2026-02-24" / "2026-02" / "2026/02/24" / "2026.02.24" 등
    if (typeof d === 'string') {
      var match = d.match(/^(\d{4})[-\/.](\d{1,2})/);
      if (match) {
        var mm = parseInt(match[2], 10);
        if (mm >= 1 && mm <= 12) return match[1] + '-' + (mm < 10 ? '0' : '') + mm;
      }
    }
    // 숫자 (timestamp millis)
    if (typeof d === 'number' && isFinite(d)) {
      var dt = new Date(d);
      if (!isNaN(dt.getTime())) {
        var y2 = dt.getFullYear();
        var m2 = dt.getMonth() + 1;
        return y2 + '-' + (m2 < 10 ? '0' : '') + m2;
      }
    }
    return null;
  }
  function getExitYm(person) {
    if (!person) return null;
    // 필드명 후보를 순서대로 시도 — 마스터 스키마가 환경에 따라 다를 수 있음
    var candidates = [person.exitDate, person.exitedAt, person.leaveDate, person.resignDate, person.endDate];
    for (var i = 0; i < candidates.length; i++) {
      var ym = _ymFromAnything(candidates[i]);
      if (ym) return ym;
    }
    return null;
  }

  // ====================================================================
  // C4: 신규 인력 자동 판정 (신규 = 입사일 > 기준일 − N개월)
  // ====================================================================
  function _ymdFromAnything(d) {
    if (!d) return null;
    if (typeof d.toDate === 'function') { try { d = d.toDate(); } catch (e) {} }
    if (d instanceof Date && !isNaN(d.getTime())) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    if (typeof d === 'string') {
      var m = d.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
      if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
      var m2 = d.match(/^(\d{4})[-\/.](\d{1,2})/);  // 일 없으면 1일
      if (m2) return m2[1] + '-' + pad2(+m2[2]) + '-01';
    }
    if (typeof d === 'number' && isFinite(d)) {
      var dt = new Date(d);
      if (!isNaN(dt.getTime())) return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
    }
    return null;
  }

  function _hireYmd(person) {
    return _ymdFromAnything(person && (person.hireDate || person.hiredAt || person.joinDate || person.startDate));
  }

  // 'YYYY-MM-DD' − N개월 → 'YYYY-MM-DD'
  function monthsBeforeYmd(ymd, n) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
    var dt = new Date(y, (m - 1) - (n || 0), d);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  // 과제 기준일 ('YYYY-MM-DD') — 규칙의 baseDateType 에 따라 공고일 / 과제 시작일
  function getNewJudgeBaseDate(proj) {
    if (!proj) return null;
    var rule = proj.newJudgeRule || {};
    if (rule.baseDateType === '공고일') return _ymdFromAnything(proj.announceDate);
    var s = proj.startDate;
    if (!s && Array.isArray(proj.yearBudgets) && proj.yearBudgets[0]) {
      s = proj.yearBudgets[0].startDate || proj.yearBudgets[0].start;
    }
    return _ymdFromAnything(s);
  }

  // 그 과제에 신규 판정 규칙이 설정돼 있나
  function hasNewJudgeRule(proj) {
    var r = proj && proj.newJudgeRule;
    return !!(r && r.months != null && getNewJudgeBaseDate(proj));
  }

  // 사람별 판정: '신규' | '기존' | '미상' | null(규칙 없음)
  function judgeNewExisting(person, proj) {
    proj = proj || getProject();
    if (!hasNewJudgeRule(proj)) return null;
    var hire = _hireYmd(person);
    if (!hire) return '미상';
    var cut = monthsBeforeYmd(getNewJudgeBaseDate(proj), proj.newJudgeRule.months);
    return hire > cut ? '신규' : '기존';
  }
  // v5.3: 사용자 직접 셀 잠금 (월 단위)
  //   - personRoles[pid].lockedYms = ['2026-03', '2026-05']
  //   - 이 헬퍼들로만 접근 (직접 인덱싱 X)
  function isYmManuallyLocked(personId, ym) {
    var role = state.personRoles && state.personRoles[personId];
    if (!role || !Array.isArray(role.lockedYms)) return false;
    return role.lockedYms.indexOf(ym) >= 0;
  }
  function setYmLocked(personId, ym, locked) {
    if (!state.personRoles) state.personRoles = {};
    if (!state.personRoles[personId]) {
      state.personRoles[personId] = {
        newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null, lockedYms: []
      };
    }
    var role = state.personRoles[personId];
    if (!Array.isArray(role.lockedYms)) role.lockedYms = [];
    var idx = role.lockedYms.indexOf(ym);
    if (locked && idx < 0) role.lockedYms.push(ym);
    else if (!locked && idx >= 0) role.lockedYms.splice(idx, 1);
  }

  function getHireYm(person) {
    if (!person) return null;
    var candidates = [person.hireDate, person.hiredAt, person.joinDate, person.startDate];
    for (var i = 0; i < candidates.length; i++) {
      var ym = _ymFromAnything(candidates[i]);
      if (ym) return ym;
    }
    return null;
  }

  // ---- 일반 행 ----
  function buildDataRow(tbody, person, months, project, dataMap, mode, hasRefund) {
    var isExited = (person.status === 'exited');
    var hasSelfCash = projHasSelfCash(project);   // v7.4: 자부담현금 컬럼 노출 여부
    // v7.4: 분류 나눔 — 한 사람이 한 과제에서 분류별로 참여율을 나눠 입력
    var roleForRow = (state.personRoles && state.personRoles[person.id]) || {};
    var splitMode  = false;   // v7.4 1단계: 나눔(멀티행)은 2단계 구현. 현재는 단일 분류만.
    var primaryCi  = normalizeCi(roleForRow.cashOrInkind);
    var rowSalary  = getEffectiveMonthlySalary(person);
    // v5.3: 퇴사월 / 입사월 (YYYY-MM)
    //   - 퇴사월보다 뒤 → 잠금
    //   - 입사월보다 앞 → 잠금
    //   - 정보 없으면 잠그지 않음 (안전 폴백)
    var exitYm = isExited ? getExitYm(person) : null;
    var hireYm = getHireYm(person);
    var tr = document.createElement('tr');
    var rowCls = isExited ? 'pl-row--exited' : '';
    // C2 §4.8: 3책5공 관리 과제의 책임자 행 강조 (배경+이름 볼드, 뱃지 X)
    if (project && project.is3ch5gManaged && project.managerPersonId === person.id) {
      rowCls += (rowCls ? ' ' : '') + 'pl-row--manager';
    }
    if (rowCls) tr.className = rowCls;
    tr.dataset.personId = person.id;
    // v5.3 Step 4.8: 행 자체를 draggable로. 핸들에서만 드래그 시작하도록 dragstart에서 검사.
    tr.draggable = true;

    var tdName = document.createElement('td');
    tdName.className = 'td-fixed pl-td-name pl-sticky-left';   // v5.3: sticky
    var badgesHtml = '';
    if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
    if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';
    // v7.4: 퇴사자는 뱃지 대신 이름에 취소선 + 진회색 (CSS: .pl-row--exited .pl-name-text)
    // v5.2: hover 시 노출되는 ✕ 삭제 버튼. data-remove-person으로 위임 처리.
    // v5.3 Step 4.8: 이름 앞에 드래그 핸들(≡). data-drag-handle 마커 — dragstart에서 확인.
    tdName.innerHTML =
      '<div class="pl-name-row">' +
        '<span class="pl-row-drag-handle" data-drag-handle="1" title="드래그해서 순서 변경">≡</span>' +
        buildNeSelectHtml(person.id) +
        '<span class="pl-name-text">' + person.name + '</span>' +
        (badgesHtml ? '<span class="pl-name-badges-inline">' + badgesHtml + '</span>' : '') +
        '<button type="button" class="pl-row-remove-btn" data-remove-person="' + person.id + '"' +
          ' title="' + person.name + ' 이 프로젝트에서 제거">×</button>' +
      '</div>' +
      buildRoleControlsHtml(person.id);
    tr.appendChild(tdName);

    // v5.2: 월급 셀 — 예상 탭에서 편집 가능 (오버라이드 입력)
    //   기본은 인력 마스터의 monthlySalary 자동 표시.
    //   사용자가 수정하면 personRoles[pid].monthlySalaryOverride 에 저장.
    //   오버라이드가 있으면 파란색으로 표시 (수정된 값임을 시각화).
    //   실제/비교 탭에서는 read-only (예상 탭에서 결정된 값을 그대로 사용).
    var tdSalary = document.createElement('td');
    tdSalary.className = 'td-fixed pl-td-salary';
    var roles  = (state.personRoles && state.personRoles[person.id]) || {};
    var hasOverride = (typeof roles.monthlySalaryOverride === 'number' && roles.monthlySalaryOverride > 0);
    var effective   = getEffectiveMonthlySalary(person);
    var salWrap = document.createElement('div');
    salWrap.className = 'pl-salary-wrap';
    if (mode === 'planned') {
      // input 으로 렌더
      var salInput = document.createElement('input');
      salInput.type        = 'text';
      salInput.inputMode   = 'numeric';
      salInput.className   = 'pl-salary-input' + (hasOverride ? ' is-override' : '');
      salInput.dataset.personId = person.id;
      salInput.dataset.raw  = String(effective || 0);
      salInput.value       = effective ? effective.toLocaleString('ko-KR') : '';
      salInput.placeholder = person.monthlySalary
        ? person.monthlySalary.toLocaleString('ko-KR')
        : '월급 미등록';
      salInput.title = hasOverride
        ? '과제 오버라이드 적용 중 (마스터: ' + (person.monthlySalary ? person.monthlySalary.toLocaleString('ko-KR') + '원' : '미등록') + ')\n빈 값으로 두면 마스터 값 복원'
        : '클릭해서 이 과제에 한해 다른 월급으로 변경할 수 있습니다';
      salWrap.appendChild(salInput);
      // §4.4: 연중 연봉 변경이 있는 인력 표시 (오버라이드 없을 때만 — 오버라이드가 우선이라)
      if (!hasOverride && hasSalaryTimeline(person)) {
        var chips = sanitizeSalaryChanges(person.salaryChanges).map(function (c) {
          return c.from + '부터 ' + Math.ceil(c.annualSalary / 12).toLocaleString('ko-KR') + '원';
        }).join('\n');
        var mark = document.createElement('span');
        mark.className = 'pl-salary-timeline-mark';
        mark.textContent = '📅';
        mark.title = '연중 연봉 변경 있음 (인사 마스터 등록)\n' + chips +
          '\n\n월 자동 계산은 각 달의 연봉을 사용합니다. 이미 입력된 금액은 "📅 연봉 변경 반영" 또는 ⚡ 일괄 계산으로 갱신하세요.';
        salWrap.appendChild(mark);
      }
    } else {
      // 실제/비교 탭 — read-only 표시
      var salSpan = document.createElement('span');
      salSpan.className = 'pl-salary-text';
      salSpan.textContent = fmtSalary(effective);
      salWrap.appendChild(salSpan);
      if (hasOverride) {
        tdSalary.classList.add('pl-salary-cell--override');
        tdSalary.title = '과제 오버라이드 적용 중 (마스터: ' + (person.monthlySalary ? person.monthlySalary.toLocaleString('ko-KR') + '원' : '미등록') + ')';
      }
    }
    // v7.4: 나눔 토글 — 월급 우측 (예상 탭만)
    //   split은 personRoles에 사람 단위로 저장돼 예상/실제/비교가 공유한다.
    //   → 토글은 예상에서만 켜고, 실제·비교는 그 결과(멀티행)만 표시(중복 조작 방지).
    if (mode === 'planned') {
      salWrap.insertAdjacentHTML('beforeend', buildSplitToggleHtml(person.id, false));
    }
    tdSalary.appendChild(salWrap);
    tr.appendChild(tdSalary);

    // v7.4: 구분(분류) 셀 — 비교 탭 외. 분류 드롭다운(지원금/현금/현물)
    if (mode !== 'compare') {
      var tdClassify = document.createElement('td');
      tdClassify.className = 'td-fixed pl-td-classify';
      tdClassify.innerHTML = buildClassifyCellHtml(person.id);
      tr.appendChild(tdClassify);
    }

    months.forEach(function (m, mi) {
      var isLast   = mi === months.length - 1;

      // v5 Step 3: 접힌 월 — 단일 회색 셀 1개
      if (isMonthCollapsed(m.month)) {
        var tdC = document.createElement('td');
        tdC.className = 'pl-cell-collapsed' + (!isLast ? ' month-sep' : '');
        tdC.title = m.year + '년 ' + m.month + '월 (접힘)';
        tdC.dataset.collapseToggle = '1';
        tdC.dataset.month = String(m.month);
        tr.appendChild(tdC);
        return;
      }

      var cell     = getCell(dataMap, project.id, m.ym, person.id);
      // v5.3: 셀 잠금 정책
      //   - 퇴사월 이후 / 입사월 이전 / 사용자 직접 잠금 → 셋 중 하나라도 해당하면 잠금
      var locked = false;
      if (isExited && exitYm && m.ym > exitYm) locked = true;
      if (hireYm && m.ym < hireYm)             locked = true;
      if (isYmManuallyLocked(person.id, m.ym)) locked = true;
      var inactive = locked;

      // 참여율
      // v5 Step 4: type=number → type=text + 포맷팅 ('10%' 등)
      //   - 표시: blur 시 '10%' / 빈 값일 땐 빈 문자열
      //   - 편집: focus 시 raw 숫자('10')로 전환, blur 시 다시 포맷
      //   - 실제 값(raw)은 dataset.raw에 저장, onCellInput에서 이걸 사용
      var tdRate = document.createElement('td');
      tdRate.className = inactive ? 'pl-cell--inactive' : '';
      var inputRate = document.createElement('input');
      inputRate.type = 'text';
      inputRate.inputMode = 'numeric';
      inputRate.className = 'pl-cell-input pl-input-rate';
      inputRate.placeholder = '0%';
      inputRate.readOnly = locked;
      inputRate.dataset.personId = person.id;
      inputRate.dataset.ym = m.ym;
      inputRate.dataset.field = 'rate';
      inputRate.dataset.mode = mode;
      inputRate.dataset.raw = String(cell.rate || 0);
      inputRate.value = fmtCellRateDisplay(cell.rate);
      applyRateColor(inputRate, cell.rate || 0);
      applyCellColorToInput(inputRate, getCellColor(cell, 'rate'));   // v5.3: 사용자 색
      if (splitMode) {
        // v7.4 나눔: 참여율은 분류별 합(읽기전용). 입력은 각 분류 칸에서.
        inputRate.readOnly = true;
        inputRate.classList.add('pl-input-split-sum');
        inputRate.title = '분류 나눔: 각 분류 칸 합계';
      }
      tdRate.appendChild(inputRate);
      if (cell.memo) {
        tdRate.classList.add('pl-cell-has-memo');
        tdRate.title = cell.memo;
        tdRate.appendChild(buildMemoMarker(person.id, m.ym, mode, cell.memo));
      }
      tr.appendChild(tdRate);

      if (hasRefund) {
        // v7.4: 표시할 금액 분류 컬럼 — 지원금(cash) / [현금(selfCash)] / 현물(inkind)
        var moneyFields = [{ f: 'cash', cls: 'pl-input-cash' }];
        if (hasSelfCash) moneyFields.push({ f: 'selfCash', cls: 'pl-input-selfCash' });
        moneyFields.push({ f: 'inkind', cls: 'pl-input-inkind' });

        moneyFields.forEach(function (mf, fi) {
          var isLastField = (fi === moneyFields.length - 1);
          var td = document.createElement('td');
          var tdCls = (inactive ? 'pl-cell--inactive ' : '') + ((isLastField && !isLast) ? 'month-sep' : '');
          if (tdCls.trim()) td.className = tdCls.trim();

          var input = document.createElement('input');
          input.type = 'text';
          input.inputMode = 'numeric';
          input.readOnly = locked;
          input.dataset.personId = person.id;
          input.dataset.ym = m.ym;
          input.dataset.mode = mode;

          if (splitMode) {
            // 나눔: 이 칸은 해당 분류의 참여율(%) 입력. 금액은 급여×%로 자동.
            //   값 우선순위: cell.rates[field] → (이 칸이 기존 분류면 cell.rate) → 0
            var rv = (cell.rates && typeof cell.rates[mf.f] === 'number')
              ? cell.rates[mf.f]
              : (mf.f === primaryCi ? (cell.rate || 0) : 0);
            input.className = 'pl-cell-input pl-input-split pl-input-splitrate-' + mf.f;
            input.dataset.field = 'splitRate';
            input.dataset.splitField = mf.f;
            input.dataset.raw = String(rv);
            input.value = rv > 0 ? fmtCellRateDisplay(rv) : '';
            input.placeholder = '0%';
            applyRateColor(input, rv);
          } else {
            input.className = 'pl-cell-input ' + mf.cls;
            input.dataset.field = mf.f;
            input.dataset.raw = String(cell[mf.f] || 0);
            input.value = fmtCellMoneyDisplay(cell[mf.f]);
            input.placeholder = '0';
            applyCellColorToInput(input, getCellColor(cell, mf.f));   // v5.3: 사용자 색
          }
          td.appendChild(input);
          tr.appendChild(td);
        });
      } else {
        // 환급 없음: 참여율 셀에 month-sep만 추가
        if (!isLast) tdRate.classList.add('month-sep');
      }
    });

    // v5.3: 우측 합계 셀 (지원금/[현금]/현물) — 행 단위 12개월 합산. v7.4: hasSelfCash면 현금 추가
    if (hasRefund) {
      var rowTotalCash = 0, rowTotalSelf = 0, rowTotalInkind = 0;
      // dataMap에서 직접 12개월 다 더함 (months는 접힌 월 제외일 수 있어서 부정확)
      var allYms = getAllMonths(state.year).map(function (m) { return m.ym; });
      allYms.forEach(function (ym) {
        var c = getCell(dataMap, project.id, ym, person.id);
        rowTotalCash   += (c.cash     || 0);
        rowTotalSelf   += (c.selfCash || 0);
        rowTotalInkind += (c.inkind   || 0);
      });
      var tdTotalCash = document.createElement('td');
      tdTotalCash.className = 'pl-cell-total ' + (hasSelfCash ? 'pl-sticky-right-2' : 'pl-sticky-right-1');
      tdTotalCash.id = 'total-cash-' + mode + '-' + person.id;
      tdTotalCash.textContent = rowTotalCash ? rowTotalCash.toLocaleString('ko-KR') : '-';
      tr.appendChild(tdTotalCash);

      if (hasSelfCash) {
        var tdTotalSelf = document.createElement('td');
        tdTotalSelf.className = 'pl-cell-total pl-sticky-right-1';
        tdTotalSelf.id = 'total-selfCash-' + mode + '-' + person.id;
        tdTotalSelf.textContent = rowTotalSelf ? rowTotalSelf.toLocaleString('ko-KR') : '-';
        tr.appendChild(tdTotalSelf);
      }

      var tdTotalInkind = document.createElement('td');
      tdTotalInkind.className = 'pl-cell-total pl-sticky-right-0';
      tdTotalInkind.id = 'total-inkind-' + mode + '-' + person.id;
      tdTotalInkind.textContent = rowTotalInkind ? rowTotalInkind.toLocaleString('ko-KR') : '-';
      tr.appendChild(tdTotalInkind);
    }

    tbody.appendChild(tr);
  }

  // ---- 나눔(분류 split) 멀티행 ----
  // v7.4: 한 사람을 분류(지원금/현금/현물)별 여러 줄로 렌더. 이름·월급은 rowspan으로 묶음.
  //   데이터는 단일 셀(cell.rates + cell.cash/selfCash/inkind)에 저장 — 키 변경 없음.
  //   각 줄: 구분 라벨 + 참여율(이 분류) 입력 + 그 분류 금액(읽기전용). 다른 분류 칸은 빈칸.
  function buildSplitPersonRows(tbody, person, months, project, dataMap, mode, hasRefund) {
    var isExited = (person.status === 'exited');
    var hasSelfCash = projHasSelfCash(project);
    var exitYm = isExited ? getExitYm(person) : null;
    var hireYm = getHireYm(person);
    var roles  = (state.personRoles && state.personRoles[person.id]) || {};
    var primaryCi = normalizeCi(roles.cashOrInkind);
    var salary = getEffectiveMonthlySalary(person);

    // v7.4: 나눔 줄 = personRoles.splitCis(사용자가 드롭다운으로 고른 분류들). 없으면 기본값.
    var splitCis = (Array.isArray(roles.splitCis) && roles.splitCis.length)
      ? roles.splitCis.slice()
      : defaultSplitCis(person.id);
    var rowCis = splitCis.map(function (ci) { return { ci: ci }; });
    var nRows = rowCis.length;
    var allYms = getAllMonths(state.year).map(function (mm) { return mm.ym; });

    // 사용 가능한 분류(드롭다운 옵션 후보)
    var availCis = ['현금'];
    if (hasSelfCash) availCis.push('자부담현금');
    availCis.push('현물');

    rowCis.forEach(function (rc, ri) {
      var rowCi = rc.ci;
      var rowField = moneyFieldOf(rowCi);   // cash | selfCash | inkind
      var isFirst = (ri === 0);

      var tr = document.createElement('tr');
      if (isExited) tr.className = 'pl-row--exited';
      // C2: 3책5공 관리 과제 책임자 행 강조 (나눔 행에도 동일 적용)
      if (project && project.is3ch5gManaged && project.managerPersonId === person.id) {
        tr.classList.add('pl-row--manager');
      }
      tr.classList.add('pl-split-row');
      if (isFirst) tr.classList.add('pl-split-row-first');
      if (ri === nRows - 1) tr.classList.add('pl-split-row-last');
      tr.dataset.personId = person.id;
      tr.dataset.rowCi = rowCi;

      // 이름/월급 — 첫 줄만 (rowspan)
      if (isFirst) {
        var tdName = document.createElement('td');
        tdName.className = 'td-fixed pl-td-name pl-sticky-left';
        tdName.rowSpan = nRows;
        var badgesHtml = '';
        if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
        if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';
        // v7.4: 퇴사자는 뱃지 대신 이름 취소선 처리
        tdName.innerHTML =
          '<div class="pl-name-row">' +
            '<span class="pl-row-drag-handle" data-drag-handle="1" title="드래그해서 순서 변경">≡</span>' +
            buildNeSelectHtml(person.id) +
            '<span class="pl-name-text">' + person.name + '</span>' +
            (badgesHtml ? '<span class="pl-name-badges-inline">' + badgesHtml + '</span>' : '') +
            '<button type="button" class="pl-row-remove-btn" data-remove-person="' + person.id + '"' +
              ' title="' + person.name + ' 이 프로젝트에서 제거">×</button>' +
          '</div>' +
          buildRoleControlsHtml(person.id);
        tr.appendChild(tdName);

        var tdSalary = document.createElement('td');
        tdSalary.className = 'td-fixed pl-td-salary';
        tdSalary.rowSpan = nRows;
        var hasOverride = (typeof roles.monthlySalaryOverride === 'number' && roles.monthlySalaryOverride > 0);
        var salWrap = document.createElement('div');
        salWrap.className = 'pl-salary-wrap';
        if (mode === 'planned') {
          var salInput = document.createElement('input');
          salInput.type = 'text'; salInput.inputMode = 'numeric';
          salInput.className = 'pl-salary-input' + (hasOverride ? ' is-override' : '');
          salInput.dataset.personId = person.id;
          salInput.dataset.raw = String(salary || 0);
          salInput.value = salary ? salary.toLocaleString('ko-KR') : '';
          salInput.placeholder = person.monthlySalary ? person.monthlySalary.toLocaleString('ko-KR') : '월급 미등록';
          salWrap.appendChild(salInput);
        } else {
          var salSpan = document.createElement('span');
          salSpan.className = 'pl-salary-text';
          salSpan.textContent = fmtSalary(salary);
          salWrap.appendChild(salSpan);
          if (hasOverride) tdSalary.classList.add('pl-salary-cell--override');
        }
        // 나눔 토글은 예상 탭에서만 — 실제·비교는 결과만 표시(예상에서 켠 split 공유)
        if (mode === 'planned') {
          salWrap.insertAdjacentHTML('beforeend', buildSplitToggleHtml(person.id, true));
        }
        tdSalary.appendChild(salWrap);
        tr.appendChild(tdSalary);
      }

      // 구분 — 드롭다운(이 줄의 분류 선택). 다른 줄이 이미 쓰는 분류는 옵션에서 제외(중복 방지).
      var tdClassify = document.createElement('td');
      tdClassify.className = 'td-fixed pl-td-classify';
      var usedByOthers = splitCis.filter(function (c, i) { return i !== ri; });
      var ciColorCls = rowField === 'inkind' ? 'is-inkind' : rowField === 'selfCash' ? 'is-selfcash' : 'is-cash';
      var optsHtml = availCis
        .filter(function (c) { return c === rowCi || usedByOthers.indexOf(c) < 0; })
        .map(function (c) {
          return '<option value="' + c + '"' + (c === rowCi ? ' selected' : '') + '>' + fundTypeLabel(c) + '</option>';
        }).join('');
      tdClassify.innerHTML =
        '<select class="pl-role-select pl-role-select--ci pl-split-ci-select ' + ciColorCls + '" ' +
          'data-role-field="splitCi" data-person-id="' + person.id + '" data-row-index="' + ri + '" aria-label="분류 선택">' +
          optsHtml +
        '</select>';
      tr.appendChild(tdClassify);

      // 월별 셀
      months.forEach(function (m, mi) {
        var isLast = (mi === months.length - 1);
        if (isMonthCollapsed(m.month)) {
          var tdC = document.createElement('td');
          tdC.className = 'pl-cell-collapsed' + (!isLast ? ' month-sep' : '');
          tdC.dataset.collapseToggle = '1';
          tdC.dataset.month = String(m.month);
          tr.appendChild(tdC);
          return;
        }
        var cell = getCell(dataMap, project.id, m.ym, person.id);
        var locked = false;
        if (isExited && exitYm && m.ym > exitYm) locked = true;
        if (hireYm && m.ym < hireYm)             locked = true;
        if (isYmManuallyLocked(person.id, m.ym)) locked = true;
        var inactive = locked;

        // 참여율(이 분류) — 시드 우선순위:
        //   1) cell.rates[field] 있으면 그대로
        //   2) 이 분류에 금액이 있으면 금액/급여로 역산 (참여율을 금액 위치에 맞춤)
        //   3) 금액이 전혀 없고 이 줄이 주 분류면 cell.rate (단일 입력분 폴백)
        var rv = 0;
        if (cell.rates && typeof cell.rates[rowField] === 'number') {
          rv = cell.rates[rowField];
        } else if ((cell[rowField] || 0) > 0 && salary > 0) {
          rv = Math.round((cell[rowField] || 0) / salary * 100);
        } else if (rowCi === primaryCi && (cell.rate || 0) > 0 &&
                   !((cell.cash || 0) || (cell.selfCash || 0) || (cell.inkind || 0))) {
          rv = cell.rate || 0;
        }
        var tdRate = document.createElement('td');
        tdRate.className = inactive ? 'pl-cell--inactive' : '';
        var inputRate = document.createElement('input');
        inputRate.type = 'text'; inputRate.inputMode = 'numeric';
        inputRate.className = 'pl-cell-input pl-input-rate';
        inputRate.placeholder = '0%';
        inputRate.readOnly = locked;
        inputRate.dataset.personId = person.id;
        inputRate.dataset.ym = m.ym;
        inputRate.dataset.field = 'rate';
        inputRate.dataset.mode = mode;
        inputRate.dataset.split = '1';
        inputRate.dataset.splitField = rowField;
        inputRate.dataset.raw = String(rv);
        inputRate.value = rv > 0 ? fmtCellRateDisplay(rv) : '';
        applyRateColor(inputRate, rv);
        tdRate.appendChild(inputRate);
        if (cell.memo && ri === 0) {           // 메모는 셀 1개 → 첫 줄에만 마커
          tdRate.classList.add('pl-cell-has-memo');
          tdRate.title = cell.memo;
          tdRate.appendChild(buildMemoMarker(person.id, m.ym, mode, cell.memo));
        }
        tr.appendChild(tdRate);

        if (hasRefund) {
          var mf = ['cash'];
          if (hasSelfCash) mf.push('selfCash');
          mf.push('inkind');
          mf.forEach(function (f, fi) {
            var isLastField = (fi === mf.length - 1);
            var td = document.createElement('td');
            var tdCls = (inactive ? 'pl-cell--inactive ' : '') + ((isLastField && !isLast) ? 'month-sep' : '');
            if (tdCls.trim()) td.className = tdCls.trim();
            if (f === rowField) {
              var mInput = document.createElement('input');
              mInput.type = 'text'; mInput.inputMode = 'numeric';
              mInput.className = 'pl-cell-input pl-input-' + f + ' pl-split-money';
              mInput.readOnly = true;
              mInput.title = '참여율로 자동 계산된 금액';
              mInput.dataset.personId = person.id;
              mInput.dataset.ym = m.ym;
              mInput.dataset.field = f;
              mInput.dataset.mode = mode;
              mInput.dataset.raw = String(cell[f] || 0);
              mInput.value = fmtCellMoneyDisplay(cell[f]);
              td.appendChild(mInput);
            } else {
              td.classList.add('pl-split-empty');
            }
            tr.appendChild(td);
          });
        } else {
          if (!isLast) tdRate.classList.add('month-sep');
        }
      });

      // 우측 합계 — 이 분류 칸만 값, 나머지 빈칸 (sticky 클래스는 항상 부여해 정렬 유지)
      if (hasRefund) {
        var totCash = 0, totSelf = 0, totInkind = 0;
        allYms.forEach(function (ym) {
          var c = getCell(dataMap, project.id, ym, person.id);
          totCash += (c.cash || 0); totSelf += (c.selfCash || 0); totInkind += (c.inkind || 0);
        });
        var mkTotal = function (field, total, cls) {
          var td = document.createElement('td');
          td.className = 'pl-cell-total ' + cls;
          if (field === rowField) {
            td.id = 'total-' + field + '-' + mode + '-' + person.id;
            td.textContent = total ? total.toLocaleString('ko-KR') : '-';
          } else {
            td.textContent = '';
          }
          return td;
        };
        tr.appendChild(mkTotal('cash', totCash, hasSelfCash ? 'pl-sticky-right-2' : 'pl-sticky-right-1'));
        if (hasSelfCash) tr.appendChild(mkTotal('selfCash', totSelf, 'pl-sticky-right-1'));
        tr.appendChild(mkTotal('inkind', totInkind, 'pl-sticky-right-0'));
      }

      tbody.appendChild(tr);
    });
  }
  // v5.1 변경:
  //   - 한 월에 5컬럼(예상%/예상현금/실제%/실제현금/차이) → 2컬럼(% / 현금)으로 축소
  //   - 각 행은 자기 값만 표시 (예상행=예상값, 실제행=실제값, 차이행=차이)
  //   - 이름 칸: 첫 행에만 rowSpan으로 합치지 않고, 각 행마다 [예상]/[실제]/[차이] 라벨 표시
  //     → 실제값이 시각적으로 잘 보이도록 (#9 사용자 피드백)
  //   - 금액 표시는 fmtMoneyFull로 (천 단위 콤마 + 원 단위) — #10
  function buildCompareRows(tbody, person, months, project) {
    var rowTypes = [
      { key: 'planned', cls: 'pl-row-planned', label: '예상' },
      { key: 'actual',  cls: 'pl-row-actual',  label: '실제' },
      { key: 'diff',    cls: 'pl-row-diff',    label: '차이' },
    ];

    rowTypes.forEach(function (rowType, ri) {
      var tr = document.createElement('tr');
      tr.className = rowType.cls;

      var isFirst = (ri === 0);
      // 이름 / 월급은 첫 행에서만 rowSpan으로 합침 (기존)
      // 그 위에 행 타입 라벨도 같이 표시 → 사용자가 어떤 행이 무엇인지 한눈에
      if (isFirst) {
        var tdName = document.createElement('td');
        tdName.className = 'td-fixed pl-td-name pl-sticky-left';   // v5.3: sticky
        tdName.rowSpan = rowTypes.length;
        var badgesHtml = '';
        if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
        if (person.isNew)   badgesHtml += '<span class="pl-badge pl-badge--new">신규</span>';
        // v5.2: hover 시 ✕ 삭제 버튼
        tdName.innerHTML =
          '<div class="pl-name-row">' +
            '<span class="pl-name-text">' + person.name + '</span>' +
            (badgesHtml ? '<span class="pl-name-badges-inline">' + badgesHtml + '</span>' : '') +
            '<button type="button" class="pl-row-remove-btn" data-remove-person="' + person.id + '"' +
              ' title="' + person.name + ' 이 프로젝트에서 제거">×</button>' +
          '</div>' +
          buildRoleControlsHtml(person.id);
        tr.appendChild(tdName);

        // 월급 칸 → v5.1: 행 타입 라벨로 대체 (월급은 인력 마스터에서 보면 됨)
        // 비교 탭은 분석용이고 행 식별이 더 중요함
        var tdLabel = document.createElement('td');
        tdLabel.className = 'td-fixed pl-td-row-labels';
        tdLabel.rowSpan = 1;
        tdLabel.innerHTML = '<span class="pl-row-type-label pl-row-type-label--' + rowType.key + '">' + rowType.label + '</span>';
        tr.appendChild(tdLabel);
      } else {
        // 두 번째 행부터 — 행 타입 라벨만
        var tdLabel2 = document.createElement('td');
        tdLabel2.className = 'td-fixed pl-td-row-labels';
        tdLabel2.innerHTML = '<span class="pl-row-type-label pl-row-type-label--' + rowType.key + '">' + rowType.label + '</span>';
        tr.appendChild(tdLabel2);
      }

      months.forEach(function (m, mi) {
        var isLast    = mi === months.length - 1;

        // v5 Step 3: 접힌 월 — 단일 회색 셀 1개 (compare 탭은 rowSpan으로 합침)
        if (isMonthCollapsed(m.month)) {
          // 첫 행(planned)에서만 td를 만들고 rowSpan으로 3행 합침
          if (rowType.key === 'planned') {
            var tdC = document.createElement('td');
            tdC.className = 'pl-cell-collapsed' + (!isLast ? ' month-sep' : '');
            tdC.rowSpan = rowTypes.length;
            tdC.title = m.year + '년 ' + m.month + '월 (접힘)';
            tdC.dataset.collapseToggle = '1';
            tdC.dataset.month = String(m.month);
            tr.appendChild(tdC);
          }
          return;
        }

        var planned   = getCell(state.planned, project.id, m.ym, person.id);
        var actual    = getCell(state.actual,  project.id, m.ym, person.id);
        var hasActual = !!state.actual[getLaborKey(project.id, m.ym, person.id)];
        var hasPlanned = !!state.planned[getLaborKey(project.id, m.ym, person.id)];

        // v5 Step 4: 환급 여부에 따라 컬럼 구성
        //   환급 있음 → 참여율 / 지원금 / (현금) / 현물
        //   환급 없음 → 참여율 (1컬럼)
        var refund = !project || project.laborRefund !== false;
        var hasSelfCash = projHasSelfCash(project);   // v7.4
        var rateSepCls = (refund ? '' : (!isLast ? 'month-sep' : ''));
        var inkindSepCls = (refund && !isLast) ? 'month-sep' : '';

        // 각 행은 자기 값만
        if (rowType.key === 'planned') {
          appendCompareCell(tr, hasPlanned ? planned.rate : null, '%', false, rateSepCls,
            { personId: person.id, ym: m.ym, mode: 'planned', memo: planned.memo || '' });
          if (refund) {
            appendCompareCell(tr, hasPlanned ? planned.cash : null, '원', false, '');
            if (hasSelfCash) appendCompareCell(tr, hasPlanned ? planned.selfCash : null, '원', false, '');
            appendCompareCell(tr, hasPlanned ? planned.inkind : null, '원', false, inkindSepCls);
          }
        } else if (rowType.key === 'actual') {
          appendCompareCell(tr, hasActual ? actual.rate : null, '%', false, rateSepCls,
            { personId: person.id, ym: m.ym, mode: 'actual', memo: actual.memo || '' });
          if (refund) {
            appendCompareCell(tr, hasActual ? actual.cash : null, '원', false, '');
            if (hasSelfCash) appendCompareCell(tr, hasActual ? actual.selfCash : null, '원', false, '');
            appendCompareCell(tr, hasActual ? actual.inkind : null, '원', false, inkindSepCls);
          }
        } else {
          // 차이행: 예상·실제 둘 다 있어야 의미. 한쪽만 있으면 비워둠.
          var bothPresent = hasPlanned && hasActual;
          var diffRate   = bothPresent ? (actual.rate     - planned.rate)     : null;
          var diffCash   = bothPresent ? (actual.cash     - planned.cash)     : null;
          var diffSelf   = bothPresent ? ((actual.selfCash || 0) - (planned.selfCash || 0)) : null;
          var diffInkind = bothPresent ? (actual.inkind   - planned.inkind)   : null;
          appendCompareCell(tr, diffRate, '%', true, rateSepCls);
          if (refund) {
            appendCompareCell(tr, diffCash, '원', true, '');
            if (hasSelfCash) appendCompareCell(tr, diffSelf, '원', true, '');
            appendCompareCell(tr, diffInkind, '원', true, inkindSepCls);
          }
        }
      });

      tbody.appendChild(tr);
    });
  }

  function appendCompareCell(tr, value, unit, isDiff, extraClass, memoInfo) {
    var td = document.createElement('td');
    td.style.textAlign = 'right';
    td.style.padding = '0.55rem 0.5rem';
    td.style.fontSize = '0.82rem';
    td.style.fontVariantNumeric = 'tabular-nums';
    if (extraClass) td.className = extraClass;

    if (value === null || value === undefined) {
      td.textContent = '-';
      td.style.color = '#cbd5e1';
    } else if (isDiff) {
      // v5.1: fmtMoney (84만) → fmtMoneyFull (840,000) — #10
      if (value > 0) {
        td.textContent = '+' + (unit === '원' ? fmtMoneyFull(value) : value + '%');
        td.className += ' diff-pos';
      } else if (value < 0) {
        // 음수는 fmtMoneyFull이 음수 부호 포함해서 처리
        td.textContent = unit === '원' ? fmtMoneyFull(value) : value + '%';
        td.className += ' diff-neg';
      } else {
        td.textContent = '0';
        td.className += ' diff-zero';
      }
    } else {
      // v5.1: 일반 셀도 fmtMoneyFull로 (원 단위)
      td.textContent = unit === '원' ? fmtMoneyFull(value) : (value ? value + '%' : '-');
    }
    // C3: 비교 탭 메모 — 예상행→planned·실제행→actual 참여율 셀에만 부여(차이행 없음)
    if (memoInfo) {
      td.classList.add('pl-compare-memocell');
      td.dataset.personId = memoInfo.personId;
      td.dataset.ym = memoInfo.ym;
      td.dataset.mode = memoInfo.mode;
      if (memoInfo.memo) {
        td.classList.add('pl-cell-has-memo');
        td.title = memoInfo.memo;
        td.appendChild(buildMemoMarker(memoInfo.personId, memoInfo.ym, memoInfo.mode, memoInfo.memo));
      }
    }
    tr.appendChild(td);
  }

  // ====================================================================
  // 참여율 색상
  // ====================================================================
  function applyRateColor(input, rate) {
    input.classList.remove('rate-safe', 'rate-warn', 'rate-danger');
    if (rate >= 100)     input.classList.add('rate-danger');
    else if (rate >= 90) input.classList.add('rate-warn');
    else if (rate > 0)   input.classList.add('rate-safe');
  }

  // ====================================================================
  // 합계 재계산
  // ====================================================================
  function recalcSums(mode, months, persons, project, dataMap) {
    var hasRefund = !project || project.laborRefund !== false;
    var hasSelfCash = projHasSelfCash(project);   // v7.4

    // 월별 합계 (기존)
    months.forEach(function (m) {
      var totalRate = 0, totalCash = 0, totalSelf = 0, totalInkind = 0;
      persons.forEach(function (p) {
        var cell = getCell(dataMap, project.id, m.ym, p.id);
        totalRate   += (cell.rate     || 0);
        totalCash   += (cell.cash     || 0);
        totalSelf   += (cell.selfCash || 0);
        totalInkind += (cell.inkind   || 0);
      });
      var elRate   = document.getElementById('sum-rate-'     + mode + '-' + m.ym);
      var elCash   = document.getElementById('sum-cash-'     + mode + '-' + m.ym);
      var elSelf   = document.getElementById('sum-selfCash-' + mode + '-' + m.ym);
      var elInkind = document.getElementById('sum-inkind-'   + mode + '-' + m.ym);
      // v5.3: 월별 참여율 합계는 의미가 없어 일괄 '-' 표시 (개별 합산값 숨김)
      if (elRate)   elRate.textContent   = '-';
      if (hasRefund) {
        // v5.3: 합계 셀이 좁아서 '원'을 빼고 콤마 숫자만 표시 (다른 셀과 일관)
        if (elCash)   elCash.textContent   = totalCash   ? fmtMoneyFull(totalCash)   : '-';
        if (elSelf)   elSelf.textContent   = totalSelf   ? fmtMoneyFull(totalSelf)   : '-';
        if (elInkind) elInkind.textContent = totalInkind ? fmtMoneyFull(totalInkind) : '-';
      }
    });

    // v5.3: 행별 합계 (12개월 전체 — 접힌 월 포함) + 그랜드 토탈
    if (hasRefund) {
      var allYms = getAllMonths(state.year).map(function (m) { return m.ym; });
      var grandCash = 0, grandSelf = 0, grandInkind = 0;
      persons.forEach(function (p) {
        var rowCash = 0, rowSelf = 0, rowInkind = 0;
        allYms.forEach(function (ym) {
          var c = getCell(dataMap, project.id, ym, p.id);
          rowCash   += (c.cash     || 0);
          rowSelf   += (c.selfCash || 0);
          rowInkind += (c.inkind   || 0);
        });
        grandCash   += rowCash;
        grandSelf   += rowSelf;
        grandInkind += rowInkind;
        var elRowCash   = document.getElementById('total-cash-'     + mode + '-' + p.id);
        var elRowSelf   = document.getElementById('total-selfCash-' + mode + '-' + p.id);
        var elRowInkind = document.getElementById('total-inkind-'   + mode + '-' + p.id);
        if (elRowCash)   elRowCash.textContent   = rowCash   ? rowCash.toLocaleString('ko-KR')   : '-';
        if (elRowSelf)   elRowSelf.textContent   = rowSelf   ? rowSelf.toLocaleString('ko-KR')   : '-';
        if (elRowInkind) elRowInkind.textContent = rowInkind ? rowInkind.toLocaleString('ko-KR') : '-';
      });
      var elGrandCash   = document.getElementById('grand-cash-'     + mode);
      var elGrandSelf   = document.getElementById('grand-selfCash-' + mode);
      var elGrandInkind = document.getElementById('grand-inkind-'   + mode);
      if (elGrandCash)   elGrandCash.textContent   = grandCash   ? fmtMoneyFull(grandCash)   : '-';
      if (elGrandSelf)   elGrandSelf.textContent   = grandSelf   ? fmtMoneyFull(grandSelf)   : '-';
      if (elGrandInkind) elGrandInkind.textContent = grandInkind ? fmtMoneyFull(grandInkind) : '-';
    }
  }

  // v5 Step 4: 셀 input focus/blur 포맷 전환
  //   focus: 표시값 → raw (10%, 837,533 → 10, 837533)
  //   blur:  raw → 표시값
  // dataset.raw가 진실의 원천. input.value는 표시용.
  function onCellFocus(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('pl-cell-input')) return;
    if (input.readOnly) return;
    var raw = Number(input.dataset.raw || 0);
    input.value = raw ? String(raw) : '';
    // 다음 tick에 전체 선택 (모바일/데스크톱 양쪽에서 편집 빠르게)
    setTimeout(function () {
      try { input.select(); } catch (_e) {}
    }, 0);
  }
  function onCellBlur(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('pl-cell-input')) return;
    var field = input.dataset.field;
    var raw = Number(input.dataset.raw || 0);
    if (field === 'rate' || field === 'splitRate') {
      input.value = raw ? fmtCellRateDisplay(raw) : '';
    } else {
      // cash / inkind
      input.value = fmtCellMoneyDisplay(raw);
    }
  }

  // ====================================================================
  // 입력 이벤트: 참여율 → 현금/현물 자동 계산 + 저장
  // ====================================================================
  function onCellInput(e) {
    var input = e.target;
    if (!input.classList.contains('pl-cell-input')) return;

    var personId = input.dataset.personId;
    var ym       = input.dataset.ym;
    var field    = input.dataset.field;
    var mode     = input.dataset.mode;
    if (!personId || !ym || !field || !mode) return;

    var dataMap = mode === 'actual' ? state.actual : state.planned;
    var project = getProject();
    if (!project) return;

    var person = _allPersons.find(function (p) { return p.id === personId; });
    if (!person) return;

    // v5 Step 4: 표시값(콤마/%) 안전 파싱
    var val = parseCellNumber(input.value);

    if (field === 'rate') {
      if (val > 100) {
        val = 100;
        input.value = '100';
        input.classList.add('rate-danger');
        alert('참여율은 100%를 초과할 수 없습니다.');
        return;
      }
      input.dataset.raw = String(val);
      applyRateColor(input, val);

      // v7.4 나눔: 분류줄 참여율 — cell.rates[splitField]에 저장, 그 분류 금액=급여×%, cell.rate=세 분류 합.
      if (input.dataset.split === '1') {
        var sf = input.dataset.splitField;
        var roleSp = (state.personRoles && state.personRoles[personId]) || {};
        var pci = normalizeCi(roleSp.cashOrInkind);
        var cur = getCell(dataMap, project.id, ym, personId);
        var rates = cur.rates
          ? { cash: cur.rates.cash || 0, selfCash: cur.rates.selfCash || 0, inkind: cur.rates.inkind || 0 }
          : (function () { var s = { cash: 0, selfCash: 0, inkind: 0 }; var pf = moneyFieldOf(pci); s[pf] = cur.rate || 0; return s; })();
        rates[sf] = val;
        var salSp = getEffectiveMonthlySalary(person, ym);
        var sumRate = (rates.cash || 0) + (rates.selfCash || 0) + (rates.inkind || 0);
        setCell(dataMap, project.id, ym, personId, {
          rates: rates,
          cash:     Math.round(salSp * (rates.cash || 0) / 100),
          selfCash: Math.round(salSp * (rates.selfCash || 0) / 100),
          inkind:   Math.round(salSp * (rates.inkind || 0) / 100),
          rate: sumRate
        });
        // 같은 줄의 그 분류 금액(읽기전용) 표시 갱신
        var trSp = input.closest('tr');
        if (trSp) {
          var moneyInp = trSp.querySelector('.pl-input-' + sf + '[data-ym="' + ym + '"]');
          if (moneyInp) {
            var amt = Math.round(salSp * val / 100);
            moneyInp.dataset.raw = String(amt);
            moneyInp.value = fmtCellMoneyDisplay(amt);
          }
        }
        var monthsSp = getVisibleMonths();
        recalcSums(mode, monthsSp, getPersons(), project, dataMap);
        renderStickyBoxes();
        scheduleSave();
        return;
      }

      // v7.4 §3.4: personRoles.cashOrInkind 에 따라 자동계산값을 cash/selfCash/inkind 중 적절한 쪽에 채움
      //   '현금'(지원금) → cash (환급 대상) / '자부담현금' → selfCash (환급 X) / '현물' → inkind (환급 X)
      // personRoles 미설정/잘못된 값이면 안전하게 '현금'(cash)으로 폴백.
      var role = (state.personRoles && state.personRoles[personId]) || {};
      var targetField = moneyFieldOf(role.cashOrInkind);
      var otherFields = otherMoneyFields(targetField);   // 나머지 두 금액 필드
      var autoAmount = Math.round(getEffectiveMonthlySalary(person, ym) * val / 100);

      var patch = { rate: val };
      patch[targetField] = autoAmount;
      otherFields.forEach(function (f) { patch[f] = 0; });   // 반대편 필드 0으로 (분류 변경 후 옛값 잔존 방지)
      setCell(dataMap, project.id, ym, personId, patch);

      // 같은 행의 해당 필드 input 시각도 갱신
      //   - 포커스 중인 input이면 raw 그대로(편집 방해 X), 아니면 콤마 포맷
      var tr = input.closest('tr');
      if (tr) {
        var sel = '.pl-input-' + targetField + '[data-ym="' + ym + '"]';
        var moneyInput = tr.querySelector(sel);
        if (moneyInput) {
          moneyInput.dataset.raw = String(autoAmount);
          if (document.activeElement === moneyInput) {
            moneyInput.value = autoAmount ? String(autoAmount) : '';
          } else {
            moneyInput.value = fmtCellMoneyDisplay(autoAmount);
          }
        }
        // v7.4: 나머지 금액 input도 0으로 갱신 (시각/dataset 동기화)
        otherFields.forEach(function (f) {
          var otherInput = tr.querySelector('.pl-input-' + f + '[data-ym="' + ym + '"]');
          if (otherInput) {
            otherInput.dataset.raw = '0';
            if (document.activeElement === otherInput) {
              otherInput.value = '';
            } else {
              otherInput.value = fmtCellMoneyDisplay(0);
            }
          }
        });
      }
    } else if (field === 'splitRate') {
      // v7.4 나눔: 이 칸은 분류(splitField)의 참여율(%). 금액=급여×%, 참여율 셀=세 분류 합.
      var sf = input.dataset.splitField;
      if (val > 100) { val = 100; input.value = '100'; }
      input.dataset.raw = String(val);
      applyRateColor(input, val);
      var roleSp = (state.personRoles && state.personRoles[personId]) || {};
      var pci = normalizeCi(roleSp.cashOrInkind);
      var cur = getCell(dataMap, project.id, ym, personId);
      var rates = cur.rates
        ? { cash: cur.rates.cash || 0, selfCash: cur.rates.selfCash || 0, inkind: cur.rates.inkind || 0 }
        : (function () { var s = { cash: 0, selfCash: 0, inkind: 0 }; s[pci] = cur.rate || 0; return s; })();
      rates[sf] = val;
      var sal = getEffectiveMonthlySalary(person, ym);
      var sumRate = (rates.cash || 0) + (rates.selfCash || 0) + (rates.inkind || 0);
      setCell(dataMap, project.id, ym, personId, {
        rates: rates,
        cash:     Math.round(sal * (rates.cash || 0) / 100),
        selfCash: Math.round(sal * (rates.selfCash || 0) / 100),
        inkind:   Math.round(sal * (rates.inkind || 0) / 100),
        rate: sumRate
      });
      // 같은 행 참여율(합) 셀 갱신
      var trSp = input.closest('tr');
      if (trSp) {
        var rateInp = trSp.querySelector('.pl-cell-input[data-field="rate"][data-ym="' + ym + '"]');
        if (rateInp) {
          rateInp.dataset.raw = String(sumRate);
          rateInp.value = fmtCellRateDisplay(sumRate);
          applyRateColor(rateInp, sumRate);
        }
      }
    } else {
      input.dataset.raw = String(val);
      var patch2 = {};
      patch2[field] = val;
      setCell(dataMap, project.id, ym, personId, patch2);
    }

    var months = getVisibleMonths();   // v5 Step 2
    recalcSums(mode, months, getPersons(), project, dataMap);
    renderStickyBoxes();   // v5 Step 2: 셀 변경 즉시 누계/차액 갱신
    scheduleSave();
  }

  // ----------------------------------------------------------------------
  // v5.2 — 월급 셀 (예상 탭) 편집 핸들러
  // ----------------------------------------------------------------------
  //  - 빈 값 또는 0: override 해제 (인력 마스터 값으로 복원)
  //  - 양수: personRoles[pid].monthlySalaryOverride 에 저장
  //  - 변경 후: 그 인력의 모든 예상 cells의 cash/inkind를 새 월급으로 자동 재계산
  //  - 실제 탭에 이미 confirmedAt이 있는 월의 actual cells는 건드리지 않음 (확정된 사실)
  //  - 묶음 undo entry — 한 번 Ctrl+Z로 전체 복원
  function onSalaryInputBlur(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('pl-salary-input')) return;
    var pid = input.dataset.personId;
    if (!pid) return;
    var project = getProject();
    if (!project) return;
    var person = _allPersons.find(function (p) { return p.id === pid; });
    if (!person) return;

    // 입력값 파싱 (콤마 제거 후 숫자)
    var raw = String(input.value || '').replace(/[^\d]/g, '');
    var newOverride = raw ? Number(raw) : 0;
    if (!isFinite(newOverride) || newOverride < 0) newOverride = 0;

    if (!state.personRoles) state.personRoles = {};
    if (!state.personRoles[pid]) {
      state.personRoles[pid] = {
        newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null
      };
    }
    var oldOverride = state.personRoles[pid].monthlySalaryOverride;
    var oldEffective = (typeof oldOverride === 'number' && oldOverride > 0)
      ? oldOverride
      : (person.monthlySalary || 0);

    // 변경 없음 → 표시만 정리 후 종료
    var willOverride = (newOverride > 0 && newOverride !== (person.monthlySalary || 0));
    var newOverrideStored = willOverride ? newOverride : null;
    var newEffective = willOverride ? newOverride : (person.monthlySalary || 0);
    if (oldOverride === newOverrideStored) {
      // 표시 갱신만
      input.dataset.raw = String(newEffective || 0);
      input.value = newEffective ? newEffective.toLocaleString('ko-KR') : '';
      return;
    }

    // 영향 받는 cells 수집 (예상 탭만 — 자동 재계산은 예상 한정)
    var dataMap = state.planned;
    var months  = getAllMonths(state.year);
    var role    = state.personRoles[pid];
    var moneyField = moneyFieldOf(role.cashOrInkind);   // v7.4: 지원금/현금/현물 중 해당 필드
    var batchItems = [];

    months.forEach(function (m) {
      var cell = getCell(dataMap, project.id, m.ym, pid);
      var rate     = cell.rate || 0;
      if (rate === 0) return;   // 참여율 없으면 건드리지 않음

      // v7.4 나눔: split 인력은 cell.rates 기준으로 cash/selfCash/inkind 모두 재계산
      if (role.split && cell.rates) {
        var rr = cell.rates;
        ['cash', 'selfCash', 'inkind'].forEach(function (f) {
          var oldM = cell[f] || 0;
          var newM = Math.round(newEffective * (+rr[f] || 0) / 100);
          if (newM === oldM) return;
          batchItems.push({ personId: pid, ym: m.ym, field: f, oldVal: oldM, newVal: newM });
          var p = {}; p[f] = newM;
          setCell(dataMap, project.id, m.ym, pid, p);
        });
        return;
      }

      var oldMoney = cell[moneyField] || 0;
      var newMoney = Math.round(newEffective * rate / 100);
      if (newMoney === oldMoney) return;
      batchItems.push({
        personId: pid, ym: m.ym, field: moneyField,
        oldVal: oldMoney, newVal: newMoney
      });
      var patch = {};
      patch[moneyField] = newMoney;
      setCell(dataMap, project.id, m.ym, pid, patch);
    });

    // 월급 오버라이드 자체도 묶음에 포함 (override의 변경도 undo 가능하도록)
    batchItems.push({
      personId: pid, field: '__salaryOverride',
      oldVal: oldOverride, newVal: newOverrideStored
    });
    state.personRoles[pid].monthlySalaryOverride = newOverrideStored;

    // 묶음 undo entry
    _undoStack.push({
      batch: true,
      mode: 'planned',
      label: '월급 변경 (' + person.name + ': ' +
             (oldEffective || 0).toLocaleString('ko-KR') + ' → ' +
             newEffective.toLocaleString('ko-KR') + ')',
      items: batchItems
    });
    if (_undoStack.length > 50) _undoStack.shift();

    renderAll();
    scheduleSave();

    var affectedMonths = batchItems.length - 1;  // override 항목 제외
    if (affectedMonths > 0) {
      showToast('💰 ' + person.name + ' 월급 변경 — ' + affectedMonths + '개 월 재계산', 'success');
    } else if (newOverrideStored === null) {
      showToast('💰 ' + person.name + ' 월급 오버라이드 해제 (마스터 값으로 복원)', 'success');
    } else {
      showToast('💰 ' + person.name + ' 월급 ' + newEffective.toLocaleString('ko-KR') + '원 설정', 'success');
    }
  }

  // 월급 input focus — raw 모드 (콤마 제거)로 전환해서 편집 쉽게
  function onSalaryInputFocus(e) {
    var input = e.target;
    if (!input || !input.classList || !input.classList.contains('pl-salary-input')) return;
    var raw = Number(input.dataset.raw || 0);
    input.value = raw ? String(raw) : '';
    setTimeout(function () { try { input.select(); } catch (_e) {} }, 0);
  }

  // 월급 input keydown — Enter로 blur 트리거
  function onSalaryInputKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // 원래 값으로 복원 후 blur
      var raw = Number(e.target.dataset.raw || 0);
      e.target.value = raw ? raw.toLocaleString('ko-KR') : '';
      e.target.blur();
    }
  }


  // ----------------------------------------------------------------------
  //  - 예상 탭의 참여율 셀에서 우클릭 또는 Ctrl+R
  //  - 현재 셀의 rate를 같은 행의 12월까지 덮어쓰기 (참여율만)
  //  - 각 월의 cash/inkind는 monthlySalary × rate 로 재계산
  //    · personRoles.cashOrInkind에 따라 cash 또는 inkind 필드로
  //  - 묶음 undo entry — 한 번의 Ctrl+Z로 전체 복원
  //  - Toast "N개 월 채움"
  function fillRateToYearEnd(personId, fromYm, sourceRate) {
    var project = getProject();
    if (!project) return;
    // 예상 탭 한정
    if (state.activeTab !== 'planned') {
      showToast('가로 채우기는 예상 탭에서만 사용할 수 있습니다.', 'warn');
      return;
    }
    var person = _allPersons.find(function (p) { return p.id === personId; });
    if (!person) return;

    // 현재 연도의 모든 12개월 (접힌 월도 포함)
    var year = state.year;
    var allMonths = getAllMonths(year);

    // fromYm 이후의 월만 (자기 자신 제외 — 자신은 이미 그 값)
    var fromIdx = -1;
    for (var i = 0; i < allMonths.length; i++) {
      if (allMonths[i].ym === fromYm) { fromIdx = i; break; }
    }
    if (fromIdx < 0) return;
    var targets = allMonths.slice(fromIdx + 1);   // fromYm 다음 월부터 12월까지
    // v5.3: 셀 잠금 정책과 일치 — 퇴사월 이후/입사월 이전/사용자 잠금 모두 제외
    var exitYm = (person.status === 'exited') ? getExitYm(person) : null;
    var hireYm = getHireYm(person);
    targets = targets.filter(function (m) {
      if (exitYm && m.ym > exitYm) return false;
      if (hireYm && m.ym < hireYm) return false;
      if (isYmManuallyLocked(personId, m.ym)) return false;
      return true;
    });
    if (targets.length === 0) {
      showToast('이미 12월입니다. 채울 월이 없습니다.', 'info');
      return;
    }

    var rate = parseCellNumber(sourceRate);
    if (rate > 100) rate = 100;
    if (rate < 0)   rate = 0;

    var role = (state.personRoles && state.personRoles[personId]) || {};
    var moneyField = moneyFieldOf(role.cashOrInkind);   // v7.4: 지원금/현금/현물
    var otherFields = otherMoneyFields(moneyField);     // 나머지 두 금액 필드

    // v5.3: source 월(fromYm)의 실제 입력값을 그대로 가져옴.
    //   - 이전엔 monthlySalary × rate 로 재계산해서 버림/수동 조정값이 무시됐음.
    //   - 이제는 1월에 100원 단위 버림한 값을 그대로 12월까지 복사함.
    //   - source의 moneyField 값이 0이거나 없으면 폴백으로 자동 계산값 사용.
    var dataMap = state.planned;
    var srcCell = getCell(dataMap, project.id, fromYm, personId);
    var srcAmount = srcCell[moneyField] || 0;
    if (srcAmount === 0) {
      // 폴백: source 셀에 값이 없으면 raw 계산값 사용 (이전 동작)
      var monthlySalary = getEffectiveMonthlySalary(person, fromYm);
      srcAmount = Math.round(monthlySalary * rate / 100);
    }
    var autoAmount = srcAmount;

    // 묶음 undo entry — 채울 월 각각의 이전 값 기록
    var batchItems = [];
    targets.forEach(function (m) {
      var prev = getCell(dataMap, project.id, m.ym, personId);
      // rate 변경
      batchItems.push({
        personId: personId, ym: m.ym, field: 'rate',
        oldVal: prev.rate || 0, newVal: rate
      });
      // money 변경 (현재 분류에 해당하는 필드: cash/selfCash/inkind)
      batchItems.push({
        personId: personId, ym: m.ym, field: moneyField,
        oldVal: prev[moneyField] || 0, newVal: autoAmount
      });
      // v7.4: 나머지 두 금액 필드도 0으로 덮어씀 (분류 변경 후 옛값 잔존 방지).
      //   기존 값이 이미 0이면 undo entry 추가 안 함 (스택 절약).
      otherFields.forEach(function (of) {
        var otherOld = prev[of] || 0;
        if (otherOld !== 0) {
          batchItems.push({
            personId: personId, ym: m.ym, field: of,
            oldVal: otherOld, newVal: 0
          });
        }
      });
      // setCell — rate + money(현재) + 나머지 금액 0 한 번에
      var patch = { rate: rate };
      patch[moneyField] = autoAmount;
      otherFields.forEach(function (of) { patch[of] = 0; });
      setCell(dataMap, project.id, m.ym, personId, patch);
    });

    // 묶음 entry 1개로 push
    _undoStack.push({
      batch: true,
      mode: 'planned',
      label: '가로 채우기 (' + targets.length + '개 월)',
      items: batchItems
    });
    if (_undoStack.length > 50) _undoStack.shift();

    // 렌더링 갱신 — renderAll보단 buildTable + sticky가 가벼움
    buildTable(document.getElementById('pl-table-planned'), 'planned');
    renderStickyBoxes();
    scheduleSave();
    showToast('→ ' + targets.length + '개 월 채움 (' + rate + '%)', 'success');
  }

  // v5.3: 단일 셀 버림 — 우클릭 메뉴에서 호출
  //   - 예상 탭의 cash/inkind 셀에만 적용
  //   - 현재 값을 unit 단위로 내림 (Math.floor)
  //   - 한번성: 이후 참여율이 변경되면 자동 계산이 다시 돌아 원래 값으로 복원됨
  //   - undo 가능 (단일 entry)
  function roundDownCell(personId, ym, field, unit) {
    if (field !== 'cash' && field !== 'inkind') return;
    if (!unit || unit <= 1) return;
    var project = getProject();
    if (!project) return;
    if (state.activeTab !== 'planned') {
      showToast('버림은 예상 탭에서만 사용할 수 있습니다.', 'warn');
      return;
    }

    var dataMap = state.planned;
    var prev = getCell(dataMap, project.id, ym, personId);
    var oldVal = prev[field] || 0;
    if (oldVal <= 0) {
      showToast('값이 없는 셀입니다.', 'info');
      return;
    }
    var newVal = Math.floor(oldVal / unit) * unit;
    if (newVal === oldVal) {
      showToast('이미 ' + fmtUnitLabel(unit) + ' 단위입니다.', 'info');
      return;
    }

    var patch = {};
    patch[field] = newVal;
    setCell(dataMap, project.id, ym, personId, patch);

    // undo 등록 (단일 entry)
    _undoStack.push({
      batch: false,
      mode: 'planned',
      personId: personId, ym: ym, field: field,
      oldVal: oldVal, newVal: newVal,
      label: '버림 (' + fmtUnitLabel(unit) + ')'
    });
    if (_undoStack.length > 50) _undoStack.shift();

    buildTable(document.getElementById('pl-table-planned'), 'planned');
    renderStickyBoxes();
    scheduleSave();
    showToast(oldVal.toLocaleString() + ' → ' + newVal.toLocaleString(), 'success');
  }
  // 버림 단위 라벨 헬퍼
  function fmtUnitLabel(unit) {
    if (unit >= 10000) return (unit / 10000) + '만원';
    return unit.toLocaleString() + '원';
  }

  // v5.3: 사용자 직접 셀 잠금 토글
  //   - 잠금: 해당 인력의 해당 월(rate/cash/inkind 셀 전체)을 readOnly + 회색으로
  //   - 해제: 다시 입력 가능
  //   - 데이터는 보존됨 (셀 값이 지워지지는 않음)
  //   - Ctrl+Z 대상 아님 — 사용자가 의도적으로 토글하는 거니까
  function toggleManualLock(personId, ym) {
    var wasLocked = isYmManuallyLocked(personId, ym);
    setYmLocked(personId, ym, !wasLocked);
    buildTable(document.getElementById('pl-table-planned'), 'planned');
    renderStickyBoxes();
    scheduleSave();
    showToast(wasLocked ? '🔓 ' + ym + ' 잠금 해제' : '🔒 ' + ym + ' 잠금', 'success');
  }

  // v5.3: 셀 글자색 변경 (단일 셀, 단일 필드)
  //   - colorKey: 'red' / 'blue' / 'green' / null (기본)
  //   - 데이터 저장 + 해당 input 즉시 갱신 (buildTable 전체 재호출 없이)
  //   - Ctrl+Z 대상 아님 (간단한 시각 변경이므로)
  function applyCellColor(personId, ym, field, colorKey) {
    var project = getProject();
    if (!project) return;
    if (state.activeTab !== 'planned') {
      showToast('색 변경은 예상 탭에서만 사용할 수 있습니다.', 'warn');
      return;
    }
    setCellColor(state.planned, project.id, ym, personId, field, colorKey);
    // 해당 input만 즉시 갱신 (전체 재렌더 불필요)
    var table = document.getElementById('pl-table-planned');
    if (table) {
      var input = table.querySelector(
        '.pl-cell-input[data-person-id="' + personId + '"][data-ym="' + ym + '"][data-field="' + field + '"]'
      );
      if (input) applyCellColorToInput(input, colorKey);
    }
    scheduleSave();
  }

  // v5.3: 아래로 복사 (같은 자릿수 버림) — 우클릭 메뉴에서 호출
  //   - 예상 탭의 cash/inkind 셀에서, 같은 월의 이 행 '아래' 모든 인력에 동일 자릿수 버림 적용
  //   - 단, 잠긴 셀(퇴사월 이후/입사월 이전)이나 값이 0인 셀은 건너뜀
  //   - 묶음 undo entry — 한 번의 Ctrl+Z로 전부 복원
  function roundDownBelow(originPersonId, ym, field, unit) {
    if (field !== 'cash' && field !== 'inkind') return;
    if (!unit || unit <= 1) return;
    var project = getProject();
    if (!project) return;
    if (state.activeTab !== 'planned') {
      showToast('버림은 예상 탭에서만 사용할 수 있습니다.', 'warn');
      return;
    }

    // 현재 personIds 순서에서 origin 다음 인덱스부터 끝까지 = 대상
    var ids = state.personIds || [];
    var startIdx = ids.indexOf(originPersonId);
    if (startIdx < 0) return;
    var targetIds = ids.slice(startIdx + 1);
    if (targetIds.length === 0) {
      showToast('이 행 아래에 인력이 없습니다.', 'info');
      return;
    }

    var dataMap = state.planned;
    var batchItems = [];
    var changed = 0;
    var skippedLocked = 0;

    targetIds.forEach(function (pid) {
      var person = _allPersons.find(function (p) { return p.id === pid; });
      if (!person) return;

      // 잠금 체크 — buildDataRow와 같은 정책
      var exitYm = (person.status === 'exited') ? getExitYm(person) : null;
      var hireYm = getHireYm(person);
      if (exitYm && ym > exitYm) { skippedLocked++; return; }
      if (hireYm && ym < hireYm) { skippedLocked++; return; }
      if (isYmManuallyLocked(pid, ym)) { skippedLocked++; return; }

      var prev = getCell(dataMap, project.id, ym, pid);
      var oldVal = prev[field] || 0;
      if (oldVal <= 0) return;  // 값 없는 셀은 건너뜀 (스킵 카운트엔 포함 안 함 — 사용자 입장에서 자연스럽게 패스)
      var newVal = Math.floor(oldVal / unit) * unit;
      if (newVal === oldVal) return;  // 이미 단위 맞으면 패스

      batchItems.push({
        personId: pid, ym: ym, field: field,
        oldVal: oldVal, newVal: newVal
      });

      var patch = {};
      patch[field] = newVal;
      setCell(dataMap, project.id, ym, pid, patch);
      changed++;
    });

    if (changed === 0) {
      if (skippedLocked > 0) {
        showToast('아래 ' + skippedLocked + '개 셀이 잠겨있어 건너뜀.', 'info');
      } else {
        showToast('적용할 셀이 없습니다.', 'info');
      }
      return;
    }

    _undoStack.push({
      batch: true,
      mode: 'planned',
      label: '아래로 버림 복사 (' + fmtUnitLabel(unit) + ', ' + changed + '개)',
      items: batchItems
    });
    if (_undoStack.length > 50) _undoStack.shift();

    buildTable(document.getElementById('pl-table-planned'), 'planned');
    renderStickyBoxes();
    scheduleSave();
    var msg = '↓ ' + changed + '개 셀에 ' + fmtUnitLabel(unit) + ' 단위 버림';
    if (skippedLocked > 0) msg += ' (잠긴 ' + skippedLocked + '개 제외)';
    showToast(msg, 'success');
  }

  // 우클릭 컨텍스트 메뉴 — 예상 탭만, 참여율 셀(채우기)과 현금/현물 셀(버림)에서 표시
  function onCellContextMenu(e) {
    // C3: 비교 탭 메모 셀(td, input 아님) — 예상행/실제행 참여율 셀에서 메모 추가/편집(메모 전용 메뉴)
    var memoTd = e.target.closest && e.target.closest('.pl-compare-memocell');
    if (memoTd && memoTd.dataset.personId && memoTd.dataset.ym && memoTd.dataset.mode) {
      e.preventDefault();
      showCellContextMenu(e.clientX, e.clientY, memoTd.dataset.personId, memoTd.dataset.ym, '0', 'rate', memoTd.dataset.mode);
      return;
    }

    var input = e.target;
    if (!input.classList || !input.classList.contains('pl-cell-input')) return;
    // C3: 예상 탭은 전체 메뉴, 실제 탭은 메모 전용 메뉴(showCellContextMenu에서 분기)
    var cmMode = input.dataset.mode;
    if (cmMode !== 'planned' && cmMode !== 'actual') return;
    var field = input.dataset.field;
    if (field !== 'rate' && field !== 'cash' && field !== 'inkind') return;
    e.preventDefault();

    var personId = input.dataset.personId;
    var ym       = input.dataset.ym;
    var raw      = input.dataset.raw || '0';
    if (!personId || !ym) return;

    showCellContextMenu(e.clientX, e.clientY, personId, ym, raw, field, cmMode);
  }

  var _ctxMenuEl = null;

  function showCellContextMenu(x, y, personId, ym, raw, field, mode) {
    hideCellContextMenu();
    mode = mode || 'planned';
    var menu = document.createElement('div');
    menu.className = 'pl-ctx-menu';

    // C3: 실제 탭(비교 탭 실제행 포함) — 메모 전용 메뉴(값 편집/잠금/색은 예상 탭만)
    if (mode === 'actual') {
      var _aproj = getProject();
      var _acell = _aproj ? (state.actual[getLaborKey(_aproj.id, ym, personId)] || {}) : {};
      var _ahasMemo = !!(_acell.memo && _acell.memo.trim());
      menu.innerHTML =
        '<button type="button" class="pl-ctx-item" data-action="memo">' +
          '💬 메모 ' + (_ahasMemo ? '편집' : '추가') +
        '</button>';
      document.body.appendChild(menu);
      _ctxMenuEl = menu;
      positionAndBindCtxMenu(menu, x, y, personId, ym, raw, field, mode);
      return;
    }

    // v5.3: 사용자 잠금 셀은 어느 필드든 '잠금 해제' 메뉴만 표시
    //   v7.4.3: 단, 메모는 값이 아닌 주석이므로 잠금과 무관하게 추가/편집 허용
    if (isYmManuallyLocked(personId, ym)) {
      var _lproj = getProject();
      var _lcell = _lproj ? (state.planned[getLaborKey(_lproj.id, ym, personId)] || {}) : {};
      var _lhasMemo = !!(_lcell.memo && _lcell.memo.trim());
      menu.innerHTML =
        '<button type="button" class="pl-ctx-item" data-action="memo">' +
          '💬 메모 ' + (_lhasMemo ? '편집' : '추가') +
        '</button>' +
        '<div class="pl-ctx-divider"></div>' +
        '<button type="button" class="pl-ctx-item" data-action="toggle-lock">' +
          '🔓 이 월 잠금 해제' +
        '</button>';
      document.body.appendChild(menu);
      _ctxMenuEl = menu;
      positionAndBindCtxMenu(menu, x, y, personId, ym, raw, field, mode);
      return;
    }

    var html = '';
    // v7.4.3 §4.1: 메모 — 모든 필드 공통, 맨 위
    var _mproj = getProject();
    var _mcell = _mproj ? (state.planned[getLaborKey(_mproj.id, ym, personId)] || {}) : {};
    var _hasMemo = !!(_mcell.memo && _mcell.memo.trim());
    html +=
      '<button type="button" class="pl-ctx-item" data-action="memo">' +
        '💬 메모 ' + (_hasMemo ? '편집' : '추가') +
      '</button>' +
      '<div class="pl-ctx-divider"></div>';
    if (field === 'rate') {
      // 참여율 셀 — 12월까지 채우기 + 이 월 잠그기
      html +=
        '<button type="button" class="pl-ctx-item" data-action="fill-right">' +
          '→ 이 월부터 12월까지 채우기 ' +
          '<span class="pl-ctx-kbd">Ctrl+R</span>' +
        '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="toggle-lock">' +
          '🔒 이 월 잠그기' +
        '</button>';
    } else {
      // 현금/현물 셀 — 버림 (이 셀만 + 아래로 복사)
      html +=
        '<div class="pl-ctx-section-title">버림 (이 셀만)</div>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down" data-unit="10">'      + '10원 단위'      + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down" data-unit="100">'     + '100원 단위'     + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down" data-unit="1000">'    + '1,000원 단위'   + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down" data-unit="10000">'   + '10,000원 단위'  + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down" data-unit="100000">'  + '100,000원 단위' + '</button>' +
        '<div class="pl-ctx-divider"></div>' +
        '<div class="pl-ctx-section-title">↓ 아래로 복사</div>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down-below" data-unit="10">'      + '10원 단위'      + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down-below" data-unit="100">'     + '100원 단위'     + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down-below" data-unit="1000">'    + '1,000원 단위'   + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down-below" data-unit="10000">'   + '10,000원 단위'  + '</button>' +
        '<button type="button" class="pl-ctx-item" data-action="round-down-below" data-unit="100000">'  + '100,000원 단위' + '</button>';
    }

    // v5.3: 글자색 변경 (모든 셀 공통, 잠금 셀 제외)
    html +=
      '<div class="pl-ctx-divider"></div>' +
      '<div class="pl-ctx-section-title">글자색</div>' +
      '<div class="pl-ctx-color-row">' +
        '<button type="button" class="pl-ctx-color-btn" data-action="set-color" data-color="" title="기본">' +
          '<span class="pl-ctx-color-swatch pl-ctx-color-default">A</span>' +
        '</button>' +
        '<button type="button" class="pl-ctx-color-btn" data-action="set-color" data-color="red" title="빨강">' +
          '<span class="pl-ctx-color-swatch" style="color:#dc2626">A</span>' +
        '</button>' +
        '<button type="button" class="pl-ctx-color-btn" data-action="set-color" data-color="blue" title="파랑">' +
          '<span class="pl-ctx-color-swatch" style="color:#2563eb">A</span>' +
        '</button>' +
        '<button type="button" class="pl-ctx-color-btn" data-action="set-color" data-color="green" title="초록">' +
          '<span class="pl-ctx-color-swatch" style="color:#16a34a">A</span>' +
        '</button>' +
      '</div>';

    menu.innerHTML = html;
    document.body.appendChild(menu);
    _ctxMenuEl = menu;
    positionAndBindCtxMenu(menu, x, y, personId, ym, raw, field, mode);
  }

  // v5.3: 메뉴 위치 보정 + 클릭 핸들러 — 공통화
  // C3: mode(planned/actual) — 메모 팝오버 타깃 결정
  function positionAndBindCtxMenu(menu, x, y, personId, ym, raw, field, mode) {
    // 화면 밖으로 나가지 않게 위치 보정
    var rect = menu.getBoundingClientRect();
    var maxX = window.innerWidth - rect.width - 8;
    var maxY = window.innerHeight - rect.height - 8;
    menu.style.left = Math.min(x, maxX) + 'px';
    menu.style.top  = Math.min(y, maxY) + 'px';

    menu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      hideCellContextMenu();
      if (action === 'fill-right') {
        fillRateToYearEnd(personId, ym, raw);
      } else if (action === 'round-down') {
        var unit = parseInt(btn.dataset.unit, 10) || 0;
        if (unit > 0) roundDownCell(personId, ym, field, unit);
      } else if (action === 'round-down-below') {
        var unit2 = parseInt(btn.dataset.unit, 10) || 0;
        if (unit2 > 0) roundDownBelow(personId, ym, field, unit2);
      } else if (action === 'toggle-lock') {
        toggleManualLock(personId, ym);
      } else if (action === 'set-color') {
        var colorKey = btn.dataset.color || '';
        applyCellColor(personId, ym, field, colorKey || null);
      } else if (action === 'memo') {
        openMemoPopover(personId, ym, mode || 'planned', { left: x, top: y });
      }
    });
  }

  function hideCellContextMenu() {
    if (_ctxMenuEl && _ctxMenuEl.parentNode) {
      _ctxMenuEl.parentNode.removeChild(_ctxMenuEl);
    }
    _ctxMenuEl = null;
  }

  // ====================================================================
  // v7.4.3 §4.1: 셀 메모 — 모서리 마커 + 편집 팝오버
  //   - 데이터: cell.memo (셀 키 {projectId}_{ym}_{personId}, 나눔도 동일 키)
  //   - 진입: 우클릭 메뉴 "메모" 항목 / 메모 있는 셀의 모서리 마커 클릭
  //   - C3(v8.3): 예상·실제 탭 모두 편집(실제는 메모 전용 메뉴). 비교 탭은 예상행→planned·실제행→actual 마커+우클릭, 차이행 비허용.
  // ====================================================================
  function buildMemoMarker(personId, ym, mode, memo) {
    var mk = document.createElement('span');
    mk.className = 'pl-memo-marker';
    mk.dataset.personId = personId;
    mk.dataset.ym = ym;
    mk.dataset.mode = mode;
    mk.setAttribute('aria-label', '메모');
    mk.title = memo || '메모';
    return mk;
  }

  var _memoPopEl = null;
  function closeMemoPopover() {
    if (_memoPopEl && _memoPopEl.parentNode) _memoPopEl.parentNode.removeChild(_memoPopEl);
    _memoPopEl = null;
    document.removeEventListener('mousedown', onMemoOutside, true);
  }
  function onMemoOutside(e) {
    if (!_memoPopEl) return;
    if (_memoPopEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.pl-memo-marker')) return;  // 다른 마커 클릭은 별도 처리
    closeMemoPopover();
  }
  function onMemoMarkerClick(e) {
    var mk = e.target.closest && e.target.closest('.pl-memo-marker');
    if (!mk) return;
    e.stopPropagation();
    openMemoPopover(mk.dataset.personId, mk.dataset.ym, mk.dataset.mode || 'planned', mk.getBoundingClientRect());
  }

  // anchor = DOMRect 또는 {left, top}
  function openMemoPopover(personId, ym, mode, anchor) {
    closeMemoPopover();
    hideCellContextMenu();
    var project = getProject();
    if (!project) return;
    // C3: 예상·실제 탭 모두 편집 가능(차이행은 호출 자체를 안 함). 비교 탭은 예상행→planned·실제행→actual.
    var editable = (mode === 'planned' || mode === 'actual');
    var dataMap  = (mode === 'actual') ? state.actual : state.planned;
    var cell = getCell(dataMap, project.id, ym, personId);
    var memo = cell.memo || '';
    var person = (getPersons() || []).find(function (p) { return p.id === personId; });
    var pname = person ? (person.name || '') : '';

    var pop = document.createElement('div');
    pop.className = 'pl-memo-popover';

    var head = document.createElement('div');
    head.className = 'pl-memo-pop-head';
    head.appendChild(document.createTextNode('💬 ' + pname + ' '));
    var ymSpan = document.createElement('span');
    ymSpan.className = 'pl-memo-pop-ym';
    ymSpan.textContent = ym;
    head.appendChild(ymSpan);
    if (!editable) {
      head.appendChild(document.createTextNode(' (읽기 전용)'));
    }
    pop.appendChild(head);

    var ta = document.createElement('textarea');
    ta.className = 'pl-memo-pop-textarea';
    ta.placeholder = '메모를 입력하세요';
    ta.value = memo;
    if (!editable) ta.readOnly = true;
    pop.appendChild(ta);

    var act = document.createElement('div');
    act.className = 'pl-memo-pop-actions';
    function mkBtn(cls, text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pl-memo-pop-btn ' + cls;
      b.textContent = text;
      return b;
    }
    if (editable) {
      if (memo) act.appendChild(mkBtn('pl-memo-pop-del', '삭제'));
      act.appendChild(mkBtn('pl-memo-pop-cancel', '취소'));
      act.appendChild(mkBtn('pl-memo-pop-save', '저장'));
    } else {
      act.appendChild(mkBtn('pl-memo-pop-cancel', '닫기'));
    }
    pop.appendChild(act);

    if (editable) {
      var hint = document.createElement('div');
      hint.className = 'pl-memo-pop-hint';
      hint.textContent = 'Ctrl+Enter 저장 · Esc 취소';
      pop.appendChild(hint);
    }

    document.body.appendChild(pop);
    _memoPopEl = pop;

    // 위치: anchor 우하단 근처, 화면 밖 보정
    var ax = anchor ? (anchor.left != null ? anchor.left : (anchor.x || 0)) : 0;
    var ay = anchor ? (anchor.bottom != null ? anchor.bottom : (anchor.top || 0)) : 0;
    var r = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(ax, window.innerWidth  - r.width  - 12)) + 'px';
    pop.style.top  = Math.max(8, Math.min(ay + 6, window.innerHeight - r.height - 12)) + 'px';

    function doSave() {
      setCell(dataMap, project.id, ym, personId, { memo: ta.value.trim() });
      scheduleSave(); closeMemoPopover(); renderAll();
    }
    function doDelete() {
      setCell(dataMap, project.id, ym, personId, { memo: '' });
      scheduleSave(); closeMemoPopover(); renderAll();
    }
    pop.addEventListener('click', function (e) {
      if (e.target.closest('.pl-memo-pop-save')) doSave();
      else if (e.target.closest('.pl-memo-pop-del')) doDelete();
      else if (e.target.closest('.pl-memo-pop-cancel')) closeMemoPopover();
    });
    if (editable) {
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (err) {}
    }
    // 전역 셀 단축키(Ctrl+Z/R/C/V, 방향키)가 메모 입력을 가로채지 않게 차단
    ta.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeMemoPopover(); }
      else if (editable && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
    });
    setTimeout(function () { document.addEventListener('mousedown', onMemoOutside, true); }, 0);
  }

  // 월 확정 버튼 — v5.1 변경
  // 기존: sysReg / amtConf 2개 체크박스 (단순 표식)
  // 변경: "확정" 버튼 1개 — 클릭 시 해당 월 예상값을 실제 탭으로 복사 + 메타 기록
  //   - 예상 탭에서만 의미 있음 (실제/비교 탭에서는 노출 안 함)
  //   - 이미 확정된 월에 재클릭 시 경고 (실제값 덮어쓰기)
  //   - 데이터 모델: meta[ym] = { confirmed: bool, confirmedAt: ISO }
  // v5 Step 4: personRoles 드롭다운(change) 핸들러
  // - newOrExisting 또는 cashOrInkind 변경 시 즉시 state 갱신 + 저장
  // - 탭 간 동기화: switchTab은 buildTable을 재호출하지 않으므로 모든 탭이
  //   같은 personRoles를 반영하려면 renderAll() 필요.
  //   드롭다운 선택 후엔 포커스가 머물 필요 없으므로 비용 부담 없음.
  function onRoleChange(e) {
    var sel = e.target;
    if (!sel) return;
    // SELECT(기존/신규·분류·split구분) 또는 나눔 체크박스
    var isRoleSelect = sel.tagName === 'SELECT' && sel.classList.contains('pl-role-select');
    var isSplitCheck = sel.tagName === 'INPUT' && sel.type === 'checkbox' && sel.dataset.roleField === 'split';
    if (!isRoleSelect && !isSplitCheck) return;
    var personId = sel.dataset.personId;
    var field    = sel.dataset.roleField;
    if (!personId || !field) return;

    if (!state.personRoles) state.personRoles = {};
    if (!state.personRoles[personId]) {
      state.personRoles[personId] = { newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null };
    }
    var role = state.personRoles[personId];

    if (field === 'split') {
      var on = sel.checked;
      role.split = on;
      if (on) {
        // 나눔 ON: 현재 단일 분류 값을 기준으로 cell.rates 초기화(마이그레이션) + splitCis 세팅
        migrateCellRatesForSplit(personId);
        role.splitCis = defaultSplitCis(personId);
      }
      // OFF면 splitCis는 남겨둬도 무방(렌더 안 함). 데이터는 보존.
    } else if (field === 'splitCi') {
      // split 줄의 구분 드롭다운 — 해당 줄의 분류 교체
      var idx = parseInt(sel.dataset.rowIndex, 10);
      if (!Array.isArray(role.splitCis)) role.splitCis = defaultSplitCis(personId);
      if (idx >= 0 && idx < role.splitCis.length) {
        role.splitCis[idx] = sel.value;
      }
    } else {
      role[field] = isSplitCheck ? sel.checked : sel.value;
    }
    scheduleSave();
    renderAll();
  }

  // v7.4: 나눔 켤 때 — 현재 단일 분류(cashOrInkind)에 cell.rate를 몰아 cell.rates 초기화.
  //   이전 테스트로 어긋난 cell.rates를 현재 분류 기준으로 바로잡는 역할도 함.
  function migrateCellRatesForSplit(personId) {
    var role = state.personRoles[personId] || {};
    var pf = moneyFieldOf(role.cashOrInkind);   // 주 분류 금액필드
    var project = getProject();
    if (!project) return;
    ['planned', 'actual'].forEach(function (mk) {
      var map = state[mk];
      if (!map) return;
      var allYms = getAllMonths(state.year).map(function (m) { return m.ym; });
      allYms.forEach(function (ym) {
        var key = getLaborKey(project.id, ym, personId);
        var cell = map[key];
        if (!cell) return;
        var rate = cell.rate || 0;
        // 주 분류에 rate 몰기, 나머지 0
        var rates = { cash: 0, selfCash: 0, inkind: 0 };
        rates[pf] = rate;
        cell.rates = rates;
        // 금액도 주 분류만 유지(나머지 0) — 일관성
        ['cash', 'selfCash', 'inkind'].forEach(function (f) {
          if (f !== pf) cell[f] = 0;
        });
      });
    });
  }

  // v7.4: 나눔 기본 분류 줄 — [주 분류, 그와 다른 첫 분류] (2줄)
  function defaultSplitCis(personId) {
    var role = state.personRoles[personId] || {};
    var primary = normalizeCi(role.cashOrInkind);
    var hasSelfCash = projHasSelfCash(getProject());
    var avail = ['현금'];
    if (hasSelfCash) avail.push('자부담현금');
    avail.push('현물');
    var others = avail.filter(function (c) { return c !== primary; });
    return [primary, others[0] || '현물'];
  }

  // v5 Step 4: subRole 텍스트 입력(input) 핸들러
  // - 입력 중이라 renderAll은 포커스 잃기 때문에 사용 불가
  // - state만 갱신하고, 다른 탭의 같은 인력 subRole input은 값만 동기화
  function onSubRoleInput(e) {
    var inp = e.target;
    if (!inp || inp.tagName !== 'INPUT') return;
    if (!inp.classList.contains('pl-subrole-input')) return;
    var personId = inp.dataset.personId;
    if (!personId) return;

    if (!state.personRoles) state.personRoles = {};
    if (!state.personRoles[personId]) {
      state.personRoles[personId] = { newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null };
    }
    var newVal = inp.value || '';
    state.personRoles[personId].subRole = newVal;
    scheduleSave();

    // 다른 탭의 같은 인력 subRole input 동기화 (포커스 잃지 않도록 본인 제외)
    var allSubRoleInputs = document.querySelectorAll(
      '.pl-subrole-input[data-person-id="' + personId + '"]'
    );
    allSubRoleInputs.forEach(function (other) {
      if (other !== inp && other.value !== newVal) other.value = newVal;
    });
  }

  function onConfirmMonthClick(e) {
    var btn = e.target.closest('[data-confirm-month]');
    if (!btn) return;
    e.stopPropagation();   // 헤더 토글(접기/펼치기)로 버블링 방지
    var ym = btn.dataset.confirmMonth;
    if (!ym) return;
    confirmMonth(ym);
  }

  function confirmMonth(ym) {
    var project = getProject();
    if (!project) return;

    var persons = getPersons();
    if (persons.length === 0) {
      showToast('인력이 없어 확정할 항목이 없습니다.', 'warn');
      return;
    }

    var meta = state.meta[ym] || {};
    var wasConfirmed = !!meta.confirmed;
    var ymLabel = ym.replace('-', '년 ') + '월';

    // v5.2: 확정된 상태에서 다시 클릭하면 "확정 취소" 분기로 이동
    //  - 기존엔 재확정(덮어쓰기)만 있었으나, 사용자 피드백 반영
    //  - 확정 취소 = 실제 탭에 복사됐던 셀 모두 삭제 + 메타 풀기 + paid도 풀림
    if (wasConfirmed) {
      unconfirmMonth(ym);
      return;
    }

    // 미확정 → 확정 흐름 (예상값을 실제 탭으로 복사)
    var msg = ymLabel + '의 예상값을 실제 탭으로 복사하고 확정하시겠습니까?';
    if (!confirm(msg)) return;

    // 예상 → 실제 복사 (해당 월 모든 인력)
    var copiedCount = 0;
    persons.forEach(function (p) {
      var key = getLaborKey(project.id, ym, p.id);
      var planned = state.planned[key];
      if (!planned) return;  // 예상값 없는 인력은 skip
      // 복사 — memo는 같이 가져감 (퇴사 사유 등이 의미 있을 수 있음)
      state.actual[key] = {
        rate:   planned.rate   || 0,
        cash:   planned.cash   || 0,
        inkind: planned.inkind || 0,
        memo:   planned.memo   || '',
      };
      copiedCount++;
    });

    // 메타 기록
    if (!state.meta[ym]) state.meta[ym] = {};
    state.meta[ym].confirmed   = true;
    state.meta[ym].confirmedAt = new Date().toISOString();

    renderAll();
    scheduleSave();
    showToast('✅ ' + ymLabel + ' 확정 — ' + copiedCount + '명 복사됨', 'success');
  }

  // v5.2: 확정 취소 — 실제 탭의 해당 월 데이터 전부 삭제 + 메타 풀기 + paid도 풀림
  //  - 확정 버튼이 "확정됨" 상태일 때 클릭하면 진입
  //  - 사용자 의도: "예상→실제 복사를 취소" 즉, 실제 탭에서 그 월을 처음 상태로 되돌림
  //  - 실수 방지: 명시적 confirm 다이얼로그 (대상 인력 수 표시)
  function unconfirmMonth(ym) {
    var project = getProject();
    if (!project) return;
    var ymLabel = ym.replace('-', '년 ') + '월';
    var meta = state.meta[ym] || {};

    // 해당 월에 실제 셀이 있는 인력 수 카운트 (다이얼로그용)
    var personsWithActual = 0;
    var persons = getPersons();
    persons.forEach(function (p) {
      var key = getLaborKey(project.id, ym, p.id);
      if (state.actual[key]) personsWithActual++;
    });

    var paidWarn = meta.paid
      ? '\n\n⚠️ 이 월은 지급 완료 상태(' + (meta.paidAt || '') + ')입니다. 지급 완료도 함께 취소됩니다.'
      : '';
    var msg =
      '⚠️ ' + ymLabel + '의 확정을 취소하시겠습니까?\n\n' +
      '실제 탭에 복사됐던 ' + personsWithActual + '명의 셀이 모두 삭제됩니다.\n' +
      '(예상 탭은 영향 없음)' + paidWarn;
    if (!confirm(msg)) return;

    // 해당 월의 실제 셀 전부 삭제
    var clearedCount = 0;
    persons.forEach(function (p) {
      var key = getLaborKey(project.id, ym, p.id);
      if (state.actual[key]) {
        delete state.actual[key];
        clearedCount++;
      }
    });
    // 다른 프로젝트의 인력도 actual에 있을 수 있으니 안전하게 키 prefix로 한번 더 훑기
    // (getPersons는 현재 프로젝트 한정이므로, 인력 삭제됐던 과거 데이터까지 청소)
    var prefix = project.id + '_' + ym + '_';
    Object.keys(state.actual).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && state.actual[k]) {
        delete state.actual[k];
        clearedCount++;
      }
    });

    // 메타 풀기: confirmed + paid 둘 다
    if (state.meta[ym]) {
      state.meta[ym].confirmed = false;
      delete state.meta[ym].confirmedAt;
      if (state.meta[ym].paid) {
        state.meta[ym].paid = false;
        delete state.meta[ym].paidAt;
      }
    }

    renderAll();
    scheduleSave();
    showToast('↩ ' + ymLabel + ' 확정 취소 — ' + clearedCount + '개 셀 삭제됨', 'success');
  }

  // ----------------------------------------------------------------------
  // v5.2 — 지급 완료 메타 (실제 탭 한정)
  // ----------------------------------------------------------------------
  //  - 확정과 별개 단계. 확정된 월에만 [지급 완료] 버튼 노출.
  //  - 클릭 시 prompt로 지급일 입력 (기본값 = 오늘 YYYY-MM-DD).
  //  - 이미 지급된 월 재클릭 시: 두 번 confirm 체이닝 (수정? → 취소?).
  //  - 데이터 모델: meta[ym].paid (bool), meta[ym].paidAt ('YYYY-MM-DD')
  //  - 기획서 §4 Phase A.8.5 참조.
  function onPaidMonthClick(e) {
    var target = e.target.closest('[data-paid-month]');
    if (!target) return;
    e.stopPropagation();   // 헤더 토글로 버블링 방지
    var ym = target.dataset.paidMonth;
    if (!ym) return;
    paidMonth(ym);
  }

  // 오늘 날짜를 YYYY-MM-DD로
  function todayISODate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // YYYY-MM-DD 형식 검증 (단순 정규식 + 실재 날짜 확인)
  function isValidISODate(s) {
    if (!s || typeof s !== 'string') return false;
    var match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    var y = +match[1], m = +match[2], d = +match[3];
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // v7.4.4: 지급일 입력 정규화 — 숫자만 8자리(20260601) → YYYY-MM-DD 자동 변환.
  //   - 구분자(- . /)나 공백이 섞여도 숫자만 추려 8자리면 변환(이미 2026-06-01 형식도 동일 결과).
  //   - 8자리가 아니면 원본(trim)을 그대로 반환 → isValidISODate가 형식 검증.
  function normalizeDateInput(s) {
    if (s == null) return s;
    var t = String(s).trim();
    var digits = t.replace(/\D/g, '');
    if (digits.length === 8) {
      return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
    }
    return t;
  }

  function paidMonth(ym) {
    var project = getProject();
    if (!project) return;
    var meta = state.meta[ym] || {};
    var ymLabel = ym.replace('-', '년 ') + '월';

    // 가드: 확정 안 된 월은 버튼 자체가 안 보이지만, 혹시 모를 직접 호출 대비
    if (!meta.confirmed) {
      showToast('먼저 예상 탭에서 ' + ymLabel + '을 확정해주세요.', 'warn');
      return;
    }

    if (meta.paid) {
      // 이미 지급됨 → 수정 ↔ 취소 두 번 confirm 체이닝
      var curPaidAt = meta.paidAt || '';
      var msg1 = ymLabel + '은 ' + curPaidAt + ' 지급 완료 처리되어 있습니다.\n\n[확인] = 지급일 수정\n[취소] = 다음 단계 (지급 취소 옵션)';
      if (confirm(msg1)) {
        // 수정 분기
        var newDate = prompt(ymLabel + ' 지급일 수정 (YYYY-MM-DD, 숫자 8자리도 가능)', curPaidAt);
        if (newDate === null) return;
        newDate = normalizeDateInput(newDate);
        if (!isValidISODate(newDate)) {
          showToast('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD 또는 숫자 8자리).', 'warn');
          return;
        }
        if (!state.meta[ym]) state.meta[ym] = {};
        state.meta[ym].paidAt = newDate;
        renderAll();
        scheduleSave();
        showToast('💸 ' + ymLabel + ' 지급일 ' + newDate + '로 수정', 'success');
        return;
      }
      // 취소 분기
      var msg2 = ymLabel + '의 지급 완료를 취소하시겠습니까?\n(데이터는 그대로 두고 상태만 미지급으로 변경)';
      if (confirm(msg2)) {
        if (!state.meta[ym]) state.meta[ym] = {};
        state.meta[ym].paid = false;
        delete state.meta[ym].paidAt;
        renderAll();
        scheduleSave();
        showToast('↩ ' + ymLabel + ' 지급 완료 취소됨', 'success');
      }
      return;
    }

    // 미지급 → 지급일 prompt (기본값 = 오늘)
    var dateInput = prompt(ymLabel + ' 지급일을 입력하세요 (YYYY-MM-DD, 숫자 8자리도 가능)', todayISODate());
    if (dateInput === null) return;
    dateInput = normalizeDateInput(dateInput);
    if (!isValidISODate(dateInput)) {
      showToast('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD 또는 숫자 8자리).', 'warn');
      return;
    }
    if (!state.meta[ym]) state.meta[ym] = {};
    state.meta[ym].paid   = true;
    state.meta[ym].paidAt = dateInput;
    renderAll();
    scheduleSave();
    showToast('💸 ' + ymLabel + ' 지급 완료 — ' + dateInput, 'success');
  }

  // v5.2: 인력 행 ✕ 버튼 — 테이블에서 직접 삭제 (모달 안 거침)
  function onRemovePersonClick(e) {
    var btn = e.target.closest('[data-remove-person]');
    if (!btn) return;
    e.stopPropagation();
    var pid = btn.dataset.removePerson;
    if (!pid) return;
    var person = _allPersons.find(function (p) { return p.id === pid; });
    var name = person ? person.name : '이 인력';
    if (!confirm(name + '을(를) 이 프로젝트에서 제거하시겠습니까?\n(입력된 인건비 데이터는 그대로 보존되며, 다시 추가 시 복원됩니다)')) return;
    removePersonFromProject(pid);
    showToast(name + ' 제거됨', 'success');
  }

  // ====================================================================
  // v5.3 Step 4.8: 인력 행 드래그 앤 드롭 (순서 변경)
  // ====================================================================
  //   설계 요점:
  //   - 행 자체에 draggable=true. 핸들(≡)이 아닌 곳에서 dragstart 발생하면 취소.
  //     (행 전체를 핸들로 만들면 셀 안 input/select 인터랙션이 망가짐)
  //   - 모드 무관하게 state.personIds 한 곳만 재배열 → getPersons() 결과가 바뀌고
  //     세 탭 모두 같은 순서가 됨.
  //   - dragover에서 마우스가 행의 위/아래 절반 어디 있는지로 drop 위치 결정.
  //   - drop 시 personIds 재배열 → buildTable 3개 모두 다시 그림 → scheduleSave.
  //   - 시각 피드백: 드래그 중인 행 opacity 0.4, drop 대상에 위/아래 표시선.
  // --------------------------------------------------------------------
  var _dragPersonId = null;   // 현재 드래그 중인 인력 ID
  var _lastDropTr   = null;   // 마지막으로 표시선 그린 tr (cleanup용)
  var _lastDropPos  = null;   // 'above' | 'below'
  // v5.3: 드래그 시작이 핸들에서 일어났는지 추적.
  //   dragstart의 e.target은 가장 가까운 draggable 요소(=tr)이라
  //   "핸들에서 시작했는지"를 dragstart만으로는 판별 불가.
  //   mousedown 시점에 핸들 안인지 검사해서 플래그를 켜고, dragstart에서 확인.
  var _dragStartFromHandle = false;

  function clearDropMarkers() {
    if (_lastDropTr) {
      _lastDropTr.classList.remove('is-drop-above', 'is-drop-below');
      _lastDropTr = null;
      _lastDropPos = null;
    }
  }

  function onRowMouseDown(e) {
    // 핸들에서 시작한 mousedown이면 플래그 ON, 아니면 OFF (다음 dragstart에서 차단됨)
    _dragStartFromHandle = !!e.target.closest('[data-drag-handle]');
  }

  function onRowDragStart(e) {
    var tr = e.target.closest('tr[data-person-id]');
    if (!tr) return;
    // 핸들에서 시작한 게 아니면 드래그 취소 (셀 안 텍스트/요소 드래그 차단)
    if (!_dragStartFromHandle) {
      e.preventDefault();
      return;
    }
    _dragStartFromHandle = false;  // 1회용
    _dragPersonId = tr.dataset.personId;
    tr.classList.add('is-dragging');
    // Firefox는 dataTransfer에 뭔가 setData 해야 dragover 발생
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _dragPersonId); } catch (ex) {}
    }
  }

  function onRowDragOver(e) {
    if (!_dragPersonId) return;

    // v5.3: 자동 스크롤 — 마우스가 윈도우 위/아래 80px 안에 있으면 그 방향으로 스크롤.
    //   거리에 비례한 속도(최대 18px/frame). rAF 루프 돌려 부드럽게.
    updateAutoScroll(e.clientY);

    var tr = e.target.closest('tr[data-person-id]');
    if (!tr) return;
    // 자기 자신 위에선 표시 안 함
    if (tr.dataset.personId === _dragPersonId) {
      clearDropMarkers();
      return;
    }
    e.preventDefault();   // 이게 있어야 drop 이벤트가 발생함
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    var rect = tr.getBoundingClientRect();
    var isAbove = (e.clientY - rect.top) < (rect.height / 2);
    var pos = isAbove ? 'above' : 'below';

    if (_lastDropTr === tr && _lastDropPos === pos) return;  // 동일한 표시면 갱신 스킵
    clearDropMarkers();
    tr.classList.add(isAbove ? 'is-drop-above' : 'is-drop-below');
    _lastDropTr = tr;
    _lastDropPos = pos;
  }

  // v5.3: 드래그 중 윈도우 가장자리 자동 스크롤
  //   - dragover에서 마우스 Y 갱신 → rAF 루프가 매 프레임 그 값으로 스크롤
  //   - 가장자리 80px 이내에서 거리 비례 속도, 최대 ±18px/frame
  //   - dragend/drop에서 루프 정지
  var _autoScrollY = null;       // 마지막 dragover의 clientY (null = 정지)
  var _autoScrollRAF = null;
  var AUTO_SCROLL_EDGE = 80;
  var AUTO_SCROLL_MAX_SPEED = 18;
  function updateAutoScroll(clientY) {
    _autoScrollY = clientY;
    if (_autoScrollRAF == null) {
      _autoScrollRAF = requestAnimationFrame(autoScrollStep);
    }
  }
  function autoScrollStep() {
    _autoScrollRAF = null;
    if (_autoScrollY == null || !_dragPersonId) return;  // 드래그 끝났으면 정지
    var y = _autoScrollY;
    var h = window.innerHeight;
    var dy = 0;
    if (y < AUTO_SCROLL_EDGE) {
      // 위쪽 가장자리: 가까울수록 빨리
      dy = -AUTO_SCROLL_MAX_SPEED * (1 - y / AUTO_SCROLL_EDGE);
    } else if (y > h - AUTO_SCROLL_EDGE) {
      dy = AUTO_SCROLL_MAX_SPEED * (1 - (h - y) / AUTO_SCROLL_EDGE);
    }
    if (dy !== 0) window.scrollBy(0, dy);
    // 마우스 안 움직여도 가장자리에 있으면 계속 스크롤되도록 루프 유지
    _autoScrollRAF = requestAnimationFrame(autoScrollStep);
  }
  function stopAutoScroll() {
    _autoScrollY = null;
    if (_autoScrollRAF != null) {
      cancelAnimationFrame(_autoScrollRAF);
      _autoScrollRAF = null;
    }
  }

  function onRowDragLeave(e) {
    // dragleave는 자식 요소로 이동할 때도 발생해서 단순 해제하면 깜빡임.
    //   relatedTarget이 현재 행 밖이면만 해제.
    var tr = e.target.closest('tr[data-person-id]');
    if (!tr) return;
    if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
    if (_lastDropTr === tr) clearDropMarkers();
  }

  function onRowDrop(e) {
    if (!_dragPersonId) return;
    var tr = e.target.closest('tr[data-person-id]');
    if (!tr) return;
    e.preventDefault();
    var targetId = tr.dataset.personId;
    var pos = _lastDropPos || 'below';
    var movedId = _dragPersonId;
    // 정리 (dragend가 늦게 올 수도 있어 미리)
    clearDropMarkers();
    stopAutoScroll();   // v5.3: 자동 스크롤 루프 정지
    if (movedId === targetId) return;

    // personIds 재배열
    var ids = state.personIds.slice();
    var fromIdx = ids.indexOf(movedId);
    if (fromIdx < 0) return;
    ids.splice(fromIdx, 1);
    var toIdx = ids.indexOf(targetId);
    if (toIdx < 0) return;
    if (pos === 'below') toIdx += 1;
    ids.splice(toIdx, 0, movedId);

    state.personIds = ids;
    // 세 탭 모두 재렌더 (같은 순서 보장)
    buildTable(document.getElementById('pl-table-planned'), 'planned');
    buildTable(document.getElementById('pl-table-actual'),  'actual');
    buildTable(document.getElementById('pl-table-compare'), 'compare');
    scheduleSave();
    showSaveIndicator('순서 변경됨');
  }

  function onRowDragEnd(e) {
    // dragend는 dragstart한 요소에 발생 — 클린업 보장
    var tr = e.target.closest('tr[data-person-id]');
    if (tr) tr.classList.remove('is-dragging');
    clearDropMarkers();
    stopAutoScroll();   // v5.3: 자동 스크롤 루프 정지
    _dragPersonId = null;
  }

  // v5.1 마이그레이션: 기존 meta의 sysReg/amtConf → confirmed로 통합
  // - 둘 중 하나라도 true면 confirmed = true
  // - 일자는 amtConfAt 우선, 없으면 sysRegAt 사용
  // - 기존 필드는 보존 (롤백 가능성 + 외부 페이지 읽기 호환)
  function migrateMetaToConfirmed() {
    if (!state.meta || typeof state.meta !== 'object') {
      state.meta = {};
      return false;
    }
    var changed = false;
    Object.keys(state.meta).forEach(function (ym) {
      var m = state.meta[ym] || {};
      if (typeof m.confirmed === 'boolean') return;  // 이미 새 스키마
      var wasChecked = !!(m.sysReg || m.amtConf);
      if (wasChecked) {
        m.confirmed   = true;
        m.confirmedAt = m.amtConfAt || m.sysRegAt || new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  // ====================================================================
  // 탭 전환
  // ====================================================================
  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.history-tab').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.pl-tab-content').forEach(function (div) {
      div.classList.toggle('is-active', div.id === 'tab-' + tab);
    });
    renderStickyBoxes();   // v5 Step 2: 누계는 탭별로 다름
    renderSnapshotBtnVisibility();  // v7.4.4 §4.2: 📸는 예상 탭에서만
  }

  // ====================================================================
  // 분기 레이블
  // ====================================================================
  function updateQuarterLabel() {
    var label = document.getElementById('pl-quarter-label');
    if (label) label.textContent = state.quarter + '분기';
  }

  // ====================================================================
  // 이벤트 바인딩
  // ====================================================================
  function bindEvents() {
    // 프로젝트 선택
    var projectSel = document.getElementById('pl-project-select');
    if (projectSel) {
      projectSel.addEventListener('change', function () {
        state.projectId = this.value;
        // v5 Step 2: 프로젝트별 viewMode 복원
        state.viewMode = loadViewMode(state.projectId);
        loadLaborData();
      });
    }

    // 연도
    var yearInput = document.getElementById('pl-year-input');
    if (yearInput) {
      yearInput.addEventListener('change', function () {
        state.year = parseInt(this.value, 10) || new Date().getFullYear();
        filterProjectsByYear(state.year);
        populateProjectSelect();
        var proj = getProject();
        if (proj) {
          state.projectId = proj.id;
          loadLaborData();  // 내부에서 reloadCollapsedMonths() 호출됨
        } else {
          // 해당 연도에 과제 없음 → 컨텍스트 무효, 접힘 캐시 비움
          state.collapsedMonths = new Set();
          renderAll();
        }
      });
    }

    // 회사 필터 칩
    var companyChips = document.getElementById('pl-company-chips');
    if (companyChips) {
      companyChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.company-chip');
        if (!btn) return;
        var c = btn.dataset.company || '';
        if (c === state.company) return; // 이미 선택된 칩
        state.company = c;
        saveCompanyFilter(c);
        // 칩 시각 상태 갱신
        companyChips.querySelectorAll('.company-chip').forEach(function (b) {
          b.classList.toggle('is-active', (b.dataset.company || '') === c);
        });
        // 프로젝트 다시 필터 → 셀렉트 갱신 → 첫 프로젝트로 이동
        filterProjectsByYear(state.year);
        populateProjectSelect();
        var proj = getProject();
        if (proj) {
          state.projectId = proj.id;
          state.viewMode = loadViewMode(state.projectId);  // v5 Step 2
          loadLaborData();
        } else {
          // 해당 회사에 과제가 없으면
          state.projectId   = '';
          state.planned     = {};
          state.actual      = {};
          state.meta        = {};
          state.personIds   = [];
          state.personRoles = {};
          state.yearBudget  = null;
          state.collapsedMonths = new Set();   // v5 Step 3
          renderAll();
        }
      });
    }

    // 분기 이동
    var prevBtn = document.getElementById('pl-quarter-prev');
    var nextBtn = document.getElementById('pl-quarter-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        var prevYear = state.year;
        if (state.quarter > 1) { state.quarter--; }
        else { state.quarter = 4; state.year--; document.getElementById('pl-year-input').value = state.year; }
        updateQuarterLabel();
        if (state.year !== prevYear) {
          reloadYearBudget();         // v5 Step 2
          reloadCollapsedMonths();    // v5 Step 3: 연도가 바뀌면 접힘 캐시도 새 연도 것으로
        }
        renderAll();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var prevYear = state.year;
        if (state.quarter < 4) { state.quarter++; }
        else { state.quarter = 1; state.year++; document.getElementById('pl-year-input').value = state.year; }
        updateQuarterLabel();
        if (state.year !== prevYear) {
          reloadYearBudget();         // v5 Step 2
          reloadCollapsedMonths();    // v5 Step 3
        }
        renderAll();
      });
    }

    // v5 Step 2: 뷰 모드 토글
    var viewModeWrap = document.getElementById('pl-view-mode');
    if (viewModeWrap) {
      viewModeWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.pl-view-mode-btn');
        if (!btn) return;
        var mode = btn.getAttribute('data-mode');
        if (mode !== 'all12' && mode !== 'quarter') return;
        if (mode === state.viewMode) return;
        state.viewMode = mode;
        saveViewMode(state.projectId, mode);
        renderAll();
      });
    }

    // v5 Step 3: 모두 펼치기 버튼
    var expandAllBtn = document.getElementById('pl-expand-all-btn');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', function () {
        expandAllMonths();
      });
    }

    // 탭
    document.querySelectorAll('.history-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(this.dataset.tab); });
    });

    // 셀 입력 (이벤트 위임)
    document.addEventListener('input', onCellInput);

    // v5 Step 4 NOTE: focus/blur 포맷 전환은 bindKeyboard()의 기존 focusin/focusout
    // 핸들러에 통합되어 있음 (중복 방지).

    // v5 Step 4: personRoles 드롭다운 (change) + subRole 텍스트 입력 (input)
    //   - select 변경 → 즉시 state 반영 + 저장 + 신규/기존 토글이면 행만 다시 그려서 subRole 입력란 show/hide
    //   - subRole 입력 → state 반영 + 디바운스 저장 (이벤트 위임의 input은 위 onCellInput에서 거름)
    document.addEventListener('change', onRoleChange);
    document.addEventListener('input', onSubRoleInput);

    // v5.1: 월 확정 버튼 (이벤트 위임) — 헤더 토글보다 먼저 처리되도록 click 핸들러에서 별도 분기
    document.addEventListener('click', onConfirmMonthClick);

    // v5.2: 지급 완료 버튼/뱃지 (이벤트 위임)
    document.addEventListener('click', onPaidMonthClick);

    // v5.2: 인력 행 ✕ 삭제 버튼 (이벤트 위임)
    document.addEventListener('click', onRemovePersonClick);

    // v5.3 Step 4.8: 인력 행 드래그 앤 드롭 (순서 변경) — 이벤트 위임
    //   mousedown: 드래그 시작 위치가 핸들인지 기록 (dragstart의 e.target은 tr이라 핸들 판별 불가)
    document.addEventListener('mousedown', onRowMouseDown);
    document.addEventListener('dragstart', onRowDragStart);
    document.addEventListener('dragover',  onRowDragOver);
    document.addEventListener('dragleave', onRowDragLeave);
    document.addEventListener('drop',      onRowDrop);
    document.addEventListener('dragend',   onRowDragEnd);

    // v5.2 Step 4.6: 셀 우클릭 → 컨텍스트 메뉴 (참여율 셀, 예상 탭만)
    document.addEventListener('contextmenu', onCellContextMenu);
    // v7.4.3 §4.1: 메모 마커 클릭 → 팝오버
    document.addEventListener('click', onMemoMarkerClick);

    // 컨텍스트 메뉴 바깥 클릭 / Esc 시 닫기
    document.addEventListener('click', function (e) {
      if (!_ctxMenuEl) return;
      if (e.target.closest('.pl-ctx-menu')) return;  // 메뉴 내부 클릭은 자체 핸들러에서 처리
      hideCellContextMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (_ctxMenuEl && e.key === 'Escape') hideCellContextMenu();
    });
    window.addEventListener('scroll', hideCellContextMenu, true);
    window.addEventListener('resize', hideCellContextMenu);

    // v5 Step 3: 월 접기/펼치기 토글 (이벤트 위임)
    // 트리거 대상: data-collapse-toggle="1" 속성을 가진 요소(th, td, 헤더 라벨 div).
    // 가드:
    //   - 확정/지급/삭제 버튼·입력 요소는 토글하지 않음 (e.stopPropagation()으로도 막지만 안전 가드).
    document.addEventListener('click', function (e) {
      // 확정/지급/삭제 버튼·입력 요소면 무시
      if (e.target.closest('[data-confirm-month],[data-paid-month],[data-remove-person],input,label,.pl-month-meta')) return;
      var trigger = e.target.closest('[data-collapse-toggle="1"]');
      if (!trigger) return;
      var month = parseInt(trigger.dataset.month, 10);
      if (!Number.isInteger(month) || month < 1 || month > 12) return;
      toggleMonthCollapsed(month);
      renderAll();
    });

    // 일괄 자동 계산
    var calcBtn = document.getElementById('pl-calc-all-btn');
    if (calcBtn) {
      calcBtn.addEventListener('click', function () {
        var project = getProject();
        if (!project) return;
        var months  = getVisibleMonths();   // v5 Step 2: 12개월 모드면 12개월, 분기 모드면 3개월
        var mode    = state.activeTab === 'actual' ? 'actual' : 'planned';
        var dataMap = mode === 'actual' ? state.actual : state.planned;

        getPersons().forEach(function (person) {
          var role = (state.personRoles && state.personRoles[person.id]) || {};
          var targetField = moneyFieldOf(role.cashOrInkind);   // v7.4
          var otherFields = otherMoneyFields(targetField);
          months.forEach(function (m) {
            var cell = getCell(dataMap, project.id, m.ym, person.id);
            if (cell.rate > 0) {
              var amt = Math.round(getEffectiveMonthlySalary(person, m.ym) * cell.rate / 100);
              var patch = {};
              patch[targetField] = amt;
              otherFields.forEach(function (f) { patch[f] = 0; });   // 나머지 금액 0
              setCell(dataMap, project.id, m.ym, person.id, patch);
            }
          });
        });

        buildTable(document.getElementById('pl-table-' + mode), mode);
        scheduleSave();
        showSaveIndicator('일괄 계산 완료 ✅');
      });
    }

    // 이전 분기 복사
    var copyBtn = document.getElementById('pl-copy-prev-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyPrevQuarter();
      });
    }

    // + 인력 추가 버튼
    document.addEventListener('click', function (e) {
      if (e.target.id === 'pl-add-person-top-btn' || e.target.classList.contains('pl-add-inline-btn')) {
        openAddModal();
      }
    });
  }

  // ====================================================================
  // 키보드 조작
  //
  // Tab / Enter      → 같은 행에서 다음 셀 (마지막이면 다음 행 첫 셀)
  // Shift+Tab        → 이전 셀
  // 화살표 ↑↓←→     → 상하좌우 셀 이동
  // Ctrl+C           → 현재 셀 값 클립보드 복사
  // Ctrl+V           → 클립보드 값 붙여넣기 (숫자만)
  // Ctrl+Z           → 직전 셀 변경 되돌리기 (undo 스택)
  // Esc              → 편집 취소 (포커스 이전의 원래 값 복원)
  // ====================================================================
  var _undoStack  = [];      // { key, mode, field, oldVal, newVal }
  var _cellOrigin = null;    // 포커스 시점 원본값 (Esc 복원용)
  var _clipboard  = null;    // Ctrl+C 복사 값

  function bindKeyboard() {
    // 모든 셀 input에 포커스 진입 시:
    //   1. 표시값(포맷팅된) → raw 숫자로 전환 (편집 편의)
    //   2. 원본 raw값을 _cellOrigin에 저장 (Esc 복원용)
    //   3. 전체 선택
    document.addEventListener('focusin', function (e) {
      var input = e.target;
      // v5.2: 월급 input은 별도 핸들러
      if (input.classList && input.classList.contains('pl-salary-input')) {
        onSalaryInputFocus(e);
        return;
      }
      if (!input.classList || !input.classList.contains('pl-cell-input')) return;
      onCellFocus(e);                          // 표시값 → raw + select
      _cellOrigin = input.dataset.raw || '0';  // raw 기준으로 비교
    });

    // 포커스 이탈 시:
    //   1. raw 값을 표시값으로 포맷 (콤마, %)
    //   2. undo 스택에 push (값이 바뀐 경우만 — raw 기준 비교)
    document.addEventListener('focusout', function (e) {
      var input = e.target;
      // v5.2: 월급 input은 별도 핸들러 (값 변경 시 자동 재계산 + 묶음 undo)
      if (input.classList && input.classList.contains('pl-salary-input')) {
        onSalaryInputBlur(e);
        return;
      }
      if (!input.classList || !input.classList.contains('pl-cell-input')) return;
      var newRaw = input.dataset.raw || '0';
      if (_cellOrigin !== null && newRaw !== _cellOrigin) {
        _undoStack.push({
          input:   input,
          oldVal:  _cellOrigin,
          newVal:  newRaw,
          personId: input.dataset.personId,
          ym:      input.dataset.ym,
          field:   input.dataset.field,
          mode:    input.dataset.mode,
        });
        if (_undoStack.length > 50) _undoStack.shift();
      }
      _cellOrigin = null;
      onCellBlur(e);                           // raw → 표시값
    });

    document.addEventListener('keydown', function (e) {
      var input = document.activeElement;
      // v5.2: 월급 input은 Enter/Esc 별도 처리
      if (input && input.classList && input.classList.contains('pl-salary-input')) {
        onSalaryInputKeyDown(e);
        return;
      }
      var isCellInput = input && input.classList.contains('pl-cell-input');

      // ── Ctrl+Z: 되돌리기 ──────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // 모달 열려있으면 패스 (셀 undo가 입력창 텍스트 편집을 가로채지 않게)
        var modal = document.getElementById('pl-add-modal');
        if (modal && !modal.hidden) return;
        var snapModal = document.getElementById('pl-snapshot-modal');   // v7.4.4 §4.2
        if (snapModal && !snapModal.hidden) return;

        e.preventDefault();
        undoLastCell();
        return;
      }

      // ── v5.2 Step 4.6 — Ctrl+R: 참여율 가로 채우기 ────
      // 예상 탭의 rate 셀에 포커스 중일 때만 동작.
      // 브라우저 새로고침을 가로채는 거라 dataset 검증을 엄격히.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R') &&
          isCellInput &&
          input.dataset.field === 'rate' &&
          input.dataset.mode === 'planned') {
        var pid = input.dataset.personId;
        var sym = input.dataset.ym;
        var sraw = input.dataset.raw || input.value || '0';
        if (pid && sym) {
          e.preventDefault();
          fillRateToYearEnd(pid, sym, sraw);
        }
        return;
      }

      // ── Ctrl+C: 셀 값 복사 ───────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && isCellInput) {
        // v5 Step 4: 포커스 중에는 raw 표시이므로 input.value가 raw임. 그대로 저장.
        _clipboard = input.dataset.raw || input.value || '';
        return;
      }

      // ── Ctrl+V: 클립보드 붙여넣기 ────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && isCellInput) {
        if (_clipboard !== null && _clipboard !== '') {
          e.preventDefault();
          var num = parseCellNumber(_clipboard);
          if (!isNaN(num)) {
            // 포커스 중이므로 raw 모드 — 그대로 숫자 표시
            input.value = num ? String(num) : '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        return;
      }

      if (!isCellInput) return;

      // ── Tab / Shift+Tab ───────────────────────────────
      if (e.key === 'Tab') {
        e.preventDefault();
        moveFocus(input, e.shiftKey ? 'prev' : 'next');
        return;
      }

      // ── Enter → 다음 셀 (아래 행 같은 컬럼) ──────────
      if (e.key === 'Enter') {
        e.preventDefault();
        moveFocus(input, 'down');
        return;
      }

      // ── Esc → 원본값 복원 ─────────────────────────────
      if (e.key === 'Escape') {
        if (_cellOrigin !== null) {
          // v5 Step 4: _cellOrigin은 이제 raw 문자열. 포커스 중이므로 raw 모드 표시.
          var rawNum = Number(_cellOrigin) || 0;
          input.value = rawNum ? String(rawNum) : '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        input.blur();
        return;
      }

      // ── 화살표 키 ─────────────────────────────────────
      // 숫자 입력 중에는 좌우 화살표는 커서 이동이 자연스러우므로
      // 값이 전체 선택 상태일 때만 좌우도 셀 이동으로 처리
      var allSelected = (input.selectionStart === 0 && input.selectionEnd === input.value.length);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(input, 'down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(input, 'up');
      } else if (e.key === 'ArrowRight' && allSelected) {
        e.preventDefault();
        moveFocus(input, 'next');
      } else if (e.key === 'ArrowLeft' && allSelected) {
        e.preventDefault();
        moveFocus(input, 'prev');
      }
    });
  }

  // ── 셀 이동 ──────────────────────────────────────────
  function getAllCellInputs() {
    // 현재 활성 탭 테이블의 셀 input만 (compare 탭은 readonly라 제외)
    var mode = state.activeTab === 'actual' ? 'actual' : 'planned';
    var table = document.getElementById('pl-table-' + mode);
    if (!table) return [];
    return Array.from(table.querySelectorAll('.pl-cell-input:not([readonly])'));
  }

  function moveFocus(currentInput, direction) {
    var inputs = getAllCellInputs();
    if (!inputs.length) return;

    var idx = inputs.indexOf(currentInput);
    if (idx < 0) return;

    var target = null;

    if (direction === 'next') {
      target = inputs[idx + 1] || inputs[0];
    } else if (direction === 'prev') {
      target = inputs[idx - 1] || inputs[inputs.length - 1];
    } else if (direction === 'down' || direction === 'up') {
      // 같은 컬럼(field) 기준으로 한 행 위/아래
      var field = currentInput.dataset.field;
      var ym    = currentInput.dataset.ym;

      // 같은 ym + 같은 field인 inputs만 → 행 인덱스로 이동
      var sameCol = inputs.filter(function (inp) {
        return inp.dataset.field === field && inp.dataset.ym === ym;
      });
      var colIdx = sameCol.indexOf(currentInput);
      if (colIdx < 0) { target = inputs[idx + (direction === 'down' ? 1 : -1)]; }
      else {
        var nextColIdx = direction === 'down' ? colIdx + 1 : colIdx - 1;
        if (nextColIdx >= 0 && nextColIdx < sameCol.length) {
          target = sameCol[nextColIdx];
        } else {
          // 끝에 도달하면 wrap
          target = direction === 'down' ? sameCol[0] : sameCol[sameCol.length - 1];
        }
      }
    }

    if (target) {
      target.focus();
      target.select();
    }
  }

  // ── Ctrl+Z 되돌리기 ──────────────────────────────────
  function undoLastCell() {
    if (!_undoStack.length) {
      showToast('더 이상 되돌릴 내용이 없습니다.', 'info');
      return;
    }

    var top = _undoStack[_undoStack.length - 1];
    // v5.2 Step 4.6: 묶음 entry (가로 채우기 / 월급 변경) → 모든 items 일괄 복원
    if (top && top.batch) {
      _undoStack.pop();
      var project0 = getProject();
      if (!project0) return;
      var dataMap0 = top.mode === 'actual' ? state.actual : state.planned;
      top.items.forEach(function (it) {
        // v5.2: 월급 오버라이드 항목 (cell 변경 아님)
        if (it.field === '__salaryOverride') {
          if (!state.personRoles[it.personId]) {
            state.personRoles[it.personId] = {
              newOrExisting: '기존', cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null
            };
          }
          state.personRoles[it.personId].monthlySalaryOverride = it.oldVal;
          return;
        }
        var patch = {};
        patch[it.field] = it.oldVal;
        setCell(dataMap0, project0.id, it.ym, it.personId, patch);
      });
      buildTable(document.getElementById('pl-table-' + top.mode), top.mode);
      var months0 = getVisibleMonths();
      recalcSums(top.mode, months0, getPersons(), project0, dataMap0);
      renderStickyBoxes();
      scheduleSave();
      showToast('↩️ ' + (top.label || '묶음 변경') + ' 되돌림 (' + _undoStack.length + '개 남음)', 'info');
      return;
    }

    var entry   = _undoStack.pop();
    var dataMap = entry.mode === 'actual' ? state.actual : state.planned;
    var project = getProject();
    if (!project) return;

    var oldVal = parseCellNumber(entry.oldVal);

    // 값 복원
    var patch = {};
    patch[entry.field] = oldVal;
    setCell(dataMap, project.id, entry.ym, entry.personId, patch);

    // v7.4: rate 되돌리기 시 personRoles에 따라 cash/selfCash/inkind 중 적절한 쪽 복원
    var targetMoneyField = null;
    if (entry.field === 'rate') {
      var person = _allPersons.find(function (p) { return p.id === entry.personId; });
      if (person) {
        var role = (state.personRoles && state.personRoles[entry.personId]) || {};
        targetMoneyField = moneyFieldOf(role.cashOrInkind);
        var oldMoney  = Math.round(getEffectiveMonthlySalary(person, entry.ym) * oldVal / 100);
        var p2 = {};
        p2[targetMoneyField] = oldMoney;
        setCell(dataMap, project.id, entry.ym, entry.personId, p2);
      }
    }

    // 테이블 해당 셀만 업데이트
    var mode  = entry.mode === 'actual' ? 'actual' : 'planned';
    var table = document.getElementById('pl-table-' + mode);
    if (table) {
      var targetInput = table.querySelector(
        '.pl-cell-input[data-person-id="' + entry.personId + '"][data-ym="' + entry.ym + '"][data-field="' + entry.field + '"]'
      );
      if (targetInput) {
        targetInput.dataset.raw = String(oldVal);
        // 포커스 줄 거니까 raw 모드로 표시
        targetInput.value = oldVal ? String(oldVal) : '';
        if (entry.field === 'rate') applyRateColor(targetInput, oldVal);

        // rate 되돌리기 시 cash/inkind 셀도 갱신
        if (entry.field === 'rate' && targetMoneyField) {
          var tr = targetInput.closest('tr');
          if (tr) {
            var moneyInput = tr.querySelector('.pl-input-' + targetMoneyField + '[data-ym="' + entry.ym + '"]');
            if (moneyInput) {
              var person2 = _allPersons.find(function (p) { return p.id === entry.personId; });
              var newMoney = person2 ? Math.round(getEffectiveMonthlySalary(person2, entry.ym) * oldVal / 100) : 0;
              moneyInput.dataset.raw = String(newMoney);
              // 포커스 중이 아니므로 포맷팅된 표시값
              moneyInput.value = fmtCellMoneyDisplay(newMoney);
            }
          }
        }
        targetInput.focus();
        targetInput.select();
      }
    }

    var months = getVisibleMonths();   // v5 Step 2
    recalcSums(mode, months, getPersons(), project, dataMap);
    renderStickyBoxes();   // v5 Step 2
    scheduleSave();
    showToast('↩️ 되돌리기 (' + (_undoStack.length) + '개 남음)', 'info');
  }
  // 이전 분기 = 현재 분기 - 1 (1분기면 전년도 4분기)
  // 복사 대상: planned / actual 둘 다
  // 되돌리기: 복사 전 스냅샷 저장 → "되돌리기" 토스트 버튼 제공
  // ====================================================================
  var _copySnapshot = null; // 되돌리기용 스냅샷

  function copyPrevQuarter() {
    var project = getProject();
    if (!project) return;

    // 이전 분기 계산
    var prevYear    = state.year;
    var prevQuarter = state.quarter - 1;
    if (prevQuarter < 1) { prevQuarter = 4; prevYear--; }

    var prevMonths = getMonths(prevYear, prevQuarter);
    var currMonths = getMonths(state.year, state.quarter);
    var persons    = getPersons();

    // 복사할 데이터가 있는지 확인
    var hasPrevData = persons.some(function (p) {
      return prevMonths.some(function (m) {
        var key = getLaborKey(project.id, m.ym, p.id);
        return !!(state.planned[key] || state.actual[key]);
      });
    });

    if (!hasPrevData) {
      showToast('이전 분기(' + prevYear + '년 ' + prevQuarter + '분기)에 데이터가 없습니다.', 'warn');
      return;
    }

    // 덮어쓸 데이터가 있으면 확인
    var hasCurrData = persons.some(function (p) {
      return currMonths.some(function (m) {
        var key = getLaborKey(project.id, m.ym, p.id);
        return !!(state.planned[key] || state.actual[key]);
      });
    });

    if (hasCurrData) {
      if (!confirm(
        state.year + '년 ' + state.quarter + '분기에 이미 입력된 데이터가 있습니다.\n' +
        '이전 분기(' + prevYear + '년 ' + prevQuarter + '분기) 데이터로 덮어쓸까요?'
      )) return;
    }

    // 복사 전 스냅샷 저장 (되돌리기용)
    _copySnapshot = {
      planned:   JSON.parse(JSON.stringify(state.planned)),
      actual:    JSON.parse(JSON.stringify(state.actual)),
      year:      state.year,
      quarter:   state.quarter,
      prevYear:  prevYear,
      prevQuarter: prevQuarter,
    };

    // 이전 분기 → 현재 분기 복사 (월 인덱스 매핑: 0→0, 1→1, 2→2)
    persons.forEach(function (p) {
      prevMonths.forEach(function (pm, idx) {
        var cm = currMonths[idx];

        // planned 복사
        var pKey = getLaborKey(project.id, pm.ym, p.id);
        var cKey = getLaborKey(project.id, cm.ym, p.id);
        if (state.planned[pKey]) {
          state.planned[cKey] = Object.assign({}, state.planned[pKey], { memo: '' });
        }

        // actual은 복사 안 함 (실제 지급은 해당 월 것만 의미 있음)
      });
    });

    renderAll();
    scheduleSave();
    showToast(
      '✅ ' + prevYear + '년 ' + prevQuarter + '분기 → ' + state.year + '년 ' + state.quarter + '분기 복사 완료',
      'success',
      true // 되돌리기 버튼 표시
    );
  }

  function undoCopy() {
    if (!_copySnapshot) return;
    state.planned = _copySnapshot.planned;
    state.actual  = _copySnapshot.actual;
    _copySnapshot = null;
    renderAll();
    scheduleSave();
    showToast('↩️ 복사가 취소되었습니다.', 'info');
  }

  // ====================================================================
  // v7.4.4 §4.2 — 예상 계획 스냅샷 (Phase H)
  // --------------------------------------------------------------------
  //  · 저장 단위: 1 문서 = 1 스냅샷 (컬렉션 projectLaborSnapshots, auto-id)
  //    - 단일 문서 배열 누적은 1MB 한계 위험 → 스냅샷마다 독립 문서.
  //    - 조회: where('projectId','==',pid) 단일 equality(자동 인덱스, 복합 인덱스 불필요) + JS 정렬.
  //  · 담는 범위(사용자 확정): 예상 셀(planned) + personIds + personRoles.
  //    - actual / meta(확정·지급) 은 미포함 — "예상 계획"의 스냅샷이므로.
  //  · 복원(사용자 확정): 전체 덮어쓰기 + 복원 전 자동 백업 스냅샷(kind:'auto').
  //  · 작성자: window.currentUser(있으면) — { uid, email, name }. 없으면 null.
  //  · funding·결산·labor-dashboard 무영향: 별도 컬렉션, 기존 projectLabor 문서 키 변경 0.
  // ====================================================================
  var _snapshots = [];           // 현재 프로젝트의 스냅샷 캐시 (createdAt desc)
  var _snapOpenId = null;        // 펼쳐진(내역/차이) 스냅샷 id (없으면 null)
  var _snapOpenMode = 'view';    // 'view'(내역) | 'diff'(차이)
  var EMPTY_SIG = '0|0|0|0|';

  function plEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function plDeepCopy(o) {
    try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; }
  }
  function snapNum(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  function getCurrentUserInfo() {
    var u = window.currentUser;
    if (!u) return null;
    return { uid: u.uid || '', email: u.email || '', name: u.name || u.email || '' };
  }

  // 셀의 "계획 시그니처" — 참여율·3분류 금액·나눔(rates)만 비교 (메모·색은 제외)
  function snapCellPlanSig(cell) {
    if (!cell) return '';
    var r = (cell.rates && typeof cell.rates === 'object') ? JSON.stringify(cell.rates) : '';
    return [snapNum(cell.rate), snapNum(cell.cash), snapNum(cell.selfCash), snapNum(cell.inkind), r].join('|');
  }
  function snapCellAmt(cell) {
    return snapNum(cell && cell.cash) + snapNum(cell && cell.selfCash) + snapNum(cell && cell.inkind);
  }
  // 셀 키 {projectId}_{ym}_{personId} → { ym, personId } (labor-dashboard와 동일한 안전 파싱)
  function parseSnapKey(key) {
    var prefix = state.projectId + '_';
    if (String(key).indexOf(prefix) !== 0) return null;
    var rest = String(key).substring(prefix.length);  // {ym}_{personId}
    if (rest.length < 9) return null;
    return { ym: rest.substring(0, 7), personId: rest.substring(8) };
  }
  function snapPersonName(personId) {
    var p = _allPersons.find(function (x) { return x.id === personId; });
    return p ? (p.name || personId) : personId;
  }
  // planned 맵에서 "값이 있는" 셀 개수
  function countPlanCells(planned) {
    var n = 0;
    Object.keys(planned || {}).forEach(function (k) {
      if (snapCellPlanSig(planned[k]) !== EMPTY_SIG) n++;
    });
    return n;
  }

  // 스냅샷(planned) ↔ 현재(state.planned) 차이
  function computeSnapshotDiff(snapPlanned) {
    var cur = state.planned || {};
    var snap = snapPlanned || {};
    var keys = {};
    Object.keys(snap).forEach(function (k) { keys[k] = 1; });
    Object.keys(cur).forEach(function (k) { keys[k] = 1; });
    var added = [], removed = [], changed = [];
    Object.keys(keys).forEach(function (k) {
      var info = parseSnapKey(k);
      if (!info) return;
      var sigS = snap[k] ? snapCellPlanSig(snap[k]) : '';
      var sigC = cur[k]  ? snapCellPlanSig(cur[k])  : '';
      var hasS = !!snap[k] && sigS !== EMPTY_SIG;
      var hasC = !!cur[k]  && sigC !== EMPTY_SIG;
      if (hasS && !hasC)      removed.push({ ym: info.ym, personId: info.personId, from: snap[k] });
      else if (!hasS && hasC) added.push({ ym: info.ym, personId: info.personId, to: cur[k] });
      else if (hasS && hasC && sigS !== sigC) changed.push({ ym: info.ym, personId: info.personId, from: snap[k], to: cur[k] });
    });
    return { added: added, removed: removed, changed: changed };
  }

  // ── Firestore I/O ──────────────────────────────────────────────────
  function loadSnapshots() {
    if (!state.projectId || !isFirestoreReady()) return Promise.resolve([]);
    return db().collection(SNAP_COLL)
      .where('projectId', '==', state.projectId)
      .get()
      .then(function (qs) {
        var arr = [];
        qs.forEach(function (doc) {
          var d = doc.data() || {};
          arr.push({
            id:          doc.id,
            label:       d.label || '(이름 없음)',
            kind:        d.kind || 'manual',
            createdAt:   d.createdAt || '',
            author:      d.author || null,
            cellCount:   typeof d.cellCount === 'number' ? d.cellCount : countPlanCells(d.planned),
            personCount: Array.isArray(d.personIds) ? d.personIds.length : 0,
            planned:     d.planned || {},
            personIds:   Array.isArray(d.personIds) ? d.personIds : [],
            personRoles: d.personRoles || {}
          });
        });
        arr.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        return arr;
      });
  }

  function saveSnapshot(label, kind) {
    if (!state.projectId || !isFirestoreReady()) return Promise.reject(new Error('Firestore 미연결'));
    var doc = {
      projectId:   state.projectId,
      label:       label || '',
      kind:        kind || 'manual',
      createdAt:   new Date().toISOString(),
      author:      getCurrentUserInfo(),
      planned:     plDeepCopy(state.planned),
      personIds:   plDeepCopy(state.personIds),
      personRoles: plDeepCopy(state.personRoles),
      cellCount:   countPlanCells(state.planned)
    };
    return db().collection(SNAP_COLL).add(doc);
  }

  function deleteSnapshotDoc(id) {
    if (!isFirestoreReady()) return Promise.reject(new Error('Firestore 미연결'));
    return db().collection(SNAP_COLL).doc(id).delete();
  }

  // ── 날짜/라벨 포맷 ──────────────────────────────────────────────────
  function fmtSnapDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ── 모달 ────────────────────────────────────────────────────────────
  function openSnapshotModal() {
    var modal = document.getElementById('pl-snapshot-modal');
    if (!modal) return;
    if (!state.projectId) { showToast('먼저 과제를 선택하세요.', 'warn'); return; }
    _snapOpenId = null;
    modal.hidden = false;
    renderSnapshotModalBody();   // 즉시 현재 요약/폼 표시
    // 리스트 로드
    var listEl = document.getElementById('pl-snap-list');
    if (listEl) listEl.innerHTML = '<div class="pl-snap-loading">불러오는 중…</div>';
    loadSnapshots().then(function (arr) {
      _snapshots = arr;
      renderSnapshotList();
    }).catch(function (e) {
      console.error('스냅샷 로드 실패:', e);
      if (listEl) listEl.innerHTML = '<div class="pl-snap-empty">목록을 불러오지 못했습니다.</div>';
    });
  }

  function closeSnapshotModal() {
    var modal = document.getElementById('pl-snapshot-modal');
    if (modal) modal.hidden = true;
    _snapOpenId = null;
  }

  // 모달 상단(현재 요약 + 저장 폼) 렌더
  function renderSnapshotModalBody() {
    var sumEl = document.getElementById('pl-snap-current-summary');
    if (sumEl) {
      var nPersons = state.personIds.length;
      var nCells = countPlanCells(state.planned);
      sumEl.innerHTML = '현재 예상 계획: <strong>' + nPersons + '명</strong> · <strong>' +
        nCells + '개</strong> 입력 셀';
    }
  }

  function renderSnapshotList() {
    var listEl = document.getElementById('pl-snap-list');
    if (!listEl) return;
    if (!_snapshots.length) {
      listEl.innerHTML = '<div class="pl-snap-empty">저장된 스냅샷이 없습니다. 위에서 현재 계획을 저장해 보세요.</div>';
      return;
    }
    var html = _snapshots.map(function (s) {
      var who = s.author ? plEsc(s.author.name || s.author.email || '') : '—';
      var badge = (s.kind === 'auto')
        ? '<span class="pl-snap-badge pl-snap-badge--auto">자동백업</span>'
        : '';
      var isOpen = (_snapOpenId === s.id);
      var viewOpen = isOpen && _snapOpenMode === 'view';
      var diffOpen = isOpen && _snapOpenMode === 'diff';
      var panelHtml = !isOpen ? ''
        : (_snapOpenMode === 'view' ? renderSnapshotViewHtml(s) : renderSnapshotDiffHtml(s));
      var row =
        '<div class="pl-snap-row' + (isOpen ? ' is-open' : '') + '" data-snap-id="' + plEsc(s.id) + '">' +
          '<div class="pl-snap-row-main">' +
            '<div class="pl-snap-row-info">' +
              '<div class="pl-snap-row-label">' + plEsc(s.label) + badge + '</div>' +
              '<div class="pl-snap-row-meta">' +
                fmtSnapDate(s.createdAt) + ' · ' + who +
                ' · ' + s.personCount + '명 · ' + s.cellCount + '셀' +
              '</div>' +
            '</div>' +
            '<div class="pl-snap-row-actions">' +
              '<button type="button" class="pl-snap-btn' + (viewOpen ? ' is-active' : '') + '" data-snap-act="view" data-snap-id="' + plEsc(s.id) + '">' + (viewOpen ? '내역 닫기' : '내역') + '</button>' +
              '<button type="button" class="pl-snap-btn' + (diffOpen ? ' is-active' : '') + '" data-snap-act="diff" data-snap-id="' + plEsc(s.id) + '">' + (diffOpen ? '차이 닫기' : '차이') + '</button>' +
              '<button type="button" class="pl-snap-btn pl-snap-btn--primary" data-snap-act="restore" data-snap-id="' + plEsc(s.id) + '">복원</button>' +
              '<button type="button" class="pl-snap-btn pl-snap-btn--danger" data-snap-act="delete" data-snap-id="' + plEsc(s.id) + '">삭제</button>' +
            '</div>' +
          '</div>' +
          panelHtml +
        '</div>';
      return row;
    }).join('');
    listEl.innerHTML = html;
  }

  // 내역 패널 HTML — 스냅샷에 저장된 예상 계획을 "표" 형태로 표시 (현재와 비교 안 함)
  function renderSnapshotViewHtml(snap) {
    var planned = snap.planned || {};
    var roles = snap.personRoles || {};

    // 인력별 { ym: cell } 묶기 + 등장 ym 수집 (값 있는 셀만)
    var byPerson = {};
    var ymSet = {};
    Object.keys(planned).forEach(function (k) {
      var info = parseSnapKey(k);
      if (!info) return;
      if (snapCellPlanSig(planned[k]) === EMPTY_SIG) return;
      if (!byPerson[info.personId]) byPerson[info.personId] = {};
      byPerson[info.personId][info.ym] = planned[k];
      ymSet[info.ym] = 1;
    });
    var yms = Object.keys(ymSet).sort();

    // 인력 순서: 스냅샷 personIds 우선, 빠진 인력은 뒤에
    var order = [];
    var seen = {};
    (snap.personIds || []).forEach(function (pid) { if (!seen[pid]) { seen[pid] = 1; order.push(pid); } });
    Object.keys(byPerson).forEach(function (pid) { if (!seen[pid]) { seen[pid] = 1; order.push(pid); } });

    var dlBtn = '<button type="button" class="pl-snap-btn" data-snap-act="xlsx" data-snap-id="' + plEsc(snap.id) + '">⬇ 엑셀</button>';
    var copyBtn = '<button type="button" class="pl-snap-btn" data-snap-act="copy" data-snap-id="' + plEsc(snap.id) + '">📋 시트 복사</button>';
    var bar = '<div class="pl-snap-view-bar">' +
      '<span class="pl-snap-view-when">📸 ' + fmtSnapDate(snap.createdAt) + ' 시점의 예상 계획</span>' +
      '<span class="pl-snap-view-actions">' + copyBtn + dlBtn + '</span></div>';

    if (!yms.length) {
      return '<div class="pl-snap-diff">' + bar +
        '<div class="pl-snap-diff-empty">이 스냅샷에는 입력된 예상 계획이 없습니다. (' +
        (snap.personIds ? snap.personIds.length : 0) + '명 배정)</div></div>';
    }

    // 헤더 라벨: 단일 연도면 "N월", 여러 해 걸치면 "YYYY-MM"
    var years = {};
    yms.forEach(function (ym) { years[ym.substring(0, 4)] = 1; });
    var oneYear = Object.keys(years).length === 1;
    function ymHead(ym) { return oneYear ? (parseInt(ym.substring(5, 7), 10) + '월') : ym; }

    var thead = '<tr><th class="pl-snap-th-name">이름</th><th class="pl-snap-th-ci">구분</th>' +
      yms.map(function (ym) { return '<th>' + plEsc(ymHead(ym)) + '</th>'; }).join('') +
      '<th class="pl-snap-th-sum">합계</th></tr>';

    var tbody = order.map(function (pid) {
      var cells = byPerson[pid] || {};
      var role = roles[pid] || {};
      var isSplit = role.split === true;   // ← 나눔은 사람 단위 role.split로 판정 (cell.rates 잔재 아님)
      var ciLabel = role.cashOrInkind ? fundTypeLabel(role.cashOrInkind) : '';
      var nameCell = plEsc(snapPersonName(pid)) +
        (isSplit ? ' <span class="pl-snap-view-split">나눔</span>' : '');
      var sum = 0;
      var tds = yms.map(function (ym) {
        var c = cells[ym];
        if (c && snapCellPlanSig(c) !== EMPTY_SIG) {
          var amt = snapCellAmt(c); sum += amt;
          return '<td class="pl-snap-td-has">' +
            '<div class="pl-snap-td-rate">' + snapNum(c.rate) + '%</div>' +
            '<div class="pl-snap-td-amt">' + amt.toLocaleString('ko-KR') + '</div></td>';
        }
        return '<td class="pl-snap-td-empty">·</td>';
      }).join('');
      return '<tr><td class="pl-snap-td-name">' + nameCell + '</td>' +
        '<td class="pl-snap-td-ci">' + plEsc(ciLabel) + '</td>' + tds +
        '<td class="pl-snap-td-sum">' + sum.toLocaleString('ko-KR') + '</td></tr>';
    }).join('');

    return '<div class="pl-snap-diff">' + bar +
      '<div class="pl-snap-table-wrap"><table class="pl-snap-table">' +
        '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div></div>';
  }

  // 현재 과제의 키워드 (파일명/제목용) — 다른 페이지와 동일 fallback
  function getSnapKeyword() {
    var proj = getProject();
    if (!proj) return '';
    return (proj.keywords || proj.keyword || proj.name || proj.projectName || proj.id || '').toString().trim();
  }

  // 스냅샷 → 표 AoA(배열의 배열) 빌드. 엑셀·클립보드가 공유.
  function buildSnapshotAoa(snap) {
    var planned = snap.planned || {};
    var roles = snap.personRoles || {};
    var byPerson = {};
    var ymSet = {};
    Object.keys(planned).forEach(function (k) {
      var info = parseSnapKey(k);
      if (!info) return;
      if (snapCellPlanSig(planned[k]) === EMPTY_SIG) return;
      if (!byPerson[info.personId]) byPerson[info.personId] = {};
      byPerson[info.personId][info.ym] = planned[k];
      ymSet[info.ym] = 1;
    });
    var yms = Object.keys(ymSet).sort();
    var order = [];
    var seen = {};
    (snap.personIds || []).forEach(function (pid) { if (!seen[pid]) { seen[pid] = 1; order.push(pid); } });
    Object.keys(byPerson).forEach(function (pid) { if (!seen[pid]) { seen[pid] = 1; order.push(pid); } });

    var header = ['이름', '구분'];
    yms.forEach(function (ym) { header.push(ym + ' 참여율(%)'); header.push(ym + ' 금액'); });
    header.push('합계 금액');

    var aoa = [header];
    order.forEach(function (pid) {
      var cells = byPerson[pid] || {};
      var role = roles[pid] || {};
      var ciLabel = role.cashOrInkind ? fundTypeLabel(role.cashOrInkind) : '';
      var row = [snapPersonName(pid), ciLabel];
      var sum = 0;
      yms.forEach(function (ym) {
        var c = cells[ym];
        if (c && snapCellPlanSig(c) !== EMPTY_SIG) {
          row.push(snapNum(c.rate));
          var amt = snapCellAmt(c); row.push(amt); sum += amt;
        } else { row.push(''); row.push(''); }
      });
      row.push(sum);
      aoa.push(row);
    });
    return { aoa: aoa, hasData: yms.length > 0 };
  }

  function snapFileBase(snap) {
    var kw = getSnapKeyword().replace(/[\\/:*?"<>|]/g, '_').slice(0, 20);
    var safeLabel = String(snap.label || '스냅샷').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    var safeDate = fmtSnapDate(snap.createdAt).replace(/[: ]/g, '-');
    // 요청 형식: 키워드_스냅샷_{이름}_{날짜}
    return (kw ? kw + '_' : '') + '스냅샷_' + safeLabel + '_' + safeDate;
  }

  // 스냅샷 → 엑셀 다운로드
  function downloadSnapshotXlsx(id) {
    var snap = _snapshots.find(function (s) { return s.id === id; });
    if (!snap) return;
    if (!window.XLSX) { showToast('엑셀 모듈을 불러오지 못했습니다.', 'error'); return; }
    var built = buildSnapshotAoa(snap);
    if (!built.hasData) { showToast('입력된 예상 계획이 없습니다.', 'info'); return; }
    try {
      var ws = XLSX.utils.aoa_to_sheet(built.aoa);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '스냅샷');
      XLSX.writeFile(wb, snapFileBase(snap) + '.xlsx');
      showToast('⬇ 엑셀 다운로드', 'success');
    } catch (e) {
      console.error('스냅샷 엑셀 실패:', e);
      showToast('엑셀 생성 실패', 'error');
    }
  }

  // 스냅샷 → 시트 붙여넣기용 TSV 클립보드 복사
  function copySnapshotToClipboard(id) {
    var snap = _snapshots.find(function (s) { return s.id === id; });
    if (!snap) return;
    var built = buildSnapshotAoa(snap);
    if (!built.hasData) { showToast('입력된 예상 계획이 없습니다.', 'info'); return; }
    var tsv = built.aoa.map(function (row) {
      return row.map(function (v) { return (v == null ? '' : String(v)); }).join('\t');
    }).join('\n');
    var done = function () { showToast('📋 시트 붙여넣기용으로 복사됨', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(done).catch(function () { snapFallbackCopy(tsv, done); });
    } else {
      snapFallbackCopy(tsv, done);
    }
  }
  function snapFallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb && cb(); }
    catch (e) { showToast('복사 실패 — 표를 직접 선택해 복사하세요.', 'error'); }
    document.body.removeChild(ta);
  }


  // 차이 패널 HTML (스냅샷 = 과거/좌 기준, 현재 = 우)
  function renderSnapshotDiffHtml(snap) {
    var diff = computeSnapshotDiff(snap.planned);
    var nA = diff.added.length, nC = diff.changed.length, nR = diff.removed.length;
    if (!nA && !nC && !nR) {
      return '<div class="pl-snap-diff"><div class="pl-snap-diff-empty">스냅샷 시점과 현재 예상 계획이 동일합니다.</div></div>';
    }
    // 인력별 그룹핑
    var byPerson = {};
    function push(item, type) {
      var pid = item.personId;
      if (!byPerson[pid]) byPerson[pid] = [];
      byPerson[pid].push({ type: type, ym: item.ym, from: item.from, to: item.to });
    }
    diff.added.forEach(function (i) { push(i, 'add'); });
    diff.changed.forEach(function (i) { push(i, 'chg'); });
    diff.removed.forEach(function (i) { push(i, 'rm'); });

    var pids = Object.keys(byPerson).sort(function (a, b) {
      return snapPersonName(a).localeCompare(snapPersonName(b), 'ko');
    });

    var groupsHtml = pids.map(function (pid) {
      var items = byPerson[pid].sort(function (a, b) { return a.ym.localeCompare(b.ym); });
      var rows = items.map(function (it) {
        var cls, txt;
        if (it.type === 'add') {
          cls = 'is-add'; txt = '추가 — ' + snapNum(it.to.rate) + '% / ' + snapCellAmt(it.to).toLocaleString('ko-KR') + '원';
        } else if (it.type === 'rm') {
          cls = 'is-rm'; txt = '삭제 — (이전 ' + snapNum(it.from.rate) + '% / ' + snapCellAmt(it.from).toLocaleString('ko-KR') + '원)';
        } else {
          cls = 'is-chg';
          var rF = snapNum(it.from.rate), rT = snapNum(it.to.rate);
          var aF = snapCellAmt(it.from), aT = snapCellAmt(it.to);
          var parts = [];
          if (rF !== rT) parts.push(rF + '% → ' + rT + '%');
          if (aF !== aT) parts.push(aF.toLocaleString('ko-KR') + ' → ' + aT.toLocaleString('ko-KR') + '원');
          txt = '변경 — ' + (parts.length ? parts.join(', ') : '나눔/분류 변경');
        }
        return '<div class="pl-snap-diff-item ' + cls + '"><span class="pl-snap-diff-ym">' + plEsc(it.ym) + '</span>' + plEsc(txt) + '</div>';
      }).join('');
      return '<div class="pl-snap-diff-group">' +
               '<div class="pl-snap-diff-person">' + plEsc(snapPersonName(pid)) + '</div>' + rows +
             '</div>';
    }).join('');

    return '<div class="pl-snap-diff">' +
        '<div class="pl-snap-diff-counts">' +
          '<span class="pl-snap-diff-c is-add">+추가 ' + nA + '</span>' +
          '<span class="pl-snap-diff-c is-chg">~변경 ' + nC + '</span>' +
          '<span class="pl-snap-diff-c is-rm">−삭제 ' + nR + '</span>' +
          '<span class="pl-snap-diff-legend">스냅샷 → 현재 기준</span>' +
        '</div>' + groupsHtml +
      '</div>';
  }

  // ── 액션 ────────────────────────────────────────────────────────────
  function onSaveSnapshotClick() {
    var input = document.getElementById('pl-snap-label-input');
    var label = input ? input.value.trim() : '';
    if (!label) label = '스냅샷 ' + fmtSnapDate(new Date().toISOString());
    var btn = document.getElementById('pl-snap-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    saveSnapshot(label, 'manual').then(function () {
      if (input) input.value = '';
      showToast('📸 스냅샷 저장됨 — ' + label, 'success');
      return loadSnapshots();
    }).then(function (arr) {
      _snapshots = arr;
      renderSnapshotList();
    }).catch(function (e) {
      console.error('스냅샷 저장 실패:', e);
      showToast('스냅샷 저장 실패', 'error');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '📸 현재 계획 저장'; }
    });
  }

  function onRestoreSnapshot(id) {
    var snap = _snapshots.find(function (s) { return s.id === id; });
    if (!snap) return;
    var diff = computeSnapshotDiff(snap.planned);
    var nChanges = diff.added.length + diff.changed.length + diff.removed.length;
    var msg = '이 스냅샷("' + snap.label + '")으로 예상 계획을 복원합니다.\n\n' +
      '· 현재 예상 셀·인력구성·역할이 모두 스냅샷 시점으로 덮어써집니다.\n' +
      '· 변경되는 셀: ' + nChanges + '개.\n' +
      '· 복원 직전 현재 상태가 자동 백업 스냅샷으로 저장됩니다.\n\n계속할까요?';
    if (!confirm(msg)) return;

    // 1) 복원 전 자동 백업
    saveSnapshot('복원 전 자동백업 (' + fmtSnapDate(new Date().toISOString()) + ')', 'auto')
      .then(function () {
        // 2) 덮어쓰기 (확정 범위: planned + personIds + personRoles)
        state.planned     = plDeepCopy(snap.planned);
        state.personIds   = plDeepCopy(snap.personIds);
        state.personRoles = plDeepCopy(snap.personRoles);
        scheduleSave();
        renderAll();
        showToast('↩ "' + snap.label + '" 복원 완료 (자동백업 저장됨)', 'success');
        return loadSnapshots();
      })
      .then(function (arr) {
        _snapshots = arr;
        renderSnapshotModalBody();
        renderSnapshotList();
      })
      .catch(function (e) {
        console.error('복원 실패:', e);
        showToast('복원 실패 — 데이터는 변경되지 않았습니다.', 'error');
      });
  }

  function onDeleteSnapshot(id) {
    var snap = _snapshots.find(function (s) { return s.id === id; });
    if (!snap) return;
    if (!confirm('스냅샷 "' + snap.label + '"을(를) 삭제하시겠습니까?\n(현재 예상 계획 데이터에는 영향 없음)')) return;
    deleteSnapshotDoc(id).then(function () {
      if (_snapOpenId === id) _snapOpenId = null;
      showToast('🗑 스냅샷 삭제됨', 'success');
      return loadSnapshots();
    }).then(function (arr) {
      _snapshots = arr;
      renderSnapshotList();
    }).catch(function (e) {
      console.error('스냅샷 삭제 실패:', e);
      showToast('스냅샷 삭제 실패', 'error');
    });
  }

  function onTogglePanel(id, mode) {
    if (_snapOpenId === id && _snapOpenMode === mode) {
      _snapOpenId = null;       // 같은 버튼 다시 → 닫기
    } else {
      _snapOpenId = id;
      _snapOpenMode = mode;     // 다른 모드면 같은 행에서 패널만 전환
    }
    renderSnapshotList();
  }

  // 📸 버튼은 예상(planned) 탭에서만 노출
  function renderSnapshotBtnVisibility() {
    var btn = document.getElementById('pl-snapshot-btn');
    if (btn) btn.style.display = (state.activeTab === 'planned') ? '' : 'none';
  }

  function bindSnapshotEvents() {
    var openBtn = document.getElementById('pl-snapshot-btn');
    if (openBtn) openBtn.addEventListener('click', openSnapshotModal);

    var closeBtn = document.getElementById('pl-snap-close');
    if (closeBtn) closeBtn.addEventListener('click', closeSnapshotModal);

    var overlay = document.getElementById('pl-snapshot-modal');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeSnapshotModal();
      });
    }

    var saveBtn = document.getElementById('pl-snap-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', onSaveSnapshotClick);

    var labelInput = document.getElementById('pl-snap-label-input');
    if (labelInput) {
      labelInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); onSaveSnapshotClick(); }
      });
    }

    // 리스트 액션 (위임)
    var listEl = document.getElementById('pl-snap-list');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-snap-act]');
        if (!b) return;
        var id = b.getAttribute('data-snap-id');
        var act = b.getAttribute('data-snap-act');
        if (act === 'restore') onRestoreSnapshot(id);
        else if (act === 'delete') onDeleteSnapshot(id);
        else if (act === 'diff') onTogglePanel(id, 'diff');
        else if (act === 'view') onTogglePanel(id, 'view');
        else if (act === 'xlsx') downloadSnapshotXlsx(id);
        else if (act === 'copy') copySnapshotToClipboard(id);
      });
    }

    // Esc 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = document.getElementById('pl-snapshot-modal');
        if (m && !m.hidden) closeSnapshotModal();
      }
    });
  }

  // ====================================================================
  // 토스트 알림
  // ====================================================================
  var _toastTimer = null;

  function showToast(msg, type, showUndo) {
    var toast = document.getElementById('pl-toast');
    if (!toast) return;

    toast.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);

    if (showUndo) {
      var undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.textContent = '되돌리기';
      undoBtn.style.cssText =
        'margin-left:0.75rem; padding:0.2rem 0.6rem; border-radius:0.3rem;' +
        'border:1px solid rgba(255,255,255,0.5); background:transparent;' +
        'color:#fff; font-size:0.78rem; font-weight:600; cursor:pointer; font-family:inherit;';
      undoBtn.addEventListener('click', function () {
        undoCopy();
        hideToast();
      });
      toast.appendChild(undoBtn);
    }

    var bgMap = { success: '#059669', warn: '#d97706', info: '#2563eb', error: '#dc2626' };
    toast.style.background = bgMap[type] || bgMap.info;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, showUndo ? 6000 : 3000);
  }

  function hideToast() {
    var toast = document.getElementById('pl-toast');
    if (!toast) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
  }

  // ====================================================================
  // 인력 추가 모달
  // ====================================================================
  function openAddModal() {
    var modal = document.getElementById('pl-add-modal');
    if (!modal) return;
    modal.hidden = false;
    // C2 §4.8: 현 과제가 3책5공 관리 대상이면 헤더 칩 표시
    var ch5gChip = document.getElementById('pl-modal-ch5g-chip');
    if (ch5gChip) {
      var cp = getProject();
      ch5gChip.style.display = (cp && cp.is3ch5gManaged) ? 'inline-flex' : 'none';
    }
    // v5.2: 모달 열 때마다 퇴사자 토글 초기화 (재직자만이 기본값)
    var includeExitedEl = document.getElementById('pl-modal-include-exited');
    if (includeExitedEl) includeExitedEl.checked = false;
    // v5.2: "이미 추가된 인력" 스냅샷 — 모달 세션 동안 상단 섹션 고정 (점프 방지)
    _modalAddedSnapshot = state.personIds.slice();
    // v5.2: 일괄 선택 초기화
    _modalSelectedIds = Object.create(null);
    // v5.2: "이미 추가된 인력" 섹션을 접힘 상태로 초기화 (필요할 때만 펼침)
    var toggleBtn  = document.getElementById('pl-modal-added-toggle');
    var addedListEl = document.getElementById('pl-modal-added-list');
    if (toggleBtn)  { toggleBtn.classList.remove('is-expanded'); toggleBtn.setAttribute('aria-expanded', 'false'); }
    if (addedListEl) addedListEl.hidden = true;

    // v6.3: 모달 세션마다 인력 통계 캐시 재로드.
    //   - 모달 닫혀있는 동안 다른 과제에서 데이터가 갱신됐을 수 있으므로 매번 새로 가져옴.
    //   - 첫 렌더는 통계 없이 즉시 (UX 끊김 방지), 로드 완료되면 다시 그림.
    _modalLaborCache = null;
    loadModalLaborCache(function () {
      // 모달이 아직 열려 있을 때만 재렌더 (열린 사이에 닫혔으면 무시)
      var m = document.getElementById('pl-add-modal');
      if (m && !m.hidden) {
        var searchEl = document.getElementById('pl-modal-search');
        renderModalList(searchEl ? searchEl.value : '');
      }
    });

    renderModalList('');
    renderBulkBar();
    var searchInput = document.getElementById('pl-modal-search');
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    var clearBtn = document.getElementById('pl-modal-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';

    // C4: 신규/기존 필터 + 일괄 재판정 (모달 열 때마다 초기화·바인딩)
    _modalNeFilter = '';
    var neBar = document.getElementById('pl-modal-ne-filter');
    if (neBar && !neBar._c4bound) {
      neBar._c4bound = true;
      neBar.addEventListener('click', function (e) {
        var fb = e.target.closest('.pl-ne-filter-btn');
        if (fb) {
          _modalNeFilter = fb.dataset.ne || '';
          neBar.querySelectorAll('.pl-ne-filter-btn').forEach(function (b) {
            b.classList.toggle('is-active', (b.dataset.ne || '') === _modalNeFilter);
          });
          renderModalList(document.getElementById('pl-modal-search').value);
          return;
        }
        if (e.target.closest('#pl-modal-rejudge-btn')) {
          rejudgeAllNewExisting();
        }
      });
    }
    if (neBar) {
      neBar.querySelectorAll('.pl-ne-filter-btn').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.ne || '') === '');
      });
    }
  }

  // C4: 현재 규칙으로 추가된 인력 전체 newOrExisting 재판정
  function rejudgeAllNewExisting() {
    var proj = getProject();
    if (!hasNewJudgeRule(proj)) { showToast('이 과제엔 신규 판정 규칙이 없습니다', 'info'); return; }
    var changed = 0, unknown = 0;
    state.personIds.forEach(function (pid) {
      var person = _allPersons.find(function (p) { return p.id === pid; });
      var judged = judgeNewExisting(person, proj);
      if (judged === '미상' || judged == null) { unknown++; return; }
      if (!state.personRoles[pid]) {
        state.personRoles[pid] = { newOrExisting: judged, cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null };
        changed++;
      } else if (state.personRoles[pid].newOrExisting !== judged) {
        state.personRoles[pid].newOrExisting = judged;
        changed++;
      }
    });
    renderAll();
    scheduleSave();
    var msg = changed + '명 재판정' + (unknown ? ' (미상 ' + unknown + '명 제외)' : '');
    showToast(msg, 'success');
  }

  function closeAddModal() {
    var modal = document.getElementById('pl-add-modal');
    if (modal) modal.hidden = true;
    _modalAddedSnapshot = null;   // v5.2: 모달 닫으면 스냅샷 해제
    _modalSelectedIds = Object.create(null);  // v5.2: 선택 상태도 리셋
  }

  // v5.2: 모달이 열려있는 동안의 "이미 추가된 인력" 스냅샷.
  //   - 화면 점프 방지 위해 모달 세션 동안 상단 섹션의 행 구성을 고정.
  //   - 추가 클릭으로 모달 높이가 변하면 → 마우스 아래 행이 바뀌어 다음 클릭이
  //     의도치 않게 "제거" 버튼에 떨어지는 버그가 있었음.
  //   - openAddModal에서 스냅샷 새로 찍고, closeAddModal에서 null로 리셋.
  var _modalAddedSnapshot = null;

  function renderModalList(keyword) {
    var resultList   = document.getElementById('pl-modal-result-list');
    var emptyEl      = document.getElementById('pl-modal-empty');
    var addedSection = document.getElementById('pl-modal-added-section');
    var addedList    = document.getElementById('pl-modal-added-list');
    if (!resultList) return;

    // v5.3: 콤마 구분 다중 검색 (OR 매칭). 예: "김,이,박" → 이름에 김 또는 이 또는 박 포함
    var rawKw = (keyword || '').trim().toLowerCase();
    var kwList = rawKw
      ? rawKw.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      : [];

    // 이미 추가된 인력 목록 (상단) — 스냅샷 기준
    //   - 모달 열린 시점의 personIds로 행을 그림. 그 후 추가/제거해도 행 구성은 그대로.
    //   - 단, "방금 추가한 인력"도 보이도록, state.personIds에 있지만 스냅샷엔 없는
    //     인력은 끝에 덧붙임 (이 부분은 모달 높이 늘어남 → 점프 발생할 수 있어 보류).
    //   - 사용자가 "확인"용으로 보는 정보이지 실시간 인터랙션 대상 아님.
    var snap = _modalAddedSnapshot || state.personIds;
    var addedPersons = snap
      .map(function (id) { return _allPersons.find(function (p) { return p.id === id; }); })
      .filter(Boolean);

    if (addedList) {
      addedList.innerHTML = '';
      addedPersons.forEach(function (person) {
        // 스냅샷 시점엔 있었지만 현재는 제거된 인력은 옅게 표시 (상태 명확화)
        var stillAdded = state.personIds.indexOf(person.id) >= 0;
        var row = makePersonRow(person, true);
        if (!stillAdded) {
          row.style.opacity = '0.45';
          // "제거" 버튼이 비활성 (다시 누르면 에러나므로). 텍스트도 바꿔서 명확히.
          var btn = row.querySelector('button');
          if (btn) {
            btn.disabled = true;
            btn.textContent = '제거됨';
            btn.style.cursor = 'default';
          }
        }
        addedList.appendChild(row);
      });
    }
    if (addedSection) addedSection.style.display = addedPersons.length ? 'block' : 'none';
    // v5.2: 카운트 칩 갱신 (현재 추가된 인력 기준 — 제거된 것 제외)
    var countEl = document.getElementById('pl-modal-added-toggle-count');
    if (countEl) {
      var activeCount = addedPersons.filter(function (p) {
        return state.personIds.indexOf(p.id) >= 0;
      }).length;
      countEl.textContent = activeCount;
    }

    // 전체 인력 필터
    // 현재 선택된 프로젝트의 회사 (같은 회사 인력만 후보로 노출)
    var currentProject = getProject();
    var projCompany = currentProject ? currentProject.company : '';

    // v5.2: 퇴사자 포함 토글 — 과거 시점 데이터 입력용
    var includeExitedEl = document.getElementById('pl-modal-include-exited');
    var includeExited = !!(includeExitedEl && includeExitedEl.checked);

    var filtered = _allPersons.filter(function (p) {
      if (!includeExited && p.status === 'exited') return false; // 토글 켜져있으면 통과
      // v5.3: 키워드 중 하나라도 이름에 포함되면 통과 (OR). 키워드 없으면 전체 통과.
      if (kwList.length > 0) {
        var nameLower = p.name.toLowerCase();
        var matched = kwList.some(function (k) { return nameLower.indexOf(k) >= 0; });
        if (!matched) return false;
      }
      // 회사 제한: 프로젝트에 회사가 지정되어 있으면 같은 회사만
      if (projCompany && p.company !== projCompany) return false;
      // 이미 추가된 인력은 하단 리스트에서 제외
      if (state.personIds.indexOf(p.id) >= 0) return false;
      // C4: 신규/기존 필터
      if (_modalNeFilter) {
        if (judgeNewExisting(p, currentProject) !== _modalNeFilter) return false;
      }
      return true;
    });

    // C4: 규칙이 있는 과제에서만 신규/기존 필터 바 노출
    var neFilterBar = document.getElementById('pl-modal-ne-filter');
    if (neFilterBar) neFilterBar.style.display = hasNewJudgeRule(currentProject) ? 'inline-flex' : 'none';

    resultList.innerHTML = '';
    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      filtered.forEach(function (person) {
        var isAdded = state.personIds.indexOf(person.id) >= 0;
        resultList.appendChild(makePersonRow(person, false, isAdded));
      });
    }
  }

  // v5.2: 모달에서 현재 체크된 인력 ID 집합 (filter 변경에도 유지)
  var _modalSelectedIds = Object.create(null);
  // C4: 모달 신규/기존 필터 ('' | '신규' | '기존')
  var _modalNeFilter = '';

  // ====================================================================
  // v6.3: 모달 인력 통계 — 현재 진행 중 과제 수 + 현재 월 참여율
  //
  // 기획서 §3.3 — 인력 추가 모달 정보 확장. P0-1(participation-summary)에서
  // 만든 합산 로직을 이 모달에 끼운다.
  //
  // 데이터 모델:
  //   _modalLaborCache = {
  //     [projectId]: { planned: cells, actual: cells, personRoles }
  //   }
  //   ※ project-labor 자체의 state.planned/actual은 "현재 선택된 과제 하나"만
  //     보관하므로, 다른 모든 과제의 인건비를 알려면 별도 캐시가 필요하다.
  //
  // "현재 월"의 정의:
  //   - 오늘 날짜의 ym (예: '2026-05')
  //   - state.year와 무관하게 항상 오늘 기준 — 사용자가 작년 데이터로 작업
  //     중이어도 "지금 이 순간 이 사람의 부하"를 보여주는 게 의미 있다.
  //
  // 활성 탭:
  //   - state.activeTab (planned/actual) 그대로 따른다.
  //
  // 색깔 코딩 (엄격):
  //   <80%   기본
  //   ≥80%   노랑 (pl-modal-stats--warn)
  //   ≥90%   주황 (pl-modal-stats--high)
  //   ≥100%  빨강 (pl-modal-stats--over)
  // ====================================================================
  var _modalLaborCache = null;       // null = 미로딩, {} = 로딩 완료
  var _modalLaborLoading = false;

  function currentYm() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  // 오늘 기준 "활성" 과제 — laborManaged && status에 '수행' 포함 && 오늘 연도가 yearBudgets 범위
  function getModalActiveProjects() {
    var todayYear = new Date().getFullYear();
    return _allProjects.filter(function (p) {
      if (!p || !p.laborManaged) return false;
      var s = String(p.status || '');
      if (s.indexOf('수행') < 0) return false;
      var yb = p.yearBudgets || p.budgets || [];
      if (!Array.isArray(yb) || yb.length === 0) {
        var start = p.researchStart || p.startDate || p.submitDate || '';
        var end   = p.researchEnd   || p.endDate   || '';
        if (!start) return true;
        var sy = parseInt(start.substring(0, 4), 10);
        var ey = end ? parseInt(end.substring(0, 4), 10) : sy;
        return sy <= todayYear && todayYear <= ey;
      }
      return yb.some(function (b) {
        var bs = parseInt((b.start || b.startDate || '').substring(0, 4), 10);
        var be = parseInt((b.end   || b.endDate   || '').substring(0, 4), 10);
        if (!bs) return true;
        if (!be) be = bs;
        return bs <= todayYear && todayYear <= be;
      });
    });
  }

  // 모달 열릴 때 1회 호출 — 모든 활성 과제의 planned + actual + meta 캐싱
  function loadModalLaborCache(done) {
    if (!isFirestoreReady()) {
      _modalLaborCache = {};
      if (typeof done === 'function') done();
      return;
    }
    if (_modalLaborLoading) return; // 중복 방지
    _modalLaborLoading = true;

    var projects = getModalActiveProjects();
    // 현재 편집 중인 과제(state.projectId)는 캐시에 직접 합쳐서 Firestore 호출 1쌍 절약
    var currentPid = state.projectId;
    var promises = [];
    projects.forEach(function (proj) {
      if (proj.id === currentPid) {
        // 이미 메모리에 있는 state.planned/actual/personRoles 그대로 사용
        promises.push(Promise.resolve([
          { projectId: proj.id, kind: 'planned', cells: state.planned || {} },
          { projectId: proj.id, kind: 'actual',  cells: state.actual  || {} },
          { projectId: proj.id, kind: 'meta',    personRoles: state.personRoles || {} }
        ]));
        return;
      }
      promises.push(Promise.all([
        db().collection(LABOR_COLL).doc(proj.id + '_planned').get(),
        db().collection(LABOR_COLL).doc(proj.id + '_actual').get(),
        db().collection(LABOR_COLL).doc(proj.id + '_meta').get()
      ]).then(function (snaps) {
        return [
          { projectId: proj.id, kind: 'planned',
            cells: (snaps[0].exists && snaps[0].data().cells) ? snaps[0].data().cells : {} },
          { projectId: proj.id, kind: 'actual',
            cells: (snaps[1].exists && snaps[1].data().cells) ? snaps[1].data().cells : {} },
          { projectId: proj.id, kind: 'meta',
            personRoles: (snaps[2].exists && snaps[2].data().personRoles) ? snaps[2].data().personRoles : {} }
        ];
      }).catch(function (err) {
        console.error('모달 인력 통계 로드 실패 (project ' + proj.id + '):', err);
        return [
          { projectId: proj.id, kind: 'planned', cells: {} },
          { projectId: proj.id, kind: 'actual',  cells: {} },
          { projectId: proj.id, kind: 'meta',    personRoles: {} }
        ];
      }));
    });

    Promise.all(promises).then(function (results) {
      var cache = {};
      results.forEach(function (triple) {
        triple.forEach(function (r) {
          if (!cache[r.projectId]) cache[r.projectId] = { planned: {}, actual: {}, personRoles: {} };
          if (r.kind === 'planned')      cache[r.projectId].planned     = r.cells;
          else if (r.kind === 'actual')  cache[r.projectId].actual      = r.cells;
          else if (r.kind === 'meta')    cache[r.projectId].personRoles = r.personRoles;
        });
      });
      _modalLaborCache = cache;
      _modalLaborLoading = false;
      if (typeof done === 'function') done();
    });
  }

  // 한 인력의 "현재 월" 통계 — { projectCount, totalRate, breakdown: [{name, rate, cashOrInkind}] }
  // mode = state.activeTab ('planned' | 'actual')
  function getModalPersonStats(personId) {
    if (!_modalLaborCache) return null;
    var mode = state.activeTab === 'actual' ? 'actual' : 'planned';
    var ym = currentYm();
    var projects = getModalActiveProjects();

    var totalRate = 0;
    var projectCount = 0;
    var breakdown = [];

    projects.forEach(function (pj) {
      var bucket = _modalLaborCache[pj.id];
      if (!bucket) return;
      var cells = bucket[mode] || {};
      var key = pj.id + '_' + ym + '_' + personId;
      var cell = cells[key];
      if (!cell) return;
      var rate = +cell.rate || 0;
      if (rate <= 0) return;

      var role = (bucket.personRoles || {})[personId] || {};
      var ci = role.cashOrInkind === '현물' ? '현물' : '현금';

      totalRate += rate;
      projectCount++;
      breakdown.push({ projectId: pj.id, name: pj.name || pj.projectName || pj.id, rate: rate, cashOrInkind: ci });
    });

    // C2 §4.8: 3책5공 — 그 사람의 책/공 (관리 대상·수행 과제 전체, 명단은 모달 캐시 personRoles)
    var ch5g = null;
    if (window.ThreeFiveRule) {
      ch5g = window.ThreeFiveRule.countForPerson(personId, _allProjects, function (p) {
        var b = _modalLaborCache[p.id];
        if (b && b.personRoles) return Object.keys(b.personRoles);
        if (Array.isArray(p.personIds)) return p.personIds;
        return [];
      });
    }

    return { projectCount: projectCount, totalRate: totalRate, ym: ym, mode: mode, breakdown: breakdown, ch5g: ch5g };
  }

  function modalStatsClass(totalRate) {
    if (totalRate >= 100) return 'pl-modal-stats--over';
    if (totalRate >= 90)  return 'pl-modal-stats--high';
    if (totalRate >= 80)  return 'pl-modal-stats--warn';
    return '';
  }

  // v5.2: 인력 행 빌더 (체크박스 기반)
  //   isAddedSection = true: 상단 "이미 추가된 인력" 섹션. 체크박스 자리에 ✓, 우측 [제거] 버튼.
  //   isAddedSection = false: 하단 "전체 인력" 결과 리스트. 체크박스 + 행 클릭으로 토글.
  //     · 이미 추가된 인력은 비활성(check 불가, "추가됨" 표시).
  function makePersonRow(person, isAddedSection, isAdded) {
    var isExited = (person.status === 'exited');
    var isSelected = !isAddedSection && !isAdded && !!_modalSelectedIds[person.id];

    var row = document.createElement('div');
    row.className = 'pl-modal-person-row'
      + (isExited ? ' is-exited' : '')
      + (!isAddedSection && isAdded ? ' is-disabled' : '')
      + (!isAddedSection && !isAdded ? ' is-checkable' : '')
      + (isSelected ? ' is-selected' : '');
    row.dataset.personId = person.id;

    // 1. 왼쪽 — 체크박스 or 체크 마크
    if (isAddedSection) {
      // 상단 섹션 — 이미 추가된 인력. 체크박스 자리에 ✓
      var mark = document.createElement('span');
      mark.className = 'pl-modal-person-added-mark';
      mark.textContent = '✓';
      mark.title = '이미 추가됨';
      row.appendChild(mark);
    } else {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pl-modal-person-checkbox';
      cb.dataset.personId = person.id;
      if (isAdded) {
        cb.checked = true;
        cb.disabled = true;
        cb.title = '이미 추가됨';
      } else {
        cb.checked = isSelected;
      }
      row.appendChild(cb);
    }

    // 2. 가운데 — 이름 + 메타
    var badgesHtml = '';
    if (person.isYouth) badgesHtml += '<span class="pl-badge pl-badge--youth">청년</span>';
    if (isExited)       badgesHtml += '<span class="pl-badge pl-badge--exit">퇴사</span>';
    // C4: 과제 규칙 기반 신규/기존/미상 자동 판정 라벨
    var judged = judgeNewExisting(person, getProject());
    var neBadge = '';
    if (judged === '신규')      neBadge = '<span class="pl-modal-ne-badge pl-modal-ne-badge--new">신규</span>';
    else if (judged === '기존') neBadge = '<span class="pl-modal-ne-badge pl-modal-ne-badge--exist">기존</span>';
    else if (judged === '미상') neBadge = '<span class="pl-modal-ne-badge pl-modal-ne-badge--unknown">미상</span>';

    // v6.3: 현재 월 참여율·과제 수 배지 (이름 옆 인라인)
    //   - 캐시가 아직 로딩 중이면 비워둔다(나중에 재렌더되면서 채워짐).
    //   - 참여율 0이거나 데이터 없으면 표시 안 함(노이즈 방지).
    var statsHtml = '';
    if (_modalLaborCache) {
      var stats = getModalPersonStats(person.id);
      if (stats && stats.projectCount > 0) {
        var cls = modalStatsClass(stats.totalRate);
        var tipTab = stats.mode === 'actual' ? '실제' : '예상';
        var tipBreakdown = stats.breakdown.map(function (b) {
          return b.name + ' ' + b.rate + '% (' + b.cashOrInkind + ')';
        }).join(' · ');
        var tip = stats.ym + ' · ' + tipTab + ' 탭 기준\n' + tipBreakdown;
        // C2: 현 과제가 3책5공 관리 대상이면 "N개 과제" 대신 "책/공" 표시
        var curProj = getProject();
        var showCh5g = curProj && curProj.is3ch5gManaged && stats.ch5g && window.ThreeFiveRule;
        var countHtml;
        if (showCh5g) {
          var over = window.ThreeFiveRule.isOverLimit(stats.ch5g.chaek, stats.ch5g.gong);
          var ch5gTip = '3책5공 · 책 ' + stats.ch5g.chaek + ' / 공 ' + stats.ch5g.gong
            + ' (책≤3, 책+공≤5)' + (over ? ' · 한도 초과' : '');
          countHtml = '<span class="pl-modal-person-stats-count' + (over ? ' pl-ch5g-over' : '')
            + '" title="' + ch5gTip.replace(/"/g, '&quot;') + '">'
            + window.ThreeFiveRule.format(stats.ch5g.chaek, stats.ch5g.gong) + '</span>';
        } else {
          countHtml = '<span class="pl-modal-person-stats-count">' + stats.projectCount + '개 과제</span>';
        }
        statsHtml =
          ' <span class="pl-modal-person-stats ' + cls + '" title="' + tip.replace(/"/g, '&quot;') + '">' +
            countHtml +
            '<span class="pl-modal-person-stats-sep">·</span>' +
            '<span class="pl-modal-person-stats-rate">' + stats.totalRate + '%</span>' +
          '</span>';
      }
    }

    var nameDiv = document.createElement('div');
    nameDiv.style.flex = '1';
    nameDiv.innerHTML =
      '<div class="pl-modal-person-name">' + person.name +
        (badgesHtml ? ' ' + badgesHtml : '') + neBadge +
        statsHtml +
      '</div>' +
      '<div class="pl-modal-person-meta">' +
        (person.monthlySalary ? fmtSalary(person.monthlySalary) + '/월' : '월급 미등록') +
      '</div>';
    row.appendChild(nameDiv);

    // 3. 우측 — 상태/액션
    if (isAddedSection) {
      // 상단 섹션 — [제거] 버튼
      var rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'pl-modal-remove-btn';
      rmBtn.textContent = '제거';
      rmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removePersonFromProject(person.id);
        renderModalList(document.getElementById('pl-modal-search').value);
      });
      row.appendChild(rmBtn);
    } else if (isAdded) {
      // 이미 추가된 인력 (하단 결과 리스트에 표시될 때) — "추가됨" 라벨
      var lbl = document.createElement('span');
      lbl.style.cssText = 'font-size: 0.75rem; color: #94a3b8; font-weight: 600;';
      lbl.textContent = '추가됨';
      row.appendChild(lbl);
    }

    // 4. 행 클릭으로 체크박스 토글 (하단, 미추가 행만)
    if (!isAddedSection && !isAdded) {
      row.addEventListener('click', function (e) {
        // 체크박스 자체를 클릭한 경우엔 default 동작 따르도록 토글 안 함
        if (e.target.tagName === 'INPUT') return;
        var pid = person.id;
        _modalSelectedIds[pid] = !_modalSelectedIds[pid];
        if (!_modalSelectedIds[pid]) delete _modalSelectedIds[pid];
        // 행 상태 갱신 (전체 리렌더 없이)
        row.classList.toggle('is-selected', !!_modalSelectedIds[pid]);
        var cbEl = row.querySelector('.pl-modal-person-checkbox');
        if (cbEl) cbEl.checked = !!_modalSelectedIds[pid];
        renderBulkBar();
      });
      // 체크박스 직접 클릭 시 동기화
      var cbEl2 = row.querySelector('.pl-modal-person-checkbox');
      if (cbEl2) {
        cbEl2.addEventListener('change', function (e) {
          e.stopPropagation();
          var pid = person.id;
          if (this.checked) _modalSelectedIds[pid] = true;
          else delete _modalSelectedIds[pid];
          row.classList.toggle('is-selected', this.checked);
          renderBulkBar();
        });
      }
    }

    return row;
  }

  // v5.2: 일괄 액션 바 — 선택 개수에 따라 표시 갱신
  function renderBulkBar() {
    var bar = document.getElementById('pl-modal-bulk-bar');
    if (!bar) return;
    var count = Object.keys(_modalSelectedIds).length;
    var numEl  = document.getElementById('pl-modal-bulk-count-num');
    var addEl  = document.getElementById('pl-modal-bulk-add-num');
    if (numEl) numEl.textContent = count;
    if (addEl) addEl.textContent = count;
    if (count > 0) bar.classList.add('is-visible');
    else           bar.classList.remove('is-visible');
  }

  // v5.2: 일괄 추가 실행
  function bulkAddSelectedPersons() {
    var ids = Object.keys(_modalSelectedIds);
    if (!ids.length) return;
    var addedCount = 0;
    ids.forEach(function (pid) {
      if (state.personIds.indexOf(pid) >= 0) return;   // 이미 있으면 skip (이중 안전)
      addPersonToProject(pid);
      addedCount++;
    });
    _modalSelectedIds = Object.create(null);
    renderModalList(document.getElementById('pl-modal-search').value);
    renderBulkBar();
    showToast('+ ' + addedCount + '명 추가됨', 'success');
  }

  // v5.2: 선택 해제 (모두)
  function clearBulkSelection() {
    _modalSelectedIds = Object.create(null);
    renderModalList(document.getElementById('pl-modal-search').value);
    renderBulkBar();
  }

  function addPersonToProject(personId) {
    if (state.personIds.indexOf(personId) >= 0) return; // 중복 방지
    state.personIds.push(personId);
    // v5 신규: 새로 추가된 인력에게 personRoles 기본값 부여
    // (이미 있으면 보존 — 과거에 제거됐다가 다시 추가되는 케이스에서 분류 유지)
    if (!state.personRoles[personId]) {
      // C4: 규칙이 있으면 신규/기존 자동 판정값을 기본으로 (미상/규칙없음 → 기존)
      var person0 = _allPersons.find(function (p) { return p.id === personId; });
      var judged0 = judgeNewExisting(person0, getProject());
      var ne0 = (judged0 === '신규' || judged0 === '기존') ? judged0 : '기존';
      state.personRoles[personId] = { newOrExisting: ne0, cashOrInkind: '현금', subRole: '', monthlySalaryOverride: null };
    }
    renderAll();
    scheduleSave();
  }

  function removePersonFromProject(personId) {
    state.personIds = state.personIds.filter(function (id) { return id !== personId; });
    // v5: personRoles는 일부러 삭제하지 않음 — 다시 추가 시 분류 보존.
    // 영구 삭제가 필요하면 별도 작업 (현재 운영 빈도 낮음).
    renderAll();
    scheduleSave();
  }

  function bindModalEvents() {
    // 닫기
    var closeBtn  = document.getElementById('pl-modal-close');
    var cancelBtn = document.getElementById('pl-modal-cancel');
    if (closeBtn)  closeBtn.addEventListener('click',  closeAddModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddModal);

    // 오버레이 클릭으로 닫기
    var overlay = document.getElementById('pl-add-modal');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeAddModal();
      });
    }

    // ESC 키
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAddModal();
    });

    // 검색 입력
    var searchInput = document.getElementById('pl-modal-search');
    var clearBtn    = document.getElementById('pl-modal-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var kw = this.value.trim();
        if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';
        renderModalList(kw);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        this.style.display = 'none';
        renderModalList('');
      });
    }

    // v5.2: 퇴사자 포함 토글
    var includeExitedEl = document.getElementById('pl-modal-include-exited');
    if (includeExitedEl) {
      includeExitedEl.addEventListener('change', function () {
        var kw = searchInput ? searchInput.value.trim() : '';
        renderModalList(kw);
      });
    }

    // v5.2: 일괄 추가 / 선택 해제 버튼
    var bulkAddBtn   = document.getElementById('pl-modal-bulk-add');
    var bulkClearBtn = document.getElementById('pl-modal-bulk-clear');
    if (bulkAddBtn)   bulkAddBtn.addEventListener('click', bulkAddSelectedPersons);
    if (bulkClearBtn) bulkClearBtn.addEventListener('click', clearBulkSelection);

    // v5.2: "이미 추가된 인력" 섹션 토글
    var addedToggle = document.getElementById('pl-modal-added-toggle');
    var addedList   = document.getElementById('pl-modal-added-list');
    if (addedToggle && addedList) {
      addedToggle.addEventListener('click', function () {
        var expanded = addedToggle.classList.toggle('is-expanded');
        addedToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        addedList.hidden = !expanded;
      });
    }
  }

  // ====================================================================
  // 초기화
  // ====================================================================
  function init() {
    var now = new Date();
    state.year    = now.getFullYear();
    state.quarter = Math.ceil((now.getMonth() + 1) / 3);

    var yearInput = document.getElementById('pl-year-input');
    if (yearInput) yearInput.value = state.year;
    updateQuarterLabel();

    // 회사 칩 초기 상태 동기화 (localStorage 복원값)
    var companyChips = document.getElementById('pl-company-chips');
    if (companyChips) {
      companyChips.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === state.company);
      });
    }

    // v5 Step 2: 뷰모드 토글 / 분기 네비 가시성 초기 동기화
    renderViewModeToggle();
    renderQuarterNavVisibility();

    loadPersons();
    loadProjects();
    bindEvents();
    bindModalEvents();
    bindSnapshotEvents();   // v7.4.4 §4.2: 예상 계획 스냅샷
    bindKeyboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

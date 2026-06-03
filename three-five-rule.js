/* ============================================================
   three-five-rule.js — 3책5공 관리 공유 헬퍼 (기획서 §4.8 C2)
   ------------------------------------------------------------
   국가연구개발혁신법 시행령 §64.
   운영 모델: 책 ≤ 3, 책 + 공 ≤ 5 (책/공 별개 버킷, 한 과제는 한쪽만 +1).
   참여율(%) 아님 — 과제 "수".

   - 범위: 내부 과제만 카운트(이 시스템에 등록된 과제 전제). 외부 무시.
   - 대상: is3ch5gManaged === true  AND  현재 수행 중(status에 '수행' 포함).
   - 책 = 그 사람이 책임자(managerPersonId) AND (단독 || 컨소-주관).  ≤ 3
   - 공 = 그 외 참여(일반 참여자 + 컨소-참여의 책임자).
   - 책임자는 지정 + 수행중이면 명단(roster) 여부 무관 인정.

   순수 모듈 — Firestore/DOM 접근 없음. 각 페이지가 데이터를 주입한다.
   셀/키 변경 0 → funding·결산·labor-dashboard 무영향.
   ============================================================ */
(function (global) {
  'use strict';

  var CHAEK_LIMIT = 3;   // 책 한도
  var TOTAL_LIMIT = 5;   // 책 + 공 한도

  // 과제가 지금 3책5공 카운트 대상인지 (관리 켜짐 + 수행 중)
  function isManagedActive(proj) {
    if (!proj || !proj.is3ch5gManaged) return false;
    var s = String(proj.status || '');
    // '수행' / '수행중' / '진행' 등 수행 상태. 종료/완료/미선정/예정/미제출 제외.
    return s.indexOf('수행') >= 0 || s.indexOf('진행') >= 0;
  }

  // 한 과제에서 한 사람의 버킷: 'chaek' | 'gong' | null(해당 과제에서 카운트 안 됨)
  //  proj          : 과제 객체 (is3ch5gManaged / managerPersonId / participationType / consortiumRole)
  //  personId      : 대상 인력 id
  //  rosterIds     : 그 과제의 인건비 명단 personId 배열 (없으면 [])
  function bucketForPerson(proj, personId, rosterIds) {
    if (!isManagedActive(proj) || !personId) return null;
    var isManager = !!(proj.managerPersonId && proj.managerPersonId === personId);
    var inRoster  = Array.isArray(rosterIds) && rosterIds.indexOf(personId) >= 0;
    // 책임자는 명단 여부 무관 인정 / 일반 참여자는 명단에 있어야 인정
    if (!isManager && !inRoster) return null;

    if (isManager) {
      var pt = proj.participationType || '단독';
      var cr = proj.consortiumRole || '';
      // 책 = 책임자 AND (단독 || 컨소-주관)
      if (pt === '단독' || (pt === '컨소' && cr === '주관')) return 'chaek';
      // 컨소-참여의 책임자 → 공
      return 'gong';
    }
    // 일반 참여자 → 공
    return 'gong';
  }

  // 한 사람의 책/공을 모든 과제에서 합산.
  //  personId   : 대상 인력 id
  //  projects   : 전체 과제 배열
  //  getRoster  : function(proj) → 그 과제 명단 personId 배열. 생략 시 proj.personIds 사용.
  function countForPerson(personId, projects, getRoster) {
    var chaek = 0, gong = 0, detail = [];
    if (!personId || !Array.isArray(projects)) {
      return { chaek: 0, gong: 0, total: 0, detail: [] };
    }
    projects.forEach(function (p) {
      var roster = getRoster ? getRoster(p) : (p.personIds || []);
      var b = bucketForPerson(p, personId, roster);
      if (b === 'chaek') { chaek++; detail.push({ projectId: p.id || p.docId, bucket: 'chaek', proj: p }); }
      else if (b === 'gong') { gong++; detail.push({ projectId: p.id || p.docId, bucket: 'gong', proj: p }); }
    });
    return { chaek: chaek, gong: gong, total: chaek + gong, detail: detail };
  }

  // 한도 초과 여부 (soft 경고용) — 책 > 3 또는 책+공 > 5
  function isOverLimit(chaek, gong) {
    return (chaek > CHAEK_LIMIT) || ((chaek + gong) > TOTAL_LIMIT);
  }

  // 표시 형식 "책/공" — 예 "1/3" (왼쪽 책, 오른쪽 공)
  function format(chaek, gong) {
    return (chaek || 0) + '/' + (gong || 0);
  }

  global.ThreeFiveRule = {
    CHAEK_LIMIT: CHAEK_LIMIT,
    TOTAL_LIMIT: TOTAL_LIMIT,
    isManagedActive: isManagedActive,
    bucketForPerson: bucketForPerson,
    countForPerson: countForPerson,
    isOverLimit: isOverLimit,
    format: format
  };
})(typeof window !== 'undefined' ? window : this);

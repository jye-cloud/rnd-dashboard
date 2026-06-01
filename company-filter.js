/**
 * company-filter.js
 * 페이지 전반에서 공유되는 "회사 필터" 상태 + 회사 칩 UI 헬퍼.
 *
 * 사용법:
 *   <div id="some-id" class="company-chips"></div>
 *   CompanyFilter.mountChips('some-id', function (company) {
 *     // company === '' 이면 전체, 그 외엔 '식스티' | '굿뉴스' | '패리티'
 *     applyFilterAndRender();
 *   });
 *
 *   CompanyFilter.get();    // 현재 선택된 회사
 *   CompanyFilter.set('식스티');
 *
 * localStorage 키 'rnd-company-filter' 에 저장.
 * 이미 project-budget.js / project-labor.js / labor-dashboard.js 가 같은 키를 사용 중이라 자연스럽게 공유됨.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'rnd-company-filter';
  var COMPANIES = ['식스티', '굿뉴스', '패리티'];

  function load() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === '식스티' || v === '굿뉴스' || v === '패리티') return v;
      return '';
    } catch (e) {
      return '';
    }
  }

  function save(company) {
    try {
      if (!company) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, company);
      }
    } catch (e) {}
  }

  // 변경 알림 리스너 (같은 탭 내에서 동기화하고 싶을 때)
  var _listeners = [];

  function get() {
    return load();
  }

  function set(company) {
    company = company || '';
    save(company);
    _listeners.forEach(function (fn) {
      try { fn(company); } catch (e) {}
    });
  }

  function subscribe(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
  }

  /**
   * 회사 칩 UI를 생성해서 지정한 mount element에 채워 넣음.
   * 이미 칩이 들어있는 경우(예: project-budget.html처럼 HTML에 직접 작성됨)에는 호출하지 않고
   * bindChips만 호출해도 됨.
   *
   * @param {string|HTMLElement} mount  - id 문자열 또는 element
   * @param {function(string)}   onChange - 회사가 바뀌었을 때 호출. 인자는 '' | '식스티' | '굿뉴스' | '패리티'
   */
  function renderChips(mount) {
    var el = (typeof mount === 'string') ? document.getElementById(mount) : mount;
    if (!el) return null;
    var current = get();
    var html = '';
    html += '<button type="button" class="company-chip' + (current === '' ? ' is-active' : '') + '" data-company="">전체</button>';
    COMPANIES.forEach(function (c) {
      html += '<button type="button" class="company-chip' + (current === c ? ' is-active' : '') + '" data-company="' + c + '">' + c + '</button>';
    });
    el.innerHTML = html;
    el.classList.add('company-chips');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '회사 필터');
    return el;
  }

  /**
   * 칩들의 클릭 이벤트를 바인딩.
   * @param {HTMLElement} containerEl
   * @param {function(string)} onChange
   */
  function bindChips(containerEl, onChange) {
    if (!containerEl) return;
    containerEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.company-chip');
      if (!btn) return;
      var c = btn.dataset.company || '';
      if (c === get()) return;
      set(c);
      // 활성 칩 갱신
      containerEl.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === c);
      });
      if (typeof onChange === 'function') onChange(c);
    });

    // 다른 페이지/스크립트에서 set() 호출 시 칩 UI 동기화
    subscribe(function (newCompany) {
      containerEl.querySelectorAll('.company-chip').forEach(function (b) {
        b.classList.toggle('is-active', (b.dataset.company || '') === newCompany);
      });
    });
  }

  /**
   * mount + bind를 한 번에. 가장 많이 쓰는 케이스.
   */
  function mountChips(mount, onChange) {
    var el = renderChips(mount);
    if (el) bindChips(el, onChange);
    return el;
  }

  // 외부 공개
  window.CompanyFilter = {
    get: get,
    set: set,
    subscribe: subscribe,
    renderChips: renderChips,
    bindChips: bindChips,
    mountChips: mountChips,
    COMPANIES: COMPANIES.slice()
  };

})();

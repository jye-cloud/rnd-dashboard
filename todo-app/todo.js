(function () {
  'use strict';

  const STORAGE_KEY = 'todo-app-items';

  const inputEl = document.getElementById('todo-input');
  const addBtn = document.getElementById('add-btn');
  const pendingListEl = document.getElementById('pending-list');
  const doneListEl = document.getElementById('done-list');
  const countEl = document.getElementById('count-text');

  let items = loadItems();

  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateCount();
  }

  function updateCount() {
    const pending = items.filter(function (i) { return !i.done; }).length;
    const done = items.filter(function (i) { return i.done; }).length;
    countEl.textContent = '예정 ' + pending + '개 · 완료 ' + done + '개';
  }

  function addItem(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      text: trimmed,
      done: false
    };
    items.push(item);
    saveItems();
    renderItem(item, pendingListEl);
    inputEl.value = '';
    inputEl.focus();
  }

  function toggleDone(id) {
    const item = items.find(function (i) { return i.id === id; });
    if (!item) return;
    item.done = !item.done;
    saveItems();
    const li = document.querySelector('[data-id="' + id + '"]');
    if (li) li.remove();
    const targetList = item.done ? doneListEl : pendingListEl;
    renderItem(item, targetList);
  }

  function removeItem(id) {
    items = items.filter(function (i) { return i.id !== id; });
    saveItems();
    const li = document.querySelector('[data-id="' + id + '"]');
    if (li) li.remove();
  }

  function renderItem(item, listEl) {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' done' : '');
    li.setAttribute('data-id', item.id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', function () {
      toggleDone(item.id);
    });

    const span = document.createElement('span');
    span.className = 'text';
    span.textContent = item.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', function () {
      removeItem(item.id);
    });

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(deleteBtn);
    listEl.appendChild(li);
  }

  function renderAll() {
    pendingListEl.innerHTML = '';
    doneListEl.innerHTML = '';
    items.forEach(function (item) {
      const listEl = item.done ? doneListEl : pendingListEl;
      renderItem(item, listEl);
    });
    updateCount();
  }

  addBtn.addEventListener('click', function () {
    addItem(inputEl.value);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      addItem(inputEl.value);
    }
  });

  renderAll();
})();

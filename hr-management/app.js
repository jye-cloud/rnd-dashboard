(function () {
  'use strict';

  // 구글 스프레드시트 연동을 위한 데이터 구조
  // 각 인력 정보는 객체로 저장되며, 스프레드시트의 행(row)에 대응됩니다
  const STORAGE_KEY = 'hr-management-data';
  
  // DOM 요소
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const addBtn = document.getElementById('add-btn');
  const tableBody = document.getElementById('table-body');
  const modal = document.getElementById('modal');
  const closeModalBtn = document.getElementById('close-modal');
  const cancelBtn = document.getElementById('cancel-btn');
  const hrForm = document.getElementById('hr-form');
  const modalTitle = document.getElementById('modal-title');
  const totalCountEl = document.getElementById('total-count');
  const activeCountEl = document.getElementById('active-count');
  const birthY = document.getElementById('birthdate-y');
  const birthM = document.getElementById('birthdate-m');
  const birthD = document.getElementById('birthdate-d');
  const acqY = document.getElementById('acquisition-y');
  const acqM = document.getElementById('acquisition-m');
  const acqD = document.getElementById('acquisition-d');
  const lossY = document.getElementById('loss-y');
  const lossM = document.getElementById('loss-m');
  const lossD = document.getElementById('loss-d');

  // 데이터 저장소
  let hrData = loadData();
  let editingId = null;
  let filteredData = [...hrData];

  // 데이터 로드 (로컬스토리지 또는 구글 스프레드시트에서)
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('데이터 로드 실패:', e);
      return [];
    }
  }

  // 데이터 저장 (로컬스토리지 또는 구글 스프레드시트로)
  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hrData));
      // TODO: 구글 스프레드시트 연동 시 여기에 API 호출 추가
      // await syncToGoogleSheets(hrData);
      updateStats();
    } catch (e) {
      console.error('데이터 저장 실패:', e);
    }
  }

  // 구글 스프레드시트 연동을 위한 데이터 구조 변환
  // 스프레드시트의 행 배열로 변환 (헤더 제외)
  function convertToSheetRows(data) {
    return data.map(item => [
      item.no,
      item.division,
      item.name,
      item.department,
      item.birthdate,
      item.ssn,
      item.gender,
      item.acquisitionDate,
      item.lossDate || '',
      item.age
    ]);
  }

  // 스프레드시트 행 배열을 객체 배열로 변환
  function convertFromSheetRows(rows) {
    return rows.map((row, index) => ({
      id: `hr-${Date.now()}-${index}`,
      no: index + 1,
      division: row[1] || '',
      name: row[2] || '',
      department: row[3] || '',
      birthdate: row[4] || '',
      ssn: row[5] || '',
      gender: row[6] || '',
      acquisitionDate: row[7] || '',
      lossDate: row[8] || '',
      age: calculateAge(row[4])
    }));
  }

  // 생년월일로부터 만나이 계산
  function calculateAge(birthdate) {
    if (!birthdate) return '';
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  // 주민등록번호 포맷팅
  function formatSSN(ssn) {
    if (!ssn) return '';
    const cleaned = ssn.replace(/[^0-9]/g, '');
    if (cleaned.length === 13) {
      return cleaned.substring(0, 6) + '-' + cleaned.substring(6);
    }
    return ssn;
  }

  function getGenderFromSSN(ssn) {
    if (!ssn) return '';
    const cleaned = ssn.replace(/[^0-9]/g, '');
    if (cleaned.length < 7) return '';
    const code = cleaned.charAt(6);
    if (code === '1' || code === '3' || code === '5') return '남';
    if (code === '2' || code === '4' || code === '6') return '여';
    return '';
  }

  // 날짜 포맷팅 (YYYY-MM-DD -> YYYY.MM.DD)
  function formatDate(dateString) {
    if (!dateString) return '';
    return dateString.replace(/-/g, '.');
  }

  function pad2(v) {
    return String(v || '').padStart(2, '0');
  }

  function buildDateString(y, m, d) {
    const yy = String(y || '').trim();
    const mm = String(m || '').trim();
    const dd = String(d || '').trim();

    if (!yy && !mm && !dd) return null;
    if (yy.length !== 4 || mm.length !== 2 || dd.length !== 2) return null;

    const iso = `${yy}-${mm}-${dd}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;

    // new Date가 2025-02-31 같은 값을 보정할 수 있어, 원문과 일치하는지 확인
    const actual = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    if (actual !== iso) return null;

    return iso;
  }

  function setDateParts(prefix, isoDate) {
    const yEl = document.getElementById(`${prefix}-y`);
    const mEl = document.getElementById(`${prefix}-m`);
    const dEl = document.getElementById(`${prefix}-d`);
    if (!yEl || !mEl || !dEl) return;

    if (!isoDate) {
      yEl.value = '';
      mEl.value = '';
      dEl.value = '';
      return;
    }

    const [y, m, d] = String(isoDate).split('-');
    yEl.value = y || '';
    mEl.value = m || '';
    dEl.value = d || '';
  }

  function attachNumericAutoMove(inputs) {
    inputs.forEach((el, idx) => {
      if (!el) return;

      el.addEventListener('input', () => {
        const max = Number(el.getAttribute('maxlength') || '0');
        const digitsOnly = el.value.replace(/[^0-9]/g, '');
        el.value = max ? digitsOnly.slice(0, max) : digitsOnly;

        if (max && el.value.length === max) {
          const next = inputs[idx + 1];
          if (next) next.focus();
        }
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && el.value.length === 0) {
          const prev = inputs[idx - 1];
          if (prev) prev.focus();
        }
      });
    });
  }

  // 통계 업데이트
  function updateStats() {
    const total = hrData.length;
    const active = hrData.filter(item => !item.lossDate).length;
    totalCountEl.textContent = total;
    activeCountEl.textContent = active;
  }

  // 테이블 렌더링
  function renderTable(data = filteredData) {
    tableBody.innerHTML = '';
    
    if (data.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="13" class="empty-state">
          <p>등록된 인력 정보가 없습니다.</p>
        </td>
      `;
      tableBody.appendChild(tr);
      return;
    }

    data.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.no}</td>
        <td>${item.division}</td>
        <td>${item.lossDate ? '퇴직' : '재직'}</td>
        <td>${item.name}</td>
        <td>${item.department}</td>
        <td>${formatDate(item.birthdate)}</td>
        <td>${formatSSN(item.ssn)}</td>
        <td>${item.gender}</td>
        <td>${formatDate(item.acquisitionDate)}</td>
        <td>${item.lossDate ? formatDate(item.lossDate) : '-'}</td>
        <td>${item.age}세</td>
        <td>${item.remark ? item.remark : '-'}</td>
        <td>
          <div class="action-buttons">
            <button class="btn-edit" data-id="${item.id}">수정</button>
            <button class="btn-delete" data-id="${item.id}">삭제</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    // 이벤트 리스너 추가
    tableBody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        editItem(id);
      });
    });

    tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        deleteItem(id);
      });
    });
  }

  // 검색 기능
  function search() {
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
      filteredData = [...hrData];
    } else {
      filteredData = hrData.filter(item => 
        item.name.toLowerCase().includes(query) ||
        item.department.toLowerCase().includes(query) ||
        item.division.toLowerCase().includes(query)
      );
    }

    // 검색 결과에 대해 번호 재정렬
    filteredData.forEach((item, index) => {
      item.no = index + 1;
    });

    renderTable();
  }

  // 모달 열기
  function openModal(isEdit = false) {
    modal.classList.add('active');
    if (isEdit) {
      modalTitle.textContent = '인력 정보 수정';
    } else {
      modalTitle.textContent = '신규 인력 등록';
      hrForm.reset();
      setDateParts('birthdate', null);
      setDateParts('acquisition', null);
      setDateParts('loss', null);
      editingId = null;
    }
  }

  // 모달 닫기
  function closeModal() {
    modal.classList.remove('active');
    hrForm.reset();
    setDateParts('birthdate', null);
    setDateParts('acquisition', null);
    setDateParts('loss', null);
    editingId = null;
  }

  // 신규 인력 추가
  function addItem(formData) {
    const newItem = {
      id: `hr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      no: hrData.length + 1,
      division: formData.division,
      name: formData.name,
      department: formData.department,
      birthdate: formData.birthdate,
      ssn: formatSSN(formData.ssn),
      gender: getGenderFromSSN(formData.ssn),
      acquisitionDate: formData.acquisitionDate,
      lossDate: formData.lossDate || null,
      age: calculateAge(formData.birthdate)
    };

    hrData.push(newItem);
    saveData();
    search(); // 검색 결과도 업데이트
    closeModal();
  }

  // 인력 정보 수정
  function editItem(id) {
    const item = hrData.find(i => i.id === id);
    if (!item) return;

    editingId = id;
    document.getElementById('division').value = item.division;
    document.getElementById('name').value = item.name;
    document.getElementById('department').value = item.department;
    setDateParts('birthdate', item.birthdate);
    document.getElementById('ssn').value = item.ssn.replace(/-/g, '');
    document.getElementById('gender').value = item.gender || getGenderFromSSN(item.ssn);
    setDateParts('acquisition', item.acquisitionDate);
    setDateParts('loss', item.lossDate || null);
    
    openModal(true);
  }

  // 인력 정보 업데이트
  function updateItem(id, formData) {
    const item = hrData.find(i => i.id === id);
    if (!item) return;

    item.division = formData.division;
    item.name = formData.name;
    item.department = formData.department;
    item.birthdate = formData.birthdate;
    item.ssn = formatSSN(formData.ssn);
    item.gender = getGenderFromSSN(formData.ssn);
    item.acquisitionDate = formData.acquisitionDate;
    item.lossDate = formData.lossDate || null;
    item.age = calculateAge(formData.birthdate);

    saveData();
    search(); // 검색 결과도 업데이트
    closeModal();
  }

  // 인력 정보 삭제
  function deleteItem(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    hrData = hrData.filter(item => item.id !== id);
    
    // 번호 재정렬
    hrData.forEach((item, index) => {
      item.no = index + 1;
    });

    saveData();
    search(); // 검색 결과도 업데이트
  }

  // 폼 제출 처리
  hrForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const birthdate = buildDateString(birthY.value, birthM.value, birthD.value);
    const acquisitionDate = buildDateString(acqY.value, acqM.value, acqD.value);
    const lossDate = buildDateString(lossY.value, lossM.value, lossD.value);

    if (!birthdate) {
      alert('생년월일을 YYYY-MM-DD 형식으로 정확히 입력해 주세요.');
      birthY.focus();
      return;
    }

    if (!acquisitionDate) {
      alert('취득일을 YYYY-MM-DD 형식으로 정확히 입력해 주세요.');
      acqY.focus();
      return;
    }

    const formData = {
      division: document.getElementById('division').value,
      name: document.getElementById('name').value.trim(),
      department: document.getElementById('department').value.trim(),
      birthdate,
      ssn: document.getElementById('ssn').value,
      acquisitionDate,
      lossDate
    };

    if (editingId) {
      updateItem(editingId, formData);
    } else {
      addItem(formData);
    }
  });

  // 주민등록번호 자동 포맷팅
  document.getElementById('ssn').addEventListener('input', (e) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length > 6) {
      value = value.substring(0, 6) + '-' + value.substring(6, 13);
    }
    e.target.value = value;
    document.getElementById('gender').value = getGenderFromSSN(value);
  });

  // 날짜 입력: 숫자만 + 4자리/2자리/2자리 자동 포커스 이동
  attachNumericAutoMove([birthY, birthM, birthD]);
  attachNumericAutoMove([acqY, acqM, acqD]);
  attachNumericAutoMove([lossY, lossM, lossD]);

  // 이벤트 리스너
  searchBtn.addEventListener('click', search);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      search();
    }
  });

  addBtn.addEventListener('click', () => openModal(false));
  closeModalBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // 모달 외부 클릭 시 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // 초기 렌더링
  renderTable();
  updateStats();

  // 구글 스프레드시트 연동을 위한 전역 함수 (나중에 사용)
  window.syncFromGoogleSheets = async function(rows) {
    hrData = convertFromSheetRows(rows);
    saveData();
    search();
    renderTable();
  };

  window.syncToGoogleSheets = function() {
    return convertToSheetRows(hrData);
  };

  // 샘플 데이터 추가 (테스트용 - 실제 사용 시 제거)
  if (hrData.length === 0) {
    const sampleData = [
      {
        id: 'hr-sample-1',
        no: 1,
        division: '식스티',
        name: '홍길동',
        department: 'CI',
        birthdate: '1990-05-15',
        ssn: '900515-1234567',
        gender: '남',
        acquisitionDate: '2020-01-01',
        lossDate: null,
        age: calculateAge('1990-05-15')
      },
      {
        id: 'hr-sample-2',
        no: 2,
        division: '굿뉴스',
        name: '김영희',
        department: 'TVPP',
        birthdate: '1995-08-20',
        ssn: '950820-2345678',
        gender: '여',
        acquisitionDate: '2021-03-15',
        lossDate: null,
        age: calculateAge('1995-08-20')
      }
    ];
    hrData = sampleData;
    saveData();
    renderTable();
  }
})();

/**
 * 가챙이 대시보드 - 항목 추가 모달 컨트롤러
 */

function openAddModal(mode = 'normal') {
  const modal = document.getElementById('add-tx-modal');
  if (!modal) return;

  const titleEl = document.getElementById('modal-title');
  const dateGroup = document.getElementById('form-group-date');
  const dateInput = document.getElementById('add-date');

  // 드롭다운 채우기
  const catSel    = document.getElementById('add-cat');
  const methodSel = document.getElementById('add-method');
  
  if (catSel && methodSel) {
    catSel.innerHTML    = '';
    methodSel.innerHTML = '';
    SheetsAPI.getCategories().forEach(c => {
      catSel.innerHTML += `<option value="${c}">${c}</option>`;
    });
    SheetsAPI.getMethods().forEach(m => {
      methodSel.innerHTML += `<option value="${m}">${m}</option>`;
    });
  }

  // 양식 값 초기화
  document.getElementById('add-amount').value = '';
  document.getElementById('add-desc').value = '';

  if (mode === 'fixed') {
    titleEl.textContent = '📌 새 고정비 추가';
    dateGroup.style.display = 'none';
    dateInput.value = '-';
  } else {
    titleEl.textContent = '➕ 새 거래 항목 추가';
    dateGroup.style.display = 'block';
    
    // 오늘 날짜 기본 입력 (MM/DD)
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${mm}/${dd}`;
  }

  modal.style.display = 'flex';
}

function closeAddModal() {
  const modal = document.getElementById('add-tx-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function initAddForm(getCurrentMonth, onAdded) {
  // 금액 입력 시 천단위 콤마 자동 포맷팅 적용
  const amountInput = document.getElementById('add-amount');
  if (amountInput) {
    amountInput.addEventListener('input', formatInputWithCommas);
  }

  // 수입/지출 토글
  document.querySelectorAll('.type-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 모달 닫기 버튼
  const closeBtn = document.getElementById('modal-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAddModal);
  }

  // 모달 바깥쪽 클릭 시 닫기
  const modal = document.getElementById('add-tx-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAddModal();
      }
    });
  }

  const form = document.getElementById('add-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('add-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중...';

      try {
        const type   = document.querySelector('.type-toggle-btn.active')?.dataset.type || 'exp';
        const date   = document.getElementById('add-date').value.trim();
        const desc   = document.getElementById('add-desc').value.trim();
        const amount = parseInt(document.getElementById('add-amount').value.replace(/,/g, '')) || 0;
        const cat    = document.getElementById('add-cat').value;
        const method = document.getElementById('add-method').value;
        const month  = getCurrentMonth();

        if (!date || !desc || amount <= 0 || !month) {
          showToast('⚠️ 모든 필드를 입력해주세요.', 'warning');
          return;
        }

        if (date === '-') {
          // 고정비 모드인 경우 미래 월까지 일괄 전파 추가 API 호출
          await SheetsAPI.addFixedExpense(month, {
            desc,
            inc:  type === 'inc' ? amount : 0,
            exp:  type === 'exp' ? amount : 0,
            cat,
            method,
          });
        } else {
          // 일반 거래 모드인 경우 기존 단일 거래 추가 API 호출
          await SheetsAPI.addTransaction(month, {
            date,
            desc,
            inc:  type === 'inc' ? amount : 0,
            exp:  type === 'exp' ? amount : 0,
            cat,
            method,
          });
        }

        showToast(`✅ "${desc}" 항목이 추가되었습니다.`);
        form.reset();
        closeAddModal();

        // 고정비 모드인 경우 미래 월 캐시 무효화 (F5 없이 다른 탭 이동 시 변경 즉시 노출 목적)
        if (date === '-') {
          if (typeof _allMonthData !== 'undefined') {
            const months = GACHANGI_CONFIG.MONTH_NAMES;
            const startIndex = months.indexOf(month);
            if (startIndex !== -1) {
              months.slice(startIndex).forEach(m => {
                delete _allMonthData[m];
              });
            }
          }
        }

        if (onAdded) {
          await onAdded();
        }
      } catch (err) {
        showToast('❌ 추가 실패: ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '추가하기';
      }
    });
  }
}

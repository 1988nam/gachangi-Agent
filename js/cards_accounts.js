/**
 * 가챙이 대시보드 - 보유 카드 & 계좌(통장) 관리 UI 제어 스크립트
 */

// 글로벌 상태 객체
const CardsAccounts = (() => {
  let cardsData = [];
  let accountsData = [];

  // ─── 초기화 및 탭 렌더링 ─────────────────────────────────────────
  async function init() {
    bindEvents();
  }

  async function renderCardsAccountsTab() {
    showLoading(true);
    try {
      // 1. 구글 시트에서 카드 및 계좌 데이터 로드
      cardsData = await SheetsAPI.loadCards();
      accountsData = await SheetsAPI.loadAccounts();

      // 2. 보유 카드 렌더링
      renderCardsTable();

      // 3. 보유 계좌 렌더링
      renderAccountsTable();

    } catch (e) {
      console.error('[CardsAccounts] 데이터 로드 중 오류:', e);
      showToast('❌ 카드/계좌 데이터를 불러오지 못했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  // ─── 보유 카드 테이블 렌더링 ─────────────────────────────────────
  function renderCardsTable() {
    const tbody = document.getElementById('card-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (cardsData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--text-muted); padding: 24px 0;">등록된 카드가 없습니다.</td></tr>';
      return;
    }

    cardsData.forEach(card => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color:var(--color-primary);">${escapeHtml(card.cardName)}</strong></td>
        <td>${escapeHtml(card.owner || '-')}</td>
        <td><span style="font-size: 13px; color: var(--text-muted);">${escapeHtml(card.purpose || '-')}</span></td>
        <td>
          <div>${escapeHtml(card.linkedBank || '-')}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(card.linkedAccount || '')}</div>
        </td>
        <td>
          <div class="row-actions">
            <button class="btn-action-edit btn-text" data-row="${card.rowIndex}">수정</button>
            <button class="btn-action-delete btn-text btn-danger" data-row="${card.rowIndex}">삭제</button>
          </div>
        </td>
      `;

      // 수정 버튼 이벤트 바인딩
      tr.querySelector('.btn-action-edit').addEventListener('click', () => {
        openCardModal(card);
      });

      // 삭제 버튼 이벤트 바인딩
      tr.querySelector('.btn-action-delete').addEventListener('click', () => {
        deleteCardItem(card);
      });

      tbody.appendChild(tr);
    });
  }

  // ─── 보유 계좌 테이블 렌더링 ─────────────────────────────────────
  function renderAccountsTable() {
    const tbody = document.getElementById('account-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (accountsData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--text-muted); padding: 24px 0;">등록된 계좌가 없습니다.</td></tr>';
      return;
    }

    accountsData.forEach(acc => {
      const tr = document.createElement('tr');
      
      // 구분별 태그 디자인
      let typeBadge = `<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-muted); font-size:12px;">${escapeHtml(acc.type)}</span>`;
      if (acc.type === '공동') {
        typeBadge = `<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--color-success); font-size:12px;">공동</span>`;
      } else if (acc.type === '개인') {
        typeBadge = `<span class="badge" style="background: rgba(59,130,246,0.15); color: var(--color-primary); font-size:12px;">개인</span>`;
      } else if (acc.type.includes('투자')) {
        typeBadge = `<span class="badge" style="background: rgba(245,158,11,0.15); color: var(--color-warning); font-size:12px;">${escapeHtml(acc.type)}</span>`;
      }

      tr.innerHTML = `
        <td>${typeBadge}</td>
        <td>
          <strong style="color: var(--text-normal);">${escapeHtml(acc.accountName)}</strong>
          <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(acc.purpose || '')}</div>
        </td>
        <td><span style="font-size:13px; color: var(--text-normal);">${escapeHtml(acc.accountNumber || '-')}</span></td>
        <td>${escapeHtml(acc.ownerName || '-')}</td>
        <td>
          <div class="row-actions">
            <button class="btn-action-edit btn-text" data-row="${acc.rowIndex}">수정</button>
            <button class="btn-action-delete btn-text btn-danger" data-row="${acc.rowIndex}">삭제</button>
          </div>
        </td>
      `;

      // 수정 버튼 이벤트 바인딩
      tr.querySelector('.btn-action-edit').addEventListener('click', () => {
        openAccountModal(acc);
      });

      // 삭제 버튼 이벤트 바인딩
      tr.querySelector('.btn-action-delete').addEventListener('click', () => {
        deleteAccountItem(acc);
      });

      tbody.appendChild(tr);
    });
  }

  // ─── 카드 모달 조작 ──────────────────────────────────────────────
  function openCardModal(card = null) {
    const modal = document.getElementById('card-modal');
    const title = document.getElementById('card-modal-title');
    const submitBtn = document.getElementById('card-submit-btn');

    const inputRowIndex = document.getElementById('card-row-index');
    const inputName = document.getElementById('card-name');
    const inputOwner = document.getElementById('card-owner');
    const inputPurpose = document.getElementById('card-purpose');
    const inputMinFee = document.getElementById('card-min-fee');
    const selectLinkedAccount = document.getElementById('card-linked-account-select');

    if (!modal) return;

    // 연결 계좌 드롭다운 동적 구성
    if (selectLinkedAccount) {
      selectLinkedAccount.innerHTML = '<option value="">(연결 계좌 없음)</option>';
      accountsData.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = `${acc.accountName}|${acc.accountNumber}`;
        opt.textContent = `[${acc.ownerName || '미지정'}] ${acc.accountName} (${acc.accountNumber || '계좌번호 없음'})`;
        selectLinkedAccount.appendChild(opt);
      });
    }

    if (card) {
      // 수정 모드
      title.textContent = '✏️ 카드 정보 수정';
      submitBtn.textContent = '저장하기';
      inputRowIndex.value = card.rowIndex;
      inputName.value = card.cardName || '';
      inputOwner.value = card.owner || '';
      inputPurpose.value = card.purpose || '';
      inputMinFee.value = card.minFee || '';

      if (selectLinkedAccount) {
        let matched = false;
        for (let i = 0; i < selectLinkedAccount.options.length; i++) {
          const opt = selectLinkedAccount.options[i];
          const [bank, accNum] = opt.value.split('|');
          if (accNum === card.linkedAccount) {
            selectLinkedAccount.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched && card.linkedAccount) {
          // 기존에 직접 입력했던 계좌 정보가 있을 경우 임시로 드롭다운에 추가하여 유실 방지
          const tempOpt = document.createElement('option');
          tempOpt.value = `${card.linkedBank || ''}|${card.linkedAccount}`;
          tempOpt.textContent = `(이전 기록) ${card.linkedBank || ''} (${card.linkedAccount})`;
          tempOpt.selected = true;
          selectLinkedAccount.appendChild(tempOpt);
        }
      }
    } else {
      // 추가 모드
      title.textContent = '➕ 새 카드 추가';
      submitBtn.textContent = '추가하기';
      inputRowIndex.value = '';
      inputName.value = '';
      inputOwner.value = '';
      inputPurpose.value = '';
      inputMinFee.value = '';
      if (selectLinkedAccount) {
        selectLinkedAccount.value = '';
      }
    }

    modal.style.display = 'flex';
  }

  function closeCardModal() {
    const modal = document.getElementById('card-modal');
    if (modal) modal.style.display = 'none';
  }

  async function handleCardFormSubmit(e) {
    e.preventDefault();

    const rowIndex = document.getElementById('card-row-index').value;
    const selectLinkedAccount = document.getElementById('card-linked-account-select');
    let linkedBank = '';
    let linkedAccount = '';
    if (selectLinkedAccount && selectLinkedAccount.value) {
      const parts = selectLinkedAccount.value.split('|');
      linkedBank = parts[0] || '';
      linkedAccount = parts[1] || '';
    }

    const cardData = {
      cardName: document.getElementById('card-name').value.trim(),
      owner: document.getElementById('card-owner').value.trim(),
      purpose: document.getElementById('card-purpose').value.trim(),
      minFee: document.getElementById('card-min-fee').value.trim(),
      linkedBank: linkedBank,
      linkedAccount: linkedAccount
    };

    if (!cardData.cardName) return;

    showLoading(true);
    try {
      if (rowIndex) {
        // 수정 호출
        await SheetsAPI.updateCard(parseInt(rowIndex, 10), cardData);
        showToast('✅ 카드 정보가 수정되었습니다.');
      } else {
        // 추가 호출
        await SheetsAPI.addCard(cardData);
        showToast('✅ 새 카드가 추가되었습니다.');
      }
      closeCardModal();
      await renderCardsAccountsTab();
    } catch (err) {
      console.error(err);
      showToast('❌ 카드 정보 저장에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  async function deleteCardItem(card) {
    const confirmDelete = confirm(`"${card.cardName}" 카드를 정말로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmDelete) return;

    showLoading(true);
    try {
      await SheetsAPI.deleteCard(card.rowIndex);
      showToast('🗑️ 카드가 성공적으로 삭제되었습니다.');
      await renderCardsAccountsTab();
    } catch (err) {
      console.error(err);
      showToast('❌ 카드 삭제에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  // ─── 계좌 모달 조작 ──────────────────────────────────────────────
  function openAccountModal(acc = null) {
    const modal = document.getElementById('account-modal');
    const title = document.getElementById('account-modal-title');
    const submitBtn = document.getElementById('account-submit-btn');

    const inputRowIndex = document.getElementById('account-row-index');
    const inputType = document.getElementById('account-type');
    const inputOwner = document.getElementById('account-owner');
    const inputName = document.getElementById('account-name');
    const inputPurpose = document.getElementById('account-purpose');
    const inputNumber = document.getElementById('account-number');
    const inputOwnerName = document.getElementById('account-owner-name');

    if (!modal) return;

    if (acc) {
      // 수정 모드
      title.textContent = '✏️ 보유 계좌 정보 수정';
      submitBtn.textContent = '저장하기';
      inputRowIndex.value = acc.rowIndex;
      inputType.value = acc.type || '공동';
      inputOwner.value = acc.owner || '';
      inputName.value = acc.accountName || '';
      inputPurpose.value = acc.purpose || '';
      inputNumber.value = acc.accountNumber || '';
      inputOwnerName.value = acc.ownerName || '';
    } else {
      // 추가 모드
      title.textContent = '➕ 새 보유 계좌 추가';
      submitBtn.textContent = '추가하기';
      inputRowIndex.value = '';
      inputType.value = '공동';
      inputOwner.value = '';
      inputName.value = '';
      inputPurpose.value = '';
      inputNumber.value = '';
      inputOwnerName.value = '';
    }

    modal.style.display = 'flex';
  }

  function closeAccountModal() {
    const modal = document.getElementById('account-modal');
    if (modal) modal.style.display = 'none';
  }

  async function handleAccountFormSubmit(e) {
    e.preventDefault();

    const rowIndex = document.getElementById('account-row-index').value;
    const accData = {
      type: document.getElementById('account-type').value,
      owner: document.getElementById('account-owner').value.trim(),
      accountName: document.getElementById('account-name').value.trim(),
      purpose: document.getElementById('account-purpose').value.trim(),
      accountNumber: document.getElementById('account-number').value.trim(),
      ownerName: document.getElementById('account-owner-name').value.trim()
    };

    if (!accData.accountName) return;

    showLoading(true);
    try {
      if (rowIndex) {
        // 수정 호출
        await SheetsAPI.updateAccount(parseInt(rowIndex, 10), accData);
        showToast('✅ 계좌 정보가 수정되었습니다.');
      } else {
        // 추가 호출
        await SheetsAPI.addAccount(accData);
        showToast('✅ 새 계좌가 추가되었습니다.');
      }
      closeAccountModal();
      await renderCardsAccountsTab();
    } catch (err) {
      console.error(err);
      showToast('❌ 계좌 정보 저장에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  async function deleteAccountItem(acc) {
    const confirmDelete = confirm(`"${acc.accountName}" 계좌를 정말로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmDelete) return;

    showLoading(true);
    try {
      await SheetsAPI.deleteAccount(acc.rowIndex);
      showToast('🗑️ 계좌가 성공적으로 삭제되었습니다.');
      await renderCardsAccountsTab();
    } catch (err) {
      console.error(err);
      showToast('❌ 계좌 삭제에 실패했습니다.', 'error');
    } finally {
      showLoading(false);
    }
  }

  // ─── 이벤트 바인딩 ───────────────────────────────────────────────
  function bindEvents() {
    // 1. 카드 추가 버튼 & 폼 submit & 닫기
    const btnAddCard = document.getElementById('btn-add-card');
    const cardForm = document.getElementById('card-form');
    const btnCloseCard = document.getElementById('card-modal-close-btn');

    if (btnAddCard) btnAddCard.addEventListener('click', () => openCardModal(null));
    if (cardForm) cardForm.addEventListener('submit', handleCardFormSubmit);
    if (btnCloseCard) btnCloseCard.addEventListener('click', closeCardModal);

    // 2. 계좌 추가 버튼 & 폼 submit & 닫기
    const btnAddAcc = document.getElementById('btn-add-account');
    const accForm = document.getElementById('account-form');
    const btnCloseAcc = document.getElementById('account-modal-close-btn');

    if (btnAddAcc) btnAddAcc.addEventListener('click', () => openAccountModal(null));
    if (accForm) accForm.addEventListener('submit', handleAccountFormSubmit);
    if (btnCloseAcc) btnCloseAcc.addEventListener('click', closeAccountModal);

    // 3. 모달 바깥 배경 클릭 시 모달 닫기
    window.addEventListener('click', (e) => {
      const cardModal = document.getElementById('card-modal');
      const accModal = document.getElementById('account-modal');
      if (e.target === cardModal) closeCardModal();
      if (e.target === accModal) closeAccountModal();
    });
  }

  // HTML escape 유틸리티 (XSS 방지)
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return {
    init,
    renderCardsAccountsTab
  };
})();

// DOM 로드 시 로직 실행
document.addEventListener('DOMContentLoaded', () => {
  CardsAccounts.init();
});

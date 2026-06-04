/**
 * 가챙이 대시보드 - 예산 설정 모듈 (localStorage 기반)
 */

const BudgetManager = (() => {
  const STORAGE_KEY = 'gachangi_budgets';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  function save(budgets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets));
  }

  function get(category) {
    return load()[category] || 0;
  }

  function set(category, amount) {
    const budgets = load();
    budgets[category] = amount;
    save(budgets);
  }

  function getAll() { return load(); }

  return { get, set, getAll, save };
})();

/** 예산 설정 탭 렌더링 */
function renderBudgetTab() {
  const categories = SheetsAPI.getCategories().filter(c =>
    !['수입', '투자/저축', '저축', '이체', '입금'].includes(c)
  );
  const budgets = BudgetManager.getAll();

  const container = document.getElementById('budget-list');
  container.innerHTML = '';

  categories.forEach(cat => {
    const amount = budgets[cat] || 0;
    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `
      <div class="budget-cat-name">
        <span class="cat-badge">${getCategoryEmoji(cat)}</span>
        <span>${cat}</span>
      </div>
      <div class="budget-input-wrap">
        <input
          type="text"
          class="budget-input"
          data-cat="${cat}"
          value="${amount ? amount.toLocaleString('ko-KR') : ''}"
          placeholder="월 예산 (원)"
        />
        <span class="budget-unit">원</span>
      </div>
    `;
    const inputEl = row.querySelector('.budget-input');
    inputEl.addEventListener('input', formatInputWithCommas);
    inputEl.addEventListener('input', updateBudgetTotal);
    container.appendChild(row);
  });

  // 초기 합계 계산
  updateBudgetTotal();

  function updateBudgetTotal() {
    let total = 0;
    document.querySelectorAll('.budget-input').forEach(input => {
      const amount = parseInt(input.value.replace(/,/g, '')) || 0;
      total += amount;
    });
    const totalEl = document.getElementById('budget-total-amount');
    if (totalEl) {
      totalEl.textContent = total.toLocaleString('ko-KR');
    }
  }

  document.getElementById('budget-save-btn').onclick = () => {
    document.querySelectorAll('.budget-input').forEach(input => {
      const cat = input.dataset.cat;
      const amount = parseInt(input.value.replace(/,/g, '')) || 0;
      BudgetManager.set(cat, amount);
    });
    showToast('✅ 예산이 저장되었습니다.');
    // 대시보드 프로그레스바 업데이트
    if (typeof _transactions !== 'undefined') {
      renderBudgetBars(_transactions);
    }
  };

  const migrateBtn = document.getElementById('migrate-categories-btn');
  if (migrateBtn) {
    migrateBtn.onclick = async () => {
      if (!confirm('구글 스프레드시트의 모든 월별 시트를 스캔하여 구 카테고리를 신 카테고리로 일괄 변환하시겠습니까?\n이 작업은 구글 시트의 내용을 직접 수정합니다.')) {
        return;
      }

      migrateBtn.disabled = true;
      const originalText = migrateBtn.textContent;
      migrateBtn.textContent = '🔄 스캔 및 변환 준비 중...';
      showLoading(true);

      try {
        const totalUpdated = await SheetsAPI.migrateHistoricalCategories((month, currentIdx, totalMonths) => {
          migrateBtn.textContent = `🔄 변환 중... ${month} (${currentIdx + 1}/${totalMonths})`;
        });

        showToast(`✅ 변환 완료! 총 ${totalUpdated}건의 거래 내역이 새 카테고리로 변환되었습니다.`);
        
        // 전체 캐시 비우고 현재 활성화된 월 리로드
        _allMonthData = {};
        await loadCurrentMonth();
      } catch (err) {
        console.error('[카테고리 변환 실패]', err);
        showToast('❌ 변환 실패: ' + err.message, 'error');
      } finally {
        migrateBtn.disabled = false;
        migrateBtn.textContent = originalText;
        showLoading(false);
      }
    };
  }
}

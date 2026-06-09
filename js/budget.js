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

  // 구글 시트 '예산설정'에서 최신 예산을 읽어와 localStorage 캐시 갱신(기기 간 동기화)
  async function syncFromSheet() {
    if (typeof SheetsAPI === 'undefined' || !SheetsAPI.loadBudgets) return load();
    try {
      const b = await SheetsAPI.loadBudgets();
      save(b);
      return b;
    } catch (e) {
      console.warn('[Budget] 시트 예산 로드 실패, 캐시 사용:', e);
      return load();
    }
  }
  // 예산 전체를 localStorage 캐시 + 구글 시트에 저장(영구·휘발 방지)
  async function saveAll(budgets) {
    save(budgets); // 캐시 즉시 반영
    if (typeof SheetsAPI !== 'undefined' && SheetsAPI.saveBudgets) {
      await SheetsAPI.saveBudgets(budgets); // 시트 영구 저장
    }
  }

  return { get, set, getAll, save, syncFromSheet, saveAll };
})();

/** 예산 설정 탭 렌더링 */
async function renderBudgetTab() {
  // 탭 진입 시 구글 시트에서 최신 예산을 불러와 반영(다른 기기 변경 동기화). 실패 시 캐시 사용.
  if (BudgetManager.syncFromSheet) { try { await BudgetManager.syncFromSheet(); } catch (_) {} }

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

  document.getElementById('budget-save-btn').onclick = async () => {
    // 기존 캐시값을 베이스로, 화면 입력값을 덮어써 전체 예산 구성(누락 카테고리 보존)
    const budgets = { ...BudgetManager.getAll() };
    document.querySelectorAll('.budget-input').forEach(input => {
      budgets[input.dataset.cat] = parseInt(input.value.replace(/,/g, '')) || 0;
    });

    const btn = document.getElementById('budget-save-btn');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '💾 시트에 저장 중...';
    try {
      await BudgetManager.saveAll(budgets); // localStorage + 구글 시트
      showToast('✅ 예산이 구글 시트에 저장되었습니다.');
      if (typeof _transactions !== 'undefined') renderBudgetBars(_transactions);
    } catch (e) {
      console.error('[Budget] 예산 저장 실패:', e);
      showToast('❌ 예산 저장 실패: ' + (e.message || e), 'error');
    } finally {
      btn.disabled = false; btn.textContent = orig;
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

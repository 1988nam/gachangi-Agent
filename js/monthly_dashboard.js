/**
 * 가챙이 대시보드 - 월별 현황 탭 (선택된 월 기준 상세 및 예산 대비 지출)
 */

let _monthlyPieChart = null;

async function renderMonthlyDashboardTab() {
  const monthName = _currentMonth;
  document.getElementById('page-title').textContent = `📅 ${monthName} 현황 및 지출 분석`;

  showLoading(true);
  try {
    const transactions = await SheetsAPI.loadMonthData(monthName);
    _allMonthData[monthName] = transactions; // 캐시 갱신

    const totalInc = transactions.reduce((s, t) => s + t.inc, 0);
    const totalExp = transactions.reduce((s, t) => s + (t.cat === '투자/저축' ? 0 : t.exp), 0);
    const balance  = totalInc - totalExp;

    // KPI 카드 업데이트
    document.getElementById('monthly-kpi-income').textContent  = formatWon(totalInc);
    document.getElementById('monthly-kpi-expense').textContent = formatWon(totalExp);
    document.getElementById('monthly-kpi-balance').textContent = formatWon(balance);
    document.getElementById('monthly-kpi-balance').style.color = balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

    // 지출 항목 필터링 및 집계 (투자/저축 포함)
    const expenses = transactions.filter(t => t.exp > 0);
    const catTotals = {};
    const catCounts = {};
    expenses.forEach(t => {
      if (t.cat) {
        catTotals[t.cat] = (catTotals[t.cat] || 0) + t.exp;
        catCounts[t.cat] = (catCounts[t.cat] || 0) + 1;
      }
    });

    // 도넛 차트 및 카테고리 순위 리스트 렌더링
    _renderMonthlyPieChart(catTotals);
    _renderMonthlyCatList(catTotals, catCounts, totalExp, expenses);
    
    // 예산 프로그레스 바 렌더링
    renderBudgetBars(transactions);

  } catch (err) {
    console.error('[월별 현황 로드 실패]', err);
    showToast('❌ 데이터를 불러오지 못했습니다: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/** 월별 카테고리별 도넛 차트 */
function _renderMonthlyPieChart(catTotals) {
  const labels  = Object.keys(catTotals);
  const data    = Object.values(catTotals);
  const colors  = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  const ctx = document.getElementById('monthly-pie-chart').getContext('2d');
  if (_monthlyPieChart) _monthlyPieChart.destroy();

  _monthlyPieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#e2e8f0',
            font: { family: "'Outfit', 'Noto Sans KR', sans-serif", size: 11 },
            padding: 10,
            usePointStyle: true,
            boxWidth: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${formatWon(ctx.raw)}`,
          },
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
        },
      },
    },
  });
}

/** 월별 카테고리 순위 리스트 */
function _renderMonthlyCatList(catTotals, catCounts, totalExp, allExpenses) {
  const container = document.getElementById('monthly-cat-list');
  container.innerHTML = '';

  const sortedCats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);

  if (sortedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>해당 월의 지출 내역이 없습니다.</p>
      </div>`;
    _renderMonthlyCatDetailsTable([], '전체');
    return;
  }

  const totalInList = Object.values(catTotals).reduce((s, v) => s + v, 0);

  sortedCats.forEach((cat, idx) => {
    const amount = catTotals[cat];
    const count = catCounts[cat];
    const pct = totalInList > 0 ? Math.min(100, Math.round((amount / totalInList) * 100)) : 0;
    const emoji = getCategoryEmoji(cat);
    const color = CHART_COLORS[idx % CHART_COLORS.length];

    const item = document.createElement('div');
    item.className = 'budget-bar-item';
    item.style.cursor = 'pointer';
    item.style.padding = '8px';
    item.style.borderRadius = '8px';
    item.style.transition = 'background 0.2s';

    item.addEventListener('mouseenter', () => item.style.backgroundColor = 'rgba(255,255,255,0.03)');
    item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');

    item.addEventListener('click', () => {
      const filtered = allExpenses.filter(t => t.cat === cat);
      _renderMonthlyCatDetailsTable(filtered, cat);
      document.getElementById('monthly-cat-details-title').scrollIntoView({ behavior: 'smooth' });
    });

    item.innerHTML = `
      <div class="budget-bar-header">
        <span class="budget-bar-label">${emoji} ${escapeHtml(cat)} <small style="color: var(--text-muted); font-size:11px; margin-left:4px;">(${count}건)</small></span>
        <span class="budget-bar-amounts" style="font-weight:600;">
          ${formatWon(amount)} <span style="color:${color}; font-size:11px; margin-left:4px;">${pct}%</span>
        </span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
      </div>
    `;
    container.appendChild(item);
  });

  // 첫 번째 카테고리 상세 표시
  const topCat = sortedCats[0];
  const filtered = allExpenses.filter(t => t.cat === topCat);
  _renderMonthlyCatDetailsTable(filtered, topCat);
}

/** 월별 카테고리별 상세 거래 내역 테이블 */
function _renderMonthlyCatDetailsTable(transactions, categoryName) {
  const title = document.getElementById('monthly-cat-details-title');
  title.textContent = `🔍 [${categoryName}] 상세 거래 내역 (${transactions.length}건)`;

  const tbody = document.getElementById('monthly-cat-details-table-body');
  tbody.innerHTML = '';

  // 테이블이 리렌더링될 때 체크박스 전체 선택 해제 및 일괄 처리 바 업데이트
  const checkAll = document.getElementById('monthly-check-all');
  if (checkAll) checkAll.checked = false;
  _updateMonthlyBatchBar();

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">지출 내역이 없습니다.</td></tr>`;
    return;
  }

  const sorted = [...transactions].sort((a, b) => b.rowIndex - a.rowIndex);

  sorted.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'needs-review' : '';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td><input type="checkbox" class="monthly-row-check" data-row="${tx.rowIndex}" style="cursor: pointer;"></td>
      <td><span class="date-badge">${escapeHtml(tx.date)}</span></td>
      <td class="desc-cell" title="${escapeHtml(tx.desc)}">${escapeHtml(tx.desc)}</td>
      <td class="${isSaving ? 'amount-cell save' : 'amount-cell exp'}">${isSaving ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>` + formatWon(tx.exp) : formatWon(tx.exp)}</td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${escapeHtml(tx.cat)}</span></td>
      <td><span class="method-chip">${escapeHtml(tx.method)}</span></td>
      <td>
        <button class="btn-monthly-edit btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-primary); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">수정</button>
        <button class="btn-monthly-delete btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border-radius: 4px; border: none; cursor: pointer;">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 개별 체크박스 변경 시 일괄 처리 바 업데이트
  tbody.querySelectorAll('.monthly-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      _updateMonthlyBatchBar();
    });
  });

  // 이벤트 바인딩 - 수정 버튼
  tbody.querySelectorAll('.btn-monthly-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = sorted.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      const tr = e.target.closest('tr');
      // 행을 입력 폼으로 변환 (체크박스 열 유지)
      tr.innerHTML = `
        <td><input type="checkbox" class="monthly-row-check" data-row="${tx.rowIndex}" disabled style="opacity: 0.5;"></td>
        <td><input type="text" class="edit-monthly-date" value="${escapeHtml(tx.date)}" style="width: 50px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: center;"></td>
        <td><input type="text" class="edit-monthly-desc" value="${escapeHtml(tx.desc)}" style="width: 90%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px;"></td>
        <td><input type="text" class="edit-monthly-exp" value="${tx.exp ? tx.exp.toLocaleString('ko-KR') : ''}" style="width: 70px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td>
          <select class="edit-monthly-cat" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getCategories().map(c => `<option value="${escapeHtml(c)}" ${c === tx.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="edit-monthly-method" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getMethods().map(m => `<option value="${escapeHtml(m)}" ${m === tx.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </td>
        <td>
          <button class="btn-save-monthly-edit" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">저장</button>
          <button class="btn-cancel-monthly-edit" style="padding: 2px 6px; font-size: 11px; background: var(--text-muted); color: white; border-radius: 4px; border: none; cursor: pointer;">취소</button>
        </td>
      `;

      // 인라인 편집 시 실시간 천단위 쉼표 포맷팅 바인딩
      tr.querySelector('.edit-monthly-exp').addEventListener('input', formatInputWithCommas);

      // 저장 버튼 이벤트
      tr.querySelector('.btn-save-monthly-edit').addEventListener('click', async () => {
        const date = tr.querySelector('.edit-monthly-date').value;
        const desc = tr.querySelector('.edit-monthly-desc').value;
        const exp = parseInt(tr.querySelector('.edit-monthly-exp').value.replace(/,/g, '')) || 0;
        const cat = tr.querySelector('.edit-monthly-cat').value;
        const method = tr.querySelector('.edit-monthly-method').value;

        showLoading(true);
        try {
          await SheetsAPI.updateRow(_currentMonth, rowIndex, { date, desc, inc: tx.inc || 0, exp, cat, method });
          showToast('✅ 수정 완료되었습니다.');
          
          // 캐시 지우고 새로고침
          delete _allMonthData[_currentMonth];
          await loadCurrentMonth();
        } catch (err) {
          console.error('[월별 현황 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 버튼 이벤트
      tr.querySelector('.btn-cancel-monthly-edit').addEventListener('click', () => {
        _renderMonthlyCatDetailsTable(transactions, categoryName);
      });
    });
  });

  // 이벤트 바인딩 - 삭제 버튼
  tbody.querySelectorAll('.btn-monthly-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = sorted.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      if (!confirm(`행 #${rowIndex} (${tx.desc} | 지출 ${formatWon(tx.exp)}) 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRow(_currentMonth, rowIndex);
        showToast('🗑️ 삭제가 완료되었습니다.');
        
        // 캐시 지우고 새로고침
        delete _allMonthData[_currentMonth];
        await loadCurrentMonth();
      } catch (err) {
        console.error('[월별 현황 삭제 실패]', err);
        showToast('❌ 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  });
}

/** 월별 예산 현황 프로그레스 바 */
function renderBudgetBars(transactions) {
  const budgets  = BudgetManager.getAll();
  const catTotals = {};
  transactions.forEach(t => {
    if (t.exp > 0 && t.cat) catTotals[t.cat] = (catTotals[t.cat] || 0) + t.exp;
  });

  const container = document.getElementById('monthly-budget-bars');
  container.innerHTML = '';

  const trackedCats = Object.keys(budgets).filter(c => budgets[c] > 0);
  if (trackedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>⚙️</span>
        <p>예산 설정 탭에서 카테고리별 예산을 설정해보세요.</p>
      </div>`;
    return;
  }

  trackedCats.forEach(cat => {
    const budget  = budgets[cat];
    const spent   = catTotals[cat] || 0;
    const pct     = Math.min(100, Math.round((spent / budget) * 100));
    const over    = spent > budget;
    const emoji   = getCategoryEmoji(cat);

    container.innerHTML += `
      <div class="budget-bar-item">
        <div class="budget-bar-header">
          <span class="budget-bar-label">${emoji} ${escapeHtml(cat)}</span>
          <span class="budget-bar-amounts ${over ? 'over' : ''}">
            ${formatWon(spent)} / ${formatWon(budget)}
            ${over ? `<span class="over-badge">+${formatWon(spent - budget)}</span>` : ''}
          </span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${over ? 'over' : ''}" style="width: ${pct}%"></div>
        </div>
        <div class="progress-pct ${over ? 'over' : ''}">${pct}%</div>
      </div>`;
  });
}

/** 월별 상세 거래 내역 일괄 처리 바 업데이트 */
function _updateMonthlyBatchBar() {
  const checkedCount = document.querySelectorAll('.monthly-row-check:checked').length;
  const bar = document.getElementById('monthly-batch-action-bar');
  const countSpan = document.getElementById('monthly-batch-count');
  const checkAll = document.getElementById('monthly-check-all');
  const totalCheckboxes = document.querySelectorAll('.monthly-row-check').length;
  
  if (checkedCount > 0) {
    if (bar) bar.style.display = 'flex';
    if (countSpan) countSpan.textContent = `${checkedCount}건 선택됨`;
  } else {
    if (bar) bar.style.display = 'none';
  }
  
  if (checkAll) {
    checkAll.checked = totalCheckboxes > 0 && checkedCount === totalCheckboxes;
  }
}

/** 월별 일괄 처리 이벤트 초기화 (최초 1회 실행) */
function initMonthlyDashboardEvents() {
  if (window._monthlyEventsBound) return;
  window._monthlyEventsBound = true;

  console.log('[가챙이] 월별 현황 일괄 처리 이벤트 바인딩');

  // 드롭다운 옵션 바인딩
  const catSelect = document.getElementById('monthly-batch-cat-select');
  const methodSelect = document.getElementById('monthly-batch-method-select');

  if (catSelect) {
    catSelect.innerHTML = '<option value="">분류 일괄 변경</option>';
    SheetsAPI.getCategories().forEach(c => {
      catSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
  }

  if (methodSelect) {
    methodSelect.innerHTML = '<option value="">수단 일괄 변경</option>';
    SheetsAPI.getMethods().forEach(m => {
      methodSelect.innerHTML += `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`;
    });
  }

  // 전체 선택 체크박스
  const checkAll = document.getElementById('monthly-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.monthly-row-check').forEach(cb => {
        cb.checked = checked;
      });
      _updateMonthlyBatchBar();
    });
  }

  // 일괄 삭제 버튼
  const deleteBtn = document.getElementById('monthly-batch-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const checkedBoxes = document.querySelectorAll('.monthly-row-check:checked');
      const rowIndexes = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.row));
      if (rowIndexes.length === 0) return;

      if (!confirm(`선택한 ${rowIndexes.length}건의 지출 항목을 정말 일괄 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행들을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRowsBatch(_currentMonth, rowIndexes);
        showToast(`🗑️ ${rowIndexes.length}건이 일괄 삭제되었습니다.`);
        delete _allMonthData[_currentMonth]; // 캐시 무효화
        await loadCurrentMonth();
      } catch (err) {
        console.error('[월별 현황 일괄 삭제 실패]', err);
        showToast('❌ 일괄 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  }

  // 분류 일괄 변경 드롭다운
  if (catSelect) {
    catSelect.addEventListener('change', async (e) => {
      const selectedCat = e.target.value;
      if (!selectedCat) return;

      const checkedBoxes = document.querySelectorAll('.monthly-row-check:checked');
      const rowIndexes = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.row));
      if (rowIndexes.length === 0) {
        e.target.value = '';
        return;
      }

      if (!confirm(`선택한 ${rowIndexes.length}건의 카테고리를 [${selectedCat}](으)로 일괄 변경하시겠습니까?`)) {
        e.target.value = '';
        return;
      }

      showLoading(true);
      try {
        const updates = rowIndexes.map(rowIndex => ({
          rowIndex,
          colIndex: SheetsAPI.getColIndices().cat,
          value: selectedCat
        }));
        await SheetsAPI.updateRowsBatch(_currentMonth, updates);
        showToast(`✅ ${rowIndexes.length}건의 카테고리가 일괄 변경되었습니다.`);
        delete _allMonthData[_currentMonth]; // 캐시 무효화
        await loadCurrentMonth();
      } catch (err) {
        console.error('[월별 현황 카테고리 일괄 변경 실패]', err);
        showToast('❌ 카테고리 일괄 변경 실패: ' + err.message, 'error');
      } finally {
        e.target.value = '';
        showLoading(false);
      }
    });
  }

  // 수단 일괄 변경 드롭다운
  if (methodSelect) {
    methodSelect.addEventListener('change', async (e) => {
      const selectedMethod = e.target.value;
      if (!selectedMethod) return;

      const checkedBoxes = document.querySelectorAll('.monthly-row-check:checked');
      const rowIndexes = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.row));
      if (rowIndexes.length === 0) {
        e.target.value = '';
        return;
      }

      if (!confirm(`선택한 ${rowIndexes.length}건의 결제수단을 [${selectedMethod}](으)로 일괄 변경하시겠습니까?`)) {
        e.target.value = '';
        return;
      }

      showLoading(true);
      try {
        const updates = rowIndexes.map(rowIndex => ({
          rowIndex,
          colIndex: SheetsAPI.getColIndices().method,
          value: selectedMethod
        }));
        await SheetsAPI.updateRowsBatch(_currentMonth, updates);
        showToast(`✅ ${rowIndexes.length}건의 결제수단이 일괄 변경되었습니다.`);
        delete _allMonthData[_currentMonth]; // 캐시 무효화
        await loadCurrentMonth();
      } catch (err) {
        console.error('[월별 현황 결제수단 일괄 변경 실패]', err);
        showToast('❌ 결제수단 일괄 변경 실패: ' + err.message, 'error');
      } finally {
        e.target.value = '';
        showLoading(false);
      }
    });
  }
}

/**
 * 가챙이 대시보드 - 누적 카테고리별 지출 분석 탭 (1월 ~ 현재 월 누적)
 */

let _catExpensesChart = null;

async function renderCategoryExpensesTab() {
  const now = new Date();
  const sysMonthNum = now.getMonth() + 1; // e.g. 6 (June)
  const sysMonth = `${sysMonthNum}월`;
  
  document.getElementById('cat-expenses-title').textContent = `📅 1월 ~ ${sysMonth} 누적 지출 분석`;
  
  // KPI 라벨 이름 변경 (누적 분석에 맞춤)
  document.querySelector('#tab-cat-expenses .kpi-card:nth-child(1) .kpi-label').textContent = '누적 총 지출';
  document.querySelector('#tab-cat-expenses .kpi-card:nth-child(3) .kpi-label').textContent = '월평균 지출';

  showLoading(true);
  try {
    // 1월부터 현재 월(sysMonth)까지 모든 데이터를 취합합니다
    const allTransactions = [];
    for (let i = 1; i <= sysMonthNum; i++) {
      const monthName = `${i}월`;
      let monthTxs = [];
      if (_allMonthData[monthName]) {
        monthTxs = _allMonthData[monthName].map(t => ({ ...t, month: monthName }));
      } else {
        try {
          const rawTxs = await SheetsAPI.loadMonthData(monthName);
          _allMonthData[monthName] = rawTxs;
          monthTxs = rawTxs.map(t => ({ ...t, month: monthName }));
        } catch (e) {
          console.warn(`[가챙이] ${monthName} 데이터 로딩 누락/실패:`, e);
          monthTxs = [];
        }
      }
      allTransactions.push(...monthTxs);
    }
    
    // 지출 항목만 필터링 (투자/저축 제외)
    const expenses = allTransactions.filter(t => t.exp > 0 && t.cat !== '투자/저축');
    const totalExp = expenses.reduce((s, t) => s + t.exp, 0);
    
    // 1. KPI: 누적 총 지출
    document.getElementById('cat-kpi-total-exp').textContent = formatWon(totalExp);
    
    // 카테고리별 집계
    const catTotals = {};
    const catCounts = {};
    expenses.forEach(t => {
      if (t.cat) {
        catTotals[t.cat] = (catTotals[t.cat] || 0) + t.exp;
        catCounts[t.cat] = (catCounts[t.cat] || 0) + 1;
      }
    });
    
    // 2. KPI: 최대 소비 분야
    let topCatName = '-';
    let topCatVal = 0;
    Object.keys(catTotals).forEach(cat => {
      if (catTotals[cat] > topCatVal) {
        topCatVal = catTotals[cat];
        topCatName = cat;
      }
    });
    const topCatEmoji = topCatName !== '-' ? getCategoryEmoji(topCatName) : '';
    document.getElementById('cat-kpi-top-cat').textContent = topCatName !== '-' ? `${topCatEmoji} ${topCatName}` : '-';
    
    // 3. KPI: 월평균 지출 (누적 총 지출 / 경과 개월수)
    const monthlyAvg = totalExp > 0 ? Math.round(totalExp / sysMonthNum) : 0;
    document.getElementById('cat-kpi-daily-avg').textContent = formatWon(monthlyAvg);
    
    // 차트 및 목록 렌더링
    _renderCatExpensesChart(catTotals);
    _renderCatExpensesList(catTotals, catCounts, totalExp, expenses);
    
  } catch (err) {
    console.error('[누적 카테고리 지출 분석 로드 실패]', err);
    showToast('❌ 데이터를 불러오지 못했습니다: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function _renderCatExpensesChart(catTotals) {
  const labels = Object.keys(catTotals);
  const data = Object.values(catTotals);
  const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  
  const ctx = document.getElementById('cat-expenses-chart').getContext('2d');
  if (_catExpensesChart) _catExpensesChart.destroy();
  
  _catExpensesChart = new Chart(ctx, {
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

function _renderCatExpensesList(catTotals, catCounts, totalExp, allExpenses) {
  const container = document.getElementById('cat-expenses-list');
  container.innerHTML = '';
  
  // 지출액 많은 순으로 정렬
  const sortedCats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
  
  if (sortedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>누적 지출 내역이 없습니다.</p>
      </div>`;
    _renderCatDetailsTable([], '전체');
    return;
  }
  
  sortedCats.forEach((cat, idx) => {
    const amount = catTotals[cat];
    const count = catCounts[cat];
    const pct = totalExp > 0 ? Math.min(100, Math.round((amount / totalExp) * 100)) : 0;
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
    
    // 클릭 시 해당 카테고리 상세 내역 필터링
    item.addEventListener('click', () => {
      const filtered = allExpenses.filter(t => t.cat === cat);
      _renderCatDetailsTable(filtered, cat);
      
      // 스크롤 이동
      document.getElementById('cat-details-title').scrollIntoView({ behavior: 'smooth' });
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
  
  // 기본적으로는 첫 번째 카테고리 상세 내역 표시
  const topCat = sortedCats[0];
  const filtered = allExpenses.filter(t => t.cat === topCat);
  _renderCatDetailsTable(filtered, topCat);
}

function _renderCatDetailsTable(transactions, categoryName) {
  const title = document.getElementById('cat-details-title');
  title.textContent = `🔍 [${categoryName}] 상세 거래 내역 (${transactions.length}건)`;
  
  const tbody = document.getElementById('cat-details-table-body');
  tbody.innerHTML = '';

  // 테이블이 리렌더링될 때 체크박스 전체 선택 해제 및 일괄 처리 바 업데이트
  const checkAll = document.getElementById('cat-check-all');
  if (checkAll) checkAll.checked = false;
  _updateCatBatchBar();
  
  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">지출 내역이 없습니다.</td></tr>`;
    return;
  }
  
  // 날짜 역순 정렬
  const sorted = [...transactions].sort((a, b) => b.rowIndex - a.rowIndex);
  
  sorted.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'needs-review' : '';
    tr.innerHTML = `
      <td><input type="checkbox" class="cat-row-check" data-row="${tx.rowIndex}" data-month="${escapeHtml(tx.month)}" style="cursor: pointer;"></td>
      <td><span class="date-badge">${escapeHtml(tx.date)}</span></td>
      <td class="desc-cell" title="${escapeHtml(tx.desc)}">${escapeHtml(tx.desc)}</td>
      <td class="amount-cell exp">${formatWon(tx.exp)}</td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${escapeHtml(tx.cat)}</span></td>
      <td><span class="method-chip">${escapeHtml(tx.method)}</span></td>
      <td>
        <button class="btn-cat-edit btn-text" data-row="${tx.rowIndex}" data-month="${escapeHtml(tx.month)}" style="padding: 2px 6px; font-size: 11px; background: var(--color-primary); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">수정</button>
        <button class="btn-cat-delete btn-text" data-row="${tx.rowIndex}" data-month="${escapeHtml(tx.month)}" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border-radius: 4px; border: none; cursor: pointer;">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 개별 체크박스 변경 시 일괄 처리 바 업데이트
  tbody.querySelectorAll('.cat-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      _updateCatBatchBar();
    });
  });

  // 이벤트 바인딩 - 수정 버튼
  tbody.querySelectorAll('.btn-cat-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month = e.target.dataset.month;
      const tx = sorted.find(t => t.rowIndex === rowIndex && t.month === month);
      if (!tx) return;

      const tr = e.target.closest('tr');
      // 행을 입력 폼으로 변환 (체크박스 열 유지)
      tr.innerHTML = `
        <td><input type="checkbox" class="cat-row-check" data-row="${tx.rowIndex}" data-month="${escapeHtml(tx.month)}" disabled style="opacity: 0.5;"></td>
        <td><input type="text" class="edit-cat-date" value="${escapeHtml(tx.date)}" style="width: 50px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: center;"></td>
        <td><input type="text" class="edit-cat-desc" value="${escapeHtml(tx.desc)}" style="width: 90%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px;"></td>
        <td><input type="text" class="edit-cat-exp" value="${tx.exp ? tx.exp.toLocaleString('ko-KR') : ''}" style="width: 70px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td>
          <select class="edit-cat-cat" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getCategories().map(c => `<option value="${escapeHtml(c)}" ${c === tx.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="edit-cat-method" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getMethods().map(m => `<option value="${escapeHtml(m)}" ${m === tx.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </td>
        <td>
          <button class="btn-save-cat-edit" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">저장</button>
          <button class="btn-cancel-cat-edit" style="padding: 2px 6px; font-size: 11px; background: var(--text-muted); color: white; border-radius: 4px; border: none; cursor: pointer;">취소</button>
        </td>
      `;

      // 인라인 편집 시 실시간 천단위 쉼표 포맷팅 바인딩
      tr.querySelector('.edit-cat-exp').addEventListener('input', formatInputWithCommas);

      // 저장 버튼 이벤트
      tr.querySelector('.btn-save-cat-edit').addEventListener('click', async () => {
        const date = tr.querySelector('.edit-cat-date').value;
        const desc = tr.querySelector('.edit-cat-desc').value;
        const exp = parseInt(tr.querySelector('.edit-cat-exp').value.replace(/,/g, '')) || 0;
        const cat = tr.querySelector('.edit-cat-cat').value;
        const method = tr.querySelector('.edit-cat-method').value;

        showLoading(true);
        try {
          await SheetsAPI.updateRow(month, rowIndex, { date, desc, inc: tx.inc || 0, exp, cat, method });
          showToast('✅ 수정 완료되었습니다.');
          
          // 캐시 무효화
          if (typeof _allMonthData !== 'undefined') {
            delete _allMonthData[month];
          }

          // 탭 데이터 리로드
          await renderCategoryExpensesTab();
        } catch (err) {
          console.error('[누적 분석 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 버튼 이벤트
      tr.querySelector('.btn-cancel-cat-edit').addEventListener('click', () => {
        _renderCatDetailsTable(transactions, categoryName);
      });
    });
  });

  // 이벤트 바인딩 - 삭제 버튼
  tbody.querySelectorAll('.btn-cat-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month = e.target.dataset.month;
      const tx = sorted.find(t => t.rowIndex === rowIndex && t.month === month);
      if (!tx) return;

      if (!confirm(`행 #${rowIndex} (${tx.desc} | 지출 ${formatWon(tx.exp)}) 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRow(month, rowIndex);
        showToast('🗑️ 삭제가 완료되었습니다.');
        
        // 캐시 무효화
        if (typeof _allMonthData !== 'undefined') {
          delete _allMonthData[month];
        }

        // 탭 데이터 리로드
        await renderCategoryExpensesTab();
      } catch (err) {
        console.error('[누적 분석 삭제 실패]', err);
        showToast('❌ 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  });
}

/** 누적 상세 거래 내역 일괄 처리 바 업데이트 */
function _updateCatBatchBar() {
  const checkedCount = document.querySelectorAll('.cat-row-check:checked').length;
  const bar = document.getElementById('cat-batch-action-bar');
  const countSpan = document.getElementById('cat-batch-count');
  const checkAll = document.getElementById('cat-check-all');
  const totalCheckboxes = document.querySelectorAll('.cat-row-check').length;
  
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

/** 누적 일괄 처리 이벤트 초기화 (최초 1회 실행) */
function initCatExpensesEvents() {
  if (window._catEventsBound) return;
  window._catEventsBound = true;

  console.log('[가챙이] 누적 지출 분석 일괄 처리 이벤트 바인딩');

  // 드롭다운 옵션 바인딩
  const catSelect = document.getElementById('cat-batch-cat-select');
  const methodSelect = document.getElementById('cat-batch-method-select');

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
  const checkAll = document.getElementById('cat-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.cat-row-check').forEach(cb => {
        cb.checked = checked;
      });
      _updateCatBatchBar();
    });
  }

  // 월별 체크박스 그룹화 유틸리티
  function _getCheckedGroups() {
    const checkedBoxes = document.querySelectorAll('.cat-row-check:checked');
    const groups = {};
    checkedBoxes.forEach(cb => {
      const month = cb.dataset.month;
      const rowIndex = parseInt(cb.dataset.row);
      if (!groups[month]) groups[month] = [];
      groups[month].push(rowIndex);
    });
    return groups;
  }

  // 일괄 삭제 버튼
  const deleteBtn = document.getElementById('cat-batch-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const groups = _getCheckedGroups();
      const totalCount = Object.values(groups).reduce((acc, curr) => acc + curr.length, 0);
      if (totalCount === 0) return;

      if (!confirm(`선택한 ${totalCount}건의 지출 항목을 정말 일괄 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행들을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        for (const month of Object.keys(groups)) {
          const rowIndexes = groups[month];
          await SheetsAPI.deleteRowsBatch(month, rowIndexes);
          if (typeof _allMonthData !== 'undefined') {
            delete _allMonthData[month]; // 캐시 무효화
          }
        }
        showToast(`🗑️ ${totalCount}건이 일괄 삭제되었습니다.`);
        await renderCategoryExpensesTab();
      } catch (err) {
        console.error('[누적 분석 일괄 삭제 실패]', err);
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

      const groups = _getCheckedGroups();
      const totalCount = Object.values(groups).reduce((acc, curr) => acc + curr.length, 0);
      if (totalCount === 0) {
        e.target.value = '';
        return;
      }

      if (!confirm(`선택한 ${totalCount}건의 카테고리를 [${selectedCat}](으)로 일괄 변경하시겠습니까?`)) {
        e.target.value = '';
        return;
      }

      showLoading(true);
      try {
        for (const month of Object.keys(groups)) {
          const rowIndexes = groups[month];
          const updates = rowIndexes.map(rowIndex => ({
            rowIndex,
            colIndex: SheetsAPI.getColIndices().cat,
            value: selectedCat
          }));
          await SheetsAPI.updateRowsBatch(month, updates);
          if (typeof _allMonthData !== 'undefined') {
            delete _allMonthData[month]; // 캐시 무효화
          }
        }
        showToast(`✅ ${totalCount}건의 카테고리가 일괄 변경되었습니다.`);
        await renderCategoryExpensesTab();
      } catch (err) {
        console.error('[누적 분석 카테고리 일괄 변경 실패]', err);
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

      const groups = _getCheckedGroups();
      const totalCount = Object.values(groups).reduce((acc, curr) => acc + curr.length, 0);
      if (totalCount === 0) {
        e.target.value = '';
        return;
      }

      if (!confirm(`선택한 ${totalCount}건의 결제수단을 [${selectedMethod}](으)로 일괄 변경하시겠습니까?`)) {
        e.target.value = '';
        return;
      }

      showLoading(true);
      try {
        for (const month of Object.keys(groups)) {
          const rowIndexes = groups[month];
          const updates = rowIndexes.map(rowIndex => ({
            rowIndex,
            colIndex: SheetsAPI.getColIndices().method,
            value: selectedMethod
          }));
          await SheetsAPI.updateRowsBatch(month, updates);
          if (typeof _allMonthData !== 'undefined') {
            delete _allMonthData[month]; // 캐시 무효화
          }
        }
        showToast(`✅ ${totalCount}건의 결제수단이 일괄 변경되었습니다.`);
        await renderCategoryExpensesTab();
      } catch (err) {
        console.error('[누적 분석 결제수단 일괄 변경 실패]', err);
        showToast('❌ 결제수단 일괄 변경 실패: ' + err.message, 'error');
      } finally {
        e.target.value = '';
        showLoading(false);
      }
    });
  }
}

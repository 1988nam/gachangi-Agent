/**
 * 가챙이 대시보드 - 검토 큐 탭
 * 노란색 배경 항목 필터링 + 즉시 수정
 */

function renderReviewTab(transactions, monthName) {
  const reviewItems = transactions.filter(t => t.needsReview);
  const container   = document.getElementById('review-table-body');
  const emptyState  = document.getElementById('review-empty');
  const countEl     = document.getElementById('review-count');
  const batchBar    = document.getElementById('review-batch-action-bar');
  const batchCount  = document.getElementById('review-batch-count');
  const checkAll    = document.getElementById('review-check-all');

  countEl.textContent = `${reviewItems.length}건`;
  container.innerHTML = '';

  // Reset batch bar on load
  if (batchBar) batchBar.style.display = 'none';
  if (checkAll) checkAll.checked = false;

  if (reviewItems.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  const categories = SheetsAPI.getCategories();
  const methods    = SheetsAPI.getMethods();

  reviewItems.forEach(tx => {
    const itemMonth = tx.month || monthName;
    const tr = document.createElement('tr');
    tr.id = `review-row-${tx.rowIndex}`;
    tr.className = 'review-row';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td><input type="checkbox" class="review-check-item" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}"></td>
      <td><span class="date-badge">${escapeHtml(tx.date)}</span></td>
      <td class="desc-cell" title="${escapeHtml(tx.desc)}">${escapeHtml(tx.desc)}</td>
      <td class="amount-cell inc">${tx.inc > 0 ? formatWon(tx.inc) : ''}</td>
      <td class="${isSaving ? 'amount-cell save' : 'amount-cell exp'}">
        ${tx.exp > 0
          ? (isSaving ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>${formatWon(tx.exp)}` : formatWon(tx.exp))
          : ''}
      </td>
      <td>
        <select class="inline-select cat-select" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}">
          ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === tx.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="inline-select method-select" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}">
          ${methods.map(m => `<option value="${escapeHtml(m)}" ${m === tx.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
      </td>
      <td>
        <button class="btn-done btn-text" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">완료</button>
        <button class="btn-edit btn-text" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}" style="padding: 2px 6px; font-size: 11px; background: var(--color-primary); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">수정</button>
        <button class="btn-delete btn-text" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border-radius: 4px; border: none; cursor: pointer;">삭제</button>
      </td>
    `;
    container.appendChild(tr);
  });

  // --- 체크박스 및 일괄 작업 상태 갱신 로직 ---
  function updateBatchBar() {
    const checkedCount = container.querySelectorAll('.review-check-item:checked').length;
    if (checkedCount > 0) {
      if (batchCount) batchCount.textContent = `${checkedCount}건 선택됨`;
      if (batchBar) batchBar.style.display = 'flex';
    } else {
      if (batchBar) batchBar.style.display = 'none';
    }
  }

  if (checkAll) {
    checkAll.onclick = (e) => {
      const checked = e.target.checked;
      container.querySelectorAll('.review-check-item').forEach(chk => {
        chk.checked = checked;
      });
      updateBatchBar();
    };
  }

  container.querySelectorAll('.review-check-item').forEach(chk => {
    chk.onclick = () => {
      const total = container.querySelectorAll('.review-check-item').length;
      const checked = container.querySelectorAll('.review-check-item:checked').length;
      if (checkAll) {
        checkAll.checked = (total === checked);
      }
      updateBatchBar();
    };
  });

  // --- 카테고리 / 결제수단 실시간 인라인 변경 이벤트 ---
  container.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      const cols     = SheetsAPI.getColIndices();
      const rowEl    = document.getElementById(`review-row-${rowIndex}`);
      sel.disabled = true;
      try {
        await SheetsAPI.updateCell(month, rowIndex, cols.cat, e.target.value);
        _flashRow(rowEl, 'success');
      } catch (err) {
        showToast('❌ 저장 실패: ' + err.message, 'error');
        _flashRow(rowEl, 'error');
      } finally {
        sel.disabled = false;
      }
    });
  });

  container.querySelectorAll('.method-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      const cols     = SheetsAPI.getColIndices();
      const rowEl    = document.getElementById(`review-row-${rowIndex}`);
      sel.disabled = true;
      try {
        await SheetsAPI.updateCell(month, rowIndex, cols.method, e.target.value);
        _flashRow(rowEl, 'success');
      } catch (err) {
        showToast('❌ 저장 실패: ' + err.message, 'error');
        _flashRow(rowEl, 'error');
      } finally {
        sel.disabled = false;
      }
    });
  });

  // --- 개별 완료 처리 버튼 ---
  container.querySelectorAll('.btn-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      btn.disabled = true;
      btn.textContent = '처리중...';
      try {
        await SheetsAPI.markReviewed(month, rowIndex);
        const row = document.getElementById(`review-row-${rowIndex}`);
        row.classList.add('row-fade-out');
        setTimeout(() => {
          row.remove();
          // 남은 항목 개수 다시 로딩
          const remaining = container.querySelectorAll('.review-row:not(.row-fade-out)').length;
          document.getElementById('review-count').textContent = `${remaining}건`;
          document.getElementById('review-badge').textContent = remaining;
          if (remaining <= 0) {
            emptyState.style.display = 'flex';
            document.getElementById('review-badge').style.display = 'none';
          }
        }, 400);
      } catch (err) {
        showToast('❌ 완료 처리 실패: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '완료';
      }
    });
  });

  // --- 개별 수정 (인라인 입력 폼 전환) ---
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      const tx = reviewItems.find(t => t.rowIndex === rowIndex && (t.month || monthName) === month);
      if (!tx) return;

      const tr = e.target.closest('tr');
      tr.innerHTML = `
        <td><input type="checkbox" disabled></td>
        <td><input type="text" class="edit-date" value="${escapeHtml(tx.date)}" style="width: 55px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: center;"></td>
        <td><input type="text" class="edit-desc" value="${escapeHtml(tx.desc)}" style="width: 90%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px;"></td>
        <td><input type="text" class="edit-inc" value="${tx.inc ? tx.inc.toLocaleString('ko-KR') : ''}" style="width: 75px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td><input type="text" class="edit-exp" value="${tx.exp ? tx.exp.toLocaleString('ko-KR') : ''}" style="width: 75px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td>
          <select class="edit-cat" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${categories.map(c => `<option value="${escapeHtml(c)}" ${c === tx.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="edit-method" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${methods.map(m => `<option value="${escapeHtml(m)}" ${m === tx.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </td>
        <td>
          <button class="btn-save-edit" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">저장</button>
          <button class="btn-cancel-edit" style="padding: 2px 6px; font-size: 11px; background: var(--text-muted); color: white; border-radius: 4px; border: none; cursor: pointer;">취소</button>
        </td>
      `;

      tr.querySelector('.edit-inc').addEventListener('input', formatInputWithCommas);
      tr.querySelector('.edit-exp').addEventListener('input', formatInputWithCommas);

      // 저장 처리
      tr.querySelector('.btn-save-edit').addEventListener('click', async () => {
        const date = tr.querySelector('.edit-date').value.trim();
        const desc = tr.querySelector('.edit-desc').value.trim();
        const inc = parseInt(tr.querySelector('.edit-inc').value.replace(/,/g, '')) || 0;
        const exp = parseInt(tr.querySelector('.edit-exp').value.replace(/,/g, '')) || 0;
        const cat = tr.querySelector('.edit-cat').value;
        const method = tr.querySelector('.edit-method').value;

        showLoading(true);
        try {
          // 수정 시 검토 큐에서 빠지도록 needsReview를 false(흰색 배경)로 처리
          await SheetsAPI.updateRow(month, rowIndex, { date, desc, inc, exp, cat, method });
          showToast('✅ 수정이 완료되었습니다.');
          await loadCurrentMonth();
        } catch (err) {
          console.error('[검토 큐 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 처리
      tr.querySelector('.btn-cancel-edit').addEventListener('click', () => {
        renderReviewTab(transactions, monthName);
      });
    });
  });

  // --- 개별 삭제 처리 ---
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      const tx = reviewItems.find(t => t.rowIndex === rowIndex && (t.month || monthName) === month);
      if (!tx) return;

      const amtText = tx.inc > 0 ? `수입 ${formatWon(tx.inc)}` : `지출 ${formatWon(tx.exp)}`;
      if (!confirm(`행 #${rowIndex} (${tx.desc} | ${amtText}) 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트에서 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRow(month, rowIndex);
        showToast('🗑️ 삭제가 완료되었습니다.');
        await loadCurrentMonth();
      } catch (err) {
        console.error('[검토 큐 삭제 실패]', err);
        showToast('❌ 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  });

  // --- 일괄 완료 버튼 이벤트 바인딩 ---
  const batchDoneBtn = document.getElementById('review-batch-done-btn');
  if (batchDoneBtn) {
    batchDoneBtn.onclick = async () => {
      const checkedItems = container.querySelectorAll('.review-check-item:checked');
      if (checkedItems.length === 0) return;

      showLoading(true);
      try {
        // 월별 항목 그룹화
        const monthlyGroups = {};
        checkedItems.forEach(chk => {
          const row = parseInt(chk.dataset.row);
          const month = chk.dataset.month;
          if (!monthlyGroups[month]) monthlyGroups[month] = [];
          monthlyGroups[month].push(row);
        });

        // 각 월별 일괄 업데이트 
        for (const month of Object.keys(monthlyGroups)) {
          const rows = monthlyGroups[month];
          const updates = rows.map(r => ({
            rowIndex: r,
            needsReview: false,
            bgColor: { red: 1, green: 1, blue: 1 }
          }));
          await SheetsAPI.updateRowsBatch(month, updates);
        }

        showToast('✅ 선택된 항목들이 모두 검토 완료 처리되었습니다.');
        if (checkAll) checkAll.checked = false;
        await loadCurrentMonth();
      } catch (err) {
        showToast('❌ 일괄 완료 처리 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    };
  }

  // --- 일괄 삭제 버튼 이벤트 바인딩 ---
  const batchDeleteBtn = document.getElementById('review-batch-delete-btn');
  if (batchDeleteBtn) {
    batchDeleteBtn.onclick = async () => {
      const checkedItems = container.querySelectorAll('.review-check-item:checked');
      if (checkedItems.length === 0) return;

      if (!confirm(`선택한 ${checkedItems.length}개의 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트에서 해당 행들을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        // 월별 항목 그룹화
        const monthlyGroups = {};
        checkedItems.forEach(chk => {
          const row = parseInt(chk.dataset.row);
          const month = chk.dataset.month;
          if (!monthlyGroups[month]) monthlyGroups[month] = [];
          monthlyGroups[month].push(row);
        });

        // 각 월별 일괄 삭제
        for (const month of Object.keys(monthlyGroups)) {
          const rows = monthlyGroups[month];
          await SheetsAPI.deleteRowsBatch(month, rows);
        }

        showToast('🗑️ 선택된 항목들이 일괄 삭제되었습니다.');
        if (checkAll) checkAll.checked = false;
        await loadCurrentMonth();
      } catch (err) {
        showToast('❌ 일괄 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    };
  }
}

function _flashRow(row, type) {
  if (!row) return;
  row.classList.add(`flash-${type}`);
  setTimeout(() => row.classList.remove(`flash-${type}`), 1000);
}

/**
 * 가챙이 대시보드 - 상세 내역 탭 (구 거래 내역)
 */

function renderTransactionsTab(transactions, monthName) {
  // 상단 바 타이틀 업데이트
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    pageTitle.textContent = `📋 상세 내역 (${monthName})`;
  }

  const tbody     = document.getElementById('tx-table-body');
  const filterCat = document.getElementById('filter-cat').value;
  const filterMethod = document.getElementById('filter-method').value;
  const searchText   = document.getElementById('tx-search').value.toLowerCase();

  let filtered = transactions.filter(t => {
    if (filterCat    && t.cat    !== filterCat)    return false;
    if (filterMethod && t.method !== filterMethod)  return false;
    if (searchText   && !t.desc.toLowerCase().includes(searchText)) return false;
    return true;
  });

  // 합계 업데이트 (early return 전에 실행하여 정확한 수치가 표시되도록 보장)
  const totalInc = filtered.reduce((s, t) => s + t.inc, 0);
  const totalExp = filtered.reduce((s, t) => s + (t.cat === '투자/저축' ? 0 : t.exp), 0);
  const totalSave = filtered.reduce((s, t) => s + (t.cat === '투자/저축' ? t.exp : 0), 0);
  document.getElementById('tx-total-inc').textContent = formatWon(totalInc);
  document.getElementById('tx-total-exp').textContent = formatWon(totalExp);
  const txTotalSaveEl = document.getElementById('tx-total-save');
  if (txTotalSaveEl) {
    txTotalSaveEl.textContent = formatWon(totalSave);
  }
  document.getElementById('tx-count').textContent     = `${filtered.length}건`;

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">조건에 맞는 거래 내역이 없습니다.</td></tr>`;
    return;
  }

  filtered.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'tx-row needs-review' : 'tx-row';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td><span class="date-badge">${escapeHtml(tx.date)}</span></td>
      <td class="desc-cell" title="${escapeHtml(tx.desc)}">${escapeHtml(tx.desc)}</td>
      <td class="amount-cell inc">${tx.inc > 0 ? formatWon(tx.inc) : '-'}</td>
      <td class="${isSaving ? 'amount-cell save' : 'amount-cell exp'}">
        ${tx.exp > 0
          ? (isSaving ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>${formatWon(tx.exp)}` : formatWon(tx.exp))
          : '-'}
      </td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${escapeHtml(tx.cat)}</span></td>
      <td><span class="method-chip">${escapeHtml(tx.method)}</span></td>
      <td class="row-index-cell">#${tx.rowIndex}</td>
      <td>
        <button class="btn-edit btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-primary); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">수정</button>
        <button class="btn-delete btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border-radius: 4px; border: none; cursor: pointer;">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 이벤트 바인딩 - 수정 버튼
  tbody.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = filtered.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      const tr = e.target.closest('tr');
      // 행을 입력 폼으로 변환
      tr.innerHTML = `
        <td><input type="text" class="edit-date" value="${escapeHtml(tx.date)}" style="width: 50px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: center;"></td>
        <td><input type="text" class="edit-desc" value="${escapeHtml(tx.desc)}" style="width: 90%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px;"></td>
        <td><input type="text" class="edit-inc" value="${tx.inc ? tx.inc.toLocaleString('ko-KR') : ''}" style="width: 70px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td><input type="text" class="edit-exp" value="${tx.exp ? tx.exp.toLocaleString('ko-KR') : ''}" style="width: 70px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td>
          <select class="edit-cat" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getCategories().map(c => `<option value="${escapeHtml(c)}" ${c === tx.cat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="edit-method" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getMethods().map(m => `<option value="${escapeHtml(m)}" ${m === tx.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </td>
        <td class="row-index-cell">#${tx.rowIndex}</td>
        <td>
          <button class="btn-save-edit" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">저장</button>
          <button class="btn-cancel-edit" style="padding: 2px 6px; font-size: 11px; background: var(--text-muted); color: white; border-radius: 4px; border: none; cursor: pointer;">취소</button>
        </td>
      `;

      // 인라인 편집 시 실시간 천단위 쉼표 포맷팅 바인딩
      tr.querySelector('.edit-inc').addEventListener('input', formatInputWithCommas);
      tr.querySelector('.edit-exp').addEventListener('input', formatInputWithCommas);

      // 저장 버튼 이벤트
      tr.querySelector('.btn-save-edit').addEventListener('click', async () => {
        const date = tr.querySelector('.edit-date').value;
        const desc = tr.querySelector('.edit-desc').value;
        const inc = parseInt(tr.querySelector('.edit-inc').value.replace(/,/g, '')) || 0;
        const exp = parseInt(tr.querySelector('.edit-exp').value.replace(/,/g, '')) || 0;
        const cat = tr.querySelector('.edit-cat').value;
        const method = tr.querySelector('.edit-method').value;

        showLoading(true);
        try {
          await SheetsAPI.updateRow(monthName, rowIndex, { date, desc, inc, exp, cat, method });
          showToast('✅ 수정 완료되었습니다.');
          
          // 데이터 리로드 및 탭 갱신
          await loadCurrentMonth();
        } catch (err) {
          console.error('[상세 내역 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 버튼 이벤트
      tr.querySelector('.btn-cancel-edit').addEventListener('click', () => {
        renderTransactionsTab(transactions, monthName);
      });
    });
  });

  // 이벤트 바인딩 - 삭제 버튼
  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = filtered.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      const amtText = tx.inc > 0 ? `수입 ${formatWon(tx.inc)}` : `지출 ${formatWon(tx.exp)}`;
      if (!confirm(`행 #${rowIndex} (${tx.desc} | ${amtText}) 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRow(monthName, rowIndex);
        showToast('🗑️ 삭제가 완료되었습니다.');
        
        // 데이터 리로드 및 탭 갱신
        await loadCurrentMonth();
      } catch (err) {
        console.error('[상세 내역 삭제 실패]', err);
        showToast('❌ 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  });
}

/** 필터 드롭다운 초기화 */
function initTransactionFilters() {
  const catSel    = document.getElementById('filter-cat');
  const methodSel = document.getElementById('filter-method');

  if (catSel && methodSel) {
    catSel.innerHTML    = '<option value="">전체 분류</option>';
    methodSel.innerHTML = '<option value="">전체 수단</option>';

    SheetsAPI.getCategories().forEach(c => {
      catSel.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    SheetsAPI.getMethods().forEach(m => {
      methodSel.innerHTML += `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`;
    });
  }

  // 항목 추가 버튼 이벤트 바인딩
  const addBtn = document.getElementById('btn-add-tx');
  if (addBtn) {
    addBtn.onclick = () => openAddModal('normal');
  }
}

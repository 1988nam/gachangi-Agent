/**
 * 가챙이 대시보드 - 고정비 관리 탭 컨트롤러
 */

function renderFixedExpensesTab(transactions, monthName) {
  // 상단 바 타이틀 업데이트
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    pageTitle.textContent = `📌 고정비 관리 (${monthName})`;
  }

  const tbody = document.getElementById('fixed-table-body');
  if (!tbody) return;

  // 고정비 플래그가 설정된 항목만 필터링
  let filtered = transactions.filter(t => t.isFixed);

  tbody.innerHTML = '';

  // 고정비 추가 버튼 이벤트 바인딩
  const addFixedBtn = document.getElementById('btn-add-fixed');
  if (addFixedBtn) {
    addFixedBtn.onclick = () => openAddModal('fixed');
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">이번 달에 등록된 고정비 내역이 없습니다.</td></tr>`;
    document.getElementById('fixed-total-inc').textContent = '0원';
    document.getElementById('fixed-total-exp').textContent = '0원';
    document.getElementById('fixed-count').textContent     = '0건';
    return;
  }

  filtered.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'tx-row needs-review' : 'tx-row';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td class="desc-cell" title="${tx.desc}">${tx.desc}</td>
      <td class="amount-cell inc">${tx.inc > 0 ? formatWon(tx.inc) : '-'}</td>
      <td class="${isSaving ? 'amount-cell save' : 'amount-cell exp'}">
        ${tx.exp > 0 
          ? (isSaving ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>${formatWon(tx.exp)}` : formatWon(tx.exp)) 
          : '-'}
      </td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${tx.cat}</span></td>
      <td><span class="method-chip">${tx.method}</span></td>
      <td class="row-index-cell">#${tx.rowIndex}</td>
      <td>
        <button class="btn-fixed-edit btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-primary); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">수정</button>
        <button class="btn-fixed-delete btn-text" data-row="${tx.rowIndex}" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border-radius: 4px; border: none; cursor: pointer;">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 합계 계산 및 업데이트
  const totalInc = filtered.reduce((s, t) => s + t.inc, 0);
  const totalExp = filtered.reduce((s, t) => s + (t.cat === '투자/저축' ? 0 : t.exp), 0);
  const totalSave = filtered.reduce((s, t) => s + (t.cat === '투자/저축' ? t.exp : 0), 0);
  document.getElementById('fixed-total-inc').textContent = formatWon(totalInc);
  document.getElementById('fixed-total-exp').textContent = formatWon(totalExp);
  const fixedTotalSaveEl = document.getElementById('fixed-total-save');
  if (fixedTotalSaveEl) {
    fixedTotalSaveEl.textContent = formatWon(totalSave);
  }
  document.getElementById('fixed-count').textContent     = `${filtered.length}건`;

  // 이벤트 바인딩 - 수정 버튼
  tbody.querySelectorAll('.btn-fixed-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = filtered.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      const tr = e.target.closest('tr');
      // 행을 입력 폼으로 변환 (날짜 필드는 생략하고 고정으로 처리)
      tr.innerHTML = `
        <td><input type="text" class="edit-fixed-desc" value="${tx.desc}" style="width: 90%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px;"></td>
        <td><input type="text" class="edit-fixed-inc" value="${tx.inc ? tx.inc.toLocaleString('ko-KR') : ''}" style="width: 75px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td><input type="text" class="edit-fixed-exp" value="${tx.exp ? tx.exp.toLocaleString('ko-KR') : ''}" style="width: 75px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; text-align: right;"></td>
        <td>
          <select class="edit-fixed-cat" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getCategories().map(c => `<option value="${c}" ${c === tx.cat ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="edit-fixed-method" style="background: rgba(15,23,42,0.9); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 4px; font-family: 'Outfit', 'Noto Sans KR', sans-serif;">
            ${SheetsAPI.getMethods().map(m => `<option value="${m}" ${m === tx.method ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </td>
        <td class="row-index-cell">#${tx.rowIndex}</td>
        <td>
          <button class="btn-save-fixed-edit" style="padding: 2px 6px; font-size: 11px; background: var(--color-success); color: white; border-radius: 4px; border: none; cursor: pointer; margin-right: 4px;">저장</button>
          <button class="btn-cancel-fixed-edit" style="padding: 2px 6px; font-size: 11px; background: var(--text-muted); color: white; border-radius: 4px; border: none; cursor: pointer;">취소</button>
        </td>
      `;

      // 인라인 편집 시 실시간 천단위 쉼표 포맷팅 바인딩
      tr.querySelector('.edit-fixed-inc').addEventListener('input', formatInputWithCommas);
      tr.querySelector('.edit-fixed-exp').addEventListener('input', formatInputWithCommas);

      // 저장 버튼 이벤트
      tr.querySelector('.btn-save-fixed-edit').addEventListener('click', async () => {
        const desc = tr.querySelector('.edit-fixed-desc').value;
        const inc = parseInt(tr.querySelector('.edit-fixed-inc').value.replace(/,/g, '')) || 0;
        const exp = parseInt(tr.querySelector('.edit-fixed-exp').value.replace(/,/g, '')) || 0;
        const cat = tr.querySelector('.edit-fixed-cat').value;
        const method = tr.querySelector('.edit-fixed-method').value;

        showLoading(true);
        try {
          // 미래 월까지 일괄 전파 수정 API 호출
          await SheetsAPI.updateFixedExpense(monthName, rowIndex, { desc, inc, exp, cat, method });
          showToast('✅ 고정비 수정 완료되었습니다.');
          
          // 현재 월 포함하여 미래 월들의 로컬 캐시 일괄 무효화
          if (typeof _allMonthData !== 'undefined') {
            const months = GACHANGI_CONFIG.MONTH_NAMES;
            const startIndex = months.indexOf(monthName);
            if (startIndex !== -1) {
              months.slice(startIndex).forEach(m => {
                delete _allMonthData[m];
              });
            }
          }
          
          // 데이터 리로드 및 탭 갱신
          await loadCurrentMonth();
        } catch (err) {
          console.error('[고정비 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 버튼 이벤트
      tr.querySelector('.btn-cancel-fixed-edit').addEventListener('click', () => {
        renderFixedExpensesTab(transactions, monthName);
      });
    });
  });

  // 이벤트 바인딩 - 삭제 버튼
  tbody.querySelectorAll('.btn-fixed-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const tx = filtered.find(t => t.rowIndex === rowIndex);
      if (!tx) return;

      const amtText = tx.inc > 0 ? `수입 ${formatWon(tx.inc)}` : `지출 ${formatWon(tx.exp)}`;
      if (!confirm(`행 #${rowIndex} (${tx.desc} | ${amtText}) 고정비 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트의 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        // 미래 월까지 일괄 전파 삭제 API 호출
        await SheetsAPI.deleteFixedExpense(monthName, rowIndex);
        showToast('🗑️ 고정비가 삭제되었습니다.');
        
        // 현재 월 포함하여 미래 월들의 로컬 캐시 일괄 무효화
        if (typeof _allMonthData !== 'undefined') {
          const months = GACHANGI_CONFIG.MONTH_NAMES;
          const startIndex = months.indexOf(monthName);
          if (startIndex !== -1) {
            months.slice(startIndex).forEach(m => {
              delete _allMonthData[m];
            });
          }
        }
        
        // 데이터 리로드 및 탭 갱신
        await loadCurrentMonth();
      } catch (err) {
        console.error('[고정비 삭제 실패]', err);
        showToast('❌ 삭제 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    });
  });
}

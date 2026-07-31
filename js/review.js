/**
 * 가챙이 대시보드 - 검토 큐 탭
 * 노란색 배경 항목 필터링 + 즉시 수정
 *
 * 월과 무관하게 '모든 월'의 검토 필요(노란) 항목을 한 화면에 모아 보여준다.
 *  - 데이터 출처: 전역 _allMonthData(모든 월 캐시). 탭 진입 시 refreshReviewData()로 최신화.
 *  - 행 id는 월이 달라도 rowIndex가 겹칠 수 있으므로 `월__행번호` 복합키로 유니크하게 만든다.
 *  - 개별/일괄 작업은 각 행의 data-month를 사용하므로 여러 달이 섞여 있어도 안전하다.
 */

/** 복합 행 키(월이 달라도 유니크) */
function _reviewRowKey(month, rowIndex) {
  return `${month}__${rowIndex}`;
}

/** 모든 월 캐시에서 검토 필요(노란) 항목을 월 순서대로 모아 [{...tx, month}] 배열로 반환 */
function _collectReviewItems() {
  const data = (typeof _allMonthData !== 'undefined' && _allMonthData) || {};
  const order = (window.GACHANGI_CONFIG && GACHANGI_CONFIG.MONTH_NAMES) || [];
  const months = Object.keys(data).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const items = [];
  for (const m of months) {
    (data[m] || []).forEach(tx => {
      if (tx.needsReview) items.push(Object.assign({}, tx, { month: m }));
    });
  }
  return items;
}

/** 동시 실행 수를 제한한 map — 12개월을 한꺼번에 던지면 Sheets 분당 할당량(사용자당 읽기 60회)을
 *  단번에 태워 429가 난다. 3개씩 흘려보내면 같은 작업을 할당량 안에서 처리한다. */
async function _mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 검토 큐 탭 진입 시 모든 월 데이터를 최신화한 뒤 다시 그린다(탭이 활성일 때만). */
let _reviewRefreshing = false;      // 재진입 가드 — 12개월 로드가 겹쳐 돌지 않게
let _reviewEpoch = 0;               // 사용자 완료/수정/삭제 때마다 증가 — 진행 중 새로고침의 낡은 스냅샷 무효화용
let _reviewLastFullRefresh = 0;     // 마지막 전체 월 재조회 시각
const REVIEW_REFRESH_TTL_MS = 60 * 1000;

/** 수동 새로고침(🔄)·데이터 변경 시 호출 — 다음 탭 진입에서 전체 월을 다시 읽게 한다. */
function invalidateReviewRefresh() {
  _reviewLastFullRefresh = 0;
}

/**
 * @param {boolean} force TTL을 무시하고 전체 월을 다시 읽는다(수동 새로고침용).
 *
 * 과거엔 탭에 들어올 때마다 무조건 12개월을 병렬로 다시 읽었다. switchTab이 탭 진입뿐 아니라
 * loadCurrentMonth() 끝에서도 불리기 때문에 항목 하나 고칠 때마다 12회 읽기가 또 돌았고,
 * 이게 429(할당량 초과)의 직접적인 원인이었다. → TTL 안에서는 캐시에 없는 달만 읽는다.
 */
async function refreshReviewData(force = false) {
  if (_reviewRefreshing) return;
  _reviewRefreshing = true;
  const startEpoch = _reviewEpoch;
  const countEl = document.getElementById('review-count');
  try {
    const meta = (SheetsAPI.getSheetMeta && SheetsAPI.getSheetMeta()) || {};
    const months = ((window.GACHANGI_CONFIG && GACHANGI_CONFIG.MONTH_NAMES) || [])
      .filter(m => meta[m] !== undefined);
    const isFull = force || (Date.now() - _reviewLastFullRefresh >= REVIEW_REFRESH_TTL_MS);
    // TTL 안이면 캐시에 없는 달만 읽는다(보통 0건) → 탭을 오갈 때마다 12개월을 다시 읽지 않는다.
    const targets = isFull ? months : months.filter(m => !_allMonthData || !_allMonthData[m]);
    if (targets.length > 0) {
      if (countEl) countEl.textContent = '불러오는 중…';
      const results = await _mapLimit(targets, 3, m =>
        SheetsAPI.loadMonthData(m)
          .then(d => [m, d])
          .catch(() => [m, (_allMonthData && _allMonthData[m]) || []])
      );
      if (isFull) _reviewLastFullRefresh = Date.now();
      // 로드 도중 사용자가 완료/수정/삭제했다면 이 결과는 낡은 스냅샷 → 버린다(완료 항목 부활 방지).
      if (startEpoch !== _reviewEpoch) return;
      results.forEach(([m, d]) => {
        _allMonthData[m] = d;
        // _transactions는 loadCurrentMonth에서 _allMonthData[_currentMonth]의 별칭으로 시작한다.
        // 재할당이 별칭을 끊으면 상세내역/고정비 탭이 낡은 rowIndex로 남는다 → 함께 갱신.
        if (typeof _currentMonth !== 'undefined' && m === _currentMonth) _transactions = d;
      });
    }
  } catch (e) {
    console.warn('[검토 큐 전체 새로고침 실패]', e);
  } finally {
    _reviewRefreshing = false;
  }
  if (typeof updateReviewBadge === 'function') updateReviewBadge();
  // 여전히 검토 큐 탭이 활성일 때만 다시 그린다(사용자가 그새 탭을 옮겼을 수 있음).
  // 단, 인라인 수정 폼이 열려 있으면 재렌더가 작성 중인 내용을 날리므로 건너뛴다.
  if (document.getElementById('tab-review')?.classList.contains('active')) {
    if (document.querySelector('#review-table-body .btn-save-edit')) {
      if (countEl) countEl.textContent = `${_collectReviewItems().length}건`;
      return;
    }
    renderReviewTab();
  }
}

function renderReviewTab() {
  const reviewItems = _collectReviewItems();
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
    const itemMonth = tx.month;
    const rowKey = _reviewRowKey(itemMonth, tx.rowIndex);
    const tr = document.createElement('tr');
    tr.id = `review-row-${rowKey}`;
    tr.className = 'review-row';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td><input type="checkbox" class="review-check-item" data-row="${tx.rowIndex}" data-month="${escapeHtml(itemMonth)}"></td>
      <td><span class="date-badge" style="background: rgba(99,102,241,0.15); color: #a5b4fc;">${escapeHtml(itemMonth)}</span></td>
      <td><span class="date-badge">${escapeHtml(tx.date)}</span>${tx.time ? `<span style="display:block; font-size:10px; color:var(--text-muted); margin-top:2px;">${escapeHtml(tx.time)}</span>` : ''}</td>
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
      const rowEl    = document.getElementById(`review-row-${_reviewRowKey(month, rowIndex)}`);
      sel.disabled = true;
      try {
        await SheetsAPI.updateCell(month, rowIndex, cols.cat, e.target.value);
        _syncCachedField(month, rowIndex, 'cat', e.target.value);
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
      const rowEl    = document.getElementById(`review-row-${_reviewRowKey(month, rowIndex)}`);
      sel.disabled = true;
      try {
        await SheetsAPI.updateCell(month, rowIndex, cols.method, e.target.value);
        _syncCachedField(month, rowIndex, 'method', e.target.value);
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
        // 캐시에서도 검토 해제 → 배지/재렌더 시 다시 나타나지 않도록
        _syncCachedField(month, rowIndex, 'needsReview', false);
        const row = document.getElementById(`review-row-${_reviewRowKey(month, rowIndex)}`);
        row.classList.add('row-fade-out');
        setTimeout(() => {
          row.remove();
          const remaining = container.querySelectorAll('.review-row:not(.row-fade-out)').length;
          document.getElementById('review-count').textContent = `${remaining}건`;
          if (typeof updateReviewBadge === 'function') updateReviewBadge();
          if (remaining <= 0) {
            emptyState.style.display = 'flex';
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
      const tx = reviewItems.find(t => t.rowIndex === rowIndex && t.month === month);
      if (!tx) return;

      const tr = e.target.closest('tr');
      tr.innerHTML = `
        <td><input type="checkbox" disabled></td>
        <td><span class="date-badge" style="background: rgba(99,102,241,0.15); color: #a5b4fc;">${escapeHtml(month)}</span></td>
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
          await _reloadMonthAndRerender(month);
        } catch (err) {
          console.error('[검토 큐 수정 실패]', err);
          showToast('❌ 수정 실패: ' + err.message, 'error');
        } finally {
          showLoading(false);
        }
      });

      // 취소 처리
      tr.querySelector('.btn-cancel-edit').addEventListener('click', () => {
        renderReviewTab();
      });
    });
  });

  // --- 개별 삭제 처리 ---
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const rowIndex = parseInt(e.target.dataset.row);
      const month    = e.target.dataset.month;
      const tx = reviewItems.find(t => t.rowIndex === rowIndex && t.month === month);
      if (!tx) return;

      const amtText = tx.inc > 0 ? `수입 ${formatWon(tx.inc)}` : `지출 ${formatWon(tx.exp)}`;
      if (!confirm(`[${month}] 행 #${rowIndex} (${tx.desc} | ${amtText}) 항목을 정말 삭제하시겠습니까?\n이 작업은 구글 시트에서 해당 행을 삭제하며 되돌릴 수 없습니다.`)) {
        return;
      }

      showLoading(true);
      try {
        await SheetsAPI.deleteRow(month, rowIndex);
        showToast('🗑️ 삭제가 완료되었습니다.');
        await _reloadMonthAndRerender(month);
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
        await _reloadMonthsAndRerender(Object.keys(monthlyGroups));
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
        await _reloadMonthsAndRerender(Object.keys(monthlyGroups));
      } catch (err) {
        showToast('❌ 일괄 삭제 처리 실패: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    };
  }
}

/** 특정 월 캐시의 한 행 필드를 갱신(낙관적 반영). */
function _syncCachedField(month, rowIndex, field, value) {
  _reviewEpoch++; // 진행 중인 전체 새로고침의 낡은 스냅샷 무효화
  const arr = (_allMonthData && _allMonthData[month]) || null;
  if (!arr) return;
  const it = arr.find(t => t.rowIndex === rowIndex);
  if (it) it[field] = value;
}

/** 캐시 재할당 시 _transactions 별칭 복구.
 *  _transactions와 _allMonthData[_currentMonth]는 같은 배열(별칭)로 시작하는데, 재할당이
 *  별칭을 끊으면 상세내역/고정비 탭에 '삭제 전 rowIndex'가 남아 이후 삭제가 엉뚱한 행을 지운다. */
function _syncCurrentMonthAlias(month, data) {
  if (typeof _currentMonth !== 'undefined' && month === _currentMonth) _transactions = data;
}

/** 한 달만 구글 시트에서 다시 읽어 캐시 갱신 후 검토 큐 재렌더 + 배지 갱신. */
async function _reloadMonthAndRerender(month) {
  _reviewEpoch++;
  try {
    const data = await SheetsAPI.loadMonthData(month);
    _allMonthData[month] = data;
    _syncCurrentMonthAlias(month, data);
  } catch (e) {
    console.warn(`[검토 큐] ${month} 재로딩 실패:`, e);
  }
  if (typeof updateReviewBadge === 'function') updateReviewBadge();
  renderReviewTab();
}

/** 여러 달을 다시 읽어 캐시 갱신 후 재렌더. */
async function _reloadMonthsAndRerender(months) {
  _reviewEpoch++;
  await _mapLimit(months || [], 3, m =>
    SheetsAPI.loadMonthData(m)
      .then(d => { _allMonthData[m] = d; _syncCurrentMonthAlias(m, d); })
      .catch(e => console.warn(`[검토 큐] ${m} 재로딩 실패:`, e))
  );
  if (typeof updateReviewBadge === 'function') updateReviewBadge();
  renderReviewTab();
}

function _flashRow(row, type) {
  if (!row) return;
  row.classList.add(`flash-${type}`);
  setTimeout(() => row.classList.remove(`flash-${type}`), 1000);
}

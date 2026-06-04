/**
 * 가챙이 대시보드 - 종합 대시보드 탭 (YTD 누적 수입/지출 + 카테고리 순위 + 상세 내역 + 월별 트렌드)
 */

let _pieChart = null;
let _trendChart = null;

const CHART_COLORS = [
  '#6366f1', // Indigo
  '#22c55e', // Green
  '#fb923c', // Orange
  '#ec4899', // Pink
  '#0ea5e9', // Sky Blue
  '#eab308', // Amber/Yellow
  '#ef4444', // Red
  '#14b8a6', // Teal
  '#a855f7', // Purple
  '#84cc16', // Lime
  '#f43f5e', // Rose
  '#06b6d4', // Cyan
];

/** 대시보드 탭 렌더링 (YTD 누적) */
async function renderDashboardTab() {
  const now = new Date();
  const sysMonthNum = now.getMonth() + 1; // e.g., 6 (June)
  const sysMonth = `${sysMonthNum}월`;

  document.getElementById('page-title').textContent = `📊 종합 대시보드 (1월 ~ ${sysMonth})`;

  showLoading(true);
  try {
    // 1월부터 현재 월(sysMonth)까지 모든 데이터를 취합합니다
    const allTransactions = [];
    for (let i = 1; i <= sysMonthNum; i++) {
      const monthName = `${i}월`;
      let monthTxs = [];
      if (_allMonthData[monthName]) {
        monthTxs = _allMonthData[monthName];
      } else {
        try {
          monthTxs = await SheetsAPI.loadMonthData(monthName);
          _allMonthData[monthName] = monthTxs;
        } catch (e) {
          console.warn(`[가챙이] ${monthName} 데이터 로딩 누락/실패:`, e);
          monthTxs = [];
        }
      }
      allTransactions.push(...monthTxs);
    }

    const totalInc = allTransactions.reduce((s, t) => s + t.inc, 0);
    const totalExp = allTransactions.reduce((s, t) => s + (t.cat === '투자/저축' ? 0 : t.exp), 0);
    const balance  = totalInc - totalExp;

    // KPI 카드 업데이트 (YTD 누적 값)
    document.getElementById('kpi-income').textContent  = formatWon(totalInc);
    document.getElementById('kpi-expense').textContent = formatWon(totalExp);
    document.getElementById('kpi-balance').textContent = formatWon(balance);
    document.getElementById('kpi-balance').style.color = balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

    // 지출 항목 필터링 및 카테고리 집계 (투자/저축 포함)
    const expenses = allTransactions.filter(t => t.exp > 0);
    const catTotals = {};
    const catCounts = {};
    expenses.forEach(t => {
      if (t.cat) {
        catTotals[t.cat] = (catTotals[t.cat] || 0) + t.exp;
        catCounts[t.cat] = (catCounts[t.cat] || 0) + 1;
      }
    });

    // 도넛 차트 및 카테고리 순위 리스트 렌더링
    _renderPieChart(catTotals);
    _renderDashboardCatList(catTotals, catCounts, totalExp, expenses);

    // 트렌드 차트 업데이트
    renderTrendChart(_allMonthData);

  } catch (err) {
    console.error('[종합 대시보드 로드 실패]', err);
    showToast('❌ 데이터를 불러오지 못했습니다: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/** 대시보드용 카테고리별 누적 순위 리스트 (상세 보기 클릭 이벤트 포함) */
function _renderDashboardCatList(catTotals, catCounts, totalExp, allExpenses) {
  const container = document.getElementById('dashboard-cat-list');
  container.innerHTML = '';

  const sortedCats = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);

  if (sortedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>누적 지출 내역이 없습니다.</p>
      </div>`;
    _renderDashboardCatDetailsTable([], '전체');
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
      _renderDashboardCatDetailsTable(filtered, cat);
      document.getElementById('dashboard-cat-details-title').scrollIntoView({ behavior: 'smooth' });
    });

    item.innerHTML = `
      <div class="budget-bar-header">
        <span class="budget-bar-label">${emoji} ${cat} <small style="color: var(--text-muted); font-size:11px; margin-left:4px;">(${count}건)</small></span>
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

  // 기본적으로 1위 카테고리 상세 표시
  const topCat = sortedCats[0];
  const filtered = allExpenses.filter(t => t.cat === topCat);
  _renderDashboardCatDetailsTable(filtered, topCat);
}

/** 대시보드용 카테고리 누적 상세 거래 내역 테이블 */
function _renderDashboardCatDetailsTable(transactions, categoryName) {
  const title = document.getElementById('dashboard-cat-details-title');
  if (title) {
    title.textContent = `🔍 [${categoryName}] 누적 상세 거래 내역 (${transactions.length}건)`;
  }

  const tbody = document.getElementById('dashboard-cat-details-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">지출 내역이 없습니다.</td></tr>`;
    return;
  }

  const sorted = [...transactions].sort((a, b) => b.rowIndex - a.rowIndex);

  sorted.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'needs-review' : '';
    const isSaving = tx.cat === '투자/저축';
    tr.innerHTML = `
      <td><span class="date-badge">${tx.date}</span></td>
      <td class="desc-cell" title="${tx.desc}">${tx.desc}</td>
      <td class="${isSaving ? 'amount-cell save' : 'amount-cell exp'}">${isSaving ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>` + formatWon(tx.exp) : formatWon(tx.exp)}</td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${tx.cat}</span></td>
      <td><span class="method-chip">${tx.method}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/** 카테고리별 누적 파이 차트 */
function _renderPieChart(catTotals) {
  const labels  = Object.keys(catTotals);
  const data    = Object.values(catTotals);
  const colors  = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  const ctx = document.getElementById('pie-chart').getContext('2d');
  if (_pieChart) _pieChart.destroy();

  _pieChart = new Chart(ctx, {
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

/** 월별 수입 / 지출 트렌드 차트 */
function renderTrendChart(allMonthData) {
  const labels   = [];
  const incData  = [];
  const expData  = [];

  const now = new Date();
  const currentMonthNum = now.getMonth() + 1; // 1 ~ 12

  GACHANGI_CONFIG.MONTH_NAMES.forEach((m, idx) => {
    if (idx + 1 > currentMonthNum) return;
    const txs = allMonthData[m];
    if (!txs || txs.length === 0) return;
    labels.push(m);
    incData.push(txs.reduce((s, t) => s + t.inc, 0));
    expData.push(txs.reduce((s, t) => s + (t.cat === '투자/저축' ? 0 : t.exp), 0));
  });

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (_trendChart) _trendChart.destroy();

  _trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '수입',
          data: incData,
          backgroundColor: 'rgba(52, 211, 153, 0.7)',
          borderColor: '#34d399',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: '지출',
          data: expData,
          backgroundColor: 'rgba(248, 113, 113, 0.7)',
          borderColor: '#f87171',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const element = elements[0];
          const datasetIndex = element.datasetIndex; // 0 for '수입', 1 for '지출'
          const index = element.index;
          const monthName = _trendChart.data.labels[index];
          const type = datasetIndex === 0 ? 'income' : 'expense';
          _renderDashboardTrendDetailsTable(monthName, type);
        }
      },
      onHover: (event, elements) => {
        const canvas = event.chart?.canvas || document.getElementById('trend-chart');
        if (canvas) {
          canvas.style.cursor = elements && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e2e8f0', font: { family: "'Outfit', 'Noto Sans KR', sans-serif", size: 12 } },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatWon(ctx.raw)}` },
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
        },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: "'Outfit', 'Noto Sans KR', sans-serif" } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          ticks: {
            color: '#94a3b8',
            font: { family: "'Outfit', 'Noto Sans KR', sans-serif" },
            callback: v => formatWon(v),
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

/** 월별 수입 / 지출 트렌드 클릭 시 상세 내역 렌더링 */
function _renderDashboardTrendDetailsTable(monthName, type) {
  const card = document.getElementById('dashboard-trend-details-card');
  if (!card) return;

  const titleEl = document.getElementById('dashboard-trend-details-title');
  const typeText = type === 'income' ? '수입' : '지출';
  if (titleEl) {
    titleEl.textContent = `🔍 [${monthName} ${typeText}] 상세 거래 내역`;
  }

  const tbody = document.getElementById('dashboard-trend-details-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const monthTxs = _allMonthData[monthName] || [];
  const filtered = monthTxs.filter(tx => {
    if (type === 'income') {
      return tx.inc > 0;
    } else {
      return tx.exp > 0;
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${monthName}에 해당하는 ${typeText} 내역이 없습니다.</td></tr>`;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // 최신순 정렬 (rowIndex 내림차순)
  const sorted = [...filtered].sort((a, b) => b.rowIndex - a.rowIndex);

  sorted.forEach(tx => {
    const tr = document.createElement('tr');
    tr.className = tx.needsReview ? 'needs-review' : '';
    tr.innerHTML = `
      <td><span class="date-badge">${tx.date}</span></td>
      <td class="desc-cell" title="${tx.desc}">${tx.desc}</td>
      <td class="amount-cell inc">${tx.inc > 0 ? formatWon(tx.inc) : '-'}</td>
      <td class="${tx.cat === '투자/저축' ? 'amount-cell save' : 'amount-cell exp'}">
        ${tx.exp > 0 
          ? (tx.cat === '투자/저축' 
              ? `<span style="font-size: 11px; opacity: 0.8; margin-right: 4px;">(저축)</span>${formatWon(tx.exp)}` 
              : formatWon(tx.exp)) 
          : '-'}
      </td>
      <td><span class="cat-chip">${getCategoryEmoji(tx.cat)} ${tx.cat}</span></td>
      <td><span class="method-chip">${tx.method}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (titleEl) {
    titleEl.textContent = `🔍 [${monthName} ${typeText}] 상세 거래 내역 (${filtered.length}건)`;
  }

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth' });
}

/**
 * 가챙이 대시보드 - 메인 앱 진입점
 * 탭 라우팅, 데이터 로딩, 전체 초기화
 */

// ─── 전역 상태 ───────────────────────────────────────
let _currentMonth    = null;
let _transactions    = [];
let _allMonthData    = {};
let _isLoadingData   = false;

// ─── 유틸리티 ─────────────────────────────────────────
function formatWon(n) {
  if (!n || n === 0) return '0원';
  return Math.abs(n).toLocaleString('ko-KR') + '원';
}

function formatInputWithCommas(e) {
  const input = e.target;
  let value = input.value.replace(/[^0-9]/g, '');
  if (value) {
    input.value = parseInt(value, 10).toLocaleString('ko-KR');
  } else {
    input.value = '';
  }
}

function getCategoryEmoji(cat) {
  const map = {
    // 신규 통합 카테고리
    '생활비': '🛒',
    '교통/차량': '🚗',
    '주거/통신': '🏠',
    '보험': '🛡️',
    '의료/건강': '🏥',
    '여행/여가': '✈️',
    '육아': '🍼',
    '용돈': '💵',
    '기타': '📌',
    '투자/저축': '📈',
    '수입': '💰',
    '가족': '👨‍👩‍👧‍👦',
    
    // 하위 호환성 (과거 시트 데이터 대비)
    '식비': '🍽️',
    '자동차': '🚗',
    '교통': '🚌',
    '집': '🏠',
    '고정비': '📱',
    '잡비': '💸',
    '저축': '🏦',
    '이체': '↔️',
    '병원': '🏥',
    '여행': '✈️',
    '가족': '👨‍👩‍👧‍👦',
    '공금': '👥'
  };
  return map[cat] || '📌';
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// ─── 탭 네비게이션 ─────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      switchTab(tab);
      
      // 모바일 환경에서 메뉴 클릭 시 사이드바 자동 닫기
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove('active');
      }
    });
  });

  // 모바일 사이드바 토글 및 닫기 버튼 바인딩
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const closeBtn = document.getElementById('sidebar-close-btn');
  const sidebar = document.querySelector('.sidebar');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('active');
    });
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('active');
    });
  }
  
  // 모바일 환경에서 사이드바 바깥 영역 클릭 시 닫기
  window.addEventListener('click', (e) => {
    if (sidebar && sidebar.classList.contains('active') && window.innerWidth <= 768) {
      // 사이드바와 토글 버튼 영역 밖을 클릭한 경우 닫기
      if (!sidebar.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
        sidebar.classList.remove('active');
      }
    }
  });
}

function switchTab(tabId) {
  if (tabId === 'config') {
    if (typeof ConfigModal !== 'undefined') {
      ConfigModal.openModal();
    }
    return;
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  const panel   = document.getElementById(`tab-${tabId}`);
  if (navItem) navItem.classList.add('active');
  if (panel)   panel.classList.add('active');

  // 월 선택 박스 표시 여부 제어
  const selector = document.getElementById('month-selector');
  if (selector) {
    if (tabId === 'monthly-dashboard' || tabId === 'transactions' || tabId === 'fixed-expenses') {
      selector.style.display = 'block';
    } else {
      selector.style.display = 'none';
    }
  }

  // 탭별 렌더링
  if (tabId === 'dashboard') {
    renderDashboardTab();
  } else if (tabId === 'monthly-dashboard') {
    renderMonthlyDashboardTab();
  } else if (tabId === 'cat-expenses') {
    document.getElementById('page-title').textContent = '🍰 누적 지출 분석';
    renderCategoryExpensesTab();
  } else if (tabId === 'review') {
    document.getElementById('page-title').textContent = '🔍 검토 큐';
    renderReviewTab(_transactions, _currentMonth);
  } else if (tabId === 'transactions') {
    renderTransactionsTab(_transactions, _currentMonth);
  } else if (tabId === 'agent') {
    document.getElementById('page-title').textContent = '🤖 에이전트 관리';
    renderAgentTab();
  } else if (tabId === 'fixed-expenses') {
    document.getElementById('page-title').textContent = `📌 고정비 관리 (${_currentMonth})`;
    renderFixedExpensesTab(_transactions, _currentMonth);
  } else if (tabId === 'budget') {
    document.getElementById('page-title').textContent = '⚙️ 예산 설정';
    renderBudgetTab();
  } else if (tabId === 'cards-accounts') {
    document.getElementById('page-title').textContent = '💳 카드/계좌 관리';
    CardsAccounts.renderCardsAccountsTab();
  }
}

// ─── 월 선택 ───────────────────────────────────────────
function initMonthSelector() {
  const selector = document.getElementById('month-selector');
  selector.innerHTML = '';
  GACHANGI_CONFIG.MONTH_NAMES.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    selector.appendChild(opt);
  });

  // 이전 월 기본 선택 (sysdate 월 - 1)
  const now = new Date();
  let prevMonthNum = now.getMonth(); // 0 is Jan, 5 is June
  if (prevMonthNum === 0) {
    prevMonthNum = 12; // Jan -> Dec
  }
  const defaultMonthName = `${prevMonthNum}월`;
  selector.value = defaultMonthName;
  _currentMonth  = defaultMonthName;

  selector.addEventListener('change', async () => {
    _currentMonth = selector.value;
    await loadCurrentMonth();
  });
}

// ─── 데이터 로딩 ───────────────────────────────────────
async function loadCurrentMonth() {
  if (_isLoadingData || !_currentMonth) return;
  _isLoadingData = true;
  showLoading(true);

  try {
    _transactions = await SheetsAPI.loadMonthData(_currentMonth);
    _allMonthData[_currentMonth] = _transactions; // 전역 월별 데이터 캐시에 저장하여 중복 로드 방지

    // 검토 배지 업데이트
    const reviewCount = _transactions.filter(t => t.needsReview).length;
    const badge = document.getElementById('review-badge');
    if (badge) {
      badge.textContent = reviewCount;
      badge.style.display = reviewCount > 0 ? 'inline-flex' : 'none';
    }

    // 현재 탭 리렌더링
    const activeTab = document.querySelector('.tab-panel.active')?.id?.replace('tab-', '');
    if (activeTab) switchTab(activeTab);
    else switchTab('dashboard');
  } catch (err) {
    console.error('[데이터 로딩 실패]', err);
    showToast('❌ 데이터 로딩 실패: ' + err.message, 'error');
  } finally {
    _isLoadingData = false;
    showLoading(false);
  }
}

async function loadAllMonths() {
  const meta = SheetsAPI.getSheetMeta();
  const monthsInSheet = GACHANGI_CONFIG.MONTH_NAMES.filter(m => meta[m] !== undefined);

  for (const m of monthsInSheet) {
    try {
      if (!_allMonthData[m] || _allMonthData[m].length === 0) {
        _allMonthData[m] = await SheetsAPI.loadMonthData(m);
      }
    } catch (e) {
      _allMonthData[m] = [];
    }
  }
  // 트렌드 차트 업데이트
  renderTrendChart(_allMonthData);
}

// ─── 인증 후 앱 초기화 ─────────────────────────────────
async function initApp(userInfo) {
  if (typeof ConfigModal !== 'undefined' && !ConfigModal.hasValidConfig()) {
    alert('API 연동 설정 정보가 누락되어 초기화할 수 없습니다. 설정을 먼저 완료해 주세요.');
    ConfigModal.openModal();
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-layout').style.display   = 'flex';
  document.getElementById('user-name').textContent = userInfo?.name || '사용자';

  showLoading(true);
  try {
    await SheetsAPI.loadSpreadsheetMeta();
    // 예산을 구글 시트에서 로드해 캐시에 채움(대시보드 예산 바·진척이 기기 간 동일하게)
    if (typeof BudgetManager !== 'undefined' && BudgetManager.syncFromSheet) {
      try { await BudgetManager.syncFromSheet(); } catch (e) { console.warn('[Budget] 초기 예산 로드 실패:', e); }
    }
    initMonthSelector();
    initTransactionFilters();
    initAddForm(() => _currentMonth, loadCurrentMonth);
    initTabs();
    initMonthlyDashboardEvents();
    initCatExpensesEvents();

    await loadCurrentMonth();

    // 트렌드 차트는 백그라운드에서 로드 (느릴 수 있음)
    loadAllMonths().catch(console.warn);
  } catch (err) {
    console.error('[앱 초기화 실패]', err);
    showToast('❌ 초기화 실패. config.js를 확인해주세요.', 'error');
  } finally {
    showLoading(false);
  }
}

// ─── 로그아웃 ──────────────────────────────────────────
function handleLogout() {
  Auth.logout();
  document.getElementById('app-layout').style.display   = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  _transactions  = [];
  _allMonthData  = {};
  _currentMonth  = null;
}

// ─── 검색 & 필터 이벤트 (거래 내역 탭) ────────────────
function initFilterEvents() {
  ['filter-cat', 'filter-method', 'tx-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => renderTransactionsTab(_transactions, _currentMonth));
  });
}

// ─── 앱 부트스트랩 ─────────────────────────────────────
window.gapiLoaded = function () { Auth.initGapi(); };
window.gisLoaded  = function () { Auth.initGis(); };

window.addEventListener('DOMContentLoaded', () => {
  Auth.onLogin(initApp);
  Auth.onLogout(() => {});

  document.getElementById('login-btn').addEventListener('click', () => Auth.login());
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-btn').addEventListener('click', loadCurrentMonth);

  initFilterEvents();
});

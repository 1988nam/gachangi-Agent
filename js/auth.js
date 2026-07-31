/**
 * 가챙이 대시보드 - Google OAuth 2.0 인증 모듈 (브라우저 직접 연동 및 서버리스 형)
 * 백엔드 서버 없이 브라우저에서 직접 Google Identity Services(GIS) 팝업을 통해 Access Token을 획득하고 로컬에 캐시합니다.
 */

// ── XSS 방지: 전역 HTML 이스케이프 ───────────────────────────────
// 명세서(Gemini OCR)·구글시트 셀에서 온 내용(desc·분류·결제수단 등)을 innerHTML로
// 렌더링할 때 반드시 거쳐야 한다. 속성값(title="...", value="...") 안전을 위해
// 따옴표(" ')까지 이스케이프한다. (auth.js가 가장 먼저 로드되므로 여기 정의)
if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
}

const Auth = (() => {
  let accessToken = null;
  let tokenClient = null;
  let onLoginCallback = null;
  let onLogoutCallback = null;
  let gapiInited = false;
  let gisInited = false;
  let _refreshTimer = null;   // 만료 전 자동 갱신 타이머
  let _silentRefresh = false; // 무음 갱신 중 표시(재렌더 트리거 방지)

  // 액세스 토큰을 만료 5분 전 무음으로 재발급 예약 → 1시간 만료로 인한 401 방지
  function _scheduleTokenRefresh(expiryMs) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    const delay = Math.max(expiryMs - Date.now() - 5 * 60 * 1000, 20 * 1000);
    _refreshTimer = setTimeout(() => {
      if (!tokenClient) return;
      _silentRefresh = true;
      try { tokenClient.requestAccessToken({ prompt: '' }); }
      catch (e) { _silentRefresh = false; console.warn('[Auth] 토큰 자동 갱신 실패:', e); }
    }, delay);
  }

  /** GAPI 클라이언트 초기화 */
  async function initGapi() {
    const cfg = window.GACHANGI_CONFIG || {};
    if (!cfg.API_KEY || cfg.API_KEY.indexOf('YOUR_') === 0) {
      console.warn('[Auth] GACHANGI_CONFIG.API_KEY가 설정되지 않았습니다. API 초기화를 유예합니다.');
      return;
    }
    await new Promise((resolve) => gapi.load('client', resolve));
    await gapi.client.init({
      apiKey: cfg.API_KEY,
      discoveryDocs: [
        'https://sheets.googleapis.com/$discovery/rest?version=v4',
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
      ],
    });
    gapiInited = true;
    console.log('[Auth] GAPI 초기화 완료.');
    _tryLocalLogin();
  }

  /** Google Identity Services 초기화 (브라우저 팝업 인증 설정) */
  function initGis() {
    const cfg = window.GACHANGI_CONFIG || {};
    if (!cfg.CLIENT_ID || cfg.CLIENT_ID.indexOf('YOUR_') === 0) {
      console.warn('[Auth] GACHANGI_CONFIG.CLIENT_ID가 설정되지 않았습니다. GIS 초기화를 유예합니다.');
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.CLIENT_ID,
      scope: cfg.SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.error !== undefined) {
          _silentRefresh = false;
          console.warn('[Auth] 토큰 요청 오류:', tokenResponse.error);
          return;
        }

        accessToken = tokenResponse.access_token;
        const expiry = Date.now() + (tokenResponse.expires_in || 3600) * 1000;

        // 로컬 스토리지에 토큰 저장
        localStorage.setItem('gachangi_access_token', accessToken);
        localStorage.setItem('gachangi_token_expiry', expiry);

        // GAPI 클라이언트에 토큰 설정
        gapi.client.setToken({ access_token: accessToken });
        _scheduleTokenRefresh(expiry);

        if (_silentRefresh) {
          _silentRefresh = false;
          console.log('🔄 액세스 토큰 자동 갱신 완료.');
        } else {
          console.log('✅ 브라우저 직접 구글 로그인 완료.');
          if (onLoginCallback) {
            onLoginCallback({ name: '가챙이 사용자' });
          }
        }
      },
      // 팝업 차단·창 닫힘 등은 callback이 아니라 여기로 온다. 무음 갱신(타이머 컨텍스트)은
      // 사용자 제스처가 없어 팝업이 차단되기 쉬운데, 이때 _silentRefresh가 남으면 이후 수동
      // 재로그인까지 silent 분기로 새어 로그인 화면에 갇힌다 → 반드시 플래그를 푼다.
      error_callback: (err) => {
        const wasSilent = _silentRefresh;
        _silentRefresh = false;
        console.warn('[Auth] 토큰 요청 실패:', (err && (err.type || err.message)) || err);
        if (!wasSilent && typeof showToast === 'function') {
          showToast('❌ Google 로그인 창이 열리지 않았습니다. 팝업 차단을 확인해 주세요.', 'error');
        }
      },
    });
    
    gisInited = true;
    console.log('[Auth] GIS 초기화 완료.');
    _tryLocalLogin();
  }

  /** 로컬 스토리지에 저장된 토큰이 있는 경우 자동 로그인 시도 */
  function _tryLocalLogin() {
    if (!gapiInited || !gisInited) return;

    try {
      const storedToken = localStorage.getItem('gachangi_access_token');
      const expiry = localStorage.getItem('gachangi_token_expiry');

      if (storedToken && expiry && parseInt(expiry, 10) > Date.now()) {
        accessToken = storedToken;
        gapi.client.setToken({ access_token: accessToken });
        _scheduleTokenRefresh(parseInt(expiry, 10));
        console.log('✅ 로컬 스토리지 캐시 토큰으로 자동 로그인 성공.');
        
        if (onLoginCallback) {
          onLoginCallback({ name: '가챙이 사용자' });
        }
      } else {
        console.warn('⚠️ 유효한 로그인 정보가 존재하지 않습니다. 수동 로그인이 필요합니다.');
        // 만료된 정보 정리
        localStorage.removeItem('gachangi_access_token');
        localStorage.removeItem('gachangi_token_expiry');
      }
    } catch (e) {
      console.error('[Auth] 로컬 로그인 시도 에러:', e);
    }
  }

  /** 구글 로그인 창 호출 */
  function login() {
    if (tokenClient) {
      // 수동 로그인은 항상 로그인 콜백(initApp)을 타야 한다 — 무음 갱신 실패 잔여 플래그 해제.
      _silentRefresh = false;
      // prompt는 비워둔다('').
      // (버그수정) 과거 'consent'는 '이미 동의했더라도 매번 동의 화면을 다시 띄우라'는 강제 옵션이라,
      // 로그인할 때마다 미확인 앱 경고('확인하지 않은 앱' → 고급 → 이동)를 다시 통과해야 했다.
      // ''로 두면 이미 승인된 스코프는 동의 화면 없이 토큰만 재발급된다(최초 1회만 승인).
      // 아직 승인 전이거나 스코프가 늘어난 경우에는 구글이 알아서 동의 화면을 띄운다.
      tokenClient.requestAccessToken({ prompt: '' });
    } else {
      console.error('[Auth] GIS가 아직 초기화되지 않았습니다.');
    }
  }

  /** 로그아웃 — 로컬 세션만 정리한다.
   *  (버그수정) 과거엔 revokeToken으로 토큰을 폐기했는데, 구글의 revoke는 해당 토큰뿐 아니라
   *  '같은 승인(grant)으로 발급된 모든 토큰'을 무효화한다. 즉 앱 승인 자체가 취소돼,
   *  다음 로그인 때 동의 화면 + 미확인 앱 경고를 처음부터 다시 통과해야 했다.
   *  구글 계정에서 앱 연결을 완전히 끊으려면 계정 설정(myaccount.google.com/permissions)에서 해제한다. */
  function logout() {
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    accessToken = null;
    localStorage.removeItem('gachangi_access_token');
    localStorage.removeItem('gachangi_token_expiry');
    gapi.client.setToken(null);
    
    if (onLogoutCallback) {
      onLogoutCallback();
    }
  }

  /** 로그인 완료 콜백 등록 */
  function onLogin(cb) { 
    onLoginCallback = cb; 
    _tryLocalLogin();
  }

  /** 로그아웃 콜백 등록 */
  function onLogout(cb) { 
    onLogoutCallback = cb; 
  }

  /** 현재 로그인 상태 */
  function isLoggedIn() { 
    return !!accessToken; 
  }

  return { initGapi, initGis, login, logout, onLogin, onLogout, isLoggedIn };
})();

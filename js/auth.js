/**
 * 가챙이 대시보드 - Google OAuth 2.0 인증 모듈 (브라우저 직접 연동 및 서버리스 형)
 * 백엔드 서버 없이 브라우저에서 직접 Google Identity Services(GIS) 팝업을 통해 Access Token을 획득하고 로컬에 캐시합니다.
 */

const Auth = (() => {
  let accessToken = null;
  let tokenClient = null;
  let onLoginCallback = null;
  let onLogoutCallback = null;
  let gapiInited = false;
  let gisInited = false;

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
          console.error('[Auth] GIS 로그인 에러:', tokenResponse);
          throw tokenResponse;
        }
        
        accessToken = tokenResponse.access_token;
        const expiry = Date.now() + tokenResponse.expires_in * 1000;
        
        // 로컬 스토리지에 토큰 저장
        localStorage.setItem('gachangi_access_token', accessToken);
        localStorage.setItem('gachangi_token_expiry', expiry);
        
        // GAPI 클라이언트에 토큰 설정
        gapi.client.setToken({ access_token: accessToken });
        console.log('✅ 브라우저 직접 구글 로그인 완료.');
        
        if (onLoginCallback) {
          onLoginCallback({ name: '가챙이 사용자' });
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
      // 만료되지 않은 캐시 토큰이 없으므로 명시적으로 동의화면/로그인 창 띄움
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      console.error('[Auth] GIS가 아직 초기화되지 않았습니다.');
    }
  }

  /** 로그아웃 */
  function logout() {
    if (accessToken) {
      try {
        google.accounts.oauth2.revokeToken(accessToken, () => {
          console.log('[Auth] Google Access Token 폐기 성공.');
        });
      } catch (e) {
        console.warn('[Auth] 토큰 폐기 과정 예외 발생 (이미 유효기간 만료 등):', e);
      }
    }
    
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

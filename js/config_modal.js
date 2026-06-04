/**
 * 가챙이 대시보드 - API 연동 설정 모달 및 제어 로직
 * 민감한 API Key 정보들을 브라우저의 localStorage에 보존하고 불러올 수 있도록 제어합니다.
 */

const ConfigModal = (() => {
  
  function getStoredConfig() {
    try {
      const stored = localStorage.getItem('gachangi_config');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error('[Config] localStorage 로드 실패:', e);
      return {};
    }
  }

  function openModal() {
    const modal = document.getElementById('config-modal');
    if (!modal) return;

    // 현재 설정으로 입력 폼 채우기
    const cfg = GACHANGI_CONFIG || {};
    document.getElementById('cfg-client-id').value = cfg.CLIENT_ID || '';
    document.getElementById('cfg-api-key').value = cfg.API_KEY || '';
    document.getElementById('cfg-spreadsheet-id').value = cfg.SPREADSHEET_ID || '';
    document.getElementById('cfg-gemini-api-key').value = cfg.GEMINI_API_KEY || '';
    document.getElementById('cfg-source-folder-id').value = cfg.SOURCE_FOLDER_ID || '';
    document.getElementById('cfg-archive-folder-id').value = cfg.ARCHIVE_FOLDER_ID || '';
    document.getElementById('cfg-fail-folder-id').value = cfg.FAIL_FOLDER_ID || '';

    // Import/Export Area 초기화
    document.getElementById('cfg-import-export-area').value = '';

    modal.style.display = 'flex';
  }

  function closeModal() {
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'none';
  }

  function saveConfig(e) {
    if (e) e.preventDefault();

    const config = {
      CLIENT_ID: document.getElementById('cfg-client-id').value.trim(),
      API_KEY: document.getElementById('cfg-api-key').value.trim(),
      SPREADSHEET_ID: document.getElementById('cfg-spreadsheet-id').value.trim(),
      GEMINI_API_KEY: document.getElementById('cfg-gemini-api-key').value.trim(),
      SOURCE_FOLDER_ID: document.getElementById('cfg-source-folder-id').value.trim(),
      ARCHIVE_FOLDER_ID: document.getElementById('cfg-archive-folder-id').value.trim(),
      FAIL_FOLDER_ID: document.getElementById('cfg-fail-folder-id').value.trim(),
    };

    if (!config.CLIENT_ID || !config.API_KEY || !config.SPREADSHEET_ID || !config.GEMINI_API_KEY) {
      alert('⚠️ 필수 항목(*)을 모두 입력해 주세요.');
      return;
    }

    try {
      localStorage.setItem('gachangi_config', JSON.stringify(config));
      alert('💾 설정이 저장되었습니다. 설정을 반영하기 위해 페이지를 새로고침합니다.');
      window.location.reload();
    } catch (err) {
      alert('❌ 설정 저장 중 오류가 발생했습니다: ' + err.message);
    }
  }

  // 설정을 한 줄 텍스트(Base64)로 암호화/인코딩하여 공유하기 쉽게 만듦
  function exportConfig() {
    const config = {
      CLIENT_ID: document.getElementById('cfg-client-id').value.trim(),
      API_KEY: document.getElementById('cfg-api-key').value.trim(),
      SPREADSHEET_ID: document.getElementById('cfg-spreadsheet-id').value.trim(),
      GEMINI_API_KEY: document.getElementById('cfg-gemini-api-key').value.trim(),
      SOURCE_FOLDER_ID: document.getElementById('cfg-source-folder-id').value.trim(),
      ARCHIVE_FOLDER_ID: document.getElementById('cfg-archive-folder-id').value.trim(),
      FAIL_FOLDER_ID: document.getElementById('cfg-fail-folder-id').value.trim(),
    };

    try {
      const jsonStr = JSON.stringify(config);
      const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
      
      const area = document.getElementById('cfg-import-export-area');
      area.value = encoded;
      area.select();
      
      navigator.clipboard.writeText(encoded).then(() => {
        alert('📤 설정이 암호화되어 클립보드에 복사되었습니다! 다른 기기의 설정창에 붙여넣기 하세요.');
      }).catch(err => {
        alert('📤 클립보드 복사에 실패했습니다. 텍스트 박스의 텍스트를 수동으로 복사하세요.');
      });
    } catch (err) {
      alert('❌ 설정 내보내기 실패: ' + err.message);
    }
  }

  function importConfig() {
    const area = document.getElementById('cfg-import-export-area');
    const rawVal = area.value.trim();

    if (!rawVal) {
      alert('⚠️ 가져올 설정 코드를 먼저 붙여넣어 주세요.');
      return;
    }

    try {
      let jsonStr = '';
      if (rawVal.startsWith('{')) {
        jsonStr = rawVal;
      } else {
        jsonStr = decodeURIComponent(escape(atob(rawVal)));
      }

      const parsed = JSON.parse(jsonStr);
      
      if (parsed.CLIENT_ID !== undefined) document.getElementById('cfg-client-id').value = parsed.CLIENT_ID;
      if (parsed.API_KEY !== undefined) document.getElementById('cfg-api-key').value = parsed.API_KEY;
      if (parsed.SPREADSHEET_ID !== undefined) document.getElementById('cfg-spreadsheet-id').value = parsed.SPREADSHEET_ID;
      if (parsed.GEMINI_API_KEY !== undefined) document.getElementById('cfg-gemini-api-key').value = parsed.GEMINI_API_KEY;
      if (parsed.SOURCE_FOLDER_ID !== undefined) document.getElementById('cfg-source-folder-id').value = parsed.SOURCE_FOLDER_ID;
      if (parsed.ARCHIVE_FOLDER_ID !== undefined) document.getElementById('cfg-archive-folder-id').value = parsed.ARCHIVE_FOLDER_ID;
      if (parsed.FAIL_FOLDER_ID !== undefined) document.getElementById('cfg-fail-folder-id').value = parsed.FAIL_FOLDER_ID;

      alert('📥 설정 코드가 정상적으로 분석되어 폼에 반영되었습니다. [설정 저장 및 새로고침] 버튼을 눌러 적용을 완료하세요.');
    } catch (err) {
      alert('❌ 설정 분석 실패. 코드가 올바른지 확인해 주세요: ' + err.message);
    }
  }

  function hasValidConfig() {
    const cfg = GACHANGI_CONFIG || {};
    return !!(cfg.CLIENT_ID && cfg.API_KEY && cfg.SPREADSHEET_ID && cfg.GEMINI_API_KEY && 
              cfg.CLIENT_ID.indexOf('YOUR_') !== 0 && cfg.API_KEY.indexOf('YOUR_') !== 0);
  }

  function init() {
    // 이벤트 바인딩
    const openLoginBtn = document.getElementById('open-config-login-btn');
    if (openLoginBtn) openLoginBtn.addEventListener('click', openModal);

    const closeBtn = document.getElementById('config-modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const form = document.getElementById('config-form');
    if (form) form.addEventListener('submit', saveConfig);

    const exportBtn = document.getElementById('cfg-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportConfig);

    const importBtn = document.getElementById('cfg-import-btn');
    if (importBtn) importBtn.addEventListener('click', importConfig);

    // 로그인 버튼 인터셉터
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', (e) => {
        if (!hasValidConfig()) {
          e.preventDefault();
          e.stopPropagation();
          alert('⚙️ 구글 및 Gemini API 연동 설정이 되어 있지 않습니다. 먼저 설정 창을 열어 API Key와 클라이언트 ID 정보를 입력해 주세요.');
          openModal();
        }
      }, true); // capture phase to intercept
    }
  }

  return {
    init,
    openModal,
    closeModal,
    hasValidConfig
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  ConfigModal.init();
});

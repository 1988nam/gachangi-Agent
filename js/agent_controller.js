/**
 * 가챙이 대시보드 - 에이전트 실시간 관제 컨트롤러 (브라우저 단독 실행형)
 */

const _consoleElId = 'agent-console';

function renderAgentTab() {
  const isWorker = !!(GACHANGI_CONFIG.AGENT_WORKER_URL || '').trim();
  _writeConsoleLog(`[대시보드] 에이전트 관제 화면으로 전환되었습니다. (실행 모드: ${isWorker ? '무인 Worker' : '브라우저 로컬'})`);
  _updateConnectionStatus();
  // 무인 모드면 그동안 Worker가 처리한 이력을 자동으로 불러와 표시
  if (isWorker) loadWorkerLogs();
}

function _writeConsoleLog(msg) {
  const consoleEl = document.getElementById(_consoleElId);
  if (!consoleEl) return;

  // 초기 대기 메시지 지우기
  if (consoleEl.textContent.trim().startsWith('[대시보드] 에이전트 콘솔 대기 중...')) {
    consoleEl.textContent = '';
  }

  const time = new Date().toLocaleTimeString('ko-KR');
  consoleEl.textContent += `[${time}] ${msg}\n`;
  consoleEl.scrollTop = consoleEl.scrollHeight; // 항상 하단 스크롤
}

function _updateConnectionStatus() {
  const connStatusEl = document.getElementById('agent-conn-status');
  if (!connStatusEl) return;

  if (typeof gapi !== 'undefined' && gapi.client && Auth && Auth.isLoggedIn()) {
    connStatusEl.textContent = '🟢 API 연동 완료';
    connStatusEl.style.color = 'var(--color-success)';
  } else {
    connStatusEl.textContent = '🔴 로그아웃 상태';
    connStatusEl.style.color = 'var(--color-danger)';
  }
}

// ─── 코어 에이전트 실행 로직 ───────────────────────────────────────
async function runAgentSync() {
  if (!Auth.isLoggedIn()) {
    _writeConsoleLog('❌ 에러: Google 로그인이 되어있지 않습니다. 먼저 로그인해 주세요.');
    showToast('⚠️ Google 로그인이 필요합니다.', 'warning');
    return;
  }

  if (!GACHANGI_CONFIG.GEMINI_API_KEY) {
    _writeConsoleLog('❌ 에러: js/config.js에 GEMINI_API_KEY가 설정되어 있지 않습니다.');
    showToast('⚠️ Gemini API 키를 확인해 주세요.', 'warning');
    return;
  }

  _writeConsoleLog('🔍 [에이전트] 구글 드라이브 감시(수집 폴더 스캔) 시작...');
  const triggerBtn = document.getElementById('agent-trigger-btn');
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = '⚡ 스캔 및 분석 중...';
  }

  let processedCount = 0;
  let failedCount = 0;
  let totalParsedCount = 0;
  let totalAddedCount = 0;
  let totalSkippedCount = 0;

  try {
    if (!gapi.client.drive) {
      throw new Error("Google Drive API가 로드되지 않았습니다. Google Cloud Console에서 Drive API가 활성화되어 있는지 확인해 주세요.");
    }
    // 1. 드롭다운 카테고리 실시간 동기화
    let validCategories = SheetsAPI.getCategories() || [];
    let validMethods = SheetsAPI.getMethods() || [];
    _writeConsoleLog(`📊 시트 카테고리 동기화 완료: ${validCategories.join(', ')}`);

    // 2. 신규 감지 파일 검색 (SOURCE_FOLDER_ID)
    const listRes = await gapi.client.drive.files.list({
      q: `'${GACHANGI_CONFIG.SOURCE_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
    });
    const files = listRes.result.files || [];

    if (files.length === 0) {
      _writeConsoleLog('📭 처리할 신규 파일이 없습니다.');
      showToast('📭 신규 파일이 없습니다.');
      return;
    }

    _writeConsoleLog(`📂 감지된 파일 수: ${files.length}개`);

    // 월별 기존 데이터 캐시용 객체 (동일 실행 주기 내 API 중복 호출 방지 및 방금 추가된 건 반영용)
    const sheetDataCache = {};

    for (const file of files) {
      _writeConsoleLog(`▶️ 파일 분석 처리 시작: ${file.name} (${file.mimeType})`);
      try {
        // 3. 파일 다운로드 및 타입 판별 (OAuth Access Token 헤더 사용)
        const token = gapi.client.getToken().access_token;
        const fileUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
        
        _writeConsoleLog(`📥 파일 다운로드 중...`);
        const fileResponse = await fetch(fileUrl, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (!fileResponse.ok) {
          throw new Error(`파일 다운로드 실패 (상태 코드: ${fileResponse.status})`);
        }

        // HTML, TXT 등의 텍스트 파일은 텍스트로 읽고, 나머지는 바이너리(Base64)로 처리
        const isText = file.mimeType === 'text/html' || 
                       file.mimeType === 'text/plain' || 
                       file.name.endsWith('.html') || 
                       file.name.endsWith('.txt');

        let fileBase64 = '';
        let textContent = '';
        let decodedText = '';
        let beforeLength = 0;
        let cleanResult = { text: '', type: 'raw' };

        if (isText) {
          _writeConsoleLog(`📄 텍스트 형식 파일 감지 (${file.mimeType})`);
          
          // EUC-KR 등 다양한 인코딩 대응을 위해 ArrayBuffer로 다운로드하여 처리
          const arrayBuffer = await fileResponse.arrayBuffer();
          
          // 1. 기본 UTF-8 디코딩 시도
          let decoder = new TextDecoder('utf-8');
          decodedText = decoder.decode(arrayBuffer);
          
          // 2. 문서 내 EUC-KR charset 감지 시 EUC-KR로 재디코딩
          const lowerText = decodedText.toLowerCase();
          if (lowerText.includes('charset=euc-kr') || lowerText.includes('charset="euc-kr"')) {
            _writeConsoleLog(`⚠️ EUC-KR 인코딩 감지. EUC-KR 디코더를 적용합니다.`);
            decoder = new TextDecoder('euc-kr');
            decodedText = decoder.decode(arrayBuffer);
          }
          
          // 3. 현대카드 등 명세서의 전각 문자(Fullwidth) 난독화 디코딩 적용
          // 전각 문자 범위 [\uFF01-\uFF5E] (예: 'ڽ Ʈڸ' 처럼 깨져 보이는 것들) => 반각 변환
          // 전각 공백 \u3000 => 일반 공백 변환
          decodedText = decodedText.replace(/[\uFF01-\uFF5E]/g, (ch) => {
            return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
          });
          decodedText = decodedText.replace(/\u3000/g, ' ');
          
          // 4. HTML 명세서인 경우 1차로 거래 테이블 영역만 필터링하여 압축 정제 시도
          cleanResult = { text: decodedText, type: 'raw' };
          if (file.mimeType === 'text/html' || file.name.endsWith('.html')) {
            _writeConsoleLog(`🧹 HTML 명세서 스마트 테이블 필터링 적용 중...`);
            beforeLength = decodedText.length;
            cleanResult = cleanHtmlContent(decodedText, false);
            _writeConsoleLog(`🧹 HTML 정제 완료 [${cleanResult.type}]: 문자 수 ${beforeLength}자 ➡️ ${cleanResult.text.length}자 (약 ${Math.round((beforeLength - cleanResult.text.length) / beforeLength * 100)}% 감소)`);
          } else {
            cleanResult = { text: decodedText, type: 'text' };
          }
          textContent = cleanResult.text;
        } else {
          const arrayBuffer = await fileResponse.arrayBuffer();
          fileBase64 = arrayBufferToBase64(arrayBuffer);
        }

        // 4. Gemini 구조화 분석 수행 (Structured Outputs)
        _writeConsoleLog(`🧠 Gemini 분석 중... (Structured Outputs)`);
        const parsePrompt = buildPromptForSource(file.mimeType, file.name);
        
        let parsedResult = null;
        try {
          parsedResult = await performGeminiParse(parsePrompt, isText, textContent, fileBase64, file.mimeType);
          
          // 테이블 필터링 모드였는데 거래 내역이 0건이 나온 경우, 방어 로직으로 전체 폴백 모드로 재시도 유도
          if (isText && cleanResult.type === 'table_filtered' && (!parsedResult.transactions || parsedResult.transactions.length === 0)) {
            throw new Error('테이블 필터링 분석 결과 거래 내역이 검출되지 않았습니다.');
          }
        } catch (firstErr) {
          if (isText && cleanResult.type === 'table_filtered') {
            _writeConsoleLog(`⚠️ 1차 테이블 필터링 분석 실패 또는 내역 없음. 전체 본문으로 2차 폴백 분석 시도합니다... (사유: ${firstErr.message})`);
            try {
              const fallbackResult = cleanHtmlContent(decodedText, true);
              _writeConsoleLog(`🧹 HTML 전체 본문 정제 완료: 문자 수 ${beforeLength}자 ➡️ ${fallbackResult.text.length}자 (약 ${Math.round((beforeLength - fallbackResult.text.length) / beforeLength * 100)}% 감소)`);
              
              parsedResult = await performGeminiParse(parsePrompt, isText, fallbackResult.text, fileBase64, file.mimeType);
            } catch (secondErr) {
              throw new Error(`2차 폴백 분석도 실패하였습니다: ${secondErr.message}`);
            }
          } else {
            throw firstErr;
          }
        }

        const transactions = parsedResult.transactions || [];
        let newFileName = (parsedResult.recommendedFileName || '').trim();

        if (!Array.isArray(transactions) || transactions.length === 0) {
          throw new Error('Gemini 분석 결과에 거래 내역(transactions) 배열이 없거나 비어 있습니다.');
        }

        // 파일명 정제 및 원본 확장자 보존
        if (!newFileName) {
          newFileName = file.name;
        } else {
          // 특수문자 정합성 정리 및 확장자 보존
          newFileName = newFileName.replace(/[\\\/\:\*\?\"\<\>\|]/g, '_'); // Windows 파일명 금지 문자 치환
          const originalExt = file.name.substring(file.name.lastIndexOf('.'));
          if (!newFileName.toLowerCase().endsWith(originalExt.toLowerCase())) {
            newFileName += originalExt;
          }
        }

        _writeConsoleLog(`🏷️ [파일명 분석 완료] "${file.name}" ➡️ "${newFileName}"`);
        _writeConsoleLog(`✅ Gemini 분석 완료: ${transactions.length}건 추출됨`);
        totalParsedCount += transactions.length;

        // 5. 카테고리 자가 교정 및 결제수단 매핑 후 시트 기록 (월별 그룹화하여 일괄 쓰기)
        const pendingWrites = {};

        for (const item of transactions) {
          item.cat = SheetsAPI.normalizeCategory(item.cat, item.desc);
          item.method = selfHealMethod(item.method, validMethods, file.name, isText ? textContent : '');

          // 날짜 포맷 표준화 및 월 추출 (예: "2026-06-03" -> "06/03")
          let normalizedDate = (item.date || '').trim();
          const dateMatch = normalizedDate.match(/^(?:\d{4}[-\/])?(\d{1,2})[-\/](\d{1,2})/);
          if (dateMatch) {
            const mm = dateMatch[1].padStart(2, '0');
            const dd = dateMatch[2].padStart(2, '0');
            normalizedDate = `${mm}/${dd}`;
            item.date = normalizedDate;
          }
          
          let monthNum = normalizedDate.split('/')[0].replace(/^0/, '');
          let parsedMonth = parseInt(monthNum, 10);
          
          // 월이 유효하지 않으면 시스템 현재 월로 폴백 방어
          if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
            parsedMonth = new Date().getMonth() + 1;
            monthNum = String(parsedMonth);
            item.date = `${monthNum.padStart(2, '0')}/01`;
          }
          const sheetName = monthNum + '월';

          // 해당 월 기존 데이터 캐시 로드
          if (!sheetDataCache[sheetName]) {
            _writeConsoleLog(`🔍 [중복 체크] ${sheetName} 시트 기존 데이터 불러오는 중...`);
            try {
              sheetDataCache[sheetName] = await SheetsAPI.loadMonthData(sheetName);
            } catch (e) {
              _writeConsoleLog(`⚠️ ${sheetName} 시트 데이터 로드 실패 (신규 월로 판단): ${e.message}`);
              sheetDataCache[sheetName] = [];
            }
          }

          // 중복 여부 판단 (날짜, 금액이 같고 내용이 상호 포함/일치하는 경우)
          const isDuplicate = sheetDataCache[sheetName].some(existing => {
            const incMatch = Number(existing.inc) === Number(item.inc);
            const expMatch = Number(existing.exp) === Number(item.exp);
            
            const existingDesc = (existing.desc || '').trim();
            const itemDesc = (item.desc || '').trim();
            // 빈 문자열은 모든 문자열에 includes()되므로, 한쪽이 비어 있으면 부분일치를 적용하지 않는다.
            // (과거 버그: 내용이 빈 정상 거래가 금액·날짜만 같으면 무조건 중복으로 판정되어 누락)
            const descMatch =
              existingDesc === itemDesc ||
              (existingDesc !== '' && itemDesc !== '' &&
                (existingDesc.includes(itemDesc) || itemDesc.includes(existingDesc)));

            // 기존 내역이 고정비(isFixed)인 경우 날짜와 상관없이 같은 달 내의 동일한 명칭/금액은 중복으로 판별해 이중 지출 기입 방지
            const dateMatch = existing.isFixed ? true : (existing.date === item.date);

            return dateMatch && incMatch && expMatch && descMatch;
          });

          if (isDuplicate) {
            _writeConsoleLog(`⚠️ [중복 건 건너뜀] 이미 기록된 내역 감지: [${item.date}] ${item.desc} (${item.inc || item.exp}원)`);
            totalSkippedCount++;
            continue;
          }

          if (!pendingWrites[sheetName]) {
            pendingWrites[sheetName] = [];
          }
          pendingWrites[sheetName].push(item);
        }

        // 월별 일괄 기록 실행
        for (const sheetName of Object.keys(pendingWrites)) {
          const groupItems = pendingWrites[sheetName];
          if (groupItems.length === 0) continue;

          _writeConsoleLog(`💾 스프레드시트 일괄 기록 중 [${sheetName}]: 총 ${groupItems.length}건...`);
          
          // API 일괄 등록 호출
          const refreshed = await SheetsAPI.addTransactionsBatch(sheetName, groupItems);
          totalAddedCount += groupItems.length;

          // 세션 롤백용 로그 기록 (새로 추가된 행 번호들 역산)
          const startIndex = refreshed.length - groupItems.length;
          for (let k = 0; k < groupItems.length; k++) {
            const tx = refreshed[startIndex + k];
            if (tx && tx.rowIndex) {
              saveSessionRow(sheetName, tx.rowIndex);
            }
          }

          // 메모리 캐시 갱신
          sheetDataCache[sheetName] = refreshed;
        }

        _writeConsoleLog(`✅ 스프레드시트 기록 완료`);

        // 6. 성공 폴더로 이동 및 구글 드라이브 파일명 변경 (SOURCE -> ARCHIVE)
        _writeConsoleLog(`🚀 파일 보관함 이동 및 이름 변경 중 ("${newFileName}")...`);
        await gapi.client.drive.files.update({
          fileId: file.id,
          addParents: GACHANGI_CONFIG.ARCHIVE_FOLDER_ID,
          removeParents: GACHANGI_CONFIG.SOURCE_FOLDER_ID,
          resource: {
            name: newFileName
          },
          fields: 'id, parents, name',
        });
        _writeConsoleLog(`🚀 파일 보관함 이동 및 이름 변경 완료: ${newFileName}`);
        processedCount++;

      } catch (err) {
        _writeConsoleLog(`❌ 파일 처리 오류 (${file.name}): ` + err.message);
        failedCount++;

        // 오류 상세 분석하여 일시적인 오류인지 검사
        const errStr = (err.message || '').toLowerCase();
        const isTemporaryError = errStr.includes('quota') || 
                                 errStr.includes('rate limit') || 
                                 errStr.includes('too many requests') || 
                                 errStr.includes('429') || 
                                 errStr.includes('503') || 
                                 errStr.includes('500') || 
                                 errStr.includes('fetch') || 
                                 errStr.includes('network') || 
                                 errStr.includes('timeout') || 
                                 errStr.includes('최대 재시도') || 
                                 errStr.includes('재시도 횟수 초과') || 
                                 errStr.includes('응답하지 않습니다') || 
                                 errStr.includes('gemini') || 
                                 errStr.includes('로컬 거래 데이터 요청 실패') || 
                                 errStr.includes('로컬 거래 추가 실패') || 
                                 errStr.includes('로컬 거래 일괄 추가 실패');

        if (isTemporaryError) {
          _writeConsoleLog(`⚠️ [일시적 오류 감지] 일시적인 구글 API 제한 또는 네트워크 오류입니다. 파일을 격리하지 않고 수집 폴더에 유지하여 다음 실행 시 재시도합니다.`);
        } else {
          try {
            // 영구적인 오류일 때만 실패 폴더로 격리 이동 (SOURCE -> FAIL)
            _writeConsoleLog(`⚠️ 오류 파일을 실패 보관함으로 격리 이동 중...`);
            await gapi.client.drive.files.update({
              fileId: file.id,
              addParents: GACHANGI_CONFIG.FAIL_FOLDER_ID,
              removeParents: GACHANGI_CONFIG.SOURCE_FOLDER_ID,
              fields: 'id, parents',
            });
            _writeConsoleLog(`⚠️ 오류 파일 실패 보관함으로 격리 이동 완료: ${file.name}`);
          } catch (moveErr) {
            _writeConsoleLog(`❌ 실패 파일 이동 오류: ` + moveErr.message);
          }
        }
      }
    }

    _writeConsoleLog(`🏁 에이전트 동기화 작업 종료. 파일 성공: ${processedCount}개 / 실패: ${failedCount}개`);
    _writeConsoleLog(`📊 세부 내역 요약 - 총 추출: ${totalParsedCount}건 | 추가: ${totalAddedCount}건 | 중복 건너뜀: ${totalSkippedCount}건`);
    showToast(`🏁 동기화 완료!\n- 파일 (성공: ${processedCount}개, 실패: ${failedCount}개)\n- 내역 (추가: ${totalAddedCount}건, 건너뜀: ${totalSkippedCount}건)`);
    
    // 실패한 파일이 존재할 경우 최종적으로 로컬 서버에 1회만 로그를 영구 저장
    if (failedCount > 0) {
      await saveLogToServer();
    }
    
    // 데이터 새로고침
    if (window.loadCurrentMonth) {
      await loadCurrentMonth();
    }

  } catch (err) {
    let errMsg = err.message;
    if (err.result && err.result.error && err.result.error.message) {
      errMsg = err.result.error.message;
    } else if (err.result && err.result.error && typeof err.result.error === 'string') {
      errMsg = err.result.error;
    } else if (typeof err === 'string') {
      errMsg = err;
    } else if (!errMsg) {
      errMsg = JSON.stringify(err);
    }
    _writeConsoleLog('❌ 에이전트 스캔 실패: ' + errMsg);
    showToast('❌ 에이전트 실행 실패', 'error');
    await saveLogToServer();
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = '⚡ 즉시 동기화 실행';
    }
  }
}

// ─── 유틸리티 헬퍼 함수들 ─────────────────────────────────────────

// Gemini API 호출 재시도 함수 (혼잡 에러 503 및 429 회피용)
async function fetchGeminiWithRetry(url, options, maxRetries = 5) {
  let delay = 3000; // 초기 대기 시간: 3초
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;

      // 503(혼잡) 또는 429(할당량 초과/Rate limit) 에러 발생 시 재시도
      if (res.status === 503 || res.status === 429) {
        const attempt = i + 1;
        _writeConsoleLog(`⚠️ Gemini API 서비스가 일시적으로 혼잡합니다 (상태 코드: ${res.status}). ${delay / 1000}초 후 자동 재시도합니다... (시도 ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // 지수 백오프 적용 (3s -> 6s -> 12s -> 24s -> 48s)
        continue;
      }

      // 400 Bad Request 등 다른 에러는 즉시 반환하여 상위에서 에러로 잡히도록 처리
      return res;
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      _writeConsoleLog(`⚠️ 네트워크 에러 발생. ${delay / 1000}초 후 재시도합니다...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error(`Gemini API가 계속해서 응답하지 않습니다 (최대 재시도 횟수 초과).`);
}

// HTML에서 스타일, 스크립트, 마크업 등을 정밀 정제하여 텍스트만 조밀하게 추출
function cleanHtmlContent(htmlStr, forceFallback = false) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');
    
    // script 태그에서 거래 데이터(arUseDesc, UseDesc 등) 추출 시도
    let scriptData = '';
    try {
      const scripts = doc.querySelectorAll('script');
      const extractedLines = [];
      scripts.forEach(script => {
        const scriptContent = script.textContent || '';
        if (scriptContent.includes('UseDesc') || scriptContent.includes('arUseDesc')) {
          const lines = scriptContent.split('\n');
          lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.includes('new UseDesc') || trimmed.includes('new UseDesc1') || trimmed.includes('arUseDesc[')) {
              extractedLines.push(trimmed);
            }
          });
        }
      });
      if (extractedLines.length > 0) {
        scriptData = '\n\n[Script Data (Transactions)]\n' + extractedLines.join('\n');
      }
    } catch (e) {
      console.warn('Script 데이터 추출 중 오류:', e);
    }
    
    if (!forceFallback) {
      // 1. 거래 내역 테이블 매칭 시도
      const tables = doc.querySelectorAll('table');
      let matchedTablesText = '';
      
      // 거래 내역 테이블을 판별하기 위한 핵심 컬럼 키워드군
      const dateKeywords = ['이용일자', '사용일자', '거래일자', '일자', '승인일자', '승인일'];
      const descKeywords = ['이용가맹점', '가맹점명', '가맹점', '내역', '적요', '이용처', '사용처', '사용내역'];
      const amountKeywords = ['이용금액', '사용금액', '금액', '원금', '지출', '청구금액', '결제금액', '승인금액'];

      tables.forEach(table => {
        const tableText = table.textContent || '';
        
        // 날짜, 가맹점, 금액을 나타내는 단어가 각각 최소 하나씩 테이블 텍스트 내에 포함되어 있는지 검사
        const hasDate = dateKeywords.some(kw => tableText.includes(kw));
        const hasDesc = descKeywords.some(kw => tableText.includes(kw));
        const hasAmount = amountKeywords.some(kw => tableText.includes(kw));
        
        if (hasDate && hasDesc && hasAmount) {
          matchedTablesText += (table.innerText || table.textContent || '') + '\n\n';
        }
      });

      // 매칭되는 거래 테이블이 발견되었다면 이 테이블 텍스트만 전송!
      if (matchedTablesText.trim().length > 0) {
        let text = matchedTablesText;
        text = text.replace(/[ \t]+/g, ' ');
        text = text.split('\n')
                   .map(line => line.trim())
                   .filter(line => line.length > 0)
                   .join('\n');
        return { text: text + scriptData, type: 'table_filtered' };
      }
    }

    // 2. 전체 본문 정제 방식 (폴백 또는 테이블 매칭 실패 시)
    const removeSelectors = ['script', 'style', 'noscript', 'svg', 'iframe', 'link', 'meta', 'head'];
    removeSelectors.forEach(selector => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    const container = doc.body || doc.documentElement;
    let text = container.innerText || container.textContent || '';
    
    text = text.replace(/[ \t]+/g, ' ');
    text = text.split('\n')
               .map(line => line.trim())
               .filter(line => line.length > 0)
               .join('\n');
               
    return { text: text + scriptData, type: 'full_fallback' };
  } catch (e) {
    console.error('HTML 정제 오류, 대체 정규식 파싱 적용:', e);
    // 폴백: 정규식으로 최소한의 태그와 공백 정리
    let text = htmlStr
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ');
    
    text = text.split('\n')
               .map(line => line.trim())
               .filter(line => line.length > 0)
               .join('\n');
    return { text: text + (typeof scriptData !== 'undefined' ? scriptData : ''), type: 'regex_fallback' };
  }
}

// Gemini API 구조화 분석 수행 헬퍼 함수
async function performGeminiParse(parsePrompt, isText, targetText, fileBase64, fileMimeType) {
  const contentsParts = [];
  if (isText) {
    contentsParts.push({
      text: `${parsePrompt}\n\n[분석 대상 고지서/명세서 본문내용]\n${targetText}`
    });
  } else {
    contentsParts.push({ text: parsePrompt });
    contentsParts.push({
      inlineData: {
        mimeType: fileMimeType,
        data: fileBase64
      }
    });
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GACHANGI_CONFIG.GEMINI_API_KEY}`;
  const geminiRes = await fetchGeminiWithRetry(geminiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: contentsParts
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            recommendedFileName: {
              type: 'string',
              description: '추출된 내용을 분석하여 지은 직관적이고 표준화된 파일명 (확장자 제외, 예: "현대카드_05월_명세서", "우리은행_계좌출금_0603", "카카오페이_이체내역_0525")'
            },
            transactions: {
              type: 'array',
              description: '추출된 거래 항목 배열',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', description: '날짜 (MM/DD)' },
                  desc: { type: 'string', description: '가맹점/사용내용' },
                  inc: { type: 'integer', description: '수입 금액 (없으면 0)' },
                  exp: { type: 'integer', description: '지출/투자 금액 (없으면 0)' },
                  cat: { type: 'string', description: '카테고리' },
                  method: { type: 'string', description: '결제수단' }
                },
                required: ['date', 'desc', 'inc', 'exp', 'cat', 'method']
              }
            }
          },
          required: ['recommendedFileName', 'transactions']
        }
      }
    })
  });

  if (!geminiRes.ok) {
    const errDetail = await geminiRes.text();
    throw new Error(`Gemini API 호출 실패: ${errDetail}`);
  }

  const geminiJson = await geminiRes.json();
  const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!rawText) {
    throw new Error('Gemini로부터 분석 응답을 받지 못했습니다.');
  }

  let cleanedText = rawText.trim();
  if (cleanedText.startsWith('```json')) cleanedText = cleanedText.substring(7);
  else if (cleanedText.startsWith('```')) cleanedText = cleanedText.substring(3);
  if (cleanedText.endsWith('```')) cleanedText = cleanedText.substring(0, cleanedText.length - 3);
  cleanedText = cleanedText.trim();

  const parsedResult = JSON.parse(cleanedText);
  if (!parsedResult || typeof parsedResult !== 'object') {
    throw new Error('Gemini 분석 결과가 올바른 객체 형식이 아닙니다.');
  }

  return parsedResult;
}

// ArrayBuffer -> Base64 변환
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}



// 결제수단 자가 교정 및 파일명/콘텐츠 기반 매핑 알고리즘
function selfHealMethod(method, validMethods, fileName, fileContent) {
  const lowerFile = (fileName || '').toLowerCase();
  const lowerContent = (fileContent || '').toLowerCase();
  
  // 1. 파일명 기반 1차 매핑 (가장 강력한 힌트)
  if (lowerFile.includes('현대') || lowerFile.includes('hyundai')) return '현대카드';
  if (lowerFile.includes('신한') || lowerFile.includes('shinhan')) return '신한카드';
  if (lowerFile.includes('하나') || lowerFile.includes('hana')) return '하나카드';
  if (lowerFile.includes('우리') || lowerFile.includes('woori')) return '우리은행';
  if (lowerFile.includes('카카오') || lowerFile.includes('카뱅') || lowerFile.includes('kakao')) return '카카오뱅크';
  if (lowerFile.includes('혜영')) return '혜영카드';
  if (lowerFile.includes('costco') || lowerFile.includes('코스트코')) return '현대카드';

  // 2. 파일 본문 내용 기반의 2차 매핑 (명세서/이체화면 발행기관 감지)
  if (lowerContent.includes('현대카드') || lowerContent.includes('hyundai card') ||
      lowerContent.includes('hyundaicard') || lowerContent.includes('코스트코') ||
      lowerContent.includes('costco')) return '현대카드';
  if (lowerContent.includes('신한카드') || lowerContent.includes('shinhan card') ||
      lowerContent.includes('shinhancard')) return '신한카드';
  if (lowerContent.includes('하나카드') || lowerContent.includes('hana card') ||
      lowerContent.includes('hanacard') || lowerContent.includes('hanabank')) return '하나카드';
  if (lowerContent.includes('우리은행') || lowerContent.includes('woori bank') ||
      lowerContent.includes('wooribank') || lowerContent.includes('우리 계좌')) return '우리은행';
  if (lowerContent.includes('카카오뱅크') || lowerContent.includes('kakaobank') ||
      lowerContent.includes('kakao bank') || lowerContent.includes('카카오페이') ||
      lowerContent.includes('kakaopay') || lowerContent.includes('카뱅')) return '카카오뱅크';
  if (lowerContent.includes('혜영카드')) return '혜영카드';

  if (!method) {
    return validMethods.includes('하나카드') ? '하나카드' : (validMethods[0] || '하나카드');
  }
  
  const trimmed = method.trim();
  if (validMethods.includes(trimmed)) return trimmed;
  
  const mapping = {
    '현대': '현대카드', '현대카드': '현대카드', 'hyundai': '현대카드', '코스트코': '현대카드', 'costco': '현대카드',
    '신한': '신한카드', '신한카드': '신한카드', 'shinhan': '신한카드',
    '하나': '하나카드', '하나카드': '하나카드', 'hana': '하나카드', '하나은행': '하나카드',
    '우리': '우리은행', '우리은행': '우리은행', 'woori': '우리은행',
    '카카오': '카카오뱅크', '카카오뱅크': '카카오뱅크', '카뱅': '카카오뱅크',
    '카카오페이': '카카오뱅크', 'kakao': '카카오뱅크', 'kakaopay': '카카오뱅크',
    '혜영': '혜영카드', '혜영카드': '혜영카드',
    '은행': '우리은행', '은행/현금': '우리은행', '현금/은행': '우리은행',
    '현금': '우리은행', '통장': '우리은행', '계좌': '우리은행', 'cash': '우리은행',
  };
  
  const lowerTrimmed = trimmed.toLowerCase();
  const mapped = mapping[trimmed] || mapping[lowerTrimmed];
  if (mapped && validMethods.includes(mapped)) return mapped;

  // 부분 문자열 매칭
  if (lowerTrimmed.includes('현대') || lowerTrimmed.includes('hyundai')) return '현대카드';
  if (lowerTrimmed.includes('신한') || lowerTrimmed.includes('shinhan')) return '신한카드';
  if (lowerTrimmed.includes('하나') || lowerTrimmed.includes('hana')) return '하나카드';
  if (lowerTrimmed.includes('우리') || lowerTrimmed.includes('woori')) return '우리은행';
  if (lowerTrimmed.includes('카카오') || lowerTrimmed.includes('kakao') || lowerTrimmed.includes('카뱅')) return '카카오뱅크';
  if (lowerTrimmed.includes('혜영')) return '혜영카드';
  if (lowerTrimmed.includes('현금') || lowerTrimmed.includes('cash') ||
      lowerTrimmed.includes('통장') || lowerTrimmed.includes('은행')) return '우리은행';

  // 최종 폴백: 하나카드
  return validMethods.includes('하나카드') ? '하나카드' : (validMethods[0] || '하나카드');
}

// 프롬프트 빌더
function buildPromptForSource(mimeType, fileName) {
  const isImage = (mimeType && mimeType.startsWith('image/')) || 
                  (fileName && /\.(png|jpe?g|gif|webp)$/i.test(fileName));
  
  // 결제수단 판별 가이드 (두 프롬프트 공용)
  const methodGuide = `[결제수단(method) 판별 기준 - 반드시 아래 6가지 중 하나로만 기입]
- 신한카드: 신한카드 명세서 또는 이체 화면에 '신한카드' 표시
- 현대카드: 현대카드 명세서, 코스트코 결제 등
- 하나카드: 하나카드 명세서 또는 '하나카드' 표시
- 우리은행: 우리은행 계좌 이체, 우리은행 앱, '은행', '현금', '통장' 이체 등
- 카카오뱅크: 카카오뱅크 앱, 카카오페이, '카뱅' 표시
- 혜영카드: 혜영 카드 사용 내역`;

  if (isImage) {
    return `당신은 은행/카드 거래 내역 분석 전문가입니다.
이미지는 은행 또는 결제 앱(토스, 카카오뱅크 등)의 이체 및 결제 완료 상세 스크린샷 이미지입니다.
파일의 내용을 정확히 읽고 거래 내역 추출과 함께, 어떤 은행인지 혹은 결제앱인지 판별하여 직관적인 추천 파일명(recommendedFileName)을 생성해 주세요.

[파일명 추천 규칙]
1. 이체 및 출금 스크린샷 이미지인 경우: [출금은행 또는 결제수단]_[이체/결제/출금]_[날짜MMDD] 형식으로 지어주세요.
   - 예: 우리은행 계좌출금 내역 스크린샷 -> "우리은행_계좌출금_0603"
   - 예: 카카오페이 이체 스크린샷 -> "카카오뱅크_이체내역_0528"
   - 예: 현대카드 결제 스크린샷 -> "현대카드_결제내역_0601"
2. 확장자는 덧붙이지 마세요. (코드에서 자동 처리됩니다.)

[거래 내역 추출 규칙]
1. 날짜: MM/DD 형식으로 추출 (예: "6.03" -> "06/03")
2. desc(내용): 실제 이체/결제 상대 혹은 사용처 명칭 그대로 추출
3. exp(지출): 마이너스 부호나 원화를 떼고 절대값 정수로 추출
4. 잔액(계좌 잔고 등)은 거래 금액이 아니므로 완벽히 스킵
5. 쿠팡 이체는 분류(cat)를 반드시 '생활비'로 설정하세요.
6. 코스트코 결제는 method를 반드시 '현대카드'로 설정하세요.
7. 양가 부모님 용돈, 어버이날 선물, 명절 세뱃돈, 가족 행사 모임비 등은 분류(cat)를 반드시 '가족'으로 설정하세요.
8. ${methodGuide}`;
  }

  return `당신은 가계부 정리 전문가 '가챙이'입니다.
제공된 명세서(PDF, HTML 등) 파일에서 각 거래 내역을 추출하고, 어떤 카드사 또는 고지서인지 판별하여 표준화된 추천 파일명(recommendedFileName)을 생성해 주세요.

[파일명 추천 규칙]
1. 고지서 및 이용 대금 명세서인 경우: [카드사명/고지서종류]_[XX월_고지서 또는 청구서] 형식으로 지어주세요.
   - 예: 현대카드 5월 이용 명세서 -> "현대카드_05월_고지서"
   - 예: 신한카드 6월 청구내역서 -> "신한카드_06월_청구서"
2. 확장자는 덧붙이지 마세요. (코드에서 자동 처리됩니다.)

[거래 내역 추출 규칙]
1. 날짜: MM/DD 형식으로 추출
2. desc(내용): 이용처/상점명 추출
3. exp(지출): 청구된 원금 절대값 정수 추출
4. 다음 키워드는 보험/와우멤버십/통신비 등의 제외 항목이므로 포함하지 마세요: '와우 멤버십', '보험', '카드대금', 'DLIVE', 'SKT', 'KT', 'LGU+'
5. 코스트코(Costco) 결제는 method를 반드시 '현대카드'로 설정하세요.
6. 양가 가족 공동 행사, 부모님 의료비/용돈 지원 등 가족과 관련된 항목은 분류(cat)를 반드시 '가족'으로 설정하세요.
7. ${methodGuide}`;
}

// ─── 롤백 및 작업 보완 유틸리티 함수들 ──────────────────────────────────

// localStorage에 추가한 행 인덱스 저장
function saveSessionRow(monthName, rowIndex) {
  let sessionRows = [];
  try {
    sessionRows = JSON.parse(localStorage.getItem('gachangi_added_transactions')) || [];
  } catch (e) {
    sessionRows = [];
  }
  sessionRows.push({ month: monthName, rowIndex: rowIndex });
  localStorage.setItem('gachangi_added_transactions', JSON.stringify(sessionRows));
}

// 세션 롤백 실행
async function rollbackSessionTransactions() {
  let sessionRows = [];
  try {
    sessionRows = JSON.parse(localStorage.getItem('gachangi_added_transactions')) || [];
  } catch (e) {
    _writeConsoleLog('❌ 롤백 실패: 저장된 세션 추가 기록이 없습니다.');
    showToast('⚠️ 롤백할 내역이 없습니다.', 'warning');
    return;
  }

  if (sessionRows.length === 0) {
    _writeConsoleLog('⚠️ 롤백할 내역이 없습니다.');
    showToast('⚠️ 롤백할 내역이 없습니다.', 'warning');
    return;
  }

  const confirmRollback = confirm(`이번 테스트 실행 동안 추가한 총 ${sessionRows.length}개의 거래 행을 스프레드시트에서 삭제하시겠습니까?`);
  if (!confirmRollback) return;

  _writeConsoleLog(`↩️ [롤백] 총 ${sessionRows.length}개 추가 건 삭제 작업을 시작합니다.`);
  showLoading(true);

  // 행 인덱스 정렬: 인덱스 꼬임 방지를 위해 역순(큰 행 번호부터) 정렬하여 삭제
  sessionRows.sort((a, b) => b.rowIndex - a.rowIndex);

  let successCount = 0;
  for (const row of sessionRows) {
    try {
      _writeConsoleLog(`🗑️ [롤백] ${row.month} 시트의 ${row.rowIndex}행 삭제 중...`);
      await SheetsAPI.deleteRow(row.month, row.rowIndex);
      successCount++;
    } catch (err) {
      _writeConsoleLog(`❌ [롤백 실패] ${row.month} ${row.rowIndex}행 삭제 에러: ` + err.message);
    }
  }

  localStorage.removeItem('gachangi_added_transactions');
  _writeConsoleLog(`🏁 [롤백 완료] 총 ${successCount}개 행 삭제 완료!`);
  showToast(`🏁 롤백 완료: ${successCount}개 행 삭제됨`);
  showLoading(false);

  // 데이터 새로고침
  if (window.loadCurrentMonth) {
    await loadCurrentMonth();
  }
}

// 미검토 노란색 배경 행 일괄 삭제 (테스트 데이터 일괄 청소 유틸리티)
async function bulkDeleteAllYellowRows() {
  const confirmDelete = confirm("⚠️ 경고: 전체 시트에서 노란색 배경(미검토 상태)으로 지정되어 있는 모든 수집 행을 일괄 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다.");
  if (!confirmDelete) return;

  _writeConsoleLog(`🚨 [노란색 행 일괄 삭제] 전체 시트 검색 시작...`);
  showLoading(true);

  try {
    const meta = SheetsAPI.getSheetMeta();
    const months = GACHANGI_CONFIG.MONTH_NAMES.filter(m => meta[m] !== undefined);
    
    let totalDeleted = 0;

    for (const month of months) {
      _writeConsoleLog(`🔍 ${month} 시트의 노란색 행 검색 중...`);
      const transactions = await SheetsAPI.loadMonthData(month);
      
      // 노란색 배경(needsReview) 행들을 역순으로 정렬
      const yellowRows = transactions
        .filter(t => t.needsReview)
        .map(t => t.rowIndex)
        .sort((a, b) => b - a); // 역순 정렬 중요

      if (yellowRows.length > 0) {
        _writeConsoleLog(`🗑️ ${month} 시트에서 노란색 행 ${yellowRows.length}개 발견. 삭제 진행...`);
        for (const rowIndex of yellowRows) {
          await SheetsAPI.deleteRow(month, rowIndex);
          totalDeleted++;
        }
      }
    }

    _writeConsoleLog(`🏁 [삭제 완료] 전체 시트에서 총 ${totalDeleted}개의 노란색 행을 일괄 삭제했습니다.`);
    showToast(`🏁 일괄 삭제 완료: ${totalDeleted}개 행 제거됨`);
    
    // 데이터 새로고침
    if (window.loadCurrentMonth) {
      await loadCurrentMonth();
    }
  } catch (err) {
    _writeConsoleLog('❌ 노란색 행 삭제 실패: ' + err.message);
    showToast('❌ 일괄 삭제 실패', 'error');
  } finally {
    showLoading(false);
  }
}

// 에이전트 작업 로그 파일 다운로드
function downloadAgentLogs() {
  const consoleEl = document.getElementById(_consoleElId);
  if (!consoleEl) return;

  const logText = consoleEl.textContent;
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `gachangi_agent_log_${dateStr}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  _writeConsoleLog('💾 작업 로그 파일 다운로드가 시작되었습니다.');
}

// 에이전트 작업 로그 로컬 서버(logs/) 저장 API 호출
async function saveLogToServer() {
  const consoleEl = document.getElementById(_consoleElId);
  if (!consoleEl) return;

  const logText = consoleEl.textContent;
  console.log('[가챙이 에이전트 로그]\n', logText);
  _writeConsoleLog('💾 에이전트 로그가 브라우저 콘솔에 기록되었습니다. 로그를 보존하려면 [로그 다운로드] 버튼을 이용해 주세요.');
}

// ─── 무인 Worker 연동: '즉시 실행' 버튼이 Worker POST /run 을 호출 ───
async function triggerWorkerRun() {
  const base = (GACHANGI_CONFIG.AGENT_WORKER_URL || '').replace(/\/+$/, '');
  const token = GACHANGI_CONFIG.AGENT_RUN_TOKEN || '';
  const triggerBtn = document.getElementById('agent-trigger-btn');

  _writeConsoleLog('☁️ 무인 에이전트(Worker)에 실행을 요청합니다...');
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '⚡ Worker 요청 중...'; }

  try {
    const res = await fetch(`${base}/run`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });

    if (res.status === 401) {
      _writeConsoleLog('❌ 인증 실패(401): config의 AGENT_RUN_TOKEN이 Worker의 RUN_TOKEN과 일치하는지 확인하세요.');
      showToast('❌ Worker 인증 실패', 'error');
      return;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      _writeConsoleLog(`❌ Worker 요청 실패 (${res.status}): ${t}`);
      showToast('❌ Worker 요청 실패', 'error');
      return;
    }

    const data = await res.json().catch(() => ({}));
    _writeConsoleLog(`✅ ${data.message || 'Worker 실행 요청을 보냈습니다.'}`);
    _writeConsoleLog('ℹ️ 상세 처리 로그는 Cloudflare Worker 로그(wrangler tail)에 기록됩니다.');
    _writeConsoleLog('🔄 처리 완료 후 새로고침하면 시트 반영 결과를 확인할 수 있습니다.');
    showToast('☁️ 무인 에이전트 실행을 시작했습니다.');
  } catch (e) {
    _writeConsoleLog(`❌ Worker 호출 오류: ${e.message} (Worker URL/CORS/네트워크 확인)`);
    showToast('❌ Worker 호출 오류', 'error');
  } finally {
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = '⚡ 즉시 동기화 실행'; }
  }
}

// AGENT_WORKER_URL 설정 시 Worker 호출, 없으면 기존 로컬 runAgentSync 폴백(비파괴 전환)
async function onAgentTrigger() {
  const url = (GACHANGI_CONFIG.AGENT_WORKER_URL || '').trim();
  if (url) {
    await triggerWorkerRun();
  } else {
    await runAgentSync();
  }
}

// 무인 Worker의 처리 이력(KV)을 불러와 콘솔에 표시 — 무인 실행은 실시간 콘솔이 없으므로 '기록 조회'형.
async function loadWorkerLogs() {
  const base = (GACHANGI_CONFIG.AGENT_WORKER_URL || '').replace(/\/+$/, '');
  const token = GACHANGI_CONFIG.AGENT_RUN_TOKEN || '';
  if (!base) {
    _writeConsoleLog('ℹ️ AGENT_WORKER_URL이 설정되지 않아 무인 처리 이력을 조회할 수 없습니다. (config.js 확인)');
    return;
  }

  const consoleEl = document.getElementById(_consoleElId);
  _writeConsoleLog('📜 Worker 처리 이력을 불러오는 중...');
  try {
    const res = await fetch(`${base}/logs`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      _writeConsoleLog(`⚠️ 이력 조회 실패 (${res.status}). RUN_TOKEN/URL을 확인하세요.`);
      return;
    }
    const data = await res.json();
    const runs = (data && data.runs) || [];

    if (consoleEl) consoleEl.textContent = '';
    if (runs.length === 0) {
      _writeConsoleLog('(아직 Worker 실행 이력이 없습니다. cron 또는 [즉시 실행] 후 새로고침하세요.)');
      return;
    }

    _writeConsoleLog(`📜 Worker 처리 이력 — 최근 ${runs.length}건 (최신순)`);
    for (const r of runs) {
      let t = '?';
      try { t = r.at ? new Date(r.at).toLocaleString('ko-KR') : '?'; } catch (e) {}
      if (r.ok === false || r.error) {
        _writeConsoleLog(`\n■ [${t}] (${r.trigger}) ❌ 실패: ${r.error || '알 수 없음'}`);
      } else {
        const s = r.summary || {};
        _writeConsoleLog(`\n■ [${t}] (${r.trigger}) 메일 ${s.mails || 0}건 · 적재 ${s.uploaded || 0} · 시트추가 ${s.added || 0} · 중복 ${s.skipped || 0} · 실패 ${s.fail || 0}`);
        for (const line of (r.log || [])) _writeConsoleLog('    ' + line);
      }
    }
    _writeConsoleLog('\n📜 — 이력 끝 —');
  } catch (e) {
    _writeConsoleLog(`⚠️ 이력 조회 오류: ${e.message} (Worker URL/네트워크/CORS 확인)`);
  }
}

// ─── 이벤트 리스너 바인딩 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const triggerBtn = document.getElementById('agent-trigger-btn');
  const clearBtn = document.getElementById('clear-agent-log-btn');
  const rollbackBtn = document.getElementById('agent-rollback-btn');
  const clearYellowBtn = document.getElementById('agent-clear-yellow-btn');
  const downloadLogBtn = document.getElementById('download-agent-log-btn');
  const refreshWorkerLogBtn = document.getElementById('refresh-worker-log-btn');

  if (triggerBtn) triggerBtn.addEventListener('click', onAgentTrigger);
  if (refreshWorkerLogBtn) refreshWorkerLogBtn.addEventListener('click', loadWorkerLogs);
  if (rollbackBtn) rollbackBtn.addEventListener('click', rollbackSessionTransactions);
  if (clearYellowBtn) clearYellowBtn.addEventListener('click', bulkDeleteAllYellowRows);
  if (downloadLogBtn) downloadLogBtn.addEventListener('click', downloadAgentLogs);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const consoleEl = document.getElementById(_consoleElId);
      if (consoleEl) {
        consoleEl.textContent = '';
      }
    });
  }
});

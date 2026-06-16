/**
 * Google REST API 공용 fetch 헬퍼.
 * 브라우저 가챙이(agent_controller.js)가 Drive를 fetch+Bearer로 직접 호출하던 패턴을
 * Worker로 옮긴 것. gapi 클라이언트 없이 순수 fetch만 사용한다.
 */

/** Bearer 인증 + 오류 표면화 + JSON/텍스트 자동 파싱 */
export async function googleFetch(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Google API ${res.status} (${url}): ${detail}`);
    err.status = res.status;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/** 429/5xx 지수 백오프 재시도 (agent_controller.js fetchGeminiWithRetry 이식) */
export async function fetchWithRetry(url, options, { maxRetries = 5, baseDelay = 2000, onLog } = {}) {
  let delay = baseDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        if (onLog) onLog(`⚠️ ${res.status} 혼잡 — ${delay / 1000}s 후 재시도 (${i + 1}/${maxRetries})`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      return res; // 그 외 오류는 상위에서 처리
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      if (onLog) onLog(`⚠️ 네트워크 오류 — ${delay / 1000}s 후 재시도`);
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('재시도 횟수 초과: 응답을 받지 못했습니다.');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 무인 인증: refresh_token → 단기 access_token 교환 + KV 캐시.
 * 브라우저 implicit flow(auth.js)와 달리 Worker는 refresh_token으로 토큰을 자급한다.
 * refresh_token/client_secret 은 wrangler secret 으로만 주입된다(코드/Git에 없음).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_KEY = 'google_access_token';

export async function getAccessToken(env) {
  // 1) KV 캐시에 유효한 토큰이 있으면 재사용 (만료 60초 전까지)
  try {
    const cached = await env.STATE.get(CACHE_KEY, { type: 'json' });
    if (cached && cached.access_token && cached.expiry - Date.now() > 60_000) {
      return cached.access_token;
    }
  } catch (_) {
    /* 캐시 미스/파싱 실패는 무시하고 재발급 */
  }

  // 2) refresh_token 으로 신규 발급
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
    if (!env[name]) {
      throw new Error(`필수 secret 누락: ${name} (wrangler secret put ${name} 로 등록하세요)`);
    }
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // invalid_grant = refresh_token 만료/폐기(비번 변경, 6개월 미사용, 테스트앱 7일 등)
    throw new Error(`access_token 발급 실패 (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const access_token = data.access_token;
  const ttl = data.expires_in || 3600;
  const expiry = Date.now() + ttl * 1000;

  // 3) 캐시 저장 (만료보다 약간 짧게 TTL)
  try {
    await env.STATE.put(
      CACHE_KEY,
      JSON.stringify({ access_token, expiry }),
      { expirationTtl: Math.max(60, ttl - 60) }
    );
  } catch (_) {
    /* 캐시 실패는 치명적이지 않음 */
  }

  return access_token;
}

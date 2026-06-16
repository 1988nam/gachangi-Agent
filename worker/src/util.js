/** 인코딩/바이트 유틸 (Workers 런타임: atob/TextEncoder/crypto 사용 가능) */

/** Gmail 첨부·본문 data 는 base64url(URL-safe) → 표준 base64 보정 후 바이트로 */
export function base64UrlToBytes(b64url) {
  const b64 = (b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array 여러 개를 하나로 이어붙임 (multipart 본문 조립용) */
export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Uint8Array → 표준 base64 (Gemini inlineData 전송용). 청크 단위로 btoa 안전 처리. */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

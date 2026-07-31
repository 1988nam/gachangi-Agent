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

/**
 * 거래 시각 표기를 'HH:MM'(24시간)으로 표준화. 값이 없거나 해석 불가면 빈 문자열.
 * 은행 앱 캡쳐는 '14:23' · '오후 2:23' · '2:23 PM' 등 표기가 제각각이고,
 * 시트 셀이 TIME 서식으로 바뀌면 '오후 2:23:00'으로 읽히기도 해서 읽기/쓰기 양쪽에서 정규화한다.
 * (표기가 다르다고 다른 거래로 오판하면 중복 판정이 무력해진다)
 */
export function normalizeTime(raw) {
  const v = (raw == null ? '' : String(raw)).trim();
  if (!v) return '';
  const isPm = /오후|PM/i.test(v);
  const isAm = /오전|AM/i.test(v);
  const m = v.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min) || h > 23 || min > 59) return '';
  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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

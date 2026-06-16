/**
 * 텍스트 디코딩 (agent_controller.js 126-147 이식).
 *
 * ⚠️ Workers 런타임 주의: TextDecoder는 utf-8은 항상 지원하나 'euc-kr'(현대카드 명세서)은
 *    미지원일 수 있다. 미지원 시 경고 후 utf-8 결과로 폴백한다(깨질 수 있음).
 *    실제 EUC-KR 명세서로 검증 후, 필요하면 CP949 디코더를 번들해야 한다.
 */

let _eucKrSupported = null;

function tryEucKr(bytes) {
  if (_eucKrSupported === false) return null;
  try {
    const text = new TextDecoder('euc-kr').decode(bytes);
    _eucKrSupported = true;
    return text;
  } catch (_) {
    _eucKrSupported = false;
    console.warn('⚠️ 이 런타임은 euc-kr 디코딩을 지원하지 않습니다. EUC-KR 명세서(예: 현대카드)는 깨질 수 있어 CP949 디코더 번들이 필요합니다.');
    return null;
  }
}

/** 전각 문자/전각 공백 정규화 (현대카드 명세서 난독화 대응) */
function normalizeFullwidth(text) {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

export function decodeBytes(bytes) {
  // 1) utf-8 우선
  let text = new TextDecoder('utf-8').decode(bytes);
  const lower = text.toLowerCase();

  // 2) 문서가 euc-kr을 선언하거나 대체문자(�)가 많으면 euc-kr 재디코딩 시도
  const declaresEucKr = lower.includes('charset=euc-kr') || lower.includes('charset="euc-kr"');
  const looksGarbled = (text.match(/�/g) || []).length > 5;
  if (declaresEucKr || looksGarbled) {
    const euc = tryEucKr(bytes);
    if (euc != null) text = euc;
  }

  return normalizeFullwidth(text);
}

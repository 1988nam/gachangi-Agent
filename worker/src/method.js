/** 결제수단 자가 교정 (agent_controller.js selfHealMethod 636-699 이식) */
export function selfHealMethod(method, validMethods, fileName, fileContent) {
  const lowerFile = (fileName || '').toLowerCase();
  const lowerContent = (fileContent || '').toLowerCase();

  // 1. 파일명 기반 1차 매핑
  if (lowerFile.includes('현대') || lowerFile.includes('hyundai')) return '현대카드';
  if (lowerFile.includes('신한') || lowerFile.includes('shinhan')) return '신한카드';
  if (lowerFile.includes('하나') || lowerFile.includes('hana')) return '하나카드';
  if (lowerFile.includes('우리') || lowerFile.includes('woori')) return '우리은행';
  if (lowerFile.includes('카카오') || lowerFile.includes('카뱅') || lowerFile.includes('kakao')) return '카카오뱅크';
  if (lowerFile.includes('혜영')) return '혜영카드';
  if (lowerFile.includes('costco') || lowerFile.includes('코스트코')) return '현대카드';

  // 2. 본문 내용 기반 2차 매핑
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

  if (lowerTrimmed.includes('현대') || lowerTrimmed.includes('hyundai')) return '현대카드';
  if (lowerTrimmed.includes('신한') || lowerTrimmed.includes('shinhan')) return '신한카드';
  if (lowerTrimmed.includes('하나') || lowerTrimmed.includes('hana')) return '하나카드';
  if (lowerTrimmed.includes('우리') || lowerTrimmed.includes('woori')) return '우리은행';
  if (lowerTrimmed.includes('카카오') || lowerTrimmed.includes('kakao') || lowerTrimmed.includes('카뱅')) return '카카오뱅크';
  if (lowerTrimmed.includes('혜영')) return '혜영카드';
  if (lowerTrimmed.includes('현금') || lowerTrimmed.includes('cash') ||
      lowerTrimmed.includes('통장') || lowerTrimmed.includes('은행')) return '우리은행';

  return validMethods.includes('하나카드') ? '하나카드' : (validMethods[0] || '하나카드');
}

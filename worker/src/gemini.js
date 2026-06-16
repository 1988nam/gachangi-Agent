/**
 * Gemini 구조화 분석 (agent_controller.js buildPromptForSource/performGeminiParse 이식).
 * Workers엔 DOMParser가 없어 HTML 정제는 정규식 기반(cleanHtmlText)으로 대체한다.
 */
import { fetchWithRetry } from './google-api.js';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recommendedFileName: {
      type: 'string',
      description: '추출된 내용을 분석하여 지은 직관적이고 표준화된 파일명 (확장자 제외)',
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
          method: { type: 'string', description: '결제수단' },
        },
        required: ['date', 'desc', 'inc', 'exp', 'cat', 'method'],
      },
    },
  },
  required: ['recommendedFileName', 'transactions'],
};

/** HTML → 텍스트 정제 (DOMParser 없이 정규식). agent_controller.js cleanHtmlContent의 폴백 경로 이식. */
export function cleanHtmlText(htmlStr) {
  // script 내 거래 데이터(UseDesc/arUseDesc) 추출
  let scriptData = '';
  const scriptBlocks = htmlStr.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  const extracted = [];
  for (const block of scriptBlocks) {
    if (block.includes('UseDesc') || block.includes('arUseDesc')) {
      block.split('\n').forEach((line) => {
        const t = line.trim();
        if (t.includes('new UseDesc') || t.includes('arUseDesc[')) extracted.push(t);
      });
    }
  }
  if (extracted.length > 0) scriptData = '\n\n[Script Data (Transactions)]\n' + extracted.join('\n');

  let text = htmlStr
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<\/(tr|div|p|table|h[1-6]|li|br)\s*\/?>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ');

  text = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).join('\n');
  return text + scriptData;
}

/** 결제수단 판별 가이드(두 프롬프트 공용) */
const METHOD_GUIDE = `[결제수단(method) 판별 기준 - 반드시 아래 6가지 중 하나로만 기입]
- 신한카드: 신한카드 명세서 또는 이체 화면에 '신한카드' 표시
- 현대카드: 현대카드 명세서, 코스트코 결제 등
- 하나카드: 하나카드 명세서 또는 '하나카드' 표시
- 우리은행: 우리은행 계좌 이체, 우리은행 앱, '은행', '현금', '통장' 이체 등
- 카카오뱅크: 카카오뱅크 앱, 카카오페이, '카뱅' 표시
- 혜영카드: 혜영 카드 사용 내역`;

/** 소스 유형별 프롬프트 빌더 (agent_controller.js buildPromptForSource 이식) */
export function buildPromptForSource(mimeType, fileName) {
  const isImage =
    (mimeType && mimeType.startsWith('image/')) ||
    (fileName && /\.(png|jpe?g|gif|webp)$/i.test(fileName));

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
8. ${METHOD_GUIDE}`;
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
7. ${METHOD_GUIDE}`;
}

/** Gemini 구조화 호출. isText면 text 파트, 아니면 inlineData(base64) 파트. */
export async function geminiParse(env, { promptText, isText, text, base64, mimeType }, onLog) {
  const parts = [];
  if (isText) {
    parts.push({ text: `${promptText}\n\n[분석 대상 고지서/명세서 본문내용]\n${text}` });
  } else {
    parts.push({ text: promptText });
    parts.push({ inlineData: { mimeType, data: base64 } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    },
    { onLog }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini API 호출 실패: ${detail}`);
  }

  const json = await res.json();
  let raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini로부터 분석 응답을 받지 못했습니다.');

  raw = raw.trim();
  if (raw.startsWith('```json')) raw = raw.slice(7);
  else if (raw.startsWith('```')) raw = raw.slice(3);
  if (raw.endsWith('```')) raw = raw.slice(0, -3);

  const parsed = JSON.parse(raw.trim());
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini 분석 결과가 올바른 객체 형식이 아닙니다.');
  }
  return parsed;
}

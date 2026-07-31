/**
 * Gemini 구조화 분석 (agent_controller.js buildPromptForSource/performGeminiParse 이식).
 * Workers엔 DOMParser가 없어 HTML 정제는 정규식 기반(cleanHtmlText)으로 대체한다.
 */
import { fetchWithRetry } from './google-api.js';
import { DEFAULT_CATEGORIES, DEFAULT_METHODS } from './constants.js';

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
          time: {
            type: 'string',
            description: '거래 시각 24시간제 HH:MM. 화면/문서에 시각 표기가 없으면 반드시 빈 문자열("")',
          },
          desc: { type: 'string', description: '가맹점/사용내용' },
          inc: { type: 'integer', description: '수입 금액 (없으면 0)' },
          exp: { type: 'integer', description: '지출/투자 금액 (없으면 0)' },
          // enum으로 못박는다. 자유 문자열이었을 때 '편의점'·'카페' 같은 목록 밖 값이 나와
          // 그대로 시트에 기록됐다(생활비 집계에서 누락).
          cat: { type: 'string', enum: DEFAULT_CATEGORIES, description: `분류 — 반드시 다음 중 하나: ${DEFAULT_CATEGORIES.join(', ')}` },
          method: { type: 'string', enum: DEFAULT_METHODS, description: `결제수단 — 반드시 다음 중 하나: ${DEFAULT_METHODS.join(', ')}` },
        },
        required: ['date', 'time', 'desc', 'inc', 'exp', 'cat', 'method'],
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
제공된 이미지는 아래 둘 중 하나입니다.
 (A) 은행/결제앱의 '입출금 내역 · 거래 내역 리스트' 스크린샷 — 여러 건이 목록/표로 나열됨
 (B) 단건 이체/결제/출금 완료 상세 스크린샷 — 1건
이미지를 정확히 읽어 모든 거래를 추출하고, 어떤 은행/결제앱인지 판별하여 추천 파일명(recommendedFileName)을 생성해 주세요.

[⚠️ 가장 중요 — 누락 없이 전부 추출]
1. 이미지에 보이는 거래 행을 맨 위부터 맨 아래까지 '하나도 빠짐없이' 추출하세요. 대표 몇 건만 뽑거나 개수를 임의로 줄이지 마세요.
2. 금액이나 상대가 비슷해도 화면상 별개 행이면 각각 별도 항목으로 추출하세요(임의 병합 금지). 같은 날짜에 같은 금액이 여러 번 있어도 각각 추출하세요. 중복 정리는 시스템이 따로 처리합니다.
3. 날짜 헤더(예: "6월 3일") 아래에 여러 건이 묶여 있으면 각 건에 그 헤더 날짜를 적용하세요.

[입금 / 출금 구분 — 둘 다 추출]
- 입금(받은 돈: '입금' 표시, + 부호, 파란색/녹색 등) → inc 에 절대값 정수, exp=0
- 출금·이체·결제(나간 돈: '출금' 표시, - 부호, 빨간색 등) → exp 에 절대값 정수, inc=0
- 원화기호(₩·원)·부호(+·-)·콤마는 떼고 정수만 넣으세요.
- 잔액(잔고·남은금액·Balance)은 거래 금액이 아니므로 절대 포함하지 마세요.

[날짜] 반드시 MM/DD. "6.03"·"6월 3일"·"06-03" → "06/03". 연도는 무시.
[시각(time)] 화면에 거래 시각이 보이면 24시간제 "HH:MM"으로 넣으세요.
 - "오후 2:23"·"2:23 PM" → "14:23" / "09:05" → "09:05" / "14:23:57" → "14:23"
 - 같은 날 같은 금액의 거래를 구분하는 유일한 단서이므로, 보이면 절대 생략하지 마세요.
 - 시각 표기가 화면에 없으면 추측하지 말고 빈 문자열("")로 두세요.
[내용(desc)] 실제 이체/결제 상대 혹은 사용처 명칭을 그대로.

[파일명 추천 규칙]
1. 리스트(A): [은행/결제수단]_입출금내역_[대표날짜MMDD] (예: "우리은행_입출금내역_0603")
2. 단건(B): [출금은행 또는 결제수단]_[이체/결제/출금]_[날짜MMDD] (예: "카카오뱅크_이체내역_0528")
3. 확장자는 붙이지 마세요. (코드에서 자동 처리됩니다.)

[분류(cat)]
- 입금(inc>0) 거래의 분류(cat)는 반드시 '수입'으로 설정하세요.
- 쿠팡 이체/결제는 cat을 '생활비'로.
- 코스트코 결제는 method를 '현대카드'로.
- 양가 부모님 용돈, 어버이날 선물, 명절 세뱃돈, 가족 행사 모임비 등은 cat을 '가족'으로.
${METHOD_GUIDE}`;
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
1-1. time(시각): 명세서에 거래 시각이 함께 표기된 경우에만 24시간제 "HH:MM"으로 추출하고, 없으면 빈 문자열("")
2. desc(내용): 이용처/상점명 추출
3. exp(지출): 청구된 원금 절대값 정수 추출
4. 다음 키워드는 보험/와우멤버십/통신비 등의 제외 항목이므로 포함하지 마세요: '와우 멤버십', '보험', '카드대금', 'DLIVE', 'SKT', 'KT', 'LGU+'
5. 코스트코(Costco) 결제는 method를 반드시 '현대카드'로 설정하세요.
6. 양가 가족 공동 행사, 부모님 의료비/용돈 지원 등 가족과 관련된 항목은 분류(cat)를 반드시 '가족'으로 설정하세요.
7. ${METHOD_GUIDE}`;
}

/** Gemini 구조화 호출. isText면 text 파트, 아니면 inlineData(base64) 파트. */
export async function geminiParse(env, token, { promptText, isText, text, base64, mimeType }, onLog) {
  const parts = [];
  if (isText) {
    parts.push({ text: `${promptText}\n\n[분석 대상 고지서/명세서 본문내용]\n${text}` });
  } else {
    parts.push({ text: promptText });
    parts.push({ inlineData: { mimeType, data: base64 } });
  }

  // Vertex AI 엔드포인트(리전 고정) — generativelanguage의 요청 IP 지역제한(Cloudflare egress) 회피.
  // API 키 대신 OAuth Bearer(cloud-platform 스코프) 인증 사용.
  const project = env.VERTEX_PROJECT_ID;
  const location = env.VERTEX_LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    },
    { onLog }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // status를 실어 보내 상위(process.js)가 일시(429/5xx)/영구(4xx) 오류를 정확히 분류하게 한다.
    const err = new Error(`Gemini API 호출 실패 (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  let raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    // 빈 candidates(안전필터/일시 무응답)는 재시도하면 성공하는 비결정 오류 — FAIL 격리(영구) 대상이 아니다.
    const err = new Error('Gemini로부터 분석 응답을 받지 못했습니다.');
    err.transient = true;
    throw err;
  }

  raw = raw.trim();
  if (raw.startsWith('```json')) raw = raw.slice(7);
  else if (raw.startsWith('```')) raw = raw.slice(3);
  if (raw.endsWith('```')) raw = raw.slice(0, -3);

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (e) {
    // 출력 길이 제한 등으로 잘린 JSON도 재시도 대상(일시 오류)으로 분류한다.
    const err = new Error(`Gemini 응답 JSON 파싱 실패(응답 잘림 등): ${e.message}`);
    err.transient = true;
    throw err;
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini 분석 결과가 올바른 객체 형식이 아닙니다.');
  }
  return parsed;
}

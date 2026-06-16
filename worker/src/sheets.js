/**
 * Google Sheets REST 래퍼 (js/sheets.js 의 Worker 포팅).
 * gapi 대신 순수 fetch. 가계부 시트 구조: A날짜 B내용 C수입 D지출 E잔액(빈칸) F분류 G결제수단, START_ROW=4.
 */
import { googleFetch } from './google-api.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.trunc(v);
  return parseInt(String(v).replace(/[^0-9-]/g, ''), 10) || 0;
}

/** 시트 제목 → sheetId 매핑 */
export async function loadSheetMeta(token, spreadsheetId) {
  const fields = encodeURIComponent('sheets.properties(title,sheetId)');
  const res = await googleFetch(token, `${BASE}/${spreadsheetId}?fields=${fields}`);
  const meta = {};
  for (const s of res.sheets || []) meta[s.properties.title] = s.properties.sheetId;
  return meta;
}

/**
 * 단일 월 데이터 로드(중복판정용). 날짜 '-'(또는 빈칸 carry)는 고정비(isFixed)로 표시하고 MM/01로 변환.
 * (js/sheets.js loadMonthDataFromGoogleSheets + loadMonthData 의 핵심 이식, 배경색 제외)
 */
export async function loadMonthData(token, spreadsheetId, monthName, startRow = 4) {
  const endRow = startRow + 500;
  const range = `${monthName}!A${startRow}:G${endRow}`;
  let res;
  try {
    res = await googleFetch(token, `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  } catch (e) {
    if (e.status === 400 || e.status === 404) return []; // 시트 없음 등 → 신규 월로 간주
    throw e;
  }

  const rows = res.values || [];
  const mMatch = monthName.match(/(\d+)월/);
  const monthPrefix = mMatch ? mMatch[1].padStart(2, '0') : '';

  const out = [];
  let lastValidDate = '';

  rows.forEach((cells, i) => {
    const rawDate = (cells[0] || '').toString().trim();
    const desc = (cells[1] || '').toString();
    const inc = parseNumber(cells[2]);
    const exp = parseNumber(cells[3]);
    const cat = (cells[5] || '').toString();
    const method = (cells[6] || '').toString();

    if (!rawDate && !desc && inc === 0 && exp === 0) return;

    let date;
    if (rawDate) {
      lastValidDate = rawDate;
      date = rawDate;
    } else {
      date = lastValidDate || '-';
    }

    let isFixed = false;
    if (date === '-') {
      isFixed = true;
      date = monthPrefix ? `${monthPrefix}/01` : '-';
    }

    out.push({ rowIndex: startRow + i, date, desc, inc, exp, cat, method, isFixed });
  });

  return out;
}

/**
 * 거래 일괄 추가 + 신규 행 노란색(미검토) 표시.
 * (js/sheets.js addTransactionsBatch 이식: append → updatedRange 파싱 → repeatCell 배경색)
 */
export async function addTransactionsBatch(token, spreadsheetId, sheetId, monthName, items, { startRow = 4, markYellow = true } = {}) {
  if (!items || items.length === 0) return;

  const values = items.map((item) => [
    item.date || '-',
    item.desc || '',
    item.inc || 0,
    item.exp || 0,
    '', // E열(잔액 수식 영역) 비움
    item.cat || '',
    item.method || '',
  ]);

  const range = `${monthName}!A${startRow}`;
  const appendRes = await googleFetch(
    token,
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
  );

  const updatedRange = appendRes.updates && appendRes.updates.updatedRange;
  const m = updatedRange && updatedRange.match(/A(\d+):/);
  if (markYellow && m && sheetId != null) {
    const start = parseInt(m[1], 10);
    const requests = items.map((_, idx) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: start + idx - 1,
          endRowIndex: start + idx,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 0 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    }));
    await googleFetch(token, `${BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  }
}

/** 카테고리 자가 교정 (js/sheets.js _normalizeCategory 이식) */
export function normalizeCategory(cat, desc) {
  const trimmedDesc = (desc || '').trim();
  const trimmed = (cat || '').trim();

  if (!trimmed && (trimmedDesc.includes('공금') || trimmedDesc.includes('혜영 공금') || trimmedDesc.includes('혜영공금'))) {
    return '기타';
  }

  const mapping = {
    '식비': '생활비', '식생활': '생활비', '외식': '생활비', '배달': '생활비', '마트': '생활비', '식재료': '생활비', '생필품': '생활비', '생활용품': '생활비',
    '자동차': '교통/차량', '교통': '교통/차량', '교통비': '교통/차량', '주유': '교통/차량', '차량': '교통/차량',
    '집': '주거/통신', '주거': '주거/통신', '통신비': '주거/통신', '통신': '주거/통신', '핸드폰': '주거/통신', '휴대폰': '주거/통신', '인터넷': '주거/통신',
    '보험료': '보험',
    '의료비': '의료/건강', '병원': '의료/건강', '약국': '의료/건강', '건강': '의료/건강',
    '여행': '여행/여가', '여가': '여행/여가', '문화': '여행/여가', '영화': '여행/여가', '도서': '여행/여가', '숙박': '여행/여가',
    '아가': '육아', '육아': '육아', '교육': '육아', '학원': '육아',
    '용돈': '용돈', '의류': '용돈', '패션': '용돈', '취미': '용돈', '개인': '용돈',
    '기타': '기타', '고정비': '기타', '잡비': '기타', '가족': '가족', '공금': '기타', '경조사': '기타', '경조사비': '기타', '회비': '기타', '구독': '기타', '구독료': '기타', '세금': '기타', '과태료': '기타',
    '투자/저축': '투자/저축', '저축': '투자/저축', '투자': '투자/저축', '예금': '투자/저축', '적금': '투자/저축', '청약': '투자/저축', '주식': '투자/저축', '펀드': '투자/저축',
    '수입': '수입', '급여': '수입', '월급': '수입', '보너스': '수입', '성과급': '수입', '상여금': '수입', '이자': '수입', '지원금': '수입',
  };

  let resolvedCat = mapping[trimmed] || trimmed;

  if (!trimmed && desc) {
    const descUpper = desc.toUpperCase();
    const keywordRules = [
      { cat: '생활비', keywords: ['국밥', '식당', '카페', '커피', '베이커리', '제과', '치킨', '피자', '스타벅스', '배달의민족', '요기요', '배민', '코스트코', '이마트', '홈플러스', '롯데마트', '쿠팡', '마켓컬리', '다이소', '편의점', 'CU', 'GS25', '지에스네트웍스', '(주)지에스네트웍스', '식비', '외식', '배달', '마트', '식재료', '생활용품', '생필품', '올리브영', '푸드', '반찬', '밀키트'] },
      { cat: '교통/차량', keywords: ['GS칼텍스', 'SK에너지', 'S-OIL', '현대오일뱅크', '주유소', '하이패스', '도로공사', '주차장', '카센터', '택시', '카카오T', '버스', '지하철', 'KTX', 'SRT', '쏘카', '교통', '차량', '주유', '자동차', '대리운전', '통행료', '주차'] },
      { cat: '주거/통신', keywords: ['관리비', '도시가스', '한국전력', 'KEPCO', '수도요금', '전기요금', '가스요금', '아파트관리', '월세', '임대료', '통신비', '통신', '핸드폰', '휴대폰', '인터넷', 'SKT', 'KT', 'LGU+', '요금제', '정수기', '렌탈'] },
      { cat: '보험', keywords: ['실손보험', '암보험', '자동차보험', '보험료', '보험', '생명보험', '손해보험', '화재보험'] },
      { cat: '의료/건강', keywords: ['약국', '병원', '의원', '한의원', '치과', '피부과', '내과', '소아과', '메디컬', '클리닉', '의료비', '건강', '피트니스', '헬스', '요가', '필라테스', '비타민', '영양제'] },
      { cat: '여행/여가', keywords: ['항공', '에어', '호텔', '숙박', '리조트', '펜션', '에어비앤비', '야놀자', '여기어때', '아고다', '익스피디아', '하나투어', '인터파크투어', '여행', '여가', '문화', '영화', '도서', 'CGV', '롯데시네마', '교보문고', '티켓'] },
      { cat: '육아', keywords: ['기저귀', '분유', '아동복', '유아복', '베이비', '유모차', '카시트', '장난감', '육아', '소아과', '산후조리원', '아가', '교육', '학원', '어린이집', '유치원', '키즈카페', '키즈'] },
      { cat: '용돈', keywords: ['용돈', '의류', '패션', '취미', '개인', '백화점', '아울렛', '미용', '헤어', '미용실', '네일'] },
      { cat: '투자/저축', keywords: ['적금', '주식', '예금', '청약', '펀드', '개인연금', '저축', '투자', '증권', '자산'] },
      { cat: '수입', keywords: ['급여', '월급', '보너스', '성과급', '상여금', '이자', '지원금', '수입', '환급', '캐시백', '입금'] },
      { cat: '가족', keywords: ['부모님', '어버이날', '명절', '세뱃돈', '용돈(부모님)', '엄마', '아빠', '시댁', '친정', '가족 행사', '가족 모임'] },
      { cat: '기타', keywords: ['넷플릭스', 'NETFLIX', 'SPOTIFY', '멜론', '유튜브프리미엄', '디즈니플러스', '왓챠', '쿠팡플레이', '아마존프라임', '애플뮤직', '티빙', '웨이브', '회비', '모임 회비', '고정비', '잡비', '공금', '경조사', '경조사비', '세금', '과태료', '구독', '구독료', '주민세', '지방세', '벌금'] },
    ];

    for (const rule of keywordRules) {
      if (rule.cat === '기타' && resolvedCat === '기타') continue;
      const matched = rule.keywords.some((kw) => descUpper.includes(kw.toUpperCase()));
      if (matched) {
        resolvedCat = rule.cat;
        break;
      }
    }
  }

  return resolvedCat;
}

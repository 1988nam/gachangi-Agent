/**
 * 고정비 자동 반영 규칙 — 카드/은행 명세의 특정 상호 패턴을 '해당 월 고정비 행' 갱신으로 라우팅한다.
 *
 *   신한카드 "06월 문래삼환 0104동0901호"  → 6월 시트 고정비 '아파트관리비' 금액 갱신
 *   "서울도시가스(주) 06월 요금"            → 6월 시트 고정비 '가스비' 금액 갱신
 *
 * 기준 월은 '내역에 적힌 청구월'(위 예시의 06월)이다. 카드 청구는 그 다음 달에 잡히지만
 * 가계부에서는 사용월의 고정비로 보는 것이 맞기 때문. 청구월 표기가 없으면 거래월로 폴백한다.
 *
 * 매칭된 거래는 일반 거래 행으로 '기록하지 않고' 고정비 행 금액만 덮어쓴다(이중 계상 방지).
 * 덮어쓰기(=set)라서 같은 명세가 재처리돼도 결과가 같다(멱등).
 */

/** 공백 제거 후 비교 — 시트의 '아파트 관리비'/'아파트관리비' 표기 차이를 흡수. */
function squash(s) {
  return (s || '').replace(/\s+/g, '');
}

export const FIXED_BILL_RULES = [
  {
    key: 'apt',
    label: '아파트관리비',
    // 상호(동/호수 표기는 세대마다 다르므로 단지명만으로 식별)
    vendor: /문래\s*삼환/,
    // 청구월: "06월 문래삼환" 형태를 우선 보고, 없으면 내역 안의 아무 'N월'
    monthPatterns: [/(\d{1,2})\s*월[\s.\-]*문래\s*삼환/, /(\d{1,2})\s*월/],
    // 시트 고정비 행 탐색 키워드(우선순위 순)
    rowKeywords: ['아파트관리비', '관리비'],
    cat: '주거/통신',
  },
  {
    key: 'gas',
    label: '가스비',
    vendor: /도시가스/,
    // 청구월: "서울도시가스(주) 06월 요금" 형태를 우선
    monthPatterns: [/도시가스[^0-9]{0,16}(\d{1,2})\s*월/, /(\d{1,2})\s*월/],
    rowKeywords: ['가스비', '도시가스', '가스요금'],
    cat: '주거/통신',
  },
];

/**
 * 거래 내용이 고정비 청구건인지 판정.
 * @returns {{rule: object, month: number|null}|null} month=null 이면 청구월 표기 없음 → 호출측이 거래월로 폴백
 */
export function matchFixedBill(desc) {
  const s = (desc || '').trim();
  if (!s) return null;
  for (const rule of FIXED_BILL_RULES) {
    if (!rule.vendor.test(s)) continue;
    let month = null;
    for (const re of rule.monthPatterns) {
      const m = s.match(re);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 12) {
        month = n;
        break;
      }
    }
    return { rule, month };
  }
  return null;
}

/**
 * 해당 월 데이터(loadMonthData 결과)에서 규칙에 맞는 고정비 지출 행을 찾는다.
 * 고정비 행 = A열이 '-'인 행(isFixed). 입금 행은 제외한다.
 */
export function findFixedRow(monthRows, rule) {
  const fixed = (monthRows || []).filter((r) => r.isFixed && Number(r.inc) === 0);
  for (const kw of rule.rowKeywords) {
    const needle = squash(kw);
    const hit = fixed.find((r) => squash(r.desc).includes(needle));
    if (hit) return hit;
  }
  return null;
}

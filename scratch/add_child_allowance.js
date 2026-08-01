/**
 * 아동수당·부모급여 고정 "수입" 행 추가 잡 (idempotent / 멱등)
 * ────────────────────────────────────────────────────────────────
 * 각 월 시트(2026년 1~12월)의 고정비 영역에 정부지원금을 '현금 수입' 행으로 넣는다.
 *   - 부모급여 1,000,000원 (0세)         → 수입
 *   - 아동수당   100,000원 (8세 미만)     → 수입
 *
 * 고정비 = A열이 '-' 인 행(날짜 없음). 이 잡은 그 규칙 그대로 A='-' 로 넣는다.
 * 열 구조: A=날짜('-') B=내용 C=수입 D=지출 E=잔액수식(빈칸) F=분류 G=수단
 *
 * 멱등성: 실행 전에 각 월 시트를 읽어 같은 내용(desc)의 고정 수입 행이 이미 있으면 건너뛴다.
 *         → 여러 번 돌려도 중복 생성되지 않는다.
 *
 * 실행:
 *   node scratch/add_child_allowance.js --dry-run   # 미리보기(시트 변경 없음)
 *   node scratch/add_child_allowance.js             # 실제 반영
 *
 * 사전 준비: 저장소 루트에 token.json(OAuth) + .env(GOOGLE_CLIENT_ID/SECRET).
 *            (기존 sync_local_to_sheets.js / scratch/sync_fixed_expenses.js 와 동일)
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// ══════════════════════════════════════════════════════════════
//  ⚙️  설정 — 여기 값만 바꾸면 다른 고정 수입/지출에도 그대로 재사용
// ══════════════════════════════════════════════════════════════
const SPREADSHEET_ID = '1RahTa8uculzZR_nv9lmKnSOYJiqBQ6eco2NYaUh18qo';

// 이 기간(월 시트)에만 넣는다. "하드코딩 대신 기간 지정"의 최소 버전.
const TARGET_MONTHS = ['7월', '8월', '9월', '10월', '11월', '12월'];

const METHOD = '카카오뱅크';   // G열 수단(입금 계좌)
const CATEGORY = '수입';        // F열 분류 (categories.md 의 '수입')

// 각 항목 = 고정행 1개. inc>0 이면 수입, exp>0 이면 지출.
// ⚠️ 부모급여 100만원은 '0세'에만 해당 — 1세부터 50만원으로 바뀌므로,
//    아이 생일이 지나 1세가 되는 달부터는 이 잡의 금액/기간을 조정해야 한다.
//    (근본 해결책은 아래 README 주석 및 대화의 "고정비 개선안" 참고)
const ENTRIES = [
  { desc: '부모급여', inc: 1_000_000, exp: 0 }, // 0세 100만원
  { desc: '아동수당', inc:   100_000, exp: 0 }, // 8세 미만 10만원
];

const DRY_RUN = process.argv.includes('--dry-run');
// ══════════════════════════════════════════════════════════════

const TOKEN_PATH = path.resolve(__dirname, '..', 'token.json');
if (!fs.existsSync(TOKEN_PATH)) {
  console.error('❌ token.json 이 없습니다. 먼저 브라우저 로그인으로 OAuth 인증을 완료하세요.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:8080/oauth2callback'
);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

/** 공백 제거 비교 — '부모 급여' / '부모급여' 표기차 흡수 */
const squash = (s) => (s || '').replace(/\s+/g, '');

async function run() {
  console.log(`🔄 아동수당·부모급여 고정 수입 추가 잡 시작 ${DRY_RUN ? '(DRY-RUN: 미리보기)' : ''}`);
  console.log(`   대상 월: ${TARGET_MONTHS.join(', ')}`);

  // 시트 메타(제목→sheetId) 로드 — 존재하는 월만 처리 + 배경색 포맷에 sheetId 필요
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(title,sheetId)',
  });
  const sheetIdByTitle = {};
  meta.data.sheets.forEach((s) => { sheetIdByTitle[s.properties.title] = s.properties.sheetId; });

  let totalAdded = 0;

  for (const month of TARGET_MONTHS) {
    const sheetId = sheetIdByTitle[month];
    if (sheetId === undefined) {
      console.warn(`⚠️  [${month}] 시트가 없어 건너뜁니다.`);
      continue;
    }

    // 1) 기존 고정행(A='-') 읽어 이미 있는 항목 파악 → 멱등
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${month}!A4:G200`,
    });
    const rows = res.data.values || [];
    const existingFixedDescs = new Set(
      rows
        .filter((r) => (r[0] || '').trim() === '-')     // A열 '-' = 고정행
        .map((r) => squash(r[1]))                        // B열 내용
    );

    // 2) 아직 없는 항목만 추가 대상으로
    const toAppend = ENTRIES.filter((e) => !existingFixedDescs.has(squash(e.desc)));
    if (toAppend.length === 0) {
      console.log(`✅ [${month}] 이미 모두 존재 — 건너뜀`);
      continue;
    }

    const values = toAppend.map((e) => [
      '-',            // A: 날짜(고정)
      e.desc,         // B: 내용
      e.inc || 0,     // C: 수입
      e.exp || 0,     // D: 지출
      '',             // E: 잔액수식(프론트 addFixedExpense 와 동일하게 빈칸)
      CATEGORY,       // F: 분류
      METHOD,         // G: 수단
    ]);

    console.log(`   [${month}] 추가: ${toAppend.map((e) => `${e.desc}(${(e.inc).toLocaleString()}원)`).join(', ')}`);

    if (DRY_RUN) { totalAdded += toAppend.length; continue; }

    // 3) 표 맨 아래에 행 삽입(append) — 프론트 addTransactionsBatch 와 동일 방식
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${month}!A4`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });

    // 4) 새로 들어간 행 A열 배경을 흰색으로(검토필요 노란색 상속 방지)
    const updated = appendRes.data.updates?.updatedRange || '';
    const m = updated.match(/![A-Z]+(\d+):/);
    if (m) {
      const startRow = parseInt(m[1], 10);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: values.map((_, i) => ({
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: startRow - 1 + i,
                endRowIndex: startRow + i,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
              cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          })),
        },
      });
    }

    totalAdded += toAppend.length;
    console.log(`   ✏️ [${month}] ${toAppend.length}행 추가 완료`);
  }

  console.log(`\n🎉 완료 — 총 ${totalAdded}행 ${DRY_RUN ? '추가 예정(미리보기)' : '추가됨'}.`);
  if (DRY_RUN) console.log('   실제 반영하려면 --dry-run 없이 다시 실행하세요.');
}

run().catch((err) => {
  console.error('❌ 실행 중 오류:', err?.message || err);
  process.exit(1);
});

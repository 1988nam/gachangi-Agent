import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const SPREADSHEET_ID = '1RahTa8uculzZR_nv9lmKnSOYJiqBQ6eco2NYaUh18qo';
const TOKEN_PATH = path.resolve(__dirname, '..', 'token.json');

if (!fs.existsSync(TOKEN_PATH)) {
  console.error('❌ token.json이 없습니다.');
  process.exit(1);
}

const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:8080/oauth2callback'
);
oauth2Client.setCredentials(token);

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

// 헬퍼: 셀 색상 기본값
const DEFAULT_WHITE = { red: 1, green: 1, blue: 1 };

async function runSync() {
  console.log('🔄 [4월] 기준 고정비 누락 보정 및 동기화 작업 시작...');

  // 1. Get spreadsheet metadata to retrieve sheet IDs
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(title,sheetId)'
  });
  const sheetMeta = {};
  meta.data.sheets.forEach(s => {
    sheetMeta[s.properties.title] = s.properties.sheetId;
  });

  // 2. 4월 고정비 로드
  console.log('🔍 [4월] 고정비 로딩 중...');
  const resApril = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: ['4월!A4:G120'],
    includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)',
  });
  const aprilRows = resApril.data.sheets?.[0]?.data?.[0]?.rowData || [];
  const aprilFixed = [];

  aprilRows.forEach(row => {
    const cells = row.values || [];
    const rawDate = cells[0]?.formattedValue || '';
    const desc = (cells[1]?.formattedValue || '').trim();
    const inc = parseInt((cells[2]?.formattedValue || '0').replace(/,/g, '')) || 0;
    const exp = parseInt((cells[3]?.formattedValue || '0').replace(/,/g, '')) || 0;
    let cat = (cells[5]?.formattedValue || '').trim();
    const method = (cells[6]?.formattedValue || '').trim();
    const bgColor = cells[0]?.effectiveFormat?.backgroundColor || DEFAULT_WHITE;

    if (!rawDate && !desc && inc === 0 && exp === 0) return;

    if (rawDate === '-') {
      // 4월에 토스 미장 ETF (혜영)의 카테고리가 비어있는 버그 수정
      if (desc.includes('토스 미장 ETF') && !cat) {
        cat = '투자/저축';
      }
      aprilFixed.push({ desc, inc, exp, cat, method, bgColor });
    }
  });

  console.log(`✅ [4월] 고정비 항목 총 ${aprilFixed.length}개 추출 완료.`);

  // 3. 5월 ~ 12월 검사 및 보정
  const targetMonths = ['5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  for (const month of targetMonths) {
    const sheetId = sheetMeta[month];
    if (sheetId === undefined) {
      console.warn(`⚠️ [${month}] 시트가 없어 스킵합니다.`);
      continue;
    }

    console.log(`\n---------------------------------`);
    console.log(`⚙️ [${month}] 시트 보정 시작...`);

    const resMonth = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [`${month}!A4:G200`],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)',
    });
    const monthRows = resMonth.data.sheets?.[0]?.data?.[0]?.rowData || [];

    const existingFixed = [];
    const normalTxs = [];

    monthRows.forEach(row => {
      const cells = row.values || [];
      const rawDate = cells[0]?.formattedValue || '';
      const desc = (cells[1]?.formattedValue || '').trim();
      const inc = parseInt((cells[2]?.formattedValue || '0').replace(/,/g, '')) || 0;
      const exp = parseInt((cells[3]?.formattedValue || '0').replace(/,/g, '')) || 0;
      const cat = (cells[5]?.formattedValue || '').trim();
      const method = (cells[6]?.formattedValue || '').trim();
      const bgColor = cells[0]?.effectiveFormat?.backgroundColor || DEFAULT_WHITE;

      if (!rawDate && !desc && inc === 0 && exp === 0) return;

      if (rawDate === '-') {
        existingFixed.push({ desc, inc, exp, cat, method, bgColor });
      } else {
        normalTxs.push({ date: rawDate, desc, inc, exp, cat, method, bgColor });
      }
    });

    console.log(` - 현재 고정비: ${existingFixed.length}개, 일반 내역: ${normalTxs.length}개`);

    // 누락된 고정비 추가 판별
    const toAdd = [];
    for (const ap of aprilFixed) {
      const found = existingFixed.some(f => f.desc.toLowerCase() === ap.desc.toLowerCase());
      if (!found) {
        // 특별 예외 처리: '도시가스'는 5월 이후 '가스비'로 대체되었으므로 스킵
        if (ap.desc === '도시가스' && existingFixed.some(f => f.desc === '가스비')) {
          continue;
        }
        toAdd.push({ ...ap, date: '-' });
      }
    }

    if (toAdd.length === 0) {
      console.log(` ✅ [${month}] 누락된 고정비가 없습니다.`);
      continue;
    }

    console.log(` ⚠️ [${month}] 누락된 고정비 ${toAdd.length}개 추가 진행...`);
    const newFixedList = [...existingFixed, ...toAdd];
    const combinedList = [...newFixedList, ...normalTxs];

    // 4. 값 및 수식 배열 빌드
    // A-G열 전체를 다시 작성 (E열 수식은 깨짐 방지 및 #REF! 방지를 위해 자동 동적 작성)
    const finalValues = combinedList.map((tx, idx) => {
      const rowNum = 4 + idx;
      let formula = '';
      if (rowNum === 4) {
        formula = ''; // 첫 행은 이전 행이 없으므로 비움
      } else {
        formula = `=E${rowNum - 1}+C${rowNum}-D${rowNum}`; // 잔액 계산 수식
      }
      return [
        tx.date || '-',
        tx.desc || '',
        tx.inc || 0,
        tx.exp || 0,
        formula,
        tx.cat || '',
        tx.method || ''
      ];
    });

    // 5. 시트 비우기 (A4:G250)
    console.log(`   🧹 [${month}] 영역 비우는 중...`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${month}!A4:G250`,
    });

    // 6. 데이터 쓰기 (A4:G)
    const endRow = 4 + finalValues.length - 1;
    console.log(`   ✏️ [${month}] 데이터 기록 중... (행 4 ~ ${endRow})`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${month}!A4:G${endRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: finalValues
      }
    });

    // 7. A열 배경색 포맷팅 적용 (검토 필요 노란색 등 보존)
    console.log(`   🎨 [${month}] A열 배경색 포맷팅 적용 중...`);
    const formatRequests = combinedList.map((tx, idx) => {
      const rowNum = 4 + idx;
      const rgb = tx.bgColor || DEFAULT_WHITE;
      return {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowNum - 1,
            endRowIndex: rowNum,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: rgb
            }
          },
          fields: 'userEnteredFormat.backgroundColor'
        }
      };
    });

    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: formatRequests }
      });
    }

    console.log(` 🎉 [${month}] 시트 보정 완료!`);
  }

  console.log('\n🌟 모든 월의 고정비 및 투자/저축 항목 보정이 완료되었습니다!');
}

runSync().catch(console.error);

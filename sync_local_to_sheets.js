import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const TOKEN_PATH = path.join(__dirname, 'token.json');
const DB_PATH = path.join(__dirname, 'data', 'transactions.json');

if (!fs.existsSync(TOKEN_PATH)) {
  console.error('❌ token.json 파일이 없습니다. 먼저 브라우저에서 로그인하여 인증을 완료해 주세요.');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ 로컬 데이터베이스 파일이 없습니다: ${DB_PATH}`);
  process.exit(1);
}

// Initialize OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  `http://localhost:${PORT}/oauth2callback`
);

const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
oauth2Client.setCredentials(token);

async function runSync() {
  console.log('🔄 로컬 데이터(transactions.json) ➡️ 구글 스프레드시트 동기화 시작...');
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  // 1. Get spreadsheet metadata to retrieve sheet IDs
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(title,sheetId)'
  });

  const sheetMeta = {};
  meta.data.sheets.forEach(s => {
    sheetMeta[s.properties.title] = s.properties.sheetId;
  });

  // 2. Read local transactions
  let fileContent = fs.readFileSync(DB_PATH, 'utf-8');
  if (fileContent.startsWith('\ufeff')) {
    fileContent = fileContent.slice(1);
  }
  const localTransactions = JSON.parse(fileContent);
  console.log(`📂 로컬 데이터 로드 완료 (총 ${localTransactions.length}건)`);

  // Group by month
  const monthlyData = {};
  localTransactions.forEach(tx => {
    const month = tx.month;
    if (!monthlyData[month]) monthlyData[month] = [];
    monthlyData[month].push(tx);
  });

  // Process each month sequentially
  for (const month of Object.keys(monthlyData)) {
    const sheetId = sheetMeta[month];
    if (sheetId === undefined) {
      console.warn(`⚠️  스프레드시트에 [${month}] 시트가 없어 건너뜁니다.`);
      continue;
    }

    // Sort transactions by rowIndex (which corresponds to row number in sheet)
    // to ensure they are written in correct sequential order.
    const txs = monthlyData[month].sort((a, b) => a.rowIndex - b.rowIndex);
    console.log(`⚙️  [${month}] 시트 동기화 중... (${txs.length}건)`);

    // 1. Clear existing data in columns A-D and F-G (leaving E untouched just in case)
    // Clear up to row 500
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        ranges: [
          `${month}!A4:D500`,
          `${month}!F4:G500`
        ]
      }
    });

    // 2. Prepare value data arrays
    const valuesAD = [];
    const valuesFG = [];
    
    txs.forEach(tx => {
      valuesAD.push([
        tx.date || '-',
        tx.desc || '',
        tx.inc || 0,
        tx.exp || 0
      ]);
      valuesFG.push([
        tx.cat || '',
        tx.method || ''
      ]);
    });

    const endRow = 4 + txs.length - 1;

    // 3. Write new values to A4:D and F4:G
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${month}!A4:D${endRow}`,
            values: valuesAD
          },
          {
            range: `${month}!F4:G${endRow}`,
            values: valuesFG
          }
        ]
      }
    });

    // 4. Update background formatting for Column A (Date cell)
    const formatRequests = txs.map((tx, idx) => {
      const row = 4 + idx;
      let red = 1, green = 1, blue = 1;
      
      if (tx.needsReview) {
        red = 1; green = 1; blue = 0; // Yellow
      } else if (tx.bgColor) {
        red = tx.bgColor.red ?? 1;
        green = tx.bgColor.green ?? 1;
        blue = tx.bgColor.blue ?? 1;
      }

      return {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: row - 1,
            endRowIndex: row,
            startColumnIndex: 0,
            endColumnIndex: 1
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red, green, blue }
            }
          },
          fields: 'userEnteredFormat.backgroundColor'
        }
      };
    });

    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests: formatRequests }
      });
    }

    console.log(`✅ [${month}] 시트 동기화 완료!`);
  }

  console.log('🎉 구글 스프레드시트 DB 동기화가 성공적으로 완료되었습니다!');
}

runSync().catch(err => {
  console.error('❌ 동기화 중 오류 발생:', err);
});

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PATH = path.join(__dirname, '..', 'token.json');
const SPREADSHEET_ID = '1RahTa8uculzZR_nv9lmKnSOYJiqBQ6eco2NYaUh18qo';

async function run() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error('token.json이 없습니다.');
    return;
  }

  // Load token.json
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  
  // .env 에서 client_id 등 가져오기 (혹은 직접 하드코딩해서 사용 가능)
  // 환경변수 로드
  import('dotenv').then(async (dotenv) => {
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials(token);

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    try {
      // 1. 시트 메타데이터 조회
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets(properties(title,sheetId))'
      });

      const targetGids = [432519584, 475226696];
      const matchedSheets = [];

      meta.data.sheets.forEach(s => {
        const sheetId = s.properties.sheetId;
        const title = s.properties.title;
        if (targetGids.includes(sheetId)) {
          matchedSheets.push({ sheetId, title });
        }
      });

      console.log('Matched Sheets:', matchedSheets);

      for (const ms of matchedSheets) {
        const range = `${ms.title}!A1:G100`;
        const dataRes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range
        });
        console.log(`\n=== Data for ${ms.title} (gid: ${ms.sheetId}) ===`);
        console.log(JSON.stringify(dataRes.data.values, null, 2));
      }
    } catch (e) {
      console.error('에러 발생:', e);
    }
  });
}

run();

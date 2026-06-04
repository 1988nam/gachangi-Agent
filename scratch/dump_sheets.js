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

async function dump() {
  const months = ['4월', '5월'];
  for (const month of months) {
    console.log(`\n--- [${month}] 모든 거래 내역 ---`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${month}!A4:G100`,
    });
    const rows = res.data.values || [];
    rows.forEach((row, idx) => {
      const rawDate = row[0] || '';
      const desc = row[1] || '';
      const inc = parseInt(row[2]) || 0;
      const exp = parseInt(row[3]) || 0;
      const cat = row[5] || '';
      const method = row[6] || '';
      
      if (!rawDate && !desc && inc === 0 && exp === 0) return;
      console.log(`[행 ${4+idx}] Date: ${rawDate || '-'}, Desc: ${desc}, Inc: ${inc}, Exp: ${exp}, Cat: ${cat}, Method: ${method}`);
    });
  }
}

dump().catch(console.error);

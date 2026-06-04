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

async function dumpColumnE() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `5월!E4:E100`,
    valueRenderOption: 'FORMULA'
  });
  const rows = res.data.values || [];
  console.log(`총 ${rows.length}개 행 조회됨.`);
  rows.forEach((row, idx) => {
    if (row[0]) {
      console.log(`[행 ${4+idx}] E열 수식: ${row[0]}`);
    }
  });
}

dumpColumnE().catch(console.error);

import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PATH = path.join(__dirname, '..', 'token.json');
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = process.env.PORT || 8080;

if (!fs.existsSync(TOKEN_PATH)) {
  console.error('❌ token.json 파일이 없습니다.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  `http://localhost:${PORT}/oauth2callback`
);

const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
oauth2Client.setCredentials(token);

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const fileId = '1l49Q_Wukf7EeGFZAu6CJmmMneDiNSMs6';

async function download() {
  console.log(`📥 Google Drive 파일 다운로드 중 (ID: ${fileId})...`);
  
  // 파일 메타데이터 가져오기
  const meta = await drive.files.get({ fileId });
  console.log(`📄 파일 이름: ${meta.data.name}, MimeType: ${meta.data.mimeType}`);

  // 파일 미디어 데이터 다운로드
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  const destPath = path.join(__dirname, 'scratch', 'downloaded_file.txt');
  if (!fs.existsSync(path.join(__dirname, 'scratch'))) {
    fs.mkdirSync(path.join(__dirname, 'scratch'));
  }

  const dest = fs.createWriteStream(destPath);
  res.data.pipe(dest);

  dest.on('finish', () => {
    console.log(`✅ 다운로드 완료! 저장 위치: ${destPath}`);
    process.exit(0);
  });

  dest.on('error', (err) => {
    console.error('❌ 다운로드 쓰기 중 오류:', err);
    process.exit(1);
  });
}

download().catch(err => {
  console.error('❌ 다운로드 오류:', err);
});

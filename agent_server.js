import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// 정적 파일 서빙 (HTML, CSS, JS 등)
app.use(express.static(__dirname));

// 모든 요청에 대해 기본 index.html 반환 (SPA 및 정적 서버 동작 보장)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 가챙이 대시보드 정적 로컬 서버가 가동되었습니다.`);
  console.log(`🌐 접속 주소: http://localhost:${PORT}`);
  console.log(`💡 이 서버는 정적 파일만 서빙하며, 구글 API 통신은`);
  console.log(`   웹 브라우저에서 직접 수행됩니다.`);
  console.log(`==================================================`);
});

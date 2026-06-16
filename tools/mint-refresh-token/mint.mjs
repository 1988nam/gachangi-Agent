/**
 * 가챙이 무인 인증용 refresh_token 1회 발급 도구 (제로 의존성, Node 18+).
 *
 * 사용법 (PowerShell):
 *   $env:GOOGLE_CLIENT_ID = "....apps.googleusercontent.com"
 *   $env:GOOGLE_CLIENT_SECRET = "GOCSPX-...."
 *   node tools/mint-refresh-token/mint.mjs
 *
 * 사전 준비(Google Cloud Console):
 *   - OAuth 클라이언트 유형: 웹 애플리케이션
 *   - 승인된 리디렉션 URI 에  http://localhost:53682/oauth2callback  추가
 *   - OAuth 동의화면 게시 상태: Production (테스트 상태면 refresh_token이 7일 만에 만료)
 *
 * 출력된 refresh_token 을  `wrangler secret put GOOGLE_REFRESH_TOKEN`  으로 등록하세요.
 */
import http from 'node:http';
import { exec } from 'node:child_process';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ 환경변수 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 를 먼저 설정하세요.');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // refresh_token 발급
    prompt: 'consent', // 매번 refresh_token을 확실히 받기 위해
  }).toString();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err) {
    res.end(`동의 실패: ${err}. 터미널 확인.`);
    console.error('❌ 동의 거부/실패:', err);
    return finish();
  }
  if (!code) {
    res.writeHead(400);
    res.end('authorization code 없음');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const data = await tokenRes.json();

    if (data.refresh_token) {
      res.end('✅ 성공! 터미널로 돌아가 refresh_token을 확인하세요. 이 창은 닫아도 됩니다.');
      console.log('\n──────────────────────────────────────────────');
      console.log('✅ refresh_token 발급 성공:\n');
      console.log(data.refresh_token);
      console.log('\n다음 명령으로 Worker에 등록하세요:');
      console.log('  cd worker && wrangler secret put GOOGLE_REFRESH_TOKEN');
      console.log('  (프롬프트에 위 토큰을 붙여넣기)');
      console.log('──────────────────────────────────────────────\n');
    } else {
      res.end('refresh_token이 응답에 없습니다. 터미널 로그를 확인하세요.');
      console.error('❌ refresh_token 없음. 응답:', JSON.stringify(data, null, 2));
      console.error('   (이미 동의한 계정이면 https://myaccount.google.com/permissions 에서 앱 접근을 제거 후 재시도)');
    }
  } catch (e) {
    res.end('오류: ' + e.message);
    console.error('❌ 토큰 교환 오류:', e);
  } finally {
    finish();
  }

  function finish() {
    setTimeout(() => server.close(() => process.exit(0)), 500);
  }
});

server.listen(PORT, () => {
  console.log('\n브라우저에서 아래 URL을 열고, **가계부 메일이 있는 개인 Gmail 계정**으로 동의하세요:\n');
  console.log(authUrl + '\n');
  const opener =
    process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${authUrl}"`, () => {});
});

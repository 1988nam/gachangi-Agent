# 가챙이 무인 에이전트 Worker

GScript를 대체하는 **Cloudflare Cron Worker**. Gmail `가계부` 라벨 메일의 첨부/본문을
Google Drive 투입 폴더로 자동 적재하고, 기존 가챙이 파이프라인(Gemini 파싱 → 중복판정 →
Google Sheets 기록 → 완료/실패 폴더 분류)을 무인으로 실행한다.

```
[Gmail 가계부 라벨]
   └─(cron 또는 push)→ Worker.runPipeline
        ├─ ingestGmail : 첨부/본문 → Drive SOURCE 업로드 → '가계부/처리완료' 라벨
        └─ processDrive: SOURCE 스캔 → Gemini → 중복판정 → Sheets → ARCHIVE/FAIL
```

- 인증: 개인 Gmail이라 **offline refresh_token** 방식(서비스계정 불가). 토큰/secret은 Worker secret에만 보관.
- 멱등성: 처리한 메일에 `가계부/처리완료` 하위라벨을 붙여 재처리 방지.
- 트리거: 기본 cron 폴링(`*/15`). 거의 실시간이 필요하면 Gmail push(`users.watch`+Pub/Sub) 웹훅을 추가(본체 변경 불필요).

> ⚠️ 진행 상태: **Phase 1(스캐폴드 + 인증)** 완료. `ingestGmail`/`processDrive`는 Phase 2~3에서 채운다.
> 현재 `/run`·cron 은 인증·스코프 스모크 테스트(Gmail 라벨 조회)까지만 수행한다.

---

## 1회 설정

### 1) Google Cloud Console
1. **API 사용 설정**: Gmail API, Google Drive API, Google Sheets API, Generative Language API(Gemini)
2. **OAuth 동의화면**
   - User type: External
   - 게시 상태: **Production(게시됨)** — *테스트 상태로 두면 refresh_token이 7일 만에 만료됩니다.*
   - 스코프 추가: `.../auth/gmail.modify`, `.../auth/drive`, `.../auth/spreadsheets`
   - (개인 Gmail + restricted scope라 "미검증 앱" 경고가 뜨지만 본인 1인 사용은 정상 동작)
3. **사용자 인증 정보 → OAuth 클라이언트 ID**
   - 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI: `http://localhost:53682/oauth2callback`
   - 생성된 **클라이언트 ID / 클라이언트 보안 비밀번호** 보관

### 2) refresh_token 발급 (프로젝트 루트에서)
```powershell
$env:GOOGLE_CLIENT_ID = "....apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET = "GOCSPX-...."
node tools/mint-refresh-token/mint.mjs
```
브라우저 동의 후 터미널에 출력된 `refresh_token` 을 복사.

### 3) KV 네임스페이스 생성
```powershell
cd worker
npm install
wrangler kv namespace create STATE
```
출력된 `id` 를 `wrangler.toml` 의 `[[kv_namespaces]] id` 에 붙여넣기.

### 4) 설정값 + 비밀값 등록
`wrangler.toml` 의 `[vars]` 에 `SPREADSHEET_ID`, `SOURCE/ARCHIVE/FAIL_FOLDER_ID` 채우기.
(가챙이 `js/config.js` 에 있던 값과 동일)

```powershell
cd worker
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put RUN_TOKEN        # 브라우저 버튼 인증용 임의 문자열(직접 생성)
```

### 5) 배포 & 점검
```powershell
cd worker
wrangler deploy
wrangler tail                        # 로그 실시간 확인(다른 터미널)
```
```powershell
# 헬스 체크
curl https://gachangi-agent-worker.<your-subdomain>.workers.dev/health
# 수동 실행 (Phase 1: 라벨 조회 스모크 테스트)
curl -X POST https://gachangi-agent-worker.<your-subdomain>.workers.dev/run `
  -H "Authorization: Bearer <RUN_TOKEN>"
```
`wrangler tail` 로그에 `📬 Gmail 라벨 N개 조회 성공` 이 보이면 인증·스코프 OK.

### 6) GScript 폐기 (Phase 2~3 검증 완료 후)
이 Worker가 Gmail→Drive 적재를 대체하므로, 기존 Apps Script의 **시간 트리거를 비활성화**.
`가계부` 라벨 자동 부여는 Gmail 필터가 계속 담당하므로 그대로 둔다.

---

## 보안 주의
- `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` 은 **절대 `public/`·Git·브라우저로 유출 금지** (Worker secret 전용).
- `RUN_TOKEN` 은 브라우저에 노출되므로(소스 보기 가능) "실행 트리거" 권한만 가짐 — 최악의 경우도 본인 메일 처리를 한 번 더 도는 정도. 더 강한 보호가 필요하면 Google 액세스 토큰 검증(tokeninfo) 방식으로 교체 가능.
- refresh_token 이 무효화되는 경우: 계정 비밀번호 변경 / 6개월 미사용 / 수동 권한 해제 → `mint` 재실행 후 secret 갱신.

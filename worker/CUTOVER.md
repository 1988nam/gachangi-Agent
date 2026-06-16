# GScript → Worker 전환(Cutover) 런북

기존 Google Apps Script(GScript)는 Gmail `가계부` 라벨 메일의 첨부를 Google Drive로 **이동만** 하던 역할이다.
이 Worker가 그 역할(Gmail→Drive 적재) + 이후 처리(Gemini→Sheets→분류)까지 대체한다.
`가계부` 라벨 **자동 부여는 Gmail 필터**가 계속 담당하므로 건드리지 않는다.

---

## ⚠️ 전환 전 반드시 이해할 1가지 — 첫 실행 재적재

Worker는 `가계부` 라벨이 있고 `가계부/처리완료` 라벨이 **없는** 메일을 모두 신규로 간주한다.
GScript 시절 이미 처리된 과거 메일들은 `처리완료` 라벨이 없으므로, 그대로 두면 **첫 실행에서 전부 재적재**된다.
(시트의 거래 중복판정이 대부분 막아주지만, 불필요한 Drive 업로드·Gemini 호출이 발생한다.)

**권장 사전 조치 (둘 중 하나):**
- **(A) 과거 메일 일괄 라벨링** — Gmail에서 `label:가계부` 검색 → 이미 처리 끝난 과거 메일을 전체 선택 →
  `가계부/처리완료` 라벨을 일괄 부여. 그러면 Worker는 진짜 신규 메일만 처리한다. *(가장 깔끔)*
- **(B) 소량 테스트로 시작** — 일단 그대로 첫 실행하되, 결과를 보고 중복이 시트에 새로 들어오지 않는지 확인.
  (중복판정이 날짜·금액·내용으로 걸러줌)

---

## 전환 순서

> 핵심 안전장치: `가계부` 라벨은 메일에 계속 남아 있으므로, **어느 단계에서 멈춰도 메일은 유실되지 않는다.**
> Worker가 실패하면 GScript를 다시 켜기만 하면 된다.

1. **Worker 배포 + 인증 점검** — `worker/README.md`의 1회 설정(1~5단계) 완료.
   `wrangler tail` 로그에 `📬 Gmail 라벨 N개 조회 성공`이 보이면 인증·스코프 OK.

2. **GScript 시간 트리거 비활성화** — Apps Script 편집기 → ⏰ 트리거 → 기존 시간 기반 트리거 삭제(또는 사용 중지).
   *(GScript와 Worker가 동시에 같은 라벨 메일을 다루면 같은 첨부가 SOURCE에 이중 업로드될 수 있으므로, Worker로 넘기기 전에 끈다. 끈 뒤에도 신규 메일은 `가계부` 라벨이 계속 붙으므로 안전.)*

3. **과거 메일 사전 조치** — 위 (A) 또는 (B) 선택.

4. **Worker 수동 1회 실행** — 브라우저 '즉시 실행' 버튼(아래 5단계 후) 또는
   `curl -X POST https://<worker>/run -H "Authorization: Bearer <RUN_TOKEN>"`.
   `wrangler tail`에서 `📎 첨부 적재` → `💾 N월 기록` → `🚀 보관함 이동` 흐름 확인.

5. **브라우저 앱 연동(선택)** — `js/config.js`에 아래 추가 후 GitHub Pages/Cloudflare Pages 재배포:
   ```js
   AGENT_WORKER_URL: 'https://gachangi-agent-worker.<sub>.workers.dev',
   AGENT_RUN_TOKEN:  '<RUN_TOKEN 과 동일>',
   ```
   설정되면 '즉시 실행' 버튼이 로컬 처리 대신 Worker `/run`을 호출한다(미설정 시 기존 로컬 동작 유지).

6. **무인 가동 확인** — cron(`*/15`)이 자동으로 도는지 며칠 관찰. 시트에 새 거래가 노란색(미검토)으로 쌓이면 정상.

---

## 롤백
- Worker에 문제가 생기면: **GScript 트리거를 다시 켜고**, Worker cron은 `wrangler.toml`의 `[triggers] crons`를 비워 재배포하거나 Cloudflare 대시보드에서 비활성화.
- `가계부` 라벨이 유지되므로, 어느 쪽으로 되돌려도 미처리 메일은 그대로 남아 있다.
- 첫 실행이 과거 메일을 잘못 재적재했다면: 브라우저 앱의 **롤백/노란색 일괄 삭제** 기능으로 새로 들어온 미검토 행을 정리.

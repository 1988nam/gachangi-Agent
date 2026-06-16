/**
 * 가챙이 파이프라인 본체 — 트리거 비종속(cron / POST /run / 향후 push 웹훅 공용).
 *
 * 단계:
 *   1) getAccessToken (refresh_token 교환)
 *   2) ingestGmail   — '가계부' 라벨 메일의 첨부/본문 → Drive SOURCE + '처리완료' 라벨  [Phase 2 ✅]
 *   3) processDrive  — SOURCE 스캔 → Gemini 파싱 → 중복판정 → Sheets 기록 → ARCHIVE/FAIL  [Phase 3 ⏳]
 */
import { getAccessToken } from './google-auth.js';
import { ingestGmailToSource } from './ingest.js';
import { processDriveFolder } from './process.js';

export async function runPipeline(env, trigger) {
  const log = [];
  const out = (m) => {
    log.push(m);
    console.log(m);
  };

  out(`▶️ [${trigger}] 가챙이 무인 파이프라인 시작`);

  const token = await getAccessToken(env);
  out('🔑 액세스 토큰 확보(refresh_token 교환) 완료');

  // ── Phase 2: Gmail '가계부' → Drive SOURCE 적재 ──
  // 적재 실패가 본 처리를 막지 않도록 격리(브라우저 파이프라인의 일시오류 철학 유지)
  try {
    await ingestGmailToSource(env, token, out);
  } catch (e) {
    out(`⚠️ Gmail 적재 단계 오류(처리는 계속 진행): ${e.message}`);
  }

  // ── Phase 3: Drive SOURCE → Gemini → Sheets → ARCHIVE/FAIL ──
  await processDriveFolder(env, token, out);

  out('🏁 파이프라인 완료.');
  return log;
}

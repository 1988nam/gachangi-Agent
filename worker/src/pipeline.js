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
import { loadSheetMeta, applyDateFormatToColumnA } from './sheets.js';

export async function runPipeline(env, trigger) {
  const log = [];
  const out = (m) => {
    log.push(m);
    console.log(m);
  };

  out(`▶️ [${trigger}] 가챙이 무인 파이프라인 시작`);

  const token = await getAccessToken(env);
  out('🔑 액세스 토큰 확보(refresh_token 교환) 완료');

  // ── A열 날짜 서식 정규화(비치명적) ──
  // 시트에 일련번호(예: 46177)로 굳어 보이던 날짜를 'mm/dd' 표시로 복원한다(값은 그대로, 서식만 적용).
  // 매 실행 시 모든 월 시트에 멱등 적용 → 기존/신규 행 모두 즉시 날짜로 표시되고, 한 번 적용되면 영구 유지.
  // 신규 메일이 없어도(처리 0건) 기존 데이터가 고쳐지도록 처리 단계와 무관하게 항상 수행한다.
  try {
    const meta = await loadSheetMeta(token, env.SPREADSHEET_ID);
    const monthIds = Object.keys(meta).filter((t) => /^\d{1,2}월$/.test(t)).map((t) => meta[t]);
    await applyDateFormatToColumnA(token, env.SPREADSHEET_ID, monthIds, {
      startRow: parseInt(env.START_ROW || '4', 10),
    });
    out(`🗓️ 월 시트 ${monthIds.length}개 A열 날짜 서식(mm/dd) 적용 완료`);
  } catch (e) {
    out(`⚠️ A열 날짜 서식 적용 건너뜀(처리는 계속): ${e.message}`);
  }

  // ── Phase 2: Gmail '가계부' → Drive SOURCE 적재 ──
  // 적재 실패가 본 처리를 막지 않도록 격리(브라우저 파이프라인의 일시오류 철학 유지)
  let ingest = { mails: 0, uploaded: 0 };
  try {
    const r = await ingestGmailToSource(env, token, out);
    if (r) ingest = r;
  } catch (e) {
    out(`⚠️ Gmail 적재 단계 오류(처리는 계속 진행): ${e.message}`);
  }

  // ── Phase 3: Drive SOURCE → Gemini → Sheets → ARCHIVE/FAIL ──
  const proc = (await processDriveFolder(env, token, out)) || { ok: 0, fail: 0, added: 0, skipped: 0 };

  out('🏁 파이프라인 완료.');
  return {
    log,
    summary: {
      mails: ingest.mails || 0,
      uploaded: ingest.uploaded || 0,
      added: proc.added || 0,
      skipped: proc.skipped || 0,
      ok: proc.ok || 0,
      fail: proc.fail || 0,
    },
  };
}

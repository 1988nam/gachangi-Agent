/**
 * 가챙이 무인 에이전트 Worker — 엔트리포인트.
 *
 *  - scheduled (cron)   : 주기적으로 runPipeline 실행 (Gmail '가계부' → Drive → Sheets)
 *  - POST /run          : 브라우저 '즉시 실행'·캡쳐 업로드가 호출 (RUN_TOKEN 보호)
 *  - GET  /health       : 상태 점검
 *  - (향후) POST /gmail-push : Gmail push 웹훅을 얹을 자리
 *
 * ── 왜 POST /run 이 직접 파이프라인을 돌리지 않는가 ──
 * 과거엔 /run 이 ctx.waitUntil(safeRun(...)) 으로 요청 컨텍스트에서 백그라운드 실행했다.
 * 그런데 실행 이력 28건이 '전부 cron' 이었고 수동(manual) 실행은 단 한 번도 완주하지 못했다.
 * fetch 핸들러의 waitUntil 작업은 파일 몇 개를 처리하는 도중 런타임에 종료돼, 일부만 기록된 채
 * 락도 이력도 알림도 남지 않는 '조용한 중단'이 반복됐다(2026-07-31 10:45·12:04 실측).
 * → /run 은 요청 플래그(run_requested)만 남기고, 실제 처리는 검증된 scheduled(cron) 경로에서 한다.
 *   폴링 크론이 2분마다 플래그를 집어 처리하므로 업로드 후 최대 2분 안에 시작된다.
 */
import { runPipeline } from './pipeline.js';

/** 일별 정기 크론(메일 수집 포함, 항상 실행). 나머지 크론은 폴링으로 간주해 요청이 있을 때만 실행한다.
 *  wrangler.toml의 crons와 맞춰 둘 것. */
const DAILY_CRONS = ['0 23 * * *', '0 9 * * *'];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env, event.cron));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'gachangi-agent-worker' }, 200, env);
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      if (!isAuthorized(request, env)) {
        return json({ error: 'unauthorized' }, 401, env);
      }
      // 여기서 직접 실행하지 않는다(위 주석 참고). 요청만 남기면 폴링 크론이 집어간다.
      // 실행 중이어도 요청은 유실되지 않는다 — 현재 실행이 끝난 뒤 다음 폴에서 처리된다.
      // (과거엔 실행 중이면 409로 거절돼, 업로드한 파일이 다음 일별 크론까지 방치됐다)
      await env.STATE.put('run_requested', new Date().toISOString(), { expirationTtl: 3600 });
      let busy = null;
      try { busy = await env.STATE.get('run_lock'); } catch (_) {}
      return json(
        {
          ok: true,
          queued: true,
          message: busy
            ? '현재 처리 중입니다 — 이번 요청은 완료 직후 이어서 처리됩니다.'
            : '처리를 예약했습니다. 최대 2분 안에 시작됩니다.',
        },
        202,
        env
      );
    }

    if (url.pathname === '/logs' && request.method === 'GET') {
      if (!isAuthorized(request, env)) {
        return json({ error: 'unauthorized' }, 401, env);
      }
      let runs = [];
      try { runs = (await env.STATE.get('run_history', { type: 'json' })) || []; } catch (_) {}
      return json({ ok: true, runs }, 200, env);
    }

    // 비챙이(Bichangi) 풀 상태 — 최근 실행 요약만 노출(거래 금액 등 민감정보 없음).
    // AGENT_INGEST_TOKEN 설정 시 ?token= 또는 Bearer로 보호.
    if (url.pathname === '/api/status' && request.method === 'GET') {
      if (env.AGENT_INGEST_TOKEN) {
        const tok = url.searchParams.get('token')
          || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (tok !== env.AGENT_INGEST_TOKEN) return json({ error: 'forbidden' }, 403, env);
      }
      let runs = [];
      try { runs = (await env.STATE.get('run_history', { type: 'json' })) || []; } catch (_) {}
      const last = runs[0];
      if (!last) {
        return json({ status: 'ok', level: 'info', summary: '가챙이: 최근 처리 이력 없음(대기 중)' }, 200, env);
      }
      const s = last.summary || {};
      let lastCronAt = null;
      try { lastCronAt = await env.STATE.get('last_cron_at'); } catch (_) {}
      const lastCronMs = lastCronAt ? new Date(lastCronAt).getTime() : 0;
      // 마지막 cron 실행이 20h 넘게 없으면 무인 가동 중단 의심(야간 최대 공백 14h 고려).
      const stale = lastCronAt ? (Date.now() - lastCronMs > 20 * 60 * 60 * 1000) : false;
      // 실패는 매 실행마다 기록되지만 0건 성공은 이력에 남기지 않는다(노이즈 억제). 그래서 옛
      // 실패가 run_history[0]에 박힌 채 이후 (0건)성공이 그를 밀어내지 못해 비챙이에 stale 경보가
      // 계속 울린다. 마지막 기록 실패 이후 cron이 더 돌았다면(lastCronAt가 충분히 나중) 그 사이
      // 실행은 (0건)성공한 것 → 옛 실패는 해소된 것으로 본다.
      const recordedError = last.ok === false;
      const errorCleared = recordedError && lastCronMs > new Date(last.at).getTime() + 10 * 60 * 1000;
      const hasError = recordedError && !errorCleared;
      const items = [
        `최근 실행: ${last.at} (${last.trigger})`,
        `신규 ${s.added || 0} / 중복 ${s.skipped || 0} / 실패 ${s.fail || 0}${s.held ? ` / 보류 ${s.held}` : ''}${s.fixedUpdated ? ` / 고정비 ${s.fixedUpdated}` : ''}${s.remaining ? ` / 잔여 ${s.remaining}` : ''}`,
      ];
      if (hasError) items.push(`오류: ${(last.error || '').slice(0, 120)}`);
      else if (errorCleared) items.push(`이후 정상 실행 재개됨 (최근 점검 ${lastCronAt})`);
      return json({
        status: hasError ? 'error' : (s.fail > 0 || stale ? 'alert' : 'ok'),
        level: hasError || s.fail > 0 ? 'alert' : 'info',
        summary: hasError
          ? `가챙이 마지막 실행 실패: ${(last.error || '').slice(0, 80)}`
          : errorCleared
            ? `가챙이 정상 — 이전 실패 이후 정상 실행 재개됨`
            : `가챙이 정상 — 최근 신규 ${s.added || 0}건${s.fail ? `, 실패 ${s.fail}건` : ''}${s.held ? `, 보류 ${s.held}건` : ''}${stale ? ' · ⚠️실행 정체' : ''}`,
        items,
      }, 200, env);
    }

    return json({ error: 'not found' }, 404, env);
  },
};

/**
 * 크론 진입점. 일별 크론은 항상 실행하고, 폴링 크론은 앱의 실행 요청이 있을 때만 실행한다.
 * (수동 실행을 fetch의 waitUntil이 아니라 이 경로로 태우기 위한 구조 — 파일 상단 주석 참고)
 */
async function handleScheduled(env, cronExpr) {
  let requested = null;
  try { requested = await env.STATE.get('run_requested'); } catch (_) {}
  console.log(`⏰ scheduled 진입: cron="${cronExpr}" / 요청=${requested || '없음'}`);

  // 일별 크론은 요청 여부와 무관하게 항상 실행(메일 수집 포함).
  // 그 외(폴링)는 요청이 있을 때만 실행한다. 크론 문자열 비교가 어긋나도 '요청이 있으면 실행'은
  // 그대로 성립하도록, 폴링 판정을 '일별 목록에 없으면 폴링'으로 둔다.
  if (DAILY_CRONS.includes(cronExpr)) {
    await safeRun(env, 'cron');
    return;
  }

  if (!requested) return; // 요청 없음 — 폴링은 KV 읽기 1회로 끝난다(비용 무시 가능)

  let busy = null;
  try { busy = await env.STATE.get('run_lock'); } catch (_) {}
  if (busy) return; // 플래그를 남겨둔 채 넘긴다 → 실행이 끝나면 다음 폴에서 처리

  try { await env.STATE.delete('run_requested'); } catch (_) {}
  const ran = await safeRun(env, 'manual');
  if (!ran) {
    // 경합으로 건너뛴 경우 요청을 되살려 다음 폴에서 처리되게 한다(요청 유실 방지).
    try { await env.STATE.put('run_requested', requested, { expirationTtl: 3600 }); } catch (_) {}
  }
}

/** 동시 실행 방지 락(KV) + 안전 래퍼. KV는 최종 일관성이라 단일 사용자 저빈도에 한해 충분.
 *  @returns {Promise<boolean>} 실제로 파이프라인을 돌렸으면 true, 락 때문에 건너뛰었으면 false */
async function safeRun(env, trigger) {
  const existing = await env.STATE.get('run_lock');
  if (existing) {
    console.log(`⏭️ [${trigger}] 다른 실행이 진행 중 — 이번 트리거는 건너뜁니다.`);
    return false;
  }

  // 직전 실행이 '시작만 하고 끝나지 않았는지' 판정.
  // 런타임이 실행을 강제 종료하면 catch·finally가 모두 건너뛰어져 이력도 알림도 남지 않는다.
  // 시작/종료 시각을 각각 남겨두면 다음 실행이 그 흔적을 보고 조용한 중단을 표면화할 수 있다.
  let diedSilently = null;
  try {
    const [s, f] = await Promise.all([
      env.STATE.get('last_run_started_at'),
      env.STATE.get('last_run_finished_at'),
    ]);
    if (s && (!f || new Date(s).getTime() > new Date(f).getTime())) diedSilently = s;
  } catch (_) {}
  // 안전장치: 15분 뒤 자동 해제(크래시로 락이 남는 것 방지).
  // 재시도 백오프 포함 실행이 5분을 넘길 수 있어(파일당 최대 ~62초), 도중 만료 → 동시 실행
  // → 이중 기록이 되지 않도록 여유를 둔다.
  await env.STATE.put('run_lock', String(Date.now()), { expirationTtl: 900 });
  const at = new Date().toISOString();
  try { await env.STATE.put('last_run_started_at', at); } catch (_) {}
  if (diedSilently) {
    console.warn(`⚠️ 직전 실행(${diedSilently})이 완주하지 못했습니다 — 실행 한도 초과로 강제 종료된 것으로 보입니다.`);
  }
  let remaining = 0;
  try {
    const result = await runPipeline(env, trigger);
    remaining = (result.summary && result.summary.remaining) || 0;
    // liveness는 파이프라인 '완주' 후에만 기록. (버그수정) 과거엔 실행 '시작' 시 무조건 기록해,
    // 파이프라인이 매번 죽거나 수집이 완전히 멈춰도 stale 판정·오류 자동해소가 '정상'으로 오판했다.
    try { await env.STATE.put('last_cron_at', new Date().toISOString()); } catch (_) {}
    // 0건(아무 것도 처리하지 않은 성공) 실행은 노이즈이므로 이력에 남기지 않는다.
    // 단, 보류(held)와 Gmail 적재 오류는 '조용한 실패'이므로 반드시 기록한다.
    const s = result.summary || {};
    const processed = (s.mails || 0) + (s.uploaded || 0) + (s.added || 0) + (s.skipped || 0) + (s.fail || 0) + (s.held || 0) + (s.fixedUpdated || 0);
    if (s.ingestError || processed > 0) {
      const entry = { at, trigger, ok: !s.ingestError, summary: s, log: (result.log || []).slice(-80) };
      if (s.ingestError) entry.error = `Gmail 적재 실패: ${s.ingestError}`;
      await recordRun(env, entry);
      const items = [];
      if (s.added) items.push(`신규 ${s.added}건`);
      if (s.fixedUpdated) items.push(`고정비 갱신 ${s.fixedUpdated}건`);
      if (s.skipped) items.push(`중복 ${s.skipped}건`);
      if (s.held) items.push(`보류 ${s.held}건`);
      if (s.fail) items.push(`실패 ${s.fail}건`);
      if (s.mails) items.push(`메일 ${s.mails}건`);
      if (s.remaining) items.push(`미처리 잔여 ${s.remaining}개(이어서 처리)`);
      if (diedSilently) items.push(`⚠️ 직전 실행(${diedSilently})이 중단된 흔적 감지`);
      await notifyBichangi(env, {
        level: (s.ingestError || s.fail > 0) ? 'alert' : 'info',
        title: s.ingestError
          ? '가챙이: Gmail 적재 실패 (확인 필요)'
          : s.fail > 0
            ? `가챙이: 처리 실패 ${s.fail}건 (확인 필요)`
            : (s.held > 0 && !s.added)
              ? `가챙이: ${s.held}건 보류 — 다음 실행 재시도`
              : (!s.added && s.fixedUpdated)
                ? `가챙이: 고정비 ${s.fixedUpdated}건 갱신`
                : `가챙이: 신규 거래 ${s.added || 0}건 기록${s.fixedUpdated ? ` · 고정비 ${s.fixedUpdated}건 갱신` : ''}`,
        detail: s.ingestError ? s.ingestError.slice(0, 300) : `[${trigger}] 가계부 자동 기록`,
        items,
      });
    } else {
      console.log(`🟰 [${trigger}] 처리할 항목 0건 — 이력에 기록하지 않습니다.`);
    }
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error(`❌ [${trigger}] 파이프라인 실패:`, (e && (e.stack || e.message)) || e);
    await recordRun(env, { at, trigger, ok: false, error: msg, log: [] });
    await notifyBichangi(env, {
      level: 'alert',
      title: /invalid_grant|access_token/i.test(msg)
        ? '가챙이 중단: Google 인증 만료 — refresh_token 재발급 필요'
        : '가챙이 파이프라인 실패',
      detail: msg.slice(0, 300),
    });
  } finally {
    try { await env.STATE.put('last_run_finished_at', new Date().toISOString()); } catch (_) {}
    await env.STATE.delete('run_lock');
  }

  // ── 잔여 파일 이어달리기 ──
  // 한 실행의 처리량을 제한했으므로, 남은 파일이 있으면 실행 요청 플래그를 다시 세워
  // 폴링 크론(최대 2분)이 이어받게 한다. 자기 자신의 /run을 fetch로 부르지 않는 이유는,
  // 그 경로(fetch + waitUntil)가 애초에 완주하지 못하는 경로이기 때문이다.
  if (remaining > 0) {
    try {
      await env.STATE.put('run_requested', new Date().toISOString(), { expirationTtl: 3600 });
      console.log(`🔁 잔여 ${remaining}개 — 다음 폴링(최대 2분)에서 이어서 처리합니다.`);
    } catch (e) {
      console.error('잔여 처리 예약 실패:', e && e.message);
    }
  }
  return true;
}

/** 실행 이력을 KV에 최근 30개 저장 (앱의 GET /logs 조회용 — 무인 실행 관측성 확보) */
async function recordRun(env, entry) {
  let hist = [];
  try { hist = (await env.STATE.get('run_history', { type: 'json' })) || []; } catch (_) {}
  hist.unshift(entry);
  hist = hist.slice(0, 30);
  try { await env.STATE.put('run_history', JSON.stringify(hist)); } catch (_) {}
}

/** 비챙이(Bichangi)로 이벤트 PUSH. 미설정 시 무동작, 실패해도 파이프라인에 영향 없음. */
async function notifyBichangi(env, { level, title, detail, items }) {
  if (!env.SVC_BICHANGI || !env.AGENT_INGEST_TOKEN) return;
  try {
    // 서비스 바인딩으로 호출(host는 무시됨, path /api/agent-event가 비챙이에서 처리).
    await env.SVC_BICHANGI.fetch('https://bichangi/api/agent-event', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AGENT_INGEST_TOKEN}`,
      },
      body: JSON.stringify({ agent: '가챙이', level, title, detail, items }),
    });
  } catch (e) {
    console.error('Bichangi 통지 실패:', e && e.message);
  }
}

function isAuthorized(request, env) {
  if (!env.RUN_TOKEN) return false;
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token.length > 0 && token === env.RUN_TOKEN;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) },
  });
}

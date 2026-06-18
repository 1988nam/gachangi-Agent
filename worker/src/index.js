/**
 * 가챙이 무인 에이전트 Worker — 엔트리포인트.
 *
 *  - scheduled (cron)   : 주기적으로 runPipeline 실행 (Gmail '가계부' → Drive → Sheets)
 *  - POST /run          : 브라우저 '즉시 실행' 버튼이 호출 (RUN_TOKEN 보호)
 *  - GET  /health       : 상태 점검
 *  - (향후) POST /gmail-push : Gmail push 웹훅을 얹을 자리
 *
 * 트리거 방식은 교체/병행 가능하며, runPipeline 본체는 트리거에 종속되지 않는다.
 */
import { runPipeline } from './pipeline.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(safeRun(env, 'cron'));
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
      // 즉시 202 응답 후 백그라운드 실행(브라우저 타임아웃 방지)
      ctx.waitUntil(safeRun(env, 'manual'));
      return json(
        { ok: true, message: '파이프라인 실행을 시작했습니다. 로그는 `wrangler tail`로 확인하세요.' },
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
      // 마지막 cron 실행이 20h 넘게 없으면 무인 가동 중단 의심(야간 최대 공백 14h 고려).
      const stale = lastCronAt ? (Date.now() - new Date(lastCronAt).getTime() > 20 * 60 * 60 * 1000) : false;
      const hasError = last.ok === false;
      const items = [
        `최근 실행: ${last.at} (${last.trigger})`,
        `신규 ${s.added || 0} / 중복 ${s.skipped || 0} / 실패 ${s.fail || 0}`,
      ];
      if (hasError) items.push(`오류: ${(last.error || '').slice(0, 120)}`);
      return json({
        status: hasError ? 'error' : (s.fail > 0 || stale ? 'alert' : 'ok'),
        level: hasError || s.fail > 0 ? 'alert' : 'info',
        summary: hasError
          ? `가챙이 마지막 실행 실패: ${(last.error || '').slice(0, 80)}`
          : `가챙이 정상 — 최근 신규 ${s.added || 0}건${s.fail ? `, 실패 ${s.fail}건` : ''}${stale ? ' · ⚠️실행 정체' : ''}`,
        items,
      }, 200, env);
    }

    return json({ error: 'not found' }, 404, env);
  },
};

/** 동시 실행 방지 락(KV) + 안전 래퍼. KV는 최종 일관성이라 단일 사용자 저빈도에 한해 충분. */
async function safeRun(env, trigger) {
  // 무인 가동 liveness: 0건 실행도 포함해 매 트리거마다 기록(풀 상태의 '정체' 판정용).
  try { await env.STATE.put('last_cron_at', new Date().toISOString()); } catch (_) {}
  const existing = await env.STATE.get('run_lock');
  if (existing) {
    console.log(`⏭️ [${trigger}] 다른 실행이 진행 중 — 이번 트리거는 건너뜁니다.`);
    return;
  }
  // 안전장치: 5분 뒤 자동 해제(크래시로 락이 남는 것 방지)
  await env.STATE.put('run_lock', String(Date.now()), { expirationTtl: 300 });
  const at = new Date().toISOString();
  try {
    const result = await runPipeline(env, trigger);
    // 0건(아무 것도 처리하지 않은 성공) 실행은 노이즈이므로 이력에 남기지 않는다.
    // → '최근 N건'이 실제 처리/실패가 있었던 실행으로만 채워진다.
    const s = result.summary || {};
    const processed = (s.mails || 0) + (s.uploaded || 0) + (s.added || 0) + (s.skipped || 0) + (s.fail || 0);
    if (processed > 0) {
      await recordRun(env, { at, trigger, ok: true, summary: s, log: (result.log || []).slice(-80) });
      const items = [];
      if (s.added) items.push(`신규 ${s.added}건`);
      if (s.skipped) items.push(`중복 ${s.skipped}건`);
      if (s.fail) items.push(`실패 ${s.fail}건`);
      if (s.mails) items.push(`메일 ${s.mails}건`);
      await notifyBichangi(env, {
        level: s.fail > 0 ? 'alert' : 'info',
        title: s.fail > 0
          ? `가챙이: 처리 실패 ${s.fail}건 (확인 필요)`
          : `가챙이: 신규 거래 ${s.added || 0}건 기록`,
        detail: `[${trigger}] 가계부 자동 기록`,
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
    await env.STATE.delete('run_lock');
  }
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

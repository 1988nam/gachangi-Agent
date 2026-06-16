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

    return json({ error: 'not found' }, 404, env);
  },
};

/** 동시 실행 방지 락(KV) + 안전 래퍼. KV는 최종 일관성이라 단일 사용자 저빈도에 한해 충분. */
async function safeRun(env, trigger) {
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
    await recordRun(env, { at, trigger, ok: true, summary: result.summary, log: (result.log || []).slice(-80) });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error(`❌ [${trigger}] 파이프라인 실패:`, (e && (e.stack || e.message)) || e);
    await recordRun(env, { at, trigger, ok: false, error: msg, log: [] });
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

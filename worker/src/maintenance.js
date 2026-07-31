/**
 * 유지보수 작업 — 이미 시트에 기록된 데이터를 현재 규칙에 맞게 교정한다.
 *
 * KV `maintenance_request`에 요청을 넣으면 폴링 크론이 집어 실행하고 결과를 `maintenance_result`에 남긴다.
 * 요청 형식: { "task": "normalize-categories", "months": ["7월"], "dryRun": true }
 * dryRun=true면 바뀔 내용만 수집하고 시트는 건드리지 않는다 — 항상 먼저 확인한 뒤 적용할 것.
 */
import { loadSheetMeta, loadMonthData, normalizeCategory } from './sheets.js';
import { googleFetch } from './google-api.js';
import { DEFAULT_CATEGORIES } from './constants.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * 분류(F열)가 허용 목록 밖인 행을 찾아 내용 기반으로 교정한다.
 *
 * 분류가 '비어 있는' 행은 건드리지 않는다 — 사용자가 의도적으로 비워둔 것일 수 있고,
 * 이 작업의 목적은 '편의점'처럼 목록에 없는 값이 기록된 행을 되돌리는 것이기 때문.
 */
export async function normalizeCategories(env, token, { months, dryRun = true }, out) {
  const startRow = parseInt(env.START_ROW || '4', 10);
  const meta = await loadSheetMeta(token, env.SPREADSHEET_ID);
  const monthSheets = Object.keys(meta).filter((t) => /^\d{1,2}월$/.test(t));
  const targets = (months && months.length ? months : monthSheets).filter((m) => {
    if (meta[m] === undefined) {
      out(`⚠️ '${m}' 시트가 없어 건너뜁니다.`);
      return false;
    }
    return true;
  });

  const changes = [];
  const scanned = {};

  for (const m of targets) {
    const rows = await loadMonthData(token, env.SPREADSHEET_ID, m, startRow);
    scanned[m] = rows.length;
    for (const r of rows) {
      const cur = (r.cat || '').trim();
      if (!cur) continue;                          // 빈 분류는 대상 아님
      if (DEFAULT_CATEGORIES.includes(cur)) continue; // 이미 허용 목록 안
      const fixed = normalizeCategory(cur, r.desc);
      if (!fixed || fixed === cur) continue;
      changes.push({
        month: m,
        rowIndex: r.rowIndex,
        date: r.date,
        desc: r.desc,
        amount: r.exp || r.inc || 0,
        from: cur,
        to: fixed,
      });
    }
    out(`🔎 ${m}: ${rows.length}행 점검 — 교정 대상 ${changes.filter((c) => c.month === m).length}건`);
  }

  if (!dryRun && changes.length > 0) {
    // F열만 갱신한다(내용·금액·시각은 건드리지 않음). 한 번에 200셀씩 나눠 보낸다.
    const data = changes.map((c) => ({ range: `${c.month}!F${c.rowIndex}`, values: [[c.to]] }));
    for (let i = 0; i < data.length; i += 200) {
      await googleFetch(token, `${BASE}/${env.SPREADSHEET_ID}/values:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 200) }),
      });
    }
    out(`✅ ${changes.length}건 분류 교정 완료`);
  } else if (dryRun) {
    out(`🧪 점검(dryRun) — 시트는 변경하지 않았습니다. 교정 대상 ${changes.length}건`);
  }

  return { task: 'normalize-categories', dryRun, months: targets, scanned, count: changes.length, changes };
}

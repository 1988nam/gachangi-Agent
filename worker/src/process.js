/**
 * Phase 3 — Drive SOURCE 폴더 처리 (agent_controller.js runAgentSync 루프 이식).
 *
 * SOURCE 스캔 → 다운로드 → (텍스트 정제 / 바이너리 base64) → Gemini 파싱
 *  → 카테고리/결제수단 자가교정 → 월별 중복판정 → Sheets 일괄 기록(노란색)
 *  → 성공: ARCHIVE 이동+rename / 일시오류: SOURCE 유지 / 영구오류: FAIL 격리.
 */
import { listFolderFiles, downloadFileBytes, moveFile } from './drive.js';
import {
  loadSheetMeta,
  loadMonthData,
  addTransactionsBatch,
  normalizeCategory,
  createMonthSheetFromTemplate,
  updateFixedRowAmount,
} from './sheets.js';
import { buildPromptForSource, cleanHtmlText, geminiParse } from './gemini.js';
import { selfHealMethod } from './method.js';
import { decodeBytes } from './decode.js';
import { bytesToBase64, normalizeTime } from './util.js';
import { DEFAULT_METHODS } from './constants.js';
import { matchFixedBill, findFixedRow } from './fixed.js';

// 상태코드가 없는 오류(네트워크/파싱 등)의 일시오류 판정용 키워드.
// 'gemini'는 의도적으로 제외 — Gemini 호출 실패는 err.status(4xx/5xx)로 판정한다.
const TEMP_ERROR_KEYS = [
  'quota', 'rate limit', 'too many requests', '429', '503', '500',
  'fetch', 'network', 'timeout', '재시도', '응답하지 않습니다',
];

/**
 * 시트의 기존 행(ex)과 새로 파싱된 항목(item)이 같은 거래인지 판정.
 *
 * 시각은 '양쪽 다 있을 때만' 비교한다. 같은 날 같은 금액·같은 상호라도 시각이 다르면
 * 서로 다른 실거래이므로 중복이 아니다(예: 04/30 쿠팡 100,000원 2건).
 * 한쪽이라도 시각이 없으면(카드 명세서·H열이 비어 있는 과거 행) 종전대로 날짜·금액·내용으로만
 * 판정한다 → 판정이 느슨해지기만 하고 엄격해지지 않으므로 이미 기록된 건이 다시 들어올 위험은 없다.
 */
export function isDuplicateOf(ex, item) {
  const incMatch = Number(ex.inc) === Number(item.inc);
  const expMatch = Number(ex.exp) === Number(item.exp);
  const ed = (ex.desc || '').trim();
  const id = (item.desc || '').trim();
  const descMatch = ed === id || (ed !== '' && id !== '' && (ed.includes(id) || id.includes(ed)));
  // 고정비 행은 날짜가 없으므로(A열 '-') 같은 달 안에서는 날짜를 따지지 않는다.
  const dateMatch = ex.isFixed ? true : ex.date === item.date;
  const timeMatch = !ex.time || !item.time ? true : ex.time === item.time;
  return dateMatch && timeMatch && incMatch && expMatch && descMatch;
}

/** 로그용 천단위 구분(Intl 의존 없이). */
function won(n) {
  return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 월 시트 id 확보 — 없으면 템플릿(기존 월 시트) 복제로 생성한다.
 * 생성 불가/실패 시 null을 반환하고, 호출측은 해당 건을 '보류'(SOURCE 유지)로 처리한다.
 */
async function ensureSheetId(token, env, meta, templateId, sheetName, startRow, out, reason) {
  if (meta[sheetName] !== undefined) return meta[sheetName];
  if (templateId == null) {
    out(`⚠️ 복제할 템플릿(월 시트)이 없어 '${sheetName}' ${reason} 보류(SOURCE 유지)`);
    return null;
  }
  try {
    const id = await createMonthSheetFromTemplate(token, env.SPREADSHEET_ID, sheetName, templateId, { startRow });
    meta[sheetName] = id;
    out(`🆕 신규 월 시트 '${sheetName}' 자동 생성(템플릿 복제) 완료`);
    return id;
  } catch (e) {
    out(`⚠️ '${sheetName}' 시트 자동 생성 실패: ${e.message} — ${reason} 보류(SOURCE 유지)`);
    return null;
  }
}

export async function processDriveFolder(env, token, out) {
  const allFiles = await listFolderFiles(token, env.SOURCE_FOLDER_ID);
  if (allFiles.length === 0) {
    out('📭 SOURCE에 처리할 신규 파일이 없습니다.');
    return { ok: 0, fail: 0, added: 0, skipped: 0, held: 0, fixedUpdated: 0, remaining: 0 };
  }

  // ── 한 실행에서 처리할 양을 제한한다 ──
  // 파일 1개당 Drive 다운로드 + base64 인코딩 + Gemini 호출(수~수십 초) + Sheets 6~9회 호출이 든다.
  // 파일을 많이 올린 채 전부를 한 번에 돌리면 Worker 실행 한도(CPU·서브리퀘스트·수명)에 걸려
  // 런타임이 실행을 통째로 죽인다. 이때 safeRun의 finally가 실행되지 않아 run_lock이 남고,
  // 이력·알림도 남지 않아 '조용한 중단'이 된다(2026-07-31 10:45 실행에서 실제 발생).
  // → 상한만큼만 처리하고 나머지는 SOURCE에 남긴다. 남은 파일은 다음 실행이 이어서 처리한다(멱등).
  const maxFiles = Math.max(1, parseInt(env.MAX_FILES_PER_RUN || '5', 10));
  const budgetMs = Math.max(10000, parseInt(env.RUN_BUDGET_MS || '120000', 10));
  const startedAt = Date.now();
  const files = allFiles.slice(0, maxFiles);
  let remaining = allFiles.length - files.length;
  if (remaining > 0) {
    out(`📂 SOURCE 파일 ${allFiles.length}개 중 ${files.length}개 처리 시작 (나머지 ${remaining}개는 다음 실행에서)`);
  } else {
    out(`📂 SOURCE 파일 ${files.length}개 처리 시작`);
  }

  const meta = await loadSheetMeta(token, env.SPREADSHEET_ID);
  const startRow = parseInt(env.START_ROW || '4', 10);
  const sheetCache = {};

  // 신규 월 시트 자동 생성용 템플릿(기존 월 시트 중 하나). 없으면 자동 생성 불가 → 보류.
  const templateTitle = Object.keys(meta).find((t) => /^\d{1,2}월$/.test(t));
  const templateId = templateTitle != null ? meta[templateTitle] : null;

  let ok = 0, fail = 0, added = 0, skipped = 0, held = 0, fixedUpdated = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    // 파일 수 상한 안이라도 실행이 너무 길어지면(느린 Gemini 응답 등) 남은 파일을 다음 실행으로 넘긴다.
    const elapsed = Date.now() - startedAt;
    if (fi > 0 && elapsed > budgetMs) {
      remaining += files.length - fi;
      out(`⏱️ 실행 시간 예산 ${Math.round(budgetMs / 1000)}초 초과(${Math.round(elapsed / 1000)}초) — 남은 ${files.length - fi}개는 다음 실행으로 이월`);
      break;
    }
    out(`▶️ 처리: ${file.name} (${file.mimeType})`);
    let heldAny = false; // 미기록 그룹 발생 → 이 파일은 ARCHIVE 이동 보류(데이터 유실 방지)
    try {
      const bytes = await downloadFileBytes(token, file.id);

      const isText =
        file.mimeType === 'text/html' ||
        file.mimeType === 'text/plain' ||
        /\.(html?|txt)$/i.test(file.name);

      let textContent = '';
      let base64 = '';
      if (isText) {
        const decoded = decodeBytes(bytes);
        const isHtml = file.mimeType === 'text/html' || /\.html?$/i.test(file.name);
        textContent = isHtml ? cleanHtmlText(decoded) : decoded;
      } else {
        base64 = bytesToBase64(bytes);
      }

      const prompt = buildPromptForSource(file.mimeType, file.name);
      const parsed = await geminiParse(
        env,
        token,
        { promptText: prompt, isText, text: textContent, base64, mimeType: file.mimeType },
        out
      );

      const transactions = parsed.transactions || [];
      if (!Array.isArray(transactions) || transactions.length === 0) {
        throw new Error('Gemini 분석 결과에 거래 내역이 없습니다.');
      }

      // 추천 파일명 정제 + 원본 확장자 보존
      let newName = (parsed.recommendedFileName || '').trim();
      if (!newName) {
        newName = file.name;
      } else {
        newName = newName.replace(/[\\/:*?"<>|]/g, '_');
        const dot = file.name.lastIndexOf('.');
        const ext = dot >= 0 ? file.name.substring(dot) : '';
        if (ext && !newName.toLowerCase().endsWith(ext.toLowerCase())) newName += ext;
      }
      out(`🏷️ 파일명: "${file.name}" → "${newName}" / 추출 ${transactions.length}건`);

      // 월별 그룹화 + 중복판정
      const pending = {};
      // 고정비 청구건(관리비·도시가스): { '6월': { apt: {...}, gas: {...} } }
      const fixedPending = {};
      for (const item of transactions) {
        item.cat = normalizeCategory(item.cat, item.desc);
        item.method = selfHealMethod(item.method, DEFAULT_METHODS, file.name, isText ? textContent : '');

        // 입금(inc>0)이 '수입' 외 분류로 오면 대시보드 읽기 로직이 지출로 뒤집어 표시한다 → 기록 전 강제 교정.
        if ((Number(item.inc) || 0) > 0 && (Number(item.exp) || 0) === 0 && item.cat !== '수입') {
          item.cat = '수입';
        }

        // '오후 2:23'·'14:23:57' 등 표기 차이를 'HH:MM'으로 흡수(중복 판정 기준을 일치시키기 위함)
        item.time = normalizeTime(item.time);

        // "2026-06-03"·"6.03"·"6월 3일" 등 → "06/03" 표준화
        let nd = (item.date || '').trim();
        const dm = nd.match(/^(?:\d{4}[-/.년]\s*)?(\d{1,2})[-/.월]\s*(\d{1,2})/);
        if (dm) {
          nd = `${dm[1].padStart(2, '0')}/${dm[2].padStart(2, '0')}`;
          item.date = nd;
        }
        let pm = parseInt(nd.split('/')[0], 10);
        if (isNaN(pm) || pm < 1 || pm > 12) {
          // Workers의 Date는 UTC — 크론(KST 08:00 = UTC 23:00 전날)이 매월 1일 아침 실행될 때
          // UTC 기준으로는 아직 전월이라 폴백이 전월 시트로 새던 것을 KST 보정으로 방지.
          const kst = new Date(Date.now() + 9 * 3600 * 1000);
          pm = kst.getUTCMonth() + 1;
          item.date = `${String(pm).padStart(2, '0')}/01`;
        }
        // 시트명은 반드시 정수 월에서 유도 — 과거 "6.03" 같은 미매칭 날짜가 "6.03월" 쓰레기 시트를 만들었다.
        const sheetName = pm + '월';

        // ── 고정비 청구건 라우팅(아파트관리비·도시가스) ──
        // 일반 거래 행으로 기록하지 않고 '청구월' 시트의 고정비 행 금액만 갱신한다.
        // (고정비 행에 추정액이 이미 잡혀 있으므로 그대로 추가하면 같은 지출이 두 번 계상된다.)
        const bill = matchFixedBill(item.desc);
        const billExp = Number(item.exp) || 0;
        if (bill && billExp > 0) {
          const targetMonth = (bill.month || pm) + '월';
          const slot = (fixedPending[targetMonth] = fixedPending[targetMonth] || {});
          const prev = slot[bill.rule.key];
          // 같은 청구월에 여러 건(분할 청구 등)이면 합산 후 '설정'한다 → 재처리에도 멱등.
          slot[bill.rule.key] = {
            rule: bill.rule,
            amount: (prev ? prev.amount : 0) + billExp,
            method: item.method || (prev ? prev.method : ''),
            srcDesc: item.desc,
          };
          if (!bill.month) {
            out(`ℹ️ '${item.desc}' 청구월 표기 없음 — 거래월(${sheetName}) 고정비로 반영`);
          }
          continue;
        }

        if (!sheetCache[sheetName]) {
          try {
            sheetCache[sheetName] = await loadMonthData(token, env.SPREADSHEET_ID, sheetName, startRow);
          } catch (e) {
            // 404류(시트 없음)는 loadMonthData가 []로 흡수한다 — 여기 도달은 일시 오류(401/429/5xx)뿐.
            // 빈 배열로 간주하면 중복판정이 꺼진 채 재처리가 진행돼 전 건 이중 기록된다 → 파일 보류.
            out(`⚠️ ${sheetName} 기존 데이터 로드 실패 — "${file.name}" 보류(SOURCE 유지, 다음 실행 재시도): ${e.message}`);
            heldAny = true;
            break;
          }
        }

        const isDup = sheetCache[sheetName].some((ex) => isDuplicateOf(ex, item));

        if (isDup) {
          out(`⚠️ 중복 건너뜀: [${item.date}] ${item.desc} (${item.inc || item.exp}원)`);
          skipped++;
          continue;
        }
        (pending[sheetName] = pending[sheetName] || []).push(item);
      }

      // 월별 일괄 기록
      for (const sheetName of Object.keys(pending)) {
        const group = pending[sheetName];
        if (group.length === 0) continue;
        // 신규 월 시트 자동 생성(템플릿 복제). 실패하거나 템플릿이 없으면 '보류'하여 ARCHIVE로 보내지 않는다.
        const sheetId = await ensureSheetId(token, env, meta, templateId, sheetName, startRow, out, `${group.length}건`);
        if (sheetId == null) {
          heldAny = true;
          continue;
        }
        await addTransactionsBatch(token, env.SPREADSHEET_ID, sheetId, sheetName, group, { startRow });
        added += group.length;
        sheetCache[sheetName] = await loadMonthData(token, env.SPREADSHEET_ID, sheetName, startRow);
        out(`💾 ${sheetName} 기록 ${group.length}건 완료`);
      }

      // ── 고정비 행 갱신(아파트관리비·도시가스) ──
      // 청구월 시트에서 해당 고정비 행을 찾아 지출 금액만 실제 청구액으로 덮어쓴다.
      // 행이 아예 없는 달이면 고정비 행(A열 '-')으로 신규 추가한다.
      for (const sheetName of Object.keys(fixedPending)) {
        const slots = Object.values(fixedPending[sheetName]);
        if (slots.length === 0) continue;
        const sheetId = await ensureSheetId(token, env, meta, templateId, sheetName, startRow, out, `고정비 ${slots.length}건`);
        if (sheetId == null) {
          heldAny = true;
          continue;
        }
        if (!sheetCache[sheetName]) {
          try {
            sheetCache[sheetName] = await loadMonthData(token, env.SPREADSHEET_ID, sheetName, startRow);
          } catch (e) {
            // 기존 행을 못 읽은 채 진행하면 이미 있는 고정비 행을 놔두고 중복 행을 추가하게 된다 → 보류.
            out(`⚠️ ${sheetName} 데이터 로드 실패 — 고정비 갱신 보류(SOURCE 유지, 다음 실행 재시도): ${e.message}`);
            heldAny = true;
            continue;
          }
        }

        for (const slot of slots) {
          const { rule, amount, method, srcDesc } = slot;
          const row = findFixedRow(sheetCache[sheetName], rule);
          if (row) {
            if (Number(row.exp) === amount) {
              out(`🟰 ${sheetName} 고정비 '${row.desc}'(#${row.rowIndex}) 이미 ${won(amount)}원 — 변경 없음`);
              continue;
            }
            await updateFixedRowAmount(token, env.SPREADSHEET_ID, sheetName, row.rowIndex, amount);
            out(`📌 ${sheetName} 고정비 '${row.desc}'(#${row.rowIndex}) ${won(row.exp)} → ${won(amount)}원 갱신 (출처: ${srcDesc})`);
            row.exp = amount; // 캐시 동기화(같은 실행의 뒤 파일이 옛 금액을 다시 쓰지 않도록)
          } else {
            await addTransactionsBatch(
              token, env.SPREADSHEET_ID, sheetId, sheetName,
              [{ date: '-', desc: rule.label, inc: 0, exp: amount, cat: rule.cat, method }],
              { startRow, markYellow: false }
            );
            out(`➕ ${sheetName} 고정비 '${rule.label}' 행이 없어 신규 추가 ${won(amount)}원 (출처: ${srcDesc})`);
            sheetCache[sheetName] = await loadMonthData(token, env.SPREADSHEET_ID, sheetName, startRow);
          }
          fixedUpdated++;
        }
      }

      // 미기록 그룹이 있으면 ARCHIVE로 옮기지 않고 SOURCE에 유지(다음 실행 재시도) → 거래 유실 방지.
      // 이미 기록된 건은 다음 실행 시 중복판정으로 걸러지므로 재처리해도 안전(멱등).
      if (heldAny) {
        held++;
        out(`⏸️ 일부 거래 미기록 → "${file.name}" SOURCE 유지(보관 이동 보류, 다음 실행 재시도)`);
        continue;
      }

      // 성공 → ARCHIVE 이동 + rename
      await moveFile(token, {
        fileId: file.id,
        addParent: env.ARCHIVE_FOLDER_ID,
        removeParent: env.SOURCE_FOLDER_ID,
        newName,
      });
      out(`🚀 보관함 이동 완료: ${newName}`);
      ok++;
    } catch (err) {
      fail++;
      const s = (err.message || '').toLowerCase();
      // 판정 우선순위: ① transient 플래그(Gemini 빈 응답·잘린 JSON 등 비결정 오류)
      //              ② HTTP 상태(429·408·5xx만 일시) ③ 상태 없으면 키워드 폴백.
      // (과거: 'gemini' 키워드 때문에 400 등 영구 Gemini 오류도 일시로 오분류 → SOURCE 무한 잔류·재시도)
      const status = err.status || 0;
      const isTemporary = err.transient === true || (status
        ? (status === 408 || status === 429 || status >= 500)
        : TEMP_ERROR_KEYS.some((k) => s.includes(k)));
      if (isTemporary) {
        out(`⚠️ 일시 오류 — SOURCE 유지 후 다음 실행 재시도: ${err.message}`);
      } else {
        try {
          await moveFile(token, {
            fileId: file.id,
            addParent: env.FAIL_FOLDER_ID,
            removeParent: env.SOURCE_FOLDER_ID,
          });
          out(`⚠️ 영구 오류 — FAIL 격리: ${file.name} (${err.message})`);
        } catch (moveErr) {
          out(`❌ 실패 파일 이동 오류: ${moveErr.message}`);
        }
      }
    }
  }

  // 보류(held)된 파일도 SOURCE에 남아 다음 실행 대상이므로 잔여 수에 포함한다.
  remaining += held;
  out(`🏁 처리 종료 — 성공 ${ok} / 실패 ${fail} / 보류 ${held} / 추가 ${added} / 중복 ${skipped} / 고정비갱신 ${fixedUpdated}${remaining ? ` / 미처리 잔여 ${remaining}` : ''}`);
  return { ok, fail, added, skipped, held, fixedUpdated, remaining };
}

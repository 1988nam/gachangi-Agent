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
} from './sheets.js';
import { buildPromptForSource, cleanHtmlText, geminiParse } from './gemini.js';
import { selfHealMethod } from './method.js';
import { decodeBytes } from './decode.js';
import { bytesToBase64 } from './util.js';
import { DEFAULT_METHODS } from './constants.js';

// 상태코드가 없는 오류(네트워크/파싱 등)의 일시오류 판정용 키워드.
// 'gemini'는 의도적으로 제외 — Gemini 호출 실패는 err.status(4xx/5xx)로 판정한다.
const TEMP_ERROR_KEYS = [
  'quota', 'rate limit', 'too many requests', '429', '503', '500',
  'fetch', 'network', 'timeout', '재시도', '응답하지 않습니다',
];

export async function processDriveFolder(env, token, out) {
  const files = await listFolderFiles(token, env.SOURCE_FOLDER_ID);
  if (files.length === 0) {
    out('📭 SOURCE에 처리할 신규 파일이 없습니다.');
    return { ok: 0, fail: 0, added: 0, skipped: 0 };
  }
  out(`📂 SOURCE 파일 ${files.length}개 처리 시작`);

  const meta = await loadSheetMeta(token, env.SPREADSHEET_ID);
  const startRow = parseInt(env.START_ROW || '4', 10);
  const sheetCache = {};

  // 신규 월 시트 자동 생성용 템플릿(기존 월 시트 중 하나). 없으면 자동 생성 불가 → 보류.
  const templateTitle = Object.keys(meta).find((t) => /^\d{1,2}월$/.test(t));
  const templateId = templateTitle != null ? meta[templateTitle] : null;

  let ok = 0, fail = 0, added = 0, skipped = 0, held = 0;

  for (const file of files) {
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
      for (const item of transactions) {
        item.cat = normalizeCategory(item.cat, item.desc);
        item.method = selfHealMethod(item.method, DEFAULT_METHODS, file.name, isText ? textContent : '');

        // 입금(inc>0)이 '수입' 외 분류로 오면 대시보드 읽기 로직이 지출로 뒤집어 표시한다 → 기록 전 강제 교정.
        if ((Number(item.inc) || 0) > 0 && (Number(item.exp) || 0) === 0 && item.cat !== '수입') {
          item.cat = '수입';
        }

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

        const isDup = sheetCache[sheetName].some((ex) => {
          const incMatch = Number(ex.inc) === Number(item.inc);
          const expMatch = Number(ex.exp) === Number(item.exp);
          const ed = (ex.desc || '').trim();
          const id = (item.desc || '').trim();
          const descMatch =
            ed === id || (ed !== '' && id !== '' && (ed.includes(id) || id.includes(ed)));
          const dateMatch = ex.isFixed ? true : ex.date === item.date;
          return dateMatch && incMatch && expMatch && descMatch;
        });

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
        let sheetId = meta[sheetName];
        if (sheetId === undefined) {
          // 신규 월 시트 자동 생성(템플릿 복제). 실패하거나 템플릿이 없으면 '보류'하여 ARCHIVE로 보내지 않는다.
          if (templateId != null) {
            try {
              sheetId = await createMonthSheetFromTemplate(token, env.SPREADSHEET_ID, sheetName, templateId, { startRow });
              meta[sheetName] = sheetId;
              out(`🆕 신규 월 시트 '${sheetName}' 자동 생성(템플릿 복제) 완료`);
            } catch (e) {
              out(`⚠️ '${sheetName}' 시트 자동 생성 실패: ${e.message} — ${group.length}건 보류(SOURCE 유지)`);
              heldAny = true;
              continue;
            }
          } else {
            out(`⚠️ 복제할 템플릿(월 시트)이 없어 '${sheetName}' ${group.length}건 보류(SOURCE 유지)`);
            heldAny = true;
            continue;
          }
        }
        await addTransactionsBatch(token, env.SPREADSHEET_ID, sheetId, sheetName, group, { startRow });
        added += group.length;
        sheetCache[sheetName] = await loadMonthData(token, env.SPREADSHEET_ID, sheetName, startRow);
        out(`💾 ${sheetName} 기록 ${group.length}건 완료`);
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

  out(`🏁 처리 종료 — 성공 ${ok} / 실패 ${fail} / 보류 ${held} / 추가 ${added} / 중복 ${skipped}`);
  return { ok, fail, added, skipped, held };
}

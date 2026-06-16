/**
 * Phase 2 — Gmail '가계부' 라벨 메일 → Drive SOURCE 폴더 적재.
 *
 *  1) '가계부' / '가계부/처리완료' 라벨 id 매핑 (처리완료는 없으면 생성)
 *  2) '가계부' 라벨 메일 나열 → 이미 '처리완료'면 멱등 스킵
 *  3) 첨부가 있으면 첨부를, 없으면 본문(html 우선)을 Drive SOURCE에 업로드
 *     - 원본 mimeType/확장자 보존(다운스트림 isText·이미지·카드사 매핑이 의존)
 *  4) 업로드 성공 '후에만' 처리완료 라벨 부착 (유실 방지 순서)
 */
import {
  getOrCreateLabelId,
  iterateMessages,
  getMessage,
  getAttachmentData,
  addLabels,
  collectParts,
  headerValue,
} from './gmail.js';
import { uploadToFolder } from './drive.js';
import { base64UrlToBytes } from './util.js';

function safeName(s, max = 40) {
  return (s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, max) || 'mail';
}

export async function ingestGmailToSource(env, token, out) {
  const sourceLabelId = await getOrCreateLabelId(token, env.GMAIL_SOURCE_LABEL, { create: false });
  if (!sourceLabelId) {
    out(`⚠️ '${env.GMAIL_SOURCE_LABEL}' 라벨이 없어 Gmail 적재를 건너뜁니다. (라벨명 확인 필요)`);
    return { mails: 0, uploaded: 0 };
  }
  const doneLabelId = await getOrCreateLabelId(token, env.GMAIL_DONE_LABEL, { create: true });

  let mails = 0;
  let uploaded = 0;

  for await (const ref of iterateMessages(token, { labelIds: [sourceLabelId] })) {
    const msg = await getMessage(token, ref.id);

    // 멱등 가드: 이미 처리완료 라벨이 붙어 있으면 스킵
    if ((msg.labelIds || []).includes(doneLabelId)) continue;
    mails++;

    const payload = msg.payload || {};
    const { attachments, bodies } = collectParts(payload);
    const subject = safeName(headerValue(payload, 'Subject'));

    let anyUploaded = false;

    if (attachments.length > 0) {
      for (const att of attachments) {
        try {
          const data = await getAttachmentData(token, msg.id, att.attachmentId);
          const bytes = base64UrlToBytes(data);
          const name = safeName(att.filename, 120) || `${subject}.bin`;
          await uploadToFolder(token, {
            folderId: env.SOURCE_FOLDER_ID,
            name,
            mimeType: att.mimeType,
            bytes,
          });
          uploaded++;
          anyUploaded = true;
          out(`📎 첨부 적재: ${name} (${att.mimeType}, ${bytes.length}B)`);
        } catch (e) {
          out(`❌ 첨부 적재 실패(${att.filename}): ${e.message}`);
        }
      }
    } else if (bodies.length > 0) {
      // 첨부 없는 본문 메일: HTML 우선(명세서 테이블 보존), 없으면 plain
      const chosen = bodies.find((b) => b.mimeType === 'text/html') || bodies[0];
      const ext = chosen.mimeType === 'text/html' ? 'html' : 'txt';
      try {
        const bytes = base64UrlToBytes(chosen.data);
        const name = `${subject}__${msg.id}.${ext}`;
        await uploadToFolder(token, {
          folderId: env.SOURCE_FOLDER_ID,
          name,
          mimeType: chosen.mimeType,
          bytes,
        });
        uploaded++;
        anyUploaded = true;
        out(`📄 본문 적재: ${name} (${chosen.mimeType}, ${bytes.length}B)`);
      } catch (e) {
        out(`❌ 본문 적재 실패(${msg.id}): ${e.message}`);
      }
    } else {
      out(`⚠️ 메일 ${msg.id}: 첨부·본문 없음 — 건너뜀`);
    }

    // 하나라도 업로드됐을 때만 처리완료 라벨 (실패분은 다음 실행에 재시도)
    if (anyUploaded) {
      try {
        await addLabels(token, msg.id, [doneLabelId]);
      } catch (e) {
        out(`⚠️ 처리완료 라벨 부착 실패(${msg.id}): ${e.message} — 다음 실행에 중복 적재될 수 있음`);
      }
    }
  }

  out(`✅ Gmail 적재 완료: 신규 메일 ${mails}건 / 파일 ${uploaded}개 → SOURCE`);
  return { mails, uploaded };
}

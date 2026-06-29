/**
 * Gmail REST API 래퍼 (users/me).
 * 브라우저 GIS 토큰이든 Worker refresh_token이든 동일한 Bearer 호출.
 */
import { googleFetch } from './google-api.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function listLabels(token) {
  const res = await googleFetch(token, `${BASE}/labels`);
  return res.labels || [];
}

/** 라벨명 → id. create=true면 없을 때 생성('가계부/처리완료' 하위라벨 등). */
export async function getOrCreateLabelId(token, name, { create = false } = {}) {
  const labels = await listLabels(token);
  const found = labels.find((l) => l.name === name);
  if (found) return found.id;
  if (!create) return null;

  const res = await googleFetch(token, `${BASE}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  return res.id;
}

/**
 * 라벨로 메시지 나열 (페이지네이션). 한글 라벨명 인코딩 위험을 피해 labelIds 사용.
 * q(검색식)를 함께 주면 라벨ID AND 검색식으로 좁힌다(예: '-label:가계부/처리완료'로 처리완료 제외).
 * → 매 실행마다 처리완료 메일까지 전수 getMessage 하던 비용을 제거.
 */
export async function* iterateMessages(token, { labelIds, q } = {}) {
  let pageToken = null;
  do {
    const params = new URLSearchParams();
    for (const id of labelIds || []) params.append('labelIds', id);
    if (q) params.set('q', q);
    params.set('maxResults', '100');
    if (pageToken) params.set('pageToken', pageToken);

    const res = await googleFetch(token, `${BASE}/messages?${params.toString()}`);
    for (const m of res.messages || []) yield m;
    pageToken = res.nextPageToken || null;
  } while (pageToken);
}

export async function getMessage(token, id) {
  return googleFetch(token, `${BASE}/messages/${id}?format=full`);
}

/** 첨부 바이너리(base64url 문자열) 획득 */
export async function getAttachmentData(token, messageId, attachmentId) {
  const res = await googleFetch(token, `${BASE}/messages/${messageId}/attachments/${attachmentId}`);
  return res.data;
}

export async function addLabels(token, messageId, addLabelIds) {
  return googleFetch(token, `${BASE}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds }),
  });
}

function partHeader(part, name) {
  const h = (part.headers || []).find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/**
 * payload(MessagePart) 트리를 재귀 순회해 첨부/본문/인라인이미지를 분리 수집.
 *  - 인라인 이미지(로고·서명: Content-Disposition: inline 또는 Content-ID 보유 image/*)는
 *    '첨부'가 아니라 inlineImages로 분리한다. (과거: 본문형 명세서에 로고만 있어도 첨부로 잡혀
 *     실제 HTML 본문 업로드가 통째로 스킵 → 그 달 내역 누락)
 *  - ingest는 실첨부 > 본문 > 인라인이미지 순으로 사용해 회귀를 막는다.
 */
export function collectParts(payload) {
  const attachments = [];
  const bodies = [];
  const inlineImages = [];

  (function walk(part) {
    if (!part) return;
    const { filename, mimeType, body, parts } = part;
    if (filename && body && body.attachmentId) {
      const disp = partHeader(part, 'content-disposition').toLowerCase();
      const hasCid = !!(partHeader(part, 'content-id') || partHeader(part, 'x-attachment-id'));
      const isImage = (mimeType || '').startsWith('image/');
      // 명시적 attachment 처분이면 실첨부. inline이거나(처분 없이) Content-ID만 있는 이미지면 인라인.
      const isInlineImage = isImage && !disp.includes('attachment') && (disp.includes('inline') || hasCid);
      const entry = {
        filename,
        mimeType: mimeType || 'application/octet-stream',
        attachmentId: body.attachmentId,
      };
      if (isInlineImage) inlineImages.push(entry);
      else attachments.push(entry);
    } else if (body && body.data && (mimeType === 'text/html' || mimeType === 'text/plain')) {
      bodies.push({ mimeType, data: body.data });
    }
    if (Array.isArray(parts)) parts.forEach(walk);
  })(payload);

  return { attachments, bodies, inlineImages };
}

export function headerValue(payload, name) {
  const h = (payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

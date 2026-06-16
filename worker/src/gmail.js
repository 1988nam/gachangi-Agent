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

/** 라벨로 메시지 나열 (페이지네이션). 한글 라벨명 인코딩 위험을 피해 labelIds 사용. */
export async function* iterateMessages(token, { labelIds }) {
  let pageToken = null;
  do {
    const params = new URLSearchParams();
    for (const id of labelIds) params.append('labelIds', id);
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

/** payload(MessagePart) 트리를 재귀 순회해 첨부와 본문을 수집 */
export function collectParts(payload) {
  const attachments = [];
  const bodies = [];

  (function walk(part) {
    if (!part) return;
    const { filename, mimeType, body, parts } = part;
    if (filename && body && body.attachmentId) {
      attachments.push({
        filename,
        mimeType: mimeType || 'application/octet-stream',
        attachmentId: body.attachmentId,
      });
    } else if (body && body.data && (mimeType === 'text/html' || mimeType === 'text/plain')) {
      bodies.push({ mimeType, data: body.data });
    }
    if (Array.isArray(parts)) parts.forEach(walk);
  })(payload);

  return { attachments, bodies };
}

export function headerValue(payload, name) {
  const h = (payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

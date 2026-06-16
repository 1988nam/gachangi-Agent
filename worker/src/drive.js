/**
 * Google Drive REST 래퍼.
 * 브라우저 agent_controller.js의 list/download/update 패턴을 이식하고,
 * 코드베이스에 없던 'multipart 업로드(create)'를 신설한다.
 */
import { googleFetch } from './google-api.js';
import { concatBytes } from './util.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** 폴더 내 파일 목록 (id, name, mimeType) */
export async function listFolderFiles(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType)');
  const res = await googleFetch(token, `${API}/files?q=${q}&fields=${fields}&pageSize=1000`);
  return res.files || [];
}

/** 파일 바이너리 다운로드 (alt=media) */
export async function downloadFileBytes(token, fileId) {
  const res = await fetch(`${API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive 다운로드 실패 (상태 ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** multipart 업로드: 메타데이터(JSON) + 바이너리를 한 요청으로 폴더에 생성 */
export async function uploadToFolder(token, { folderId, name, mimeType, bytes }) {
  const boundary = '----gachangi' + crypto.randomUUID();
  const meta = { name, mimeType, parents: [folderId] };
  const enc = new TextEncoder();

  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = concatBytes(head, bytes, tail);

  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,parents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive 업로드 실패 (상태 ${res.status}): ${detail}`);
  }
  return res.json();
}

/** 부모 변경(이동) + 선택적 이름 변경. ARCHIVE/FAIL 이동에 사용. */
export async function moveFile(token, { fileId, addParent, removeParent, newName }) {
  const params = new URLSearchParams({
    addParents: addParent,
    removeParents: removeParent,
    fields: 'id,parents,name',
  });
  const opts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' } };
  if (newName) opts.body = JSON.stringify({ name: newName });
  return googleFetch(token, `${API}/files/${fileId}?${params.toString()}`, opts);
}

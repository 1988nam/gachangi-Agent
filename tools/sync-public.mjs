#!/usr/bin/env node
/**
 * 루트 소스(index.html, style.css, js/*.js) → public/ 배포 사본 동기화.
 *
 * public/은 gitignore 대상이라 소스와 어긋나도 git status에 절대 드러나지 않는다.
 * (실제로 2026-06~07월에 public/js가 한 달 가까이 옛 버전으로 배포된 드리프트가 있었음)
 * → Pages 배포는 반드시 `npm run deploy:pages`(이 스크립트가 predeploy로 선행)를 사용할 것.
 *
 * js/config.js는 로컬 개인 설정(gitignore)이므로 복사하지 않는다.
 * 배포본은 ConfigModal(localStorage) 설정을 사용한다.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'js'), { recursive: true });

const EXCLUDE = new Set(['config.js']);
const copied = [];

for (const f of ['index.html', 'style.css']) {
  copyFileSync(join(root, f), join(pub, f));
  copied.push(f);
}
for (const f of readdirSync(join(root, 'js'))) {
  if (!f.endsWith('.js') || EXCLUDE.has(f)) continue;
  copyFileSync(join(root, 'js', f), join(pub, 'js', f));
  copied.push(`js/${f}`);
}

console.log(`[sync-public] ${copied.length}개 파일 동기화 완료 → public/`);
console.log('  ' + copied.join('\n  '));

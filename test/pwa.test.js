import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

function precacheList() {
  const m = read('sw.js').match(/\/\/ <PRECACHE>([\s\S]*?)\/\/ <\/PRECACHE>/);
  assert.ok(m, 'sw.js 缺少 <PRECACHE> 區塊');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} 不是 PNG`);
  assert.equal(b.subarray(12, 16).toString('ascii'), 'IHDR');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

test('sw.js 預載清單:每個檔都存在,路徑一律相對', () => {
  const list = precacheList();
  assert.ok(list.length > 60);
  assert.equal(new Set(list).size, list.length, '清單有重複');
  for (const p of list) {
    assert.ok(!p.startsWith('/') && !/^[a-z]+:/i.test(p), `子路徑託管下必須是相對路徑: ${p}`);
    if (p === './') continue;
    assert.ok(fs.existsSync(path.join(ROOT, p)), `清單裡的檔案不存在: ${p}`);
  }
});

test('sw.js 預載清單:涵蓋 index.html、manifest、圖示與 css/ src/ 下所有 .css/.js', () => {
  const list = new Set(precacheList());
  const need = ['./', 'index.html', 'manifest.webmanifest',
    ...walk('icons').filter((f) => f.endsWith('.png')),
    ...walk('css').filter((f) => f.endsWith('.css')),
    ...walk('src').filter((f) => f.endsWith('.js'))];
  for (const f of need) assert.ok(list.has(f), `預載清單漏了: ${f}(請執行 node tools/gen-sw.mjs)`);
  assert.equal(list.size, need.length, '清單有多餘項目(請執行 node tools/gen-sw.mjs)');
});

test('sw.js 版本號與內容同步(改了檔案沒重新產生,線上會卡舊版)', () => {
  const list = precacheList().filter((f) => f !== './').sort();
  const hash = crypto.createHash('sha1');
  for (const f of list) { hash.update(f); hash.update(read(f).replace(/\r\n/g, '\n')); }
  const version = hash.digest('hex').slice(0, 10);
  assert.match(read('sw.js'), new RegExp(`const VERSION = '${version}';`), '請執行 node tools/gen-sw.mjs');
});

test('sw.js 不含絕對路徑的註冊範圍、使用相對 URL 組合', () => {
  const sw = read('sw.js').replace(/\/\/.*$/gm, ''); // 註解不算
  assert.match(sw, /self\.registration\.scope/);
  assert.doesNotMatch(sw, /fengshui-luopan\//);
  assert.doesNotMatch(sw, /['"`]\/[a-z]/i);
});

test('manifest.webmanifest 欄位齊全、路徑相對、圖示存在且尺寸正確', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) {
    assert.ok(m[k], `manifest 缺 ${k}`);
  }
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(!('id' in m), '不設 id:以 origin 解析會和同帳號其他專案撞成同一個 App');
  const purposes = new Set();
  for (const ic of m.icons) {
    assert.ok(!ic.src.startsWith('/'), `圖示必須用相對路徑: ${ic.src}`);
    const [w, h] = ic.sizes.split('x').map(Number);
    const px = pngSize(ic.src);
    assert.deepEqual([px.w, px.h], [w, h], `${ic.src} 實際尺寸與 sizes 不符`);
    purposes.add(ic.purpose);
  }
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(purposes.has('maskable'));
});

test('apple-touch-icon 為 180x180 且不透明(不含 alpha)', () => {
  const px = pngSize('icons/apple-touch-icon.png');
  assert.deepEqual([px.w, px.h], [180, 180]);
  assert.ok(px.colorType === 2 || px.colorType === 3, 'iOS 圖示不能有透明,否則透明處會變黑');
});

test('index.html:manifest、apple-touch-icon、apple-mobile-web-app-* 與 service worker 註冊', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  for (const n of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style']) {
    assert.match(html, new RegExp(`<meta name="${n}"`), `缺 ${n}`);
  }
  assert.equal((html.match(/<meta name="theme-color"/g) || []).length, 1, 'main.js 只改第一個 theme-color');
  assert.match(html, /register\('\.\/sw\.js'/);
  assert.doesNotMatch(html, /(href|src)="\//, 'index.html 不可有開頭為 / 的路徑');
  assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')), '缺 .nojekyll');
});

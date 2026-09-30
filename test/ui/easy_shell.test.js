// 簡單模式的外殼(EASY_SPEC 3.4、9、11):index.html、main.js 的接線,與 views/easy.js 不自己寫畫面文字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABS } from '../../src/ui/route.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** 去掉 // 與 /* *\/ 註解(不處理字串裡剛好出現的註解符號;本專案的畫面程式沒有這種寫法) */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** 取出字串常值('…'、"…"、`…`)的內容 */
function stringLiterals(src) {
  const out = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  let m;
  while ((m = re.exec(src))) out.push(m[0].slice(1, -1));
  return out;
}

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

test('index.html:有 #btn-mode、連結 c-easy.css 與 v-easy.css', () => {
  const html = read('index.html');
  assert.match(html, /<button[^>]*id="btn-mode"/);
  assert.match(html, /<link rel="stylesheet" href="css\/c-easy\.css">/);
  assert.match(html, /<link rel="stylesheet" href="css\/v-easy\.css">/);
  // 模式鈕在設定齒輪左邊
  assert.ok(html.indexOf('id="btn-mode"') < html.indexOf('id="btn-settings"'));
});

test('index.html:預設 data-mode 的分頁清單等於 TABS', () => {
  const html = read('index.html');
  const m = /\[((?:\s*'[a-z]+'\s*,?)+)\]\.indexOf\(hid\)/.exec(html);
  assert.ok(m, '找不到內嵌腳本的分頁陣列');
  const ids = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  assert.deepEqual(ids, TABS.map((t) => t.id));
  assert.match(html, /dataset\.mode\s*=/);
});

test('資源路徑一律相對(沒有以 / 開頭的 href/src)', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    assert.ok(!m[1].startsWith('/'), `絕對路徑: ${m[1]}`);
  }
  for (const f of ['src/ui/views/easy.js', 'css/v-easy.css', 'src/ui/main.js']) {
    const src = stripComments(read(f));
    assert.doesNotMatch(src, /(?:from|import\()\s*['"]\//, `${f} 有絕對路徑的 import`);
    assert.doesNotMatch(src, /url\(\s*['"]?\//, `${f} 有絕對路徑的 url()`);
    assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org)/, `${f} 載入外部資源`);
  }
});

test('main.js 從 ./route.js import,且不再宣告 const TABS', () => {
  const src = read('src/ui/main.js');
  assert.match(src, /import\s*\{[^}]*\bTABS\b[^}]*\}\s*from\s*'\.\/route\.js'/);
  assert.match(src, /import\s*\{[^}]*\bresolveRoute\b[^}]*\}\s*from\s*'\.\/route\.js'/);
  assert.doesNotMatch(src, /const\s+TABS\s*=/);
  assert.match(src, /history\.replaceState\(/);
  assert.match(src, /dataset\.mode\s*=/);
});

test('views/easy.js:匯出 mount,且原始碼(去掉註解後)沒有中文字串常值', () => {
  const raw = read('src/ui/views/easy.js');
  assert.match(raw, /export\s+async\s+function\s+mount\s*\(/);
  const src = stripComments(raw);
  const bad = stringLiterals(src).filter((s) => CJK.test(s));
  assert.deepEqual(bad, [], '畫面文字要來自 easy/text.js、copy.js、sensorText.js 或 views/wealth.js 的模型');
  // 去掉註解後整份也不該有中文(例如寫在 JSX 式的樣板或正規表示式裡)
  assert.doesNotMatch(src, CJK);
});

test('views/easy.js:文字來源只有允許的模組', () => {
  const src = read('src/ui/views/easy.js');
  assert.match(src, /from '\.\.\/easy\/text\.js'/);
  assert.match(src, /from '\.\.\/sensorText\.js'/);
  assert.match(src, /from '\.\.\/\.\.\/core\/copy\.js'/);
  assert.match(src, /from '\.\/wealth\.js'/);
});

test('views/easy.js:「看說明」摺疊區預設關閉,1B 的提醒行在主按鈕下方', () => {
  const src = stripComments(read('src/ui/views/easy.js'));
  // 摺疊區只能透過 fold() 產生,預設 open = false;沒有任何地方寫死 open: true
  assert.match(src, /const fold = \(children, \{[^}]*open = false/);
  assert.doesNotMatch(src, /open:\s*true/);
  // 1B:主按鈕之後才是那一行提醒(提醒出現或消失時不會把主按鈕擠上擠下)
  const b = src.slice(src.indexOf('function view1B'), src.indexOf('function view1D'));
  assert.ok(b.indexOf('refs.lockBtn,') > 0 && b.indexOf('refs.lockBtn,') < b.indexOf('refs.note,'), '1B 的提醒行要在主按鈕下方');
  // 每個畫面最多兩個小連結:links(...) 的參數不超過兩個
  for (const m of src.matchAll(/\blinks\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g)) {
    let depth = 0;
    let commas = 0;
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      else if (ch === ',' && depth === 0) commas += 1;
    }
    assert.ok(commas <= 1, `小連結超過兩個: links(${m[1].slice(0, 60)}…)`);
  }
});

test('v-easy.css:外殼規則、class 前綴與顏色 tokens', () => {
  const css = read('css/v-easy.css');
  assert.match(css, /html\[data-mode="easy"\]\s*\{\s*--tabbar-h:\s*0px;\s*\}/);
  assert.match(css, /html\[data-mode="easy"\] \.tabbar, html\[data-mode="easy"\] \.app-sub\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /@media \(max-width: 359px\)\s*\{\s*\.app-sub\s*\{\s*display:\s*none;\s*\}\s*\}/);
  const body = stripComments(css);
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, '顏色要用 tokens');
  assert.doesNotMatch(body, /rgba?\(/, '顏色要用 tokens');
  // 除了上面三條外殼規則,每條規則的選擇器都以 .v-easy- 開頭
  const selectors = [...body.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith('@'));
  for (const sel of selectors) {
    for (const part of sel.split(',').map((x) => x.trim())) {
      if (/^html\[data-mode="easy"\]/.test(part) || part === '.app-sub' || part === '#btn-mode') continue;
      assert.match(part, /^\.v-easy(?:-|$|[\s.:[>])/, `選擇器沒有 .v-easy 前綴: ${part}`);
    }
  }
});

test('設定面板有「介面」分組並用 proHomeOf 切到完整功能', () => {
  const src = read('src/ui/views/settings.js');
  assert.match(src, /import \{ proHomeOf \} from '\.\.\/route\.js'/);
  assert.match(src, /EASY_TEXT\['set\.group'\]/);
  assert.ok(src.indexOf('modeSec,') < src.indexOf('appearance,'), '介面分組在外觀之前');
});

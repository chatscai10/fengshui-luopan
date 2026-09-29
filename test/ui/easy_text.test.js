// 簡單模式的操作文字(EASY_SPEC 5、8.11):逐字對照規格表、術語與恐嚇詞黑名單、fillText。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EASY_TEXT, EASY_TEXT_ADVANCED_KEYS, fillText } from '../../src/ui/easy/text.js';
import * as sensorText from '../../src/ui/sensorText.js';

const SPEC = fs.readFileSync(fileURLToPath(new URL('../../docs/EASY_SPEC.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const section = (from, to) => SPEC.slice(SPEC.indexOf(from), SPEC.indexOf(to));
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

export const TERM_BLACKLIST = ['宮', '明財位', '暗財位', '八宅', '玄空', '飛星', '山星', '向星', '命卦', '宅卦', '坐向', '空亡', '兼', '卦', '分數'];
export const SCARY = ['大凶', '絕嗣', '敗財', '保證'];
const ENGLISH_OK = new Set(['App', 'iPhone', 'Android', 'Safari', 'Chrome', 'LINE', 'Google']);

/** 規格第 5 節所有「| `鍵` | … |」列:鍵 → 文字(最後一欄;去掉「(`…`)」附註) */
function specKeyTexts() {
  const out = new Map();
  for (const line of section('## 5. 畫面規格與逐字文案', '### 5.6 設定面板').split('\n')) {
    const m = /^\| `([a-z]+\.[A-Za-z0-9.]+)` \|/.exec(line);
    if (!m || m[1] === 'check.verdict') continue; // 結論句表的表頭
    const cs = cells(line);
    let text = cs[cs.length - 1];
    const note = text.indexOf('(`');
    if (note > 0) text = text.slice(0, note);
    out.set(m[1], text);
  }
  return out;
}

/** 所有給使用者看的 sensorText 字串 */
function sensorStrings() {
  const out = [sensorText.SENSOR_FALLBACK_HINT, sensorText.DENIED_HELP, sensorText.TILT_HINT,
    ...Object.values(sensorText.STABILITY_LABEL), ...Object.values(sensorText.STABILITY_REASON)];
  for (const s of ['permission-denied', 'permission-error', 'no-events', 'relative-not-north', 'uncalibrated', 'invalid', 'tilt-too-large', 'unstable', 'too-few', 'degenerate', 'insecure-context', 'no-sensor', 'unsupported']) {
    out.push(sensorText.sensorMessage(s));
  }
  for (const r of ['tilt', 'uncalibrated', 'face-down', 'quality-red', 'not-running', 'no-reading']) out.push(sensorText.lockBlockedMessage(r));
  return out;
}

test('EASY_TEXT:與規格第 5 節的「鍵」表格逐字相同(copy.js 與組合句除外)', () => {
  const spec = specKeyTexts();
  assert.ok(spec.size > 120, `只讀到 ${spec.size} 個鍵`);
  const fromCopy = [];
  for (const [key, text] of spec) {
    if (text.startsWith('`')) { fromCopy.push(key); continue; } // 取自 copy.js 或由程式組合
    assert.ok(Object.hasOwn(EASY_TEXT, key), `EASY_TEXT 缺 ${key}`);
    assert.equal(EASY_TEXT[key], text, key);
  }
  assert.deepEqual(fromCopy.sort(), ['l.doorWhy', 'm.denied']);
  assert.ok(!Object.hasOwn(EASY_TEXT, 'l.doorWhy') && !Object.hasOwn(EASY_TEXT, 'r.pick8'), 'copy.js 的句子不重複放在 text.js');
  assert.ok(!Object.hasOwn(EASY_TEXT, 'b.north.magnetic') && !Object.hasOwn(EASY_TEXT, 'b.north.true'), '簡單模式不顯示「磁北/真北」');
  // 規格沒有列的鍵只有:結論句(表格無鍵名)、權限被拒的組合句、設定面板的「介面」分組
  const extra = Object.keys(EASY_TEXT).filter((k) => !spec.has(k));
  assert.ok(extra.every((k) => /^(verdict\.|set\.)/.test(k) || k === 'm.denied'), `多出的鍵: ${extra.join(',')}`);
});

test('EASY_TEXT:自我檢查結論句與規格 1D 表逐字相同', () => {
  const rows = section('自我檢查結論句', '`agree`、`dropped` 與').split('\n').filter((l) => l.startsWith('| `') && !l.startsWith('| `check.verdict`'));
  const keyOf = (c) => ({
    'single-ok': 'single-ok', 'single-noacc': 'single-noacc', 'single-wide': 'single-wide', 'single-unstable': 'single-unstable', agree: 'agree',
    'warn(n=2,接近分界)': 'warn2', 'warn(n=2,不接近分界)': 'warn2-ok', 'warn(n=3)': 'warn3', far: 'far', dropped: 'dropped', inconsistent: 'inconsistent',
  })[c.replace(/`/g, '')];
  assert.equal(rows.length, 11);
  for (const line of rows) {
    const [c, , text] = cells(line);
    assert.equal(EASY_TEXT[`verdict.${keyOf(c)}`], text, c);
  }
});

test('EASY_TEXT:設定面板「介面」分組與規格 5.6 相同', () => {
  const s = section('### 5.6', '### 5.7');
  const row = (name) => cells(s.split('\n').find((l) => l.startsWith(`| ${name} |`)))[1];
  assert.equal(EASY_TEXT['set.group'], row('分組標題'));
  assert.equal(EASY_TEXT['set.label'], row('項目名稱'));
  assert.equal(EASY_TEXT['set.help'], row('說明'));
  assert.equal(`${EASY_TEXT['set.easy']} / ${EASY_TEXT['set.pro']}`, row('選項'));
});

test('sensorText:穩定度與原因句與規格 5.7 表逐字相同', () => {
  const s = section('### 5.7', '### 5.8');
  const lines = s.split('\n');
  for (const [level, label] of Object.entries(sensorText.STABILITY_LABEL)) {
    const row = lines.find((l) => l.startsWith(`| ${level} |`));
    assert.equal(cells(row)[2], label, level);
  }
  for (const [key, text] of Object.entries(sensorText.STABILITY_REASON)) {
    const row = lines.find((l) => l.startsWith(`| \`${key}\` |`));
    assert.ok(row, key);
    assert.equal(cells(row)[2], text, key);
  }
  assert.ok(s.includes(sensorText.DENIED_HELP));
  assert.ok(s.includes(sensorText.TILT_HINT));
});

test('EASY_TEXT 與 sensorText 的字串:不含術語、恐嚇詞、英文內部代碼、本機路徑', () => {
  const texts = [
    ...Object.entries(EASY_TEXT).filter(([k]) => !EASY_TEXT_ADVANCED_KEYS.includes(k)).map(([k, v]) => [k, v]),
    ...sensorStrings().map((v, i) => [`sensor#${i}`, v]),
  ];
  assert.deepEqual(EASY_TEXT_ADVANCED_KEYS, []);
  for (const [k, t] of texts) {
    assert.equal(typeof t, 'string', k);
    assert.ok(t.length > 0, k);
    for (const w of TERM_BLACKLIST) assert.ok(!t.includes(w), `${k} 含術語「${w}」: ${t}`);
    for (const w of SCARY) assert.ok(!t.includes(w), `${k} 含「${w}」: ${t}`);
    assert.ok(!/[A-Za-z]:\\/.test(t), `${k} 含本機路徑`);
    const words = t.replace(/\{\w+\}/g, '').match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];
    for (const w of words) assert.ok(ENGLISH_OK.has(w), `${k} 含英文代碼「${w}」: ${t}`);
    assert.ok(!/\s[,。;:、]/.test(t), `${k} 標點前有空白`);
  }
});

test('EASY_TEXT 是凍結的;每個 {名稱} 都是英數', () => {
  assert.ok(Object.isFrozen(EASY_TEXT));
  for (const [k, v] of Object.entries(EASY_TEXT)) {
    for (const m of v.matchAll(/\{([^}]*)\}/g)) assert.match(m[1], /^\w+$/, `${k} 的代入名「${m[1]}」`);
  }
});

test('fillText:代換、缺值與不存在的鍵會丟例外', () => {
  assert.equal(fillText('steps.count', { n: 2 }), '第 2 步,共 3 步');
  assert.equal(fillText('d.item', { i: 1, deg: 215 }), '第 1 次:215 度');
  assert.equal(fillText('b.degree', { deg: 0 }), '約 0 度');
  assert.equal(fillText('b.paren', { paren: '稍微偏南' }), '(稍微偏南)');
  assert.equal(fillText('common.dir', { dir: '西南' }), '西南方');
  assert.equal(fillText('a.title'), '量出大門朝哪個方向');
  assert.equal(fillText('a.title', { extra: 1 }), '量出大門朝哪個方向', '多給的值不影響');
  assert.equal(fillText('l.applied', { label: '{奇怪}的名字' }), '已套用「{奇怪}的名字」', '代入值裡的大括號不算漏給');
  assert.equal(fillText('m.denied', { message: `${sensorText.sensorMessage('permission-denied')}${sensorText.DENIED_HELP}` }),
    '需要允許「動作與方向」才能使用羅盤(沒有跳出詢問的話,請完全關閉 Safari 或主畫面 App 後重開;仍不行,到 設定 > Safari > 進階 > 網站資料 移除本網站)。請直接選大門朝哪個方向。');
  assert.throws(() => fillText('steps.count'), /缺少代入值 \{n\}/);
  assert.throws(() => fillText('steps.back', { n: 1 }), /\{name\}/);
  assert.throws(() => fillText('steps.count', { n: null }), /\{n\}/);
  assert.throws(() => fillText('no.such.key'), /沒有這個鍵/);
});

// geo + calendar 模糊測試與差分比對(獨立審查)。
// 種子固定(mulberry32),輸入含極端值;oracle 依 docs/DOMAIN_SPEC.md 2.1/2.2/3.1/4.4 的規則獨立撰寫,
// 不 import test/helpers/geo.js,也不複製 src/core 的實作:
//  - geo 用 BigInt 精確有理數算術(把 double 換成 2^-1074 為單位的整數)判定山與卦,再套規格公式。
//  - calendar 用 Meeus 第 25 章低精度太陽黃經(約 0.01 度)交叉檢查節氣,月柱與運用另寫的掃描式 oracle。
// 失敗訊息一律帶輸入,方便重現。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as geo from '../../src/core/geo.js';
import * as cal from '../../src/core/calendar.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../helpers/harness.js';

const RESEARCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'research');

// ─────────────────────────── 共用工具 ───────────────────────────

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20260929;
const uni = (r, lo, hi) => lo + (hi - lo) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const j = (v) => (typeof v === 'string' ? JSON.stringify(v) : Object.is(v, -0) ? '-0' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** 回傳值必須能無損 JSON 往返(無 undefined、NaN、-0、函式、Date/Map/Set)。 */
function assertJsonSafe(v, ctx) {
  let back;
  try {
    back = JSON.parse(JSON.stringify(v));
  } catch (e) {
    assert.fail(`不可 JSON 序列化 ${ctx}: ${e.message}`);
  }
  assert.deepStrictEqual(back, v, `JSON 往返不相等 ${ctx}`);
}

const circ = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const ulp = (x) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return dv;
};
const nextUp = (x) => {
  const dv = ulp(x);
  dv.setBigUint64(0, dv.getBigUint64(0) + (x >= 0 ? 1n : -1n));
  return dv.getFloat64(0);
};
const nextDown = (x) => {
  const dv = ulp(x);
  dv.setBigUint64(0, dv.getBigUint64(0) + (x > 0 ? -1n : 1n));
  return dv.getFloat64(0);
};

/** 效能量測:回傳 {mean, p99, max}(毫秒)。先暖機。 */
function timeIt(fn, inputs) {
  for (let k = 0; k < Math.min(50, inputs.length); k += 1) fn(inputs[k]);
  const ts = [];
  for (const x of inputs) {
    const t0 = performance.now();
    fn(x);
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return { mean: ts.reduce((a, b) => a + b, 0) / ts.length, p99: ts[Math.floor(ts.length * 0.99)], max: ts[ts.length - 1] };
}

// ─────────────────────────── geo oracle ───────────────────────────

// 規格 2.1.1 的 24 山表,逐列照抄(山, 卦, 元龍, 陰陽)。
const T24 = [
  ['子', '坎', '天元', '陰'], ['癸', '坎', '人元', '陰'], ['丑', '艮', '地元', '陰'], ['艮', '艮', '天元', '陽'],
  ['寅', '艮', '人元', '陽'], ['甲', '震', '地元', '陽'], ['卯', '震', '天元', '陰'], ['乙', '震', '人元', '陰'],
  ['辰', '巽', '地元', '陰'], ['巽', '巽', '天元', '陽'], ['巳', '巽', '人元', '陽'], ['丙', '離', '地元', '陽'],
  ['午', '離', '天元', '陰'], ['丁', '離', '人元', '陰'], ['未', '坤', '地元', '陰'], ['坤', '坤', '天元', '陽'],
  ['申', '坤', '人元', '陽'], ['庚', '兌', '地元', '陽'], ['酉', '兌', '天元', '陰'], ['辛', '兌', '人元', '陰'],
  ['戌', '乾', '地元', '陰'], ['乾', '乾', '天元', '陽'], ['亥', '乾', '人元', '陽'], ['壬', '坎', '地元', '陽'],
];
const GUA8 = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
const DIR_OF = { 坎: '北', 艮: '東北', 震: '東', 巽: '東南', 離: '南', 坤: '西南', 兌: '西', 乾: '西北' };
// 相鄰山相兼類型:用明確的清單而不是規則推導(規格 2.1.1 的 48 局分佈 16/16/8/8)。
const YINYANG_PAIRS = ['壬子', '丑艮', '甲卯', '辰巽', '丙午', '未坤', '庚酉', '戌乾'];
const YIN_PAIRS = ['子癸', '午丁', '卯乙', '酉辛'];
const YANG_PAIRS = ['艮寅', '巽巳', '坤申', '乾亥'];
function pairOracle(i, k) {
  const a = T24[i][0];
  const b = T24[k][0];
  const has = (list) => list.includes(a + b) || list.includes(b + a);
  if (has(YINYANG_PAIRS)) return 'yinyang';
  if (has(YIN_PAIRS)) return 'tongxing_yin';
  if (has(YANG_PAIRS)) return 'tongxing_yang';
  return 'chugua';
}
const LIMIT_ORACLE = {
  default: { tongxing_yin: [6, 6], tongxing_yang: [7, 7], yinyang: [5, 6], chugua: [5, 6] },
  strict5: { tongxing_yin: [6, 6], tongxing_yang: [7, 7], yinyang: [5, 5], chugua: [5, 5] },
  zggdfs6: { tongxing_yin: [6, 6], tongxing_yang: [7, 7], yinyang: [6, 6], chugua: [6, 6] },
};

// 精確算術:把 double 轉成以 2^-1074 度為單位的 BigInt(所有有限 double 都能精確表示)。
const S = 1n << 1074n;
const H = S >> 1n; // 0.5 度
const M360 = 360n * S;
const pmod = (a, m) => ((a % m) + m) % m;
function scaled(x) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const e = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (e === 0) return sign * m;
  m |= 1n << 52n;
  return sign * (m << BigInt(e - 1));
}
const toDeg = (big) => Number(big / (S >> 60n)) / 2 ** 60;

/** 精確判定:回傳 {i, dev, boundaryDist} 對指定盤(earth/ren/tian)。 */
function exactLocate(b, ring = 'earth') {
  const N = pmod(scaled(b), M360);
  const step = 15n * S;
  let i;
  let shift = 0n;
  if (ring === 'earth') i = Number(((N + 15n * H) / step) % 24n);
  else if (ring === 'ren') { i = (Number(N / step) + 1) % 24; shift = -15n * H; }
  else { i = Number(N / step) % 24; shift = 15n * H; }
  const center = 15n * BigInt(i) * S + shift;
  let dev = pmod(N - center + 180n * S, M360) - 180n * S;
  const abs = dev < 0n ? -dev : dev;
  return { i, dev: toDeg(dev), boundaryDist: toDeg(15n * H - abs), N };
}
function exactGuaIndex(b) {
  const N = pmod(scaled(b), M360);
  return Number(((N + 45n * H) / (45n * S)) % 8n);
}
const norm360 = (x) => ((x % 360) + 360) % 360;

// ─────────────────────────── geo 輸入產生器 ───────────────────────────

function genBearing(r) {
  const kind = Math.floor(r() * 12);
  switch (kind) {
    case 0: return uni(r, 0, 360);
    case 1: return uni(r, -720, 720);
    case 2: return 7.5 * Math.floor(uni(r, -100, 100)); // 7.5 的整數倍
    case 3: return 7.5 * Math.floor(uni(r, -100, 100)) + pick(r, [1e-13, -1e-13, 1e-10, -1e-10, 1e-9, -1e-9, 1e-6, -1e-6]);
    case 4: return nextUp(7.5 * Math.floor(uni(r, -50, 50)));
    case 5: return nextDown(7.5 * Math.floor(uni(r, -50, 50)));
    case 6: return pick(r, [-0, 0, 360, -360, 720, 359.99999999999994, 360 - 1e-13, -1e-300, 1e-300, 5e-324, -5e-324, 180, -180, 22.5, 337.5]);
    case 7: return (r() < 0.5 ? -1 : 1) * 10 ** uni(r, 3, 15) * r();
    case 8: return Math.floor(uni(r, -1000, 1000)) + pick(r, [0, 0.5, 0.25]);
    case 9: return 15 * Math.floor(r() * 24) + pick(r, [4.5, -4.5, 3.5, -3.5, 3, -3, 5, -5, 6, -6, 7, -7, 7.5, -7.5]);
    case 10: return uni(r, -10, 10);
    default: return uni(r, 340, 380);
  }
}

// ─────────────────────────── geo: 常數表與 §4.2 第 6 點 ───────────────────────────

test('geo MOUNTAINS 與規格 2.1.1 內嵌表逐列相同,且可由規則重算', () => {
  assert.equal(geo.MOUNTAINS.length, 24);
  T24.forEach(([name, gua, dragon, yy], i) => {
    const m = geo.MOUNTAINS[i];
    assert.deepEqual([m.name, m.gua, m.dragon, m.yinyang, m.index, m.centerDeg], [name, gua, dragon, yy, i, 15 * i], `山 ${i}`);
  });
  // 記憶檢查:四正卦 地天人 = 陽陰陰,四隅卦 = 陰陽陽。
  for (const g of GUA8) {
    const rows = T24.filter((x) => x[1] === g);
    assert.equal(rows.length, 3);
    const byDragon = Object.fromEntries(rows.map((x) => [x[2], x[3]]));
    const sishi = '乾坤艮巽'.includes(g);
    assert.deepEqual([byDragon['地元'], byDragon['天元'], byDragon['人元']], sishi ? ['陰', '陽', '陽'] : ['陽', '陰', '陰'], g);
  }
  const yangSet = new Set([...'乾坤艮巽壬丙甲庚寅申巳亥']);
  for (const m of geo.MOUNTAINS) assert.equal(m.yinyang === '陽', yangSet.has(m.name), m.name);
  // 對山同元龍同陰陽
  for (const m of geo.MOUNTAINS) {
    const o = geo.MOUNTAINS[(m.index + 12) % 24];
    assert.equal(o.dragon, m.dragon);
    assert.equal(o.yinyang, m.yinyang);
    assert.equal(geo.oppositeOf(m.name), o.name);
  }
  // 宮 = floor(((i+1)%24)/3)
  T24.forEach((row, i) => assert.equal(row[1], GUA8[Math.floor(((i + 1) % 24) / 3)]));
  assert.deepEqual([...geo.GUA], GUA8);
  assert.deepEqual(Object.fromEntries(geo.GUA.map((g, k) => [g, geo.DIR8[k]])), DIR_OF);
});

test('geo LIMITS 與 limitsFor 對規格 2.1.1 與 D03', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(geo.LIMITS)), LIMIT_ORACLE.default);
  for (const [school, tab] of Object.entries(LIMIT_ORACLE)) assert.deepEqual(JSON.parse(JSON.stringify(geo.limitsFor(school))), tab, school);
  assert.throws(() => geo.limitsFor('nope'), /^Error: INVALID_OPTION/);
});

test('geo 48 局分類:出卦 16、陰陽互兼 16、同陰 8、同陽 8;pairTypeOf 兩方向皆對', () => {
  const count = { chugua: 0, yinyang: 0, tongxing_yin: 0, tongxing_yang: 0 };
  for (let i = 0; i < 24; i += 1) {
    const k = (i + 1) % 24;
    const want = pairOracle(i, k);
    const a = T24[i][0];
    const b = T24[k][0];
    assert.equal(geo.pairTypeOf(a, b), want, `${a}-${b}`);
    assert.equal(geo.pairTypeOf(b, a), want, `${b}-${a}`);
    count[want] += 2;
  }
  assert.deepEqual(count, { chugua: 16, yinyang: 16, tongxing_yin: 8, tongxing_yang: 8 });
  assert.throws(() => geo.pairTypeOf('子', '丑'), /^Error: NOT_ADJACENT_MOUNTAINS/);
  assert.throws(() => geo.pairTypeOf('子', '子'), /^Error: NOT_ADJACENT_MOUNTAINS/);
  assert.throws(() => geo.pairTypeOf('X', '子'), /^Error: UNKNOWN_MOUNTAIN/);
  assert.throws(() => geo.pairTypeOf('子', 'X'), /^Error: UNKNOWN_MOUNTAIN/);
});

// ─────────────────────────── geo: normalizeBearing ───────────────────────────

test('geo normalizeBearing: 範圍 [0,360)、與輸入同餘(精確)、冪等、不出 -0', () => {
  const r = mulberry32(SEED + 1);
  for (let n = 0; n < 6000; n += 1) {
    const b = genBearing(r);
    const out = geo.normalizeBearing(b);
    assert.ok(out >= 0 && out < 360, `範圍 ${j(b)} -> ${out}`);
    assert.ok(!Object.is(out, -0), `輸出 -0: 輸入 ${j(b)}`);
    const diff = pmod(scaled(out) - scaled(b), M360);
    if (b >= 0) assert.equal(diff, 0n, `同餘(非負輸入應精確) ${j(b)} -> ${out}`);
    else assert.ok(Math.min(toDeg(diff), 360 - toDeg(diff)) < 1e-12, `同餘 ${j(b)} -> ${out}`); // 負數加 360 會捨入,誤差 <= 0.5 ulp(360)
    assert.equal(geo.normalizeBearing(out), out, `冪等 ${j(b)}`);
  }
});

test('geo 非法輸入丟 INVALID_BEARING(NaN、Infinity、非數字型別)', () => {
  const bad = [NaN, Infinity, -Infinity, '5', null, undefined, true, {}, [], [5], 10n];
  for (const b of bad) {
    for (const fn of [geo.normalizeBearing, geo.mountainAt, geo.guaAt, geo.sitFromFacing, geo.analyzeBearing]) {
      assert.throws(() => fn(b), /^Error: INVALID_BEARING/, `${fn.name}(${String(b)})`);
    }
    assert.throws(() => geo.circularDiff(b, 0), /^Error: INVALID_BEARING/);
    assert.throws(() => geo.circularDiff(0, b), /^Error: INVALID_BEARING/);
    assert.throws(() => geo.toTrue(b, 1), /^Error: INVALID_BEARING/);
    assert.throws(() => geo.toMagnetic(b, 1), /^Error: INVALID_BEARING/);
  }
});

// ─────────────────────────── geo: mountainAt / guaAt ───────────────────────────

const RING_CENTER0 = { earth: 0, ren: 352.5, tian: 7.5 };

/** 對單一輸入做 mountainAt 與精確 oracle 比對;回傳錯誤描述陣列(空=通過),供突變測試重用。 */
function checkMountain(fn, b, ring) {
  const errs = [];
  const got = fn(b, ring);
  const ex = exactLocate(b, ring);
  const nearBoundary = ex.boundaryDist < 1e-11;
  if (got.index !== ex.i) {
    // 只允許在界線 1e-11 內,且回傳的 dev 仍在 [-7.5,7.5] 內並與輸入一致。
    if (!nearBoundary) errs.push(`index ${got.index} != ${ex.i}`);
    else if (!(Math.abs(got.dev) <= 7.5 && circ(got.centerDeg + got.dev, b) < 1e-9)) errs.push('界線附近自相矛盾');
    return errs;
  }
  if (Math.abs(got.dev - ex.dev) > 1e-9) errs.push(`dev ${got.dev} != ${ex.dev}`);
  if (!(got.dev >= -7.5 && got.dev < 7.5)) errs.push(`dev 超出 [-7.5,7.5): ${got.dev}`);
  const row = T24[ex.i];
  if (got.name !== row[0]) errs.push(`name ${got.name}`);
  if (got.gua !== row[1] || got.dragon !== row[2] || got.yinyang !== row[3]) errs.push('gua/dragon/yinyang');
  if (got.dir8 !== DIR_OF[row[1]]) errs.push('dir8');
  if (got.opposite !== T24[(ex.i + 12) % 24][0]) errs.push('opposite');
  const c0 = RING_CENTER0[ring];
  const center = norm360(c0 + 15 * ex.i);
  if (circ(got.centerDeg, center) > 1e-9) errs.push(`centerDeg ${got.centerDeg} != ${center}`);
  if (circ(got.startDeg, center - 7.5) > 1e-9 || circ(got.endDeg, center + 7.5) > 1e-9) errs.push('start/end');
  return errs;
}

test('geo mountainAt 三個盤對精確 oracle 差分(含界線與極端值)', () => {
  const r = mulberry32(SEED + 2);
  for (let n = 0; n < 9000; n += 1) {
    const b = genBearing(r);
    const ring = pick(r, ['earth', 'ren', 'tian']);
    const errs = checkMountain(geo.mountainAt, b, ring);
    assert.deepEqual(errs, [], `mountainAt(${j(b)}, ${ring})`);
  }
});

test('geo 恰在 7.5 的整數倍歸順時針下一山(D01),earth 盤 index = floor((k+1)/2) mod 24', () => {
  for (let k = -200; k <= 200; k += 1) {
    const b = 7.5 * k;
    const idx = pmod(BigInt(Math.floor((k + 1) / 2)), 24n);
    const got = geo.mountainAt(b);
    assert.equal(got.index, Number(idx), `k=${k} b=${b}`);
    assert.ok(got.dev >= -7.5 && got.dev < 7.5);
    if (k % 2 !== 0) assert.equal(got.dev, -7.5, `界線 dev 應為 -7.5: b=${b}`);
    // ren / tian:界線為 15 的倍數
    if (k % 2 === 0) {
      assert.equal(geo.mountainAt(b, 'ren').index, (pmod(BigInt((k / 2)), 24n) + 1n) % 24n === 0n ? 0 : Number((pmod(BigInt(k / 2), 24n) + 1n) % 24n));
      assert.equal(geo.mountainAt(b, 'tian').index, Number(pmod(BigInt(k / 2), 24n)));
    }
  }
});

test('geo mountainAt 屬性:index 對 bearing 單調、dev 連續、掃描 0..360', () => {
  let prev = geo.mountainAt(0);
  assert.equal(prev.index, 0);
  let maxIdx = 0;
  for (let b = 0.05; b < 360; b += 0.05) {
    const m = geo.mountainAt(b);
    if (b < 352.5 - 1e-9) {
      assert.ok(m.index >= maxIdx, `index 倒退於 ${b}`);
      maxIdx = m.index;
    } else assert.equal(m.index, 0, `352.5 之後應回子: ${b}`);
    if (m.index === prev.index) assert.ok(Math.abs(m.dev - prev.dev - 0.05) < 1e-9, `dev 不連續於 ${b}`);
    prev = m;
  }
  assert.equal(maxIdx, 23);
});

test('geo mountainAt 未知 ring 丟 INVALID_OPTION', () => {
  for (const ring of ['x', '', null, 'EARTH', 'toString', '__proto__', 'constructor']) {
    assert.throws(() => geo.mountainAt(10, ring), /^Error: INVALID_OPTION/, String(ring));
  }
});

test('geo guaAt 對精確 oracle 差分', () => {
  const r = mulberry32(SEED + 3);
  for (let n = 0; n < 5000; n += 1) {
    const b = genBearing(r);
    const got = geo.guaAt(b);
    const k = exactGuaIndex(b);
    const N = pmod(scaled(b), M360);
    const edge = toDeg(pmod(N + 45n * H, 45n * S)); // 距離下一個 22.5+45k 界線
    const nearEdge = Math.min(edge, 45 - edge) < 1e-11;
    if (got.index !== k && nearEdge) continue;
    assert.equal(got.index, k, `guaAt(${j(b)})`);
    assert.equal(got.gua, GUA8[k]);
    assert.equal(got.dir8, DIR_OF[GUA8[k]]);
  }
  // 規格 2.1.1 的分區:坎 337.5-22.5 ...,半開
  const spans = [[337.5, 22.5, '坎'], [22.5, 67.5, '艮'], [67.5, 112.5, '震'], [112.5, 157.5, '巽'], [157.5, 202.5, '離'], [202.5, 247.5, '坤'], [247.5, 292.5, '兌'], [292.5, 337.5, '乾']];
  for (const [s, , g] of spans) {
    assert.equal(geo.guaAt(s).gua, g, `起點 ${s} 歸 ${g}`);
    assert.notEqual(geo.guaAt(s - 1e-9).gua, g, `起點前 1e-9 不歸 ${g}`); // 1 ulp 內受 (b+22.5) 捨入影響,規格公式本身如此
  }
});

test('geo 山與卦一致:mountainAt(b).gua 與 guaAt(b) 只在卦界的 1e-11 內可不同', () => {
  const r = mulberry32(SEED + 4);
  for (let n = 0; n < 4000; n += 1) {
    const b = genBearing(r);
    const m = geo.mountainAt(b);
    const g = geo.guaAt(b);
    if (m.gua !== g.gua) {
      const ex = exactLocate(b);
      assert.ok(ex.boundaryDist < 1e-11 || Math.abs(m.dev) > 7.4999999, `山卦不一致 ${j(b)}: ${m.name}/${m.gua} vs ${g.gua}`);
    }
  }
  // 宮位以山界為準:每個山中心 ±7.4 內都與 guaAt 同卦(無例外)
  for (let i = 0; i < 24; i += 1) for (const d of [-7.4, -3, 0, 3, 7.4]) {
    assert.equal(geo.guaAt(15 * i + d).gua, T24[i][1], `山 ${T24[i][0]} ${d}`);
  }
});

// ─────────────────────────── geo: sitFromFacing ───────────────────────────

test('geo sitFromFacing 屬性:sit = normalize(x+180)、對山 index+12、宅卦 = 坐山所屬卦', () => {
  const r = mulberry32(SEED + 5);
  for (let n = 0; n < 6000; n += 1) {
    const b = genBearing(r);
    const s = geo.sitFromFacing(b);
    const ex = exactLocate(b);
    const fm = geo.mountainAt(b);
    assert.equal(s.facingMountain, fm.name, `facingMountain ${j(b)}`);
    if (ex.boundaryDist < 1e-11) {
      // 界線 1e-11 內只要求自洽:坐山是向山的對山,宅卦是坐山的卦
      assert.equal(s.sitMountain, T24[(geo.mountainIndex(s.facingMountain) + 12) % 24][0]);
      assert.equal(s.zhaiGua, geo.guaOfMountain(s.sitMountain));
    } else {
      assert.equal(s.facingMountain, T24[ex.i][0], `oracle 向山 ${j(b)}`);
      assert.equal(s.sitMountain, T24[(ex.i + 12) % 24][0], `坐山 ${j(b)}`);
      assert.equal(s.zhaiGua, T24[(ex.i + 12) % 24][1]);
    }
    assert.equal(s.zhaiSitDir, DIR_OF[s.zhaiGua]);
    assert.ok(s.sitBearing >= 0 && s.sitBearing < 360);
    assert.ok(circ(s.sitBearing, b + 180) < 1e-9, `sitBearing ${j(b)} -> ${s.sitBearing}`);
    assert.ok(!Object.is(s.sitBearing, -0));
    // 坐山應與 mountainAt(sitBearing) 一致(界線內除外)
    const ms = geo.mountainAt(s.sitBearing);
    if (ms.name !== s.sitMountain) assert.ok(exactLocate(s.sitBearing).boundaryDist < 1e-11 || ex.boundaryDist < 1e-11, `坐山與 mountainAt(sit) 不一致 ${j(b)}`);
  }
});

test('geo sitFromFacing 附錄 B.1 邊界:facing 22.5/22.4999/157.5/157.4999/337.5/337.4999/-300', () => {
  const cases = [[22.5, '坤'], [22.4999, '離'], [157.5, '坎'], [157.4999, '乾'], [337.5, '離'], [337.4999, '巽'], [-300, '坤']];
  for (const [f, gua] of cases) assert.equal(geo.sitFromFacing(f).zhaiGua, gua, `facing=${f}`);
  assert.equal(geo.sitFromFacing(-300).sitBearing, 240);
});

// ─────────────────────────── geo: analyzeBearing ───────────────────────────

/** 依規格 2.1.3 逐步計算的 oracle。回傳 null 表示落在判定帶(距任一門檻 0 < d < 1e-8),不比。 */
function oracleAnalyze(b, o) {
  const ex = exactLocate(b);
  const i = ex.i;
  const dev = ex.dev;
  const adev = Math.abs(dev);
  const gates = [o.threshold, 6.0, 7.0, 7.5 - o.uncertainty, 7.5 - Math.max(o.uncertainty, 3)];
  const lim = LIMIT_ORACLE[o.jianLimitSchool];
  for (const t of Object.values(lim)) gates.push(t[0], t[1]);
  for (const g of gates) {
    const d = Math.abs(adev - g);
    if (d > 0 && d < 3e-8) return null; // 精確相等(d==0)要比;規格的 +1e-9 端點帶 (0,1e-9] 一併略過
  }
  if (ex.boundaryDist < 1e-11) return null;
  const zone = adev <= o.threshold + 1e-9 ? 'zheng' : 'jian';
  const k = dev > 0 ? (i + 1) % 24 : (i + 23) % 24;
  const type = pairOracle(i, k);
  const [okMax, voidAbove] = lim[type];
  const level = zone === 'zheng' ? 'zheng' : adev <= okMax ? 'jian' : adev <= voidAbove ? 'jian_caution' : 'void';
  const boundaryDist = 7.5 - adev;
  const boundaryKind = T24[i][1] !== T24[k][1] ? 'gua' : 'shan';
  const onLine = boundaryDist < 0.5;
  const retest = boundaryDist < o.uncertainty;
  let pos = null;
  let deg = null;
  if (level === 'void' || onLine) {
    if (boundaryKind === 'gua') { pos = 'da'; deg = 'da'; } else if (type === 'yinyang') { pos = 'xiao'; deg = 'xiao'; } else { pos = 'xiao'; deg = 'kongxiang'; }
  }
  return {
    mountain: T24[i][0], index: i, dev, zone, level,
    leanTo: zone === 'jian' ? T24[k][0] : null, pairType: zone === 'jian' ? type : null,
    boundaryDist, boundaryKind,
    kongwangKind: o.kongwangLabelScheme === 'degree' ? deg : pos, kongwangKindDegree: deg,
    onLine, retest, outer1p5: adev >= 6.0,
    needsTiGua: zone === 'jian' && (type === 'yinyang' || type === 'chugua'),
    gua: T24[i][1], dir8: DIR_OF[T24[i][1]], opposite: T24[(i + 12) % 24][0],
    labeled: pos !== null, nearGuaFinding: boundaryKind === 'gua' && boundaryDist < Math.max(o.uncertainty, 3),
    neighborMountain: T24[k][0], neighborGua: T24[k][1],
  };
}

function checkAnalyze(fn, b, o) {
  const errs = [];
  const want = oracleAnalyze(b, o);
  if (want === null) return errs;
  const got = fn(b, o);
  // dev 在 1e-9 內時符號會被 (x+180)%360+360 的捨入吃掉(規格公式本身如此),鄰山相關欄位不比。
  const tiny = Math.abs(want.dev) < 1e-9;
  const neighborKeys = new Set(['leanTo', 'pairType', 'boundaryKind', 'kongwangKind', 'kongwangKindDegree', 'neighborMountain', 'neighborGua']);
  for (const key of ['mountain', 'index', 'zone', 'level', 'leanTo', 'pairType', 'boundaryKind', 'kongwangKind', 'kongwangKindDegree', 'onLine', 'retest', 'outer1p5', 'needsTiGua', 'gua', 'dir8', 'opposite', 'neighborMountain', 'neighborGua']) {
    if (tiny && neighborKeys.has(key)) continue;
    if (got[key] !== want[key]) errs.push(`${key}: got ${j(got[key])} want ${j(want[key])}`);
  }
  if (Math.abs(got.dev - want.dev) > 1e-9) errs.push(`dev ${got.dev} vs ${want.dev}`);
  if (Math.abs(got.boundaryDist - want.boundaryDist) > 1e-9) errs.push(`boundaryDist ${got.boundaryDist} vs ${want.boundaryDist}`);
  if (tiny) return errs;
  if (want.labeled !== (got.schoolNote !== null)) errs.push(`schoolNote 有無不符: ${j(got.schoolNote)}`);
  if (want.labeled && want.kongwangKindDegree === 'kongxiang' && typeof got.schoolNote !== 'string') errs.push('同性相兼標籤缺 schoolNote');
  const f = got.findings.filter((x) => x.id === 'geo.near_gua_boundary');
  if ((f.length === 1) !== want.nearGuaFinding || got.findings.length !== f.length) errs.push(`近卦界 finding: ${got.findings.length}`);
  return errs;
}

function genOpts(r) {
  return {
    threshold: r() < 0.5 ? pick(r, [4.5, 3.5, 3.0]) : uni(r, 0.5, 7.4),
    uncertainty: r() < 0.5 ? pick(r, [3.0, 5.0, 0, 10]) : uni(r, 0, 12),
    kongwangLabelScheme: pick(r, ['position', 'degree']),
    jianLimitSchool: pick(r, ['default', 'strict5', 'zggdfs6']),
  };
}

test('geo analyzeBearing 對規格 2.1.3 oracle 差分(隨機輸入 x 隨機選項)', () => {
  const r = mulberry32(SEED + 6);
  for (let n = 0; n < 8000; n += 1) {
    const b = genBearing(r);
    const o = genOpts(r);
    const errs = checkAnalyze(geo.analyzeBearing, b, o);
    assert.deepEqual(errs, [], `analyzeBearing(${j(b)}, ${j(o)})`);
  }
});

test('geo analyzeBearing 48 個有向界線各取 adev = 5.5 與 6.5(附錄 B.5 自動生成集)', () => {
  for (const scheme of ['position', 'degree']) for (const school of ['default', 'strict5', 'zggdfs6']) {
    for (let i = 0; i < 24; i += 1) for (const sgn of [1, -1]) for (const adev of [5.5, 6.5, 4.5, 4.4, 5, 6, 7, 7.4]) {
      const b = norm360(15 * i + sgn * adev);
      const o = { threshold: 4.5, uncertainty: 3, kongwangLabelScheme: scheme, jianLimitSchool: school };
      assert.deepEqual(checkAnalyze(geo.analyzeBearing, b, o), [], `${T24[i][0]} ${sgn * adev} ${school} ${scheme}`);
    }
  }
});

test('geo analyzeBearing 恰在門檻:threshold/okMax/voidAbove/6.0/7.0/uncertainty 的等號歸屬', () => {
  const o = { threshold: 4.5, uncertainty: 3, kongwangLabelScheme: 'position', jianLimitSchool: 'default' };
  for (let i = 0; i < 24; i += 1) for (const sgn of [1, -1]) {
    const at = (adev, opts = o) => geo.analyzeBearing(norm360(15 * i + sgn * adev), opts);
    assert.equal(at(4.5).zone, 'zheng', '恰好 4.5 歸下卦(D02)');
    assert.equal(at(4.5 + 5e-10).zone, 'zheng', '4.5+5e-10 仍歸下卦(規格 +1e-9)');
    assert.equal(at(4.5 + 2e-9).zone, 'jian');
    assert.equal(at(3.5, { ...o, threshold: 3.5 }).zone, 'zheng');
    assert.equal(at(3.5 + 1e-6, { ...o, threshold: 3.5 }).zone, 'jian');
    assert.equal(at(3.0, { ...o, threshold: 3.0 }).zone, 'zheng');
    assert.equal(at(6.0).outer1p5, true, 'adev=6.0 outer1p5');
    assert.equal(at(5.999999).outer1p5, false);
    assert.equal(at(7.0).onLine, false, 'boundaryDist=0.5 不算 onLine');
    assert.equal(at(7.000001).onLine, true);
    assert.equal(at(4.5, { ...o, uncertainty: 3 }).retest, false, 'boundaryDist=3 不小於 uncertainty=3');
    assert.equal(at(4.500001, { ...o, uncertainty: 3 }).retest, true);
  }
});

test('geo analyzeBearing 規格範例 175.0 與 187.4', () => {
  const a = geo.analyzeBearing(175.0);
  assert.equal(a.mountain, '午');
  assert.equal(a.index, 12);
  assert.ok(Math.abs(a.dev - -5) < 1e-9);
  assert.equal(a.zone, 'jian');
  assert.equal(a.level, 'jian');
  assert.equal(a.leanTo, '丙');
  assert.equal(a.pairType, 'yinyang');
  assert.ok(Math.abs(a.boundaryDist - 2.5) < 1e-9);
  assert.equal(a.boundaryKind, 'shan');
  assert.equal(a.kongwangKind, null);
  assert.equal(a.kongwangKindDegree, null);
  assert.equal(a.onLine, false);
  assert.equal(a.retest, true);
  assert.equal(a.outer1p5, false);
  assert.equal(a.needsTiGua, true);
  assert.deepEqual([a.gua, a.dir8, a.opposite], ['離', '南', '子']);
  const b = geo.analyzeBearing(187.4);
  assert.deepEqual([b.mountain, b.zone, b.level, b.leanTo, b.pairType, b.boundaryKind, b.onLine, b.kongwangKind, b.kongwangKindDegree, b.needsTiGua, b.retest],
    ['午', 'jian', 'void', '丁', 'tongxing_yin', 'shan', true, 'xiao', 'kongxiang', false, true]);
  assert.ok(Math.abs(b.dev - 7.4) < 1e-9 && Math.abs(b.boundaryDist - 0.1) < 1e-9);
  assert.equal(typeof b.schoolNote, 'string');
  assert.equal(geo.analyzeBearing(187.4, { kongwangLabelScheme: 'degree' }).kongwangKind, 'kongxiang');
});

test('geo analyzeBearing 屬性:needsTiGua 對同性相兼恆 false;dev 保留正負號;level/zone 一致', () => {
  const r = mulberry32(SEED + 7);
  for (let n = 0; n < 5000; n += 1) {
    const b = uni(r, -400, 800);
    const o = genOpts(r);
    const a = geo.analyzeBearing(b, o);
    if (a.pairType === 'tongxing_yin' || a.pairType === 'tongxing_yang') assert.equal(a.needsTiGua, false, `${b}`);
    assert.equal(a.zone === 'zheng', a.level === 'zheng');
    assert.equal(a.zone === 'zheng', a.leanTo === null);
    assert.equal(a.zone === 'zheng', a.pairType === null);
    assert.ok(a.dev >= -7.5 && a.dev < 7.5);
    assert.equal(a.boundaryDist >= 0 && a.boundaryDist <= 7.5, true);
    if (a.zone === 'jian') {
      const ni = (a.index + (a.dev > 0 ? 1 : 23)) % 24;
      assert.equal(a.leanTo, T24[ni][0], `leanTo 應在 dev 符號那一側 b=${b}`);
    }
    if (a.kongwangKind !== null) assert.ok(a.level === 'void' || a.onLine);
    if (a.level === 'void' || a.onLine) assert.notEqual(a.kongwangKindDegree, null);
    if (a.kongwangKindDegree === 'kongxiang') assert.equal(a.kongwangKind, o.kongwangLabelScheme === 'degree' ? 'kongxiang' : 'xiao');
    // 山與 mountainAt 一致
    assert.equal(a.mountain, geo.mountainAt(b).name);
    assert.equal(a.gua, geo.mountainAt(b).gua);
  }
});

test('geo analyzeBearing 選項驗證', () => {
  const bad = [
    { threshold: 0 }, { threshold: 7.5 }, { threshold: -1 }, { threshold: NaN }, { threshold: '4.5' }, { threshold: Infinity },
    { uncertainty: -1 }, { uncertainty: NaN }, { uncertainty: Infinity }, { kongwangLabelScheme: 'x' }, { jianLimitSchool: 'x' }, { nope: 1 },
  ];
  for (const o of bad) assert.throws(() => geo.analyzeBearing(10, o), /^Error: INVALID_OPTION/, j(o));
  for (const o of [null, 5, 'x', []]) assert.throws(() => geo.analyzeBearing(10, o), /^Error: INVALID_OPTION/, j(o));
  assert.doesNotThrow(() => geo.analyzeBearing(10, {}));
  assert.doesNotThrow(() => geo.analyzeBearing(10, { threshold: 7.4999 }));
  assert.doesNotThrow(() => geo.analyzeBearing(10, { uncertainty: 0 }));
});

test('geo boundaryOptsFromSettings 讀 settings 而非魔術值', () => {
  const d = geo.boundaryOptsFromSettings();
  assert.deepEqual(d, { threshold: DEFAULT_SETTINGS.xiaGuaHalfWidth, uncertainty: DEFAULT_SETTINGS.measureUncertainty, kongwangLabelScheme: 'position', jianLimitSchool: 'default' });
  const s = geo.boundaryOptsFromSettings({ xiaGuaHalfWidth: 3.5, measureUncertainty: 8, kongwangLabelScheme: 'degree', jianLimitSchool: 'strict5' });
  assert.deepEqual(s, { threshold: 3.5, uncertainty: 8, kongwangLabelScheme: 'degree', jianLimitSchool: 'strict5' });
  assert.throws(() => geo.boundaryOptsFromSettings({ typo: 1 }), /未知的設定鍵/);
  // meta.ruleset 回存實際採用值
  const a = geo.analyzeBearing(100, s);
  assert.deepEqual(a.meta.ruleset, { xiaGuaHalfWidth: 3.5, jianLimitSchool: 'strict5', kongwangLabelScheme: 'degree', measureUncertainty: 8 });
  assert.equal(geo.analyzeBearing(100).meta.ruleset.measureUncertainty, 3.0, '純函式預設 3.0(D05)');
});

test('geo 純度:不修改輸入(凍結)、決定性、可 JSON 往返', () => {
  const r = mulberry32(SEED + 8);
  for (let n = 0; n < 600; n += 1) {
    const b = genBearing(r);
    const o = deepFreeze(genOpts(r));
    const a1 = geo.analyzeBearing(b, o);
    const a2 = geo.analyzeBearing(b, o);
    assert.deepStrictEqual(a1, a2);
    assertJsonSafe(a1, `analyzeBearing(${j(b)})`);
    assertJsonSafe(geo.mountainAt(b, pick(r, ['earth', 'ren', 'tian'])), `mountainAt(${j(b)})`);
    assertJsonSafe(geo.guaAt(b), 'guaAt');
    assertJsonSafe(geo.sitFromFacing(b), 'sitFromFacing');
    // 回傳物件是新的:改回傳值不影響下次結果
    a1.findings.push('x');
    a1.meta.ruleset.xiaGuaHalfWidth = 999;
    assert.deepStrictEqual(geo.analyzeBearing(b, o), a2);
  }
  // 匯出的常數表是凍結的,呼叫端無法污染
  assert.throws(() => { geo.MOUNTAINS[0].name = 'X'; }, TypeError);
  assert.throws(() => { geo.MOUNTAINS.push({}); }, TypeError);
  assert.throws(() => { geo.LIMITS.yinyang[0] = 99; }, TypeError);
  assert.throws(() => { geo.CITY_DECLINATIONS['台北'].declinationDeg = 0; }, TypeError);
  assert.throws(() => { geo.GUA.push('x'); }, TypeError);
});

// ─────────────────────────── geo: 磁北真北 ───────────────────────────

test('geo toTrue/toMagnetic:互逆、範圍、符號方向(東偏為正)', () => {
  const r = mulberry32(SEED + 9);
  for (let n = 0; n < 4000; n += 1) {
    const m = genBearing(r);
    const D = r() < 0.2 ? pick(r, [-180, 180, 0, -0, 5, -5]) : uni(r, -180, 180);
    const t = geo.toTrue(m, D);
    assert.ok(t >= 0 && t < 360 && !Object.is(t, -0), `toTrue(${j(m)}, ${D}) = ${t}`);
    assert.ok(circ(t, norm360(m) + D) < 1e-9);
    const back = geo.toMagnetic(t, D);
    assert.ok(back >= 0 && back < 360 && !Object.is(back, -0));
    assert.ok(circ(back, m) < 1e-9, `往返 ${j(m)} D=${D}`);
  }
  // 台北 D=-5.03:面向真北 → 磁讀數約 5;磁讀數 5 → 真北 ~0
  assert.ok(Math.abs(geo.toMagnetic(0, -5.03) - 5.03) < 1e-9);
  assert.ok(circ(geo.toTrue(5.03, -5.03), 0) < 1e-9);
  for (const D of [NaN, Infinity, -Infinity, 181, -181, '5', null, undefined]) {
    assert.throws(() => geo.toTrue(10, D), /^Error: INVALID_DECLINATION/, String(D));
    assert.throws(() => geo.toMagnetic(10, D), /^Error: INVALID_DECLINATION/, String(D));
    assert.throws(() => geo.compareMagVsTrue(10, D), /^Error: INVALID_DECLINATION/, String(D));
  }
});

test('geo compareMagVsTrue 與 mountainAt/guaAt 一致', () => {
  const r = mulberry32(SEED + 10);
  for (let n = 0; n < 2000; n += 1) {
    const m = uni(r, -400, 800);
    const D = uni(r, -12, 12);
    const c = geo.compareMagVsTrue(m, D);
    assert.equal(c.magneticMountain, geo.mountainAt(m).name);
    assert.equal(c.trueMountain, geo.mountainAt(geo.toTrue(m, D)).name);
    assert.equal(c.sameMountain, c.magneticMountain === c.trueMountain);
    assert.equal(c.sameGua, c.magneticGua === c.trueGua);
    assert.ok(circ(c.trueBearing, c.magneticBearing + D) < 1e-9);
    assertJsonSafe(c, 'compareMagVsTrue');
  }
  // 規格 2.1.5:不校正時換山機率約 |D|/15
  let diff = 0;
  const N = 20000;
  const r2 = mulberry32(SEED + 11);
  for (let n = 0; n < N; n += 1) if (!geo.compareMagVsTrue(uni(r2, 0, 360), -5.06).sameMountain) diff += 1;
  assert.ok(Math.abs(diff / N - 5.06 / 15) < 0.02, `換山比例 ${diff / N}`);
});

test('geo declinationFor/Info:線性年變化、有效期旗標、城市表對 orientation.json 參考值', () => {
  const fx = loadFixture('orientation');
  const refs = fx.cases.filter((c) => c.input && c.input.fn === 'declinationReference');
  assert.equal(refs.length, 17);
  const t2026 = Date.UTC(2026, 0, 1);
  let compared = 0;
  for (const c of refs) {
    const d = geo.declinationFor(c.input.city, t2026);
    assert.ok(Math.abs(d - c.expected.declinationDeg) <= 0.02, `${c.input.city}: ${d} vs ${c.expected.declinationDeg}`); // 規格 4.1:0.02 度
    const info = geo.declinationInfo(c.input.city, t2026);
    assert.ok(Math.abs(geo.CITY_DECLINATIONS[c.input.city].annualChangeDegPerYear - c.expected.annualChangeDegPerYear) <= 0.005, `${c.input.city} 年變化`);
    assert.ok(Math.abs(geo.CITY_DECLINATIONS[c.input.city].lat - c.input.lat) < 1e-9 && Math.abs(geo.CITY_DECLINATIONS[c.input.city].lon - c.input.lon) < 1e-9);
    assert.equal(info.yearFraction, 2026);
    compared += 1;
  }
  assert.equal(compared, 17);
  const r = mulberry32(SEED + 12);
  for (let n = 0; n < 500; n += 1) {
    const city = pick(r, Object.keys(geo.CITY_DECLINATIONS));
    const t = Date.UTC(1990, 0, 1) + r() * (Date.UTC(2100, 0, 1) - Date.UTC(1990, 0, 1));
    const info = geo.declinationInfo(city, t);
    const y = new Date(t).getUTCFullYear();
    const yf = y + (t - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
    assert.ok(Math.abs(info.yearFraction - yf) < 1e-9);
    const c = geo.CITY_DECLINATIONS[city];
    assert.ok(Math.abs(info.declinationDeg - (c.declinationDeg + c.annualChangeDegPerYear * (yf - 2026))) < 1e-9);
    assert.equal(info.inModelRange, yf >= 2025 && yf < 2030);
    assert.equal(geo.declinationFor(city, t), info.declinationDeg);
    assertJsonSafe(info, 'declinationInfo');
  }
  for (const bad of [NaN, Infinity, '2026', null, undefined, 8.64e15 + 1, -8.64e15 - 1]) {
    assert.throws(() => geo.declinationFor('台北', bad), /^Error: INVALID_DATE/, String(bad));
  }
  for (const c of ['nowhere', '', undefined, null, 5, 'toString', '__proto__', 'constructor', 'hasOwnProperty']) {
    assert.throws(() => geo.declinationFor(c, t2026), /^Error: UNKNOWN_CITY/, String(c));
  }
  // 規格 2.1.5:台北 2026-09-29 約 -5.06(D 東偏為正)
  const tp = geo.declinationFor('台北', Date.UTC(2026, 8, 29));
  assert.ok(Math.abs(tp - -5.06) < 0.02, `台北 ${tp}`);
});

test('geo CITY_DECLINATIONS 對 orientation.md 3.5 城市表逐列(獨立來源)', () => {
  const md = readFileSync(path.join(RESEARCH, 'orientation.md'), 'utf8');
  const start = md.indexOf('### 3.5 磁偏角城市表');
  const end = md.indexOf('第三方核對', start);
  const rows = md.slice(start, end).split('\n').filter((l) => /^\| [^|\-]+ \| [\d.]+ \| [\d.]+ \|/.test(l)).map((l) => l.split('|').map((x) => x.trim()).slice(1, -1));
  assert.equal(rows.length, 41);
  assert.deepEqual(Object.keys(geo.CITY_DECLINATIONS).filter((k) => !rows.some((r) => r[0] === k)), ['首爾'], '表內城市只多首爾(取自 orientation.json 參考)');
  const num = (x) => Number(x.replace('+', ''));
  const t0929 = Date.UTC(2026, 8, 29);
  for (const [name, lat, lon, , d2026, d0929, rate] of rows) {
    const c = geo.CITY_DECLINATIONS[name];
    assert.ok(c, `缺城市 ${name}`);
    assert.ok(Math.abs(c.lat - num(lat)) < 1e-9 && Math.abs(c.lon - num(lon)) < 1e-9, `${name} 經緯度`);
    assert.ok(Math.abs(c.declinationDeg - num(d2026)) <= 0.005 + 1e-9, `${name} D2026 ${c.declinationDeg} vs ${d2026}`);
    assert.ok(Math.abs(c.annualChangeDegPerYear - num(rate)) <= 0.0005 + 1e-9, `${name} 年變化`);
    assert.ok(Math.abs(geo.declinationFor(name, t0929) - num(d0929)) <= 0.012, `${name} 2026-09-29: ${geo.declinationFor(name, t0929)} vs ${d0929}`);
  }
});

test('geo Finding 形狀符合規格 1.4,文字不含暱稱', () => {
  const seen = [];
  for (let b = 0; b < 360; b += 0.25) {
    for (const f of geo.analyzeBearing(b, { uncertainty: 5 }).findings) seen.push(f);
  }
  assert.ok(seen.length > 100, '應在卦界附近產生 Finding');
  for (const f of seen) {
    assert.deepEqual(Object.keys(f).sort(), ['body', 'confidence', 'id', 'level', 'refs', 'schoolNote', 'tag', 'title']);
    assert.ok(['info', 'note', 'caution'].includes(f.level));
    assert.ok(['high', 'medium', 'low'].includes(f.confidence));
    assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag));
    assert.ok(Array.isArray(f.refs) && f.refs.every((x) => typeof x === 'string'));
    assert.ok(typeof f.id === 'string' && typeof f.title === 'string' && typeof f.body === 'string');
    assert.ok(!/帥哥|ENI/.test(JSON.stringify(f)));
  }
  // 卦界:每個 22.5+45k 附近 5 度內才有 finding(uncertainty=5),別處沒有
  for (let b = 0; b < 360; b += 0.25) {
    const has = geo.analyzeBearing(b, { uncertainty: 5 }).findings.length > 0;
    const d = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => circ(b, 22.5 + 45 * k)));
    if (d < 4.99) assert.equal(has, true, `b=${b} 距卦界 ${d}`);
    if (d > 5.01) assert.equal(has, false, `b=${b} 距卦界 ${d}`);
  }
});

// ─────────────────────────── geo: 圓周統計 ───────────────────────────

function oracleMean(xs) {
  const f = (t) => xs.reduce((a, x) => a + (1 - Math.cos(((x - t) * Math.PI) / 180)), 0);
  let best = 0;
  let bv = Infinity;
  for (let k = 0; k < 3600; k += 1) {
    const v = f(k * 0.1);
    if (v < bv) { bv = v; best = k * 0.1; }
  }
  let lo = best - 0.1;
  let hi = best + 0.1;
  for (let n = 0; n < 100; n += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2; else lo = m1;
  }
  return norm360((lo + hi) / 2);
}
function oracleStd(xs, mean) {
  const oneMinusCos = (d) => (Math.abs(d) < 0.3 ? d * d / 2 - d ** 4 / 24 + d ** 6 / 720 - d ** 8 / 40320 : 1 - Math.cos(d));
  const q = xs.reduce((a, x) => a + oneMinusCos((((x - mean + 540) % 360 + 360) % 360 - 180) * Math.PI / 180), 0) / xs.length;
  return (Math.sqrt(-2 * Math.log1p(-q)) * 180) / Math.PI;
}

test('geo circularStats/circularMean 對獨立 oracle 差分(格點搜尋 + 級數)', () => {
  const r = mulberry32(SEED + 13);
  for (let n = 0; n < 1500; n += 1) {
    const len = 1 + Math.floor(r() * 12);
    const center = uni(r, -400, 800);
    const spread = pick(r, [0, 0.01, 0.5, 3, 20, 80, 179]);
    const xs = Array.from({ length: len }, () => center + uni(r, -spread, spread));
    if (r() < 0.2) xs.push(...xs.map((x) => x + 360 * Math.floor(uni(r, -3, 3))));
    const got = geo.circularStats(xs);
    assert.equal(got.n, xs.length);
    let s = 0;
    let c = 0;
    for (const x of xs) { s += Math.sin((x * Math.PI) / 180); c += Math.cos((x * Math.PI) / 180); }
    const R = Math.hypot(s, c) / xs.length;
    assert.ok(Math.abs(got.r - R) < 1e-12, `r ${got.r} vs ${R} for ${j(xs)}`);
    assert.ok(got.r >= 0 && got.r <= 1 + 1e-12);
    if (R < 1e-6) { assert.equal(got.mean, null); assert.equal(got.stdDeg, null); continue; }
    if (R < 0.05) continue;
    const m = oracleMean(xs);
    assert.ok(got.mean >= 0 && got.mean < 360, `mean 範圍 ${got.mean}`);
    assert.ok(circ(got.mean, m) < 1e-4, `mean ${got.mean} vs ${m} for ${j(xs)}`);
    const sd = oracleStd(xs, got.mean);
    assert.ok(Math.abs(got.stdDeg - sd) <= 1e-6 * Math.max(1, sd), `std ${got.stdDeg} vs ${sd} for ${j(xs)}`);
    assert.deepEqual(geo.circularMean(xs), { mean: got.mean, r: got.r, stdDeg: got.stdDeg });
  }
});

test('geo circularMean 屬性:[359,1] -> 0、旋轉/排列不變、n 相同讀數 σ=0、非法輸入', () => {
  assert.equal(geo.circularMean([359, 1]).mean, 0);
  assert.equal(geo.circularMean([359, 1]).mean, 0);
  assert.equal(geo.circularMean([350, 10]).mean, 0);
  assert.ok(circ(geo.circularMean([355, 5, 0]).mean, 0) < 1e-9);
  assert.equal(geo.circularMean([90, 270]).mean, null);
  assert.equal(geo.circularMean([0, 180]).mean, null);
  assert.equal(geo.circularMean([180]).mean, 180);
  const r = mulberry32(SEED + 14);
  for (let n = 0; n < 800; n += 1) {
    const len = 1 + Math.floor(r() * 10);
    const xs = Array.from({ length: len }, () => uni(r, 0, 25) + 170);
    const rot = uni(r, -300, 300);
    const a = geo.circularStats(xs);
    const b = geo.circularStats(xs.map((x) => x + rot));
    assert.ok(circ(b.mean, a.mean + rot) < 1e-8, `旋轉 ${j(xs)} ${rot}`);
    assert.ok(Math.abs(a.r - b.r) < 1e-12 && Math.abs(a.stdDeg - b.stdDeg) < 1e-6);
    const shuf = [...xs].sort(() => r() - 0.5);
    const c = geo.circularStats(shuf);
    assert.ok(circ(c.mean, a.mean) < 1e-9 && Math.abs(c.stdDeg - a.stdDeg) < 1e-9);
    deepFreeze(xs);
    assert.doesNotThrow(() => geo.circularStats(xs));
  }
  for (const v of [190, 0, 359.9999999, 1e-9]) assert.ok(geo.circularStats(Array(7).fill(v)).stdDeg < 1e-9, `相同讀數 ${v}`);
  for (const bad of [[], null, undefined, 5, 'abc', {}, { length: 2 }]) assert.throws(() => geo.circularStats(bad), /^Error: INVALID_READINGS/, j(bad));
  for (const bad of [[NaN], [1, Infinity], [1, '2'], [1, null], [1, undefined], [-Infinity]]) assert.throws(() => geo.circularStats(bad), /^Error: INVALID_BEARING/, j(bad));
});

test('geo circularStats 稀疏陣列(洞)不可默默算錯', () => {
  // 洞不是有限數字,應與 [1, undefined, 3] 同樣丟 INVALID_BEARING;不可略過洞卻把 n 算成 3。
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => geo.circularStats([1, , 3]), /^Error: INVALID_BEARING/);
});

test('geo measurementUncertainty = max(baseline, 2σ, accuracy);非法輸入', () => {
  const r = mulberry32(SEED + 15);
  for (let n = 0; n < 500; n += 1) {
    const baseline = r() < 0.2 ? undefined : uni(r, 0, 10);
    const sigmaDeg = pick(r, [null, undefined, uni(r, 0, 8)]);
    const accuracyDeg = pick(r, [null, undefined, uni(r, 0, 25)]);
    const want = Math.max(baseline ?? DEFAULT_SETTINGS.measureUncertainty, sigmaDeg == null ? -Infinity : 2 * sigmaDeg, accuracyDeg ?? -Infinity);
    assert.equal(geo.measurementUncertainty({ baseline, sigmaDeg, accuracyDeg }), want);
  }
  assert.equal(geo.measurementUncertainty(), 5);
  for (const bad of [{ baseline: -1 }, { baseline: NaN }, { sigmaDeg: -1 }, { sigmaDeg: NaN }, { accuracyDeg: Infinity }, { baseline: '5' }]) {
    assert.throws(() => geo.measurementUncertainty(bad), /^Error: INVALID_OPTION/, j(bad));
  }
});

// ─────────────────────────── geo: pickFacing ───────────────────────────

test('geo pickFacing 屬性:conflict 當且僅當兩兩夾角 > 45;結果取自候選;純函式', () => {
  const r = mulberry32(SEED + 16);
  const types = ['apartment', 'office', 'house', 'shop'];
  for (let n = 0; n < 4000; n += 1) {
    const input = { type: pick(r, types) };
    for (const k of ['door', 'light', 'building']) if (r() < 0.7) input[k] = genBearing(r) % 100000;
    if (input.door === undefined && input.light === undefined && input.building === undefined) input.door = uni(r, 0, 360);
    if (r() < 0.2) input.useBuildingFacade = true;
    if (r() < 0.2) input.storefront = true;
    if (r() < 0.3) input.floor = Math.floor(uni(r, 1, 30));
    const settings = { facingPolicy: pick(r, ['auto', 'door', 'light', 'building']), facadeFloorRule: r() < 0.3 };
    deepFreeze(input);
    const got = geo.pickFacing(input, settings);
    const bs = ['door', 'light', 'building'].filter((k) => input[k] !== undefined).map((k) => norm360(input[k]));
    let spread = 0;
    for (let a = 0; a < bs.length; a += 1) for (let b = a + 1; b < bs.length; b += 1) spread = Math.max(spread, circ(bs[a], bs[b]));
    if (Math.abs(spread - 45) > 1e-8) assert.equal(got.conflict, spread > 45, `conflict spread=${spread} ${j(input)}`);
    assert.ok(bs.some((x) => circ(x, got.facingBearing) < 1e-9), `結果必須是候選之一 ${j(input)} -> ${got.facingBearing}`);
    assert.ok(got.facingBearing >= 0 && got.facingBearing < 360);
    assert.equal(got.confidence, 'low');
    assert.equal(got.candidates.length, bs.length);
    assert.deepStrictEqual(got.meta.ruleset, { facingPolicy: settings.facingPolicy, facadeFloorRule: settings.facadeFloorRule });
    assertJsonSafe(got, 'pickFacing');
    assert.deepStrictEqual(geo.pickFacing(input, settings), got);
  }
});

test('geo pickFacing 規格 2.1.6 逐條:公寓採光面、透天差 <=45 用門、店面臨街門、無採光退回門', () => {
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180 }).facingBearing, 180);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180 }).basis, 'main_light_face');
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180 }).conflict, true);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90 }).basis, 'door_fallback');
  assert.ok(geo.pickFacing({ type: 'apartment', door: 90 }).warnings.includes('no_light_data'));
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180, building: 270 }).candidates.length, 3);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180, building: 270, useBuildingFacade: true }).facingBearing, 270);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180, building: 270, floor: 5 }, { facadeFloorRule: true }).facingBearing, 270);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180, building: 270, floor: 10 }, { facadeFloorRule: true }).facingBearing, 180);
  assert.equal(geo.pickFacing({ type: 'apartment', door: 90, light: 180, building: 270, floor: 5 }).facingBearing, 180, '樓層規則預設關');
  assert.equal(geo.pickFacing({ type: 'house', door: 100, light: 145 }).facingBearing, 100, '差 45 用門');
  assert.equal(geo.pickFacing({ type: 'house', door: 100, light: 145.01 }).facingBearing, 145.01);
  assert.equal(geo.pickFacing({ type: 'house', door: 100, light: 145.01 }).conflict, true);
  assert.equal(geo.pickFacing({ type: 'house', door: 350, light: 30 }).facingBearing, 350, '跨 0 圓周差 40');
  assert.equal(geo.pickFacing({ type: 'shop', door: 10, light: 200 }).basis, 'street_door');
  assert.equal(geo.pickFacing({ type: 'office', door: 10, light: 200, storefront: true }).basis, 'street_door');
  assert.equal(geo.pickFacing({ type: 'office', door: 10, light: 200 }).basis, 'main_light_face');
  assert.equal(geo.pickFacing({ type: 'apartment', door: 10, light: 20 }, { facingPolicy: 'door' }).facingBearing, 10);
  for (const bad of [null, undefined, 5, {}, { type: 'x', door: 1 }, { type: 'house' }, { type: 'house', door: NaN }, { type: 'house', light: Infinity }]) {
    assert.throws(() => geo.pickFacing(bad), /^Error: (INVALID_FACING_INPUT|INVALID_BEARING)/, j(bad));
  }
  assert.throws(() => geo.pickFacing({ type: 'house', door: 1 }, { facingPolicy: 'nope' }), /^Error: INVALID_OPTION/);
  assert.throws(() => geo.pickFacing({ type: 'house', door: 1 }, { nope: 1 }), /未知的設定鍵/);
});

// ─────────────────────────── geo: 效能 ───────────────────────────

test('geo 效能:單次呼叫 < 5ms(p99)', () => {
  const r = mulberry32(SEED + 17);
  const bs = Array.from({ length: 3000 }, () => genBearing(r));
  for (const [name, fn] of [
    ['analyzeBearing', (b) => geo.analyzeBearing(b, { uncertainty: 5 })],
    ['mountainAt', (b) => geo.mountainAt(b)],
    ['sitFromFacing', (b) => geo.sitFromFacing(b)],
    ['circularStats', (b) => geo.circularStats([b, b + 1, b - 1, b + 2])],
  ]) {
    const t = timeIt(fn, bs);
    assert.ok(t.p99 < 5, `${name} p99=${t.p99}ms mean=${t.mean}ms`);
  }
});

// ─────────────────────────── calendar oracle ───────────────────────────

const STEM = [...'甲乙丙丁戊己庚辛壬癸'];
const BRANCH = [...'子丑寅卯辰巳午未申酉戌亥'];
const TERM_ORACLE = ['小寒', '大寒', '立春', '雨水', '驚蟄', '春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至', '小暑', '大暑', '立秋', '處暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
const JIE_MONTH_BRANCH = ['丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子']; // 依 jie 序 小寒,立春,驚蟄,...,大雪
const CST = 8 * 3600e3;
const ms1800 = Date.UTC(1800, 0, 1);
const ms2151 = Date.UTC(2151, 0, 1);
const msIn = (r, y0, y1) => Date.UTC(y0, 0, 1) + r() * (Date.UTC(y1, 0, 1) - Date.UTC(y0, 0, 1));

/** Meeus 第 25 章低精度太陽視黃經(度),輸入 UT 的 ms。精度約 0.01 度,只用來抓粗錯。 */
function meeusSolarLongitude(ms) {
  const jd = ms / 86400000 + 2440587.5 + 69 / 86400; // 粗略把 ΔT 當 69 秒
  const T = (jd - 2451545) / 36525;
  const rad = Math.PI / 180;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * rad;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const om = (125.04 - 1934.136 * T) * rad;
  return norm360(L0 + C - 0.00569 - 0.00478 * Math.sin(om));
}

function ganzhiOracle(fy) {
  const idx = (((fy - 1984) % 60) + 60) % 60; // 1984 甲子
  return { index: idx, stem: idx % 10, branch: idx % 12, name: STEM[idx % 10] + BRANCH[idx % 12] };
}
function yunOracle(fy) {
  const c = (((fy - 1864) % 180) + 180) % 180;
  return { yun: Math.floor(c / 20) + 1, yunYear: (c % 20) + 1, era: c < 60 ? '上元' : c < 120 ? '中元' : '下元' };
}
/** 依 jie 瞬間掃描:找 ms 所在的月。年份範圍限 1802-2148。 */
function monthOracle(ms) {
  const cy = new Date(ms + CST).getUTCFullYear();
  const jies = [];
  for (let y = cy - 1; y <= cy + 1; y += 1) for (let i = 0; i < 24; i += 2) jies.push({ t: cal.termInstant(y, i), i, y });
  jies.sort((a, b) => a.t - b.t);
  let k = -1;
  for (let n = 0; n < jies.length; n += 1) if (jies[n].t <= ms) k = n;
  const cur = jies[k];
  const fy = fyOracle(ms);
  const branchName = JIE_MONTH_BRANCH[cur.i / 2];
  const branch = BRANCH.indexOf(branchName);
  const order = (branch - 2 + 12) % 12;
  const yStem = ganzhiOracle(fy).stem;
  const firstStem = { 0: 2, 5: 2, 1: 4, 6: 4, 2: 6, 7: 6, 3: 8, 8: 8, 4: 0, 9: 0 }[yStem]; // 甲己->丙 乙庚->戊 丙辛->庚 丁壬->壬 戊癸->甲
  const stem = (firstStem + order) % 10;
  return { jieName: TERM_ORACLE[cur.i], start: cur.t, end: jies[k + 1].t, branch, order, stem, name: STEM[stem] + branchName };
}
function fyOracle(ms) {
  const cy = new Date(ms + CST).getUTCFullYear();
  for (let y = cy + 1; y >= cy - 1; y -= 1) if (ms >= cal.termInstant(y, 2)) return y;
  throw new Error('fyOracle');
}

// ─────────────────────────── calendar: 節氣 ───────────────────────────

test('calendar 常數與錯誤輸入', () => {
  assert.deepEqual([...cal.TERM_NAMES], TERM_ORACLE);
  assert.equal(cal.STEMS.join(''), STEM.join(''));
  assert.equal(cal.BRANCHES.join(''), BRANCH.join(''));
  for (const y of [1.5, NaN, Infinity, '2020', null, undefined]) assert.throws(() => cal.termInstant(y, 2), /^Error: INVALID_YEAR/, String(y));
  for (const i of [-1, 24, 1.5, NaN, '2', null, undefined]) assert.throws(() => cal.termInstant(2020, i), /^Error: INVALID_TERM_INDEX/, String(i));
  for (const y of [1799, 2151, 3000, -5, 0]) assert.throws(() => cal.termInstant(y, 2), /^Error: YEAR_OUT_OF_RANGE/, String(y));
  for (const ms of [NaN, Infinity, -Infinity, '0', null, undefined, 8.64e15 + 1, {}]) {
    for (const fn of [cal.solarLongitude, cal.fengshuiYear, cal.monthOf, cal.lichunFlags, cal.yunOfInstant, cal.analyze, cal.formatCST]) {
      assert.throws(() => fn(ms), /^Error: INVALID_INSTANT/, `${fn.name}(${String(ms)})`);
    }
  }
  for (const y of [1.5, NaN, '2020', null, undefined]) {
    assert.throws(() => cal.yearGanzhi(y), /^Error: INVALID_YEAR/, String(y));
    assert.throws(() => cal.nineYun(y), /^Error: INVALID_YEAR/, String(y));
    assert.throws(() => cal.monthTable(y), /^Error: INVALID_YEAR/, String(y));
  }
});

test('calendar 節氣:黃經根性質(瞬間的視黃經 = 285+15i)、單調、間隔、曆月落點', () => {
  const r = mulberry32(SEED + 20);
  for (let n = 0; n < 600; n += 1) {
    const y = 1800 + Math.floor(r() * 351);
    const i = Math.floor(r() * 24);
    const t = cal.termInstant(y, i);
    const want = (285 + 15 * i) % 360;
    const lon = cal.solarLongitude(t);
    assert.ok(circ(lon, want) < 1e-6, `y=${y} i=${i} lon=${lon} want=${want}`);
    assert.equal(new Date(t).getUTCFullYear(), y, `節氣必須落在該 UTC 曆年內 y=${y} i=${i}`);
    assert.ok(Number.isInteger(t));
  }
  for (let y = 1800; y <= 2150; y += 1) {
    let prev = -Infinity;
    for (let i = 0; i < 24; i += 1) {
      const t = cal.termInstant(y, i);
      assert.ok(t > prev, `節氣不單調 y=${y} i=${i}`);
      if (prev > -Infinity) {
        const days = (t - prev) / 86400000;
        assert.ok(days > 13.8 && days < 16.6, `節氣間隔 ${days} 日 y=${y} i=${i}`);
      }
      prev = t;
    }
    const cst = new Date(cal.termInstant(y, 2) + CST);
    assert.equal(cst.getUTCMonth(), 1);
    assert.ok(cst.getUTCDate() >= 3 && cst.getUTCDate() <= 5, `立春日期 ${y}`);
  }
});

test('calendar 節氣對 Meeus 低精度公式:< 60 分鐘;solarLongitude 對 Meeus < 0.03 度', () => {
  const r = mulberry32(SEED + 21);
  for (let n = 0; n < 800; n += 1) {
    const y = 1800 + Math.floor(r() * 351);
    const i = Math.floor(r() * 24);
    const t = cal.termInstant(y, i);
    const lonM = meeusSolarLongitude(t);
    const err = ((((lonM - (285 + 15 * i)) % 360) + 540) % 360) - 180; // 度,約 0.01 度 ≈ 15 分
    assert.ok(Math.abs(err) < 0.03, `y=${y} i=${i} Meeus 偏差 ${err} 度`);
  }
  for (let n = 0; n < 800; n += 1) {
    const ms = msIn(r, 1800, 2150);
    assert.ok(circ(cal.solarLongitude(ms), meeusSolarLongitude(ms)) < 0.03, `solarLongitude ${ms}`);
  }
});

/** Meeus 第 27 章 春分/夏至/秋分/冬至(24 項週期項),精度約 1 分鐘;與 VSOP 實作完全不同的算法。回傳 UT 的 ms。 */
function meeusCardinal(year, k) {
  const Y = (year - 2000) / 1000;
  const mean = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
  ][k];
  const jde0 = mean[0] + mean[1] * Y + mean[2] * Y ** 2 + mean[3] * Y ** 3 + mean[4] * Y ** 4;
  const T = (jde0 - 2451545) / 36525;
  const W = (35999.373 * T - 2.47) * (Math.PI / 180);
  const dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  const terms = [[485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
    [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
    [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
    [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]];
  const S = terms.reduce((a, [A, B, C]) => a + A * Math.cos((B + C * T) * (Math.PI / 180)), 0);
  const jde = jde0 + (0.00001 * S) / dl;
  // ΔT(秒):以已知節點線性內插(1800:14 1850:7 1900:-3 1950:29 2000:64 2050:93 2100:203 2150:329),誤差 < 15 秒
  const knots = [[1800, 14], [1850, 7], [1900, -3], [1950, 29], [2000, 64], [2050, 93], [2100, 203], [2150, 329]];
  let dT = 329;
  for (let n = 0; n < knots.length - 1; n += 1) if (year >= knots[n][0] && year <= knots[n + 1][0]) dT = knots[n][1] + ((year - knots[n][0]) / 50) * (knots[n + 1][1] - knots[n][1]);
  return (jde - 2440587.5) * 86400000 - dT * 1000;
}

test('calendar 春分/夏至/秋分/冬至對 Meeus 第 27 章週期項算法(與 VSOP 無關)< 150 秒', () => {
  let worst = 0;
  for (let y = 1801; y <= 2149; y += 1) {
    for (const [k, i] of [[0, 5], [1, 11], [2, 17], [3, 23]]) {
      const d = Math.abs(cal.termInstant(y, i) - meeusCardinal(y, k)) / 1000;
      worst = Math.max(worst, d);
      assert.ok(d < 150, `${y} ${TERM_ORACLE[i]} 差 ${d} 秒`);
    }
  }
  assert.ok(worst < 150);
});

test('calendar 立春對 bazhai.json 201 年 Skyfield 表 <= 120 秒;對 annual.json 節氣案例在各案容差內', () => {
  const tab = loadFixture('bazhai').meta.lichun_cst_1900_2100;
  let worst = 0;
  for (const [y, s] of Object.entries(tab)) {
    const want = Date.parse(`${s.replace(' ', 'T')}+08:00`);
    const d = Math.abs(cal.lichun(Number(y)) - want) / 1000;
    worst = Math.max(worst, d);
    if (Number(y) <= 2150) assert.ok(d <= 120, `${y}: 差 ${d} 秒`);
  }
  assert.ok(worst > 0, '表非空');
  const fx = loadFixture('annual');
  let count = 0;
  for (const c of fx.cases.filter((x) => x.type === 'solar_term_time')) {
    const want = Date.parse(c.expected.utc);
    const tol = (c.toleranceMinutes ?? fx.meta.tolerances?.solar_term_minutes ?? 2) * 60000;
    const got = cal.termInstant(c.input.year, c.input.termIndex);
    assert.ok(Math.abs(got - want) <= tol, `${c.name}: 差 ${(got - want) / 60000} 分`);
    count += 1;
  }
  assert.equal(count, 49);
});

test('calendar 已知值:2026 立春 04:01:50 CST(顯示 04:02)、2024 立春 04-02 16:27、九運起點', () => {
  assert.equal(cal.formatCST(cal.lichun(2026)), '2026-02-04 04:02');
  assert.equal(cal.formatCST(cal.lichun(2026), true), '2026-02-04 04:01:50');
  assert.equal(cal.formatCST(cal.lichun(2024)), '2024-02-04 16:27');
  assert.equal(cal.formatCST(cal.lichun(2044)), '2044-02-04 12:44');
  // 1864 / 1884 交運日(複查建議 20:11、16:49,規格附錄 A XC-3)
  assert.ok(Math.abs(cal.lichun(1864) - Date.parse('1864-02-04T20:11:45+08:00')) <= 5000, cal.formatCST(cal.lichun(1864), true));
  assert.ok(Math.abs(cal.lichun(1884) - Date.parse('1884-02-04T16:49:12+08:00')) <= 5000, cal.formatCST(cal.lichun(1884), true));
});

test('calendar 效能:termInstant / fengshuiYear / monthOf / analyze 單次 < 5ms(p99)', () => {
  const r = mulberry32(SEED + 22);
  const inputs = Array.from({ length: 1500 }, () => msIn(r, 1802, 2148));
  for (const [name, fn] of [
    ['termInstant', (ms) => cal.termInstant(new Date(ms).getUTCFullYear(), Math.abs(Math.floor(ms / 1000)) % 24)],
    ['fengshuiYear', (ms) => cal.fengshuiYear(ms)],
    ['monthOf', (ms) => cal.monthOf(ms)],
    ['analyze', (ms) => cal.analyze(ms)],
    ['lichunFlags', (ms) => cal.lichunFlags(ms)],
  ]) {
    const t = timeIt(fn, inputs.map((x) => Math.floor(x)));
    assert.ok(t.p99 < 5, `${name} p99=${t.p99}ms mean=${t.mean}ms`);
  }
});

// ─────────────────────────── calendar: 年 ───────────────────────────

test('calendar fengshuiYear 對掃描式 oracle 差分,且恰在立春瞬間換年(前 1 ms / 當下 / 後 1 ms、前後 1 秒)', () => {
  const r = mulberry32(SEED + 23);
  for (let n = 0; n < 4000; n += 1) {
    const ms = Math.floor(msIn(r, 1802, 2148));
    assert.equal(cal.fengshuiYear(ms), fyOracle(ms), `fengshuiYear(${ms}) ${new Date(ms).toISOString()}`);
  }
  for (let y = 1802; y <= 2148; y += 1) {
    const lc = cal.lichun(y);
    for (const [dt, want] of [[-1, y - 1], [0, y], [1, y], [-1000, y - 1], [1000, y], [-60000, y - 1], [60000, y], [-86400000, y - 1]]) {
      assert.equal(cal.fengshuiYear(lc + dt), want, `y=${y} dt=${dt}`);
    }
    // 元旦、1 月屬上一風水年
    assert.equal(cal.fengshuiYear(Date.UTC(y, 0, 1)), y - 1);
    assert.equal(cal.fengshuiYear(Date.UTC(y, 0, 20)), y - 1);
    assert.equal(cal.fengshuiYear(Date.UTC(y, 11, 31, 23)), y);
  }
});

test('calendar fengshuiYear 各 yearBoundary 制式的 oracle', () => {
  const r = mulberry32(SEED + 24);
  const cstYear = (ms) => new Date(ms + CST).getUTCFullYear();
  const cstDay = (ms) => Math.floor((ms + CST) / 86400000);
  for (let n = 0; n < 3000; n += 1) {
    const ms = Math.floor(msIn(r, 1802, 2148));
    const y = cstYear(ms);
    assert.equal(cal.fengshuiYear(ms, { yearBoundary: 'gregorian_jan1' }), y);
    const feb4 = Math.floor(Date.UTC(y, 1, 4) / 86400000);
    assert.equal(cal.fengshuiYear(ms, { yearBoundary: 'fixed_feb4' }), cstDay(ms) >= feb4 ? y : y - 1, `fixed_feb4 ${ms}`);
    assert.equal(cal.fengshuiYear(ms, { yearBoundary: 'lichun_date_only' }), cstDay(ms) >= cstDay(cal.lichun(y)) ? y : y - 1, `date_only ${ms}`);
  }
  assert.throws(() => cal.fengshuiYear(0, { yearBoundary: 'lunar_new_year' }), /^Error: LUNAR_LIBRARY_REQUIRED/);
  assert.throws(() => cal.fengshuiYear(0, { yearBoundary: 'bogus' }), /^Error: INVALID_SETTING/);
  assert.throws(() => cal.fengshuiYear(0, { typo: 1 }), /^Error: INVALID_SETTING/);
  // 立春當天不論何時,date_only 都算新年;exact 則依瞬間
  for (const y of [2000, 2024, 2026, 1984]) {
    const lc = cal.lichun(y);
    const dayStart = Math.floor((lc + CST) / 86400000) * 86400000 - CST;
    assert.equal(cal.fengshuiYear(dayStart, { yearBoundary: 'lichun_date_only' }), y);
    assert.equal(cal.fengshuiYear(dayStart, { yearBoundary: 'lichun_exact' }), y - 1);
    assert.equal(cal.fengshuiYear(dayStart - 1, { yearBoundary: 'lichun_date_only' }), y - 1);
  }
});

test('calendar fengshuiYear 制式 fixed_feb4 / date_only 在公元 1-99 年不可錯用 1900+ 年份', () => {
  // Date.UTC(50,1,4) 會被當成 1950 年;規格沒限年份,ms 範圍內任何年都應一致。
  const ms = Date.UTC(1802, 5, 1) - 1802 * 365.2425 * 86400000 + 50 * 365.2425 * 86400000; // 約公元 50 年 6 月
  const y = new Date(ms + CST).getUTCFullYear();
  assert.ok(y >= 48 && y <= 52);
  assert.equal(cal.fengshuiYear(ms, { yearBoundary: 'fixed_feb4' }), y, `公元 ${y} 年 6 月應屬 ${y} 年`);
  assert.equal(cal.fengshuiYear(ms, { yearBoundary: 'gregorian_jan1' }), y);
});

test('calendar yearGanzhi 對 1984=甲子 oracle(含負年與大年份)', () => {
  const r = mulberry32(SEED + 25);
  const ys = [1984, 1985, 2024, 2026, 4, 3, 0, -1, -56, 1864, 2100, 9999, -9999];
  for (let n = 0; n < 3000; n += 1) ys.push(Math.floor(uni(r, -100000, 100000)));
  for (const fy of ys) {
    const g = cal.yearGanzhi(fy);
    assert.deepEqual(g, ganzhiOracle(fy), `fy=${fy}`);
    assert.ok(!Object.is(g.index, -0) && !Object.is(g.stem, -0) && !Object.is(g.branch, -0));
    assert.equal(cal.yearGanzhi(fy + 60).name, g.name);
  }
  assert.equal(cal.yearGanzhi(2026).name, '丙午');
  assert.equal(cal.yearGanzhi(2024).name, '甲辰');
  assert.equal(cal.yearGanzhi(1984).name, '甲子');
  // 陰陽同性:天干與地支奇偶必須相同(六十甲子的必要條件)
  for (let fy = 1900; fy < 1960; fy += 1) { const g = cal.yearGanzhi(fy); assert.equal(g.stem % 2, g.branch % 2); }
});

// ─────────────────────────── calendar: 月 ───────────────────────────

test('calendar monthOf 對掃描式 oracle 差分(月柱五虎遁、jie 名、start/end)', () => {
  const r = mulberry32(SEED + 26);
  for (let n = 0; n < 3000; n += 1) {
    const ms = Math.floor(msIn(r, 1802, 2148));
    const got = cal.monthOf(ms);
    const want = monthOracle(ms);
    assert.deepEqual({ jieName: got.jieName, start: got.start, end: got.end, branch: got.branch, order: got.order, stem: got.stem, name: got.name }, want, `monthOf(${ms}) ${new Date(ms).toISOString()}`);
    assert.ok(got.start <= ms && ms < got.end);
    assert.equal(got.approx, new Date(ms + CST).getUTCFullYear() < 1864);
    const days = (got.end - got.start) / 86400000;
    assert.ok(days > 28.5 && days < 32.5, `月長 ${days}`);
  }
});

test('calendar monthOf 在每個節氣瞬間的前 1 ms 與當下換月;月連續', () => {
  for (let y = 1802; y <= 2148; y += 1) {
    for (let i = 0; i < 24; i += 2) {
      const t = cal.termInstant(y, i);
      const before = cal.monthOf(t - 1);
      const at = cal.monthOf(t);
      assert.equal(at.start, t, `y=${y} i=${i}`);
      assert.equal(before.end, t);
      assert.equal(at.jieName, TERM_ORACLE[i]);
      assert.equal((before.order + 1) % 12, at.order, `月序連續 y=${y} i=${i}`);
    }
  }
  // 中氣不換月
  for (const y of [1900, 2000, 2026]) for (let i = 1; i < 24; i += 2) {
    const t = cal.termInstant(y, i);
    assert.equal(cal.monthOf(t - 1).start, cal.monthOf(t).start, `中氣 ${TERM_ORACLE[i]} 不應換月`);
  }
});

test('calendar monthTable:12 個月連續、首月起於立春、末月止於次年立春、五虎遁', () => {
  for (let fy = 1802; fy <= 2148; fy += 1) {
    const rows = cal.monthTable(fy);
    assert.equal(rows.length, 12);
    assert.equal(rows[0].start, cal.lichun(fy), `fy=${fy} 首月`);
    assert.equal(rows[11].end, cal.lichun(fy + 1), `fy=${fy} 末月`);
    rows.forEach((row, k) => {
      assert.equal(row.order, k);
      if (k > 0) assert.equal(row.start, rows[k - 1].end, `fy=${fy} 月 ${k} 不連續`);
      assert.ok(row.end > row.start);
      const mid = Math.floor((row.start + row.end) / 2);
      const mo = monthOracle(mid);
      assert.equal(row.name, mo.name, `fy=${fy} order=${k}`);
      assert.equal(row.jieName, mo.jieName);
      assert.equal(row.branch, mo.branch);
      assert.equal(row.stem, mo.stem);
    });
    assert.equal(rows[0].name, STEM[{ 0: 2, 5: 2, 1: 4, 6: 4, 2: 6, 7: 6, 3: 8, 8: 8, 4: 0, 9: 0 }[ganzhiOracle(fy).stem]] + '寅');
    assert.equal(rows[0].jieName, '立春');
    assert.equal(rows[11].jieName, '小寒');
  }
  assertJsonSafe(cal.monthTable(2026), 'monthTable');
});

test('calendar 附錄 B.2 補案:月柱五虎遁與 1 月屬上一風水年', () => {
  const at = (s) => cal.monthOf(cal.toInstant({ local: s, utcOffset: '+08:00' }));
  const cases = [
    ['2024-02-20T12:00', '丙寅'], ['2024-03-20T12:00', '丁卯'], ['2024-07-20T12:00', '辛未'], ['2025-01-20T12:00', '丁丑'],
    ['2027-02-20T12:00', '壬寅'], ['2027-07-20T12:00', '丁未'], ['2028-01-20T12:00', '癸丑'], ['2021-02-20T12:00', '庚寅'], ['2030-02-20T12:00', '戊寅'],
    ['2028-02-20T12:00', '甲寅'], ['2029-02-20T12:00', '丙寅'], ['2023-02-20T12:00', '甲寅'], ['2022-02-20T12:00', '壬寅'],
  ];
  for (const [s, name] of cases) assert.equal(at(s).name, name, s);
  assert.equal(cal.fengshuiYear(cal.toInstant({ local: '2025-01-20T12:00', utcOffset: '+08:00' })), 2024);
});

// ─────────────────────────── calendar: 九運 ───────────────────────────

test('calendar nineYun:20 年一運、180 年循環、era、對 oracle 差分', () => {
  const r = mulberry32(SEED + 27);
  const fys = [1864, 1883, 1884, 2023, 2024, 2043, 2044, 2045, 0, -1, -179, -180, 179, 180];
  for (let n = 0; n < 3000; n += 1) fys.push(Math.floor(uni(r, -20000, 20000)));
  for (const fy of fys) {
    const g = cal.nineYun(fy);
    assert.deepEqual(g, yunOracle(fy), `fy=${fy}`);
    assert.ok(g.yun >= 1 && g.yun <= 9 && g.yunYear >= 1 && g.yunYear <= 20);
    assert.deepEqual(cal.nineYun(fy + 180), g, '180 年循環');
    if (g.yunYear === 20) assert.equal(cal.nineYun(fy + 1).yun, g.yun === 9 ? 1 : g.yun + 1, `運末換運 fy=${fy}`);
    else assert.equal(cal.nineYun(fy + 1).yun, g.yun);
  }
  assert.deepEqual(cal.nineYun(2024), { yun: 9, yunYear: 1, era: '下元' });
  assert.deepEqual(cal.nineYun(2043), { yun: 9, yunYear: 20, era: '下元' });
  assert.deepEqual(cal.nineYun(2044), { yun: 1, yunYear: 1, era: '上元' });
  assert.deepEqual(cal.nineYun(2023), { yun: 8, yunYear: 20, era: '下元' });
  assert.deepEqual(cal.nineYun(1864), { yun: 1, yunYear: 1, era: '上元' });
  assert.deepEqual(cal.nineYun(2026), { yun: 9, yunYear: 3, era: '下元' });
  for (const s of [{ yunSystem: 'x' }, { nope: 1 }]) assert.throws(() => cal.nineYun(2000, s), /^Error: INVALID_SETTING/);
  // 二元八運只涵蓋 1996-2043(規格 2.4.4)
  assert.equal(cal.nineYun(1996, { yunSystem: 'er_yuan_8' }).yun, 8);
  assert.equal(cal.nineYun(2016, { yunSystem: 'er_yuan_8' }).yun, 8);
  assert.equal(cal.nineYun(2017, { yunSystem: 'er_yuan_8' }).yun, 9);
  assert.equal(cal.nineYun(2043, { yunSystem: 'er_yuan_8' }).yun, 9);
  for (const fy of [1995, 2044, 1900]) assert.throws(() => cal.nineYun(fy, { yunSystem: 'er_yuan_8' }), /^Error: YUN_SYSTEM_RANGE/);
});

test('calendar yunOfInstant:交運在立春瞬間,不受 yearBoundary 影響;2044-02-03 全日與 2044-02-04 上午仍屬九運', () => {
  const t = (s) => cal.toInstant({ local: s, utcOffset: '+08:00' });
  assert.equal(cal.yunOfInstant(t('2044-02-03T23:59')).yun, 9);
  assert.equal(cal.yunOfInstant(t('2044-02-04T09:00')).yun, 9);
  assert.equal(cal.yunOfInstant(t('2044-02-04T13:00')).yun, 1);
  const lc = cal.lichun(2044);
  assert.equal(cal.yunOfInstant(lc - 1).yun, 9);
  assert.equal(cal.yunOfInstant(lc).yun, 1);
  assert.equal(cal.yunOfInstant(cal.lichun(2024) - 1).yun, 8);
  assert.equal(cal.yunOfInstant(cal.lichun(2024)).yun, 9);
  assert.equal(cal.formatCST(cal.lichun(2024)), '2024-02-04 16:27');
  // 1984 立春 23:18,距跨日 41 分(規格 2.2.3 第 3 點)
  assert.equal(cal.formatCST(cal.lichun(1984)).slice(0, 10), '1984-02-04');
  const r = mulberry32(SEED + 28);
  for (let n = 0; n < 2000; n += 1) {
    const ms = Math.floor(msIn(r, 1802, 2148));
    const y = cal.yunOfInstant(ms);
    assert.equal(y.year, fyOracle(ms));
    assert.deepEqual({ yun: y.yun, yunYear: y.yunYear, era: y.era }, yunOracle(fyOracle(ms)));
    assert.equal(y.approx, new Date(ms + CST).getUTCFullYear() < 1864);
    assert.equal(y.boundary, 'lichun');
    const g = cal.yunOfInstant(ms, { boundary: 'gregorian_year' });
    assert.equal(g.year, new Date(ms + CST).getUTCFullYear());
  }
  assert.throws(() => cal.yunOfInstant(0, { boundary: 'x' }), /^Error: INVALID_SETTING/);
  assert.throws(() => cal.yunOfInstant(0, { yunSystem: 'x' }), /^Error: INVALID_SETTING/);
});

// ─────────────────────────── calendar: 格式與時區 ───────────────────────────

test('calendar formatCST:四捨五入到分(半數進位),與 Date 獨立比對,含 1970 前與公元前 1000 年', () => {
  const r = mulberry32(SEED + 29);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ref = (ms, step) => {
    const t = new Date(Math.floor(ms / step + 0.5) * step + CST);
    return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` + (step === 1000 ? `:${pad(t.getUTCSeconds())}` : '');
  };
  const inputs = [0, -1, 30000, -30000, 29999, -29999, 60000 * 5 + 30000, -60000 * 5 - 30000, 500, -500, 1500, -1500];
  for (let n = 0; n < 4000; n += 1) inputs.push(Math.floor(uni(r, -4e13, 8e12)), Math.floor(uni(r, -1, 1) * 1e5) * 30000);
  for (const ms of inputs) {
    assert.equal(cal.formatCST(ms), ref(ms, 60000), `formatCST(${ms})`);
    assert.equal(cal.formatCST(ms, true), ref(ms, 1000), `formatCST(${ms}, true)`);
    assert.match(cal.formatCST(ms), /^-?\d{4,}-\d{2}-\d{2} \d{2}:\d{2}$/);
  }
  assert.equal(cal.formatCST(Date.UTC(2026, 0, 1, 15, 59, 30)), '2026-01-02 00:00', '30 秒進位');
  assert.equal(cal.formatCST(Date.UTC(2026, 0, 1, 15, 59, 29, 999)), '2026-01-01 23:59');
  // 極端但 assertInstant 放行的 ms 不可輸出 NaN
  for (const ms of [8.64e15, -8.64e15, 8.64e15 - 1, 8.64e15 - CST]) {
    let s = null;
    try { s = cal.formatCST(ms); } catch (e) { assert.match(e.message, /^INVALID_INSTANT: /, `formatCST(${ms}) 錯誤碼`); }
    if (s !== null) assert.ok(!/NaN/.test(s), `formatCST(${ms}) 輸出 ${s}`);
  }
});

test('calendar toInstant:對 Date.parse ISO 獨立比對;不存在的日期、時間丟 INVALID_LOCAL_TIME', () => {
  const r = mulberry32(SEED + 30);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const offs = ['+08:00', '+09:00', '-05:00', '+00:00', 'Z', '+05:45', '-00:00', '+1400', '-1200'];
  for (let n = 0; n < 3000; n += 1) {
    const y = 1000 + Math.floor(r() * 1500);
    const mo = 1 + Math.floor(r() * 12);
    const d = 1 + Math.floor(r() * 28);
    const h = Math.floor(r() * 24);
    const mi = Math.floor(r() * 60);
    const off = pick(r, offs);
    const local = `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
    const isoOff = off === 'Z' ? 'Z' : off.length === 5 ? `${off.slice(0, 3)}:${off.slice(3)}` : off;
    const want = Date.parse(`${local}:00${isoOff}`);
    assert.equal(cal.toInstant({ local, utcOffset: off }), want, `${local} ${off}`);
    assert.equal(cal.toInstant({ local: `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:30`, utcOffset: off }), want + 30000, '空白分隔與秒');
    assert.equal(cal.toInstant({ local: `${pad(y, 4)}-${pad(mo)}-${pad(d)}`, utcOffset: off }), Date.parse(`${pad(y, 4)}-${pad(mo)}-${pad(d)}T12:00:00${isoOff}`), '純日期取正午');
  }
  const good = ['2000-02-29T00:00', '2400-02-29T00:00', '2024-02-29T23:59', '2023-12-31T23:59:59', '0050-06-01T00:00'];
  for (const s of good) assert.doesNotThrow(() => cal.toInstant({ local: s, utcOffset: '+08:00' }), s);
  const bad = ['1900-02-29T00:00', '2100-02-29T00:00', '2023-02-29T00:00', '2024-02-30T00:00', '2024-04-31T00:00', '2024-13-01T00:00', '2024-00-10T00:00', '2024-01-00T00:00',
    '2024-01-01T24:00', '2024-01-01T23:60', '2024-01-01T23:59:60', '2024-1-1T00:00', '2024-01-01T0:00', 'abc', '', '2024-01-01T00:00Z', '2024-01-01T00', ' 2024-01-01', '2024-01-01T00:00:00.5', null, undefined, 5, {}];
  for (const s of bad) {
    if (s === ' 2024-01-01') continue; // trim 後合法,不當作錯誤
    assert.throws(() => cal.toInstant({ local: s, utcOffset: '+08:00' }), /^Error: INVALID_LOCAL_TIME/, j(s));
  }
  for (const o of [undefined, null, '']) assert.throws(() => cal.toInstant({ local: '2024-01-01T00:00', utcOffset: o }), /^Error: MISSING_UTC_OFFSET/, j(o));
  for (const o of ['+8', '8:00', '+15:00', '+08:60', 'UTC', '+08:0', 8, 'z', '+0800x']) assert.throws(() => cal.toInstant({ local: '2024-01-01T00:00', utcOffset: o }), /^Error: INVALID_UTC_OFFSET/, j(o));
  for (const bad2 of [null, undefined, 5, 'x']) assert.throws(() => cal.toInstant(bad2), /^Error: INVALID_LOCAL_TIME/, j(bad2));
});

test('calendar utcOffsetFor:台灣 1938-1945 立春時段為 +09:00,其餘 1900-2050 為 +08:00(規格 2.2.3 第 4 點)', () => {
  for (let y = 1900; y <= 2050; y += 1) {
    const want = y >= 1938 && y <= 1945 ? '+09:00' : '+08:00';
    for (const day of ['02-04T12:00', '02-05T00:30']) assert.equal(cal.utcOffsetFor(`${y}-${day}`), want, `${y}-${day}`);
    assert.equal(cal.utcOffsetFor(`${y}-02-04`), want);
  }
  assert.equal(cal.utcOffsetFor('1940-02-05T08:00'), '+09:00');
  // 1940 附錄 B.1:08:00 +09:00 = 07:00 CST 早於立春 07:07 -> 1939;08:30 -> 1940
  assert.equal(cal.fengshuiYear(cal.toInstant({ local: '1940-02-05T08:00', utcOffset: '+09:00' })), 1939);
  assert.equal(cal.fengshuiYear(cal.toInstant({ local: '1940-02-05T08:30', utcOffset: '+09:00' })), 1940);
  assert.equal(cal.fengshuiYear(cal.toInstant({ local: '1940-02-05T08:00', utcOffset: '+08:00' })), 1940, '誤當 +08:00 會得 1940');
  assert.equal(cal.utcOffsetFor('2024-07-01T12:00', 'Asia/Tokyo'), '+09:00');
  assert.equal(cal.utcOffsetFor('2024-07-01T12:00', 'America/New_York'), '-04:00');
  assert.equal(cal.utcOffsetFor('2024-01-01T12:00', 'America/New_York'), '-05:00');
  assert.equal(cal.utcOffsetFor('2024-01-01T12:00', 'Asia/Kolkata'), '+05:30');
  for (const tz of ['Not/AZone', '', 'UTC+8']) assert.throws(() => cal.utcOffsetFor('2024-01-01T12:00', tz), /^Error: TIMEZONE_UNSUPPORTED/, tz);
  for (const s of ['x', '2024-02-30T00:00']) assert.throws(() => cal.utcOffsetFor(s), /^Error: INVALID_LOCAL_TIME/);
  // 偏移字串必須能被 toInstant 接受(往返)
  const r = mulberry32(SEED + 31);
  for (let n = 0; n < 300; n += 1) {
    const y = 1800 + Math.floor(r() * 300);
    const local = `${y}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}T12:00`;
    for (const tz of ['Asia/Taipei', 'Europe/London', 'America/Los_Angeles']) {
      const off = cal.utcOffsetFor(local, tz);
      assert.match(off, /^[+-]\d{2}:\d{2}$/);
      assert.doesNotThrow(() => cal.toInstant({ local, utcOffset: off }), `${local} ${tz} ${off}`);
    }
  }
});

// ─────────────────────────── calendar: 臨界旗標與 analyze ───────────────────────────

test('calendar lichunFlags:±2 分鐘門檻含端點;不知時刻時立春日給兩種結果', () => {
  for (let y = 1802; y <= 2148; y += 7) {
    const lc = cal.lichun(y);
    for (const [dt, want] of [[0, true], [120000, true], [-120000, true], [120001, false], [-120001, false], [60000, true], [-1, true], [3600000, false]]) {
      const f = cal.lichunFlags(lc + dt, true);
      assert.equal(f.nearLichun, want, `y=${y} dt=${dt}`);
      assert.equal(f.dateIsLichunDay, false, '時刻已知不設 dateIsLichunDay');
      assert.deepEqual(f.alternatives, []);
      assert.equal(f.lichun, lc);
      assert.ok(Math.abs(f.minutesFromLichun - dt / 60000) < 1e-9);
    }
    // 不知時刻:立春日的任何時刻都是 dateIsLichunDay
    const dayStart = Math.floor((lc + CST) / 86400000) * 86400000 - CST;
    for (const t of [dayStart, dayStart + 12 * 3600e3, dayStart + 86400000 - 1]) {
      const f = cal.lichunFlags(t, false);
      assert.equal(f.dateIsLichunDay, true, `y=${y} ${t - dayStart}`);
      assert.equal(f.nearLichun, false);
      assert.equal(f.minutesFromLichun, null);
      assert.deepEqual(f.alternatives.map((a) => [a.side, a.fengshuiYear, a.ganzhi]), [['beforeLichun', y - 1, cal.yearGanzhi(y - 1).name], ['afterLichun', y, cal.yearGanzhi(y).name]]);
    }
    for (const t of [dayStart - 1, dayStart + 86400000]) {
      const f = cal.lichunFlags(t, false);
      assert.equal(f.dateIsLichunDay, false);
      assert.deepEqual(f.alternatives, []);
    }
  }
  // 附錄 B.1:2000-02-04 不知時刻 -> 1999 / 2000
  const f = cal.lichunFlags(cal.toInstant({ local: '2000-02-04', utcOffset: '+08:00' }), false);
  assert.deepEqual(f.alternatives.map((a) => [a.fengshuiYear, a.ganzhi]), [[1999, '己卯'], [2000, '庚辰']]);
  // 每年只有 1 天:整年掃描時 dateIsLichunDay 的日數恰為 1
  let days = 0;
  for (let d = 0; d < 366; d += 1) if (cal.lichunFlags(Date.UTC(2026, 0, 1) + d * 86400000, false).dateIsLichunDay) days += 1;
  assert.equal(days, 1);
});

test('calendar analyze:規格 2.2.4 範例、與各函式一致、純度', () => {
  const ms = cal.toInstant({ local: '2026-09-29T12:00', utcOffset: '+08:00' });
  const a = cal.analyze(ms);
  assert.equal(a.fengshuiYear, 2026);
  assert.equal(a.yearGanzhi, '丙午');
  assert.equal(a.lichunCST, '2026-02-04 04:02');
  assert.deepEqual([a.month.jieName, a.month.name, a.month.order, a.month.startCST, a.month.endCST], ['白露', '丁酉', 7, '2026-09-07 22:41', '2026-10-08 14:30']);
  assert.deepEqual(a.yun, { yun: 9, yunYear: 3, era: '下元' });
  assert.equal(a.instantCST, '2026-09-29 12:00');
  assert.equal(a.approx, false);
  assert.deepEqual(a.meta.ruleset, { yearBoundary: 'lichun_exact', yunSystem: 'san_yuan_9' });
  const r = mulberry32(SEED + 32);
  const settingsList = [{}, { yearBoundary: 'lichun_date_only' }, { yearBoundary: 'fixed_feb4' }, { yearBoundary: 'gregorian_jan1' }, { yunSystem: 'er_yuan_8' }];
  for (let n = 0; n < 1000; n += 1) {
    const t = Math.floor(msIn(r, 1997, 2042));
    const s = deepFreeze({ ...pick(r, settingsList) });
    const an = cal.analyze(t, s);
    assert.equal(an.fengshuiYear, cal.fengshuiYear(t, s));
    assert.equal(an.yearGanzhi, cal.yearGanzhi(an.fengshuiYear).name);
    assert.equal(an.month.name, cal.monthOf(t).name);
    assert.equal(an.month.start, cal.monthOf(t).start);
    assert.deepEqual(an.yun, { yun: cal.yunOfInstant(t, s).yun, yunYear: cal.yunOfInstant(t, s).yunYear, era: cal.yunOfInstant(t, s).era });
    assert.equal(an.meta.warnings.includes('nearLichun'), cal.lichunFlags(t, true).nearLichun);
    assert.equal(an.lichun, cal.lichun(an.fengshuiYear), 'analyze.lichun 應是該風水年的立春');
    assertJsonSafe(an, 'analyze');
    assert.deepStrictEqual(cal.analyze(t, s), an);
  }
  // 各 yearBoundary 下 lichun 欄位的語意:fy 的立春
  for (const y of [2000, 2024]) {
    const lc = cal.lichun(y);
    assert.equal(cal.analyze(lc - 1).lichun, cal.lichun(y - 1), '立春前一刻屬上一風水年,lichun 欄為上一年立春');
    assert.equal(cal.analyze(lc).lichun, lc);
  }
});

// ─────────────────────────── calendar: 範圍外外推 ───────────────────────────

test('calendar 範圍外(1864 前、2150 後):approx=true、月與年連續、與立春一致', () => {
  const r = mulberry32(SEED + 33);
  const spans = [[1000, 1799], [1800, 1863], [2151, 2400], [2400, 6000]];
  for (const [y0, y1] of spans) {
    for (let n = 0; n < 500; n += 1) {
      const ms = Math.floor(msIn(r, y0, y1));
      const m = cal.monthOf(ms);
      const cy = new Date(ms + CST).getUTCFullYear();
      assert.equal(m.approx, cy < 1864 || cy > 2150, `approx ${cy}`);
      assert.ok(m.start <= ms && ms < m.end, `monthOf(${ms}) 不包含自己`);
      assert.equal(cal.monthOf(m.end).start, m.end, `月界不自洽 ${ms}`);
      assert.equal(cal.monthOf(m.end - 1).end, m.end);
      assert.equal(cal.monthOf(m.end - 1).start, m.start);
      const lf = cal.lichunFlags(ms);
      assert.equal(lf.approx, cy < 1864 || cy > 2150);
      const fy = cal.fengshuiYear(ms);
      assert.equal(fy, ms >= lf.lichun ? cy : cy - 1, `fy ${ms}`);
      assert.equal(cal.fengshuiYear(lf.lichun - 1), cy - 1);
      assert.equal(cal.fengshuiYear(lf.lichun), cy);
      const yo = cal.yunOfInstant(ms);
      assert.equal(yo.approx, cy < 1864 || cy > 2150);
      assert.deepEqual({ yun: yo.yun, yunYear: yo.yunYear, era: yo.era }, yunOracle(fy));
      const an = cal.analyze(ms);
      assert.ok(an.meta.warnings.includes('approxRange') === (cy < 1864 || cy > 2150));
    }
  }
  // 1800/2150 交界:逐日掃描年月單調不倒退
  for (const [ya, yb] of [[1798, 1802], [2148, 2154]]) {
    let prevFy = -Infinity;
    let prevStart = -Infinity;
    for (let t = Date.UTC(ya, 0, 1); t < Date.UTC(yb, 0, 1); t += 6 * 3600e3) {
      const fy = cal.fengshuiYear(t);
      assert.ok(fy >= prevFy, `風水年倒退 ${new Date(t).toISOString()}`);
      const m = cal.monthOf(t);
      assert.ok(m.start >= prevStart, `月倒退 ${new Date(t).toISOString()}`);
      prevFy = fy;
      prevStart = m.start;
    }
  }
  // 太遠的年份丟明確錯誤碼而不是回 NaN
  for (const ms of [8e15, -8e15, Date.UTC(10001, 0, 1), -62198755200000 * 2]) {
    let out;
    try { out = cal.fengshuiYear(ms); } catch (e) { assert.match(e.message, /^[A-Z_]+: /, `錯誤碼格式 ${ms}`); continue; }
    assert.ok(Number.isInteger(out), `fengshuiYear(${ms}) = ${out}`);
  }
});

test('calendar 純度:輸出可 JSON 往返、決定性、不改 settings(凍結)', () => {
  const r = mulberry32(SEED + 34);
  for (let n = 0; n < 500; n += 1) {
    const ms = Math.floor(msIn(r, 1802, 2148));
    assertJsonSafe(cal.monthOf(ms), 'monthOf');
    assertJsonSafe(cal.lichunFlags(ms, r() < 0.5), 'lichunFlags');
    assertJsonSafe(cal.yunOfInstant(ms), 'yunOfInstant');
    assertJsonSafe(cal.nineYun(cal.fengshuiYear(ms)), 'nineYun');
    assertJsonSafe(cal.yearGanzhi(cal.fengshuiYear(ms)), 'yearGanzhi');
    assert.deepStrictEqual(cal.monthOf(ms), cal.monthOf(ms));
    assert.equal(cal.termInstant(2000, 5), cal.termInstant(2000, 5));
    const s = deepFreeze({ yearBoundary: pick(r, ['lichun_exact', 'lichun_date_only', 'fixed_feb4', 'gregorian_jan1']) });
    assert.doesNotThrow(() => cal.fengshuiYear(ms, s));
  }
  assert.throws(() => { cal.TERM_NAMES[0] = 'x'; }, TypeError);
  assert.throws(() => { cal.STEMS.push('x'); }, TypeError);
  assert.throws(() => { cal.SUPPORTED_YEARS.min = 0; }, TypeError);
});

// ─────────────────────────── 補充:圓周差、查表、API 垃圾輸入 ───────────────────────────

test('geo circularDiff/circularDelta 對精確 oracle 差分(含極端大數、恰差 180)', () => {
  const r = mulberry32(SEED + 50);
  const pairs = [[1e308, -1e308], [-1e308, 1e308], [1e308, 1e308], [Number.MAX_VALUE, 5], [0, 180], [180, 0], [10, 190], [190, 10], [-0, 0], [359.9999995, 0], [0, 359.9999995]];
  for (let n = 0; n < 4000; n += 1) pairs.push([genBearing(r), genBearing(r)]);
  for (let n = 0; n < 500; n += 1) { const a = uni(r, -500, 500); pairs.push([a, a + 180], [a + 180, a], [a, a + 360 * Math.floor(uni(r, -5, 5))]); }
  for (const [a, b] of pairs) {
    const exactDelta = toDeg(pmod(scaled(a) - scaled(b) + 180n * S, M360) - 180n * S); // [-180,180)
    const tol = 1e-9 + 4 * Number.EPSILON * Math.max(Math.abs(a) % 360, Math.abs(b) % 360, 360);
    const d = geo.circularDelta(a, b);
    const dd = geo.circularDiff(a, b);
    assert.ok(Number.isFinite(d) && Number.isFinite(dd), `非有限 circular*(${a}, ${b}) -> ${d}, ${dd}`);
    assert.ok(d >= -180 && d < 180 + 1e-12, `delta 範圍 ${d}`);
    assert.ok(dd >= 0 && dd <= 180, `diff 範圍 ${dd}`);
    assert.ok(circ(d, exactDelta) <= tol, `circularDelta(${a}, ${b}) = ${d} vs ${exactDelta}`);
    assert.ok(Math.abs(dd - Math.abs(exactDelta)) <= tol || Math.abs(dd - 180) <= tol, `circularDiff(${a}, ${b}) = ${dd} vs ${Math.abs(exactDelta)}`);
    assert.ok(Math.abs(geo.circularDiff(b, a) - dd) <= tol, '對稱');
    assert.ok(!Object.is(dd, -0));
  }
  // 三角不等式
  for (let n = 0; n < 1000; n += 1) {
    const [a, b, c] = [uni(r, -400, 400), uni(r, -400, 400), uni(r, -400, 400)];
    assert.ok(geo.circularDiff(a, c) <= geo.circularDiff(a, b) + geo.circularDiff(b, c) + 1e-9);
  }
});

test('geo 查表函式與常數:洛書、方位、先天、五行、卦爻', () => {
  assert.deepEqual({ ...geo.LUOSHU }, { 坎: 1, 坤: 2, 震: 3, 巽: 4, 中: 5, 乾: 6, 兌: 7, 艮: 8, 離: 9 });
  const g = geo.LUOSHU_GRID_SOUTH_UP.map((row) => [...row]);
  const sums = [...g.map((r) => r.reduce((a, b) => a + b)), ...[0, 1, 2].map((c) => g[0][c] + g[1][c] + g[2][c]), g[0][0] + g[1][1] + g[2][2], g[0][2] + g[1][1] + g[2][0]];
  assert.deepEqual(sums, Array(8).fill(15));
  assert.equal(g[0][1], 9, '南上格:上中=離9');
  assert.equal(g[2][1], 1, '下中=坎1');
  for (let n = 1; n <= 9; n += 1) assert.equal(geo.LUOSHU[geo.guaOfLuoshu(n)], n);
  for (const bad of [0, 10, 1.5, NaN, '1', null, undefined, -1]) assert.throws(() => geo.guaOfLuoshu(bad), /^Error: INVALID_OPTION/, String(bad));
  GUA8.forEach((gg, k) => {
    assert.equal(geo.dirOfGua(gg), DIR_OF[gg]);
    assert.equal(geo.guaOfDir(DIR_OF[gg]), gg);
    assert.equal(geo.XIANTIAN_BEARING[gg] % 45, 0);
  });
  for (const bad of ['x', '', undefined, null, 'toString']) {
    assert.throws(() => geo.dirOfGua(bad), /^Error: UNKNOWN_GUA/);
    assert.throws(() => geo.guaOfDir(bad), /^Error: UNKNOWN_DIR/);
    assert.throws(() => geo.mountainIndex(bad), /^Error: UNKNOWN_MOUNTAIN/);
    assert.throws(() => geo.oppositeOf(bad), /^Error: UNKNOWN_MOUNTAIN/);
    assert.throws(() => geo.guaOfMountain(bad), /^Error: UNKNOWN_MOUNTAIN/);
  }
  // 先天卦位:乾南坤北離東坎西兌東南震東北巽西南艮西北
  assert.deepEqual({ ...geo.XIANTIAN_BEARING }, { 乾: 180, 坤: 0, 離: 90, 坎: 270, 兌: 135, 震: 45, 巽: 225, 艮: 315 });
  // 卦爻(初爻到上爻,1=陽)
  assert.deepEqual(Object.fromEntries(Object.entries(geo.GUA_LINES).map(([k, v]) => [k, v.join('')])), { 乾: '111', 兌: '110', 離: '101', 震: '100', 巽: '011', 坎: '010', 艮: '001', 坤: '000' });
  assert.deepEqual({ ...geo.GUA_WUXING }, { 坎: '水', 艮: '土', 震: '木', 巽: '木', 離: '火', 坤: '土', 兌: '金', 乾: '金' });
  for (const m of geo.MOUNTAINS) {
    assert.equal(geo.mountainIndex(m.name), m.index);
    assert.equal(geo.guaOfMountain(m.name), m.gua);
    assert.equal(geo.wuxingOfMountain(m.name), m.wuxing);
    assert.equal(geo.wuxingOfMountain(m.name, 'palace'), geo.GUA_WUXING[m.gua]);
  }
  assert.throws(() => geo.wuxingOfMountain('子', 'x'), /^Error: INVALID_OPTION/);
  // 規格範例 MountainInfo(175.0)
  assert.deepEqual(geo.mountainAt(175.0), { name: '午', index: 12, centerDeg: 180, startDeg: 172.5, endDeg: 187.5, gua: '離', dir8: '南', dragon: '天元', yinyang: '陰', opposite: '子', dev: -5 });
});

test('API 垃圾輸入:每個匯出函式只能丟「大寫碼: 訊息」的 Error 或回傳 JSON 安全且有限的值', () => {
  const junk = [undefined, null, NaN, Infinity, -0, 0, 1, -1, 360, '', 'a', '2020-01-01', {}, [], [1], [NaN], { type: 'house' }, true, false, () => 1, 1e308, -1e308, 8.64e15, Symbol.iterator, 10n,
    { local: '2020-01-01T00:00', utcOffset: '+08:00' }];
  const seen = [];
  for (const [modName, mod] of [['geo', geo], ['cal', cal]]) {
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function') continue;
      const combos = [];
      for (const a of junk) { combos.push([a]); for (const b of junk) combos.push([a, b]); }
      for (const args of combos) {
        let out;
        try {
          out = fn(...args);
        } catch (e) {
          if (e instanceof TypeError || e instanceof RangeError || !/^[A-Z][A-Z0-9_]+: |^未知的設定鍵/.test(String(e.message))) {
            seen.push(`${modName}.${name}(${args.map((x) => (typeof x === 'symbol' ? 'sym' : typeof x === 'function' ? 'fn' : typeof x === 'bigint' ? `${x}n` : JSON.stringify(x))).join(', ')}): ${e.constructor.name} ${String(e.message).slice(0, 60)}`);
          }
          continue;
        }
        const walk = (v, p) => {
          if (typeof v === 'number' && !Number.isFinite(v)) seen.push(`${modName}.${name} 回傳非有限數 ${p}`);
          else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
        };
        walk(out, '$');
      }
    }
  }
  assert.deepEqual([...new Set(seen)].slice(0, 20), []);
});

test('calendar lichunFlags 的旗標型別恆為布林;timeKnown 為假值時不設 nearLichun', () => {
  const lc = cal.lichun(2026);
  for (const tk of [true, false, 0, 1, null, undefined, '', 'x']) {
    const f = cal.lichunFlags(lc, tk);
    assert.equal(typeof f.nearLichun, 'boolean', `timeKnown=${String(tk)}`);
    assert.equal(typeof f.dateIsLichunDay, 'boolean');
    assert.equal(typeof f.approx, 'boolean');
  }
  assert.equal(cal.lichunFlags(lc, 0).nearLichun, false);
  assert.equal(cal.lichunFlags(lc, 0).dateIsLichunDay, true);
});

test('calendar formatCST 負年份不產生 "00-5" 這類錯位字串', () => {
  for (const y of [-1, -5, -99, -999, -1000, -9999, 0, 1, 99]) {
    const ms = new Date(0).setUTCFullYear(y, 5, 15);
    const s = cal.formatCST(ms);
    assert.match(s, /^-?\d{4,}-\d{2}-\d{2} \d{2}:\d{2}$/, `year ${y}: ${s}`);
  }
});

// ─────────────────────────── §4.2 第 3 點:突變測試 ───────────────────────────

test('突變測試:oracle 差分抓得出被改錯的實作與期望值(geo)', () => {
  const r = mulberry32(SEED + 40);
  const sample = [];
  for (let n = 0; n < 1500; n += 1) sample.push([genBearing(r), pick(r, ['earth', 'ren', 'tian'])]);
  for (let k = -40; k <= 40; k += 1) sample.push([7.5 * k, 'earth'], [15 * k, 'ren'], [15 * k, 'tian']);
  const total = (fn) => sample.reduce((a, [b, ring]) => a + (checkMountain(fn, b, ring).length > 0 ? 1 : 0), 0);
  const firstBad = sample.find(([b, ring]) => checkMountain(geo.mountainAt, b, ring).length > 0);
  assert.equal(total(geo.mountainAt), 0, `真實作應通過 ${firstBad && j(firstBad)} ${firstBad && checkMountain(geo.mountainAt, firstBad[0], firstBad[1])}`);
  assert.ok(total((b, ring) => geo.mountainAt(nextDown(b) - 1e-9, ring)) > 0, '界線歸屬被改成 (起,止] 應被抓到');
  assert.ok(total((b, ring) => geo.mountainAt(b + 0.5, ring)) > 0, '偏移 0.5 度應被抓到');
  assert.ok(total((b, ring) => { const m = geo.mountainAt(b, ring); return { ...m, yinyang: m.yinyang === '陰' ? '陽' : '陰' }; }) > 0, '陰陽對調應被抓到');
  assert.ok(total((b, ring) => { const m = geo.mountainAt(b, ring); return { ...m, dev: m.dev + 1e-6 }; }) > 0, 'dev 偏 1e-6 應被抓到');

  const asample = [];
  for (let n = 0; n < 1500; n += 1) asample.push([genBearing(r), genOpts(r)]);
  for (let i = 0; i < 24; i += 1) for (const sgn of [1, -1]) for (const adev of [4.5, 5, 6, 7]) asample.push([norm360(15 * i + sgn * adev), { threshold: 4.5, uncertainty: 3, kongwangLabelScheme: 'position', jianLimitSchool: 'default' }]);
  const atotal = (fn) => asample.reduce((a, [b, o]) => a + (checkAnalyze(fn, b, o).length > 0 ? 1 : 0), 0);
  const firstBadA = asample.find(([b, o]) => checkAnalyze(geo.analyzeBearing, b, o).length > 0);
  assert.equal(atotal(geo.analyzeBearing), 0, `真實作應通過 ${firstBadA && j(firstBadA)} ${firstBadA && checkAnalyze(geo.analyzeBearing, firstBadA[0], firstBadA[1])}`);
  assert.ok(atotal((b, o) => geo.analyzeBearing(b, { ...o, threshold: (o.threshold ?? 4.5) - 1e-7 })) > 0, '端點改成不含應被抓到');
  assert.ok(atotal((b, o) => ({ ...geo.analyzeBearing(b, o), needsTiGua: geo.analyzeBearing(b, o).zone === 'jian' })) > 0, 'needsTiGua 忘了排除同性相兼應被抓到');
  assert.ok(atotal((b, o) => ({ ...geo.analyzeBearing(b, o), kongwangKind: geo.analyzeBearing(b, o).kongwangKindDegree })) > 0, '空亡標籤方案混用應被抓到');
  assert.ok(atotal((b, o) => ({ ...geo.analyzeBearing(b, o), outer1p5: geo.analyzeBearing(b, o).level === 'void' })) > 0, 'outer1p5 與 level 合併應被抓到');
  assert.ok(atotal((b, o) => geo.analyzeBearing(b, { ...o, jianLimitSchool: o.jianLimitSchool === 'default' ? 'strict5' : 'default' })) > 0, '限度表錯用應被抓到');

  // 規格內嵌表被手打錯字的突變:把表某列改掉,表比對必須失敗
  const badTable = T24.map((row) => [...row]);
  badTable[13][3] = '陽';
  assert.throws(() => badTable.forEach(([name, gua, dragon, yy], i) => {
    const m = geo.MOUNTAINS[i];
    assert.deepEqual([m.name, m.gua, m.dragon, m.yinyang], [name, gua, dragon, yy]);
  }));
});

test('突變測試:oracle 差分抓得出被改錯的實作(calendar)', () => {
  const r = mulberry32(SEED + 41);
  const sample = [];
  for (let n = 0; n < 600; n += 1) sample.push(Math.floor(msIn(r, 1802, 2148)));
  for (let y = 1900; y <= 2100; y += 10) { const lc = cal.lichun(y); sample.push(lc - 1, lc, lc + 1, lc - 1000, lc + 1000); }
  const bad = (fn) => sample.reduce((a, ms) => a + (fn(ms) !== fyOracle(ms) ? 1 : 0), 0);
  assert.equal(bad((ms) => cal.fengshuiYear(ms)), 0);
  assert.ok(bad((ms) => cal.fengshuiYear(ms + 1000)) > 0, '晚 1 秒換年應被抓到');
  assert.ok(bad((ms) => cal.fengshuiYear(ms, { yearBoundary: 'gregorian_jan1' })) > 0, '元旦換年應被抓到');
  assert.ok(bad((ms) => cal.fengshuiYear(ms, { yearBoundary: 'fixed_feb4' })) > 0, '固定 2/4 應被抓到');
  const mbad = (fn) => sample.slice(0, 300).reduce((a, ms) => a + (fn(ms).name !== monthOracle(ms).name ? 1 : 0), 0);
  assert.equal(mbad((ms) => cal.monthOf(ms)), 0);
  assert.ok(mbad((ms) => cal.monthOf(ms + 86400000 * 3)) > 0, '月界偏 3 日應被抓到');
  assert.ok(mbad((ms) => { const m = cal.monthOf(ms); return { name: STEM[(m.stem + 1) % 10] + BRANCH[m.branch] }; }) > 0, '月干錯一位應被抓到');
  assert.ok([1984, 2024, 2026].some((fy) => cal.yearGanzhi(fy + 1).name !== ganzhiOracle(fy).name));
});

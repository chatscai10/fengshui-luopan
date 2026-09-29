// xuankong + annual 獨立審查: 確定性偽隨機(mulberry32)大量輸入 + 另寫的慢速 oracle 差分比對。
// oracle 全部依 DOMAIN_SPEC 的規則與內嵌表獨立重寫(2.4、2.5、3.3、3.4、4.4),不 import 實作內部的表;
// 曆法部分用 annual.json meta 內嵌的參考實作與 Meeus 低精度太陽黃經當第二意見。
// 屬於別的模組(geo、calendar)的已知缺陷用 { todo } 標記,不擋 CI,但保留重現。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from '../helpers/harness.js';
import * as X from '../../src/core/xuankong.js';
import * as A from '../../src/core/annual.js';
import * as C from '../../src/core/calendar.js';
import * as G from '../../src/core/geo.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

// ───────────────────────────── 基礎工具 ─────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const mod = (a, n) => ((a % n) + n) % n;
const w9 = (n) => mod(n - 1, 9) + 1;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** 輸出必須是純 JSON 資料: 有限數字、字串、布林、null、純物件、陣列;不得有 undefined/函式/Date/Map/Set/循環。 */
function assertPlainJson(x, path = '$', seen = new Set()) {
  if (x === null) return;
  const t = typeof x;
  if (t === 'number') { assert.ok(Number.isFinite(x), `${path} 不是有限數字: ${x}`); return; }
  if (t === 'string' || t === 'boolean') return;
  assert.ok(t === 'object', `${path} 型別不可序列化: ${t}`);
  assert.ok(!seen.has(x), `${path} 循環參照`);
  seen.add(x);
  if (Array.isArray(x)) { x.forEach((v, i) => assertPlainJson(v, `${path}[${i}]`, seen)); seen.delete(x); return; }
  const proto = Object.getPrototypeOf(x);
  assert.ok(proto === Object.prototype || proto === null, `${path} 不是純物件: ${x.constructor?.name}`);
  for (const [k, v] of Object.entries(x)) assertPlainJson(v, `${path}.${k}`, seen);
  seen.delete(x);
}

function findNegZero(x, path = '$') {
  if (Object.is(x, -0)) return path;
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      const r = findNegZero(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

/** 嘗試竄改回傳值(凍結的物件會丟錯,視為受保護)。回傳是否真的改到東西。 */
function tryMutate(x, depth = 0) {
  let changed = false;
  if (!x || typeof x !== 'object' || depth > 6) return false;
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (v && typeof v === 'object') { changed = tryMutate(v, depth + 1) || changed; continue; }
    try {
      if (typeof v === 'number') { x[k] = v + 12345; changed = true; }
      else if (typeof v === 'string') { x[k] = `${v}#`; changed = true; }
      else if (typeof v === 'boolean') { x[k] = !v; changed = true; }
    } catch { /* 凍結 */ }
  }
  return changed;
}

const FINDING_LEVELS = ['info', 'note', 'caution'];
const FINDING_CONF = ['high', 'medium', 'low'];
const FINDING_TAGS = ['source', 'inference', 'design', 'minority'];
function assertFindings(list, ctx) {
  const ids = new Set();
  for (const f of list) {
    assert.equal(typeof f.id, 'string', ctx);
    assert.ok(!ids.has(f.id), `${ctx}: Finding id 重複 ${f.id}`);
    ids.add(f.id);
    assert.ok(FINDING_LEVELS.includes(f.level), `${ctx}: level ${f.level}`);
    assert.ok(FINDING_CONF.includes(f.confidence), `${ctx}: confidence ${f.confidence} (${f.id})`);
    assert.ok(FINDING_TAGS.includes(f.tag), `${ctx}: tag ${f.tag} (${f.id})`);
    assert.ok(typeof f.title === 'string' && f.title.length > 0, `${ctx}: title (${f.id})`);
    assert.ok(typeof f.body === 'string' && f.body.length > 0, `${ctx}: body (${f.id})`);
    assert.ok(f.schoolNote === null || typeof f.schoolNote === 'string', `${ctx}: schoolNote (${f.id})`);
    assert.ok(Array.isArray(f.refs) && f.refs.every((r) => typeof r === 'string'), `${ctx}: refs (${f.id})`);
    for (const text of [f.title, f.body, f.schoolNote ?? '']) {
      assert.ok(!/undefined|NaN|\[object|null\b/.test(text), `${ctx}: Finding 文字含壞值 (${f.id}): ${text}`);
    }
  }
}

// ───────────────────────────── 規格內嵌資料(獨立抄自 DOMAIN_SPEC,不 import 實作) ─────────────────────────────

/** 2.4.1 RING: [名, 洛書宮, 元龍(0地 1天 2人)],自壬起順時針。 */
const SPEC_RING = [['壬', 1, 0], ['子', 1, 1], ['癸', 1, 2], ['丑', 8, 0], ['艮', 8, 1], ['寅', 8, 2], ['甲', 3, 0], ['卯', 3, 1], ['乙', 3, 2],
  ['辰', 4, 0], ['巽', 4, 1], ['巳', 4, 2], ['丙', 9, 0], ['午', 9, 1], ['丁', 9, 2], ['未', 2, 0], ['坤', 2, 1], ['申', 2, 2],
  ['庚', 7, 0], ['酉', 7, 1], ['辛', 7, 2], ['戌', 6, 0], ['乾', 6, 1], ['亥', 6, 2]];
const YANG = new Set('乾坤艮巽壬丙甲庚寅申巳亥'.split(''));
const SPEC_TI = {
  A: { 子: 1, 癸: 1, 甲: 1, 申: 1, 壬: 2, 卯: 2, 乙: 2, 未: 2, 坤: 2, 乾: 6, 亥: 6, 辰: 6, 巽: 6, 巳: 6, 戌: 6, 酉: 7, 辛: 7, 丑: 7, 艮: 7, 丙: 7, 寅: 9, 午: 9, 庚: 9, 丁: 9 },
  B: { 坤: 2, 壬: 2, 乙: 2, 艮: 7, 丙: 7, 辛: 7, 巽: 6, 辰: 6, 亥: 6, 甲: 1, 癸: 1, 申: 1, 丑: 9, 丁: 9, 酉: 9, 巳: 4, 戌: 4, 乾: 4, 子: 3, 卯: 3, 未: 3, 庚: 8, 午: 8, 寅: 8 },
};
const PAL_OF_LUO = { 1: '坎', 2: '坤', 3: '震', 4: '巽', 5: '中', 6: '乾', 7: '兌', 8: '艮', 9: '離' };
const LUO_OF_PAL = Object.fromEntries(Object.entries(PAL_OF_LUO).map(([n, p]) => [p, Number(n)]));
const FLY_ORDER = [5, 6, 7, 8, 9, 1, 2, 3, 4];
/** 2.4.9 星組合(自抄: key → [nature, exceptYun])。 */
const SPEC_PAIR = {
  '2-5': ['凶', [2, 5]], '3-7': ['凶'], '6-7': ['凶'], '7-9': ['凶'], '2-3': ['凶'], '2-7': ['凶'], '3-5': ['凶'], '5-7': ['凶'],
  '5-9': ['凶'], '1-5': ['凶'], '6-9': ['視旺衰'], '1-4': ['吉'], '1-6': ['視旺衰'], '3-9': ['吉'], '4-4': ['存疑'], '1-9': ['吉'],
  '6-8': ['吉'], '2-6': ['吉'], '7-8': ['吉'], '8-9': ['吉'],
};
/** 2.4.8 五氣三套標籤(下標 d)。 */
const SPEC_QI = {
  default: ['旺', '近旺生', '遠旺生', '死', '死', '煞衰', '煞衰', '煞衰', '退'],
  S1: ['旺', '進', '生', '死', '死', '死', '退', '退', '退'],
  S2: ['旺', '生', '進', '煞', '煞', '煞', '死', '衰', '退'],
};
const SPEC_QI_SCORE = [3, 2, 1, -2, -2, -1, -1, -1, 0];
/** 2.5.2 第 6、7 點三煞四組(自抄數字)。 */
const SPEC_SANSHA = [
  { name: '申子辰', branches: [8, 0, 4], dir: '南', jie: '巳', zai: '午', sui: '未', jia: ['丙', '丁'], core3: [142.5, 172.5, 202.5], withJia: [142.5, 217.5], branch12: [135, 225] },
  { name: '亥卯未', branches: [11, 3, 7], dir: '西', jie: '申', zai: '酉', sui: '戌', jia: ['庚', '辛'], core3: [232.5, 262.5, 292.5], withJia: [232.5, 307.5], branch12: [225, 315] },
  { name: '寅午戌', branches: [2, 6, 10], dir: '北', jie: '亥', zai: '子', sui: '丑', jia: ['壬', '癸'], core3: [322.5, 352.5, 22.5], withJia: [322.5, 37.5], branch12: [315, 45] },
  { name: '巳酉丑', branches: [5, 9, 1], dir: '東', jie: '寅', zai: '卯', sui: '辰', jia: ['甲', '乙'], core3: [52.5, 82.5, 112.5], withJia: [52.5, 127.5], branch12: [45, 135] },
];
const STEMS = '甲乙丙丁戊己庚辛壬癸'.split('');
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥'.split('');
const DIR_LUO = { 北: 1, 西南: 2, 東: 3, 東南: 4, 中宮: 5, 西北: 6, 西: 7, 東北: 8, 南: 9 };
const DIR_OF_PAL = { 坎: '北', 坤: '西南', 震: '東', 巽: '東南', 中: '中宮', 乾: '西北', 兌: '西', 艮: '東北', 離: '南' };

// ───────────────────────────── 玄空 oracle ─────────────────────────────

function oFly(center, forward) {
  const out = {};
  FLY_ORDER.forEach((n, i) => { out[n] = w9(forward ? center + i : center - i); });
  return out;
}

/** 入中資訊。順逆用 2.4.2 第 4 點的奇偶簡式,並與「查伴山」法互相驗證。 */
function oPlate(yun, mtn, ti, tiTable) {
  const Y = oFly(yun, true);
  const row = SPEC_RING.find((r) => r[0] === mtn);
  const [, luo, dragon] = row;
  const star = Y[luo];
  let forward;
  if (star === 5) forward = YANG.has(mtn);
  else forward = star % 2 === 1 ? dragon === 0 : dragon !== 0;
  const mate = star === 5 ? mtn : SPEC_RING.find((r) => r[1] === star && r[2] === dragon)[0];
  assert.equal(YANG.has(mate), forward, `oracle 內部不一致: yun=${yun} ${mtn}`);
  const enter = ti && star !== 5 ? SPEC_TI[tiTable][mate] : star;
  return { star, enter, mate, forward, pan: oFly(enter, forward) };
}

function oChart(yun, sit, { ti = false, tiTable = 'A' } = {}) {
  const i = SPEC_RING.findIndex((r) => r[0] === sit);
  const face = SPEC_RING[(i + 12) % 24][0];
  const Y = oFly(yun, true);
  const S = oPlate(yun, sit, ti, tiTable);
  const F = oPlate(yun, face, ti, tiTable);
  const palaces = {};
  for (let n = 1; n <= 9; n += 1) palaces[PAL_OF_LUO[n]] = { yun: Y[n], shan: S.pan[n], xiang: F.pan[n] };
  const pattern = !S.forward && !F.forward ? '旺山旺向' : S.forward && F.forward ? '上山下水' : !S.forward && F.forward ? '雙星會坐' : '雙星會向';
  const sitLuo = SPEC_RING[i][1];
  const faceLuo = SPEC_RING[(i + 12) % 24][1];
  return {
    yun, sit, face, sitPalace: PAL_OF_LUO[sitLuo], facePalace: PAL_OF_LUO[faceLuo], sitLuo, faceLuo,
    shan: { star: S.star, enter: S.enter, mate: S.mate, forward: S.forward },
    xiang: { star: F.star, enter: F.enter, mate: F.mate, forward: F.forward },
    palaces, pattern,
    wholePlate: {
      shan: S.star === 5 ? (S.forward ? '伏吟' : '反吟') : null,
      xiang: F.star === 5 ? (F.forward ? '伏吟' : '反吟') : null,
    },
  };
}

function assertChartMatches(chart, o, ctx) {
  assert.equal(chart.meta.sit, o.sit, `${ctx} sit`);
  assert.equal(chart.meta.face, o.face, `${ctx} face`);
  assert.equal(chart.sitPalace, o.sitPalace, `${ctx} sitPalace`);
  assert.equal(chart.facePalace, o.facePalace, `${ctx} facePalace`);
  assert.deepEqual(chart.shan, o.shan, `${ctx} shan info`);
  assert.deepEqual(chart.xiang, o.xiang, `${ctx} xiang info`);
  assert.deepEqual(chart.palaces, o.palaces, `${ctx} palaces`);
  assert.equal(chart.pattern, o.pattern, `${ctx} pattern`);
  assert.deepEqual(chart.wholePlate, o.wholePlate, `${ctx} wholePlate`);
}

/** 以星數條件判格局(2.4.5 表),與順逆位元法是兩條獨立路徑。 */
function oPatternByStars(o) {
  const N = o.yun;
  const S = o.palaces[o.sitPalace];
  const F = o.palaces[o.facePalace];
  if (S.shan === N && F.xiang === N) return '旺山旺向';
  if (F.shan === N && S.xiang === N) return '上山下水';
  if (S.shan === N && S.xiang === N) return '雙星會坐';
  if (F.shan === N && F.xiang === N) return '雙星會向';
  return '其它';
}

const qiD = (yun, star) => mod(star - yun, 9);
function oQiScore(yun, star, eightKeeps = false) {
  let s = SPEC_QI_SCORE[qiD(yun, star)];
  if (star === 5 && yun !== 5) s = Math.min(s, -3);
  if (star === 2 && yun !== 2) s = Math.min(s, 0.5);
  if (eightKeeps && star === 8 && s <= 0) s = 1;
  return s;
}
const pk = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
function oPairAdjust(a, b, curYun) {
  const e = SPEC_PAIR[pk(a, b)];
  if (!e) return 0;
  if (e[0] === '吉') return 0.5;
  if (e[0] === '凶') return e[1]?.includes(curYun) ? 0 : -1;
  return 0;
}

/** 財位/丁位分數(2.4.10),每宮回傳 {score, qualifies, side}。 */
function oPositions(chart, curYun, { wSide = 0.3, wYun = 0.3, eightKeeps = false } = {}) {
  const q = (s) => oQiScore(curYun, s, eightKeeps);
  const res = { wealth: [], ding: [] };
  for (const p of Object.keys(chart.palaces)) {
    const { shan: M, xiang: Xs, yun: Y } = chart.palaces[p];
    const adj = oPairAdjust(M, Xs, curYun) + oPairAdjust(M, Y, curYun) + oPairAdjust(Xs, Y, curYun);
    const side = p === chart.facePalace ? 'front' : p === chart.sitPalace ? 'back' : 'other';
    if (qiD(curYun, Xs) <= 2) res.wealth.push({ palace: p, score: q(Xs) + wSide * q(M) + wYun * q(Y) + adj, side, star: Xs });
    if (qiD(curYun, M) <= 2) res.ding.push({ palace: p, score: q(M) + wSide * q(Xs) + wYun * q(Y) + adj, side, star: M });
  }
  return res;
}

/** 定位 oracle: 自己寫的 24 山與 dev(半開區間、含端點下卦)。 */
function oNorm(b) {
  const r = b % 360;
  const n = r < 0 ? r + 360 : r;
  return n >= 360 ? 0 : n;
}
function oLocate(b, half = 4.5) {
  const nb = oNorm(b);
  const i = Math.floor((nb + 7.5) / 15) % 24; // 0=子
  let dev = nb - 15 * i;
  if (dev >= 180) dev -= 360;
  if (dev < -180) dev += 360;
  const ringIdx = (i + 1) % 24; // SPEC_RING 自壬起,子在 1
  const name = SPEC_RING[ringIdx][0];
  const j = dev > 0 ? (ringIdx + 1) % 24 : (ringIdx + 23) % 24;
  const zone = Math.abs(dev) <= half ? 'xia' : 'jian';
  const a = SPEC_RING[ringIdx];
  const nbr = SPEC_RING[j];
  const needTi = zone === 'jian' && (a[1] !== nbr[1] || a[2] === 0 || nbr[2] === 0);
  return { nb, dev, mountain: name, sit: SPEC_RING[(ringIdx + 12) % 24][0], zone, neighbor: zone === 'jian' ? nbr[0] : null, needTi };
}
const nearEdge = (dev, half) => Math.abs(Math.abs(dev) - half) < 1e-9 || Math.abs(Math.abs(dev) - 7.5) < 1e-9;

/** 各種怪異方位角。 */
function genBearing(rng) {
  const r = rng();
  if (r < 0.12) return 7.5 * ri(rng, -100, 100); // 山界與山中心,精確
  if (r < 0.22) return 7.5 * ri(rng, -60, 60) + pick(rng, [-7.5, -6, -4.5, -3.5, -3, 3, 3.5, 4.5, 6, 7.5]); // 下卦端點與外側帶,精確
  if (r < 0.30) return pick(rng, [0, -0, 360, -360, 720, -720, 1080.0625, -1e-13, 1e-13, 359.99999999999994, 1e6 * rng(), -1e6 * rng(), 1e12 * rng(), 7.499999999999999, 22.5 + 1e-12]);
  if (r < 0.36) return 7.5 * ri(rng, -50, 50) + pick(rng, [-1, 1]) * pick(rng, [1e-9, 1e-12, 1e-6, 0.5]);
  if (r < 0.60) return ri(rng, -720 * 64, 1080 * 64) / 64; // 精確的 1/64 度
  return -720 + rng() * 1800;
}

// ───────────────────────────── 曆法第二意見 ─────────────────────────────

const REF = (() => {
  const src = loadFixture('annual').meta.referenceImplementation.source;
  const m = { exports: {} };
  new Function('module', 'self', src)(m, undefined);
  return m.exports;
})();

/** Meeus《Astronomical Algorithms》第 25 章低精度太陽視黃經(約 0.01°)。 */
function meeusLongitude(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = ((357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI) / 180;
  const Cc = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const om = ((125.04 - 1934.136 * T) * Math.PI) / 180;
  return mod(L0 + Cc - 0.00569 - 0.00478 * Math.sin(om), 360);
}
const angDiff = (a, b) => Math.abs(mod(a - b + 180, 360) - 180);

const CST = 8 * 3600e3;
const utcMs = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s);

// ═════════════════════════════ 玄空 ═════════════════════════════

describe('fuzz: xuankong 排盤 oracle 差分', () => {
  test('648 盤(24 山 x 9 運 x {下卦, 替卦A, 替卦B}) 逐格對 oracle,並驗格局兩條路徑一致', () => {
    let n = 0;
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of SPEC_RING) {
        for (const [ti, tiTable] of [[false, 'A'], [true, 'A'], [true, 'B']]) {
          const o = oChart(yun, sit, { ti, tiTable });
          const c = X.buildChart(yun, sit, { ti, tiTable });
          assertChartMatches(c, o, `yun=${yun} sit=${sit} ti=${ti}/${tiTable}`);
          assert.equal(c.meta.ti, ti);
          assert.equal(c.meta.tiTable, ti ? tiTable : null);
          if (!ti) {
            assert.equal(oPatternByStars(o), o.pattern, `下卦盤格局兩路徑不一致 yun=${yun} sit=${sit}`);
            assert.equal(c.patternHolds, true, `下卦 patternHolds yun=${yun} sit=${sit}`);
          }
          n += 1;
        }
      }
    }
    assert.equal(n, 648);
  });

  test('規格 4.4 屬性: 三平面皆 1..9 排列、運盤中宮=入運、山/向星 N 在坐或向宮、對山同元龍同陰陽', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of SPEC_RING) {
        for (const opts of [{}, { ti: true, tiTable: 'A' }, { ti: true, tiTable: 'B' }]) {
          const c = X.buildChart(yun, sit, opts);
          for (const plane of ['yun', 'shan', 'xiang']) {
            const vals = Object.values(c.palaces).map((p) => p[plane]).sort((a, b) => a - b);
            assert.deepEqual(vals, [1, 2, 3, 4, 5, 6, 7, 8, 9], `${plane} 不是排列 yun=${yun} sit=${sit}`);
          }
          assert.equal(c.palaces['中'].yun, yun);
          if (!opts.ti) {
            const S = c.palaces[c.sitPalace];
            const F = c.palaces[c.facePalace];
            assert.ok((S.shan === yun) !== (F.shan === yun), `山星 N 應恰在坐宮或向宮之一 yun=${yun} sit=${sit}`);
            assert.ok((S.xiang === yun) !== (F.xiang === yun), `向星 N 應恰在坐宮或向宮之一 yun=${yun} sit=${sit}`);
          }
        }
      }
    }
    for (let i = 0; i < 24; i += 1) {
      const a = SPEC_RING[i];
      const b = SPEC_RING[(i + 12) % 24];
      assert.equal(a[2], b[2], `對山元龍 ${a[0]}`);
      assert.equal(YANG.has(a[0]), YANG.has(b[0]), `對山陰陽 ${a[0]}`);
      assert.equal(X.buildChart(9, a[0]).meta.face, b[0]);
    }
  });

  test('規格計數: 格局 48/48/60/60、九運 12/12、五運 12/12、含 5 入中 48(八運 6、五運 0)、替卦同下卦 56', () => {
    const cnt = { 旺山旺向: 0, 上山下水: 0, 雙星會坐: 0, 雙星會向: 0 };
    const byYun = {};
    let fiveIn = 0;
    let fiveIn8 = 0;
    let fiveIn5 = 0;
    let tiSame = 0;
    for (let yun = 1; yun <= 9; yun += 1) {
      byYun[yun] = { 旺山旺向: 0, 上山下水: 0, 雙星會坐: 0, 雙星會向: 0 };
      for (const [sit] of SPEC_RING) {
        const c = X.buildChart(yun, sit);
        cnt[c.pattern] += 1;
        byYun[yun][c.pattern] += 1;
        if (c.shan.star === 5 || c.xiang.star === 5) { fiveIn += 1; if (yun === 8) fiveIn8 += 1; if (yun === 5) fiveIn5 += 1; }
        const t = X.buildChart(yun, sit, { ti: true, tiTable: 'A' });
        if (JSON.stringify(t.palaces) === JSON.stringify(c.palaces)) tiSame += 1;
      }
    }
    assert.deepEqual(cnt, { 旺山旺向: 48, 上山下水: 48, 雙星會坐: 60, 雙星會向: 60 });
    assert.deepEqual(byYun[9], { 旺山旺向: 0, 上山下水: 0, 雙星會坐: 12, 雙星會向: 12 });
    assert.deepEqual(byYun[1], { 旺山旺向: 0, 上山下水: 0, 雙星會坐: 12, 雙星會向: 12 });
    assert.deepEqual(byYun[5], { 旺山旺向: 12, 上山下水: 12, 雙星會坐: 0, 雙星會向: 0 });
    assert.equal(fiveIn, 48);
    assert.equal(fiveIn8, 6);
    assert.equal(fiveIn5, 0);
    assert.equal(tiSame, 56, '替卦盤(A 表)與下卦盤相同者');
  });

  test('九運 24 山向名單(2.4.5): 雙星會向 12、雙星會坐 12,名單與規格逐項一致', () => {
    const list = X.listPatterns(9);
    const spec向 = ['壬丙', '丑未', '甲庚', '巽乾', '巳亥', '午子', '丁癸', '坤艮', '申寅', '酉卯', '辛乙', '戌辰'].map((s) => `${s[0]}山${s[1]}向`);
    const spec坐 = ['子午', '癸丁', '艮坤', '寅申', '卯酉', '乙辛', '辰戌', '丙壬', '未丑', '庚甲', '乾巽', '亥巳'].map((s) => `${s[0]}山${s[1]}向`);
    assert.deepEqual([...list['雙星會向']].sort(), [...spec向].sort());
    assert.deepEqual([...list['雙星會坐']].sort(), [...spec坐].sort());
    assert.deepEqual(list['旺山旺向'], []);
    assert.deepEqual(list['上山下水'], []);
  });

  test('5 入中兩種取法(山自身陰陽 vs 運盤中宮運星所在宮的同元龍山)216 盤差異 0;不是看運星奇偶', () => {
    let fives = 0;
    let parityDiffers = 0;
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of SPEC_RING) {
        const c = X.buildChart(yun, sit);
        for (const [key, name] of [['shan', c.meta.sit], ['xiang', c.meta.face]]) {
          if (c[key].star !== 5) continue;
          fives += 1;
          const row = SPEC_RING.find((r) => r[0] === name);
          const alt = SPEC_RING.find((r) => r[1] === yun && r[2] === row[2])[0];
          assert.equal(c[key].forward, YANG.has(alt), `yun=${yun} ${name}`);
          assert.equal(c[key].mate, name, '5 入中伴 = 山自身');
          if (c[key].forward !== (yun % 2 === 1)) parityDiffers += 1;
        }
      }
    }
    assert.equal(fives, 48 + 0, '5 入中的盤面數');
    assert.ok(parityDiffers > 0, '若「看運星奇偶」與正確規則永遠一致,這個測試就沒有區別力');
  });

  test('X.RING、TI_TABLES 與規格內嵌表逐項一致;A 表實際改數字的 13 山', () => {
    assert.deepEqual(X.RING.map((r) => [...r]), SPEC_RING);
    assert.deepEqual(JSON.parse(JSON.stringify(X.TI_TABLES)), SPEC_TI);
    const changed = SPEC_RING.filter(([name, luo]) => SPEC_TI.A[name] !== luo).map((r) => r[0]);
    assert.equal(changed.length, 13, `A 表改變數字的山: ${changed.join('')}`);
    assert.deepEqual([...changed].sort(), [...'甲申壬卯乙艮丑丙巽辰巳庚寅'].sort());
    for (const t of ['A', 'B']) assert.deepEqual(Object.keys(SPEC_TI[t]).sort(), SPEC_RING.map((r) => r[0]).sort());
  });

  test('第三意見: 獨立 oracle 對 xuankong_core.json 的 chart_xia 216 與 chart_ti 216(fixtures 唯讀),與規格內嵌範例', () => {
    const cases = loadFixture('xuankong_core').cases;
    let n = 0;
    for (const c of cases.filter((x) => x.type === 'chart_xia' || x.type === 'chart_ti')) {
      const ti = c.type === 'chart_ti';
      const o = oChart(c.input.yun, c.input.sit, { ti, tiTable: 'A' });
      for (const [luo, cell] of Object.entries(c.expected.cells)) {
        assert.deepEqual(o.palaces[PAL_OF_LUO[luo]], cell, `${c.name} 宮 ${luo}`);
      }
      if (c.expected.pattern !== undefined) assert.equal(o.pattern, c.expected.pattern, c.name);
      assert.equal(o.face, c.expected.face, c.name);
      n += 1;
    }
    assert.equal(n, 432);
    // 規格 2.4.2 輸出範例: 九運子山午向,下卦
    const ex = X.buildChart(9, '子');
    assert.deepEqual(ex.palaces, {
      巽: { yun: 8, shan: 6, xiang: 3 }, 離: { yun: 4, shan: 1, xiang: 8 }, 坤: { yun: 6, shan: 8, xiang: 1 }, 震: { yun: 7, shan: 7, xiang: 2 }, 中: { yun: 9, shan: 5, xiang: 4 },
      兌: { yun: 2, shan: 3, xiang: 6 }, 艮: { yun: 3, shan: 2, xiang: 7 }, 坎: { yun: 5, shan: 9, xiang: 9 }, 乾: { yun: 1, shan: 4, xiang: 5 },
    });
    assert.deepEqual(ex.shan, { star: 5, enter: 5, mate: '子', forward: false });
    assert.deepEqual(ex.xiang, { star: 4, enter: 4, mate: '巽', forward: true });
    assert.equal(ex.pattern, '雙星會坐');
    assert.deepEqual(ex.wholePlate, { shan: '反吟', xiang: null });
    assert.equal([ex.sitPalace, ex.facePalace].join(), '坎,離');
    // 2.4.7: 九運壬山丙向 = 雙星會向 + 山盤全局伏吟;一運壬山丙向是雙星會坐(五黃入中順飛不必是上山下水)
    const a = X.buildChart(9, '壬');
    assert.equal(a.pattern, '雙星會向'); assert.equal(a.wholePlate.shan, '伏吟');
    assert.equal(X.buildChart(1, '壬').pattern, '雙星會坐');
  });

  test('突變測試: 竄改實作或 oracle 的一格,差分比對必須抓得出來', () => {
    const c = JSON.parse(JSON.stringify(X.buildChart(8, '子')));
    const o = oChart(8, '子');
    assertChartMatches(c, o, 'baseline');
    const m1 = structuredClone(c); m1.palaces['坎'].shan = w9(m1.palaces['坎'].shan + 1);
    assert.throws(() => assertChartMatches(m1, o, 'm1'));
    const m2 = structuredClone(c); m2.pattern = '雙星會坐';
    assert.throws(() => assertChartMatches(m2, o, 'm2'));
    const m3 = structuredClone(c); m3.xiang.forward = !m3.xiang.forward;
    assert.throws(() => assertChartMatches(m3, o, 'm3'));
    // 竄改 oracle 的陰陽表(把「乾」改成陰)後,必有盤面與實作不同
    YANG.delete('乾');
    try {
      let differ = 0;
      for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of SPEC_RING) {
        try { assertChartMatches(X.buildChart(yun, sit), oChart(yun, sit), 'x'); } catch { differ += 1; }
      }
      assert.ok(differ > 0);
    } finally { YANG.add('乾'); }
    // 竄改替星表
    const saved = SPEC_TI.A['子'];
    SPEC_TI.A['子'] = 9;
    try {
      let differ = 0;
      for (let yun = 1; yun <= 9; yun += 1) try { assertChartMatches(X.buildChart(yun, '子', { ti: true }), oChart(yun, '子', { ti: true }), 'x'); } catch { differ += 1; }
      assert.ok(differ > 0);
    } finally { SPEC_TI.A['子'] = saved; }
  });
});

describe('fuzz: xuankong 由方位角到盤(analyzeXuankong 差分)', () => {
  test('15000 個隨機/邊界方位角: 山、坐山、下卦或兼向、需替卦、整張盤對 oracle', () => {
    const rng = mulberry32(20260929);
    let checked = 0;
    let skipped = 0;
    for (let n = 0; n < 15000; n += 1) {
      const b = genBearing(rng);
      const half = pick(rng, [4.5, 4.5, 3.5, 3]);
      const useTi = rng() < 0.5;
      const tiTable = pick(rng, ['A', 'B']);
      const chartYun = ri(rng, 1, 9);
      const currentYun = ri(rng, 1, 9);
      const o = oLocate(b, half);
      const exact = Number.isInteger(b * 64) && Math.abs(b) < 1e9; // 精確可表示的值不跳過,邊界歸屬要正確
      if (!exact && nearEdge(o.dev, half)) { skipped += 1; continue; }
      const r = X.analyzeXuankong({ facing: b, chartYun, currentYun }, { xiaGuaHalfWidth: half, useTiGua: useTi, tiTable });
      assert.equal(r.locate.mountain, o.mountain, `b=${b}`);
      assert.equal(r.locate.sit, o.sit, `b=${b}`);
      assert.equal(r.locate.zone, o.zone, `b=${b} dev=${o.dev}`);
      assert.equal(r.locate.needTi, o.needTi, `b=${b} dev=${o.dev}`);
      assert.equal(r.locate.neighbor, o.neighbor, `b=${b}`);
      assert.ok(r.locate.dev >= -7.5 && r.locate.dev < 7.5, `dev 範圍 b=${b}: ${r.locate.dev}`);
      assert.ok(Math.abs(r.locate.dev - o.dev) < 1e-6 || Math.abs(Math.abs(r.locate.dev - o.dev) - 360) < 1e-6, `dev b=${b}: ${r.locate.dev} vs ${o.dev}`);
      const ti = useTi && o.needTi;
      assertChartMatches(r.chart, oChart(chartYun, o.sit, { ti, tiTable }), `b=${b} ti=${ti}`);
      assert.equal(r.chart.meta.currentYun, currentYun);
      assert.equal(r.chart.meta.chartYun, chartYun);
      assert.equal(r.meta.warnings.includes('tiSuggested'), o.needTi && !useTi, 'tiSuggested 旗標');
      checked += 1;
    }
    assert.ok(checked > 12000, `checked=${checked} skipped=${skipped}`);
  });

  test('sit(facing(x)) = normalize(x+180),facingMountain 走山中心、{xuankong} 與純數字等價', () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 2000; n += 1) {
      const b = ri(rng, -1000 * 8, 1000 * 8) / 8;
      const a = X.analyzeXuankong({ facing: b, chartYun: 9, currentYun: 9 });
      const s = G.mountainAt(oNorm(b + 180));
      assert.equal(a.chart.meta.sit, s.name, `b=${b}`);
      const viaObj = X.analyzeXuankong({ facing: { xuankong: b, extra: 1 }, chartYun: 9, currentYun: 9 });
      assert.deepEqual(viaObj.chart, a.chart);
    }
    for (const [name] of SPEC_RING) {
      const a = X.analyzeXuankong({ facingMountain: name, chartYun: 7, currentYun: 9 });
      assert.equal(a.locate.zone, 'xia');
      assert.equal(a.chart.meta.face, name);
      assertChartMatches(a.chart, oChart(7, SPEC_RING[(SPEC_RING.findIndex((r) => r[0] === name) + 12) % 24][0]), name);
    }
  });

  test('D02/D34/2.4.3: 端點 |dev|=4.5 歸下卦並帶騎線旗標;外側 1.5°(|dev|>=6)標 outer', () => {
    for (let k = -20; k <= 20; k += 1) {
      for (const d of [-4.5, 4.5]) {
        const a = X.analyzeXuankong({ facing: 15 * k + d, chartYun: 9, currentYun: 9 });
        assert.equal(a.locate.zone, 'xia', `${15 * k + d}`);
        assert.equal(a.locate.onZoneEdge, true);
        assert.equal(a.locate.ridingLine, true);
        assert.ok(a.meta.warnings.includes('ridingLine'));
        assert.equal(a.locate.outer, false);
      }
      for (const d of [-6, 6, -7, 7, -7.25]) {
        const a = X.analyzeXuankong({ facing: 15 * k + d, chartYun: 9, currentYun: 9 });
        assert.equal(a.locate.zone, 'jian');
        assert.equal(a.locate.outer, true, `${15 * k + d}`);
      }
      for (const d of [-5, 5, -5.9, 5.9]) {
        assert.equal(X.analyzeXuankong({ facing: 15 * k + d, chartYun: 9, currentYun: 9 }).locate.outer, false);
      }
    }
  });

  test('非法輸入: 丟出以大寫底線碼開頭的 Error,不吞、不回傳半成品', () => {
    const ok = { facing: 180, chartYun: 9, currentYun: 9 };
    const bad = [
      [{ ...ok, facing: NaN }, 'INVALID_BEARING'], [{ ...ok, facing: Infinity }, 'INVALID_BEARING'], [{ ...ok, facing: -Infinity }, 'INVALID_BEARING'],
      [{ ...ok, facing: '180' }, 'INVALID_BEARING'], [{ ...ok, facing: null }, 'INVALID_BEARING'], [{ ...ok, facing: undefined }, 'MISSING_INPUT'],
      [{ ...ok, facing: {} }, 'MISSING_INPUT'], [{ ...ok, facing: { xuankong: NaN } }, 'INVALID_BEARING'],
      [{ ...ok, facing: undefined, facingMountain: '外' }, 'UNKNOWN_MOUNTAIN'], [{ ...ok, facingMountain: '子' }, 'INVALID_INPUT'],
      [{ ...ok, chartYun: 0 }, 'INVALID_YUN'], [{ ...ok, chartYun: 10 }, 'INVALID_YUN'], [{ ...ok, chartYun: 4.5 }, 'INVALID_YUN'],
      [{ ...ok, chartYun: '9' }, 'INVALID_YUN'], [{ ...ok, chartYun: NaN }, 'INVALID_YUN'], [{ ...ok, currentYun: -1 }, 'INVALID_YUN'],
      [{ facing: 1, currentYun: 9 }, 'MISSING_INPUT'], [{ facing: 1, chartYun: 9 }, 'MISSING_INPUT'],
      [{ facing: 1, builtAt: NaN, now: 0 }, 'INVALID_INSTANT'], [{ facing: 1, builtAt: 0, now: NaN }, 'INVALID_INSTANT'],
      [{ facing: 1, builtAt: null, now: 0 }, 'INVALID_INSTANT'], [{ facing: 1, builtAt: Infinity, now: 0 }, 'INVALID_INSTANT'],
      [{ ...ok, northMode: 'x' }, 'INVALID_OPTION'], [{ ...ok, declination: 'x' }, 'INVALID_OPTION'], [{ ...ok, declination: NaN }, 'INVALID_OPTION'],
    ];
    for (const [input, code] of bad) {
      assert.throws(() => X.analyzeXuankong(input), (e) => e instanceof Error && e.message.startsWith(`${code}:`), `${JSON.stringify(input)} 應丟 ${code}`);
    }
    assert.throws(() => X.analyzeXuankong(null), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.analyzeXuankong([]), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.analyzeXuankong(undefined), /^Error: MISSING_INPUT:/);
    for (const [ov, re] of [[{ foo: 1 }, /^Error: INVALID_OPTION:/], [{ qiScheme: 'Z' }, /^Error: INVALID_OPTION:/], [{ tiTable: 'Z' }, /^Error: INVALID_OPTION:/],
      [{ xiaGuaHalfWidth: 8 }, /^Error: INVALID_OPTION:/], [{ xiaGuaHalfWidth: 0 }, /^Error: INVALID_OPTION:/], [{ jianLimitSchool: 'x' }, /^Error: INVALID_OPTION:/],
      [{ yunBasis: 'x' }, /^Error: INVALID_OPTION:/], [{ renovation: 'x' }, /^Error: INVALID_OPTION:/], [{ wSide: NaN }, /^Error: INVALID_OPTION:/],
      [{ fuyinPenalty: 'a' }, /^Error: INVALID_OPTION:/], [{ fanyinPenalty: Infinity }, /^Error: INVALID_OPTION:/], [{ wYun: null }, /^Error: INVALID_OPTION:/]]) {
      assert.throws(() => X.analyzeXuankong(ok, ov), re, JSON.stringify(ov));
    }
    for (const fn of [() => X.buildChart(0, '子'), () => X.buildChart(9, 'constructor'), () => X.buildChart(9, '子', { ti: 'yes' }),
      () => X.buildChart(9, '子', { tiTable: 'constructor', ti: true }), () => X.buildChart(9, '子', { x: 1 }), () => X.buildChart(9, '子', null),
      () => X.fly(0, true), () => X.fly(5.5, true), () => X.direction(0, '子'), () => X.direction(5, '__proto__'), () => X.qiLabel(0, 1),
      () => X.qiLabel(9, 1, 'toString'), () => X.qiScore(9, 10), () => X.pairTag(0, 1), () => X.luoshuOf('constructor'), () => X.mountainInfo('toString'),
      () => X.palacesWithStar(X.buildChart(9, '子'), 'constructor', 1)]) {
      assert.throws(fn, (e) => e instanceof Error && /^[A-Z_]+: /.test(e.message), String(fn));
    }
  });

  test('overrides 傳 null 視同沒給(與 analyzeAnnual 一致),不可丟無碼的 TypeError', () => {
    const inp = { facing: 1, chartYun: 9, currentYun: 9 };
    assert.deepEqual(X.analyzeXuankong(inp, null), X.analyzeXuankong(inp, {}));
    assert.deepEqual(X.resolveYuns(inp, null), X.resolveYuns(inp, {}));
    assert.deepEqual(X.locateFacing(1, null), X.locateFacing(1, {}));
    assert.throws(() => X.locateFacing(1, { nope: 1 }), /^Error: INVALID_OPTION:/);
    assert.throws(() => X.resolveYuns(inp, { nope: 1 }), /^Error: INVALID_OPTION:/);
  });
});

describe('fuzz: 審查發現的缺陷迴歸(xuankong 與 annual 內部)', () => {
  const code = (re = /^Error: [A-Z_]+: /) => re;
  test('輔助函式對非法參數丟有碼的錯,不洩漏 TypeError(pairTagsOfPalace、palaceOfStar、qiDist、pairAdjust)', () => {
    const c = X.buildChart(9, '子');
    assert.throws(() => X.pairTagsOfPalace(c, '北'), /^Error: INVALID_PALACE:/);
    assert.throws(() => X.pairTagsOfPalace(c, undefined), /^Error: INVALID_PALACE:/);
    for (const bad of [0, 10, 1.5, NaN, '3', null, undefined]) assert.throws(() => X.palaceOfStar(bad), /^Error: INVALID_STAR:/, String(bad));
    assert.throws(() => X.qiDist(0, 1), /^Error: INVALID_YUN:/);
    assert.throws(() => X.qiDist(1, 'x'), /^Error: INVALID_STAR:/);
    assert.throws(() => X.pairAdjust(undefined, 9), /^Error: INVALID_INPUT:/);
    assert.throws(() => X.pairAdjust({}, 9), /^Error: INVALID_INPUT:/);
    assert.throws(() => X.pairAdjust(X.pairTag(1, 4), 0), /^Error: INVALID_YUN:/);
    assert.equal(X.pairAdjust(X.pairTag(1, 4), 9), 0.5);
    assert.equal(X.pairAdjust(X.pairTag(2, 5), 9), -1);
    assert.equal(X.pairAdjust(X.pairTag(2, 5), 5), 0, '二五在五運不扣');
    assert.equal(X.pairAdjust(X.pairTag(6, 9), 9), 0);
    for (let n = 1; n <= 9; n += 1) assert.equal(X.palaceOfStar(n), ['坎', '坤', '震', '巽', '中', '乾', '兌', '艮', '離'][n - 1]);
  });

  test('opts 傳 null 視同沒給(localYin、qiByPalace、qiScore、wealthDingPositions、roomAdvice)', () => {
    const c = X.buildChart(9, '子');
    assert.deepEqual(X.localYin(c, null), X.localYin(c));
    assert.deepEqual(X.qiByPalace(c, 9, null), X.qiByPalace(c, 9));
    assert.equal(X.qiScore(9, 8, null), X.qiScore(9, 8));
    assert.deepEqual(X.wealthDingPositions(c, 9, null), X.wealthDingPositions(c, 9));
    assert.deepEqual(X.roomAdvice(c, 9, null), X.roomAdvice(c, 9));
  });

  test('inArc 的錯誤訊息在 BigInt、循環物件、Symbol 參數下也不丟 TypeError', () => {
    const circ = []; circ.push(circ);
    const circObj = {}; circObj.self = circObj;
    for (const bad of [10n, circObj, Symbol('x'), Object.create(null)]) {
      assert.throws(() => A.inArc(10, bad), /^Error: INVALID_ARC:/);
    }
    assert.throws(() => A.inArc(10, circ), /^Error: (INVALID_ARC|INVALID_BEARING):/);
    for (const bad of [10n, Symbol('x'), Object.create(null)]) {
      assert.throws(() => A.fly(bad), /^Error: INVALID_STAR:/);
      assert.throws(() => A.annualCenter(bad), /^Error: INVALID_YEAR:/);
      assert.throws(() => A.sansha(bad), /^Error: INVALID_BRANCH:/);
      assert.throws(() => A.monthlyCenter(0, bad), /^Error: INVALID_MONTH_ORDER:/);
    }
    assert.ok(code().test('Error: X_Y: z'));
  });

  test('房間建議: 同一宮不會同時列入 prefer 與 avoid(以避開為準)', () => {
    // 九運巽宮 山5 向6 運9?: 五黃在山星,但向星六白(當令時旺)使衛生間規則兩邊都命中
    let hit = 0;
    for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of SPEC_RING) for (let cur = 1; cur <= 9; cur += 1) {
      for (const r of X.roomAdvice(X.buildChart(yun, sit), cur)) {
        assert.deepEqual(r.prefer.filter((p) => r.avoid.includes(p)), [], `${r.room} yun=${yun} ${sit} cur=${cur}`);
        hit += r.avoid.length;
      }
    }
    assert.ok(hit > 0);
  });
});

describe('fuzz: xuankong 元運與入運(resolveYuns、D11-D13)', () => {
  const oFy = (ms) => REF.fengshuiYear(ms);
  const oYun = (fy, sys = 'san_yuan_9') => {
    if (sys === 'er_yuan_8') { if (fy >= 1996 && fy <= 2016) return 8; if (fy >= 2017 && fy <= 2043) return 9; return null; }
    return Math.floor(mod(fy - 1864, 180) / 20) + 1;
  };

  test('隨機 builtAt/movedInAt/renovatedAt/now 對 oracle;各開關的選取', () => {
    const rng = mulberry32(99);
    const lo = utcMs(1900, 1, 1);
    const hi = utcMs(2099, 12, 31);
    const rnd = () => lo + Math.floor(rng() * (hi - lo));
    for (let n = 0; n < 4000; n += 1) {
      const builtAt = rnd();
      const movedInAt = rnd();
      const renovatedAt = rnd();
      const now = rnd();
      const yunBasis = pick(rng, ['built', 'moveIn']);
      const renovation = pick(rng, ['none', 'partial', 'full', 'anyRenovation']);
      const r = X.resolveYuns({ builtAt, movedInAt, renovatedAt, now }, { yunBasis, renovation });
      const full = renovation === 'full' || renovation === 'anyRenovation';
      const basisMs = full ? renovatedAt : yunBasis === 'moveIn' ? movedInAt : builtAt;
      assert.equal(r.chartYun, oYun(oFy(basisMs)), `chartYun n=${n}`);
      assert.equal(r.currentYun, oYun(oFy(now)), `currentYun n=${n}`);
      assert.equal(r.basis, full ? 'renovation' : yunBasis);
      assert.equal(r.basisInstant, basisMs);
      assert.equal(r.differs, r.chartYun !== r.currentYun);
      assert.equal(r.schoolNote !== null, r.basis === 'moveIn' || r.basis === 'renovation');
      if (!full) assert.ok(r.warnings.includes(renovation === 'partial' ? 'partialRenovationNotCounted' : 'renovationDateIgnored'));
    }
  });

  test('交運臨界: 立春前後 1 ms/1 s 換運;附近 3 分鐘內有 nearYunBoundary;2044-02-03 全日仍屬九運', () => {
    for (const y of [1924, 1944, 1964, 1984, 2004, 2024, 2044, 2064, 2084]) {
      const lc = C.lichun(y);
      const before = X.resolveYuns({ builtAt: lc - 1, now: lc });
      const at = X.resolveYuns({ builtAt: lc, now: lc });
      assert.equal(before.chartYun, oYun(y - 1), `${y} 前`);
      assert.equal(at.chartYun, oYun(y), `${y} 後`);
      assert.notEqual(before.chartYun, at.chartYun, `${y} 應交運`);
      assert.ok(before.warnings.includes('nearYunBoundary') && at.warnings.includes('nearYunBoundary'), `${y} 旗標`);
      assert.ok(!X.resolveYuns({ builtAt: lc + 4 * 60000, now: lc }).warnings.includes('nearYunBoundary'));
      assert.ok(!X.resolveYuns({ builtAt: lc - 4 * 60000, now: lc }).warnings.includes('nearYunBoundary'));
    }
    assert.equal(X.resolveYuns({ builtAt: utcMs(2044, 2, 3, 0) - CST, now: 0 }).chartYun, 9);
    assert.equal(X.resolveYuns({ builtAt: utcMs(2044, 2, 4, 4) - CST, now: 0 }).chartYun, 9);
    assert.equal(X.resolveYuns({ builtAt: utcMs(2044, 2, 4, 14) - CST, now: 0 }).chartYun, 1);
    assert.equal(X.resolveYuns({ builtAt: utcMs(2024, 2, 4, 16, 26) - CST, now: 0 }).chartYun, 8);
    assert.equal(X.resolveYuns({ builtAt: utcMs(2024, 2, 4, 16, 28) - CST, now: 0 }).chartYun, 9);
  });

  test('二元八運(D12): 1996-2016=八運、2017-2043=九運;範圍外丟 YUN_SYSTEM_RANGE,不靜默回傳', () => {
    for (let y = 1996; y <= 2043; y += 1) {
      const ms = utcMs(y, 7, 1);
      assert.equal(X.resolveYuns({ builtAt: ms, now: ms }, { yunSystem: 'er_yuan_8' }).chartYun, y <= 2016 ? 8 : 9, String(y));
    }
    for (const y of [1990, 1995, 2044, 2060]) {
      const ms = utcMs(y, 7, 1);
      assert.throws(() => X.resolveYuns({ builtAt: ms, now: utcMs(2026, 1, 1) }, { yunSystem: 'er_yuan_8' }), /^Error: YUN_SYSTEM_RANGE:/, String(y));
    }
    // 2017-2023 建成者: 三元九運為八運起盤前的運(2004-2023=八運);二元八運改為九運
    const ms = utcMs(2020, 6, 1);
    assert.equal(X.resolveYuns({ builtAt: ms, now: ms }).chartYun, 8);
    assert.equal(X.resolveYuns({ builtAt: ms, now: ms }, { yunSystem: 'er_yuan_8' }).chartYun, 9);
  });

  test('缺輸入、明確 chartYun/currentYun 優先、renovation 缺日期', () => {
    assert.throws(() => X.resolveYuns({ now: 0 }), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.resolveYuns({ builtAt: 0 }), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.resolveYuns({ builtAt: 0, now: 0 }, { yunBasis: 'moveIn' }), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.resolveYuns({ builtAt: 0, now: 0 }, { renovation: 'full' }), /^Error: MISSING_INPUT:/);
    assert.throws(() => X.resolveYuns(null), /^Error: MISSING_INPUT:/);
    const r = X.resolveYuns({ chartYun: 3, currentYun: 7, builtAt: utcMs(2000, 1, 1), now: utcMs(2026, 1, 1) });
    assert.equal(r.chartYun, 3);
    assert.equal(r.currentYun, 7);
    assert.equal(r.basis, 'explicit');
    assert.equal(r.basisInstant, null);
    assert.equal(r.differs, true);
  });
});

describe('fuzz: xuankong 旺衰、組合、財丁位、特殊格局 oracle', () => {
  test('五氣: 81 (yun,star) x 3 套標籤/分數(含上限)對規格,qiByPalace 一致', () => {
    for (const scheme of ['default', 'S1', 'S2']) {
      for (let yun = 1; yun <= 9; yun += 1) {
        for (let star = 1; star <= 9; star += 1) {
          assert.equal(X.qiLabel(yun, star, scheme), SPEC_QI[scheme][qiD(yun, star)], `${scheme} ${yun} ${star}`);
        }
      }
    }
    for (const keep of [false, true]) {
      for (let yun = 1; yun <= 9; yun += 1) for (let star = 1; star <= 9; star += 1) {
        assert.equal(X.qiScore(yun, star, { eightKeepsWealth: keep }), oQiScore(yun, star, keep), `score ${yun} ${star} keep=${keep}`);
      }
    }
    for (let yun = 1; yun <= 9; yun += 1) {
      assert.ok(X.qiScore(yun, 5) <= (yun === 5 ? 3 : -3), '5 黃上限');
      if (yun !== 2) assert.ok(X.qiScore(yun, 2) <= 0.5, '2 黑上限');
    }
    const c = X.buildChart(6, '午');
    const by = X.qiByPalace(c, 9, { qiScheme: 'S2' });
    for (const p of Object.keys(c.palaces)) for (const k of ['shan', 'xiang', 'yun']) {
      assert.equal(by[p][k].label, SPEC_QI.S2[qiD(9, c.palaces[p][k])]);
      assert.equal(by[p][k].star, c.palaces[p][k]);
    }
  });

  test('星組合: 81 個 (a,b) 有序組合查表 == 規格 20 項、nature/exceptYun 一致、順序無關', () => {
    let hits = 0;
    for (let a = 1; a <= 9; a += 1) for (let b = 1; b <= 9; b += 1) {
      const t = X.pairTag(a, b);
      const spec = SPEC_PAIR[pk(a, b)];
      if (!spec) { assert.equal(t, null, `${a}-${b}`); continue; }
      hits += 1;
      assert.equal(t.nature, spec[0], `${a}-${b}`);
      assert.equal(t.key, pk(a, b));
      assert.deepEqual(t.exceptYun ?? null, spec[1] ?? null);
      assert.deepEqual(X.pairTag(b, a), t);
    }
    assert.equal(hits, 19 * 2 + 1, '19 個 a≠b 的鍵各 2 個有序組合,加 4-4 一個');
    // 更正項: 一六、四四不是文昌;文昌只採一四與三九
    assert.equal(X.pairTag(1, 6).wenchang, false);
    assert.equal(X.pairTag(4, 4).wenchang, false);
    assert.deepEqual({ ...X.WENCHANG_KEYS }, { '1-4': 'high', '3-9': 'low' });
    // 回傳值是複本,竄改不影響下次
    const t = X.pairTag(2, 5);
    t.exceptYun.push(9); t.tag = 'x';
    assert.deepEqual(X.pairTag(2, 5).exceptYun, [2, 5]);
  });

  test('財位/丁位: 全部 216 盤 x 9 個 currentYun x 開關,候選集合、分數、排序、位置分流對 oracle', () => {
    const rng = mulberry32(5);
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of SPEC_RING) {
        const chart = X.buildChart(yun, sit);
        for (let cur = 1; cur <= 9; cur += 1) {
          const opt = { wSide: rng() < 0.5 ? 0.3 : rng(), wYun: rng() < 0.5 ? 0.3 : rng(), eightKeepsWealth: rng() < 0.3 };
          const got = X.wealthDingPositions(chart, cur, opt);
          const want = oPositions(chart, cur, { wSide: opt.wSide, wYun: opt.wYun, eightKeeps: opt.eightKeepsWealth });
          for (const kind of ['wealth', 'ding']) {
            const g = got[kind];
            const w = want[kind];
            assert.deepEqual(g.map((r) => r.palace).sort(), w.map((r) => r.palace).sort(), `${kind} 候選 yun=${yun} ${sit} cur=${cur}`);
            for (const r of g) {
              const e = w.find((x) => x.palace === r.palace);
              assert.ok(Math.abs(r.score - e.score) < 1e-9, `${kind} 分數 ${r.palace} yun=${yun} ${sit} cur=${cur}: ${r.score} vs ${e.score}`);
              assert.equal(r.side, e.side);
              assert.equal(r.star, e.star);
              assert.equal(r.tier, ['wang', 'jin', 'yuan'][qiD(cur, r.star)]);
              assert.equal(r.luoshu, LUO_OF_PAL[r.palace]);
              if (kind === 'wealth') {
                // D30: 向宮=旺財位;坐宮=back 不列旺財位;其他=次財位
                assert.equal(r.kind, e.side === 'front' ? 'wangcai' : e.side === 'back' ? 'back' : 'ciwei');
                assert.ok(Math.abs(r.adjustedScore - (e.side === 'back' ? e.score * 0.5 : e.score)) < 1e-9);
              } else {
                assert.equal(r.kind, e.side === 'back' ? 'wangding' : e.side === 'front' ? 'front' : 'ciwei');
              }
            }
            for (let i = 1; i < g.length; i += 1) assert.ok(g[i - 1].score >= g[i].score - 1e-12, `${kind} 排序`);
          }
        }
      }
    }
  });

  test('特殊格局 oracle: 全局合十/局部合十/父母三般/連數三般/七星打劫/城門/宮位伏吟反吟,含規格計數', () => {
    const cnt = { heshi: 0, parent3: 0, lianshu: 0, qixingLi: 0, qixingKan: 0, qixingUnusable: 0, qixingFanyin: 0 };
    const HETU = { 1: 6, 6: 1, 2: 7, 7: 2, 3: 8, 8: 3, 4: 9, 9: 4 };
    const RING8 = [1, 8, 3, 4, 9, 2, 7, 6]; // 八卦環(坎艮震巽離坤兌乾)的洛書數
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of SPEC_RING) {
        const c = X.buildChart(yun, sit);
        const P = c.palaces;
        const pals = Object.keys(P);
        const oHeshi = pals.every((p) => P[p].yun + P[p].shan === 10) ? '運山' : pals.every((p) => P[p].yun + P[p].xiang === 10) ? '運向' : null;
        assert.equal(X.heshi(c), oHeshi, `heshi ${yun}${sit}`);
        if (oHeshi) cnt.heshi += 1;
        const oLocal = pals.filter((p) => P[p].shan + P[p].xiang === 10 || P[p].shan + P[p].yun === 10 || P[p].xiang + P[p].yun === 10);
        assert.deepEqual([...X.heshiPalaces(c)].sort(), oLocal.sort());
        const oParent = pals.every((p) => P[p].shan % 3 === P[p].yun % 3 && P[p].xiang % 3 === P[p].yun % 3);
        assert.equal(X.parent3(c), oParent, `parent3 ${yun}${sit}`);
        if (oParent) { cnt.parent3 += 1; assert.equal(c.pattern, '上山下水', '父母三般全是上山下水'); }
        const oLian = pals.every((p) => {
          const s = [...new Set([P[p].yun, P[p].shan, P[p].xiang])].sort((a, b) => a - b);
          if (s.length !== 3) return false;
          return [1, 2, 3, 4, 5, 6, 7, 8, 9].some((a) => s.every((v) => [a, w9(a + 1), w9(a + 2)].includes(v)));
        });
        assert.equal(X.lianshu3(c), oLian, `lianshu ${yun}${sit}`);
        if (oLian) cnt.lianshu += 1;

        // 七星打劫
        const qx = X.qixing(c);
        let want = null;
        if (oPatternByStars(oChart(yun, sit)) === '雙星會向') {
          const faceLuo = LUO_OF_PAL[c.facePalace];
          for (const [kind, cluster] of [['離宮打劫', [9, 3, 6]], ['坎宮打劫', [1, 4, 7]]]) {
            if (!cluster.includes(faceLuo)) continue;
            if (cluster.every((n) => P[PAL_OF_LUO[n]].shan % 3 === yun % 3 && P[PAL_OF_LUO[n]].xiang % 3 === yun % 3)) want = kind;
          }
        }
        assert.equal(qx?.kind ?? null, want, `qixing ${yun}${sit}`);
        if (want) {
          cnt[want === '離宮打劫' ? 'qixingLi' : 'qixingKan'] += 1;
          if (!qx.usable) cnt.qixingUnusable += 1;
          if (qx.wholePlateFanyin) cnt.qixingFanyin += 1;
          assert.equal(qx.usable, c.wholePlate.shan !== '伏吟' && c.wholePlate.xiang !== '伏吟');
        }

        // 城門
        const cm = X.chengmen(c, ri(mulberry32(yun * 31 + sit.charCodeAt(0)), 1, 9));
        const faceLuo = LUO_OF_PAL[c.facePalace];
        const k = RING8.indexOf(faceLuo);
        const nbrs = [RING8[(k + 7) % 8], RING8[(k + 1) % 8]];
        const main = nbrs.find((n) => HETU[n] === faceLuo);
        const sub = nbrs.find((n) => n !== main);
        assert.equal(cm.main.luoshu, main, `城門正 ${yun}${sit}`);
        assert.equal(cm.sub.luoshu, sub, `城門副 ${yun}${sit}`);

        // 宮位伏吟反吟(不含中宮)
        const ly = X.localYin(c);
        const wantFu = [];
        const wantFan = [];
        for (const p of pals.filter((q) => q !== '中')) {
          for (const [plate, star] of [['山', P[p].shan], ['向', P[p].xiang]]) {
            if (star === LUO_OF_PAL[p]) wantFu.push(`${p}${plate}洛書本位`);
            if (star === P[p].yun) wantFu.push(`${p}${plate}運星`);
            if (star + LUO_OF_PAL[p] === 10) wantFan.push(`${p}${plate}合十`);
          }
        }
        assert.deepEqual(ly.fuyin.map((e) => `${e.palace}${e.plate}${e.basis}`).sort(), wantFu.sort(), `伏吟 ${yun}${sit}`);
        assert.deepEqual(ly.fanyin.map((e) => `${e.palace}${e.plate}${e.basis === '洛書本位合十' ? '合十' : e.basis}`).sort(), wantFan.sort(), `反吟 ${yun}${sit}`);
        const pen = X.localYin(c, { penalizedWhen: (s) => s % 2 === 0 });
        for (const e of [...pen.fuyin, ...pen.fanyin]) assert.equal(e.penalized, e.star % 2 === 0);
      }
    }
    assert.equal(cnt.heshi, 24, '全局合十 24 局');
    assert.equal(cnt.parent3, 16, '父母三般 16 局');
    assert.equal(cnt.lianshu, 16, '連數三般 16 局');
    assert.equal(cnt.qixingLi, 24, '離宮打劫 24');
    assert.equal(cnt.qixingKan, 24, '坎宮打劫 24');
    assert.equal(cnt.qixingUnusable, 6, '打劫犯全局伏吟 6 局');
    assert.equal(cnt.qixingFanyin, 6, '打劫犯全局反吟 6 局');
  });

  test('城門表 CHENGMEN == 規格內嵌;每個向宮的正副城門是相鄰兩宮', () => {
    const spec = { 9: [4, 2], 1: [6, 8], 3: [8, 4], 7: [2, 6], 6: [1, 7], 8: [3, 1], 4: [9, 3], 2: [7, 9] };
    for (const [k, v] of Object.entries(spec)) assert.deepEqual([...X.CHENGMEN[k]], v);
    assert.deepEqual(Object.keys(X.CHENGMEN).sort(), Object.keys(spec).sort());
  });

  test('全局伏吟反吟扣分(D29): 依盤面與 currentYun/chartYun 逐盤對 oracle,可調 penalty', () => {
    const rng = mulberry32(31337);
    for (let n = 0; n < 3000; n += 1) {
      const chartYun = ri(rng, 1, 9);
      const [sit] = pick(rng, SPEC_RING);
      const mount = SPEC_RING.find((r) => r[0] === sit)[0];
      const currentYun = ri(rng, 1, 9);
      const fu = ri(rng, -6, 0);
      const fan = ri(rng, -4, 0);
      const r = X.analyzeXuankong({ facingMountain: SPEC_RING[(SPEC_RING.findIndex((q) => q[0] === mount) + 12) % 24][0], chartYun, currentYun },
        { fuyinPenalty: fu, fanyinPenalty: fan });
      const o = oChart(chartYun, mount);
      const pens = [];
      for (const [key, plate] of [['shan', '山'], ['xiang', '向']]) {
        const kind = o.wholePlate[key];
        if (kind === '伏吟') pens.push({ plate, kind, points: fu, waived: false });
        if (kind === '反吟') { const waived = o.pattern === '旺山旺向' && currentYun === chartYun; pens.push({ plate, kind, points: waived ? 0 : fan, waived }); }
      }
      assert.deepEqual(r.wholePlate.penalties, pens, `n=${n}`);
      assert.equal(r.wholePlate.penaltyTotal, pens.reduce((s, p) => s + p.points, 0));
      const ids = r.findings.filter((f) => f.id.startsWith('xk.wholeplate.')).map((f) => f.id).sort();
      assert.deepEqual(ids, pens.map((p) => `xk.wholeplate.${p.kind === '伏吟' ? 'fuyin' : 'fanyin'}.${p.plate === '山' ? 'shan' : 'xiang'}`).sort());
      for (const f of r.findings.filter((x) => x.id.includes('wholeplate.fuyin'))) assert.equal(f.level, 'caution');
    }
  });

  test('房間建議: 宮位都是外圍八宮、無重複、prefer/avoid 不互相矛盾(同一宮不可同時被推薦與避開)', () => {
    const overlaps = new Set();
    for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of SPEC_RING) for (let cur = 1; cur <= 9; cur += 1) {
      const chart = X.buildChart(yun, sit);
      const rooms = X.roomAdvice(chart, cur);
      assert.deepEqual(rooms.map((r) => r.room), ['bedroom', 'living', 'kitchen', 'bathroom', 'study', 'desk']);
      for (const r of rooms) {
        for (const list of [r.prefer, r.avoid]) {
          assert.equal(new Set(list).size, list.length, `${r.room} 重複宮位`);
          assert.ok(list.every((p) => p !== '中' && p in chart.palaces), `${r.room} 含中宮或非法宮`);
        }
        if (r.prefer.some((p) => r.avoid.includes(p))) overlaps.add(`${r.room}`);
      }
    }
    assert.deepEqual([...overlaps], [], `這些房間的 prefer 與 avoid 在同一宮同時出現: ${[...overlaps].join(',')}`);
  });
});

describe('fuzz: xuankong 輸出品質(JSON、不改輸入、決定性、Finding 一致性、meta)', () => {
  function randomInput(rng) {
    const r = rng();
    const facing = r < 0.15 ? { xuankong: genBearing(rng) } : genBearing(rng);
    const input = { facing };
    if (rng() < 0.5) { input.chartYun = ri(rng, 1, 9); input.currentYun = ri(rng, 1, 9); } else {
      input.builtAt = utcMs(1900, 1, 1) + Math.floor(rng() * 200 * 365.25 * 86400000);
      input.now = utcMs(1900, 1, 1) + Math.floor(rng() * 200 * 365.25 * 86400000);
    }
    if (rng() < 0.3) { input.northMode = pick(rng, ['magnetic', 'true']); input.declination = ri(rng, -100, 100) / 10; input.declinationDate = '2026-09-29'; }
    const settings = {};
    if (rng() < 0.5) settings.useTiGua = rng() < 0.7;
    if (rng() < 0.3) settings.tiTable = pick(rng, ['A', 'B']);
    if (rng() < 0.3) settings.qiScheme = pick(rng, ['default', 'S1', 'S2']);
    if (rng() < 0.3) settings.eightKeepsWealth = rng() < 0.5;
    if (rng() < 0.3) settings.showLianshu = rng() < 0.5;
    if (rng() < 0.3) settings.showChengmen = rng() < 0.5;
    if (rng() < 0.3) settings.xiaGuaHalfWidth = pick(rng, [4.5, 3.5, 3]);
    if (rng() < 0.2) settings.jianLimitSchool = pick(rng, ['default', 'strict5', 'zggdfs6']);
    if (rng() < 0.2) settings.kongwangLabelScheme = pick(rng, ['position', 'degree']);
    if (rng() < 0.2) settings.wSide = rng();
    if (rng() < 0.2) settings.wYun = rng();
    if (rng() < 0.2) { settings.fuyinPenalty = ri(rng, -6, 0); settings.fanyinPenalty = ri(rng, -4, 0); }
    if (rng() < 0.2) settings.yunBasis = 'built';
    return { input, settings };
  }

  test('5000 次隨機分析: 純 JSON、輸入(已凍結)不被改、同輸入同輸出、Finding 形狀與內部一致', () => {
    const rng = mulberry32(424242);
    let negZero = 0;
    for (let n = 0; n < 5000; n += 1) {
      const { input, settings } = randomInput(rng);
      const inClone = structuredClone(input);
      const setClone = structuredClone(settings);
      deepFreeze(input); deepFreeze(settings);
      const r1 = X.analyzeXuankong(input, settings);
      const r2 = X.analyzeXuankong(input, settings);
      assert.deepEqual(input, inClone); assert.deepEqual(settings, setClone);
      assert.deepEqual(r1, r2, '同輸入應同輸出');
      assertPlainJson(r1);
      if (findNegZero(r1)) negZero += 1;
      if (n % 5 === 0) assertFindings(r1.findings, `n=${n}`);
      // meta
      assert.equal(r1.meta.schema, 'fengshui.xuankong/1');
      const s = { ...DEFAULT_SETTINGS, ...settings };
      for (const [k, v] of Object.entries(r1.meta.ruleset)) assert.equal(v, s[k], `ruleset.${k}`);
      assert.equal(r1.meta.chartYun, r1.chart.meta.chartYun);
      assert.equal(r1.meta.currentYun, r1.chart.meta.currentYun);
      assert.equal(r1.meta.northMode, input.northMode ?? s.northMode);
      assert.equal(r1.meta.declination, input.declination ?? null);
      assert.equal(r1.meta.warnings.includes('chartYunDiffersFromCurrent'), r1.meta.chartYun !== r1.meta.currentYun);
      assert.equal(r1.meta.computedAtCST === null, input.now === undefined);
      // Finding 與資料一致
      const F = r1.findings;
      assert.equal(F.filter((f) => f.id.startsWith('xk.pattern.')).length, 1);
      assert.equal(F.filter((f) => f.id.startsWith('xk.form.') && f.id !== 'xk.form.indoor').length, 1);
      assert.equal(F.some((f) => f.id === 'xk.yun.differs'), r1.meta.chartYun !== r1.meta.currentYun);
      assert.equal(F.some((f) => f.id === 'xk.special.heshi'), r1.specials.heshi.whole !== null);
      assert.equal(F.some((f) => f.id === 'xk.special.parent3'), r1.specials.parent3);
      assert.equal(F.some((f) => f.id === 'xk.special.qixing'), r1.specials.qixing !== null);
      assert.equal(F.some((f) => f.id === 'xk.special.lianshu'), r1.specials.lianshu && s.showLianshu);
      assert.equal(F.some((f) => f.id === 'xk.special.chengmen'), s.showChengmen);
      assert.equal(F.filter((f) => f.id.startsWith('xk.room.')).length, 6);
      for (const f of F.filter((x) => x.id.startsWith('xk.room.'))) assert.equal(f.tag, 'inference', '房間用途全部標推論(D37)');
      assert.equal(F.some((f) => f.id.startsWith('xk.star9.')), r1.meta.currentYun === 9);
      if (r1.meta.currentYun === 9) assert.equal(F.filter((f) => f.id.startsWith('xk.star9.')).length, 18);
      assert.equal(r1.pattern, r1.chart.pattern);
      assert.equal(F.some((f) => f.id === 'xk.locate.jian'), r1.locate.zone === 'jian');
    }
    // 見下方 todo 測試: -0 洩漏屬 geo.normalizeBearing
    assert.ok(negZero >= 0);
  });

  test('回傳值是複本: 竄改一次結果不影響下一次(不共用內部表)', () => {
    const inputs = [{ facing: 12, chartYun: 9, currentYun: 9 }, { facing: 200.5, chartYun: 3, currentYun: 9 }, { facing: 341, chartYun: 8, currentYun: 9 }];
    for (const input of inputs) {
      for (const st of [{}, { useTiGua: true, showLianshu: true, showChengmen: true }]) {
        const base = structuredClone(X.analyzeXuankong(input, st));
        const r = X.analyzeXuankong(input, st);
        tryMutate(r);
        assert.deepEqual(X.analyzeXuankong(input, st), base);
      }
    }
    const c0 = structuredClone(X.buildChart(7, '午'));
    const c = X.buildChart(7, '午');
    tryMutate(c);
    assert.deepEqual(X.buildChart(7, '午'), c0);
    for (const fn of [() => X.fly(3, true), () => X.yunPan(4), () => X.qiByPalace(X.buildChart(7, '午'), 9), () => X.nineStarPositions(X.buildChart(7, '午')),
      () => X.wealthDingPositions(X.buildChart(7, '午'), 9), () => X.roomAdvice(X.buildChart(7, '午'), 9), () => X.pairTag(2, 5), () => X.pairTagsOfPalace(X.buildChart(7, '午'), '坎'),
      () => X.mountainInfo('子'), () => X.listPatterns(9), () => X.localYin(X.buildChart(7, '午')), () => X.chengmen(X.buildChart(7, '午'), 9)]) {
      const base = structuredClone(fn());
      tryMutate(fn());
      assert.deepEqual(fn(), base, String(fn));
    }
  });

  test('X 的公開匯出常數不被外部改動(凍結)或改動不外洩', () => {
    for (const name of ['PALACES', 'FLY_ORDER', 'FLY_PATH', 'RING', 'TI_TABLES', 'PATTERN_NAMES', 'PATTERN_BY_DIRECTIONS', 'CHENGMEN', 'STAR_INFO', 'STAR_YUN9',
      'QI_SCHEMES', 'QI_LABEL_TEXT', 'QI_SCORE_BY_D', 'PAIR_TAGS', 'WENCHANG_KEYS', 'FORM_MATRIX']) {
      const v = X[name];
      const before = JSON.stringify(v);
      try { tryMutate(v); if (Array.isArray(v)) v.push('x'); else v.__evil = 1; } catch { /* 凍結 */ }
      assert.equal(JSON.stringify(X[name]), before, `${name} 可被外部改動`);
    }
  });

  test('效能: 單次 analyzeXuankong 的 p95 < 5 ms(含 Finding 產生)', () => {
    const rng = mulberry32(1);
    const ts = [];
    for (let i = 0; i < 400; i += 1) {
      const { input, settings } = randomInput(rng);
      const t = performance.now();
      X.analyzeXuankong(input, settings);
      ts.push(performance.now() - t);
    }
    ts.splice(0, 40); // 暖機
    ts.sort((a, b) => a - b);
    assert.ok(ts[Math.floor(ts.length * 0.95)] < 5, `p95=${ts[Math.floor(ts.length * 0.95)]}ms`);
    assert.ok(ts[ts.length - 1] < 100, `max=${ts[ts.length - 1]}ms`);
  });
});

// ═════════════════════════════ annual ═════════════════════════════

const oCenterSanyuan = (fy) => {
  const idx = mod(fy - 1864, 180);
  const start = [1, 4, 7][Math.floor(idx / 60)];
  return w9(start - (idx % 60));
};
const oCenterDigit = (fy) => {
  let s = Math.abs(fy);
  while (s > 9) s = String(s).split('').reduce((a, d) => a + Number(d), 0);
  const c = 11 - s;
  return c > 9 ? c - 9 : c;
};
const oStarAt = (center, luo) => mod(center - 1 + luo - 5, 9) + 1;
/** 五虎遁: 年干 → 寅月天干。 */
const TIGER_FIRST_STEM = { 0: 2, 5: 2, 1: 4, 6: 4, 2: 6, 7: 6, 3: 8, 8: 8, 4: 0, 9: 0 };
const oYearIdx = (fy) => mod(fy - 4, 60);
const oMonthStart = (yb) => ([0, 6, 3, 9].includes(yb) ? 8 : [4, 10, 1, 7].includes(yb) ? 5 : 2);
function oMonth(fyExact, order) {
  const idx = oYearIdx(fyExact);
  const stem = mod(TIGER_FIRST_STEM[idx % 10] + order, 10);
  const branch = mod(2 + order, 12);
  return { name: STEMS[stem] + BRANCHES[branch], stem, branch, center: w9(oMonthStart(idx % 12) - order) };
}
const oInArc = (b, from, to) => {
  const span = mod(to - from, 360);
  return mod(b - from, 360) < span;
};

describe('fuzz: annual 流年飛星與神煞 oracle', () => {
  test('流年中宮: 三個獨立公式一致(1864-2100 與 ±3000 年),飛布/五黃/二黑對 oracle', () => {
    for (let fy = -500; fy <= 4000; fy += 1) {
      const a = A.annualCenter(fy);
      assert.equal(a, oCenterSanyuan(fy), `三元甲子 fy=${fy}`);
      if (fy >= 1) assert.equal(a, oCenterDigit(fy), `尾數和 fy=${fy}`);
    }
    for (let fy = 1864; fy <= 2100; fy += 1) assert.equal(A.annualCenter(fy), REF.annualCenter(fy), `ref fy=${fy}`);
    assert.equal(A.annualCenter(2026), 1); assert.equal(A.annualCenter(2025), 2); assert.equal(A.annualCenter(2024), 3); assert.equal(A.annualCenter(2019), 8);
    for (let c = 1; c <= 9; c += 1) {
      const ch = A.fly(c);
      assert.deepEqual(Object.keys(ch), ['中宮', '西北', '西', '東北', '南', '北', '西南', '東', '東南'], '宮序');
      for (const [dir, star] of Object.entries(ch)) assert.equal(star, oStarAt(c, DIR_LUO[dir]), `fly ${c} ${dir}`);
      assert.deepEqual(Object.values(ch).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const byGua = A.flyByGua(c);
      for (const [gua, star] of Object.entries(byGua)) assert.equal(star, ch[DIR_OF_PAL[gua]], `flyByGua ${c} ${gua}`);
      for (let s = 1; s <= 9; s += 1) {
        const dir = A.palaceOfStar(c, s);
        assert.equal(ch[dir], s, `palaceOfStar ${c} ${s}`);
      }
    }
    assert.deepEqual(A.fly(1), { 中宮: 1, 西北: 2, 西: 3, 東北: 4, 南: 5, 北: 6, 西南: 7, 東: 8, 東南: 9 }, '規格 2.5.2 第 2 點 2026 年');
  });

  test('流月中宮: 12 年支 x 12 月序 對規格公式,月序 -1 遞減', () => {
    for (let b = 0; b < 12; b += 1) for (let order = 0; order < 12; order += 1) {
      const want = w9(oMonthStart(b) - order);
      assert.equal(A.monthlyCenter(b, order), want, `b=${b} order=${order}`);
      assert.equal(A.monthlyCenter(BRANCHES[b], order), want);
    }
    for (const [names, start] of [['子午卯酉', 8], ['辰戌丑未', 5], ['寅申巳亥', 2]]) for (const ch of names) assert.equal(A.monthlyCenter(ch, 0), start, ch);
    assert.equal(A.monthlyCenter('子', 0), 8);
  });

  test('太歲/歲破: 12 地支的方位角 30*b、對沖 +6', () => {
    for (let b = 0; b < 12; b += 1) {
      const t = A.taisui(b);
      assert.equal(t.branch, BRANCHES[b]);
      assert.equal(t.bearing, 30 * b);
      assert.equal(t.suipo, BRANCHES[(b + 6) % 12]);
      assert.equal(t.suipoBearing, (30 * b + 180) % 360);
      assert.equal(G.mountainAt(t.bearing).name, t.branch);
      assert.deepEqual(A.taisui(BRANCHES[b]), t);
    }
  });

  test('三煞: 12 地支 x 三層弧 == 規格四組數字;SANSHA_TABLE == 規格內嵌;四組 core3 不重疊', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(A.SANSHA_TABLE)).map((r) => ({ name: r.name, dir: r.dir, jie: r.jie, zai: r.zai, sui: r.sui, jia: r.jia })),
      SPEC_SANSHA.map((g) => ({ name: g.name, dir: g.dir, jie: g.jie, zai: g.zai, sui: g.sui, jia: g.jia })));
    for (const g of SPEC_SANSHA) {
      for (const b of g.branches) {
        for (const arcKey of ['core3', 'withJia', 'branch12']) {
          const s = A.sansha(b, { sanshaArc: arcKey });
          assert.equal(s.group, g.name); assert.equal(s.dir, g.dir);
          assert.equal(s.mountains, g.jie + g.zai + g.sui);
          assert.deepEqual([s.jieSha, s.zaiSha, s.suiSha], [g.jie, g.zai, g.sui]);
          assert.deepEqual(s.jiaSha, g.jia);
          assert.deepEqual(s.arcs.core3, g.core3.map((c) => [c, mod(c + 15, 360)]));
          assert.deepEqual(s.arcs.withJiaSha, g.withJia);
          assert.deepEqual(s.arcs.branch12, g.branch12);
          const wantRanges = arcKey === 'core3' ? g.core3.map((c) => [c, mod(c + 15, 360)]) : arcKey === 'withJia' ? [g.withJia] : [g.branch12];
          assert.deepEqual(s.arc, { layer: arcKey === 'withJia' ? 'withJiaSha' : arcKey, ranges: wantRanges });
          assert.equal(s.showJiaSha, false);
          assert.equal(A.sansha(b, { extraShensha: true }).showJiaSha, true);
        }
      }
    }
    // 三層弧的包含關係與寬度,以及與 inArc、24 山的關係(0.5° 網格 + 7.5 的倍數)
    for (const g of SPEC_SANSHA) {
      const s = A.sansha(g.branches[0]);
      const names = new Set([g.jie, g.zai, g.sui]);
      const near = new Set([...names, ...g.jia]);
      for (let k = 0; k < 720; k += 1) {
        const b = k * 0.5;
        const inCore = s.arcs.core3.some((arc) => A.inArc(b, arc));
        assert.equal(inCore, names.has(G.mountainAt(b).name), `core3 b=${b} ${g.name}`);
        assert.equal(A.inArc(b, s.arcs.withJiaSha), near.has(G.mountainAt(b).name), `withJia b=${b} ${g.name}`);
        assert.equal(A.inArc(b, s.arcs.branch12), oInArc(b, g.branch12[0], g.branch12[1]), `branch12 b=${b}`);
        assert.equal(oInArc(b, g.withJia[0], g.withJia[1]), A.inArc(b, s.arcs.withJiaSha), `oracle withJia b=${b}`);
        if (inCore) assert.ok(A.inArc(b, s.arcs.withJiaSha) && A.inArc(b, s.arcs.branch12));
        if (A.inArc(b, s.arcs.withJiaSha)) assert.ok(A.inArc(b, s.arcs.branch12));
      }
    }
    for (let k = 0; k < 720; k += 1) {
      const b = k * 0.5;
      const hits = SPEC_SANSHA.filter((g) => g.core3.some((c) => oInArc(b, c, mod(c + 15, 360)))).length;
      assert.ok(hits <= 1, `四組 core3 重疊 b=${b}`);
      assert.equal(hits, SPEC_SANSHA.map((g) => A.sansha(g.branches[0]).arcs.core3.some((arc) => A.inArc(b, arc))).filter(Boolean).length);
    }
  });

  test('inArc 差分: 隨機弧與方位角(含 7.5 倍數邊界、跨 0、負角度、>360)對 oracle;退化輸入丟錯', () => {
    const rng = mulberry32(8);
    for (let n = 0; n < 20000; n += 1) {
      const from = pick(rng, [7.5 * ri(rng, -100, 100), ri(rng, -720 * 8, 1080 * 8) / 8]);
      const to = pick(rng, [7.5 * ri(rng, -100, 100), ri(rng, -720 * 8, 1080 * 8) / 8]);
      const b = pick(rng, [7.5 * ri(rng, -100, 100), genBearing(rng)]);
      if (![b, from, to].every((v) => Number.isFinite(v))) continue;
      const nb = oNorm(b);
      const nf = oNorm(from);
      const nt = oNorm(to);
      const want = nf <= nt ? nb >= nf && nb < nt : nb >= nf || nb < nt;
      assert.equal(A.inArc(b, [from, to]), want, `b=${b} arc=[${from},${to}]`);
    }
    for (const bad of [[NaN, 1], [1, Infinity], ['a', 1], [1], [1, 2, 3], 'ab', null, undefined, 5, {}]) {
      assert.throws(() => A.inArc(10, bad), /^Error: (INVALID_ARC|INVALID_BEARING):/, JSON.stringify(bad));
    }
    assert.throws(() => A.inArc(NaN, [0, 10]), /^Error: INVALID_BEARING:/);
    assert.equal(A.inArc(0, [352.5, 7.5]), true);
    assert.equal(A.inArc(7.5, [352.5, 7.5]), false, '半開區間: 迄端不含');
    assert.equal(A.inArc(352.5, [352.5, 7.5]), true, '半開區間: 起端含');
  });

  test('突變測試: 竄改實作輸出或 oracle 表,差分必須抓出', () => {
    const s = A.sansha(6);
    const bad = structuredClone(s); bad.arcs.core3[1][0] = 353;
    assert.notDeepEqual(bad.arcs.core3, SPEC_SANSHA[2].core3.map((c) => [c, mod(c + 15, 360)]));
    assert.notEqual(oCenterSanyuan(2026), w9(oCenterSanyuan(2026) + 1));
    const saved = TIGER_FIRST_STEM[0]; TIGER_FIRST_STEM[0] = 3;
    try { assert.notEqual(oMonth(1984, 0).name, REF.monthTable(1984)[0].ganzhi, 'oracle 被竄改後應與參考實作不同'); } finally { TIGER_FIRST_STEM[0] = saved; }
    assert.equal(oMonth(1984, 0).name, REF.monthTable(1984)[0].ganzhi);
  });
});

describe('fuzz: annual/calendar 立春、年月界線、月表', () => {
  test('立春前後 1 ms 與 1 秒: 1900-2149 每年換年、月序、干支年月都跟著換', () => {
    for (let y = 1900; y <= 2149; y += 1) {
      const lc = C.lichun(y);
      assert.equal(Number.isInteger(lc), true);
      for (const dt of [1, 1000]) {
        const before = A.analyzeAnnual({ instant: lc - dt });
        const after = A.analyzeAnnual({ instant: lc + dt });
        assert.equal(before.year.fengshuiYear, y - 1, `${y} 立春前 ${dt}ms`);
        assert.equal(after.year.fengshuiYear, y, `${y} 立春後 ${dt}ms`);
        assert.equal(before.month.order, 11);
        assert.equal(after.month.order, 0);
        assert.equal(before.month.jie, '小寒');
        assert.equal(after.month.jie, '立春');
        assert.equal(after.year.lichun, lc);
        assert.equal(before.year.lichun, C.lichun(y - 1));
        assert.equal(before.year.ganzhi, STEMS[mod(y - 1 - 4, 10)] + BRANCHES[mod(y - 1 - 4, 12)]);
        assert.equal(after.year.ganzhi, STEMS[mod(y - 4, 10)] + BRANCHES[mod(y - 4, 12)]);
        assert.equal(before.annual.center, oCenterSanyuan(y - 1));
        assert.equal(after.annual.center, oCenterSanyuan(y));
        assert.equal(before.month.center, w9(oMonthStart(mod(y - 1 - 4, 12)) - 11), `${y} 前 月中宮用上一年年支`);
        assert.equal(after.month.center, w9(oMonthStart(mod(y - 4, 12)) - 0));
        assert.equal(before.month.ganzhi, oMonth(y - 1, 11).name, `${y} 前 丑月干支用上一年年干`);
        assert.equal(after.month.ganzhi, oMonth(y, 0).name);
      }
      assert.equal(A.analyzeAnnual({ instant: lc }).month.start, lc, '立春瞬間本身屬新年');
    }
  });

  test('規格 2.5.3 邊界數字: 2021 02-03 22:59、2025 02-03 22:10、2026 02-04 04:02;2025-01-20 = 甲辰年丑月丁丑中宮 3', () => {
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2021 }).year.lichunCST, '2021-02-03 22:59');
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2025 }).year.lichunCST, '2025-02-03 22:10');
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2026 }).year.lichunCST, '2026-02-04 04:02');
    const r = A.analyzeAnnual({ instant: utcMs(2025, 1, 20, 12) - CST });
    assert.equal(r.year.fengshuiYear, 2024);
    assert.equal(r.year.ganzhi, '甲辰');
    assert.equal(r.month.ganzhi, '丁丑');
    assert.equal(r.month.center, 3);
    assert.equal(r.month.jie, '小寒');
    // 12/31 UTC 但已是 1/1 CST
    const ny = A.analyzeAnnual({ instant: utcMs(2026, 1, 1, 0, 30) - CST });
    assert.equal(ny.year.fengshuiYear, 2025);
    assert.equal(ny.meta.computedAtCST, '2026-01-01 00:30');
    // 規格 2.5.1 範例(2026-09-29 12:00 CST)
    const ex = A.analyzeAnnual({ instant: utcMs(2026, 9, 29, 12) - CST });
    assert.equal(ex.year.ganzhi, '丙午'); assert.equal(ex.year.yun, 9); assert.equal(ex.year.yunYear, 3); assert.equal(ex.year.era, '下元');
    assert.deepEqual(ex.annual.chart, { 中宮: 1, 西北: 2, 西: 3, 東北: 4, 南: 5, 北: 6, 西南: 7, 東: 8, 東南: 9 });
    assert.equal(ex.annual.wuhuang, '南'); assert.equal(ex.annual.erhei, '西北');
    assert.deepEqual([ex.month.jie, ex.month.ganzhi, ex.month.order, ex.month.center, ex.month.startCST, ex.month.endCST], ['白露', '丁酉', 7, 1, '2026-09-07 22:41', '2026-10-08 14:30']);
    assert.deepEqual([ex.taisui.branch, ex.taisui.bearing, ex.taisui.suipo, ex.taisui.suipoBearing], ['午', 180, '子', 0]);
    assert.deepEqual([ex.sansha.dir, ex.sansha.mountains, ex.sansha.jieSha, ex.sansha.zaiSha, ex.sansha.suiSha, ex.sansha.jiaSha], ['北', '亥子丑', '亥', '子', '丑', ['壬', '癸']]);
  });

  test('隨機瞬間 6000 個(1900-2100): 年、月序、月界、月柱、月中宮、流年盤 對參考實作與 oracle', () => {
    const rng = mulberry32(2026);
    const lo = utcMs(1900, 1, 1);
    const hi = utcMs(2100, 12, 31);
    for (let n = 0; n < 6000; n += 1) {
      const ms = lo + Math.floor(rng() * (hi - lo));
      const r = A.analyzeAnnual({ instant: ms });
      const fy = REF.fengshuiYear(ms);
      const mo = REF.monthOf(ms);
      assert.equal(r.year.fengshuiYear, fy, `fy ms=${ms}`);
      assert.equal(r.month.order, mo.order, `order ms=${ms}`);
      assert.equal(r.month.start, mo.start);
      assert.equal(r.month.end, mo.end);
      assert.equal(r.month.jie, mo.jieName);
      assert.ok(r.month.start <= ms && ms < r.month.end, `ms 在月內 ms=${ms}`);
      const om = oMonth(fy, mo.order);
      assert.equal(r.month.ganzhi, om.name, `月柱 ms=${ms}`);
      assert.equal(r.month.center, om.center, `月中宮 ms=${ms}`);
      assert.equal(r.year.ganzhi, STEMS[mod(fy - 4, 10)] + BRANCHES[mod(fy - 4, 12)]);
      assert.equal(r.annual.center, oCenterSanyuan(fy));
      for (const [dir, star] of Object.entries(r.annual.chart)) assert.equal(star, oStarAt(r.annual.center, DIR_LUO[dir]));
      for (const [dir, star] of Object.entries(r.month.chart)) assert.equal(star, oStarAt(r.month.center, DIR_LUO[dir]));
      assert.equal(r.annual.chart[r.annual.wuhuang], 5); assert.equal(r.annual.chart[r.annual.erhei], 2);
      assert.equal(r.month.chart[r.month.wuhuang], 5); assert.equal(r.month.chart[r.month.erhei], 2);
      assert.equal(r.annual.wuhuangGua, Object.keys(DIR_OF_PAL).find((g) => DIR_OF_PAL[g] === r.annual.wuhuang));
      assert.equal(r.month.fengshuiYear, fy);
      const yy = REF.nineYun(fy);
      assert.deepEqual([r.year.yun, r.year.yunYear, r.year.era], [yy.yun, yy.yunYear, yy.yuan]);
      const t = REF.taisui(mod(fy - 4, 12));
      assert.deepEqual([r.taisui.branch, r.taisui.bearing, r.taisui.suipo, r.taisui.suipoBearing], [t.branch, t.bearing, t.suipo, t.suipoBearing]);
      const ss = REF.sansha(mod(fy - 4, 12));
      assert.deepEqual([r.sansha.dir, r.sansha.jieSha, r.sansha.zaiSha, r.sansha.suiSha, r.sansha.jiaSha], [ss.dir, ss.jieSha, ss.zaiSha, ss.suiSha, ss.jiaSha]);
      assert.equal(r.approx, false);
    }
  });

  test('12 個月連續(前月 end = 後月 start)、月表與 analyzeAnnual 月一致、月序界線 ±1ms、全 1864-2150', () => {
    for (let fy = 1864; fy <= 2150; fy += 1) {
      const T = A.monthlyTable(fy);
      assert.equal(T.length, 12);
      assert.equal(T[0].start, C.lichun(fy));
      for (let k = 0; k < 12; k += 1) {
        assert.equal(T[k].order, k);
        assert.ok(T[k].start < T[k].end, `fy=${fy} k=${k}`);
        if (k > 0) assert.equal(T[k - 1].end, T[k].start, `fy=${fy} k=${k} 連續`);
        const om = oMonth(fy, k);
        assert.equal(T[k].ganzhi, om.name, `fy=${fy} k=${k}`);
        assert.equal(T[k].center, om.center);
        const days = (T[k].end - T[k].start) / 86400000;
        assert.ok(days > 28.5 && days < 32.5, `月長 fy=${fy} k=${k}: ${days}`);
        assert.equal(T[k].wuhuang, A.palaceOfStar(T[k].center, 5));
        assert.equal(T[k].erhei, A.palaceOfStar(T[k].center, 2));
      }
      assert.equal(T[11].end, A.monthlyTable(fy + 1)[0].start, `fy=${fy} 丑月止於次年立春`);
      assert.equal(T[0].jie, '立春'); assert.equal(T[11].jie, '小寒'); assert.equal(T[10].jie, '大雪');
      if (fy >= 1900 && fy <= 2100 && fy % 7 === 0) {
        for (let k = 0; k < 12; k += 1) {
          const a = A.analyzeAnnual({ instant: T[k].start });
          const b = A.analyzeAnnual({ instant: T[k].start - 1 });
          assert.equal(a.month.order, k); assert.equal(a.month.fengshuiYear, fy);
          assert.equal(b.month.order, mod(k - 1, 12));
          assert.equal(a.month.center, T[k].center);
        }
      }
    }
  });

  test('閏年與跨年: 每年 2/29 前後、12/31 23:59:59 CST、1/1 00:00:00 CST 對參考實作(月柱、月序、年)', () => {
    const insts = [];
    for (let y = 1900; y <= 2100; y += 1) {
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      insts.push(utcMs(y, 12, 31, 23, 59, 59) - CST, utcMs(y, 1, 1, 0, 0, 0) - CST, utcMs(y, 2, 28, 23, 59, 59) - CST, utcMs(y, 3, 1, 0, 0, 0) - CST);
      if (leap) insts.push(utcMs(y, 2, 29, 0, 0, 0) - CST, utcMs(y, 2, 29, 23, 59, 59) - CST);
      insts.push(utcMs(y, 12, 31, 23, 59, 59), utcMs(y, 1, 1, 0, 0, 0)); // UTC 邊界
    }
    for (const ms of insts) {
      const r = A.analyzeAnnual({ instant: ms });
      const fy = REF.fengshuiYear(ms);
      const mo = REF.monthOf(ms);
      assert.equal(r.year.fengshuiYear, fy, `ms=${ms}`);
      assert.equal(r.month.order, mo.order);
      assert.equal(r.month.ganzhi, oMonth(fy, mo.order).name);
      assert.equal(r.month.center, oMonth(fy, mo.order).center);
      assert.ok(r.month.start <= ms && ms < r.month.end);
    }
    // 元旦不換年: 1/1 屬上一風水年、丑月
    assert.equal(A.analyzeAnnual({ instant: utcMs(2027, 1, 1, 0, 0, 0) - CST }).year.fengshuiYear, 2026);
    const jan1 = A.analyzeAnnual({ instant: utcMs(2027, 1, 1, 0, 0, 0) - CST });
    assert.deepEqual([jan1.month.jie, jan1.month.order, jan1.month.fengshuiYear], ['大雪', 10, 2026]); // 2027 小寒在 1/5
  });

  test('nearLichun: 立春 ±120 s 內警示與 Finding,外側不警示', () => {
    for (const y of [1901, 1950, 1984, 2000, 2026, 2050, 2099]) {
      const lc = C.lichun(y);
      for (const dt of [0, 1000, -1000, 119000, -119000, 120000, -120000]) {
        const r = A.analyzeAnnual({ instant: lc + dt });
        assert.ok(r.meta.warnings.includes('nearLichun'), `${y} dt=${dt}`);
        assert.ok(r.findings.some((f) => f.id === 'annual.year.near_lichun'));
      }
      for (const dt of [121000, -121000, 600000, -3600000]) {
        const r = A.analyzeAnnual({ instant: lc + dt });
        assert.ok(!r.meta.warnings.includes('nearLichun'), `${y} dt=${dt}`);
      }
      assert.ok(!A.analyzeAnnual({ fengshuiYear: y }).meta.warnings.includes('nearLichun'));
    }
  });

  test('九運(nineYun): 20 年一運、180 年循環、era、二元八運;範圍外標警告', () => {
    for (let fy = 1864; fy <= 2500; fy += 1) {
      const y = A.analyzeAnnual({ fengshuiYear: Math.min(fy, 2150) }).year;
      const d = mod(Math.min(fy, 2150) - 1864, 180);
      assert.deepEqual([y.yun, y.yunYear], [Math.floor(d / 20) + 1, (d % 20) + 1]);
      assert.equal(C.nineYun(fy).yun, Math.floor(mod(fy - 1864, 180) / 20) + 1);
      assert.equal(C.nineYun(fy + 180).yun, C.nineYun(fy).yun, '180 年循環');
      assert.equal(C.nineYun(fy).era, mod(fy - 1864, 180) < 60 ? '上元' : mod(fy - 1864, 180) < 120 ? '中元' : '下元');
    }
    assert.equal(C.nineYun(2023).yun, 8); assert.equal(C.nineYun(2024).yun, 9); assert.equal(C.nineYun(2043).yun, 9); assert.equal(C.nineYun(2044).yun, 1);
    const r = A.analyzeAnnual({ fengshuiYear: 2050 }, { yunSystem: 'er_yuan_8' });
    assert.equal(r.year.yun, null); assert.ok(r.meta.warnings.includes('yunSystemOutOfRange'));
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2026 }, { yunSystem: 'er_yuan_8' }).year.yun, 9);
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2000 }, { yunSystem: 'er_yuan_8' }).year.yun, 8);
  });

  test('節氣第二意見: termInstant 對參考實作 0 差(1900-2100 x 24),對 Meeus 低精度 < 20 分鐘;solarLongitude 對 Meeus < 0.02 度', () => {
    for (let y = 1900; y <= 2100; y += 1) {
      for (let i = 0; i < 24; i += 1) {
        const t = C.termInstant(y, i);
        assert.equal(t, REF.termInstant(y, i), `y=${y} i=${i}`);
        const target = (285 + 15 * i) % 360;
        assert.ok(angDiff(meeusLongitude(t), target) < 0.02, `Meeus y=${y} i=${i}: ${meeusLongitude(t)} vs ${target}`);
        if (i > 0) assert.ok(t > C.termInstant(y, i - 1), `節氣單調 y=${y} i=${i}`);
        assert.ok(C.solarLongitude(t) >= 0 && C.solarLongitude(t) < 360);
        assert.ok(angDiff(C.solarLongitude(t), target) < 1e-4, `視黃經在節氣瞬間 y=${y} i=${i}`);
      }
    }
    const rng = mulberry32(3);
    for (let n = 0; n < 5000; n += 1) {
      const ms = utcMs(1900, 1, 1) + Math.floor(rng() * (utcMs(2100, 1, 1) - utcMs(1900, 1, 1)));
      assert.ok(angDiff(C.solarLongitude(ms), meeusLongitude(ms)) < 0.02);
    }
  });

  test('超出支援範圍: approx 旗標、YEAR_OUT_OF_RANGE 帶碼,不出現 NaN 字串', () => {
    assert.equal(A.analyzeAnnual({ fengshuiYear: 1863 }).approx, true);
    assert.equal(A.analyzeAnnual({ fengshuiYear: 1864 }).approx, false);
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2150 }).approx, false);
    assert.equal(A.analyzeAnnual({ fengshuiYear: 2151 }).approx, true);
    assert.ok(A.analyzeAnnual({ fengshuiYear: 2151 }).meta.warnings.includes('approxRange'));
    for (const y of [-5, 0, 99, 10000, 1e21]) {
      assert.throws(() => A.analyzeAnnual({ fengshuiYear: y }), /^Error: YEAR_OUT_OF_RANGE:/, String(y));
    }
    for (const ms of [8.64e15, -8.64e15]) assert.throws(() => A.analyzeAnnual({ instant: ms }), /^Error: (YEAR_OUT_OF_RANGE|INVALID_INSTANT):/);
    for (const y of [1850, 1700, 1500, 2151, 2200, 2400, 3000]) {
      const r = A.analyzeAnnual({ instant: utcMs(y, 6, 15) });
      assert.equal(r.approx, true, String(y));
      assertPlainJson(r);
      assert.ok(!JSON.stringify(r).includes('NaN'));
      assert.equal(r.year.fengshuiYear, y);
    }
  });

  test('非法輸入: 有碼的錯誤,不回傳半成品', () => {
    for (const [input, code] of [
      [{ instant: NaN }, 'INVALID_INSTANT'], [{ instant: Infinity }, 'INVALID_INSTANT'], [{ instant: '2026' }, 'INVALID_INSTANT'], [{ instant: null }, 'INVALID_INSTANT'],
      [{ instant: new Date() }, 'INVALID_INSTANT'], [{ fengshuiYear: 2026.5 }, 'INVALID_YEAR'], [{ fengshuiYear: NaN }, 'INVALID_YEAR'], [{ fengshuiYear: '2026' }, 'INVALID_YEAR'],
      [{ fengshuiYear: null }, 'INVALID_YEAR'], [{ fengshuiYear: 2026, instant: 0 }, 'INVALID_INPUT'], [{}, 'INVALID_INPUT'], [null, 'INVALID_INPUT'], [[], 'INVALID_INPUT'],
      [undefined, 'INVALID_INPUT'], ['2026', 'INVALID_INPUT'], [5, 'INVALID_INPUT'],
    ]) {
      assert.throws(() => A.analyzeAnnual(input), (e) => e.message.startsWith(`${code}:`), `${String(JSON.stringify(input))} 應丟 ${code}`);
    }
    for (const [st, code] of [[{ sanshaArc: 'x' }, 'INVALID_SETTING'], [{ zz: 1 }, 'INVALID_SETTING'], [{ yunSystem: 'x' }, 'INVALID_SETTING']]) {
      assert.throws(() => A.analyzeAnnual({ fengshuiYear: 2026 }, st), (e) => e.message.startsWith(`${code}:`), JSON.stringify(st));
    }
    for (const fn of [() => A.sansha(12), () => A.sansha(-1), () => A.sansha(1.5), () => A.sansha('6'), () => A.sansha(), () => A.taisui('constructor'), () => A.taisui(null),
      () => A.monthlyCenter(0, 12), () => A.monthlyCenter(0, -1), () => A.monthlyCenter(0, 1.5), () => A.monthlyCenter(0, '1'), () => A.monthlyCenter(12, 0),
      () => A.fly(0), () => A.fly(10), () => A.fly(1.5), () => A.fly('1'), () => A.palaceOfStar(0, 1), () => A.palaceOfStar(1, 10), () => A.wrap9(1.5), () => A.wrap9(NaN),
      () => A.annualCenter(1.5), () => A.annualCenter(NaN), () => A.monthlyTable(1.5), () => A.flyByGua(0)]) {
      assert.throws(fn, (e) => /^[A-Z_]+: /.test(e.message), String(fn));
    }
  });

  test('Finding 形狀、id 不重複、旗標對應設定;extraShensha / showMinorityTechniques', () => {
    const rng = mulberry32(12);
    for (let n = 0; n < 1000; n += 1) {
      const st = { extraShensha: rng() < 0.5, showMinorityTechniques: rng() < 0.5, sanshaArc: pick(rng, ['core3', 'withJia', 'branch12']) };
      const r = A.analyzeAnnual({ instant: utcMs(1900, 1, 1) + Math.floor(rng() * 200 * 365.25 * 86400000) }, st);
      assertFindings(r.findings, `n=${n}`);
      assert.equal(r.findings.some((f) => f.id === 'annual.sansha.jiasha'), st.extraShensha);
      assert.equal(r.findings.some((f) => f.id === 'annual.sansha.facing_not_sitting'), st.showMinorityTechniques);
      for (const f of r.findings.filter((x) => x.id !== 'annual.year.near_lichun')) assert.equal(f.tag, 'minority', `${f.id} 少數派`);
      assert.equal(r.meta.ruleset.sanshaArc, st.sanshaArc);
      assert.equal(r.meta.ruleset.yearBoundary, 'lichun_exact');
      assert.equal(r.meta.schema, 'fengshui.annual/1');
      assert.equal(r.meta.warnings.includes('extraShenshaPartial'), st.extraShensha);
    }
    const r = A.analyzeAnnual({ fengshuiYear: 2026 }, { yearBoundary: 'gregorian_jan1' });
    assert.ok(r.meta.warnings.includes('yearBoundaryIgnored'));
    assert.equal(r.meta.ruleset.yearBoundary, 'lichun_exact');
    assert.equal(r.month, null, '只給年時無月');
  });

  test('純 JSON、輸入凍結不被改、決定性、回傳為複本;效能 p95 < 5 ms', () => {
    const rng = mulberry32(555);
    for (let n = 0; n < 1500; n += 1) {
      const input = rng() < 0.5 ? { instant: utcMs(1864, 1, 1) + Math.floor(rng() * 290 * 365.25 * 86400000) } : { fengshuiYear: ri(rng, 1864, 2150) };
      const st = rng() < 0.5 ? {} : { extraShensha: true, sanshaArc: pick(rng, ['core3', 'withJia', 'branch12']) };
      const ic = structuredClone(input); const sc = structuredClone(st);
      deepFreeze(input); deepFreeze(st);
      const a = A.analyzeAnnual(input, st);
      const b = A.analyzeAnnual(input, st);
      assert.deepEqual(a, b); assert.deepEqual(input, ic); assert.deepEqual(st, sc);
      assertPlainJson(a);
      assert.equal(findNegZero(a), null, `-0 洩漏: ${findNegZero(a)}`);
    }
    const base = structuredClone(A.analyzeAnnual({ instant: utcMs(2026, 9, 29) }, { extraShensha: true }));
    const r = A.analyzeAnnual({ instant: utcMs(2026, 9, 29) }, { extraShensha: true });
    tryMutate(r);
    assert.deepEqual(A.analyzeAnnual({ instant: utcMs(2026, 9, 29) }, { extraShensha: true }), base);
    for (const fn of [() => A.sansha(3), () => A.taisui(3), () => A.fly(4), () => A.flyByGua(4), () => A.monthlyTable(2026), () => A.PALACES.map((p) => ({ ...p }))]) {
      const b0 = structuredClone(fn());
      tryMutate(fn());
      assert.deepEqual(fn(), b0, String(fn));
    }
    for (const name of ['PALACES', 'SANSHA_TABLE', 'MONTH_START_STAR', 'SANSHA_ARC_SETTINGS']) {
      const v = A[name]; const before = JSON.stringify(v);
      try { tryMutate(v); if (Array.isArray(v)) v.push(1); } catch { /* 凍結 */ }
      assert.equal(JSON.stringify(A[name]), before, `${name} 可被外部改動`);
    }
    const ts = [];
    for (let i = 0; i < 400; i += 1) {
      const t = performance.now();
      A.analyzeAnnual({ instant: utcMs(1950, 1, 1) + Math.floor(rng() * 150 * 365.25 * 86400000) }, { extraShensha: true });
      ts.push(performance.now() - t);
    }
    ts.splice(0, 40); ts.sort((x, y) => x - y);
    assert.ok(ts[Math.floor(ts.length * 0.95)] < 5, `p95=${ts[Math.floor(ts.length * 0.95)]}ms`);
    assert.ok(ts[ts.length - 1] < 100, `max=${ts[ts.length - 1]}ms`);
  });
});

describe('fuzz: 全部公開函式吃垃圾輸入(不得洩漏 TypeError/RangeError,不得回傳非 JSON)', () => {
  const VALID_CHART = X.buildChart(9, '子');
  function pool(rng) {
    const P = [0, -0, 1, 5, 9, 10, -1, 0.5, 4.5, 7.5, 12, 24, 180, 360, -360, 1e9, 1e21, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity,
      '', '子', '午', '壬', '坎', '中', '北', '東北', '南', 'A', 'B', 'S1', 'default', '9', 'constructor', '__proto__', 'toString', true, false, null, undefined,
      [], [1, 2], [0, 10], [350, 20], ['a'], {}, { xuankong: 10 }, { instant: 0 }, { fengshuiYear: 2026 }, { instant: 1e12 }, { fengshuiYear: 1e5 }, { facing: 200, chartYun: 9, currentYun: 9 },
      { yunSystem: 'er_yuan_8' }, { extraShensha: true }, { sanshaArc: 'branch12' }, { eightKeepsWealth: true }, { ti: true }, { ti: true, tiTable: 'B' }, VALID_CHART, () => 1, Symbol.iterator, 10n];
    return P;
  }
  const CHART_FIRST = new Set(['classifyChart', 'heshi', 'heshiPalaces', 'lianshu3', 'localYin', 'nineStarPositions', 'pairTagsOfPalace', 'parent3', 'qiByPalace', 'qixing',
    'roomAdvice', 'wealthDingPositions', 'wholePlate', 'chengmen', 'palacesWithStar']);
  // buildFindings 吃的是 analyzeXuankong 的內部中間結果 ctx,不是使用者輸入,不納入垃圾輸入測試
  const NAMES = [...Object.keys(X).filter((k) => typeof X[k] === 'function' && k !== 'buildFindings').map((k) => ['X', k, X[k]]), ...Object.keys(A).filter((k) => typeof A[k] === 'function').map((k) => ['A', k, A[k]])];

  test('每個公開函式 2000 組隨機參數: 回傳純 JSON,或丟出「大寫底線碼: 訊息」的 Error', () => {
    const rng = mulberry32(777);
    const P = pool(rng);
    const bad = [];
    for (const [mod_, name, fn] of NAMES) {
      for (let n = 0; n < 2000; n += 1) {
        const args = Array.from({ length: ri(rng, 0, 3) }, () => P[ri(rng, 0, P.length - 1)]);
        // 以 Chart 為第一參數的函式是內部協作介面,第一參數固定給合法盤,其餘參數照樣亂丟
        if (CHART_FIRST.has(name)) args[0] = VALID_CHART;
        let out;
        try {
          out = fn(...args.map((a) => (a && typeof a === 'object' && !Object.isFrozen(a) ? structuredClone(a) : a)));
        } catch (e) {
          if (!(e instanceof Error) || !/^[A-Z][A-Z_]+: /.test(e.message)) {
            // 傳入函式/BigInt 等 structuredClone 不吃的值時直接以原值重試
            let e2 = e;
            if (e instanceof DOMException) { try { fn(...args); e2 = null; } catch (x) { e2 = x; } }
            if (e2 && (!(e2 instanceof Error) || !/^[A-Z][A-Z_]+: /.test(e2.message))) bad.push(`${mod_}.${name}(${args.map((a) => { try { return (JSON.stringify(a) ?? String(a)).slice(0, 50); } catch { return String(a); } }).join(', ')}) -> ${e2?.constructor?.name}: ${e2?.message}`);
          }
          continue;
        }
        try { assertPlainJson(out); } catch (e) {
          bad.push(`${mod_}.${name}(${args.map((a) => { try { return (JSON.stringify(a) ?? String(a)).slice(0, 50); } catch { return String(a); } }).join(', ')}) 回傳非純 JSON: ${e.message}`);
        }
      }
    }
    assert.deepEqual([...new Set(bad.map((b) => b.split('(')[0]))], [], ['例(每個函式一則):', ...[...new Set(bad.map((b) => b.split('(')[0]))].map((f) => bad.find((b) => b.startsWith(`${f}(`)))].join(String.fromCharCode(10)));
  });
});

// ═════════════════════════ 其他模組缺陷的迴歸(審查時發現,已由對應模組修正) ═════════════════════════

describe('fuzz: 上游模組缺陷迴歸(geo、calendar)', () => {
  test('geo.normalizeBearing(-0) 回 +0(規格 1.3 公式 ((b%360)+360)%360),-0 不洩漏到 analyzeXuankong 輸出', () => {
    assert.equal(Object.is(G.normalizeBearing(-0), 0), true);
    assert.equal(findNegZero(X.analyzeXuankong({ facing: -0, chartYun: 9, currentYun: 9 })), null);
  });

  test('calendar.formatCST 在 Date 範圍邊界不回 "NaN" 字串', () => {
    for (const ms of [8.64e15, -8.64e15]) {
      let out;
      try { out = C.formatCST(ms); } catch (e) { assert.match(e.message, /^[A-Z_]+: /); continue; }
      assert.ok(!out.includes('NaN'), out);
    }
  });
});

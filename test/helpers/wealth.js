// wealth 測試專用: 第二來源的獨立實作與規格文字解析。刻意不 import src/core/wealth*.js,
// 這樣「距離法 == 進門者左右手法」「規格內嵌表 == 實作常數」「爻變重算 == 8x8 星表」才有比對意義(spec 4.2 第 6 點)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_TEXT = readFileSync(path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');

import { range } from './plan.js';

export { mulberry32, range, rectPoly, makePlan, deepFreeze } from './plan.js';

export const GUA8 = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
export const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
export const DIR_OF = Object.fromEntries(GUA8.map((g, i) => [g, DIR8[i]]));
export const LUOSHU_OF = { 坎: 1, 坤: 2, 震: 3, 巽: 4, 中: 5, 乾: 6, 兌: 7, 艮: 8, 離: 9 };

// ───────────────────────── 規格文字解析 ─────────────────────────

/** 規格 2.6.7 內嵌的 JSON 表(PROFILES、BAZ_VAL、XK9_VAL、YEAR_VAL、G)。 */
export function parseSpecTables() {
  const at = SPEC_TEXT.indexOf('{ "PROFILES"');
  if (at < 0) throw new Error('規格 2.6.7 的 JSON 表找不到');
  const end = SPEC_TEXT.indexOf('\n```', at);
  return JSON.parse(SPEC_TEXT.slice(at, end));
}

/** 規格 2.6.7 的已驗證算術例數字。 */
export function parseSpecScoreExample() {
  const num = (re, i = 1) => {
    const m = SPEC_TEXT.match(re);
    if (!m) throw new Error(`規格文字找不到: ${re}`);
    return Number(m[i]);
  };
  return {
    mingcai: num(/`mingcai` 檔 ([\d.]+) 分,`xuankong` 檔 ([\d.]+)/, 1),
    xuankong: num(/`mingcai` 檔 ([\d.]+) 分,`xuankong` 檔 ([\d.]+)/, 2),
    windowMingcai: num(/有窗版 ([\d.]+) 與 ([\d.]+)/, 1),
    windowXuankong: num(/有窗版 ([\d.]+) 與 ([\d.]+)/, 2),
    toiletAdjacent: num(/鄰廁所 ([\d.]+)/),
    southwestWall: num(/西南角只有 ([\d.]+) 分/),
    bearing: num(/方位 (\d+) 度落震宮/),
  };
}

/** 規格 2.6.3 的 L 型手推例距離。 */
export function parseSpecLShape() {
  const m = SPEC_TEXT.match(/\(0,6\) ([\d.]+)、\(2,6\) ([\d.]+)、\(5,3\) ([\d.]+)/);
  if (!m) throw new Error('規格 2.6.3 的 L 型距離找不到');
  return { '0,6': Number(m[1]), '2,6': Number(m[2]), '5,3': Number(m[3]) };
}

// ───────────────────────── 明財位 oracle(進門者左右手法) ─────────────────────────

/**
 * 進門者視角: 站在門口面朝室內,門在遠牆中點的左邊 → 財位在遠端右角;右邊 → 遠端左角。
 * 完全不用距離,與 geometry.js 的距離法互為獨立實作。只適用門不在牆正中的矩形。
 * @returns {[number,number]} 明財位角的座標
 */
export function oracleRectCorner(w, d, wall, pos) {
  const face = { bottom: [0, 1], top: [0, -1], left: [1, 0], right: [-1, 0] }[wall];
  const right = [face[1], -face[0]];
  const length = wall === 'bottom' || wall === 'top' ? w : d;
  const depth = wall === 'bottom' || wall === 'top' ? d : w;
  const wallMid = { bottom: [w / 2, 0], top: [w / 2, d], left: [0, d / 2], right: [w, d / 2] }[wall];
  const doorPoint = { bottom: [pos, 0], top: [pos, d], left: [0, pos], right: [w, pos] }[wall];
  const lateral = (doorPoint[0] - wallMid[0]) * right[0] + (doorPoint[1] - wallMid[1]) * right[1];
  const farMid = [wallMid[0] + face[0] * depth, wallMid[1] + face[1] * depth];
  const sign = lateral < 0 ? 1 : -1; // 門在左半(lateral<0)取右角
  return [farMid[0] + right[0] * sign * (length / 2), farMid[1] + right[1] * sign * (length / 2)];
}

// ───────────────────────── L 型 oracle(取樣可見性 + 經凹角) ─────────────────────────

/** 依序裁掉右上缺口的 L 型: 外框 W x H,缺口自 (w1,h1) 到右上角。逆時針。 */
export const lShape = (W, H, w1, h1) => [[0, 0], [W, 0], [W, h1], [w1, h1], [w1, H], [0, H]];

function insideL(W, H, w1, h1, p, tol = 1e-9) {
  const inBox = p[0] >= -tol && p[0] <= W + tol && p[1] >= -tol && p[1] <= H + tol;
  const inNotch = p[0] > w1 + tol && p[1] > h1 + tol;
  return inBox && !inNotch;
}

const sampleVisible = (W, H, w1, h1, a, b) => {
  for (let i = 0; i <= 400; i += 1) {
    const t = i / 400;
    if (!insideL(W, H, w1, h1, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 1e-7)) return false;
  }
  return true;
};

/** L 型只有一個凹角 (w1,h1): 最短路徑不是直線就是經過凹角。回傳到 6 個頂點的距離。 */
export function oracleLDistances(W, H, w1, h1, from) {
  const poly = lShape(W, H, w1, h1);
  const reflex = [w1, h1];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return poly.map((v) => {
    if (sampleVisible(W, H, w1, h1, from, v)) return d(from, v);
    return d(from, reflex) + d(reflex, v);
  });
}

// ───────────────────────── 八宅遊年 oracle(獨立爻變) ─────────────────────────

/** 卦的爻(初爻,中爻,上爻),1=陽。手打,不讀 geo。 */
const BITS = { 乾: '111', 兌: '110', 離: '101', 震: '100', 巽: '011', 坎: '010', 艮: '001', 坤: '000' };
const NAME_OF_BITS = Object.fromEntries(Object.entries(BITS).map(([k, v]) => [v, k]));
const WALK = [[2, '生氣'], [1, '五鬼'], [0, '延年'], [1, '六煞'], [2, '禍害'], [1, '天醫'], [0, '絕命'], [1, '伏位']];

/** 宅卦 → 星 → 方位名(獨立於 bazhai.js 的產生器)。 */
export function oracleStarDirs(house) {
  const bits = [...BITS[house]];
  const out = {};
  for (const [line, star] of WALK) {
    bits[line] = bits[line] === '1' ? '0' : '1';
    out[star] = DIR_OF[NAME_OF_BITS[bits.join('')]];
  }
  return out;
}

// ───────────────────────── 飛星 oracle ─────────────────────────

const FLY_ORDER_GUA = ['中', '乾', '兌', '艮', '離', '坎', '坤', '震', '巽'];
/** 中宮星入中順飛,回傳 卦 → 星。 */
export function oracleFly(center) {
  return Object.fromEntries(FLY_ORDER_GUA.map((g, i) => [g, ((center - 1 + i) % 9) + 1]));
}

// ───────────────────────── 隨機案例 ─────────────────────────

export function randomRectCase(rng) {
  const w = 2 + rng() * 10;
  const d = 2 + rng() * 10;
  const wall = ['bottom', 'top', 'left', 'right'][Math.floor(rng() * 4)];
  const length = wall === 'bottom' || wall === 'top' ? w : d;
  // 避開正中與帶邊界,這些由固定案例測
  let pos;
  do pos = 0.3 + rng() * (length - 0.6);
  while (Math.abs(pos - length / 2) < 0.02 * length);
  return { w, d, wall, pos };
}

/**
 * 隨機但合法的平面圖: 外框矩形內放一個客廳矩形(原點),大門在客廳任一面牆,另有隨機的窗、落地窗與室內門。
 * 開口區間都落在牆內(plan 驗證才過);允許彼此重疊(plan 只警告)。
 */
export function randomPlanCase(rng) {
  const lw = range(rng, 3, 8);
  const ld = range(rng, 3, 8);
  const wall = ['bottom', 'top', 'left', 'right'][Math.floor(rng() * 4)];
  const wallLen = (wl) => (wl === 'bottom' || wl === 'top' ? lw : ld);
  const opening = (id, kind, wl) => {
    const width = range(rng, 0.7, 1.6);
    const len = wallLen(wl);
    return { id, kind, roomId: 'living', wall: wl, pos: width / 2 + rng() * (len - width), width };
  };
  const openings = [opening('d1', 'entrance', wall)];
  const kinds = ['window', 'floorWindow', 'door', 'balconyDoor'];
  const extra = Math.floor(rng() * 4);
  for (let i = 0; i < extra; i += 1) {
    const wl = ['bottom', 'top', 'left', 'right'][Math.floor(rng() * 4)];
    openings.push(opening(`o${i}`, kinds[Math.floor(rng() * kinds.length)], wl));
  }
  const plan = {
    version: 1,
    unit: 'm',
    planUpBearing: rng() < 0.15 ? null : range(rng, -400, 400),
    outline: [[0, 0], [lw + 3, 0], [lw + 3, ld + 2], [0, ld + 2]],
    rooms: [{ id: 'living', type: 'living', polygon: [[0, 0], [lw, 0], [lw, ld], [0, ld]] }],
    openings,
    mainDoor: 'd1',
    taiji: { mode: 'centroid', manual: null },
  };
  return { plan, living: { w: lw, d: ld }, door: openings[0] };
}

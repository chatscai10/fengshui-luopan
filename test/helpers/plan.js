// plan 測試專用: 第二來源的獨立實作。刻意不 import src/core/plan.js 與 geo.js,
// 這樣「Sutherland-Hodgman 裁切 == 有號三角形分解」與「規格內嵌數值 == 重算」才有比對意義(spec 4.2 第 6 點)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md');
export const SPEC_TEXT = readFileSync(SPEC_PATH, 'utf8');

const RAD = Math.PI / 180;
export const GUA8 = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];

// ───────────────────────────── 亂數與形狀 ─────────────────────────────

/** 固定種子亂數,讓屬性測試可重現。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng, lo, hi) => lo + (hi - lo) * rng();

export const rectPoly = (x0, y0, w, d) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];

/** 規格 2.7.2 的 L 型範例,重心 (2.5,2.5)、外框中心 (3,3)。 */
export const L_SHAPE = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
/** U 型: 重心 (3, 76/28) 落在兩臂之間的缺口,即牆外。 */
export const U_SHAPE = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
/** 凸字型(T 型)。 */
export const T_SHAPE = [[0, 0], [9, 0], [9, 3], [6, 3], [6, 6], [3, 6], [3, 3], [0, 3]];

/** 以 (cx,cy) 為核心的星形多邊形(必為簡單多邊形),n≥5。 */
export function randomStarPolygon(rng, n, cx, cy) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const th = (2 * Math.PI * (i + range(rng, -0.35, 0.35))) / n;
    const r = range(rng, 2, 9);
    pts.push([cx + r * Math.sin(th), cy + r * Math.cos(th)]);
  }
  return pts;
}

export const translate = (poly, dx, dy) => poly.map(([x, y]) => [x + dx, y + dy]);
export const scale = (poly, s) => poly.map(([x, y]) => [x * s, y * s]);
/** 順時針旋轉 deg 度(平面座標 x 右 y 上): 向量的「自上順時針角」增加 deg。 */
export function rotateCW(poly, deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
}
export const reversed = (poly) => [...poly].reverse();
export const rotateStart = (poly, k) => [...poly.slice(k), ...poly.slice(0, k)];

/** 以最簡欄位組出合法平面圖。 */
export function makePlan({ outline, rooms, planUpBearing = 0, taiji, openings, walls, mainDoor } = {}) {
  const plan = {
    version: 1,
    unit: 'm',
    planUpBearing,
    outline,
    rooms: rooms ?? [{ id: 'living', type: 'living', polygon: outline }],
  };
  if (openings) plan.openings = openings;
  if (walls) plan.walls = walls;
  if (mainDoor !== undefined) plan.mainDoor = mainDoor;
  plan.taiji = taiji ?? { mode: 'centroid', manual: null };
  return plan;
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ───────────────────────────── 獨立幾何 ─────────────────────────────

/** 有號面積(逆時針為正),以第 0 點為扇形中心分解,與實作的相對座標公式不同。 */
export function signedArea(poly) {
  let s = 0;
  for (let i = 1; i < poly.length - 1; i += 1) {
    const ax = poly[i][0] - poly[0][0];
    const ay = poly[i][1] - poly[0][1];
    const bx = poly[i + 1][0] - poly[0][0];
    const by = poly[i + 1][1] - poly[0][1];
    s += (ax * by - ay * bx) / 2;
  }
  return s;
}

/** 獨立的面積重心(三角形分解加權平均)。 */
export function fanCentroid(poly) {
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 1; i < poly.length - 1; i += 1) {
    const a = poly[0];
    const b = poly[i];
    const c = poly[i + 1];
    const ar = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    A += ar;
    cx += (ar * (a[0] + b[0] + c[0])) / 3;
    cy += (ar * (a[1] + b[1] + c[1])) / 3;
  }
  return [cx / A, cy / A];
}

export function bboxCenter(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

const norm360 = (d) => ((d % 360) + 360) % 360;

/** 獨立的宮索引公式(規格 2.7.3 第 1 點): 向量 v 相對太極點,planUp 為平面圖上方的羅盤角。 */
export function sectorIndexOfVector(vx, vy, planUp) {
  const bearing = norm360(planUp + (Math.atan2(vx, vy) * 180) / Math.PI);
  return Math.floor(((bearing + 22.5) % 360) / 45) % 8;
}

/**
 * 精確的扇區面積(獨立於 Sutherland-Hodgman): 多邊形 P 的指示函數 = 各邊與太極點 T 形成的
 * 有號三角形之和,所以 area(P ∩ 楔形) = 各邊在楔形角度區間內的有號三角形面積和。
 * 適用任何簡單多邊形,T 可在形內、形外或邊上。
 * @returns {number[]} 長度 8,依 GUA 順序
 */
export function oracleSectorAreas(poly, T, planUpDeg) {
  const out = new Array(8).fill(0);
  const orient = Math.sign(signedArea(poly));
  // 楔形邊界在平面上的「自上順時針角」
  const bounds = GUA8.map((_, j) => norm360(45 * j - 22.5 - planUpDeg));
  for (let i = 0; i < poly.length; i += 1) {
    const A = [poly[i][0] - T[0], poly[i][1] - T[1]];
    const B = [poly[(i + 1) % poly.length][0] - T[0], poly[(i + 1) % poly.length][1] - T[1]];
    const cr = A[0] * B[1] - A[1] * B[0];
    if (Math.abs(cr) < 1e-14) continue; // 邊通過或退化於太極點,三角形面積為 0
    const dot = A[0] * B[0] + A[1] * B[1];
    const sweep = (-Math.atan2(cr, dot) * 180) / Math.PI; // 順時針為正,(-180,180)
    const sgn = Math.sign(sweep);
    const total = Math.abs(sweep);
    const phiA = norm360((Math.atan2(A[0], A[1]) * 180) / Math.PI);
    const cuts = [];
    for (const b of bounds) {
      const t = sgn > 0 ? norm360(b - phiA) : norm360(phiA - b);
      if (t > 1e-12 && t < total - 1e-12) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    const ts = [0, ...cuts, total];
    const hit = (t) => {
      if (t === 0) return A;
      if (t === total) return B;
      const phi = (phiA + sgn * t) * RAD;
      const u = [Math.sin(phi), Math.cos(phi)];
      const d = [B[0] - A[0], B[1] - A[1]];
      const k = -(u[0] * A[1] - u[1] * A[0]) / (u[0] * d[1] - u[1] * d[0]);
      return [A[0] + k * d[0], A[1] + k * d[1]];
    };
    for (let s = 0; s < ts.length - 1; s += 1) {
      const P1 = hit(ts[s]);
      const P2 = hit(ts[s + 1]);
      const tri = (P1[0] * P2[1] - P1[1] * P2[0]) / 2;
      const midPhi = phiA + (sgn * (ts[s] + ts[s + 1])) / 2;
      const v = [Math.sin(midPhi * RAD), Math.cos(midPhi * RAD)];
      out[sectorIndexOfVector(v[0], v[1], planUpDeg)] += tri;
    }
  }
  return out.map((v) => v * orient);
}

/** 粗算對照: 網格取樣(偶奇規則判內外),只用來驗證上面的精確 oracle 本身。 */
export function gridSectorAreas(poly, T, planUpDeg, n = 700) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const d = Math.max(...ys) - y0;
  const h = Math.max(w, d) / n;
  const out = new Array(8).fill(0);
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let ix = 0; ix < Math.ceil(w / h); ix += 1) {
    for (let iy = 0; iy < Math.ceil(d / h); iy += 1) {
      const x = x0 + (ix + 0.5) * h;
      const y = y0 + (iy + 0.5) * h;
      if (inside(x, y)) out[sectorIndexOfVector(x - T[0], y - T[1], planUpDeg)] += h * h;
    }
  }
  return out;
}

// ───────────────────────────── 由規格文字解析內嵌數值 ─────────────────────────────

const PAIR = /([坎艮震巽離坤兌乾]) (\d+\.\d+)/g;

/** 規格 2.7.3 第 4 點的面積範例,依段落回傳。 */
export function parseSpecAreaExamples(specText = SPEC_TEXT) {
  const line = specText.split('\n').find((l) => l.startsWith('4. 面積計算範例'));
  if (!line) throw new Error('找不到規格 2.7.3 第 4 點');
  const parts = line.split('。');
  const byGua = (s) => {
    const o = {};
    for (const m of s.matchAll(PAIR)) o[m[1]] = Number(m[2]);
    return o;
  };
  const total = (s) => Number(/總和 (\d+(?:\.\d+)?)/.exec(s)?.[1]);
  const sq = /四正宮 (\d+\.\d+)、四隅宮 (\d+\.\d+)/.exec(parts[2]);
  return {
    rect0: { areas: byGua(parts[0]), total: total(parts[0]) },
    rect30: { areas: byGua(parts[1]), total: total(parts[1]) },
    square: { cardinal: Number(sq[1]), diagonal: Number(sq[2]) },
    lshape: { areas: byGua(parts[3]), total: total(parts[3]) },
  };
}

/** 規格 2.7.3 的 sectorShares 輸出範例(JSON 區塊)。 */
export function parseSpecSharesExample(specText = SPEC_TEXT) {
  const m = /```json\n(\{ "taiji": \[5, 4\][\s\S]*?)\n```/.exec(specText);
  if (!m) throw new Error('找不到規格 2.7.3 輸出範例');
  return JSON.parse(m[1]);
}

/** 規格 2.7.1 的資料結構範例。 */
export function parseSpecPlanExample(specText = SPEC_TEXT) {
  const i = specText.indexOf('#### 2.7.1 資料結構');
  const m = /```json\n([\s\S]*?)\n```/.exec(specText.slice(i));
  if (!m) throw new Error('找不到規格 2.7.1 資料結構範例');
  return JSON.parse(m[1]);
}

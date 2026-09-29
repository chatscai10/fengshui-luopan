// plan 模組獨立審查(skeptic)的隨機差分測試。
// 內含的 oracle 全部依規格 2.7 的規則獨立撰寫,不 import 實作的內部,也不複製實作演算法:
//   - 面積 = 鞋帶公式(絕對座標);重心 = 絕對座標公式
//   - 楔形面積 = 「把每條邊切在兩條扇區線上,逐段以中點的極角判定是否落入楔形,再累加原點-邊三角形有號面積」
//     (實作是 Sutherland-Hodgman 半平面裁切,兩者演算法不同)
//   - 多邊形是否簡單 = 整數座標下的精確線段相碰判定
// 亂數固定種子(mulberry32),失敗時可重現。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSimplePolygon, polygonArea, polygonCentroid, pointInPolygon, validatePlan, assertValidPlan,
  taijiPoint, sectorOfPoint, sectorShares, openingCenter, sectorOfOpening, convertPlanNorth,
} from '../../src/core/plan.js';

const GUA = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
const DIR8 = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const DEG = 180 / Math.PI;

// ───────────────────────────── 亂數 ─────────────────────────────
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
const R = (rng, lo, hi) => lo + (hi - lo) * rng();
const RI = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// ───────────────────────────── 形狀產生器 ─────────────────────────────
const rectPoly = (x0, y0, w, d) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];
const L_SHAPE = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
const U_SHAPE = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
const T_SHAPE = [[0, 0], [9, 0], [9, 3], [6, 3], [6, 6], [3, 6], [3, 3], [0, 3]];

function starPoly(rng, n) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const th = (2 * Math.PI * (i + R(rng, -0.35, 0.35))) / n;
    const r = R(rng, 1.5, 9);
    pts.push([r * Math.sin(th), r * Math.cos(th)]);
  }
  return pts;
}

/** 直方圖多邊形(凹,正交)與其欄位矩形(恰好無縫拆分外框)。 */
function histogram(rng) {
  const cols = RI(rng, 2, 6);
  const xs = [0];
  const hs = [];
  for (let i = 0; i < cols; i += 1) {
    xs.push(xs[i] + R(rng, 0.8, 4));
    hs.push(R(rng, 0.8, 6));
  }
  const poly = [[0, 0], [xs[cols], 0]];
  for (let i = cols - 1; i >= 0; i -= 1) {
    poly.push([xs[i + 1], hs[i]]);
    poly.push([xs[i], hs[i]]);
  }
  const rects = hs.map((h, i) => rectPoly(xs[i], 0, xs[i + 1] - xs[i], h));
  return { poly, rects };
}

const rotCW = (poly, deg) => {
  const c = Math.cos(deg / DEG);
  const s = Math.sin(deg / DEG);
  return poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
};
const shift = (poly, dx, dy) => poly.map(([x, y]) => [x + dx, y + dy]);
const scaleP = (poly, k) => poly.map(([x, y]) => [x * k, y * k]);

/** 隨機簡單多邊形;回傳 {poly, parts}(parts 為可選的無縫拆分)。 */
function genShape(rng) {
  const kind = RI(rng, 0, 6);
  let poly;
  let parts = null;
  switch (kind) {
    case 0: poly = rectPoly(0, 0, R(rng, 1, 12), R(rng, 1, 12)); break;
    case 1: poly = starPoly(rng, RI(rng, 3, 25)); break;
    case 2: { const h = histogram(rng); poly = h.poly; parts = h.rects; break; }
    case 3: poly = pick(rng, [L_SHAPE, U_SHAPE, T_SHAPE]).map((p) => [...p]); break;
    case 4: { const h = histogram(rng); const a = R(rng, -180, 360); poly = rotCW(h.poly, a); parts = h.rects.map((r) => rotCW(r, a)); break; }
    case 5: poly = rectPoly(0, 0, R(rng, 0.01, 0.2), R(rng, 5, 30)); break; // 細長
    default: poly = starPoly(rng, RI(rng, 6, 60)); break;
  }
  const k = pick(rng, [1, 1, 1, 0.001, 1000, R(rng, 0.2, 5)]);
  const dx = pick(rng, [0, 0, R(rng, -20, 20), R(rng, -1e5, 1e5)]);
  const dy = pick(rng, [0, 0, R(rng, -20, 20), R(rng, -1e5, 1e5)]);
  const tf = (pl) => shift(scaleP(pl, k), dx * k, dy * k);
  poly = tf(poly);
  if (parts) parts = parts.map(tf);
  if (rng() < 0.5) poly.reverse();
  if (rng() < 0.5) { const s = RI(rng, 0, poly.length - 1); poly = [...poly.slice(s), ...poly.slice(0, s)]; }
  if (rng() < 0.15) poly.push([...poly[0]]); // 首尾重複
  if (rng() < 0.15) { const i = RI(rng, 0, poly.length - 1); poly.splice(i, 0, [...poly[i]]); } // 連續重複
  return { poly, parts, scale: k };
}

// ───────────────────────────── Oracle ─────────────────────────────
const dedupe = (poly) => {
  const r = [];
  for (const p of poly) if (!r.length || r[r.length - 1][0] !== p[0] || r[r.length - 1][1] !== p[1]) r.push(p);
  while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
};
// 座標可能平移到 1e5 再縮放 1000,先平移到外接框左下角避免 oracle 自己的浮點抵消
const toLocal = (poly) => {
  const mx = Math.min(...poly.map((p) => p[0]));
  const my = Math.min(...poly.map((p) => p[1]));
  return poly.map(([x, y]) => [x - mx, y - my]);
};
const area2 = (poly) => {
  const q = toLocal(poly);
  let s = 0;
  for (let i = 0; i < q.length; i += 1) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % q.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
};
const oracleArea = (poly) => Math.abs(area2(dedupe(poly))) / 2;
function oracleCentroid(poly) {
  const p0 = dedupe(poly);
  const mx = Math.min(...p0.map((q) => q[0]));
  const my = Math.min(...p0.map((q) => q[1]));
  const p = toLocal(p0);
  const a = area2(p);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length; i += 1) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const c = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  return [mx + cx / (3 * a), my + cy / (3 * a)];
}
const oracleBBox = (poly) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

const mod = (a, n) => ((a % n) + n) % n;
/** 以「逐宮檢查半開區間」判定,不用實作的 floor 公式。 */
function oracleGuaOfBearing(b) {
  const nb = mod(b, 360);
  for (let k = 0; k < 8; k += 1) {
    const d = mod(nb - 45 * k + 180, 360) - 180; // [-180,180)
    if (d >= -22.5 && d < 22.5) return k;
  }
  throw new Error('oracle: 找不到宮');
}
function oracleLocate(pt, T, planUp, uncertainty) {
  const vx = pt[0] - T[0];
  const vy = pt[1] - T[1];
  if (Math.hypot(vx, vy) < 1e-9) return null;
  const bearing = mod(planUp + Math.atan2(vx, vy) * DEG, 360);
  const k = oracleGuaOfBearing(bearing);
  const dev = mod(bearing - 45 * k + 180, 360) - 180;
  const boundaryDeg = 22.5 - Math.abs(dev);
  return { k, bearing, boundaryDeg, borderline: boundaryDeg < uncertainty };
}

/** 楔形面積 oracle: 邊在兩條扇區線上切段,逐段以中點極角判定。 */
function oracleShares(poly, T, planUp) {
  const p = dedupe(poly).map(([x, y]) => [x - T[0], y - T[1]]);
  const sign = area2(p) >= 0 ? 1 : -1;
  const out = [];
  for (let k = 0; k < 8; k += 1) {
    const lo = 45 * k - 22.5 - planUp; // 平面圖上「自上順時針」角
    let total = 0;
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const ts = [0, 1];
      for (const ang of [lo, lo + 45]) {
        const dx = Math.sin(ang / DEG);
        const dy = Math.cos(ang / DEG);
        const ca = dx * a[1] - dy * a[0];
        const cb = dx * b[1] - dy * b[0];
        if (ca !== cb) {
          const t = ca / (ca - cb);
          if (t > 0 && t < 1) ts.push(t);
        }
      }
      ts.sort((u, v) => u - v);
      for (let j = 0; j + 1 < ts.length; j += 1) {
        const P0 = [a[0] + ts[j] * (b[0] - a[0]), a[1] + ts[j] * (b[1] - a[1])];
        const P1 = [a[0] + ts[j + 1] * (b[0] - a[0]), a[1] + ts[j + 1] * (b[1] - a[1])];
        const m = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
        if (Math.hypot(m[0], m[1]) < 1e-300) continue;
        const phi = mod(Math.atan2(m[0], m[1]) * DEG - lo, 360);
        if (phi < 45) total += (P0[0] * P1[1] - P1[0] * P0[1]) / 2;
      }
    }
    out.push(Math.abs(total * sign));
  }
  return out;
}

// 整數座標的精確簡單多邊形判定
const orientI = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const inBoxI = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
function touchI(a, b, c, d) {
  const o1 = Math.sign(orientI(a, b, c));
  const o2 = Math.sign(orientI(a, b, d));
  const o3 = Math.sign(orientI(c, d, a));
  const o4 = Math.sign(orientI(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && inBoxI(a, b, c)) || (o2 === 0 && inBoxI(a, b, d)) || (o3 === 0 && inBoxI(c, d, a)) || (o4 === 0 && inBoxI(c, d, b));
}
function oracleValidInt(poly) {
  const r = dedupe(poly);
  const n = r.length;
  if (n < 3) return false;
  if (r.every((p) => orientI(r[0], r[1], p) === 0) && r.every((p) => orientI(r[0], r.find((q) => q[0] !== r[0][0] || q[1] !== r[0][1]), p) === 0)) return false;
  for (let i = 0; i < n; i += 1) {
    const prev = r[(i + n - 1) % n];
    const cur = r[i];
    const next = r[(i + 1) % n];
    // 相鄰邊折返(共線且同向)
    if (orientI(prev, cur, next) === 0 && (prev[0] - cur[0]) * (next[0] - cur[0]) + (prev[1] - cur[1]) * (next[1] - cur[1]) > 0) return false;
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (touchI(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
  }
  return area2(r) !== 0;
}

/** 整數(或半整數,乘 2 後為整數)座標的點與多邊形關係。 */
function oracleClassifyInt(poly, pt) {
  const r = dedupe(poly);
  const n = r.length;
  for (let i = 0; i < n; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % n];
    if (orientI(a, b, pt) === 0 && inBoxI(a, b, pt)) return 'boundary';
  }
  let wn = 0;
  for (let i = 0; i < n; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % n];
    if (a[1] <= pt[1]) {
      if (b[1] > pt[1] && orientI(a, b, pt) > 0) wn += 1;
    } else if (b[1] <= pt[1] && orientI(a, b, pt) < 0) wn -= 1;
  }
  return wn !== 0 ? 'inside' : 'outside';
}

// ───────────────────────────── 共用比對 ─────────────────────────────
const tolA = (total) => 1e-9 * Math.max(1, total);
function planOf({ outline, rooms, planUpBearing = 0, taiji, openings, mainDoor }) {
  const plan = { version: 1, unit: 'm', planUpBearing, outline, rooms: rooms ?? [{ id: 'living', type: 'living', polygon: outline }] };
  if (openings) plan.openings = openings;
  if (mainDoor !== undefined) plan.mainDoor = mainDoor;
  if (taiji) plan.taiji = taiji;
  return plan;
}
function throwsCode(fn, code) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof Error, 'must throw Error');
    assert.ok(e.message.startsWith(`${code}:`), `期望錯誤碼 ${code},實際訊息: ${e.message}`);
    return;
  }
  assert.fail(`期望丟出 ${code},但沒有丟`);
}
const SPECIAL_PLANUP = [0, -0, 7.5, 15, 22.5, 30, 45, 67.5, 90, 180, 337.5, 359.999999, 360, 720, -22.5, -30, -360, 1e6, -1e6, 1e12, 1234.5678];
const genPlanUp = (rng) => (rng() < 0.5 ? pick(rng, SPECIAL_PLANUP) : R(rng, -800, 800));

// mutation 用: 比對函式回傳是否吻合
function sharesMatch(actualBy8, expectedBy8, total) {
  return actualBy8.every((v, i) => Math.abs(v - expectedBy8[i]) <= tolA(total));
}

// ═══════════════════════════ 測試 ═══════════════════════════

describe('規格 2.7.3 數值範例(獨立重算 + 規格文字)', () => {
  const cases = [
    { name: '10x8 planUp=0', poly: rectPoly(0, 0, 10, 8), up: 0, exp: { 坎: 6.627417, 艮: 11.508622, 震: 10.355339, 巽: 11.508622, 離: 6.627417, 坤: 11.508622, 兌: 10.355339, 乾: 11.508622 } },
    { name: '10x8 planUp=30', poly: rectPoly(0, 0, 10, 8), up: 30, exp: { 坎: 9.355193, 艮: 7.191836, 震: 12.215728, 巽: 11.237244, 離: 9.355193, 坤: 7.191836, 兌: 12.215728, 乾: 11.237244 } },
    { name: '8x8', poly: rectPoly(0, 0, 8, 8), up: 0, exp: { 坎: 6.627417, 艮: 9.372583, 震: 6.627417, 巽: 9.372583, 離: 6.627417, 坤: 9.372583, 兌: 6.627417, 乾: 9.372583 } },
    { name: 'L 型', poly: L_SHAPE, up: 0, exp: { 坎: 3.985281, 艮: 0.353553, 震: 3.985281, 巽: 4.918525, 離: 2.588835, 坤: 3.661165, 兌: 2.588835, 乾: 4.918525 } },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const r = sectorShares(planOf({ outline: c.poly, planUpBearing: c.up }));
      const total = oracleArea(c.poly);
      const orc = oracleShares(c.poly, oracleCentroid(c.poly), c.up);
      GUA.forEach((g, k) => {
        assert.ok(Math.abs(r.palaceArea[g] - c.exp[g]) < 5e-7, `${c.name} ${g}: ${r.palaceArea[g]} vs 規格 ${c.exp[g]}`);
        assert.ok(Math.abs(r.palaceArea[g] - orc[k]) <= tolA(total), `${c.name} ${g} oracle ${orc[k]} vs ${r.palaceArea[g]}`);
      });
      assert.ok(Math.abs(Object.values(r.palaceArea).reduce((a, b) => a + b, 0) - total) <= tolA(total));
    });
  }
  test('L 型重心 (2.5,2.5)、外框中心 (3,3)', () => {
    const c = polygonCentroid(L_SHAPE);
    assert.ok(Math.abs(c[0] - 2.5) < 1e-12 && Math.abs(c[1] - 2.5) < 1e-12, String(c));
    const b = taijiPoint(planOf({ outline: L_SHAPE, taiji: { mode: 'bbox', manual: null } }));
    assert.deepEqual(b.point, [3, 3]);
  });
  test('突變: 錯誤的期望值(planUp 差 1 度、或某宮差 1e-6)會被比對函式抓出', () => {
    const poly = rectPoly(0, 0, 10, 8);
    const T = oracleCentroid(poly);
    const act = oracleShares(poly, T, 30);
    assert.ok(sharesMatch(act, oracleShares(poly, T, 30), 80));
    assert.ok(!sharesMatch(act, oracleShares(poly, T, 31), 80), 'planUp 差 1 度應被抓到');
    const bad = [...act];
    bad[3] += 1e-6;
    assert.ok(!sharesMatch(act, bad, 80), '差 1e-6 應被抓到');
    const impl = sectorShares(planOf({ outline: poly, planUpBearing: 30 }));
    const implArr = GUA.map((g) => impl.palaceArea[g]);
    assert.ok(!sharesMatch(implArr, oracleShares(poly, T, 31), 80), '實作與錯誤 oracle 應不一致');
  });
});

describe('isSimplePolygon 與整數精確 oracle 差分(20000 組退化多邊形)', () => {
  test('隨機整數多邊形', () => {
    const rng = mulberry32(20260929);
    let valid = 0;
    for (let it = 0; it < 20000; it += 1) {
      const n = RI(rng, 1, 9);
      const poly = Array.from({ length: n }, () => [RI(rng, 0, 4), RI(rng, 0, 4)]);
      if (rng() < 0.2) poly.push([...poly[0]]);
      const exp = oracleValidInt(poly);
      const act = isSimplePolygon(poly);
      if (exp) valid += 1;
      assert.equal(act, exp, `多邊形 ${JSON.stringify(poly)} oracle=${exp} 實作=${act}`);
      if (!exp) throwsCode(() => polygonArea(poly), 'INVALID_PLAN');
      else assert.equal(polygonArea(poly), oracleArea(poly));
    }
    assert.ok(valid > 500, `合法樣本太少: ${valid}`);
  });
  test('較大整數格點 (0..8) 的隨機多邊形', () => {
    const rng = mulberry32(777);
    for (let it = 0; it < 8000; it += 1) {
      const n = RI(rng, 3, 12);
      const poly = Array.from({ length: n }, () => [RI(rng, 0, 8), RI(rng, 0, 8)]);
      assert.equal(isSimplePolygon(poly), oracleValidInt(poly), JSON.stringify(poly));
    }
  });
});

describe('pointInPolygon 與整數 oracle 差分', () => {
  test('隨機簡單多邊形 × 半整數點', () => {
    const rng = mulberry32(31337);
    let n = 0;
    for (let it = 0; it < 6000 && n < 3000; it += 1) {
      const poly = Array.from({ length: RI(rng, 3, 8) }, () => [RI(rng, 0, 6) * 2, RI(rng, 0, 6) * 2]);
      if (!oracleValidInt(poly)) continue;
      n += 1;
      for (let q = 0; q < 6; q += 1) {
        const pt = [RI(rng, -1, 13), RI(rng, -1, 13)];
        assert.equal(pointInPolygon(poly, pt), oracleClassifyInt(poly, pt), `${JSON.stringify(poly)} ${JSON.stringify(pt)}`);
      }
    }
    assert.ok(n >= 500);
  });
});

describe('sectorShares 對 oracle 差分與屬性(隨機形狀、隨機 planUp、三種太極點)', () => {
  test('面積 == oracle、守恆、決定性、JSON 可序列化、不改輸入', () => {
    const rng = mulberry32(424242);
    let worst = 0;
    for (let it = 0; it < 1500; it += 1) {
      const { poly, parts } = genShape(rng);
      const up = genPlanUp(rng);
      const mode = pick(rng, ['centroid', 'centroid', 'bbox', 'manual']);
      let taiji = { mode, manual: null };
      const bb = oracleBBox(poly);
      const extent = Math.max(1, Math.abs(Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]))));
      if (mode === 'manual') {
        const r0 = rng();
        const m = r0 < 0.25 ? [...pick(rng, poly)] : r0 < 0.5 ? [bb[0] + R(rng, -extent * 2, extent * 2), bb[1] + R(rng, -extent * 2, extent * 2)] : [bb[0] + R(rng, -extent / 3, extent / 3), bb[1] + R(rng, -extent / 3, extent / 3)];
        taiji = { mode, manual: m };
      }
      const rooms = parts && rng() < 0.7
        ? parts.map((pl, i) => ({ id: `r${i}`, type: 'other', polygon: pl }))
        : [{ id: 'living', type: 'living', polygon: poly }];
      const plan = planOf({ outline: poly, rooms, planUpBearing: up, taiji });
      deepFreeze(plan);
      const r = sectorShares(plan);
      const again = sectorShares(plan);
      assert.deepEqual(again, r, '同輸入必須同輸出');
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r, `輸出必須 JSON 往返不變(含 -0/NaN/undefined 檢查) it=${it}`);

      const T = mode === 'centroid' ? oracleCentroid(poly) : mode === 'bbox' ? bb : taiji.manual;
      const total = oracleArea(poly);
      const tol = tolA(total) * (mode === 'manual' ? 10 : 1);
      assert.ok(Math.abs(r.taiji[0] - T[0]) <= 1e-9 * Math.max(1, Math.abs(T[0])) && Math.abs(r.taiji[1] - T[1]) <= 1e-9 * Math.max(1, Math.abs(T[1])), `太極點 ${r.taiji} vs ${T} it=${it}`);
      // 房間拆分無縫時,各房間合計 == 外框單一房間
      const orc = oracleShares(poly, r.taiji, mod(up, 360));
      GUA.forEach((g, k) => {
        const d = Math.abs(r.palaceArea[g] - orc[k]);
        worst = Math.max(worst, d / Math.max(1, total));
        assert.ok(d <= tol, `it=${it} 宮 ${g}: 實作 ${r.palaceArea[g]} oracle ${orc[k]} 差 ${d}(shape=${JSON.stringify(poly)} up=${up} taiji=${JSON.stringify(taiji)})`);
      });
      const sum = GUA.reduce((s, g) => s + r.palaceArea[g], 0);
      assert.ok(Math.abs(sum - oracleArea(poly)) <= tol, `面積守恆 it=${it}: ${sum} vs ${oracleArea(poly)}`);
      assert.ok(Math.abs(r.totalArea - oracleArea(poly)) <= tol);
      // palaces/mainUse 結構
      for (const g of GUA) {
        const list = r.palaces[g];
        let pctSum = 0;
        for (let i = 0; i < list.length; i += 1) {
          pctSum += list[i].pct;
          if (i > 0) assert.ok(list[i - 1].area >= list[i].area - 1e-9 * Math.max(1, total), '面積由大到小');
          assert.ok(Math.abs(list[i].area - r.shares[list[i].roomId][g]) <= 1e-15 * Math.max(1, total) + 1e-12);
        }
        if (list.length) {
          assert.ok(Math.abs(pctSum - 1) < 1e-9, `pct 和 ${pctSum}`);
          assert.equal(r.mainUse[g], list[0].roomId);
        } else assert.equal(r.mainUse[g], null);
      }
    }
    assert.ok(worst < 1e-9, `最大相對誤差 ${worst}`);
  });

  test('旋轉等變: planUp+45 → 各宮面積循環位移一格(宮 k 的面積移到 k+1)', () => {
    const rng = mulberry32(99);
    for (let it = 0; it < 800; it += 1) {
      const { poly } = genShape(rng);
      const up = genPlanUp(rng);
      const total = oracleArea(poly);
      const a = sectorShares(planOf({ outline: poly, planUpBearing: up })).palaceArea;
      const b = sectorShares(planOf({ outline: poly, planUpBearing: up + 45 })).palaceArea;
      GUA.forEach((g, k) => assert.ok(Math.abs(b[GUA[(k + 1) % 8]] - a[g]) <= tolA(total) * 5, `it=${it} ${g}`));
    }
  });

  test('整體旋轉: 多邊形順時針轉 α、planUp 減 α → 各宮面積不變', () => {
    const rng = mulberry32(555);
    for (let it = 0; it < 600; it += 1) {
      const { poly } = genShape(rng);
      const up = R(rng, 0, 360);
      const alpha = R(rng, -270, 270);
      const total = oracleArea(poly);
      const a = sectorShares(planOf({ outline: poly, planUpBearing: up })).palaceArea;
      const b = sectorShares(planOf({ outline: rotCW(poly, alpha), planUpBearing: up - alpha })).palaceArea;
      GUA.forEach((g) => assert.ok(Math.abs(a[g] - b[g]) <= tolA(total) * 20, `it=${it} ${g}: ${a[g]} vs ${b[g]}`));
    }
  });

  test('平移/縮放/順逆時針/起點輪替 不影響 pct 與宮面積比例', () => {
    const rng = mulberry32(2024);
    for (let it = 0; it < 500; it += 1) {
      const { poly } = genShape(rng);
      const up = genPlanUp(rng);
      const base = sectorShares(planOf({ outline: poly, planUpBearing: up }));
      const k = R(rng, 0.1, 10);
      const variants = [
        scaleP(poly, k),
        [...poly].reverse(),
        [...poly.slice(2), ...poly.slice(0, 2)],
      ];
      for (const v of variants) {
        const s = sectorShares(planOf({ outline: v, planUpBearing: up }));
        const ratio = s.totalArea / base.totalArea;
        GUA.forEach((g) => assert.ok(Math.abs(s.palaceArea[g] / s.totalArea - base.palaceArea[g] / base.totalArea) < 1e-8, `it=${it} ${g}`));
        assert.ok(Math.abs(s.taiji[0] * 0 + ratio - ratio) === 0);
      }
    }
  });

  test('鏡射: x→-x 且 planUp→-planUp,宮 k ↔ 宮 -k', () => {
    const rng = mulberry32(8080);
    for (let it = 0; it < 500; it += 1) {
      const { poly } = genShape(rng);
      const up = R(rng, -400, 400);
      const total = oracleArea(poly);
      const a = sectorShares(planOf({ outline: poly, planUpBearing: up })).palaceArea;
      const b = sectorShares(planOf({ outline: poly.map(([x, y]) => [-x, y]), planUpBearing: -up })).palaceArea;
      GUA.forEach((g, k) => assert.ok(Math.abs(a[g] - b[GUA[(8 - k) % 8]]) <= tolA(total) * 5, `it=${it} ${g}`));
    }
  });

  test('矩形: 太極點 = 外框中心;正方形 planUp 為 90 倍數時四正宮相等、四隅宮相等', () => {
    const rng = mulberry32(1);
    for (let it = 0; it < 400; it += 1) {
      const x0 = R(rng, -50, 50);
      const y0 = R(rng, -50, 50);
      const w = R(rng, 0.5, 20);
      const d = R(rng, 0.5, 20);
      const poly = rectPoly(x0, y0, w, d);
      const c = taijiPoint(planOf({ outline: poly })).point;
      assert.ok(Math.abs(c[0] - (x0 + w / 2)) < 1e-9 && Math.abs(c[1] - (y0 + d / 2)) < 1e-9);
      const s = R(rng, 1, 15);
      const sq = rectPoly(x0, y0, s, s);
      for (const up of [0, 90, 180, 270, -90, 450]) {
        const p = sectorShares(planOf({ outline: sq, planUpBearing: up })).palaceArea;
        const eps = 1e-9 * s * s;
        for (const i of [0, 2, 4, 6]) assert.ok(Math.abs(p[GUA[i]] - p['坎']) <= eps, `四正 ${up}`);
        for (const i of [1, 3, 5, 7]) assert.ok(Math.abs(p[GUA[i]] - p['艮']) <= eps, `四隅 ${up}`);
      }
    }
  });

  test('房間可跨宮、重疊外的房間(陽台)照算,totalArea 含陽台、outlineArea 不含', () => {
    const outline = rectPoly(0, 0, 8, 6);
    const balcony = rectPoly(8, 0, 2, 6);
    const plan = planOf({ outline, rooms: [{ id: 'a', type: 'living', polygon: outline }, { id: 'b', type: 'balcony', polygon: balcony }], planUpBearing: 17 });
    const r = sectorShares(plan);
    assert.ok(Math.abs(r.totalArea - 60) < 1e-9);
    assert.ok(Math.abs(r.outlineArea - 48) < 1e-9);
    const orcB = oracleShares(balcony, r.taiji, 17);
    GUA.forEach((g, k) => assert.ok(Math.abs(r.shares.b[g] - orcB[k]) < 1e-9));
  });

  test('房間 id 為 constructor / toString / 純數字 / hasOwnProperty 不出錯', () => {
    const outline = rectPoly(0, 0, 4, 4);
    const ids = ['constructor', 'toString', 'hasOwnProperty', '0', '1', 'valueOf', 'prototype'];
    const rooms = ids.map((id, i) => ({ id, type: 'other', polygon: rectPoly(i * 4 / ids.length, 0, 4 / ids.length, 4) }));
    const r = sectorShares(planOf({ outline, rooms, planUpBearing: 5 }));
    for (const id of ids) assert.ok(Object.hasOwn(r.shares, id) && Object.hasOwn(r.roomAreas, id), id);
    assert.ok(Math.abs(GUA.reduce((s, g) => s + r.palaceArea[g], 0) - 16) < 1e-9);
    throwsCode(() => sectorShares(planOf({ outline, rooms: [{ id: '__proto__', type: 'other', polygon: outline }] })), 'INVALID_PLAN');
  });

  test('沒有房間 → 以外框當單一房間並回 roomsMissing;空 rooms 陣列同', () => {
    const outline = rectPoly(0, 0, 5, 3);
    for (const rooms of [undefined, []]) {
      const plan = { version: 1, planUpBearing: 10, outline };
      if (rooms) plan.rooms = rooms;
      const r = sectorShares(plan);
      assert.ok(r.warnings.includes('roomsMissing'));
      assert.ok(Math.abs(r.totalArea - 15) < 1e-12);
    }
  });

  test('planUpBearing 未知(null/undefined): 只輸出形狀,不輸出宮位', () => {
    const outline = L_SHAPE;
    for (const up of [null, undefined]) {
      const plan = { version: 1, planUpBearing: up, outline, rooms: [{ id: 'a', type: 'other', polygon: outline }] };
      const r = sectorShares(plan);
      assert.equal(r.shares, null);
      assert.equal(r.palaces, null);
      assert.equal(r.mainUse, null);
      assert.ok(Math.abs(r.totalArea - 27) < 1e-12);
      assert.ok(r.warnings.includes('planUpBearingUnknown'));
      throwsCode(() => sectorOfPoint(plan, [1, 1]), 'PLAN_UP_UNKNOWN');
    }
  });

  test('非凸: 重心在牆外 → warnings 含 taijiOutsideOutline;在牆內則不含(與 oracle 點在多邊形內判定一致)', () => {
    const rng = mulberry32(6);
    let outside = 0;
    for (let it = 0; it < 1500; it += 1) {
      const { poly } = genShape(rng);
      const c = oracleCentroid(poly);
      const oc = pointInPolygonOracleFloat(poly, c);
      const r = taijiPoint(planOf({ outline: poly }));
      if (oc === 'outside') outside += 1;
      if (oc === 'ambiguous') continue;
      assert.equal(r.warnings.includes('taijiOutsideOutline'), oc === 'outside', `it=${it} ${JSON.stringify(poly)} c=${c}`);
      const s = sectorShares(planOf({ outline: poly }));
      assert.equal(s.warnings.includes('taijiOutsideOutline'), oc === 'outside');
    }
    assert.ok(outside > 20, `牆外樣本 ${outside}`);
    // U 型必在牆外
    assert.deepEqual(taijiPoint(planOf({ outline: U_SHAPE })).warnings, ['taijiOutsideOutline']);
    // 規格例: bbox 的 L 型 (3,3) 在頂點上,算牆內
    assert.deepEqual(taijiPoint(planOf({ outline: L_SHAPE, taiji: { mode: 'bbox' } })).warnings, []);
  });
});

/** 浮點點在多邊形內: 離邊界太近回 'ambiguous'。 */
function pointInPolygonOracleFloat(poly, pt) {
  const r = dedupe(poly);
  const n = r.length;
  let minD = Infinity;
  for (let i = 0; i < n; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    minD = Math.min(minD, Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy));
  }
  const scale = Math.max(1, ...r.map((p) => Math.abs(p[0])), ...r.map((p) => Math.abs(p[1])));
  if (minD < 1e-6 * scale) return 'ambiguous';
  let wn = 0;
  for (let i = 0; i < n; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const cr = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    if (a[1] <= pt[1]) { if (b[1] > pt[1] && cr > 0) wn += 1; } else if (b[1] <= pt[1] && cr < 0) wn -= 1;
  }
  return wn !== 0 ? 'inside' : 'outside';
}

describe('sectorOfPoint 對 oracle 差分', () => {
  test('隨機點/隨機 planUp/隨機 uncertainty', () => {
    const rng = mulberry32(13);
    let borderlineCount = 0;
    for (let it = 0; it < 6000; it += 1) {
      const { poly } = genShape(rng);
      const up = genPlanUp(rng);
      const unc = pick(rng, [5, 0, 22.5, 30, R(rng, 0, 25), 1e-3]);
      const plan = planOf({ outline: poly, planUpBearing: up });
      const T = oracleCentroid(poly);
      const ext = Math.max(...poly.map((p) => Math.hypot(p[0] - T[0], p[1] - T[1])));
      const pt = [T[0] + R(rng, -1.5 * ext, 1.5 * ext), T[1] + R(rng, -1.5 * ext, 1.5 * ext)];
      const o = oracleLocate(pt, T, mod(up, 360), unc);
      const s = sectorOfPoint(plan, pt, { measureUncertainty: unc });
      if (o === null) { assert.equal(s, null); continue; }
      const nearBoundary = o.boundaryDeg < 1e-6;
      if (!nearBoundary) {
        assert.equal(s.gua, GUA[o.k], `it=${it}`);
        assert.equal(s.dir8, DIR8[o.k]);
        assert.equal(s.index, o.k);
      }
      assert.ok(Math.abs(s.boundaryDeg - o.boundaryDeg) < 1e-6 || nearBoundary, `boundaryDeg ${s.boundaryDeg} vs ${o.boundaryDeg}`);
      if (Math.abs(o.boundaryDeg - unc) > 1e-6 && !nearBoundary) {
        assert.equal(s.borderline, o.borderline, `borderline it=${it} bd=${o.boundaryDeg} unc=${unc}`);
        if (o.borderline) borderlineCount += 1;
      }
      assert.ok(s.bearing >= 0 && s.bearing < 360, `bearing 範圍 ${s.bearing}`);
      assert.ok(Object.is(s.bearing, -0) === false);
      assert.ok(s.boundaryDeg >= 0 && s.boundaryDeg <= 22.5 + 1e-12);
      assert.notEqual(s.otherGua, s.gua);
    }
    assert.ok(borderlineCount > 100);
  });

  test('恰在扇區線上 → 歸順時針下一宮(planUp 為 7.5 倍數 × 軸向點)', () => {
    const rng = mulberry32(5);
    const outline = rectPoly(-3, -2, 6, 4); // 太極點 (0,0)
    const dirs = [[0, 1, 0], [1, 0, 90], [0, -1, 180], [-1, 0, 270]];
    for (let m = -100; m <= 100; m += 1) {
      const up = m * 7.5;
      for (const [dx, dy, add] of dirs) {
        const r = rng() * 5 + 0.1;
        const b = mod(up + add, 360);
        const expected = Math.floor((b + 22.5) / 45 + 1e-12) % 8; // 7.5 倍數皆可精確表示,半開區間
        const s = sectorOfPoint(planOf({ outline, planUpBearing: up }), [dx * r, dy * r]);
        // b 恰為 22.5 的倍數時,歸下一宮
        const exactBoundary = mod(b + 22.5, 45) === 0;
        const exp = exactBoundary ? Math.floor((b + 22.5) / 45) % 8 : expected;
        assert.equal(s.index, exp, `up=${up} dir=${dx},${dy} b=${b}`);
        if (exactBoundary) assert.equal(s.boundaryDeg, 0);
      }
    }
  });

  test('點與太極點重合(< 1e-9) → null;稍遠 → 非 null', () => {
    const plan = planOf({ outline: rectPoly(0, 0, 6, 4), planUpBearing: 33 });
    assert.equal(sectorOfPoint(plan, [3, 2]), null);
    assert.equal(sectorOfPoint(plan, [3 + 5e-10, 2 - 5e-10]), null);
    assert.notEqual(sectorOfPoint(plan, [3 + 1e-6, 2]), null);
  });

  test('輸入錯誤: 點 NaN/Infinity/非陣列/長度不對、measureUncertainty 非法', () => {
    const plan = planOf({ outline: rectPoly(0, 0, 6, 4), planUpBearing: 33 });
    for (const p of [[NaN, 1], [1, Infinity], [1], [1, 2, 3], 'ab', null, undefined, {}, ['1', '2'], [-Infinity, 0]]) throwsCode(() => sectorOfPoint(plan, p), 'INVALID_POINT');
    for (const u of [NaN, -1, Infinity, '5', null]) throwsCode(() => sectorOfPoint(plan, [1, 1], { measureUncertainty: u }), 'INVALID_SETTING');
    throwsCode(() => sectorOfPoint(plan, [1, 1], { taijiMode: 'nope' }), 'INVALID_TAIJI_MODE');
  });
});

describe('太極點 taijiPoint 與 manual', () => {
  test('centroid/bbox/manual 對 oracle', () => {
    const rng = mulberry32(77);
    for (let it = 0; it < 1500; it += 1) {
      const { poly } = genShape(rng);
      const c = taijiPoint(planOf({ outline: poly })).point;
      const oc = oracleCentroid(poly);
      const sc = Math.max(1, Math.abs(oc[0]), Math.abs(oc[1]));
      assert.ok(Math.abs(c[0] - oc[0]) <= 1e-9 * sc && Math.abs(c[1] - oc[1]) <= 1e-9 * sc, `centroid it=${it}`);
      const b = taijiPoint(planOf({ outline: poly, taiji: { mode: 'bbox' } })).point;
      const ob = oracleBBox(poly);
      assert.ok(Math.abs(b[0] - ob[0]) <= 1e-9 * sc && Math.abs(b[1] - ob[1]) <= 1e-9 * sc);
      const mp = [R(rng, -5, 5), R(rng, -5, 5)];
      assert.deepEqual(taijiPoint(planOf({ outline: poly, taiji: { mode: 'manual', manual: mp } })).point, mp);
    }
  });
  test('manual 缺 manual、taiji 型別錯、未知 mode → 對應錯誤碼', () => {
    const outline = rectPoly(0, 0, 4, 4);
    throwsCode(() => taijiPoint(planOf({ outline, taiji: { mode: 'manual', manual: null } })), 'INVALID_PLAN');
    throwsCode(() => taijiPoint(planOf({ outline, taiji: { mode: 'manual', manual: [NaN, 1] } })), 'INVALID_PLAN');
    throwsCode(() => taijiPoint(planOf({ outline, taiji: { mode: 'manual', manual: [1, 2, 3] } })), 'INVALID_PLAN');
    throwsCode(() => taijiPoint(planOf({ outline, taiji: 'centroid' })), 'INVALID_PLAN');
    throwsCode(() => taijiPoint(planOf({ outline, taiji: { mode: 'weird' } })), 'INVALID_PLAN');
    throwsCode(() => taijiPoint(planOf({ outline }), { taijiMode: 'weird' }), 'INVALID_TAIJI_MODE');
    throwsCode(() => taijiPoint(planOf({ outline }), { taijiMode: 'manual' }), 'INVALID_PLAN');
    // settings.taijiMode 在 plan 沒指定 mode 時生效
    const p = { version: 1, planUpBearing: 0, outline };
    assert.equal(taijiPoint(p, { taijiMode: 'bbox' }).mode, 'bbox');
    assert.equal(taijiPoint(p).mode, 'centroid');
  });
  test('meta.ruleset 反映實際使用的設定', () => {
    const outline = rectPoly(0, 0, 4, 4);
    const r = sectorShares(planOf({ outline, taiji: { mode: 'bbox' } }), { measureUncertainty: 7, northMode: 'true' });
    assert.equal(r.meta.schema, 'fengshui.plan/1');
    assert.equal(r.meta.ruleset.taijiMode, 'bbox');
    assert.equal(r.meta.ruleset.measureUncertainty, 7);
    assert.equal(r.meta.ruleset.northMode, 'true');
    assert.equal(r.meta.northMode, 'true');
  });
});

describe('非法平面圖一律 INVALID_PLAN(不當機、不回錯誤結果)', () => {
  const sq = rectPoly(0, 0, 4, 4);
  const badPlans = {
    'null': null, '陣列': [], '數字': 5, '字串': 'x', 'undefined': undefined,
    'version 缺': { planUpBearing: 0, outline: sq },
    'version 2': { version: 2, planUpBearing: 0, outline: sq },
    'unit 非 m': { version: 1, unit: 'ft', planUpBearing: 0, outline: sq },
    'outline 缺': { version: 1, planUpBearing: 0 },
    'outline 字串': { version: 1, planUpBearing: 0, outline: 'abc' },
    'outline 空': { version: 1, planUpBearing: 0, outline: [] },
    'outline 2 點': { version: 1, planUpBearing: 0, outline: [[0, 0], [1, 1]] },
    'outline 重複點只剩 2 相異': { version: 1, planUpBearing: 0, outline: [[0, 0], [0, 0], [1, 1], [1, 1], [0, 0]] },
    'outline 共線': { version: 1, planUpBearing: 0, outline: [[0, 0], [1, 1], [2, 2], [3, 3]] },
    'outline 共線折返': { version: 1, planUpBearing: 0, outline: [[0, 0], [4, 0], [2, 0]] },
    'outline 蝴蝶結': { version: 1, planUpBearing: 0, outline: [[0, 0], [4, 4], [4, 0], [0, 4]] },
    'outline 頂點相碰(8 字)': { version: 1, planUpBearing: 0, outline: [[0, 0], [2, 2], [4, 0], [4, 4], [2, 2], [0, 4]] },
    'outline T 接觸': { version: 1, planUpBearing: 0, outline: [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]] },
    'outline 含 NaN': { version: 1, planUpBearing: 0, outline: [[0, 0], [4, NaN], [4, 4]] },
    'outline 含 Infinity': { version: 1, planUpBearing: 0, outline: [[0, 0], [4, Infinity], [4, 4]] },
    'outline 點是字串': { version: 1, planUpBearing: 0, outline: [[0, 0], ['4', 0], [4, 4]] },
    'outline 點 3 維': { version: 1, planUpBearing: 0, outline: [[0, 0, 0], [4, 0, 0], [4, 4, 0]] },
    'outline 點是 null': { version: 1, planUpBearing: 0, outline: [[0, 0], null, [4, 4]] },
    'outline 面積極小': { version: 1, planUpBearing: 0, outline: [[0, 0], [1, 0], [1, 1e-12]] },
    'planUp NaN': { version: 1, planUpBearing: NaN, outline: sq },
    'planUp Infinity': { version: 1, planUpBearing: Infinity, outline: sq },
    'planUp 字串': { version: 1, planUpBearing: '30', outline: sq },
    'planUp 物件': { version: 1, planUpBearing: {}, outline: sq },
    'room id 空': { version: 1, planUpBearing: 0, outline: sq, rooms: [{ id: '', type: 'living', polygon: sq }] },
    'room id 重複': { version: 1, planUpBearing: 0, outline: sq, rooms: [{ id: 'a', type: 'living', polygon: sq }, { id: 'a', type: 'living', polygon: sq }] },
    'room type 未知': { version: 1, planUpBearing: 0, outline: sq, rooms: [{ id: 'a', type: 'garage', polygon: sq }] },
    'room polygon 自交': { version: 1, planUpBearing: 0, outline: sq, rooms: [{ id: 'a', type: 'living', polygon: [[0, 0], [4, 4], [4, 0], [0, 4]] }] },
    'rooms 非陣列': { version: 1, planUpBearing: 0, outline: sq, rooms: {} },
    'room 非物件': { version: 1, planUpBearing: 0, outline: sq, rooms: [null] },
  };
  for (const [name, plan] of Object.entries(badPlans)) {
    test(name, () => {
      throwsCode(() => sectorShares(plan), 'INVALID_PLAN');
      // taijiPoint 只驗外框層,房間問題不在其責任內
      if (!/^rooms? /.test(name)) throwsCode(() => taijiPoint(plan), 'INVALID_PLAN');
      const v = validatePlan(plan);
      assert.equal(v.ok, false);
      assert.ok(v.errors.length > 0 && v.errors.every((e) => e.code === 'INVALID_PLAN'));
      throwsCode(() => assertValidPlan(plan), 'INVALID_PLAN');
      // sectorOfPoint 只驗外框層;仍必須在外框壞時丟 INVALID_PLAN
      if (!name.startsWith('room')) throwsCode(() => sectorOfPoint(plan, [1, 1]), 'INVALID_PLAN');
    });
  }
  test('稀疏陣列(空洞)也是 INVALID_PLAN 而不是 TypeError', () => {
    const hole = [[0, 0], , [4, 4], [0, 4]]; // eslint-disable-line no-sparse-arrays
    throwsCode(() => polygonArea(hole), 'INVALID_PLAN');
    throwsCode(() => sectorShares({ version: 1, planUpBearing: 0, outline: hole }), 'INVALID_PLAN');
    assert.equal(validatePlan({ version: 1, planUpBearing: 0, outline: sq, rooms: [,] }).ok, false); // eslint-disable-line no-sparse-arrays
    assert.equal(validatePlan({ version: 1, planUpBearing: 0, outline: sq, openings: [,] }).ok, false); // eslint-disable-line no-sparse-arrays
    assert.equal(validatePlan({ version: 1, planUpBearing: 0, outline: sq, walls: [,] }).ok, false); // eslint-disable-line no-sparse-arrays
  });
  test('polygonArea/polygonCentroid 對垃圾輸入丟 INVALID_PLAN', () => {
    for (const p of [undefined, null, 5, 'abc', [], [[0, 0]], [[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 0], [NaN, 1]]]) {
      throwsCode(() => polygonArea(p), 'INVALID_PLAN');
      throwsCode(() => polygonCentroid(p), 'INVALID_PLAN');
      throwsCode(() => pointInPolygon(p, [0, 0]), 'INVALID_PLAN');
      assert.equal(isSimplePolygon(p), false);
    }
  });
});

describe('開口(門窗)', () => {
  test('sectorOfOpening 的中心座標與宮位 == oracle(矩形房間,任意位移)', () => {
    const rng = mulberry32(4711);
    for (let it = 0; it < 2500; it += 1) {
      const x0 = R(rng, -30, 30);
      const y0 = R(rng, -30, 30);
      const w = R(rng, 2, 14);
      const d = R(rng, 2, 14);
      const poly = rectPoly(x0, y0, w, d);
      const wall = pick(rng, ['bottom', 'top', 'left', 'right']);
      const len = wall === 'bottom' || wall === 'top' ? w : d;
      const width = R(rng, 0.3, Math.min(2, len - 0.1));
      const pos = R(rng, width / 2, len - width / 2);
      const up = genPlanUp(rng);
      const unc = pick(rng, [5, 2, 10]);
      const plan = planOf({ outline: poly, planUpBearing: up, openings: [{ id: 'o', kind: 'window', roomId: 'living', wall, pos, width }] });
      deepFreeze(plan);
      const exp = { bottom: [x0 + pos, y0], top: [x0 + pos, y0 + d], left: [x0, y0 + pos], right: [x0 + w, y0 + pos] }[wall];
      const c = openingCenter(plan, 'o');
      assert.ok(Math.abs(c.point[0] - exp[0]) < 1e-9 && Math.abs(c.point[1] - exp[1]) < 1e-9, `中心 ${c.point} vs ${exp}`);
      const so = sectorOfOpening(plan, 'o', { measureUncertainty: unc });
      const oc = oracleLocate(exp, [x0 + w / 2, y0 + d / 2], mod(up, 360), unc);
      if (oc && oc.boundaryDeg > 1e-6) {
        assert.equal(so.sector.index, oc.k, `it=${it}`);
        if (Math.abs(oc.boundaryDeg - unc) > 1e-6) assert.equal(so.sector.borderline, oc.borderline);
      }
      // 與 sectorOfPoint 一致
      assert.deepEqual(so.sector, sectorOfPoint(plan, exp, { measureUncertainty: unc }));
    }
  });

  test('開口超出牆面、貼牆邊界、L 型缺角牆、id/kind/roomId 錯誤', () => {
    const room = rectPoly(0, 0, 6, 5);
    const mk = (o) => planOf({ outline: room, openings: [{ id: 'o', kind: 'door', roomId: 'living', wall: 'bottom', pos: 1, width: 0.9, ...o }] });
    assert.equal(validatePlan(mk({})).ok, true);
    assert.equal(validatePlan(mk({ pos: 0.45 })).ok, true, '緊貼左端');
    assert.equal(validatePlan(mk({ pos: 5.55 })).ok, true, '緊貼右端');
    assert.equal(validatePlan(mk({ pos: 0.44 })).ok, false, '超出左端');
    assert.equal(validatePlan(mk({ pos: 5.56 })).ok, false, '超出右端');
    for (const bad of [{ width: 0 }, { width: -1 }, { width: NaN }, { pos: NaN }, { pos: Infinity }, { wall: 'north' }, { kind: 'gate' }, { roomId: 'nope' }, { id: '' }, { width: 7 }, { pos: '1' }]) {
      const p = mk(bad);
      assert.equal(validatePlan(p).ok, false, JSON.stringify(bad));
      throwsCode(() => openingCenter(p, 'o'), 'INVALID_PLAN');
    }
    // L 型: 右牆只有下半 [0,3] 在外接框邊上
    const L = planOf({ outline: L_SHAPE, openings: [{ id: 'a', kind: 'window', roomId: 'living', wall: 'right', pos: 1.5, width: 2 }, { id: 'b', kind: 'window', roomId: 'living', wall: 'right', pos: 4, width: 1 }] });
    assert.equal(validatePlan(L).ok, false);
    const L2 = planOf({ outline: L_SHAPE, openings: [{ id: 'a', kind: 'window', roomId: 'living', wall: 'right', pos: 1.5, width: 2 }] });
    assert.equal(validatePlan(L2).ok, true);
    assert.deepEqual(openingCenter(L2, 'a').point, [6, 1.5]);
    throwsCode(() => openingCenter(L2, 'zzz'), 'UNKNOWN_OPENING');
    throwsCode(() => openingCenter(L2, undefined), 'UNKNOWN_OPENING');
    // 重複 id / mainDoor 指向不存在
    const dup = planOf({ outline: room, openings: [{ id: 'o', kind: 'door', roomId: 'living', wall: 'bottom', pos: 1, width: 0.9 }, { id: 'o', kind: 'window', roomId: 'living', wall: 'top', pos: 1, width: 0.9 }] });
    assert.equal(validatePlan(dup).ok, false);
    assert.equal(validatePlan(mk({}), {}).ok, true);
    assert.equal(validatePlan({ ...mk({}), mainDoor: 'ghost' }).ok, false);
    assert.equal(validatePlan({ ...mk({}), mainDoor: 5 }).ok, false);
    assert.equal(validatePlan({ ...mk({}), mainDoor: 'o' }).ok, true);
    assert.ok(validatePlan({ ...mk({}), mainDoor: 'o' }).warnings.some((w) => w.code === 'mainDoorNotEntrance'));
  });

  test('開口重疊給警告,不算錯誤', () => {
    const room = rectPoly(0, 0, 6, 5);
    const p = planOf({ outline: room, openings: [{ id: 'a', kind: 'door', roomId: 'living', wall: 'bottom', pos: 1, width: 1 }, { id: 'b', kind: 'window', roomId: 'living', wall: 'bottom', pos: 1.5, width: 1 }] });
    const v = validatePlan(p);
    assert.equal(v.ok, true);
    assert.ok(v.warnings.some((w) => w.code === 'openingsOverlap'));
  });
});

describe('開口落牆判定 對 oracle 差分(整數直方圖多邊形,牆段可能只佔外接框一部分)', () => {
  test('bottom/top/left/right 的合法區間 = 落在外接框邊上的邊聯集', () => {
    const rng = mulberry32(60606);
    let accepted = 0;
    let rejected = 0;
    for (let it = 0; it < 4000; it += 1) {
      const cols = RI(rng, 1, 5);
      const ws = Array.from({ length: cols }, () => RI(rng, 1, 4));
      const hs = Array.from({ length: cols }, () => RI(rng, 1, 4));
      const xs = [0];
      ws.forEach((w, i) => xs.push(xs[i] + w));
      const poly = [[0, 0], [xs[cols], 0]];
      for (let i = cols - 1; i >= 0; i -= 1) { poly.push([xs[i + 1], hs[i]]); poly.push([xs[i], hs[i]]); }
      const ox = RI(rng, -5, 5);
      const oy = RI(rng, -5, 5);
      const P = poly.map(([x, y]) => [x + ox, y + oy]);
      const maxH = Math.max(...hs);
      const W = xs[cols];
      // 各牆的合法區間(自外接框左下角起算)
      const spans = {
        bottom: [[0, W]],
        top: hs.map((h, i) => (h === maxH ? [xs[i], xs[i + 1]] : null)).filter(Boolean),
        left: [[0, hs[0]]],
        right: [[0, hs[cols - 1]]],
      };
      const wall = pick(rng, ['bottom', 'top', 'left', 'right']);
      const len = wall === 'top' || wall === 'bottom' ? W : maxH;
      const width = RI(rng, 1, 4) / 2;
      const pos = RI(rng, 0, len * 4) / 2;
      const lo = pos - width / 2;
      const hi = pos + width / 2;
      // 聯集(相接的合併)
      const merged = [];
      for (const iv of [...spans[wall]].sort((a, b) => a[0] - b[0])) {
        const last = merged[merged.length - 1];
        if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
        else merged.push([...iv]);
      }
      const expectOk = merged.some(([a, b]) => a <= lo && hi <= b);
      const plan = planOf({ outline: P, planUpBearing: 0, openings: [{ id: 'o', kind: 'window', roomId: 'living', wall, pos, width }] });
      const v = validatePlan(plan);
      assert.equal(v.ok, expectOk, `wall=${wall} pos=${pos} w=${width} poly=${JSON.stringify(P)} 期望 ${expectOk} spans=${JSON.stringify(merged)}`);
      if (expectOk) accepted += 1; else rejected += 1;
    }
    assert.ok(accepted > 300 && rejected > 300, `${accepted}/${rejected}`);
  });
});

describe('convertPlanNorth', () => {
  test('往返 magnetic→true→magnetic 還原(圓周差 < 1e-9)、不改輸入、null 保持', () => {
    const rng = mulberry32(3);
    for (let it = 0; it < 2000; it += 1) {
      const up = genPlanUp(rng);
      const D = R(rng, -40, 40);
      const plan = deepFreeze(planOf({ outline: rectPoly(0, 0, 3, 3), planUpBearing: up }));
      const t = convertPlanNorth(plan, 'magnetic', 'true', D);
      assert.notEqual(t, plan);
      assert.ok(Math.abs(mod(t.planUpBearing - (up + D) + 180, 360) - 180) < 1e-9, `${t.planUpBearing} vs ${up}+${D}`);
      const back = convertPlanNorth(t, 'true', 'magnetic', D);
      assert.ok(Math.abs(mod(back.planUpBearing - up + 180, 360) - 180) < 1e-9);
      assert.ok(t.planUpBearing >= 0 && t.planUpBearing < 360);
    }
    const u = { version: 1, planUpBearing: null, outline: rectPoly(0, 0, 3, 3) };
    assert.equal(convertPlanNorth(u, 'magnetic', 'true', 5).planUpBearing, null);
    assert.deepEqual(convertPlanNorth({ ...u, planUpBearing: 40 }, 'true', 'true', 5).planUpBearing, 40);
  });
  test('非法北基準/偏角/非物件 plan', () => {
    const plan = planOf({ outline: rectPoly(0, 0, 3, 3), planUpBearing: 10 });
    throwsCode(() => convertPlanNorth(plan, 'grid', 'true', 1), 'INVALID_NORTH_MODE');
    throwsCode(() => convertPlanNorth(plan, 'magnetic', undefined, 1), 'INVALID_NORTH_MODE');
    throwsCode(() => convertPlanNorth(null, 'magnetic', 'true', 1), 'INVALID_PLAN');
    for (const D of [NaN, Infinity, '5', undefined, 181]) {
      assert.throws(() => convertPlanNorth(plan, 'magnetic', 'true', D), /INVALID_DECLINATION/, `D=${D}`);
    }
  });
  test('planUpBearing 為 NaN/Infinity 時不可被默默轉成「未知」', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const plan = { version: 1, planUpBearing: bad, outline: rectPoly(0, 0, 3, 3) };
      let out;
      try {
        out = convertPlanNorth(plan, 'magnetic', 'true', 5);
      } catch (e) {
        assert.ok(/^INVALID_(PLAN|BEARING)/.test(e.message), e.message);
        continue;
      }
      assert.fail(`planUpBearing=${bad} 應丟錯,卻回傳 planUpBearing=${JSON.stringify(out.planUpBearing)}`);
    }
  });
});

describe('-0 與輸出乾淨度', () => {
  test('planUpBearing=-0 與 0 的輸出 JSON 往返後深度相等(不洩漏 -0)', () => {
    const outline = rectPoly(0, 0, 4, 4);
    for (const fn of [
      (p) => sectorShares(p),
      (p) => taijiPoint(p),
      (p) => sectorOfPoint(p, [3, 3]),
      (p) => sectorOfPoint(p, [2, 3]),
      (p) => sectorOfPoint(p, [1, 2]),
    ]) {
      const r = fn(planOf({ outline, planUpBearing: -0 }));
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
      assert.deepEqual(r, fn(planOf({ outline, planUpBearing: 0 })));
    }
  });
  test('外框含 -0 座標時輸出不含 -0', () => {
    const outline = [[-0, -0], [4, -0], [4, 4], [-0, 4]];
    const r = sectorShares(planOf({ outline, planUpBearing: 0 }));
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    const t = taijiPoint(planOf({ outline, taiji: { mode: 'manual', manual: [-0, -0] } }));
    assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
  });
  test('sectorShares 各欄位不含 NaN/Infinity/undefined(極端輸入)', () => {
    const rng = mulberry32(88);
    for (let it = 0; it < 400; it += 1) {
      const { poly } = genShape(rng);
      const r = sectorShares(planOf({ outline: poly, planUpBearing: genPlanUp(rng), taiji: { mode: 'manual', manual: [R(rng, -1e6, 1e6), R(rng, -1e6, 1e6)] } }));
      const walk = (v) => {
        if (typeof v === 'number') assert.ok(Number.isFinite(v));
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach((x) => { assert.notEqual(x, undefined); walk(x); });
      };
      walk(r);
      assert.ok(Math.abs(GUA.reduce((s, g) => s + r.palaceArea[g], 0) - r.totalArea) <= 1e-8 * Math.max(1, r.totalArea), `遠距離 manual 太極點面積守恆 it=${it}`);
    }
  });
});

describe('效能', () => {
  const rng = mulberry32(2718);
  const bigOutline = starPoly(rng, 120);
  const rooms = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, type: 'other', polygon: shift(rectPoly(0, 0, 1 + (i % 3), 1 + (i % 4)), i * 0.01, 0) }));
  const bigPlan = planOf({ outline: bigOutline, rooms, planUpBearing: 33, openings: [{ id: 'd', kind: 'entrance', roomId: 'r0', wall: 'bottom', pos: 0.5, width: 0.8 }] });
  const timeIt = (fn, n) => {
    fn();
    const t0 = performance.now();
    for (let i = 0; i < n; i += 1) fn();
    return (performance.now() - t0) / n;
  };
  test('sectorOfPoint 單次 < 5ms(120 頂點外框)', () => {
    const ms = timeIt(() => sectorOfPoint(bigPlan, [1, 1]), 50);
    assert.ok(ms < 5, `sectorOfPoint 平均 ${ms.toFixed(3)}ms`);
  });
  test('sectorOfPoint 單次 < 5ms(典型 L 型)', () => {
    const p = planOf({ outline: L_SHAPE, planUpBearing: 33 });
    const ms = timeIt(() => sectorOfPoint(p, [1, 1]), 200);
    assert.ok(ms < 5, `${ms.toFixed(3)}ms`);
  });
  test('sectorShares < 50ms(120 頂點外框 + 12 房間)', () => {
    const ms = timeIt(() => sectorShares(bigPlan), 20);
    assert.ok(ms < 50, `sectorShares 平均 ${ms.toFixed(3)}ms`);
  });
  test('sectorOfOpening 單次 < 5ms(12 房間)', () => {
    const ms = timeIt(() => sectorOfOpening(bigPlan, 'd'), 50);
    assert.ok(ms < 5, `sectorOfOpening 平均 ${ms.toFixed(3)}ms`);
  });
  test('validatePlan < 50ms(300 頂點外框)', () => {
    const p = planOf({ outline: starPoly(mulberry32(1), 300), planUpBearing: 0 });
    const ms = timeIt(() => validatePlan(p), 5);
    assert.ok(ms < 50, `validatePlan 300 頂點平均 ${ms.toFixed(3)}ms`);
  });
});

describe('純函式: 不改輸入、決定性', () => {
  test('凍結輸入後所有公開函式都能跑(嚴格模式下任何修改都會丟錯)', () => {
    const outline = L_SHAPE;
    const plan = deepFreeze(planOf({
      outline, planUpBearing: 12.5,
      rooms: [{ id: 'a', type: 'living', polygon: outline }],
      openings: [{ id: 'd', kind: 'entrance', roomId: 'a', wall: 'bottom', pos: 1, width: 0.9 }],
      mainDoor: 'd', taiji: { mode: 'centroid', manual: null },
    }));
    const settings = deepFreeze({ measureUncertainty: 3, taijiMode: 'centroid' });
    const before = JSON.stringify(plan);
    const outs = [
      validatePlan(plan, settings), taijiPoint(plan, settings), sectorOfPoint(plan, [1, 1], settings),
      sectorShares(plan, settings), openingCenter(plan, 'd', settings), sectorOfOpening(plan, 'd', settings),
      convertPlanNorth(plan, 'magnetic', 'true', -5),
    ];
    assertValidPlan(plan, settings);
    for (const o of outs) assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
    assert.equal(JSON.stringify(plan), before);
    assert.deepEqual(polygonCentroid(deepFreeze([...L_SHAPE.map((p) => [...p])])), [2.5, 2.5]);
  });
  test('回傳物件與輸入不共用參照(改輸出不影響下次結果)', () => {
    const plan = planOf({ outline: rectPoly(0, 0, 4, 4), planUpBearing: 10, taiji: { mode: 'manual', manual: [1, 1] } });
    const r = sectorShares(plan);
    r.taiji[0] = 999;
    r.meta.ruleset.taijiMode = 'x';
    assert.notEqual(plan.taiji.manual, r.taiji);
    assert.deepEqual(plan.taiji.manual, [1, 1]);
    const t = taijiPoint(plan);
    t.point[0] = 555;
    assert.deepEqual(plan.taiji.manual, [1, 1]);
    const conv = convertPlanNorth(plan, 'magnetic', 'true', 5);
    conv.outline[0][0] = 777;
    assert.equal(plan.outline[0][0], 0);
  });
});

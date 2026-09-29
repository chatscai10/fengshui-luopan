// 明財位幾何、角落範圍檢核、室內步行距離、開口選門(規格 2.6.2、2.6.3)。純函式,座標約定同規格 2.6.2:
// x 向右、y 向上;矩形 [0,w]x[0,d];牆 bottom(y=0) top(y=d) left(x=0) right(x=w);角 BL BR TR TL(逆時針)。
//
// 錯誤碼(message 開頭,規格沒列的自訂):
//   INVALID_ROOM     房間不是 {w,d}(正有限數,可帶 origin)或合法簡單多邊形 {polygon}
//   INVALID_DOOR     門的牆名、沿牆位置或寬度不合法
//   INVALID_CORNER   角名不是 BL BR TR TL(矩形)或頂點編號(多邊形)
//   INVALID_OPENING  開口的牆、區間或類型不合法
//   INVALID_OPTION   選項名稱或值不合法
import { isSimplePolygon, pointInPolygon } from '../plan.js';
import { CENTER_BAND, MIN_OVERLAP_M, TIE_RATIO, ZONE_M } from './constants.js';

const EPS = 1e-9;

export const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v));
  } catch {
    return String(v);
  }
};
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

/** 矩形的四個角,逆時針自左下起(頂點順序即多邊形順序)。 */
export const CORNERS = Object.freeze(['BL', 'BR', 'TR', 'TL']);
export const WALLS = Object.freeze(['bottom', 'top', 'left', 'right']);
export const OPPOSITE_WALL = Object.freeze({ bottom: 'top', top: 'bottom', left: 'right', right: 'left' });
/** 由牆指向室內的單位向量(進門者面朝的方向)。 */
export const INWARD = Object.freeze({ bottom: [0, 1], top: [0, -1], left: [1, 0], right: [-1, 0] });
const WALL_CORNERS = Object.freeze({ bottom: ['BL', 'BR'], top: ['TL', 'TR'], left: ['BL', 'TL'], right: ['BR', 'TR'] });

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 進門者的右手邊。龍邊 = 從室內向大門外望時的左手邊 = 進門者的右手邊(規格 2.6.3 第 5 點)。 */
export const rightOf = (f) => [f[1], -f[0]];
/** 面朝 f 時的左手邊。 */
export const leftOf = (f) => [-f[1], f[0]];

// ─────────────────────────── 房間讀取 ───────────────────────────

function readRect(room) {
  if (!isObj(room) || !(isNum(room.w) && room.w > 0) || !(isNum(room.d) && room.d > 0)) {
    fail('INVALID_ROOM', `矩形房間需要 w、d 為正有限數: ${show(room)}`);
  }
  const origin = room.origin ?? [0, 0];
  if (!isPoint(origin)) fail('INVALID_ROOM', `origin 必須是 [x,y]: ${show(origin)}`);
  const [ox, oy] = origin;
  const { w, d } = room;
  return { w, d, ox, oy, pts: { BL: [ox, oy], BR: [ox + w, oy], TR: [ox + w, oy + d], TL: [ox, oy + d] } };
}

/** 多邊形頂點檢查: 至少 3 點、有限數、無連續重複點、簡單多邊形。回傳拷貝。 */
export function readPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(isPoint)) {
    fail('INVALID_ROOM', `多邊形需要至少 3 個 [x,y] 頂點: ${show(polygon)}`);
  }
  const poly = polygon.map((p) => [p[0], p[1]]);
  for (let i = 0; i < poly.length; i += 1) {
    if (dist(poly[i], poly[(i + 1) % poly.length]) <= EPS) fail('INVALID_ROOM', `多邊形有連續重複的頂點(第 ${i} 點)`);
  }
  if (!isSimplePolygon(poly)) fail('INVALID_ROOM', '多邊形自交、共線或面積為 0');
  return poly;
}

const area2 = (poly) => poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0);

/**
 * 是否為軸向矩形(4 個頂點、每邊平行座標軸)。是就回 {w,d,origin},否則 null。
 * @param {number[][]} polygon
 * @returns {{w:number, d:number, origin:[number,number]}|null}
 */
export function asAxisRect(polygon) {
  if (!Array.isArray(polygon) || polygon.length !== 4 || !polygon.every(isPoint)) return null;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const onCorner = (p) => (Math.abs(p[0] - minX) <= EPS || Math.abs(p[0] - maxX) <= EPS) && (Math.abs(p[1] - minY) <= EPS || Math.abs(p[1] - maxY) <= EPS);
  if (!polygon.every(onCorner)) return null;
  const distinct = new Set(polygon.map((p) => `${Math.round((p[0] - minX) / (maxX - minX || 1))},${Math.round((p[1] - minY) / (maxY - minY || 1))}`));
  if (distinct.size !== 4 || !(maxX - minX > EPS) || !(maxY - minY > EPS)) return null;
  return { w: maxX - minX, d: maxY - minY, origin: [minX, minY] };
}

/**
 * 內角恰為 90 度的凸頂點編號(規格 2.6.3 第 1 點: 排除 270 度凹角)。順逆時針皆可。
 * @param {number[][]} polygon
 * @returns {number[]}
 */
export function rightAngleVertices(polygon) {
  const poly = readPolygon(polygon);
  const orient = Math.sign(area2(poly));
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i + n - 1) % n];
    const next = poly[(i + 1) % n];
    const a = sub(prev, poly[i]);
    const b = sub(next, poly[i]);
    const cosv = dot(a, b) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]));
    if (Math.abs(cosv) <= EPS && orient * cross(sub(poly[i], prev), sub(next, poly[i])) > 0) out.push(i);
  }
  return out;
}

// ─────────────────────────── 室內步行距離 ───────────────────────────

function properCross(a, b, c, d) {
  const sg = (v) => (v > EPS ? 1 : v < -EPS ? -1 : 0);
  const o1 = sg(cross(sub(b, a), sub(c, a)));
  const o2 = sg(cross(sub(b, a), sub(d, a)));
  const o3 = sg(cross(sub(d, c), sub(a, c)));
  const o4 = sg(cross(sub(d, c), sub(b, c)));
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** 線段 ab 是否整段在多邊形內(可貼邊、可擦過頂點)。以頂點切段後逐段驗中點,並排除與邊的真交叉。 */
function visible(poly, a, b) {
  const len = dist(a, b);
  if (len <= EPS) return true;
  const ab = sub(b, a);
  const ts = [0, 1];
  for (const v of poly) {
    const t = dot(sub(v, a), ab) / (len * len);
    if (t > EPS && t < 1 - EPS && Math.abs(cross(ab, sub(v, a))) / len <= EPS) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i < poly.length; i += 1) {
    if (properCross(a, b, poly[i], poly[(i + 1) % poly.length])) return false;
  }
  for (let i = 0; i + 1 < ts.length; i += 1) {
    const t = (ts[i] + ts[i + 1]) / 2;
    if (pointInPolygon(poly, [a[0] + ab[0] * t, a[1] + ab[1] * t]) === 'outside') return false;
  }
  return true;
}

/**
 * 從多邊形內(或邊上)一點到各頂點的室內最短步行距離(可見性圖 + Dijkstra)。凸多邊形等於歐氏距離;
 * 凹角會擋住直線,路徑轉折只發生在頂點(規格 2.6.3 第 2 點)。
 * @param {number[][]} polygon 頂點,順逆時針皆可
 * @param {[number,number]} from 起點,必須在多邊形內或邊上
 * @returns {number[]} 到 polygon[i] 的距離
 * @throws {Error} INVALID_ROOM, INVALID_DOOR(起點在外)
 */
export function walkDistances(polygon, from) {
  const poly = readPolygon(polygon);
  if (!isPoint(from)) fail('INVALID_DOOR', `起點必須是 [x,y]: ${show(from)}`);
  if (pointInPolygon(poly, from) === 'outside') fail('INVALID_DOOR', `起點不在房間內: ${show(from)}`);
  const n = poly.length;
  const pts = [...poly, [from[0], from[1]]];
  const best = Array(n + 1).fill(Infinity);
  const done = Array(n + 1).fill(false);
  best[n] = 0;
  for (let round = 0; round <= n; round += 1) {
    let u = -1;
    for (let i = 0; i <= n; i += 1) if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
    if (u < 0 || best[u] === Infinity) break;
    done[u] = true;
    for (let v = 0; v <= n; v += 1) {
      if (done[v]) continue;
      const nd = best[u] + dist(pts[u], pts[v]);
      if (nd < best[v] - EPS && visible(poly, pts[u], pts[v])) best[v] = nd;
    }
  }
  return best.slice(0, n);
}

// ─────────────────────────── 明財位 ───────────────────────────

const OPT_KEYS = ['centerBand', 'preferDragonSide', 'showRay45', 'tieRatio'];

function readOpt(opt) {
  if (!isObj(opt)) fail('INVALID_OPTION', 'opt 必須是物件');
  for (const k of Object.keys(opt)) if (!OPT_KEYS.includes(k)) fail('INVALID_OPTION', `未知的選項: ${k}`);
  const centerBand = opt.centerBand ?? CENTER_BAND;
  const tieRatio = opt.tieRatio ?? TIE_RATIO;
  if (!(isNum(centerBand) && centerBand >= 0 && centerBand <= 0.5)) fail('INVALID_OPTION', `centerBand 必須在 [0,0.5]: ${show(centerBand)}`);
  if (!(isNum(tieRatio) && tieRatio > 0 && tieRatio <= 1)) fail('INVALID_OPTION', `tieRatio 必須在 (0,1]: ${show(tieRatio)}`);
  for (const k of ['preferDragonSide', 'showRay45']) {
    if (opt[k] !== undefined && typeof opt[k] !== 'boolean') fail('INVALID_OPTION', `${k} 必須是布林: ${show(opt[k])}`);
  }
  return { centerBand, tieRatio, preferDragonSide: opt.preferDragonSide === true, showRay45: opt.showRay45 === true };
}

const wallLength = (R, wall) => (wall === 'bottom' || wall === 'top' ? R.w : R.d);

function readRectDoor(R, door) {
  if (!isObj(door) || !WALLS.includes(door.wall)) fail('INVALID_DOOR', `門的 wall 必須是 ${WALLS.join('/')}: ${show(door)}`);
  const length = wallLength(R, door.wall);
  if (!isNum(door.pos) || door.pos < -EPS || door.pos > length + EPS) {
    fail('INVALID_DOOR', `門的 pos 必須在牆長 [0,${length}] 內: ${show(door.pos)}`);
  }
  if (door.width !== undefined && !(isNum(door.width) && door.width > 0)) fail('INVALID_DOOR', `門的 width 必須是正有限數: ${show(door.width)}`);
  const { ox, oy, w, d } = R;
  const point = { bottom: [ox + door.pos, oy], top: [ox + door.pos, oy + d], left: [ox, oy + door.pos], right: [ox + w, oy + door.pos] }[door.wall];
  return { wall: door.wall, pos: door.pos, width: door.width ?? null, length, point };
}

/**
 * 45 度射線命中點(可選顯示,`showRay45`,信心: 低): 由門中心朝「遠離門較近端」的一側以 45 度射入,取撞到的第一面牆之點。
 * 寬扁房間會落在遠牆中段而非牆角。門恰在正中時朝龍邊(進門者右手)。只支援矩形。
 * @param {{w:number,d:number,origin?:[number,number]}} room
 * @param {{wall:string,pos:number,width?:number}} door
 * @returns {{hit:[number,number], wall:'bottom'|'top'|'left'|'right'}}
 * @throws {Error} INVALID_ROOM, INVALID_DOOR
 */
export function ray45Hit(room, door) {
  const R = readRect(room);
  const D = readRectDoor(R, door);
  const f = INWARD[D.wall];
  const axis = f[0] === 0 ? [1, 0] : [0, 1];
  const mid = D.length / 2;
  let s;
  if (Math.abs(D.pos - mid) <= EPS) s = dot(axis, rightOf(f)) > 0 ? 1 : -1;
  else s = D.pos < mid ? 1 : -1;
  const dir = [f[0] + s * axis[0], f[1] + s * axis[1]];
  const bounds = { minX: R.ox, maxX: R.ox + R.w, minY: R.oy, maxY: R.oy + R.d };
  const hits = [];
  if (dir[0] > 0) hits.push([(bounds.maxX - D.point[0]) / dir[0], 'right']);
  if (dir[0] < 0) hits.push([(bounds.minX - D.point[0]) / dir[0], 'left']);
  if (dir[1] > 0) hits.push([(bounds.maxY - D.point[1]) / dir[1], 'top']);
  if (dir[1] < 0) hits.push([(bounds.minY - D.point[1]) / dir[1], 'bottom']);
  hits.sort((a, b) => a[0] - b[0]);
  const [u, wall] = hits[0];
  return { hit: [D.point[0] + dir[0] * u, D.point[1] + dir[1] * u], wall };
}

function sortByDistance(list) {
  // 距離相同(門居中的矩形)時龍邊在前,其餘依頂點編號,結果才是決定性的。
  return list.sort((a, b) => {
    if (Math.abs(a.walkDist - b.walkDist) > EPS) return b.walkDist - a.walkDist;
    if (a.dragonSide !== b.dragonSide) return a.dragonSide ? -1 : 1;
    return a.vertexIndex - b.vertexIndex;
  });
}

function mingRect(room, door, o) {
  const R = readRect(room);
  const D = readRectDoor(R, door);
  const f = INWARD[D.wall];
  const r = rightOf(f);
  const excluded = new Set(WALL_CORNERS[D.wall]);
  const cands = CORNERS.filter((c) => !excluded.has(c)).map((name) => {
    const p = R.pts[name];
    return {
      name,
      vertexIndex: CORNERS.indexOf(name),
      point: [p[0], p[1]],
      walkDist: dist(p, D.point),
      dragonSide: dot(sub(p, D.point), r) > EPS,
    };
  });
  sortByDistance(cands);
  const centered = Math.abs(D.pos - D.length / 2) <= o.centerBand * D.length + EPS;
  let corners;
  if (centered && o.preferDragonSide) corners = [cands.find((c) => c.dragonSide) ?? cands[0]];
  else if (centered) corners = cands.slice(0, 2);
  else corners = [cands[0]];
  return {
    kind: 'rect',
    door: { wall: D.wall, pos: D.pos, width: D.width, point: D.point },
    centered,
    tied: corners.length === 2,
    dragonOnly: centered && o.preferDragonSide,
    corners: corners.map((c, i) => ({ ...c, role: i === 0 ? 'primary' : 'second' })),
    ray45: o.showRay45 ? ray45Hit(room, door) : null,
    warnings: [],
  };
}

function readPolygonDoor(poly, door) {
  const n = poly.length;
  if (!isObj(door)) fail('INVALID_DOOR', `門必須是物件: ${show(door)}`);
  if (door.width !== undefined && !(isNum(door.width) && door.width > 0)) fail('INVALID_DOOR', `門的 width 必須是正有限數: ${show(door.width)}`);
  if (door.point !== undefined) {
    if (!isPoint(door.point)) fail('INVALID_DOOR', `門的 point 必須是 [x,y]: ${show(door.point)}`);
    for (let i = 0; i < n; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const len = dist(a, b);
      const ab = sub(b, a);
      const t = dot(sub(door.point, a), ab) / (len * len);
      const off = Math.abs(cross(ab, sub(door.point, a))) / len;
      if (off <= 1e-7 && t >= -1e-9 && t <= 1 + 1e-9) {
        return { edgeIndex: i, pos: t * len, width: door.width ?? null, point: [door.point[0], door.point[1]] };
      }
    }
    fail('INVALID_DOOR', `門的 point 不在房間的任何一條邊上: ${show(door.point)}`);
  }
  if (!Number.isInteger(door.edgeIndex) || door.edgeIndex < 0 || door.edgeIndex >= n) {
    fail('INVALID_DOOR', `多邊形的門需要 edgeIndex(0..${n - 1})與 pos 或 t,或直接給 point: ${show(door)}`);
  }
  const a = poly[door.edgeIndex];
  const b = poly[(door.edgeIndex + 1) % n];
  const len = dist(a, b);
  let pos;
  if (door.pos !== undefined) pos = door.pos;
  else if (door.t !== undefined) pos = door.t * len;
  else fail('INVALID_DOOR', '多邊形的門需要 pos(公尺)或 t(0..1)');
  if (!isNum(pos) || pos < -EPS || pos > len + EPS) fail('INVALID_DOOR', `門的沿邊位置必須在 [0,${len}] 內: ${show(pos)}`);
  const k = pos / len;
  return { edgeIndex: door.edgeIndex, pos, width: door.width ?? null, point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] };
}

function mingPolygon(polygon, door, o) {
  const poly = readPolygon(polygon);
  const n = poly.length;
  const D = readPolygonDoor(poly, door);
  const excluded = new Set([D.edgeIndex, (D.edgeIndex + 1) % n]);
  const distTo = walkDistances(poly, D.point);
  const cands = rightAngleVertices(poly)
    .filter((i) => !excluded.has(i))
    .map((i) => ({ name: `V${i}`, vertexIndex: i, point: [poly[i][0], poly[i][1]], walkDist: distTo[i], dragonSide: false }));
  sortByDistance(cands);
  const warnings = [];
  let corners = cands.slice(0, 1);
  if (cands.length === 0) warnings.push('noRightAngleCorner');
  // 非矩形沒有「門居中」的概念: 第二遠距離達最遠者的 tieRatio 以上就並列(規格 2.6.3 第 3 點,6% 為設計值)。
  else if (cands[1] && cands[1].walkDist >= o.tieRatio * cands[0].walkDist - EPS) corners = cands.slice(0, 2);
  return {
    kind: 'polygon',
    door: { edgeIndex: D.edgeIndex, pos: D.pos, width: D.width, point: D.point },
    centered: null,
    tied: corners.length === 2,
    dragonOnly: false,
    corners: corners.map((c, i) => ({ ...c, role: i === 0 ? 'primary' : 'second' })),
    ray45: null,
    warnings,
  };
}

/**
 * 明財位幾何(D43,信心: 高): 候選 = 內角恰為 90 度的頂點,排除門所在邊的兩端點;距離 = 室內步行最短距離(矩形即歐氏距離);
 * 取最遠者為 primary。矩形且門在牆中央帶(|pos - L/2| <= centerBand*L)→ 兩角並列(D44),遠者 primary;
 * 多邊形第二遠距離 >= tieRatio(0.94)倍最遠者也並列(6% 為設計值)。等價說法: 進門者視角下,門在牆左半 → 財位在遠端右角。
 * 龍邊 = 從室內向大門外望時的左手邊 = 進門者的右手邊;`preferDragonSide` 對門居中只取龍邊(MyGoNews 2010 少數說法)。
 * 兩角距離完全相同(門正中的矩形)時龍邊排前。
 * @param {{w:number,d:number,origin?:[number,number]}|{polygon:number[][]}} room 矩形(原點預設 [0,0])或多邊形(順逆時針皆可)
 * @param {{wall:'bottom'|'top'|'left'|'right',pos:number,width?:number}|{edgeIndex:number,pos?:number,t?:number,width?:number}|{point:[number,number],width?:number}} door
 *   矩形用 wall+pos(pos 為開口中心沿牆座標);多邊形用 edgeIndex+pos(公尺)或 t(0..1),或直接給邊上的 point
 * @param {{centerBand?:number, preferDragonSide?:boolean, showRay45?:boolean, tieRatio?:number}} [opt]
 * @returns {{kind:'rect'|'polygon', door:object, centered:(boolean|null), tied:boolean, dragonOnly:boolean,
 *   corners:Array<{name:string, vertexIndex:number, point:[number,number], walkDist:number, dragonSide:boolean, role:'primary'|'second'}>,
 *   ray45:(null|{hit:[number,number], wall:string}), warnings:string[]}} corners 依 primary、second 排序
 * @throws {Error} INVALID_ROOM, INVALID_DOOR, INVALID_OPTION
 */
export function mingCaiWei(room, door, opt = {}) {
  const o = readOpt(opt);
  if (isObj(room) && Array.isArray(room.polygon)) return mingPolygon(room.polygon, door, o);
  return mingRect(room, door, o);
}

// ─────────────────────────── 角落範圍檢核 ───────────────────────────

/** 開口類型 → 檢核類別。window 窗、floor 落地窗、blocked 門或通道。 */
const OPENING_CLASS = Object.freeze({
  window: 'window',
  floor_window: 'floor',
  floorWindow: 'floor',
  door: 'blocked',
  entrance: 'blocked',
  balconyDoor: 'blocked',
  balcony_door: 'blocked',
  passage: 'blocked',
  corridor: 'blocked',
  opening: 'blocked',
});

/** 角區在牆座標上的區間(矩形: 牆名;多邊形: 邊編號,自邊起點量)。 */
function zoneIntervals(room, corner, zone) {
  if (isObj(room) && Array.isArray(room.polygon)) {
    const poly = readPolygon(room.polygon);
    const n = poly.length;
    const idx = typeof corner === 'string' && /^V\d+$/.test(corner) ? Number(corner.slice(1)) : corner;
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) fail('INVALID_CORNER', `多邊形的角必須是頂點編號 0..${n - 1} 或 'V<n>': ${show(corner)}`);
    const prev = (idx + n - 1) % n;
    const lenPrev = dist(poly[prev], poly[idx]);
    const lenNext = dist(poly[idx], poly[(idx + 1) % n]);
    return [
      { edge: prev, lo: Math.max(0, lenPrev - zone), hi: lenPrev },
      { edge: idx, lo: 0, hi: Math.min(lenNext, zone) },
    ];
  }
  const R = readRect(room);
  if (!CORNERS.includes(corner)) fail('INVALID_CORNER', `矩形的角必須是 ${CORNERS.join('/')}: ${show(corner)}`);
  const z = (wall, atEnd) => {
    const L = wallLength(R, wall);
    return atEnd ? { edge: wall, lo: Math.max(0, L - zone), hi: L } : { edge: wall, lo: 0, hi: Math.min(L, zone) };
  };
  return {
    BL: [z('bottom', false), z('left', false)],
    BR: [z('bottom', true), z('right', false)],
    TL: [z('top', false), z('left', true)],
    TR: [z('top', true), z('right', true)],
  }[corner];
}

/**
 * 角落範圍檢核(規格 2.6.3): 角區 = 角點沿兩面牆各 zone 公尺(預設 1.0,設計值);開口與角區重疊超過 5 公分才算。
 * 狀態優先序: blocked_opening(角區有門或通道)> blocked_walkway(動線穿過)> void_floor_window > void_window > ok。
 * opening='reward'(玄空派,D46)時窗與落地窗視為納氣,狀態改為 qi_intake_ok(原本的見空種類留在 voidKind)。
 * @param {{w:number,d:number}|{polygon:number[][]}} room
 * @param {string|number} corner 矩形: BL BR TR TL;多邊形: 頂點編號或 'V<n>'
 * @param {Array<{wall?:string, edgeIndex?:number, start:number, end:number, type:string}>} [openings]
 *   矩形用 wall(沿牆座標 start..end);多邊形用 edgeIndex(自該邊起點量的距離)。type: window、floor_window(floorWindow)、
 *   door、entrance、balconyDoor(balcony_door)、passage、corridor、opening
 * @param {{zone?:number, minOverlap?:number, opening?:'penalty'|'reward', onWalkway?:boolean}} [opts]
 * @returns {{status:'ok'|'void_window'|'void_floor_window'|'blocked_opening'|'blocked_walkway'|'qi_intake_ok', voidKind:(null|'void_window'|'void_floor_window'),
 *   holds:boolean, reasons:Array<{kind:string, type:string, edge:(string|number), overlap:number}>, zone:Array<{edge:(string|number), lo:number, hi:number}>}}
 *   holds = 財位成立(不是 blocked_*)
 * @throws {Error} INVALID_ROOM, INVALID_CORNER, INVALID_OPENING, INVALID_OPTION
 */
export function cornerZoneStatus(room, corner, openings = [], opts = {}) {
  if (!isObj(opts)) fail('INVALID_OPTION', 'opts 必須是物件');
  for (const k of Object.keys(opts)) if (!['zone', 'minOverlap', 'opening', 'onWalkway'].includes(k)) fail('INVALID_OPTION', `未知的選項: ${k}`);
  const zone = opts.zone ?? ZONE_M;
  const minOverlap = opts.minOverlap ?? MIN_OVERLAP_M;
  const policy = opts.opening ?? 'penalty';
  if (!(isNum(zone) && zone > 0)) fail('INVALID_OPTION', `zone 必須是正有限數: ${show(zone)}`);
  if (!(isNum(minOverlap) && minOverlap >= 0)) fail('INVALID_OPTION', `minOverlap 必須是非負有限數: ${show(minOverlap)}`);
  if (policy !== 'penalty' && policy !== 'reward') fail('INVALID_OPTION', `opening 必須是 penalty 或 reward: ${show(policy)}`);
  if (!Array.isArray(openings)) fail('INVALID_OPENING', 'openings 必須是陣列');
  const intervals = zoneIntervals(room, corner, zone);
  const isPoly = isObj(room) && Array.isArray(room.polygon);

  const reasons = [];
  openings.forEach((o, i) => {
    if (!isObj(o)) fail('INVALID_OPENING', `openings[${i}] 必須是物件`);
    const kind = OPENING_CLASS[o.type];
    if (kind === undefined) fail('INVALID_OPENING', `openings[${i}].type 未知: ${show(o.type)}`);
    const edge = isPoly ? o.edgeIndex : o.wall;
    if (isPoly ? !Number.isInteger(edge) : !WALLS.includes(edge)) fail('INVALID_OPENING', `openings[${i}] 的${isPoly ? ' edgeIndex' : ' wall'} 不合法: ${show(edge)}`);
    if (!isNum(o.start) || !isNum(o.end) || !(o.start < o.end)) fail('INVALID_OPENING', `openings[${i}] 需要 start < end 的有限數: ${show([o.start, o.end])}`);
    for (const iv of intervals) {
      if (iv.edge !== edge) continue;
      const overlap = Math.min(iv.hi, o.end) - Math.max(iv.lo, o.start);
      if (overlap - minOverlap > EPS) reasons.push({ kind, type: o.type, edge, overlap });
    }
  });

  let status;
  let voidKind = null;
  if (reasons.some((r) => r.kind === 'blocked')) status = 'blocked_opening';
  else if (opts.onWalkway === true) status = 'blocked_walkway';
  else if (reasons.some((r) => r.kind === 'floor')) status = voidKind = 'void_floor_window';
  else if (reasons.some((r) => r.kind === 'window')) status = voidKind = 'void_window';
  else status = 'ok';
  const holds = !status.startsWith('blocked');
  if (voidKind !== null && policy === 'reward') status = 'qi_intake_ok';
  return { status, voidKind, holds, reasons, zone: intervals };
}

// ─────────────────────────── 開口與牆的共線重疊(平面圖用) ───────────────────────────

/**
 * 線段 cd 與邊 ab 共線時,落在 ab 上「距 a 為 [lo,hi]」區間內的重疊長度;不共線回 0。
 * 用於判斷平面圖的牆種類(玻璃、未頂天櫃體)與相鄰房間(廁所)是否貼著角區。
 * @param {[number,number]} a
 * @param {[number,number]} b
 * @param {[number,number]} c
 * @param {[number,number]} d
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function collinearOverlap(a, b, c, d, lo, hi) {
  const len = dist(a, b);
  if (len <= EPS) return 0;
  const ab = sub(b, a);
  const off = (p) => Math.abs(cross(ab, sub(p, a))) / len;
  if (off(c) > 1e-7 || off(d) > 1e-7) return 0;
  const tc = dot(sub(c, a), ab) / len;
  const td = dot(sub(d, a), ab) / len;
  return Math.max(0, Math.min(hi, Math.max(tc, td)) - Math.max(lo, Math.min(tc, td)));
}

// ─────────────────────────── 選門 ───────────────────────────

const DOOR_PRIORITY = Object.freeze({ entrance: 0, balconyDoor: 1, door: 2 });

/**
 * 進入某房間的「真正的門」(規格 2.6.3 特殊格局,信心: 中): 雙出入口以大門為主(entrance),
 * 其次落地窗/陽台門(大門開在陽台、須開落地窗才入客廳時,落地窗才是客廳的門,MyGoNews 2010),
 * 最後是一般室內門(走廊口屬內部動線,不與大門競爭)。同級取清單中第一個。窗與落地窗(window、floorWindow)不算門。
 * @param {Array<{kind:string}>} openings 該房間的開口
 * @returns {object|null}
 */
export function pickRoomDoor(openings) {
  let best = null;
  for (const o of openings ?? []) {
    const p = DOOR_PRIORITY[o?.kind];
    if (p !== undefined && (best === null || p < DOOR_PRIORITY[best.kind])) best = o;
  }
  return best;
}

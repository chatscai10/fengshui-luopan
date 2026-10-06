// 平面圖、太極點、扇區歸屬與面積佔比(規格 2.7,D55)。
// 本模組沒有研究來源,規則全是設計決策(tag=設計,信心: 低,待風水老師審稿,U-07)。
// 座標約定同規格 2.6.2: x 向右、y 向上;平面向量 (dx,dy) 的羅盤方位 = planUpBearing + atan2(dx,dy)。
//
// 錯誤碼(message 開頭):
//   INVALID_PLAN        平面圖資料不合法(自交、頂點不足、面積為 0、欄位型別錯…)
//   INVALID_TAIJI_MODE  settings.taijiMode 不是 centroid/bbox/manual(規格未列,自訂)
//   INVALID_POINT       點不是 [x,y] 有限數(規格未列,自訂)
//   INVALID_SETTING     設定值不合法,例如 measureUncertainty 不是非負有限數(規格未列,自訂)
//   PLAN_UP_UNKNOWN     planUpBearing 未知卻要求宮位(規格 2.7.5: 未知時不輸出宮位,自訂)
//   UNKNOWN_OPENING     找不到指定 id 的開口(規格未列,自訂)
//   INVALID_NORTH_MODE  北基準不是 magnetic/true(規格未列,自訂)
//   INVALID_DECLINATION 磁偏角不合法(由 geo 丟出)

import { resolveSettings } from './settings.js';
import { GUA, guaAt, normalizeBearing, circularDelta, toTrue, toMagnetic } from './geo.js';

export const PLAN_SCHEMA = 'fengshui.plan/1';
export const ROOM_TYPES = Object.freeze(['living', 'bedroom', 'kitchen', 'toilet', 'study', 'entry', 'balcony', 'stair', 'other']);
export const OPENING_KINDS = Object.freeze(['entrance', 'door', 'window', 'floorWindow', 'balconyDoor']);
export const WALL_KINDS = Object.freeze(['solid', 'glass', 'partial']);
/** 開口所在的牆(2.6.2): bottom(y 最小) top(y 最大) left(x 最小) right(x 最大)。 */
export const WALL_NAMES = Object.freeze(['bottom', 'top', 'left', 'right']);
export const TAIJI_MODES = Object.freeze(['centroid', 'bbox', 'manual']);
const NORTH_MODES = Object.freeze(['magnetic', 'true']);

// 幾何容差(公尺): 一般平面圖座標到公分,1e-9 遠小於任何有意義的差距,又大於浮點雜訊。
const EPS = 1e-9;
// 面積低於此值視為退化(平方公尺)。
const EPS_AREA = 1e-9;
const RAD = Math.PI / 180;
// 扇區線與中心的角距: 每宮 45 度,邊界在中心 ±22.5 度。
const HALF_SECTOR = 22.5;

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => {
  if (typeof v === 'string') return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

/**
 * @typedef {[number, number]} Point 平面座標 [x, y],單位公尺。
 * @typedef {{id:string, type:string, polygon:Point[]}} Room
 * @typedef {{id:string, kind:string, roomId:string, wall:'bottom'|'top'|'left'|'right', pos:number, width:number}} Opening
 *   pos 是開口「中心」沿牆的距離,自該房間外接框的左下角起算(bottom/top 沿 x,left/right 沿 y);
 *   房間在原點的矩形 [0,w]x[0,d] 時就是規格 2.6.2 的絕對座標。
 * @typedef {{segment:[Point,Point], kind:'solid'|'glass'|'partial'}} Wall
 * @typedef {{version:1, unit?:'m', planUpBearing:(number|null), outline:Point[], rooms?:Room[],
 *            openings?:Opening[], walls?:Wall[], mainDoor?:(string|null),
 *            taiji?:{mode?:('centroid'|'bbox'|'manual'|null), manual?:(Point|null)}}} Plan
 * @typedef {{gua:string, dir8:string, index:number, bearing:number, distance:number,
 *            boundaryDeg:number, borderline:boolean, otherGua:string}} SectorInfo
 *   boundaryDeg = 到最近扇區線的角度;otherGua = 越過該線的鄰宮。
 */

// ─────────────────────────── 多邊形基礎 ───────────────────────────

const samePoint = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

/** 去掉連續重複點與首尾重複點(GeoJSON 式閉合環),回傳新陣列。 */
function ringOf(poly) {
  const r = [];
  for (const p of poly) if (!r.length || !samePoint(r[r.length - 1], p)) r.push([p[0], p[1]]);
  while (r.length > 1 && samePoint(r[0], r[r.length - 1])) r.pop();
  return r;
}

/** 2 倍有號面積(逆時針為正)。相對第 0 點計算,座標很大時比直接 shoelace 少抵消誤差。 */
function ringArea2(ring) {
  const [ox, oy] = ring[0];
  let s = 0;
  for (let i = 1; i < ring.length - 1; i += 1) {
    const ax = ring[i][0] - ox;
    const ay = ring[i][1] - oy;
    const bx = ring[i + 1][0] - ox;
    const by = ring[i + 1][1] - oy;
    s += ax * by - ay * bx;
  }
  return s;
}

function ringCentroid(ring) {
  const [ox, oy] = ring[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 1; i < ring.length - 1; i += 1) {
    const ax = ring[i][0] - ox;
    const ay = ring[i][1] - oy;
    const bx = ring[i + 1][0] - ox;
    const by = ring[i + 1][1] - oy;
    const cr = ax * by - ay * bx;
    a += cr;
    cx += cr * (ax + bx);
    cy += cr * (ay + by);
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 點 p 到直線 ab 的有號距離(ab 長度必大於 0,由 ringOf 去重保證)。 */
function signedDist(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy);
}
const sgn = (v) => (v > EPS ? 1 : v < -EPS ? -1 : 0);

/** p 已在直線 ab 上時,投影是否落在線段內。 */
function onSegment(a, b, p) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
  return t >= -EPS && t <= len + EPS;
}

/** 兩線段是否相交或相碰(含端點相碰與共線重疊)。 */
function segmentsTouch(a, b, c, d) {
  const o1 = sgn(signedDist(a, b, c));
  const o2 = sgn(signedDist(a, b, d));
  const o3 = sgn(signedDist(c, d, a));
  const o4 = sgn(signedDist(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** 共用頂點 s 的兩條相鄰邊是否折返重疊(從 s 出發朝同一方向)。 */
function adjacentOverlap(s, p, q) {
  const ux = p[0] - s[0];
  const uy = p[1] - s[1];
  const vx = q[0] - s[0];
  const vy = q[1] - s[1];
  const collinear = Math.abs(ux * vy - uy * vx) / Math.hypot(ux, uy) <= EPS;
  return collinear && ux * vx + uy * vy > 0;
}

/** 所有頂點是否落在同一條直線上(距離容差 EPS)。 */
function allCollinear(ring) {
  const a = ring[0];
  let b = ring[1];
  for (const p of ring) if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(b[0] - a[0], b[1] - a[1])) b = p;
  return ring.every((p) => Math.abs(signedDist(a, b, p)) <= EPS);
}

/** 簡單多邊形檢查: 任兩條不相鄰的邊不相碰,相鄰邊不折返。 */
function ringIsSimple(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      const c = ring[j];
      const d = ring[(j + 1) % n];
      if (j === i + 1) {
        if (adjacentOverlap(b, a, d)) return false;
      } else if (i === 0 && j === n - 1) {
        if (adjacentOverlap(a, b, c)) return false;
      } else if (segmentsTouch(a, b, c, d)) {
        return false;
      }
    }
  }
  return true;
}

function distToSegment(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 'inside' | 'boundary' | 'outside'。邊界(容差 EPS 內)單獨一類,牆上的點不算牆外。 */
function classifyRing(ring, p) {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) if (distToSegment(ring[i], ring[(i + 1) % n], p) <= EPS) return 'boundary';
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

/** 內環的頂點與邊中點都不在外環之外(啟發式,只用於警告)。 */
function ringInside(inner, outer) {
  const n = inner.length;
  for (let i = 0; i < n; i += 1) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    if (classifyRing(outer, a) === 'outside') return false;
    if (classifyRing(outer, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) === 'outside') return false;
  }
  return true;
}

/** 多邊形檢查。通過回傳去重後的環,否則以 err 回報並回傳 null。 */
function checkPolygon(poly, path, err) {
  if (!Array.isArray(poly)) {
    err('polygon.notArray', path, `${path} 必須是頂點陣列 [[x,y],...]`);
    return null;
  }
  let bad = false;
  // Array.from: 稀疏陣列的空洞也要走到(forEach 會跳過,之後 ringOf 會撞 TypeError)
  Array.from(poly).forEach((p, i) => {
    if (!isPoint(p)) {
      err('polygon.point', `${path}[${i}]`, `${path}[${i}] 必須是 [x,y] 有限數: ${show(p)}`);
      bad = true;
    }
  });
  if (bad) return null;
  const ring = ringOf(poly);
  if (ring.length < 3) {
    err('polygon.tooFew', path, `${path} 的相異頂點少於 3 個`);
    return null;
  }
  // 先判共線再判自交: 蝴蝶結的有號面積會互相抵消成 0,但它是自交,不是退化
  if (allCollinear(ring)) {
    err('polygon.zeroArea', path, `${path} 面積為 0(所有頂點共線)`);
    return null;
  }
  if (!ringIsSimple(ring)) {
    err('polygon.selfIntersect', path, `${path} 自交或頂點相碰`);
    return null;
  }
  if (Math.abs(ringArea2(ring)) / 2 < EPS_AREA) {
    err('polygon.zeroArea', path, `${path} 面積為 0`);
    return null;
  }
  return ring;
}

function ringOrThrow(poly, path) {
  let first = null;
  const ring = checkPolygon(poly, path, (reason, p, message) => {
    first ??= message;
  });
  if (!ring) fail('INVALID_PLAN', first);
  return ring;
}

/**
 * 多邊形是否為合法簡單多邊形: 至少 3 個相異頂點、面積不為 0、不自交(含頂點相碰與折返)。
 * 頂點順序(順/逆時針)、首尾重複點皆可。
 * @param {Point[]} polygon
 * @returns {boolean}
 */
export function isSimplePolygon(polygon) {
  return checkPolygon(polygon, 'polygon', () => {}) !== null;
}

/**
 * 多邊形面積(平方公尺,恆為正)。
 * @param {Point[]} polygon
 * @returns {number}
 * @throws {Error} INVALID_PLAN 自交、頂點不足或面積為 0
 */
export function polygonArea(polygon) {
  return Math.abs(ringArea2(ringOrThrow(polygon, 'polygon'))) / 2;
}

/**
 * 多邊形面積重心。非凸多邊形的重心可能落在形外。
 * @param {Point[]} polygon
 * @returns {Point}
 * @throws {Error} INVALID_PLAN
 */
export function polygonCentroid(polygon) {
  return ringCentroid(ringOrThrow(polygon, 'polygon'));
}

/**
 * 點與多邊形的關係。邊界(容差 1e-9 公尺)獨立成一類。
 * @param {Point[]} polygon
 * @param {Point} point
 * @returns {'inside'|'boundary'|'outside'}
 * @throws {Error} INVALID_PLAN, INVALID_POINT
 */
export function pointInPolygon(polygon, point) {
  if (!isPoint(point)) fail('INVALID_POINT', `必須是 [x,y] 有限數: ${show(point)}`);
  return classifyRing(ringOrThrow(polygon, 'polygon'), point);
}

// ─────────────────────────── 平面圖驗證 ───────────────────────────

/**
 * 開口所在牆的實際牆段。牆名對應房間外接框的四邊(矩形時就是整面牆);
 * 非矩形房間(L 型)只有落在外接框邊上的邊才算牆,spans 是這些邊沿牆的區間(自外接框角起算)。
 */
function wallSpan(ring, wall) {
  const bb = ringBBox(ring);
  const horizontal = wall === 'bottom' || wall === 'top';
  const line = { bottom: bb.minY, top: bb.maxY, left: bb.minX, right: bb.maxX }[wall];
  const origin = horizontal ? bb.minX : bb.minY;
  const length = horizontal ? bb.maxX - bb.minX : bb.maxY - bb.minY;
  const raw = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const k = horizontal ? 1 : 0;
    const m = horizontal ? 0 : 1;
    if (Math.abs(a[k] - line) <= EPS && Math.abs(b[k] - line) <= EPS) {
      raw.push([Math.min(a[m], b[m]) - origin, Math.max(a[m], b[m]) - origin]);
    }
  }
  raw.sort((x, y) => x[0] - y[0]);
  const spans = [];
  for (const iv of raw) {
    const last = spans[spans.length - 1];
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1]);
    else spans.push([iv[0], iv[1]]);
  }
  return { horizontal, line, origin, length, spans };
}

const spanCovers = (spans, lo, hi) => spans.some(([a, b]) => a - EPS <= lo && hi <= b + EPS);

function wallPoint(span, pos) {
  const p = span.horizontal ? [span.origin + pos, span.line] : [span.line, span.origin + pos];
  return [p[0] + 0, p[1] + 0];
}

/** 依 plan 自己的模式或 settings.taijiMode 算出太極點(已確認外框合法)。 */
function computeTaiji(plan, ring, s) {
  const t = isObj(plan.taiji) ? plan.taiji : null;
  const mode = t && t.mode != null ? t.mode : s.taijiMode;
  if (!TAIJI_MODES.includes(mode)) fail('INVALID_TAIJI_MODE', `未知的太極點模式: ${show(mode)}`);
  let point;
  if (mode === 'centroid') {
    point = ringCentroid(ring);
  } else if (mode === 'bbox') {
    const b = ringBBox(ring);
    point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  } else {
    if (!t || !isPoint(t.manual)) fail('INVALID_PLAN', 'taiji.mode 為 manual 時 taiji.manual 必須是 [x,y]');
    point = [t.manual[0], t.manual[1]];
  }
  // 輸出經 JSON 往返必須不變: -0 會被 JSON 寫成 0,這裡先抹掉
  point = [point[0] + 0, point[1] + 0];
  const warnings = [];
  if (classifyRing(ring, point) === 'outside') warnings.push('taijiOutsideOutline');
  return { point, mode, warnings };
}

/**
 * 逐層檢查平面圖。level 1: 版本/單位/北向/外框/太極點;2: 再加房間;3: 再加開口、牆、主門。
 * 只回報不丟例外,呼叫者決定要不要丟。
 */
function inspect(plan, s, level) {
  const errors = [];
  const warnings = [];
  const err = (reason, path, message) => errors.push({ code: 'INVALID_PLAN', reason, path, message });
  const warn = (code, path, message) => warnings.push({ code, path, message });
  const out = { errors, warnings, outlineRing: null, rooms: [] };

  if (!isObj(plan)) {
    err('notObject', '$', `平面圖必須是物件: ${show(plan)}`);
    return out;
  }
  if (plan.version !== 1) err('version', 'version', `version 必須是 1: ${show(plan.version)}`);
  if (plan.unit != null && plan.unit !== 'm') err('unit', 'unit', `unit 只支援 "m": ${show(plan.unit)}`);
  if (plan.planUpBearing == null) {
    warn('planUpBearingUnknown', 'planUpBearing', 'planUpBearing 未知,只能做形狀分析,不輸出宮位');
  } else if (!isNum(plan.planUpBearing)) {
    err('planUpBearing', 'planUpBearing', `planUpBearing 必須是有限數字或 null: ${show(plan.planUpBearing)}`);
  }
  out.outlineRing = checkPolygon(plan.outline, 'outline', err);

  // 太極點欄位
  const t = plan.taiji;
  let taijiOk = true;
  if (t != null && !isObj(t)) {
    err('taiji.type', 'taiji', `taiji 必須是物件: ${show(t)}`);
    taijiOk = false;
  } else if (t != null) {
    if (t.mode != null && !TAIJI_MODES.includes(t.mode)) {
      err('taiji.mode', 'taiji.mode', `taiji.mode 必須是 ${TAIJI_MODES.join('/')}: ${show(t.mode)}`);
      taijiOk = false;
    }
    if (t.manual != null && !isPoint(t.manual)) {
      err('taiji.manual', 'taiji.manual', `taiji.manual 必須是 [x,y] 有限數: ${show(t.manual)}`);
      taijiOk = false;
    }
  }
  const effMode = taijiOk ? (isObj(t) && t.mode != null ? t.mode : s.taijiMode) : null;
  if (effMode === 'manual' && !(isObj(t) && isPoint(t.manual))) {
    err('taiji.manualMissing', 'taiji.manual', 'taiji.mode 為 manual 時必須提供 taiji.manual [x,y]');
  }
  if (out.outlineRing && TAIJI_MODES.includes(effMode) && !(effMode === 'manual' && !(isObj(t) && isPoint(t.manual)))) {
    if (computeTaiji(plan, out.outlineRing, s).warnings.length) {
      warn('taijiOutsideOutline', 'taiji', '太極點落在外框之外,建議改選外接框中心或手動點選');
    }
  }
  if (level < 2) return out;

  // 房間
  const roomById = new Map();
  if (plan.rooms != null) {
    if (!Array.isArray(plan.rooms)) {
      err('rooms.notArray', 'rooms', 'rooms 必須是陣列');
    } else {
      Array.from(plan.rooms).forEach((r, i) => {
        const path = `rooms[${i}]`;
        if (!isObj(r)) {
          err('room.notObject', path, `${path} 必須是物件`);
          return;
        }
        let id = null;
        if (typeof r.id !== 'string' || r.id === '' || r.id === '__proto__') {
          err('room.id', `${path}.id`, `${path}.id 必須是非空字串: ${show(r.id)}`);
        } else if (roomById.has(r.id)) {
          err('room.duplicateId', `${path}.id`, `房間 id 重複: ${r.id}`);
        } else {
          id = r.id;
        }
        if (!ROOM_TYPES.includes(r.type)) err('room.type', `${path}.type`, `${path}.type 未知: ${show(r.type)}`);
        const ring = checkPolygon(r.polygon, `${path}.polygon`, err);
        const entry = { id, type: r.type, ring };
        if (id !== null) roomById.set(id, entry);
        out.rooms.push(entry);
        // 陽台預設不併入 outline(2.7.2),不算超出
        if (ring && out.outlineRing && r.type !== 'balcony' && !ringInside(ring, out.outlineRing)) {
          warn('roomOutsideOutline', path, `房間 ${show(id)} 超出外框(陽台以外的房間應在外框內)`);
        }
      });
    }
  }
  if (level < 3) return out;

  // 開口
  const openingIds = new Map();
  const placed = [];
  if (plan.openings != null) {
    if (!Array.isArray(plan.openings)) {
      err('openings.notArray', 'openings', 'openings 必須是陣列');
    } else {
      Array.from(plan.openings).forEach((o, i) => {
        const path = `openings[${i}]`;
        if (!isObj(o)) {
          err('opening.notObject', path, `${path} 必須是物件`);
          return;
        }
        let ok = true;
        if (typeof o.id !== 'string' || o.id === '') {
          err('opening.id', `${path}.id`, `${path}.id 必須是非空字串: ${show(o.id)}`);
          ok = false;
        } else if (openingIds.has(o.id)) {
          err('opening.duplicateId', `${path}.id`, `開口 id 重複: ${o.id}`);
          ok = false;
        } else {
          openingIds.set(o.id, o);
        }
        if (!OPENING_KINDS.includes(o.kind)) {
          err('opening.kind', `${path}.kind`, `${path}.kind 未知: ${show(o.kind)}`);
          ok = false;
        }
        const room = typeof o.roomId === 'string' ? roomById.get(o.roomId) : undefined;
        if (!room) {
          err('opening.roomId', `${path}.roomId`, `${path}.roomId 找不到房間: ${show(o.roomId)}`);
          ok = false;
        }
        if (!WALL_NAMES.includes(o.wall)) {
          err('opening.wall', `${path}.wall`, `${path}.wall 必須是 ${WALL_NAMES.join('/')}: ${show(o.wall)}`);
          ok = false;
        }
        if (!isNum(o.pos)) {
          err('opening.pos', `${path}.pos`, `${path}.pos 必須是有限數字: ${show(o.pos)}`);
          ok = false;
        }
        if (!isNum(o.width) || o.width <= 0) {
          err('opening.width', `${path}.width`, `${path}.width 必須是大於 0 的有限數字: ${show(o.width)}`);
          ok = false;
        }
        if (ok && room.ring) {
          const span = wallSpan(room.ring, o.wall);
          const lo = o.pos - o.width / 2;
          const hi = o.pos + o.width / 2;
          if (!spanCovers(span.spans, lo, hi)) {
            err('opening.notOnWall', path, `${path} 的範圍 [${lo}, ${hi}] 不在房間 ${o.roomId} 的 ${o.wall} 牆上`);
          } else {
            placed.push({ path, roomId: o.roomId, wall: o.wall, lo, hi });
          }
        }
      });
    }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (a.roomId === b.roomId && a.wall === b.wall && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS) {
        warn('openingsOverlap', b.path, `${b.path} 與 ${a.path} 在同一面牆上重疊`);
      }
    }
  }

  // 牆
  if (plan.walls != null) {
    if (!Array.isArray(plan.walls)) {
      err('walls.notArray', 'walls', 'walls 必須是陣列');
    } else {
      Array.from(plan.walls).forEach((w, i) => {
        const path = `walls[${i}]`;
        if (!isObj(w)) {
          err('wall.notObject', path, `${path} 必須是物件`);
          return;
        }
        const seg = w.segment;
        if (!(Array.isArray(seg) && seg.length === 2 && isPoint(seg[0]) && isPoint(seg[1]) && !samePoint(seg[0], seg[1]))) {
          err('wall.segment', `${path}.segment`, `${path}.segment 必須是兩個相異的 [x,y]: ${show(seg)}`);
        }
        if (!WALL_KINDS.includes(w.kind)) err('wall.kind', `${path}.kind`, `${path}.kind 必須是 ${WALL_KINDS.join('/')}: ${show(w.kind)}`);
      });
    }
  }

  // 主門
  if (plan.mainDoor != null) {
    if (typeof plan.mainDoor !== 'string') {
      err('mainDoor.type', 'mainDoor', `mainDoor 必須是開口 id 字串: ${show(plan.mainDoor)}`);
    } else if (!openingIds.has(plan.mainDoor)) {
      err('mainDoor.unknown', 'mainDoor', `mainDoor 找不到開口: ${plan.mainDoor}`);
    } else if (openingIds.get(plan.mainDoor).kind !== 'entrance') {
      warn('mainDoorNotEntrance', 'mainDoor', `mainDoor ${plan.mainDoor} 的 kind 不是 entrance`);
    }
  }
  return out;
}

/**
 * 驗證平面圖資料結構(規格 2.7.1、2.7.5)。不丟例外,一次回報所有問題。
 * errors 是致命問題(分析函式會丟 INVALID_PLAN);warnings 不擋分析。
 * 檢查項: version=1、unit、planUpBearing(null 為未知,只給警告)、外框與各房間多邊形
 * (至少 3 個相異頂點、面積不為 0、不自交)、id 唯一、列舉值、開口必須落在該房間的牆段上、牆與 mainDoor 引用。
 * 警告碼: planUpBearingUnknown、taijiOutsideOutline、roomOutsideOutline(陽台除外)、
 * openingsOverlap、mainDoorNotEntrance。
 * @param {Plan} plan
 * @param {object} [settings] 流派開關覆寫(只看 taijiMode)
 * @returns {{ok:boolean, errors:{code:'INVALID_PLAN', reason:string, path:string, message:string}[], warnings:{code:string, path:string, message:string}[]}}
 */
export function validatePlan(plan, settings = {}) {
  const r = inspect(plan, resolveSettings(settings ?? {}), 3);
  return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings };
}

/**
 * 同 validatePlan,但有錯誤時丟出。
 * @param {Plan} plan
 * @param {object} [settings]
 * @returns {void}
 * @throws {Error} INVALID_PLAN(message 帶第一個問題)
 */
export function assertValidPlan(plan, settings = {}) {
  const r = inspect(plan, resolveSettings(settings ?? {}), 3);
  throwIfInvalid(r);
}

function throwIfInvalid(r) {
  if (r.errors.length) {
    const more = r.errors.length > 1 ? `(另有 ${r.errors.length - 1} 項問題)` : '';
    fail('INVALID_PLAN', `${r.errors[0].message}${more}`);
  }
}

/** 共用前置: 解設定、驗證到指定層級、算太極點與北向。 */
function prepare(plan, settings, level, needUncertainty) {
  const s = resolveSettings(settings ?? {});
  if (needUncertainty && !(isNum(s.measureUncertainty) && s.measureUncertainty >= 0)) {
    fail('INVALID_SETTING', `measureUncertainty 必須是非負有限數字: ${show(s.measureUncertainty)}`);
  }
  const r = inspect(plan, s, level);
  throwIfInvalid(r);
  const taiji = computeTaiji(plan, r.outlineRing, s);
  // geo.normalizeBearing 對 -0 原樣回傳 -0;+ 0 抹掉負零,輸出才與 JSON 往返一致
  const planUp = plan.planUpBearing == null ? null : normalizeBearing(plan.planUpBearing) + 0;
  return { s, r, taiji, planUp };
}

// ─────────────────────────── 太極點與宮位 ───────────────────────────

/**
 * 太極點(D55,設計決策,無來源)。模式取 plan.taiji.mode,沒有才用 settings.taijiMode:
 * centroid = outline 的面積重心(預設,凹形平面重心仍唯一)、bbox = 軸對齊外接框中心、manual = plan.taiji.manual。
 * 太極點在 outline 之外(非凸平面常見)時照常回傳並附警告 taijiOutsideOutline,牆上算牆內。
 * @param {Plan} plan
 * @param {object} [settings] 流派開關覆寫(taijiMode)
 * @returns {{point:Point, mode:'centroid'|'bbox'|'manual', warnings:string[]}}
 * @throws {Error} INVALID_PLAN, INVALID_TAIJI_MODE
 */
export function taijiPoint(plan, settings = {}) {
  const { taiji } = prepare(plan, settings, 1, false);
  return { point: taiji.point, mode: taiji.mode, warnings: taiji.warnings };
}

/** 方位角 → 宮位資訊;與太極點重合回 null。 */
function locate(pt, T, planUp, uncertainty) {
  const vx = pt[0] - T[0];
  const vy = pt[1] - T[1];
  const distance = Math.hypot(vx, vy);
  if (distance < EPS) return null;
  const bearing = normalizeBearing(planUp + (Math.atan2(vx, vy) * 180) / Math.PI);
  const { gua, dir8, index } = guaAt(bearing);
  const dev = circularDelta(bearing, 45 * index); // [-22.5,22.5)
  const boundaryDeg = HALF_SECTOR - Math.abs(dev);
  return {
    gua,
    dir8,
    index,
    bearing,
    distance,
    boundaryDeg,
    borderline: boundaryDeg < uncertainty,
    otherGua: GUA[(index + (dev >= 0 ? 1 : 7)) % 8],
  };
}

/**
 * 點所在的宮(規格 2.7.3 第 1、3 點)。bearing = planUpBearing + atan2(vx,vy),v = 點 - 太極點;
 * 半開區間,恰在扇區線上歸順時針下一宮。到最近扇區線的角度 < measureUncertainty 時 borderline=true
 * (文案提示「位置接近兩個方位的交界」)。點與太極點重合(< 1e-9 公尺)回 null。
 * 供 wealth 查角落與門窗的宮位;planUpBearing 未知時丟錯,呼叫者應先檢查。
 * @param {Plan} plan
 * @param {Point} point 平面座標 [x,y],公尺
 * @param {object} [settings] 流派開關覆寫(taijiMode、measureUncertainty)
 * @returns {SectorInfo|null}
 * @throws {Error} INVALID_PLAN, INVALID_POINT, INVALID_SETTING, INVALID_TAIJI_MODE, PLAN_UP_UNKNOWN
 */
export function sectorOfPoint(plan, point, settings = {}) {
  if (!isPoint(point)) fail('INVALID_POINT', `必須是 [x,y] 有限數: ${show(point)}`);
  const g = prepare(plan, settings, 1, true);
  if (g.planUp === null) fail('PLAN_UP_UNKNOWN', 'planUpBearing 未知,無法判定宮位');
  return locate(point, g.taiji.point, g.planUp, g.s.measureUncertainty);
}

// ─────────────────────────── 扇區面積佔比 ───────────────────────────

/** Sutherland-Hodgman 對單一半平面裁切: 保留 f(p) >= 0。凹多邊形可能留下零寬橋邊,面積仍正確。 */
function clipHalfPlane(ring, f) {
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const cur = ring[i];
    const nxt = ring[(i + 1) % ring.length];
    const fc = f(cur);
    const fn = f(nxt);
    if (fc >= 0) out.push(cur);
    if (fc >= 0 !== fn >= 0) {
      const t = fc / (fc - fn);
      out.push([cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])]);
    }
  }
  return out;
}

/**
 * 多邊形(已平移使太極點為原點)與第 k 宮楔形的交面積。楔形是凸的(45 度張角),
 * 由兩條過原點的半平面交成: 順時針側邊界 u0(方位 45k-22.5)之後、逆時針側邊界 u1(方位 45k+22.5)之前。
 */
function wedgeArea(rel, k, planUp) {
  const a0 = (45 * k - HALF_SECTOR - planUp) * RAD;
  const a1 = a0 + 45 * RAD;
  const s0 = Math.sin(a0);
  const c0 = Math.cos(a0);
  const s1 = Math.sin(a1);
  const c1 = Math.cos(a1);
  let p = clipHalfPlane(rel, (q) => c0 * q[0] - s0 * q[1]);
  if (p.length < 3) return 0;
  p = clipHalfPlane(p, (q) => s1 * q[1] - c1 * q[0]);
  if (p.length < 3) return 0;
  return Math.abs(ringArea2(p)) / 2;
}

/**
 * 各房間在 8 個宮的面積與佔比(規格 2.7.3 第 2、4 點)。
 * 每個房間多邊形與以太極點為頂點、45 度張角的 8 個楔形求交(Sutherland-Hodgman)。
 * 房間可以跨宮,以面積佔比表示,不強迫歸單一宮;沒有 rooms 時以 outline 當作單一房間 "outline"(警告 roomsMissing)。
 * 陽台等 outline 之外的房間照算(太極點只看 outline),totalArea 含它們、outlineArea 不含。
 * planUpBearing 未知時只輸出形狀分析(shares/palaces/palaceArea/mainUse 為 null,警告 planUpBearingUnknown)。
 *
 * 輸出: shares[roomId][gua] = 面積(m2);palaces[gua] = [{roomId, area, pct}](pct = 佔該宮面積,面積大到小,
 * 並列取 rooms 較前者;面積低於浮點雜訊的房間不列);palaceArea[gua] = 該宮總面積;mainUse[gua] = 佔比最大的
 * roomId,沒有房間佔到為 null。meta.ruleset 含實際採用的 taijiMode、measureUncertainty、northMode。
 * 面積不四捨五入(保持面積守恆),顯示時再取小數。
 * @param {Plan} plan
 * @param {object} [settings] 流派開關覆寫(taijiMode、measureUncertainty、northMode)
 * @returns {{taiji:Point, taijiMode:string, planUpBearing:(number|null), outlineArea:number, totalArea:number,
 *   roomAreas:Object<string,number>, shares:(Object<string,Object<string,number>>|null),
 *   palaces:(Object<string,{roomId:string, area:number, pct:number}[]>|null),
 *   palaceArea:(Object<string,number>|null), mainUse:(Object<string,(string|null)>|null),
 *   warnings:string[], meta:{schema:string, ruleset:object, northMode:string, warnings:string[]}}}
 * @throws {Error} INVALID_PLAN, INVALID_SETTING, INVALID_TAIJI_MODE
 */
export function sectorShares(plan, settings = {}) {
  const g = prepare(plan, settings, 2, true);
  const T = g.taiji.point;
  const warnings = [...g.taiji.warnings];
  let rooms = g.r.rooms;
  if (rooms.length === 0) {
    rooms = [{ id: 'outline', type: 'other', ring: g.r.outlineRing }];
    warnings.push('roomsMissing');
  }
  if (g.planUp === null) warnings.push('planUpBearingUnknown');

  const outlineArea = Math.abs(ringArea2(g.r.outlineRing)) / 2;
  const roomAreas = {};
  let totalArea = 0;
  const shares = g.planUp === null ? null : {};
  for (const room of rooms) {
    const area = Math.abs(ringArea2(room.ring)) / 2;
    roomAreas[room.id] = area;
    totalArea += area;
    if (shares) {
      const rel = room.ring.map((p) => [p[0] - T[0], p[1] - T[1]]);
      shares[room.id] = Object.fromEntries(GUA.map((gua, k) => [gua, wedgeArea(rel, k, g.planUp)]));
    }
  }

  let palaces = null;
  let palaceArea = null;
  let mainUse = null;
  if (shares) {
    palaces = {};
    palaceArea = {};
    mainUse = {};
    const noise = 1e-12 * Math.max(1, totalArea);
    for (const gua of GUA) {
      const entries = rooms.map((r, idx) => ({ roomId: r.id, area: shares[r.id][gua], idx })).filter((e) => e.area > noise);
      // 面積差在浮點雜訊內視為並列,依房間順序,避免對稱平面的 mainUse 隨機翻轉
      entries.sort((a, b) => (Math.abs(a.area - b.area) <= 1e-9 * Math.max(a.area, b.area) ? a.idx - b.idx : b.area - a.area));
      const listed = entries.reduce((sum, e) => sum + e.area, 0);
      // entries 每筆都 > noise(非負),listed 理論上必為正;仍擋一道,避免任何退化面積讓 NaN 進輸出(API.md 的數值契約)。
      const listedOk = Number.isFinite(listed) && listed > 0;
      palaces[gua] = entries.map((e) => ({ roomId: e.roomId, area: e.area, pct: listedOk ? e.area / listed : 0 }));
      palaceArea[gua] = rooms.reduce((sum, r) => sum + shares[r.id][gua], 0);
      mainUse[gua] = entries.length ? entries[0].roomId : null;
    }
  }

  return {
    taiji: [T[0], T[1]],
    taijiMode: g.taiji.mode,
    planUpBearing: g.planUp,
    outlineArea,
    totalArea,
    roomAreas,
    shares,
    palaces,
    palaceArea,
    mainUse,
    warnings,
    meta: {
      schema: PLAN_SCHEMA,
      ruleset: { taijiMode: g.taiji.mode, measureUncertainty: g.s.measureUncertainty, northMode: g.s.northMode },
      northMode: g.s.northMode,
      warnings: [...warnings],
    },
  };
}

// ─────────────────────────── 開口(門窗)的位置與宮位 ───────────────────────────

function findOpening(plan, r, openingId) {
  const o = (Array.isArray(plan.openings) ? plan.openings : []).find((x) => x.id === openingId);
  if (!o) fail('UNKNOWN_OPENING', `找不到開口: ${show(openingId)}`);
  const room = r.rooms.find((x) => x.id === o.roomId);
  const point = wallPoint(wallSpan(room.ring, o.wall), o.pos);
  return { id: o.id, kind: o.kind, roomId: o.roomId, wall: o.wall, pos: o.pos, width: o.width, point };
}

/**
 * 開口中心的平面座標。pos 是開口中心沿牆的距離,自該房間外接框左下角起算(見 Opening 型別)。
 * @param {Plan} plan
 * @param {string} openingId
 * @param {object} [settings] 只用於驗證時的模式判斷
 * @returns {{id:string, kind:string, roomId:string, wall:string, pos:number, width:number, point:Point}}
 * @throws {Error} INVALID_PLAN, UNKNOWN_OPENING
 */
export function openingCenter(plan, openingId, settings = {}) {
  const g = prepare(plan, settings, 3, false);
  return findOpening(plan, g.r, openingId);
}

/**
 * 開口(門、窗、落地窗…)中心所在的宮;中心距扇區線 < measureUncertainty 時 sector.borderline=true
 * (規格 2.7.3 第 3 點)。開口中心恰在太極點時 sector 為 null。
 * @param {Plan} plan
 * @param {string} openingId
 * @param {object} [settings] 流派開關覆寫(taijiMode、measureUncertainty)
 * @returns {{id:string, kind:string, roomId:string, wall:string, pos:number, width:number, point:Point, sector:(SectorInfo|null)}}
 * @throws {Error} INVALID_PLAN, INVALID_SETTING, UNKNOWN_OPENING, PLAN_UP_UNKNOWN
 */
export function sectorOfOpening(plan, openingId, settings = {}) {
  const g = prepare(plan, settings, 3, true);
  if (g.planUp === null) fail('PLAN_UP_UNKNOWN', 'planUpBearing 未知,無法判定宮位');
  const o = findOpening(plan, g.r, openingId);
  return { ...o, sector: locate(o.point, g.taiji.point, g.planUp, g.s.measureUncertainty) };
}

// ─────────────────────────── 北基準換算 ───────────────────────────

/**
 * 換算平面圖「上」的方位角到另一個北基準(規格 2.7.5: 切換 northMode 時 planUpBearing 要跟著換)。
 * magnetic→true 用 geo.toTrue(真 = 磁 + D),true→magnetic 用 geo.toMagnetic。回傳新物件,不改動輸入;
 * planUpBearing 未知則保持未知;基準相同原樣複製(不檢查偏角)。
 * @param {Plan} plan
 * @param {'magnetic'|'true'} fromMode
 * @param {'magnetic'|'true'} toMode
 * @param {number} declination 磁偏角(度),東偏為正
 * @returns {Plan}
 * @throws {Error} INVALID_PLAN, INVALID_NORTH_MODE, INVALID_DECLINATION
 */
export function convertPlanNorth(plan, fromMode, toMode, declination) {
  for (const m of [fromMode, toMode]) {
    if (!NORTH_MODES.includes(m)) fail('INVALID_NORTH_MODE', `必須是 ${NORTH_MODES.join('/')}: ${show(m)}`);
  }
  if (!isObj(plan)) fail('INVALID_PLAN', `平面圖必須是物件: ${show(plan)}`);
  // JSON 複製會把 NaN/Infinity 悄悄變成 null(= 方位未知),必須先擋
  if (plan.planUpBearing != null && !isNum(plan.planUpBearing)) {
    fail('INVALID_PLAN', `planUpBearing 必須是有限數字或 null: ${show(plan.planUpBearing)}`);
  }
  const out = JSON.parse(JSON.stringify(plan));
  if (out.planUpBearing == null || fromMode === toMode) return out;
  const converted = fromMode === 'magnetic' ? toTrue(out.planUpBearing, declination) : toMagnetic(out.planUpBearing, declination);
  out.planUpBearing = converted + 0;
  return out;
}

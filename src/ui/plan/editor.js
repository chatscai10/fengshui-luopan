// 平面圖編輯的純邏輯:吸附、命中測試、縮放手把、重疊與外框檢查、沿牆放置開口、還原堆疊。
// 這個檔案不碰 DOM,全部函式只吃資料、回傳資料,才能用 node 直接測。
//
// 座標約定同規格 2.6.2:x 向右、y 向上、單位公尺;牆名對應房間外接框的四邊
// bottom(y 最小) top(y 最大) left(x 最小) right(x 最大)。
// 開口的 pos 是「開口中心沿牆的距離,自房間外接框左下角起算」(src/core/plan.js 的 Opening 型別)。
// 畫布的 y 翻轉一律由 coords.js 與 planRenderer 負責,這裡完全不出現像素。
//
// 所有會改資料的函式(add/move/remove…)都直接改傳入的 plan,呼叫者要先複製一份草稿;
// 失敗時回傳 { error: '白話說明' },呼叫者丟掉草稿就等於還原。

import { validatePlan } from '../../core/plan.js';
import {
  ROOM_TYPE_LABEL, ROOM_TYPE_ORDER, ROOM_DEFAULT_SIZE, OPENING_LABEL, OPENING_DEFAULT_WIDTH, roomDisplayName,
} from './labels.js';

export const GRID = 0.1;         // 吸附格距(公尺)
export const MIN_ROOM = 0.6;     // 房間最小邊長
export const MAX_ROOM = 40;      // 房間最大邊長
export const MAX_COORD = 200;    // 座標絕對值上限,避免貼上怪數字把畫面撐爆
export const MIN_OPENING = 0.4;  // 開口最小寬度
export const MAX_OPENING = 4;    // 開口最大寬度

const OVERLAP_EPS = 1e-4;
const NEAR_EPS = 1e-6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

// ───────────────────────── 基本幾何 ─────────────────────────

/** 吸附到格點並去掉浮點雜訊(0.1*3 不會變 0.30000000000000004)。壞值回 0。 */
export function snap(v, step = GRID) {
  if (!isNum(v) || !isNum(step) || step <= 0) return 0;
  // 加一點點偏移,讓 0.35 這類剛好在中間的值一致地進位(0.35/0.1 在浮點是 3.4999999999999996)
  const q = v / step;
  return round3(Math.round(q + Math.sign(q) * 1e-9) * step);
}

export function planRooms(plan) {
  return plan && Array.isArray(plan.rooms) ? plan.rooms.filter((r) => r && Array.isArray(r.polygon)) : [];
}

export function planOpenings(plan) {
  return plan && Array.isArray(plan.openings) ? plan.openings.filter((o) => o && typeof o === 'object') : [];
}

/** 多邊形的外接矩形;點數不足或有壞座標回 null */
export function rectOfPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (!isPt(p)) return null;
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

/** 矩形轉成逆時針四頂點 */
export function polygonOfRect(r) {
  return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
}

/** 是不是軸向矩形(編輯器只會產生這種;備份匯入的特殊形狀不能拖曳) */
export function isAxisRect(poly) {
  const r = rectOfPolygon(poly);
  if (!r) return false;
  const pts = poly.filter((p, i) => i === 0 || Math.abs(p[0] - poly[i - 1][0]) > NEAR_EPS || Math.abs(p[1] - poly[i - 1][1]) > NEAR_EPS);
  if (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) <= NEAR_EPS && Math.abs(pts[0][1] - pts[pts.length - 1][1]) <= NEAR_EPS) pts.pop();
  if (pts.length !== 4) return false;
  let a2 = 0;
  for (let i = 0; i < 4; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % 4];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  const area = Math.abs(a2) / 2;
  return Math.abs(area - (r.x1 - r.x0) * (r.y1 - r.y0)) < 1e-6;
}

export function roomRect(room) {
  return room ? rectOfPolygon(room.polygon) : null;
}

export const rectArea = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
export const rectCenter = (r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
const rectContains = (r, p, tol = 0) => p[0] >= r.x0 - tol && p[0] <= r.x1 + tol && p[1] >= r.y0 - tol && p[1] <= r.y1 + tol;

/** 兩個矩形是否「有面積的重疊」(只是貼著邊不算) */
export function rectsOverlap(a, b, eps = OVERLAP_EPS) {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > eps && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > eps;
}

/** 所有重疊的房間配對 [[idA,idB],…] */
export function findOverlaps(plan) {
  const rooms = planRooms(plan).map((r) => ({ id: r.id, rect: roomRect(r) })).filter((r) => r.rect);
  const out = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if (rectsOverlap(rooms[i].rect, rooms[j].rect)) out.push([rooms[i].id, rooms[j].id]);
    }
  }
  return out;
}

/** 外框:所有非陽台房間的外接矩形(沒有房間時保留原外框) */
export function outlineRectOf(plan) {
  const rooms = planRooms(plan);
  const main = rooms.filter((r) => r.type !== 'balcony');
  const src = main.length ? main : rooms;
  let box = null;
  for (const r of src) {
    const rc = roomRect(r);
    if (!rc) continue;
    box = box
      ? { x0: Math.min(box.x0, rc.x0), y0: Math.min(box.y0, rc.y0), x1: Math.max(box.x1, rc.x1), y1: Math.max(box.y1, rc.y1) }
      : { ...rc };
  }
  return box || (plan && Array.isArray(plan.outline) ? rectOfPolygon(plan.outline) : null);
}

/** 讓外框跟著房間走(外框是房間外接矩形,陽台不算) */
export function fitOutline(plan) {
  const box = outlineRectOf(plan);
  if (box && rectArea(box) > 0) plan.outline = polygonOfRect(box);
  return plan;
}

/** 超出外框的房間(陽台除外)。外框自動跟著房間走時通常為空,匯入外部資料時才有用。 */
export function roomsOutsideOutline(plan) {
  const ob = plan && Array.isArray(plan.outline) ? rectOfPolygon(plan.outline) : null;
  if (!ob) return [];
  const out = [];
  for (const r of planRooms(plan)) {
    if (r.type === 'balcony') continue;
    const rc = roomRect(r);
    if (rc && (rc.x0 < ob.x0 - 1e-6 || rc.y0 < ob.y0 - 1e-6 || rc.x1 > ob.x1 + 1e-6 || rc.y1 > ob.y1 + 1e-6)) out.push(r.id);
  }
  return out;
}

/** 畫面要涵蓋的範圍:外框 + 陽台等所有房間 */
export function contentBounds(plan) {
  let box = null;
  const add = (rc) => {
    if (!rc) return;
    box = box
      ? { x0: Math.min(box.x0, rc.x0), y0: Math.min(box.y0, rc.y0), x1: Math.max(box.x1, rc.x1), y1: Math.max(box.y1, rc.y1) }
      : { ...rc };
  };
  if (plan && Array.isArray(plan.outline)) add(rectOfPolygon(plan.outline));
  for (const r of planRooms(plan)) add(roomRect(r));
  if (!box) box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { minX: box.x0, minY: box.y0, maxX: box.x1, maxY: box.y1 };
}

// ───────────────────────── 牆與開口 ─────────────────────────

export const WALLS = Object.freeze(['bottom', 'top', 'left', 'right']);
const isHorizontal = (wall) => wall === 'bottom' || wall === 'top';

export function wallLength(rect, wall) {
  return isHorizontal(wall) ? rect.x1 - rect.x0 : rect.y1 - rect.y0;
}

/** 牆上距離 along(自左下角起算)對應的平面座標 */
export function wallPointAt(rect, wall, along) {
  switch (wall) {
    case 'bottom': return [rect.x0 + along, rect.y0];
    case 'top': return [rect.x0 + along, rect.y1];
    case 'left': return [rect.x0, rect.y0 + along];
    default: return [rect.x1, rect.y0 + along];
  }
}

/** 牆朝房間內側的單位法向量 */
export function inwardNormal(wall) {
  switch (wall) {
    case 'bottom': return [0, 1];
    case 'top': return [0, -1];
    case 'left': return [1, 0];
    default: return [-1, 0];
  }
}

/** 點 p 對某面牆的投影(沿牆距離,已夾在牆長內)與垂直距離 */
function projectOnWall(rect, wall, p) {
  const L = wallLength(rect, wall);
  const a = wallPointAt(rect, wall, 0);
  const t = isHorizontal(wall) ? p[0] - a[0] : p[1] - a[1];
  const along = clamp(t, 0, L);
  const q = wallPointAt(rect, wall, along);
  return { along, dist: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/** 開口在圖上的幾何:中心、兩端、朝內法向。找不到房間或房間不是矩形回 null。 */
export function openingGeom(plan, o) {
  const room = planRooms(plan).find((r) => r.id === o.roomId);
  if (!room || !isAxisRect(room.polygon)) return null;
  const rect = roomRect(room);
  if (!WALLS.includes(o.wall) || !isNum(o.pos) || !isNum(o.width)) return null;
  const half = o.width / 2;
  return {
    rect,
    wall: o.wall,
    length: wallLength(rect, o.wall),
    center: wallPointAt(rect, o.wall, o.pos),
    a: wallPointAt(rect, o.wall, o.pos - half),
    b: wallPointAt(rect, o.wall, o.pos + half),
    normal: inwardNormal(o.wall),
  };
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 命中哪個開口(距離以公尺計,tol 由呼叫者用像素換算);沒有回 null */
export function hitOpening(plan, p, tol) {
  if (!isPt(p)) return null;
  let best = null;
  for (const o of planOpenings(plan)) {
    const g = openingGeom(plan, o);
    if (!g) continue;
    const d = distToSegment(p, g.a, g.b);
    if (d <= tol && (!best || d < best.d)) best = { id: o.id, d };
  }
  return best ? best.id : null;
}

/** 命中哪個房間(內部);重疊時取面積最小的,才點得到疊在大房間裡的小房間 */
export function hitRoom(plan, p) {
  if (!isPt(p)) return null;
  let best = null;
  for (const r of planRooms(plan)) {
    const rc = roomRect(r);
    if (rc && rectContains(rc, p)) {
      const a = rectArea(rc);
      if (!best || a < best.a) best = { id: r.id, a };
    }
  }
  return best ? best.id : null;
}

/** p 附近所有房間的牆,近的在前。每筆:{ roomId, wall, along, dist } */
export function wallCandidates(plan, p, tol) {
  if (!isPt(p)) return [];
  const out = [];
  for (const r of planRooms(plan)) {
    if (!isAxisRect(r.polygon)) continue;
    const rc = roomRect(r);
    for (const wall of WALLS) {
      const { along, dist } = projectOnWall(rc, wall, p);
      if (dist <= tol) out.push({ roomId: r.id, wall, along, dist });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** 某房間某面牆上、距離 along 的點,是否同時也是別的房間的邊界(共用牆) */
function isSharedWall(plan, roomId, wall, along) {
  const room = planRooms(plan).find((r) => r.id === roomId);
  const rc = room && roomRect(room);
  if (!rc) return false;
  const pt = wallPointAt(rc, wall, along);
  for (const other of planRooms(plan)) {
    if (other.id === roomId) continue;
    const oc = roomRect(other);
    if (!oc || !rectContains(oc, pt, NEAR_EPS)) continue;
    const onEdge = Math.abs(pt[0] - oc.x0) < NEAR_EPS || Math.abs(pt[0] - oc.x1) < NEAR_EPS || Math.abs(pt[1] - oc.y0) < NEAR_EPS || Math.abs(pt[1] - oc.y1) < NEAR_EPS;
    if (onEdge) return true;
  }
  return false;
}

// 室內門開在共用牆時,歸給比較「私密」的房間(臥室的門通往客廳,而不是客廳多一扇門)
const PRIVACY = { bedroom: 0, study: 0, toilet: 0, kitchen: 1, other: 2, balcony: 2, stair: 2, living: 3, entry: 4 };

function pickWallCandidate(plan, cands, kind, preferRoomId) {
  const best = cands[0].dist;
  if (preferRoomId) {
    const pref = cands.find((c) => c.roomId === preferRoomId && c.dist <= best + 0.15);
    if (pref) return pref;
  }
  const near = cands.filter((c) => c.dist <= best + 0.05);
  if (near.length === 1) return near[0];
  const typeOf = (id) => (planRooms(plan).find((r) => r.id === id) || {}).type;
  const scored = near.map((c) => {
    const shared = isSharedWall(plan, c.roomId, c.wall, c.along);
    const priv = PRIVACY[typeOf(c.roomId)] ?? 2;
    // 窗與大門偏好外牆;室內門偏好私密房間
    const score = kind === 'door' ? priv : (shared ? 10 : 0) + priv * 0.01;
    return { c, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0].c;
}

/** 同一面牆上與 [lo,hi] 重疊的其他開口 id */
export function openingConflicts(plan, roomId, wall, lo, hi, ignoreId = null) {
  return planOpenings(plan)
    .filter((o) => o.roomId === roomId && o.wall === wall && o.id !== ignoreId && isNum(o.pos) && isNum(o.width))
    .filter((o) => Math.min(hi, o.pos + o.width / 2) - Math.max(lo, o.pos - o.width / 2) > 1e-6)
    .map((o) => o.id);
}

/**
 * 在牆上找一個放得下的位置:想放的地方被別的門窗佔住時,往旁邊最近的空隙挪;
 * 空隙比預設寬度窄就把新開口縮窄(不小於 MIN_OPENING);挪太遠(超過 1.5 倍寬度)就放棄。
 * @returns {{pos:number, width:number}|null}
 */
export function fitOnWall(plan, roomId, wall, length, want, width, ignoreId = null) {
  const blocks = planOpenings(plan)
    .filter((o) => o.roomId === roomId && o.wall === wall && o.id !== ignoreId && isNum(o.pos) && isNum(o.width))
    .map((o) => [o.pos - o.width / 2, o.pos + o.width / 2])
    .sort((a, b) => a[0] - b[0]);
  const free = [];
  let cur = 0;
  for (const [lo, hi] of blocks) {
    if (lo > cur) free.push([cur, lo]);
    cur = Math.max(cur, hi);
  }
  if (cur < length) free.push([cur, length]);
  let best = null;
  for (const [a, b] of free) {
    const len = b - a;
    if (len < MIN_OPENING - 1e-9) continue;
    const w = Math.min(width, len);
    const pos = clamp(want, a + w / 2, b - w / 2);
    const cost = Math.abs(pos - want) + (width - w) * 2;
    if (!best || cost < best.cost) best = { pos: round3(pos), width: round3(w), cost, shift: Math.abs(pos - want) };
  }
  if (!best || best.shift > Math.max(1.5, width * 1.5)) return null;
  return { pos: best.pos, width: best.width };
}

function uniqueId(prefix, used) {
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

const OPENING_PREFIX = { entrance: 'd', door: 'd', balconyDoor: 'b', window: 'w', floorWindow: 'f' };

/**
 * 在點 p 附近的牆上放一個開口。大門會同時成為 mainDoor,原本的大門降為室內門。
 * @returns {{ok:true, opening:object}|{error:string}}
 */
export function placeOpening(plan, kind, p, { preferRoomId = null, tol = 0.4, width = null } = {}) {
  if (!OPENING_LABEL[kind]) return { error: '不認得這種門窗' };
  const cands = wallCandidates(plan, p, tol);
  if (!cands.length) return { error: '請點在房間的牆上' };
  const c = pickWallCandidate(plan, cands, kind, preferRoomId);
  const room = planRooms(plan).find((r) => r.id === c.roomId);
  const rc = roomRect(room);
  const L = wallLength(rc, c.wall);
  const wantW = isNum(width) ? width : OPENING_DEFAULT_WIDTH[kind];
  const w = round3(Math.min(wantW, L));
  if (w < MIN_OPENING) return { error: '這面牆太短,放不下這個開口' };
  const want = round3(clamp(snap(c.along), w / 2, L - w / 2));
  const fit = fitOnWall(plan, c.roomId, c.wall, L, want, w);
  if (!fit) return { error: '這個位置已經有門或窗了,請換個地方' };
  const pos = fit.pos;
  if (!Array.isArray(plan.openings)) plan.openings = [];
  const used = new Set(plan.openings.map((o) => o.id));
  const opening = { id: uniqueId(OPENING_PREFIX[kind], used), kind: kind === 'entrance' ? 'door' : kind, roomId: c.roomId, wall: c.wall, pos, width: fit.width };
  plan.openings.push(opening);
  if (kind === 'entrance') setMainDoor(plan, opening.id);
  return { ok: true, opening };
}

/** 沿原本那面牆拖動開口 */
export function moveOpening(plan, id, p) {
  const o = planOpenings(plan).find((x) => x.id === id);
  if (!o) return { error: '找不到這個門窗' };
  const g = openingGeom(plan, o);
  if (!g || !isPt(p)) return { error: '這個門窗目前不能移動' };
  const L = g.length;
  const w = Math.min(o.width, L);
  const along = projectOnWall(g.rect, o.wall, p).along;
  const pos = round3(clamp(snap(along), w / 2, L - w / 2));
  if (openingConflicts(plan, o.roomId, o.wall, pos - w / 2, pos + w / 2, id).length) return { error: '那裡已經有門或窗了' };
  o.pos = pos;
  return { ok: true, opening: o };
}

/** 改開口寬度(中心不動,必要時往牆內推) */
export function resizeOpening(plan, id, width) {
  const o = planOpenings(plan).find((x) => x.id === id);
  if (!o) return { error: '找不到這個門窗' };
  const g = openingGeom(plan, o);
  if (!g || !isNum(width)) return { error: '這個門窗目前不能調整' };
  const L = g.length;
  const w = round3(clamp(snap(width, 0.05), MIN_OPENING, Math.min(MAX_OPENING, L)));
  const pos = round3(clamp(o.pos, w / 2, L - w / 2));
  if (openingConflicts(plan, o.roomId, o.wall, pos - w / 2, pos + w / 2, id).length) return { error: '再寬就會碰到旁邊的門窗' };
  o.width = w;
  o.pos = pos;
  return { ok: true, opening: o };
}

/** 設為大門:整張圖只會有一個大門 */
export function setMainDoor(plan, id) {
  const o = planOpenings(plan).find((x) => x.id === id);
  if (!o) return { error: '找不到這個門' };
  for (const x of planOpenings(plan)) if (x.kind === 'entrance') x.kind = 'door';
  o.kind = 'entrance';
  plan.mainDoor = o.id;
  return { ok: true, opening: o };
}

/** 換開口種類。變成大門時等同「設為大門」;原本的大門被換掉時清掉 mainDoor。 */
export function changeOpeningKind(plan, id, kind) {
  if (!OPENING_LABEL[kind]) return { error: '不認得這種門窗' };
  if (kind === 'entrance') return setMainDoor(plan, id);
  const o = planOpenings(plan).find((x) => x.id === id);
  if (!o) return { error: '找不到這個門窗' };
  o.kind = kind;
  if (plan.mainDoor === id) plan.mainDoor = null;
  return { ok: true, opening: o };
}

export function removeOpening(plan, id) {
  if (!Array.isArray(plan.openings)) return { error: '找不到這個門窗' };
  const n = plan.openings.length;
  plan.openings = plan.openings.filter((o) => o.id !== id);
  if (plan.openings.length === n) return { error: '找不到這個門窗' };
  if (plan.mainDoor === id) plan.mainDoor = null;
  return { ok: true };
}

// ───────────────────────── 房間的移動與縮放 ─────────────────────────

/** 8 個手把的位置(平面座標) */
export function handlePoints(r) {
  const mx = (r.x0 + r.x1) / 2;
  const my = (r.y0 + r.y1) / 2;
  return { nw: [r.x0, r.y1], n: [mx, r.y1], ne: [r.x1, r.y1], e: [r.x1, my], se: [r.x1, r.y0], s: [mx, r.y0], sw: [r.x0, r.y0], w: [r.x0, my] };
}

/** 命中哪個手把(角優先於邊);沒有回 null */
export function hitHandle(rect, p, tol) {
  if (!rect || !isPt(p)) return null;
  const pts = handlePoints(rect);
  let best = null;
  for (const name of HANDLES) {
    const d = Math.hypot(p[0] - pts[name][0], p[1] - pts[name][1]);
    if (d <= tol && (!best || d < best.d - 1e-9)) best = { name, d };
  }
  return best ? best.name : null;
}

/** 整體平移(位移吸附到 0.1,大小不變) */
export function moveRect(rect, dx, dy) {
  const sx = isNum(dx) ? snap(rect.x0 + dx) - rect.x0 : 0;
  const sy = isNum(dy) ? snap(rect.y0 + dy) - rect.y0 : 0;
  return { x0: round3(rect.x0 + sx), y0: round3(rect.y0 + sy), x1: round3(rect.x1 + sx), y1: round3(rect.y1 + sy) };
}

/** 拖某個手把到 p(吸附 0.1),對邊不動;夾在最小與最大尺寸之間 */
export function resizeRect(rect, handle, p, min = MIN_ROOM, max = MAX_ROOM) {
  if (!HANDLES.includes(handle) || !isPt(p)) return { ...rect };
  const px = snap(p[0]);
  const py = snap(p[1]);
  let { x0, y0, x1, y1 } = rect;
  if (handle.includes('w')) x0 = clamp(px, x1 - max, x1 - min);
  if (handle.includes('e')) x1 = clamp(px, x0 + min, x0 + max);
  if (handle.includes('s')) y0 = clamp(py, y1 - max, y1 - min);
  if (handle.includes('n')) y1 = clamp(py, y0 + min, y0 + max);
  return { x0: round3(x0), y0: round3(y0), x1: round3(x1), y1: round3(y1) };
}

/**
 * 房間外接框改變後,讓房間裡的門窗留在「同一個絕對位置」;放不下就縮窄,再放不下就移除。
 * @returns {string[]} 被移除的開口 id
 */
export function reflowOpenings(plan, roomId, oldRect, newRect) {
  const removed = [];
  const keep = [];
  for (const o of planOpenings(plan)) {
    if (o.roomId !== roomId || !WALLS.includes(o.wall) || !isNum(o.pos) || !isNum(o.width)) { keep.push(o); continue; }
    const abs = isHorizontal(o.wall) ? oldRect.x0 + o.pos : oldRect.y0 + o.pos;
    const origin = isHorizontal(o.wall) ? newRect.x0 : newRect.y0;
    const L = wallLength(newRect, o.wall);
    const w = Math.min(o.width, L);
    if (w < MIN_OPENING) { removed.push(o.id); continue; }
    o.width = round3(w);
    o.pos = round3(clamp(abs - origin, w / 2, L - w / 2));
    keep.push(o);
  }
  if (Array.isArray(plan.openings)) plan.openings = keep;
  if (removed.includes(plan.mainDoor)) plan.mainDoor = null;
  return removed;
}

/** 把房間改成新矩形(移動或縮放的最後一步):檢查大小、範圍、重疊,更新門窗與外框 */
export function applyRoomRect(plan, roomId, newRect) {
  const room = planRooms(plan).find((r) => r.id === roomId);
  if (!room) return { error: '找不到這個房間' };
  if (!isAxisRect(room.polygon)) return { error: '這個房間的形狀比較特別,目前不能拖曳修改。可以刪除後重新畫一個。' };
  const w = newRect.x1 - newRect.x0;
  const d = newRect.y1 - newRect.y0;
  if (![newRect.x0, newRect.y0, newRect.x1, newRect.y1].every(isNum)) return { error: '房間位置不正確' };
  if (w < MIN_ROOM - 1e-9 || d < MIN_ROOM - 1e-9) return { error: `房間至少要 ${MIN_ROOM} 公尺寬` };
  if (w > MAX_ROOM + 1e-9 || d > MAX_ROOM + 1e-9) return { error: `房間最大 ${MAX_ROOM} 公尺` };
  if ([newRect.x0, newRect.y0, newRect.x1, newRect.y1].some((v) => Math.abs(v) > MAX_COORD)) return { error: '房間離原點太遠了' };
  const old = roomRect(room);
  room.polygon = polygonOfRect(newRect);
  const removed = reflowOpenings(plan, roomId, old, newRect);
  const other = findOverlaps(plan).find((pair) => pair.includes(roomId));
  if (other) {
    const otherId = other[0] === roomId ? other[1] : other[0];
    const nm = (id) => roomDisplayName(plan, planRooms(plan).find((r) => r.id === id));
    return { error: `「${nm(roomId)}」不能和「${nm(otherId)}」重疊` };
  }
  fitOutline(plan);
  return { ok: true, removed };
}

// ───────────────────────── 新增 / 刪除房間 ─────────────────────────

function uniqueRoomId(plan) {
  return uniqueId('r', new Set(planRooms(plan).map((r) => r.id)));
}

/** 為新房間找一個不重疊、貼著現有房間、盡量不把外框撐大的位置 */
export function findFreeSpot(plan, w, d, type = 'other') {
  const rects = planRooms(plan).map(roomRect).filter(Boolean);
  if (!rects.length) return { x0: 0, y0: 0, x1: round3(w), y1: round3(d) };
  const ob = outlineRectOf(plan);
  const oc = rectCenter(ob);
  const cand = [];
  for (const r of rects) {
    const xs = [r.x0, r.x1 - w];
    const ys = [r.y0, r.y1 - d];
    for (const x of xs) {
      cand.push({ x0: x, y0: r.y1 });          // 上方
      cand.push({ x0: x, y0: r.y0 - d });      // 下方
    }
    for (const y of ys) {
      cand.push({ x0: r.x1, y0: y });          // 右方
      cand.push({ x0: r.x0 - w, y0: y });      // 左方
    }
  }
  let best = null;
  for (const c of cand) {
    const rect = { x0: snap(c.x0), y0: snap(c.y0), x1: 0, y1: 0 };
    rect.x1 = round3(rect.x0 + w);
    rect.y1 = round3(rect.y0 + d);
    if (rects.some((r) => rectsOverlap(r, rect))) continue;
    if ([rect.x0, rect.y0, rect.x1, rect.y1].some((v) => Math.abs(v) > MAX_COORD)) continue;
    const grown = {
      x0: Math.min(ob.x0, rect.x0), y0: Math.min(ob.y0, rect.y0), x1: Math.max(ob.x1, rect.x1), y1: Math.max(ob.y1, rect.y1),
    };
    const extra = type === 'balcony' ? 0 : rectArea(grown) - rectArea(ob);
    const dc = Math.hypot(rectCenter(rect)[0] - oc[0], rectCenter(rect)[1] - oc[1]);
    // 陽台喜歡貼在下緣(後方);其他房間偏好不撐大外框
    const bias = type === 'balcony' ? (rect.y1 <= ob.y0 + 1e-6 ? -5 : 0) : 0;
    const score = extra * 1 + dc + bias;
    if (!best || score < best.score) best = { rect, score };
  }
  if (best) return best.rect;
  const x0 = snap(ob.x1 + 0.5);
  return { x0, y0: snap(ob.y0), x1: round3(x0 + w), y1: round3(snap(ob.y0) + d) };
}

export function addRoom(plan, type) {
  if (!ROOM_TYPE_LABEL[type]) return { error: '不認得這種房間' };
  if (planRooms(plan).length >= 40) return { error: '房間太多了,最多 40 間' };
  const [w, d] = ROOM_DEFAULT_SIZE[type];
  const rect = findFreeSpot(plan, w, d, type);
  const room = { id: uniqueRoomId(plan), type, polygon: polygonOfRect(rect) };
  if (!Array.isArray(plan.rooms)) plan.rooms = [];
  plan.rooms.push(room);
  fitOutline(plan);
  return { ok: true, room };
}

export function removeRoom(plan, id) {
  const rooms = planRooms(plan);
  if (!rooms.some((r) => r.id === id)) return { error: '找不到這個房間' };
  if (rooms.length <= 1) return { error: '至少要留一個房間。想重來的話,請用「換一個範本」。' };
  plan.rooms = plan.rooms.filter((r) => r.id !== id);
  const gone = planOpenings(plan).filter((o) => o.roomId === id).map((o) => o.id);
  plan.openings = planOpenings(plan).filter((o) => o.roomId !== id);
  if (gone.includes(plan.mainDoor)) plan.mainDoor = null;
  fitOutline(plan);
  return { ok: true, removedOpenings: gone };
}

export function setRoomType(plan, id, type) {
  const room = planRooms(plan).find((r) => r.id === id);
  if (!room) return { error: '找不到這個房間' };
  if (!ROOM_TYPE_LABEL[type]) return { error: '不認得這種房間' };
  room.type = type;
  fitOutline(plan); // 陽台不算進外框,換類型會改變外框
  return { ok: true };
}

/** 房間取名:空字串代表用預設名稱;過長截斷,控制字元拿掉 */
export function setRoomName(plan, id, name) {
  const room = planRooms(plan).find((r) => r.id === id);
  if (!room) return { error: '找不到這個房間' };
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  if (clean) room.name = clean;
  else delete room.name;
  return { ok: true };
}

// ───────────────────────── 太極點 ─────────────────────────

/** 手動指定太極點(切成 manual 模式) */
export function setTaijiManual(plan, p) {
  if (!isPt(p)) return { error: '太極點的位置不正確' };
  const x = clamp(snap(p[0]), -MAX_COORD, MAX_COORD);
  const y = clamp(snap(p[1]), -MAX_COORD, MAX_COORD);
  plan.taiji = { mode: 'manual', manual: [x, y] };
  return { ok: true };
}

/** 回到自動:'centroid'(面積重心)或 'bbox'(外框中心) */
export function setTaijiAuto(plan, mode = 'centroid') {
  plan.taiji = { mode: mode === 'bbox' ? 'bbox' : 'centroid', manual: null };
  return { ok: true };
}

// ───────────────────────── 驗證(寫入 store 前) ─────────────────────────

const PROBLEM_TEXT = [
  ['polygon.', '有房間的形狀不對(邊數不足、線條交叉或面積是 0)'],
  ['room.duplicateId', '有兩個房間重複了'],
  ['room', '房間資料不完整'],
  ['opening.notOnWall', '有門或窗沒有落在牆上'],
  ['opening.roomId', '有門或窗找不到所屬的房間'],
  ['opening', '門窗資料有問題(位置、寬度或種類不正確)'],
  ['wall', '牆的資料有問題'],
  ['mainDoor', '標示的大門找不到'],
  ['taiji', '太極點的位置不正確'],
];

const WARNING_TEXT = {
  roomOutsideOutline: '有房間超出外框',
  openingsOverlap: '有門窗在同一面牆上重疊了',
  mainDoorNotEntrance: '大門標示和門的種類對不上',
  taijiOutsideOutline: '太極點落在外框之外',
};

/** validatePlan 的回報轉白話 */
export function describeProblems(v) {
  const errs = v && Array.isArray(v.errors) ? v.errors : [];
  const seen = [];
  for (const e of errs) {
    const reason = String(e.reason || '');
    const hit = PROBLEM_TEXT.find(([k]) => reason.startsWith(k));
    const text = hit ? hit[1] : '平面圖的基本資料不完整';
    if (!seen.includes(text)) seen.push(text);
  }
  return seen.join('、');
}

/** 需要提醒使用者但不擋存檔的警告(白話) */
export function describeWarnings(v) {
  const out = [];
  for (const w of (v && v.warnings) || []) {
    const t = WARNING_TEXT[w.code];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 拿掉 UI 專用欄位,並補上引擎必填的 planUpBearing(實際數值由 store.input() 依朝向算) */
export function enginePlanOf(plan) {
  const { upMode, upOffset, ...core } = plan || {};
  return { ...core, planUpBearing: isNum(core.planUpBearing) ? core.planUpBearing : 0 };
}

/**
 * 編輯後、寫入 store 之前的檢查:引擎的 validatePlan + 房間不可重疊。
 * @returns {{ok:boolean, message:string, warnings:string[]}}
 */
export function checkEditedPlan(plan) {
  let v;
  try {
    v = validatePlan(enginePlanOf(plan));
  } catch (e) {
    return { ok: false, message: '平面圖資料不正確', warnings: [] };
  }
  if (!v.ok) return { ok: false, message: `這樣改會讓平面圖出問題:${describeProblems(v)}`, warnings: [] };
  const ov = findOverlaps(plan);
  if (ov.length) return { ok: false, message: '房間不能重疊', warnings: [] };
  return { ok: true, message: '', warnings: describeWarnings(v) };
}

// ───────────────────────── 還原 / 重做 ─────────────────────────

/** 記憶體內的還原堆疊。存的是整份 plan(或 null)的快照;不持久化。 */
export function createHistory(limit = 60) {
  let past = [];
  let future = [];
  return {
    /** 改動之前呼叫,傳入改動前的狀態 */
    push(prev) {
      past.push(prev);
      if (past.length > limit) past.shift();
      future = [];
    },
    /** 回傳 { value } 表示要換回去的狀態;沒得還原回 null */
    undo(current) {
      if (!past.length) return null;
      future.push(current);
      return { value: past.pop() };
    },
    redo(current) {
      if (!future.length) return null;
      past.push(current);
      return { value: future.pop() };
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() { past = []; future = []; },
  };
}

export { ROOM_TYPE_ORDER };

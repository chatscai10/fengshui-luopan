// 簡單模式的格局(docs/EASY_SPEC.md 8.5):把範本的大門放到左邊/正中間/右邊(右邊 = 整張圖左右鏡射)、判斷平面圖是否還是沒改過的範本、
// 把財位角落講成「前方右邊角落」。純函式,不碰 DOM、不改動傳入的平面圖。
// 前後左右一律以「站在屋內、面向大門」為準:圖面上方(+y)是大門那一面 = 前方,−x = 左邊。
import { buildTemplate } from '../plan/templates.js';
import { checkEditedPlan, rectOfPolygon, MIN_OPENING } from '../plan/editor.js';
import { roomLabel } from '../canvas/miniPlan.js';
import { CORNER_NAME, cornerText } from '../../core/wealth/findings.js';

export const DOOR_SIDES = Object.freeze(['left', 'center', 'right']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const round1 = (v) => Math.round(v * 10) / 10;
const floor1 = (v) => Math.floor(v * 10 + 1e-9) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
/** 門窗與牆角保持的距離(公尺),與範本的設計規則相同 */
const CORNER_GAP = 1;

function mainDoorOf(plan) {
  if (!isObj(plan) || !Array.isArray(plan.openings)) return null;
  return plan.openings.find((o) => o && o.id === plan.mainDoor) || null;
}

function roomRectOf(plan, roomId) {
  const room = Array.isArray(plan.rooms) ? plan.rooms.find((r) => r && r.id === roomId) : null;
  return room ? rectOfPolygon(room.polygon) : null;
}

const spanOf = (o) => [o.pos - o.width / 2, o.pos + o.width / 2];
const overlaps = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-6;

/** 同一面牆上的開口互相重疊或超出牆 → 不合格 */
function wallOk(openings, L) {
  const spans = openings.map(spanOf);
  for (let i = 0; i < spans.length; i += 1) {
    if (spans[i][0] < -1e-6 || spans[i][1] > L + 1e-6) return false;
    for (let j = i + 1; j < spans.length; j += 1) if (overlaps(spans[i], spans[j])) return false;
  }
  return true;
}

const isPt = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

/** 多邊形左右鏡射(x' = sx − x)。軸向矩形照範本的寫法重排成「左下起逆時針」,其他多邊形反轉頂點順序以維持方向。 */
function mirrorPoly(poly, sx) {
  const pts = poly.map((p) => [round3(sx - p[0]), p[1]]);
  const r = rectOfPolygon(poly);
  const isRect = r && poly.length === 4 && poly.every((p) => (p[0] === r.x0 || p[0] === r.x1) && (p[1] === r.y0 || p[1] === r.y1));
  if (isRect) {
    const x0 = round3(sx - r.x1);
    const x1 = round3(sx - r.x0);
    return [[x0, r.y0], [x1, r.y0], [x1, r.y1], [x0, r.y1]];
  }
  return pts.reverse();
}

/**
 * 整張平面圖左右鏡射(房間、外框、牆、門窗、手動太極點都一起翻),大門仍在上牆。
 * 上/下牆的開口 pos 從房間左緣量起 → 新 pos = 房寬 − pos;左、右牆互換,pos(沿 y)不變。
 */
function mirrorPlan(plan) {
  const out = clone(plan);
  const all = [...(Array.isArray(out.outline) ? out.outline : [])];
  for (const r of out.rooms || []) if (r && Array.isArray(r.polygon)) all.push(...r.polygon);
  const xs = all.filter(isPt).map((p) => p[0]);
  if (!xs.length) return null;
  const sx = Math.min(...xs) + Math.max(...xs);
  const widthOf = new Map();
  for (const r of out.rooms || []) {
    if (!r || !Array.isArray(r.polygon)) continue;
    const rect = rectOfPolygon(r.polygon);
    if (rect) widthOf.set(r.id, rect.x1 - rect.x0);
    r.polygon = mirrorPoly(r.polygon, sx);
  }
  if (Array.isArray(out.outline)) out.outline = mirrorPoly(out.outline, sx);
  if (Array.isArray(out.walls)) {
    for (const w of out.walls) if (w && Array.isArray(w.segment)) w.segment = w.segment.map((p) => (isPt(p) ? [round3(sx - p[0]), p[1]] : p));
  }
  if (isObj(out.taiji) && isPt(out.taiji.manual)) out.taiji.manual = [round3(sx - out.taiji.manual[0]), out.taiji.manual[1]];
  for (const o of out.openings || []) {
    if (!o || !isNum(o.pos)) continue;
    if (o.wall === 'top' || o.wall === 'bottom') {
      const L = widthOf.get(o.roomId);
      if (!isNum(L)) return null;
      o.pos = round3(L - o.pos);
    } else if (o.wall === 'left') o.wall = 'right';
    else if (o.wall === 'right') o.wall = 'left';
  }
  return out;
}

/**
 * 把大門放到左邊(範本原樣)、正中間或右邊。不改動輸入。
 * 前後左右以「站在進門的空間中間、面向有大門的那面牆」為準。
 * 'right':整張平面圖左右鏡射(大門跑到房子正面的右側,客廳也跟著換到右邊,大門仍在客廳的牆上)。
 * 'center':大門放到它所在房間上牆(進門那個空間的前牆)的正中間;與它重疊的其他開口挪到
 *   「大門邊緣到離牆角 1 公尺處」中離原位較近的一段(一樣近取右段),寬度 = min(原寬, 該段長度);該段短於 editor.MIN_OPENING 就放棄。
 * 結果一律再跑 editor.checkEditedPlan,不合格就回原樣複本與 moved:false。
 * @returns {{plan:object, moved:boolean}}
 */
export function withDoorSide(plan, side) {
  const orig = isObj(plan) ? clone(plan) : plan;
  const fail = () => ({ plan: isObj(plan) ? clone(plan) : plan, moved: false });
  const door = mainDoorOf(orig);
  if (!door || door.wall !== 'top' || !isNum(door.pos) || !isNum(door.width) || !DOOR_SIDES.includes(side)) return fail();
  const rect = roomRectOf(orig, door.roomId);
  if (!rect) return fail();
  const L = rect.x1 - rect.x0;
  if (side === 'left') return { plan: orig, moved: true };

  if (side === 'right') {
    const m = mirrorPlan(orig);
    if (!m || !checkEditedPlan(m).ok) return fail();
    return { plan: m, moved: true };
  }
  const onWall = orig.openings.filter((o) => o && o.roomId === door.roomId && o.wall === 'top' && isNum(o.pos) && isNum(o.width));
  door.pos = round1(L / 2);
  const [lo, hi] = spanOf(door);
  const segs = [
    { a: CORNER_GAP, b: lo, right: false },
    { a: hi, b: L - CORNER_GAP, right: true },
  ];
  for (const o of onWall) {
    if (o === door || !overlaps(spanOf(o), [lo, hi])) continue;
    const distTo = (sg) => (o.pos < sg.a ? sg.a - o.pos : o.pos > sg.b ? o.pos - sg.b : 0);
    const [s0, s1] = segs;
    const d0 = distTo(s0);
    const d1 = distTo(s1);
    const seg = d0 < d1 ? s0 : s1; // 一樣近取右段
    const len = seg.b - seg.a;
    if (len < MIN_OPENING - 1e-9) return fail();
    o.width = floor1(Math.min(o.width, len));
    o.pos = round1((seg.a + seg.b) / 2);
    if (o.width < MIN_OPENING - 1e-9) return fail();
  }
  if (!wallOk(onWall, L)) return fail();
  const chk = checkEditedPlan(orig);
  if (!chk.ok) return fail();
  return { plan: orig, moved: true };
}

/** 深度相等,鍵的順序無關 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/**
 * 平面圖是不是簡單模式產生、而且沒被改過的範本(是的話換範本可以覆蓋;使用者自己畫或改過的絕不覆蓋)。
 * @param {object|null} plan state.plan
 * @param {{template:string, doorSide:string}|null} easyLayout state.ui.easyLayout
 */
export function isUntouchedTemplate(plan, easyLayout) {
  if (!isObj(plan) || !isObj(easyLayout) || !DOOR_SIDES.includes(easyLayout.doorSide)) return false;
  if (easyLayout.template === 'custom') return false;
  const built = buildTemplate(easyLayout.template);
  if (!built || !built.plan) return false;
  return deepEqual(plan, withDoorSide(built.plan, easyLayout.doorSide).plan);
}

const FRAME_CORNER = Object.freeze({ TL: '前方左邊角落', TR: '前方右邊角落', BL: '後方左邊角落', BR: '後方右邊角落' });

/**
 * 角落的白話說法。平面圖上方就是大門那一面(upMode 'facing'、沒有微調旋轉、大門開在上牆)時,
 * 講「前方右邊角落」;否則只能講圖上的位置「右上角(圖上的位置)」。
 * @returns {{text:string, usesFrame:boolean}}
 */
export function plainCornerOf(plan, corner) {
  const p = isObj(plan) ? plan : {};
  const upFacing = (p.upMode == null || p.upMode === 'facing') && (p.upOffset == null || p.upOffset === 0);
  const door = mainDoorOf(p);
  if (upFacing && door && door.wall === 'top' && Object.prototype.hasOwnProperty.call(FRAME_CORNER, corner)) {
    return { text: FRAME_CORNER[corner], usesFrame: true };
  }
  const name = Object.prototype.hasOwnProperty.call(CORNER_NAME, corner) ? CORNER_NAME[corner] : cornerText(corner);
  return { text: `${name}(圖上的位置)`, usesFrame: false };
}

/**
 * 財位位置的白話說法。top = report.summary.wealthTop[i]。
 * 例:兩房範本、主臥 BR → '主臥的後方右邊角落';依方位推算的位置 → '東北方'。
 * @returns {null|{text:string, usesFrame:boolean}}
 */
export function placeText(top, plan) {
  if (!isObj(top)) return null;
  if (top.kind === 'dark') return { text: `${top.dir8}方`, usesFrame: false };
  const c = plainCornerOf(plan, top.corner);
  return { text: `${roomLabel(plan, top.roomId)}的${c.text}`, usesFrame: c.usesFrame };
}

// 門沖判定與座位檢核(規格 2.6.5 門沖 D49、2.6.6 店面與辦公室)。純函式。
// 座標為房間區域座標: 矩形 [0,w]x[0,d],x 向右、y 向上;牆與門的約定同 geometry.js。
//
// 錯誤碼(message 開頭,規格沒列的自訂): INVALID_DOOR(門位置或寬度不合法)、INVALID_ROOM、INVALID_SEAT(座位、朝向、靠牆或寬度不合法)、INVALID_OPTION。
import { CHONG_RATIO, LEFT_WALL_TOL_M, SLIGHT_RATIO } from './constants.js';
import { INWARD, WALLS, fail, isNum, isObj, isPoint, leftOf } from './geometry.js';

const EPS = 1e-9;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const show = (v) => {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v));
  } catch {
    return String(v);
  }
};

function readSpan(o, name) {
  if (!isObj(o) || !isNum(o.pos) || !(isNum(o.width) && o.width > 0)) {
    fail('INVALID_DOOR', `${name} 需要 pos(開口中心沿牆座標)與正的 width: ${show(o)}`);
  }
  return [o.pos - o.width / 2, o.pos + o.width / 2];
}

/**
 * 門沖(D49,設計值): 兩個相對牆上的開口沿牆座標重疊長度 >= 較窄者寬度的 80% 且兩門之間無遮擋物(玄關、牆、櫃)→ 門沖;
 * 50%-80% → 輕微偏移(不判沖)。舊 50% 門檻比來源的「大門、走道、房門幾乎完全成一直線」寬鬆太多。
 * 「漏財」是象徵性說法,沒有科學證據,文案不得寫成因果。門檻與遮擋是否成立的判斷由呼叫端負責(shielded)。
 * @param {{pos:number,width:number}} front 一側開口(中心沿牆座標、寬度,公尺)
 * @param {{pos:number,width:number}} opposite 對牆開口
 * @param {{shielded?:boolean, chongRatio?:number, slightRatio?:number}} [opts] shielded=兩門之間有遮擋物
 * @returns {{chong:boolean, level:'chong'|'slight'|'none', overlap:number, ratio:number, shielded:boolean}}
 * @throws {Error} INVALID_DOOR, INVALID_OPTION
 */
export function doorChong(front, opposite, opts = {}) {
  if (!isObj(opts)) fail('INVALID_OPTION', 'opts 必須是物件');
  for (const k of Object.keys(opts)) if (!['shielded', 'chongRatio', 'slightRatio'].includes(k)) fail('INVALID_OPTION', `未知的選項: ${k}`);
  const chongRatio = opts.chongRatio ?? CHONG_RATIO;
  const slightRatio = opts.slightRatio ?? SLIGHT_RATIO;
  if (!(isNum(chongRatio) && isNum(slightRatio) && slightRatio > 0 && slightRatio <= chongRatio && chongRatio <= 1)) {
    fail('INVALID_OPTION', `門檻需 0 < slightRatio <= chongRatio <= 1: ${show([slightRatio, chongRatio])}`);
  }
  if (opts.shielded !== undefined && typeof opts.shielded !== 'boolean') fail('INVALID_OPTION', `shielded 必須是布林: ${show(opts.shielded)}`);
  const [a0, a1] = readSpan(front, 'front');
  const [b0, b1] = readSpan(opposite, 'opposite');
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const narrower = Math.min(front.width, opposite.width);
  const ratio = overlap / narrower;
  const shielded = opts.shielded === true;
  let level = 'none';
  if (!shielded) {
    if (ratio >= chongRatio - EPS) level = 'chong';
    else if (ratio >= slightRatio - EPS) level = 'slight';
  }
  return { chong: level === 'chong', level, overlap, ratio, shielded };
}

const FACING_VECTORS = Object.freeze({ up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] });

function readFacing(facing) {
  const v = typeof facing === 'string' ? FACING_VECTORS[facing] : facing;
  if (!isPoint(v) || Math.hypot(v[0], v[1]) <= EPS) fail('INVALID_SEAT', `facing 必須是 up/down/left/right 或非零向量 [dx,dy]: ${show(facing)}`);
  const n = Math.hypot(v[0], v[1]);
  return [v[0] / n, v[1] / n];
}

/** 由點 p 沿單位向量 v 走到房間邊界的距離。 */
function gapToBounds(p, v, w, d) {
  const us = [];
  if (v[0] > EPS) us.push((w - p[0]) / v[0]);
  if (v[0] < -EPS) us.push((0 - p[0]) / v[0]);
  if (v[1] > EPS) us.push((d - p[1]) / v[1]);
  if (v[1] < -EPS) us.push((0 - p[1]) / v[1]);
  return Math.max(0, Math.min(...us));
}

const seatFinding = (id, level, title, body, confidence, tag, schoolNote, refs) => ({ id, level, title, body, confidence, tag, schoolNote, refs });

/**
 * 座位檢核(收銀台、老闆座位、辦公桌;規格 2.6.6)。
 *   backSolidWall     背後有實牆(backWall 不是 null)
 *   facesOrSeesDoor   面朝或看得到門: dot(朝向, 門中心 - 座位中心) > 0
 *   alignedWithDoor   正對大門: 座位寬度與門洞在門所在牆方向的重疊 > 5 公分
 *   inRearHalf        位於空間後半: 離門牆的距離 > 縱深/2(設計推論,兩個來源沒有明說「後半」,信心: 低)
 *   dragonSide        在龍邊: dot(座位 - 房間中心, leftOf(朝向門外)) > 0;龍邊 = 站在店內面向店門時的左手邊
 *   leftSideAgainstWall  座位自己的左側貼牆(潮紫微「原則上以左邊要靠牆為佳」,單一來源軟建議): 左端到牆的縫隙 <= 10 公分(設計值)
 *   hardOk            收銀台硬條件 = 背靠實牆且面向入口
 * @param {{w:number,d:number}} room 矩形房間(區域座標)
 * @param {{wall:'bottom'|'top'|'left'|'right',pos:number,width:number}} door 進入該房間的門
 * @param {{x:number,y:number}} seat 座位中心
 * @param {'up'|'down'|'left'|'right'|[number,number]} facing 座位面朝的方向
 * @param {('bottom'|'top'|'left'|'right')|null} backWall 座位背後緊貼的實牆,沒有就 null
 * @param {number} width 桌寬或櫃檯寬(公尺)
 * @returns {{backSolidWall:boolean, facesOrSeesDoor:boolean, alignedWithDoor:boolean, inRearHalf:boolean, dragonSide:boolean,
 *   leftSideAgainstWall:boolean, hardOk:boolean, lateralOverlap:number, distanceFromDoorWall:number, leftGap:number,
 *   findings:Array<{id:string, level:string, title:string, body:string, confidence:string, tag:string, schoolNote:(string|null), refs:string[]}>}}
 * @throws {Error} INVALID_ROOM, INVALID_DOOR, INVALID_SEAT
 */
export function seatCheck(room, door, seat, facing, backWall, width) {
  if (!isObj(room) || !(isNum(room.w) && room.w > 0) || !(isNum(room.d) && room.d > 0)) fail('INVALID_ROOM', `座位檢核需要矩形房間 {w,d}: ${show(room)}`);
  const { w, d } = room;
  if (!isObj(door) || !WALLS.includes(door.wall)) fail('INVALID_DOOR', `門的 wall 必須是 ${WALLS.join('/')}: ${show(door)}`);
  const doorLen = door.wall === 'bottom' || door.wall === 'top' ? w : d;
  if (!isNum(door.pos) || door.pos < -EPS || door.pos > doorLen + EPS || !(isNum(door.width) && door.width > 0)) {
    fail('INVALID_DOOR', `門需要牆長內的 pos 與正的 width: ${show(door)}`);
  }
  if (!isObj(seat) || !isNum(seat.x) || !isNum(seat.y) || seat.x < -EPS || seat.x > w + EPS || seat.y < -EPS || seat.y > d + EPS) {
    fail('INVALID_SEAT', `座位中心必須在房間內: ${show(seat)}`);
  }
  if (backWall !== null && !WALLS.includes(backWall)) fail('INVALID_SEAT', `backWall 必須是 ${WALLS.join('/')} 或 null: ${show(backWall)}`);
  if (!(isNum(width) && width > 0)) fail('INVALID_SEAT', `width 必須是正有限數: ${show(width)}`);
  const f = readFacing(facing);

  const doorPoint = { bottom: [door.pos, 0], top: [door.pos, d], left: [0, door.pos], right: [w, door.pos] }[door.wall];
  const pos = [seat.x, seat.y];
  const backSolidWall = backWall !== null;
  const facesOrSeesDoor = dot(f, [doorPoint[0] - pos[0], doorPoint[1] - pos[1]]) > 0;

  const lateral = door.wall === 'bottom' || door.wall === 'top' ? seat.x : seat.y;
  const overlap = Math.max(0, Math.min(lateral + width / 2, door.pos + door.width / 2) - Math.max(lateral - width / 2, door.pos - door.width / 2));
  const alignedWithDoor = overlap > 0.05 + EPS;

  const distanceFromDoorWall = { bottom: seat.y, top: d - seat.y, left: seat.x, right: w - seat.x }[door.wall];
  const depth = door.wall === 'bottom' || door.wall === 'top' ? d : w;
  const inRearHalf = distanceFromDoorWall > depth / 2 + EPS;

  const outward = [-INWARD[door.wall][0], -INWARD[door.wall][1]];
  const dragonSide = dot([pos[0] - w / 2, pos[1] - d / 2], leftOf(outward)) > EPS;

  const L = leftOf(f);
  const leftEnd = [pos[0] + (L[0] * width) / 2, pos[1] + (L[1] * width) / 2];
  const leftGap = gapToBounds(leftEnd, L, w, d);
  const leftSideAgainstWall = leftGap <= LEFT_WALL_TOL_M + EPS;
  const hardOk = backSolidWall && facesOrSeesDoor;

  const findings = [];
  if (!backSolidWall) {
    findings.push(seatFinding('wealth.seat.no_back_wall', 'caution', '座位背後沒有實牆', '傳統上認為收銀台與老闆座位背後要靠實牆(靠山),背後空曠或是玻璃的座位較不理想。', 'medium', 'source', null, ['DOMAIN_SPEC.md#2.6.6']));
  }
  if (!facesOrSeesDoor) {
    findings.push(seatFinding('wealth.seat.back_to_door', 'caution', '座位背對入口', '傳統上認為座位宜面向入口、看得到門,背對大門的位置較不理想(櫃檯背對大門傳統上有「財來財去」的說法)。', 'medium', 'source', null, ['DOMAIN_SPEC.md#2.6.6']));
  }
  if (alignedWithDoor) {
    findings.push(seatFinding('wealth.seat.aligned_with_door', 'note', '座位正對大門', '傳統上認為收銀台與辦公桌不宜與大門成一直線,可用屏風、櫃體或盆栽略微錯開。', 'medium', 'source', null, ['DOMAIN_SPEC.md#2.6.6']));
  }
  if (!dragonSide) {
    findings.push(seatFinding('wealth.seat.tiger_side', 'note', '座位在虎邊', '傳統上認為收銀台宜在龍邊(站在店內面向店門時的左手邊)。這只是一個偏好,不是硬條件。', 'medium', 'source', '龍邊高於虎邊只見於單一來源(潮紫微),信心較低', ['DOMAIN_SPEC.md#2.6.6']));
  }
  if (!leftSideAgainstWall) {
    findings.push(seatFinding('wealth.seat.left_not_against_wall', 'note', '座位左側沒有貼牆', '單一來源(潮紫微)提到櫃檯自己的左側以貼牆為佳,屬軟建議。', 'medium', 'source', '單一來源說法', ['DOMAIN_SPEC.md#2.6.6']));
  }
  if (!inRearHalf) {
    findings.push(seatFinding('wealth.seat.not_rear_half', 'info', '座位不在空間後半', '老闆座位傳統上宜在空間後方、能看到全場;「後半」是本 App 的推論,兩個來源沒有明說。', 'low', 'design', null, ['DOMAIN_SPEC.md#2.6.6']));
  }
  return { backSolidWall, facesOrSeesDoor, alignedWithDoor, inRearHalf, dragonSide, leftSideAgainstWall, hardOk, lateralOverlap: overlap, distanceFromDoorWall, leftGap, findings };
}

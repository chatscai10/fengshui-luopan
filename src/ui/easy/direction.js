// 白話方位(docs/EASY_SPEC.md 8.3):把度數講成「西南方(稍微偏南)」,並判斷誤差會不會跨過 8 方位或 24 山的分界。
// 純函式,不碰 DOM。8 方位分區與 geo.guaAt 一致(22.5 屬東北);接近分界的門檻與引擎相同(第 2.4 節)。
import { DIR8, MOUNTAINS, normalizeBearing, circularDelta, mountainAt, measurementUncertainty } from '../../core/geo.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** 與引擎比較「小於門檻」時用的容差,讓剛好等於門檻的情況兩邊判斷一致 */
const EPS = 1e-9;
/** 八宅提示卦界的最小距離(與 geo/bazhai 的 GUA_HINT_MIN_DEG 相同) */
const GUA_HINT_MIN_DEG = 3;
const HALF_SHAN = 7.5;

const dirAt = (k) => DIR8[((k % 8) + 8) % 8];

function locate8(bearing) {
  const b = normalizeBearing(bearing);
  const index = Math.floor(((b + 22.5) % 360) / 45) % 8;
  const offset = circularDelta(b, index * 45); // [-22.5, 22.5),順時針為正
  return { b, index, offset };
}

/**
 * 度數 → 白話方位。不用「正南方」這類暗示高精度的說法。
 * 主方位與偏向分開:大字只放 `{dir8}方`,偏向放在括號裡(paren),避免「東北方,偏北較多」這種互相拉扯的講法。
 * @param {number} bearing 度
 * @returns {null|{index:number, dir8:string, deg:number, offset:number, level:'center'|'lean'|'leanMore',
 *   lean:string|null, neighbor:string, paren:string|null, text:string, short:string}}
 */
export function plainDirection(bearing) {
  if (!isNum(bearing)) return null;
  const { b, index, offset } = locate8(bearing);
  const dir8 = DIR8[index];
  const abs = Math.abs(offset);
  const level = abs < 7.5 ? 'center' : abs < 15 ? 'lean' : 'leanMore';
  const sign = offset > 0 ? 1 : -1;
  const lean = level === 'center' ? null : dirAt(index + (index % 2 === 0 ? 2 : 1) * sign);
  const neighbor = dirAt(index + (offset >= 0 ? 1 : -1));
  const paren = level === 'center' ? null : level === 'lean' ? `稍微偏${lean}` : `很靠近${neighbor}方`;
  return {
    index,
    dir8,
    deg: Math.floor(b + 0.5) % 360,
    offset,
    level,
    lean,
    neighbor,
    paren,
    text: paren ? `${dir8}方(${paren})` : `${dir8}方`,
    short: level === 'center' ? `${dir8}方` : `${dir8}方偏${lean}`,
  };
}

/**
 * 方位所在的 8 方位扇區。distDeg = 到較近那條分界的距離,neighbor = 較近那一側的鄰居。
 * @param {number} bearing
 * @returns {null|{index:number, dir8:string, fromDeg:number, toDeg:number, distDeg:number, neighbor:string}}
 */
export function sectorOf8(bearing) {
  if (!isNum(bearing)) return null;
  const { index, offset } = locate8(bearing);
  const center = index * 45;
  return {
    index,
    dir8: DIR8[index],
    fromDeg: normalizeBearing(center - 22.5),
    toDeg: normalizeBearing(center + 22.5),
    distDeg: 22.5 - Math.abs(offset),
    neighbor: dirAt(index + (offset >= 0 ? 1 : -1)),
  };
}

/** '西南' → 225;不認得回 null */
export function bearingOfDir8(name) {
  const k = DIR8.indexOf(name);
  return k < 0 ? null : k * 45;
}

/**
 * 送進引擎的不確定度 U = max(設定的誤差, 2σ, iPhone 自己估計的誤差, 兩次量測的差距)。
 * 缺項或壞值略過(iPhone 的 −1 = 未校準也略過);設定值壞掉時用預設 5 度。實作沿用 geo.measurementUncertainty。
 */
export function uncertaintyFor({ measureUncertainty = DEFAULT_SETTINGS.measureUncertainty, sigmaDeg = null, spreadDeg = null, accuracyDeg = null } = {}) {
  const baseline = isNum(measureUncertainty) && measureUncertainty >= 0 ? measureUncertainty : DEFAULT_SETTINGS.measureUncertainty;
  const sigma = isNum(sigmaDeg) && sigmaDeg >= 0 ? sigmaDeg : null;
  const acc = isNum(accuracyDeg) && accuracyDeg >= 0 ? accuracyDeg : null;
  const u = measurementUncertainty({ baseline, sigmaDeg: sigma, accuracyDeg: acc });
  return isNum(spreadDeg) && spreadDeg >= 0 ? Math.max(u, spreadDeg) : u;
}

/**
 * 誤差會不會讓大方位(8 方位)算到隔壁。門檻與引擎的 bazhai.house.boundary.nearGuaBoundary 相同:
 * 離卦界 < max(U, 3)。U ≤ 7.5 時兩者完全一致;U 更大時這裡較嚴格(引擎只看最近的山界剛好是卦界)。
 * @returns {null|{near:boolean, distDeg:number, dir8:string, neighbor:string, fromDeg:number, toDeg:number, uncertaintyDeg:number, deg:number}}
 */
export function eightImpact(bearing, uncertaintyDeg) {
  const s = sectorOf8(bearing);
  if (!s || !isNum(uncertaintyDeg) || uncertaintyDeg < 0) return null;
  return {
    near: s.distDeg < Math.max(uncertaintyDeg, GUA_HINT_MIN_DEG) - EPS,
    distDeg: s.distDeg,
    dir8: s.dir8,
    neighbor: s.neighbor,
    fromDeg: s.fromDeg,
    toDeg: s.toDeg,
    uncertaintyDeg,
    deg: Math.floor(normalizeBearing(bearing) + 0.5) % 360,
  };
}

/**
 * 誤差會不會讓 24 山算到隔壁(與引擎 geo.retest 相同:離山界 < U)。
 * @returns {null|{near:boolean, distDeg:number, mountain:string, neighborMountain:string}}
 */
export function shanImpact(bearing, uncertaintyDeg) {
  if (!isNum(bearing) || !isNum(uncertaintyDeg) || uncertaintyDeg < 0) return null;
  const m = mountainAt(bearing);
  const distDeg = Math.max(0, HALF_SHAN - Math.abs(m.dev));
  const j = m.dev > 0 ? (m.index + 1) % 24 : (m.index + 23) % 24;
  return { near: distDeg < uncertaintyDeg - EPS, distDeg, mountain: m.name, neighborMountain: MOUNTAINS[j].name };
}

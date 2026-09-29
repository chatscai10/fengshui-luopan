// 手機方位純函式核心(docs/DOMAIN_SPEC.md 2.9;決策 D65-D69 見同檔 3.5)。
// 無 DOM、無全域狀態、無網路;瀏覽器事件、計時器、權限流程在 sensor.js。
// 圓周統計(平均、標準差、最短角差)一律取 geo.js,這裡不重寫。
import { circularStats, circularDelta, normalizeBearing, measurementUncertainty } from './geo.js';
import { resolveSettings } from './settings.js';

/**
 * 錯誤碼(message 以碼開頭,後接冒號;geo.js 的 INVALID_BEARING、INVALID_READINGS 原樣透傳):
 *  INVALID_ANGLE alpha/beta/gamma 不是有限數字
 *  INVALID_EVENT decodeOrientationEvent 的輸入不是物件
 *  INVALID_OPTION 選項或 Settings 值不合法
 *  INVALID_ROTATION screenUpHeading 的 rotCCW 不是 0/90/180/270
 *  INVALID_PLATFORM screenAngleToDeviceRot 的平台不是 ios/android
 *  INVALID_SAMPLE iosUprightOffset 的樣本缺欄位或平放樣本的頂端方位退化
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** 水平分量小於此值視為軸垂直,方位未定義(fixtures meta.tolerance.note)。 */
const EPS = 1e-9;
/** 傾角落在混合區邊界的浮點雜訊容差(度);避免 40.00000000000001 被誤判成混合。 */
const ANGLE_EPS = 1e-9;

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
/** -0 在 JSON 與嚴格比較中會出現分歧,輸出一律換成 +0。 */
const z = (x) => (x === 0 ? 0 : x);

/**
 * 本模組的設計值(規格明說是設計值或門檻,不是流派開關,所以不在 Settings)。
 * 流派/使用者可調的值(lockSeconds、measureUncertainty)一律走 settings.js。
 */
export const SENSOR_DEFAULTS = Object.freeze({
  /** D66: 頂端/後鏡頭混合區下緣與上緣(度)。 */
  blendFromDeg: 40,
  blendToDeg: 50,
  /** 2.9.1: iOS 只在 tilt <= 50° 採信 webkitCompassHeading。 */
  iosTiltMaxDeg: 50,
  /** 2.9.4 第 5 點: 水平氣泡傾角 < 15° 才允許鎖定。 */
  lockMaxTiltDeg: 15,
  /** 2.9.4 第 1 點: 計時器取樣 20 Hz。 */
  sampleMs: 50,
  sampleHz: 20,
  /** 2.9.5: 1.5 秒無事件 → no-events。 */
  watchdogMs: 1500,
  /** 2.9.4 第 2 點: 圓周 EMA 時間常數 τ(設計值)。 */
  emaTauSec: 0.2,
  /** EMA 單步 dt 上限(秒),避免長時間停擺後一步就吃掉整段。設計值。 */
  emaMaxStepSec: 1,
  /** 2.9.4 第 3 點: 鎖定最少樣本與 σ 門檻。 */
  lockMinSamples: 20,
  lockMaxStdDeg: 3,
  /** 即時 σ 的滾動窗(20 Hz × 1 秒)與最少樣本。設計值。 */
  sigmaWindow: 20,
  sigmaMinSamples: 5,
  /** 2.9.4 第 5 點: 品質燈號門檻(設計值,10 為 Apple 文件範例值)。 */
  accuracyGreenMax: 10,
  accuracyYellowMax: 25,
  sigmaGreenMax: 2,
  sigmaYellowMax: 4,
  /** 2.9.4 第 5 點: 接近分界提示的最小門檻(度)。 */
  nearBoundaryMinDeg: 2,
});

/**
 * 狀態碼 → 使用者訊息與動作(規格 2.9.5 表,逐字;測試會由規格文字重新解析比對)。
 * @type {Readonly<Record<string, Readonly<{message:string, action:string}>>>}
 */
export const STATUS_INFO = Object.freeze(
  Object.fromEntries(
    Object.entries({
      'permission-denied': { message: '需要允許「動作與方向」才能使用羅盤', action: '顯示重試與手動輸入' },
      'permission-error': { message: '需要允許「動作與方向」才能使用羅盤', action: '顯示重試與手動輸入' },
      'no-events': { message: '偵測不到方位感測器', action: '手動輸入/拖曳盤面' },
      'relative-not-north': { message: '這台裝置無法提供指北資料', action: '手動輸入' },
      uncalibrated: { message: '羅盤尚未校準,請遠離金屬並手持手機畫 8 字', action: '停用鎖定' },
      invalid: { message: '方位資料無效,請稍後再試', action: '忽略該筆' },
      'tilt-too-large': { message: '請將手機放平再讀數', action: '顯示水平氣泡' },
      unstable: { message: '讀數不穩定,附近可能有磁性物體', action: '提示重測' },
      'too-few': { message: '樣本不足,請再等一下', action: '繼續收集' },
      degenerate: { message: '手機太接近水平,無法判定後鏡頭方向', action: '使用頂端模式' },
      'insecure-context': { message: '(開發者訊息,正式版不應出現)', action: '' },
    }).map(([k, v]) => [k, Object.freeze(v)]),
  ),
);

/** 規格表沒有獨立一列、沿用相近訊息的狀態(no-sensor 與 unsupported 都是「偵測不到方位感測器」)。 */
const STATUS_ALIAS = Object.freeze({ 'no-sensor': 'no-events', unsupported: 'no-events' });

/** 規格 2.9.4、2.9.7 內文裡指定的提示文字。 */
export const HINTS = Object.freeze({
  faceDown: '請螢幕朝上',
  nearBoundary: '接近分界,建議重測',
  calibrate: '請遠離金屬,手持手機畫 8 字',
});

/**
 * 查狀態碼對應的訊息與動作;ok、running 等正常狀態回 null。
 * @param {string} status
 * @returns {{message:string, action:string}|null}
 */
export function describeStatus(status) {
  return STATUS_INFO[STATUS_ALIAS[status] ?? status] ?? null;
}

// ─────────────────────────── 姿態角 → 方位 ───────────────────────────

const assertAngles = (alpha, beta, gamma) => {
  for (const [name, v] of [['alpha', alpha], ['beta', beta], ['gamma', gamma]]) {
    if (!isFiniteNumber(v)) fail('INVALID_ANGLE', `${name} 不是有限數字: ${show(v)}`);
  }
};

const headingOf = (east, north) => (Math.hypot(east, north) < EPS ? null : z(normalizeBearing(Math.atan2(east, north) * R2D)));

/**
 * W3C 裝置座標 x 朝螢幕右、y 朝螢幕頂端、z 垂直螢幕朝外;R = Rz(alpha)·Rx(beta)·Ry(gamma);
 * 世界 x=東、y=北;方位 = atan2(東分量, 北分量)(規格 2.9.2)。軸接近垂直時該方位為 null。
 * @param {number} alpha 度
 * @param {number} beta 度
 * @param {number} gamma 度
 * @returns {{top:number|null, right:number|null, back:number|null, zUp:number}}
 *   top=頂端 +Y、right=右緣 +X、back=後鏡頭 -Z 的水平投影方位;zUp=螢幕法向量的鉛直分量(+1 平放朝上、-1 平放朝下)
 * @throws {Error} INVALID_ANGLE
 */
export function eulerHeadings(alpha, beta, gamma) {
  assertAngles(alpha, beta, gamma);
  const az = alpha * D2R;
  const bx = beta * D2R;
  const gy = gamma * D2R;
  const cX = Math.cos(bx);
  const cY = Math.cos(gy);
  const cZ = Math.cos(az);
  const sX = Math.sin(bx);
  const sY = Math.sin(gy);
  const sZ = Math.sin(az);
  return {
    top: headingOf(-cX * sZ, cX * cZ),
    right: headingOf(cZ * cY - sZ * sX * sY, cY * sZ + cZ * sX * sY),
    // W3C 附錄 A.1 的 Vx, Vy
    back: headingOf(-cZ * sY - sZ * sX * cY, -sZ * sY + cZ * sX * cY),
    zUp: cX * cY,
  };
}

/**
 * 螢幕平面與水平面的夾角 acos(|cosβ·cosγ|)(度,0=平放、90=直立)。
 * @param {number} beta 度
 * @param {number} gamma 度
 * @returns {number}
 * @throws {Error} INVALID_ANGLE
 */
export function tiltDeg(beta, gamma) {
  assertAngles(0, beta, gamma);
  return Math.acos(Math.min(1, Math.abs(Math.cos(beta * D2R) * Math.cos(gamma * D2R)))) * R2D;
}

/**
 * D66 的 smoothstep 權重: t=clamp((tilt-from)/(to-from),0,1);w=t²(3-2t)。0=只用頂端、1=只用後鏡頭。
 * @param {number} tilt 傾角(度)
 * @param {number} [fromDeg] 預設 SENSOR_DEFAULTS.blendFromDeg
 * @param {number} [toDeg] 預設 SENSOR_DEFAULTS.blendToDeg
 * @returns {number} [0,1]
 * @throws {Error} INVALID_OPTION
 */
export function blendWeight(tilt, fromDeg = SENSOR_DEFAULTS.blendFromDeg, toDeg = SENSOR_DEFAULTS.blendToDeg) {
  if (!isFiniteNumber(tilt) || !isFiniteNumber(fromDeg) || !isFiniteNumber(toDeg) || !(fromDeg < toDeg)) {
    fail('INVALID_OPTION', `混合區間不合法: tilt=${show(tilt)} from=${show(fromDeg)} to=${show(toDeg)}`);
  }
  if (tilt <= fromDeg + ANGLE_EPS) return 0;
  if (tilt >= toDeg - ANGLE_EPS) return 1;
  const t = (tilt - fromDeg) / (toDeg - fromDeg);
  return t * t * (3 - 2 * t);
}

/**
 * 頂端方位與後鏡頭方位的平滑混合(D66,取代舊的 50°/40° 遲滯硬切;硬切在側傾時航向會跳 6.5° 到 40.7°)。
 * vec = (1-w)·unit(top) + w·unit(back);任一方位為 null 就只用另一個;皆 null 回 null。
 * mode: 只用頂端 'top'、只用後鏡頭 'back'、兩者都用 'blend'。
 * @param {number} alpha 度
 * @param {number} beta 度
 * @param {number} gamma 度
 * @param {{fromDeg?:number, toDeg?:number}} [opts] 混合區間,預設 40°/50°
 * @returns {{headingDeg:number|null, mode:'top'|'back'|'blend', tiltDeg:number, weight:number, faceDown:boolean}}
 * @throws {Error} INVALID_ANGLE, INVALID_OPTION
 */
export function pickHeadingBlend(alpha, beta, gamma, opts = {}) {
  const from = opts.fromDeg ?? SENSOR_DEFAULTS.blendFromDeg;
  const to = opts.toDeg ?? SENSOR_DEFAULTS.blendToDeg;
  const h = eulerHeadings(alpha, beta, gamma);
  const tilt = tiltDeg(beta, gamma);
  const w = blendWeight(tilt, from, to);
  const useTop = h.top !== null && w < 1;
  const useBack = h.back !== null && w > 0;
  let headingDeg = null;
  let mode;
  if (useTop && useBack) {
    const x = (1 - w) * Math.sin(h.top * D2R) + w * Math.sin(h.back * D2R);
    const y = (1 - w) * Math.cos(h.top * D2R) + w * Math.cos(h.back * D2R);
    headingDeg = headingOf(x, y);
    mode = 'blend';
  } else if (useTop) {
    headingDeg = h.top;
    mode = 'top';
  } else if (useBack) {
    headingDeg = h.back;
    mode = 'back';
  } else {
    mode = w === 0 ? 'top' : w === 1 ? 'back' : 'blend';
  }
  return { headingDeg, mode, tiltDeg: tilt, weight: w, faceDown: h.zUp < 0 };
}

/**
 * 舊的 50°/40° 遲滯選模式。D66 已改用 pickHeadingBlend,解碼與感測層都不用它;
 * 只留給 device_compass.json group3 與「遲滯會跳變」的對照測試。
 * @param {number} alpha 度
 * @param {number} beta 度
 * @param {number} gamma 度
 * @param {'top'|'back'} [prevMode]
 * @param {number} [enterBackDeg]
 * @param {number} [leaveBackDeg]
 * @returns {{mode:'top'|'back', heading:number|null, tiltDeg:number, faceDown:boolean}}
 * @throws {Error} INVALID_ANGLE, INVALID_OPTION
 */
export function pickPointingModeHysteresis(alpha, beta, gamma, prevMode = 'top', enterBackDeg = 50, leaveBackDeg = 40) {
  if (prevMode !== 'top' && prevMode !== 'back') fail('INVALID_OPTION', `prevMode 不認得: ${show(prevMode)}`);
  const tilt = tiltDeg(beta, gamma);
  let mode = prevMode;
  if (prevMode === 'top' && tilt > enterBackDeg) mode = 'back';
  else if (prevMode === 'back' && tilt < leaveBackDeg) mode = 'top';
  const h = eulerHeadings(alpha, beta, gamma);
  return { mode, heading: mode === 'top' ? h.top : h.back, tiltDeg: tilt, faceDown: h.zUp < 0 };
}

/**
 * 平放(螢幕朝上)時,畫面「上方」對應的裝置軸方位。rotCCW = 手機由自然直式逆時針轉的實體角度。
 * 0→頂端、90→右緣、180→頂端反向、270→右緣反向。v1 鎖直式,橫式映射需實機量測(規格 2.9.6)。
 * @param {number} alpha 度
 * @param {number} beta 度
 * @param {number} gamma 度
 * @param {0|90|180|270} rotCCW
 * @returns {number|null}
 * @throws {Error} INVALID_ANGLE, INVALID_ROTATION
 */
export function screenUpHeading(alpha, beta, gamma, rotCCW) {
  const h = eulerHeadings(alpha, beta, gamma);
  const rot = isFiniteNumber(rotCCW) ? normalizeBearing(rotCCW) : NaN;
  switch (rot) {
    case 0:
      return h.top;
    case 90:
      return h.right;
    case 180:
      return h.top === null ? null : z(normalizeBearing(h.top + 180));
    case 270:
      return h.right === null ? null : z(normalizeBearing(h.right + 180));
    default:
      return fail('INVALID_ROTATION', `rotCCW 必須是 0/90/180/270: ${show(rotCCW)}`);
  }
}

/**
 * screen.orientation.angle → 手機實體逆時針旋轉角。Android: 原值;iOS: (360-angle) mod 360。
 * 這是報告自訂映射(單一來源,信心 低到中),橫式支援前必須實機驗證(規格 2.9.6)。
 * @param {'ios'|'android'} platform
 * @param {number} angle 度
 * @returns {number}
 * @throws {Error} INVALID_PLATFORM, INVALID_BEARING
 */
export function screenAngleToDeviceRot(platform, angle) {
  if (platform !== 'ios' && platform !== 'android') fail('INVALID_PLATFORM', `平台不認得: ${show(platform)}`);
  const a = normalizeBearing(angle);
  return z(platform === 'ios' ? (360 - a) % 360 : a);
}

/**
 * iOS 直立讀數的偏移追蹤(進階,v1 不用): iOS 的 alpha 零點任意,先在平放時量
 * offset = webkitCompassHeading - top(alpha),直立時 heading = back(alpha,beta,gamma) + offset。
 * 尚未實機驗證(device_compass.md 2.3)。
 * @param {{alpha:number, beta:number, gamma:number, webkitCompassHeading:number}} flatSample 平放取樣
 * @param {{alpha:number, beta:number, gamma:number}} uprightSample 直立取樣
 * @returns {{offsetDeg:number, uprightBackHeadingDeg:number|null}} offsetDeg 落在 [-180,180)
 * @throws {Error} INVALID_SAMPLE, INVALID_ANGLE
 */
export function iosUprightOffset(flatSample, uprightSample) {
  if (!flatSample || !uprightSample) fail('INVALID_SAMPLE', '需要平放與直立兩筆樣本');
  if (!isFiniteNumber(flatSample.webkitCompassHeading)) fail('INVALID_SAMPLE', '平放樣本缺 webkitCompassHeading');
  const flat = eulerHeadings(flatSample.alpha, flatSample.beta, flatSample.gamma);
  if (flat.top === null) fail('INVALID_SAMPLE', '平放樣本的頂端方位退化(手機不夠平)');
  const offsetDeg = z(circularDelta(flatSample.webkitCompassHeading, flat.top));
  const back = eulerHeadings(uprightSample.alpha, uprightSample.beta, uprightSample.gamma).back;
  return { offsetDeg, uprightBackHeadingDeg: back === null ? null : z(normalizeBearing(back + offsetDeg)) };
}

// ─────────────────────────── 事件解碼 ───────────────────────────

const BLEND_MODE_NAME = Object.freeze({ top: 'top-edge', back: 'back-camera', blend: 'blend' });

/**
 * 一筆方向事件 → 一筆讀數(規格 2.9.3)。優先序: iOS webkitCompassHeading > 絕對的 alpha/beta/gamma > 不可用。
 * 對欄位缺失、null、NaN 一律以 status 回報,不丟錯(感測器的髒資料不該讓取樣迴圈死掉)。
 * status: ok | uncalibrated | invalid | tilt-too-large | relative-not-north | no-sensor | degenerate。
 * tiltDeg、faceDown 是規格 2.9.4/2.9.7 的鎖定閘門與「請螢幕朝上」提示所需的補充欄位。
 * @param {{type?:string, alpha?:any, beta?:any, gamma?:any, absolute?:any, webkitCompassHeading?:any, webkitCompassAccuracy?:any}} ev
 * @returns {{source:'webkitCompassHeading'|'alpha-absolute'|'alpha-relative'|null, headingDeg:number|null,
 *   accuracyDeg:number|null, status:string, mode:'top-edge'|'back-camera'|'blend'|null,
 *   tiltDeg:number|null, faceDown:boolean}}
 * @throws {Error} INVALID_EVENT 輸入不是物件
 */
export function decodeOrientationEvent(ev) {
  if (ev === null || typeof ev !== 'object') fail('INVALID_EVENT', `事件必須是物件: ${show(ev)}`);
  const { alpha, beta, gamma } = ev;
  const wch = ev.webkitCompassHeading;
  const wca = ev.webkitCompassAccuracy;
  const hasAngles = isFiniteNumber(alpha) && isFiniteNumber(beta) && isFiniteNumber(gamma);
  const tilt = hasAngles ? tiltDeg(beta, gamma) : null;
  const faceDown = hasAngles ? eulerHeadings(alpha, beta, gamma).zUp < 0 : false;

  if (typeof wch === 'number') {
    // iOS: CoreLocation 磁北航向,以直式頂端為基準,不受螢幕旋轉影響;手機直立時定義不明,故限 tilt <= 50°
    const accuracyDeg = isFiniteNumber(wca) ? z(wca) : null;
    const base = { source: 'webkitCompassHeading', accuracyDeg, tiltDeg: tilt, faceDown };
    if (accuracyDeg !== null && accuracyDeg < 0) return { ...base, headingDeg: null, status: 'uncalibrated', mode: 'top-edge' };
    if (!Number.isFinite(wch) || wch < 0) return { ...base, headingDeg: null, status: 'invalid', mode: 'top-edge' };
    if (tilt !== null && tilt > SENSOR_DEFAULTS.iosTiltMaxDeg) {
      return { ...base, headingDeg: null, status: 'tilt-too-large', mode: null };
    }
    // 360 要回捲成 0
    return { ...base, headingDeg: z(wch % 360), status: 'ok', mode: 'top-edge' };
  }
  if (!hasAngles) {
    return { source: null, headingDeg: null, accuracyDeg: null, status: 'no-sensor', mode: null, tiltDeg: null, faceDown: false };
  }
  if (ev.absolute !== true) {
    // Android 的 deviceorientation 是相對事件,alpha 不是北
    return { source: 'alpha-relative', headingDeg: null, accuracyDeg: null, status: 'relative-not-north', mode: null, tiltDeg: tilt, faceDown };
  }
  const p = pickHeadingBlend(alpha, beta, gamma);
  return {
    source: 'alpha-absolute',
    headingDeg: p.headingDeg,
    accuracyDeg: null,
    status: p.headingDeg === null ? 'degenerate' : 'ok',
    mode: BLEND_MODE_NAME[p.mode],
    tiltDeg: tilt,
    faceDown,
  };
}

// ─────────────────────────── 圓周 EMA ───────────────────────────

/**
 * EMA 係數 k = 1 - exp(-dt/τ),與更新率無關(規格 2.9.4 第 2 點)。
 * @param {number} dtSec 兩次更新的間隔(秒)
 * @param {number} [tauSec] 時間常數,預設 SENSOR_DEFAULTS.emaTauSec
 * @returns {number} [0,1)
 * @throws {Error} INVALID_OPTION
 */
export function emaK(dtSec, tauSec = SENSOR_DEFAULTS.emaTauSec) {
  if (!isFiniteNumber(dtSec) || dtSec < 0) fail('INVALID_OPTION', `dt 必須是非負有限數字: ${show(dtSec)}`);
  if (!isFiniteNumber(tauSec) || tauSec <= 0) fail('INVALID_OPTION', `τ 必須是正的有限數字: ${show(tauSec)}`);
  return 1 - Math.exp(-dtSec / tauSec);
}

/**
 * 單位向量 EMA 的一步: x += k(cosθ-x)、y += k(sinθ-y)。純函式,不改傳入的 state。
 * 禁止對角度數值做算術平均或線性 EMA(會在 0/360 繞到 180)。
 * @param {{x:number, y:number}|null} state 上一步的向量;null 表示第一筆,直接取樣
 * @param {number} thetaDeg 新樣本(度)
 * @param {number} k 係數 [0,1]
 * @returns {{x:number, y:number}}
 * @throws {Error} INVALID_BEARING, INVALID_OPTION
 */
export function emaVectorStep(state, thetaDeg, k) {
  if (!isFiniteNumber(thetaDeg)) fail('INVALID_BEARING', `樣本不是有限數字: ${show(thetaDeg)}`);
  if (!isFiniteNumber(k) || k < 0 || k > 1) fail('INVALID_OPTION', `k 必須在 [0,1]: ${show(k)}`);
  if (state !== null && (typeof state !== 'object' || !isFiniteNumber(state.x) || !isFiniteNumber(state.y))) {
    fail('INVALID_OPTION', `state 必須是 null 或 {x, y} 有限數字: ${show(state)}`);
  }
  const cx = Math.cos(thetaDeg * D2R);
  const cy = Math.sin(thetaDeg * D2R);
  if (state === null) return { x: cx, y: cy };
  return { x: state.x + k * (cx - state.x), y: state.y + k * (cy - state.y) };
}

/**
 * EMA 向量 → 方位(度)。向量近 0(新舊樣本相反且權重相等)時方位未定義,回 null。
 * @param {{x:number, y:number}|null} state
 * @returns {number|null}
 */
export function emaHeading(state) {
  if (state === null || state === undefined || Math.hypot(state.x, state.y) < EPS) return null;
  return z(normalizeBearing(Math.atan2(state.y, state.x) * R2D));
}

/**
 * 固定 k 的 EMA 序列(fixtures group6 與離線分析用)。
 * @param {number[]} samplesDeg 樣本(度)
 * @param {{k:number, init?:number|null, method?:'unit-vector'|'shortest-arc'}} opts
 *   unit-vector: 單位向量 EMA(規格採用);shortest-arc: h += k·最短角差(fixtures 對照法)。init 省略則第一筆直接採樣
 * @returns {Array<number|null>} 每筆樣本後的輸出方位
 * @throws {Error} INVALID_READINGS, INVALID_BEARING, INVALID_OPTION
 */
export function circularEmaSeries(samplesDeg, { k, init = null, method = 'unit-vector' } = {}) {
  if (!Array.isArray(samplesDeg)) fail('INVALID_READINGS', '需要樣本陣列');
  if (method !== 'unit-vector' && method !== 'shortest-arc') fail('INVALID_OPTION', `method 不認得: ${show(method)}`);
  if (!isFiniteNumber(k) || k < 0 || k > 1) fail('INVALID_OPTION', `k 必須在 [0,1]: ${show(k)}`);
  if (init !== null && !isFiniteNumber(init)) fail('INVALID_BEARING', `init 不是有限數字: ${show(init)}`);
  if (method === 'unit-vector') {
    let state = init === null ? null : emaVectorStep(null, init, 0);
    return samplesDeg.map((s) => {
      state = emaVectorStep(state, s, k);
      return emaHeading(state);
    });
  }
  let h = init === null ? null : normalizeBearing(init);
  return samplesDeg.map((s) => {
    h = h === null ? normalizeBearing(s) : normalizeBearing(h + k * circularDelta(s, h));
    return z(h);
  });
}

// ─────────────────────────── 顯示與分界 ───────────────────────────

/**
 * 四捨五入到 0.5°(鎖定平均後的顯示精度)。語意 = Math.floor(x+0.5)(0.25 → 0.5),不是銀行家捨入;
 * 359.75 以上回捲成 0(規格 2.9.4 第 4 點、複查 DC-7)。
 * @param {number} headingDeg 度
 * @returns {number} [0,360),0.5 的倍數
 * @throws {Error} INVALID_BEARING
 */
export function roundHalf(headingDeg) {
  const n = normalizeBearing(headingDeg);
  return z(normalizeBearing(Math.floor(n * 2 + 0.5) / 2));
}

/**
 * 四捨五入到 1°(即時顯示精度),同樣是 Math.floor(x+0.5) 語意並回捲。
 * @param {number} headingDeg 度
 * @returns {number} [0,360) 的整數
 * @throws {Error} INVALID_BEARING
 */
export function roundInt(headingDeg) {
  return z(Math.floor(normalizeBearing(headingDeg) + 0.5) % 360);
}

/**
 * 到最近 24 山分界的距離(度)。山中心在 15° 的倍數(子=0),分界在 7.5+15k;
 * 只驗算術,山幾何由 geo 負責(規格 4.1、複查 DC-10)。
 * @param {number} headingDeg 度
 * @returns {number} [0,7.5]
 * @throws {Error} INVALID_BEARING
 */
export function boundaryDistance(headingDeg) {
  const r = normalizeBearing(headingDeg) % 15;
  return z(7.5 - Math.min(r, 15 - r));
}

// ─────────────────────────── 鎖定平均與品質 ───────────────────────────

/**
 * 鎖定平均(規格 2.9.4 第 3 點): 樣本 < minSamples → too-few;圓周 σ > maxStdDeg → unstable;
 * 合成向量近 0 → unstable 且平均為 null;否則 ok。unstable 仍回平均與 σ 供顯示。
 * σ = sqrt(-2 ln R)。感測誤差在時間上相關,平均後不確定度不會照 σ/√N 縮小,所以 σ 要一併顯示。
 * @param {number[]} samplesDeg 度
 * @param {{minSamples?:number, maxStdDeg?:number}} [opts] 預設 20 筆、3°
 * @returns {{status:'ok'|'unstable'|'too-few', n:number, meanDeg:number|null, stdDeg:number|null, displayDeg:number|null}}
 *   displayDeg = roundHalf(meanDeg)
 * @throws {Error} INVALID_READINGS, INVALID_BEARING, INVALID_OPTION
 */
export function lockAverage(samplesDeg, { minSamples = SENSOR_DEFAULTS.lockMinSamples, maxStdDeg = SENSOR_DEFAULTS.lockMaxStdDeg } = {}) {
  if (!Array.isArray(samplesDeg)) fail('INVALID_READINGS', '需要樣本陣列');
  if (!Number.isInteger(minSamples) || minSamples < 1) fail('INVALID_OPTION', `minSamples 必須是 >= 1 的整數: ${show(minSamples)}`);
  if (!isFiniteNumber(maxStdDeg) || maxStdDeg < 0) fail('INVALID_OPTION', `maxStdDeg 必須是非負有限數字: ${show(maxStdDeg)}`);
  samplesDeg.forEach((x, i) => {
    if (!isFiniteNumber(x)) fail('INVALID_BEARING', `samplesDeg[${i}] 不是有限數字: ${show(x)}`);
  });
  const n = samplesDeg.length;
  if (n < minSamples) return { status: 'too-few', n, meanDeg: null, stdDeg: null, displayDeg: null };
  const { mean, stdDeg } = circularStats(samplesDeg);
  if (mean === null) return { status: 'unstable', n, meanDeg: null, stdDeg: null, displayDeg: null };
  return { status: stdDeg <= maxStdDeg ? 'ok' : 'unstable', n, meanDeg: z(mean), stdDeg, displayDeg: roundHalf(mean) };
}

/**
 * 「三次取圓周平均」選項(規格 2.9.4 第 6 點,信心 低): 把多次鎖定的平均再取一次圓周平均。
 * @param {number[]} meansDeg 每次鎖定的平均(度)
 * @param {{minLocks?:number, maxStdDeg?:number}} [opts] 預設至少 3 次、次間 σ <= 3°
 * @returns {{status:'ok'|'unstable'|'too-few', n:number, meanDeg:number|null, stdDeg:number|null, displayDeg:number|null}}
 * @throws {Error} INVALID_READINGS, INVALID_BEARING, INVALID_OPTION
 */
export function combineLockMeans(meansDeg, { minLocks = 3, maxStdDeg = SENSOR_DEFAULTS.lockMaxStdDeg } = {}) {
  return lockAverage(meansDeg, { minSamples: minLocks, maxStdDeg });
}

/**
 * 鎖定所需的樣本筆數 = 秒數 × 取樣率(3 秒 → 60 筆)。
 * @param {number} lockSeconds settings.lockSeconds
 * @returns {number}
 * @throws {Error} INVALID_OPTION
 */
export function lockTargetSamples(lockSeconds) {
  if (!isFiniteNumber(lockSeconds) || lockSeconds <= 0) fail('INVALID_OPTION', `lockSeconds 必須是正的有限數字: ${show(lockSeconds)}`);
  return Math.floor(lockSeconds * SENSOR_DEFAULTS.sampleHz + 0.5);
}

const levelOf = (value, greenMax, yellowMax) => (value > yellowMax ? 2 : value > greenMax ? 1 : 0);

/**
 * 品質燈號(規格 2.9.4 第 5 點,門檻為設計值)。
 * iOS accuracy: <0 或 >25 紅、>10 黃、否則綠;即時 σ: >4° 紅、>2° 黃、否則綠。兩項都有取較差者,都沒有 'unknown'。
 * @param {{accuracyDeg?:number|null, sigmaDeg?:number|null}} [q]
 * @returns {'green'|'yellow'|'red'|'unknown'}
 * @throws {Error} INVALID_OPTION
 */
export function qualityLight({ accuracyDeg = null, sigmaDeg = null } = {}) {
  const D = SENSOR_DEFAULTS;
  const levels = [];
  if (accuracyDeg !== null && accuracyDeg !== undefined) {
    if (!isFiniteNumber(accuracyDeg)) fail('INVALID_OPTION', `accuracyDeg 不是有限數字: ${show(accuracyDeg)}`);
    levels.push(accuracyDeg < 0 ? 2 : levelOf(accuracyDeg, D.accuracyGreenMax, D.accuracyYellowMax));
  }
  if (sigmaDeg !== null && sigmaDeg !== undefined) {
    if (!isFiniteNumber(sigmaDeg) || sigmaDeg < 0) fail('INVALID_OPTION', `sigmaDeg 必須是非負有限數字: ${show(sigmaDeg)}`);
    levels.push(levelOf(sigmaDeg, D.sigmaGreenMax, D.sigmaYellowMax));
  }
  if (levels.length === 0) return 'unknown';
  return ['green', 'yellow', 'red'][Math.max(...levels)];
}

/**
 * 能不能開始鎖定(規格 2.9.4 第 5 點): 要有效讀數、未校準與紅燈停用、傾角 < 15°、螢幕朝上。
 * 檢查順序即 reason 的優先序。tiltDeg 為 null(iOS 事件沒帶姿態角)時無法判斷傾角,放行。
 * @param {{status:string, tiltDeg?:number|null, faceDown?:boolean, quality?:string}|null} reading
 * @returns {{allowed:boolean, reason:null|'no-reading'|'uncalibrated'|'tilt'|'face-down'|'quality-red'}}
 */
export function lockAllowed(reading) {
  const no = (reason) => ({ allowed: false, reason });
  if (reading === null || reading === undefined) return no('no-reading');
  if (reading.status === 'uncalibrated') return no('uncalibrated');
  if (reading.status !== 'ok') return no('no-reading');
  if (isFiniteNumber(reading.tiltDeg) && reading.tiltDeg >= SENSOR_DEFAULTS.lockMaxTiltDeg) return no('tilt');
  if (reading.faceDown === true) return no('face-down');
  if (reading.quality === 'red') return no('quality-red');
  return { allowed: true, reason: null };
}

/**
 * 「接近分界,建議重測」判斷(規格 2.9.4 第 5 點): 距分界 < max(σ, accuracy/2, 2°)。
 * @param {{headingDeg:number, sigmaDeg?:number|null, accuracyDeg?:number|null}} p accuracy 負值(未校準)不計入
 * @returns {{distanceDeg:number, thresholdDeg:number, near:boolean}}
 * @throws {Error} INVALID_BEARING
 */
export function nearBoundary({ headingDeg, sigmaDeg = null, accuracyDeg = null }) {
  const distanceDeg = boundaryDistance(headingDeg);
  const parts = [SENSOR_DEFAULTS.nearBoundaryMinDeg];
  if (isFiniteNumber(sigmaDeg) && sigmaDeg >= 0) parts.push(sigmaDeg);
  if (isFiniteNumber(accuracyDeg) && accuracyDeg > 0) parts.push(accuracyDeg / 2);
  const thresholdDeg = Math.max(...parts);
  return { distanceDeg, thresholdDeg, near: distanceDeg < thresholdDeg };
}

/**
 * 一次鎖定的完整結果: 鎖定平均 + 不確定度 + 分界距離 + 品質燈號 + meta。
 * 不確定度 = max(settings.measureUncertainty, 2σ, iOS accuracy)(geo.measurementUncertainty,規格 2.1.7)。
 * 方位一律是磁北(northMode 固定 'magnetic'),換真北由 geo.toTrue 負責。
 * @param {number[]} samplesDeg 鎖定期間收集的原始讀數(度,不是 EMA 平滑值)
 * @param {{accuracyDeg?:number|null, settings?:object}} [opts]
 *   accuracyDeg: 鎖定期間 iOS accuracy 的最大值,負值(未校準)不進不確定度並加警告;settings: 部分 Settings,讀 lockSeconds、measureUncertainty
 * @returns {{status:'ok'|'unstable'|'too-few', n:number, meanDeg:number|null, stdDeg:number|null, displayDeg:number|null,
 *   accuracyDeg:number|null, uncertaintyDeg:number|null, boundaryDistDeg:number|null, nearBoundary:boolean,
 *   quality:'green'|'yellow'|'red'|'unknown',
 *   meta:{schema:string, ruleset:{lockSeconds:number, measureUncertainty:number}, northMode:'magnetic', warnings:string[]}}}
 * @throws {Error} INVALID_READINGS, INVALID_BEARING, INVALID_OPTION, 未知設定鍵
 */
export function summarizeLock(samplesDeg, { accuracyDeg = null, settings = {} } = {}) {
  const s = resolveSettings(settings);
  lockTargetSamples(s.lockSeconds);
  const lock = lockAverage(samplesDeg);
  const rawAcc = isFiniteNumber(accuracyDeg) ? accuracyDeg : null;
  const acc = rawAcc !== null && rawAcc >= 0 ? rawAcc : null;
  const warnings = [];
  if (rawAcc !== null && rawAcc < 0) warnings.push('uncalibrated');
  let uncertaintyDeg = null;
  let boundaryDistDeg = null;
  let near = false;
  if (lock.meanDeg !== null) {
    uncertaintyDeg = measurementUncertainty({ baseline: s.measureUncertainty, sigmaDeg: lock.stdDeg, accuracyDeg: acc });
    boundaryDistDeg = boundaryDistance(lock.meanDeg);
    near = nearBoundary({ headingDeg: lock.meanDeg, sigmaDeg: lock.stdDeg, accuracyDeg: acc }).near;
    if (near) warnings.push('nearBoundary');
  }
  return {
    ...lock,
    accuracyDeg: rawAcc,
    uncertaintyDeg,
    boundaryDistDeg,
    nearBoundary: near,
    quality: qualityLight({ accuracyDeg: rawAcc, sigmaDeg: lock.stdDeg }),
    meta: {
      schema: 'fengshui.sensor.lock/1',
      ruleset: { lockSeconds: s.lockSeconds, measureUncertainty: s.measureUncertainty },
      northMode: 'magnetic',
      warnings,
    },
  };
}

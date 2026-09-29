// sensor 測試專用: 第二來源的獨立實作(矩陣連乘)、假環境(事件、計時器、權限)、規格表解析。
// 刻意不 import src/core/sensor-core.js 的姿態演算法,姿態向量用矩陣連乘另算一份互相比對。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md');

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const matMul = (a, b) => a.map((row, i) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const matVec = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const Rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const Ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const Rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const headingOfVec = (v) => (Math.hypot(v[0], v[1]) < 1e-9 ? null : (((Math.atan2(v[0], v[1]) * R2D) % 360) + 360) % 360);

/**
 * W3C 定義 R = Rz(alpha)·Rx(beta)·Ry(gamma) 把裝置軸轉到世界(x=東, y=北, z=上)。
 * 頂端 +Y、後鏡頭 -Z、右緣 +X 的水平投影方位;垂直軸回 null。
 * @returns {{top:number|null, back:number|null, right:number|null, zUp:number}}
 */
export function matrixHeadings(alpha, beta, gamma) {
  const R = matMul(matMul(Rz(alpha * D2R), Rx(beta * D2R)), Ry(gamma * D2R));
  return {
    top: headingOfVec(matVec(R, [0, 1, 0])),
    back: headingOfVec(matVec(R, [0, 0, -1])),
    right: headingOfVec(matVec(R, [1, 0, 0])),
    zUp: matVec(R, [0, 0, 1])[2],
  };
}

/** 螢幕平面與水平面的夾角(度),由矩陣的螢幕法向量 z 分量求得(與 acos(|cosβ·cosγ|) 是兩條路)。 */
export function matrixTilt(alpha, beta, gamma) {
  return Math.acos(Math.min(1, Math.abs(matrixHeadings(alpha, beta, gamma).zUp))) * R2D;
}

/** 給定 gamma 與 tilt,反解 beta(0..90)。tilt = acos(cosβ·cosγ)。 */
export function betaForTilt(tiltDeg, gammaDeg) {
  return Math.acos(Math.min(1, Math.cos(tiltDeg * D2R) / Math.cos(gammaDeg * D2R))) * R2D;
}

/** 規格 2.9.2 的 smoothstep(40°,50°) 混合,用矩陣方位另算一份。 */
export function blendReference(alpha, beta, gamma) {
  const h = matrixHeadings(alpha, beta, gamma);
  const tilt = matrixTilt(alpha, beta, gamma);
  const t = Math.min(1, Math.max(0, (tilt - 40) / 10));
  const w = t * t * (3 - 2 * t);
  const unit = (deg) => [Math.sin(deg * D2R), Math.cos(deg * D2R)];
  let x = 0;
  let y = 0;
  let used = 0;
  if (h.top !== null && w < 1) {
    const [ux, uy] = unit(h.top);
    x += (1 - w) * ux;
    y += (1 - w) * uy;
    used += 1;
  }
  if (h.back !== null && w > 0) {
    const [ux, uy] = unit(h.back);
    x += w * ux;
    y += w * uy;
    used += 1;
  }
  if (used === 0) return { heading: null, tilt, w };
  return { heading: headingOfVec([x, y]), tilt, w };
}

/** 可重現的亂數(mulberry32),屬性測試用。 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────── 規格表解析 ───────────────────────────

/** 從 DOMAIN_SPEC.md 2.9.5 的「狀態碼→訊息」表讀出 status → {message, action}。 */
export function parseSpecStatusTable() {
  const text = readFileSync(SPEC_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('**狀態碼→訊息');
  if (start < 0) throw new Error('DOMAIN_SPEC.md 找不到「狀態碼→訊息」表');
  const end = text.indexOf('\n#### 2.9.6', start);
  const rows = text.slice(start, end).split('\n').filter((l) => l.startsWith('| `'));
  const table = {};
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    const codes = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const code of codes.flatMap((c) => c.split('/'))) table[code] = { message: cells[2], action: cells[3] };
  }
  return table;
}

/** 從 2.9.4 第 2 點讀出 k 表: { '60': [τ0.1, τ0.2, τ0.3, τ0.5], ... }。 */
export function parseSpecKTable() {
  const text = readFileSync(SPEC_PATH, 'utf8').replace(/\r\n/g, '\n');
  const line = text.split('\n').find((l) => l.includes('k 表(60/30/20 Hz'));
  if (!line) throw new Error('DOMAIN_SPEC.md 找不到 k 表');
  const out = {};
  for (const m of line.matchAll(/(\d+) Hz \[([^\]]+)\]/g)) out[m[1]] = m[2].split(',').map(Number);
  return out;
}

// ─────────────────────────── 假環境 ───────────────────────────

/**
 * 假瀏覽器環境: window(事件、安全環境、權限)、document(可見性)、可手動推進的計時器與時鐘。
 * @param {object} [o]
 * @param {boolean} [o.secure=true]
 * @param {boolean} [o.hasAbsoluteEvent=true] window 是否有 ondeviceorientationabsolute
 * @param {boolean} [o.hasDOE=true] 是否有 DeviceOrientationEvent
 * @param {Function|undefined} [o.requestPermission] 有值時掛在 DeviceOrientationEvent 上(不含 this 綁定)
 * @param {boolean} [o.withDoc=true]
 */
export function createFakeEnv({ secure = true, hasAbsoluteEvent = true, hasDOE = true, requestPermission, withDoc = true } = {}) {
  const listeners = new Map();
  const addTo = (map) => (type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const removeFrom = (map) => (type, fn) => map.get(type)?.delete(fn);

  const win = { isSecureContext: secure, addEventListener: addTo(listeners), removeEventListener: removeFrom(listeners) };
  if (hasAbsoluteEvent) win.ondeviceorientationabsolute = null;
  const permissionCalls = [];
  if (hasDOE) {
    win.DeviceOrientationEvent = {};
    if (requestPermission) {
      win.DeviceOrientationEvent.requestPermission = (...args) => {
        permissionCalls.push(args);
        return requestPermission(...args);
      };
    }
  }

  const docListeners = new Map();
  const doc = withDoc
    ? { visibilityState: 'visible', addEventListener: addTo(docListeners), removeEventListener: removeFrom(docListeners) }
    : null;

  let clock = 0;
  let seq = 0;
  const pending = [];
  const timers = {
    setInterval: (fn, ms) => {
      const id = ++seq;
      pending.push({ id, fn, due: clock + ms, every: ms });
      return id;
    },
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.push({ id, fn, due: clock + ms, every: null });
      return id;
    },
    clearInterval: (id) => {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    clearTimeout: (id) => {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
  };

  const env = { win, doc, timers, now: () => clock };
  return {
    env,
    win,
    doc,
    permissionCalls,
    get clock() {
      return clock;
    },
    /** 往前推進 ms,依到期時間與建立順序執行計時器。 */
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = pending.filter((p) => p.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!due) break;
        clock = due.due;
        if (due.every === null) pending.splice(pending.indexOf(due), 1);
        else due.due += due.every;
        due.fn();
      }
      clock = target;
    },
    /** 對 window 發事件(type + 欄位)。 */
    dispatch(type, init = {}) {
      const ev = { type, ...init };
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    pendingTimers: () => pending.length,
    setVisibility(state) {
      doc.visibilityState = state;
      for (const fn of [...(docListeners.get('visibilitychange') ?? [])]) fn({ type: 'visibilitychange' });
    },
    docListenerCount: (type) => docListeners.get(type)?.size ?? 0,
  };
}

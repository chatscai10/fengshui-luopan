// 手機方位的瀏覽器適配層(docs/DOMAIN_SPEC.md 2.9.4、2.9.5、D65、D69)。
// window / document / 計時器 / 時鐘全部由參數 env 注入,本檔不碰任何全域,所以可用假環境測試。
// 純函式(解碼、平滑、鎖定平均)在 sensor-core.js。
import { circularStats } from './geo.js';
import { resolveSettings } from './settings.js';
import {
  SENSOR_DEFAULTS,
  decodeOrientationEvent,
  emaK,
  emaVectorStep,
  emaHeading,
  roundInt,
  qualityLight,
  lockAllowed,
  lockTargetSamples,
  summarizeLock,
} from './sensor-core.js';

/**
 * 錯誤碼: INVALID_OPTION env 或選項不合法(設定鍵不認得時透傳 resolveSettings 的錯誤)。
 *
 * 狀態碼(onStatus 收到的 status):
 *  insecure-context / unsupported / permission-denied / permission-error(附原因字串)/ no-events / running
 *  訊息文字與動作見 sensor-core 的 STATUS_INFO、describeStatus。
 */

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const noop = () => {};

/**
 * @typedef {Object} CompassEnv 感測層需要的全部外部世界
 * @property {{addEventListener:Function, removeEventListener:Function, isSecureContext?:boolean, DeviceOrientationEvent?:any}} win
 *   window 或假物件。`'ondeviceorientationabsolute' in win` 決定聽哪個事件
 * @property {{addEventListener:Function, removeEventListener:Function, visibilityState?:string}|null} [doc]
 *   document 或假物件;省略或 null 就不處理頁面可見性
 * @property {{setInterval:Function, clearInterval:Function, setTimeout:Function, clearTimeout:Function}} timers
 * @property {() => number} now 目前時間(ms epoch)
 */

/**
 * @typedef {Object} Reading 每個取樣點的讀數(JSON 可序列化)
 * @property {'webkitCompassHeading'|'alpha-absolute'|'alpha-relative'|null} source
 * @property {number|null} headingDeg 解碼後的原始方位(磁北,度)
 * @property {number|null} accuracyDeg iOS 回報精度(±度,-1=未校準),Android 為 null
 * @property {string} status ok | uncalibrated | invalid | tilt-too-large | relative-not-north | no-sensor | degenerate
 * @property {'top-edge'|'back-camera'|'blend'|null} mode
 * @property {number|null} tiltDeg
 * @property {boolean} faceDown
 * @property {number} t 取樣時間(ms epoch)
 * @property {number|null} smoothedDeg 圓周 EMA 平滑後的方位
 * @property {number|null} displayDeg 即時顯示值(1°,Math.floor(x+0.5) 語意)
 * @property {number|null} sigmaDeg 近 1 秒的圓周標準差,樣本不足為 null
 * @property {'green'|'yellow'|'red'|'unknown'} quality
 */

/**
 * 由呼叫端傳入的全域物件(通常是 window)組出 CompassEnv。本函式只讀傳進來的物件。
 * @param {object} g window 或 globalThis
 * @returns {CompassEnv}
 * @throws {Error} INVALID_OPTION
 */
export function createBrowserEnv(g) {
  if (g === null || typeof g !== 'object') fail('INVALID_OPTION', 'createBrowserEnv 需要傳入瀏覽器的全域物件');
  const perf = g.performance;
  // 單調時鐘加上原點,得到 ms epoch 又不受系統校時跳動影響
  const now =
    perf && typeof perf.now === 'function' && isFiniteNumber(perf.timeOrigin)
      ? () => perf.timeOrigin + perf.now()
      : () => g.Date.now();
  return {
    win: g,
    doc: g.document ?? null,
    timers: {
      setInterval: (fn, ms) => g.setInterval(fn, ms),
      clearInterval: (id) => g.clearInterval(id),
      setTimeout: (fn, ms) => g.setTimeout(fn, ms),
      clearTimeout: (id) => g.clearTimeout(id),
    },
    now,
  };
}

function assertEnv(env) {
  if (env === null || typeof env !== 'object') fail('INVALID_OPTION', 'env 必須是物件(見 CompassEnv)');
  if (env.win === null || typeof env.win !== 'object') fail('INVALID_OPTION', 'env.win 缺');
  if (typeof env.now !== 'function') fail('INVALID_OPTION', 'env.now 必須是函式');
  const t = env.timers;
  for (const name of ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']) {
    if (!t || typeof t[name] !== 'function') fail('INVALID_OPTION', `env.timers.${name} 必須是函式`);
  }
}

/**
 * 建立羅盤來源(介面即 D65 的 CompassSource,日後可換原生外掛)。
 * start() 必須由使用者手勢(點「啟用羅盤」)呼叫: iOS 的 requestPermission 沒有手勢會 reject。
 *
 * 流程(規格 2.9.5): isSecureContext 為 false → insecure-context;無 DeviceOrientationEvent → unsupported;
 * requestPermission 是函式就 await requestPermission(true),非 granted → permission-denied,例外 → permission-error;
 * 掛監聽並啟動 1.5 秒 watchdog,逾時 → no-events(保留監聽,事件一來自動恢復)。
 * 頁面進背景不會有事件: 停掉監聽,回前景重掛並重計 watchdog,不再要求權限。
 *
 * @param {Object} params
 * @param {CompassEnv} params.env
 * @param {(reading:Reading) => void} [params.onReading] 每個取樣點呼叫一次(有事件之後)
 * @param {(status:string, detail?:string) => void} [params.onStatus]
 * @param {object} [params.settings] 部分 Settings,讀 lockSeconds、measureUncertainty
 * @param {number} [params.sampleMs] 取樣間隔,預設 50(20 Hz)
 * @param {number} [params.watchdogMs] 預設 1500
 * @param {number} [params.tauSec] EMA 時間常數,預設 0.2
 * @param {boolean} [params.debugTreatRelativeAsAbsolute] 桌機 DevTools 只驅動 relative 感測器,debug 時把它當絕對事件
 * @param {boolean} [params.skipPermission] 只給測試用
 * @param {boolean} [params.proceedOnPermissionError] permission-error 後仍掛監聽,交給 watchdog 判斷有沒有事件。
 *   預設 false(iOS 無手勢時 reject,繼續只會讓訊息被 no-events 蓋掉);Chromium/WebView 行為未定(U-05),實機驗證後再決定
 * @returns {{start:() => Promise<{ok:boolean, status:string}>, stop:() => void, resume:() => boolean,
 *   lock:() => Promise<object>, getLastReading:() => Reading|null, readonly running:boolean}}
 * @throws {Error} INVALID_OPTION, 未知設定鍵
 */
export function createCompassSource(params = {}) {
  const {
    env,
    onReading = noop,
    onStatus = noop,
    settings = {},
    sampleMs = SENSOR_DEFAULTS.sampleMs,
    watchdogMs = SENSOR_DEFAULTS.watchdogMs,
    tauSec = SENSOR_DEFAULTS.emaTauSec,
    debugTreatRelativeAsAbsolute = false,
    skipPermission = false,
    proceedOnPermissionError = false,
  } = params;
  assertEnv(env);
  for (const [name, v] of [['sampleMs', sampleMs], ['watchdogMs', watchdogMs], ['tauSec', tauSec]]) {
    if (!isFiniteNumber(v) || v <= 0) fail('INVALID_OPTION', `${name} 必須是正的有限數字: ${v}`);
  }
  const resolved = resolveSettings(settings);
  lockTargetSamples(resolved.lockSeconds);
  const lockDurationMs = resolved.lockSeconds * 1000;
  const { timers } = env;

  let wantRunning = false; // start() 成功後為 true,只有 stop() 會改回 false
  let armed = false; // 監聽與計時器目前是否掛著
  let armedTypes = [];
  let startPromise = null;
  let generation = 0; // stop() 讓進行中的 start() 作廢
  let visibilityAttached = false;
  let latest = null; // 事件處理只存最新值,由計時器取樣
  let gotEvent = false;
  let noEventsFired = false;
  let timerId = null;
  let dogId = null;
  let emaState = null;
  let lastTickT = null;
  let sigmaBuf = [];
  let lastReading = null;
  let lockJob = null;

  const resetSmoothing = () => {
    emaState = null;
    lastTickT = null;
    sigmaBuf = [];
  };

  const cancelLock = () => {
    if (lockJob === null) return;
    const job = lockJob;
    lockJob = null;
    job.resolve({ status: 'cancelled' });
  };

  const finishLock = () => {
    const job = lockJob;
    lockJob = null;
    job.resolve({ ...summarizeLock(job.samples, { accuracyDeg: job.accuracyDeg, settings }), lockedAtMs: env.now() });
  };

  const onEvent = (ev) => {
    latest = {
      type: ev.type,
      alpha: ev.alpha,
      beta: ev.beta,
      gamma: ev.gamma,
      absolute: debugTreatRelativeAsAbsolute ? true : ev.absolute,
      webkitCompassHeading: ev.webkitCompassHeading,
      webkitCompassAccuracy: ev.webkitCompassAccuracy,
    };
    if (gotEvent) return;
    gotEvent = true;
    if (dogId !== null) {
      timers.clearTimeout(dogId);
      dogId = null;
    }
    if (noEventsFired) {
      noEventsFired = false;
      onStatus('running');
    }
  };

  const onWatchdog = () => {
    dogId = null;
    noEventsFired = true;
    onStatus('no-events');
  };

  const tick = () => {
    if (latest === null) return;
    const t = env.now();
    const d = decodeOrientationEvent(latest);
    let smoothedDeg = null;
    let displayDeg = null;
    if (d.status === 'ok' && d.headingDeg !== null) {
      const dt = lastTickT === null ? 0 : Math.min(Math.max((t - lastTickT) / 1000, 0), SENSOR_DEFAULTS.emaMaxStepSec);
      emaState = emaVectorStep(emaState, d.headingDeg, emaK(dt, tauSec));
      smoothedDeg = emaHeading(emaState);
      displayDeg = smoothedDeg === null ? null : roundInt(smoothedDeg);
      sigmaBuf.push(d.headingDeg);
      if (sigmaBuf.length > SENSOR_DEFAULTS.sigmaWindow) sigmaBuf.shift();
    } else {
      // 讀數中斷後不從過期的平滑值拖曳
      emaState = null;
      sigmaBuf = [];
    }
    lastTickT = t;
    const sigmaDeg = sigmaBuf.length >= SENSOR_DEFAULTS.sigmaMinSamples ? circularStats(sigmaBuf).stdDeg : null;
    const reading = {
      ...d,
      t,
      smoothedDeg,
      displayDeg,
      sigmaDeg,
      quality: qualityLight({ accuracyDeg: d.accuracyDeg, sigmaDeg }),
    };
    if (lockJob !== null) {
      // 鎖定用原始讀數(EMA 會低估 σ);傾角 >= 15° 或螢幕朝下的樣本不信任
      const usable = d.status === 'ok' && d.headingDeg !== null && !d.faceDown && (d.tiltDeg === null || d.tiltDeg < SENSOR_DEFAULTS.lockMaxTiltDeg);
      if (usable) {
        lockJob.samples.push(d.headingDeg);
        if (isFiniteNumber(d.accuracyDeg)) {
          lockJob.accuracyDeg = lockJob.accuracyDeg === null ? d.accuracyDeg : Math.max(lockJob.accuracyDeg, d.accuracyDeg);
        }
      }
      if (t - lockJob.startT >= lockDurationMs) finishLock();
    }
    lastReading = reading;
    onReading(reading);
  };

  const arm = () => {
    const win = env.win;
    // Android Chromium 有 ondeviceorientationabsolute 就只聽它(TYPE_ROTATION_VECTOR,磁北);iOS 聽 deviceorientation + webkitCompassHeading
    armedTypes = 'ondeviceorientationabsolute' in win ? ['deviceorientationabsolute'] : ['deviceorientation'];
    if (debugTreatRelativeAsAbsolute && !armedTypes.includes('deviceorientation')) armedTypes.push('deviceorientation');
    for (const type of armedTypes) win.addEventListener(type, onEvent);
    latest = null;
    gotEvent = false;
    noEventsFired = false;
    resetSmoothing();
    dogId = timers.setTimeout(onWatchdog, watchdogMs);
    timerId = timers.setInterval(tick, sampleMs);
    armed = true;
  };

  const disarm = () => {
    if (!armed) return;
    for (const type of armedTypes) env.win.removeEventListener(type, onEvent);
    timers.clearInterval(timerId);
    if (dogId !== null) timers.clearTimeout(dogId);
    timerId = null;
    dogId = null;
    armed = false;
    latest = null;
    lastReading = null;
    resetSmoothing();
    cancelLock();
  };

  const hidden = () => Boolean(env.doc) && env.doc.visibilityState === 'hidden';

  const onVisibility = () => {
    if (hidden()) {
      disarm();
    } else if (wantRunning && !armed) {
      arm();
      onStatus('running');
    }
  };

  const attachVisibility = () => {
    if (!env.doc || visibilityAttached) return;
    env.doc.addEventListener('visibilitychange', onVisibility);
    visibilityAttached = true;
  };

  const detachVisibility = () => {
    if (!visibilityAttached) return;
    env.doc.removeEventListener('visibilitychange', onVisibility);
    visibilityAttached = false;
  };

  async function doStart() {
    const myGen = (generation += 1);
    const cancelled = { ok: false, status: 'cancelled' };
    const report = (status, detail) => {
      onStatus(status, detail);
      return { ok: false, status };
    };
    const { win } = env;
    if (!win.isSecureContext) return report('insecure-context');
    const DOE = win.DeviceOrientationEvent;
    if (!DOE) return report('unsupported');
    if (!skipPermission && typeof DOE.requestPermission === 'function') {
      let result;
      try {
        result = await DOE.requestPermission(true); // true = 一併要磁力計(規格);Safari 忽略此參數
      } catch (e) {
        if (myGen !== generation) return cancelled;
        onStatus('permission-error', String(e));
        if (!proceedOnPermissionError) return { ok: false, status: 'permission-error' };
        result = 'granted';
      }
      if (myGen !== generation) return cancelled;
      if (result !== 'granted') return report('permission-denied');
    }
    wantRunning = true;
    attachVisibility();
    if (!hidden()) {
      arm();
      onStatus('running');
    }
    return { ok: true, status: 'running' };
  }

  return {
    /**
     * 啟動(必須從使用者手勢呼叫)。重複呼叫回同一個結果,不重問權限。
     * @returns {Promise<{ok:boolean, status:string}>} status: running | cancelled | 各種失敗狀態碼
     */
    start() {
      if (wantRunning) return Promise.resolve({ ok: true, status: 'running' });
      if (startPromise !== null) return startPromise;
      const p = doStart().finally(() => {
        if (startPromise === p) startPromise = null;
      });
      startPromise = p;
      return p;
    },

    /** 停止並清掉監聽、計時器、平滑狀態;進行中的鎖定回 cancelled。 */
    stop() {
      generation += 1;
      startPromise = null;
      wantRunning = false;
      disarm();
      detachVisibility();
    },

    /**
     * 回前景時重啟(等同 stop 再 start,但不重問權限、不需手勢),給 Capacitor appStateChange 用。
     * @returns {boolean} 未啟動過(或已 stop)回 false
     */
    resume() {
      if (!wantRunning) return false;
      disarm();
      if (!hidden()) {
        arm();
        onStatus('running');
      }
      return true;
    },

    /**
     * 開始鎖定平均(秒數取自 settings.lockSeconds)。閘門不過立即回 {status:'blocked', reason};
     * 進行中重複呼叫回同一個 promise;stop 或進背景回 {status:'cancelled'};
     * 完成回 summarizeLock 的結果(ok / unstable / too-few)加上 lockedAtMs(完成時間,ms epoch)。
     * @returns {Promise<object>}
     */
    lock() {
      if (lockJob !== null) return lockJob.promise;
      if (!armed) return Promise.resolve({ status: 'blocked', reason: 'not-running' });
      const gate = lockAllowed(lastReading);
      if (!gate.allowed) return Promise.resolve({ status: 'blocked', reason: gate.reason });
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      lockJob = { promise, resolve, samples: [], accuracyDeg: null, startT: env.now() };
      return promise;
    },

    /** @returns {Reading|null} 最近一筆讀數 */
    getLastReading() {
      return lastReading;
    },

    get running() {
      return armed;
    },
  };
}

// 手機指北針的控制器(docs/EASY_SPEC.md 8.10):把羅盤分頁的感測器狀態規則包成可注入環境的物件,
// 底層仍用 core/sensor.js 的 createCompassSource(解碼、平滑、鎖定都不重寫)。
// 不碰 DOM;window、計時器、時鐘都由 env 注入(瀏覽器用 createBrowserEnv(window),測試用假環境)。
import { createCompassSource } from '../core/sensor.js';
import { lockAllowed } from '../core/sensor-core.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { sensorMessage, lockBlockedMessage, DENIED_HELP } from './sensorText.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const noop = () => {};

/**
 * @param {{env:object, settings?:object, onChange?:(state:object, kind:'phase'|'reading'|'lock')=>void,
 *   relativeFailAfter?:number, startLabel?:string}} p
 *   settings 可直接傳 store.get().settings(只取有限數字的 lockSeconds、measureUncertainty);
 *   relativeFailAfter = 連續幾筆「不是指北」的事件才判定失敗;noSensorAfter = 連續幾筆「沒有角度」才當成沒有感測器
 *   (預設 30 筆,約 1.5 秒,和來源的 watchdog 一樣長;有些裝置剛啟動時先送一筆空事件);startLabel = 畫面上啟動按鈕的文字(鎖定被擋時的提示用)
 * @returns {{start:()=>Promise<{ok:boolean, status:string}>, stop:()=>void, lock:()=>Promise<object|null>,
 *   getState:()=>object, destroy:()=>void}}
 */
export function createSensorSession({ env, settings = {}, onChange = noop, relativeFailAfter = 10, noSensorAfter = 30, startLabel = '使用手機指北針' } = {}) {
  const opts = {};
  const s = settings && typeof settings === 'object' ? settings : {};
  if (isNum(s.lockSeconds)) opts.lockSeconds = s.lockSeconds;
  if (isNum(s.measureUncertainty)) opts.measureUncertainty = s.measureUncertainty;
  const lockSeconds = isNum(opts.lockSeconds) ? opts.lockSeconds : DEFAULT_SETTINGS.lockSeconds;
  const relLimit = Number.isInteger(relativeFailAfter) && relativeFailAfter > 0 ? relativeFailAfter : 10;
  const noSensorLimit = Number.isInteger(noSensorAfter) && noSensorAfter > 0 ? noSensorAfter : 30;
  let noSensorCount = 0;

  const st = {
    phase: 'idle',
    failStatus: null,
    message: '',
    reading: null,
    headingRaw: null,
    locking: false,
    lockMs: lockSeconds * 1000,
    lockStartedAtMs: null,
    note: '',
    noteKey: null,
    noteReason: null,
  };
  let source = null;
  let destroyed = false;
  let relativeCount = 0;
  let lockPromise = null;

  const emit = (kind) => {
    if (destroyed) return;
    try { onChange(api.getState(), kind); } catch (e) { console.error('sensorSession onChange', e); }
  };
  const setPhase = (phase) => {
    if (st.phase === phase) return false;
    st.phase = phase;
    return true;
  };

  function stopSource() {
    if (source) { try { source.stop(); } catch { /* 已停 */ } }
    source = null;
    st.reading = null;
    st.headingRaw = null;
    relativeCount = 0;
  }

  function fail(status, message) {
    stopSource();
    st.failStatus = status;
    st.message = message;
    st.phase = 'failed';
    emit('phase');
  }

  function onStatus(status) {
    if (destroyed) return;
    if (status === 'running') {
      let changed = false;
      if (st.phase === 'waiting' || st.phase === 'starting') changed = setPhase('running');
      if (st.phase === 'running') { st.message = ''; st.failStatus = null; }
      if (changed) emit('phase');
      return;
    }
    if (status === 'no-events') {
      st.failStatus = 'no-events';
      st.message = sensorMessage('no-events');
      setPhase('waiting');
      emit('phase');
      return;
    }
    // permission-denied / permission-error / unsupported / insecure-context
    if (st.phase === 'failed' && st.failStatus === status) return; // 同一個失敗會由來源與 start() 各報一次
    const denied = status === 'permission-denied' || status === 'permission-error';
    fail(status, denied ? `${sensorMessage(status)}${DENIED_HELP}` : (sensorMessage(status) || sensorMessage('no-events')));
  }

  function onReading(r) {
    if (destroyed) return;
    st.reading = r;
    if (r.status !== 'relative-not-north') relativeCount = 0;
    if (r.status !== 'no-sensor') noSensorCount = 0;
    let phaseChanged = false;
    if (r.status === 'ok' && isNum(r.smoothedDeg)) {
      st.headingRaw = r.smoothedDeg;
      phaseChanged = setPhase('running');
      st.message = '';
      st.failStatus = null;
    } else if (r.status === 'relative-not-north') {
      // 剛授權後最初幾筆可能還沒帶指北值,連續多筆才判定這台裝置給不出北
      relativeCount += 1;
      if (relativeCount >= relLimit) {
        fail('relative-not-north', sensorMessage('relative-not-north'));
        return;
      }
    } else if (r.status === 'no-sensor') {
      noSensorCount += 1;
      if (noSensorCount < noSensorLimit) return;
      phaseChanged = setPhase('waiting');
      st.failStatus = 'no-sensor';
      st.message = sensorMessage('no-events');
    } else {
      // uncalibrated / invalid / tilt-too-large / degenerate:顯示訊息,方位停在最後一個好讀數
      st.message = sensorMessage(r.status) || '';
    }
    if (phaseChanged) emit('phase');
    emit('reading');
  }

  const api = {
    /** 必須在點擊事件裡同步呼叫:內部同步建立來源並呼叫 source.start()(iOS 權限視窗的要求) */
    start() {
      if (destroyed) return Promise.resolve({ ok: false, status: 'cancelled' });
      if (source && (st.phase === 'running' || st.phase === 'waiting' || st.phase === 'starting')) {
        return source.start();
      }
      stopSource();
      st.phase = 'starting';
      st.message = '';
      st.failStatus = null;
      st.note = '';
      st.noteKey = null;
      st.noteReason = null;
      let mine;
      try {
        mine = createCompassSource({ env, onReading, onStatus, settings: opts });
      } catch {
        fail('unsupported', sensorMessage('unsupported'));
        return Promise.resolve({ ok: false, status: 'unsupported' });
      }
      source = mine;
      const p = mine.start();
      if (st.phase === 'starting') emit('phase');
      return p.then((res) => {
        if (destroyed || source !== mine) return res;
        if (res && res.ok) {
          if (setPhase(st.phase === 'starting' ? 'running' : st.phase)) emit('phase');
        } else if (res && res.status && res.status !== 'cancelled') {
          onStatus(res.status);
        }
        return res;
      }, () => {
        if (!destroyed && source === mine) fail('permission-error', `${sensorMessage('permission-error')}${DENIED_HELP}`);
        return { ok: false, status: 'permission-error' };
      });
    },

    /** 停止並移除監聽,回到 idle */
    stop() {
      const wasActive = st.phase !== 'idle' || source !== null;
      stopSource();
      st.phase = 'idle';
      st.message = '';
      st.failStatus = null;
      st.locking = false;
      st.lockStartedAtMs = null;
      if (wasActive) emit('phase');
    },

    /**
     * 鎖定平均(秒數 = settings.lockSeconds)。回 null 表示被擋、樣本不足或中斷,原因在 state.noteKey / note。
     * @returns {Promise<{status:'ok'|'unstable', meanDeg:number, sigma:number, lockedAtMs:number, uncertaintyDeg:number,
     *   accuracyDeg:number|null}|null>} accuracyDeg = 鎖定期間 iPhone 自己估計誤差的最大值(Android 為 null;−1 = 未校準)
     */
    lock() {
      if (lockPromise) return lockPromise;
      const setNote = (key, note, reason = null) => {
        st.noteKey = key;
        st.note = note;
        st.noteReason = reason;
      };
      if (destroyed || !source || st.phase !== 'running') {
        setNote('blocked', lockBlockedMessage('not-running', { startLabel }), 'not-running');
        emit('lock');
        return Promise.resolve(null);
      }
      const gate = lockAllowed(source.getLastReading());
      if (!gate.allowed) {
        setNote('blocked', lockBlockedMessage(gate.reason, { startLabel }), gate.reason);
        emit('lock');
        return Promise.resolve(null);
      }
      const mine = source;
      setNote(null, '');
      st.locking = true;
      st.lockStartedAtMs = env.now();
      emit('lock');
      lockPromise = mine.lock().catch(() => ({ status: 'cancelled' })).then((res) => {
        lockPromise = null;
        if (destroyed) return null;
        st.locking = false;
        st.lockStartedAtMs = null;
        let out = null;
        if (res && res.status === 'blocked') {
          setNote('blocked', lockBlockedMessage(res.reason, { startLabel }), res.reason ?? null);
        } else if (res && res.status === 'too-few') {
          setNote('too-few', sensorMessage('too-few'));
        } else if (res && (res.status === 'ok' || res.status === 'unstable') && isNum(res.meanDeg)) {
          out = {
            status: res.status, meanDeg: res.meanDeg, sigma: res.stdDeg, lockedAtMs: res.lockedAtMs, uncertaintyDeg: res.uncertaintyDeg,
            accuracyDeg: isNum(res.accuracyDeg) ? res.accuracyDeg : null,
          };
        } else if (res && res.status === 'unstable') {
          // 讀數互相抵消、算不出平均(極少見):當成樣本不足,請使用者再按一次
          setNote('too-few', sensorMessage('too-few'));
        } else {
          setNote('cancelled', '');
        }
        emit('lock');
        return out;
      });
      return lockPromise;
    },

    /** 目前狀態的凍結快照 */
    getState() {
      return Object.freeze({
          phase: st.phase,
          failStatus: st.failStatus,
          message: st.message,
          reading: st.reading ? Object.freeze({ ...st.reading }) : null,
          headingRaw: st.headingRaw,
          gate: Object.freeze(lockAllowed(st.reading)),
          locking: st.locking,
          lockMs: st.lockMs,
          lockStartedAtMs: st.lockStartedAtMs,
          note: st.note,
          noteKey: st.noteKey,
        noteReason: st.noteReason,
      });
    },

    /** 可重複呼叫;之後不再觸發 onChange */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopSource();
      st.phase = 'idle';
      st.locking = false;
    },
  };
  return api;
}

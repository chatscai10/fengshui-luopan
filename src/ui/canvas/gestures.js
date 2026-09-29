// 盤面拖曳與慣性。角度展開、角速度平滑、放手前 80ms 沒動歸零、慣性 τ=0.5s 都用 src/core/luopan.js 的純函式,
// 這裡只負責把指標事件與動畫幀接上去。時鐘與動畫幀由參數注入,node 可用假時鐘測試。
import { createDragState, dragStart, dragMove, dragEnd, inertiaStep, GESTURE } from '../../core/luopan.js';

/**
 * 建立盤面手勢控制器(與 DOM 無關)。
 * @param {object} o
 * @param {() => {cx:number, cy:number, radiusPx:number}} o.getGeometry 盤心與盤面半徑(視窗座標),按下時才讀一次
 * @param {() => number} o.getDial 目前盤角(度)
 * @param {(deg:number, meta:{phase:'drag'|'inertia'}) => void} o.setDial 寫入新盤角
 * @param {() => void} [o.onStart] 真正開始拖曳時(用來暫停感測器)
 * @param {(info:{omega0:number}) => void} [o.onEnd] 放手時(慣性開始之前)
 * @param {() => void} [o.onSettle] 慣性停止時
 * @param {() => number} [o.now]
 * @param {(fn:(t:number)=>void) => any} [o.raf]
 * @param {(id:any) => void} [o.caf]
 * @param {() => boolean} [o.reducedMotion]
 */
export function createDialGesture(o) {
  const now = o.now || (() => performance.now());
  const raf = o.raf || ((fn) => requestAnimationFrame(fn));
  const caf = o.caf || ((id) => cancelAnimationFrame(id));
  const reduced = o.reducedMotion || (() => false);

  let state = createDragState(0);
  let geo = null;
  let rafId = null;
  let omega = 0;
  let lastT = 0;
  let inertiaRunning = false;

  const stopInertia = () => {
    if (rafId !== null) caf(rafId);
    rafId = null;
    inertiaRunning = false;
    omega = 0;
  };

  const tick = (t) => {
    rafId = null;
    if (!inertiaRunning) return;
    // 分頁切走再回來時 dt 會很大,截在 50ms 內避免一步甩過頭
    const dt = Math.min(Math.max((t - lastT) / 1000, 0), 0.05);
    lastT = t;
    const s = inertiaStep(omega, dt);
    if (s.deltaDeg !== 0) {
      state = { ...state, dialDeg: state.dialDeg + s.deltaDeg };
      o.setDial(state.dialDeg, { phase: 'inertia' });
    }
    omega = s.omega;
    if (s.done) {
      inertiaRunning = false;
      if (o.onSettle) o.onSettle();
      return;
    }
    rafId = raf(tick);
  };

  return {
    /** @returns {boolean} 是否接手這次按下(天池內或盤外不接手) */
    pointerDown({ x, y }) {
      stopInertia();
      geo = o.getGeometry();
      if (!geo || !(geo.radiusPx > 0)) return false;
      const dx = x - geo.cx;
      const dy = y - geo.cy;
      // 盤緣外圈以外的空白不接手,讓頁面仍能捲動
      if (Math.hypot(dx, dy) > geo.radiusPx * 1.12) return false;
      try {
        state = dragStart(createDragState(o.getDial()), { px: x, py: y, cx: geo.cx, cy: geo.cy, radiusPx: geo.radiusPx, tMs: now() });
      } catch {
        state = { ...state, dragging: false }; // 座標壞掉(NaN)就不接手
        return false;
      }
      if (state.dragging && o.onStart) o.onStart();
      return state.dragging;
    },

    pointerMove({ x, y }) {
      if (!state.dragging || !geo) return;
      try {
        state = dragMove(state, { px: x, py: y, cx: geo.cx, cy: geo.cy, tMs: now() });
      } catch { return; }
      o.setDial(state.dialDeg, { phase: 'drag' });
    },

    pointerUp() {
      if (!state.dragging) return;
      const res = dragEnd(state, { tMs: now(), reducedMotion: reduced() });
      state = res.state;
      omega = res.omega0;
      if (o.onEnd) o.onEnd({ omega0: res.omega0 });
      if (Math.abs(omega) >= GESTURE.minOmegaDegPerSec) {
        inertiaRunning = true;
        lastT = now();
        rafId = raf(tick);
      } else if (o.onSettle) {
        o.onSettle();
      }
    },

    /** 外部直接改盤角(按鈕、輸入、感測器)時呼叫,避免慣性與新值打架 */
    cancel() {
      stopInertia();
      state = { ...state, dragging: false };
    },

    isDragging: () => state.dragging,
    isCoasting: () => inertiaRunning,
    destroy() {
      stopInertia();
      state = { ...state, dragging: false };
    },
  };
}

/**
 * 把控制器綁到元素上(Pointer Events + setPointerCapture)。只追蹤第一根手指。
 * @returns {() => void} 解除綁定
 */
export function bindDialGestures(el, gesture) {
  let activeId = null;

  const release = (e) => {
    if (activeId === null || (e && e.pointerId !== activeId)) return;
    try { el.releasePointerCapture(activeId); } catch { /* 已釋放 */ }
    activeId = null;
    gesture.pointerUp();
  };
  const onDown = (e) => {
    if (activeId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!gesture.pointerDown({ x: e.clientX, y: e.clientY })) return;
    activeId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有可捕捉的指標 */ }
    e.preventDefault();
  };
  const onMove = (e) => {
    if (e.pointerId !== activeId) return;
    gesture.pointerMove({ x: e.clientX, y: e.clientY });
  };
  const onUp = (e) => release(e);

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', onUp);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('lostpointercapture', onUp);
    activeId = null;
  };
}

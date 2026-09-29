// 財位縮圖:畫房間、太極點、八個方位的名稱,以及金色「財」標記與脈動光圈。
// 座標一律走 plan/coords.js:只翻轉 y、不旋轉,圖面上方 = 平面圖 +y,圖面上方的羅盤方位角 = planUpBearing。
// 版面計算(layoutMiniPlan 等)是純函式,可在 node 測試;Canvas 與 DOM 只在 mountMiniPlan 內碰。
import { boundsOf, makeView, vectorOfBearing, guaCenterBearing, wedgePolygon } from '../plan/coords.js';
import { openingCenter } from '../../core/plan.js';
import { GUA } from '../../core/geo.js';
import { roomDisplayName } from '../plan/labels.js';
import { fitCanvas, cssVar, KAI_STACK, UI_STACK } from './canvasUtil.js';

/** 給使用者看的房間名稱(與平面圖畫面同一套規則:plan/labels.js)。絕不顯示內部 id */
export function roomLabel(plan, roomId) {
  const rooms = plan && Array.isArray(plan.rooms) ? plan.rooms.filter(Boolean) : [];
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return roomId === 'outline' ? '整個空間' : '這個空間';
  return roomDisplayName(plan, room);
}

const isPt = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const cleanPoly = (poly) => (Array.isArray(poly) ? poly.filter(isPt) : []);

/** 射線從 origin 沿 dir 走到矩形邊界的交點(origin 在矩形外時先夾回矩形內) */
export function rayToRect(origin, dir, rect) {
  const ox = Math.min(rect.x1, Math.max(rect.x0, origin[0]));
  const oy = Math.min(rect.y1, Math.max(rect.y0, origin[1]));
  let t = Infinity;
  if (dir[0] > 1e-9) t = Math.min(t, (rect.x1 - ox) / dir[0]);
  else if (dir[0] < -1e-9) t = Math.min(t, (rect.x0 - ox) / dir[0]);
  if (dir[1] > 1e-9) t = Math.min(t, (rect.y1 - oy) / dir[1]);
  else if (dir[1] < -1e-9) t = Math.min(t, (rect.y0 - oy) / dir[1]);
  if (!Number.isFinite(t)) t = 0;
  return [ox + dir[0] * t, oy + dir[1] * t];
}

/**
 * 版面計算。回傳像素座標,畫布與測試共用。
 * @param {{plan:object, taiji:(number[]|null), up:(number|null), markers:Array<{id:string, point:number[], sector?:string}>}} model
 */
export function layoutMiniPlan(model, w, h, { pad = 26 } = {}) {
  const plan = model.plan || {};
  const outline = cleanPoly(plan.outline);
  const rooms = (Array.isArray(plan.rooms) ? plan.rooms : []).filter((r) => r && cleanPoly(r.polygon).length >= 3);
  const all = [...outline];
  for (const r of rooms) all.push(...cleanPoly(r.polygon));
  const bounds = boundsOf(all);
  const view = makeView(bounds, w, h, { pad });
  const px = (p) => view.toPx(p);
  const up = Number.isFinite(model.up) ? model.up : null;

  const laidRooms = rooms.map((r) => {
    const poly = cleanPoly(r.polygon);
    const b = boundsOf(poly);
    return {
      id: r.id,
      type: r.type,
      poly: poly.map(px),
      center: px([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]),
      widthPx: (b.maxX - b.minX) * view.scale,
      label: roomLabel(plan, r.id),
    };
  });

  const openings = [];
  for (const o of Array.isArray(plan.openings) ? plan.openings : []) {
    if (!o) continue;
    try {
      const c = openingCenter(plan, o.id);
      openings.push({ id: o.id, kind: o.kind, main: o.id === plan.mainDoor, at: px(c.point), wall: o.wall });
    } catch { /* 壞資料的開口就不畫 */ }
  }

  const taijiPx = isPt(model.taiji) ? px(model.taiji) : null;
  const markers = (model.markers || []).filter((m) => m && isPt(m.point)).map((m) => ({ id: m.id, sector: m.sector || null, at: px(m.point) }));

  let sectors = [];
  let north = null;
  if (up !== null) {
    const [nx, ny] = vectorOfBearing(0, up);
    north = { dx: nx, dy: -ny }; // 畫布 y 向下
    if (taijiPx) {
      const rect = { x0: 14, y0: 14, x1: w - 14, y1: h - 14 };
      sectors = GUA.map((gua, k) => {
        const [vx, vy] = vectorOfBearing(guaCenterBearing(k), up);
        const end = rayToRect(taijiPx, [vx, -vy], rect);
        // 名稱放在射線終點往內縮一點,避免貼邊被裁掉
        const dx = end[0] - taijiPx[0];
        const dy = end[1] - taijiPx[1];
        const len = Math.hypot(dx, dy) || 1;
        const inset = Math.min(11, len / 2);
        return { gua, k, end, label: [end[0] - (dx / len) * inset, end[1] - (dy / len) * inset] };
      });
      // 名稱不要被候選標記蓋住:沿邊緣左右挪開(邊緣方向 = 射線的垂直方向)
      for (const s of sectors) {
        const clash = (p) => markers.some((m) => Math.hypot(m.at[0] - p[0], m.at[1] - p[1]) < 19);
        if (!clash(s.label)) continue;
        const dx = s.end[0] - taijiPx[0];
        const dy = s.end[1] - taijiPx[1];
        const len = Math.hypot(dx, dy) || 1;
        const tx = -dy / len;
        const ty = dx / len;
        for (const off of [18, -18, 34, -34]) {
          const q = [s.label[0] + tx * off, s.label[1] + ty * off];
          if (q[0] < 8 || q[0] > w - 8 || q[1] < 8 || q[1] > h - 8) continue;
          if (!clash(q)) { s.label = q; break; }
        }
      }
    }
    // 指北針放在不壓到八方位名稱與財位標記的角落(先試右上、左上、右下、左下;都太擠就取最空的)
    const corners = [[w - 22, 22], [22, 22], [w - 22, h - 22], [22, h - 22]];
    const obstacles = [...sectors.map((s) => s.label), ...markers.map((m) => m.at)];
    const clearance = (c) => Math.min(Infinity, ...obstacles.map((o) => Math.hypot(o[0] - c[0], o[1] - c[1])));
    let best = corners.find((c) => clearance(c) >= 34);
    if (!best) {
      best = corners[0];
      for (const c of corners) if (clearance(c) > clearance(best) + 1) best = c;
    }
    north.at = best;
    // 指北針的「北」字會伸到圈外,離它太近的方位名稱沿射線往盤心挪一點
    for (const s of sectors) {
      const d = Math.hypot(s.label[0] - best[0], s.label[1] - best[1]);
      if (d >= 46 || !taijiPx) continue;
      const dx = taijiPx[0] - s.label[0];
      const dy = taijiPx[1] - s.label[1];
      const len = Math.hypot(dx, dy) || 1;
      const move = Math.min(22, 46 - d, len / 2);
      const q = [s.label[0] + (dx / len) * move, s.label[1] + (dy / len) * move];
      if (!markers.some((m) => Math.hypot(m.at[0] - q[0], m.at[1] - q[1]) < 19)) s.label = q;
    }
  }
  return { w, h, view, bounds, rooms: laidRooms, openings, taiji: taijiPx, markers, sectors, north, up };
}

/** 點擊位置最近的標記(半徑內),沒有回 null */
export function pickMarker(markers, x, y, radius = 24) {
  let best = null;
  let bd = radius;
  for (const m of markers) {
    const d = Math.hypot(m.at[0] - x, m.at[1] - y);
    if (d <= bd) { best = m; bd = d; }
  }
  return best;
}

/** 縮圖的文字說明(給螢幕閱讀器與 aria-label) */
export function miniPlanAlt(model, selectedLabel) {
  const n = (model.markers || []).length;
  return `平面縮圖,共標出 ${n} 個財位候選位置${selectedLabel ? `,目前看的是${selectedLabel}` : ''}。詳細位置見下方文字說明。`;
}

const ROOM_FILL = Object.freeze({ living: '--wealth-bg', bedroom: '--info-bg', kitchen: '--warn-bg', study: '--good-bg' });

// ─────────────────────────── Canvas ───────────────────────────

/**
 * 掛載縮圖。opts: { plan, taiji, up, markers:[{id, point, sector, order}], selectedId, onSelect(id), alt }
 * 回傳 { setSelected(id), update(opts), destroy() }。
 */
export function mountMiniPlan(container, opts) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.className = 'v-wealth-miniplan-canvas';
  container.append(canvas);

  let cur = { ...opts };
  let selectedId = opts.selectedId || null;
  let lay = null;
  let raf = 0;
  let visible = true;
  let destroyed = false;
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(mq && mq.matches);

  const size = () => {
    const w = Math.max(220, Math.floor(container.clientWidth || 320));
    const all = [...cleanPoly((cur.plan || {}).outline)];
    const b = boundsOf(all.length ? all : [[0, 0], [1, 1]]);
    const ratio = Math.min(1.05, Math.max(0.55, (b.maxY - b.minY || 1) / (b.maxX - b.minX || 1)));
    return { w, h: Math.round(Math.min(360, Math.max(190, w * ratio + 24))) };
  };

  function draw(now = 0) {
    if (destroyed) return;
    const { w, h } = size();
    const ctx = fitCanvas(canvas, w, h);
    canvas.style.height = `${h}px`;
    lay = layoutMiniPlan(cur, w, h);
    ctx.clearRect(0, 0, w, h);
    const gold = cssVar('--gold-bright', '#e8cb7a');
    const line = cssVar('--line-strong', 'rgba(232,203,122,.34)');
    const text = cssVar('--text', '#f3ebd8');
    const dim = cssVar('--text-dim', '#b9ae95');
    const onGold = cssVar('--on-gold', '#1a1208');
    const sel = lay.markers.find((m) => m.id === selectedId) || null;

    // 選取位置所在的方位,先淡淡塗一塊,幫忙看出「在哪個方位」
    if (sel && sel.sector && lay.taiji && lay.up !== null) {
      const k = GUA.indexOf(sel.sector);
      if (k >= 0) {
        const R = Math.hypot(w, h) / lay.view.scale;
        const wedge = wedgePolygon(cur.taiji, k, lay.up, R, 6).map(lay.view.toPx);
        ctx.save();
        ctx.beginPath();
        wedge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = cssVar('--wealth-bg', 'rgba(214,178,90,.18)');
        ctx.fill();
        ctx.restore();
      }
    }
    // 八方位的分隔線(很淡)
    if (lay.taiji && lay.sectors.length) {
      ctx.save();
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      for (const s of lay.sectors) {
        const b = guaCenterBearing(s.k) + 22.5;
        const [vx, vy] = vectorOfBearing(b, lay.up);
        const end = rayToRect(lay.taiji, [vx, -vy], { x0: 6, y0: 6, x1: w - 6, y1: h - 6 });
        ctx.beginPath();
        ctx.moveTo(lay.taiji[0], lay.taiji[1]);
        ctx.lineTo(end[0], end[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 房間
    ctx.lineJoin = 'round';
    for (const r of lay.rooms) {
      ctx.beginPath();
      r.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = cssVar(ROOM_FILL[r.type] || '--surface-3', 'rgba(255,255,255,.06)');
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = line;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `12px ${UI_STACK}`;
    ctx.fillStyle = dim;
    for (const r of lay.rooms) {
      const tw = ctx.measureText(r.label).width;
      if (r.widthPx <= tw + 6) continue;
      let [lx, ly] = r.center;
      // 太極點的十字剛好在房間中央時,名稱挪到十字下方,不被劃掉
      if (lay.taiji && Math.abs(lx - lay.taiji[0]) < tw / 2 + 10 && Math.abs(ly - lay.taiji[1]) < 15) ly = lay.taiji[1] + 17;
      ctx.fillText(r.label, lx, ly);
    }
    // 門窗
    for (const o of lay.openings) {
      const horizontal = o.wall === 'top' || o.wall === 'bottom';
      const isWin = o.kind === 'window' || o.kind === 'floorWindow';
      ctx.save();
      ctx.translate(o.at[0], o.at[1]);
      if (o.main) {
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = onGold;
        ctx.font = `bold 9px ${KAI_STACK}`;
        ctx.fillText('門', 0, 0.5);
      } else {
        ctx.strokeStyle = isWin ? cssVar('--sky', '#6a9cdc') : dim;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(-5, 0); ctx.lineTo(5, 0); } else { ctx.moveTo(0, -5); ctx.lineTo(0, 5); }
        ctx.stroke();
      }
      ctx.restore();
    }
    // 太極點
    if (lay.taiji) {
      const [tx, ty] = lay.taiji;
      ctx.strokeStyle = text;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.moveTo(tx - 8, ty); ctx.lineTo(tx + 8, ty);
      ctx.moveTo(tx, ty - 8); ctx.lineTo(tx, ty + 8);
      ctx.stroke();
    }
    // 八方位名稱
    ctx.font = `13px ${KAI_STACK}`;
    for (const s of lay.sectors) {
      ctx.fillStyle = sel && sel.sector === s.gua ? gold : dim;
      ctx.globalAlpha = sel && sel.sector === s.gua ? 1 : 0.9;
      ctx.fillText(s.gua, s.label[0], s.label[1]);
    }
    ctx.globalAlpha = 1;
    // 候選標記:沒被選到的是空心圓+編號,選到的是金色「財」+脈動光圈
    for (const m of lay.markers) {
      if (m.id === selectedId) continue;
      const order = ((cur.markers || []).find((x) => x.id === m.id) || {}).order;
      ctx.beginPath();
      ctx.arc(m.at[0], m.at[1], 8, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--surface', '#17120e');
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = gold;
      ctx.stroke();
      ctx.fillStyle = gold;
      ctx.font = `bold 10px ${UI_STACK}`;
      ctx.fillText(String(order ?? ''), m.at[0], m.at[1] + 0.5);
    }
    if (sel) {
      const [x, y] = sel.at;
      if (!reduced()) {
        for (const off of [0, 0.5]) {
          const p = ((now / 1800) + off) % 1;
          ctx.beginPath();
          ctx.arc(x, y, 12 + 16 * p, 0, Math.PI * 2);
          ctx.strokeStyle = gold;
          ctx.globalAlpha = 0.55 * (1 - p);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 19, 0, Math.PI * 2);
        ctx.strokeStyle = gold;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = gold;
      ctx.fill();
      ctx.fillStyle = onGold;
      ctx.font = `bold 14px ${KAI_STACK}`;
      ctx.fillText('財', x, y + 1);
    }
    // 指北針(右上角):箭頭指向平面圖上「北」的方向
    if (lay.north) {
      const [cx, cy] = lay.north.at || [w - 22, 22];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = dim;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      const { dx, dy } = lay.north;
      ctx.strokeStyle = cssVar('--cinnabar', '#f0665a');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-dx * 5, -dy * 5);
      ctx.lineTo(dx * 11, dy * 11);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.font = `bold 10px ${KAI_STACK}`;
      ctx.fillText('北', dx * 19, dy * 19);
      ctx.restore();
    }
    canvas.setAttribute('aria-label', cur.alt || miniPlanAlt(cur));
  }

  function loop(now) {
    raf = 0;
    if (destroyed) return;
    draw(now);
    if (visible && selectedId && !reduced()) raf = win.requestAnimationFrame(loop);
  }
  function kick() {
    if (raf) return;
    // 先同步畫一張:面板被隱藏或頁面在背景時 rAF 不會跑,不能讓縮圖與文字說明缺席
    draw(win.performance ? win.performance.now() : 0);
    if (visible && selectedId && !reduced()) raf = win.requestAnimationFrame(loop);
  }

  const onClick = (e) => {
    if (!lay || !cur.onSelect) return;
    const r = canvas.getBoundingClientRect();
    const m = pickMarker(lay.markers, e.clientX - r.left, e.clientY - r.top);
    if (m) cur.onSelect(m.id);
  };
  canvas.addEventListener('click', onClick);

  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { if (!raf) draw(win.performance.now()); }) : null;
  if (ro) ro.observe(container);
  const io = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); kick(); })
    : null;
  if (io) io.observe(container);
  const themeMo = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => kick()) : null;
  if (themeMo) themeMo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const schemeMq = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => kick();
  if (schemeMq && schemeMq.addEventListener) schemeMq.addEventListener('change', onScheme);
  if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);
  const onVis = () => { visible = !doc.hidden; kick(); };
  doc.addEventListener('visibilitychange', onVis);

  kick();

  return {
    setSelected(id) { selectedId = id || null; kick(); },
    update(next) { cur = { ...cur, ...next }; if (next.selectedId !== undefined) selectedId = next.selectedId; kick(); },
    destroy() {
      destroyed = true;
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener('click', onClick);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (themeMo) themeMo.disconnect();
      if (schemeMq && schemeMq.removeEventListener) schemeMq.removeEventListener('change', onScheme);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme);
      doc.removeEventListener('visibilitychange', onVis);
      canvas.remove();
    },
  };
}

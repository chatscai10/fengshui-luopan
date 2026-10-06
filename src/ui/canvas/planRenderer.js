// 平面圖畫布繪製。把資料畫成圖,不處理任何互動、不碰 store。
// 座標一律走 plan/coords.js:圖面上方 = 平面圖 +y,只翻轉不旋轉(規格 4.3);y 翻轉的邏輯只在 makeView 一處。
// 頂層不可存取 document / window,DOM 相關動作都在函式內,node 才能 import 本檔測純函式。

import { fitCanvas, cssVar, KAI_STACK, UI_STACK } from './canvasUtil.js';
import { makeView, bearingOfVector, vectorOfBearing, wedgePolygon } from '../plan/coords.js';
import { GUA, DIR8, guaAt } from '../../core/geo.js';
import {
  planRooms, planOpenings, planFurniture, contentBounds, roomRect, openingGeom, handlePoints, HANDLES, rectOfPolygon,
} from '../plan/editor.js';
import { roomDisplayName, FURNITURE_LABEL } from '../plan/labels.js';

const TAU = Math.PI * 2;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ───────────────────────── 純函式(可在 node 測) ─────────────────────────

/** '#rrggbb' 或 rgb()/rgba() 加上透明度;認不得的原樣回傳 */
export function alphaColor(color, a) {
  const c = String(color || '').trim();
  const al = Math.max(0, Math.min(1, a));
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`;
  }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) {
    const [r, g, b] = m[1].split('').map((x) => parseInt(x + x, 16));
    return `rgba(${r},${g},${b},${al})`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map((x) => x.trim());
    return `rgba(${p[0]},${p[1]},${p[2]},${al})`;
  }
  return c;
}

/** 從 origin 朝單位向量 dir 射出,離開軸向矩形 box(x0,y0,x1,y1)的距離。origin 在框外回 0。 */
export function rayExit(origin, dir, box) {
  const [ox, oy] = origin;
  if (ox < box.x0 || ox > box.x1 || oy < box.y0 || oy > box.y1) return 0;
  let t = Infinity;
  if (dir[0] > 1e-9) t = Math.min(t, (box.x1 - ox) / dir[0]);
  else if (dir[0] < -1e-9) t = Math.min(t, (box.x0 - ox) / dir[0]);
  if (dir[1] > 1e-9) t = Math.min(t, (box.y1 - oy) / dir[1]);
  else if (dir[1] < -1e-9) t = Math.min(t, (box.y0 - oy) / dir[1]);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** 平面座標點 p 落在哪一宮(0..7,順序同 GUA);與太極點重合回 -1 */
export function sectorIndexAt(taiji, p, up) {
  const dx = p[0] - taiji[0];
  const dy = p[1] - taiji[1];
  if (Math.hypot(dx, dy) < 1e-9 || !isNum(up)) return -1;
  return guaAt(bearingOfVector(dx, dy, up)).index;
}

/** 畫面要涵蓋的平面範圍。太極點與額外點(例如財位標記)也算進去,拖出外框時不會消失。 */
export function boundsFor(plan, { taiji = null, extra = [] } = {}) {
  const b = contentBounds(plan);
  for (const p of [taiji, ...extra]) {
    if (p && isNum(p[0]) && isNum(p[1])) {
      b.minX = Math.min(b.minX, p[0]);
      b.maxX = Math.max(b.maxX, p[0]);
      b.minY = Math.min(b.minY, p[1]);
      b.maxY = Math.max(b.maxY, p[1]);
    }
  }
  return b;
}

/**
 * 這個平面圖在 cssW×cssH 畫布上的視圖。有扇形標籤時四周要多留邊。
 * 傳入 bounds 就固定用它(拖曳期間鎖住範圍,畫面才不會跟著跳)。
 */
export function viewFor(plan, cssW, cssH, { zoom = 1, pan = { x: 0, y: 0 }, taiji = null, extra = [], labels = false, bounds = null } = {}) {
  const b = bounds || boundsFor(plan, { taiji, extra });
  return makeView(b, cssW, cssH, { pad: labels ? 40 : 30, zoom, pan });
}

// ───────────────────────── 色票 ─────────────────────────

const ROOM_VAR = {
  living: '--plan-living', bedroom: '--plan-bedroom', kitchen: '--plan-kitchen', toilet: '--plan-toilet', study: '--plan-study',
  entry: '--plan-entry', balcony: '--plan-balcony', stair: '--plan-stair', other: '--plan-other',
};

/** 讀 CSS 變數成色票。主題切換後要重讀(由畫面在切換時呼叫)。 */
export function readPalette() {
  const v = (n, f) => cssVar(n, f);
  const room = {};
  for (const [k, name] of Object.entries(ROOM_VAR)) room[k] = v(name, '#b9ae95');
  return {
    bg: v('--bg', '#0e0b09'),
    surface: v('--surface', '#17120e'),
    surface2: v('--surface-2', '#221a13'),
    line: v('--line', 'rgba(232,203,122,.16)'),
    lineStrong: v('--line-strong', 'rgba(232,203,122,.34)'),
    text: v('--text', '#f3ebd8'),
    dim: v('--text-dim', '#b9ae95'),
    faint: v('--text-faint', '#8d8471'),
    gold: v('--gold', '#d6b25a'),
    goldBright: v('--gold-bright', '#e8cb7a'),
    onGold: v('--on-gold', '#1a1208'),
    jade: v('--jade', '#5fa37f'),
    terracotta: v('--terracotta', '#c9705a'),
    sky: v('--sky', '#6a9cdc'),
    cinnabar: v('--cinnabar', '#f0665a'),
    room,
  };
}

// ───────────────────────── 繪製 ─────────────────────────

function pathPoly(ctx, view, poly) {
  let first = true;
  for (const p of poly) {
    const [x, y] = view.toPx(p);
    if (first) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    first = false;
  }
  ctx.closePath();
}

const validPoly = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));

function drawPhoto(ctx, view, ph) {
  if (!ph || !ph.img || !isNum(ph.widthM) || ph.widthM <= 0) return;
  const iw = ph.img.naturalWidth || ph.img.width;
  const ih = ph.img.naturalHeight || ph.img.height;
  if (!iw || !ih) return;
  const [cx, cy] = view.toPx([ph.cx, ph.cy]);
  const s = (ph.widthM * view.scale) / iw;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, isNum(ph.opacity) ? ph.opacity : 0.5));
  ctx.translate(cx, cy);
  ctx.rotate(((ph.rot || 0) * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.drawImage(ph.img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

function drawGrid(ctx, view, W, H, pal) {
  const s = view.scale;
  if (s < 5) return;
  const [x0, y1] = view.fromPx(0, 0);
  const [x1, y0] = view.fromPx(W, H);
  const step = s >= 14 ? 1 : 5;
  const gx0 = Math.floor(x0 / step) * step;
  const gy0 = Math.floor(y0 / step) * step;
  if ((x1 - gx0) / step > 220 || (y1 - gy0) / step > 220) return;
  ctx.save();
  ctx.lineWidth = 1;
  for (let x = gx0; x <= x1; x += step) {
    const px = Math.round(view.toPx([x, 0])[0]) + 0.5;
    ctx.strokeStyle = alphaColor(pal.dim, Math.abs(x % 5) < 1e-9 ? 0.2 : 0.1);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  for (let y = gy0; y <= y1; y += step) {
    const py = Math.round(view.toPx([0, y])[1]) + 0.5;
    ctx.strokeStyle = alphaColor(pal.dim, Math.abs(y % 5) < 1e-9 ? 0.2 : 0.1);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }
  ctx.restore();
}

function fitText(ctx, text, maxW, size, minSize = 9) {
  let s = size;
  ctx.font = `${s}px ${UI_STACK}`;
  while (s > minSize && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${s}px ${UI_STACK}`;
  }
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? t : `${t}…`;
}

function drawRooms(ctx, view, st, pal) {
  const plan = st.plan;
  const rooms = planRooms(plan);
  // 底色
  for (const r of rooms) {
    if (!validPoly(r.polygon)) continue;
    ctx.beginPath();
    pathPoly(ctx, view, r.polygon);
    ctx.fillStyle = alphaColor(pal.room[r.type] || pal.room.other, 0.3);
    ctx.fill();
  }
  // 牆
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = alphaColor(pal.text, 0.72);
  for (const r of rooms) {
    if (!validPoly(r.polygon)) continue;
    ctx.beginPath();
    pathPoly(ctx, view, r.polygon);
    ctx.stroke();
  }
  ctx.restore();
  // 額外的牆(玻璃虛線、未頂天櫃體點線)
  const walls = plan && Array.isArray(plan.walls) ? plan.walls : [];
  for (const w of walls) {
    if (!w || !Array.isArray(w.segment) || w.segment.length !== 2 || w.kind === 'solid') continue;
    ctx.save();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = pal.sky;
    ctx.setLineDash(w.kind === 'glass' ? [7, 4] : [2, 4]);
    const [a, b] = w.segment.map((p) => view.toPx(p));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.restore();
  }
}

function drawOpening(ctx, view, o, g, pal, selected, boxes, icons) {
  const [ax, ay] = view.toPx(g.a);
  const [bx, by] = view.toPx(g.b);
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 2) return;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // 朝室內的法向(平面 y 向上 → 畫布 y 翻轉)
  const nx = g.normal[0];
  const ny = -g.normal[1];
  const isEntrance = o.kind === 'entrance';
  ctx.save();
  ctx.lineCap = 'butt';
  if (selected) {
    ctx.strokeStyle = alphaColor(pal.goldBright, 0.4);
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // 挖掉牆線
  ctx.strokeStyle = pal.surface;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

  if (o.kind === 'window') {
    ctx.strokeStyle = pal.sky;
    ctx.lineWidth = 1.6;
    for (const k of [-1.8, 1.8]) {
      ctx.beginPath(); ctx.moveTo(ax + nx * k, ay + ny * k); ctx.lineTo(bx + nx * k, by + ny * k); ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  } else if (o.kind === 'floorWindow') {
    ctx.strokeStyle = pal.sky;
    ctx.lineWidth = 3.2;
    ctx.setLineDash([7, 3]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.6;
    for (const [px, py] of [[ax, ay], [bx, by]]) {
      ctx.beginPath(); ctx.moveTo(px - nx * 4, py - ny * 4); ctx.lineTo(px + nx * 4, py + ny * 4); ctx.stroke();
    }
  } else if (o.kind === 'balconyDoor') {
    ctx.strokeStyle = pal.sky;
    ctx.lineWidth = 1.8;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    for (const [k, s0, s1] of [[-2, 0, 0.58], [2, 0.42, 1]]) {
      ctx.beginPath();
      ctx.moveTo(ax + (bx - ax) * s0 + nx * k, ay + (by - ay) * s0 + ny * k);
      ctx.lineTo(ax + (bx - ax) * s1 + nx * k, ay + (by - ay) * s1 + ny * k);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(mx, my, 1.4, 0, TAU); ctx.fillStyle = pal.sky; ctx.fill();
  } else {
    // 門:門扇 + 開啟弧(鉸鏈在左/下端,朝室內開)
    const col = isEntrance ? pal.goldBright : pal.dim;
    ctx.strokeStyle = col;
    ctx.lineWidth = isEntrance ? 2.6 : 1.4;
    const leafX = ax + nx * len;
    const leafY = ay + ny * len;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(leafX, leafY); ctx.stroke();
    ctx.lineWidth = isEntrance ? 1.4 : 1;
    ctx.setLineDash([3, 3]);
    const a0 = Math.atan2(ny, nx);
    const a1 = Math.atan2(uy, ux);
    // 兩個向量夾 90 度,取短的那一側畫弧
    let d = a1 - a0;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    ctx.beginPath(); ctx.arc(ax, ay, len, a0, a0 + d, d < 0); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (isEntrance) {
    // 大門特別標示:金色「門」圓標,放在牆外側。最後才畫,才不會被方位標籤蓋住。
    const cx = (ax + bx) / 2 - nx * 15;
    const cy = (ay + by) / 2 - ny * 15;
    if (icons) icons.push({ cx, cy });
    if (boxes) boxes.push({ x0: cx - 13, y0: cy - 13, x1: cx + 13, y1: cy + 13 });
  }
}

function drawEntranceIcons(ctx, pal, icons) {
  for (const { cx, cy } of icons) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 10.5, 0, TAU);
    ctx.fillStyle = pal.gold; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = pal.goldBright; ctx.stroke();
    ctx.fillStyle = pal.onGold;
    ctx.font = `600 13px ${KAI_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('門', cx, cy + 0.5);
    ctx.restore();
  }
}

function drawOpenings(ctx, view, st, pal, boxes, icons) {
  const sel = st.selection && st.selection.type === 'opening' ? st.selection.id : null;
  for (const o of planOpenings(st.plan)) {
    const g = openingGeom(st.plan, o);
    if (g) drawOpening(ctx, view, o, g, pal, o.id === sel, boxes, icons);
  }
}

function drawRoomLabels(ctx, view, st, pal, boxes) {
  const plan = st.plan;
  for (const r of planRooms(plan)) {
    const rc = roomRect(r);
    if (!rc) continue;
    const [px0, py0] = view.toPx([rc.x0, rc.y1]);
    const [px1, py1] = view.toPx([rc.x1, rc.y0]);
    const w = px1 - px0;
    const h = py1 - py0;
    if (w < 22 || h < 16) continue;
    const name = (st.roomNames && st.roomNames.get(r.id)) || roomDisplayName(plan, r);
    const cx = (px0 + px1) / 2;
    let cy = (py0 + py1) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.text;
    const label = fitText(ctx, name, w - 8, 13);
    const area = (rc.x1 - rc.x0) * (rc.y1 - rc.y0);
    const showArea = h >= 40 && w >= 46;
    // 太極點的十字剛好落在房間中央時,房間名稱會被十字劃掉:把名稱挪到十字的下方(放不下就上方)
    if (st.taiji) {
      const [tx, ty] = view.toPx(st.taiji);
      const half = showArea ? 16 : 9;
      const tw2 = ctx.measureText(label).width / 2 + 2;
      const overlaps = (yy, gap) => Math.abs(cx - tx) < tw2 + gap && Math.abs(yy - ty) < half + gap;
      if (overlaps(cy, 17)) {
        // 先試離十字尖端一小段的位置,房間太小放不下就退到圓圈邊緣
        for (const gap of [17, 11, 9]) {
          const below = ty + gap + half + 1;
          const above = ty - gap - half - 1;
          if (below + half <= py1 - 1) { cy = below; break; }
          if (above - half >= py0 + 1) { cy = above; break; }
        }
      }
    }
    ctx.fillText(label, cx, showArea ? cy - 7 : cy);
    if (boxes) {
      const tw = ctx.measureText(label).width;
      boxes.push({ x0: cx - tw / 2 - 2, y0: showArea ? cy - 16 : cy - 8, x1: cx + tw / 2 + 2, y1: showArea ? cy + 15 : cy + 8 });
    }
    if (showArea) {
      ctx.fillStyle = pal.dim;
      ctx.font = `11px ${UI_STACK}`;
      ctx.fillText(`${area.toFixed(1)} ㎡`, cx, cy + 8);
    }
    ctx.restore();
  }
}

function drawFurniture(ctx, view, st, pal) {
  const sel = st.selection && st.selection.type === 'furniture' ? st.selection.id : null;
  for (const f of planFurniture(st.plan)) {
    if (!isNum(f.x) || !isNum(f.y) || !isNum(f.w) || !isNum(f.d)) continue;
    const [px0, py0] = view.toPx([f.x, f.y + f.d]);
    const [px1, py1] = view.toPx([f.x + f.w, f.y]);
    const w = px1 - px0;
    const h = py1 - py0;
    if (w < 2 || h < 2) continue;
    const selected = f.id === sel;
    ctx.save();
    // 底色:半透明,壓在房間色上還看得出房間類型
    ctx.fillStyle = alphaColor(pal.gold, selected ? 0.34 : 0.16);
    ctx.strokeStyle = selected ? pal.goldBright : alphaColor(pal.goldBright, 0.7);
    ctx.lineWidth = selected ? 1.8 : 1.2;
    ctx.beginPath();
    const r = Math.min(4, w / 4, h / 4);
    ctx.moveTo(px0 + r, py0);
    ctx.lineTo(px1 - r, py0);
    ctx.quadraticCurveTo(px1, py0, px1, py0 + r);
    ctx.lineTo(px1, py1 - r);
    ctx.quadraticCurveTo(px1, py1, px1 - r, py1);
    ctx.lineTo(px0 + r, py1);
    ctx.quadraticCurveTo(px0, py1, px0, py1 - r);
    ctx.lineTo(px0, py0 + r);
    ctx.quadraticCurveTo(px0, py0, px0 + r, py0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 朝向:羅盤方位角 → 畫面方向(圖面上方 = planUpBearing,畫布 y 翻轉)
    if (isNum(f.facing) && w > 14 && h > 14) {
      const cx = (px0 + px1) / 2;
      const cy = (py0 + py1) / 2;
      const rel = isNum(st.up) ? (f.facing - st.up) : f.facing; // 相對圖面上方的角度
      const rad = (rel * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const len = Math.min(w, h) * 0.34;
      ctx.strokeStyle = pal.goldBright;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - dx * len * 0.5, cy - dy * len * 0.5);
      ctx.lineTo(cx + dx * len * 0.5, cy + dy * len * 0.5);
      ctx.stroke();
      // 箭頭
      const hx = cx + dx * len * 0.5;
      const hy = cy + dy * len * 0.5;
      const px = -dy;
      const py = dx;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - dx * 5 + px * 3, hy - dy * 5 + py * 3);
      ctx.lineTo(hx - dx * 5 - px * 3, hy - dy * 5 - py * 3);
      ctx.closePath();
      ctx.fillStyle = pal.goldBright;
      ctx.fill();
    }
    // 名稱(夠大才畫)
    const label = FURNITURE_LABEL[f.kind] || '家具';
    const short = label.split(/[ (（]/)[0];
    if (w > 34 && h > 18) {
      ctx.fillStyle = pal.text;
      ctx.font = `11px ${UI_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, short, w - 6, 11, 8), (px0 + px1) / 2, (py0 + py1) / 2);
    }
    ctx.restore();
  }
}

function drawSelection(ctx, view, st, pal) {
  const sel = st.selection;
  if (!sel) return;
  if (sel.type === 'furniture') {
    const f = planFurniture(st.plan).find((x) => x.id === sel.id);
    if (!f) return;
    const [px0, py0] = view.toPx([f.x, f.y + f.d]);
    const [px1, py1] = view.toPx([f.x + f.w, f.y]);
    ctx.save();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = st.invalid ? pal.cinnabar : pal.goldBright;
    ctx.strokeRect(px0 - 1.5, py0 - 1.5, px1 - px0 + 3, py1 - py0 + 3);
    if (st.invalid) {
      ctx.fillStyle = alphaColor(pal.cinnabar, 0.2);
      ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    }
    ctx.restore();
    return;
  }
  if (sel.type !== 'room') return;
  const room = planRooms(st.plan).find((r) => r.id === sel.id);
  if (!room || !validPoly(room.polygon)) return;
  ctx.save();
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = st.invalid ? pal.cinnabar : pal.goldBright;
  ctx.beginPath();
  pathPoly(ctx, view, room.polygon);
  ctx.stroke();
  if (st.invalid) {
    ctx.fillStyle = alphaColor(pal.cinnabar, 0.22);
    ctx.fill();
  }
  if (st.showHandles) {
    const rc = roomRect(room);
    const pts = handlePoints(rc);
    for (const name of HANDLES) {
      const [x, y] = view.toPx(pts[name]);
      ctx.beginPath();
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = pal.goldBright;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = pal.onGold;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function toneFill(tone, pal) {
  // 淡一點:方位色塊疊在房間底色上,太濃會把房間類型的顏色蓋成一片泥色
  if (tone === 'good') return alphaColor(pal.jade, 0.19);
  if (tone === 'warn') return alphaColor(pal.terracotta, 0.2);
  return alphaColor(pal.dim, 0.05);
}

const TONE_GLYPH = { good: '✓ ', warn: '! ', neutral: '' };

function pill(ctx, x, y, text, { font, fg, bg, border, padX = 6, h = 20 }) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + padX * 2;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + r, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) { ctx.lineWidth = 1; ctx.strokeStyle = border; ctx.stroke(); }
  ctx.fillStyle = fg;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
  return w;
}

function drawSectors(ctx, view, st, pal) {
  const sc = st.sectors;
  if (!sc || !sc.visible || !st.taiji || !isNum(st.up)) return;
  const T = st.taiji;
  const box = rectOfPolygon(st.plan.outline) || { x0: 0, y0: 0, x1: 1, y1: 1 };
  // 扇形半徑:涵蓋外框最遠的角再多一點
  const far = Math.max(...[[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map((c) => Math.hypot(c[0] - T[0], c[1] - T[1])));
  const R = far + 0.4;

  // 1. 色塊:只塗在房間裡面,房間外留白,才看得出方位是怎麼切在你家的
  if (sc.tint) {
    ctx.save();
    ctx.beginPath();
    for (const r of planRooms(st.plan)) if (validPoly(r.polygon)) pathPoly(ctx, view, r.polygon);
    ctx.clip();
    GUA.forEach((g, k) => {
      const cell = sc.cells && sc.cells[g];
      if (!cell) return;
      ctx.beginPath();
      pathPoly(ctx, view, wedgePolygon(T, k, st.up, R, 10));
      ctx.fillStyle = toneFill(cell.tone, pal);
      ctx.fill();
    });
    ctx.restore();
  }

  // 2. 分界線:從太極點放射,只畫到外框外一小段
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = alphaColor(pal.goldBright, 0.55);
  const [tx, ty] = view.toPx(T);
  for (let k = 0; k < 8; k += 1) {
    const dir = vectorOfBearing(45 * k + 22.5, st.up);
    const t = rayExit(T, dir, box) || R;
    const e = view.toPx([T[0] + dir[0] * (t + 0.35), T[1] + dir[1] * (t + 0.35)]);
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  ctx.restore();

  // 3. 選中的方位描邊
  if (isNum(sc.highlight) && sc.highlight >= 0) {
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = pal.goldBright;
    ctx.beginPath();
    // 只描兩條邊界線,弧線不描(弧在畫面外沒意義)
    const a = view.toPx(T);
    const dirA = vectorOfBearing(45 * sc.highlight - 22.5, st.up);
    const dirC = vectorOfBearing(45 * sc.highlight + 22.5, st.up);
    const tA = (rayExit(T, dirA, box) || R) + 0.35;
    const tC = (rayExit(T, dirC, box) || R) + 0.35;
    const ea = view.toPx([T[0] + dirA[0] * tA, T[1] + dirA[1] * tA]);
    const ec = view.toPx([T[0] + dirC[0] * tC, T[1] + dirC[1] * tC]);
    ctx.moveTo(ea[0], ea[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(ec[0], ec[1]);
    ctx.stroke();
    ctx.restore();
  }

}

/** 兩個矩形有沒有重疊(留 2px 呼吸) */
const hit = (a, b) => a.x0 < b.x1 + 2 && a.x1 + 2 > b.x0 && a.y0 < b.y1 + 2 && a.y1 + 2 > b.y0;

function pillSize(ctx, text, font, padX, h) {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  ctx.restore();
  return { w, h };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** 在候選位置中挑第一個不壓到其他東西的;都壓到就挑壓到最少的。回傳 {x,y,box} 並把它登記進 boxes。 */
function placeBox(cands, size, boxes, W, H) {
  let fallback = null;
  let fallbackCost = Infinity;
  for (const c of cands) {
    const x = Math.max(size.w / 2 + 3, Math.min(W - size.w / 2 - 3, c[0]));
    const y = Math.max(size.h / 2 + 3, Math.min(H - size.h / 2 - 3, c[1]));
    const box = { x0: x - size.w / 2, y0: y - size.h / 2, x1: x + size.w / 2, y1: y + size.h / 2 };
    if (!boxes.some((b) => hit(b, box))) { boxes.push(box); return { x, y, box }; }
    const cost = boxes.reduce((sum, b) => sum + overlapArea(b, box), 0);
    if (cost < fallbackCost) { fallbackCost = cost; fallback = { x, y, box }; }
  }
  boxes.push(fallback.box);
  return fallback;
}

function drawSectorLabels(ctx, view, st, pal, W, H, boxes) {
  const sc = st.sectors;
  if (!sc || !sc.visible || !st.taiji || !isNum(st.up)) return;
  const T = st.taiji;
  const box = rectOfPolygon(st.plan.outline) || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const far = Math.max(...[[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map((c) => Math.hypot(c[0] - T[0], c[1] - T[1])));
  const R = far + 0.4;
  const [tx, ty] = view.toPx(T);
  boxes.push({ x0: tx - 18, y0: ty - 18, x1: tx + 18, y1: ty + 32 });
  for (const m of st.markers || []) {
    const [mx, my] = view.toPx(m.point);
    boxes.push({ x0: mx - 16, y0: my - 16, x1: mx + 16, y1: my + 16 });
  }

  // 圖層內容(星或標籤)放在房間裡面,先放,外緣的卦名再避開它們
  const inner = [];
  GUA.forEach((g, k) => {
    const cell = sc.cells && sc.cells[g];
    if (!cell || !cell.label) return;
    const dir = vectorOfBearing(45 * k, st.up);
    const t = rayExit(T, dir, box) || R * 0.8;
    const text = `${TONE_GLYPH[cell.tone] || ''}${cell.label}`;
    const size = pillSize(ctx, text, `600 12px ${UI_STACK}`, 5, 18);
    const perp = [-dir[1], dir[0]];
    const cands = [];
    for (const sh of [0, 0.45, -0.45]) {
      for (const f of [0.62, 0.46, 0.78, 0.32, 0.9]) {
        const d = Math.max(Math.min(t * f, t - 0.3), Math.min(0.7, t * 0.5));
        cands.push(view.toPx([T[0] + dir[0] * d + perp[0] * sh, T[1] + dir[1] * d + perp[1] * sh]));
      }
    }
    inner.push({ g, cell, text, size, cands });
  });
  // 外緣的卦名
  const outer = GUA.map((g, k) => {
    const dir = vectorOfBearing(45 * k, st.up);
    const t = rayExit(T, dir, box) || R * 0.8;
    const size = pillSize(ctx, `${g}·${DIR8[k]}`, `600 13px ${KAI_STACK}`, 6, 21);
    const perp = [-dir[1], dir[0]];
    const cands = [];
    for (const out of [0.55, 0.9, 1.25]) {
      for (const sh of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) {
        cands.push(view.toPx([T[0] + dir[0] * (t + out) + perp[0] * sh, T[1] + dir[1] * (t + out) + perp[1] * sh]));
      }
    }
    return { g, k, size, cands };
  });
  // 先登記外緣卦名的位置,再放內部標籤(內部標籤不能壓到卦名)
  const outerPlaced = outer.map((o) => ({ o, at: placeBox(o.cands, o.size, boxes, W, H) }));
  const innerPlaced = inner.map((i) => ({ i, at: placeBox(i.cands, i.size, boxes, W, H) }));

  for (const { o, at } of outerPlaced) {
    const on = sc.highlight === o.k;
    pill(ctx, at.x, at.y, `${o.g}·${DIR8[o.k]}`, {
      font: `600 13px ${KAI_STACK}`,
      fg: on ? pal.onGold : pal.goldBright,
      bg: on ? pal.gold : alphaColor(pal.surface, 0.9),
      border: on ? pal.goldBright : pal.lineStrong,
      h: 21,
    });
  }
  for (const { i, at } of innerPlaced) {
    const fg = i.cell.tone === 'good' ? pal.jade : i.cell.tone === 'warn' ? pal.terracotta : pal.dim;
    pill(ctx, at.x, at.y, i.text, {
      font: `600 12px ${UI_STACK}`,
      fg: i.cell.tone === 'neutral' ? pal.text : fg,
      bg: alphaColor(pal.surface, 0.92),
      border: alphaColor(fg, 0.7),
      padX: 5,
      h: 18,
    });
  }
}

function drawMarkers(ctx, view, st, pal) {
  for (const m of st.markers || []) {
    const [x, y] = view.toPx(m.point);
    const strong = m.tier === 'suitable';
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, strong ? 13 : 11, 0, TAU);
    ctx.fillStyle = strong ? pal.gold : alphaColor(pal.gold, 0.75);
    ctx.fill();
    ctx.lineWidth = m.isMing ? 2.4 : 1.4;
    ctx.strokeStyle = pal.goldBright;
    ctx.stroke();
    if (m.isMing) {
      ctx.beginPath(); ctx.arc(x, y, (strong ? 13 : 11) + 4, 0, TAU);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = alphaColor(pal.goldBright, 0.85);
      ctx.stroke();
    }
    ctx.fillStyle = pal.onGold;
    ctx.font = `700 14px ${KAI_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('財', x, y + 0.5);
    ctx.restore();
  }
}

function drawTaiji(ctx, view, st, pal, boxes, W, H) {
  if (!st.taiji) return;
  const [x, y] = view.toPx(st.taiji);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.goldBright;
  ctx.fillStyle = alphaColor(pal.surface, 0.55);
  ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y);
  ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fillStyle = pal.goldBright; ctx.fill();
  if (st.taijiManual) {
    ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
  }
  ctx.restore();
  const size = pillSize(ctx, '太極點', `12px ${UI_STACK}`, 5, 17);
  const at = placeBox([[x, y + 26], [x, y - 26], [x + 48, y + 22], [x - 48, y + 22], [x + 48, y - 22], [x - 48, y - 22]], size, boxes || [], W, H);
  pill(ctx, at.x, at.y, '太極點', { font: `12px ${UI_STACK}`, fg: pal.goldBright, bg: alphaColor(pal.surface, 0.85), border: null, padX: 5, h: 17 });
}

/** 指北針挑一個不壓到卦名標籤的位置:先試四個角,再沿上、下緣每隔一段試;都壓到就放右上角 */
function northSpot(boxes, W, H) {
  const r = 22;
  const cands = [[W - 32, 34], [32, 34], [W - 32, H - 34], [32, H - 34]];
  for (let x = W - 96; x > 96; x -= 40) cands.push([x, 34], [x, H - 34]);
  for (let y = 96; y < H - 96; y += 40) cands.push([W - 32, y], [32, y]);
  for (const c of cands) {
    const b = { x0: c[0] - r, y0: c[1] - r, x1: c[0] + r, y1: c[1] + r };
    if (!(boxes || []).some((o) => hit(o, b))) return c;
  }
  return cands[0];
}

function drawNorth(ctx, st, pal, W, H, boxes) {
  if (!isNum(st.up)) return;
  const [cx, cy] = northSpot(boxes, W, H);
  const [vx, vy] = vectorOfBearing(0, st.up); // 北在平面圖上的方向(y 向上)
  const dx = vx;
  const dy = -vy; // 轉成畫布
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, 22, 0, TAU);
  ctx.fillStyle = alphaColor(pal.surface, 0.85);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.lineStrong;
  ctx.stroke();
  // 針:北端金色、南端灰
  const tip = [cx + dx * 10, cy + dy * 10];
  const tail = [cx - dx * 7, cy - dy * 7];
  const px = -dy;
  const py = dx;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(cx + px * 3.6, cy + py * 3.6);
  ctx.lineTo(cx - px * 3.6, cy - py * 3.6);
  ctx.closePath();
  ctx.fillStyle = pal.goldBright;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tail[0], tail[1]);
  ctx.lineTo(cx + px * 3.6, cy + py * 3.6);
  ctx.lineTo(cx - px * 3.6, cy - py * 3.6);
  ctx.closePath();
  ctx.fillStyle = alphaColor(pal.dim, 0.6);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.font = `600 12px ${KAI_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.goldBright;
  ctx.fillText('北', cx + dx * 16.5, cy + dy * 16.5 + 0.5);
  ctx.restore();
}

/**
 * 畫整張平面圖。
 * @param {HTMLCanvasElement} canvas
 * @param {object} st 見本檔開頭的欄位說明:{ cssW, cssH, plan, view, palette, selection, taiji, taijiManual, up, upHint,
 *   sectors:{visible, tint, cells, highlight}, markers, photo, roomNames, showHandles, invalid }
 * @returns {{scale:number, toPx:Function, fromPx:Function}} 使用的視圖(互動用同一份轉換)
 */
export function drawPlan(canvas, st) {
  const W = st.cssW;
  const H = st.cssH;
  const ctx = fitCanvas(canvas, W, H);
  const pal = st.palette || readPalette();
  const view = st.viewObj || viewFor(st.plan, W, H, { ...st.view, taiji: st.taiji, extra: (st.markers || []).map((m) => m.point), labels: !!(st.sectors && st.sectors.visible) });

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = pal.surface;
  ctx.fillRect(0, 0, W, H);

  drawPhoto(ctx, view, st.photo);
  drawGrid(ctx, view, W, H, pal);

  // 外框(虛線)
  const ob = st.plan && Array.isArray(st.plan.outline) ? st.plan.outline : null;
  if (validPoly(ob)) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = alphaColor(pal.goldBright, 0.4);
    ctx.beginPath();
    pathPoly(ctx, view, ob);
    ctx.stroke();
    ctx.restore();
  }

  const boxes = [];
  drawRooms(ctx, view, st, pal);
  const icons = [];
  drawOpenings(ctx, view, st, pal, boxes, icons);
  drawFurniture(ctx, view, st, pal);
  drawSectors(ctx, view, st, pal);
  drawRoomLabels(ctx, view, st, pal, boxes);
  drawSectorLabels(ctx, view, st, pal, W, H, boxes);
  drawSelection(ctx, view, st, pal);
  drawMarkers(ctx, view, st, pal);
  drawEntranceIcons(ctx, pal, icons);
  drawTaiji(ctx, view, st, pal, boxes, W, H);
  drawNorth(ctx, st, pal, W, H, boxes);
  return view;
}

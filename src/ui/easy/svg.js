// 簡單模式的小圖(docs/EASY_SPEC.md 8.7):平面圖預覽與方位示意圖,輸出 SVG 字串。
// 純字串產生器,不碰 DOM;顏色一律用 class(樣式在 css/c-easy.css),不寫死色碼。
// 平面圖座標 x 向右、y 向上(公尺),畫到 SVG 時只翻轉 y:圖面上方 = 平面圖 +y = 大門那一面。
import { DIR8, normalizeBearing } from '../../core/geo.js';
import { rectOfPolygon } from '../plan/editor.js';
import { roomLabel } from '../canvas/miniPlan.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const f = (x) => String(Math.round(x * 100) / 100);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeClass = (s) => (typeof s === 'string' && /^[a-z]+$/.test(s) ? s : 'other');

function planBounds(plan) {
  const pts = [];
  if (Array.isArray(plan.outline)) pts.push(...plan.outline.filter(isPt));
  for (const r of plan.rooms || []) if (r && Array.isArray(r.polygon)) pts.push(...r.polygon.filter(isPt));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** 開口在房間外接框某面牆上的兩端點(pos 是中心沿牆自外接框左下角起算的距離) */
function openingEnds(rect, o) {
  const a = o.pos - o.width / 2;
  const b = o.pos + o.width / 2;
  switch (o.wall) {
    case 'bottom': return [[rect.x0 + a, rect.y0], [rect.x0 + b, rect.y0]];
    case 'top': return [[rect.x0 + a, rect.y1], [rect.x0 + b, rect.y1]];
    case 'left': return [[rect.x0, rect.y0 + a], [rect.x0, rect.y0 + b]];
    case 'right': return [[rect.x1, rect.y0 + a], [rect.x1, rect.y0 + b]];
    default: return null;
  }
}

/**
 * 平面圖預覽。size 'thumb' 只畫形狀;'large' 另外畫房間名稱。上方 = 大門那一面。
 * @param {object} plan PlanV1(可帶 upMode/upOffset)
 * @param {{size?:'thumb'|'large', label?:string}} [opts] label = 範本名稱,省略時寫「平面圖」
 * @returns {string} SVG 字串;平面圖壞掉時回空字串
 */
export function planPreviewSvg(plan, { size = 'thumb', label = '平面圖' } = {}) {
  if (!isObj(plan)) return '';
  const box = planBounds(plan);
  if (!box || box.x1 - box.x0 <= 0 || box.y1 - box.y0 <= 0) return '';
  const large = size === 'large';
  const pad = Math.max(box.x1 - box.x0, box.y1 - box.y0) * (large ? 0.05 : 0.06);
  const W = box.x1 - box.x0 + pad * 2;
  const H = box.y1 - box.y0 + pad * 2;
  const X = (x) => x - box.x0 + pad;
  const Y = (y) => box.y1 - y + pad;
  const parts = [];
  const rooms = (plan.rooms || []).filter((r) => r && Array.isArray(r.polygon) && r.polygon.filter(isPt).length >= 3);
  for (const r of rooms) {
    const pts = r.polygon.filter(isPt).map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(' ');
    parts.push(`<polygon class="c-pv-room c-pv-room--${safeClass(r.type)}" points="${pts}" vector-effect="non-scaling-stroke"/>`);
  }
  // 先畫一般門窗,大門最後畫,才不會被蓋住
  const openings = (plan.openings || []).filter((o) => o && isNum(o.pos) && isNum(o.width));
  const ordered = [...openings.filter((o) => o.id !== plan.mainDoor), ...openings.filter((o) => o.id === plan.mainDoor)];
  for (const o of ordered) {
    const room = rooms.find((r) => r.id === o.roomId);
    const rect = room ? rectOfPolygon(room.polygon) : null;
    const ends = rect ? openingEnds(rect, o) : null;
    if (!ends) continue;
    const cls = o.id === plan.mainDoor ? 'c-pv-door' : 'c-pv-open';
    parts.push(`<line class="${cls}" x1="${f(X(ends[0][0]))}" y1="${f(Y(ends[0][1]))}" x2="${f(X(ends[1][0]))}" y2="${f(Y(ends[1][1]))}" vector-effect="non-scaling-stroke"/>`);
  }
  if (large) {
    for (const r of rooms) {
      const rect = rectOfPolygon(r.polygon);
      if (!rect) continue;
      const w = rect.x1 - rect.x0;
      const h = rect.y1 - rect.y0;
      const name = roomLabel(plan, r.id);
      // 字級約為整張圖的 4.5%(畫面上大約 12px),房間太小時縮到放得下
      const fs = Math.min(Math.max(W, H) * 0.045, (w * 0.9) / Math.max(2, [...name].length), h * 0.5);
      parts.push(`<text class="c-pv-label" x="${f(X((rect.x0 + rect.x1) / 2))}" y="${f(Y((rect.y0 + rect.y1) / 2))}" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central">${esc(name)}</text>`);
    }
  }
  const aria = `${label || '平面圖'} 預覽,大門在上方`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="c-pv c-pv--${large ? 'large' : 'thumb'}" viewBox="0 0 ${f(W)} ${f(H)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(aria)}">${parts.join('')}</svg>`;
}

const DD = Object.freeze({ size: 200, c: 104, half: 70, labelR: 48 });

/** 螢幕角度(自上方順時針)射線與房子正方形邊界的交點 */
function squarePoint(deg) {
  const r = (deg * Math.PI) / 180;
  const dx = Math.sin(r);
  const dy = -Math.cos(r);
  const t = DD.half / Math.max(Math.abs(dx), Math.abs(dy));
  return [DD.c + dx * t, DD.c + dy * t];
}

function wedgePoints(a0) {
  const pts = [[DD.c, DD.c], squarePoint(a0)];
  const corners = [45, 135, 225, 315]
    .map((ang) => ({ ang, rel: normalizeBearing(ang - a0) }))
    .filter((x) => x.rel > 1e-9 && x.rel < 45 - 1e-9)
    .sort((x, y) => x.rel - y.rel);
  for (const k of corners) pts.push(squarePoint(k.ang));
  pts.push(squarePoint(a0 + 45));
  return pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
}

/**
 * 方位示意圖:正方形代表房子,上方是大門;8 個扇形各標方位字(字保持正立),highlight 那塊用金色。
 * @param {{upBearing:number, highlight:string}} p upBearing = 顯示基準下的大門朝向(圖面上方的方位)
 * @returns {string} SVG 字串
 */
export function directionDiagramSvg({ upBearing, highlight } = {}) {
  const up = isNum(upBearing) ? normalizeBearing(upBearing) : 0;
  const hl = typeof highlight === 'string' ? highlight.replace(/方$/, '') : null;
  const parts = [];
  for (let k = 0; k < 8; k += 1) {
    const mid = 45 * k - up; // 這個方位在圖上的角度(自上方順時針)
    const cls = DIR8[k] === hl ? 'c-dd-sec c-dd-hl' : 'c-dd-sec';
    parts.push(`<polygon class="${cls}" points="${wedgePoints(mid - 22.5)}"/>`);
  }
  parts.push(`<rect class="c-dd-house" x="${DD.c - DD.half}" y="${DD.c - DD.half}" width="${DD.half * 2}" height="${DD.half * 2}"/>`);
  for (let k = 0; k < 8; k += 1) {
    const r = ((45 * k - up) * Math.PI) / 180;
    const x = DD.c + Math.sin(r) * DD.labelR;
    const y = DD.c - Math.cos(r) * DD.labelR;
    const cls = DIR8[k] === hl ? 'c-dd-label c-dd-label--hl' : 'c-dd-label';
    parts.push(`<text class="${cls}" x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="central">${DIR8[k]}</text>`);
  }
  parts.push(`<line class="c-dd-door" x1="${DD.c - 14}" y1="${DD.c - DD.half}" x2="${DD.c + 14}" y2="${DD.c - DD.half}"/>`);
  parts.push(`<text class="c-dd-doorlabel" x="${DD.c}" y="${DD.c - DD.half - 12}" text-anchor="middle" dominant-baseline="central">大門</text>`);
  const aria = DIR8.includes(hl) ? `方位示意圖,比較有利的是${hl}方` : '方位示意圖';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="c-dd" viewBox="0 0 208 ${DD.c + DD.half + 6}" role="img" aria-label="${aria}">${parts.join('')}</svg>`;
}

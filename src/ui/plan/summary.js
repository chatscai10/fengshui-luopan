// 平面圖底部那一行摘要:太極點在哪、哪些房間橫跨幾個方位。純函式,不碰 DOM。
// 資料來自引擎的 sectorShares 結果(palaces / shares),這裡只組句。

import { GUA, DIR8, guaAt } from '../../core/geo.js';
import { pointInPolygon } from '../../core/plan.js';
import { bearingOfVector } from './coords.js';
import { rectOfPolygon } from './editor.js';

const NUM_ZH = ['零', '一', '兩', '三', '四', '五', '六', '七', '八'];
// 房間在某個方位的面積低於自己總面積的這個比例,視為只是擦到邊,不寫進「橫跨」
const MIN_SHARE = 0.1;
const NO_SPAN_TYPES = new Set(['entry', 'stair', 'balcony']);

const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * 太極點的位置描述。
 * @returns {{text:string, outside:boolean, atCenter:boolean}}
 */
export function describeTaiji(plan, taiji, planUp) {
  if (!plan || !isPt(taiji) || !Array.isArray(plan.outline)) return { text: '', outside: false, atCenter: false };
  let where = 'inside';
  try {
    where = pointInPolygon(plan.outline, taiji);
  } catch {
    where = 'inside';
  }
  if (where === 'outside') return { text: '太極點在外框之外', outside: true, atCenter: false };
  const box = rectOfPolygon(plan.outline);
  if (!box) return { text: '', outside: false, atCenter: false };
  const w = box.x1 - box.x0;
  const d = box.y1 - box.y0;
  const dx = taiji[0] - (box.x0 + box.x1) / 2;
  const dy = taiji[1] - (box.y0 + box.y1) / 2;
  const dist = Math.hypot(dx, dy);
  if (dist <= Math.max(0.3, 0.06 * Math.max(w, d))) return { text: '太極點在中央', outside: false, atCenter: true };
  if (Number.isFinite(planUp)) {
    const dir = guaAt(bearingOfVector(dx, dy, planUp)).dir8;
    return { text: `太極點偏${dir}側`, outside: false, atCenter: false };
  }
  const h = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? '右' : '左') : (dy > 0 ? '上' : '下');
  return { text: `太極點偏${h}側`, outside: false, atCenter: false };
}

/**
 * 跨方位的房間句子,例如「客廳橫跨 離(南)、坤(西南) 兩個方位」。
 * @param {Object<string, {roomId:string, area:number, pct:number}[]>} palaces sectorShares 的 palaces
 * @param {Array<{id:string, type:string}>} rooms
 * @param {Map<string,string>} roomNames id → 顯示名稱
 */
export function describeSpans(palaces, rooms, roomNames) {
  if (!palaces) return '';
  const rows = [];
  for (const r of rooms || []) {
    if (NO_SPAN_TYPES.has(r.type)) continue;
    const parts = GUA.map((g, k) => {
      const e = (palaces[g] || []).find((x) => x.roomId === r.id);
      return e ? { gua: g, dir: DIR8[k], area: e.area } : null;
    }).filter(Boolean);
    const total = parts.reduce((s, p) => s + p.area, 0);
    if (total <= 0) continue;
    const major = parts.filter((p) => p.area / total >= MIN_SHARE).sort((a, b) => b.area - a.area);
    if (major.length >= 2) rows.push({ name: roomNames.get(r.id) || '房間', total, major });
  }
  if (!rows.length) return '';
  rows.sort((a, b) => b.total - a.total);
  // 手機上底部只有一條,只講面積最大的那一間
  const r = rows[0];
  const shown = r.major.slice(0, 4).map((p) => `${p.gua}(${p.dir})`).join('、');
  const count = r.major.length;
  const tail = count > 4 ? `等 ${count} 個方位` : `${NUM_ZH[count] || count}個方位`;
  return `${r.name}橫跨 ${shown} ${tail}`;
}

/**
 * 組出底部摘要。
 * @returns {{text:string, warn:boolean, outside:boolean}}
 */
export function summarizePlan({ plan, taiji, planUp, palaces, roomNames }) {
  const t = describeTaiji(plan, taiji, planUp);
  const spans = describeSpans(palaces, plan && plan.rooms, roomNames || new Map());
  const parts = [t.text];
  if (spans) parts.push(spans);
  else if (palaces && t.text) parts.push('各房間都落在單一方位');
  return { text: parts.filter(Boolean).join(' · '), warn: t.outside, outside: t.outside };
}

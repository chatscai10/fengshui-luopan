// 方向圈(docs/EASY_SPEC.md 8.8):只有 8 個中文方位的簡化指北圈,整圈跟著手機轉,上方固定三角指標 = 手機頂端。
// 目前方位那一格 45 度扇形淡金色、跟著圈轉,指標越靠近扇形邊緣代表越接近分界。
// dialGeometry 是純函式(給測試);mountDirDial 才碰 DOM。
import { DIR8, normalizeBearing } from '../../core/geo.js';
import { dialAngleToward } from '../../core/luopan.js';
import { EASY_TEXT, fillText } from '../easy/text.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 8 個方位字與它們在圈上的角度(順序同 geo.DIR8);四正方位字較大 */
export const DIAL_LABELS = Object.freeze(DIR8.map((text, k) => Object.freeze(k % 2 === 0 ? { text, deg: k * 45, major: true } : { text, deg: k * 45 })));

/** 圈的半徑與方位字位置(北在上、圈未旋轉時) */
export function dialGeometry(size) {
  const s = isNum(size) && size > 0 ? size : 240;
  const c = s / 2;
  const r = c - s * 0.14; // 上方留位置給指標與「手機頂端」小字
  const lr = r * 0.74;
  return {
    r,
    labels: DIAL_LABELS.map((l) => {
      const a = (l.deg * Math.PI) / 180;
      return { text: l.text, x: c + Math.sin(a) * lr, y: c - Math.cos(a) * lr };
    }),
  };
}

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 以圓心為頂點、指定角度(北=0,順時針)為中心的 45 度扇形路徑 */
function sectorPath(c, r, midDeg) {
  const p = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + Math.sin(a) * r).toFixed(2)} ${(c - Math.cos(a) * r).toFixed(2)}`;
  };
  return `M ${c} ${c} L ${p(midDeg - 22.5)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${p(midDeg + 22.5)} Z`;
}

/**
 * 掛上方向圈。
 * @param {HTMLElement} container
 * @param {{size?:number, pointerLabel?:string, ariaLabel?:string|null}} [opts]
 *   ariaLabel 省略時依目前方位自動產生(EASY_TEXT 'b.dialAria')
 * @returns {{set:(headingDeg:number|null)=>void, destroy:()=>void}}
 */
export function mountDirDial(container, { size = 240, pointerLabel = EASY_TEXT['b.pointer'], ariaLabel = null } = {}) {
  const s = isNum(size) && size > 0 ? size : 240;
  const c = s / 2;
  const geo = dialGeometry(s);
  const reduced = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  const svg = el('svg', { viewBox: `0 0 ${s} ${s}`, class: `c-dial c-dial-idle${reduced ? '' : ' c-dial--anim'}`, role: 'img' });
  const rot = el('g', { class: 'c-dial-rot' });
  const sector = el('path', { class: 'c-dial-sector', d: sectorPath(c, geo.r, 0) });
  rot.append(el('circle', { class: 'c-dial-face', cx: c, cy: c, r: geo.r }), sector);
  for (let k = 0; k < 8; k += 1) {
    const a = (k * 45 * Math.PI) / 180;
    const r0 = geo.r * (k % 2 === 0 ? 0.88 : 0.92);
    rot.append(el('line', {
      class: 'c-dial-tick',
      x1: (c + Math.sin(a) * r0).toFixed(2), y1: (c - Math.cos(a) * r0).toFixed(2),
      x2: (c + Math.sin(a) * geo.r).toFixed(2), y2: (c - Math.cos(a) * geo.r).toFixed(2),
    }));
  }
  rot.append(el('circle', { class: 'c-dial-ring', cx: c, cy: c, r: geo.r }));
  const labels = geo.labels.map((l, k) => {
    const t = el('text', {
      class: `c-dial-label${DIAL_LABELS[k].major ? ' c-dial-label--major' : ''}${k === 0 ? ' c-dial-north' : ''}`,
      x: l.x.toFixed(2), y: l.y.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': (s * (DIAL_LABELS[k].major ? 0.095 : 0.07)).toFixed(1),
    });
    t.textContent = l.text;
    rot.append(t);
    return t;
  });
  const tri = s * 0.045;
  const pointer = el('path', {
    class: 'c-dial-pointer',
    d: `M ${c - tri} ${(c - geo.r - tri * 1.6).toFixed(2)} L ${c + tri} ${(c - geo.r - tri * 1.6).toFixed(2)} L ${c} ${(c - geo.r + tri * 0.4).toFixed(2)} Z`,
  });
  const plabel = el('text', { class: 'c-dial-pointer-label', x: c, y: (s * 0.035).toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (s * 0.05).toFixed(1) });
  plabel.textContent = pointerLabel;
  svg.append(rot, pointer, plabel);
  container.append(svg);

  let angle = 0; // 圈目前的旋轉角(度,未取模,走最短路徑)
  let lastIndex = -1;
  const setAria = (text) => { if (svg.getAttribute('aria-label') !== text) svg.setAttribute('aria-label', text); };
  setAria(ariaLabel || EASY_TEXT['b.reading']);

  return {
    set(headingDeg) {
      if (!isNum(headingDeg)) {
        svg.classList.add('c-dial-idle');
        if (!ariaLabel) setAria(EASY_TEXT['b.reading']);
        return;
      }
      svg.classList.remove('c-dial-idle');
      const hd = normalizeBearing(headingDeg);
      angle = dialAngleToward(angle, hd);
      rot.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      for (const t of labels) t.style.transform = `rotate(${(-angle).toFixed(2)}deg)`;
      const index = Math.floor(((hd + 22.5) % 360) / 45) % 8;
      if (index !== lastIndex) {
        lastIndex = index;
        sector.setAttribute('d', sectorPath(c, geo.r, index * 45));
        if (!ariaLabel) setAria(fillText('b.dialAria', { dir: DIR8[index] }));
      }
    },
    destroy() {
      svg.remove();
    },
  };
}

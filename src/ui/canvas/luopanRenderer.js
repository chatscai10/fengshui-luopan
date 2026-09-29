// 羅盤盤面繪製。盤面(會旋轉)只畫一次;不旋轉的疊層(盤緣金屬、高光、天心十道、向/坐標記)另畫一張;
// 磁針與海底線是向量圖,跟著盤面一起用 CSS 旋轉,所以旋轉時完全不需要重畫。
// 幾何、環資料、配色都來自 src/core/luopan.js;這裡只負責「排成繪圖指令」與「執行指令」。
// 頂層不碰 document/window:排版(buildDialPlan)是純函式,node 可測。
import {
  ringById, layoutRings, PALETTE, mountainCellStyle, wuxingColor, xiuLabelPlan, stackGlyphRadii,
  baguaDrawSpec, yinyangOf, DRAGON_BAND_TOKEN, scaleTickKind,
} from '../../core/luopan.js';
import { fitCanvas, KAI_STACK, cssVar } from './canvasUtil.js';

const D2R = Math.PI / 180;
const P = PALETTE;

/** 規格 2.8.6 的像素數字以 R=180 為基準,實際盤面按比例縮放。 */
const BASE_R = 180;
/** 字級下限,再小在手機上就看不見了。 */
const MIN_PX = 7;

/** 舞台幾何: 正方形畫布 size,盤緣(金屬圈)外半徑 Rb,環面外半徑 R。上下各留 pad 放向/坐標記。 */
export function stageGeometry(cssSize) {
  const S = Math.max(160, Math.floor(Number(cssSize) || 0));
  const pad = 15;
  const Rb = S / 2 - pad;
  const bw = Math.max(6, Rb * 0.055);
  const R = Rb - bw;
  return { S, cx: S / 2, cy: S / 2, pad, Rb, bw, R, k: R / BASE_R };
}

const wrap360 = (x) => ((x % 360) + 360) % 360;
/** 兩個方位角的最短夾角(度,非負)。 */
const angDist = (a, b) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);

/**
 * 把模式 A 全部環排成繪圖指令(由內而外、由下而上的疊放順序)。
 * 每個指令的方位角是「盤面自己的方位角」(子=0,順時針),半徑為相對盤心的 css px。
 * @param {{R:number, yinyangScheme?:'sanyuan'|'sanhe', traditionalBagua?:boolean}} p
 */
export function buildDialPlan({ R, yinyangScheme = 'sanyuan', traditionalBagua = false }) {
  const k = R / BASE_R;
  const px = (v) => Math.max(MIN_PX, v * k);
  const layout = layoutRings('A', { R });
  const row = (key) => layout.rows.find((r) => r.key === key);
  const rr = (key) => [row(key).r0 * R, row(key).r1 * R];
  const ops = [];
  const line = (w) => Math.max(0.6, w * k);

  const divider = (r, color, width, alpha = 1) => ops.push({ t: 'arc', r, color, width, alpha });
  const spoke = (b, r0, r1, color, width, alpha = 1) => ops.push({ t: 'spoke', b, r0, r1, color, width, alpha });

  // ── 天池(最內) ──
  const [, tcR] = rr('tianchi');
  ops.push({ t: 'tianchi', r: tcR });

  // ── r1 八卦: 卦爻用三條線畫,不用 ☰ 字元;卦名在外側 ──
  {
    const [r0, r1] = rr('r1');
    const cells = ringById('bagua').cells;
    const lw = 2.2 * k;
    const gap = 2.4 * k;
    const first = r0 + 3.5 * k + lw / 2;
    const nameR = r0 + 3.5 * k + 3 * lw + 2 * gap + 3 * k + 6.4 * k;
    for (const c of cells) {
      const spec = baguaDrawSpec(c.gua, { traditional: traditionalBagua });
      spec.lines.forEach((yang, i) => {
        ops.push({ t: 'yao', b: c.centerDeg, r: first + i * (lw + gap), len: 18 * k, thick: lw, yang: yang === 1, color: P.gold_300 });
      });
      ops.push({ t: 'glyph', kind: 'bagua', text: spec.name, b: c.centerDeg, r: Math.min(nameR, r1 - 6.4 * k), px: px(15), bold: true, color: P.gold_300 });
      spoke(c.startDeg, r0, r1, P.gold_700, line(0.8), 0.75);
    }
    divider(r1, P.gold_500, line(1.1));
  }

  // ── r2 洛書數 + 五行小圓點(五行色只用在小面積) ──
  {
    const [r0, r1] = rr('r2');
    const mid = (r0 + r1) / 2;
    const cells = ringById('luoshu').cells;
    for (const c of cells) {
      ops.push({ t: 'wedge', r0, r1, b0: c.startDeg, w: c.widthDeg, fill: c.index % 2 === 0 ? P.lacquer_700 : P.lacquer_600 });
      const col = wuxingColor(c.wuxing);
      ops.push({ t: 'glyph', kind: 'luoshu', text: String(c.luoshu), b: c.centerDeg, r: mid, px: px(13), bold: true, color: col });
      for (const s of [-1, 1]) ops.push({ t: 'dot', b: c.centerDeg + s * 14, r: mid, rad: Math.max(1.3, 1.9 * k), color: col });
      spoke(c.startDeg, r0, r1, P.gold_700, line(0.7), 0.6);
    }
    divider(r1, P.gold_500, line(1.2));
  }

  // ── r3 二十四山: 陽=金底朱紅字、陰=漆黑底亮金字 ──
  {
    const [r0, r1] = rr('r3');
    const mid = (r0 + r1) / 2;
    for (const c of ringById('mountains24').cells) {
      const st = mountainCellStyle(yinyangOf(c.name, yinyangScheme));
      ops.push({ t: 'wedge', r0, r1, b0: c.startDeg, w: c.widthDeg, fill: st.bg });
      ops.push({ t: 'glyph', kind: 'mountain', text: c.name, b: c.centerDeg, r: mid, px: px(21), bold: true, color: st.fg });
      spoke(c.startDeg, r0, r1, P.gold_900, line(0.9), 1);
    }
    divider(r0, P.gold_500, line(1.2));
    divider(r1, P.gold_500, line(1.2));
  }

  // ── r4 三元龍色帶(輔助,不是傳統環) ──
  {
    const [r0, r1] = rr('r4');
    for (const c of ringById('yuan_band').cells) {
      ops.push({ t: 'wedge', r0, r1, b0: c.startDeg - 0.12, w: c.widthDeg + 0.24, fill: P[DRAGON_BAND_TOKEN[c.dragon]] });
    }
    divider(r1, P.gold_700, line(0.8));
  }

  // ── r5 二十四節氣: 兩字沿半徑堆疊,外側字先讀 ──
  {
    const [r0, r1] = rr('r5');
    const mid = (r0 + r1) / 2;
    const size = px(10.5);
    const cardinal = new Set(['冬至', '春分', '夏至', '秋分']);
    for (const c of ringById('solar_terms').cells) {
      ops.push({ t: 'wedge', r0, r1, b0: c.startDeg, w: c.widthDeg, fill: P.lacquer_800 });
      const radii = stackGlyphRadii({ count: c.chars.length, radiusPx: mid, px: size });
      const hot = cardinal.has(c.term);
      c.chars.forEach((ch, i) => {
        ops.push({ t: 'glyph', kind: 'term', text: ch, b: c.centerDeg, r: radii[i], px: size, bold: hot, color: hot ? P.gold_300 : P.ivory });
      });
      spoke(c.startDeg, r0, r1, P.gold_700, line(0.6), 0.55);
    }
    divider(r1, P.gold_500, line(1.1));
  }

  // ── r6 二十八宿: 窄宿(房心星牛)縮字錯位,極窄(觜鬼)引線 ──
  {
    const [r0, r1] = rr('r6');
    const mid = (r0 + r1) / 2;
    const cells = ringById('xiu28').cells;
    const plan = xiuLabelPlan();
    const normalPx = px(14);
    const smallPx = px(9);
    const halfDeg = (size, r) => ((size * 0.62) / r) * (180 / Math.PI);
    const placed = [];
    const items = cells.map((c, i) => ({ c, plan: plan[i].plan, b: c.centerDeg, r: mid, size: plan[i].plan === 'normal' ? normalPx : smallPx, leader: null }));

    // 相鄰的窄宿上下錯開,避免字貼在一起
    items.forEach((it, i) => {
      if (it.plan === 'normal') return;
      const prev = items[(i + 27) % 28];
      const next = items[(i + 1) % 28];
      if (prev.plan !== 'normal' || next.plan !== 'normal') {
        it.r = mid + (it.stagger = i % 2 === 0 ? 1 : -1) * 3.2 * k;
      }
    });
    items.filter((it) => it.plan === 'normal' || it.plan === 'tight').forEach((it) => placed.push({ b: it.b, h: halfDeg(it.size, it.r) }));
    // 引線宿: 往旁邊找不撞字的位置
    for (const it of items.filter((x) => x.plan === 'leader')) {
      const h = halfDeg(it.size, it.r);
      let pickShift = 0;
      for (let s = 0; s <= 10; s += 0.25) {
        const ok = [s, -s].find((sh) => placed.every((p) => angDist(it.c.centerDeg + sh, p.b) >= p.h + h + 0.35));
        if (ok !== undefined) { pickShift = ok; break; }
      }
      it.b = wrap360(it.c.centerDeg + pickShift);
      if (Math.abs(pickShift) > 0.05) it.leader = { from: it.c.centerDeg, to: it.b };
      placed.push({ b: it.b, h });
    }

    cells.forEach((c, i) => {
      ops.push({ t: 'wedge', r0, r1, b0: c.startDeg, w: c.widthDeg, fill: i % 2 === 0 ? P.lacquer_800 : P.lacquer_700 });
    });
    for (const it of items) {
      ops.push({ t: 'glyph', kind: 'xiu', text: it.c.name, b: it.b, r: it.r, px: it.size, bold: false, color: it.plan === 'leader' ? P.gold_300 : P.ivory, plan: it.plan });
      if (it.leader) {
        ops.push({ t: 'leader', b0: it.leader.from, r0, b1: it.leader.to, r1: it.r - it.size * 0.6, color: P.gold_300, width: line(0.7) });
      }
    }
    for (const c of cells) spoke(c.startDeg, r0, r1, P.gold_700, line(0.6), 0.6);
    divider(r1, P.gold_500, line(1.1));
  }

  // ── r7 三百六十度刻度: 1° 細線、5° 中線、10° 長線、每 30° 標數字 ──
  {
    const [r0, r1] = rr('r7');
    ops.push({ t: 'wedge', r0, r1, b0: 0, w: 360, fill: P.lacquer_900 });
    const len = { thin: 2.5 * k, mid: 4 * k, long: 5.5 * k, label: 5.5 * k };
    const col = { thin: P.gold_700, mid: P.gold_500, long: P.gold_300, label: P.gold_300 };
    const wd = { thin: line(0.5), mid: line(0.7), long: line(0.9), label: line(1.2) };
    for (let deg = 0; deg < 360; deg += 1) {
      const kind = scaleTickKind(deg);
      spoke(deg, r1 - len[kind], r1 - 0.6 * k, col[kind], wd[kind], 1);
      if (kind === 'label') {
        ops.push({ t: 'glyph', kind: 'scale', text: String(deg), b: deg, r: r0 + 4.6 * k, px: px(9.5), bold: false, color: P.ivory });
      }
    }
    divider(r0, P.gold_500, line(1));
    divider(r1, P.gold_500, line(1.4));
  }

  return { R, k, layout, ops, glyphs: ops.filter((o) => o.t === 'glyph') };
}

// ─────────────────────────── 執行繪圖指令 ───────────────────────────

const fontOf = (g) => `${g.bold ? 'bold ' : ''}${g.px}px ${KAI_STACK}`;

/** 把 buildDialPlan 的指令畫到 ctx(盤心在 cx,cy)。不含任何會隨旋轉改變的東西。 */
export function paintDial(ctx, plan, cx, cy) {
  const { R, ops } = plan;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'butt';

  // 漆面: 微徑向漸層(以盤心對稱,旋轉後看不出破綻)
  const base = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  base.addColorStop(0, P.lacquer_600);
  base.addColorStop(0.55, P.lacquer_800);
  base.addColorStop(1, P.lacquer_900);
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  let font = '';
  for (const op of ops) {
    switch (op.t) {
      case 'tianchi': {
        const g = ctx.createRadialGradient(0, -op.r * 0.25, 0, 0, 0, op.r);
        g.addColorStop(0, P.lacquer_600);
        g.addColorStop(1, P.lacquer_900);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, op.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = P.gold_500;
        ctx.lineWidth = Math.max(1, plan.k * 1.4);
        ctx.stroke();
        break;
      }
      case 'wedge': {
        const a0 = (op.b0 - 90) * D2R;
        const a1 = (op.b0 + op.w - 90) * D2R;
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.arc(0, 0, op.r1, a0, a1, false);
        ctx.arc(0, 0, op.r0, a1, a0, true);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'arc':
        ctx.globalAlpha = op.alpha;
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.arc(0, 0, op.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'spoke': {
        const t = op.b * D2R;
        const s = Math.sin(t);
        const c = Math.cos(t);
        ctx.globalAlpha = op.alpha;
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.moveTo(op.r0 * s, -op.r0 * c);
        ctx.lineTo(op.r1 * s, -op.r1 * c);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'leader': {
        const t0 = op.b0 * D2R;
        const t1 = op.b1 * D2R;
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.moveTo(op.r0 * Math.sin(t0), -op.r0 * Math.cos(t0));
        ctx.lineTo(op.r1 * Math.sin(t1), -op.r1 * Math.cos(t1));
        ctx.stroke();
        break;
      }
      case 'dot': {
        const t = op.b * D2R;
        ctx.fillStyle = op.color;
        ctx.beginPath();
        ctx.arc(op.r * Math.sin(t), -op.r * Math.cos(t), op.rad, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'yao': {
        // 在「字頭朝外」的局部座標畫爻: 陽=一條實線,陰=中間斷開的兩段
        ctx.save();
        ctx.rotate(op.b * D2R);
        ctx.fillStyle = op.color;
        const y = -op.r - op.thick / 2;
        if (op.yang) {
          ctx.fillRect(-op.len / 2, y, op.len, op.thick);
        } else {
          const seg = op.len * 0.36;
          ctx.fillRect(-op.len / 2, y, seg, op.thick);
          ctx.fillRect(op.len / 2 - seg, y, seg, op.thick);
        }
        ctx.restore();
        break;
      }
      case 'glyph': {
        const f = fontOf(op);
        if (f !== font) { ctx.font = f; font = f; }
        const t = op.b * D2R;
        ctx.save();
        ctx.translate(op.r * Math.sin(t), -op.r * Math.cos(t));
        ctx.rotate(t);
        ctx.fillStyle = op.color;
        ctx.fillText(op.text, 0, 0);
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }
  ctx.restore();
}

/** 字型載入完再畫(規格 2.8.8);沒有網路字型時很快就返回,最多等 1.5 秒。 */
export async function ensureFonts() {
  try {
    if (!document.fonts || !document.fonts.load) return;
    const sample = '子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬向坐北坎震離兌冬至虛危';
    await Promise.race([
      Promise.all([document.fonts.load(`16px ${KAI_STACK}`, sample), document.fonts.load(`bold 16px ${KAI_STACK}`, sample)]),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  } catch { /* 字型 API 不可用就直接畫 */ }
}

/** 畫旋轉層(整張盤面)。回傳這次畫的計畫,方便呼叫端做檢查。 */
export function drawDial(canvas, cssSize, opts = {}) {
  const g = stageGeometry(cssSize);
  const ctx = fitCanvas(canvas, g.S, g.S, 3, { alpha: true });
  ctx.clearRect(0, 0, g.S, g.S);
  const plan = buildDialPlan({ R: g.R, yinyangScheme: opts.yinyangScheme, traditionalBagua: opts.traditionalBagua });
  paintDial(ctx, plan, g.cx, g.cy);
  return plan;
}

/**
 * 畫不旋轉的疊層: 金屬斜角盤緣、盤面高光與內緣陰影、天心十道、向/坐標記。
 * measure='sit' 時上下標記互換(紅線下量到的是坐)。
 */
export function drawOverlay(canvas, cssSize, { measure = 'facing' } = {}) {
  const g = stageGeometry(cssSize);
  const ctx = fitCanvas(canvas, g.S, g.S, 3, { alpha: true });
  const { cx, cy, Rb, R, bw } = g;
  ctx.clearRect(0, 0, g.S, g.S);

  // 盤面內緣的陰影(讓盤面像嵌在盤緣裡)
  const inner = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // 盤面高光(玻璃反光): 只畫在不旋轉的疊層
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.5, 0, cx - R * 0.32, cy - R * 0.5, R * 0.95);
  sheen.addColorStop(0, 'rgba(255,250,232,0.13)');
  sheen.addColorStop(0.55, 'rgba(255,250,232,0.03)');
  sheen.addColorStop(1, 'rgba(255,250,232,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // 金屬盤緣: 外環亮上暗下,內環相反,形成斜角
  const annulus = (r1, r0) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.arc(cx, cy, r0, 0, Math.PI * 2, true);
  };
  const lg = (a, b, stops) => {
    const gr = ctx.createLinearGradient(cx - a * Rb, cy - a * Rb, cx + b * Rb, cy + b * Rb);
    stops.forEach(([o, c]) => gr.addColorStop(o, c));
    return gr;
  };
  const split = R + bw * 0.55;
  ctx.fillStyle = lg(1, 1, [[0, P.gold_100], [0.3, P.gold_300], [0.55, P.gold_700], [0.8, P.gold_500], [1, P.gold_900]]);
  annulus(Rb, split);
  ctx.fill();
  ctx.fillStyle = lg(1, 1, [[0, P.gold_900], [0.35, P.gold_700], [0.6, P.gold_500], [1, P.gold_100]]);
  annulus(split, R);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, Rb - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,12,4,0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,244,205,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, split, 0, Math.PI * 2);
  ctx.stroke();

  // 天心十道: 不轉動的紅線。直線是瞄準線,橫線較淡。
  ctx.strokeStyle = P.cinnabar_500;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - Rb - 1);
  ctx.lineTo(cx, cy + Rb + 1);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - Rb, cy);
  ctx.lineTo(cx + Rb, cy);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 向 / 坐 標記(盤緣外的小紅三角)
  const label = cssVar('--cinnabar', '#f0665a');
  const top = measure === 'sit' ? '坐' : '向';
  const bottom = measure === 'sit' ? '向' : '坐';
  const tri = (tipY, dir) => {
    ctx.fillStyle = P.cinnabar_500;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - 5.5, tipY - dir * 10);
    ctx.lineTo(cx + 5.5, tipY - dir * 10);
    ctx.closePath();
    ctx.fill();
  };
  tri(cy - Rb - 1, 1);
  tri(cy + Rb + 1, -1);
  ctx.fillStyle = label;
  ctx.font = `bold 12px ${KAI_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(top, cx + 10, cy - Rb - 6.5);
  ctx.fillText(bottom, cx + 10, cy + Rb + 6.5);
  return g;
}

/**
 * 磁針與海底線(向量圖字串,只含程式內建的數字,可安全交給 h(..., {html}))。
 * 隨盤面一起旋轉;真北模式時磁針相對盤面偏一個磁偏角(見 needleRotation)。
 */
export function needleMarkup(cssSize) {
  const g = stageGeometry(cssSize);
  const { S, cx, cy, R, k } = g;
  const tc = 0.188 * R;
  const tip = tc * 0.84;
  const w = Math.max(2.2, 2.6 * k);
  const f = (n) => n.toFixed(2);
  return `<svg viewBox="0 0 ${S} ${S}" width="100%" height="100%" aria-hidden="true" focusable="false">`
    + `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(cx)}" y2="${f(cy - tc + 1)}" stroke="${P.cinnabar_500}" stroke-width="1.2"/>`
    + `<circle cx="${f(cx - 2.6)}" cy="${f(cy - tc + 2.2)}" r="1.6" fill="${P.cinnabar_500}"/>`
    + `<circle cx="${f(cx + 2.6)}" cy="${f(cy - tc + 2.2)}" r="1.6" fill="${P.cinnabar_500}"/>`
    + `<text x="${f(cx + Math.max(7, 9 * k))}" y="${f(cy - tc * 0.5)}" font-size="${f(Math.max(8, 9 * k))}" fill="${P.ivory}" text-anchor="middle" dominant-baseline="middle" font-family='${KAI_STACK.replace(/"/g, '&quot;')}'>北</text>`
    + `<g class="v-compass-needle" transform="rotate(0 ${f(cx)} ${f(cy)})">`
    + `<polygon points="${f(cx)},${f(cy - tip)} ${f(cx - w)},${f(cy)} ${f(cx + w)},${f(cy)}" fill="#120d09" stroke="${P.ivory}" stroke-opacity=".85" stroke-width=".8"/>`
    + `<polygon points="${f(cx)},${f(cy + tip)} ${f(cx - w)},${f(cy)} ${f(cx + w)},${f(cy)}" fill="${P.cinnabar_500}" stroke="${P.cinnabar_800}" stroke-width=".6"/>`
    + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.max(1.6, 1.9 * k))}" fill="${P.gold_500}" stroke="${P.gold_900}" stroke-width=".6"/>`
    + '</g></svg>';
}

/** 磁針相對盤面的偏轉(度): 磁北模式 0;真北模式,盤面 0 度是真北,磁北在磁偏角 D 處。 */
export function needleRotation({ trueMode, declination }) {
  return trueMode && Number.isFinite(declination) ? declination : 0;
}

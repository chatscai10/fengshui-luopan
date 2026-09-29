// 九宮星盤圖:玄空盤(山星/向星/運星)與流年盤共用同一個元件。
// 三種輸出共用同一份「模型」:DOM(畫面)、Canvas(存成圖片)、純文字(複製報告)。
// 排列是羅盤方位圖的傳統「南上」:上排 巽 離 坤,中排 震 中 兌,下排 艮 坎 乾。
// 3x3 只能表示 90 度的倍數,所以這張圖不做旋轉切換;圖旁一行小字說明你家朝向。
import { h } from '../dom.js';
import { qiLabel } from '../../core/xuankong.js';

export const GRID_ROWS = Object.freeze([
  Object.freeze(['巽', '離', '坤']),
  Object.freeze(['震', '中', '兌']),
  Object.freeze(['艮', '坎', '乾']),
]);

const DIR_OF = Object.freeze({ 坎: '北', 艮: '東北', 震: '東', 巽: '東南', 離: '南', 坤: '西南', 兌: '西', 乾: '西北', 中: '中宮' });
export const STAR_NAME = Object.freeze({ 1: '一白', 2: '二黑', 3: '三碧', 4: '四綠', 5: '五黃', 6: '六白', 7: '七赤', 8: '八白', 9: '九紫' });

/** 五氣標籤 → 三類(旺/退/煞)。不認得的標籤回 'none',畫面照樣顯示數字。 */
export function qiClass(label) {
  if (label === '旺' || label === '近旺生' || label === '遠旺生' || label === '進' || label === '生') return 'wang';
  if (label === '退' || label === '衰') return 'tui';
  if (label === '死' || label === '煞衰' || label === '煞') return 'sha';
  return 'none';
}

/** 顏色之外的文字提示,讓色弱與黑白列印也看得懂 */
export const QI_TAG = Object.freeze({ wang: '旺', tui: '退', sha: '煞', none: '' });
export const LEGEND = Object.freeze([
  { cls: 'wang', tag: '旺', text: '當運或接近當運的星' },
  { cls: 'tui', tag: '退', text: '剛過去的運,力量退了' },
  { cls: 'sha', tag: '煞', text: '衰或需要留意的星' },
]);

const isStar = (n) => Number.isInteger(n) && n >= 1 && n <= 9;

function starCell(star, qi) {
  if (!isStar(star)) return { star: null, name: '', cls: 'none', tag: '' };
  const cls = qiClass(qi);
  return { star, name: STAR_NAME[star], cls, tag: QI_TAG[cls] };
}

/**
 * 玄空盤模型。沒有玄空盤(缺建成年份)回 null。
 * @param {object} report analyzeHouse 的結果
 */
export function buildChartGridModel(report) {
  const xk = report && report.xuankong;
  if (!xk || !xk.chart || !xk.chart.palaces) return null;
  const pal = xk.chart.palaces;
  const qi = (xk.qi && xk.qi.byPalace) || {};
  const cells = {};
  for (const gua of Object.keys(DIR_OF)) {
    const p = pal[gua];
    if (!p) continue;
    const q = qi[gua] || {};
    const marks = [];
    if (gua === xk.chart.facePalace) marks.push('向');
    if (gua === xk.chart.sitPalace) marks.push('坐');
    cells[gua] = {
      gua,
      dir: DIR_OF[gua],
      shan: starCell(p.shan, q.shan && q.shan.label),
      xiang: starCell(p.xiang, q.xiang && q.xiang.label),
      yun: starCell(p.yun, q.yun && q.yun.label),
      tags: [],
      marks,
    };
  }
  if (Object.keys(cells).length !== 9) return null;
  return {
    kind: 'chart',
    title: `玄空盤: ${xk.pattern}`,
    subtitle: `第 ${xk.meta.chartYun} 運起盤`,
    cells,
    center: null,
    note: orientationNote(report),
  };
}

/**
 * 流年盤模型:每宮一顆流年星,旺衰以「今天所屬的運」來看。太歲、歲破、三煞、五黃、二黑另外標在格內。
 */
export function buildAnnualGridModel(report) {
  const an = report && report.annual;
  const byGua = an && an.annual && an.annual.chartByGua;
  if (!byGua) return null;
  const yun = Number.isInteger(an.year && an.year.yun) ? an.year.yun : report.xuankong && report.xuankong.meta.currentYun;
  const scheme = (report.meta && report.meta.ruleset && report.meta.ruleset.qiScheme) || 'default';
  const sanshaGua = an.sansha ? guaOfDirName(an.sansha.dir) : null;
  const cells = {};
  for (const gua of Object.keys(DIR_OF)) {
    const star = byGua[gua];
    if (!isStar(star)) continue;
    let label = null;
    try { label = Number.isInteger(yun) ? qiLabel(yun, star, scheme) : null; } catch { label = null; }
    const tags = [];
    if (an.taisui && gua === an.taisui.gua) tags.push('太歲');
    if (an.taisui && gua === an.taisui.suipoGua) tags.push('歲破');
    if (gua === sanshaGua) tags.push('三煞');
    cells[gua] = { gua, dir: DIR_OF[gua], flow: starCell(star, label), tags, marks: [] };
  }
  if (Object.keys(cells).length !== 9) return null;
  return {
    kind: 'annual',
    title: `${an.year.fengshuiYear} 年(${an.year.ganzhi})流年盤`,
    subtitle: `今年入中的星是${STAR_NAME[an.annual.center] || ''}`,
    cells,
    center: an.annual.center,
    note: orientationNote(report),
  };
}

const GUA_OF_DIR = Object.freeze({ 北: '坎', 東北: '艮', 東: '震', 東南: '巽', 南: '離', 西南: '坤', 西: '兌', 西北: '乾' });
const guaOfDirName = (d) => GUA_OF_DIR[d] || null;

/** 圖旁的一行小字:提醒圖上是羅盤方位(上方是南),並告訴使用者他家朝哪裡 */
export function orientationNote(report) {
  const g = report && report.geo;
  const face = g && g.dir8 ? `你家朝向${g.dir8}方${g.facingMountain ? `(${g.facingMountain}山)` : ''}` : '';
  return `圖上的方位是羅盤方位(上方是南方、下方是北方),${face || '你家的朝向見上方說明'}。`;
}

/** 螢幕閱讀器與純文字用的每格描述 */
export function cellText(model, cell) {
  const where = cell.gua === '中' ? '中宮(房子中心)' : `${cell.gua}宮(${cell.dir}方)`;
  const mark = cell.marks && cell.marks.length ? `,${cell.marks.map((m) => `是${m}宮`).join('、')}` : '';
  const tag = cell.tags && cell.tags.length ? `,${cell.tags.join('、')}` : '';
  if (model.kind === 'chart') {
    const s = (label, c) => (c.star ? `${label}${c.name}${c.tag ? `(${c.tag})` : ''}` : `${label}無`);
    return `${where}${mark}:${s('山星', cell.shan)}、${s('向星', cell.xiang)}、${s('運星', cell.yun)}`;
  }
  const f = cell.flow;
  return `${where}${tag}:流年星${f.name}${f.tag ? `(${f.tag})` : ''}`;
}

export function altText(model) {
  if (!model) return '';
  const lines = GRID_ROWS.flat().map((g) => (model.cells[g] ? cellText(model, model.cells[g]) : ''));
  return `${model.title}。上方是南方。${lines.filter(Boolean).join(';')}`;
}

/** 純文字九宮(南上),給「複製文字報告」用 */
export function gridToText(model) {
  if (!model) return '';
  const rows = GRID_ROWS.map((row) => row.map((g) => {
    const c = model.cells[g];
    if (!c) return '';
    const head = g === '中' ? '中宮' : `${g}(${c.dir})`;
    if (model.kind === 'chart') {
      const t = (label, x) => `${label}${x.star ?? '-'}${x.tag}`;
      return `${head}${c.marks.length ? `[${c.marks.join('')}]` : ''} ${t('山', c.shan)} ${t('向', c.xiang)} ${t('運', c.yun)}`;
    }
    return `${head} 流年${c.flow.star ?? '-'}${c.flow.tag}${c.tags.length ? `[${c.tags.join('、')}]` : ''}`;
  }).join(' | '));
  return [`${model.title}(${model.subtitle};上方是南方)`, ...rows].join('\n');
}

// ─────────────────────────── DOM ───────────────────────────

function starEl(label, c) {
  return h('div', { class: `v-sg-star is-${c.cls}` },
    h('span', { class: 'v-sg-k' }, label),
    h('span', { class: 'v-sg-n' }, c.star ?? '-'),
    c.tag ? h('span', { class: 'v-sg-q' }, c.tag) : null,
  );
}

function cellEl(model, cell) {
  const isCenter = cell.gua === '中';
  const head = h('div', { class: 'v-sg-head' },
    h('span', { class: 'v-sg-gua' }, isCenter ? '中' : cell.gua),
    h('span', { class: 'v-sg-dir' }, isCenter ? '中宮' : cell.dir),
    ...cell.marks.map((m) => h('span', { class: `v-sg-mark is-${m === '向' ? 'xiang' : 'zuo'}` }, m)),
  );
  let body;
  if (model.kind === 'chart') {
    body = [
      h('div', { class: 'v-sg-pair' }, starEl('山', cell.shan), starEl('向', cell.xiang)),
      h('div', { class: `v-sg-yun is-${cell.yun.cls}` }, `運 ${cell.yun.star ?? '-'}`),
    ];
  } else {
    body = [
      h('div', { class: `v-sg-flow is-${cell.flow.cls}` },
        h('span', { class: 'v-sg-n big' }, cell.flow.star ?? '-'),
        h('span', { class: 'v-sg-fname' }, cell.flow.name),
        cell.flow.tag ? h('span', { class: 'v-sg-q' }, cell.flow.tag) : null,
      ),
      cell.tags.length ? h('div', { class: 'v-sg-tags' }, cell.tags.map((t) => h('span', { class: 'v-sg-tag' }, t))) : null,
    ];
  }
  return h('div', {
    class: `v-sg-cell${isCenter ? ' is-center' : ''}`,
    role: 'group',
    'aria-label': cellText(model, cell),
    dataset: { gua: cell.gua },
  }, head, ...body);
}

/** 完整的區塊:標題、九宮格、圖例、方位說明 */
export function renderStarGrid(model) {
  if (!model) return h('div');
  const grid = h('div', { class: `v-sg-grid is-${model.kind}` },
    GRID_ROWS.flat().map((g) => (model.cells[g] ? cellEl(model, model.cells[g]) : h('div', { class: 'v-sg-cell' }))));
  return h('figure', { class: 'v-sg' },
    h('figcaption', { class: 'v-sg-cap' },
      h('span', { class: 'v-sg-title' }, model.title),
      h('span', { class: 'v-sg-sub' }, model.subtitle),
    ),
    grid,
    h('div', { class: 'v-sg-legend', 'aria-label': '顏色說明' },
      LEGEND.map((l) => h('span', { class: `v-sg-lg is-${l.cls}` },
        h('b', null, l.tag), ` ${l.text}`)),
    ),
    h('p', { class: 'v-sg-note' }, model.note),
  );
}

// ─────────────────────────── Canvas(存成圖片用) ───────────────────────────

/**
 * 把九宮格畫進 ctx 的 (x,y) 起、邊長 size 的方形。pal 由呼叫端從 CSS 變數取值:
 * { line, text, dim, faint, wang, tui, sha, wangBg, shaBg, fontKai, fontUi }
 */
export function drawStarGrid(ctx, model, x, y, size, pal) {
  if (!model) return;
  const cell = size / 3;
  const pad = cell * 0.07;
  ctx.save();
  ctx.textBaseline = 'middle';
  const color = (cls) => (cls === 'wang' ? pal.wang : cls === 'sha' ? pal.sha : cls === 'tui' ? pal.tui : pal.text);
  GRID_ROWS.forEach((row, r) => row.forEach((gua, c) => {
    const cx = x + c * cell;
    const cy = y + r * cell;
    const cl = model.cells[gua];
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.line;
    const isCenter = gua === '中';
    if (isCenter) { ctx.fillStyle = pal.wangBg; ctx.fillRect(cx, cy, cell, cell); }
    ctx.strokeRect(cx, cy, cell, cell);
    if (!cl) return;
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.dim;
    ctx.font = `${cell * 0.13}px ${pal.fontKai}`;
    ctx.fillText(`${isCenter ? '中宮' : `${gua} ${cl.dir}`}`, cx + pad, cy + pad + cell * 0.07);
    ctx.textAlign = 'right';
    if (cl.marks && cl.marks.length) {
      ctx.fillStyle = pal.text;
      ctx.font = `bold ${cell * 0.12}px ${pal.fontUi}`;
      ctx.fillText(cl.marks.join(''), cx + cell - pad, cy + pad + cell * 0.07);
    }
    const big = (label, c2, ax, ay) => {
      ctx.textAlign = 'center';
      ctx.fillStyle = color(c2.cls);
      ctx.font = `bold ${cell * 0.3}px ${pal.fontUi}`;
      ctx.fillText(String(c2.star ?? '-'), ax, ay);
      ctx.fillStyle = pal.faint;
      ctx.font = `${cell * 0.11}px ${pal.fontUi}`;
      ctx.fillText(`${label}${c2.tag ? ` ${c2.tag}` : ''}`, ax, ay + cell * 0.2);
    };
    if (model.kind === 'chart') {
      big('山', cl.shan, cx + cell * 0.28, cy + cell * 0.5);
      big('向', cl.xiang, cx + cell * 0.72, cy + cell * 0.5);
      ctx.textAlign = 'center';
      ctx.fillStyle = color(cl.yun.cls);
      ctx.font = `${cell * 0.14}px ${pal.fontUi}`;
      ctx.fillText(`運 ${cl.yun.star ?? '-'}`, cx + cell / 2, cy + cell * 0.9);
    } else {
      big(cl.flow.name, cl.flow, cx + cell / 2, cy + cell * 0.5);
      if (cl.tags.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = pal.dim;
        ctx.font = `${cell * 0.12}px ${pal.fontUi}`;
        ctx.fillText(cl.tags.join(' '), cx + cell / 2, cy + cell * 0.9);
      }
    }
  }));
  ctx.restore();
}

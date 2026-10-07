// 報告畫面:renderReport 的分段卡片 + 九宮星盤圖,預設只展開「總覽」。
// 動作:複製文字報告(navigator.clipboard,失敗退回可選取的文字面板)、存成圖片(離屏 canvas → 分享或下載)。
// 文案一律來自 renderReport;這裡只負責分區與排版。任何地方都不顯示分數。
// 純邏輯(buildReportModel、buildPlainReport、findScoreLeaks、wrapLines)可在 node 測試,DOM 只在 mount() 內碰。
import { h, clear } from '../dom.js';
import { zhPunct } from '../punct.js';
import { renderReport } from '../../core/copy.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';
import { DIR8, DECLINATION_MODEL } from '../../core/geo.js';
import { AUSPICIOUS_STARS } from '../../core/bazhai.js';
import { badgeClass, renderInfoCard, TIER_LABEL, sanitizePage, safeReport } from './wealth.js';
import {
  buildChartGridModel, buildAnnualGridModel, renderStarGrid, drawStarGrid, gridToText,
} from '../canvas/starGrid.js';
import { buildPlacementBlock } from '../../core/placement.js';
import { cssVar, KAI_STACK, UI_STACK } from '../canvas/canvasUtil.js';

// ─────────────────────────── 資料模型(純函式) ───────────────────────────

const GROUP_LABEL = Object.freeze({ east: '東四', west: '西四' });

const RATING_GOOD = Object.freeze(['best', 'good', 'ok']);
const RATING_BAD = Object.freeze(['avoid', 'worst']);

const USE_LABEL = Object.freeze([
  ['position', 'door', '大門的位置'],
  ['position', 'masterBedroom', '主臥室的位置'],
  ['facing', 'bedHead', '床頭朝向'],
  ['facing', 'desk', '書桌面向'],
  ['facing', 'stoveMouth', '灶口朝向'],
]);

const dirText = (d) => (d === '中宮' || d === '中' ? '中宮' : `${d}方`);

function starTableRows(stars) {
  return DIR8.filter((d) => stars && stars[d]).map((d) => ({
    dir: d,
    star: stars[d],
    good: AUSPICIOUS_STARS.includes(stars[d]),
  }));
}

/** 八宅區塊:宅卦八方位表 + 每位住戶的命卦、八方位、大門/床/書桌/灶口建議 */
export function buildBazhaiBlock(report) {
  const bz = report && report.bazhai;
  if (!bz || !bz.house) return null;
  const basis = report.meta && report.meta.ruleset && report.meta.ruleset.bazhaiFacingBasis === 'house' ? '宅向' : '大門朝向';
  const fmt = (list) => list.map((e) => `${dirText(e.dir)}(${e.star}位)`).join('、');
  return {
    house: {
      name: bz.house.name,
      group: `${GROUP_LABEL[bz.house.group] || ''}宅`,
      basis: `依「${basis}」定出宅卦。`,
      rows: starTableRows(bz.house.stars),
    },
    residents: (bz.residents || []).map((r) => ({
      name: r.name,
      gua: `${r.ming.gua}命`,
      group: `${GROUP_LABEL[r.ming.group] || ''}命`,
      matches: r.matchesHouse,
      rows: starTableRows(r.stars),
      uses: USE_LABEL.map(([part, key, label]) => {
        const list = (r.usage && r.usage[part] && r.usage[part][key]) || [];
        return {
          label,
          good: fmt(list.filter((e) => RATING_GOOD.includes(e.rating))),
          bad: fmt(list.filter((e) => RATING_BAD.includes(e.rating))),
        };
      }).filter((u) => u.good || u.bad),
    })),
  };
}

const NORTH_LABEL = Object.freeze({ magnetic: '磁北(和實體羅盤一致)', true: '真北(地圖上的北)' });
const PROFILE_LABEL = Object.freeze({ mingcai: '通俗明財位(進門對角為主)', xuankong: '玄空進階(星盤為主)' });
const BASIS_LABEL = Object.freeze({ door: '大門朝向', house: '房子的向' });
const YUNBASIS_LABEL = Object.freeze({ built: '建成年份', moveIn: '遷入年份' });
const BOUNDARY_LABEL = Object.freeze({
  lichun_exact: '立春(精確到分)', lichun_date_only: '立春(只比日期)', fixed_feb4: '固定 2 月 4 日', lunar_new_year: '農曆春節', gregorian_jan1: '元旦',
});
const YUNSYS_LABEL = Object.freeze({ san_yuan_9: '三元九運(2024 年起是九運)', er_yuan_8: '二元八運' });
const YESNO = (v) => (v ? '開' : '關');

const SETTING_ROWS = Object.freeze([
  ['northMode', '羅盤讀數的北', (v) => NORTH_LABEL[v] || String(v)],
  ['measureUncertainty', '手機量測誤差估計', (v) => `約 ${v} 度`],
  ['bazhaiFacingBasis', '八宅用哪個朝向定宅卦', (v) => BASIS_LABEL[v] || String(v)],
  ['yunBasis', '玄空入運依據', (v) => YUNBASIS_LABEL[v] || String(v)],
  ['yunSystem', '元運系統', (v) => YUNSYS_LABEL[v] || String(v)],
  ['yearBoundary', '命卦換年時刻', (v) => BOUNDARY_LABEL[v] || String(v)],
  ['wealthProfile', '財位排序方式', (v) => PROFILE_LABEL[v] || String(v)],
  ['allowWaterHint', '顯示放水提示', YESNO],
  ['showMinorityTechniques', '顯示少數派說法', YESNO],
  ['useTiGua', '兼向偏多時改用替卦', YESNO],
]);

/** 附錄:採用的設定(白話)。其餘進階選項只報「有幾項和預設不同」 */
export function buildSettingsSummary(report) {
  const rs = (report && report.meta && report.meta.ruleset) || {};
  const shown = new Set(SETTING_ROWS.map((r) => r[0]));
  const rows = SETTING_ROWS.filter(([k]) => k in rs).map(([k, label, fmt]) => ({ label, value: fmt(rs[k]) }));
  const others = Object.keys(DEFAULT_SETTINGS).filter((k) => !shown.has(k) && k in rs && JSON.stringify(rs[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])).length;
  return { rows, others };
}

export const SOURCE_NOTES = Object.freeze([
  '方位與 24 山:依 360 度分成 24 等分(每份 15 度)計算,全程在你的手機上運算,不需要網路。',
  `磁北與真北的差(磁偏角):採用 ${DECLINATION_MODEL.name} 模型的城市數值,有效期到 ${Math.floor(DECLINATION_MODEL.validTo)} 年。`,
  '節氣與年份的換算(以立春為界)由程式依天文曆表計算。',
  '八宅、玄空飛星、財位的規則,整理自公開的風水文獻與文章;各流派說法不同時,每則結論都標示「傳統說法、推論、本 App 的設計、少數派」。',
  '你填的資料只存在這支手機裡,不會上傳。',
]);

/** 總覽三個重點:坐向、財位、今年 */
export function buildKeyPoints(report, page) {
  const s = report.summary;
  const points = [{ label: '坐向', value: s.headline, sub: `${s.zhai}(${GROUP_LABEL[s.zhaiGroup] || ''}宅)` }];
  const top = s.wealthTop && s.wealthTop[0];
  const card = top ? page.sections.flatMap((x) => x.cards).find((c) => c.id === `card.wealth.${top.id}`) : null;
  points.push(top
    ? { label: '財位', value: card ? card.headline : top.label, sub: TIER_LABEL[top.tier] }
    : { label: '財位', value: '還沒有結果', sub: '補上平面圖與大門後會出現' });
  points.push({ label: '今年留意', value: `五黃在${dirText(s.year.wuhuang)}`, sub: `二黑在${dirText(s.year.erhei)}、三煞在${dirText(s.year.sansha)}` });
  return points;
}

const SECTION_HINT = Object.freeze({
  orientation: '房子的背與面、宅卦、磁北與真北的對照,都在這裡。',
  bazhai: '八宅法依房子的組別與你的命卦,判斷八個方位各是什麼星、適合放什麼。',
  wealth: '財位的說明與各層次的看法。最佳位置與示意圖在「財位」分頁。',
  xuankong: '玄空飛星:每個方位有山星、向星、運星三個數字,旺衰以今天所屬的運來看。進階內容,可以只看星盤圖。',
  annual: '今年每個方位飛到的星,以及太歲、三煞、五黃、二黑的位置。每年立春換一次。',
  rooms: '依玄空盤推算各種房間適合放的位置。這些是推論,沒有直接的古籍依據。',
  placement: '床位、書桌工作區、廚房爐灶與室內格局避忌的配置方針。',
  traditional: '流傳較廣但流派看法不一,或只有少數流派主張的說法。',
});

const cardsOf = (page, id) => (page.sections.find((s) => s.id === id) || { cards: [] }).cards;

/**
 * 報告畫面的資料模型。所有會顯示的文字都在這裡,畫面與「複製文字報告」共用。
 */
export function buildReportModel(state, report, rawPage) {
  if (!report || report.error === 'NO_FACING') return { status: 'no-facing' };
  if (report.error || !rawPage) return { status: 'error' };
  const page = sanitizePage(rawPage, report, state.plan);
  const chart = buildChartGridModel(report);
  const annualGrid = buildAnnualGridModel(report);
  const xk = cardsOf(page, 'xuankong');
  const placement = buildPlacementBlock(report, {
    plan: (state && state.plan) || null,
    taiji: (report.planShares && report.planShares.taiji) || null,
    up: report.planShares && Number.isFinite(report.planShares.planUpBearing) ? report.planShares.planUpBearing : null,
  });
  const sections = [
    { id: 'orientation', title: '你家的方位', hint: SECTION_HINT.orientation, cards: cardsOf(page, 'orientation') },
    { id: 'bazhai', title: '命卦與八宅', hint: SECTION_HINT.bazhai, cards: cardsOf(page, 'ming'), bazhai: buildBazhaiBlock(report), needResidents: (report.bazhai.residents || []).length === 0 },
    { id: 'wealth', title: '財位', hint: SECTION_HINT.wealth, cards: cardsOf(page, 'wealth'), limit: 6 },
    { id: 'xuankong', title: '玄空飛星與星盤', hint: SECTION_HINT.xuankong, cards: xk.filter((c) => !c.id.startsWith('xk.room.')), grid: chart, needYear: !chart, limit: 6 },
    { id: 'annual', title: '流年盤與太歲三煞', hint: SECTION_HINT.annual, cards: cardsOf(page, 'annual'), grid: annualGrid },
    { id: 'rooms', title: '各房間建議', hint: SECTION_HINT.rooms, cards: xk.filter((c) => c.id.startsWith('xk.room.')) },
    { id: 'placement', title: '室內重點擺設與禁忌', hint: SECTION_HINT.placement, cards: (placement && placement.cards) || [] },
    { id: 'traditional', title: '傳統說法與少數派', hint: SECTION_HINT.traditional, cards: cardsOf(page, 'traditional') },
  ];
  return {
    status: 'ok',
    computedAt: report.meta && report.meta.computedAtCST,
    overview: {
      paragraphs: page.plainSummary.split('\n').filter(Boolean),
      points: buildKeyPoints(report, page),
    },
    sections,
    appendix: {
      settings: buildSettingsSummary(report),
      sources: [...SOURCE_NOTES],
      disclaimers: page.disclaimers,
    },
  };
}

// ─────────────────────────── 純文字報告 ───────────────────────────

function cardText(c) {
  const badges = c.badges && c.badges.length ? `  [${c.badges.join('|')}]` : '';
  const lines = [`■ ${c.headline}${badges}`, `  ${c.body}`];
  if (c.schoolNote) lines.push(`  各派說明:${c.schoolNote}`);
  return lines.join('\n');
}

function bazhaiText(b) {
  if (!b) return '';
  const table = (rows) => rows.map((r) => `${r.dir}:${r.star}${r.good ? '(吉)' : ''}`).join('  ');
  const out = [`■ ${b.house.name}(${b.house.group}):${b.house.basis}`, `  八方位:${table(b.house.rows)}`];
  for (const r of b.residents) {
    out.push(`■ ${r.name}:${r.gua}(${r.group}),${r.matches ? '與房子相配' : '與房子不配'}`);
    out.push(`  八方位:${table(r.rows)}`);
    for (const u of r.uses) out.push(`  ${u.label}:${u.good ? `適合 ${u.good}` : ''}${u.good && u.bad ? ';' : ''}${u.bad ? `避開 ${u.bad}` : ''}`);
  }
  return out.join('\n');
}

/** 「複製文字報告」的內容。含總覽、各區塊、星盤(文字版)、設定與免責聲明 */
export function buildPlainReport(model) {
  if (!model || model.status !== 'ok') return '';
  const out = ['風水報告', model.computedAt ? `分析時間:${model.computedAt}(台灣時間)` : '', ''];
  out.push('【總覽】', ...model.overview.paragraphs, '');
  model.overview.points.forEach((p) => out.push(`・${p.label}:${p.value}(${p.sub})`));
  out.push('');
  model.sections.forEach((s, i) => {
    const has = s.cards.length > 0 || s.grid || s.bazhai;
    if (!has) return;
    out.push(`【${i + 1}. ${s.title}】`);
    if (s.bazhai) out.push(bazhaiText(s.bazhai), '');
    if (s.grid) out.push(gridToText(s.grid), s.grid.note, '');
    s.cards.forEach((c) => out.push(cardText(c), ''));
  });
  out.push('【附錄:採用的設定】');
  model.appendix.settings.rows.forEach((r) => out.push(`・${r.label}:${r.value}`));
  if (model.appendix.settings.others > 0) out.push(`・另有 ${model.appendix.settings.others} 項進階流派選項與預設不同`);
  out.push('', '【資料來源】', ...model.appendix.sources.map((t) => `・${t}`), '', '【免責聲明】');
  model.appendix.disclaimers.forEach((d, i) => out.push(`${i + 1}. ${d}`));
  return out.join('\n');
}

/**
 * 掃描顯示文字裡有沒有分數外洩(規格:任何畫面都不可顯示 score)。回傳可疑片段。
 * 「約 5 度」「第 9 運」這類本來就該有的數字不算。
 */
const LEAK_PATTERNS = Object.freeze([
  /\d+(?:\.\d+)?\s*分(?![鐘金別組成析界寬派歧開享布散])/,
  /分數|得分|評分|總分|score|points|rawScore/i,
  /\d+(?:\.\d+)?\s*\/\s*100/,
  /\d+(?:\.\d+)?\s*%/,
]);
export function findScoreLeaks(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const hits = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    for (const re of LEAK_PATTERNS) {
      const m = re.exec(t);
      if (m) { hits.push(t.slice(Math.max(0, m.index - 12), m.index + 20)); break; }
    }
  }
  return hits;
}

/** 蒐集報告模型裡所有會顯示的字串(不含 grid 物件,那由 starGrid 的文字函式處理) */
export function collectReportTexts(model) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(model);
  return out;
}

// ─────────────────────────── 存成圖片 ───────────────────────────

/** CJK 逐字換行:measure(str) 回傳寬度。英數連續字元盡量不拆開 */
export function wrapLines(measure, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    // 以「單字元或連續英數」為單位
    const tokens = para.match(/[A-Za-z0-9.%°]+|[\s\S]/g) || [];
    for (const tk of tokens) {
      const next = line + tk;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = tk.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function imagePalette() {
  return {
    bg: cssVar('--bg', '#0e0b09'),
    surface: cssVar('--surface', '#17120e'),
    line: cssVar('--line-strong', 'rgba(232,203,122,.34)'),
    text: cssVar('--text', '#f3ebd8'),
    dim: cssVar('--text-dim', '#b9ae95'),
    faint: cssVar('--text-faint', '#8d8471'),
    gold: cssVar('--gold-bright', '#e8cb7a'),
    wang: cssVar('--gold-bright', '#e8cb7a'),
    tui: cssVar('--text-faint', '#8d8471'),
    sha: cssVar('--terracotta', '#c9705a'),
    wangBg: cssVar('--wealth-bg', 'rgba(214,178,90,.18)'),
    fontKai: KAI_STACK,
    fontUi: UI_STACK,
  };
}

/** 依序畫出總覽卡與星盤。傳入的 ctx 只用於量字與繪製,回傳最後的 y(用來算畫布高度) */
export function paintReportImage(ctx, W, model, pal) {
  const M = 56;
  const inner = W - M * 2;
  let y = M;
  const text = (str, size, color, font = pal.fontUi, lineH = 1.5, weight = '') => {
    ctx.font = `${weight} ${size}px ${font}`.trim();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const ln of wrapLines((s) => ctx.measureText(s).width, zhPunct(str), inner)) {
      ctx.fillText(ln, M, y);
      y += size * lineH;
    }
  };
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, ctx.canvas.height);
  text('風水報告', 54, pal.gold, pal.fontKai, 1.3);
  if (model.computedAt) text(`分析時間 ${model.computedAt}`, 22, pal.faint);
  y += 18;
  text('總覽', 30, pal.gold, pal.fontKai, 1.4);
  model.overview.paragraphs.forEach((p) => { text(p, 28, pal.text, pal.fontUi, 1.6); y += 8; });
  y += 12;
  for (const p of model.overview.points) {
    text(`${p.label}:${p.value}`, 28, pal.gold, pal.fontKai, 1.5, 'bold');
    text(p.sub, 22, pal.dim, pal.fontUi, 1.5);
    y += 8;
  }
  for (const s of model.sections) {
    if (!s.grid) continue;
    y += 24;
    text(s.grid.title, 30, pal.gold, pal.fontKai, 1.4);
    text(s.grid.subtitle, 22, pal.dim);
    y += 10;
    const size = Math.min(inner, 900);
    drawStarGrid(ctx, s.grid, M, y, size, pal);
    y += size + 14;
    text(s.grid.note, 20, pal.faint, pal.fontUi, 1.5);
  }
  y += 24;
  text(model.appendix.disclaimers[0], 20, pal.faint, pal.fontUi, 1.6);
  text('傳統民俗參考,請勿過度迷信。', 20, pal.faint, pal.fontUi, 1.6);
  return y + M;
}

function renderReportCanvas(model) {
  const W = 1080;
  const pal = imagePalette();
  const probe = document.createElement('canvas');
  probe.width = 4;
  probe.height = 4;
  const height = Math.ceil(paintReportImage(probe.getContext('2d'), W, model, pal));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.min(height, 8000);
  const c2 = canvas.getContext('2d');
  paintReportImage(c2, W, model, pal);
  return canvas;
}

async function saveReportImage(model, ctx) {
  const canvas = renderReportCanvas(model);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob 沒有回傳圖片');
  const file = new File([blob], '風水報告.png', { type: 'image/png' });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '風水報告' });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 使用者自己取消
      // 其他分享失敗就改用下載
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: '風水報告.png' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  ctx.toast('圖片已下載');
}

// ─────────────────────────── DOM ───────────────────────────

function cardList(cards, limit = Infinity) {
  const main = [];
  const rest = [];
  cards.forEach((c, i) => (i < limit || c.level === 'caution' ? main : rest).push(c));
  return h('div', { class: 'v-report-cards' },
    main.map((c) => renderInfoCard(c)),
    rest.length
      ? h('details', { class: 'v-card-more v-report-restwrap' },
        h('summary', null, `其餘 ${rest.length} 則說明`),
        h('div', { class: 'v-report-cards' }, rest.map((c) => renderInfoCard(c))))
      : null);
}

function starTable(rows) {
  return h('ul', { class: 'v-report-stars' }, rows.map((r) => h('li', { class: r.good ? 'is-good' : 'is-plain' },
    h('span', { class: 'v-report-dir' }, dirText(r.dir)),
    h('span', { class: 'v-report-star' }, r.star),
    h('span', { class: 'v-report-starmark' }, r.good ? '吉位' : '需留意'))));
}

function bazhaiEl(b) {
  return h('div', { class: 'v-report-bazhai' },
    h('div', { class: 'v-report-sub' },
      h('h3', { class: 'v-card-head' }, `房子:${b.house.name}(${b.house.group})`),
      h('p', { class: 'sub' }, `${b.house.basis}下面是這間房子八個方位的分類,標「吉位」的傳統上視為吉。`),
      starTable(b.house.rows)),
    b.residents.map((r) => h('div', { class: 'v-report-sub' },
      h('h3', { class: 'v-card-head' }, `${r.name}:${r.gua}(${r.group})`,
        h('span', { class: r.matches ? 'badge badge--good' : 'badge badge--info' }, r.matches ? '命宅相配' : '命宅不配')),
      starTable(r.rows),
      h('dl', { class: 'kv v-report-uses' }, r.uses.map((u) => h('div', null,
        h('dt', null, u.label),
        h('dd', null,
          u.good ? h('div', null, h('span', { class: 'badge badge--good' }, '適合'), ` ${u.good}`) : null,
          u.bad ? h('div', null, h('span', { class: 'badge badge--warn' }, '避開'), ` ${u.bad}`) : null)))))));
}

function sectionBody(s, ctx) {
  const parts = [];
  parts.push(h('p', { class: 'sub v-report-hint' }, s.hint));
  if (s.bazhai) parts.push(bazhaiEl(s.bazhai));
  if (s.needResidents) {
    parts.push(h('div', { class: 'callout' },
      h('span', null, '還沒有住戶資料。填了住戶,這裡會補上你的命卦與床頭、書桌、灶口的吉方。'),
      ' ',
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.go('house') }, '去填住戶')));
  }
  if (s.grid) parts.push(renderStarGrid(s.grid));
  if (s.needYear) {
    parts.push(h('div', { class: 'callout' },
      h('span', null, '填上建成年份後才能排出玄空盤與九宮星盤圖。'),
      ' ',
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.go('house') }, '去填建成年份')));
  }
  if (s.cards.length) parts.push(cardList(s.cards, s.limit));
  return parts;
}

function errorView(ctx) {
  return h('section', { class: 'card warn' },
    h('h2', { class: 'card-title' }, '暫時算不出報告'),
    h('p', null, '目前填的資料算不出結果,可能有哪個欄位不太對。資料沒有遺失,請回到住宅或平面圖檢查一下。'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('house') }, '檢查住宅資料'),
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('plan') }, '檢查平面圖')));
}

function noFacingView(ctx) {
  return h('section', { class: 'card wealth v-report-empty' },
    h('div', { class: 'empty' },
      h('span', { class: 'icon', html: ctx.icons.doc }),
      h('h2', { class: 'card-lead' }, '先量出你家的朝向'),
      h('p', null, '完整報告要先知道房子朝哪個方向。量好之後,這裡會整理出你家的坐向、八宅、財位、玄空星盤與今年要留意的方位。'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.go('compass') }, '去量朝向')));
}

function showTextPanel(ctx, text) {
  const area = h('textarea', { class: 'v-report-textarea', readonly: true, rows: 12, 'aria-label': '文字報告(可全選複製)' });
  area.value = text;
  const sheet = ctx.openSheet({
    title: '複製文字報告',
    content: h('div', { class: 'stack' },
      h('p', { class: 'sub' }, '這台裝置不讓 App 直接複製,請按「全選」後,用長按或鍵盤複製。'),
      area,
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { area.focus(); area.select(); area.scrollTop = 0; } }, '全選')),
  });
  setTimeout(() => { try { area.focus(); area.select(); area.scrollTop = 0; } catch { /* 忽略 */ } }, 50);
  return sheet;
}

export async function mount(root, ctx) {
  let destroyed = false;
  let lastReport;
  let busy = false;
  const openIds = new Set(['overview']);
  const view = h('div', { class: 'stack v-report' });
  root.append(view);
  const add = (...nodes) => { for (const n of nodes) if (n) view.append(n); };

  function collapsible(id, title, body, { count = null, note = null } = {}) {
    const d = h('details', { class: 'card v-report-sec', open: openIds.has(id) ? true : null, dataset: { sec: id } },
      h('summary', { class: 'v-report-sum' },
        h('span', { class: 'v-report-sumt' }, title),
        count ? h('span', { class: 'badge' }, count) : null,
        note ? h('span', { class: badgeClass(note) }, note) : null,
        h('span', { class: 'v-report-chev', html: ctx.icons.chevron })),
      h('div', { class: 'v-report-secbody' }, body));
    d.addEventListener('toggle', () => { if (d.open) openIds.add(id); else openIds.delete(id); });
    return d;
  }

  async function onCopy(model) {
    const text = zhPunct(buildPlainReport(model));
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      ctx.toast('已複製文字報告');
    } catch {
      showTextPanel(ctx, text);
    }
  }

  async function onImage(model, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      await saveReportImage(model, ctx);
    } catch (e) {
      console.error('report image', e);
      ctx.toast('圖片存不下來,請再試一次,或改用「複製文字報告」');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  function render() {
    if (destroyed) return;
    clear(view);
    const state = ctx.store.get();
    const report = safeReport(ctx.store);
    lastReport = report;
    let model;
    try {
      const page = report && !report.error ? renderReport(report) : null;
      model = buildReportModel(state, report, page);
    } catch (e) {
      console.error('report', e);
      add(errorView(ctx));
      return;
    }
    if (model.status === 'no-facing') { add(noFacingView(ctx)); return; }
    if (model.status === 'error') { if (report && report.error) console.error('report', report.error); add(errorView(ctx)); return; }

    const imgBtn = h('button', { class: 'btn', type: 'button' }, h('span', { html: ctx.icons.image }), '存成圖片');
    imgBtn.addEventListener('click', () => onImage(model, imgBtn));
    add(h('div', { class: 'row v-report-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => onCopy(model) }, h('span', { html: ctx.icons.copy }), '複製文字報告'),
      imgBtn));

    // 總覽:先一段白話摘要 + 三個重點,其餘段落收進「更多說明」,第一屏不變成一整面文字牆
    const [lead, ...restParas] = model.overview.paragraphs;
    add(collapsible('overview', '總覽',
      [
        lead ? h('div', { class: 'v-report-summary' }, h('p', null, lead)) : null,
        h('ul', { class: 'v-report-points' }, model.overview.points.map((p) => h('li', null,
          h('span', { class: 'v-report-pl' }, p.label),
          h('span', { class: 'v-report-pv kai' }, p.value),
          h('span', { class: 'sub' }, p.sub)))),
        restParas.length
          ? h('details', { class: 'v-report-more disclosure' },
            h('summary', null, `更多說明(${restParas.length} 段)`),
            h('div', { class: 'v-report-summary' }, restParas.map((p) => h('p', null, p))))
          : null,
      ]));
    for (const s of model.sections) {
      const has = s.cards.length > 0 || s.grid || s.bazhai || s.needYear || s.needResidents;
      if (!has) continue;
      const cautions = s.cards.filter((c) => c.level === 'caution').length;
      add(collapsible(s.id, s.title, sectionBody(s, ctx), {
        count: s.cards.length ? `${s.cards.length} 則` : null,
        note: cautions ? '需要留意' : null,
      }));
    }

    const ap = model.appendix;
    add(collapsible('appendix', '附錄:採用的設定、資料來源與免責', [
      h('h3', { class: 'v-card-head' }, '這次採用的設定'),
      h('dl', { class: 'kv v-report-settings' }, ap.settings.rows.map((r) => h('div', null, h('dt', null, r.label), h('dd', null, r.value)))),
      ap.settings.others > 0 ? h('p', { class: 'sub' }, `另有 ${ap.settings.others} 項進階流派選項與預設不同,可在設定裡查看。`) : h('p', { class: 'sub' }, '其他進階流派選項都是預設值。'),
      h('h3', { class: 'v-card-head' }, '資料來源'),
      h('ul', { class: 'v-report-list' }, ap.sources.map((t) => h('li', null, t))),
    ]));
    add(h('section', { class: 'v-report-disclaimers', 'aria-label': '免責聲明' },
      h('h2', { class: 'section-title' }, '免責聲明'),
      ap.disclaimers.map((d) => h('p', { class: 'faint' }, d))));
  }

  const unsub = ctx.store.subscribe(() => {
    if (destroyed) return;
    const r = safeReport(ctx.store);
    if (r === lastReport && r && !r.error) return;
    render();
  });
  render();
  return {
    destroy() {
      destroyed = true;
      unsub();
    },
  };
}

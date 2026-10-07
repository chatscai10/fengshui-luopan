// 平面圖的圖層資料:把 HouseReport 整理成「每個方位扇區要塗什麼顏色、寫什麼字」與底部面板的內容。
// 只做整理與分級,不編風水結論:文字一律來自報告欄位或 renderReport 的卡片。
// 純函式,不碰 DOM。

import { GUA, DIR8 } from '../../core/geo.js';
import { FURNITURE_LABEL } from './labels.js';

export const STAR_NAME = Object.freeze({ 1: '一白', 2: '二黑', 3: '三碧', 4: '四綠', 5: '五黃', 6: '六白', 7: '七赤', 8: '八白', 9: '九紫' });

/** 家具種類的白話名(取標籤主名,去掉括號說明) */
export function furnitureKindLabel(kind) {
  const raw = FURNITURE_LABEL[kind] || '家具';
  return raw.split(/[ (（]/)[0];
}

const GOOD_BAZHAI = Object.freeze(['生氣', '延年', '天醫', '伏位']);

/** 圖層清單。id 存在 store.ui.layer;label 是畫面上的字 */
export const LAYERS = Object.freeze([
  { id: 'wealth', label: '財位', hint: '比較八個方位的財星條件(只是這個家內部的相對比較)。金色「財」是候選的財位位置。' },
  { id: 'bazhai', label: '八宅', hint: '依大門朝向排出的八個方位好壞(遊年八星)。' },
  { id: 'xuankong', label: '玄空', hint: '玄空盤每個方位的山星與向星。' },
  { id: 'annual', label: '流年', hint: '今年飛到各方位的星,五黃與二黑要留意。' },
  { id: 'none', label: '無', hint: '只看方位,不上色。' },
]);

export const LAYER_IDS = Object.freeze(LAYERS.map((l) => l.id));

export function normalizeLayer(id) {
  return LAYER_IDS.includes(id) ? id : 'wealth';
}

const isObj = (v) => v !== null && typeof v === 'object';

/** 卦名 → 方位名(坎 → 北) */
export const dirOfGua = (gua) => DIR8[GUA.indexOf(gua)] || '';

/** 「震·東」 */
export function sectorTag(gua) {
  const k = GUA.indexOf(gua);
  const d = DIR8[k] || '';
  return `${gua}·${d}`;
}

/** 文字說明用的「震宮(東方)」 */
export function sectorName(gua) {
  return `${gua}宮(${dirOfGua(gua)}方)`;
}

const NEUTRAL = { tone: 'neutral', label: '' };

/**
 * 一個圖層的八宮上色資料。
 * @returns {{ok:boolean, note:string|null, cells:Object<string,{tone:'good'|'neutral'|'warn', label:string}>}}
 *   ok=false 表示這一層現在算不出來,note 是白話原因;cells 一律有八宮(算不出來時全是中性、無字)。
 */
export function layerCells(report, layerId) {
  const blank = () => Object.fromEntries(GUA.map((g) => [g, { ...NEUTRAL }]));
  if (!isObj(report) || report.error) return { ok: false, note: null, cells: blank() };
  const id = normalizeLayer(layerId);
  const cells = blank();

  if (id === 'none') return { ok: true, note: null, cells };

  if (id === 'wealth') {
    const secs = report.wealth && report.wealth.sectors;
    if (!isObj(secs)) return { ok: false, note: null, cells };
    const energies = GUA.map((g) => (secs[g] && Number.isFinite(secs[g].energy) ? secs[g].energy : null));
    if (energies.some((e) => e === null)) return { ok: false, note: null, cells };
    const max = Math.max(...energies);
    const min = Math.min(...energies);
    if (max - min < 1) {
      GUA.forEach((g) => { cells[g] = { tone: 'neutral', label: '一般' }; });
    } else {
      const order = GUA.map((g, i) => ({ g, e: energies[i] })).sort((a, b) => b.e - a.e);
      order.forEach((o, rank) => {
        cells[o.g] = rank < 3 ? { tone: 'good', label: '較強' } : rank >= 6 ? { tone: 'warn', label: '較弱' } : { tone: 'neutral', label: '一般' };
      });
    }
    return { ok: true, note: null, cells };
  }

  if (id === 'bazhai') {
    const stars = report.bazhai && report.bazhai.house && report.bazhai.house.stars;
    if (!isObj(stars)) return { ok: false, note: null, cells };
    GUA.forEach((g, k) => {
      const s = stars[DIR8[k]];
      if (typeof s === 'string') cells[g] = { tone: GOOD_BAZHAI.includes(s) ? 'good' : 'warn', label: s };
    });
    return { ok: true, note: null, cells };
  }

  if (id === 'xuankong') {
    const chart = report.xuankong && report.xuankong.chart;
    const qi = report.xuankong && report.xuankong.qi && report.xuankong.qi.byPalace;
    if (!chart || !isObj(chart.palaces)) {
      return { ok: false, note: '填了建成年份才排得出玄空盤,請到「住宅」分頁填寫。', cells };
    }
    GUA.forEach((g) => {
      const p = chart.palaces[g];
      if (!p) return;
      const q = qi && qi[g];
      const score = q && q.shan && q.xiang ? Number(q.shan.score) + Number(q.xiang.score) : 0;
      const tone = score >= 2.5 ? 'good' : score <= -2.5 ? 'warn' : 'neutral';
      cells[g] = { tone, label: `山${p.shan} 向${p.xiang}` };
    });
    return { ok: true, note: null, cells };
  }

  if (id === 'annual') {
    const an = report.annual && report.annual.annual;
    if (!an || !isObj(an.chartByGua)) return { ok: false, note: null, cells };
    const wealthByGua = new Map();
    for (const w of (report.annual.wealthStars || (report.wealth && report.wealth.layers && report.wealth.layers.annual && report.wealth.layers.annual.wealthStars) || [])) {
      if (w && Number(w.value) >= 0.6) wealthByGua.set(w.gua, w.name);
    }
    GUA.forEach((g) => {
      const n = an.chartByGua[g];
      if (!Number.isFinite(n)) return;
      const bad = n === 5 || n === 2;
      cells[g] = { tone: bad ? 'warn' : wealthByGua.has(g) ? 'good' : 'neutral', label: STAR_NAME[n] || '' };
    });
    return { ok: true, note: null, cells };
  }
  return { ok: false, note: null, cells };
}

/** 財位候選標記(給畫布畫金色「財」)。只取「較適合」「可以考慮」與明財位。 */
export function wealthMarkers(report) {
  if (!isObj(report) || report.error || !report.summary || !report.wealth) return [];
  const cands = Array.isArray(report.wealth.candidates) ? report.wealth.candidates : [];
  const out = [];
  for (const e of report.summary.wealthTop || []) {
    if (!e || e.kind === 'dark') continue;
    const c = cands.find((x) => x.id === e.id);
    if (!c || !Array.isArray(c.point)) continue;
    out.push({ id: c.id, point: [c.point[0], c.point[1]], tier: e.tier || 'consider', isMing: !!c.isMingCai, sector: c.sector || null });
  }
  return out;
}

const tierPhrase = (tone) => (tone === 'good' ? '傳統上視為吉位' : '傳統上屬需要留意的位置');

/**
 * 點某個方位後,底部面板要顯示的內容。
 * @param {object} report analyzeHouse 的結果
 * @param {object|null} rendered renderReport(report) 的結果(可為 null)
 * @param {string} gua 卦名
 * @param {{palaces?:object, roomNames?:Map<string,string>, layerId?:string}} ctx
 */
export function sectorDetails(report, rendered, gua, { palaces = null, roomNames = new Map(), layerId = 'wealth', furniture = null } = {}) {
  const k = GUA.indexOf(gua);
  const out = { gua, title: sectorName(gua), rooms: [], lines: [], cards: [], furniture: [] };
  if (k < 0 || !isObj(report) || report.error) return out;

  // 這個方位落在哪些房間
  const list = palaces && Array.isArray(palaces[gua]) ? palaces[gua] : [];
  // 只擦到邊的房間(不到 2% 或不到 0.05 ㎡)列出來只會讓人困惑,略過
  out.rooms = list
    .filter((e) => e.pct >= 0.02 && e.area >= 0.05)
    .slice(0, 6)
    .map((e) => ({ name: roomNames.get(e.roomId) || '房間', pct: e.pct, area: e.area }));

  const dir = DIR8[k];
  const secs = report.wealth && report.wealth.sectors && report.wealth.sectors[gua];
  const names = new Map(((report.bazhai && report.bazhai.residents) || []).map((r) => [r.id, r.name]));

  // 八宅
  const house = report.bazhai && report.bazhai.house && report.bazhai.house.stars && report.bazhai.house.stars[dir];
  if (house) {
    out.lines.push({ layer: 'bazhai', label: '八宅(依大門朝向)', text: `這一方是「${house}」,${tierPhrase(GOOD_BAZHAI.includes(house) ? 'good' : 'warn')}`, tone: GOOD_BAZHAI.includes(house) ? 'good' : 'warn' });
  }
  if (secs && secs.stars && isObj(secs.stars.people)) {
    for (const [pid, star] of Object.entries(secs.stars.people)) {
      out.lines.push({ layer: 'bazhai', label: `${names.get(pid) || '住戶'}的命卦`, text: `這一方是「${star}」,${tierPhrase(GOOD_BAZHAI.includes(star) ? 'good' : 'warn')}`, tone: GOOD_BAZHAI.includes(star) ? 'good' : 'warn' });
    }
  }

  // 玄空
  const chart = report.xuankong && report.xuankong.chart;
  if (chart && chart.palaces && chart.palaces[gua]) {
    const p = chart.palaces[gua];
    const q = report.xuankong.qi && report.xuankong.qi.byPalace && report.xuankong.qi.byPalace[gua];
    const part = (name, n, info) => `${name}${STAR_NAME[n] || n}${info && info.label ? `(${info.label})` : ''}`;
    out.lines.push({
      layer: 'xuankong',
      label: '玄空',
      text: `${part('山星', p.shan, q && q.shan)}、${part('向星', p.xiang, q && q.xiang)}、${part('運星', p.yun, q && q.yun)}`,
      tone: layerCells(report, 'xuankong').cells[gua].tone,
    });
  } else {
    out.lines.push({ layer: 'xuankong', label: '玄空', text: '填了建成年份才排得出玄空盤', tone: 'neutral' });
  }

  // 流年
  const an = report.annual && report.annual.annual;
  if (an && an.chartByGua && Number.isFinite(an.chartByGua[gua])) {
    const n = an.chartByGua[gua];
    const extra = n === 5 || n === 2 ? '(需要留意,宜靜不宜動)' : '';
    const tags = [];
    const ts = report.annual.taisui;
    if (ts && ts.gua === gua) tags.push('太歲方');
    if (ts && ts.suipoGua === gua) tags.push('歲破方');
    const ss = report.annual.sansha;
    if (ss && ss.dir === dir) tags.push('三煞方');
    out.lines.push({
      layer: 'annual',
      label: '流年',
      text: `今年飛到這一方的星是${STAR_NAME[n]}${extra}${tags.length ? `;今年這一方也是${tags.join('、')}` : ''}`,
      tone: layerCells(report, 'annual').cells[gua].tone,
    });
  }

  // 財位
  const wc = layerCells(report, 'wealth');
  if (wc.ok && wc.cells[gua].label) {
    out.lines.push({ layer: 'wealth', label: '財位', text: `在你家八個方位裡,財星條件算「${wc.cells[gua].label}」(只是這個家內部的相對比較)`, tone: wc.cells[gua].tone });
  }

  // 家具:落在這個方位的有哪些(由呼叫端傳入診斷清單)
  if (Array.isArray(furniture) && furniture.length) {
    const here = furniture.filter((f) => f && f.gua === gua);
    if (here.length) {
      out.lines.push({
        layer: 'furniture',
        label: '家具擺設',
        text: `這個方位有 ${here.length} 件家具:${here.map((f) => `${furnitureKindLabel(f.kind)}${f.cautions && f.cautions.length ? '(需留意)' : ''}`).join('、')}`,
        tone: here.some((f) => f.cautions && f.cautions.length) ? 'warn' : 'neutral',
      });
      out.furniture = here;
    }
  }

  // 卡片:這個方位的候選財位卡 + 玄空各宮卡(標題以「X宮(」開頭)
  if (rendered && Array.isArray(rendered.sections)) {
    const candIds = new Set(((report.wealth && report.wealth.candidates) || []).filter((c) => c.sector === gua).map((c) => `card.wealth.${c.id}`));
    for (const sec of rendered.sections) {
      for (const c of sec.cards || []) {
        const headline = String(c.headline || '');
        if (candIds.has(c.id)) out.cards.push({ layer: 'wealth', card: c });
        else if (headline.startsWith(`${gua}宮(`)) out.cards.push({ layer: 'xuankong', card: c });
      }
    }
  }
  out.layerId = layerId;
  return out;
}

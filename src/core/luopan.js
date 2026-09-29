// 羅盤盤面: 環資料、版面、配色與對比、字集、弧形文字角度、拖曳角度展開與慣性、即時讀數。
// 純函式、無 DOM、無 Canvas、無全域狀態。依據 docs/DOMAIN_SPEC.md 2.8 與決策 D56-D64、附錄 A.7 與 B.6。
// 幾何真源是 geo.js: 24 山、八卦、洛書、卦爻、元龍、陰陽一律從那裡取,這裡不重複實作(規格 2.8.1)。
import { DEFAULT_SETTINGS, resolveSettings } from './settings.js';
import {
  GUA, DIR8, LUOSHU, GUA_WUXING, GUA_LINES, XIANTIAN_OF_SLOT, MOUNTAINS,
  normalizeBearing, mountainAt, sitFromFacing, analyzeBearing, boundaryOptsFromSettings, dirOfGua, oppositeOf,
} from './geo.js';
import * as D from './luopan/data.js';

/**
 * 錯誤碼(message 以碼開頭,後接冒號;非有限方位角沿用 geo 的 INVALID_BEARING):
 *  INVALID_BEARING  方位角不是有限數字(geo.normalizeBearing)
 *  INVALID_ANGLE    盤角、拖曳角度、角速度不是有限數字(規格沒列,自訂)
 *  INVALID_POINT    指標座標或時間不是有限數字(規格沒列,自訂)
 *  INVALID_OPTION   選項名稱或值不合法(版面模式、半徑、字級、glyphUp、scheme、count…)
 *  INVALID_COLOR    不是 #RRGGBB 色碼(規格沒列,自訂)
 *  UNKNOWN_RING     沒有這個環 id(規格沒列,自訂)
 *  RING_NOT_CELLED  該環沒有格子(天池、刻度環)(規格沒列,自訂)
 *  UNKNOWN_XIU_GROUP 不認得的四象名(規格沒列,自訂)
 *  UNKNOWN_MOUNTAIN / UNKNOWN_GUA 沿用 geo 的查表錯誤碼
 *  INTERNAL         環資料的不變式被破壞(正常不會發生,出現代表資料表有錯)
 */

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mod360 = (x) => ((x % 360) + 360) % 360;
const round4 = (x) => Math.round(x * 1e4) / 1e4;
const RAD = Math.PI / 180;

function deepFreeze(v) {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** 依 codepoint 排序並去重的字串。 */
function sortGlyphs(s) {
  return [...new Set(s)].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
}

// ─────────────────────────── 環的格子(共通) ───────────────────────────

/**
 * 由起點與寬度算出一格的起迄與中心。起點正規化到 [0,360),迄點落在 (0,360],跨 0 度的格 end < start。
 * 寬度限二進位可精確表示的數(15、45、3、5.625、30),端點才不會有浮點雜訊。
 */
function span(startDeg, widthDeg) {
  const start = mod360(startDeg);
  const sum = start + widthDeg;
  return { startDeg: start, endDeg: sum > 360 ? sum - 360 : sum, centerDeg: mod360(start + widthDeg / 2), widthDeg };
}

/** 已知起迄、且不跨 0 度的格(28 宿的寬度不是二進位小數,起迄由累加值直接給)。 */
function spanBetween(startDeg, endDeg) {
  return { startDeg, endDeg, centerDeg: startDeg + (endDeg - startDeg) / 2, widthDeg: endDeg - startDeg };
}

/** 半開區間 [起,迄) 是否含已正規化的方位角;起 > 迄表示跨 0 度。 */
function cellContains(cell, nb) {
  return cell.startDeg < cell.endDeg ? nb >= cell.startDeg && nb < cell.endDeg : nb >= cell.startDeg || nb < cell.endDeg;
}

function findCell(cells, nb, ringId) {
  const hit = cells.find((cell) => cellContains(cell, nb));
  if (hit === undefined) fail('INTERNAL', `${ringId} 沒有涵蓋 ${nb} 度的格子`);
  return hit;
}

// ─────────────────────────── 24 山與相關環 ───────────────────────────

const SANHE_YANG = new Set([...D.SANHE_YANG_MOUNTAINS]);
const MARK_SHAPE = { 地支: 'circle', 天干: 'diamond', 四維卦: 'square' };
/** 三元龍色帶對應的色票 token(天元 gold_300、地元 jade、人元 terracotta;傳統只分陰陽兩色,三色是 App 自訂輔助,可關)。 */
export const DRAGON_BAND_TOKEN = deepFreeze({ 天元: 'gold_300', 地元: 'jade', 人元: 'terracotta' });

const MOUNTAIN_CELLS = MOUNTAINS.map((m) => ({
  index: m.index,
  name: m.name,
  gua: m.gua,
  dir8: dirOfGua(m.gua),
  dragon: m.dragon,
  // 兩套陰陽並存(D56): 三元龍(預設,玄空與八宅用)與三合紅黑字,圖例要分開說明
  yinyangSanyuan: m.yinyang,
  yinyangSanhe: SANHE_YANG.has(m.name) ? '陽' : '陰',
  wuxing: m.wuxing,
  wuxingPalace: GUA_WUXING[m.gua],
  kind: m.kind,
  opposite: oppositeOf(m.name),
  ...span(m.centerDeg - 7.5, 15),
}));

const YUAN_BAND_CELLS = MOUNTAIN_CELLS.map((c) => ({
  index: c.index,
  name: c.name,
  dragon: c.dragon,
  yinyangSanyuan: c.yinyangSanyuan,
  yinyangSanhe: c.yinyangSanhe,
  kind: c.kind,
  markShape: MARK_SHAPE[c.kind],
  bandToken: DRAGON_BAND_TOKEN[c.dragon],
  startDeg: c.startDeg,
  endDeg: c.endDeg,
  centerDeg: c.centerDeg,
  widthDeg: c.widthDeg,
}));

/** 節氣環: 冬至=子,格與 24 山逐格對齊。longitudeDeg 是該節氣的太陽視黃經(冬至 270 度,每格 +15)。 */
const SOLAR_CELLS = D.SOLAR_TERMS.map((term, i) => ({
  index: i,
  term,
  chars: [...term],
  mountain: MOUNTAINS[i].name,
  longitudeDeg: (270 + 15 * i) % 360,
  ...span(15 * i - 7.5, 15),
}));

/** 人盤中針(子中心 -7.5)與天盤縫針(子中心 +7.5): 整圈轉半格的 24 山複製環(規格 2.1.4、2.8.1)。 */
const REN_CELLS = MOUNTAINS.map((m) => ({ index: m.index, name: m.name, plate: 'ren', ...span(m.centerDeg - 15, 15) }));
const TIAN_CELLS = MOUNTAINS.map((m) => ({ index: m.index, name: m.name, plate: 'tian', ...span(m.centerDeg, 15) }));

// ─────────────────────────── 八卦、洛書 ───────────────────────────

const BAGUA_CELLS = GUA.map((gua, k) => {
  const start = 45 * k - 22.5;
  const xiantian = XIANTIAN_OF_SLOT[gua];
  return {
    index: k,
    gua,
    dir8: DIR8[k],
    luoshu: LUOSHU[gua],
    wuxing: GUA_WUXING[gua],
    nineStarColor: D.NINE_STAR_COLORS[LUOSHU[gua]],
    linesHoutian: [...GUA_LINES[gua]],
    // 傳統盤把先天卦爻畫在後天卦名的位置(S19);預設不用,初學者才不會被先天爻誤導(規格 2.8.2)
    xiantian: { gua: xiantian, lines: [...GUA_LINES[xiantian]] },
    // 卦爻用 Canvas 三條線畫,不依賴 Unicode 卦符(舊 Android 字型缺字),碼位只作備援
    unicode: `U+${(0x2630 + [...D.XIANTIAN_ORDER].indexOf(gua)).toString(16).toUpperCase()}`,
    mountains: MOUNTAINS.filter((m) => m.gua === gua)
      .sort((a, b) => mod360(a.centerDeg - mod360(start)) - mod360(b.centerDeg - mod360(start)))
      .map((m) => m.name),
    ...span(start, 45),
  };
});

const LUOSHU_CELLS = GUA.map((gua, k) => ({
  index: k,
  gua,
  dir8: DIR8[k],
  luoshu: LUOSHU[gua],
  wuxing: GUA_WUXING[gua],
  nineStarColor: D.NINE_STAR_COLORS[LUOSHU[gua]],
  ...span(45 * k - 22.5, 45),
}));

// ─────────────────────────── 二十八宿(開禧宿度) ───────────────────────────

/** 古度 365.25 縮進 360 度的比例(D57)。 */
export const XIU_SCALE = 360 / 365.25;
/** 28 宿古度寬合計。 */
export const XIU_TOTAL_GU = 365.25;

const XIU_ASTRO_NAMES = [...D.XIU_NAMES];
/** 子中心 0 度 = 虛、危之間;虛起於 0 度,方位角增加的方向宿序倒著走(規格 2.8.3,最容易畫反的地方)。 */
const XIU_BEARING_ORDER = Array.from({ length: 28 }, (_, k) => (XIU_ASTRO_NAMES.indexOf('虛') - k + 28) % 28);

const XIU_CELLS = (() => {
  let acc = 0;
  return XIU_BEARING_ORDER.map((ai, pos) => {
    const startGu = acc;
    acc += D.XIU_WIDTHS_GU[ai];
    const startDeg = startGu * XIU_SCALE;
    const endDeg = pos === 27 ? 360 : acc * XIU_SCALE; // 最後一格直接收在 360,避免累加的浮點殘差
    const name = XIU_ASTRO_NAMES[ai];
    const qiyao = D.XIU_QIYAO[ai % 7];
    return {
      index: pos,
      astroIndex: ai,
      name,
      animal: `${name}${qiyao}${D.XIU_CREATURES[ai]}`,
      qiyao,
      widthGu: D.XIU_WIDTHS_GU[ai],
      startGu,
      endGu: acc,
      ...spanBetween(startDeg, endDeg),
      // 28 宿與 24 山沒有標準對應,以計算結果為準;點宿名時同時顯示所在山(規格 2.8.3)
      mountainAtCenter: mountainAt(startDeg + (endDeg - startDeg) / 2).name,
    };
  });
})();

/** 28 宿名,天文序(角起軫終),字串。 */
export const XIU_NAMES = D.XIU_NAMES;
/** 古度寬,與 XIU_NAMES 同序,number[28]。 */
export const XIU_WIDTHS_GU = deepFreeze([...D.XIU_WIDTHS_GU]);
/** 「宿 + 七曜 + 獸」名(如 角木蛟),與 XIU_NAMES 同序,string[28]。 */
export const XIU_ANIMALS = deepFreeze(XIU_ASTRO_NAMES.map((n) => XIU_CELLS.find((c) => c.name === n).animal));
/** 四象 → 七宿(天文序字串)。 @type {Readonly<Record<string, string>>} */
export const XIU_GROUPS = deepFreeze({ ...D.XIU_GROUPS });

// ─────────────────────────── 一百二十分金(只做即時讀數,D58) ───────────────────────────

const BRANCH_ORDER = '子丑寅卯辰巳午未申酉戌亥';

/** 八干四維山沿用前一位地支的分金。此規則只有 163.com HJT97HRR 一個來源明說,信心: 低(LP-4、LP-9)。 */
function branchOfMountain(i) {
  let j = i;
  while (MOUNTAINS[j].kind !== '地支') j = (j + 23) % 24;
  return MOUNTAINS[j].name;
}

const FENJIN_CELLS = Array.from({ length: 120 }, (_, n) => {
  const mi = Math.floor(n / 5);
  const slot = n % 5;
  const branch = branchOfMountain(mi);
  const yang = BRANCH_ORDER.indexOf(branch) % 2 === 0; // 陽支(子寅辰午申戌)甲丙戊庚壬,陰支乙丁己辛癸
  const stem = (yang ? '甲丙戊庚壬' : '乙丁己辛癸')[slot];
  const isBranchMountain = MOUNTAINS[mi].kind === '地支';
  return {
    index: n,
    name: `${stem}${branch}`,
    stem,
    branch,
    mountain: MOUNTAINS[mi].name,
    slot,
    wangxiang: '丙丁庚辛'.includes(stem),
    confidence: isBranchMountain ? 'high' : 'low',
    // D58: UI 只顯示地支山的分金,四維/八干山不顯示,直到找到第二個來源
    displayable: isBranchMountain,
    ...span(352.5 + 3 * n, 3), // 環從壬|子縫(352.5)起,每格 3 度
  };
});

// ─────────────────────────── 六十四卦(預設不放,D59) ───────────────────────────

/** 圓圖序 k 對應的角度: 乾盡午中,前 32 卦自 180 向東(方位角遞減)排到子中,後 32 卦向西。錨點單源,信心: 低。 */
const HEXAGRAM_CELLS = D.HEXAGRAM_NAMES.map((name, k) => {
  const lower = D.XIANTIAN_ORDER[k >> 3];
  const upper = D.XIANTIAN_ORDER[k & 7];
  return {
    index: k,
    name,
    lower,
    upper,
    lines: [...GUA_LINES[lower], ...GUA_LINES[upper]],
    confidence: 'low',
    ...span(k <= 31 ? 180 - 5.625 * (k + 1) : 180 + 5.625 * (k - 32), 5.625),
  };
});
/** 64 卦名,先天圓圖序(index = 圓圖序 0..63,不是方位序),string[64]。預設不放(D59)。 */
export const HEXAGRAM_NAMES = deepFreeze([...D.HEXAGRAM_NAMES]);

// ─────────────────────────── 十二地支、天干、刻度 ───────────────────────────

/** 12 地支各占 30 度,中心在 30·k。 */
export const BRANCH_CELLS = deepFreeze([...BRANCH_ORDER].map((branch, k) => ({ branch, ...span(30 * k - 15, 30) })));
/** 8 天干在 24 山中的中心(戊己居中宮,不入 24 山)。 */
export const STEM_CENTERS = deepFreeze(Object.fromEntries(MOUNTAINS.filter((m) => m.kind === '天干').map((m) => [m.name, m.centerDeg])));

/**
 * 刻度種類: 每 30 度標數字('label')、每 10 度長線('long')、每 5 度中線('mid')、其餘 1 度細線('thin')(規格 2.8.6)。
 * @param {number} deg 整數度
 * @returns {'label'|'long'|'mid'|'thin'}
 * @throws {Error} INVALID_OPTION 不是整數
 */
export function scaleTickKind(deg) {
  if (!Number.isInteger(deg)) fail('INVALID_OPTION', `刻度度數必須是整數: ${show(deg)}`);
  const d = mod360(deg);
  if (d % 30 === 0) return 'label';
  if (d % 10 === 0) return 'long';
  if (d % 5 === 0) return 'mid';
  return 'thin';
}
/** 360 條刻度,{deg, kind, label}: kind 依 scaleTickKind,label 只有每 30 度有數字字串,其餘 null。 */
export const SCALE_TICKS = deepFreeze(Array.from({ length: 360 }, (_, deg) => {
  const kind = scaleTickKind(deg);
  return { deg, kind, label: kind === 'label' ? String(deg) : null };
}));

/** 24 節氣名,與 24 山同序(冬至=子起順時針),string[24]。 */
export const SOLAR_TERMS = deepFreeze([...D.SOLAR_TERMS]);
/** 九星色: 洛書數 1..9 → 色名(一白二黑三碧四綠五黃六白七赤八白九紫,單源,信心: 中)。 */
export const NINE_STAR_COLORS = deepFreeze({ ...D.NINE_STAR_COLORS });

// ─────────────────────────── RINGS ───────────────────────────

/**
 * @typedef {Object} RingCell 環上的一格,起迄為半開區間 [startDeg,endDeg),跨 0 度的格 startDeg > endDeg,endDeg 落在 (0,360]。
 * @property {number} startDeg
 * @property {number} endDeg
 * @property {number} centerDeg
 * @property {number} widthDeg
 *
 * @typedef {Object} Ring
 * @property {string} id 環的語意 id(tianchi、bagua、luoshu、mountains24、yuan_band、solar_terms、ren_plate、tian_plate、xiu28、scale360、fenjin120、hexagram64)
 * @property {string} label 環名(版面表使用)
 * @property {'center'|'cells'|'ticks'} kind
 * @property {boolean} defaultVisible 預設是否進版面(三針只在模式 B、分金只做讀數、64 卦預設不放)
 * @property {boolean} [auxiliary] 輔助帶(三元龍色帶),不是傳統環
 * @property {'high'|'medium'|'low'} confidence
 * @property {RingCell[]} [cells] 多數環依方位順序(子起順時針);hexagram64 是圓圖序(前 32 卦方位遞減),要依方位查請用 cellAt
 */

/** 盤面環資料,天池最內。各環的格子與 24 山逐格對齊或依規則產生,全部凍結。 @type {ReadonlyArray<Ring>} */
export const RINGS = deepFreeze([
  { id: 'tianchi', label: '天池', kind: 'center', defaultVisible: true, confidence: 'high' },
  { id: 'bagua', label: '八卦(後天卦爻+卦名;可切先天爻)', kind: 'cells', defaultVisible: true, confidence: 'high', cells: BAGUA_CELLS },
  {
    id: 'luoshu',
    label: '洛書數+五行',
    kind: 'cells',
    defaultVisible: true,
    confidence: 'high',
    center: { gua: '中', dir8: '中', luoshu: 5, wuxing: '土', nineStarColor: D.NINE_STAR_COLORS[5] },
    cells: LUOSHU_CELLS,
  },
  { id: 'mountains24', label: '二十四山(地盤正針)', kind: 'cells', defaultVisible: true, confidence: 'high', cells: MOUNTAIN_CELLS },
  { id: 'yuan_band', label: '三元龍/陰陽帶', kind: 'cells', defaultVisible: true, auxiliary: true, confidence: 'high', cells: YUAN_BAND_CELLS },
  { id: 'solar_terms', label: '二十四節氣(太陽到山)', kind: 'cells', defaultVisible: true, confidence: 'medium', cells: SOLAR_CELLS },
  { id: 'ren_plate', label: '人盤中針', kind: 'cells', defaultVisible: false, confidence: 'medium', cells: REN_CELLS },
  { id: 'tian_plate', label: '天盤縫針', kind: 'cells', defaultVisible: false, confidence: 'medium', cells: TIAN_CELLS },
  { id: 'xiu28', label: '二十八宿', kind: 'cells', defaultVisible: true, confidence: 'medium', cells: XIU_CELLS },
  {
    id: 'scale360',
    label: '三百六十度刻度',
    kind: 'ticks',
    defaultVisible: true,
    confidence: 'high',
    ticks: { thinDeg: 1, midDeg: 5, longDeg: 10, labelEveryDeg: 30 },
  },
  { id: 'fenjin120', label: '一百二十分金', kind: 'cells', defaultVisible: false, readoutOnly: true, confidence: 'medium', cells: FENJIN_CELLS },
  { id: 'hexagram64', label: '六十四卦(先天圓圖序)', kind: 'cells', defaultVisible: false, confidence: 'low', cells: HEXAGRAM_CELLS },
]);

/**
 * 依 id 取環。
 * @param {string} id
 * @returns {Ring}
 * @throws {Error} UNKNOWN_RING
 */
export function ringById(id) {
  const ring = RINGS.find((r) => r.id === id);
  if (ring === undefined) fail('UNKNOWN_RING', show(id));
  return ring;
}

/**
 * 方位角落在某環的哪一格(半開區間,恰在界線歸順時針下一格)。
 * @param {string} ringId 有格子的環 id
 * @param {number} bearing 度,任意有限實數
 * @returns {RingCell}
 * @throws {Error} UNKNOWN_RING, RING_NOT_CELLED, INVALID_BEARING
 */
export function cellAt(ringId, bearing) {
  const ring = ringById(ringId);
  if (ring.kind !== 'cells') fail('RING_NOT_CELLED', `${ringId} 沒有格子`);
  return findCell(ring.cells, normalizeBearing(bearing), ringId);
}

// ─────────────────────────── 24 山陰陽、空亡線、卦畫法 ───────────────────────────

const YINYANG_SCHEMES = Object.freeze(['sanyuan', 'sanhe']);

/**
 * 山的陰陽。scheme='sanyuan' 為三元龍陰陽(D56 預設,玄空與八宅用),'sanhe' 為三合紅(陽)黑(陰)字。
 * @param {string} name 山名
 * @param {'sanyuan'|'sanhe'} [scheme] 預設取 settings.yinyangScheme
 * @returns {'陰'|'陽'}
 * @throws {Error} UNKNOWN_MOUNTAIN, INVALID_OPTION
 */
export function yinyangOf(name, scheme = DEFAULT_SETTINGS.yinyangScheme) {
  if (!YINYANG_SCHEMES.includes(scheme)) fail('INVALID_OPTION', `yinyangScheme 不認得: ${show(scheme)}`);
  const cell = MOUNTAIN_CELLS.find((c) => c.name === name);
  if (cell === undefined) fail('UNKNOWN_MOUNTAIN', show(name));
  return scheme === 'sanhe' ? cell.yinyangSanhe : cell.yinyangSanyuan;
}

/**
 * 大空亡線(八卦交界,8 條)與小空亡線(宮內山界,16 條)的方位角,由 24 山的卦歸屬推得(S24、S18,信心: 中)。
 * @returns {{da: number[], xiao: number[]}} 各自由小到大排序
 */
export function kongwangBoundaries() {
  const da = [];
  const xiao = [];
  for (let i = 0; i < 24; i += 1) {
    const at = 15 * i + 7.5;
    (MOUNTAINS[i].gua !== MOUNTAINS[(i + 1) % 24].gua ? da : xiao).push(at);
  }
  return { da, xiao };
}

/**
 * 八卦格的畫法: 預設「後天卦爻 + 後天卦名」;traditional=true 為傳統盤式(先天爻畫在後天卦名的位置)。
 * @param {string} gua 後天卦名(格所在的宮)
 * @param {{traditional?: boolean}} [opts]
 * @returns {{name: string, lines: number[], mode: 'houtian'|'traditional'}} lines 由初爻到上爻,1=陽
 * @throws {Error} UNKNOWN_GUA
 */
export function baguaDrawSpec(gua, { traditional = false } = {}) {
  const cell = BAGUA_CELLS.find((c) => c.gua === gua);
  if (cell === undefined) fail('UNKNOWN_GUA', show(gua));
  return traditional
    ? { name: gua, lines: [...cell.xiantian.lines], mode: 'traditional' }
    : { name: gua, lines: [...cell.linesHoutian], mode: 'houtian' };
}

// ─────────────────────────── 各環的查詢 ───────────────────────────

/**
 * 方位角落在哪一宿,並回傳入宿度(從該宿天文起點,即方位角較大的那端算起的古度,午中 = 張 2.125)。
 * @param {number} bearing 度
 * @returns {RingCell & {name: string, animal: string, qiyao: string, widthGu: number, mountainAtCenter: string, ruSuGu: number}}
 * @throws {Error} INVALID_BEARING
 */
export function xiuAt(bearing) {
  const nb = normalizeBearing(bearing);
  const cell = findCell(XIU_CELLS, nb, 'xiu28');
  return { ...cell, ruSuGu: cell.endGu - nb / XIU_SCALE };
}

/**
 * 四象一組七宿的跨度中心(方位角)。北方玄武跨 0 度,故以「跨度起點 + 半個跨度」計。
 * @param {string} group 東方青龍/北方玄武/西方白虎/南方朱雀
 * @returns {number} [0,360)
 * @throws {Error} UNKNOWN_XIU_GROUP
 */
export function xiuGroupCenterDeg(group) {
  if (!Object.prototype.hasOwnProperty.call(D.XIU_GROUPS, group)) fail('UNKNOWN_XIU_GROUP', show(group));
  const members = new Set([...D.XIU_GROUPS[group]]);
  const inGroup = XIU_CELLS.map((c) => members.has(c.name));
  const first = inGroup.findIndex((v, i) => v && !inGroup[(i + 27) % 28]);
  const width = XIU_CELLS.filter((c, i) => inGroup[i]).reduce((acc, c) => acc + c.widthDeg, 0);
  return mod360(XIU_CELLS[first].startDeg + width / 2);
}

/**
 * 一百二十分金格(每山 5 格 × 3 度)。八干四維山的格 confidence='low'、displayable=false(D58)。
 * @param {number} bearing 度
 * @returns {Readonly<RingCell & {index: number, name: string, mountain: string, slot: number, wangxiang: boolean, confidence: 'high'|'low', displayable: boolean}>}
 * @throws {Error} INVALID_BEARING
 */
export function fenjinAt(bearing) {
  const m = mountainAt(bearing); // 山由 geo 判定,格號 = floor((dev+7.5)/3)(規格 2.1.8)
  return FENJIN_CELLS[m.index * 5 + Math.min(4, Math.floor((m.dev + 7.5) / 3))];
}

/**
 * 六十四卦圓圖序的格。k = b<180 ? 31-floor(b/5.625) : 32+floor((b-180)/5.625)。錨點單源,信心: 低,預設不放。
 * @param {number} bearing 度
 * @returns {Readonly<RingCell & {index: number, name: string, lower: string, upper: string, lines: number[], confidence: 'low'}>}
 * @throws {Error} INVALID_BEARING
 */
export function hexagramAt(bearing) {
  const nb = normalizeBearing(bearing);
  return HEXAGRAM_CELLS[nb < 180 ? 31 - Math.floor(nb / 5.625) : 32 + Math.floor((nb - 180) / 5.625)];
}

/**
 * 節氣環: 方位角所在的節氣(與地盤 24 山逐格對齊)。
 * @param {number} bearing 度
 * @returns {{index: number, term: string, mountain: string, longitudeDeg: number}}
 * @throws {Error} INVALID_BEARING
 */
export function solarTermAt(bearing) {
  const c = SOLAR_CELLS[mountainAt(bearing).index];
  return { index: c.index, term: c.term, mountain: c.mountain, longitudeDeg: c.longitudeDeg };
}

/**
 * 十二地支的 30 度格(子 345 到 15)。
 * @param {number} bearing 度
 * @returns {{branch: string, startDeg: number, endDeg: number, centerDeg: number, widthDeg: number}}
 * @throws {Error} INVALID_BEARING
 */
export function branchCellAt(bearing) {
  return findCell(BRANCH_CELLS, normalizeBearing(bearing), 'branches12');
}

// ─────────────────────────── 配色與對比度(規格 2.8.7) ───────────────────────────

/** 色票(規格 2.8.7,含 D64 的新五行色): token → #RRGGBB。 */
export const PALETTE = deepFreeze({ ...D.PALETTE });
/** 舊五行色(不合格反例,不要用於盤面)。 */
export const LEGACY_WUXING_COLORS = deepFreeze({ ...D.LEGACY_WUXING_COLORS });
/** CSS font-family 堆疊,楷體優先(規格 2.8.9)。 */
export const KAI_FONT_STACK = D.KAI_FONT_STACK;
/**
 * 疊層線條(規格 2.8.8、2.8.9): 天心十道(不轉動的十字線)與天池底的海底線都用 cinnabar_500(#D0342A);
 * 海底線從中心到北端,北端兩側各一個紅點。紅色只留給這兩者與指針南端。
 */
export const OVERLAY_STYLE = deepFreeze({
  tianxin: { colorToken: 'cinnabar_500', widthPx: 1, rotates: false },
  haidi: { colorToken: 'cinnabar_500', widthPx: 1.2, dotRadiusPx: 1.6, dotCount: 2, from: 'center', to: 'north' },
});
/** 磁針慣例(D61): 羅盤紅頭指南、黑頭指北(預設,天池旁小字標「北」);「現代慣例」與一般指北針相同,紅頭指北。 */
export const NEEDLE_CONVENTIONS = deepFreeze({
  luopan: { redEnd: 'south', blackEnd: 'north' },
  modern: { redEnd: 'north', blackEnd: 'south' },
});
/** 天池旁標示北的小字,避免初學者誤讀羅盤的紅南黑北。 */
export const NEEDLE_NORTH_LABEL = '北';
/** 一般文字最低對比度(WCAG 2.x AA)。13px 粗體不算大字,不能放寬到 3:1。 */
export const TEXT_MIN_CONTRAST = 4.5;
const WUXING_TOKEN = { 木: 'wx_wood', 火: 'wx_fire', 土: 'wx_earth', 金: 'wx_metal', 水: 'wx_water' };

function parseHex(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) fail('INVALID_COLOR', `必須是 #RRGGBB: ${show(hex)}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

/**
 * WCAG 2.x 相對亮度。
 * @param {string} hex #RRGGBB
 * @returns {number} 0(黑)到 1(白)
 * @throws {Error} INVALID_COLOR
 */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 前景與底色的對比度((亮+0.05)/(暗+0.05)),對稱。
 * @param {string} fgHex #RRGGBB
 * @param {string} bgHex #RRGGBB
 * @returns {number} 1 到 21
 * @throws {Error} INVALID_COLOR
 */
export function contrastRatio(fgHex, bgHex) {
  const a = relativeLuminance(fgHex);
  const b = relativeLuminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * 五行 → 小圓點與洛書數字的顏色(只用於小面積,不用於大面積)。
 * @param {'木'|'火'|'土'|'金'|'水'} wuxing
 * @returns {string} #RRGGBB
 * @throws {Error} INVALID_OPTION
 */
export function wuxingColor(wuxing) {
  if (!Object.prototype.hasOwnProperty.call(WUXING_TOKEN, wuxing)) fail('INVALID_OPTION', `五行不認得: ${show(wuxing)}`);
  return PALETTE[WUXING_TOKEN[wuxing]];
}

/**
 * 24 山格配色: 陽 = 金底(gold_500)+ 朱紅字(cinnabar_800,5.39);陰 = 漆黑底(lacquer_800)+ 亮金字(gold_300,11.74)。
 * 格底本身有深淺差異,不只靠顏色分辨。
 * @param {'陰'|'陽'} yinyang
 * @returns {{bgToken: string, fgToken: string, bg: string, fg: string}}
 * @throws {Error} INVALID_OPTION
 */
export function mountainCellStyle(yinyang) {
  let bgToken;
  let fgToken;
  if (yinyang === '陽') [bgToken, fgToken] = ['gold_500', 'cinnabar_800'];
  else if (yinyang === '陰') [bgToken, fgToken] = ['lacquer_800', 'gold_300'];
  else fail('INVALID_OPTION', `陰陽必須是 '陰' 或 '陽': ${show(yinyang)}`);
  return { bgToken, fgToken, bg: PALETTE[bgToken], fg: PALETTE[fgToken] };
}

// ─────────────────────────── 字集(規格 2.8.9、附錄 B.6) ───────────────────────────

const CORE_SOURCES = [
  '0123456789°',
  MOUNTAINS.map((m) => m.name).join(''),
  GUA.join(''),
  D.XIU_NAMES,
  D.SOLAR_TERMS.join(''),
  D.UI_GLYPHS,
  D.LEGACY_CORE_EXTRA,
  D.READOUT_GLYPHS,
];

/** core 字集: 預設盤面與讀數列用字,120 字(原 117 字表補 山、宮、朝)。 */
export const CHARSET_CORE = sortGlyphs(CORE_SOURCES.join(''));
/** 洛書環顯示九星色名時才需要的字(色名扣掉 core 已有的字,如「白」)。 */
export const CHARSET_NINE_STAR_COLORS = sortGlyphs([...Object.values(D.NINE_STAR_COLORS).join('')].filter((ch) => !CHARSET_CORE.includes(ch)).join(''));
/** UI 環名用字。 */
export const CHARSET_RING_NAMES = sortGlyphs(D.RING_NAME_GLYPHS);

/**
 * 子集字型字集 = core ∪(九星色字,若顯示)∪ 環名字;scope='full' 再加 64 卦名、分金名、動物名、太少半。
 * 「嵌入子集字型」與「UI 字走系統字型」二擇一必須在建置前決定(規格 2.8.9),這裡是嵌入方案的字表。
 * @param {{scope?: 'core'|'full', nineStarColors?: boolean, ringNames?: boolean}} [opts] 預設 core、不含九星色字、含環名字
 * @returns {string} 依 codepoint 排序、不重複
 * @throws {Error} INVALID_OPTION
 */
export function fontSubsetCharset({ scope = 'core', nineStarColors = false, ringNames = true } = {}) {
  if (scope !== 'core' && scope !== 'full') fail('INVALID_OPTION', `scope 必須是 core 或 full: ${show(scope)}`);
  let s = CHARSET_CORE;
  if (scope === 'full') {
    s += D.HEXAGRAM_NAMES.join('') + FENJIN_CELLS.map((c) => c.name).join('') + XIU_ANIMALS.join('') + D.FULL_EXTRA_GLYPHS;
  }
  if (nineStarColors) s += CHARSET_NINE_STAR_COLORS;
  if (ringNames) s += CHARSET_RING_NAMES;
  return sortGlyphs(s);
}

// ─────────────────────────── 版面(規格 2.8.6) ───────────────────────────

/** 模式 A 各環權重(原設計寬度);r5 節氣環固定 0.125R(LP-2),其餘等比縮小到外緣 0.985。r4 是輔助色帶。 */
const LAYOUT_A_ROWS = [
  { key: 'tianchi', ringId: 'tianchi', weight: 0.2 },
  { key: 'r1', ringId: 'bagua', weight: 0.2 },
  { key: 'r2', ringId: 'luoshu', weight: 0.08 },
  { key: 'r3', ringId: 'mountains24', weight: 0.18 },
  { key: 'r4', ringId: 'yuan_band', weight: 0.03 },
  { key: 'r5', ringId: 'solar_terms', fixed: 0.125 },
  { key: 'r6', ringId: 'xiu28', weight: 0.14 },
  { key: 'r7', ringId: 'scale360', weight: 0.085 },
];
const LAYOUT_A_OUTER = 0.985;
/** 模式 B(三合模式,人盤+天盤取代節氣環)維持原配置,寬度以 1e-4 R 為單位的整數存放,外緣 0.986。 */
const LAYOUT_B_ROWS = [
  { key: 'tianchi', ringId: 'tianchi', units: 1869 },
  { key: 'r1', ringId: 'bagua', units: 1869 },
  { key: 'r2', ringId: 'luoshu', units: 748 },
  { key: 'r3', ringId: 'mountains24', units: 1682 },
  { key: 'r4', ringId: 'yuan_band', units: 281 },
  { key: 'r5a', ringId: 'ren_plate', units: 654 },
  { key: 'r5b', ringId: 'tian_plate', units: 654 },
  { key: 'r6', ringId: 'xiu28', units: 1308 },
  { key: 'r7', ringId: 'scale360', units: 795 },
];

/** 字級建議(360px 盤,R=180): 卦名 15 粗、洛書 13 粗、24 山 21 粗、節氣 10.5(2 字徑向堆疊)、人盤/天盤 10、28 宿 14(窄者 9)、刻度 9.5。 */
const GLYPH_SPEC = {
  r1: { px: 15, bold: true, stackChars: 1 },
  r2: { px: 13, bold: true, stackChars: 1 },
  r3: { px: 21, bold: true, stackChars: 1 },
  r5: { px: 10.5, bold: false, stackChars: 2 },
  r5a: { px: 10, bold: false, stackChars: 1 },
  r5b: { px: 10, bold: false, stackChars: 1 },
  r6: { px: 14, bold: false, stackChars: 1, narrowPx: 9 },
  r7: { px: 9.5, bold: false, stackChars: 1 },
};
/** stack() 的字距 = 1.02 × 字級(規格 2.8.8)。 */
const STACK_SPACING = 1.02;

/** 各環的 [r0, r1](比例),r0 由前一環的 r1 承接,保證相接無縫。 */
function layoutRatios(mode) {
  const out = [];
  let prev = 0;
  if (mode === 'A') {
    const fixed = LAYOUT_A_ROWS.reduce((a, r) => a + (r.fixed ?? 0), 0);
    const flex = LAYOUT_A_ROWS.reduce((a, r) => a + (r.weight ?? 0), 0);
    const scale = (LAYOUT_A_OUTER - fixed) / flex;
    let acc = 0;
    LAYOUT_A_ROWS.forEach((row, i) => {
      acc += row.fixed ?? row.weight * scale;
      const r1 = i === LAYOUT_A_ROWS.length - 1 ? LAYOUT_A_OUTER : round4(acc);
      out.push([prev, r1]);
      prev = r1;
    });
  } else {
    let units = 0;
    for (const row of LAYOUT_B_ROWS) {
      units += row.units;
      const r1 = units / 1e4;
      out.push([prev, r1]);
      prev = r1;
    }
  }
  return out;
}

/**
 * 手機版環配置(≤ 9 環,可讀性優先)。半徑為相對外半徑 R 的比例,像素數字統一以 R=180(360px 盤半寬)計。
 * @param {'A'|'B'} [mode='A'] A = 含節氣環(預設,D62);B = 三合模式(人盤+天盤取代節氣環)
 * @param {{R?: number}} [opts] R 為盤面外半徑(px),預設 180
 * @returns {{mode: string, R: number, outer: number,
 *   rows: Array<{key: string, ringId: string, label: string, r0: number, r1: number, widthPx: number, midPx: number, auxiliary: boolean,
 *   glyph: null|{px: number, bold: boolean, stackChars: number, narrowPx?: number}}>,
 *   meta: {schema: string, ruleset: {layoutMode: string}}}}
 * @throws {Error} INVALID_OPTION
 */
export function layoutRings(mode = 'A', { R = 180 } = {}) {
  if (mode !== 'A' && mode !== 'B') fail('INVALID_OPTION', `版面模式必須是 'A' 或 'B': ${show(mode)}`);
  if (!isNum(R) || R <= 0) fail('INVALID_OPTION', `R 必須是正的有限數字: ${show(R)}`);
  const specs = mode === 'A' ? LAYOUT_A_ROWS : LAYOUT_B_ROWS;
  const ratios = layoutRatios(mode);
  const rows = specs.map((spec, i) => {
    const ring = ringById(spec.ringId);
    const [r0, r1] = ratios[i];
    return {
      key: spec.key,
      ringId: spec.ringId,
      label: ring.label,
      r0,
      r1,
      widthPx: (r1 - r0) * R,
      midPx: ((r0 + r1) / 2) * R,
      auxiliary: ring.auxiliary === true,
      glyph: GLYPH_SPEC[spec.key] ? { ...GLYPH_SPEC[spec.key] } : null,
    };
  });
  return {
    mode,
    R,
    outer: rows[rows.length - 1].r1,
    rows,
    meta: { schema: 'fengshui.luopan.layout/1', ruleset: { layoutMode: mode } },
  };
}

/**
 * 依設定選版面模式。設定裡沒有專屬的版面鍵,這裡借用 showSanZhen(三針=人盤+天盤只在三合模式顯示,規格 2.1.4、2.8.6),屬設計推論。
 * @param {object} [overrides] 部分 Settings
 * @returns {'A'|'B'}
 * @throws {Error} 未知設定鍵
 */
export function layoutModeFromSettings(overrides = {}) {
  return resolveSettings(overrides).showSanZhen ? 'B' : 'A';
}

/**
 * n 個字沿半徑堆疊需要的環寬(px): n × 字級 × 1.02(節氣環 2 字 10.5px 需 21.42px)。
 * @param {number} count 字數
 * @param {number} px 字級
 * @param {number} [spacing=1.02]
 * @returns {number}
 */
export function stackHeightPx(count, px, spacing = STACK_SPACING) {
  if (![count, px, spacing].every((v) => isNum(v) && v >= 0)) fail('INVALID_OPTION', `count、px、spacing 必須是非負有限數字: ${show(count)}, ${show(px)}, ${show(spacing)}`);
  return count * px * spacing;
}

/**
 * 版面某一環的字放不放得進環寬。沒有字的環(glyph=null)視為放得下。
 * @param {{widthPx: number, glyph: null|{px: number, stackChars: number}}} row layoutRings 的一列
 * @returns {boolean}
 */
export function glyphFits(row) {
  if (row === null || typeof row !== 'object') fail('INVALID_OPTION', `row 必須是 layoutRings 的一列: ${show(row)}`);
  if (row.glyph === null) return true;
  return stackHeightPx(row.glyph.stackChars, row.glyph.px) <= row.widthPx + 1e-9;
}

// ─────────────────────────── 窄宿可讀性 ───────────────────────────

/** 「偏窄」門檻(度): 介於牛 6.90 與虛 9.12 之間的設計值,使房、心、星、牛落入 9px 字 + 錯位(規格 2.8.3,tag=設計)。 */
export const MANSION_TIGHT_BELOW_DEG = 7;

/**
 * 字寬(或弧長)在半徑 r 處對應的角度: 弧長 = r·θ。
 * @param {number} widthPx 字寬 px
 * @param {number} radiusPx 半徑 px
 * @returns {number} 度
 * @throws {Error} INVALID_OPTION
 */
export function stepDegForWidth(widthPx, radiusPx) {
  if (!isNum(widthPx) || widthPx <= 0 || !isNum(radiusPx) || radiusPx <= 0) {
    fail('INVALID_OPTION', `字寬與半徑必須是正的有限數字: ${show(widthPx)}, ${show(radiusPx)}`);
  }
  return (widthPx / radiusPx) * (180 / Math.PI);
}

/**
 * 一個字在某半徑處至少需要的角寬(同 stepDegForWidth,以字級為寬)。13px 字在 r6 中徑 151.1px 處為 4.93 度。
 * @param {number} glyphPx 字級
 * @param {number} midRadiusPx 中徑
 * @returns {number} 度
 * @throws {Error} INVALID_OPTION
 */
export function minGlyphAngleDeg(glyphPx, midRadiusPx) {
  return stepDegForWidth(glyphPx, midRadiusPx);
}

function r6MidPx() {
  return layoutRings('A').rows.find((r) => r.key === 'r6').midPx;
}

/**
 * 宿寬小於字的最小角寬的宿(放不下,須引線或錯位)。回傳依天文序(角起軫終)。預設 13px 字、模式 A 的 r6 中徑。
 * @param {{glyphPx?: number, midRadiusPx?: number}} [opts]
 * @returns {{glyphPx: number, midRadiusPx: number, minDeg: number, names: string[]}}
 * @throws {Error} INVALID_OPTION
 */
export function narrowMansions({ glyphPx = 13, midRadiusPx = r6MidPx() } = {}) {
  const minDeg = minGlyphAngleDeg(glyphPx, midRadiusPx);
  const names = XIU_ASTRO_NAMES.filter((n) => XIU_CELLS.find((c) => c.name === n).widthDeg < minDeg);
  return { glyphPx, midRadiusPx, minDeg, names };
}

/**
 * 28 宿標籤分級(依環的方位順序): leader = 放不下 13px 字,必須引線或錯位(觜、鬼);
 * tight = 偏窄,9px 字 + 錯位(房、心、星、牛);normal = 14px。
 * @param {{glyphPx?: number, midRadiusPx?: number}} [opts]
 * @returns {Array<{name: string, widthDeg: number, plan: 'leader'|'tight'|'normal'}>}
 * @throws {Error} INVALID_OPTION
 */
export function xiuLabelPlan({ glyphPx = 13, midRadiusPx = r6MidPx() } = {}) {
  const minDeg = minGlyphAngleDeg(glyphPx, midRadiusPx);
  return XIU_CELLS.map((c) => ({
    name: c.name,
    widthDeg: c.widthDeg,
    plan: c.widthDeg < minDeg ? 'leader' : c.widthDeg < MANSION_TIGHT_BELOW_DEG ? 'tight' : 'normal',
  }));
}

// ─────────────────────────── 環序規律 ───────────────────────────

/**
 * 環序共通規律(規格 2.8.1,4 份傳統盤資料交叉,信心: 中高)。傳入由內而外的環語意 id,
 * 沒有的環回傳 null(規律不適用)。版面請先濾掉輔助帶(三元龍色帶不是傳統環);傳統盤的無關環用 'other' 佔位。
 * @param {string[]} ids 由內而外
 * @returns {{tianchiFirst: boolean|null, jieqiAfterDi24: boolean|null, renTianOutsideDi: boolean|null,
 *   xiuOutermost: boolean|null, scaleOutermost: boolean|null}}
 *   tianchiFirst 天池最內;jieqiAfterDi24 節氣環緊貼地盤 24 山外側;renTianOutsideDi 人盤天盤在地盤外;
 *   xiuOutermost 28 宿之外只剩刻度;scaleOutermost 刻度環最外
 * @throws {Error} INVALID_OPTION
 */
export function ringOrderInvariants(ids) {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail('INVALID_OPTION', 'ids 必須是字串陣列');
  const tianchi = ids.indexOf('tianchi');
  const di = ids.lastIndexOf('mountains24');
  const jieqi = ids.indexOf('solar_terms');
  const plates = ['ren_plate', 'tian_plate'].map((id) => ids.indexOf(id)).filter((i) => i >= 0);
  const xiu = ids.indexOf('xiu28');
  const scale = ids.indexOf('scale360');
  return {
    tianchiFirst: tianchi < 0 ? null : tianchi === 0,
    jieqiAfterDi24: jieqi < 0 || di < 0 ? null : jieqi === di + 1,
    renTianOutsideDi: plates.length === 0 || di < 0 ? null : plates.every((i) => i > di),
    xiuOutermost: xiu < 0 ? null : ids.slice(xiu + 1).every((x) => x === 'scale360'),
    scaleOutermost: scale < 0 ? null : scale === ids.length - 1,
  };
}

// ─────────────────────────── 文字沿弧與 Canvas 角度(規格 2.8.1、2.8.8) ───────────────────────────

/**
 * 方位角 → Canvas 角度(弧度): (b-90)·π/180。Canvas 0 = +x 向東,北 = -π/2。不做正規化。
 * @param {number} bearing 度
 * @returns {number}
 * @throws {Error} INVALID_BEARING
 */
export function bearingToCanvasRad(bearing) {
  if (!isNum(bearing)) fail('INVALID_BEARING', `不是有限數字: ${show(bearing)}`);
  return (bearing - 90) * RAD;
}

/**
 * 單字格的位置與旋轉: x = cx + r·sin b、y = cy - r·cos b(y 向下);字頭朝外 rotate(b),朝內再轉 π。
 * rotateRad 落在 [0,2π)。不使用 ctx.letterSpacing(2025-03 才新近可用,舊 WebView 沒有)。
 * @param {{bearing: number, r: number, cx?: number, cy?: number, glyphUp?: 'outward'|'inward'}} p 預設 cx=cy=0、朝外
 * @returns {{x: number, y: number, rotateRad: number}}
 * @throws {Error} INVALID_BEARING, INVALID_OPTION
 */
export function arcGlyphTransform({ bearing, r, cx = 0, cy = 0, glyphUp = 'outward' }) {
  const nb = normalizeBearing(bearing);
  if (!isNum(r) || r < 0) fail('INVALID_OPTION', `r 必須是非負有限數字: ${show(r)}`);
  if (!isNum(cx) || !isNum(cy)) fail('INVALID_OPTION', `cx、cy 必須是有限數字: ${show(cx)}, ${show(cy)}`);
  if (glyphUp !== 'outward' && glyphUp !== 'inward') fail('INVALID_OPTION', `glyphUp 必須是 outward 或 inward: ${show(glyphUp)}`);
  const rad = nb * RAD;
  return {
    x: cx + r * Math.sin(rad),
    y: cy - r * Math.cos(rad),
    rotateRad: (glyphUp === 'inward' ? mod360(nb + 180) : nb) * RAD,
  };
}

/**
 * 多字沿弧時每個字的方位角: b + (i - (n-1)/2)·Δ。字頭朝外時閱讀方向順時針;朝內時反向。
 * @param {{bearing: number, count: number, stepDeg: number, glyphUp?: 'outward'|'inward'}} p
 * @returns {number[]} 各字的方位角,[0,360)
 * @throws {Error} INVALID_BEARING, INVALID_OPTION
 */
export function arcTextBearings({ bearing, count, stepDeg, glyphUp = 'outward' }) {
  const nb = normalizeBearing(bearing);
  if (!Number.isInteger(count) || count < 1) fail('INVALID_OPTION', `count 必須是正整數: ${show(count)}`);
  if (!isNum(stepDeg)) fail('INVALID_OPTION', `stepDeg 必須是有限數字: ${show(stepDeg)}`);
  if (glyphUp !== 'outward' && glyphUp !== 'inward') fail('INVALID_OPTION', `glyphUp 必須是 outward 或 inward: ${show(glyphUp)}`);
  const sign = glyphUp === 'outward' ? 1 : -1;
  return Array.from({ length: count }, (_, i) => normalizeBearing(nb + sign * (i - (count - 1) / 2) * stepDeg));
}

/**
 * 多字沿半徑堆疊(節氣、宿名): 外側字先讀,字距 1.02 × 字級,以 radiusPx 為中心對稱。
 * @param {{count: number, radiusPx: number, px: number, spacing?: number}} p
 * @returns {number[]} 由外而內各字的半徑
 * @throws {Error} INVALID_OPTION
 */
export function stackGlyphRadii({ count, radiusPx, px, spacing = STACK_SPACING }) {
  if (!Number.isInteger(count) || count < 1) fail('INVALID_OPTION', `count 必須是正整數: ${show(count)}`);
  if (!isNum(radiusPx) || !isNum(px) || px <= 0 || !isNum(spacing) || spacing <= 0) {
    fail('INVALID_OPTION', `radiusPx、px、spacing 必須是有限數字(px、spacing > 0): ${show(radiusPx)}, ${show(px)}, ${show(spacing)}`);
  }
  return Array.from({ length: count }, (_, i) => radiusPx + ((count - 1) / 2 - i) * px * spacing);
}

// ─────────────────────────── 手勢: 角度展開、拖曳、慣性(規格 2.8.8) ───────────────────────────

/**
 * 手勢參數(規格 2.8.8): 慣性摩擦時間常數 τ=0.5 秒(總滑行 = ω₀·τ)、角速度 < 0.5°/s 停止、
 * 觸點離圓心 < 0.16R(天池內)不啟動旋轉、放手前超過 80ms 沒移動則角速度歸 0(LP-12)。
 * omegaBlend 是角速度平滑係數 om = (1-α)·om + α·(d/dt·1000)。
 */
export const GESTURE = deepFreeze({
  tauSec: 0.5,
  minOmegaDegPerSec: 0.5,
  deadZoneFrac: 0.16,
  releaseIdleMs: 80,
  omegaBlend: 0.2,
  minDtMs: 1,
});

/**
 * 角度展開: 兩次指標角度之間最短的帶號旋轉量,範圍 [-180,180),即 ((cur-prev+540) mod 360) - 180。
 * @param {number} prevDeg 度
 * @param {number} curDeg 度
 * @returns {number}
 * @throws {Error} INVALID_ANGLE
 */
export function unwrapAngleDelta(prevDeg, curDeg) {
  if (!isNum(prevDeg) || !isNum(curDeg)) fail('INVALID_ANGLE', `角度必須是有限數字: ${show(prevDeg)}, ${show(curDeg)}`);
  // 先各自取餘再相減: 1e308 與 -1e308 直接相減會溢位成 Infinity,再取餘得 NaN(fmod 是精確運算)
  return mod360((curDeg % 360) - (prevDeg % 360) + 540) - 180;
}

function assertPoint(px, py, cx, cy) {
  if (![px, py, cx, cy].every(isNum)) fail('INVALID_POINT', `指標座標必須是有限數字: ${show(px)}, ${show(py)}, ${show(cx)}, ${show(cy)}`);
}

/**
 * 指標繞盤心的角度(度): atan2(dy,dx),Canvas 座標(東 0、南 90、北 -90,y 向下)。
 * @param {number} px 指標 x
 * @param {number} py 指標 y
 * @param {number} cx 盤心 x
 * @param {number} cy 盤心 y
 * @returns {number} (-180,180]
 * @throws {Error} INVALID_POINT
 */
export function pointerAngleDeg(px, py, cx, cy) {
  assertPoint(px, py, cx, cy);
  // + 0 把 -0 收成 0: atan2(-0, 負數) 會得 -π,使 180 度被回報成 -180
  return (Math.atan2(py - cy + 0, px - cx) * 180) / Math.PI;
}

/**
 * 觸點是否落在天池內(離盤心 < 0.16R),此時不啟動旋轉,避免角度雜訊。
 * @param {number} px 指標 x
 * @param {number} py 指標 y
 * @param {number} cx 盤心 x
 * @param {number} cy 盤心 y
 * @param {number} radiusPx 盤面外半徑 R(px)
 * @returns {boolean}
 * @throws {Error} INVALID_POINT, INVALID_OPTION
 */
export function isInDeadZone(px, py, cx, cy, radiusPx) {
  assertPoint(px, py, cx, cy);
  if (!isNum(radiusPx) || radiusPx <= 0) fail('INVALID_OPTION', `radiusPx 必須是正的有限數字: ${show(radiusPx)}`);
  return Math.hypot(px - cx, py - cy) < GESTURE.deadZoneFrac * radiusPx;
}

/**
 * @typedef {Object} DragState
 * @property {number} dialDeg 盤面旋轉角(CSS rotate,度,可累加超過 ±360)
 * @property {boolean} dragging
 * @property {number|null} lastAngleDeg 上一個事件的指標角度
 * @property {number|null} lastT 上一個事件的時間(ms)
 * @property {number} omega 平滑後的角速度(度/秒)
 */

/**
 * 建立拖曳狀態。
 * @param {number} [dialDeg=0] 初始盤角
 * @returns {DragState}
 * @throws {Error} INVALID_ANGLE
 */
export function createDragState(dialDeg = 0) {
  if (!isNum(dialDeg)) fail('INVALID_ANGLE', `盤角必須是有限數字: ${show(dialDeg)}`);
  return { dialDeg: dialDeg + 0, dragging: false, lastAngleDeg: null, lastT: null, omega: 0 };
}

function assertTime(tMs) {
  if (!isNum(tMs)) fail('INVALID_POINT', `時間必須是有限的 ms: ${show(tMs)}`);
}

/**
 * pointerdown: 觸點在天池內不啟動;否則記下指標角度與時間,角速度歸 0。回傳新狀態,不修改傳入的狀態。
 * @param {DragState} state
 * @param {{px: number, py: number, cx: number, cy: number, radiusPx: number, tMs: number}} ev
 * @returns {DragState}
 * @throws {Error} INVALID_POINT, INVALID_OPTION
 */
export function dragStart(state, { px, py, cx, cy, radiusPx, tMs }) {
  assertTime(tMs);
  if (isInDeadZone(px, py, cx, cy, radiusPx)) return { ...state, dragging: false };
  return { ...state, dragging: true, lastAngleDeg: pointerAngleDeg(px, py, cx, cy), lastT: tMs, omega: 0 };
}

/**
 * pointermove: 以展開後的角度差累加盤角,並平滑角速度。未啟動拖曳時原樣回傳(複本)。
 * @param {DragState} state
 * @param {{px: number, py: number, cx: number, cy: number, tMs: number}} ev
 * @returns {DragState}
 * @throws {Error} INVALID_POINT
 */
export function dragMove(state, { px, py, cx, cy, tMs }) {
  assertTime(tMs);
  const angle = pointerAngleDeg(px, py, cx, cy);
  if (!state.dragging) return { ...state };
  const d = unwrapAngleDelta(state.lastAngleDeg, angle);
  const dt = Math.max(GESTURE.minDtMs, tMs - state.lastT);
  const blend = GESTURE.omegaBlend;
  return {
    ...state,
    dialDeg: state.dialDeg + d,
    lastAngleDeg: angle,
    lastT: tMs,
    omega: (1 - blend) * state.omega + blend * ((d / dt) * 1000),
  };
}

/**
 * pointerup / pointercancel: 放手時若距離最後一次移動超過 80ms,角速度歸 0(LP-12: 原碼按住不動再放手仍沿用舊速度,盤面會突然甩出去);
 * prefers-reduced-motion 則不做慣性。
 * @param {DragState} state
 * @param {{tMs: number, reducedMotion?: boolean}} ev
 * @returns {{state: DragState, omega0: number}} omega0 是慣性的初始角速度(度/秒)
 * @throws {Error} INVALID_POINT
 */
export function dragEnd(state, { tMs, reducedMotion = false }) {
  assertTime(tMs);
  const idle = state.dragging ? tMs - state.lastT : Infinity;
  const omega0 = !state.dragging || reducedMotion || idle > GESTURE.releaseIdleMs ? 0 : state.omega;
  return { state: { ...state, dragging: false, lastAngleDeg: null, lastT: null, omega: omega0 }, omega0 };
}

function inertiaOpts({ tau = GESTURE.tauSec, minOmega = GESTURE.minOmegaDegPerSec } = {}) {
  if (!isNum(tau) || tau <= 0) fail('INVALID_OPTION', `tau 必須是正的有限數字: ${show(tau)}`);
  if (!isNum(minOmega) || minOmega < 0) fail('INVALID_OPTION', `minOmega 必須是非負有限數字: ${show(minOmega)}`);
  return { tau, minOmega };
}

/**
 * 慣性單步(指數衰減 ω(t)=ω0·e^(-t/τ),以解析式積分,與幀率無關)。|ω| < 0.5°/s 時 done=true。
 * @param {number} omega 目前角速度(度/秒)
 * @param {number} dtSec 這一幀的時間(秒)
 * @param {{tau?: number, minOmega?: number}} [opts] 預設 τ=0.5、門檻 0.5
 * @returns {{omega: number, deltaDeg: number, done: boolean}} 一步之後的角速度、這一步的轉角、是否該停
 * @throws {Error} INVALID_ANGLE, INVALID_OPTION
 */
export function inertiaStep(omega, dtSec, opts = {}) {
  if (!isNum(omega)) fail('INVALID_ANGLE', `角速度必須是有限數字: ${show(omega)}`);
  if (!isNum(dtSec) || dtSec < 0) fail('INVALID_OPTION', `dtSec 必須是非負有限數字: ${show(dtSec)}`);
  const { tau, minOmega } = inertiaOpts(opts);
  if (Math.abs(omega) < minOmega) return { omega: 0, deltaDeg: 0, done: true };
  const k = Math.exp(-dtSec / tau);
  const next = omega * k;
  // + 0: dtSec=0 時 k=1,負角速度乘 0 會得 -0
  return { omega: next, deltaDeg: omega * tau * (1 - k) + 0, done: Math.abs(next) < minOmega };
}

/**
 * 慣性總滑行角度 = ω0·τ(例: 360°/s 再轉 180°)。
 * @param {number} omega0 度/秒
 * @param {number} [tau=0.5] 秒
 * @returns {number}
 * @throws {Error} INVALID_ANGLE, INVALID_OPTION
 */
export function inertiaTotalDeg(omega0, tau = GESTURE.tauSec) {
  if (!isNum(omega0)) fail('INVALID_ANGLE', `角速度必須是有限數字: ${show(omega0)}`);
  return omega0 * inertiaOpts({ tau }).tau + 0;
}

/**
 * 以固定幀長模擬慣性直到停止(測試與預估用)。總轉角 = τ(ω0 - ω末),與 ω0·τ 差不超過 門檻·τ。
 * @param {number} omega0 度/秒
 * @param {{dtSec?: number, tau?: number, minOmega?: number, maxSteps?: number}} [opts] 預設 1/60 秒
 * @returns {{totalDeg: number, durationSec: number, steps: number, finalOmega: number}}
 * @throws {Error} INVALID_ANGLE, INVALID_OPTION
 */
export function simulateInertia(omega0, { dtSec = 1 / 60, tau, minOmega, maxSteps = 100000 } = {}) {
  if (!isNum(omega0)) fail('INVALID_ANGLE', `角速度必須是有限數字: ${show(omega0)}`);
  if (!isNum(dtSec) || dtSec <= 0) fail('INVALID_OPTION', `dtSec 必須是正的有限數字: ${show(dtSec)}`);
  const opts = inertiaOpts({ tau, minOmega });
  let omega = omega0;
  let total = 0;
  let steps = 0;
  while (Math.abs(omega) >= opts.minOmega && steps < maxSteps) {
    const s = inertiaStep(omega, dtSec, opts);
    total += s.deltaDeg;
    omega = s.omega;
    steps += 1;
  }
  return { totalDeg: total + 0, durationSec: steps * dtSec, steps, finalOmega: omega + 0 };
}

// ─────────────────────────── 盤角與航向、山界觸覺 ───────────────────────────

/**
 * 盤角 → 航向: 「鎖定到磁北」時盤角 = -航向,所以 setAng(-90) 讀到 90 度、setAng(-352.5) 讀到 352.5 度。
 * @param {number} dialDeg 盤面旋轉角(度)
 * @returns {number} [0,360)
 * @throws {Error} INVALID_ANGLE
 */
export function headingFromDialAngle(dialDeg) {
  if (!isNum(dialDeg)) fail('INVALID_ANGLE', `盤角必須是有限數字: ${show(dialDeg)}`);
  return normalizeBearing(0 - dialDeg); // 0 - x 而不是 -x,避免 -0
}

/**
 * 朝目標航向轉的盤角,取離目前盤角最近的那一個(航向 359 → 1 時盤角只變 2 度,不倒轉一圈)。
 * @param {number} currentDialDeg 目前盤角
 * @param {number} headingDeg 目標航向
 * @returns {number}
 * @throws {Error} INVALID_ANGLE, INVALID_BEARING
 */
export function dialAngleToward(currentDialDeg, headingDeg) {
  if (!isNum(headingDeg)) fail('INVALID_BEARING', `不是有限數字: ${show(headingDeg)}`);
  return currentDialDeg + unwrapAngleDelta(currentDialDeg, 0 - headingDeg);
}

/**
 * 整盤的 CSS 旋轉角: southUp(D60,傳統前南後北)是整盤 +180 度的旋轉,不是鏡像。讀數的航向仍由不含 +180 的盤角算出。
 * @param {number} dialDeg 盤角
 * @param {{southUp?: boolean}} [opts] 預設取 settings.southUp
 * @returns {number}
 * @throws {Error} INVALID_ANGLE
 */
export function cssRotationDeg(dialDeg, { southUp = DEFAULT_SETTINGS.southUp } = {}) {
  if (!isNum(dialDeg)) fail('INVALID_ANGLE', `盤角必須是有限數字: ${show(dialDeg)}`);
  return dialDeg + (southUp ? 180 : 0);
}

/**
 * 航向從 from 沿最短弧轉到 to,跨過幾個 15 度山界(山界在 7.5 + 15k,恰在界線歸順時針下一山),供「跨山輕觸覺」用。
 * @param {number} fromDeg 度
 * @param {number} toDeg 度
 * @returns {number} 非負整數
 * @throws {Error} INVALID_BEARING
 */
export function boundaryCrossings(fromDeg, toDeg) {
  if (!isNum(fromDeg) || !isNum(toDeg)) fail('INVALID_BEARING', `不是有限數字: ${show(fromDeg)}, ${show(toDeg)}`);
  const from = normalizeBearing(fromDeg);
  const to = from + unwrapAngleDelta(fromDeg, toDeg);
  return Math.abs(Math.floor((to + 7.5) / 15) - Math.floor((from + 7.5) / 15));
}

// ─────────────────────────── 即時讀數 ───────────────────────────

/** 顯示用的度數: 依 Math.floor(x·10+0.5) 取到 0.1 度(規格 1.3),359.96 進位為 0.0 而不是 360.0。 */
function headingText(b) {
  let tenth = Math.floor(b * 10 + 0.5);
  if (tenth >= 3600) tenth -= 3600;
  return (tenth / 10).toFixed(1);
}

/**
 * 即時讀數列(固定一行文字,aria-live="polite")。資料由 geo.analyzeBearing 提供(規格 2.8.8)。
 * 範例: readout(90).text = 「朝向 90.0° 卯山(震宮/天元) 坐酉」。
 * @param {number} headingDeg 航向(度,任意有限實數)。盤角請先用 headingFromDialAngle 換算
 * @param {object} [overrides] 部分 Settings,讀 xiaGuaHalfWidth、jianLimitSchool、kongwangLabelScheme、measureUncertainty、yinyangScheme、showSanZhen、southUp
 * @returns {{heading: number, text: string, mountain: string, gua: string, dir8: string, dragon: string, yinyang: string,
 *   sitMountain: string, sitBearing: number, zhaiGua: string, solarTerm: string,
 *   xiu: {index: number, name: string, animal: string, qiyao: string, ruSuGu: number, mountainAtCenter: string},
 *   fenjin: {index: number, name: string, mountain: string, slot: number, wangxiang: boolean, confidence: string, displayable: boolean},
 *   sanzhen: null|{di: string, ren: string, tian: string}, analysis: object,
 *   meta: {schema: string, ruleset: object}}}
 *   fenjin.displayable=false(八干四維山)時 UI 不顯示分金(D58);sanzhen 只在 showSanZhen 時有值;analysis 是 geo.analyzeBearing 的完整結果
 * @throws {Error} INVALID_BEARING, INVALID_OPTION, 未知設定鍵
 */
export function readout(headingDeg, overrides = {}) {
  const s = resolveSettings(overrides);
  if (!YINYANG_SCHEMES.includes(s.yinyangScheme)) fail('INVALID_OPTION', `yinyangScheme 不認得: ${show(s.yinyangScheme)}`);
  const b = normalizeBearing(headingDeg) + 0; // + 0 把 -0 收成 0
  const analysis = analyzeBearing(b, boundaryOptsFromSettings(s));
  const sit = sitFromFacing(b);
  const cell = MOUNTAIN_CELLS[analysis.index];
  const xiu = xiuAt(b);
  const fj = fenjinAt(b);
  return {
    heading: b,
    text: `朝向 ${headingText(b)}° ${analysis.mountain}山(${analysis.gua}宮/${cell.dragon}) 坐${sit.sitMountain}`,
    mountain: analysis.mountain,
    gua: analysis.gua,
    dir8: analysis.dir8,
    dragon: cell.dragon,
    yinyang: s.yinyangScheme === 'sanhe' ? cell.yinyangSanhe : cell.yinyangSanyuan,
    sitMountain: sit.sitMountain,
    sitBearing: sit.sitBearing,
    zhaiGua: sit.zhaiGua,
    solarTerm: SOLAR_CELLS[analysis.index].term,
    xiu: { index: xiu.index, name: xiu.name, animal: xiu.animal, qiyao: xiu.qiyao, ruSuGu: xiu.ruSuGu, mountainAtCenter: xiu.mountainAtCenter },
    fenjin: {
      index: fj.index,
      name: fj.name,
      mountain: fj.mountain,
      slot: fj.slot,
      wangxiang: fj.wangxiang,
      confidence: fj.confidence,
      displayable: fj.displayable,
    },
    sanzhen: s.showSanZhen
      ? { di: analysis.mountain, ren: mountainAt(b, 'ren').name, tian: mountainAt(b, 'tian').name }
      : null,
    analysis,
    meta: {
      schema: 'fengshui.luopan.readout/1',
      ruleset: { ...analysis.meta.ruleset, yinyangScheme: s.yinyangScheme, showSanZhen: s.showSanZhen, southUp: s.southUp },
    },
  };
}

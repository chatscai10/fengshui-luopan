// 幾何真源:角度、24 山、8 卦、坐向、兼向與空亡、磁北真北、圓周統計、「向」取法政策。
// 依據 docs/DOMAIN_SPEC.md 2.1;決策編號 D01-D09 見同檔 3.1。其他模組的山、卦、元龍、陰陽一律從這裡取。
import { DEFAULT_SETTINGS, resolveSettings } from './settings.js';

/**
 * 錯誤碼(message 以碼開頭,後接冒號):
 *  INVALID_BEARING 不是有限數字的方位角(規格 2.1.8)
 *  INVALID_READINGS 多次量測的讀數不是非空陣列
 *  INVALID_OPTION 選項名稱或值不合法
 *  INVALID_DECLINATION 磁偏角不是 [-180,180] 的有限數字
 *  INVALID_DATE 日期不是有限的 ms epoch
 *  INVALID_FACING_INPUT pickFacing 的建築類型不明,或大門、採光、大樓正面全部缺
 *  UNKNOWN_MOUNTAIN / UNKNOWN_GUA / UNKNOWN_DIR / UNKNOWN_CITY 查表查不到
 *  NOT_ADJACENT_MOUNTAINS pairTypeOf 的兩山不相鄰
 */

/** 端點含入與浮點雜訊容差。D02:恰好等於門檻歸下卦。 */
const EPS = 1e-9;
/** 山半寬。 */
const HALF_SHAN = 7.5;
/** 純函式 analyzeBearing 的不確定度預設;App 層改傳 measureUncertainty(規格 2.1.7、D05)。 */
const PURE_UNCERTAINTY = 3.0;
/** 騎線寬度(orientation.md 2.4 第 8 點)。 */
const RIDING_LINE_DEG = 0.5;
/** 中州派「兼向中外側最凶」起算度數(xuankong_core.md 2.5)。 */
const OUTER_START_DEG = 6.0;
/** 大門、採光面、大樓正面夾角超過此值即 conflict(規格 2.1.6)。 */
const FACING_CONFLICT_DEG = 45;
/** 八宅提示在不確定度之外的最小提示距離(規格 2.1.3 第 9 點)。 */
const GUA_HINT_MIN_DEG = 3;

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ─────────────────────────── 常數表 ───────────────────────────

/** 八卦順序(後天方位,自北順時針,index k 中心 45k)。 */
export const GUA = Object.freeze(['坎', '艮', '震', '巽', '離', '坤', '兌', '乾']);
/** 與 GUA 一一對應的方位名。 */
export const DIR8 = Object.freeze(['北', '東北', '東', '東南', '南', '西南', '西', '西北']);

/** 洛書數;5 是中宮。順飛宮序見 xuankong_core.md 2.2。 */
export const LUOSHU = Object.freeze({ 坎: 1, 坤: 2, 震: 3, 巽: 4, 中: 5, 乾: 6, 兌: 7, 艮: 8, 離: 9 });
/** 傳統南上格(上方為南,左方為東),各線和 15。 */
export const LUOSHU_GRID_SOUTH_UP = Object.freeze([
  Object.freeze([4, 9, 2]),
  Object.freeze([3, 5, 7]),
  Object.freeze([8, 1, 6]),
]);
/** 八卦五行(說卦傳,luopan_rings.md 3.2)。 */
export const GUA_WUXING = Object.freeze({ 坎: '水', 艮: '土', 震: '木', 巽: '木', 離: '火', 坤: '土', 兌: '金', 乾: '金' });
/** 卦爻,初爻到上爻,1=陽。 */
export const GUA_LINES = Object.freeze({
  乾: Object.freeze([1, 1, 1]),
  兌: Object.freeze([1, 1, 0]),
  離: Object.freeze([1, 0, 1]),
  震: Object.freeze([1, 0, 0]),
  巽: Object.freeze([0, 1, 1]),
  坎: Object.freeze([0, 1, 0]),
  艮: Object.freeze([0, 0, 1]),
  坤: Object.freeze([0, 0, 0]),
});
/** 先天卦位(乾南坤北離東坎西兌東南震東北巽西南艮西北),值為方位角。 */
export const XIANTIAN_BEARING = Object.freeze({ 坤: 0, 震: 45, 離: 90, 兌: 135, 乾: 180, 巽: 225, 坎: 270, 艮: 315 });
/** 傳統盤把先天卦畫在後天卦名的位置:後天卦名 → 該位置的先天卦(luopan_rings.md 3.2)。 */
export const XIANTIAN_OF_SLOT = Object.freeze(
  Object.fromEntries(Object.entries(XIANTIAN_BEARING).map(([g, b]) => [GUA[b / 45], g])),
);

// 欄位: 山, 卦, 元龍, 陰陽, 本五行, 類別。24 山表全專案只此一份(規格 2.1.1)。
// 本五行 = 干支自身五行 + 乾金坤土艮土巽木(36fengshui zs26、luopan_rings.md 3.1)。
const RAW_MOUNTAINS = [
  ['子', '坎', '天元', '陰', '水', '地支'], ['癸', '坎', '人元', '陰', '水', '天干'],
  ['丑', '艮', '地元', '陰', '土', '地支'], ['艮', '艮', '天元', '陽', '土', '四維卦'],
  ['寅', '艮', '人元', '陽', '木', '地支'], ['甲', '震', '地元', '陽', '木', '天干'],
  ['卯', '震', '天元', '陰', '木', '地支'], ['乙', '震', '人元', '陰', '木', '天干'],
  ['辰', '巽', '地元', '陰', '土', '地支'], ['巽', '巽', '天元', '陽', '木', '四維卦'],
  ['巳', '巽', '人元', '陽', '火', '地支'], ['丙', '離', '地元', '陽', '火', '天干'],
  ['午', '離', '天元', '陰', '火', '地支'], ['丁', '離', '人元', '陰', '火', '天干'],
  ['未', '坤', '地元', '陰', '土', '地支'], ['坤', '坤', '天元', '陽', '土', '四維卦'],
  ['申', '坤', '人元', '陽', '金', '地支'], ['庚', '兌', '地元', '陽', '金', '天干'],
  ['酉', '兌', '天元', '陰', '金', '地支'], ['辛', '兌', '人元', '陰', '金', '天干'],
  ['戌', '乾', '地元', '陰', '土', '地支'], ['乾', '乾', '天元', '陽', '金', '四維卦'],
  ['亥', '乾', '人元', '陽', '水', '地支'], ['壬', '坎', '地元', '陽', '水', '天干'],
];

/**
 * 24 山表,index 0=子 順時針,中心 15*index。
 * @type {ReadonlyArray<Readonly<{name:string, gua:string, dragon:string, yinyang:string, index:number, centerDeg:number, wuxing:string, kind:string}>>}
 */
export const MOUNTAINS = Object.freeze(
  RAW_MOUNTAINS.map(([name, gua, dragon, yinyang, wuxing, kind], index) =>
    Object.freeze({ name, gua, dragon, yinyang, index, centerDeg: 15 * index, wuxing, kind }),
  ),
);

const INDEX_OF_NAME = new Map(MOUNTAINS.map((m) => [m.name, m.index]));

/**
 * 兼向限度 LIMITS[pairType] = [okMax, voidAbove](距山中心度數,D03 預設兩段式)。
 * @type {Readonly<Record<'tongxing_yin'|'tongxing_yang'|'yinyang'|'chugua', readonly [number, number]>>}
 */
export const LIMITS = Object.freeze({
  tongxing_yin: Object.freeze([6, 6]),
  tongxing_yang: Object.freeze([7, 7]),
  yinyang: Object.freeze([5, 6]),
  chugua: Object.freeze([5, 6]),
});

// D03:36fengshui zs60 陰陽互兼與出卦皆「不得超過五度」;zggdfs Read_52 說六度。同陰同陽兩來源一致,不動。
const LIMIT_TABLES = Object.freeze({
  default: LIMITS,
  strict5: Object.freeze({ ...LIMITS, yinyang: Object.freeze([5, 5]), chugua: Object.freeze([5, 5]) }),
  zggdfs6: Object.freeze({ ...LIMITS, yinyang: Object.freeze([6, 6]), chugua: Object.freeze([6, 6]) }),
});

/**
 * 依流派開關取兼向限度表。
 * @param {'default'|'strict5'|'zggdfs6'} [school='default'] settings.jianLimitSchool
 * @returns {Readonly<Record<string, readonly [number, number]>>}
 */
export function limitsFor(school = 'default') {
  if (!has(LIMIT_TABLES, school)) fail('INVALID_OPTION', `jianLimitSchool 不認得: ${show(school)}`);
  return LIMIT_TABLES[school];
}

// ─────────────────────────── 小工具 ───────────────────────────

/**
 * 方位角正規化到 [0,360)。
 * @param {number} b 任意有限實數(度)
 * @returns {number}
 * @throws {Error} INVALID_BEARING 非有限數字
 */
export function normalizeBearing(b) {
  if (typeof b !== 'number' || !Number.isFinite(b)) fail('INVALID_BEARING', `不是有限數字: ${show(b)}`);
  // 已在範圍內就原樣回傳,否則 187.4 會因為 +360 再 -360 變成 187.39999999999998。
  // + 0 把 -0 變成 0,否則 JSON 往返與 Object.is 比較會不一致。
  if (b >= 0 && b < 360) return b + 0;
  return ((b % 360) + 360) % 360;
}

/** 有帶號的最短旋轉量 a - b,範圍 [-180,180)。dev 的定義(規格 2.1.3 第 1 點)。 */
function delta(a, b) {
  // 先各自取餘再相減:1e308 與 -1e308 直接相減會溢位成 Infinity,再取餘得 NaN。fmod 是精確運算。
  return (((((a % 360) - (b % 360) + 180) % 360) + 360) % 360) - 180;
}

/**
 * 兩方位的圓周差(絕對值)。359.9999995 與 0 視為相鄰而非相差 360。
 * @param {number} a 度
 * @param {number} b 度
 * @returns {number} [0,180]
 * @throws {Error} INVALID_BEARING
 */
export function circularDiff(a, b) {
  normalizeBearing(a);
  normalizeBearing(b);
  return Math.abs(((((a % 360) - (b % 360)) % 360) + 540) % 360 - 180);
}

/**
 * 有帶號的圓周差:從 b 順時針轉到 a 的最短角度,[-180,180)。
 * @param {number} a 度
 * @param {number} b 度
 * @returns {number}
 * @throws {Error} INVALID_BEARING
 */
export function circularDelta(a, b) {
  normalizeBearing(a);
  normalizeBearing(b);
  return delta(a, b);
}

// ─────────────────────────── 查表 ───────────────────────────

/**
 * 卦名 → 方位名。
 * @param {string} gua 坎艮震巽離坤兌乾
 * @returns {string}
 * @throws {Error} UNKNOWN_GUA
 */
export function dirOfGua(gua) {
  const k = GUA.indexOf(gua);
  if (k < 0) fail('UNKNOWN_GUA', show(gua));
  return DIR8[k];
}

/**
 * 方位名 → 卦名。
 * @param {string} dir 北 東北 東 東南 南 西南 西 西北
 * @returns {string}
 * @throws {Error} UNKNOWN_DIR
 */
export function guaOfDir(dir) {
  const k = DIR8.indexOf(dir);
  if (k < 0) fail('UNKNOWN_DIR', show(dir));
  return GUA[k];
}

/**
 * 洛書數 → 卦名(5 回傳 '中')。
 * @param {number} n 1..9
 * @returns {string}
 * @throws {Error} INVALID_OPTION
 */
export function guaOfLuoshu(n) {
  const hit = Object.keys(LUOSHU).find((g) => LUOSHU[g] === n);
  if (hit === undefined) fail('INVALID_OPTION', `洛書數必須是 1..9 的整數: ${show(n)}`);
  return hit;
}

/**
 * 山名 → index(0=子)。
 * @param {string} name
 * @returns {number}
 * @throws {Error} UNKNOWN_MOUNTAIN
 */
export function mountainIndex(name) {
  const i = INDEX_OF_NAME.get(name);
  if (i === undefined) fail('UNKNOWN_MOUNTAIN', show(name));
  return i;
}

/**
 * 對山(index+12)。同元龍同陰陽(規格 2.4.2)。
 * @param {string} name
 * @returns {string}
 * @throws {Error} UNKNOWN_MOUNTAIN
 */
export function oppositeOf(name) {
  return MOUNTAINS[(mountainIndex(name) + 12) % 24].name;
}

/**
 * 山所屬的卦(宮)。
 * @param {string} name
 * @returns {string}
 * @throws {Error} UNKNOWN_MOUNTAIN
 */
export function guaOfMountain(name) {
  return MOUNTAINS[mountainIndex(name)].gua;
}

/**
 * 山的五行。scheme='own' 用干支本五行(預設),'palace' 用所屬八卦的五行(luopan_rings.md 3.1 兩種分法)。
 * @param {string} name
 * @param {'own'|'palace'} [scheme='own']
 * @returns {string}
 * @throws {Error} UNKNOWN_MOUNTAIN, INVALID_OPTION
 */
export function wuxingOfMountain(name, scheme = 'own') {
  const m = MOUNTAINS[mountainIndex(name)];
  if (scheme === 'own') return m.wuxing;
  if (scheme === 'palace') return GUA_WUXING[m.gua];
  return fail('INVALID_OPTION', `wuxing scheme 不認得: ${show(scheme)}`);
}

/**
 * 相鄰兩山的相兼類型(規格 2.1.1):不同卦=chugua;同卦且含地元=yinyang;同卦天元人元=同陰或同陽。
 * @param {string} a 山名
 * @param {string} b 相鄰山名
 * @returns {'chugua'|'yinyang'|'tongxing_yin'|'tongxing_yang'}
 * @throws {Error} UNKNOWN_MOUNTAIN, NOT_ADJACENT_MOUNTAINS
 */
export function pairTypeOf(a, b) {
  const i = mountainIndex(a);
  const j = mountainIndex(b);
  if ((i - j + 24) % 24 !== 1 && (j - i + 24) % 24 !== 1) fail('NOT_ADJACENT_MOUNTAINS', `${a},${b}`);
  return pairTypeOfIndex(i, j);
}

function pairTypeOfIndex(i, j) {
  const a = MOUNTAINS[i];
  const b = MOUNTAINS[j];
  if (a.gua !== b.gua) return 'chugua';
  if (a.dragon === '地元' || b.dragon === '地元') return 'yinyang';
  return a.yinyang === '陽' ? 'tongxing_yang' : 'tongxing_yin';
}

// ─────────────────────────── 方位 → 山、卦 ───────────────────────────

// 三針(D09、規格 2.1.4):人盤中針子中心 352.5,天盤縫針子中心 7.5;玄空與八宅只用地盤。
const RING_SHIFT = Object.freeze({ earth: 0, ren: -7.5, tian: 7.5 });

function ringIndex(nb, ring) {
  if (ring === 'earth') return Math.floor(((nb + 7.5) % 360) / 15) % 24;
  if (ring === 'ren') return (Math.floor(nb / 15) + 1) % 24;
  return Math.floor(nb / 15) % 24;
}

/** 找山並保證 dev ∈ [-7.5,7.5):浮點在山界 1e-13 內可能讓 floor 公式差一格,這裡以 dev 回頭校正。 */
function locate(nb, ring) {
  const shift = RING_SHIFT[ring];
  let i = ringIndex(nb, ring);
  let dev = delta(nb, 15 * i + shift);
  if (dev >= HALF_SHAN) {
    i = (i + 1) % 24;
    dev = delta(nb, 15 * i + shift);
  } else if (dev < -HALF_SHAN) {
    i = (i + 23) % 24;
    dev = delta(nb, 15 * i + shift);
  }
  return { i, dev, center: (((15 * i + shift) % 360) + 360) % 360 };
}

/**
 * @typedef {Object} MountainInfo
 * @property {string} name 山名
 * @property {number} index 0=子
 * @property {number} centerDeg 該盤此山的中心方位角
 * @property {number} startDeg 起(含),跨 0 的山 startDeg > endDeg
 * @property {number} endDeg 迄(不含)
 * @property {string} gua 所屬八卦
 * @property {string} dir8 方位名
 * @property {string} dragon 天元/地元/人元
 * @property {string} yinyang 陰/陽(三元龍陰陽,D56)
 * @property {string} opposite 對山
 * @property {number} dev 相對該盤山中心的帶號偏差 [-7.5,7.5),正=順時針側
 */

/**
 * 方位角 → 山。半開區間 [起,迄),恰在界線歸順時針下一山(D01)。
 * @param {number} b 度,任意有限實數
 * @param {'earth'|'ren'|'tian'} [ring='earth'] 地盤正針、人盤中針、天盤縫針
 * @returns {MountainInfo}
 * @throws {Error} INVALID_BEARING, INVALID_OPTION
 */
export function mountainAt(b, ring = 'earth') {
  if (!has(RING_SHIFT, ring)) fail('INVALID_OPTION', `ring 不認得: ${show(ring)}`);
  const nb = normalizeBearing(b);
  const { i, dev, center } = locate(nb, ring);
  const m = MOUNTAINS[i];
  return {
    name: m.name,
    index: i,
    centerDeg: center,
    startDeg: (((center - HALF_SHAN) % 360) + 360) % 360,
    endDeg: (((center + HALF_SHAN) % 360) + 360) % 360,
    gua: m.gua,
    dir8: dirOfGua(m.gua),
    dragon: m.dragon,
    yinyang: m.yinyang,
    opposite: MOUNTAINS[(i + 12) % 24].name,
    dev,
  };
}

/**
 * 方位角 → 八卦(45 度分區,坎 337.5-22.5,半開區間)。
 * @param {number} b 度
 * @returns {{gua:string, dir8:string, index:number}}
 * @throws {Error} INVALID_BEARING
 */
export function guaAt(b) {
  const nb = normalizeBearing(b);
  const k = Math.floor(((nb + 22.5) % 360) / 45) % 8;
  return { gua: GUA[k], dir8: DIR8[k], index: k };
}

/**
 * 向 → 坐。坐 = 向 + 180;宅卦(八宅)由坐山所屬的卦決定。
 * 坐山用「向山的對山」而不是再查一次 sitBearing,避免浮點在山界讓兩者差一山。
 * @param {number} facing 面朝外的方位角(度)
 * @returns {{sitBearing:number, facingMountain:string, sitMountain:string, zhaiGua:string, zhaiSitDir:string}}
 * @throws {Error} INVALID_BEARING
 */
export function sitFromFacing(facing) {
  const nb = normalizeBearing(facing);
  const { i } = locate(nb, 'earth');
  const sit = MOUNTAINS[(i + 12) % 24];
  return {
    sitBearing: normalizeBearing(nb + 180),
    facingMountain: MOUNTAINS[i].name,
    sitMountain: sit.name,
    zhaiGua: sit.gua,
    zhaiSitDir: dirOfGua(sit.gua),
  };
}

// ─────────────────────────── 兼向與空亡 ───────────────────────────

const KONGWANG_SCHEMES = Object.freeze(['position', 'degree']);
const ANALYZE_OPT_KEYS = Object.freeze(['threshold', 'uncertainty', 'kongwangLabelScheme', 'jianLimitSchool']);

function resolveAnalyzeOpts(opts) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) fail('INVALID_OPTION', 'opts 必須是物件');
  for (const k of Object.keys(opts)) {
    if (!ANALYZE_OPT_KEYS.includes(k)) fail('INVALID_OPTION', `未知的選項: ${k}`);
  }
  const threshold = opts.threshold ?? DEFAULT_SETTINGS.xiaGuaHalfWidth;
  const uncertainty = opts.uncertainty ?? PURE_UNCERTAINTY;
  const kongwangLabelScheme = opts.kongwangLabelScheme ?? DEFAULT_SETTINGS.kongwangLabelScheme;
  const jianLimitSchool = opts.jianLimitSchool ?? DEFAULT_SETTINGS.jianLimitSchool;
  if (typeof threshold !== 'number' || !(threshold > 0 && threshold < HALF_SHAN)) {
    fail('INVALID_OPTION', `threshold 必須在 (0,7.5): ${show(threshold)}`);
  }
  if (typeof uncertainty !== 'number' || !Number.isFinite(uncertainty) || uncertainty < 0) {
    fail('INVALID_OPTION', `uncertainty 必須是非負有限數字: ${show(uncertainty)}`);
  }
  if (!KONGWANG_SCHEMES.includes(kongwangLabelScheme)) {
    fail('INVALID_OPTION', `kongwangLabelScheme 不認得: ${show(kongwangLabelScheme)}`);
  }
  return { threshold, uncertainty, kongwangLabelScheme, jianLimitSchool, limits: limitsFor(jianLimitSchool) };
}

/**
 * 把 Settings 轉成 analyzeBearing 的選項(App 層用,不確定度取 measureUncertainty 而非純函式的 3.0)。
 * @param {object} [settings] 部分或完整的 Settings
 * @returns {{threshold:number, uncertainty:number, kongwangLabelScheme:string, jianLimitSchool:string}}
 * @throws {Error} 未知設定鍵
 */
export function boundaryOptsFromSettings(settings = {}) {
  const s = resolveSettings(settings ?? {});
  return {
    threshold: s.xiaGuaHalfWidth,
    uncertainty: s.measureUncertainty,
    kongwangLabelScheme: s.kongwangLabelScheme,
    jianLimitSchool: s.jianLimitSchool,
  };
}

const KONGWANG_NOTE = {
  tongxing:
    '山與山交界(位置式)稱小空亡;度數式說法稱此為空向。各派定義不同。',
  position: '大小空亡的定義各派不同,本 App 預設採「卦界=大空亡、山界=小空亡」的說法。',
  degree: '大小空亡的定義各派不同,本 App 依設定採「出卦=大空亡、陰陽差錯=小空亡、同性超限=空向」的說法。',
};

/**
 * @typedef {Object} BearingAnalysis
 * @property {number} bearing 正規化後的輸入
 * @property {string} mountain 所在山(地盤正針)
 * @property {number} index
 * @property {number} dev 相對山中心的帶號偏差,保留正負號(玄空要知道兼哪一側)
 * @property {'zheng'|'jian'} zone |dev| <= threshold 為 zheng(下卦)
 * @property {'zheng'|'jian'|'jian_caution'|'void'} level
 * @property {string|null} leanTo zone=jian 時兼的鄰山
 * @property {'chugua'|'yinyang'|'tongxing_yin'|'tongxing_yang'|null} pairType zone=jian 時的相兼類型
 * @property {string} neighborMountain dev 所偏一側的鄰山(zone=zheng 時也有,leanTo 為 null)
 * @property {string} neighborGua 鄰山所屬的卦
 * @property {number} boundaryDist 到最近山界的度數 = 7.5 - |dev|
 * @property {'gua'|'shan'} boundaryKind
 * @property {'da'|'xiao'|'kongxiang'|null} kongwangKind 依 kongwangLabelScheme 取位置式或度數式
 * @property {'da'|'xiao'|'kongxiang'|null} kongwangKindDegree 度數式標籤
 * @property {string|null} schoolNote 空亡標籤的流派說明
 * @property {boolean} onLine 騎線(距山界 < 0.5 度)
 * @property {boolean} retest boundaryDist < uncertainty
 * @property {boolean} outer1p5 |dev| >= 6(中州派兼向外側 1.5 度),與 level 是兩個旗標
 * @property {boolean} needsTiGua zone=jian 且 pairType 為 yinyang/chugua;同性相兼恆為 false(xuankong 只讀這個)
 * @property {string} gua 所在山的卦
 * @property {string} dir8
 * @property {string} opposite 對山
 * @property {Array<Finding>} findings 八宅接近卦界提示等
 * @property {{schema:string, ruleset:object}} meta
 */

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {'info'|'note'|'caution'} level
 * @property {string} title
 * @property {string} body
 * @property {'high'|'medium'|'low'} confidence
 * @property {'source'|'inference'|'design'|'minority'} tag
 * @property {string|null} schoolNote
 * @property {string[]} refs
 */

/**
 * 判定方位落在哪座山、是下卦還是兼向、有沒有壓線。坐或向皆可(偏差量相同)。
 * @param {number} bearing 度,任意有限實數
 * @param {{threshold?:number, uncertainty?:number, kongwangLabelScheme?:'position'|'degree', jianLimitSchool?:'default'|'strict5'|'zggdfs6'}} [opts]
 *   threshold 下卦半寬,預設 settings.xiaGuaHalfWidth(4.5,D02);uncertainty 預設 3.0(純函式,D05);其餘取 settings 預設
 * @returns {BearingAnalysis}
 * @throws {Error} INVALID_BEARING, INVALID_OPTION
 */
export function analyzeBearing(bearing, opts = {}) {
  const o = resolveAnalyzeOpts(opts);
  const nb = normalizeBearing(bearing);
  const { i, dev } = locate(nb, 'earth');
  const adev = Math.abs(dev);
  const zone = adev <= o.threshold + EPS ? 'zheng' : 'jian';

  const j = dev > 0 ? (i + 1) % 24 : (i + 23) % 24;
  const type = pairTypeOfIndex(i, j);
  const [okMax, voidAbove] = o.limits[type];
  let level;
  if (zone === 'zheng') level = 'zheng';
  else if (adev <= okMax + EPS) level = 'jian';
  else if (adev <= voidAbove + EPS) level = 'jian_caution';
  else level = 'void';

  const boundaryDist = Math.max(0, HALF_SHAN - adev);
  const boundaryKind = MOUNTAINS[i].gua !== MOUNTAINS[j].gua ? 'gua' : 'shan';
  const onLine = boundaryDist < RIDING_LINE_DEG - EPS;
  const retest = boundaryDist < o.uncertainty - EPS;

  // D04:標籤只在 void 或壓線時給。位置式: 卦界=大、山界=小;度數式: 出卦=大、陰陽差錯=小、同性超限=空向。
  let positionKind = null;
  let degreeKind = null;
  let schoolNote = null;
  if (level === 'void' || onLine) {
    if (boundaryKind === 'gua') {
      positionKind = 'da';
      degreeKind = 'da';
    } else if (type === 'yinyang') {
      positionKind = 'xiao';
      degreeKind = 'xiao';
    } else {
      positionKind = 'xiao';
      degreeKind = 'kongxiang';
      schoolNote = KONGWANG_NOTE.tongxing;
    }
    schoolNote ??= KONGWANG_NOTE[o.kongwangLabelScheme];
  }
  const kongwangKind = o.kongwangLabelScheme === 'degree' ? degreeKind : positionKind;

  const findings = [];
  if (boundaryKind === 'gua' && boundaryDist < Math.max(o.uncertainty, GUA_HINT_MIN_DEG) - EPS) {
    const a = MOUNTAINS[i].gua;
    const b = MOUNTAINS[j].gua;
    // 不顯示假精度(規格 5.1 第 8 點),距離取整數度。
    const where = onLine ? '幾乎壓在分界線上' : `距分界約 ${Math.floor(boundaryDist + 0.5)} 度`;
    findings.push({
      id: 'geo.near_gua_boundary',
      level: 'note',
      title: '接近八卦分界',
      body:
        `量到的方位落在「${a}」與「${b}」兩個方位的分界附近(${where})。` +
        `手機的誤差可能跨過分界,由此推得的宅卦(房屋的方位組別)可能是${a}宅或${b}宅,` +
        '建議靠窗重量 3 到 5 次,或請老師用專業羅盤複核。',
      confidence: 'medium',
      tag: 'design',
      schoolNote: null,
      refs: ['orientation.md#2.4', 'DOMAIN_SPEC.md#2.1.3'],
    });
  }

  return {
    bearing: nb,
    mountain: MOUNTAINS[i].name,
    index: i,
    dev,
    zone,
    level,
    leanTo: zone === 'jian' ? MOUNTAINS[j].name : null,
    pairType: zone === 'jian' ? type : null,
    neighborMountain: MOUNTAINS[j].name,
    neighborGua: MOUNTAINS[j].gua,
    boundaryDist,
    boundaryKind,
    kongwangKind,
    kongwangKindDegree: degreeKind,
    schoolNote,
    onLine,
    retest,
    outer1p5: adev >= OUTER_START_DEG - EPS,
    // 同性相兼(天人互兼)玄空仍用下卦,只提示(zggdfs Read8_999;orientation.verify.md V19)。
    needsTiGua: zone === 'jian' && (type === 'yinyang' || type === 'chugua'),
    gua: MOUNTAINS[i].gua,
    dir8: dirOfGua(MOUNTAINS[i].gua),
    opposite: MOUNTAINS[(i + 12) % 24].name,
    findings,
    meta: {
      schema: 'fengshui.geo.bearing/1',
      ruleset: {
        xiaGuaHalfWidth: o.threshold,
        jianLimitSchool: o.jianLimitSchool,
        kongwangLabelScheme: o.kongwangLabelScheme,
        measureUncertainty: o.uncertainty,
      },
    },
  };
}

// ─────────────────────────── 磁北與真北 ───────────────────────────

function assertDeclination(d) {
  if (typeof d !== 'number' || !Number.isFinite(d) || Math.abs(d) > 180) {
    fail('INVALID_DECLINATION', `必須是 [-180,180] 的有限數字: ${show(d)}`);
  }
}

/**
 * 磁方位 → 真方位。真 = 磁 + D,D 東偏為正(D06;NOAA、Wikipedia Magnetic_declination)。
 * @param {number} mag 磁方位(度)
 * @param {number} D 磁偏角(度),東偏為正
 * @returns {number} [0,360)
 * @throws {Error} INVALID_BEARING, INVALID_DECLINATION
 */
export function toTrue(mag, D) {
  assertDeclination(D);
  return normalizeBearing(normalizeBearing(mag) + D);
}

/**
 * 真方位 → 磁方位。磁 = 真 - D。台北 D≈-5:面向真北時羅盤讀數約 005,不是 355。
 * @param {number} tr 真方位(度)
 * @param {number} D 磁偏角(度),東偏為正
 * @returns {number} [0,360)
 * @throws {Error} INVALID_BEARING, INVALID_DECLINATION
 */
export function toMagnetic(tr, D) {
  assertDeclination(D);
  return normalizeBearing(normalizeBearing(tr) - D);
}

/**
 * 磁北與真北兩種讀法並列(規格 2.1.3 第 10 點):落在不同山或不同卦時 UI 並列顯示。
 * @param {number} magnetic 手機讀到的磁方位(度)
 * @param {number} D 磁偏角(度),東偏為正
 * @returns {{magneticBearing:number, trueBearing:number, magneticMountain:string, trueMountain:string, magneticGua:string, trueGua:string, sameMountain:boolean, sameGua:boolean}}
 * @throws {Error} INVALID_BEARING, INVALID_DECLINATION
 */
export function compareMagVsTrue(magnetic, D) {
  const trueBearing = toTrue(magnetic, D);
  const m = mountainAt(magnetic);
  const t = mountainAt(trueBearing);
  return {
    magneticBearing: normalizeBearing(magnetic),
    trueBearing,
    magneticMountain: m.name,
    trueMountain: t.name,
    magneticGua: m.gua,
    trueGua: t.gua,
    sameMountain: m.name === t.name,
    sameGua: m.gua === t.gua,
  };
}

/** 磁偏角模型資訊。WMM2025 有效期 2025.0 到 2030.0,之後必須換新模型(規格 2.1.5)。 */
export const DECLINATION_MODEL = Object.freeze({ name: 'WMM2025', epoch: 2026.0, validFrom: 2025.0, validTo: 2030.0 });

// 資料: orientation.md 3.5 的 WMM2025 2026.0 城市表(對 NOAA 官方測試向量最大差 0.005 度),年變化 = (2028.0 - 2026.0) / 2。
// 首爾不在該表,取 orientation.json 的 declinationReference(-8.99,-0.039;orientation.md 3.6 亦為 -8.99)。東偏為正。
/**
 * 城市磁偏角表。鍵為城市名。
 * @type {Readonly<Record<string, Readonly<{lat:number, lon:number, declinationDeg:number, annualChangeDegPerYear:number}>>>}
 */
export const CITY_DECLINATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      "台北": { lat: 25.033, lon: 121.565, declinationDeg: -5.03, annualChangeDegPerYear: -0.037 },
      "新北板橋": { lat: 25.012, lon: 121.465, declinationDeg: -5.01, annualChangeDegPerYear: -0.038 },
      "基隆": { lat: 25.128, lon: 121.739, declinationDeg: -5.08, annualChangeDegPerYear: -0.038 },
      "桃園": { lat: 24.994, lon: 121.301, declinationDeg: -4.99, annualChangeDegPerYear: -0.037 },
      "新竹": { lat: 24.804, lon: 120.972, declinationDeg: -4.9, annualChangeDegPerYear: -0.036 },
      "苗栗": { lat: 24.56, lon: 120.821, declinationDeg: -4.83, annualChangeDegPerYear: -0.036 },
      "台中": { lat: 24.148, lon: 120.674, declinationDeg: -4.71, annualChangeDegPerYear: -0.036 },
      "彰化": { lat: 24.075, lon: 120.542, declinationDeg: -4.68, annualChangeDegPerYear: -0.035 },
      "南投": { lat: 23.916, lon: 120.687, declinationDeg: -4.66, annualChangeDegPerYear: -0.036 },
      "雲林斗六": { lat: 23.709, lon: 120.543, declinationDeg: -4.59, annualChangeDegPerYear: -0.035 },
      "嘉義": { lat: 23.48, lon: 120.449, declinationDeg: -4.53, annualChangeDegPerYear: -0.035 },
      "台南": { lat: 22.999, lon: 120.227, declinationDeg: -4.39, annualChangeDegPerYear: -0.034 },
      "高雄": { lat: 22.627, lon: 120.301, declinationDeg: -4.32, annualChangeDegPerYear: -0.034 },
      "屏東": { lat: 22.669, lon: 120.486, declinationDeg: -4.36, annualChangeDegPerYear: -0.035 },
      "宜蘭": { lat: 24.757, lon: 121.753, declinationDeg: -4.99, annualChangeDegPerYear: -0.038 },
      "花蓮": { lat: 23.977, lon: 121.604, declinationDeg: -4.79, annualChangeDegPerYear: -0.038 },
      "台東": { lat: 22.756, lon: 121.144, declinationDeg: -4.46, annualChangeDegPerYear: -0.036 },
      "澎湖馬公": { lat: 23.571, lon: 119.579, declinationDeg: -4.43, annualChangeDegPerYear: -0.032 },
      "金門": { lat: 24.449, lon: 118.377, declinationDeg: -4.43, annualChangeDegPerYear: -0.029 },
      "香港": { lat: 22.319, lon: 114.169, declinationDeg: -3.29, annualChangeDegPerYear: -0.014 },
      "澳門": { lat: 22.199, lon: 113.544, declinationDeg: -3.16, annualChangeDegPerYear: -0.012 },
      "北京": { lat: 39.904, lon: 116.407, declinationDeg: -7.53, annualChangeDegPerYear: -0.038 },
      "上海": { lat: 31.23, lon: 121.474, declinationDeg: -6.53, annualChangeDegPerYear: -0.038 },
      "廣州": { lat: 23.129, lon: 113.264, declinationDeg: -3.28, annualChangeDegPerYear: -0.012 },
      "深圳": { lat: 22.543, lon: 114.058, declinationDeg: -3.31, annualChangeDegPerYear: -0.014 },
      "成都": { lat: 30.573, lon: 104.066, declinationDeg: -2.43, annualChangeDegPerYear: 0 },
      "重慶": { lat: 29.563, lon: 106.551, declinationDeg: -2.88, annualChangeDegPerYear: -0.003 },
      "武漢": { lat: 30.593, lon: 114.305, declinationDeg: -4.9, annualChangeDegPerYear: -0.022 },
      "西安": { lat: 34.341, lon: 108.94, declinationDeg: -4.17, annualChangeDegPerYear: -0.017 },
      "杭州": { lat: 30.274, lon: 120.155, declinationDeg: -6.06, annualChangeDegPerYear: -0.035 },
      "南京": { lat: 32.06, lon: 118.797, declinationDeg: -6.23, annualChangeDegPerYear: -0.033 },
      "廈門": { lat: 24.48, lon: 118.089, declinationDeg: -4.39, annualChangeDegPerYear: -0.028 },
      "哈爾濱": { lat: 45.803, lon: 126.535, declinationDeg: -11.34, annualChangeDegPerYear: -0.034 },
      "烏魯木齊": { lat: 43.826, lon: 87.617, declinationDeg: 2.51, annualChangeDegPerYear: -0.014 },
      "東京": { lat: 35.69, lon: 139.692, declinationDeg: -7.91, annualChangeDegPerYear: -0.038 },
      "大阪": { lat: 34.694, lon: 135.502, declinationDeg: -8.13, annualChangeDegPerYear: -0.041 },
      "札幌": { lat: 43.062, lon: 141.354, declinationDeg: -9.92, annualChangeDegPerYear: -0.03 },
      "福岡": { lat: 33.59, lon: 130.402, declinationDeg: -8, annualChangeDegPerYear: -0.042 },
      "那霸": { lat: 26.212, lon: 127.681, declinationDeg: -5.83, annualChangeDegPerYear: -0.048 },
      "新加坡": { lat: 1.352, lon: 103.82, declinationDeg: 0.21, annualChangeDegPerYear: 0.031 },
      "吉隆坡": { lat: 3.139, lon: 101.687, declinationDeg: 0, annualChangeDegPerYear: 0.036 },
      "首爾": { lat: 37.567, lon: 126.978, declinationDeg: -8.99, annualChangeDegPerYear: -0.039 },
    }).map(([k, v]) => [k, Object.freeze(v)]),
  ),
);

function yearFraction(dateMs) {
  if (typeof dateMs !== 'number' || !Number.isFinite(dateMs) || Number.isNaN(new Date(dateMs).getTime())) {
    fail('INVALID_DATE', `必須是有限的 ms epoch: ${show(dateMs)}`);
  }
  const y = new Date(dateMs).getUTCFullYear();
  const t0 = Date.UTC(y, 0, 1);
  const t1 = Date.UTC(y + 1, 0, 1);
  return y + (dateMs - t0) / (t1 - t0);
}

/**
 * 城市在某時刻的磁偏角與模型有效範圍旗標。以 2026.0 值加年變化線性外推。
 * @param {string} cityId CITY_DECLINATIONS 的鍵
 * @param {number} dateMs ms since epoch (UTC)
 * @returns {{cityId:string, declinationDeg:number, yearFraction:number, model:string, epoch:number, inModelRange:boolean}}
 * @throws {Error} UNKNOWN_CITY, INVALID_DATE
 */
export function declinationInfo(cityId, dateMs) {
  if (typeof cityId !== 'string' || !has(CITY_DECLINATIONS, cityId)) fail('UNKNOWN_CITY', show(cityId));
  const yf = yearFraction(dateMs);
  const c = CITY_DECLINATIONS[cityId];
  return {
    cityId,
    declinationDeg: c.declinationDeg + c.annualChangeDegPerYear * (yf - DECLINATION_MODEL.epoch),
    yearFraction: yf,
    model: DECLINATION_MODEL.name,
    epoch: DECLINATION_MODEL.epoch,
    inModelRange: yf >= DECLINATION_MODEL.validFrom && yf < DECLINATION_MODEL.validTo,
  };
}

/**
 * 城市在某時刻的磁偏角(度,東偏為正)。超出模型有效期仍回外推值,用 declinationInfo().inModelRange 判斷。
 * @param {string} cityId CITY_DECLINATIONS 的鍵,例如 '台北'
 * @param {number} dateMs ms since epoch (UTC)
 * @returns {number}
 * @throws {Error} UNKNOWN_CITY, INVALID_DATE
 */
export function declinationFor(cityId, dateMs) {
  return declinationInfo(cityId, dateMs).declinationDeg;
}

// ─────────────────────────── 圓周統計 ───────────────────────────

/**
 * 多次量測的圓周統計。不可用算術平均:[359,1] 算術平均是 180,圓周平均是 0。
 * stdDeg 為圓周標準差 σ = sqrt(-2 ln R)(度);合成向量近 0(如 90 與 270 各半)時 mean、stdDeg 為 null。
 * @param {number[]} readings 度,至少 1 筆
 * @returns {{n:number, mean:number|null, r:number, stdDeg:number|null}}
 * @throws {Error} INVALID_READINGS, INVALID_BEARING
 */
export function circularStats(readings) {
  if (!Array.isArray(readings) || readings.length === 0) fail('INVALID_READINGS', '需要至少一筆讀數的陣列');
  let s = 0;
  let c = 0;
  // 用索引迴圈而非 forEach:稀疏陣列的洞會被 forEach 略過,n 卻照算,平均與 σ 都會默默算錯。
  for (let idx = 0; idx < readings.length; idx += 1) {
    const x = readings[idx];
    if (typeof x !== 'number' || !Number.isFinite(x)) fail('INVALID_BEARING', `readings[${idx}] 不是有限數字: ${show(x)}`);
    const rad = (x * Math.PI) / 180;
    s += Math.sin(rad);
    c += Math.cos(rad);
  }
  const n = readings.length;
  const r = Math.hypot(s, c) / n;
  if (r < 1e-9) return { n, mean: null, r, stdDeg: null };
  // σ = sqrt(-2 ln R)。R 貼近 1 時直接取對數會被浮點吃掉(相同讀數得 8e-7),
  // 改以 1-R = 平均(2 sin²(δ/2)) 精確求出再用 log1p。
  const theta = Math.atan2(s, c);
  let q = 0;
  for (const x of readings) q += 2 * Math.sin(((x * Math.PI) / 180 - theta) / 2) ** 2;
  q /= n;
  const stdDeg = q <= 0 ? 0 : (Math.sqrt(-2 * Math.log1p(-Math.min(q, 1 - 1e-12))) * 180) / Math.PI;
  let mean = normalizeBearing((theta * 180) / Math.PI);
  // atan2 對 [359,1] 這類對稱讀數會回 -1e-15 級的雜訊,正規化後變 359.99999999999994。
  if (mean > 360 - EPS) mean = 0;
  return { n, mean, r, stdDeg };
}

/**
 * 圓周平均,形狀同 orientation.json 的 circularMean 案例。
 * @param {number[]} readings 度
 * @returns {{mean:number|null, r:number, stdDeg:number|null}}
 * @throws {Error} INVALID_READINGS, INVALID_BEARING
 */
export function circularMean(readings) {
  const { mean, r, stdDeg } = circularStats(readings);
  return { mean, r, stdDeg };
}

/**
 * 不確定度 = max(baseline, 2σ, 感測器回報精度)(規格 2.1.7、2.9.4)。缺項略過。
 * @param {{baseline?:number, sigmaDeg?:number|null, accuracyDeg?:number|null}} [params]
 *   baseline 預設 settings.measureUncertainty(App 層 5.0);純函式 analyzeBearing 自己的預設是 3.0
 * @returns {number}
 * @throws {Error} INVALID_OPTION
 */
export function measurementUncertainty(params) {
  const { baseline = DEFAULT_SETTINGS.measureUncertainty, sigmaDeg = null, accuracyDeg = null } = params ?? {};
  const parts = [baseline];
  if (sigmaDeg !== null && sigmaDeg !== undefined) parts.push(2 * sigmaDeg);
  if (accuracyDeg !== null && accuracyDeg !== undefined) parts.push(accuracyDeg);
  for (const p of parts) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) fail('INVALID_OPTION', `不確定度輸入必須是非負有限數字: ${show(p)}`);
  }
  return Math.max(...parts);
}

// ─────────────────────────── 「向」的取法政策 ───────────────────────────

const FACING_TYPES = Object.freeze(['apartment', 'office', 'house', 'shop']);
const FACING_POLICIES = Object.freeze(['auto', 'door', 'light', 'building']);

function optBearing(v, what) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('INVALID_BEARING', `${what} 不是有限數字: ${show(v)}`);
  return normalizeBearing(v);
}

/**
 * 依建築類型取「向」(D07,產品政策,信心: 低)。大門、採光面、大樓正面三者夾角超過 45 度一律 conflict。
 * 電梯大樓/公寓與同大樓辦公室: 主採光面;useBuildingFacade 或(facadeFloorRule 且 floor <= lowFloorMax)改用大樓正面;無採光資料退回大門。
 * 透天: 大門與採光面差 <= 45 用大門,否則用採光面。店面與獨立門面辦公室(storefront=true): 臨街大門。
 * @param {{type:'apartment'|'office'|'house'|'shop', door?:number|null, light?:number|null, building?:number|null,
 *   useBuildingFacade?:boolean, floor?:number, lowFloorMax?:number, storefront?:boolean}} input 方位角皆為度
 * @param {object} [overrides] 部分 Settings,讀 facingPolicy(auto/door/light/building)與 facadeFloorRule
 * @returns {{facingBearing:number, basis:'main_light_face'|'building_facade'|'door'|'door_fallback'|'street_door',
 *   conflict:boolean, candidates:Array<{source:'door'|'light'|'building', bearing:number}>, confidence:'low',
 *   warnings:Array<'building_missing'|'no_light_data'>, meta:{schema:string, ruleset:{facingPolicy:string, facadeFloorRule:boolean}}}}
 * @throws {Error} INVALID_FACING_INPUT, INVALID_BEARING, INVALID_OPTION, 未知設定鍵
 */
export function pickFacing(input, overrides = {}) {
  const s = resolveSettings(overrides ?? {});
  if (!FACING_POLICIES.includes(s.facingPolicy)) fail('INVALID_OPTION', `facingPolicy 不認得: ${show(s.facingPolicy)}`);
  if (input === null || typeof input !== 'object') fail('INVALID_FACING_INPUT', 'input 必須是物件');
  if (!FACING_TYPES.includes(input.type)) fail('INVALID_FACING_INPUT', `type 不認得: ${show(input.type)}`);

  const door = optBearing(input.door, 'door');
  const light = optBearing(input.light, 'light');
  const building = optBearing(input.building, 'building');
  const candidates = [];
  if (door !== null) candidates.push({ source: 'door', bearing: door });
  if (light !== null) candidates.push({ source: 'light', bearing: light });
  if (building !== null) candidates.push({ source: 'building', bearing: building });
  if (candidates.length === 0) fail('INVALID_FACING_INPUT', '大門、採光面、大樓正面至少要有一個');

  let spread = 0;
  for (let a = 0; a < candidates.length; a += 1) {
    for (let b = a + 1; b < candidates.length; b += 1) {
      spread = Math.max(spread, circularDiff(candidates[a].bearing, candidates[b].bearing));
    }
  }
  const conflict = spread > FACING_CONFLICT_DEG + EPS;
  const warnings = [];
  const meta = {
    schema: 'fengshui.geo.facing/1',
    ruleset: { facingPolicy: s.facingPolicy, facadeFloorRule: s.facadeFloorRule },
  };
  const done = (facingBearing, basis) => ({ facingBearing, basis, conflict, candidates, confidence: 'low', warnings, meta });
  const doorFallback = (b) => {
    warnings.push('no_light_data');
    return done(b, 'door_fallback');
  };

  const storefront = input.type === 'shop' || (input.type === 'office' && input.storefront === true);
  const doorBasis = storefront ? 'street_door' : 'door';

  // 使用者在設定強制指定時優先;指定的資料缺就落回自動規則。
  if (s.facingPolicy === 'door' && door !== null) return done(door, doorBasis);
  if (s.facingPolicy === 'light' && light !== null) return done(light, 'main_light_face');
  if (s.facingPolicy === 'building' && building !== null) return done(building, 'building_facade');

  if (storefront) {
    if (door !== null) return done(door, 'street_door');
    return done(light ?? building, light !== null ? 'main_light_face' : 'building_facade');
  }

  if (input.type === 'house') {
    if (door !== null && light !== null) {
      return circularDiff(door, light) <= FACING_CONFLICT_DEG + EPS ? done(door, 'door') : done(light, 'main_light_face');
    }
    if (light !== null) return done(light, 'main_light_face');
    if (door !== null) return doorFallback(door);
    return done(building, 'building_facade');
  }

  // 電梯大樓/公寓與同大樓辦公室。Lillian Too 樓層規則預設關(facadeFloorRule)。
  const lowFloorMax = input.lowFloorMax ?? 9;
  const floorHit =
    s.facadeFloorRule && typeof input.floor === 'number' && Number.isFinite(input.floor) && input.floor <= lowFloorMax;
  if (input.useBuildingFacade === true || floorHit) {
    if (building !== null) return done(building, 'building_facade');
    warnings.push('building_missing');
  }
  if (light !== null) return done(light, 'main_light_face');
  if (door !== null) return doorFallback(door);
  return done(building, 'building_facade');
}

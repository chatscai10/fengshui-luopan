// 玄空山向盤核心: 飛布、二次轉換、下卦與替卦排盤、格局判定、全局伏吟反吟、由方位角定山(規格 2.4.1-2.4.7)。
// 純函式。24 山的卦、元龍、陰陽只從 geo.MOUNTAINS 讀取(D23),本檔不含任何手打山表。
import {
  MOUNTAINS,
  LUOSHU,
  mountainIndex,
  analyzeBearing,
  boundaryOptsFromSettings,
} from '../geo.js';
import { PALACES, FLY_ORDER, TI_TABLES, PATTERN_BY_DIRECTIONS, PATTERN_NAMES, palaceOfStar } from './tables.js';
import { mod9 } from '../nine.js';

/**
 * 錯誤碼(Error.message 以碼開頭,後接冒號): 沿用 geo 的 INVALID_BEARING、UNKNOWN_MOUNTAIN、INVALID_OPTION(未知設定鍵);
 * 本模組自訂:
 *  INVALID_YUN   運不是 1..9 的整數(規格 2.4.14)
 *  INVALID_STAR  星數不是 1..9 的整數
 *  INVALID_PALACE 宮位名不在 坎坤震巽中乾兌艮離
 *  INVALID_OPTION 選項名稱或值不合法(buildChart 的 ti / tiTable、設定值)
 *  MISSING_INPUT  analyzeXuankong 缺必要輸入(向、建成時間、今日等)
 */
export const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const EPS = 1e-9;

/** @param {*} yun @param {string} [what] @throws {Error} INVALID_YUN */
export function assertYun(yun, what = 'yun') {
  if (!Number.isInteger(yun) || yun < 1 || yun > 9) fail('INVALID_YUN', `${what} 必須是 1..9 的整數: ${show(yun)}`);
}

/** @param {*} star @throws {Error} INVALID_STAR */
export function assertStar(star) {
  if (!Number.isInteger(star) || star < 1 || star > 9) fail('INVALID_STAR', `星數必須是 1..9 的整數: ${show(star)}`);
}

/** @param {*} palace @throws {Error} INVALID_PALACE */
export function assertPalace(palace) {
  if (!PALACES.includes(palace)) fail('INVALID_PALACE', `宮位必須是 ${PALACES.join('')} 之一: ${show(palace)}`);
}

export { mod9 };

// ─────────────────────────── 飛布與二次轉換 ───────────────────────────

/**
 * 入中星飛布九宮。順飛 +1、逆飛 -1,依飛布宮序(規格 2.4.1)。
 * @param {number} center 入中星 1..9
 * @param {boolean} forward true 順飛(陽)
 * @returns {Record<string, number>} 宮位名 → 星
 * @throws {Error} INVALID_STAR
 */
export function fly(center, forward) {
  assertStar(center);
  const out = {};
  FLY_ORDER.forEach((n, i) => {
    out[palaceOfStar(n)] = mod9(forward ? center + i : center - i);
  });
  return out;
}

/**
 * 運盤: 當運星入中,任何情況都順飛(公式 第 i 宮 = ((yun-1+i)%9)+1,規格 2.4.2 第 1 步)。
 * @param {number} yun 1..9
 * @returns {Record<string, number>} 宮位名 → 運星
 * @throws {Error} INVALID_YUN
 */
export function yunPan(yun) {
  assertYun(yun);
  return fly(yun, true);
}

// 每卦三山依元龍索引(宮位名 → 元龍 → 山名),由 geo 生成。
const MATE_TABLE = (() => {
  const t = {};
  for (const m of MOUNTAINS) (t[m.gua] ??= {})[m.dragon] = m.name;
  return t;
})();

const isYang = (name) => MOUNTAINS[mountainIndex(name)].yinyang === '陽';

/**
 * 二次轉換(規格 2.4.2 第 2 步): 入中星回其本宮,取該宮內與 mountain 同元龍的那一山為「伴」,伴的陰陽定順逆(陽順陰逆)。
 * 5 入中沒有本宮: 伴 = 山自身,用山自身的陰陽(D26)。這**不是**看運星奇偶(英文維基「Period number 的陰陽」措辭含糊,
 * 誤讀成運星奇偶會與此規則在 24 個 5 入中盤全部不同,xuankong_patterns.verify.md R2)。
 * @param {number} star 入中星 1..9
 * @param {string} mountain 山盤傳坐山、向盤傳向山
 * @returns {{mate: string, forward: boolean}}
 * @throws {Error} INVALID_STAR, UNKNOWN_MOUNTAIN
 */
export function direction(star, mountain) {
  assertStar(star);
  const m = MOUNTAINS[mountainIndex(mountain)];
  const mate = star === 5 ? m.name : MATE_TABLE[palaceOfStar(star)][m.dragon];
  return { mate, forward: isYang(mate) };
}

// ─────────────────────────── 排盤 ───────────────────────────

const BUILD_KEYS = ['ti', 'tiTable'];

/**
 * @typedef {Object} PlateInfo 山盤或向盤的入中資訊
 * @property {number} star 運盤上該山所在宮的星(入中的原星)
 * @property {number} enter 實際入中的數;替卦時 = 替星表[伴](5 入中不替),否則 = star
 * @property {string} mate 二次轉換取得的伴山(5 入中為山自身)
 * @property {boolean} forward 順飛(陽)。替卦時仍看原伴山的陰陽,不看替星(D25)
 */

/**
 * @typedef {Object} Chart
 * @property {{chartYun:number, sit:string, face:string, ti:boolean, tiTable:string|null, currentYun?:number}} meta
 * @property {string} sitPalace 坐宮(宮位名)
 * @property {string} facePalace 向宮
 * @property {PlateInfo} shan 山盤(左上,主人丁)
 * @property {PlateInfo} xiang 向盤(右上,主財)
 * @property {Record<string, {yun:number, shan:number, xiang:number}>} palaces 九宮三數,鍵為宮位名(含 '中'),洛書數順序
 * @property {string} pattern 格局名,只由山向順逆兩個位元決定(規格 2.4.5)
 * @property {boolean} patternHolds 該格局的星數條件在此盤是否成立;下卦盤恆為 true,替卦盤可能為 false
 * @property {{shan: '伏吟'|'反吟'|null, xiang: '伏吟'|'反吟'|null}} wholePlate 全局伏吟(5 順)/反吟(5 逆)
 */

/**
 * 排山向盤(規格 2.4.2)。向山 = 坐山的對山(24 山環 +12,同元龍同陰陽)。
 * @param {number} yun 入運(排盤用的運,1..9)
 * @param {string} sit 坐山名
 * @param {{ti?: boolean, tiTable?: 'A'|'B'}} [opts] ti=true 用替卦(預設關,D24);tiTable 替星表,預設 'A'
 * @returns {Chart}
 * @throws {Error} INVALID_YUN, UNKNOWN_MOUNTAIN, INVALID_OPTION
 */
export function buildChart(yun, sit, opts = {}) {
  assertYun(yun, 'yun');
  const i = mountainIndex(sit);
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) fail('INVALID_OPTION', 'opts 必須是物件');
  for (const k of Object.keys(opts)) if (!BUILD_KEYS.includes(k)) fail('INVALID_OPTION', `未知的選項: ${k}`);
  const { ti = false, tiTable = 'A' } = opts;
  if (typeof ti !== 'boolean') fail('INVALID_OPTION', `ti 必須是布林值: ${show(ti)}`);
  if (!has(TI_TABLES, tiTable)) fail('INVALID_OPTION', `tiTable 不認得: ${show(tiTable)}`);

  const sitM = MOUNTAINS[i];
  const faceM = MOUNTAINS[(i + 12) % 24];
  const Y = fly(yun, true);

  const plate = (m) => {
    const star = Y[m.gua];
    const { mate, forward } = direction(star, m.name);
    // 5 入中不替;替卦只改入中的數,順逆仍看原伴山(D25,與 Wikibooks 替卦盤 216/216 吻合)。
    const enter = ti && star !== 5 ? TI_TABLES[tiTable][mate] : star;
    return { info: { star, enter, mate, forward }, pan: fly(enter, forward) };
  };
  const s = plate(sitM);
  const x = plate(faceM);

  const palaces = {};
  for (const p of PALACES) palaces[p] = { yun: Y[p], shan: s.pan[p], xiang: x.pan[p] };

  const pattern = patternOfDirections(s.info.forward, x.info.forward);
  const chart = {
    meta: { chartYun: yun, sit: sitM.name, face: faceM.name, ti, tiTable: ti ? tiTable : null },
    sitPalace: sitM.gua,
    facePalace: faceM.gua,
    shan: s.info,
    xiang: x.info,
    palaces,
    pattern,
    patternHolds: false,
    wholePlate: { shan: null, xiang: null },
  };
  chart.patternHolds = classifyChart(chart) === pattern;
  chart.wholePlate = wholePlate(chart);
  return chart;
}

// ─────────────────────────── 格局 ───────────────────────────

/**
 * 由山盤與向盤的順逆位元得格局名(規格 2.4.5;代數證明見 xuankong_patterns.md 1.4)。
 * 逆逆=旺山旺向、順順=上山下水、山逆向順=雙星會坐、山順向逆=雙星會向。不可用「山為陰」當條件(R3)。
 * @param {boolean} shanForward
 * @param {boolean} xiangForward
 * @returns {string}
 */
export function patternOfDirections(shanForward, xiangForward) {
  return PATTERN_BY_DIRECTIONS[`${shanForward ? '+' : '-'}${xiangForward ? '+' : '-'}`];
}

/**
 * 依星數條件判格局(規格 2.4.5 表): 山星 M、向星 X、N = chartYun。
 * 下卦盤 216/216 落在四種之一;手工替卦盤可能回傳 '其它'。
 * @param {Chart} chart
 * @returns {'旺山旺向'|'上山下水'|'雙星會坐'|'雙星會向'|'其它'}
 */
export function classifyChart(chart) {
  const N = chart.meta.chartYun;
  const S = chart.sitPalace;
  const F = chart.facePalace;
  const P = chart.palaces;
  const sS = P[S].shan === N;
  const sF = P[F].shan === N;
  const xS = P[S].xiang === N;
  const xF = P[F].xiang === N;
  if (sS && xF) return '旺山旺向';
  if (sF && xS) return '上山下水';
  if (sS && xS) return '雙星會坐';
  if (sF && xF) return '雙星會向';
  return '其它';
}

/**
 * 全局伏吟/反吟(規格 2.4.7): 山盤或向盤入中星為 5,順飛=伏吟(盤與洛書本位完全相同),逆飛=反吟。
 * @param {Chart} chart
 * @returns {{shan: '伏吟'|'反吟'|null, xiang: '伏吟'|'反吟'|null}}
 */
export function wholePlate(chart) {
  const f = (p) => (p.star === 5 ? (p.forward ? '伏吟' : '反吟') : null);
  return { shan: f(chart.shan), xiang: f(chart.xiang) };
}

/**
 * 某運全部 24 山的格局名單,順序為 24 山環自壬起(規格 2.4.5),每項寫成「X山Y向」。
 * @param {number} yun 1..9
 * @returns {Record<string, string[]>} 格局名 → 名單(四種格局都有鍵,可為空陣列)
 * @throws {Error} INVALID_YUN
 */
export function listPatterns(yun) {
  assertYun(yun);
  const out = Object.fromEntries(PATTERN_NAMES.map((n) => [n, []]));
  for (let k = 0; k < 24; k += 1) {
    const sit = MOUNTAINS[(k + 23) % 24].name; // 壬起
    const c = buildChart(yun, sit);
    out[c.pattern].push(`${c.meta.sit}山${c.meta.face}向`);
  }
  return out;
}

// ─────────────────────────── 由方位角定山、下卦與兼向 ───────────────────────────

const KIND_OF_PAIR = Object.freeze({
  chugua: '出卦',
  yinyang: '陰陽差錯',
  tongxing_yin: '同陰陽',
  tongxing_yang: '同陰陽',
});

/**
 * @typedef {Object} FacingLocation
 * @property {number} bearing 正規化後的向方位角
 * @property {string} mountain 向山(方位角落入的山,地盤正針)
 * @property {string} sit 坐山 = 向山的對山
 * @property {number} dev 相對向山中心的帶號偏差(正 = 順時針側)
 * @property {'xia'|'jian'} zone |dev| <= xiaGuaHalfWidth 為下卦(含端點,D02)
 * @property {'pre'|'post'|null} side 兼向時偏向前一山(逆時針,dev<0)或後一山
 * @property {string|null} neighbor 兼向的鄰山
 * @property {'出卦'|'陰陽差錯'|'同陰陽'|null} kind 兼向類別
 * @property {boolean} needTi 出卦或陰陽差錯才需替卦;同陰陽不替(geo.needsTiGua,xuankong 只讀不自判)
 * @property {boolean} outer 兼向外側 1.5 度(|dev| >= 6,中州派最凶帶,D34)
 * @property {boolean} onZoneEdge 恰在下卦端點(|dev| = 半寬),慣例分歧,附騎線提示
 * @property {boolean} onMountainLine 壓在山界線上(geo.onLine)
 * @property {boolean} ridingLine onZoneEdge || onMountainLine(騎線提示)
 * @property {import('../geo.js').BearingAnalysis} geo 完整的 geo.analyzeBearing 結果
 */

/**
 * 由向的方位角定向山、坐山、下卦或兼向、是否需替卦(規格 2.4.3 第 1-2、5 步)。
 * 端點(恰 4.5°)歸下卦並標騎線;3 個 locate_edge_* 案例是慣例分歧,不當硬斷言。
 * @param {number} bearing 向的方位角(度,任意有限實數)
 * @param {object} [settings] 部分 Settings;讀 xiaGuaHalfWidth、jianLimitSchool、kongwangLabelScheme、measureUncertainty
 * @returns {FacingLocation}
 * @throws {Error} INVALID_BEARING;未知設定鍵 INVALID_OPTION
 */
export function locateFacing(bearing, settings = {}) {
  let opts;
  try {
    opts = boundaryOptsFromSettings(settings ?? {});
  } catch (e) {
    if (/^[A-Z_]+: /.test(e.message)) throw e;
    fail('INVALID_OPTION', e.message); // 未知設定鍵: geo/settings 丟的是無碼的錯誤,這裡補上文件寫的 INVALID_OPTION
  }
  const a = analyzeBearing(bearing, opts);
  const adev = Math.abs(a.dev);
  const jian = a.zone === 'jian';
  const onZoneEdge = Math.abs(adev - opts.threshold) <= EPS;
  return {
    bearing: a.bearing,
    mountain: a.mountain,
    sit: a.opposite,
    dev: a.dev,
    zone: jian ? 'jian' : 'xia',
    side: jian ? (a.dev < 0 ? 'pre' : 'post') : null,
    neighbor: jian ? a.leanTo : null,
    kind: jian ? KIND_OF_PAIR[a.pairType] : null,
    needTi: a.needsTiGua,
    outer: jian && a.outer1p5,
    onZoneEdge,
    onMountainLine: a.onLine,
    ridingLine: onZoneEdge || a.onLine,
    geo: a,
  };
}

/** 洛書數。 */
export const luoshuOf = (palace) => {
  assertPalace(palace);
  return LUOSHU[palace];
};

/**
 * 山的玄空屬性(24 山陰陽/元龍,D23): 陽 = 順飛、陰 = 逆飛。全部讀 geo.MOUNTAINS。
 * @param {string} name 24 山之一
 * @returns {{name:string, palace:string, luoshu:number, dragon:'地'|'天'|'人', yinyang:'陽'|'陰', forward:boolean}}
 * @throws {Error} UNKNOWN_MOUNTAIN
 */
export function mountainInfo(name) {
  const m = MOUNTAINS[mountainIndex(name)];
  return {
    name: m.name,
    palace: m.gua,
    luoshu: LUOSHU[m.gua],
    dragon: m.dragon.slice(0, 1),
    yinyang: m.yinyang,
    forward: m.yinyang === '陽',
  };
}

/**
 * 某盤(山/向/運)中放了某顆星的宮。
 * @param {Chart} chart
 * @param {'shan'|'xiang'|'yun'} plate
 * @param {number} star 1..9
 * @returns {string[]} 宮位名(洛書數順序)
 * @throws {Error} INVALID_STAR, INVALID_OPTION
 */
export function palacesWithStar(chart, plate, star) {
  assertStar(star);
  if (!['shan', 'xiang', 'yun'].includes(plate)) fail('INVALID_OPTION', `plate 必須是 shan/xiang/yun: ${show(plate)}`);
  return PALACES.filter((p) => chart.palaces[p][plate] === star);
}

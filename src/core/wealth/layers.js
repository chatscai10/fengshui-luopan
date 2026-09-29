// 暗財位與流年財位各層(規格 2.6.4、2.6.8、2.6.9): 八宅大門財位、本命財位、玄空財位格、流年財星、職業別、五行催旺、九運水火提示。
// 只吃 bazhai、xuankong、annual 的真實輸出,不重算它們的規則。
import { resolveSettings } from '../settings.js';
import { DIR8, dirOfGua, guaOfDir } from '../geo.js';
import { starWeights, starsOf, wealthOrder, zhaiFromFacing, STAR_NAMES } from '../bazhai.js';
import { PALACES, qiDist, qiLabel } from '../xuankong.js';
import { analyzeAnnual } from '../annual.js';
import { STAR_NAME, STAR_WUXING, YEAR_VAL } from './constants.js';

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const wrap9 = (n) => ((((n - 1) % 9) + 9) % 9) + 1;

/** 設定解析,未知鍵與 bazhai、annual 拋出的設定錯誤統一成 INVALID_SETTING。 */
export function settingsOf(overrides) {
  try {
    return resolveSettings(overrides ?? {});
  } catch (e) {
    throw new Error(`INVALID_SETTING: ${e.message}`);
  }
}

/**
 * 流年星值表(YEAR_VAL 套用 settings.yearVal 覆寫)。
 * @param {object} [settings] 讀 yearVal: 'default' 或 {星數: 星值}
 * @returns {Record<string, number>}
 * @throws {Error} INVALID_SETTING
 */
export function yearValues(settings = {}) {
  const s = settingsOf(settings);
  const custom = s.yearVal;
  const out = { ...YEAR_VAL };
  if (custom === 'default') return out;
  if (!isObj(custom)) fail('INVALID_SETTING', `yearVal 必須是 'default' 或 {星數: 星值}: ${show(custom)}`);
  for (const [k, v] of Object.entries(custom)) {
    if (!/^[1-9]$/.test(k)) fail('INVALID_SETTING', `yearVal 有未知的星數: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('INVALID_SETTING', `yearVal.${k} 必須是有限數字: ${show(v)}`);
    out[k] = v;
  }
  return out;
}

// ─────────────────────────── 八宅與命卦 ───────────────────────────

function starLayer(gua, s) {
  const val = starWeights(s);
  const byDir = starsOf(gua);
  const byStar = Object.fromEntries(STAR_NAMES.map((star) => [star, DIR8.find((d) => byDir[d] === star)]));
  const order = wealthOrder(gua, s).map(({ star, dir, backup }) => ({
    star,
    dir,
    gua: guaOfDir(dir),
    value: val[star],
    ...(backup ? { backup: true } : {}),
  }));
  return { byStar, byDir, order };
}

/**
 * 暗財位(八宅,B1): 大門朝向(向)定坐與宅卦,查 8x8 遊年表,財運面取 生氣 > 延年 > 天醫,伏位為備位。
 * 大門朝南 = 坎宅,生氣在東南。延年 > 天醫的順序無來源(WP-1),`tianyiFirst` 對調。
 * @param {number} facing 大門朝向(進屋後面對大門的方位角,度,任意實數)
 * @param {object} [settings] 讀 tianyiFirst、bazhaiStarWeights
 * @returns {{facingBearing:number, sitBearing:number, sitMountain:string, houseGua:string, houseName:string, sitDir:string,
 *   order:Array<{star:string, dir:string, gua:string, value:number, backup?:true}>,
 *   byStar:Record<string,string>, byDir:Record<string,string>}} byStar: 八星 → 方位名;byDir: 方位名 → 星
 * @throws {Error} INVALID_BEARING, INVALID_SETTING
 */
export function bazhaiDarkWealth(facing, settings = {}) {
  const s = settingsOf(settings);
  const z = zhaiFromFacing(facing);
  const { byStar, byDir, order } = starLayer(z.gua, s);
  return { facingBearing: z.facingBearing, sitBearing: z.sitBearing, sitMountain: z.sitMountain, houseGua: z.gua, houseName: z.name, sitDir: z.sitDir, order, byStar, byDir };
}

/**
 * 本命財位(B4): 命卦生氣位為主,延年、天醫次之,終身不變。
 * @param {string} mingGua 命卦(坎艮震巽離坤兌乾)
 * @param {object} [settings] 讀 tianyiFirst、bazhaiStarWeights
 * @returns {{gua:string, order:Array<{star:string, dir:string, gua:string, value:number, backup?:true}>, byStar:Record<string,string>, byDir:Record<string,string>}}
 * @throws {Error} UNKNOWN_GUA, INVALID_SETTING
 */
export function mingGuaWealth(mingGua, settings = {}) {
  const s = settingsOf(settings);
  const { byStar, byDir, order } = starLayer(mingGua, s);
  return { gua: mingGua, order, byStar, byDir };
}

// ─────────────────────────── 玄空財位格 ───────────────────────────

/**
 * 玄空財位格(B2): 向盤星數依「當旺 > 生氣 > 退氣財星」取三格 —— primary = 向星等於 currentYun、secondary = +1、tertiary = -1。
 * 九運丑山未向: 坤(向9山9)、坎(向1)、震(向8,退氣財星,忌大水),與 cafengshuinet 描述逐項吻合(信心: 中,不含替卦與兼向)。
 * 與 xuankong.wealthDingPositions 的財位候選(旺、近旺、遠旺三階)是兩種切法: 這裡對照九運公開說法的 9 > 1 > 8;
 * 向星落在中宮時該格 atCenter=true(中宮是太極點,不當房間位置)。坐宮(後方)標 wealthSide='back'。
 * currentYun 不是 9 時是泛化推論(tag=推論)。
 * @param {import('../xuankong/chart.js').Chart} chart
 * @param {number} currentYun 判讀用的運
 * @returns {{primary:object, secondary:object, tertiary:object}} 每格 {tier, star, sector, dir, xiang, shan, yun, side, wealthSide, atCenter, note?, tag, confidence}
 * @throws {Error} INVALID_INPUT(缺 chart.palaces)
 */
export function xuankongWealthCells(chart, currentYun) {
  if (!isObj(chart) || !isObj(chart.palaces)) fail('INVALID_INPUT', 'chart 必須是 xuankong.buildChart 的結果');
  if (!Number.isInteger(currentYun) || currentYun < 1 || currentYun > 9) fail('INVALID_YUN', `currentYun 必須是 1..9 的整數: ${show(currentYun)}`);
  const cell = (tier, star, note) => {
    const sector = PALACES.find((p) => chart.palaces[p].xiang === star);
    const c = chart.palaces[sector];
    const side = sector === chart.facePalace ? 'front' : sector === chart.sitPalace ? 'back' : 'other';
    return {
      tier,
      star,
      sector,
      dir: sector === '中' ? '中央' : dirOfGua(sector),
      xiang: c.xiang,
      shan: c.shan,
      yun: c.yun,
      side,
      wealthSide: side === 'back' ? 'back' : null,
      atCenter: sector === '中',
      ...(note ? { note } : {}),
      tag: currentYun === 9 ? 'source' : 'inference',
      confidence: currentYun === 9 ? 'medium' : 'low',
    };
  };
  return {
    primary: cell('primary', currentYun, null),
    secondary: cell('secondary', wrap9(currentYun + 1), null),
    tertiary: cell('tertiary', wrap9(currentYun - 1), '退氣財星,忌大水'),
  };
}

// ─────────────────────────── 流年 ───────────────────────────

const YEAR_NOTES = Object.freeze({
  8: { note: '八白為正財星,流年財位以它為主', tag: 'source', confidence: 'medium', schoolNote: null },
  9: { note: '九紫是當運旺星,這裡算加分,並非傳統上的財星', tag: 'inference', confidence: 'low', schoolNote: '九紫加分只能用「九運當旺」推論,傳統財星是八白、一白、六白' },
  1: { note: '一白為偏財星,九運時屬生氣星', tag: 'source', confidence: 'medium', schoolNote: null },
  6: { note: '六白為偏財星', tag: 'source', confidence: 'medium', schoolNote: null },
  4: { note: '四綠只有少數來源(DesignHouse)列為財星,分數為設計值', tag: 'source', confidence: 'low', schoolNote: '其他來源把四綠當文昌星,不算財星' },
});
const YEAR_WEALTH_STARS = Object.freeze([8, 9, 1, 6, 4]);

/**
 * 流年財位層(B3、2.6.9): 立春換年(不是元旦),財星值 八白 1.0、九紫 0.8、一白與六白 0.6、四綠 0.2(設計值,可由 yearVal 調)。
 * 交節時刻一律交給 calendar(經 annual)。
 * @param {{instant?:number, fengshuiYear?:number}} input 恰好給一個(ms epoch 或風水年)
 * @param {object} [settings] 讀 yearVal 與 annual 讀的設定
 * @returns {{fengshuiYear:number, ganzhi:string, center:number, lichun:number, lichunCST:string, chart:Record<string,number>, chartByGua:Record<string,number>,
 *   wuhuangGua:string, erheiGua:string, wealthStars:Array<{star:number, name:string, gua:string, dir:string, value:number, note:string, tag:string, confidence:string, schoolNote:(string|null)}>,
 *   warnings:string[], approx:boolean}}
 * @throws {Error} INVALID_INPUT, INVALID_INSTANT, INVALID_YEAR, INVALID_SETTING, YEAR_OUT_OF_RANGE
 */
export function annualWealthLayer(input, settings = {}) {
  const s = settingsOf(settings);
  const yv = yearValues(s);
  const a = analyzeAnnual(input, s);
  const guaOfStar = (star) => Object.keys(a.annual.chartByGua).find((g) => a.annual.chartByGua[g] === star);
  return {
    fengshuiYear: a.year.fengshuiYear,
    ganzhi: a.year.ganzhi,
    center: a.annual.center,
    lichun: a.year.lichun,
    lichunCST: a.year.lichunCST,
    chart: a.annual.chart,
    chartByGua: a.annual.chartByGua,
    wuhuangGua: a.annual.wuhuangGua,
    erheiGua: a.annual.erheiGua,
    wealthStars: YEAR_WEALTH_STARS.map((star) => {
      const gua = guaOfStar(star);
      return {
        star,
        name: STAR_NAME[star],
        gua,
        dir: gua === '中' ? '中宮' : dirOfGua(gua),
        value: yv[star],
        ...YEAR_NOTES[star],
      };
    }),
    warnings: [...a.meta.warnings],
    approx: a.approx,
  };
}

const OCCUPATION_STAR = Object.freeze({ 文職: 1, 外勤: 6, 經商: 8 });

/**
 * 職業別流年財位(謝沅瑾 2024: 文職東、外勤東北、經商北,對應當年一白、六白、八白)。單一來源,星數對應是推得,預設不採用(信心: 低)。
 * @param {number} fengshuiYear
 * @returns {Record<'文職'|'外勤'|'經商', {star:number, gua:string, dir:string}>}
 * @throws {Error} INVALID_YEAR
 */
export function occupationWealth(fengshuiYear) {
  const a = analyzeAnnual({ fengshuiYear });
  return Object.fromEntries(
    Object.entries(OCCUPATION_STAR).map(([job, star]) => {
      const gua = Object.keys(a.annual.chartByGua).find((g) => a.annual.chartByGua[g] === star);
      return [job, { star, gua, dir: gua === '中' ? '中宮' : dirOfGua(gua) }];
    }),
  );
}

// ─────────────────────────── 五行催旺 ───────────────────────────

/** 五行相生: 生我者。 */
const GENERATOR = Object.freeze({ 木: '水', 火: '木', 土: '火', 金: '土', 水: '金' });

/**
 * 星的五行催旺(生旺法,規格 2.6.8): 擺放與該星同五行、以及生該星五行的物件。只有八白(土,火/土物件)有直接來源
 * (三六風水、DesignHouse);其餘星是五行外推,沒有獨立來源,tag=推論、信心低。所有擺設是民俗或象徵性質,不宣稱科學效果。
 * @param {number} star 1..9
 * @returns {{star:number, name:string, element:string, elements:string[], note:string, tag:'source'|'inference', confidence:'medium'|'low'}}
 *   elements = [星本身的五行, 生它的五行]
 * @throws {Error} INVALID_STAR
 */
export function elementBoostForStar(star) {
  if (!Number.isInteger(star) || star < 1 || star > 9) fail('INVALID_STAR', `星數必須是 1..9 的整數: ${show(star)}`);
  const element = STAR_WUXING[star];
  const direct = star === 8;
  return {
    star,
    name: STAR_NAME[star],
    element,
    elements: [element, GENERATOR[element]],
    note: '民俗/象徵性質',
    tag: direct ? 'source' : 'inference',
    confidence: direct ? 'medium' : 'low',
  };
}

// ─────────────────────────── 九運水火 ───────────────────────────

/**
 * 九運水火提示(D47、D48,只在 allowWaterHint=true 時由 analyzeWealth 使用)。兩層: 通則提示 + 以向盤為準的個案提示。
 * 通則: 九運北方(坎)為零神,李居明與富衛 FWD 稱宜見水(信心: 中);南方(離)來源只說宜見山,「南方忌水」是推論,不寫。
 * 個案: 北方坎宮向星是旺或近旺生氣者可考慮小水;向星為退氣者不宜大水。currentYun 不是 9 時不給(通則只對九運)。
 * @param {import('../xuankong/chart.js').Chart|null} chart
 * @param {number} currentYun
 * @returns {Array<{layer:'general'|'case', palace:string, dir:string, text:string, tag:string, confidence:string, schoolNote:(string|null)}>}
 */
export function waterHints(chart, currentYun) {
  if (currentYun !== 9) return [];
  const out = [
    { layer: 'general', palace: '坎', dir: '北', text: '九運通則: 北方(零神位)宜見水', tag: 'source', confidence: 'medium', schoolNote: '李居明、富衛 FWD(引述七師傅、雲文子)的說法;財位放水本身是流派分歧,本 App 預設不主動建議' },
    { layer: 'general', palace: '離', dir: '南', text: '九運通則: 來源只說南方宜見山,沒有提到忌水', tag: 'inference', confidence: 'low', schoolNote: '「南方忌水」是推論,來源沒有這個字樣' },
  ];
  if (chart && isObj(chart.palaces) && chart.palaces['坎']) {
    const star = chart.palaces['坎'].xiang;
    const label = qiLabel(currentYun, star);
    if (qiDist(currentYun, star) <= 2) {
      out.push({ layer: 'case', palace: '坎', dir: '北', text: `以這張盤為準: 北方(坎宮)的向星是 ${star}(${label}),可以考慮小水`, tag: 'inference', confidence: 'low', schoolNote: '通則與個案並存時以向盤為準' });
    } else {
      out.push({ layer: 'case', palace: '坎', dir: '北', text: `以這張盤為準: 北方(坎宮)的向星是 ${star}(${label}),不是旺星,不特別建議見水`, tag: 'inference', confidence: 'low', schoolNote: '通則與個案並存時以向盤為準' });
    }
  }
  return out;
}


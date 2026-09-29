// 候選排序啟發式(規格 2.6.7,tag=設計,信心: 低): 元件(XK、H、P、Y)、環境乘數、分數、排序。
//   score(L) = 100 * clamp(0,1, wG*G + wXK*XK + wH*H + wP*P + wY*Y) * env(L)
// 只有星值的「順序」有來源;數字大小、權重、乘數全是設計值。分數只用來排序,不可跨設定比較。
// 無住戶資料時 P 歸 0 且權重不重分配,所以分數上限降為 0.85(規格 2.6.7)。
//
// 錯誤碼(message 開頭,規格沒列的自訂): INVALID_SETTING(檔位、多人政策不認得)、INVALID_FLAG(環境旗標不認得或不是布林)、
// INVALID_INPUT(元件或候選資料形狀不對)、UNKNOWN_GUA(命卦或宅卦不在八卦內)。
import { GUA } from '../geo.js';
import { starOf, starWeights } from '../bazhai.js';
import { BACK_WEALTH_FACTOR, qiScore, wealthDingPositions } from '../xuankong.js';
import { ENV_FLAGS, ENV_FLAG_NAMES, ENV_FLOOR, EXCLUSION_FLAGS, PROFILES, XK9_VAL } from './constants.js';
import { settingsOf, yearValues } from './layers.js';

const EPS = 1e-9;
const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** 四捨五入到小數 2 位,半數進位(規格 1.3,不用銀行家捨入)。 */
export const round2 = (x) => Math.floor(x * 100 + 0.5) / 100;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const MULTI_POLICIES = Object.freeze(['mean', 'breadwinner', 'each']);
const COMPONENT_LABELS = Object.freeze({ G: '明財位幾何', XK: '玄空(向盤為主,山盤為輔)', H: '八宅(大門宅卦)', P: '本命(住戶命卦)', Y: '流年' });

function profileOf(name) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) fail('INVALID_SETTING', `wealthProfile 不認得: ${show(name)}`);
  return PROFILES[name];
}

/**
 * 玄空星值(規格 2.6.7): currentYun=9 用 XK9_VAL;其他運改用 qiScore(default)/3(呼叫端要在 meta 標 xkValFallback)。
 * @param {number} star 1..9
 * @param {number} currentYun 判讀用的運
 * @param {{eightKeepsWealth?:boolean}} [opts]
 * @returns {number}
 * @throws {Error} INVALID_YUN, INVALID_STAR
 */
export function xkStarValue(star, currentYun, opts = {}) {
  if (currentYun === 9) {
    if (!Number.isInteger(star) || star < 1 || star > 9) fail('INVALID_STAR', `星數必須是 1..9 的整數: ${show(star)}`);
    return XK9_VAL[star];
  }
  return qiScore(currentYun, star, opts) / 3;
}

// ─────────────────────────── 元件 ───────────────────────────

/**
 * @typedef {Object} SectorComponents
 * @property {number} XK 玄空: (1-xkShan)*XK9_VAL[向盤星] + xkShan*XK9_VAL[山盤星];坐宮財星在後方(wealthSide='back')時乘 0.5
 * @property {number} H 八宅: BAZ_VAL[宅卦視角下該宮的星]
 * @property {number} P 本命: 各住戶命卦視角的 BAZ_VAL 依 multiOccupantPolicy 合併;沒有住戶資料為 0
 * @property {number} Y 流年: YEAR_VAL[當年流年星]
 */

/**
 * 八宮各自的元件(規格 2.6.7 元件公式)。缺的層不計(該分量為 0,權重不重分配): 沒有 chart → XK=0;沒有 houseGua → H=0;
 * 沒有住戶 → P=0;沒有流年 → Y=0。多位住戶(D53): mean 取平均、breadwinner 主要收入者權重加倍(role breadwinner,其次 holder,
 * 再其次第一位)、each 主分數仍取平均並另附 perPerson 供分別顯示。
 * @param {{chart?:(import('../xuankong/chart.js').Chart|null), currentYun?:number, houseGua?:(string|null),
 *   people?:Array<{id:string, gua:string, role?:(string|null)}>, annualChartByGua?:(Record<string,number>|null), profile?:string}} ctx
 * @param {object} [settings] 讀 wealthProfile、multiOccupantPolicy、yearVal、tianyiFirst、bazhaiStarWeights、eightKeepsWealth、wSide、wYun
 * @returns {{profile:string, components:Record<string,SectorComponents>,
 *   stars:Record<string,{xiang:(number|null), shan:(number|null), house:(string|null), year:(number|null), people:Record<string,string>}>,
 *   perPerson:Record<string,Record<string,number>>,
 *   meta:{xkValFallback:boolean, hasResidents:boolean, hasChart:boolean, hasHouse:boolean, hasAnnual:boolean, backPalaces:string[],
 *     policy:string, weights:Record<string,number>}}}
 * @throws {Error} INVALID_SETTING, INVALID_INPUT, UNKNOWN_GUA, INVALID_YUN
 */
export function sectorComponents(ctx, settings = {}) {
  if (!isObj(ctx)) fail('INVALID_INPUT', 'ctx 必須是物件');
  const s = settingsOf(settings);
  const profileName = ctx.profile ?? s.wealthProfile;
  const profile = profileOf(profileName);
  if (!MULTI_POLICIES.includes(s.multiOccupantPolicy)) fail('INVALID_SETTING', `multiOccupantPolicy 不認得: ${show(s.multiOccupantPolicy)}`);
  const bazVal = starWeights(s);
  const yv = yearValues(s);
  const chart = ctx.chart ?? null;
  const houseGua = ctx.houseGua ?? null;
  const people = ctx.people ?? [];
  const annual = ctx.annualChartByGua ?? null;
  if (houseGua !== null && !GUA.includes(houseGua)) fail('UNKNOWN_GUA', `houseGua: ${show(houseGua)}`);
  if (!Array.isArray(people)) fail('INVALID_INPUT', 'people 必須是陣列');
  for (const p of people) {
    if (!isObj(p) || typeof p.id !== 'string' || p.id === '') fail('INVALID_INPUT', `people 的成員需要非空字串 id: ${show(p)}`);
    if (!GUA.includes(p.gua)) fail('UNKNOWN_GUA', `${p.id} 的命卦: ${show(p.gua)}`);
  }
  if (chart !== null && !(Number.isInteger(ctx.currentYun) && ctx.currentYun >= 1 && ctx.currentYun <= 9)) {
    fail('INVALID_YUN', `有 chart 時必須給 currentYun(1..9): ${show(ctx.currentYun)}`);
  }

  // 主要收入者加倍(D53);沒有角色資料時取第一位。
  const anchor = people.find((p) => p.role === 'breadwinner') ?? people.find((p) => p.role === 'holder') ?? people[0];
  const weights = Object.fromEntries(people.map((p) => [p.id, s.multiOccupantPolicy === 'breadwinner' && p === anchor ? 2 : 1]));
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  let backPalaces = [];
  let xkValFallback = false;
  if (chart !== null) {
    backPalaces = wealthDingPositions(chart, ctx.currentYun, { wSide: s.wSide, wYun: s.wYun, eightKeepsWealth: s.eightKeepsWealth })
      .wealth.filter((r) => r.kind === 'back')
      .map((r) => r.palace);
    xkValFallback = ctx.currentYun !== 9;
  }
  const xkVal = (star) => xkStarValue(star, ctx.currentYun, { eightKeepsWealth: s.eightKeepsWealth });

  const components = {};
  const stars = {};
  const perPerson = Object.fromEntries(people.map((p) => [p.id, {}]));
  for (const g of GUA) {
    let XK = 0;
    let xiang = null;
    let shan = null;
    if (chart !== null) {
      xiang = chart.palaces[g].xiang;
      shan = chart.palaces[g].shan;
      XK = (1 - profile.xkShan) * xkVal(xiang) + profile.xkShan * xkVal(shan);
      if (backPalaces.includes(g)) XK *= BACK_WEALTH_FACTOR;
    }
    const houseStar = houseGua === null ? null : starOf(houseGua, g);
    const H = houseStar === null ? 0 : bazVal[houseStar];
    const personStars = {};
    let P = 0;
    for (const p of people) {
      const star = starOf(p.gua, g);
      personStars[p.id] = star;
      perPerson[p.id][g] = bazVal[star];
      P += weights[p.id] * bazVal[star];
    }
    if (people.length > 0) P /= weightSum;
    const yearStar = annual === null ? null : annual[g];
    const Y = yearStar === null ? 0 : yv[yearStar];
    components[g] = { XK, H, P, Y };
    stars[g] = { xiang, shan, house: houseStar, year: yearStar, people: personStars };
  }
  return {
    profile: profileName,
    components,
    stars,
    perPerson,
    meta: {
      xkValFallback,
      hasResidents: people.length > 0,
      hasChart: chart !== null,
      hasHouse: houseGua !== null,
      hasAnnual: annual !== null,
      backPalaces,
      policy: s.multiOccupantPolicy,
      weights,
    },
  };
}

// ─────────────────────────── 環境乘數與分數 ───────────────────────────

/**
 * 環境乘數 env(L)(規格 2.6.5、2.6.7): 排除旗標(toilet、stove、stairs、walkway、door_swing)→ 0;否則連乘各項,
 * 下限 0.4(設計值)。opening 的乘數依檔位: penalty(明財位派)0.5、reward(玄空派)1.05。
 * @param {Record<string,boolean>} [flags] 旗標名 → true;未知旗標丟 INVALID_FLAG
 * @param {'penalty'|'reward'} [opening]
 * @returns {{multiplier:number, product:number, floored:boolean,
 *   excluded:Array<{flag:string, label:string, reason:string, sources:number}>,
 *   factors:Array<{flag:string, multiplier:number, label:string, reason:string, sources:number}>}}
 * @throws {Error} INVALID_FLAG, INVALID_SETTING
 */
export function envMultiplier(flags = {}, opening = 'penalty') {
  if (!isObj(flags)) fail('INVALID_FLAG', `flags 必須是物件: ${show(flags)}`);
  if (opening !== 'penalty' && opening !== 'reward') fail('INVALID_SETTING', `opening 必須是 penalty 或 reward: ${show(opening)}`);
  for (const [k, v] of Object.entries(flags)) {
    if (!ENV_FLAG_NAMES.includes(k)) fail('INVALID_FLAG', `未知的環境旗標: ${k}`);
    if (typeof v !== 'boolean') fail('INVALID_FLAG', `旗標 ${k} 必須是布林: ${show(v)}`);
  }
  const excluded = EXCLUSION_FLAGS.filter((f) => flags[f] === true).map((flag) => ({ flag, label: ENV_FLAGS[flag].label, reason: ENV_FLAGS[flag].reason, sources: ENV_FLAGS[flag].sources }));
  const factors = ENV_FLAG_NAMES.filter((f) => !ENV_FLAGS[f].exclude && flags[f] === true).map((flag) => {
    const spec = ENV_FLAGS[flag];
    const isOpening = flag === 'opening';
    return {
      flag,
      multiplier: isOpening ? spec.mult[opening] : spec.mult,
      label: isOpening && opening === 'reward' ? '角區有窗(玄空派視為納氣)' : spec.label,
      reason: spec.reason,
      sources: spec.sources,
    };
  });
  const product = factors.reduce((p, f) => p * f.multiplier, 1);
  if (excluded.length > 0) return { multiplier: 0, product, floored: false, excluded, factors };
  const floored = product < ENV_FLOOR - EPS;
  return { multiplier: floored ? ENV_FLOOR : product, product, floored, excluded, factors };
}

const conf = (sources) => (sources >= 3 ? 'medium' : 'low');

/**
 * 單一位置的分數(規格 2.6.7)。列出每項貢獻(points = 100 * 權重 * 分量,環境乘數與 clamp 之前)與扣分理由。
 * 條件本身來自多個來源(tag=來源),乘數大小是設計值(magnitudeTag=設計)。
 * @param {SectorComponents} comp 該位置所在宮的元件
 * @param {{G?:number, flags?:Record<string,boolean>, profile?:string, opening?:('penalty'|'reward')}} [opts]
 *   G 幾何分(0..1);flags 環境旗標;profile 檔位;opening 預設取該檔位的 opening
 * @returns {{profile:string, G:number, subtotal:number, clamped:number, clampNote:(null|'low'|'high'), envMultiplier:number,
 *   rawScore:number, score:number, excluded:boolean,
 *   contributions:Array<{key:string, label:string, weight:number, value:number, points:number}>,
 *   deductions:Array<{flag:string, kind:'exclude'|'penalty'|'reward'|'floor', multiplier:number, label:string, reason:string, sources:(number|null), tag:string, confidence:string, magnitudeTag:string}>}}
 *   score = rawScore 四捨五入到小數 2 位
 * @throws {Error} INVALID_INPUT, INVALID_FLAG, INVALID_SETTING
 */
export function scoreLocation(comp, opts = {}) {
  if (!isObj(comp) || !['XK', 'H', 'P', 'Y'].every((k) => Number.isFinite(comp[k]))) fail('INVALID_INPUT', `comp 需要有限數字的 XK、H、P、Y: ${show(comp)}`);
  if (!isObj(opts)) fail('INVALID_INPUT', 'opts 必須是物件');
  const G = opts.G ?? 0;
  if (!(Number.isFinite(G) && G >= 0 && G <= 1)) fail('INVALID_INPUT', `G 必須在 [0,1]: ${show(G)}`);
  const profileName = opts.profile ?? 'mingcai';
  const p = profileOf(profileName);
  const values = { G, XK: comp.XK, H: comp.H, P: comp.P, Y: comp.Y };
  const contributions = ['G', 'XK', 'H', 'P', 'Y'].map((key) => ({ key, label: COMPONENT_LABELS[key], weight: p[key], value: values[key], points: 100 * p[key] * values[key] }));
  const subtotal = contributions.reduce((s, c) => s + p[c.key] * c.value, 0);
  const clamped = clamp01(subtotal);
  const env = envMultiplier(opts.flags ?? {}, opts.opening ?? p.opening);
  const rawScore = 100 * clamped * env.multiplier;
  const deductions = [
    ...env.excluded.map((e) => ({ flag: e.flag, kind: 'exclude', multiplier: 0, label: e.label, reason: `${e.reason};不得作為財位推薦`, sources: e.sources, tag: 'source', confidence: conf(e.sources), magnitudeTag: 'design' })),
    ...env.factors.map((f) => ({ flag: f.flag, kind: f.multiplier > 1 ? 'reward' : 'penalty', multiplier: f.multiplier, label: f.label, reason: f.reason, sources: f.sources, tag: 'source', confidence: conf(f.sources), magnitudeTag: 'design' })),
  ];
  if (env.floored) {
    deductions.push({ flag: 'floor', kind: 'floor', multiplier: ENV_FLOOR, label: '多項扣分疊加後仍保留下限', reason: `環境乘數最低取 ${ENV_FLOOR}(設計值)`, sources: null, tag: 'design', confidence: 'low', magnitudeTag: 'design' });
  }
  return {
    profile: profileName,
    G,
    subtotal,
    clamped,
    clampNote: subtotal < 0 ? 'low' : subtotal > 1 ? 'high' : null,
    envMultiplier: env.multiplier,
    rawScore,
    score: round2(rawScore),
    excluded: env.excluded.length > 0,
    contributions,
    deductions,
  };
}

/**
 * 八宮的「宮位能量」: 只看該宮的星,G=0、無環境乘數(規格 fixtures score_sector_energy)。
 * @param {Record<string,SectorComponents>} components sectorComponents 的 components
 * @param {string} [profile]
 * @returns {Record<string,number>} 宮 → 分數(小數 2 位)
 */
export function sectorEnergy(components, profile = 'mingcai') {
  return Object.fromEntries(GUA.map((g) => [g, scoreLocation(components[g], { G: 0, profile }).score]));
}

/**
 * 候選排序(規格 2.6.7): 分數高者在前,同分依 G、再 P、再 XK,仍同分維持原順序。回傳新陣列,每項加 rank(1 起算),不改動輸入。
 * 沒有分數(rawScore 為 null,例如平面圖方位未知)的項目排在最後且 rank 為 null。
 * @param {Array<{rawScore:(number|null), G?:number, components?:{P?:number, XK?:number}}>} list
 * @returns {Array<object>}
 */
export function rankCandidates(list) {
  if (!Array.isArray(list)) fail('INVALID_INPUT', 'list 必須是陣列');
  const key = (c) => [c.G ?? 0, c.components?.P ?? 0, c.components?.XK ?? 0];
  const sorted = list.map((c, i) => ({ c, i })).sort((a, b) => {
    const sa = a.c.rawScore;
    const sb = b.c.rawScore;
    if (sa === null || sb === null) return sa === sb ? a.i - b.i : sa === null ? 1 : -1;
    if (Math.abs(sa - sb) > EPS) return sb - sa;
    const ka = key(a.c);
    const kb = key(b.c);
    for (let j = 0; j < 3; j += 1) if (Math.abs(ka[j] - kb[j]) > EPS) return kb[j] - ka[j];
    return a.i - b.i;
  });
  let rank = 0;
  return sorted.map(({ c }) => ({ ...c, rank: c.rawScore === null ? null : (rank += 1) }));
}


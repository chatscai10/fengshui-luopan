// 九星旺衰(五氣)、星組合、財丁位、房間用途(規格 2.4.8-2.4.12)。旺衰基準一律用 currentYun(規格 2.4.4)。
import { LUOSHU, dirOfGua } from '../geo.js';
import {
  PALACES,
  QI_SCHEMES,
  QI_SCORE_BY_D,
  PAIR_TAGS,
  WENCHANG_KEYS,
  BACK_WEALTH_FACTOR,
} from './tables.js';
import { fail, assertYun, assertStar, assertPalace } from './chart.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ─────────────────────────── 五氣 ───────────────────────────

/** d = (星 - 運) mod 9。 */
export const qiDist = (yun, star) => {
  assertYun(yun);
  assertStar(star);
  return (((star - yun) % 9) + 9) % 9;
};

/**
 * 五氣標籤。
 * @param {number} yun 判讀用的運(currentYun)
 * @param {number} star 1..9
 * @param {'default'|'S1'|'S2'} [scheme='default'] qiScheme
 * @returns {string} 旺/近旺生/遠旺生/退/煞衰/死(default);S1、S2 見 QI_SCHEMES
 * @throws {Error} INVALID_YUN, INVALID_STAR, INVALID_OPTION
 */
export function qiLabel(yun, star, scheme = 'default') {
  assertYun(yun);
  assertStar(star);
  if (!has(QI_SCHEMES, scheme)) fail('INVALID_OPTION', `qiScheme 不認得: ${JSON.stringify(scheme)}`);
  return QI_SCHEMES[scheme][qiDist(yun, star)];
}

/**
 * 五氣分數(工程值,信心: 低,規格 2.4.8)。基礎分依 d;上限: 5 黃在非五運 ≤ -3,2 黑在非二運 ≤ +0.5。
 * eightKeepsWealth(少數派說法,D28): 八白退氣後若分數 ≤ 0 改 +1。分數不隨 qiScheme 改變(規格對 S1/S2 沒給分數)。
 * @param {number} yun 判讀用的運(currentYun)
 * @param {number} star 1..9
 * @param {{eightKeepsWealth?: boolean}} [opts]
 * @returns {number}
 * @throws {Error} INVALID_YUN, INVALID_STAR
 */
export function qiScore(yun, star, opts = {}) {
  assertYun(yun);
  assertStar(star);
  opts = opts ?? {};
  let s = QI_SCORE_BY_D[qiDist(yun, star)];
  if (star === 5 && yun !== 5) s = Math.min(s, -3);
  if (star === 2 && yun !== 2) s = Math.min(s, 0.5);
  if (opts.eightKeepsWealth && star === 8 && s <= 0) s = 1;
  return s;
}

/** d ∈ {0,1,2} 為旺、近旺、遠旺(候選財丁位的門檻)。 */
export const isWangSheng = (yun, star) => qiDist(yun, star) <= 2;

/**
 * 每宮山、向、運三星的五氣。
 * @param {import('./chart.js').Chart} chart
 * @param {number} currentYun
 * @param {{qiScheme?: string, eightKeepsWealth?: boolean}} [opts]
 * @returns {Record<string, Record<'shan'|'xiang'|'yun', {star:number, label:string, score:number}>>}
 */
export function qiByPalace(chart, currentYun, opts = {}) {
  opts = opts ?? {};
  const scheme = opts.qiScheme ?? 'default';
  const out = {};
  for (const p of PALACES) {
    const c = chart.palaces[p];
    out[p] = {};
    for (const k of ['shan', 'xiang', 'yun']) {
      out[p][k] = {
        star: c[k],
        label: qiLabel(currentYun, c[k], scheme),
        score: qiScore(currentYun, c[k], opts),
      };
    }
  }
  return out;
}

// ─────────────────────────── 星組合 ───────────────────────────

const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

function cloneTag(key, e) {
  const out = { key, ...e };
  if (e.alias) out.alias = [...e.alias];
  if (e.exceptYun) out.exceptYun = [...e.exceptYun];
  return out;
}

/**
 * 查星組合(不分順序)。
 * @param {number} a 1..9
 * @param {number} b 1..9
 * @returns {null|{key:string, tag:string, nature:string, confidence:string, [k:string]:*}}
 */
export function pairTag(a, b) {
  assertStar(a);
  assertStar(b);
  const key = pairKey(a, b);
  return has(PAIR_TAGS, key) ? cloneTag(key, PAIR_TAGS[key]) : null;
}

/**
 * 某宮的星組合。山星+向星為主,山星+運星、向星+運星為次(規格 2.4.9;SOHU-469457756、108S)。
 * @param {import('./chart.js').Chart} chart
 * @param {string} palace
 * @returns {Array<{role:'山向'|'山運'|'向運', key:string, tag:string, nature:string, confidence:string}>}
 */
export function pairTagsOfPalace(chart, palace) {
  assertPalace(palace);
  const c = chart.palaces[palace];
  const out = [];
  for (const [role, a, b] of [['山向', c.shan, c.xiang], ['山運', c.shan, c.yun], ['向運', c.xiang, c.yun]]) {
    const t = pairTag(a, b);
    if (t) out.push({ role, ...t });
  }
  return out;
}

/**
 * 組合調整分: 吉 +0.5、凶 -1、視旺衰與存疑 0;二五交加在二運與五運不扣(D36,九運一律警示且照扣)。
 * @param {{nature:string, exceptYun?:number[]}} entry
 * @param {number} currentYun
 * @returns {number}
 */
export function pairAdjust(entry, currentYun) {
  assertYun(currentYun, 'currentYun');
  if (entry === null || typeof entry !== 'object' || typeof entry.nature !== 'string') fail('INVALID_INPUT', 'entry 必須是含 nature 的星組合物件(pairTag 的回傳值)');
  if (entry.nature === '吉') return 0.5;
  if (entry.nature === '凶') return entry.exceptYun?.includes(currentYun) ? 0 : -1;
  return 0;
}

// ─────────────────────────── 財丁位 ───────────────────────────

/**
 * @typedef {Object} PositionCandidate
 * @property {string} palace 宮位名
 * @property {number} luoshu
 * @property {string} dir 方位名('中' 宮為 '中央')
 * @property {number} star 財位看向星、丁位看山星
 * @property {'wang'|'jin'|'yuan'} tier 旺(當運)、近旺、遠旺
 * @property {number} score cai(p) 或 ding(p)
 * @property {number} adjustedScore 財位模組用: 財星在後方時乘 BACK_WEALTH_FACTOR(設計值)
 * @property {'front'|'back'|'other'} side 相對位置(該宮是向宮、坐宮、其他)
 * @property {string} kind 財位: front='wangcai' back='back'(財星在後方,不列旺財位) other='ciwei'(次財位);
 *   丁位(推論,對稱處理): back='wangding' front='front'(山星在前方,靠處要補實) other='ciwei'
 * @property {number} pairAdjust 組合調整分
 * @property {string[]} pairTags 該宮的組合標籤(含次要組合)
 */

const TIER_OF_D = ['wang', 'jin', 'yuan'];

/**
 * 財位與丁位候選(規格 2.4.10)。
 *  cai(p)  = qi(X[p]) + wSide*qi(M[p]) + wYun*qi(Y[p]) + 組合調整(p)
 *  ding(p) = qi(M[p]) + wSide*qi(X[p]) + wYun*qi(Y[p]) + 組合調整(p)
 * 候選 = 向星(丁位用山星)屬 currentYun、+1、+2 的宮,依分數排序(同分依洛書數)。
 * 財位依格局分流(D30、R17): 向宮可列旺財位;坐宮標 wealthSide='back'(財星在後方,需後方見水或動水才有財),不列旺財位;
 * 其餘宮為次財位。權重 wSide、wYun 為工程折衷(D33,信心: 低)。
 * 組合調整的主次(山向為主、山運向運為次)只影響 pairTags 的順序,不改變調整分的權重: 規格沒有給次要組合的權重。
 * @param {import('./chart.js').Chart} chart
 * @param {number} currentYun
 * @param {{wSide?:number, wYun?:number, eightKeepsWealth?:boolean}} [opts]
 * @returns {{wealth: PositionCandidate[], ding: PositionCandidate[]}}
 */
export function wealthDingPositions(chart, currentYun, opts = {}) {
  assertYun(currentYun, 'currentYun');
  opts = opts ?? {};
  const wSide = opts.wSide ?? 0.3;
  const wYun = opts.wYun ?? 0.3;
  const q = (star) => qiScore(currentYun, star, opts);

  const build = (primaryKey, secondaryKey) => {
    const rows = [];
    for (const palace of PALACES) {
      const c = chart.palaces[palace];
      if (!isWangSheng(currentYun, c[primaryKey])) continue;
      const tags = pairTagsOfPalace(chart, palace);
      const adj = tags.reduce((s, t) => s + pairAdjust(t, currentYun), 0);
      const score = q(c[primaryKey]) + wSide * q(c[secondaryKey]) + wYun * q(c.yun) + adj;
      const side = palace === chart.facePalace ? 'front' : palace === chart.sitPalace ? 'back' : 'other';
      rows.push({
        palace,
        luoshu: LUOSHU[palace],
        dir: palace === '中' ? '中央' : dirOfGua(palace),
        star: c[primaryKey],
        tier: TIER_OF_D[qiDist(currentYun, c[primaryKey])],
        score,
        side,
        pairAdjust: adj,
        pairTags: tags.map((t) => t.tag),
      });
    }
    return rows.sort((a, b) => b.score - a.score || a.luoshu - b.luoshu);
  };

  const wealth = build('xiang', 'shan').map((r) => ({
    ...r,
    kind: r.side === 'front' ? 'wangcai' : r.side === 'back' ? 'back' : 'ciwei',
    adjustedScore: r.side === 'back' ? r.score * BACK_WEALTH_FACTOR : r.score,
  }));
  const ding = build('shan', 'xiang').map((r) => ({
    ...r,
    kind: r.side === 'back' ? 'wangding' : r.side === 'front' ? 'front' : 'ciwei',
    adjustedScore: r.score,
  }));
  return { wealth, ding };
}

/**
 * 九運財丁位表(向星、山星 9、1、2、8 各在哪一宮): 欄名依規格 2.4.10 更正。
 * `xiang9_at` = 向星 9 所在(**不等於旺財位**: 雙星會坐盤的向星 9 在坐宮,不算旺財);
 * `shan9_at` = 山星 9 所在(雙星會坐時為旺丁位)。舊 wealth9 表的 xiang9「旺財」欄會誤導,已廢止。
 * 星數固定 9、1、2、8(九運的旺、近旺、遠旺、退氣),與哪一運無關,方便直接對九運公開表。
 * @param {import('./chart.js').Chart} chart
 * @returns {Record<'xiang9_at'|'shan9_at'|'xiang1'|'shan1'|'xiang2'|'shan2'|'xiang8'|'shan8', string[]>} 宮位名(洛書數順序)
 */
export function nineStarPositions(chart) {
  const at = (plate, star) => PALACES.filter((p) => chart.palaces[p][plate] === star);
  return {
    xiang9_at: at('xiang', 9),
    shan9_at: at('shan', 9),
    xiang1: at('xiang', 1),
    shan1: at('shan', 1),
    xiang2: at('xiang', 2),
    shan2: at('shan', 2),
    xiang8: at('xiang', 8),
    shan8: at('shan', 8),
  };
}

// ─────────────────────────── 房間用途(D37,全部 tag=推論) ───────────────────────────

/**
 * @typedef {Object} RoomAdvice
 * @property {'bedroom'|'living'|'kitchen'|'bathroom'|'study'|'desk'} room
 * @property {string[]} prefer 傾向使用的宮位(推論)
 * @property {string[]} avoid 傾向避開的宮位(推論)
 * @property {string} rule 依據的規則摘要
 */

const hasKey = (chart, palace, key) => {
  const c = chart.palaces[palace];
  return [pairKey(c.shan, c.xiang), pairKey(c.shan, c.yun), pairKey(c.xiang, c.yun)].includes(key);
};

/**
 * 房間用途建議(規格 2.4.12;全部是推論,單一作者為主,多條無來源)。中宮是太極點,不當房間位置。
 * @param {import('./chart.js').Chart} chart
 * @param {number} currentYun
 * @param {{eightKeepsWealth?: boolean}} [opts]
 * @returns {RoomAdvice[]}
 */
export function roomAdvice(chart, currentYun, opts = {}) {
  assertYun(currentYun, 'currentYun');
  opts = opts ?? {};
  const ps = PALACES.filter((p) => p !== '中');
  const c = (p) => chart.palaces[p];
  const q = (s) => qiScore(currentYun, s, opts);
  const wang = (s) => isWangSheng(currentYun, s);
  const isBadStar = (s) => (s === 5 || s === 2) && s !== currentYun; // 5、2 且非當運

  const bedroomAvoid = (p) => isBadStar(c(p).shan) || isBadStar(c(p).xiang) || ['1-5', '3-5', '3-7'].some((k) => hasKey(chart, p, k));
  const shaXi = (p) => q(c(p).xiang) <= -1;

  const rooms = [
    {
      room: 'bedroom',
      prefer: ps.filter((p) => wang(c(p).shan) && q(c(p).xiang) >= 0 && !bedroomAvoid(p)),
      avoid: ps.filter(bedroomAvoid),
      rule: '山星旺/生、山向皆吉的宮;避開山星或向星為 5、2 的宮,以及一五、三五、三七組合',
    },
    {
      room: 'living',
      prefer: ps.filter((p) => wang(c(p).xiang) && !shaXi(p)),
      avoid: ps.filter((p) => shaXi(p) || (c(p).shan === 6 && c(p).xiang === 6) || pairKey(c(p).shan, c(p).xiang) === '2-6'),
      rule: '向星旺/生的宮並開門窗納氣;六六組合不宜開門、二六組合不宜有門路;煞氣宮不開門窗',
    },
    {
      room: 'kitchen',
      prefer: [],
      avoid: ps.filter((p) => hasKey(chart, p, '5-9') || hasKey(chart, p, '2-5')),
      rule: '避開五九宮(火生五黃)與二五宮(二五宮為推論,無來源)',
    },
    {
      room: 'bathroom',
      prefer: ps.filter((p) => (q(c(p).shan) <= -1 && q(c(p).xiang) <= -1) || c(p).shan === 5 || c(p).xiang === 5 || hasKey(chart, p, '2-5')),
      avoid: ps.filter((p) => wang(c(p).shan) || wang(c(p).xiang)),
      rule: '丁財皆死煞、五黃、二五交加的宮;不放旺星宮(無直接來源,推論)',
    },
    {
      room: 'study',
      prefer: ps.filter((p) => Object.keys(WENCHANG_KEYS).some((k) => hasKey(chart, p, k))),
      avoid: ps.filter((p) => hasKey(chart, p, '3-7') || hasKey(chart, p, '6-7')),
      rule: '文昌位只採一四(high)與三九(low,帶但書);避開三七、六七',
    },
    {
      room: 'desk',
      prefer: ps.filter((p) => q(c(p).shan) >= 1),
      avoid: ps.filter((p) => q(c(p).shan) <= -1),
      rule: '山星吉的宮;要催財再選向星旺的宮',
    },
  ];
  // 同一宮不可同時被推薦與避開(例: 五黃在山星、向星卻旺的宮,衛生間規則兩邊都命中): 以「避開」為準,寧可少推薦。
  return rooms.map((r) => ({ ...r, prefer: r.prefer.filter((p) => !r.avoid.includes(p)) }));
}

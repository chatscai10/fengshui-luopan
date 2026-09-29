// xuankong 測試專用: 宮位鍵 adapter(fixtures 用洛書數,實作用宮位名)與第二來源的獨立實作。
// 刻意不 import src/core,24 山環、陰陽名單、替星口訣都在這裡手打一份,
// 這樣「規則重算 == 實作內嵌表」與「奇偶簡式 == 二次轉換」才有比對意義(spec 4.2 第 6 點、4.4)。
import { GUA_OF_LUOSHU, LUOSHU } from './harness.js';

export const NUMS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
export const palaceOf = (n) => GUA_OF_LUOSHU[n];
export const numOf = (palace) => LUOSHU[palace];

/** chart.palaces(宮位名)→ { 洛書數: {shan, yun, xiang} }。 */
export const cellsByNum = (chart) =>
  Object.fromEntries(NUMS.map((n) => [n, { ...chart.palaces[GUA_OF_LUOSHU[n]] }]));

/** 單一平面(shan/xiang/yun)→ { 洛書數: 星 }。 */
export const planeByNum = (chart, key) =>
  Object.fromEntries(NUMS.map((n) => [n, chart.palaces[GUA_OF_LUOSHU[n]][key]]));

// ─────────────────────────── 獨立 oracle ───────────────────────────

/** 24 山環自壬起順時針,手打(規格 2.4.1 的 RING 名稱序)。 */
export const ORACLE_RING = Object.freeze([...'壬子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥']);
/** 每山所屬洛書宮,手打。 */
export const ORACLE_PALACE = Object.freeze([1, 1, 1, 8, 8, 8, 3, 3, 3, 4, 4, 4, 9, 9, 9, 2, 2, 2, 7, 7, 7, 6, 6, 6]);
const YANG = new Set([...'乾坤艮巽壬丙甲庚寅申巳亥']);
const FLY_PATH = [5, 6, 7, 8, 9, 1, 2, 3, 4];
const mod9 = (n) => ((((n - 1) % 9) + 9) % 9) + 1;

/** 替星口訣(A 表,蔣大鴻歌訣): 貪狼1 巨門2 武曲6 破軍7 右弼9,各句的山。 */
const TI_VERSE_A = [['子癸甲申', 1], ['壬卯乙未坤', 2], ['乾亥辰巽巳戌', 6], ['酉辛丑艮丙', 7], ['寅午庚丁', 9]];
/** 無常派 B 表口訣(陳澤泰《陽宅鏡》)。 */
export const TI_VERSE_B_TEXT = '坤壬乙2 艮丙辛7 巽辰亥6 甲癸申1 丑丁酉9 巳戌乾4 子卯未3 庚午寅8';

export function parseTiVerseA() {
  const t = {};
  for (const [group, star] of TI_VERSE_A) for (const ch of group) t[ch] = star;
  return t;
}

/** 解析「坤壬乙2 艮丙辛7 ...」形式的替星表。 */
export function parseTiDigitText(text) {
  const t = {};
  for (const m of text.matchAll(/([^\d\s:：]+)(\d)/g)) for (const ch of m[1]) t[ch] = Number(m[2]);
  return t;
}

const TI_ORACLE = { A: parseTiVerseA(), B: parseTiDigitText(TI_VERSE_B_TEXT) };

export function oracleFly(center, forward) {
  const out = {};
  FLY_PATH.forEach((n, i) => {
    out[n] = mod9(forward ? center + i : center - i);
  });
  return out;
}

/**
 * 免查表的奇偶簡式(規格 2.4.2 第 4 步): 入中星奇數(1,3,7,9)時,地元龍順、天元人元逆;
 * 偶數(2,4,6,8)時,地元龍逆、天元人元順。5 入中用山自身陰陽。
 * @param {number} star 入中星
 * @param {string} mountain 山名
 */
export function oracleForwardByParity(star, mountain) {
  const slot = ORACLE_RING.indexOf(mountain) % 3; // 0 地 1 天 2 人
  if (star === 5) return YANG.has(mountain);
  return star % 2 === 1 ? slot === 0 : slot !== 0;
}

/** 二次轉換的伴山: 星本宮內與該山同元龍的山。 */
export function oracleMate(star, mountain) {
  if (star === 5) return mountain;
  const slot = ORACLE_RING.indexOf(mountain) % 3;
  return ORACLE_RING.find((_, j) => ORACLE_PALACE[j] === star && j % 3 === slot);
}

/**
 * 獨立排盤。順逆用奇偶簡式,不查陰陽名單以外的表;替卦用口訣解析出的表。
 * @returns {{face:string, sit:string, shan:object, xiang:object, cells:Record<number,{shan:number,yun:number,xiang:number}>}}
 */
export function oracleChart(yun, sit, { ti = false, table = 'A' } = {}) {
  const i = ORACLE_RING.indexOf(sit);
  const face = ORACLE_RING[(i + 12) % 24];
  const Y = oracleFly(yun, true);
  const plate = (m) => {
    const star = Y[ORACLE_PALACE[ORACLE_RING.indexOf(m)]];
    const forward = oracleForwardByParity(star, m);
    const mate = oracleMate(star, m);
    const enter = ti && star !== 5 ? TI_ORACLE[table][mate] : star;
    return { star, enter, forward, mate, pan: oracleFly(enter, forward) };
  };
  const shan = plate(sit);
  const xiang = plate(face);
  const cells = {};
  for (const n of NUMS) cells[n] = { shan: shan.pan[n], yun: Y[n], xiang: xiang.pan[n] };
  return { sit, face, shan, xiang, cells, yunPan: Y };
}

/** 山向順逆兩位元 → 格局(獨立寫法)。 */
export function oraclePattern(shanForward, xiangForward) {
  if (!shanForward && !xiangForward) return '旺山旺向';
  if (shanForward && xiangForward) return '上山下水';
  return shanForward ? '雙星會向' : '雙星會坐';
}

/** 八卦環順序(後天,自北順時針)與洛書數,手打,供城門規則重算。 */
const RING8 = [['坎', 1], ['艮', 8], ['震', 3], ['巽', 4], ['離', 9], ['坤', 2], ['兌', 7], ['乾', 6]];

/** 城門規則重算: 向宮在八卦環上相鄰的兩宮,與向宮成河圖生成數(相差 5)者為正。 */
export function oracleChengmen(faceNum) {
  const k = RING8.findIndex(([, n]) => n === faceNum);
  const nb = [RING8[(k + 7) % 8][1], RING8[(k + 1) % 8][1]];
  const main = nb.find((n) => Math.abs(n - faceNum) === 5);
  const sub = nb.find((n) => n !== main);
  return [main, sub];
}

/** 距離規則(獨立寫法): d = (星 - 運) mod 9 → 五氣標籤。 */
export function oracleQiLabel(yun, star, scheme) {
  const d = (((star - yun) % 9) + 9) % 9;
  if (d === 0) return '旺';
  if (scheme === 'default') {
    if (d === 1) return '近旺生';
    if (d === 2) return '遠旺生';
    if (d === 8) return '退';
    return d >= 5 ? '煞衰' : '死';
  }
  if (scheme === 'S1') {
    if (d === 1) return '進';
    if (d === 2) return '生';
    return d >= 6 ? '退' : '死';
  }
  // S2
  if (d === 1) return '生';
  if (d === 2) return '進';
  if (d === 8) return '退';
  if (d === 7) return '衰';
  if (d === 6) return '死';
  return '煞';
}

/** 工程分數(獨立寫法,對應規格 2.4.8 表與上限)。 */
export function oracleQiScore(yun, star, { eightKeepsWealth = false } = {}) {
  const d = (((star - yun) % 9) + 9) % 9;
  let s = d === 0 ? 3 : d === 1 ? 2 : d === 2 ? 1 : d === 8 ? 0 : d >= 5 ? -1 : -2;
  if (star === 5 && yun !== 5) s = Math.min(s, -3);
  if (star === 2 && yun !== 2) s = Math.min(s, 0.5);
  if (eightKeepsWealth && star === 8 && s <= 0) s = 1;
  return s;
}

// annual 測試用的獨立資料與獨立算法。刻意不 import src/core/annual.js,期望值來自規格內嵌表或另一條算法路徑。
import assert from 'node:assert/strict';
import { isSoft } from './harness.js';

// ---------------------------------------------------------------- 時間與亂數小工具

/** 'YYYY-MM-DD HH:mm'(UTC+8)→ ms epoch。 */
export const cstMs = (s) => Date.parse(`${s.replace(' ', 'T')}${s.length <= 16 ? ':00' : ''}+08:00`);

/** 軟斷言: confidence=low 的案例只要求不崩潰(規格 4.2 第 2 點);AssertionError 吞掉,其他例外照丟。 */
export function hardOrSoft(c, runner) {
  if (!isSoft(c)) return runner(c);
  try {
    runner(c);
  } catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
  }
  return undefined;
}

export function throwsCode(fn, code) {
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
}

// ---------------------------------------------------------------- 流年中宮: 三條獨立算法(annual.json 驗證的三式)

const wrap9 = (n) => ((((n % 9) + 9) % 9) || 9);

/** 個位數字根(0 → 0)。 */
export function digitRoot(n) {
  let x = Math.abs(n);
  while (x > 9) x = String(x).split('').reduce((a, d) => a + Number(d), 0);
  return x;
}

/** 式 1: 三元甲子逐年走。上元 1864 起 1、中元 1924 起 4、下元 1984 起 7,每年 -1。 */
export function centerByThreeYuan(fy) {
  const d = (((fy - 1864) % 180) + 180) % 180;
  let c = [1, 4, 7][Math.floor(d / 60)];
  for (let i = 0; i < d % 60; i++) {
    c -= 1;
    if (c === 0) c = 9;
  }
  return c;
}

/** 式 2: 尾數和,11 減西曆年數字根(超過 9 再減 9)。 */
export function centerByDigitRoot(fy) {
  const c = 11 - digitRoot(fy);
  return c > 9 ? c - 9 : c;
}

/** 式 3: 世紀口訣(只適用 1900-2099)。1900-1999 用 100 減末兩位取數字根;2000-2099 用 9 減末兩位的數字根(0 得 9)。 */
export function centerByCentury(fy) {
  const yy = fy % 100;
  if (fy >= 1900 && fy < 2000) return digitRoot(100 - yy);
  if (fy >= 2000 && fy < 2100) return wrap9(9 - digitRoot(yy));
  throw new Error(`centerByCentury 只支援 1900-2099,收到 ${fy}`);
}

// ---------------------------------------------------------------- 月柱五虎遁與月中宮口訣

/** 五虎遁: 年干 → 寅月月干(甲己之年丙作首、乙庚之歲戊為頭、丙辛必定尋庚起、丁壬壬位順行流、戊癸甲寅好追求)。 */
export const FIVE_TIGER_FIRST_STEM = Object.freeze({
  甲: '丙', 己: '丙', 乙: '戊', 庚: '戊', 丙: '庚', 辛: '庚', 丁: '壬', 壬: '壬', 戊: '甲', 癸: '甲',
});

const STEM_STR = '甲乙丙丁戊己庚辛壬癸';
const MONTH_BRANCH_STR = '寅卯辰巳午未申酉戌亥子丑';

/** 某年干的 12 個月月柱(寅月到丑月),只用口訣表,不用取餘公式。 */
export function monthPillarsByFiveTigers(yearStem) {
  const s0 = STEM_STR.indexOf(FIVE_TIGER_FIRST_STEM[yearStem]);
  return Array.from({ length: 12 }, (_, i) => STEM_STR[(s0 + i) % 10] + MONTH_BRANCH_STR[i]);
}

/** 紫白月飛星口訣: 子午卯酉年寅月起八白、辰戌丑未年起五黃、寅申巳亥年起二黑。 */
export const MONTH_START_BY_BRANCH = Object.freeze({
  子: 8, 午: 8, 卯: 8, 酉: 8, 辰: 5, 戌: 5, 丑: 5, 未: 5, 寅: 2, 申: 2, 巳: 2, 亥: 2,
});

/** 某年支的 12 個月月中宮,逐月減 1(0 回 9),不用取餘公式。 */
export function monthCentersByKoujue(yearBranch) {
  let c = MONTH_START_BY_BRANCH[yearBranch];
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.push(c);
    c -= 1;
    if (c === 0) c = 9;
  }
  return out;
}

// ---------------------------------------------------------------- 規格內嵌表(docs/DOMAIN_SPEC.md 2.5.2 第 6、7 點)

/** 規格 2.5.2 第 6 點 JSON 原樣。 */
export const SPEC_SANSHA = Object.freeze({
  申子辰: { dir: '南', jie: '巳', zai: '午', sui: '未', jia: ['丙', '丁'] },
  亥卯未: { dir: '西', jie: '申', zai: '酉', sui: '戌', jia: ['庚', '辛'] },
  寅午戌: { dir: '北', jie: '亥', zai: '子', sui: '丑', jia: ['壬', '癸'] },
  巳酉丑: { dir: '東', jie: '寅', zai: '卯', sui: '辰', jia: ['甲', '乙'] },
});

/** 規格 2.5.2 第 7 點「四組弧(已重算)」逐字轉成 [起,迄] 半開區間;鍵為三煞方位。 */
export const SPEC_ARCS = Object.freeze({
  南: { core3: [[142.5, 157.5], [172.5, 187.5], [202.5, 217.5]], withJiaSha: [142.5, 217.5], branch12: [135, 225] },
  西: { core3: [[232.5, 247.5], [262.5, 277.5], [292.5, 307.5]], withJiaSha: [232.5, 307.5], branch12: [225, 315] },
  北: { core3: [[322.5, 337.5], [352.5, 7.5], [22.5, 37.5]], withJiaSha: [322.5, 37.5], branch12: [315, 45] },
  東: { core3: [[52.5, 67.5], [82.5, 97.5], [112.5, 127.5]], withJiaSha: [52.5, 127.5], branch12: [45, 135] },
});

/** 十二長生順序;三煞 = 三合局的絕、胎、養(第 10、11、12 位)。各局的長生位為四生: 申水、亥木、寅火、巳金。 */
export const TWELVE_STAGES = Object.freeze(['長生', '沐浴', '冠帶', '臨官', '帝旺', '衰', '病', '死', '墓', '絕', '胎', '養']);
export const TWELVE_BRANCHES = Object.freeze('子丑寅卯辰巳午未申酉戌亥'.split(''));
export const SHENG_OF_GROUP = Object.freeze({ 申子辰: '申', 亥卯未: '亥', 寅午戌: '寅', 巳酉丑: '巳' });

/** 由十二長生順行推出某局的絕、胎、養三支。 */
export function jueTaiYang(group) {
  const start = TWELVE_BRANCHES.indexOf(SHENG_OF_GROUP[group]);
  const at = (stage) => TWELVE_BRANCHES[(start + TWELVE_STAGES.indexOf(stage)) % 12];
  return { jie: at('絕'), zai: at('胎'), sui: at('養') };
}

/** 洛書順飛宮序(規格 1.3 與 annual.json conventions.flightOrder): 方位名、卦名、方位角。 */
export const SPEC_FLIGHT = Object.freeze([
  { dir: '中宮', gua: '中', bearing: null },
  { dir: '西北', gua: '乾', bearing: 315 },
  { dir: '西', gua: '兌', bearing: 270 },
  { dir: '東北', gua: '艮', bearing: 45 },
  { dir: '南', gua: '離', bearing: 180 },
  { dir: '北', gua: '坎', bearing: 0 },
  { dir: '西南', gua: '坤', bearing: 225 },
  { dir: '東', gua: '震', bearing: 90 },
  { dir: '東南', gua: '巽', bearing: 135 },
]);

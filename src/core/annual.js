// 流年、流月飛星、太歲/歲破/三煞、五黃二黑(規格 2.5,決策 D38-D42,附錄 A.6)。
// 規則出處: annual.json meta(conventions、referenceImplementation)與 DOMAIN_SPEC 2.5;annual 沒有研究報告(U-01)。
// 節氣天文與干支月柱屬 calendar,九宮與 24 山表屬 geo,這裡只放飛星與神煞規則,不重複實作兩者:
// 洛書宮序由 geo.LUOSHU 推出、太歲三煞的山名與方位角讀 geo.MOUNTAINS,不另外手打表(規格 4.2 第 6 點)。
// 純函式、無 DOM、無全域狀態、無網路;時間一律 ms since epoch (UTC),另附 *CST 顯示字串(四捨五入到分)。
//
// 錯誤碼(Error.message 開頭,後接冒號): INVALID_YEAR 年份不是整數 / INVALID_INSTANT(calendar 丟出)/
// INVALID_INPUT analyzeAnnual 的輸入不是「instant 與 fengshuiYear 恰好給一個」/ INVALID_BRANCH 地支不是 0-11 或十二支字元 /
// INVALID_MONTH_ORDER 月序不是 0-11 的整數 / INVALID_STAR 星數不是 1-9 的整數 / INVALID_ARC 弧不是 [起,迄] 兩個方位角 /
// INVALID_SETTING 設定值不合法。INVALID_BEARING 來自 geo。calendar 的 YEAR_OUT_OF_RANGE 會原樣穿出。

import { resolveSettings } from './settings.js';
import {
  BRANCHES, SUPPORTED_YEARS, formatCST, fengshuiYear, yearGanzhi, monthOf, monthTable, nineYun, lichunFlags,
} from './calendar.js';
import {
  GUA, MOUNTAINS, dirOfGua, guaOfLuoshu, guaOfMountain, normalizeBearing,
} from './geo.js';

// ---------------------------------------------------------------- 常數與內部工具

export const SCHEMA = 'fengshui.annual/1';

/** 中宮的方位名(annual.json 慣例)。 */
const CENTER_DIR = '中宮';
/** 一座山的寬度(度)。24 山約定見 geo。 */
const SHAN_WIDTH = 360 / MOUNTAINS.length;
/** 寅月(order 0)起始的月中宮,以年支 %3 分組: 子午卯酉(0)8、辰戌丑未(1)5、寅申巳亥(2)2(annual.json conventions.monthlyCenterFormula)。 */
export const MONTH_START_STAR = Object.freeze([8, 5, 2]);
/** 三合局的「生」位(四生: 申水、亥木、寅火、巳金),順序同規格 2.5.2 第 6 點的四組。 */
const SANSHA_SHENG = Object.freeze([8, 11, 2, 5]);
/** 可選的三煞弧層(D39);'withJia' 對應輸出 arcs.withJiaSha。 */
export const SANSHA_ARC_SETTINGS = Object.freeze(['core3', 'withJia', 'branch12']);
const ARC_KEY_OF_SETTING = Object.freeze({ core3: 'core3', withJia: 'withJiaSha', branch12: 'branch12' });

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

/** 錯誤訊息用的安全轉字串: BigInt、循環物件、Symbol、null 原型物件都不可讓「組錯誤訊息」本身丟出 TypeError。 */
function show(v) {
  try {
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function settingsOf(overrides) {
  let s;
  try {
    s = resolveSettings(overrides ?? {});
  } catch (e) {
    throw new Error(`INVALID_SETTING: ${e.message}`);
  }
  if (!SANSHA_ARC_SETTINGS.includes(s.sanshaArc)) fail('INVALID_SETTING', `sanshaArc=${show(s.sanshaArc)}`);
  return s;
}

function assertYear(fy) {
  if (!Number.isInteger(fy)) fail('INVALID_YEAR', `年份需為整數,收到 ${show(fy)}`);
}

function assertStar(n, what = '星') {
  if (!Number.isInteger(n) || n < 1 || n > 9) fail('INVALID_STAR', `${what}需為 1-9 的整數,收到 ${show(n)}`);
}

/** 地支 → 0-11。接受索引或十二支字元。 */
function branchIndexOf(b) {
  if (Number.isInteger(b) && b >= 0 && b <= 11) return b;
  const i = typeof b === 'string' ? BRANCHES.indexOf(b) : -1;
  if (i < 0) fail('INVALID_BRANCH', `需為 0-11 的整數或十二支字元,收到 ${show(b)}`);
  return i;
}

/** 1..9 循環,0 與 9 的倍數回 9(洛書數)。 */
export function wrap9(n) {
  if (!Number.isInteger(n)) fail('INVALID_STAR', `wrap9 需要整數,收到 ${show(n)}`);
  const r = ((n % 9) + 9) % 9;
  return r === 0 ? 9 : r;
}

/** 地支 index 對應的山(24 山表中地支山在偶數 index,規格 2.1.1)。 */
const branchMountain = (b) => MOUNTAINS[2 * b];

// ---------------------------------------------------------------- 九宮與飛星

/**
 * 洛書順飛宮序: 中宮、乾、兌、艮、離、坎、坤、震、巽(k=0..8),星 = 中宮星 + k。
 * 宮序由洛書數推出(第 k 個宮的洛書數 = wrap9(5+k)),方位角取自 geo 的八卦 index × 45。
 * @type {ReadonlyArray<Readonly<{k: number, gua: string, dir: string, bearing: number|null}>>}
 */
export const PALACES = Object.freeze(
  Array.from({ length: 9 }, (_, k) => {
    const gua = guaOfLuoshu(wrap9(5 + k));
    const center = gua === '中';
    return Object.freeze({ k, gua, dir: center ? CENTER_DIR : dirOfGua(gua), bearing: center ? null : 45 * GUA.indexOf(gua) });
  }),
);

/**
 * 流年中宮星。1864 上元甲子年 = 1,每年 -1(三元甲子 1/4/7 逐年走、尾數和 11-digitRoot、新浪數位法三式對 1864-2100 一致)。
 * @param {number} fy 風水年(立春換年後的年)
 * @returns {number} 1..9
 * @throws INVALID_YEAR
 */
export function annualCenter(fy) {
  assertYear(fy);
  return wrap9(1 - (fy - 1864));
}

/**
 * 流月中宮星。寅月(order 0)起始星依年支分組,之後每月 -1(annual.json conventions.monthlyCenterFormula)。
 * @param {number|string} yearBranch 年支(0-11 索引或字元);年支看立春換年,不看元旦
 * @param {number} order 月序 0=寅月(立春)...11=丑月(次年小寒)
 * @returns {number} 1..9
 * @throws INVALID_BRANCH, INVALID_MONTH_ORDER
 */
export function monthlyCenter(yearBranch, order) {
  const b = branchIndexOf(yearBranch);
  if (!Number.isInteger(order) || order < 0 || order > 11) fail('INVALID_MONTH_ORDER', `月序需為 0-11 的整數,收到 ${show(order)}`);
  return wrap9(MONTH_START_STAR[b % 3] - order);
}

/**
 * 飛布九宮,鍵為方位名(annual.json 慣例: 中宮、西北、西、東北、南、北、西南、東、東南),順序即宮序。
 * @param {number} center 中宮星 1..9
 * @returns {Record<string, number>}
 * @throws INVALID_STAR
 */
export function fly(center) {
  assertStar(center, '中宮星');
  return Object.fromEntries(PALACES.map((p) => [p.dir, wrap9(center + p.k)]));
}

/**
 * 飛布九宮,鍵為卦名(內部宮位識別,規格 1.3): 中、乾、兌、艮、離、坎、坤、震、巽。
 * @param {number} center 中宮星 1..9
 * @returns {Record<string, number>}
 * @throws INVALID_STAR
 */
export function flyByGua(center) {
  assertStar(center, '中宮星');
  return Object.fromEntries(PALACES.map((p) => [p.gua, wrap9(center + p.k)]));
}

/**
 * 某星落在哪個宮(方位名;5 入中時回 '中宮')。
 * @param {number} center 中宮星 1..9
 * @param {number} star 要找的星 1..9
 * @returns {string} 方位名
 * @throws INVALID_STAR
 */
export function palaceOfStar(center, star) {
  assertStar(center, '中宮星');
  assertStar(star);
  return PALACES[(((star - center) % 9) + 9) % 9].dir;
}

// ---------------------------------------------------------------- 太歲、歲破、三煞

/**
 * 太歲 = 年支,方位角為該地支山中心;歲破 = 對沖支(+6)。太歲位「動土」等民俗說法不進規格(2.5.2 第 5 點)。
 * @param {number|string} yearBranch 年支
 * @returns {{branch: string, bearing: number, gua: string, dir: string,
 *   suipo: string, suipoBearing: number, suipoGua: string, suipoDir: string}}
 * @throws INVALID_BRANCH
 */
export function taisui(yearBranch) {
  const b = branchIndexOf(yearBranch);
  const t = branchMountain(b);
  const p = branchMountain((b + 6) % 12);
  return {
    branch: t.name, bearing: t.centerDeg, gua: t.gua, dir: dirOfGua(t.gua),
    suipo: p.name, suipoBearing: p.centerDeg, suipoGua: p.gua, suipoDir: dirOfGua(p.gua),
  };
}

/**
 * 三煞表: 年支分四組三合局,三煞在對沖那一方的「劫煞、災煞、歲煞」= 該局的絕、胎、養(欽定協紀辨方書卷三、
 * 玄空館 2019-2028 表)。絕 = 生 + 9,胎、養依次 +1;夾煞 = 劫煞與災煞、災煞與歲煞之間的兩個天干山。
 * 由規則推出,與規格 2.5.2 第 6 點的內嵌表逐項一致(測試驗)。
 */
export const SANSHA_TABLE = Object.freeze(
  SANSHA_SHENG.map((sheng) => {
    const branches = [sheng, (sheng + 4) % 12, (sheng + 8) % 12];
    const jie = (sheng + 9) % 12;
    const zai = (jie + 1) % 12;
    const sui = (jie + 2) % 12;
    return Object.freeze({
      name: branches.map((b) => BRANCHES[b]).join(''),
      branches: Object.freeze(branches),
      dir: dirOfGua(guaOfMountain(BRANCHES[zai])),
      jie: BRANCHES[jie],
      zai: BRANCHES[zai],
      sui: BRANCHES[sui],
      jia: Object.freeze([MOUNTAINS[2 * jie + 1].name, MOUNTAINS[2 * zai + 1].name]),
    });
  }),
);

/** 以中心與左右各 half 度取半開弧 [起,迄)(跨 0 時 起 > 迄)。 */
const arcAround = (center, half) => [normalizeBearing(center - half), normalizeBearing(center + half)];

/**
 * 三煞位置與三層弧(D39)。三層弧永遠全部算出,`arc` 依設定 `sanshaArc` 取其一(預設 core3);
 * 夾煞資料永遠附上,是否顯示由 `showJiaSha`(= extraShensha)決定(D40)。力士、月煞不實作(U-02)。
 * @param {number|string} yearBranch 年支
 * @param {Partial<import('./settings.js').DEFAULT_SETTINGS>} [settings] 讀 sanshaArc、extraShensha
 * @returns {{group: string, dir: string, mountains: string, jieSha: string, zaiSha: string, suiSha: string, jiaSha: string[],
 *   arcs: {core3: number[][], withJiaSha: number[], branch12: number[]},
 *   arc: {layer: 'core3'|'withJiaSha'|'branch12', ranges: number[][]}, showJiaSha: boolean}}
 *   弧皆為半開區間 [起,迄) 的方位角(度),跨 0 度時 起 > 迄
 * @throws INVALID_BRANCH, INVALID_SETTING
 */
export function sansha(yearBranch, settings = {}) {
  const s = settingsOf(settings);
  const b = branchIndexOf(yearBranch);
  const g = SANSHA_TABLE.find((row) => row.branches.includes(b));
  const [jie, zai, sui] = [g.jie, g.zai, g.sui].map((name) => MOUNTAINS.find((m) => m.name === name));
  const arcs = {
    core3: [jie, zai, sui].map((m) => arcAround(m.centerDeg, SHAN_WIDTH / 2)),
    withJiaSha: arcAround(zai.centerDeg, 2.5 * SHAN_WIDTH),
    branch12: arcAround(zai.centerDeg, 3 * SHAN_WIDTH),
  };
  const layer = ARC_KEY_OF_SETTING[s.sanshaArc];
  return {
    group: g.name,
    dir: g.dir,
    mountains: g.jie + g.zai + g.sui,
    jieSha: g.jie,
    zaiSha: g.zai,
    suiSha: g.sui,
    jiaSha: [...g.jia],
    arcs,
    arc: { layer, ranges: layer === 'core3' ? arcs.core3.map((r) => [...r]) : [[...arcs[layer]]] },
    showJiaSha: s.extraShensha === true,
  };
}

/**
 * 方位角是否落在半開弧 [起,迄) 內(起 > 迄 表示跨 0 度)。
 * @param {number} bearing 度,任意有限實數
 * @param {[number, number]} arc [起,迄] 兩個方位角
 * @returns {boolean}
 * @throws INVALID_BEARING, INVALID_ARC
 */
export function inArc(bearing, arc) {
  if (!Array.isArray(arc) || arc.length !== 2) fail('INVALID_ARC', `弧需為 [起,迄],收到 ${show(arc)}`);
  const b = normalizeBearing(bearing);
  const from = normalizeBearing(arc[0]);
  const to = normalizeBearing(arc[1]);
  return from <= to ? b >= from && b < to : b >= from || b < to;
}

// ---------------------------------------------------------------- 流月表

/**
 * 風水年 fy 的 12 個月(寅月=立春 ... 丑月=次年小寒至次年立春),含月柱、月中宮與該月五黃二黑。
 * 月柱與月界由 calendar 提供(五虎遁、節氣瞬間);月中宮的年支看立春換年,所以 1 月的丑月用上一年年支。
 * @param {number} fy 風水年
 * @returns {Array<{order: number, jie: string, ganzhi: string, branch: number, stem: number, start: number, end: number,
 *   startCST: string, endCST: string, center: number, wuhuang: string, erhei: string}>} start/end 為 ms
 * @throws INVALID_YEAR
 */
export function monthlyTable(fy) {
  assertYear(fy);
  const yb = yearGanzhi(fy).branch;
  return monthTable(fy).map((row) => {
    const center = monthlyCenter(yb, row.order);
    return {
      order: row.order, jie: row.jieName, ganzhi: row.name, branch: row.branch, stem: row.stem,
      start: row.start, end: row.end, startCST: formatCST(row.start), endCST: formatCST(row.end),
      center, wuhuang: palaceOfStar(center, 5), erhei: palaceOfStar(center, 2),
    };
  });
}

// ---------------------------------------------------------------- 一次分析

function makeFinding({ id, level, title, body, confidence, tag, schoolNote, refs }) {
  return { id, level, title, body, confidence, tag, schoolNote, refs };
}

/**
 * 流年總覽(規格 2.5.1)。年一律用立春精確瞬間換(D38、D13 無開關),所以設定裡的 yearBoundary 不影響本函式;
 * 若呼叫端給了別的年界,`meta.warnings` 帶 'yearBoundaryIgnored',`meta.ruleset.yearBoundary` 仍回實際使用的 'lichun_exact'。
 * 只給 fengshuiYear 時無法得知月份,`month` 為 null。
 * @param {{instant?: number, fengshuiYear?: number}} input 恰好給一個: instant(ms epoch UTC)或 fengshuiYear(風水年)
 * @param {Partial<import('./settings.js').DEFAULT_SETTINGS>} [settings] 讀 yunSystem、sanshaArc、extraShensha、showMinorityTechniques
 * @returns {{
 *   year: {fengshuiYear: number, ganzhi: string, lichun: number, lichunCST: string, yun: number|null, yunYear: number|null, era: string},
 *   annual: {center: number, chart: Record<string, number>, chartByGua: Record<string, number>,
 *     wuhuang: string, erhei: string, wuhuangGua: string, erheiGua: string},
 *   month: null|{fengshuiYear: number, jie: string, ganzhi: string, order: number, start: number, end: number,
 *     startCST: string, endCST: string, center: number, chart: Record<string, number>, wuhuang: string, erhei: string},
 *   taisui: ReturnType<typeof taisui>, sansha: ReturnType<typeof sansha>,
 *   findings: Array<{id: string, level: string, title: string, body: string, confidence: string, tag: string, schoolNote: string, refs: string[]}>,
 *   approx: boolean,
 *   meta: {schema: string, ruleset: {yearBoundary: string, yunSystem: string, sanshaArc: string, extraShensha: boolean,
 *     showMinorityTechniques: boolean}, computedAtCST: string|null, warnings: string[]}}}
 *   時間欄位為 ms epoch,*CST 為 UTC+8 顯示字串(四捨五入到分)
 * @throws INVALID_INPUT, INVALID_INSTANT, INVALID_YEAR, INVALID_SETTING, YEAR_OUT_OF_RANGE
 */
export function analyzeAnnual(input, settings = {}) {
  const s = settingsOf(settings);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_INPUT', '需要 {instant} 或 {fengshuiYear} 物件');
  }
  const hasInstant = input.instant !== undefined;
  const hasYear = input.fengshuiYear !== undefined;
  if (hasInstant === hasYear) fail('INVALID_INPUT', '需要 instant 或 fengshuiYear 其中一個,不可同時給或都不給');

  const warnings = [];
  const findings = [];
  const ms = hasInstant ? input.instant : null;
  const fy = hasInstant ? fengshuiYear(ms, { yearBoundary: 'lichun_exact' }) : input.fengshuiYear;
  assertYear(fy);

  if (s.yearBoundary !== 'lichun_exact') warnings.push('yearBoundaryIgnored');

  const gz = yearGanzhi(fy);
  const lichunMs = monthTable(fy)[0].start; // 寅月的起點就是立春瞬間
  const center = annualCenter(fy);
  let approx = fy < SUPPORTED_YEARS.min || fy > SUPPORTED_YEARS.max;

  // 二元八運只涵蓋 1996-2043;超出時不讓整份流年報告失敗(飛星與神煞與運無關),運欄位給 null 並標警告。
  let yun;
  try {
    yun = nineYun(fy, { yunSystem: s.yunSystem });
  } catch (e) {
    if (!e.message.startsWith('YUN_SYSTEM_RANGE:')) throw e;
    warnings.push('yunSystemOutOfRange');
    yun = { yun: null, yunYear: null, era: nineYun(fy, { yunSystem: 'san_yuan_9' }).era };
  }

  const chart = fly(center);
  const chartByGua = flyByGua(center);
  const wuhuang = palaceOfStar(center, 5);
  const erhei = palaceOfStar(center, 2);
  const guaOfDirName = (dir) => PALACES.find((p) => p.dir === dir).gua;

  let month = null;
  if (ms !== null) {
    const mo = monthOf(ms);
    const mc = monthlyCenter(gz.branch, mo.order);
    approx = approx || mo.approx;
    month = {
      fengshuiYear: fy, jie: mo.jieName, ganzhi: mo.name, order: mo.order,
      start: mo.start, end: mo.end, startCST: formatCST(mo.start), endCST: formatCST(mo.end),
      center: mc, chart: fly(mc), wuhuang: palaceOfStar(mc, 5), erhei: palaceOfStar(mc, 2),
    };
    if (lichunFlags(ms, true).nearLichun) {
      warnings.push('nearLichun');
      findings.push(makeFinding({
        id: 'annual.year.near_lichun', level: 'caution', title: '接近立春交界',
        body: '這個時刻距離立春不到 2 分鐘,官方曆表的分鐘數本身也有 1 分鐘上下的出入,屬前一年還是後一年可能要再確認,建議核對時分。',
        confidence: 'high', tag: 'design', schoolNote: '曆表以四捨五入到分鐘公布,不同來源可差 1 分鐘', refs: ['DOMAIN_SPEC.md#2.2.3', 'DOMAIN_SPEC.md#2.5.3'],
      }));
    }
  }
  if (approx) warnings.push('approxRange');

  const ss = sansha(gz.branch, s);
  if (s.extraShensha) {
    warnings.push('extraShenshaPartial'); // 力士、月煞算法未整理(U-02),只提供夾煞
    findings.push(makeFinding({
      id: 'annual.sansha.jiasha', level: 'note', title: '夾煞(三煞方內的兩個山)',
      body: `少數流派主張,今年三煞方(${ss.dir}方,${ss.mountains}三山)裡夾著的${ss.jiaSha.join('、')}兩個山也要一併留意。這是少數說法,本 App 預設不採用。`,
      confidence: 'low', tag: 'minority', schoolNote: '夾煞、力士、月煞屬少數單一來源說法,各派看法不一', refs: ['DOMAIN_SPEC.md#2.5.2', 'DOMAIN_SPEC.md#D40'],
    }));
  }
  if (s.showMinorityTechniques) {
    findings.push(makeFinding({
      id: 'annual.sansha.facing_not_sitting', level: 'note', title: '三煞方「宜向不宜坐」',
      body: `少數流派主張,今年三煞方(${ss.dir}方)可以朝向、但不宜背靠。這是單一來源的說法,本 App 預設不採用。`,
      confidence: 'low', tag: 'minority', schoolNote: '此說僅見於單一來源(闻道國學),各派看法不一', refs: ['annual.json#taisui_sansha', 'DOMAIN_SPEC.md#2.5.2'],
    }));
  }

  return {
    year: {
      fengshuiYear: fy, ganzhi: gz.name, lichun: lichunMs, lichunCST: formatCST(lichunMs),
      yun: yun.yun, yunYear: yun.yunYear, era: yun.era,
    },
    annual: {
      center, chart, chartByGua, wuhuang, erhei, wuhuangGua: guaOfDirName(wuhuang), erheiGua: guaOfDirName(erhei),
    },
    month,
    taisui: taisui(gz.branch),
    sansha: ss,
    findings,
    approx,
    meta: {
      schema: SCHEMA,
      ruleset: {
        yearBoundary: 'lichun_exact', yunSystem: s.yunSystem, sanshaArc: s.sanshaArc,
        extraShensha: s.extraShensha, showMinorityTechniques: s.showMinorityTechniques,
      },
      computedAtCST: ms === null ? null : formatCST(ms),
      warnings,
    },
  };
}

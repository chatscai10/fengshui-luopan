// 玄空飛星山向盤(規格 2.4): 山向盤(運/山/向三盤)、下卦與替卦、格局、五氣、星組合、財丁位、特殊格局。
// 純函式、無 DOM、無全域狀態、無網路;時間一律 ms epoch。依賴 geo(24 山與兼向判定)與 calendar(立春交運)。
//
// 錯誤碼(Error.message 開頭): 沿用 geo 的 INVALID_BEARING、UNKNOWN_MOUNTAIN、INVALID_OPTION;
// 沿用 calendar 的 INVALID_INSTANT、YUN_SYSTEM_RANGE、INVALID_SETTING;
// 本模組自訂: INVALID_YUN、INVALID_STAR、INVALID_PALACE、MISSING_INPUT(缺必要輸入)、INVALID_INPUT(輸入互相矛盾)。
import { DEFAULT_SETTINGS, resolveSettings } from './settings.js';
import { MOUNTAINS, mountainIndex } from './geo.js';
import { yunOfInstant, formatCST } from './calendar.js';
import {
  fail,
  assertYun,
  buildChart,
  locateFacing,
} from './xuankong/chart.js';
import {
  heshi,
  heshiPalaces,
  parent3,
  lianshu3,
  qixing,
  localYin,
  chengmen,
} from './xuankong/specials.js';
import {
  qiByPalace,
  qiScore,
  pairTagsOfPalace,
  wealthDingPositions,
  roomAdvice,
} from './xuankong/assess.js';
import { buildFindings } from './xuankong/findings.js';
import { PALACES } from './xuankong/tables.js';

export {
  PALACES,
  FLY_ORDER,
  FLY_PATH,
  RING,
  TI_TABLES,
  PATTERN_NAMES,
  PATTERN_BY_DIRECTIONS,
  CHENGMEN,
  STAR_INFO,
  STAR_YUN9,
  QI_SCHEMES,
  QI_LABEL_TEXT,
  QI_SCORE_BY_D,
  PAIR_TAGS,
  WENCHANG_KEYS,
  BACK_WEALTH_FACTOR,
  FORM_MATRIX,
  palaceOfStar,
} from './xuankong/tables.js';
export {
  fly,
  yunPan,
  direction,
  buildChart,
  patternOfDirections,
  classifyChart,
  wholePlate,
  listPatterns,
  locateFacing,
  mountainInfo,
  palacesWithStar,
  luoshuOf,
} from './xuankong/chart.js';
export { heshi, heshiPalaces, parent3, lianshu3, qixing, localYin, chengmen } from './xuankong/specials.js';
export {
  qiDist,
  qiLabel,
  qiScore,
  qiByPalace,
  pairTag,
  pairTagsOfPalace,
  pairAdjust,
  wealthDingPositions,
  nineStarPositions,
  roomAdvice,
} from './xuankong/assess.js';
export { buildFindings } from './xuankong/findings.js';

// ─────────────────────────── 元運與入運(規格 2.4.4、D11、D12) ───────────────────────────

/** 設定合併: overrides 為 null 視同沒給;未知鍵的錯誤加上 INVALID_OPTION 碼(settings.js 丟的是無碼的錯誤)。 */
function settingsOf(overrides) {
  try {
    return resolveSettings(overrides ?? {});
  } catch (e) {
    if (/^[A-Z_]+: /.test(e.message)) throw e;
    return fail('INVALID_OPTION', e.message);
  }
}

const NORTH_MODES = Object.freeze(['magnetic', 'true']);
const YUN_BASES = Object.freeze(['built', 'moveIn']);
const RENOVATIONS = Object.freeze(['none', 'partial', 'full', 'anyRenovation']);
/** 前後 3 分鐘的運不同 = 落在交運的立春臨界(門檻比 calendar 的 2 分鐘多一分鐘,吸收官方表 ±1 分歧義)。 */
const BOUNDARY_PROBE_MS = 3 * 60000;

/**
 * @typedef {Object} YunResolution
 * @property {number} chartYun 排盤與格局名稱用的運(建成年的運;大修完工或遷入依設定)
 * @property {number} currentYun 旺衰與財丁位判讀用的運(今日所屬的運)
 * @property {'explicit'|'built'|'moveIn'|'renovation'} basis chartYun 的依據
 * @property {number|null} basisInstant 依據的瞬間(ms),explicit 時為 null
 * @property {boolean} differs chartYun 與 currentYun 是否不同(老宅,規格 U-10)
 * @property {string[]} warnings nearYunBoundary(依據瞬間落在交運的立春臨界)、approxRange(超出 calendar 支援年份)、
 *   renovationDateIgnored、partialRenovationNotCounted
 * @property {string|null} schoolNote 依據的流派說明(遷入與大修的判準無共識,D11、U-18)
 */

/**
 * 決定 chartYun(排盤)與 currentYun(判讀),兩者分離(規格 2.4.4)。交運界線一律用立春精確瞬間(D13)。
 *  - chartYun 預設 = 建成瞬間的運(多數科普文章預設落成年);`yunBasis='moveIn'` 改用遷入時的運;
 *    `renovation` 為 'full'(整戶翻新)或 'anyRenovation'(任何裝潢皆換運)時,改以大修完工瞬間的運起盤。
 *  - currentYun = `now` 所屬的運。
 * 明確給 chartYun / currentYun(1..9)時直接採用,不查 calendar。
 * @param {{builtAt?:number, movedInAt?:number, renovatedAt?:number, now?:number, chartYun?:number, currentYun?:number}} input 時間為 ms epoch
 * @param {Partial<typeof DEFAULT_SETTINGS>} [overrides] 讀 yunBasis、renovation、yunSystem
 * @returns {YunResolution}
 * @throws {Error} INVALID_YUN, MISSING_INPUT, INVALID_OPTION, 以及 calendar 的 INVALID_INSTANT、YUN_SYSTEM_RANGE
 */
export function resolveYuns(input, overrides = {}) {
  if (input === null || typeof input !== 'object') fail('MISSING_INPUT', 'input 必須是物件');
  const s = settingsOf(overrides);
  if (!YUN_BASES.includes(s.yunBasis)) fail('INVALID_OPTION', `yunBasis 不認得: ${JSON.stringify(s.yunBasis)}`);
  if (!RENOVATIONS.includes(s.renovation)) fail('INVALID_OPTION', `renovation 不認得: ${JSON.stringify(s.renovation)}`);
  const yunOf = (ms) => yunOfInstant(ms, { yunSystem: s.yunSystem });
  const warnings = [];

  let currentYun;
  if (input.currentYun !== undefined) {
    assertYun(input.currentYun, 'currentYun');
    currentYun = input.currentYun;
  } else if (input.now !== undefined) {
    currentYun = yunOf(input.now).yun;
  } else {
    fail('MISSING_INPUT', 'currentYun 或 now(ms)至少要給一個');
  }

  let chartYun;
  let basis;
  let basisInstant = null;
  if (input.chartYun !== undefined) {
    assertYun(input.chartYun, 'chartYun');
    chartYun = input.chartYun;
    basis = 'explicit';
  } else {
    const renovationCounts = s.renovation === 'full' || s.renovation === 'anyRenovation';
    if (renovationCounts && input.renovatedAt === undefined) {
      fail('MISSING_INPUT', `renovation='${s.renovation}' 需要 renovatedAt(大修完工的 ms)`);
    }
    if (renovationCounts) {
      basis = 'renovation';
      basisInstant = input.renovatedAt;
    } else {
      if (input.renovatedAt !== undefined) {
        warnings.push(s.renovation === 'partial' ? 'partialRenovationNotCounted' : 'renovationDateIgnored');
      }
      basis = s.yunBasis;
      basisInstant = s.yunBasis === 'moveIn' ? input.movedInAt : input.builtAt;
      if (basisInstant === undefined) {
        fail('MISSING_INPUT', s.yunBasis === 'moveIn' ? "yunBasis='moveIn' 需要 movedInAt(遷入的 ms)" : '需要 builtAt(建成的 ms)或明確的 chartYun');
      }
    }
    const info = yunOf(basisInstant);
    chartYun = info.yun;
    if (info.approx) warnings.push('approxRange');
    if (yunOf(basisInstant - BOUNDARY_PROBE_MS).yun !== yunOf(basisInstant + BOUNDARY_PROBE_MS).yun) warnings.push('nearYunBoundary');
  }

  return {
    chartYun,
    currentYun,
    basis,
    basisInstant,
    differs: chartYun !== currentYun,
    warnings,
    schoolNote: basis === 'moveIn' || basis === 'renovation'
      ? '入運依據(遷入或大修)各派意見不同,多數科普文章預設以落成年的運起盤'
      : null,
  };
}

// ─────────────────────────── 輸入整理 ───────────────────────────

/** 向的方位角: `facing` 為數字或 {xuankong: 數字}(規格 2.1.6 的宅向),或改給 `facingMountain`(24 山名,取山中心)。 */
function pickBearing(input) {
  const { facing, facingMountain } = input;
  if (facing !== undefined && facingMountain !== undefined) fail('INVALID_INPUT', 'facing 與 facingMountain 只能給一個');
  if (facingMountain !== undefined) return MOUNTAINS[mountainIndex(facingMountain)].centerDeg;
  if (facing === undefined) fail('MISSING_INPUT', '需要 facing(向的方位角,或 {xuankong})或 facingMountain');
  if (facing !== null && typeof facing === 'object') {
    if (facing.xuankong === undefined) fail('MISSING_INPUT', 'facing 物件需要 xuankong 欄位(宅向)');
    return facing.xuankong;
  }
  return facing;
}

function assertFiniteNumber(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('INVALID_OPTION', `${name} 必須是有限數字: ${String(v)}`);
}

// ─────────────────────────── 全局伏吟反吟的處理(規格 2.4.7、D29) ───────────────────────────

/**
 * 全局伏吟: 嚴重,扣 fuyinPenalty。全局反吟: 一律警示;旺山旺向且仍在當運才不扣(「旺運可發、退運立敗」,ZGGDFS-60),
 * 否則扣 fanyinPenalty 並註明退運會轉不利。舊建議「全局反吟只提示不扣分」無來源支持,已廢止。扣分是工程值(信心: 低)。
 * 「仍在當運」以 currentYun === chartYun 判定: 規格原文寫「反吟之星為 chartYun 當運之星」,字面上 5 入中的反吟盤
 * 不可能同時滿足(五運沒有 5 入中),所以取「旺山旺向且此盤的運仍是今日的運」這個可執行的讀法。
 */
function assessWholePlate(chart, currentYun, s) {
  const penalties = [];
  for (const [key, plate] of [['shan', '山'], ['xiang', '向']]) {
    const kind = chart.wholePlate[key];
    if (kind === '伏吟') penalties.push({ plate, kind, points: s.fuyinPenalty, waived: false });
    else if (kind === '反吟') {
      const waived = chart.pattern === '旺山旺向' && currentYun === chart.meta.chartYun;
      penalties.push({ plate, kind, points: waived ? 0 : s.fanyinPenalty, waived });
    }
  }
  return {
    shan: chart.wholePlate.shan,
    xiang: chart.wholePlate.xiang,
    penalties,
    penaltyTotal: penalties.reduce((sum, p) => sum + p.points, 0),
  };
}

// ─────────────────────────── 主分析 ───────────────────────────

/**
 * 玄空完整分析(規格 2.4.13)。步驟: 向方位角 → geo 定向山與兼向 → 坐山 = 對山 → 元運(chartYun 與 currentYun 分離)
 * → buildChart(替卦只在 `useTiGua` 且 needsTiGua 時用)→ 格局、特殊格局、五氣、星組合、財丁位、Finding。
 * @param {{facing?: number|{xuankong:number}, facingMountain?: string, builtAt?:number, movedInAt?:number, renovatedAt?:number,
 *   now?:number, chartYun?:number, currentYun?:number, northMode?:'magnetic'|'true', declination?:number, declinationDate?:string}} input
 *   向的方位角(度,已依 northMode 換算好);時間為 ms epoch;`now` 必須由呼叫端給(本函式不讀時鐘);
 *   northMode、declination、declinationDate 只驗證並回存到 meta
 * @param {Partial<typeof DEFAULT_SETTINGS>} [overrides] 流派開關,未知鍵丟錯
 * @returns {{
 *   meta: {schema:string, ruleset:object, chartYun:number, currentYun:number, yun:YunResolution, northMode:string,
 *     declination:number|null, declinationDate:string|null, computedAtCST:string|null, warnings:string[]},
 *   locate: import('./xuankong/chart.js').FacingLocation,
 *   chart: import('./xuankong/chart.js').Chart,
 *   pattern: string,
 *   wholePlate: {shan:string|null, xiang:string|null, penalties:Array<{plate:string, kind:string, points:number, waived:boolean}>, penaltyTotal:number},
 *   specials: {heshi:{whole:string|null, localPalaces:string[]}, parent3:boolean, qixing:object|null, lianshu:boolean,
 *     localYin:{fuyin:object[], fanyin:object[]}, chengmen:object},
 *   qi: {byPalace: object},
 *   pairTags: {byPalace: Record<string, object[]>},
 *   positions: {wealth: object[], ding: object[]},
 *   findings: Array<import('./geo.js').Finding>
 * }}
 * @throws {Error} INVALID_BEARING, MISSING_INPUT, INVALID_INPUT, INVALID_YUN, INVALID_OPTION, UNKNOWN_MOUNTAIN, calendar 的錯誤碼
 */
export function analyzeXuankong(input, overrides = {}) {
  if (input === null || typeof input !== 'object') fail('MISSING_INPUT', 'input 必須是物件');
  const s = settingsOf(overrides);
  for (const k of ['fuyinPenalty', 'fanyinPenalty', 'wSide', 'wYun']) assertFiniteNumber(s[k], k);
  // 方位基準連同結果一起存(規格 1.3): 向的方位角已經是呼叫端依 northMode 換算好的,這裡只驗證並回存。
  if (input.northMode !== undefined && !NORTH_MODES.includes(input.northMode)) {
    fail('INVALID_OPTION', `northMode 必須是 magnetic 或 true: ${JSON.stringify(input.northMode)}`);
  }
  if (input.declination !== undefined) assertFiniteNumber(input.declination, 'declination');

  const locate = locateFacing(pickBearing(input), s);
  const yuns = resolveYuns(input, s);
  const { chartYun, currentYun } = yuns;

  const useTi = s.useTiGua && locate.needTi;
  const chart = buildChart(chartYun, locate.sit, { ti: useTi, tiTable: s.tiTable });
  chart.meta = {
    chartYun,
    currentYun,
    sit: chart.meta.sit,
    face: chart.meta.face,
    ti: chart.meta.ti,
    tiTable: chart.meta.tiTable,
  };

  const qiOpts = { qiScheme: s.qiScheme, eightKeepsWealth: s.eightKeepsWealth };
  const wholePlate = assessWholePlate(chart, currentYun, s);
  const specials = {
    heshi: { whole: heshi(chart), localPalaces: heshiPalaces(chart) },
    parent3: parent3(chart),
    qixing: qixing(chart),
    lianshu: lianshu3(chart),
    localYin: localYin(chart, { penalizedWhen: (star) => qiScore(currentYun, star, qiOpts) < 0 }),
    chengmen: chengmen(chart, currentYun),
  };
  const qi = { byPalace: qiByPalace(chart, currentYun, qiOpts) };
  const pairTags = { byPalace: Object.fromEntries(PALACES.map((p) => [p, pairTagsOfPalace(chart, p)])) };
  const positions = wealthDingPositions(chart, currentYun, { wSide: s.wSide, wYun: s.wYun, eightKeepsWealth: s.eightKeepsWealth });
  const rooms = roomAdvice(chart, currentYun, qiOpts);

  const findings = buildFindings({
    locate,
    chart,
    currentYun,
    chartYun,
    settings: s,
    wholePlate,
    specials,
    pairTags: pairTags.byPalace,
    positions,
    rooms,
    localYin: specials.localYin,
  });

  const warnings = [...yuns.warnings];
  if (locate.ridingLine) warnings.push('ridingLine');
  if (locate.geo.retest) warnings.push('retest');
  if (locate.needTi && !useTi) warnings.push('tiSuggested');
  if (yuns.differs) warnings.push('chartYunDiffersFromCurrent');

  return {
    meta: {
      schema: 'fengshui.xuankong/1',
      ruleset: {
        xiaGuaHalfWidth: s.xiaGuaHalfWidth,
        jianLimitSchool: s.jianLimitSchool,
        kongwangLabelScheme: s.kongwangLabelScheme,
        measureUncertainty: s.measureUncertainty,
        yunBasis: s.yunBasis,
        renovation: s.renovation,
        yunSystem: s.yunSystem,
        useTiGua: s.useTiGua,
        tiTable: s.tiTable,
        qiScheme: s.qiScheme,
        eightKeepsWealth: s.eightKeepsWealth,
        fuyinPenalty: s.fuyinPenalty,
        fanyinPenalty: s.fanyinPenalty,
        showLianshu: s.showLianshu,
        showChengmen: s.showChengmen,
        wSide: s.wSide,
        wYun: s.wYun,
      },
      chartYun,
      currentYun,
      yun: yuns,
      northMode: input.northMode ?? s.northMode,
      declination: input.declination ?? null,
      declinationDate: input.declinationDate ?? null,
      computedAtCST: input.now === undefined ? null : formatCST(input.now),
      warnings,
    },
    locate,
    chart,
    pattern: chart.pattern,
    wholePlate,
    specials,
    qi,
    pairTags,
    positions,
    findings,
  };
}

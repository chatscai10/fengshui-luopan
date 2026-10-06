// 分析門面(規格 1.1 依賴圖最上層): 把 geo、calendar、bazhai、xuankong、annual、plan、wealth 的真實輸出組成一份 HouseReport,
// 並把各模組的 warnings 與缺資料情形彙整成 Finding。UI 只需要呼叫 analyzeHouse,再交給 copy.js 的 renderReport 轉成白話文案。
// 純函式、無 DOM、無全域狀態、無網路;時間一律 ms since epoch;輸入不被修改;輸出 JSON 可序列化且決定性。
//
// 缺輸入盡量降級而不是丟錯(沒住戶就不做本命財位、沒建成年份就略過玄空盤、沒平面圖只給暗財位、平面圖不合法就當作沒有平面圖),
// 降級的原因一律寫成 Finding(id 以 house. 開頭)。只有「型別根本錯誤」才丟錯,錯誤碼在 message 開頭、後接冒號:
//   INVALID_INPUT     input 或其欄位的型別不對(不是物件、nowMs 不是有限數字、building.type 不認得、residents 的 id 重複、plan 不是物件…)
//   INVALID_BEARING   facing.bearing 或 facing.doorBearing 不是有限數字(規格 2.1.8)
//   INVALID_SETTING   settingsOverrides 含未知鍵或 northMode 不是 magnetic/true(規格未列,自訂)
//   其餘錯誤碼原樣穿出 geo、calendar、bazhai、xuankong、annual、wealth 的錯誤(例如 INVALID_DECLINATION、YEAR_OUT_OF_RANGE)。
//
// 設計決定(規格沒有寫死,詳見 docs/API.md):
//  - 不採用 analyzeBearing 自帶的 geo.near_gua_boundary: 它針對「向」的卦界,文案卻寫「宅卦」,宅卦是由坐決定的,
//    所以宅卦臨界只採 bazhai 的 bz.house.near_gua_boundary。
//  - facing.bearing 視為最終宅向(玄空用);只有 settings.facingPolicy='door' 且有 doorBearing 時改用大門朝向。
//  - building.builtYear 等只有年份: 以該年 7 月 1 日 12:00(UTC+8)代表,交運年(立春前後運不同)另給 Finding。
//  - building.renovation 若有給,就是這次分析的 renovation 設定,除非 settingsOverrides 明寫了 renovation。
import { resolveSettings } from './settings.js';
import {
  analyzeBearing,
  boundaryOptsFromSettings,
  compareMagVsTrue,
  normalizeBearing,
  oppositeOf,
  pickFacing,
  sitFromFacing,
  toTrue,
  circularDiff,
} from './geo.js';
import { formatCST, nineYun, toInstant, utcOffsetFor } from './calendar.js';
import { analyzeBazhai } from './bazhai.js';
import { analyzeXuankong } from './xuankong.js';
import { analyzeAnnual } from './annual.js';
import { PROFILES, analyzeWealth } from './wealth.js';
import { sectorShares, validatePlan } from './plan.js';

export const HOUSE_SCHEMA = 'fengshui.house/1';

/** 分數轉三段標籤的門檻(規格 5.1 第 10 點;設計值,tag=設計)。比值 = 分數 / 該設定下的分數上限。 */
export const WEALTH_TIERS = Object.freeze({ suitable: 0.6, consider: 0.35 });

/**
 * 分數轉三段標籤。顯示層不得顯示精確分數;分數只用來排序,不可跨設定比較。
 * @param {number|null} score
 * @param {number} cap 該次分析的分數上限(meta.scoreCap;暗財位用宮位能量的上限)
 * @returns {'suitable'|'consider'|'notAdvised'}
 */
export function wealthTier(score, cap) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0 || !(cap > 0)) return 'notAdvised';
  const r = score / cap;
  if (r >= WEALTH_TIERS.suitable) return 'suitable';
  if (r >= WEALTH_TIERS.consider) return 'consider';
  return 'notAdvised';
}

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => {
  if (typeof v === 'string') return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const round0 = (x) => Math.floor(x + 0.5);

const BUILDING_TYPES = Object.freeze(['apartment', 'house', 'shop', 'office']);
const RENOVATIONS = Object.freeze(['none', 'partial', 'full', 'anyRenovation']);
const NORTH_MODES = Object.freeze(['magnetic', 'true']);
const COUNTING_RENOVATIONS = Object.freeze(['full', 'anyRenovation']);
const WEALTH_PASS_KEYS = Object.freeze(['flags', 'candidateRoomIds', 'doorOverride', 'shielded']);
const BIRTH_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;
const YEAR_MIN = 1000;
const YEAR_MAX = 3000;

// ─────────────────────────── 輸入整理 ───────────────────────────

const clone = (v) => JSON.parse(JSON.stringify(v));

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 分鐘偏移轉 '+08:00'。 */
function offsetString(minutes) {
  const a = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

/** 某年 7 月 1 日 12:00(UTC+8)的 ms,代表只知道年份時的「該年中」。 */
function midYearMs(year) {
  const d = new Date(0);
  d.setUTCFullYear(year, 6, 1);
  d.setUTCHours(4, 0, 0, 0);
  return d.getTime();
}

function readYear(v, name) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < YEAR_MIN || v > YEAR_MAX) fail('INVALID_INPUT', `${name} 必須是 ${YEAR_MIN}-${YEAR_MAX} 的整數年份或 null: ${show(v)}`);
  return v;
}

function readBuilding(b) {
  if (b === undefined || b === null) return null;
  if (!isObj(b)) fail('INVALID_INPUT', `building 必須是物件或 null: ${show(b)}`);
  if (!BUILDING_TYPES.includes(b.type)) fail('INVALID_INPUT', `building.type 必須是 ${BUILDING_TYPES.join('/')}: ${show(b.type)}`);
  if (b.renovation !== undefined && b.renovation !== null && !RENOVATIONS.includes(b.renovation)) {
    fail('INVALID_INPUT', `building.renovation 必須是 ${RENOVATIONS.join('/')}: ${show(b.renovation)}`);
  }
  if (b.floor !== undefined && b.floor !== null && !isNum(b.floor)) fail('INVALID_INPUT', `building.floor 必須是數字或 null: ${show(b.floor)}`);
  return {
    type: b.type,
    builtYear: readYear(b.builtYear, 'building.builtYear'),
    moveInYear: readYear(b.moveInYear, 'building.moveInYear'),
    renovatedYear: readYear(b.renovatedYear, 'building.renovatedYear'),
    renovation: b.renovation ?? null,
    floor: isNum(b.floor) ? b.floor : null,
  };
}

/**
 * 出生字串 → {local, timeKnown}。格式不對或日期不存在回 null(降級為「資料不完整」)。
 * @param {string} s 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD'
 */
function parseBirth(s) {
  const m = BIRTH_RE.exec(s.trim());
  if (!m) return null;
  const timeKnown = m[4] !== undefined;
  const local = timeKnown ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
  try {
    toInstant({ local, utcOffset: '+08:00' });
  } catch {
    return null;
  }
  return { local, timeKnown, year: Number(m[1]) };
}

function readResidents(list, mainId, inp) {
  if (list === undefined || list === null) return { people: [], skipped: [], mainKnown: mainId === null };
  if (!Array.isArray(list)) fail('INVALID_INPUT', `residents 必須是陣列: ${show(list)}`);
  const seen = new Set();
  const people = [];
  const skipped = [];
  list.forEach((p, i) => {
    if (!isObj(p)) fail('INVALID_INPUT', `residents[${i}] 必須是物件`);
    const id = p.id === undefined || p.id === null ? `p${i + 1}` : p.id;
    if (typeof id !== 'string' || id === '') fail('INVALID_INPUT', `residents[${i}].id 必須是非空字串`);
    if (seen.has(id)) fail('INVALID_INPUT', `residents 的 id 重複: ${id}`);
    seen.add(id);
    if (p.name !== undefined && p.name !== null && typeof p.name !== 'string') fail('INVALID_INPUT', `residents[${i}].name 必須是字串`);
    if (p.birth !== undefined && p.birth !== null && typeof p.birth !== 'string') fail('INVALID_INPUT', `residents[${i}].birth 必須是字串 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD'`);
    if (p.utcOffsetMinutes !== undefined && p.utcOffsetMinutes !== null) {
      if (!Number.isInteger(p.utcOffsetMinutes) || Math.abs(p.utcOffsetMinutes) > 840) fail('INVALID_INPUT', `residents[${i}].utcOffsetMinutes 必須是 ±840 內的整數分鐘或 null`);
    }
    const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim() : `住戶${i + 1}`;
    const problems = [];
    if (p.gender !== 'M' && p.gender !== 'F') problems.push('性別');
    const birth = typeof p.birth === 'string' ? parseBirth(p.birth) : null;
    if (birth === null) problems.push('出生日期');
    if (problems.length) {
      skipped.push({ id, name, missing: problems });
      return;
    }
    let utcOffset;
    if (isNum(p.utcOffsetMinutes)) {
      utcOffset = offsetString(p.utcOffsetMinutes);
    } else if (inp.utcOffsetMinutes === 480 && birth.year >= 1901) {
      // 台灣 1938-1945 為 +09:00(規格 2.2.3 第 4 點),由 tzdata 查表,不硬寫。
      try {
        utcOffset = utcOffsetFor(birth.local, 'Asia/Taipei');
      } catch {
        utcOffset = '+08:00';
      }
    } else {
      utcOffset = offsetString(inp.utcOffsetMinutes);
    }
    people.push({
      id,
      name,
      gender: p.gender,
      birth: { local: birth.local, utcOffset, timeKnown: birth.timeKnown },
    });
  });
  const mainKnown = mainId === null || seen.has(mainId);
  return { people, skipped, mainKnown };
}

function readInput(input) {
  if (!isObj(input)) fail('INVALID_INPUT', 'input 必須是物件');
  if (!isNum(input.nowMs)) fail('INVALID_INPUT', `nowMs 必須是有限數字(ms epoch): ${show(input.nowMs)}`);
  const utcOffsetMinutes = input.utcOffsetMinutes === undefined || input.utcOffsetMinutes === null ? 480 : input.utcOffsetMinutes;
  if (!Number.isInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 840) fail('INVALID_INPUT', `utcOffsetMinutes 必須是 ±840 內的整數分鐘: ${show(input.utcOffsetMinutes)}`);

  const f = input.facing;
  if (!isObj(f)) fail('INVALID_INPUT', 'facing 必須是物件,例如 {bearing: 210}');
  if (!isNum(f.bearing)) fail('INVALID_BEARING', `facing.bearing 不是有限數字: ${show(f.bearing)}`);
  if (f.doorBearing !== undefined && f.doorBearing !== null && !isNum(f.doorBearing)) fail('INVALID_BEARING', `facing.doorBearing 不是有限數字或 null: ${show(f.doorBearing)}`);
  if (f.declination !== undefined && f.declination !== null && !isNum(f.declination)) fail('INVALID_INPUT', `facing.declination 必須是有限數字或 null: ${show(f.declination)}`);
  if (f.uncertainty !== undefined && f.uncertainty !== null && !(isNum(f.uncertainty) && f.uncertainty >= 0)) fail('INVALID_INPUT', `facing.uncertainty 必須是非負有限數字或 null: ${show(f.uncertainty)}`);

  const mainId = input.mainResidentId === undefined ? null : input.mainResidentId;
  if (mainId !== null && typeof mainId !== 'string') fail('INVALID_INPUT', `mainResidentId 必須是字串或 null: ${show(mainId)}`);

  const plan = input.plan === undefined ? null : input.plan;
  if (plan !== null && !isObj(plan)) fail('INVALID_INPUT', `plan 必須是平面圖物件或 null: ${show(plan)}`);

  const wealthOptions = input.wealthOptions === undefined || input.wealthOptions === null ? {} : input.wealthOptions;
  if (!isObj(wealthOptions)) fail('INVALID_INPUT', 'wealthOptions 必須是物件');
  for (const k of Object.keys(wealthOptions)) {
    if (!WEALTH_PASS_KEYS.includes(k)) fail('INVALID_INPUT', `wealthOptions 不認得的鍵: ${k}(可用: ${WEALTH_PASS_KEYS.join('、')})`);
  }

  const norm = { utcOffsetMinutes };
  const res = readResidents(input.residents, mainId, norm);
  let echo;
  try {
    echo = clone(input);
  } catch (e) {
    fail('INVALID_INPUT', `input 必須是 JSON 可序列化的資料: ${e.message}`);
  }
  return {
    nowMs: input.nowMs,
    utcOffsetMinutes,
    facing: {
      bearing: f.bearing,
      doorBearing: f.doorBearing ?? null,
      declination: f.declination ?? null,
      uncertainty: f.uncertainty ?? null,
    },
    building: readBuilding(input.building),
    residents: res,
    mainResidentId: mainId,
    plan,
    wealthOptions,
    echo,
  };
}

function readOverrides(o) {
  if (o === undefined || o === null) return {};
  if (!isObj(o)) fail('INVALID_SETTING', `settingsOverrides 必須是物件: ${show(o)}`);
  try {
    resolveSettings(o);
  } catch (e) {
    fail('INVALID_SETTING', e.message);
  }
  return { ...o };
}

// ─────────────────────────── Finding 產生 ───────────────────────────

const REF = 'DOMAIN_SPEC.md';

function mk(id, level, title, body, confidence, tag, schoolNote = null, refs = [REF], subject = null) {
  return { id, level, title, body, confidence, tag, schoolNote, refs, subject };
}

/** validatePlan 的 reason 轉白話(訊息本身帶欄位路徑,不可直接給使用者看)。 */
function planErrorText(reason) {
  const r = String(reason);
  if (r.startsWith('polygon.')) return '外框或某個房間的形狀不對(頂點不足、線條交叉、面積為 0 或座標不是數字)';
  if (r.startsWith('room')) return '房間資料不完整(編號重複或房間類型不認得)';
  if (r.startsWith('opening')) return '門窗資料有問題(找不到所屬房間、不在牆上、寬度不合理或種類不認得)';
  if (r.startsWith('wall')) return '牆的資料有問題(線段不完整或種類不認得)';
  if (r.startsWith('mainDoor')) return '標示的大門找不到對應的開口';
  return '平面圖的基本欄位(版本、單位、方位或太極點)不符格式';
}

const KONGWANG_LABEL = Object.freeze({ da: '大空亡', xiao: '小空亡', kongxiang: '空向' });
const KONGWANG_SCHOOL = Object.freeze({
  position: '大小空亡的定義各派不同,本 App 預設採「卦界=大空亡、山界=小空亡」的說法。',
  degree: '大小空亡的定義各派不同,本 App 依設定採「出卦=大空亡、陰陽差錯=小空亡、同性超限=空向」的說法。',
});

// ─────────────────────────── 主分析 ───────────────────────────

/**
 * @typedef {Object} HouseInput
 * @property {number} nowMs 分析基準時刻(ms epoch UTC),判定流年與目前的運
 * @property {number} [utcOffsetMinutes] 使用者所在時區(分鐘),預設 480;住戶沒給偏移時的預設(480 時台灣歷史時區由 tzdata 查表)
 * @property {{bearing:number, doorBearing?:(number|null), declination?:(number|null), uncertainty?:(number|null)}} facing
 *   bearing=宅向的羅盤讀數(手機讀到的磁方位);doorBearing=大門朝向的讀數,null=同 bearing;
 *   declination=磁偏角 D(度,東偏為正),northMode='true' 時用來換算,另用於磁北真北並列;uncertainty=本次量測的不確定度(度),null=用 settings.measureUncertainty
 * @property {{type:'apartment'|'house'|'shop'|'office', builtYear?:(number|null), moveInYear?:(number|null), renovation?:('none'|'partial'|'full'|'anyRenovation'), renovatedYear?:(number|null), floor?:(number|null)}|null} [building]
 * @property {Array<{id?:string, name?:string, gender:'M'|'F', birth:string, utcOffsetMinutes?:(number|null)}>} [residents]
 *   birth 為 'YYYY-MM-DD HH:mm'(當地時間)或 'YYYY-MM-DD'(不知時刻)
 * @property {string|null} [mainResidentId] 主要收入者(八宅大門與睡向優先照顧的人)
 * @property {object|null} [plan] PlanV1(規格 2.7.1),planUpBearing 已是目前 northMode 的基準
 * @property {{flags?:object, candidateRoomIds?:string[], doorOverride?:object, shielded?:string[]}} [wealthOptions] 原樣轉給 analyzeWealth 的選填項
 */

/**
 * 一次算完整份房屋分析。流程: 方位換算 → geo(向、坐、兼向、空亡、磁北真北並列)→ 八宅(宅卦與每位住戶的命卦)→ 玄空 → 流年 → 平面圖佔比 → 財位 → 彙整 Finding。
 * @param {HouseInput} input 全部可序列化;不會被修改
 * @param {Partial<typeof import('./settings.js').DEFAULT_SETTINGS>} [settingsOverrides] 流派開關,未知鍵丟 INVALID_SETTING
 * @param {{lunarNewYearOf?:(year:number)=>string}} [opts] 農曆春節解析器(函式不可序列化,所以不放在 input);沒有時 yearBoundary='lunar_new_year' 降級為 'lichun_exact' 並給 Finding
 * @returns {{
 *   meta: {schema:'fengshui.house/1', ruleset:object, northMode:string, declination:(number|null), declinationDate:string, computedAtCST:string,
 *     utcOffsetMinutes:number, warnings:string[], modules:object, inputEcho:object},
 *   geo: object, bazhai: {house:object, residents:object[], match:object, skipped:object[]},
 *   xuankong: (object|null), annual: object, planShares: (object|null), wealth: object,
 *   findings: Array<import('./geo.js').Finding & {subject:(string|null)}>,
 *   summary: {headline:string, zhai:string, zhaiGroup:string, yun:(number|null), pattern:(string|null),
 *     residents:object[], year:object, wealthTop:object[], cautions:Array<{id:string, title:string}>}
 * }} HouseReport
 * @throws {Error} INVALID_INPUT, INVALID_BEARING, INVALID_SETTING,以及底層模組的錯誤碼
 */
export function analyzeHouse(input, settingsOverrides = {}, opts = {}) {
  const inp = readInput(input);
  const user = readOverrides(settingsOverrides);
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) fail('INVALID_INPUT', 'opts 必須是物件');
  if (opts.lunarNewYearOf !== undefined && typeof opts.lunarNewYearOf !== 'function') fail('INVALID_INPUT', 'opts.lunarNewYearOf 必須是函式');

  const findings = [];
  const warnings = new Set();
  const F = (f) => findings.push(f);

  // ── 設定:以使用者覆寫為底,再套「降級」的調整,所有子模組收到同一份 sub ──
  const sub = { ...user };
  const base = resolveSettings(user);
  if (!NORTH_MODES.includes(base.northMode)) fail('INVALID_SETTING', `northMode 必須是 magnetic 或 true: ${show(base.northMode)}`);
  if (inp.facing.uncertainty !== null) sub.measureUncertainty = inp.facing.uncertainty;
  const D = inp.facing.declination;
  if (base.northMode === 'true' && D === null) {
    sub.northMode = 'magnetic';
    warnings.add('declinationMissing');
    F(mk('house.north.declination_missing', 'caution', '缺少磁偏角,暫以磁北計算',
      '設定選了「真北」,但沒有提供磁偏角(磁北與真北的差),無法把羅盤讀數換成真北方位。這次先依磁北(和實體羅盤一致)計算;請提供所在地的磁偏角,或到設定改回磁北。',
      'high', 'design'));
  }
  if (base.yearBoundary === 'lunar_new_year' && typeof opts.lunarNewYearOf !== 'function') {
    sub.yearBoundary = 'lichun_exact';
    warnings.add('lunarLibraryUnavailable');
    F(mk('house.setting.lunar_unavailable', 'note', '農曆春節年界暫時無法使用,改用立春',
      '設定選了以農曆春節換年來算命卦,但目前沒有農曆資料可用,這次改依立春(干支曆換年的時刻)計算。出生日在立春與春節之間的人,命卦可能與春節換年的算法不同。',
      'high', 'design'));
  }
  const building = inp.building;
  if (building !== null && building.renovation !== null && !has(user, 'renovation')) sub.renovation = building.renovation;
  if (sub.renovation === undefined) sub.renovation = base.renovation;

  // ── 方位換算 ──
  const useTrue = (sub.northMode ?? base.northMode) === 'true';
  const conv = (b) => (useTrue ? toTrue(b, D) : normalizeBearing(b));
  const readingFacing = inp.facing.bearing;
  const readingDoor = inp.facing.doorBearing;
  const doorUsed = readingDoor === null ? null : conv(readingDoor);
  const policyDoor = base.facingPolicy === 'door' && doorUsed !== null;
  const facingUsed = policyDoor ? doorUsed : conv(readingFacing);
  const bazhaiFacing = doorUsed ?? facingUsed;

  // ── geo ──
  const geoOpts = boundaryOptsFromSettings(sub);
  const fa = analyzeBearing(facingUsed, geoOpts);
  const sit = sitFromFacing(facingUsed);
  const { findings: _skipGeoFindings, meta: geoMeta, ...faRest } = fa;
  const lean = fa.zone === 'jian' ? { facing: fa.leanTo, sit: oppositeOf(fa.leanTo) } : null;
  const label = `${sit.sitMountain}山${sit.facingMountain}向${lean ? `兼${lean.sit}${lean.facing}` : ''}`;
  const doorAnalysis = doorUsed === null ? null : analyzeBearing(doorUsed, geoOpts);

  let compare = null;
  if (D !== null) {
    const facingCmp = compareMagVsTrue(readingFacing, D);
    const sitMag = sitFromFacing(readingFacing);
    const sitTrue = sitFromFacing(toTrue(readingFacing, D));
    compare = {
      facing: facingCmp,
      sitMountain: { magnetic: sitMag.sitMountain, true: sitTrue.sitMountain },
      zhaiGua: { magnetic: sitMag.zhaiGua, true: sitTrue.zhaiGua },
      differs: { mountain: !facingCmp.sameMountain, gua: sitMag.zhaiGua !== sitTrue.zhaiGua },
    };
  }
  let facingPick = null;
  if (doorUsed !== null) {
    const pk = pickFacing({ type: building?.type ?? 'apartment', door: doorUsed, light: facingUsed });
    facingPick = { conflict: pk.conflict, spreadDeg: circularDiff(doorUsed, facingUsed), candidates: pk.candidates };
  }

  const geo = {
    ...faRest,
    facingMountain: sit.facingMountain,
    sitMountain: sit.sitMountain,
    sitBearing: sit.sitBearing,
    zhaiGua: sit.zhaiGua,
    zhaiSitDir: sit.zhaiSitDir,
    lean,
    label,
    basis: policyDoor ? 'door' : 'input',
    door: doorAnalysis
      ? { bearing: doorAnalysis.bearing, mountain: doorAnalysis.mountain, gua: doorAnalysis.gua, dir8: doorAnalysis.dir8, zone: doorAnalysis.zone, leanTo: doorAnalysis.leanTo }
      : null,
    facingPick,
    north: {
      mode: sub.northMode ?? base.northMode,
      declination: D,
      reading: { facing: normalizeBearing(readingFacing), door: readingDoor === null ? null : normalizeBearing(readingDoor) },
      used: { facing: facingUsed, door: doorUsed },
      compare,
    },
    meta: geoMeta,
  };

  // 方位的不確定與空亡
  const U = geoOpts.uncertainty;
  const where = fa.onLine ? '幾乎壓在分界線上' : `距界約 ${round0(fa.boundaryDist)} 度`;
  if (fa.kongwangKind) {
    warnings.add('kongwang');
    const kw = KONGWANG_LABEL[fa.kongwangKind];
    F(mk('house.geo.kongwang', 'note', '方位壓在山與山的交界線上(空亡)',
      `量到的方向落在${fa.mountain}山與${fa.neighborMountain}山的交界附近(${where}),或偏離超過兼向常用的限度。傳統上稱為空亡,這裡依設定標為${kw},建議重新量測;手機羅盤可能有 ${round0(U)} 度以上誤差,可靠窗重量 3 到 5 次,或請老師用專業羅盤複核。`,
      'medium', 'source', KONGWANG_SCHOOL[geoOpts.kongwangLabelScheme], ['orientation.md#2.5', `${REF}#2.1.3`]));
  } else if (fa.retest) {
    warnings.add('retest');
    F(mk('house.geo.retest', 'note', '方位接近山與山的交界',
      `量到的方向落在${fa.mountain}山與${fa.neighborMountain}山的交界附近(${where})。手機羅盤可能有 ${round0(U)} 度以上誤差,建議靠窗重量 3 到 5 次,或請老師用專業羅盤複核。`,
      'medium', 'design', null, ['orientation.md#2.5', `${REF}#2.1.7`]));
  }
  if (compare && (compare.differs.mountain || compare.differs.gua)) {
    warnings.add('northDiffers');
    const m = compare.facing;
    F(mk('house.north.differs', compare.differs.gua ? 'caution' : 'note', '磁北與真北讀出的結果不同',
      `本次採用${sub.northMode === 'true' ? '真北' : '磁北'}。若改用另一種北,向會落在${m.magneticMountain === m.trueMountain ? m.trueMountain : `磁北的${m.magneticMountain}山或真北的${m.trueMountain}山`}` +
      `${compare.differs.gua ? `,房屋的宅卦也會從${compare.zhaiGua.magnetic}宅變成${compare.zhaiGua.true}宅(依磁北與真北分別為${compare.zhaiGua.magnetic}宅、${compare.zhaiGua.true}宅)` : ''}。` +
      '實體羅盤指的是磁北,多數老師以磁北為準;兩種讀法並列如下,請依你請教的老師習慣選擇。',
      'high', 'design', '磁北與真北的取捨各派不同,本 App 預設採磁北(與實體羅盤一致)。', ['orientation.md#2.11', `${REF}#2.1.5`]));
  }
  if (facingPick && facingPick.conflict) {
    warnings.add('facingConflict');
    F(mk('house.facing.conflict', 'note', '大門朝向與宅向差距較大',
      `大門朝向與宅向相差約 ${round0(facingPick.spreadDeg)} 度(超過 45 度)。「向」怎麼取,各派沒有一致的說法:玄空這裡用宅向,八宅用大門朝向。請確認哪一個才是你想看的向,必要時到設定調整取向方式。`,
      'low', 'design', '向的取法沒有壓倒性共識,是本 App 的產品政策。', [`${REF}#2.1.6`]));
  }

  // ── 住戶 ──
  const { people, skipped, mainKnown } = inp.residents;
  for (const s of skipped) {
    warnings.add('residentIncomplete');
    F(mk(`house.resident.incomplete.${s.id}`, 'note', '這位住戶的資料不完整,先不算命卦',
      `${s.name}的${s.missing.join('、')}沒有填或格式不對,這位住戶先略過,不列入命卦與本命財位。補齊後會自動加入。`,
      'high', 'design', null, [REF], s.id));
  }
  if (people.length === 0) {
    warnings.add('noResidents');
    F(mk('house.residents.none', 'note', '沒有住戶資料,只看房屋本身',
      '目前沒有可用的住戶資料,所以只列出房屋的宅卦與方位,不做命卦與本命財位;財位的分數上限也會因此降低。輸入住戶的出生日期與性別後,會補上個人的吉方。',
      'high', 'design'));
  }
  if (inp.mainResidentId !== null && !mainKnown) {
    warnings.add('mainResidentUnknown');
    F(mk('house.residents.main_unknown', 'note', '找不到指定的主要收入者',
      '指定的主要收入者不在住戶名單裡,已當作沒有指定;夫妻命卦不同組時,會退回名單中的第一位。',
      'high', 'design'));
  }
  const roleOf = (id) => {
    if (id !== inp.mainResidentId) return null;
    return base.coupleBasis === 'holderOnly' ? 'holder' : 'breadwinner';
  };
  const household = people.map((p) => ({ id: p.id, gender: p.gender, birth: p.birth, role: roleOf(p.id) }));

  // ── 八宅 ──
  const bzOpts = typeof opts.lunarNewYearOf === 'function' ? { lunarNewYearOf: opts.lunarNewYearOf } : {};
  const bz = analyzeBazhai({ household, facing: { bazhai: bazhaiFacing, xuankong: facingUsed }, settings: sub }, bzOpts);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const bazhai = {
    house: bz.house,
    residents: bz.people.map((p) => {
      const src = people.find((x) => x.id === p.id);
      return {
        id: p.id,
        name: nameOf.get(p.id),
        gender: src.gender,
        role: roleOf(p.id),
        ming: p.ming,
        stars: p.stars,
        wealthOrder: p.wealthOrder,
        usage: p.usage,
        threeKeys: p.threeKeys,
        matchesHouse: bz.match.byPerson[p.id] === true,
      };
    }),
    match: bz.match,
    skipped,
    warnings: [...bz.meta.warnings],
  };
  for (const w of bz.meta.warnings) warnings.add(w);

  // ── 建成年份與運 ──
  let yunInput = null;
  if (building === null) {
    warnings.add('buildingMissing');
    F(mk('house.building.year_missing', 'note', '沒有建築資料,略過玄空盤',
      '玄空盤要知道房屋建成(或遷入、整修)屬於哪一運才排得出來,目前沒有建築資料,所以這次只看八宅、流年與可算的財位。補上建成年份後會加入玄空盤與玄空財位。',
      'high', 'design'));
  } else {
    let yunBasis = base.yunBasis;
    const wantsRenov = COUNTING_RENOVATIONS.includes(sub.renovation);
    let renovatedYear = building.renovatedYear ?? building.moveInYear;
    if (wantsRenov && renovatedYear === null) {
      sub.renovation = 'none';
      warnings.add('renovationDateMissing');
      F(mk('house.building.renovation_date_missing', 'note', '沒有整修完工的年份,先不以整修換運',
        '設定或建築資料指出這間房子有大幅整修,可能改以整修完工的那一運起盤,但沒有整修完工(或遷入)的年份可用,這次仍以建成年份的運起盤。',
        'high', 'design', '整修是否換運,各派意見不同。'));
    }
    const counts = COUNTING_RENOVATIONS.includes(sub.renovation);
    if (!counts && yunBasis === 'moveIn' && building.moveInYear === null) {
      yunBasis = 'built';
      sub.yunBasis = 'built';
      warnings.add('moveInYearMissing');
      F(mk('house.building.move_in_missing', 'note', '沒有遷入年份,改以建成年份起盤',
        '設定選了以遷入時的運起盤,但沒有遷入年份,這次改以建成年份的運起盤。',
        'high', 'design'));
    }
    const basisYear = counts ? renovatedYear : yunBasis === 'moveIn' ? building.moveInYear : building.builtYear;
    if (basisYear === null) {
      warnings.add('buildingYearMissing');
      F(mk('house.building.year_missing', 'note', '沒有建成年份,略過玄空盤',
        '玄空盤要知道房屋建成屬於哪一運才排得出來,目前沒有建成年份,所以這次只看八宅、流年與可算的財位。補上建成年份後會加入玄空盤與玄空財位。',
        'high', 'design'));
    } else {
      yunInput = {};
      if (counts) yunInput.renovatedAt = midYearMs(renovatedYear);
      else if (yunBasis === 'moveIn') yunInput.movedInAt = midYearMs(building.moveInYear);
      else yunInput.builtAt = midYearMs(building.builtYear);
      let firstYearOfYun = false;
      try {
        firstYearOfYun = nineYun(basisYear, { yunSystem: base.yunSystem }).yunYear === 1;
      } catch {
        firstYearOfYun = false;
      }
      if (firstYearOfYun) {
        warnings.add('yunTransitionYear');
        F(mk('house.building.yun_boundary_year', 'note', '建成年份剛好是換運的那一年',
          `${basisYear} 年是新的一運開始的年份,交運的時刻是這一年的立春。只知道年份時,這次以該年年中(交運之後)的運起盤;若房子實際完工在立春之前,起盤的運會是上一運,請確認完工日期。`,
          'medium', 'design', '入運是以建成、遷入還是整修為準,各派意見不同。', [`${REF}#2.2.3`, `${REF}#2.4.4`]));
      }
    }
  }

  // ── 玄空 ──
  const nowDate = formatCST(inp.nowMs).slice(0, 10);
  let xuankong = null;
  if (yunInput !== null) {
    const xkIn = { facing: facingUsed, now: inp.nowMs, northMode: sub.northMode ?? base.northMode, declinationDate: nowDate, ...yunInput };
    if (D !== null) xkIn.declination = D;
    xuankong = analyzeXuankong(xkIn, sub);
    for (const w of xuankong.meta.warnings) warnings.add(w);
  }

  // ── 流年 ──
  const annual = analyzeAnnual({ instant: inp.nowMs }, sub);
  for (const w of annual.meta.warnings) warnings.add(w);

  // ── 平面圖 ──
  let plan = inp.plan;
  let planShares = null;
  if (plan !== null) {
    const v = validatePlan(plan, sub);
    if (!v.ok) {
      warnings.add('planInvalid');
      F(mk('house.plan.invalid', 'caution', '平面圖資料有問題,先當作沒有平面圖',
        `平面圖有不能使用的地方: ${[...new Set(v.errors.map((e) => planErrorText(e.reason)))].join('、')}。這次只列出暗財位;請修正平面圖後再算一次。`,
        'high', 'design'));
      plan = null;
    } else {
      // 太極點落在外框外、方位未知已由 wealth 產生 Finding,這裡只補 wealth 沒有的三項。
      const own = { roomOutsideOutline: '有房間超出外框', openingsOverlap: '有開口互相重疊', mainDoorNotEntrance: '標示的大門不是「大門」類型的開口' };
      for (const w of v.warnings) {
        if (!has(own, w.code)) continue;
        warnings.add(`plan:${w.code}`);
        F(mk(`house.plan.warning.${w.code}`, 'note', `平面圖提醒: ${own[w.code]}`,
          `平面圖檢查發現${own[w.code]}。不影響其他結果,但明財位與門沖的判斷可能受影響,建議回去檢查圖面。`,
          'high', 'design'));
      }
      planShares = sectorShares(plan, sub);
    }
  }

  // ── 財位 ──
  const wIn = {
    facing: { bazhai: bazhaiFacing, xuankong: facingUsed },
    now: inp.nowMs,
    plan,
    household: bazhai.residents.map((r) => ({ id: r.id, gua: r.ming.gua, role: r.role })),
    northMode: sub.northMode ?? base.northMode,
    declinationDate: nowDate,
    ...(yunInput ?? {}),
    ...inp.wealthOptions,
  };
  if (D !== null) wIn.declination = D;
  const wealth = analyzeWealth(wIn, sub);
  for (const w of wealth.meta.warnings) warnings.add(w);
  if (!wealth.meta.hasResidents) warnings.add('noResidents');

  // 彙整:去重鍵含 subject,否則同一住戶層級的 Finding(如立春臨界)會被第二個人覆蓋掉。
  const merged = new Map();
  for (const f of [...findings, ...bz.findings, ...(xuankong ? xuankong.findings : []), ...annual.findings, ...wealth.findings]) {
    const subject = f.subject ?? null;
    const dedupKey = subject === null ? f.id : `${f.id}::${subject}`;
    if (!merged.has(dedupKey)) merged.set(dedupKey, { ...f, subject });
  }
  const allFindings = [...merged.values()];

  const eff = resolveSettings(sub);
  const profile = PROFILES[eff.wealthProfile];
  const wealthTop = pickWealthTop(wealth, profile);

  return {
    meta: {
      schema: HOUSE_SCHEMA,
      ruleset: clone(eff),
      northMode: eff.northMode,
      declination: D,
      declinationDate: nowDate,
      computedAtCST: formatCST(inp.nowMs),
      utcOffsetMinutes: inp.utcOffsetMinutes,
      warnings: [...warnings],
      modules: {
        geo: geoMeta.schema,
        bazhai: bz.meta.schema,
        xuankong: xuankong ? xuankong.meta.schema : null,
        annual: annual.meta.schema,
        plan: planShares ? planShares.meta.schema : null,
        wealth: wealth.meta.schema,
      },
      inputEcho: inp.echo,
    },
    geo,
    bazhai,
    xuankong,
    annual,
    planShares,
    wealth,
    findings: allFindings,
    summary: {
      headline: label,
      zhai: bz.house.name,
      zhaiGroup: bz.house.group,
      yun: xuankong ? xuankong.meta.chartYun : null,
      pattern: xuankong ? xuankong.pattern : null,
      residents: bazhai.residents.map((r) => ({ id: r.id, name: r.name, gua: r.ming.gua, group: r.ming.group, matchesHouse: r.matchesHouse })),
      year: {
        fengshuiYear: annual.year.fengshuiYear,
        ganzhi: annual.year.ganzhi,
        wuhuang: annual.annual.wuhuang,
        erhei: annual.annual.erhei,
        sansha: annual.sansha.dir,
        taisui: annual.taisui.dir,
      },
      wealthTop,
      cautions: allFindings.filter((f) => f.level === 'caution').map((f) => ({ id: f.id, title: f.title })),
    },
  };
}

/**
 * 財位前幾名(最多 3 個,另外明財位永遠列出)。有平面圖且算得出分數時取候選;否則取八宮的暗財位(宮位能量)。
 * score 只供排序與轉三段標籤,顯示層不可顯示。
 */
function pickWealthTop(wealth, profile) {
  const cap = wealth.meta.scoreCap;
  const scored = wealth.candidates.filter((c) => c.rank !== null && c.score !== null);
  if (scored.length > 0) {
    const blocked = (c) => c.excluded || c.status === 'blocked_opening' || c.status === 'blocked_walkway';
    // 只推薦「較適合」與「可以考慮」的位置;明財位不論排名都列出(規格 2.6.7),標籤照實給。
    const picked = scored.filter((c) => !blocked(c) && wealthTier(c.score, cap) !== 'notAdvised').slice(0, 3);
    const ming = scored.find((c) => c.isMingCai && c.role === 'primary') ?? scored.find((c) => c.isMingCai);
    if (ming && !picked.some((c) => c.id === ming.id)) picked.push(ming);
    return picked.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      roomId: c.roomId,
      roomType: c.roomType,
      corner: c.corner,
      sector: c.sector,
      dir8: c.sectorInfo ? c.sectorInfo.dir8 : null,
      status: c.status,
      borderline: c.sectorInfo ? c.sectorInfo.borderline : false,
      tier: blocked(c) ? 'notAdvised' : wealthTier(c.score, cap),
      score: c.score,
    }));
  }
  // 暗財位用「扣掉幾何分量後的上限」當分母;缺資料時 cap 可能被扣到 <= 0,保底 1 避免全部被判 notAdvised。
  const energyCap = Math.max(1, cap - 100 * profile.G);
  return Object.values(wealth.sectors)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.energy - a.s.energy || a.i - b.i)
    .slice(0, 3)
    .map(({ s }) => ({
      id: `dark:${s.gua}`,
      kind: 'dark',
      label: '暗財位',
      roomId: null,
      roomType: null,
      corner: null,
      sector: s.gua,
      dir8: s.dir,
      status: null,
      borderline: false,
      tier: wealthTier(s.energy, energyCap),
      score: s.energy,
    }));
}

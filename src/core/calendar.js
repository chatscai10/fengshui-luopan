// 曆法核心: 立春與節氣天文計算、干支年月、九運、出生時刻換算(規格 2.2)。
// 演算法逐項取自 annual.json meta.referenceImplementation(已對 JPL DE441 / HKO / CWA 驗證),
// 不重新發明: VSOP87D 地球日心黃經(37 項截斷)+ 章動 4 項 + 光行差 + Espenak-Meeus ΔT,牛頓法解視黃經。
// 純函式、無 DOM、無全域狀態(不做記憶化快取)、無網路;時間一律 ms since epoch (UTC)。
//
// 錯誤碼(Error.message 開頭): INVALID_INSTANT / INVALID_YEAR / INVALID_TERM_INDEX / YEAR_OUT_OF_RANGE /
// INVALID_LOCAL_TIME / MISSING_UTC_OFFSET / INVALID_UTC_OFFSET / INVALID_SETTING / LUNAR_LIBRARY_REQUIRED /
// YUN_SYSTEM_RANGE / TIMEZONE_UNSUPPORTED。規格未列出者由本模組自訂。

import { resolveSettings } from './settings.js';
import { VSOP_L, VSOP_R0 } from './data/vsop87d_earth.js';

// ---------------------------------------------------------------- 常數

export const STEMS = Object.freeze('甲乙丙丁戊己庚辛壬癸'.split(''));
export const BRANCHES = Object.freeze('子丑寅卯辰巳午未申酉戌亥'.split(''));
/** 索引 i 對應視黃經 (285+15i) mod 360;偶數為「節」(月界),奇數為「中氣」(規格 2.2.1)。 */
export const TERM_NAMES = Object.freeze([
  '小寒', '大寒', '立春', '雨水', '驚蟄', '春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至',
  '小暑', '大暑', '立秋', '處暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
]);
/** 「支援」年份: 範圍外的結果仍會算出(以 180 年週期外推),但標 approx:true(規格 2.2.1)。 */
export const SUPPORTED_YEARS = Object.freeze({ min: 1864, max: 2150 });
/** 立春臨界旗標門檻(分鐘),與官方表 ±1 分歧義一致(規格 2.2.3 第 5 點)。 */
export const NEAR_LICHUN_MINUTES = 2;

const YEAR_BOUNDARIES = ['lichun_exact', 'lichun_date_only', 'fixed_feb4', 'lunar_new_year', 'gregorian_jan1'];
const YUN_SYSTEMS = ['san_yuan_9', 'er_yuan_8'];
// 二元八運只有規格 2.4.4 給的兩段(談養吾): 八運 1996-2016、九運 2017-2043,其餘年份沒有可驗證的對照。
const ER_YUAN_8_RUNS = Object.freeze([
  Object.freeze({ yun: 8, from: 1996, to: 2016 }),
  Object.freeze({ yun: 9, from: 2017, to: 2043 }),
]);

const D2R = Math.PI / 180;
const DAY_MS = 86400000;
const CST_MS = 8 * 3600e3;
// VSOP 截斷表在 1900-2100 驗證過;直接計算的年份域再向兩側放寬,ΔT 夾在 1900 / 用 2150 多項式外插,誤差為秒級。
const DIRECT_YEARS = Object.freeze({ min: 1800, max: 2151 });
const EXTRAPOLATION_CENTER_YEAR = 1990;
const YEAR_CYCLE = 180;

// ---------------------------------------------------------------- 內部工具

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function assertInstant(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
    fail('INVALID_INSTANT', `需要有限的 ms epoch 數字,收到 ${String(ms)}`);
  }
}

function assertYear(y) {
  if (!Number.isInteger(y)) fail('INVALID_YEAR', `年份需為整數,收到 ${String(y)}`);
}

function settingsOf(overrides) {
  try {
    return resolveSettings(overrides ?? {});
  } catch (e) {
    throw new Error(`INVALID_SETTING: ${e.message}`);
  }
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

const utcYearOf = (ms) => new Date(ms).getUTCFullYear();
const cstYearOf = (ms) => new Date(ms + CST_MS).getUTCFullYear();
const cstDayIndex = (ms) => Math.floor((ms + CST_MS) / DAY_MS);

/** 以 UTC 欄位組出 Date。Date.UTC 對 0-99 年會誤當 1900+,故用 setUTCFullYear。 */
function utcOfParts(y, mo, d, h = 0, mi = 0, s = 0) {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t;
}

const utcYearStart = (year) => utcOfParts(year, 1, 1).getTime();

// ---------------------------------------------------------------- 太陽視黃經

/**
 * ΔT = TT - UT(秒)。Espenak & Meeus 多項式(NASA),y 為十進位年。
 * 1900 以前夾在 1900(1864/1884 交運日案例誤差 < 5 秒級);2150 以後只外插 2 年供年末節氣用。
 */
function deltaT(y) {
  let t;
  if (y < 1900) y = 1900;
  if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t ** 3; }
  if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (y <= 2152) return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  return fail('YEAR_OUT_OF_RANGE', `ΔT 只支援到 2152 年,收到 ${y}`);
}

/** Σ T^k · Σ A·cos(B + C·T) */
function series(tab, T) {
  let total = 0;
  let tk = 1;
  for (const row of tab) {
    let s = 0;
    for (const [A, B, C] of row) s += A * Math.cos(B + C * T);
    total += s * tk;
    tk *= T;
  }
  return total;
}

/** 太陽視黃經(度,當日真春分點),輸入為 UT 儒略日。 */
function sunApparentLongitudeJD(jdUT) {
  const jde = jdUT + deltaT(2000 + (jdUT - 2451545) / 365.25) / 86400;
  const T = (jde - 2451545) / 365250; // 儒略千年
  const Tc = (jde - 2451545) / 36525; // 儒略世紀
  let lon = series(VSOP_L, T) / D2R + 180; // 地心 = 日心 + 180,平春分點
  const R = series([VSOP_R0], T);
  // 章動(Meeus 第 22 章,4 項,約 0.05")
  const om = (125.04452 - 1934.136261 * Tc) * D2R;
  const ls = (280.4665 + 36000.7698 * Tc) * D2R;
  const lm = (218.3165 + 481267.8813 * Tc) * D2R;
  const dpsi = (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * ls) - 0.23 * Math.sin(2 * lm) + 0.21 * Math.sin(2 * om)) / 3600;
  lon += dpsi - 20.4898 / R / 3600; // 章動 + 周年光行差
  return ((lon % 360) + 360) % 360;
}

/**
 * 太陽視黃經。
 * @param {number} ms 瞬間(ms epoch)
 * @returns {number} 度,[0,360)
 */
export function solarLongitude(ms) {
  assertInstant(ms);
  return sunApparentLongitudeJD(ms / DAY_MS + 2440587.5);
}

// ---------------------------------------------------------------- 節氣瞬間

/** 該 UTC 曆年內視黃經到達 (285+15i) mod 360 的瞬間;牛頓法,平均角速度 0.9856 度/日。 */
function termDirect(year, i) {
  const target = (285 + 15 * i) % 360;
  let jd = Date.UTC(year, 0, 1) / DAY_MS + 2440587.5 + ((target - 280 + 360) % 360) / 0.9856;
  for (let n = 0; n < 20; n++) {
    const d = ((target - sunApparentLongitudeJD(jd) + 540) % 360) - 180;
    jd += d / 0.9856;
    if (Math.abs(d) < 1e-8) break;
  }
  return Math.round((jd - 2440587.5) * DAY_MS);
}

/**
 * 內部節氣瞬間: 直接計算域內用天文算法;域外把年份平移 180 年整數倍(三元九運週期)到 1900-2080
 * 再加回曆年差。平移只保證到小時級(格里曆與回歸年不整除),所以呼叫端必須同時標 approx。
 */
function termAt(year, i) {
  assertYear(year);
  if (year >= DIRECT_YEARS.min && year <= DIRECT_YEARS.max) return termDirect(year, i);
  if (year < 100 || year > 9999) fail('YEAR_OUT_OF_RANGE', `年份 ${year} 超出可外推範圍 100-9999`);
  const base = year + YEAR_CYCLE * Math.round((EXTRAPOLATION_CENTER_YEAR - year) / YEAR_CYCLE);
  return termDirect(base, i) + (utcYearStart(year) - utcYearStart(base));
}

const isApproxYear = (year) => year < SUPPORTED_YEARS.min || year > SUPPORTED_YEARS.max;

/**
 * 節氣瞬間(該 UTC 曆年內)。
 * @param {number} year 曆年,1800-2150(1900 以前 ΔT 夾在 1900,誤差秒級;2150 以後丟錯)
 * @param {number} i 節氣索引 0=小寒 1=大寒 2=立春 ... 23=冬至
 * @returns {number} ms epoch (UTC)
 */
export function termInstant(year, i) {
  assertYear(year);
  if (!Number.isInteger(i) || i < 0 || i > 23) fail('INVALID_TERM_INDEX', `節氣索引需為 0-23 的整數,收到 ${String(i)}`);
  if (year < 1800 || year > SUPPORTED_YEARS.max) {
    fail('YEAR_OUT_OF_RANGE', `termInstant 只支援 1800-${SUPPORTED_YEARS.max} 年,收到 ${year}`);
  }
  return termDirect(year, i);
}

/** 立春瞬間。@param {number} year 曆年 @returns {number} ms epoch (UTC) */
export function lichun(year) {
  return termInstant(year, 2);
}

// ---------------------------------------------------------------- 格式與時區

/**
 * 顯示用 UTC+8 時間字串,四捨五入到分(HKO/CWA/PMO 都是四捨五入,不是截斷)。
 * @param {number} ms
 * @param {boolean} [withSeconds] true 時四捨五入到秒並加 ':ss'
 * @returns {string} 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD HH:mm:ss'
 */
export function formatCST(ms, withSeconds = false) {
  assertInstant(ms);
  const step = withSeconds ? 1000 : 60000;
  const t = new Date(Math.round(ms / step) * step + CST_MS);
  // assertInstant 放行 ±8.64e15,但加上 8 小時後可能超出 Date 範圍,會輸出 NaN 字串。
  if (Number.isNaN(t.getTime())) fail('INVALID_INSTANT', `顯示用 UTC+8 時間超出可表示範圍: ${String(ms)}`);
  const yr = t.getUTCFullYear();
  // 負年份不能直接 padStart(會得到 '00-5');用 '-' 加 4 位數。
  const s = `${yr < 0 ? `-${pad(-yr, 4)}` : pad(yr, 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return withSeconds ? `${s}:${pad(t.getUTCSeconds())}` : s;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** 解析 local 字串並驗證真的存在(2 月 30 日之類丟錯)。純日期回傳 dateOnly:true 並取當地正午。 */
function parseLocal(local) {
  const m = typeof local === 'string' ? LOCAL_RE.exec(local.trim()) : null;
  if (!m) fail('INVALID_LOCAL_TIME', `需為 'YYYY-MM-DDTHH:mm'(可含秒,或只給日期),收到 ${String(local)}`);
  const dateOnly = m[4] === undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = dateOnly ? 12 : Number(m[4]);
  const mi = dateOnly ? 0 : Number(m[5]);
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const t = utcOfParts(y, mo, d, h, mi, s);
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s;
  if (!ok) fail('INVALID_LOCAL_TIME', `不存在的日期時間: ${local}`);
  return { asUtcMs: t.getTime(), dateOnly };
}

function parseOffsetMs(utcOffset) {
  if (utcOffset === undefined || utcOffset === null || utcOffset === '') {
    fail('MISSING_UTC_OFFSET', '出生時刻必須帶 utcOffset(例 +08:00);台灣 1938-1945 為 +09:00');
  }
  if (utcOffset === 'Z') return 0;
  const m = typeof utcOffset === 'string' ? /^([+-])(\d{2}):?(\d{2})$/.exec(utcOffset) : null;
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) fail('INVALID_UTC_OFFSET', `需為 '+08:00' 形式,收到 ${String(utcOffset)}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

/**
 * 當地時間 + UTC 偏移換成瞬間。純日期(不知時刻)取當地正午,避免偏移換算把日期推到隔天。
 * 日期類判斷一律以 UTC+8 曆日為準(規格 1.3 時間約定),所以非 +08:00 又不知時刻的立春日只保證在 ±4 小時內。
 * @param {{local: string, utcOffset: string}} input local='YYYY-MM-DDTHH:mm[:ss]' 或 'YYYY-MM-DD';utcOffset='+08:00'
 * @returns {number} ms epoch (UTC)
 */
export function toInstant(input) {
  if (!input || typeof input !== 'object') fail('INVALID_LOCAL_TIME', '需要 {local, utcOffset} 物件');
  const { asUtcMs } = parseLocal(input.local);
  return asUtcMs - parseOffsetMs(input.utcOffset);
}

/** 某 IANA 時區在某 UTC 瞬間的偏移(ms)。 */
function zoneOffsetMs(utcMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p = {};
  for (const x of fmt.formatToParts(new Date(utcMs))) p[x.type] = Number(x.value);
  const asUtc = utcOfParts(p.year, p.month, p.day, p.hour, p.minute, p.second).getTime();
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * 由 tzdata(Intl)查某當地時間當時的 UTC 偏移,不硬寫規則(規格 2.2.3 第 4 點)。
 * 台灣 1938-1945 為 '+09:00',其餘立春時段為 '+08:00'。歷史 LMT 帶秒的偏移四捨五入到分。
 * @param {string} local 'YYYY-MM-DDTHH:mm[:ss]' 或 'YYYY-MM-DD'
 * @param {string} [timeZone] IANA 名稱,預設 'Asia/Taipei'
 * @returns {string} '+HH:mm' / '-HH:mm'
 */
export function utcOffsetFor(local, timeZone = 'Asia/Taipei') {
  const { asUtcMs } = parseLocal(local);
  let off;
  try {
    off = zoneOffsetMs(asUtcMs, timeZone);
    const second = zoneOffsetMs(asUtcMs - off, timeZone); // 跨轉換點時以換算後的瞬間為準
    if (second !== off) off = second;
  } catch (e) {
    throw new Error(`TIMEZONE_UNSUPPORTED: ${String(timeZone)} (${e.message})`);
  }
  const minutes = Math.round(off / 60000);
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ---------------------------------------------------------------- 年

/**
 * 風水年(干支年): 依 `yearBoundary` 決定換年的瞬間,預設立春精確瞬間(D10)。
 * 日期類制式(lichun_date_only / fixed_feb4 / gregorian_jan1)以 UTC+8 曆日比較。
 * 算交運請用 yunOfInstant: D13 規定交運界線固定為立春精確瞬間,不受 yearBoundary 影響。
 * @param {number} ms 瞬間
 * @param {Partial<import('./settings.js').DEFAULT_SETTINGS>} [settings] 只讀 yearBoundary
 * @returns {number} 風水年
 * @throws LUNAR_LIBRARY_REQUIRED yearBoundary='lunar_new_year'(需農曆庫,規格 U-19,本模組不內建)
 */
export function fengshuiYear(ms, settings = {}) {
  assertInstant(ms);
  const { yearBoundary } = settingsOf(settings);
  if (!YEAR_BOUNDARIES.includes(yearBoundary)) fail('INVALID_SETTING', `yearBoundary=${String(yearBoundary)}`);
  switch (yearBoundary) {
    case 'lichun_exact': {
      const y = utcYearOf(ms);
      return ms >= termAt(y, 2) ? y : y - 1;
    }
    case 'lichun_date_only': {
      const y = cstYearOf(ms);
      return cstDayIndex(ms) >= cstDayIndex(termAt(y, 2)) ? y : y - 1;
    }
    case 'fixed_feb4': {
      const y = cstYearOf(ms);
      // Date.UTC 會把 0-99 年當成 1900+,用 utcOfParts 才正確。
      return cstDayIndex(ms) >= utcOfParts(y, 2, 4).getTime() / DAY_MS ? y : y - 1;
    }
    case 'gregorian_jan1':
      return cstYearOf(ms);
    default:
      return fail('LUNAR_LIBRARY_REQUIRED', 'yearBoundary=lunar_new_year 需要農曆資料庫(規格 2.2.3 第 6 點、U-19),calendar 不內建');
  }
}

/**
 * 干支年。
 * @param {number} fy 風水年
 * @returns {{index: number, stem: number, branch: number, name: string}} index 為六十甲子序(甲子=0)
 */
export function yearGanzhi(fy) {
  assertYear(fy);
  const index = (((fy - 4) % 60) + 60) % 60;
  return { index, stem: index % 10, branch: index % 12, name: STEMS[index % 10] + BRANCHES[index % 12] };
}

// ---------------------------------------------------------------- 月

/** 月柱: 節為界;寅月天干 = 2×年干+2(五虎遁),年干看立春換年,不看元旦(1 月丑月屬上一年)。 */
function monthPillar(jieIndex, yearStem) {
  const branch = (jieIndex / 2 + 1) % 12; // 小寒→丑(1) 立春→寅(2) 大雪→子(0)
  const order = (branch - 2 + 12) % 12; // 0=寅月 ... 11=丑月
  const stem = (2 * yearStem + 2 + order) % 10;
  return { branch, order, stem, name: STEMS[stem] + BRANCHES[branch] };
}

/**
 * 該瞬間所在的月(兩個相鄰「節」之間)。月柱的年干一律用立春精確瞬間換年(天文定義,不受 yearBoundary 影響)。
 * @param {number} ms
 * @returns {{jieName: string, start: number, end: number, branch: number, order: number, stem: number, name: string, approx: boolean}}
 *   start/end 為 ms;order 0=寅月(立春)...11=丑月;approx=true 表示超出支援年份、節氣為外推值
 */
export function monthOf(ms) {
  assertInstant(ms);
  const y = utcYearOf(ms);
  let jie = -1;
  let startYear = y;
  let start = NaN;
  for (let i = 22; i >= 0; i -= 2) {
    const t = termAt(y, i);
    if (t <= ms) { jie = i; start = t; break; }
  }
  if (jie < 0) { jie = 22; startYear = y - 1; start = termAt(startYear, 22); } // 小寒之前 = 上一年大雪月
  const end = jie === 22 ? termAt(startYear + 1, 0) : termAt(startYear, jie + 2);
  const fyExact = ms >= termAt(y, 2) ? y : y - 1;
  const p = monthPillar(jie, yearGanzhi(fyExact).stem);
  return { jieName: TERM_NAMES[jie], start, end, ...p, approx: isApproxYear(cstYearOf(ms)) };
}

/**
 * 風水年 fy 的 12 個月,寅月(立春)... 丑月(次年小寒至次年立春)。
 * @param {number} fy
 * @returns {Array<{order: number, jieName: string, start: number, end: number, branch: number, stem: number, name: string}>}
 */
export function monthTable(fy) {
  const ys = yearGanzhi(fy).stem;
  const rows = [];
  for (let order = 0; order < 12; order++) {
    // 寅月(2)到子月(22)的節都在 fy 曆年;丑月從次年小寒(0)起,到次年立春(2)止,子月則止於次年小寒
    const idx = order === 11 ? 0 : 2 + 2 * order;
    const yy = order === 11 ? fy + 1 : fy;
    const endIdx = idx + 2 >= 24 ? 0 : idx + 2;
    const endYear = idx + 2 >= 24 ? yy + 1 : yy;
    const p = monthPillar(idx, ys);
    rows.push({ order, jieName: TERM_NAMES[idx], start: termAt(yy, idx), end: termAt(endYear, endIdx), branch: p.branch, stem: p.stem, name: p.name });
  }
  return rows;
}

// ---------------------------------------------------------------- 九運

/**
 * 元運。三元九運: d=((fy-1864)%180+180)%180,yun=floor(d/20)+1,yunYear=(d%20)+1,上中下元各 60 年。
 * 欄位名 era 對應 annual.json 的 yuan(上中下元);天地人元龍另叫 dragon(規格 1.3)。
 * @param {number} fy 風水年(立春換年後的年)
 * @param {{yunSystem?: 'san_yuan_9'|'er_yuan_8'}} [settings] 預設取 DEFAULT_SETTINGS.yunSystem
 * @returns {{yun: number, yunYear: number, era: '上元'|'中元'|'下元'}}
 * @throws YUN_SYSTEM_RANGE er_yuan_8 只涵蓋 1996-2043(規格 2.4.4 只給這兩段)
 */
export function nineYun(fy, settings = {}) {
  assertYear(fy);
  const { yunSystem } = settingsOf(settings);
  if (!YUN_SYSTEMS.includes(yunSystem)) fail('INVALID_SETTING', `yunSystem=${String(yunSystem)}`);
  const d = (((fy - 1864) % 180) + 180) % 180;
  const era = d < 60 ? '上元' : d < 120 ? '中元' : '下元';
  if (yunSystem === 'er_yuan_8') {
    const run = ER_YUAN_8_RUNS.find((r) => fy >= r.from && fy <= r.to);
    if (!run) fail('YUN_SYSTEM_RANGE', `er_yuan_8 只涵蓋 ${ER_YUAN_8_RUNS[0].from}-${ER_YUAN_8_RUNS[1].to},收到 ${fy}`);
    return { yun: run.yun, yunYear: fy - run.from + 1, era };
  }
  return { yun: Math.floor(d / 20) + 1, yunYear: (d % 20) + 1, era };
}

/**
 * 某瞬間所屬的運。交運界線固定為立春精確瞬間(D13,不受 yearBoundary 影響)。
 * 入運用哪個瞬間(建成/遷入/大修完工,D11)由呼叫端決定,本函式只回答「這個瞬間是哪一運」。
 * @param {number} ms
 * @param {{yunSystem?: string, boundary?: 'lichun'|'gregorian_year'}} [opts] boundary='gregorian_year' 只供與元旦換運對照
 * @returns {{year: number, yun: number, yunYear: number, era: string, approx: boolean, boundary: string}} year 為查運所用的年
 */
export function yunOfInstant(ms, opts = {}) {
  assertInstant(ms);
  const { boundary = 'lichun', ...settings } = opts ?? {};
  if (boundary !== 'lichun' && boundary !== 'gregorian_year') fail('INVALID_SETTING', `boundary=${String(boundary)}`);
  const year = boundary === 'lichun' ? fengshuiYear(ms) : cstYearOf(ms);
  return { year, ...nineYun(year, settings), approx: isApproxYear(cstYearOf(ms)), boundary };
}

// ---------------------------------------------------------------- 臨界旗標

/**
 * 立春臨界旗標。
 * - timeKnown=true: 與立春相差 ≤ 2 分鐘 → nearLichun。
 * - timeKnown=false: 只看日期(以 UTC+8 曆日);出生日恰為立春日 → dateIsLichunDay,並給立春前/後兩種結果供命卦兩算。
 * @param {number} ms 瞬間;不知時刻時只取其 UTC+8 曆日(用 toInstant 給純日期會得到正午)
 * @param {boolean} [timeKnown]
 * @returns {{nearLichun: boolean, dateIsLichunDay: boolean,
 *   alternatives: Array<{side: 'beforeLichun'|'afterLichun', fengshuiYear: number, ganzhi: string}>,
 *   lichun: number, minutesFromLichun: number|null, approx: boolean}}
 */
export function lichunFlags(ms, timeKnown = true) {
  assertInstant(ms);
  const cy = cstYearOf(ms);
  const lc = termAt(cy, 2);
  const nearLichun = Boolean(timeKnown) && Math.abs(ms - lc) <= NEAR_LICHUN_MINUTES * 60000;
  const dateIsLichunDay = !timeKnown && cstDayIndex(ms) === cstDayIndex(lc);
  const alternatives = dateIsLichunDay
    ? [
      { side: 'beforeLichun', fengshuiYear: cy - 1, ganzhi: yearGanzhi(cy - 1).name },
      { side: 'afterLichun', fengshuiYear: cy, ganzhi: yearGanzhi(cy).name },
    ]
    : [];
  return {
    nearLichun,
    dateIsLichunDay,
    alternatives,
    lichun: lc,
    minutesFromLichun: timeKnown ? (ms - lc) / 60000 : null,
    approx: isApproxYear(cy),
  };
}

// ---------------------------------------------------------------- 一次分析

/**
 * 曆法總覽(規格 2.2.4)。時間欄位為 ms,另附 *CST 顯示字串(四捨五入到分)。
 * fengshuiYear/yearGanzhi 依 yearBoundary;月柱與 yun 固定用立春精確瞬間(月柱天文定義、D13)。
 * @param {number} ms
 * @param {Partial<import('./settings.js').DEFAULT_SETTINGS>} [settings]
 * @returns {{instant: number, instantCST: string, fengshuiYear: number, yearGanzhi: string,
 *   lichun: number, lichunCST: string,
 *   month: {jieName: string, name: string, order: number, branch: number, stem: number, start: number, end: number, startCST: string, endCST: string},
 *   yun: {yun: number, yunYear: number, era: string}, approx: boolean,
 *   meta: {schema: string, ruleset: {yearBoundary: string, yunSystem: string}, warnings: string[]}}}
 */
export function analyze(ms, settings = {}) {
  const s = settingsOf(settings);
  const fy = fengshuiYear(ms, s);
  const lc = termAt(fy, 2);
  const mo = monthOf(ms);
  const yun = yunOfInstant(ms, { yunSystem: s.yunSystem });
  const approx = isApproxYear(cstYearOf(ms));
  const warnings = [];
  if (lichunFlags(ms, true).nearLichun) warnings.push('nearLichun');
  if (approx) warnings.push('approxRange');
  return {
    instant: ms,
    instantCST: formatCST(ms),
    fengshuiYear: fy,
    yearGanzhi: yearGanzhi(fy).name,
    lichun: lc,
    lichunCST: formatCST(lc),
    month: {
      jieName: mo.jieName, name: mo.name, order: mo.order, branch: mo.branch, stem: mo.stem,
      start: mo.start, end: mo.end, startCST: formatCST(mo.start), endCST: formatCST(mo.end),
    },
    yun: { yun: yun.yun, yunYear: yun.yunYear, era: yun.era },
    approx,
    meta: {
      schema: 'fengshui.calendar/1',
      ruleset: { yearBoundary: s.yearBoundary, yunSystem: s.yunSystem },
      warnings,
    },
  };
}

// 八宅: 命卦、遊年八星、宅卦、命宅配、八星用途矩陣、八宅財位序(規格 2.3;決策 D08、D14-D22)。
// 純函式、無 DOM、無全域狀態;星表由爻變序列產生,不手打(規格 2.3.2、4.2 第 6 點)。
// 山、卦、方位名一律取自 geo,立春與年界一律取自 calendar(規格 2.2.3 第 8 點)。
//
// 錯誤碼(Error.message 以「碼:」開頭;規格沒列的由本模組自訂):
//  INVALID_INPUT           analyzeBazhai 的 input 不是物件
//  INVALID_HOUSEHOLD       household 不是陣列、成員不是物件、id 不是非空字串
//  DUPLICATE_PERSON_ID     household 內 id 重複
//  INVALID_GENDER          gender 不是 'M' | 'F'
//  INVALID_ROLE            role 不在 ROLES 內
//  INVALID_BIRTH           birth 不是 {local:string, utcOffset, timeKnown?:boolean}
//  INVALID_YEAR            年份不是整數
//  INVALID_FACING          facing 不是物件
//  MISSING_FACING          依 bazhaiFacingBasis 需要的 facing.bazhai / facing.xuankong 缺
//  INVALID_SETTING         設定鍵未知、值不合法(含 bazhaiStarWeights)
//  INVALID_OPTION          opts、placements、lookupUsage 的鍵不合法
//  INVALID_LUNAR_NEW_YEAR  lunarNewYearOf 回傳的不是 'YYYY-MM-DD'
//  LUNAR_LIBRARY_REQUIRED  yearBoundary='lunar_new_year' 但沒給 lunarNewYearOf(規格 2.2.3 第 6 點、U-19)
//  UNKNOWN_GUA / UNKNOWN_DIR / UNKNOWN_MOUNTAIN  查表查不到
// 另外原樣轉出 geo 與 calendar 的錯誤碼: INVALID_BEARING、INVALID_LOCAL_TIME、MISSING_UTC_OFFSET、
// INVALID_UTC_OFFSET、YEAR_OUT_OF_RANGE。

import { resolveSettings, DEFAULT_SETTINGS } from './settings.js';
import { mod9 } from './nine.js';
import {
  GUA,
  DIR8,
  GUA_LINES,
  guaOfLuoshu,
  normalizeBearing,
  sitFromFacing,
  analyzeBearing,
  boundaryOptsFromSettings,
  mountainIndex,
  oppositeOf,
  guaOfMountain,
} from './geo.js';
import { toInstant, fengshuiYear, lichunFlags, yearGanzhi } from './calendar.js';

const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ─────────────────────────── 常數 ───────────────────────────

/** 八星,吉星在前(生氣>延年>天醫>伏位),凶星依凶度(絕命>五鬼>六煞>禍害);預設等級順序,D14。 */
export const STAR_NAMES = Object.freeze(['生氣', '延年', '天醫', '伏位', '絕命', '五鬼', '六煞', '禍害']);
export const AUSPICIOUS_STARS = Object.freeze(['生氣', '延年', '天醫', '伏位']);
export const INAUSPICIOUS_STARS = Object.freeze(['絕命', '五鬼', '六煞', '禍害']);
/** 東四命/宅(坎震巽離)與西四命/宅(乾坤艮兌)。 */
export const EAST_GROUP = Object.freeze(['坎', '震', '巽', '離']);
export const WEST_GROUP = Object.freeze(['乾', '坤', '艮', '兌']);
export const ROLES = Object.freeze(['breadwinner', 'holder', 'wife', 'husband', 'child']);

/**
 * 八星屬性。weight 是財運面預設權重 BAZ_VAL,只有順序有來源依據,數字是設計值(規格 2.3.2、D14)。
 * @type {Readonly<Record<string, Readonly<{nineStar:string, element:string, level:string, weight:number}>>>}
 */
export const STAR_ATTRS = deepFreeze({
  生氣: { nineStar: '貪狼', element: '木', level: '上吉', weight: 1.0 },
  延年: { nineStar: '武曲', element: '金', level: '上吉', weight: 0.75 },
  天醫: { nineStar: '巨門', element: '土', level: '中吉', weight: 0.55 },
  伏位: { nineStar: '輔弼', element: '木', level: '小吉', weight: 0.25 },
  禍害: { nineStar: '祿存', element: '土', level: '次凶', weight: -0.3 },
  六煞: { nineStar: '文曲', element: '水', level: '次凶', weight: -0.3 },
  五鬼: { nineStar: '廉貞', element: '火', level: '大凶', weight: -0.5 },
  絕命: { nineStar: '破軍', element: '金', level: '大凶', weight: -0.6 },
});

/**
 * 產生規則: 從本卦起依序改 [爻位, 星],爻位 0=下爻 1=中爻 2=上爻(bazhai.md 1.3)。
 * 第 k 步所得卦的方位 = 該星位置;第 8 步回到本卦(伏位)。
 */
export const STAR_WALK = deepFreeze([
  [2, '生氣'],
  [1, '五鬼'],
  [0, '延年'],
  [1, '六煞'],
  [2, '禍害'],
  [1, '天醫'],
  [0, '絕命'],
  [1, '伏位'],
]);

function guaOfLines(lines) {
  const hit = GUA.find((g) => GUA_LINES[g].every((v, i) => v === lines[i]));
  if (hit === undefined) fail('UNKNOWN_GUA', `爻 ${lines.join('')} 不是八卦`);
  return hit;
}

function buildStarTables() {
  const byGua = {};
  const byDir = {};
  for (const home of GUA) {
    const lines = [...GUA_LINES[home]];
    const target = {};
    for (const [pos, star] of STAR_WALK) {
      lines[pos] ^= 1;
      target[guaOfLines(lines)] = star;
    }
    byGua[home] = Object.fromEntries(GUA.map((g) => [g, target[g]]));
    byDir[home] = Object.fromEntries(GUA.map((g, k) => [DIR8[k], target[g]]));
  }
  return { byGua, byDir };
}
const TABLES = buildStarTables();

/** 命卦或宅卦 → 方位名 → 星。key 順序同 geo.DIR8。 */
export const STAR_TABLE = deepFreeze(TABLES.byDir);
/** 命卦或宅卦 → 目標卦 → 星(表對稱: STAR_BY_GUA[a][b] === STAR_BY_GUA[b][a])。 */
export const STAR_BY_GUA = deepFreeze(TABLES.byGua);

// ─────────────────────────── 查表 ───────────────────────────

function assertGua(g) {
  if (!GUA.includes(g)) fail('UNKNOWN_GUA', show(g));
}
function assertDir(d) {
  if (!DIR8.includes(d)) fail('UNKNOWN_DIR', show(d));
}
function assertGender(g) {
  if (g !== 'M' && g !== 'F') fail('INVALID_GENDER', `gender 必須是 'M' 或 'F': ${show(g)}`);
}

/**
 * 卦所屬的東四/西四組。
 * @param {string} gua 坎艮震巽離坤兌乾
 * @returns {'east'|'west'}
 * @throws {Error} UNKNOWN_GUA
 */
export function groupOf(gua) {
  if (EAST_GROUP.includes(gua)) return 'east';
  if (WEST_GROUP.includes(gua)) return 'west';
  return fail('UNKNOWN_GUA', show(gua));
}

/**
 * 命宅相配: 命卦組別 === 宅卦組別(規格 2.3.3 C)。
 * @param {string} mingGua 命卦
 * @param {string} zhaiGua 宅卦
 * @returns {boolean}
 * @throws {Error} UNKNOWN_GUA
 */
export function isMatch(mingGua, zhaiGua) {
  return groupOf(mingGua) === groupOf(zhaiGua);
}

/**
 * 某卦(命卦或宅卦)看八個方位的星。回傳拷貝。
 * @param {string} homeGua
 * @returns {Record<string, string>} 方位名 → 星,key 依 北 東北 東 東南 南 西南 西 西北
 * @throws {Error} UNKNOWN_GUA
 */
export function starsOf(homeGua) {
  assertGua(homeGua);
  return { ...STAR_TABLE[homeGua] };
}

/**
 * 某卦看另一個卦所在方位的星。
 * @param {string} homeGua
 * @param {string} targetGua
 * @returns {string}
 * @throws {Error} UNKNOWN_GUA
 */
export function starOf(homeGua, targetGua) {
  assertGua(homeGua);
  assertGua(targetGua);
  return STAR_BY_GUA[homeGua][targetGua];
}

/**
 * 某卦看某方位的星。
 * @param {string} homeGua
 * @param {string} dir 方位名(北 東北 東 東南 南 西南 西 西北)
 * @returns {string}
 * @throws {Error} UNKNOWN_GUA, UNKNOWN_DIR
 */
export function starAtDir(homeGua, dir) {
  assertGua(homeGua);
  assertDir(dir);
  return STAR_TABLE[homeGua][dir];
}

// ─────────────────────────── 設定與權重 ───────────────────────────

const YEAR_BOUNDARIES = ['lichun_exact', 'lichun_date_only', 'fixed_feb4', 'lunar_new_year', 'gregorian_jan1'];
const COUPLE_BASES = ['breadwinner', 'wife', 'husband', 'holderOnly', 'averaged'];
const FACING_BASES = ['door', 'house'];
const BOOL_SETTINGS = ['tianyiFirst', 'stovePreferAuspicious', 'livingRoomGradeByEastWest', 'showMinorityTechniques', 'showGuimenxian'];
/** meta.ruleset 只回存八宅實際讀取的設定。 */
const RULESET_KEYS = [
  'yearBoundary',
  'bazhaiFacingBasis',
  'coupleBasis',
  'tianyiFirst',
  'bazhaiStarWeights',
  'stovePreferAuspicious',
  'livingRoomGradeByEastWest',
  'showMinorityTechniques',
  'showGuimenxian',
  'measureUncertainty',
];
/** 房屋坐向提示八卦分界的最小距離(度),與 geo 一致(規格 2.1.3 第 9 點)。 */
const GUA_HINT_MIN_DEG = 3;
const EPS = 1e-9;

function effectiveWeights(s) {
  const w = Object.fromEntries(STAR_NAMES.map((n) => [n, STAR_ATTRS[n].weight]));
  // D19: 港派天醫地位較高,tianyiFirst 對調延年與天醫的權重。
  if (s.tianyiFirst) [w['延年'], w['天醫']] = [w['天醫'], w['延年']];
  const custom = s.bazhaiStarWeights;
  if (custom !== 'default') {
    if (!isObj(custom)) fail('INVALID_SETTING', `bazhaiStarWeights 必須是 'default' 或 {星名: 權重}: ${show(custom)}`);
    for (const [k, v] of Object.entries(custom)) {
      if (!STAR_NAMES.includes(k)) fail('INVALID_SETTING', `bazhaiStarWeights 有未知的星: ${k}`);
      if (typeof v !== 'number' || !Number.isFinite(v)) fail('INVALID_SETTING', `bazhaiStarWeights.${k} 必須是有限數字: ${show(v)}`);
      w[k] = v;
    }
  }
  return w;
}

function settingsOf(overrides) {
  let s;
  // resolveSettings 用 `in` 判斷鍵,原型鏈上的 constructor / toString 會被當成合法鍵,也會接受 5、[] 這類非物件,
  // 所以八宅在自己的邊界先擋掉。
  if (overrides !== undefined && overrides !== null) {
    if (!isObj(overrides)) fail('INVALID_SETTING', `settings 必須是物件: ${show(overrides)}`);
    for (const k of Object.keys(overrides)) {
      if (!Object.hasOwn(DEFAULT_SETTINGS, k)) fail('INVALID_SETTING', `未知的設定鍵: ${k}`);
    }
  }
  try {
    s = resolveSettings(overrides ?? {});
  } catch (e) {
    // 已經帶碼的錯誤不要疊第二層碼。
    if (/^[A-Z][A-Z0-9_]+: /.test(e.message)) throw e;
    throw new Error(`INVALID_SETTING: ${e.message}`);
  }
  if (!YEAR_BOUNDARIES.includes(s.yearBoundary)) fail('INVALID_SETTING', `yearBoundary 不認得: ${show(s.yearBoundary)}`);
  if (!COUPLE_BASES.includes(s.coupleBasis)) fail('INVALID_SETTING', `coupleBasis 不認得: ${show(s.coupleBasis)}`);
  if (!FACING_BASES.includes(s.bazhaiFacingBasis)) fail('INVALID_SETTING', `bazhaiFacingBasis 不認得: ${show(s.bazhaiFacingBasis)}`);
  for (const k of BOOL_SETTINGS) {
    if (typeof s[k] !== 'boolean') fail('INVALID_SETTING', `${k} 必須是布林: ${show(s[k])}`);
  }
  if (typeof s.measureUncertainty !== 'number' || !Number.isFinite(s.measureUncertainty) || s.measureUncertainty < 0) {
    fail('INVALID_SETTING', `measureUncertainty 必須是非負有限數字: ${show(s.measureUncertainty)}`);
  }
  effectiveWeights(s);
  return s;
}

/**
 * 八星有效權重(已套用 tianyiFirst 與 bazhaiStarWeights 覆寫)。回傳拷貝。
 * @param {object} [settings] 部分或完整 Settings
 * @returns {Record<string, number>} 星 → 權重
 * @throws {Error} INVALID_SETTING
 */
export function starWeights(settings = {}) {
  return effectiveWeights(settingsOf(settings));
}

/**
 * 個人財位序(D19): 生氣、延年、天醫依權重排,伏位當備位。
 * 「生氣是財星」不代表灶座可以放在生氣位;古法灶座壓生氣位是財產受損(見 usageGuide 的 stoveSeat)。
 * @param {string} gua 命卦
 * @param {object} [settings] 部分或完整 Settings(tianyiFirst、bazhaiStarWeights)
 * @returns {Array<{star:string, dir:string, backup?:true}>} 依序 3 個財星位 + 伏位備位
 * @throws {Error} UNKNOWN_GUA, INVALID_SETTING
 */
export function wealthOrder(gua, settings = {}) {
  assertGua(gua);
  const w = effectiveWeights(settingsOf(settings));
  const row = STAR_TABLE[gua];
  const dirOf = (star) => DIR8.find((d) => row[d] === star);
  const three = ['生氣', '延年', '天醫']
    .map((star, i) => ({ star, i }))
    .sort((a, b) => w[b.star] - w[a.star] || a.i - b.i);
  return [...three.map(({ star }) => ({ star, dir: dirOf(star) })), { star: '伏位', dir: dirOf('伏位'), backup: true }];
}

// ─────────────────────────── 命卦 ───────────────────────────

/**
 * 由風水年(已依年界換算)與性別算命卦。男 mod9(2-Y)、女 mod9(Y+4),0 視為 9;
 * 5 入中: 男寄坤(2)、女寄艮(8),rawNumber 保留供文案說明(規格 2.3.3 A)。
 * 不用「和為 0 時用 10」的英文站算法,那會讓 2000 年男得 8(規格 2.3.3 A 第 5 點)。
 * @param {number} year 風水年(整數)
 * @param {'M'|'F'} gender
 * @returns {{effectiveYear:number, rawNumber:number, guaNumberUsed:number, gua:string, group:'east'|'west'}}
 * @throws {Error} INVALID_YEAR, INVALID_GENDER
 */
export function mingGuaFromYear(year, gender) {
  if (!Number.isInteger(year)) fail('INVALID_YEAR', `年份必須是整數: ${show(year)}`);
  assertGender(gender);
  const rawNumber = gender === 'M' ? mod9(2 - year) : mod9(year + 4);
  const guaNumberUsed = rawNumber === 5 ? (gender === 'M' ? 2 : 8) : rawNumber;
  const gua = guaOfLuoshu(guaNumberUsed);
  return { effectiveYear: year, rawNumber, guaNumberUsed, gua, group: groupOf(gua) };
}

const CST_MS = 8 * 3600e3;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const cstYearOf = (ms) => new Date(ms + CST_MS).getUTCFullYear();
/** UTC+8 曆日 'YYYY-MM-DD'。不用 calendar.formatCST: 它四捨五入到分,23:59:40 會被推到隔天。 */
function cstDateOf(ms) {
  const t = new Date(ms + CST_MS);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function resolveOpts(opts) {
  if (!isObj(opts)) fail('INVALID_OPTION', 'opts 必須是物件');
  for (const k of Object.keys(opts)) {
    if (k !== 'lunarNewYearOf') fail('INVALID_OPTION', `未知的選項: ${k}`);
  }
  if (opts.lunarNewYearOf !== undefined && typeof opts.lunarNewYearOf !== 'function') {
    fail('INVALID_OPTION', 'lunarNewYearOf 必須是函式 (西曆年) => \'YYYY-MM-DD\'');
  }
  return { lunarNewYearOf: opts.lunarNewYearOf };
}

// 春節以日為單位(正月初一 00:00 起換年),比較 UTC+8 曆日;農曆庫由呼叫端注入(U-19)。
function lunarNewYearYear(ms, lunarNewYearOf) {
  if (typeof lunarNewYearOf !== 'function') {
    fail('LUNAR_LIBRARY_REQUIRED', "yearBoundary='lunar_new_year' 需要農曆資料,請以 opts.lunarNewYearOf 提供(規格 2.2.3 第 6 點)");
  }
  const y = cstYearOf(ms);
  const d = lunarNewYearOf(y);
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    fail('INVALID_LUNAR_NEW_YEAR', `lunarNewYearOf(${y}) 必須回傳 'YYYY-MM-DD': ${show(d)}`);
  }
  return cstDateOf(ms) >= d ? y : y - 1;
}

/**
 * @typedef {Object} MingGua
 * @property {number} effectiveYear 依年界換算後的風水年
 * @property {number} rawNumber 5 入中前的數字 1-9
 * @property {number} guaNumberUsed 實際用的洛書數(5 已改寄)
 * @property {string} gua 命卦
 * @property {'east'|'west'} group 東四命/西四命
 * @property {{nearLichun:boolean, dateIsLichunDay:boolean, alternatives:Array<{side:'beforeLichun'|'afterLichun', ganzhi:string, effectiveYear:number, rawNumber:number, guaNumberUsed:number, gua:string, group:string}>}} flags
 *   臨界旗標;alternatives 在「立春日不知時刻」與「立春前後 2 分鐘內」時給立春前/後兩種結果,其餘為空陣列
 * @property {boolean} approx 出生年超出 calendar 精確支援範圍(1864-2150),立春為外推值
 */

/**
 * 由出生時刻算命卦。出生時刻先換成 UTC 再與立春比較,台灣 1938-1945 為 +09:00(規格 2.2.3 第 4 點)。
 * 不知時刻(timeKnown=false)時忽略 local 內的時分,取當地正午(calendar.toInstant 的約定)。
 * @param {{local:string, utcOffset:string, timeKnown?:boolean}} birth local='YYYY-MM-DDTHH:mm' 或 'YYYY-MM-DD'
 * @param {'M'|'F'} gender
 * @param {object} [settings] 只讀 yearBoundary
 * @param {{lunarNewYearOf?:(year:number)=>string}} [opts]
 *   lunarNewYearOf: yearBoundary='lunar_new_year' 專用,回傳該西曆年的春節 UTC+8 日期 'YYYY-MM-DD'
 * @returns {MingGua}
 * @throws {Error} INVALID_GENDER, INVALID_BIRTH, INVALID_SETTING, INVALID_OPTION, LUNAR_LIBRARY_REQUIRED,
 *   以及 calendar 的 INVALID_LOCAL_TIME / MISSING_UTC_OFFSET / INVALID_UTC_OFFSET / YEAR_OUT_OF_RANGE
 */
export function mingGuaFromBirth(birth, gender, settings = {}, opts = {}) {
  assertGender(gender);
  if (!isObj(birth) || typeof birth.local !== 'string') {
    fail('INVALID_BIRTH', "birth 必須是 {local:'YYYY-MM-DDTHH:mm', utcOffset:'+08:00', timeKnown?:boolean}");
  }
  if (birth.timeKnown !== undefined && typeof birth.timeKnown !== 'boolean') fail('INVALID_BIRTH', 'timeKnown 必須是布林');
  const s = settingsOf(settings);
  const o = resolveOpts(opts);
  const timeKnown = birth.timeKnown !== false;
  let local = birth.local;
  if (!timeKnown) {
    // 只取日期,但日期之後的內容仍要符合格式;不能用 slice(0,10) 放過 '1990-05-15garbage'。
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(birth.local.trim());
    if (!m) fail('INVALID_LOCAL_TIME', `需為 'YYYY-MM-DDTHH:mm' 或 'YYYY-MM-DD',收到 ${show(birth.local)}`);
    local = m[1];
  }
  const instant = toInstant({ local, utcOffset: birth.utcOffset });
  const year =
    s.yearBoundary === 'lunar_new_year'
      ? lunarNewYearYear(instant, o.lunarNewYearOf)
      : fengshuiYear(instant, { yearBoundary: s.yearBoundary });
  const f = lichunFlags(instant, timeKnown);
  // 臨界時使用者需要看到另一年的結果,不只旗標;立春在 2 月,所以 UTC 年 = UTC+8 年。
  const cy = new Date(f.lichun).getUTCFullYear();
  const alternatives =
    f.dateIsLichunDay || f.nearLichun
      ? [
          ['beforeLichun', cy - 1],
          ['afterLichun', cy],
        ].map(([side, y]) => ({ side, ganzhi: yearGanzhi(y).name, ...mingGuaFromYear(y, gender) }))
      : [];
  return {
    ...mingGuaFromYear(year, gender),
    flags: { nearLichun: f.nearLichun, dateIsLichunDay: f.dateIsLichunDay, alternatives },
    approx: f.approx,
  };
}

// ─────────────────────────── 宅卦 ───────────────────────────

/**
 * @typedef {Object} Zhai
 * @property {number} facingBearing 正規化後的向 [0,360)
 * @property {number} sitBearing 坐 = 向 + 180
 * @property {string} facingMountain 向山(24 山)
 * @property {string} sitMountain 坐山
 * @property {string} gua 宅卦(坐山所屬的卦)
 * @property {string} name 例 '坎宅'
 * @property {'east'|'west'} group 東四宅/西四宅
 * @property {string} sitDir 坐方位名,例 坐子 = '北'
 */

/**
 * 由向的方位角算宅卦(以「坐」定宅;坐北朝南=坎宅)。任意實數先正規化,邊界半開區間 [起,止)(規格 2.3.3 B)。
 * @param {number} facing 面朝外的方位角(度)
 * @returns {Zhai}
 * @throws {Error} INVALID_BEARING
 */
export function zhaiFromFacing(facing) {
  const r = sitFromFacing(facing);
  return {
    // + 0 把輸入 -0 換成 0,避免序列化後與 0 不同
    facingBearing: normalizeBearing(facing) + 0,
    sitBearing: r.sitBearing,
    facingMountain: r.facingMountain,
    sitMountain: r.sitMountain,
    gua: r.zhaiGua,
    name: `${r.zhaiGua}宅`,
    group: groupOf(r.zhaiGua),
    sitDir: r.zhaiSitDir,
  };
}

/**
 * 由坐山名查宅卦(24 山 → 宅卦,每卦三山)。
 * @param {string} sitMountain 坐山名,例 '子'
 * @returns {{sitMountain:string, sitCenterDeg:number, facingMountain:string, facingCenterDeg:number, gua:string, name:string, group:'east'|'west', sitDir:string}}
 * @throws {Error} UNKNOWN_MOUNTAIN
 */
export function zhaiFromSitMountain(sitMountain) {
  const i = mountainIndex(sitMountain);
  const gua = guaOfMountain(sitMountain);
  return {
    sitMountain,
    sitCenterDeg: 15 * i,
    facingMountain: oppositeOf(sitMountain),
    facingCenterDeg: 15 * ((i + 12) % 24),
    gua,
    name: `${gua}宅`,
    group: groupOf(gua),
    sitDir: DIR8[GUA.indexOf(gua)],
  };
}

// ─────────────────────────── 八星用途矩陣(規格 2.3.4) ───────────────────────────

const RATING_ORDER = Object.freeze({ best: 0, good: 1, ok: 2, avoid: 3, worst: 4 });
const R = (rating, note = '') => ({ rating, note });

/**
 * 位置(position)與朝向(facing)分開查同一張 8x8 表,兩區不互相扣分(D21)。
 * 評級: best 最佳 / good 宜 / ok 尚可 / avoid 避免 / worst 最需避開。
 * 灶座與廁所的 good 是「宜壓」凶位(坐凶向吉,D15)。客廳四吉位不分先後(D22)。
 * 用途說明取自規格表的欄位描述,措辭依 5.1 保持「傳統上」語氣。
 */
export const USAGE_MATRIX = deepFreeze({
  door: {
    生氣: R('best', '傳統上大門最佳的方位'),
    延年: R('good'),
    天醫: R('good'),
    伏位: R('ok'),
    禍害: R('avoid'),
    六煞: R('avoid'),
    五鬼: R('avoid'),
    絕命: R('worst', '傳統上最需要避開的位置'),
  },
  masterBedroom: {
    生氣: R('good'),
    延年: R('good', '夫妻房'),
    天醫: R('good'),
    伏位: R('good'),
    禍害: R('avoid'),
    六煞: R('avoid', '少數派把單身者的居室視為桃花位'),
    五鬼: R('avoid'),
    絕命: R('worst', '傳統上最需要避開的位置'),
  },
  stoveSeat: {
    生氣: R('avoid', '古法: 灶座壓生氣位,人丁不旺、財產受損'),
    延年: R('avoid', '古法: 灶座壓延年位,婚姻難成'),
    天醫: R('avoid', '古法: 灶座壓天醫位,久病臥床;少數派主張可放'),
    伏位: R('avoid', '古法: 灶座壓伏位,無財無壽'),
    禍害: R('good', '宜壓: 無災無病不退財'),
    六煞: R('good', '宜壓: 發丁發財'),
    五鬼: R('good', '宜壓(古法);西方主張避開'),
    絕命: R('good', '宜壓'),
  },
  toilet: {
    生氣: R('avoid', '幾乎所有來源都建議避開'),
    延年: R('avoid'),
    天醫: R('avoid', '傳統上認為容易漏財'),
    伏位: R('avoid'),
    禍害: R('good', '宜作廁所'),
    六煞: R('good', '宜作廁所,也適合儲物'),
    五鬼: R('good', '宜作廁所,也適合儲藏'),
    絕命: R('good', '宜作廁所,也適合不常用的儲藏'),
  },
  living: {
    生氣: R('good', '四吉位不分先後'),
    延年: R('good', '四吉位不分先後'),
    天醫: R('good', '四吉位不分先後'),
    伏位: R('good', '四吉位不分先後'),
    禍害: R('avoid'),
    六煞: R('avoid'),
    五鬼: R('avoid'),
    絕命: R('avoid'),
  },
  bedHead: {
    生氣: R('good', '事業、財運、精力'),
    延年: R('good', '感情、長壽'),
    天醫: R('good', '健康、久病康復'),
    伏位: R('good', '幼童、靜心'),
    禍害: R('avoid', '夫妻命卦不同時的折衷睡向'),
    六煞: R('avoid'),
    五鬼: R('avoid'),
    絕命: R('avoid'),
  },
  desk: {
    生氣: R('best', '書房或辦公桌首選'),
    延年: R('good', '人際類工作'),
    天醫: R('good', '次選'),
    伏位: R('ok', '幼童'),
    禍害: R('avoid'),
    六煞: R('avoid'),
    五鬼: R('avoid'),
    絕命: R('avoid'),
  },
  stoveMouth: {
    生氣: R('good', '傳統上認為有利催財'),
    延年: R('good'),
    天醫: R('good', '傳統上認為主無病'),
    伏位: R('good'),
    禍害: R('avoid'),
    六煞: R('avoid'),
    五鬼: R('avoid'),
    絕命: R('worst', '傳統上最需要避開的朝向'),
  },
});

// D15 少數派(Feng Shui Store 天醫位放爐灶、Feng Shui Beginner 生氣延年天醫宜廚房)。
const STOVE_SEAT_AUSPICIOUS = deepFreeze({
  生氣: R('good', '少數派: 灶座放在吉位'),
  延年: R('good', '少數派: 灶座放在吉位'),
  天醫: R('good', '少數派: 灶座放在吉位'),
  伏位: R('avoid', '少數派來源亦不建議'),
  禍害: R('avoid'),
  六煞: R('avoid'),
  五鬼: R('avoid'),
  絕命: R('avoid'),
});

// D22: 東西四分級只有單一現代加註(《八宅明鏡》網頁),預設不採用,僅作開關。
function livingGraded(group) {
  const first = group === 'east' ? ['生氣', '伏位'] : ['延年', '天醫'];
  const note = group === 'east' ? '東四命首選生氣位與伏位(單一來源)' : '西四命首選延年位與天醫位(單一來源)';
  return Object.fromEntries(
    STAR_NAMES.map((star) => {
      if (first.includes(star)) return [star, R('best', note)];
      return [star, AUSPICIOUS_STARS.includes(star) ? R('good') : R('avoid')];
    }),
  );
}

const POSITION_USES = ['door', 'masterBedroom', 'stoveSeat', 'toilet', 'living'];
const FACING_USES = ['bedHead', 'desk', 'stoveMouth'];

/**
 * 某卦看八個方位在各用途上的評級。位置區與朝向區分開輸出。
 * 每個用途的陣列含 8 個方位,依評級由好到差、同級依方位順序;回傳全新物件,可自由修改。
 * @param {string} gua 命卦(個人用途)或宅卦(整屋用途)
 * @param {object} [settings] 部分或完整 Settings(stovePreferAuspicious、livingRoomGradeByEastWest)
 * @returns {{position:Record<'door'|'masterBedroom'|'stoveSeat'|'toilet'|'living', Array<{dir:string, star:string, rating:string, note:string}>>,
 *   facing:Record<'bedHead'|'desk'|'stoveMouth', Array<{dir:string, star:string, rating:string, note:string}>>}}
 * @throws {Error} UNKNOWN_GUA, INVALID_SETTING
 */
export function usageGuide(gua, settings = {}) {
  assertGua(gua);
  const s = settingsOf(settings);
  const matrix = { ...USAGE_MATRIX };
  if (s.stovePreferAuspicious) matrix.stoveSeat = STOVE_SEAT_AUSPICIOUS;
  if (s.livingRoomGradeByEastWest) matrix.living = livingGraded(groupOf(gua));
  const row = STAR_TABLE[gua];
  const build = (use) =>
    DIR8.map((dir, i) => ({ dir, star: row[dir], rating: matrix[use][row[dir]].rating, note: matrix[use][row[dir]].note, i }))
      .sort((a, b) => RATING_ORDER[a.rating] - RATING_ORDER[b.rating] || a.i - b.i)
      .map(({ dir, star, rating, note }) => ({ dir, star, rating, note }));
  return {
    position: Object.fromEntries(POSITION_USES.map((u) => [u, build(u)])),
    facing: Object.fromEntries(FACING_USES.map((u) => [u, build(u)])),
  };
}

const PLACEMENT_KEYS = ['roomPosition', 'bedHead', 'stoveSeat', 'stoveMouth', 'deskFacing'];

/**
 * 位置或朝向查星: 同一張表,差別只在「方位」由哪個物理量提供(規格 2.3.4)。
 * @param {string} gua 命卦
 * @param {{roomPosition?:string, bedHead?:string, stoveSeat?:string, stoveMouth?:string, deskFacing?:string}} placements
 *   方位名。roomPosition/stoveSeat 是位置(從宅中心看),bedHead/stoveMouth/deskFacing 是朝向
 * @returns {Record<string, string>} 給了哪個鍵就回 `${鍵}Star`,例 {bedHeadStar:'天醫'}
 * @throws {Error} UNKNOWN_GUA, UNKNOWN_DIR, INVALID_OPTION
 */
export function lookupUsage(gua, placements) {
  assertGua(gua);
  if (!isObj(placements)) fail('INVALID_OPTION', 'placements 必須是物件');
  for (const k of Object.keys(placements)) {
    if (!PLACEMENT_KEYS.includes(k)) fail('INVALID_OPTION', `未知的鍵: ${k}`);
  }
  const out = {};
  for (const k of PLACEMENT_KEYS) {
    if (placements[k] !== undefined) out[`${k}Star`] = starAtDir(gua, placements[k]);
  }
  return out;
}

// ─────────────────────────── 門主灶三要 ───────────────────────────

const THREE_KEY_SLOTS = ['door', 'master', 'stove'];
// 原文「三吉」指生氣、天醫、延年,伏位另論(bazhai.verify.md R12),所以伏位不計入。
const THREE_GOOD = new Set(['生氣', '延年', '天醫']);
const THREE_KEY_LABELS = {
  all: '門、主臥、灶口三項都落在吉方',
  two: '門、主臥、灶口三項中有兩項落在吉方',
  one: '門、主臥、灶口三項中有一項落在吉方,傳統上認為仍可居住',
  none: '門、主臥、灶口三項都沒有落在吉方,傳統上較難調整,建議請專業老師到現場評估',
};

function assertPlacements(p) {
  if (!isObj(p)) fail('INVALID_OPTION', 'placements 必須是 {door, master, stove} 物件');
  for (const k of Object.keys(p)) {
    if (!THREE_KEY_SLOTS.includes(k)) fail('INVALID_OPTION', `未知的鍵: ${k}`);
  }
  for (const k of THREE_KEY_SLOTS) {
    if (p[k] === undefined) fail('INVALID_OPTION', `placements 缺少 ${k}`);
    assertDir(p[k]); // household 為空時 threeKeys 不會被呼叫,錯誤方位不能被靜默吞掉
  }
}

/**
 * 門、主、灶三要計分(D16;Uncle Kin: 三者皆吉為上吉,兩者中吉,一者可居)。
 * 三個方位一律用同一個卦查星(依命不依宅時傳命卦)。
 * @param {string} gua 命卦
 * @param {{door:string, master:string, stove:string}} placements door=大門位置、master=主臥位置、stove=灶口朝向,皆為方位名
 * @returns {{stars:Record<string,string>, counted:Record<string,boolean>, count:number, verdict:'all'|'two'|'one'|'none', label:string}}
 * @throws {Error} UNKNOWN_GUA, UNKNOWN_DIR, INVALID_OPTION
 */
export function threeKeys(gua, placements) {
  assertGua(gua);
  assertPlacements(placements);
  const stars = {};
  const counted = {};
  for (const k of THREE_KEY_SLOTS) {
    stars[k] = starAtDir(gua, placements[k]);
    counted[k] = THREE_GOOD.has(stars[k]);
  }
  const count = THREE_KEY_SLOTS.filter((k) => counted[k]).length;
  const verdict = ['none', 'one', 'two', 'all'][count];
  return { stars, counted, count, verdict, label: THREE_KEY_LABELS[verdict] };
}

// ─────────────────────────── 分析 ───────────────────────────

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {'info'|'note'|'caution'} level
 * @property {string} title
 * @property {string} body
 * @property {'high'|'medium'|'low'} confidence
 * @property {'source'|'inference'|'design'|'minority'} tag
 * @property {string|null} schoolNote
 * @property {string[]} refs
 * @property {string|null} subject 與哪位家人有關(household 的 id),整體性提示為 null
 */

const finding = ({ id, level, title, body, confidence, tag, schoolNote = null, refs = [], subject = null }) => ({
  id,
  level,
  title,
  body,
  confidence,
  tag,
  schoolNote,
  refs,
  subject,
});

const ADVICE_MATCH = '命卦與房屋屬於同一組,床頭、書桌、灶口可參考自己命盤的吉方,大門與整屋可對照宅盤';
// 文字取自規格 2.3.1 範例(D16 依命不依宅)。
const ADVICE_MISMATCH = '以個人命卦重排床頭、書桌、灶口的吉方;大門若無法改,至少讓門、主臥、灶口三項中有一項落在吉方';
const ADVICE_EMPTY = '尚未輸入家人資料,這裡只列出房屋的宅卦與八個方位的星位';

const BASIS_TEXT = {
  breadwinner: '目前採「以主要收入者為主」:大門優先照顧主要收入者的吉方,睡向優先照顧與房屋組別不同的一方(傳統上另有「兩吉給男、一吉給女」的折衷說法)。',
  wife: '目前採「以妻子為主」:夫妻臥房安排在妻子的吉方。',
  husband: '目前採「以丈夫為主」:大門與臥房優先照顧丈夫的吉方。',
  holderOnly: '目前採「只看戶主」:只要戶主的命卦與房屋配合即可,其他成員可以不予理會。',
  averaged: '目前採「平均」:把每個人各方位的星等級取平均,挑出大家都比較適合的方位。',
};

function readHousehold(h) {
  if (!Array.isArray(h)) fail('INVALID_HOUSEHOLD', 'household 必須是陣列');
  const seen = new Set();
  // 自動編號 p1.. 不可撞到別人顯式給的 id;Array.from 讓稀疏陣列的空洞變成 undefined 而被擋下。
  const explicit = new Set(Array.from(h, (p) => (isObj(p) ? p.id : undefined)).filter((v) => typeof v === 'string'));
  return Array.from(h).map((p, i) => {
    if (!isObj(p)) fail('INVALID_HOUSEHOLD', `household[${i}] 必須是物件`);
    let id = p.id;
    if (id === undefined) {
      id = `p${i + 1}`;
      while (explicit.has(id)) id += '_';
    }
    if (typeof id !== 'string' || id === '') fail('INVALID_HOUSEHOLD', `household[${i}].id 必須是非空字串`);
    if (seen.has(id)) fail('DUPLICATE_PERSON_ID', id);
    seen.add(id);
    if (p.role !== undefined && p.role !== null && !ROLES.includes(p.role)) fail('INVALID_ROLE', show(p.role));
    return { id, gender: p.gender, birth: p.birth, role: p.role ?? null };
  });
}

function readFacing(facing, s) {
  if (!isObj(facing)) fail('INVALID_FACING', 'facing 必須是物件,例如 {bazhai: 180}');
  // D08: 八宅預設用大門朝向,可切成沿用宅向(玄空用的 facing.xuankong)。
  const key = s.bazhaiFacingBasis === 'house' ? 'xuankong' : 'bazhai';
  if (facing[key] === undefined) fail('MISSING_FACING', `bazhaiFacingBasis=${s.bazhaiFacingBasis} 需要 facing.${key}`);
  return facing[key];
}

/** 決定「大門與主臥優先照顧誰」。回傳 {id, fallback};fallback=true 表示沒有對應角色而退回第一位。 */
function resolveAnchor(people, basis) {
  if (basis === 'averaged' || people.length === 0) return { id: null, fallback: false };
  const byRole = (r) => people.find((p) => p.role === r);
  let hit;
  if (basis === 'breadwinner') hit = byRole('breadwinner') ?? byRole('holder');
  else if (basis === 'wife') hit = byRole('wife') ?? people.find((p) => p.gender === 'F');
  else if (basis === 'husband') hit = byRole('husband') ?? people.find((p) => p.gender === 'M');
  else hit = byRole('holder');
  if (hit) return { id: hit.id, fallback: false };
  return { id: people[0].id, fallback: people.length > 1 };
}

/**
 * @typedef {Object} BazhaiInput
 * @property {Array<{id?:string, name?:string, gender:'M'|'F', birth:{local:string, utcOffset:string, timeKnown?:boolean},
 *   role?:'breadwinner'|'holder'|'wife'|'husband'|'child'}>} household 可為空陣列(只看房屋)
 * @property {{bazhai?:number, xuankong?:number}} facing bazhai=大門朝向(預設用它),xuankong=宅向(bazhaiFacingBasis='house' 才用)
 * @property {object} [settings] 部分 Settings,未知鍵丟 INVALID_SETTING
 * @property {{door:string, master:string, stove:string}} [placements] 給了才算門主灶三要;方位名
 */

/**
 * 八宅分析: 每人的命卦與八星方位、房屋的宅卦與八星方位、命宅相配與多人處理、財位序、用途評級。
 * 命盤(人)用於床、灶口、書桌,宅盤(屋)用於大門與整屋相配(D14)。純函式,不修改輸入。
 * @param {BazhaiInput} input
 * @param {{lunarNewYearOf?:(year:number)=>string}} [opts] 農曆春節日期解析器,yearBoundary='lunar_new_year' 才需要
 * @returns {{
 *   meta:{schema:'fengshui.bazhai/1', ruleset:object, warnings:string[]},
 *   people:Array<{id:string, ming:MingGua, stars:Record<string,string>,
 *     wealthOrder:Array<{star:string, dir:string, backup?:true}>, usage:ReturnType<typeof usageGuide>,
 *     threeKeys:ReturnType<typeof threeKeys>|null}>,
 *   house:Zhai & {stars:Record<string,string>, usage:ReturnType<typeof usageGuide>,
 *     boundary:{distDeg:number, kind:'gua'|'shan', onLine:boolean, nearGuaBoundary:boolean, otherGua:string|null}},
 *   match:{byPerson:Record<string,boolean>, policy:'mingOverHouse', advice:string, basis:string, mixed:boolean,
 *     consideredIds:string[], anchorId:string|null, sleepCareId:string|null,
 *     combined:Array<{dir:string, score:number, stars:Record<string,string>}>|null},
 *   findings:Finding[]
 * }}
 * @throws {Error} INVALID_INPUT, INVALID_HOUSEHOLD, DUPLICATE_PERSON_ID, INVALID_GENDER, INVALID_ROLE, INVALID_BIRTH,
 *   INVALID_FACING, MISSING_FACING, INVALID_SETTING, INVALID_OPTION, INVALID_LUNAR_NEW_YEAR, LUNAR_LIBRARY_REQUIRED,
 *   INVALID_BEARING,以及 calendar 的時刻錯誤碼
 */
export function analyzeBazhai(input, opts = {}) {
  if (!isObj(input)) fail('INVALID_INPUT', 'input 必須是物件');
  const o = resolveOpts(opts);
  const s = settingsOf(input.settings);
  const household = readHousehold(input.household);
  const placements = input.placements ?? null;
  if (placements !== null) assertPlacements(placements);
  const facingBearing = readFacing(input.facing, s);

  const warnings = new Set();
  const findings = [];

  // ── 房屋 ──
  const zhai = zhaiFromFacing(facingBearing);
  // 坐與向的卦界距離相同(180 度是 45 度的整數倍),用坐的 24 山分析才能講「宅卦」而不是「向的卦」。
  const b = analyzeBearing(zhai.sitBearing, boundaryOptsFromSettings(s));
  const nearGuaBoundary = b.boundaryKind === 'gua' && b.boundaryDist < Math.max(s.measureUncertainty, GUA_HINT_MIN_DEG) - EPS;
  const otherGua = nearGuaBoundary ? b.neighborGua : null;
  if (nearGuaBoundary) {
    warnings.add('nearGuaBoundary');
    const where = b.onLine ? '幾乎壓在分界線上' : `距分界約 ${Math.floor(b.boundaryDist + 0.5)} 度`;
    findings.push(
      finding({
        id: 'bz.house.near_gua_boundary',
        level: 'note',
        title: '房屋坐向接近八卦分界',
        body:
          `量到的坐向落在「${zhai.gua}宅」與「${otherGua}宅」的分界附近(${where})。` +
          `手機的誤差可能跨過分界,宅卦可能是${zhai.gua}宅或${otherGua}宅,建議靠窗重量 3 到 5 次,或請老師用專業羅盤複核。`,
        confidence: 'medium',
        tag: 'design',
        refs: ['orientation.md#2.4', 'DOMAIN_SPEC.md#2.3.3'],
      }),
    );
  }
  const house = {
    ...zhai,
    stars: starsOf(zhai.gua),
    usage: usageGuide(zhai.gua, s),
    boundary: { distDeg: b.boundaryDist, kind: b.boundaryKind, onLine: b.onLine, nearGuaBoundary, otherGua },
  };

  // ── 家人 ──
  const people = household.map((p) => {
    const ming = mingGuaFromBirth(p.birth, p.gender, s, o);
    return { id: p.id, gender: p.gender, role: p.role, ming };
  });
  for (const p of people) {
    const { flags } = p.ming;
    // 年界不是立春精確瞬間時,立春臨界不影響結果,不提示。
    if (s.yearBoundary === 'lichun_exact' && flags.nearLichun) {
      warnings.add('nearLichun');
      const [before, after] = flags.alternatives;
      findings.push(
        finding({
          id: 'bz.ming.near_lichun',
          level: 'caution',
          title: '出生時刻接近立春',
          body:
            '出生時刻與立春(干支曆換年的時刻)相差不到 2 分鐘,' +
            `命卦可能是${before.gua}命或${after.gua}命。請確認出生時分是否準確;兩種結果都會一併列出。`,
          confidence: 'high',
          tag: 'design',
          refs: ['DOMAIN_SPEC.md#2.2.3'],
          subject: p.id,
        }),
      );
    }
    if (s.yearBoundary === 'lichun_exact' && flags.dateIsLichunDay) {
      warnings.add('dateIsLichunDay');
      const [before, after] = flags.alternatives;
      findings.push(
        finding({
          id: 'bz.ming.lichun_day',
          level: 'note',
          title: '出生日剛好是立春日',
          body:
            '立春當天出生又不知道出生時刻,無法判斷命卦要算立春前' +
            `(${before.gua}命)還是立春後(${after.gua}命)。兩種結果都已列出,請向家人或出生證明確認出生時刻。`,
          confidence: 'high',
          tag: 'design',
          refs: ['DOMAIN_SPEC.md#2.2.3'],
          subject: p.id,
        }),
      );
    }
    if (p.ming.approx) {
      warnings.add('approxRange');
      findings.push(
        finding({
          id: 'bz.ming.approx',
          level: 'note',
          title: '出生年超出精確計算範圍',
          body: '這個年份的立春時刻是外推的估計值,可能有數小時的誤差;若出生日就在立春前後幾天,命卦請再用萬年曆確認。',
          confidence: 'medium',
          tag: 'design',
          refs: ['DOMAIN_SPEC.md#2.2.1'],
          subject: p.id,
        }),
      );
    }
  }

  // ── 命宅配與多人 ──
  const byPerson = Object.fromEntries(people.map((p) => [p.id, p.ming.group === house.group]));
  const mixed = new Set(people.map((p) => p.ming.group)).size > 1;
  const anchor = resolveAnchor(people, s.coupleBasis);
  if (anchor.fallback) warnings.add('anchorFallback');
  const consideredIds = s.coupleBasis === 'holderOnly' && anchor.id !== null ? [anchor.id] : people.map((p) => p.id);
  let sleepCareId = null;
  if (anchor.id !== null) {
    // 「睡向照顧與宅卦組別不同的一方」;沒有別人不配時回到錨定的人。
    sleepCareId =
      s.coupleBasis === 'breadwinner' ? (people.find((p) => p.id !== anchor.id && !byPerson[p.id])?.id ?? anchor.id) : anchor.id;
  }
  let combined = null;
  if (s.coupleBasis === 'averaged' && people.length > 0) {
    const w = effectiveWeights(s);
    const stars = (dir) => Object.fromEntries(people.map((p) => [p.id, STAR_TABLE[p.ming.gua][dir]]));
    combined = DIR8.map((dir, i) => {
      const st = stars(dir);
      const score = Object.values(st).reduce((sum, star) => sum + w[star], 0) / people.length;
      return { dir, score, stars: st, i };
    })
      .sort((x, y) => y.score - x.score || x.i - y.i)
      .map(({ dir, score, stars: st }) => ({ dir, score, stars: st }));
  }
  let advice = ADVICE_EMPTY;
  if (consideredIds.length > 0) advice = consideredIds.every((id) => byPerson[id]) ? ADVICE_MATCH : ADVICE_MISMATCH;
  if (mixed) {
    findings.push(
      finding({
        id: 'bz.household.mixed',
        level: 'note',
        title: '家人的命卦組別不同',
        body: `家人的命卦分屬東四命與西四命,沒有一套吉方能同時配合所有人。${BASIS_TEXT[s.coupleBasis]}`,
        confidence: 'medium',
        tag: 'source',
        schoolNote: '夫妻命卦不同組時各派做法不一,本 App 預設採「以主要收入者為主」,可在設定改成其他做法。',
        refs: ['bazhai.md#3.5', 'DOMAIN_SPEC.md#2.3.5'],
      }),
    );
  }

  // ── 少數派(預設關閉) ──
  if (s.showMinorityTechniques) {
    findings.push(
      finding({
        id: 'bz.minority.wugui_yuncai',
        level: 'info',
        title: '少數說法: 五鬼運財',
        body:
          '少數流派主張,八字喜火的人可把廚房或灶座安排在五鬼位「以凶化吉」。此說依賴個人八字喜忌,沒有公開可驗證的標準,' +
          '本 App 預設仍把五鬼位當成需要留意的位置,不做運財建議。',
        confidence: 'low',
        tag: 'minority',
        schoolNote: '少數流派主張,本 App 預設不採用。',
        refs: ['bazhai.md#3.10', 'DOMAIN_SPEC.md#2.3.6'],
      }),
      finding({
        id: 'bz.minority.taohua',
        level: 'info',
        title: '少數說法: 桃花位',
        body:
          '有流派把六煞位視為桃花位(說法不穩定),也有說法認為延年位才是桃花位(說法較穩定)。兩種少數說法並列供參考,' +
          '本 App 預設把六煞位當成需要留意的位置,不據此給感情建議。',
        confidence: 'low',
        tag: 'minority',
        schoolNote: '少數流派主張,本 App 預設不採用。',
        refs: ['bazhai.md#3.9', 'DOMAIN_SPEC.md#2.3.6'],
      }),
    );
  }
  if (s.showGuimenxian) {
    findings.push(
      finding({
        id: 'bz.minority.guimenxian',
        level: 'info',
        title: '少數說法: 鬼門線',
        body:
          '只有單一來源提出的說法: 沿東北到西南方向、約 15 度寬的帶狀區域,不宜穿過大門、床頭、馬桶與灶台。' +
          '本 App 預設不採用,僅供對照。',
        confidence: 'low',
        tag: 'minority',
        schoolNote: '少數流派主張,本 App 預設不採用。',
        refs: ['bazhai.md#3.12', 'DOMAIN_SPEC.md#2.3.6'],
      }),
    );
  }

  return {
    meta: {
      schema: 'fengshui.bazhai/1',
      ruleset: Object.fromEntries(
        RULESET_KEYS.map((k) => [k, isObj(s[k]) ? { ...s[k] } : s[k]]),
      ),
      warnings: [...warnings],
    },
    people: people.map((p) => ({
      id: p.id,
      ming: p.ming,
      stars: starsOf(p.ming.gua),
      wealthOrder: wealthOrder(p.ming.gua, s),
      usage: usageGuide(p.ming.gua, s),
      threeKeys: placements === null ? null : threeKeys(p.ming.gua, placements),
    })),
    house,
    match: {
      byPerson,
      policy: 'mingOverHouse',
      advice,
      basis: s.coupleBasis,
      mixed,
      consideredIds,
      anchorId: anchor.id,
      sleepCareId,
      combined,
    },
    findings,
  };
}

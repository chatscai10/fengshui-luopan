// 住宅畫面:朝向、建築、住戶、地區與磁北,以及完成度清單。
// 純邏輯(驗證、格式化、完成度、運的說明)獨立成可在 node 測試的函式;DOM 只在 mount() 與各建構函式內存取。
// 命卦、東西四命、運與入運資訊一律來自 store.report(),這裡不自己算風水。
import { h, clear, rafThrottle } from '../dom.js';
import { newId } from '../store.js';
import { repairDraft, resolveCityId } from '../repair.js';
import { basisOf, displayedFromRaw, rawFromDisplayed, roundTenth } from '../basis.js';
export { DEFAULT_CITY } from '../repair.js';
import * as geo from '../../core/geo.js';
import * as calendar from '../../core/calendar.js';
import { renderReport, CARD_DISCLAIMER } from '../../core/copy.js';
import { icons } from '../components/icons.js';

// ─────────────────────────── 常數 ───────────────────────────

export const YEAR_MIN = 1900;
export const NAME_MAX = 12;
const TZ_MS = 8 * 3600000; // 台灣時間,只用來判斷「今天」與「今年」
const YUN_ZH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export const BUILDING_TYPES = Object.freeze([
  { value: 'apartment', label: '公寓大樓' },
  { value: 'house', label: '透天' },
  { value: 'shop', label: '店面' },
  { value: 'office', label: '辦公室' },
]);
export const RENOVATIONS = Object.freeze([
  { value: 'none', label: '沒有' },
  { value: 'partial', label: '局部' },
  { value: 'full', label: '大整修' },
]);
export const GENDERS = Object.freeze([
  { value: 'M', label: '男' },
  { value: 'F', label: '女' },
]);
export const NORTH_OPTIONS = Object.freeze([
  { value: 'magnetic', label: '磁北' },
  { value: 'true', label: '真北' },
]);

/** 「向」的取法建議(DOMAIN_SPEC 2.1.6 表的白話版) */
export const FACING_ADVICE = Object.freeze({
  apartment: '公寓大樓:通常以「主採光面」當作向,也就是最大落地窗或陽台朝向開闊處的那一面。備用選擇是整棟大樓的正面,或大門朝向。',
  house: '透天:大門和主採光面(最大落地窗或陽台的那一面)差不到 45 度,就用大門朝向;差比較多時,改用主採光面。',
  shop: '店面:以臨街的主要出入口朝向當作向。',
  office: '辦公室:在大樓裡的辦公室,做法和公寓大樓一樣;獨立門面的辦公室,比照店面用臨街出入口。',
});
const FACING_ADVICE_COMMON = '「向」是站在屋內、面朝外看出去的方向。三個方向(大門、採光面、大樓正面)差超過 45 度時,結果會提醒你確認。這是常見取法,各派看法不同。';

// ─────────────────────────── 時間小工具 ───────────────────────────

export function nowYearTW(nowMs) {
  return new Date(nowMs + TZ_MS).getUTCFullYear();
}
export function todayIsoTW(nowMs) {
  return new Date(nowMs + TZ_MS).toISOString().slice(0, 10);
}

// ─────────────────────────── 輸入驗證(純函式) ───────────────────────────

/** 全形轉半形、去掉空白與度數符號;非字串一律當空字串 */
function cleanNumberText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/。/g, '.')
    .replace(/\s/g, '')
    .replace(/[°˚º度]$/, '');
}

/**
 * 解析朝向度數。回傳 { ok:true, value } 或 { ok:false, message }。
 * allowEmpty 為真時空字串合法(value=null)。範圍 0 到 359.9,取到 0.1 度。
 */
export function parseBearing(text, { allowEmpty = false } = {}) {
  const t = cleanNumberText(text);
  if (t === '') {
    return allowEmpty ? { ok: true, value: null } : { ok: false, message: '請輸入 0 到 359.9 之間的度數,例如 175。' };
  }
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) {
    return { ok: false, message: '這裡只能填數字(可以有小數點),例如 175 或 175.5。' };
  }
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || v >= 360) {
    return { ok: false, message: '度數要在 0 到 359.9 之間。正北是 0,正東是 90,正南是 180,正西是 270。' };
  }
  const r = Math.round(v * 10) / 10;
  return { ok: true, value: r >= 360 ? 0 : r };
}

/** 年份的合法範圍:1900 年到今年 */
export function yearBounds(nowMs) {
  return { min: YEAR_MIN, max: nowYearTW(nowMs) };
}

/**
 * 解析西元年份。label 用在提示文字(例如「建成年份」)。
 * 1 到 3 位數多半是民國年,不猜,直接請使用者改填西元。
 */
export function parseYear(text, { min = YEAR_MIN, max, label = '年份', allowEmpty = true } = {}) {
  const t = cleanNumberText(text);
  if (t === '') {
    return allowEmpty ? { ok: true, value: null } : { ok: false, message: `請填${label}(西元 4 位數,例如 2004)。` };
  }
  if (/^\d{1,3}$/.test(t)) {
    return { ok: false, message: `請填西元年份(4 位數,例如 2004);如果是民國年,請加上 1911。` };
  }
  if (!/^\d{4}$/.test(t)) {
    return { ok: false, message: `${label}只能填 4 位數字,例如 2004。` };
  }
  const v = Number(t);
  if (v < min || v > max) {
    return { ok: false, message: `${label}要在 ${min} 到 ${max} 年之間。` };
  }
  return { ok: true, value: v };
}

/** 樓層:空白合法;整數 1 到 200,地下室用負數(-1 到 -9) */
export function parseFloor(text) {
  const t = cleanNumberText(text).replace(/^[−–]/, '-');
  if (t === '') return { ok: true, value: null };
  if (!/^-?\d{1,3}$/.test(t)) return { ok: false, message: '樓層請填整數,例如 12;地下室填負數,例如 -1。' };
  const v = Number(t);
  if (v === 0 || v < -9 || v > 200) return { ok: false, message: '樓層要在 1 到 200 之間;地下室填 -1 到 -9。' };
  return { ok: true, value: v };
}

/** 名字:去掉控制字元、收斂空白;回傳整理後的字串 */
export function cleanName(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\t\n\r]+/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

/** 驗證出生日期字串(input[type=date] 的 'YYYY-MM-DD') */
export function validateBirthDate(text, nowMs) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t === '') return { ok: false, message: '請選擇出生日期。' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return { ok: false, message: '出生日期的格式不對,請用「1990-02-04」這樣的寫法,或用日期選擇器。' };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(2000, mo - 1, d)); // 年份先用閏年 2000 檢查月日,再另外檢查該年是否閏年
  dt.setUTCFullYear(y);
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  if (!real) return { ok: false, message: '這一天不存在,請確認月份和日期。' };
  const { max } = yearBounds(nowMs);
  if (y < YEAR_MIN || y > max) return { ok: false, message: `出生年份要在 ${YEAR_MIN} 到 ${max} 年之間。` };
  if (t > todayIsoTW(nowMs)) return { ok: false, message: '出生日期不能是未來的日子。' };
  return { ok: true, value: t };
}

/** 驗證出生時間(選填,'HH:mm');空字串代表不知道 */
export function validateBirthTime(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t === '') return { ok: true, value: null };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return { ok: false, message: '出生時間請用 24 小時制,例如 08:30;不知道就留空。' };
  return { ok: true, value: t };
}

/**
 * 驗證整份住戶表單。回傳 { ok, errors:{name,gender,date,time}, value:{name,gender,birth} }。
 * 任何一項不合法就不給 value,呼叫端不可寫入 store。
 */
export function validateResident(form, nowMs) {
  const errors = {};
  const f = form && typeof form === 'object' ? form : {};
  const name = cleanName(f.name);
  if (name === '') errors.name = '請幫這位住戶取個名字或暱稱,例如「媽媽」。';
  else if ([...name].length > NAME_MAX) errors.name = `名字請控制在 ${NAME_MAX} 個字以內。`;
  if (f.gender !== 'M' && f.gender !== 'F') errors.gender = '請選擇性別(命卦的算法男女不同)。';
  const date = validateBirthDate(f.date, nowMs);
  if (!date.ok) errors.date = date.message;
  const time = validateBirthTime(f.time);
  if (!time.ok) errors.time = time.message;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: { name, gender: f.gender, birth: time.value ? `${date.value} ${time.value}` : date.value },
  };
}

/** 把存好的出生字串拆成日期與時間 */
export function splitBirth(text) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(typeof text === 'string' ? text.trim() : '');
  return m ? { date: m[1], time: m[2] || '' } : { date: '', time: '' };
}

/** 顯示用的出生日期,例如「1990 年 2 月 4 日(不知道時間)」 */
export function formatBirth(text) {
  const { date, time } = splitBirth(text);
  if (!date) return '出生日期未填';
  const [y, m, d] = date.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日${time ? ` ${time}` : '(不知道時間)'}`;
}

/** 已存住戶缺什麼(對應引擎的「資料不完整」判斷),回傳缺項名稱陣列 */
export function residentProblems(r, nowMs = Date.now()) {
  const out = [];
  if (!r || (r.gender !== 'M' && r.gender !== 'F')) out.push('性別');
  const b = r && typeof r.birth === 'string' ? splitBirth(r.birth) : { date: '' };
  if (!b.date || !validateBirthDate(b.date, nowMs).ok) out.push('出生日期');
  return out;
}

// ─────────────────────────── 壞資料修復 ───────────────────────────
// 實作在 ../repair.js(store 載入時就會跑);這裡保留原本的匯出名稱。
export { repairDraft, resolveCityId };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function cityNames() {
  return Object.keys(geo.CITY_DECLINATIONS);
}

// ─────────────────────────── 引擎結果的整理(不做風水運算) ───────────────────────────

/** 引擎 report 是否可用(有分析結果,不是 NO_FACING 或錯誤) */
export function reportOk(report) {
  return Boolean(report) && !report.error && isObj(report.geo);
}

/** renderReport 的全部卡片(失敗回空陣列,不丟例外) */
export function cardsOf(report) {
  if (!reportOk(report)) return [];
  try {
    return renderReport(report).sections.flatMap((s) => s.cards);
  } catch {
    return [];
  }
}

/** 依卡片 id 前綴挑卡片 */
export function pickCards(cards, prefixes, { levels = ['note', 'caution'] } = {}) {
  return cards.filter((c) => prefixes.some((p) => c.id.startsWith(p)) && levels.includes(c.level));
}

/**
 * 每位住戶要顯示的資料。
 * ming:有結果時 { text, groupText, group, matchesHouse, ambiguous };沒有朝向時 null 並帶 reason。
 */
export function residentSummaries(state, report, cards = []) {
  const list = Array.isArray(state.residents) ? state.residents.filter(isObj) : [];
  const ok = reportOk(report);
  const byId = new Map(ok ? report.bazhai.residents.map((r) => [r.id, r]) : []);
  const skipped = new Map(ok ? (report.bazhai.skipped || []).map((s) => [s.id, s]) : []);
  return list.map((r) => {
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '未命名';
    const localProblems = residentProblems(r);
    const problems = skipped.has(r.id) ? skipped.get(r.id).missing.slice() : localProblems;
    const eng = byId.get(r.id);
    let ming = null;
    let reason = null;
    if (problems.length) reason = 'incomplete';
    else if (!ok) reason = report && report.error === 'NO_FACING' ? 'noFacing' : 'error';
    else if (eng) ming = summarizeMing(eng);
    else reason = 'error';
    const notes = cards
      .filter((c) => c.subject === r.id && c.source === 'finding' && !c.id.startsWith('house.resident.incomplete'))
      .map((c) => ({
        title: c.headline.replace(/^[^:]{1,30}: /, ''),
        body: c.body,
        level: c.level,
      }));
    return {
      id: r.id,
      name,
      genderLabel: r.gender === 'M' ? '男' : r.gender === 'F' ? '女' : '性別未填',
      birthText: formatBirth(r.birth),
      isMain: state.mainResidentId === r.id,
      problems,
      ming,
      reason,
      notes,
    };
  });
}

const GROUP_TEXT = { east: '東四命', west: '西四命' };

function summarizeMing(eng) {
  const m = eng.ming || {};
  const alts = m.flags && Array.isArray(m.flags.alternatives) ? m.flags.alternatives : [];
  const ambiguous = alts.length === 2 && alts[0].gua !== alts[1].gua;
  const text = ambiguous ? `${alts[0].gua}命或${alts[1].gua}命` : `${m.gua}命`;
  let groupText = GROUP_TEXT[m.group] || '';
  if (ambiguous && alts[0].group !== alts[1].group) groupText = '東四命或西四命';
  else if (ambiguous) groupText = GROUP_TEXT[alts[0].group] || groupText;
  return { text, groupText, group: m.group, matchesHouse: eng.matchesHouse === true && !ambiguous, ambiguous };
}

/** 完成度清單。tab 是缺項對應的分頁('house' 表示就在這一頁補) */
export function completeness(state, report) {
  const b = state.building || {};
  const residents = Array.isArray(state.residents) ? state.residents.filter(isObj) : [];
  const complete = residents.filter((r) => residentProblems(r).length === 0).length;
  const planBad = reportOk(report) && report.findings.some((f) => f.id === 'house.plan.invalid');
  const hasPlan = Boolean(state.plan);
  return [
    {
      id: 'facing',
      label: '房子的朝向',
      done: state.facing != null && Number.isFinite(state.facing.bearing),
      detail: '量了朝向才能算方位',
      tab: 'compass',
      optional: false,
    },
    {
      id: 'year',
      label: '建成年份',
      done: Number.isInteger(b.builtYear),
      detail: '填了才能看玄空飛星',
      tab: 'house',
      optional: false,
    },
    {
      id: 'residents',
      label: '住戶(選填)',
      done: complete > 0,
      detail: complete > 0 ? `已填 ${complete} 位` : '填了,財位建議會更貼近你',
      tab: 'house',
      optional: true,
    },
    {
      id: 'plan',
      label: '平面圖',
      done: hasPlan && !planBad,
      detail: planBad ? '平面圖有問題,需要修正' : '畫了平面圖才看得到財位在屋裡的哪裡',
      tab: 'plan',
      optional: false,
    },
  ];
}

/** 「下一步」按鈕:缺什麼導向哪個分頁;都齊了就去看財位 */
export function nextStep(items) {
  const miss = items.find((i) => !i.done && !i.optional);
  if (!miss) return { id: 'wealth', label: '看我家的財位', tab: 'wealth' };
  const labels = {
    facing: '先去量房子的朝向',
    year: '接著填建成年份',
    plan: '接著畫平面圖',
  };
  return { id: miss.id, label: labels[miss.id] || `補上${miss.label}`, tab: miss.tab };
}

function yunAt(year, yunSystem) {
  try {
    return calendar.nineYun(year, { yunSystem }).yun;
  } catch {
    return null;
  }
}

/** 某年所在那一運涵蓋的年份範圍(以立春換年的「風水年」計) */
export function yunSpan(year, yunSystem = 'san_yuan_9') {
  const yun = yunAt(year, yunSystem);
  if (yun == null) return null;
  let a = year;
  let b = year;
  for (let i = 0; i < 30 && yunAt(a - 1, yunSystem) === yun; i += 1) a -= 1;
  for (let i = 0; i < 30 && yunAt(b + 1, yunSystem) === yun; i += 1) b += 1;
  return [a, b];
}

const BASIS_LABEL = { built: '建成', moveIn: '遷入', renovation: '整修完工' };

/**
 * 玄空盤用哪一年的運排。有引擎結果時以引擎為準;沒有朝向(引擎沒算)時,只用建成年份查日曆給預覽。
 * 回傳 null 表示沒有建成年份可用。
 */
export function describeYun(report, building, nowMs) {
  const meta = reportOk(report) && report.xuankong && report.xuankong.meta ? report.xuankong.meta : null;
  const sys = reportOk(report) && report.meta && report.meta.ruleset ? report.meta.ruleset.yunSystem : 'san_yuan_9';
  let basisYear = null;
  let yun = null;
  let basis = 'built';
  let current = null;
  if (meta && meta.yun) {
    yun = meta.yun.chartYun;
    basis = meta.yun.basis;
    current = meta.yun.currentYun;
    if (Number.isFinite(meta.yun.basisInstant)) basisYear = Number(calendar.formatCST(meta.yun.basisInstant).slice(0, 4));
  } else if (building && Number.isInteger(building.builtYear)) {
    basisYear = building.builtYear;
    yun = yunAt(basisYear, sys);
    try { current = calendar.yunOfInstant(nowMs, { yunSystem: sys }).yun; } catch { current = null; }
  }
  if (basisYear == null || yun == null) return null;
  const nowYear = nowYearTW(nowMs);
  return {
    basisYear,
    basisLabel: BASIS_LABEL[basis] || '建成',
    yun,
    span: yunSpan(basisYear, sys),
    currentYun: current,
    currentSpan: current == null ? null : yunSpan(nowYear, sys),
    nowYear,
  };
}

/** 把 describeYun 的結果寫成一到兩句白話 */
export function yunLines(info) {
  if (!info) return [];
  const span = info.span ? `(${info.span[0]}–${info.span[1]} 年)` : '';
  const lines = [`以 ${info.basisYear} 年(${info.basisLabel})的運來排盤:${YUN_ZH[info.yun]}運盤${span}`];
  if (info.currentYun != null && info.currentYun !== info.yun) {
    lines.push(`現在(${info.nowYear} 年)已經是${YUN_ZH[info.currentYun]}運,判斷星的旺衰會以現在的運為準。`);
  }
  return lines;
}

/** 城市的磁偏角說明,例如「台北目前的磁偏角約 5.1 度:磁北比真北偏西」 */
export function declinationView(cityId, nowMs) {
  const city = resolveCityId(cityId);
  try {
    const info = geo.declinationInfo(city, nowMs);
    const deg = info.declinationDeg;
    const abs = Math.abs(deg).toFixed(1);
    const side = deg < 0 ? '偏西' : '偏東';
    return {
      city,
      deg,
      inModelRange: info.inModelRange,
      text: `${city}目前的磁偏角約 ${abs} 度:磁北比真北${side}。`,
    };
  } catch {
    return { city, deg: null, inModelRange: false, text: `暫時查不到${city}的磁偏角。` };
  }
}

/** 切換北基準。選真北時順便確保城市代碼有效。預設值(磁北)不寫進設定,避免蓋過引擎的降級規則。 */
export function setNorthMode(store, mode) {
  if (mode !== 'magnetic' && mode !== 'true') return false;
  store.update((d) => {
    if (mode === 'magnetic') delete d.settings.northMode;
    else d.settings.northMode = 'true';
    d.facing.cityId = resolveCityId(d.facing.cityId);
  });
  return true;
}

export function setCity(store, cityId) {
  if (typeof cityId !== 'string' || !Object.prototype.hasOwnProperty.call(geo.CITY_DECLINATIONS, cityId)) return false;
  store.update((d) => { d.facing.cityId = cityId; });
  return true;
}

// ─────────────────────────── 共用小元件(DOM,只在呼叫時存取 document) ───────────────────────────

let uid = 0;
export const nextDomId = (prefix) => `${prefix}-${(uid += 1)}`;

/** 分段選擇。值可以是布林或數字,用嚴格比較;set() 只改 aria-pressed,不重建,鍵盤焦點不會掉 */
export function segControl({ options, value, label, onChange }) {
  const btns = options.map((o) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => onChange(o.value) }, o.label));
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label }, btns);
  const set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', options[i].value === v ? 'true' : 'false'));
  set(value);
  return { el, set };
}

/** 開關列:左邊說明、右邊開關 */
export function switchRow({ label, help, checked, onChange }) {
  const id = nextDomId('sw');
  const input = h('input', { type: 'checkbox', id, role: 'switch', onchange: () => onChange(input.checked) });
  input.checked = Boolean(checked);
  const el = h('div', { class: 'switch v-house-switch' },
    h('label', { for: id, class: 'v-house-switch-text' }, h('span', null, label), help ? h('span', { class: 'hint' }, help) : null),
    input);
  return { el, input, set: (v) => { input.checked = Boolean(v); } };
}

/** 使用者正在輸入的欄位不要被同步蓋掉 */
function syncValue(input, value) {
  if (input.getAttribute('aria-invalid') === 'true') return;
  if (document.activeElement === input) return;
  const s = value == null ? '' : String(value);
  if (input.value !== s) input.value = s;
}

/** 把畫面上舊的焦點還給重建後的同一個按鈕 */
function keepFocus(container, rebuild) {
  const a = document.activeElement;
  const key = a && container.contains(a) ? a.getAttribute('data-key') : null;
  rebuild();
  if (key) {
    const el = [...container.querySelectorAll('[data-key]')].find((n) => n.getAttribute('data-key') === key);
    if (el) el.focus();
  }
}

/**
 * 文字輸入(數字類)。輸入時合法就即時存(onCommit),不合法就不存並給白話提示。
 * typing(text) 為真代表「還在打字、可能還沒打完」,這時不急著報錯,離開欄位時才報。
 */
function numberField({ label, hint, unit, inputmode = 'numeric', placeholder, maxlength = 8, parse, typing, onCommit }) {
  const id = nextDomId('nf');
  const msgId = `${id}-msg`;
  const msg = h('div', { class: 'hint v-house-msg', id: msgId, 'aria-live': 'polite' });
  const input = h('input', {
    type: 'text', id, inputmode, autocomplete: 'off', spellcheck: 'false', maxlength, placeholder,
    'aria-describedby': msgId,
  });
  const setMsg = (text, bad) => {
    msg.textContent = text || '';
    msg.classList.toggle('bad', Boolean(bad));
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const neutral = () => setMsg(hint || '', false);
  const run = (final) => {
    const res = parse(input.value);
    if (res.ok) {
      neutral();
      onCommit(res.value);
    } else if (final || !(typing && typing(input.value))) {
      setMsg(`${res.message}(這次的輸入還沒有存,目前保留原本的值。)`, true);
    } else {
      neutral();
    }
  };
  input.addEventListener('input', () => run(false));
  input.addEventListener('change', () => run(true));
  neutral();
  const control = unit ? h('div', { class: 'v-house-inputwrap' }, input, h('span', { class: 'unit', 'aria-hidden': 'true' }, unit)) : input;
  const el = h('div', { class: 'field' }, h('label', { for: id }, label), control, msg);
  return { el, input, setMsg, neutral };
}

/** 度數還在打字中(1 到 2 位數,或剛打完小數點)時不急著報錯 */
const bearingTyping = (t) => {
  const c = cleanNumberText(t);
  return /^\d{0,2}$/.test(c) || /^\d{1,3}\.$/.test(c);
};

/** 用引擎卡片做提醒方塊(caution 用醒目但不驚嚇的樣式) */
function calloutOf(card, { title } = {}) {
  return h('div', { class: `callout${card.level === 'caution' ? ' warn' : ''}`, role: 'note' },
    h('strong', null, title || card.headline),
    h('div', null, card.body));
}

// ─────────────────────────── 北基準控制(住宅頁與設定面板共用) ───────────────────────────

export function createNorthControls({ store }) {
  let cityOpen = false;
  const seg = segControl({
    options: NORTH_OPTIONS.map((o) => ({ ...o, label: o.value === 'magnetic' ? '磁北(預設)' : '真北' })),
    value: 'magnetic',
    label: '羅盤讀數的北',
    onChange: (v) => setNorthMode(store, v),
  });
  const citySel = h('select', {
    id: nextDomId('city'),
    'aria-label': '所在城市',
    onchange: () => setCity(store, citySel.value),
  }, cityNames().map((n) => h('option', { value: n }, n)));
  const decl = h('div', { class: 'hint', 'aria-live': 'polite' });
  const modelNote = h('div', { class: 'hint hidden' }, '這份磁偏角資料的有效期已過,數字僅供參考。');
  const moreBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { cityOpen = true; sync(store.get()); citySel.focus(); } }, '換城市');
  const cityRow = h('div', { class: 'field hidden' }, h('label', { for: citySel.id }, '你家在哪個城市?'), citySel);
  const explain = h('p', { class: 'sub' },
    '實體羅盤指的是磁北;地圖上的北是真北。台灣兩者差約 5 度,量到的方向可能因此換成隔壁的山。預設用磁北,和實體羅盤一致。');
  const el = h('div', { class: 'v-house-north stack' }, explain, seg.el, cityRow, decl, modelNote, moreBtn);

  function sync(state) {
    const mode = state.settings && state.settings.northMode === 'true' ? 'true' : 'magnetic';
    seg.set(mode);
    const city = resolveCityId(state.facing && state.facing.cityId);
    if (citySel.value !== city) citySel.value = city;
    const show = mode === 'true' || cityOpen;
    cityRow.classList.toggle('hidden', !show);
    moreBtn.classList.toggle('hidden', show);
    const dv = declinationView(city, Date.now());
    decl.textContent = mode === 'true'
      ? `${dv.text}選真北後,App 會把羅盤讀數換算成真北再分析。`
      : `${dv.text}(目前用磁北,只拿來提醒你「換成真北會不會變成別座山」。)`;
    modelNote.classList.toggle('hidden', dv.inModelRange !== false || dv.deg == null);
  }
  sync(store.get());
  return { el, sync };
}

// ─────────────────────────── 畫面 ───────────────────────────

export async function mount(root, ctx) {
  const { store, toast, openSheet } = ctx;
  let destroyed = false;
  const openSheets = new Set();
  let doorOpen = store.get().facing.doorBearing != null;

  // 進畫面先修復壞資料(舊備份、手改),避免引擎丟例外導致整頁空白
  {
    const draft = JSON.parse(JSON.stringify(store.get()));
    if (repairDraft(draft)) {
      store.update((d) => {
        d.facing = draft.facing;
        d.building = draft.building;
        d.residents = draft.residents;
        d.mainResidentId = draft.mainResidentId;
      });
    }
  }

  const bounds = () => yearBounds(Date.now());
  const safeReport = () => {
    try { return store.report(); } catch { return { error: 'unknown' }; }
  };

  // ── 朝向卡 ──
  const facingLead = h('div', { class: 'card-lead kai v-house-lead', 'aria-live': 'polite' });
  const facingBadges = h('div', { class: 'row tight' });
  const facingField = numberField({
    label: '房子的向(羅盤讀數的度數)',
    hint: '0 到 359.9 度。正北是 0,正東是 90,正南是 180,正西是 270。',
    unit: '°',
    inputmode: 'decimal',
    placeholder: '例如 175',
    maxlength: 9,
    parse: (t) => parseBearing(t),
    typing: bearingTyping,
    onCommit: (v) => {
      // 選真北時,輸入的是換算後的真北度數;資料裡存的仍是磁方位讀數
      const raw = roundTenth(rawFromDisplayed(v, basisOf(store.get())));
      if (store.get().facing.bearing === raw) return;
      store.update((d) => {
        d.facing.bearing = raw;
        d.facing.source = 'manual';
        d.facing.sigma = null;
        d.facing.lockedAtMs = null;
      });
    },
  });
  const basisNote = h('p', { class: 'hint hidden' }, '目前用真北:這裡的度數已換算成真北,和羅盤畫面上看到的一樣。想填實體羅盤讀到的度數,請先在下方把「羅盤讀數的北」改回磁北。');
  const facingCallouts = h('div', { class: 'stack' });
  const goCompass = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => ctx.go('compass') }, '到羅盤重新量');
  const doorSwitch = switchRow({
    label: '大門朝向和房子朝向不一樣?',
    help: '八宅預設看大門朝向,玄空看房子朝向(可在設定改)。一樣的話不用填。',
    checked: doorOpen,
    onChange: (on) => {
      doorOpen = on;
      if (!on) {
        doorField.input.removeAttribute('aria-invalid');
        doorField.neutral();
        store.update((d) => { d.facing.doorBearing = null; });
      }
      refresh();
    },
  });
  const doorField = numberField({
    label: '大門朝向(從屋內看出去的度數)',
    hint: '站在屋內、面對大門,羅盤讀到的度數。留空就當作和房子朝向相同。',
    unit: '°',
    inputmode: 'decimal',
    placeholder: '例如 250',
    maxlength: 9,
    parse: (t) => parseBearing(t, { allowEmpty: true }),
    typing: bearingTyping,
    onCommit: (v) => {
      const raw = v == null ? null : roundTenth(rawFromDisplayed(v, basisOf(store.get())));
      if (store.get().facing.doorBearing === raw) return;
      store.update((d) => { d.facing.doorBearing = raw; });
    },
  });
  const adviceBody = h('div', { class: 'stack' });
  const advice = h('details', { class: 'v-house-details disclosure' },
    h('summary', null, '「向」該怎麼選?'), adviceBody);

  const cardFacing = h('section', { class: 'card', 'aria-labelledby': 'v-house-t-facing' },
    h('h2', { class: 'card-title', id: 'v-house-t-facing' }, '房子的朝向'),
    facingLead, facingBadges, facingField.el, basisNote,
    h('div', { class: 'row' }, goCompass),
    facingCallouts,
    doorSwitch.el, doorField.el,
    advice);

  // ── 建築卡 ──
  const typeSeg = segControl({
    options: BUILDING_TYPES, value: 'apartment', label: '建築類型',
    onChange: (v) => store.update((d) => { d.building.type = v; }),
  });
  const floorField = numberField({
    label: '樓層(選填)',
    hint: '地下室填負數,例如 -1。',
    inputmode: 'numeric', maxlength: 4, placeholder: '例如 12',
    parse: parseFloor,
    typing: (t) => /^-?\d{0,3}$/.test(cleanNumberText(t)),
    onCommit: (v) => {
      if ((store.get().building.floor ?? null) === v) return;
      store.update((d) => { d.building.floor = v; });
    },
  });
  const yearHintDefault = '填了建成年份才能排玄空飛星;不填,只會給八宅與進門對角的財位。';
  const builtField = numberField({
    label: '建成年份(西元)',
    hint: yearHintDefault,
    inputmode: 'numeric', maxlength: 4, placeholder: '例如 2004',
    parse: (t) => parseYear(t, { ...bounds(), label: '建成年份' }),
    typing: (t) => /^\d{0,3}$/.test(cleanNumberText(t)),
    onCommit: (v) => {
      if ((store.get().building.builtYear ?? null) === v) return;
      store.update((d) => { d.building.builtYear = v; });
    },
  });
  const yunBox = h('div', { class: 'v-house-yun', 'aria-live': 'polite' });
  const renoSeg = segControl({
    options: RENOVATIONS, value: 'none', label: '有整修過嗎',
    onChange: (v) => store.update((d) => { d.building.renovation = v; }),
  });
  const renoYearField = numberField({
    label: '整修完工年份(西元)',
    hint: '填了,玄空盤會改用那一年的運來排(整修是否換運,各派看法不同)。',
    inputmode: 'numeric', maxlength: 4, placeholder: '例如 2015',
    parse: (t) => parseYear(t, { ...bounds(), label: '整修完工年份' }),
    typing: (t) => /^\d{0,3}$/.test(cleanNumberText(t)),
    onCommit: (v) => {
      if ((store.get().building.renovatedYear ?? null) === v) return;
      store.update((d) => { d.building.renovatedYear = v; });
    },
  });
  const moveYearField = numberField({
    label: '遷入年份(西元)',
    hint: '你在設定裡選了「用遷入年的運排玄空盤」,所以要填搬進來的年份。',
    inputmode: 'numeric', maxlength: 4, placeholder: '例如 2010',
    parse: (t) => parseYear(t, { ...bounds(), label: '遷入年份' }),
    typing: (t) => /^\d{0,3}$/.test(cleanNumberText(t)),
    onCommit: (v) => {
      if ((store.get().building.moveInYear ?? null) === v) return;
      store.update((d) => { d.building.moveInYear = v; });
    },
  });
  const buildingCallouts = h('div', { class: 'stack' });
  const cardBuilding = h('section', { class: 'card v-house-building', 'aria-labelledby': 'v-house-t-building' },
    h('h2', { class: 'card-title', id: 'v-house-t-building' }, '建築'),
    h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, '建築類型'), typeSeg.el),
      builtField.el,
      yunBox,
      floorField.el,
      h('div', { class: 'field' }, h('span', { class: 'label' }, '有整修過嗎?'), renoSeg.el),
      renoYearField.el,
      moveYearField.el,
      buildingCallouts));

  // ── 住戶卡 ──
  const resList = h('ul', { class: 'list v-house-reslist' });
  const resEmpty = h('p', { class: 'sub' }, '住戶是選填的。填了住戶,財位建議會更貼近你。');
  const addBtn = h('button', { type: 'button', class: 'btn', onclick: () => openResidentSheet(null) },
    h('span', { html: icons.plus }), '新增住戶');
  const cardRes = h('section', { class: 'card v-house-residents', 'aria-labelledby': 'v-house-t-res' },
    h('h2', { class: 'card-title', id: 'v-house-t-res' }, '住戶'),
    h('p', { class: 'sub v-house-lead-p' },
      '命卦是依出生年和性別算出來的個人方位分組(東四命、西四命),用來找適合你的方位。出生日期只存在這支手機裡。'),
    resEmpty, resList,
    h('div', { class: 'row' }, addBtn));

  // ── 地區與磁北卡 ──
  const north = createNorthControls({ store });
  const northCallouts = h('div', { class: 'stack' });
  const cardNorth = h('section', { class: 'card', 'aria-labelledby': 'v-house-t-north' },
    h('h2', { class: 'card-title', id: 'v-house-t-north' }, '地區與磁北'),
    h('div', { class: 'stack' }, north.el, northCallouts));

  // ── 頁尾:完成度 ──
  const checkList = h('ul', { class: 'list v-house-check' });
  const nextBox = h('div', { class: 'row' });
  const cardFooter = h('section', { class: 'card', 'aria-labelledby': 'v-house-t-done' },
    h('h2', { class: 'card-title', id: 'v-house-t-done' }, '完成度'),
    checkList,
    nextBox);
  const errBox = h('div', { class: 'callout warn hidden', role: 'alert' },
    '目前這組資料暫時算不出結果。請檢查朝向、建成年份與住戶的出生日期是不是填得合理。');

  const wrap = h('div', { class: 'stack v-house' },
    errBox, cardFacing, cardBuilding, cardRes, cardNorth, cardFooter,
    h('p', { class: 'faint v-house-foot' }, CARD_DISCLAIMER));
  root.append(wrap);

  // ── 同步:store 變動後只更新「推導出來」的區塊,輸入框不重建 ──
  let cache = { report: null, cards: [] };
  function cardsFor(report) {
    if (cache.report !== report) cache = { report, cards: cardsOf(report) };
    return cache.cards;
  }

  function refresh() {
    if (destroyed) return;
    const state = store.get();
    // 地基的預設城市代碼不在磁偏角表內(例如清除資料後),補成有效城市;寫入後會再觸發一次同步
    if (resolveCityId(state.facing.cityId) !== state.facing.cityId) {
      store.update((d) => { d.facing.cityId = resolveCityId(d.facing.cityId); });
      return;
    }
    const report = safeReport();
    const ok = reportOk(report);
    const cards = cardsFor(report);
    const f = state.facing;

    errBox.classList.toggle('hidden', !(report && report.error && report.error !== 'NO_FACING'));

    // 朝向
    const basis = basisOf(state);
    const shown = (raw) => (raw == null ? null : roundTenth(displayedFromRaw(raw, basis)));
    syncValue(facingField.input, shown(f.bearing));
    facingField.el.querySelector('label').textContent = basis.trueMode ? '房子的向(真北度數)' : '房子的向(羅盤讀數的度數)';
    basisNote.classList.toggle('hidden', !basis.trueMode);
    if (f.bearing == null) {
      facingLead.textContent = '還沒有量朝向';
      facingLead.classList.add('faint');
    } else {
      facingLead.classList.remove('faint');
      facingLead.textContent = ok && report.geo.label ? report.geo.label : `向 ${shown(f.bearing)}°`;
    }
    clear(facingBadges);
    if (ok && report.geo.lean) facingBadges.append(h('span', { class: 'badge badge--info' }, '兼向(方位偏向相鄰的山)'));
    if (f.bearing != null && f.source === 'sensor') facingBadges.append(h('span', { class: 'badge' }, '手機指北針量的'));
    goCompass.textContent = f.bearing == null ? '到羅盤量朝向' : '到羅盤重新量';
    clear(facingCallouts);
    for (const c of pickCards(cards, ['house.geo.', 'house.facing.', 'bz.house.'])) facingCallouts.append(calloutOf(c));
    doorSwitch.set(doorOpen);
    doorField.el.classList.toggle('hidden', !doorOpen);
    syncValue(doorField.input, shown(f.doorBearing));
    clear(adviceBody);
    adviceBody.append(h('p', null, FACING_ADVICE[state.building.type] || FACING_ADVICE.apartment), h('p', { class: 'sub' }, FACING_ADVICE_COMMON));

    // 建築
    const b = state.building;
    typeSeg.set(b.type);
    renoSeg.set(b.renovation === 'anyRenovation' ? 'full' : b.renovation);
    syncValue(builtField.input, b.builtYear);
    syncValue(floorField.input, b.floor);
    const showReno = b.renovation === 'full' || b.renovation === 'anyRenovation';
    renoYearField.el.classList.toggle('hidden', !showReno);
    syncValue(renoYearField.input, b.renovatedYear);
    const showMove = state.settings.yunBasis === 'moveIn' && !showReno;
    moveYearField.el.classList.toggle('hidden', !showMove);
    syncValue(moveYearField.input, b.moveInYear);
    clear(yunBox);
    const lines = yunLines(describeYun(report, b, Date.now()));
    if (lines.length) {
      yunBox.append(h('p', { class: 'v-house-yunline' }, lines[0]));
      for (const l of lines.slice(1)) yunBox.append(h('p', { class: 'sub' }, l));
    }
    clear(buildingCallouts);
    for (const c of pickCards(cards, ['house.building.']).filter((x) => x.id !== 'house.building.year_missing')) buildingCallouts.append(calloutOf(c));

    // 住戶
    keepFocus(resList, () => renderResidents(state, report, cards));

    // 地區與磁北
    north.sync(state);
    clear(northCallouts);
    for (const c of pickCards(cards, ['house.north.'])) northCallouts.append(calloutOf(c));

    // 完成度
    keepFocus(cardFooter, () => renderFooter(state, report));
  }
  const schedule = rafThrottle(refresh);

  function renderResidents(state, report, cards) {
    const rows = residentSummaries(state, report, cards);
    clear(resList);
    resEmpty.classList.toggle('hidden', rows.length > 0);
    const canPickMain = rows.length >= 2;
    for (const r of rows) {
      const badges = [];
      if (r.ming) {
        badges.push(h('span', { class: 'badge badge--wealth' }, r.ming.text));
        if (r.ming.groupText) badges.push(h('span', { class: 'badge badge--info' }, r.ming.groupText));
        if (!r.ming.ambiguous) {
          badges.push(h('span', { class: r.ming.matchesHouse ? 'badge badge--good' : 'badge' },
            r.ming.matchesHouse ? '和房子同一組' : '和房子不同組'));
        }
      } else if (r.reason === 'noFacing') {
        badges.push(h('span', { class: 'badge' }, '量了朝向就會顯示命卦'));
      } else if (r.reason === 'incomplete') {
        badges.push(h('span', { class: 'badge badge--warn' }, `${r.problems.join('、')}還沒填,先不算命卦`));
      } else {
        badges.push(h('span', { class: 'badge' }, '暫時算不出命卦'));
      }
      const notes = r.notes.map((n) => h('div', { class: `callout${n.level === 'caution' ? ' warn' : ''}`, role: 'note' },
        h('strong', null, n.title), h('div', null, n.body)));
      resList.append(h('li', { class: 'v-house-res' },
        h('div', { class: 'v-house-res-main' },
          h('div', { class: 'v-house-res-name' }, h('strong', null, r.name), h('span', { class: 'muted' }, ` ${r.genderLabel} · ${r.birthText}`)),
          h('div', { class: 'row tight' }, badges),
          canPickMain ? h('button', {
            type: 'button', class: 'chip v-house-main', 'aria-pressed': r.isMain ? 'true' : 'false',
            'data-key': `main:${r.id}`,
            title: '主要住戶就是戶長或主要收入者,八宅會優先照顧他的吉方',
            onclick: () => store.update((d) => { d.mainResidentId = d.mainResidentId === r.id ? null : r.id; }),
          }, r.isMain ? '主要住戶(戶長或主要收入者)' : '設為主要住戶') : null,
          notes),
        h('div', { class: 'v-house-res-actions' },
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `編輯${r.name}`, 'data-key': `edit:${r.id}`,
            html: icons.edit, onclick: () => openResidentSheet(r.id),
          }),
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `刪除${r.name}`, 'data-key': `del:${r.id}`,
            html: icons.trash, onclick: () => deleteResident(r.id),
          }))));
    }
  }

  function renderFooter(state, report) {
    const items = completeness(state, report);
    clear(checkList);
    for (const it of items) {
      const mark = it.done
        ? h('span', { class: 'mark ok', html: icons.check })
        : h('span', { class: `mark ${it.optional ? 'faint' : 'bad'}`, html: it.optional ? icons.minus : icons.x });
      checkList.append(h('li', null, mark,
        h('div', null,
          h('div', null, it.label, h('span', { class: 'sr-only' }, it.done ? ',已完成' : it.optional ? ',還沒填,可以不填' : ',還沒完成')),
          h('div', { class: 'sub' }, it.done && it.id !== 'residents' ? '已完成' : it.detail))));
    }
    clear(nextBox);
    const step = nextStep(items);
    nextBox.append(h('button', {
      type: 'button', class: 'btn btn-primary btn-block', 'data-key': 'next',
      onclick: () => {
        if (step.tab === 'house') {
          const el = builtField.input;
          const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
          // 只捲動內容區;scrollIntoView 會連整個頁面一起捲,把標題列推出畫面
          const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 3;
          root.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
          el.focus({ preventScroll: true });
        } else ctx.go(step.tab);
      },
    }, step.label));
  }

  // ── 住戶:新增、編輯、刪除(可復原) ──
  function findResident(id) {
    return store.get().residents.find((r) => r && r.id === id) || null;
  }

  function deleteResident(id) {
    const list = store.get().residents;
    const index = list.findIndex((r) => r && r.id === id);
    if (index < 0) return;
    const rec = { resident: JSON.parse(JSON.stringify(list[index])), index, wasMain: store.get().mainResidentId === id };
    store.update((d) => {
      d.residents = d.residents.filter((r) => r && r.id !== id);
      if (d.mainResidentId === id) d.mainResidentId = null;
    });
    toast(`已刪除「${rec.resident.name || '住戶'}」`, {
      ms: 8000,
      action: {
        label: '復原',
        onClick: () => {
          store.update((d) => {
            if (d.residents.some((r) => r && r.id === rec.resident.id)) return;
            d.residents.splice(Math.min(rec.index, d.residents.length), 0, rec.resident);
            if (rec.wasMain && d.mainResidentId == null) d.mainResidentId = rec.resident.id;
          });
        },
      },
    });
  }

  function openResidentSheet(id) {
    const existing = id ? findResident(id) : null;
    if (id && !existing) return;
    const init = existing ? splitBirth(existing.birth) : { date: '', time: '' };
    let gender = existing && (existing.gender === 'M' || existing.gender === 'F') ? existing.gender : null;
    const nameId = nextDomId('rn');
    const nameInput = h('input', { type: 'text', id: nameId, maxlength: 40, autocomplete: 'off', placeholder: '例如:爸爸、小美' });
    nameInput.value = existing && typeof existing.name === 'string' ? existing.name : '';
    const dateId = nextDomId('rd');
    const dateInput = h('input', { type: 'date', id: dateId, min: `${YEAR_MIN}-01-01`, max: todayIsoTW(Date.now()) });
    dateInput.value = init.date;
    const timeId = nextDomId('rt');
    const timeInput = h('input', { type: 'time', id: timeId });
    timeInput.value = init.time;
    const genderSeg = segControl({ options: GENDERS, value: gender, label: '性別', onChange: (v) => { gender = v; genderSeg.set(v); showErr('gender', ''); } });
    const errEls = {
      name: h('div', { class: 'hint v-house-msg bad', 'aria-live': 'polite' }),
      gender: h('div', { class: 'hint v-house-msg bad', 'aria-live': 'polite' }),
      date: h('div', { class: 'hint v-house-msg bad', 'aria-live': 'polite' }),
      time: h('div', { class: 'hint v-house-msg bad', 'aria-live': 'polite' }),
    };
    const inputsBy = { name: nameInput, gender: genderSeg.el.querySelector('button'), date: dateInput, time: timeInput };
    function showErr(key, text) {
      errEls[key].textContent = text || '';
      const inp = key === 'gender' ? null : inputsBy[key];
      if (inp) { if (text) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    }
    const form = h('form', {
      class: 'stack v-house-form', novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const res = validateResident({ name: nameInput.value, gender, date: dateInput.value, time: timeInput.value }, Date.now());
        for (const k of ['name', 'gender', 'date', 'time']) showErr(k, res.errors[k] || '');
        if (!res.ok) {
          const first = ['name', 'gender', 'date', 'time'].find((k) => res.errors[k]);
          if (inputsBy[first]) inputsBy[first].focus();
          return;
        }
        if (existing) {
          if (!findResident(existing.id)) { toast('這位住戶剛剛已經被刪除了'); sheet.close(); return; }
          store.update((d) => {
            const r = d.residents.find((x) => x && x.id === existing.id);
            if (r) Object.assign(r, res.value);
          });
          toast('已更新住戶資料');
        } else {
          store.update((d) => {
            let nid = newId();
            while (d.residents.some((r) => r && r.id === nid)) nid = newId();
            d.residents.push({ id: nid, ...res.value, utcOffsetMinutes: 480 });
          });
          toast(`已加入「${res.value.name}」`);
        }
        sheet.close();
      },
    },
    h('div', { class: 'field' }, h('label', { for: nameId }, '名字或暱稱'), nameInput, errEls.name),
    h('div', { class: 'field' }, h('span', { class: 'label' }, '性別'), genderSeg.el, errEls.gender),
    h('div', { class: 'field' }, h('label', { for: dateId }, '出生日期(國曆)'), dateInput,
      h('div', { class: 'hint' }, '用國曆(西曆)的生日。出生日剛好在立春前後時,命卦要看時間,下面的時間請盡量填。'), errEls.date),
    h('div', { class: 'field' }, h('label', { for: timeId }, '出生時間(選填)'), timeInput,
      h('div', { class: 'hint' }, '不知道就留空,不影響大部分人。'), errEls.time),
    h('div', { class: 'row v-house-form-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, existing ? '完成' : '加入住戶'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sheet.close() }, '取消'),
      existing ? h('button', { type: 'button', class: 'btn btn-danger', onclick: () => { sheet.close(); deleteResident(existing.id); } }, '刪除這位住戶') : null));
    const sheet = openSheet({
      title: existing ? '編輯住戶' : '新增住戶',
      content: form,
      onClose: () => openSheets.delete(sheet),
    });
    openSheets.add(sheet);
    if (!existing) nameInput.focus();
  }

  refresh();
  const unsub = store.subscribe(schedule);

  return {
    destroy() {
      destroyed = true;
      unsub();
      for (const s of [...openSheets]) s.close();
      openSheets.clear();
    },
  };
}

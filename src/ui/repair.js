// 壞資料修復:localStorage 被改壞、舊版備份、手改的匯入檔,都在進 store 時就修好,
// 讓每個畫面拿到的狀態一定能餵給引擎(不必每個畫面各自防禦)。純邏輯,不碰 DOM。
import * as geo from '../core/geo.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';

export const DEFAULT_CITY = '台北';
const BUILDING_TYPE_IDS = ['apartment', 'house', 'shop', 'office'];
const RENOVATION_IDS = ['none', 'partial', 'full', 'anyRenovation'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function defaultId() {
  return Math.random().toString(36).slice(2, 8);
}

export function resolveCityId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(geo.CITY_DECLINATIONS, id) ? id : DEFAULT_CITY;
}

/** 朝向讀數一律放進 0 到 360 度之內(手改或舊資料可能是 -30、725) */
function bearingOrNull(v) {
  const n = finiteOrNull(v);
  if (n == null) return null;
  return n >= 0 && n < 360 ? n : geo.normalizeBearing(n);
}

/**
 * 就地修復草稿裡會讓引擎丟例外的壞欄位,回傳是否有改動。
 * 已乾淨的草稿不會被改動(回 false)。
 */
export function repairDraft(d, makeId = defaultId) {
  let changed = false;
  const set = (obj, key, val) => {
    if (!Object.is(obj[key], val)) { obj[key] = val; changed = true; }
  };
  const f = isObj(d.facing) ? d.facing : (changed = true, d.facing = {});
  set(f, 'bearing', bearingOrNull(f.bearing));
  set(f, 'doorBearing', bearingOrNull(f.doorBearing));
  set(f, 'sigma', finiteOrNull(f.sigma) != null && f.sigma >= 0 ? f.sigma : null);
  set(f, 'cityId', resolveCityId(f.cityId));

  const b = isObj(d.building) ? d.building : (changed = true, d.building = {});
  if (!BUILDING_TYPE_IDS.includes(b.type)) set(b, 'type', 'apartment');
  if (!RENOVATION_IDS.includes(b.renovation)) set(b, 'renovation', 'none');
  for (const k of ['builtYear', 'moveInYear', 'renovatedYear']) {
    if (k in b || k === 'builtYear') set(b, k, intIn(b[k], 1000, 3000));
  }
  if ('floor' in b) set(b, 'floor', finiteOrNull(b.floor));

  const src = Array.isArray(d.residents) ? d.residents : (changed = true, []);
  const seen = new Set();
  const list = [];
  for (const r of src) {
    if (!isObj(r)) { changed = true; continue; }
    let id = typeof r.id === 'string' && r.id !== '' ? r.id : null;
    if (id === null || seen.has(id)) {
      do { id = makeId(); } while (seen.has(id));
    }
    seen.add(id);
    const clean = {
      ...r,
      id,
      name: typeof r.name === 'string' ? r.name : '',
      gender: r.gender === 'M' || r.gender === 'F' ? r.gender : '',
      birth: typeof r.birth === 'string' ? r.birth : '',
      utcOffsetMinutes: intIn(r.utcOffsetMinutes, -840, 840) ?? 480,
    };
    if (JSON.stringify(clean) !== JSON.stringify(r)) changed = true;
    list.push(clean);
  }
  if (list.length !== src.length || changed) d.residents = list;
  if (d.mainResidentId != null && (typeof d.mainResidentId !== 'string' || !list.some((r) => r.id === d.mainResidentId))) {
    d.mainResidentId = null;
    changed = true;
  }

  // 設定:未知的鍵、型別和預設值不同的值一律丟掉(引擎會直接丟例外)
  if (!isObj(d.settings)) { d.settings = {}; changed = true; }
  for (const k of Object.keys(d.settings)) {
    const def = DEFAULT_SETTINGS[k];
    const v = d.settings[k];
    const okType = Object.hasOwn(DEFAULT_SETTINGS, k) && typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v));
    if (!okType) { delete d.settings[k]; changed = true; }
  }

  // 平面圖不是物件就丟掉;是物件但內容不合法的,留給平面圖畫面用白話說明哪裡有問題(不默默刪掉使用者畫的東西)
  if (d.plan != null && !isObj(d.plan)) { d.plan = null; changed = true; }

  if (!isObj(d.ui)) { d.ui = {}; changed = true; }
  return changed;
}

/**
 * 檢查設定「值」是否合法(例如 northMode 只能是 magnetic 或 true):逐項拿最小的合法輸入問引擎,
 * 會丟例外的項目就是壞值,刪掉退回預設。回傳被刪掉的鍵。只在載入與匯入時跑,不在每次更新時跑。
 */
export function dropInvalidSettings(settings, analyze) {
  const probe = {
    nowMs: Date.UTC(2026, 0, 1),
    utcOffsetMinutes: 480,
    facing: { bearing: 175, doorBearing: null, declination: -5, uncertainty: null },
    building: { type: 'apartment', builtYear: 2005, moveInYear: null, renovation: 'none', floor: null },
    residents: [{ id: 'p', name: 'p', gender: 'M', birth: '1985-06-15', utcOffsetMinutes: 480 }],
    mainResidentId: null,
    plan: null,
  };
  const dropped = [];
  for (const k of Object.keys(settings)) {
    try { analyze(probe, { [k]: settings[k] }); } catch { delete settings[k]; dropped.push(k); }
  }
  return dropped;
}

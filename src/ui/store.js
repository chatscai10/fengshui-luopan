// 全域狀態:單一物件 + 持久化(localStorage,失敗退回記憶體)+ 訂閱 + 衍生分析結果。
// 分析結果由 src/core/analyze.js 的 analyzeHouse 產生(docs/API.md),這裡只做記憶化。
import { analyzeHouse } from '../core/analyze.js';
import * as geo from '../core/geo.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { repairDraft, dropInvalidSettings } from './repair.js';
import { uncertaintyFor } from './easy/direction.js';
import { facingCheckOf } from './easy/measure.js';

const KEY = 'fengshui.state.v1';
export const STATE_VERSION = 1;

export const DEFAULT_STATE = Object.freeze({
  v: STATE_VERSION,
  facing: {
    bearing: null,        // 宅向羅盤讀數(度,基準隨 settings.northMode);null=尚未設定
    doorBearing: null,    // 大門朝向;null=與宅向相同
    source: 'manual',     // 'manual' | 'sensor' | 'pick8'(簡單模式自己選的 8 方位,存該方位正中間)
    sigma: null,          // 鎖定平均的圓周標準差(度)
    lockedAtMs: null,
    check: null,          // 簡單模式「移一步再量」的結果 { n, spreadDeg, lockedAtMs };lockedAtMs 與上面不同就失效
    cityId: '台北',       // 磁偏角城市(geo.CITY_DECLINATIONS 的鍵,中文)
  },
  building: { type: 'apartment', builtYear: null, moveInYear: null, renovation: 'none', floor: null },
  residents: [],          // { id, name, gender:'M'|'F', birth:'YYYY-MM-DD[ HH:mm]', utcOffsetMinutes:480 }
  mainResidentId: null,
  plan: null,             // PlanV1(規格 2.7.1)外加 upMode:'facing'|'north'、upOffset(度)。這兩欄只給 UI 用,送進引擎前會拿掉
  settings: {},           // DEFAULT_SETTINGS 的覆寫
  // mode:'easy' 簡單模式(預設)| 'pro' 完整功能;只有 main.js 的 navigate() 寫入。
  // 簡單模式另外會寫 easyStep、easyLayout、easyIntroShown(docs/EASY_SPEC.md 3.1)
  ui: { tab: 'compass', layer: 'wealth', theme: 'auto', mode: 'easy' },
});

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function safeStorage() {
  try {
    const s = window.localStorage;
    const probe = '__fs_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => void mem.set(k, String(v)),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

const plainObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** 補齊缺欄位(版本升級或舊資料),並修掉會讓引擎丟例外的壞欄位 */
function normalize(raw) {
  const base = clone(DEFAULT_STATE);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const s = { ...base, ...raw };
  s.facing = { ...base.facing, ...plainObj(raw.facing) };
  s.building = { ...base.building, ...plainObj(raw.building) };
  s.ui = { ...base.ui, ...plainObj(raw.ui) };
  s.settings = { ...plainObj(raw.settings) };
  s.residents = Array.isArray(raw.residents) ? raw.residents : [];
  s.v = STATE_VERSION;
  // 壞欄位(型別不對、範圍外、未知設定)在這裡一次修好,各畫面拿到的狀態一定能餵給引擎
  repairDraft(s);
  return s;
}

// 磁偏角一律傳給引擎:northMode='true' 時用來換算,磁北時用來並列「換成真北會變成哪一山」
function declinationOf(s, nowMs) {
  try {
    const d = geo.declinationFor(s.facing.cityId, nowMs);
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

/** 自己選的 8 方位(存該方位正中間):真正的方向可能在這一格的任何地方,所以不確定度是半格寬 */
export const PICK8_UNCERTAINTY = 22.5;

/**
 * 送進引擎的不確定度(度);null = 交給引擎用設定值。
 * = max(設定的誤差, 2σ, iPhone 自己估計的誤差, 簡單模式兩次量測的差距);後兩項只在綁定同一次鎖定時有效。
 * 自己選的 8 方位至少 PICK8_UNCERTAINTY,完整功能的報告才會提醒玄空等細格要再確認。
 */
export function facingUncertaintyOf(s) {
  const f = s && s.facing ? s.facing : {};
  const settings = s && s.settings ? s.settings : {};
  const mu = Number.isFinite(settings.measureUncertainty) ? settings.measureUncertainty : DEFAULT_SETTINGS.measureUncertainty;
  if (f.source === 'pick8') return Math.max(mu, PICK8_UNCERTAINTY);
  const chk = facingCheckOf(f);
  const spread = chk && chk.spreadDeg != null ? chk.spreadDeg : null;
  const acc = chk && Number.isFinite(chk.accuracyDeg) ? chk.accuracyDeg : null;
  if (f.sigma == null && spread == null && acc == null) return null;
  return uncertaintyFor({ measureUncertainty: mu, sigmaDeg: f.sigma, spreadDeg: spread, accuracyDeg: acc });
}

/**
 * analyzeHouse 的輸入(docs/API.md),由狀態算出;純函式。store.input() 與「方向差幾度會不會換位置」的試算共用。
 * @param {object} s store 狀態
 * @param {number} [nowMs] 取整點以利記憶化
 */
export function inputOf(s, nowMs = Date.now()) {
  const hourMs = Math.floor(nowMs / 3600000) * 3600000;
  const declination = declinationOf(s, hourMs);
  const trueMode = s.settings.northMode === 'true' && declination != null;
  let plan = null;
  if (s.plan) {
    const { upMode, upOffset: rawOffset, ...core } = clone(s.plan);
    // 匯入或手改的備份可能帶非數字,一律當 0,不讓字串相加把整個 App 弄白屏
    const upOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
    // 圖面上方的方位角必須是目前北基準下的值(API.md 第 8 節)
    let facingUsed = null;
    if (s.facing.bearing != null) {
      facingUsed = trueMode ? geo.toTrue(s.facing.bearing, declination) : s.facing.bearing;
    }
    const base = upMode === 'north' ? 0 : facingUsed;
    core.planUpBearing = base == null ? null : geo.normalizeBearing(base + upOffset);
    plan = core;
  }
  return {
    nowMs: hourMs,
    utcOffsetMinutes: 480,
    facing: {
      bearing: s.facing.bearing,
      doorBearing: s.facing.doorBearing,
      declination,
      uncertainty: facingUncertaintyOf(s),
    },
    building: s.building,
    residents: s.residents,
    mainResidentId: s.mainResidentId,
    plan,
  };
}

export function newId() {
  return Math.random().toString(36).slice(2, 8);
}

export function createStore(storage = safeStorage()) {
  let state;
  try {
    state = normalize(JSON.parse(storage.getItem(KEY)));
    dropInvalidSettings(state.settings, analyzeHouse);
  } catch {
    state = normalize(null);
  }
  const subs = new Set();
  let saveTimer = 0;
  let memo = { key: null, value: null };

  const flush = () => {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* 空間不足或私密模式:忽略,仍可用 */ }
  };
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  };
  // 手機切到別的 App 或滑掉分頁時,防抖計時器可能來不及跑;此時立刻寫入
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.addEventListener && window.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flush(); });
    window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
  }

  const commit = (next) => {
    state = next;
    persist();
    for (const fn of [...subs]) fn(state);
  };

  const api = {
    get: () => state,

    /** 以草稿函式更新:update(d => { d.facing.bearing = 175; }) */
    update(fn) {
      const draft = clone(state);
      fn(draft);
      commit(normalize(draft));
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /** analyzeHouse 的輸入(docs/API.md);nowMs 取整點以利記憶化 */
    input(nowMs = Date.now()) {
      return inputOf(state, nowMs);
    },

    /** 分析結果(記憶化)。尚未量朝向回 { error:'NO_FACING' };其他失敗回 { error: 訊息 }。 */
    report() {
      if (state.facing.bearing == null) return { error: 'NO_FACING', missing: ['facing'] };
      let input;
      try {
        input = api.input();
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
      const key = JSON.stringify([input, state.settings]);
      if (memo.key === key) return memo.value;
      let value;
      try {
        value = analyzeHouse(input, state.settings);
      } catch (e) {
        value = { error: String((e && e.message) || e) };
      }
      memo = { key, value };
      return value;
    },

    reset() {
      commit(normalize(null));
    },

    exportJSON() {
      return JSON.stringify(state, null, 2);
    },

    /**
     * 讀備份檔文字並驗證,回傳修好的狀態但不寫入(匯入前先確認檔案可用,再問使用者要不要覆蓋)。
     * 不是 JSON、版本不符、或缺少朝向欄位(不像本 App 的備份)都丟例外。
     */
    parseBackup(text) {
      const raw = JSON.parse(text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== STATE_VERSION) throw new Error('備份檔格式或版本不符');
      if (!raw.facing || typeof raw.facing !== 'object' || Array.isArray(raw.facing)) throw new Error('備份檔格式不符:找不到朝向資料');
      const next = normalize(raw);
      dropInvalidSettings(next.settings, analyzeHouse);
      return next;
    },

    importJSON(text) {
      commit(api.parseBackup(text));
    },
  };
  return api;
}

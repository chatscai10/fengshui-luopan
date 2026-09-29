// 「方向差幾度,排第一的財位會不會換?」(docs/EASY_SPEC.md 2.2、8.12)。
// 財位的排序有一大半看方位(每個角落落在哪個方位、玄空的 24 格),所以不能一律說「不受影響」。
// 這裡把朝向在 ±U 範圍內每隔一小段重算一次既有的 analyzeHouse,比對排第一的位置與評等;不新增任何風水判斷。
// 純函式(不碰 DOM);有小快取,同一組資料重畫時不重算。
import { analyzeHouse } from '../../core/analyze.js';
import { normalizeBearing } from '../../core/geo.js';
import { inputOf } from '../store.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 取樣間隔上限(度):8 方位每格 45 度、24 山每格 15 度,1.5 度的間隔抓得到每一次換格 */
export const STABILITY_STEP_DEG = 1.5;
const CACHE_MAX = 24;
const cache = new Map();

/** 報告裡排第一的財位(只取比對需要的欄位);沒有就回 null */
export function topOf(report) {
  const t = isObj(report) && isObj(report.summary) && Array.isArray(report.summary.wealthTop) ? report.summary.wealthTop[0] : null;
  if (!isObj(t)) return null;
  return { id: t.id ?? null, tier: t.tier ?? null, kind: t.kind ?? null, roomId: t.roomId ?? null, corner: t.corner ?? null, dir8: t.dir8 ?? null };
}

/**
 * 把狀態的朝向換成 rawBearing(磁北,與 facing.bearing 同基準)後重算報告。
 * 大門另外設了方向(doorBearing)時,一起轉同樣的度數(兩者都是手機量的,誤差方向相同最保守)。
 * 可另外換平面圖(plan)。
 */
export function reportAt(state, rawBearing, { nowMs = Date.now(), plan } = {}) {
  if (!isObj(state) || !isObj(state.facing) || !isNum(rawBearing)) return null;
  const f = state.facing;
  const delta = isNum(f.bearing) ? rawBearing - f.bearing : 0;
  const facing = {
    ...f,
    bearing: normalizeBearing(rawBearing),
    doorBearing: isNum(f.doorBearing) ? normalizeBearing(f.doorBearing + delta) : f.doorBearing,
  };
  const s = { ...state, facing, plan: plan === undefined ? state.plan : plan };
  try {
    const r = analyzeHouse(inputOf(s, nowMs), s.settings);
    return r && !r.error ? r : null;
  } catch {
    return null;
  }
}

const sameTop = (a, b) => Boolean(a && b && a.id === b.id);

/**
 * 朝向在 [b − U, b + U] 之間,排第一的財位會不會換成別的位置或換評等。
 * @param {object} state store 狀態
 * @param {number} rawBearing 中心朝向(磁北)
 * @param {number} uncertaintyDeg U(度)
 * @returns {{status:'stable'|'changes'|'unknown', u:number, center:object|null, alt:object|null, change:'place'|'tier'|null}}
 *   change 'place' = 排第一的換成 alt;'tier' = 位置一樣但評等(較適合/可以考慮/不建議)會變。
 */
export function wealthStability(state, rawBearing, uncertaintyDeg, { nowMs = Date.now(), stepDeg = STABILITY_STEP_DEG } = {}) {
  const u = isNum(uncertaintyDeg) && uncertaintyDeg > 0 ? uncertaintyDeg : 0;
  const unknown = { status: 'unknown', u, center: null, alt: null, change: null };
  if (!isObj(state) || !isNum(rawBearing)) return unknown;
  const hourMs = Math.floor(nowMs / 3600000) * 3600000;
  let key = null;
  try {
    key = JSON.stringify([state.facing, state.plan, state.building, state.residents, state.mainResidentId, state.settings, rawBearing, u, hourMs, stepDeg]);
  } catch { key = null; }
  if (key !== null && cache.has(key)) return cache.get(key);

  const center = topOf(reportAt(state, rawBearing, { nowMs: hourMs }));
  let out;
  if (!center) {
    out = unknown;
  } else {
    const n = u > 0 ? Math.max(1, Math.ceil(u / (isNum(stepDeg) && stepDeg > 0 ? stepDeg : STABILITY_STEP_DEG))) : 0;
    let altPlace = null;
    let altTier = null;
    // 由近到遠取樣,先找到的換位置是最可能的那一個
    for (let i = 1; i <= n && !altPlace; i += 1) {
      for (const sign of [-1, 1]) {
        const t = topOf(reportAt(state, rawBearing + (sign * u * i) / n, { nowMs: hourMs }));
        if (!t) continue;
        if (!sameTop(t, center)) { altPlace = t; break; }
        if (!altTier && t.tier !== center.tier) altTier = t;
      }
    }
    if (altPlace) out = { status: 'changes', u, center, alt: altPlace, change: 'place' };
    else if (altTier) out = { status: 'changes', u, center, alt: altTier, change: 'tier' };
    else out = { status: 'stable', u, center, alt: null, change: null };
  }
  if (key !== null) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
  }
  return out;
}

/**
 * 同一個範本的大門放左、中、右三種位置時,排第一的財位是不是都在同一個地方(房間與角落都一樣)。
 * plans = { left, center, right } 三份平面圖。算不出來回 null。
 */
export function sameTopForPlans(state, rawBearing, plans, { nowMs = Date.now() } = {}) {
  if (!isObj(plans) || !isNum(rawBearing)) return null;
  const tops = Object.values(plans).map((p) => topOf(reportAt(state, rawBearing, { nowMs, plan: p })));
  if (tops.length < 2 || tops.some((t) => !t)) return null;
  const k = (t) => `${t.kind === 'dark' ? `dark:${t.dir8}` : `${t.roomId}:${t.corner}`}`;
  return tops.every((t) => k(t) === k(tops[0]));
}

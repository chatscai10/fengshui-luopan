// 「移一步再量」的自我檢查與寫入朝向(docs/EASY_SPEC.md 2.4、8.4)。
// 純函式,不碰 DOM、不 import views/compass.js;度數一律是磁北讀數,換顯示基準由 basis.js 負責。
import { circularDiff, circularMean } from '../../core/geo.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';
import { rawFromDisplayed, roundTenth } from '../basis.js';
import { SENSOR_DEFAULTS } from '../../core/sensor-core.js';
import { uncertaintyFor } from './direction.js';
import { EASY_TEXT, fillText } from './text.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 設計值:兩次差超過一個 24 山的寬度(15 度)就算「差很多」 */
export const CHECK_DEFAULTS = Object.freeze({ warnMaxDeg: 15 });

const agreeMaxOf = (settings) => {
  const mu = settings && settings.measureUncertainty;
  return isNum(mu) && mu >= 0 ? mu : DEFAULT_SETTINGS.measureUncertainty;
};

const pairs = (idx) => {
  const out = [];
  for (let i = 0; i < idx.length; i += 1) for (let j = i + 1; j < idx.length; j += 1) out.push([idx[i], idx[j]]);
  return out;
};

/**
 * 合併 1 到 3 次鎖定結果,判斷一致與否,必要時排除離群的一次。
 * accuracyDeg 是那次鎖定期間 iPhone 自己估計的誤差(Android 沒有 → null;負值 = 未校準,不算)。
 * 只量一次時:讀數晃 → 'single-unstable';iPhone 估計誤差超過綠燈門檻 → 'single-wide';
 * 手機不回報誤差(Android)→ 'single-noacc';其他 → 'single-ok'。
 * @param {Array<{meanDeg:number, sigma:number|null, status:'ok'|'unstable', lockedAtMs:number, accuracyDeg?:number|null}>} readings 磁北
 * @param {{measureUncertainty?:number}} [settings]
 * @returns {null|{n:number, used:number[], dropped:number|null, meanDeg:number, spreadDeg:number|null, sigmaMax:number|null,
 *   accuracyDeg:number|null, lockedAtMs:number|null, verdict:string, uncertaintyDeg:number}} 輸入不合法回 null
 */
export function combineChecks(readings, settings = {}) {
  if (!Array.isArray(readings) || readings.length < 1 || readings.length > 3) return null;
  if (!readings.every((r) => r && isNum(r.meanDeg))) return null;
  const n = readings.length;
  const agreeMax = agreeMaxOf(settings);
  const warnMax = CHECK_DEFAULTS.warnMaxDeg;
  const diff = (i, j) => circularDiff(readings[i].meanDeg, readings[j].meanDeg);
  const spreadOf = (idx) => (idx.length < 2 ? null : Math.max(...pairs(idx).map(([i, j]) => diff(i, j))));

  let used = readings.map((_, i) => i);
  let dropped = null;
  let verdict;
  const accOf = (r) => (isNum(r.accuracyDeg) && r.accuracyDeg >= 0 ? r.accuracyDeg : null);
  if (n === 1) {
    const acc = accOf(readings[0]);
    if (readings[0].status === 'unstable') verdict = 'single-unstable';
    else if (acc === null) verdict = 'single-noacc';
    else if (acc > SENSOR_DEFAULTS.accuracyGreenMax) verdict = 'single-wide';
    else verdict = 'single-ok';
  } else if (n === 2) {
    const d = diff(0, 1);
    verdict = d <= agreeMax ? 'agree' : d <= warnMax ? 'warn' : 'far';
  } else {
    const all = pairs(used);
    const close = all.filter(([i, j]) => diff(i, j) <= agreeMax);
    if (close.length === all.length) {
      verdict = 'agree';
    } else if (close.length === 1) {
      // 恰好一對一致,第三次和兩者都差超過門檻:排除第三次
      const [i, j] = close[0];
      dropped = used.find((k) => k !== i && k !== j);
      used = [i, j];
      verdict = 'dropped';
    } else {
      verdict = spreadOf(used) <= warnMax ? 'warn' : 'inconsistent';
    }
  }

  const means = used.map((i) => readings[i].meanDeg);
  const stats = n === 1 ? { mean: means[0] } : circularMean(means);
  const meanDeg = stats.mean === null ? means[0] : stats.mean;
  const spreadDeg = spreadOf(used);
  const sigmas = used.map((i) => readings[i].sigma).filter((s) => isNum(s) && s >= 0);
  const sigmaMax = sigmas.length ? Math.max(...sigmas) : null;
  const accs = used.map((i) => accOf(readings[i])).filter((a) => a !== null);
  const accuracyDeg = accs.length ? Math.max(...accs) : null;
  // lockedAtMs 要對應「實際採用的最後一次」;直接取 readings[n-1] 在 dropped 兩個方向都可能綁錯次
  // (被排除的那次若在尾端,會回一個沒被算進平均的時間戳)。
  const last = readings[Math.max(...used)];
  return {
    n,
    used,
    dropped,
    meanDeg,
    spreadDeg,
    sigmaMax,
    accuracyDeg,
    lockedAtMs: isNum(last.lockedAtMs) ? last.lockedAtMs : null,
    verdict,
    uncertaintyDeg: uncertaintyFor({ measureUncertainty: agreeMax, sigmaDeg: sigmaMax, spreadDeg, accuracyDeg }),
  };
}

/** 差距與 σ 的顯示:最多 1 位小數,去掉 .0(2、2.5) */
export const fmtSmall = (x) => String(Math.round((isNum(x) ? x : 0) * 10) / 10);

/**
 * 自我檢查結論句(5.2 1D 表,逐字)。icon 與文字一起顯示,不只靠顏色('i' = 說明,不是警告)。
 * near = 8 方位接近分界(eightImpact(方位, check.uncertaintyDeg).near);dir = 方位名(例如「南」)。
 * 兩次差得有點多、但兩次都還在同一個大方位時,不當成問題(不和「大門朝哪一方:不受影響」互相矛盾)。
 * @returns {null|{icon:'✓'|'!'|'i', text:string, systematic:string|null}}
 */
export function checkVerdictText(check, lockSeconds = 3, { near = false, dir = '' } = {}) {
  if (!check || typeof check !== 'object') return null;
  const s = isNum(lockSeconds) && lockSeconds > 0 ? lockSeconds : 3;
  const d = fmtSmall(check.spreadDeg);
  const sigma = fmtSmall(check.sigmaMax);
  const acc = String(Math.round(isNum(check.accuracyDeg) ? check.accuracyDeg : 0));
  const sys = EASY_TEXT['d.systematic'];
  switch (check.verdict) {
    case 'single-ok': return { icon: '✓', text: fillText('verdict.single-ok'), systematic: null };
    case 'single-noacc': return { icon: 'i', text: fillText('verdict.single-noacc'), systematic: null };
    case 'single-wide': return { icon: '!', text: fillText('verdict.single-wide', { acc }), systematic: null };
    case 'single-unstable': return { icon: '!', text: fillText('verdict.single-unstable', { s, sigma }), systematic: null };
    case 'agree': return { icon: '✓', text: fillText('verdict.agree', { n: check.n, d }), systematic: sys };
    case 'warn':
      if (check.n >= 3) return { icon: '!', text: fillText('verdict.warn3', { d }), systematic: null };
      return near || !dir
        ? { icon: '!', text: fillText('verdict.warn2', { d }), systematic: null }
        : { icon: '✓', text: fillText('verdict.warn2-ok', { d, dir }), systematic: sys };
    case 'far': return { icon: '!', text: fillText('verdict.far', { d }), systematic: null };
    case 'dropped': return { icon: '✓', text: fillText('verdict.dropped', { k: (check.dropped ?? 0) + 1, d }), systematic: sys };
    case 'inconsistent': return { icon: '!', text: fillText('verdict.inconsistent'), systematic: null };
    default: return null;
  }
}

const ORIGIN_SOURCE = Object.freeze({ sensor: 'sensor', pick8: 'pick8', typed: 'manual' });

/**
 * 簡單模式要寫進 store.facing 的欄位(與羅盤頁 buildFacingPatch 同一組欄位與取整規則)。
 * @param {{displayedDeg:number, basis:{trueMode:boolean, declination:number|null}, origin:'sensor'|'pick8'|'typed',
 *   lock?:{sigma:number, lockedAtMs:number}|null, check?:object|null}} p
 * check 另外記下「有幾次不採用」(dropped:0|1)與 iPhone 自己估計的誤差(accuracyDeg,Android 為 null),
 * store.input() 會把後者算進不確定度。
 * @returns {null|{bearing:number, source:'sensor'|'pick8'|'manual', sigma:number|null, lockedAtMs:number|null,
 *   check:{n:number, spreadDeg:number|null, lockedAtMs:number, dropped:0|1, accuracyDeg:number|null}|null, doorBearing:null}}
 */
export function easyFacingPatch({ displayedDeg, basis, origin, lock = null, check = null } = {}) {
  if (!isNum(displayedDeg) || !Object.prototype.hasOwnProperty.call(ORIGIN_SOURCE, origin)) return null;
  const b = basis && typeof basis === 'object' ? basis : { trueMode: false, declination: null };
  const bearing = roundTenth(rawFromDisplayed(displayedDeg, b));
  const sensor = origin === 'sensor';
  const locked = sensor && lock && isNum(lock.sigma);
  const lockedAtMs = locked && isNum(lock.lockedAtMs) ? Math.round(lock.lockedAtMs) : null;
  let chk = null;
  if (sensor && check && lockedAtMs !== null && Number.isInteger(check.n) && check.n >= 1 && check.n <= 3) {
    chk = {
      n: check.n,
      spreadDeg: isNum(check.spreadDeg) ? Math.round(check.spreadDeg * 10) / 10 : null,
      lockedAtMs,
      dropped: Number.isInteger(check.dropped) ? 1 : 0,
      accuracyDeg: isNum(check.accuracyDeg) && check.accuracyDeg >= 0 ? Math.round(check.accuracyDeg * 10) / 10 : null,
    };
  }
  return {
    bearing,
    source: ORIGIN_SOURCE[origin],
    sigma: locked ? Math.round(lock.sigma * 100) / 100 : null,
    lockedAtMs,
    check: chk,
    doorBearing: null,
  };
}

/** 存著的自我檢查結果;只有來源是手機指北針、且綁定的是同一次鎖定才有效,否則回 null */
export function facingCheckOf(facing) {
  if (!facing || typeof facing !== 'object' || facing.source !== 'sensor') return null;
  const c = facing.check;
  if (!c || typeof c !== 'object') return null;
  if (!Number.isInteger(c.n) || c.n < 1 || c.n > 3) return null;
  if (!isNum(c.lockedAtMs) || c.lockedAtMs !== facing.lockedAtMs) return null;
  if (!(c.spreadDeg === null || (isNum(c.spreadDeg) && c.spreadDeg >= 0))) return null;
  if (c.dropped != null && c.dropped !== 0 && c.dropped !== 1) return null;
  if (c.accuracyDeg != null && !(isNum(c.accuracyDeg) && c.accuracyDeg >= 0)) return null;
  return c;
}

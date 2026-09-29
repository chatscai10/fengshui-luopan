// 磁北/真北基準的換算。資料裡永遠存「磁方位讀數」(實體羅盤指的北),
// 畫面上顯示與輸入的是目前北基準下的方位(選真北時是換算後的度數)。
// 羅盤畫面與住宅畫面共用同一套換算,兩邊看到的度數才會一致。
import * as geo from '../core/geo.js';

const norm = (b) => geo.normalizeBearing(b);

/** 磁北/真北基準。與 store.input() 相同判斷: 只有選真北且算得出磁偏角才真的用真北。 */
export function basisOf(state, nowMs = Date.now()) {
  let declination = null;
  try {
    const d = geo.declinationFor(state.facing.cityId, nowMs);
    if (Number.isFinite(d)) declination = d;
  } catch { /* 城市代碼不認得 */ }
  const wantsTrue = state.settings.northMode === 'true';
  return { trueMode: wantsTrue && declination != null, wantsTrue, declination };
}

/** 資料裡存的是磁方位讀數;畫面上顯示的是目前北基準下的方位。 */
export const displayedFromRaw = (raw, basis) => (basis.trueMode ? geo.toTrue(raw, basis.declination) : norm(raw));
export const rawFromDisplayed = (disp, basis) => (basis.trueMode ? geo.toMagnetic(disp, basis.declination) : norm(disp));

/** 取到 0.1 度,結果落在 0 到 360 之內(359.96 進位成 0) */
export function roundTenth(x) {
  const t = Math.floor(norm(x) * 10 + 0.5);
  return (t >= 3600 ? t - 3600 : t) / 10;
}

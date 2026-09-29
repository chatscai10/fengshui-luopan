// 手機指北針的共用文字(docs/EASY_SPEC.md 5.7、8.2):狀態訊息、鎖定被擋的原因、穩定度與姿勢提示。
// 羅盤分頁與簡單模式共用同一份,兩邊講法才會一致。純函式,不碰 DOM、不讀全域(sensorSupported 讀傳入的物件)。
import { describeStatus, HINTS, SENSOR_DEFAULTS, qualityLight } from '../core/sensor-core.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const SENSOR_FALLBACK_HINT = '請拖曳盤面或輸入度數。';

/** iOS 按過「不允許」後不會再彈窗,要教使用者怎麼恢復 */
export const DENIED_HELP = '(沒有跳出詢問的話,請完全關閉 Safari 或主畫面 App 後重開;仍不行,到 設定 > Safari > 進階 > 網站資料 移除本網站)';

/** 感測器狀態碼 → 使用者訊息。訊息逐字取自規格 2.9.5(sensor-core 的 STATUS_INFO)。 */
export function sensorMessage(status) {
  // 開發者訊息不對使用者顯示,改用「偵測不到方位感測器」
  const key = status === 'insecure-context' ? 'unsupported' : status;
  const info = describeStatus(key);
  return info ? info.message : null;
}

/** 鎖定被擋下時的原因訊息。startLabel 是畫面上「啟動指北針」那顆按鈕的文字。 */
export function lockBlockedMessage(reason, { startLabel = '使用手機指北針' } = {}) {
  switch (reason) {
    case 'tilt': return sensorMessage('tilt-too-large');
    case 'uncalibrated': return sensorMessage('uncalibrated');
    case 'face-down': return HINTS.faceDown;
    case 'quality-red': return HINTS.calibrate;
    case 'not-running': return `請先按「${startLabel}」。`;
    default: return '還沒有讀到方位資料,請稍等一下。';
  }
}

/**
 * 穩定度的短標籤,依原因(reasonKey)而不是只依燈號:iPhone 因為自己估計的誤差變黃時,不能說成「手有點晃」。
 * 「拿得很穩」只講手有沒有晃,不暗示「很準」。
 */
export const STABILITY_LABEL = Object.freeze({
  'ios-ok': '手拿得很穩',
  steady: '手拿得很穩',
  'ios-wide': '誤差有點大',
  jitter: '手有點晃',
  uncalibrated: '還沒校準',
  'ios-bad': '誤差太大',
  'jitter-bad': '晃得太多',
  waiting: '判斷中',
});

const BARS = Object.freeze({ green: 3, yellow: 2, red: 1, unknown: 0 });
const LEVELS = Object.freeze(['green', 'yellow', 'red']);

/** 穩定度原因句(5.7)。{acc} 取整數、{max} = SENSOR_DEFAULTS.accuracyYellowMax。不用 ± 符號。 */
export const STABILITY_REASON = Object.freeze({
  'ios-ok': '手機自己估計,可能差 {acc} 度左右。',
  steady: '這支手機不會告訴我們它自己的誤差,穩不代表準;記下後可以移一步再量一次比對。',
  'ios-wide': '手機自己估計,可能差 {acc} 度左右,有點大。離鐵門、冰箱、電器遠一點再看看。',
  jitter: '讀數有點晃。手機放平、手不要動,離鐵門、冰箱、電器遠一點。',
  uncalibrated: '手機說指北針還沒校準。拿著手機在空中慢慢畫幾個 8 字,再回來量。',
  'ios-bad': '手機自己估計,誤差超過 {max} 度,現在量不準。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。',
  'jitter-bad': '讀數一直跳,附近可能有會干擾的東西。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。',
  waiting: '正在判斷,請把手機放平、保持不動 1 秒。',
});

// 與 qualityLight 相同的門檻:0 綠、1 黃、2 紅
const levelOf = (v, greenMax, yellowMax) => (v > yellowMax ? 2 : v > greenMax ? 1 : 0);

/**
 * 穩定度(燈號 + 白話原因)。燈號與 sensor-core 的 qualityLight 完全一致;
 * 原因取精度與晃動中較差的一項,同級時先講精度(iPhone 才有精度,Android 只有晃動)。
 * @param {{status?:string, accuracyDeg?:number|null, sigmaDeg?:number|null}|null} reading 感測器讀數
 * @returns {{level:'green'|'yellow'|'red'|'unknown', bars:number, label:string, reasonKey:string, reason:string, accuracyDeg:number|null}}
 */
export function accuracyView(reading) {
  const r = reading && typeof reading === 'object' ? reading : null;
  const acc = r && isNum(r.accuracyDeg) ? r.accuracyDeg : null;
  const sigma = r && isNum(r.sigmaDeg) && r.sigmaDeg >= 0 ? r.sigmaDeg : null;
  const level = r ? qualityLight({ accuracyDeg: acc, sigmaDeg: sigma }) : 'unknown';
  const D = SENSOR_DEFAULTS;
  let reasonKey;
  if (r && (r.status === 'uncalibrated' || (acc !== null && acc < 0))) {
    reasonKey = 'uncalibrated';
  } else if (level === 'unknown') {
    reasonKey = 'waiting';
  } else {
    const accLevel = acc === null ? -1 : levelOf(acc, D.accuracyGreenMax, D.accuracyYellowMax);
    const sigLevel = sigma === null ? -1 : levelOf(sigma, D.sigmaGreenMax, D.sigmaYellowMax);
    const byAcc = accLevel >= sigLevel; // 同級先講精度
    const worst = LEVELS.indexOf(level);
    if (worst === 0) reasonKey = acc !== null ? 'ios-ok' : 'steady';
    else if (worst === 1) reasonKey = byAcc ? 'ios-wide' : 'jitter';
    else reasonKey = byAcc ? 'ios-bad' : 'jitter-bad';
  }
  const reason = STABILITY_REASON[reasonKey]
    .replace('{acc}', acc === null ? '' : String(Math.round(acc)))
    .replace('{max}', String(D.accuracyYellowMax));
  return { level, bars: BARS[level], label: STABILITY_LABEL[reasonKey], reasonKey, reason, accuracyDeg: acc };
}

export const TILT_HINT = '手機有點斜,請放平(傾斜 {n} 度)';

/** 姿勢提示(優先序:螢幕朝下 > 太傾斜的讀數 > 傾斜超過鎖定門檻);沒有就回空字串 */
export function postureHint(reading) {
  if (!reading || typeof reading !== 'object') return '';
  if (reading.faceDown === true) return HINTS.faceDown;
  if (reading.status === 'tilt-too-large') return sensorMessage('tilt-too-large');
  if (isNum(reading.tiltDeg) && reading.tiltDeg >= SENSOR_DEFAULTS.lockMaxTiltDeg) return TILT_HINT.replace('{n}', String(Math.round(reading.tiltDeg)));
  return '';
}

/** 這個環境有沒有 DeviceOrientationEvent(電腦瀏覽器多半有型別但沒有事件,由 watchdog 另外判斷) */
export function sensorSupported(win) {
  return Boolean(win) && typeof win.DeviceOrientationEvent !== 'undefined';
}

/** App 內建瀏覽器(可能不給感測器)的名稱;一般瀏覽器回 null */
export function inAppBrowserName(ua) {
  if (typeof ua !== 'string') return null;
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/Instagram/.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/.test(ua)) return 'Facebook';
  return null;
}

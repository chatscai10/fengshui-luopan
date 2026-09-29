// 羅盤畫面(UI_SPEC 4.1): 量出「向」。盤面畫一次、旋轉只改 CSS transform;紅線與磁針/標記不隨盤轉。
// 頂層不存取 document/window:純邏輯(換算、驗證、讀數模型)都匯出供 node 測試,DOM 只在 mount() 裡碰。
import { h } from '../dom.js';
import { basisOf, displayedFromRaw, rawFromDisplayed } from '../basis.js';
import * as geo from '../../core/geo.js';
import { readout, headingFromDialAngle, dialAngleToward, boundaryCrossings } from '../../core/luopan.js';
import { createCompassSource, createBrowserEnv } from '../../core/sensor.js';
import { HINTS, lockAllowed, nearBoundary, roundInt } from '../../core/sensor-core.js';
import { IMPACT_SHORT } from '../../core/copy.js';
import { drawDial, drawOverlay, ensureFonts, needleMarkup, needleRotation } from '../canvas/luopanRenderer.js';
import { createDialGesture, bindDialGestures } from '../canvas/gestures.js';
import { sensorMessage, lockBlockedMessage, SENSOR_FALLBACK_HINT, DENIED_HELP, STABILITY_LABEL, accuracyView } from '../sensorText.js';
import { plainDirection, eightImpact, shanImpact, sectorOf8, uncertaintyFor } from '../easy/direction.js';
import { openCompassHelp } from '../components/compassHelp.js';

// ─────────────────────────── 純邏輯(可在 node 測試) ───────────────────────────

const norm = (b) => geo.normalizeBearing(b);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 取到 0.1 度(Math.floor(x·10+0.5) 語意,與引擎讀數列一致)。輸入須為有限數字。 */
export function round1(x) {
  const t = Math.floor(norm(x) * 10 + 0.5);
  return (t >= 3600 ? t - 3600 : t) / 10;
}

/** 顯示用度數字串,例如 175.0、0.0(359.96 進位成 0.0,不會出現 360.0)。 */
export function fmtDeg(b) {
  return round1(b).toFixed(1);
}

/** 輸入框裡的字串: 整數不帶小數點。 */
export function fmtInput(b) {
  const s = fmtDeg(b);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * 解析使用者輸入的度數。容許全形數字、「175°」「175 度」與貼上的雜字;超過 0–359.9 不接受。
 * @returns {{ok:true, value:number}|{ok:false, reason:'empty'|'nan'|'range'}}
 */
export function parseBearingInput(text) {
  const raw = String(text == null ? '' : text).normalize('NFKC').trim();
  if (raw === '') return { ok: false, reason: 'empty' };
  const cleaned = raw.replace(/[°º度\s,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned) && !/^-?\.\d+$/.test(cleaned)) return { ok: false, reason: 'nan' };
  const v = Number(cleaned);
  if (!Number.isFinite(v)) return { ok: false, reason: 'nan' };
  const r = Math.round(v * 10) / 10;
  if (r < 0 || r >= 360) return { ok: false, reason: 'range' };
  return { ok: true, value: r };
}

/** ±0.5° 按鈕: 先貼齊 0.5 的倍數再走一步(175.3 → 175.5,175.5 → 176.0)。 */
export function stepHeading(headingDeg, dir) {
  const h0 = norm(headingDeg);
  const grid = dir > 0 ? Math.floor(h0 * 2 + 1e-9) / 2 + 0.5 : Math.ceil(h0 * 2 - 1e-9) / 2 - 0.5;
  return round1(grid);
}

// 磁北/真北換算與住宅頁共用(../basis.js);這裡照舊匯出,供羅盤自己與測試使用
export { basisOf, displayedFromRaw, rawFromDisplayed };

/** 量的是「坐」時,宅向 = 量到的方位 + 180。 */
export const facingFromMeasured = (measured, measure) => (measure === 'sit' ? norm(measured + 180) : norm(measured));

const SANYUAN_HELP = '「山」是羅盤上 24 個方位的一格,「宮」是八大方位之一,天元、地元、人元是山的分組。';

/**
 * 讀數列要顯示的全部內容。heading = 紅線下的方位(目前北基準)。
 * sigmaDeg/accuracyDeg 只有感測器有,用來決定「接近分界」的門檻(規格 2.9.4)。
 */
export function buildReadoutModel({ heading, measure = 'facing', settings = {}, basis = { trueMode: false, declination: null }, sigmaDeg = null, accuracyDeg = null, hintDeclination = null }) {
  const b = norm(heading);
  let r;
  try { r = readout(b, settings); } catch { r = readout(b, {}); }
  const an = r.analysis;
  const sit = measure === 'sit';
  const nb = nearBoundary({ headingDeg: b, sigmaDeg, accuracyDeg });
  // 同一個門檻下,8 個大方位是否也接近分界(徽章要講清楚是細格還是大方位)
  const near8 = sectorOf8(b).distDeg < nb.thresholdDeg;

  // 換一種北基準會不會換山
  const D = basis.declination ?? hintDeclination;
  let alt = null;
  if (D != null) {
    try {
      const raw = rawFromDisplayed(b, basis);
      const otherBearing = basis.trueMode ? raw : geo.toTrue(raw, D);
      const name = geo.mountainAt(otherBearing).name;
      if (name !== r.mountain) alt = { label: basis.trueMode ? '磁北' : '真北', mountain: name };
    } catch { /* 略過 */ }
  }
  const facingBearing = sit ? norm(b + 180) : b;
  return {
    heading: b,
    plainHeading: plainDirection(b),
    plainFacing: plainDirection(facingBearing),
    degText: fmtDeg(b),
    primary: sit ? '坐' : '向',
    secondary: sit ? '向' : '坐',
    mountain: r.mountain,
    gua: r.gua,
    dragon: r.dragon,
    opposite: r.sitMountain,
    lean: an.leanTo,
    onLine: an.onLine,
    near: nb.near && !an.onLine,
    near8,
    alt,
    facingBearing,
    facingMountain: sit ? r.sitMountain : r.mountain,
    help: SANYUAN_HELP + (an.leanTo ? `「兼${an.leanTo}」表示朝向偏向隔壁的${an.leanTo}山一點。` : ''),
    text: `${sit ? '坐' : '向'} ${fmtDeg(b)}° · ${r.mountain}山(${r.gua}宮 · ${r.dragon}) · ${sit ? '向' : '坐'} ${r.sitMountain}`,
  };
}

/**
 * 讀數列最上方的白話行(EASY_SPEC 5.8)。following = 盤面正跟著手機指北針轉(還沒鎖定、沒被拖曳)。
 * 紅線貫穿整個盤面,所以講清楚是上方那一端(標著「向」;量坐時標著「坐」)。量的是坐時另外講出房子朝向。
 */
export const PLAIN_TEXT = Object.freeze({
  following: '手機頂端正對著:{text}',
  pointer: '上方「向」那一端指著:{text}',
  sit: '上方「坐」那一端指著:{sitText}(背後)· 房子朝向:{text}',
});

/** 徽章:24 格接近分界,但 8 個大方位沒有(與「接近分界,建議重測」區分,免得看起來互相矛盾) */
export const NEAR_FINE_ONLY = '24 格接近分界(8 個大方位不受影響)';

/** 鎖定後、還沒按存檔鈕時的提醒。{btn} = 存檔鈕上的字 */
export const UNSAVED_LOCK_HINT = '還沒存。按下面的「{btn}」才會存起來。';

/**
 * 鎖定成功後的說明(一句講度數、必要時講手晃與 24 格,最後接 8 大方位的短評)。
 * 判斷一律用同一個不確定度 U(sensorSession/summarizeLock 的 uncertaintyDeg = max(設定, 2σ, iPhone 估計誤差))。
 * @param {{status:'ok'|'unstable', displayedDeg:number, sigmaDeg?:number|null, uncertaintyDeg?:number|null, measureUncertainty?:number|null, unstableText?:string}} p
 */
export function lockNoteText({ status, displayedDeg, sigmaDeg = null, uncertaintyDeg = null, measureUncertainty = null, unstableText = '' }) {
  if (!isNum(displayedDeg)) return '';
  const deg = Math.floor(norm(displayedDeg) + 0.5) % 360;
  const u = isNum(uncertaintyDeg) && uncertaintyDeg >= 0
    ? uncertaintyDeg
    : uncertaintyFor({ measureUncertainty: isNum(measureUncertainty) ? measureUncertainty : undefined, sigmaDeg: isNum(sigmaDeg) ? sigmaDeg : null });
  const e8 = eightImpact(displayedDeg, u);
  const e24 = shanImpact(displayedDeg, u);
  const parts = [];
  if (status === 'ok') {
    parts.push(`已記下約 ${deg} 度。`);
    if (isNum(sigmaDeg) && sigmaDeg >= 1) parts.push('手有一點晃。');
  } else {
    parts.push(`${unstableText}。目前的平均約 ${deg} 度,建議換個位置重測。`);
  }
  if (e24 && e24.near && e8 && !e8.near) parts.push('離 24 格的分界很近,只影響細格。');
  if (e8) parts.push(e8.near ? IMPACT_SHORT.near : IMPACT_SHORT.ok);
  return parts.join('');
}

/** @param {ReturnType<typeof buildReadoutModel>} model @returns {string} */
export function plainReadoutText(model, { following = false } = {}) {
  if (!model || !model.plainHeading || !model.plainFacing) return '';
  if (model.primary === '坐') return PLAIN_TEXT.sit.replace('{sitText}', model.plainHeading.text).replace('{text}', model.plainFacing.text);
  return (following ? PLAIN_TEXT.following : PLAIN_TEXT.pointer).replace('{text}', model.plainHeading.text);
}

/**
 * 鎖定後句尾接的影響句:依鎖定平均值(目前北基準)判斷 8 大方位會不會因誤差跨到隔壁。
 * 有 uncertaintyDeg(鎖定結果已含 iPhone 估計誤差)就用它;沒有才用設定與 σ 重算。
 */
export function lockImpactShort({ displayedDeg, sigmaDeg = null, measureUncertainty = null, uncertaintyDeg = null }) {
  if (!isNum(displayedDeg)) return '';
  const u = isNum(uncertaintyDeg) && uncertaintyDeg >= 0
    ? uncertaintyDeg
    : uncertaintyFor({ measureUncertainty: isNum(measureUncertainty) ? measureUncertainty : undefined, sigmaDeg: isNum(sigmaDeg) ? sigmaDeg : null });
  const imp = eightImpact(displayedDeg, u);
  if (!imp) return '';
  return imp.near ? IMPACT_SHORT.near : IMPACT_SHORT.ok;
}

// 感測器訊息與「手機指北針」的講法跟簡單模式共用同一份(../sensorText.js)
export { SENSOR_FALLBACK_HINT, sensorMessage, lockBlockedMessage };

export const QUALITY_TEXT = STABILITY_LABEL;

/** 要寫進 store 的 facing 欄位。lock 有效時才帶 sigma 與時間;任何手動調整都會讓 lock 失效。 */
export function buildFacingPatch({ measured, measure, basis, origin, lock }) {
  const raw = rawFromDisplayed(facingFromMeasured(measured, measure), basis);
  const bearing = round1(raw);
  if (!isNum(bearing)) return null;
  const locked = origin === 'sensor' && lock && isNum(lock.sigma);
  return {
    bearing,
    source: origin === 'sensor' ? 'sensor' : 'manual',
    sigma: locked ? Math.round(lock.sigma * 100) / 100 : null,
    lockedAtMs: locked && isNum(lock.lockedAtMs) ? Math.round(lock.lockedAtMs) : null,
  };
}

/**
 * 羅盤頁鎖定後存檔時的 facing.check:只記一次量測與手機自己估計的誤差(iPhone 才有),
 * 讓簡單模式與報告用同一個誤差判斷。沒有有效鎖定或沒有誤差估計就回 null。
 */
export function facingCheckFromLock(patch, lock) {
  if (!patch || patch.lockedAtMs == null || !lock || !isNum(lock.accuracyDeg) || lock.accuracyDeg < 0) return null;
  return { n: 1, spreadDeg: null, lockedAtMs: patch.lockedAtMs, dropped: 0, accuracyDeg: Math.round(lock.accuracyDeg * 10) / 10 };
}

/** store 裡存的向若不是有限數字(壞資料),一律當成尚未量測。 */
export function savedBearingOf(state) {
  const b = state && state.facing ? state.facing.bearing : null;
  return isNum(b) ? b : null;
}

const HOW_TO = [
  ['「向」是什麼', '站在屋內面向外,通常是大門、陽台或落地窗的方向;背後那一面叫「坐」。'],
  ['站在哪裡', '站在要量的那一面(窗前、陽台外緣或屋外),背對室內、面朝外。別貼著大門量,門鎖和信箱會干擾。'],
  ['手機怎麼拿', '手機平放在胸前,頂端朝正前方。先畫幾個 8 字校準,拿掉磁吸殼、鑰匙、皮夾和手錶。'],
  ['遠離金屬', '離鐵窗、鐵門、冷氣、冰箱、電線至少 1 公尺。鋼筋大樓室內誤差可能很大,盡量伸到窗外或站到陽台外緣量。'],
  ['量三次', '等數字穩定後按「鎖定讀數」。同一面左、中、右各量一次,共 3 到 5 次,幾次差超過 5 度就重量。'],
  ['靠近交界時', '結果落在兩個方位的交界附近時,建議請老師用專業羅盤覆核。'],
];

// ─────────────────────────── 畫面 ───────────────────────────

export async function mount(root, ctx) {
  const { store, toast, openSheet, icons } = ctx;
  let destroyed = false;
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);

  const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(reducedQuery && reducedQuery.matches);

  // ── 狀態 ──
  const st = {
    dial: 0,
    measure: 'facing', // 'facing' 量的是向 | 'sit' 量的是坐
    origin: 'manual', // 目前數字的來源: 'manual' | 'sensor'
    lock: null, // { sigma, lockedAtMs, unstable }
    dirty: false,
    sensor: { phase: 'idle', message: '', following: true, lockBusy: false, lockNote: '' },
  };
  let basis = basisOf(store.get());
  let lastHeading = null;
  let source = null;
  let lastReading = null;
  const supported = typeof window.DeviceOrientationEvent !== 'undefined';
  let lastSavedRaw = savedBearingOf(store.get());
  let savedLockAt = null; // 已經存進朝向的那一次鎖定(lockedAtMs);和目前的鎖定不同就提醒「還沒存」

  const settingsNow = () => store.get().settings || {};
  const schemeNow = () => (settingsNow().yinyangScheme === 'sanhe' ? 'sanhe' : 'sanyuan');

  // ── DOM ──
  const discCanvas = h('canvas', { 'aria-hidden': 'true' });
  const rotator = h('div', { class: 'v-compass-rotator' }, discCanvas);
  const needleHost = h('div', { class: 'v-compass-layer' });
  rotator.append(needleHost);
  const overlayCanvas = h('canvas', { class: 'overlay', 'aria-hidden': 'true' });
  const stage = h('div', {
    class: 'canvas-wrap v-compass-stage',
    tabindex: '0',
    role: 'slider',
    'aria-label': '羅盤盤面。用左右方向鍵可微調讀數,拖曳可旋轉',
    'aria-valuemin': '0',
    'aria-valuemax': '360',
    'aria-valuenow': '0',
  }, rotator, overlayCanvas);

  const elLbl = h('span', { class: 'v-compass-lbl' }, '向');
  const elBig = h('span', { class: 'big' }, '0.0°');
  const elMount = h('span', { class: 'v-compass-mount' });
  const elSit = h('span', { class: 'v-compass-sit' });
  const elConv = h('div', { class: 'v-compass-conv faint hidden' });
  const elLive = h('div', { class: 'readout sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const elBadges = h('div', { class: 'v-compass-badges' });
  const elAlt = h('div', { class: 'v-compass-alt hidden' });
  const elHelp = h('p', { class: 'v-compass-note' });
  const elPlain = h('div', { class: 'v-compass-plain' });
  const readBox = h('div', { class: 'v-compass-read' },
    elPlain,
    h('div', { class: 'v-compass-r1', 'aria-hidden': 'true' }, elLbl, ' ', elBig),
    h('div', { class: 'v-compass-r2 kai', 'aria-hidden': 'true' }, elMount, ' · ', elSit),
    elConv, elLive, elBadges, elAlt, elHelp);

  // 感測器區
  const btnSensor = h('button', { class: 'btn btn-accent btn-block', type: 'button' });
  const elLight = h('span', { class: 'v-compass-light', 'data-q': 'unknown' });
  const elQuality = h('span', { class: 'v-compass-qtext' });
  const elLevelFill = h('span', { class: 'v-compass-level-fill' });
  const elLevelText = h('span', { class: 'v-compass-level-text faint' });
  const elLevel = h('div', { class: 'v-compass-level hidden' },
    h('span', { class: 'v-compass-level-label' }, '水平'),
    h('span', { class: 'v-compass-level-track', role: 'img', 'aria-label': '手機傾斜程度' }, elLevelFill, h('span', { class: 'v-compass-level-mark' })),
    elLevelText);
  const elQualRow = h('div', { class: 'v-compass-qual hidden' }, elLight, elQuality, elLevel);
  const elQualWhy = h('p', { class: 'v-compass-qwhy hidden' });
  const elMsg = h('p', { class: 'v-compass-msg hidden', role: 'status', 'aria-live': 'polite' });
  const RING_C = 2 * Math.PI * 9;
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('viewBox', '0 0 24 24');
  ringSvg.setAttribute('aria-hidden', 'true');
  ringSvg.classList.add('v-compass-ring');
  const ringTrack = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: '12', cy: '12', r: '9', fill: 'none', 'stroke-width': '2.6', class: 'v-compass-ring-track' })) ringTrack.setAttribute(k, v);
  const ringBarSvg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [k, v] of Object.entries({ cx: '12', cy: '12', r: '9', fill: 'none', 'stroke-width': '2.6', 'stroke-linecap': 'round', class: 'v-compass-ring-bar', 'stroke-dasharray': String(RING_C), 'stroke-dashoffset': String(RING_C) })) ringBarSvg.setAttribute(k, v);
  ringSvg.append(ringTrack, ringBarSvg);
  const elLockLabel = h('span', null, '鎖定讀數');
  const btnLock = h('button', { class: 'btn btn-block hidden', type: 'button' }, ringSvg, elLockLabel);
  const btnResume = h('button', { class: 'btn btn-ghost btn-block hidden', type: 'button' }, icons ? h('span', { html: icons.compass }) : null, '重新跟著手機轉');
  const elLockNote = h('p', { class: 'v-compass-locknote hidden', role: 'status', 'aria-live': 'polite' });
  const btnAccuracy = h('button', { class: 'btn btn-ghost btn-sm v-compass-acchelp', type: 'button' }, h('span', { html: icons.info }), '手機指北針準嗎?');

  const sensorCard = h('section', { class: 'card v-compass-sensor', 'aria-label': '手機指北針' },
    h('div', { class: 'card-title' }, '用手機的指北針'),
    btnSensor, elMsg, elQualRow, elQualWhy, btnLock, elLockNote, btnResume, btnAccuracy);

  // 手動微調
  const btnMinus = h('button', { class: 'btn', type: 'button', 'aria-label': '讀數減 0.5 度' }, h('span', { html: icons.minus }), '0.5°');
  const btnPlus = h('button', { class: 'btn', type: 'button', 'aria-label': '讀數加 0.5 度' }, h('span', { html: icons.plus }), '0.5°');
  const inputDeg = h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': '輸入度數(0 到 359.9)', class: 'v-compass-input', enterkeyhint: 'done', maxlength: '12',
  });
  const elInputMsg = h('div', { class: 'v-compass-inputmsg hint hidden', role: 'alert' });
  const segFacing = h('button', { type: 'button', 'aria-pressed': 'true' }, '量的是向');
  const segSit = h('button', { type: 'button', 'aria-pressed': 'false' }, '量的是坐');
  const manualCard = h('section', { class: 'card v-compass-manual', 'aria-label': '手動微調' },
    h('div', { class: 'card-title' }, '手動微調'),
    h('div', { class: 'v-compass-steprow' }, btnMinus,
      h('div', { class: 'field' }, h('label', { class: 'sr-only', for: 'v-compass-deg' }, '度數'), inputDeg),
      btnPlus),
    elInputMsg,
    h('div', { class: 'field' },
      h('span', { class: 'label' }, '紅線對準的是'),
      h('div', { class: 'seg', role: 'group', 'aria-label': '量的是向還是坐' }, segFacing, segSit),
      h('span', { class: 'hint' }, '量「坐」(背對的那一面)時,程式會自動換算成向。')));
  inputDeg.id = 'v-compass-deg';

  // 已存與主動作
  const elSavedText = h('span');
  const btnNext = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '接著填住宅資料', h('span', { html: icons.chevron }));
  const elSaved = h('div', { class: 'callout v-compass-saved hidden' }, elSavedText, ' ', btnNext);
  const btnUse = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '用這個朝向');
  const btnHow = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, h('span', { html: icons.info }), '怎麼量?');
  const cta = h('div', { class: 'sticky-cta' }, btnUse);

  root.append(h('div', { class: 'stack v-compass' },
    readBox,
    stage,
    h('p', { class: 'v-compass-legend faint', 'aria-hidden': 'true' }, '金底是陽山、黑底是陰山;紅線對準的字就是讀數。'),
    sensorCard,
    manualCard,
    elSaved,
    cta,
    h('div', { class: 'row', style: { justifyContent: 'center' } }, btnHow)));

  // ── 盤面 ──
  let drawn = { size: 0, dpr: 0, scheme: '' };
  const stageSize = () => Math.round(stage.clientWidth) || 0;

  function applyNeedle() {
    const g = needleHost.querySelector('.v-compass-needle');
    if (!g) return;
    const rot = needleRotation(basis);
    const c = stageSize() / 2;
    g.setAttribute('transform', `rotate(${rot} ${c} ${c})`);
  }
  function redrawOverlay() {
    const size = stageSize();
    if (size > 0) drawOverlay(overlayCanvas, size, { measure: st.measure });
  }
  function redrawDial(force = false) {
    const size = stageSize();
    if (size <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const scheme = schemeNow();
    if (!force && drawn.size === size && drawn.dpr === dpr && drawn.scheme === scheme) return;
    drawn = { size, dpr, scheme };
    drawDial(discCanvas, size, { yinyangScheme: scheme });
    needleHost.innerHTML = needleMarkup(size);
    applyNeedle();
    redrawOverlay();
  }

  let smoothCss = false;
  function writeTransform(smooth) {
    if (smooth !== smoothCss) {
      rotator.style.transition = smooth && !reduced() ? 'transform 90ms linear' : 'none';
      smoothCss = smooth;
    }
    rotator.style.transform = `rotate(${st.dial}deg)`;
  }

  // ── 讀數 ──
  let frame = 0;
  let liveTimer = 0;
  let lastLiveText = '';
  // 動畫幀優先;分頁在背景時動畫幀會停,所以另掛一個短計時器保底,讀數才不會過期
  let frameTimer = 0;
  const scheduleReadout = () => {
    if (frame || destroyed) return;
    const run = () => {
      cancelAnimationFrame(frame);
      clearTimeout(frameTimer);
      frame = 0;
      frameTimer = 0;
      renderReadout();
    };
    frame = requestAnimationFrame(run);
    frameTimer = setTimeout(run, 90);
  };
  onCleanup(() => { if (frame) cancelAnimationFrame(frame); clearTimeout(frameTimer); clearTimeout(liveTimer); });

  /** 紅線下目前要採用的方位: 感測器即時值取整數度,其餘取 0.1 度 */
  function currentMeasured() {
    const hd = headingFromDialAngle(st.dial);
    if (st.origin === 'sensor' && !st.lock) return roundInt(hd);
    return round1(hd);
  }

  let model = null;
  function renderReadout() {
    if (destroyed) return;
    const measured = currentMeasured();
    const last = lastReading;
    model = buildReadoutModel({
      heading: measured,
      measure: st.measure,
      settings: settingsNow(),
      basis,
      sigmaDeg: st.sensor.phase === 'running' && last ? last.sigmaDeg : null,
      accuracyDeg: st.sensor.phase === 'running' && last && isNum(last.accuracyDeg) ? last.accuracyDeg : null,
      hintDeclination: safeHintDeclination(),
    });
    const m = model;
    const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
    const following = st.origin === 'sensor' && !st.lock && st.sensor.following && st.sensor.phase === 'running';
    setText(elPlain, plainReadoutText(m, { following }));
    setText(elLbl, m.primary);
    setText(elBig, `${st.origin === 'sensor' && !st.lock ? String(Math.round(m.heading)) : m.degText}°`);
    setText(elMount, `${m.mountain}山(${m.gua}宮 · ${m.dragon})`);
    setText(elSit, `${m.secondary} ${m.opposite}`);
    if (st.measure === 'sit') {
      elConv.classList.remove('hidden');
      setText(elConv, `換算成宅向 ${fmtDeg(m.facingBearing)}°(${m.facingMountain}山)`);
    } else {
      elConv.classList.add('hidden');
    }
    // 徽章
    const badges = [];
    badges.push(h('button', {
      class: 'chip v-compass-north', type: 'button',
      'aria-label': `目前用${basis.trueMode ? '真北' : '磁北'}。點一下換成${basis.trueMode ? '磁北' : '真北'}`,
      onclick: toggleNorth,
    }, basis.trueMode ? '真北' : '磁北'));
    if (m.lean) badges.push(h('span', { class: 'badge badge--info' }, `兼${m.lean}`));
    if (m.onLine) badges.push(h('span', { class: 'badge badge--warn' }, '壓在分界線上,建議重測'));
    else if (m.near) badges.push(h('span', { class: 'badge badge--warn' }, m.near8 ? HINTS.nearBoundary : NEAR_FINE_ONLY));
    const sig = badges.map((b) => b.textContent).join('|');
    if (elBadges.dataset.sig !== sig) {
      elBadges.dataset.sig = sig;
      elBadges.replaceChildren(...badges);
    }
    if (m.alt) {
      elAlt.classList.remove('hidden');
      setText(elAlt, `換成${m.alt.label}會變成「${m.alt.mountain}」山`);
    } else {
      elAlt.classList.add('hidden');
    }
    setText(elHelp, m.help);
    stage.setAttribute('aria-valuenow', String(Math.round(m.heading)));
    stage.setAttribute('aria-valuetext', m.text);
    if (document.activeElement !== inputDeg) inputDeg.value = fmtInput(m.heading);
    // 螢幕閱讀器只在停手後念一次,避免拖曳時連珠炮
    if (m.text !== lastLiveText) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { lastLiveText = m.text; setText(elLive, m.text); }, 350);
    }
    renderCta();
  }

  function safeHintDeclination() {
    try { return geo.declinationFor('台北', Date.now()); } catch { return null; }
  }

  // ── 盤角更新的唯一入口 ──
  function setDial(deg, { from = 'user', smooth = false } = {}) {
    if (!isNum(deg)) return;
    st.dial = deg;
    writeTransform(smooth);
    if (from === 'user') {
      st.origin = 'manual';
      st.lock = null;
      st.dirty = true;
      st.sensor.lockNote = '';
    }
    if (from === 'user' || from === 'sensor') {
      const hd = headingFromDialAngle(deg);
      if (from === 'user' && lastHeading != null && boundaryCrossings(lastHeading, hd) > 0) {
        try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(8); } catch { /* 沒有震動硬體 */ }
      }
      lastHeading = hd;
    } else {
      lastHeading = headingFromDialAngle(deg);
    }
    scheduleReadout();
  }

  /** 把紅線轉到指定方位(目前北基準),走最短路徑 */
  function setHeading(target, opts) {
    gesture.cancel();
    setDial(dialAngleToward(st.dial, target), opts);
  }

  // ── 手勢 ──
  const gesture = createDialGesture({
    getGeometry: () => {
      const r = stage.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radiusPx: stageGeo().R };
    },
    getDial: () => st.dial,
    setDial: (deg) => setDial(deg, { from: 'user' }),
    onStart: () => pauseSensor(),
    onSettle: () => scheduleReadout(),
    reducedMotion: reduced,
  });
  function stageGeo() {
    // 與 luopanRenderer.stageGeometry 同算法: 環面外半徑 = 盤緣外半徑 - 盤緣寬
    const size = stage.clientWidth || 1;
    const Rb = size / 2 - 15;
    return { R: Rb - Math.max(6, Rb * 0.055) };
  }
  const unbindGesture = bindDialGestures(stage, gesture);
  onCleanup(() => { unbindGesture(); gesture.destroy(); });

  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1;
    if (!dir) return;
    e.preventDefault();
    pauseSensor();
    setHeading(norm(round1(currentMeasured()) + dir * step), { from: 'user' });
  });

  // ── 手動輸入 ──
  const INPUT_MSG = { empty: '請輸入 0 到 359.9 之間的數字', nan: '只能輸入數字,例如 175 或 175.5', range: '度數要在 0 到 359.9 之間' };
  function showInputMsg(text) {
    elInputMsg.textContent = text || '';
    elInputMsg.classList.toggle('hidden', !text);
    inputDeg.setAttribute('aria-invalid', text ? 'true' : 'false');
  }
  function commitTyped() {
    const res = parseBearingInput(inputDeg.value);
    if (!res.ok) {
      showInputMsg(INPUT_MSG[res.reason]);
      inputDeg.value = fmtInput(currentMeasured());
      return;
    }
    showInputMsg('');
    pauseSensor();
    setHeading(res.value, { from: 'user' });
    inputDeg.value = fmtInput(res.value); // 貼上的「175°」「１７５」整理成乾淨數字
  }
  inputDeg.addEventListener('change', commitTyped);
  inputDeg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTyped(); inputDeg.blur(); } });
  inputDeg.addEventListener('focus', () => inputDeg.select());
  inputDeg.addEventListener('input', () => { if (elInputMsg.textContent) showInputMsg(''); });

  const step = (dir) => {
    pauseSensor();
    showInputMsg('');
    setHeading(stepHeading(currentMeasured(), dir), { from: 'user' });
  };
  btnMinus.addEventListener('click', () => step(-1));
  btnPlus.addEventListener('click', () => step(1));

  function setMeasure(m) {
    if (st.measure === m) return;
    st.measure = m;
    segFacing.setAttribute('aria-pressed', String(m === 'facing'));
    segSit.setAttribute('aria-pressed', String(m === 'sit'));
    redrawOverlay();
    scheduleReadout();
  }
  segFacing.addEventListener('click', () => setMeasure('facing'));
  segSit.addEventListener('click', () => setMeasure('sit'));

  // ── 北基準 ──
  function toggleNorth() {
    const wantsTrue = !basis.wantsTrue;
    store.update((d) => {
      d.settings.northMode = wantsTrue ? 'true' : 'magnetic';
      // 預設城市代碼不在磁偏角表裡時,補上台北,否則「真北」不會生效
      if (wantsTrue) {
        try { geo.declinationFor(d.facing.cityId, Date.now()); } catch { d.facing.cityId = '台北'; }
      }
    });
  }
  /** 北基準或城市改變: 磁方位讀數不變,重算盤面顯示的方位並轉過去 */
  function syncBasis() {
    const next = basisOf(store.get());
    if (next.trueMode === basis.trueMode && next.declination === basis.declination && next.wantsTrue === basis.wantsTrue) return;
    const rawMeasured = rawFromDisplayed(headingFromDialAngle(st.dial), basis);
    basis = next;
    applyNeedle();
    setHeading(displayedFromRaw(rawMeasured, basis), { from: 'sync' });
  }

  // ── 感測器 ──
  function pauseSensor() {
    if (st.sensor.following === false) return;
    if (st.sensor.phase === 'running' || st.sensor.phase === 'waiting') {
      st.sensor.following = false;
      renderSensor();
    }
  }
  function stopSource() {
    if (source) { try { source.stop(); } catch { /* 已停 */ } }
    source = null;
    lastReading = null;
  }
  function failSensor(message) {
    stopSource();
    st.sensor.phase = 'failed';
    st.sensor.message = message;
    st.sensor.lockBusy = false;
    stopProgress();
    renderSensor();
  }
  let sensorTimer = 0;
  function scheduleSensorRender() {
    if (sensorTimer || destroyed) return;
    sensorTimer = setTimeout(() => { sensorTimer = 0; renderSensor(); }, 60);
  }
  onCleanup(() => clearTimeout(sensorTimer));
  function onStatus(status) {
    if (destroyed) return;
    if (status === 'running') {
      if (st.sensor.phase === 'waiting' || st.sensor.phase === 'starting') st.sensor.phase = 'running';
      if (st.sensor.phase === 'running') st.sensor.message = '';
      renderSensor();
      return;
    }
    if (status === 'no-events') {
      st.sensor.phase = 'waiting';
      st.sensor.message = sensorMessage('no-events');
      renderSensor();
      return;
    }
    // permission-denied / permission-error / unsupported / insecure-context
    // iOS 按過「不允許」後不會再彈窗,要教使用者怎麼恢復(只加在畫面上,不動規格逐字訊息)
    const denied = status === 'permission-denied' || status === 'permission-error';
    failSensor(denied
      ? `${sensorMessage(status)}${DENIED_HELP}`
      : (sensorMessage(status) || sensorMessage('no-events')));
  }
  let relativeCount = 0;
  const RELATIVE_FAIL_AFTER = 10;
  function onReading(r) {
    if (destroyed) return;
    lastReading = r;
    if (r.status !== 'relative-not-north') relativeCount = 0;
    if (r.status === 'ok' && isNum(r.smoothedDeg)) {
      if (st.sensor.phase !== 'running') { st.sensor.phase = 'running'; st.sensor.message = ''; }
      // 提示優先序: 螢幕朝下 > 太傾斜 > 訊號紅燈(禁止鎖定的原因要讓人看得懂)
      st.sensor.message = r.faceDown ? HINTS.faceDown
        : isNum(r.tiltDeg) && r.tiltDeg >= 15 ? sensorMessage('tilt-too-large')
          : r.quality === 'red' ? HINTS.calibrate : '';
      if (st.sensor.following && !gesture.isDragging()) {
        st.origin = 'sensor';
        setDial(dialAngleToward(st.dial, displayedFromRaw(r.smoothedDeg, basis)), { from: 'sensor', smooth: true });
      }
    } else if (r.status === 'relative-not-north') {
      // 剛授權後最初幾筆事件可能還沒帶指北值,連續多筆才判定這台裝置給不出北
      relativeCount += 1;
      if (relativeCount >= RELATIVE_FAIL_AFTER) {
        failSensor(sensorMessage('relative-not-north'));
        return;
      }
    } else if (r.status === 'no-sensor') {
      st.sensor.phase = 'waiting';
      st.sensor.message = sensorMessage('no-events');
    } else {
      // uncalibrated / invalid / tilt-too-large / degenerate: 顯示訊息,盤面停在最後一個好讀數
      st.sensor.message = sensorMessage(r.status) || '';
    }
    scheduleSensorRender();
  }

  function startSensor() {
    if (!supported) return;
    stopSource();
    gesture.cancel(); // 慣性還在轉時,以指北針為準
    st.sensor.phase = 'starting';
    st.sensor.message = '';
    st.sensor.following = true;
    st.lock = null;
    st.sensor.lockNote = '';
    renderSensor();
    const s = settingsNow();
    const opts = {};
    if (isNum(s.lockSeconds)) opts.lockSeconds = s.lockSeconds;
    if (isNum(s.measureUncertainty)) opts.measureUncertainty = s.measureUncertainty;
    try {
      source = createCompassSource({ env: createBrowserEnv(window), onReading, onStatus, settings: opts });
    } catch (e) {
      failSensor(sensorMessage('unsupported'));
      return;
    }
    // 必須在點擊事件裡同步呼叫 start(),iOS 才肯彈出權限視窗
    const mine = source;
    mine.start().then((res) => {
      if (destroyed || source !== mine) return;
      if (res && res.ok) {
        if (st.sensor.phase === 'starting') st.sensor.phase = 'running';
        renderSensor();
      } else if (res && res.status && res.status !== 'cancelled') {
        onStatus(res.status);
      }
    }).catch(() => { if (!destroyed && source === mine) failSensor(sensorMessage('permission-error')); });
  }
  function stopSensorUser() {
    stopSource();
    stopProgress();
    st.sensor = { phase: 'idle', message: '', following: true, lockBusy: false, lockNote: '' };
    if (st.origin === 'sensor') st.origin = 'manual';
    writeTransform(false);
    renderSensor();
    scheduleReadout();
  }

  btnSensor.addEventListener('click', () => {
    const p = st.sensor.phase;
    if (p === 'running' || p === 'waiting') stopSensorUser();
    else if (p === 'idle' || p === 'failed') startSensor();
  });
  btnResume.addEventListener('click', () => {
    gesture.cancel();
    st.sensor.following = true;
    st.sensor.lockNote = '';
    st.lock = null;
    st.origin = 'sensor';
    if (lastReading && lastReading.status === 'ok' && isNum(lastReading.smoothedDeg)) {
      setDial(dialAngleToward(st.dial, displayedFromRaw(lastReading.smoothedDeg, basis)), { from: 'sensor', smooth: true });
    }
    renderSensor();
    scheduleReadout();
  });

  // 鎖定讀數 + 進度環
  let progTimer = 0;
  function stopProgress() {
    clearInterval(progTimer);
    progTimer = 0;
    ringBarSvg.setAttribute('stroke-dashoffset', String(RING_C));
  }
  function startProgress(ms) {
    const t0 = performance.now();
    clearInterval(progTimer);
    // 用計時器而不是動畫幀: 分頁在背景時進度文字也要照常更新
    progTimer = setInterval(() => {
      if (destroyed || !st.sensor.lockBusy) { stopProgress(); return; }
      const p = Math.min(1, (performance.now() - t0) / ms);
      if (!reduced()) ringBarSvg.setAttribute('stroke-dashoffset', String(RING_C * (1 - p)));
      elLockLabel.textContent = `鎖定中… ${Math.max(0, Math.ceil((ms * (1 - p)) / 1000))} 秒`;
    }, 50);
  }
  btnLock.addEventListener('click', async () => {
    if (!source || st.sensor.lockBusy) return;
    const gate = lockAllowed(source.getLastReading());
    if (!gate.allowed) {
      st.sensor.lockNote = lockBlockedMessage(gate.reason);
      renderSensor();
      return;
    }
    // 鎖定期間盤面照樣跟著轉,結束後才停在平均值
    st.sensor.following = true;
    st.sensor.lockBusy = true;
    st.sensor.lockNote = '';
    const seconds = isNum(settingsNow().lockSeconds) ? settingsNow().lockSeconds : 3;
    renderSensor();
    startProgress(seconds * 1000);
    let res;
    const mine = source;
    try { res = await mine.lock(); } catch { res = { status: 'cancelled' }; }
    if (destroyed) return;
    st.sensor.lockBusy = false;
    stopProgress();
    elLockLabel.textContent = '鎖定讀數';
    if (res.status === 'blocked') {
      st.sensor.lockNote = lockBlockedMessage(res.reason);
    } else if (res.status === 'too-few') {
      st.sensor.lockNote = sensorMessage('too-few');
    } else if ((res.status === 'ok' || res.status === 'unstable') && isNum(res.meanDeg) && isNum(res.displayDeg)) {
      st.sensor.following = false;
      st.origin = 'sensor';
      st.lock = { sigma: res.stdDeg, lockedAtMs: res.lockedAtMs, unstable: res.status === 'unstable', accuracyDeg: res.accuracyDeg };
      setDial(dialAngleToward(st.dial, displayedFromRaw(res.displayDeg, basis)), { from: 'sync' });
      st.origin = 'sensor';
      st.sensor.lockNote = lockNoteText({
        status: res.status,
        displayedDeg: displayedFromRaw(res.displayDeg, basis),
        sigmaDeg: res.stdDeg,
        uncertaintyDeg: res.uncertaintyDeg,
        measureUncertainty: settingsNow().measureUncertainty,
        unstableText: sensorMessage('unstable'),
      });
    }
    renderSensor();
    scheduleReadout();
  });

  function renderSensor() {
    if (destroyed) return;
    const p = st.sensor.phase;
    const active = p === 'running' || p === 'waiting';
    // 主按鈕
    btnSensor.disabled = p === 'starting' || (!supported && p === 'idle');
    btnSensor.className = `btn btn-block ${active ? 'btn-ghost' : 'btn-accent'}`.trim();
    const label = p === 'starting' ? '啟用中…' : active ? '停用指北針' : p === 'failed' ? '再試一次' : '使用手機指北針';
    if (btnSensor.dataset.label !== label) {
      btnSensor.dataset.label = label;
      btnSensor.replaceChildren(h('span', { html: icons.phone }), label);
    }
    // 訊息
    let msg = st.sensor.message;
    let showMsg = Boolean(msg);
    if (!supported && p === 'idle') { msg = `這台裝置沒有指北針,${SENSOR_FALLBACK_HINT}`; showMsg = true; }
    else if (p === 'idle') { msg = '手機放平、頂端朝向前方,按下按鈕後盤面會跟著手機轉。紅線對到的就是手機頂端指的方向。'; showMsg = true; }
    else if (p === 'waiting' || p === 'failed') msg = `${msg},${SENSOR_FALLBACK_HINT}`;
    elMsg.textContent = msg;
    elMsg.classList.toggle('hidden', !showMsg);
    elMsg.classList.toggle('v-compass-msg--warn', p === 'waiting' || p === 'failed' || (p === 'running' && Boolean(st.sensor.message)));
    // 品質 + 水平
    elQualRow.classList.toggle('hidden', p !== 'running');
    elQualWhy.classList.toggle('hidden', p !== 'running');
    if (p === 'running') {
      // 燈號與 reading.quality 同一套門檻(qualityLight),另外講出白話原因
      const av = accuracyView(lastReading);
      elLight.dataset.q = av.level;
      elQuality.textContent = av.label;
      if (elQualWhy.textContent !== av.reason) elQualWhy.textContent = av.reason;
      const tilt = lastReading && isNum(lastReading.tiltDeg) ? lastReading.tiltDeg : null;
      elLevel.classList.toggle('hidden', tilt == null);
      if (tilt != null) {
        elLevelFill.style.width = `${Math.min(100, (tilt / 30) * 100)}%`;
        elLevel.dataset.ok = tilt < 15 ? '1' : '0';
        elLevelText.textContent = `傾斜 ${Math.round(tilt)}°${tilt < 15 ? '' : ',請放平'}`;
      }
    }
    // 鎖定與「重新跟著手機轉」
    btnLock.classList.toggle('hidden', p !== 'running');
    if (p === 'running') {
      const gate = lockAllowed(lastReading);
      btnLock.disabled = st.sensor.lockBusy || !gate.allowed;
      btnLock.setAttribute('aria-disabled', String(btnLock.disabled));
      if (!st.sensor.lockBusy) elLockLabel.textContent = '鎖定讀數';
    }
    btnResume.classList.toggle('hidden', !(active && !st.sensor.following && !st.sensor.lockBusy));
    // 鎖定結果還沒存進朝向時,提醒要再按存檔鈕
    const unsaved = st.lock && st.origin === 'sensor' && st.lock.lockedAtMs !== savedLockAt
      ? UNSAVED_LOCK_HINT.replace('{btn}', btnUse.textContent || '用這個朝向')
      : '';
    const note = [st.sensor.lockNote, st.sensor.lockNote ? unsaved : ''].filter(Boolean).join(' ');
    elLockNote.textContent = note;
    elLockNote.classList.toggle('hidden', !note);
    stage.classList.toggle('v-compass-following', active && st.sensor.following);
    // 白話行的「手機頂端正對著 / 紅線指著」跟著感測器狀態換
    scheduleReadout();
  }

  // ── 已存的朝向與主動作 ──
  function renderSaved() {
    const raw = savedBearingOf(store.get());
    if (raw == null) {
      elSaved.classList.add('hidden');
      return;
    }
    const disp = displayedFromRaw(raw, basis);
    let name = '';
    try { name = readout(disp, settingsNow()).mountain; } catch { try { name = readout(disp, {}).mountain; } catch { name = ''; } }
    elSavedText.textContent = `目前已設定:向 ${fmtDeg(disp)}°${name ? `(${name}山)` : ''}`;
    elSaved.classList.remove('hidden');
  }
  function renderCta() {
    btnUse.textContent = savedBearingOf(store.get()) != null ? '更新朝向' : '用這個朝向';
  }
  btnUse.addEventListener('click', () => {
    const patch = buildFacingPatch({ measured: currentMeasured(), measure: st.measure, basis, origin: st.origin, lock: st.lock });
    if (!patch) { toast('讀數無效,請重新量測'); return; }
    lastSavedRaw = patch.bearing;
    store.update((d) => {
      d.facing.bearing = patch.bearing;
      d.facing.source = patch.source;
      d.facing.sigma = patch.sigma;
      d.facing.lockedAtMs = patch.lockedAtMs;
      d.facing.check = facingCheckFromLock(patch, st.lock);
    });
    st.dirty = false;
    savedLockAt = st.lock ? st.lock.lockedAtMs : null;
    toast('已設為宅向');
    renderSaved();
    renderCta();
    renderSensor();
  });
  btnNext.addEventListener('click', () => ctx.go('house'));
  btnAccuracy.addEventListener('click', () => openCompassHelp(ctx, store.get()));
  btnHow.addEventListener('click', () => {
    openSheet({
      title: '怎麼量朝向?',
      content: h('div', { class: 'stack v-compass-how' },
        h('ol', { class: 'v-compass-howlist' }, HOW_TO.map(([t, body]) => h('li', null, h('strong', null, t), ':', body))),
        h('p', { class: 'faint' }, SANYUAN_HELP)),
    });
  });

  // ── store 訂閱: 外部改了朝向、北基準、主題時同步 ──
  let lastTheme = store.get().ui.theme;
  const unsub = store.subscribe((s) => {
    if (destroyed) return;
    syncBasis();
    const saved = savedBearingOf(s);
    if (saved !== lastSavedRaw) {
      lastSavedRaw = saved;
      // 別處(例如住宅頁)改了朝向;使用者還沒動過盤面時跟著轉
      if (saved != null && !st.dirty && st.sensor.phase !== 'running') setHeading(displayedFromRaw(saved, basis), { from: 'sync' });
    }
    if (s.ui.theme !== lastTheme) {
      lastTheme = s.ui.theme;
      requestAnimationFrame(() => { if (!destroyed) redrawOverlay(); });
    }
    if (drawn.scheme && drawn.scheme !== schemeNow()) redrawDial(true);
    renderSaved();
    renderCta();
    scheduleReadout();
  });
  onCleanup(unsub);

  // ── 尺寸與主題變化 ──
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf || destroyed) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; redrawDial(false); });
  };
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(stage); }
  window.addEventListener('resize', onResize);
  const schemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => redrawOverlay();
  if (schemeQuery && schemeQuery.addEventListener) schemeQuery.addEventListener('change', onScheme);
  onCleanup(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onResize);
    if (schemeQuery && schemeQuery.removeEventListener) schemeQuery.removeEventListener('change', onScheme);
  });

  // ── 初始值 ──
  const saved0 = savedBearingOf(store.get());
  if (saved0 != null) {
    st.dial = -displayedFromRaw(saved0, basis);
    lastHeading = headingFromDialAngle(st.dial);
  }
  writeTransform(false);
  renderSensor();
  renderSaved();
  renderReadout();

  // 先用現有字型畫一次,字型載入完成後再畫一次;不阻塞 mount,切走分頁時才不會漏掉 destroy
  redrawDial(true);
  ensureFonts().then(() => { if (!destroyed) redrawDial(true); });

  return {
    destroy() {
      destroyed = true;
      stopSource();
      stopProgress();
      for (const fn of cleanups.splice(0).reverse()) {
        try { fn(); } catch (e) { console.error('compass cleanup', e); }
      }
    },
  };
}

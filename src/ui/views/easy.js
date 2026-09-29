// 簡單模式(docs/EASY_SPEC.md 第 4、5、9 節):三步驟「量方向 → 選格局 → 看財位」。
// 判斷與文字全部來自純函式與文字表(easy/*、sensorText.js、copy.js)、views/wealth.js 的模型;
// 這裡只負責組裝畫面、接感測器、寫入 store。畫面上的中文一律不寫在本檔。
import { h, clear } from '../dom.js';
import { basisOf, displayedFromRaw, roundTenth } from '../basis.js';
import { EASY_TEXT, fillText } from '../easy/text.js';
import { EASY_STEPS, resumeStep, nextHint, parseYearLoose } from '../easy/flow.js';
import { plainDirection, sectorOf8, bearingOfDir8, uncertaintyFor, eightImpact } from '../easy/direction.js';
import { combineChecks, checkVerdictText, easyFacingPatch, facingCheckOf, fmtSmall } from '../easy/measure.js';
import { withDoorSide, isUntouchedTemplate, placeText, DOOR_SIDES } from '../easy/layout.js';
import { wealthStability, sameTopForPlans } from '../easy/stability.js';
import { easyResultParts } from '../easy/result.js';
import { facingUncertaintyOf } from '../store.js';
import { planPreviewSvg, directionDiagramSvg } from '../easy/svg.js';
import { mountDirDial } from '../components/dirDial.js';
import { openCompassHelp } from '../components/compassHelp.js';
import { createSensorSession } from '../sensorSession.js';
import { accuracyView, postureHint, lockBlockedMessage, sensorSupported, inAppBrowserName } from '../sensorText.js';
import { createBrowserEnv } from '../../core/sensor.js';
import { SENSOR_DEFAULTS } from '../../core/sensor-core.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';
import { DIR8, circularDiff } from '../../core/geo.js';
import {
  renderReport, renderEasySummary, renderDirectionImpact, renderStabilityNote,
  EASY_PICK8_NOTE, EASY_DOOR_WHY, EASY_DOOR_SAME, EASY_DISCLAIMERS, CARD_DISCLAIMER,
} from '../../core/copy.js';
import { parseBearingInput } from './compass.js';
import { safeReport, buildWealthModel, TIER_LABEL, TIER_BADGE } from './wealth.js';
import { mountMiniPlan } from '../canvas/miniPlan.js';
import { TEMPLATES, buildTemplate } from '../plan/templates.js';

const T = EASY_TEXT;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
/** 3×3 方位格(上北下南,跟地圖一樣):geo.DIR8 的索引,null 是中間「你家」 */
const GRID8 = Object.freeze([7, 0, 1, 6, null, 2, 5, 4, 3]);
/** 感測器還沒開始就被判斷「這台裝置沒有指北針」時的原因碼(畫面內部用) */
const NO_SENSOR_API = 'no-sensor-api';
const STEP_NAME = Object.freeze({ facing: 'steps.facing', layout: 'steps.layout', result: 'steps.result' });

export async function mount(root, ctx) {
  const { store } = ctx;
  const win = typeof window !== 'undefined' ? window : null;
  const hasSensorApi = Boolean(win) && sensorSupported(win);
  const reduced = Boolean(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let destroyed = false;
  let step = resumeStep(store.get());
  let sub = null; // 步驟 1 的子畫面:'1A' | '1B' | '1D' | '1M' | '1S'(1C = 1B 且 locking)
  let readings = [];
  let check = null;
  let session = null;
  let wantSensor = false;
  let locking = false;
  let lockStartMs = 0;
  let lockTimer = 0;
  let lockMsg = '';
  let lockMsgGate = false; // lockMsg 是「姿勢不對、還不能記下」:姿勢恢復後自動清掉
  let failStatus = null;
  let failMessage = '';
  // 1M 的選擇(畫面內狀態,重畫時保留)
  let mPick = null;
  let mTyped = null;
  let mText = '';
  let mErr = null;
  // 步驟 3
  let yearText = '';
  let showingId = null;
  let appliedToastShown = false;
  // DOM 實例與計時器
  let dial = null;
  let mini = null;
  let liveRaf = 0;
  let announceTimer = 0;
  let announceKey = '';
  let refs = {};
  let lastKey = '';
  let renderCount = 0;
  let pendingFocusTitle = false;

  const view = h('div', { class: 'stack v-easy' });
  root.append(view);

  const keyOf = (s) => JSON.stringify([s.facing, s.plan, s.building && s.building.builtYear, s.residents.length, s.settings, s.ui.easyStep]);
  const basisNow = () => { try { return basisOf(store.get()); } catch { return { trueMode: false, declination: null }; } };
  const muOf = (s) => (isNum(s.settings.measureUncertainty) ? s.settings.measureUncertainty : DEFAULT_SETTINGS.measureUncertainty);
  const displayedFacing = (s) => (isNum(s.facing.bearing) ? displayedFromRaw(s.facing.bearing, basisNow()) : null);
  /** 與 store.input() 送進引擎的是同一個 U(含 iPhone 估計誤差;自己選的 8 方位是半格寬) */
  const savedUncertainty = (s) => {
    const u = facingUncertaintyOf(s);
    return isNum(u) ? u : uncertaintyFor({ measureUncertainty: muOf(s) });
  };
  /** 大門朝向:完整功能另外設了大門方向就用它(八宅也是看大門),否則就是宅向 */
  const doorRawOf = (s) => (isNum(s.facing.doorBearing) ? s.facing.doorBearing : s.facing.bearing);
  const doorDisplayed = (s) => (isNum(doorRawOf(s)) ? displayedFromRaw(doorRawOf(s), basisNow()) : null);
  const hasSeparateDoor = (s) => isNum(s.facing.doorBearing) && isNum(s.facing.bearing) && circularDiff(s.facing.doorBearing, s.facing.bearing) >= 0.05;
  /** 已存朝向的來源:手機量的 / 自己輸入度數(含完整功能輸入的)/ 自己選 8 方位 */
  const originOf = (f) => (f.source === 'pick8' ? 'pick8' : f.source === 'sensor' ? 'sensor' : 'typed');
  /** 大字方位:平常只講「南方」;接近分界時才加括號說偏向哪邊 */
  const dirText = (pd, near) => (near ? pd.text : fillText('common.dir', { dir: pd.dir8 }));
  /**
   * 「方向差 U 度,排第一的財位會不會換」(沒有平面圖時先不判斷,回 null)。
   * rawBearing 是宅向(磁北);state 可以是試算用的草稿(例如還沒存的量測結果)。
   */
  const wealthImpact = (s, rawBearing, U) => {
    if (!s.plan || !isNum(rawBearing)) return null;
    const st = wealthStability(s, rawBearing, U);
    if (st.status === 'stable') return { status: 'stable', u: st.u };
    if (st.status !== 'changes') return null;
    if (st.change === 'tier') return { status: 'changes', change: 'tier', from: TIER_LABEL[st.center.tier], to: TIER_LABEL[st.alt.tier] };
    const p = placeText(st.alt, s.plan);
    return { status: 'changes', change: 'place', place: p ? p.text : '' };
  };
  const sensorBusy = () => step === 'facing' && (sub === '1B' || sub === '1D');

  // ─────────────────────────── 感測器 ───────────────────────────

  function ensureSession() {
    if (session) return session;
    session = createSensorSession({
      env: createBrowserEnv(win),
      settings: store.get().settings,
      startLabel: T['a.start'],
      onChange: onSensor,
    });
    return session;
  }

  function stopSensor() {
    wantSensor = false;
    stopLockTimer();
    locking = false;
    if (session) session.stop();
  }

  function onSensor(state, kind) {
    if (destroyed || step !== 'facing') return;
    if (kind === 'reading') {
      if (sub === '1B') scheduleLive();
      return;
    }
    if (kind !== 'phase') return;
    if (state.phase === 'running') {
      if (sub === '1A' && wantSensor) show('1B');
    } else if (state.phase === 'starting') {
      updateStartButton();
    } else if ((state.phase === 'waiting' || state.phase === 'failed') && wantSensor && (sub === '1A' || sub === '1B')) {
      // 1.5 秒沒有事件、權限被拒、這台裝置給不出北:停掉感測器,改成自己選方向並說明原因
      failStatus = state.failStatus || 'no-events';
      failMessage = state.message || '';
      stopSensor();
      show('1M');
    }
  }

  /** 開始量:必須在點擊處理函式裡同步呼叫 session.start()(iOS 權限視窗的要求),之前不可 await 或重畫 */
  function startSensor() {
    const s = ensureSession();
    wantSensor = true;
    lockMsg = '';
    s.start();
    if (s.getState().phase === 'running') show('1B');
    else updateStartButton();
  }

  function updateStartButton() {
    const btn = refs.startBtn;
    if (!btn || !session) return;
    const starting = session.getState().phase === 'starting';
    btn.disabled = starting;
    btn.textContent = T[starting ? 'a.starting' : 'a.start'];
  }

  function scheduleLive() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(() => { liveRaf = 0; updateLive(); });
  }

  /** 1B/1C 的即時讀數(方向圈、大字、穩定度、姿勢提示),不重畫整個畫面 */
  function updateLive() {
    if (destroyed || sub !== '1B' || !session) return;
    const st = session.getState();
    const basis = basisNow();
    const disp = isNum(st.headingRaw) ? displayedFromRaw(st.headingRaw, basis) : null;
    const pd = plainDirection(disp);
    if (dial) dial.set(disp);
    if (refs.big) refs.big.textContent = pd ? fillText('common.dir', { dir: pd.dir8 }) : T['b.reading'];
    if (refs.paren) refs.paren.textContent = pd && pd.paren ? fillText('b.paren', { paren: pd.paren }) : '';
    if (refs.deg) refs.deg.textContent = pd ? fillText('b.degree', { deg: pd.deg }) : '';
    // 「請放平」這類擋下記下的訊息,姿勢恢復後就清掉,不要和目前的狀態互相矛盾
    if (lockMsgGate && lockMsg && !locking && st.gate && st.gate.allowed) {
      lockMsg = '';
      lockMsgGate = false;
      updateLockUI();
    }
    const av = accuracyView(st.reading);
    if (refs.bars) refs.bars.forEach((b, i) => b.classList.toggle('is-on', i < av.bars));
    if (refs.stab) refs.stab.dataset.level = av.level;
    if (refs.stabLabel) refs.stabLabel.textContent = av.label;
    if (refs.stabReason) refs.stabReason.textContent = av.reason;
    if (refs.posture) {
      const hint = postureHint(st.reading);
      refs.posture.textContent = hint;
      refs.posture.hidden = !hint;
    }
    // 讀屏:只在換格(方位或偏向程度改變)而且停住 350ms 後才念
    const key = pd ? `${pd.dir8}|${pd.level}` : '';
    if (key !== announceKey) {
      announceKey = key;
      clearTimeout(announceTimer);
      if (pd) {
        announceTimer = setTimeout(() => {
          if (!destroyed && refs.live) refs.live.textContent = fillText('b.live', { text: pd.text });
        }, 350);
      }
    }
  }

  function stopLockTimer() {
    clearInterval(lockTimer);
    lockTimer = 0;
  }

  function updateLockUI() {
    const btn = refs.lockBtn;
    if (btn) {
      btn.disabled = locking;
      if (locking) {
        const total = session ? session.getState().lockMs : 3000;
        const left = Math.max(0, total - (Date.now() - lockStartMs));
        btn.textContent = fillText('c.locking', { n: Math.max(1, Math.ceil(left / 1000)) });
        if (refs.progress) refs.progress.style.setProperty('--p', String(Math.min(1, 1 - left / total)));
      } else {
        btn.textContent = T['b.lock'];
      }
    }
    if (refs.progress) refs.progress.hidden = !locking || reduced;
    if (refs.lockMsg) {
      refs.lockMsg.textContent = lockMsg;
      refs.lockMsg.hidden = !lockMsg;
    }
  }

  function doLock() {
    if (!session || locking) return;
    const st = session.getState();
    if (!st.gate.allowed) {
      lockMsg = lockBlockedMessage(st.gate.reason, { startLabel: T['a.start'] });
      lockMsgGate = true;
      updateLockUI();
      return;
    }
    lockMsg = '';
    lockMsgGate = false;
    locking = true;
    lockStartMs = Date.now();
    stopLockTimer();
    // 倒數用計時器(不用動畫幀),切到背景也照走
    lockTimer = setInterval(updateLockUI, 200);
    updateLockUI();
    session.lock().then((res) => {
      if (destroyed || !locking) return;
      locking = false;
      stopLockTimer();
      if (sub !== '1B') return;
      if (!res) {
        const s2 = session.getState();
        lockMsgGate = s2.noteKey === 'blocked';
        if (s2.noteKey === 'too-few') lockMsg = T['c.tooFew'];
        else if (s2.noteKey === 'cancelled') lockMsg = T['c.cancelled'];
        else lockMsg = s2.noteReason ? lockBlockedMessage(s2.noteReason, { startLabel: T['a.start'] }) : s2.note;
        updateLockUI();
        return;
      }
      readings = [...readings, { meanDeg: res.meanDeg, sigma: res.sigma, lockedAtMs: res.lockedAtMs, status: res.status, accuracyDeg: res.accuracyDeg }].slice(-3);
      check = combineChecks(readings, store.get().settings);
      show('1D');
    });
  }

  /** 「再量」:保留 readings 回到 1B;感測器沒在跑就在這次點擊裡同步重新啟動 */
  function measureAgain() {
    const s = ensureSession();
    lockMsg = '';
    if (s.getState().phase !== 'running') {
      wantSensor = true;
      s.start();
    }
    wantSensor = true;
    show('1B');
  }

  // ─────────────────────────── 寫入 ───────────────────────────

  /** 更新 store;資料沒變(訂閱不會重畫)時自己重畫 */
  function commit(fn) {
    const before = renderCount;
    store.update(fn);
    if (renderCount === before) render();
  }

  function goStep(next, facingSub = null) {
    if (step === 'facing') { stopSensor(); readings = []; check = null; }
    step = next;
    sub = next === 'facing' ? facingSub : null;
    showingId = null;
    pendingFocusTitle = true;
    commit((d) => { d.ui.easyStep = next; });
  }

  function saveFacing({ displayedDeg, origin, lock = null, chk = null }) {
    const state = store.get();
    const patch = easyFacingPatch({ displayedDeg, basis: basisNow(), origin, lock, check: chk });
    if (!patch) return;
    const prev = clone(state.facing);
    const had = isNum(state.facing.bearing);
    stopSensor();
    readings = [];
    check = null;
    step = state.plan ? 'result' : 'layout';
    sub = null;
    pendingFocusTitle = true;
    commit((d) => { Object.assign(d.facing, patch); d.ui.easyStep = step; });
    const pd = plainDirection(displayedDeg);
    const msg = fillText('d.saved', { dir: pd ? pd.dir8 : '' });
    ctx.toast(msg, had ? { action: { label: T['common.undo'], onClick: () => store.update((d) => { d.facing = prev; }) } } : undefined);
  }

  function applyLayout(templateId, doorSide) {
    const built = buildTemplate(templateId);
    if (!built || !built.plan) return;
    const state = store.get();
    const prevPlan = state.plan ? clone(state.plan) : null;
    const prevLayout = state.ui.easyLayout ? clone(state.ui.easyLayout) : null;
    const changingTemplate = !prevLayout || prevLayout.template !== templateId;
    const res = withDoorSide(built.plan, doorSide);
    commit((d) => { d.plan = res.plan; d.ui.easyLayout = { template: templateId, doorSide: res.moved ? doorSide : 'left' }; });
    if (!res.moved) {
      ctx.toast(T['l.cantMove']);
    } else if (prevPlan && changingTemplate && !appliedToastShown) {
      appliedToastShown = true;
      const tpl = TEMPLATES.find((t) => t.id === templateId);
      ctx.toast(fillText('l.applied', { label: tpl ? tpl.label : templateId }), {
        action: { label: T['common.undo'], onClick: () => store.update((d) => { d.plan = prevPlan; d.ui.easyLayout = prevLayout; }) },
      });
    }
  }

  function skipLayout() {
    const state = store.get();
    if (state.plan && isUntouchedTemplate(state.plan, state.ui.easyLayout)) {
      const prevPlan = clone(state.plan);
      const prevLayout = clone(state.ui.easyLayout);
      store.update((d) => { d.plan = null; d.ui.easyLayout = null; });
      ctx.toast(T['l.removed'], { action: { label: T['common.undo'], onClick: () => store.update((d) => { d.plan = prevPlan; d.ui.easyLayout = prevLayout; }) } });
    }
    goStep('result');
  }

  // ─────────────────────────── 共用小元件 ───────────────────────────

  const title = (text) => h('h2', { class: 'v-easy-title', tabindex: '-1' }, text);
  const bigBtn = (text, onclick, extra = {}) => h('button', { type: 'button', class: 'btn btn-primary btn-block v-easy-big', onclick, ...extra }, text);
  const btn = (text, onclick, cls = 'btn') => h('button', { type: 'button', class: `${cls} v-easy-btn`, onclick }, text);
  const helpBtn = () => (hasSensorApi
    ? h('button', {
      type: 'button', class: 'btn btn-ghost v-easy-btn v-easy-help', 'data-fk': 'help',
      onclick: (e) => openCompassHelp(ctx, store.get(), { opener: e.currentTarget }),
    },
      h('span', { class: 'v-easy-help-i', 'aria-hidden': 'true' }, 'i'), T['a.help'])
    : null);
  const calloutOf = (icon, text, warn) => h('div', { class: warn ? 'callout warn v-easy-callout' : 'callout v-easy-callout' },
    icon ? h('span', { class: 'v-easy-icon', 'aria-hidden': 'true' }, icon) : null,
    h('span', null, text));
  /** 自我檢查結論:一致時的「整棟大樓一起偏」提醒放在同一個框裡,不要變成看不到的淡色小字 */
  const verdictCallout = (v) => h('div', { class: v.icon === '!' ? 'callout warn v-easy-callout' : 'callout v-easy-callout' },
    h('span', { class: 'v-easy-icon', 'aria-hidden': 'true' }, v.icon),
    h('div', null, h('p', { class: 'v-easy-p' }, v.text), v.systematic ? h('p', { class: 'v-easy-p v-easy-small' }, v.systematic) : null));

  function stepBar() {
    const hasFacing = isNum(store.get().facing.bearing);
    const idx = EASY_STEPS.indexOf(step);
    const items = EASY_STEPS.map((id, i) => {
      const name = T[STEP_NAME[id]];
      const current = i === idx;
      const cls = `v-easy-step${current ? ' is-current' : ''}${i < idx ? ' is-done' : ''}`;
      const inner = [h('span', { class: 'v-easy-stepdot', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'v-easy-stepname' }, name)];
      const clickable = hasFacing || i === 0;
      const node = clickable
        ? h('button', {
          type: 'button', class: 'v-easy-stepbtn', 'data-fk': `step-${id}`,
          'aria-current': current ? 'step' : null,
          'aria-label': fillText('steps.back', { n: i + 1, name }),
          onclick: () => { if (!current || (id === 'facing' && sub !== '1S' && hasFacing)) goStep(id, id === 'facing' ? facingEntrySub(false) : null); },
        }, inner)
        : h('span', { class: 'v-easy-stepbtn is-disabled', 'aria-current': current ? 'step' : null, 'aria-disabled': 'true' }, inner);
      return h('li', { class: cls }, node);
    });
    return h('nav', { class: 'v-easy-steps', 'aria-label': T['steps.label'] },
      h('ol', null, items),
      h('p', { class: 'v-easy-stepcount' }, fillText('steps.count', { n: idx + 1 })));
  }

  /** 進入步驟 1 時要顯示哪個子畫面(explicit = 使用者明確要重量) */
  function facingEntrySub(explicit) {
    if (!explicit && isNum(store.get().facing.bearing)) return '1S';
    if (!hasSensorApi) { failStatus = NO_SENSOR_API; return '1M'; }
    return '1A';
  }

  /**
   * 「手機差幾度,會不會影響結果?」:大門朝哪一方(disp = 大門的顯示方位)與排第一的財位會不會換
   * (s = 狀態或試算草稿,rawBearing = 宅向磁北)。
   */
  function impactBlock({ disp, U, origin, s, rawBearing }) {
    const eight = origin === 'pick8' ? null : eightImpact(disp, U);
    const imp = renderDirectionImpact({ eight, wealth: wealthImpact(s, rawBearing, U), origin });
    return h('section', { class: 'card flat v-easy-impact' },
      h('h3', { class: 'v-easy-h3' }, imp.title),
      h('ul', { class: 'list v-easy-impact-list' }, imp.lines.map((l) => h('li', null,
        h('span', { class: `mark ${l.icon === '!' ? 'bad' : l.icon === '✓' ? 'ok' : 'info'}`, 'aria-hidden': l.icon === 'i' ? 'true' : null }, l.icon),
        h('span', null, h('strong', null, l.head), h('br'), l.text)))));
  }

  // ─────────────────────────── 步驟 1:量方向 ───────────────────────────

  const ILLUSTRATION = '<svg viewBox="0 0 200 120" aria-hidden="true" focusable="false">'
    + '<path class="v-easy-ill-wall" d="M10 24 H78 M122 24 H190"/>'
    + '<path class="v-easy-ill-door" d="M78 24 H122"/>'
    + '<path class="v-easy-ill-arrow" d="M100 70 V8 M92 16 L100 6 L108 16"/>'
    + '<circle class="v-easy-ill-body" cx="100" cy="98" r="15"/>'
    + '<rect class="v-easy-ill-phone" x="93" y="66" width="14" height="22" rx="3"/>'
    + '<path class="v-easy-ill-gap" d="M140 40 V96 M136 44 L140 40 L144 44 M136 92 L140 96 L144 92"/>'
    + '</svg>';

  function view1A() {
    const iosAsk = Boolean(win && win.DeviceOrientationEvent && typeof win.DeviceOrientationEvent.requestPermission === 'function');
    const startBtn = bigBtn(T['a.start'], startSensor);
    refs.startBtn = startBtn;
    const out = [
      title(T['a.title']),
      h('p', { class: 'v-easy-lead' }, T['a.lead']),
      h('div', { class: 'v-easy-ill', html: ILLUSTRATION }),
      h('ol', { class: 'v-easy-howto' }, [T['a.step1'], T['a.step2'], T['a.step3']].map((t) => h('li', null, t))),
      iosAsk ? h('p', { class: 'hint v-easy-note' }, T['a.iosNote']) : null,
      startBtn,
      btn(T['a.manual'], () => { stopSensor(); failStatus = null; show('1M'); }),
      helpBtn(),
    ];
    queueMicrotask(updateStartButton);
    return out;
  }

  function view1B() {
    const dialHost = h('div', { class: 'v-easy-dial' });
    dial = mountDirDial(dialHost, { size: 240, pointerLabel: T['b.pointer'] });
    const bars = [0, 1, 2].map(() => h('span', { class: 'v-easy-bar' }));
    refs.bars = bars;
    refs.big = h('div', { class: 'v-easy-dir kai' }, T['b.reading']);
    refs.paren = h('div', { class: 'v-easy-paren' });
    refs.deg = h('div', { class: 'v-easy-deg' });
    refs.live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    refs.posture = h('div', { class: 'callout warn v-easy-callout', hidden: true });
    refs.stabLabel = h('span', { class: 'v-easy-stab-label' });
    refs.stabReason = h('p', { class: 'v-easy-stab-reason' });
    refs.stab = h('div', { class: 'v-easy-stab', role: 'status' },
      h('div', { class: 'v-easy-stab-head' }, h('span', { class: 'v-easy-bars', 'aria-hidden': 'true' }, bars), refs.stabLabel),
      refs.stabReason);
    refs.lockBtn = bigBtn(T['b.lock'], doLock);
    refs.progress = h('div', { class: 'v-easy-progress', hidden: true, 'aria-hidden': 'true' }, h('span'));
    refs.lockMsg = h('p', { class: 'v-easy-alert', role: 'alert', hidden: true });
    announceKey = '';
    const out = [
      title(T['b.title']),
      dialHost,
      h('div', { class: 'v-easy-readout' },
        h('div', { class: 'v-easy-headlabel' }, T['b.headLabel']),
        refs.big,
        refs.paren,
        refs.deg),
      refs.live,
      refs.posture,
      refs.stab,
      refs.lockBtn,
      refs.progress,
      refs.lockMsg,
      btn(T['b.stop'], () => { stopSensor(); failStatus = null; show('1M'); }, 'btn btn-ghost'),
      helpBtn(),
    ];
    queueMicrotask(() => { updateLive(); updateLockUI(); });
    return out;
  }

  function view1D() {
    const state = store.get();
    const basis = basisNow();
    if (!check) return view1A();
    // 先取到 0.1 度(存檔也是這樣),這裡和存好後的畫面才會顯示同一個度數
    const disp = displayedFromRaw(roundTenth(check.meanDeg), basis);
    const pd = plainDirection(disp);
    const U = check.uncertaintyDeg;
    const eight = eightImpact(disp, U);
    const near = Boolean(eight && eight.near);
    const verdict = checkVerdictText(check, isNum(state.settings.lockSeconds) ? state.settings.lockSeconds : DEFAULT_SETTINGS.lockSeconds,
      { near, dir: pd.dir8 });
    const items = readings.map((r, i) => {
      const p = plainDirection(displayedFromRaw(r.meanDeg, basis));
      return h('li', { class: check.dropped === i ? 'is-dropped' : null },
        fillText('d.item', { i: i + 1, deg: p.deg }),
        check.dropped === i ? h('span', { class: 'badge v-easy-dropped' }, T['d.dropped']) : null);
    });
    // 試算用草稿:把這次的量測當成宅向(存檔時大門方向會合成同一個)
    const draft = { ...state, facing: { ...state.facing, bearing: check.meanDeg, doorBearing: null } };

    const use = () => saveFacing({
      displayedDeg: disp, origin: 'sensor',
      lock: { sigma: isNum(check.sigmaMax) ? check.sigmaMax : 0, lockedAtMs: check.lockedAtMs },
      chk: check,
    });
    const toManual = () => { stopSensor(); failStatus = null; show('1M'); };
    const hint = (key) => h('p', { class: 'hint v-easy-note' }, T[key]);
    const v = check.verdict;
    let actions;
    if (v === 'single-ok' && !near) {
      actions = [bigBtn(T['d.use'], use), hint('d.againHint'), btn(T['d.again'], measureAgain)];
    } else if (v === 'single-noacc' && !near) {
      // 手機不回報自己的誤差:穩不代表準,主按鈕改成移一步再量
      actions = [hint('d.againHint'), bigBtn(T['d.again'], measureAgain), btn(T['d.use'], use)];
    } else if (v === 'single-ok' || v === 'single-noacc' || v === 'single-wide' || v === 'single-unstable') {
      actions = [hint('d.againHint'), bigBtn(T['d.again'], measureAgain), btn(T['d.useAnyway'], use)];
    } else if (v === 'warn' && check.n < 3 && !near) {
      actions = [bigBtn(T['d.use'], use), hint('d.thirdHint'), btn(T['d.third'], measureAgain)];
    } else if (v === 'warn' && check.n < 3) {
      actions = [hint('d.thirdHint'), bigBtn(T['d.third'], measureAgain), btn(T['d.useAnyway'], use)];
    } else if (v === 'far') {
      actions = [hint('d.thirdHint'), bigBtn(T['d.third'], measureAgain), btn(T['d.toManual'], toManual), btn(T['d.useAnyway'], use)];
    } else if (v === 'inconsistent') {
      actions = [bigBtn(T['d.toManual'], toManual), btn(T['d.useAnyway'], use)];
    } else {
      actions = [bigBtn(T['d.use'], use)];
    }
    return [
      title(fillText('d.title', { text: dirText(pd, near) })),
      h('p', { class: 'v-easy-deg' }, fillText('d.degree', { deg: pd.deg })),
      h('ol', { class: 'v-easy-readings' }, items),
      verdict ? verdictCallout(verdict) : null,
      impactBlock({ disp, U, origin: 'sensor', s: draft, rawBearing: check.meanDeg }),
      actions,
      btn(T['d.restart'], () => { readings = []; check = null; measureAgain(); }, 'btn btn-ghost'),
      helpBtn(),
    ];
  }

  function failLines() {
    if (!failStatus) return [];
    if (failStatus === NO_SENSOR_API) return [T['m.noSensor']];
    const lines = [];
    if (failStatus === 'permission-denied' || failStatus === 'permission-error') lines.push(fillText('m.denied', { message: failMessage }));
    else if (failStatus === 'relative-not-north') lines.push(T['m.relative']);
    else lines.push(T['m.noEvents']);
    const app = inAppBrowserName(win && win.navigator ? win.navigator.userAgent : '');
    if (app) lines.push(fillText('m.inApp', { app }));
    return lines;
  }

  function view1M() {
    const picked = h('p', { class: 'v-easy-picked', 'aria-live': 'polite' });
    const useBtn = bigBtn(T['m.use'], () => {
      if (mTyped != null) saveFacing({ displayedDeg: mTyped, origin: 'typed' });
      else if (mPick != null) saveFacing({ displayedDeg: bearingOfDir8(mPick), origin: 'pick8' });
    });
    const cells = [];
    const sync = () => {
      for (const c of cells) c.el.setAttribute('aria-pressed', mTyped == null && mPick === c.dir ? 'true' : 'false');
      if (mTyped != null) {
        const pd = plainDirection(mTyped);
        picked.textContent = fillText('m.typed', { deg: mTyped, text: pd.text });
      } else if (mPick != null) {
        picked.textContent = fillText('m.picked', { dir: mPick });
      } else {
        picked.textContent = '';
      }
      useBtn.disabled = mTyped == null && mPick == null;
      err.textContent = mErr ? T[mErr] : '';
      err.hidden = !mErr;
      input.setAttribute('aria-invalid', mErr ? 'true' : 'false');
    };
    const grid = h('div', { class: 'v-easy-grid8' }, GRID8.map((k) => {
      if (k === null) return h('div', { class: 'v-easy-cell is-center', 'aria-hidden': 'true' }, T['m.center']);
      const dir = DIR8[k];
      const el = h('button', {
        type: 'button', class: 'v-easy-cell kai', 'data-fk': `cell-${k}`,
        'aria-label': fillText('m.cellAria', { dir }), 'aria-pressed': 'false',
        onclick: () => { mPick = dir; mTyped = null; mErr = null; mText = ''; input.value = ''; sync(); },
      }, dir);
      cells.push({ el, dir });
      return el;
    }));
    const inputId = 'v-easy-deg-input';
    const errId = 'v-easy-deg-err';
    const err = h('p', { class: 'v-easy-alert', id: errId, role: 'alert', hidden: true });
    const input = h('input', {
      id: inputId, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: T['m.degPlaceholder'],
      'aria-describedby': `${inputId}-hint ${errId}`, 'data-fk': 'deg-input',
      oninput: () => {
        mText = input.value;
        if (mText.trim() === '') { mTyped = null; mErr = null; sync(); return; }
        const res = parseBearingInput(mText);
        if (res.ok) { mTyped = res.value; mErr = null; mPick = null; } else { mTyped = null; mErr = res.reason === 'empty' ? 'm.degEmpty' : res.reason === 'range' ? 'm.degRange' : 'm.degNan'; }
        sync();
      },
    });
    input.value = mText;
    const deg = h('details', { class: 'v-card-more v-easy-degbox', open: mText !== '' ? true : null },
      h('summary', null, T['m.degTitle']),
      h('div', { class: 'field' },
        h('label', { for: inputId }, T['m.degLabel']),
        input,
        h('div', { class: 'hint', id: `${inputId}-hint` }, T['m.degHint']),
        err));
    sync();
    return [
      failLines().map((t) => calloutOf('!', t, true)),
      title(T['m.title']),
      h('p', { class: 'v-easy-lead' }, T['m.lead']),
      h('ul', { class: 'v-easy-maphelp' }, h('li', null, T['m.map1']), h('li', null, T['m.map2'])),
      grid,
      picked,
      h('p', { class: 'faint v-easy-small' }, T['m.note']),
      deg,
      useBtn,
      hasSensorApi ? btn(T['m.retrySensor'], () => { failStatus = null; show('1A'); }, 'btn btn-ghost') : null,
      helpBtn(),
    ];
  }

  function view1S() {
    const state = store.get();
    const f = state.facing;
    const disp = doorDisplayed(state);
    const pd = plainDirection(disp);
    const origin = originOf(f);
    const U = savedUncertainty(state);
    const e8 = origin === 'pick8' ? null : eightImpact(disp, U);
    const chk = facingCheckOf(f);
    const separate = hasSeparateDoor(state);
    let small;
    if (separate) small = fillText('s.other', { deg: pd.deg });
    else if (f.source === 'sensor' && chk && chk.n >= 2 && chk.dropped === 1) small = fillText('s.sensorDropped', { deg: pd.deg, n: chk.n, d: fmtSmall(chk.spreadDeg) });
    else if (f.source === 'sensor' && chk && chk.n >= 2) small = fillText('s.sensorMulti', { deg: pd.deg, n: chk.n, d: fmtSmall(chk.spreadDeg) });
    else if (f.source === 'sensor') small = fillText('s.sensorOne', { deg: pd.deg });
    else if (f.source === 'pick8') small = T['s.pick8'];
    else if (f.source === 'manual' && f.lockedAtMs == null) small = fillText('s.typed', { deg: fmtSmall(roundTenth(disp)) });
    else small = fillText('s.other', { deg: pd.deg });
    const houseDeg = plainDirection(displayedFacing(state));
    return [
      title(fillText('s.title', { text: dirText(pd, Boolean(e8 && e8.near)) })),
      h('p', { class: 'v-easy-deg' }, small),
      separate && houseDeg ? calloutOf(null, fillText('s.doorSep', { deg: houseDeg.deg }), false) : null,
      f.source === 'pick8' ? calloutOf(null, EASY_PICK8_NOTE, false) : null,
      impactBlock({ disp, U, origin, s: state, rawBearing: f.bearing }),
      bigBtn(T['s.next'], () => goStep(state.plan ? 'result' : 'layout')),
      h('div', { class: 'v-easy-row' },
        btn(T['s.remeasure'], () => { show(facingEntrySub(true)); }),
        btn(T['s.manual'], () => { failStatus = null; show('1M'); })),
    ];
  }

  function viewFacing() {
    if (!sub || (sub === '1S' && !isNum(store.get().facing.bearing))) sub = facingEntrySub(false);
    switch (sub) {
      case '1B': return view1B();
      case '1D': return view1D();
      case '1M': return view1M();
      case '1S': return view1S();
      default: return view1A();
    }
  }

  // ─────────────────────────── 步驟 2:選格局 ───────────────────────────

  /** 範本說明:簡單模式用自己的短句(與範本實際的房間一致),沒有就用範本原本的 */
  const tplDesc = (t) => (Object.prototype.hasOwnProperty.call(T, `l.desc.${t.id}`) ? T[`l.desc.${t.id}`] : t.desc);

  function viewLayout() {
    const state = store.get();
    const layout = state.ui.easyLayout;
    const own = state.plan && !isUntouchedTemplate(state.plan, layout);
    if (own) {
      let svg = '';
      try { svg = planPreviewSvg(state.plan, { size: 'large' }); } catch { svg = ''; }
      return [
        title(T['l.ownTitle']),
        h('p', { class: 'v-easy-lead' }, T['l.ownLead']),
        svg ? h('div', { class: 'v-easy-preview', html: svg }) : null,
        bigBtn(T['l.ownNext'], () => goStep('result')),
        btn(T['l.ownEdit'], () => ctx.go('plan')),
      ];
    }
    const current = state.plan && layout ? layout.template : null;
    const side = current ? layout.doorSide : 'left';
    const cards = h('div', { class: 'v-easy-tpls' }, TEMPLATES.filter((t) => t.id !== 'custom').map((t) => {
      let thumb = '';
      try { thumb = planPreviewSvg(buildTemplate(t.id).plan, { size: 'thumb', label: t.label }); } catch { thumb = ''; }
      return h('button', {
        type: 'button', class: 'v-easy-tpl', 'data-fk': `tpl-${t.id}`,
        'aria-pressed': current === t.id ? 'true' : 'false',
        'aria-label': fillText('l.cardAria', { label: t.label, desc: tplDesc(t), size: t.size }),
        onclick: () => applyLayout(t.id, current ? side : 'left'),
      },
        h('span', { class: 'v-easy-tpl-thumb', 'aria-hidden': 'true', html: thumb }),
        h('span', { class: 'v-easy-tpl-name' }, t.label),
        h('span', { class: 'v-easy-tpl-desc' }, tplDesc(t)));
    }));
    let door = null;
    if (current) {
      const tpl = TEMPLATES.find((t) => t.id === current);
      const seg = h('div', { class: 'seg v-easy-seg', role: 'group', 'aria-label': T['l.doorTitle'] },
        DOOR_SIDES.map((s) => h('button', {
          type: 'button', 'data-fk': `door-${s}`, 'aria-pressed': s === side ? 'true' : 'false',
          onclick: () => { if (s !== side) applyLayout(current, s); },
        }, T[`l.${s}`])));
      let svg = '';
      try { svg = planPreviewSvg(state.plan, { size: 'large', label: tpl ? tpl.label : undefined }); } catch { svg = ''; }
      // 三種大門位置算出來排第一的財位都一樣時,直接講明,免得使用者以為換邊沒作用是選錯了
      let same = null;
      try {
        const built = buildTemplate(current);
        const plans = Object.fromEntries(DOOR_SIDES.map((sd) => [sd, withDoorSide(built.plan, sd).plan]));
        same = sameTopForPlans(state, state.facing.bearing, plans);
      } catch { same = null; }
      door = h('section', { class: 'v-easy-door' },
        h('h3', { class: 'v-easy-h3' }, T['l.doorTitle']),
        h('p', { class: 'v-easy-small' }, T['l.doorLead']),
        seg,
        h('p', { class: 'faint v-easy-small' }, same ? EASY_DOOR_SAME : EASY_DOOR_WHY),
        svg ? h('div', { class: 'v-easy-preview', html: svg }) : null,
        h('p', { class: 'faint v-easy-small' }, T['l.previewNote']));
    }
    return [
      title(T['l.title']),
      h('p', { class: 'v-easy-lead' }, T['l.lead']),
      cards,
      door,
      bigBtn(T['l.next'], () => goStep('result'), { disabled: current ? null : true }),
      h('div', { class: 'v-easy-row' },
        btn(T['l.skip'], skipLayout, 'btn btn-ghost'),
        btn(T['common.back'], () => goStep('facing', '1S'), 'btn btn-ghost')),
    ];
  }

  // ─────────────────────────── 步驟 3:看財位 ───────────────────────────

  function errorCard() {
    return h('section', { class: 'card warn' },
      h('h2', { class: 'card-title v-easy-title', tabindex: '-1' }, T['r.errTitle']),
      h('p', null, T['r.errBody']),
      h('div', { class: 'v-easy-row' },
        btn(T['r.errStep1'], () => goStep('facing', facingEntrySub(false))),
        btn(T['r.errPro'], () => ctx.go('house'))));
  }

  function moreCard(state) {
    const which = nextHint(state);
    if (!which) return null;
    let body;
    if (which === 'plan') {
      body = [h('p', null, T['r.morePlan']), btn(T['r.morePlanBtn'], () => goStep('layout'))];
    } else if (which === 'residents') {
      body = [h('p', null, T['r.moreResidents']), btn(T['r.moreResidentsBtn'], () => ctx.go('house'))];
    } else {
      const id = 'v-easy-year';
      const msg = h('p', { class: 'v-easy-yearmsg', 'aria-live': 'polite' });
      const input = h('input', {
        id, type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: T['r.yearPlaceholder'],
        'aria-describedby': `${id}-hint ${id}-msg`, 'data-fk': 'year-input',
        oninput: () => { yearText = input.value; showYear(); },
      });
      msg.id = `${id}-msg`;
      input.value = yearText;
      const showYear = () => {
        const res = parseYearLoose(yearText, Date.now());
        msg.classList.toggle('v-easy-alert', !res.ok);
        if (!res.ok) { msg.setAttribute('role', 'alert'); msg.textContent = res.message; input.setAttribute('aria-invalid', 'true'); return res; }
        msg.removeAttribute('role');
        input.setAttribute('aria-invalid', 'false');
        msg.textContent = res.roc != null && res.value != null ? fillText('r.yearRoc', { roc: res.roc, year: res.value }) : '';
        return res;
      };
      const save = () => {
        const res = showYear();
        if (!res.ok || res.value == null) { input.focus(); return; }
        const prev = store.get().building.builtYear;
        yearText = '';
        store.update((d) => { d.building.builtYear = res.value; });
        ctx.toast(fillText('r.yearSaved', { year: res.value }), {
          action: { label: T['common.undo'], onClick: () => store.update((d) => { d.building.builtYear = prev; }) },
        });
      };
      if (yearText) queueMicrotask(showYear);
      body = [
        h('p', null, T['r.moreYear']),
        h('div', { class: 'field' },
          h('label', { for: id }, T['r.yearLabel']),
          h('div', { class: 'v-easy-yearrow' }, input, btn(T['r.yearSave'], save)),
          msg,
          h('div', { class: 'hint', id: `${id}-hint` }, T['r.yearHint'])),
      ];
    }
    return h('section', { class: 'card v-easy-more' }, h('h3', { class: 'card-title' }, T['r.moreTitle']), body);
  }

  function viewResult() {
    const state = store.get();
    if (!isNum(state.facing.bearing)) { step = 'facing'; sub = facingEntrySub(false); return viewFacing(); }
    const r = safeReport(store);
    if (r && r.error === 'NO_FACING') { step = 'facing'; sub = facingEntrySub(false); return viewFacing(); }
    let model = null;
    let sum = null;
    try {
      const raw = r && !r.error ? renderReport(r) : null;
      model = buildWealthModel(state, r, raw);
      sum = r && !r.error ? renderEasySummary(r) : null;
    } catch (e) {
      console.error('easy', e);
      model = { status: 'error' };
    }
    if (!model || model.status !== 'ok' || !sum) {
      if (r && r.error) console.error('easy', r.error);
      return [errorCard()];
    }

    const disp = displayedFacing(state);
    const doorDisp = doorDisplayed(state);
    const origin = originOf(state.facing);
    const U = savedUncertainty(state);
    const tops = r.summary.wealthTop || [];
    const notes = [];
    const retestNote = (text) => h('div', { class: 'callout warn v-easy-callout v-easy-retest' },
      h('span', { class: 'v-easy-icon', 'aria-hidden': 'true' }, '!'),
      h('div', null,
        h('p', null, text),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goStep('facing', facingEntrySub(true)) }, T['r.retestBtn'])));
    // 方向差 U 度時排第一的財位會不會換(自己選的 8 方位用半格寬):會換就提醒,比「接近分界」更具體
    const stab = wealthImpact(state, state.facing.bearing, U);
    const e8 = origin === 'pick8' ? null : eightImpact(doorDisp, U);
    if (stab && stab.status === 'changes') {
      notes.push(retestNote(renderStabilityNote({ change: stab.change, place: stab.place, from: stab.from, to: stab.to, origin })));
    } else if (e8 && e8.near) {
      const sec = sectorOf8(doorDisp);
      notes.push(retestNote(fillText('r.retest', { a: sec.dir8, b: sec.neighbor })));
    }
    if (state.facing.source === 'sensor' && isNum(state.facing.sigma) && state.facing.sigma > SENSOR_DEFAULTS.lockMaxStdDeg) {
      notes.push(calloutOf('!', T['r.shaky'], true));
    }

    const best = model.best;
    const parts = easyResultParts(best, sum);
    const cardBody = [h('h2', { class: 'card-title v-easy-title', tabindex: '-1' }, sum.title)];
    const pictureHost = h('div', { class: 'v-easy-pic' });
    const caption = h('div', { class: 'faint v-easy-caption', 'aria-live': 'polite' });
    let bestMarker = null;
    const useMap = Boolean(model.map && best);
    const diagramUp = isNum(state.facing.doorBearing) ? displayedFromRaw(state.facing.doorBearing, basisNow()) : disp;
    if (useMap) {
      pictureHost.classList.add('is-map');
      bestMarker = model.map.markers.find((m) => m.id === best.id) || null;
    }
    const entryPlace = (i) => placeText(tops[i], state.plan);
    const setCaption = (id) => {
      clear(caption);
      const i = [best, ...model.others].findIndex((e) => e && e.id === id);
      if (!best || id === best.id || i < 0) {
        caption.append(h('span', null, T[useMap ? 'r.mapNote' : 'r.dirNote']));
        return;
      }
      const p = entryPlace(i);
      caption.append(
        h('span', null, fillText('r.showing', { place: p ? p.text : '' })),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-ghost',
          onclick: () => {
            select(best.id);
            // 這顆按鈕會跟著說明一起消失,焦點放回「其他位置」的標題,不要掉到網頁最上面
            const back = view.querySelector('.v-easy-others > summary');
            if (back) back.focus({ preventScroll: true });
          },
        }, T['r.backToBest']));
    };
    const select = (id) => {
      showingId = id === (best && best.id) ? null : id;
      const all = [best, ...model.others];
      const e = all.find((x) => x && x.id === id);
      if (!e) return;
      if (useMap) {
        const m = model.map.markers.find((x) => x.id === id);
        if (mini && m) mini.update({ markers: [m], selectedId: id, sectorLabels: 'dir8' });
      } else if (e.dir) {
        pictureHost.innerHTML = directionDiagramSvg({ upBearing: diagramUp, highlight: e.dir });
      }
      setCaption(id);
      if (id !== best.id && pictureHost.scrollIntoView) pictureHost.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    };

    if (sum.status === 'none' || !best) {
      cardBody.push(sum.sentences.map((t) => h('p', null, t)));
    } else {
      const place = entryPlace(0);
      const hasPic = useMap || (best.isDark && best.dir);
      if (hasPic) {
        if (!useMap) pictureHost.innerHTML = directionDiagramSvg({ upBearing: diagramUp, highlight: best.dir });
        cardBody.push(pictureHost, caption);
      }
      cardBody.push(
        h('p', { class: 'card-lead kai v-easy-place' }, place ? place.text : best.headline),
        h('div', { class: 'row tight v-easy-where' },
          !best.isDark && best.dir ? h('span', null, fillText('r.inHouse', { dir: best.dir })) : null,
          h('span', { class: TIER_BADGE[best.tier] }, TIER_LABEL[best.tier])),
        place && place.usesFrame ? h('p', { class: 'faint v-easy-small' }, T['r.frame']) : null,
        parts.sentences.map((t) => h('p', null, t)),
        parts.checks.length
          ? h('ul', { class: 'list v-easy-checks' }, parts.checks.map((c) => h('li', null,
            h('span', { class: `mark ${c.ok ? 'ok' : 'bad'}` }, c.ok ? '✓' : '✗'),
            h('span', null, c.text))))
          : null,
        parts.remedy
          ? h('div', { class: 'callout v-easy-remedy' },
            h('div', { class: 'v-easy-h4' }, T['r.remedyTitle']),
            h('strong', null, parts.remedy.headline),
            h('p', null, parts.remedy.body))
          : null,
        sum.softTips.length
          ? h('details', { class: 'v-card-more' }, h('summary', null, T['r.tipsTitle']),
            h('div', null, h('ul', { class: 'v-easy-tips' }, sum.softTips.map((t) => h('li', null, t))), h('p', { class: 'faint v-easy-small' }, T['r.tipsNote'])))
          : null,
        h('p', { class: 'faint v-easy-small' }, sum.tierNote));
    }

    const others = best && model.others.length
      ? h('details', { class: 'v-card-more v-easy-others', open: showingId ? true : null },
        h('summary', null, fillText('r.othersTitle', { n: model.others.length })),
        h('div', { class: 'v-easy-otherlist' }, model.others.map((e, i) => {
          const p = entryPlace(i + 1);
          return h('button', { type: 'button', class: 'v-easy-other', 'data-fk': `other-${e.id}`, onclick: () => select(e.id) },
            h('span', { class: 'v-easy-other-name' }, p ? p.text : e.headline),
            h('span', { class: TIER_BADGE[e.tier] }, TIER_LABEL[e.tier]));
        })))
      : null;

    const discl = model.disclaimers || [];
    const out = [
      notes,
      h('section', { class: 'card wealth v-easy-best' }, cardBody),
      moreCard(state),
      others,
      bigBtn(T['r.done'], () => {
        // 流程到這裡就結束了:捲回頂端讓使用者再看一次財位,並說明資料已經記好
        root.scrollTo({ top: 0, left: 0, behavior: reduced ? 'auto' : 'smooth' });
        ctx.toast(T['r.doneToast']);
      }),
      h('div', { class: 'v-easy-row' },
        btn(T['r.remeasure'], () => goStep('facing', facingEntrySub(true))),
        btn(T['r.editLayout'], () => goStep('layout'))),
      btn(T['r.full'], () => ctx.go('wealth'), 'btn btn-ghost'),
      h('footer', { class: 'faint v-easy-foot' },
        discl[0] ? h('p', null, discl[0]) : null,
        h('details', { class: 'v-card-more' }, h('summary', null, T['r.moreDisclaimers']),
          h('div', null, EASY_DISCLAIMERS.map((t) => h('p', null, t)), h('p', null, CARD_DISCLAIMER)))),
    ];

    // 縮圖要等節點進了畫面(量得到寬度)才掛
    queueMicrotask(() => {
      if (destroyed || !best) return;
      if (useMap && pictureHost.isConnected && bestMarker) {
        mini = mountMiniPlan(pictureHost, { ...model.map, markers: [bestMarker], selectedId: best.id, sectorLabels: 'dir8' });
      }
      const keep = showingId && [best, ...model.others].some((e) => e && e.id === showingId) ? showingId : best.id;
      setCaption(keep);
      if (keep !== best.id) select(keep);
    });
    return out;
  }

  // ─────────────────────────── 重畫 ───────────────────────────

  function teardownInstances() {
    if (dial) { dial.destroy(); dial = null; }
    if (mini) { mini.destroy(); mini = null; }
    cancelAnimationFrame(liveRaf);
    liveRaf = 0;
    clearTimeout(announceTimer);
    refs = {};
  }

  function render() {
    if (destroyed) return;
    renderCount += 1;
    lastKey = keyOf(store.get());
    const active = document.activeElement;
    const focusKey = active && view.contains(active) ? active.getAttribute('data-fk') : null;
    const scrollTop = root.scrollTop;
    teardownInstances();
    clear(view);
    let body;
    try {
      body = step === 'facing' ? viewFacing() : step === 'layout' ? viewLayout() : viewResult();
    } catch (e) {
      console.error('easy', e);
      body = [errorCard()];
    }
    view.append(stepBar());
    for (const n of [body].flat(Infinity)) if (n) view.append(n);

    if (pendingFocusTitle) {
      pendingFocusTitle = false;
      root.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      const t = view.querySelector('.v-easy-title');
      if (t) t.focus({ preventScroll: true });
    } else {
      root.scrollTop = scrollTop;
      if (focusKey) {
        const again = view.querySelector(`[data-fk="${focusKey}"]`);
        if (again) again.focus({ preventScroll: true });
      }
    }
  }

  /** 換步驟 1 的子畫面:重畫、捲回頂端、焦點移到標題 */
  function show(next) {
    if (destroyed) return;
    if (next !== '1B') locking = false;
    sub = next;
    pendingFocusTitle = true;
    render();
  }

  const unsub = store.subscribe((s) => {
    if (destroyed) return;
    const key = keyOf(s);
    if (key === lastKey) return;
    if (sensorBusy()) { lastKey = key; return; } // 感測器量測中不重畫量方向面板
    render();
  });

  // 舊使用者(已有朝向)第一次看到簡單模式時提示一次;之後不再提示
  const first = store.get();
  if (first.ui.easyIntroShown !== true) {
    if (isNum(first.facing.bearing)) ctx.toast(T['intro.toast']);
    store.update((d) => { d.ui.easyIntroShown = true; });
  }
  if (step === 'facing') sub = facingEntrySub(false);
  render();

  return {
    destroy() {
      destroyed = true;
      unsub();
      stopLockTimer();
      teardownInstances();
      if (session) { session.destroy(); session = null; }
    },
  };
}

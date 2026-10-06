// 平面圖畫面(規格 4.3):選範本 → 編輯房間與門窗 → 在圖上看八個方位。
// 純邏輯在 plan/editor.js、plan/templates.js、plan/layers.js、plan/summary.js,繪圖在 canvas/planRenderer.js;
// 這個檔案只負責 DOM、Pointer 事件與 store 的接線。頂層不存取 document / window,全部放在 mount() 裡。

import { h, clear } from '../dom.js';
import { icons } from '../components/icons.js';
import { renderReport } from '../../core/copy.js';
import { taijiPoint } from '../../core/plan.js';
import { drawPlan, readPalette, viewFor, boundsFor, sectorIndexAt } from '../canvas/planRenderer.js';
import {
  snap, planRooms, planOpenings, roomRect, isAxisRect, hitRoom, hitOpening, hitHandle, wallCandidates,
  moveRect, resizeRect, applyRoomRect, addRoom, removeRoom, setRoomType, setRoomName,
  placeOpening, moveOpening, resizeOpening, setMainDoor, changeOpeningKind, removeOpening,
  planFurniture, hitFurniture, addFurniture, moveFurniture, resizeFurniture, rotateFurniture, setFurnitureFacing, removeFurniture,
  setTaijiManual, setTaijiAuto, checkEditedPlan, createHistory, MIN_ROOM, MAX_ROOM,
} from '../plan/editor.js';
import { TEMPLATES, buildTemplate } from '../plan/templates.js';
import { LAYERS, normalizeLayer, layerCells, wealthMarkers, sectorDetails, sectorTag, sectorName } from '../plan/layers.js';
import { summarizePlan } from '../plan/summary.js';
import {
  ROOM_TYPE_LABEL, ROOM_TYPE_ORDER, OPENING_LABEL, OPENING_ADD_ORDER, WALL_LABEL, roomDisplayName, roomNameMap,
  FURNITURE_LABEL, FURNITURE_ORDER, FURNITURE_DEFAULT_SIZE,
} from '../plan/labels.js';
import { GUA, DIR8 } from '../../core/geo.js';

const ICON = { undo: icons.undo, redo: icons.redo, fit: icons.fit };

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 8;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TONE_BADGE = { good: 'badge badge--good', warn: 'badge badge--warn', neutral: 'badge' };
const TONE_TEXT = { good: '較好', warn: '要留意', neutral: '一般' };

/** 範本縮圖(SVG 字串)。只用範本資料的數字與房間類型,沒有任何使用者輸入,所以可以用 html。 */
function thumbSvg(plan) {
  const xs = plan.outline.map((p) => p[0]);
  const ys = plan.outline.map((p) => p[1]);
  const w = Math.max(...xs);
  const d = Math.max(...ys);
  const rects = plan.rooms.map((r) => {
    const rc = roomRect(r);
    return `<rect class="t-${r.type}" x="${rc.x0}" y="${d - rc.y1}" width="${rc.x1 - rc.x0}" height="${rc.y1 - rc.y0}"/>`;
  }).join('');
  const doors = plan.openings.filter((o) => o.kind === 'entrance').map((o) => {
    const r = plan.rooms.find((x) => x.id === o.roomId);
    const rc = roomRect(r);
    const x = rc.x0 + o.pos;
    return `<rect class="t-door" x="${x - o.width / 2}" y="${d - rc.y1 - 0.18}" width="${o.width}" height="0.36"/>`;
  }).join('');
  return `<svg viewBox="-0.4 -0.4 ${w + 0.8} ${d + 0.8}" aria-hidden="true" focusable="false">${rects}${doors}</svg>`;
}

/** 平面圖畫面。 */
export async function mount(root, ctx) {
  const { store, toast, openSheet } = ctx;
  const cleanups = [];
  let destroyed = false;
  let raf = 0;

  // ───────────── 狀態 ─────────────
  const S = {
    mode: 'view',            // 'view' 看方位 | 'edit' 編輯
    selection: null,         // { type:'room'|'opening', id }
    zoom: 1,
    pan: { x: 0, y: 0 },
    W: 0,
    H: 0,
    palette: null,
    themeKey: '',
    preview: null,           // 拖曳中的暫時平面圖
    invalid: false,
    placeFurn: null,         // 等待點圖放入家具的種類
    taijiPreview: null,
    lockBounds: null,
    view: null,
    drag: null,
    pointers: new Map(),
    pinch: null,
    hl: -1,                  // 被點選的方位(0..7)
    placeKind: null,         // 「新增門窗」等待點牆
    photo: null,
    photoMove: false,
  };
  const history = createHistory();
  let built = ''; // 'chooser' | 'editor'
  let D = null;   // 衍生資料快取
  let modeChosen = false;
  const refs = {};

  // ───────────── 衍生資料 ─────────────
  function derive() {
    const state = store.get();
    if (D && D.state === state) return D;
    const plan = state.plan || null;
    let report;
    try { report = store.report(); } catch (e) { report = { error: String((e && e.message) || e) }; }
    const noFacing = !!report && report.error === 'NO_FACING';
    const reportOk = !!report && !report.error;
    let enginePlan = null;
    try { enginePlan = store.input().plan; } catch { enginePlan = null; }
    const up = enginePlan && isNum(enginePlan.planUpBearing) ? enginePlan.planUpBearing : null;
    let taiji = null;
    let taijiMode = null;
    if (enginePlan) {
      try {
        const t = taijiPoint(enginePlan, state.settings || {});
        taiji = t.point;
        taijiMode = t.mode;
      } catch {
        taiji = null;
      }
    }
    const layer = normalizeLayer(state.ui && state.ui.layer);
    const sectorsVisible = reportOk && up !== null && !!taiji;
    const lc = sectorsVisible ? layerCells(report, layer) : { ok: false, note: null, cells: {} };
    const palaces = reportOk && report.planShares ? report.planShares.palaces : null;
    const roomNames = roomNameMap(plan);
    const check = plan ? checkEditedPlan(plan) : { ok: true, message: '', warnings: [] };
    D = {
      state, plan, check, report, noFacing, reportOk, enginePlan, up, taiji, taijiMode, layer, sectorsVisible, lc, palaces, roomNames,
      markers: sectorsVisible && layer === 'wealth' ? wealthMarkers(report) : [],
    };
    return D;
  }

  const rendered = new WeakMap();
  function renderedOf(report) {
    if (!report || report.error) return null;
    if (!rendered.has(report)) {
      let r = null;
      try { r = renderReport(report); } catch { r = null; }
      rendered.set(report, r);
    }
    return rendered.get(report);
  }

  // ───────────── 編輯的共用入口 ─────────────
  /** 複製草稿 → 套用 → 檢查 → 寫入 store。失敗時 toast 白話原因並保持原樣。成功回傳 mutator 的結果(或 true)。 */
  function applyEdit(fn) {
    const cur = store.get().plan;
    if (!cur) return false;
    const draft = clone(cur);
    let res;
    try {
      res = fn(draft);
    } catch (e) {
      console.error('plan edit', e);
      toast('這個操作沒有成功,已保持原樣');
      return false;
    }
    if (res && res.error) { toast(res.error); return false; }
    const chk = checkEditedPlan(draft);
    if (!chk.ok) { toast(chk.message); return false; }
    history.push(cur);
    store.update((d) => { d.plan = draft; });
    return res || true;
  }

  function undo() {
    const r = history.undo(store.get().plan);
    if (!r) return;
    S.selection = null;
    store.update((d) => { d.plan = r.value; });
    toast('已還原上一步');
  }
  /** 刪除後的提示:附「復原」,但只有在平面圖還沒被別的操作改過時才動作,避免復原到不相干的一步 */
  function toastWithUndo(message) {
    const after = JSON.stringify(store.get().plan);
    toast(message, {
      action: {
        label: '復原',
        onClick: () => {
          if (JSON.stringify(store.get().plan) === after) undo();
          else toast('之後又改過平面圖,請用上方的還原一步一步退回');
        },
      },
    });
  }
  function redo() {
    const r = history.redo(store.get().plan);
    if (!r) return;
    S.selection = null;
    store.update((d) => { d.plan = r.value; });
    toast('已重做');
  }

  function startPlan(plan) {
    history.push(store.get().plan || null);
    S.selection = null;
    S.zoom = 1;
    S.pan = { x: 0, y: 0 };
    store.update((d) => { d.plan = plan; });
  }

  // ───────────── 畫布 ─────────────
  function boundsNow() {
    const d = derive();
    return S.lockBounds || boundsFor(d.plan, { taiji: d.taiji, extra: d.markers.map((m) => m.point) });
  }
  function currentView() {
    const d = derive();
    if (!d.plan || !S.W) return null;
    return viewFor(S.preview || d.plan, S.W, S.H, { zoom: S.zoom, pan: S.pan, labels: d.sectorsVisible, bounds: boundsNow() });
  }

  function upHintText(d) {
    const st = d.state.plan;
    if (!st) return '';
    const off = isNum(st.upOffset) && st.upOffset ? `,微調 ${st.upOffset > 0 ? '+' : ''}${Math.round(st.upOffset)}°` : '';
    return st.upMode === 'north' ? `圖面上方 = 正北${off}` : `圖面上方 = 房子的向(前方)${off}`;
  }

  function draw() {
    if (destroyed || !refs.canvas || !S.W) return;
    const d = derive();
    if (!d.plan) return;
    if (!S.palette) S.palette = readPalette();
    const plan = S.preview || d.plan;
    const view = currentView();
    const taiji = S.taijiPreview || d.taiji;
    const editing = S.mode === 'edit';
    S.view = drawPlan(refs.canvas, {
      cssW: S.W,
      cssH: S.H,
      plan,
      viewObj: view,
      palette: S.palette,
      selection: S.selection,
      taiji,
      taijiManual: !!S.taijiPreview || d.taijiMode === 'manual',
      up: d.up,
      // 編輯時只留方位分界線與卦名:色塊、星/標籤、財位標記全部收起來,才看得清房間、牆和小方塊手把
      sectors: {
        visible: d.sectorsVisible,
        tint: !editing && d.layer !== 'none',
        cells: editing ? {} : d.lc.cells,
        highlight: editing ? null : S.hl,
      },
      markers: editing ? [] : d.markers,
      photo: S.photo,
      roomNames: roomNameMap(plan),
      showHandles: S.mode === 'edit' && !S.drag,
      invalid: S.invalid,
    });
  }

  function measure() {
    if (!refs.wrap) return;
    const w = Math.floor(refs.wrap.clientWidth);
    if (w < 40) return;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    const hh = Math.round(clamp(w * 1.0, 300, Math.max(300, Math.min(620, vh * 0.6))));
    refs.wrap.style.height = `${hh}px`;
    if (w !== S.W || hh !== S.H) {
      S.W = w;
      S.H = hh;
    }
  }

  // 排一次重畫。畫面在背景(頁籤隱藏、視窗被遮住)時 requestAnimationFrame 不會觸發,
  // 所以同時掛一個計時器,先到的那個執行,回到前景時資料已經是最新的。
  let timer = 0;
  function scheduleRefresh() {
    if (raf || destroyed) return;
    const run = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
      refresh();
    };
    raf = requestAnimationFrame(run);
    timer = setTimeout(run, 120);
  }

  // ───────────── 版面:範本選擇 ─────────────
  function buildChooser() {
    modeChosen = false;
    clear(root);
    const wrap = h('div', { class: 'v-plan stack' });
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '先選一個像你家的格局'),
      h('p', { class: 'sub' }, '選好之後,可以再拖拉房間、加上門窗。大門預設開在圖面最上方,也就是房子的「向」(前方)。'),
    ));
    const grid = h('div', { class: 'v-plan-templates' });
    for (const t of TEMPLATES) {
      if (t.id === 'custom') continue;
      const built = buildTemplate(t.id).plan;
      grid.append(h('button', {
        type: 'button', class: 'v-plan-tpl', 'aria-label': `${t.label},${t.desc}`,
        onclick: () => { startPlan(buildTemplate(t.id).plan); toast(`已建立「${t.label}」平面圖`); },
      },
      h('span', { class: 'v-plan-thumb', html: thumbSvg(built) }),
      h('span', { class: 'v-plan-tpl-name' }, t.label),
      h('span', { class: 'v-plan-tpl-desc' }, t.desc),
      h('span', { class: 'v-plan-tpl-size faint' }, t.size)));
    }
    wrap.append(grid);

    // 自訂矩形
    const wIn = h('input', { type: 'number', inputmode: 'decimal', min: '2.4', max: '40', step: '0.1', value: '6', id: 'v-plan-w' });
    const dIn = h('input', { type: 'number', inputmode: 'decimal', min: '2.4', max: '40', step: '0.1', value: '8', id: 'v-plan-d' });
    const err = h('p', { class: 'v-plan-err', role: 'alert' });
    const go = () => {
      const r = buildTemplate('custom', { width: wIn.value, depth: dIn.value });
      if (r.error) { err.textContent = r.error; return; }
      err.textContent = '';
      startPlan(r.plan);
      toast('已建立自訂平面圖');
    };
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '自訂矩形'),
      h('p', { class: 'sub' }, '只有一個房間,自己輸入寬與深(公尺)。適合店面、辦公室或單一空間。'),
      h('div', { class: 'grid2 v-plan-custom' },
        h('div', { class: 'field' }, h('label', { for: 'v-plan-w' }, '寬(公尺)'), wIn),
        h('div', { class: 'field' }, h('label', { for: 'v-plan-d' }, '深(公尺)'), dIn)),
      err,
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: go }, '用這個大小開始'),
    ));

    if (history.canUndo()) {
      wrap.append(h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: undo }, '找回剛剛的平面圖'));
    }
    wrap.append(h('p', { class: 'faint v-plan-foot' }, '平面圖只存在這台裝置裡。畫得不準也沒關係,方位是依房子的整體位置算的。'));
    root.append(wrap);
    built = 'chooser';
  }

  // ───────────── 版面:編輯器 ─────────────
  function iconBtn(label, iconHtml, onclick, extra = {}) {
    return h('button', { type: 'button', class: 'icon-btn v-plan-ibtn', 'aria-label': label, title: label, onclick, ...extra }, h('span', { html: iconHtml }));
  }

  function buildEditor() {
    clear(root);
    const wrap = h('div', { class: 'v-plan stack' });

    refs.callout = h('div', { class: 'callout hidden', role: 'status' });
    wrap.append(refs.callout);

    // 舞台卡片:工具列 + 圖層 + 畫布
    refs.modeSeg = h('div', { class: 'seg v-plan-modeseg', role: 'group', 'aria-label': '操作模式' },
      h('button', { type: 'button', 'data-mode': 'view', onclick: () => setMode('view') }, '看方位'),
      h('button', { type: 'button', 'data-mode': 'edit', onclick: () => setMode('edit') }, '編輯'));
    refs.undoBtn = iconBtn('還原上一步', ICON.undo, undo);
    refs.redoBtn = iconBtn('重做', ICON.redo, redo);
    refs.bar = h('div', { class: 'v-plan-bar' }, refs.modeSeg, h('span', { class: 'spacer' }), refs.undoBtn, refs.redoBtn);

    refs.chips = h('div', { class: 'v-plan-chips', role: 'group', 'aria-label': '圖層' });

    refs.canvas = h('canvas', { role: 'img', 'aria-label': '平面圖' });
    refs.banner = h('div', { class: 'v-plan-banner hidden', role: 'status' });
    const zoomBox = h('div', { class: 'v-plan-zoom' },
      iconBtn('放大', ctx.icons.plus, () => zoomBy(1.3)),
      iconBtn('縮小', ctx.icons.minus, () => zoomBy(1 / 1.3)),
      iconBtn('回到整張圖', ICON.fit, () => { S.zoom = 1; S.pan = { x: 0, y: 0 }; scheduleRefresh(); }));
    refs.banner.addEventListener('pointerdown', (e) => e.stopPropagation());
    refs.wrap = h('div', { class: 'canvas-wrap v-plan-canvas' }, refs.canvas, refs.banner);
    refs.hint = h('p', { class: 'v-plan-hint faint' });

    wrap.append(h('div', { class: 'card v-plan-stage' }, refs.bar, refs.chips, refs.wrap, h('div', { class: 'v-plan-under' }, refs.hint, zoomBox)));

    refs.sectorList = h('div', { class: 'card v-plan-sectors hidden' });
    wrap.append(refs.sectorList);

    refs.selPanel = h('div', { class: 'card v-plan-edit hidden' });
    wrap.append(refs.selPanel);

    // 圖面方向
    refs.upSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '圖面上方是什麼' },
      h('button', { type: 'button', 'data-up': 'facing', onclick: () => setUpMode('facing') }, '房子的向'),
      h('button', { type: 'button', 'data-up': 'north', onclick: () => setUpMode('north') }, '正北'));
    refs.upText = h('p', { class: 'sub v-plan-uptext' });
    refs.upRange = h('input', { type: 'range', min: '-45', max: '45', step: '1', value: '0', 'aria-label': '微調圖面旋轉(度)' });
    refs.upRange.addEventListener('input', () => setUpOffset(Number(refs.upRange.value), false));
    refs.upRange.addEventListener('change', () => setUpOffset(Number(refs.upRange.value), true));
    refs.upVal = h('span', { class: 'mono v-plan-upval' }, '0°');
    wrap.append(h('div', { class: 'card v-plan-orient' },
      h('div', { class: 'card-title' }, '圖面的上方'),
      h('p', { class: 'sub' }, '大多數平面圖的上方,就是房子的前方(向)。你的圖如果上方是正北,可以改過來。'),
      refs.upSeg, refs.upText,
      h('div', { class: 'field' },
        h('label', null, '微調旋轉'),
        h('div', { class: 'v-plan-uprow' },
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '往左轉 1 度', onclick: () => nudgeUp(-1) }, '−1°'),
          refs.upRange,
          h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '往右轉 1 度', onclick: () => nudgeUp(1) }, '+1°'),
          refs.upVal),
        h('span', { class: 'hint' }, '圖畫得有點歪,或方位總是差一點時使用。'))));

    // 描圖照片
    refs.photoBox = h('div', { class: 'card v-plan-photo' });
    wrap.append(refs.photoBox);

    // 太極點與其他
    refs.moreBox = h('div', { class: 'card v-plan-more' });
    wrap.append(refs.moreBox);

    refs.summary = h('div', { class: 'v-plan-summary', role: 'status', 'aria-live': 'polite' });
    wrap.append(refs.summary);

    root.append(wrap);
    built = 'editor';

    buildPhotoBox();
    bindCanvas();
    measure();
  }

  // ───────────── 動態更新 ─────────────
  function refresh() {
    if (destroyed) return;
    const d = derive();
    if (!d.plan) {
      if (built !== 'chooser') build();
      return;
    }
    if (built !== 'editor') { build(); return; }

    // 選取的東西被刪掉就清掉
    if (S.selection) {
      const ok = S.selection.type === 'room'
        ? planRooms(d.plan).some((r) => r.id === S.selection.id)
        : planOpenings(d.plan).some((o) => o.id === S.selection.id);
      if (!ok) S.selection = null;
    }
    // 第一次進來:有方位就先看方位,沒有就直接編輯
    if (!modeChosen) { S.mode = d.sectorsVisible ? 'view' : 'edit'; modeChosen = true; }
    if (!d.sectorsVisible && S.mode === 'view') S.mode = 'edit';
    if (S.hl >= 0 && !d.sectorsVisible) S.hl = -1;

    // 主題變了就重讀色票
    const th = `${d.state.ui && d.state.ui.theme}`;
    if (th !== S.themeKey) { S.themeKey = th; S.palette = null; }

    measure();
    updateBar(d);
    updateChips(d);
    updateCallout(d);
    updateHint(d);
    updateSectorList(d);
    updateSelPanel(d);
    updateOrient(d);
    updateMore(d);
    updateSummary(d);
    updatePhotoBox();
    draw();
  }

  function setMode(m) {
    const d = derive();
    if (m === 'view' && !d.sectorsVisible) { toast('還沒量朝向,先到羅盤分頁量一次'); return; }
    S.mode = m;
    S.placeKind = null;
    S.selection = m === 'view' ? null : S.selection;
    scheduleRefresh();
  }

  function updateBar(d) {
    for (const b of refs.modeSeg.children) {
      const on = b.dataset.mode === S.mode;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.dataset.mode === 'view') b.disabled = !d.sectorsVisible;
    }
    refs.undoBtn.disabled = !history.canUndo();
    refs.redoBtn.disabled = !history.canRedo();
    refs.banner.classList.toggle('hidden', !S.placeKind);
    if (S.placeKind) {
      clear(refs.banner).append(
        h('span', null, `請點一下牆上要放「${OPENING_LABEL[S.placeKind]}」的位置`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { S.placeKind = null; scheduleRefresh(); } }, '取消'));
    }
  }

  function updateChips(d) {
    const show = d.sectorsVisible && S.mode === 'view'; // 圖層只在「看方位」有意義,編輯時收起來
    refs.chips.classList.toggle('hidden', !show);
    if (!show) return;
    if (refs.chips.childElementCount !== LAYERS.length) {
      clear(refs.chips);
      for (const l of LAYERS) {
        refs.chips.append(h('button', {
          type: 'button', class: 'chip', 'data-layer': l.id,
          onclick: () => store.update((s) => { s.ui.layer = l.id; }),
        }, l.label));
      }
    }
    for (const c of refs.chips.children) c.setAttribute('aria-pressed', c.dataset.layer === d.layer ? 'true' : 'false');
  }

  function updateCallout(d) {
    const box = refs.callout;
    if (!d.check.ok) {
      // 資料本身壞了(例如匯入的備份):編輯會被擋,先講清楚並給出路
      box.classList.remove('hidden');
      box.classList.add('warn');
      clear(box).append(
        h('div', null, `這份平面圖的資料有問題:${d.check.message.replace(/^這樣改會讓平面圖出問題:/, '')}。可以重新選一個範本再畫。`),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm v-plan-callout-btn', onclick: confirmChangeTemplate }, '重新選範本'));
    } else if (d.noFacing) {
      box.classList.remove('hidden');
      box.classList.add('warn');
      clear(box).append(
        h('div', null, '還沒量朝向,所以先不顯示八個方位。你可以先把平面圖畫好,再到羅盤量朝向。'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm v-plan-callout-btn', onclick: () => ctx.go('compass') }, '去羅盤量朝向'));
    } else if (d.report && d.report.error) {
      box.classList.remove('hidden');
      box.classList.add('warn');
      clear(box).append(h('div', null, '方位分析暫時算不出來,不過平面圖還是可以編輯,資料都在。'));
    } else {
      box.classList.add('hidden');
    }
  }

  function updateHint(d) {
    let t = '';
    if (S.mode === 'view') {
      t = d.sectorsVisible
        ? `點圖上任一處看那個方位的白話解讀。${d.lc.note || (LAYERS.find((l) => l.id === d.layer) || {}).hint || ''}`
        : '';
    } else {
      t = '點房間選取;拖曳房間移動,拖曳四邊或四角的小方塊調整大小(以 0.1 公尺為單位)。再點一下選中房間的牆,可以加門窗。兩指可縮放。';
    }
    refs.hint.textContent = `${upHintText(d)}。${t}`;
    refs.canvas.setAttribute('aria-label', `平面圖。${summaryOf(d).text}`);
  }

  function summaryOf(d) {
    return summarizePlan({
      plan: d.enginePlan || d.plan,
      taiji: S.taijiPreview || d.taiji,
      planUp: d.up,
      palaces: d.sectorsVisible ? d.palaces : null,
      roomNames: d.roomNames,
    });
  }

  function updateSummary(d) {
    const s = summaryOf(d);
    const pl = d.enginePlan || d.plan;
    const noDoor = Boolean(pl && Array.isArray(pl.rooms) && pl.rooms.length && !(Array.isArray(pl.openings) && pl.openings.some((o) => o && o.id === pl.mainDoor)));
    clear(refs.summary);
    refs.summary.classList.toggle('warn', s.warn || noDoor);
    refs.summary.append(h('span', { class: 'v-plan-summary-text' }, s.text || '平面圖已建立'));
    if (s.outside) {
      refs.summary.append(
        h('span', { class: 'v-plan-summary-note' }, '太極點在牆外,方位會不準。'),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-primary',
          onclick: () => { if (applyEdit((p) => setTaijiAuto(p, 'bbox'))) toast('已改用外框中心'); },
        }, '改用外框中心'));
    }
    if (noDoor) {
      refs.summary.append(h('span', { class: 'v-plan-summary-note' }, '還沒標出大門,財位會不準。切到「編輯」,按「新增門窗」加上大門。'));
    }
  }

  function updateSectorList(d) {
    const box = refs.sectorList;
    box.classList.toggle('hidden', !d.sectorsVisible);
    if (!d.sectorsVisible) return;
    const sig = `${d.layer}|${JSON.stringify(d.lc.cells)}|${S.hl}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    clear(box);
    box.append(h('div', { class: 'card-title' }, '八個方位'));
    const grid = h('div', { class: 'v-plan-secgrid' });
    GUA.forEach((g, k) => {
      const cell = d.lc.cells[g] || { tone: 'neutral', label: '' };
      grid.append(h('button', {
        type: 'button',
        class: `v-plan-sec tone-${cell.tone}`,
        'aria-pressed': S.hl === k ? 'true' : 'false',
        'aria-label': `${sectorName(g)}${cell.label ? `,${cell.label}` : ''},看解讀`,
        onclick: () => openSector(k),
      }, h('span', { class: 'v-plan-sec-name kai' }, sectorTag(g)), h('span', { class: 'v-plan-sec-label' }, cell.label || '看解讀')));
    });
    box.append(grid);
    if (d.lc.note) box.append(h('p', { class: 'sub v-plan-note' }, d.lc.note));
  }

  function updateOrient(d) {
    const st = d.state.plan;
    for (const b of refs.upSeg.children) b.setAttribute('aria-pressed', b.dataset.up === (st.upMode === 'north' ? 'north' : 'facing') ? 'true' : 'false');
    const off = isNum(st.upOffset) ? st.upOffset : 0;
    if (document.activeElement !== refs.upRange) refs.upRange.value = String(clamp(Math.round(off), -45, 45));
    refs.upVal.textContent = `${off > 0 ? '+' : ''}${Math.round(off)}°`;
    refs.upText.textContent = d.up === null
      ? '量好朝向之後,才會知道圖面上方對著羅盤的哪個方向。'
      : `目前圖面上方對著羅盤 ${Math.round(d.up)}°。`;
  }

  function setUpMode(mode) {
    applyEdit((p) => { p.upMode = mode === 'north' ? 'north' : 'facing'; });
  }
  let offsetStart = null;
  function setUpOffset(v, commit) {
    const val = isNum(v) ? clamp(Math.round(v), -180, 180) : 0;
    const cur = store.get().plan;
    if (!cur) return;
    if (!offsetStart) offsetStart = cur;
    if (!commit) {
      store.update((s) => { if (s.plan) s.plan.upOffset = val; });
      return;
    }
    // 放開時才記一步還原
    if (offsetStart && offsetStart.upOffset !== val) history.push(offsetStart);
    offsetStart = null;
    store.update((s) => { if (s.plan) s.plan.upOffset = val; });
  }
  function nudgeUp(delta) {
    const cur = store.get().plan;
    if (!cur) return;
    applyEdit((p) => { p.upOffset = clamp(Math.round((isNum(p.upOffset) ? p.upOffset : 0) + delta), -180, 180); });
  }

  // ───────────── 選取面板 ─────────────
  function updateSelPanel(d) {
    const box = refs.selPanel;
    const edit = S.mode === 'edit';
    box.classList.toggle('hidden', !edit);
    if (!edit) { box.dataset.sig = ''; return; }
    const sel = S.selection;
    let sig = 'none';
    let room = null;
    let op = null;
    let fur = null;
    if (sel && sel.type === 'room') {
      room = planRooms(d.plan).find((r) => r.id === sel.id);
      if (room) { const rc = roomRect(room); sig = `room|${room.id}|${room.type}|${room.name || ''}|${rc.x0},${rc.y0},${rc.x1},${rc.y1}|${d.roomNames.get(room.id)}`; }
    } else if (sel && sel.type === 'opening') {
      op = planOpenings(d.plan).find((o) => o.id === sel.id);
      if (op) sig = `op|${op.id}|${op.kind}|${op.width}|${op.pos}|${op.roomId}|${op.wall}`;
    } else if (sel && sel.type === 'furniture') {
      fur = planFurniture(d.plan).find((f) => f.id === sel.id);
      if (fur) sig = `fur|${fur.id}|${fur.kind}|${fur.x},${fur.y},${fur.w},${fur.d}|${fur.facing}`;
    }
    sig += `|L${planRooms(d.plan).map((r) => r.id).join(',')};${planOpenings(d.plan).map((o) => o.id).join(',')};${planFurniture(d.plan).map((f) => f.id).join(',')}`;
    if (box.dataset.sig === sig) return;
    if (box.dataset.sig && box.contains(document.activeElement) && box.dataset.sig.split('|')[1] === sig.split('|')[1]) {
      // 使用者正在這個面板打字,不要重畫掉輸入框(換選取才重畫)
      return;
    }
    box.dataset.sig = sig;
    const pickerHadFocus = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('v-plan-picker-sel');
    clear(box);

    box.append(buildPicker(d));
    if (pickerHadFocus) { const again = box.querySelector('.v-plan-picker-sel'); if (again) again.focus(); }
    box.append(h('div', { class: 'row v-plan-addrow' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: openAddRoom }, '＋ 新增房間'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openAddOpening(null) }, '＋ 新增門窗'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: openAddFurniture }, '＋ 新增家具')));

    if (room) box.append(roomPanel(d, room));
    else if (op) box.append(openingPanel(d, op));
    else if (fur) box.append(furniturePanel(d, fur));
    else box.append(h('p', { class: 'sub' }, '還沒選東西。點一下房間、門窗或家具,就能在這裡改名稱、大小、朝向或刪除。'));
  }

  /** 用選單選房間或門窗:不靠點圖面也能操作(鍵盤與讀屏使用者的入口) */
  function buildPicker(d) {
    const sel = S.selection;
    const rooms = planRooms(d.plan);
    const ops = planOpenings(d.plan);
    const furns = planFurniture(d.plan);
    const cur = sel ? `${sel.type}:${sel.id}` : '';
    const select = h('select', { class: 'v-plan-picker-sel', 'aria-label': '選擇要編輯的房間或門窗' },
      h('option', { value: '' }, '(沒有選取)'),
      rooms.length ? h('optgroup', { label: '房間' }, rooms.map((r) => h('option', { value: `room:${r.id}` }, d.roomNames.get(r.id) || '房間'))) : null,
      ops.length ? h('optgroup', { label: '門窗' }, ops.map((o) => h('option', { value: `opening:${o.id}` }, `${OPENING_LABEL[o.kind] || '門窗'}(${d.roomNames.get(o.roomId) || '房間'}${WALL_LABEL[o.wall] || ''})`))) : null,
      furns.length ? h('optgroup', { label: '家具' }, furns.map((f) => h('option', { value: `furniture:${f.id}` }, `${FURNITURE_LABEL[f.kind] || '家具'}(${d.roomNames.get(f.roomId) || '房間'})`))) : null);
    select.value = cur;
    if (select.value !== cur) select.value = '';
    select.addEventListener('change', () => {
      const [type, ...rest] = select.value.split(':');
      S.selection = select.value ? { type, id: rest.join(':') } : null;
      scheduleRefresh();
    });
    return h('div', { class: 'field v-plan-picker' }, h('label', null, '不用點圖面,也可以從這裡選'), select);
  }

  function roomPanel(d, room) {
    const rc = roomRect(room);
    const rect = isAxisRect(room.polygon);
    const nameIn = h('input', { type: 'text', maxlength: '12', value: room.name || '', placeholder: roomDisplayName(d.plan, { ...room, name: '' }), 'aria-label': '房間名稱' });
    nameIn.addEventListener('change', () => {
      if (!applyEdit((p) => setRoomName(p, room.id, nameIn.value))) nameIn.value = room.name || '';
    });
    const typeSel = h('select', { 'aria-label': '房間類型' }, ROOM_TYPE_ORDER.map((t) => h('option', { value: t, selected: t === room.type ? true : null }, ROOM_TYPE_LABEL[t])));
    typeSel.value = room.type;
    typeSel.addEventListener('change', () => {
      if (!applyEdit((p) => setRoomType(p, room.id, typeSel.value))) typeSel.value = room.type;
    });
    const w = rc.x1 - rc.x0;
    const dd = rc.y1 - rc.y0;
    const wIn = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: String(MIN_ROOM), max: String(MAX_ROOM), value: fmt1(w), 'aria-label': '寬(公尺)', disabled: rect ? null : true });
    const dIn = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: String(MIN_ROOM), max: String(MAX_ROOM), value: fmt1(dd), 'aria-label': '深(公尺)', disabled: rect ? null : true });
    const opsHere = planOpenings(d.plan).filter((o) => o.roomId === room.id);
    const areaNote = h('p', { class: 'sub' });
    const areaText = (r) => `面積約 ${fmt1((r.x1 - r.x0) * (r.y1 - r.y0))} ㎡,有 ${opsHere.length} 個門窗。${rect ? '' : '這個房間形狀特別,只能改名稱、類型或刪除。'}`;
    areaNote.textContent = areaText(rc);
    // 面板在使用者打字時不會重畫,所以每次都要從 store 讀「現在」的房間大小,
    // 不能用建面板當下的尺寸(否則改成功一次之後,輸入不合法時會退回到過期的數字)
    const liveRect = () => {
      const cur = planRooms(store.get().plan || {}).find((r) => r && r.id === room.id);
      return cur ? roomRect(cur) : rc;
    };
    const showRect = (r) => { wIn.value = fmt1(r.x1 - r.x0); dIn.value = fmt1(r.y1 - r.y0); areaNote.textContent = areaText(r); };
    const resize = () => {
      const cur = liveRect();
      const nw = wIn.value.trim() === '' ? NaN : Number(wIn.value);
      const nd = dIn.value.trim() === '' ? NaN : Number(dIn.value);
      if (!isNum(nw) || !isNum(nd)) { toast('請輸入數字(公尺)'); showRect(cur); return; }
      applyEdit((p) => applyRoomRect(p, room.id, { x0: cur.x0, y0: cur.y0, x1: snap(cur.x0 + snap(nw)), y1: snap(cur.y0 + snap(nd)) }));
      showRect(liveRect());
    };
    wIn.addEventListener('change', resize);
    dIn.addEventListener('change', resize);
    // 不用拖曳也能挪位置(鍵盤與讀屏使用者、手指不好精準拖的人):每按一次移 0.5 公尺
    const NUDGE = 0.5;
    const nudge = (dx, dy) => {
      const cur = liveRect();
      applyEdit((p) => applyRoomRect(p, room.id, moveRect(cur, dx, dy)));
      showRect(liveRect());
    };
    const nudgeBtn = (text, label, dx, dy) => h('button', {
      type: 'button', class: 'btn btn-sm', 'aria-label': label, disabled: rect ? null : true, onclick: () => nudge(dx, dy),
    }, text);
    return h('div', { class: 'v-plan-sel' },
      h('div', { class: 'card-title' }, `已選:${d.roomNames.get(room.id) || '房間'}`),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, '名稱'), nameIn),
        h('div', { class: 'field' }, h('label', null, '類型'), typeSel)),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, '寬(公尺)'), wIn),
        h('div', { class: 'field' }, h('label', null, '深(公尺)'), dIn)),
      areaNote,
      h('div', { class: 'field' }, h('span', { class: 'label' }, '移動位置(每按一次 0.5 公尺)'),
        h('div', { class: 'row tight' },
          nudgeBtn('← 左', '往左移 0.5 公尺', -NUDGE, 0), nudgeBtn('右 →', '往右移 0.5 公尺', NUDGE, 0),
          nudgeBtn('↑ 上', '往圖面上方移 0.5 公尺', 0, NUDGE), nudgeBtn('↓ 下', '往圖面下方移 0.5 公尺', 0, -NUDGE))),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openAddOpening(room.id) }, '在這個房間加門窗'),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-danger',
          onclick: () => {
            const nm = d.roomNames.get(room.id) || '房間';
            if (applyEdit((p) => removeRoom(p, room.id))) { S.selection = null; toastWithUndo(`已刪除「${nm}」`); }
          },
        }, '刪除房間')));
  }

  function openingPanel(d, op) {
    const roomName = d.roomNames.get(op.roomId) || '房間';
    const kindSel = h('select', { 'aria-label': '門窗種類' }, ['door', 'window', 'floorWindow', 'balconyDoor', 'entrance'].map((k) => h('option', { value: k }, OPENING_LABEL[k])));
    kindSel.value = op.kind;
    // 面板在按鈕有焦點時不會重畫,所以要從 store 讀「現在」的門窗,不能用建面板當下的值
    const liveOp = () => planOpenings(store.get().plan || {}).find((o) => o && o.id === op.id) || op;
    const descText = (o) => `在「${roomName}」${WALL_LABEL[o.wall] || '的牆'},寬 ${fmt1(o.width)} 公尺。可以沿著牆拖曳移動。`;
    const desc = h('p', { class: 'sub' }, descText(op));
    kindSel.addEventListener('change', () => {
      if (!applyEdit((p) => changeOpeningKind(p, op.id, kindSel.value))) kindSel.value = liveOp().kind;
    });
    const step = (delta) => {
      applyEdit((p) => resizeOpening(p, op.id, liveOp().width + delta));
      desc.textContent = descText(liveOp());
    };
    return h('div', { class: 'v-plan-sel' },
      h('div', { class: 'card-title' }, `已選:${OPENING_LABEL[op.kind] || '門窗'}`),
      desc,
      h('div', { class: 'field' }, h('label', null, '種類'), kindSel),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '縮小 0.1 公尺', onclick: () => step(-0.1) }, '窄一點'),
        h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '加寬 0.1 公尺', onclick: () => step(0.1) }, '寬一點'),
        op.kind !== 'entrance'
          ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { if (applyEdit((p) => setMainDoor(p, op.id))) toast('已設為大門'); } }, '設為大門')
          : h('span', { class: 'badge badge--wealth' }, '目前的大門')),
      h('div', { class: 'row' },
        h('button', {
          type: 'button', class: 'btn btn-sm btn-danger',
          onclick: () => { if (applyEdit((p) => removeOpening(p, op.id))) { S.selection = null; toastWithUndo('已刪除這個門窗'); } },
        }, '刪除這個門窗')));
  }

  function openAddRoom() {
    let sheet = null;
    const formWrap = h('div', { class: 'v-plan-add-dialog stack' });

    // 長寬輸入
    const curType = { val: ROOM_TYPE_ORDER[0] };
    const defaultDims = () => ROOM_DEFAULT_SIZE[curType.val] || [3.5, 3.2];
    const wIn = h('input', { type: 'number', inputmode: 'decimal', min: '0.6', max: '40', step: '0.1', value: String(defaultDims()[0]), id: 'v-plan-add-w' });
    const dIn = h('input', { type: 'number', inputmode: 'decimal', min: '0.6', max: '40', step: '0.1', value: String(defaultDims()[1]), id: 'v-plan-add-d' });
    const nameIn = h('input', { type: 'text', placeholder: '選填,例如 主臥、工作室', maxlength: '12', id: 'v-plan-add-name' });
    const areaHint = h('span', { class: 'hint' });

    const updateAreaHint = () => {
      const w = Number(wIn.value) || 0;
      const d = Number(dIn.value) || 0;
      const a = w * d;
      const ping = a * 0.3025;
      areaHint.textContent = (w > 0 && d > 0) ? `面積約 ${Math.round(a * 10) / 10} 平方公尺(約 ${Math.round(ping * 10) / 10} 坪)` : '';
    };
    wIn.addEventListener('input', updateAreaHint);
    dIn.addEventListener('input', updateAreaHint);
    updateAreaHint();

    // 類型快速選擇按鈕清單
    const typeGrid = h('div', { class: 'grid2 v-plan-type-grid' });
    const typeButtons = [];
    for (const t of ROOM_TYPE_ORDER) {
      const btn = h('button', {
        type: 'button',
        class: `btn btn-sm ${t === curType.val ? 'btn-primary' : 'btn-ghost'}`,
        onclick: () => {
          curType.val = t;
          for (const b of typeButtons) b.className = `btn btn-sm ${b.dataset.type === t ? 'btn-primary' : 'btn-ghost'}`;
          const [defW, defD] = defaultDims();
          wIn.value = String(defW);
          dIn.value = String(defD);
          updateAreaHint();
        },
      }, ROOM_TYPE_LABEL[t]);
      btn.dataset.type = t;
      typeButtons.push(btn);
      typeGrid.append(btn);
    }

    const submit = () => {
      const w = Number(wIn.value);
      const d = Number(dIn.value);
      const name = nameIn.value.trim();
      const res = applyEdit((p) => addRoom(p, curType.val, { w, d, name }));
      if (res && res.error) {
        toast(res.error);
        return;
      }
      if (sheet) sheet.close();
      if (res && res.room) {
        S.selection = { type: 'room', id: res.room.id };
        S.mode = 'edit';
        toast(`已新增「${name || ROOM_TYPE_LABEL[curType.val]}」,可自由拖曳組合對齊`);
      }
    };

    formWrap.append(
      h('div', { class: 'field' },
        h('label', null, '空間功能類別'),
        typeGrid),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'v-plan-add-w' }, '自訂寬度 (公尺)'), wIn),
        h('div', { class: 'field' }, h('label', { for: 'v-plan-add-d' }, '自訂長度/深度 (公尺)'), dIn)),
      areaHint,
      h('div', { class: 'field' },
        h('label', { for: 'v-plan-add-name' }, '自訂名稱 (選填)'),
        nameIn),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: submit }, '加入格局並自動組合'),
    );

    sheet = openSheet({ title: '新增格局區塊 (自訂長寬組合)', content: formWrap });
  }

  /** 選門窗種類,再到牆上點位置(或已有點就直接放) */
  function openAddOpening(preferRoomId, atPoint = null) {
    const list = h('div', { class: 'v-plan-menu' });
    let sheet = null;
    if (!atPoint) list.append(h('p', { class: 'sub' }, '選好種類後,在圖上點一下要放的那面牆。'));
    for (const k of OPENING_ADD_ORDER) {
      list.append(h('button', {
        type: 'button', class: 'btn btn-block',
        onclick: () => {
          if (sheet) sheet.close();
          if (atPoint) placeAt(k, atPoint, preferRoomId, false);
          else { S.placeKind = k; S.mode = 'edit'; scheduleRefresh(); }
        },
      }, k === 'entrance' ? '大門(整間房子只會有一個)' : OPENING_LABEL[k]));
    }
    sheet = openSheet({ title: atPoint ? '在這裡放什麼?' : '新增門窗', content: list });
  }

  /** 選家具種類,再到圖上點位置放入 */
  function openAddFurniture() {
    const list = h('div', { class: 'v-plan-menu' });
    let sheet = null;
    list.append(h('p', { class: 'sub' }, '選好種類後,在圖上點一下房間裡面的位置。放入後可以拖曳微調、旋轉與調整尺寸。'));
    for (const k of FURNITURE_ORDER) {
      const [w, d] = FURNITURE_DEFAULT_SIZE[k] || [1, 0.6];
      list.append(h('button', {
        type: 'button', class: 'btn btn-block',
        onclick: () => {
          if (sheet) sheet.close();
          S.placeFurn = k;
          S.mode = 'edit';
          toast(`在圖上點一下房間裡面,放入「${FURNITURE_LABEL[k]}」(按 Esc 取消)`);
          scheduleRefresh();
        },
      }, `${FURNITURE_LABEL[k]}(${w}×${d}m)`));
    }
    sheet = openSheet({ title: '放入家具', content: list });
  }

  /** 家具的編輯面板:尺寸、朝向、旋轉、刪除 */
  function furniturePanel(d, fur) {
    const roomName = d.roomNames.get(fur.roomId) || '房間';
    const wIn = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0.3', max: '6', value: String(fur.w), 'aria-label': '寬(公尺)' });
    const dIn = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0.3', max: '6', value: String(fur.d), 'aria-label': '深(公尺)' });
    const dirSel = h('select', { 'aria-label': '朝向' }, DIR8.map((dir) => h('option', { value: dir }, dir)));
    const bearingOf = (dir) => (['北', '東北', '東', '東南', '南', '西南', '西', '西北'].indexOf(dir)) * 45;
    const dirOfBearing = (b) => DIR8[Math.round((((b % 360) + 360) % 360) / 45) % 8];
    const liveFur = () => planFurniture(store.get().plan || {}).find((f) => f && f.id === fur.id) || fur;
    dirSel.value = dirOfBearing(fur.facing || 0);
    dirSel.addEventListener('change', () => {
      applyEdit((p) => setFurnitureFacing(p, fur.id, bearingOf(dirSel.value)));
    });
    const applySize = () => {
      const nw = Number(wIn.value);
      const nd = Number(dIn.value);
      const res = applyEdit((p) => resizeFurniture(p, fur.id, nw, nd));
      if (res && res.error) {
        toast(res.error);
        const cur = liveFur();
        wIn.value = String(cur.w);
        dIn.value = String(cur.d);
      }
    };
    wIn.addEventListener('change', applySize);
    dIn.addEventListener('change', applySize);
    return h('div', { class: 'v-plan-sel' },
      h('div', { class: 'card-title' }, `已選:${FURNITURE_LABEL[fur.kind] || '家具'}`),
      h('p', { class: 'sub' }, `在「${roomName}」裡面,平面位置 (${fur.x}, ${fur.y}) 公尺。拖曳可移動,方向箭頭是它的朝向。`),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, '寬(公尺)'), wIn),
        h('div', { class: 'field' }, h('label', null, '深(公尺)'), dIn)),
      h('div', { class: 'field' }, h('label', null, '朝向(面向哪個方位)'), dirSel),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { if (applyEdit((p) => rotateFurniture(p, fur.id, 90))) toast('已旋轉 90 度'); } }, '旋轉 90°'),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-danger',
          onclick: () => { if (applyEdit((p) => removeFurniture(p, fur.id))) { S.selection = null; toastWithUndo('已移除家具'); } },
        }, '移除家具')));
  }

  function placeAt(kind, pt, preferRoomId, wide) {
    const view = S.view || currentView();
    const tol = ((wide ? 30 : 16) / (view ? view.scale : 30));
    const res = applyEdit((p) => placeOpening(p, kind, pt, { preferRoomId, tol }));
    if (res && res.opening) {
      S.selection = { type: 'opening', id: res.opening.id };
      S.placeKind = null;
      toast(`已加上${OPENING_LABEL[kind]}`);
    }
  }

  // ───────────── 太極點與其他 ─────────────
  function updateMore(d) {
    const box = refs.moreBox;
    const sig = `${d.taijiMode}|${history.canUndo()}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    clear(box);
    box.append(h('div', { class: 'card-title' }, '太極點(房子的中心)'));
    box.append(h('p', { class: 'sub' },
      d.taijiMode === 'manual'
        ? '你手動指定了太極點。八個方位都是從這一點往外切的。'
        : '預設是整個房子的中心,八個方位從這裡往外切。你也可以在圖上拖曳金色十字改位置。'));
    const row = h('div', { class: 'row' });
    if (d.taijiMode === 'manual') {
      row.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { if (applyEdit((p) => setTaijiAuto(p, 'centroid'))) toast('已回到自動的中心'); } }, '回到自動中心'));
    }
    row.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: confirmChangeTemplate }, '換一個範本'));
    box.append(row);
  }

  function confirmChangeTemplate() {
    let sheet = null;
    const body = h('div', { class: 'stack' },
      h('p', null, '目前的平面圖會被清掉,重新選範本。剛清掉的內容可以在選範本的畫面按「找回剛剛的平面圖」。'),
      h('button', {
        type: 'button', class: 'btn btn-danger btn-block',
        onclick: () => {
          if (sheet) sheet.close();
          history.push(store.get().plan);
          S.selection = null;
          store.update((d) => { d.plan = null; });
        },
      }, '清掉,重新選'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => sheet && sheet.close() }, '先不要'));
    sheet = openSheet({ title: '換一個範本?', content: body });
  }

  // ───────────── 描圖照片 ─────────────
  function buildPhotoBox() {
    refs.photoSig = '';
    updatePhotoBox();
  }

  function updatePhotoBox() {
    const box = refs.photoBox;
    if (!box) return;
    const sig = S.photo ? `on|${S.photoMove}` : 'off';
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    clear(box);
    box.append(h('div', { class: 'card-title' }, '描圖照片(選用)'));
    if (!S.photo) {
      const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden', id: 'v-plan-photo-in', 'aria-label': '選擇平面圖照片' });
      input.addEventListener('change', () => { const f = input.files && input.files[0]; if (f) loadPhoto(f); input.value = ''; });
      box.append(
        h('p', { class: 'sub' }, '選一張平面圖或房子的照片,放在最底層,再照著描出房間。照片只留在這個畫面,不會存起來,離開就消失。'),
        input,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => input.click() }, '選擇照片'));
      return;
    }
    const range = (label, min, max, step, get, set, fmt) => {
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
      const val = h('span', { class: 'mono v-plan-upval' }, fmt(get()));
      inp.addEventListener('input', () => { set(Number(inp.value)); val.textContent = fmt(Number(inp.value)); scheduleRefresh(); });
      return h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'v-plan-uprow' }, inp, val));
    };
    const P = S.photo;
    box.append(
      range('透明度', 10, 90, 5, () => Math.round(P.opacity * 100), (v) => { P.opacity = v / 100; }, (v) => `${Math.round(v)}%`),
      range('大小', 30, 300, 5, () => Math.round((P.widthM / P.baseW) * 100), (v) => { P.widthM = (P.baseW * v) / 100; }, (v) => `${Math.round(v)}%`),
      range('旋轉', -180, 180, 1, () => Math.round(P.rot), (v) => { P.rot = v; }, (v) => `${Math.round(v)}°`),
      h('div', { class: 'row' },
        h('button', {
          type: 'button', class: 'chip', 'aria-pressed': S.photoMove ? 'true' : 'false',
          onclick: () => { S.photoMove = !S.photoMove; box.dataset.sig = ''; updatePhotoBox(); },
        }, S.photoMove ? '正在拖曳照片(再按一次結束)' : '拖曳移動照片'),
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: removePhoto }, '移除照片')));
  }

  function loadPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) { toast('這個檔案不是圖片'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('照片太大了,請換一張小一點的(20MB 以內)'); return; }
    let url = '';
    try { url = URL.createObjectURL(file); } catch { toast('這張照片打不開'); return; }
    const img = new Image();
    img.onload = () => {
      if (destroyed) { URL.revokeObjectURL(url); return; }
      const d = derive();
      const b = boundsFor(d.plan, {});
      const w = Math.max(4, b.maxX - b.minX);
      if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
      S.photo = { img, url, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, widthM: w, baseW: w, rot: 0, opacity: 0.5 };
      S.photoMove = false;
      if (refs.photoBox) refs.photoBox.dataset.sig = '';
      scheduleRefresh();
      toast('照片已放在最底層,可以調透明度與大小');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('這張照片打不開,請換一張'); };
    img.src = url;
  }

  function removePhoto() {
    if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
    S.photo = null;
    S.photoMove = false;
    if (refs.photoBox) refs.photoBox.dataset.sig = '';
    scheduleRefresh();
  }

  // ───────────── 方位解讀面板 ─────────────
  function openSector(k) {
    const d = derive();
    if (!d.sectorsVisible || k < 0 || k > 7) return;
    const gua = GUA[k];
    S.hl = k;
    scheduleRefresh();
    const det = sectorDetails(d.report, renderedOf(d.report), gua, { palaces: d.palaces, roomNames: d.roomNames, layerId: d.layer });
    const body = h('div', { class: 'v-plan-sheet stack' });

    body.append(h('div', null,
      h('div', { class: 'card-title' }, '這個方位在你家'),
      det.rooms.length
        ? h('ul', { class: 'list' }, det.rooms.map((r) => h('li', null, h('span', null, `${r.name}:佔這個方位的 ${Math.round(r.pct * 100)}%(約 ${fmt1(r.area)} ㎡)`))))
        : h('p', { class: 'sub' }, '這個方位目前沒有落在任何房間裡。')));

    if (det.lines.length) {
      const ordered = [...det.lines].sort((a, b) => (a.layer === d.layer ? -1 : b.layer === d.layer ? 1 : 0));
      body.append(h('div', null,
        h('div', { class: 'card-title' }, '各種看法'),
        h('ul', { class: 'list v-plan-lines' }, ordered.map((l) => h('li', { class: l.layer === d.layer ? 'on' : '' },
          h('div', null,
            h('div', { class: 'row tight' }, h('strong', null, l.label), h('span', { class: TONE_BADGE[l.tone] || 'badge' }, TONE_TEXT[l.tone] || '一般')),
            h('div', { class: 'sub' }, l.text)))))));
    }

    if (det.cards.length) {
      const items = [...det.cards].sort((a, b) => (a.layer === d.layer ? -1 : b.layer === d.layer ? 1 : 0));
      body.append(h('div', null,
        h('div', { class: 'card-title' }, '更詳細的說明'),
        h('div', { class: 'stack' }, items.map((it, i) => cardEl(it.card, i === 0 && it.layer === d.layer)))));
    } else if (!det.lines.length) {
      body.append(h('p', { class: 'sub' }, '這個方位目前沒有更多說明。'));
    }
    body.append(h('p', { class: 'faint v-plan-foot' }, '傳統民俗參考,請勿過度迷信。'));
    openSheet({
      title: `${det.title}`,
      content: body,
      onClose: () => { if (S.hl === k) { S.hl = -1; scheduleRefresh(); } },
    });
  }

  function cardEl(card, open) {
    const badges = (card.badges || []).map((b) => h('span', { class: 'badge' }, b));
    return h('details', { class: 'v-plan-card', open: open ? true : null },
      h('summary', null, card.headline),
      h('div', { class: 'row tight v-plan-badges' }, badges),
      h('p', null, card.body),
      card.schoolNote ? h('p', { class: 'sub' }, card.schoolNote) : null,
      card.footnote ? h('p', { class: 'faint' }, card.footnote) : null);
  }

  // ───────────── 縮放 ─────────────
  function zoomAt(factor, mx, my) {
    const v0 = S.view || currentView();
    if (!v0) return;
    const nz = clamp(S.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    if (nz === S.zoom) return;
    const anchor = v0.fromPx(mx, my);
    S.zoom = nz;
    const v1 = currentView();
    const [px, py] = v1.toPx(anchor);
    S.pan = { x: S.pan.x + (mx - px), y: S.pan.y + (my - py) };
    S.view = currentView();
    scheduleRefresh();
  }
  function zoomBy(f) { zoomAt(f, S.W / 2, S.H / 2); }

  // ───────────── Pointer 互動 ─────────────
  function bindCanvas() {
    const cv = refs.canvas;
    const safe = (fn) => (e) => { try { fn(e); } catch (err) { console.error('plan pointer', err); cancelDrag(); } };
    cv.addEventListener('pointerdown', safe(onDown));
    cv.addEventListener('pointermove', safe(onMove));
    cv.addEventListener('pointerup', safe(onUp));
    cv.addEventListener('pointercancel', safe(onCancel));
    cv.addEventListener('wheel', safe(onWheel), { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { measure(); scheduleRefresh(); });
      ro.observe(refs.wrap);
      cleanups.push(() => ro.disconnect());
    }
  }

  const posOf = (e) => {
    const r = refs.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const ptOf = (px) => {
    const v = S.view || currentView();
    return v ? v.fromPx(px.x, px.y) : [0, 0];
  };
  const tolM = (px) => px / ((S.view || currentView() || { scale: 30 }).scale);

  function cancelDrag() {
    S.drag = null;
    S.preview = null;
    S.taijiPreview = null;
    S.invalid = false;
    S.lockBounds = null;
    S.pinch = null;
    scheduleRefresh();
  }

  function onWheel(e) {
    e.preventDefault();
    const p = posOf(e);
    zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!S.view) S.view = currentView();
    if (!S.view) return;
    try { refs.canvas.setPointerCapture(e.pointerId); } catch { /* 部分瀏覽器可能失敗,忽略 */ }
    const p = posOf(e);
    S.pointers.set(e.pointerId, p);
    if (S.pointers.size === 2) {
      // 雙指:取消目前的單指手勢,改成縮放
      S.drag = { kind: 'pinch' };
      S.preview = null; S.taijiPreview = null; S.invalid = false; S.lockBounds = null;
      const [a, b] = [...S.pointers.values()];
      S.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (S.pointers.size > 2) return;

    const d = derive();
    if (!d.plan) return;
    const touch = e.pointerType !== 'mouse';
    const tolPx = touch ? 22 : 12;
    const slop = touch ? 9 : 4;
    const pt = ptOf(p);
    const view = S.view;
    S.lockBounds = boundsNow();
    const drag = { kind: 'pan', start: p, last: p, startPt: pt, moved: false, slop, touch };
    S.drag = drag;

    // 1. 太極點
    const taiji = S.taijiPreview || d.taiji;
    if (taiji) {
      const [tx, ty] = view.toPx(taiji);
      if (Math.hypot(p.x - tx, p.y - ty) <= tolPx + 6) {
        drag.kind = 'taiji';
        return;
      }
    }
    // 2. 拖曳照片
    if (S.photo && S.photoMove) { drag.kind = 'photo'; return; }
    if (S.mode !== 'edit') return; // 看方位模式:其餘都是平移或點一下
    if (S.placeKind) return;       // 等待點牆:平移或點一下
    if (S.placeFurn) return;       // 等待點圖放家具:平移或點一下
    // 3. 選取中房間的手把
    const tm = tolM(tolPx + 2);
    if (S.selection && S.selection.type === 'room') {
      const room = planRooms(d.plan).find((r) => r.id === S.selection.id);
      if (room && isAxisRect(room.polygon)) {
        const hd = hitHandle(roomRect(room), pt, tm);
        if (hd) { Object.assign(drag, { kind: 'resize', handle: hd, roomId: room.id, rect0: roomRect(room) }); return; }
      }
    }
    // 4. 門窗
    const oid = hitOpening(d.plan, pt, tolM(tolPx));
    if (oid) {
      S.selection = { type: 'opening', id: oid };
      Object.assign(drag, { kind: 'openingMove', openingId: oid });
      scheduleRefresh();
      return;
    }
    // 4.5 家具(蓋在房間上面,先於房間命中)
    const fid = hitFurniture(d.plan, pt, tolM(tolPx));
    if (fid) {
      S.selection = { type: 'furniture', id: fid };
      Object.assign(drag, { kind: 'furnMove', furnId: fid });
      scheduleRefresh();
      return;
    }
    // 5. 房間(等移動超過門檻才開始搬)
    const rid = hitRoom(d.plan, pt);
    if (rid) {
      const room = planRooms(d.plan).find((r) => r.id === rid);
      const wasSelected = S.selection && S.selection.type === 'room' && S.selection.id === rid;
      Object.assign(drag, { kind: 'roomPending', roomId: rid, rect0: roomRect(room), wasSelected });
      if (!wasSelected) { S.selection = { type: 'room', id: rid }; scheduleRefresh(); }
      return;
    }
    // 6. 空白處:平移;點一下取消選取
  }

  function onMove(e) {
    const prev = S.pointers.get(e.pointerId);
    if (!prev) return;
    const p = posOf(e);
    S.pointers.set(e.pointerId, p);
    const drag = S.drag;
    if (!drag) return;

    if (drag.kind === 'pinch') {
      if (S.pointers.size < 2 || !S.pinch) return;
      const [a, b] = [...S.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (S.pinch.dist > 5) zoomAt(dist / S.pinch.dist, mx, my);
      S.pan = { x: S.pan.x + (mx - S.pinch.mx), y: S.pan.y + (my - S.pinch.my) };
      S.pinch = { dist, mx, my };
      S.view = currentView();
      scheduleRefresh();
      return;
    }
    if (S.pointers.size > 1) return;

    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < drag.slop) return;
    drag.moved = true;
    const view = S.view || currentView();
    const pt = view.fromPx(p.x, p.y);
    const d = derive();

    switch (drag.kind) {
      case 'pan':
        S.pan = { x: S.pan.x + (p.x - drag.last.x), y: S.pan.y + (p.y - drag.last.y) };
        S.view = currentView();
        break;
      case 'photo':
        if (S.photo) {
          S.photo.cx += (p.x - drag.last.x) / view.scale;
          S.photo.cy -= (p.y - drag.last.y) / view.scale;
        }
        break;
      case 'taiji':
        S.taijiPreview = [snap(pt[0]), snap(pt[1])];
        break;
      case 'roomPending':
        drag.kind = 'roomMove';
        // fallthrough
      case 'roomMove': {
        const room = planRooms(d.plan).find((r) => r.id === drag.roomId);
        if (!room || !isAxisRect(room.polygon)) break;
        const rect = moveRect(drag.rect0, pt[0] - drag.startPt[0], pt[1] - drag.startPt[1]);
        drag.rect = rect;
        const draft = clone(d.plan);
        const res = applyRoomRect(draft, drag.roomId, rect);
        S.preview = draft;
        S.invalid = !!res.error;
        break;
      }
      case 'resize': {
        const rect = resizeRect(drag.rect0, drag.handle, pt);
        drag.rect = rect;
        const draft = clone(d.plan);
        const res = applyRoomRect(draft, drag.roomId, rect);
        S.preview = draft;
        S.invalid = !!res.error;
        break;
      }
      case 'openingMove': {
        const draft = clone(d.plan);
        const res = moveOpening(draft, drag.openingId, pt);
        drag.ok = !res.error;
        if (!res.error) S.preview = draft;
        break;
      }
      case 'furnMove': {
        const draft = clone(d.plan);
        const res = moveFurniture(draft, drag.furnId, pt);
        drag.ok = !res.error;
        if (!res.error) { S.preview = draft; S.invalid = false; }
        break;
      }
      default:
        break;
    }
    drag.last = p;
    scheduleRefresh();
  }

  function onUp(e) {
    const known = S.pointers.has(e.pointerId);
    const p = posOf(e);
    S.pointers.delete(e.pointerId);
    try { refs.canvas.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    if (!known) return;
    const drag = S.drag;
    if (!drag) return;
    if (drag.kind === 'pinch') {
      if (S.pointers.size === 0) { S.drag = null; S.pinch = null; S.lockBounds = null; scheduleRefresh(); }
      return;
    }
    S.drag = null;
    const d = derive();
    S.preview = null;
    S.taijiPreview = null;
    S.invalid = false;
    S.lockBounds = null;

    if (drag.moved) {
      switch (drag.kind) {
        case 'taiji': {
          const view = S.view || currentView();
          const pt = view.fromPx(p.x, p.y);
          if (applyEdit((pl) => setTaijiManual(pl, [snap(pt[0]), snap(pt[1])]))) toast('已把太極點改成手動位置');
          break;
        }
        case 'roomMove':
        case 'resize':
          if (drag.rect) applyEdit((pl) => applyRoomRect(pl, drag.roomId, drag.rect));
          break;
        case 'openingMove': {
          const view = S.view || currentView();
          const pt = view.fromPx(p.x, p.y);
          applyEdit((pl) => moveOpening(pl, drag.openingId, pt));
          break;
        }
        case 'furnMove': {
          const view = S.view || currentView();
          const pt = view.fromPx(p.x, p.y);
          applyEdit((pl) => moveFurniture(pl, drag.furnId, pt));
          break;
        }
        default:
          break;
      }
      S.view = null;
      scheduleRefresh();
      return;
    }

    // 沒有移動 = 點一下
    const pt = drag.startPt;
    if (drag.kind === 'taiji') {
      toast('拖曳金色十字,可以改太極點(房子的中心)的位置');
    } else if (S.mode === 'view') {
      const t = d.taiji;
      if (d.sectorsVisible && t) {
        const k = sectorIndexAt(t, pt, d.up);
        if (k >= 0) openSector(k);
      }
    } else if (S.placeKind) {
      placeAt(S.placeKind, pt, S.selection && S.selection.type === 'room' ? S.selection.id : null, true);
    } else if (S.placeFurn) {
      const kind = S.placeFurn;
      const res = applyEdit((pl) => addFurniture(pl, kind, pt));
      if (res && res.error) {
        toast(res.error);
      } else if (res && res.furniture) {
        S.selection = { type: 'furniture', id: res.furniture.id };
        S.placeFurn = null;
        toast(`已放入「${FURNITURE_LABEL[kind] || '家具'}」,拖曳可移到正確位置`);
      }
    } else if (drag.kind === 'roomPending') {
      // 已選中的房間再點它的牆 → 加門窗選單
      if (drag.wasSelected) {
        const view = S.view || currentView();
        const cands = wallCandidates(d.plan, pt, 12 / view.scale).filter((c) => c.roomId === drag.roomId);
        if (cands.length) openAddOpening(drag.roomId, pt);
      }
    } else if (drag.kind === 'pan') {
      if (S.selection) { S.selection = null; }
    }
    S.view = null;
    scheduleRefresh();
  }

  function onCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.pointers.size === 0) cancelDrag();
  }

  // ───────────── 組裝 ─────────────
  function build() {
    S.view = null;
    S.preview = null;
    S.drag = null;
    S.pointers.clear();
    const d = derive();
    if (!d.plan) buildChooser();
    else buildEditor();
    if (d.plan) {
      modeChosen = modeChosen && built === 'editor';
      refresh();
    }
  }

  const unsub = store.subscribe(() => scheduleRefresh());
  cleanups.push(unsub);

  // 系統深淺色改變時(主題設為「跟隨系統」),重讀色票再畫
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { S.palette = null; scheduleRefresh(); };
    if (mq.addEventListener) { mq.addEventListener('change', onScheme); cleanups.push(() => mq.removeEventListener('change', onScheme)); }
  }
  // 等待點牆放門窗時,按 Esc 取消
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.sheet')) return;
    if (S.placeKind || S.placeFurn) { S.placeKind = null; S.placeFurn = null; scheduleRefresh(); }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  const onWinResize = () => { measure(); scheduleRefresh(); };
  window.addEventListener('resize', onWinResize);
  cleanups.push(() => window.removeEventListener('resize', onWinResize));

  build();
  // 字型與版面穩定後再量一次
  scheduleRefresh();

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* 忽略 */ } }
      if (S.photo && S.photo.url) { try { URL.revokeObjectURL(S.photo.url); } catch { /* 忽略 */ } }
      S.photo = null;
      S.pointers.clear();
    },
  };
}

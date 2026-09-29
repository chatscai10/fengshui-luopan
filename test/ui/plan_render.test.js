// 繪圖與畫面模組的冒煙測試:用假的 canvas 記錄呼叫,確認各種狀態(有無方位、選取、拖曳預覽、壞資料)都畫得完、不丟例外;
// 也確認畫面模組在 node 底下可以 import(頂層沒有碰 document / window)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPlan, viewFor } from '../../src/ui/canvas/planRenderer.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import { createStore } from '../../src/ui/store.js';
import { layerCells, wealthMarkers } from '../../src/ui/plan/layers.js';
import { roomNameMap } from '../../src/ui/plan/labels.js';
import { GUA } from '../../src/core/geo.js';

const PAL = {
  bg: '#000', surface: '#111', surface2: '#222', line: 'rgba(1,2,3,.1)', lineStrong: 'rgba(1,2,3,.3)', text: '#eee', dim: '#aaa', faint: '#888',
  gold: '#d6b25a', goldBright: '#e8cb7a', onGold: '#111', jade: '#5fa37f', terracotta: '#c9705a', sky: '#6a9cdc', cinnabar: '#f00',
  room: { living: '#d6b25a', bedroom: '#6a9cdc', kitchen: '#c9705a', toilet: '#5fa37f', study: '#9a86c8', entry: '#888', balcony: '#4fa3a5', stair: '#a08a6a', other: '#b9ae95' },
};

function fakeCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_t, name) {
      if (name === 'measureText') return (t) => ({ width: String(t).length * 7 });
      if (name === 'calls') return calls;
      return (...a) => { calls.push([String(name), a]); };
    },
    set(_t, name, v) { calls.push(['set:' + String(name), [v]]); return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { canvas, calls };
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

function scene(template = 'three') {
  const store = createStore(memStorage());
  store.update((d) => { d.facing.bearing = 210; d.building.builtYear = 2010; d.plan = buildTemplate(template).plan; });
  const report = store.report();
  const plan = store.get().plan;
  const enginePlan = store.input().plan;
  return { store, report, plan, enginePlan };
}

globalThis.window = globalThis.window || { devicePixelRatio: 2 };

test('drawPlan:只有平面圖、沒有方位', () => {
  const { plan } = scene();
  const { canvas, calls } = fakeCanvas();
  const view = drawPlan(canvas, { cssW: 343, cssH: 343, plan, palette: PAL, view: {}, taiji: [5, 4.9], sectors: { visible: false, cells: {} }, markers: [], up: null });
  assert.ok(view.scale > 0);
  assert.ok(calls.length > 50);
  assert.equal(canvas.width, 686, '高 DPI:寬度 = CSS 寬 × DPR');
  // 沒有方位時不畫卦名標籤
  assert.ok(!calls.some(([n, a]) => n === 'fillText' && /·/.test(String(a[0]))));
});

test('drawPlan:每個圖層的方位扇形、卦名標籤、財位標記都畫得出來', () => {
  const { report, plan, enginePlan } = scene();
  for (const layer of ['wealth', 'bazhai', 'xuankong', 'annual', 'none']) {
    const { canvas, calls } = fakeCanvas();
    const lc = layerCells(report, layer);
    drawPlan(canvas, {
      cssW: 343, cssH: 343, plan, palette: PAL, view: {}, taiji: report.planShares.taiji, up: enginePlan.planUpBearing,
      sectors: { visible: true, tint: layer !== 'none', cells: lc.cells, highlight: 5 },
      markers: layer === 'wealth' ? wealthMarkers(report) : [], selection: { type: 'room', id: 'master' }, showHandles: true,
      roomNames: roomNameMap(plan),
    });
    const texts = calls.filter(([n]) => n === 'fillText').map(([, a]) => String(a[0]));
    for (const g of GUA) assert.ok(texts.some((t) => t.startsWith(`${g}·`)), `${layer} 應畫出 ${g} 的卦名`);
    assert.ok(texts.includes('北'), '北方箭頭');
    assert.ok(texts.includes('太極點'));
    assert.ok(texts.includes('門'), '大門標示');
    if (layer === 'wealth') assert.ok(texts.includes('財'));
    if (layer === 'bazhai') assert.ok(texts.some((t) => /生氣|延年|天醫|伏位/.test(t)));
    if (layer === 'xuankong') assert.ok(texts.some((t) => /山\d 向\d/.test(t)));
    if (layer === 'annual') assert.ok(texts.some((t) => /五黃|二黑|八白/.test(t)));
  }
});

test('drawPlan:拖曳預覽(無效紅框)、照片、太極點在外框外、壞資料都不丟例外', () => {
  const { report, plan, enginePlan } = scene('two');
  const lc = layerCells(report, 'wealth');
  const base = { cssW: 300, cssH: 400, palette: PAL, view: { zoom: 3, pan: { x: -40, y: 25 } }, up: enginePlan.planUpBearing, roomNames: new Map() };
  const img = { naturalWidth: 400, naturalHeight: 300 };
  const cases = [
    { plan, taiji: [99, 99], sectors: { visible: true, tint: true, cells: lc.cells, highlight: -1 }, invalid: true, selection: { type: 'room', id: 'bed1' }, photo: { img, cx: 4, cy: 4, widthM: 8, rot: 30, opacity: 0.5 }, taijiManual: true },
    { plan: { version: 1, outline: 'x', rooms: [null, { id: 'a', polygon: 'zz' }, { id: 'b', type: 'living', polygon: [[0, 0], [NaN, 1], [2, 2]] }], openings: [{}, null, { roomId: 'nope' }] }, taiji: null, sectors: { visible: false, cells: {} } },
    { plan: {}, taiji: [1, 1], sectors: { visible: true, cells: {} }, up: 10 },
    { plan, taiji: [4, 4], sectors: { visible: true, tint: true, cells: {}, highlight: 99 }, selection: { type: 'opening', id: 'd1' }, photo: { img: null }, markers: [{ point: [1, 1], tier: 'consider', isMing: true }, { point: [NaN, 0], tier: 'suitable' }] },
  ];
  for (const c of cases) {
    const { canvas } = fakeCanvas();
    assert.doesNotThrow(() => drawPlan(canvas, { ...base, ...c }));
  }
});

test('viewFor 與 drawPlan 使用同一份視圖:互動的 fromPx 與畫出來的位置一致', () => {
  const { plan } = scene();
  const { canvas } = fakeCanvas();
  const v = viewFor(plan, 343, 343, { zoom: 1.5, pan: { x: 10, y: -20 }, labels: true });
  const used = drawPlan(canvas, { cssW: 343, cssH: 343, plan, palette: PAL, viewObj: v, taiji: null, sectors: { visible: false, cells: {} } });
  assert.equal(used, v);
  const [px, py] = v.toPx([3.3, 4.4]);
  const [x, y] = v.fromPx(px, py);
  assert.ok(Math.abs(x - 3.3) < 1e-9 && Math.abs(y - 4.4) < 1e-9);
});

test('畫面模組可以在 node 匯入(頂層不碰 document / window),並匯出 mount', async () => {
  const saved = globalThis.window;
  delete globalThis.window;
  try {
    const mod = await import('../../src/ui/views/plan.js');
    assert.equal(typeof mod.mount, 'function');
  } finally {
    if (saved) globalThis.window = saved;
  }
});

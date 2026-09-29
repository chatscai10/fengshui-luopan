// 簡單模式寫進 store 的欄位(EASY_SPEC 3.1、第 6 節):預設模式、壞值修復、送進引擎的不確定度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_STATE } from '../../src/ui/store.js';
import { repairDraft } from '../../src/ui/repair.js';

function memStorage(initialText) {
  const m = new Map();
  if (initialText !== undefined) m.set('fengshui.state.v1', initialText);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}
const storeFrom = (obj) => createStore(memStorage(obj === undefined ? undefined : JSON.stringify(obj)));

// 與 repair.test.js 的 GOOD 相同(沒有任何簡單模式的新鍵)
const GOOD = {
  v: 1,
  facing: { bearing: 175, doorBearing: null, source: 'manual', sigma: null, lockedAtMs: null, cityId: '台北' },
  building: { type: 'apartment', builtYear: 2005, moveInYear: null, renovation: 'none', floor: null },
  residents: [{ id: 'a', name: '小明', gender: 'M', birth: '1985-06-15', utcOffsetMinutes: 480 }],
  mainResidentId: null,
  plan: null,
  settings: {},
  ui: { tab: 'compass', layer: 'wealth', theme: 'auto' },
};
const withUi = (ui) => ({ ...GOOD, ui: { ...GOOD.ui, ...ui } });
const withFacing = (f) => ({ ...GOOD, facing: { ...GOOD.facing, ...f } });

test('新 store 預設簡單模式;DEFAULT_STATE 的 facing.check 是 null', () => {
  assert.equal(DEFAULT_STATE.ui.mode, 'easy');
  assert.equal(DEFAULT_STATE.facing.check, null);
  assert.equal(storeFrom().get().ui.mode, 'easy');
});

test('舊存檔沒有 mode → easy;存 pro 保留;壞值 → easy', () => {
  assert.equal(storeFrom(GOOD).get().ui.mode, 'easy');
  assert.equal(storeFrom(withUi({ mode: 'pro' })).get().ui.mode, 'pro');
  assert.equal(storeFrom(withUi({ mode: 'easy' })).get().ui.mode, 'easy');
  for (const bad of ['x', 5, null, true, {}, []]) {
    assert.equal(storeFrom(withUi({ mode: bad })).get().ui.mode, 'easy', JSON.stringify(bad));
  }
});

test('repairDraft(GOOD) 仍回 false(沒有新鍵時不補)', () => {
  const d = JSON.parse(JSON.stringify(GOOD));
  assert.equal(repairDraft(d), false);
  assert.deepEqual(d, GOOD);
});

test('合法的簡單模式欄位不被改動', () => {
  const d = JSON.parse(JSON.stringify({
    ...GOOD,
    facing: { ...GOOD.facing, source: 'pick8', check: { n: 2, spreadDeg: 2.5, lockedAtMs: 1000 } },
    ui: { ...GOOD.ui, mode: 'pro', easyStep: 'layout', easyLayout: { template: 'two', doorSide: 'center' }, easyIntroShown: true },
  }));
  const before = JSON.stringify(d);
  assert.equal(repairDraft(d), false);
  assert.equal(JSON.stringify(d), before);
  const d2 = JSON.parse(JSON.stringify(withFacing({ source: 'sensor', check: null })));
  d2.ui.easyLayout = null;
  assert.equal(repairDraft(d2), false);
});

test('easyStep 壞值 → 刪除', () => {
  for (const bad of ['x', 3, null, {}]) {
    const s = storeFrom(withUi({ easyStep: bad })).get();
    assert.ok(!('easyStep' in s.ui), JSON.stringify(bad));
  }
  for (const ok of ['facing', 'layout', 'result']) assert.equal(storeFrom(withUi({ easyStep: ok })).get().ui.easyStep, ok);
});

test('easyLayout 格式不對 → null', () => {
  const bads = ['x', 5, [], {}, { template: 'custom', doorSide: 'left' }, { template: 'two', doorSide: 'up' }, { template: 'two' }];
  for (const bad of bads) assert.equal(storeFrom(withUi({ easyLayout: bad })).get().ui.easyLayout, null, JSON.stringify(bad));
  assert.deepEqual(storeFrom(withUi({ easyLayout: { template: 'shop', doorSide: 'right' } })).get().ui.easyLayout, { template: 'shop', doorSide: 'right' });
});

test('easyIntroShown 不是 boolean → 刪除', () => {
  for (const bad of ['yes', 1, null, {}]) {
    const s = storeFrom(withUi({ easyIntroShown: bad })).get();
    assert.ok(!('easyIntroShown' in s.ui), JSON.stringify(bad));
  }
  assert.equal(storeFrom(withUi({ easyIntroShown: false })).get().ui.easyIntroShown, false);
});

test('facing.source 不是 manual/sensor/pick8 → manual;check 格式不對 → null', () => {
  for (const ok of ['manual', 'sensor', 'pick8']) assert.equal(storeFrom(withFacing({ source: ok })).get().facing.source, ok);
  for (const bad of ['gps', 3, null]) assert.equal(storeFrom(withFacing({ source: bad })).get().facing.source, 'manual', JSON.stringify(bad));
  const badChecks = ['x', 5, [], { n: 0, spreadDeg: 1, lockedAtMs: 1 }, { n: 4, spreadDeg: 1, lockedAtMs: 1 },
    { n: 2, spreadDeg: -1, lockedAtMs: 1 }, { n: 2, spreadDeg: 'a', lockedAtMs: 1 }, { n: 2, spreadDeg: 1 }, { n: 1.5, spreadDeg: null, lockedAtMs: 1 }];
  for (const bad of badChecks) assert.equal(storeFrom(withFacing({ check: bad })).get().facing.check, null, JSON.stringify(bad));
  const good = { n: 1, spreadDeg: null, lockedAtMs: 5 };
  assert.deepEqual(storeFrom(withFacing({ check: good })).get().facing.check, good);
});

test('parseBackup 讀舊備份(沒有 mode)得到 easy', () => {
  const st = storeFrom();
  assert.equal(st.parseBackup(JSON.stringify(GOOD)).ui.mode, 'easy');
  assert.equal(st.parseBackup(JSON.stringify(withUi({ mode: 'pro' }))).ui.mode, 'pro');
});

test('input().facing.uncertainty:σ、兩次差距與設定值', () => {
  const U = (facing, settings = {}) => storeFrom({ ...withFacing(facing), settings }).input().facing.uncertainty;
  assert.equal(U({}), null, '沒有 sigma 與 check');
  assert.equal(U({ source: 'sensor', sigma: 2, lockedAtMs: 1000 }), 5);
  assert.equal(U({ source: 'sensor', sigma: 4, lockedAtMs: 1000 }), 8);
  assert.equal(U({ source: 'sensor', sigma: 1, lockedAtMs: 1000, check: { n: 2, spreadDeg: 7, lockedAtMs: 1000 } }), 7);
  assert.equal(U({ source: 'sensor', sigma: 1, lockedAtMs: 1000, check: { n: 2, spreadDeg: 7, lockedAtMs: 999 } }), 5, 'lockedAtMs 不符 → 忽略差距');
  assert.equal(U({ source: 'manual', sigma: null, lockedAtMs: 1000, check: { n: 2, spreadDeg: 7, lockedAtMs: 1000 } }), null, '來源不是手機指北針 → 忽略差距');
  assert.equal(U({ source: 'sensor', sigma: 1, lockedAtMs: 1000 }, { measureUncertainty: 8 }), 8);
});

test('沒有 check 時與舊公式 max(5, 2σ) 相同', () => {
  for (const sigma of [0, 0.5, 1, 2, 2.5, 3, 4.2, 9]) {
    const u = storeFrom(withFacing({ source: 'sensor', sigma, lockedAtMs: 1 })).input().facing.uncertainty;
    assert.equal(u, Math.max(5, 2 * sigma), String(sigma));
  }
});

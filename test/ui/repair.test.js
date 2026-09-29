// store 載入時的壞資料修復:localStorage 被改壞、舊版備份、手改的匯入檔都不能讓引擎丟例外或讓畫面白屏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/ui/store.js';
import { repairDraft, dropInvalidSettings } from '../../src/ui/repair.js';
import { analyzeHouse } from '../../src/core/analyze.js';

function memStorage(initialText) {
  const m = new Map();
  if (initialText !== undefined) m.set('fengshui.state.v1', initialText);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}
const storeFrom = (obj) => createStore(memStorage(typeof obj === 'string' ? obj : JSON.stringify(obj)));

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

test('損壞的 JSON 與非物件的存檔:退回預設,不丟例外', () => {
  for (const raw of ['{not json', '', 'null', '[1,2]', '42', '"x"', 'true']) {
    const st = storeFrom(raw);
    assert.equal(st.get().facing.bearing, null, raw);
    assert.deepEqual(st.get().residents, [], raw);
    assert.equal(st.report().error, 'NO_FACING', raw);
  }
});

test('欄位型別錯誤的存檔:report() 不再是 INVALID_*', () => {
  const cases = {
    '年份是0': { building: { ...GOOD.building, builtYear: 0 } },
    '年份是小數': { building: { ...GOOD.building, builtYear: 2005.5 } },
    '年份是字串': { building: { ...GOOD.building, builtYear: '2005' } },
    '住戶陣列裡有 null': { residents: [null, 5, 's', ...GOOD.residents] },
    '住戶不是陣列': { residents: { a: 1 } },
    '主要住戶不是字串': { mainResidentId: { a: 1 } },
    '主要住戶指向不存在的人': { mainResidentId: 'nobody' },
    '設定有未知鍵': { settings: { tierProfile: 5, foo: 1 } },
    '設定是字串': { settings: 'x' },
    '設定是陣列': { settings: [1, 2] },
    '設定型別錯': { settings: { northMode: 5, lockSeconds: 'x', southUp: 'yes' } },
    '設定值不合法': { settings: { northMode: 'zzz', wealthProfile: 'zzz', xiaGuaHalfWidth: 99 } },
    '朝向是字串': { facing: { ...GOOD.facing, bearing: 'abc' } },
    '朝向不是物件': { facing: 5 },
    '建築不是物件': { building: 'x' },
    'ui是null': { ui: null },
  };
  for (const [name, patch] of Object.entries(cases)) {
    const st = storeFrom({ ...GOOD, ...patch });
    if (name === '朝向是字串' || name === '朝向不是物件') {
      assert.equal(st.report().error, 'NO_FACING', name);
      continue;
    }
    const r = st.report();
    assert.equal(r.error, undefined, `${name}: ${r.error}`);
  }
});

test('朝向超出 0 到 360 度:折回範圍內', () => {
  assert.equal(storeFrom({ ...GOOD, facing: { ...GOOD.facing, bearing: 725 } }).get().facing.bearing, 5);
  assert.equal(storeFrom({ ...GOOD, facing: { ...GOOD.facing, bearing: -30 } }).get().facing.bearing, 330);
  assert.equal(storeFrom({ ...GOOD, facing: { ...GOOD.facing, bearing: 175 } }).get().facing.bearing, 175);
  assert.equal(storeFrom({ ...GOOD, facing: { ...GOOD.facing, bearing: 0 } }).get().facing.bearing, 0);
  assert.equal(storeFrom({ ...GOOD, facing: { ...GOOD.facing, sigma: -2 } }).get().facing.sigma, null);
});

test('平面圖不是物件時丟掉;是物件但內容壞的原樣保留給畫面說明', () => {
  assert.equal(storeFrom({ ...GOOD, plan: 'x' }).get().plan, null);
  assert.equal(storeFrom({ ...GOOD, plan: [] }).get().plan, null);
  const kept = storeFrom({ ...GOOD, plan: { rooms: null } });
  assert.deepEqual(kept.get().plan, { rooms: null });
  assert.doesNotThrow(() => kept.report());
});

test('repairDraft:乾淨的草稿不會被改動;主要住戶與住戶同步', () => {
  const d = JSON.parse(JSON.stringify({ ...GOOD, mainResidentId: 'a' }));
  assert.equal(repairDraft(d), false);
  d.residents = [];
  assert.equal(repairDraft(d), true);
  assert.equal(d.mainResidentId, null);
});

test('修復後的正常操作:改朝向、加住戶、還原都不被修復邏輯吃掉', () => {
  const st = storeFrom(GOOD);
  st.update((d) => { d.mainResidentId = 'a'; d.settings.northMode = 'true'; });
  assert.equal(st.get().mainResidentId, 'a');
  assert.equal(st.get().settings.northMode, 'true');
  st.update((d) => { d.residents = d.residents.filter((r) => r.id !== 'a'); d.mainResidentId = null; });
  st.update((d) => { d.residents.push({ id: 'a', name: '小明', gender: 'M', birth: '1985-06-15', utcOffsetMinutes: 480 }); d.mainResidentId = 'a'; });
  assert.equal(st.get().mainResidentId, 'a');
});

test('importJSON:壞設定值被丟掉,版本不符仍報錯', () => {
  const st = storeFrom(GOOD);
  st.importJSON(JSON.stringify({ ...GOOD, settings: { northMode: 'zzz', allowWaterHint: true } }));
  assert.deepEqual(st.get().settings, { allowWaterHint: true });
  assert.throws(() => st.importJSON(JSON.stringify({ ...GOOD, v: 99 })), /版本/);
  assert.throws(() => st.importJSON('not json'));
  assert.equal(st.get().settings.allowWaterHint, true); // 匯入失敗不動原資料
});

test('parseBackup / importJSON:像備份的才收,收之前不動原資料', () => {
  const st = storeFrom(GOOD);
  for (const bad of ['{oops', '', 'null', '[1,2]', '"hi"', '123', '{"v":1}', '{"foo":1}', '{"v":1,"facing":5}', JSON.stringify({ ...GOOD, v: 2 })]) {
    assert.throws(() => st.parseBackup(bad), undefined, bad);
    assert.throws(() => st.importJSON(bad), undefined, bad);
  }
  assert.equal(st.get().facing.bearing, 175);
  const parsed = st.parseBackup(JSON.stringify({ ...GOOD, facing: { ...GOOD.facing, bearing: 90 } }));
  assert.equal(parsed.facing.bearing, 90);
  assert.equal(st.get().facing.bearing, 175); // parseBackup 只驗證不寫入
});

test('dropInvalidSettings:只刪會讓引擎丟例外的鍵', () => {
  const s = { northMode: 'zzz', allowWaterHint: true, sanshaArc: 'core3' };
  assert.deepEqual(dropInvalidSettings(s, analyzeHouse), ['northMode']);
  assert.deepEqual(s, { allowWaterHint: true, sanshaArc: 'core3' });
});

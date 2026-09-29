// 「方向差幾度,排第一的財位會不會換」(EASY_SPEC 2.2、8.12)、送進引擎的不確定度(第 6 節)、
// facing.check 的新欄位修復,以及簡單模式縮圖的白話方位標籤(8.13)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, inputOf, facingUncertaintyOf, PICK8_UNCERTAINTY } from '../../src/ui/store.js';
import { repairDraft } from '../../src/ui/repair.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import { withDoorSide, DOOR_SIDES } from '../../src/ui/easy/layout.js';
import { wealthStability, sameTopForPlans, reportAt, topOf } from '../../src/ui/easy/stability.js';
import { layoutMiniPlan } from '../../src/ui/canvas/miniPlan.js';
import { DIR8, GUA } from '../../src/core/geo.js';

const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}
function stateWith({ template = 'two', side = 'right', bearing = 180, builtYear = null, facing = {} } = {}) {
  const store = createStore(memStorage());
  store.update((d) => {
    d.plan = template ? withDoorSide(buildTemplate(template).plan, side).plan : null;
    d.facing.bearing = bearing;
    d.building.builtYear = builtYear;
    Object.assign(d.facing, facing);
  });
  return store;
}

test('wealthStability:兩房(大門在右)有年份,171 度差 5 度排第一的會換位置;150 度不會', () => {
  const store = stateWith({ builtYear: 2005, bearing: 171 });
  const s = store.get();
  const a = wealthStability(s, 171, 5, { nowMs: NOW });
  assert.equal(a.status, 'changes');
  assert.equal(a.change, 'place');
  assert.ok(a.alt && a.alt.id !== a.center.id);
  assert.equal(a.u, 5);
  // 中心結果和 store.report() 一致
  assert.equal(a.center.id, topOf(reportAt(s, 171, { nowMs: NOW })).id);
  const b = wealthStability(s, 150, 5, { nowMs: NOW });
  assert.equal(b.status, 'stable');
  assert.equal(b.alt, null);
  // U = 0 一定穩定
  assert.equal(wealthStability(s, 171, 0, { nowMs: NOW }).status, 'stable');
});

test('wealthStability:位置一樣但評等會變時回 tier;算不出來回 unknown;不修改狀態', () => {
  const s = stateWith({ builtYear: 2005, bearing: 215 }).get();
  const before = JSON.stringify(s);
  const r = wealthStability(s, 215, 5, { nowMs: NOW });
  assert.equal(r.status, 'changes');
  assert.equal(r.change, 'tier');
  assert.equal(r.alt.id, r.center.id);
  assert.notEqual(r.alt.tier, r.center.tier);
  assert.equal(JSON.stringify(s), before, '不可修改傳入的狀態');
  assert.equal(wealthStability(null, 150, 5).status, 'unknown');
  assert.equal(wealthStability(s, NaN, 5).status, 'unknown');
});

test('wealthStability:與逐度掃描一致(有換就一定抓得到)', () => {
  const s = stateWith({ template: 'two', side: 'left', bearing: 0, builtYear: 2005 }).get();
  const tops = new Map();
  const at = (b) => {
    const k = ((Math.round(b * 2) / 2) % 360 + 360) % 360;
    if (!tops.has(k)) tops.set(k, topOf(reportAt(s, k, { nowMs: NOW })));
    return tops.get(k);
  };
  for (let b = 0; b < 360; b += 10) {
    const U = 5;
    let changes = false;
    for (let d = -U; d <= U; d += 0.5) if (at(b + d).id !== at(b).id) changes = true;
    const r = wealthStability(s, b, U, { nowMs: NOW });
    if (changes) assert.equal(r.change, 'place', `${b} 度:逐 0.5 度掃描有換位置,取樣應抓到`);
    if (r.change === 'place') assert.ok(changes, `${b} 度:回報會換,逐度掃描也要看得到`);
  }
});

test('reportAt:大門另外設了方向時一起轉;可換平面圖', () => {
  const s = stateWith({ bearing: 180, facing: { doorBearing: 120 } }).get();
  const r = reportAt(s, 190, { nowMs: NOW });
  assert.ok(r && r.summary);
  // 宅向 180 → 190,大門 120 跟著轉 10 度 → 130(八宅看大門)
  assert.equal(r.bazhai.house.facingBearing, 130);
  assert.equal(s.facing.doorBearing, 120, '不修改傳入的狀態');
  const noPlan = reportAt(s, 190, { nowMs: NOW, plan: null });
  assert.equal(noPlan.summary.wealthTop[0].kind, 'dark');
});

test('sameTopForPlans:店面三種大門排第一的都一樣;兩房不一樣', () => {
  const plansOf = (id) => Object.fromEntries(DOOR_SIDES.map((sd) => [sd, withDoorSide(buildTemplate(id).plan, sd).plan]));
  const shop = stateWith({ template: 'shop', side: 'left', bearing: 180 }).get();
  assert.equal(sameTopForPlans(shop, 180, plansOf('shop'), { nowMs: NOW }), true);
  const two = stateWith({ template: 'two', side: 'left', bearing: 180 }).get();
  assert.equal(sameTopForPlans(two, 180, plansOf('two'), { nowMs: NOW }), false);
  assert.equal(sameTopForPlans(two, NaN, plansOf('two')), null);
});

test('store.input():自己選的 8 方位不確定度 22.5,有年份時完整報告會提醒再確認', () => {
  const store = stateWith({ template: null, bearing: 135, builtYear: 2005, facing: { source: 'pick8' } });
  assert.equal(PICK8_UNCERTAINTY, 22.5);
  assert.equal(store.input().facing.uncertainty, 22.5);
  assert.equal(facingUncertaintyOf(store.get()), 22.5);
  const rep = store.report();
  assert.equal(rep.geo.retest, true, '8 方位正中間 = 山的正中間,不確定度 22.5 時一定要提醒');
  // 設定的誤差更大時取較大者
  store.update((d) => { d.settings.measureUncertainty = 25; });
  assert.equal(store.input().facing.uncertainty, 25);
});

test('store.input():iPhone 估計誤差(facing.check.accuracyDeg)算進不確定度,只在綁定同一次鎖定時有效', () => {
  const check = { n: 1, spreadDeg: null, lockedAtMs: 77, dropped: 0, accuracyDeg: 20 };
  const store = stateWith({ template: null, bearing: 150, facing: { source: 'sensor', sigma: 0.5, lockedAtMs: 77, check } });
  assert.equal(store.input().facing.uncertainty, 20);
  assert.equal(store.input().facing.uncertainty, inputOf(store.get(), Date.now()).facing.uncertainty);
  store.update((d) => { d.facing.lockedAtMs = 78; });
  assert.equal(store.input().facing.uncertainty, 5, '換了鎖定就不算舊的精度');
  // 沒有 σ、差距、精度時交給引擎
  const plain = stateWith({ template: null, bearing: 150 });
  assert.equal(plain.input().facing.uncertainty, null);
});

test('repair:facing.check 的 dropped / accuracyDeg 壞值 → check 變 null;舊資料沒有這兩鍵仍有效', () => {
  const base = { n: 2, spreadDeg: 3, lockedAtMs: 5 };
  const fix = (check) => {
    const d = { facing: { bearing: 100, source: 'sensor', sigma: 1, lockedAtMs: 5, check }, building: {}, residents: [], ui: {}, settings: {} };
    repairDraft(d);
    return d.facing.check;
  };
  assert.deepEqual(fix(base), base);
  assert.deepEqual(fix({ ...base, dropped: 1, accuracyDeg: 12.5 }), { ...base, dropped: 1, accuracyDeg: 12.5 });
  assert.deepEqual(fix({ ...base, dropped: 0, accuracyDeg: null }), { ...base, dropped: 0, accuracyDeg: null });
  assert.equal(fix({ ...base, dropped: 2 }), null);
  assert.equal(fix({ ...base, accuracyDeg: -1 }), null);
  assert.equal(fix({ ...base, accuracyDeg: '9' }), null);
});

test('layoutMiniPlan:sectorLabels "dir8" 時八方位標「北、東北…」,預設仍是卦名', () => {
  const plan = withDoorSide(buildTemplate('two').plan, 'left').plan;
  const model = { plan, taiji: [4, 4], up: 180, markers: [] };
  const gua = layoutMiniPlan(model, 360, 300);
  assert.deepEqual(gua.sectors.map((x) => x.text), [...GUA]);
  const dir = layoutMiniPlan({ ...model, sectorLabels: 'dir8' }, 360, 300);
  assert.deepEqual(dir.sectors.map((x) => x.text), [...DIR8]);
  // 位置不變,只換文字
  assert.deepEqual(dir.sectors.map((x) => x.label), gua.sectors.map((x) => x.label));
});

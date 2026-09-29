// 平面圖範本測試:每個範本都必須通過引擎的 validatePlan 且沒有警告,
// 主要房間都有門(財位分析才不會出現「找不到門」),大門在上牆,並能跑完整個 analyzeHouse。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../src/core/plan.js';
import { createStore } from '../../src/ui/store.js';
import { TEMPLATES, buildTemplate, parseCustomSize, CUSTOM_MIN, CUSTOM_MAX } from '../../src/ui/plan/templates.js';
import { findOverlaps, roomRect, roomsOutsideOutline, isAxisRect } from '../../src/ui/plan/editor.js';

const MAIN_TYPES = ['living', 'bedroom', 'study', 'other'];
const DOOR_KINDS = ['entrance', 'door', 'balconyDoor'];

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

const cases = [
  ...TEMPLATES.filter((t) => t.id !== 'custom').map((t) => ({ name: t.label, id: t.id, opts: {} })),
  { name: '自訂 6×8', id: 'custom', opts: { width: 6, depth: 8 } },
  { name: '自訂 2.4×2.4(最小)', id: 'custom', opts: { width: 2.4, depth: 2.4 } },
  { name: '自訂 3.5×3.5', id: 'custom', opts: { width: 3.5, depth: 3.5 } },
  { name: '自訂 4.2×3', id: 'custom', opts: { width: 4.2, depth: 3 } },
  { name: '自訂 12×5', id: 'custom', opts: { width: 12, depth: 5 } },
  { name: '自訂 40×40(最大)', id: 'custom', opts: { width: 40, depth: 40 } },
  { name: '自訂字串輸入 "7.5" × "9"', id: 'custom', opts: { width: '7.5', depth: '9' } },
];

for (const c of cases) {
  test(`範本「${c.name}」:結構合法、沒有警告、主要房間都有門`, () => {
    const r = buildTemplate(c.id, c.opts);
    assert.ok(r.plan, r.error);
    const plan = r.plan;

    const v = validatePlan(plan);
    assert.deepEqual(v.errors, [], 'validatePlan 不可有錯誤');
    assert.deepEqual(v.warnings, [], 'validatePlan 不可有警告');

    // UI 欄位與預設方向
    assert.equal(plan.upMode, 'facing');
    assert.equal(plan.upOffset, 0);

    // 只有一個大門,是 mainDoor,開在上牆
    const entrances = plan.openings.filter((o) => o.kind === 'entrance');
    assert.equal(entrances.length, 1);
    assert.equal(plan.mainDoor, entrances[0].id);
    assert.equal(entrances[0].wall, 'top');

    // id 不重複
    assert.equal(new Set(plan.rooms.map((x) => x.id)).size, plan.rooms.length);
    assert.equal(new Set(plan.openings.map((x) => x.id)).size, plan.openings.length);

    // 每個主要房間都有通往它的門
    for (const room of plan.rooms.filter((x) => MAIN_TYPES.includes(x.type))) {
      assert.ok(plan.openings.some((o) => o.roomId === room.id && DOOR_KINDS.includes(o.kind)), `${room.name} 缺門`);
    }

    // 房間不重疊、都在外框內、都是軸向矩形、尺寸合理
    assert.deepEqual(findOverlaps(plan), []);
    assert.deepEqual(roomsOutsideOutline(plan), []);
    for (const room of plan.rooms) {
      assert.ok(isAxisRect(room.polygon));
      const rc = roomRect(room);
      const w = rc.x1 - rc.x0;
      const d = rc.y1 - rc.y0;
      assert.ok(w >= 1.1 && d >= 1.1 && w <= CUSTOM_MAX && d <= CUSTOM_MAX, `${room.name} 尺寸 ${w}×${d}`);
      assert.ok(room.name && room.name.length <= 12);
    }
  });

  test(`範本「${c.name}」:用 store.input() 等效輸入跑 analyzeHouse 不丟錯、財位候選非空、沒有找不到門`, () => {
    const { plan } = buildTemplate(c.id, c.opts);
    const store = createStore(memStorage());
    store.update((d) => {
      d.facing.bearing = 210;
      d.building.builtYear = 2010;
      d.plan = plan;
    });
    // input() 會依朝向算 planUpBearing 並移除 UI 欄位
    const input = store.input();
    assert.equal(input.plan.planUpBearing, 210);
    assert.equal('upMode' in input.plan, false);
    assert.equal('upOffset' in input.plan, false);

    const rep = store.report();
    assert.equal(rep.error, undefined, String(rep.error));
    assert.ok(rep.planShares, '應算得出各方位面積');
    assert.ok(rep.wealth.candidates.length > 0, '財位候選不可為空');
    const warns = rep.wealth.meta.warnings.filter((w) => /^noDoor/.test(w));
    assert.deepEqual(warns, [], '不可出現找不到門的警告');
    assert.ok(rep.meta.warnings.every((w) => !/^plan/.test(w)), `不可有平面圖警告: ${rep.meta.warnings.join(',')}`);
    // 明財位的角落不該一開始就被窗或門擋住
    for (const cand of rep.wealth.candidates.filter((x) => x.isMingCai)) {
      assert.equal(cand.status, 'ok', `${cand.id} 狀態 ${cand.status}`);
    }
  });
}

test('自訂矩形:壞輸入都回白話錯誤,不丟例外', () => {
  const bad = [
    [NaN, 5], [5, NaN], ['', ''], ['abc', 5], [null, 5], [undefined, undefined], [Infinity, 5], [-3, 5], [0, 5],
    [CUSTOM_MIN - 0.5, 5], [5, CUSTOM_MIN - 0.5], [CUSTOM_MAX + 1, 5], [5, CUSTOM_MAX + 1], [{}, []],
  ];
  for (const [w, d] of bad) {
    const r = buildTemplate('custom', { width: w, depth: d });
    assert.equal(typeof r.error, 'string', `輸入 ${String(w)} × ${String(d)}`);
    assert.ok(!r.plan);
    assert.ok(/[一-鿿]/.test(r.error));
  }
  assert.deepEqual(parseCustomSize('6', '8'), { w: 6, d: 8 });
  assert.deepEqual(parseCustomSize(' 6.04 ', '7.96'), { w: 6, d: 8 }); // 四捨五入到 0.1
  assert.equal(typeof buildTemplate('nope').error, 'string');
});

test('範本清單:五種,每個都有白話名稱、說明與尺寸', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.label), ['套房', '2 房 1 廳', '3 房 2 廳', '店面單間', '自訂矩形']);
  for (const t of TEMPLATES) assert.ok(t.desc && t.size);
});

test('範本每次產生的都是新物件,改動不會污染下一次', () => {
  const a = buildTemplate('two').plan;
  a.rooms[0].name = '被改過';
  a.openings.pop();
  const b = buildTemplate('two').plan;
  assert.notEqual(b.rooms[0].name, '被改過');
  assert.ok(b.openings.length > a.openings.length);
});

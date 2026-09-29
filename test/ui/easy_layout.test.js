// 簡單模式的格局(EASY_SPEC 8.5):大門左/中/右、沒改過的範本判斷、角落的白話說法。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, buildTemplate } from '../../src/ui/plan/templates.js';
import { checkEditedPlan, roomRect, wallLength, findOverlaps } from '../../src/ui/plan/editor.js';
import { validatePlan } from '../../src/core/plan.js';
import { createStore } from '../../src/ui/store.js';
import { DOOR_SIDES, withDoorSide, isUntouchedTemplate, plainCornerOf, placeText } from '../../src/ui/easy/layout.js';

const MAIN_TYPES = ['living', 'bedroom', 'study', 'other'];
const DOOR_KINDS = ['entrance', 'door', 'balconyDoor'];
const IDS = TEMPLATES.filter((t) => t.id !== 'custom').map((t) => t.id);

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}
function storeWith(plan, bearing = 180, builtYear = null) {
  const store = createStore(memStorage());
  store.update((d) => { d.facing.bearing = bearing; d.building.builtYear = builtYear; d.plan = plan; });
  return store;
}
const doorOf = (plan) => plan.openings.find((o) => o.id === plan.mainDoor);

for (const id of IDS) {
  for (const side of DOOR_SIDES) {
    test(`範本 ${id} × 大門${side}:合法、只有一個大門在上牆、主要房間有門、財位角落沒被擋、引擎跑得完`, () => {
      const res = withDoorSide(buildTemplate(id).plan, side);
      assert.equal(res.moved, true);
      const plan = res.plan;
      const chk = checkEditedPlan(plan);
      assert.equal(chk.ok, true, chk.message);
      assert.deepEqual(chk.warnings, []);
      const v = validatePlan(plan);
      assert.deepEqual(v.errors, []);
      assert.deepEqual(v.warnings, []);
      assert.deepEqual(findOverlaps(plan), []);

      const entrances = plan.openings.filter((o) => o.kind === 'entrance');
      assert.equal(entrances.length, 1);
      assert.equal(entrances[0].id, plan.mainDoor);
      assert.equal(entrances[0].wall, 'top');
      for (const room of plan.rooms.filter((r) => MAIN_TYPES.includes(r.type))) {
        assert.ok(plan.openings.some((o) => o.roomId === room.id && DOOR_KINDS.includes(o.kind)), `${room.name} 缺門`);
      }
      // 大門那面牆上的門窗(這裡會搬動的)離牆角至少 1 公尺,也不互相重疊
      const door = doorOf(plan);
      const rect = roomRect(plan.rooms.find((r) => r.id === door.roomId));
      const L = wallLength(rect, 'top');
      const spans = plan.openings.filter((o) => o.roomId === door.roomId && o.wall === 'top').map((o) => [o.pos - o.width / 2, o.pos + o.width / 2]);
      for (const [a, b] of spans) assert.ok(a >= 1 - 1e-9 && b <= L - 1 + 1e-9, `${id} ${side}: ${a}–${b}(牆長 ${L})`);
      spans.sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-9);

      const rep = storeWith(plan, 210, 2010).report();
      assert.equal(rep.error, undefined, String(rep.error));
      assert.ok(rep.wealth.candidates.length > 0);
      assert.deepEqual(rep.wealth.meta.warnings.filter((w) => /^noDoor/.test(w)), []);
      for (const cand of rep.wealth.candidates.filter((x) => x.isMingCai)) assert.equal(cand.status, 'ok', `${cand.id} ${cand.status}`);
    });
  }
}

test('withDoorSide:left 與原範本深度相等;right 整張圖左右鏡射(大門在房子正面的右側);center 在進門空間前牆的正中間;不改動輸入', () => {
  for (const id of IDS) {
    const orig = buildTemplate(id).plan;
    const snapshot = JSON.stringify(orig);
    const left = withDoorSide(orig, 'left');
    assert.deepEqual(left.plan, orig);
    assert.notEqual(left.plan, orig, '回傳複本');
    const rect = roomRect(orig.rooms.find((r) => r.id === doorOf(orig).roomId));
    const w = rect.x1 - rect.x0;
    const W = Math.max(...orig.outline.map((p) => p[0]));
    const absX = (plan) => roomRect(plan.rooms.find((r) => r.id === doorOf(plan).roomId)).x0 + doorOf(plan).pos;

    const right = withDoorSide(orig, 'right').plan;
    // 大門的絕對位置左右對調,而且落在房子正面的右半邊(使用者選「右邊」看到的就是右邊)
    assert.ok(Math.abs(absX(right) - (W - absX(orig))) < 1e-9, id);
    assert.ok(absX(right) > W / 2, `${id} 右邊的大門應在右半邊`);
    assert.equal(doorOf(right).wall, 'top');
    assert.deepEqual(right.outline.map((p) => p.join()).sort(), orig.outline.map((p) => p.join()).sort());
    for (const r of orig.rooms) {
      const a = roomRect(r);
      const m = roomRect(right.rooms.find((x) => x.id === r.id));
      assert.ok(Math.abs(m.x0 - (W - a.x1)) < 1e-9 && Math.abs(m.x1 - (W - a.x0)) < 1e-9 && m.y0 === a.y0 && m.y1 === a.y1, `${id} ${r.id}`);
    }
    for (const o of orig.openings) {
      const m = right.openings.find((x) => x.id === o.id);
      const swap = { left: 'right', right: 'left', top: 'top', bottom: 'bottom' };
      assert.equal(m.wall, swap[o.wall], `${id} ${o.id}`);
      assert.equal(m.width, o.width);
    }

    const center = withDoorSide(orig, 'center').plan;
    assert.ok(Math.abs(doorOf(center).pos - Math.round((w / 2) * 10) / 10) < 1e-9, id);
    assert.equal(JSON.stringify(orig), snapshot, '輸入不可被改動');
    // 正中間:其他房間、其他牆的門窗不動
    for (const o of center.openings.filter((x) => !(x.roomId === doorOf(orig).roomId && x.wall === 'top'))) {
      assert.deepEqual(o, orig.openings.find((x) => x.id === o.id));
    }
    assert.deepEqual(center.rooms, orig.rooms);
  }
});

test('withDoorSide:2 房 1 廳選「右邊」,大門在房子正面的右側、客廳也換到右邊', () => {
  const p = withDoorSide(buildTemplate('two').plan, 'right').plan;
  const living = roomRect(p.rooms.find((r) => r.id === 'living'));
  assert.deepEqual([living.x0, living.x1], [2.4, 8]);
  assert.ok(Math.abs(living.x0 + doorOf(p).pos - 6.3) < 1e-9, '大門中心 x = 6.3(房寬 8)');
});

test('withDoorSide:店面正中間時落地窗讓到右段(規格範例)', () => {
  const p = withDoorSide(buildTemplate('shop').plan, 'center').plan;
  assert.deepEqual(doorOf(p), { id: 'd1', kind: 'entrance', roomId: 'shop', wall: 'top', pos: 3, width: 1.2 });
  const f1 = p.openings.find((o) => o.id === 'f1');
  assert.equal(f1.pos, 4.3);
  assert.equal(f1.width, 1.4);
  // 右邊:大門與落地窗左右對調
  const r = withDoorSide(buildTemplate('shop').plan, 'right').plan;
  assert.equal(doorOf(r).pos, 4.3);
  assert.equal(r.openings.find((o) => o.id === 'f1').pos, 2.1);
});

test('withDoorSide:做不到時回原樣複本與 moved:false', () => {
  const orig = buildTemplate('studio').plan;
  // 大門不在上牆
  const side = JSON.parse(JSON.stringify(orig));
  doorOf(side).wall = 'left';
  doorOf(side).pos = 2;
  for (const s of ['right', 'center']) {
    const r = withDoorSide(side, s);
    assert.equal(r.moved, false);
    assert.deepEqual(r.plan, side);
  }
  // 牆太短,旁邊的開口讓不出位置
  const tight = JSON.parse(JSON.stringify(buildTemplate('shop').plan));
  tight.openings.find((o) => o.id === 'f1').pos = 2.9;
  tight.openings.find((o) => o.id === 'f1').width = 0.4;
  doorOf(tight).width = 3.8; // 佔 1.1–4.9 → 兩段都只剩 0.1 公尺
  doorOf(tight).pos = 3;
  const t = withDoorSide(tight, 'center');
  assert.equal(t.moved, false);
  assert.deepEqual(t.plan, tight);
  // 壞輸入
  assert.equal(withDoorSide(null, 'left').moved, false);
  assert.equal(withDoorSide(orig, 'middle').moved, false);
  assert.equal(withDoorSide({ ...orig, mainDoor: 'zz' }, 'right').moved, false);
});

test('大門左邊與右邊:朝向 180 的套房,明財位候選不同(臥室左下角 → 客廳左下角)', () => {
  const mingOf = (side) => {
    const rep = storeWith(withDoorSide(buildTemplate('studio').plan, side).plan, 180).report();
    const m = rep.summary.wealthTop.find((t) => t.kind === 'ming');
    return `${m.roomId}:${m.corner}`;
  };
  assert.equal(mingOf('left'), 'bed:BL');
  assert.equal(mingOf('right'), 'living:BL');
});

test('isUntouchedTemplate:剛產生 → true,動任一房間頂點或門 → false', () => {
  for (const id of IDS) {
    for (const side of DOOR_SIDES) {
      const plan = withDoorSide(buildTemplate(id).plan, side).plan;
      const layout = { template: id, doorSide: side };
      assert.equal(isUntouchedTemplate(plan, layout), true, `${id} ${side}`);
      // 經過 store 存取後仍是沒改過
      assert.equal(isUntouchedTemplate(storeWith(plan).get().plan, layout), true);
      // 鍵的順序不影響
      const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(plan))).reverse());
      assert.equal(isUntouchedTemplate(reordered, layout), true);
      const moved = JSON.parse(JSON.stringify(plan));
      moved.rooms[0].polygon[1][0] += 0.1;
      assert.equal(isUntouchedTemplate(moved, layout), false);
      const door = JSON.parse(JSON.stringify(plan));
      doorOf(door).pos += 0.1;
      assert.equal(isUntouchedTemplate(door, layout), false);
    }
  }
  const plan = buildTemplate('two').plan;
  assert.equal(isUntouchedTemplate(plan, { template: 'studio', doorSide: 'left' }), false, '範本不同');
  assert.equal(isUntouchedTemplate(plan, { template: 'two', doorSide: 'right' }), false, '大門位置不同');
  assert.equal(isUntouchedTemplate(null, { template: 'two', doorSide: 'left' }), false);
  assert.equal(isUntouchedTemplate(plan, null), false);
  assert.equal(isUntouchedTemplate(plan, { template: 'nope', doorSide: 'left' }), false);
  assert.equal(isUntouchedTemplate(plan, { template: 'two', doorSide: 'up' }), false);
});

test('plainCornerOf / placeText:圖面上方是大門 → 前後左右;北朝上或有旋轉 → 圖上的位置', () => {
  const plan = buildTemplate('two').plan;
  assert.deepEqual(plainCornerOf(plan, 'TL'), { text: '前方左邊角落', usesFrame: true });
  assert.deepEqual(plainCornerOf(plan, 'TR'), { text: '前方右邊角落', usesFrame: true });
  assert.deepEqual(plainCornerOf(plan, 'BL'), { text: '後方左邊角落', usesFrame: true });
  assert.deepEqual(plainCornerOf(plan, 'BR'), { text: '後方右邊角落', usesFrame: true });
  assert.deepEqual(placeText({ kind: 'ming', roomId: 'bed1', corner: 'BR' }, plan), { text: '主臥的後方右邊角落', usesFrame: true });

  const north = { ...plan, upMode: 'north' };
  assert.deepEqual(plainCornerOf(north, 'TL'), { text: '左上角(圖上的位置)', usesFrame: false });
  const off = { ...plan, upOffset: 15 };
  assert.deepEqual(plainCornerOf(off, 'BR'), { text: '右下角(圖上的位置)', usesFrame: false });
  const noUi = JSON.parse(JSON.stringify(plan));
  delete noUi.upMode;
  delete noUi.upOffset;
  assert.equal(plainCornerOf(noUi, 'BR').usesFrame, true, '沒有 UI 欄位時視為大門朝上');
  const sideDoor = JSON.parse(JSON.stringify(plan));
  doorOf(sideDoor).wall = 'left';
  assert.deepEqual(plainCornerOf(sideDoor, 'TR'), { text: '右上角(圖上的位置)', usesFrame: false });
  assert.equal(plainCornerOf(plan, 'C5').usesFrame, false);
  assert.equal(plainCornerOf(plan, 'C5').text, '第 6 個轉角(圖上的位置)');

  assert.deepEqual(placeText({ kind: 'dark', dir8: '東北', roomId: null, corner: null }, null), { text: '東北方', usesFrame: false });
  assert.equal(placeText(null, plan), null);
  // 用引擎真的算出來的最佳位置
  const rep = storeWith(plan, 180).report();
  const top = rep.summary.wealthTop[0];
  const t = placeText(top, plan);
  assert.match(t.text, /的(前方|後方)(左邊|右邊)角落$/);
  assert.ok(!/宮|明財位|暗財位/.test(t.text));
  const dark = storeWith(null, 90).report().summary.wealthTop[0];
  assert.equal(dark.kind, 'dark');
  assert.equal(placeText(dark, null).text, `${dark.dir8}方`);
});

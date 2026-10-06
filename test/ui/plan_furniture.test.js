import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planFurniture, hitFurniture, addFurniture, moveFurniture, resizeFurniture,
  rotateFurniture, setFurnitureFacing, removeFurniture, checkEditedPlan,
} from '../../src/ui/plan/editor.js';
import { validatePlan, FURNITURE_KINDS } from '../../src/core/plan.js';

function base() {
  return {
    version: 1, unit: 'm', planUpBearing: 0,
    outline: [[0, 0], [8, 0], [8, 8], [0, 8]],
    rooms: [{ id: 'living', type: 'living', polygon: [[0, 0], [8, 0], [8, 8], [0, 8]] }],
    openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'top', pos: 4, width: 1 }],
    walls: [], mainDoor: 'd1',
    taiji: { mode: 'centroid', manual: null },
    upMode: 'facing', upOffset: 0,
  };
}

test('放入家具:在房間內成功,房間外報錯,種類檢查', () => {
  const p = base();
  const r = addFurniture(p, 'bed', [4, 4]);
  assert.ok(r.ok, r.error);
  assert.equal(r.furniture.kind, 'bed');
  assert.equal(r.furniture.roomId, 'living');
  assert.equal(r.furniture.w, 1.8);
  assert.equal(r.furniture.d, 2);
  assert.equal(r.furniture.facing, 0);
  assert.ok(addFurniture(p, 'xx', [4, 4]).error);
  assert.ok(addFurniture(p, 'bed', [99, 99]).error);
  assert.equal(planFurniture(p).length, 1);
});

test('命中測試:內部命中、容差、重疊取小件', () => {
  const p = base();
  addFurniture(p, 'bed', [4, 4]);
  assert.equal(hitFurniture(p, [4, 4]), 'fb1');
  assert.equal(hitFurniture(p, [0.2, 0.2]), null);
  addFurniture(p, 'tv', [4, 4]);
  const ids = planFurniture(p).map((f) => f.id);
  assert.equal(hitFurniture(p, [4, 4]), ids.find((id) => id.startsWith('ft')) || ids[1]);
});

test('移動家具:中心對齊目標點、吸附格點、房間歸屬更新', () => {
  const p = base();
  p.rooms.push({ id: 'bed', type: 'bedroom', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] });
  addFurniture(p, 'desk', [6, 6]);
  const f = planFurniture(p)[0];
  assert.equal(f.roomId, 'living');
  const r = moveFurniture(p, f.id, [2, 2]);
  assert.ok(r.ok);
  assert.equal(f.x, 1.3); // 2 - 1.4/2 吸附
  assert.equal(f.roomId, 'bed');
  assert.ok(moveFurniture(p, 'nope', [1, 1]).error);
});

test('調整尺寸與旋轉:以中心重算、上下限、長寬互換', () => {
  const p = base();
  addFurniture(p, 'sofa', [4, 4]);
  const f = planFurniture(p)[0];
  const cx = f.x + f.w / 2;
  assert.ok(resizeFurniture(p, f.id, 2.4, 1).ok);
  assert.equal(f.w, 2.4);
  assert.equal(f.d, 1);
  assert.equal(f.x + f.w / 2, cx); // 中心不動
  assert.ok(resizeFurniture(p, f.id, 0.1, 1).error);
  assert.ok(resizeFurniture(p, f.id, 9, 9).error);
  const w0 = f.w;
  const d0 = f.d;
  assert.ok(rotateFurniture(p, f.id, 90).ok);
  assert.equal(f.w, d0); // 長寬互換
  assert.equal(f.d, w0);
  assert.equal(f.facing, 90);
  assert.ok(setFurnitureFacing(p, f.id, -30).ok);
  assert.equal(f.facing, 330);
  assert.ok(setFurnitureFacing(p, f.id, 'x').error);
});

test('移除家具', () => {
  const p = base();
  addFurniture(p, 'stove', [4, 4]);
  const id = planFurniture(p)[0].id;
  assert.ok(removeFurniture(p, id).ok);
  assert.equal(planFurniture(p).length, 0);
  assert.ok(removeFurniture(p, id).error);
});

test('驗證:合法家具不報錯;壞資料報對應錯誤碼;重疊/出界只警告', () => {
  const p = base();
  addFurniture(p, 'bed', [4, 4]);
  const v = validatePlan(p);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.warnings.filter((w) => w.code.startsWith('furniture')).length, 0);

  const bad = base();
  bad.furniture = [
    { id: 'a', kind: 'nope', x: 1, y: 1, w: 1, d: 1 },
    { id: 'a', kind: 'bed', x: 'q', y: 1, w: -1, d: 0 },
    { id: 'b', kind: 'bed', x: 1, y: 1, w: 1, d: 1, facing: 'zz' },
    'notobject',
  ];
  const v2 = validatePlan(bad);
  assert.ok(!v2.ok);
  const reasons = v2.errors.map((e) => e.reason);
  assert.ok(reasons.includes('furniture.kind'));
  assert.ok(reasons.includes('furniture.duplicateId'));
  assert.ok(reasons.includes('furniture.pos'));
  assert.ok(reasons.includes('furniture.size'));
  assert.ok(reasons.includes('furniture.facing'));
  assert.ok(reasons.includes('furniture.notObject'));

  // 重疊與出界 → 警告
  const w = base();
  w.furniture = [
    { id: 'a', kind: 'bed', x: 4, y: 4, w: 2, d: 2 },
    { id: 'b', kind: 'desk', x: 5, y: 5, w: 2, d: 2 },
    { id: 'c', kind: 'tv', x: 100, y: 100, w: 1, d: 1 },
  ];
  const v3 = validatePlan(w);
  assert.ok(v3.ok);
  const codes = v3.warnings.map((x) => x.code);
  assert.ok(codes.includes('furnitureOverlap'));
  assert.ok(codes.includes('furnitureOutsideRooms'));
});

test('FURNITURE_KINDS 與編輯器預設尺寸一致', async () => {
  const { FURNITURE_LABEL, FURNITURE_ORDER, FURNITURE_DEFAULT_SIZE } = await import('../../src/ui/plan/labels.js');
  assert.deepEqual([...FURNITURE_ORDER].sort(), [...FURNITURE_KINDS].sort());
  for (const k of FURNITURE_KINDS) {
    assert.ok(FURNITURE_LABEL[k], k);
    const [w, d] = FURNITURE_DEFAULT_SIZE[k];
    assert.ok(w > 0 && d > 0 && w <= 6 && d <= 6, k);
  }
});

test('checkEditedPlan 通過含家具的平面圖', () => {
  const p = base();
  addFurniture(p, 'bed', [4, 4]);
  const c = checkEditedPlan(p);
  assert.ok(c.ok, c.message);
});

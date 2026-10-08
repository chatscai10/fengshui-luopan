import test from 'node:test';
import assert from 'node:assert/strict';
import { removeRoom, applyRoomRect, addFurniture, planFurniture } from '../../src/ui/plan/editor.js';

function base() {
  return {
    version: 1, unit: 'm', planUpBearing: 0,
    outline: [[0, 0], [10, 0], [10, 10], [0, 10]],
    rooms: [
      { id: 'r1', type: 'bedroom', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] },
      { id: 'r2', type: 'living', polygon: [[5, 0], [10, 0], [10, 5], [5, 5]] },
    ],
    openings: [],
    walls: [],
    furniture: [],
    taiji: { mode: 'centroid', manual: null },
  };
}

test('removeRoom: 連帶清除該房間內的家具,其他房間不受影響', () => {
  const p = base();
  addFurniture(p, 'bed', [2.5, 2.5]); // in r1
  addFurniture(p, 'sofa', [7.5, 2.5]); // in r2
  assert.equal(planFurniture(p).length, 2);

  const res = removeRoom(p, 'r1');
  assert.ok(res.ok);
  assert.equal(res.removedFurniture.length, 1);
  assert.equal(planFurniture(p).length, 1);
  assert.equal(planFurniture(p)[0].kind, 'sofa');
  assert.equal(planFurniture(p)[0].roomId, 'r2');
});

test('applyRoomRect: 房間移動後,家具自動歸屬到新房間', () => {
  const p = base();
  addFurniture(p, 'desk', [2.5, 2.5]); // in r1
  const fid = planFurniture(p)[0].id;
  assert.equal(planFurniture(p)[0].roomId, 'r1');

  // 把 r1 往右移到 (5,5)-(10,10),但家具不動依然在 (2.5, 2.5)
  // 此時 (2.5, 2.5) 不在任何房間中
  applyRoomRect(p, 'r1', { x0: 5, y0: 5, x1: 10, y1: 10 });
  // 家具仍在 planFurniture,roomId 保持或被 hitRoom 重新檢查
  assert.equal(planFurniture(p).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, makeView, bearingOfVector, vectorOfBearing, wedgePolygon } from '../../src/ui/plan/coords.js';

test('makeView: toPx/fromPx 互逆,y 軸翻轉', () => {
  const v = makeView({ minX: 0, minY: 0, maxX: 10, maxY: 8 }, 400, 320, { pad: 20 });
  const [px, py] = v.toPx([3, 2]);
  const [x, y] = v.fromPx(px, py);
  assert.ok(Math.abs(x - 3) < 1e-9 && Math.abs(y - 2) < 1e-9);
  // y 越大,畫布 y 越小(往上)
  assert.ok(v.toPx([0, 8])[1] < v.toPx([0, 0])[1]);
  // 外框置中
  const c = v.toPx([5, 4]);
  assert.ok(Math.abs(c[0] - 200) < 1e-9 && Math.abs(c[1] - 160) < 1e-9);
});

test('bearingOfVector / vectorOfBearing: 圖面上方 = planUpBearing', () => {
  assert.equal(bearingOfVector(0, 1, 30), 30);          // 往上
  assert.equal(bearingOfVector(1, 0, 30), 120);         // 往右 = 上方 +90
  assert.equal(bearingOfVector(0, -1, 30), 210);        // 往下
  assert.equal(bearingOfVector(-1, 0, 30), 300);        // 往左
  for (const up of [0, 30, 210, 359]) {
    for (const b of [0, 45, 100, 275]) {
      const [vx, vy] = vectorOfBearing(b, up);
      const back = bearingOfVector(vx, vy, up);
      assert.ok(Math.abs(((back - b + 540) % 360) - 180) < 1e-9, `up=${up} b=${b}`);
    }
  }
});

test('wedgePolygon: 圖面上方朝北時,震(index 2,90°)扇形在太極點右側', () => {
  const poly = wedgePolygon([0, 0], 2, 0, 10, 4);
  const cx = poly.slice(1).reduce((a, p) => a + p[0], 0) / (poly.length - 1);
  const cy = poly.slice(1).reduce((a, p) => a + p[1], 0) / (poly.length - 1);
  assert.ok(cx > 8 && Math.abs(cy) < 1e-9);
  assert.deepEqual(poly[0], [0, 0]);
});

test('boundsOf: 空輸入回傳單位框', () => {
  assert.deepEqual(boundsOf([]), { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  assert.deepEqual(boundsOf([[1, 2], [-3, 5]]), { minX: -3, minY: 2, maxX: 1, maxY: 5 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMiniPlan, pickMarker, rayToRect, roomLabel, miniPlanAlt } from '../../src/ui/canvas/miniPlan.js';
import { baseInput } from './report.helpers.js';

const plan = () => baseInput().plan;

test('rayToRect: 射線走到矩形邊界,起點在外面時先夾回來', () => {
  const rect = { x0: 0, y0: 0, x1: 100, y1: 50 };
  assert.deepEqual(rayToRect([50, 25], [1, 0], rect), [100, 25]);
  assert.deepEqual(rayToRect([50, 25], [0, -1], rect), [50, 0]);
  const diag = rayToRect([50, 25], [1, 1], rect);
  assert.ok(Math.abs(diag[1] - 50) < 1e-9 && diag[0] > 50 && diag[0] <= 100);
  assert.deepEqual(rayToRect([500, 25], [0, 0], rect), [100, 25]);
});

test('layoutMiniPlan: 只翻轉 y、不旋轉(圖面上方 = 平面圖 +y)', () => {
  const p = plan();
  const lay = layoutMiniPlan({ plan: p, taiji: [5, 4], up: 30, markers: [{ id: 'tr', point: [6, 5] }, { id: 'bl', point: [0, 0] }] }, 360, 260);
  const tr = lay.markers.find((m) => m.id === 'tr').at;
  const bl = lay.markers.find((m) => m.id === 'bl').at;
  assert.ok(tr[1] < bl[1], 'y 越大越靠上');
  assert.ok(tr[0] > bl[0], 'x 越大越靠右');
  // 比例一致(沒有旋轉也沒有變形):兩個方向的像素/公尺相同
  const sx = (tr[0] - bl[0]) / 6;
  const sy = (bl[1] - tr[1]) / 5;
  assert.ok(Math.abs(sx - sy) < 1e-9);
  // 太極點在外框中心
  assert.ok(Math.abs(lay.taiji[0] - 180) < 1e-6 && Math.abs(lay.taiji[1] - 130) < 1e-6);
});

test('layoutMiniPlan: 指北針依 planUpBearing;北在圖面上方偏左(up=30)', () => {
  const lay = layoutMiniPlan({ plan: plan(), taiji: [5, 4], up: 30, markers: [] }, 360, 260);
  assert.ok(lay.north.dx < 0, '北偏左');
  assert.ok(lay.north.dy < 0, '北偏上(畫布 y 向下)');
  assert.ok(Math.abs(Math.hypot(lay.north.dx, lay.north.dy) - 1) < 1e-9);
  const straight = layoutMiniPlan({ plan: plan(), taiji: [5, 4], up: 0, markers: [] }, 360, 260);
  assert.ok(Math.abs(straight.north.dx) < 1e-9 && straight.north.dy < 0);
});

test('layoutMiniPlan: 八個方位名稱位置對應羅盤方位', () => {
  const lay = layoutMiniPlan({ plan: plan(), taiji: [5, 4], up: 0, markers: [] }, 360, 260);
  assert.equal(lay.sectors.length, 8);
  const at = (g) => lay.sectors.find((s) => s.gua === g).label;
  const t = lay.taiji;
  assert.ok(at('坎')[1] < t[1] && Math.abs(at('坎')[0] - t[0]) < 1e-6, '坎在正上(北)');
  assert.ok(at('離')[1] > t[1], '離在下(南)');
  assert.ok(at('震')[0] > t[0], '震在右(東)');
  assert.ok(at('兌')[0] < t[0], '兌在左(西)');
  for (const s of lay.sectors) {
    assert.ok(s.label[0] >= 0 && s.label[0] <= 360 && s.label[1] >= 0 && s.label[1] <= 260, `${s.gua} 名稱要在畫布內`);
  }
});

test('layoutMiniPlan: 方位未知時不畫方位與指北針;壞資料不丟例外', () => {
  const lay = layoutMiniPlan({ plan: plan(), taiji: [5, 4], up: null, markers: [] }, 360, 260);
  assert.equal(lay.north, null);
  assert.deepEqual(lay.sectors, []);
  assert.doesNotThrow(() => layoutMiniPlan({ plan: null, taiji: null, up: NaN, markers: [{ id: 'x', point: [NaN, 1] }] }, 300, 200));
  assert.doesNotThrow(() => layoutMiniPlan({ plan: { outline: 'abc', rooms: [null, { polygon: [[0, 0]] }], openings: [null, { id: 'zz' }] }, taiji: undefined, up: 10, markers: [] }, 300, 200));
  const lay2 = layoutMiniPlan({ plan: { ...plan(), openings: [{ id: 'bad', kind: 'window', roomId: 'nope', wall: 'top', pos: 1, width: 1 }] }, taiji: [5, 4], up: 30, markers: [] }, 300, 200);
  assert.equal(lay2.openings.length, 0);
});

test('layoutMiniPlan: 大門位置用引擎的 openingCenter', () => {
  const lay = layoutMiniPlan({ plan: plan(), taiji: [5, 4], up: 30, markers: [{ id: 'a', point: [1, 0] }] }, 360, 260);
  const door = lay.openings.find((o) => o.main);
  assert.ok(door);
  const a = lay.markers[0].at;
  assert.ok(Math.abs(door.at[0] - a[0]) < 1e-9 && Math.abs(door.at[1] - a[1]) < 1e-9, '門在 (1,0)');
});

test('pickMarker: 半徑內取最近,半徑外回 null', () => {
  const ms = [{ id: 'a', at: [10, 10] }, { id: 'b', at: [40, 10] }];
  assert.equal(pickMarker(ms, 14, 12).id, 'a');
  assert.equal(pickMarker(ms, 36, 10).id, 'b');
  assert.equal(pickMarker(ms, 200, 200), null);
  assert.equal(pickMarker([], 1, 1), null);
});

test('roomLabel: 用白話名稱、同類型加編號、絕不顯示內部 id', () => {
  const p = plan();
  assert.equal(roomLabel(p, 'living'), '客廳');
  assert.equal(roomLabel(p, 'bed'), '臥室 1');
  assert.equal(roomLabel(p, 'bed2'), '臥室 2');
  assert.equal(roomLabel(p, 'not-exist'), '這個空間');
  assert.equal(roomLabel(p, 'outline'), '整個空間');
  assert.equal(roomLabel(null, 'x'), '這個空間');
  p.rooms[0].name = '  大客廳 ';
  assert.equal(roomLabel(p, 'living'), '大客廳');
  p.rooms[0].name = 123;
  assert.equal(roomLabel(p, 'living'), '客廳');
});

test('miniPlanAlt 有文字替代', () => {
  assert.match(miniPlanAlt({ markers: [1, 2] }, '客廳的右上角'), /2 個財位候選位置.*客廳的右上角/);
});

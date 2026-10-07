import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFurniture, buildFurnitureCards, furnitureVerdict, PLACEMENT_SCHEMA, analyzePlacements,
} from '../../src/core/placement.js';

function planWith(furniture, extra = {}) {
  return {
    version: 1, unit: 'm', planUpBearing: 0,
    outline: [[0, 0], [10, 8], [10, 8], [0, 8]].slice(0, 2).concat([[10, 8], [0, 8]]),
    rooms: [
      { id: 'living', type: 'living', polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] },
      { id: 'bath', type: 'toilet', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
    openings: [
      { id: 'main', kind: 'entrance', roomId: 'living', wall: 'top', pos: 5, width: 1 },
      { id: 'win', kind: 'window', roomId: 'living', wall: 'left', pos: 4, width: 1.5 },
    ],
    furniture,
    ...extra,
  };
}

test('家具方位:中心落在太極點北方 → 北/坎', () => {
  const plan = planWith([{ id: 'f1', kind: 'bed', roomId: 'living', x: 4, y: 6, w: 2, d: 2, facing: 0 }]);
  const res = analyzeFurniture({ meta: { targetGua: '坎' }, annual: null }, plan, { taiji: [5, 4], up: 0 });
  assert.equal(res.length, 1);
  assert.equal(res[0].dir, '北');
  assert.equal(res[0].gua, '坎');
  assert.ok(res[0].star);
});

test('家具方位:沒有太極點或朝向未知時 dir/gua/star 為 null,不丟錯', () => {
  const plan = planWith([{ id: 'f1', kind: 'bed', roomId: 'living', x: 4, y: 6, w: 2, d: 2 }]);
  const a = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: null, up: 0 });
  assert.equal(a[0].dir, null);
  const b = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: [5, 4], up: null });
  assert.equal(b[0].star, null);
});

test('門沖:床貼近大門時產生警示', () => {
  // 大門在 top(y=8) pos=5 → 平面座標 (5,8);床中心放 (5,7.9)
  const plan = planWith([{ id: 'f1', kind: 'bed', roomId: 'living', x: 4, y: 6.9, w: 2, d: 2, facing: 0 }]);
  const res = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: [5, 4], up: 0 });
  assert.ok(res[0].cautions.some((c) => c.includes('大門')), JSON.stringify(res[0].cautions));
});

test('背窗:床靠窗 0.6 公尺內警示,辦公桌也適用,爐灶不適用', () => {
  // 窗在 left(x=0) pos=4 → (0,4);床中心 (0.5,4)
  const plan = planWith([{ id: 'f1', kind: 'bed', roomId: 'living', x: -0.5 + 0.5, y: 3, w: 2, d: 2, facing: 0 }]);
  plan.furniture[0].x = -0.5;
  const res = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: [5, 4], up: 0 });
  assert.ok(res[0].cautions.some((c) => c.includes('背窗')), JSON.stringify(res[0].cautions));

  const stovePlan = planWith([{ id: 's1', kind: 'stove', roomId: 'living', x: -0.5, y: 3.7, w: 1, d: 0.6, facing: 0 }]);
  const rs = analyzeFurniture({ meta: { targetGua: '坎' } }, stovePlan, { taiji: [5, 4], up: 0 });
  assert.ok(!rs[0].cautions.some((c) => c.includes('背窗')), '爐灶不檢查背窗');
});

test('廁所共牆:家具貼著衛浴牆時警示', () => {
  // 衛浴在 (0,0)-(1,1);家具貼在 x=1 邊界
  const plan = planWith([{ id: 'f1', kind: 'bed', roomId: 'living', x: 1.0, y: 0, w: 1.8, d: 2, facing: 0 }]);
  const res = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: [5, 4], up: 0 });
  assert.ok(res[0].cautions.some((c) => c.includes('廁所')), JSON.stringify(res[0].cautions));
});

test('水火相剋:爐灶與冰箱邊緣淨距 < 0.6 公尺警示,遠離則不警告', () => {
  const near = planWith([
    { id: 's1', kind: 'stove', roomId: 'living', x: 5, y: 5, w: 0.9, d: 0.6, facing: 0 },
    { id: 'r1', kind: 'fridge', roomId: 'living', x: 6, y: 5, w: 0.8, d: 0.8, facing: 0 },
  ]);
  const a = analyzeFurniture({ meta: { targetGua: '坎' } }, near, { taiji: [5, 4], up: 0 });
  const stove = a.find((f) => f.kind === 'stove');
  assert.ok(stove.cautions.some((c) => c.includes('水火相剋')), JSON.stringify(stove.cautions));

  const far = planWith([
    { id: 's1', kind: 'stove', roomId: 'living', x: 1, y: 1, w: 0.9, d: 0.6, facing: 0 },
    { id: 'r1', kind: 'fridge', roomId: 'living', x: 8, y: 6, w: 0.8, d: 0.8, facing: 0 },
  ]);
  const b = analyzeFurniture({ meta: { targetGua: '坎' } }, far, { taiji: [5, 4], up: 0 });
  assert.ok(!b.find((f) => f.kind === 'stove').cautions.some((c) => c.includes('水火相剋')));
});

test('動水避忌:魚缸落在流年五黃或二黑方位時警示', () => {
  const annual = { wuhuang: '北', erhei: '西南' };
  const plan = planWith([{ id: 'k1', kind: 'fishTank', roomId: 'living', x: 4, y: 6, w: 1, d: 0.5, facing: 0 }]);
  const res = analyzeFurniture({ meta: { targetGua: '坎' }, annual }, plan, { taiji: [5, 4], up: 0 });
  assert.equal(res[0].dir, '北');
  assert.ok(res[0].cautions.some((c) => c.includes('五黃')), JSON.stringify(res[0].cautions));
});

test('方位評語:床在吉方 / 凶方、神位四吉方、設備類不回評語', () => {
  assert.match(furnitureVerdict('bed', '天醫'), /適合|最適合/);
  assert.match(furnitureVerdict('bed', '絕命'), /避開/);
  assert.match(furnitureVerdict('altar', '生氣'), /適合安座/);
  assert.match(furnitureVerdict('altar', '五鬼'), /不宜安座/);
  assert.equal(furnitureVerdict('fridge', '生氣'), null);
  assert.equal(furnitureVerdict('tv', '絕命'), null);
  assert.equal(furnitureVerdict('bed', null), null);
});

test('家具卡片:有避忌或方位不宜 → caution;方位合宜且無避忌 → good', () => {
  const good = buildFurnitureCards([{ id: 'a', kind: 'desk', dir: '東南', gua: '巽', star: '生氣', cautions: [] }]);
  assert.equal(good[0].level, 'good');
  assert.match(good[0].body, /生氣/);
  const bad = buildFurnitureCards([{ id: 'b', kind: 'bed', dir: '西', gua: '兌', star: '絕命', cautions: ['正對大門(門沖)'] }]);
  assert.equal(bad[0].level, 'caution');
  assert.ok(bad[0].badges.includes('方位需調整'));
  const unknown = buildFurnitureCards([{ id: 'c', kind: 'bed', dir: null, gua: null, star: null, cautions: [] }]);
  assert.match(unknown[0].body, /方位待補/);
});

test('analyzePlacements 輸出 schema 為 v2 且帶 annual', () => {
  const r = analyzePlacements({ mingGua: '坎', annual: { wuhuang: '西' } });
  assert.equal(r.meta.schema, PLACEMENT_SCHEMA);
  assert.equal(PLACEMENT_SCHEMA, 'fengshui.placement/2');
  assert.deepEqual(r.annual, { wuhuang: '西' });
  assert.equal(r.altar.seatOptimal.length > 0, true);
  assert.equal(r.sofa.seatOptimal.length > 0, true);
});

test('家具重疊或座標壞掉不會讓分析丟錯', () => {
  const plan = planWith([
    { id: 'a', kind: 'bed', roomId: 'living', x: 5, y: 5, w: 2, d: 2 },
    { id: 'b', kind: 'desk', roomId: 'living', x: 5, y: 5, w: 1.4, d: 0.7 },
    { id: 'c', kind: 'tv', roomId: 'living', x: 'x', y: 1, w: 1, d: 1 },
    null,
  ]);
  const res = analyzeFurniture({ meta: { targetGua: '坎' } }, plan, { taiji: [5, 4], up: 0 });
  assert.equal(res.length, 2); // 壞座標與 null 被跳過
});

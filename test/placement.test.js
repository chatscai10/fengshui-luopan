import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlacements, PLACEMENT_SCHEMA } from '../src/core/placement.js';

test('analyzePlacements: 基礎結構與 Schema', () => {
  const res = analyzePlacements({ mingGua: '坎', zhaiGua: '震' });
  assert.equal(res.meta.schema, PLACEMENT_SCHEMA);
  assert.equal(res.meta.targetGua, '坎');
  assert.equal(res.meta.isPersonal, true);

  assert.ok(Array.isArray(res.bed.bestDirections));
  assert.ok(Array.isArray(res.bed.avoidDirections));
  assert.ok(Array.isArray(res.desk.bestDirections));
  assert.ok(Array.isArray(res.kitchen.seatOptimal));
  assert.ok(Array.isArray(res.kitchen.mouthOptimal));
  assert.ok(Array.isArray(res.taboos));
  assert.ok(res.taboos.length >= 5);
});

test('analyzePlacements: 八宅坎命安床與書桌吉方正確性', () => {
  const res = analyzePlacements({ mingGua: '坎' });
  // 坎命: 生氣東南(巽)、天醫東(震)、延年南(離)、伏位北(坎)
  const bestBedDirs = res.bed.bestDirections.map((x) => x.dir);
  assert.ok(bestBedDirs.includes('東') || bestBedDirs.includes('東南') || bestBedDirs.includes('南'));

  const bestDeskDirs = res.desk.bestDirections.map((x) => x.dir);
  assert.ok(bestDeskDirs.includes('東南') || bestDeskDirs.includes('南'));
});

test('analyzePlacements: 流年五黃二黑煞位扣分與提示', () => {
  const annual = { wuhuang: '西', erhei: '西北' };
  const res = analyzePlacements({ mingGua: '坎', annual });
  const westBed = res.bed.all.find((x) => x.dir === '西');
  assert.ok(westBed.cautions.some((c) => c.includes('五黃')));
});

test('analyzePlacements: 室內格局禁忌五大原則齊全', () => {
  const res = analyzePlacements({});
  const tabooIds = res.taboos.map((t) => t.id);
  assert.ok(tabooIds.includes('taboo.beam'));
  assert.ok(tabooIds.includes('taboo.door_chong'));
  assert.ok(tabooIds.includes('taboo.back_window'));
  assert.ok(tabooIds.includes('taboo.toilet_adjacent'));
  assert.ok(tabooIds.includes('taboo.mirror_reflect'));
});

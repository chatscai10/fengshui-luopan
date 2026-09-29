import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_ROWS, qiClass, buildChartGridModel, buildAnnualGridModel, orientationNote, altText, gridToText, cellText,
} from '../../src/ui/canvas/starGrid.js';
import { scenario } from './report.helpers.js';

test('九宮排列是傳統南上:上排 巽 離 坤,中排 震 中 兌,下排 艮 坎 乾', () => {
  assert.deepEqual(GRID_ROWS.map((r) => [...r]), [['巽', '離', '坤'], ['震', '中', '兌'], ['艮', '坎', '乾']]);
});

test('qiClass: 旺 / 退 / 煞 三類,不認得的標籤不上色', () => {
  for (const l of ['旺', '近旺生', '遠旺生', '進', '生']) assert.equal(qiClass(l), 'wang', l);
  for (const l of ['退', '衰']) assert.equal(qiClass(l), 'tui', l);
  for (const l of ['死', '煞衰', '煞']) assert.equal(qiClass(l), 'sha', l);
  assert.equal(qiClass('亂寫'), 'none');
  assert.equal(qiClass(undefined), 'none');
});

test('玄空盤模型:九運丑山未向,格位對照 API 範例', () => {
  const { report } = scenario('full');
  const m = buildChartGridModel(report);
  assert.equal(m.kind, 'chart');
  assert.equal(Object.keys(m.cells).length, 9);
  // 坤宮山九向九運六(API.md 範例的向宮);艮宮是坐宮
  const kun = m.cells['坤'];
  assert.equal(kun.shan.star, 9);
  assert.equal(kun.xiang.star, 9);
  assert.equal(kun.yun.star, 6);
  assert.equal(kun.shan.cls, 'wang');
  assert.equal(kun.shan.tag, '旺');
  assert.deepEqual(kun.marks, ['向']);
  assert.deepEqual(m.cells['艮'].marks, ['坐']);
  // 中宮:山三向六運九
  const c = m.cells['中'];
  assert.deepEqual([c.shan.star, c.xiang.star, c.yun.star], [3, 6, 9]);
  // 五黃是煞、八白在九運是退
  assert.equal(m.cells['乾'].xiang.star, 5);
  assert.equal(m.cells['乾'].xiang.cls, 'sha');
  assert.equal(m.cells['震'].xiang.star, 8);
  assert.equal(m.cells['震'].xiang.cls, 'tui');
  // 每個有星的格子都帶文字標籤(不只靠顏色)
  for (const cell of Object.values(m.cells)) {
    for (const k of ['shan', 'xiang', 'yun']) {
      assert.ok(cell[k].star >= 1 && cell[k].star <= 9);
      assert.ok(cell[k].tag, `${cell.gua}.${k} 缺文字標籤`);
    }
  }
});

test('沒有建成年份時沒有玄空盤模型,流年盤仍可用', () => {
  const { report } = scenario('noYear');
  assert.equal(buildChartGridModel(report), null);
  assert.ok(buildAnnualGridModel(report));
});

test('流年盤模型:2026 年入中一,五黃在南、二黑在西北,標出太歲歲破三煞', () => {
  const { report } = scenario('full');
  const m = buildAnnualGridModel(report);
  assert.equal(m.kind, 'annual');
  assert.equal(m.center, 1);
  assert.equal(m.cells['中'].flow.star, 1);
  assert.equal(m.cells['離'].flow.star, 5);
  assert.equal(m.cells['乾'].flow.star, 2);
  assert.ok(m.cells['離'].tags.includes('太歲'));
  assert.ok(m.cells['坎'].tags.includes('歲破'));
  assert.ok(m.cells['坎'].tags.includes('三煞'));
  assert.equal(m.cells['離'].flow.cls, 'sha'); // 五黃
  assert.ok(m.cells['離'].flow.tag);
});

test('圖旁小字說明是羅盤方位與你家朝向', () => {
  const { report } = scenario('full');
  const note = orientationNote(report);
  assert.match(note, /羅盤方位/);
  assert.match(note, /上方是南方/);
  assert.match(note, /你家朝向西南方/);
  assert.match(note, /未山/);
  assert.equal(buildChartGridModel(report).note, note);
});

test('文字版:每格描述與整張圖的替代文字、純文字九宮', () => {
  const { report } = scenario('full');
  const m = buildChartGridModel(report);
  assert.match(cellText(m, m.cells['坤']), /坤宮\(西南方\).*是向宮.*山星九紫\(旺\).*向星九紫\(旺\).*運星六白/);
  assert.match(altText(m), /上方是南方/);
  const text = gridToText(m);
  assert.equal(text.split('\n').length, 4);
  assert.match(text, /巽\(東南\)/);
  assert.match(text, /中宮/);
  // 流年盤文字
  const a = gridToText(buildAnnualGridModel(report));
  assert.match(a, /流年5/);
});

test('不同朝向都能畫出完整九宮(掃過 24 山附近的角度)', () => {
  for (let b = 0; b < 360; b += 7.5) {
    const { report } = scenario('full', b);
    const m = buildChartGridModel(report);
    assert.ok(m, `bearing ${b}`);
    assert.equal(Object.keys(m.cells).length, 9);
    const marks = Object.values(m.cells).flatMap((c) => c.marks);
    assert.deepEqual([...marks].sort(), ['向', '坐'], `bearing ${b}`);
  }
});

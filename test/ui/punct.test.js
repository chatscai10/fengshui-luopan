import test from 'node:test';
import assert from 'node:assert/strict';
import { zhPunct } from '../../src/ui/punct.js';

test('中文旁的半形標點換成全形', () => {
  assert.equal(zhPunct('太歲在南方,歲破在北方'), '太歲在南方，歲破在北方');
  assert.equal(zhPunct('注意: 五黃在南方;二黑在西北方'), '注意：五黃在南方；二黑在西北方');
  assert.equal(zhPunct('「向」該怎麼選?'), '「向」該怎麼選？');
  assert.equal(zhPunct('真的嗎!'), '真的嗎！');
});

test('括號成對換成全形,英數括號不動', () => {
  assert.equal(zhPunct('八宅(依大門定的吉方)'), '八宅（依大門定的吉方）');
  assert.equal(zhPunct('以 2005 年(建成)的運'), '以 2005 年（建成）的運');
  assert.equal(zhPunct('175.0°(午山)'), '175.0°（午山）');
  assert.equal(zhPunct('使用 foo(bar) 這個函式'), '使用 foo(bar) 這個函式');
});

test('數字裡的標點、時間、沒有中文的字串不動', () => {
  assert.equal(zhPunct('共 3,000 元'), '共 3,000 元');
  assert.equal(zhPunct('出生 08:30 之後'), '出生 08:30 之後');
  assert.equal(zhPunct('a, b: c (d)'), 'a, b: c (d)');
  assert.equal(zhPunct(''), '');
  assert.equal(zhPunct(null), null);
});

test('全形標點後多餘的半形空白拿掉,重複執行結果不變', () => {
  assert.equal(zhPunct('客廳的左上角: 兩面實牆'), '客廳的左上角：兩面實牆');
  const once = zhPunct('太歲在南方,歲破(北方): 留意');
  assert.equal(zhPunct(once), once);
});

test('「次臥 1的」補空白', () => {
  assert.equal(zhPunct('次臥 1的右上角'), '次臥 1 的右上角');
  assert.equal(zhPunct('次臥 2的左上角(明財位)'), '次臥 2 的左上角（明財位）');
  assert.equal(zhPunct('約 5 度的差'), '約 5 度的差');
});

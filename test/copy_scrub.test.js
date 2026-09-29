import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubText } from '../src/core/copy.js';

test('scrubText 去掉重複的確定度括號', () => {
  assert.equal(scrubText('用火用電要小心(中信心)。'), '用火用電要小心。');
  assert.equal(scrubText('不適合安床(低信心);其他照舊。'), '不適合安床;其他照舊。');
  assert.equal(scrubText('可視為文昌位(高信心)。'), '可視為文昌位。');
});

test('scrubText 去掉英文來源名加年份的括號,但保留一般括號解釋', () => {
  assert.equal(scrubText('少數說法(MyGoNews 2010)只取龍邊一角。'), '少數說法只取龍邊一角。');
  assert.equal(scrubText('玄空財位(雙星會向,9運盤)'), '玄空財位(雙星會向,9運盤)');
  assert.equal(scrubText('財位(傳統上認為適合放置催財的位置)'), '財位(傳統上認為適合放置催財的位置)');
});

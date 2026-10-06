import test from 'node:test';
import assert from 'node:assert/strict';
import { circDiff, assertDeepApprox, loadFixture } from './harness.js';
import { DEFAULT_SETTINGS, resolveSettings } from '../../src/core/settings.js';

test('circDiff 跨 0 度', () => {
  assert.ok(circDiff(359.9999995, 0) < 1e-6);
  assert.equal(circDiff(10, 350), 20);
  assert.equal(circDiff(0, 180), 180);
});
test('resolveSettings 拒絕未知鍵', () => {
  assert.throws(() => resolveSettings({ nortMode: 'true' }));
  assert.throws(() => resolveSettings({ constructor: 1 }), /未知的設定鍵/);
  assert.throws(() => resolveSettings({ toString: 1 }), /未知的設定鍵/);
  assert.equal(resolveSettings().northMode, DEFAULT_SETTINGS.northMode);
});
test('resolveSettings 拒絕非物件:不可靜默回傳整份預設值', () => {
  // Object.keys(5) 是空陣列,不擋的話呼叫端打錯型別會拿到「看起來正常」的設定,錯誤延後到很奇怪的地方才爆。
  for (const bad of [null, 5, 'magnetic', true, [1], ['northMode']]) {
    assert.throws(() => resolveSettings(bad), /設定必須是物件/, `應拒絕 ${JSON.stringify(bad)}`);
  }
  // 錯誤碼要能穿過 geo / calendar 的公開介面(它們有一致性契約:只能丟「大寫碼: 訊息」)。
  assert.throws(() => resolveSettings(null), /^Error: INVALID_SETTING: /);
  assert.equal(resolveSettings(undefined).northMode, DEFAULT_SETTINGS.northMode, 'undefined 視同沒給');
  assert.equal(resolveSettings({}).northMode, DEFAULT_SETTINGS.northMode);
});
test('assertDeepApprox 能抓錯', () => {
  assertDeepApprox({ a: [1, 2.0000000001] }, { a: [1, 2] });
  assert.throws(() => assertDeepApprox({ a: 1 }, { a: 2 }));
});
test('fixtures 都是 {meta, cases} 且可載入', () => {
  for (const n of ['bazhai', 'xuankong_core', 'xuankong_patterns', 'wealth_position', 'orientation', 'annual', 'luopan_rings', 'device_compass']) {
    const f = loadFixture(n);
    assert.ok(f.meta && Array.isArray(f.cases), `${n} 格式不符`);
  }
});

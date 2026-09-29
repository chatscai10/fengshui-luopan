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

// 各模組測試共用的小工具。fixtures 一律唯讀(不在測試中改寫)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(here, '..', 'fixtures');

export function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** 圓周差(度),回傳 [0,180]。359.9999995 與 0 視為相等。 */
export function circDiff(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

export function assertApprox(actual, expected, tol = 1e-9, msg = '') {
  assert.ok(
    typeof actual === 'number' && Math.abs(actual - expected) <= tol,
    `${msg} expected ${expected} ± ${tol}, got ${actual}`,
  );
}

export function assertAngle(actual, expected, tol = 1e-6, msg = '') {
  assert.ok(
    typeof actual === 'number' && circDiff(actual, expected) <= tol,
    `${msg} expected bearing ${expected} ± ${tol}, got ${actual}`,
  );
}

/** 深度比較,數字用容差,其他型別嚴格相等。 */
export function assertDeepApprox(actual, expected, tol = 1e-9, at = '$') {
  if (typeof expected === 'number') {
    assert.ok(
      typeof actual === 'number' && Math.abs(actual - expected) <= tol,
      `${at}: expected ${expected} ± ${tol}, got ${actual}`,
    );
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${at}: array length mismatch`);
    expected.forEach((e, i) => assertDeepApprox(actual[i], e, tol, `${at}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${at}: expected object, got ${actual}`);
    for (const k of Object.keys(expected)) assertDeepApprox(actual[k], expected[k], tol, `${at}.${k}`);
  } else {
    assert.equal(actual, expected, `${at}`);
  }
}

/** confidence=low 的案例走軟斷言(只要求不崩潰)。 */
export const isSoft = (c) => c && c.confidence === 'low';

/** 突變測試:證明 runner 真的會抓到被改錯的期望值。 */
export function assertRunnerCatches(runner, badCase) {
  assert.throws(() => runner(badCase), undefined, 'runner 未抓出故意改錯的期望值');
}

// 宮位對照(spec 1.3 / 4.3)
export const GUA = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
export const DIR_OF_GUA = { 坎: '北', 艮: '東北', 震: '東', 巽: '東南', 離: '南', 坤: '西南', 兌: '西', 乾: '西北' };
export const GUA_OF_DIR = Object.fromEntries(Object.entries(DIR_OF_GUA).map(([g, d]) => [d, g]));
export const LUOSHU = { 坎: 1, 坤: 2, 震: 3, 巽: 4, 中: 5, 乾: 6, 兌: 7, 艮: 8, 離: 9 };
export const GUA_OF_LUOSHU = Object.fromEntries(Object.entries(LUOSHU).map(([g, n]) => [n, g]));

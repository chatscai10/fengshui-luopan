// 簡單模式的流程判斷(EASY_SPEC 8.6):停在哪一步、「想讓結果更準?」問哪一項、建成年份(民國年)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EASY_STEPS, resumeStep, nextHint, parseYearLoose } from '../../src/ui/easy/flow.js';
import { yearBounds } from '../../src/ui/views/house.js';

const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);
const S = ({ bearing = 200, plan = null, easyStep, builtYear = null, residents = [] } = {}) => ({
  facing: { bearing }, plan, building: { builtYear }, residents, ui: easyStep === undefined ? {} : { easyStep },
});
const PLAN = { version: 1 };

test('EASY_STEPS', () => {
  assert.deepEqual(EASY_STEPS, ['facing', 'layout', 'result']);
  assert.ok(Object.isFrozen(EASY_STEPS));
});

test('resumeStep:各分支', () => {
  // 沒有朝向一律第 1 步
  for (const easyStep of [undefined, 'facing', 'layout', 'result']) {
    assert.equal(resumeStep(S({ bearing: null, easyStep, plan: PLAN })), 'facing');
    assert.equal(resumeStep(S({ bearing: NaN, easyStep })), 'facing');
  }
  // 停在第 1 步的就回第 1 步
  assert.equal(resumeStep(S({ easyStep: 'facing', plan: PLAN })), 'facing');
  assert.equal(resumeStep(S({ easyStep: 'facing' })), 'facing');
  // 有平面圖
  assert.equal(resumeStep(S({ plan: PLAN })), 'result');
  assert.equal(resumeStep(S({ plan: PLAN, easyStep: 'result' })), 'result');
  assert.equal(resumeStep(S({ plan: PLAN, easyStep: 'layout' })), 'layout');
  assert.equal(resumeStep(S({ plan: PLAN, easyStep: 'bogus' })), 'result');
  // 沒有平面圖:跳過格局的人停在結果頁,其他人到第 2 步
  assert.equal(resumeStep(S()), 'layout');
  assert.equal(resumeStep(S({ easyStep: 'layout' })), 'layout');
  assert.equal(resumeStep(S({ easyStep: 'result' })), 'result');
  // 朝向 0 度是有效的
  assert.equal(resumeStep(S({ bearing: 0, plan: PLAN })), 'result');
  // 壞狀態
  assert.equal(resumeStep(null), 'facing');
  assert.equal(resumeStep({}), 'facing');
});

test('nextHint:平面圖 → 建成年份 → 住戶 → null', () => {
  assert.equal(nextHint(S()), 'plan');
  assert.equal(nextHint(S({ builtYear: 2005 })), 'plan');
  assert.equal(nextHint(S({ plan: PLAN })), 'year');
  assert.equal(nextHint(S({ plan: PLAN, residents: [{ id: 'a' }] })), 'year');
  assert.equal(nextHint(S({ plan: PLAN, builtYear: 2005 })), 'residents');
  assert.equal(nextHint(S({ plan: PLAN, builtYear: 2005, residents: [{ id: 'a' }] })), null);
  assert.equal(nextHint({}), 'plan');
});

test('parseYearLoose:規格範例與民國年', () => {
  assert.deepEqual(parseYearLoose('94', NOW), { ok: true, value: 2005, roc: 94 });
  assert.deepEqual(parseYearLoose('民國94', NOW), { ok: true, value: 2005, roc: 94 });
  assert.deepEqual(parseYearLoose('民國 94 年', NOW), { ok: true, value: 2005, roc: 94 });
  assert.deepEqual(parseYearLoose('９４', NOW), { ok: true, value: 2005, roc: 94 }, '全形數字');
  assert.deepEqual(parseYearLoose(' 2005 ', NOW), { ok: true, value: 2005 });
  assert.deepEqual(parseYearLoose('２００５', NOW), { ok: true, value: 2005 });
  assert.deepEqual(parseYearLoose('1', NOW), { ok: true, value: 1912, roc: 1 });
  assert.deepEqual(parseYearLoose('115', NOW), { ok: true, value: 2026, roc: 115 });
  assert.deepEqual(parseYearLoose('', NOW), { ok: true, value: null });
  assert.deepEqual(parseYearLoose('   ', NOW), { ok: true, value: null });
  assert.deepEqual(parseYearLoose(undefined, NOW), { ok: true, value: null });
});

test('parseYearLoose:錯誤都回白話訊息,超過今年也算錯', () => {
  const { max } = yearBounds(NOW);
  assert.equal(max, 2026);
  const bad = ['12345', '116', '2027', '2099', '1899', 'abc', '民國', '0', '94.5', '-5'];
  for (const t of bad) {
    const r = parseYearLoose(t, NOW);
    assert.equal(r.ok, false, t);
    assert.equal(typeof r.message, 'string');
    assert.ok(/[一-鿿]/.test(r.message), r.message);
  }
  assert.equal(parseYearLoose('116', NOW).message, '年份要在 1900 到 2026 年之間。');
  assert.equal(parseYearLoose('2099', NOW).message, '建成年份要在 1900 到 2026 年之間。');
  assert.equal(parseYearLoose('12345', NOW).message, '建成年份只能填 4 位數字,例如 2004。');
  // 年份上限跟著「今年」走
  assert.equal(parseYearLoose('116', Date.UTC(2027, 5, 1)).value, 2027);
});

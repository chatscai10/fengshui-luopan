// 回歸: 財位說明卡片的 id 用「點」(wealth.ming.bed2.TL),候選 id 用「冒號」(bed2:TL),
// 兩者格式不同曾讓換名字的比對永遠失敗,報告裡多間臥室的明財位全叫「臥室的…角」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHouse } from '../../src/core/analyze.js';
import { renderReport } from '../../src/core/copy.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import { sanitizePage } from '../../src/ui/views/wealth.js';

function sample() {
  const plan = buildTemplate('three').plan;
  plan.planUpBearing = 210;
  const report = analyzeHouse({
    nowMs: Date.UTC(2026, 8, 29, 4),
    facing: { bearing: 210, doorBearing: null, declination: -5.06 },
    building: { type: 'apartment', builtYear: 2025 },
    residents: [{ id: 'r1', name: '王', gender: 'M', birth: '1985-06-15' }],
    mainResidentId: 'r1', plan,
  }, {});
  return { plan, report, page: sanitizePage(renderReport(report), report, plan) };
}

test('每張明財位說明卡都用平面圖上看得到的房間名稱', () => {
  const { plan, report, page } = sample();
  const nameOf = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const cards = page.sections.flatMap((s) => s.cards).filter((c) => /^wealth\.ming\.[a-z0-9]+\.(TL|TR|BL|BR)$/.test(c.id));
  assert.ok(cards.length >= 6, `預期至少 6 張,實得 ${cards.length}`);
  for (const c of cards) {
    const [, , roomId] = c.id.split('.');
    const name = nameOf.get(roomId);
    assert.ok(name, `找不到房間 ${roomId}`);
    assert.ok(c.headline.includes(name), `卡片 ${c.id} 標題 "${c.headline}" 沒有用房間名稱 "${name}"`);
    // 多間臥室不可再出現籠統的「臥室的…角」
    if (nameOf.get(roomId) !== '臥室') assert.ok(!/(^|[^主次])臥室的[左右][上下]角/.test(`${c.headline}${c.body}`), `${c.id} 仍有籠統的「臥室的…角」`);
  }
  assert.ok(report.wealth.candidates.length > 0);
});

test('三間臥室的明財位標題彼此不同', () => {
  const { page } = sample();
  const heads = page.sections.flatMap((s) => s.cards)
    .filter((c) => /^wealth\.ming\.(bed2|bed3|master)\./.test(c.id)).map((c) => c.headline);
  assert.equal(new Set(heads).size, heads.length, `有重複標題: ${heads.join(' | ')}`);
});

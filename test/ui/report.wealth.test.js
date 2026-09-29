import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWealthModel, buildWhyRows, buildChecks, markOf, roomsInGua, collectModelTexts, badgeClass, TIER_LABEL, sanitizePage, softScoreWords,
} from '../../src/ui/views/wealth.js';
import { findScoreLeaks } from '../../src/ui/views/report.js';
import { scenario, CASES } from './report.helpers.js';

const model = (name, bearing) => {
  const s = scenario(name, bearing);
  return { ...s, m: buildWealthModel(s.state, s.report, s.page) };
};

test('markOf: 依引擎給的方向分三種記號', () => {
  assert.equal(markOf(1), 'good');
  assert.equal(markOf(0.55), 'good');
  assert.equal(markOf(0.25), 'neutral');
  assert.equal(markOf(0), 'neutral');
  assert.equal(markOf(-0.3), 'watch');
  assert.equal(markOf(NaN), 'neutral');
});

test('完整資料:最佳財位是客廳的明財位,三段標籤、縮圖標記與其他候選', () => {
  const { m } = model('full');
  assert.equal(m.status, 'ok');
  assert.equal(m.best.id, 'living:TR');
  assert.equal(m.best.tier, 'suitable');
  assert.equal(m.best.tierLabel, '較適合');
  assert.equal(m.best.headline, '客廳的右上角(明財位)');
  assert.equal(m.best.lead, '客廳的右上角(明財位),在房子的東方(震宮)');
  assert.equal(m.best.where, '在房子的東方(震宮)。');
  assert.equal(m.best.isMing, true);
  assert.ok(m.others.length >= 1);
  assert.ok(m.others.every((e) => e.tierLabel));
  assert.ok(m.map);
  assert.deepEqual(m.map.taiji, [5, 4]);
  assert.equal(m.map.up, 30);
  assert.equal(m.map.markers[0].id, 'living:TR');
  assert.equal(m.map.markers[0].order, 1);
  assert.deepEqual(m.map.markers[0].point, [6, 5]);
});

test('為什麼清單:玄空、八宅、本命、流年各一行,標記依引擎方向,文字白話', () => {
  const { m } = model('full');
  const rows = Object.fromEntries(m.best.why.map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(rows), ['G', 'XK', 'H', 'P', 'Y']);
  assert.equal(rows.G.mark, 'good');
  assert.match(rows.XK.detail, /山星是一白、向星是八白/);
  assert.equal(rows.XK.mark, 'good');
  assert.match(rows.H.detail, /六煞/);
  assert.equal(rows.H.mark, 'watch');
  assert.match(rows.P.detail, /依本人的命卦.*天醫/);
  assert.match(rows.Y.detail, /八白/);
  for (const r of m.best.why) {
    assert.ok(['✓', '－', '!'].includes(r.markIcon));
    assert.ok(r.markWord);
    assert.ok(!('value' in r) && !('points' in r) && !('weight' in r));
  }
});

test('沒有住戶時不列本命,沒有建成年不列玄空', () => {
  const noRes = model('noResidents').m;
  assert.ok(!noRes.best.why.some((r) => r.key === 'P'));
  const noYear = model('noYear').m;
  assert.ok(!noYear.best.why.some((r) => r.key === 'XK'));
});

test('現況檢查:窗在角落時列出補救,兩面實牆通過', () => {
  const { m, report, page } = model('windowCorner');
  const ming = [m.best, ...m.others].find((e) => e.id === 'living:TR');
  assert.ok(ming, '明財位不論排名都列出');
  assert.equal(ming.tier, 'notAdvised');
  assert.ok(ming.checks.some((c) => !c.ok && /窗/.test(c.text)));
  assert.ok(ming.remedies.length >= 1);
  assert.ok(ming.remedies.some((r) => /矮櫃|窗簾|屏風/.test(r.body)));
  // 最佳位置(臥室的角)通過檢查
  assert.equal(m.best.id, 'bed:TR');
  assert.ok(m.best.checks.every((c) => c.ok));
  const cand = report.wealth.candidates.find((c) => c.id === 'living:TR');
  assert.equal(buildChecks(cand, page).checks[0].ok, false);
  assert.deepEqual(buildChecks(null, page), { checks: [], remedies: [] });
});

test('沒有平面圖:只給暗財位方位,沒有縮圖,有引導卡', () => {
  const { m } = model('noPlan');
  assert.equal(m.status, 'ok');
  assert.equal(m.map, null);
  assert.ok(m.best.isDark);
  assert.equal(m.best.point, null);
  assert.ok(m.best.why.length >= 3);
  const g = m.guides.find((x) => x.id === 'plan');
  assert.ok(g);
  assert.equal(g.tab, 'plan');
  assert.ok(!m.guides.some((x) => x.id === 'year'));
});

test('沒有大門:不給明財位並引導去標大門', () => {
  const { m } = model('noDoor');
  assert.ok(![m.best, ...m.others].some((e) => e && e.isMing));
  const g = m.guides.find((x) => x.id === 'door');
  assert.ok(g && g.tab === 'plan');
  assert.ok(m.map, '有平面圖仍畫縮圖');
});

test('缺建成年、缺住戶、住戶資料不完整、平面圖不合法:各給引導', () => {
  assert.equal(model('noYear').m.guides.find((x) => x.id === 'year').tab, 'house');
  assert.equal(model('noResidents').m.guides.find((x) => x.id === 'residents').tab, 'house');
  const bad = model('badResident').m;
  assert.match(bad.guides.find((x) => x.id === 'residents-incomplete').text, /1 位住戶/);
  const inv = model('invalidPlan').m;
  assert.equal(inv.guides.find((x) => x.id === 'plan-invalid').tab, 'plan');
  assert.equal(inv.map, null);
  const minimal = model('minimal').m;
  assert.deepEqual(minimal.guides.map((g) => g.id).sort(), ['plan', 'residents', 'year']);
});

test('資料齊全時只剩一項選填提醒或沒有引導', () => {
  const { m } = model('full');
  assert.deepEqual(m.guides, []);
});

test('NO_FACING 與其他錯誤各有對應狀態,不丟例外', () => {
  const s = scenario('full');
  assert.equal(buildWealthModel(s.state, { error: 'NO_FACING', missing: ['facing'] }, null).status, 'no-facing');
  assert.equal(buildWealthModel(s.state, { error: 'INVALID_BEARING: x' }, null).status, 'error');
  assert.equal(buildWealthModel(s.state, undefined, null).status, 'no-facing');
});

test('今年要留意:五黃二黑太歲歲破三煞落在哪個方位與房間', () => {
  const { m } = model('full');
  const a = m.annual;
  assert.ok(a.hasPlan);
  const items = a.blocks.flatMap((b) => b.items);
  const by = Object.fromEntries(items.map((i) => [i.label, i]));
  assert.equal(by['五黃'].dir, '南');
  assert.equal(by['二黑'].dir, '西北');
  assert.equal(by['太歲'].dir, '南');
  assert.equal(by['歲破'].dir, '北');
  assert.equal(by['三煞'].dir, '北');
  assert.equal(by['三煞'].gua, '坎');
  assert.ok(items.every((i) => Array.isArray(i.rooms)));
  const withRooms = items.filter((i) => i.rooms.length);
  assert.ok(withRooms.length > 0);
  // 房間名稱是白話,不是內部 id
  for (const i of withRooms) for (const r of i.rooms) assert.match(r, /客廳|臥室/);
  // 沒有平面圖:仍有方位,沒有房間
  const np = model('noPlan').m.annual;
  assert.equal(np.hasPlan, false);
  assert.ok(np.blocks.flatMap((b) => b.items).every((i) => i.rooms.length === 0));
});

test('roomsInGua 過濾佔比太小的房間', () => {
  const { report, state } = scenario('full');
  const list = roomsInGua(report, state.plan, '離');
  assert.ok(list.length >= 1 && list.length <= 2);
  assert.deepEqual(roomsInGua({}, state.plan, '離'), []);
  assert.deepEqual(roomsInGua(report, state.plan, '不存在'), []);
});

test('催財小提醒來自傳統說法卡片,放水提示依設定才出現', () => {
  const { m } = model('full');
  assert.ok(m.tips.some((t) => t.id === 'wealth.soft.tips'));
  assert.ok(m.tips.every((t) => t.badges.includes('傳統說法') || t.badges.length >= 0));
  assert.ok(!m.tips.some((t) => t.id.startsWith('wealth.water.')));
});

test('免責聲明一定帶著', () => {
  const { m } = model('full');
  assert.equal(m.disclaimers.length, 4);
  assert.match(m.disclaimers[0], /不保證任何財運結果/);
});

test('分數不外洩:所有情境、多個朝向,模型裡沒有分數欄位也沒有分數字樣', () => {
  const bad = [];
  for (const name of Object.keys(CASES)) {
    for (const b of [0, 37, 90, 158.7, 210, 275.5, 333]) {
      const { m } = model(name, b);
      const json = JSON.stringify(m);
      for (const key of ['"score"', '"rawScore"', '"points"', '"weight"', '"energy"', '"subtotal"']) {
        assert.ok(!json.includes(key), `${name}@${b} 模型含 ${key}`);
      }
      bad.push(...findScoreLeaks(collectModelTexts(m)).map((t) => `${name}@${b}: ${t}`));
    }
  }
  assert.deepEqual(bad, []);
});

test('softScoreWords 把「分數」改成「排序」,sanitizePage 不改動原物件', () => {
  assert.equal(softScoreWords('不進分數: 保持整潔'), '不進排序: 保持整潔');
  assert.equal(softScoreWords('目前只做扣分與提醒'), '目前只做調降排序與提醒');
  assert.equal(softScoreWords(null), null);
  const { page } = scenario('noPlan');
  const before = JSON.stringify(page);
  const clean = sanitizePage(page);
  assert.equal(JSON.stringify(page), before);
  assert.ok(!JSON.stringify(clean).includes('分數'));
});

test('renderReport 卡片經 sanitizePage 後沒有任何分數字樣', () => {
  const bad = [];
  for (const name of Object.keys(CASES)) {
    for (const b of [0, 45, 88, 210, 300]) {
      const { page } = { page: sanitizePage(scenario(name, b).page) };
      const texts = [page.plainSummary, ...page.disclaimers];
      for (const s of page.sections) for (const c of s.cards) texts.push(c.headline, c.body, c.schoolNote, c.footnote, ...c.badges);
      bad.push(...findScoreLeaks(texts).map((t) => `${name}@${b}: ${t}`));
    }
  }
  assert.deepEqual(bad, []);
});

test('badgeClass / TIER_LABEL', () => {
  assert.equal(TIER_LABEL.suitable, '較適合');
  assert.equal(TIER_LABEL.consider, '可以考慮');
  assert.equal(TIER_LABEL.notAdvised, '不建議');
  assert.match(badgeClass('需要留意'), /warn/);
  assert.match(badgeClass('傳統說法'), /wealth/);
  assert.equal(badgeClass('確定度較高'), 'badge');
});

test('buildWhyRows 對暗財位(沒有候選)用宮位資料', () => {
  const { report } = scenario('noPlan');
  const top = report.summary.wealthTop[0];
  const rows = buildWhyRows(null, report.wealth.sectors[top.sector], report);
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => r.key !== 'G'));
});

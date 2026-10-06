// analyze(分析門面)與 copy(白話文案)的測試。沒有 fixtures;期望值來自規格 2.6.7 的已驗證算術例、規格 5.2/5.5 的文字,
// 以及對底層模組真實輸出的整合檢查。另有突變測試(規格 4.2 第 3 點)與「規格內嵌資料 == 實作」測試(規格 4.2 第 6 點)。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { circDiff } from './helpers/harness.js';
import {
  NOW,
  SPEC_TEXT,
  clone,
  deepFreeze,
  displayTexts,
  goldenInput,
  goldenPlan,
  jsonProblems,
  mulberry32,
  randomHouse,
  scanFindingIds,
} from './helpers/analyze.js';
import { HOUSE_SCHEMA, WEALTH_TIERS, analyzeHouse, wealthTier } from '../src/core/analyze.js';
import {
  CARD_DISCLAIMER,
  COPY_FAMILIES,
  DISCLAIMERS,
  GLOSSARY,
  SECTION_ORDER,
  applyTone,
  explainTerms,
  familyOfFindingId,
  renderReport,
  scrubText,
} from '../src/core/copy.js';
import { analyzeWealth } from '../src/core/wealth.js';
import { analyzeBazhai } from '../src/core/bazhai.js';
import { lichun } from '../src/core/calendar.js';
import { sitFromFacing } from '../src/core/geo.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const SCORE_TOL = 0.011;
const cand = (r, id) => r.wealth.candidates.find((c) => c.id === id);
const findingIds = (r) => r.findings.map((f) => f.id);
const has = (r, id) => findingIds(r).includes(id);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);

// ═══════════════════════════ A. 黃金案例(規格 2.6.7) ═══════════════════════════

/** 規格 2.6.7 的數字由規格文字解析,不在測試裡另寫一份。 */
function specExample() {
  const m = /`mingcai` 檔 ([\d.]+) 分,`xuankong` 檔 ([\d.]+)/.exec(SPEC_TEXT);
  const w = /有窗版 ([\d.]+) 與 ([\d.]+)/.exec(SPEC_TEXT);
  const b = /方位 (\d+) 度落震宮/.exec(SPEC_TEXT);
  assert.ok(m && w && b, '規格 2.6.7 的算術例文字找不到');
  return { mingcai: Number(m[1]), xuankong: Number(m[2]), windowMingcai: Number(w[1]), windowXuankong: Number(w[2]), bearing: Number(b[1]) };
}

/** 黃金案例的檢查清單;回傳不一致的項目名稱(空陣列 = 全對)。突變測試用它證明 runner 抓得出被改錯的期望值。 */
function checkGolden(r, exp) {
  const bad = [];
  const eq = (name, actual, want) => {
    if (actual !== want) bad.push(name);
  };
  const near = (name, actual, want, tol) => {
    if (!(typeof actual === 'number' && Math.abs(actual - want) <= tol)) bad.push(name);
  };
  const ming = cand(r, 'living:TR');
  eq('label', r.geo.label, exp.label);
  eq('zhai', r.bazhai.house.name, exp.zhai);
  eq('minggua', r.bazhai.residents[0].ming.gua, exp.minggua);
  eq('chartYun', r.xuankong.meta.chartYun, exp.chartYun);
  eq('pattern', r.xuankong.pattern, exp.pattern);
  eq('sector', ming.sector, exp.sector);
  near('bearing', ming.sectorInfo.bearing, exp.bearing, 1e-9);
  near('score', ming.score, exp.mingcai, SCORE_TOL);
  eq('wuhuang', r.annual.annual.wuhuang, exp.wuhuang);
  eq('erhei', r.annual.annual.erhei, exp.erhei);
  eq('year', r.annual.year.fengshuiYear, exp.year);
  return bad;
}

describe('黃金案例: 九運丑山未向、2026 流年、坎命、10x8 外框、客廳 6x5(規格 2.6.7)', () => {
  const spec = specExample();
  const golden = analyzeHouse(goldenInput());
  const EXPECT = {
    label: '丑山未向',
    zhai: '艮宅',
    minggua: '坎',
    chartYun: 9,
    pattern: '雙星會向',
    sector: '震',
    bearing: spec.bearing,
    mingcai: spec.mingcai,
    wuhuang: '南',
    erhei: '西北',
    year: 2026,
  };

  it('規格算術例: 明財位 TR=(6,5) 方位 75 度落震宮,mingcai 檔 66.88 分', () => {
    const ming = cand(golden, 'living:TR');
    assert.equal(ming.kind, 'ming');
    assert.deepEqual(ming.point, [6, 5]);
    assert.equal(ming.sector, '震');
    assert.ok(circDiff(ming.sectorInfo.bearing, 75) <= 1e-9);
    assert.ok(Math.abs(ming.score - 66.88) <= SCORE_TOL);
    assert.equal(golden.wealth.bestId, 'living:TR');
  });
  it('xuankong 檔 59.25 分', () => {
    const x = analyzeHouse(goldenInput(), { wealthProfile: 'xuankong' });
    assert.ok(Math.abs(cand(x, 'living:TR').score - 59.25) <= SCORE_TOL);
    assert.equal(x.meta.ruleset.wealthProfile, 'xuankong');
    assert.equal(x.wealth.meta.ruleset.qiIntake, 'reward', '玄空檔的開口處理跟著檔位');
  });
  it('有窗版 33.44 與 62.21', () => {
    const win = { id: 'w1', kind: 'window', roomId: 'living', wall: 'right', pos: 4.1, width: 1.0 };
    const openings = [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1.0, width: 0.9 }, win];
    const input = goldenInput({ plan: goldenPlan({ openings }) });
    const a = analyzeHouse(input);
    const b = analyzeHouse(input, { wealthProfile: 'xuankong' });
    assert.equal(cand(a, 'living:TR').status, 'void_window');
    assert.ok(Math.abs(cand(a, 'living:TR').score - spec.windowMingcai) <= SCORE_TOL);
    assert.ok(Math.abs(cand(b, 'living:TR').score - spec.windowXuankong) <= SCORE_TOL);
    assert.equal(wealthTierOf(a, 'living:TR'), 'notAdvised', '財位見空的明財位標為不建議');
  });
  it('黃金案例的所有期望值(runner)全對', () => {
    assert.deepEqual(checkGolden(golden, EXPECT), []);
  });
  it('突變測試: 故意改錯任一期望值,runner 抓得出來', () => {
    const mutations = {
      label: '子山午向',
      zhai: '坎宅',
      minggua: '艮',
      chartYun: 8,
      pattern: '旺山旺向',
      sector: '離',
      bearing: 80,
      mingcai: 67.0,
      wuhuang: '北',
      erhei: '南',
      year: 2025,
    };
    for (const [k, v] of Object.entries(mutations)) {
      const bad = checkGolden(golden, { ...EXPECT, [k]: v });
      assert.deepEqual(bad, [k === 'mingcai' ? 'score' : k], `改錯 ${k} 應被抓出`);
    }
  });
  it('各層結果: 宅卦、命卦、格局、流年、太歲三煞、平面圖佔比', () => {
    assert.equal(golden.meta.schema, HOUSE_SCHEMA);
    assert.equal(golden.geo.sitMountain, '丑');
    assert.equal(golden.geo.facingMountain, '未');
    assert.equal(golden.geo.zone, 'zheng');
    assert.equal(golden.geo.zhaiGua, '艮');
    assert.equal(golden.bazhai.house.group, 'west');
    const p1 = golden.bazhai.residents[0];
    assert.equal(p1.name, '本人');
    assert.equal(p1.ming.gua, '坎');
    assert.equal(p1.ming.group, 'east');
    assert.equal(p1.matchesHouse, false);
    assert.equal(golden.bazhai.match.policy, 'mingOverHouse');
    assert.equal(golden.xuankong.meta.currentYun, 9);
    const kun = golden.xuankong.chart.palaces['坤'];
    assert.equal(kun.shan, 9, '向宮(坤)山星 9');
    assert.equal(kun.xiang, 9, '向宮(坤)向星 9');
    assert.equal(golden.annual.year.ganzhi, '丙午');
    assert.equal(golden.annual.taisui.dir, '南');
    assert.equal(golden.annual.sansha.dir, '北');
    assert.equal(golden.annual.sansha.mountains, '亥子丑');
    assert.deepEqual(golden.planShares.taiji, [5, 4]);
    assert.equal(golden.planShares.outlineArea, 80);
    assert.equal(golden.planShares.totalArea, 30);
    assert.equal(golden.summary.headline, '丑山未向');
    assert.equal(golden.summary.zhai, '艮宅');
    assert.equal(golden.summary.yun, 9);
    assert.equal(golden.summary.pattern, '雙星會向');
    assert.equal(golden.meta.computedAtCST, '2026-09-29 12:00');
    assert.deepEqual(golden.meta.warnings, []);
  });
  it('與直接呼叫底層模組的結果一致(門面只組裝,不重算)', () => {
    const direct = analyzeWealth({ facing: 210, now: NOW, plan: goldenPlan(), chartYun: 9, currentYun: 9, household: [{ id: 'p1', gua: '坎' }] });
    assert.equal(cand(golden, 'living:TR').score, direct.candidates.find((c) => c.id === 'living:TR').score);
    assert.deepEqual(golden.wealth.ranking, direct.ranking);
    const bz = analyzeBazhai({ household: [{ id: 'p1', gender: 'M', birth: { local: '1990-05-15T10:30', utcOffset: '+08:00', timeKnown: true } }], facing: { bazhai: 210, xuankong: 210 } });
    assert.deepEqual(golden.bazhai.house, bz.house);
    assert.deepEqual(golden.bazhai.residents[0].ming, bz.people[0].ming);
  });
  it('財位前幾名: 明財位排第一且標「較適合」;玄空檔的分數上限是 90,59.25/90 也是「較適合」', () => {
    assert.equal(golden.summary.wealthTop[0].id, 'living:TR');
    assert.equal(golden.summary.wealthTop[0].tier, 'suitable');
    assert.equal(golden.wealth.meta.scoreCap, 100);
    const x = analyzeHouse(goldenInput(), { wealthProfile: 'xuankong' });
    assert.equal(x.wealth.meta.scoreCap, 90);
    assert.equal(x.summary.wealthTop[0].tier, 'suitable');
    assert.equal(wealthTier(59.25, 90), 'suitable');
    assert.equal(wealthTier(59.25, 100), 'consider', '同樣的分數換個上限就是另一段: 分數不可跨設定比較');
  });
  it('黃金案例的文案: 不含精確分數、含坐向與命卦、免責聲明齊全', () => {
    const out = renderReport(golden);
    const all = displayTexts(out).join('\n');
    assert.ok(out.plainSummary.includes('丑山未向'));
    assert.ok(out.plainSummary.includes('艮宅'));
    assert.ok(out.plainSummary.includes('坎命'));
    assert.ok(!all.includes('66.88') && !all.includes('66.9') && !all.includes('59.25'), '不可顯示精確分數');
    const wealth = out.sections.find((s) => s.id === 'wealth');
    assert.equal(wealth.cards[0].headline, '客廳的右上角(明財位)');
    assert.ok(wealth.cards[0].badges.includes('較適合'));
    assert.deepEqual(out.sections.map((s) => s.id), [...SECTION_ORDER]);
    assert.equal(out.disclaimers.length, 4);
  });
});

function wealthTierOf(r, id) {
  const e = r.summary.wealthTop.find((x) => x.id === id);
  return e ? e.tier : null;
}

// ═══════════════════════════ B. 缺輸入降級 ═══════════════════════════

describe('缺輸入降級(不丟錯,原因寫成 Finding)', () => {
  it('沒有住戶: 不做命卦與本命財位', () => {
    const r = analyzeHouse(goldenInput({ residents: [], mainResidentId: null }));
    assert.equal(r.bazhai.residents.length, 0);
    assert.equal(r.wealth.layers.mingGua, null);
    assert.equal(r.wealth.meta.hasResidents, false);
    assert.ok(has(r, 'house.residents.none'));
    assert.deepEqual(r.summary.residents, []);
    assert.ok(r.meta.warnings.includes('noResidents'));
    const out = renderReport(r);
    assert.ok(out.plainSummary.includes('沒有住戶資料'));
  });
  it('residents 欄位整個沒給也行', () => {
    const input = goldenInput();
    delete input.residents;
    delete input.mainResidentId;
    const r = analyzeHouse(input);
    assert.ok(has(r, 'house.residents.none'));
  });
  it('沒有平面圖: 只給暗財位,標明沒有明財位', () => {
    const r = analyzeHouse(goldenInput({ plan: null }));
    assert.equal(r.planShares, null);
    assert.deepEqual(r.wealth.candidates, []);
    assert.ok(has(r, 'wealth.plan.missing'));
    assert.ok(r.summary.wealthTop.length > 0 && r.summary.wealthTop.every((e) => e.kind === 'dark'));
    assert.ok(r.summary.wealthTop.every((e) => e.label === '暗財位'));
    const out = renderReport(r);
    const wealth = out.sections.find((s) => s.id === 'wealth');
    assert.ok(wealth.cards.some((c) => c.headline.includes('暗財位')));
  });
  it('平面圖不合法: 當作沒有平面圖並說明原因,不洩漏欄位路徑', () => {
    const bad = goldenPlan();
    bad.outline = [[0, 0], [1, 1]];
    const r = analyzeHouse(goldenInput({ plan: bad }));
    assert.ok(has(r, 'house.plan.invalid'));
    assert.ok(has(r, 'wealth.plan.missing'));
    assert.equal(r.planShares, null);
    const f = r.findings.find((x) => x.id === 'house.plan.invalid');
    assert.ok(!/outline|polygon|\[\d\]/.test(f.body), f.body);
    assert.ok(f.body.includes('形狀'));
  });
  it('平面圖方位未知: 只做形狀分析', () => {
    const plan = goldenPlan({ planUp: null });
    const r = analyzeHouse(goldenInput({ plan }));
    assert.ok(has(r, 'wealth.plan.up_unknown'));
    assert.equal(r.planShares.shares, null);
    assert.ok(r.wealth.candidates.every((c) => c.score === null));
    assert.ok(r.summary.wealthTop.every((e) => e.kind === 'dark'));
  });
  it('平面圖檢查提醒(開口重疊)進 Finding,文字不含路徑', () => {
    const openings = [
      { id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1.0, width: 0.9 },
      { id: 'w1', kind: 'window', roomId: 'living', wall: 'bottom', pos: 1.2, width: 0.9 },
    ];
    const r = analyzeHouse(goldenInput({ plan: goldenPlan({ openings }) }));
    const f = r.findings.find((x) => x.id === 'house.plan.warning.openingsOverlap');
    assert.ok(f);
    assert.ok(!/openings\[/.test(f.body));
  });
  it('沒有建築資料或沒有建成年份: 略過玄空盤與玄空財位', () => {
    for (const building of [null, { type: 'apartment', builtYear: null }]) {
      const r = analyzeHouse(goldenInput({ building }));
      assert.equal(r.xuankong, null);
      assert.equal(r.summary.yun, null);
      assert.equal(r.summary.pattern, null);
      assert.ok(has(r, 'house.building.year_missing'));
      assert.ok(has(r, 'wealth.xuankong.missing'));
      assert.ok(r.bazhai.house.name, '八宅照算');
      assert.ok(r.wealth.candidates.length > 0, '沒有玄空仍有明財位');
      const out = renderReport(r);
      assert.equal(out.sections.find((s) => s.id === 'xuankong').cards.length, 1, '只剩一張說明卡');
    }
  });
  it('磁偏角缺: 真北設定退回磁北並警告,結果與磁北設定相同', () => {
    const input = goldenInput();
    input.facing.declination = null;
    const t = analyzeHouse(input, { northMode: 'true' });
    const m = analyzeHouse(input, { northMode: 'magnetic' });
    assert.ok(has(t, 'house.north.declination_missing'));
    assert.equal(t.meta.northMode, 'magnetic');
    assert.equal(t.meta.ruleset.northMode, 'magnetic');
    assert.ok(t.meta.warnings.includes('declinationMissing'));
    assert.equal(t.geo.label, m.geo.label);
    assert.equal(t.geo.north.compare, null);
    assert.equal(cand(t, 'living:TR').score, cand(m, 'living:TR').score);
  });
  it('住戶資料不完整: 略過該位並列出原因,其他住戶照算', () => {
    const residents = [
      { id: 'p1', name: '本人', gender: 'M', birth: '1990-05-15 10:30' },
      { id: 'p2', name: '小孩', gender: 'F', birth: '2020-13-40' },
      { id: 'p3', name: '長輩', gender: 'X', birth: '1950-03-03' },
      { id: 'p4', name: '未填', gender: 'M' },
      { id: 'p5', name: '空白' },
    ];
    const r = analyzeHouse(goldenInput({ residents }));
    assert.deepEqual(r.bazhai.residents.map((x) => x.id), ['p1']);
    assert.deepEqual(r.bazhai.skipped.map((x) => x.id), ['p2', 'p3', 'p4', 'p5']);
    assert.deepEqual(r.findings.filter((f) => f.id.startsWith('house.resident.incomplete.')).map((f) => f.id), ['p2', 'p3', 'p4', 'p5'].map((id) => `house.resident.incomplete.${id}`), '每位資料不完整的住戶各一則');
    assert.ok(r.meta.warnings.includes('residentIncomplete'));
    assert.equal(r.bazhai.skipped[0].missing.join(), '出生日期');
    assert.equal(r.bazhai.skipped[1].missing.join(), '性別');
    assert.equal(r.bazhai.skipped[2].missing.join(), '出生日期');
    assert.equal(r.bazhai.skipped[3].missing.join(), '性別,出生日期');
  });
  it('主要收入者 id 不存在: 當作沒指定', () => {
    const r = analyzeHouse(goldenInput({ mainResidentId: 'nobody' }));
    assert.ok(has(r, 'house.residents.main_unknown'));
    assert.equal(r.bazhai.residents[0].role, null);
  });
  it('農曆春節年界沒有農曆資料: 降級為立春並說明;提供農曆函式時照設定算', () => {
    const input = goldenInput({ residents: [{ id: 'p1', name: '本人', gender: 'M', birth: '1990-02-01 12:00' }] });
    const fall = analyzeHouse(input, { yearBoundary: 'lunar_new_year' });
    assert.ok(has(fall, 'house.setting.lunar_unavailable'));
    assert.equal(fall.meta.ruleset.yearBoundary, 'lichun_exact');
    assert.equal(fall.bazhai.residents[0].ming.effectiveYear, 1989, '2/1 在立春(2/4)之前');
    const lunar = analyzeHouse(input, { yearBoundary: 'lunar_new_year' }, { lunarNewYearOf: (y) => `${y}-02-01` });
    assert.ok(!has(lunar, 'house.setting.lunar_unavailable'));
    assert.equal(lunar.meta.ruleset.yearBoundary, 'lunar_new_year');
    assert.equal(lunar.bazhai.residents[0].ming.effectiveYear, 1990, '春節 2/1 當天換年');
  });
  it('整修換運但沒有完工年份: 降級為建成年份並說明', () => {
    const building = { type: 'apartment', builtYear: 2010, renovation: 'full' };
    const r = analyzeHouse(goldenInput({ building }));
    assert.ok(has(r, 'house.building.renovation_date_missing'));
    assert.equal(r.xuankong.meta.chartYun, 8, '2010 建成屬八運');
    const ok = analyzeHouse(goldenInput({ building: { ...building, renovatedYear: 2025 } }));
    assert.ok(!has(ok, 'house.building.renovation_date_missing'));
    assert.equal(ok.xuankong.meta.chartYun, 9, '整戶翻新以完工年份的運起盤');
    assert.equal(ok.meta.ruleset.renovation, 'full');
  });
  it('以遷入年份起盤但沒有遷入年份: 降級為建成年份;有則用遷入運', () => {
    const building = { type: 'apartment', builtYear: 2010, renovation: 'none' };
    const miss = analyzeHouse(goldenInput({ building }), { yunBasis: 'moveIn' });
    assert.ok(has(miss, 'house.building.move_in_missing'));
    assert.equal(miss.xuankong.meta.chartYun, 8);
    const ok = analyzeHouse(goldenInput({ building: { ...building, moveInYear: 2025 } }), { yunBasis: 'moveIn' });
    assert.equal(ok.xuankong.meta.chartYun, 9);
    assert.equal(ok.xuankong.meta.yun.basis, 'moveIn');
  });
  it('建成於交運年: 給提醒,以該年年中(交運後)起盤', () => {
    const r24 = analyzeHouse(goldenInput({ building: { type: 'apartment', builtYear: 2024 } }));
    assert.ok(has(r24, 'house.building.yun_boundary_year'));
    assert.equal(r24.xuankong.meta.chartYun, 9);
    const r23 = analyzeHouse(goldenInput({ building: { type: 'apartment', builtYear: 2023 } }));
    assert.ok(!has(r23, 'house.building.yun_boundary_year'));
    assert.equal(r23.xuankong.meta.chartYun, 8);
    assert.equal(r23.xuankong.meta.warnings.includes('chartYunDiffersFromCurrent'), true);
    assert.ok(has(r23, 'xk.yun.differs'));
  });
  it('台灣 1938-1945 出生: 住戶沒給時區時由 tzdata 換成 +09:00,立春前後因此不同', () => {
    const born = (utcOffsetMinutes) => ({ id: 'p1', name: '老人', gender: 'M', birth: '1940-02-05 07:30', utcOffsetMinutes });
    const auto = analyzeHouse(goldenInput({ residents: [born(null)] }));
    const plus8 = analyzeHouse(goldenInput({ residents: [born(480)] }));
    // 1940 立春 07:07:10 CST。當時鐘 07:30 若是 +09:00 則是 06:30 CST,還在立春前(1939 年)。
    assert.equal(auto.bazhai.residents[0].ming.effectiveYear, 1939);
    assert.equal(plus8.bazhai.residents[0].ming.effectiveYear, 1940);
  });
  it('立春前後一毫秒換年', () => {
    const l = lichun(2026);
    const before = analyzeHouse(goldenInput({ nowMs: l - 1 }));
    const after = analyzeHouse(goldenInput({ nowMs: l }));
    assert.equal(before.annual.year.fengshuiYear, 2025);
    assert.equal(after.annual.year.fengshuiYear, 2026);
    assert.equal(before.summary.year.ganzhi, '乙巳');
  });
  it('立春臨界的 Finding 進結果(出生時刻與交節相差 1 分鐘內)', () => {
    const r = analyzeHouse(goldenInput({ residents: [{ id: 'p1', name: '本人', gender: 'M', birth: '2026-02-04 04:02' }] }));
    assert.ok(has(r, 'bz.ming.near_lichun'));
    assert.ok(r.bazhai.residents[0].ming.flags.alternatives.length === 2);
    const near = analyzeHouse(goldenInput({ nowMs: lichun(2026) + 30000 }));
    assert.ok(has(near, 'annual.year.near_lichun'));
  });
  it('立春日只知日期: 兩種命卦並列的提醒', () => {
    const r = analyzeHouse(goldenInput({ residents: [{ id: 'p1', name: '本人', gender: 'M', birth: '2026-02-04' }] }));
    assert.ok(has(r, 'bz.ming.lichun_day'));
    const f = r.findings.find((x) => x.id === 'bz.ming.lichun_day');
    assert.equal(f.subject, 'p1');
    const out = renderReport(r);
    const ming = out.sections.find((s) => s.id === 'ming');
    assert.ok(ming.cards.some((c) => c.headline.startsWith('本人: ')), 'subject 換成住戶名字');
  });
  it('兩位住戶同時踩到同一條住戶層級警告: 兩則都要留,不可被 id 去重吃掉', () => {
    // 立春臨界的 Finding 帶 subject,去重鍵必須含 subject,否則第二個人整張卡片會消失。
    const r = analyzeHouse(goldenInput({
      residents: [
        { id: 'p1', name: '甲', gender: 'M', birth: '2026-02-04 04:02' },
        { id: 'p2', name: '乙', gender: 'F', birth: '2026-02-04 04:03' },
      ],
    }));
    const hits = r.findings.filter((f) => f.id === 'bz.ming.near_lichun');
    assert.equal(hits.length, 2, '兩位住戶各一則');
    assert.deepEqual(hits.map((f) => f.subject).sort(), ['p1', 'p2']);
    const out = renderReport(r);
    const ming = out.sections.find((s) => s.id === 'ming');
    assert.equal(ming.cards.filter((c) => /立春/.test(c.headline)).length, 2, '畫面也要兩張卡');
  });
  it('同一則 Finding 由多個模組重複產生時仍只留一則(沒有 subject 的鍵不變)', () => {
    const r = analyzeHouse(goldenInput());
    const ids = r.findings.map((f) => `${f.id}::${f.subject}`);
    assert.equal(new Set(ids).size, ids.length, 'findings 的 id + subject 必須唯一');
  });
  it('太極點落在外框之外、房間超出外框等平面圖警告進 Finding', () => {
    const plan = goldenPlan({ rooms: [{ id: 'living', type: 'living', polygon: [[0, 0], [12, 0], [12, 5], [0, 5]] }] });
    const r = analyzeHouse(goldenInput({ plan: { ...plan, openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1.0, width: 0.9 }] } }));
    assert.ok(has(r, 'house.plan.warning.roomOutsideOutline'));
  });
  it('wealthOptions 原樣轉給財位分析(環境旗標)', () => {
    const r = analyzeHouse(goldenInput({ wealthOptions: { flags: { 'living:TR': { beam: true } } } }));
    assert.equal(cand(r, 'living:TR').flags.beam, true);
    assert.ok(cand(r, 'living:TR').score < 66.88 - 1);
    throwsCode(() => analyzeHouse(goldenInput({ wealthOptions: { bogus: 1 } })), 'INVALID_INPUT');
  });
});

// ═══════════════════════════ C. 輸入不修改、序列化、決定性 ═══════════════════════════

describe('輸入不修改、JSON 可序列化、決定性', () => {
  it('深凍結的輸入與設定照常分析與渲染(任何寫入都會丟 TypeError)', () => {
    const input = deepFreeze(goldenInput({ wealthOptions: { flags: { 'living:TR': { beam: true } } } }));
    const settings = deepFreeze({ wealthProfile: 'xuankong', showMinorityTechniques: true, extraShensha: true });
    const before = JSON.stringify(input);
    const r = analyzeHouse(input, settings);
    renderReport(r);
    assert.equal(JSON.stringify(input), before);
    assert.equal(JSON.stringify(settings), JSON.stringify({ wealthProfile: 'xuankong', showMinorityTechniques: true, extraShensha: true }));
  });
  it('渲染不修改 report', () => {
    const r = deepFreeze(analyzeHouse(goldenInput()));
    renderReport(r);
    renderReport(r, { sections: ['wealth'], glossary: false });
  });
  it('report 與文案 JSON 往返後完全相同,沒有 undefined、NaN、-0', () => {
    const r = analyzeHouse(goldenInput());
    assert.deepEqual(jsonProblems(r), []);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    const out = renderReport(r);
    assert.deepEqual(jsonProblems(out), []);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  });
  it('同輸入兩次結果完全相同(決定性),report 不含對輸入的參照', () => {
    const input = goldenInput();
    const a = analyzeHouse(input);
    const b = analyzeHouse(clone(input));
    assert.deepEqual(a, b);
    assert.deepEqual(renderReport(a), renderReport(b));
    input.facing.bearing = 0;
    assert.equal(a.meta.inputEcho.facing.bearing, 210, 'inputEcho 是複本');
  });
  it('meta.ruleset 是實際使用的完整設定', () => {
    const r = analyzeHouse(goldenInput(), { showLianshu: true, measureUncertainty: 4 });
    assert.equal(r.meta.ruleset.showLianshu, true);
    assert.equal(r.meta.ruleset.measureUncertainty, 4);
    assert.equal(r.meta.ruleset.northMode, 'magnetic');
    assert.deepEqual(Object.keys(r.meta.ruleset).sort(), Object.keys(analyzeHouse(goldenInput()).meta.ruleset).sort());
  });
  it('facing.uncertainty 蓋過設定的 measureUncertainty', () => {
    const input = goldenInput();
    input.facing.uncertainty = 12;
    const r = analyzeHouse(input);
    assert.equal(r.meta.ruleset.measureUncertainty, 12);
    assert.equal(r.geo.meta.ruleset.measureUncertainty, 12);
  });
});

// ═══════════════════════════ D. 磁北與真北並列 ═══════════════════════════

describe('磁北與真北並列(規格 2.1.3 第 10 點)', () => {
  const at = (bearing, D = -5.06) => {
    const i = goldenInput();
    i.facing.bearing = bearing;
    i.facing.declination = D;
    return i;
  };
  it('兩種讀法落在不同山: 並列並給 Finding', () => {
    // 台北 D=-5.06: 羅盤讀 188 度是丁(磁),真方位 182.94 度是午。
    const r = analyzeHouse(at(188));
    const c = r.geo.north.compare;
    assert.equal(c.facing.magneticMountain, '丁');
    assert.equal(c.facing.trueMountain, '午');
    assert.equal(c.differs.mountain, true);
    assert.equal(c.differs.gua, false);
    assert.equal(c.sitMountain.magnetic, '癸');
    assert.equal(c.sitMountain.true, '子');
    const f = r.findings.find((x) => x.id === 'house.north.differs');
    assert.equal(f.level, 'note');
    assert.equal(r.geo.facingMountain, '丁', '磁北設定用磁北讀法');
  });
  it('兩種讀法落在不同卦: 宅卦不同,Finding 為 caution', () => {
    // 讀 205 度: 磁 = 未(坤卦),真 = 199.94 度 = 丁(離卦);坐山對應艮宅 vs 坎宅。
    const r = analyzeHouse(at(205));
    const c = r.geo.north.compare;
    assert.equal(c.differs.gua, true);
    assert.deepEqual(c.zhaiGua, { magnetic: '艮', true: '坎' });
    assert.equal(r.findings.find((x) => x.id === 'house.north.differs').level, 'caution');
    const out = renderReport(r);
    const card = out.sections[0].cards.find((x) => x.id === 'card.orientation.north');
    assert.ok(card.body.includes('丑山未向') === false || card.body.includes('並列'), '文案並列兩種讀法');
    assert.ok(card.body.includes('用磁北讀是') && card.body.includes('用真北讀是'));
  });
  it('真北設定: 用真方位分析,讀數換算正確(真 = 磁 + D)', () => {
    const r = analyzeHouse(at(205), { northMode: 'true' });
    assert.ok(circDiff(r.geo.north.used.facing, 205 - 5.06) <= 1e-9);
    assert.equal(r.geo.facingMountain, '丁');
    assert.equal(r.bazhai.house.gua, '坎');
    assert.equal(r.meta.northMode, 'true');
    assert.equal(r.geo.north.mode, 'true');
    // 磁北與真北的並列資料與設定無關
    assert.deepEqual(r.geo.north.compare, analyzeHouse(at(205)).geo.north.compare);
  });
  it('兩種讀法相同: 不產生 Finding', () => {
    const r = analyzeHouse(at(210));
    assert.equal(r.geo.north.compare.differs.mountain, false);
    assert.ok(!has(r, 'house.north.differs'));
  });
  it('沒給磁偏角(磁北設定): 沒有並列,也不警告', () => {
    const i = goldenInput();
    i.facing.declination = null;
    const r = analyzeHouse(i);
    assert.equal(r.geo.north.compare, null);
    assert.ok(!has(r, 'house.north.declination_missing'));
  });
  it('讀數 359 與 1 跨 0 度: 圓周處理,不出負數方位', () => {
    for (const b of [359, 1, -1, 361]) {
      const r = analyzeHouse(at(b));
      assert.ok(r.geo.bearing >= 0 && r.geo.bearing < 360);
      assert.ok(r.geo.north.used.facing >= 0 && r.geo.north.used.facing < 360);
    }
  });
});

// ═══════════════════════════ E. 多位住戶與向的取法 ═══════════════════════════

describe('多位住戶', () => {
  const two = [
    { id: 'p1', name: '先生', gender: 'M', birth: '1990-05-15 10:30' },
    { id: 'p2', name: '太太', gender: 'F', birth: '1990-08-08 12:00' },
  ];
  it('東四命與西四命並存: 命卦分別計算、並列顯示,以主要收入者為主', () => {
    const r = analyzeHouse(goldenInput({ residents: two, mainResidentId: 'p1' }));
    assert.deepEqual(r.bazhai.residents.map((x) => x.ming.gua), ['坎', '艮']);
    assert.deepEqual(r.bazhai.residents.map((x) => x.matchesHouse), [false, true]);
    assert.ok(has(r, 'bz.household.mixed'));
    assert.equal(r.bazhai.match.mixed, true);
    assert.equal(r.bazhai.match.anchorId, 'p1');
    assert.equal(r.bazhai.residents[0].role, 'breadwinner');
    assert.equal(r.bazhai.residents[1].role, null);
    assert.equal(r.wealth.layers.mingGua.byPerson.length, 2);
    assert.deepEqual(r.summary.residents.map((x) => x.name), ['先生', '太太']);
    const other = analyzeHouse(goldenInput({ residents: two, mainResidentId: 'p2' }));
    assert.equal(other.bazhai.match.anchorId, 'p2');
    const out = renderReport(r);
    const ming = out.sections.find((s) => s.id === 'ming');
    assert.deepEqual(ming.cards.slice(0, 3).map((c) => c.id), ['card.ming.p1', 'card.ming.p2', 'card.ming.household']);
    assert.ok(ming.cards[0].headline.startsWith('先生: 坎命'));
    assert.ok(ming.cards[1].badges.includes('命宅相配'));
  });
  it('multiOccupantPolicy=each: 每個候選逐人算分', () => {
    const r = analyzeHouse(goldenInput({ residents: two, mainResidentId: 'p1' }), { multiOccupantPolicy: 'each' });
    const ming = cand(r, 'living:TR');
    assert.equal(ming.byPerson.length, 2);
    assert.deepEqual(ming.byPerson.map((b) => b.id), ['p1', 'p2']);
  });
  it('holderOnly: 主要收入者當戶主', () => {
    const r = analyzeHouse(goldenInput({ residents: two, mainResidentId: 'p2' }), { coupleBasis: 'holderOnly' });
    assert.equal(r.bazhai.residents[1].role, 'holder');
    assert.deepEqual(r.bazhai.match.consideredIds, ['p2']);
  });
  it('住戶沒給 id 與名字: 自動編號,顯示用「住戶N」而不是內部 id', () => {
    const r = analyzeHouse(goldenInput({ residents: [{ gender: 'M', birth: '1990-05-15 10:30' }, { gender: 'F', birth: '1990-08-08' }], mainResidentId: null }));
    assert.deepEqual(r.bazhai.residents.map((x) => x.id), ['p1', 'p2']);
    assert.deepEqual(r.bazhai.residents.map((x) => x.name), ['住戶1', '住戶2']);
    const out = renderReport(r);
    const all = displayTexts(out).join('\n');
    assert.ok(all.includes('住戶1'));
    assert.ok(!/\bp[12]\b/.test(all));
  });
});

describe('向的取法與大門朝向', () => {
  it('大門與宅向差超過 45 度: 提示由使用者確認;八宅用大門、玄空用宅向', () => {
    const input = goldenInput();
    input.facing.doorBearing = 300;
    const r = analyzeHouse(input);
    assert.ok(has(r, 'house.facing.conflict'));
    assert.equal(r.geo.facingPick.conflict, true);
    assert.equal(r.geo.facingMountain, '未', '玄空用宅向');
    assert.equal(r.bazhai.house.facingBearing, 300, '八宅用大門朝向');
    assert.equal(r.bazhai.house.gua, '巽', '300 度朝向的坐是 120 度(巽山)');
    assert.equal(r.geo.door.mountain, '戌');
  });
  it('大門與宅向相近: 沒有衝突提示', () => {
    const input = goldenInput();
    input.facing.doorBearing = 225;
    const r = analyzeHouse(input);
    assert.ok(!has(r, 'house.facing.conflict'));
    assert.equal(r.geo.facingPick.conflict, false);
  });
  it('facingPolicy=door: 玄空也改用大門朝向', () => {
    const input = goldenInput();
    input.facing.doorBearing = 300;
    const r = analyzeHouse(input, { facingPolicy: 'door' });
    assert.equal(r.geo.basis, 'door');
    assert.equal(r.geo.facingMountain, '戌');
    assert.equal(r.geo.label, sitFromFacing(300).sitMountain + '山戌向');
  });
  it('bazhaiFacingBasis=house: 八宅沿用宅向', () => {
    const input = goldenInput();
    input.facing.doorBearing = 300;
    const r = analyzeHouse(input, { bazhaiFacingBasis: 'house' });
    assert.equal(r.bazhai.house.facingBearing, 210);
  });
  it('兼向與空亡: 標籤與 Finding', () => {
    const at = (b) => {
      const i = goldenInput();
      i.facing.bearing = b;
      i.facing.declination = null;
      return analyzeHouse(i);
    };
    const jian = at(216); // 未山 +6 度兼申(坤與申同卦,陰陽差錯)
    assert.equal(jian.geo.zone, 'jian');
    assert.match(jian.geo.label, /^丑山未向兼/);
    assert.ok(jian.geo.lean);
    const void_ = at(217.4); // 超過兼向限度
    assert.equal(void_.geo.level === 'void' || void_.geo.kongwangKind !== null, true);
    if (void_.geo.kongwangKind) assert.ok(has(void_, 'house.geo.kongwang'));
    const edge = at(202.6); // 距山界 0.1 度
    assert.ok(edge.geo.onLine || edge.geo.retest);
    assert.ok(has(edge, 'house.geo.kongwang') || has(edge, 'house.geo.retest'));
    const deg = analyzeHouse(Object.assign(goldenInput(), { facing: { bearing: 202.6, doorBearing: null, declination: null, uncertainty: null } }), { kongwangLabelScheme: 'degree' });
    assert.equal(deg.meta.ruleset.kongwangLabelScheme, 'degree');
  });
  it('離山界近於不確定度: 建議重量', () => {
    const i = goldenInput();
    i.facing.bearing = 216.0;
    i.facing.declination = null;
    i.facing.uncertainty = 3;
    const r = analyzeHouse(i);
    assert.equal(r.geo.retest, true);
    assert.ok(has(r, 'house.geo.retest') || has(r, 'house.geo.kongwang'));
  });
});

// ═══════════════════════════ F. 輸入驗證 ═══════════════════════════

describe('輸入驗證: 只有型別根本錯誤才丟錯', () => {
  it('錯誤碼', () => {
    throwsCode(() => analyzeHouse(null), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse([]), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ nowMs: '2026' })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ nowMs: NaN })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ facing: null })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: NaN } })), 'INVALID_BEARING');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: Infinity } })), 'INVALID_BEARING');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: '210' } })), 'INVALID_BEARING');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: 210, doorBearing: 'x' } })), 'INVALID_BEARING');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: 210, declination: 'x' } })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: 210, uncertainty: -1 } })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ building: 'house' })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ building: { type: 'castle' } })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ building: { type: 'house', builtYear: 2020.5 } })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ building: { type: 'house', renovation: 'gutted' } })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ residents: 'x' })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ residents: [1] })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ residents: [{ id: 'a', gender: 'M', birth: 19900101 }] })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ residents: [{ id: 'a' }, { id: 'a' }] })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ mainResidentId: 5 })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ plan: 'plan' })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ utcOffsetMinutes: 1.5 })), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput(), { nope: 1 }), 'INVALID_SETTING');
    throwsCode(() => analyzeHouse(goldenInput(), { northMode: 'south' }), 'INVALID_SETTING');
    throwsCode(() => analyzeHouse(goldenInput(), 'x'), 'INVALID_SETTING');
    throwsCode(() => analyzeHouse(goldenInput(), {}, { lunarNewYearOf: 5 }), 'INVALID_INPUT');
    throwsCode(() => analyzeHouse(goldenInput({ facing: { bearing: 210, declination: 500 } }), { northMode: 'true' }), 'INVALID_DECLINATION');
  });
  it('錯誤碼開頭是「大寫底線碼: 」,不是泛用 Error', () => {
    try {
      analyzeHouse({});
      assert.fail('應丟錯');
    } catch (e) {
      assert.match(e.message, /^[A-Z_]+: /);
    }
  });
});

// ═══════════════════════════ G. wealthTier ═══════════════════════════

describe('分數轉三段標籤', () => {
  it('門檻 0.6 與 0.35(含端點)', () => {
    assert.equal(WEALTH_TIERS.suitable, 0.6);
    assert.equal(WEALTH_TIERS.consider, 0.35);
    assert.equal(wealthTier(60, 100), 'suitable');
    assert.equal(wealthTier(59.9, 100), 'consider');
    assert.equal(wealthTier(35, 100), 'consider');
    assert.equal(wealthTier(34.9, 100), 'notAdvised');
    assert.equal(wealthTier(51, 85), 'suitable', '沒有住戶時上限 85,以比值判斷');
  });
  it('無分數、零、負、上限無效: 不建議', () => {
    for (const [s, c] of [[null, 100], [0, 100], [-5, 100], [50, 0], [NaN, 100], [50, NaN]]) assert.equal(wealthTier(s, c), 'notAdvised');
  });
  it('規格 2.6.7 的例子: 66.88 較適合、40.00(西南角)可以考慮、33.44(有窗)不建議', () => {
    assert.equal(wealthTier(66.88, 100), 'suitable');
    assert.equal(wealthTier(40.0, 100), 'consider');
    assert.equal(wealthTier(33.44, 100), 'notAdvised');
  });
});

// ═══════════════════════════ H. 隨機輸入的屬性測試 ═══════════════════════════

const N_RANDOM = 160;
function sweep() {
  const rng = mulberry32(20260929);
  const runs = [];
  for (let i = 0; i < N_RANDOM; i += 1) {
    const h = randomHouse(rng);
    const report = analyzeHouse(h.input, h.settings, h.opts);
    runs.push({ ...h, report, rendered: renderReport(report) });
  }
  return runs;
}
const RUNS = sweep();

describe('隨機輸入(固定種子,合法但可能不完整): analyzeHouse', () => {
  it(`${N_RANDOM} 組輸入都不丟錯、JSON 安全、有分段`, () => {
    assert.equal(RUNS.length, N_RANDOM);
    for (const { report, rendered } of RUNS) {
      assert.deepEqual(jsonProblems(report), []);
      assert.deepEqual(jsonProblems(rendered), []);
      assert.equal(report.meta.schema, HOUSE_SCHEMA);
    }
  });
  it('坐 = 向 + 180、坐山是向山的對山、宅卦 = 坐山的卦(對 8 宅使用大門朝向時另計)', () => {
    for (const { report } of RUNS) {
      const g = report.geo;
      assert.ok(circDiff(g.sitBearing, g.bearing + 180) <= 1e-9);
      assert.equal(g.sitMountain, g.opposite);
      assert.equal(g.facingMountain, g.mountain);
      assert.match(g.label, new RegExp(`^${g.sitMountain}山${g.facingMountain}向`));
    }
  });
  it('每則 Finding 形狀齊全,id 不重複', () => {
    for (const { report } of RUNS) {
      const seen = new Set();
      for (const f of report.findings) {
        assert.ok(!seen.has(f.id), `id 重複: ${f.id}`);
        seen.add(f.id);
        assert.ok(['info', 'note', 'caution'].includes(f.level), f.id);
        assert.ok(['high', 'medium', 'low'].includes(f.confidence), f.id);
        assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag), f.id);
        assert.equal(typeof f.title, 'string');
        assert.equal(typeof f.body, 'string');
        assert.ok(f.title.length > 0 && f.body.length > 0);
        assert.ok(f.subject === null || typeof f.subject === 'string', f.id);
      }
      for (const c of report.summary.cautions) assert.ok(seen.has(c.id));
    }
  });
  it('財位前幾名: 不超過 3 個(另加明財位)、標籤與分數一致', () => {
    for (const { report } of RUNS) {
      const top = report.summary.wealthTop;
      assert.ok(top.length <= 4);
      const cap = report.wealth.meta.scoreCap;
      for (const e of top) {
        if (e.kind === 'dark') continue;
        const c = report.wealth.candidates.find((x) => x.id === e.id);
        const blocked = c.excluded || c.status === 'blocked_opening' || c.status === 'blocked_walkway';
        assert.equal(e.tier, blocked ? 'notAdvised' : wealthTier(c.score, cap));
      }
      // 非明財位的入選者一定不是「不建議」
      for (const e of top) if (e.kind === 'wallCorner') assert.notEqual(e.tier, 'notAdvised');
    }
  });
  it('有平面圖且方位已知時,明財位一定列在前幾名裡(規格 2.6.7: 永遠顯示明財位)', () => {
    let checked = 0;
    for (const { report } of RUNS) {
      const ming = report.wealth.candidates.filter((c) => c.isMingCai && c.score !== null);
      if (ming.length === 0) continue;
      checked += 1;
      assert.ok(report.summary.wealthTop.some((e) => e.kind === 'ming'));
    }
    assert.ok(checked > 10, `只檢查了 ${checked} 組`);
  });
  it('分析涵蓋多樣: 隨機輸入確實走到降級分支', () => {
    const all = new Set(RUNS.flatMap((x) => x.report.findings.map((f) => f.id.split('.').slice(0, 2).join('.'))));
    for (const k of ['house.residents', 'house.building', 'house.north', 'house.geo', 'house.resident', 'wealth.plan', 'xk.pattern', 'bz.household']) {
      assert.ok(all.has(k), `隨機輸入沒走到 ${k}`);
    }
  });
});

// ═══════════════════════════ I. copy: 文案 ═══════════════════════════

const BANNED = ['大凶', '絕嗣', '克妻', '敗財', '一定會', '必定'];
/** 「保證」只有否定句(不保證)可以出現。 */
const AFFIRMED_GUARANTEE = /(?<!不)保證/;
const LEAK_PATTERNS = [
  [/\b(?:geo|bz|xk|annual|wealth|house|card)\.[A-Za-z_]/, '英文 Finding id'],
  [/[A-Za-z]+_[A-Za-z_]+/, '底線代碼(如 jian_caution)'],
  [/\b(?:undefined|null|NaN|Infinity)\b|\[object/, '程式值洩漏'],
  [/\b[a-z]{1,2}\d{1,2}\b/, '內部編號(如 d1、p1)'],
  [/(?:openings|rooms|outline|polygon)\[|\$\{/, '欄位路徑'],
  [/\b[A-Z]{2,}-\d{3,}\b/, '來源編號'],
  [/(?:規格|DOMAIN_SPEC)/, '規格條號'],
  [/\b(?:mingcai|xuankong|penalty|reward|centroid|lichun_exact)\b/, '設定代碼'],
];

describe('scrubText: 清掉內部痕跡', () => {
  it('來源編號、欄位代號、規格條號', () => {
    assert.equal(scrubText('有水無山偏旺財(SOHU-912417602)'), '有水無山偏旺財');
    assert.equal(scrubText('大門(d1)與對面牆的開口(w2)沿牆重疊'), '大門與對面牆的開口沿牆重疊');
    assert.equal(scrubText('建議請老師確認(規格 U-10)'), '建議請老師確認');
    assert.equal(scrubText('意見未定,建議確認(規格 U-10)。'), '意見未定,建議確認。');
  });
  it('巢狀括號的「依據」整段移除', () => {
    const t = '可以優先考慮: 乾宮。這是依五行推得的說法,沒有直接的古籍依據(依據: 文昌位只採一四(high)與三九(low,帶但書);避開三七、六七)。';
    assert.equal(scrubText(t), '可以優先考慮: 乾宮。這是依五行推得的說法,沒有直接的古籍依據。');
  });
  it('乘數與分數上限改成排序說法,不留數字', () => {
    const a = scrubText('這裡把這個位置的分數乘 0.7(設計值),補救後可重新評估。');
    assert.ok(!/0\.7/.test(a) && a.includes('排序往後調'), a);
    const b = scrubText('所以不扣分(這裡乘 1.05,設計值)。');
    assert.ok(!/1\.05/.test(b), b);
    const c = scrubText('沒有住戶資料時命卦分量記為 0,分數上限是 85。');
    assert.ok(!/85/.test(c), c);
  });
  it('恐嚇字眼改溫和說法', () => {
    const t = scrubText('此格局大凶,主絕嗣、克妻、敗財,保證應驗');
    for (const w of BANNED) assert.ok(!t.includes(w), `${w} 仍在: ${t}`);
    assert.ok(!AFFIRMED_GUARANTEE.test(t), t);
    assert.equal(scrubText('不保證任何結果'), '不保證任何結果', '否定句的「不保證」不能被改掉');
  });
  it('非字串回空字串;正常文字不動', () => {
    assert.equal(scrubText(undefined), '');
    assert.equal(scrubText(null), '');
    const ok = '傳統上認為人丁星在後方、財星在前方。後方有靠、前方開闊或見水,較適合。';
    assert.equal(scrubText(ok), ok);
  });
});

describe('applyTone: 語氣依 tag 分級(規格 5.1 第 4 點)', () => {
  it('source: 補「傳統上」;已有說法字樣不重複', () => {
    assert.ok(applyTone('source', '這一宮宜靜').startsWith('傳統上的說法:'));
    assert.equal(applyTone('source', '傳統上認為這一宮宜靜。'), '傳統上認為這一宮宜靜。');
  });
  it('inference: 補「沒有直接的古籍依據」', () => {
    assert.ok(applyTone('inference', '臥室可放乾宮。').includes('沒有直接的古籍依據'));
    const done = '這是依位置推得的說法,沒有直接的古籍依據。';
    assert.equal(applyTone('inference', done), done);
  });
  it('minority: 少數流派主張、預設不採用', () => {
    const t = applyTone('minority', '五鬼運財可以化解。');
    assert.ok(t.startsWith('少數流派主張:') && t.endsWith('本 App 預設不採用。'));
    assert.equal(applyTone('minority', '少數流派主張,本 App 預設不採用。'), '少數流派主張,本 App 預設不採用。');
  });
  it('design: 補本 App 的整理方式', () => {
    assert.ok(applyTone('design', '排序如下。').includes('本 App 的整理方式'));
    assert.equal(applyTone('design', '這是本 App 的排序方式。'), '這是本 App 的排序方式。');
  });
});

describe('術語括號解釋(規格 5.2)', () => {
  it('規格 5.2 表的每個術語都在 GLOSSARY 的觸發詞裡', () => {
    const start = SPEC_TEXT.indexOf('### 5.2 術語括號解釋');
    const end = SPEC_TEXT.indexOf('### 5.3', start);
    const rows = SPEC_TEXT.slice(start, end).split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| 術語') && !l.startsWith('|---'));
    assert.ok(rows.length >= 20, `規格 5.2 只解析到 ${rows.length} 列`);
    const triggers = new Set(GLOSSARY.flatMap((g) => g.terms));
    for (const row of rows) {
      const cell = row.split('|')[1].trim().replace(/\(.*\)/, '');
      for (const term of cell.split(/\s*[/、]\s*/).map((x) => x.trim()).filter(Boolean)) {
        assert.ok(triggers.has(term), `規格 5.2 的術語「${term}」不在 GLOSSARY`);
      }
    }
  });
  it('解釋文字不含其他組的術語(否則第一次出現的順序會被解釋本身打亂)', () => {
    for (const g of GLOSSARY) {
      for (const other of GLOSSARY) {
        if (other === g) continue;
        for (const t of other.terms) assert.ok(!g.explain.includes(t), `「${g.key}」的解釋含有「${t}」`);
      }
    }
    assert.equal(new Set(GLOSSARY.map((g) => g.key)).size, GLOSSARY.length);
  });
  it('第一次出現才補、之後不重複;術語後本來就有括號則不補', () => {
    const state = { explained: new Set() };
    const a = explainTerms('命卦是坎命。你的命卦組別不同。', state);
    assert.equal(a.match(/依出生年與性別算出/g).length, 1);
    assert.ok(a.startsWith('命卦(依出生年與性別算出的個人方位組別'));
    const b = explainTerms('宅卦(自己的說明)是艮宅。宅卦', { explained: new Set() });
    assert.equal(b, '宅卦(自己的說明)是艮宅。宅卦');
  });
  it('連著後綴成詞時括號放在整個詞後面(流年財位、五黃星、三煞方)', () => {
    const t = explainTerms('流年財位很多。五黃星在南。三煞方不動土。', { explained: new Set() });
    assert.ok(t.startsWith('流年財位(每一年的方位運勢'), t);
    assert.ok(t.includes('五黃星(兩顆傳統上需要留意的星'), t);
    assert.ok(t.includes('三煞方(每年有一個方位較忌動土'), t);
  });
  it('長詞優先: 明財位不會被財位攔走', () => {
    const t = explainTerms('明財位在右上角,財位很重要', { explained: new Set() });
    assert.ok(t.startsWith('明財位(進門後斜對角的牆角'));
    assert.ok(t.includes('財位(傳統上認為適合放置催財'));
  });
});

/** 獨立於實作的檢查: 每組術語在給定文字裡最早出現處,後面(含後綴)必須接括號。 */
function assertFirstOccurrenceExplained(text, label) {
  const suffixes = ['財位', '財星', '星', '宮', '盤'];
  for (const g of GLOSSARY) {
    let best = null;
    for (const t of g.terms) {
      const i = text.indexOf(t);
      if (i >= 0 && (best === null || i < best.i || (i === best.i && t.length > best.t.length))) best = { i, t };
    }
    if (!best) continue;
    const end = best.i + best.t.length;
    const ok = text[end] === '(' || suffixes.some((s) => text.startsWith(s, end) && text[end + s.length] === '(');
    assert.ok(ok, `${label}: 「${best.t}」第一次出現沒有括號解釋: …${text.slice(Math.max(0, best.i - 8), end + 14)}`);
  }
}

describe('renderReport: 固定結構與文案規則', () => {
  it('六個固定分段依規格 5.3 順序,含進階與傳統說法摺疊;頁底有免責聲明', () => {
    const out = renderReport(analyzeHouse(goldenInput()));
    assert.deepEqual(out.sections.map((s) => s.id), ['orientation', 'ming', 'wealth', 'xuankong', 'annual', 'traditional']);
    assert.deepEqual(out.sections.map((s) => s.title), ['你家的方位', '你的命卦組別與相配情形', '財位', '玄空盤(進階)', '今年留意的方位', '傳統說法與少數派']);
    assert.deepEqual(out.sections.map((s) => s.collapsed), [false, false, false, true, false, true]);
    assert.equal(typeof out.plainSummary, 'string');
    assert.ok(out.plainSummary.length > 50);
  });
  it('免責聲明三類齊全: 文化性質、專業勘宅、測量誤差(另加流派說明);第一則與規格 5.5 一字不差', () => {
    const m = /\*\*結果頁底部固定\(主要語句\)\*\*: 「([^」]+)」/.exec(SPEC_TEXT);
    assert.ok(m, '規格 5.5 主要語句找不到');
    assert.equal(DISCLAIMERS[0], m[1]);
    assert.ok(DISCLAIMERS[0].includes('不保證') && DISCLAIMERS[0].includes('不構成投資'));
    assert.ok(DISCLAIMERS[1].includes('專業風水師'));
    assert.ok(DISCLAIMERS[2].includes('手機羅盤') && DISCLAIMERS[2].includes('金屬或鋼筋'));
    assert.ok(DISCLAIMERS[3].includes('流派'));
    assert.equal(CARD_DISCLAIMER, '傳統民俗參考,請勿過度迷信。');
    const out = renderReport(analyzeHouse(goldenInput()));
    assert.deepEqual(out.disclaimers, [...DISCLAIMERS]);
    out.disclaimers.push('x');
    assert.equal(DISCLAIMERS.length, 4, '回傳的是複本');
  });
  it('sections 選項只輸出指定分段;未知分段丟 INVALID_OPTION;非 report 丟 INVALID_REPORT', () => {
    const r = analyzeHouse(goldenInput());
    assert.deepEqual(renderReport(r, { sections: ['wealth', 'annual'] }).sections.map((s) => s.id), ['wealth', 'annual']);
    throwsCode(() => renderReport(r, { sections: ['nope'] }), 'INVALID_OPTION');
    throwsCode(() => renderReport({}), 'INVALID_REPORT');
    throwsCode(() => renderReport(null), 'INVALID_REPORT');
  });
  it('glossary=false 不補括號解釋', () => {
    const r = analyzeHouse(goldenInput());
    const off = renderReport(r, { glossary: false });
    assert.ok(!off.plainSummary.includes('依出生年與性別算出'));
    const on = renderReport(r);
    assert.ok(on.plainSummary.includes('依出生年與性別算出'));
  });
  it('黃金案例: 每組術語第一次出現都有括號解釋(內文與總覽各自獨立)', () => {
    const out = renderReport(analyzeHouse(goldenInput()));
    const stream = out.sections.flatMap((s) => s.cards.flatMap((c) => [c.body, c.schoolNote ?? ''])).join('\n');
    assertFirstOccurrenceExplained(stream, '內文');
    assertFirstOccurrenceExplained(out.plainSummary, '總覽');
  });
  it('第一屏總覽只談方位、命卦組別、財位、今年重點,不列術語清單', () => {
    const out = renderReport(analyzeHouse(goldenInput()));
    assert.ok(out.plainSummary.split('\n').length <= 7);
    assert.ok(out.plainSummary.includes('今年'));
    assert.ok(!/山星|向星|飛星|三般卦|伏吟/.test(out.plainSummary));
  });
});

describe('renderReport: 對所有隨機輸入都符合文案規則', () => {
  it('每個 Finding id 都有對應文案家族,每則 Finding 都變成一張卡片', () => {
    for (const { report, rendered } of RUNS) {
      const cardIds = new Set(rendered.sections.flatMap((s) => s.cards.map((c) => c.id)));
      for (const f of report.findings) {
        assert.ok(familyOfFindingId(f.id), `找不到文案家族: ${f.id}`);
        assert.ok(cardIds.has(f.id), `Finding 沒有變成卡片: ${f.id}`);
      }
    }
  });
  it('tag=minority 一律進傳統說法分段;其餘依家族分段', () => {
    for (const { report, rendered } of RUNS) {
      const sectionOf = new Map(rendered.sections.flatMap((s) => s.cards.map((c) => [c.id, s.id])));
      for (const f of report.findings) {
        const fam = familyOfFindingId(f.id);
        assert.equal(sectionOf.get(f.id), f.tag === 'minority' ? 'traditional' : fam.section, f.id);
      }
    }
  });
  it('顯示文字不洩漏英文 id、內部代碼、欄位路徑,也沒有恐嚇字眼', () => {
    for (const { rendered } of RUNS) {
      for (const t of displayTexts(rendered)) {
        for (const [re, what] of LEAK_PATTERNS) {
          const m = re.exec(t);
          assert.ok(m === null, `洩漏「${what}」: ${m && m[0]} 於 ${t.slice(0, 80)}`);
        }
        for (const w of BANNED) assert.ok(!t.includes(w), `恐嚇字眼「${w}」於 ${t.slice(0, 80)}`);
        assert.ok(!AFFIRMED_GUARANTEE.test(t), `肯定句的「保證」於 ${t.slice(0, 80)}`);
      }
    }
  });
  it('不顯示精確分數: 任何候選的分數(含小數)都不出現在文字裡', () => {
    for (const { report, rendered } of RUNS) {
      const all = displayTexts(rendered).join('\n');
      for (const c of report.wealth.candidates) {
        if (c.score === null || Number.isInteger(c.score)) continue;
        assert.ok(!all.includes(c.score.toFixed(2)) && !all.includes(String(c.score)), `顯示了分數 ${c.score}`);
      }
      const dec = /\d+\.\d{2}(?!\d)/.exec(all);
      assert.ok(dec === null, `文字裡有兩位小數: ${dec && dec[0]}`);
    }
  });
  it('語氣依 tag: source 傳統上、inference 推論、minority 少數與不採用、design 本 App', () => {
    let seen = { source: 0, inference: 0, minority: 0, design: 0 };
    for (const { rendered } of RUNS) {
      for (const s of rendered.sections) {
        for (const c of s.cards) {
          if (c.source !== 'finding') continue;
          const fam = familyOfFindingId(c.id);
          assert.ok(c.badges.includes({ source: '傳統說法', inference: '推論', design: '本 App 的設計', minority: '少數派' }[c.tag]), c.id);
          if (fam.tone !== 'auto') continue;
          seen[c.tag] += 1;
          if (c.tag === 'source') assert.match(c.body, /傳統|說法|認為|主張|通常|一般|相傳/, c.id);
          if (c.tag === 'inference') assert.match(c.body, /推論|沒有直接的古籍依據/, c.id);
          if (c.tag === 'minority') {
            assert.match(c.body, /少數/, c.id);
            assert.match(c.body, /不採用/, c.id);
          }
          if (c.tag === 'design') assert.match(c.body, /本 App/, c.id);
        }
      }
    }
    for (const k of Object.keys(seen)) assert.ok(seen[k] > 0, `隨機輸入沒有 ${k} 的卡片`);
  });
  it('卡片形狀: 每張都有標題、內文、徽章(含確定度)、tag、confidence;caution 有「需要留意」', () => {
    for (const { rendered } of RUNS) {
      for (const s of rendered.sections) {
        for (const c of s.cards) {
          assert.ok(c.headline.length > 0 && c.body.length > 0, c.id);
          assert.ok(['source', 'inference', 'design', 'minority'].includes(c.tag), c.id);
          assert.ok(['high', 'medium', 'low'].includes(c.confidence), c.id);
          assert.ok(c.badges.some((b) => /^確定度/.test(b)), c.id);
          if (c.level === 'caution') assert.ok(c.badges.includes('需要留意'), c.id);
          if (c.schoolNote) assert.ok(c.badges.includes('各派看法不一'), c.id);
        }
      }
    }
  });
  it('術語第一次出現都有括號解釋(每份報告、內文與總覽各自檢查)', () => {
    for (const { rendered } of RUNS) {
      const stream = rendered.sections.flatMap((s) => s.cards.flatMap((c) => [c.body, c.schoolNote ?? ''])).join('\n');
      assertFirstOccurrenceExplained(stream, '內文');
      assertFirstOccurrenceExplained(rendered.plainSummary, '總覽');
    }
  });
  it('括號解釋不切斷詞(方面、位置、方法、方式之類不被插入括號)', () => {
    for (const { rendered } of RUNS) {
      for (const t of displayTexts(rendered)) {
        const m = /\)(面|法|式|案|置|向)/.exec(t);
        assert.ok(m === null, `括號後接著同一個詞的後半: ${m && t.slice(Math.max(0, m.index - 12), m.index + 6)}`);
      }
    }
  });
  it('結果決定性: 同一份報告渲染兩次相同', () => {
    for (const { report, rendered } of RUNS.slice(0, 30)) assert.deepEqual(renderReport(report), rendered);
  });
});

describe('文案家族涵蓋所有 Finding id(掃描原始碼)', () => {
  const ids = scanFindingIds();
  it('原始碼裡寫死的 Finding id(含樣板字串)都有文案家族', () => {
    assert.ok(ids.size > 60, `只掃到 ${ids.size} 個 id`);
    const missing = [...ids.keys()].filter((id) => !familyOfFindingId(id));
    assert.deepEqual(missing, [], `沒有文案家族的 id: ${missing.join(', ')}`);
  });
  it('掃描抓得到各模組的 id(避免掃描器失靈時假通過)', () => {
    const files = new Set([...ids.values()].flatMap((s) => [...s]));
    for (const f of ['analyze.js', 'bazhai.js', 'annual.js', 'geo.js', 'xuankong/findings.js', 'wealth/findings.js', 'wealth/seat.js']) {
      assert.ok(files.has(f), `沒掃到 ${f} 的 id`);
    }
  });
  it('家族表沒有多餘項: 每個家族至少對應一個掃到的 id', () => {
    for (const fam of COPY_FAMILIES) {
      assert.ok([...ids.keys()].some((id) => fam.re.test(id)), `家族 ${fam.key} 沒有對應的 id`);
    }
  });
  it('家族的 section 與 tone 值合法、key 不重複', () => {
    assert.equal(new Set(COPY_FAMILIES.map((f) => f.key)).size, COPY_FAMILIES.length);
    for (const f of COPY_FAMILIES) {
      assert.ok(SECTION_ORDER.includes(f.section), f.key);
      assert.ok(['auto', 'plain'].includes(f.tone), f.key);
      assert.ok(Number.isFinite(f.order), f.key);
    }
  });
  it('未知 id 不會被誤認: 沒有家族回 null,渲染時退到傳統說法分段而不丟錯', () => {
    assert.equal(familyOfFindingId('nope.unknown'), null);
    const r = analyzeHouse(goldenInput());
    const forged = { ...r, findings: [...r.findings, { id: 'zz.unknown.thing', level: 'note', title: '未知項目', body: '傳統上的說法。', confidence: 'low', tag: 'source', schoolNote: null, refs: [], subject: null }] };
    const out = renderReport(forged);
    const t = out.sections.find((s) => s.id === 'traditional');
    assert.ok(t.cards.some((c) => c.id === 'zz.unknown.thing'));
  });
});

describe('少數派與進階開關進入結果', () => {
  it('showMinorityTechniques / extraShensha / showGuimenxian: 進傳統說法分段且語氣正確', () => {
    const r = analyzeHouse(goldenInput(), { showMinorityTechniques: true, extraShensha: true, showGuimenxian: true });
    const out = renderReport(r);
    const t = out.sections.find((s) => s.id === 'traditional');
    const ids = t.cards.map((c) => c.id);
    for (const id of ['bz.minority.wugui_yuncai', 'bz.minority.taohua', 'bz.minority.guimenxian', 'annual.sansha.jiasha', 'annual.sansha.facing_not_sitting']) {
      assert.ok(ids.includes(id), `傳統說法分段缺 ${id}`);
    }
    for (const c of t.cards.filter((x) => x.tag === 'minority')) {
      assert.ok(c.badges.includes('少數派'));
      assert.match(c.body, /不採用/);
    }
  });
  it('預設不顯示少數派', () => {
    const r = analyzeHouse(goldenInput());
    assert.ok(!r.findings.some((f) => f.tag === 'minority'));
  });
  it('allowWaterHint: 九運水火提示以通則加個案兩層並列', () => {
    const r = analyzeHouse(goldenInput(), { allowWaterHint: true });
    assert.ok(r.findings.some((f) => f.id.startsWith('wealth.water.general')));
    assert.ok(r.wealth.layers.water.length >= 1);
  });
});

describe('今年留意方位對照你家坐向', () => {
  it('黃金案例: 坐(丑山,東北方)落在三煞方(亥子丑)', () => {
    const out = renderReport(analyzeHouse(goldenInput()));
    const c = out.sections.find((s) => s.id === 'annual').cards.find((x) => x.id === 'card.annual.house');
    assert.ok(c);
    assert.ok(c.body.includes('你家的坐(東北方)落在今年的三煞方'));
    assert.equal(c.tag, 'design');
  });
  it('三煞方與坐向無關時不出這張卡', () => {
    const i = goldenInput();
    i.facing.bearing = 90; // 震向,坐 270 度(兌);2026 三煞在北、太歲在南、五黃在南、二黑在西北
    const out = renderReport(analyzeHouse(i));
    assert.ok(!out.sections.find((s) => s.id === 'annual').cards.some((x) => x.id === 'card.annual.house'));
  });
  it('流年卡片: 太歲歲破、三煞、五黃二黑、本月', () => {
    const out = renderReport(analyzeHouse(goldenInput()));
    const ids = out.sections.find((s) => s.id === 'annual').cards.map((c) => c.id);
    assert.deepEqual(ids.slice(0, 4), ['card.annual.taisui', 'card.annual.sansha', 'card.annual.wuhuang', 'card.annual.month']);
    const taisui = out.sections.find((s) => s.id === 'annual').cards[0];
    assert.equal(taisui.headline, '太歲在南方,歲破在北方');
    assert.ok(taisui.body.includes('丙午年') && taisui.body.includes('2月4日換年'));
  });
});

// ═══════════════════════════ J. docs/API.md 與程式一致 ═══════════════════════════

describe('docs/API.md 與程式一致', () => {
  const doc = readFileSync(fileURLToPath(new URL('../docs/API.md', import.meta.url)), 'utf8');
  const blocks = Object.fromEntries([...doc.matchAll(/<!-- example:(\w+) -->\s*```json\n([\s\S]*?)\n```/g)].map((m) => [m[1], JSON.parse(m[2])]));
  const report = analyzeHouse(goldenInput());
  const rendered = renderReport(report);

  it('範例區塊齊全', () => {
    assert.deepEqual(Object.keys(blocks).sort(), ['geo', 'input', 'meta', 'render', 'summary']);
  });
  it('範例輸入就是黃金案例輸入', () => {
    assert.deepEqual(blocks.input, goldenInput());
  });
  it('範例輸出的 summary 與 geo 與實際完全相同', () => {
    assert.deepEqual(blocks.summary, report.summary);
    assert.deepEqual(blocks.geo, report.geo);
  });
  it('範例輸出的 meta 除了 ruleset 與 inputEcho 的說明字樣外與實際相同', () => {
    const { ruleset, inputEcho, ...rest } = report.meta;
    const { ruleset: r2, inputEcho: e2, ...doc2 } = blocks.meta;
    assert.deepEqual(doc2, rest);
    assert.equal(typeof r2, 'string');
    assert.equal(typeof e2, 'string');
  });
  it('範例輸出的文案: 總覽、免責聲明、各分段的標題與張數相同', () => {
    assert.equal(blocks.render.plainSummary, rendered.plainSummary);
    assert.deepEqual(blocks.render.disclaimers, rendered.disclaimers);
    assert.deepEqual(blocks.render.sections, rendered.sections.map((s) => ({ id: s.id, title: s.title, collapsed: s.collapsed, cards: s.cards.length })));
  });
  it('設定表: 每個設定名稱與預設值都和 DEFAULT_SETTINGS 一致,沒有多餘也沒有遺漏', () => {
    const section = doc.slice(doc.indexOf('## 6. 設定開關'), doc.indexOf('## 7. 錯誤碼'));
    const rows = [...section.matchAll(/^\| `([A-Za-z0-9]+)` \| `(.+?)` \| /gm)].map((m) => [m[1], JSON.parse(m[2])]);
    assert.deepEqual(rows.map((r) => r[0]).sort(), Object.keys(DEFAULT_SETTINGS).sort());
    for (const [k, v] of rows) assert.deepEqual(v, DEFAULT_SETTINGS[k], `預設值不一致: ${k}`);
    assert.match(doc, new RegExp(`共 ${Object.keys(DEFAULT_SETTINGS).length} 個`));
  });
  it('文中列出的 house.* Finding id 都是實際會產生的 id', () => {
    const real = [...scanFindingIds().keys()].map((x) => x.replace(/\.x$/, ''));
    const mentioned = [...doc.matchAll(/`(house\.[a-z_.]+?)(?:<[^`]*>)?`/g)].map((m) => m[1]).filter((id) => !id.endsWith('.'));
    assert.ok(mentioned.length >= 12, `只找到 ${mentioned.length} 個`);
    for (const id of mentioned) {
      assert.ok(real.some((r) => r === id || r.startsWith(`${id}.`) || id.startsWith(`${r}.`)), `文件提到不存在的 id: ${id}`);
    }
  });
  it('文件列出的錯誤碼齊全', () => {
    for (const code of ['INVALID_INPUT', 'INVALID_BEARING', 'INVALID_SETTING', 'INVALID_DECLINATION', 'INVALID_REPORT', 'INVALID_OPTION']) {
      assert.ok(doc.includes(`\`${code}\``), code);
    }
  });
});

// annual 模組測試(規格 2.5、3.4 D38-D42、附錄 A.6、B.2、4.1、4.2、4.4)。
// fixtures 為 annual.json(已依附錄 B.2 更新,記錄見 test/fixtures/annual.changes.md);節氣天文的兩類案例(solar_term_time、
// solar_longitude_at_instant)屬 calendar,由 calendar.test.js 執行,這裡只負責流年/流月/太歲/三煞。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFixture, circDiff, assertDeepApprox, assertRunnerCatches, GUA_OF_DIR, LUOSHU,
} from './helpers/harness.js';
import {
  cstMs as cst, hardOrSoft, throwsCode, centerByThreeYuan, centerByDigitRoot, centerByCentury, monthPillarsByFiveTigers,
  monthCentersByKoujue, SPEC_SANSHA, SPEC_ARCS, SPEC_FLIGHT, jueTaiYang, FIVE_TIGER_FIRST_STEM, MONTH_START_BY_BRANCH,
} from './helpers/annual.js';
import * as A from '../src/core/annual.js';
import * as C from '../src/core/calendar.js';
import * as G from '../src/core/geo.js';

const annual = loadFixture('annual');
const byType = (t) => annual.cases.filter((c) => c.type === t);
const MIN = 60000;
const clone = (c) => structuredClone(c);
const BRANCH_CHARS = C.BRANCHES;

// ---------------------------------------------------------------- 各類 fixtures 的 runner(失敗即丟 AssertionError)

function runAnnualCenterStar(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ fengshuiYear: c.input.fengshuiYear });
  assert.equal(r.annual.center, E.center, `${c.name}: 流年中宮`);
  assert.equal(r.year.ganzhi, E.ganzhi, `${c.name}: 干支年`);
  assert.deepEqual([r.year.yun, r.year.yunYear, r.year.era], [E.yun, E.yunYear, E.yuan], `${c.name}: 元運`);
}

function runFengshuiYearAt(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ instant: cst(c.input.instantCST) });
  assert.equal(r.year.fengshuiYear, E.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(r.year.ganzhi, E.ganzhi, `${c.name}: 干支年`);
  assert.equal(r.annual.center, E.annualCenter, `${c.name}: 流年中宮`);
}

function runFlyingChart(c) {
  const E = c.expected;
  const { annual: a } = A.analyzeAnnual({ fengshuiYear: c.input.fengshuiYear });
  assert.equal(a.center, E.center, `${c.name}: 中宮`);
  assert.deepEqual(Object.keys(a.chart).sort(), Object.keys(E.chart).sort(), `${c.name}: 宮位鍵`);
  for (const k of Object.keys(E.chart)) assert.equal(a.chart[k], E.chart[k], `${c.name}: ${k}`);
}

function runWuhuangErhei(c) {
  const E = c.expected;
  const { annual: a } = A.analyzeAnnual({ fengshuiYear: c.input.fengshuiYear });
  assert.deepEqual([a.center, a.wuhuang, a.erhei], [E.center, E.wuhuang, E.erhei], c.name);
}

function runMonthly(c) {
  const ms = cst(c.input.instantCST);
  const E = c.expected;
  const r = A.analyzeAnnual({ instant: ms });
  const m = r.month;
  assert.equal(r.year.fengshuiYear, E.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(m.jie, E.jie, `${c.name}: 節`);
  assert.equal(m.ganzhi, E.monthGanzhi, `${c.name}: 月柱`);
  assert.equal(m.order, E.monthOrder, `${c.name}: 月序`);
  assert.equal(m.center, E.monthlyCenter, `${c.name}: 月中宮`);
  if (E.annualCenter !== undefined) assert.equal(r.annual.center, E.annualCenter, `${c.name}: 流年中宮`);
  if (E.startCST) {
    const tol = c.toleranceMinutes ?? 2;
    assert.ok(Math.abs(m.start - cst(E.startCST)) / MIN <= tol, `${c.name}: 月初 ${m.startCST} vs ${E.startCST}`);
    assert.ok(Math.abs(m.end - cst(E.endCST)) / MIN <= tol, `${c.name}: 月末 ${m.endCST} vs ${E.endCST}`);
  }
  if (E.monthlyChart) {
    assert.deepEqual(Object.keys(m.chart).sort(), Object.keys(E.monthlyChart).sort(), `${c.name}: 月盤宮位鍵`);
    for (const k of Object.keys(E.monthlyChart)) assert.equal(m.chart[k], E.monthlyChart[k], `${c.name}: 月盤 ${k}`);
  }
  if (E.wuhuang !== undefined) assert.deepEqual([m.wuhuang, m.erhei], [E.wuhuang, E.erhei], `${c.name}: 月五黃二黑`);
}

function runTaisuiSansha(c) {
  const E = c.expected;
  const b = c.input.yearBranch;
  const t = A.taisui(b);
  const s = A.sansha(b);
  const got = {
    taisuiBranch: t.branch, taisuiBearing: t.bearing, suipoBranch: t.suipo, suipoBearing: t.suipoBearing,
    sanshaDir: s.dir, sanshaMountains: s.mountains, jieSha: s.jieSha, zaiSha: s.zaiSha, suiSha: s.suiSha,
    jiaSha: s.jiaSha.join(''), sanshaArcCore3: s.arcs.core3, sanshaArcWithJiaSha: s.arcs.withJiaSha,
  };
  for (const k of Object.keys(E)) {
    assert.ok(k in got, `${c.name}: 未知的期望欄位 ${k}`);
    assert.deepEqual(got[k], E[k], `${c.name}: ${k}`);
  }
}

function runTaisuiSanshaYear(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ fengshuiYear: c.input.fengshuiYear });
  const got = {
    ganzhi: r.year.ganzhi, taisui: r.taisui.branch, suipo: r.taisui.suipo, sansha: r.sansha.mountains,
    sanshaDir: r.sansha.dir, jiaSha: r.sansha.jiaSha.join(''), wuhuang: r.annual.wuhuang,
  };
  for (const k of Object.keys(E)) {
    assert.ok(k in got, `${c.name}: 未知的期望欄位 ${k}`);
    assert.equal(got[k], E[k], `${c.name}: ${k}`);
  }
}

function runNineYunAt(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ instant: cst(c.input.instantCST) });
  assert.equal(r.year.fengshuiYear, E.fengshuiYear, `${c.name}: 風水年`);
  assert.deepEqual([r.year.yun, r.year.yunYear, r.year.era], [E.yun, E.yunYear, E.yuan], `${c.name}: 元運`);
}

/** B.2 monthly 補案: 年柱、月柱、月序、月中宮(含辰戌丑未年起始 5 組與 1 月丑月)。 */
function runMonthlyB2(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ instant: cst(c.input.instantCST) });
  assert.equal(r.year.fengshuiYear, E.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(r.year.ganzhi, E.yearGanzhi, `${c.name}: 年柱`);
  assert.equal(r.month.ganzhi, E.monthGanzhi, `${c.name}: 月柱`);
  assert.equal(r.month.order, E.monthOrder, `${c.name}: 月序`);
  assert.equal(r.month.center, E.monthlyCenter, `${c.name}: 月中宮`);
}

/** B.2 月柱五虎遁補案。 */
function runFiveTigersB2(c) {
  const E = c.expected;
  const r = A.analyzeAnnual({ instant: cst(c.input.instantCST) });
  assert.equal(r.year.fengshuiYear, E.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(r.year.ganzhi, E.yearGanzhi, `${c.name}: 年柱`);
  assert.equal(r.month.ganzhi, E.monthGanzhi, `${c.name}: 月柱`);
}

// ---------------------------------------------------------------- fixtures 驅動測試

const ANNUAL_RUNNERS = [
  ['annual_center_star', runAnnualCenterStar, 34],
  ['fengshui_year_at', runFengshuiYearAt, 27],
  ['annual_flying_chart', runFlyingChart, 10],
  ['wuhuang_erhei_direction', runWuhuangErhei, 10],
  ['monthly_flying_star', runMonthly, 27],
  ['taisui_sansha', runTaisuiSansha, 12],
  ['taisui_sansha_year', runTaisuiSanshaYear, 11],
  ['nine_yun_at', runNineYunAt, 8],
  ['monthly_flying_star_b2', runMonthlyB2, 9],
  ['month_pillar_five_tigers_b2', runFiveTigersB2, 5],
];
/** 屬 calendar 的兩類案例(calendar.test.js 已執行)。 */
const CALENDAR_ONLY_TYPES = ['solar_term_time', 'solar_longitude_at_instant'];

for (const [type, runner, count] of ANNUAL_RUNNERS) {
  test(`annual.json ${type}: 案例數符合 meta.counts(${count})`, () => {
    assert.equal(byType(type).length, count);
    assert.equal(annual.meta.counts[type], count);
  });
  for (const c of byType(type)) {
    test(`annual.json ${type}: ${c.name}`, () => hardOrSoft(c, runner));
  }
}

test('annual.json 每個 type 恰由 annual 或 calendar 其中一份測試負責,總案數與 meta.counts.total 相符', () => {
  const owned = new Set([...ANNUAL_RUNNERS.map(([t]) => t), ...CALENDAR_ONLY_TYPES]);
  const present = new Set(annual.cases.map((c) => c.type));
  assert.deepEqual([...present].sort(), [...owned].sort());
  assert.equal(new Set(annual.cases.map((c) => c.name)).size, annual.cases.length, '案名不可重複');
  assert.equal(annual.cases.length, annual.meta.counts.total);
  assert.equal(annual.cases.length, 205); // 原 191 + B.2 補案 14
  const perType = Object.fromEntries([...present].map((t) => [t, byType(t).length]));
  for (const t of present) assert.equal(annual.meta.counts[t], perType[t], `meta.counts.${t}`);
  // annual 負責 139 案原有類別 + 14 案 B.2 補案
  const ownedOriginal = ANNUAL_RUNNERS.filter(([t]) => !t.endsWith('_b2')).reduce((n, [t]) => n + byType(t).length, 0);
  assert.equal(ownedOriginal, 139);
});

test('annual.json B.2: taisui_sansha 不再含把夾煞算進去的 75° sanshaArcFrom/To,改存 core3 與 withJiaSha', () => {
  for (const c of byType('taisui_sansha')) {
    assert.ok(!('sanshaArcFrom' in c.expected) && !('sanshaArcTo' in c.expected), c.name);
    assert.equal(c.expected.sanshaArcCore3.length, 3, c.name);
    for (const [from, to] of c.expected.sanshaArcCore3) {
      assert.equal(((to - from) % 360 + 360) % 360, 15, `${c.name}: core3 每段 15°`);
    }
    const [f, t] = c.expected.sanshaArcWithJiaSha;
    assert.equal(((t - f) % 360 + 360) % 360, 75, `${c.name}: withJiaSha 為 75°`);
  }
});

test('annual.json B.2: 2023 立春邊界格加註官方表 1 分歧義', () => {
  for (const name of ['lichun_2023', 'lichun_boundary_2023_before', 'lichun_boundary_2023_after']) {
    const c = annual.cases.find((x) => x.name === name);
    assert.ok(c && /1 分歧義/.test(c.note), name);
  }
});

// ---------------------------------------------------------------- 突變測試(規格 4.2 第 3 點)

test('突變: annual_center_star 中宮、元運錯會被抓出', () => {
  const a = clone(byType('annual_center_star')[0]);
  a.expected.center = (a.expected.center % 9) + 1;
  assertRunnerCatches(runAnnualCenterStar, a);
  const b = clone(byType('annual_center_star')[0]);
  b.expected.yunYear += 1;
  assertRunnerCatches(runAnnualCenterStar, b);
});
test('突變: fengshui_year_at 風水年與流年中宮錯會被抓出', () => {
  const a = clone(byType('fengshui_year_at')[0]);
  a.expected.fengshuiYear += 1;
  assertRunnerCatches(runFengshuiYearAt, a);
  const b = clone(byType('fengshui_year_at')[0]);
  b.expected.annualCenter = (b.expected.annualCenter % 9) + 1;
  assertRunnerCatches(runFengshuiYearAt, b);
});
test('突變: annual_flying_chart 一格錯會被抓出', () => {
  const bad = clone(byType('annual_flying_chart')[0]);
  bad.expected.chart['南'] = (bad.expected.chart['南'] % 9) + 1;
  assertRunnerCatches(runFlyingChart, bad);
});
test('突變: wuhuang_erhei 五黃或二黑錯會被抓出', () => {
  const a = clone(byType('wuhuang_erhei_direction')[0]);
  a.expected.wuhuang = '中宮';
  assertRunnerCatches(runWuhuangErhei, a);
  const b = clone(byType('wuhuang_erhei_direction')[0]);
  b.expected.erhei = '中宮';
  assertRunnerCatches(runWuhuangErhei, b);
});
test('突變: monthly 月柱、月中宮、月初時刻、月盤錯會被抓出', () => {
  const base = byType('monthly_flying_star')[0];
  const a = clone(base);
  a.expected.monthGanzhi = '甲子';
  assertRunnerCatches(runMonthly, a);
  const b = clone(base);
  b.expected.monthlyCenter = (b.expected.monthlyCenter % 9) + 1;
  assertRunnerCatches(runMonthly, b);
  const c = clone(base);
  c.expected.startCST = C.formatCST(cst(c.expected.startCST) + 10 * MIN);
  assertRunnerCatches(runMonthly, c);
  const d = clone(base);
  d.expected.monthlyChart['北'] = (d.expected.monthlyChart['北'] % 9) + 1;
  assertRunnerCatches(runMonthly, d);
  const e = clone(base);
  e.expected.wuhuang = '中宮';
  assertRunnerCatches(runMonthly, e);
});
test('突變: taisui_sansha 太歲、夾煞、core3 弧、withJiaSha 弧錯會被抓出', () => {
  const base = byType('taisui_sansha')[0];
  const a = clone(base);
  a.expected.taisuiBearing += 30;
  assertRunnerCatches(runTaisuiSansha, a);
  const b = clone(base);
  b.expected.jiaSha = '甲乙';
  assertRunnerCatches(runTaisuiSansha, b);
  const c = clone(base);
  c.expected.sanshaArcCore3[0][0] += 15;
  assertRunnerCatches(runTaisuiSansha, c);
  const d = clone(base);
  d.expected.sanshaArcWithJiaSha[1] += 15;
  assertRunnerCatches(runTaisuiSansha, d);
  const e = clone(base);
  e.expected.sanshaArcFrom = 142.5; // 舊的 75° 欄位不再被承認
  assertRunnerCatches(runTaisuiSansha, e);
});
test('突變: taisui_sansha_year 三煞方位、五黃錯會被抓出', () => {
  const base = byType('taisui_sansha_year')[0];
  const a = clone(base);
  a.expected.sanshaDir = '東';
  assertRunnerCatches(runTaisuiSanshaYear, a);
  const b = clone(base);
  b.expected.wuhuang = '中宮';
  assertRunnerCatches(runTaisuiSanshaYear, b);
});
test('突變: nine_yun_at 運年錯會被抓出', () => {
  const bad = clone(byType('nine_yun_at')[0]);
  bad.expected.yunYear += 1;
  assertRunnerCatches(runNineYunAt, bad);
});
test('突變: B.2 monthly 與五虎遁月柱錯會被抓出', () => {
  const a = clone(byType('monthly_flying_star_b2')[0]);
  a.expected.monthlyCenter = (a.expected.monthlyCenter % 9) + 1;
  assertRunnerCatches(runMonthlyB2, a);
  const b = clone(byType('monthly_flying_star_b2')[0]);
  b.expected.monthGanzhi = '甲子';
  assertRunnerCatches(runMonthlyB2, b);
  const c = clone(byType('month_pillar_five_tigers_b2')[0]);
  c.expected.monthGanzhi = '甲寅';
  assertRunnerCatches(runFiveTigersB2, c);
});
test('hardOrSoft: 低信心案例吞 AssertionError,其他例外照丟', () => {
  hardOrSoft({ confidence: 'low' }, () => assert.equal(1, 2));
  assert.throws(() => hardOrSoft({ confidence: 'low' }, () => { throw new TypeError('x'); }), TypeError);
  assert.throws(() => hardOrSoft({ confidence: 'high' }, () => assert.equal(1, 2)), assert.AssertionError);
});

// ---------------------------------------------------------------- 規格內嵌資料表: 由規則重算 == 內嵌表(規格 4.2 第 6 點)

test('洛書順飛宮序: PALACES(由洛書數推出)== 規格與 annual.json conventions.flightOrder', () => {
  assert.equal(A.PALACES.length, 9);
  A.PALACES.forEach((p, k) => {
    assert.deepEqual({ dir: p.dir, gua: p.gua, bearing: p.bearing }, SPEC_FLIGHT[k], `第 ${k} 宮`);
    assert.equal(p.k, k);
  });
  assert.deepEqual(annual.meta.conventions.flightOrder.match(/中宮 -> .*?(?= \()/)[0].split(' -> '), SPEC_FLIGHT.map((p) => p.dir));
});

test('PALACES 的卦與方位名和 geo 一致(八卦 index × 45 = 方位角)', () => {
  for (const p of A.PALACES) {
    if (p.gua === '中') continue;
    assert.equal(G.dirOfGua(p.gua), p.dir);
    assert.equal(G.guaAt(p.bearing).gua, p.gua);
    assert.equal(GUA_OF_DIR[p.dir], p.gua);
  }
});

test('三煞表: SANSHA_TABLE(由三合局絕胎養推出)== 規格 2.5.2 第 6 點內嵌表', () => {
  assert.equal(A.SANSHA_TABLE.length, 4);
  for (const [group, row] of Object.entries(SPEC_SANSHA)) {
    const t = A.SANSHA_TABLE.find((r) => r.name === group);
    assert.ok(t, group);
    assert.deepEqual({ dir: t.dir, jie: t.jie, zai: t.zai, sui: t.sui, jia: [...t.jia] }, row, group);
  }
});

test('三煞表: 與十二長生順行推得的絕、胎、養(劫煞、災煞、歲煞)一致', () => {
  for (const group of Object.keys(SPEC_SANSHA)) {
    const t = A.SANSHA_TABLE.find((r) => r.name === group);
    assert.deepEqual({ jie: t.jie, zai: t.zai, sui: t.sui }, jueTaiYang(group), group);
  }
});

test('三煞四組弧: sansha() 三層弧 == 規格 2.5.2 第 7 點已重算值(12 個年支)', () => {
  for (let b = 0; b < 12; b++) {
    const s = A.sansha(b);
    const spec = SPEC_ARCS[s.dir];
    assert.deepEqual(s.arcs.core3, spec.core3, `${BRANCH_CHARS[b]} core3`);
    assert.deepEqual(s.arcs.withJiaSha, spec.withJiaSha, `${BRANCH_CHARS[b]} withJiaSha`);
    assert.deepEqual(s.arcs.branch12, spec.branch12, `${BRANCH_CHARS[b]} branch12`);
  }
});

test('月起始星表 MONTH_START_STAR == 口訣(子午卯酉 8、辰戌丑未 5、寅申巳亥 2)', () => {
  for (let b = 0; b < 12; b++) {
    assert.equal(A.MONTH_START_STAR[b % 3], MONTH_START_BY_BRANCH[BRANCH_CHARS[b]], BRANCH_CHARS[b]);
  }
  assert.deepEqual([...A.MONTH_START_STAR], [8, 5, 2]);
});

// ---------------------------------------------------------------- 與 annual.json 內嵌參考實作逐項一致(窮舉)

function loadReference() {
  const mod = { exports: {} };
  new Function('module', 'exports', annual.meta.referenceImplementation.source)(mod, mod.exports);
  return mod.exports;
}
const REF = loadReference();

test('參考實作抽出無誤,API 名稱存在', () => {
  for (const k of ['annualCenter', 'monthlyCenter', 'fly', 'palaceOfStar', 'taisui', 'sansha', 'monthTable', 'termInstant']) {
    assert.equal(typeof REF[k], 'function', k);
  }
});

test('1864-2100: annualCenter / fly / palaceOfStar 與參考實作逐項相同', () => {
  for (let fy = 1864; fy <= 2100; fy++) {
    const c = A.annualCenter(fy);
    assert.equal(c, REF.annualCenter(fy), `${fy} 中宮`);
    assert.equal(JSON.stringify(A.fly(c)), JSON.stringify(REF.fly(c)), `${fy} 飛布(含鍵順序)`);
    for (let star = 1; star <= 9; star++) assert.equal(A.palaceOfStar(c, star), REF.palaceOfStar(c, star), `${fy} 星 ${star}`);
  }
});

test('monthlyCenter 對 12 個年支 × 12 個月序與參考實作相同', () => {
  for (let b = 0; b < 12; b++) for (let o = 0; o < 12; o++) assert.equal(A.monthlyCenter(b, o), REF.monthlyCenter(b, o), `${b}/${o}`);
});

test('taisui / sansha 對 12 個年支與參考實作相同(withJiaSha 即參考實作的 75° 弧)', () => {
  for (let b = 0; b < 12; b++) {
    const t = A.taisui(b);
    const rt = REF.taisui(b);
    assert.deepEqual([t.branch, t.bearing, t.suipo, t.suipoBearing], [rt.branch, rt.bearing, rt.suipo, rt.suipoBearing], `太歲 ${b}`);
    const s = A.sansha(b);
    const rs = REF.sansha(b);
    assert.deepEqual([s.dir, s.jieSha, s.zaiSha, s.suiSha, s.jiaSha], [rs.dir, rs.jieSha, rs.zaiSha, rs.suiSha, rs.jiaSha], `三煞 ${b}`);
    assert.deepEqual(s.arcs.withJiaSha, [rs.arcFrom, rs.arcTo], `75° 弧 ${b}`);
  }
});

test('1900-2099: monthlyTable(fy) 與參考實作 monthTable 逐月相同(月界逐 ms、月柱、月中宮、月五黃二黑)', () => {
  for (let fy = 1900; fy <= 2099; fy++) {
    const mine = A.monthlyTable(fy);
    const ref = REF.monthTable(fy);
    assert.equal(mine.length, 12);
    ref.forEach((r, i) => {
      const m = mine[i];
      assert.deepEqual(
        [m.order, m.jie, m.ganzhi, m.start, m.end, m.center, m.wuhuang, m.erhei],
        [r.order, r.jie, r.ganzhi, r.start, r.end, r.center, r.wuhuang, r.erhei],
        `${fy} 第 ${i} 月`,
      );
    });
  }
});

// ---------------------------------------------------------------- 屬性測試(規格 4.4 calendar/annual)

test('流年中宮三式(三元甲子逐年走、11-數字根、世紀口訣)與 annualCenter 一致: 1864-2100', () => {
  for (let fy = 1864; fy <= 2100; fy++) {
    const c = A.annualCenter(fy);
    assert.equal(centerByThreeYuan(fy), c, `${fy} 三元甲子`);
    assert.equal(centerByDigitRoot(fy), c, `${fy} 尾數和`);
    if (fy >= 1900 && fy <= 2099) assert.equal(centerByCentury(fy), c, `${fy} 世紀口訣`);
  }
  assert.deepEqual([2026, 2025, 2024, 2019].map(A.annualCenter), [1, 2, 3, 8]); // 規格 2.5.2 第 1 點
});

test('流年中宮 -1 逐年遞減(0 回 9),9 年一輪,180 年三元一輪回到起點', () => {
  for (let fy = 1864; fy < 2100; fy++) assert.equal(A.annualCenter(fy + 1), A.annualCenter(fy) === 1 ? 9 : A.annualCenter(fy) - 1, `${fy}`);
  assert.equal(A.annualCenter(1864), 1);
  assert.equal(A.annualCenter(1864 + 180), 1);
  assert.equal(A.annualCenter(1864 + 60), 4); // 中元起
  assert.equal(A.annualCenter(1864 + 120), 7); // 下元起
});

test('流年盤各宮 1..9 排列: 任一年、任一中宮星的九宮不重複,且與 geo 洛書基盤位移一致', () => {
  for (let center = 1; center <= 9; center++) {
    const chart = A.fly(center);
    assert.deepEqual(Object.values(chart).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9], `中宮 ${center}`);
    const byGua = A.flyByGua(center);
    assert.deepEqual(Object.values(byGua).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [gua, n] of Object.entries(LUOSHU)) {
      // 洛書基盤(中 5)整體加 (center-5),同一個宮永遠比中宮多固定的步數
      assert.equal(byGua[gua], ((((n + center - 5) % 9) + 9) % 9) || 9, `中宮 ${center} ${gua}`);
    }
    for (const p of A.PALACES) assert.equal(chart[p.dir], byGua[p.gua], `方位名與卦名兩種鍵一致 ${p.dir}`);
    assert.equal(chart['中宮'], center);
  }
  assert.deepEqual(A.flyByGua(5), { 中: 5, 乾: 6, 兌: 7, 艮: 8, 離: 9, 坎: 1, 坤: 2, 震: 3, 巽: 4 }, '中 5 即原始洛書盤');
});

test('五黃與二黑: palaceOfStar 與「由飛布結果反查」一致,每個星恰落一宮', () => {
  for (let center = 1; center <= 9; center++) {
    const chart = A.fly(center);
    for (let star = 1; star <= 9; star++) {
      const hits = Object.entries(chart).filter(([, v]) => v === star).map(([k]) => k);
      assert.equal(hits.length, 1);
      assert.equal(A.palaceOfStar(center, star), hits[0], `中宮 ${center} 星 ${star}`);
    }
  }
});

test('12 個月連續: 前月 end = 後月 start;首月起於立春、末月止於次年立春(1900-2099)', () => {
  for (let fy = 1900; fy <= 2099; fy++) {
    const rows = A.monthlyTable(fy);
    assert.equal(rows[0].start, C.lichun(fy), `${fy} 首月起點`);
    assert.equal(rows[11].end, C.lichun(fy + 1), `${fy} 末月終點`);
    for (let i = 0; i < 11; i++) assert.equal(rows[i].end, rows[i + 1].start, `${fy} 第 ${i}/${i + 1} 月`);
    rows.forEach((r, i) => {
      assert.equal(r.order, i);
      assert.ok(r.end > r.start);
      const days = (r.end - r.start) / 86400000;
      assert.ok(days > 28 && days < 33, `${fy} 第 ${i} 月長 ${days.toFixed(2)} 天`);
    });
  }
});

test('月柱與月中宮: 全部 12 個年支與 1900-2099 各年,對照五虎遁口訣表與紫白月飛星口訣', () => {
  for (let fy = 1900; fy <= 2099; fy++) {
    const gz = C.yearGanzhi(fy);
    const yearStem = C.STEMS[gz.stem];
    const yearBranch = C.BRANCHES[gz.branch];
    const pillars = monthPillarsByFiveTigers(yearStem);
    const centers = monthCentersByKoujue(yearBranch);
    A.monthlyTable(fy).forEach((r, i) => {
      assert.equal(r.ganzhi, pillars[i], `${fy}(${gz.name}) 第 ${i} 月月柱`);
      assert.equal(r.center, centers[i], `${fy}(${gz.name}) 第 ${i} 月月中宮`);
      // 五黃二黑由飛布結果反查
      const chart = A.fly(r.center);
      assert.equal(chart[r.wuhuang], 5);
      assert.equal(chart[r.erhei], 2);
    });
  }
});

test('月中宮 [8,5,2][年支%3]-月序: monthlyCenter 對 12×12 全表與口訣逐格相同', () => {
  for (let b = 0; b < 12; b++) {
    const list = monthCentersByKoujue(BRANCH_CHARS[b]);
    for (let o = 0; o < 12; o++) {
      assert.equal(A.monthlyCenter(b, o), list[o], `${BRANCH_CHARS[b]} ${o}`);
      assert.equal(A.monthlyCenter(BRANCH_CHARS[b], o), list[o], `字元寫法 ${BRANCH_CHARS[b]} ${o}`);
    }
  }
});

test('五虎遁口訣表五個年干組各出現(與 B.2 五個月柱案一致)', () => {
  assert.deepEqual(Object.keys(FIVE_TIGER_FIRST_STEM).length, 10);
  for (const c of byType('month_pillar_five_tigers_b2')) {
    const stem = c.expected.yearGanzhi[0];
    assert.equal(monthPillarsByFiveTigers(stem)[0], c.expected.monthGanzhi, c.name);
  }
});

test('fengshuiYear 恰在立春瞬間換年: analyzeAnnual 於立春前 1 ms 與立春當下(1900-2100 逐年)', () => {
  for (let y = 1900; y <= 2100; y++) {
    const lc = C.lichun(y);
    const before = A.analyzeAnnual({ instant: lc - 1 });
    const at = A.analyzeAnnual({ instant: lc });
    assert.equal(before.year.fengshuiYear, y - 1, `${y} -1ms`);
    assert.equal(at.year.fengshuiYear, y, `${y} 當下`);
    assert.equal(at.annual.center, A.annualCenter(y));
    assert.equal(before.annual.center, A.annualCenter(y - 1));
    assert.equal(at.month.order, 0, `${y} 立春當下是寅月`);
    assert.equal(before.month.order, 11, `${y} 立春前是丑月`);
    assert.equal(at.month.start, lc);
    assert.equal(before.month.end, lc);
  }
});

test('立春前一分鐘仍屬上一年(規格 2.5.3: 2021 22:59、2025 22:10、2026 04:02)', () => {
  for (const [y, hhmm] of [[2021, '2021-02-03 22:59'], [2025, '2025-02-03 22:10'], [2026, '2026-02-04 04:02']]) {
    const lc = C.lichun(y);
    assert.equal(C.formatCST(lc), hhmm);
    assert.equal(A.analyzeAnnual({ instant: lc - MIN }).year.fengshuiYear, y - 1);
    assert.equal(A.analyzeAnnual({ instant: lc + MIN }).year.fengshuiYear, y);
  }
});

test('三煞每組 core3 為 3 個地支山、四組聯集恰為全部 12 個地支山、彼此不重疊(0.1° 解析度掃描 geo 的山)', () => {
  const sanshaByGroup = [0, 1, 2, 3].map((b) => A.sansha(b)); // 子丑寅卯 分屬四個三合局
  assert.equal(new Set(sanshaByGroup.map((s) => s.group)).size, 4);
  for (const s of sanshaByGroup) {
    assert.equal(s.arcs.core3.length, 3);
    for (const name of [s.jieSha, s.zaiSha, s.suiSha]) assert.ok(BRANCH_CHARS.includes(name), `${name} 是地支山`);
  }
  for (let d10 = 0; d10 < 3600; d10++) {
    const b = d10 / 10;
    const hits = sanshaByGroup.filter((s) => s.arcs.core3.some((arc) => A.inArc(b, arc)));
    const isBranchMountain = BRANCH_CHARS.includes(G.mountainAt(b).name);
    assert.equal(hits.length, isBranchMountain ? 1 : 0, `${b}° 命中 ${hits.length} 組,地支山=${isBranchMountain}`);
    const withJia = sanshaByGroup.filter((s) => A.inArc(b, s.arcs.withJiaSha));
    assert.ok(withJia.length <= 1, `${b}° withJiaSha 重疊`);
    const b12 = sanshaByGroup.filter((s) => A.inArc(b, s.arcs.branch12));
    assert.equal(b12.length, 1, `${b}° branch12 應恰好屬於一組`);
  }
});

test('三煞與 geo 24 山一致: 弧端點半開、三煞與夾煞山名、太歲/歲破方位角', () => {
  for (let b = 0; b < 12; b++) {
    const s = A.sansha(b);
    const centerOf = (name) => G.MOUNTAINS.find((m) => m.name === name).centerDeg;
    [s.jieSha, s.zaiSha, s.suiSha].forEach((name, i) => {
      const [from, to] = s.arcs.core3[i];
      assert.equal(G.mountainAt(from).name, name, `${name} 弧起點(含)`);
      assert.equal(G.mountainAt(to - 1e-6).name, name, `${name} 弧迄點前`);
      assert.notEqual(G.mountainAt(to).name, name, `${name} 弧迄點(不含)`);
      assert.ok(A.inArc(from, [from, to]) && !A.inArc(to, [from, to]));
      assert.ok(A.inArc(centerOf(name), [from, to]));
    });
    assert.deepEqual(
      s.jiaSha,
      [G.mountainAt((centerOf(s.jieSha) + 15) % 360).name, G.mountainAt((centerOf(s.zaiSha) + 15) % 360).name],
      '夾煞是劫煞與災煞、災煞與歲煞之間的兩個天干山',
    );
    s.jiaSha.forEach((name) => assert.equal(G.MOUNTAINS.find((m) => m.name === name).kind, '天干'));
    // withJiaSha = 5 個連續山: 3 地支山 + 2 夾煞,兩端外側的山不在弧內
    const five = [s.jieSha, s.jiaSha[0], s.zaiSha, s.jiaSha[1], s.suiSha];
    five.forEach((name) => assert.ok(A.inArc(centerOf(name), s.arcs.withJiaSha), `${name} 在 withJiaSha 內`));
    const jieIdx = G.mountainIndex(s.jieSha);
    assert.ok(!A.inArc(G.MOUNTAINS[(jieIdx + 23) % 24].centerDeg, s.arcs.withJiaSha));
    assert.ok(!A.inArc(G.MOUNTAINS[(jieIdx + 5) % 24].centerDeg, s.arcs.withJiaSha));
    // 三煞方位名 = 災煞山所在的宮
    assert.equal(s.dir, G.dirOfGua(G.guaOfMountain(s.zaiSha)));
    // 太歲、歲破
    const t = A.taisui(b);
    assert.equal(t.branch, BRANCH_CHARS[b]);
    assert.equal(G.mountainAt(t.bearing).name, t.branch);
    assert.equal(G.mountainAt(t.suipoBearing).name, t.suipo);
    assert.equal(circDiff(t.bearing, t.suipoBearing), 180, '歲破在太歲正對面');
    assert.equal(t.suipo, BRANCH_CHARS[(b + 6) % 12]);
    assert.equal(t.gua, G.guaAt(t.bearing).gua);
    assert.equal(t.dir, G.guaAt(t.bearing).dir8);
    assert.equal(t.suipoDir, G.guaAt(t.suipoBearing).dir8);
  }
});

test('三煞在對沖那一方: 災煞 = 三合局旺支的歲破,劫煞與歲煞在其左右各一支', () => {
  for (let b = 0; b < 12; b++) {
    const s = A.sansha(b);
    const zaiCenter = G.MOUNTAINS.find((m) => m.name === s.zaiSha).centerDeg;
    // 局內三支(生旺墓)中的「旺」支對沖 = 災煞支;該局三支各自的歲破必定落在三煞的三個支之中
    const group = s.group.split('');
    const wang = group.find((x) => '子午卯酉'.includes(x));
    assert.equal(A.taisui(wang).suipoBearing, zaiCenter, `${s.group} 旺支的歲破即災煞`);
    // 三煞是以災煞為中心的連續三個地支,且不含本局自己的三支(在對沖那一方)
    const zaiIdx = BRANCH_CHARS.indexOf(s.zaiSha);
    assert.deepEqual([s.jieSha, s.zaiSha, s.suiSha], [-1, 0, 1].map((d) => BRANCH_CHARS[(zaiIdx + d + 12) % 12]), s.group);
    for (const x of group) assert.ok(![s.jieSha, s.zaiSha, s.suiSha].includes(x), `${s.group} 的 ${x} 不在自己的三煞內`);
  }
});

test('nineYun 由 analyzeAnnual 取得: 每運恰 20 年、yunYear 1..20、180 年一循環(1864-2100)', () => {
  const count = new Map();
  for (let fy = 1864; fy < 1864 + 180; fy++) {
    const y = A.analyzeAnnual({ fengshuiYear: fy }).year;
    count.set(y.yun, (count.get(y.yun) ?? 0) + 1);
    assert.equal(y.yun, Math.floor((fy - 1864) / 20) + 1);
    assert.equal(y.yunYear, ((fy - 1864) % 20) + 1);
    const again = A.analyzeAnnual({ fengshuiYear: fy + 180 }).year;
    assert.deepEqual([again.yun, again.yunYear, again.era], [y.yun, y.yunYear, y.era], `${fy} 與 +180 年相同`);
  }
  assert.deepEqual([...count.values()], Array(9).fill(20));
});

test('交運: 2044-02-03 全日與 02-04 上午仍屬九運,立春後(2044-02-04 12:44 之後)換一運', () => {
  const at = (s) => A.analyzeAnnual({ instant: cst(s) }).year;
  assert.deepEqual([at('2044-02-03 12:00').fengshuiYear, at('2044-02-03 12:00').yun], [2043, 9]);
  assert.deepEqual([at('2044-02-04 09:00').fengshuiYear, at('2044-02-04 09:00').yun], [2043, 9]);
  assert.deepEqual([at('2044-02-04 13:30').fengshuiYear, at('2044-02-04 13:30').yun, at('2044-02-04 13:30').era], [2044, 1, '上元']);
  assert.equal(at('2024-02-04 16:24').yun, 8);
  assert.equal(at('2024-02-04 16:30').yun, 9);
});

// ---------------------------------------------------------------- 規格 2.5.1 輸出範例(2026-09-29 12:00 CST)

test('analyzeAnnual 對 2026-09-29 12:00 CST 的輸出 == 規格 2.5.1 範例', () => {
  const r = A.analyzeAnnual({ instant: cst('2026-09-29 12:00') });
  const spec = {
    year: { fengshuiYear: 2026, ganzhi: '丙午', lichunCST: '2026-02-04 04:02', yun: 9, yunYear: 3, era: '下元' },
    annual: {
      center: 1,
      chart: { 中宮: 1, 西北: 2, 西: 3, 東北: 4, 南: 5, 北: 6, 西南: 7, 東: 8, 東南: 9 },
      wuhuang: '南', erhei: '西北',
    },
    month: { jie: '白露', ganzhi: '丁酉', order: 7, startCST: '2026-09-07 22:41', endCST: '2026-10-08 14:30', center: 1 },
    taisui: { branch: '午', bearing: 180, suipo: '子', suipoBearing: 0 },
    sansha: {
      dir: '北', mountains: '亥子丑', jieSha: '亥', zaiSha: '子', suiSha: '丑',
      arcs: { core3: [[322.5, 337.5], [352.5, 7.5], [22.5, 37.5]], withJiaSha: [322.5, 37.5], branch12: [315, 45] },
      jiaSha: ['壬', '癸'],
    },
    findings: [],
    meta: { schema: 'fengshui.annual/1' },
  };
  assertDeepApprox(r, spec, 0);
  assert.equal(r.year.lichun, C.lichun(2026));
  assert.equal(r.month.start, C.monthOf(cst('2026-09-29 12:00')).start);
  assert.ok(Math.abs(r.month.end - cst('2026-10-08 14:29')) <= 2 * MIN, '與 fixtures 寒露 14:29 相差在容差 2 分內');
  assert.deepEqual(r.meta.warnings, []);
  assert.equal(r.meta.computedAtCST, '2026-09-29 12:00');
  assert.equal(r.approx, false);
});

test('analyzeAnnual 只給 fengshuiYear: month 為 null,其餘同年欄位,computedAtCST 為 null', () => {
  const r = A.analyzeAnnual({ fengshuiYear: 2026 });
  assert.equal(r.month, null);
  assert.equal(r.meta.computedAtCST, null);
  const i = A.analyzeAnnual({ instant: cst('2026-09-29 12:00') });
  assert.deepEqual({ ...r, month: null, meta: null }, { ...i, month: null, meta: null });
});

test('analyzeAnnual 給 instant 時,月盤五黃二黑與月中宮和 monthlyTable 該列一致', () => {
  for (const s of ['2026-02-04 04:03', '2026-06-30 08:00', '2027-01-20 12:00', '2024-12-25 23:30']) {
    const r = A.analyzeAnnual({ instant: cst(s) });
    const row = A.monthlyTable(r.year.fengshuiYear)[r.month.order];
    assert.deepEqual(
      [r.month.jie, r.month.ganzhi, r.month.start, r.month.end, r.month.center, r.month.wuhuang, r.month.erhei],
      [row.jie, row.ganzhi, row.start, row.end, row.center, row.wuhuang, row.erhei],
      s,
    );
    assert.deepEqual(r.month.chart, A.fly(r.month.center));
    assert.ok(cst(s) >= r.month.start && cst(s) < r.month.end, `${s} 落在月界內`);
  }
});

test('annual 的 wuhuangGua / erheiGua 與卦名盤一致', () => {
  for (let fy = 2000; fy <= 2030; fy++) {
    const { annual: a } = A.analyzeAnnual({ fengshuiYear: fy });
    assert.equal(a.chartByGua[a.wuhuangGua], 5);
    assert.equal(a.chartByGua[a.erheiGua], 2);
  }
  assert.equal(A.analyzeAnnual({ fengshuiYear: 2022 }).annual.wuhuangGua, '中', '2022 五黃入中');
  assert.equal(A.analyzeAnnual({ fengshuiYear: 2022 }).annual.wuhuang, '中宮');
});

// ---------------------------------------------------------------- 設定開關(D38-D42)、警告與 findings

test('預設設定: sanshaArc=core3、不顯示夾煞、沒有 findings;meta.ruleset 回存實際設定', () => {
  const r = A.analyzeAnnual({ fengshuiYear: 2026 });
  assert.equal(r.sansha.arc.layer, 'core3');
  assert.deepEqual(r.sansha.arc.ranges, r.sansha.arcs.core3);
  assert.equal(r.sansha.showJiaSha, false);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.meta.ruleset, {
    yearBoundary: 'lichun_exact', yunSystem: 'san_yuan_9', sanshaArc: 'core3', extraShensha: false, showMinorityTechniques: false,
  });
});

test('D39 sanshaArc: core3(3 段)/withJia(75° 一段)/branch12(90° 一段)選出對應的弧,arcs 三層永遠都在', () => {
  const pick = (v) => A.analyzeAnnual({ fengshuiYear: 2026 }, { sanshaArc: v }).sansha;
  const core = pick('core3');
  const withJia = pick('withJia');
  const b12 = pick('branch12');
  assert.deepEqual(core.arc, { layer: 'core3', ranges: [[322.5, 337.5], [352.5, 7.5], [22.5, 37.5]] });
  assert.deepEqual(withJia.arc, { layer: 'withJiaSha', ranges: [[322.5, 37.5]] });
  assert.deepEqual(b12.arc, { layer: 'branch12', ranges: [[315, 45]] });
  for (const s of [core, withJia, b12]) assert.deepEqual(s.arcs, core.arcs);
  assert.deepEqual(A.analyzeAnnual({ fengshuiYear: 2026 }, { sanshaArc: 'branch12' }).meta.ruleset.sanshaArc, 'branch12');
  throwsCode(() => A.analyzeAnnual({ fengshuiYear: 2026 }, { sanshaArc: 'huge' }), 'INVALID_SETTING');
  throwsCode(() => A.sansha(0, { sanshaArc: 'withJiaSha' }), 'INVALID_SETTING');
});

test('D40 extraShensha: 開啟後 showJiaSha=true、附夾煞 finding(少數/低信心)與 extraShenshaPartial 警告;力士月煞不實作', () => {
  const r = A.analyzeAnnual({ fengshuiYear: 2026 }, { extraShensha: true });
  assert.equal(r.sansha.showJiaSha, true);
  assert.deepEqual(r.meta.warnings, ['extraShenshaPartial']);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.id, 'annual.sansha.jiasha');
  assert.deepEqual([f.tag, f.confidence, f.level], ['minority', 'low', 'note']);
  assert.ok(f.body.includes('壬') && f.body.includes('癸'));
  assert.deepEqual(Object.keys(f).sort(), ['body', 'confidence', 'id', 'level', 'refs', 'schoolNote', 'tag', 'title']);
  assert.ok(Array.isArray(f.refs) && f.refs.length > 0 && f.schoolNote.length > 0);
  assert.equal(r.meta.ruleset.extraShensha, true);
  assert.ok(!('lishi' in r.sansha) && !('yuesha' in r.sansha), '力士、月煞不實作');
});

test('showMinorityTechniques: 三煞宜向不宜坐只在開啟時出現,標少數與低信心', () => {
  assert.deepEqual(A.analyzeAnnual({ fengshuiYear: 2026 }).findings, []);
  const r = A.analyzeAnnual({ fengshuiYear: 2026 }, { showMinorityTechniques: true });
  assert.equal(r.findings.length, 1);
  assert.deepEqual([r.findings[0].id, r.findings[0].tag, r.findings[0].confidence], ['annual.sansha.facing_not_sitting', 'minority', 'low']);
  const both = A.analyzeAnnual({ fengshuiYear: 2026 }, { showMinorityTechniques: true, extraShensha: true });
  assert.equal(both.findings.length, 2);
  assert.equal(new Set(both.findings.map((x) => x.id)).size, 2);
});

test('D38 年界無開關: yearBoundary 不影響流年,但呼叫端給了別的年界會有 yearBoundaryIgnored 警告', () => {
  const t = cst('2026-02-04 00:00'); // 立春(04:02)前約 4 小時: 立春法屬 2025,日期法/元旦法屬 2026
  const base = A.analyzeAnnual({ instant: t });
  assert.equal(base.year.fengshuiYear, 2025);
  for (const yb of ['lichun_date_only', 'fixed_feb4', 'gregorian_jan1', 'lunar_new_year']) {
    const r = A.analyzeAnnual({ instant: t }, { yearBoundary: yb });
    assert.equal(r.year.fengshuiYear, 2025, yb);
    assert.deepEqual(r.meta.warnings, ['yearBoundaryIgnored'], yb);
    assert.equal(r.meta.ruleset.yearBoundary, 'lichun_exact', yb);
    assert.deepEqual({ ...r, meta: null }, { ...base, meta: null }, yb);
  }
  assert.deepEqual(A.analyzeAnnual({ instant: t }, { yearBoundary: 'lichun_exact' }).meta.warnings, []);
});

test('yunSystem: er_yuan_8 在 1996-2043 內照算(2026=九運第 10 年);範圍外運欄位為 null 並警告,飛星與神煞照常', () => {
  const inside = A.analyzeAnnual({ fengshuiYear: 2026 }, { yunSystem: 'er_yuan_8' });
  assert.deepEqual([inside.year.yun, inside.year.yunYear, inside.year.era], [9, 10, '下元']);
  assert.equal(inside.meta.ruleset.yunSystem, 'er_yuan_8');
  assert.deepEqual(inside.meta.warnings, []);
  const outside = A.analyzeAnnual({ fengshuiYear: 2050 }, { yunSystem: 'er_yuan_8' });
  assert.deepEqual([outside.year.yun, outside.year.yunYear], [null, null]);
  assert.equal(outside.year.era, '上元');
  assert.deepEqual(outside.meta.warnings, ['yunSystemOutOfRange']);
  assert.equal(outside.annual.center, A.annualCenter(2050));
  assert.equal(outside.sansha.dir, A.sansha(C.yearGanzhi(2050).branch).dir);
});

test('立春臨界: 距立春 ≤ 2 分鐘 → nearLichun 警告與 finding;3 分鐘外沒有', () => {
  const lc = C.lichun(2026);
  for (const d of [-2 * MIN, -1, 0, 1, MIN, 2 * MIN]) {
    const r = A.analyzeAnnual({ instant: lc + d });
    assert.ok(r.meta.warnings.includes('nearLichun'), `Δ${d}ms`);
    assert.equal(r.findings[0].id, 'annual.year.near_lichun');
    assert.equal(r.findings[0].level, 'caution');
  }
  for (const d of [-3 * MIN, 3 * MIN, -86400000]) {
    const r = A.analyzeAnnual({ instant: lc + d });
    assert.ok(!r.meta.warnings.includes('nearLichun'), `Δ${d}ms`);
    assert.deepEqual(r.findings, []);
  }
  assert.ok(!A.analyzeAnnual({ fengshuiYear: 2026 }).meta.warnings.includes('nearLichun'), '只給年份不判斷臨界');
});

test('支援年份外標 approx 與 approxRange 警告(1864-2150 內為 false)', () => {
  for (const fy of [1864, 2000, 2150]) {
    const r = A.analyzeAnnual({ fengshuiYear: fy });
    assert.equal(r.approx, false, `${fy}`);
    assert.ok(!r.meta.warnings.includes('approxRange'));
  }
  for (const fy of [1863, 1800, 2151, 2200]) {
    const r = A.analyzeAnnual({ fengshuiYear: fy });
    assert.equal(r.approx, true, `${fy}`);
    assert.ok(r.meta.warnings.includes('approxRange'));
    assert.equal(r.annual.center, A.annualCenter(fy));
    assert.deepEqual(Object.values(r.annual.chart).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
  const far = A.analyzeAnnual({ instant: cst('2200-06-15 12:00') });
  assert.equal(far.approx, true);
  assert.equal(far.year.fengshuiYear, 2200);
  throwsCode(() => A.analyzeAnnual({ fengshuiYear: 10000 }), 'YEAR_OUT_OF_RANGE');
});

// ---------------------------------------------------------------- 邊界輸入與錯誤碼

test('analyzeAnnual 輸入不合法: 丟出以錯誤碼開頭的 Error', () => {
  throwsCode(() => A.analyzeAnnual(), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual(null), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual([]), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual(2026), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual({}), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual({ fengshuiyear: 2026 }), 'INVALID_INPUT');
  throwsCode(() => A.analyzeAnnual({ instant: 0, fengshuiYear: 1970 }), 'INVALID_INPUT');
  for (const bad of [NaN, Infinity, '2026-01-01', null, {}]) throwsCode(() => A.analyzeAnnual({ instant: bad }), 'INVALID_INSTANT');
  for (const bad of [2026.5, '2026', NaN, null, Infinity]) throwsCode(() => A.analyzeAnnual({ fengshuiYear: bad }), 'INVALID_YEAR');
  throwsCode(() => A.analyzeAnnual({ fengshuiYear: 2026 }, { nonsense: 1 }), 'INVALID_SETTING');
});

test('個別函式輸入不合法: 各自的錯誤碼', () => {
  for (const bad of [NaN, 1.5, '2026', undefined]) throwsCode(() => A.annualCenter(bad), 'INVALID_YEAR');
  for (const bad of [0, 10, 1.5, NaN, '5', undefined]) {
    throwsCode(() => A.fly(bad), 'INVALID_STAR');
    throwsCode(() => A.flyByGua(bad), 'INVALID_STAR');
    throwsCode(() => A.palaceOfStar(bad, 5), 'INVALID_STAR');
    throwsCode(() => A.palaceOfStar(5, bad), 'INVALID_STAR');
  }
  throwsCode(() => A.wrap9(1.5), 'INVALID_STAR');
  for (const bad of [-1, 12, 1.5, '午午', 'x', null, undefined]) {
    throwsCode(() => A.monthlyCenter(bad, 0), 'INVALID_BRANCH');
    throwsCode(() => A.taisui(bad), 'INVALID_BRANCH');
    throwsCode(() => A.sansha(bad), 'INVALID_BRANCH');
  }
  for (const bad of [-1, 12, 1.5, '0', NaN, undefined]) throwsCode(() => A.monthlyCenter(0, bad), 'INVALID_MONTH_ORDER');
  throwsCode(() => A.monthlyTable(1.5), 'INVALID_YEAR');
  throwsCode(() => A.inArc(NaN, [0, 10]), 'INVALID_BEARING');
  throwsCode(() => A.inArc(0, [10]), 'INVALID_ARC');
  throwsCode(() => A.inArc(0, null), 'INVALID_ARC');
  throwsCode(() => A.inArc(0, [NaN, 10]), 'INVALID_BEARING');
});

test('地支可用字元或索引,結果相同;wrap9 對負數與大數正確', () => {
  for (let b = 0; b < 12; b++) {
    assert.deepEqual(A.taisui(b), A.taisui(BRANCH_CHARS[b]));
    assert.deepEqual(A.sansha(b), A.sansha(BRANCH_CHARS[b]));
  }
  assert.deepEqual([-18, -10, -1, 0, 1, 9, 10, 18, 19].map(A.wrap9), [9, 8, 8, 9, 1, 9, 1, 9, 1]);
});

test('inArc: 半開區間、跨 0 度、任意實數方位(負值與大於 360)', () => {
  assert.equal(A.inArc(322.5, [322.5, 37.5]), true);
  assert.equal(A.inArc(37.5, [322.5, 37.5]), false);
  assert.equal(A.inArc(0, [322.5, 37.5]), true);
  assert.equal(A.inArc(-10, [322.5, 37.5]), true);
  assert.equal(A.inArc(370, [322.5, 37.5]), true);
  assert.equal(A.inArc(180, [322.5, 37.5]), false);
  assert.equal(A.inArc(100, [90, 120]), true);
  assert.equal(A.inArc(120, [90, 120]), false);
  assert.equal(A.inArc(89.999, [90, 120]), false);
});

// ---------------------------------------------------------------- 純函式性質(規格 1.3、程式約定)

function assertJsonShape(v, at = '$') {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    assert.ok(Number.isFinite(v), `${at} 非有限數字`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertJsonShape(x, `${at}[${i}]`));
    return;
  }
  assert.equal(Object.getPrototypeOf(v), Object.prototype, `${at} 不是普通物件`);
  for (const [k, x] of Object.entries(v)) assertJsonShape(x, `${at}.${k}`);
}

test('輸出可 JSON 序列化(無 Date/Map/Set/函式/undefined/NaN),往返後 deepEqual', () => {
  const inputs = [
    [{ instant: cst('2026-09-29 12:00') }, {}],
    [{ fengshuiYear: 2026 }, { extraShensha: true, showMinorityTechniques: true, sanshaArc: 'withJia' }],
    [{ fengshuiYear: 2050 }, { yunSystem: 'er_yuan_8' }],
    [{ instant: C.lichun(2026) }, {}],
  ];
  for (const [inp, s] of inputs) {
    const r = A.analyzeAnnual(inp, s);
    assertJsonShape(r);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  }
  assertJsonShape(A.monthlyTable(2026));
  assertJsonShape(A.sansha(0));
  assertJsonShape(A.taisui(0));
  assertJsonShape(A.fly(3));
});

test('不修改傳入物件: 凍結輸入與設定不會丟 TypeError,結果與未凍結相同', () => {
  const inp = Object.freeze({ instant: cst('2026-09-29 12:00') });
  const set = Object.freeze({ sanshaArc: 'withJia', extraShensha: true });
  const frozen = A.analyzeAnnual(inp, set);
  assert.deepEqual(frozen, A.analyzeAnnual({ instant: cst('2026-09-29 12:00') }, { sanshaArc: 'withJia', extraShensha: true }));
  assert.deepEqual(set, { sanshaArc: 'withJia', extraShensha: true });
  assert.deepEqual(inp, { instant: cst('2026-09-29 12:00') });
});

test('修改回傳值不會污染內部表或下一次結果;常數表已凍結', () => {
  const first = A.analyzeAnnual({ fengshuiYear: 2026 });
  first.sansha.arcs.core3[0][0] = 999;
  first.sansha.arc.ranges[0][0] = 999;
  first.sansha.jiaSha.push('X');
  first.annual.chart['南'] = 0;
  first.taisui.branch = 'X';
  const second = A.analyzeAnnual({ fengshuiYear: 2026 });
  assert.deepEqual(second.sansha.arcs.core3[0], [322.5, 337.5]);
  assert.deepEqual(second.sansha.arc.ranges[0], [322.5, 337.5]);
  assert.deepEqual(second.sansha.jiaSha, ['壬', '癸']);
  assert.equal(second.annual.chart['南'], 5);
  assert.equal(second.taisui.branch, '午');
  for (const table of [A.PALACES, A.SANSHA_TABLE, A.MONTH_START_STAR, A.SANSHA_ARC_SETTINGS]) assert.ok(Object.isFrozen(table));
  assert.ok(Object.isFrozen(A.PALACES[0]) && Object.isFrozen(A.SANSHA_TABLE[0]) && Object.isFrozen(A.SANSHA_TABLE[0].jia));
});

test('決定性: 相同輸入兩次呼叫結果逐欄相同(無全域狀態)', () => {
  for (const fy of [1900, 2026, 2100]) {
    assert.deepEqual(A.analyzeAnnual({ fengshuiYear: fy }), A.analyzeAnnual({ fengshuiYear: fy }));
    assert.deepEqual(A.monthlyTable(fy), A.monthlyTable(fy));
  }
});

test('時間欄位皆為 ms epoch 數字,*CST 為 UTC+8 顯示字串並與 calendar.formatCST 一致', () => {
  const r = A.analyzeAnnual({ instant: cst('2026-09-29 12:00') });
  for (const k of ['lichun']) assert.ok(Number.isInteger(r.year[k]));
  for (const k of ['start', 'end']) assert.ok(Number.isInteger(r.month[k]));
  assert.equal(r.year.lichunCST, C.formatCST(r.year.lichun));
  assert.equal(r.month.startCST, C.formatCST(r.month.start));
  assert.equal(r.month.endCST, C.formatCST(r.month.end));
  for (const row of A.monthlyTable(2026)) {
    assert.ok(Number.isInteger(row.start) && Number.isInteger(row.end));
    assert.match(row.startCST, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  }
});

test('SCHEMA 與 meta.schema 為 fengshui.annual/1', () => {
  assert.equal(A.SCHEMA, 'fengshui.annual/1');
  assert.equal(A.analyzeAnnual({ fengshuiYear: 2026 }).meta.schema, A.SCHEMA);
});

// calendar 模組測試(規格 2.2、4.1、4.2、4.4)。fixtures 全部唯讀;附錄 B 中與 calendar 有關的補案以內嵌向量執行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, circDiff, assertRunnerCatches, isSoft } from './helpers/harness.js';
import * as C from '../src/core/calendar.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { VSOP_L, VSOP_R0 } from '../src/core/data/vsop87d_earth.js';

const annual = loadFixture('annual');
const xuankong = loadFixture('xuankong_core');
const bazhai = loadFixture('bazhai');

// ---------------------------------------------------------------- 共用小工具

const MIN = 60000;
const SUPPORTED_MIN = C.SUPPORTED_YEARS.min;
const DAY = 86400000;
const cst = (s) => C.toInstant({ local: s.replace(' ', 'T'), utcOffset: '+08:00' });
const wrap9 = (n) => (((n % 9) + 9) % 9 === 0 ? 9 : ((n % 9) + 9) % 9);

/** 軟斷言: confidence=low 的案例只要求不崩潰(規格 4.2 第 2 點);AssertionError 吞掉,其他例外照丟。 */
function hardOrSoft(c, runner) {
  if (!isSoft(c)) return runner(c);
  try {
    runner(c);
  } catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
  }
  return undefined;
}

function throwsCode(fn, code) {
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
}

/** 可重現的偽亂數(mulberry32)。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 各類 fixtures 的 runner(失敗即丟 AssertionError)

function runSolarTerm(c) {
  const { year, term, termIndex } = c.input;
  assert.equal(C.TERM_NAMES[termIndex], term, `${c.name}: 節氣名稱與索引不符`);
  assert.equal(C.formatCST(Date.parse(c.expected.utc)), c.expected.cst, `${c.name}: fixture 內 cst 與 utc 不自洽`);
  const ms = C.termInstant(year, termIndex);
  const dmin = (ms - Date.parse(c.expected.utc)) / MIN;
  assert.ok(Math.abs(dmin) <= c.toleranceMinutes, `${c.name}: 與期望差 ${dmin.toFixed(3)} 分,容差 ${c.toleranceMinutes}`);
}

function runLongitude(c) {
  const lon = C.solarLongitude(C.termInstant(c.input.year, c.input.termIndex));
  assert.ok(circDiff(lon, c.expected.apparentLongitudeDeg) <= c.toleranceDeg, `${c.name}: 黃經 ${lon}`);
}

function runFengshuiYearAt(c) {
  const fy = C.fengshuiYear(cst(c.input.instantCST));
  assert.equal(fy, c.expected.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(C.yearGanzhi(fy).name, c.expected.ganzhi, `${c.name}: 干支年`);
}

function runAnnualCenterStar(c) {
  const fy = c.input.fengshuiYear;
  const n = C.nineYun(fy);
  assert.equal(C.yearGanzhi(fy).name, c.expected.ganzhi, `${c.name}: 干支年`);
  assert.deepEqual([n.yun, n.yunYear, n.era], [c.expected.yun, c.expected.yunYear, c.expected.yuan], `${c.name}: 元運`);
}

function runMonthly(c) {
  const ms = cst(c.input.instantCST);
  const E = c.expected;
  const fy = C.fengshuiYear(ms);
  const mo = C.monthOf(ms);
  assert.equal(fy, E.fengshuiYear, `${c.name}: 風水年`);
  assert.equal(mo.jieName, E.jie, `${c.name}: 節`);
  assert.equal(mo.name, E.monthGanzhi, `${c.name}: 月柱`);
  assert.equal(mo.order, E.monthOrder, `${c.name}: 月序`);
  if (E.startCST) {
    const tol = c.toleranceMinutes ?? 2;
    assert.ok(Math.abs(mo.start - cst(E.startCST)) / MIN <= tol, `${c.name}: 月初 ${C.formatCST(mo.start)} vs ${E.startCST}`);
    assert.ok(Math.abs(mo.end - cst(E.endCST)) / MIN <= tol, `${c.name}: 月末 ${C.formatCST(mo.end)} vs ${E.endCST}`);
  }
  // 月中宮公式 [8,5,2][年支%3]-月序 屬 annual;這裡只拿它反查 calendar 給出的年支與月序是否正確。
  assert.equal(wrap9([8, 5, 2][C.yearGanzhi(fy).branch % 3] - mo.order), E.monthlyCenter, `${c.name}: 由年支/月序反推的月中宮`);
}

function runNineYunAt(c) {
  const ms = cst(c.input.instantCST);
  const fy = C.fengshuiYear(ms);
  const n = C.nineYun(fy);
  assert.equal(fy, c.expected.fengshuiYear, `${c.name}: 風水年`);
  assert.deepEqual([n.yun, n.yunYear, n.era], [c.expected.yun, c.expected.yunYear, c.expected.yuan], `${c.name}: 元運`);
}

function runYunOfDatetime(c) {
  const r = C.yunOfInstant(cst(c.input.datetime_cst), { yunSystem: c.input.system, boundary: c.input.boundary });
  assert.equal(r.yun, c.expected.yun, `${c.name}: 運`);
}

function runLichunTable({ year, cst: cstStr }) {
  const expected = Date.parse(`${cstStr.replace(' ', 'T')}+08:00`);
  const diffSec = Math.abs(C.lichun(year) - expected) / 1000;
  assert.ok(diffSec <= 120, `${year} 立春差 ${diffSec.toFixed(1)} 秒 > 120`);
  return diffSec;
}

const byType = (t) => annual.cases.filter((c) => c.type === t);

// ---------------------------------------------------------------- annual.json 屬於 calendar 的類別

const ANNUAL_RUNNERS = [
  ['solar_term_time', runSolarTerm, 49],
  ['solar_longitude_at_instant', runLongitude, 3],
  ['fengshui_year_at', runFengshuiYearAt, 27],
  ['annual_center_star', runAnnualCenterStar, 34],
  ['monthly_flying_star', runMonthly, 27],
  ['nine_yun_at', runNineYunAt, 8],
];

for (const [type, runner, count] of ANNUAL_RUNNERS) {
  test(`annual.json ${type}: 案例數符合 meta.counts(${count})`, () => {
    assert.equal(byType(type).length, count);
    assert.equal(annual.meta.counts[type], count);
  });
  for (const c of byType(type)) {
    test(`annual.json ${type}: ${c.name}`, () => hardOrSoft(c, runner));
  }
}

// ---------------------------------------------------------------- xuankong_core.json yun_of_datetime

const yunCases = xuankong.cases.filter((c) => c.type === 'yun_of_datetime');
test('xuankong_core.json yun_of_datetime: 22 案', () => assert.equal(yunCases.length, 22));
for (const c of yunCases) {
  test(`xuankong_core.json yun_of_datetime: ${c.name}`, () => hardOrSoft(c, runYunOfDatetime));
}

// ---------------------------------------------------------------- bazhai.json 立春交叉表(201 年,差 ≤ 120 秒)

const lichunTable = bazhai.meta.lichun_cst_1900_2100;
test('bazhai.json lichun_cst_1900_2100: 201 年皆與 calendar 相差 ≤ 120 秒', (t) => {
  const years = Object.keys(lichunTable).map(Number);
  assert.equal(years.length, 201);
  assert.deepEqual([years[0], years[200]], [1900, 2100]);
  let max = { sec: 0, year: 0 };
  for (const year of years) {
    const sec = runLichunTable({ year, cst: lichunTable[year] });
    if (sec > max.sec) max = { sec, year };
  }
  t.diagnostic(`最大差 ${max.sec.toFixed(1)} 秒(${max.year} 年)`);
  assert.ok(max.sec <= 120);
});

// ---------------------------------------------------------------- 突變測試(規格 4.2 第 3 點)

const clone = (c) => structuredClone(c);
const firstOf = (list, pred = () => true) => list.find(pred);

test('突變: solar_term_time 期望值錯 10 分鐘會被抓出', () => {
  const bad = clone(firstOf(byType('solar_term_time')));
  bad.expected.utc = new Date(Date.parse(bad.expected.utc) + 10 * MIN).toISOString().replace('.000Z', 'Z');
  assertRunnerCatches(runSolarTerm, bad);
});
test('突變: solar_longitude 期望黃經錯 1 度會被抓出', () => {
  const bad = clone(byType('solar_longitude_at_instant')[0]);
  bad.expected.apparentLongitudeDeg += 1;
  assertRunnerCatches(runLongitude, bad);
});
test('突變: fengshui_year_at 風水年錯 1 年會被抓出', () => {
  const bad = clone(byType('fengshui_year_at')[0]);
  bad.expected.fengshuiYear += 1;
  assertRunnerCatches(runFengshuiYearAt, bad);
});
test('突變: fengshui_year_at 干支錯字會被抓出', () => {
  const bad = clone(byType('fengshui_year_at')[0]);
  bad.expected.ganzhi = '甲子';
  assertRunnerCatches(runFengshuiYearAt, bad);
});
test('突變: annual_center_star 元運錯 1 運會被抓出', () => {
  const bad = clone(byType('annual_center_star')[0]);
  bad.expected.yun = (bad.expected.yun % 9) + 1;
  assertRunnerCatches(runAnnualCenterStar, bad);
});
test('突變: monthly 月柱與月序錯會被抓出', () => {
  const a = clone(byType('monthly_flying_star')[0]);
  a.expected.monthGanzhi = '甲子';
  assertRunnerCatches(runMonthly, a);
  const b = clone(byType('monthly_flying_star')[0]);
  b.expected.monthOrder += 1;
  assertRunnerCatches(runMonthly, b);
});
test('突變: monthly 月初時刻錯 10 分鐘會被抓出', () => {
  const bad = clone(firstOf(byType('monthly_flying_star'), (c) => c.expected.startCST));
  bad.expected.startCST = C.formatCST(cst(bad.expected.startCST) + 10 * MIN);
  assertRunnerCatches(runMonthly, bad);
});
test('突變: nine_yun_at 運年錯會被抓出', () => {
  const bad = clone(byType('nine_yun_at')[0]);
  bad.expected.yunYear += 1;
  assertRunnerCatches(runNineYunAt, bad);
});
test('突變: yun_of_datetime 運錯會被抓出', () => {
  const bad = clone(yunCases[0]);
  bad.expected.yun += 1;
  assertRunnerCatches(runYunOfDatetime, bad);
});
test('突變: 立春交叉表差 5 分鐘會被抓出', () => {
  const year = 2026;
  const bad = { year, cst: C.formatCST(C.lichun(year) + 5 * MIN, true) };
  assertRunnerCatches(runLichunTable, bad);
});
test('hardOrSoft: 低信心案例吞 AssertionError,其他例外照丟', () => {
  const low = { confidence: 'low' };
  hardOrSoft(low, () => assert.equal(1, 2));
  assert.throws(() => hardOrSoft(low, () => { throw new TypeError('x'); }), TypeError);
  assert.throws(() => hardOrSoft({ confidence: 'high' }, () => assert.equal(1, 2)), assert.AssertionError);
});

// ---------------------------------------------------------------- 與參考實作逐項一致(規格 2.2.1 直接採用)

function loadReference() {
  const mod = { exports: {} };
  new Function('module', 'exports', annual.meta.referenceImplementation.source)(mod, mod.exports);
  return mod.exports;
}
const REF = loadReference();

test('參考實作抽出無誤: 三個節氣函式與 API 名稱存在', () => {
  for (const k of ['termInstant', 'monthOf', 'fengshuiYear', 'nineYun', 'formatCST']) assert.equal(typeof REF[k], 'function');
});

test('內嵌 VSOP87D 表 == 參考實作原文的表(規格 4.2 第 6 點)', () => {
  const src = annual.meta.referenceImplementation.source;
  const grab = (re) => new Function(`return ${re.exec(src)[1].replace(/\/\/.*$/gm, '')}`)();
  assert.deepEqual(VSOP_L, grab(/var VSOP_L = (\[[\s\S]*?\n {2}\]);/));
  assert.deepEqual(VSOP_R0, grab(/var VSOP_R0 = (\[\[.*?\]\]);/));
});

test('VSOP 表形狀與截斷規則 A*0.1^k >= 1e-6 rad', () => {
  assert.deepEqual(VSOP_L.map((tab) => tab.length), [33, 3, 1]);
  VSOP_L.forEach((tab, k) => {
    for (const [A, B, Cc] of tab) {
      assert.ok(A * 0.1 ** k >= 1e-6 - 1e-15, `T^${k} 項 A=${A} 低於截斷門檻`);
      assert.ok(Number.isFinite(B) && Number.isFinite(Cc));
    }
  });
  assert.ok(Object.isFrozen(VSOP_L) && Object.isFrozen(VSOP_L[0]) && Object.isFrozen(VSOP_L[0][0]));
});

test('1900-2100 全部 4824 個節氣與參考實作逐 ms 相同', () => {
  let n = 0;
  for (let y = 1900; y <= 2100; y++) {
    for (let i = 0; i < 24; i++) {
      assert.equal(C.termInstant(y, i), REF.termInstant(y, i), `${y} 年 ${C.TERM_NAMES[i]}`);
      n++;
    }
  }
  assert.equal(n, 4824);
});

test('1864-1899 與 2101-2150 的節氣也與參考實作相同(ΔT 夾值/多項式同源)', () => {
  for (const y of [1864, 1884, 1899, 2101, 2120, 2149]) {
    for (let i = 0; i < 24; i++) assert.equal(C.termInstant(y, i), REF.termInstant(y, i), `${y}/${i}`);
  }
});

test('隨機瞬間: fengshuiYear / monthOf / yearGanzhi / nineYun / formatCST 與參考實作相同', () => {
  const rnd = rng(20260929);
  for (let n = 0; n < 400; n++) {
    const ms = Date.UTC(1900, 0, 1) + Math.floor(rnd() * (Date.UTC(2100, 11, 31) - Date.UTC(1900, 0, 1)));
    assert.equal(C.fengshuiYear(ms), REF.fengshuiYear(ms));
    const a = C.monthOf(ms);
    const b = REF.monthOf(ms);
    for (const k of ['jieName', 'start', 'end', 'branch', 'order', 'stem', 'name']) assert.equal(a[k], b[k], `${k} @ ${ms}`);
    const fy = C.fengshuiYear(ms);
    assert.deepEqual(C.yearGanzhi(fy), REF.yearGanzhi(fy));
    const y1 = C.nineYun(fy);
    const y2 = REF.nineYun(fy);
    assert.deepEqual([y1.yun, y1.yunYear, y1.era], [y2.yun, y2.yunYear, y2.yuan]);
    assert.equal(C.formatCST(ms), REF.formatCST(ms));
    assert.equal(C.formatCST(ms, true), REF.formatCST(ms, true));
  }
});

// ---------------------------------------------------------------- 規格 2.2 的具體數值與範例

test('2026 立春 04:01:50 CST(四捨五入 04:02),不是硬編的 04:01:51', () => {
  const lc = C.lichun(2026);
  assert.equal(C.formatCST(lc), '2026-02-04 04:02');
  assert.equal(C.formatCST(lc, true), '2026-02-04 04:01:50');
});

test('立春顯示四捨五入到分而非截斷', () => {
  assert.equal(C.formatCST(cst('2026-02-04 04:01') + 29 * 1000), '2026-02-04 04:01');
  assert.equal(C.formatCST(cst('2026-02-04 04:01') + 30 * 1000), '2026-02-04 04:02');
  assert.equal(C.formatCST(cst('2026-02-04 04:01') + 31 * 1000), '2026-02-04 04:02');
});

test('取代舊硬編表: 1864/1884/2044 立春由 calendar 算出(附錄 A XC-3)', () => {
  assert.equal(C.formatCST(C.lichun(1864), true), '1864-02-04 20:11:45');
  assert.equal(C.formatCST(C.lichun(1884), true), '1884-02-04 16:49:12');
  assert.equal(C.formatCST(C.lichun(2044), true), '2044-02-04 12:44:06');
});

test('規格 2.2.4 輸出範例 analyze(2026-09-29 12:00 CST)', () => {
  const a = C.analyze(cst('2026-09-29 12:00'));
  assert.equal(a.fengshuiYear, 2026);
  assert.equal(a.yearGanzhi, '丙午');
  assert.equal(a.lichunCST, '2026-02-04 04:02');
  assert.equal(a.month.jieName, '白露');
  assert.equal(a.month.name, '丁酉');
  assert.equal(a.month.order, 7);
  assert.equal(a.month.startCST, '2026-09-07 22:41');
  assert.equal(a.month.endCST, '2026-10-08 14:30');
  assert.deepEqual(a.yun, { yun: 9, yunYear: 3, era: '下元' });
  assert.equal(a.approx, false);
  assert.equal(a.meta.schema, 'fengshui.calendar/1');
  assert.deepEqual(a.meta.ruleset, { yearBoundary: 'lichun_exact', yunSystem: 'san_yuan_9' });
});

test('九運 2024-02-04 起,2044 年立春(02-04 12:44)前的 2044-02-03 全日與 02-04 上午仍是九運', () => {
  assert.equal(C.yunOfInstant(cst('2024-02-04 16:00')).yun, 8);
  assert.equal(C.yunOfInstant(cst('2024-02-04 17:00')).yun, 9);
  for (const t of ['2044-02-03 00:00', '2044-02-03 23:59', '2044-02-04 10:00', '2044-02-04 12:43']) {
    assert.equal(C.yunOfInstant(cst(t)).yun, 9, t);
  }
  const after = C.yunOfInstant(cst('2044-02-04 12:45'));
  assert.deepEqual([after.yun, after.yunYear, after.era], [1, 1, '上元']);
});

test('交運年立春不一定在 2/4: 1904/1924/1944/1964 在 2/5,1984 立春距跨日僅約 41 分鐘', () => {
  for (const y of [1904, 1924, 1944, 1964]) assert.equal(C.formatCST(C.lichun(y)).slice(0, 10), `${y}-02-05`, String(y));
  const lc = C.lichun(1984);
  assert.equal(C.formatCST(lc).slice(0, 10), '1984-02-04');
  const toMidnight = (Date.UTC(1984, 1, 5) - 8 * 3600e3 - lc) / MIN;
  assert.ok(toMidnight > 38 && toMidnight < 44, `距跨日 ${toMidnight.toFixed(1)} 分`);
});

test('nineYun 邊界: 1863→九運 20 年、1864→一運 1 年、2043→九運 20 年、2044→一運 1 年', () => {
  const at = (fy) => { const n = C.nineYun(fy); return [n.yun, n.yunYear, n.era]; };
  assert.deepEqual(at(1863), [9, 20, '下元']);
  assert.deepEqual(at(1864), [1, 1, '上元']);
  assert.deepEqual(at(1923), [3, 20, '上元']);
  assert.deepEqual(at(1924), [4, 1, '中元']);
  assert.deepEqual(at(1984), [7, 1, '下元']);
  assert.deepEqual(at(2024), [9, 1, '下元']);
  assert.deepEqual(at(2043), [9, 20, '下元']);
  assert.deepEqual(at(2044), [1, 1, '上元']);
});

test('干支年已知錨點: 1864/1984/2044 甲子、1900/2020 庚子、2000 庚辰、2024 甲辰、2026 丙午', () => {
  const names = Object.fromEntries([1864, 1984, 2044, 1900, 2020, 2000, 2024, 2026].map((y) => [y, C.yearGanzhi(y).name]));
  assert.deepEqual(names, { 1864: '甲子', 1984: '甲子', 2044: '甲子', 1900: '庚子', 2020: '庚子', 2000: '庚辰', 2024: '甲辰', 2026: '丙午' });
  assert.equal(C.yearGanzhi(4).name, '甲子');
  assert.equal(C.yearGanzhi(-56).name, '甲子');
});

// ---------------------------------------------------------------- 附錄 B: 與 calendar 有關的補案(fixtures 唯讀,向量內嵌)

// B.2 monthly 補案(辰戌丑未年起始 5 組、丑月屬上一風水年)與月柱五虎遁: [輸入 CST, 風水年, 年柱, 月柱, 月中宮]
const B2_MONTHLY = [
  ['2024-02-20 12:00', 2024, '甲辰', '丙寅', 5],
  ['2024-03-20 12:00', 2024, '甲辰', '丁卯', 4],
  ['2024-07-20 12:00', 2024, '甲辰', '辛未', 9],
  ['2025-01-20 12:00', 2024, '甲辰', '丁丑', 3],
  ['2027-02-20 12:00', 2027, '丁未', '壬寅', 5],
  ['2027-07-20 12:00', 2027, '丁未', '丁未', 9],
  ['2028-01-20 12:00', 2027, '丁未', '癸丑', 3],
  ['2021-02-20 12:00', 2021, '辛丑', '庚寅', 5],
  ['2030-02-20 12:00', 2030, '庚戌', '戊寅', 5],
];
for (const [at, fy, yearName, monthName, center] of B2_MONTHLY) {
  test(`附錄 B.2 monthly_${at.slice(0, 10)}`, () => {
    const ms = cst(at);
    assert.equal(C.fengshuiYear(ms), fy);
    assert.equal(C.yearGanzhi(fy).name, yearName);
    const mo = C.monthOf(ms);
    assert.equal(mo.name, monthName);
    assert.equal(wrap9([8, 5, 2][C.yearGanzhi(fy).branch % 3] - mo.order), center);
  });
}

const B2_MONTH_STEM = [[2024, '丙寅', '甲辰'], [2028, '甲寅', '戊申'], [2029, '丙寅', '己酉'], [2023, '甲寅', '癸卯'], [2022, '壬寅', '壬寅']];
for (const [y, monthName, yearName] of B2_MONTH_STEM) {
  test(`附錄 B.2 month_stem_${y}(${yearName}年寅月 ${monthName})`, () => {
    const ms = cst(`${y}-02-20 12:00`);
    assert.equal(C.yearGanzhi(C.fengshuiYear(ms)).name, yearName);
    assert.equal(C.monthOf(ms).name, monthName);
  });
}

// B.1 minggua 補案的 calendar 部分(命卦本身屬 bazhai): 1938-1945 +09:00 換算與立春日不知時刻
test('附錄 B.1 minggua_birth_1940-02-05T0800_+0900: 換算 07:00 CST 早於立春 07:07 → 有效年 1939', () => {
  const ms = C.toInstant({ local: '1940-02-05T08:00:00', utcOffset: '+09:00' });
  assert.equal(C.formatCST(ms), '1940-02-05 07:00');
  assert.equal(C.fengshuiYear(ms), 1939);
  // 誤當 +08:00 會得 1940,這是補案要防的錯
  assert.equal(C.fengshuiYear(C.toInstant({ local: '1940-02-05T08:00:00', utcOffset: '+08:00' })), 1940);
  assert.equal(C.formatCST(C.lichun(1940), true), '1940-02-05 07:07:10');
});
test('附錄 B.1 minggua_birth_1940-02-05T0830_+0900: 07:30 CST 晚於立春 → 有效年 1940', () => {
  const ms = C.toInstant({ local: '1940-02-05T08:30:00', utcOffset: '+09:00' });
  assert.equal(C.formatCST(ms), '1940-02-05 07:30');
  assert.equal(C.fengshuiYear(ms), 1940);
});
test('附錄 B.1 minggua_birth_2000-02-04_timeUnknown: 立春日不知時刻 → 立春前 1999 / 立春後 2000 兩種結果', () => {
  const ms = C.toInstant({ local: '2000-02-04', utcOffset: '+08:00' });
  const f = C.lichunFlags(ms, false);
  assert.equal(f.dateIsLichunDay, true);
  assert.equal(f.nearLichun, false);
  assert.deepEqual(f.alternatives.map((a) => [a.side, a.fengshuiYear, a.ganzhi]), [
    ['beforeLichun', 1999, '己卯'],
    ['afterLichun', 2000, '庚辰'],
  ]);
  assert.equal(C.formatCST(f.lichun), '2000-02-04 20:40');
  assert.equal(f.minutesFromLichun, null);
});
test('附錄 B.1: 非立春日不知時刻 → 無旗標、無 alternatives', () => {
  for (const d of ['2000-02-03', '2000-02-05', '2026-06-01']) {
    const f = C.lichunFlags(C.toInstant({ local: d, utcOffset: '+08:00' }), false);
    assert.equal(f.dateIsLichunDay, false, d);
    assert.deepEqual(f.alternatives, [], d);
  }
});

// ---------------------------------------------------------------- 邊界情況(規格 2.2.5)

test('立春前一秒與後一秒換年,且以 ms 比較(前 1 ms 仍是舊年)', () => {
  for (const y of [1984, 2000, 2021, 2026, 2044]) {
    const lc = C.lichun(y);
    assert.equal(C.fengshuiYear(lc - 1000), y - 1, `${y} -1s`);
    assert.equal(C.fengshuiYear(lc - 1), y - 1, `${y} -1ms`);
    assert.equal(C.fengshuiYear(lc), y, `${y} +0`);
    assert.equal(C.fengshuiYear(lc + 1000), y, `${y} +1s`);
  }
});

test('1 月出生屬上一風水年(丑月)', () => {
  const ms = cst('2025-01-15 12:00');
  assert.equal(C.fengshuiYear(ms), 2024);
  assert.equal(C.monthOf(ms).name, '丁丑');
  assert.equal(C.monthOf(ms).order, 11);
});

test('12/31 UTC 但已是 1/1 CST: 立春法仍屬上一年,元旦法屬新年', () => {
  const ms = Date.UTC(2020, 11, 31, 17, 0);
  assert.equal(C.formatCST(ms), '2021-01-01 01:00');
  assert.equal(C.fengshuiYear(ms), 2020);
  assert.equal(C.fengshuiYear(ms, { yearBoundary: 'gregorian_jan1' }), 2021);
});

test('2022 立春 CST 是 02-04 但 UTC 是 02-03(04:51 CST = 前一日 20:51 UTC): 換年仍正確', () => {
  const lc = C.lichun(2022);
  assert.ok(Math.abs(lc - cst('2022-02-04 04:51')) <= MIN, C.formatCST(lc, true)); // 官方表四捨五入,容差 1 分
  assert.equal(new Date(lc).toISOString().slice(0, 10), '2022-02-03');
  assert.equal(C.fengshuiYear(lc - 1), 2021);
  assert.equal(C.fengshuiYear(lc), 2022);
  const lc2021 = C.lichun(2021); // 2021-02-03 22:59 CST,立春日不在 2/4
  assert.ok(Math.abs(lc2021 - cst('2021-02-03 22:59')) <= MIN, C.formatCST(lc2021, true));
  assert.equal(C.fengshuiYear(lc2021 - 1), 2020);
  assert.equal(C.fengshuiYear(lc2021), 2021);
});

// ---------------------------------------------------------------- 年界開關 D10(其餘制式)

test('lichun_date_only: 立春日全天算新年(只比日期)', () => {
  const s = { yearBoundary: 'lichun_date_only' };
  assert.equal(C.fengshuiYear(cst('2026-02-04 00:30'), s), 2026);
  assert.equal(C.fengshuiYear(cst('2026-02-04 00:30')), 2025); // 精確法在立春 04:02 之前
  assert.equal(C.fengshuiYear(cst('2026-02-03 23:59'), s), 2025);
  assert.equal(C.fengshuiYear(cst('2000-02-04 12:00'), s), 2000); // 2000 立春 20:40
  assert.equal(C.fengshuiYear(cst('2000-02-04 12:00')), 1999);
  assert.equal(C.fengshuiYear(cst('1984-02-04 23:59'), s), 1984);
  assert.equal(C.fengshuiYear(cst('1964-02-04 12:00'), s), 1963); // 1964 立春在 02-05
  assert.equal(C.fengshuiYear(cst('1964-02-05 00:10'), s), 1964);
});

test('fixed_feb4: 每年 2 月 4 日 00:00 CST 換年', () => {
  const s = { yearBoundary: 'fixed_feb4' };
  assert.equal(C.fengshuiYear(cst('2026-02-03 23:59'), s), 2025);
  assert.equal(C.fengshuiYear(cst('2026-02-04 00:00'), s), 2026);
  assert.equal(C.fengshuiYear(cst('1964-02-04 12:00'), s), 1964); // 與精確法不同(立春 02-05)
  assert.equal(C.fengshuiYear(cst('1964-02-04 12:00')), 1963);
});

test('gregorian_jan1: 元旦換年', () => {
  const s = { yearBoundary: 'gregorian_jan1' };
  assert.equal(C.fengshuiYear(cst('2026-01-01 00:00'), s), 2026);
  assert.equal(C.fengshuiYear(cst('2025-12-31 23:59'), s), 2025);
  assert.equal(C.fengshuiYear(cst('2026-01-15 12:00'), s), 2026);
  assert.equal(C.fengshuiYear(cst('2026-01-15 12:00')), 2025);
});

test('年界分歧量化: 1950-2050 逐日中午出生,立春法對元旦法約 9.44% 的日子不同(規格 2.2.3 第 7 點)', (t) => {
  let days = 0;
  let diff = 0;
  for (let ms = cst('1950-01-01 12:00'); ms <= cst('2050-12-31 12:00'); ms += DAY) {
    days++;
    if (C.fengshuiYear(ms) !== C.fengshuiYear(ms, { yearBoundary: 'gregorian_jan1' })) diff++;
  }
  const pct = (100 * diff) / days;
  t.diagnostic(`${diff}/${days} = ${pct.toFixed(3)}%`);
  assert.ok(Math.abs(pct - 9.44) < 0.02, `分歧 ${pct.toFixed(3)}%`);
});

test('lunar_new_year 需農曆庫: 丟 LUNAR_LIBRARY_REQUIRED(規格 U-19)', () => {
  throwsCode(() => C.fengshuiYear(cst('2026-06-01 12:00'), { yearBoundary: 'lunar_new_year' }), 'LUNAR_LIBRARY_REQUIRED');
});

test('yearBoundary 與 settings 驗證: 未知值/未知鍵丟 INVALID_SETTING;預設值取自 DEFAULT_SETTINGS', () => {
  throwsCode(() => C.fengshuiYear(0, { yearBoundary: 'nope' }), 'INVALID_SETTING');
  throwsCode(() => C.fengshuiYear(0, { yearBoundry: 'lichun_exact' }), 'INVALID_SETTING');
  throwsCode(() => C.nineYun(2000, { yunSystem: 'nope' }), 'INVALID_SETTING');
  const ms = cst('2026-02-04 03:00');
  assert.equal(C.fengshuiYear(ms), C.fengshuiYear(ms, { yearBoundary: DEFAULT_SETTINGS.yearBoundary }));
  assert.deepEqual(C.nineYun(2020), C.nineYun(2020, { yunSystem: DEFAULT_SETTINGS.yunSystem }));
});

// ---------------------------------------------------------------- D12 二元八運、D13 交運界線

test('二元八運(D12): 八運 1996-2016、九運 2017-2043;2017-2023 建成者由八運變九運', () => {
  const er = { yunSystem: 'er_yuan_8' };
  assert.deepEqual([C.nineYun(1996, er).yun, C.nineYun(1996, er).yunYear], [8, 1]);
  assert.deepEqual([C.nineYun(2016, er).yun, C.nineYun(2016, er).yunYear], [8, 21]);
  assert.deepEqual([C.nineYun(2017, er).yun, C.nineYun(2017, er).yunYear], [9, 1]);
  assert.deepEqual([C.nineYun(2043, er).yun, C.nineYun(2043, er).yunYear], [9, 27]);
  for (let fy = 2017; fy <= 2023; fy++) {
    assert.equal(C.nineYun(fy).yun, 8, `三元 ${fy}`);
    assert.equal(C.nineYun(fy, er).yun, 9, `二元 ${fy}`);
  }
  throwsCode(() => C.nineYun(1995, er), 'YUN_SYSTEM_RANGE');
  throwsCode(() => C.nineYun(2044, er), 'YUN_SYSTEM_RANGE');
  assert.equal(C.yunOfInstant(cst('2020-06-01 12:00'), er).yun, 9);
});

test('交運界線(D13)固定為立春精確瞬間: yunOfInstant 不受 yearBoundary 影響,gregorian_year 僅供對照', () => {
  const ms = cst('2024-01-15 12:00');
  const r = C.yunOfInstant(ms);
  assert.deepEqual([r.year, r.yun, r.boundary], [2023, 8, 'lichun']);
  const g = C.yunOfInstant(ms, { boundary: 'gregorian_year' });
  assert.deepEqual([g.year, g.yun, g.boundary], [2024, 9, 'gregorian_year']);
  throwsCode(() => C.yunOfInstant(ms, { boundary: 'nope' }), 'INVALID_SETTING');
  // analyze 的 yun 也固定用立春精確瞬間,風水年才跟著 yearBoundary
  const a = C.analyze(cst('2000-02-04 12:00'), { yearBoundary: 'fixed_feb4' });
  assert.equal(a.fengshuiYear, 2000);
  assert.deepEqual([a.yun.yun, a.yun.yunYear], [7, 16]); // 立春 20:40 前仍是 1999 年
  assert.deepEqual(a.meta.ruleset, { yearBoundary: 'fixed_feb4', yunSystem: 'san_yuan_9' });
});

// ---------------------------------------------------------------- 臨界旗標

test('nearLichun: 立春前後 ≤ 2 分鐘為真,含恰好 2 分鐘,超過 1 ms 為假', () => {
  const lc = C.lichun(2026);
  for (const d of [0, 1000, -1000, 60000, -60000, 2 * MIN, -2 * MIN]) {
    assert.equal(C.lichunFlags(lc + d, true).nearLichun, true, `d=${d}`);
  }
  for (const d of [2 * MIN + 1, -2 * MIN - 1, 3 * MIN, -10 * MIN, 12 * 3600e3]) {
    assert.equal(C.lichunFlags(lc + d, true).nearLichun, false, `d=${d}`);
  }
  assert.equal(C.lichunFlags(lc + 90000, true).minutesFromLichun, 1.5);
  assert.deepEqual(C.lichunFlags(lc + 90000, true).alternatives, []);
  assert.ok(C.analyze(lc + 30000).meta.warnings.includes('nearLichun'));
  assert.ok(!C.analyze(lc + 30 * MIN).meta.warnings.includes('nearLichun'));
});

test('HKO 2024 立春 16:27: 該分鐘出生標臨界', () => {
  assert.equal(C.lichunFlags(cst('2024-02-04 16:27'), true).nearLichun, true);
  assert.equal(C.lichunFlags(cst('2024-02-04 16:00'), true).nearLichun, false);
});

// ---------------------------------------------------------------- toInstant / formatCST / utcOffsetFor

test('toInstant: +09:00 的當地時間比 +08:00 早 1 小時,Z 與 -05:00 換算正確', () => {
  const base = Date.UTC(1940, 1, 5, 0, 0);
  assert.equal(C.toInstant({ local: '1940-02-05T08:00', utcOffset: '+08:00' }), base);
  assert.equal(C.toInstant({ local: '1940-02-05T08:00', utcOffset: '+09:00' }), base - 3600e3);
  assert.equal(C.toInstant({ local: '1940-02-05T00:00', utcOffset: 'Z' }), base);
  assert.equal(C.toInstant({ local: '1940-02-04T19:00', utcOffset: '-05:00' }), base);
  assert.equal(C.toInstant({ local: '1940-02-05T05:30', utcOffset: '+05:30' }), base);
  assert.equal(C.toInstant({ local: '1940-02-05 08:00:30', utcOffset: '+0800' }), base + 30000);
});

test('toInstant: 純日期取當地正午(不知時刻)', () => {
  assert.equal(C.toInstant({ local: '2000-02-04', utcOffset: '+08:00' }), Date.UTC(2000, 1, 4, 4, 0));
  assert.equal(C.toInstant({ local: '1940-02-05', utcOffset: '+09:00' }), Date.UTC(1940, 1, 5, 3, 0));
});

test('toInstant / formatCST 往返(隨機 500 個當地分鐘 × 5 種偏移)', () => {
  const rnd = rng(7);
  const offsets = [['+08:00', 8 * 60], ['+09:00', 9 * 60], ['-05:00', -5 * 60], ['+05:45', 5 * 60 + 45], ['Z', 0]];
  for (let n = 0; n < 500; n++) {
    const y = 1900 + Math.floor(rnd() * 250);
    const local = `${String(y).padStart(4, '0')}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}T${String(Math.floor(rnd() * 24)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`;
    const [off, offMin] = offsets[n % offsets.length];
    const ms = C.toInstant({ local, utcOffset: off });
    // 把瞬間換到該偏移的牆上時間: CST 顯示 + (偏移 - 8h)
    assert.equal(C.formatCST(ms + (offMin - 480) * MIN).replace(' ', 'T'), local, `${local} ${off}`);
  }
});

test('toInstant 輸入驗證', () => {
  throwsCode(() => C.toInstant({ local: '2000-02-04T08:00' }), 'MISSING_UTC_OFFSET');
  throwsCode(() => C.toInstant({ local: '2000-02-04T08:00', utcOffset: '' }), 'MISSING_UTC_OFFSET');
  throwsCode(() => C.toInstant({ local: '2000-02-04T08:00', utcOffset: '8' }), 'INVALID_UTC_OFFSET');
  throwsCode(() => C.toInstant({ local: '2000-02-04T08:00', utcOffset: '+15:00' }), 'INVALID_UTC_OFFSET');
  throwsCode(() => C.toInstant({ local: '2000-02-04T08:00', utcOffset: '+08:60' }), 'INVALID_UTC_OFFSET');
  throwsCode(() => C.toInstant({ local: '2023-02-29T08:00', utcOffset: '+08:00' }), 'INVALID_LOCAL_TIME');
  throwsCode(() => C.toInstant({ local: '2023-13-01T08:00', utcOffset: '+08:00' }), 'INVALID_LOCAL_TIME');
  throwsCode(() => C.toInstant({ local: '2023-02-03T24:00', utcOffset: '+08:00' }), 'INVALID_LOCAL_TIME');
  throwsCode(() => C.toInstant({ local: '2023-02-03T08:60', utcOffset: '+08:00' }), 'INVALID_LOCAL_TIME');
  throwsCode(() => C.toInstant({ local: 'yesterday', utcOffset: '+08:00' }), 'INVALID_LOCAL_TIME');
  throwsCode(() => C.toInstant(null), 'INVALID_LOCAL_TIME');
  assert.ok(Number.isFinite(C.toInstant({ local: '2024-02-29T12:00', utcOffset: '+08:00' })));
});

test('utcOffsetFor: 1900-2050 各年立春時段只有 1938-1945 是 +09:00(bazhai.verify R19)', () => {
  const nine = [];
  for (let y = 1900; y <= 2050; y++) {
    const local = C.formatCST(C.lichun(y)).replace(' ', 'T');
    if (C.utcOffsetFor(local) === '+09:00') nine.push(y);
    else assert.equal(C.utcOffsetFor(local), '+08:00', String(y));
  }
  assert.deepEqual(nine, [1938, 1939, 1940, 1941, 1942, 1943, 1944, 1945]);
});

test('utcOffsetFor 接上 toInstant: 1940-02-05 08:00 台灣當地時間 → +09:00 → 有效年 1939', () => {
  const local = '1940-02-05T08:00';
  const off = C.utcOffsetFor(local);
  assert.equal(off, '+09:00');
  assert.equal(C.fengshuiYear(C.toInstant({ local, utcOffset: off })), 1939);
});

test('utcOffsetFor: 其他時區與日光節約、閏日、未知時區', () => {
  assert.equal(C.utcOffsetFor('2026-01-01T12:00', 'America/New_York'), '-05:00');
  assert.equal(C.utcOffsetFor('2026-07-01T12:00', 'America/New_York'), '-04:00');
  assert.equal(C.utcOffsetFor('2024-02-29T23:30'), '+08:00');
  assert.equal(C.utcOffsetFor('2026-02-04', 'Asia/Kolkata'), '+05:30');
  throwsCode(() => C.utcOffsetFor('2026-02-04T08:00', 'Mars/Olympus'), 'TIMEZONE_UNSUPPORTED');
});

// ---------------------------------------------------------------- 屬性測試(規格 4.4 calendar/annual)

test('屬性: 1864-2150 fengshuiYear 恰在 lichun 瞬間換年', () => {
  for (let y = SUPPORTED_MIN; y <= C.SUPPORTED_YEARS.max; y++) {
    const lc = C.lichun(y);
    assert.equal(C.fengshuiYear(lc - 1), y - 1, `${y}-`);
    assert.equal(C.fengshuiYear(lc), y, `${y}`);
  }
});
test('屬性: 24 節氣嚴格遞增、間隔 14-16.6 天、落在該 UTC 年、黃經回代誤差 < 1e-6 度(1900-2100)', () => {
  for (let y = 1900; y <= 2100; y++) {
    let prev = -Infinity;
    for (let i = 0; i < 24; i++) {
      const t = C.termInstant(y, i);
      assert.ok(t > prev, `${y}/${i} 未遞增`);
      if (i > 0) {
        const gap = (t - prev) / DAY;
        assert.ok(gap > 14 && gap < 16.6, `${y}/${i} 間隔 ${gap.toFixed(2)} 天`);
      }
      assert.equal(new Date(t).getUTCFullYear(), y, `${y}/${i} 跑出曆年`);
      assert.ok(circDiff(C.solarLongitude(t), (285 + 15 * i) % 360) < 1e-6, `${y}/${i} 黃經回代`);
      prev = t;
    }
  }
});

test('屬性: 立春恆在 CST 2 月 3-5 日(1900-2100),solarLongitude 落在 [0,360)', () => {
  for (let y = 1900; y <= 2100; y++) {
    const day = Number(C.formatCST(C.lichun(y)).slice(8, 10));
    assert.ok(C.formatCST(C.lichun(y)).slice(5, 7) === '02' && day >= 3 && day <= 5, `${y}: ${C.formatCST(C.lichun(y))}`);
  }
  const rnd = rng(11);
  for (let n = 0; n < 2000; n++) {
    const lon = C.solarLongitude(Date.UTC(1900, 0, 1) + Math.floor(rnd() * 200 * 365.25 * DAY));
    assert.ok(lon >= 0 && lon < 360, String(lon));
  }
});

test('屬性: 12 個月連續(前月 end = 後月 start),首月起於立春、末月止於次年立春,天數 28-32', () => {
  for (let fy = SUPPORTED_MIN; fy < C.SUPPORTED_YEARS.max; fy++) {
    const rows = C.monthTable(fy);
    assert.equal(rows.length, 12);
    assert.equal(rows[0].start, C.lichun(fy), `${fy} 首月`);
    assert.equal(rows[11].end, C.lichun(fy + 1), `${fy} 末月`);
    rows.forEach((r, k) => {
      assert.equal(r.order, k);
      if (k > 0) assert.equal(rows[k - 1].end, r.start, `${fy} 第 ${k} 月不連續`);
      const days = (r.end - r.start) / DAY;
      assert.ok(days > 28 && days < 32, `${fy} 月 ${k} 長 ${days.toFixed(2)} 天`);
    });
  }
});

test('屬性: monthOf 在月初含、月末不含,且與 monthTable 一致(1864-2149 抽每 3 年)', () => {
  for (let fy = SUPPORTED_MIN; fy < C.SUPPORTED_YEARS.max; fy += 3) {
    const rows = C.monthTable(fy);
    rows.forEach((r, k) => {
      const at = C.monthOf(r.start);
      assert.deepEqual([at.order, at.name, at.start, at.end, at.jieName], [r.order, r.name, r.start, r.end, r.jieName], `${fy}/${k} 月初`);
      const last = C.monthOf(r.end - 1);
      assert.equal(last.order, r.order, `${fy}/${k} 月末前 1ms`);
      assert.equal(last.start, r.start);
      const next = C.monthOf(r.end);
      assert.equal(next.start, r.end, `${fy}/${k} 月末後屬下一月`);
      assert.equal(next.order, (r.order + 1) % 12);
    });
  }
});

test('屬性: 五虎遁月干與口訣表獨立一致,月柱逐月為連續甲子(1900-2100)', () => {
  // 甲己之年丙作首、乙庚之年戊為頭、丙辛之年尋庚上、丁壬壬寅順水流、戊癸甲寅好追求
  const HEAD = ['丙', '戊', '庚', '壬', '甲'];
  for (let fy = 1900; fy <= 2100; fy++) {
    const ys = C.yearGanzhi(fy).stem;
    const rows = C.monthTable(fy);
    assert.equal(rows[0].name, `${HEAD[ys % 5]}寅`, `${fy} 寅月`);
    for (let k = 1; k < 12; k++) {
      assert.equal(rows[k].stem, (rows[k - 1].stem + 1) % 10, `${fy} 月 ${k} 天干`);
      assert.equal(rows[k].branch, (rows[k - 1].branch + 1) % 12, `${fy} 月 ${k} 地支`);
    }
    assert.deepEqual(rows.map((r) => C.BRANCHES[r.branch]).join(''), '寅卯辰巳午未申酉戌亥子丑');
  }
});

test('屬性: 干支年 60 年一循環且逐年進 1;九運 20 年一運、180 年循環', () => {
  for (let fy = 1700; fy <= 2500; fy++) {
    const g = C.yearGanzhi(fy);
    assert.equal(C.yearGanzhi(fy + 60).name, g.name);
    assert.equal(C.yearGanzhi(fy + 1).index, (g.index + 1) % 60);
    const n = C.nineYun(fy);
    assert.deepEqual(C.nineYun(fy + 180), n, `${fy} 180 年循環`);
    assert.ok(n.yun >= 1 && n.yun <= 9 && n.yunYear >= 1 && n.yunYear <= 20);
    if (n.yunYear < 20) assert.deepEqual([C.nineYun(fy + 1).yun, C.nineYun(fy + 1).yunYear], [n.yun, n.yunYear + 1]);
    else assert.deepEqual([C.nineYun(fy + 1).yun, C.nineYun(fy + 1).yunYear], [(n.yun % 9) + 1, 1]);
  }
  const eras = [];
  for (let fy = 1864; fy < 2044; fy++) eras.push(C.nineYun(fy).era);
  assert.equal(eras.filter((e) => e === '上元').length, 60);
  assert.equal(eras.filter((e) => e === '中元').length, 60);
  assert.equal(eras.filter((e) => e === '下元').length, 60);
  assert.deepEqual(eras.slice(0, 60).concat(eras.slice(60, 120), eras.slice(120)), [...Array(60).fill('上元'), ...Array(60).fill('中元'), ...Array(60).fill('下元')]);
});

test('屬性: 1900-2100 每年立春前一刻與後一刻的運年遞增,只在交運年換運', () => {
  for (let y = 1900; y <= 2100; y++) {
    const before = C.yunOfInstant(C.lichun(y) - 1);
    const after = C.yunOfInstant(C.lichun(y));
    assert.equal(after.year, before.year + 1);
    const handover = (y - 1864) % 20 === 0;
    assert.equal(after.yun !== before.yun, handover, `${y}`);
  }
});

// ---------------------------------------------------------------- 超出支援年份、錯誤碼

test('SUPPORTED_YEARS 為 1864-2150;termInstant 在 2151 年丟 YEAR_OUT_OF_RANGE,1900 以前 ΔT 夾值仍可算', () => {
  assert.deepEqual({ ...C.SUPPORTED_YEARS }, { min: 1864, max: 2150 });
  throwsCode(() => C.termInstant(2151, 0), 'YEAR_OUT_OF_RANGE');
  throwsCode(() => C.termInstant(1799, 0), 'YEAR_OUT_OF_RANGE');
  assert.ok(Number.isFinite(C.termInstant(2150, 23)), '2150 年冬至(年末,ΔT 需外插)應可算');
  assert.ok(Number.isFinite(C.termInstant(1800, 0)));
  assert.match(C.formatCST(C.termInstant(2150, 23)), /^2150-12-2[12] /);
});

test('超出支援年份: fengshuiYear/monthOf 以 180 年週期外推並標 approx,立春仍在 2 月 3-5 日', () => {
  for (const y of [1500, 1700, 1799, 1863, 2151, 2200, 2500]) {
    const rows = C.monthTable(y);
    const day = C.formatCST(rows[0].start);
    assert.ok(/-02-0[345] /.test(day), `${y} 立春 ${day}`);
    assert.equal(C.fengshuiYear(rows[0].start - 1), y - 1, `${y}`);
    assert.equal(C.fengshuiYear(rows[0].start), y, `${y}`);
    rows.forEach((r, k) => { if (k > 0) assert.equal(rows[k - 1].end, r.start); });
    const mo = C.monthOf(cst(`${y}-06-15 12:00`));
    assert.equal(mo.approx, true, `${y}`);
    assert.equal(C.analyze(cst(`${y}-06-15 12:00`)).approx, true);
    assert.ok(C.analyze(cst(`${y}-06-15 12:00`)).meta.warnings.includes('approxRange'));
  }
  for (const d of ['1864-06-15 12:00', '2000-06-15 12:00', '2150-06-15 12:00']) {
    assert.equal(C.analyze(cst(d)).approx, false, d);
    assert.deepEqual(C.analyze(cst(d)).meta.warnings, [], d);
  }
});

test('超出支援年份的九運照 180 年週期: 1863 屬九運、2500 與 2320 同一運', () => {
  assert.equal(C.yunOfInstant(cst('1863-12-31 12:00')).yun, 9);
  assert.equal(C.yunOfInstant(cst('1863-12-31 12:00')).approx, true);
  assert.deepEqual(C.nineYun(2500), C.nineYun(2320));
});

test('輸入驗證與錯誤碼', () => {
  throwsCode(() => C.fengshuiYear(NaN), 'INVALID_INSTANT');
  throwsCode(() => C.fengshuiYear(Infinity), 'INVALID_INSTANT');
  throwsCode(() => C.fengshuiYear('2026-02-04'), 'INVALID_INSTANT');
  throwsCode(() => C.monthOf(undefined), 'INVALID_INSTANT');
  throwsCode(() => C.formatCST(NaN), 'INVALID_INSTANT');
  throwsCode(() => C.solarLongitude(NaN), 'INVALID_INSTANT');
  throwsCode(() => C.analyze(NaN), 'INVALID_INSTANT');
  throwsCode(() => C.lichunFlags(NaN), 'INVALID_INSTANT');
  throwsCode(() => C.termInstant(2000.5, 2), 'INVALID_YEAR');
  throwsCode(() => C.termInstant('2000', 2), 'INVALID_YEAR');
  throwsCode(() => C.yearGanzhi(1.5), 'INVALID_YEAR');
  throwsCode(() => C.nineYun(NaN), 'INVALID_YEAR');
  throwsCode(() => C.termInstant(2000, 24), 'INVALID_TERM_INDEX');
  throwsCode(() => C.termInstant(2000, -1), 'INVALID_TERM_INDEX');
  throwsCode(() => C.termInstant(2000, 1.5), 'INVALID_TERM_INDEX');
  throwsCode(() => C.fengshuiYear(Date.UTC(20000, 0, 1)), 'YEAR_OUT_OF_RANGE');
});

// ---------------------------------------------------------------- 資料形狀: JSON 可序列化、不改動輸入、無全域狀態

test('輸出皆可 JSON 序列化且往返相等(無 NaN/undefined/Date/函式)', () => {
  const ms = cst('2026-09-29 12:00');
  const outs = [
    C.analyze(ms), C.monthOf(ms), C.monthTable(2026), C.lichunFlags(ms, true), C.lichunFlags(cst('2000-02-04 12:00'), false),
    C.yearGanzhi(2026), C.nineYun(2026), C.yunOfInstant(ms),
  ];
  for (const o of outs) assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
});

test('不修改傳入物件(凍結輸入也能用),連續呼叫結果不受先前呼叫影響', () => {
  const settings = Object.freeze({ yearBoundary: 'fixed_feb4', yunSystem: 'san_yuan_9' });
  const input = Object.freeze({ local: '2000-02-04T12:00', utcOffset: '+08:00' });
  const first = C.analyze(C.toInstant(input), settings);
  C.analyze(cst('1900-01-01 00:00'), settings);
  C.termInstant(2100, 5);
  assert.deepEqual(C.analyze(C.toInstant(input), settings), first);
  assert.deepEqual(settings, { yearBoundary: 'fixed_feb4', yunSystem: 'san_yuan_9' });
  assert.deepEqual(input, { local: '2000-02-04T12:00', utcOffset: '+08:00' });
  assert.ok(Object.isFrozen(C.STEMS) && Object.isFrozen(C.BRANCHES) && Object.isFrozen(C.TERM_NAMES));
});

test('常數表: 天干 10、地支 12、節氣 24,節氣索引 2 為立春、23 為冬至', () => {
  assert.equal(C.STEMS.join(''), '甲乙丙丁戊己庚辛壬癸');
  assert.equal(C.BRANCHES.join(''), '子丑寅卯辰巳午未申酉戌亥');
  assert.equal(C.TERM_NAMES.length, 24);
  assert.equal(C.TERM_NAMES[2], '立春');
  assert.equal(C.TERM_NAMES[23], '冬至');
  assert.equal(C.NEAR_LICHUN_MINUTES, 2);
});

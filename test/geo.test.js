// geo 模組測試。fixtures 一律唯讀(orientation.json 只依附錄 B.5 修正,見 orientation.changes.md)。
// 硬斷言 / 軟斷言依 spec 4.1、4.2;突變測試證明 runner 抓得到被改錯的期望值。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFixture,
  circDiff,
  assertApprox,
  assertAngle,
  isSoft,
  assertRunnerCatches,
  GUA as H_GUA,
  DIR_OF_GUA,
  GUA_OF_DIR,
  LUOSHU as H_LUOSHU,
  GUA_OF_LUOSHU,
} from './helpers/harness.js';
import { deriveMountainTable, oracleAnalyze, parseCityTable, NAME_ORDER } from './helpers/geo.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as geo from '../src/core/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(path.join(here, '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const utc = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h);

// ═══════════════════════════ A. orientation.json 函式案例 ═══════════════════════════

const orient = loadFixture('orientation');
const byFn = (fn) => orient.cases.filter((c) => c.input.fn === fn);

const ANALYZE_EXACT = ['mountain', 'zone', 'level', 'leanTo', 'pairType', 'boundaryKind', 'onLine', 'retest', 'outer1p5', 'needsTiGua', 'kongwangKindDegree'];

function runMountainOfBearing(c) {
  const got = geo.mountainAt(c.input.bearing, c.input.ring);
  for (const [k, v] of Object.entries(c.expected)) {
    if (['name', 'index', 'gua', 'dir8', 'opposite'].includes(k)) assert.equal(got[k], v, k);
    else if (k === 'yuan') assert.equal(got.dragon, v, 'yuan');
    else if (k === 'polarity') assert.equal(got.yinyang, v, 'polarity');
    else if (['centerDeg', 'startDeg', 'endDeg'].includes(k)) assertAngle(got[k], v, 1e-9, k);
    else if (k === 'dev') assertApprox(got.dev, v, 1e-9, 'dev');
    else assert.fail(`未知 expected 欄位: ${k}`);
  }
}

function runAnalyzeBearing(c) {
  const opts = {};
  if (c.input.threshold !== undefined) opts.threshold = c.input.threshold;
  if (c.input.uncertainty !== undefined) opts.uncertainty = c.input.uncertainty;
  const got = geo.analyzeBearing(c.input.bearing, opts);
  for (const [k, v] of Object.entries(c.expected)) {
    if (ANALYZE_EXACT.includes(k)) assert.equal(got[k], v, k);
    else if (k === 'dev' || k === 'boundaryDist') assertApprox(got[k], v, 1e-9, k);
    else if (k === 'kongwangKind') {
      if (c.schoolSpecific === true) {
        // 同性相兼超限: 位置式稱小空亡、度數式稱空向,各派不同(D04),只要求標籤落在兩說之內,
        // 且改用度數式時必須等於 kongwangKindDegree。
        assert.ok(['xiao', 'kongxiang'].includes(got.kongwangKind), `school-specific 標籤不在 xiao/kongxiang: ${got.kongwangKind}`);
        assert.equal(typeof got.schoolNote, 'string');
        const deg = geo.analyzeBearing(c.input.bearing, { ...opts, kongwangLabelScheme: 'degree' });
        assert.equal(deg.kongwangKind, c.expected.kongwangKindDegree);
      } else {
        assert.equal(got.kongwangKind, v, 'kongwangKind');
      }
    } else assert.fail(`未知 expected 欄位: ${k}`);
  }
}

const runNormalize = (c) => {
  const got = geo.normalizeBearing(c.input.bearing);
  assert.ok(got >= 0 && got < 360, `超出 [0,360): ${got}`);
  assertAngle(got, c.expected.bearing, 1e-9);
};

function runSit(c) {
  const got = geo.sitFromFacing(c.input.facing);
  for (const [k, v] of Object.entries(c.expected)) {
    if (k === 'sitBearing') assertAngle(got.sitBearing, v, 1e-9, k); // 187.4 案的期望值帶浮點雜訊 7.399999999999977
    else assert.equal(got[k], v, k);
  }
}

const runToTrue = (c) => assertAngle(geo.toTrue(c.input.magnetic, c.input.declination), c.expected.trueBearing, 1e-9);
const runToMagnetic = (c) => assertAngle(geo.toMagnetic(c.input.trueBearing, c.input.declination), c.expected.magnetic, 1e-9);

function runCompare(c) {
  const got = geo.compareMagVsTrue(c.input.magnetic, c.input.declination);
  for (const [k, v] of Object.entries(c.expected)) {
    if (k === 'trueBearing') assertAngle(got.trueBearing, v, 1e-9, k);
    else assert.equal(got[k], v, k);
  }
}

function runCircularMean(c) {
  const got = geo.circularMean(c.input.readings);
  assertAngle(got.mean, c.expected.mean, 1e-5, 'mean');
  assertApprox(got.r, c.expected.r, 1e-5, 'r');
  assertApprox(got.stdDeg, c.expected.stdDeg, 1e-5, 'stdDeg');
}

// pickFacing 12 案 confidence 為 low,但 fixture 明說「鎖定建議預設」,即規則本身,故走硬斷言(spec 4.1)。
function runPickFacing(c) {
  const { type, door, light, building, useBuildingFacade, floor, lowFloorMax } = c.input;
  const overrides = floor !== undefined ? { facadeFloorRule: true } : {}; // 案名「選項『9樓以下用大樓正面』」
  const got = geo.pickFacing({ type, door, light, building, useBuildingFacade, floor, lowFloorMax }, overrides);
  assertAngle(got.facingBearing, c.expected.facingBearing, 1e-9, 'facingBearing');
  assert.equal(got.basis, c.expected.basis, 'basis');
  assert.equal(got.conflict, c.expected.conflict, 'conflict');
  assert.equal(got.confidence, 'low');
}

// tolDeg 在 fixture 是 0.15,規格 4.1 要求 0.02,取較嚴者。
function runDeclinationReference(c) {
  const entry = geo.CITY_DECLINATIONS[c.input.city];
  assert.ok(entry, `CITY_DECLINATIONS 缺 ${c.input.city}`);
  assertApprox(entry.lat, c.input.lat, 1e-9, 'lat');
  assertApprox(entry.lon, c.input.lon, 1e-9, 'lon');
  const d = geo.declinationFor(c.input.city, Date.parse(`${c.input.date}T00:00:00Z`));
  assertApprox(d, c.expected.declinationDeg, Math.min(c.expected.tolDeg, 0.02), 'declinationDeg');
  assertApprox(d, c.expected.igrf14Deg, 0.03, 'igrf14Deg'); // 第二模型,兩模型 2026.0 最大差 0.015(orientation.md 3.5)
  assert.ok(c.expected.tolDeg >= 0.02 && c.expected.tolDeg <= 0.2, `tolDeg 不合理: ${c.expected.tolDeg}`);
  assertApprox(entry.annualChangeDegPerYear, c.expected.annualChangeDegPerYear, 0.002, 'annualChange');
}

function runMeasurement(c) {
  const stats = geo.circularStats(c.input.readings);
  const u = geo.measurementUncertainty({ baseline: c.input.baseline, sigmaDeg: stats.stdDeg });
  const a = geo.analyzeBearing(stats.mean, { uncertainty: u });
  const e = c.expected;
  assertAngle(stats.mean, e.mean, 1e-6, 'mean');
  assertApprox(stats.r, e.r, 1e-6, 'r');
  assertApprox(stats.stdDeg, e.stdDeg, 1e-6, 'stdDeg');
  assertApprox(u, e.uncertainty, 1e-6, 'uncertainty');
  for (const k of ['mountain', 'zone', 'level', 'retest']) assert.equal(a[k], e[k], k);
  assertApprox(a.dev, e.dev, 1e-6, 'dev');
  assertApprox(a.boundaryDist, e.boundaryDist, 1e-6, 'boundaryDist');
}

const RUNNERS = {
  mountainOfBearing: runMountainOfBearing,
  analyzeBearing: runAnalyzeBearing,
  normalizeBearing: runNormalize,
  sitFromFacing: runSit,
  magneticToTrue: runToTrue,
  trueToMagnetic: runToMagnetic,
  compareMagVsTrue: runCompare,
  circularMean: runCircularMean,
  pickFacing: runPickFacing,
  declinationReference: runDeclinationReference,
  measurementAnalysis: runMeasurement,
};

describe('orientation.json: 案例數守門(附錄 B.5 補案後)', () => {
  const EXPECTED_COUNTS = {
    mountainOfBearing: 70, normalizeBearing: 7, sitFromFacing: 11, analyzeBearing: 33 + 192,
    magneticToTrue: 9, trueToMagnetic: 6, compareMagVsTrue: 8, circularMean: 6, pickFacing: 12,
    declinationReference: 17, measurementAnalysis: 6,
  };
  it('每個 fn 的案例數與預期相同,且每個 fn 都有 runner', () => {
    for (const [fn, n] of Object.entries(EXPECTED_COUNTS)) assert.equal(byFn(fn).length, n, fn);
    assert.equal(orient.cases.length, Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0));
    for (const c of orient.cases) assert.ok(RUNNERS[c.input.fn], `沒有 runner: ${c.input.fn}`);
  });
  it('原有 179 案(函式 162 + 偏角 17)全數保留;補案 192 生成 + 6 量測都帶標記', () => {
    const isAdded = (c) => c.tags?.includes('generated') || c.input.fn === 'measurementAnalysis';
    assert.equal(orient.cases.filter((c) => !isAdded(c)).length, 179);
    assert.equal(orient.cases.filter((c) => c.tags?.includes('generated')).length, 192);
    assert.equal(orient.cases.filter((c) => !isAdded(c) && c.input.fn !== 'declinationReference').length, 162);
  });
});

for (const [fn, runner] of Object.entries(RUNNERS)) {
  describe(`orientation.json ${fn}`, () => {
    for (const c of byFn(fn)) it(c.name, () => runner(c));
  });
}

// ═══════════════════════════ B. 突變測試(spec 4.2 第 3 點) ═══════════════════════════

/** 對每個 expected 欄位各改錯一次,runner 必須全部抓得出來。 */
function mutations(c) {
  return Object.keys(c.expected).map((k) => {
    const m = clone(c);
    const v = m.expected[k];
    m.expected[k] = typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : v === null ? 'X' : `${v}X`;
    return { key: k, case: m };
  });
}

function richest(fn, pred = () => true) {
  return byFn(fn)
    .filter((c) => c.schoolSpecific !== true && pred(c))
    .reduce((best, c) => (Object.keys(c.expected).length > Object.keys(best.expected).length ? c : best));
}

describe('突變測試: runner 抓得出被改錯的期望值', () => {
  const picks = {
    mountainOfBearing: richest('mountainOfBearing'),
    analyzeBearing: richest('analyzeBearing', (c) => c.expected.kongwangKind !== null && c.expected.kongwangKindDegree !== undefined),
    normalizeBearing: byFn('normalizeBearing')[0],
    sitFromFacing: byFn('sitFromFacing')[0],
    magneticToTrue: byFn('magneticToTrue')[0],
    trueToMagnetic: byFn('trueToMagnetic')[0],
    compareMagVsTrue: byFn('compareMagVsTrue')[0],
    circularMean: byFn('circularMean')[1],
    pickFacing: byFn('pickFacing')[0],
    declinationReference: byFn('declinationReference')[0],
    measurementAnalysis: byFn('measurementAnalysis')[1],
  };
  for (const [fn, base] of Object.entries(picks)) {
    it(`${fn}: 每個 expected 欄位改錯都被抓出`, () => {
      RUNNERS[fn](base); // 原案必須先過,否則突變沒有意義
      const ms = mutations(base);
      assert.ok(ms.length > 0);
      for (const m of ms) {
        assert.throws(() => RUNNERS[fn](m.case), undefined, `${fn}.${m.key} 被改錯卻沒被抓出`);
      }
    });
  }
  it('school-specific 案例的 kongwangKindDegree 改錯仍被抓出(軟斷言只放寬 kongwangKind)', () => {
    const base = byFn('analyzeBearing').find((c) => c.schoolSpecific === true);
    runAnalyzeBearing(base);
    const bad = clone(base);
    bad.expected.kongwangKindDegree = 'da';
    assert.throws(() => runAnalyzeBearing(bad));
  });
  it('容差不是虛設: sitBearing 差 1e-6 就抓出', () => {
    const base = clone(byFn('sitFromFacing')[0]);
    base.expected.sitBearing += 1e-6;
    assert.throws(() => runSit(base));
  });
});

// ═══════════════════════════ C. 常數表: 規則重算 == 內嵌表(spec 4.2 第 6 點) ═══════════════════════════

describe('24 山表(全專案唯一一份)', () => {
  const derived = deriveMountainTable();
  it('名稱順序、index、中心角', () => {
    assert.equal(geo.MOUNTAINS.map((m) => m.name).join(''), NAME_ORDER);
    geo.MOUNTAINS.forEach((m, i) => {
      assert.equal(m.index, i);
      assert.equal(m.centerDeg, 15 * i);
    });
  });
  it('每山的卦、元龍、陰陽、本五行、類別都等於由規則重算的值(24/24)', () => {
    for (let i = 0; i < 24; i += 1) assert.deepEqual({ ...geo.MOUNTAINS[i] }, derived[i], geo.MOUNTAINS[i].name);
  });
  it('等於 DOMAIN_SPEC 2.1.1 內嵌的 JSON 表', () => {
    const m = /\[\["子","坎","天元","陰"\][\s\S]*?\]\]/.exec(SPEC_TEXT);
    assert.ok(m, '找不到規格內嵌的 24 山表');
    const spec = JSON.parse(m[0]);
    assert.equal(spec.length, 24);
    spec.forEach(([name, gua, dragon, yinyang], i) => {
      const x = geo.MOUNTAINS[i];
      assert.deepEqual([x.name, x.gua, x.dragon, x.yinyang], [name, gua, dragon, yinyang]);
    });
  });
  it('陽 12 山 = 乾坤艮巽 + 壬丙甲庚 + 寅申巳亥;陰 = 其餘(規格 2.1.1)', () => {
    const yang = geo.MOUNTAINS.filter((m) => m.yinyang === '陽').map((m) => m.name).sort();
    assert.deepEqual(yang, [...'乾坤艮巽壬丙甲庚寅申巳亥'].sort());
    const yin = geo.MOUNTAINS.filter((m) => m.yinyang === '陰').map((m) => m.name).sort();
    assert.deepEqual(yin, [...'子午卯酉辰戌丑未乙辛丁癸'].sort());
  });
  it('記憶檢查: 四正卦地天人 = 陽陰陰;四隅卦 = 陰陽陽;三元龍各 8 山', () => {
    for (const g of ['坎', '離', '震', '兌']) {
      const three = geo.MOUNTAINS.filter((m) => m.gua === g);
      assert.deepEqual(['地元', '天元', '人元'].map((d) => three.find((m) => m.dragon === d).yinyang), ['陽', '陰', '陰'], g);
    }
    for (const g of ['乾', '坤', '艮', '巽']) {
      const three = geo.MOUNTAINS.filter((m) => m.gua === g);
      assert.deepEqual(['地元', '天元', '人元'].map((d) => three.find((m) => m.dragon === d).yinyang), ['陰', '陽', '陽'], g);
    }
    for (const d of ['天元', '地元', '人元']) assert.equal(geo.MOUNTAINS.filter((m) => m.dragon === d).length, 8);
  });
  it('表與回傳物件不可被改寫', () => {
    assert.throws(() => { geo.MOUNTAINS[0].name = 'X'; }, TypeError);
    assert.throws(() => { geo.MOUNTAINS.push({}); }, TypeError);
    assert.throws(() => { geo.GUA[0] = 'X'; }, TypeError);
    assert.throws(() => { geo.LIMITS.yinyang[0] = 9; }, TypeError);
    assert.throws(() => { geo.CITY_DECLINATIONS['台北'].declinationDeg = 0; }, TypeError);
    const a = geo.mountainAt(10);
    a.name = 'X';
    assert.equal(geo.mountainAt(10).name, '癸');
  });
});

describe('八卦、洛書、先天表', () => {
  it('GUA、方位名、洛書與 harness 的對照一致', () => {
    assert.deepEqual([...geo.GUA], H_GUA);
    for (const g of H_GUA) {
      assert.equal(geo.dirOfGua(g), DIR_OF_GUA[g]);
      assert.equal(geo.guaOfDir(DIR_OF_GUA[g]), g);
    }
    assert.deepEqual({ ...geo.LUOSHU }, H_LUOSHU);
    for (let n = 1; n <= 9; n += 1) assert.equal(geo.guaOfLuoshu(n), GUA_OF_LUOSHU[n]);
    for (const d of Object.values(DIR_OF_GUA)) assert.equal(geo.dirOfGua(geo.guaOfDir(d)), DIR_OF_GUA[GUA_OF_DIR[d]]);
  });
  it('查不到的卦、方位、洛書數丟出對應錯誤碼', () => {
    throwsCode(() => geo.dirOfGua('中'), 'UNKNOWN_GUA');
    throwsCode(() => geo.guaOfDir('中宮'), 'UNKNOWN_DIR');
    throwsCode(() => geo.guaOfLuoshu(10), 'INVALID_OPTION');
    throwsCode(() => geo.guaOfLuoshu(2.5), 'INVALID_OPTION');
  });
  it('洛書南上格各線和 15(橫 3、豎 3、斜 2),且與 LUOSHU 對應方位一致', () => {
    const g = geo.LUOSHU_GRID_SOUTH_UP;
    const rows = g.map((r) => r.reduce((a, b) => a + b, 0));
    const cols = [0, 1, 2].map((c) => g.reduce((a, r) => a + r[c], 0));
    assert.deepEqual([...rows, ...cols, g[0][0] + g[1][1] + g[2][2], g[0][2] + g[1][1] + g[2][0]], Array(8).fill(15));
    // 南上: 列 = 1 + sign(cos b),欄 = 1 - sign(sin b)(左為東)
    geo.GUA.forEach((name, k) => {
      const rad = (45 * k * Math.PI) / 180;
      const row = 1 + Math.sign(Math.round(Math.cos(rad) * 1000));
      const col = 1 - Math.sign(Math.round(Math.sin(rad) * 1000));
      assert.equal(g[row][col], geo.LUOSHU[name], name);
    });
    assert.equal(g[1][1], geo.LUOSHU.中);
  });
  it('對宮洛書數相加 = 10;卦爻互補;先天對宮互補', () => {
    geo.GUA.forEach((name, k) => {
      const opp = geo.GUA[(k + 4) % 8];
      assert.equal(geo.LUOSHU[name] + geo.LUOSHU[opp], 10, name);
    });
    for (const [a, b] of [['乾', '坤'], ['兌', '艮'], ['離', '坎'], ['震', '巽']]) {
      assert.deepEqual(geo.GUA_LINES[a].map((x, i) => x + geo.GUA_LINES[b][i]), [1, 1, 1], `${a}${b}`);
      assert.equal(Math.abs(geo.XIANTIAN_BEARING[a] - geo.XIANTIAN_BEARING[b]), 180);
    }
  });
  it('先天卦位: 乾南坤北離東坎西兌東南震東北巽西南艮西北;XIANTIAN_OF_SLOT 與位置一致', () => {
    const want = { 乾: '南', 坤: '北', 離: '東', 坎: '西', 兌: '東南', 震: '東北', 巽: '西南', 艮: '西北' };
    for (const [g, dir] of Object.entries(want)) {
      assert.equal(geo.dirOfGua(geo.GUA[geo.XIANTIAN_BEARING[g] / 45]), dir, g);
      assert.equal(geo.XIANTIAN_OF_SLOT[geo.GUA[geo.XIANTIAN_BEARING[g] / 45]], g);
    }
  });
  it('山 → 卦、對山、index 查表', () => {
    for (const m of geo.MOUNTAINS) {
      assert.equal(geo.mountainIndex(m.name), m.index);
      assert.equal(geo.guaOfMountain(m.name), m.gua);
      const opp = geo.oppositeOf(m.name);
      assert.equal(geo.mountainIndex(opp), (m.index + 12) % 24);
      assert.equal(geo.oppositeOf(opp), m.name);
      const o = geo.MOUNTAINS[geo.mountainIndex(opp)];
      assert.equal(o.dragon, m.dragon, `${m.name} 對山同元龍`);
      assert.equal(o.yinyang, m.yinyang, `${m.name} 對山同陰陽`);
    }
    throwsCode(() => geo.mountainIndex('甲子'), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => geo.oppositeOf(''), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => geo.guaOfMountain(undefined), 'UNKNOWN_MOUNTAIN');
  });
  it('五行: 本五行與依宮兩種分法', () => {
    assert.equal(geo.wuxingOfMountain('寅'), '木');
    assert.equal(geo.wuxingOfMountain('寅', 'palace'), '土');
    assert.equal(geo.wuxingOfMountain('辰'), '土');
    assert.equal(geo.wuxingOfMountain('辰', 'palace'), '木');
    throwsCode(() => geo.wuxingOfMountain('寅', 'x'), 'INVALID_OPTION');
  });
});

describe('兼向限度表與 48 局分類', () => {
  it('LIMITS 等於 DOMAIN_SPEC 2.1.1 內嵌 JSON', () => {
    const m = /\{ "tongxing_yin": \[6, 6\][^}]*\}/.exec(SPEC_TEXT);
    assert.ok(m, '找不到規格內嵌的 LIMITS');
    assert.deepEqual(clone(geo.LIMITS), JSON.parse(m[0]));
  });
  it('limitsFor: default / strict5 / zggdfs6,同陰同陽不受流派影響', () => {
    assert.deepEqual(clone(geo.limitsFor()), clone(geo.LIMITS));
    assert.deepEqual([...geo.limitsFor('strict5').yinyang], [5, 5]);
    assert.deepEqual([...geo.limitsFor('strict5').chugua], [5, 5]);
    assert.deepEqual([...geo.limitsFor('zggdfs6').yinyang], [6, 6]);
    assert.deepEqual([...geo.limitsFor('zggdfs6').chugua], [6, 6]);
    for (const s of ['strict5', 'zggdfs6']) {
      assert.deepEqual([...geo.limitsFor(s).tongxing_yin], [6, 6]);
      assert.deepEqual([...geo.limitsFor(s).tongxing_yang], [7, 7]);
    }
    throwsCode(() => geo.limitsFor('x'), 'INVALID_OPTION');
    throwsCode(() => geo.limitsFor('toString'), 'INVALID_OPTION');
  });
  it('24 條界線 = 出卦 8、陰陽互兼 8、同陰 4、同陽 4(有向 16/16/8/8),清單與規格分類一致', () => {
    const want = {
      chugua: ['癸丑', '寅甲', '乙辰', '巳丙', '丁未', '申庚', '辛戌', '亥壬'],
      yinyang: ['壬子', '丑艮', '甲卯', '辰巽', '丙午', '未坤', '庚酉', '戌乾'],
      tongxing_yin: ['子癸', '卯乙', '午丁', '酉辛'],
      tongxing_yang: ['艮寅', '巽巳', '坤申', '乾亥'],
    };
    const got = { chugua: [], yinyang: [], tongxing_yin: [], tongxing_yang: [] };
    for (let i = 0; i < 24; i += 1) {
      const a = geo.MOUNTAINS[i].name;
      const b = geo.MOUNTAINS[(i + 1) % 24].name;
      const t = geo.pairTypeOf(a, b);
      assert.equal(geo.pairTypeOf(b, a), t, '相兼類型與方向無關');
      got[t].push(a + b);
    }
    for (const k of Object.keys(want)) assert.deepEqual([...got[k]].sort(), [...want[k]].sort(), k);
  });
  it('48 個有向界線各取 adev=5.5,分類計數 8/8/16/16(spec 4.4)', () => {
    const cnt = {};
    for (let i = 0; i < 24; i += 1) {
      for (const b of [15 * i + 5.5, 15 * (i + 1) - 5.5]) {
        const t = geo.analyzeBearing(b).pairType;
        cnt[t] = (cnt[t] ?? 0) + 1;
      }
    }
    assert.deepEqual(cnt, { tongxing_yin: 8, tongxing_yang: 8, yinyang: 16, chugua: 16 });
  });
  it('pairTypeOf 對不相鄰的山丟錯', () => {
    throwsCode(() => geo.pairTypeOf('子', '丑'), 'NOT_ADJACENT_MOUNTAINS');
    throwsCode(() => geo.pairTypeOf('子', '子'), 'NOT_ADJACENT_MOUNTAINS');
    throwsCode(() => geo.pairTypeOf('子', 'X'), 'UNKNOWN_MOUNTAIN');
  });
});

// ═══════════════════════════ D. luopan_rings.json 中屬於 geo 的案例 ═══════════════════════════

const luopan = loadFixture('luopan_rings');
const PLATE_RING = { 地盤正針: 'earth', 人盤中針: 'ren', 天盤縫針: 'tian' };
const lpCase = (name) => luopan.cases.find((c) => c.name === name) ?? assert.fail(`luopan_rings.json 缺案例 ${name}`);

const LUOPAN_RUNNERS = [
  [/^mountains24_geometry$/, (c) => {
    for (let i = 0; i < 24; i += 1) {
      const e = c.expected[i];
      const m = geo.MOUNTAINS[i];
      assert.equal(m.name, e.name);
      assert.equal(m.index, e.index);
      assert.equal(m.centerDeg, e.center);
      assert.equal(m.gua, e.palace, `${e.name} 宮`);
      assert.equal(m.dragon, e.yuan, `${e.name} 元龍`);
      assert.equal(m.kind, e.kind, `${e.name} 類別`);
      const info = geo.mountainAt(e.center);
      assert.equal(info.name, e.name);
      assertAngle(info.startDeg, e.start, 1e-9, `${e.name} start`);
      assertAngle(info.endDeg, e.end, 1e-9, `${e.name} end`);
    }
  }],
  [/^mountains24_sanyuan_yinyang$/, (c) => {
    assert.deepEqual(geo.MOUNTAINS.filter((m) => m.yinyang === '陽').map((m) => m.name).sort(), [...c.expected.yang].sort());
    assert.deepEqual(geo.MOUNTAINS.filter((m) => m.yinyang === '陰').map((m) => m.name).sort(), [...c.expected.yin].sort());
    for (const [name, yy] of Object.entries(c.expected.by_mountain)) assert.equal(geo.MOUNTAINS[geo.mountainIndex(name)].yinyang, yy, name);
  }],
  [/^mountains24_wuxing$/, (c) => {
    for (const [name, wx] of Object.entries(c.expected.own)) assert.equal(geo.wuxingOfMountain(name, 'own'), wx, `${name} 本五行`);
    for (const [name, wx] of Object.entries(c.expected.by_palace)) assert.equal(geo.wuxingOfMountain(name, 'palace'), wx, `${name} 依宮`);
  }],
  [/^bagua_houtian_ring$/, (c) => {
    for (const e of c.expected) {
      const k = geo.GUA.indexOf(e.name);
      assert.equal(k * 45, e.bearing, `${e.name} 方位`);
      assert.equal(geo.guaAt(e.bearing).gua, e.name);
      assert.equal(geo.LUOSHU[e.name], e.luoshu);
      assert.equal(geo.GUA_WUXING[e.name], e.wuxing);
      assert.deepEqual([...geo.GUA_LINES[e.name]], e.houtian_lines_bottom_to_top);
      assert.deepEqual(geo.MOUNTAINS.filter((m) => m.gua === e.name).map((m) => m.name).sort(), [...e.mountains].sort());
    }
  }],
  [/^bagua_xiantian_bearings$/, (c) => {
    for (const e of c.expected) {
      assert.equal(geo.XIANTIAN_BEARING[e.name], e.bearing, `${e.name} 先天方位`);
      assert.deepEqual([...geo.GUA_LINES[e.name]], e.lines_bottom_to_top);
      assert.equal(geo.XIANTIAN_OF_SLOT[e.drawn_in_houtian_slot], e.name);
      assert.equal(geo.guaAt(e.bearing).gua, e.drawn_in_houtian_slot);
    }
  }],
  [/^luoshu_magic_square_south_up$/, (c) => {
    assert.deepEqual(clone(geo.LUOSHU_GRID_SOUTH_UP), c.expected.grid);
    assert.deepEqual(c.expected.line_sums, [15]);
  }],
  [/^plates_offsets$/, (c) => {
    for (const [plate, ring] of Object.entries(PLATE_RING)) {
      // 子山中心: 地盤 0、人盤 352.5(= -7.5)、天盤 7.5
      const zi = ring === 'earth' ? geo.mountainAt(0, ring) : ring === 'ren' ? geo.mountainAt(352.5, ring) : geo.mountainAt(7.5, ring);
      assert.equal(zi.name, '子', plate);
      assertAngle(zi.centerDeg, c.expected[plate], 1e-9, plate);
    }
  }],
  [/^lookup_/, (c) => {
    assert.equal(geo.mountainAt(c.input.bearing, PLATE_RING[c.input.plate]).name, c.expected);
  }],
  [/^facing_sitting_convention$/, (c) => {
    for (const [a, b] of c.expected.pairs) {
      assert.equal(geo.oppositeOf(a), b);
      assert.equal(geo.oppositeOf(b), a);
    }
    assert.equal(c.expected.pairs.length, 12);
  }],
  [/^facing_sitting_\d/, (c) => {
    const f = c.input.facing_bearing;
    const sit = geo.sitFromFacing(f);
    const a = geo.analyzeBearing(f);
    assert.equal(sit.facingMountain, c.expected.facing);
    assert.equal(sit.sitMountain, c.expected.sit);
    assertApprox(a.dev, c.expected.offset_deg, 1e-9, 'offset_deg');
    assert.equal(a.zone === 'zheng', c.expected.centre9, 'centre9');
  }],
  [/^zheng_jian_xiang_markers$/, (c) => {
    const da = c.expected.daKongWang_bearings;
    const xiao = c.expected.xiaoKongWang_bearings;
    assert.equal(geo.analyzeBearing(0).meta.ruleset.xiaGuaHalfWidth, c.expected.centre_half_width);
    for (const b of da) {
      const a = geo.analyzeBearing(b);
      assert.equal(a.kongwangKind, 'da', `${b} 大空亡`);
      assert.equal(a.onLine, true);
    }
    for (const b of xiao) {
      const a = geo.analyzeBearing(b);
      assert.equal(a.kongwangKind, 'xiao', `${b} 小空亡(位置式)`);
      assert.equal(a.onLine, true);
    }
    assert.deepEqual([...da, ...xiao].sort((x, y) => x - y), Array.from({ length: 24 }, (_, k) => 7.5 + 15 * k));
  }],
];
const lpRunnerFor = (name) => LUOPAN_RUNNERS.find(([re]) => re.test(name))?.[1];
const LP_GEO_CASES = luopan.cases.filter((c) => lpRunnerFor(c.name));

describe('luopan_rings.json 中屬於 geo 的案例', () => {
  it('案例數守門: 24 山幾何/陰陽/五行、八卦後天/先天、洛書、三針偏移、三針 lookup 9、facing/sitting 7、正兼向標記 = 24 案', () => {
    assert.equal(LP_GEO_CASES.length, 24);
    assert.equal(LP_GEO_CASES.filter((c) => c.name.startsWith('lookup_')).length, 9);
    assert.equal(LP_GEO_CASES.filter((c) => c.name.startsWith('facing_sitting')).length, 7);
  });
  for (const c of LP_GEO_CASES) {
    it(c.name, () => {
      // luopan_rings.json 的 confidence 為 medium 以上,全部硬斷言
      assert.ok(!isSoft(c));
      lpRunnerFor(c.name)(c);
    });
  }
  it('突變: luopan 各 runner 抓得出被改錯的期望值', () => {
    const cases = ['mountains24_geometry', 'mountains24_sanyuan_yinyang', 'mountains24_wuxing', 'bagua_houtian_ring', 'bagua_xiantian_bearings',
      'luoshu_magic_square_south_up', 'plates_offsets', 'lookup_人盤中針_3', 'lookup_天盤縫針_357', 'facing_sitting_172', 'facing_sitting_convention', 'zheng_jian_xiang_markers'];
    for (const name of cases) {
      const base = lpCase(name);
      const runner = lpRunnerFor(name);
      runner(base);
      const bad = clone(base);
      const leaf = (o, key) => {
        const v = o[key];
        if (Array.isArray(v) || (v && typeof v === 'object')) return leaf(v, Array.isArray(v) ? 0 : Object.keys(v)[0]);
        o[key] = typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : `${v}X`;
        return true;
      };
      if (typeof bad.expected === 'object' && bad.expected !== null) leaf(bad, 'expected');
      else bad.expected = `${bad.expected}X`;
      assertRunnerCatches(runner, bad);
    }
    // 三針 lookup: 改方向(人盤與天盤對調)必須被抓出
    const swap = clone(lpCase('lookup_人盤中針_3'));
    swap.input.plate = '天盤縫針';
    assertRunnerCatches(lpRunnerFor(swap.name), swap);
  });
});

// ═══════════════════════════ E. 跨模組一致性(spec 4.2 第 5 點) ═══════════════════════════

describe('跨模組一致性: orientation / luopan / xuankong 讀到的 24 山完全一致', () => {
  const xk = loadFixture('xuankong_core');
  it('orientation.json 24 個山中心案例 == MOUNTAINS(24/24)', () => {
    const centers = byFn('mountainOfBearing').filter((c) => c.tags?.includes('center'));
    assert.equal(centers.length, 24);
    for (const c of centers) {
      const m = geo.MOUNTAINS[c.expected.index];
      assert.deepEqual([m.name, m.gua, m.dragon, m.yinyang, geo.dirOfGua(m.gua), geo.oppositeOf(m.name)],
        [c.expected.name, c.expected.gua, c.expected.yuan, c.expected.polarity, c.expected.dir8, c.expected.opposite]);
    }
  });
  it('xuankong_core.json table_24_mountains (壬起算) == MOUNTAINS(24/24)', () => {
    const rows = xk.cases.find((c) => c.name === 'table_24_mountains').expected.rows;
    assert.equal(rows.length, 24);
    const dragonOf = ['地元', '天元', '人元'];
    for (const r of rows) {
      const m = geo.MOUNTAINS[geo.mountainIndex(r.name)];
      assert.equal(geo.MOUNTAINS[(r.index + 23) % 24].name, r.name, `${r.name} 壬起算的順序`);
      assert.equal(m.gua, r.palace_name);
      assert.equal(geo.LUOSHU[m.gua], r.palace);
      assert.equal(m.dragon, dragonOf[r.yuan]);
      assert.equal(m.yinyang === '陽', r.yang);
      assert.equal(m.centerDeg, r.center_deg);
      assert.equal(geo.oppositeOf(r.name), r.opposite);
      const info = geo.mountainAt(r.center_deg);
      assertAngle(info.startDeg, r.from_deg, 1e-9);
      assertAngle(info.endDeg, r.to_deg, 1e-9);
    }
  });
  it('xuankong_core.json locate_degree 75 案: 山、下卦/兼向、替卦、兼向側、相兼類型', () => {
    const KIND = { 出卦: ['chugua'], 陰陽差錯: ['yinyang'], 同陰陽: ['tongxing_yin', 'tongxing_yang'] };
    const cases = xk.cases.filter((c) => c.type === 'locate_degree');
    assert.equal(cases.length, 75);
    let hard = 0;
    for (const c of cases) {
      const a = geo.analyzeBearing(c.input.deg);
      if (isSoft(c)) {
        // locate_edge_*: 端點慣例分歧,只要求不崩潰並帶完整旗標(spec 4.1)
        assert.equal(typeof a.boundaryDist, 'number');
        assert.equal(typeof a.onLine, 'boolean');
        continue;
      }
      hard += 1;
      const e = c.expected;
      assert.equal(a.mountain, e.mountain, c.name);
      assert.equal(a.zone === 'zheng' ? 'xia' : 'jian', e.zone, c.name);
      assert.equal(a.needsTiGua, e.need_ti, c.name);
      if (e.zone === 'jian') {
        assert.equal(a.leanTo, e.neighbor, c.name);
        assert.equal(a.dev < 0 ? 'pre' : 'post', e.side, c.name);
        assert.ok(KIND[e.kind].includes(a.pairType), `${c.name} ${a.pairType}`);
      }
    }
    assert.equal(hard, 72);
  });
  it('xuankong_core.json chart_from_facing_degree: 向的度數 → 坐山、向山、兼向側、類別', () => {
    const KIND = { 出卦: ['chugua'], 陰陽差錯: ['yinyang'], 同陰陽: ['tongxing_yin', 'tongxing_yang'] };
    const cases = xk.cases.filter((c) => c.type === 'chart_from_facing_degree');
    assert.equal(cases.length, 10);
    for (const c of cases) {
      const a = geo.analyzeBearing(c.input.facing_deg);
      const e = c.expected;
      assert.equal(a.mountain, e.face, c.name);
      assert.equal(geo.sitFromFacing(c.input.facing_deg).sitMountain, e.sit, c.name);
      assert.equal(a.zone, e.zone, c.name);
      assert.equal(a.leanTo, e.neighbor, c.name);
      assert.equal(a.dev < 0 ? 'pre' : 'post', e.side, c.name);
      assert.ok(KIND[e.kind].includes(a.pairType), c.name);
      assert.equal(a.needsTiGua, e.use_ti, c.name);
    }
  });
});

// ═══════════════════════════ F. 幾何函式的屬性測試(spec 4.4 geo) ═══════════════════════════

describe('屬性測試', () => {
  it('mountainAt: index 隨 bearing 單調(每 0.05 度掃一圈,恰換 24 次山)', () => {
    let prev = geo.mountainAt(0).index;
    let changes = 0;
    for (let t = 1; t < 7200; t += 1) {
      const idx = geo.mountainAt(t * 0.05).index;
      if (idx !== prev) {
        assert.equal(idx, (prev + 1) % 24, `在 ${t * 0.05} 跳了不只一格`);
        changes += 1;
        prev = idx;
      }
    }
    assert.equal(changes, 24, '子→癸…→壬→子,一圈 24 次(0..359.95)');
  });
  it('sit(facing(x)) = normalize(x+180),向山 index +12 = 坐山 index(掃 -400..760 度)', () => {
    for (let t = -4000; t <= 7600; t += 3) {
      const x = t * 0.1 + 0.0137;
      const s = geo.sitFromFacing(x);
      assertAngle(s.sitBearing, geo.normalizeBearing(x + 180), 1e-9, `x=${x}`);
      const fi = geo.mountainIndex(s.facingMountain);
      assert.equal(geo.mountainIndex(s.sitMountain), (fi + 12) % 24, `x=${x}`);
      assert.equal(s.zhaiGua, geo.guaOfMountain(s.sitMountain));
      assert.equal(s.zhaiSitDir, geo.dirOfGua(s.zhaiGua));
    }
  });
  it('dev ∈ [-7.5,7.5)、boundaryDist ∈ (0,7.5]、與 mountainAt 一致', () => {
    for (let t = 0; t < 36000; t += 7) {
      const b = t / 100;
      const a = geo.analyzeBearing(b);
      const m = geo.mountainAt(b);
      assert.ok(a.dev >= -7.5 && a.dev < 7.5, `dev=${a.dev} @${b}`);
      assert.ok(a.boundaryDist >= 0 && a.boundaryDist <= 7.5);
      assertApprox(a.boundaryDist, 7.5 - Math.abs(a.dev), 1e-12);
      assert.equal(a.mountain, m.name);
      assertApprox(a.dev, m.dev, 1e-12);
      assert.equal(a.gua, geo.guaAt(b).gua);
    }
  });
  it('needsTiGua: 同性相兼恆為 false;zone=zheng 恆為 false;yinyang/chugua 兼向恆為 true', () => {
    for (let t = 0; t < 36000; t += 5) {
      const a = geo.analyzeBearing(t / 100);
      if (a.pairType === 'tongxing_yin' || a.pairType === 'tongxing_yang') assert.equal(a.needsTiGua, false, `@${t / 100}`);
      if (a.zone === 'zheng') assert.equal(a.needsTiGua, false);
      if (a.pairType === 'yinyang' || a.pairType === 'chugua') assert.equal(a.needsTiGua, true);
    }
  });
  it('三針: 人盤 = 地盤整體逆時針 7.5 度、天盤 = 順時針 7.5 度(index 與 dev 都對得上)', () => {
    for (let t = 0; t < 7200; t += 1) {
      const b = t * 0.05;
      const earth = geo.mountainAt(b);
      const ren = geo.mountainAt(b, 'ren');
      const tian = geo.mountainAt(b, 'tian');
      const viaRen = geo.mountainAt(b + 7.5);
      const viaTian = geo.mountainAt(b - 7.5);
      assert.equal(ren.name, viaRen.name, `ren @${b}`);
      assertApprox(ren.dev, viaRen.dev, 1e-9, `ren dev @${b}`);
      assert.equal(tian.name, viaTian.name, `tian @${b}`);
      assertApprox(tian.dev, viaTian.dev, 1e-9, `tian dev @${b}`);
      assert.ok(earth.dev >= -7.5 && ren.dev >= -7.5 && tian.dev >= -7.5 && ren.dev < 7.5 && tian.dev < 7.5);
    }
  });
  it('guaAt 與 24 山同界: 每座山都完整落在一個卦內;45 度半開區間', () => {
    for (let t = 0; t < 7200; t += 1) {
      const b = t * 0.05;
      assert.equal(geo.guaAt(b).gua, geo.mountainAt(b).gua, `@${b}`);
    }
    geo.GUA.forEach((g, k) => {
      assert.equal(geo.guaAt(45 * k).gua, g);
      assert.equal(geo.guaAt(45 * k - 22.5).gua, g, '起點含入');
      assert.equal(geo.guaAt(45 * k + 22.4999).gua, g);
      assert.notEqual(geo.guaAt(45 * k + 22.5).gua, g, '迄點不含');
    });
    assert.equal(geo.guaAt(337.5).gua, '坎');
    assert.equal(geo.guaAt(-22.5).gua, '坎');
    assert.equal(geo.guaAt(22.5).gua, '艮');
  });
  it('圓周平均: [359,1] 得 0(算術平均會得 180);對稱簇的圓周平均等於簇中心', () => {
    assert.equal(geo.circularMean([359, 1]).mean, 0);
    assert.equal((359 + 1) / 2, 180);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 200; n += 1) {
      const center = rnd() * 360;
      const offs = [rnd() * 20, rnd() * 20, rnd() * 20];
      const list = [center, ...offs.flatMap((o) => [center + o, center - o])];
      const got = geo.circularStats(list);
      assertAngle(got.mean, center, 1e-7, `center=${center}`);
      assert.equal(got.n, 7);
    }
  });
});

describe('analyzeBearing 對照獨立的整數算術實作(以 0.1 度為單位掃描 -370..730 度)', () => {
  const SWEEP_KEYS = ['mountain', 'zone', 'level', 'leanTo', 'pairType', 'boundaryKind', 'kongwangKind', 'kongwangKindDegree', 'onLine', 'retest', 'outer1p5', 'needsTiGua'];
  const COMBOS = [
    { school: 'default', threshold10: 45, uncertainty10: 30 },
    { school: 'strict5', threshold10: 45, uncertainty10: 50 },
    { school: 'zggdfs6', threshold10: 35, uncertainty10: 30 },
    { school: 'default', threshold10: 30, uncertainty10: 80 },
  ];
  for (const combo of COMBOS) {
    it(`school=${combo.school} threshold=${combo.threshold10 / 10} uncertainty=${combo.uncertainty10 / 10}`, () => {
      const opts = { threshold: combo.threshold10 / 10, uncertainty: combo.uncertainty10 / 10, jianLimitSchool: combo.school };
      for (let t10 = -3700; t10 <= 7300; t10 += 1) {
        const got = geo.analyzeBearing(t10 / 10, opts);
        const want = oracleAnalyze(t10, combo);
        const at = `t10=${t10}`;
        // 兩百萬次 assert 太慢,只在不一致時才用 assert 報訊息
        const bad = SWEEP_KEYS.find((k) => got[k] !== want[k]);
        if (bad !== undefined) assert.equal(got[bad], want[bad], `${at} ${bad}`);
        if (Math.abs(got.dev * 10 - want.dev10) > 1e-6) assertApprox(got.dev * 10, want.dev10, 1e-6, `${at} dev`);
        if (Math.abs(got.boundaryDist * 10 - want.dist10) > 1e-6) assertApprox(got.boundaryDist * 10, want.dist10, 1e-6, `${at} dist`);
      }
    });
  }
});

// ═══════════════════════════ G. analyzeBearing 細節 ═══════════════════════════

describe('analyzeBearing 規格範例與選項', () => {
  it('規格 2.1.2 範例 bearing=175.0', () => {
    const a = geo.analyzeBearing(175.0);
    const want = {
      mountain: '午', index: 12, dev: -5, zone: 'jian', level: 'jian', leanTo: '丙', pairType: 'yinyang',
      boundaryDist: 2.5, boundaryKind: 'shan', kongwangKind: null, kongwangKindDegree: null, onLine: false,
      retest: true, outer1p5: false, needsTiGua: true, gua: '離', dir8: '南', opposite: '子',
    };
    for (const [k, v] of Object.entries(want)) assert.equal(a[k], v, k);
  });
  it('規格 2.1.2 範例 bearing=187.4: 同陰超限,位置式小空亡 + 度數式空向 + 流派說明', () => {
    const a = geo.analyzeBearing(187.4);
    assert.equal(a.mountain, '午');
    assertApprox(a.dev, 7.4, 1e-9);
    assert.deepEqual([a.zone, a.level, a.leanTo, a.pairType], ['jian', 'void', '丁', 'tongxing_yin']);
    assertApprox(a.boundaryDist, 0.1, 1e-9);
    assert.deepEqual([a.boundaryKind, a.onLine, a.kongwangKind, a.kongwangKindDegree, a.needsTiGua, a.retest], ['shan', true, 'xiao', 'kongxiang', false, true]);
    assert.match(a.schoolNote, /各派定義不同/);
    const d = geo.analyzeBearing(187.4, { kongwangLabelScheme: 'degree' });
    assert.equal(d.kongwangKind, 'kongxiang');
    assert.equal(d.kongwangKindDegree, 'kongxiang');
    assert.equal(geo.analyzeBearing(187.4, { kongwangLabelScheme: 'position' }).kongwangKind, 'xiao');
  });
  it('空亡標籤: 卦界=大、陰陽互兼山界=小(兩種標法一致),只在 void 或壓線時給', () => {
    for (const scheme of ['position', 'degree']) {
      assert.equal(geo.analyzeBearing(22.4, { kongwangLabelScheme: scheme }).kongwangKind, 'da');
      assert.equal(geo.analyzeBearing(353, { kongwangLabelScheme: scheme }).kongwangKind, 'xiao');
      assert.equal(geo.analyzeBearing(175, { kongwangLabelScheme: scheme }).kongwangKind, null);
      assert.equal(typeof geo.analyzeBearing(353, { kongwangLabelScheme: scheme }).schoolNote, 'string');
    }
    assert.equal(geo.analyzeBearing(175).schoolNote, null);
  });
  it('jianLimitSchool: 5.5 度的陰陽互兼 default 為 jian_caution、strict5 為 void、zggdfs6 為 jian;6.5 度 zggdfs6 才是 void', () => {
    const at = (b, school) => geo.analyzeBearing(b, { jianLimitSchool: school }).level;
    assert.deepEqual(['default', 'strict5', 'zggdfs6'].map((s) => at(180 - 5.5, s)), ['jian_caution', 'void', 'jian']);
    assert.deepEqual(['default', 'strict5', 'zggdfs6'].map((s) => at(180 - 6.5, s)), ['void', 'void', 'void']);
    assert.deepEqual(['default', 'strict5', 'zggdfs6'].map((s) => at(180 + 5.5, s)), ['jian', 'jian', 'jian'], '午兼丁同陰不受影響');
    assert.equal(geo.analyzeBearing(175, { jianLimitSchool: 'strict5' }).meta.ruleset.jianLimitSchool, 'strict5');
  });
  it('threshold 選項 4.5/3.5/3.0: 恰等於門檻歸下卦(含端點),浮點雜訊不翻邊', () => {
    for (const t of [4.5, 3.5, 3.0]) {
      assert.equal(geo.analyzeBearing(180 + t, { threshold: t }).zone, 'zheng', `t=${t}`);
      assert.equal(geo.analyzeBearing(180 + t + 1e-12, { threshold: t }).zone, 'zheng', `t=${t} 雜訊`);
      assert.equal(geo.analyzeBearing(180 + t + 0.01, { threshold: t }).zone, 'jian');
      assert.equal(geo.analyzeBearing(180 - t, { threshold: t }).zone, 'zheng');
    }
  });
  it('outer1p5 與 level 是兩個旗標: 6.0 起為 true(含端點),5.99 為 false', () => {
    assert.equal(geo.analyzeBearing(186).outer1p5, true);
    assert.equal(geo.analyzeBearing(185.99).outer1p5, false);
    assert.equal(geo.analyzeBearing(186).level, 'jian');
  });
  it('騎線與重測的端點: boundaryDist=0.5 不算騎線;boundaryDist=uncertainty 不需重測', () => {
    assert.equal(geo.analyzeBearing(187).onLine, false); // 午 dev=7.0
    assert.equal(geo.analyzeBearing(187.01).onLine, true);
    assert.equal(geo.analyzeBearing(184.5).retest, false);
    assert.equal(geo.analyzeBearing(184.5, { uncertainty: 3.01 }).retest, true);
  });
  it('正好在界線(7.5 的整數倍)歸順時針下一山,dev = -7.5', () => {
    for (let k = 0; k < 24; k += 1) {
      const b = 15 * k + 7.5;
      const a = geo.analyzeBearing(b);
      assert.equal(a.mountain, geo.MOUNTAINS[(k + 1) % 24].name);
      assert.equal(a.dev, -7.5);
      assert.equal(a.boundaryDist, 0);
      assert.equal(a.onLine, true);
    }
  });
  it('八宅提示: 接近卦界(boundaryDist < max(不確定度,3))才給 Finding,山界不給', () => {
    const near = geo.analyzeBearing(20.5); // 癸 dev 5.5,距卦界 2.0
    assert.equal(near.findings.length, 1);
    const f = near.findings[0];
    assert.deepEqual([f.id, f.level, f.tag, f.confidence], ['geo.near_gua_boundary', 'note', 'design', 'medium']);
    assert.match(f.body, /坎/);
    assert.match(f.body, /艮/);
    assert.deepEqual([near.neighborMountain, near.neighborGua], ['丑', '艮']);
    assert.equal(geo.analyzeBearing(19.0).findings.length, 0, '距卦界 3.5,不確定度 3 → 不提示');
    assert.equal(geo.analyzeBearing(19.0, { uncertainty: 5 }).findings.length, 1);
    assert.equal(geo.analyzeBearing(175).findings.length, 0, '山界不提示');
    assert.equal(geo.analyzeBearing(22.5).findings.length, 1);
    assert.match(geo.analyzeBearing(22.5).findings[0].body, /幾乎壓在分界線上/);
  });
  it('預設值取自 settings: 下卦半寬 = xiaGuaHalfWidth、標籤方案、限度流派;純函式不確定度 3.0 而 App 層 5.0', () => {
    const a = geo.analyzeBearing(0);
    assert.deepEqual(a.meta, {
      schema: 'fengshui.geo.bearing/1',
      ruleset: { xiaGuaHalfWidth: DEFAULT_SETTINGS.xiaGuaHalfWidth, jianLimitSchool: DEFAULT_SETTINGS.jianLimitSchool, kongwangLabelScheme: DEFAULT_SETTINGS.kongwangLabelScheme, measureUncertainty: 3 },
    });
    assert.notEqual(DEFAULT_SETTINGS.measureUncertainty, 3, 'App 層預設 5.0 與純函式 3.0 分開(D05)');
    const opts = geo.boundaryOptsFromSettings();
    assert.deepEqual(opts, { threshold: 4.5, uncertainty: 5.0, kongwangLabelScheme: 'position', jianLimitSchool: 'default' });
    assert.equal(geo.analyzeBearing(176, opts).retest, true); // 距界 3.5 < 5
    const custom = geo.boundaryOptsFromSettings({ xiaGuaHalfWidth: 3.5, measureUncertainty: 7, jianLimitSchool: 'strict5', kongwangLabelScheme: 'degree' });
    assert.deepEqual(geo.analyzeBearing(0, custom).meta.ruleset, { xiaGuaHalfWidth: 3.5, jianLimitSchool: 'strict5', kongwangLabelScheme: 'degree', measureUncertainty: 7 });
    throwsCode(() => geo.boundaryOptsFromSettings({ nope: 1 }), '未知的設定鍵');
  });
  it('不合法輸入與選項丟出規格錯誤碼', () => {
    for (const bad of [NaN, Infinity, -Infinity, '180', null, undefined, {}, [], true]) {
      for (const fn of [geo.normalizeBearing, geo.mountainAt, geo.guaAt, geo.sitFromFacing, geo.analyzeBearing]) {
        throwsCode(() => fn(bad), 'INVALID_BEARING');
      }
      throwsCode(() => geo.toTrue(bad, -5), 'INVALID_BEARING');
      throwsCode(() => geo.toMagnetic(bad, -5), 'INVALID_BEARING');
      throwsCode(() => geo.compareMagVsTrue(bad, -5), 'INVALID_BEARING');
      throwsCode(() => geo.circularDiff(bad, 0), 'INVALID_BEARING');
      throwsCode(() => geo.circularDiff(0, bad), 'INVALID_BEARING');
    }
    throwsCode(() => geo.mountainAt(10, 'x'), 'INVALID_OPTION');
    throwsCode(() => geo.mountainAt(10, 'toString'), 'INVALID_OPTION');
    for (const opts of [{ threshold: 0 }, { threshold: 7.5 }, { threshold: '4.5' }, { threshold: NaN }, { uncertainty: -1 }, { uncertainty: Infinity },
      { uncertainty: '3' }, { kongwangLabelScheme: 'x' }, { jianLimitSchool: 'x' }, { typo: 1 }, null, [], 3]) {
      throwsCode(() => geo.analyzeBearing(10, opts), 'INVALID_OPTION');
    }
  });
  it('輸入不被修改、輸出可 JSON 序列化且往返相等(無 undefined、Date、函式)', () => {
    const opts = Object.freeze({ threshold: 4.5, uncertainty: 3 });
    const outs = [geo.analyzeBearing(175, opts), geo.analyzeBearing(22.4), geo.mountainAt(10, 'ren'), geo.guaAt(100), geo.sitFromFacing(187.4),
      geo.compareMagVsTrue(8, -5), geo.circularMean(Object.freeze([359, 1])), geo.circularStats([90, 270]), geo.declinationInfo('台北', utc(2026, 9, 29, 4)),
      geo.pickFacing(Object.freeze({ type: 'apartment', door: 90, light: 180 })), geo.limitsFor('strict5')];
    for (const o of outs) assert.deepEqual(clone(o), o);
    assert.deepEqual(opts, { threshold: 4.5, uncertainty: 3 });
  });
});

// ═══════════════════════════ H. 磁北與真北 ═══════════════════════════

describe('磁偏角換算與城市表', () => {
  it('符號: 台北 D=-5,面向真北時羅盤讀數約 005 而不是 355;真 = 磁 + D', () => {
    assertAngle(geo.toMagnetic(0, -5), 5, 1e-12);
    assertAngle(geo.toTrue(0, -5), 355, 1e-12);
    assertAngle(geo.toTrue(geo.toMagnetic(0, -5), -5), 0, 1e-12);
  });
  it('往返: toMagnetic(toTrue(x,D),D) = x(圓周差 < 1e-9;D 掃 -15..15)', () => {
    for (let x = -400; x <= 760; x += 13.7) {
      for (let D = -15; D <= 15; D += 2.5) {
        assert.ok(circDiff(geo.toMagnetic(geo.toTrue(x, D), D), geo.normalizeBearing(x)) < 1e-9, `x=${x} D=${D}`);
      }
    }
  });
  it('不合法的磁偏角: NaN、字串、超過 ±180', () => {
    for (const D of [NaN, Infinity, '5', null, undefined, 181, -181]) {
      throwsCode(() => geo.toTrue(0, D), 'INVALID_DECLINATION');
      throwsCode(() => geo.toMagnetic(0, D), 'INVALID_DECLINATION');
      throwsCode(() => geo.compareMagVsTrue(0, D), 'INVALID_DECLINATION');
    }
    assertAngle(geo.toTrue(0, 180), 180, 1e-12);
  });
  it('不校正時換山機率 = |D|/15、換卦 = |D|/45(orientation.json info 十城全部吻合)', () => {
    const table = orient.meta.info['effect_of_ignoring_declination_2026.0'];
    for (const [city, row] of Object.entries(table)) {
      const D = row.decl;
      let mountainChanged = 0;
      let guaChanged = 0;
      const N = 36000;
      for (let t = 0; t < N; t += 1) {
        const r = geo.compareMagVsTrue(t / 100 + 0.0031, D);
        if (!r.sameMountain) mountainChanged += 1;
        if (!r.sameGua) guaChanged += 1;
      }
      assertApprox(mountainChanged / N, row.p_mountain_changes, 0.0015, `${city} 換山`);
      assertApprox(guaChanged / N, row.p_gua_changes, 0.0015, `${city} 換卦`);
      assertApprox(mountainChanged / N, Math.abs(D) / 15, 0.0015, `${city} 理論值`);
    }
  });
  it('CITY_DECLINATIONS == orientation.md 3.5 城市表(逐城的緯度、經度、2026.0 偏角、年變化;無手打錯字)', () => {
    const rows = parseCityTable();
    assert.equal(rows.length, 41, '報告表格實際 41 城');
    for (const r of rows) {
      const c = geo.CITY_DECLINATIONS[r.name];
      assert.ok(c, `缺 ${r.name}`);
      assert.deepEqual([c.lat, c.lon, c.declinationDeg, c.annualChangeDegPerYear], [r.lat, r.lon, r.d2026, r.rate], r.name);
    }
    const extra = Object.keys(geo.CITY_DECLINATIONS).filter((n) => !rows.some((r) => r.name === n));
    assert.deepEqual(extra, ['首爾'], '除表格 41 城外只多首爾(取自 orientation.json 偏角參考)');
  });
  it('以表內兩個日期欄位交叉驗算外推規則: 2026-09-29(12:00 CST)與 2025.0', () => {
    for (const r of parseCityTable()) {
      assertApprox(geo.declinationFor(r.name, utc(2026, 9, 29, 4)), r.d20260929, 0.012, `${r.name} 2026-09-29`);
      assertApprox(geo.declinationFor(r.name, utc(2025, 1, 1)), r.d2025, 0.02, `${r.name} 2025.0`);
      assertApprox(geo.declinationFor(r.name, utc(2026, 1, 1)), r.d2026, 1e-12, `${r.name} 2026.0`);
    }
  });
  it('spec 2.1.5: 台北 2026-09-29 約 -5.06;台灣各地 -4.3(高雄)到 -5.1(台北一帶)', () => {
    assertApprox(geo.declinationFor('台北', utc(2026, 9, 29, 4)), -5.06, 0.005);
    const tw = ['台北', '新北板橋', '基隆', '桃園', '新竹', '苗栗', '台中', '彰化', '南投', '雲林斗六', '嘉義', '台南', '高雄', '屏東', '宜蘭', '花蓮', '台東', '澎湖馬公', '金門'];
    for (const c of tw) {
      const d = geo.declinationFor(c, utc(2026, 1, 1));
      assert.ok(d <= -4.3 && d >= -5.1, `${c} ${d}`);
    }
  });
  it('年變化線性外推、日期以 UTC 年計: 2026.5 與 2028.0', () => {
    const t = geo.CITY_DECLINATIONS['台北'];
    const mid = geo.declinationInfo('台北', utc(2026, 7, 2, 12));
    assertApprox(mid.yearFraction, 2026.5, 1e-12);
    assertApprox(mid.declinationDeg, t.declinationDeg + t.annualChangeDegPerYear * 0.5, 1e-12);
    assertApprox(geo.declinationInfo('台北', utc(2028, 1, 1)).yearFraction, 2028, 1e-12);
    assert.equal(geo.declinationInfo('台北', utc(2026, 1, 1)).yearFraction, 2026);
  });
  it('模型有效期 2025.0 到 2030.0(含起不含迄),超出仍回外推值並標 inModelRange=false', () => {
    const at = (ms) => geo.declinationInfo('台北', ms);
    assert.equal(at(utc(2025, 1, 1)).inModelRange, true);
    assert.equal(at(utc(2024, 12, 31, 23)).inModelRange, false);
    assert.equal(at(utc(2029, 12, 31)).inModelRange, true);
    assert.equal(at(utc(2030, 1, 1)).inModelRange, false);
    assert.ok(Number.isFinite(at(utc(2035, 6, 1)).declinationDeg));
    assert.equal(at(utc(2026, 5, 1)).model, 'WMM2025');
    assert.equal(geo.DECLINATION_MODEL.validTo, 2030);
  });
  it('未知城市、不合法日期丟錯', () => {
    for (const c of ['火星', '', undefined, null, 5, 'toString', '__proto__']) throwsCode(() => geo.declinationFor(c, utc(2026, 1, 1)), 'UNKNOWN_CITY');
    for (const d of [NaN, Infinity, '2026-01-01', null, undefined, 8.64e15 + 1]) throwsCode(() => geo.declinationFor('台北', d), 'INVALID_DATE');
  });
  it('compareMagVsTrue 用城市偏角: 台北 2026-09-29 磁讀 8 度 → 真 2.9 度', () => {
    const D = geo.declinationFor('台北', utc(2026, 9, 29, 4));
    const r = geo.compareMagVsTrue(8, D);
    assertApprox(r.trueBearing, 8 + D, 1e-9);
    assert.deepEqual([r.magneticMountain, r.trueMountain, r.sameMountain, r.sameGua], ['癸', '子', false, true]);
  });
});

// ═══════════════════════════ I. 圓周統計與不確定度 ═══════════════════════════

describe('圓周統計', () => {
  it('circularDiff: 絕對值 [0,180],跨 0 取短弧', () => {
    assertApprox(geo.circularDiff(359.9999995, 0), 5e-7, 1e-9);
    assert.equal(geo.circularDiff(0, 180), 180);
    assert.equal(geo.circularDiff(10, 350), 20);
    assert.equal(geo.circularDiff(350, 10), 20);
    assert.equal(geo.circularDiff(370, 10), 0);
    assert.equal(geo.circularDiff(-90, 90), 180);
    for (let a = -400; a < 800; a += 37.3) for (let b = -400; b < 800; b += 41.1) assertApprox(geo.circularDiff(a, b), circDiff(a, b), 1e-9);
  });
  it('circularDelta: 有帶號,從 b 順時針轉到 a', () => {
    assert.equal(geo.circularDelta(10, 350), 20);
    assert.equal(geo.circularDelta(350, 10), -20);
    assert.equal(geo.circularDelta(0, 180), -180);
    assert.equal(geo.circularDelta(90, 0), 90);
  });
  it('circularStats / circularMean: 形狀與退化情形', () => {
    assert.deepEqual(Object.keys(geo.circularMean([1, 2])).sort(), ['mean', 'r', 'stdDeg']);
    assert.deepEqual(Object.keys(geo.circularStats([1, 2])).sort(), ['mean', 'n', 'r', 'stdDeg']);
    const same = geo.circularStats([10, 10, 10]);
    assertAngle(same.mean, 10, 1e-9);
    assertApprox(same.stdDeg, 0, 1e-9, '相同讀數 σ');
    assert.equal(same.r <= 1 + 1e-12, true);
    const one = geo.circularStats([123.4]);
    assertAngle(one.mean, 123.4, 1e-9);
    assertApprox(one.stdDeg, 0, 1e-9, '單筆讀數 σ');
    const opposite = geo.circularStats([90, 270]);
    assert.deepEqual([opposite.mean, opposite.stdDeg], [null, null], '合成向量近 0 → null');
    assert.equal(geo.circularMean([0, 90, 180, 270]).mean, null);
    assertAngle(geo.circularStats([720, -360, 0]).mean, 0, 1e-9);
  });
  it('σ 公式: 對稱 ±s 的讀數,小角度時 σ ≈ s', () => {
    for (const s of [0.5, 1, 2, 3, 5]) assertApprox(geo.circularStats([180 - s, 180 + s]).stdDeg, s, s * 0.01);
  });
  it('不合法讀數', () => {
    for (const bad of [[], 'x', null, undefined, 5, {}]) throwsCode(() => geo.circularStats(bad), 'INVALID_READINGS');
    for (const bad of [[NaN], [1, '2'], [1, Infinity], [null]]) throwsCode(() => geo.circularMean(bad), 'INVALID_BEARING');
  });
  it('measurementUncertainty = max(baseline, 2σ, accuracy);缺項略過;預設 baseline 取 App 層 5.0', () => {
    assert.equal(geo.measurementUncertainty(), DEFAULT_SETTINGS.measureUncertainty);
    assert.equal(geo.measurementUncertainty({ baseline: 3, sigmaDeg: 1 }), 3);
    assert.equal(geo.measurementUncertainty({ baseline: 3, sigmaDeg: 4 }), 8);
    assert.equal(geo.measurementUncertainty({ baseline: 5, sigmaDeg: 1, accuracyDeg: 12 }), 12);
    assert.equal(geo.measurementUncertainty({ baseline: 3, sigmaDeg: null, accuracyDeg: null }), 3);
    assert.equal(geo.measurementUncertainty({ baseline: 3, sigmaDeg: 0, accuracyDeg: 0 }), 3);
    for (const bad of [{ baseline: -1 }, { baseline: NaN }, { sigmaDeg: -1 }, { accuracyDeg: 'x' }]) throwsCode(() => geo.measurementUncertainty(bad), 'INVALID_OPTION');
  });
});

// ═══════════════════════════ J. 「向」取法政策 ═══════════════════════════

describe('pickFacing 政策細節', () => {
  const pick = (input, o) => geo.pickFacing(input, o);
  it('夾角超過 45 度才 conflict(45 整不算);跨 0/360 取圓周差', () => {
    assert.equal(pick({ type: 'apartment', door: 0, light: 45 }).conflict, false);
    assert.equal(pick({ type: 'apartment', door: 0, light: 46 }).conflict, true);
    assert.equal(pick({ type: 'apartment', door: 350, light: 30 }).conflict, false);
    assert.equal(pick({ type: 'apartment', door: 350, light: 40 }).conflict, true);
  });
  it('conflict 把大樓正面一起算;candidates 一律列出可用的三項', () => {
    const r = pick({ type: 'apartment', door: 0, light: 10, building: 100 });
    assert.equal(r.conflict, true);
    assert.deepEqual(r.candidates, [{ source: 'door', bearing: 0 }, { source: 'light', bearing: 10 }, { source: 'building', bearing: 100 }]);
    assert.deepEqual(pick({ type: 'apartment', light: 10 }).candidates, [{ source: 'light', bearing: 10 }]);
  });
  it('方位角先正規化: 大門 -10 → 350、370 → 10', () => {
    assert.equal(pick({ type: 'shop', door: -10 }).facingBearing, 350);
    assert.equal(pick({ type: 'shop', door: 370 }).facingBearing, 10);
  });
  it('facingPolicy 強制指定; 指定的資料缺就落回自動規則', () => {
    const inp = { type: 'apartment', door: 20, light: 110, building: 200 };
    assert.deepEqual([pick(inp, { facingPolicy: 'door' }).facingBearing, pick(inp, { facingPolicy: 'door' }).basis], [20, 'door']);
    assert.deepEqual([pick(inp, { facingPolicy: 'light' }).facingBearing, pick(inp, { facingPolicy: 'light' }).basis], [110, 'main_light_face']);
    assert.deepEqual([pick(inp, { facingPolicy: 'building' }).facingBearing, pick(inp, { facingPolicy: 'building' }).basis], [200, 'building_facade']);
    assert.equal(pick({ type: 'apartment', door: 20, light: 110 }, { facingPolicy: 'building' }).basis, 'main_light_face');
    assert.equal(pick({ type: 'apartment', door: 20 }, { facingPolicy: 'light' }).basis, 'door_fallback');
    assert.equal(pick({ type: 'shop', door: 20 }, { facingPolicy: 'door' }).basis, 'street_door');
    assert.equal(pick({ type: 'apartment', door: 20, light: 110 }, { facingPolicy: 'auto' }).basis, 'main_light_face');
  });
  it('樓層規則預設關;開啟後 floor <= lowFloorMax(預設 9)才用大樓正面', () => {
    const base = { type: 'apartment', door: 20, light: 110, building: 200, floor: 9 };
    assert.equal(pick(base).basis, 'main_light_face', 'facadeFloorRule 預設關');
    assert.equal(pick(base, { facadeFloorRule: true }).basis, 'building_facade');
    assert.equal(pick({ ...base, floor: 10 }, { facadeFloorRule: true }).basis, 'main_light_face');
    assert.equal(pick({ ...base, floor: 10, lowFloorMax: 12 }, { facadeFloorRule: true }).basis, 'building_facade');
    assert.equal(pick({ ...base, building: null }, { facadeFloorRule: true }).basis, 'main_light_face');
    assert.deepEqual(pick({ ...base, building: null }, { facadeFloorRule: true }).warnings, ['building_missing']);
    assert.deepEqual(pick({ ...base, building: null, useBuildingFacade: true }).warnings, ['building_missing']);
  });
  it('辦公室: 同大樓住戶;storefront=true 走店面規則', () => {
    assert.equal(pick({ type: 'office', door: 270, light: 180 }).basis, 'main_light_face');
    assert.equal(pick({ type: 'office', door: 270, light: 180, useBuildingFacade: true, building: 90 }).basis, 'building_facade');
    const s = pick({ type: 'office', door: 270, light: 180, storefront: true });
    assert.deepEqual([s.facingBearing, s.basis, s.conflict], [270, 'street_door', true]);
  });
  it('透天: 差恰為 45 用大門、46 用採光面;缺資料的退路', () => {
    assert.equal(pick({ type: 'house', door: 0, light: 45 }).basis, 'door');
    assert.equal(pick({ type: 'house', door: 0, light: 46 }).basis, 'main_light_face');
    assert.equal(pick({ type: 'house', door: 0 }).basis, 'door_fallback');
    assert.equal(pick({ type: 'house', light: 90 }).basis, 'main_light_face');
    assert.equal(pick({ type: 'house', building: 90 }).basis, 'building_facade');
  });
  it('店面: 大門為向;無大門退採光面;採光面差太多只標 conflict', () => {
    const r = pick({ type: 'shop', door: 270, light: 0 });
    assert.deepEqual([r.facingBearing, r.basis, r.conflict], [270, 'street_door', true]);
    assert.equal(pick({ type: 'shop', light: 0 }).basis, 'main_light_face');
    assert.equal(pick({ type: 'shop', building: 0 }).basis, 'building_facade');
  });
  it('公寓沒有採光資料時退大門;只有大樓正面時用大樓正面;永遠 confidence=low', () => {
    assert.equal(pick({ type: 'apartment', door: 5, building: 100 }).basis, 'door_fallback');
    assert.equal(pick({ type: 'apartment', building: 100 }).basis, 'building_facade');
    for (const t of ['apartment', 'office', 'house', 'shop']) assert.equal(pick({ type: t, door: 0, light: 0 }).confidence, 'low');
  });
  it('不合法輸入', () => {
    throwsCode(() => pick({ type: 'castle', door: 0 }), 'INVALID_FACING_INPUT');
    throwsCode(() => pick({ door: 0 }), 'INVALID_FACING_INPUT');
    throwsCode(() => pick(null), 'INVALID_FACING_INPUT');
    throwsCode(() => pick({ type: 'house' }), 'INVALID_FACING_INPUT');
    throwsCode(() => pick({ type: 'house', door: null, light: undefined, building: null }), 'INVALID_FACING_INPUT');
    throwsCode(() => pick({ type: 'house', door: NaN }), 'INVALID_BEARING');
    throwsCode(() => pick({ type: 'house', door: '90' }), 'INVALID_BEARING');
    assert.throws(() => pick({ type: 'house', door: 0 }, { facingPlicy: 'door' }), /未知的設定鍵/);
    throwsCode(() => pick({ type: 'house', door: 0 }, { facingPolicy: 'x' }), 'INVALID_OPTION');
  });
  it('meta.ruleset 回存實際採用的設定;無採光資料退回大門時帶 no_light_data', () => {
    const r = pick({ type: 'apartment', door: 5 }, { facingPolicy: 'door', facadeFloorRule: true });
    assert.deepEqual(r.meta, { schema: 'fengshui.geo.facing/1', ruleset: { facingPolicy: 'door', facadeFloorRule: true } });
    assert.deepEqual(pick({ type: 'apartment', door: 5 }).warnings, ['no_light_data']);
    assert.deepEqual(pick({ type: 'house', door: 5 }).warnings, ['no_light_data']);
    assert.deepEqual(pick({ type: 'apartment', door: 5, light: 6 }).warnings, []);
    assert.equal(pick({ type: 'shop', door: 5 }).meta.ruleset.facingPolicy, DEFAULT_SETTINGS.facingPolicy);
  });
  it('輸入物件不被修改', () => {
    const input = Object.freeze({ type: 'apartment', door: 90, light: 180, building: null });
    const before = clone(input);
    pick(input);
    assert.deepEqual(clone(input), before);
  });
});

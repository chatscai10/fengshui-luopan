// sensor 模組測試(DOMAIN_SPEC 2.9、D65-D69)。
// 結構: fixtures(device_compass.json)runner → 突變測試 → 屬性測試(4.4)→ 規格內嵌表重算(4.2 第 6 點)
//       → 純函式行為 → createCompassSource(假環境)→ 純度/不可變檢查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadFixture, circDiff, assertRunnerCatches } from './helpers/harness.js';
import {
  matrixHeadings,
  matrixTilt,
  betaForTilt,
  blendReference,
  rng,
  parseSpecStatusTable,
  parseSpecKTable,
  createFakeEnv,
} from './helpers/sensor.js';
import * as core from '../src/core/sensor-core.js';
import { createCompassSource, createBrowserEnv } from '../src/core/sensor.js';
import { circularMean, circularDelta, toTrue, analyzeBearing, measurementUncertainty } from '../src/core/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(here, '..', 'src', 'core');

/** 錯誤 message 必須以規格錯誤碼開頭(assert.throws 的 RegExp 比對的是 String(err),含 "Error: " 前綴,不能用)。 */
const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);

const fixture = loadFixture('device_compass');
/** meta.tolerance.headingDeg(圓周差);fixtures 數值只給 6 位小數,捨入誤差 ≤ 5e-7 < 此值。 */
const TOL = fixture.meta.tolerance.headingDeg;

// ─────────────────────────── fixtures runner ───────────────────────────

/** expected 裡只是說明用途、不是被測輸出的鍵。 */
const NOTE_KEYS = new Set(['note180']);
const EMA_METHOD = { 'unit-vector EMA': 'unit-vector', 'shortest-arc EMA': 'shortest-arc' };

function compareValue(actual, expected, angle, at) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${at}: 陣列長度不符`);
    expected.forEach((e, i) => compareValue(actual[i], e, angle, `${at}[${i}]`));
  } else if (expected === null) {
    assert.equal(actual, null, `${at}: 期望 null,實得 ${actual}`);
  } else if (typeof expected === 'number') {
    assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${at}: 期望數字 ${expected},實得 ${actual}`);
    const d = angle ? circDiff(actual, expected) : Math.abs(actual - expected);
    assert.ok(d <= TOL, `${at}: 期望 ${expected} ± ${TOL},實得 ${actual}`);
  } else {
    assert.equal(actual, expected, at);
  }
}

/** 每個 fn 一個 runner: compute(case) → {actual, angle: 以圓周差比較的鍵}。 */
const RUNNERS = {
  eulerToHeadings: (c) => {
    const { alpha, beta, gamma } = c.input;
    const h = core.eulerHeadings(alpha, beta, gamma);
    return {
      actual: { topEdgeHeading: h.top, backHeading: h.back, rightEdgeHeading: h.right },
      angle: ['topEdgeHeading', 'backHeading', 'rightEdgeHeading'],
    };
  },
  screenUpHeading: (c) => {
    const { alpha, beta, gamma, deviceRotCCW } = c.input;
    return { actual: { screenUpHeading: core.screenUpHeading(alpha, beta, gamma, deviceRotCCW) }, angle: ['screenUpHeading'] };
  },
  pickPointingMode: (c) => {
    const { alpha, beta, gamma, prevMode, enterBackDeg, leaveBackDeg } = c.input;
    const r = core.pickPointingModeHysteresis(alpha, beta, gamma, prevMode, enterBackDeg, leaveBackDeg);
    return { actual: { mode: r.mode, heading: r.heading, tiltDeg: r.tiltDeg, faceDown: r.faceDown }, angle: ['heading'] };
  },
  circularMean: (c) => {
    // geo.circularMean 的近零門檻固定 1e-9,不吃 fixtures 的 minResultantLength;此處 fixtures 都不落在兩門檻之間。
    const angles = c.input.anglesDeg;
    const r = circularMean(angles);
    if ('arithmeticMeanDeg' in c.expected) {
      const arith = angles.reduce((s, x) => s + x, 0) / angles.length;
      assert.ok(circDiff(arith, r.mean) > 90, '反例: 算術平均應與圓周平均差很遠');
      return { actual: { arithmeticMeanDeg: arith, correctCircularMeanDeg: r.mean }, angle: ['correctCircularMeanDeg'] };
    }
    return { actual: { meanDeg: r.mean, resultantLength: r.r, circularStdDeg: r.stdDeg }, angle: ['meanDeg'] };
  },
  circularDiff: (c) => {
    let d = circularDelta(c.input.a, c.input.b);
    // ±180 兩者皆可(平手)
    if (Math.abs(c.expected.diffDeg) === 180 && Math.abs(d) === 180) d = c.expected.diffDeg;
    return { actual: { diffDeg: d }, angle: [] };
  },
  circularEma: (c) => {
    const { method, k, init, samples } = c.input;
    return { actual: { outputs: core.circularEmaSeries(samples, { k, init, method: EMA_METHOD[method] }) }, angle: ['outputs'] };
  },
  roundHalfDegree: (c) => {
    const r = core.roundHalf(c.input.headingDeg);
    assert.ok(r >= 0 && r < 360, `roundHalf 必須落在 [0,360): ${r}`);
    assert.equal(r * 2, Math.floor(r * 2), `roundHalf 必須是 0.5 的倍數: ${r}`);
    return { actual: { roundedDeg: r }, angle: ['roundedDeg'] };
  },
  boundaryDistance: (c) => {
    assert.equal(c.input.sectorWidthDeg, 15);
    assert.equal(c.input.sectorCentersAtMultiplesOf, 15);
    return { actual: { distanceToNearestBoundaryDeg: core.boundaryDistance(c.input.headingDeg) }, angle: [] };
  },
  trueFromMagnetic: (c) => ({
    actual: { trueHeadingDeg: toTrue(c.input.magneticHeadingDeg, c.input.declinationDegEastPositive) },
    angle: ['trueHeadingDeg'],
  }),
  decodeOrientationEvent: (c) => {
    const ev = { ...c.input };
    for (const [k, v] of Object.entries(c.inputSpecials ?? {})) {
      assert.equal(v, 'NaN', `未知的 inputSpecials 值: ${v}`);
      ev[k] = NaN;
    }
    const r = core.decodeOrientationEvent(ev);
    return {
      actual: { source: r.source, headingDeg: r.headingDeg, accuracyDeg: r.accuracyDeg, status: r.status, mode: r.mode },
      angle: ['headingDeg'],
    };
  },
  iosUprightOffset: (c) => {
    const r = core.iosUprightOffset(c.input.flatSample, c.input.uprightSample);
    return { actual: { offsetDeg: r.offsetDeg, uprightBackHeadingDeg: r.uprightBackHeadingDeg }, angle: ['uprightBackHeadingDeg'] };
  },
  lockAverage: (c) => {
    const r = core.lockAverage(c.input.samplesDeg, { minSamples: c.input.minSamples, maxStdDeg: c.input.maxStdDeg });
    return { actual: { status: r.status, n: r.n, meanDeg: r.meanDeg, stdDeg: r.stdDeg }, angle: ['meanDeg'] };
  },
  screenAngleToDeviceRot: (c) => ({
    actual: { deviceRotCCW: core.screenAngleToDeviceRot(c.input.platform, c.input.screenOrientationAngle) },
    angle: [],
  }),
  pickHeadingBlend: (c) => {
    const { alpha, beta, gamma } = c.input;
    const r = core.pickHeadingBlend(alpha, beta, gamma);
    return { actual: { headingDeg: r.headingDeg, tiltDeg: r.tiltDeg, mode: r.mode }, angle: ['headingDeg'] };
  },
};

/** 硬斷言: 期望值逐鍵比對(缺鍵也算失敗)。 */
function runHard(c) {
  const { actual, angle } = RUNNERS[c.fn](c);
  for (const key of Object.keys(c.expected)) {
    if (NOTE_KEYS.has(key)) continue;
    compareValue(actual[key], c.expected[key], angle.includes(key), `${c.name}.${key}`);
  }
}

/** 軟斷言(spec 4.2 第 2 點,confidence=low): 只要求不崩潰且輸出形狀合理。 */
function runSoft(c) {
  const { actual } = RUNNERS[c.fn](c);
  const leaf = (v) => {
    if (Array.isArray(v)) return v.every(leaf);
    return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
  };
  for (const [k, v] of Object.entries(actual)) assert.ok(leaf(v), `${c.name}.${k} 輸出形狀不合理: ${v}`);
}

const isSoftCase = (c) => c.confidence === 'low';
const hardCases = fixture.cases.filter((c) => !isSoftCase(c));

test('fixtures 覆蓋: 每個 fn 都有 runner,組別數量固定', () => {
  for (const c of fixture.cases) assert.ok(RUNNERS[c.fn], `沒有 runner: ${c.fn}(${c.name})`);
  const names = new Set(fixture.cases.map((c) => c.name));
  assert.equal(names.size, fixture.cases.length, '案例名稱有重複');
  const counts = {};
  for (const c of fixture.cases) counts[c.group] = (counts[c.group] ?? 0) + 1;
  // 原 99 案(group1-13)+ 附錄 B.7 補案 16(group10 +4、group14 +12)
  assert.deepEqual(counts, {
    group1: 25, group2: 6, group3: 7, group4: 9, group5: 8, group6: 3, group7: 8,
    group8: 8, group9: 5, group10: 14, group11: 1, group12: 3, group13: 6, group14: 12,
  });
  assert.equal(fixture.cases.length, 115);
});

for (const c of fixture.cases) {
  test(`fixture ${c.group} ${c.name}${isSoftCase(c) ? ' [軟斷言]' : ''}`, () => {
    (isSoftCase(c) ? runSoft : runHard)(c);
  });
}

// ─────────────────────────── 突變測試(4.2 第 3 點) ───────────────────────────

/** 產生「只改 expected 某鍵」的錯誤版本;陣列則每個元素各改一次。 */
function* mutants(c) {
  for (const key of Object.keys(c.expected)) {
    if (NOTE_KEYS.has(key)) continue;
    const v = c.expected[key];
    const variants = [];
    if (Array.isArray(v)) v.forEach((_, i) => variants.push(v.map((x, j) => (j === i ? x + 1 : x))));
    else if (typeof v === 'number') variants.push(v + 1);
    else if (typeof v === 'string') variants.push(`${v}X`);
    else if (typeof v === 'boolean') variants.push(!v);
    else if (v === null) variants.push(0);
    for (const bad of variants) yield { key, bad: { ...c, expected: { ...c.expected, [key]: bad } } };
  }
}

for (const group of [...new Set(hardCases.map((c) => c.group))]) {
  test(`突變: ${group} 每個期望欄位被改錯都會被 runner 抓出`, () => {
    let n = 0;
    for (const c of hardCases.filter((x) => x.group === group)) {
      for (const { key, bad } of mutants(c)) {
        assertRunnerCatches(runHard, bad);
        n += 1;
        assert.ok(key);
      }
    }
    assert.ok(n > 0, '沒有產生任何突變');
  });
}

test('突變: 期望值正確的案例不會被誤殺(對照組)', () => {
  for (const c of hardCases) assert.doesNotThrow(() => runHard(c), c.name);
});

// ─────────────────────────── 屬性測試(4.4 sensor) ───────────────────────────

test('屬性: 平放時頂端方位 = (360-α) mod 360,與 γ(及 β)無關', () => {
  const rand = rng(20260929);
  for (let i = 0; i < 1000; i += 1) {
    const alpha = rand() * 360;
    const beta = (rand() - 0.5) * 2 * 80;
    const gamma = (rand() - 0.5) * 2 * 89;
    const { top } = core.eulerHeadings(alpha, beta, gamma);
    assert.ok(circDiff(top, (360 - alpha) % 360) < 1e-9, `α=${alpha} β=${beta} γ=${gamma} top=${top}`);
  }
});

test('屬性: eulerHeadings 與矩陣連乘的第二來源一致(含 null)', () => {
  const rand = rng(7);
  let nulls = 0;
  for (let i = 0; i < 3000; i += 1) {
    const alpha = rand() * 360;
    const beta = rand() * 360 - 180;
    const gamma = rand() * 180 - 90;
    const a = core.eulerHeadings(alpha, beta, gamma);
    const b = matrixHeadings(alpha, beta, gamma);
    for (const k of ['top', 'back', 'right']) {
      if (b[k] === null) {
        nulls += 1;
        assert.equal(a[k], null);
      } else {
        assert.ok(a[k] !== null && circDiff(a[k], b[k]) < 1e-6, `${k} α=${alpha} β=${beta} γ=${gamma}: ${a[k]} vs ${b[k]}`);
      }
    }
    assert.ok(Math.abs(a.zUp - b.zUp) < 1e-12);
    assert.ok(Math.abs(core.tiltDeg(beta, gamma) - matrixTilt(alpha, beta, gamma)) < 1e-6);
  }
  assert.ok(nulls === 0, '隨機取樣不應碰到退化點(退化點另有固定案例)');
});

test('屬性: tilt 30→60° 之間航向對 tilt 連續無跳變(γ ≤ 30° 相鄰 0.1° 變化 < 1°,規格重算最大 0.67°)', () => {
  let worst = 0;
  for (const gamma of [0, 5, 10, 15, 20, 25, 30, -10, -30]) {
    for (const alpha of [0, 37, 123.4, 290]) {
      // 規格的連續性宣稱只涵蓋 beta >= 0(頂端抬高、螢幕朝向使用者)的姿態;beta < 0 見下一個「已知限制」測試
      let prev = null;
      for (let i = 0; i <= 300; i += 1) {
        const tilt = 30 + i * 0.1;
        const beta = betaForTilt(tilt, Math.abs(gamma));
        const h = core.pickHeadingBlend(alpha, beta, gamma).headingDeg;
        assert.notEqual(h, null, `α=${alpha} β=${beta} γ=${gamma}`);
        if (prev !== null) worst = Math.max(worst, circDiff(h, prev));
        prev = h;
      }
    }
  }
  assert.ok(worst < 1, `相鄰 0.1° 傾角最大航向變化 ${worst}`);
  assert.ok(worst > 0.3, `掃描太鈍,沒有量到規格說的約 0.67°: ${worst}`);
});

test('已知限制: beta < 0(頂端低於水平、螢幕背向使用者)在混合區頂端與後鏡頭方位相反,向量相消 → null/degenerate(規格未涵蓋)', () => {
  // beta=-45、gamma=0: top=h、back=h+180,w=0.5 時合成向量為 0
  const h = core.eulerHeadings(37, -45, 0);
  assert.ok(circDiff(h.back, (h.top + 180) % 360) < 1e-9);
  const r = core.pickHeadingBlend(37, -45, 0);
  assert.equal(r.mode, 'blend');
  assert.equal(r.headingDeg, null);
  assert.equal(core.decodeOrientationEvent({ alpha: 37, beta: -45, gamma: 0, absolute: true }).status, 'degenerate');
  // 混合區外照常: tilt <= 40 用頂端、>= 50 用後鏡頭
  assert.equal(core.pickHeadingBlend(37, -30, 0).mode, 'top');
  assert.equal(core.pickHeadingBlend(37, -60, 0).mode, 'back');
});

test('屬性: 舊遲滯做法在 tilt 50° 會跳變(規格 2.9.2 數字),smoothstep 混合沒有', () => {
  // alpha=0、tilt 恰 50°: 頂端 0°;後鏡頭 γ=5→353.5、10→346.9、20→333.5、30→319.3
  const expectedBack = { 5: 353.5, 10: 346.9, 20: 333.5, 30: 319.3 };
  for (const [g, back] of Object.entries(expectedBack)) {
    const gamma = Number(g);
    const before = core.pickPointingModeHysteresis(0, betaForTilt(49.999, gamma), gamma, 'top');
    const after = core.pickPointingModeHysteresis(0, betaForTilt(50.001, gamma), gamma, 'top');
    assert.equal(before.mode, 'top');
    assert.equal(after.mode, 'back');
    assert.ok(circDiff(before.heading, after.heading) > 6, `遲滯版 γ=${gamma} 應該跳 >6°`);
    assert.ok(circDiff(after.heading, back) < 0.05, `γ=${gamma} 後鏡頭方位應為 ${back},實得 ${after.heading}`);
    const b1 = core.pickHeadingBlend(0, betaForTilt(49.999, gamma), gamma).headingDeg;
    const b2 = core.pickHeadingBlend(0, betaForTilt(50.001, gamma), gamma).headingDeg;
    assert.ok(circDiff(b1, b2) < 0.05, `混合版 γ=${gamma} 跨 50° 應連續,實得差 ${circDiff(b1, b2)}`);
  }
});

test('屬性: 混合權重單調、對稱,邊界值精確', () => {
  let prev = 0;
  for (let i = 0; i <= 900; i += 1) {
    const w = core.blendWeight(i / 10);
    assert.ok(w >= prev - 1e-15 && w >= 0 && w <= 1);
    prev = w;
    assert.ok(Math.abs(core.blendWeight(40 + i / 90) + core.blendWeight(50 - i / 90) - 1) < 1e-12);
  }
  // smoothstep 的形狀(不是線性): t=0.25 → 0.15625、t=0.75 → 0.84375,兩端斜率為 0
  assert.equal(core.blendWeight(42.5), 0.15625);
  assert.equal(core.blendWeight(47.5), 0.84375);
  assert.ok(core.blendWeight(40.5) < 0.01 && core.blendWeight(49.5) > 0.99);
  assert.equal(core.blendWeight(0), 0);
  assert.equal(core.blendWeight(40), 0);
  assert.equal(core.blendWeight(45), 0.5);
  assert.equal(core.blendWeight(50), 1);
  assert.equal(core.blendWeight(90), 1);
  // 浮點雜訊不該讓邊界外的傾角變成 blend
  assert.equal(core.blendWeight(40 + 1e-12), 0);
  assert.equal(core.blendWeight(50 - 1e-12), 1);
});

test('屬性: tilt ≤ 40° 等於頂端方位、tilt ≥ 50° 等於後鏡頭方位(精確相等)', () => {
  const rand = rng(99);
  for (let i = 0; i < 1500; i += 1) {
    const alpha = rand() * 360;
    const beta = rand() * 360 - 180;
    const gamma = rand() * 180 - 90;
    const r = core.pickHeadingBlend(alpha, beta, gamma);
    const h = core.eulerHeadings(alpha, beta, gamma);
    if (r.tiltDeg <= 40 + 1e-9) {
      assert.equal(r.mode, 'top');
      assert.equal(r.headingDeg, h.top);
    } else if (r.tiltDeg >= 50 - 1e-9) {
      assert.equal(r.mode, 'back');
      assert.equal(r.headingDeg, h.back);
    } else {
      assert.equal(r.mode, 'blend');
      assert.ok(r.headingDeg !== null);
    }
    assert.equal(r.faceDown, h.zUp < 0);
    const ref = blendReference(alpha, beta, gamma);
    if (ref.heading !== null && r.headingDeg !== null) assert.ok(circDiff(r.headingDeg, ref.heading) < 1e-6);
  }
});

test('屬性: circularMean 跨 0,旋轉不變;EMA 跨 0 不繞 180', () => {
  assert.equal(circularMean([359, 1]).mean, 0);
  const rand = rng(5);
  for (let i = 0; i < 200; i += 1) {
    const base = Array.from({ length: 40 }, () => 350 + rand() * 20);
    const delta = rand() * 360;
    const a = core.lockAverage(base);
    const b = core.lockAverage(base.map((x) => (x + delta) % 360));
    assert.ok(circDiff(b.meanDeg, (a.meanDeg + delta) % 360) < 1e-9);
    assert.ok(Math.abs(a.stdDeg - b.stdDeg) < 1e-9);
  }
  // 每個 EMA 輸出都落在起點與目標之間的短弧上
  for (let i = 0; i < 300; i += 1) {
    const start = rand() * 360;
    const span = (rand() - 0.5) * 340; // 短弧,不含恰好 180
    const target = (((start + span) % 360) + 360) % 360;
    const k = 0.05 + rand() * 0.6;
    const out = core.circularEmaSeries(new Array(12).fill(target), { k, init: start, method: 'unit-vector' });
    for (const o of out) assert.ok(circDiff(start, o) + circDiff(o, target) - circDiff(start, target) < 1e-9, `start=${start} target=${target} out=${o}`);
    const arc = core.circularEmaSeries(new Array(12).fill(target), { k, init: start, method: 'shortest-arc' });
    for (const o of arc) assert.ok(circDiff(start, o) + circDiff(o, target) - circDiff(start, target) < 1e-9);
  }
});

test('屬性: roundHalf 落在 [0,360)、0.5 的倍數、誤差 ≤ 0.25,且等於 Math.round 半數進位參考式', () => {
  assert.equal(core.roundHalf(359.75), 0);
  assert.equal(core.roundHalf(0.25), 0.5);
  const rand = rng(11);
  for (let i = 0; i < 3000; i += 1) {
    const x = (rand() - 0.5) * 1440;
    const r = core.roundHalf(x);
    assert.ok(r >= 0 && r < 360);
    assert.equal(r * 2, Math.floor(r * 2));
    assert.ok(circDiff(r, x) <= 0.25 + 1e-9, `${x} -> ${r}`);
    const n = ((x % 360) + 360) % 360;
    assert.equal(r, (Math.round(n * 2) / 2) % 360, `${x}`);
  }
  // 半數進位而非銀行家捨入: .25 → .5、.75 → 1.0、1.25 → 1.5
  assert.equal(core.roundHalf(0.75), 1);
  assert.equal(core.roundHalf(1.25), 1.5);
  assert.equal(core.roundInt(0.5), 1);
  assert.equal(core.roundInt(1.5), 2);
  assert.equal(core.roundInt(2.5), 3);
  assert.equal(core.roundInt(359.5), 0);
  assert.equal(core.roundInt(-0.4), 0);
});

test('屬性: boundaryDistance 週期 15、範圍 [0,7.5],與 geo.analyzeBearing 的 boundaryDist 一致', () => {
  const rand = rng(3);
  for (let i = 0; i < 2000; i += 1) {
    const h = rand() * 360;
    const d = core.boundaryDistance(h);
    assert.ok(d >= 0 && d <= 7.5 + 1e-12);
    assert.ok(Math.abs(d - core.boundaryDistance(h + 15)) < 1e-9);
    assert.ok(Math.abs(d - analyzeBearing(h).boundaryDist) < 1e-9, `h=${h} ${d} vs ${analyzeBearing(h).boundaryDist}`);
  }
  throwsCode(() => core.boundaryDistance(NaN), 'INVALID_BEARING');
});

// ─────────────────────────── 規格內嵌表: 由規則重算 == 內嵌表(4.2 第 6 點) ───────────────────────────

test('內嵌表: k 表(60/30/20 Hz × τ 0.1/0.2/0.3/0.5)由 k=1-exp(-dt/τ) 重算 == 規格表', () => {
  const spec = parseSpecKTable();
  assert.deepEqual(Object.keys(spec).sort(), ['20', '30', '60']);
  for (const [hz, row] of Object.entries(spec)) {
    [0.1, 0.2, 0.3, 0.5].forEach((tau, i) => {
      const k = core.emaK(1 / Number(hz), tau);
      assert.equal(Math.round(k * 1e4) / 1e4, row[i], `${hz}Hz τ=${tau}: ${k}`);
    });
  }
});

test('內嵌表: 狀態碼訊息表 STATUS_INFO == 規格 2.9.5 表(逐字)', () => {
  const spec = parseSpecStatusTable();
  assert.deepEqual(Object.keys(core.STATUS_INFO).sort(), Object.keys(spec).sort());
  for (const [code, row] of Object.entries(spec)) {
    assert.equal(core.STATUS_INFO[code].message, row.message, code);
    assert.equal(core.STATUS_INFO[code].action, row.action, code);
  }
});

test('內嵌表: 所有非 ok 狀態都查得到訊息(no-sensor 沿用 no-events)', () => {
  for (const s of ['permission-denied', 'permission-error', 'no-events', 'relative-not-north', 'uncalibrated', 'invalid', 'tilt-too-large', 'unstable', 'too-few', 'degenerate', 'insecure-context', 'no-sensor']) {
    assert.ok(core.describeStatus(s), s);
  }
  assert.equal(core.describeStatus('no-sensor').message, core.STATUS_INFO['no-events'].message);
  assert.equal(core.describeStatus('ok'), null);
  assert.equal(core.describeStatus('running'), null);
  assert.equal(core.describeStatus('unsupported').message.length > 0, true);
});

test('內嵌表: 預設常數與規格一致', () => {
  const d = core.SENSOR_DEFAULTS;
  assert.equal(d.blendFromDeg, 40);
  assert.equal(d.blendToDeg, 50);
  assert.equal(d.iosTiltMaxDeg, 50);
  assert.equal(d.lockMaxTiltDeg, 15);
  assert.equal(d.sampleMs, 50);
  assert.equal(d.watchdogMs, 1500);
  assert.equal(d.emaTauSec, 0.2);
  assert.equal(d.lockMinSamples, 20);
  assert.equal(d.lockMaxStdDeg, 3);
  assert.ok(Object.isFrozen(d));
  // 3 秒 × 20 Hz ≈ 60 筆(規格 2.9.4 第 3 點)
  assert.equal(core.lockTargetSamples(3), 60);
  assert.equal(core.lockTargetSamples(5), 100);
  assert.equal(core.lockTargetSamples(10), 200);
});

// ─────────────────────────── 純函式行為 ───────────────────────────

test('decode: 優先序 iOS webkitCompassHeading > 絕對 alpha > 不可用;補充欄位 tiltDeg/faceDown', () => {
  // iOS 欄位存在時,即使同時有 absolute===true 也用 iOS 欄位
  const both = core.decodeOrientationEvent({ type: 'deviceorientation', alpha: 10, beta: 0, gamma: 0, absolute: true, webkitCompassHeading: 123, webkitCompassAccuracy: 8 });
  assert.equal(both.source, 'webkitCompassHeading');
  assert.equal(both.headingDeg, 123);
  assert.equal(both.tiltDeg, 0);
  // iOS 判定順序: 未校準 > 無效 > 傾斜過大
  const order = (o) => core.decodeOrientationEvent({ alpha: 0, beta: 85, gamma: 0, ...o }).status;
  assert.equal(order({ webkitCompassHeading: -5, webkitCompassAccuracy: -1 }), 'uncalibrated');
  assert.equal(order({ webkitCompassHeading: -5, webkitCompassAccuracy: 10 }), 'invalid');
  assert.equal(order({ webkitCompassHeading: 5, webkitCompassAccuracy: 10 }), 'tilt-too-large');
  // 邊界: tilt 恰好 50° 仍採信(> 才拒絕)
  const beta50 = betaForTilt(50, 0);
  assert.equal(core.decodeOrientationEvent({ alpha: 0, beta: beta50 - 1e-9, gamma: 0, webkitCompassHeading: 5 }).status, 'ok');
  assert.equal(core.decodeOrientationEvent({ alpha: 0, beta: beta50 + 1e-6, gamma: 0, webkitCompassHeading: 5 }).status, 'tilt-too-large');
  // iOS 沒帶姿態角: 無法判斷傾斜,採信航向,tiltDeg=null
  const noAngles = core.decodeOrientationEvent({ webkitCompassHeading: 30, webkitCompassAccuracy: 5 });
  assert.equal(noAngles.status, 'ok');
  assert.equal(noAngles.tiltDeg, null);
  // absolute 必須嚴格等於 true 才當北;缺欄位(undefined/null)、字串、數字 1 都不算
  for (const absolute of [false, null, undefined, 'true', 1]) {
    const r = core.decodeOrientationEvent({ alpha: 33, beta: 0, gamma: 0, absolute });
    assert.equal(r.status, 'relative-not-north', String(absolute));
    assert.equal(r.source, 'alpha-relative');
    assert.equal(r.headingDeg, null);
  }
  // 沒有任何欄位 / NaN 姿態角 → no-sensor
  assert.equal(core.decodeOrientationEvent({}).status, 'no-sensor');
  assert.equal(core.decodeOrientationEvent({ alpha: NaN, beta: 0, gamma: 0, absolute: true }).status, 'no-sensor');
  assert.equal(core.decodeOrientationEvent({ alpha: null, beta: 0, gamma: 0, absolute: true }).status, 'no-sensor');
  // 螢幕朝下旗標
  const down = core.decodeOrientationEvent({ alpha: 30, beta: 180, gamma: 0, absolute: true });
  assert.equal(down.faceDown, true);
  assert.equal(down.status, 'ok');
  // Android 混合區
  const mid = core.decodeOrientationEvent({ alpha: 0, beta: betaForTilt(45, 10), gamma: 10, absolute: true });
  assert.equal(mid.mode, 'blend');
  assert.ok(circDiff(mid.headingDeg, 352.892) < 1e-3);
  // 非物件輸入丟錯誤碼
  for (const bad of [null, undefined, 5, 'x']) throwsCode(() => core.decodeOrientationEvent(bad), 'INVALID_EVENT');
});

test('decode: 模糊輸入不丟錯、狀態碼都在已知集合、輸出可 JSON 序列化', () => {
  const known = new Set(['ok', 'uncalibrated', 'invalid', 'tilt-too-large', 'relative-not-north', 'no-sensor', 'degenerate']);
  const rand = rng(424242);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weird = [undefined, null, NaN, Infinity, -Infinity, '12', true, {}, [], -1, 0, 360, 720, 1e9, -1e9, 45.5];
  for (let i = 0; i < 3000; i += 1) {
    const num = () => (rand() < 0.6 ? rand() * 720 - 360 : pick(weird));
    const ev = { type: pick(['deviceorientation', 'deviceorientationabsolute', undefined]), alpha: num(), beta: num(), gamma: num(), absolute: pick([true, false, null, undefined, 'true']), webkitCompassHeading: num(), webkitCompassAccuracy: num() };
    const r = core.decodeOrientationEvent(ev);
    assert.ok(known.has(r.status), `${JSON.stringify(ev)} → ${r.status}`);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    if (r.status !== 'ok') assert.equal(r.headingDeg, null);
    else assert.ok(r.headingDeg >= 0 && r.headingDeg < 360, `${r.headingDeg}`);
  }
});

test('eulerHeadings / 姿態函式: 輸入不合法丟出以錯誤碼開頭的 Error', () => {
  throwsCode(() => core.pickPointingModeHysteresis(0, 0, 0, 'flat'), 'INVALID_OPTION');
  for (const bad of [NaN, Infinity, '1', null, undefined]) {
    throwsCode(() => core.eulerHeadings(bad, 0, 0), 'INVALID_ANGLE');
    throwsCode(() => core.eulerHeadings(0, bad, 0), 'INVALID_ANGLE');
    throwsCode(() => core.eulerHeadings(0, 0, bad), 'INVALID_ANGLE');
    throwsCode(() => core.tiltDeg(bad, 0), 'INVALID_ANGLE');
    throwsCode(() => core.pickHeadingBlend(0, bad, 0), 'INVALID_ANGLE');
  }
  throwsCode(() => core.screenUpHeading(0, 0, 0, 45), 'INVALID_ROTATION');
  throwsCode(() => core.screenAngleToDeviceRot('windows', 0), 'INVALID_PLATFORM');
  throwsCode(() => core.screenAngleToDeviceRot('ios', NaN), 'INVALID_BEARING');
  throwsCode(() => core.pickHeadingBlend(0, 0, 0, { fromDeg: 50, toDeg: 40 }), 'INVALID_OPTION');
  throwsCode(() => core.emaK(-1, 0.2), 'INVALID_OPTION');
  throwsCode(() => core.emaK(0.05, 0), 'INVALID_OPTION');
  throwsCode(() => core.roundHalf(Infinity), 'INVALID_BEARING');
  throwsCode(() => core.lockAverage([1, 2, NaN], { minSamples: 1 }), 'INVALID_BEARING');
  throwsCode(() => core.lockAverage('abc'), 'INVALID_READINGS');
  throwsCode(() => core.lockAverage([1], { minSamples: 0 }), 'INVALID_OPTION');
  throwsCode(() => core.iosUprightOffset({ alpha: 0, beta: 90, gamma: 0, webkitCompassHeading: 0 }, { alpha: 0, beta: 90, gamma: 0 }), 'INVALID_SAMPLE');
  throwsCode(() => core.iosUprightOffset({ alpha: 0, beta: 0, gamma: 0 }, { alpha: 0, beta: 90, gamma: 0 }), 'INVALID_SAMPLE');
});

test('退化點: 平放時後鏡頭方位為 null、直立時頂端方位為 null;混合只用有效者', () => {
  const flat = core.eulerHeadings(30, 0, 0);
  assert.equal(flat.back, null);
  assert.notEqual(flat.top, null);
  const upright = core.eulerHeadings(30, 90, 0);
  assert.equal(upright.top, null);
  assert.notEqual(upright.back, null);
  const f = core.pickHeadingBlend(30, 0, 0);
  assert.equal(f.mode, 'top');
  assert.equal(f.headingDeg, 330);
  const u = core.pickHeadingBlend(30, 90, 0);
  assert.equal(u.mode, 'back');
  assert.equal(u.headingDeg, upright.back);
  // 螢幕朝下的平放: 只用頂端方位,並帶 faceDown 旗標
  const d = core.pickHeadingBlend(30, 180, 0);
  assert.equal(d.faceDown, true);
  assert.ok(circDiff(d.headingDeg, 150) < 1e-9);
});

test('EMA: 向量式步進為純函式(不改傳入 state),第一筆直接採樣,近零向量回 null', () => {
  const s0 = Object.freeze({ x: 1, y: 0 });
  const s1 = core.emaVectorStep(s0, 90, 0.5);
  assert.deepEqual(s0, { x: 1, y: 0 });
  assert.notEqual(s1, s0);
  assert.ok(Math.abs(s1.x - 0.5) < 1e-12 && Math.abs(s1.y - 0.5) < 1e-12);
  const first = core.emaVectorStep(null, 200, 0.3);
  assert.ok(circDiff(core.emaHeading(first), 200) < 1e-9);
  const cancel = core.emaVectorStep({ x: 1, y: 0 }, 180, 0.5);
  assert.equal(core.emaHeading(cancel), null);
  assert.equal(core.emaHeading(null), null);
});

test('EMA: 與更新率無關(兩個 dt/2 步 == 一個 dt 步),且 τ 越小越快', () => {
  const tau = 0.2;
  const dt = 0.05;
  const half = core.emaK(dt / 2, tau);
  const full = core.emaK(dt, tau);
  let two = core.emaVectorStep({ x: 1, y: 0 }, 90, half);
  two = core.emaVectorStep(two, 90, half);
  const one = core.emaVectorStep({ x: 1, y: 0 }, 90, full);
  assert.ok(Math.abs(two.x - one.x) < 1e-12 && Math.abs(two.y - one.y) < 1e-12);
  assert.ok(core.emaK(0.05, 0.1) > core.emaK(0.05, 0.5));
  assert.equal(core.emaK(0, 0.2), 0);
});

test('鎖定平均: 選項預設(20 筆、σ>3° 不穩)、σ 恰 3° 為 ok、近零合成向量回 null', () => {
  assert.equal(core.lockAverage(new Array(19).fill(10)).status, 'too-few');
  assert.equal(core.lockAverage(new Array(20).fill(10)).status, 'ok');
  assert.ok(core.lockAverage(new Array(20).fill(10)).stdDeg < 1e-6);
  // 合成向量近 0: 一半 90° 一半 270°
  const opp = core.lockAverage([...new Array(15).fill(90), ...new Array(15).fill(270)]);
  assert.equal(opp.meanDeg, null);
  assert.equal(opp.stdDeg, null);
  assert.equal(opp.displayDeg, null);
  assert.equal(opp.status, 'unstable');
  // σ 恰好落在門檻上仍為 ok(<=)
  const sigma = (deg) => circularMean([deg, -deg, deg, -deg]).stdDeg;
  const edge = sigma(2.9);
  assert.ok(edge < 3);
  const ok = core.lockAverage([2.9, -2.9, 2.9, -2.9], { minSamples: 4, maxStdDeg: edge });
  assert.equal(ok.status, 'ok');
  assert.equal(core.lockAverage([3.5, -3.5, 3.5, -3.5], { minSamples: 4 }).status, 'unstable');
  // 鎖定平均後顯示到 0.5°,359.8 回捲為 0
  const r = core.lockAverage(new Array(25).fill(359.8));
  assert.equal(r.displayDeg, 0);
  assert.equal(core.lockAverage(new Array(25).fill(45.26)).displayDeg, 45.5);
});

test('三次量測: combineLockMeans 取圓周平均,不足三次為 too-few', () => {
  const a = core.combineLockMeans([359, 1, 0]);
  assert.equal(a.status, 'ok');
  assert.ok(circDiff(a.meanDeg, 0) < 1e-9);
  assert.equal(a.n, 3);
  assert.equal(core.combineLockMeans([10, 12]).status, 'too-few');
  assert.equal(core.combineLockMeans([10, 12], { minLocks: 2 }).status, 'ok');
  assert.equal(core.combineLockMeans([10, 60, 120]).status, 'unstable');
});

test('品質燈號: 規格 2.9.4 第 5 點門檻(邊界值含入較好一側)', () => {
  const q = (accuracyDeg, sigmaDeg) => core.qualityLight({ accuracyDeg, sigmaDeg });
  assert.equal(q(10, null), 'green');
  assert.equal(q(10.01, null), 'yellow');
  assert.equal(q(25, null), 'yellow');
  assert.equal(q(25.01, null), 'red');
  assert.equal(q(-1, null), 'red');
  assert.equal(q(null, 2), 'green');
  assert.equal(q(null, 2.01), 'yellow');
  assert.equal(q(null, 4), 'yellow');
  assert.equal(q(null, 4.01), 'red');
  assert.equal(q(null, null), 'unknown');
  assert.equal(core.qualityLight(), 'unknown');
  // 兩項都有時取較差者
  assert.equal(q(5, 4.5), 'red');
  assert.equal(q(12, 1), 'yellow');
  assert.equal(q(5, 1), 'green');
});

test('鎖定閘門: 傾角 < 15°、非未校準、非紅燈、非螢幕朝下、有有效讀數', () => {
  const ok = { status: 'ok', tiltDeg: 3, faceDown: false, quality: 'green' };
  assert.deepEqual(core.lockAllowed(ok), { allowed: true, reason: null });
  assert.equal(core.lockAllowed({ ...ok, tiltDeg: 14.99 }).allowed, true);
  assert.deepEqual(core.lockAllowed({ ...ok, tiltDeg: 15 }), { allowed: false, reason: 'tilt' });
  assert.equal(core.lockAllowed({ ...ok, status: 'uncalibrated' }).reason, 'uncalibrated');
  assert.equal(core.lockAllowed({ ...ok, status: 'tilt-too-large' }).reason, 'no-reading');
  assert.equal(core.lockAllowed({ ...ok, quality: 'red' }).reason, 'quality-red');
  assert.equal(core.lockAllowed({ ...ok, quality: 'yellow' }).allowed, true);
  assert.equal(core.lockAllowed({ ...ok, quality: 'unknown' }).allowed, true);
  assert.equal(core.lockAllowed({ ...ok, faceDown: true }).reason, 'face-down');
  assert.equal(core.lockAllowed({ ...ok, tiltDeg: null }).allowed, true);
  assert.equal(core.lockAllowed(null).reason, 'no-reading');
});

test('接近分界: boundaryDist < max(σ, accuracy/2, 2°)', () => {
  const nb = (headingDeg, sigmaDeg, accuracyDeg) => core.nearBoundary({ headingDeg, sigmaDeg, accuracyDeg });
  const a = nb(0, null, null); // 山中心,距分界 7.5
  assert.equal(a.near, false);
  assert.equal(a.distanceDeg, 7.5);
  assert.equal(a.thresholdDeg, 2);
  assert.equal(nb(7.4, null, null).near, true);
  assert.equal(nb(5.4, null, null).near, false); // 距 2.1,門檻 2
  assert.equal(nb(5.4, 2.5, null).near, true); // 門檻升到 σ=2.5
  assert.equal(nb(5.4, null, 10).near, true); // accuracy/2 = 5,距 2.1 < 5 → 接近
  assert.equal(nb(5.4, null, 10).thresholdDeg, 5);
  assert.equal(nb(1, null, 10).near, false); // 距 6.5 ≥ 5
  assert.equal(nb(1, null, -1).thresholdDeg, 2); // 未校準的 -1 不當門檻
});

test('summarizeLock: 不確定度 = max(measureUncertainty, 2σ, accuracy);ruleset 取自 Settings', () => {
  const noisy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 2.9 : -2.9)); // σ≈2.9 → 2σ≈5.8
  const s = core.summarizeLock(noisy);
  assert.equal(s.status, 'ok');
  assert.equal(s.uncertaintyDeg, measurementUncertainty({ baseline: 5, sigmaDeg: s.stdDeg, accuracyDeg: null }));
  assert.ok(s.uncertaintyDeg > 5.7 && s.uncertaintyDeg < 5.9);
  assert.equal(s.meta.schema, 'fengshui.sensor.lock/1');
  assert.deepEqual(s.meta.ruleset, { lockSeconds: 3, measureUncertainty: 5 });
  assert.equal(s.meta.northMode, 'magnetic');
  // iOS accuracy 較大時取 accuracy;自訂 measureUncertainty 進 ruleset 與結果
  const still = new Array(60).fill(100);
  assert.equal(core.summarizeLock(still, { accuracyDeg: 12 }).uncertaintyDeg, 12);
  const custom = core.summarizeLock(still, { settings: { measureUncertainty: 8, lockSeconds: 5 } });
  assert.equal(custom.uncertaintyDeg, 8);
  assert.deepEqual(custom.meta.ruleset, { lockSeconds: 5, measureUncertainty: 8 });
  assert.throws(() => core.summarizeLock(still, { settings: { nortMode: 'x' } }), /未知的設定鍵/);
  // 接近分界 → 警告;未校準的 -1 不進不確定度
  const edge = core.summarizeLock(new Array(60).fill(7.4));
  assert.equal(edge.nearBoundary, true);
  assert.ok(edge.meta.warnings.includes('nearBoundary'));
  const unc = core.summarizeLock(still, { accuracyDeg: -1 });
  assert.equal(unc.uncertaintyDeg, 5);
  assert.ok(unc.meta.warnings.includes('uncalibrated'));
  // 樣本不足: 不編造數字
  const few = core.summarizeLock([1, 2, 3]);
  assert.equal(few.status, 'too-few');
  assert.equal(few.meanDeg, null);
  assert.equal(few.uncertaintyDeg, null);
  assert.equal(few.boundaryDistDeg, null);
  assert.equal(few.nearBoundary, false);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('summarizeLock: 顯示值一律經 roundHalf,不顯示 0.1° 假精度', () => {
  const s = core.summarizeLock(new Array(60).fill(123.456));
  assert.equal(s.displayDeg, 123.5);
  assert.ok(Math.abs(s.meanDeg - 123.456) < 1e-9);
});

test('純函式不修改傳入物件、輸出可 JSON 序列化', () => {
  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
    return Object.freeze(o);
  };
  const ev = deepFreeze({ type: 'deviceorientationabsolute', alpha: 12, beta: 30, gamma: 5, absolute: true });
  const samples = deepFreeze(Array.from({ length: 30 }, (_, i) => 100 + (i % 3)));
  const outs = [
    core.decodeOrientationEvent(ev),
    core.lockAverage(samples),
    core.summarizeLock(samples, { accuracyDeg: 8, settings: deepFreeze({ lockSeconds: 3 }) }),
    core.combineLockMeans(deepFreeze([1, 2, 3])),
    core.pickHeadingBlend(12, 30, 5),
    core.pickPointingModeHysteresis(12, 30, 5),
    core.eulerHeadings(12, 30, 5),
    core.circularEmaSeries(samples, { k: 0.2, init: 100 }),
    core.iosUprightOffset(deepFreeze({ alpha: 297, beta: 0, gamma: 0, webkitCompassHeading: 100 }), deepFreeze({ alpha: 147, beta: 90, gamma: 0 })),
    core.nearBoundary({ headingDeg: 7.4 }),
    core.lockAllowed(deepFreeze({ status: 'ok', tiltDeg: 1, quality: 'green' })),
    core.describeStatus('no-events'),
  ];
  for (const o of outs) assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
});

test('static: 核心與適配層不碰全域(window/document/navigator/performance/計時器/亂數/網路),只 import geo 與 settings', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const file of ['sensor-core.js', 'sensor.js']) {
    const raw = readFileSync(path.join(SRC_DIR, file), 'utf8');
    const code = strip(raw);
    const banned = /(?<![.\w'"`])(window|document|navigator|performance|globalThis|localStorage|sessionStorage|fetch|XMLHttpRequest|require|process)\b(?!['"`])/g;
    const hits = [...code.matchAll(banned)].map((m) => m[1]);
    assert.deepEqual(hits, [], `${file} 出現全域: ${hits}`);
    assert.doesNotMatch(code, /(?<![.\w])(setInterval|setTimeout|clearInterval|clearTimeout|requestAnimationFrame)\s*\(/, `${file} 直接呼叫全域計時器`);
    assert.doesNotMatch(code, /(?<![.\w])(Date\.now|new Date|Math\.random)\b/, `${file} 直接用時鐘或亂數`);
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const i of imports) assert.ok(['./geo.js', './settings.js', './sensor-core.js'].includes(i), `${file} import 了 ${i}`);
    assert.doesNotMatch(raw, /暱稱|帥哥|ENI/, `${file} 出現暱稱`);
  }
});

// ─────────────────────────── createCompassSource(假環境) ───────────────────────────

/** 圓周近似相等(alpha→方位的三角函數換算有 1e-13 級浮點誤差)。 */
const near = (a, b, tol = 1e-9) => assert.ok(typeof a === 'number' && circDiff(a, b) <= tol, `期望 ${b},實得 ${a}`);

/** 用 alpha 讓頂端方位等於 heading(平放)。 */
const flatEvent = (heading, extra = {}) => ({ alpha: (360 - heading) % 360, beta: 0, gamma: 0, absolute: true, ...extra });

function makeSource(envOpts = {}, srcOpts = {}) {
  const fake = createFakeEnv(envOpts);
  const readings = [];
  const statuses = [];
  const source = createCompassSource({
    env: fake.env,
    onReading: (r) => readings.push(r),
    onStatus: (s, detail) => statuses.push(detail === undefined ? s : `${s}:${detail}`),
    ...srcOpts,
  });
  return { fake, source, readings, statuses };
}

test('source: 建立時不呼叫 requestPermission(必須由使用者手勢 start() 才呼叫)', () => {
  const { fake, source } = makeSource({ requestPermission: async () => 'granted' });
  assert.equal(fake.permissionCalls.length, 0);
  assert.equal(source.running, false);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
});

test('source: insecure-context、unsupported 直接回報,不掛監聽', async () => {
  const a = makeSource({ secure: false });
  assert.deepEqual(await a.source.start(), { ok: false, status: 'insecure-context' });
  assert.deepEqual(a.statuses, ['insecure-context']);
  assert.equal(a.fake.pendingTimers(), 0);
  const b = makeSource({ hasDOE: false });
  assert.deepEqual(await b.source.start(), { ok: false, status: 'unsupported' });
  assert.deepEqual(b.statuses, ['unsupported']);
  assert.equal(b.fake.listenerCount('deviceorientationabsolute'), 0);
});

test('source: requestPermission(true) 恰呼叫一次;granted 才掛監聽', async () => {
  const { fake, source, statuses } = makeSource({ requestPermission: async () => 'granted' });
  assert.deepEqual(await source.start(), { ok: true, status: 'running' });
  assert.deepEqual(fake.permissionCalls, [[true]]);
  assert.deepEqual(statuses, ['running']);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(source.running, true);
  // 重複 start() 不再呼叫權限
  assert.deepEqual(await source.start(), { ok: true, status: 'running' });
  assert.equal(fake.permissionCalls.length, 1);
});

test('source: 並行 start() 共用同一次權限流程', async () => {
  let resolve;
  const { fake, source } = makeSource({ requestPermission: () => new Promise((r) => { resolve = r; }) });
  const p1 = source.start();
  const p2 = source.start();
  resolve('granted');
  assert.deepEqual(await p1, { ok: true, status: 'running' });
  assert.deepEqual(await p2, { ok: true, status: 'running' });
  assert.equal(fake.permissionCalls.length, 1);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
});

test('source: 權限被拒 → permission-denied;例外 → permission-error(附原因);都不掛監聽', async () => {
  const denied = makeSource({ requestPermission: async () => 'denied' });
  assert.deepEqual(await denied.source.start(), { ok: false, status: 'permission-denied' });
  assert.deepEqual(denied.statuses, ['permission-denied']);
  assert.equal(denied.fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(denied.fake.pendingTimers(), 0);
  assert.equal(denied.source.running, false);

  const boom = makeSource({ requestPermission: async () => { throw new Error('NotAllowedError'); } });
  assert.deepEqual(await boom.source.start(), { ok: false, status: 'permission-error' });
  assert.equal(boom.statuses.length, 1);
  assert.match(boom.statuses[0], /^permission-error:.*NotAllowedError/);
  assert.equal(boom.fake.listenerCount('deviceorientationabsolute'), 0);
  // 之後在手勢內重試可成功(iOS 無手勢時 reject,有手勢就 granted)
  let n = 0;
  const retry = makeSource({ requestPermission: async () => { n += 1; if (n === 1) throw new Error('need gesture'); return 'granted'; } });
  assert.equal((await retry.source.start()).ok, false);
  assert.equal((await retry.source.start()).ok, true);
});

test('source: proceedOnPermissionError=true 時例外不致命,仍掛監聽由 watchdog 判斷(U-05 兩種情況皆正確)', async () => {
  const { fake, source, statuses } = makeSource(
    { requestPermission: async () => { throw new Error('nope'); } },
    { proceedOnPermissionError: true },
  );
  assert.deepEqual(await source.start(), { ok: true, status: 'running' });
  assert.match(statuses[0], /^permission-error:/);
  assert.equal(statuses[1], 'running');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  fake.advance(1500);
  assert.equal(statuses.at(-1), 'no-events');
  // 非 granted 的明確拒絕仍然致命
  const denied = makeSource({ requestPermission: async () => 'denied' }, { proceedOnPermissionError: true });
  assert.equal((await denied.source.start()).status, 'permission-denied');
});

test('source: Android 無 requestPermission 直接啟動;skipPermission 只給測試用', async () => {
  const a = makeSource({});
  assert.equal((await a.source.start()).ok, true);
  assert.equal(a.fake.permissionCalls.length, 0);
  const b = makeSource({ requestPermission: async () => 'denied' }, { skipPermission: true });
  assert.equal((await b.source.start()).ok, true);
  assert.equal(b.fake.permissionCalls.length, 0);
});

test('source: 有 ondeviceorientationabsolute 只聽 absolute;沒有就聽 deviceorientation;debug 旗標兩者都聽', async () => {
  const abs = makeSource({ hasAbsoluteEvent: true });
  await abs.source.start();
  assert.equal(abs.fake.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(abs.fake.listenerCount('deviceorientation'), 0);
  const ios = makeSource({ hasAbsoluteEvent: false });
  await ios.source.start();
  assert.equal(ios.fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(ios.fake.listenerCount('deviceorientation'), 1);
  const dbg = makeSource({ hasAbsoluteEvent: true }, { debugTreatRelativeAsAbsolute: true });
  await dbg.source.start();
  assert.equal(dbg.fake.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(dbg.fake.listenerCount('deviceorientation'), 1);
});

test('source: watchdog 1.5 秒無事件 → no-events(只一次);事件先到則不觸發;之後事件到達自動恢復', async () => {
  const a = makeSource();
  await a.source.start();
  a.fake.advance(1499);
  assert.deepEqual(a.statuses, ['running']);
  a.fake.advance(1);
  assert.deepEqual(a.statuses, ['running', 'no-events']);
  a.fake.advance(5000);
  assert.deepEqual(a.statuses, ['running', 'no-events']);
  // 保留監聽,事件一來就恢復
  a.fake.dispatch('deviceorientationabsolute', flatEvent(90));
  assert.deepEqual(a.statuses, ['running', 'no-events', 'running']);
  a.fake.advance(50);
  near(a.readings.at(-1).headingDeg, 90);

  const b = makeSource();
  await b.source.start();
  b.fake.advance(1000);
  b.fake.dispatch('deviceorientationabsolute', flatEvent(10));
  b.fake.advance(3000);
  assert.deepEqual(b.statuses, ['running']);
});

test('source: 20 Hz 計時器取樣;事件處理只存最新值,不逐事件處理', async () => {
  const { fake, source, readings } = makeSource();
  await source.start();
  fake.dispatch('deviceorientationabsolute', flatEvent(45));
  fake.advance(1000);
  assert.equal(readings.length, 20);
  assert.deepEqual(readings.map((r) => r.t).slice(0, 3), [50, 100, 150]);
  // 單一事件下計時器持續取樣;同一瞬間 1000 個事件仍只產生一筆讀數/tick
  for (let i = 0; i < 1000; i += 1) fake.dispatch('deviceorientationabsolute', flatEvent(46));
  fake.advance(50);
  assert.equal(readings.length, 21);
  near(readings.at(-1).headingDeg, 46);
  // 沒有事件之前的 tick 不產生讀數
  const early = makeSource();
  await early.source.start();
  early.fake.advance(500);
  assert.equal(early.readings.length, 0);
});

test('source: 讀數欄位與 JSON 可序列化;Android absolute 事件解碼', async () => {
  const { fake, source, readings } = makeSource();
  await source.start();
  fake.dispatch('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true });
  fake.advance(50);
  const r = readings[0];
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal(r.source, 'alpha-absolute');
  assert.equal(r.status, 'ok');
  assert.equal(r.mode, 'top-edge');
  near(r.headingDeg, 270);
  near(r.smoothedDeg, 270);
  assert.equal(r.displayDeg, 270);
  assert.equal(r.quality, 'unknown');
  assert.equal(r.sigmaDeg, null);
  assert.equal(r.t, 50);
  assert.deepEqual(source.getLastReading(), r);
  // 直立 → 後鏡頭
  fake.dispatch('deviceorientationabsolute', { alpha: 270, beta: 90, gamma: 0, absolute: true });
  fake.advance(50);
  assert.equal(readings.at(-1).mode, 'back-camera');
  near(readings.at(-1).headingDeg, 90);
});

test('source: 圓周 EMA 平滑 - 359/1 交替抖動圍繞 0 而非跳到 180;階躍收斂', async () => {
  const { fake, source, readings } = makeSource();
  await source.start();
  for (let i = 0; i < 40; i += 1) {
    fake.dispatch('deviceorientationabsolute', flatEvent(i % 2 ? 1 : 359));
    fake.advance(50);
  }
  assert.equal(readings.length, 40);
  for (const r of readings) assert.ok(circDiff(r.smoothedDeg, 0) <= 1 + 1e-9, `${r.smoothedDeg}`);
  const last = readings.at(-1);
  assert.ok(circDiff(last.smoothedDeg, 0) < 0.3, `平滑後應更靠近 0: ${last.smoothedDeg}`);
  // 階躍: 0 → 90,單調、不超過目標、1 秒(5τ)內收斂到 1° 以內
  readings.length = 0;
  for (let i = 0; i < 20; i += 1) {
    fake.dispatch('deviceorientationabsolute', flatEvent(90));
    fake.advance(50);
  }
  const path90 = readings.map((r) => r.smoothedDeg);
  // 起點是前一段抖動殘留的 ~0°,一路單調爬升到 90°,不超過目標
  for (let i = 1; i < path90.length; i += 1) assert.ok(path90[i] > path90[i - 1] && path90[i] <= 90 + 1e-9, `步 ${i}: ${path90[i - 1]} → ${path90[i]}`);
  assert.ok(circDiff(path90.at(-1), 90) < 1);
  // 顯示值即時 1°
  assert.equal(readings.at(-1).displayDeg, Math.floor(readings.at(-1).smoothedDeg + 0.5) % 360);
});

test('source: 相對事件不能當北(relative-not-north);debug 旗標把它當絕對', async () => {
  const a = makeSource();
  await a.source.start();
  a.fake.dispatch('deviceorientationabsolute', { alpha: 33, beta: 0, gamma: 0, absolute: false });
  a.fake.advance(50);
  assert.equal(a.readings[0].status, 'relative-not-north');
  assert.equal(a.readings[0].headingDeg, null);
  assert.equal(a.readings[0].smoothedDeg, null);
  assert.equal(a.readings[0].displayDeg, null);
  const b = makeSource({}, { debugTreatRelativeAsAbsolute: true });
  await b.source.start();
  b.fake.dispatch('deviceorientation', { alpha: 33, beta: 0, gamma: 0, absolute: false });
  b.fake.advance(50);
  assert.equal(b.readings[0].status, 'ok');
  assert.ok(circDiff(b.readings[0].headingDeg, 327) < 1e-9);
});

test('source: iOS 樣式事件(webkitCompassHeading)與未校準', async () => {
  const { fake, source, readings } = makeSource({ hasAbsoluteEvent: false, requestPermission: async () => 'granted' });
  await source.start();
  fake.dispatch('deviceorientation', { alpha: 123, beta: 2, gamma: 1, webkitCompassHeading: 200, webkitCompassAccuracy: 10 });
  fake.advance(50);
  assert.equal(readings[0].source, 'webkitCompassHeading');
  assert.equal(readings[0].headingDeg, 200);
  assert.equal(readings[0].quality, 'green');
  fake.dispatch('deviceorientation', { alpha: 123, beta: 2, gamma: 1, webkitCompassHeading: 200, webkitCompassAccuracy: -1 });
  fake.advance(50);
  assert.equal(readings[1].status, 'uncalibrated');
  assert.equal(readings[1].quality, 'red');
  assert.equal(readings[1].smoothedDeg, null);
  // 傾斜過大
  fake.dispatch('deviceorientation', { alpha: 147, beta: 85, gamma: 0, webkitCompassHeading: 200, webkitCompassAccuracy: 10 });
  fake.advance(50);
  assert.equal(readings[2].status, 'tilt-too-large');
  // 恢復後 EMA 從新值重新起算(不從過期狀態拖曳)
  fake.dispatch('deviceorientation', { alpha: 123, beta: 2, gamma: 1, webkitCompassHeading: 20, webkitCompassAccuracy: 10 });
  fake.advance(50);
  near(readings[3].smoothedDeg, 20);
});

test('source: 即時 σ 與品質燈號(Android): 穩定 → green;抖動 > 4° → red', async () => {
  const steady = makeSource();
  await steady.source.start();
  for (let i = 0; i < 30; i += 1) {
    steady.fake.dispatch('deviceorientationabsolute', flatEvent(100 + (i % 2 ? 0.3 : -0.3)));
    steady.fake.advance(50);
  }
  assert.equal(steady.readings.at(-1).quality, 'green');
  assert.ok(steady.readings.at(-1).sigmaDeg < 1);
  const noisy = makeSource();
  await noisy.source.start();
  for (let i = 0; i < 30; i += 1) {
    noisy.fake.dispatch('deviceorientationabsolute', flatEvent(100 + (i % 2 ? 10 : -10)));
    noisy.fake.advance(50);
  }
  assert.equal(noisy.readings.at(-1).quality, 'red');
  assert.ok(noisy.readings.at(-1).sigmaDeg > 8);
});

test('source: stop() 清掉監聽與計時器,之後不再有讀數;可重新 start()', async () => {
  const { fake, source, readings } = makeSource({ requestPermission: async () => 'granted' });
  await source.start();
  fake.dispatch('deviceorientationabsolute', flatEvent(10));
  fake.advance(100);
  const n = readings.length;
  source.stop();
  assert.equal(source.running, false);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
  assert.equal(fake.docListenerCount('visibilitychange'), 0);
  fake.dispatch('deviceorientationabsolute', flatEvent(20));
  fake.advance(1000);
  assert.equal(readings.length, n);
  assert.equal(source.getLastReading(), null);
  assert.deepEqual(await source.start(), { ok: true, status: 'running' });
  assert.equal(fake.permissionCalls.length, 2);
  fake.dispatch('deviceorientationabsolute', flatEvent(30));
  fake.advance(50);
  near(readings.at(-1).headingDeg, 30);
  near(readings.at(-1).smoothedDeg, 30, 1e-9);
});

test('source: 等待權限時被 stop() → start 回 cancelled,且不會事後掛監聽', async () => {
  let resolve;
  const { fake, source } = makeSource({ requestPermission: () => new Promise((r) => { resolve = r; }) });
  const p = source.start();
  source.stop();
  resolve('granted');
  assert.deepEqual(await p, { ok: false, status: 'cancelled' });
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
  assert.equal(source.running, false);
});

test('source: 頁面進背景 → 停掉監聽;回前景 → 重掛、重計 watchdog、不再要求權限', async () => {
  const { fake, source, statuses, readings } = makeSource({ requestPermission: async () => 'granted' });
  await source.start();
  fake.dispatch('deviceorientationabsolute', flatEvent(10));
  fake.advance(100);
  fake.setVisibility('hidden');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
  assert.equal(source.running, false);
  const n = readings.length;
  fake.advance(5000);
  assert.equal(readings.length, n);
  fake.setVisibility('visible');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(source.running, true);
  assert.equal(fake.permissionCalls.length, 1);
  assert.equal(statuses.filter((s) => s === 'running').length, 2);
  // watchdog 重新計時: 回前景後 1.5 秒沒事件 → no-events
  fake.advance(1499);
  assert.ok(!statuses.includes('no-events'));
  fake.advance(1);
  assert.equal(statuses.at(-1), 'no-events');
  // 回前景後舊讀數已清空: EMA 從新值開始
  fake.dispatch('deviceorientationabsolute', flatEvent(200));
  fake.advance(50);
  near(readings.at(-1).smoothedDeg, 200);
});

test('source: resume()(Capacitor appStateChange 用)= stop 再 start 的效果但不重問權限;未啟動時回 false', async () => {
  const { fake, source, statuses } = makeSource({ requestPermission: async () => 'granted' });
  assert.equal(source.resume(), false);
  await source.start();
  fake.advance(1000);
  assert.equal(source.resume(), true);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  assert.equal(fake.pendingTimers(), 2);
  assert.equal(fake.permissionCalls.length, 1);
  assert.equal(statuses.filter((s) => s === 'running').length, 2);
  fake.advance(1500);
  assert.equal(statuses.at(-1), 'no-events');
  source.stop();
  assert.equal(source.resume(), false);
  fake.setVisibility('visible');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
});

test('source: 沒有 document 也能運作(無可見性處理)', async () => {
  const { fake, source } = makeSource({ withDoc: false });
  assert.equal((await source.start()).ok, true);
  assert.equal(fake.doc, null);
  source.stop();
});

/** 對 source 灌入 heading 序列(每筆一個 tick),回傳 tick 之間 dispatch 的次數。 */
async function feed(fake, headings, extra = {}) {
  for (const h of headings) {
    fake.dispatch('deviceorientationabsolute', flatEvent(h, extra));
    fake.advance(50);
  }
}

const LOCK_OK = fixture.cases.find((c) => c.name === 'lock_average_ok_crossing_north');
const LOCK_NOISY = fixture.cases.find((c) => c.name === 'lock_average_unstable_noisy');

test('lock: 3 秒 × 20 Hz = 60 筆,跨北平均約 359.6(fixtures 資料)', async () => {
  const { fake, source } = makeSource();
  await source.start();
  await feed(fake, [359.6]);
  const p = source.lock();
  await feed(fake, LOCK_OK.input.samplesDeg);
  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.n, 60);
  assert.ok(circDiff(r.meanDeg, LOCK_OK.expected.meanDeg) < TOL);
  assert.ok(Math.abs(r.stdDeg - LOCK_OK.expected.stdDeg) < TOL);
  assert.equal(r.displayDeg, 359.5);
  assert.equal(r.lockedAtMs, fake.clock, 'lockedAtMs 取注入的時鐘(完成當下)');
  assert.equal(r.meta.schema, 'fengshui.sensor.lock/1');
  assert.equal(r.meta.ruleset.lockSeconds, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal(fake.pendingTimers(), 1, '鎖定完成後取樣計時器仍在(watchdog 已因首個事件解除)');
});

test('lock: 使用原始讀數而非 EMA 平滑值(平滑會低估 σ)', async () => {
  const { fake, source } = makeSource();
  await source.start();
  await feed(fake, [100]);
  const p = source.lock();
  await feed(fake, Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 2.5 : -2.5)));
  const r = await p;
  assert.equal(r.status, 'ok');
  assert.ok(r.stdDeg > 2.4, `σ 應接近 2.5,實得 ${r.stdDeg}`);
});

test('lock: 噪聲 ±18° → unstable(仍回平均與 σ);樣本太少 → too-few', async () => {
  const noisy = makeSource();
  await noisy.source.start();
  await feed(noisy.fake, [LOCK_NOISY.input.samplesDeg[0]]);
  const p = noisy.source.lock();
  await feed(noisy.fake, LOCK_NOISY.input.samplesDeg);
  const r = await p;
  assert.equal(r.status, 'unstable');
  assert.ok(circDiff(r.meanDeg, LOCK_NOISY.expected.meanDeg) < TOL);
  assert.ok(Math.abs(r.stdDeg - LOCK_NOISY.expected.stdDeg) < TOL);

  const few = makeSource({}, { settings: { lockSeconds: 0.5 } });
  await few.source.start();
  await feed(few.fake, [50]);
  const q = few.source.lock();
  await feed(few.fake, new Array(10).fill(50));
  const s = await q;
  assert.equal(s.status, 'too-few');
  assert.equal(s.n, 10);
  assert.equal(s.meanDeg, null);
});

test('lock: lockSeconds 取自 Settings(5 秒 → 100 筆);measureUncertainty 進不確定度', async () => {
  const { fake, source } = makeSource({}, { settings: { lockSeconds: 5, measureUncertainty: 9 } });
  await source.start();
  await feed(fake, [10]);
  const p = source.lock();
  await feed(fake, new Array(100).fill(10));
  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.n, 100);
  assert.equal(r.uncertaintyDeg, 9);
  assert.deepEqual(r.meta.ruleset, { lockSeconds: 5, measureUncertainty: 9 });
});

test('lock: iOS 鎖定帶入 accuracy 取窗內最大值', async () => {
  const { fake, source } = makeSource({ hasAbsoluteEvent: false, requestPermission: async () => 'granted' });
  await source.start();
  const ev = (acc) => ({ alpha: 1, beta: 0, gamma: 0, webkitCompassHeading: 150, webkitCompassAccuracy: acc });
  fake.dispatch('deviceorientation', ev(8));
  fake.advance(50);
  const p = source.lock();
  for (let i = 0; i < 60; i += 1) {
    fake.dispatch('deviceorientation', ev(i === 30 ? 14 : 8));
    fake.advance(50);
  }
  const r = await p;
  assert.equal(r.status, 'ok');
  assert.equal(r.accuracyDeg, 14);
  assert.equal(r.uncertaintyDeg, 14);
});

test('lock: 閘門 - 未啟動、無讀數、傾角 ≥ 15°、未校準、紅燈(σ>4°)、螢幕朝下皆立即回 blocked', async () => {
  const idle = makeSource();
  assert.deepEqual(await idle.source.lock(), { status: 'blocked', reason: 'not-running' });

  const noRead = makeSource();
  await noRead.source.start();
  assert.deepEqual(await noRead.source.lock(), { status: 'blocked', reason: 'no-reading' });

  const tilted = makeSource();
  await tilted.source.start();
  tilted.fake.dispatch('deviceorientationabsolute', { alpha: 0, beta: 20, gamma: 0, absolute: true });
  tilted.fake.advance(50);
  assert.deepEqual(await tilted.source.lock(), { status: 'blocked', reason: 'tilt' });

  const unc = makeSource({ hasAbsoluteEvent: false, requestPermission: async () => 'granted' });
  await unc.source.start();
  unc.fake.dispatch('deviceorientation', { alpha: 1, beta: 0, gamma: 0, webkitCompassHeading: 10, webkitCompassAccuracy: -1 });
  unc.fake.advance(50);
  assert.deepEqual(await unc.source.lock(), { status: 'blocked', reason: 'uncalibrated' });

  const red = makeSource();
  await red.source.start();
  await feed(red.fake, Array.from({ length: 20 }, (_, i) => 100 + (i % 2 ? 10 : -10)));
  assert.deepEqual(await red.source.lock(), { status: 'blocked', reason: 'quality-red' });

  const down = makeSource();
  await down.source.start();
  down.fake.dispatch('deviceorientationabsolute', { alpha: 30, beta: 180, gamma: 0, absolute: true });
  down.fake.advance(50);
  assert.deepEqual(await down.source.lock(), { status: 'blocked', reason: 'face-down' });
});

test('lock: 鎖定期間傾角 ≥ 15° 的樣本被丟棄(不信任)→ 樣本不足時 too-few', async () => {
  const { fake, source } = makeSource();
  await source.start();
  await feed(fake, [100]);
  const p = source.lock();
  for (let i = 0; i < 60; i += 1) {
    fake.dispatch('deviceorientationabsolute', { alpha: 260, beta: i < 45 ? 25 : 2, gamma: 0, absolute: true });
    fake.advance(50);
  }
  const r = await p;
  assert.equal(r.status, 'too-few');
  assert.equal(r.n, 15);
});

test('lock: 進行中 stop() 或進背景 → cancelled;重複 lock() 回同一個 promise', async () => {
  const a = makeSource();
  await a.source.start();
  await feed(a.fake, [100]);
  const p = a.source.lock();
  assert.equal(a.source.lock(), p);
  await feed(a.fake, [100, 100]);
  a.source.stop();
  assert.deepEqual(await p, { status: 'cancelled' });

  const b = makeSource();
  await b.source.start();
  await feed(b.fake, [100]);
  const q = b.source.lock();
  b.fake.setVisibility('hidden');
  assert.deepEqual(await q, { status: 'cancelled' });
});

test('lock: 設定值不合法 → 丟 INVALID_OPTION', () => {
  for (const lockSeconds of [0, -3, NaN, Infinity]) {
    throwsCode(() => makeSource({}, { settings: { lockSeconds } }), 'INVALID_OPTION');
  }
  assert.throws(() => makeSource({}, { settings: { lockSecs: 3 } }), /未知的設定鍵/);
  throwsCode(() => makeSource({}, { sampleMs: 0 }), 'INVALID_OPTION');
  throwsCode(() => makeSource({}, { tauSec: -1 }), 'INVALID_OPTION');
  throwsCode(() => createCompassSource({}), 'INVALID_OPTION');
  throwsCode(() => createCompassSource({ env: {} }), 'INVALID_OPTION');
});

test('createBrowserEnv: 全域由參數注入,計時器綁定原物件,時間為 ms epoch', () => {
  const calls = [];
  const g = {
    isSecureContext: true,
    document: { visibilityState: 'visible' },
    performance: { timeOrigin: 1_700_000_000_000, now: () => 1234.5 },
    setInterval(fn, ms) { calls.push(['setInterval', this === g, ms]); return 1; },
    clearInterval() { calls.push(['clearInterval', this === g]); },
    setTimeout(fn, ms) { calls.push(['setTimeout', this === g, ms]); return 2; },
    clearTimeout() { calls.push(['clearTimeout', this === g]); },
    addEventListener() {},
    removeEventListener() {},
  };
  const env = createBrowserEnv(g);
  assert.equal(env.win, g);
  assert.equal(env.doc, g.document);
  assert.equal(env.now(), 1_700_000_001_234.5);
  env.timers.setInterval(() => {}, 50);
  env.timers.clearInterval(1);
  env.timers.setTimeout(() => {}, 10);
  env.timers.clearTimeout(2);
  assert.deepEqual(calls, [['setInterval', true, 50], ['clearInterval', true], ['setTimeout', true, 10], ['clearTimeout', true]]);
  // 沒有 performance 時退回 Date.now
  const g2 = { ...g, performance: undefined, Date: { now: () => 42 } };
  assert.equal(createBrowserEnv(g2).now(), 42);
  assert.equal(createBrowserEnv({ ...g, document: undefined }).doc, null);
  throwsCode(() => createBrowserEnv(null), 'INVALID_OPTION');
});

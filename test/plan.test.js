// plan 模組測試。本模組沒有 fixtures,以規格 2.7.3 的數值範例(直接由規格文字解析,不手抄)、
// 2.7.6 屬性測試(面積守恆、旋轉 45 度等變、正方形對稱、矩形重心=外框中心)為準。
// 精確面積另用獨立的有號三角形分解 oracle 對拍(test/helpers/plan.js);突變測試證明 runner 抓得到錯誤期望值。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertRunnerCatches, assertDeepApprox, GUA } from './helpers/harness.js';
import {
  SPEC_TEXT,
  mulberry32,
  range,
  rectPoly,
  L_SHAPE,
  U_SHAPE,
  T_SHAPE,
  randomStarPolygon,
  translate,
  scale,
  rotateCW,
  reversed,
  rotateStart,
  makePlan,
  deepFreeze,
  signedArea,
  fanCentroid,
  bboxCenter,
  sectorIndexOfVector,
  oracleSectorAreas,
  gridSectorAreas,
  parseSpecAreaExamples,
  parseSpecSharesExample,
  parseSpecPlanExample,
} from './helpers/plan.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as geo from '../src/core/geo.js';
import * as plan from '../src/core/plan.js';

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const sum = (a) => a.reduce((s, v) => s + v, 0);
const areaArr = (obj) => GUA.map((g) => obj[g]);
const closeRel = (a, b, tol, ctx = '') =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${ctx} expected ${b}, got ${a} (tol ${tol})`);
const closeArr = (a, b, tol, ctx = '') => {
  assert.equal(a.length, b.length, `${ctx} length`);
  a.forEach((v, i) => closeRel(v, b[i], tol, `${ctx}[${i}]`));
};
const guaShift = (k, n) => GUA[(((k + n) % 8) + 8) % 8];
/** plan 內明寫的模式優先於 settings.taijiMode,所以要測 bbox 就把模式寫進 plan。 */
const bboxTaiji = { mode: 'bbox', manual: null };

const RECT_10x8 = rectPoly(0, 0, 10, 8);
const SQUARE_8 = rectPoly(0, 0, 8, 8);

// ═══════════════════════════ A. 規格 2.7.3 數值範例 ═══════════════════════════

const SPEC_AREAS = parseSpecAreaExamples();

/** 規格數值案例 runner: 對 palaceArea 與 shares 逐宮比對(規格印到小數 6 位,容差 1e-6)。 */
function runAreaCase(c) {
  const res = plan.sectorShares(c.plan);
  GUA.forEach((g) => {
    assert.ok(
      Math.abs(res.palaceArea[g] - c.expected[g]) <= 1e-6,
      `${c.name} ${g}: expected ${c.expected[g]}, got ${res.palaceArea[g]}`,
    );
  });
  assert.ok(Math.abs(res.totalArea - c.total) <= 1e-9, `${c.name} total ${res.totalArea} != ${c.total}`);
  assert.ok(Math.abs(sum(areaArr(res.palaceArea)) - c.total) <= 1e-9, `${c.name} 各宮和`);
}

const AREA_CASES = [
  { name: '10x8 矩形 planUp=0', plan: makePlan({ outline: RECT_10x8, planUpBearing: 0 }), expected: SPEC_AREAS.rect0.areas, total: SPEC_AREAS.rect0.total },
  { name: '10x8 矩形 planUp=30', plan: makePlan({ outline: RECT_10x8, planUpBearing: 30 }), expected: SPEC_AREAS.rect30.areas, total: SPEC_AREAS.rect30.total },
  {
    name: '8x8 正方形 planUp=0',
    plan: makePlan({ outline: SQUARE_8, planUpBearing: 0 }),
    expected: Object.fromEntries(GUA.map((g, k) => [g, k % 2 === 0 ? SPEC_AREAS.square.cardinal : SPEC_AREAS.square.diagonal])),
    total: 64,
  },
  { name: 'L 型 planUp=0', plan: makePlan({ outline: L_SHAPE, planUpBearing: 0 }), expected: SPEC_AREAS.lshape.areas, total: SPEC_AREAS.lshape.total },
];

describe('規格 2.7.3 面積範例(由規格文字解析)', () => {
  it('解析出的規格數值完整(每組 8 宮,總和與 8 宮加總吻合)', () => {
    for (const key of ['rect0', 'rect30', 'lshape']) {
      const { areas, total } = SPEC_AREAS[key];
      assert.equal(Object.keys(areas).length, 8, key);
      assert.ok(Math.abs(sum(Object.values(areas)) - total) <= 1e-5, `${key} 規格自身總和`);
    }
    assert.ok(Math.abs(4 * SPEC_AREAS.square.cardinal + 4 * SPEC_AREAS.square.diagonal - 64) <= 1e-5);
  });

  for (const c of AREA_CASES) {
    it(`${c.name}: 各宮面積 == 規格`, () => runAreaCase(c));
  }

  it('規格 sectorShares 輸出範例(10x8 單一房間 living): taiji/totalArea/palaces/mainUse 逐欄吻合', () => {
    const example = parseSpecSharesExample();
    const res = plan.sectorShares(makePlan({ outline: RECT_10x8, planUpBearing: 0 }));
    const picked = { taiji: res.taiji, planUpBearing: res.planUpBearing, totalArea: res.totalArea, palaces: res.palaces, mainUse: res.mainUse };
    assertDeepApprox(picked, example, 1e-6);
    assert.deepEqual(res.mainUse, example.mainUse);
  });

  it('規格 2.7.1 資料結構範例是合法平面圖', () => {
    const ex = parseSpecPlanExample();
    const report = plan.validatePlan(ex);
    assert.deepEqual(report.errors, []);
    assert.equal(report.ok, true);
    const res = plan.sectorShares(ex);
    closeRel(res.totalArea, 30, 1e-12);
    // planUp=30、6x5、太極點 (3,2.5)
    assert.deepEqual(res.taiji, [3, 2.5]);
  });

  it('突變: 改錯期望值(+0.001、或平面圖上方角度差 1 度)會被 runner 抓出', () => {
    for (const c of AREA_CASES) {
      runAreaCase(c); // 原案例必須過
      assertRunnerCatches(runAreaCase, { ...c, expected: { ...c.expected, 坎: c.expected.坎 + 1e-3 } });
      assertRunnerCatches(runAreaCase, { ...c, total: c.total + 1e-3 });
      const shifted = clone(c.plan);
      shifted.planUpBearing += 1;
      assertRunnerCatches(runAreaCase, { ...c, plan: shifted });
    }
  });
});

// ═══════════════════════════ B. 太極點(D55) ═══════════════════════════

describe('taijiPoint 太極點', () => {
  it('L 型(規格 2.7.2 範例): centroid (2.5,2.5)、bbox (3,3)', () => {
    const p = makePlan({ outline: L_SHAPE });
    const c = plan.taijiPoint(p);
    assert.equal(c.mode, 'centroid');
    closeArr(c.point, [2.5, 2.5], 1e-12);
    assert.deepEqual(c.warnings, []);
    const b = plan.taijiPoint(makePlan({ outline: L_SHAPE, taiji: bboxTaiji }));
    assert.equal(b.mode, 'bbox');
    closeArr(b.point, [3, 3], 1e-12);
  });

  it('凸字型: 重心 (4.5, 2.25),形內無警告', () => {
    const c = plan.taijiPoint(makePlan({ outline: T_SHAPE }));
    closeArr(c.point, [4.5, 2.25], 1e-12);
    assert.deepEqual(c.warnings, []);
  });

  it('U 型: 重心落在兩臂缺口(牆外) → warnings taijiOutsideOutline,計算照常', () => {
    const c = plan.taijiPoint(makePlan({ outline: U_SHAPE }));
    closeArr(c.point, [3, 76 / 28], 1e-12);
    assert.deepEqual(c.warnings, ['taijiOutsideOutline']);
    // 改選 bbox (3,3) 也在缺口內(缺口 x∈(2,4) y∈(2,6))
    assert.deepEqual(plan.taijiPoint(makePlan({ outline: U_SHAPE, taiji: bboxTaiji })).warnings, ['taijiOutsideOutline']);
    // 手動點在牆內則無警告
    const manual = plan.taijiPoint(makePlan({ outline: U_SHAPE, taiji: { mode: 'manual', manual: [1, 1] } }));
    assert.deepEqual(manual.point, [1, 1]);
    assert.deepEqual(manual.warnings, []);
  });

  it('外框頂點在牆上(邊界)不算牆外: L 型 bbox (3,3) 是凹角頂點', () => {
    assert.deepEqual(plan.taijiPoint(makePlan({ outline: L_SHAPE, taiji: bboxTaiji })).warnings, []);
  });

  it('manual 模式回傳使用者點選的點;缺 manual 或格式錯誤丟 INVALID_PLAN', () => {
    const p = makePlan({ outline: RECT_10x8, taiji: { mode: 'manual', manual: [2, 3] } });
    assert.deepEqual(plan.taijiPoint(p).point, [2, 3]);
    throwsCode(() => plan.taijiPoint(makePlan({ outline: RECT_10x8, taiji: { mode: 'manual', manual: null } })), 'INVALID_PLAN');
    throwsCode(() => plan.taijiPoint(makePlan({ outline: RECT_10x8, taiji: { mode: 'manual', manual: [2] } })), 'INVALID_PLAN');
    throwsCode(() => plan.taijiPoint(makePlan({ outline: RECT_10x8, taiji: { mode: 'manual', manual: [NaN, 1] } })), 'INVALID_PLAN');
  });

  it('模式來源: plan.taiji.mode 優先;未指定時取 settings.taijiMode(預設 centroid)', () => {
    const noMode = makePlan({ outline: L_SHAPE, taiji: { mode: null, manual: null } });
    assert.equal(plan.taijiPoint(noMode).mode, DEFAULT_SETTINGS.taijiMode);
    assert.equal(plan.taijiPoint(noMode, { taijiMode: 'bbox' }).mode, 'bbox');
    const planMode = makePlan({ outline: L_SHAPE, taiji: { mode: 'centroid', manual: null } });
    assert.equal(plan.taijiPoint(planMode, { taijiMode: 'bbox' }).mode, 'centroid');
    const noTaijiField = makePlan({ outline: L_SHAPE });
    delete noTaijiField.taiji;
    assert.equal(plan.taijiPoint(noTaijiField).mode, 'centroid');
  });

  it('未知模式: INVALID_TAIJI_MODE(settings)或 INVALID_PLAN(plan 內)', () => {
    const p = makePlan({ outline: RECT_10x8, taiji: { mode: null, manual: null } });
    throwsCode(() => plan.taijiPoint(p, { taijiMode: 'edge' }), 'INVALID_TAIJI_MODE');
    throwsCode(() => plan.taijiPoint(makePlan({ outline: RECT_10x8, taiji: { mode: 'edge', manual: null } })), 'INVALID_PLAN');
  });

  it('未知設定鍵直接丟錯(避免拼錯開關默默失效)', () => {
    throwsCode(() => plan.taijiPoint(makePlan({ outline: RECT_10x8 }), { taijiMod: 'bbox' }), '未知的設定鍵');
  });

  it('屬性: 矩形重心 == 外框中心,與頂點順序、起點、平移無關(200 組)', () => {
    const rng = mulberry32(20260929);
    for (let i = 0; i < 200; i += 1) {
      const w = range(rng, 0.5, 30);
      const d = range(rng, 0.5, 30);
      let poly = rectPoly(range(rng, -500, 500), range(rng, -500, 500), w, d);
      if (rng() < 0.5) poly = reversed(poly);
      poly = rotateStart(poly, Math.floor(rng() * 4));
      const c = plan.taijiPoint(makePlan({ outline: poly })).point;
      const b = plan.taijiPoint(makePlan({ outline: poly, taiji: bboxTaiji })).point;
      const ref = bboxCenter(poly);
      closeArr(c, ref, 1e-9, `#${i} centroid`);
      closeArr(b, ref, 1e-9, `#${i} bbox`);
    }
  });

  it('屬性: 任意星形多邊形的重心 == 獨立的三角形分解重心;平移等變、頂點順序無關(150 組)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 150; i += 1) {
      const n = 5 + Math.floor(rng() * 8);
      let poly = randomStarPolygon(rng, n, range(rng, -50, 50), range(rng, -50, 50));
      if (rng() < 0.5) poly = reversed(poly);
      poly = rotateStart(poly, Math.floor(rng() * n));
      const got = plan.taijiPoint(makePlan({ outline: poly })).point;
      closeArr(got, fanCentroid(poly), 1e-9, `#${i}`);
      const moved = plan.taijiPoint(makePlan({ outline: translate(poly, 1000, -2500) })).point;
      closeArr(moved, [got[0] + 1000, got[1] - 2500], 1e-9, `#${i} 平移`);
    }
  });

  it('polygonArea / polygonCentroid / pointInPolygon 小工具', () => {
    assert.equal(plan.polygonArea(RECT_10x8), 80);
    assert.equal(plan.polygonArea(reversed(RECT_10x8)), 80);
    assert.equal(plan.polygonArea(L_SHAPE), 27);
    closeArr(plan.polygonCentroid(L_SHAPE), [2.5, 2.5], 1e-12);
    assert.equal(plan.pointInPolygon(L_SHAPE, [1, 1]), 'inside');
    assert.equal(plan.pointInPolygon(L_SHAPE, [4, 4]), 'outside');
    assert.equal(plan.pointInPolygon(L_SHAPE, [6, 1]), 'boundary');
    assert.equal(plan.pointInPolygon(L_SHAPE, [3, 3]), 'boundary');
    assert.equal(plan.pointInPolygon(L_SHAPE, [3, 4]), 'boundary');
    assert.equal(plan.pointInPolygon(L_SHAPE, [3.5, 4.5]), 'outside');
    throwsCode(() => plan.polygonArea([[0, 0], [1, 1]]), 'INVALID_PLAN');
    throwsCode(() => plan.polygonCentroid([[0, 0], [4, 4], [4, 0], [0, 4]]), 'INVALID_PLAN');
    throwsCode(() => plan.pointInPolygon(RECT_10x8, [1]), 'INVALID_POINT');
  });

  it('isSimplePolygon: 蝴蝶結、頂點相碰、來回折返皆非簡單多邊形', () => {
    assert.equal(plan.isSimplePolygon(L_SHAPE), true);
    assert.equal(plan.isSimplePolygon(U_SHAPE), true);
    assert.equal(plan.isSimplePolygon([[0, 0], [4, 4], [4, 0], [0, 4]]), false);
    assert.equal(plan.isSimplePolygon([[0, 0], [4, 0], [2, 2], [4, 4], [0, 4], [2, 2]]), false);
    assert.equal(plan.isSimplePolygon([[0, 0], [4, 0], [4, 4], [0, 4], [0, 2], [0, 3]]), false);
    // 頂點重複收尾(GeoJSON 式)與連續重複點視為同一個環
    assert.equal(plan.isSimplePolygon([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]), true);
    assert.equal(plan.isSimplePolygon([[0, 0], [0, 0], [4, 0], [4, 4], [0, 4]]), true);
  });
});

// ═══════════════════════════ C. sectorOfPoint ═══════════════════════════

describe('sectorOfPoint 點的宮位', () => {
  const p0 = makePlan({ outline: RECT_10x8, planUpBearing: 0 }); // 太極點 (5,4)

  const CASES = [
    // [說明, planUp, 點, 宮, 方位角]
    ['正上', 0, [5, 8], '坎', 0],
    ['正右', 0, [10, 4], '震', 90],
    ['正下', 0, [5, 0], '離', 180],
    ['正左', 0, [0, 4], '兌', 270],
    ['右上角', 0, [10, 8], '艮', Math.atan2(5, 4) * 180 / Math.PI],
    ['右下角', 0, [10, 0], '巽', 180 - Math.atan2(5, 4) * 180 / Math.PI],
    ['左下角', 0, [0, 0], '坤', 180 + Math.atan2(5, 4) * 180 / Math.PI],
    ['左上角', 0, [0, 8], '乾', 360 - Math.atan2(5, 4) * 180 / Math.PI],
    ['planUp=30 正上', 30, [5, 8], '艮', 30],
    ['planUp=-30 正上(負角正規化)', -30, [5, 8], '乾', 330],
    ['planUp=390 正上(超過 360 正規化)', 390, [5, 8], '艮', 30],
    ['planUp=90 正上 = 東', 90, [5, 8], '震', 90],
    ['planUp=180 正右 = 西', 180, [10, 4], '兌', 270],
  ];
  for (const [name, up, pt, gua, bearing] of CASES) {
    it(`${name}: ${gua}`, () => {
      const r = plan.sectorOfPoint({ ...p0, planUpBearing: up }, pt);
      assert.equal(r.gua, gua);
      assert.equal(r.dir8, geo.DIR8[GUA.indexOf(gua)]);
      assert.equal(r.index, GUA.indexOf(gua));
      assert.ok(geo.circularDiff(r.bearing, bearing) < 1e-9, `bearing ${r.bearing} vs ${bearing}`);
    });
  }

  it('距離: 回傳到太極點的距離(公尺)', () => {
    closeRel(plan.sectorOfPoint(p0, [8, 8]).distance, 5, 1e-12);
    closeRel(plan.sectorOfPoint(p0, [5, 0]).distance, 4, 1e-12);
  });

  it('邊界半開區間: 恰在 22.5 度線上歸順時針下一宮(艮),337.5 度線歸坎', () => {
    const on = plan.sectorOfPoint({ ...p0, planUpBearing: 22.5 }, [5, 8]);
    assert.equal(on.gua, '艮');
    assert.equal(on.boundaryDeg, 0);
    assert.equal(on.borderline, true);
    assert.equal(on.otherGua, '坎');
    const on2 = plan.sectorOfPoint({ ...p0, planUpBearing: 337.5 }, [5, 8]);
    assert.equal(on2.gua, '坎');
    assert.equal(on2.otherGua, '乾');
    assert.equal(on2.boundaryDeg, 0);
  });

  it('borderline: 距扇區線 < measureUncertainty(預設 5 度,嚴格小於)', () => {
    const at = (up, s) => plan.sectorOfPoint({ ...p0, planUpBearing: up }, [5, 8], s);
    const a = at(20, {});
    assert.equal(a.gua, '坎');
    assert.equal(a.boundaryDeg, 2.5);
    assert.equal(a.borderline, true);
    assert.equal(a.otherGua, '艮');
    assert.equal(at(10, {}).borderline, false);
    assert.equal(at(17.5, {}).boundaryDeg, 5);
    assert.equal(at(17.5, {}).borderline, false);
    assert.equal(at(10, { measureUncertainty: 15 }).borderline, true);
    assert.equal(at(20, { measureUncertainty: 0 }).borderline, false);
    assert.equal(at(-20, {}).otherGua, '乾');
  });

  it('measureUncertainty 必須是非負有限數', () => {
    for (const bad of [-1, NaN, Infinity, '5', null]) {
      throwsCode(() => plan.sectorOfPoint(p0, [5, 8], { measureUncertainty: bad }), 'INVALID_SETTING');
    }
  });

  it('點與太極點重合(< 1e-9 公尺) → null', () => {
    assert.equal(plan.sectorOfPoint(p0, [5, 4]), null);
    assert.equal(plan.sectorOfPoint(p0, [5 + 1e-10, 4 - 1e-10]), null);
    assert.notEqual(plan.sectorOfPoint(p0, [5 + 1e-6, 4]), null);
  });

  it('planUpBearing 未知 → PLAN_UP_UNKNOWN(不輸出宮位)', () => {
    throwsCode(() => plan.sectorOfPoint({ ...p0, planUpBearing: null }, [5, 8]), 'PLAN_UP_UNKNOWN');
    const noField = clone(p0);
    delete noField.planUpBearing;
    throwsCode(() => plan.sectorOfPoint(noField, [5, 8]), 'PLAN_UP_UNKNOWN');
  });

  it('點格式錯誤 → INVALID_POINT', () => {
    for (const bad of [null, undefined, [1], [1, 2, 3], [NaN, 1], ['1', 2], 5, 'ab', { x: 1, y: 2 }]) {
      throwsCode(() => plan.sectorOfPoint(p0, bad), 'INVALID_POINT');
    }
  });

  it('外框非法時丟 INVALID_PLAN,但房間或開口的問題不影響單點查詢', () => {
    const bowtie = makePlan({ outline: [[0, 0], [4, 4], [4, 0], [0, 4]] });
    throwsCode(() => plan.sectorOfPoint(bowtie, [1, 1]), 'INVALID_PLAN');
    const badRoom = clone(p0);
    badRoom.rooms[0].polygon = [[0, 0], [1, 1]];
    assert.equal(plan.sectorOfPoint(badRoom, [5, 8]).gua, '坎');
    throwsCode(() => plan.sectorShares(badRoom), 'INVALID_PLAN');
  });

  it('屬性: 掃描 1440 個方位,宮 == 獨立公式,且 bearing 與輸入一致(4 組 planUp)', () => {
    const T = [5, 4];
    for (const up of [0, 13.7, 200, 359.9]) {
      const pl = { ...p0, planUpBearing: up };
      for (let i = 0; i < 1440; i += 1) {
        const a = 0.125 + i * 0.25; // 避開 22.5 度整數倍的邊界
        const rel = [Math.sin(((a - up) * Math.PI) / 180) * 3, Math.cos(((a - up) * Math.PI) / 180) * 3];
        const r = plan.sectorOfPoint(pl, [T[0] + rel[0], T[1] + rel[1]]);
        assert.equal(r.index, sectorIndexOfVector(rel[0], rel[1], up), `up=${up} a=${a}`);
        assert.equal(r.gua, geo.guaAt(a).gua, `up=${up} a=${a}`);
        assert.ok(geo.circularDiff(r.bearing, a) < 1e-9, `up=${up} a=${a} got ${r.bearing}`);
        assert.ok(r.boundaryDeg > 0 && r.boundaryDeg <= 22.5);
      }
    }
  });
});

// ═══════════════════════════ D. sectorShares 屬性測試(規格 2.7.6) ═══════════════════════════

/** 隨機案例: 多種形狀 × 隨機順序/起點/平移/planUp/太極點。 */
function randomCase(rng) {
  const kind = Math.floor(rng() * 6);
  let poly;
  if (kind === 0) poly = rectPoly(0, 0, range(rng, 1, 25), range(rng, 1, 25));
  else if (kind === 1) poly = scale(L_SHAPE, range(rng, 0.5, 4));
  else if (kind === 2) poly = scale(U_SHAPE, range(rng, 0.5, 4));
  else if (kind === 3) poly = scale(T_SHAPE, range(rng, 0.5, 4));
  else poly = randomStarPolygon(rng, 5 + Math.floor(rng() * 9), 0, 0);
  poly = translate(poly, range(rng, -80, 80), range(rng, -80, 80));
  if (rng() < 0.5) poly = reversed(poly);
  poly = rotateStart(poly, Math.floor(rng() * poly.length));
  const xs = poly.map((q) => q[0]);
  const ys = poly.map((q) => q[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const mode = ['centroid', 'bbox', 'manual'][Math.floor(rng() * 3)];
  const manual = [Math.min(...xs) + range(rng, -0.2, 1.2) * spanX, Math.min(...ys) + range(rng, -0.2, 1.2) * spanY];
  const planUp = range(rng, -400, 400);
  return { poly, planUp, plan: makePlan({ outline: poly, planUpBearing: planUp, taiji: { mode, manual: mode === 'manual' ? manual : null } }) };
}

describe('sectorShares 屬性: 面積守恆', () => {
  it('各宮面積和 == 多邊形面積(相對誤差 1e-9),300 組隨機形狀/太極點(含太極點在牆外)', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 300; i += 1) {
      const c = randomCase(rng);
      const res = plan.sectorShares(c.plan);
      const area = Math.abs(signedArea(c.poly));
      closeRel(sum(areaArr(res.shares.living)), area, 1e-9, `#${i} shares`);
      closeRel(sum(areaArr(res.palaceArea)), area, 1e-9, `#${i} palaceArea`);
      closeRel(res.totalArea, area, 1e-12, `#${i} totalArea`);
      closeRel(res.outlineArea, area, 1e-12, `#${i} outlineArea`);
      for (const g of GUA) assert.ok(res.shares.living[g] >= -1e-9, `#${i} ${g} 不得為負`);
    }
  });

  it('與獨立的有號三角形分解 oracle 一致(相對誤差 1e-9),300 組', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 300; i += 1) {
      const c = randomCase(rng);
      const res = plan.sectorShares(c.plan);
      const T = res.taiji;
      const exact = oracleSectorAreas(c.poly, T, c.planUp);
      closeArr(areaArr(res.shares.living), exact, 1e-9, `#${i}`);
    }
  });

  it('oracle 本身以網格取樣交叉驗證(6 組,容差為總面積的 0.4%)', () => {
    const rng = mulberry32(4242);
    for (let i = 0; i < 6; i += 1) {
      const c = randomCase(rng);
      const T = plan.taijiPoint(c.plan).point;
      const exact = oracleSectorAreas(c.poly, T, c.planUp);
      const grid = gridSectorAreas(c.poly, T, c.planUp, 500);
      const total = Math.abs(signedArea(c.poly));
      exact.forEach((v, k) => assert.ok(Math.abs(v - grid[k]) <= 0.004 * total, `#${i} ${GUA[k]} oracle ${v} grid ${grid[k]}`));
    }
  });

  it('planUpBearing 以 360 為週期(30 == 390 == -330)', () => {
    const at = (up) => areaArr(plan.sectorShares(makePlan({ outline: L_SHAPE, planUpBearing: up })).shares.living);
    const base = at(30);
    closeArr(at(390), base, 1e-9);
    closeArr(at(-330), base, 1e-9);
  });
});

describe('sectorShares 屬性: 旋轉等變', () => {
  it('planUpBearing 加 45 度,各宮面積循環位移一格(250 組)', () => {
    const rng = mulberry32(45);
    for (let i = 0; i < 250; i += 1) {
      const c = randomCase(rng);
      const a = plan.sectorShares(c.plan);
      const b = plan.sectorShares({ ...c.plan, planUpBearing: c.planUp + 45 });
      GUA.forEach((g, k) => closeRel(b.shares.living[guaShift(k, 1)], a.shares.living[g], 1e-9, `#${i} ${g}`));
    }
  });

  it('加 90 度位移 2 格;加 360 度不變', () => {
    const p = makePlan({ outline: L_SHAPE, planUpBearing: 17 });
    const a = plan.sectorShares(p).shares.living;
    const b = plan.sectorShares({ ...p, planUpBearing: 17 + 90 }).shares.living;
    const c = plan.sectorShares({ ...p, planUpBearing: 17 + 360 }).shares.living;
    GUA.forEach((g, k) => {
      closeRel(b[guaShift(k, 2)], a[g], 1e-9, g);
      closeRel(c[g], a[g], 1e-9, g);
    });
  });

  it('幾何順時針轉 θ 且 planUp 減 θ,結果不變(任意角度,150 組)', () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 150; i += 1) {
      const c = randomCase(rng);
      const theta = range(rng, 0, 360);
      const rotated = rotateCW(c.poly, theta);
      // bbox 是軸對齊的,不具旋轉等變性,所以轉後的太極點一律以 manual 指定;centroid 另驗等變
      const T2 = rotateCW([plan.taijiPoint(c.plan).point], theta)[0];
      if (c.plan.taiji.mode === 'centroid') {
        closeArr(plan.taijiPoint(makePlan({ outline: rotated })).point, T2, 1e-9, `#${i} 重心等變`);
      }
      const p2 = makePlan({ outline: rotated, planUpBearing: c.planUp - theta, taiji: { mode: 'manual', manual: T2 } });
      const a = plan.sectorShares(c.plan).shares.living;
      const b = plan.sectorShares(p2).shares.living;
      closeArr(areaArr(b), areaArr(a), 1e-9, `#${i} θ=${theta.toFixed(2)}`);
    }
  });
});

describe('sectorShares 屬性: 對稱', () => {
  it('8x8 正方形: 四正宮相等、四隅宮相等,且 planUp=0 時正宮 6.627417、隅宮 9.372583', () => {
    const res = plan.sectorShares(makePlan({ outline: SQUARE_8, planUpBearing: 0 }));
    const cardinal = [0, 2, 4, 6].map((k) => res.palaceArea[GUA[k]]);
    const diagonal = [1, 3, 5, 7].map((k) => res.palaceArea[GUA[k]]);
    closeArr(cardinal, new Array(4).fill(cardinal[0]), 1e-12, '四正');
    closeArr(diagonal, new Array(4).fill(diagonal[0]), 1e-12, '四隅');
    assert.ok(Math.abs(cardinal[0] - 6.627417) <= 1e-6);
    assert.ok(Math.abs(diagonal[0] - 9.372583) <= 1e-6);
  });

  it('任意邊長的正方形、任意平移與 90 度倍數的 planUp,四正宮相等且四隅宮相等(100 組)', () => {
    const rng = mulberry32(88);
    for (let i = 0; i < 100; i += 1) {
      const s = range(rng, 1, 30);
      const poly = translate(rectPoly(0, 0, s, s), range(rng, -60, 60), range(rng, -60, 60));
      const up = 90 * Math.floor(rng() * 4);
      const res = plan.sectorShares(makePlan({ outline: poly, planUpBearing: up }));
      const a = [0, 2, 4, 6].map((k) => res.palaceArea[GUA[k]]);
      const b = [1, 3, 5, 7].map((k) => res.palaceArea[GUA[k]]);
      closeArr(a, new Array(4).fill(a[0]), 1e-9, `#${i} 四正`);
      closeArr(b, new Array(4).fill(b[0]), 1e-9, `#${i} 四隅`);
      closeRel(a[0], s * s * 0.10355339059327377, 1e-9, `#${i} 正宮佔 (√2-1)/4`);
    }
  });

  it('矩形: 重心 == 外框中心,且預設 centroid 與 bbox 得到相同的各宮面積', () => {
    const p = makePlan({ outline: rectPoly(3, -2, 7, 12), planUpBearing: 61 });
    const a = plan.sectorShares(p);
    const b = plan.sectorShares({ ...p, taiji: bboxTaiji });
    assert.equal(b.taijiMode, 'bbox');
    closeArr(a.taiji, [6.5, 4], 1e-12);
    closeArr(a.taiji, b.taiji, 1e-12);
    closeArr(areaArr(a.palaceArea), areaArr(b.palaceArea), 1e-12);
  });

  it('左右對稱的雙房間: 左房間的宮位 k 面積 == 右房間鏡像宮位 (8-k)%8 面積', () => {
    const left = rectPoly(0, 0, 5, 8);
    const right = rectPoly(5, 0, 5, 8);
    const p = makePlan({
      outline: RECT_10x8,
      planUpBearing: 0,
      rooms: [{ id: 'L', type: 'bedroom', polygon: left }, { id: 'R', type: 'study', polygon: right }],
    });
    const res = plan.sectorShares(p);
    GUA.forEach((g, k) => closeRel(res.shares.R[g], res.shares.L[GUA[(8 - k) % 8]], 1e-9, g));
    // 兩房相加 == 整個矩形(規格數值)
    GUA.forEach((g) => closeRel(res.shares.L[g] + res.shares.R[g], SPEC_AREAS.rect0.areas[g], 1e-6, g));
    closeRel(res.shares.L.坎, SPEC_AREAS.rect0.areas.坎 / 2, 1e-9, '坎對半');
  });
});

// ═══════════════════════════ E. 多房間、mainUse、pct ═══════════════════════════

describe('sectorShares 多房間與輸出結構', () => {
  const split = (order = ['L', 'R']) =>
    makePlan({
      outline: RECT_10x8,
      planUpBearing: 0,
      rooms: order.map((id) => ({ id, type: 'living', polygon: id === 'L' ? rectPoly(0, 0, 5, 8) : rectPoly(5, 0, 5, 8) })),
    });

  it('正東只有右房間(震 pct=1、清單長度 1),正西只有左房間', () => {
    const res = plan.sectorShares(split());
    assert.deepEqual(res.palaces.震.map((e) => e.roomId), ['R']);
    closeRel(res.palaces.震[0].pct, 1, 1e-12);
    assert.deepEqual(res.palaces.兌.map((e) => e.roomId), ['L']);
    assert.equal(res.mainUse.震, 'R');
    assert.equal(res.mainUse.兌, 'L');
  });

  it('跨宮房間依面積佔比切分,pct 加總為 1,清單依面積由大到小', () => {
    const res = plan.sectorShares(split());
    for (const g of GUA) {
      const list = res.palaces[g];
      if (!list.length) continue;
      closeRel(sum(list.map((e) => e.pct)), 1, 1e-12, `${g} pct`);
      for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].area >= list[i].area - 1e-9, `${g} 排序`);
      for (const e of list) closeRel(e.pct, e.area / res.palaceArea[g], 1e-9, `${g} ${e.roomId}`);
    }
    assert.equal(res.palaces.坎.length, 2);
    closeRel(res.palaces.坎[0].pct, 0.5, 1e-9);
  });

  it('面積並列時 mainUse 取 rooms 陣列中較前者(與房間順序一致,不受浮點雜訊影響)', () => {
    assert.equal(plan.sectorShares(split(['L', 'R'])).mainUse.坎, 'L');
    assert.equal(plan.sectorShares(split(['R', 'L'])).mainUse.坎, 'R');
    assert.equal(plan.sectorShares(split(['L', 'R'])).mainUse.離, 'L');
  });

  it('沒有任何房間佔到的宮: palaces 為空陣列、mainUse 為 null', () => {
    const p = makePlan({
      outline: RECT_10x8,
      planUpBearing: 0,
      rooms: [{ id: 'nook', type: 'other', polygon: rectPoly(0, 0, 2, 2) }],
    });
    const res = plan.sectorShares(p);
    assert.deepEqual(res.palaces.震, []);
    assert.equal(res.mainUse.震, null);
    assert.equal(res.mainUse.坤, 'nook');
    closeRel(res.totalArea, 4, 1e-12);
    closeRel(res.outlineArea, 80, 1e-12);
  });

  it('陽台在 outline 之外: 仍逐宮計面積(與 oracle 一致),totalArea 含陽台、outlineArea 不含', () => {
    const balcony = rectPoly(0, 8, 10, 2);
    const p = makePlan({
      outline: RECT_10x8,
      planUpBearing: 25,
      rooms: [
        { id: 'living', type: 'living', polygon: RECT_10x8 },
        { id: 'bal', type: 'balcony', polygon: balcony },
      ],
    });
    const res = plan.sectorShares(p);
    closeRel(res.totalArea, 100, 1e-12);
    closeRel(res.outlineArea, 80, 1e-12);
    closeRel(res.roomAreas.bal, 20, 1e-12);
    closeArr(areaArr(res.shares.bal), oracleSectorAreas(balcony, [5, 4], 25), 1e-9, 'bal');
    closeArr(areaArr(res.shares.living), oracleSectorAreas(RECT_10x8, [5, 4], 25), 1e-9, 'living');
    assert.deepEqual(res.taiji, [5, 4]); // 太極點只看 outline
    assert.equal(plan.validatePlan(p).warnings.some((w) => w.code === 'roomOutsideOutline'), false);
  });

  it('沒有 rooms: 以 outline 當作單一房間 "outline",並附 roomsMissing 警告', () => {
    const p = makePlan({ outline: RECT_10x8, planUpBearing: 0, rooms: [] });
    const res = plan.sectorShares(p);
    assert.ok(res.warnings.includes('roomsMissing'));
    closeRel(res.palaces.坎[0].area, SPEC_AREAS.rect0.areas.坎, 1e-6);
    assert.equal(res.palaces.坎[0].roomId, 'outline');
    const noField = clone(p);
    delete noField.rooms;
    assert.deepEqual(plan.sectorShares(noField).mainUse, res.mainUse);
  });

  it('planUpBearing 未知: 只輸出形狀分析(palaces/shares/mainUse 為 null),附 planUpBearingUnknown', () => {
    const res = plan.sectorShares(makePlan({ outline: L_SHAPE, planUpBearing: null }));
    assert.equal(res.planUpBearing, null);
    assert.equal(res.palaces, null);
    assert.equal(res.shares, null);
    assert.equal(res.mainUse, null);
    assert.equal(res.palaceArea, null);
    closeRel(res.totalArea, 27, 1e-12);
    closeArr(res.taiji, [2.5, 2.5], 1e-12);
    assert.ok(res.warnings.includes('planUpBearingUnknown'));
  });

  it('L 型/U 型: taijiOutsideOutline 警告出現在 sectorShares,面積仍守恆', () => {
    const u = plan.sectorShares(makePlan({ outline: U_SHAPE, planUpBearing: 10 }));
    assert.ok(u.warnings.includes('taijiOutsideOutline'));
    closeRel(sum(areaArr(u.palaceArea)), 28, 1e-9);
    const l = plan.sectorShares(makePlan({ outline: L_SHAPE, planUpBearing: 10 }));
    assert.equal(l.warnings.includes('taijiOutsideOutline'), false);
  });

  it('小面積的宮也要列出: L 型艮宮只有 0.353553 m2,仍在 palaces 且 mainUse 有值', () => {
    const res = plan.sectorShares(makePlan({ outline: L_SHAPE, planUpBearing: 0 }));
    assert.equal(res.palaces.艮.length, 1);
    assert.ok(Math.abs(res.palaces.艮[0].area - 0.353553) <= 1e-6);
    assert.equal(res.palaces.艮[0].pct, 1);
    assert.equal(res.mainUse.艮, 'living');
  });

  it('輸出的 planUpBearing 是正規化後的方位(390 → 30、-330 → 30),原始輸入不變', () => {
    const p = makePlan({ outline: L_SHAPE, planUpBearing: 390 });
    assert.equal(plan.sectorShares(p).planUpBearing, 30);
    assert.equal(plan.sectorShares({ ...p, planUpBearing: -330 }).planUpBearing, 30);
    assert.equal(p.planUpBearing, 390);
  });

  it('meta: schema、ruleset(實際採用的設定)、warnings 與頂層一致', () => {
    const res = plan.sectorShares(makePlan({ outline: U_SHAPE, planUpBearing: 10 }), { measureUncertainty: 7, taijiMode: 'bbox' });
    assert.equal(res.meta.schema, 'fengshui.plan/1');
    assert.equal(res.meta.ruleset.taijiMode, 'centroid'); // plan.taiji.mode 優先
    assert.equal(res.meta.ruleset.measureUncertainty, 7);
    assert.equal(res.meta.ruleset.northMode, DEFAULT_SETTINGS.northMode);
    assert.deepEqual(res.meta.warnings, res.warnings);
    const noMode = makePlan({ outline: U_SHAPE, planUpBearing: 10, taiji: { mode: null, manual: null } });
    assert.equal(plan.sectorShares(noMode, { taijiMode: 'bbox' }).meta.ruleset.taijiMode, 'bbox');
    assert.equal(plan.sectorShares(noMode, { northMode: 'true' }).meta.ruleset.northMode, 'true');
  });

  it('與網格取樣的粗算一致: 多房間 L 型平面(容差 0.4%)', () => {
    const rooms = [
      { id: 'a', type: 'living', polygon: rectPoly(0, 0, 6, 3) },
      { id: 'b', type: 'bedroom', polygon: rectPoly(0, 3, 3, 3) },
    ];
    const p = makePlan({ outline: L_SHAPE, rooms, planUpBearing: 33 });
    const res = plan.sectorShares(p);
    for (const r of rooms) {
      const grid = gridSectorAreas(r.polygon, res.taiji, 33, 600);
      areaArr(res.shares[r.id]).forEach((v, k) => assert.ok(Math.abs(v - grid[k]) <= 0.004 * res.roomAreas[r.id], `${r.id} ${GUA[k]}`));
    }
  });
});

// ═══════════════════════════ F. 開口(門窗) ═══════════════════════════

describe('開口: openingCenter / sectorOfOpening', () => {
  const room = rectPoly(10, 20, 6, 5); // 平移過的房間,pos 從左下角起算
  const base = () =>
    makePlan({
      outline: room,
      planUpBearing: 0,
      rooms: [{ id: 'a', type: 'living', polygon: room }],
      openings: [
        { id: 'b', kind: 'entrance', roomId: 'a', wall: 'bottom', pos: 1.0, width: 0.9 },
        { id: 'r', kind: 'window', roomId: 'a', wall: 'right', pos: 2.5, width: 1.8 },
        { id: 't', kind: 'door', roomId: 'a', wall: 'top', pos: 3, width: 0.9 },
        { id: 'l', kind: 'floorWindow', roomId: 'a', wall: 'left', pos: 4, width: 1.5 },
      ],
      mainDoor: 'b',
    });

  it('四面牆的開口中心(pos 為沿牆座標,自外框左下角起算,bottom/top 用 x、left/right 用 y)', () => {
    const p = base();
    assert.deepEqual(plan.openingCenter(p, 'b').point, [11, 20]);
    assert.deepEqual(plan.openingCenter(p, 'r').point, [16, 22.5]);
    assert.deepEqual(plan.openingCenter(p, 't').point, [13, 25]);
    assert.deepEqual(plan.openingCenter(p, 'l').point, [10, 24]);
    const o = plan.openingCenter(p, 'r');
    assert.equal(o.kind, 'window');
    assert.equal(o.roomId, 'a');
    assert.equal(o.wall, 'right');
    assert.equal(o.id, 'r');
  });

  it('房間在原點時 pos 就是絕對座標(規格 2.6.2 的 [0,w]x[0,d] 約定)', () => {
    const p = parseSpecPlanExample();
    assert.deepEqual(plan.openingCenter(p, 'd1').point, [1, 0]);
    assert.deepEqual(plan.openingCenter(p, 'w1').point, [6, 2.5]);
  });

  it('未知開口 id → UNKNOWN_OPENING', () => {
    throwsCode(() => plan.openingCenter(base(), 'nope'), 'UNKNOWN_OPENING');
    throwsCode(() => plan.sectorOfOpening(base(), 'nope'), 'UNKNOWN_OPENING');
  });

  it('sectorOfOpening 回傳 point 與 sectorOfPoint 的結果,並標 borderline', () => {
    const p = base(); // 太極點 (13,22.5)
    const r = plan.sectorOfOpening(p, 'r'); // (16,22.5): 正東
    assert.equal(r.sector.gua, '震');
    assert.equal(r.sector.borderline, false);
    assert.deepEqual(r.point, [16, 22.5]);
    const t = plan.sectorOfOpening({ ...p, planUpBearing: 20 }, 't'); // (13,25): 正上,方位 20 度,離 22.5 線 2.5 度
    assert.equal(t.sector.gua, '坎');
    assert.equal(t.sector.borderline, true);
    assert.equal(t.sector.otherGua, '艮');
    assert.deepEqual(t.sector, plan.sectorOfPoint({ ...p, planUpBearing: 20 }, t.point));
  });

  it('開口中心恰在太極點: sector 為 null', () => {
    const p = makePlan({
      outline: rectPoly(0, 0, 4, 4),
      rooms: [{ id: 'a', type: 'living', polygon: rectPoly(0, 0, 4, 4) }],
      openings: [{ id: 'x', kind: 'door', roomId: 'a', wall: 'bottom', pos: 2, width: 1 }],
      taiji: { mode: 'manual', manual: [2, 0] },
    });
    assert.equal(plan.sectorOfOpening(p, 'x').sector, null);
  });

  it('非矩形房間(L 型)的開口: 牆名取外接框的邊,且開口必須落在實際存在的牆段上', () => {
    const Lroom = [[0, 0], [5, 0], [5, 3], [2, 3], [2, 6], [0, 6]];
    const mk = (opening) =>
      makePlan({ outline: Lroom, rooms: [{ id: 'a', type: 'living', polygon: Lroom }], openings: [{ id: 'o', roomId: 'a', kind: 'door', width: 0.9, ...opening }] });
    // 規格 2.6.3 手推例: 門在下牆 x=4.2
    assert.deepEqual(plan.openingCenter(mk({ wall: 'bottom', pos: 4.2 }), 'o').point, [4.2, 0]);
    assert.deepEqual(plan.openingCenter(mk({ wall: 'top', pos: 1 }), 'o').point, [1, 6]);
    assert.deepEqual(plan.openingCenter(mk({ wall: 'right', pos: 2 }), 'o').point, [5, 2]);
    // 右牆只有 y∈[0,3] 有牆; pos=4 是凹角外的空氣
    const bad = plan.validatePlan(mk({ wall: 'right', pos: 4 }));
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => e.reason === 'opening.notOnWall'));
    throwsCode(() => plan.openingCenter(mk({ wall: 'right', pos: 4 }), 'o'), 'INVALID_PLAN');
    // 頂牆只有 x∈[0,2]
    assert.equal(plan.validatePlan(mk({ wall: 'top', pos: 3 })).ok, false);
  });
});

// ═══════════════════════════ G. validatePlan ═══════════════════════════

const goodPlan = () => clone(parseSpecPlanExample());

describe('validatePlan', () => {
  it('合法平面圖: ok、無錯誤;順時針外框、首尾重複點、省略 rooms/openings/walls 都可', () => {
    assert.deepEqual(plan.validatePlan(goodPlan()), { ok: true, errors: [], warnings: [] });
    const cw = goodPlan();
    cw.outline = reversed(cw.outline);
    cw.rooms[0].polygon = reversed(cw.rooms[0].polygon);
    assert.equal(plan.validatePlan(cw).ok, true);
    const closed = goodPlan();
    closed.outline = [...closed.outline, closed.outline[0]];
    assert.equal(plan.validatePlan(closed).ok, true);
    const minimal = { version: 1, outline: RECT_10x8 };
    assert.equal(plan.validatePlan(minimal).ok, true);
    assert.ok(plan.validatePlan(minimal).warnings.some((w) => w.code === 'planUpBearingUnknown'));
  });

  // [說明, 修改函式, 預期 reason, 預期 path 前綴]
  const BAD = [
    ['version 不是 1', (p) => { p.version = 2; }, 'version', 'version'],
    ['缺 version', (p) => { delete p.version; }, 'version', 'version'],
    ['unit 不是 m', (p) => { p.unit = 'cm'; }, 'unit', 'unit'],
    ['planUpBearing 是字串', (p) => { p.planUpBearing = 'north'; }, 'planUpBearing', 'planUpBearing'],
    ['planUpBearing 是 NaN', (p) => { p.planUpBearing = NaN; }, 'planUpBearing', 'planUpBearing'],
    ['planUpBearing 是 Infinity', (p) => { p.planUpBearing = Infinity; }, 'planUpBearing', 'planUpBearing'],
    ['缺 outline', (p) => { delete p.outline; }, 'polygon.notArray', 'outline'],
    ['outline 不是陣列', (p) => { p.outline = 'abc'; }, 'polygon.notArray', 'outline'],
    ['outline 頂點少於 3', (p) => { p.outline = [[0, 0], [1, 1]]; }, 'polygon.tooFew', 'outline'],
    ['outline 連續重複點只剩 2 個相異點', (p) => { p.outline = [[0, 0], [0, 0], [1, 1], [1, 1]]; }, 'polygon.tooFew', 'outline'],
    ['outline 面積為 0(共線)', (p) => { p.outline = [[0, 0], [1, 0], [2, 0]]; }, 'polygon.zeroArea', 'outline'],
    ['outline 蝴蝶結自交', (p) => { p.outline = [[0, 0], [4, 4], [4, 0], [0, 4]]; }, 'polygon.selfIntersect', 'outline'],
    ['outline 頂點相碰(夾點)', (p) => { p.outline = [[0, 0], [4, 0], [2, 2], [4, 4], [0, 4], [2, 2]]; }, 'polygon.selfIntersect', 'outline'],
    ['outline 來回折返', (p) => { p.outline = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 2], [0, 3]]; }, 'polygon.selfIntersect', 'outline'],
    ['outline 頂點含 NaN', (p) => { p.outline = [[0, 0], [1, 0], [NaN, 1]]; }, 'polygon.point', 'outline[2]'],
    ['outline 頂點是字串座標', (p) => { p.outline = [[0, 0], [1, 0], ['1', 1]]; }, 'polygon.point', 'outline[2]'],
    ['outline 頂點不是二元陣列', (p) => { p.outline = [[0, 0], [1, 0], [1, 1, 1]]; }, 'polygon.point', 'outline[2]'],
    ['rooms 不是陣列', (p) => { p.rooms = {}; }, 'rooms.notArray', 'rooms'],
    ['room 不是物件', (p) => { p.rooms = [5]; }, 'room.notObject', 'rooms[0]'],
    ['room 缺 id', (p) => { delete p.rooms[0].id; }, 'room.id', 'rooms[0].id'],
    ['room id 重複', (p) => { p.rooms.push({ ...p.rooms[0] }); }, 'room.duplicateId', 'rooms[1].id'],
    ['room.type 未知', (p) => { p.rooms[0].type = 'garage'; }, 'room.type', 'rooms[0].type'],
    ['room 多邊形自交', (p) => { p.rooms[0].polygon = [[0, 0], [4, 4], [4, 0], [0, 4]]; }, 'polygon.selfIntersect', 'rooms[0].polygon'],
    ['openings 不是陣列', (p) => { p.openings = 'x'; }, 'openings.notArray', 'openings'],
    ['opening 缺 id', (p) => { delete p.openings[0].id; }, 'opening.id', 'openings[0].id'],
    ['opening id 重複', (p) => { p.openings[1].id = 'd1'; }, 'opening.duplicateId', 'openings[1].id'],
    ['opening.kind 未知', (p) => { p.openings[0].kind = 'gate'; }, 'opening.kind', 'openings[0].kind'],
    ['opening.roomId 不存在', (p) => { p.openings[0].roomId = 'ghost'; }, 'opening.roomId', 'openings[0].roomId'],
    ['opening.wall 未知', (p) => { p.openings[0].wall = 'north'; }, 'opening.wall', 'openings[0].wall'],
    ['opening.pos 是 NaN', (p) => { p.openings[0].pos = NaN; }, 'opening.pos', 'openings[0].pos'],
    ['opening.width 為 0', (p) => { p.openings[0].width = 0; }, 'opening.width', 'openings[0].width'],
    ['opening.width 為負', (p) => { p.openings[0].width = -1; }, 'opening.width', 'openings[0].width'],
    ['開口超出牆左端(pos-width/2 < 0)', (p) => { p.openings[0].pos = 0.3; }, 'opening.notOnWall', 'openings[0]'],
    ['開口超出牆右端', (p) => { p.openings[0].pos = 5.8; }, 'opening.notOnWall', 'openings[0]'],
    ['walls 不是陣列', (p) => { p.walls = 1; }, 'walls.notArray', 'walls'],
    ['wall.segment 只有一個點', (p) => { p.walls[0].segment = [[0, 0]]; }, 'wall.segment', 'walls[0].segment'],
    ['wall.segment 長度為 0', (p) => { p.walls[0].segment = [[1, 1], [1, 1]]; }, 'wall.segment', 'walls[0].segment'],
    ['wall.segment 含 NaN', (p) => { p.walls[0].segment = [[0, 0], [NaN, 1]]; }, 'wall.segment', 'walls[0].segment'],
    ['wall.kind 未知', (p) => { p.walls[0].kind = 'brick'; }, 'wall.kind', 'walls[0].kind'],
    ['mainDoor 指向不存在的開口', (p) => { p.mainDoor = 'zz'; }, 'mainDoor.unknown', 'mainDoor'],
    ['mainDoor 不是字串', (p) => { p.mainDoor = 3; }, 'mainDoor.type', 'mainDoor'],
    ['taiji 不是物件', (p) => { p.taiji = 'centroid'; }, 'taiji.type', 'taiji'],
    ['taiji.mode 未知', (p) => { p.taiji.mode = 'edge'; }, 'taiji.mode', 'taiji.mode'],
    ['taiji.manual 格式錯', (p) => { p.taiji.manual = [1]; }, 'taiji.manual', 'taiji.manual'],
    ['manual 模式卻沒有 manual', (p) => { p.taiji.mode = 'manual'; }, 'taiji.manualMissing', 'taiji.manual'],
  ];
  for (const [name, mutate, reason, pathPrefix] of BAD) {
    it(`非法: ${name} → ${reason}`, () => {
      const p = goodPlan();
      mutate(p);
      const rep = plan.validatePlan(p);
      assert.equal(rep.ok, false);
      const hit = rep.errors.find((e) => e.reason === reason);
      assert.ok(hit, `找不到 reason=${reason},實得 ${JSON.stringify(rep.errors.map((e) => e.reason))}`);
      assert.equal(hit.code, 'INVALID_PLAN');
      assert.ok(hit.path.startsWith(pathPrefix), `path ${hit.path} 應以 ${pathPrefix} 開頭`);
      assert.equal(typeof hit.message, 'string');
      throwsCode(() => plan.assertValidPlan(p), 'INVALID_PLAN');
    });
  }

  it('整個 plan 不是物件 → notObject(null、數字、字串、陣列),不丟例外', () => {
    for (const bad of [null, undefined, 5, 'plan', [], true]) {
      const rep = plan.validatePlan(bad);
      assert.equal(rep.ok, false);
      assert.equal(rep.errors[0].reason, 'notObject');
    }
  });

  it('一次回報多個錯誤,不是遇到第一個就停', () => {
    const p = goodPlan();
    p.version = 3;
    p.outline = [[0, 0], [1, 1]];
    p.openings[0].kind = 'gate';
    const reasons = plan.validatePlan(p).errors.map((e) => e.reason);
    for (const r of ['version', 'polygon.tooFew', 'opening.kind']) assert.ok(reasons.includes(r), r);
  });

  it('assertValidPlan: 合法時回傳 undefined;非法時 message 以 INVALID_PLAN: 開頭並帶第一個問題', () => {
    assert.equal(plan.assertValidPlan(goodPlan()), undefined);
    const p = goodPlan();
    p.outline = [[0, 0], [1, 1]];
    assert.throws(() => plan.assertValidPlan(p), /^Error: INVALID_PLAN: .*outline/);
  });

  it('警告(不擋分析): mainDoor 不是 entrance、非陽台房間超出外框、同牆開口重疊、太極點在牆外', () => {
    const w = (p, settings) => plan.validatePlan(p, settings).warnings.map((x) => x.code);
    const a = goodPlan();
    a.openings[0].kind = 'door';
    assert.ok(w(a).includes('mainDoorNotEntrance'));
    const b = goodPlan();
    b.rooms.push({ id: 'shed', type: 'other', polygon: rectPoly(7, 0, 2, 2) });
    assert.ok(w(b).includes('roomOutsideOutline'));
    b.rooms[1].type = 'balcony';
    assert.equal(w(b).includes('roomOutsideOutline'), false);
    const c = goodPlan();
    c.openings.push({ id: 'd2', kind: 'door', roomId: 'living', wall: 'bottom', pos: 1.5, width: 0.9 });
    assert.ok(w(c).includes('openingsOverlap'));
    const d = { version: 1, planUpBearing: 0, outline: U_SHAPE };
    assert.ok(w(d).includes('taijiOutsideOutline'));
    assert.equal(w(d, { taijiMode: 'manual' }).includes('taijiOutsideOutline'), false); // manual 缺點在 validatePlan 不加警告
  });

  it('房間完全落在外框內且開口不重疊 → 無警告', () => {
    const p = goodPlan();
    p.rooms = [
      { id: 'a', type: 'living', polygon: rectPoly(0, 0, 3, 5) },
      { id: 'b', type: 'bedroom', polygon: rectPoly(3, 0, 3, 5) },
    ];
    p.openings = [{ id: 'd1', kind: 'entrance', roomId: 'a', wall: 'bottom', pos: 1, width: 0.9 }];
    assert.deepEqual(plan.validatePlan(p).warnings, []);
  });

  it('亂數垃圾輸入不會丟例外(200 組)', () => {
    const rng = mulberry32(5);
    const junk = () => {
      const pick = [null, undefined, 0, -1, 1e308, NaN, 'x', '', [], [[]], [[1]], [[1, 2]], {}, { a: 1 }, true, [null], [[NaN, 1]], () => 1];
      return pick[Math.floor(rng() * pick.length)];
    };
    const keys = ['version', 'unit', 'planUpBearing', 'outline', 'rooms', 'openings', 'walls', 'mainDoor', 'taiji'];
    for (let i = 0; i < 200; i += 1) {
      const p = goodPlan();
      for (const k of keys) if (rng() < 0.3) p[k] = junk();
      if (rng() < 0.3 && Array.isArray(p.rooms)) p.rooms = [junk(), { id: junk(), type: junk(), polygon: junk() }];
      if (rng() < 0.3 && Array.isArray(p.openings)) p.openings = [junk(), { id: junk(), kind: junk(), roomId: junk(), wall: junk(), pos: junk(), width: junk() }];
      let rep;
      assert.doesNotThrow(() => { rep = plan.validatePlan(p); }, `#${i}`);
      assert.equal(typeof rep.ok, 'boolean');
      assert.equal(rep.ok, rep.errors.length === 0);
    }
  });

  it('自交/退化外框讓分析函式丟 INVALID_PLAN(規格 2.7.5)', () => {
    for (const outline of [[[0, 0], [4, 4], [4, 0], [0, 4]], [[0, 0], [1, 1]], [[0, 0], [1, 0], [2, 0]]]) {
      const p = makePlan({ outline, planUpBearing: 0 });
      throwsCode(() => plan.sectorShares(p), 'INVALID_PLAN');
      throwsCode(() => plan.taijiPoint(p), 'INVALID_PLAN');
      throwsCode(() => plan.sectorOfPoint(p, [1, 1]), 'INVALID_PLAN');
    }
  });
});

// ═══════════════════════════ H. 北基準換算 ═══════════════════════════

describe('convertPlanNorth 磁北/真北換算', () => {
  const p = makePlan({ outline: RECT_10x8, planUpBearing: 30 });

  it('磁北→真北: planUp + D;真北→磁北: planUp - D(規格 D06,台北 D≈-5.06)', () => {
    const t = plan.convertPlanNorth(p, 'magnetic', 'true', -5.06);
    closeRel(t.planUpBearing, 24.94, 1e-12);
    assert.equal(t.planUpBearing, geo.toTrue(30, -5.06));
    const m = plan.convertPlanNorth(p, 'true', 'magnetic', -5.06);
    assert.equal(m.planUpBearing, geo.toMagnetic(30, -5.06));
    closeRel(m.planUpBearing, 35.06, 1e-12);
  });

  it('來回換算還原;跨 0 度正規化;同基準原樣回傳(但是新物件)', () => {
    const back = plan.convertPlanNorth(plan.convertPlanNorth(p, 'magnetic', 'true', 12.5), 'true', 'magnetic', 12.5);
    closeRel(back.planUpBearing, 30, 1e-12);
    assert.ok(Math.abs(plan.convertPlanNorth({ ...p, planUpBearing: 355 }, 'magnetic', 'true', 10).planUpBearing - 5) < 1e-12);
    const same = plan.convertPlanNorth(p, 'magnetic', 'magnetic', 99);
    assert.deepEqual(same, p);
    assert.notEqual(same, p);
  });

  it('planUpBearing 未知則保持未知;其餘欄位不變;不改動輸入', () => {
    const frozen = deepFreeze(makePlan({ outline: L_SHAPE, planUpBearing: null }));
    const out = plan.convertPlanNorth(frozen, 'magnetic', 'true', 3);
    assert.equal(out.planUpBearing, null);
    assert.deepEqual(out.outline, L_SHAPE);
    const frozen2 = deepFreeze(makePlan({ outline: L_SHAPE, planUpBearing: 10 }));
    assert.equal(plan.convertPlanNorth(frozen2, 'magnetic', 'true', 3).planUpBearing, 13);
    assert.equal(frozen2.planUpBearing, 10);
  });

  it('未知基準 → INVALID_NORTH_MODE;偏角超出範圍 → INVALID_DECLINATION(來自 geo)', () => {
    throwsCode(() => plan.convertPlanNorth(p, 'grid', 'true', 1), 'INVALID_NORTH_MODE');
    throwsCode(() => plan.convertPlanNorth(p, 'magnetic', 'south', 1), 'INVALID_NORTH_MODE');
    throwsCode(() => plan.convertPlanNorth(p, 'magnetic', 'true', 999), 'INVALID_DECLINATION');
    throwsCode(() => plan.convertPlanNorth(p, 'magnetic', 'true', NaN), 'INVALID_DECLINATION');
  });

  it('換算後的宮位與 geo 的磁偏角換算一致(平面圖正上方的點)', () => {
    // 磁北基準 planUp=30 的正上方點,以真北基準(D=-5)重算應是同一個實際方向: 真方位 = 25
    const t = plan.convertPlanNorth(p, 'magnetic', 'true', -5);
    const r = plan.sectorOfPoint(t, [5, 8]);
    assert.ok(geo.circularDiff(r.bearing, 25) < 1e-9);
  });
});

// ═══════════════════════════ I. 純函式性與 JSON 可序列化 ═══════════════════════════

describe('純函式與可序列化', () => {
  it('輸入物件(含 settings)深度凍結後所有公開函式仍可執行,結果與未凍結相同', () => {
    const mk = () =>
      makePlan({
        outline: L_SHAPE,
        planUpBearing: 40,
        rooms: [{ id: 'a', type: 'living', polygon: rectPoly(0, 0, 6, 3) }, { id: 'b', type: 'bedroom', polygon: rectPoly(0, 3, 3, 3) }],
        openings: [{ id: 'd', kind: 'entrance', roomId: 'a', wall: 'bottom', pos: 3, width: 1 }],
        mainDoor: 'd',
      });
    const settings = { measureUncertainty: 6 };
    const frozen = deepFreeze(mk());
    const frozenSettings = deepFreeze({ ...settings });
    const calls = (P, S) => ({
      v: plan.validatePlan(P, S),
      t: plan.taijiPoint(P, S),
      s: plan.sectorOfPoint(P, [1, 1], S),
      sh: plan.sectorShares(P, S),
      oc: plan.openingCenter(P, 'd'),
      so: plan.sectorOfOpening(P, 'd', S),
      cv: plan.convertPlanNorth(P, 'magnetic', 'true', -5),
    });
    assert.doesNotThrow(() => calls(frozen, frozenSettings));
    assert.deepEqual(calls(frozen, frozenSettings), calls(mk(), settings));
    assert.deepEqual(frozen, mk());
  });

  it('輸出經 JSON 往返後嚴格相等(無 undefined、NaN、Date、Map、Set、函式)', () => {
    const p = makePlan({ outline: U_SHAPE, planUpBearing: 12 });
    const outs = [plan.sectorShares(p), plan.sectorOfPoint(p, [1, 1]), plan.taijiPoint(p), plan.validatePlan(p), plan.sectorOfOpening(parseSpecPlanExample(), 'd1')];
    for (const o of outs) assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
  });

  it('回傳的陣列是新物件: 改動 taiji 不會影響下次結果或輸入', () => {
    const p = makePlan({ outline: RECT_10x8, planUpBearing: 0, taiji: { mode: 'manual', manual: [2, 3] } });
    const t = plan.taijiPoint(p).point;
    t[0] = 99;
    assert.deepEqual(plan.taijiPoint(p).point, [2, 3]);
    assert.deepEqual(p.taiji.manual, [2, 3]);
  });
});

// ═══════════════════════════ J. 常數 ═══════════════════════════

describe('公開常數', () => {
  it('列舉值與規格 2.7.1 一致', () => {
    assert.deepEqual([...plan.OPENING_KINDS], ['entrance', 'door', 'window', 'floorWindow', 'balconyDoor']);
    assert.deepEqual([...plan.ROOM_TYPES], ['living', 'bedroom', 'kitchen', 'toilet', 'study', 'entry', 'balcony', 'stair', 'other']);
    assert.deepEqual([...plan.WALL_KINDS], ['solid', 'glass', 'partial']);
    assert.deepEqual([...plan.WALL_NAMES], ['bottom', 'top', 'left', 'right']);
    assert.deepEqual([...plan.TAIJI_MODES], ['centroid', 'bbox', 'manual']);
    assert.equal(plan.PLAN_SCHEMA, 'fengshui.plan/1');
    // 規格文字確實列出這些列舉
    for (const k of plan.OPENING_KINDS) assert.ok(SPEC_TEXT.includes(k), k);
    for (const k of plan.ROOM_TYPES) assert.ok(SPEC_TEXT.includes(k), k);
  });

  it('常數凍結,不可被外部改動', () => {
    for (const c of [plan.OPENING_KINDS, plan.ROOM_TYPES, plan.WALL_KINDS, plan.WALL_NAMES, plan.TAIJI_MODES]) assert.ok(Object.isFrozen(c));
  });

  it('預設 measureUncertainty 與 settings 一致(不硬寫魔術值)', () => {
    const p = makePlan({ outline: RECT_10x8, planUpBearing: 0 });
    assert.equal(plan.sectorShares(p).meta.ruleset.measureUncertainty, DEFAULT_SETTINGS.measureUncertainty);
    // 4.9 度(< 5)為 borderline,5.1 度不是
    const near = (deg) => plan.sectorOfPoint({ ...p, planUpBearing: 22.5 - deg }, [5, 8]);
    assert.equal(near(4.9).borderline, true);
    assert.equal(near(5.1).borderline, false);
  });
});

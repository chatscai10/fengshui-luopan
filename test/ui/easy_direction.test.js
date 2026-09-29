// 白話方位與分界判斷(EASY_SPEC 8.3、2.4):對照 geo.guaAt 與引擎的 nearGuaBoundary / geo.retest。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIR8, guaAt, measurementUncertainty } from '../../src/core/geo.js';
import { analyzeHouse } from '../../src/core/analyze.js';
import { plainDirection, sectorOf8, bearingOfDir8, uncertaintyFor, eightImpact, shanImpact } from '../../src/ui/easy/direction.js';

const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);
const houseAt = (bearing, uncertainty) => analyzeHouse({
  nowMs: NOW, utcOffsetMinutes: 480,
  facing: { bearing, doorBearing: null, declination: null, uncertainty },
  building: null, residents: [], mainResidentId: null, plan: null,
});
const sweep = () => Array.from({ length: 720 }, (_, i) => i / 2);

test('plainDirection:分界與代表值(0/7.4/7.5/15/22.4/22.5/196/215/225/337.5/359.9/−30/725)', () => {
  const cases = [
    [0, '北', 'center', null, '北方', '北方', 0],
    [7.4, '北', 'center', null, '北方', '北方', 7],
    [7.5, '北', 'lean', '東', '北方(稍微偏東)', '北方偏東', 8],
    [15, '北', 'leanMore', '東', '北方(很靠近東北方)', '北方偏東', 15],
    [22.4, '北', 'leanMore', '東', '北方(很靠近東北方)', '北方偏東', 22],
    [22.5, '東北', 'leanMore', '北', '東北方(很靠近北方)', '東北方偏北', 23],
    [196, '南', 'leanMore', '西', '南方(很靠近西南方)', '南方偏西', 196],
    [215, '西南', 'lean', '南', '西南方(稍微偏南)', '西南方偏南', 215],
    [225, '西南', 'center', null, '西南方', '西南方', 225],
    [240, '西南', 'leanMore', '西', '西南方(很靠近西方)', '西南方偏西', 240],
    [337.5, '北', 'leanMore', '西', '北方(很靠近西北方)', '北方偏西', 338],
    [359.9, '北', 'center', null, '北方', '北方', 0],
    [-30, '西北', 'leanMore', '北', '西北方(很靠近北方)', '西北方偏北', 330],
    [725, '北', 'center', null, '北方', '北方', 5],
  ];
  for (const [b, dir8, level, lean, text, short, deg] of cases) {
    const p = plainDirection(b);
    assert.equal(p.dir8, dir8, `${b}`);
    assert.equal(p.level, level, `${b}`);
    assert.equal(p.lean, lean, `${b}`);
    assert.equal(p.text, text, `${b}`);
    assert.equal(p.short, short, `${b}`);
    assert.equal(p.deg, deg, `${b}`);
    assert.ok(p.offset >= -22.5 && p.offset < 22.5, `${b} offset ${p.offset}`);
  }
  assert.equal(plainDirection(196).neighbor, '西南');
  assert.equal(plainDirection(0).neighbor, '東北', 'offset 為 0 時取順時針那一側');
});

test('plainDirection:不是有限數字回 null', () => {
  for (const v of [NaN, Infinity, -Infinity, null, undefined, '215', {}]) assert.equal(plainDirection(v), null);
});

test('plainDirection:0 到 360 每 0.5 度,dir8 與 geo.guaAt 一致、文字不含「正」', () => {
  for (const b of sweep()) {
    const p = plainDirection(b);
    assert.equal(p.dir8, guaAt(b).dir8, `${b}`);
    assert.equal(p.index, guaAt(b).index, `${b}`);
    assert.ok(!p.text.includes('正'), p.text);
    assert.ok(p.text.startsWith(`${p.dir8}方`));
  }
});

test('plainDirection:8 方位 × 兩側的偏向字全表', () => {
  // 正四方偏向隔兩格的正方位;斜四方偏向隔壁的正方位
  const expected = {
    北: ['西', '東'], 東北: ['北', '東'], 東: ['北', '南'], 東南: ['東', '南'],
    南: ['東', '西'], 西南: ['南', '西'], 西: ['南', '北'], 西北: ['西', '北'],
  };
  DIR8.forEach((d, k) => {
    const c = k * 45;
    assert.equal(plainDirection(c - 10).lean, expected[d][0], `${d} 逆時針`);
    assert.equal(plainDirection(c + 10).lean, expected[d][1], `${d} 順時針`);
    assert.equal(plainDirection(c - 18).lean, expected[d][0]);
    assert.equal(plainDirection(c + 18).lean, expected[d][1]);
    assert.equal(plainDirection(c - 18).neighbor, DIR8[(k + 7) % 8]);
    assert.equal(plainDirection(c + 18).neighbor, DIR8[(k + 1) % 8]);
    // 主方位只講一次,偏向放括號:稍微偏 → 偏向字;很靠近 → 隔壁的方位
    assert.equal(plainDirection(c + 10).text, `${d}方(稍微偏${expected[d][1]})`);
    assert.equal(plainDirection(c + 18).text, `${d}方(很靠近${DIR8[(k + 1) % 8]}方)`);
    assert.equal(plainDirection(c - 18).paren, `很靠近${DIR8[(k + 7) % 8]}方`);
    assert.equal(plainDirection(c).paren, null);
  });
});

test('sectorOf8:範例與回捲', () => {
  assert.deepEqual(sectorOf8(200), { index: 4, dir8: '南', fromDeg: 157.5, toDeg: 202.5, distDeg: 2.5, neighbor: '西南' });
  const n = sectorOf8(350);
  assert.equal(n.dir8, '北');
  assert.equal(n.fromDeg, 337.5);
  assert.equal(n.toDeg, 22.5);
  assert.equal(n.distDeg, 12.5);
  assert.equal(n.neighbor, '西北');
  assert.equal(sectorOf8(0).distDeg, 22.5);
  assert.equal(sectorOf8(22.5).dir8, '東北');
  assert.equal(sectorOf8(22.5).distDeg, 0);
  assert.equal(sectorOf8(NaN), null);
});

test('bearingOfDir8:來回一致,不認得回 null', () => {
  for (const d of DIR8) {
    const b = bearingOfDir8(d);
    assert.equal(plainDirection(b).dir8, d);
    assert.equal(plainDirection(b).level, 'center');
  }
  assert.equal(bearingOfDir8('西南'), 225);
  assert.equal(bearingOfDir8('北'), 0);
  for (const bad of ['西南方', '', null, 'north']) assert.equal(bearingOfDir8(bad), null);
});

test('uncertaintyFor:max(設定誤差, 2σ, 兩次差距),缺項與壞值略過', () => {
  assert.equal(uncertaintyFor(), 5);
  assert.equal(uncertaintyFor({}), 5);
  assert.equal(uncertaintyFor({ sigmaDeg: 2 }), 5);
  assert.equal(uncertaintyFor({ sigmaDeg: 4 }), 8);
  assert.equal(uncertaintyFor({ spreadDeg: 7 }), 7);
  assert.equal(uncertaintyFor({ sigmaDeg: 4, spreadDeg: 9 }), 9);
  assert.equal(uncertaintyFor({ measureUncertainty: 8, sigmaDeg: 1 }), 8);
  assert.equal(uncertaintyFor({ measureUncertainty: 3, sigmaDeg: 1, spreadDeg: 2 }), 3);
  assert.equal(uncertaintyFor({ measureUncertainty: NaN }), 5);
  assert.equal(uncertaintyFor({ sigmaDeg: -1, spreadDeg: 'x' }), 5);
  // 與 geo.measurementUncertainty 相同
  for (const s of [0, 1, 2.5, 3, 6]) assert.equal(uncertaintyFor({ sigmaDeg: s }), measurementUncertainty({ baseline: 5, sigmaDeg: s }));
});

test('uncertaintyFor:iPhone 自己估計的誤差也算進去(負值 = 未校準,略過)', () => {
  assert.equal(uncertaintyFor({ sigmaDeg: 1, accuracyDeg: 20 }), 20);
  assert.equal(uncertaintyFor({ sigmaDeg: 1, accuracyDeg: 3 }), 5);
  assert.equal(uncertaintyFor({ sigmaDeg: 1, accuracyDeg: -1 }), 5);
  assert.equal(uncertaintyFor({ spreadDeg: 12, accuracyDeg: 10 }), 12);
  assert.equal(uncertaintyFor({ accuracyDeg: 'x' }), 5);
  // 手機說可能差 20 度:150 度離東南/南的分界 7.5 度,一定要算「接近分界」
  assert.equal(eightImpact(150, uncertaintyFor({ sigmaDeg: 1, accuracyDeg: 20 })).near, true);
});

test('eightImpact 與引擎 nearGuaBoundary:0 到 359.5 每 0.5 度、U ∈ {2,3,5,7} 全部一致', () => {
  for (const U of [2, 3, 5, 7]) {
    const bad = [];
    for (const b of sweep()) {
      const eng = houseAt(b, U).bazhai.house.boundary.nearGuaBoundary;
      if (eightImpact(b, U).near !== eng) bad.push(b);
    }
    assert.deepEqual(bad, [], `U=${U} 不一致的方位`);
  }
});

test('eightImpact:U = 10 時比引擎嚴格(引擎為真的都為真),而且確實多抓到一些', () => {
  let extra = 0;
  for (const b of sweep()) {
    const eng = houseAt(b, 10).bazhai.house.boundary.nearGuaBoundary;
    const mine = eightImpact(b, 10).near;
    if (eng) assert.ok(mine, `${b}`);
    if (mine && !eng) extra += 1;
  }
  assert.ok(extra > 0);
});

test('shanImpact 與引擎 geo.retest 一致(U ∈ {2,5,10})', () => {
  for (const U of [2, 5, 10]) {
    for (const b of sweep()) {
      const r = houseAt(b, U);
      assert.equal(shanImpact(b, U).near, r.geo.retest, `U=${U} b=${b}`);
      assert.equal(shanImpact(b, U).mountain, r.geo.mountain);
    }
  }
});

test('eightImpact / shanImpact:欄位與壞輸入', () => {
  const e = eightImpact(201, 5);
  assert.deepEqual(e, { near: true, distDeg: 1.5, dir8: '南', neighbor: '西南', fromDeg: 157.5, toDeg: 202.5, uncertaintyDeg: 5, deg: 201 });
  const far = eightImpact(180, 5);
  assert.equal(far.near, false);
  assert.equal(far.distDeg, 22.5);
  // 回捲:359.9 離北與西北的分界 22.4 度
  assert.equal(eightImpact(359.9, 5).dir8, '北');
  assert.equal(eightImpact(359.9, 5).deg, 0);
  assert.equal(eightImpact(338, 5).near, true);
  assert.equal(eightImpact(338, 5).neighbor, '西北');
  // U 小於 3 時仍以 3 度為最低門檻
  assert.equal(eightImpact(202.5 - 2.9, 0).near, true);
  assert.equal(eightImpact(202.5 - 3, 0).near, false);
  for (const [b, u] of [[NaN, 5], [200, NaN], [200, -1], [200, null]]) {
    assert.equal(eightImpact(b, u), null);
    assert.equal(shanImpact(b, u), null);
  }
  const s = shanImpact(201, 5);
  assert.equal(s.mountain, '丁');
  assert.equal(s.neighborMountain, '未');
  assert.equal(s.distDeg, 1.5);
  assert.equal(s.near, true);
  assert.equal(shanImpact(180, 5).near, false);
  assert.equal(shanImpact(353, 5).mountain, '子');
  assert.equal(shanImpact(353, 5).neighborMountain, '壬');
});

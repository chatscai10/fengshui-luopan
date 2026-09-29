import test from 'node:test';
import assert from 'node:assert/strict';
import {
  round1, fmtDeg, fmtInput, parseBearingInput, stepHeading, basisOf, displayedFromRaw, rawFromDisplayed,
  facingFromMeasured, buildReadoutModel, sensorMessage, lockBlockedMessage, buildFacingPatch, savedBearingOf,
} from '../../src/ui/views/compass.js';
import { stageGeometry, buildDialPlan } from '../../src/ui/canvas/luopanRenderer.js';
import { createDialGesture } from '../../src/ui/canvas/gestures.js';
import { headingFromDialAngle, dialAngleToward, simulateInertia, GESTURE, ringById, xiuLabelPlan, contrastRatio, PALETTE } from '../../src/core/luopan.js';
import { STATUS_INFO } from '../../src/core/sensor-core.js';
import { MOUNTAINS } from '../../src/core/geo.js';

// ── 讀數與盤面一致 ──
test('讀數: 90° 是卯山、0° 是子山、352.5° 跨 0° 仍是子山、7.5° 歸癸山', () => {
  assert.equal(buildReadoutModel({ heading: 90 }).mountain, '卯');
  assert.equal(buildReadoutModel({ heading: 0 }).mountain, '子');
  assert.equal(buildReadoutModel({ heading: 352.5 }).mountain, '子');
  assert.equal(buildReadoutModel({ heading: 359.9 }).mountain, '子');
  assert.equal(buildReadoutModel({ heading: 7.4 }).mountain, '子');
  assert.equal(buildReadoutModel({ heading: 7.5 }).mountain, '癸');
  assert.equal(buildReadoutModel({ heading: 352.4 }).mountain, '壬');
});

test('讀數: 紅線下的盤面格子與讀數的山一致(每 0.5° 掃兩圈)', () => {
  const cells = ringById('mountains24').cells;
  for (let dial = -720; dial <= 720; dial += 0.5) {
    const heading = headingFromDialAngle(dial);
    const cell = cells.find((c) => (c.startDeg < c.endDeg ? heading >= c.startDeg && heading < c.endDeg : heading >= c.startDeg || heading < c.endDeg));
    assert.equal(buildReadoutModel({ heading }).mountain, cell.name, `dial=${dial}`);
  }
});

test('讀數: 盤角 -90 → 90°,dialAngleToward 走最短路徑', () => {
  assert.equal(headingFromDialAngle(-90), 90);
  assert.equal(headingFromDialAngle(-352.5), 352.5);
  assert.ok(Math.abs(dialAngleToward(-1, 359) - 1) < 1e-9); // 讀數 1° → 359° 只轉 2°,不倒轉一圈
  assert.ok(Math.abs(dialAngleToward(-350, 355) - -355) < 1e-9);
});

test('讀數: 兼向、壓線、坐山與量坐換算', () => {
  const m = buildReadoutModel({ heading: 175 });
  assert.equal(m.mountain, '午');
  assert.equal(m.lean, '丙');
  assert.equal(m.opposite, '子');
  assert.equal(m.primary, '向');
  assert.equal(buildReadoutModel({ heading: 187.3 }).onLine, true);
  const sit = buildReadoutModel({ heading: 175, measure: 'sit' });
  assert.equal(sit.primary, '坐');
  assert.equal(sit.facingBearing, 355);
  assert.equal(sit.facingMountain, '子');
  assert.match(m.text, /^向 175\.0° · 午山\(離宮 · 天元\) · 坐 子$/);
});

test('讀數: 感測器 σ 大時接近分界門檻變寬', () => {
  assert.equal(buildReadoutModel({ heading: 4.0 }).near, false); // 距界 3.5 > 2
  assert.equal(buildReadoutModel({ heading: 5.8 }).near, true); // 距界 1.7 < 2
  assert.equal(buildReadoutModel({ heading: 4.0, sigmaDeg: 4 }).near, true);
});

test('讀數: 磁北/真北換山提示', () => {
  const D = -5.06;
  assert.equal(buildReadoutModel({ heading: 4, hintDeclination: D }).alt, null);
  // 磁北 10°(癸山)換真北 4.94°(子山)
  assert.deepEqual(buildReadoutModel({ heading: 10, hintDeclination: D }).alt, { label: '真北', mountain: '子' });
  // 真北模式: 顯示的是真北,提示磁北(真北 4.94° = 磁北 10°,是癸山)
  assert.deepEqual(buildReadoutModel({ heading: 4.94, basis: { trueMode: true, declination: D } }).alt, { label: '磁北', mountain: '癸' });
});

// ── 換算與輸入驗證 ──
test('北基準: 磁北/真北互換,預設城市代碼不合法時不會真的用真北', () => {
  const state = { facing: { cityId: '台北' }, settings: { northMode: 'true' } };
  const b = basisOf(state, Date.UTC(2026, 8, 29));
  assert.equal(b.trueMode, true);
  assert.ok(Math.abs(b.declination - -5.06) < 0.05);
  const disp = displayedFromRaw(10, b);
  assert.ok(Math.abs(disp - 4.94) < 0.05);
  assert.ok(Math.abs(rawFromDisplayed(disp, b) - 10) < 1e-9);
  // store.js 預設的 cityId 'taipei' 不在磁偏角表裡
  const bad = basisOf({ facing: { cityId: 'taipei' }, settings: { northMode: 'true' } });
  assert.equal(bad.trueMode, false);
  assert.equal(bad.wantsTrue, true);
  assert.equal(displayedFromRaw(10, bad), 10);
});

test('parseBearingInput: 壞資料與邊界', () => {
  assert.deepEqual(parseBearingInput('175.5'), { ok: true, value: 175.5 });
  assert.deepEqual(parseBearingInput(' 175° '), { ok: true, value: 175 });
  assert.deepEqual(parseBearingInput('１７５.５'), { ok: true, value: 175.5 });
  assert.deepEqual(parseBearingInput('90度'), { ok: true, value: 90 });
  assert.deepEqual(parseBearingInput('0'), { ok: true, value: 0 });
  assert.deepEqual(parseBearingInput('359.9'), { ok: true, value: 359.9 });
  assert.equal(parseBearingInput('359.96').reason, 'range');
  assert.equal(parseBearingInput('360').reason, 'range');
  assert.equal(parseBearingInput('-5').reason, 'range');
  assert.equal(parseBearingInput('').reason, 'empty');
  assert.equal(parseBearingInput('   ').reason, 'empty');
  assert.equal(parseBearingInput(null).reason, 'empty');
  assert.equal(parseBearingInput(undefined).reason, 'empty');
  assert.equal(parseBearingInput('abc').reason, 'nan');
  assert.equal(parseBearingInput('1e3').reason, 'nan');
  assert.equal(parseBearingInput('NaN').reason, 'nan');
  assert.equal(parseBearingInput('Infinity').reason, 'nan');
  assert.equal(parseBearingInput('12.3.4').reason, 'nan');
  assert.equal(parseBearingInput('<script>').reason, 'nan');
});

test('stepHeading: ±0.5 貼齊格線並跨 0° 回捲', () => {
  assert.equal(stepHeading(175.3, 1), 175.5);
  assert.equal(stepHeading(175.5, 1), 176);
  assert.equal(stepHeading(175.3, -1), 175);
  assert.equal(stepHeading(175, -1), 174.5);
  assert.equal(stepHeading(359.7, 1), 0);
  assert.equal(stepHeading(0, -1), 359.5);
});

test('格式化: 359.96 不會顯示 360.0', () => {
  assert.equal(fmtDeg(359.96), '0.0');
  assert.equal(fmtDeg(175), '175.0');
  assert.equal(fmtInput(175), '175');
  assert.equal(fmtInput(175.5), '175.5');
  assert.equal(round1(-0.04), 0);
});

// ── 感測器訊息逐字取自規格 ──
test('感測器訊息: 逐字取自 DOMAIN_SPEC 2.9.5 表', () => {
  const spec = {
    'permission-denied': '需要允許「動作與方向」才能使用羅盤',
    'permission-error': '需要允許「動作與方向」才能使用羅盤',
    'no-events': '偵測不到方位感測器',
    'relative-not-north': '這台裝置無法提供指北資料',
    uncalibrated: '羅盤尚未校準,請遠離金屬並手持手機畫 8 字',
    invalid: '方位資料無效,請稍後再試',
    'tilt-too-large': '請將手機放平再讀數',
    unstable: '讀數不穩定,附近可能有磁性物體',
    'too-few': '樣本不足,請再等一下',
    degenerate: '手機太接近水平,無法判定後鏡頭方向',
  };
  for (const [k, v] of Object.entries(spec)) {
    assert.equal(sensorMessage(k), v, k);
    assert.equal(STATUS_INFO[k].message, v);
  }
  assert.equal(sensorMessage('insecure-context'), '偵測不到方位感測器'); // 開發者訊息不外露
  assert.equal(sensorMessage('ok'), null);
  assert.equal(lockBlockedMessage('tilt'), '請將手機放平再讀數');
  assert.equal(lockBlockedMessage('face-down'), '請螢幕朝上');
  assert.equal(lockBlockedMessage('quality-red'), '請遠離金屬,手持手機畫 8 字');
});

// ── 寫入 store ──
test('buildFacingPatch: 手動 / 感測器鎖定 / 量坐 / 真北', () => {
  const mag = { trueMode: false, declination: null };
  assert.deepEqual(
    buildFacingPatch({ measured: 175, measure: 'facing', basis: mag, origin: 'manual', lock: null }),
    { bearing: 175, source: 'manual', sigma: null, lockedAtMs: null },
  );
  assert.deepEqual(
    buildFacingPatch({ measured: 175.5, measure: 'facing', basis: mag, origin: 'sensor', lock: { sigma: 1.234, lockedAtMs: 1700000000000 } }),
    { bearing: 175.5, source: 'sensor', sigma: 1.23, lockedAtMs: 1700000000000 },
  );
  // 沒有鎖定的感測器即時值: 不寫 sigma
  assert.deepEqual(
    buildFacingPatch({ measured: 90, measure: 'facing', basis: mag, origin: 'sensor', lock: null }),
    { bearing: 90, source: 'sensor', sigma: null, lockedAtMs: null },
  );
  assert.equal(buildFacingPatch({ measured: 175, measure: 'sit', basis: mag, origin: 'manual', lock: null }).bearing, 355);
  const tr = { trueMode: true, declination: -5 };
  assert.equal(buildFacingPatch({ measured: 5, measure: 'facing', basis: tr, origin: 'manual', lock: null }).bearing, 10);
  assert.equal(facingFromMeasured(200, 'sit'), 20);
});

test('savedBearingOf: 壞資料當成尚未量測', () => {
  assert.equal(savedBearingOf({ facing: { bearing: 175 } }), 175);
  for (const bad of [null, undefined, NaN, Infinity, '175', {}]) assert.equal(savedBearingOf({ facing: { bearing: bad } }), null);
  assert.equal(savedBearingOf(null), null);
});

// ── 盤面排版 ──
test('舞台幾何: 桌面 420 寬盤面不超過 420,環面在盤緣內', () => {
  const g = stageGeometry(420);
  assert.equal(g.S, 420);
  assert.ok(g.R < g.Rb && g.Rb <= 210 - 15);
  assert.ok(Math.abs(g.k - 1) < 0.06);
  assert.ok(stageGeometry(343).R > 140);
});

test('盤面排版: 模式 A 每個環的字都在、順序與位置正確', () => {
  const plan = buildDialPlan({ R: 184 });
  const by = (kind) => plan.glyphs.filter((g) => g.kind === kind);
  assert.deepEqual(by('mountain').map((g) => g.text), MOUNTAINS.map((m) => m.name));
  by('mountain').forEach((g, i) => assert.equal(g.b, MOUNTAINS[i].centerDeg));
  assert.deepEqual(by('bagua').map((g) => g.text).sort(), ['乾', '兌', '坎', '坤', '巽', '震', '艮', '離'].sort());
  assert.equal(by('bagua').find((g) => g.text === '震').b, 90);
  assert.deepEqual(by('luoshu').map((g) => g.text).sort(), ['1', '2', '3', '4', '6', '7', '8', '9']);
  assert.equal(by('luoshu').find((g) => g.text === '9').b, 180); // 離九在南
  assert.equal(by('term').length, 48);
  assert.equal(by('xiu').map((g) => g.text).sort().join(''), [...'角亢氐房心尾箕斗牛女虛危室壁奎婁胃昴畢觜參井鬼柳星張翼軫'].sort().join(''));
  assert.deepEqual(by('scale').map((g) => g.text), Array.from({ length: 12 }, (_, i) => String(i * 30)));
  const r4 = plan.layout.rows.find((r) => r.key === 'r4');
  assert.equal(plan.ops.filter((o) => o.t === 'wedge' && Math.abs(o.r0 - r4.r0 * 184) < 1e-6).length, 24);
  assert.equal(plan.ops.filter((o) => o.t === 'yao').length, 24);
});

test('盤面排版: 24 山配色 陽=金底朱紅字、陰=漆黑底亮金字,對比 >= 4.5', () => {
  const plan = buildDialPlan({ R: 184 });
  const ring = ringById('mountains24').cells;
  const glyphs = plan.glyphs.filter((g) => g.kind === 'mountain');
  const r3 = plan.layout.rows.find((r) => r.key === 'r3');
  const wedges = plan.ops.filter((o) => o.t === 'wedge' && Math.abs(o.r0 - r3.r0 * 184) < 1e-6);
  assert.equal(wedges.length, 24);
  ring.forEach((c, i) => {
    const yang = c.yinyangSanyuan === '陽';
    assert.equal(wedges[i].fill.toLowerCase(), (yang ? PALETTE.gold_500 : PALETTE.lacquer_800).toLowerCase(), c.name);
    assert.equal(glyphs[i].color.toLowerCase(), (yang ? PALETTE.cinnabar_800 : PALETTE.gold_300).toLowerCase(), c.name);
    assert.ok(contrastRatio(glyphs[i].color, wedges[i].fill) >= 4.5, c.name);
  });
});

test('盤面排版: 字放得進環寬(節氣兩字堆疊、24 山字寬)', () => {
  for (const R of [140, 184, 210]) {
    const plan = buildDialPlan({ R });
    const rows = Object.fromEntries(plan.layout.rows.map((r) => [r.key, r]));
    const terms = plan.glyphs.filter((g) => g.kind === 'term');
    const rs = terms.map((g) => g.r);
    assert.ok(Math.max(...rs) + terms[0].px / 2 <= rows.r5.r1 * R + 0.5, `R=${R} 節氣外緣`);
    assert.ok(Math.min(...rs) - terms[0].px / 2 >= rows.r5.r0 * R - 0.5, `R=${R} 節氣內緣`);
    const mt = plan.glyphs.find((g) => g.kind === 'mountain');
    assert.ok(mt.px <= rows.r3.widthPx + 1e-9);
  }
});

test('盤面排版: 窄宿(觜、鬼)引線,房心星牛縮字,宿名互不重疊', () => {
  const plan = buildDialPlan({ R: 184 });
  const xiu = plan.glyphs.filter((g) => g.kind === 'xiu');
  const leaders = plan.ops.filter((o) => o.t === 'leader');
  assert.ok(leaders.length >= 1 && leaders.length <= 2);
  const lp = xiuLabelPlan();
  for (const name of ['觜', '鬼']) assert.equal(lp.find((x) => x.name === name).plan, 'leader');
  assert.equal(xiu.filter((g) => g.plan !== 'normal').map((g) => g.text).sort().join(''), [...'房心星牛觜鬼'].sort().join(''));
  const r = xiu[0].r;
  for (let i = 0; i < xiu.length; i += 1) {
    for (let j = i + 1; j < xiu.length; j += 1) {
      const a = xiu[i];
      const b = xiu[j];
      const d = Math.abs(((a.b - b.b + 540) % 360) - 180);
      const need = ((((a.px + b.px) / 2) * 0.62) / r) * (180 / Math.PI);
      const radialGap = Math.abs(a.r - b.r);
      assert.ok(d >= need * 0.9 || radialGap >= ((a.px + b.px) / 2) * 0.55, `${a.text}/${b.text} d=${d.toFixed(2)} need=${need.toFixed(2)}`);
    }
  }
});

test('盤面排版: 三合紅黑方案 sanhe 也能排', () => {
  const plan = buildDialPlan({ R: 150, yinyangScheme: 'sanhe' });
  assert.equal(plan.glyphs.filter((g) => g.kind === 'mountain').length, 24);
});

// ── 手勢 ──
function makeGesture({ reduced = false } = {}) {
  const clock = { t: 1000, q: [] };
  const log = { dials: [], started: 0, ended: [], settled: 0 };
  let dial = 0;
  const g = createDialGesture({
    getGeometry: () => ({ cx: 200, cy: 200, radiusPx: 180 }),
    getDial: () => dial,
    setDial: (d, meta) => { dial = d; log.dials.push([d, meta.phase]); },
    onStart: () => { log.started += 1; },
    onEnd: (i) => log.ended.push(i.omega0),
    onSettle: () => { log.settled += 1; },
    now: () => clock.t,
    raf: (fn) => { clock.q.push(fn); return clock.q.length; },
    caf: () => { clock.q.length = 0; },
    reducedMotion: () => reduced,
  });
  const advance = (ms) => { clock.t += ms; };
  const runFrames = (n, dt = 1000 / 60) => {
    for (let i = 0; i < n && clock.q.length; i += 1) {
      clock.t += dt;
      const fn = clock.q.shift();
      fn(clock.t);
    }
  };
  return { g, clock, log, advance, runFrames, get dial() { return dial; } };
}

/** 在半徑 rad 的圓上以 degPerMove 每 16ms 移動指尖 */
function swipe(h, { startDeg = -90, moves = 10, degPerMove = 6, rad = 120, endIdle = 0 }) {
  const pt = (d) => ({ x: 200 + rad * Math.cos((d * Math.PI) / 180), y: 200 + rad * Math.sin((d * Math.PI) / 180) });
  assert.equal(h.g.pointerDown(pt(startDeg)), true);
  for (let i = 1; i <= moves; i += 1) {
    h.advance(16);
    h.g.pointerMove(pt(startDeg + i * degPerMove));
  }
  h.advance(endIdle);
  h.g.pointerUp();
}

test('手勢: 拖曳時盤角跟著指尖轉(含跨 ±180° 展開)', () => {
  const h = makeGesture();
  swipe(h, { startDeg: 170, moves: 4, degPerMove: 6 }); // 170→194,跨過 180
  assert.ok(Math.abs(h.dial - 24) < 1e-6, `dial=${h.dial}`);
});

test('手勢: 天池內(< 0.16R)不啟動,盤外空白與壞座標也不接手', () => {
  const h = makeGesture();
  assert.equal(h.g.pointerDown({ x: 200 + 20, y: 200 }), false); // 20px < 0.16*180=28.8
  assert.equal(h.g.pointerDown({ x: 200 + 25, y: 200 }), false);
  assert.equal(h.g.pointerDown({ x: 200 + 30, y: 200 }), true);
  h.g.pointerUp();
  assert.equal(h.g.pointerDown({ x: 200 + 400, y: 200 }), false);
  assert.equal(h.log.started, 1);
  assert.equal(h.g.pointerDown({ x: NaN, y: 3 }), false);
});

test('手勢: 放手前 80ms 沒動 → 沒有慣性', () => {
  const h = makeGesture();
  swipe(h, { moves: 8, degPerMove: 8, endIdle: 150 });
  assert.equal(h.log.ended[0], 0);
  assert.equal(h.g.isCoasting(), false);
  const before = h.dial;
  h.runFrames(200);
  assert.equal(h.dial, before);
});

test('手勢: 放手前 80ms 內還在動 → 慣性,總滑行約 ω0·τ,並自動停止', () => {
  const h = makeGesture();
  swipe(h, { moves: 20, degPerMove: 8, endIdle: 30 });
  const omega0 = h.log.ended[0];
  assert.ok(omega0 > 100, `omega0=${omega0}`);
  assert.equal(h.g.isCoasting(), true);
  const releaseDial = h.dial;
  h.runFrames(600);
  assert.equal(h.g.isCoasting(), false);
  assert.equal(h.log.settled, 1);
  const total = h.dial - releaseDial;
  const expect = omega0 * GESTURE.tauSec;
  assert.ok(Math.abs(total - expect) < expect * 0.06 + 1, `total=${total} expect≈${expect}`);
  assert.ok(Math.abs(total - simulateInertia(omega0).totalDeg) < 3);
});

test('手勢: 減少動態偏好 → 不做慣性', () => {
  const h = makeGesture({ reduced: true });
  swipe(h, { moves: 20, degPerMove: 8, endIdle: 10 });
  assert.equal(h.log.ended[0], 0);
  assert.equal(h.g.isCoasting(), false);
});

test('手勢: 慣性中再按下會立刻停住,destroy 不留動畫幀', () => {
  const h = makeGesture();
  swipe(h, { moves: 20, degPerMove: 8, endIdle: 10 });
  assert.equal(h.g.isCoasting(), true);
  h.runFrames(3);
  assert.equal(h.g.pointerDown({ x: 320, y: 200 }), true);
  assert.equal(h.g.isCoasting(), false);
  assert.equal(h.clock.q.length, 0);
  h.g.pointerUp();
  swipe(h, { moves: 20, degPerMove: 8, endIdle: 10 });
  h.g.destroy();
  assert.equal(h.clock.q.length, 0);
});

test('手勢: 幾乎沒動的拖曳不會進慣性', () => {
  const h = makeGesture();
  swipe(h, { moves: 3, degPerMove: 0.001, endIdle: 10 });
  assert.equal(h.g.isCoasting(), false);
});

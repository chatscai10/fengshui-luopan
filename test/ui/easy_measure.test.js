// 自我檢查、寫入朝向、穩定度與姿勢提示(EASY_SPEC 8.4、8.2、5.7)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_DEFAULTS, combineChecks, checkVerdictText, easyFacingPatch, facingCheckOf, fmtSmall } from '../../src/ui/easy/measure.js';
import { EASY_TEXT } from '../../src/ui/easy/text.js';
import { eightImpact } from '../../src/ui/easy/direction.js';
import { basisOf, rawFromDisplayed, roundTenth } from '../../src/ui/basis.js';
import { buildFacingPatch } from '../../src/ui/views/compass.js';
import { qualityLight, SENSOR_DEFAULTS } from '../../src/core/sensor-core.js';
import {
  accuracyView, postureHint, inAppBrowserName, sensorSupported, sensorMessage, lockBlockedMessage,
  STABILITY_LABEL, SENSOR_FALLBACK_HINT, DENIED_HELP,
} from '../../src/ui/sensorText.js';

const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);
const R = (...means) => means.map((m, i) => ({ meanDeg: m, sigma: 1, status: 'ok', lockedAtMs: 1000 + i }));
const circ = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('combineChecks:規格範例', () => {
  const a = combineChecks(R(196, 198));
  assert.equal(a.verdict, 'agree');
  assert.equal(a.spreadDeg, 2);
  assert.equal(a.n, 2);
  assert.deepEqual(a.used, [0, 1]);
  assert.equal(a.dropped, null);
  assert.ok(circ(a.meanDeg, 197) < 1e-9);

  const w = combineChecks(R(358, 3));
  assert.equal(w.verdict, 'agree');
  assert.ok(circ(w.meanDeg, 0.5) < 1e-9, `跨 0 度平均 ${w.meanDeg}`);
  assert.ok(Math.abs(w.spreadDeg - 5) < 1e-9);

  assert.equal(combineChecks(R(190, 200)).verdict, 'warn');
  assert.equal(combineChecks(R(170, 200)).verdict, 'far');

  const d = combineChecks(R(196, 198, 230));
  assert.equal(d.verdict, 'dropped');
  assert.equal(d.dropped, 2);
  assert.deepEqual(d.used, [0, 1]);
  assert.equal(d.spreadDeg, 2);
  assert.ok(circ(d.meanDeg, 197) < 1e-9);

  const x = combineChecks(R(180, 200, 220));
  assert.equal(x.verdict, 'inconsistent');
  assert.ok(circ(x.meanDeg, 200) < 1e-9, 'mean 取三筆');
  assert.equal(x.spreadDeg, 40);

  assert.equal(combineChecks(R(196, 200), { measureUncertainty: 3 }).verdict, 'warn');
  assert.equal(CHECK_DEFAULTS.warnMaxDeg, 15);
});

test('combineChecks:單次、三次一致、三次差一點、離群值在前面、跨 0 度', () => {
  const one = combineChecks([{ meanDeg: 215, sigma: 1.2, status: 'ok', lockedAtMs: 5 }]);
  assert.equal(one.verdict, 'single-noacc', 'Android 不回報誤差:穩不代表準');
  assert.equal(one.accuracyDeg, null);
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 1.2, status: 'ok', lockedAtMs: 5, accuracyDeg: 8 }]).verdict, 'single-ok');
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 1.2, status: 'ok', lockedAtMs: 5, accuracyDeg: 10 }]).verdict, 'single-ok');
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 1.2, status: 'ok', lockedAtMs: 5, accuracyDeg: 10.5 }]).verdict, 'single-wide');
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 1.2, status: 'ok', lockedAtMs: 5, accuracyDeg: -1 }]).verdict, 'single-noacc', '未校準的 −1 不算精度');
  assert.equal(one.spreadDeg, null);
  assert.equal(one.sigmaMax, 1.2);
  assert.equal(one.meanDeg, 215);
  assert.equal(one.uncertaintyDeg, 5);
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 4, status: 'unstable', lockedAtMs: 5 }]).verdict, 'single-unstable');
  assert.equal(combineChecks([{ meanDeg: 215, sigma: 4, status: 'unstable', lockedAtMs: 5 }]).uncertaintyDeg, 8);

  assert.equal(combineChecks(R(200, 202, 204)).verdict, 'agree');
  assert.equal(combineChecks(R(200, 204, 208)).verdict, 'warn', '兩對一致但頭尾差 8 度');
  const first = combineChecks(R(250, 200, 202));
  assert.equal(first.verdict, 'dropped');
  assert.equal(first.dropped, 0);
  const wrap = combineChecks(R(359, 2, 40));
  assert.equal(wrap.verdict, 'dropped');
  assert.equal(wrap.dropped, 2);
  assert.ok(circ(wrap.meanDeg, 0.5) < 1e-9);
  assert.equal(combineChecks(R(350, 5, 355)).verdict, 'dropped');
  assert.equal(combineChecks(R(354, 0, 6)).verdict, 'warn');
  assert.equal(combineChecks(R(352, 0, 8)).verdict, 'inconsistent');
});

test('combineChecks:n=2 門檻邊界(= 5 算一致、= 15 算有點多)', () => {
  assert.equal(combineChecks(R(100, 105)).verdict, 'agree');
  assert.equal(combineChecks(R(100, 105.5)).verdict, 'warn');
  assert.equal(combineChecks(R(100, 115)).verdict, 'warn');
  assert.equal(combineChecks(R(100, 115.5)).verdict, 'far');
  assert.equal(combineChecks(R(355, 10)).verdict, 'warn');
});

test('combineChecks:uncertaintyDeg = max(基準, 2σ, 差距);lockedAtMs 取最後一筆', () => {
  const c = combineChecks([{ meanDeg: 10, sigma: 1, status: 'ok', lockedAtMs: 1 }, { meanDeg: 17, sigma: 1, status: 'ok', lockedAtMs: 99 }]);
  assert.equal(c.uncertaintyDeg, 7);
  assert.equal(c.lockedAtMs, 99);
  const s = combineChecks([{ meanDeg: 10, sigma: 4.5, status: 'unstable', lockedAtMs: 1 }, { meanDeg: 12, sigma: 1, status: 'ok', lockedAtMs: 2 }]);
  assert.equal(s.sigmaMax, 4.5);
  assert.equal(s.uncertaintyDeg, 9);
  assert.equal(combineChecks(R(10, 11), { measureUncertainty: 8 }).uncertaintyDeg, 8);
  // 排除的那一次不算進差距與 σ
  const d = combineChecks([{ meanDeg: 196, sigma: 1, status: 'ok', lockedAtMs: 1 }, { meanDeg: 198, sigma: 1, status: 'ok', lockedAtMs: 2 }, { meanDeg: 230, sigma: 6, status: 'unstable', lockedAtMs: 3 }]);
  assert.equal(d.sigmaMax, 1);
  assert.equal(d.uncertaintyDeg, 5);
});

test('combineChecks:iPhone 自己估計的誤差算進 U(手機說 ±20 度時,150 度一定是「接近分界」)', () => {
  const c = combineChecks([{ meanDeg: 150, sigma: 1, status: 'ok', lockedAtMs: 1, accuracyDeg: 20 }]);
  assert.equal(c.accuracyDeg, 20);
  assert.equal(c.uncertaintyDeg, 20);
  assert.equal(c.verdict, 'single-wide');
  assert.equal(eightImpact(150, c.uncertaintyDeg).near, true);
  // 兩次:取採用者的最大值;排除的那一次不算
  const two = combineChecks([{ meanDeg: 196, sigma: 1, status: 'ok', lockedAtMs: 1, accuracyDeg: 8 }, { meanDeg: 198, sigma: 1, status: 'ok', lockedAtMs: 2, accuracyDeg: 12 }]);
  assert.equal(two.accuracyDeg, 12);
  assert.equal(two.uncertaintyDeg, 12);
  const dropped = combineChecks([
    { meanDeg: 196, sigma: 1, status: 'ok', lockedAtMs: 1, accuracyDeg: 6 }, { meanDeg: 198, sigma: 1, status: 'ok', lockedAtMs: 2, accuracyDeg: 7 },
    { meanDeg: 230, sigma: 1, status: 'ok', lockedAtMs: 3, accuracyDeg: 24 }]);
  assert.equal(dropped.accuracyDeg, 7);
  assert.equal(dropped.uncertaintyDeg, 7);
});

test('combineChecks:壞輸入回 null,不丟例外', () => {
  for (const bad of [null, [], R(1, 2, 3, 4), [{ meanDeg: NaN }], [null], 'x', [{ meanDeg: 10 }, { meanDeg: '20' }]]) {
    assert.equal(combineChecks(bad), null);
  }
  // σ 缺也能算
  assert.equal(combineChecks([{ meanDeg: 10, status: 'ok' }]).sigmaMax, null);
});

test('fmtSmall:最多 1 位小數,去掉 .0', () => {
  assert.equal(fmtSmall(2), '2');
  assert.equal(fmtSmall(2.04), '2');
  assert.equal(fmtSmall(2.46), '2.5');
  assert.equal(fmtSmall(4.999999), '5');
  assert.equal(fmtSmall(0), '0');
  assert.equal(fmtSmall(null), '0');
  assert.equal(fmtSmall(NaN), '0');
});

test('checkVerdictText:每種 verdict 的逐字文案與圖示', () => {
  const t = (readings, s) => checkVerdictText(combineChecks(readings, s), 3);
  const one = t([{ meanDeg: 215, sigma: 1.24, status: 'ok', lockedAtMs: 1, accuracyDeg: 8 }]);
  assert.deepEqual(one, { icon: '✓', text: '量得很穩,手沒有晃。想更放心,可以走一大步再量一次比對。', systematic: null });
  assert.deepEqual(t([{ meanDeg: 215, sigma: 0.02, status: 'ok', lockedAtMs: 1 }]), {
    icon: 'i', text: '量得很穩,手沒有晃。不過這支手機不會告訴我們它自己的誤差,穩不代表準。建議走一大步再量一次,兩次一樣就比較放心。', systematic: null,
  });
  assert.deepEqual(t([{ meanDeg: 215, sigma: 1, status: 'ok', lockedAtMs: 1, accuracyDeg: 19.6 }]), {
    icon: '!', text: '手機自己估計,可能差 20 度左右,有點大。建議離鐵門、冰箱、電器遠一點,走一大步再量一次。', systematic: null,
  });
  const un = checkVerdictText(combineChecks([{ meanDeg: 215, sigma: 4, status: 'unstable', lockedAtMs: 1 }]), 5);
  assert.deepEqual(un, { icon: '!', text: '這 5 秒讀數晃得比較多(約 4 度),附近可能有會干擾的東西。建議移一步再量一次。', systematic: null });
  assert.deepEqual(t(R(196, 198)), { icon: '✓', text: '2 次只差 2 度,附近沒有明顯干擾。', systematic: EASY_TEXT['d.systematic'] });
  assert.deepEqual(t(R(196, 198.5, 197)), { icon: '✓', text: '3 次只差 2.5 度,附近沒有明顯干擾。', systematic: EASY_TEXT['d.systematic'] });
  assert.deepEqual(t(R(190, 200)), { icon: '!', text: '兩次差 10 度,有點多。可能其中一個位置附近有鐵門、電器或鋼筋。建議再量第 3 次。', systematic: null });
  // 兩次差得有點多,但都還在同一個大方位(不接近分界):不當成問題,和影響區塊一致
  const w2 = combineChecks(R(175, 164));
  assert.deepEqual(checkVerdictText(w2, 3, { near: false, dir: '南' }),
    { icon: '✓', text: '兩次差 11 度,但兩次都是南方。想更放心,可以再量第 3 次。', systematic: EASY_TEXT['d.systematic'] });
  assert.equal(checkVerdictText(w2, 3, { near: true, dir: '南' }).icon, '!');
  assert.deepEqual(t(R(200, 204, 208)), { icon: '!', text: '三次最多差 8 度,有點多,結果僅供參考。', systematic: null });
  assert.deepEqual(t(R(170, 200)), { icon: '!', text: '兩次差 30 度,差很多,附近很可能有東西在干擾指北針。建議換到離鐵門和電器遠一點的地方再量,或改成自己選方向。', systematic: null });
  assert.deepEqual(t(R(196, 198, 230)), { icon: '✓', text: '第 3 次和另外兩次差很多,已經不採用;另外兩次只差 2 度,附近沒有明顯干擾。', systematic: EASY_TEXT['d.systematic'] });
  assert.deepEqual(t(R(180, 200, 220)), { icon: '!', text: '三次結果都不太一致,平均值可能不準。建議改成自己選方向,或請老師用實體羅盤確認。', systematic: null });
  assert.equal(EASY_TEXT['d.systematic'], '不過如果整棟大樓鋼筋很多,幾次也可能一起偏;想更放心,可以用地圖對一次(見「手機指北針準嗎?」)。');
  assert.equal(checkVerdictText(null), null);
  assert.equal(checkVerdictText({ verdict: 'zzz' }), null);
});

const TAIPEI_TRUE = { facing: { cityId: '台北' }, settings: { northMode: 'true' } };
const MAG = { facing: { cityId: '台北' }, settings: {} };

test('easyFacingPatch:磁北與真北(台北)下的 sensor / pick8 / typed', () => {
  const tb = basisOf(TAIPEI_TRUE, NOW);
  const mb = basisOf(MAG, NOW);
  assert.equal(tb.trueMode, true);

  const p8 = easyFacingPatch({ displayedDeg: 225, basis: tb, origin: 'pick8' });
  assert.deepEqual(p8, { bearing: roundTenth(rawFromDisplayed(225, tb)), source: 'pick8', sigma: null, lockedAtMs: null, check: null, doorBearing: null });
  assert.ok(Math.abs(p8.bearing - 230) < 0.2, `真北選西南,存的磁北讀數約 230,實得 ${p8.bearing}`);
  assert.equal(easyFacingPatch({ displayedDeg: 225, basis: mb, origin: 'pick8' }).bearing, 225);

  const typed = easyFacingPatch({ displayedDeg: 175.26, basis: mb, origin: 'typed' });
  assert.deepEqual(typed, { bearing: 175.3, source: 'manual', sigma: null, lockedAtMs: null, check: null, doorBearing: null });

  const lock = { sigma: 1.234, lockedAtMs: 1700000000123.6 };
  const check = { n: 2, spreadDeg: 2.46, lockedAtMs: 1700000000123.6 };
  const s = easyFacingPatch({ displayedDeg: 359.96, basis: mb, origin: 'sensor', lock, check });
  assert.deepEqual(s, { bearing: 0, source: 'sensor', sigma: 1.23, lockedAtMs: 1700000000124, check: { n: 2, spreadDeg: 2.5, lockedAtMs: 1700000000124, dropped: 0, accuracyDeg: null }, doorBearing: null });
  assert.ok(facingCheckOf(s), '剛寫入的 check 綁定同一次鎖定,應有效');

  const one = easyFacingPatch({ displayedDeg: 215, basis: tb, origin: 'sensor', lock, check: { n: 1, spreadDeg: null, lockedAtMs: 1 } });
  assert.deepEqual(one.check, { n: 1, spreadDeg: null, lockedAtMs: 1700000000124, dropped: 0, accuracyDeg: null });
  // 排除過一次、iPhone 估計誤差:一起記下(store.input() 會把誤差算進不確定度)
  const three = easyFacingPatch({ displayedDeg: 215, basis: mb, origin: 'sensor', lock, check: { n: 3, spreadDeg: 2, lockedAtMs: 1, dropped: 2, accuracyDeg: 12.34 } });
  assert.deepEqual(three.check, { n: 3, spreadDeg: 2, lockedAtMs: 1700000000124, dropped: 1, accuracyDeg: 12.3 });
  assert.ok(facingCheckOf(three));
  // 沒有鎖定就沒有 σ、時間與 check
  const nolock = easyFacingPatch({ displayedDeg: 215, basis: mb, origin: 'sensor', check });
  assert.equal(nolock.sigma, null);
  assert.equal(nolock.check, null);
});

test('easyFacingPatch:sensor 與 typed 的 bearing/sigma/lockedAtMs 等於羅盤頁 buildFacingPatch', () => {
  const bases = [basisOf(MAG, NOW), basisOf(TAIPEI_TRUE, NOW)];
  const locks = [null, { sigma: 0.876, lockedAtMs: 12345.4 }, { sigma: 2.5, lockedAtMs: null }, { sigma: null, lockedAtMs: 9 }];
  for (const basis of bases) {
    for (const deg of [0, 0.04, 44.95, 175.25, 215, 359.96, 359.99]) {
      for (const lock of locks) {
        const a = buildFacingPatch({ measured: deg, measure: 'facing', basis, origin: 'sensor', lock });
        const b = easyFacingPatch({ displayedDeg: deg, basis, origin: 'sensor', lock });
        assert.deepEqual([b.bearing, b.source, b.sigma, b.lockedAtMs], [a.bearing, a.source, a.sigma, a.lockedAtMs], `sensor ${deg} ${JSON.stringify(lock)}`);
      }
      const m = buildFacingPatch({ measured: deg, measure: 'facing', basis, origin: 'manual', lock: null });
      const t = easyFacingPatch({ displayedDeg: deg, basis, origin: 'typed' });
      assert.deepEqual([t.bearing, t.source, t.sigma, t.lockedAtMs], [m.bearing, m.source, m.sigma, m.lockedAtMs], `typed ${deg}`);
    }
  }
});

test('easyFacingPatch:壞輸入回 null', () => {
  const mb = basisOf(MAG, NOW);
  assert.equal(easyFacingPatch({ displayedDeg: NaN, basis: mb, origin: 'sensor' }), null);
  assert.equal(easyFacingPatch({ displayedDeg: 10, basis: mb, origin: 'manual' }), null);
  assert.equal(easyFacingPatch(), null);
  // basis 缺時當磁北
  assert.equal(easyFacingPatch({ displayedDeg: 10, origin: 'typed' }).bearing, 10);
});

test('facingCheckOf:lockedAtMs 不同、來源不是 sensor、格式不對都回 null', () => {
  const ok = { source: 'sensor', lockedAtMs: 50, check: { n: 2, spreadDeg: 3, lockedAtMs: 50 } };
  assert.deepEqual(facingCheckOf(ok), { n: 2, spreadDeg: 3, lockedAtMs: 50 });
  assert.equal(facingCheckOf({ ...ok, lockedAtMs: 51 }), null);
  assert.equal(facingCheckOf({ ...ok, lockedAtMs: null }), null);
  assert.equal(facingCheckOf({ ...ok, source: 'manual' }), null);
  assert.equal(facingCheckOf({ ...ok, source: 'pick8' }), null);
  assert.equal(facingCheckOf({ ...ok, check: null }), null);
  assert.equal(facingCheckOf({ ...ok, check: { n: 4, spreadDeg: 3, lockedAtMs: 50 } }), null);
  assert.equal(facingCheckOf({ ...ok, check: { n: 2, spreadDeg: -1, lockedAtMs: 50 } }), null);
  assert.equal(facingCheckOf({ ...ok, check: { n: 2, lockedAtMs: 50 } }), null);
  assert.deepEqual(facingCheckOf({ ...ok, check: { n: 1, spreadDeg: null, lockedAtMs: 50 } }), { n: 1, spreadDeg: null, lockedAtMs: 50 });
  assert.ok(facingCheckOf({ ...ok, check: { n: 3, spreadDeg: 2, lockedAtMs: 50, dropped: 1, accuracyDeg: 9 } }));
  assert.equal(facingCheckOf({ ...ok, check: { n: 3, spreadDeg: 2, lockedAtMs: 50, dropped: 2 } }), null);
  assert.equal(facingCheckOf({ ...ok, check: { n: 3, spreadDeg: 2, lockedAtMs: 50, accuracyDeg: -1 } }), null);
  assert.equal(facingCheckOf(null), null);
  assert.equal(facingCheckOf({}), null);
});

test('accuracyView:8 種原因句與優先序', () => {
  const v = (r) => accuracyView(r);
  assert.deepEqual(v({ status: 'ok', accuracyDeg: 8, sigmaDeg: 1, quality: 'green' }), {
    level: 'green', bars: 3, label: '手拿得很穩', reasonKey: 'ios-ok', reason: '手機自己估計,可能差 8 度左右。', accuracyDeg: 8,
  });
  const steady = v({ status: 'ok', accuracyDeg: null, sigmaDeg: 1.5 });
  assert.equal(steady.reasonKey, 'steady');
  assert.equal(steady.label, '手拿得很穩');
  assert.equal(steady.reason, '這支手機不會告訴我們它自己的誤差,穩不代表準;記下後可以移一步再量一次比對。');
  // Android(沒有精度)且幾乎不晃:仍然不說「準」
  const still = v({ status: 'ok', accuracyDeg: null, sigmaDeg: 0.2 });
  assert.deepEqual([still.level, still.reasonKey, still.accuracyDeg], ['green', 'steady', null]);
  assert.ok(!/準確|很準/.test(still.label + still.reason.replace('穩不代表準', '')));
  const wide = v({ status: 'ok', accuracyDeg: 18.4, sigmaDeg: 1 });
  assert.deepEqual([wide.level, wide.bars, wide.label, wide.reasonKey], ['yellow', 2, '誤差有點大', 'ios-wide']);
  assert.equal(wide.reason, '手機自己估計,可能差 18 度左右,有點大。離鐵門、冰箱、電器遠一點再看看。');
  const jitter = v({ status: 'ok', accuracyDeg: null, sigmaDeg: 3 });
  assert.deepEqual([jitter.level, jitter.label, jitter.reasonKey, jitter.reason], ['yellow', '手有點晃', 'jitter', '讀數有點晃。手機放平、手不要動,離鐵門、冰箱、電器遠一點。']);
  const unc = v({ status: 'uncalibrated', accuracyDeg: -1, sigmaDeg: null });
  assert.deepEqual([unc.level, unc.bars, unc.label, unc.reasonKey], ['red', 1, '還沒校準', 'uncalibrated']);
  assert.equal(unc.reason, '手機說指北針還沒校準。拿著手機在空中慢慢畫幾個 8 字,再回來量。');
  const bad = v({ status: 'ok', accuracyDeg: 40, sigmaDeg: 1 });
  assert.deepEqual([bad.level, bad.label, bad.reasonKey], ['red', '誤差太大', 'ios-bad']);
  assert.equal(bad.reason, `手機自己估計,誤差超過 ${SENSOR_DEFAULTS.accuracyYellowMax} 度,現在量不準。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。`);
  const jb = v({ status: 'ok', accuracyDeg: null, sigmaDeg: 6 });
  assert.deepEqual([jb.level, jb.label, jb.reasonKey, jb.reason], ['red', '晃得太多', 'jitter-bad', '讀數一直跳,附近可能有會干擾的東西。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。']);
  for (const r of [null, undefined, { status: 'ok', accuracyDeg: null, sigmaDeg: null }]) {
    const w = v(r);
    assert.deepEqual([w.level, w.bars, w.label, w.reasonKey, w.reason], ['unknown', 0, '判斷中', 'waiting', '正在判斷,請把手機放平、保持不動 1 秒。']);
  }
  // 優先序:較差的一項先講;同級先講精度
  assert.equal(v({ status: 'ok', accuracyDeg: 18, sigmaDeg: 3 }).reasonKey, 'ios-wide');
  assert.equal(v({ status: 'ok', accuracyDeg: 8, sigmaDeg: 3 }).reasonKey, 'jitter');
  assert.equal(v({ status: 'ok', accuracyDeg: 18, sigmaDeg: 6 }).reasonKey, 'jitter-bad');
  assert.equal(v({ status: 'ok', accuracyDeg: 30, sigmaDeg: 6 }).reasonKey, 'ios-bad');
  assert.equal(v({ status: 'ok', accuracyDeg: 30, sigmaDeg: 3 }).reasonKey, 'ios-bad');
  assert.equal(v({ status: 'ok', accuracyDeg: -1, sigmaDeg: 1 }).reasonKey, 'uncalibrated');
  assert.equal(v({ status: 'uncalibrated', accuracyDeg: null, sigmaDeg: null }).reasonKey, 'uncalibrated');
});

test('accuracyView:燈號與 qualityLight 在精度 × σ 格點下完全一致', () => {
  const accs = [null, -1, 0, 5, 10, 10.01, 18, 25, 25.01, 40];
  const sigmas = [null, 0, 1, 2, 2.01, 3, 4, 4.01, 9];
  for (const accuracyDeg of accs) {
    for (const sigmaDeg of sigmas) {
      const view = accuracyView({ status: 'ok', accuracyDeg, sigmaDeg });
      assert.equal(view.level, qualityLight({ accuracyDeg, sigmaDeg }), `acc ${accuracyDeg} σ ${sigmaDeg}`);
      assert.equal(view.label, STABILITY_LABEL[view.reasonKey]);
      assert.ok(!view.reason.includes('±'), view.reason);
      assert.ok(view.reason && !view.reason.includes('{'), view.reason);
    }
  }
});

test('postureHint:螢幕朝下 > 太傾斜的讀數 > 傾斜超過鎖定門檻', () => {
  assert.equal(postureHint({ status: 'tilt-too-large', faceDown: true, tiltDeg: 60 }), '請螢幕朝上');
  assert.equal(postureHint({ status: 'tilt-too-large', faceDown: false, tiltDeg: 60 }), '請將手機放平再讀數');
  assert.equal(postureHint({ status: 'ok', faceDown: false, tiltDeg: 40 }), '手機有點斜,請放平(傾斜 40 度)');
  assert.equal(postureHint({ status: 'ok', faceDown: false, tiltDeg: 15 }), '手機有點斜,請放平(傾斜 15 度)');
  assert.equal(postureHint({ status: 'ok', faceDown: false, tiltDeg: 14.9 }), '');
  assert.equal(postureHint({ status: 'ok', faceDown: false, tiltDeg: null }), '');
  assert.equal(postureHint(null), '');
});

test('inAppBrowserName:LINE(iOS/Android)、Facebook、Instagram;一般瀏覽器回 null', () => {
  const ua = {
    lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.3.1',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 Line/14.4.2/IAB',
    fb: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.34.106;FBBV/1]',
    fbAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.48.109;]',
    ig: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235 (iPhone15,2; iOS 17_4)',
    safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  assert.equal(inAppBrowserName(ua.lineIos), 'LINE');
  assert.equal(inAppBrowserName(ua.lineAndroid), 'LINE');
  assert.equal(inAppBrowserName(ua.fb), 'Facebook');
  assert.equal(inAppBrowserName(ua.fbAndroid), 'Facebook');
  assert.equal(inAppBrowserName(ua.ig), 'Instagram');
  assert.equal(inAppBrowserName(ua.safari), null);
  assert.equal(inAppBrowserName(ua.chrome), null);
  assert.equal(inAppBrowserName(ua.linux), null, '「Linux」不是 LINE');
  assert.equal(inAppBrowserName(undefined), null);
});

test('sensorSupported、sensorMessage、lockBlockedMessage 與共用常數', () => {
  assert.equal(sensorSupported({ DeviceOrientationEvent: function DOE() {} }), true);
  assert.equal(sensorSupported({}), false);
  assert.equal(sensorSupported(null), false);
  assert.equal(sensorMessage('insecure-context'), '偵測不到方位感測器');
  assert.equal(sensorMessage('no-sensor'), '偵測不到方位感測器');
  assert.equal(sensorMessage('permission-denied'), '需要允許「動作與方向」才能使用羅盤');
  assert.equal(sensorMessage('running'), null);
  assert.equal(lockBlockedMessage('tilt'), '請將手機放平再讀數');
  assert.equal(lockBlockedMessage('uncalibrated'), sensorMessage('uncalibrated'));
  assert.equal(lockBlockedMessage('face-down'), '請螢幕朝上');
  assert.equal(lockBlockedMessage('quality-red'), '請遠離金屬,手持手機畫 8 字');
  assert.equal(lockBlockedMessage('not-running'), '請先按「使用手機指北針」。');
  assert.equal(lockBlockedMessage('not-running', { startLabel: '開始量' }), '請先按「開始量」。');
  assert.equal(lockBlockedMessage('no-reading'), '還沒有讀到方位資料,請稍等一下。');
  assert.equal(SENSOR_FALLBACK_HINT, '請拖曳盤面或輸入度數。');
  assert.equal(DENIED_HELP, '(沒有跳出詢問的話,請完全關閉 Safari 或主畫面 App 後重開;仍不行,到 設定 > Safari > 進階 > 網站資料 移除本網站)');
});

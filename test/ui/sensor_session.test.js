// 手機指北針控制器(EASY_SPEC 8.10):用假環境(事件、計時器、權限)驗證狀態轉換、鎖定與收尾。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEnv } from '../helpers/sensor.js';
import { createSensorSession } from '../../src/ui/sensorSession.js';
import { DENIED_HELP, sensorMessage } from '../../src/ui/sensorText.js';

/** 平放、螢幕朝上時頂端朝向 heading(alpha 逆時針) */
const flat = (heading, extra = {}) => ({ alpha: (360 - heading) % 360, beta: 0, gamma: 0, absolute: true, ...extra });
const circ = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

function setup(envOpts = {}, sessOpts = {}) {
  const fake = createFakeEnv(envOpts);
  const changes = [];
  const session = createSensorSession({ env: fake.env, onChange: (s, kind) => changes.push({ kind, phase: s.phase }), ...sessOpts });
  return { fake, session, changes };
}

/** 每 50ms 送一筆事件並推進時鐘(取樣率 20 Hz) */
function feed(fake, headings, extra = {}, type = 'deviceorientationabsolute') {
  for (const h of headings) {
    fake.dispatch(type, flat(h, extra));
    fake.advance(50);
  }
}

test('有事件 → running,headingRaw 約等於手機頂端方位;Android 沒有精度欄位', async () => {
  const { fake, session, changes } = setup();
  const p = session.start();
  await p;
  assert.equal(session.getState().phase, 'running');
  feed(fake, new Array(10).fill(215));
  const s = session.getState();
  assert.equal(s.phase, 'running');
  assert.ok(circ(s.headingRaw, 215) < 0.01, `headingRaw ${s.headingRaw}`);
  assert.equal(s.reading.accuracyDeg, null, 'Android 事件沒有精度');
  assert.equal(s.reading.status, 'ok');
  assert.equal(s.message, '');
  assert.equal(s.failStatus, null);
  assert.ok(changes.some((c) => c.kind === 'reading'));
  assert.ok(changes.some((c) => c.kind === 'phase' && c.phase === 'running'));
  // 跨 0 度也平滑
  feed(fake, Array.from({ length: 30 }, (_, i) => (i % 2 ? 1 : 359)));
  assert.ok(circ(session.getState().headingRaw, 0) < 5);
  session.destroy();
});

test('start() 在同一個呼叫裡同步要權限(iOS 只在點擊當下彈窗)', async () => {
  const { fake, session } = setup({ requestPermission: async () => 'granted' });
  const p = session.start();
  assert.equal(fake.permissionCalls.length, 1, 'requestPermission 必須在 start() 返回前就被呼叫');
  assert.equal(session.getState().phase, 'starting');
  const res = await p;
  assert.equal(res.ok, true);
  assert.equal(session.getState().phase, 'running');
  // 重複 start 不再要權限
  await session.start();
  assert.equal(fake.permissionCalls.length, 1);
  session.destroy();
});

test('1.5 秒沒有事件 → waiting「偵測不到方位感測器」;事件來了自動恢復', async () => {
  const { fake, session } = setup();
  await session.start();
  fake.advance(1500);
  let s = session.getState();
  assert.equal(s.phase, 'waiting');
  assert.equal(s.failStatus, 'no-events');
  assert.equal(s.message, '偵測不到方位感測器');
  feed(fake, [90, 90, 90]);
  s = session.getState();
  assert.equal(s.phase, 'running');
  assert.equal(s.message, '');
  session.destroy();
});

test('權限被拒 → failed,訊息接上 DENIED_HELP,監聽已移除', async () => {
  const { fake, session } = setup({ requestPermission: async () => 'denied' });
  const res = await session.start();
  assert.equal(res.ok, false);
  const s = session.getState();
  assert.equal(s.phase, 'failed');
  assert.equal(s.failStatus, 'permission-denied');
  assert.ok(s.message.includes(DENIED_HELP));
  assert.ok(s.message.startsWith(sensorMessage('permission-denied')));
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
});

test('權限詢問丟例外 → failed permission-error;再按一次可以重來', async () => {
  let calls = 0;
  const { session } = setup({ requestPermission: async () => { calls += 1; if (calls === 1) throw new Error('no gesture'); return 'granted'; } });
  await session.start();
  let s = session.getState();
  assert.equal(s.phase, 'failed');
  assert.equal(s.failStatus, 'permission-error');
  assert.ok(s.message.includes(DENIED_HELP));
  await session.start();
  s = session.getState();
  assert.equal(s.phase, 'running');
  assert.equal(s.failStatus, null);
  session.destroy();
});

test('不安全連線、沒有 DeviceOrientationEvent → failed,訊息是「偵測不到方位感測器」', async () => {
  for (const [opts, code] of [[{ secure: false }, 'insecure-context'], [{ hasDOE: false }, 'unsupported']]) {
    const { session } = setup(opts);
    await session.start();
    const s = session.getState();
    assert.equal(s.phase, 'failed', code);
    assert.equal(s.failStatus, code);
    assert.equal(s.message, '偵測不到方位感測器');
  }
});

test('連續 10 筆「不是指北」的事件 → failed relative-not-north;少於 10 筆不判定', async () => {
  const { fake, session } = setup();
  await session.start();
  for (let i = 0; i < 9; i += 1) { fake.dispatch('deviceorientationabsolute', { alpha: 10, beta: 0, gamma: 0, absolute: false }); fake.advance(50); }
  assert.equal(session.getState().phase, 'running', '9 筆還不判定失敗');
  fake.dispatch('deviceorientationabsolute', { alpha: 10, beta: 0, gamma: 0, absolute: false });
  fake.advance(50);
  const s = session.getState();
  assert.equal(s.phase, 'failed');
  assert.equal(s.failStatus, 'relative-not-north');
  assert.equal(s.message, '這台裝置無法提供指北資料');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);

  const b = setup({}, { relativeFailAfter: 3 });
  await b.session.start();
  for (let i = 0; i < 3; i += 1) { b.fake.dispatch('deviceorientationabsolute', { alpha: 10, beta: 0, gamma: 0, absolute: false }); b.fake.advance(50); }
  assert.equal(b.session.getState().failStatus, 'relative-not-north');
});

test('事件沒有角度(no-sensor)→ waiting', async () => {
  const { fake, session } = setup();
  await session.start();
  fake.dispatch('deviceorientationabsolute', { alpha: null, beta: null, gamma: null, absolute: true });
  fake.advance(50);
  const s = session.getState();
  assert.equal(s.phase, 'waiting');
  assert.equal(s.failStatus, 'no-sensor');
  assert.equal(s.message, '偵測不到方位感測器');
  session.destroy();
});

test('傾斜 20 度 → gate 不允許(tilt);放平後允許', async () => {
  const { fake, session } = setup();
  await session.start();
  feed(fake, [215, 215, 215, 215, 215, 215], { beta: 20 });
  let s = session.getState();
  assert.equal(s.gate.allowed, false);
  assert.equal(s.gate.reason, 'tilt');
  assert.equal(await session.lock(), null);
  s = session.getState();
  assert.equal(s.noteKey, 'blocked');
  assert.equal(s.noteReason, 'tilt');
  assert.equal(s.note, '請將手機放平再讀數');
  feed(fake, new Array(8).fill(215));
  assert.equal(session.getState().gate.allowed, true);
  session.destroy();
});

test('3 秒穩定事件 → lock() 回 ok,σ < 3,平均與完成時間正確', async () => {
  const { fake, session, changes } = setup();
  await session.start();
  feed(fake, new Array(10).fill(215));
  const p = session.lock();
  assert.equal(session.getState().locking, true);
  assert.equal(session.getState().lockMs, 3000);
  assert.equal(session.getState().lockStartedAtMs, fake.clock);
  assert.equal(session.lock(), p, '鎖定中重複按回同一個 promise');
  feed(fake, new Array(62).fill(215));
  const r = await p;
  assert.ok(r);
  assert.equal(r.status, 'ok');
  assert.ok(r.sigma < 3);
  assert.ok(circ(r.meanDeg, 215) < 0.01);
  assert.ok(Number.isFinite(r.lockedAtMs));
  assert.equal(r.uncertaintyDeg, 5);
  const s = session.getState();
  assert.equal(s.locking, false);
  assert.equal(s.noteKey, null);
  assert.ok(changes.filter((c) => c.kind === 'lock').length >= 2);
  session.destroy();
});

test('±8 度抖動 → unstable(仍回平均與 σ)', async () => {
  const { fake, session } = setup();
  await session.start();
  feed(fake, new Array(10).fill(100));
  const p = session.lock();
  feed(fake, Array.from({ length: 62 }, (_, i) => 100 + (i % 2 ? 8 : -8)));
  const r = await p;
  assert.equal(r.status, 'unstable');
  assert.ok(r.sigma > 3);
  assert.ok(circ(r.meanDeg, 100) < 1);
  session.destroy();
});

test('鎖定時間太短樣本不足 → null,noteKey too-few', async () => {
  const { fake, session } = setup({}, { settings: { lockSeconds: 0.5, measureUncertainty: 5, northMode: 'true', theme: 'dark' } });
  await session.start();
  feed(fake, [50, 50]);
  const p = session.lock();
  feed(fake, new Array(12).fill(50));
  assert.equal(await p, null);
  const s = session.getState();
  assert.equal(s.noteKey, 'too-few');
  assert.equal(s.note, '樣本不足,請再等一下');
  assert.equal(s.lockMs, 500);
  session.destroy();
});

test('未 start 就 lock → null 且 noteKey blocked(not-running);startLabel 可換', async () => {
  const a = setup();
  assert.equal(await a.session.lock(), null);
  let s = a.session.getState();
  assert.equal(s.noteKey, 'blocked');
  assert.equal(s.noteReason, 'not-running');
  assert.equal(s.note, '請先按「使用手機指北針」。');
  const b = setup({}, { startLabel: '開始量' });
  await b.session.lock();
  assert.equal(b.session.getState().note, '請先按「開始量」。');
});

test('鎖定中停止 → null,noteKey cancelled', async () => {
  const { fake, session } = setup();
  await session.start();
  feed(fake, new Array(5).fill(30));
  const p = session.lock();
  feed(fake, new Array(10).fill(30));
  session.stop();
  assert.equal(await p, null);
  assert.equal(session.getState().noteKey, 'cancelled');
  assert.equal(session.getState().phase, 'idle');
});

test('stop() 後監聽數與計時器歸零;可以再 start', async () => {
  const { fake, session } = setup();
  await session.start();
  feed(fake, [10, 10, 10]);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  session.stop();
  const s = session.getState();
  assert.equal(s.phase, 'idle');
  assert.equal(s.reading, null);
  assert.equal(s.headingRaw, null);
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.docListenerCount('visibilitychange'), 0);
  assert.equal(fake.pendingTimers(), 0);
  await session.start();
  assert.equal(session.getState().phase, 'running');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 1);
  session.destroy();
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
});

test('destroy() 後推進時鐘不再觸發 onChange;可重複呼叫', async () => {
  const { fake, session, changes } = setup();
  await session.start();
  feed(fake, [10, 10]);
  session.destroy();
  const n = changes.length;
  fake.dispatch('deviceorientationabsolute', flat(20));
  fake.advance(3000);
  assert.equal(changes.length, n);
  session.destroy();
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
  assert.equal(fake.pendingTimers(), 0);
  const res = await session.start();
  assert.equal(res.ok, false, 'destroy 之後不再啟動');
  assert.equal(fake.listenerCount('deviceorientationabsolute'), 0);
});

test('getState() 是凍結的快照', async () => {
  const { fake, session } = setup();
  await session.start();
  feed(fake, [10, 10]);
  const s = session.getState();
  assert.ok(Object.isFrozen(s));
  assert.ok(Object.isFrozen(s.gate));
  assert.ok(Object.isFrozen(s.reading));
  assert.throws(() => { 'use strict'; s.phase = 'x'; });
  session.destroy();
});

test('iOS 樣式事件:webkitCompassHeading 與精度', async () => {
  const { fake, session } = setup({ hasAbsoluteEvent: false });
  await session.start();
  for (let i = 0; i < 6; i += 1) {
    fake.dispatch('deviceorientation', { alpha: 0, beta: 0, gamma: 0, webkitCompassHeading: 215, webkitCompassAccuracy: 8 });
    fake.advance(50);
  }
  let s = session.getState();
  assert.equal(s.phase, 'running');
  assert.ok(circ(s.headingRaw, 215) < 0.01);
  assert.equal(s.reading.accuracyDeg, 8);
  fake.dispatch('deviceorientation', { alpha: 0, beta: 0, gamma: 0, webkitCompassHeading: 215, webkitCompassAccuracy: -1 });
  fake.advance(50);
  s = session.getState();
  assert.equal(s.gate.allowed, false);
  assert.equal(s.gate.reason, 'uncalibrated');
  assert.equal(s.message, sensorMessage('uncalibrated'));
  session.destroy();
});

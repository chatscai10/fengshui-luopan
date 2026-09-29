// 磁北/真北換算:羅盤與住宅頁共用同一套,兩邊顯示與輸入的度數要一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisOf, displayedFromRaw, rawFromDisplayed, roundTenth } from '../../src/ui/basis.js';
import { createStore } from '../../src/ui/store.js';
import * as compass from '../../src/ui/views/compass.js';

const memStore = () => {
  const m = new Map();
  return createStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) });
};

test('basisOf:磁北時不換算;真北要有磁偏角才算數', () => {
  const st = memStore();
  assert.equal(basisOf(st.get()).trueMode, false);
  st.update((d) => { d.settings.northMode = 'true'; });
  const b = basisOf(st.get());
  assert.equal(b.trueMode, true);
  assert.ok(b.declination < 0 && b.declination > -6);
  // 羅盤畫面匯出的是同一組函式
  assert.equal(compass.basisOf, basisOf);
  assert.equal(compass.displayedFromRaw, displayedFromRaw);
  assert.equal(compass.rawFromDisplayed, rawFromDisplayed);
});

test('真北下「顯示 ↔ 存的磁讀數」來回不漂移(住宅頁輸入框的做法)', () => {
  const basis = { trueMode: true, declination: -5.0575 };
  for (let raw = 0; raw < 360; raw += 0.1) {
    const r = roundTenth(raw);
    const shown = roundTenth(displayedFromRaw(r, basis));
    const back = roundTenth(rawFromDisplayed(shown, basis));
    assert.equal(back, r, `raw=${r} shown=${shown} back=${back}`);
  }
});

test('磁北下不換算', () => {
  const basis = { trueMode: false, declination: -5.0575 };
  assert.equal(roundTenth(displayedFromRaw(175.1, basis)), 175.1);
  assert.equal(roundTenth(rawFromDisplayed(175.1, basis)), 175.1);
});

test('roundTenth:進位到 360 折回 0', () => {
  assert.equal(roundTenth(359.96), 0);
  assert.equal(roundTenth(359.94), 359.9);
  assert.equal(roundTenth(-0.04), 0);
  assert.equal(roundTenth(720.25), 0.3);
});

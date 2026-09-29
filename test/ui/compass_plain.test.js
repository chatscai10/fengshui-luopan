// 專業羅盤頁白話化(docs/EASY_SPEC.md 5.8、第 10 節):白話讀數、穩定度文字、共用感測器文字、鎖定後的影響句。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReadoutModel, sensorMessage, lockBlockedMessage, SENSOR_FALLBACK_HINT, QUALITY_TEXT,
  PLAIN_TEXT, plainReadoutText, lockImpactShort, lockNoteText, NEAR_FINE_ONLY, UNSAVED_LOCK_HINT,
} from '../../src/ui/views/compass.js';
import * as sensorText from '../../src/ui/sensorText.js';
import { plainDirection } from '../../src/ui/easy/direction.js';
import { IMPACT_SHORT } from '../../src/core/copy.js';

const COMPASS_SRC = readFileSync(new URL('../../src/ui/views/compass.js', import.meta.url), 'utf8');

test('buildReadoutModel: 新增 plainHeading / plainFacing,既有欄位不變', () => {
  const m = buildReadoutModel({ heading: 215 });
  assert.equal(m.plainHeading.dir8, '西南');
  assert.equal(m.plainHeading.text, '西南方(稍微偏南)');
  assert.deepEqual(m.plainFacing, plainDirection(215));
  // 既有欄位照舊
  assert.equal(m.mountain, '未');
  assert.equal(m.primary, '向');
  assert.equal(m.facingBearing, 215);
});

test('buildReadoutModel: 量坐、heading 35 → 背後東北、房子朝向西南', () => {
  const m = buildReadoutModel({ heading: 35, measure: 'sit' });
  assert.equal(m.plainHeading.dir8, '東北');
  assert.equal(m.plainFacing.dir8, '西南');
  assert.deepEqual(m.plainFacing, plainDirection(215));
});

test('plainReadoutText: 跟隨中、紅線、量坐三種說法逐字', () => {
  const m = buildReadoutModel({ heading: 215 });
  assert.equal(plainReadoutText(m, { following: true }), '手機頂端正對著:西南方(稍微偏南)');
  assert.equal(plainReadoutText(m, { following: false }), '上方「向」那一端指著:西南方(稍微偏南)');
  assert.equal(plainReadoutText(m), '上方「向」那一端指著:西南方(稍微偏南)');
  const sit = buildReadoutModel({ heading: 35, measure: 'sit' });
  assert.equal(plainReadoutText(sit, { following: false }), '上方「坐」那一端指著:東北方(稍微偏北)(背後)· 房子朝向:西南方(稍微偏南)');
  // 量坐時不論是否跟隨,都講出背後與房子朝向
  assert.equal(plainReadoutText(sit, { following: true }), plainReadoutText(sit, { following: false }));
  assert.equal(plainReadoutText(buildReadoutModel({ heading: 0 }), { following: true }), '手機頂端正對著:北方');
  assert.equal(plainReadoutText(null), '');
  assert.deepEqual(PLAIN_TEXT, {
    following: '手機頂端正對著:{text}',
    pointer: '上方「向」那一端指著:{text}',
    sit: '上方「坐」那一端指著:{sitText}(背後)· 房子朝向:{text}',
  });
});

test('白話行不含「正」字方位(手機做不到那種精度)', () => {
  for (let b = 0; b < 360; b += 0.5) {
    const t = plainReadoutText(buildReadoutModel({ heading: b }), { following: false });
    assert.doesNotMatch(t.replace('正對著', ''), /正/, `${b}: ${t}`);
  }
});

test('感測器文字與 sensorText.js 是同一個匯出', () => {
  assert.equal(sensorMessage, sensorText.sensorMessage);
  assert.equal(lockBlockedMessage, sensorText.lockBlockedMessage);
  assert.equal(SENSOR_FALLBACK_HINT, sensorText.SENSOR_FALLBACK_HINT);
  assert.equal(lockBlockedMessage('not-running'), '請先按「使用手機指北針」。');
});

test('QUALITY_TEXT 等於 STABILITY_LABEL(依原因,不只依燈號)', () => {
  assert.equal(QUALITY_TEXT, sensorText.STABILITY_LABEL);
  assert.equal(QUALITY_TEXT.steady, '手拿得很穩');
  assert.equal(QUALITY_TEXT['ios-wide'], '誤差有點大');
  assert.equal(QUALITY_TEXT.jitter, '手有點晃');
});

test('buildReadoutModel:near8 = 同一個門檻下 8 大方位也接近分界(徽章據此區分細格與大方位)', () => {
  // 186 度:離 24 格分界(187.5)1.5 度 < 門檻 2;離 8 方位分界(202.5)16.5 度
  const fine = buildReadoutModel({ heading: 186 });
  assert.equal(fine.near, true);
  assert.equal(fine.near8, false);
  const both = buildReadoutModel({ heading: 201.9 });
  assert.equal(both.near8, true);
  assert.equal(NEAR_FINE_ONLY, '24 格接近分界(8 個大方位不受影響)');
});

test('lockNoteText:一句講度數,手晃 ≥ 1 度才提,24 格與 8 方位用同一個 U、不重複講「接近分界」', () => {
  assert.equal(lockNoteText({ status: 'ok', displayedDeg: 23, sigmaDeg: 0.02, uncertaintyDeg: 5 }), '已記下約 23 度。對 8 個大方位:接近分界,可能影響。');
  assert.equal(lockNoteText({ status: 'ok', displayedDeg: 180, sigmaDeg: 1.3, uncertaintyDeg: 5 }), '已記下約 180 度。手有一點晃。對 8 個大方位:不影響。');
  // 186:離 24 格分界 1.5 度,但離 8 方位分界 16.5 度 → 講清楚只影響細格
  assert.equal(lockNoteText({ status: 'ok', displayedDeg: 186, sigmaDeg: 0.5, uncertaintyDeg: 5 }), '已記下約 186 度。離 24 格的分界很近,只影響細格。對 8 個大方位:不影響。');
  // iPhone 估計誤差 20 度已經在 uncertaintyDeg 裡:150 度要算接近分界
  assert.match(lockNoteText({ status: 'ok', displayedDeg: 150, sigmaDeg: 1, uncertaintyDeg: 20 }), /接近分界,可能影響/);
  assert.equal(lockNoteText({ status: 'unstable', displayedDeg: 90, sigmaDeg: 3.5, uncertaintyDeg: 7, unstableText: '讀數不穩' }), '讀數不穩。目前的平均約 90 度,建議換個位置重測。對 8 個大方位:不影響。');
  assert.equal(lockNoteText({ status: 'ok', displayedDeg: NaN }), '');
  assert.equal(UNSAVED_LOCK_HINT, '還沒存。按下面的「{btn}」才會存起來。');
  assert.ok(!COMPASS_SRC.includes('回到指北針'), '「回到指北針」改成「重新跟著手機轉」');
  assert.ok(COMPASS_SRC.includes('重新跟著手機轉'));
});

test('lockImpactShort: 依鎖定平均與誤差判斷 8 大方位', () => {
  assert.equal(lockImpactShort({ displayedDeg: 180, sigmaDeg: 1, measureUncertainty: 5 }), IMPACT_SHORT.ok);
  assert.equal(lockImpactShort({ displayedDeg: 200, sigmaDeg: 1, measureUncertainty: 5 }), IMPACT_SHORT.near); // 離 202.5 只有 2.5 度
  assert.equal(lockImpactShort({ displayedDeg: 190, sigmaDeg: 4, measureUncertainty: 5 }), IMPACT_SHORT.ok); // U = 8,離分界 12.5
  assert.equal(lockImpactShort({ displayedDeg: 196, sigmaDeg: 4, measureUncertainty: 5 }), IMPACT_SHORT.near); // U = 8,離分界 6.5
  assert.equal(lockImpactShort({ displayedDeg: 20, sigmaDeg: 0.2, measureUncertainty: 1 }), IMPACT_SHORT.near); // 門檻至少 3 度
  assert.equal(lockImpactShort({ displayedDeg: 30, sigmaDeg: null, measureUncertainty: null }), IMPACT_SHORT.ok); // 預設誤差 5
  assert.equal(lockImpactShort({ displayedDeg: 200, sigmaDeg: 1, measureUncertainty: 'x' }), IMPACT_SHORT.near); // 壞設定退回預設
  assert.equal(lockImpactShort({ displayedDeg: 150, sigmaDeg: 1, measureUncertainty: 5, uncertaintyDeg: 20 }), IMPACT_SHORT.near, '鎖定結果的 U(含 iPhone 估計誤差)優先');
  assert.equal(lockImpactShort({ displayedDeg: null }), '');
  assert.equal(lockImpactShort({ displayedDeg: NaN }), '');
});

test('compass.js 原始碼:共用文字不再各寫一份、idle 提示逐字', () => {
  const code = COMPASS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /function\s+(sensorMessage|lockBlockedMessage)\b/);
  assert.doesNotMatch(code, /網站資料 移除本網站/, '權限說明要用 DENIED_HELP');
  assert.doesNotMatch(code, /訊號良好|訊號普通|訊號不穩/);
  assert.ok(code.includes('手機放平、頂端朝向前方,按下按鈕後盤面會跟著手機轉。紅線對到的就是手機頂端指的方向。'));
  assert.ok(code.includes('手機指北針準嗎?'));
  assert.ok(code.includes("from '../sensorText.js'"));
  assert.doesNotMatch(COMPASS_SRC, /[A-Za-z]:\\/, '不可有本機路徑');
});

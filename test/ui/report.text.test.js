import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportModel, buildPlainReport, buildBazhaiBlock, buildSettingsSummary, buildKeyPoints, findScoreLeaks,
  collectReportTexts, wrapLines, paintReportImage, SOURCE_NOTES,
} from '../../src/ui/views/report.js';
import { sanitizePage } from '../../src/ui/views/wealth.js';
import { scenario, CASES } from './report.helpers.js';

const build = (name, bearing) => {
  const s = scenario(name, bearing);
  return { ...s, model: buildReportModel(s.state, s.report, s.page) };
};

test('報告模型:總覽三個重點、分區、附錄與四段免責', () => {
  const { model } = build('full');
  assert.equal(model.status, 'ok');
  assert.equal(model.overview.points.length, 3);
  assert.deepEqual(model.overview.points.map((p) => p.label), ['坐向', '財位', '今年留意']);
  assert.equal(model.overview.points[0].value, '丑山未向');
  assert.match(model.overview.points[1].value, /客廳的右上角/);
  assert.equal(model.overview.points[1].sub, '較適合');
  assert.match(model.overview.points[2].value, /五黃在南方/);
  assert.ok(model.overview.paragraphs.length >= 4);
  assert.deepEqual(model.sections.map((s) => s.id), ['orientation', 'bazhai', 'wealth', 'xuankong', 'annual', 'rooms', 'placement', 'traditional']);
  assert.equal(model.appendix.disclaimers.length, 4);
  assert.equal(model.appendix.sources.length, SOURCE_NOTES.length);
});

test('各房間建議獨立成區,玄空區不含房間卡;星盤圖掛在玄空與流年區', () => {
  const { model } = build('full');
  const by = Object.fromEntries(model.sections.map((s) => [s.id, s]));
  assert.ok(by.rooms.cards.length >= 4);
  assert.ok(by.rooms.cards.every((c) => c.id.startsWith('xk.room.')));
  assert.ok(by.xuankong.cards.every((c) => !c.id.startsWith('xk.room.')));
  assert.equal(by.xuankong.grid.kind, 'chart');
  assert.equal(by.annual.grid.kind, 'annual');
  assert.ok(by.rooms.cards.every((c) => c.badges.includes('推論')), '推論的照標');
});

test('沒有建成年:玄空區提示要填年份,沒有星盤', () => {
  const { model } = build('noYear');
  const xk = model.sections.find((s) => s.id === 'xuankong');
  assert.equal(xk.grid, null);
  assert.equal(xk.needYear, true);
  const text = buildPlainReport(model);
  assert.ok(!text.includes('玄空盤: '));
});

test('八宅區塊:宅卦八方位、每位住戶的大門/床頭/書桌/灶口', () => {
  const { report } = scenario('twoResidents');
  const b = buildBazhaiBlock(report);
  assert.equal(b.house.name, '艮宅');
  assert.equal(b.house.group, '西四宅');
  assert.match(b.house.basis, /大門朝向/);
  assert.equal(b.house.rows.length, 8);
  assert.equal(b.house.rows.find((r) => r.star === '生氣').dir, '西南');
  assert.ok(b.house.rows.find((r) => r.star === '生氣').good);
  assert.ok(!b.house.rows.find((r) => r.star === '絕命').good);
  assert.equal(b.residents.length, 2);
  const p1 = b.residents[0];
  assert.equal(p1.name, '本人');
  assert.equal(p1.gua, '坎命');
  assert.equal(p1.group, '東四命');
  assert.equal(p1.matches, false);
  const door = p1.uses.find((u) => u.label === '大門的位置');
  assert.match(door.good, /東南方\(生氣位\)/);
  assert.match(door.bad, /西南方\(絕命位\)/);
  assert.deepEqual(p1.uses.map((u) => u.label), ['大門的位置', '主臥室的位置', '床頭朝向', '書桌面向', '灶口朝向']);
  // 沒有住戶:只有宅卦
  const none = buildBazhaiBlock(scenario('noResidents').report);
  assert.equal(none.residents.length, 0);
  assert.equal(buildBazhaiBlock(null), null);
});

test('附錄設定摘要:預設值白話呈現,不同的進階選項只報數量', () => {
  const { report } = scenario('full');
  const s = buildSettingsSummary(report);
  assert.ok(s.rows.length >= 8);
  assert.equal(s.rows.find((r) => r.label === '羅盤讀數的北').value, '磁北(和實體羅盤一致)');
  assert.equal(s.rows.find((r) => r.label === '財位排序方式').value, '通俗明財位(進門對角為主)');
  assert.equal(s.others, 0);
  const changed = JSON.parse(JSON.stringify(report));
  changed.meta.ruleset.qiScheme = 'S1';
  changed.meta.ruleset.showLianshu = true;
  changed.meta.ruleset.wealthProfile = 'xuankong';
  const s2 = buildSettingsSummary(changed);
  assert.equal(s2.others, 2);
  assert.equal(s2.rows.find((r) => r.label === '財位排序方式').value, '玄空進階(星盤為主)');
  assert.deepEqual(buildSettingsSummary({}).rows, []);
});

test('純文字報告:含總覽、星盤文字、八宅、設定、資料來源與四段免責', () => {
  const { model } = build('twoResidents');
  const t = buildPlainReport(model);
  assert.match(t, /^風水報告\n分析時間:2026-09-29 12:00\(台灣時間\)/);
  assert.match(t, /【總覽】/);
  assert.match(t, /【1\. 你家的方位】/);
  assert.match(t, /■ 你家坐向: 丑山未向/);
  assert.match(t, /玄空盤: 雙星會向\(第 9 運起盤;上方是南方\)/);
  assert.match(t, /巽\(東南\).*離\(南\).*坤\(西南\)/);
  assert.match(t, /圖上的方位是羅盤方位/);
  assert.match(t, /流年/);
  assert.match(t, /■ 艮宅\(西四宅\)/);
  assert.match(t, /大門的位置:適合 東南方\(生氣位\)/);
  assert.match(t, /【附錄:採用的設定】/);
  assert.match(t, /【資料來源】/);
  for (const d of model.appendix.disclaimers) assert.ok(t.includes(d), '免責聲明一字不少');
  assert.match(t, /1\. 風水是華人的傳統民俗文化/);
  // 每張卡片的標題都在
  for (const s of model.sections) for (const c of s.cards) assert.ok(t.includes(c.headline), c.headline);
  assert.equal(buildPlainReport({ status: 'error' }), '');
  assert.equal(buildPlainReport(null), '');
});

test('內部代碼不出現在報告文字裡(卡片 id、住戶 id、開口 id、欄位路徑)', () => {
  for (const name of ['full', 'twoResidents', 'windowCorner']) {
    const { model } = build(name);
    const t = buildPlainReport(model);
    for (const bad of ['card.', 'wealth.ming', 'xk.pair', 'p1', 'p2', 'd1', 'w1', 'living:', 'bed:', 'undefined', 'NaN', '[object', 'null']) {
      assert.ok(!t.includes(bad), `${name}: 出現 ${bad}`);
    }
  }
});

test('分數不外洩:報告模型與純文字報告(所有情境與朝向)', () => {
  const bad = [];
  for (const name of Object.keys(CASES)) {
    for (const b of [0, 60, 210, 305]) {
      const { model } = build(name, b);
      assert.equal(model.status, 'ok');
      bad.push(...findScoreLeaks(collectReportTexts(model.overview)).map((x) => `${name}@${b} 總覽: ${x}`));
      bad.push(...findScoreLeaks(collectReportTexts(model.sections.map((s) => [s.cards, s.bazhai, s.grid && s.grid.note]))).map((x) => `${name}@${b}: ${x}`));
      bad.push(...findScoreLeaks(buildPlainReport(model)).map((x) => `${name}@${b} 全文: ${x}`));
      assert.ok(!JSON.stringify(model).includes('"score"'));
    }
  }
  assert.deepEqual(bad, []);
});

test('findScoreLeaks 抓得到真的分數格式,不誤傷正常數字', () => {
  assert.equal(findScoreLeaks('這裡 66.88 分').length, 1);
  assert.equal(findScoreLeaks('得分很高').length, 1);
  assert.equal(findScoreLeaks('score: 12').length, 1);
  assert.equal(findScoreLeaks('約 66/100').length, 1);
  assert.equal(findScoreLeaks('佔 35% 面積').length, 1);
  assert.equal(findScoreLeaks(['向約在 210 度,第 9 運,每份 15 度', '分金與分別與分組、十分穩定']).length, 0);
  assert.equal(findScoreLeaks(null).length, 0);
});

test('報告用的總覽重點:沒有財位結果時說明要補什麼', () => {
  const s = scenario('minimal');
  const page = sanitizePage(s.page);
  const pts = buildKeyPoints(s.report, page);
  assert.equal(pts.length, 3);
  assert.ok(pts[1].value.length > 0);
});

test('壞資料不丟例外', () => {
  const s = scenario('full');
  assert.equal(buildReportModel(s.state, { error: 'NO_FACING' }, null).status, 'no-facing');
  assert.equal(buildReportModel(s.state, { error: 'boom' }, null).status, 'error');
  assert.equal(buildReportModel(s.state, s.report, null).status, 'error');
});

// ── 存成圖片的版面 ──

test('wrapLines: 依寬度逐字換行,英數不拆開,空行保留', () => {
  const measure = (s) => [...s].length * 10; // 每字 10px
  assert.deepEqual(wrapLines(measure, '一二三四五六七八九十', 50), ['一二三四五', '六七八九十']);
  assert.deepEqual(wrapLines(measure, '甲乙\n\n丙', 100), ['甲乙', '', '丙']);
  const lines = wrapLines(measure, '版本 abcdef 結束', 80);
  assert.ok(lines.every((l) => measure(l) <= 80 || /^[A-Za-z]+$/.test(l)));
  assert.ok(lines.some((l) => l.includes('abcdef')), '英數連續字元不被拆開');
  assert.deepEqual(wrapLines(measure, '', 100), ['']);
});

test('paintReportImage: 用假畫布跑完整流程,回傳合理高度且每個文字都在畫布內', () => {
  const { model } = build('full');
  const calls = [];
  const ctx = {
    canvas: { height: 4000 },
    save() {}, restore() {},
    fillRect() {}, strokeRect() {},
    fillText(t, x, y) { calls.push({ t, x, y }); },
    measureText(s) { return { width: [...String(s)].length * 14 }; },
    set font(v) { this._f = v; }, get font() { return this._f; },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set textAlign(v) {}, set textBaseline(v) {},
  };
  const pal = { bg: '#000', surface: '#111', line: '#333', text: '#fff', dim: '#ccc', faint: '#999', gold: '#ea0', wang: '#ea0', tui: '#888', sha: '#c75', wangBg: '#221', fontKai: 'serif', fontUi: 'sans-serif' };
  const h = paintReportImage(ctx, 1080, model, pal);
  assert.ok(h > 1500 && h < 8000, `高度 ${h}`);
  assert.ok(calls.length > 40);
  assert.ok(calls.every((c) => c.x >= 0 && c.x <= 1080 && c.y >= 0 && c.y <= h));
  const all = calls.map((c) => c.t).join('');
  assert.ok(all.includes('風水報告'));
  assert.ok(all.includes('丑山未向'));
  assert.ok(all.includes('傳統民俗參考'));
});

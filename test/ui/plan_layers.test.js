// 圖層、方位面板資料、底部摘要與繪圖用純函式的測試(用真實引擎輸出,不手寫假資料)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../../src/core/copy.js';
import { createStore } from '../../src/ui/store.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import {
  LAYERS, LAYER_IDS, normalizeLayer, layerCells, wealthMarkers, sectorDetails, sectorTag, sectorName, dirOfGua, STAR_NAME,
} from '../../src/ui/plan/layers.js';
import { describeTaiji, describeSpans, summarizePlan } from '../../src/ui/plan/summary.js';
import { roomNameMap } from '../../src/ui/plan/labels.js';
import { alphaColor, rayExit, sectorIndexAt, boundsFor, viewFor } from '../../src/ui/canvas/planRenderer.js';
import { GUA } from '../../src/core/geo.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

function makeReport({ template = 'two', year = 2010, residents = true, bearing = 210 } = {}) {
  const store = createStore(memStorage());
  store.update((d) => {
    d.facing.bearing = bearing;
    d.building.builtYear = year;
    if (residents) d.residents = [{ id: 'p1', name: '小明', gender: 'M', birth: '1990-05-15 10:30', utcOffsetMinutes: 480 }];
    d.plan = buildTemplate(template).plan;
  });
  return { store, report: store.report(), plan: store.get().plan };
}

test('圖層清單:財位/八宅/玄空/流年/無,id 與 store.ui.layer 對得上', () => {
  assert.deepEqual(LAYERS.map((l) => l.label), ['財位', '八宅', '玄空', '流年', '無']);
  assert.deepEqual(LAYER_IDS, ['wealth', 'bazhai', 'xuankong', 'annual', 'none']);
  assert.equal(normalizeLayer('wealth'), 'wealth');
  for (const bad of ['xx', undefined, null, 5, {}]) assert.equal(normalizeLayer(bad), 'wealth');
});

test('方位名稱:卦名·方位', () => {
  assert.equal(sectorTag('震'), '震·東');
  assert.equal(sectorTag('艮'), '艮·東北');
  assert.equal(sectorName('離'), '離宮(南方)');
  assert.equal(dirOfGua('乾'), '西北');
  assert.equal(dirOfGua('?'), '');
});

test('八宅圖層:八個宮都有星名,吉位 good、其餘 warn,與報告一致', () => {
  const { report } = makeReport();
  const lc = layerCells(report, 'bazhai');
  assert.ok(lc.ok);
  const good = ['生氣', '延年', '天醫', '伏位'];
  let goodCount = 0;
  for (const g of GUA) {
    const c = lc.cells[g];
    assert.ok(c.label, `${g} 應有星名`);
    assert.equal(c.tone, good.includes(c.label) ? 'good' : 'warn');
    if (c.tone === 'good') goodCount += 1;
  }
  assert.equal(goodCount, 4);
  // 與引擎報告逐宮對照:宅卦 艮宅,坐東北,生氣在西南(坤)
  assert.equal(lc.cells['坤'].label, '生氣');
});

test('玄空圖層:山星向星標籤;沒有建成年份時說明原因,不丟錯', () => {
  const { report } = makeReport({ year: 2010 });
  const lc = layerCells(report, 'xuankong');
  assert.ok(lc.ok);
  for (const g of GUA) assert.match(lc.cells[g].label, /^山\d 向\d$/);
  const p = report.xuankong.chart.palaces['坤'];
  assert.equal(lc.cells['坤'].label, `山${p.shan} 向${p.xiang}`);
  assert.ok(Object.values(lc.cells).some((c) => c.tone === 'good') || Object.values(lc.cells).some((c) => c.tone === 'warn'));

  const noYear = makeReport({ year: null }).report;
  assert.equal(noYear.error, undefined);
  const none = layerCells(noYear, 'xuankong');
  assert.equal(none.ok, false);
  assert.match(none.note, /建成年份/);
  assert.equal(Object.keys(none.cells).length, 8);
});

test('流年圖層:五黃與二黑標 warn,星名正確', () => {
  const { report } = makeReport();
  const lc = layerCells(report, 'annual');
  assert.ok(lc.ok);
  for (const g of GUA) {
    const n = report.annual.annual.chartByGua[g];
    assert.equal(lc.cells[g].label, STAR_NAME[n]);
    if (n === 5 || n === 2) assert.equal(lc.cells[g].tone, 'warn');
  }
  assert.ok(Object.values(lc.cells).some((c) => c.tone === 'good'), '八白等財星應有 good');
});

test('財位圖層:較強 3 個、較弱 2 個、其餘一般;只是相對比較', () => {
  const { report } = makeReport();
  const lc = layerCells(report, 'wealth');
  assert.ok(lc.ok);
  const count = (label) => GUA.filter((g) => lc.cells[g].label === label).length;
  assert.equal(count('較強'), 3);
  assert.equal(count('較弱'), 2);
  assert.equal(count('一般'), 3);
  // 較強的宮能量不低於較弱的宮
  const e = (g) => report.wealth.sectors[g].energy;
  const strong = GUA.filter((g) => lc.cells[g].label === '較強').map(e);
  const weak = GUA.filter((g) => lc.cells[g].label === '較弱').map(e);
  assert.ok(Math.min(...strong) >= Math.max(...weak));
});

test('「無」圖層與壞報告:回中性空白,不丟錯', () => {
  const { report } = makeReport();
  const none = layerCells(report, 'none');
  assert.ok(none.ok);
  for (const g of GUA) assert.equal(none.cells[g].label, '');
  for (const bad of [null, undefined, {}, { error: 'NO_FACING' }, 'x', 3]) {
    const r = layerCells(bad, 'wealth');
    assert.equal(r.ok, false);
    assert.equal(Object.keys(r.cells).length, 8);
  }
  assert.equal(layerCells(report, 'garbage').ok, true, '未知圖層當作財位');
});

test('財位標記:來自引擎候選點,明財位一定在,座標在平面圖內', () => {
  const { report, plan } = makeReport();
  const ms = wealthMarkers(report);
  assert.ok(ms.length >= 1);
  assert.ok(ms.some((m) => m.isMing));
  for (const m of ms) {
    assert.ok(Array.isArray(m.point) && m.point.every(Number.isFinite));
    const xs = plan.outline.map((p) => p[0]);
    const ys = plan.outline.map((p) => p[1]);
    assert.ok(m.point[0] >= Math.min(...xs) - 1e-9 && m.point[0] <= Math.max(...xs) + 1e-9);
    assert.ok(m.point[1] >= Math.min(...ys) - 1e-9 && m.point[1] <= Math.max(...ys) + 1e-9);
  }
  assert.deepEqual(wealthMarkers(null), []);
  assert.deepEqual(wealthMarkers({ error: 'x' }), []);
});

test('方位解讀面板:房間佔比、各種看法、來自 renderReport 的卡片', () => {
  const { report, plan } = makeReport();
  const rendered = renderReport(report);
  const names = roomNameMap(plan);
  const det = sectorDetails(report, rendered, '坤', { palaces: report.planShares.palaces, roomNames: names, layerId: 'wealth' });
  assert.equal(det.title, '坤宮(西南方)');
  assert.ok(det.rooms.length >= 1);
  for (const r of det.rooms) {
    assert.ok(r.name && !/^[a-z0-9]+$/i.test(r.name), '房間名稱不可是內部 id');
    assert.ok(r.pct > 0 && r.pct <= 1.000001);
  }
  const labels = det.lines.map((l) => l.label);
  assert.ok(labels.some((l) => l.startsWith('八宅')));
  assert.ok(labels.includes('玄空'));
  assert.ok(labels.includes('流年'));
  assert.ok(labels.includes('財位'));
  assert.ok(labels.includes('小明的命卦'), '有住戶時要列出命卦');
  // 卡片:標題都以「坤宮(」開頭,或是這個方位的候選財位卡
  assert.ok(det.cards.length >= 1);
  for (const c of det.cards) {
    assert.ok(c.card.headline && c.card.body);
    assert.ok(c.card.headline.startsWith('坤宮(') || c.layer === 'wealth');
  }
  // 顯示文字不含內部代碼(卡片 id、pinyin 代碼)
  const all = JSON.stringify(det.lines) + JSON.stringify(det.cards.map((c) => [c.card.headline, c.card.body]));
  assert.ok(!/xk\.|card\.|wealth\.|kun|zhen/.test(all));
});

test('方位解讀面板:壞輸入不丟錯', () => {
  const { report } = makeReport();
  assert.equal(sectorDetails(report, null, '不存在').lines.length, 0);
  assert.equal(sectorDetails(null, null, '坤').lines.length, 0);
  assert.equal(sectorDetails({ error: 'NO_FACING' }, null, '坤').cards.length, 0);
  const d = sectorDetails(report, null, '震');
  assert.ok(d.lines.length > 0 && d.cards.length === 0);
});

test('太極點描述:中央、偏向哪一側、在外框之外', () => {
  const plan = buildTemplate('custom', { width: 6, depth: 8 }).plan;
  assert.deepEqual(describeTaiji(plan, [3, 4], 210), { text: '太極點在中央', outside: false, atCenter: true });
  const off = describeTaiji(plan, [5, 4], 0); // 圖面上方 = 北,往右 = 東
  assert.equal(off.text, '太極點偏東側');
  const off2 = describeTaiji(plan, [3, 7.5], 90); // 上方 = 東 → 往上 = 東
  assert.equal(off2.text, '太極點偏東側');
  const noUp = describeTaiji(plan, [5.5, 4], null);
  assert.equal(noUp.text, '太極點偏右側');
  const out = describeTaiji(plan, [20, 20], 0);
  assert.equal(out.outside, true);
  assert.match(out.text, /外框之外/);
  assert.equal(describeTaiji(null, [1, 1], 0).text, '');
  assert.equal(describeTaiji(plan, null, 0).text, '');
  assert.equal(describeTaiji(plan, [NaN, 1], 0).text, '');
});

test('底部摘要:太極點位置 + 跨方位的房間;單一方位與沒有方位時的說法', () => {
  const { report, plan, store } = makeReport({ template: 'two' });
  const enginePlan = store.input().plan;
  const names = roomNameMap(plan);
  const s = summarizePlan({ plan: enginePlan, taiji: report.planShares.taiji, planUp: enginePlan.planUpBearing, palaces: report.planShares.palaces, roomNames: names });
  assert.ok(s.text.startsWith('太極點'));
  assert.match(s.text, /橫跨/);
  assert.match(s.text, /個方位/);
  assert.equal(s.warn, false);
  // 不含內部 id
  assert.ok(!/bed1|bed2|living/.test(s.text));
  // 沒有 palaces(尚未量朝向)→ 只講太極點
  const noSec = summarizePlan({ plan: enginePlan, taiji: report.planShares.taiji, planUp: null, palaces: null, roomNames: names });
  assert.ok(noSec.text.startsWith('太極點') && !/橫跨/.test(noSec.text));
  // 太極點在外框外 → warn
  const out = summarizePlan({ plan: enginePlan, taiji: [99, 99], planUp: 0, palaces: null, roomNames: names });
  assert.equal(out.warn, true);
});

test('describeSpans:太小的擦邊不算橫跨;走道、樓梯、陽台不寫進句子', () => {
  const palaces = {
    坎: [{ roomId: 'a', area: 9.5 }, { roomId: 'b', area: 0.2 }],
    艮: [{ roomId: 'a', area: 0.5 }],
    離: [{ roomId: 'c', area: 3 }],
    坤: [{ roomId: 'c', area: 3 }, { roomId: 'a', area: 0.1 }],
    震: [], 巽: [], 兌: [], 乾: [],
  };
  const rooms = [{ id: 'a', type: 'living' }, { id: 'b', type: 'bedroom' }, { id: 'c', type: 'entry' }];
  const names = new Map([['a', '客廳'], ['b', '臥室'], ['c', '走道']]);
  // a:坎 9.5、艮 0.5、坤 0.1 → 總 10.1;艮 4.9% < 10%、坤 1% → 只剩 1 個方位,不橫跨
  assert.equal(describeSpans(palaces, rooms, names), '');
  palaces.艮 = [{ roomId: 'a', area: 3 }];
  assert.match(describeSpans(palaces, rooms, names), /^客廳橫跨 坎\(北\)、艮\(東北\) 兩個方位$/);
  assert.equal(describeSpans(null, rooms, names), '');
  // 走道不寫
  assert.ok(!/走道/.test(describeSpans(palaces, rooms, names)));
});

test('alphaColor:hex、rgb、rgba 都能加透明度', () => {
  assert.equal(alphaColor('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
  assert.equal(alphaColor('#f80', 0.25), 'rgba(255,136,0,0.25)');
  assert.equal(alphaColor('rgba(10, 20, 30, .16)', 0.4), 'rgba(10,20,30,0.4)');
  assert.equal(alphaColor('rgb(1,2,3)', 1), 'rgba(1,2,3,1)');
  assert.equal(alphaColor('#ff8000', 5), 'rgba(255,128,0,1)');
  assert.equal(alphaColor('red', 0.5), 'red');
  assert.equal(alphaColor(undefined, 0.5), '');
});

test('rayExit:射線離開外框的距離', () => {
  const box = { x0: 0, y0: 0, x1: 10, y1: 8 };
  assert.equal(rayExit([5, 4], [1, 0], box), 5);
  assert.equal(rayExit([5, 4], [0, 1], box), 4);
  assert.equal(rayExit([5, 4], [0, -1], box), 4);
  assert.ok(Math.abs(rayExit([5, 4], [Math.SQRT1_2, Math.SQRT1_2], box) - 4 * Math.SQRT2) < 1e-9);
  assert.equal(rayExit([20, 4], [1, 0], box), 0, '在框外回 0');
  assert.equal(rayExit([5, 4], [0, 0], box), 0);
});

test('sectorIndexAt:圖面上方朝北時,右邊是東(震);上方 = 宅向時方位跟著轉', () => {
  assert.equal(GUA[sectorIndexAt([0, 0], [0, 5], 0)], '坎');
  assert.equal(GUA[sectorIndexAt([0, 0], [5, 0], 0)], '震');
  assert.equal(GUA[sectorIndexAt([0, 0], [0, -5], 0)], '離');
  assert.equal(GUA[sectorIndexAt([0, 0], [-5, 0], 0)], '兌');
  // 圖面上方 = 210°(未山向):往上 = 西南(坤)
  assert.equal(GUA[sectorIndexAt([0, 0], [0, 5], 210)], '坤');
  assert.equal(sectorIndexAt([1, 1], [1, 1], 0), -1, '太極點本身沒有方位');
  assert.equal(sectorIndexAt([0, 0], [1, 1], null), -1);
  assert.equal(sectorIndexAt([0, 0], [1, 1], NaN), -1);
  // 與引擎 sectorOfPoint 一致
  // (引擎的定義:bearing = up + atan2(dx,dy),扇區邊界順時針歸下一宮)
  const boundary = sectorIndexAt([0, 0], [Math.sin((22.5 * Math.PI) / 180), Math.cos((22.5 * Math.PI) / 180)], 0);
  assert.ok(boundary === 0 || boundary === 1);
});

test('viewFor / boundsFor:太極點拖出外框時範圍會擴大;鎖定範圍時不變', () => {
  const plan = buildTemplate('custom', { width: 6, depth: 8 }).plan;
  const b0 = boundsFor(plan, {});
  assert.deepEqual(b0, { minX: 0, minY: 0, maxX: 6, maxY: 8 });
  const b1 = boundsFor(plan, { taiji: [10, 12], extra: [[-3, -2]] });
  assert.deepEqual(b1, { minX: -3, minY: -2, maxX: 10, maxY: 12 });
  const v0 = viewFor(plan, 400, 400, { bounds: b0 });
  const v1 = viewFor(plan, 400, 400, { taiji: [10, 12], bounds: b0 }); // 鎖定範圍:忽略 taiji
  assert.equal(v0.scale, v1.scale);
  // y 翻轉:上方(y 大)在畫布上方(py 小)
  assert.ok(v0.toPx([0, 8])[1] < v0.toPx([0, 0])[1]);
  const [x, y] = v0.fromPx(...v0.toPx([2.5, 3.5]));
  assert.ok(Math.abs(x - 2.5) < 1e-9 && Math.abs(y - 3.5) < 1e-9);
  // 有標籤時四周留更多邊,所以縮得比較小
  assert.ok(viewFor(plan, 400, 400, { labels: true }).scale < viewFor(plan, 400, 400, { labels: false }).scale);
});

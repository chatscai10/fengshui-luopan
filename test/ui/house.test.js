// 住宅畫面的純邏輯:輸入驗證、壞資料修復、完成度、運的說明、住戶摘要、北基準切換。不依賴 DOM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/ui/store.js';
import {
  parseBearing, parseYear, parseFloor, cleanName, validateBirthDate, validateBirthTime, validateResident,
  splitBirth, formatBirth, residentProblems, repairDraft, completeness, nextStep, yunSpan, describeYun, yunLines,
  residentSummaries, cardsOf, pickCards, reportOk, declinationView, setNorthMode, setCity, resolveCityId, yearBounds, NAME_MAX,
} from '../../src/ui/views/house.js';

const NOW = Date.UTC(2026, 8, 29, 4); // 2026-09-29 12:00 台灣時間
const memStore = () => {
  const mem = new Map();
  return createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
};

test('parseBearing: 合法、邊界、壞輸入', () => {
  assert.deepEqual(parseBearing('175'), { ok: true, value: 175 });
  assert.deepEqual(parseBearing(' 175.55° '), { ok: true, value: 175.6 });
  assert.deepEqual(parseBearing('１７５．５'), { ok: true, value: 175.5 }); // 全形
  assert.deepEqual(parseBearing('0'), { ok: true, value: 0 });
  assert.deepEqual(parseBearing('359.99'), { ok: true, value: 0 }); // 四捨五入到 360 折回 0
  for (const bad of ['', '360', '-1', '361', 'abc', '12e2', '1,5', '175度度', '17 5x', null, undefined, NaN, 175]) {
    const r = parseBearing(bad);
    assert.equal(r.ok, false, `應拒絕 ${String(bad)}`);
    assert.ok(typeof r.message === 'string' && r.message.length > 0);
  }
  assert.deepEqual(parseBearing('', { allowEmpty: true }), { ok: true, value: null });
});

test('parseYear: 範圍、民國年提示、壞輸入', () => {
  const { min, max } = yearBounds(NOW);
  assert.equal(min, 1900);
  assert.equal(max, 2026);
  assert.deepEqual(parseYear('2004', { min, max }), { ok: true, value: 2004 });
  assert.deepEqual(parseYear('', { min, max }), { ok: true, value: null });
  assert.equal(parseYear('', { min, max, allowEmpty: false }).ok, false);
  assert.equal(parseYear('1899', { min, max }).ok, false);
  assert.equal(parseYear('2027', { min, max }).ok, false);
  const roc = parseYear('93', { min, max });
  assert.equal(roc.ok, false);
  assert.match(roc.message, /西元/);
  assert.equal(parseYear('２００４', { min, max }).value, 2004); // 全形數字正規化後合法
  for (const bad of ['20x4', '2004.5', '-2004', '20040', 'abc']) {
    assert.equal(parseYear(bad, { min, max }).ok, false, bad);
  }
});

test('parseFloor: 空白、地下室、超範圍', () => {
  assert.deepEqual(parseFloor(''), { ok: true, value: null });
  assert.deepEqual(parseFloor('12'), { ok: true, value: 12 });
  assert.deepEqual(parseFloor('-1'), { ok: true, value: -1 });
  for (const bad of ['0', '201', '-10', '1.5', 'B1', '十二']) assert.equal(parseFloor(bad).ok, false, bad);
});

test('validateBirthDate: 不存在的日期、閏年、範圍、未來', () => {
  assert.equal(validateBirthDate('1990-02-04', NOW).ok, true);
  assert.equal(validateBirthDate('2000-02-29', NOW).ok, true); // 2000 是閏年
  assert.equal(validateBirthDate('1900-02-29', NOW).ok, false); // 1900 不是閏年
  assert.equal(validateBirthDate('1990-02-30', NOW).ok, false);
  assert.equal(validateBirthDate('1990-13-01', NOW).ok, false);
  assert.equal(validateBirthDate('1899-12-31', NOW).ok, false);
  assert.equal(validateBirthDate('2026-09-30', NOW).ok, false); // 明天
  assert.equal(validateBirthDate('2026-09-29', NOW).ok, true); // 今天
  for (const bad of ['', '1990/02/04', '90-02-04', 'abc', '1990-2-4', null, undefined, 19900204]) {
    assert.equal(validateBirthDate(bad, NOW).ok, false, String(bad));
  }
});

test('validateBirthTime: 選填、24 小時制', () => {
  assert.deepEqual(validateBirthTime(''), { ok: true, value: null });
  assert.deepEqual(validateBirthTime('08:30'), { ok: true, value: '08:30' });
  for (const bad of ['24:00', '8:30', '12:60', 'noon', '12:5']) assert.equal(validateBirthTime(bad).ok, false, bad);
});

test('validateResident: 整份表單,壞資料不給 value', () => {
  const ok = validateResident({ name: '  媽媽 ', gender: 'F', date: '1992-05-01', time: '10:30' }, NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { name: '媽媽', gender: 'F', birth: '1992-05-01 10:30' });
  assert.equal(validateResident({ name: '爸', gender: 'M', date: '1990-02-04', time: '' }, NOW).value.birth, '1990-02-04');

  const empty = validateResident({ name: '   ', gender: null, date: '', time: 'zz' }, NOW);
  assert.equal(empty.ok, false);
  assert.equal(empty.value, undefined);
  assert.deepEqual(Object.keys(empty.errors).sort(), ['date', 'gender', 'name', 'time']);
  assert.equal(validateResident({ name: '很'.repeat(NAME_MAX + 1), gender: 'M', date: '1990-01-01' }, NOW).ok, false);
  assert.equal(validateResident({ name: '很'.repeat(NAME_MAX), gender: 'M', date: '1990-01-01' }, NOW).ok, true);
  assert.equal(validateResident(null, NOW).ok, false);
  // 控制字元與零寬字元被清掉,換行變成空白
  assert.equal(validateResident({ name: 'x\u0000\u200by\nz', gender: 'M', date: '1990-01-01' }, NOW).value.name, 'xy z');
});

test('cleanName: 控制字元與空白', () => {
  assert.equal(cleanName('  a\tb  \n c '), 'a b c');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(42), '');
});

test('splitBirth / formatBirth / residentProblems', () => {
  assert.deepEqual(splitBirth('1990-02-04 10:30'), { date: '1990-02-04', time: '10:30' });
  assert.deepEqual(splitBirth('1990-02-04'), { date: '1990-02-04', time: '' });
  assert.deepEqual(splitBirth('壞'), { date: '', time: '' });
  assert.equal(formatBirth('1990-02-04'), '1990 年 2 月 4 日(不知道時間)');
  assert.equal(formatBirth('1990-02-04 09:05'), '1990 年 2 月 4 日 09:05');
  assert.equal(formatBirth(''), '出生日期未填');
  assert.deepEqual(residentProblems({ gender: 'M', birth: '1990-02-04' }, NOW), []);
  assert.deepEqual(residentProblems({ gender: '', birth: '' }, NOW), ['性別', '出生日期']);
  assert.deepEqual(residentProblems({ gender: 'F', birth: '1990-02-30' }, NOW), ['出生日期']);
  assert.deepEqual(residentProblems(null, NOW), ['性別', '出生日期']);
});

test('repairDraft: 舊資料的城市代碼 taipei 不在磁偏角表內,要修成台北;地基預設值已是合法的台北', () => {
  assert.equal(resolveCityId('taipei'), '台北');
  assert.equal(resolveCityId('高雄'), '高雄');
  assert.equal(resolveCityId(undefined), '台北');
  const store = memStore();
  assert.equal(store.get().facing.cityId, '台北'); // 地基預設值已改成合法的城市鍵
  const d = JSON.parse(JSON.stringify(store.get()));
  assert.equal(repairDraft(d), false); // 已乾淨就不再改動
  d.facing.cityId = 'taipei'; // 直接餵舊資料:repairDraft 仍要修成台北
  assert.equal(repairDraft(d), true);
  assert.equal(d.facing.cityId, '台北');
  assert.equal(repairDraft(d), false);
});

test('repairDraft: 壞的朝向、建築與住戶資料不會讓引擎丟例外', () => {
  const store = memStore();
  const d = JSON.parse(JSON.stringify(store.get()));
  d.facing.bearing = '175';
  d.facing.doorBearing = NaN;
  d.building = { type: 'castle', builtYear: '2004', moveInYear: 1.5, renovation: 'wat', floor: 'x' };
  d.residents = [null, 5, { name: 7, gender: 'X', birth: 19900204 }, { id: 'a', name: 'A', gender: 'M', birth: '1990-02-04' }, { id: 'a', name: 'B', gender: 'F', birth: '1991-01-01' }];
  d.mainResidentId = 123;
  let n = 0;
  assert.equal(repairDraft(d, () => `id${(n += 1)}`), true);
  assert.equal(d.facing.bearing, null);
  assert.equal(d.building.type, 'apartment');
  assert.equal(d.building.builtYear, null);
  assert.equal(d.building.renovation, 'none');
  assert.equal(d.mainResidentId, null);
  assert.equal(d.residents.length, 3);
  assert.equal(new Set(d.residents.map((r) => r.id)).size, 3);
  assert.ok(d.residents.every((r) => typeof r.name === 'string' && typeof r.birth === 'string'));
  d.facing.bearing = 175;
  store.update((s) => { Object.assign(s, { facing: d.facing, building: d.building, residents: d.residents, mainResidentId: d.mainResidentId }); });
  const r = store.report();
  assert.equal(r.error, undefined, r.error);
});

test('完成度與下一步:缺什麼導向哪個分頁', () => {
  const store = memStore();
  let items = completeness(store.get(), store.report());
  assert.deepEqual(items.map((i) => [i.id, i.done]), [['facing', false], ['year', false], ['residents', false], ['plan', false]]);
  assert.equal(items.find((i) => i.id === 'residents').optional, true);
  assert.deepEqual(nextStep(items), { id: 'facing', label: '先去量房子的朝向', tab: 'compass' });

  store.update((d) => { d.facing.bearing = 175; });
  items = completeness(store.get(), store.report());
  assert.equal(nextStep(items).tab, 'house');
  assert.equal(nextStep(items).id, 'year');

  store.update((d) => { d.building.builtYear = 2004; });
  items = completeness(store.get(), store.report());
  assert.deepEqual(nextStep(items), { id: 'plan', label: '接著畫平面圖', tab: 'plan' });

  store.update((d) => { d.plan = { placeholder: true }; });
  items = completeness(store.get(), store.report());
  // 平面圖不合法時視為未完成
  assert.equal(items.find((i) => i.id === 'plan').done, false);
  assert.match(items.find((i) => i.id === 'plan').detail, /問題/);

  const allDone = items.map((i) => ({ ...i, done: true }));
  assert.deepEqual(nextStep(allDone), { id: 'wealth', label: '看我家的財位', tab: 'wealth' });
  // 住戶選填:只有住戶沒填不會擋住下一步
  assert.equal(nextStep(items.map((i) => (i.id === 'residents' ? i : { ...i, done: true }))).id, 'wealth');
});

test('yunSpan / describeYun / yunLines: 八運 2004 到 2023,現在已是九運', () => {
  assert.deepEqual(yunSpan(2004), [2004, 2023]);
  assert.deepEqual(yunSpan(2023), [2004, 2023]);
  assert.deepEqual(yunSpan(2026), [2024, 2043]);
  assert.equal(yunSpan(1900, 'er_yuan_8'), null); // 二元八運只涵蓋 1996-2043,不丟例外

  const store = memStore();
  store.update((d) => { d.facing.bearing = 175; d.building.builtYear = 2010; });
  const info = describeYun(store.report(), store.get().building, NOW);
  assert.equal(info.basisYear, 2010);
  assert.equal(info.yun, 8);
  assert.deepEqual(info.span, [2004, 2023]);
  assert.equal(info.currentYun, 9);
  const lines = yunLines(info);
  assert.equal(lines[0], '以 2010 年(建成)的運來排盤:八運盤(2004–2023 年)');
  assert.match(lines[1], /已經是九運/);

  // 沒有朝向時(引擎沒算),仍可用日曆給預覽
  const s2 = memStore();
  s2.update((d) => { d.building.builtYear = 1985; });
  const pre = describeYun(s2.report(), s2.get().building, NOW);
  assert.equal(pre.yun, 7); // 1985 屬七運(1984-2003)
  assert.equal(describeYun(s2.report(), { builtYear: null }, NOW), null);
  assert.deepEqual(yunLines(null), []);
});

test('整修完工年份會被引擎採用,describeYun 跟著引擎說「整修完工」', () => {
  const store = memStore();
  store.update((d) => { d.facing.bearing = 175; d.building.builtYear = 1995; d.building.renovation = 'full'; d.building.renovatedYear = 2015; });
  const info = describeYun(store.report(), store.get().building, NOW);
  assert.equal(info.basisLabel, '整修完工');
  assert.equal(info.basisYear, 2015);
  assert.equal(info.yun, 8);
});

test('residentSummaries: 命卦來自引擎;沒朝向、資料不完整、立春當天各有說法', () => {
  const store = memStore();
  store.update((d) => {
    d.residents = [
      { id: 'a', name: '爸爸', gender: 'M', birth: '1990-02-04', utcOffsetMinutes: 480 },
      { id: 'b', name: '媽媽', gender: 'F', birth: '1992-05-01 10:30', utcOffsetMinutes: 480 },
      { id: 'c', name: '', gender: 'F', birth: '', utcOffsetMinutes: 480 },
    ];
    d.mainResidentId = 'b';
  });
  // 沒有朝向
  let rows = residentSummaries(store.get(), store.report(), []);
  assert.equal(rows[0].ming, null);
  assert.equal(rows[0].reason, 'noFacing');
  assert.equal(rows[2].reason, 'incomplete');
  assert.deepEqual(rows[2].problems, ['出生日期']);
  assert.equal(rows[2].name, '未命名');
  assert.equal(rows[1].isMain, true);

  // 有朝向
  store.update((d) => { d.facing.bearing = 176; d.building.builtYear = 2004; });
  const report = store.report();
  assert.equal(reportOk(report), true);
  const cards = cardsOf(report);
  assert.ok(cards.length > 0);
  rows = residentSummaries(store.get(), report, cards);
  assert.equal(rows[0].ming.ambiguous, true); // 立春當天又沒填時間
  assert.equal(rows[0].ming.text, '坤命或坎命');
  assert.equal(rows[0].ming.groupText, '東四命或西四命');
  assert.ok(rows[0].notes.length >= 1);
  assert.equal(rows[1].ming.text, '兌命');
  assert.equal(rows[1].ming.groupText, '西四命');
  assert.equal(rows[1].ming.matchesHouse, false); // 坎宅(東四)與兌命(西四)
  assert.equal(rows[2].reason, 'incomplete');
  assert.ok(!JSON.stringify(rows).match(/bz\.|house\.resident/), '不可洩漏內部代碼');
});

test('pickCards 依前綴與層級挑卡片', () => {
  const cards = [
    { id: 'house.geo.retest', level: 'note' },
    { id: 'house.geo.x', level: 'info' },
    { id: 'card.orientation.position', level: 'note' },
    { id: 'house.north.differs', level: 'caution' },
  ];
  assert.deepEqual(pickCards(cards, ['house.geo.']).map((c) => c.id), ['house.geo.retest']);
  assert.deepEqual(pickCards(cards, ['house.north.', 'house.geo.']).map((c) => c.id), ['house.geo.retest', 'house.north.differs']);
});

test('setNorthMode / setCity: 同步設定,磁北是預設所以不寫入', () => {
  const store = memStore();
  store.update((d) => { d.facing.bearing = 205; d.building.builtYear = 2004; });
  assert.ok(Math.abs(store.report().meta.declination + 5) < 0.3); // 預設城市台北是合法鍵,磁北模式也有磁偏角可並列顯示

  assert.equal(setNorthMode(store, 'true'), true);
  assert.equal(store.get().settings.northMode, 'true');
  assert.equal(store.get().facing.cityId, '台北');
  const r = store.report();
  assert.equal(r.meta.northMode, 'true');
  assert.ok(Math.abs(r.meta.declination + 5) < 0.3);

  assert.equal(setCity(store, '高雄'), true);
  assert.ok(Math.abs(store.report().meta.declination + 4.3) < 0.2);
  assert.equal(setCity(store, 'kaohsiung'), false);
  assert.equal(store.get().facing.cityId, '高雄');

  assert.equal(setNorthMode(store, 'magnetic'), true);
  assert.equal('northMode' in store.get().settings, false);
  assert.equal(store.report().meta.northMode, 'magnetic');
  assert.equal(setNorthMode(store, 'grid'), false);
});

test('declinationView: 台北偏西', () => {
  const v = declinationView('台北', NOW);
  assert.equal(v.city, '台北');
  assert.ok(v.deg < -4.9 && v.deg > -5.2);
  assert.match(v.text, /偏西/);
  assert.equal(v.inModelRange, true);
  assert.match(declinationView('新加坡', NOW).text, /偏東/);
  assert.equal(declinationView('不存在', NOW).city, '台北'); // 壞代碼退回台北
});

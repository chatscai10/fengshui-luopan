// 設定面板的資料表與套用邏輯:每個 DEFAULT_SETTINGS 鍵都要有說明或列入「刻意不顯示」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { analyzeHouse } from '../../src/core/analyze.js';
import { createStore } from '../../src/ui/store.js';
import {
  SETTING_META, SETTING_GROUPS, HIDDEN_SETTINGS, AUTO, applySetting, currentValue, isDefaultOption,
  backupFileName, importErrorMessage,
} from '../../src/ui/views/settings.js';

const memStore = () => {
  const mem = new Map();
  return createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
};
const keys = Object.keys(DEFAULT_SETTINGS);

test('DEFAULT_SETTINGS 每個鍵不是有說明,就是列入刻意不顯示(且不重複)', () => {
  const missing = keys.filter((k) => !(k in SETTING_META) && !(k in HIDDEN_SETTINGS));
  assert.deepEqual(missing, [], `沒有說明也沒列入不顯示: ${missing.join(', ')}`);
  const both = keys.filter((k) => k in SETTING_META && k in HIDDEN_SETTINGS);
  assert.deepEqual(both, []);
  const unknown = [...Object.keys(SETTING_META), ...Object.keys(HIDDEN_SETTINGS)].filter((k) => !keys.includes(k));
  assert.deepEqual(unknown, [], '表裡有 DEFAULT_SETTINGS 不存在的鍵');
  assert.equal(Object.keys(SETTING_META).length + Object.keys(HIDDEN_SETTINGS).length, keys.length);
  for (const k of ['virtualPartition', 'bazhaiMatch']) assert.ok(k in HIDDEN_SETTINGS, `${k} 目前沒有實際運算,不顯示`);
  for (const [k, why] of Object.entries(HIDDEN_SETTINGS)) assert.ok(why.length >= 6, `${k} 要寫原因`);
});

test('每個設定都有 label、help、選項與合法分組;選項含預設值', () => {
  const groupIds = new Set(SETTING_GROUPS.map((g) => g.id));
  for (const [k, m] of Object.entries(SETTING_META)) {
    assert.ok(groupIds.has(m.group), `${k} 分組不存在`);
    assert.ok(m.label && m.label.length > 0, `${k} 缺 label`);
    assert.ok(m.help && m.help.length >= 8, `${k} 缺說明`);
    assert.ok(Array.isArray(m.options) && m.options.length >= 2, `${k} 選項不足`);
    const values = m.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length, `${k} 選項重複`);
    if (m.explicit) {
      assert.ok(values.includes(AUTO), `${k} 需要「自動」選項`);
      assert.ok(values.includes(DEFAULT_SETTINGS[k]), `${k} 選項要含預設值`);
    } else {
      assert.ok(values.some((v) => v === DEFAULT_SETTINGS[k]), `${k} 選項要含預設值 ${DEFAULT_SETTINGS[k]}`);
    }
    for (const o of m.options) assert.ok(o.label && o.label.length > 0, `${k} 選項缺標籤`);
  }
});

test('文字不可出現英文內部代碼或程式術語', () => {
  const texts = [];
  for (const [k, m] of Object.entries(SETTING_META)) {
    texts.push(m.label, m.help, ...m.options.map((o) => o.label));
    assert.ok(!m.label.includes(k));
  }
  for (const g of SETTING_GROUPS) texts.push(g.title);
  for (const t of texts) assert.ok(!/[A-Za-z_]{3,}/.test(t), `含英文代碼: ${t}`);
});

test('進階群組與一般群組分得對', () => {
  const adv = SETTING_GROUPS.filter((g) => g.advanced).map((g) => g.id);
  assert.ok(adv.length >= 5);
  for (const k of ['northMode', 'measureUncertainty', 'lockSeconds', 'wealthProfile', 'allowWaterHint', 'preferDragonSide']) {
    assert.ok(!adv.includes(SETTING_META[k].group), `${k} 應在一般區`);
  }
  for (const k of ['xiaGuaHalfWidth', 'yearBoundary', 'yunSystem', 'sanshaArc', 'southUp']) {
    assert.ok(adv.includes(SETTING_META[k].group), `${k} 應在進階區`);
  }
});

test('表裡的每個選項都被引擎接受(不會丟 INVALID_SETTING 或其他錯誤)', () => {
  const input = {
    nowMs: Date.UTC(2026, 8, 29, 4),
    facing: { bearing: 176, doorBearing: 250, declination: -5.03 },
    building: { type: 'apartment', builtYear: 2004, moveInYear: 2010, renovation: 'none' },
    residents: [{ id: 'a', name: 'A', gender: 'M', birth: '1990-06-01', utcOffsetMinutes: 480 }],
  };
  for (const [k, m] of Object.entries(SETTING_META)) {
    for (const o of m.options) {
      if (o.value === AUTO) continue;
      assert.doesNotThrow(() => analyzeHouse(input, { [k]: o.value }), `${k}=${String(o.value)}`);
    }
  }
});

test('applySetting: 等於預設就拿掉覆寫;非預設寫入;不認得的鍵或值一律拒絕', () => {
  const store = memStore();
  assert.equal(applySetting(store, 'wealthProfile', 'xuankong'), true);
  assert.deepEqual(store.get().settings, { wealthProfile: 'xuankong' });
  assert.equal(applySetting(store, 'wealthProfile', 'mingcai'), true);
  assert.deepEqual(store.get().settings, {}); // 預設值不寫入,引擎只認使用者明寫的設定

  assert.equal(applySetting(store, 'allowWaterHint', true), true);
  assert.equal(store.get().settings.allowWaterHint, true);
  assert.equal(applySetting(store, 'allowWaterHint', false), true);
  assert.equal('allowWaterHint' in store.get().settings, false);

  const before = JSON.stringify(store.get().settings);
  assert.equal(applySetting(store, 'measureUncertainty', 7), false); // 不在選項內
  assert.equal(applySetting(store, 'measureUncertainty', '5'), false); // 型別不對
  assert.equal(applySetting(store, 'virtualPartition', true), false); // 刻意不顯示
  assert.equal(applySetting(store, 'nope', 1), false);
  assert.equal(applySetting(store, '__proto__', 1), false);
  assert.equal(JSON.stringify(store.get().settings), before);
});

test('qiIntake: 有明寫與沒寫意義不同,選「扣分」要寫進去,選「自動」才拿掉', () => {
  const store = memStore();
  assert.equal(currentValue(store.get(), 'qiIntake'), AUTO);
  assert.equal(isDefaultOption('qiIntake', AUTO), true);
  assert.equal(isDefaultOption('qiIntake', 'penalty'), false);
  applySetting(store, 'qiIntake', 'penalty');
  assert.equal(store.get().settings.qiIntake, 'penalty');
  assert.equal(currentValue(store.get(), 'qiIntake'), 'penalty');
  applySetting(store, 'qiIntake', AUTO);
  assert.equal('qiIntake' in store.get().settings, false);
});

test('currentValue 與 isDefaultOption 從 DEFAULT_SETTINGS 讀', () => {
  const store = memStore();
  for (const k of Object.keys(SETTING_META)) {
    if (SETTING_META[k].explicit) continue;
    assert.equal(currentValue(store.get(), k), DEFAULT_SETTINGS[k]);
    assert.ok(SETTING_META[k].options.some((o) => isDefaultOption(k, o.value)), `${k} 沒有標出預設選項`);
  }
  applySetting(store, 'xiaGuaHalfWidth', 3);
  assert.equal(currentValue(store.get(), 'xiaGuaHalfWidth'), 3);
});

test('設定變更會讓 report 重算', () => {
  const store = memStore();
  store.update((d) => { d.facing.bearing = 176; d.building.builtYear = 2004; });
  assert.equal(store.report().meta.ruleset.wealthProfile, 'mingcai');
  applySetting(store, 'wealthProfile', 'xuankong');
  assert.equal(store.report().meta.ruleset.wealthProfile, 'xuankong');
  applySetting(store, 'yunSystem', 'er_yuan_8');
  assert.equal(store.report().error, undefined);
  assert.equal(store.report().meta.ruleset.yunSystem, 'er_yuan_8');
});

test('backupFileName 與 importErrorMessage', () => {
  assert.equal(backupFileName(Date.UTC(2026, 8, 29, 4)), 'fengshui-backup-2026-09-29.json');
  assert.equal(backupFileName(Date.UTC(2026, 11, 31, 20)), 'fengshui-backup-2027-01-01.json'); // 台灣時間已過午夜
  assert.match(importErrorMessage(new SyntaxError('Unexpected token')), /不是有效的備份檔/);
  assert.match(importErrorMessage(new Error('備份檔格式或版本不符')), /版本/);
  assert.match(importErrorMessage(new Error('boom')), /匯入失敗/);
  assert.match(importErrorMessage(null), /匯入失敗/);
});

test('匯入匯出來回:資料原樣還原;版本不符與壞 JSON 會丟錯且不動資料', () => {
  const a = memStore();
  a.update((d) => {
    d.facing.bearing = 210;
    d.building.builtYear = 1999;
    d.residents = [{ id: 'x', name: '小明', gender: 'M', birth: '2001-03-04', utcOffsetMinutes: 480 }];
    d.settings.wealthProfile = 'xuankong';
  });
  const text = a.exportJSON();
  const b = memStore();
  b.importJSON(text);
  assert.deepEqual(b.get(), a.get());
  const snapshot = JSON.stringify(b.get());
  assert.throws(() => b.importJSON('{oops'), SyntaxError);
  assert.throws(() => b.importJSON('{"v":99}'), /版本/);
  assert.throws(() => b.importJSON('null'), /版本|Cannot/);
  assert.equal(JSON.stringify(b.get()), snapshot);
  b.reset();
  assert.equal(b.get().facing.bearing, null);
  assert.deepEqual(b.get().residents, []);
});

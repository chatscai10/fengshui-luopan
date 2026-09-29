// 路由規則(EASY_SPEC 3.2、8.1):網址 hash → 簡單模式或完整功能的分頁。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TABS, EASY_VIEW, MODES, hashViewId, proHomeOf, resolveRoute, modeToggleTarget } from '../../src/ui/route.js';

const viewFile = (id) => fileURLToPath(new URL(`../../src/ui/views/${id}.js`, import.meta.url));

test('TABS 與 main.js 原本的分頁相同,MODES 與 EASY_VIEW', () => {
  assert.deepEqual(TABS.map((t) => [t.id, t.label, t.icon]), [
    ['compass', '羅盤', 'compass'], ['house', '住宅', 'home'], ['plan', '平面圖', 'plan'], ['wealth', '財位', 'coin'], ['report', '報告', 'doc'],
  ]);
  assert.deepEqual(MODES, ['easy', 'pro']);
  assert.equal(EASY_VIEW, 'easy');
  assert.ok(Object.isFrozen(TABS));
});

test('hashViewId:與 main.js 的 /^#\\/(\\w+)/ 相同', () => {
  assert.equal(hashViewId('#/plan?x'), 'plan');
  assert.equal(hashViewId('#/easy'), 'easy');
  assert.equal(hashViewId('#/wealth/extra'), 'wealth');
  assert.equal(hashViewId(''), null);
  assert.equal(hashViewId('#'), null);
  assert.equal(hashViewId('#plan'), null);
  assert.equal(hashViewId(undefined), null);
  assert.equal(hashViewId(null), null);
});

test('resolveRoute:#/easy 一律簡單模式', () => {
  for (const ui of [{}, { mode: 'pro' }, { mode: 'easy', tab: 'plan' }]) {
    assert.deepEqual(resolveRoute('easy', ui), { view: 'easy', mode: 'easy', canonicalHash: '#/easy' });
  }
});

test('resolveRoute:每個分頁的網址都是完整功能的該分頁(不管上次模式)', () => {
  for (const t of TABS) {
    for (const ui of [{}, { mode: 'easy' }, { mode: 'pro', tab: 'report' }]) {
      assert.deepEqual(resolveRoute(t.id, ui), { view: t.id, mode: 'pro', canonicalHash: `#/${t.id}` });
    }
  }
  assert.deepEqual(resolveRoute('wealth', { mode: 'easy' }), { view: 'wealth', mode: 'pro', canonicalHash: '#/wealth' });
});

test('resolveRoute:空白或不認得的網址依上次模式', () => {
  assert.deepEqual(resolveRoute(null, {}), { view: 'easy', mode: 'easy', canonicalHash: '#/easy' });
  assert.deepEqual(resolveRoute(null, { mode: 'easy', tab: 'plan' }), { view: 'easy', mode: 'easy', canonicalHash: '#/easy' });
  assert.deepEqual(resolveRoute('nope', { mode: 'x' }), { view: 'easy', mode: 'easy', canonicalHash: '#/easy' });
  assert.deepEqual(resolveRoute(null, { mode: 'pro', tab: 'plan' }), { view: 'plan', mode: 'pro', canonicalHash: '#/plan' });
  assert.deepEqual(resolveRoute('settings', { mode: 'pro', tab: 'house' }), { view: 'house', mode: 'pro', canonicalHash: '#/house' });
  // tab 壞掉 → 羅盤
  assert.deepEqual(resolveRoute(null, { mode: 'pro', tab: 'xx' }), { view: 'compass', mode: 'pro', canonicalHash: '#/compass' });
  assert.deepEqual(resolveRoute(null, { mode: 'pro', tab: 5 }), { view: 'compass', mode: 'pro', canonicalHash: '#/compass' });
  assert.deepEqual(resolveRoute(null, { mode: 'pro', tab: 'easy' }), { view: 'compass', mode: 'pro', canonicalHash: '#/compass' });
  // ui 壞掉
  for (const ui of [null, undefined, 5, 'pro']) {
    assert.deepEqual(resolveRoute(null, ui), { view: 'easy', mode: 'easy', canonicalHash: '#/easy' });
  }
});

test('resolveRoute:canonicalHash 解析回去得到同一個畫面', () => {
  for (const id of [null, 'easy', 'bogus', ...TABS.map((t) => t.id)]) {
    for (const ui of [{}, { mode: 'pro', tab: 'report' }]) {
      const r = resolveRoute(id, ui);
      assert.deepEqual(resolveRoute(hashViewId(r.canonicalHash), ui), r);
    }
  }
});

test('proHomeOf 與 modeToggleTarget 兩個方向', () => {
  assert.equal(proHomeOf({ tab: 'plan' }), 'plan');
  assert.equal(proHomeOf({ tab: 'nope' }), 'compass');
  assert.equal(proHomeOf(null), 'compass');
  assert.equal(modeToggleTarget('easy', { tab: 'wealth' }), '#/wealth');
  assert.equal(modeToggleTarget('easy', {}), '#/compass');
  assert.equal(modeToggleTarget('pro', { tab: 'wealth' }), '#/easy');
});

test('每個分頁都有 src/ui/views/<id>.js', () => {
  for (const t of TABS) assert.ok(fs.existsSync(viewFile(t.id)), `缺 views/${t.id}.js`);
});

test('簡單模式畫面 src/ui/views/easy.js 存在', { skip: fs.existsSync(viewFile('easy')) ? false : '簡單模式畫面尚未建立' }, () => {
  assert.ok(fs.existsSync(viewFile('easy')));
  assert.match(fs.readFileSync(viewFile('easy'), 'utf8'), /export\s+async\s+function\s+mount\s*\(/);
});

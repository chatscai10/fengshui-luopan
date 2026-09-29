// 簡單模式結果卡的文字(src/ui/easy/result.js):交界提醒交給「方向差幾度會不會換」處理,
// 流年凶星改用白話版;並對各種格局、大門位置、年份與方向掃一遍,結果卡上不可出現術語。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easyResultParts } from '../../src/ui/easy/result.js';
import { BORDERLINE_SENTENCE, EASY_ANNUAL_REMEDY, renderReport, renderEasySummary } from '../../src/core/copy.js';
import { createStore } from '../../src/ui/store.js';
import { buildTemplate, TEMPLATES } from '../../src/ui/plan/templates.js';
import { withDoorSide, DOOR_SIDES, placeText } from '../../src/ui/easy/layout.js';
import { buildWealthModel } from '../../src/ui/views/wealth.js';
import { facingCheckFromLock } from '../../src/ui/views/compass.js';
import { facingCheckOf } from '../../src/ui/easy/measure.js';

// 與 easy_text.test.js 同一份清單(不直接 import 測試檔,免得那個檔的測試被重跑一次)
const TERM_BLACKLIST = ['宮', '明財位', '暗財位', '八宅', '玄空', '飛星', '山星', '向星', '命卦', '宅卦', '坐向', '空亡', '兼', '卦', '分數'];

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

test('easyResultParts:拿掉交界的檢查、補救與摘要句,流年凶星換成白話版', () => {
  const entry = {
    checks: [{ ok: true, text: '兩面都是實牆' }, { ok: false, kind: 'borderline', text: '位置接近兩個方位的交界' }],
    remedies: [
      { id: 'wealth.borderline.living:TR', headline: '位置接近兩個方位的交界', body: '這個位置距離震宮…' },
      { id: 'wealth.annual.bad_on_ming.living:TR', headline: '今年二黑飛到這個角落所在的宮', body: '這個角落在乾宮…', level: 'caution' },
    ],
  };
  const p = easyResultParts(entry, { sentences: ['第一句', BORDERLINE_SENTENCE] });
  assert.deepEqual(p.sentences, ['第一句']);
  assert.deepEqual(p.checks, [{ ok: true, text: '兩面都是實牆' }]);
  assert.equal(p.remedy.headline, EASY_ANNUAL_REMEDY.headline);
  assert.equal(p.remedy.body, EASY_ANNUAL_REMEDY.body);
  assert.equal(p.remedy.level, 'caution');
  const other = { id: 'wealth.ming.status.x', headline: '與廁所共牆', body: '傳統上認為…' };
  assert.equal(easyResultParts({ checks: [], remedies: [other] }, null).remedy, other);
  assert.deepEqual(easyResultParts(null, null), { sentences: [], checks: [], remedy: null });
});

test('結果卡掃描:各格局 × 大門位置 × 年份 × 方向,顯示的文字都沒有術語', () => {
  const plans = [{ id: 'none', plan: null }];
  for (const t of TEMPLATES) {
    for (const side of DOOR_SIDES) {
      let plan;
      try { plan = withDoorSide(buildTemplate(t.id, t.id === 'custom' ? { width: 6, depth: 8 } : {}).plan, side).plan; } catch { continue; }
      plans.push({ id: `${t.id}/${side}`, plan });
    }
  }
  let n = 0;
  let borderlineSeen = 0;
  let annualSeen = 0;
  for (const { id, plan } of plans) {
    for (const year of [null, 1995, 2005]) {
      for (let b = 0; b < 360; b += 15) {
        const store = createStore(memStorage());
        store.update((d) => { d.plan = plan; d.facing.bearing = b; d.building.builtYear = year; });
        const s = store.get();
        const r = store.report();
        if (!r || r.error) continue;
        const m = buildWealthModel(s, r, renderReport(r));
        const sum = renderEasySummary(r);
        if (!m.best) continue;
        n++;
        if (m.best.checks.some((c) => c.kind === 'borderline')) borderlineSeen++;
        if (m.best.remedies.some((x) => String(x.id).startsWith('wealth.annual.bad_on_ming.'))) annualSeen++;
        const p = easyResultParts(m.best, sum);
        const tops = r.summary.wealthTop || [];
        const others = m.others.map((e, i) => { const pl = placeText(tops[i + 1], s.plan); return pl ? pl.text : e.headline; });
        const texts = [
          ...p.sentences, ...p.checks.map((c) => c.text),
          ...(p.remedy ? [p.remedy.headline, p.remedy.body] : []),
          ...sum.softTips, sum.tierNote, sum.title, ...others,
        ];
        for (const t of texts) {
          for (const w of TERM_BLACKLIST) assert.ok(!t.includes(w), `${id} 年份 ${year} 方向 ${b}:含術語「${w}」: ${t}`);
        }
      }
    }
  }
  assert.ok(n > 500, `掃描數量太少: ${n}`);
  // 確認掃描真的碰到要換掉的兩種卡片,不是剛好沒遇到
  assert.ok(borderlineSeen > 0, '沒有掃到接近交界的案例');
  assert.ok(annualSeen > 0, '沒有掃到流年凶星的案例');
});

test('facingCheckFromLock:羅盤頁存檔時保留 iPhone 自己估計的誤差', () => {
  const patch = { bearing: 180, source: 'sensor', sigma: 0.4, lockedAtMs: 1700000000000 };
  const chk = facingCheckFromLock(patch, { sigma: 0.4, lockedAtMs: 1700000000000, accuracyDeg: 17.46 });
  assert.deepEqual(chk, { n: 1, spreadDeg: null, lockedAtMs: 1700000000000, dropped: 0, accuracyDeg: 17.5 });
  // 存進 store 後簡單模式讀得到(同一次鎖定)
  assert.equal(facingCheckOf({ source: 'sensor', lockedAtMs: 1700000000000, check: chk }), chk);
  assert.equal(facingCheckFromLock(patch, { sigma: 0.4, lockedAtMs: 1, accuracyDeg: null }), null, 'Android 沒有誤差估計');
  assert.equal(facingCheckFromLock(patch, { sigma: 0.4, lockedAtMs: 1, accuracyDeg: -1 }), null, '未校準');
  assert.equal(facingCheckFromLock({ ...patch, lockedAtMs: null }, { accuracyDeg: 10 }), null, '沒有鎖定(手動)');
  assert.equal(facingCheckFromLock(patch, null), null);
});

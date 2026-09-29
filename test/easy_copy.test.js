// copy.js 的簡單模式匯出(EASY_SPEC 8.9、5.4):renderReport 抽常數後輸出逐字不變、財位摘要、誤差影響、「手機指北針準嗎?」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeHouse } from '../src/core/analyze.js';
import {
  renderReport, scrubText, TIER_SENTENCE, BORDERLINE_SENTENCE, EASY_METHOD, EASY_TITLE, EASY_NONE_SENTENCE, TIER_NOTE,
  EASY_DOOR_WHY, EASY_DOOR_SAME, EASY_PICK8_NOTE, EASY_DISCLAIMERS, IMPACT_SHORT, renderEasySummary, renderDirectionImpact,
  renderStabilityNote, compassHonesty,
} from '../src/core/copy.js';
import { SOFT_ADVICE } from '../src/core/wealth/constants.js';
import { NOW, goldenInput, randomHouse, mulberry32 } from './helpers/analyze.js';
import { buildTemplate } from '../src/ui/plan/templates.js';
import { enginePlanOf } from '../src/ui/plan/editor.js';
import { createStore } from '../src/ui/store.js';
import { findScoreLeaks } from '../src/ui/views/report.js';
import { eightImpact } from '../src/ui/easy/direction.js';
import { withDoorSide } from '../src/ui/easy/layout.js';

const SPEC = fs.readFileSync(fileURLToPath(new URL('../docs/EASY_SPEC.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const TERM_BLACKLIST = ['宮', '明財位', '暗財位', '八宅', '玄空', '飛星', '山星', '向星', '命卦', '宅卦', '坐向', '空亡', '兼', '卦', '分數'];
const SCARY = ['大凶', '絕嗣', '敗財'];
/** 「保證」只可以出現在「不保證」(與 analyze.test.js 的規則相同) */
const AFFIRMED_GUARANTEE = /(?<!不)保證/;

// ─────────────── renderReport 逐字不變 ───────────────

/** 固定的一組報告:黃金案例、300 個隨機房子、4 範本 × 8 個朝向(有無建成年份交錯) */
function snapshotReports() {
  const out = [];
  const add = (inp, s = {}, o = {}) => { let r; try { r = analyzeHouse(inp, s, o); } catch { return; } out.push(r); };
  add(goldenInput());
  const rng = mulberry32(20260929);
  for (let i = 0; i < 300; i += 1) { const { input, settings, opts } = randomHouse(rng); add(input, settings, opts); }
  for (const id of ['studio', 'two', 'three', 'shop']) {
    for (const [k, b] of [0, 22, 45, 100, 157, 201, 225, 300].entries()) {
      const plan = { ...enginePlanOf(buildTemplate(id).plan), planUpBearing: b };
      add({
        nowMs: NOW, utcOffsetMinutes: 480, facing: { bearing: b, doorBearing: null, declination: -5.03, uncertainty: null },
        building: { type: 'apartment', builtYear: k % 2 ? 2005 : null, moveInYear: null, renovation: 'none', floor: null },
        residents: [], mainResidentId: null, plan,
      });
    }
  }
  return out;
}

test('renderReport:抽出 TIER_SENTENCE、BORDERLINE_SENTENCE 後,對固定的 333 份報告輸出與改動前逐字相同', () => {
  const reps = snapshotReports();
  assert.equal(reps.length, 333);
  const hash = createHash('sha256');
  for (const r of reps) hash.update(JSON.stringify(renderReport(r)));
  // 雜湊是改動 copy.js 之前,用同一組報告算出來的
  assert.equal(hash.digest('hex'), 'd2a8cbf60d1abe170693680053a05adbd32e1a39790ce521ad51a06174485dcb');
  // 樣本確實涵蓋三種標籤與交界句
  const tops = reps.flatMap((r) => r.summary.wealthTop);
  for (const t of ['suitable', 'consider', 'notAdvised']) assert.ok(tops.some((x) => x.tier === t), t);
  assert.ok(tops.some((x) => x.borderline));
});

test('renderReport 的財位卡用的就是這幾個常數', () => {
  const reps = snapshotReports();
  const bodies = reps.flatMap((r) => renderReport(r, { glossary: false }).sections.find((s) => s.id === 'wealth').cards.filter((c) => c.id.startsWith('card.wealth.')).map((c) => c.body));
  for (const s of Object.values(TIER_SENTENCE)) assert.ok(bodies.some((b) => b.startsWith(s)), s);
  assert.ok(bodies.some((b) => b.includes(BORDERLINE_SENTENCE)));
  assert.deepEqual(Object.keys(TIER_SENTENCE), ['suitable', 'consider', 'notAdvised']);
  assert.ok(Object.isFrozen(TIER_SENTENCE));
});

// ─────────────── renderEasySummary ───────────────

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}
function reportOf({ template = null, bearing, builtYear = null }) {
  const store = createStore(memStorage());
  store.update((d) => {
    d.facing.bearing = bearing;
    d.building.builtYear = builtYear;
    d.plan = template ? buildTemplate(template).plan : null;
  });
  return store.report();
}
const ALLOWED = new Set([...Object.values(EASY_METHOD), ...Object.values(TIER_SENTENCE), BORDERLINE_SENTENCE, EASY_NONE_SENTENCE]);
const TIPS = SOFT_ADVICE.map((a) => a.text);

function checkSummary(name, sum) {
  assert.ok(['ok', 'none'].includes(sum.status), name);
  assert.ok(sum.sentences.length >= 1 && sum.sentences.length <= 3, name);
  for (const s of sum.sentences) assert.ok(ALLOWED.has(s), `${name}: ${s}`);
  assert.equal(sum.tierNote, TIER_NOTE);
  const texts = [sum.title, ...sum.sentences, ...sum.softTips, sum.tierNote, sum.tierLabel].filter(Boolean);
  for (const t of texts) {
    for (const w of TERM_BLACKLIST) assert.ok(!t.includes(w), `${name} 含術語「${w}」: ${t}`);
    for (const w of SCARY) assert.ok(!t.includes(w), `${name} 含「${w}」: ${t}`);
    assert.ok(!AFFIRMED_GUARANTEE.test(t), `${name} 含肯定句的「保證」: ${t}`);
  }
  assert.deepEqual(findScoreLeaks(texts), [], name);
}

test('renderEasySummary:五種情境(兩房 225 無年份、套房 180 2005、無平面圖 90、三房 10 1998、全部不建議)', () => {
  const two = renderEasySummary(reportOf({ template: 'two', bearing: 225 }));
  checkSummary('兩房', two);
  assert.equal(two.status, 'ok');
  // 兩房範本原樣(大門在左):排第一的是主臥自己房門的斜對角,所以是 mingRoom(不是從大門算的)
  assert.equal(two.kind, 'mingRoom');
  assert.equal(two.title, EASY_TITLE.spot);
  assert.equal(two.sentences[0], EASY_METHOD.mingRoom);
  assert.deepEqual(two.softTips, TIPS, '有平面圖、有 wealth.soft.tips 時列出傳統佈置說法');

  const studioRep = reportOf({ template: 'studio', bearing: 180, builtYear: 2005 });
  const studio = renderEasySummary(studioRep);
  checkSummary('套房', studio);
  assert.equal(studio.tier, studioRep.summary.wealthTop[0].tier);
  assert.equal(studio.tierLabel, { suitable: '較適合', consider: '可以考慮', notAdvised: '不建議' }[studio.tier]);
  assert.equal(studio.sentences[1], TIER_SENTENCE[studio.tier]);
  assert.ok(studioRep.findings.some((f) => f.id === 'wealth.soft.tips'));
  assert.deepEqual(studio.softTips, TIPS);

  const noPlanRep = reportOf({ bearing: 90 });
  const noPlan = renderEasySummary(noPlanRep);
  checkSummary('無平面圖', noPlan);
  assert.equal(noPlan.kind, 'dark');
  assert.equal(noPlan.title, noPlan.tier === 'notAdvised' ? EASY_TITLE.none : EASY_TITLE.dark);
  assert.equal(noPlan.sentences[0], EASY_METHOD.dark);
  assert.deepEqual(noPlan.softTips, [], '沒有平面圖時不列佈置說法');

  const three = renderEasySummary(reportOf({ template: 'three', bearing: 10, builtYear: 1998 }));
  checkSummary('三房', three);
  assert.equal(three.status, 'ok');

  const allBad = JSON.parse(JSON.stringify(reportOf({ template: 'two', bearing: 225 })));
  for (const t of allBad.summary.wealthTop) t.tier = 'notAdvised';
  const bad = renderEasySummary(allBad);
  checkSummary('全部不建議', bad);
  assert.equal(bad.title, EASY_TITLE.none);
  assert.equal(bad.tierLabel, '不建議');
  assert.equal(bad.sentences[1], TIER_SENTENCE.notAdvised);
});

test('renderEasySummary:角落種類、交界句、沒有候選', () => {
  // 一般牆角(不是進門斜對角)
  let corner = null;
  let border = null;
  for (const id of ['studio', 'two', 'three', 'shop']) {
    for (let b = 0; b < 360; b += 7.5) {
      const r = reportOf({ template: id, bearing: b });
      const top = r.summary.wealthTop[0];
      if (!corner && top && top.kind !== 'ming' && top.kind !== 'dark') corner = r;
      if (!border && top && top.borderline) border = r;
      if (corner && border) break;
    }
    if (corner && border) break;
  }
  assert.ok(corner, '找得到一般牆角排第一的情境');
  const c = renderEasySummary(corner);
  checkSummary('牆角', c);
  assert.equal(c.kind, 'corner');
  assert.equal(c.sentences[0], EASY_METHOD.corner);
  assert.ok(border, '找得到接近方位交界的情境');
  const bs = renderEasySummary(border);
  checkSummary('交界', bs);
  assert.equal(bs.borderline, true);
  assert.equal(bs.sentences.length, 3);
  assert.equal(bs.sentences[2], BORDERLINE_SENTENCE);

  const empty = JSON.parse(JSON.stringify(reportOf({ template: 'two', bearing: 225 })));
  empty.summary.wealthTop = [];
  const none = renderEasySummary(empty);
  checkSummary('沒有候選', none);
  assert.deepEqual(none, { status: 'none', kind: null, tier: null, tierLabel: null, title: EASY_TITLE.none, sentences: [EASY_NONE_SENTENCE], softTips: [], tierNote: TIER_NOTE, borderline: false });
  assert.equal(renderEasySummary(null).status, 'none');
  assert.equal(renderEasySummary({ error: 'NO_FACING' }).status, 'none');
});

test('renderEasySummary:排第一的是從房門(不是大門)算的斜對角時,講清楚不是從大門算的', () => {
  // 兩房範本、大門在左邊、朝向 180:排第一的是主臥自己房門的斜對角(主臥左上角),不是客廳的進門斜對角
  const store = createStore(memStorage());
  store.update((d) => { d.facing.bearing = 180; d.plan = withDoorSide(buildTemplate('two').plan, 'left').plan; });
  const r = store.report();
  assert.equal(r.summary.wealthTop[0].id, 'bed1:TL');
  assert.equal(r.summary.wealthTop[0].kind, 'ming');
  const sum = renderEasySummary(r);
  assert.equal(sum.kind, 'mingRoom');
  assert.equal(sum.sentences[0], EASY_METHOD.mingRoom);
  // 從大門算的(大門在右邊時的客廳斜對角)仍用 ming
  store.update((d) => { d.plan = withDoorSide(buildTemplate('two').plan, 'right').plan; });
  const r2 = store.report();
  assert.equal(r2.summary.wealthTop[0].roomId, 'living');
  assert.equal(renderEasySummary(r2).kind, 'ming');
  // 查不到門的資料時當作從大門算
  const bare = JSON.parse(JSON.stringify(r));
  bare.wealth.layers.ming = [];
  assert.equal(renderEasySummary(bare).kind, 'ming');
});

test('renderEasySummary:不修改傳入的報告', () => {
  const r = reportOf({ template: 'two', bearing: 225 });
  const before = JSON.stringify(r);
  renderEasySummary(r);
  assert.equal(JSON.stringify(r), before);
});

// ─────────────── renderDirectionImpact ───────────────

const WEALTH_UNKNOWN = { icon: 'i', head: '財位在哪個角落', text: '進門斜對角的那個角落,看的是大門在屋裡的位置,不看指北針。不過哪個角落排第一,也會參考方向;選好格局後,會再幫你檢查。' };

test('renderDirectionImpact:財位一項不再一律說「不受影響」(還沒選格局時只講角落的位置)', () => {
  const out = renderDirectionImpact({ eight: eightImpact(180, 5) });
  assert.equal(out.title, '手機差幾度,會不會影響結果?');
  assert.deepEqual(out.lines, [WEALTH_UNKNOWN, { icon: '✓', head: '大門朝哪一方', text: '不受影響。你家大門朝南方,以差 5 度來看,還是南方。' }]);
  assert.equal(out.advanced, undefined, '簡單模式不顯示玄空的進階摺疊區');
  const n = renderDirectionImpact({ eight: eightImpact(5, 6.5) });
  assert.equal(n.lines[1].text, '不受影響。你家大門朝北方,以差 6.5 度來看,還是北方。');
  // 缺資料也不丟例外
  assert.deepEqual(renderDirectionImpact({}).lines, [WEALTH_UNKNOWN]);
  assert.deepEqual(renderDirectionImpact().lines, [WEALTH_UNKNOWN]);
});

test('renderDirectionImpact:排第一的財位會不會換(穩定 / 換位置 / 換評等)逐字', () => {
  const stable = renderDirectionImpact({ eight: eightImpact(180, 5), wealth: { status: 'stable', u: 5 } });
  assert.deepEqual(stable.lines[0], { icon: '✓', head: '財位在哪個角落', text: '不受影響。就算方向差 5 度,排第一的還是同一個角落。' });
  const place = renderDirectionImpact({ eight: eightImpact(171, 5), wealth: { status: 'changes', change: 'place', place: '客廳的前方左邊角落' } });
  assert.deepEqual(place.lines[0], { icon: '!', head: '財位在哪個角落', text: '可能受影響。方向差幾度,排第一的可能換成「客廳的前方左邊角落」。建議往旁邊走一大步再量一次。' });
  const tier = renderDirectionImpact({ wealth: { status: 'changes', change: 'tier', from: '較適合', to: '可以考慮' }, origin: 'typed' });
  assert.equal(tier.title, '度數差一點,會不會影響結果?');
  assert.deepEqual(tier.lines[0], { icon: '!', head: '財位在哪個角落', text: '位置不變,但方向差幾度,評等可能從「較適合」變成「可以考慮」。建議用手機或羅盤再量一次。' });
  const noPlace = renderDirectionImpact({ wealth: { status: 'changes', change: 'place', place: '' } });
  assert.match(noPlace.lines[0].text, /換成另一個位置/);
});

test('renderDirectionImpact:大門接近分界逐字', () => {
  const out = renderDirectionImpact({ eight: eightImpact(201, 5), origin: 'sensor' });
  assert.deepEqual(out.lines[1], { icon: '!', head: '大門朝哪一方', text: '可能受影響。你家大門剛好在南方和西南方中間,差幾度就可能算成另一邊。建議往旁邊走一大步再量一次。' });
});

test('renderDirectionImpact:自己選的大方位(不講大門那一項,財位用半格寬判斷)', () => {
  const out = renderDirectionImpact({ eight: eightImpact(225, 22.5), wealth: { status: 'stable', u: 22.5 }, origin: 'pick8' });
  assert.equal(out.title, '方向選得不夠準,會不會影響結果?');
  assert.deepEqual(out.lines, [{ icon: '✓', head: '財位在哪個角落', text: '不受影響。你選的這個大方位範圍裡,排第一的都是同一個角落。' }]);
  const ch = renderDirectionImpact({ wealth: { status: 'changes', change: 'place', place: '次臥的後方右邊角落' }, origin: 'pick8' });
  assert.equal(ch.lines[0].text, '可能受影響。方向差幾度,排第一的可能換成「次臥的後方右邊角落」。可以按「重新量」用手機量一次,會比較確定。');
});

test('renderStabilityNote:結果頁的提醒逐字', () => {
  assert.equal(renderStabilityNote({ change: 'place', place: '客廳的前方左邊角落' }), '方向差幾度,排第一的財位可能換成「客廳的前方左邊角落」。建議回第 1 步再量一次。');
  assert.equal(renderStabilityNote({ change: 'place', place: '東南方', origin: 'pick8' }), '你是自己選大概的方位;真正的方向如果偏一點,排第一的財位可能換成「東南方」。用手機量一次會比較確定。');
  assert.equal(renderStabilityNote({ change: 'tier', from: '較適合', to: '可以考慮' }), '方向差幾度,這個位置的評等可能從「較適合」變成「可以考慮」。');
  assert.equal(renderStabilityNote({ change: null }), '');
  assert.equal(renderStabilityNote(), '');
});

// ─────────────── compassHonesty ───────────────

/** 規格 5.4 的兩張表(主要四項、細節):小標 → { magnetic, true } 內文(代入 mu、d、set、where 與西偏的多少大小) */
function specHonesty({ mu, d, easy = false, where = null }) {
  const s = SPEC.slice(SPEC.indexOf('### 5.4'), SPEC.indexOf('### 5.5'));
  const [mainPart, detailPart] = s.split('摺疊區「給想知道細節的人」');
  const parse = (part) => part.split('\n').filter((l) => /^\| [^-`]/.test(l) && !l.startsWith('| 小標')).map((l) => {
    const [head, body] = l.split('|').slice(1, -1).map((c) => c.trim());
    const fill = (t) => t.replace(/\{mu\}/g, mu).replace(/\{d\}/g, d)
      .replace('{set}', easy ? '。' : '(可在設定的「手機量測的誤差」調整)。')
      .replace('{where}', where || `在台灣大約差 ${d} 度`)
      .replace('{more}', '多').replace('{less}', '小').replace('{bigger}', '大');
    if (body.includes('<br>')) {
      const [m, t] = body.split('<br>');
      return { head, magnetic: fill(m.replace(/^磁北時:/, '')), true: fill(t.replace(/^真北時:/, '')) };
    }
    return { head, magnetic: fill(body), true: fill(body) };
  });
  return { main: parse(mainPart), details: parse(detailPart) };
}

test('compassHonesty:主要四項與細節,磁北與真北兩種版本都與規格 5.4 表逐字相同', () => {
  const spec = specHonesty({ mu: '5', d: '5' });
  assert.equal(spec.main.length, 4);
  assert.equal(spec.details.length, 8);
  assert.deepEqual(spec.main.map((x) => x.head), ['結論', '怎麼自己檢查', '用地圖對一次', '量不準時']);
  for (const trueMode of [false, true]) {
    const h = compassHonesty({ trueMode, declinationDeg: -5.03, measureUncertainty: 5 });
    assert.equal(h.title, '手機指北針準嗎?');
    assert.equal(h.details.title, '給想知道細節的人');
    for (const [got, want] of [[h.items, spec.main], [h.details.items, spec.details]]) {
      assert.deepEqual(got.map((x) => x.head), want.map((x) => x.head));
      got.forEach((it, i) => assert.equal(it.body, trueMode ? want[i].true : want[i].magnetic, `${trueMode ? '真北' : '磁北'} ${it.head}`));
    }
  }
});

test('compassHonesty:磁偏角未知時寫「4 到 5」;城市名稱、簡單模式、誤差設定值;東偏時多少大小對調', () => {
  const spec = specHonesty({ mu: '8', d: '4 到 5' });
  const h = compassHonesty({ declinationDeg: null, measureUncertainty: 8 });
  h.details.items.forEach((it, i) => assert.equal(it.body, spec.details[i].magnetic, it.head));
  const city = compassHonesty({ declinationDeg: -4.32, cityName: '高雄' });
  assert.match(city.details.items[4].body, /在台灣大約差 4 到 5 度\(目前用高雄的值,約 4 度\)/);
  assert.doesNotMatch(city.details.items[4].body, /你所在的地方/);
  assert.match(compassHonesty().details.items[4].body, /在台灣大約差 4 到 5 度,/);
  assert.match(compassHonesty({ measureUncertainty: 3.5 }).details.items[0].body, /預設以 3\.5 度當作誤差來提醒你\(可在設定/);
  assert.match(compassHonesty({ easy: true }).details.items[0].body, /提醒你。$/, '簡單模式不提設定裡的誤差調整');
  // 東偏(例如烏魯木齊 +2.5 度):磁北讀數比真北小
  const east = compassHonesty({ declinationDeg: 2.51 });
  assert.match(east.details.items[4].body, /大約少 3 度/);
  assert.match(east.details.items[5].body, /有打開:iPhone 的數字會比本 App 大約 3 度/);
  assert.match(compassHonesty({ trueMode: true, declinationDeg: 2.51 }).details.items[5].body, /沒打開:iPhone 的數字會比本 App 小約 3 度/);
  // 誠實:5 度與 10 度的比例、內建指南針是同一個感測器、需開啟定位服務
  const all = h.details.items.map((x) => x.body).join('');
  assert.match(all, /差 5 度時,大約 8 成/);
  assert.match(all, /差到 10 度時,大約只剩一半/);
  assert.match(all, /同一個感測器/);
  assert.match(all, /需開啟定位服務/);
  assert.match(h.items[0].body, /^夠用。/, '最上面直接回答準不準');
});

// ─────────────── 常數與文字規則 ───────────────

test('新常數的文字與規格 8.9 相同', () => {
  const block = SPEC.slice(SPEC.indexOf('### 8.9'), SPEC.indexOf('### 8.10'));
  for (const s of [...Object.values(TIER_SENTENCE), BORDERLINE_SENTENCE, ...Object.values(EASY_METHOD), ...Object.values(EASY_TITLE), EASY_NONE_SENTENCE, EASY_DOOR_WHY, EASY_DOOR_SAME, EASY_PICK8_NOTE, ...EASY_DISCLAIMERS, ...Object.values(IMPACT_SHORT)]) {
    assert.ok(block.includes(`'${s}'`), s);
  }
  // TIER_NOTE 改成「不保證任何結果」(規格原句「不是保證」會被 scrubText 改寫,也違反「保證只出現在不保證」的規則)
  assert.equal(TIER_NOTE, '「較適合、可以考慮、不建議」只是本 App 的整理排序,不保證任何結果。');
  assert.deepEqual(IMPACT_SHORT, { ok: '對 8 個大方位:不影響。', near: '對 8 個大方位:接近分界,可能影響。' });
});

test('所有新字串通過 scrubText 後不變', () => {
  const strings = [
    ...Object.values(TIER_SENTENCE), BORDERLINE_SENTENCE, ...Object.values(EASY_METHOD), ...Object.values(EASY_TITLE),
    EASY_NONE_SENTENCE, TIER_NOTE, EASY_DOOR_WHY, EASY_DOOR_SAME, EASY_PICK8_NOTE, ...EASY_DISCLAIMERS, ...Object.values(IMPACT_SHORT),
  ];
  for (const trueMode of [false, true]) {
    for (const d of [-5.03, null, 2.51]) {
      for (const easy of [false, true]) {
        const h = compassHonesty({ trueMode, declinationDeg: d, measureUncertainty: 5, easy, cityName: '台北' });
        strings.push(h.title, h.details.title, ...[...h.items, ...h.details.items].flatMap((x) => [x.head, x.body]));
      }
    }
  }
  const wealths = [null, { status: 'stable', u: 5 }, { status: 'changes', change: 'place', place: '客廳的前方左邊角落' }, { status: 'changes', change: 'tier', from: '較適合', to: '可以考慮' }];
  for (const [b, u, origin] of [[180, 5, 'sensor'], [201, 5, 'sensor'], [5, 6.5, 'typed'], [225, 22.5, 'pick8'], [22.4, 10, 'sensor']]) {
    for (const wealth of wealths) {
      const out = renderDirectionImpact({ eight: eightImpact(b, u), wealth, origin });
      strings.push(out.title, ...out.lines.flatMap((l) => [l.head, l.text]));
    }
  }
  for (const origin of ['sensor', 'pick8']) {
    strings.push(renderStabilityNote({ change: 'place', place: '東南方', origin }), renderStabilityNote({ change: 'tier', from: '較適合', to: '不建議', origin }));
  }
  for (const s of strings.filter(Boolean)) assert.equal(scrubText(s), s, s);
  // 「保證」只出現在「不保證」
  for (const s of strings) assert.ok(!AFFIRMED_GUARANTEE.test(s), s);
});

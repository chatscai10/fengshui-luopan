// xuankong 格局與旺衰測試: xuankong_patterns.json 474 案(依附錄 B.3 修正,見 xuankong_patterns.changes.md)。
// 可算 436 案全過(polarity 24、yunpan 9、chart 31、pattern 72、patternList 36、heshi 24、qixing 48、parent3 16、
// qixing_fuyin 6、lianshu3 16、yin_assert 10、qi 81、chengmen 8、chengmen_use 31、wealth9 24);
// 資料向量 qi_classical 9、star_dict 9、pair_tag 20 依規格 2.4.9 更正版比對(spec 4.1)。
// confidence=low 走軟斷言(spec 4.2 第 2 點);軟斷言案例另有規則本身的硬斷言(計數、快照)補強。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture, isSoft, assertRunnerCatches } from './helpers/harness.js';
import {
  NUMS,
  palaceOf,
  numOf,
  planeByNum,
  oracleChart,
  oracleQiLabel,
  oracleQiScore,
  oracleChengmen,
} from './helpers/xuankong.js';
import * as xk from '../src/core/xuankong.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(path.join(here, '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');
const clone = (x) => JSON.parse(JSON.stringify(x));

const pat = loadFixture('xuankong_patterns');
const cat = (k) => pat.cases.filter((c) => c.category === k);
const soft = (c) => isSoft(c) || c.assertion === 'soft';
const hardOrSoft = (c, runner, softRunner) => (soft(c) ? softRunner(c) : runner(c));
const chartOf = (c) => xk.buildChart(c.input.yun, c.input.sit);
const sorted = (xs) => [...xs].sort((a, b) => a - b);

// ═══════════════════════════ A. runner ═══════════════════════════

function runPolarity(c) {
  const e = c.expected;
  const info = xk.mountainInfo(c.input.mountain);
  assert.equal(info.luoshu, e.palace, 'palace');
  assert.equal(info.palace, e.palaceName, 'palaceName');
  assert.equal(info.dragon, e.yuan, 'yuan');
  assert.equal(info.yinyang, e.yinyang, 'yinyang');
  assert.equal(info.forward, e.forward, 'forward');
}

function runYunpan(c) {
  const pan = xk.yunPan(c.input.yun);
  for (const n of NUMS) assert.equal(pan[palaceOf(n)], c.expected.pan[n], `運盤 ${palaceOf(n)}`);
}

/** 只核對 expected 有給的欄位(7 筆「來源前兩列」的 chart 缺 face、sitPalace 等,附錄 B.3 已在 meta 註明)。 */
function runChart(c) {
  const e = c.expected;
  const ch = chartOf(c);
  if (e.face !== undefined) assert.equal(ch.meta.face, e.face, 'face');
  if (e.sitPalace !== undefined) assert.equal(numOf(ch.sitPalace), e.sitPalace, 'sitPalace');
  if (e.facePalace !== undefined) assert.equal(numOf(ch.facePalace), e.facePalace, 'facePalace');
  if (e.shanCenter !== undefined) assert.equal(ch.shan.enter, e.shanCenter, 'shanCenter');
  if (e.xiangCenter !== undefined) assert.equal(ch.xiang.enter, e.xiangCenter, 'xiangCenter');
  if (e.shanForward !== undefined) assert.equal(ch.shan.forward, e.shanForward, 'shanForward');
  if (e.xiangForward !== undefined) assert.equal(ch.xiang.forward, e.xiangForward, 'xiangForward');
  assert.deepEqual(planeByNum(ch, 'shan'), e.shan, 'shan 平面');
  assert.deepEqual(planeByNum(ch, 'xiang'), e.xiang, 'xiang 平面');
  assert.equal(ch.pattern, e.pattern, 'pattern');
  if (e.rows) {
    for (const [row, cells] of Object.entries(e.rows)) {
      [...row].forEach((palace, i) => {
        const p = ch.palaces[palace];
        assert.equal(`${p.shan}${p.xiang}`, cells[i], `rows ${row}[${i}] ${palace}宮 山向`);
      });
    }
  }
}

function runPattern(c) {
  const ch = chartOf(c);
  assert.equal(ch.pattern, c.expected.pattern);
  assert.equal(xk.classifyChart(ch), c.expected.pattern);
}

function runPatternList(c) {
  assert.deepEqual(xk.listPatterns(c.input.yun)[c.input.pattern], c.expected.list);
}

function runHeshi(c) {
  assert.equal(xk.heshi(chartOf(c)), c.expected.type);
}

function runQixing(c) {
  const ch = chartOf(c);
  const q = xk.qixing(ch);
  assert.ok(q, '應為七星打劫');
  assert.equal(q.kind, c.expected.kind);
  assert.equal(q.group, c.expected.group);
  assert.equal(xk.classifyChart(ch), c.expected.pattern);
}

function runParent3(c) {
  const ch = chartOf(c);
  assert.equal(xk.parent3(ch), c.expected.parent3);
  assert.equal(ch.pattern, c.expected.pattern);
}

function runQixingFuyin(c) {
  const ch = chartOf(c);
  const fuyin = ch.wholePlate.shan === '伏吟' || ch.wholePlate.xiang === '伏吟';
  assert.equal(fuyin, c.expected.wholePlateFuyin);
  const q = xk.qixing(ch);
  assert.ok(q, '應為七星打劫');
  assert.equal(q.usable, !c.expected.wholePlateFuyin, '犯全局伏吟的打劫局不可用');
}

/** lianshu3 標 low(定義有爭議,只標記不計分): 軟斷言 = 不崩潰且回傳布林。 */
function softLianshu(c) {
  assert.equal(typeof xk.lianshu3(chartOf(c)), 'boolean');
}
function runLianshu(c) {
  assert.equal(xk.lianshu3(chartOf(c)), c.expected.lianshu3);
}

function runYinAssert(c) {
  const ch = chartOf(c);
  const i = c.input;
  if (i.check === 'wholePlate') {
    assert.equal(ch.wholePlate[i.plate], i.value);
    assert.equal(c.expected.holds, true);
    return;
  }
  const yin = xk.localYin(ch);
  const list = i.check === 'localFuyin' ? yin.fuyin : yin.fanyin;
  const hit = list.some((e) => e.palace === palaceOf(i.palace) && e.plate === i.plate && e.basis === i.basis);
  assert.equal(hit, c.expected.holds, `${i.check} ${i.palace}宮${i.plate}星(${i.basis})`);
}

/** qi 案例(B.3 後標 low): 軟斷言 = 不崩潰、回傳字串標籤與有限數字。 */
function softQi(c) {
  for (const s of ['default', 'S1', 'S2']) assert.equal(typeof xk.qiLabel(c.input.yun, c.input.star, s), 'string');
  assert.ok(Number.isFinite(xk.qiScore(c.input.yun, c.input.star)));
}
/** 工程值快照: 標籤與分數全對(值可調,調整時同步更新規格 2.4.8 與本測試)。 */
function runQi(c) {
  const { yun, star } = c.input;
  const e = c.expected;
  assert.equal(xk.qiLabel(yun, star, 'default'), e.default, 'default');
  assert.equal(xk.qiLabel(yun, star, 'S1'), e.S1, 'S1');
  assert.equal(xk.qiLabel(yun, star, 'S2'), e.S2, 'S2');
  assert.equal(xk.qiScore(yun, star), e.score, 'score');
}

function runChengmen(c) {
  const [main, sub] = xk.CHENGMEN[c.input.facePalace];
  assert.equal(main, c.expected.main);
  assert.equal(sub, c.expected.sub);
}

function runChengmenUse(c) {
  const ch = chartOf(c);
  const r = xk.chengmen(ch, c.input.yun);
  const n = c.input.palace;
  const item = r.main.luoshu === n ? r.main : r.sub.luoshu === n ? r.sub : null;
  assert.ok(item, `宮 ${n} 不是城門`);
  assert.equal(r.main.luoshu === n ? '正' : '副', c.expected.role, 'role');
  assert.equal(item.usable, c.expected.usable, 'usable');
}

const WEALTH_KEYS = { xiang9_at: ['xiang', 9], shan9_at: ['shan', 9], xiang1: ['xiang', 1], shan1: ['shan', 1], xiang2: ['xiang', 2], shan2: ['shan', 2], xiang8: ['xiang', 8], shan8: ['shan', 8] };
function runWealth9(c) {
  const ch = chartOf(c);
  assert.deepEqual(Object.keys(c.expected).sort(), Object.keys(WEALTH_KEYS).sort(), '欄位名(xiang9→xiang9_at、shan9→shan9_at,附錄 B.3)');
  const pos = xk.nineStarPositions(ch);
  assert.deepEqual(Object.keys(pos).sort(), Object.keys(WEALTH_KEYS).sort(), '程式輸出的欄位名也是 xiang9_at、shan9_at');
  for (const [k, [plate, star]] of Object.entries(WEALTH_KEYS)) {
    assert.deepEqual(sorted(pos[k].map(numOf)), sorted(c.expected[k]), k);
    assert.deepEqual(pos[k], xk.palacesWithStar(ch, plate, star), `${k} 與 palacesWithStar 一致`);
  }
}

function runStarDict(c) {
  const info = xk.STAR_INFO[c.input.star];
  for (const [k, v] of Object.entries(c.expected)) assert.equal(info[k], v, k);
}

function runPairTag(c) {
  const t = xk.pairTag(c.input.a, c.input.b);
  assert.ok(t, '應有此組合');
  assert.equal(t.tag, c.expected.tag, 'tag');
  assert.equal(t.nature, c.expected.nature, 'nature');
  assert.equal(t.confidence, c.confidence, 'confidence');
  assert.equal(xk.pairTag(c.input.b, c.input.a).key, t.key, '不分順序');
}

/** 傳統旺生衰死表(SINA-YISHAO,資料照錄、不規則): 用規則重算能確認的關係。 */
function runQiClassical(c) {
  const yun = c.input.yun;
  const e = c.expected;
  const stars = (s) => (s === '' ? [] : s.split(',').map(Number));
  const d = (s) => (((s - yun) % 9) + 9) % 9;
  assert.deepEqual(stars(e.wang), [yun], '旺 = 當運星');
  assert.ok(stars(e.sheng).every((s) => [1, 2].includes(d(s))), '生氣星 ⊂ 近旺、遠旺');
  assert.deepEqual(stars(e.shuai), [(yun + 7) % 9 + 1], '衰(退)= 剛過去的運');
  assert.ok(stars(e.si).every((s) => d(s) >= 3 && d(s) <= 7), '死氣星在 d=3..7');
  // 與預設五氣: 生氣星的標籤是近旺生/遠旺生,衰是退,死氣星是死或煞衰
  for (const s of stars(e.sheng)) assert.ok(['近旺生', '遠旺生'].includes(xk.qiLabel(yun, s)));
  for (const s of stars(e.shuai)) assert.equal(xk.qiLabel(yun, s), '退');
  for (const s of stars(e.si)) assert.ok(['死', '煞衰'].includes(xk.qiLabel(yun, s)));
}

// ═══════════════════════════ B. xuankong_patterns.json 474 案 ═══════════════════════════

describe('xuankong_patterns.json: 案數守門與附錄 B.3 修正', () => {
  it('474 案,各類數量與 meta.categoryCounts 一致', () => {
    assert.equal(pat.cases.length, 474);
    const counts = {};
    for (const c of pat.cases) counts[c.category] = (counts[c.category] ?? 0) + 1;
    assert.deepEqual(counts, pat.meta.categoryCounts);
  });
  it('B.3: qi 81 筆全標 low(工程值)、pair_tag 一六 medium/四四 存疑/五九 火生五黃/三九 刻薄', () => {
    assert.ok(cat('qi').every((c) => c.confidence === 'low' && /工程值/.test(c.note)));
    assert.equal(cat('qi').length, 81);
    const tag = (a, b) => cat('pair_tag').find((c) => c.input.a === a && c.input.b === b);
    assert.deepEqual([tag(1, 6).confidence, tag(1, 6).expected.nature], ['medium', '視旺衰']);
    assert.deepEqual([tag(4, 4).expected.nature, tag(4, 4).confidence], ['存疑', 'low']);
    assert.equal(tag(5, 9).expected.tag, '五九(火生五黃)');
    assert.match(tag(3, 9).expected.tag, /個性偏刻薄/);
    assert.ok(!cat('pair_tag').some((c) => c.expected.tag.includes('四四文昌') || c.expected.tag.includes('毒藥(不設爐灶)')));
  });
  it('B.3: chengmen_use 31 筆補單一作者註記、wealth9 改名 xiang9_at/shan9_at、chart 7 筆部分欄位在 meta 註明', () => {
    assert.equal(cat('chengmen_use').length, 31);
    assert.ok(cat('chengmen_use').every((c) => /單一作者簡化規則/.test(c.note) && /SINA-HESHI/.test(c.note)));
    assert.ok(cat('wealth9').every((c) => 'xiang9_at' in c.expected && 'shan9_at' in c.expected && !('xiang9' in c.expected)));
    const partial = cat('chart').filter((c) => c.expected.rows);
    assert.equal(partial.length, 7);
    assert.deepEqual(pat.meta.partialCharts.cases.sort(), partial.map((c) => c.name).sort());
    assert.ok(partial.every((c) => !('face' in c.expected) && !('sitPalace' in c.expected)));
  });
  it('lianshu3 16 案全標 low(軟斷言);其餘類別沒有 low 案例以外的軟斷言', () => {
    assert.ok(cat('lianshu3').every(soft));
    const lows = pat.cases.filter(soft).map((c) => c.category);
    assert.deepEqual([...new Set(lows)].sort(), ['lianshu3', 'pair_tag', 'qi']);
  });
});

describe('polarity: 24 山陰陽/元龍', () => {
  for (const c of cat('polarity')) it(c.name, () => runPolarity(c));
});
describe('yunpan: 運盤', () => {
  for (const c of cat('yunpan')) it(c.name, () => runYunpan(c));
});
describe('chart: 星盤(24 個九運下卦盤 + 7 個部分欄位)', () => {
  for (const c of cat('chart')) it(c.name, () => runChart(c));
});
describe('pattern: 24 山向 x 七八九運格局(72)', () => {
  for (const c of cat('pattern')) it(c.name, () => runPattern(c));
});
describe('patternList: 各運格局名單(36)', () => {
  for (const c of cat('patternList')) it(c.name, () => runPatternList(c));
});
describe('heshi / qixing / parent3 / qixing_fuyin / lianshu3', () => {
  for (const c of cat('heshi')) it(c.name, () => runHeshi(c));
  for (const c of cat('qixing')) it(c.name, () => runQixing(c));
  for (const c of cat('parent3')) it(c.name, () => runParent3(c));
  for (const c of cat('qixing_fuyin')) it(c.name, () => runQixingFuyin(c));
  for (const c of cat('lianshu3')) it(c.name, () => hardOrSoft(c, runLianshu, softLianshu));
});
describe('yin_assert: 全局與宮位伏吟反吟', () => {
  for (const c of cat('yin_assert')) it(c.name, () => runYinAssert(c));
});
describe('qi: 五氣 81 案(B.3 後標 low: 軟斷言 + 工程值快照)', () => {
  for (const c of cat('qi')) it(`${c.name} (軟)`, () => hardOrSoft(c, runQi, softQi));
  it('工程值快照: 81 案標籤(default/S1/S2)與分數全對', () => {
    assert.equal(cat('qi').length, 81);
    for (const c of cat('qi')) runQi(c);
  });
});
describe('chengmen / chengmen_use / wealth9 / star_dict / pair_tag / qi_classical', () => {
  for (const c of cat('chengmen')) it(c.name, () => runChengmen(c));
  for (const c of cat('chengmen_use')) it(c.name, () => runChengmenUse(c));
  for (const c of cat('wealth9')) it(c.name, () => runWealth9(c));
  for (const c of cat('star_dict')) it(c.name, () => runStarDict(c));
  for (const c of cat('pair_tag')) it(c.name, () => runPairTag(c));
  for (const c of cat('qi_classical')) it(c.name, () => runQiClassical(c));
});

// ═══════════════════════════ C. 突變測試(spec 4.2 第 3 點) ═══════════════════════════

describe('突變測試: 故意改錯期望值,runner 必須抓得出來', () => {
  const mut = (category, edit, runner, pick = () => true) => {
    const c = clone(cat(category).find(pick));
    edit(c);
    assertRunnerCatches(runner, c);
  };
  it('polarity / yunpan / chart', () => {
    mut('polarity', (c) => { c.expected.forward = !c.expected.forward; }, runPolarity);
    mut('polarity', (c) => { c.expected.yuan = '人'; }, runPolarity, (c) => c.expected.yuan !== '人');
    mut('yunpan', (c) => { c.expected.pan[1] = (c.expected.pan[1] % 9) + 1; }, runYunpan);
    mut('chart', (c) => { c.expected.shan[3] = (c.expected.shan[3] % 9) + 1; }, runChart);
    mut('chart', (c) => { c.expected.pattern = '上山下水'; }, runChart, (c) => c.expected.pattern !== '上山下水');
    mut('chart', (c) => { c.expected.rows['巽離坤'][0] = '00'; }, runChart, (c) => c.expected.rows);
  });
  it('pattern / patternList / heshi / qixing / parent3', () => {
    mut('pattern', (c) => { c.expected.pattern = c.expected.pattern === '旺山旺向' ? '雙星會向' : '旺山旺向'; }, runPattern);
    mut('patternList', (c) => { c.expected.list = [...c.expected.list].reverse().slice(1); }, runPatternList, (c) => c.expected.list.length > 2);
    mut('heshi', (c) => { c.expected.type = c.expected.type === '運山' ? '運向' : '運山'; }, runHeshi);
    mut('qixing', (c) => { c.expected.group = '000'; }, runQixing);
    mut('qixing', (c) => { c.expected.kind = c.expected.kind === '離宮打劫' ? '坎宮打劫' : '離宮打劫'; }, runQixing);
    mut('parent3', (c) => { c.expected.pattern = '旺山旺向'; }, runParent3);
    mut('qixing_fuyin', (c) => { c.expected.wholePlateFuyin = false; }, runQixingFuyin);
  });
  it('yin_assert / qi / chengmen / chengmen_use / wealth9 / star_dict / pair_tag', () => {
    mut('yin_assert', (c) => { c.input.value = c.input.value === '伏吟' ? '反吟' : '伏吟'; }, runYinAssert, (c) => c.input.check === 'wholePlate');
    mut('yin_assert', (c) => { c.input.palace = c.input.palace === 1 ? 2 : 1; }, runYinAssert, (c) => c.input.check === 'localFuyin');
    mut('qi', (c) => { c.expected.score += 1; }, runQi);
    mut('qi', (c) => { c.expected.S1 = '旺'; }, runQi, (c) => c.expected.S1 !== '旺');
    mut('chengmen', (c) => { c.expected.main += 1; }, runChengmen);
    mut('chengmen_use', (c) => { c.expected.usable = !c.expected.usable; }, runChengmenUse);
    mut('chengmen_use', (c) => { c.expected.role = c.expected.role === '正' ? '副' : '正'; }, runChengmenUse);
    mut('wealth9', (c) => { c.expected.xiang9_at = [...c.expected.xiang9_at, 5]; }, runWealth9);
    mut('wealth9', (c) => { c.expected.xiang9 = c.expected.xiang9_at; delete c.expected.xiang9_at; }, runWealth9);
    mut('star_dict', (c) => { c.expected.element = '金'; }, runStarDict, (c) => c.expected.element !== '金');
    mut('pair_tag', (c) => { c.expected.nature = '吉'; }, runPairTag, (c) => c.expected.nature !== '吉');
    mut('pair_tag', (c) => { c.expected.tag = '四四文昌'; }, runPairTag);
    mut('qi_classical', (c) => { c.expected.wang = '5'; }, runQiClassical, (c) => c.input.yun !== 5);
  });
  it('lianshu3 硬斷言 runner: 期望值被改錯時抓得出(軟斷言案例只跑軟 runner,所以另證 runLianshu)', () => {
    const c = clone(cat('lianshu3')[0]);
    c.expected.lianshu3 = false;
    assertRunnerCatches(runLianshu, c);
    assert.doesNotThrow(() => softLianshu(c));
  });
});

// ═══════════════════════════ D. 資料表 == 規格文字 == 規則重算 ═══════════════════════════

/** 取規格某個標題之後的第一個 ```json 區塊。 */
function specJson(heading) {
  const pos = SPEC_TEXT.indexOf(heading);
  assert.ok(pos >= 0, `規格找不到 ${heading}`);
  const fence = SPEC_TEXT.indexOf('```json', pos);
  const end = SPEC_TEXT.indexOf('```', fence + 7);
  return JSON.parse(SPEC_TEXT.slice(fence + 7, end));
}

describe('資料表 == 規格文字 == 規則重算', () => {
  it('PAIR_TAGS == 規格 2.4.9 更正版(20 組,逐欄)', () => {
    const spec = specJson('#### 2.4.9 星組合表');
    assert.equal(Object.keys(spec).length, 20);
    assert.deepEqual(clone(xk.PAIR_TAGS), spec);
  });
  it('PAIR_TAGS == fixtures pair_tag(更正後,20/20)', () => {
    assert.equal(cat('pair_tag').length, 20);
    for (const c of cat('pair_tag')) {
      const key = `${Math.min(c.input.a, c.input.b)}-${Math.max(c.input.a, c.input.b)}`;
      assert.equal(xk.PAIR_TAGS[key].tag, c.expected.tag, key);
    }
  });
  it('一六與四四不當文昌位;文昌位只採一四(high)與三九(low)', () => {
    assert.deepEqual({ ...xk.WENCHANG_KEYS }, { '1-4': 'high', '3-9': 'low' });
    assert.equal(xk.PAIR_TAGS['1-6'].wenchang, false);
    assert.equal(xk.PAIR_TAGS['4-4'].wenchang, false);
    assert.equal(xk.PAIR_TAGS['1-4'].confidence, 'high');
    assert.equal(xk.PAIR_TAGS['3-9'].confidence, 'low');
  });
  it('STAR_INFO == 九星資料(fixtures star_dict 9/9);陰陽星 2、4、7、9 為陰,1、3、6、8 為陽', () => {
    assert.equal(cat('star_dict').length, 9);
    for (let s = 1; s <= 9; s += 1) {
      assert.equal(xk.STAR_INFO[s].trigram, s === 5 ? '中' : palaceOf(s), `${s} 本宮卦`);
      if (s !== 5) assert.equal(xk.STAR_INFO[s].yinyang, [2, 4, 7, 9].includes(s) ? '陰' : '陽');
    }
  });
  it('五氣: 三套標籤表與分數表 == 距離規則重算(獨立寫法),9 運 x 9 星 x 3 套', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (let star = 1; star <= 9; star += 1) {
        for (const scheme of ['default', 'S1', 'S2']) assert.equal(xk.qiLabel(yun, star, scheme), oracleQiLabel(yun, star, scheme), `${yun}運${star}星 ${scheme}`);
        assert.equal(xk.qiScore(yun, star), oracleQiScore(yun, star), `${yun}運${star}星 分數`);
        assert.equal(xk.qiScore(yun, star, { eightKeepsWealth: true }), oracleQiScore(yun, star, { eightKeepsWealth: true }));
      }
    }
  });
  it('五氣: default 與 S1、S2 對 d=0/1/2/8 一致(旺、生氣類、退),分歧只在 d=3..7', () => {
    for (let d = 0; d < 9; d += 1) {
      const yun = 1;
      const star = ((yun - 1 + d) % 9) + 1;
      const L = ['default', 'S1', 'S2'].map((s) => xk.qiLabel(yun, star, s));
      if (d === 0) assert.deepEqual(L, ['旺', '旺', '旺']);
      if (d === 8) assert.deepEqual(L, ['退', '退', '退']);
      if (d === 1) assert.ok(L[0] === '近旺生' && ['進', '生'].includes(L[1]) && ['進', '生'].includes(L[2]));
      if (d === 2) assert.ok(L[0] === '遠旺生' && ['進', '生'].includes(L[1]) && ['進', '生'].includes(L[2]));
    }
  });
  it('五氣上限: 5 黃在非五運 <= -3、2 黑在非二運 <= +0.5;五運與二運當令仍是 +3', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      if (yun !== 5) assert.ok(xk.qiScore(yun, 5) <= -3, `${yun}運 5 黃`);
      if (yun !== 2) assert.ok(xk.qiScore(yun, 2) <= 0.5, `${yun}運 2 黑`);
    }
    assert.equal(xk.qiScore(5, 5), 3);
    assert.equal(xk.qiScore(2, 2), 3);
  });
  it('八白退氣(D28): 預設 0 分;eightKeepsWealth 才改 +1;開關只影響八白', () => {
    assert.equal(xk.qiScore(9, 8), 0);
    assert.equal(xk.qiScore(9, 8, { eightKeepsWealth: true }), 1);
    for (let star = 1; star <= 9; star += 1) if (star !== 8) assert.equal(xk.qiScore(9, star, { eightKeepsWealth: true }), xk.qiScore(9, star));
    assert.equal(xk.qiScore(8, 8, { eightKeepsWealth: true }), 3, '當令的八白不受影響');
  });
  it('二五交加: 二運、五運不扣,九運照扣(D36);視旺衰與存疑不扣;吉 +0.5', () => {
    const t25 = xk.pairTag(2, 5);
    assert.equal(xk.pairAdjust(t25, 2), 0);
    assert.equal(xk.pairAdjust(t25, 5), 0);
    assert.equal(xk.pairAdjust(t25, 9), -1);
    assert.equal(xk.pairAdjust(xk.pairTag(3, 7), 3), -1);
    assert.equal(xk.pairAdjust(xk.pairTag(6, 9), 9), 0);
    assert.equal(xk.pairAdjust(xk.pairTag(4, 4), 9), 0);
    assert.equal(xk.pairAdjust(xk.pairTag(1, 4), 9), 0.5);
    assert.equal(xk.pairTag(1, 2), null);
  });
  it('pairTag: 回傳副本,改動它不影響內嵌表', () => {
    const t = xk.pairTag(3, 7);
    t.alias.push('x');
    t.tag = 'x';
    assert.equal(xk.PAIR_TAGS['3-7'].alias.length, 2);
    assert.equal(xk.PAIR_TAGS['3-7'].tag, '三七蚩尤煞');
    assert.throws(() => { xk.PAIR_TAGS['3-7'].tag = 'y'; });
  });
  it('城門: 由河圖生成數規則重算(oracle)== 內嵌表;可用性只看向星屬 N、N+1、N+2', () => {
    for (const face of [1, 2, 3, 4, 6, 7, 8, 9]) assert.deepEqual([...xk.CHENGMEN[face]], oracleChengmen(face), `向宮 ${face}`);
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        const r = xk.chengmen(ch, yun);
        assert.equal(r.facePalace, ch.facePalace);
        for (const g of [r.main, r.sub]) {
          const star = ch.palaces[g.palace].xiang;
          assert.equal(g.usable, [0, 1, 2].includes(((star - yun) % 9 + 9) % 9), `${yun}運${sit} ${g.palace} 向星 ${star}`);
        }
      }
    }
  });
});

// ═══════════════════════════ E. 特殊格局清單與名單(規格 2.4.5、2.4.6,研究報告 2.5、2.7) ═══════════════════════════

describe('特殊格局名單 == 研究報告 2.7 的公開名單', () => {
  const REPORT_TEXT = readFileSync(path.join(here, '..', 'docs', 'research', 'xuankong_patterns.md'), 'utf8');
  const fromReport = (heading) => {
    const start = REPORT_TEXT.indexOf(heading);
    assert.ok(start >= 0, `研究報告找不到 ${heading}`);
    const end = REPORT_TEXT.indexOf('\n**', start + heading.length);
    return REPORT_TEXT.slice(start, end < 0 ? undefined : end);
  };
  it('七星打劫: 離宮 24 局與坎宮 24 局逐項相同(SINA-3BAN 名單)', () => {
    const zh = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };
    for (const [heading, kind] of [['**七星打劫:離宮打劫(真', '離宮打劫'], ['**七星打劫:坎宮打劫(假', '坎宮打劫']]) {
      const block = fromReport(heading);
      const expected = new Set();
      for (const m of block.matchAll(/- (.)山(.)向[:：]([^\n]+)/g)) {
        for (const r of m[3].matchAll(/(\d)運[(（]([一二三四五六七八九]+)[)）]/g)) expected.add(`${r[1]}|${m[1]}|${r[2]}`);
      }
      assert.equal(expected.size, 24, `${kind} 名單解析數`);
      const got = new Set();
      for (let yun = 1; yun <= 9; yun += 1) {
        for (const [sit] of xk.RING) {
          const q = xk.qixing(xk.buildChart(yun, sit));
          if (q && q.kind === kind) got.add(`${yun}|${sit}|${[...q.group].map((x) => zh[x]).join('')}`);
        }
      }
      assert.deepEqual([...got].sort(), [...expected].sort(), kind);
    }
  });
  it('全局合十 24 局: 12 個山向 x 兩運 == 名單集合', () => {
    const block = fromReport('**全局合十(24 局');
    const expected = new Set();
    for (const m of block.matchAll(/\| (.)山(.)向 \| (\d) \| 運[山向]合十 \| (.)山(.)向 \| (\d) \| 運[山向]合十 \|/g)) {
      expected.add(`${m[3]}|${m[1]}`);
      expected.add(`${m[6]}|${m[4]}`);
    }
    assert.equal(expected.size, 24);
    const got = new Set();
    for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of xk.RING) if (xk.heshi(xk.buildChart(yun, sit))) got.add(`${yun}|${sit}`);
    assert.deepEqual([...got].sort(), [...expected].sort());
  });
  it('三般巧卦 16 局(艮坤寅申 二五八運、丑未 四六運)與連數三般卦 16 局名單', () => {
    const p3 = new Set();
    const l3 = new Set();
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        if (xk.parent3(ch)) p3.add(`${yun}|${sit}`);
        if (xk.lianshu3(ch)) l3.add(`${yun}|${sit}`);
      }
    }
    const exp3 = [];
    for (const sit of ['艮', '坤', '寅', '申']) for (const y of [2, 5, 8]) exp3.push(`${y}|${sit}`);
    for (const sit of ['丑', '未']) for (const y of [4, 6]) exp3.push(`${y}|${sit}`);
    assert.deepEqual([...p3].sort(), exp3.sort());
    const expL = [];
    for (const [y, sits] of [[2, '辰戌'], [3, '巽巳乾亥'], [5, '巽巳乾亥'], [7, '巽巳乾亥'], [8, '辰戌']]) for (const sit of sits) expL.push(`${y}|${sit}`);
    assert.deepEqual([...l3].sort(), expL.sort());
  });
  it('打劫犯全局伏吟不可用 6 局: 巽山乾向六運、巳山亥向六運、壬山丙向九運、丙山壬向一運、乾山巽向四運、亥山巳向四運', () => {
    const bad = [];
    for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of xk.RING) {
      const q = xk.qixing(xk.buildChart(yun, sit));
      if (q && !q.usable) bad.push(`${yun}|${sit}`);
    }
    assert.deepEqual(bad.sort(), ['1|丙', '4|乾', '4|亥', '6|巳', '6|巽', '9|壬']);
  });
  it('另 6 局打劫犯全局反吟: 來源清單未列,只警示(wholePlateFanyin,usable 仍為 true)', () => {
    const fan = [];
    for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of xk.RING) {
      const q = xk.qixing(xk.buildChart(yun, sit));
      if (q && q.wholePlateFanyin) {
        assert.equal(q.usable, true);
        fan.push(`${yun}|${sit}`);
      }
    }
    assert.deepEqual(fan.sort(), ['1|子', '1|癸', '4|辰', '6|戌', '9|午', '9|丁'].sort());
  });
  it('七八九運全局伏吟反吟名單(研究報告 2.5)', () => {
    const tag = (yun) => {
      const out = { 山伏: [], 向伏: [], 山反: [], 向反: [] };
      for (const [sit] of xk.RING) {
        const w = xk.buildChart(yun, sit).wholePlate;
        if (w.shan === '伏吟') out.山伏.push(sit);
        if (w.xiang === '伏吟') out.向伏.push(sit);
        if (w.shan === '反吟') out.山反.push(sit);
        if (w.xiang === '反吟') out.向反.push(sit);
      }
      return out;
    };
    assert.deepEqual(tag(7), { 山伏: ['甲'], 向伏: ['庚'], 山反: ['卯', '乙'], 向反: ['酉', '辛'] });
    assert.deepEqual(tag(8), { 山伏: ['坤', '申'], 向伏: ['艮', '寅'], 山反: ['未'], 向反: ['丑'] });
    assert.deepEqual(tag(9), { 山伏: ['壬'], 向伏: ['丙'], 山反: ['子', '癸'], 向反: ['午', '丁'] });
  });
  it('九運 24 山向都是山星 9 與向星 9 同宮;雙星會向 12 個與規格 2.4.5 名單相同', () => {
    const xiang = [];
    for (const [sit] of xk.RING) {
      const ch = xk.buildChart(9, sit);
      assert.deepEqual(xk.palacesWithStar(ch, 'shan', 9), xk.palacesWithStar(ch, 'xiang', 9), sit);
      if (ch.pattern === '雙星會向') xiang.push(`${sit}${ch.meta.face}`);
    }
    const spec = ['壬丙', '丑未', '甲庚', '巽乾', '巳亥', '午子', '丁癸', '坤艮', '申寅', '酉卯', '辛乙', '戌辰'];
    assert.deepEqual(xiang.sort(), spec.sort());
  });
  it('局部伏吟反吟: 旺星不扣、衰死扣(penalized 只標衰死星)', () => {
    const ch = xk.buildChart(7, '卯');
    const yin = xk.localYin(ch, { penalizedWhen: (s) => xk.qiScore(7, s) < 0 });
    for (const e of [...yin.fuyin, ...yin.fanyin]) assert.equal(e.penalized, xk.qiScore(7, e.star) < 0);
    assert.ok(yin.fuyin.length > 0);
    assert.equal(xk.localYin(ch).fuyin[0].penalized, undefined, '沒給 penalizedWhen 時不帶 penalized');
  });
});

// ═══════════════════════════ F. 房間用途與位置細節 ═══════════════════════════

describe('roomAdvice(D37,全部推論)', () => {
  it('回傳六種房間,宮位都是非中宮;避開規則對得上星', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      const ch = xk.buildChart(yun, '子');
      const rooms = xk.roomAdvice(ch, 9);
      assert.deepEqual(rooms.map((r) => r.room), ['bedroom', 'living', 'kitchen', 'bathroom', 'study', 'desk']);
      for (const r of rooms) {
        assert.ok(r.prefer.every((p) => p !== '中' && xk.PALACES.includes(p)));
        assert.ok(r.avoid.every((p) => p !== '中' && xk.PALACES.includes(p)));
        assert.equal(typeof r.rule, 'string');
      }
      const bed = rooms[0];
      for (const p of bed.prefer) {
        const c = ch.palaces[p];
        assert.ok(![c.shan, c.xiang].some((s) => (s === 5 || s === 2) && s !== 9), `臥室不該選 ${p}`);
      }
      const kitchen = rooms[2];
      for (const p of kitchen.avoid) {
        const c = ch.palaces[p];
        const stars = [c.shan, c.xiang, c.yun];
        assert.ok((stars.includes(5) && stars.includes(9)) || (stars.includes(2) && stars.includes(5)), `廚房避開 ${p}`);
      }
    }
  });
  it('書房只推一四與三九,不推一六與四四;避開三七、六七', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        const study = xk.roomAdvice(ch, 9).find((r) => r.room === 'study');
        for (const p of study.prefer) {
          const keys = xk.pairTagsOfPalace(ch, p).map((t) => t.key);
          assert.ok(keys.includes('1-4') || keys.includes('3-9'), `${yun}${sit} ${p}`);
        }
      }
    }
  });
  it('roomAdvice 對 currentYun 錯誤丟 INVALID_YUN', () => {
    assert.throws(() => xk.roomAdvice(xk.buildChart(9, '子'), 0), /^Error: INVALID_YUN/);
  });
});

describe('qiByPalace / wealthDingPositions 錯誤與邊界', () => {
  it('qiLabel / qiScore 錯誤碼', () => {
    const codes = (fn) => assert.throws(fn, (e) => /^(INVALID_YUN|INVALID_STAR|INVALID_OPTION):/.test(e.message));
    codes(() => xk.qiLabel(0, 1));
    codes(() => xk.qiLabel(9, 0));
    codes(() => xk.qiLabel(9, 1, 'S3'));
    codes(() => xk.qiScore(9, 10));
    codes(() => xk.wealthDingPositions(xk.buildChart(9, '子'), 10));
    codes(() => xk.pairTag(0, 1));
  });
  it('全部 216 盤 x 各 currentYun: 候選不含 d>2 的宮、side 與 kind 對應、adjustedScore 只在 back 減半', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        for (const cy of [yun, 9]) {
          const { wealth, ding } = xk.wealthDingPositions(ch, cy);
          for (const r of wealth) {
            assert.ok(xk.qiDist(cy, ch.palaces[r.palace].xiang) <= 2);
            assert.equal(r.side, r.palace === ch.facePalace ? 'front' : r.palace === ch.sitPalace ? 'back' : 'other');
            assert.equal(r.kind, { front: 'wangcai', back: 'back', other: 'ciwei' }[r.side]);
            assert.equal(r.adjustedScore, r.side === 'back' ? r.score * 0.5 : r.score);
          }
          for (const r of ding) {
            assert.ok(xk.qiDist(cy, ch.palaces[r.palace].shan) <= 2);
            assert.equal(r.kind, { back: 'wangding', front: 'front', other: 'ciwei' }[r.side]);
          }
        }
      }
    }
  });
  it('雙星會向的前方旺財位、雙星會坐的坐宮不列旺財位: 216 盤全部一致', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        const { wealth } = xk.wealthDingPositions(ch, yun);
        const nInFace = ch.palaces[ch.facePalace].xiang === yun;
        assert.equal(wealth.some((r) => r.kind === 'wangcai' && r.star === yun), nInFace, `${yun}${sit}`);
        if (ch.palaces[ch.sitPalace].xiang === yun) {
          assert.ok(wealth.some((r) => r.kind === 'back' && r.palace === ch.sitPalace && r.tier === 'wang'), `${yun}${sit}`);
          assert.ok(!wealth.some((r) => r.kind === 'wangcai' && r.palace === ch.sitPalace));
        }
      }
    }
  });
  it('nineStarPositions 對全部 216 盤(不只九運: 九運的雙九同宮會讓山向欄位無法區分)== 獨立 oracle', () => {
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [sit] of xk.RING) {
        const ch = xk.buildChart(yun, sit);
        const o = oracleChart(yun, sit);
        const pos = xk.nineStarPositions(ch);
        for (const [k, [plate, star]] of Object.entries(WEALTH_KEYS)) {
          assert.deepEqual(sorted(pos[k].map(numOf)), NUMS.filter((n) => o.cells[n][plate] === star), `${yun}運${sit} ${k}`);
        }
      }
    }
    // 山星 9 與向星 9 不同宮的盤確實存在(一運到八運),證明上面的比對有區別力
    const split = [];
    for (let yun = 1; yun <= 8; yun += 1) for (const [sit] of xk.RING) {
      const p = xk.nineStarPositions(xk.buildChart(yun, sit));
      if (p.xiang9_at[0] !== p.shan9_at[0]) split.push(`${yun}${sit}`);
    }
    assert.ok(split.length > 100, `山向 9 不同宮的盤只有 ${split.length}`);
  });
  it('oracle 排出的盤與 wealth9 欄位一致(獨立驗證 palacesWithStar)', () => {
    for (const c of cat('wealth9')) {
      const o = oracleChart(c.input.yun, c.input.sit);
      const at = (plate, star) => NUMS.filter((n) => o.cells[n][plate] === star);
      assert.deepEqual(at('xiang', 9), sorted(c.expected.xiang9_at));
      assert.deepEqual(at('shan', 9), sorted(c.expected.shan9_at));
    }
  });
});

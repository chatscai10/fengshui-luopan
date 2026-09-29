// xuankong 核心測試: xuankong_core.json 568 案(依附錄 B.3 修正,見 xuankong_core.changes.md)、
// 規格內嵌資料表「規則重算 == 內嵌表」(spec 4.2 第 6 點)、spec 4.4 屬性測試、突變測試、analyzeXuankong 整合。
// 硬斷言 / 軟斷言依 spec 4.1、4.2: confidence=low 或案例標 assertion:'soft' 走軟斷言。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture, isSoft, assertRunnerCatches } from './helpers/harness.js';
import {
  NUMS,
  palaceOf,
  cellsByNum,
  planeByNum,
  oracleChart,
  oracleForwardByParity,
  oracleMate,
  oraclePattern,
  ORACLE_RING,
  parseTiVerseA,
  parseTiDigitText,
} from './helpers/xuankong.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as geo from '../src/core/geo.js';
import { toInstant } from '../src/core/calendar.js';
import * as xk from '../src/core/xuankong.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(path.join(here, '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const utc = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

/** 取規格某個小節標題之後的第 n 個 ```json 區塊並解析。找不到就讓測試失敗,不悄悄略過。 */
function specJsonBlock(heading, n = 1) {
  let pos = SPEC_TEXT.indexOf(heading);
  assert.ok(pos >= 0, `規格找不到標題 ${heading}`);
  let block = null;
  for (let k = 0; k < n; k += 1) {
    const fence = SPEC_TEXT.indexOf('```json', pos);
    assert.ok(fence >= 0, `${heading} 之後沒有第 ${k + 1} 個 json 區塊`);
    const end = SPEC_TEXT.indexOf('```', fence + 7);
    block = SPEC_TEXT.slice(fence + 7, end);
    pos = end + 3;
  }
  return JSON.parse(block);
}

const core = loadFixture('xuankong_core');
const ofType = (t) => core.cases.filter((c) => c.type === t);
const soft = (c) => isSoft(c) || c.assertion === 'soft';

/** 硬斷言走 runner;軟斷言走 softRunner(只要求不崩潰與旗標)。 */
const hardOrSoft = (c, runner, softRunner) => (soft(c) ? softRunner(c) : runner(c));

// ═══════════════════════════ A. runner ═══════════════════════════

function runChartXia(c) {
  const e = c.expected;
  const ch = xk.buildChart(c.input.yun, c.input.sit);
  assert.equal(ch.meta.face, e.face, 'face');
  assert.equal(ch.shan.enter, e.shan_center, 'shan_center');
  assert.equal(ch.xiang.enter, e.xiang_center, 'xiang_center');
  assert.equal(ch.shan.forward, e.shan_forward, 'shan_forward');
  assert.equal(ch.xiang.forward, e.xiang_forward, 'xiang_forward');
  assert.equal(ch.shan.mate, e.shan_mate, 'shan_mate');
  assert.equal(ch.xiang.mate, e.xiang_mate, 'xiang_mate');
  assert.equal(ch.pattern, e.pattern, 'pattern');
  assert.deepEqual(cellsByNum(ch), e.cells, 'cells');
}

function runChartTi(c) {
  const e = c.expected;
  const ch = xk.buildChart(c.input.yun, c.input.sit, { ti: true, tiTable: 'A' });
  assert.equal(ch.meta.face, e.face, 'face');
  assert.equal(ch.shan.enter, e.shan_center, 'shan_center(替後入中數)');
  assert.equal(ch.xiang.enter, e.xiang_center, 'xiang_center(替後入中數)');
  assert.equal(ch.shan.star, e.shan_center_original, 'shan_center_original');
  assert.equal(ch.xiang.star, e.xiang_center_original, 'xiang_center_original');
  assert.equal(ch.shan.forward, e.shan_forward, '順逆看原伴山');
  assert.equal(ch.xiang.forward, e.xiang_forward, '順逆看原伴山');
  assert.equal(ch.shan.mate, e.shan_mate, 'shan_mate');
  assert.equal(ch.xiang.mate, e.xiang_mate, 'xiang_mate');
  assert.deepEqual(cellsByNum(ch), e.cells, 'cells');
  const xia = xk.buildChart(c.input.yun, c.input.sit);
  assert.equal(JSON.stringify(ch.palaces) === JSON.stringify(xia.palaces), e.same_as_xia, 'same_as_xia');
}

function runFromFacing(c) {
  const e = c.expected;
  const loc = xk.locateFacing(c.input.facing_deg);
  assert.equal(loc.sit, e.sit, 'sit');
  assert.equal(loc.mountain, e.face, 'face(向山)');
  assert.equal(loc.zone, e.zone, 'zone');
  assert.equal(loc.side, e.side, 'side');
  assert.equal(loc.neighbor, e.neighbor, 'neighbor');
  assert.equal(loc.kind, e.kind, 'kind');
  assert.equal(c.input.auto_ti && loc.needTi, e.use_ti, 'use_ti');
  const ch = xk.buildChart(c.input.yun, loc.sit, { ti: c.input.auto_ti && loc.needTi });
  assert.deepEqual(cellsByNum(ch), e.cells, 'cells');
  // 整條流程(analyzeXuankong,使用者開替卦)必須給出同一張盤。
  const a = xk.analyzeXuankong(
    { facing: c.input.facing_deg, chartYun: c.input.yun, currentYun: c.input.yun },
    { useTiGua: true },
  );
  assert.deepEqual(cellsByNum(a.chart), e.cells, 'analyzeXuankong cells');
  assert.equal(a.chart.meta.ti, e.use_ti, 'analyzeXuankong ti');
}

function runLocate(c) {
  const e = c.expected;
  const loc = xk.locateFacing(c.input.deg);
  assert.equal(loc.mountain, e.mountain, 'mountain');
  assert.equal(loc.zone, e.zone, 'zone');
  assert.equal(loc.needTi, e.need_ti, 'need_ti');
  if (e.zone === 'jian') {
    assert.equal(loc.side, e.side, 'side');
    assert.equal(loc.neighbor, e.neighbor, 'neighbor');
    assert.equal(loc.kind, e.kind, 'kind');
  } else {
    assert.equal(loc.side, null);
    assert.equal(loc.neighbor, null);
    assert.equal(loc.kind, null);
  }
}

/** locate_edge_*: 端點慣例分歧,只要求不崩潰並帶騎線旗標(spec 2.4.3 第 5 點、4.1)。 */
function softLocate(c) {
  const loc = xk.locateFacing(c.input.deg);
  assert.equal(loc.ridingLine, true, `${c.name} 應帶騎線旗標`);
  assert.equal(typeof loc.needTi, 'boolean');
  assert.ok(['xia', 'jian'].includes(loc.zone));
}

function runYunPan(c) {
  const pan = xk.yunPan(c.input.yun);
  for (const n of NUMS) assert.equal(pan[palaceOf(n)], c.expected.cells[n], `運盤 ${palaceOf(n)}`);
}

function runDirection(c) {
  const e = c.expected;
  const ch = xk.buildChart(c.input.yun, c.input.sit);
  const part = ch[c.input.which];
  assert.equal(part.star, e.star, 'star');
  assert.equal(part.mate, e.mate, 'mate');
  assert.equal(part.forward, e.forward, 'forward');
  const mountain = c.input.which === 'shan' ? ch.meta.sit : ch.meta.face;
  const d = xk.direction(e.star, mountain);
  assert.deepEqual(d, { mate: e.mate, forward: e.forward });
  // 獨立寫法: 奇偶簡式與二次轉換的伴山
  assert.equal(oracleForwardByParity(e.star, mountain), e.forward, '奇偶簡式');
  assert.equal(oracleMate(e.star, mountain), e.mate, 'oracle 伴山');
  if (e.mate_by_yun_star_palace !== undefined) {
    // 5 入中的另一寫法: 取運盤中宮運星(=當運數)所在卦宮內、與該山同元龍的山,陰陽必相同
    const alt = xk.RING.find(([n, pal, dr]) => pal === c.input.yun && dr === xk.RING.find((r) => r[0] === mountain)[2])[0];
    assert.equal(alt, e.mate_by_yun_star_palace);
    assert.equal(xk.mountainInfo(alt).forward, e.forward, '兩種 5 入中取法順逆相同');
  }
}

function runPattern(c) {
  const ch = xk.buildChart(c.input.yun, c.input.sit);
  assert.equal(ch.pattern, c.expected.pattern);
  assert.equal(xk.classifyChart(ch), c.expected.pattern, '星數條件也成立');
}

function runOldEngine(c) {
  const ch = xk.buildChart(c.input.yun, c.input.sit);
  const got = cellsByNum(ch);
  assert.deepEqual(got, c.expected.cells, 'cells');
  // 新實作不得重現舊引擎的錯誤輸出(spec 4.2 第 4 點)
  assert.notDeepEqual(got, c.expected.old_engine_cells, '不應等於舊引擎輸出');
  const same = (a, b) => a.shan === b.shan && a.yun === b.yun && a.xiang === b.xiang;
  const differs = NUMS.filter((n) => !same(got[n], c.expected.old_engine_cells[n]));
  assert.deepEqual(differs, c.expected.differs_at_palaces, 'differs_at_palaces');
}

function runTable24(c) {
  const rows = c.expected.rows;
  assert.equal(rows.length, 24);
  const yang = [];
  const yin = [];
  rows.forEach((r, i) => {
    const [name, palace, yuan] = xk.RING[i];
    assert.equal(name, r.name, `第 ${i} 山名`);
    assert.equal(palace, r.palace, `${name} 宮`);
    assert.equal(yuan, r.yuan, `${name} 元龍`);
    const info = xk.mountainInfo(name);
    assert.equal(info.palace, r.palace_name, `${name} 卦名`);
    assert.equal(info.forward, r.yang, `${name} 陰陽`);
    assert.equal(xk.RING[(i + 12) % 24][0], r.opposite, `${name} 對山`);
    assert.equal(xk.TI_TABLES.A[name], r.ti_star_A, `${name} 替星 A`);
    assert.equal(xk.TI_TABLES.B[name], r.ti_star_B, `${name} 替星 B`);
    (r.yang ? yang : yin).push(name);
  });
  assert.deepEqual([...yang].sort(), [...c.expected.yang].sort());
  assert.deepEqual([...yin].sort(), [...c.expected.yin].sort());
}

function runTableTiStar(c) {
  assert.deepEqual({ ...xk.TI_TABLES.A }, c.expected.A);
  assert.deepEqual({ ...xk.TI_TABLES.B }, c.expected.B);
  // 由口訣文字獨立重算
  assert.deepEqual(parseTiVerseA(), c.expected.A, 'A 表 == 口訣');
  const bText = c.expected.B_note.split(/[:：]/).pop();
  assert.deepEqual(parseTiDigitText(bText), c.expected.B, 'B 表 == 口訣');
}

// ═══════════════════════════ B. xuankong_core.json 568 案 ═══════════════════════════

describe('xuankong_core.json: 案數守門', () => {
  it('568 案,各類數量與 meta 一致', () => {
    assert.equal(core.cases.length, 568);
    const counts = {};
    for (const c of core.cases) counts[c.type] = (counts[c.type] ?? 0) + 1;
    assert.deepEqual(counts, {
      chart_xia: 216, chart_ti: 216, chart_from_facing_degree: 10, locate_degree: 75, yun_of_datetime: 22,
      yun_pan: 9, direction_rule: 9, old_engine_regression: 3, table: 2, pattern: 6,
    });
  });
  it('3 個 locate_edge_* 標軟斷言(附錄 B.3),其餘 locate_degree 72 案硬斷言', () => {
    const cs = ofType('locate_degree');
    assert.equal(cs.filter(soft).length, 3);
    assert.deepEqual(cs.filter(soft).map((c) => c.name).sort(), ['locate_edge_340.5', 'locate_edge_349.5', 'locate_edge_352.5']);
    assert.equal(cs.filter((c) => !soft(c)).length, 72);
  });
  it('chart_xia 全為 high(硬斷言);chart_ti 為 medium/high(硬斷言,只有 low 才軟)', () => {
    assert.ok(ofType('chart_xia').every((c) => c.confidence === 'high' && !soft(c)));
    assert.ok(ofType('chart_ti').every((c) => !soft(c)));
  });
});

describe('chart_xia: 216 個下卦盤(Wikibooks 全部 9 運 x 24 山)', () => {
  for (const c of ofType('chart_xia')) it(c.name, () => runChartXia(c));
});
describe('chart_ti: 216 個替卦盤(A 表,順逆看原伴山)', () => {
  for (const c of ofType('chart_ti')) it(c.name, () => runChartTi(c));
});
describe('chart_from_facing_degree: 書中 10 個兼向題', () => {
  for (const c of ofType('chart_from_facing_degree')) it(c.name, () => runFromFacing(c));
});
describe('locate_degree: 75 案(72 硬 + 3 軟)', () => {
  for (const c of ofType('locate_degree')) it(c.name, () => hardOrSoft(c, runLocate, softLocate));
});
describe('yun_pan / direction_rule / pattern / old_engine_regression / table', () => {
  for (const c of ofType('yun_pan')) it(c.name, () => runYunPan(c));
  for (const c of ofType('direction_rule')) it(c.name, () => runDirection(c));
  for (const c of ofType('pattern')) it(c.name, () => runPattern(c));
  for (const c of ofType('old_engine_regression')) it(c.name, () => runOldEngine(c));
  it('table_24_mountains: RING(由 geo 生成)== 24 山總表', () => runTable24(core.cases.find((c) => c.name === 'table_24_mountains')));
  it('table_ti_star: 替星 A/B 表 == fixtures == 口訣重算', () => runTableTiStar(core.cases.find((c) => c.name === 'table_ti_star')));
});

describe('yun_of_datetime: 22 案經 resolveYuns 的 chartYun 與 currentYun', () => {
  for (const c of ofType('yun_of_datetime')) {
    it(c.name, () => {
      const ms = toInstant({ local: c.input.datetime_cst, utcOffset: '+08:00' });
      const r = xk.resolveYuns({ builtAt: ms, now: ms });
      assert.equal(r.chartYun, c.expected.yun, 'chartYun');
      assert.equal(r.currentYun, c.expected.yun, 'currentYun');
      assert.equal(r.differs, false);
      assert.equal(r.basis, 'built');
    });
  }
});

// ═══════════════════════════ C. 突變測試(spec 4.2 第 3 點) ═══════════════════════════

describe('突變測試: 故意改錯期望值,runner 必須抓得出來', () => {
  const first = (t, pred = () => true) => ofType(t).find(pred);
  const cellsBad = (c) => {
    const b = clone(c);
    b.expected.cells[1].shan = (b.expected.cells[1].shan % 9) + 1;
    return b;
  };
  it('chart_xia: 改一個山星', () => assertRunnerCatches(runChartXia, cellsBad(first('chart_xia'))));
  it('chart_xia: 改順逆', () => {
    const b = clone(first('chart_xia'));
    b.expected.shan_forward = !b.expected.shan_forward;
    assertRunnerCatches(runChartXia, b);
  });
  it('chart_xia: 改格局名', () => {
    const b = clone(first('chart_xia'));
    b.expected.pattern = b.expected.pattern === '旺山旺向' ? '上山下水' : '旺山旺向';
    assertRunnerCatches(runChartXia, b);
  });
  it('chart_ti: 改替卦後入中數與 same_as_xia', () => {
    const c = first('chart_ti', (x) => !x.expected.same_as_xia);
    const b = clone(c);
    b.expected.shan_center = (b.expected.shan_center % 9) + 1;
    assertRunnerCatches(runChartTi, b);
    const b2 = clone(c);
    b2.expected.same_as_xia = true;
    assertRunnerCatches(runChartTi, b2);
  });
  it('chart_from_facing_degree: 改 use_ti 與兼向側', () => {
    const c = first('chart_from_facing_degree');
    const b = clone(c);
    b.expected.use_ti = !b.expected.use_ti;
    assertRunnerCatches(runFromFacing, b);
    const b2 = clone(c);
    b2.expected.side = b2.expected.side === 'pre' ? 'post' : 'pre';
    assertRunnerCatches(runFromFacing, b2);
  });
  it('locate_degree: 改 need_ti 與山', () => {
    const c = first('locate_degree', (x) => x.expected.zone === 'jian');
    const b = clone(c);
    b.expected.need_ti = !b.expected.need_ti;
    assertRunnerCatches(runLocate, b);
    const b2 = clone(c);
    b2.expected.mountain = '午';
    assertRunnerCatches(runLocate, b2);
  });
  it('locate_edge 軟斷言 runner: 期望值可以不管,但 ridingLine 被破壞時抓得出', () => {
    const c = first('locate_degree', soft);
    assert.doesNotThrow(() => softLocate(clone(c)));
    // 非端點的角度沒有騎線旗標,softLocate 必須丟錯
    assertRunnerCatches(softLocate, { ...clone(c), input: { deg: 0 } });
  });
  it('yun_pan / direction_rule / pattern', () => {
    const b = clone(first('yun_pan'));
    b.expected.cells[5] = 9;
    assertRunnerCatches(runYunPan, b);
    const d = clone(first('direction_rule'));
    d.expected.forward = !d.expected.forward;
    assertRunnerCatches(runDirection, d);
    const p = clone(first('pattern'));
    p.expected.pattern = '雙星會向';
    assertRunnerCatches(runPattern, p);
  });
  it('old_engine_regression: 若期望值被改成舊引擎輸出會被抓出', () => {
    const c = clone(first('old_engine_regression'));
    c.expected.cells = c.expected.old_engine_cells;
    assertRunnerCatches(runOldEngine, c);
  });
  it('table: 改一個替星、改一個陰陽', () => {
    const t = clone(core.cases.find((c) => c.name === 'table_24_mountains'));
    t.expected.rows[3].ti_star_A += 1;
    assertRunnerCatches(runTable24, t);
    const t2 = clone(core.cases.find((c) => c.name === 'table_24_mountains'));
    t2.expected.rows[0].yang = !t2.expected.rows[0].yang;
    assertRunnerCatches(runTable24, t2);
    const s = clone(core.cases.find((c) => c.name === 'table_ti_star'));
    s.expected.A['子'] = 9;
    assertRunnerCatches(runTableTiStar, s);
  });
});

// ═══════════════════════════ D. 規格內嵌資料表 == 由規則重算(spec 4.2 第 6 點) ═══════════════════════════

describe('內嵌資料表 == 規格文字 == 規則重算', () => {
  it('RING(由 geo 生成)== 規格 2.4.1 的 RING,24/24', () => {
    const specRing = specJsonBlock('#### 2.4.1 常數', 1);
    assert.equal(specRing.length, 24);
    assert.deepEqual(xk.RING.map((r) => [...r]), specRing);
  });
  it('RING 與 geo.MOUNTAINS、手打的獨立山環一致', () => {
    assert.deepEqual(xk.RING.map((r) => r[0]), [...ORACLE_RING]);
    for (const [name, palace, dragon] of xk.RING) {
      const m = geo.MOUNTAINS[geo.mountainIndex(name)];
      assert.equal(palace, geo.LUOSHU[m.gua]);
      assert.equal(['地元', '天元', '人元'][dragon], m.dragon);
    }
  });
  it('TI_TABLES == 規格 2.4.1 的替星表', () => {
    const specTi = specJsonBlock('#### 2.4.1 常數', 2);
    assert.deepEqual(clone(xk.TI_TABLES), specTi);
  });
  it('A 表 24 山齊全,實際改變數字的只有 13 山(甲申壬卯乙艮丑丙巽辰巳庚寅)', () => {
    assert.equal(Object.keys(xk.TI_TABLES.A).length, 24);
    assert.equal(Object.keys(xk.TI_TABLES.B).length, 24);
    const changed = xk.RING.filter(([n, pal]) => xk.TI_TABLES.A[n] !== pal).map((r) => r[0]);
    assert.equal(changed.length, 13);
    assert.deepEqual([...changed].sort(), [...'甲申壬卯乙艮丑丙巽辰巳庚寅'].sort());
  });
  it('A、B 兩表只在 11 山不同(子丑寅卯巳午未庚酉戌乾)', () => {
    // xuankong_core.md 3.2 寫「只在 12 山不同」並把丁列入,但丁在兩表都是 9(規格 2.4.1 的內嵌表與 fixtures table_ti_star 一致),
    // 實際差異是 11 山;研究報告該句是筆誤,不影響規格與 fixtures。
    assert.equal(xk.TI_TABLES.A['丁'], 9);
    assert.equal(xk.TI_TABLES.B['丁'], 9);
    const diff = xk.RING.map((r) => r[0]).filter((n) => xk.TI_TABLES.A[n] !== xk.TI_TABLES.B[n]);
    assert.equal(diff.length, 11);
    assert.deepEqual([...diff].sort(), [...'子丑寅卯巳午未庚酉戌乾'].sort());
  });
  it('CHENGMEN == 規格 2.4.6 文字 == 由河圖生成數規則重算', () => {
    const line = SPEC_TEXT.split('\n').find((l) => l.includes('CHENGMEN[向宮]'));
    assert.ok(line, '規格找不到城門表');
    const fromSpec = {};
    for (const m of line.matchAll(/(\d):\[(\d),(\d)\]/g)) fromSpec[m[1]] = [Number(m[2]), Number(m[3])];
    assert.equal(Object.keys(fromSpec).length, 8);
    assert.deepEqual(clone(xk.CHENGMEN), fromSpec);
    // 規則重算(手打的八卦環,不 import src)
    const ringNums = [1, 8, 3, 4, 9, 2, 7, 6];
    for (const face of ringNums) {
      const k = ringNums.indexOf(face);
      const nb = [ringNums[(k + 7) % 8], ringNums[(k + 1) % 8]];
      const main = nb.find((n) => Math.abs(n - face) === 5);
      assert.deepEqual([...xk.CHENGMEN[face]], [main, nb.find((n) => n !== main)], `向宮 ${face}`);
    }
  });
  it('PALACES、FLY_ORDER 與洛書一致', () => {
    assert.deepEqual([...xk.PALACES], ['坎', '坤', '震', '巽', '中', '乾', '兌', '艮', '離']);
    assert.deepEqual([...xk.FLY_ORDER], [5, 6, 7, 8, 9, 1, 2, 3, 4]);
    assert.deepEqual([...xk.FLY_PATH], ['中', '乾', '兌', '艮', '離', '坎', '坤', '震', '巽']);
  });
});

describe('跨模組一致性(spec 4.2 第 5 點): orientation / luopan / geo / xuankong 讀到的 24 山完全一致', () => {
  it('orientation.json 24 個山中心案例 == mountainInfo(24/24)', () => {
    const orient = loadFixture('orientation');
    const centers = orient.cases.filter((c) => c.input.fn === 'mountainOfBearing' && c.tags?.includes('center'));
    assert.equal(centers.length, 24);
    for (const c of centers) {
      const info = xk.mountainInfo(c.expected.name);
      assert.equal(info.palace, c.expected.gua, c.expected.name);
      assert.equal(`${info.dragon}元`, c.expected.yuan, c.expected.name);
      assert.equal(info.yinyang, c.expected.polarity, c.expected.name);
      assert.equal(xk.RING[(xk.RING.findIndex((r) => r[0] === c.expected.name) + 12) % 24][0], c.expected.opposite);
    }
  });
  it('luopan_rings.json mountains24_geometry == mountainInfo(24/24)', () => {
    const luopan = loadFixture('luopan_rings');
    const rows = luopan.cases.find((c) => c.name === 'mountains24_geometry').expected;
    assert.equal(rows.length, 24);
    for (const r of rows) {
      const info = xk.mountainInfo(r.name);
      assert.equal(info.palace, r.palace, r.name);
      assert.equal(`${info.dragon}元`, r.yuan, r.name);
    }
  });
});

describe('原始碼約定(規格 2.4.1、1.1)', () => {
  const srcDir = path.join(here, '..', 'src', 'core');
  const files = ['xuankong.js', ...readdirSync(path.join(srcDir, 'xuankong')).map((f) => `xuankong/${f}`)];
  // 只看程式碼行: 註解可以提到山名與規則來源,不算手打表。
  const isComment = (l) => /^(\/\/|\*|\/\*)/.test(l.trim());
  const code = files.map((f) => readFileSync(path.join(srcDir, f), 'utf8').split('\n').filter((l) => !isComment(l)).join('\n'));
  it('24 山的順序與陰陽只從 geo 取: 原始碼裡沒有手打的 24 山環或陽名單(D23)', () => {
    assert.equal(files.length, 6);
    for (const [i, c] of code.entries()) {
      for (const bad of ['子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬', '壬子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥', '乾坤艮巽壬丙甲庚寅申巳亥', '壬丙甲庚']) {
        assert.ok(!c.includes(bad), `${files[i]} 含手打的山序或陰陽名單: ${bad}`);
      }
    }
    assert.ok(code.every((c, i) => files[i] === 'xuankong/tables.js' || files[i] === 'xuankong/findings.js' || !/'壬'/.test(c)), '除替星表與文案外不該出現山名字面值');
  });
  it('純函式: 不讀時鐘、不用亂數、不碰 DOM 與網路、不改全域', () => {
    for (const [i, c] of code.entries()) {
      for (const bad of ['Date.now', 'new Date', 'Math.random', 'document.', 'window.', 'localStorage', 'fetch(', 'XMLHttpRequest', 'process.', 'globalThis.', 'console.']) {
        assert.ok(!c.includes(bad), `${files[i]} 含 ${bad}`);
      }
    }
  });
  it('不自帶立春表: 交運一律呼叫 calendar(規格 2.2.3 第 8 點)', () => {
    for (const [i, c] of code.entries()) assert.ok(!/LICHUN|lichun\s*[:=]\s*\{/.test(c), `${files[i]} 疑似自帶立春表`);
    assert.ok(/yunOfInstant/.test(code[files.indexOf('xuankong.js')]));
  });
  it('不引用 AI 生成的第三方速查表(規格 2.4.1): 原始碼與規格內嵌表沒有 voidforall 的錯誤陰陽(子寅辰午申戌為陽)', () => {
    assert.equal(xk.mountainInfo('子').yinyang, '陰');
    assert.equal(xk.mountainInfo('寅').yinyang, '陽');
    assert.equal(xk.mountainInfo('辰').yinyang, '陰');
    assert.equal(xk.mountainInfo('午').yinyang, '陰');
    assert.equal(xk.mountainInfo('申').yinyang, '陽');
    assert.equal(xk.mountainInfo('戌').yinyang, '陰');
  });
});

// ═══════════════════════════ E. spec 4.4 屬性測試 ═══════════════════════════

const ALL = [];
for (let yun = 1; yun <= 9; yun += 1) for (const [sit] of xk.RING) ALL.push({ yun, sit, xia: xk.buildChart(yun, sit), ti: xk.buildChart(yun, sit, { ti: true }) });

describe('xuankong 屬性測試(spec 4.4)', () => {
  it('216 盤: 運/山/向三平面各是 1..9 的排列', () => {
    assert.equal(ALL.length, 216);
    for (const { xia, ti } of ALL) {
      for (const ch of [xia, ti]) {
        for (const k of ['yun', 'shan', 'xiang']) {
          assert.deepEqual(Object.values(planeByNum(ch, k)).sort((a, b) => a - b), [...NUMS], `${ch.meta.chartYun}${ch.meta.sit} ${k}`);
        }
      }
    }
  });
  it('運盤中宮 = 入運', () => {
    for (const { xia, yun } of ALL) assert.equal(xia.palaces['中'].yun, yun);
  });
  it('山星 N 恰在坐宮或向宮之一,向星同理(σ、τ 代數證明的推論)', () => {
    for (const { xia, yun } of ALL) {
      const at = (plate) => xk.palacesWithStar(xia, plate, yun);
      assert.equal(at('shan').length, 1);
      assert.equal(at('xiang').length, 1);
      assert.ok([xia.sitPalace, xia.facePalace].includes(at('shan')[0]), `山星 ${yun}${xia.meta.sit}`);
      assert.ok([xia.sitPalace, xia.facePalace].includes(at('xiang')[0]), `向星 ${yun}${xia.meta.sit}`);
    }
  });
  it('四大格局窮盡(216 盤無「其它」),計數 旺山旺向 48 / 上山下水 48 / 雙星會坐 60 / 雙星會向 60', () => {
    const cnt = {};
    for (const { xia } of ALL) {
      assert.notEqual(xk.classifyChart(xia), '其它');
      assert.equal(xia.patternHolds, true);
      assert.equal(xia.pattern, xk.classifyChart(xia));
      cnt[xia.pattern] = (cnt[xia.pattern] ?? 0) + 1;
    }
    assert.deepEqual(cnt, { 旺山旺向: 48, 上山下水: 48, 雙星會坐: 60, 雙星會向: 60 });
  });
  it('格局只由山向順逆兩位元決定(獨立寫法)', () => {
    for (const { xia } of ALL) assert.equal(xia.pattern, oraclePattern(xia.shan.forward, xia.xiang.forward));
  });
  it('九運只有雙星會坐與雙星會向各 12;一運同;五運旺山旺向 12 / 上山下水 12', () => {
    const byYun = (y) => {
      const c = {};
      for (const { xia, yun } of ALL) if (yun === y) c[xia.pattern] = (c[xia.pattern] ?? 0) + 1;
      return c;
    };
    assert.deepEqual(byYun(9), { 雙星會坐: 12, 雙星會向: 12 });
    assert.deepEqual(byYun(1), { 雙星會坐: 12, 雙星會向: 12 });
    assert.deepEqual(byYun(5), { 旺山旺向: 12, 上山下水: 12 });
    for (const y of [2, 3, 4, 6, 7, 8]) assert.deepEqual(byYun(y), { 旺山旺向: 6, 上山下水: 6, 雙星會坐: 6, 雙星會向: 6 }, `${y} 運`);
  });
  it('含 5 入中的盤共 48(每運 6 盤,五運無)', () => {
    const with5 = ALL.filter(({ xia }) => xia.shan.star === 5 || xia.xiang.star === 5);
    assert.equal(with5.length, 48);
    for (let y = 1; y <= 9; y += 1) assert.equal(with5.filter((x) => x.yun === y).length, y === 5 ? 0 : 6, `${y} 運`);
    // 全局伏吟(5 順)與反吟(5 逆)各 24
    const fu = ALL.reduce((n, { xia }) => n + ['shan', 'xiang'].filter((k) => xia.wholePlate[k] === '伏吟').length, 0);
    const fan = ALL.reduce((n, { xia }) => n + ['shan', 'xiang'].filter((k) => xia.wholePlate[k] === '反吟').length, 0);
    assert.deepEqual([fu, fan], [24, 24]);
  });
  it('對山與坐山同元龍同陰陽(24/24)', () => {
    for (let i = 0; i < 24; i += 1) {
      const a = xk.mountainInfo(xk.RING[i][0]);
      const b = xk.mountainInfo(xk.RING[(i + 12) % 24][0]);
      assert.equal(a.dragon, b.dragon);
      assert.equal(a.yinyang, b.yinyang);
      assert.equal(xk.RING[i][2], xk.RING[(i + 12) % 24][2]);
    }
  });
  it('奇偶簡式與二次轉換一致(432 次飛布,含替卦盤)', () => {
    let n = 0;
    for (const { xia, ti } of ALL) {
      for (const ch of [xia, ti]) {
        for (const [key, mountain] of [['shan', ch.meta.sit], ['xiang', ch.meta.face]]) {
          assert.equal(ch[key].forward, oracleForwardByParity(ch[key].star, mountain), `${ch.meta.chartYun}${ch.meta.sit} ${key}`);
          assert.equal(ch[key].mate, oracleMate(ch[key].star, mountain));
          n += 1;
        }
      }
    }
    assert.equal(n, 864, '216 盤 x 山向 x (下卦+替卦) 的檢查次數');
    assert.equal(ALL.length * 2, 432, '下卦 432 次飛布');
  });
  it('獨立實作 oracle 重算 216 個下卦盤與 216 個替卦盤(A、B 表)逐格相同', () => {
    for (const { yun, sit, xia, ti } of ALL) {
      assert.deepEqual(cellsByNum(xia), oracleChart(yun, sit).cells, `下卦 ${yun}${sit}`);
      assert.deepEqual(cellsByNum(ti), oracleChart(yun, sit, { ti: true }).cells, `替卦A ${yun}${sit}`);
      const tiB = xk.buildChart(yun, sit, { ti: true, tiTable: 'B' });
      assert.deepEqual(cellsByNum(tiB), oracleChart(yun, sit, { ti: true, table: 'B' }).cells, `替卦B ${yun}${sit}`);
    }
  });
  it('替卦盤與下卦盤相同者 56 盤(chart_ti 期望值本來就等於下卦盤,不是錯)', () => {
    const same = ALL.filter(({ xia, ti }) => JSON.stringify(xia.palaces) === JSON.stringify(ti.palaces));
    assert.equal(same.length, 56);
    assert.equal(ofType('chart_ti').filter((c) => c.expected.same_as_xia).length, 56);
  });
  it('替卦只改入中數,不改順逆與伴山;5 入中不替', () => {
    for (const { xia, ti } of ALL) {
      for (const k of ['shan', 'xiang']) {
        assert.equal(ti[k].forward, xia[k].forward);
        assert.equal(ti[k].mate, xia[k].mate);
        assert.equal(ti[k].star, xia[k].star);
        assert.equal(ti[k].enter, xia[k].star === 5 ? 5 : xk.TI_TABLES.A[xia[k].mate]);
      }
    }
  });
  it('替卦後順逆若改看替星宮,會有 102 盤不同(D25 的反證,證明「看原伴山」不是隨便選的)', () => {
    let diff = 0;
    for (const { ti } of ALL) {
      const badForward = (p, mountain) => {
        if (p.star === 5) return p.forward;
        return xk.mountainInfo(oracleMate(p.enter, mountain)).forward;
      };
      if (badForward(ti.shan, ti.meta.sit) !== ti.shan.forward || badForward(ti.xiang, ti.meta.face) !== ti.xiang.forward) diff += 1;
    }
    assert.equal(diff, 102);
  });
  it('5 入中兩種取法(山自身陰陽 vs 運盤中宮運星所在卦宮的同元龍山)216 盤差異 0', () => {
    let fiveCases = 0;
    for (const { yun, xia } of ALL) {
      for (const [key, mountain] of [['shan', xia.meta.sit], ['xiang', xia.meta.face]]) {
        if (xia[key].star !== 5) continue;
        fiveCases += 1;
        const dragon = xk.RING.find((r) => r[0] === mountain)[2];
        const alt = xk.RING.find(([, pal, dr]) => pal === yun && dr === dragon)[0]; // 運星 = yun 的本宮
        assert.equal(xk.mountainInfo(alt).forward, xia[key].forward, `${yun}運 ${mountain}`);
      }
    }
    assert.equal(fiveCases, 48);
  });
  it('全局合十 24、父母三般卦 16(全是上山下水)、連數三般卦 16、打劫 離宮 24 + 坎宮 24、不可用 6', () => {
    const cnt = { heshi: 0, parent3: 0, lianshu: 0, li: 0, kan: 0, unusable: 0 };
    for (const { xia } of ALL) {
      if (xk.heshi(xia)) cnt.heshi += 1;
      if (xk.parent3(xia)) {
        cnt.parent3 += 1;
        assert.equal(xia.pattern, '上山下水');
      }
      if (xk.lianshu3(xia)) cnt.lianshu += 1;
      const q = xk.qixing(xia);
      if (q) {
        cnt[q.kind === '離宮打劫' ? 'li' : 'kan'] += 1;
        if (!q.usable) cnt.unusable += 1;
        assert.equal(xia.pattern, '雙星會向');
      }
    }
    assert.deepEqual(cnt, { heshi: 24, parent3: 16, lianshu: 16, li: 24, kan: 24, unusable: 6 });
    assert.equal(cnt.li + cnt.kan + cnt.parent3, 64, '離宮 24 + 坎宮 24 + 三般巧卦 16 = 64 局');
  });
  it('局部合十(任兩數和為 10)的宮,在下卦盤上與全局合十的 24 局集合等價(複查 R13)', () => {
    for (const { xia } of ALL) {
      const all9 = xk.heshiPalaces(xia).length === 9;
      assert.equal(all9, xk.heshi(xia) !== null, `${xia.meta.chartYun}${xia.meta.sit}`);
    }
  });
});

// ═══════════════════════════ F. 元運與入運(規格 2.4.4) ═══════════════════════════

describe('resolveYuns: chartYun 與 currentYun 分離', () => {
  const built2010 = utc(2010, 6, 1);
  const now2026 = utc(2026, 9, 29, 4);
  it('預設: 建成年的運起盤,今日的運判讀', () => {
    const r = xk.resolveYuns({ builtAt: built2010, now: now2026 });
    assert.deepEqual([r.chartYun, r.currentYun, r.basis, r.differs], [8, 9, 'built', true]);
    assert.equal(r.basisInstant, built2010);
    assert.equal(r.schoolNote, null);
  });
  it('yunBasis=moveIn 改用遷入時的運;缺 movedInAt 丟 MISSING_INPUT', () => {
    const r = xk.resolveYuns({ builtAt: built2010, movedInAt: utc(2024, 3, 1), now: now2026 }, { yunBasis: 'moveIn' });
    assert.deepEqual([r.chartYun, r.basis], [9, 'moveIn']);
    assert.match(r.schoolNote, /各派意見不同/);
    throwsCode(() => xk.resolveYuns({ builtAt: built2010, now: now2026 }, { yunBasis: 'moveIn' }), 'MISSING_INPUT');
  });
  it('只有 renovation=full(或 anyRenovation)才以大修完工瞬間起盤;partial 不換運', () => {
    const base = { builtAt: built2010, renovatedAt: utc(2025, 1, 10), now: now2026 };
    assert.deepEqual([xk.resolveYuns(base, { renovation: 'full' }).chartYun, xk.resolveYuns(base, { renovation: 'full' }).basis], [9, 'renovation']);
    assert.equal(xk.resolveYuns(base, { renovation: 'anyRenovation' }).chartYun, 9);
    const partial = xk.resolveYuns(base, { renovation: 'partial' });
    assert.deepEqual([partial.chartYun, partial.basis], [8, 'built']);
    assert.ok(partial.warnings.includes('partialRenovationNotCounted'));
    const none = xk.resolveYuns(base, { renovation: 'none' });
    assert.equal(none.chartYun, 8);
    assert.ok(none.warnings.includes('renovationDateIgnored'));
    throwsCode(() => xk.resolveYuns({ builtAt: built2010, now: now2026 }, { renovation: 'full' }), 'MISSING_INPUT');
  });
  it('大修優先於遷入(中州派: 以最近一次大裝修為準)', () => {
    const r = xk.resolveYuns({ builtAt: built2010, movedInAt: utc(2012, 1, 1), renovatedAt: utc(2025, 1, 10), now: now2026 }, { yunBasis: 'moveIn', renovation: 'full' });
    assert.deepEqual([r.chartYun, r.basis], [9, 'renovation']);
  });
  it('立春臨界: 2024 立春前後 1 分鐘的建成時刻帶 nearYunBoundary,遠離者不帶', () => {
    const lichun = toInstant({ local: '2024-02-04T16:27', utcOffset: '+08:00' });
    assert.ok(xk.resolveYuns({ builtAt: lichun, now: now2026 }).warnings.includes('nearYunBoundary'));
    assert.ok(!xk.resolveYuns({ builtAt: utc(2024, 2, 10), now: now2026 }).warnings.includes('nearYunBoundary'));
  });
  it('2044 立春前仍是九運、之後是一運(不自帶立春表,交給 calendar)', () => {
    const r1 = xk.resolveYuns({ builtAt: toInstant({ local: '2044-02-04T10:00', utcOffset: '+08:00' }), now: now2026 });
    const r2 = xk.resolveYuns({ builtAt: toInstant({ local: '2044-02-04T15:00', utcOffset: '+08:00' }), now: now2026 });
    assert.deepEqual([r1.chartYun, r2.chartYun], [9, 1]);
  });
  it('二元八運(yunSystem=er_yuan_8): 2017-2023 建成者由八運變九運', () => {
    const b = utc(2020, 6, 1);
    assert.equal(xk.resolveYuns({ builtAt: b, now: now2026 }).chartYun, 8);
    assert.equal(xk.resolveYuns({ builtAt: b, now: now2026 }, { yunSystem: 'er_yuan_8' }).chartYun, 9);
    throwsCode(() => xk.resolveYuns({ builtAt: utc(1990, 6, 1), now: now2026 }, { yunSystem: 'er_yuan_8' }), 'YUN_SYSTEM_RANGE');
  });
  it('明確給 chartYun / currentYun 時直接採用;不在 1..9 丟 INVALID_YUN', () => {
    const r = xk.resolveYuns({ chartYun: 3, currentYun: 9 });
    assert.deepEqual([r.chartYun, r.currentYun, r.basis, r.basisInstant, r.differs], [3, 9, 'explicit', null, true]);
    for (const bad of [0, 10, 1.5, NaN, '3', null]) throwsCode(() => xk.resolveYuns({ chartYun: bad, currentYun: 9 }), 'INVALID_YUN');
    throwsCode(() => xk.resolveYuns({ chartYun: 3, currentYun: 0 }), 'INVALID_YUN');
  });
  it('缺必要輸入: 沒有 now 也沒有 currentYun、沒有 builtAt 也沒有 chartYun', () => {
    throwsCode(() => xk.resolveYuns({ builtAt: built2010 }), 'MISSING_INPUT');
    throwsCode(() => xk.resolveYuns({ now: now2026 }), 'MISSING_INPUT');
    throwsCode(() => xk.resolveYuns(null), 'MISSING_INPUT');
    throwsCode(() => xk.resolveYuns({ builtAt: NaN, now: now2026 }), 'INVALID_INSTANT');
  });
  it('未知設定值與未知鍵', () => {
    throwsCode(() => xk.resolveYuns({ builtAt: built2010, now: now2026 }, { yunBasis: 'x' }), 'INVALID_OPTION');
    throwsCode(() => xk.resolveYuns({ builtAt: built2010, now: now2026 }, { renovation: 'x' }), 'INVALID_OPTION');
    assert.throws(() => xk.resolveYuns({ builtAt: built2010, now: now2026 }, { noSuchSwitch: 1 }));
  });
});

// ═══════════════════════════ G. buildChart / locateFacing 邊界與錯誤 ═══════════════════════════

describe('buildChart / locateFacing 錯誤碼與邊界', () => {
  it('buildChart 錯誤碼', () => {
    for (const bad of [0, 10, 1.5, NaN, '9', undefined, null]) throwsCode(() => xk.buildChart(bad, '子'), 'INVALID_YUN');
    throwsCode(() => xk.buildChart(9, '不是山'), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => xk.buildChart(9, undefined), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => xk.buildChart(9, '子', { tiTable: 'C' }), 'INVALID_OPTION');
    throwsCode(() => xk.buildChart(9, '子', { ti: 'yes' }), 'INVALID_OPTION');
    throwsCode(() => xk.buildChart(9, '子', { foo: 1 }), 'INVALID_OPTION');
    throwsCode(() => xk.buildChart(9, '子', null), 'INVALID_OPTION');
  });
  it('fly / yunPan / direction 錯誤碼', () => {
    throwsCode(() => xk.fly(0, true), 'INVALID_STAR');
    throwsCode(() => xk.fly(10, true), 'INVALID_STAR');
    throwsCode(() => xk.direction(5.5, '子'), 'INVALID_STAR');
    throwsCode(() => xk.yunPan(0), 'INVALID_YUN');
    throwsCode(() => xk.mountainInfo('X'), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => xk.listPatterns(10), 'INVALID_YUN');
    throwsCode(() => xk.luoshuOf('北'), 'INVALID_PALACE');
    throwsCode(() => xk.palacesWithStar(xk.buildChart(9, '子'), 'shan', 0), 'INVALID_STAR');
    throwsCode(() => xk.palacesWithStar(xk.buildChart(9, '子'), 'foo', 1), 'INVALID_OPTION');
  });
  it('locateFacing: NaN/Infinity 丟 INVALID_BEARING;負值與超過 360 先正規化', () => {
    for (const bad of [NaN, Infinity, -Infinity, '180', null, undefined]) throwsCode(() => xk.locateFacing(bad), 'INVALID_BEARING');
    assert.equal(xk.locateFacing(-15).mountain, xk.locateFacing(345).mountain);
    assert.equal(xk.locateFacing(360 + 180).mountain, '午');
    assert.equal(xk.locateFacing(180).sit, '子');
  });
  it('locateFacing: xiaGuaHalfWidth 可調(D02),端點含入下卦並標 onZoneEdge', () => {
    const a = xk.locateFacing(344.5, { xiaGuaHalfWidth: 3.5 }); // 壬山 dev=-0.5? 壬中心 345
    assert.equal(a.zone, 'xia');
    const b = xk.locateFacing(345 - 3.5, { xiaGuaHalfWidth: 3.5 });
    assert.deepEqual([b.zone, b.onZoneEdge, b.ridingLine], ['xia', true, true]);
    const c = xk.locateFacing(345 - 3.6, { xiaGuaHalfWidth: 3.5 });
    assert.deepEqual([c.zone, c.onZoneEdge, c.kind], ['jian', false, '出卦']);
    assert.equal(xk.locateFacing(340.5).onZoneEdge, true);
    assert.equal(xk.locateFacing(352.5).onMountainLine, true);
    assert.throws(() => xk.locateFacing(180, { noSuchSwitch: 1 }));
  });
  it('locateFacing: 外側 1.5 度旗標(|dev| >= 6)與 geo.needsTiGua 唯一來源', () => {
    assert.equal(xk.locateFacing(345 - 6).outer, true);
    assert.equal(xk.locateFacing(345 - 5.9).outer, false);
    assert.equal(xk.locateFacing(345).outer, false);
    for (let d = 0; d < 360; d += 0.5) {
      const loc = xk.locateFacing(d);
      assert.equal(loc.needTi, geo.analyzeBearing(d).needsTiGua, `deg ${d}`);
      assert.equal(loc.geo.bearing, loc.bearing);
    }
  });
  it('locateFacing: 48 個兼向扇區 32 替 16 不替(Wikibooks 48/48)', () => {
    let ti = 0;
    let notTi = 0;
    for (let k = 0; k < 24; k += 1) {
      const center = 15 * k;
      for (const dev of [-6, 6]) {
        const loc = xk.locateFacing(center + dev);
        assert.equal(loc.zone, 'jian');
        if (loc.needTi) ti += 1;
        else notTi += 1;
      }
    }
    assert.deepEqual([ti, notTi], [32, 16]);
  });
  it('buildChart 不修改傳入的 opts,回傳值 JSON 可序列化', () => {
    const opts = Object.freeze({ ti: true, tiTable: 'B' });
    const c = xk.buildChart(7, '午', opts);
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
    assert.equal(c.meta.tiTable, 'B');
    assert.equal(xk.buildChart(7, '午').meta.tiTable, null);
  });
  it('九運子山午向(規格 2.4.2 輸出範例)逐欄相同', () => {
    const c = xk.buildChart(9, '子');
    assert.deepEqual(c.meta, { chartYun: 9, sit: '子', face: '午', ti: false, tiTable: null });
    assert.deepEqual([c.sitPalace, c.facePalace], ['坎', '離']);
    assert.deepEqual(c.shan, { star: 5, enter: 5, mate: '子', forward: false });
    assert.deepEqual(c.xiang, { star: 4, enter: 4, mate: '巽', forward: true });
    assert.deepEqual(c.palaces, {
      巽: { yun: 8, shan: 6, xiang: 3 }, 離: { yun: 4, shan: 1, xiang: 8 }, 坤: { yun: 6, shan: 8, xiang: 1 },
      震: { yun: 7, shan: 7, xiang: 2 }, 中: { yun: 9, shan: 5, xiang: 4 }, 兌: { yun: 2, shan: 3, xiang: 6 },
      艮: { yun: 3, shan: 2, xiang: 7 }, 坎: { yun: 5, shan: 9, xiang: 9 }, 乾: { yun: 1, shan: 4, xiang: 5 },
    });
    assert.equal(c.pattern, '雙星會坐');
    assert.deepEqual(c.wholePlate, { shan: '反吟', xiang: null });
  });
});

// ═══════════════════════════ H. analyzeXuankong 整合 ═══════════════════════════

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};
const PATTERN_ID = { 旺山旺向: 'wangshanwangxiang', 上山下水: 'shangshanxiashui', 雙星會向: 'shuangxinghuixiang', 雙星會坐: 'shuangxinghuizuo' };
const NOW = utc(2026, 9, 29, 4);
const BUILT_9 = utc(2025, 6, 1);
const base = (facing, extra = {}) => ({ facing, builtAt: BUILT_9, now: NOW, ...extra });

describe('analyzeXuankong', () => {
  it('回傳結構(規格 2.4.13)、schema、JSON 可序列化、不修改輸入', () => {
    const input = deepFreeze(base(180));
    const overrides = deepFreeze({ useTiGua: true });
    const r = xk.analyzeXuankong(input, overrides);
    assert.deepEqual(Object.keys(r), ['meta', 'locate', 'chart', 'pattern', 'wholePlate', 'specials', 'qi', 'pairTags', 'positions', 'findings']);
    assert.equal(r.meta.schema, 'fengshui.xuankong/1');
    assert.deepEqual(Object.keys(r.specials), ['heshi', 'parent3', 'qixing', 'lianshu', 'localYin', 'chengmen']);
    assert.deepEqual(Object.keys(r.qi.byPalace), [...xk.PALACES]);
    assert.deepEqual(Object.keys(r.pairTags.byPalace), [...xk.PALACES]);
    assert.deepEqual(Object.keys(r.positions), ['wealth', 'ding']);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    assert.equal(r.meta.computedAtCST, '2026-09-29 12:00');
    assert.equal(r.pattern, r.chart.pattern);
    assert.deepEqual(r.chart.meta, { chartYun: 9, currentYun: 9, sit: '子', face: '午', ti: false, tiTable: null });
  });
  it('meta.ruleset 回存實際採用的設定(含覆寫值)', () => {
    const r = xk.analyzeXuankong(base(180), { xiaGuaHalfWidth: 3.5, qiScheme: 'S1', wSide: 0.4, tiTable: 'B', useTiGua: true, eightKeepsWealth: true });
    for (const [k, v] of Object.entries(r.meta.ruleset)) {
      const expected = { xiaGuaHalfWidth: 3.5, qiScheme: 'S1', wSide: 0.4, tiTable: 'B', useTiGua: true, eightKeepsWealth: true }[k] ?? DEFAULT_SETTINGS[k];
      assert.equal(v, expected, k);
      assert.ok(k in DEFAULT_SETTINGS, `${k} 必須是 Settings 的鍵`);
    }
    for (const k of ['xiaGuaHalfWidth', 'useTiGua', 'tiTable', 'qiScheme', 'eightKeepsWealth', 'fuyinPenalty', 'fanyinPenalty', 'wSide', 'wYun', 'yunBasis', 'renovation', 'yunSystem', 'showLianshu', 'showChengmen']) {
      assert.ok(k in r.meta.ruleset, `ruleset 缺 ${k}`);
    }
  });
  it('facing 可給數字、{xuankong}、或 facingMountain;三者等價', () => {
    const a = xk.analyzeXuankong(base(180));
    const b = xk.analyzeXuankong(base({ xuankong: 180, bazhai: 90 }));
    const c = xk.analyzeXuankong({ facingMountain: '午', builtAt: BUILT_9, now: NOW });
    assert.deepEqual(b.chart, a.chart);
    assert.deepEqual(c.chart, a.chart);
    throwsCode(() => xk.analyzeXuankong({ facing: 180, facingMountain: '午', builtAt: BUILT_9, now: NOW }), 'INVALID_INPUT');
    throwsCode(() => xk.analyzeXuankong({ builtAt: BUILT_9, now: NOW }), 'MISSING_INPUT');
    throwsCode(() => xk.analyzeXuankong({ facing: { bazhai: 1 }, builtAt: BUILT_9, now: NOW }), 'MISSING_INPUT');
    throwsCode(() => xk.analyzeXuankong({ facing: NaN, builtAt: BUILT_9, now: NOW }), 'INVALID_BEARING');
    throwsCode(() => xk.analyzeXuankong({ facingMountain: 'X', builtAt: BUILT_9, now: NOW }), 'UNKNOWN_MOUNTAIN');
    throwsCode(() => xk.analyzeXuankong(null), 'MISSING_INPUT');
    throwsCode(() => xk.analyzeXuankong(base(180, { chartYun: 0 })), 'INVALID_YUN');
    assert.throws(() => xk.analyzeXuankong(base(180), { noSuchSwitch: 1 }));
    throwsCode(() => xk.analyzeXuankong(base(180), { wSide: NaN }), 'INVALID_OPTION');
    throwsCode(() => xk.analyzeXuankong(base(180), { tiTable: 'Z' }), 'INVALID_OPTION');
    throwsCode(() => xk.analyzeXuankong(base(180), { qiScheme: 'S9' }), 'INVALID_OPTION');
  });
  it('替卦預設關: 兼向且需替時只提示(warnings.tiSuggested),盤仍是下卦;useTiGua 才替', () => {
    const facing = 354.75; // 子向偏壬 5.25 度,陰陽差錯
    const off = xk.analyzeXuankong(base(facing, { chartYun: 7, currentYun: 9 }));
    assert.equal(off.chart.meta.ti, false);
    assert.equal(off.locate.needTi, true);
    assert.ok(off.meta.warnings.includes('tiSuggested'));
    assert.deepEqual(cellsByNum(off.chart), cellsByNum(xk.buildChart(7, '午')));
    assert.ok(off.findings.some((f) => f.id === 'xk.locate.jian' && /預設只排下卦/.test(f.body)));
    const on = xk.analyzeXuankong(base(facing, { chartYun: 7, currentYun: 9 }), { useTiGua: true });
    assert.equal(on.chart.meta.ti, true);
    assert.ok(!on.meta.warnings.includes('tiSuggested'));
    assert.deepEqual(cellsByNum(on.chart), cellsByNum(xk.buildChart(7, '午', { ti: true })));
    assert.ok(on.findings.some((f) => f.id === 'xk.locate.jian' && /已依設定改用替卦/.test(f.body)));
    // 同陰陽兼向: 開了替卦也不替(needsTiGua=false)
    const same = xk.analyzeXuankong(base(5.25, { chartYun: 7, currentYun: 9 }), { useTiGua: true });
    assert.equal(same.locate.kind, '同陰陽');
    assert.equal(same.chart.meta.ti, false);
  });
  it('替星表 B 只在使用者選擇時採用', () => {
    const b = xk.analyzeXuankong(base(354.75, { chartYun: 7, currentYun: 9 }), { useTiGua: true, tiTable: 'B' });
    assert.equal(b.chart.meta.tiTable, 'B');
    assert.deepEqual(cellsByNum(b.chart), cellsByNum(xk.buildChart(7, '午', { ti: true, tiTable: 'B' })));
  });
  it('chartYun 與 currentYun 分離: 格局用 chartYun,旺衰與財丁位用 currentYun', () => {
    // 八運建成的子山午向(雙星會向),今日已是九運
    const r = xk.analyzeXuankong({ facing: 180, builtAt: utc(2010, 6, 1), now: NOW });
    assert.deepEqual([r.meta.chartYun, r.meta.currentYun, r.pattern], [8, 9, '雙星會向']);
    assert.equal(r.chart.meta.chartYun, 8);
    assert.ok(r.meta.warnings.includes('chartYunDiffersFromCurrent'));
    assert.ok(r.findings.some((f) => f.id === 'xk.yun.differs' && f.tag === 'inference'));
    // 旺衰以九運為準: 九紫是旺、八白是退
    const cells = r.chart.palaces;
    for (const p of xk.PALACES) {
      assert.equal(r.qi.byPalace[p].shan.label, xk.qiLabel(9, cells[p].shan));
      assert.equal(r.qi.byPalace[p].xiang.score, xk.qiScore(9, cells[p].xiang));
    }
    // 若誤用 chartYun 判讀,標籤會不同(證明兩者確實分開)
    assert.ok(xk.PALACES.some((p) => xk.qiLabel(8, cells[p].shan) !== xk.qiLabel(9, cells[p].shan)));
    // 財位、丁位、特殊格局的可用性也以 currentYun 為準
    assert.deepEqual(r.positions, xk.wealthDingPositions(r.chart, 9));
    assert.notDeepEqual(r.positions, xk.wealthDingPositions(r.chart, 8));
    for (const row of r.positions.wealth) assert.ok(xk.qiDist(9, cells[row.palace].xiang) <= 2, `財位候選 ${row.palace} 的向星要屬九運的旺/生`);
    for (const row of r.positions.ding) assert.ok(xk.qiDist(9, cells[row.palace].shan) <= 2, `丁位候選 ${row.palace} 的山星要屬九運的旺/生`);
    assert.deepEqual(r.specials.chengmen, xk.chengmen(r.chart, 9));
    // 格局名稱、全局伏吟反吟、特殊格局的判定看盤面本身,以起盤的運為準(格局定義的 N = chartYun)
    assert.equal(r.pattern, xk.classifyChart(r.chart));
    // 同一天建成則無提示
    const same = xk.analyzeXuankong({ facing: 180, builtAt: BUILT_9, now: NOW });
    assert.ok(!same.meta.warnings.includes('chartYunDiffersFromCurrent'));
    assert.ok(!same.findings.some((f) => f.id === 'xk.yun.differs'));
  });
  it('財位依格局分流: 雙星會向的向宮列旺財位;雙星會坐的坐宮標 back、不列旺財位(D30)', () => {
    const toward = xk.analyzeXuankong(base(165)); // 九運壬山丙向 雙星會向,向宮=離
    assert.equal(toward.pattern, '雙星會向');
    const front = toward.positions.wealth.find((r) => r.palace === '離');
    assert.deepEqual([front.side, front.kind, front.star, front.tier], ['front', 'wangcai', 9, 'wang']);
    assert.ok(toward.findings.some((f) => f.id === 'xk.position.wealth.front'));
    assert.ok(!toward.findings.some((f) => f.id === 'xk.position.wealth.back'));

    const seat = xk.analyzeXuankong(base(180)); // 九運子山午向 雙星會坐,向星 9 在坐宮=坎
    assert.equal(seat.pattern, '雙星會坐');
    const back = seat.positions.wealth.find((r) => r.palace === '坎');
    assert.deepEqual([back.side, back.kind, back.star], ['back', 'back', 9]);
    assert.equal(back.adjustedScore, back.score * xk.BACK_WEALTH_FACTOR);
    assert.ok(!seat.positions.wealth.some((r) => r.kind === 'wangcai' && r.star === 9), '向星 9 在坐宮不算旺財位');
    const f = seat.findings.find((x) => x.id === 'xk.position.wealth.back');
    assert.ok(f && /財星在後方/.test(f.body));
    // 丁位: 雙星會坐的山星 9 在坐宮 = 旺丁位(排序依分數: 坎宮的運星是 5 又有五九組合,分數低於離宮的一白,所以不一定排第一)
    const dBack = seat.positions.ding.find((r) => r.palace === '坎');
    assert.deepEqual([dBack.side, dBack.kind, dBack.star, dBack.tier], ['back', 'wangding', 9, 'wang']);
    assert.ok(seat.findings.some((f) => f.id === 'xk.position.ding.back'));
  });
  it('候選只含向星(丁位用山星)屬 currentYun、+1、+2 的宮,依分數排序,分數公式與規格 2.4.10 一致', () => {
    for (const yun of [1, 5, 9]) {
      for (const sit of ['子', '壬', '卯', '乾']) {
        const r = xk.analyzeXuankong({ facingMountain: xk.RING[(xk.RING.findIndex((x) => x[0] === sit) + 12) % 24][0], chartYun: yun, currentYun: yun });
        const P = r.chart.palaces;
        const q = (s) => xk.qiScore(yun, s);
        const adj = (p) => r.pairTags.byPalace[p].reduce((s, t) => s + xk.pairAdjust(t, yun), 0);
        for (const row of r.positions.wealth) {
          assert.ok([0, 1, 2].includes(((P[row.palace].xiang - yun) % 9 + 9) % 9));
          const exp = q(P[row.palace].xiang) + 0.3 * q(P[row.palace].shan) + 0.3 * q(P[row.palace].yun) + adj(row.palace);
          assert.ok(Math.abs(row.score - exp) < 1e-9, `${yun}運${sit} 財 ${row.palace}`);
        }
        for (const row of r.positions.ding) {
          const exp = q(P[row.palace].shan) + 0.3 * q(P[row.palace].xiang) + 0.3 * q(P[row.palace].yun) + adj(row.palace);
          assert.ok(Math.abs(row.score - exp) < 1e-9, `${yun}運${sit} 丁 ${row.palace}`);
        }
        const scores = r.positions.wealth.map((x) => x.score);
        assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
        assert.equal(r.positions.wealth.length, xk.PALACES.filter((p) => [0, 1, 2].includes(((P[p].xiang - yun) % 9 + 9) % 9)).length);
      }
    }
  });
  it('wSide、wYun、eightKeepsWealth 開關生效', () => {
    const a = xk.analyzeXuankong(base(180));
    const b = xk.analyzeXuankong(base(180), { wSide: 0, wYun: 0 });
    assert.notDeepEqual(a.positions.wealth.map((r) => r.score), b.positions.wealth.map((r) => r.score));
    const ch = xk.buildChart(9, '子');
    const eight = xk.palacesWithStar(ch, 'xiang', 8)[0];
    const off = xk.analyzeXuankong(base(180));
    const on = xk.analyzeXuankong(base(180), { eightKeepsWealth: true });
    assert.equal(off.qi.byPalace[eight].xiang.score, 0);
    assert.equal(on.qi.byPalace[eight].xiang.score, 1);
  });
  it('全局伏吟扣 fuyinPenalty 並給 caution;可調', () => {
    const r = xk.analyzeXuankong(base(165)); // 九運壬山丙向: 山盤全局伏吟
    assert.equal(r.wholePlate.shan, '伏吟');
    assert.deepEqual(r.wholePlate.penalties, [{ plate: '山', kind: '伏吟', points: -3, waived: false }]);
    assert.equal(r.wholePlate.penaltyTotal, -3);
    const f = r.findings.find((x) => x.id === 'xk.wholeplate.fuyin.shan');
    assert.equal(f.level, 'caution');
    assert.equal(xk.analyzeXuankong(base(165), { fuyinPenalty: -5 }).wholePlate.penaltyTotal, -5);
    // 打劫犯全局伏吟: 不可用(SINA-3BAN)
    assert.equal(r.specials.qixing.usable, false);
  });
  it('全局反吟一律警示;旺山旺向且仍在當運才不扣,否則扣 fanyinPenalty(D29,R15)', () => {
    // 九運子山午向: 山盤反吟、雙星會坐,扣 -1
    const a = xk.analyzeXuankong(base(180));
    assert.deepEqual(a.wholePlate.penalties, [{ plate: '山', kind: '反吟', points: -1, waived: false }]);
    assert.equal(a.findings.find((f) => f.id === 'xk.wholeplate.fanyin.shan').level, 'caution');
    // 七運卯山酉向(旺山旺向,山盤反吟): 今日仍七運不扣;今日九運(退運)照扣
    const inYun = xk.analyzeXuankong({ facingMountain: '酉', chartYun: 7, currentYun: 7 });
    assert.equal(inYun.pattern, '旺山旺向');
    assert.deepEqual(inYun.wholePlate.penalties, [{ plate: '山', kind: '反吟', points: 0, waived: true }]);
    assert.equal(inYun.findings.find((f) => f.id === 'xk.wholeplate.fanyin.shan').level, 'caution', '一律警示');
    const out = xk.analyzeXuankong({ facingMountain: '酉', chartYun: 7, currentYun: 9 });
    assert.deepEqual(out.wholePlate.penalties, [{ plate: '山', kind: '反吟', points: -1, waived: false }]);
    assert.equal(xk.analyzeXuankong({ facingMountain: '酉', chartYun: 7, currentYun: 9 }, { fanyinPenalty: -2 }).wholePlate.penaltyTotal, -2);
  });
  it('特殊格局與 showLianshu / showChengmen 開關(資料照給,Finding 只在開啟時出現)', () => {
    const lian = xk.analyzeXuankong({ facingMountain: '戌', chartYun: 2, currentYun: 9 }); // 二運辰山戌向: 連數三般卦
    assert.equal(lian.specials.lianshu, true);
    assert.ok(!lian.findings.some((f) => f.id === 'xk.special.lianshu'));
    assert.ok(xk.analyzeXuankong({ facingMountain: '戌', chartYun: 2, currentYun: 9 }, { showLianshu: true }).findings.some((f) => f.id === 'xk.special.lianshu' && f.confidence === 'low'));
    const cm = xk.analyzeXuankong(base(180));
    assert.ok(!cm.findings.some((f) => f.id === 'xk.special.chengmen'));
    const cmOn = xk.analyzeXuankong(base(180), { showChengmen: true });
    assert.ok(cmOn.findings.some((f) => f.id === 'xk.special.chengmen'));
    assert.deepEqual([cm.specials.chengmen.main.palace, cm.specials.chengmen.sub.palace], ['巽', '坤']);
    const h = xk.analyzeXuankong({ facingMountain: '巽', chartYun: 3, currentYun: 3 }); // 三運乾山巽向?向=巽 → 坐乾
    assert.equal(h.chart.meta.sit, '乾');
  });
  it('房間用途規則全部標「推論」', () => {
    const r = xk.analyzeXuankong(base(180));
    const rooms = r.findings.filter((f) => f.id.startsWith('xk.room.'));
    assert.equal(rooms.length, 6);
    for (const f of rooms) {
      assert.equal(f.tag, 'inference');
      assert.equal(f.confidence, 'low');
      assert.match(f.body, /沒有直接的古籍依據/);
    }
  });
  it('Finding 形狀合規、id 不重複、不用恐嚇字眼(規格 5.1 第 6 點)、不寫「建議換屋」', () => {
    const FORBIDDEN = ['大凶', '絕嗣', '克妻', '敗財', '換屋', '必定', '一定會'];
    const LEVELS = ['info', 'note', 'caution'];
    const TAGS = ['source', 'inference', 'design', 'minority'];
    const CONF = ['high', 'medium', 'low'];
    let total = 0;
    for (let yun = 1; yun <= 9; yun += 1) {
      for (const [mt] of xk.RING) {
        const r = xk.analyzeXuankong({ facingMountain: mt, chartYun: yun, currentYun: 9 }, { showLianshu: true, showChengmen: true });
        const ids = new Set();
        for (const f of r.findings) {
          total += 1;
          assert.deepEqual(Object.keys(f).sort(), ['body', 'confidence', 'id', 'level', 'refs', 'schoolNote', 'tag', 'title']);
          assert.match(f.id, /^xk\.[a-z0-9_.-]+$/, 'Finding.id 只用 ASCII(拼音),當文案索引鍵');
          assert.ok(LEVELS.includes(f.level) && TAGS.includes(f.tag) && CONF.includes(f.confidence), f.id);
          assert.ok(Array.isArray(f.refs) && f.refs.length > 0 && f.refs.every((x) => typeof x === 'string'), f.id);
          assert.ok(f.schoolNote === null || typeof f.schoolNote === 'string');
          assert.ok(f.title.length > 0 && f.body.length > 0, f.id);
          assert.ok(!ids.has(f.id), `重複的 id ${f.id}`);
          ids.add(f.id);
          for (const w of FORBIDDEN) assert.ok(!f.title.includes(w) && !f.body.includes(w), `${f.id} 含禁用字 ${w}`);
          if (f.tag === 'inference') assert.notEqual(f.confidence, 'high', f.id);
        }
      }
    }
    assert.ok(total > 216 * 15, `Finding 總數過少: ${total}`);
  });
  it('九星落宮模板: 九運逐星 18 則(9 宮 x 山向),其他運沒有 xk.star9;內容與五氣標籤一致', () => {
    assert.deepEqual(Object.keys(xk.STAR_YUN9).map(Number).sort((a, b) => a - b), NUMS);
    for (const s of NUMS) {
      const label = xk.QI_LABEL_TEXT[xk.qiLabel(9, s)];
      assert.ok(xk.STAR_YUN9[s].state.startsWith(label.replace('(當令)', '').slice(0, 1)), `${s} 星狀態 ${xk.STAR_YUN9[s].state} vs 五氣 ${label}`);
      assert.doesNotMatch(xk.STAR_YUN9[s].text + xk.STAR_YUN9[s].avoid, /四四仍是文昌/, '四四已移除文昌標籤(規格 2.4.9)');
    }
    assert.equal(xk.STAR_YUN9[5].level, 'caution');
    const nine = xk.analyzeXuankong(base(180));
    const stars = nine.findings.filter((f) => f.id.startsWith('xk.star9.'));
    assert.equal(stars.length, 18);
    assert.equal(new Set(stars.map((f) => f.id)).size, 18);
    const f5 = stars.filter((f) => f.id.startsWith('xk.star9.5.'));
    assert.ok(f5.length >= 1 && f5.every((f) => f.level === 'caution' && /不放爐灶/.test(f.body)));
    const eight = stars.find((f) => f.id.startsWith('xk.star9.8.'));
    assert.equal(eight.confidence, 'low');
    assert.match(eight.schoolNote, /各派不同/);
    const other = xk.analyzeXuankong({ facing: 180, chartYun: 8, currentYun: 8 });
    assert.equal(other.findings.filter((f) => f.id.startsWith('xk.star9.')).length, 0);
    assert.ok(other.findings.some((f) => f.id.startsWith('xk.star.')), '其他運用通用星說法');
  });
  it('每張盤都有一則格局 Finding,內容對應四種格局', () => {
    for (const [pat, re] of [['旺山旺向', /人丁星在後方、財星在前方/], ['上山下水', /位置顛倒/], ['雙星會向', /集中在前方/], ['雙星會坐', /集中在後方/]]) {
      const hit = ALL.find(({ xia }) => xia.pattern === pat);
      const r = xk.analyzeXuankong({ facingMountain: hit.xia.meta.face, chartYun: hit.yun, currentYun: hit.yun });
      const f = r.findings.find((x) => x.id === `xk.pattern.${PATTERN_ID[pat]}`);
      assert.match(f.body, re);
      assert.equal(f.tag, 'source');
    }
  });
  it('騎線與 3 個端點: 只要求不崩潰並帶旗標(軟斷言在 fixtures 之外再確認 analyzeXuankong 也一致)', () => {
    for (const deg of [340.5, 349.5, 352.5]) {
      const r = xk.analyzeXuankong({ facing: deg, chartYun: 9, currentYun: 9 });
      assert.equal(r.locate.ridingLine, true, String(deg));
      assert.ok(r.meta.warnings.includes('ridingLine'));
      assert.ok(r.findings.some((f) => f.id === 'xk.locate.riding' || f.id === 'xk.locate.jian'));
    }
  });
  it('入運依據流到 chart: moveIn 與 renovation 改變 chartYun 與格局', () => {
    const r = xk.analyzeXuankong({ facing: 180, builtAt: utc(2010, 6, 1), movedInAt: utc(2025, 6, 1), now: NOW }, { yunBasis: 'moveIn' });
    assert.deepEqual([r.meta.chartYun, r.meta.yun.basis, r.pattern], [9, 'moveIn', '雙星會坐']);
    assert.match(r.meta.yun.schoolNote, /各派意見不同/);
  });
  it('形巒條件矩陣(規格 2.4.11): FORM_MATRIX == 規格表;每張盤一則形巒 Finding,雙星會坐附另一派說法(D35)', () => {
    const rows = {};
    const section = SPEC_TEXT.slice(SPEC_TEXT.indexOf('#### 2.4.11'), SPEC_TEXT.indexOf('#### 2.4.12'));
    for (const line of section.split('\n')) {
      const cells = line.split('|').map((x) => x.trim());
      if (xk.PATTERN_NAMES.includes(cells[1])) rows[cells[1]] = { ideal: cells[2], off: cells[3] };
    }
    assert.deepEqual(Object.keys(rows).sort(), [...xk.PATTERN_NAMES].sort());
    for (const [name, r] of Object.entries(rows)) {
      assert.equal(xk.FORM_MATRIX[name].ideal, r.ideal, `${name} 理想`);
      if (name !== '雙星會坐') assert.equal(xk.FORM_MATRIX[name].off, r.off, `${name} 偏一邊`);
    }
    assert.match(xk.FORM_MATRIX['雙星會坐'].off, /溫和版/);
    assert.match(xk.FORM_MATRIX['雙星會坐'].offStrict, /SOHU-912417602/);
    for (const pattern of xk.PATTERN_NAMES) {
      const hit = ALL.find(({ xia }) => xia.pattern === pattern);
      const r = xk.analyzeXuankong({ facingMountain: hit.xia.meta.face, chartYun: hit.yun, currentYun: hit.yun });
      const f = r.findings.find((x) => x.id === `xk.form.${PATTERN_ID[pattern]}`);
      assert.ok(f, pattern);
      assert.equal(f.tag, 'source');
      assert.ok(f.body.includes(xk.FORM_MATRIX[pattern].ideal));
      if (pattern === '雙星會坐') assert.match(f.schoolNote, /溫和版.*較嚴厲/);
      const indoor = r.findings.find((x) => x.id === 'xk.form.indoor');
      assert.deepEqual([indoor.tag, indoor.confidence], ['inference', 'low']);
    }
  });
  it('同性相兼超過限度(空亡帶): 只警示、盤仍為下卦(規格 2.4.14)', () => {
    const r = xk.analyzeXuankong({ facing: 6.5, chartYun: 9, currentYun: 9 }); // 子向偏癸 6.5 度,同陰,超過 6 度
    assert.deepEqual([r.locate.kind, r.locate.needTi, r.locate.geo.level, r.locate.outer], ['同陰陽', false, 'void', true]);
    assert.equal(r.chart.meta.ti, false);
    const f = r.findings.find((x) => x.id === 'xk.locate.jian');
    assert.equal(f.level, 'caution');
    assert.match(f.body, /空亡/);
    assert.match(f.body, /只作警示/);
    // 開替卦也不替
    assert.equal(xk.analyzeXuankong({ facing: 6.5, chartYun: 9, currentYun: 9 }, { useTiGua: true }).chart.meta.ti, false);
    // 邊緣帶(jian_caution)只提示
    const edge = xk.analyzeXuankong({ facing: 345 - 5.5, chartYun: 9, currentYun: 9 }); // 壬向偏亥 5.5 度,出卦,5 到 6 度
    assert.equal(edge.locate.geo.level, 'jian_caution');
    assert.match(edge.findings.find((x) => x.id === 'xk.locate.jian').body, /邊緣/);
  });
  it('方位基準連同結果一起回存(規格 1.3): northMode / declination / declinationDate', () => {
    const d = xk.analyzeXuankong(base(180));
    assert.deepEqual([d.meta.northMode, d.meta.declination, d.meta.declinationDate], ['magnetic', null, null]);
    const t = xk.analyzeXuankong(base(180, { northMode: 'true', declination: -5.06, declinationDate: '2026-09-29' }));
    assert.deepEqual([t.meta.northMode, t.meta.declination, t.meta.declinationDate], ['true', -5.06, '2026-09-29']);
    throwsCode(() => xk.analyzeXuankong(base(180, { northMode: 'grid' })), 'INVALID_OPTION');
    throwsCode(() => xk.analyzeXuankong(base(180, { declination: NaN })), 'INVALID_OPTION');
  });
  it('locate 帶完整 geo 分析,xuankong 只讀 needsTiGua', () => {
    const r = xk.analyzeXuankong(base(175));
    assert.equal(r.locate.geo.mountain, '午');
    assert.equal(r.locate.needTi, r.locate.geo.needsTiGua);
    assert.equal(r.locate.sit, r.locate.geo.opposite);
    assert.equal(r.locate.kind, '陰陽差錯');
  });
});

// luopan + sensor 獨立審查用的模糊測試(fuzz)與差分測試。
// 做法: 自帶 mulberry32 種子產生大量隨機與極端輸入,(a) 檢查規格 4.4 的屬性,(b) 與「依規格文字另寫的簡單慢速 oracle」
// 逐筆比對。oracle 不 import 實作的內部表,只用規格 2.8、2.9 的文字與數字(28 宿寬、64 卦上下卦名表、色票對比、W3C 旋轉矩陣…)。
// 差分 runner 另有突變測試(規格 4.2 第 3 點): 故意改錯 oracle,runner 必須抓得出來。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { circDiff } from '../helpers/harness.js';
import * as geo from '../../src/core/geo.js';
import * as lp from '../../src/core/luopan.js';
import * as sc from '../../src/core/sensor-core.js';
import { createCompassSource, createBrowserEnv } from '../../src/core/sensor.js';

// ═══════════════════════════ 0. 共用工具 ═══════════════════════════

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTREME_BEARINGS = [0, -0, 7.5, -7.5, 15, 22.5, 337.5, 352.5, 359.99999999999994, 360, -360, 720, -720, 1e6 + 0.25,
  -1e6 - 0.75, 1e9, 4.5e15, -4.5e15, 5e-324, -5e-324, 1e-300, 180, -180, 174, 187.4, 7.499999999999999, 7.500000000000001,
  352.49999999999994, 352.50000000000006, 1e15 + 0.5];

/** 預設種子固定(結果可重現);要多跑幾組種子: FUZZ_SEED=1 node --test test/fuzz/luopan_sensor.fuzz.test.js */
const SEED_SHIFT = Number(process.env.FUZZ_SEED ?? 0) * 104729;

function makeGen(seed) {
  const rnd = mulberry32(seed + SEED_SHIFT);
  const g = {
    rnd,
    between: (a, b) => a + (b - a) * rnd(),
    int: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
  };
  /** 任意方位角: 一般、寬範圍、7.5 的整數倍(界線)、界線附近的浮點抖動、極端值。 */
  g.bearing = () => {
    const r = rnd();
    if (r < 0.35) return g.between(0, 360);
    if (r < 0.5) return g.between(-2000, 2000);
    if (r < 0.7) return 7.5 * g.int(-200, 400);
    if (r < 0.8) return 7.5 * g.int(-40, 80) + g.pick([-1, 1]) * g.pick([1e-9, 1e-12, 1e-14]);
    if (r < 0.9) return g.pick(EXTREME_BEARINGS);
    return g.between(-1e7, 1e7);
  };
  return g;
}

/** 與規格 1.3 相同的正規化,但已在 [0,360) 內的值原樣回傳(否則 7.499999999999999+360 會進位成 7.5)。 */
const nm = (b) => (b >= 0 && b < 360 ? b + 0 : ((b % 360) + 360) % 360);
/** 半開區間 [lo,hi) 是否含 nb(lo、hi 皆為 0.5 的倍數,加減 360 都精確;不做會進位的加法)。 */
const inHalfOpen = (nb, lo, hi) => [-360, 0, 360].some((sh) => nb >= lo + sh && nb < hi + sh);
/** nb 到「offset + period 整數倍」最近界線的距離。 */
const distToGrid = (nb, offset, period) => {
  const x = nb - offset;
  return Math.abs(x - Math.round(x / period) * period);
};

/** 差分 runner: 逐筆比對實作與 oracle,回傳第一個不一致,全對回 null。 */
function diffRun({ n, gen, impl, oracle, eq = isDeepStrictEqual, skip = () => false }) {
  for (let i = 0; i < n; i += 1) {
    const x = gen(i);
    if (skip(x)) continue;
    let actual;
    try {
      actual = impl(x);
    } catch (e) {
      actual = { threw: e.message };
    }
    const expected = oracle(x);
    if (!eq(actual, expected)) return { i, x, actual, expected };
  }
  return null;
}
const expectNoDiff = (res, label) => assert.equal(res, null, `${label}: ${JSON.stringify(res)}`);
const expectDiff = (res, label) => assert.notEqual(res, null, `突變測試: ${label} 應被 runner 抓出`);

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const cdiff = (a, b) => circDiff(a, b);

function deepFreezeCopy(v) {
  const c = JSON.parse(JSON.stringify(v));
  const f = (o) => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      Object.values(o).forEach(f);
    }
  };
  f(c);
  return c;
}

/** 收集所有「JSON 來回不等」(-0、NaN、undefined 欄位、Date…)的函式,一次報告。 */
function jsonProblems(label, value, sink) {
  let round;
  try {
    round = JSON.parse(JSON.stringify(value));
  } catch (e) {
    if (!sink.has(label)) sink.set(label, `JSON 失敗 ${e.message}`);
    return;
  }
  if (!isDeepStrictEqual(round, value) && !sink.has(label)) sink.set(label, `JSON 來回不等: ${JSON.stringify(value)}`);
}

// ═══════════════════════════ 1. luopan oracle(依規格文字獨立撰寫) ═══════════════════════════

const NAMES24 = '子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬';
const GUA8 = '坎艮震巽離坤兌乾';
const SPEC_TERMS = ['冬至', '小寒', '大寒', '立春', '雨水', '驚蟄', '春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至', '小暑', '大暑',
  '立秋', '處暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪'];

/** 地盤: 山 i 涵蓋 [15i-7.5,15i+7.5);人盤 [15i-15,15i);天盤 [15i,15i+15)。 */
function oMountainIndex(b, plate = 'earth') {
  const nb = nm(b);
  const lo = { earth: -7.5, ren: -15, tian: 0 }[plate];
  for (let i = 0; i < 24; i += 1) if (inHalfOpen(nb, 15 * i + lo, 15 * i + lo + 15)) return i;
  throw new Error(`oracle 找不到山 ${nb}`);
}
function oGuaIndex(b) {
  const nb = nm(b);
  for (let k = 0; k < 8; k += 1) if (inHalfOpen(nb, 45 * k - 22.5, 45 * k + 22.5)) return k;
  throw new Error('oracle 找不到卦');
}
function oBranchIndex(b) {
  const nb = nm(b);
  for (let k = 0; k < 12; k += 1) if (inHalfOpen(nb, 30 * k - 15, 30 * k + 15)) return k;
  throw new Error('oracle 找不到地支');
}

// 28 宿: 宿序自虛起沿方位角增加的方向「倒著走」(規格 2.8.3),寬度依規格古度表(以名稱查,不依實作順序)。
const XIU_BEARING_ORDER = [...'虛女牛斗箕尾心房氐亢角軫翼張星柳鬼井參觜畢昴胃婁奎壁室危'];
const XIU_GU = {
  角: 12.75, 亢: 9.75, 氐: 16.25, 房: 5.75, 心: 6, 尾: 18, 箕: 9.5, 斗: 22.75, 牛: 7, 女: 11, 虛: 9.25, 危: 16, 室: 18.25, 壁: 9.75,
  奎: 18, 婁: 12.75, 胃: 15.25, 昴: 11, 畢: 16.5, 觜: 0.5, 參: 9.5, 井: 30.25, 鬼: 2.5, 柳: 13.5, 星: 6.75, 張: 17.75, 翼: 20.25, 軫: 18.75,
};
const XIU_TABLE = (() => {
  let acc = 0;
  return XIU_BEARING_ORDER.map((name) => {
    const row = { name, startGu: acc, endGu: acc + XIU_GU[name] };
    acc += XIU_GU[name];
    return row;
  });
})();
function oXiu(b) {
  const nb = nm(b);
  const g = (nb * 365.25) / 360;
  const row = XIU_TABLE.find((r) => g >= r.startGu && g < r.endGu) ?? XIU_TABLE[27];
  const distGu = Math.min(...XIU_TABLE.map((r) => Math.abs(g - r.startGu)), Math.abs(g - 365.25));
  return { name: row.name, ruSuGu: row.endGu - g, distGu };
}

// 120 分金(規格 2.8.4)
function oFenjin(b) {
  const nb = nm(b);
  const x = nm(nb - 352.5);
  const n = Math.min(119, Math.floor(x / 3));
  const mi = Math.floor(n / 5);
  const branch = '子丑寅卯辰巳午未申酉戌亥'[Math.floor(mi / 2)]; // 干與四維山沿用前一位地支
  const yang = Math.floor(mi / 2) % 2 === 0;
  const stem = (yang ? '甲丙戊庚壬' : '乙丁己辛癸')[n % 5];
  return { index: n, name: stem + branch, mountain: NAMES24[mi], slot: n % 5, wangxiang: '丙丁庚辛'.includes(stem), displayable: mi % 2 === 0, dist: distToGrid(nb, 352.5, 3) };
}

// 64 卦: 上下卦名表(King Wen 名,以 [上卦][下卦] 查),圓圖序 k 的下卦 = 序[k>>3]、上卦 = 序[k&7]
const HEX_ORDER = [...'乾兌離震巽坎艮坤'];
const HEX_BY_UPPER = {
  乾: { 乾: '乾', 兌: '履', 離: '同人', 震: '無妄', 巽: '姤', 坎: '訟', 艮: '遯', 坤: '否' },
  兌: { 乾: '夬', 兌: '兌', 離: '革', 震: '隨', 巽: '大過', 坎: '困', 艮: '咸', 坤: '萃' },
  離: { 乾: '大有', 兌: '睽', 離: '離', 震: '噬嗑', 巽: '鼎', 坎: '未濟', 艮: '旅', 坤: '晉' },
  震: { 乾: '大壯', 兌: '歸妹', 離: '豐', 震: '震', 巽: '恆', 坎: '解', 艮: '小過', 坤: '豫' },
  巽: { 乾: '小畜', 兌: '中孚', 離: '家人', 震: '益', 巽: '巽', 坎: '渙', 艮: '漸', 坤: '觀' },
  坎: { 乾: '需', 兌: '節', 離: '既濟', 震: '屯', 巽: '井', 坎: '坎', 艮: '蹇', 坤: '比' },
  艮: { 乾: '大畜', 兌: '損', 離: '賁', 震: '頤', 巽: '蠱', 坎: '蒙', 艮: '艮', 坤: '剝' },
  坤: { 乾: '泰', 兌: '臨', 離: '明夷', 震: '復', 巽: '升', 坎: '師', 艮: '謙', 坤: '坤' },
};
const oHexName = (k) => HEX_BY_UPPER[HEX_ORDER[k & 7]][HEX_ORDER[k >> 3]];
function oHexagramIndex(b) {
  const nb = nm(b);
  for (let k = 0; k < 64; k += 1) {
    const lo = k <= 31 ? 180 - 5.625 * (k + 1) : 180 + 5.625 * (k - 32); // 5.625 = 45/8,二進位精確
    if (inHalfOpen(nb, lo, lo + 5.625)) return k;
  }
  throw new Error('oracle 找不到 64 卦');
}

// WCAG 2.x 對比度(用不同的 gamma 門檻寫法: 0.03928 舊版門檻與 0.04045 在 8 位元色值下結果相同)
function oContrast(fg, bg) {
  const lin = (hex) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = v.map((x) => {
      const c = x / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lin(fg);
  const b = lin(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ═══════════════════════════ 2. luopan 盤面資料差分 ═══════════════════════════

describe('luopan 差分: 各環查格 vs 規格 oracle', () => {
  const gBase = 0x1a2b3c;

  it('24 山地盤/人盤/天盤: cellAt 與 oracle 一致(界線抖動處只容許相鄰山)', () => {
    for (const [plate, ringId] of [['earth', 'mountains24'], ['ren', 'ren_plate'], ['tian', 'tian_plate']]) {
      const g = makeGen(gBase + plate.length);
      const off = { earth: 7.5, ren: 0, tian: 0 }[plate];
      const res = diffRun({
        n: 20000,
        gen: () => g.bearing(),
        impl: (b) => lp.cellAt(ringId, b).index,
        oracle: (b) => oMountainIndex(b, plate),
        skip: (b) => { const d = distToGrid(nm(b), off, 15); return d > 0 && d < 1e-9; },
      });
      expectNoDiff(res, `${ringId}`);
    }
  });

  it('界線抖動: cellAt 的山界誤差不超過 1e-9(結果必為界線兩側的山之一,且與 geo.mountainAt 至多差 1 山)', () => {
    const g = makeGen(gBase + 100);
    for (let i = 0; i < 20000; i += 1) {
      const k = g.int(-40, 80);
      const b = 7.5 * k + g.pick([-1, 1]) * g.pick([1e-15, 1e-14, 1e-13, 1e-12, 1e-10]);
      const nb = nm(b);
      const c = lp.cellAt('mountains24', b);
      const m = geo.mountainAt(b);
      const dm = Math.min((c.index - m.index + 24) % 24, (m.index - c.index + 24) % 24);
      assert.ok(dm <= 1, `b=${b} cellAt=${c.index} geo=${m.index}`);
      assert.ok(circDiff(nb, c.startDeg) <= 1e-9 || circDiff(nb, c.endDeg) <= 1e-9 || inHalfOpen(nb, c.startDeg, c.startDeg + 15), `b=${b}`);
    }
  });

  it('八卦環與洛書環(同一組 45 度格)', () => {
    const g = makeGen(gBase + 1);
    for (const ringId of ['bagua', 'luoshu']) {
      expectNoDiff(diffRun({
        n: 20000,
        gen: () => g.bearing(),
        impl: (b) => { const c = lp.cellAt(ringId, b); return [c.index, c.gua, c.dir8]; },
        oracle: (b) => { const k = oGuaIndex(b); return [k, GUA8[k], ['北', '東北', '東', '東南', '南', '西南', '西', '西北'][k]]; },
        skip: (b) => { const d = distToGrid(nm(b), 22.5, 45); return d > 0 && d < 1e-9; },
      }), ringId);
    }
  });

  it('節氣環: 冬至=子起與 24 山逐格對齊,黃經 = 270+15i', () => {
    const g = makeGen(gBase + 2);
    expectNoDiff(diffRun({
      n: 20000,
      gen: () => g.bearing(),
      impl: (b) => { const t = lp.solarTermAt(b); return [t.index, t.term, t.mountain, t.longitudeDeg]; },
      oracle: (b) => { const i = oMountainIndex(b); return [i, SPEC_TERMS[i], NAMES24[i], (270 + 15 * i) % 360]; },
      skip: (b) => { const d = distToGrid(nm(b), 7.5, 15); return d > 0 && d < 1e-9; },
    }), 'solarTermAt');
  });

  it('十二地支 30 度格', () => {
    const g = makeGen(gBase + 3);
    expectNoDiff(diffRun({
      n: 20000,
      gen: () => g.bearing(),
      impl: (b) => lp.branchCellAt(b).branch,
      oracle: (b) => '子丑寅卯辰巳午未申酉戌亥'[oBranchIndex(b)],
      skip: (b) => { const d = distToGrid(nm(b), 15, 30); return d > 0 && d < 1e-9; },
    }), 'branchCellAt');
  });

  it('28 宿: 名稱與入宿度與 oracle 一致(虛起於 0 度、宿序倒走)', () => {
    const g = makeGen(gBase + 4);
    let checked = 0;
    for (let i = 0; i < 30000; i += 1) {
      const b = g.bearing();
      const o = oXiu(b);
      if (o.distGu < 1e-9) continue;
      const x = lp.xiuAt(b);
      assert.equal(x.name, o.name, `b=${b}`);
      assert.ok(near(x.ruSuGu, o.ruSuGu, 1e-8), `b=${b} ru=${x.ruSuGu} 期望 ${o.ruSuGu}`);
      assert.equal(lp.cellAt('xiu28', b).name, o.name, `cellAt b=${b}`);
      assert.ok(x.ruSuGu > 0 && x.ruSuGu <= x.widthGu + 1e-9, `入宿度應在 (0,宿寬]: b=${b} ${x.ruSuGu}`);
      checked += 1;
    }
    assert.ok(checked > 20000);
  });

  it('28 宿界線: 精確界線歸順時針下一宿,抖動處只容許相鄰宿', () => {
    for (let k = 0; k < 28; k += 1) {
      const startDeg = (XIU_TABLE[k].startGu * 360) / 365.25;
      for (const jitter of [0, 1e-13, -1e-13, 1e-10, -1e-10]) {
        const x = lp.xiuAt(startDeg + jitter);
        const want = jitter < 0 ? XIU_TABLE[(k + 27) % 28].name : XIU_TABLE[k].name;
        if (Math.abs(jitter) >= 1e-10) assert.equal(x.name, want, `宿 ${XIU_TABLE[k].name} jitter=${jitter}`);
        else assert.ok([XIU_TABLE[k].name, XIU_TABLE[(k + 27) % 28].name].includes(x.name), `宿界抖動 ${XIU_TABLE[k].name}`);
      }
    }
  });

  it('120 分金: 分金名、山、旺相、可顯示旗標與 oracle 一致', () => {
    const g = makeGen(gBase + 5);
    expectNoDiff(diffRun({
      n: 30000,
      gen: () => g.bearing(),
      impl: (b) => { const f = lp.fenjinAt(b); return { index: f.index, name: f.name, mountain: f.mountain, slot: f.slot, wangxiang: f.wangxiang, displayable: f.displayable, confidence: f.confidence }; },
      oracle: (b) => { const o = oFenjin(b); return { index: o.index, name: o.name, mountain: o.mountain, slot: o.slot, wangxiang: o.wangxiang, displayable: o.displayable, confidence: o.displayable ? 'high' : 'low' }; },
      skip: (b) => oFenjin(b).dist < 1e-9,
    }), 'fenjinAt');
  });

  it('64 卦圓圖: 索引、卦名、上下卦與 oracle 一致', () => {
    const g = makeGen(gBase + 6);
    expectNoDiff(diffRun({
      n: 30000,
      gen: () => g.bearing(),
      impl: (b) => { const h = lp.hexagramAt(b); return [h.index, h.name, h.lower, h.upper]; },
      oracle: (b) => { const k = oHexagramIndex(b); return [k, oHexName(k), HEX_ORDER[k >> 3], HEX_ORDER[k & 7]]; },
      skip: (b) => { const d = distToGrid(nm(b), 0, 5.625); return d > 0 && d < 1e-9; },
    }), 'hexagramAt');
  });

  it('三針: ren 中針 index=(floor(b/15)+1)%24、tian 縫針 index=floor(b/15)%24(規格 2.1.4)', () => {
    const g = makeGen(gBase + 7);
    expectNoDiff(diffRun({
      n: 20000,
      gen: () => g.bearing(),
      impl: (b) => { const r = lp.readout(b, { showSanZhen: true }).sanzhen; return [r.ren, r.tian]; },
      oracle: (b) => { const nb = nm(b); return [NAMES24[(Math.floor(nb / 15) + 1) % 24], NAMES24[Math.floor(nb / 15) % 24]]; },
      skip: (b) => { const d = distToGrid(nm(b), 0, 15); return d > 0 && d < 1e-9; },
    }), 'sanzhen');
  });

  it('突變測試: 故意改錯的 oracle 必被 runner 抓出', () => {
    const g = makeGen(77);
    const base = { n: 3000, gen: () => g.bearing() };
    expectDiff(diffRun({ ...base, impl: (b) => lp.cellAt('mountains24', b).index, oracle: (b) => (oMountainIndex(b) + 1) % 24 }), '山 index 偏 1');
    expectDiff(diffRun({ ...base, impl: (b) => lp.xiuAt(b).name, oracle: (b) => XIU_TABLE[(XIU_TABLE.findIndex((r) => r.name === oXiu(b).name) + 1) % 28].name }), '宿名偏 1');
    expectDiff(diffRun({ ...base, impl: (b) => lp.fenjinAt(b).name, oracle: (b) => oFenjin(b).name.replace('甲', '乙') }), '分金名改錯');
    expectDiff(diffRun({ ...base, impl: (b) => lp.hexagramAt(b).name, oracle: (b) => oHexName((oHexagramIndex(b) + 1) % 64) }), '64 卦偏 1');
    expectDiff(diffRun({ ...base, impl: (b) => lp.solarTermAt(b).term, oracle: (b) => SPEC_TERMS[(oMountainIndex(b) + 23) % 24] }), '節氣偏 1');
    // oracle 正確時 runner 不會誤報
    expectNoDiff(diffRun({ ...base, impl: (b) => lp.cellAt('mountains24', b).index, oracle: (b) => oMountainIndex(b), skip: (b) => { const d = distToGrid(nm(b), 7.5, 15); return d > 0 && d < 1e-9; } }), '對照組');
  });
});

// ═══════════════════════════ 3. luopan 環資料屬性 ═══════════════════════════

describe('luopan 環資料屬性(規格 4.4、2.8.1-2.8.5)', () => {
  const CELLED = lp.RINGS.filter((r) => r.kind === 'cells');

  it('各環連續無縫、寬度合計 360、起迄與中心自洽', () => {
    for (const ring of CELLED) {
      const cells = ring.id === 'hexagram64' ? [...ring.cells].sort((a, b) => a.startDeg - b.startDeg) : ring.cells;
      let total = 0;
      cells.forEach((c, i) => {
        const nxt = cells[(i + 1) % cells.length];
        assert.ok(c.widthDeg > 0, `${ring.id}[${i}] 寬度須為正`);
        assert.ok(c.startDeg >= 0 && c.startDeg < 360, `${ring.id}[${i}] start 應在 [0,360): ${c.startDeg}`);
        assert.ok(c.endDeg > 0 && c.endDeg <= 360, `${ring.id}[${i}] end 應在 (0,360]: ${c.endDeg}`);
        assert.ok(cdiff(c.endDeg, nxt.startDeg) <= 1e-9, `${ring.id}[${i}] 與下一格有縫: ${c.endDeg} vs ${nxt.startDeg}`);
        assert.ok(cdiff(nm(c.startDeg + c.widthDeg), nm(c.endDeg)) <= 1e-9, `${ring.id}[${i}] 寬度與起迄不符`);
        assert.ok(cdiff(c.centerDeg, nm(c.startDeg + c.widthDeg / 2)) <= 1e-9, `${ring.id}[${i}] 中心不符`);
        total += c.widthDeg;
      });
      assert.ok(near(total, 360, 1e-9), `${ring.id} 寬度合計 ${total}`);
    }
  });

  it('每個方位剛好落在一格內(獨立包含判斷),cellAt 回傳的格含該方位', () => {
    const g = makeGen(0xabc);
    for (const ring of CELLED) {
      for (let i = 0; i < 4000; i += 1) {
        const nb = nm(g.bearing());
        const hits = ring.cells.filter((c) => (c.startDeg < c.endDeg ? nb >= c.startDeg && nb < c.endDeg : nb >= c.startDeg || nb < c.endDeg));
        assert.equal(hits.length, 1, `${ring.id} b=${nb} 命中 ${hits.length} 格`);
        assert.equal(lp.cellAt(ring.id, nb), hits[0]);
      }
    }
  });

  it('環的種類錯誤碼: 天池與刻度環無格、未知環', () => {
    throwsCode(() => lp.cellAt('tianchi', 10), 'RING_NOT_CELLED');
    throwsCode(() => lp.cellAt('scale360', 10), 'RING_NOT_CELLED');
    throwsCode(() => lp.cellAt('nope', 10), 'UNKNOWN_RING');
    throwsCode(() => lp.ringById('nope'), 'UNKNOWN_RING');
    throwsCode(() => lp.ringById(undefined), 'UNKNOWN_RING');
  });

  it('環序規律與內外排列', () => {
    const ids = lp.RINGS.map((r) => r.id);
    assert.equal(ids[0], 'tianchi');
    for (const mode of ['A', 'B']) {
      const rows = lp.layoutRings(mode).rows.filter((r) => !r.auxiliary).map((r) => r.ringId);
      const inv = lp.ringOrderInvariants(rows);
      assert.deepEqual(inv, { tianchiFirst: true, jieqiAfterDi24: mode === 'A' ? true : null, renTianOutsideDi: mode === 'B' ? true : null, xiuOutermost: true, scaleOutermost: true }, `版面 ${mode}`);
    }
    // 反例: 故意打亂必被規律抓出
    assert.equal(lp.ringOrderInvariants(['bagua', 'tianchi', 'mountains24', 'solar_terms']).tianchiFirst, false);
    assert.equal(lp.ringOrderInvariants(['tianchi', 'mountains24', 'other', 'solar_terms']).jieqiAfterDi24, false);
    assert.equal(lp.ringOrderInvariants(['tianchi', 'xiu28', 'other', 'scale360']).xiuOutermost, false);
    assert.equal(lp.ringOrderInvariants(['tianchi', 'scale360', 'xiu28']).scaleOutermost, false);
  });

  it('24 山: 陽=乾坤艮巽+壬丙甲庚+寅申巳亥、陰=其餘;記憶檢查與三合紅黑字 12/12', () => {
    const YANG = new Set([...'乾坤艮巽壬丙甲庚寅申巳亥']);
    const cells = lp.ringById('mountains24').cells;
    cells.forEach((c, i) => {
      assert.equal(c.name, NAMES24[i]);
      assert.equal(c.yinyangSanyuan, YANG.has(c.name) ? '陽' : '陰', c.name);
      assert.equal(lp.yinyangOf(c.name, 'sanyuan'), c.yinyangSanyuan);
      assert.equal(lp.yinyangOf(c.name), c.yinyangSanyuan, '預設 scheme = sanyuan');
      assert.equal(lp.yinyangOf(c.name, 'sanhe'), c.yinyangSanhe);
    });
    // 四正卦(坎離震兌)地天人 = 陽陰陰;四隅卦(乾坤艮巽)= 陰陽陽
    for (const gua of '坎離震兌') assert.deepEqual(cells.filter((c) => c.gua === gua).sort((a, b) => ['地元', '天元', '人元'].indexOf(a.dragon) - ['地元', '天元', '人元'].indexOf(b.dragon)).map((c) => c.yinyangSanyuan), ['陽', '陰', '陰'], gua);
    for (const gua of '乾坤艮巽') assert.deepEqual(cells.filter((c) => c.gua === gua).sort((a, b) => ['地元', '天元', '人元'].indexOf(a.dragon) - ['地元', '天元', '人元'].indexOf(b.dragon)).map((c) => c.yinyangSanyuan), ['陰', '陽', '陽'], gua);
    assert.equal(cells.filter((c) => c.yinyangSanhe === '陽').length, 12);
    assert.equal(cells.filter((c) => c.yinyangSanyuan === '陽').length, 12);
    throwsCode(() => lp.yinyangOf('子', 'other'), 'INVALID_OPTION');
    throwsCode(() => lp.yinyangOf('X'), 'UNKNOWN_MOUNTAIN');
  });

  it('與 geo 的 24 山、八卦、元龍、陰陽逐山一致(跨模組一致性 24/24)', () => {
    for (let i = 0; i < 24; i += 1) {
      const c = lp.ringById('mountains24').cells[i];
      const m = geo.mountainAt(15 * i);
      assert.deepEqual([c.name, c.gua, c.dragon, c.yinyangSanyuan, c.dir8, c.opposite], [m.name, m.gua, m.dragon, m.yinyang, m.dir8, m.opposite]);
    }
  });

  it('大小空亡線: 8 條卦界 + 16 條山界,各為 7.5 + 15k', () => {
    const { da, xiao } = lp.kongwangBoundaries();
    assert.equal(da.length, 8);
    assert.equal(xiao.length, 16);
    assert.deepEqual(da, [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]);
    assert.deepEqual([...da, ...xiao].sort((a, b) => a - b), Array.from({ length: 24 }, (_, k) => 7.5 + 15 * k));
  });

  it('120 分金: 60 甲子各恰出現 2 次、丙丁庚辛開頭 48 格、子山五格、午向 174°=甲午、天干與地支同陰陽', () => {
    const cells = lp.ringById('fenjin120').cells;
    assert.equal(cells.length, 120);
    const count = new Map();
    for (const c of cells) count.set(c.name, (count.get(c.name) ?? 0) + 1);
    assert.equal(count.size, 60);
    for (const [k, v] of count) assert.equal(v, 2, k);
    assert.equal(cells.filter((c) => '丙丁庚辛'.includes(c.stem)).length, 48);
    assert.equal(cells.filter((c) => c.wangxiang).length, 48);
    for (const c of cells) assert.equal('甲乙丙丁戊己庚辛壬癸'.indexOf(c.stem) % 2, '子丑寅卯辰巳午未申酉戌亥'.indexOf(c.branch) % 2, `${c.name} 干支同陰陽`);
    assert.deepEqual(cells.slice(0, 5).map((c) => c.name), ['甲子', '丙子', '戊子', '庚子', '壬子']);
    assert.equal(lp.fenjinAt(174).name, '甲午');
    // 環從壬|子縫 352.5 起,每格 3 度
    assert.equal(cells[0].startDeg, 352.5);
    assert.equal(cells[119].endDeg, 352.5);
    // 八干四維山的分金 confidence=low、不可顯示;地支山 high 且可顯示
    for (const c of cells) {
      const isBranchMountain = '子丑寅卯辰巳午未申酉戌亥'.includes(c.mountain);
      assert.equal(c.displayable, isBranchMountain, c.mountain);
      assert.equal(c.confidence, isBranchMountain ? 'high' : 'low', c.mountain);
    }
  });

  it('64 卦: 錨點乾[174.375,180)、復[0,5.625)、姤[180,185.625)、坤[354.375,360),64 名互異,坤 end=360', () => {
    assert.equal(lp.hexagramAt(174.375).name, '乾');
    assert.equal(lp.hexagramAt(179.999).name, '乾');
    assert.equal(lp.hexagramAt(0).name, '復');
    assert.equal(lp.hexagramAt(5.624).name, '復');
    assert.equal(lp.hexagramAt(180).name, '姤');
    assert.equal(lp.hexagramAt(354.375).name, '坤');
    assert.equal(lp.hexagramAt(359.999).name, '坤');
    const cells = lp.ringById('hexagram64').cells;
    assert.equal(new Set(cells.map((c) => c.name)).size, 64);
    assert.equal(cells[63].endDeg, 360);
    assert.ok(!lp.HEXAGRAM_NAMES.includes('无妄') && lp.HEXAGRAM_NAMES.includes('無妄'));
    for (let k = 0; k < 64; k += 1) assert.equal(cells[k].name, oHexName(k), `圓圖序 ${k}`);
    // 爻線: 下卦三爻 + 上卦三爻,初爻到上爻
    const LINES = { 乾: [1, 1, 1], 兌: [1, 1, 0], 離: [1, 0, 1], 震: [1, 0, 0], 巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0] };
    for (const c of cells) assert.deepEqual(c.lines, [...LINES[c.lower], ...LINES[c.upper]], c.name);
  });

  it('28 宿: 虛起於 0 度、危終於 360;宿序倒走;午中=張 2.125;古度合計 365.25;窄宿集合 [觜,鬼]', () => {
    const cells = lp.ringById('xiu28').cells;
    assert.deepEqual(cells.map((c) => c.name), XIU_BEARING_ORDER);
    assert.equal(cells[0].startDeg, 0);
    assert.equal(cells[27].endDeg, 360);
    assert.equal(lp.xiuAt(0).name, '虛');
    assert.equal(lp.xiuAt(359.999).name, '危');
    const x = lp.xiuAt(180);
    assert.equal(x.name, '張');
    assert.ok(near(x.ruSuGu, 2.125, 1e-9), `午中入宿度 ${x.ruSuGu}`);
    assert.equal(Object.values(XIU_GU).reduce((a, b) => a + b, 0), 365.25);
    assert.deepEqual([...lp.XIU_WIDTHS_GU].reduce((a, b) => a + b, 0), 365.25);
    assert.deepEqual(lp.narrowMansions().names, ['觜', '鬼']);
    const nm4 = lp.narrowMansions();
    assert.ok(near(nm4.minDeg, 4.93, 0.005), `13px 字最小角寬 ${nm4.minDeg}`);
    const plan = Object.fromEntries(lp.xiuLabelPlan().map((p) => [p.name, p.plan]));
    for (const n of ['觜', '鬼']) assert.equal(plan[n], 'leader');
    for (const n of ['房', '心', '星', '牛']) assert.equal(plan[n], 'tight', n);
    assert.equal(Object.values(plan).filter((v) => v === 'normal').length, 22);
    for (const c of cells) assert.ok(near(c.widthDeg, (XIU_GU[c.name] * 360) / 365.25, 1e-9), c.name);
  });

  it('四象跨度中心: 玄武跨 0 度', () => {
    for (const grp of ['東方青龍', '北方玄武', '西方白虎', '南方朱雀']) {
      const c = lp.xiuGroupCenterDeg(grp);
      assert.ok(c >= 0 && c < 360);
    }
    // 北方玄武 斗牛女虛危室壁: 跨度起於斗、終於壁
    const n = lp.ringById('xiu28').cells.filter((c) => '斗牛女虛危室壁'.includes(c.name));
    const span = n.reduce((a, c) => a + c.widthDeg, 0);
    // 方位角增加的方向宿序倒走,所以跨度自 壁 起、經 室危虛女牛、止於 斗
    const bi = n.find((c) => c.name === '壁');
    assert.ok(cdiff(lp.xiuGroupCenterDeg('北方玄武'), nm(bi.startDeg + span / 2)) < 1e-9);
    throwsCode(() => lp.xiuGroupCenterDeg('中央'), 'UNKNOWN_XIU_GROUP');
    throwsCode(() => lp.xiuGroupCenterDeg('toString'), 'UNKNOWN_XIU_GROUP');
  });

  it('刻度: 30 標數字、10 長線、5 中線、其餘細線;負整數與大整數;非整數丟錯', () => {
    assert.equal(lp.SCALE_TICKS.length, 360);
    for (const t of lp.SCALE_TICKS) {
      assert.equal(t.kind, t.deg % 30 === 0 ? 'label' : t.deg % 10 === 0 ? 'long' : t.deg % 5 === 0 ? 'mid' : 'thin');
      assert.equal(t.label, t.deg % 30 === 0 ? String(t.deg) : null);
    }
    const g = makeGen(5);
    for (let i = 0; i < 2000; i += 1) {
      const d = g.int(-100000, 100000);
      assert.equal(lp.scaleTickKind(d), lp.SCALE_TICKS[nm(d)].kind, String(d));
    }
    throwsCode(() => lp.scaleTickKind(0.5), 'INVALID_OPTION');
    throwsCode(() => lp.scaleTickKind(NaN), 'INVALID_OPTION');
    throwsCode(() => lp.scaleTickKind('30'), 'INVALID_OPTION');
    assert.equal(lp.scaleTickKind(-0), 'label');
  });

  it('八卦環資料: 後天卦爻、先天爻在後天卦名位置、洛書格(南上 4 9 2 / 3 5 7 / 8 1 6 各線和 15)', () => {
    const LINES = { 乾: [1, 1, 1], 兌: [1, 1, 0], 離: [1, 0, 1], 震: [1, 0, 0], 巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0] };
    const XT = { 坤: 0, 震: 45, 離: 90, 兌: 135, 乾: 180, 巽: 225, 坎: 270, 艮: 315 }; // 先天方位角
    for (const c of lp.ringById('bagua').cells) {
      assert.deepEqual(c.linesHoutian, LINES[c.gua]);
      assert.equal(c.xiantian.gua, Object.keys(XT).find((k) => XT[k] === 45 * c.index), c.gua);
      assert.deepEqual(lp.baguaDrawSpec(c.gua), { name: c.gua, lines: LINES[c.gua], mode: 'houtian' });
      assert.deepEqual(lp.baguaDrawSpec(c.gua, { traditional: true }), { name: c.gua, lines: LINES[c.xiantian.gua], mode: 'traditional' });
    }
    const LUOSHU = { 坎: 1, 坤: 2, 震: 3, 巽: 4, 乾: 6, 兌: 7, 艮: 8, 離: 9 };
    for (const c of lp.ringById('luoshu').cells) assert.equal(c.luoshu, LUOSHU[c.gua]);
    // 南上格: 上列 東南(4) 南(9) 西南(2)
    const at = (dir) => lp.ringById('luoshu').cells.find((c) => c.dir8 === dir).luoshu;
    const grid = [[at('東南'), at('南'), at('西南')], [at('東'), 5, at('西')], [at('東北'), at('北'), at('西北')]];
    assert.deepEqual(grid, [[4, 9, 2], [3, 5, 7], [8, 1, 6]]);
    throwsCode(() => lp.baguaDrawSpec('中'), 'UNKNOWN_GUA');
    throwsCode(() => lp.baguaDrawSpec(undefined), 'UNKNOWN_GUA');
  });

  it('RINGS、常數全部深凍結,無法被外部改寫', () => {
    const frozen = (v, at) => {
      if (v && typeof v === 'object') {
        assert.ok(Object.isFrozen(v), `${at} 未凍結`);
        Object.entries(v).forEach(([k, x]) => frozen(x, `${at}.${k}`));
      }
    };
    frozen(lp.RINGS, 'RINGS');
    for (const name of ['PALETTE', 'LEGACY_WUXING_COLORS', 'OVERLAY_STYLE', 'NEEDLE_CONVENTIONS', 'GESTURE', 'SOLAR_TERMS', 'NINE_STAR_COLORS', 'SCALE_TICKS', 'BRANCH_CELLS', 'STEM_CENTERS', 'XIU_WIDTHS_GU', 'XIU_ANIMALS', 'XIU_GROUPS', 'HEXAGRAM_NAMES', 'DRAGON_BAND_TOKEN']) frozen(lp[name], name);
    assert.throws(() => { lp.RINGS[0].id = 'x'; }, TypeError);
    assert.throws(() => { lp.PALETTE.jade = '#000000'; }, TypeError);
  });
});

describe('luopan 補強: 格界自洽、常數表、規格文字比對', () => {
  it('每環每格: 起點屬於該格、迄點(取模)屬於下一格(半開區間,恰在界線歸順時針下一格)', () => {
    for (const ring of lp.RINGS.filter((r) => r.kind === 'cells')) {
      const order = ring.id === 'hexagram64' ? [...ring.cells].sort((a, b) => a.startDeg - b.startDeg) : ring.cells;
      order.forEach((c, i) => {
        assert.equal(lp.cellAt(ring.id, c.startDeg), c, `${ring.id}[${c.index}] start`);
        const nxt = order[(i + 1) % order.length];
        assert.equal(lp.cellAt(ring.id, nm(c.endDeg)), nxt, `${ring.id}[${c.index}] end 應屬下一格`);
      });
    }
    lp.ringById('xiu28').cells.forEach((c) => {
      const x = lp.xiuAt(c.startDeg);
      assert.equal(x.name, c.name);
      assert.ok(near(x.ruSuGu, c.widthGu, 1e-9), `${c.name} 起點入宿度 = 宿寬`);
    });
  });

  it('十二地支、天干中心、九星色、三合紅字、28 宿窄宿寬度數字 = 規格', () => {
    let acc = 0;
    lp.BRANCH_CELLS.forEach((c, k) => {
      assert.equal(c.branch, '子丑寅卯辰巳午未申酉戌亥'[k]);
      assert.equal(c.widthDeg, 30);
      assert.ok(cdiff(c.centerDeg, 30 * k) < 1e-12 && cdiff(c.startDeg, 30 * k - 15) < 1e-12);
      acc += c.widthDeg;
    });
    assert.equal(acc, 360);
    assert.deepEqual(lp.STEM_CENTERS, { 癸: 15, 甲: 75, 乙: 105, 丙: 165, 丁: 195, 庚: 255, 辛: 285, 壬: 345 });
    assert.deepEqual(lp.NINE_STAR_COLORS, { 1: '白', 2: '黑', 3: '碧', 4: '綠', 5: '黃', 6: '白', 7: '赤', 8: '白', 9: '紫' });
    assert.deepEqual(lp.SOLAR_TERMS, SPEC_TERMS);
    const yang = new Set(lp.ringById('mountains24').cells.filter((c) => c.yinyangSanhe === '陽').map((c) => c.name));
    assert.deepEqual([...yang].sort(), [...'子癸申辰午壬寅戌乾甲坤乙'].sort());
    const w = Object.fromEntries(lp.ringById('xiu28').cells.map((c) => [c.name, Math.round(c.widthDeg * 100) / 100]));
    assert.deepEqual([w.觜, w.鬼, w.房, w.心, w.星, w.牛], [0.49, 2.46, 5.67, 5.91, 6.65, 6.9]);
    assert.equal(lp.ringById('luoshu').center.luoshu, 5);
    assert.equal(lp.ringById('luoshu').center.wuxing, '土');
    // 各環預設顯示旗標: 三針只在模式 B、分金只做讀數、64 卦預設不放
    const vis = Object.fromEntries(lp.RINGS.map((r) => [r.id, r.defaultVisible]));
    assert.deepEqual([vis.ren_plate, vis.tian_plate, vis.fenjin120, vis.hexagram64, vis.solar_terms, vis.tianchi, vis.xiu28, vis.scale360], [false, false, false, false, true, true, true, true]);
    assert.equal(lp.ringById('fenjin120').readoutOnly, true);
  });

  it('字級建議與版面字體規格(2.8.6): 卦名 15 粗、洛書 13 粗、24 山 21 粗、節氣 10.5×2、人天盤 10、28 宿 14(窄 9)、刻度 9.5', () => {
    const A = Object.fromEntries(lp.layoutRings('A').rows.map((r) => [r.key, r.glyph]));
    assert.deepEqual([A.r1, A.r2, A.r3, A.r5, A.r7], [{ px: 15, bold: true, stackChars: 1 }, { px: 13, bold: true, stackChars: 1 }, { px: 21, bold: true, stackChars: 1 }, { px: 10.5, bold: false, stackChars: 2 }, { px: 9.5, bold: false, stackChars: 1 }]);
    assert.deepEqual(A.r6, { px: 14, bold: false, stackChars: 1, narrowPx: 9 });
    assert.equal(A.tianchi, null);
    assert.equal(A.r4, null);
    const B = Object.fromEntries(lp.layoutRings('B').rows.map((r) => [r.key, r.glyph]));
    assert.deepEqual([B.r5a.px, B.r5b.px], [10, 10]);
    assert.ok(lp.layoutRings('A').rows.find((r) => r.key === 'r4').auxiliary);
    assert.equal(lp.layoutRings('A').rows.filter((r) => r.auxiliary).length, 1);
  });

  it('字型堆疊逐字等於規格 2.8.9;色票 token 逐項等於規格 2.8.7 文字', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const spec = readFileSync(path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');
    const m = spec.match(/CSS 堆疊: `([^`]+)`/);
    assert.ok(m, '規格找不到字型堆疊');
    assert.equal(lp.KAI_FONT_STACK, m[1]);
    const line = spec.match(/色票\(深色漆面\): (.+)\n/)[1];
    const parsed = Object.fromEntries([...line.matchAll(/([a-z_0-9]+) `(#[0-9A-Fa-f]{6})`/g)].map((x) => [x[1], x[2]]));
    for (const [k, v] of Object.entries(parsed)) if (!k.startsWith('wx_fire') && !k.startsWith('wx_water')) assert.equal(lp.PALETTE[k], v, k);
    assert.equal(Object.keys(parsed).length, 18);
  });
});

describe('回歸: 本次審查修掉的問題', () => {
  it('unwrapAngleDelta / boundaryCrossings / dialAngleToward 對極大有限值不得溢位成 NaN', () => {
    for (const [a, b] of [[-1e308, 1e308], [1e308, -1e308], [1.7e308, 1.7e308], [-1e308, 0]]) {
      const u = lp.unwrapAngleDelta(a, b);
      assert.ok(Number.isFinite(u) && u >= -180 && u < 180, `${a} ${b} → ${u}`);
      assert.ok(Number.isInteger(lp.boundaryCrossings(a, b)), `boundaryCrossings ${a} ${b}`);
    }
    assert.ok(Number.isFinite(lp.dialAngleToward(0, 1e308)));
  });

  it('-0 不外洩: inertiaStep(負角速度, 0)、simulateInertia(-0)、createDragState(-0)、pointerAngleDeg(-0 座標)、decode accuracy=-0', () => {
    assert.ok(Object.is(lp.inertiaStep(-100, 0).deltaDeg, 0));
    assert.ok(Object.is(lp.simulateInertia(-0).finalOmega, 0) && Object.is(lp.simulateInertia(-0).totalDeg, 0));
    assert.ok(Object.is(lp.inertiaTotalDeg(-0), 0));
    assert.ok(Object.is(lp.createDragState(-0).dialDeg, 0));
    assert.equal(lp.pointerAngleDeg(-5, -0, 0, 0), 180, 'dy=-0 且在左側應為 180 而非 -180');
    assert.ok(Object.is(lp.pointerAngleDeg(5, -0, 0, 0), 0));
    assert.ok(!Object.is(sc.decodeOrientationEvent({ webkitCompassHeading: 10, webkitCompassAccuracy: -0 }).accuracyDeg, -0));
  });

  it('壞輸入丟碼而非 NaN/TypeError: stackHeightPx、glyphFits、emaVectorStep 的 state', () => {
    for (const bad of [[NaN, 1], [1, NaN], [-1, 1], [1, -1], ['2', 10], [1, 1, NaN]]) throwsCode(() => lp.stackHeightPx(...bad), 'INVALID_OPTION');
    for (const bad of [null, undefined, 5, 'x']) throwsCode(() => lp.glyphFits(bad), 'INVALID_OPTION');
    for (const bad of [undefined, 5, 'x', {}, { x: NaN, y: 0 }, { x: 0 }]) throwsCode(() => sc.emaVectorStep(bad, 10, 0.5), 'INVALID_OPTION');
    assert.equal(sc.emaHeading(undefined), null);
  });

  it('requestPermission 在 start() 呼叫的同一個同步呼叫堆疊內執行(規格 2.9.5: 必須在使用者手勢內)', async () => {
    let calledSync = false;
    const DOE = Object.assign(function () {}, { requestPermission: () => { calledSync = true; return Promise.resolve('granted'); } });
    const F = makeFakeEnv({ DOE });
    const s = createCompassSource({ env: F.env });
    const p = s.start();
    assert.equal(calledSync, true, 'requestPermission 不可等到 microtask 之後才呼叫,否則 iOS 會判定不在手勢內而 reject');
    await p;
    s.stop();
  });
});

// ═══════════════════════════ 4. luopan 版面、配色、字集 ═══════════════════════════

describe('luopan 版面、配色、字集(規格 2.8.6-2.8.9)', () => {
  const SPEC_A = [
    ['tianchi', 0, 0.188, 33.8, 16.9], ['r1', 0.188, 0.376, 33.8, 50.8], ['r2', 0.376, 0.4511, 13.5, 74.4], ['r3', 0.4511, 0.6203, 30.5, 96.4],
    ['r4', 0.6203, 0.6485, 5.1, 114.2], ['r5', 0.6485, 0.7735, 22.5, 128.0], ['r6', 0.7735, 0.9051, 23.7, 151.1], ['r7', 0.9051, 0.985, 14.4, 170.1],
  ];

  it('模式 A 逐環 r0/r1/環寬/中徑 = 規格表(表值為四位/一位小數)', () => {
    const { rows, outer } = lp.layoutRings('A');
    assert.equal(rows.length, 8);
    assert.ok(near(outer, 0.985, 1e-12));
    SPEC_A.forEach(([key, r0, r1, w, mid], i) => {
      const r = rows[i];
      assert.equal(r.key, key);
      assert.ok(near(r.r0, r0, 6e-5) && near(r.r1, r1, 6e-5), `${key} r0/r1 ${r.r0}/${r.r1}`);
      assert.ok(near(r.widthPx, w, 0.06), `${key} 環寬 ${r.widthPx}`);
      assert.ok(near(r.midPx, mid, 0.06), `${key} 中徑 ${r.midPx}`);
    });
    assert.ok(near(rows[5].r1 - rows[5].r0, 0.125, 1e-4), '節氣環寬 0.125R');
  });

  it('模式 B 寬度比例 = 規格(1e-4 精度),外緣 0.986,9 環', () => {
    const { rows, outer } = lp.layoutRings('B');
    const want = [0.1869, 0.1869, 0.0748, 0.1682, 0.0281, 0.0654, 0.0654, 0.1308, 0.0795];
    assert.equal(rows.length, 9);
    assert.ok(near(outer, 0.986, 1e-12));
    rows.forEach((r, i) => assert.ok(near(r.r1 - r.r0, want[i], 1e-9), `${r.key} 寬 ${r.r1 - r.r0}`));
  });

  it('任意 R: 環相接無縫、由內而外遞增、像素與 R 成正比;全部字放得進環寬(規格 LP-2 反例除外)', () => {
    const g = makeGen(0x1ee7);
    for (let i = 0; i < 400; i += 1) {
      const mode = g.pick(['A', 'B']);
      const R = i === 0 ? 180 : g.pick([g.between(1, 2000), 1e-3, 1e6]);
      const L = lp.layoutRings(mode, { R });
      const L0 = lp.layoutRings(mode);
      L.rows.forEach((r, k) => {
        assert.ok(r.r1 > r.r0, `${mode} ${r.key}`);
        if (k > 0) assert.equal(r.r0, L.rows[k - 1].r1);
        assert.ok(near(r.widthPx, (L0.rows[k].widthPx * R) / 180, Math.abs(R) * 1e-9 + 1e-12), `${r.key} widthPx`);
        assert.ok(near(r.midPx, (L0.rows[k].midPx * R) / 180, Math.abs(R) * 1e-9 + 1e-12), `${r.key} midPx`);
      });
    }
    for (const mode of ['A', 'B']) for (const row of lp.layoutRings(mode).rows) assert.ok(lp.glyphFits(row), `${mode} ${row.key} 字放不進環寬`);
    // 舊版 r5 環寬 0.07R=12.6px 放不下 2 字堆疊(規格 LP-2)
    assert.ok(lp.stackHeightPx(2, 10.5) > 0.07 * 180);
    assert.ok(near(lp.stackHeightPx(2, 10.5), 21.42, 1e-9));
    assert.equal(lp.glyphFits({ widthPx: 12.4, glyph: { px: 10.5, stackChars: 2 } }), false);
    assert.equal(lp.glyphFits({ widthPx: 5, glyph: null }), true);
  });

  it('版面參數驗證與回傳獨立(改回傳值不影響下一次)', () => {
    throwsCode(() => lp.layoutRings('C'), 'INVALID_OPTION');
    throwsCode(() => lp.layoutRings('a'), 'INVALID_OPTION');
    for (const R of [0, -1, NaN, Infinity, '180', null]) throwsCode(() => lp.layoutRings('A', { R }), 'INVALID_OPTION');
    const a = lp.layoutRings('A');
    a.rows[0].r1 = 99;
    a.rows[5].glyph.px = 1;
    assert.deepEqual(lp.layoutRings('A'), JSON.parse(JSON.stringify(lp.layoutRings('A'))));
    assert.ok(near(lp.layoutRings('A').rows[0].r1, 0.188, 6e-5));
    assert.equal(lp.layoutRings('A').rows[5].glyph.px, 10.5);
    assert.equal(lp.layoutModeFromSettings({}), 'A');
    assert.equal(lp.layoutModeFromSettings({ showSanZhen: true }), 'B');
    assert.throws(() => lp.layoutModeFromSettings({ typo: 1 }), /未知的設定鍵/);
  });

  it('色票與對比度(規格 2.8.7): 實作 = 獨立 WCAG 算式;規格列出的數字逐項吻合', () => {
    const pal = lp.PALETTE;
    const spec = { lacquer_900: '#0E0B09', lacquer_800: '#17120E', lacquer_700: '#221A13', lacquer_600: '#2D231A', gold_100: '#F6E6B4', gold_300: '#E8CB7A', gold_500: '#D6B25A', gold_700: '#9A7526', gold_900: '#5E4514', cinnabar_500: '#D0342A', cinnabar_300: '#F0665A', cinnabar_800: '#7A130C', ivory: '#F3EBD8', jade: '#5FA37F', terracotta: '#C9705A', wx_wood: '#5DAA6B', wx_earth: '#D0A44A', wx_metal: '#E4E0D2', wx_fire: '#EC6A57', wx_water: '#6A9CDC' };
    assert.deepEqual(pal, spec);
    for (const [a, ha] of Object.entries(pal)) {
      for (const [b, hb] of Object.entries(pal)) {
        assert.ok(near(lp.contrastRatio(ha, hb), oContrast(ha, hb), 1e-9), `${a}/${b}`);
        assert.equal(lp.contrastRatio(ha, hb), lp.contrastRatio(hb, ha), '對稱');
      }
      assert.equal(lp.contrastRatio(ha, ha), 1);
    }
    assert.ok(near(lp.contrastRatio('#000000', '#FFFFFF'), 21, 1e-9));
    const cr = (f, b) => Math.round(lp.contrastRatio(f, b) * 100) / 100;
    const N = { fire: pal.wx_fire, water: pal.wx_water };
    assert.deepEqual([cr(N.fire, pal.lacquer_800), cr(N.fire, pal.lacquer_700), cr(N.fire, pal.lacquer_600)], [5.99, 5.52, 4.95]);
    assert.deepEqual([cr(N.water, pal.lacquer_800), cr(N.water, pal.lacquer_700), cr(N.water, pal.lacquer_600)], [6.55, 6.04, 5.41]);
    const old = lp.LEGACY_WUXING_COLORS;
    assert.deepEqual([cr(old.wx_fire, pal.lacquer_700), cr(old.wx_fire, pal.lacquer_600), cr(old.wx_water, pal.lacquer_700), cr(old.wx_water, pal.lacquer_600)], [4.39, 3.94, 4.53, 4.06]);
    assert.equal(cr(pal.cinnabar_800, pal.gold_500), 5.39);
    assert.equal(cr(pal.gold_300, pal.lacquer_800), 11.74);
    assert.equal(cr('#7A130C', '#D9A863'), 5.05);
    assert.equal(cr('#7A130C', '#B98548'), 3.38);
    // 五行小圓點色在三種漆面底皆 ≥ 4.5;五行的字色 token 正確
    for (const w of ['木', '火', '土', '金', '水']) for (const bg of ['lacquer_800', 'lacquer_700', 'lacquer_600']) assert.ok(lp.contrastRatio(lp.wuxingColor(w), pal[bg]) >= lp.TEXT_MIN_CONTRAST, `${w}/${bg}`);
    assert.equal(lp.wuxingColor('火'), '#EC6A57');
    assert.equal(lp.wuxingColor('水'), '#6A9CDC');
    // 24 山格: 陽 = 金底朱紅字、陰 = 漆黑底亮金字,兩者字底對比都 ≥ 4.5,且格底本身有深淺差(不只靠顏色)
    const yang = lp.mountainCellStyle('陽');
    const yin = lp.mountainCellStyle('陰');
    assert.deepEqual([yang.bg, yang.fg, yin.bg, yin.fg], ['#D6B25A', '#7A130C', '#17120E', '#E8CB7A']);
    assert.ok(lp.contrastRatio(yang.fg, yang.bg) >= 4.5 && lp.contrastRatio(yin.fg, yin.bg) >= 4.5);
    assert.ok(lp.relativeLuminance(yang.bg) - lp.relativeLuminance(yin.bg) > 0.3);
  });

  it('色彩函式對壞輸入丟碼: 非 #RRGGBB、大小寫、非字串;五行未知', () => {
    for (const bad of ['#FFF', 'FFFFFF', '#GGGGGG', '#FFFFFFF', '', null, undefined, 123, {}, '#ffffff ', ' #ffffff']) throwsCode(() => lp.relativeLuminance(bad), 'INVALID_COLOR');
    assert.equal(lp.relativeLuminance('#ffffff'), lp.relativeLuminance('#FFFFFF'));
    for (const bad of ['金屬', '', undefined, null, 'toString', '__proto__', 'constructor']) throwsCode(() => lp.wuxingColor(bad), 'INVALID_OPTION');
    for (const bad of ['', '陰陽', undefined, 'yin']) throwsCode(() => lp.mountainCellStyle(bad), 'INVALID_OPTION');
    const g = makeGen(12);
    const hex = () => `#${Array.from({ length: 6 }, () => '0123456789abcdefABCDEF'[g.int(0, 21)]).join('')}`;
    for (let i = 0; i < 2000; i += 1) {
      const a = hex();
      const b = hex();
      const c = lp.contrastRatio(a, b);
      assert.ok(c >= 1 && c <= 21 + 1e-9, `${a} ${b} ${c}`);
      assert.ok(near(c, oContrast(a, b), 1e-9));
    }
  });

  it('字集(規格 2.8.9、LP-10): core 120 字含 山宮朝與全部盤面用字;排序去重;full ⊇ core;選項', () => {
    const core = lp.fontSubsetCharset();
    const coreOnly = lp.fontSubsetCharset({ ringNames: false });
    assert.equal(coreOnly.length, 120);
    assert.equal(lp.CHARSET_CORE.length, 120);
    for (const ch of '山宮朝') assert.ok(coreOnly.includes(ch), ch);
    for (const s of [NAMES24, GUA8, XIU_BEARING_ORDER.join(''), SPEC_TERMS.join(''), '0123456789°', '朝向山宮天元地人坐']) for (const ch of s) assert.ok(coreOnly.includes(ch), `core 缺 ${ch}`);
    for (const ch of '卦宿山節氣池洛書度百三二八六十四') assert.ok(core.includes(ch), `含環名字 缺 ${ch}`);
    assert.equal(new Set(core).size, core.length);
    assert.deepEqual([...core], [...core].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)));
    const colors = lp.fontSubsetCharset({ nineStarColors: true });
    for (const ch of '黑碧綠黃赤紫') assert.ok(colors.includes(ch), ch);
    const full = lp.fontSubsetCharset({ scope: 'full', nineStarColors: true });
    for (const ch of core) assert.ok(full.includes(ch));
    for (const name of lp.HEXAGRAM_NAMES) for (const ch of name) assert.ok(full.includes(ch), `full 缺卦名字 ${ch}`);
    for (const c of lp.ringById('fenjin120').cells) for (const ch of c.name) assert.ok(full.includes(ch), `full 缺分金字 ${ch}`);
    for (const a of lp.XIU_ANIMALS) for (const ch of a) assert.ok(full.includes(ch), `full 缺動物名字 ${ch}`);
    for (const bad of [{ scope: 'x' }, { scope: '' }, { scope: null }]) throwsCode(() => lp.fontSubsetCharset(bad), 'INVALID_OPTION');
  });

  it('疊層與磁針慣例(規格 2.8.8、2.8.9、D61)', () => {
    assert.deepEqual(lp.OVERLAY_STYLE.tianxin, { colorToken: 'cinnabar_500', widthPx: 1, rotates: false });
    assert.equal(lp.OVERLAY_STYLE.haidi.widthPx, 1.2);
    assert.equal(lp.OVERLAY_STYLE.haidi.dotRadiusPx, 1.6);
    assert.equal(lp.OVERLAY_STYLE.haidi.dotCount, 2);
    assert.equal(lp.NEEDLE_CONVENTIONS.luopan.redEnd, 'south');
    assert.equal(lp.NEEDLE_CONVENTIONS.modern.redEnd, 'north');
    assert.equal(lp.NEEDLE_NORTH_LABEL, '北');
    assert.ok(lp.KAI_FONT_STACK.startsWith('"LuopanKai","Kaiti TC","BiauKaiTC","BiauKai","DFKai-SB","KaiTi","STKaiti"'));
    assert.ok(lp.KAI_FONT_STACK.endsWith('serif'));
  });
});

// ═══════════════════════════ 5. luopan 文字沿弧、手勢、讀數 ═══════════════════════════

describe('luopan 手勢與幾何(規格 2.8.1、2.8.8)', () => {
  it('unwrapAngleDelta: 與迴圈式 oracle 一致,範圍 [-180,180),與平移 360 的倍數無關', () => {
    const g = makeGen(0x111);
    const oracle = (p, c) => { let d = c - p; while (d >= 180) d -= 360; while (d < -180) d += 360; return d; };
    for (let i = 0; i < 30000; i += 1) {
      const p = g.rnd() < 0.5 ? g.between(-1000, 1000) : 7.5 * g.int(-100, 100);
      const c = g.rnd() < 0.5 ? g.between(-1000, 1000) : p + 180 * g.int(-4, 4);
      const u = lp.unwrapAngleDelta(p, c);
      assert.ok(u >= -180 && u < 180, `${p} ${c} => ${u}`);
      assert.ok(near(u, oracle(p, c), 1e-9), `${p} ${c} => ${u} 期望 ${oracle(p, c)}`);
      assert.ok(near(lp.unwrapAngleDelta(p + 360 * g.int(-5, 5), c), u, 1e-8));
    }
    assert.equal(lp.unwrapAngleDelta(0, 180), -180);
    assert.equal(lp.unwrapAngleDelta(350, 10), 20);
    assert.equal(lp.unwrapAngleDelta(10, 350), -20);
    for (const bad of [NaN, Infinity, -Infinity, '1', null, undefined]) {
      throwsCode(() => lp.unwrapAngleDelta(bad, 0), 'INVALID_ANGLE');
      throwsCode(() => lp.unwrapAngleDelta(0, bad), 'INVALID_ANGLE');
    }
  });

  it('pointerAngleDeg / isInDeadZone: 象限、範圍、0.16R 邊界', () => {
    const g = makeGen(0x112);
    for (let i = 0; i < 20000; i += 1) {
      const cx = g.between(-500, 500);
      const cy = g.between(-500, 500);
      const th = g.between(-180, 180);
      const rr = g.between(1, 500);
      const px = cx + rr * Math.cos((th * Math.PI) / 180);
      const py = cy + rr * Math.sin((th * Math.PI) / 180);
      const a = lp.pointerAngleDeg(px, py, cx, cy);
      assert.ok(a > -180 && a <= 180);
      assert.ok(cdiff(a, th) < 1e-6, `${a} vs ${th}`);
      const R = g.between(10, 400);
      const dist = Math.hypot(px - cx, py - cy);
      if (Math.abs(dist - 0.16 * R) > 1e-9) assert.equal(lp.isInDeadZone(px, py, cx, cy, R), dist < 0.16 * R);
    }
    assert.equal(lp.pointerAngleDeg(1, 0, 0, 0), 0);
    assert.equal(lp.pointerAngleDeg(0, 1, 0, 0), 90);
    assert.equal(lp.pointerAngleDeg(0, -1, 0, 0), -90);
    assert.equal(lp.pointerAngleDeg(-1, 0, 0, 0), 180);
    assert.equal(lp.isInDeadZone(0, 0, 0, 0, 100), true);
    assert.equal(lp.isInDeadZone(16, 0, 0, 0, 100), false, '恰在 0.16R 上不算天池內');
    assert.equal(lp.isInDeadZone(15.999, 0, 0, 0, 100), true);
    for (const bad of [NaN, Infinity, '1', null]) throwsCode(() => lp.pointerAngleDeg(bad, 0, 0, 0), 'INVALID_POINT');
    for (const bad of [0, -5, NaN, Infinity, '5']) throwsCode(() => lp.isInDeadZone(1, 1, 0, 0, bad), 'INVALID_OPTION');
  });

  it('拖曳: 盤角 = 起始盤角 + 各步向量夾角總和(atan2(cross,dot) 獨立算法),不改傳入的狀態', () => {
    const g = makeGen(0x113);
    for (let run = 0; run < 400; run += 1) {
      const cx = g.between(-200, 200);
      const cy = g.between(-200, 200);
      const R = g.between(50, 300);
      const dial0 = g.between(-1000, 1000);
      let t = g.between(0, 1e6);
      let ang = g.between(-180, 180);
      const pt = (a, r) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
      let [px, py] = pt(ang, R * g.between(0.2, 1));
      let st = lp.createDragState(dial0);
      const frozen0 = deepFreezeCopy(st);
      st = lp.dragStart(frozen0, { px, py, cx, cy, radiusPx: R, tMs: t });
      assert.deepEqual(frozen0, deepFreezeCopy(lp.createDragState(dial0)), 'dragStart 不可改傳入狀態');
      assert.equal(st.dragging, true);
      let expectDial = dial0;
      let prevV = [px - cx, py - cy];
      const steps = g.int(1, 40);
      for (let s = 0; s < steps; s += 1) {
        ang += g.between(-170, 170); // 單步不超過半圈才是「最短路徑」的前提
        const [nx, ny] = pt(ang, R * g.between(0.2, 1));
        const v = [nx - cx, ny - cy];
        expectDial += (Math.atan2(prevV[0] * v[1] - prevV[1] * v[0], prevV[0] * v[0] + prevV[1] * v[1]) * 180) / Math.PI;
        prevV = v;
        t += g.between(1, 60);
        const before = deepFreezeCopy(st);
        st = lp.dragMove(before, { px: nx, py: ny, cx, cy, tMs: t });
        assert.deepEqual(before, deepFreezeCopy(before));
        assert.ok(Number.isFinite(st.omega) && Number.isFinite(st.dialDeg));
      }
      assert.ok(near(st.dialDeg, expectDial, 1e-6 * (1 + steps)), `run ${run}: ${st.dialDeg} vs ${expectDial}`);
    }
  });

  it('拖曳: 天池內按下不啟動、未啟動的 move 不動盤角、角速度平滑公式 om=0.8om+0.2(d/dt·1000)', () => {
    let st = lp.createDragState(30);
    st = lp.dragStart(st, { px: 5, py: 5, cx: 0, cy: 0, radiusPx: 100, tMs: 0 });
    assert.equal(st.dragging, false);
    const moved = lp.dragMove(st, { px: 100, py: 0, cx: 0, cy: 0, tMs: 10 });
    assert.equal(moved.dialDeg, 30);
    assert.equal(moved.dragging, false);
    // 點一格: (100,0) → (0,100) 角度 0 → 90,dt=100ms → om = 0.2*(90/100*1000)=180
    st = lp.dragStart(lp.createDragState(0), { px: 100, py: 0, cx: 0, cy: 0, radiusPx: 100, tMs: 1000 });
    st = lp.dragMove(st, { px: 0, py: 100, cx: 0, cy: 0, tMs: 1100 });
    assert.ok(near(st.omega, 180, 1e-9) && near(st.dialDeg, 90, 1e-9));
    // dt 下限 1ms: 時間不動時不除以 0
    const st2 = lp.dragMove(st, { px: -100, py: 0, cx: 0, cy: 0, tMs: 1100 });
    assert.ok(Number.isFinite(st2.omega));
    for (const bad of [NaN, Infinity, '1', undefined]) {
      throwsCode(() => lp.dragMove(st, { px: 1, py: 1, cx: 0, cy: 0, tMs: bad }), 'INVALID_POINT');
      throwsCode(() => lp.dragStart(st, { px: 1, py: 1, cx: 0, cy: 0, radiusPx: 100, tMs: bad }), 'INVALID_POINT');
      throwsCode(() => lp.dragEnd(st, { tMs: bad }), 'INVALID_POINT');
    }
    throwsCode(() => lp.createDragState(NaN), 'INVALID_ANGLE');
  });

  it('dragEnd(LP-12): 停頓超過 80ms 放手 omega0 歸 0;80ms 內保留;reducedMotion 歸 0;放手後狀態乾淨', () => {
    const g = makeGen(0x114);
    for (let i = 0; i < 3000; i += 1) {
      let st = lp.dragStart(lp.createDragState(g.between(-500, 500)), { px: 100, py: 0, cx: 0, cy: 0, radiusPx: 100, tMs: 0 });
      let t = 0;
      for (let s = 0; s < g.int(1, 5); s += 1) {
        t += g.between(5, 30);
        const a = g.between(-180, 180);
        st = lp.dragMove(st, { px: 100 * Math.cos((a * Math.PI) / 180), py: 100 * Math.sin((a * Math.PI) / 180), cx: 0, cy: 0, tMs: t });
      }
      const idle = g.pick([0, 1, 79, 80, 80.0001, 81, 200, 5000, g.between(0, 300)]);
      const reduced = g.rnd() < 0.2;
      const frozen = deepFreezeCopy(st);
      const res = lp.dragEnd(frozen, { tMs: t + idle, reducedMotion: reduced });
      const expected = reduced || idle > 80 ? 0 : st.omega;
      assert.equal(res.omega0, expected, `idle=${idle} reduced=${reduced}`);
      assert.deepEqual(res.state, { ...st, dragging: false, lastAngleDeg: null, lastT: null, omega: expected });
    }
    // 沒在拖曳時放手
    const idle = lp.dragEnd(lp.createDragState(5), { tMs: 100 });
    assert.equal(idle.omega0, 0);
  });

  it('慣性: 總轉角 = τ(ω0-ω末)、與 ω0·τ 差 < 0.5·τ,與幀率無關;停止門檻;錯誤輸入', () => {
    const g = makeGen(0x115);
    for (let i = 0; i < 4000; i += 1) {
      const w0 = g.pick([g.between(-3000, 3000), g.between(-5, 5), 1e6 * g.between(-1, 1), 0.5, -0.5, 0.4999]);
      const dt = g.pick([1 / 30, 1 / 60, 1 / 120, 1 / 144, 0.05, 0.1, g.between(0.002, 0.1)]);
      const r = lp.simulateInertia(w0, { dtSec: dt });
      assert.ok(Number.isFinite(r.totalDeg));
      assert.ok(Math.abs(r.totalDeg - lp.inertiaTotalDeg(w0)) <= 0.5 * lp.GESTURE.tauSec + 1e-6, `w0=${w0} dt=${dt} total=${r.totalDeg}`);
      assert.ok(Math.abs(r.finalOmega) < 0.5 + 1e-12, `終止角速度 ${r.finalOmega}`);
      if (Math.abs(w0) >= 0.5) assert.ok(r.totalDeg * Math.sign(w0) > 0, '方向不變');
      const r2 = lp.simulateInertia(w0, { dtSec: dt / 3 });
      assert.ok(Math.abs(r.totalDeg - r2.totalDeg) <= 0.5 + 1e-6, '幀率相依');
    }
    assert.equal(lp.inertiaTotalDeg(360), 180);
    assert.equal(lp.inertiaTotalDeg(-360), -180);
    assert.equal(lp.inertiaTotalDeg(100, 2), 200);
    assert.deepEqual(lp.inertiaStep(0.49, 1 / 60), { omega: 0, deltaDeg: 0, done: true });
    assert.equal(lp.inertiaStep(50, 1 / 60).done, false);
    assert.equal(lp.inertiaStep(0.5, 1 / 60).done, true, '0.5 衰減一步後即 < 0.5');
    assert.equal(lp.inertiaStep(-0.4999, 0.01).done, true);
    // 單步: ω(t)=ω0e^(-t/τ) 的解析積分
    const s = lp.inertiaStep(100, 0.25);
    assert.ok(near(s.omega, 100 * Math.exp(-0.5), 1e-9) && near(s.deltaDeg, 100 * 0.5 * (1 - Math.exp(-0.5)), 1e-9));
    for (const bad of [NaN, Infinity, '5']) {
      throwsCode(() => lp.inertiaStep(bad, 0.1), 'INVALID_ANGLE');
      throwsCode(() => lp.simulateInertia(bad), 'INVALID_ANGLE');
      throwsCode(() => lp.inertiaTotalDeg(bad), 'INVALID_ANGLE');
    }
    for (const bad of [-0.1, NaN, Infinity, '1']) throwsCode(() => lp.inertiaStep(10, bad), 'INVALID_OPTION');
    for (const bad of [0, -1, NaN]) throwsCode(() => lp.simulateInertia(10, { dtSec: bad }), 'INVALID_OPTION');
    for (const bad of [0, -1, NaN]) throwsCode(() => lp.inertiaStep(10, 0.1, { tau: bad }), 'INVALID_OPTION');
    throwsCode(() => lp.inertiaStep(10, 0.1, { minOmega: -1 }), 'INVALID_OPTION');
    // maxSteps 保護: 無限迴圈不可能
    assert.ok(lp.simulateInertia(1e300, { dtSec: 1e-6, maxSteps: 10 }).steps === 10);
  });

  it('手勢常數 = 規格 2.8.8', () => {
    assert.equal(lp.GESTURE.tauSec, 0.5);
    assert.equal(lp.GESTURE.minOmegaDegPerSec, 0.5);
    assert.equal(lp.GESTURE.deadZoneFrac, 0.16);
    assert.equal(lp.GESTURE.releaseIdleMs, 80);
  });

  it('盤角/航向: setAng(-90) 讀 90、setAng(-352.5) 讀 352.5(子山);-0 不外洩;dialAngleToward 取最近等價角', () => {
    assert.equal(lp.headingFromDialAngle(-90), 90);
    assert.equal(lp.headingFromDialAngle(-352.5), 352.5);
    assert.equal(lp.readout(lp.headingFromDialAngle(-352.5)).mountain, '子');
    assert.equal(lp.readout(lp.headingFromDialAngle(-90)).text, '朝向 90.0° 卯山(震宮/天元) 坐酉');
    assert.ok(Object.is(lp.headingFromDialAngle(0), 0));
    assert.ok(Object.is(lp.headingFromDialAngle(-0), 0));
    assert.ok(Object.is(lp.headingFromDialAngle(360), 0));
    const g = makeGen(0x116);
    for (let i = 0; i < 20000; i += 1) {
      const dial = g.pick([g.between(-3000, 3000), 7.5 * g.int(-300, 300), -0, 0, 1e7 * g.between(-1, 1)]);
      const h = lp.headingFromDialAngle(dial);
      assert.ok(h >= 0 && h < 360 && !Object.is(h, -0), `dial=${dial} h=${h}`);
      assert.ok(cdiff(h, nm(-dial)) < 1e-6 || Math.abs(dial) > 1e6, `dial=${dial} h=${h}`);
      const cur = g.between(-2000, 2000);
      const head = g.pick([g.between(-720, 720), 359, 1, 0, 180]);
      const to = lp.dialAngleToward(cur, head);
      assert.ok(cdiff(nm(to), nm(-head)) < 1e-9, `to=${to} head=${head}`);
      assert.ok(Math.abs(to - cur) <= 180 + 1e-9, `不是最近等價角: cur=${cur} to=${to}`);
      // 最近性: 兩側鄰居更遠
      assert.ok(Math.abs(to + 360 - cur) >= Math.abs(to - cur) - 1e-9 && Math.abs(to - 360 - cur) >= Math.abs(to - cur) - 1e-9);
    }
    // 航向 359 → 1 時盤角只變 2 度,不倒轉一圈
    const d1 = lp.dialAngleToward(-359, 1);
    assert.ok(near(d1, -361, 1e-9));
    for (const bad of [NaN, Infinity, '1']) throwsCode(() => lp.headingFromDialAngle(bad), 'INVALID_ANGLE');
    throwsCode(() => lp.dialAngleToward(NaN, 0), 'INVALID_ANGLE');
    throwsCode(() => lp.dialAngleToward(0, NaN), 'INVALID_BEARING');
  });

  it('cssRotationDeg: southUp 是 +180 的旋轉;讀數航向不受影響', () => {
    assert.equal(lp.cssRotationDeg(30), 30);
    assert.equal(lp.cssRotationDeg(30, { southUp: true }), 210);
    assert.equal(lp.cssRotationDeg(-190, { southUp: true }), -10);
    throwsCode(() => lp.cssRotationDeg(NaN), 'INVALID_ANGLE');
    assert.equal(lp.readout(45, { southUp: true }).heading, 45);
  });

  it('boundaryCrossings: 與逐界線計數 oracle 一致;往返對稱;跨 0 不誤算', () => {
    const g = makeGen(0x117);
    const oracle = (from, to) => {
      const f = nm(from);
      const t = f + lp.unwrapAngleDelta(from, to);
      const [lo, hi] = f <= t ? [f, t] : [t, f];
      let n = 0;
      for (let k = -60; k <= 90; k += 1) {
        const B = 7.5 + 15 * k; // 每個山界
        if (B > lo && B <= hi) n += 1;
      }
      return n;
    };
    for (let i = 0; i < 20000; i += 1) {
      const from = g.rnd() < 0.5 ? g.between(-400, 800) : 7.5 * g.int(-50, 100);
      const to = g.rnd() < 0.5 ? g.between(-400, 800) : 7.5 * g.int(-50, 100) + (g.rnd() < 0.3 ? 15 * g.int(-3, 3) : 0);
      const dEdge = Math.min(distToGrid(nm(from), 7.5, 15), distToGrid(nm(to), 7.5, 15));
      if (dEdge > 0 && dEdge < 1e-9) continue;
      const n = lp.boundaryCrossings(from, to);
      assert.equal(n, oracle(from, to), `from=${from} to=${to}`);
      assert.ok(Number.isInteger(n) && n >= 0);
      if (Math.abs(lp.unwrapAngleDelta(from, to)) !== 180) assert.equal(lp.boundaryCrossings(to, from), n, `往返 ${from} ${to}`);
    }
    assert.equal(lp.boundaryCrossings(359, 1), 0);
    assert.equal(lp.boundaryCrossings(350, 355), 1);
    assert.equal(lp.boundaryCrossings(0, 7.5), 1);
    assert.equal(lp.boundaryCrossings(7.5, 0), 1);
    assert.equal(lp.boundaryCrossings(0, 179.9), 12);
    for (const bad of [NaN, Infinity, '1', null]) {
      throwsCode(() => lp.boundaryCrossings(bad, 0), 'INVALID_BEARING');
      throwsCode(() => lp.boundaryCrossings(0, bad), 'INVALID_BEARING');
    }
  });

  it('文字沿弧: 位置在半徑 r 圓上、方位角自洽、與 Canvas 角度一致、rotateRad ∈ [0,2π) 且不為 -0', () => {
    const g = makeGen(0x118);
    for (let i = 0; i < 20000; i += 1) {
      const b = g.bearing();
      const r = g.pick([0, g.between(0, 400), 1e-9, 1e6]);
      const cx = g.pick([0, g.between(-300, 300)]);
      const cy = g.pick([0, g.between(-300, 300)]);
      const up = g.pick(['outward', 'inward']);
      const t = lp.arcGlyphTransform({ bearing: b, r, cx, cy, glyphUp: up });
      const nb = nm(b);
      assert.ok(near(t.x, cx + r * Math.sin((nb * Math.PI) / 180), 1e-9 * (1 + r)), `x b=${b}`);
      assert.ok(near(t.y, cy - r * Math.cos((nb * Math.PI) / 180), 1e-9 * (1 + r)), `y b=${b}`);
      if (Math.abs(b) < 1e9) {
        const cr = lp.bearingToCanvasRad(nb);
        assert.ok(near(t.x, cx + r * Math.cos(cr), 1e-9 * (1 + r)) && near(t.y, cy + r * Math.sin(cr), 1e-9 * (1 + r)), 'Canvas 角度不一致');
      }
      assert.ok(t.rotateRad >= 0 && t.rotateRad < 2 * Math.PI, `rotateRad=${t.rotateRad} b=${b}`);
      assert.ok(!Object.is(t.rotateRad, -0) && !Object.is(t.x, -0) && !Object.is(t.y, -0) || Object.is(cx, -0), `-0 外洩 b=${b}: ${JSON.stringify(t)} ${Object.is(t.rotateRad, -0)}`);
      const want = nm(up === 'outward' ? nb : nb + 180);
      assert.ok(cdiff((t.rotateRad * 180) / Math.PI, want) < 1e-9, `rotate b=${b}`);
    }
    assert.ok(near(lp.arcGlyphTransform({ bearing: 0, r: 100 }).y, -100, 1e-12), '北在上');
    assert.ok(near(lp.arcGlyphTransform({ bearing: 90, r: 100 }).x, 100, 1e-12), '東在右');
    assert.ok(near(lp.bearingToCanvasRad(0), -Math.PI / 2, 1e-15));
    assert.equal(lp.bearingToCanvasRad(90), 0);
    assert.ok(near(lp.bearingToCanvasRad(-720), (-720 - 90) * Math.PI / 180, 1e-12), '不做正規化');
    throwsCode(() => lp.arcGlyphTransform({ bearing: NaN, r: 1 }), 'INVALID_BEARING');
    for (const bad of [-1, NaN, Infinity, '1']) throwsCode(() => lp.arcGlyphTransform({ bearing: 0, r: bad }), 'INVALID_OPTION');
    throwsCode(() => lp.arcGlyphTransform({ bearing: 0, r: 1, glyphUp: 'up' }), 'INVALID_OPTION');
    throwsCode(() => lp.arcGlyphTransform({ bearing: 0, r: 1, cx: NaN }), 'INVALID_OPTION');
    throwsCode(() => lp.bearingToCanvasRad(NaN), 'INVALID_BEARING');
  });

  it('arcTextBearings: 中心對稱、相鄰差 = Δ、朝內反向、全在 [0,360)、-0 不外洩', () => {
    const g = makeGen(0x119);
    for (let i = 0; i < 10000; i += 1) {
      const b = g.bearing();
      const count = g.int(1, 9);
      const step = g.pick([g.between(-30, 30), 0, 5, 7.5, 1e-9]);
      const up = g.pick(['outward', 'inward']);
      const arr = lp.arcTextBearings({ bearing: b, count, stepDeg: step, glyphUp: up });
      assert.equal(arr.length, count);
      const sign = up === 'outward' ? 1 : -1;
      arr.forEach((x, k) => {
        assert.ok(x >= 0 && x < 360 && !Object.is(x, -0), `b=${b} k=${k} x=${x}`);
        assert.ok(cdiff(x, nm(nm(b) + sign * (k - (count - 1) / 2) * step)) < 1e-9);
      });
      for (let k = 1; k < count; k += 1) assert.ok(cdiff(nm(arr[k] - arr[k - 1] + 360), nm(sign * step + 360)) < 1e-6 || cdiff(arr[k] - arr[k - 1], sign * step) < 1e-6);
    }
    for (const bad of [0, -1, 1.5, NaN, '3']) throwsCode(() => lp.arcTextBearings({ bearing: 0, count: bad, stepDeg: 1 }), 'INVALID_OPTION');
    throwsCode(() => lp.arcTextBearings({ bearing: 0, count: 2, stepDeg: NaN }), 'INVALID_OPTION');
    throwsCode(() => lp.arcTextBearings({ bearing: 0, count: 2, stepDeg: 1, glyphUp: 'x' }), 'INVALID_OPTION');
  });

  it('stackGlyphRadii: 以 radiusPx 為中心、外側字先讀、字距 1.02×字級', () => {
    const g = makeGen(0x11a);
    for (let i = 0; i < 5000; i += 1) {
      const count = g.int(1, 6);
      const radiusPx = g.between(0, 300);
      const px = g.between(1, 30);
      const rr = lp.stackGlyphRadii({ count, radiusPx, px });
      assert.equal(rr.length, count);
      assert.ok(near(rr.reduce((a, b) => a + b, 0) / count, radiusPx, 1e-9));
      for (let k = 1; k < count; k += 1) assert.ok(near(rr[k - 1] - rr[k], px * 1.02, 1e-9));
    }
    assert.deepEqual(lp.stackGlyphRadii({ count: 1, radiusPx: 128, px: 10 }), [128]);
    for (const bad of [{ count: 0, radiusPx: 1, px: 1 }, { count: 2, radiusPx: NaN, px: 1 }, { count: 2, radiusPx: 1, px: 0 }, { count: 2, radiusPx: 1, px: 1, spacing: 0 }]) throwsCode(() => lp.stackGlyphRadii(bad), 'INVALID_OPTION');
    assert.ok(near(lp.stepDegForWidth(13, 151.1), 4.93, 0.005));
    throwsCode(() => lp.stepDegForWidth(0, 10), 'INVALID_OPTION');
    throwsCode(() => lp.stepDegForWidth(10, -1), 'INVALID_OPTION');
    throwsCode(() => lp.minGlyphAngleDeg(NaN, 10), 'INVALID_OPTION');
  });
});

describe('luopan readout 與 JSON、純度、效能', () => {
  const YANG3 = new Set([...'子癸申辰午壬寅戌乾甲坤乙']);
  const fmt = (b) => { let t = Math.round(b * 10); if (t >= 3600) t -= 3600; return (t / 10).toFixed(1); };

  it('readout 對任意方位與 oracle 一致(山、卦、元龍、坐山、宅卦、節氣、宿、分金、文字)', () => {
    const g = makeGen(0x201);
    let n = 0;
    for (let i = 0; i < 25000; i += 1) {
      const b = g.bearing();
      const nb = nm(b);
      if (Math.abs(b) > 1e9) continue;
      const dEdge = distToGrid(nb, 7.5, 15);
      if (dEdge < 1e-9) continue; // 界線本身由 cellAt 差分負責
      if (oXiu(b).distGu < 1e-9 || oFenjin(b).dist < 1e-9) continue;
      const rd = lp.readout(b);
      const mi = oMountainIndex(b);
      const name = NAMES24[mi];
      assert.equal(rd.mountain, name, `b=${b}`);
      assert.equal(rd.sitMountain, NAMES24[(mi + 12) % 24]);
      assert.equal(rd.solarTerm, SPEC_TERMS[mi]);
      assert.equal(rd.xiu.name, oXiu(b).name);
      assert.equal(rd.fenjin.name, oFenjin(b).name);
      assert.equal(rd.text, `朝向 ${fmt(nb)}° ${name}山(${rd.gua}宮/${rd.dragon}) 坐${rd.sitMountain}`, `b=${b}`);
      assert.ok(cdiff(rd.sitBearing, nm(nb + 180)) < 1e-9);
      assert.equal(rd.gua, GUA8[oGuaIndex(15 * mi)]);
      assert.equal(rd.zhaiGua, GUA8[oGuaIndex(15 * ((mi + 12) % 24))]);
      assert.equal(rd.yinyang, '乾坤艮巽壬丙甲庚寅申巳亥'.includes(name) ? '陽' : '陰');
      assert.equal(rd.heading, nb);
      n += 1;
    }
    assert.ok(n > 15000);
  });

  it('readout 規格範例、三合陰陽、southUp/showSanZhen 設定回存、錯誤輸入', () => {
    assert.equal(lp.readout(90).text, '朝向 90.0° 卯山(震宮/天元) 坐酉');
    assert.equal(lp.readout(352.5).mountain, '子');
    assert.equal(lp.readout(359.96).text.startsWith('朝向 0.0° 子山'), true, '359.96 進位為 0.0 而非 360.0');
    assert.equal(lp.readout(-0).heading, 0);
    assert.ok(Object.is(lp.readout(-0).heading, 0));
    for (const [i, nmn] of [...NAMES24].entries()) {
      assert.equal(lp.readout(15 * i, { yinyangScheme: 'sanhe' }).yinyang, YANG3.has(nmn) ? '陽' : '陰', nmn);
    }
    const r = lp.readout(10, { southUp: true, showSanZhen: true, yinyangScheme: 'sanhe' });
    assert.equal(r.meta.ruleset.southUp, true);
    assert.equal(r.meta.ruleset.showSanZhen, true);
    assert.equal(r.meta.ruleset.yinyangScheme, 'sanhe');
    assert.equal(r.meta.schema, 'fengshui.luopan.readout/1');
    assert.equal(lp.readout(10).sanzhen, null);
    for (const bad of [NaN, Infinity, -Infinity, '90', null, undefined, {}, []]) throwsCode(() => lp.readout(bad), 'INVALID_BEARING');
    throwsCode(() => lp.readout(10, { yinyangScheme: 'x' }), 'INVALID_OPTION');
    assert.throws(() => lp.readout(10, { nope: 1 }), /未知的設定鍵/);
    throwsCode(() => lp.readout(10, { xiaGuaHalfWidth: 8 }), 'INVALID_OPTION');
  });

  it('全部公開函式的輸出 JSON 可序列化(無 -0、NaN、undefined 欄位),同輸入決定性,不改輸入', () => {
    const g = makeGen(0x202);
    const sink = new Map();
    for (let i = 0; i < 6000; i += 1) {
      const b = g.bearing();
      const rd = lp.readout(b);
      jsonProblems('readout', rd, sink);
      assert.deepEqual(lp.readout(b), rd, '決定性');
      jsonProblems('xiuAt', lp.xiuAt(b), sink);
      jsonProblems('fenjinAt', lp.fenjinAt(b), sink);
      jsonProblems('hexagramAt', lp.hexagramAt(b), sink);
      jsonProblems('solarTermAt', lp.solarTermAt(b), sink);
      jsonProblems('branchCellAt', lp.branchCellAt(b), sink);
      for (const r of lp.RINGS.filter((x) => x.kind === 'cells')) jsonProblems(`cellAt(${r.id})`, lp.cellAt(r.id, b), sink);
      jsonProblems('arcGlyphTransform', lp.arcGlyphTransform({ bearing: b, r: g.pick([0, 50]) }), sink);
      jsonProblems('arcGlyphTransform(inward)', lp.arcGlyphTransform({ bearing: b, r: 50, glyphUp: 'inward' }), sink);
      jsonProblems('arcTextBearings', lp.arcTextBearings({ bearing: b, count: 3, stepDeg: g.pick([0, 5]), glyphUp: g.pick(['outward', 'inward']) }), sink);
      jsonProblems('headingFromDialAngle', lp.headingFromDialAngle(b), sink);
      jsonProblems('dialAngleToward', lp.dialAngleToward(g.pick([0, -0, 12]), b), sink);
      jsonProblems('cssRotationDeg', lp.cssRotationDeg(b), sink);
      jsonProblems('boundaryCrossings', lp.boundaryCrossings(b, g.bearing()), sink);
      jsonProblems('unwrapAngleDelta', lp.unwrapAngleDelta(b, g.bearing()), sink);
      jsonProblems('bearingToCanvasRad', lp.bearingToCanvasRad(b), sink);
    }
    jsonProblems('layoutRings A', lp.layoutRings('A'), sink);
    jsonProblems('layoutRings B', lp.layoutRings('B'), sink);
    jsonProblems('RINGS', lp.RINGS, sink);
    jsonProblems('narrowMansions', lp.narrowMansions(), sink);
    jsonProblems('xiuLabelPlan', lp.xiuLabelPlan(), sink);
    jsonProblems('simulateInertia', lp.simulateInertia(-360), sink);
    jsonProblems('kongwangBoundaries', lp.kongwangBoundaries(), sink);
    assert.deepEqual(Object.fromEntries(sink), {}, `JSON 不安全的輸出: ${JSON.stringify(Object.fromEntries(sink))}`);
  });

  it('readout 回傳可任意改寫而不污染下一次結果;傳入的設定物件不被修改', () => {
    const a = lp.readout(123.4);
    const snap = JSON.stringify(a);
    a.mountain = 'X';
    a.analysis.mountain = 'Y';
    a.xiu.name = 'Z';
    a.fenjin.name = 'W';
    assert.equal(JSON.stringify(lp.readout(123.4)), snap);
    const opts = deepFreezeCopy({ southUp: true, showSanZhen: true, xiaGuaHalfWidth: 3.5 });
    assert.doesNotThrow(() => lp.readout(50, opts));
    assert.equal(lp.readout(50, opts).analysis.meta.ruleset.xiaGuaHalfWidth, 3.5);
    const arr = deepFreezeCopy([1, 2, 3]);
    assert.doesNotThrow(() => lp.layoutRings('A', deepFreezeCopy({ R: 100 })));
    assert.ok(arr.length === 3);
  });

  it('效能: 單次呼叫 < 5ms(取 p99 與平均)', () => {
    const g = makeGen(0x203);
    const bs = Array.from({ length: 3000 }, () => g.bearing());
    const timeEach = (label, fn) => {
      const ts = bs.map((b) => { const t0 = performance.now(); fn(b); return performance.now() - t0; }).sort((a, c) => a - c);
      const p99 = ts[Math.floor(ts.length * 0.99)];
      const mean = ts.reduce((a, c) => a + c, 0) / ts.length;
      assert.ok(p99 < 5 && mean < 1, `${label} p99=${p99.toFixed(3)}ms mean=${mean.toFixed(4)}ms`);
    };
    timeEach('readout', (b) => lp.readout(b, { showSanZhen: true }));
    timeEach('xiuAt', lp.xiuAt);
    timeEach('cellAt', (b) => lp.cellAt('xiu28', b));
    timeEach('fenjinAt', lp.fenjinAt);
    timeEach('layoutRings', () => lp.layoutRings('A'));
    timeEach('fontSubsetCharset', () => lp.fontSubsetCharset({ scope: 'full', nineStarColors: true }));
    timeEach('simulateInertia', (b) => lp.simulateInertia(Math.abs(b) % 5000));
  });
});

// ═══════════════════════════ 6. sensor-core oracle(W3C 旋轉矩陣獨立實作) ═══════════════════════════

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const Rx = (b) => [[1, 0, 0], [0, Math.cos(b), -Math.sin(b)], [0, Math.sin(b), Math.cos(b)]];
const Ry = (c) => [[Math.cos(c), 0, Math.sin(c)], [0, 1, 0], [-Math.sin(c), 0, Math.cos(c)]];
/** 世界 x=東、y=北;R = Rz(α)·Rx(β)·Ry(γ);頂端 = 第 2 欄、右緣 = 第 1 欄、後鏡頭 = 第 3 欄取負。 */
function oAxes(alpha, beta, gamma) {
  const R = mul(mul(Rz(rad(alpha)), Rx(rad(beta))), Ry(rad(gamma)));
  const hd = (x, y) => (Math.hypot(x, y) < 1e-9 ? null : nm(deg(Math.atan2(x, y))));
  return {
    top: hd(R[0][1], R[1][1]),
    right: hd(R[0][0], R[1][0]),
    back: hd(-R[0][2], -R[1][2]),
    zUp: R[2][2],
    tilt: deg(Math.acos(Math.min(1, Math.abs(R[2][2])))),
    topXY: [R[0][1], R[1][1]], backXY: [-R[0][2], -R[1][2]],
  };
}
function oBlend(alpha, beta, gamma) {
  const A = oAxes(alpha, beta, gamma);
  const t = Math.min(1, Math.max(0, (A.tilt - 40) / 10));
  const w = t * t * (3 - 2 * t);
  const unit = (h) => [Math.sin(rad(h)), Math.cos(rad(h))];
  let heading = null;
  if (A.top !== null && A.back !== null) {
    const [tx, ty] = unit(A.top);
    const [bx, by] = unit(A.back);
    const x = (1 - w) * tx + w * bx;
    const y = (1 - w) * ty + w * by;
    heading = Math.hypot(x, y) < 1e-9 ? null : nm(deg(Math.atan2(x, y)));
  } else heading = A.top !== null ? A.top : A.back;
  return { heading, w, tilt: A.tilt };
}
const angleEq = (a, b, tol = 1e-6) => (a === null || b === null ? a === b : cdiff(a, b) <= tol);

describe('sensor 姿態與混合: 與 W3C 旋轉矩陣 oracle 差分', () => {
  it('eulerHeadings: 頂端/右緣/後鏡頭方位、zUp、退化 null 與矩陣 oracle 一致', () => {
    const g = makeGen(0x301);
    for (let i = 0; i < 40000; i += 1) {
      const a = g.pick([g.between(-720, 720), g.between(0, 360), 0, 90, 180, 270, -0]);
      const b = g.pick([g.between(-360, 360), g.between(-90, 90), 0, 90, -90, 180, 45]);
      const c = g.pick([g.between(-180, 180), g.between(-90, 90), 0, 90, -90, 30]);
      const h = sc.eulerHeadings(a, b, c);
      const o = oAxes(a, b, c);
      for (const k of ['top', 'right', 'back']) {
        const hx = { top: o.topXY, back: o.backXY, right: [Math.hypot(0), 0] }[k];
        void hx;
        // 水平分量極接近 1e-9 門檻時 null/非 null 可能因浮點分歧,略過
        const mag = { top: Math.hypot(...o.topXY), back: Math.hypot(...o.backXY) }[k];
        if (mag !== undefined && Math.abs(mag - 1e-9) < 1e-11) continue;
        if (mag !== undefined && mag < 1e-6 && mag >= 1e-9) continue; // 幾乎垂直: 方位對浮點極敏感
        assert.ok(angleEq(h[k], o[k], k === 'right' ? 1e-6 : 1e-6), `${k} α=${a} β=${b} γ=${c}: 實作 ${h[k]} oracle ${o[k]}`);
      }
      assert.ok(near(h.zUp, o.zUp, 1e-12), 'zUp');
      assert.ok(near(sc.tiltDeg(b, c), o.tilt, 1e-6), `tilt β=${b} γ=${c}`);
      if (h.top !== null) assert.ok(h.top >= 0 && h.top < 360 && !Object.is(h.top, -0));
      if (h.back !== null) assert.ok(h.back >= 0 && h.back < 360 && !Object.is(h.back, -0));
      if (h.right !== null) assert.ok(h.right >= 0 && h.right < 360 && !Object.is(h.right, -0));
    }
  });

  it('規格屬性與範例: W3C 例、cosβ>0 時頂端 = (360-α) mod 360 與 γ 無關、β=90 時後鏡頭 = -(α+γ)、平放退化', () => {
    assert.equal(sc.eulerHeadings(90, 0, 0).top, 270);
    const g = makeGen(0x302);
    for (let i = 0; i < 20000; i += 1) {
      const a = g.between(-720, 720);
      const b = g.between(-89.9, 89.9);
      const c = g.between(-180, 180);
      assert.ok(cdiff(sc.eulerHeadings(a, b, c).top, nm(360 - a)) < 1e-9, `α=${a} β=${b} γ=${c}`);
      const bk = sc.eulerHeadings(a, 90, c).back;
      assert.ok(bk !== null && cdiff(bk, nm(-(a + c))) < 1e-6, `β=90 back α=${a} γ=${c}: ${bk}`);
    }
    assert.equal(sc.eulerHeadings(37, 0, 0).back, null, '完全平放後鏡頭退化');
    assert.equal(sc.eulerHeadings(37, 90, 0).top, null, '直立頂端退化');
    assert.ok(cdiff(sc.eulerHeadings(37, 0, 0).right, nm(360 - 37 + 90)) < 1e-9);
    assert.equal(sc.tiltDeg(0, 0), 0);
    assert.ok(near(sc.tiltDeg(90, 0), 90, 1e-9));
    assert.ok(near(sc.tiltDeg(180, 0), 0, 1e-6), '螢幕朝下也是平放');
    for (const bad of [NaN, Infinity, null, undefined, '1']) {
      throwsCode(() => sc.eulerHeadings(bad, 0, 0), 'INVALID_ANGLE');
      throwsCode(() => sc.eulerHeadings(0, bad, 0), 'INVALID_ANGLE');
      throwsCode(() => sc.eulerHeadings(0, 0, bad), 'INVALID_ANGLE');
      throwsCode(() => sc.tiltDeg(bad, 0), 'INVALID_ANGLE');
    }
  });

  it('pickHeadingBlend: 與 smoothstep(40°,50°) 混合 oracle 一致;≤40 為頂端、≥50 為後鏡頭;mode 與 weight', () => {
    const g = makeGen(0x303);
    let blends = 0;
    for (let i = 0; i < 40000; i += 1) {
      const a = g.pick([g.between(-720, 720), 0]);
      const b = g.pick([g.between(-180, 180), g.between(30, 70), g.between(35, 55)]);
      const c = g.pick([g.between(-90, 90), g.between(-30, 30), 0]);
      const o = oBlend(a, b, c);
      const p = sc.pickHeadingBlend(a, b, c);
      if (Math.abs(o.tilt - 40) < 1e-6 || Math.abs(o.tilt - 50) < 1e-6) continue;
      const ax = oAxes(a, b, c);
      if (Math.min(Math.hypot(...ax.topXY), Math.hypot(...ax.backXY)) < 1e-6) continue;
      assert.ok(angleEq(p.headingDeg, o.heading, 1e-6), `α=${a} β=${b} γ=${c}: 實作 ${p.headingDeg} oracle ${o.heading}`);
      assert.ok(near(p.weight, o.w, 1e-9) && near(p.tiltDeg, o.tilt, 1e-6));
      assert.equal(p.mode, o.w === 0 ? 'top' : o.w === 1 ? 'back' : 'blend');
      assert.equal(p.faceDown, ax.zUp < 0);
      if (o.w > 0 && o.w < 1) blends += 1;
    }
    assert.ok(blends > 2000, `混合區樣本太少 ${blends}`);
  });

  it('附錄 B.7: alpha=0 的混合向量表(γ=10/20/30 × tilt 40/45/50/55)逐格吻合 1e-3', () => {
    const table = { 10: [0, 352.892, 346.898, 347.761], 20: [0, 345.537, 333.482, 335.321], 30: [0, 337.5, 319.254, 322.382] };
    for (const [gamma, row] of Object.entries(table)) {
      [40, 45, 50, 55].forEach((tilt, k) => {
        const c = Number(gamma);
        const beta = deg(Math.acos(Math.cos(rad(tilt)) / Math.cos(rad(c))));
        const p = sc.pickHeadingBlend(0, beta, c);
        assert.ok(near(p.tiltDeg, tilt, 1e-6), `tilt ${p.tiltDeg}`);
        assert.ok(cdiff(p.headingDeg, row[k]) < 1e-3, `γ=${gamma} tilt=${tilt}: ${p.headingDeg} 期望 ${row[k]}`);
      });
    }
  });

  it('連續性(規格 4.4): γ≤30°、tilt 30→60° 之間相鄰 0.1° 傾角航向變化 < 1°;舊遲滯在同條件會跳', () => {
    const g = makeGen(0x304);
    let worst = 0;
    for (let run = 0; run < 300; run += 1) {
      const alpha = g.between(-720, 720);
      const gamma = g.pick([g.between(-30, 30), 30, -30, 0, 10, 20]);
      const sgn = 1; // 規格表與 B.7 都是 β>0(手機上緣高於下緣);β<0 見下方 todo 測試
      let prev = null;
      for (let tilt = 30; tilt <= 60.0001; tilt += 0.1) {
        const beta = sgn * deg(Math.acos(Math.cos(rad(tilt)) / Math.cos(rad(gamma))));
        const h = sc.pickHeadingBlend(alpha, beta, gamma).headingDeg;
        assert.notEqual(h, null);
        if (prev !== null) { worst = Math.max(worst, cdiff(h, prev)); assert.ok(cdiff(h, prev) < 1, `α=${alpha} γ=${gamma} tilt=${tilt.toFixed(1)} 跳 ${cdiff(h, prev)}`); }
        prev = h;
      }
    }
    assert.ok(worst < 1, `最大跳變 ${worst}`);
    // 對照: 舊 50°/40° 遲滯在 α=0、γ=20°、tilt 恰過 50° 時跳 ≥ 20°
    const beta = (t, c) => deg(Math.acos(Math.cos(rad(t)) / Math.cos(rad(c))));
    const before = sc.pickPointingModeHysteresis(0, beta(49.9, 20), 20, 'top');
    const after = sc.pickPointingModeHysteresis(0, beta(50.1, 20), 20, 'top');
    assert.ok(cdiff(before.heading, after.heading) > 20, '舊遲滯應在此處跳變(對照組)');
  });

  it('已知缺口(規格 2.9.2/4.4): β<0(上緣低於下緣)時 tilt 40→50° 混合的兩個向量相差 180°,航向跳 180° 並在 w=0.5 得 null', { todo: '規格只給 β>0 的連續性證明;β<0 時 top 與 back 方位互為反向,smoothstep 混合無法連續' }, () => {
    let worst = 0;
    let nulls = 0;
    for (let tilt = 30; tilt <= 60.0001; tilt += 0.1) {
      const beta = -deg(Math.acos(Math.cos(rad(tilt))));
      const h = sc.pickHeadingBlend(0, beta, 0).headingDeg;
      if (h === null) nulls += 1;
    }
    let prev = null;
    for (let tilt = 30; tilt <= 60.0001; tilt += 0.1) {
      const h = sc.pickHeadingBlend(0, -deg(Math.acos(Math.cos(rad(tilt)))), 0).headingDeg;
      if (prev !== null && h !== null) worst = Math.max(worst, cdiff(h, prev));
      prev = h;
    }
    assert.equal(nulls, 0, `β<0 掃描出現 ${nulls} 次 null(degenerate)`);
    assert.ok(worst < 1, `β<0 相鄰 0.1° 傾角最大航向跳變 ${worst}`);
  });

  it('blendWeight: 單調、0/1 端點、對稱 w(40+x)+w(50-x)=1、w(45)=0.5;錯誤區間', () => {
    let prev = -1;
    for (let t = 0; t <= 90; t += 0.01) {
      const w = sc.blendWeight(t);
      assert.ok(w >= prev - 1e-12 && w >= 0 && w <= 1);
      prev = w;
      if (t <= 40) assert.equal(w, 0);
      if (t >= 50) assert.equal(w, 1);
      assert.ok(near(w + sc.blendWeight(90 - t), 1, 1e-6) || t < 35 || t > 55, `對稱 ${t}`);
    }
    assert.ok(near(sc.blendWeight(45), 0.5, 1e-12));
    assert.ok(near(sc.blendWeight(42.5), 0.15625, 1e-12));
    assert.equal(sc.blendWeight(-5), 0);
    assert.equal(sc.blendWeight(1e9), 1);
    for (const bad of [NaN, Infinity, '45', null]) throwsCode(() => sc.blendWeight(bad), 'INVALID_OPTION');
    throwsCode(() => sc.blendWeight(45, 50, 40), 'INVALID_OPTION');
    throwsCode(() => sc.blendWeight(45, 40, 40), 'INVALID_OPTION');
    throwsCode(() => sc.pickHeadingBlend(0, 0, 0, { fromDeg: 50, toDeg: 40 }), 'INVALID_OPTION');
  });

  it('螢幕方向/平台映射/iOS 直立偏移: 純算術與範圍', () => {
    const g = makeGen(0x305);
    for (let i = 0; i < 5000; i += 1) {
      const a = g.between(-720, 720);
      const b = g.between(-80, 80);
      const c = g.between(-80, 80);
      const h = sc.eulerHeadings(a, b, c);
      assert.equal(sc.screenUpHeading(a, b, c, 0), h.top);
      assert.equal(sc.screenUpHeading(a, b, c, 90), h.right);
      assert.ok(cdiff(sc.screenUpHeading(a, b, c, 180), nm(h.top + 180)) < 1e-9);
      assert.ok(cdiff(sc.screenUpHeading(a, b, c, 270), nm(h.right + 180)) < 1e-9);
      assert.equal(sc.screenUpHeading(a, b, c, -90), sc.screenUpHeading(a, b, c, 270));
      const delta = g.between(-720, 720);
      const flat = { alpha: a, beta: g.between(-5, 5), gamma: g.between(-5, 5), webkitCompassHeading: nm(sc.eulerHeadings(a, 0, 0).top + delta) };
      const flatTop = sc.eulerHeadings(flat.alpha, flat.beta, flat.gamma).top;
      const r = sc.iosUprightOffset(flat, { alpha: a, beta: 85, gamma: 0 });
      assert.ok(r.offsetDeg >= -180 && r.offsetDeg < 180 && !Object.is(r.offsetDeg, -0), `offset ${r.offsetDeg}`);
      assert.ok(cdiff(nm(r.offsetDeg), nm(flat.webkitCompassHeading - flatTop)) < 1e-9);
    }
    for (const bad of [45, NaN, '0', null, 360.0001, undefined]) throwsCode(() => sc.screenUpHeading(0, 0, 0, bad), 'INVALID_ROTATION');
    assert.equal(sc.screenUpHeading(0, 0, 0, 360), sc.eulerHeadings(0, 0, 0).top, '360 視為 0');
    for (const a of [0, 90, 180, 270, 720, -90]) {
      assert.equal(sc.screenAngleToDeviceRot('android', a), nm(a));
      assert.equal(sc.screenAngleToDeviceRot('ios', a), nm(360 - nm(a)));
    }
    assert.ok(Object.is(sc.screenAngleToDeviceRot('ios', 0), 0) && Object.is(sc.screenAngleToDeviceRot('android', -0), 0));
    for (const p of ['Android', 'IOS', '', null, undefined]) throwsCode(() => sc.screenAngleToDeviceRot(p, 0), 'INVALID_PLATFORM');
    throwsCode(() => sc.iosUprightOffset(null, {}), 'INVALID_SAMPLE');
    throwsCode(() => sc.iosUprightOffset({ alpha: 0, beta: 0, gamma: 0 }, { alpha: 0, beta: 90, gamma: 0 }), 'INVALID_SAMPLE');
    throwsCode(() => sc.iosUprightOffset({ alpha: 0, beta: 90, gamma: 0, webkitCompassHeading: 10 }, { alpha: 0, beta: 90, gamma: 0 }), 'INVALID_SAMPLE');
  });
});

// ═══════════════════════════ 7. sensor decode 差分 ═══════════════════════════

describe('sensor decodeOrientationEvent: 規格 2.9.3 決策表 oracle 差分', () => {
  const NUMS = [undefined, null, NaN, Infinity, -Infinity, 0, -0, 1, -1, 360, 720, 359.9999999, 50, 90, 180, -90, 45, 10, 25, 1e9, -1e-9];
  const JUNK = ['90', 'abc', '', true, false, {}, [], () => 1];
  const val = (g) => { const r = g.rnd(); return r < 0.35 ? g.pick(NUMS) : r < 0.42 ? g.pick(JUNK) : g.between(-720, 720); };
  const genEvent = (g) => {
    const ev = {};
    if (g.rnd() < 0.9) ev.alpha = g.rnd() < 0.7 ? g.between(-360, 720) : val(g);
    if (g.rnd() < 0.9) ev.beta = g.rnd() < 0.7 ? g.between(-180, 180) : val(g);
    if (g.rnd() < 0.9) ev.gamma = g.rnd() < 0.7 ? g.between(-90, 90) : val(g);
    if (g.rnd() < 0.85) ev.absolute = g.pick([true, true, false, undefined, null, 1, 'true', 0]);
    if (g.rnd() < 0.4) ev.webkitCompassHeading = g.rnd() < 0.5 ? g.between(-20, 400) : val(g);
    if (g.rnd() < 0.4) ev.webkitCompassAccuracy = g.rnd() < 0.5 ? g.between(-2, 40) : val(g);
    if (g.rnd() < 0.3) ev.type = g.pick(['deviceorientation', 'deviceorientationabsolute']);
    return ev;
  };
  const isNum = (v) => typeof v === 'number';
  const isFin = (v) => isNum(v) && Number.isFinite(v);
  function oracle(ev) {
    const { alpha, beta, gamma } = ev;
    const wch = ev.webkitCompassHeading;
    const wca = ev.webkitCompassAccuracy;
    const angles = isFin(alpha) && isFin(beta) && isFin(gamma);
    const tilt = angles ? oAxes(alpha, beta, gamma).tilt : null;
    if (isNum(wch)) {
      const acc = isFin(wca) ? wca : null;
      if (acc !== null && acc < 0) return { status: 'uncalibrated', headingDeg: null, source: 'webkitCompassHeading', accuracyDeg: acc };
      if (!Number.isFinite(wch) || wch < 0) return { status: 'invalid', headingDeg: null, source: 'webkitCompassHeading', accuracyDeg: acc };
      if (tilt !== null && tilt > 50) return { status: 'tilt-too-large', headingDeg: null, source: 'webkitCompassHeading', accuracyDeg: acc };
      return { status: 'ok', headingDeg: wch % 360, source: 'webkitCompassHeading', accuracyDeg: acc };
    }
    if (!angles) return { status: 'no-sensor', headingDeg: null, source: null, accuracyDeg: null };
    if (ev.absolute !== true) return { status: 'relative-not-north', headingDeg: null, source: 'alpha-relative', accuracyDeg: null };
    const b = oBlend(alpha, beta, gamma);
    return { status: b.heading === null ? 'degenerate' : 'ok', headingDeg: b.heading, source: 'alpha-absolute', accuracyDeg: null };
  }
  const skipAmbiguous = (ev) => {
    const { alpha, beta, gamma } = ev;
    if (!(isFin(alpha) && isFin(beta) && isFin(gamma))) return false;
    const A = oAxes(alpha, beta, gamma);
    if (Math.abs(A.tilt - 50) < 1e-6 || Math.abs(A.tilt - 40) < 1e-6 || Math.abs(A.tilt - 50) < 1e-6) return true;
    return Math.min(Math.hypot(...A.topXY), Math.hypot(...A.backXY)) < 1e-6;
  };

  it('隨機事件(缺欄位、null、NaN、Infinity、字串、-0、360…): status/heading/source/accuracy 與 oracle 一致', () => {
    const g = makeGen(0x401);
    const counts = {};
    const res = diffRun({
      n: 60000,
      gen: () => genEvent(g),
      impl: (ev) => { const d = sc.decodeOrientationEvent(ev); counts[d.status] = (counts[d.status] ?? 0) + 1; return { status: d.status, headingDeg: d.headingDeg, source: d.source, accuracyDeg: d.accuracyDeg }; },
      oracle: (ev) => { const o = oracle(ev); return o; },
      eq: (a, e) => a.status === e.status && a.source === e.source && angleEq(a.headingDeg, e.headingDeg, 1e-6) && Object.is(a.accuracyDeg, e.accuracyDeg === 0 ? 0 : e.accuracyDeg) ,
      skip: skipAmbiguous,
    });
    // degenerate 要頂端與後鏡頭方位同時退化或恰好反向抵銷,實際幾乎不會出現,不列入覆蓋要求
    for (const s of ['ok', 'uncalibrated', 'invalid', 'tilt-too-large', 'relative-not-north', 'no-sensor']) assert.ok((counts[s] ?? 0) > 20, `狀態 ${s} 覆蓋不足: ${counts[s]}`);
    expectNoDiff(res, 'decodeOrientationEvent');
  });

  it('輸出欄位: JSON 可序列化(-0 不外洩)、mode 對應、headingDeg ∈ [0,360)、決定性、不改輸入', () => {
    const g = makeGen(0x402);
    const sink = new Map();
    for (let i = 0; i < 20000; i += 1) {
      const ev = genEvent(g);
      const frozen = Object.freeze({ ...ev });
      const d = sc.decodeOrientationEvent(frozen);
      jsonProblems('decode', d, sink);
      assert.deepEqual(sc.decodeOrientationEvent(frozen), d);
      if (d.headingDeg !== null) assert.ok(d.headingDeg >= 0 && d.headingDeg < 360, `heading ${d.headingDeg}`);
      assert.ok(d.status !== 'ok' || d.headingDeg !== null);
      assert.ok(['top-edge', 'back-camera', 'blend', null].includes(d.mode));
      assert.equal(typeof d.faceDown, 'boolean');
    }
    assert.deepEqual(Object.fromEntries(sink), {}, `decode 輸出不能 JSON 來回: ${JSON.stringify(Object.fromEntries(sink))}`);
    for (const bad of [null, undefined, 5, 'x', true]) throwsCode(() => sc.decodeOrientationEvent(bad), 'INVALID_EVENT');
  });

  it('規格 B.7 補案與 2.9.3 逐列', () => {
    const dec = (ev) => sc.decodeOrientationEvent(ev);
    assert.deepEqual([dec({ webkitCompassHeading: 360, webkitCompassAccuracy: 10 }).headingDeg, dec({ webkitCompassHeading: 360 }).status], [0, 'ok']);
    assert.equal(dec({ webkitCompassHeading: NaN }).status, 'invalid');
    assert.equal(dec({ webkitCompassHeading: 0, webkitCompassAccuracy: -1 }).status, 'uncalibrated');
    assert.equal(dec({ webkitCompassHeading: 0, webkitCompassAccuracy: -1 }).headingDeg, null);
    assert.equal(dec({ webkitCompassHeading: 123 }).accuracyDeg, null);
    assert.equal(dec({ webkitCompassHeading: -5 }).status, 'invalid');
    assert.equal(dec({ webkitCompassHeading: 90, alpha: 0, beta: 60, gamma: 0 }).status, 'tilt-too-large');
    assert.equal(dec({ webkitCompassHeading: 90, alpha: 0, beta: 50, gamma: 0 }).status, 'ok', 'tilt=50 恰好仍採信');
    assert.equal(dec({ alpha: null, beta: 0, gamma: 0, absolute: true }).status, 'no-sensor');
    assert.equal(dec({ alpha: 1, beta: 0, gamma: 0 }).status, 'relative-not-north');
    assert.equal(dec({ alpha: 1, beta: 0, gamma: 0, absolute: false }).status, 'relative-not-north');
    const d1 = dec({ alpha: 90, beta: 0, gamma: 0, absolute: true });
    const d2 = dec({ alpha: 270, beta: 90, gamma: 0, absolute: true });
    assert.ok(cdiff(d1.headingDeg, 270) < 1e-9 && d1.mode === 'top-edge');
    assert.ok(cdiff(d2.headingDeg, 90) < 1e-9 && d2.mode === 'back-camera');
    // iOS 優先於 alpha
    assert.equal(dec({ webkitCompassHeading: 33, alpha: 90, beta: 0, gamma: 0, absolute: true }).headingDeg, 33);
    // 未校準(accuracy<0)優先於 invalid 與 tilt
    assert.equal(dec({ webkitCompassHeading: -3, webkitCompassAccuracy: -1, alpha: 0, beta: 80, gamma: 0 }).status, 'uncalibrated');
    // 正負零與準確度
    assert.ok(!Object.is(dec({ webkitCompassHeading: 0, webkitCompassAccuracy: -0 }).accuracyDeg, -0), 'accuracy=-0 不應原樣外洩');
    assert.ok(!Object.is(dec({ webkitCompassHeading: -0 }).headingDeg, -0));
  });
});

// ═══════════════════════════ 8. sensor 平滑、鎖定、品質 ═══════════════════════════

describe('sensor 平滑與顯示(規格 2.9.4)', () => {
  it('emaK 表(60/30/20 Hz × τ 0.1/0.2/0.3/0.5)= 規格數字', () => {
    const want = { 60: [0.1535, 0.08, 0.054, 0.0328], 30: [0.2835, 0.1535, 0.1052, 0.0645], 20: [0.3935, 0.2212, 0.1535, 0.0952] };
    for (const [hz, row] of Object.entries(want)) [0.1, 0.2, 0.3, 0.5].forEach((tau, i) => assert.ok(near(sc.emaK(1 / Number(hz), tau), row[i], 5e-5), `${hz}Hz τ=${tau}: ${sc.emaK(1 / Number(hz), tau)}`));
    assert.equal(sc.emaK(0), 0);
    assert.ok(sc.emaK(1e9) <= 1 && sc.emaK(1e9) > 0.999);
    for (const bad of [-1, NaN, Infinity, '1']) throwsCode(() => sc.emaK(bad), 'INVALID_OPTION');
    for (const bad of [0, -1, NaN]) throwsCode(() => sc.emaK(0.05, bad), 'INVALID_OPTION');
  });

  it('單位向量 EMA: 與複數式 z←(1-k)z+k·e^{iθ} 一致;跨 0 不繞 180;純函式', () => {
    const g = makeGen(0x501);
    for (let run = 0; run < 2000; run += 1) {
      const k = g.pick([g.rnd(), 0, 1, 0.2212]);
      const xs = Array.from({ length: g.int(1, 30) }, () => g.pick([g.between(-720, 720), 359, 1, 0]));
      const init = g.rnd() < 0.3 ? g.between(0, 360) : null;
      const series = sc.circularEmaSeries(xs, { k, init });
      let z = init === null ? null : [Math.cos(rad(init)), Math.sin(rad(init))];
      xs.forEach((s, i) => {
        const u = [Math.cos(rad(s)), Math.sin(rad(s))];
        z = z === null ? u : [(1 - k) * z[0] + k * u[0], (1 - k) * z[1] + k * u[1]];
        const want = Math.hypot(z[0], z[1]) < 1e-9 ? null : nm(deg(Math.atan2(z[1], z[0])));
        assert.ok(angleEq(series[i], want, 1e-6), `run ${run} i=${i}: ${series[i]} vs ${want}`);
      });
      // shortest-arc 對照法: 結果永遠是最短弧的內插,不會出現離兩端都遠的值
      const sa = sc.circularEmaSeries(xs, { k, init, method: 'shortest-arc' });
      sa.forEach((h) => assert.ok(h === null || (h >= 0 && h < 360 && !Object.is(h, -0))));
    }
    // 跨 0: 359 與 1 交替,EMA 停在 0 附近而非 180
    const alt = sc.circularEmaSeries(Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : 359)), { k: 0.2212 });
    for (const h of alt.slice(10)) assert.ok(cdiff(h, 0) < 2, `跨 0 繞到 ${h}`);
    const st = Object.freeze({ x: 1, y: 0 });
    assert.doesNotThrow(() => sc.emaVectorStep(st, 90, 0.5));
    assert.deepEqual(sc.emaVectorStep(st, 90, 0.5), { x: 0.5, y: 0.5 });
    assert.deepEqual(sc.emaVectorStep(null, 90, 0.5).y, 1);
    assert.equal(sc.emaHeading(null), null);
    assert.equal(sc.emaHeading({ x: 0, y: 0 }), null);
    assert.equal(sc.emaHeading({ x: 1e-10, y: 1e-10 }), null);
    assert.ok(Object.is(sc.emaHeading({ x: 1, y: -0 }), 0));
    assert.equal(sc.emaHeading({ x: 0, y: 1 }), 90);
    for (const bad of [NaN, Infinity, '1']) throwsCode(() => sc.emaVectorStep(null, bad, 0.5), 'INVALID_BEARING');
    for (const bad of [-0.1, 1.1, NaN]) throwsCode(() => sc.emaVectorStep(null, 1, bad), 'INVALID_OPTION');
    throwsCode(() => sc.circularEmaSeries('x', { k: 0.5 }), 'INVALID_READINGS');
    throwsCode(() => sc.circularEmaSeries([1], { k: 0.5, method: 'z' }), 'INVALID_OPTION');
    throwsCode(() => sc.circularEmaSeries([1], { k: 0.5, init: NaN }), 'INVALID_BEARING');
  });

  it('roundHalf / roundInt: 與 Math.round 半數進位 oracle 一致(0.25→0.5),359.75→0,結果 ∈ [0,360)', () => {
    const g = makeGen(0x502);
    const oHalf = (x) => { const y = Math.round(nm(x) * 2) / 2; return y >= 360 ? 0 : y; };
    const oInt = (x) => { const y = Math.round(nm(x)); return y >= 360 ? 0 : y; };
    for (let i = 0; i < 40000; i += 1) {
      const x = g.pick([g.between(-1000, 1000), 0.25 * g.int(-4000, 4000), 0.5 * g.int(-2000, 2000), g.between(359, 360), g.between(-1, 0), -0, 359.75, 359.5]);
      const rh = sc.roundHalf(x);
      const ri = sc.roundInt(x);
      assert.equal(rh, oHalf(x), `roundHalf(${x})`);
      assert.equal(ri, oInt(x), `roundInt(${x})`);
      assert.ok(rh >= 0 && rh < 360 && ri >= 0 && ri < 360 && Number.isInteger(ri) && Number.isInteger(rh * 2));
      assert.ok(!Object.is(rh, -0) && !Object.is(ri, -0));
    }
    assert.equal(sc.roundHalf(359.75), 0);
    assert.equal(sc.roundHalf(0.25), 0.5);
    assert.equal(sc.roundHalf(0.24), 0);
    assert.equal(sc.roundHalf(359.8), 0);
    assert.equal(sc.roundHalf(359.74), 359.5);
    assert.equal(sc.roundInt(359.5), 0);
    assert.equal(sc.roundInt(0.5), 1);
    assert.equal(sc.roundInt(0.49), 0);
    for (const bad of [NaN, Infinity, '1', null]) {
      throwsCode(() => sc.roundHalf(bad), 'INVALID_BEARING');
      throwsCode(() => sc.roundInt(bad), 'INVALID_BEARING');
      throwsCode(() => sc.boundaryDistance(bad), 'INVALID_BEARING');
    }
  });

  it('boundaryDistance: 與「到最近山界」逐界掃描 oracle 一致,範圍 [0,7.5]', () => {
    const g = makeGen(0x503);
    for (let i = 0; i < 40000; i += 1) {
      const x = g.bearing();
      if (Math.abs(x) > 1e9) continue;
      const nb = nm(x);
      let best = Infinity;
      for (let k = -1; k <= 24; k += 1) best = Math.min(best, Math.abs(nb - (7.5 + 15 * k)));
      const d = sc.boundaryDistance(x);
      assert.ok(near(d, best, 1e-9), `boundaryDistance(${x})=${d} 期望 ${best}`);
      assert.ok(d >= 0 && d <= 7.5 && !Object.is(d, -0));
    }
    assert.equal(sc.boundaryDistance(0), 7.5);
    assert.equal(sc.boundaryDistance(7.5), 0);
    assert.equal(sc.boundaryDistance(352.5), 0);
  });
});

describe('sensor 鎖定平均、品質燈號、不確定度(規格 2.9.4)', () => {
  /** 圓周統計 oracle: 以第一筆為參考旋轉,平均取 h0+atan2(Σsin d,Σcos d)(不同於實作的絕對角向量和)。 */
  function oStats(xs) {
    const h0 = xs[0];
    const d = xs.map((x) => ((((x - h0) % 360) + 540) % 360) - 180);
    const S = d.reduce((a, v) => a + Math.sin(rad(v)), 0);
    const C = d.reduce((a, v) => a + Math.cos(rad(v)), 0);
    const R = Math.hypot(S, C) / xs.length;
    if (R < 1e-9) return { mean: null, R, std: null };
    const mean = nm(h0 + deg(Math.atan2(S, C)));
    const dm = d.map((v) => ((((v - deg(Math.atan2(S, C))) % 360) + 540) % 360) - 180);
    const lin = Math.sqrt(dm.reduce((a, v) => a + v * v, 0) / xs.length);
    return { mean, R, std: R < 1 - 1e-6 ? deg(Math.sqrt(-2 * Math.log(R))) : lin, lin };
  }

  it('lockAverage: status/平均/σ/顯示值與 oracle 一致(跨 0 群集、緊群、鬆群、退化)', () => {
    const g = makeGen(0x601);
    const seen = { ok: 0, unstable: 0, 'too-few': 0 };
    for (let run = 0; run < 6000; run += 1) {
      const n = g.pick([0, 1, 5, 19, 20, 21, 60, g.int(1, 90)]);
      const center = g.pick([g.between(0, 360), 0, 359.9, 0.1, 180, 7.5]);
      const spread = g.pick([0, 0.01, 0.5, 1, 2, 3, 4, 8, 30, 120, 400]);
      const xs = Array.from({ length: n }, () => center + g.between(-spread, spread) + 360 * g.int(-2, 2));
      const r = sc.lockAverage(xs);
      assert.equal(r.n, n);
      if (n < 20) {
        assert.deepEqual([r.status, r.meanDeg, r.stdDeg, r.displayDeg], ['too-few', null, null, null]);
        seen['too-few'] += 1;
        continue;
      }
      const o = oStats(xs);
      if (o.mean === null) { assert.equal(r.meanDeg, null); assert.equal(r.status, 'unstable'); continue; }
      assert.ok(cdiff(r.meanDeg, o.mean) < 1e-6 + (o.R > 0.99 ? 0 : 1e-6), `mean ${r.meanDeg} vs ${o.mean}`);
      assert.ok(!Object.is(r.meanDeg, -0) && r.meanDeg >= 0 && r.meanDeg < 360);
      const tol = o.R < 1 - 1e-6 ? 1e-6 * (1 + o.std) : Math.max(1e-4, 0.01 * o.std);
      assert.ok(near(r.stdDeg, o.std, tol + 1e-6 * o.std), `σ ${r.stdDeg} vs ${o.std} (R=${o.R})`);
      if (Math.abs(o.std - 3) > 0.002) assert.equal(r.status, o.std > 3 ? 'unstable' : 'ok', `σ=${o.std}`);
      assert.equal(r.displayDeg, sc.roundHalf(r.meanDeg));
      seen[r.status] += 1;
    }
    assert.ok(seen.ok > 300 && seen.unstable > 300 && seen['too-few'] > 300, JSON.stringify(seen));
  });

  it('lockAverage: σ=3° ↔ R≈0.9986;自訂門檻;不改輸入;錯誤輸入', () => {
    assert.ok(near(Math.exp(-((rad(3)) ** 2) / 2), 0.9986, 5e-5));
    const twoPt = [];
    for (let i = 0; i < 20; i += 1) twoPt.push(i % 2 ? 100 + 2.99 : 100 - 2.99); // 圓周 σ = sqrt(-2 ln cos 2.99°) ≈ 2.9907
    assert.equal(sc.lockAverage(twoPt).status, 'ok');
    assert.equal(sc.lockAverage(twoPt.map((x, i) => (i % 2 ? x + 0.01 : x - 0.01))).status, 'unstable', '±3.0° 的圓周 σ 是 3.0007°,超過門檻');
    const wide = twoPt.map((x, i) => (i % 2 ? x + 0.05 : x - 0.05));
    assert.equal(sc.lockAverage(wide).status, 'unstable');
    assert.equal(sc.lockAverage(twoPt, { maxStdDeg: 2 }).status, 'unstable');
    assert.equal(sc.lockAverage(twoPt, { minSamples: 21 }).status, 'too-few');
    const frozen = Object.freeze(Array.from({ length: 30 }, (_, i) => 90 + (i % 3)));
    assert.doesNotThrow(() => sc.lockAverage(frozen));
    // 90 與 270 各半: 合成向量近 0
    const opp = Array.from({ length: 20 }, (_, i) => (i % 2 ? 90 : 270));
    assert.deepEqual([sc.lockAverage(opp).meanDeg, sc.lockAverage(opp).status], [null, 'unstable']);
    // 跨 0
    assert.equal(sc.lockAverage(Array.from({ length: 20 }, (_, i) => (i % 2 ? 359 : 1))).meanDeg, 0);
    assert.equal(sc.lockAverage(Array.from({ length: 20 }, (_, i) => (i % 2 ? 359 : 1))).displayDeg, 0);
    throwsCode(() => sc.lockAverage('x'), 'INVALID_READINGS');
    throwsCode(() => sc.lockAverage([1, NaN, ...Array(20).fill(1)]), 'INVALID_BEARING');
    for (const bad of [0, -1, 1.5, NaN]) throwsCode(() => sc.lockAverage([1], { minSamples: bad }), 'INVALID_OPTION');
    for (const bad of [-1, NaN, '3']) throwsCode(() => sc.lockAverage([1], { maxStdDeg: bad }), 'INVALID_OPTION');
    assert.deepEqual(sc.lockAverage([]), { status: 'too-few', n: 0, meanDeg: null, stdDeg: null, displayDeg: null });
    assert.deepEqual(sc.combineLockMeans([10, 11]).status, 'too-few');
    assert.equal(sc.combineLockMeans([10, 11, 12]).status, 'ok');
    assert.equal(sc.combineLockMeans([10, 50, 120]).status, 'unstable');
  });

  it('qualityLight: 與規格門檻 oracle 一致(綠≤10/≤2、黃 10-25/2-4、紅 <0/>25/>4;取較差)', () => {
    const lv = (v, gmax, ymax) => (v > ymax ? 2 : v > gmax ? 1 : 0);
    const g = makeGen(0x602);
    for (let i = 0; i < 20000; i += 1) {
      const acc = g.pick([null, undefined, -1, -0.001, 0, 10, 10.0001, 25, 25.0001, g.between(-5, 40)]);
      const sig = g.pick([null, undefined, 0, 2, 2.0001, 4, 4.0001, g.between(0, 8)]);
      const levels = [];
      if (acc !== null && acc !== undefined) levels.push(acc < 0 ? 2 : lv(acc, 10, 25));
      if (sig !== null && sig !== undefined) levels.push(lv(sig, 2, 4));
      const want = levels.length === 0 ? 'unknown' : ['green', 'yellow', 'red'][Math.max(...levels)];
      assert.equal(sc.qualityLight({ accuracyDeg: acc, sigmaDeg: sig }), want, `acc=${acc} σ=${sig}`);
    }
    assert.equal(sc.qualityLight(), 'unknown');
    for (const bad of [NaN, Infinity, '5']) throwsCode(() => sc.qualityLight({ accuracyDeg: bad }), 'INVALID_OPTION');
    for (const bad of [NaN, -1, '5']) throwsCode(() => sc.qualityLight({ sigmaDeg: bad }), 'INVALID_OPTION');
  });

  it('nearBoundary: 距分界 < max(σ, accuracy/2, 2°);負 accuracy 不計', () => {
    const g = makeGen(0x603);
    for (let i = 0; i < 20000; i += 1) {
      const h = g.bearing();
      if (Math.abs(h) > 1e9) continue;
      const sig = g.pick([null, 0, 1, 3.5, g.between(0, 6)]);
      const acc = g.pick([null, -1, 0, 4, 10, 25, g.between(-2, 30)]);
      const r = sc.nearBoundary({ headingDeg: h, sigmaDeg: sig, accuracyDeg: acc });
      const thr = Math.max(2, sig ?? 0, acc !== null && acc > 0 ? acc / 2 : 0);
      assert.ok(near(r.thresholdDeg, thr, 1e-12));
      assert.ok(near(r.distanceDeg, sc.boundaryDistance(h), 1e-12));
      assert.equal(r.near, r.distanceDeg < thr);
    }
  });

  it('measurementUncertainty(geo)/summarizeLock: 不確定度 = max(5, 2σ, accuracy);未校準警告;meta 回存', () => {
    const g = makeGen(0x604);
    for (let i = 0; i < 3000; i += 1) {
      const n = g.int(20, 80);
      const center = g.between(0, 360);
      const spread = g.pick([0.1, 1, 2, 5]);
      const xs = Array.from({ length: n }, () => center + g.between(-spread, spread));
      const acc = g.pick([null, -1, 0, 3, 12, 30]);
      const r = sc.summarizeLock(xs, { accuracyDeg: acc });
      const o = oStats(xs);
      assert.ok(near(r.uncertaintyDeg, Math.max(5, 2 * r.stdDeg, acc !== null && acc >= 0 ? acc : 0), 1e-9), `uncertainty ${r.uncertaintyDeg}`);
      assert.equal(r.meta.warnings.includes('uncalibrated'), acc !== null && acc < 0);
      assert.ok(near(r.boundaryDistDeg, sc.boundaryDistance(r.meanDeg), 1e-12));
      assert.equal(r.nearBoundary, r.meta.warnings.includes('nearBoundary'));
      assert.equal(r.quality, sc.qualityLight({ accuracyDeg: acc, sigmaDeg: r.stdDeg }));
      assert.equal(r.northMode ?? r.meta.northMode, 'magnetic');
      assert.ok(cdiff(r.meanDeg, o.mean) < 1e-4);
      assert.deepEqual(r.meta.ruleset, { lockSeconds: 3, measureUncertainty: 5 });
    }
    const s = sc.summarizeLock(Array(10).fill(50), { settings: { measureUncertainty: 8, lockSeconds: 5 } });
    assert.equal(s.status, 'too-few');
    assert.equal(s.uncertaintyDeg, null);
    assert.deepEqual(s.meta.ruleset, { lockSeconds: 5, measureUncertainty: 8 });
    assert.equal(sc.lockTargetSamples(3), 60);
    assert.equal(sc.lockTargetSamples(5), 100);
    assert.equal(sc.lockTargetSamples(10), 200);
    assert.equal(sc.lockTargetSamples(0.024), 0, '0.024 秒 = 0.48 筆四捨五入為 0(不是有效鎖定時間)');
    for (const bad of [0, -3, NaN, Infinity, '3']) throwsCode(() => sc.lockTargetSamples(bad), 'INVALID_OPTION');
    assert.throws(() => sc.summarizeLock(Array(30).fill(1), { settings: { bogus: 1 } }), /未知的設定鍵/);
    throwsCode(() => sc.summarizeLock(Array(30).fill(1), { settings: { lockSeconds: 0 } }), 'INVALID_OPTION');
    for (const bad of [-1, NaN, '5']) throwsCode(() => geo.measurementUncertainty({ baseline: bad }), 'INVALID_OPTION');
  });

  it('lockAllowed: 檢查順序與門檻(tilt<15、螢幕朝上、未校準、紅燈)', () => {
    const ok = { status: 'ok', tiltDeg: 3, faceDown: false, quality: 'green' };
    assert.deepEqual(sc.lockAllowed(ok), { allowed: true, reason: null });
    assert.equal(sc.lockAllowed(null).reason, 'no-reading');
    assert.equal(sc.lockAllowed(undefined).reason, 'no-reading');
    assert.equal(sc.lockAllowed({ ...ok, status: 'uncalibrated' }).reason, 'uncalibrated');
    for (const st of ['invalid', 'tilt-too-large', 'relative-not-north', 'no-sensor', 'degenerate']) assert.equal(sc.lockAllowed({ ...ok, status: st }).reason, 'no-reading', st);
    assert.equal(sc.lockAllowed({ ...ok, tiltDeg: 14.999 }).allowed, true);
    assert.equal(sc.lockAllowed({ ...ok, tiltDeg: 15 }).reason, 'tilt');
    assert.equal(sc.lockAllowed({ ...ok, tiltDeg: null }).allowed, true, 'iOS 無姿態角放行');
    assert.equal(sc.lockAllowed({ ...ok, faceDown: true }).reason, 'face-down');
    assert.equal(sc.lockAllowed({ ...ok, quality: 'red' }).reason, 'quality-red');
    assert.equal(sc.lockAllowed({ ...ok, tiltDeg: 30, faceDown: true, quality: 'red' }).reason, 'tilt', '傾角優先於螢幕朝下與紅燈');
    assert.equal(sc.lockAllowed({ ...ok, quality: 'yellow' }).allowed, true);
  });

  it('STATUS_INFO 逐字對規格 2.9.5 表(自規格文字解析),describeStatus 別名與正常狀態', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const spec = readFileSync(path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');
    const sec = spec.slice(spec.indexOf('**狀態碼→訊息'), spec.indexOf('#### 2.9.6'));
    const rows = [...sec.matchAll(/^\| ((?:`[^`|]+`\/?)+) \| ([^|]+) \| ([^|]*) \|$/gm)];
    assert.ok(rows.length >= 9, `規格表解析到 ${rows.length} 列`);
    let checked = 0;
    for (const m of rows) {
      const codes = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
      for (const code of codes) {
        const info = sc.STATUS_INFO[code];
        assert.ok(info, `STATUS_INFO 缺 ${code}`);
        assert.equal(info.message, m[2].trim(), code);
        assert.equal(info.action, m[3].trim(), code);
        checked += 1;
      }
    }
    assert.ok(checked >= 10, `逐字比對 ${checked} 個狀態碼`);
    assert.deepEqual(sc.describeStatus('no-sensor'), sc.STATUS_INFO['no-events']);
    assert.deepEqual(sc.describeStatus('unsupported'), sc.STATUS_INFO['no-events']);
    for (const s of ['ok', 'running', 'zzz', undefined, null, 'toString', '__proto__']) assert.equal(sc.describeStatus(s), null, String(s));
    assert.equal(sc.HINTS.faceDown, '請螢幕朝上');
    assert.equal(sc.HINTS.nearBoundary, '接近分界,建議重測');
    assert.equal(sc.HINTS.calibrate, '請遠離金屬,手持手機畫 8 字');
    assert.equal(sc.SENSOR_DEFAULTS.sampleMs, 50);
    assert.equal(sc.SENSOR_DEFAULTS.watchdogMs, 1500);
    assert.equal(sc.SENSOR_DEFAULTS.blendFromDeg, 40);
    assert.equal(sc.SENSOR_DEFAULTS.blendToDeg, 50);
    assert.equal(sc.SENSOR_DEFAULTS.iosTiltMaxDeg, 50);
    assert.equal(sc.SENSOR_DEFAULTS.lockMinSamples, 20);
    assert.equal(sc.SENSOR_DEFAULTS.lockMaxStdDeg, 3);
    assert.ok(Object.isFrozen(sc.SENSOR_DEFAULTS) && Object.isFrozen(sc.STATUS_INFO) && Object.isFrozen(sc.HINTS));
  });

  it('突變測試: 故意改錯的 oracle 必被抓出(決策表、混合、四捨五入)', () => {
    const g = makeGen(0x605);
    const rnd = () => ({ alpha: g.between(0, 360), beta: g.between(-180, 180), gamma: g.between(-90, 90), absolute: true });
    expectDiff(diffRun({ n: 500, gen: rnd, impl: (e) => sc.decodeOrientationEvent(e).headingDeg, oracle: (e) => { const h = oBlend(e.alpha, e.beta, e.gamma).heading; return h === null ? null : nm(h + 1); }, eq: (a, b) => angleEq(a, b, 1e-6) }), '航向偏 1°');
    expectDiff(diffRun({ n: 500, gen: rnd, impl: (e) => sc.pickHeadingBlend(e.alpha, e.beta, e.gamma).weight, oracle: (e) => Math.min(1, Math.max(0, (oAxes(e.alpha, e.beta, e.gamma).tilt - 40) / 10)), eq: (a, b) => near(a, b, 1e-9) }), '線性權重取代 smoothstep');
    expectDiff(diffRun({ n: 2000, gen: () => 0.25 * g.int(0, 1439), impl: (x) => sc.roundHalf(x), oracle: (x) => Math.floor(x * 2) / 2 }), '無條件捨去取代半數進位');
    expectDiff(diffRun({ n: 500, gen: () => ({ webkitCompassHeading: g.between(0, 400), alpha: 0, beta: g.between(0, 90), gamma: 0 }), impl: (e) => sc.decodeOrientationEvent(e).status, oracle: (e) => (oAxes(e.alpha, e.beta, e.gamma).tilt > 60 ? 'tilt-too-large' : 'ok') }), 'iOS 傾角門檻改 60');
    expectNoDiff(diffRun({ n: 500, gen: rnd, impl: (e) => sc.decodeOrientationEvent(e).headingDeg, oracle: (e) => oBlend(e.alpha, e.beta, e.gamma).heading, eq: (a, b) => angleEq(a, b, 1e-6), skip: (e) => { const t = oAxes(e.alpha, e.beta, e.gamma); return Math.abs(t.tilt - 40) < 1e-6 || Math.abs(t.tilt - 50) < 1e-6 || Math.min(Math.hypot(...t.topXY), Math.hypot(...t.backXY)) < 1e-6; } }), '對照組');
  });

  it('效能: 單次 < 5ms', () => {
    const g = makeGen(0x606);
    const evs = Array.from({ length: 3000 }, () => ({ alpha: g.between(0, 360), beta: g.between(-180, 180), gamma: g.between(-90, 90), absolute: true }));
    const xs = Array.from({ length: 60 }, () => g.between(80, 100));
    const timeEach = (label, fn) => {
      const ts = evs.map((e) => { const t0 = performance.now(); fn(e); return performance.now() - t0; }).sort((a, b) => a - b);
      const p99 = ts[Math.floor(ts.length * 0.99)];
      assert.ok(p99 < 5 && ts.reduce((a, b) => a + b, 0) / ts.length < 1, `${label} p99=${p99}`);
    };
    timeEach('decode', sc.decodeOrientationEvent);
    timeEach('pickHeadingBlend', (e) => sc.pickHeadingBlend(e.alpha, e.beta, e.gamma));
    timeEach('lockAverage(60)', () => sc.lockAverage(xs));
    timeEach('summarizeLock(60)', () => sc.summarizeLock(xs, { accuracyDeg: 5 }));
  });
});

// ═══════════════════════════ 9. sensor.js 感測層: 假環境 ═══════════════════════════

function makeFakeEnv(opts = {}) {
  const st = { now: 1_700_000_000_000, nextId: 1, timers: new Map(), listeners: new Map(), docListeners: new Set() };
  const win = {
    isSecureContext: opts.secure ?? true,
    addEventListener(type, fn) {
      if (!st.listeners.has(type)) st.listeners.set(type, new Set());
      st.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { st.listeners.get(type)?.delete(fn); },
  };
  if (opts.DOE !== null) win.DeviceOrientationEvent = opts.DOE ?? function DeviceOrientationEvent() {};
  if (opts.absolute) win.ondeviceorientationabsolute = null;
  const doc = {
    visibilityState: 'visible',
    addEventListener(t, fn) { if (t === 'visibilitychange') st.docListeners.add(fn); },
    removeEventListener(t, fn) { if (t === 'visibilitychange') st.docListeners.delete(fn); },
  };
  const add = (repeat) => (fn, ms) => { const id = st.nextId++; st.timers.set(id, { fn, ms, due: st.now + ms, repeat }); return id; };
  const timers = { setInterval: add(true), setTimeout: add(false), clearInterval: (id) => st.timers.delete(id), clearTimeout: (id) => st.timers.delete(id) };
  const F = {
    env: opts.noDoc ? { win, timers, now: () => st.now } : { win, doc, timers, now: () => st.now },
    st,
    doc,
    win,
    listenerCount: () => [...st.listeners.values()].reduce((a, s) => a + s.size, 0),
    listenerTypes: () => [...st.listeners.entries()].filter(([, s]) => s.size > 0).map(([t]) => t),
    intervals: () => [...st.timers.values()].filter((t) => t.repeat).length,
    timeouts: () => [...st.timers.values()].filter((t) => !t.repeat).length,
    emit(type, ev) { for (const fn of [...(st.listeners.get(type) ?? [])]) fn({ type, ...ev }); },
    advance(ms) {
      const target = st.now + ms;
      for (;;) {
        let best = null;
        let bestId = null;
        for (const [id, t] of st.timers) if (t.due <= target && (best === null || t.due < best.due)) { best = t; bestId = id; }
        if (best === null) break;
        st.now = Math.max(st.now, best.due);
        if (best.repeat) best.due += best.ms; else st.timers.delete(bestId);
        best.fn();
      }
      st.now = target;
    },
    setVisibility(v) { doc.visibilityState = v; for (const fn of [...st.docListeners]) fn(); },
  };
  return F;
}
/** 鎖定 promise 若未結案(實作退化時)不能讓整個測試卡死,1.5 秒後轉成失敗。 */
const soon = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("promise 未結案(逾時)")), 1500).unref())]);
const absEv = (alpha, beta = 0, gamma = 0) => ({ alpha, beta, gamma, absolute: true });
const iosEv = (h, acc, extra = {}) => ({ alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: h, webkitCompassAccuracy: acc, ...extra });

describe('sensor.js createCompassSource: 情境(規格 2.9.5、D69)', () => {
  it('權限與環境流程: insecure → unsupported → 有/無 requestPermission;授權參數 true;只問一次', async () => {
    let F = makeFakeEnv({ secure: false });
    let seen = [];
    let s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x) });
    assert.deepEqual(await s.start(), { ok: false, status: 'insecure-context' });
    assert.deepEqual(seen, ['insecure-context']);
    assert.equal(s.running, false);
    assert.equal(F.listenerCount() + F.intervals() + F.timeouts(), 0);

    F = makeFakeEnv({ DOE: null });
    seen = [];
    s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x) });
    assert.deepEqual(await s.start(), { ok: false, status: 'unsupported' });

    // 順序: insecure-context 優先於 unsupported
    F = makeFakeEnv({ secure: false, DOE: null });
    assert.equal((await createCompassSource({ env: F.env }).start()).status, 'insecure-context');

    const calls = [];
    const DOE = Object.assign(function () {}, { requestPermission: async (arg) => { calls.push(arg); return 'granted'; } });
    F = makeFakeEnv({ DOE });
    seen = [];
    s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x) });
    const [a, b] = await Promise.all([s.start(), s.start()]);
    assert.deepEqual([a, b], [{ ok: true, status: 'running' }, { ok: true, status: 'running' }]);
    assert.deepEqual(calls, [true], '只呼叫一次,參數 true');
    assert.deepEqual(await s.start(), { ok: true, status: 'running' });
    assert.deepEqual(calls, [true]);
    assert.equal(s.running, true);
    assert.deepEqual(F.listenerTypes(), ['deviceorientation']);
    s.resume();
    assert.deepEqual(calls, [true], 'resume 不再要求權限');
    s.stop();
    assert.equal(F.listenerCount() + F.intervals() + F.timeouts(), 0);
    assert.equal(F.st.docListeners.size, 0, 'stop 後應移除 visibilitychange 監聽');

    for (const [answer, want] of [['denied', 'permission-denied'], ['default', 'permission-denied'], [undefined, 'permission-denied'], [true, 'permission-denied']]) {
      F = makeFakeEnv({ DOE: Object.assign(function () {}, { requestPermission: async () => answer }) });
      seen = [];
      s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x) });
      assert.deepEqual(await s.start(), { ok: false, status: want });
      assert.equal(s.running, false);
      assert.equal(F.listenerCount() + F.intervals() + F.timeouts(), 0);
    }
    F = makeFakeEnv({ DOE: Object.assign(function () {}, { requestPermission: async () => { throw new Error('NotAllowedError'); } }) });
    seen = [];
    const details = [];
    s = createCompassSource({ env: F.env, onStatus: (x, d) => { seen.push(x); details.push(d); } });
    assert.deepEqual(await s.start(), { ok: false, status: 'permission-error' });
    assert.ok(String(details[0]).includes('NotAllowedError'));
    assert.equal(s.running, false);
    // proceedOnPermissionError: 仍掛監聽
    F = makeFakeEnv({ DOE: Object.assign(function () {}, { requestPermission: async () => { throw new Error('x'); } }) });
    s = createCompassSource({ env: F.env, proceedOnPermissionError: true });
    assert.equal((await s.start()).ok, true);
    assert.equal(s.running, true);
    s.stop();
  });

  it('聽哪個事件: 有 ondeviceorientationabsolute 只聽 absolute;否則只聽 deviceorientation;debug 旗標兩者皆聽', async () => {
    let F = makeFakeEnv({ absolute: true });
    let s = createCompassSource({ env: F.env });
    await s.start();
    assert.deepEqual(F.listenerTypes(), ['deviceorientationabsolute']);
    s.stop();
    F = makeFakeEnv({ absolute: true });
    s = createCompassSource({ env: F.env, debugTreatRelativeAsAbsolute: true });
    await s.start();
    assert.deepEqual(F.listenerTypes().sort(), ['deviceorientation', 'deviceorientationabsolute']);
    s.stop();
    assert.equal(F.listenerCount(), 0);
    F = makeFakeEnv({});
    s = createCompassSource({ env: F.env });
    await s.start();
    assert.deepEqual(F.listenerTypes(), ['deviceorientation']);
    // relative 事件被拒絕
    const seen = [];
    const s2 = createCompassSource({ env: (F = makeFakeEnv({})).env, onReading: (r) => seen.push(r) });
    await s2.start();
    F.emit('deviceorientation', { alpha: 10, beta: 0, gamma: 0, absolute: false });
    F.advance(200);
    assert.ok(seen.length >= 3 && seen.every((r) => r.status === 'relative-not-north' && r.headingDeg === null && r.displayDeg === null));
    s2.stop();
  });

  it('watchdog: 1499ms 無 no-events、1500ms 觸發;事件到達後回報 running;之後不再重複觸發', async () => {
    const F = makeFakeEnv({ absolute: true });
    const seen = [];
    const s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x) });
    await s.start();
    assert.deepEqual(seen, ['running']);
    F.advance(1499);
    assert.deepEqual(seen, ['running']);
    F.advance(1);
    assert.deepEqual(seen, ['running', 'no-events']);
    F.advance(10000);
    assert.deepEqual(seen, ['running', 'no-events'], 'no-events 只報一次');
    F.emit('deviceorientationabsolute', absEv(90));
    assert.deepEqual(seen, ['running', 'no-events', 'running']);
    F.emit('deviceorientationabsolute', absEv(90));
    assert.deepEqual(seen, ['running', 'no-events', 'running']);
    F.advance(5000);
    assert.equal(seen.length, 3);
    // 事件先到則 watchdog 被清掉
    const F2 = makeFakeEnv({ absolute: true });
    const seen2 = [];
    const s2 = createCompassSource({ env: F2.env, onStatus: (x) => seen2.push(x) });
    await s2.start();
    F2.advance(100);
    F2.emit('deviceorientationabsolute', absEv(0));
    assert.equal(F2.timeouts(), 0);
    F2.advance(5000);
    assert.deepEqual(seen2, ['running']);
    s.stop();
    s2.stop();
  });

  it('取樣 20Hz: 1 秒 20 筆;無事件不產生讀數;EMA 與顯示;σ 由第 5 筆起;讀數 JSON 可序列化', async () => {
    const F = makeFakeEnv({ absolute: true });
    const rs = [];
    const s = createCompassSource({ env: F.env, onReading: (r) => rs.push(r) });
    await s.start();
    F.advance(500);
    assert.equal(rs.length, 0, '沒有事件就沒有讀數');
    F.emit('deviceorientationabsolute', absEv(90, 0, 0)); // 頂端朝 270
    F.advance(1000);
    assert.equal(rs.length, 20);
    rs.forEach((r, i) => {
      assert.equal(r.status, 'ok');
      assert.equal(r.headingDeg, 270);
      assert.equal(r.displayDeg, 270);
      assert.equal(r.smoothedDeg, 270);
      assert.ok(i + 1 >= 5 ? near(r.sigmaDeg, 0, 1e-9) : r.sigmaDeg === null, `i=${i} σ=${r.sigmaDeg}`);
      assert.equal(r.quality, i + 1 >= 5 ? 'green' : 'unknown');
      assert.equal(r.t, F.st.now - 1000 + 50 * (i + 1));
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    });
    assert.deepEqual(s.getLastReading(), rs[19]);
    s.stop();
    assert.equal(s.getLastReading(), null);
  });

  it('EMA 跨 0: 359 與 1 交替時平滑值停在 0 附近、顯示值不出現 180;σ 小', async () => {
    const F = makeFakeEnv({ absolute: true });
    const rs = [];
    const s = createCompassSource({ env: F.env, onReading: (r) => rs.push(r) });
    await s.start();
    for (let i = 0; i < 100; i += 1) {
      F.emit('deviceorientationabsolute', absEv(i % 2 ? 359 : 1)); // 頂端 (360-α): 1 或 359
      F.advance(50);
    }
    assert.equal(rs.length, 100);
    for (const r of rs.slice(3)) {
      assert.ok(cdiff(r.smoothedDeg, 0) < 2, `平滑值繞到 ${r.smoothedDeg}`);
      assert.ok([0, 1, 359].includes(r.displayDeg), `顯示 ${r.displayDeg}`);
    }
    assert.ok(rs[99].sigmaDeg < 2 && rs[99].sigmaDeg > 0.5, `σ=${rs[99].sigmaDeg}`);
    s.stop();
  });

  it('讀數中斷(非 ok)後不從過期的平滑值與 σ 視窗拖曳: 恢復的第一筆直接取樣', async () => {
    const F = makeFakeEnv({ DOE: Object.assign(function () {}, { requestPermission: async () => 'granted' }) });
    const rs = [];
    const s = createCompassSource({ env: F.env, onReading: (r) => rs.push(r) });
    await s.start();
    F.emit('deviceorientation', iosEv(90, 5));
    F.advance(500);
    assert.equal(rs.at(-1).smoothedDeg, 90);
    F.emit('deviceorientation', iosEv(10, -1)); // uncalibrated
    F.advance(50);
    assert.equal(rs.at(-1).status, 'uncalibrated');
    F.emit('deviceorientation', iosEv(270, 5));
    F.advance(50);
    const r = rs.at(-1);
    assert.equal(r.status, 'ok');
    assert.equal(r.smoothedDeg, 270, '不可由舊的 90 度平滑過來');
    assert.equal(r.sigmaDeg, null, 'σ 視窗應已清空,不含中斷前的讀數');
    s.stop();
  });

  it('iOS: webkitCompassHeading=360 顯示 0;accuracy=-1 → uncalibrated/紅燈/停用鎖定;tilt>50 → tilt-too-large', async () => {
    const F = makeFakeEnv({ DOE: Object.assign(function () {}, { requestPermission: async () => 'granted' }) });
    const rs = [];
    const s = createCompassSource({ env: F.env, onReading: (r) => rs.push(r) });
    await s.start();
    F.emit('deviceorientation', iosEv(360, 5));
    F.advance(100);
    assert.deepEqual([rs.at(-1).headingDeg, rs.at(-1).displayDeg, rs.at(-1).source, rs.at(-1).accuracyDeg], [0, 0, 'webkitCompassHeading', 5]);
    F.emit('deviceorientation', iosEv(10, -1));
    F.advance(100);
    assert.deepEqual([rs.at(-1).status, rs.at(-1).quality, rs.at(-1).smoothedDeg, rs.at(-1).displayDeg], ['uncalibrated', 'red', null, null]);
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'uncalibrated' });
    F.emit('deviceorientation', iosEv(10, 5, { beta: 80 }));
    F.advance(100);
    assert.equal(rs.at(-1).status, 'tilt-too-large');
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'no-reading' });
    s.stop();
  });

  it('鎖定: 穩定 → ok、60 筆、平均與顯示 0.5°;抖動 → unstable;傾角/朝下/未啟動 → blocked;stop、進背景 → cancelled;重複呼叫同 promise', async () => {
    const mk = async (settings) => {
      const F = makeFakeEnv({ absolute: true });
      const s = createCompassSource({ env: F.env, settings });
      await s.start();
      return { F, s };
    };
    // 穩定: 頂端 = 360-236.6 = 123.4
    let { F, s } = await mk({});
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'no-reading' });
    F.emit('deviceorientationabsolute', absEv(236.6));
    F.advance(200);
    const p = s.lock();
    assert.equal(s.lock(), p, '進行中重複呼叫回同一個 promise');
    F.advance(3000);
    const r = await p;
    assert.equal(r.status, 'ok');
    assert.equal(r.n, 60);
    assert.ok(cdiff(r.meanDeg, 123.4) < 1e-9);
    assert.equal(r.displayDeg, 123.5);
    assert.equal(r.quality, 'green');
    assert.equal(r.lockedAtMs, F.st.now);
    assert.deepEqual(r.meta.ruleset, { lockSeconds: 3, measureUncertainty: 5 });
    assert.ok(Math.abs(r.uncertaintyDeg - 5) < 1e-12);
    // 鎖完可再鎖
    const p2 = s.lock();
    assert.notEqual(p2, p);
    s.stop();
    assert.deepEqual(await p2, { status: 'cancelled' });

    // lockSeconds=5 → 100 筆
    ({ F, s } = await mk({ lockSeconds: 5 }));
    F.emit('deviceorientationabsolute', absEv(10));
    F.advance(100);
    const p5 = s.lock();
    F.advance(5000);
    assert.equal((await p5).n, 100);
    s.stop();

    // 抖動: 每個 tick 換一個相差 ±10° 的航向 → σ>3 → unstable
    ({ F, s } = await mk({}));
    F.emit('deviceorientationabsolute', absEv(0));
    F.advance(100);
    const pu = s.lock();
    for (let i = 0; i < 61; i += 1) { F.emit('deviceorientationabsolute', absEv(i % 2 ? 350 : 10)); F.advance(50); }
    const ru = await pu;
    assert.equal(ru.status, 'unstable');
    assert.ok(ru.stdDeg > 3);
    s.stop();

    // 傾角 >= 15 → blocked tilt;螢幕朝下 → face-down
    ({ F, s } = await mk({}));
    F.emit('deviceorientationabsolute', absEv(0, 20, 0));
    F.advance(100);
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'tilt' });
    F.emit('deviceorientationabsolute', absEv(0, 180, 0));
    F.advance(100);
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'face-down' });
    // 鎖定期間傾角超標的樣本不計入 → too-few
    F.emit('deviceorientationabsolute', absEv(0, 0, 0));
    F.advance(1500); // 近 1 秒 σ 窗要先把朝下時的讀數擠掉,否則品質燈號是紅的
    const pt = s.lock();
    F.emit('deviceorientationabsolute', absEv(0, 30, 0));
    F.advance(3100);
    const rt = await pt;
    assert.equal(rt.status, 'too-few');
    assert.ok(rt.n < 20);
    s.stop();

    // 進背景 → cancelled;回前景後可重新鎖定
    ({ F, s } = await mk({}));
    F.emit('deviceorientationabsolute', absEv(0));
    F.advance(100);
    const pc = s.lock();
    F.advance(500);
    F.setVisibility('hidden');
    assert.deepEqual(await pc, { status: 'cancelled' });
    assert.equal(s.running, false);
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'not-running' });
    F.setVisibility('visible');
    assert.equal(s.running, true);
    s.stop();
    assert.deepEqual(await soon(s.lock()), { status: 'blocked', reason: 'not-running' });
  });

  it('可見性: 進背景停掉監聽與計時器,回前景重掛並重計 watchdog、回報 running,不重問權限', async () => {
    const calls = [];
    const F = makeFakeEnv({ absolute: true, DOE: Object.assign(function () {}, { requestPermission: async () => { calls.push(1); return 'granted'; } }) });
    const seen = [];
    const rs = [];
    const s = createCompassSource({ env: F.env, onStatus: (x) => seen.push(x), onReading: (r) => rs.push(r) });
    await s.start();
    F.emit('deviceorientationabsolute', absEv(90));
    F.advance(300);
    const n0 = rs.length;
    F.setVisibility('hidden');
    assert.equal(F.listenerCount() + F.intervals() + F.timeouts(), 0);
    assert.equal(s.running, false);
    assert.equal(s.getLastReading(), null);
    F.advance(5000);
    assert.equal(rs.length, n0);
    F.setVisibility('visible');
    assert.equal(s.running, true);
    assert.equal(F.intervals(), 1);
    assert.equal(F.timeouts(), 1);
    F.advance(1500);
    assert.equal(seen.at(-1), 'no-events', '回前景重計 watchdog');
    assert.deepEqual(calls, [1]);
    // 重複 hidden/visible 不會累積監聽
    for (let i = 0; i < 10; i += 1) { F.setVisibility('hidden'); F.setVisibility('visible'); F.setVisibility('visible'); }
    assert.equal(F.listenerCount(), 1);
    assert.equal(F.intervals(), 1);
    // 從背景中啟動: 不掛監聽,回前景才掛
    const G = makeFakeEnv({ absolute: true });
    G.doc.visibilityState = 'hidden';
    const s2 = createCompassSource({ env: G.env });
    assert.deepEqual(await s2.start(), { ok: true, status: 'running' });
    assert.equal(G.listenerCount(), 0);
    G.setVisibility('visible');
    assert.equal(G.listenerCount(), 1);
    // resume: 重啟並重計 watchdog
    assert.equal(s2.resume(), true);
    assert.equal(G.listenerCount(), 1);
    assert.equal(G.intervals(), 1);
    s2.stop();
    assert.equal(s2.resume(), false, 'stop 後 resume 回 false');
    s.stop();
    // 沒有 doc 的環境
    const H = makeFakeEnv({ absolute: true, noDoc: true });
    const s3 = createCompassSource({ env: H.env });
    await s3.start();
    assert.equal(s3.running, true);
    s3.stop();
  });

  it('stop 與進行中的 start 競態: stop 讓 pending 的 start 作廢(cancelled),不留下監聽', async () => {
    let release;
    const DOE = Object.assign(function () {}, { requestPermission: () => new Promise((r) => { release = r; }) });
    const F = makeFakeEnv({ DOE });
    const s = createCompassSource({ env: F.env });
    const p = s.start();
    s.stop();
    release('granted');
    assert.deepEqual(await p, { ok: false, status: 'cancelled' });
    assert.equal(s.running, false);
    assert.equal(F.listenerCount() + F.intervals() + F.timeouts(), 0);
    // stop 後可重新 start(重新要求權限)
    const p2 = s.start();
    release('granted');
    assert.deepEqual(await p2, { ok: true, status: 'running' });
    s.stop();
    // 進行中重複呼叫共用同一個 promise
    const p3 = s.start();
    assert.equal(s.start(), p3);
    release('granted');
    await p3;
    s.stop();
  });

  it('參數驗證與 createBrowserEnv', () => {
    const F = makeFakeEnv({});
    for (const bad of [undefined, null, 5]) throwsCode(() => createCompassSource({ env: bad }), 'INVALID_OPTION');
    throwsCode(() => createCompassSource({ env: { ...F.env, now: 5 } }), 'INVALID_OPTION');
    throwsCode(() => createCompassSource({ env: { ...F.env, timers: { ...F.env.timers, setInterval: null } } }), 'INVALID_OPTION');
    throwsCode(() => createCompassSource({ env: { ...F.env, win: null } }), 'INVALID_OPTION');
    for (const k of ['sampleMs', 'watchdogMs', 'tauSec']) for (const bad of [0, -1, NaN, Infinity, '50']) throwsCode(() => createCompassSource({ env: F.env, [k]: bad }), 'INVALID_OPTION');
    assert.throws(() => createCompassSource({ env: F.env, settings: { nope: 1 } }), /未知的設定鍵/);
    throwsCode(() => createCompassSource({ env: F.env, settings: { lockSeconds: 0 } }), 'INVALID_OPTION');
    assert.doesNotThrow(() => createCompassSource({ env: F.env }));
    throwsCode(() => createCompassSource(), 'INVALID_OPTION');
    // createBrowserEnv
    for (const bad of [null, undefined, 5]) throwsCode(() => createBrowserEnv(bad), 'INVALID_OPTION');
    const calls = [];
    const g = { performance: { now: () => 5, timeOrigin: 1000 }, document: { x: 1 }, setInterval: (f, m) => { calls.push(['si', m]); return 7; }, clearInterval: (i) => calls.push(['ci', i]), setTimeout: (f, m) => { calls.push(['st', m]); return 8; }, clearTimeout: (i) => calls.push(['ct', i]), Date: { now: () => 42 } };
    const env = createBrowserEnv(g);
    assert.equal(env.now(), 1005);
    assert.equal(env.win, g);
    assert.equal(env.doc, g.document);
    assert.equal(env.timers.setInterval(() => {}, 50), 7);
    env.timers.clearTimeout(8);
    assert.deepEqual(calls, [['si', 50], ['ct', 8]]);
    const env2 = createBrowserEnv({ ...g, performance: undefined, document: undefined });
    assert.equal(env2.now(), 42);
    assert.equal(env2.doc, null);
    assert.equal(createBrowserEnv({ ...g, performance: { now: () => 5 } }).now(), 42, 'timeOrigin 缺則退回 Date.now');
  });

  it('隨機操作序列(start/stop/resume/可見性/時間/事件/鎖定): 監聽與計時器不外洩、狀態一致、讀數合法、鎖定必結案', async () => {
    const STATUSES = new Set(['running', 'no-events', 'insecure-context', 'unsupported', 'permission-denied', 'permission-error']);
    const LOCK_STATUSES = new Set(['ok', 'unstable', 'too-few', 'cancelled', 'blocked']);
    for (let run = 0; run < 150; run += 1) {
      const g = makeGen(0x9000 + run);
      const absolute = g.rnd() < 0.5;
      const perm = g.pick(['granted', 'granted', 'denied', 'throw', 'none']);
      const DOE = perm === 'none' ? function () {} : Object.assign(function () {}, { requestPermission: async () => { if (perm === 'throw') throw new Error('e'); return perm; } });
      const F = makeFakeEnv({ absolute, DOE });
      const readings = [];
      const statuses = [];
      const lockSeconds = g.pick([1, 3, 5]);
      const s = createCompassSource({ env: F.env, settings: { lockSeconds }, onReading: (r) => readings.push(r), onStatus: (x) => statuses.push(x), proceedOnPermissionError: g.rnd() < 0.3 });
      const evType = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
      const locks = [];
      let stopped = false;
      const check = (what) => {
        const hidden = F.doc.visibilityState === 'hidden';
        if (s.running) {
          assert.equal(F.intervals(), 1, `${what}: running 但計時器=${F.intervals()}`);
          assert.ok(F.timeouts() <= 1, `${what}: watchdog 多於 1`);
          assert.deepEqual(F.listenerTypes(), [evType], `${what}: 監聽 ${F.listenerTypes()}`);
          assert.equal(F.listenerCount(), 1);
          assert.equal(hidden, false, `${what}: 背景中不該在跑`);
        } else {
          assert.equal(F.intervals() + F.timeouts() + F.listenerCount(), 0, `${what}: 未執行卻有殘留 i=${F.intervals()} t=${F.timeouts()} l=${F.listenerCount()}`);
          assert.equal(s.getLastReading(), null, `${what}: 未執行卻有 lastReading`);
        }
        if (stopped) assert.equal(F.st.docListeners.size, 0, `${what}: stop 後仍有可見性監聽`);
      };
      for (let step = 0; step < 80; step += 1) {
        const op = g.int(0, 11);
        if (op === 0) { const r = await s.start(); assert.ok(typeof r.ok === 'boolean' && typeof r.status === 'string'); if (r.ok) stopped = false; }
        else if (op === 1) { s.stop(); stopped = true; }
        else if (op === 2) { s.resume(); }
        else if (op === 3) { F.setVisibility(g.pick(['hidden', 'visible', 'visible'])); }
        else if (op <= 5) { F.advance(g.pick([1, 49, 50, 51, g.int(1, 700), 1500, 3100])); }
        else if (op <= 8) {
          const kind = g.int(0, 4);
          const ev = kind === 0 ? absEv(g.between(0, 360), g.between(-10, 10), g.between(-10, 10))
            : kind === 1 ? absEv(g.between(0, 360), g.between(0, 180), g.between(-90, 90))
              : kind === 2 ? iosEv(g.between(0, 360), g.pick([-1, 5, 20]))
                : kind === 3 ? { alpha: null, beta: 0, gamma: 0, absolute: true }
                  : { alpha: g.between(0, 360), beta: 0, gamma: 0, absolute: false };
          F.emit(g.pick([evType, evType, evType, absolute ? 'deviceorientation' : 'deviceorientationabsolute']), ev);
        } else if (op === 9) { locks.push(s.lock()); }
        else { s.getLastReading(); }
        check(`run=${run} step=${step} op=${op}`);
      }
      // 讀數與狀態合法
      for (const r of readings) {
        assert.deepEqual(JSON.parse(JSON.stringify(r)), r, `讀數 JSON 不對稱: ${JSON.stringify(r)}`);
        assert.ok(r.headingDeg === null || (r.headingDeg >= 0 && r.headingDeg < 360));
        assert.ok(r.smoothedDeg === null || (r.smoothedDeg >= 0 && r.smoothedDeg < 360));
        assert.ok(r.displayDeg === null || (Number.isInteger(r.displayDeg) && r.displayDeg >= 0 && r.displayDeg < 360));
        assert.ok(r.sigmaDeg === null || r.sigmaDeg >= 0);
        assert.equal(r.status === 'ok', r.headingDeg !== null);
        assert.equal(r.smoothedDeg === null, r.displayDeg === null);
        assert.ok(['green', 'yellow', 'red', 'unknown'].includes(r.quality));
      }
      for (const x of statuses) assert.ok(STATUSES.has(x), `未知狀態 ${x}`);
      // 讀數時間單調不減
      for (let i = 1; i < readings.length; i += 1) assert.ok(readings[i].t >= readings[i - 1].t);
      // 停止後不再有任何回呼
      s.stop();
      check(`run=${run} 收尾`);
      const nr = readings.length;
      const ns = statuses.length;
      F.advance(10000);
      F.emit(evType, absEv(10));
      F.setVisibility('visible');
      assert.equal(readings.length, nr, '停止後仍有讀數');
      assert.equal(statuses.length, ns, '停止後仍有狀態');
      // 所有鎖定 promise 必已結案且結果合法
      const results = await soon(Promise.all(locks));
      for (const r of results) {
        assert.ok(LOCK_STATUSES.has(r.status), `鎖定結果狀態 ${r.status}`);
        if (['ok', 'unstable', 'too-few'].includes(r.status)) {
          assert.ok(r.n <= lockSeconds * 20 + 1, `鎖定筆數 ${r.n} > ${lockSeconds * 20 + 1}`);
          if (r.status === 'ok') assert.ok(r.n >= 20 && r.stdDeg <= 3 && Number.isInteger(r.displayDeg * 2));
          assert.deepEqual(JSON.parse(JSON.stringify(r)), r, '鎖定結果 JSON');
        }
        if (r.status === 'blocked') assert.ok(['not-running', 'no-reading', 'uncalibrated', 'tilt', 'face-down', 'quality-red'].includes(r.reason));
      }
    }
  });
});

// ═══════════════════════════ 10. 已知缺口(todo,不擋 CI) ═══════════════════════════

describe('已知缺口(記錄用,todo 不擋 CI)', () => {
  it('geo(不屬本審查範圍): 山界正下方 1 ulp 的方位被判到下一山/下一卦,與 luopan.cellAt 的精確半開區間不一致', { todo: 'geo.locate 的 dev 計算對 nb≈7.5-ε 進位成 -7.5;影響 <1e-13 度,實機不可見' }, () => {
    for (const b of [7.499999999999999, 22.499999999999996, 112.49999999999999, 352.49999999999994]) {
      assert.equal(geo.mountainAt(b).name, lp.cellAt('mountains24', b).name, `b=${b}`);
      assert.equal(geo.guaAt(b).gua, lp.cellAt('bagua', b).gua, `bagua b=${b}`);
    }
  });
});

// bazhai 獨立審查(skeptic)的隨機差分測試。
// 原則: 所有 oracle 由規格 DOMAIN_SPEC.md 2.3 / 3.2 / 4.4 的規則獨立重寫,不呼叫 src/core/bazhai.js 的內部表或演算法;
// 立春依賴 test/fixtures/bazhai.json 的 Skyfield 立春表(獨立於 calendar.js),與 calendar 差 <= 69 秒,
// 所以凡是落在「表與 calendar 可能不一致」的 100 秒窗內的樣本一律略過,由另一組自我一致性測試(以 calendar 為準)覆蓋。
// 確定性: 自帶 mulberry32,固定種子。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../helpers/harness.js';
import * as bz from '../../src/core/bazhai.js';
import * as cal from '../../src/core/calendar.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const SPEC = readFileSync(path.join(ROOT, 'docs', 'DOMAIN_SPEC.md'), 'utf8');

// ───────────────────────── 亂數與小工具 ─────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1)); // 含兩端整數
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const imod = (a, n) => ((a % n) + n) % n;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CODE_RE = /^[A-Z][A-Z0-9_]*: /;
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
/** 盡力改動輸出(凍結的部分略過),用來驗證輸出沒有和內部狀態共用。 */
function tryMutate(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return;
  for (const k of Object.keys(o)) {
    try {
      if (typeof o[k] === 'string') o[k] = `${o[k]}!`;
      else if (typeof o[k] === 'number') o[k] += 1;
      else if (typeof o[k] === 'boolean') o[k] = !o[k];
    } catch {
      /* 凍結: 沒關係 */
    }
    tryMutate(o[k], depth + 1);
  }
  if (Array.isArray(o)) {
    try {
      o.reverse();
    } catch {
      /* 凍結 */
    }
  }
}

// ───────────────────────── 由規格獨立取得的常數 ─────────────────────────
function specJson(marker) {
  const i = SPEC.indexOf(marker);
  assert.ok(i > 0, `規格找不到 ${marker}`);
  const s = SPEC.lastIndexOf('```json', i);
  const e = SPEC.indexOf('```', i);
  return JSON.parse(SPEC.slice(s + 7, e));
}
const SPEC_STAR_TABLE = specJson(' "坎": {"北":"伏位"'); // 規格 2.3.2 的 8x8
const SPEC_MOUNTAINS = specJson('[["子","坎","天元","陰"]'); // 規格 2.1.1

const GUA = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const DIR_OF = Object.fromEntries(GUA.map((g, i) => [g, DIRS[i]]));
const STARS_ORDER = ['生氣', '五鬼', '延年', '六煞', '禍害', '天醫', '絕命', '伏位']; // 規格 2.3.2 產生規則星序
const GUA_BITS = { 乾: '111', 兌: '110', 離: '101', 震: '100', 巽: '011', 坎: '010', 艮: '001', 坤: '000' }; // 下→上
const GUA_OF_BITS = Object.fromEntries(Object.entries(GUA_BITS).map(([g, b]) => [b, g]));
const LUOSHU_GUA = { 1: '坎', 2: '坤', 3: '震', 4: '巽', 6: '乾', 7: '兌', 8: '艮', 9: '離' };
const EAST = new Set(['坎', '震', '巽', '離']);
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const ganzhi = (y) => {
  const i = imod(y - 4, 60);
  return STEMS[i % 10] + BRANCHES[i % 12];
};

/** 規格 2.3.2 產生規則: 從本卦起依序改 上、中、下、中、上、中、下、中 爻。 */
function oracleStarTable() {
  const flipOrder = [2, 1, 0, 1, 2, 1, 0, 1]; // 位置 0=下爻
  const table = {};
  for (const home of GUA) {
    const bits = GUA_BITS[home].split('');
    const row = {};
    flipOrder.forEach((pos, k) => {
      bits[pos] = bits[pos] === '1' ? '0' : '1';
      row[DIR_OF[GUA_OF_BITS[bits.join('')]]] = STARS_ORDER[k];
    });
    table[home] = row;
  }
  return table;
}
const ORACLE_TABLE = oracleStarTable();

// 24 山 → 卦(規格 2.1.1 的表)
const MT_NAME = SPEC_MOUNTAINS.map((m) => m[0]);
const MT_GUA = SPEC_MOUNTAINS.map((m) => m[1]);

// ───────────────────────── 命卦 oracle(排山掌訣 + 末兩位公式) ─────────────────────────
const mod9 = (x) => imod(x - 1, 9) + 1;
/** 排山掌訣(《八宅明鏡》): 上元 1864、中元 1924、下元 1984;男起 1/4/7 逆,女起 5/2/8 順;每 180 年一輪。 */
function palmNumber(Y, gender) {
  const d = imod(Y - 1864, 180);
  const era = Math.floor(d / 60);
  const k = d % 60;
  return gender === 'M' ? mod9([1, 4, 7][era] - k) : mod9([5, 2, 8][era] + k);
}
/** 1900-2099 末兩位公式(規格 2.3.3 A 第 4 點)。 */
function digitNumber(Y, gender) {
  const yy = Y % 100;
  if (Y >= 1900 && Y <= 1999) return gender === 'M' ? mod9(100 - yy) : mod9(yy - 4);
  if (Y >= 2000 && Y <= 2099) return gender === 'M' ? mod9(99 - yy) : mod9(yy + 6);
  return null;
}
function oracleMing(Y, gender) {
  const raw = palmNumber(Y, gender);
  const used = raw === 5 ? (gender === 'M' ? 2 : 8) : raw;
  const gua = LUOSHU_GUA[used];
  return { effectiveYear: Y, rawNumber: raw, guaNumberUsed: used, gua, group: EAST.has(gua) ? 'east' : 'west' };
}

// ───────────────────────── 立春表(獨立來源) ─────────────────────────
const LC_TABLE = loadFixture('bazhai').meta.lichun_cst_1900_2100;
const CST = 8 * 3600e3;
function tableLichun(y) {
  const [d, t] = LC_TABLE[String(y)].split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, mi, s) - CST;
}
const cstDate = (ms) => new Date(ms + CST).toISOString().slice(0, 10);
const cstYear = (ms) => new Date(ms + CST).getUTCFullYear();
const tableLichunDate = (y) => cstDate(tableLichun(y));
/** 表與 calendar 不一致的容忍窗(秒): 已知最大差 68.9 秒。 */
const WINDOW_S = 100;
// 立春時刻靠近 CST 午夜的年份,日期型判定對表誤差敏感,略過(10 分鐘窗)
const nearMidnight = (y) => {
  const t = (tableLichun(y) + CST) % 86400000;
  return t < 600000 || t > 86400000 - 600000;
};

/** 依年界規則 oracle 出風水年;回傳 null 代表落在不可判定窗(略過)。 */
function oracleYear(ms, boundary, lunarStub) {
  const cy = cstYear(ms);
  if (boundary === 'gregorian_jan1') return cy;
  if (boundary === 'fixed_feb4') return cstDate(ms) >= `${String(cy).padStart(4, '0')}-02-04` ? cy : cy - 1;
  if (boundary === 'lunar_new_year') return cstDate(ms) >= lunarStub(cy) ? cy : cy - 1;
  if (cy < 1900 || cy > 2100) return null;
  const lc = tableLichun(cy);
  if (boundary === 'lichun_exact') {
    if (Math.abs(ms - lc) <= WINDOW_S * 1000) return null;
    return ms > lc ? cy : cy - 1;
  }
  // lichun_date_only
  if (nearMidnight(cy)) return null;
  return cstDate(ms) >= tableLichunDate(cy) ? cy : cy - 1;
}
/** 假農曆庫: 春節落在 1 月 10 日-2 月 27 日之間的確定性日期。 */
const lunarStub = (y) => `${String(y).padStart(4, '0')}-0${1 + (y % 2)}-${String(10 + (y % 18)).padStart(2, '0')}`;

// ───────────────────────── 時間字串 ─────────────────────────
const OFFSETS = [
  ['+08:00', 8 * 60],
  ['+09:00', 9 * 60],
  ['+07:00', 7 * 60],
  ['-05:00', -300],
  ['Z', 0],
  ['+05:30', 330],
  ['+0800', 480],
  ['-03:30', -210],
];
const p2 = (n) => String(n).padStart(2, '0');
function localOf(ms, offMin, withSeconds) {
  const d = new Date(ms + offMin * 60000);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  return `${y}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${withSeconds ? `:${p2(d.getUTCSeconds())}` : ''}`;
}

// ═══════════════════════════ 1. 資料表 ═══════════════════════════
describe('bazhai fuzz: 星表與屬性', () => {
  it('三個來源(規格內嵌表、獨立爻變重算、實作)逐格一致', () => {
    assert.deepEqual(ORACLE_TABLE, SPEC_STAR_TABLE, '獨立重算 != 規格內嵌表(oracle 自身有誤)');
    for (const g of GUA) {
      for (const d of DIRS) {
        assert.equal(bz.STAR_TABLE[g][d], SPEC_STAR_TABLE[g][d], `${g}命看${d}`);
        assert.equal(bz.starAtDir(g, d), SPEC_STAR_TABLE[g][d]);
        const tg = GUA[DIRS.indexOf(d)];
        assert.equal(bz.starOf(g, tg), SPEC_STAR_TABLE[g][d]);
        assert.equal(bz.STAR_BY_GUA[g][tg], SPEC_STAR_TABLE[g][d]);
      }
      assert.deepEqual(bz.starsOf(g), SPEC_STAR_TABLE[g]);
      assert.deepEqual(Object.keys(bz.starsOf(g)), DIRS, 'key 順序須為 北 東北 東 東南 南 西南 西 西北');
    }
  });

  it('§4.4 性質: 對稱 28 對、拉丁方、東四吉星落東四方位', () => {
    let pairs = 0;
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        assert.equal(bz.starOf(GUA[i], GUA[j]), bz.starOf(GUA[j], GUA[i]));
        pairs++;
      }
    }
    assert.equal(pairs, 28);
    const good = new Set(['生氣', '延年', '天醫', '伏位']);
    for (const g of GUA) {
      assert.equal(new Set(GUA.map((t) => bz.starOf(g, t))).size, 8, `${g} 列`);
      assert.equal(new Set(GUA.map((t) => bz.starOf(t, g))).size, 8, `${g} 欄`);
      const goodTargets = GUA.filter((t) => good.has(bz.starOf(g, t)));
      assert.equal(goodTargets.length, 4);
      for (const t of goodTargets) assert.equal(EAST.has(t), EAST.has(g), `${g}命吉星 ${t}`);
    }
  });

  it('starsOf 回傳拷貝;修改回傳值不影響下一次', () => {
    const a = bz.starsOf('坎');
    a['北'] = '亂';
    delete a['東'];
    assert.deepEqual(bz.starsOf('坎'), SPEC_STAR_TABLE['坎']);
  });

  it('八星屬性與規格 2.3.2 表一致', () => {
    const want = {
      生氣: ['貪狼', '木', '上吉', 1.0],
      延年: ['武曲', '金', '上吉', 0.75],
      天醫: ['巨門', '土', '中吉', 0.55],
      伏位: ['輔弼', '木', '小吉', 0.25],
      禍害: ['祿存', '土', '次凶', -0.3],
      六煞: ['文曲', '水', '次凶', -0.3],
      五鬼: ['廉貞', '火', '大凶', -0.5],
      絕命: ['破軍', '金', '大凶', -0.6],
    };
    for (const [s, [nine, el, lv, w]] of Object.entries(want)) {
      const a = bz.STAR_ATTRS[s];
      assert.deepEqual([a.nineStar, a.element, a.level, a.weight], [nine, el, lv, w], s);
    }
    assert.deepEqual(Object.keys(bz.STAR_ATTRS).sort(), Object.keys(want).sort());
  });

  it('groupOf / isMatch 64 格對 oracle;非法卦名丟 UNKNOWN_GUA / UNKNOWN_DIR', () => {
    for (const a of GUA) {
      assert.equal(bz.groupOf(a), EAST.has(a) ? 'east' : 'west');
      for (const b of GUA) assert.equal(bz.isMatch(a, b), EAST.has(a) === EAST.has(b));
    }
    for (const bad of ['', '中', undefined, null, 5, '坎 ', 'constructor', '__proto__', 'toString', ['坎'], {}]) {
      assert.throws(() => bz.groupOf(bad), (e) => e.message.startsWith('UNKNOWN_GUA:'), String(bad));
      assert.throws(() => bz.starsOf(bad), (e) => e.message.startsWith('UNKNOWN_GUA:'), String(bad));
      assert.throws(() => bz.starAtDir('坎', bad), (e) => e.message.startsWith('UNKNOWN_DIR:'), String(bad));
    }
  });
});

// ═══════════════════════════ 2. 命卦(年) ═══════════════════════════
describe('bazhai fuzz: 命卦(年)', () => {
  it('§4.4: 封閉式 == 排山掌訣 == 末兩位公式,1700-2399 全部(含 5 入中寄宮)', () => {
    for (let Y = 1700; Y <= 2399; Y++) {
      for (const g of ['M', 'F']) {
        const got = bz.mingGuaFromYear(Y, g);
        const want = oracleMing(Y, g);
        assert.deepEqual(got, want, `${Y}${g}`);
        const dg = digitNumber(Y, g);
        if (dg !== null) assert.equal(dg, want.rawNumber, `末兩位公式 ${Y}${g}`);
        assert.ok(got.rawNumber >= 1 && got.rawNumber <= 9);
        assert.notEqual(got.guaNumberUsed, 5);
      }
    }
  });

  it('隨機大範圍年份(含負數、超大整數)與 oracle 一致', () => {
    const r = mulberry32(101);
    for (let n = 0; n < 5000; n++) {
      const Y = ri(r, -100000, 100000) * (r() < 0.1 ? 1000 : 1);
      const g = r() < 0.5 ? 'M' : 'F';
      assert.deepEqual(bz.mingGuaFromYear(Y, g), oracleMing(Y, g), `${Y}${g}`);
    }
  });

  it('2000 年男離、女乾;2043 女巽;1990 女艮(規格點名的陷阱)', () => {
    assert.equal(bz.mingGuaFromYear(2000, 'M').gua, '離');
    assert.equal(bz.mingGuaFromYear(2000, 'F').gua, '乾');
    assert.equal(bz.mingGuaFromYear(2043, 'F').gua, '巽');
    const f1990 = bz.mingGuaFromYear(1990, 'F');
    assert.equal(f1990.rawNumber, 5);
    assert.equal(f1990.gua, '艮');
  });

  it('非法輸入只丟帶碼的 Error', () => {
    const junkYears = [NaN, Infinity, -Infinity, 1990.5, '1990', null, undefined, {}, [], true, 1n];
    for (const y of junkYears) {
      assert.throws(() => bz.mingGuaFromYear(y, 'M'), (e) => /^INVALID_YEAR: /.test(e.message), `year=${String(y)}`);
    }
    for (const g of ['m', 'f', 'male', 'female', '', null, undefined, 1, 'MM']) {
      assert.throws(() => bz.mingGuaFromYear(1990, g), (e) => /^INVALID_GENDER: /.test(e.message), String(g));
    }
  });
});

// ═══════════════════════════ 3. 宅卦 ═══════════════════════════
describe('bazhai fuzz: 宅卦', () => {
  // 以千分之一度整數做精確算術;邊界(7.5 的整數倍)剛好可精確表示
  const oracleZhaiK = (k) => {
    const facingIdx = Math.floor(imod(k + 7500, 360000) / 15000);
    const sitMt = (facingIdx + 12) % 24;
    const sitK = imod(k + 180000, 360000);
    const guaIdx = Math.floor(imod(sitK + 22500, 360000) / 45000);
    return { facingMt: MT_NAME[facingIdx], sitMt: MT_NAME[sitMt], gua: GUA[guaIdx], guaViaMt: MT_GUA[sitMt], sitK };
  };

  it('隨機實數(含負、>360、極端)+ 邊界±0.001° 對 oracle', () => {
    const r = mulberry32(202);
    for (let n = 0; n < 20000; n++) {
      const mode = r();
      let k;
      if (mode < 0.3) k = ri(r, 0, 359999);
      else if (mode < 0.5) k = ri(r, -3600000, 3600000);
      else if (mode < 0.6) k = ri(r, -3.6e9, 3.6e9);
      else k = 7500 * ri(r, -100, 100) + ri(r, -2, 2) + 360000 * ri(r, -50, 50); // 7.5 的整數倍邊界 ±0.002°
      const f = k / 1000;
      const z = bz.zhaiFromFacing(f);
      const o = oracleZhaiK(k);
      assert.equal(z.facingMountain, o.facingMt, `facing=${f} 向山`);
      assert.equal(z.sitMountain, o.sitMt, `facing=${f} 坐山`);
      assert.equal(z.gua, o.gua, `facing=${f} 宅卦`);
      assert.equal(o.gua, o.guaViaMt, 'oracle 兩條路徑(45 度分區 vs 24 山歸卦)須一致');
      assert.equal(z.name, `${o.gua}宅`);
      assert.equal(z.group, EAST.has(o.gua) ? 'east' : 'west');
      assert.equal(z.sitDir, DIR_OF[o.gua]);
      assert.ok(z.facingBearing >= 0 && z.facingBearing < 360 && !Object.is(z.facingBearing, -0), `facing=${f} -> ${z.facingBearing}`);
      assert.ok(z.sitBearing >= 0 && z.sitBearing < 360);
      assert.ok(Math.abs(imod(z.sitBearing - o.sitK / 1000 + 180, 360) - 180) < 1e-6, `facing=${f} sit=${z.sitBearing}`);
      assert.deepEqual(clone(z), z, 'JSON 可序列化');
    }
  });

  it('§4.4: 8 扇區對 24 山歸卦在 0.1 度解析度 0 不符,且永不回 undefined', () => {
    for (let k = -3600; k <= 7200; k++) {
      const f = k / 10;
      const z = bz.zhaiFromFacing(f);
      assert.ok(typeof z.gua === 'string' && GUA.includes(z.gua), `facing=${f}`);
      const sitTenth = imod(k + 1800, 3600);
      const viaMountain = MT_GUA[Math.floor(imod(sitTenth + 75, 3600) / 150)];
      assert.equal(z.gua, viaMountain, `facing=${f}`);
    }
  });

  it('規格附錄 B.1 邊界案', () => {
    const cases = [
      [22.5, '坤', 202.5],
      [22.4999, '離', 202.4999],
      [157.5, '坎', 337.5],
      [157.4999, '乾', 337.4999],
      [337.5, '離', 157.5],
      [337.4999, '巽', 157.4999],
      [-300, '坤', 240],
      [180, '坎', 0],
      [0, '離', 180],
      [-0, '離', 180],
      [360, '離', 180],
      [720, '離', 180],
    ];
    for (const [f, gua, sit] of cases) {
      const z = bz.zhaiFromFacing(f);
      assert.equal(z.gua, gua, `facing ${f}`);
      assert.ok(Math.abs(z.sitBearing - sit) < 1e-9, `facing ${f} sit=${z.sitBearing}`);
    }
    assert.equal(bz.zhaiFromFacing(-0).facingBearing, 0);
    assert.ok(!Object.is(bz.zhaiFromFacing(-0).facingBearing, -0));
  });

  it('zhaiFromSitMountain 24 山對 oracle;非法山名丟 UNKNOWN_MOUNTAIN', () => {
    for (let i = 0; i < 24; i++) {
      const z = bz.zhaiFromSitMountain(MT_NAME[i]);
      assert.equal(z.gua, MT_GUA[i]);
      assert.equal(z.facingMountain, MT_NAME[(i + 12) % 24]);
      assert.equal(z.sitCenterDeg, 15 * i);
      assert.equal(z.facingCenterDeg, 15 * ((i + 12) % 24));
      assert.equal(z.sitDir, DIR_OF[MT_GUA[i]]);
      assert.equal(z.group, EAST.has(MT_GUA[i]) ? 'east' : 'west');
      const f = bz.zhaiFromFacing(z.facingCenterDeg);
      assert.equal(f.gua, z.gua);
      assert.equal(f.sitMountain, MT_NAME[i]);
    }
    for (const bad of ['', '坎', '中', undefined, null, 1, 'constructor', '__proto__', 'toString', 'hasOwnProperty', [], {}]) {
      assert.throws(() => bz.zhaiFromSitMountain(bad), (e) => /^UNKNOWN_MOUNTAIN: /.test(e.message), String(bad));
    }
  });

  it('非法方位角丟 INVALID_BEARING', () => {
    for (const bad of [NaN, Infinity, -Infinity, '180', null, undefined, {}, [], true, 1n]) {
      assert.throws(() => bz.zhaiFromFacing(bad), (e) => /^INVALID_BEARING: /.test(e.message), String(bad));
    }
  });
});

// ═══════════════════════════ 4. 財位序與權重 ═══════════════════════════
describe('bazhai fuzz: 財位序', () => {
  it('預設: 生氣>延年>天醫,伏位備位;tianyiFirst 對調', () => {
    for (const g of GUA) {
      const row = SPEC_STAR_TABLE[g];
      const dirOf = (s) => DIRS.find((d) => row[d] === s);
      assert.deepEqual(bz.wealthOrder(g), [
        { star: '生氣', dir: dirOf('生氣') },
        { star: '延年', dir: dirOf('延年') },
        { star: '天醫', dir: dirOf('天醫') },
        { star: '伏位', dir: dirOf('伏位'), backup: true },
      ]);
      assert.equal(dirOf('伏位'), DIR_OF[g], '伏位一定在本卦自己的方位');
      assert.deepEqual(bz.wealthOrder(g, { tianyiFirst: true }).map((x) => x.star), ['生氣', '天醫', '延年', '伏位']);
    }
  });

  it('隨機權重: 排序 == 由大到小、同分依 生氣 延年 天醫 順序', () => {
    const r = mulberry32(303);
    for (let n = 0; n < 3000; n++) {
      const g = pick(r, GUA);
      const custom = {};
      for (const s of ['生氣', '延年', '天醫', '伏位', '禍害', '六煞', '五鬼', '絕命']) {
        if (r() < 0.5) custom[s] = pick(r, [-1, 0, 0.25, 0.5, 0.75, 1, r() * 2 - 1]);
      }
      const base = { 生氣: 1, 延年: 0.75, 天醫: 0.55, 伏位: 0.25, 禍害: -0.3, 六煞: -0.3, 五鬼: -0.5, 絕命: -0.6 };
      const w = { ...base, ...custom };
      const expectStars = ['生氣', '延年', '天醫'].map((s, i) => ({ s, i })).sort((a, b) => w[b.s] - w[a.s] || a.i - b.i).map((x) => x.s);
      const got = bz.wealthOrder(g, { bazhaiStarWeights: custom });
      assert.deepEqual(got.slice(0, 3).map((x) => x.star), expectStars, JSON.stringify(custom));
      assert.equal(got[3].star, '伏位');
      assert.equal(got[3].backup, true);
      assert.ok(got.slice(0, 3).every((x) => x.backup === undefined));
      assert.deepEqual(bz.starWeights({ bazhaiStarWeights: custom }), w);
    }
  });

  it('非法設定丟 INVALID_SETTING', () => {
    const bads = [
      { bazhaiStarWeights: 'weird' },
      { bazhaiStarWeights: { 生氣: NaN } },
      { bazhaiStarWeights: { 生氣: Infinity } },
      { bazhaiStarWeights: { 生氣: '1' } },
      { bazhaiStarWeights: { 神獸: 1 } },
      { bazhaiStarWeights: null },
      { bazhaiStarWeights: [] },
      { tianyiFirst: 'yes' },
      { stovePreferAuspicious: 1 },
      { yearBoundary: 'nope' },
      { coupleBasis: 'nope' },
      { bazhaiFacingBasis: 'nope' },
      { measureUncertainty: -1 },
      { measureUncertainty: NaN },
      { notASetting: 1 },
    ];
    for (const s of bads) {
      assert.throws(() => bz.wealthOrder('坎', s), (e) => /^INVALID_SETTING: /.test(e.message), JSON.stringify(s));
    }
  });
});

// ═══════════════════════════ 5. 用途矩陣 ═══════════════════════════
// 規格 2.3.4 表逐格轉成評級(best 最佳 / good 宜 / ok 尚可 / avoid 忌與避免與不宜 / worst 大忌)
const ALL_STARS = ['生氣', '延年', '天醫', '伏位', '禍害', '六煞', '五鬼', '絕命'];
const SPEC_USAGE = {
  door: ['best', 'good', 'good', 'ok', 'avoid', 'avoid', 'avoid', 'worst'],
  masterBedroom: ['good', 'good', 'good', 'good', 'avoid', 'avoid', 'avoid', 'worst'],
  stoveSeat: ['avoid', 'avoid', 'avoid', 'avoid', 'good', 'good', 'good', 'good'],
  toilet: ['avoid', 'avoid', 'avoid', 'avoid', 'good', 'good', 'good', 'good'],
  living: ['good', 'good', 'good', 'good', 'avoid', 'avoid', 'avoid', 'avoid'],
  bedHead: ['good', 'good', 'good', 'good', 'avoid', 'avoid', 'avoid', 'avoid'],
  desk: ['best', 'good', 'good', 'ok', 'avoid', 'avoid', 'avoid', 'avoid'],
  stoveMouth: ['good', 'good', 'good', 'good', 'avoid', 'avoid', 'avoid', 'worst'],
};
const RANK = { best: 0, good: 1, ok: 2, avoid: 3, worst: 4 };
function oracleUsage(gua, s = {}) {
  const spec = clone(SPEC_USAGE);
  if (s.stovePreferAuspicious) spec.stoveSeat = ['good', 'good', 'good', 'avoid', 'avoid', 'avoid', 'avoid', 'avoid'];
  if (s.livingRoomGradeByEastWest) {
    const first = EAST.has(gua) ? ['生氣', '伏位'] : ['延年', '天醫'];
    spec.living = ALL_STARS.map((st) => (first.includes(st) ? 'best' : ['生氣', '延年', '天醫', '伏位'].includes(st) ? 'good' : 'avoid'));
  }
  const build = (use) =>
    DIRS.map((dir, i) => {
      const star = SPEC_STAR_TABLE[gua][dir];
      return { dir, star, rating: spec[use][ALL_STARS.indexOf(star)], i };
    })
      .sort((a, b) => RANK[a.rating] - RANK[b.rating] || a.i - b.i)
      .map(({ dir, star, rating }) => ({ dir, star, rating }));
  return {
    position: Object.fromEntries(['door', 'masterBedroom', 'stoveSeat', 'toilet', 'living'].map((u) => [u, build(u)])),
    facing: Object.fromEntries(['bedHead', 'desk', 'stoveMouth'].map((u) => [u, build(u)])),
  };
}
function stripUsage(u) {
  const st = (arr) => arr.map(({ dir, star, rating }) => ({ dir, star, rating }));
  return {
    position: Object.fromEntries(Object.entries(u.position).map(([k, v]) => [k, st(v)])),
    facing: Object.fromEntries(Object.entries(u.facing).map(([k, v]) => [k, st(v)])),
  };
}

describe('bazhai fuzz: 用途矩陣', () => {
  it('8 卦 x 4 種設定組合對規格矩陣', () => {
    for (const g of GUA) {
      for (const stove of [false, true]) {
        for (const living of [false, true]) {
          const s = { stovePreferAuspicious: stove, livingRoomGradeByEastWest: living };
          assert.deepEqual(stripUsage(bz.usageGuide(g, s)), oracleUsage(g, s), `${g} ${JSON.stringify(s)}`);
        }
      }
    }
  });

  it('位置與朝向分開、8 方位各出現一次、可 JSON 序列化、回傳全新物件', () => {
    for (const g of GUA) {
      const u = bz.usageGuide(g);
      assert.deepEqual(Object.keys(u.position), ['door', 'masterBedroom', 'stoveSeat', 'toilet', 'living']);
      assert.deepEqual(Object.keys(u.facing), ['bedHead', 'desk', 'stoveMouth']);
      for (const arr of [...Object.values(u.position), ...Object.values(u.facing)]) {
        assert.deepEqual(arr.map((x) => x.dir).sort(), [...DIRS].sort());
      }
      const snap = JSON.stringify(u);
      tryMutate(u);
      assert.equal(JSON.stringify(bz.usageGuide(g)), snap, '修改回傳值後再呼叫應不變');
      assert.deepEqual(clone(bz.usageGuide(g)), bz.usageGuide(g));
    }
  });

  it('「灶座放生氣位」不會被評為適合(規格 2.3.3 E 明文)', () => {
    for (const g of GUA) {
      const shengqi = bz.usageGuide(g).position.stoveSeat.find((x) => x.star === '生氣');
      assert.notEqual(shengqi.rating, 'good');
      assert.notEqual(shengqi.rating, 'best');
    }
  });

  it('範例 usage_position_vs_facing_lookup(坎命)與其他 lookupUsage', () => {
    const r = bz.lookupUsage('坎', { roomPosition: '東南', bedHead: '東', stoveSeat: '西南', stoveMouth: '東南', deskFacing: '東南' });
    assert.deepEqual(r, { roomPositionStar: '生氣', bedHeadStar: '天醫', stoveSeatStar: '絕命', stoveMouthStar: '生氣', deskFacingStar: '生氣' });
    assert.deepEqual(bz.lookupUsage('坎', {}), {});
    assert.throws(() => bz.lookupUsage('坎', { roomPosition: '中' }), (e) => /^UNKNOWN_DIR: /.test(e.message));
    assert.throws(() => bz.lookupUsage('坎', { door: '北' }), (e) => /^INVALID_OPTION: /.test(e.message));
    assert.throws(() => bz.lookupUsage('坎', null), (e) => /^INVALID_OPTION: /.test(e.message));
    assert.throws(() => bz.lookupUsage('坎', [1]), (e) => /^INVALID_OPTION: /.test(e.message));
  });

  it('threeKeys 隨機: 計分 == 生氣/延年/天醫 計數;非法輸入丟碼', () => {
    const r = mulberry32(404);
    const good = new Set(['生氣', '延年', '天醫']);
    for (let n = 0; n < 2000; n++) {
      const g = pick(r, GUA);
      const p = { door: pick(r, DIRS), master: pick(r, DIRS), stove: pick(r, DIRS) };
      const t = bz.threeKeys(g, p);
      let c = 0;
      for (const k of ['door', 'master', 'stove']) {
        const st = SPEC_STAR_TABLE[g][p[k]];
        assert.equal(t.stars[k], st);
        assert.equal(t.counted[k], good.has(st));
        if (good.has(st)) c++;
      }
      assert.equal(t.count, c);
      assert.equal(t.verdict, ['none', 'one', 'two', 'all'][c]);
      assert.equal(typeof t.label, 'string');
    }
    assert.throws(() => bz.threeKeys('坎', { door: '北', master: '北' }), (e) => /^INVALID_OPTION: /.test(e.message));
    assert.throws(() => bz.threeKeys('坎', { door: '北', master: '北', stove: '中' }), (e) => /^UNKNOWN_DIR: /.test(e.message));
    assert.throws(() => bz.threeKeys('坎', { door: '北', master: '北', stove: '北', extra: 1 }), (e) => /^INVALID_OPTION: /.test(e.message));
  });
});

// ═══════════════════════════ 6. 命卦(出生時刻)差分 ═══════════════════════════
describe('bazhai fuzz: 命卦(出生時刻,年界,旗標)', () => {
  function genBirthMs(r) {
    const y = ri(r, 1900, 2099);
    const mode = r();
    if (mode < 0.45) return Date.UTC(y, ri(r, 0, 11), ri(r, 1, 28), ri(r, 0, 23), ri(r, 0, 59), ri(r, 0, 59)) - ri(r, -14, 14) * 3600e3;
    if (mode < 0.85) return tableLichun(y) + ri(r, -3 * 86400, 3 * 86400) * 1000; // 立春前後 3 天
    return tableLichun(y) + ri(r, -600, 600) * 1000; // 立春前後 10 分鐘
  }

  it('20000 隨機出生時刻 x 5 種年界 x 8 種時區 == oracle', () => {
    const r = mulberry32(505);
    let compared = 0;
    let skipped = 0;
    for (let n = 0; n < 20000; n++) {
      const ms = Math.floor(genBirthMs(r) / 1000) * 1000;
      const [offStr, offMin] = pick(r, OFFSETS);
      const gender = r() < 0.5 ? 'M' : 'F';
      const boundary = pick(r, ['lichun_exact', 'lichun_exact', 'lichun_date_only', 'fixed_feb4', 'lunar_new_year', 'gregorian_jan1']);
      const withSec = r() < 0.5;
      const local = localOf(ms, offMin, withSec);
      const effMs = withSec ? ms : Math.floor(ms / 60000) * 60000; // 無秒字串截掉秒
      const want = oracleYear(effMs, boundary, lunarStub);
      const opts = boundary === 'lunar_new_year' ? { lunarNewYearOf: lunarStub } : {};
      const got = bz.mingGuaFromBirth({ local, utcOffset: offStr }, gender, { yearBoundary: boundary }, opts);
      if (want === null) {
        skipped++;
        assert.ok(Math.abs(got.effectiveYear - cstYear(effMs)) <= 1);
        continue;
      }
      compared++;
      assert.equal(got.effectiveYear, want, `${local} ${offStr} ${boundary} ${gender}`);
      assert.deepEqual({ ...got, flags: 0, approx: 0 }, { ...oracleMing(want, gender), flags: 0, approx: 0 }, `${local} ${offStr} ${boundary}`);
      assert.equal(got.approx, false);
      assert.deepEqual(clone(got), got);
    }
    assert.ok(compared > 15000, `compared=${compared} skipped=${skipped}`);
  });

  it('nearLichun 旗標: 表判定 ±40 秒必真、>200 秒必假;alternatives 前後兩年', () => {
    const r = mulberry32(606);
    for (let n = 0; n < 6000; n++) {
      const y = ri(r, 1900, 2100);
      const gender = r() < 0.5 ? 'M' : 'F';
      const d = pick(r, [-3600, -400, -250, -201, 201, 250, 400, 3600, 0, 10, -10, 39, -39, 40, -40, r() * 40 - 20, r() * 6000 - 3000]);
      const ms = Math.floor(tableLichun(y) / 1000) * 1000 + Math.round(d) * 1000;
      const dt = Math.abs(ms - tableLichun(y)) / 1000;
      if (dt > 40 && dt < 200) continue;
      const g = bz.mingGuaFromBirth({ local: localOf(ms, 480, true), utcOffset: '+08:00' }, gender);
      assert.equal(g.flags.nearLichun, dt <= 40, `${y} d=${d}`);
      assert.equal(g.flags.dateIsLichunDay, false, 'timeKnown=true 時不會是 dateIsLichunDay');
      if (g.flags.nearLichun) {
        const [b, a] = g.flags.alternatives;
        assert.equal(b.side, 'beforeLichun');
        assert.equal(a.side, 'afterLichun');
        assert.deepEqual({ ...b, side: 0, ganzhi: 0 }, { ...oracleMing(y - 1, gender), side: 0, ganzhi: 0 });
        assert.deepEqual({ ...a, side: 0, ganzhi: 0 }, { ...oracleMing(y, gender), side: 0, ganzhi: 0 });
        assert.equal(b.ganzhi, ganzhi(y - 1));
        assert.equal(a.ganzhi, ganzhi(y));
        assert.ok(g.effectiveYear === y - 1 || g.effectiveYear === y);
      } else {
        assert.deepEqual(g.flags.alternatives, []);
      }
    }
  });

  it('以 calendar 為準的精確性: lichun(y) 前後各 1 秒必換年(1900-2100 每年)、±120 秒旗標邊界、時區等價', () => {
    for (let y = 1900; y <= 2100; y++) {
      const lc = cal.lichun(y);
      const sec = Math.floor(lc / 1000) * 1000;
      for (const gender of ['M', 'F']) {
        const ge = (ms) => bz.mingGuaFromBirth({ local: localOf(ms, 480, true), utcOffset: '+08:00' }, gender);
        const bf = ge(sec === lc ? sec - 1000 : sec); // 嚴格早於立春的最近整秒
        const af = ge(sec + 1000); // 嚴格晚於立春
        assert.equal(bf.effectiveYear, y - 1, `${y} 立春前 1 秒`);
        assert.equal(af.effectiveYear, y, `${y} 立春後`);
        assert.deepEqual({ ...bf, flags: 0 }, { ...oracleMing(y - 1, gender), flags: 0, approx: false });
        for (const dSec of [119, 120, 121]) {
          for (const t of [sec + dSec * 1000, sec - dSec * 1000]) {
            const diff = Math.abs(t - lc) / 1000;
            assert.equal(ge(t).flags.nearLichun, diff <= 120, `${y} diff=${diff}`);
          }
        }
        const g1 = bz.mingGuaFromBirth({ local: localOf(sec + 1000, 480, true), utcOffset: '+08:00' }, gender);
        for (const [off, min] of [['+09:00', 540], ['-05:00', -300], ['Z', 0], ['+05:30', 330]]) {
          assert.deepEqual(bz.mingGuaFromBirth({ local: localOf(sec + 1000, min, true), utcOffset: off }, gender), g1, off);
        }
      }
    }
  });

  it('不知時刻: 立春日 dateIsLichunDay + 兩個 alternatives;非立春日無旗標;時分被忽略', () => {
    const r = mulberry32(707);
    for (let n = 0; n < 3000; n++) {
      const y = ri(r, 1900, 2099);
      if (nearMidnight(y)) continue;
      const off = pick(r, ['+08:00', '+09:00']);
      const gender = r() < 0.5 ? 'M' : 'F';
      const dayShift = pick(r, [-2, -1, 0, 0, 0, 1, 2]);
      const ymd = cstDate(tableLichun(y) + dayShift * 86400000);
      const wantFlag = dayShift === 0;
      const got1 = bz.mingGuaFromBirth({ local: `${ymd}T${p2(ri(r, 0, 23))}:${p2(ri(r, 0, 59))}`, utcOffset: off, timeKnown: false }, gender);
      const got2 = bz.mingGuaFromBirth({ local: ymd, utcOffset: off, timeKnown: false }, gender);
      assert.deepEqual(got1, got2, '時分應被忽略');
      assert.equal(got1.flags.dateIsLichunDay, wantFlag, `${ymd}`);
      assert.equal(got1.flags.nearLichun, false);
      if (wantFlag) {
        assert.deepEqual(got1.flags.alternatives.map((a) => [a.side, a.effectiveYear, a.gua, a.ganzhi]), [
          ['beforeLichun', y - 1, oracleMing(y - 1, gender).gua, ganzhi(y - 1)],
          ['afterLichun', y, oracleMing(y, gender).gua, ganzhi(y)],
        ]);
      } else {
        assert.deepEqual(got1.flags.alternatives, []);
        assert.equal(got1.effectiveYear, dayShift < 0 ? y - 1 : y);
      }
    }
  });

  it('規格附錄 B.1 的 1940 +09:00 案與 2000-02-04 不知時刻案', () => {
    const b = (local, offset, gender, extra = {}) => bz.mingGuaFromBirth({ local, utcOffset: offset, ...extra }, gender);
    assert.equal(b('1940-02-05T08:00', '+09:00', 'M').gua, '兌');
    assert.equal(b('1940-02-05T08:00', '+09:00', 'F').gua, '艮');
    assert.equal(b('1940-02-05T08:30', '+09:00', 'M').gua, '乾');
    assert.equal(b('1940-02-05T08:30', '+09:00', 'F').gua, '離');
    assert.equal(b('1940-02-05T08:00', '+08:00', 'M').effectiveYear, 1940, '若誤當 +08:00 會得 1940');
    const t = b('2000-02-04', '+08:00', 'M', { timeKnown: false });
    assert.equal(t.flags.dateIsLichunDay, true);
    assert.deepEqual(t.flags.alternatives.map((x) => x.gua), ['坎', '離']);
    assert.deepEqual(b('2000-02-04', '+08:00', 'F', { timeKnown: false }).flags.alternatives.map((x) => x.gua), ['艮', '乾']);
    assert.equal(b('2000-02-04T20:39', '+08:00', 'M').effectiveYear, 1999);
    assert.equal(b('2000-02-04T20:41', '+08:00', 'M').effectiveYear, 2000);
    assert.equal(b('2000-01-15T10:00', '+08:00', 'M').effectiveYear, 1999, '1 月出生屬上一風水年');
  });

  it('閏日與非法日期', () => {
    const ok = (l) => bz.mingGuaFromBirth({ local: l, utcOffset: '+08:00' }, 'M');
    ok('2000-02-29T12:00');
    ok('2096-02-29T12:00');
    ok('1904-02-29');
    for (const bad of ['1900-02-29T12:00', '2100-02-29T12:00', '2001-02-29', '2000-02-30', '2000-13-01', '2000-00-10', '2000-04-31', '2000-01-01T24:00', '2000-01-01T23:60', '2000-01-01T23:59:60', '', 'abc', '20000101', '2000-1-1']) {
      assert.throws(() => ok(bad), (e) => /^INVALID_LOCAL_TIME: /.test(e.message), bad);
    }
  });

  it('utcOffset 缺或非法丟碼', () => {
    const go = (off) => bz.mingGuaFromBirth({ local: '1990-05-15T10:30', utcOffset: off }, 'M');
    for (const off of [undefined, null, '']) assert.throws(() => go(off), (e) => /^MISSING_UTC_OFFSET: /.test(e.message), String(off));
    for (const off of ['+8', '8:00', '+15:00', '+08:60', 'UTC', 8, '+08:00 ', '++08:00']) {
      assert.throws(() => go(off), (e) => /^INVALID_UTC_OFFSET: /.test(e.message), String(off));
    }
  });

  it('birth 結構錯誤與 timeKnown 非布林丟 INVALID_BIRTH;性別優先', () => {
    for (const b of [null, undefined, 5, 'x', [], {}, { local: 5, utcOffset: '+08:00' }, { utcOffset: '+08:00' }]) {
      assert.throws(() => bz.mingGuaFromBirth(b, 'M'), (e) => /^INVALID_BIRTH: /.test(e.message), JSON.stringify(b));
    }
    for (const tk of [0, 1, 'yes', null, {}]) {
      assert.throws(() => bz.mingGuaFromBirth({ local: '1990-05-15', utcOffset: '+08:00', timeKnown: tk }, 'M'), (e) => /^INVALID_BIRTH: /.test(e.message), String(tk));
    }
    assert.throws(() => bz.mingGuaFromBirth({ local: '1990-05-15', utcOffset: '+08:00' }, 'X'), (e) => /^INVALID_GENDER: /.test(e.message));
  });

  it('timeKnown=false 時,local 日期之後有雜訊也必須被拒絕(與 timeKnown=true 一致);前後空白照 calendar 接受', () => {
    for (const bad of ['1990-05-15garbage', '1990-05-15T', '1990-05-15Tab:cd', '1990-05-15 xx', '1990-05-15T10:30zzz']) {
      assert.throws(
        () => bz.mingGuaFromBirth({ local: bad, utcOffset: '+08:00', timeKnown: false }, 'M'),
        (e) => /^INVALID_LOCAL_TIME: /.test(e.message),
        bad,
      );
    }
    const a = bz.mingGuaFromBirth({ local: ' 1990-05-15T10:30 ', utcOffset: '+08:00', timeKnown: true }, 'M');
    const b = bz.mingGuaFromBirth({ local: ' 1990-05-15T10:30 ', utcOffset: '+08:00', timeKnown: false }, 'M');
    assert.equal(a.effectiveYear, b.effectiveYear);
  });

  it('lunar_new_year: 缺農曆庫、庫回傳格式錯、opts 未知鍵、春節前後一天', () => {
    const b = { local: '1990-05-15T10:30', utcOffset: '+08:00' };
    assert.throws(() => bz.mingGuaFromBirth(b, 'M', { yearBoundary: 'lunar_new_year' }), (e) => /^LUNAR_LIBRARY_REQUIRED: /.test(e.message));
    for (const bad of [undefined, null, '1990/01/27', '1990-1-27', 19900127, '']) {
      assert.throws(
        () => bz.mingGuaFromBirth(b, 'M', { yearBoundary: 'lunar_new_year' }, { lunarNewYearOf: () => bad }),
        (e) => /^INVALID_LUNAR_NEW_YEAR: /.test(e.message),
        String(bad),
      );
    }
    assert.throws(() => bz.mingGuaFromBirth(b, 'M', {}, { foo: 1 }), (e) => /^INVALID_OPTION: /.test(e.message));
    assert.throws(() => bz.mingGuaFromBirth(b, 'M', {}, { lunarNewYearOf: 'x' }), (e) => /^INVALID_OPTION: /.test(e.message));
    const st = () => '1990-01-27';
    const y = (local) => bz.mingGuaFromBirth({ local, utcOffset: '+08:00' }, 'M', { yearBoundary: 'lunar_new_year' }, { lunarNewYearOf: st }).effectiveYear;
    assert.equal(y('1990-01-26T23:59'), 1989);
    assert.equal(y('1990-01-27T00:00'), 1990);
  });

  it('超出範圍: 1864 以前/2150 以後 approx=true;<100 年丟 YEAR_OUT_OF_RANGE', () => {
    for (const l of ['1700-06-15T12:00', '1863-06-15T12:00', '2151-06-15T12:00', '2400-01-01T00:00', '0100-06-01T00:00']) {
      const g = bz.mingGuaFromBirth({ local: l, utcOffset: '+08:00' }, 'F');
      assert.equal(g.approx, true, l);
      assert.deepEqual({ ...g, flags: 0, approx: 0 }, { ...oracleMing(g.effectiveYear, 'F'), flags: 0, approx: 0 }, l);
    }
    assert.throws(() => bz.mingGuaFromBirth({ local: '0050-06-01T12:00', utcOffset: '+08:00' }, 'F'), (e) => /^YEAR_OUT_OF_RANGE: /.test(e.message));
    assert.equal(bz.mingGuaFromBirth({ local: '1900-06-15T12:00', utcOffset: '+08:00' }, 'F').approx, false);
    assert.equal(bz.mingGuaFromBirth({ local: '2100-06-15T12:00', utcOffset: '+08:00' }, 'F').approx, false);
  });
});

// ═══════════════════════════ 7. analyzeBazhai ═══════════════════════════
const ROLE_POOL = [undefined, null, 'breadwinner', 'holder', 'wife', 'husband', 'child'];
function genInput(r, opts = {}) {
  const n = opts.people ?? ri(r, 0, 5);
  const household = [];
  for (let i = 0; i < n; i++) {
    const y = ri(r, 1900, 2099);
    const ms = Math.floor((tableLichun(y) + ri(r, -400, 400) * (r() < 0.3 ? 432 : 86400) * 1000) / 1000) * 1000;
    const [offStr, offMin] = r() < 0.7 ? OFFSETS[0] : pick(r, OFFSETS);
    const timeKnown = r() < 0.85;
    const p = { id: `m${i}`, gender: r() < 0.5 ? 'M' : 'F', birth: { local: localOf(ms, offMin, false), utcOffset: offStr } };
    if (!timeKnown) {
      p.birth.timeKnown = false;
      if (!['+08:00', '+09:00'].includes(offStr)) p.birth = { local: localOf(ms, 480, false), utcOffset: '+08:00', timeKnown: false };
    } else if (r() < 0.3) p.birth.timeKnown = true;
    const role = pick(r, ROLE_POOL);
    if (role !== undefined) p.role = role;
    if (r() < 0.3) p.name = `人${i}`;
    household.push(p);
  }
  const settings = {};
  if (r() < 0.5) settings.coupleBasis = pick(r, ['breadwinner', 'wife', 'husband', 'holderOnly', 'averaged']);
  if (r() < 0.3) settings.tianyiFirst = true;
  if (r() < 0.2) settings.stovePreferAuspicious = true;
  if (r() < 0.2) settings.livingRoomGradeByEastWest = true;
  if (r() < 0.2) settings.showMinorityTechniques = true;
  if (r() < 0.2) settings.showGuimenxian = true;
  if (r() < 0.3) settings.measureUncertainty = pick(r, [0, 1, 3, 5, 10, 30]);
  if (r() < 0.2 && !settings.tianyiFirst) settings.bazhaiStarWeights = { 天醫: pick(r, [0.9, 0.1]), 絕命: pick(r, [-1, 0]) };
  if (r() < 0.2) settings.bazhaiFacingBasis = 'house';
  if (r() < 0.2) settings.yearBoundary = pick(r, ['lichun_date_only', 'fixed_feb4', 'gregorian_jan1', 'lichun_exact']);
  const fk = pick(r, [ri(r, -3600000, 3600000), ri(r, 0, 359999), 7500 * ri(r, -80, 80) + ri(r, -2, 2)]);
  const input = { household, facing: { bazhai: fk / 1000, xuankong: ri(r, 0, 359999) / 1000 } };
  if (Object.keys(settings).length || r() < 0.5) input.settings = settings;
  if (r() < 0.4) input.placements = { door: pick(r, DIRS), master: pick(r, DIRS), stove: pick(r, DIRS) };
  return input;
}

function effWeights(s) {
  const w = { 生氣: 1, 延年: 0.75, 天醫: 0.55, 伏位: 0.25, 禍害: -0.3, 六煞: -0.3, 五鬼: -0.5, 絕命: -0.6 };
  if (s.tianyiFirst) [w['延年'], w['天醫']] = [w['天醫'], w['延年']];
  if (s.bazhaiStarWeights && s.bazhaiStarWeights !== 'default') Object.assign(w, s.bazhaiStarWeights);
  return w;
}

/**
 * 房屋與家人的 oracle。八卦分界警示依規格 2.1.3 第 9 點的字面公式:
 * 「最近的山界屬卦界(boundaryKind='gua') 且 到山界的度數 < max(uncertainty, 3)」,用千分度整數精確算。
 */
function oracleAnalyze(input) {
  const s = { coupleBasis: 'breadwinner', bazhaiFacingBasis: 'door', measureUncertainty: 5, yearBoundary: 'lichun_exact', ...(input.settings ?? {}) };
  const facing = input.facing[s.bazhaiFacingBasis === 'house' ? 'xuankong' : 'bazhai'];
  const k = Math.round(facing * 1000);
  const sitK = imod(k + 180000, 360000);
  const idx = Math.floor(imod(sitK + 7500, 360000) / 15000);
  const devK = imod(sitK + 7500, 15000) - 7500;
  const j = devK > 0 ? (idx + 1) % 24 : (idx + 23) % 24;
  const kind = MT_GUA[idx] !== MT_GUA[j] ? 'gua' : 'shan';
  const dist = (7500 - Math.abs(devK)) / 1000;
  const near = kind === 'gua' && dist < Math.max(s.measureUncertainty, 3) - 1e-9;
  const people = input.household.map((p) => {
    const local = p.birth.timeKnown === false ? p.birth.local.slice(0, 10) : p.birth.local;
    const offMin = OFFSETS.find((o) => o[0] === p.birth.utcOffset)[1];
    const hasTime = local.length > 10;
    const ms = Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)), hasTime ? Number(local.slice(11, 13)) : 12, hasTime ? Number(local.slice(14, 16)) : 0) - offMin * 60000;
    return { year: oracleYear(ms, s.yearBoundary, lunarStub) };
  });
  return { s, houseGua: MT_GUA[idx], kind, dist, near, otherGua: near ? MT_GUA[j] : null, people };
}

describe('bazhai fuzz: analyzeBazhai 整合', () => {
  it('規格 2.3.1 範例(1990-05-15 女、坐子向午)逐欄對照', () => {
    const out = bz.analyzeBazhai({
      household: [{ id: 'p1', name: '本人', gender: 'F', birth: { local: '1990-05-15T10:30', utcOffset: '+08:00', timeKnown: true }, role: 'breadwinner' }],
      facing: { bazhai: 180 },
      settings: { yearBoundary: 'lichun_exact', coupleBasis: 'breadwinner' },
    });
    assert.equal(out.meta.schema, 'fengshui.bazhai/1');
    const p = out.people[0];
    assert.deepEqual({ ...p.ming, approx: 0 }, {
      effectiveYear: 1990,
      rawNumber: 5,
      guaNumberUsed: 8,
      gua: '艮',
      group: 'west',
      flags: { nearLichun: false, dateIsLichunDay: false, alternatives: [] },
      approx: 0,
    });
    assert.deepEqual(p.stars, { 北: '五鬼', 東北: '伏位', 東: '六煞', 東南: '絕命', 南: '禍害', 西南: '生氣', 西: '延年', 西北: '天醫' });
    assert.deepEqual(p.wealthOrder, [
      { star: '生氣', dir: '西南' },
      { star: '延年', dir: '西' },
      { star: '天醫', dir: '西北' },
      { star: '伏位', dir: '東北', backup: true },
    ]);
    const h = out.house;
    assert.equal(h.facingBearing, 180);
    assert.equal(h.sitBearing, 0);
    assert.equal(h.facingMountain, '午');
    assert.equal(h.sitMountain, '子');
    assert.equal(h.gua, '坎');
    assert.equal(h.group, 'east');
    assert.deepEqual(h.stars, { 北: '伏位', 東北: '五鬼', 東: '天醫', 東南: '生氣', 南: '延年', 西南: '絕命', 西: '禍害', 西北: '六煞' });
    assert.deepEqual(out.match.byPerson, { p1: false });
    assert.equal(out.match.policy, 'mingOverHouse');
    assert.equal(out.match.advice, '以個人命卦重排床頭、書桌、灶口的吉方;大門若無法改,至少讓門、主臥、灶口三項中有一項落在吉方');
    assert.deepEqual(out.findings, []);
  });

  it('3000 隨機輸入: 各欄位對獨立 oracle;JSON 可序列化;決定性;不改輸入;輸出不與內部狀態共用', () => {
    const r = mulberry32(808);
    for (let n = 0; n < 3000; n++) {
      const input = genInput(r);
      const snapshot = JSON.stringify(input);
      const frozen = deepFreeze(clone(input));
      const out = bz.analyzeBazhai(frozen, {});
      assert.equal(JSON.stringify(frozen), snapshot, '輸入被修改');
      assert.deepEqual(bz.analyzeBazhai(clone(input), {}), out, '決定性');
      assert.deepEqual(clone(out), out, 'JSON 可序列化且沒有 undefined/NaN/-0 造成的差異');
      const o = oracleAnalyze(input);
      const ctx = `#${n} facing=${JSON.stringify(input.facing)} unc=${o.s.measureUncertainty}`;
      // 房屋
      const h = out.house;
      assert.equal(h.gua, o.houseGua, `${ctx} 宅卦`);
      assert.deepEqual(h.stars, SPEC_STAR_TABLE[o.houseGua]);
      assert.equal(h.group, EAST.has(o.houseGua) ? 'east' : 'west');
      assert.equal(h.boundary.nearGuaBoundary, o.near, `${ctx} dist=${o.dist} kind=${o.kind}`);
      assert.equal(h.boundary.otherGua, o.otherGua, ctx);
      assert.equal(h.boundary.kind, o.kind, ctx);
      assert.ok(Math.abs(h.boundary.distDeg - o.dist) < 1e-6, `${ctx} distDeg=${h.boundary.distDeg} oracle=${o.dist}`);
      assert.equal(out.findings.some((f) => f.id === 'bz.house.near_gua_boundary'), o.near, ctx);
      assert.equal(out.meta.warnings.includes('nearGuaBoundary'), o.near, ctx);
      assert.deepEqual(stripUsage(h.usage), oracleUsage(o.houseGua, o.s));
      // 家人
      assert.equal(out.people.length, input.household.length);
      out.people.forEach((p, i) => {
        const src = input.household[i];
        assert.equal(p.id, src.id);
        if (o.people[i].year !== null) {
          assert.deepEqual({ ...p.ming, flags: 0, approx: 0 }, { ...oracleMing(o.people[i].year, src.gender), flags: 0, approx: 0 }, `${ctx} ${JSON.stringify(src.birth)} ${o.s.yearBoundary}`);
        }
        assert.deepEqual(p.stars, SPEC_STAR_TABLE[p.ming.gua]);
        assert.deepEqual(stripUsage(p.usage), oracleUsage(p.ming.gua, o.s));
        const w = effWeights(o.s);
        const order = ['生氣', '延年', '天醫'].map((s, q) => ({ s, q })).sort((a, b) => w[b.s] - w[a.s] || a.q - b.q).map((x) => x.s);
        assert.deepEqual(p.wealthOrder.map((x) => x.star), [...order, '伏位']);
        for (const wo of p.wealthOrder) assert.equal(SPEC_STAR_TABLE[p.ming.gua][wo.dir], wo.star);
        if (input.placements) {
          const good = new Set(['生氣', '延年', '天醫']);
          const c = ['door', 'master', 'stove'].filter((q) => good.has(SPEC_STAR_TABLE[p.ming.gua][input.placements[q]])).length;
          assert.equal(p.threeKeys.count, c);
        } else assert.equal(p.threeKeys, null);
      });
      // 命宅配
      const m = out.match;
      const byPerson = Object.fromEntries(out.people.map((p) => [p.id, EAST.has(p.ming.gua) === EAST.has(o.houseGua)]));
      assert.deepEqual(m.byPerson, byPerson);
      assert.equal(m.mixed, new Set(out.people.map((p) => EAST.has(p.ming.gua))).size > 1);
      assert.equal(m.basis, o.s.coupleBasis);
      assert.equal(m.policy, 'mingOverHouse');
      assert.equal(out.findings.some((f) => f.id === 'bz.household.mixed'), m.mixed);
      const people = input.household.map((p) => ({ id: p.id, gender: p.gender, role: p.role ?? null }));
      const byRole = (role) => people.find((p) => p.role === role);
      let anchor = null;
      if (people.length && o.s.coupleBasis !== 'averaged') {
        const cb = o.s.coupleBasis;
        if (cb === 'breadwinner') anchor = byRole('breadwinner') ?? byRole('holder');
        else if (cb === 'wife') anchor = byRole('wife') ?? people.find((p) => p.gender === 'F');
        else if (cb === 'husband') anchor = byRole('husband') ?? people.find((p) => p.gender === 'M');
        else anchor = byRole('holder');
        anchor ??= people[0];
      }
      assert.equal(m.anchorId, anchor ? anchor.id : null);
      assert.deepEqual(m.consideredIds, o.s.coupleBasis === 'holderOnly' && anchor ? [anchor.id] : people.map((p) => p.id));
      const expectAdvice =
        m.consideredIds.length === 0
          ? '尚未輸入家人資料,這裡只列出房屋的宅卦與八個方位的星位'
          : m.consideredIds.every((id) => byPerson[id])
            ? '命卦與房屋屬於同一組,床頭、書桌、灶口可參考自己命盤的吉方,大門與整屋可對照宅盤'
            : '以個人命卦重排床頭、書桌、灶口的吉方;大門若無法改,至少讓門、主臥、灶口三項中有一項落在吉方';
      assert.equal(m.advice, expectAdvice);
      if (o.s.coupleBasis === 'averaged' && people.length) {
        const w = effWeights(o.s);
        const exp = DIRS.map((dir, q) => ({ dir, q, score: out.people.reduce((sum, p) => sum + w[SPEC_STAR_TABLE[p.ming.gua][dir]], 0) / out.people.length })).sort((a, b) => b.score - a.score || a.q - b.q);
        assert.deepEqual(m.combined.map((c) => c.dir), exp.map((c) => c.dir));
        m.combined.forEach((c, q) => assert.ok(Math.abs(c.score - exp[q].score) < 1e-12));
      } else assert.equal(m.combined, null);
      // findings 結構
      for (const f of out.findings) {
        assert.ok(['info', 'note', 'caution'].includes(f.level));
        assert.ok(['high', 'medium', 'low'].includes(f.confidence));
        assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag));
        assert.ok(typeof f.id === 'string' && typeof f.title === 'string' && typeof f.body === 'string');
        assert.ok(Array.isArray(f.refs));
        assert.ok(f.subject === null || input.household.some((p) => p.id === f.subject));
        assert.ok(!/undefined|NaN|\[object/.test(f.title + f.body), f.body);
      }
      assert.equal(new Set(out.findings.map((f) => `${f.id}|${f.subject}`)).size, out.findings.length, '重複 finding');
      // meta.ruleset 回存實際設定
      assert.equal(out.meta.ruleset.yearBoundary, o.s.yearBoundary);
      assert.equal(out.meta.ruleset.coupleBasis, o.s.coupleBasis);
      assert.equal(out.meta.ruleset.bazhaiFacingBasis, o.s.bazhaiFacingBasis);
      assert.equal(out.meta.ruleset.tianyiFirst, Boolean(o.s.tianyiFirst));
      assert.equal(out.meta.ruleset.measureUncertainty, o.s.measureUncertainty);
      // 輸出可任意修改而不影響下一次
      const snap2 = JSON.stringify(out);
      tryMutate(out);
      assert.equal(JSON.stringify(bz.analyzeBazhai(clone(input), {})), snap2, '輸出與內部共用狀態');
    }
  });

  it('bazhaiFacingBasis: door 只吃 facing.bazhai、house 只吃 facing.xuankong;缺哪個丟 MISSING_FACING', () => {
    const base = { household: [], facing: { bazhai: 0, xuankong: 90 } };
    assert.equal(bz.analyzeBazhai(base).house.facingBearing, 0);
    assert.equal(bz.analyzeBazhai({ ...base, settings: { bazhaiFacingBasis: 'house' } }).house.facingBearing, 90);
    assert.throws(() => bz.analyzeBazhai({ household: [], facing: { xuankong: 90 } }), (e) => /^MISSING_FACING: /.test(e.message));
    assert.throws(() => bz.analyzeBazhai({ household: [], facing: { bazhai: 90 }, settings: { bazhaiFacingBasis: 'house' } }), (e) => /^MISSING_FACING: /.test(e.message));
    assert.equal(bz.analyzeBazhai({ household: [], facing: { bazhai: 90 } }).house.gua, bz.zhaiFromFacing(90).gua);
  });

  it('接近八卦分界警示: 嚴格小於門檻才警示;下限 3 度;只有卦界會警示,山界不會', () => {
    const at = (facing, unc) => bz.analyzeBazhai({ household: [], facing: { bazhai: facing }, settings: { measureUncertainty: unc } }).house.boundary;
    // facing 337.5 -> sit 157.5(巽/離界)
    assert.equal(at(337.5, 5).nearGuaBoundary, true);
    assert.equal(at(337.5, 5).onLine, true);
    assert.equal(at(337.5, 5).otherGua, '巽');
    assert.equal(at(337.4999, 5).otherGua, '離');
    assert.equal(at(342.5, 5).nearGuaBoundary, false, '剛好 5 度: 嚴格小於才警示');
    assert.equal(at(342.4999, 5).nearGuaBoundary, true);
    assert.equal(at(345, 5).nearGuaBoundary, false);
    assert.equal(at(340.4999, 0).nearGuaBoundary, true, '門檻下限 3 度');
    assert.equal(at(340.5, 0).nearGuaBoundary, false, '剛好 3 度');
    assert.equal(at(341, 0).nearGuaBoundary, false);
    assert.equal(at(345, 20).nearGuaBoundary, true);
    // 山界(非卦界)不警示: facing 352.5 -> sit 172.5(離內部山界)
    assert.equal(at(352.5, 5).nearGuaBoundary, false);
    assert.equal(at(352.5, 5).kind, 'shan');
  });

  it('空 household 可用;household 缺或非陣列丟碼;id 重複/型別錯、role 不合法丟碼', () => {
    assert.deepEqual(bz.analyzeBazhai({ household: [], facing: { bazhai: 0 } }).people, []);
    for (const h of [undefined, null, {}, 'x', 5]) {
      assert.throws(() => bz.analyzeBazhai({ household: h, facing: { bazhai: 0 } }), (e) => /^INVALID_HOUSEHOLD: /.test(e.message), String(h));
    }
    const p = { gender: 'M', birth: { local: '1990-05-15T10:30', utcOffset: '+08:00' } };
    assert.throws(() => bz.analyzeBazhai({ household: [{ ...p, id: 'a' }, { ...p, id: 'a' }], facing: { bazhai: 0 } }), (e) => /^DUPLICATE_PERSON_ID: /.test(e.message));
    for (const id of ['', 5, null, {}]) {
      assert.throws(() => bz.analyzeBazhai({ household: [{ ...p, id }], facing: { bazhai: 0 } }), (e) => /^INVALID_HOUSEHOLD: /.test(e.message), String(id));
    }
    for (const role of ['boss', '', 5, 'Wife']) {
      assert.throws(() => bz.analyzeBazhai({ household: [{ ...p, role }], facing: { bazhai: 0 } }), (e) => /^INVALID_ROLE: /.test(e.message), String(role));
    }
  });

  it('未指定 id 的成員自動編號不得與其他人顯式給的 id 撞名', () => {
    const p = { gender: 'M', birth: { local: '1990-05-15T10:30', utcOffset: '+08:00' } };
    const out = bz.analyzeBazhai({ household: [{ ...p }, { ...p, id: 'p1' }], facing: { bazhai: 0 } });
    assert.equal(new Set(out.people.map((x) => x.id)).size, 2);
    assert.ok(out.people.some((x) => x.id === 'p1'));
    const out2 = bz.analyzeBazhai({ household: [{ ...p, id: 'p2' }, { ...p }, { ...p }], facing: { bazhai: 0 } });
    assert.equal(new Set(out2.people.map((x) => x.id)).size, 3);
  });

  it('coupleBasis 具體行為: wife / husband / breadwinner / averaged / holderOnly 的錨定與退回', () => {
    const mk = (gender, role, y, id) => ({ id, gender, role, birth: { local: `${y}-06-15T12:00`, utcOffset: '+08:00' } });
    const hh = [mk('M', 'husband', 1980, 'h'), mk('F', 'wife', 1982, 'w'), mk('M', 'child', 2010, 'c'), mk('F', 'breadwinner', 1985, 'b')];
    const go = (coupleBasis, household = hh) => bz.analyzeBazhai({ household, facing: { bazhai: 180 }, settings: { coupleBasis } });
    assert.equal(go('wife').match.anchorId, 'w');
    assert.equal(go('husband').match.anchorId, 'h');
    assert.equal(go('breadwinner').match.anchorId, 'b');
    assert.equal(go('averaged').match.anchorId, null);
    assert.deepEqual(go('averaged').match.consideredIds, ['h', 'w', 'c', 'b']);
    const r = go('holderOnly');
    assert.equal(r.match.anchorId, 'h');
    assert.ok(r.meta.warnings.includes('anchorFallback'));
    assert.deepEqual(r.match.consideredIds, ['h']);
    assert.ok(!go('holderOnly', [hh[0]]).meta.warnings.includes('anchorFallback'));
    const mism = go('breadwinner', [mk('M', 'breadwinner', 1990, 'a'), mk('F', null, 1990, 'z')]);
    const gz = mism.people[1].ming.gua;
    assert.equal(mism.match.anchorId, 'a');
    assert.equal(mism.match.sleepCareId, EAST.has(gz) !== EAST.has('坎') ? 'z' : 'a');
  });

  it('少數派開關: 預設不出現;開了才出現且 tag=minority(規格 2.3.6)', () => {
    const base = { household: [], facing: { bazhai: 0 } };
    assert.deepEqual(bz.analyzeBazhai(base).findings, []);
    const on = bz.analyzeBazhai({ ...base, settings: { showMinorityTechniques: true, showGuimenxian: true } }).findings;
    assert.deepEqual(on.map((f) => f.id).sort(), ['bz.minority.guimenxian', 'bz.minority.taohua', 'bz.minority.wugui_yuncai']);
    for (const f of on) assert.equal(f.tag, 'minority');
    assert.deepEqual(bz.analyzeBazhai({ ...base, settings: { showGuimenxian: true } }).findings.map((f) => f.id), ['bz.minority.guimenxian']);
  });

  it('input 為 null/非物件、facing 非物件、settings 型別錯、placements 型別錯', () => {
    for (const bad of [null, undefined, 5, 'x', [], true]) {
      assert.throws(() => bz.analyzeBazhai(bad), (e) => /^INVALID_INPUT: /.test(e.message), String(bad));
    }
    for (const f of [null, undefined, 5, [], 'x']) {
      assert.throws(() => bz.analyzeBazhai({ household: [], facing: f }), (e) => /^INVALID_FACING: /.test(e.message), String(f));
    }
    for (const s of ['abc', [1], 5, true, []]) {
      assert.throws(() => bz.analyzeBazhai({ household: [], facing: { bazhai: 0 }, settings: s }), (e) => /^INVALID_SETTING: /.test(e.message), JSON.stringify(s));
    }
    for (const pl of [5, 'x', [], { door: '北' }, { door: '北', master: '北', stove: '中' }]) {
      assert.throws(() => bz.analyzeBazhai({ household: [], facing: { bazhai: 0 }, placements: pl }), (e) => /^(INVALID_OPTION|UNKNOWN_DIR): /.test(e.message), JSON.stringify(pl));
    }
  });

  it('設定鍵帶原型鏈名稱(constructor/toString/valueOf)必須被當成未知設定拒絕', () => {
    for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      assert.throws(() => bz.analyzeBazhai({ household: [], facing: { bazhai: 0 }, settings: { [k]: 1 } }), (e) => /^INVALID_SETTING: /.test(e.message), k);
      assert.throws(() => bz.wealthOrder('坎', { [k]: 1 }), (e) => /^INVALID_SETTING: /.test(e.message), k);
    }
  });
});

// ═══════════════════════════ 8. 崩潰性 fuzz(垃圾輸入只能丟帶碼的 Error) ═══════════════════════════
describe('bazhai fuzz: 垃圾輸入', () => {
  const JUNK = [undefined, null, NaN, Infinity, -Infinity, -0, 0, 1, -1, 7.5, 1e308, 1e-320, 'x', '', '坎', '北', [], {}, [1], { a: 1 }, true, false, () => 1, 1n, Symbol('s'), '2000-02-04', { local: '2000-02-04', utcOffset: '+08:00' }];
  const isCodeError = (e) => e instanceof Error && CODE_RE.test(e.message) && !(e instanceof TypeError) && !(e instanceof RangeError);
  const show = (a) => {
    try {
      return typeof a === 'symbol' ? 'Symbol' : typeof a === 'bigint' ? `${a}n` : typeof a === 'function' ? 'fn' : JSON.stringify(a);
    } catch {
      return '?';
    }
  };

  function attempt(label, fn) {
    try {
      const out = fn();
      if (out !== undefined) JSON.stringify(out);
    } catch (e) {
      assert.ok(isCodeError(e), `${label} 丟出非帶碼錯誤: ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
    }
  }

  it('每個 public 函式 x 垃圾參數組合', () => {
    const r = mulberry32(909);
    const fns = {
      groupOf: 1, isMatch: 2, starsOf: 1, starOf: 2, starAtDir: 2, starWeights: 1, wealthOrder: 2,
      mingGuaFromYear: 2, mingGuaFromBirth: 4, zhaiFromFacing: 1, zhaiFromSitMountain: 1, usageGuide: 2,
      lookupUsage: 2, threeKeys: 2, analyzeBazhai: 2,
    };
    for (let n = 0; n < 4000; n++) {
      for (const [name, arity] of Object.entries(fns)) {
        const args = Array.from({ length: arity }, () => pick(r, JUNK));
        attempt(`${name}(${args.map(show).join(', ')})`, () => bz[name](...args));
      }
    }
  });

  it('把合法 analyzeBazhai 輸入的任一路徑換成垃圾或刪除', () => {
    const r = mulberry32(910);
    const walk = (o, p, acc) => {
      acc.push(p);
      if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], [...p, k], acc);
      return acc;
    };
    for (let n = 0; n < 3000; n++) {
      const input = genInput(r, { people: ri(r, 1, 3) });
      input.placements ??= { door: '北', master: '東', stove: '南' };
      input.settings ??= {};
      const p = pick(r, walk(input, [], []).filter((x) => x.length > 0));
      const mut = clone(input);
      let cur = mut;
      for (let i = 0; i < p.length - 1; i++) cur = cur[p[i]];
      if (r() < 0.15) delete cur[p[p.length - 1]];
      else cur[p[p.length - 1]] = pick(r, JUNK);
      const label = `mut ${p.join('.')}`;
      const o = r() < 0.2 ? { lunarNewYearOf: lunarStub } : {};
      attempt(label, () => bz.analyzeBazhai(mut, o));
      try {
        const out = bz.analyzeBazhai(mut, o);
        assert.ok(!/NaN|undefined/.test(JSON.stringify(out, (k, v) => (v === undefined ? 'undefined' : Number.isNaN(v) ? 'NaN' : v))), label);
      } catch {
        /* 丟碼已在 attempt 驗證 */
      }
    }
  });
});

// ═══════════════════════════ 9. 效能 ═══════════════════════════
describe('bazhai fuzz: 效能', () => {
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const time = (fn, n = 300) => {
    fn();
    const t = [];
    for (let i = 0; i < n; i++) {
      const s = process.hrtime.bigint();
      fn();
      t.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    return { med: median(t), max: Math.max(...t) };
  };
  it('單次呼叫中位數 < 5ms(最大 < 50ms 以容忍 GC)', () => {
    const birth = { local: '1990-05-15T10:30', utcOffset: '+08:00' };
    const hh = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, gender: i % 2 ? 'M' : 'F', birth: { local: `${1960 + i * 7}-02-04T12:00`, utcOffset: '+08:00' } }));
    const cases = {
      mingGuaFromBirth: () => bz.mingGuaFromBirth(birth, 'F'),
      zhaiFromFacing: () => bz.zhaiFromFacing(123.4),
      usageGuide: () => bz.usageGuide('坎'),
      wealthOrder: () => bz.wealthOrder('坎'),
      analyzeBazhai6: () => bz.analyzeBazhai({ household: hh, facing: { bazhai: 337.5 }, placements: { door: '北', master: '東', stove: '南' } }),
    };
    for (const [k, fn] of Object.entries(cases)) {
      const { med, max } = time(fn);
      assert.ok(med < 5, `${k} median=${med.toFixed(3)}ms`);
      assert.ok(max < 50, `${k} max=${max.toFixed(3)}ms`);
    }
  });
});

// ═══════════════════════════ 10. 突變測試: oracle 抓得出錯誤實作 ═══════════════════════════
describe('bazhai fuzz: 突變測試(證明差分比對會失敗)', () => {
  const compareMing = (fn) => {
    let bad = 0;
    for (let Y = 1900; Y <= 2099; Y++) for (const g of ['M', 'F']) if (fn(Y, g).gua !== oracleMing(Y, g).gua) bad++;
    return bad;
  };
  it('命卦: 正確實作 0 不符;各種被改錯的版本必須 > 0 不符', () => {
    assert.equal(compareMing(bz.mingGuaFromYear), 0);
    assert.ok(compareMing((Y, g) => bz.mingGuaFromYear(Y, g === 'M' ? 'F' : 'M')) > 0, '性別對調');
    assert.ok(compareMing((Y, g) => bz.mingGuaFromYear(Y + 1, g)) > 0, '差一年');
    assert.ok(compareMing((Y, g) => {
      const m = bz.mingGuaFromYear(Y, g);
      return Y === 2000 && g === 'M' ? { ...m, gua: '艮' } : m; // 英文站「和為 0 用 10」陷阱
    }) > 0, '2000 年男陷阱');
    assert.ok(compareMing((Y, g) => {
      const m = bz.mingGuaFromYear(Y, g);
      return m.rawNumber === 5 ? { ...m, gua: g === 'M' ? '艮' : '坤' } : m; // 5 入中寄宮對調
    }) > 0, '寄宮對調');
  });
  it('星表: 改錯任何一格會被逐格比對抓出', () => {
    const cmp = (lookup) => {
      let bad = 0;
      for (const g of GUA) for (const d of DIRS) if (lookup(g, d) !== SPEC_STAR_TABLE[g][d]) bad++;
      return bad;
    };
    assert.equal(cmp(bz.starAtDir), 0);
    assert.equal(cmp((g, d) => (g === '乾' && d === '西' ? '天醫' : bz.starAtDir(g, d))), 1);
    assert.equal(cmp((g, d) => { const s = bz.starAtDir(g, d); return s === '生氣' ? '天醫' : s === '天醫' ? '生氣' : s; }), 16, '生氣/天醫全表對調');
  });
  it('宅卦: 半開區間邊界改成閉區間會被抓出', () => {
    const wrong = (f) => GUA[Math.floor(imod(imod(f + 180, 360) + 22.5 - 1e-9, 360) / 45)]; // 邊界歸逆時針一側
    let bad = 0;
    for (let k = 0; k < 8; k++) if (wrong(180 + 22.5 + 45 * k) !== bz.zhaiFromFacing(180 + 22.5 + 45 * k).gua) bad++;
    assert.ok(bad > 0);
  });
  it('年界 oracle: 把立春換年改成元旦會被抓出', () => {
    let bad = 0;
    for (let y = 1950; y <= 2050; y++) {
      const ms = tableLichun(y) - 3600e3; // 立春前 1 小時
      if (oracleYear(ms, 'gregorian_jan1', lunarStub) !== oracleYear(ms, 'lichun_exact', lunarStub)) bad++;
    }
    assert.equal(bad, 101);
  });
});

// bazhai 模組測試。fixtures 一律唯讀(bazhai.json 只依附錄 B.1 補案,見 bazhai.changes.md)。
// 硬斷言 / 軟斷言依 spec 4.1、4.2;突變測試證明 runner 抓得到被改錯的期望值;
// 規格內嵌資料表一律「由規則重算 == 實作內嵌表」(4.2 第 6 點),重算法與 src 不共用程式。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFixture,
  assertAngle,
  assertDeepApprox,
  isSoft,
  assertRunnerCatches,
  DIR_OF_GUA,
  LUOSHU as H_LUOSHU,
} from './helpers/harness.js';
import {
  specJsonAfter,
  parseSpecStarAttrs,
  parseSpecUsageTable,
  tableByLineDiff,
  tableBySong,
  starByLineDiff,
  palmMingGua,
  digitMingGua,
  oracleZhai,
  GUA_GROUP,
  mod9,
} from './helpers/bazhai.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as bz from '../src/core/bazhai.js';
import * as calendar from '../src/core/calendar.js';
import * as geo from '../src/core/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_TEXT = readFileSync(path.join(here, '..', 'src', 'core', 'bazhai.js'), 'utf8');

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const GUA8 = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];

// ═══════════════════════════ A. bazhai.json 案例 runner ═══════════════════════════

const fx = loadFixture('bazhai');
const CONV = fx.meta.conventions;
const BOUNDARIES = ['lichun_exact', 'lichun_date_only', 'fixed_feb4', 'lunar_new_year', 'gregorian_jan1'];

// Adapter: fixtures 的 male/female、snake_case 鍵 -> 引擎的 M/F、camelCase 鍵(spec 4.3)。
const G = (g) => {
  if (g === 'male') return 'M';
  if (g === 'female') return 'F';
  return assert.fail(`未知性別 ${g}`);
};
const mingOf = (e) => ({
  effectiveYear: e.effective_year,
  rawNumber: e.raw_number,
  guaNumberUsed: e.gua_number_used,
  gua: e.gua,
  group: e.group,
});
/** 獨立於 calendar.toInstant 的換算: 當地時間減去偏移。 */
function birthMs(local, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0));
  const o = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  return t - (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3]) * 60000;
}
const cstStringMs = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600e3;
};

function runMingguaYear(c) {
  const g = G(c.input.gender);
  const got = bz.mingGuaFromYear(c.input.year, g);
  assert.deepEqual(got, mingOf(c.expected));
  // 第三個意見: 《八宅明鏡》排山掌訣逐年推
  const palm = palmMingGua(c.input.year, g);
  assert.equal(palm.gua, c.expected.gua, 'fixture 與排山掌訣不一致');
  assert.equal(palm.raw, c.expected.raw_number);
}

function birthOf(c) {
  return { local: c.input.birth_local, utcOffset: c.input.utc_offset, timeKnown: c.input.timeKnown ?? true };
}

function runMingguaBirth(c) {
  const g = G(c.input.gender);
  const exp = c.expected;
  const lny = exp.lunar_new_year_this_year;
  const lnyOf = lny
    ? (y) => {
        assert.equal(y, Number(lny.slice(0, 4)), '引擎向農曆解析器要的年份不對');
        return lny;
      }
    : undefined;
  const opts = lnyOf ? { lunarNewYearOf: lnyOf } : {};
  const timeKnown = birthOf(c).timeKnown;

  for (const b of BOUNDARIES) {
    if (!(b in exp)) continue;
    const got = bz.mingGuaFromBirth(birthOf(c), g, { yearBoundary: b }, opts);
    assertDeepApprox(got, mingOf(exp[b]), 0, `${b}`);
    // 走完整分析函式的路徑也要一致
    const out = bz.analyzeBazhai(
      { household: [{ id: 'p1', gender: g, birth: birthOf(c) }], facing: { bazhai: 180 }, settings: { yearBoundary: b } },
      opts,
    );
    assertDeepApprox(out.people[0].ming, mingOf(exp[b]), 0, `analyze ${b}`);
  }
  if ('default_boundary' in exp) assert.equal(DEFAULT_SETTINGS.yearBoundary, exp.default_boundary);

  const lichunStr = exp.lichun_cst_this_year;
  if (lichunStr) {
    // 引擎立春與 fixture 的 Skyfield 表差 <= 120 秒(spec 4.1 calendar 條件),且臨界旗標與表獨立推得的一致
    const cy = Number(lichunStr.slice(0, 4));
    const tblMs = cstStringMs(lichunStr);
    assert.ok(Math.abs(calendar.lichun(cy) - tblMs) <= 120000, '引擎立春與 fixture 表差超過 120 秒');
    const got = bz.mingGuaFromBirth(birthOf(c), g, {}, opts);
    if (timeKnown) {
      const near = Math.abs(birthMs(c.input.birth_local, c.input.utc_offset) - tblMs) <= 120000;
      assert.equal(got.flags.nearLichun, near, 'nearLichun 旗標與獨立推算不符');
      assert.equal(got.flags.dateIsLichunDay, false);
    }
  }

  if (exp.flags) {
    const got = bz.mingGuaFromBirth(birthOf(c), g, {}, opts);
    assert.equal(got.flags.nearLichun, exp.flags.nearLichun, 'flags.nearLichun');
    assert.equal(got.flags.dateIsLichunDay, exp.flags.dateIsLichunDay, 'flags.dateIsLichunDay');
  }
  if (exp.alternatives) {
    const got = bz.mingGuaFromBirth(birthOf(c), g, {}, opts);
    assert.equal(got.flags.alternatives.length, exp.alternatives.length, 'alternatives 數量');
    exp.alternatives.forEach((a, i) => {
      assert.equal(got.flags.alternatives[i].side, a.side);
      assertDeepApprox(got.flags.alternatives[i], mingOf(a), 0, `alternatives[${i}]`);
    });
    // 不知時刻的立春日: 主結果必須是兩個候選之一
    assert.ok(exp.alternatives.some((a) => a.effective_year === got.effectiveYear), '主結果不在 alternatives 內');
  }
}

function runStarMatrix(c) {
  const byDir = c.expected.by_direction;
  const byGua = c.expected.by_gua;
  assert.deepEqual(Object.keys(byDir).sort(), [...GUA8].sort());
  for (const home of GUA8) {
    assert.deepEqual(bz.starsOf(home), byDir[home], `${home} 命卦的方位星表`);
    for (const target of GUA8) assert.equal(bz.starOf(home, target), byGua[home][target], `${home}看${target}`);
  }
  assert.deepEqual(bz.STAR_TABLE, byDir);
}

function runStarRow(c) {
  const { gua, gua_number: num } = c.input;
  assert.equal(H_LUOSHU[gua], num);
  const got = bz.starsOf(gua);
  assert.deepEqual(got, c.expected.by_direction);
  assert.equal(fx.meta.song_da_you_nian[gua], c.expected.song, 'fixture 內歌訣自相矛盾');
  assert.equal(got[c.expected.fu_wei_direction], '伏位');
  assert.equal(c.expected.fu_wei_direction, DIR_OF_GUA[gua]);
}

const YAO_DIFF_WORDS = {
  none: '',
  'top only': '2',
  'top+middle': '12',
  'all three': '012',
  'top+bottom': '02',
  'bottom only': '0',
  'middle+bottom': '01',
  'middle only': '1',
};

function runProperty(c) {
  const lines = CONV.trigram_lines_bottom_to_top;
  if (c.name === 'star_pair_symmetry') {
    assert.equal(c.expected.pairs.length, 28, '28 對');
    assert.equal(c.expected.all_symmetric, true);
    for (const p of c.expected.pairs) {
      assert.equal(bz.starOf(p.a, p.b), p.star_a_sees_b, `${p.a}看${p.b}`);
      assert.equal(bz.starOf(p.b, p.a), p.star_b_sees_a, `${p.b}看${p.a}`);
      assert.equal(p.star_a_sees_b, p.star_b_sees_a);
    }
  } else if (c.name === 'star_group_closure') {
    assert.equal(c.expected.holds, true);
    for (const [members, dirsOfGroup] of [
      [c.expected.east_group, c.expected.east_group.map((g) => DIR_OF_GUA[g])],
      [c.expected.west_group, c.expected.west_group.map((g) => DIR_OF_GUA[g])],
    ]) {
      for (const home of members) {
        const row = bz.starsOf(home);
        for (const good of ['生氣', '延年', '天醫', '伏位']) {
          const dir = DIRS.find((d) => row[d] === good);
          assert.ok(dirsOfGroup.includes(dir), `${home}命的${good}落在${dir},不在同組方位`);
        }
      }
    }
  } else if (c.name === 'star_yao_rule') {
    // expected: 星 -> 爻差描述;逐一對 64 格核對(爻差法由 helper 獨立實作)
    for (const [star, word] of Object.entries(c.expected)) {
      if (star === 'walk_from_home') continue;
      const key = YAO_DIFF_WORDS[word];
      assert.notEqual(key, undefined, `未知爻差描述 ${word}`);
      for (const home of GUA8) {
        for (const target of GUA8) {
          const isThisStar = starByLineDiff(lines[home], lines[target]) === star;
          const diffKey = [0, 1, 2].filter((i) => lines[home][i] !== lines[target][i]).join('');
          assert.equal(diffKey === key, isThisStar, `${star} 的爻差描述與 helper 不一致`);
          assert.equal(bz.starOf(home, target) === star, isThisStar, `${home}看${target}: 引擎與爻差法不一致`);
        }
      }
    }
  } else {
    assert.fail(`未知 property 案: ${c.name}`);
  }
}

function runLegacy(c) {
  if ('correct_star' in c.expected) {
    const got = bz.starAtDir(c.input.gua, c.input.direction);
    assert.equal(got, c.expected.correct_star);
    assert.notEqual(got, c.expected.legacy_wrong_star, '新引擎重現了舊引擎的錯誤');
  } else {
    const got = bz.mingGuaFromYear(c.input.year, G(c.input.gender));
    assert.equal(got.gua, c.expected.correct_gua);
    assert.notEqual(got.gua, c.expected.legacy_wrong_gua, '新引擎重現了舊引擎的錯誤');
  }
}

function runZhaiSit(c) {
  const e = c.expected;
  const got = bz.zhaiFromSitMountain(c.input.sit_mountain);
  assert.equal(got.gua, e.zhai_gua);
  assert.equal(got.name, e.zhai_name);
  assert.equal(got.group, e.camp);
  assert.equal(got.facingMountain, e.facing_mountain);
  assert.equal(got.sitCenterDeg, c.input.sit_center_degree);
  assert.equal(got.facingCenterDeg, e.facing_center_degree);
  // 由向的中心角走另一條 API(sitFromFacing)必須得到同一個山與宅卦
  const viaFacing = bz.zhaiFromFacing(e.facing_center_degree);
  assert.equal(viaFacing.gua, e.zhai_gua);
  assert.equal(viaFacing.sitMountain, c.input.sit_mountain);
  assert.equal(viaFacing.facingMountain, e.facing_mountain);
}

function runZhaiFacing(c) {
  const e = c.expected;
  const got = bz.zhaiFromFacing(c.input.facing_degree);
  assertAngle(got.sitBearing, e.sit_degree, 1e-9, 'sitBearing');
  assert.equal(got.gua, e.zhai_gua);
  assert.equal(got.group, e.camp);
  // 走完整分析函式: house 欄位一致,且不需要任何家人
  const out = bz.analyzeBazhai({ household: [], facing: { bazhai: c.input.facing_degree } });
  assert.equal(out.house.gua, e.zhai_gua);
  assert.equal(out.house.group, e.camp);
  assertAngle(out.house.sitBearing, e.sit_degree, 1e-9, 'house.sitBearing');
  // 獨立於 45 度公式的整數掃描
  if (Number.isInteger(c.input.facing_degree * 10)) {
    assert.equal(oracleZhai(Math.round(c.input.facing_degree * 10)).gua, e.zhai_gua, '整數掃描與 fixture 不一致');
  }
}

/** 找一個 (年, 性別) 使命卦等於指定卦,供 match 矩陣走完整分析用。 */
function birthYearFor(gua) {
  for (let y = 1990; y <= 2010; y += 1) {
    for (const g of ['M', 'F']) if (palmMingGua(y, g).gua === gua) return { year: y, gender: g };
  }
  return assert.fail(`找不到命卦 ${gua}`);
}

function runMatchMatrix(c) {
  const m = c.expected.matrix;
  for (const ming of GUA8) {
    const { year, gender } = birthYearFor(ming);
    for (const zhai of GUA8) {
      const want = m[ming][zhai] === '相配';
      assert.equal(bz.isMatch(ming, zhai), want, `${ming}命 ${zhai}宅`);
      // 走完整分析: 房屋的坐山中心 = (宅卦中心 45k),向 = 坐 + 180
      const facing = (45 * GUA8.indexOf(zhai) + 180) % 360;
      const out = bz.analyzeBazhai({
        household: [{ id: 'p1', gender, birth: { local: `${year}-07-01T12:00`, utcOffset: '+08:00', timeKnown: true } }],
        facing: { bazhai: facing },
      });
      assert.equal(out.house.gua, zhai);
      assert.equal(out.people[0].ming.gua, ming);
      assert.equal(out.match.byPerson.p1, want, `${ming}命 ${zhai}宅 (完整分析)`);
    }
  }
}

function runUsage(c) {
  const i = c.input;
  const e = c.expected;
  const got = bz.lookupUsage(i.ming_gua, {
    roomPosition: i.room_position_from_house_center,
    bedHead: i.bed_head_direction,
    stoveSeat: i.stove_seat_position,
    stoveMouth: i.stove_mouth_facing,
    deskFacing: i.desk_facing,
  });
  assert.equal(got.roomPositionStar, e.room_position_star);
  assert.equal(got.bedHeadStar, e.bed_head_star);
  assert.equal(got.stoveSeatStar, e.stove_seat_star);
  assert.equal(got.stoveMouthStar, e.stove_mouth_star);
  assert.equal(got.deskFacingStar, e.desk_facing_star);
  // 位置與朝向查同一張表: 用途指南的星與查表一致
  const guide = bz.usageGuide(i.ming_gua);
  const starIn = (list, dir) => list.find((x) => x.dir === dir).star;
  assert.equal(starIn(guide.position.living, i.room_position_from_house_center), e.room_position_star);
  assert.equal(starIn(guide.facing.bedHead, i.bed_head_direction), e.bed_head_star);
  assert.equal(starIn(guide.position.stoveSeat, i.stove_seat_position), e.stove_seat_star);
  assert.equal(starIn(guide.facing.stoveMouth, i.stove_mouth_facing), e.stove_mouth_star);
  assert.equal(starIn(guide.facing.desk, i.desk_facing), e.desk_facing_star);
}

const RUNNERS = {
  minggua_year: runMingguaYear,
  minggua_birth: runMingguaBirth,
  star_matrix: runStarMatrix,
  star_row: runStarRow,
  property: runProperty,
  legacy_regression: runLegacy,
  zhai_gua_from_sit_mountain: runZhaiSit,
  zhai_gua_from_facing_degree: runZhaiFacing,
  match_matrix: runMatchMatrix,
  usage: runUsage,
};

describe('bazhai.json: 每個 kind 都有 runner,案例全數執行', () => {
  it('fixture 格式、kind 覆蓋與數量', () => {
    assert.ok(fx.cases.length >= 135, `案例數 ${fx.cases.length}`);
    const kinds = new Set(fx.cases.map((c) => c.kind));
    for (const k of kinds) assert.ok(RUNNERS[k], `kind ${k} 沒有 runner`);
    assert.equal(new Set(fx.cases.map((c) => c.name)).size, fx.cases.length, '案名重複');
    const n = (k) => fx.cases.filter((c) => c.kind === k).length;
    // 原始 135 案的分布(附錄 B.1 補案只增不減)
    assert.ok(n('minggua_year') >= 34 && n('minggua_birth') >= 27 && n('star_matrix') === 1 && n('star_row') === 8);
    assert.ok(n('property') === 3 && n('zhai_gua_from_sit_mountain') === 24 && n('zhai_gua_from_facing_degree') >= 12);
    assert.ok(n('match_matrix') === 1 && n('usage') === 1 && n('legacy_regression') === 24);
  });

  for (const c of fx.cases) {
    it(`${c.kind}: ${c.name}`, () => {
      if (isSoft(c)) {
        // confidence=low: 只要求不崩潰(目前 bazhai.json 沒有 low 案,保留規則本身)
        assert.doesNotThrow(() => RUNNERS[c.kind](c));
        return;
      }
      RUNNERS[c.kind](c);
    });
  }
});

// ═══════════════════════════ B. 突變測試 ═══════════════════════════

const otherGua = (g) => (g === '坎' ? '離' : '坎');
const MUTATORS = {
  minggua_year: (c) => {
    c.expected.gua = otherGua(c.expected.gua);
  },
  minggua_birth: (c) => {
    const k = BOUNDARIES.find((b) => b in c.expected);
    c.expected[k].effective_year += 1;
  },
  star_matrix: (c) => {
    const row = c.expected.by_direction['坎'];
    [row['北'], row['東北']] = [row['東北'], row['北']];
  },
  star_row: (c) => {
    const row = c.expected.by_direction;
    const ks = Object.keys(row);
    [row[ks[0]], row[ks[1]]] = [row[ks[1]], row[ks[0]]];
  },
  legacy_regression: (c) => {
    // 把「舊錯值」改成正確值 = 宣稱新引擎不可等於它,但它等於 -> runner 必須抓到
    if ('correct_star' in c.expected) c.expected.legacy_wrong_star = c.expected.correct_star;
    else c.expected.legacy_wrong_gua = c.expected.correct_gua;
  },
  zhai_gua_from_sit_mountain: (c) => {
    c.expected.zhai_gua = otherGua(c.expected.zhai_gua);
  },
  zhai_gua_from_facing_degree: (c) => {
    c.expected.sit_degree = (c.expected.sit_degree + 1) % 360;
  },
  match_matrix: (c) => {
    const cell = c.expected.matrix['坎'];
    cell['坤'] = cell['坤'] === '相配' ? '不配' : '相配';
  },
  usage: (c) => {
    c.expected.room_position_star = '絕命';
  },
};
const PROPERTY_MUTATORS = {
  star_pair_symmetry: (c) => {
    c.expected.pairs[0].star_a_sees_b = '伏位';
  },
  star_group_closure: (c) => {
    c.expected.east_group = ['坎', '震', '巽', '乾'];
  },
  star_yao_rule: (c) => {
    c.expected['生氣'] = 'bottom only';
  },
};

describe('突變測試: 故意改錯期望值,runner 必須抓到', () => {
  const firstOf = (k) => fx.cases.find((c) => c.kind === k);
  for (const [kind, mutate] of Object.entries(MUTATORS)) {
    it(kind, () => {
      const bad = clone(firstOf(kind));
      mutate(bad);
      assertRunnerCatches(RUNNERS[kind], bad);
      assert.throws(() => RUNNERS[kind](bad), (e) => e instanceof assert.AssertionError, '應是斷言失敗,不是別的錯誤');
    });
  }
  for (const [name, mutate] of Object.entries(PROPERTY_MUTATORS)) {
    it(`property: ${name}`, () => {
      const bad = clone(fx.cases.find((c) => c.name === name));
      mutate(bad);
      assertRunnerCatches(RUNNERS.property, bad);
      assert.throws(() => RUNNERS.property(bad), (e) => e instanceof assert.AssertionError);
    });
  }
  it('每個 kind 都有突變器', () => {
    for (const k of Object.keys(RUNNERS)) assert.ok(k === 'property' || MUTATORS[k], `${k} 缺突變器`);
  });
  it('minggua_birth 的 alternatives 與 flags 期望被改也抓得到', () => {
    const base = fx.cases.find((c) => c.expected && c.expected.alternatives);
    if (!base) return; // 補案尚未加入時略過
    const bad = clone(base);
    bad.expected.alternatives[0].gua = otherGua(bad.expected.alternatives[0].gua);
    assertRunnerCatches(RUNNERS.minggua_birth, bad);
    const bad2 = clone(base);
    bad2.expected.flags.dateIsLichunDay = !bad2.expected.flags.dateIsLichunDay;
    assertRunnerCatches(RUNNERS.minggua_birth, bad2);
  });
});

// ═══════════════════════════ C. 規格內嵌資料表: 由規則重算 == 內嵌表 ═══════════════════════════

describe('資料表重算(spec 4.2 第 6 點)', () => {
  it('8x8 星表 == 相對爻差法 == 大遊年歌 == 規格內嵌 JSON == fixture', () => {
    const dirs = CONV.directions;
    const byLine = tableByLineDiff(CONV.trigram_lines_bottom_to_top, dirs);
    const bySong = tableBySong(fx.meta.song_da_you_nian, dirs);
    const inSpec = specJsonAfter('**遊年八星 8x8 表**');
    const inFixture = fx.cases.find((c) => c.kind === 'star_matrix').expected.by_direction;
    assert.deepEqual(byLine, bySong, '爻差法與大遊年歌不一致(helper 自檢)');
    assert.deepEqual(bz.STAR_TABLE, byLine);
    assert.deepEqual(bz.STAR_TABLE, bySong);
    assert.deepEqual(bz.STAR_TABLE, inSpec);
    assert.deepEqual(bz.STAR_TABLE, inFixture);
  });

  it('產生規則: 爻變序列與 fixture meta 一致', () => {
    const idx = { bottom: 0, middle: 1, top: 2 };
    const walk = fx.meta.star_walk_from_home_gua.map(([pos, star]) => [idx[pos], star]);
    assert.deepEqual(bz.STAR_WALK.map((x) => [...x]), walk);
  });

  it('八星屬性 == 規格表 == fixture meta.stars', () => {
    const spec = parseSpecStarAttrs();
    assert.equal(Object.keys(spec).length, 8);
    for (const [star, a] of Object.entries(spec)) {
      const got = bz.STAR_ATTRS[star];
      assert.equal(got.nineStar, a.nineStar, `${star} 九星名`);
      assert.equal(got.element, a.element, `${star} 五行`);
      assert.equal(got.level, a.level, `${star} 傳統等級`);
      assert.equal(got.weight, a.weight, `${star} 權重`);
      const f = fx.meta.stars[star];
      assert.equal(got.nineStar, f.star);
      assert.equal(got.element, f.element);
      assert.equal(got.level, f.level_classical);
    }
    assert.deepEqual(Object.keys(bz.STAR_ATTRS).sort(), Object.keys(spec).sort());
  });

  it('吉凶分組、預設等級順序(D14)', () => {
    assert.deepEqual([...bz.AUSPICIOUS_STARS], ['生氣', '延年', '天醫', '伏位']);
    assert.deepEqual([...bz.INAUSPICIOUS_STARS], ['絕命', '五鬼', '六煞', '禍害']);
    const w = (s) => bz.STAR_ATTRS[s].weight;
    assert.ok(w('生氣') > w('延年') && w('延年') > w('天醫') && w('天醫') > w('伏位') && w('伏位') > 0);
    assert.ok(w('絕命') < w('五鬼') && w('五鬼') < w('六煞') && w('六煞') === w('禍害') && w('禍害') < 0);
  });

  it('東四/西四分組 == geo 24 山表推得的組別', () => {
    for (const g of GUA8) assert.equal(bz.groupOf(g), GUA_GROUP[g]);
    assert.deepEqual([...bz.EAST_GROUP].sort(), ['坎', '巽', '離', '震'].sort());
    assert.deepEqual([...bz.WEST_GROUP].sort(), ['乾', '兌', '坤', '艮'].sort());
    // 24 山歸卦: 每卦 3 山,組別隨卦
    for (const m of geo.MOUNTAINS) assert.equal(bz.zhaiFromSitMountain(m.name).group, GUA_GROUP[m.gua]);
  });

  it('常數表不可被改寫(凍結)', () => {
    assert.throws(() => {
      bz.STAR_TABLE['坎']['北'] = '絕命';
    });
    assert.throws(() => {
      bz.STAR_ATTRS['生氣'].weight = 9;
    });
    assert.throws(() => {
      bz.USAGE_MATRIX.door['生氣'].rating = 'worst';
    });
  });

  it('星表回傳的是拷貝,改動不影響內部', () => {
    const a = bz.starsOf('坎');
    a['北'] = '絕命';
    assert.equal(bz.starsOf('坎')['北'], '伏位');
    const w = bz.starWeights();
    w['生氣'] = -1;
    assert.equal(bz.starWeights()['生氣'], 1.0);
  });
});

// ═══════════════════════════ D. 屬性測試(spec 4.4) ═══════════════════════════

describe('屬性測試: 八星表', () => {
  it('對稱: 星(A看B) == 星(B看A),28 對', () => {
    let pairs = 0;
    for (let i = 0; i < 8; i += 1) {
      for (let j = i + 1; j < 8; j += 1) {
        pairs += 1;
        assert.equal(bz.starOf(GUA8[i], GUA8[j]), bz.starOf(GUA8[j], GUA8[i]));
      }
    }
    assert.equal(pairs, 28);
  });
  it('拉丁方: 每列每欄 8 星各一', () => {
    const all = [...bz.AUSPICIOUS_STARS, ...bz.INAUSPICIOUS_STARS].sort();
    for (const home of GUA8) {
      assert.deepEqual(Object.values(bz.starsOf(home)).sort(), all, `${home} 列`);
    }
    for (const dir of DIRS) {
      assert.deepEqual(GUA8.map((home) => bz.starAtDir(home, dir)).sort(), all, `${dir} 欄`);
    }
  });
  it('伏位落在本卦自己的方位', () => {
    for (const home of GUA8) assert.equal(bz.starAtDir(home, DIR_OF_GUA[home]), '伏位');
  });
  it('東四命四吉星必落東四方位、西四命落西四方位', () => {
    const east = new Set(['坎', '震', '巽', '離'].map((g) => DIR_OF_GUA[g]));
    for (const home of GUA8) {
      const east4 = GUA_GROUP[home] === 'east';
      for (const [dir, star] of Object.entries(bz.starsOf(home))) {
        if (['生氣', '延年', '天醫', '伏位'].includes(star)) {
          assert.equal(east.has(dir), east4, `${home}命 ${star} 在 ${dir}`);
        }
      }
    }
  });
});

describe('屬性測試: 命卦', () => {
  it('封閉式 == 排山掌訣逐年推 (1700-2399,男女)', () => {
    let n = 0;
    for (let y = 1700; y <= 2399; y += 1) {
      for (const g of ['M', 'F']) {
        const got = bz.mingGuaFromYear(y, g);
        const palm = palmMingGua(y, g);
        assert.equal(got.rawNumber, palm.raw, `${y}${g} raw`);
        assert.equal(got.guaNumberUsed, palm.num, `${y}${g} num`);
        assert.equal(got.gua, palm.gua, `${y}${g} gua`);
        n += 1;
      }
    }
    assert.equal(n, 1400);
  });
  it('封閉式 == 1900/2000 末兩位公式 (1900-2099,男女 400 組)', () => {
    let n = 0;
    for (let y = 1900; y <= 2099; y += 1) {
      for (const g of ['M', 'F']) {
        const d = digitMingGua(y, g);
        const got = bz.mingGuaFromYear(y, g);
        assert.equal(got.rawNumber, d.raw, `${y}${g}`);
        assert.equal(got.gua, d.gua, `${y}${g}`);
        n += 1;
      }
    }
    assert.equal(n, 400);
  });
  it('命卦 5 的寄宮: 男坤(2) 女艮(8);rawNumber 保留', () => {
    const m = bz.mingGuaFromYear(2004, 'M');
    assert.deepEqual(m, { effectiveYear: 2004, rawNumber: 5, guaNumberUsed: 2, gua: '坤', group: 'west' });
    const f = bz.mingGuaFromYear(1990, 'F');
    assert.deepEqual(f, { effectiveYear: 1990, rawNumber: 5, guaNumberUsed: 8, gua: '艮', group: 'west' });
    for (let y = 1800; y <= 2200; y += 1) {
      for (const g of ['M', 'F']) {
        const r = bz.mingGuaFromYear(y, g);
        assert.ok(r.rawNumber >= 1 && r.rawNumber <= 9 && r.rawNumber === mod9(r.rawNumber));
        assert.notEqual(r.guaNumberUsed, 5);
      }
    }
  });
  it('「和為 0 用 10」的陷阱: 2000 年男離女乾(不是 8、7)', () => {
    assert.equal(bz.mingGuaFromYear(2000, 'M').gua, '離');
    assert.equal(bz.mingGuaFromYear(2000, 'F').gua, '乾');
  });
  it('2043 女命為巽(速查表印成震是錯字)', () => {
    assert.equal(bz.mingGuaFromYear(2043, 'F').gua, '巽');
  });
  it('同一天干支年循環: 每 9 年男逆女順各回到同數', () => {
    for (let y = 1900; y < 2000; y += 1) {
      assert.equal(bz.mingGuaFromYear(y, 'M').rawNumber, bz.mingGuaFromYear(y + 9, 'M').rawNumber);
      assert.equal(bz.mingGuaFromYear(y, 'F').rawNumber, bz.mingGuaFromYear(y + 9, 'F').rawNumber);
    }
  });
});

describe('屬性測試: 宅卦', () => {
  it('8 扇區對 24 山歸卦: -370.0 到 730.0 度、0.1 度解析度,0 不符', () => {
    let n = 0;
    for (let t10 = -3700; t10 <= 7300; t10 += 1) {
      const facing = t10 / 10;
      const got = bz.zhaiFromFacing(facing);
      const want = oracleZhai(t10);
      if (got.gua !== want.gua || got.sitMountain !== want.sitMountain || got.facingMountain !== want.facingMountain) {
        assert.fail(`facing=${facing}: 引擎 ${got.gua}/${got.sitMountain}/${got.facingMountain},掃描 ${want.gua}/${want.sitMountain}/${want.facingMountain}`);
      }
      n += 1;
    }
    assert.equal(n, 11001);
  });
  it('宅卦 == 45 度公式 GUA[floor(((sit+22.5)%360)/45)]', () => {
    for (let t10 = 0; t10 < 3600; t10 += 1) {
      const facing = t10 / 10;
      const sit = (facing + 180) % 360;
      const want = GUA8[Math.floor(((sit + 22.5) % 360) / 45)];
      assert.equal(bz.zhaiFromFacing(facing).gua, want, `facing=${facing}`);
    }
  });
  it('對任意實數(含負值、>360、極端值)不回 undefined', () => {
    const probes = [-1e9, -720.5, -360, -300, -180.0001, -0, -0.0001, 0, 359.9999, 360, 360.0001, 719.9999, 1e6 + 0.3, 12345.678, 1e12];
    for (const x of probes) {
      const r = bz.zhaiFromFacing(x);
      assert.ok(GUA8.includes(r.gua), `facing=${x}`);
      assert.ok(r.group === 'east' || r.group === 'west');
      assert.ok(r.facingBearing >= 0 && r.facingBearing < 360);
      assert.ok(r.sitBearing >= 0 && r.sitBearing < 360);
      assert.ok(!Object.is(r.facingBearing, -0), '-0 不可外洩');
    }
    for (let i = 0; i < 2000; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 5000 - 2500;
      assert.ok(GUA8.includes(bz.zhaiFromFacing(x).gua), `facing=${x}`);
    }
  });
  it('sit(facing(x)) = normalize(x+180),對山 index+12(24 山)', () => {
    for (let x = -100; x < 460; x += 2.5) {
      const r = bz.zhaiFromFacing(x);
      assertAngle(r.sitBearing, geo.normalizeBearing(x + 180), 1e-9);
      assert.equal(geo.mountainIndex(r.sitMountain), (geo.mountainIndex(r.facingMountain) + 12) % 24);
    }
  });
  it('不合法輸入丟 INVALID_BEARING;未知山名丟 UNKNOWN_MOUNTAIN', () => {
    for (const bad of [NaN, Infinity, -Infinity, '180', null, undefined]) {
      throwsCode(() => bz.zhaiFromFacing(bad), 'INVALID_BEARING');
    }
    throwsCode(() => bz.zhaiFromSitMountain('X'), 'UNKNOWN_MOUNTAIN');
  });
});

describe('命宅配', () => {
  it('isMatch: 同組相配,64 格依 EAST/WEST 分組', () => {
    for (const a of GUA8) for (const b of GUA8) assert.equal(bz.isMatch(a, b), GUA_GROUP[a] === GUA_GROUP[b]);
    throwsCode(() => bz.isMatch('X', '坎'), 'UNKNOWN_GUA');
    throwsCode(() => bz.groupOf('中'), 'UNKNOWN_GUA');
  });
});

// ═══════════════════════════ E. 用途矩陣、財位序、三要 ═══════════════════════════

const GOOD4 = new Set(['生氣', '延年', '天醫', '伏位']);
const RATING_OK = ['best', 'good', 'ok'];
const RATING_BAD = ['avoid', 'worst'];

describe('八星用途矩陣(2.3.4)', () => {
  it('位置區與朝向區分開(D21): 灶座與灶口對同一星可以相反', () => {
    const g = bz.usageGuide('坎');
    assert.deepEqual(Object.keys(g), ['position', 'facing']);
    assert.deepEqual(Object.keys(g.position).sort(), ['door', 'living', 'masterBedroom', 'stoveSeat', 'toilet']);
    assert.deepEqual(Object.keys(g.facing).sort(), ['bedHead', 'desk', 'stoveMouth']);
    const at = (list, star) => list.find((x) => x.star === star);
    assert.equal(at(g.position.stoveSeat, '生氣').rating, 'avoid'); // 古法: 灶座壓生氣位不宜
    assert.equal(at(g.facing.stoveMouth, '生氣').rating, 'good'); // 灶口朝生氣位宜
    assert.equal(at(g.position.stoveSeat, '絕命').rating, 'good'); // 坐凶
    assert.equal(at(g.facing.stoveMouth, '絕命').rating, 'worst'); // 向吉
  });
  it('吉星宜開門安床設書桌灶口、凶星避免;廁所與灶座相反(規則面)', () => {
    for (const gua of GUA8) {
      const g = bz.usageGuide(gua);
      for (const [list, name] of [
        [g.position.door, 'door'],
        [g.position.masterBedroom, 'masterBedroom'],
        [g.facing.bedHead, 'bedHead'],
        [g.facing.desk, 'desk'],
        [g.facing.stoveMouth, 'stoveMouth'],
        [g.position.living, 'living'],
      ]) {
        assert.equal(list.length, 8, `${name} 應含 8 個方位`);
        for (const e of list) {
          const want = GOOD4.has(e.star) ? RATING_OK : RATING_BAD;
          assert.ok(want.includes(e.rating), `${gua}命 ${name} ${e.dir}(${e.star}) rating=${e.rating}`);
        }
      }
      for (const name of ['stoveSeat', 'toilet']) {
        const list = name === 'stoveSeat' ? g.position.stoveSeat : g.position.toilet;
        for (const e of list) {
          const want = GOOD4.has(e.star) ? RATING_BAD : ['good'];
          assert.ok(want.includes(e.rating), `${gua}命 ${name} ${e.dir}(${e.star}) rating=${e.rating}`);
        }
      }
    }
  });
  it('生氣是大門最佳與書桌首選、絕命大門大忌', () => {
    const g = bz.usageGuide('離');
    const at = (list, star) => list.find((x) => x.star === star).rating;
    assert.equal(at(g.position.door, '生氣'), 'best');
    assert.equal(at(g.position.door, '絕命'), 'worst');
    assert.equal(at(g.facing.desk, '生氣'), 'best');
    assert.equal(at(g.position.masterBedroom, '絕命'), 'worst');
  });
  it('客廳沙發魚缸: 四吉位不分先後(D22);開關才分東西四', () => {
    for (const gua of GUA8) {
      const g = bz.usageGuide(gua);
      const good = g.position.living.filter((e) => GOOD4.has(e.star));
      assert.equal(good.length, 4);
      assert.ok(good.every((e) => e.rating === 'good'), `${gua}命 四吉位應同級`);
    }
    const eastMing = bz.usageGuide('坎', { livingRoomGradeByEastWest: true }).position.living;
    const rate = (list, star) => list.find((e) => e.star === star).rating;
    assert.equal(rate(eastMing, '生氣'), 'best');
    assert.equal(rate(eastMing, '伏位'), 'best');
    assert.equal(rate(eastMing, '延年'), 'good');
    assert.equal(rate(eastMing, '天醫'), 'good');
    const westMing = bz.usageGuide('乾', { livingRoomGradeByEastWest: true }).position.living;
    assert.equal(rate(westMing, '延年'), 'best');
    assert.equal(rate(westMing, '天醫'), 'best');
    assert.equal(rate(westMing, '生氣'), 'good');
    assert.equal(rate(westMing, '伏位'), 'good');
    assert.ok(westMing.filter((e) => !GOOD4.has(e.star)).every((e) => e.rating === 'avoid'));
  });
  it('灶座少數派開關(D15): 吉位可放灶座,伏位仍避免,凶位不再稱宜', () => {
    const g = bz.usageGuide('坎', { stovePreferAuspicious: true }).position.stoveSeat;
    const r = (star) => g.find((e) => e.star === star).rating;
    for (const s of ['生氣', '延年', '天醫']) assert.equal(r(s), 'good', s);
    assert.equal(r('伏位'), 'avoid');
    for (const s of ['禍害', '六煞', '五鬼', '絕命']) assert.equal(r(s), 'avoid', s);
    assert.ok(g.every((e) => typeof e.note === 'string'));
  });
  it('排序: 依等級由好到差,同級依方位順序;8 個方位各出現一次', () => {
    const order = ['best', 'good', 'ok', 'avoid', 'worst'];
    for (const gua of GUA8) {
      const g = bz.usageGuide(gua);
      for (const list of [...Object.values(g.position), ...Object.values(g.facing)]) {
        assert.deepEqual(list.map((e) => e.dir).sort(), [...DIRS].sort());
        for (let i = 1; i < list.length; i += 1) {
          const a = order.indexOf(list[i - 1].rating);
          const b = order.indexOf(list[i].rating);
          assert.ok(a <= b, '等級排序');
          if (a === b) assert.ok(DIRS.indexOf(list[i - 1].dir) < DIRS.indexOf(list[i].dir), '同級依方位順序');
        }
        for (const e of list) assert.equal(e.star, bz.starAtDir(gua, e.dir));
      }
    }
  });
  it('床頭與書桌附用途說明(來源: 規格 2.3.4 表)', () => {
    const g = bz.usageGuide('坎');
    const note = (list, star) => list.find((e) => e.star === star).note;
    assert.match(note(g.facing.bedHead, '生氣'), /事業/);
    assert.match(note(g.facing.bedHead, '天醫'), /健康/);
    assert.match(note(g.facing.bedHead, '延年'), /感情/);
    assert.match(note(g.facing.desk, '延年'), /人際/);
  });
  it('USAGE_MATRIX 每格都有 rating/note 且 8 星齊全', () => {
    const uses = ['door', 'masterBedroom', 'stoveSeat', 'toilet', 'living', 'bedHead', 'desk', 'stoveMouth'];
    assert.deepEqual(Object.keys(bz.USAGE_MATRIX).sort(), [...uses].sort());
    for (const u of uses) {
      assert.deepEqual(Object.keys(bz.USAGE_MATRIX[u]).sort(), Object.keys(bz.STAR_ATTRS).sort(), u);
      for (const cell of Object.values(bz.USAGE_MATRIX[u])) {
        assert.ok(['best', 'good', 'ok', 'avoid', 'worst'].includes(cell.rating));
        assert.equal(typeof cell.note, 'string');
      }
    }
  });
  it('USAGE_MATRIX 的評級 == 規格 2.3.4 表的儲存格(唯一差異: D22 更正的客廳伏位)', () => {
    const spec = parseSpecUsageTable();
    assert.equal(Object.keys(spec).length, 8, '規格表應有 8 個星列');
    // 儲存格開頭的措辭 -> 評級;用途說明類的儲存格(事業、財運…)回傳 null,另外核對。
    const rank = (t) => {
      if (t.startsWith('最佳') || t.startsWith('首選')) return 'best';
      if (t.startsWith('大忌')) return 'worst';
      if (t.startsWith('尚可')) return 'ok';
      if (t.startsWith('不宜') || t.startsWith('忌') || t.startsWith('避免')) return 'avoid';
      if (t.startsWith('宜')) return 'good';
      return null;
    };
    const mismatches = [];
    for (const [star, row] of Object.entries(spec)) {
      for (const [use, cell] of Object.entries(row)) {
        const got = bz.USAGE_MATRIX[use][star].rating;
        const want = rank(cell);
        if (want === null) {
          // 用途說明: 吉星的床頭與書桌是「宜」類(伏位書桌為幼童用,尚可);禍害床頭是折衷睡向,仍屬避免
          if (use === 'bedHead' && star === '禍害') {
            assert.equal(got, 'avoid');
            assert.match(bz.USAGE_MATRIX[use][star].note, /折衷/);
          } else if (use === 'desk' && star === '伏位') assert.equal(got, 'ok', `${use}.${star}`);
          else assert.ok(GOOD4.has(star) && got === 'good', `${use}.${star}「${cell}」rating=${got}`);
        } else if (got !== want) mismatches.push([use, star, want, got]);
      }
    }
    // 規格表客廳伏位寫「尚可」,但同節 D22 更正為四吉位不分先後,以更正為準。
    assert.deepEqual(mismatches, [['living', '伏位', 'ok', 'good']]);
  });
  it('usageGuide 回傳拷貝', () => {
    const a = bz.usageGuide('坎');
    a.position.door[0].rating = 'worst';
    a.position.door.length = 0;
    assert.equal(bz.usageGuide('坎').position.door.length, 8);
    assert.equal(bz.usageGuide('坎').position.door[0].rating, 'best');
  });
  it('lookupUsage: 錯誤處理', () => {
    throwsCode(() => bz.lookupUsage('X', { bedHead: '東' }), 'UNKNOWN_GUA');
    throwsCode(() => bz.lookupUsage('坎', { bedHead: '中' }), 'UNKNOWN_DIR');
    throwsCode(() => bz.lookupUsage('坎', { sofa: '東' }), 'INVALID_OPTION');
    assert.deepEqual(bz.lookupUsage('坎', {}), {});
    assert.deepEqual(bz.lookupUsage('坎', { bedHead: '東' }), { bedHeadStar: '天醫' });
  });
});

describe('財位序(D19)', () => {
  const order = (gua, settings) => bz.wealthOrder(gua, settings);
  it('預設: 生氣、延年、天醫,伏位當備位', () => {
    assert.deepEqual(order('艮'), [
      { star: '生氣', dir: '西南' },
      { star: '延年', dir: '西' },
      { star: '天醫', dir: '西北' },
      { star: '伏位', dir: '東北', backup: true },
    ]);
  });
  it('tianyiFirst 對調延年與天醫', () => {
    assert.deepEqual(order('艮', { tianyiFirst: true }).map((x) => x.star), ['生氣', '天醫', '延年', '伏位']);
    const w = bz.starWeights({ tianyiFirst: true });
    assert.equal(w['天醫'], 0.75);
    assert.equal(w['延年'], 0.55);
  });
  it('每個命卦: 三財星方位與 8x8 表一致,且都是吉星', () => {
    for (const gua of GUA8) {
      const o = order(gua);
      assert.equal(o.length, 4);
      for (const e of o) assert.equal(bz.starAtDir(gua, e.dir), e.star);
      assert.equal(o[3].backup, true);
      assert.equal(o[3].star, '伏位');
      assert.equal(o[3].dir, DIR_OF_GUA[gua]);
    }
  });
  it('bazhaiStarWeights 物件覆寫個別權重並影響順序', () => {
    const o = order('坎', { bazhaiStarWeights: { 天醫: 0.9 } });
    assert.deepEqual(o.map((x) => x.star), ['生氣', '天醫', '延年', '伏位']);
    assert.equal(bz.starWeights({ bazhaiStarWeights: { 天醫: 0.9 } })['天醫'], 0.9);
    assert.equal(bz.starWeights({ bazhaiStarWeights: { 天醫: 0.9 } })['生氣'], 1.0);
  });
  it('權重設定不合法: INVALID_SETTING', () => {
    throwsCode(() => bz.starWeights({ bazhaiStarWeights: 'other' }), 'INVALID_SETTING');
    throwsCode(() => bz.starWeights({ bazhaiStarWeights: { 未知星: 1 } }), 'INVALID_SETTING');
    throwsCode(() => bz.starWeights({ bazhaiStarWeights: { 天醫: NaN } }), 'INVALID_SETTING');
    throwsCode(() => bz.starWeights({ bazhaiStarWeights: [1] }), 'INVALID_SETTING');
    throwsCode(() => bz.starWeights({ nortMode: 'true' }), 'INVALID_SETTING');
  });
  it('財位不建議灶座放生氣位(古法: 財產受損)', () => {
    for (const gua of GUA8) {
      const seat = bz.usageGuide(gua).position.stoveSeat;
      assert.equal(seat.find((e) => e.star === '生氣').rating, 'avoid');
    }
  });
});

describe('門主灶三要', () => {
  it('依命卦吉方計分: 三吉(生氣延年天醫)算吉,伏位另論不計', () => {
    // 坎命: 東南生氣、南延年、東天醫、北伏位、西南絕命
    const all = bz.threeKeys('坎', { door: '東南', master: '南', stove: '東' });
    assert.equal(all.count, 3);
    assert.equal(all.verdict, 'all');
    assert.deepEqual(all.stars, { door: '生氣', master: '延年', stove: '天醫' });
    assert.deepEqual(all.counted, { door: true, master: true, stove: true });
    const two = bz.threeKeys('坎', { door: '東南', master: '南', stove: '西南' });
    assert.equal(two.count, 2);
    assert.equal(two.verdict, 'two');
    const one = bz.threeKeys('坎', { door: '北', master: '西南', stove: '東南' });
    assert.equal(one.count, 1);
    assert.equal(one.verdict, 'one');
    assert.deepEqual(one.counted, { door: false, master: false, stove: true });
    const none = bz.threeKeys('坎', { door: '北', master: '西南', stove: '西' });
    assert.equal(none.count, 0);
    assert.equal(none.verdict, 'none');
    for (const r of [all, two, one, none]) assert.equal(typeof r.label, 'string');
  });
  it('避免恐嚇字眼(5.1 第 6 點)', () => {
    for (const p of [
      { door: '東南', master: '南', stove: '東' },
      { door: '北', master: '西南', stove: '西' },
    ]) {
      const r = bz.threeKeys('坎', p);
      assert.doesNotMatch(r.label, /大凶|絕嗣|克妻|敗財/);
    }
  });
  it('缺欄位或方位不合法丟錯', () => {
    throwsCode(() => bz.threeKeys('坎', { door: '東南', master: '南' }), 'INVALID_OPTION');
    throwsCode(() => bz.threeKeys('坎', { door: '東南', master: '南', stove: '中' }), 'UNKNOWN_DIR');
    throwsCode(() => bz.threeKeys('X', { door: '東南', master: '南', stove: '東' }), 'UNKNOWN_GUA');
  });
});

// ═══════════════════════════ F. analyzeBazhai ═══════════════════════════

const person = (over = {}) => ({
  id: 'p1',
  gender: 'F',
  birth: { local: '1990-05-15T10:30', utcOffset: '+08:00', timeKnown: true },
  role: 'breadwinner',
  ...over,
});
const inputOf = (over = {}) => ({ household: [person()], facing: { bazhai: 180 }, settings: {}, ...over });

describe('analyzeBazhai: 規格 2.3.1 範例', () => {
  it('輸入輸出與規格內嵌的範例逐欄一致', () => {
    const specIn = specJsonAfter('#### 2.3.1');
    const specOut = specJsonAfter('輸出(1990-05-15 出生女性');
    const out = bz.analyzeBazhai(specIn);
    assertDeepApprox(out, specOut, 0);
    assert.equal(out.meta.schema, 'fengshui.bazhai/1');
    assert.deepEqual(out.findings, []);
    assert.deepEqual(out.people[0].wealthOrder, specOut.people[0].wealthOrder);
  });
  it('範例輸入與 inputOf() 預設等價', () => {
    const specIn = specJsonAfter('#### 2.3.1');
    assert.deepEqual(bz.analyzeBazhai(specIn), bz.analyzeBazhai(inputOf({ settings: { yearBoundary: 'lichun_exact', coupleBasis: 'breadwinner' } })));
  });
});

describe('analyzeBazhai: 純函式性質', () => {
  it('不修改輸入(輸入深度凍結仍可執行)', () => {
    const inp = deepFreeze(
      inputOf({
        household: [person(), person({ id: 'p2', gender: 'M', role: 'wife', birth: { local: '1988-03-03T08:00', utcOffset: '+08:00', timeKnown: true } })],
        settings: { coupleBasis: 'averaged', tianyiFirst: true, bazhaiStarWeights: { 伏位: 0.3 } },
      }),
    );
    const before = clone(inp);
    bz.analyzeBazhai(inp);
    assert.deepEqual(clone(inp), before);
  });
  it('輸出 JSON 可序列化(來回一致,沒有 undefined/NaN/-0)', () => {
    for (const inp of [
      inputOf(),
      inputOf({ household: [] }),
      inputOf({ facing: { bazhai: -0 } }),
      inputOf({ facing: { bazhai: 20 }, settings: { showMinorityTechniques: true, showGuimenxian: true } }),
      inputOf({ household: [person({ birth: { local: '2000-02-04', utcOffset: '+08:00', timeKnown: false } })] }),
    ]) {
      const out = bz.analyzeBazhai(inp);
      assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
      const walk = (v) => {
        assert.notEqual(v, undefined);
        if (typeof v === 'number') assert.ok(Number.isFinite(v) && !Object.is(v, -0), `數值 ${v}`);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(out);
    }
  });
  it('決定性: 同輸入兩次輸出相等,且不共用內部物件', () => {
    const a = bz.analyzeBazhai(inputOf());
    const b = bz.analyzeBazhai(inputOf());
    assert.deepEqual(a, b);
    a.people[0].stars['北'] = 'X';
    a.house.stars['北'] = 'X';
    a.people[0].usage.position.door.length = 0;
    const c = bz.analyzeBazhai(inputOf());
    assert.deepEqual(c, b);
  });
  it('原始碼不含任何人的暱稱', () => {
    assert.doesNotMatch(SRC_TEXT, /帥哥|ENI/);
  });
});

describe('analyzeBazhai: 房屋與命宅配', () => {
  it('宅卦看「坐」: 坐北朝南=坎宅;facing 負值與 >360 先正規化', () => {
    const at = (f) => bz.analyzeBazhai({ household: [], facing: { bazhai: f } }).house;
    assert.equal(at(180).gua, '坎');
    assert.equal(at(180).facingMountain, '午');
    assert.equal(at(180).sitMountain, '子');
    assert.equal(at(-300).facingBearing, 60);
    assert.equal(at(-300).sitBearing, 240);
    assert.equal(at(-300).gua, '坤');
    assert.equal(at(540).gua, '坎');
    assert.equal(at(540).facingBearing, 180);
  });
  it('house.stars 用宅卦、people[].stars 用命卦(兩層,D14)', () => {
    const out = bz.analyzeBazhai(inputOf());
    assert.deepEqual(out.house.stars, bz.starsOf('坎'));
    assert.deepEqual(out.people[0].stars, bz.starsOf('艮'));
    assert.notDeepEqual(out.house.stars, out.people[0].stars);
    assert.deepEqual(Object.keys(out.house.stars), DIRS);
  });
  it('命宅相配 vs 不配的建議文字(依命不依宅,D16)', () => {
    const mismatch = bz.analyzeBazhai(inputOf());
    assert.equal(mismatch.match.policy, 'mingOverHouse');
    assert.equal(mismatch.match.byPerson.p1, false);
    assert.match(mismatch.match.advice, /以個人命卦重排床頭、書桌、灶口的吉方/);
    assert.match(mismatch.match.advice, /門、主臥、灶口三項中有一項落在吉方/);
    // 1990 女 艮命(西四);向 0 → 坐 180 → 離宅... 改坐 225(坤宅,西四)才相配
    const ok = bz.analyzeBazhai(inputOf({ facing: { bazhai: 45 } }));
    assert.equal(ok.house.gua, '坤');
    assert.equal(ok.match.byPerson.p1, true);
    assert.doesNotMatch(ok.match.advice, /重排/);
    assert.equal(typeof ok.match.advice, 'string');
    assert.ok(ok.match.advice.length > 0);
  });
  it('bazhaiFacingBasis: door 用 facing.bazhai、house 用 facing.xuankong(D08)', () => {
    const both = { bazhai: 180, xuankong: 90 };
    assert.equal(bz.analyzeBazhai(inputOf({ facing: both })).house.gua, '坎');
    const h = bz.analyzeBazhai(inputOf({ facing: both, settings: { bazhaiFacingBasis: 'house' } }));
    assert.equal(h.house.facingBearing, 90);
    assert.equal(h.house.gua, bz.zhaiFromFacing(90).gua);
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { bazhaiFacingBasis: 'house' } })), 'MISSING_FACING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ facing: { xuankong: 90 } })), 'MISSING_FACING');
  });
  it('接近八卦分界時提示宅卦可能是 A 宅或 B 宅', () => {
    // 向 20 → 坐 200 → 離宅,距坤宅分界 2.5 度
    const out = bz.analyzeBazhai(inputOf({ household: [], facing: { bazhai: 20 } }));
    assert.equal(out.house.gua, '離');
    assert.equal(out.house.boundary.nearGuaBoundary, true);
    assert.equal(out.house.boundary.otherGua, '坤');
    assert.ok(Math.abs(out.house.boundary.distDeg - 2.5) < 1e-9);
    const f = out.findings.find((x) => x.id === 'bz.house.near_gua_boundary');
    assert.ok(f, '應有接近分界的提示');
    assert.match(f.body, /離宅/);
    assert.match(f.body, /坤宅/);
    assert.ok(out.meta.warnings.includes('nearGuaBoundary'));
    // 正中與山界(同卦內)都不提示
    for (const facing of [180, 172]) {
      const o = bz.analyzeBazhai(inputOf({ household: [], facing: { bazhai: facing } }));
      assert.equal(o.house.boundary.nearGuaBoundary, false, `facing=${facing}`);
      assert.equal(o.house.boundary.otherGua, null);
      assert.equal(o.findings.find((x) => x.id === 'bz.house.near_gua_boundary'), undefined);
    }
    // 恰在界線上: 半開區間歸順時針下一卦(坤宅),提示另一側是離宅
    const line = bz.analyzeBazhai(inputOf({ household: [], facing: { bazhai: 22.5 } }));
    assert.equal(line.house.gua, '坤');
    assert.equal(line.house.boundary.otherGua, '離');
    assert.equal(line.house.boundary.onLine, true);
    assert.match(line.findings[0].body, /分界線/);
  });
  it('不確定度越小,提示範圍越小(下限 3 度)', () => {
    const near = (facing, u) =>
      bz.analyzeBazhai(inputOf({ household: [], facing: { bazhai: facing }, settings: { measureUncertainty: u } })).house.boundary.nearGuaBoundary;
    assert.equal(near(18, 5), true); // 距界 4.5 < 5
    assert.equal(near(18, 3), false); // 4.5 >= max(3,3)
    assert.equal(near(20, 0), true); // 2.5 < 下限 3
  });
  it('household 為空: 只回房屋', () => {
    const out = bz.analyzeBazhai({ household: [], facing: { bazhai: 180 } });
    assert.deepEqual(out.people, []);
    assert.deepEqual(out.match.byPerson, {});
    assert.equal(out.match.anchorId, null);
    assert.equal(out.house.gua, '坎');
    assert.equal(typeof out.match.advice, 'string');
  });
});

describe('analyzeBazhai: 命卦旗標與年界', () => {
  const at = (local, over = {}, settings = {}, gender = 'M') =>
    bz.analyzeBazhai(
      inputOf({ household: [person({ gender, birth: { local, utcOffset: '+08:00', timeKnown: true, ...over } })], settings }),
    );
  it('立春前後 2 分鐘內: nearLichun,兩年結果都列出並有臨界提示', () => {
    // 2000 立春 20:40:22;20:41 在其後 38 秒
    const out = at('2000-02-04T20:41');
    const m = out.people[0].ming;
    assert.equal(m.effectiveYear, 2000);
    assert.equal(m.gua, '離');
    assert.equal(m.flags.nearLichun, true);
    assert.equal(m.flags.dateIsLichunDay, false);
    assert.deepEqual(m.flags.alternatives.map((a) => [a.side, a.effectiveYear, a.gua]), [
      ['beforeLichun', 1999, '坎'],
      ['afterLichun', 2000, '離'],
    ]);
    assert.ok(out.meta.warnings.includes('nearLichun'));
    const f = out.findings.find((x) => x.id === 'bz.ming.near_lichun');
    assert.ok(f);
    assert.equal(f.subject, 'p1');
    assert.match(f.body, /坎/);
    assert.match(f.body, /離/);
    // 3 分鐘以外不是臨界
    const far = at('2000-02-04T20:45');
    assert.equal(far.people[0].ming.flags.nearLichun, false);
    assert.deepEqual(far.people[0].ming.flags.alternatives, []);
    assert.equal(far.findings.length, 0);
  });
  it('立春日不知時刻: dateIsLichunDay 與兩種結果(B.1)', () => {
    const m = bz.analyzeBazhai(inputOf({ household: [person({ gender: 'F', birth: { local: '2000-02-04', utcOffset: '+08:00', timeKnown: false } })] })).people[0].ming;
    assert.equal(m.flags.dateIsLichunDay, true);
    assert.equal(m.flags.nearLichun, false);
    assert.deepEqual(m.flags.alternatives.map((a) => [a.side, a.effectiveYear, a.gua, a.rawNumber]), [
      ['beforeLichun', 1999, '艮', 5],
      ['afterLichun', 2000, '乾', 6],
    ]);
    const out = bz.analyzeBazhai(inputOf({ household: [person({ gender: 'M', birth: { local: '2000-02-04', utcOffset: '+08:00', timeKnown: false } })] }));
    assert.deepEqual(out.people[0].ming.flags.alternatives.map((a) => a.gua), ['坎', '離']);
    assert.ok(out.findings.some((x) => x.id === 'bz.ming.lichun_day'));
    assert.ok(out.meta.warnings.includes('dateIsLichunDay'));
    // 非立春日不知時刻: 沒有旗標
    const plain = bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: '2000-03-04', utcOffset: '+08:00', timeKnown: false } })] })).people[0].ming;
    assert.equal(plain.flags.dateIsLichunDay, false);
    assert.deepEqual(plain.flags.alternatives, []);
  });
  it('timeKnown=false 時忽略 local 內帶的時分', () => {
    const a = bz.mingGuaFromBirth({ local: '2000-02-04T23:30', utcOffset: '+08:00', timeKnown: false }, 'M');
    const b = bz.mingGuaFromBirth({ local: '2000-02-04', utcOffset: '+08:00', timeKnown: false }, 'M');
    assert.deepEqual(a, b);
  });
  it('1938-1945 台灣 +09:00: 先換算成 UTC+8 再比立春(B.1)', () => {
    // 1940 立春 07:07 CST;08:00+09:00 = 07:00 CST,在立春之前 → 1939
    const early = (offset) => bz.mingGuaFromBirth({ local: '1940-02-05T08:00', utcOffset: offset, timeKnown: true }, 'M');
    assert.equal(early('+09:00').effectiveYear, 1939);
    assert.equal(early('+09:00').gua, '兌');
    assert.equal(bz.mingGuaFromBirth({ local: '1940-02-05T08:00', utcOffset: '+09:00', timeKnown: true }, 'F').gua, '艮');
    assert.equal(early('+08:00').effectiveYear, 1940, '若誤當 +08:00 會得 1940');
    const late = bz.mingGuaFromBirth({ local: '1940-02-05T08:30', utcOffset: '+09:00', timeKnown: true }, 'M');
    assert.equal(late.effectiveYear, 1940);
    assert.equal(late.gua, '乾');
    assert.equal(bz.mingGuaFromBirth({ local: '1940-02-05T08:30', utcOffset: '+09:00', timeKnown: true }, 'F').gua, '離');
    // 時區換算用 calendar 的 tzdata 查詢,台灣這 8 年剛好是 +09:00
    assert.equal(calendar.utcOffsetFor('1940-02-05T08:00'), '+09:00');
    assert.equal(calendar.utcOffsetFor('1946-02-05T08:00'), '+08:00');
  });
  it('yearBoundary 各制式(2000-02-04T20:39 男): exact 1999 / date_only 2000 / fixed_feb4 2000 / jan1 2000', () => {
    const y = (b) => at('2000-02-04T20:39', {}, { yearBoundary: b }).people[0].ming.effectiveYear;
    assert.equal(y('lichun_exact'), 1999);
    assert.equal(y('lichun_date_only'), 2000);
    assert.equal(y('fixed_feb4'), 2000);
    assert.equal(y('gregorian_jan1'), 2000);
    assert.equal(bz.analyzeBazhai(inputOf({ household: [person({ gender: 'M', birth: { local: '2000-02-04T20:39', utcOffset: '+08:00', timeKnown: true } })] })).meta.ruleset.yearBoundary, 'lichun_exact');
  });
  it('lunar_new_year 沒有農曆解析器就丟 LUNAR_LIBRARY_REQUIRED;解析器回傳格式錯誤丟 INVALID_LUNAR_NEW_YEAR', () => {
    throwsCode(() => at('2000-02-04T20:39', {}, { yearBoundary: 'lunar_new_year' }), 'LUNAR_LIBRARY_REQUIRED');
    const inp = inputOf({ household: [person({ gender: 'M' })], settings: { yearBoundary: 'lunar_new_year' } });
    throwsCode(() => bz.analyzeBazhai(inp, { lunarNewYearOf: () => '2000/02/05' }), 'INVALID_LUNAR_NEW_YEAR');
    const out = bz.analyzeBazhai(inputOf({ household: [person({ gender: 'M', birth: { local: '2000-02-04T23:30', utcOffset: '+08:00', timeKnown: true } })], settings: { yearBoundary: 'lunar_new_year' } }), { lunarNewYearOf: () => '2000-02-05' });
    assert.equal(out.people[0].ming.effectiveYear, 1999);
  });
  it('出生年超出精確計算範圍: approx 旗標與提示', () => {
    const old = at('1850-06-01T12:00');
    assert.equal(old.people[0].ming.approx, true);
    assert.ok(old.meta.warnings.includes('approxRange'));
    assert.ok(old.findings.some((x) => x.id === 'bz.ming.approx'));
    assert.equal(old.people[0].ming.effectiveYear, 1850);
    assert.equal(at('2200-06-01T12:00').people[0].ming.approx, true);
    const normal = at('1990-06-01T12:00');
    assert.equal(normal.people[0].ming.approx, false);
    assert.ok(!normal.meta.warnings.includes('approxRange'));
  });
  it('封閉式在極端年份仍成立(1700-2399 命卦與掌訣一致)', () => {
    for (const y of [1700, 1799, 2399]) {
      assert.equal(bz.mingGuaFromYear(y, 'M').gua, palmMingGua(y, 'M').gua);
    }
  });
});

describe('analyzeBazhai: 多人家庭(2.3.5)', () => {
  // 丈夫 1988 男 → 震(東四);妻子 1990 女 → 艮(西四);向 180 → 坎宅(東四)
  const husband = (over = {}) => person({ id: 'h', gender: 'M', role: 'husband', birth: { local: '1988-03-03T08:00', utcOffset: '+08:00', timeKnown: true }, ...over });
  const wife = (over = {}) => person({ id: 'w', gender: 'F', role: 'wife', ...over });
  const run = (household, coupleBasis) => bz.analyzeBazhai(inputOf({ household, settings: { coupleBasis } }));

  it('命卦組別與命宅配', () => {
    const out = run([husband(), wife()], 'breadwinner');
    assert.equal(out.people[0].ming.gua, '震');
    assert.equal(out.people[1].ming.gua, '艮');
    assert.deepEqual(out.match.byPerson, { h: true, w: false });
    assert.equal(out.match.mixed, true);
    assert.equal(out.meta.ruleset.coupleBasis, 'breadwinner');
    assert.ok(out.findings.some((x) => x.id === 'bz.household.mixed'));
  });
  it('breadwinner: 大門看主要收入者,睡向照顧與宅組別不同的一方', () => {
    const out = run([husband({ role: 'breadwinner' }), wife()], 'breadwinner');
    assert.equal(out.match.anchorId, 'h');
    assert.equal(out.match.sleepCareId, 'w');
    const out2 = run([husband(), wife({ role: 'breadwinner' })], 'breadwinner');
    assert.equal(out2.match.anchorId, 'w');
    assert.equal(out2.match.sleepCareId, 'w');
  });
  it('wife / husband: 錨定該方,睡向同錨', () => {
    const w = run([husband(), wife()], 'wife');
    assert.equal(w.match.anchorId, 'w');
    assert.equal(w.match.sleepCareId, 'w');
    const h = run([husband(), wife()], 'husband');
    assert.equal(h.match.anchorId, 'h');
    assert.equal(h.match.sleepCareId, 'h');
    // 沒標 role 時依性別找
    const g = run([person({ id: 'a', gender: 'F', role: undefined }), person({ id: 'b', gender: 'M', role: undefined, birth: { local: '1988-03-03T08:00', utcOffset: '+08:00', timeKnown: true } })], 'husband');
    assert.equal(g.match.anchorId, 'b');
  });
  it('holderOnly: 只看戶主,其他成員的命宅配不列入判斷', () => {
    const out = run([husband({ role: 'holder' }), wife()], 'holderOnly');
    assert.equal(out.match.anchorId, 'h');
    assert.deepEqual(out.match.consideredIds, ['h']);
    assert.equal(out.match.byPerson.w, false, 'byPerson 仍如實列出');
    assert.doesNotMatch(out.match.advice, /重排/, '戶主相配,不必重排');
    const out2 = run([husband(), wife({ role: 'holder' })], 'holderOnly');
    assert.deepEqual(out2.match.consideredIds, ['w']);
    assert.match(out2.match.advice, /重排/);
  });
  it('averaged: 沒有單一錨,依各人星權重平均排序 8 個方位', () => {
    const out = run([husband(), wife()], 'averaged');
    assert.equal(out.match.anchorId, null);
    assert.equal(out.match.sleepCareId, null);
    const c = out.match.combined;
    assert.equal(c.length, 8);
    assert.deepEqual(c.map((x) => x.dir).sort(), [...DIRS].sort());
    const attrs = parseSpecStarAttrs();
    for (const e of c) {
      const sh = bz.starAtDir('震', e.dir);
      const sw = bz.starAtDir('艮', e.dir);
      assert.deepEqual(e.stars, { h: sh, w: sw });
      assert.ok(Math.abs(e.score - (attrs[sh].weight + attrs[sw].weight) / 2) < 1e-12, `${e.dir} 分數`);
    }
    for (let i = 1; i < c.length; i += 1) assert.ok(c[i - 1].score >= c[i].score, '由高到低');
    // 非 averaged 模式不輸出 combined
    assert.equal(run([husband(), wife()], 'wife').match.combined, null);
  });
  it('沒有對應角色時退回第一位並警示(anchorFallback)', () => {
    const out = run([person({ id: 'a', role: undefined }), person({ id: 'b', role: undefined, birth: { local: '1988-03-03T08:00', utcOffset: '+08:00', timeKnown: true }, gender: 'M' })], 'holderOnly');
    assert.equal(out.match.anchorId, 'a');
    assert.ok(out.meta.warnings.includes('anchorFallback'));
    // 單人不警示
    assert.ok(!bz.analyzeBazhai(inputOf({ household: [person({ role: undefined })] })).meta.warnings.includes('anchorFallback'));
  });
  it('同組家人: mixed=false,沒有分組提示', () => {
    const out = run([husband(), wife({ birth: { local: '1988-03-03T08:00', utcOffset: '+08:00', timeKnown: true } })], 'breadwinner');
    assert.equal(out.people[1].ming.gua, '震');
    assert.equal(out.match.mixed, false);
    assert.ok(!out.findings.some((x) => x.id === 'bz.household.mixed'));
  });
  it('每種 coupleBasis 的分組提示都寫明目前採用的做法', () => {
    const want = { breadwinner: /主要收入者/, wife: /妻子/, husband: /丈夫/, holderOnly: /戶主/, averaged: /平均/ };
    for (const [basis, re] of Object.entries(want)) {
      const f = run([husband({ role: 'holder' }), wife()], basis).findings.find((x) => x.id === 'bz.household.mixed');
      assert.ok(f, basis);
      assert.match(f.body, re, basis);
    }
  });
  it('threeKeys: 只在提供 placements 時輸出,以各人命卦計分', () => {
    assert.equal(bz.analyzeBazhai(inputOf()).people[0].threeKeys, null);
    const out = bz.analyzeBazhai(inputOf({ household: [husband(), wife()], placements: { door: '東', master: '南', stove: '東南' } }));
    assert.deepEqual(out.people[0].threeKeys, bz.threeKeys('震', { door: '東', master: '南', stove: '東南' }));
    assert.deepEqual(out.people[1].threeKeys, bz.threeKeys('艮', { door: '東', master: '南', stove: '東南' }));
    throwsCode(() => bz.analyzeBazhai(inputOf({ placements: { door: '東' } })), 'INVALID_OPTION');
    throwsCode(() => bz.analyzeBazhai(inputOf({ placements: 'x' })), 'INVALID_OPTION');
  });
});

describe('analyzeBazhai: 設定與少數派', () => {
  const findingIds = (out) => out.findings.map((f) => f.id);
  it('預設不顯示少數派技法與鬼門線(D17、D18、D20)', () => {
    const out = bz.analyzeBazhai(inputOf({ facing: { bazhai: 180 } }));
    assert.ok(!findingIds(out).some((id) => id.startsWith('bz.minority')));
  });
  it('showMinorityTechniques: 五鬼運財與桃花位標少數派、低信心', () => {
    const out = bz.analyzeBazhai(inputOf({ settings: { showMinorityTechniques: true } }));
    const wugui = out.findings.find((f) => f.id === 'bz.minority.wugui_yuncai');
    const taohua = out.findings.find((f) => f.id === 'bz.minority.taohua');
    for (const f of [wugui, taohua]) {
      assert.ok(f);
      assert.equal(f.tag, 'minority');
      assert.equal(f.confidence, 'low');
      assert.match(f.body, /少數/);
      assert.equal(typeof f.schoolNote, 'string');
    }
    assert.match(taohua.body, /六煞/);
    assert.match(taohua.body, /延年/);
    assert.match(wugui.body, /預設/);
    assert.ok(!findingIds(out).includes('bz.minority.guimenxian'));
  });
  it('showGuimenxian 獨立於 showMinorityTechniques', () => {
    const out = bz.analyzeBazhai(inputOf({ settings: { showGuimenxian: true } }));
    const f = out.findings.find((x) => x.id === 'bz.minority.guimenxian');
    assert.ok(f);
    assert.equal(f.tag, 'minority');
    assert.equal(f.confidence, 'low');
    assert.ok(!findingIds(out).includes('bz.minority.wugui_yuncai'));
  });
  it('meta.ruleset 原樣回存實際使用的相關設定', () => {
    const settings = {
      yearBoundary: 'lichun_date_only',
      bazhaiFacingBasis: 'house',
      coupleBasis: 'wife',
      tianyiFirst: true,
      stovePreferAuspicious: true,
      livingRoomGradeByEastWest: true,
      showMinorityTechniques: true,
      showGuimenxian: true,
      measureUncertainty: 2,
      bazhaiStarWeights: { 伏位: 0.4 },
    };
    const out = bz.analyzeBazhai(inputOf({ facing: { bazhai: 180, xuankong: 180 }, settings }));
    for (const [k, v] of Object.entries(settings)) assert.deepEqual(out.meta.ruleset[k], v, k);
    for (const k of Object.keys(out.meta.ruleset)) assert.ok(k in DEFAULT_SETTINGS, `ruleset 出現未知鍵 ${k}`);
    const dflt = bz.analyzeBazhai(inputOf());
    for (const k of Object.keys(dflt.meta.ruleset)) assert.deepEqual(dflt.meta.ruleset[k], DEFAULT_SETTINGS[k], k);
    assert.ok(dflt.meta.ruleset.yearBoundary);
    assert.ok(Array.isArray(dflt.meta.warnings));
  });
  it('設定影響輸出: tianyiFirst 改財位序,stovePreferAuspicious/livingRoom 改用途評級', () => {
    const base = bz.analyzeBazhai(inputOf());
    const t = bz.analyzeBazhai(inputOf({ settings: { tianyiFirst: true } }));
    assert.deepEqual(base.people[0].wealthOrder.map((x) => x.star), ['生氣', '延年', '天醫', '伏位']);
    assert.deepEqual(t.people[0].wealthOrder.map((x) => x.star), ['生氣', '天醫', '延年', '伏位']);
    const stove = bz.analyzeBazhai(inputOf({ settings: { stovePreferAuspicious: true } }));
    const seat = (o) => o.people[0].usage.position.stoveSeat.find((e) => e.star === '天醫').rating;
    assert.equal(seat(base), 'avoid');
    assert.equal(seat(stove), 'good');
    assert.deepEqual(base.people[0].usage, bz.usageGuide('艮'));
    assert.deepEqual(base.house.usage, bz.usageGuide('坎'));
  });
  it('所有 Finding 符合共通形狀且不用恐嚇字眼(5.1 第 6 點)', () => {
    const out = bz.analyzeBazhai(
      inputOf({
        household: [
          person({ birth: { local: '2000-02-04T20:41', utcOffset: '+08:00', timeKnown: true } }),
          person({ id: 'p2', gender: 'M', birth: { local: '1850-01-01T00:00', utcOffset: '+08:00', timeKnown: true } }),
          person({ id: 'p3', gender: 'M', birth: { local: '2000-02-04', utcOffset: '+08:00', timeKnown: false } }),
        ],
        facing: { bazhai: 20 },
        settings: { showMinorityTechniques: true, showGuimenxian: true },
      }),
    );
    assert.ok(out.findings.length >= 6);
    const ids = new Set();
    for (const f of out.findings) {
      assert.ok(['info', 'note', 'caution'].includes(f.level), f.id);
      assert.ok(['high', 'medium', 'low'].includes(f.confidence), f.id);
      assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag), f.id);
      for (const k of ['id', 'title', 'body']) assert.ok(typeof f[k] === 'string' && f[k].length > 0, `${f.id}.${k}`);
      assert.ok(f.schoolNote === null || typeof f.schoolNote === 'string');
      assert.ok(Array.isArray(f.refs));
      assert.ok(f.subject === null || typeof f.subject === 'string');
      assert.doesNotMatch(`${f.title}${f.body}${f.schoolNote ?? ''}`, /大凶|絕嗣|克妻|敗財|換屋/, f.id);
      assert.match(f.id, /^bz\./);
      ids.add(`${f.id}#${f.subject}`);
    }
    assert.equal(ids.size, out.findings.length, '同 id 同對象的 Finding 不可重複');
    for (const w of out.meta.warnings) assert.ok(['nearLichun', 'dateIsLichunDay', 'approxRange', 'nearGuaBoundary', 'anchorFallback'].includes(w), w);
    assert.equal(new Set(out.meta.warnings).size, out.meta.warnings.length, 'warnings 不重複');
  });
});

describe('analyzeBazhai: 輸入驗證(錯誤碼)', () => {
  it('input 與 household', () => {
    for (const bad of [null, undefined, 5, 'x', []]) throwsCode(() => bz.analyzeBazhai(bad), 'INVALID_INPUT');
    throwsCode(() => bz.analyzeBazhai({ facing: { bazhai: 180 } }), 'INVALID_HOUSEHOLD');
    throwsCode(() => bz.analyzeBazhai({ household: 'x', facing: { bazhai: 180 } }), 'INVALID_HOUSEHOLD');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [null] })), 'INVALID_HOUSEHOLD');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ id: '' })] })), 'INVALID_HOUSEHOLD');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person(), person()] })), 'DUPLICATE_PERSON_ID');
  });
  it('性別、角色、出生時刻', () => {
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ gender: 'X' })] })), 'INVALID_GENDER');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ gender: undefined })] })), 'INVALID_GENDER');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ role: 'boss' })] })), 'INVALID_ROLE');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: undefined })] })), 'INVALID_BIRTH');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: 5, utcOffset: '+08:00' } })] })), 'INVALID_BIRTH');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: '1990-05-15T10:30' } })] })), 'MISSING_UTC_OFFSET');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: '1990-02-30T10:30', utcOffset: '+08:00' } })] })), 'INVALID_LOCAL_TIME');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: '1990-05-15T10:30', utcOffset: '八點' } })] })), 'INVALID_UTC_OFFSET');
    throwsCode(() => bz.analyzeBazhai(inputOf({ household: [person({ birth: { local: '1990-05-15T10:30', utcOffset: '+08:00', timeKnown: 'yes' } })] })), 'INVALID_BIRTH');
    throwsCode(() => bz.mingGuaFromYear(1990.5, 'M'), 'INVALID_YEAR');
    throwsCode(() => bz.mingGuaFromYear(NaN, 'M'), 'INVALID_YEAR');
    throwsCode(() => bz.mingGuaFromYear('1990', 'M'), 'INVALID_YEAR');
    throwsCode(() => bz.mingGuaFromYear(1990, 'male'), 'INVALID_GENDER');
  });
  it('facing', () => {
    throwsCode(() => bz.analyzeBazhai({ household: [] }), 'INVALID_FACING');
    throwsCode(() => bz.analyzeBazhai({ household: [], facing: 180 }), 'INVALID_FACING');
    throwsCode(() => bz.analyzeBazhai({ household: [], facing: {} }), 'MISSING_FACING');
    for (const bad of [NaN, Infinity, '180', null]) {
      throwsCode(() => bz.analyzeBazhai({ household: [], facing: { bazhai: bad } }), 'INVALID_BEARING');
    }
  });
  it('settings 與 opts', () => {
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { nortMode: 'true' } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { yearBoundary: 'chinese' } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { coupleBasis: 'boss' } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { bazhaiFacingBasis: 'window' } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { tianyiFirst: 'yes' } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: { measureUncertainty: -1 } })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf({ settings: 'x' })), 'INVALID_SETTING');
    throwsCode(() => bz.analyzeBazhai(inputOf(), { foo: 1 }), 'INVALID_OPTION');
    throwsCode(() => bz.analyzeBazhai(inputOf(), { lunarNewYearOf: 5 }), 'INVALID_OPTION');
    throwsCode(() => bz.analyzeBazhai(inputOf(), null), 'INVALID_OPTION');
  });
  it('星表查詢的錯誤碼', () => {
    throwsCode(() => bz.starsOf('中'), 'UNKNOWN_GUA');
    throwsCode(() => bz.starOf('坎', 'X'), 'UNKNOWN_GUA');
    throwsCode(() => bz.starAtDir('坎', '中'), 'UNKNOWN_DIR');
    throwsCode(() => bz.starAtDir('X', '北'), 'UNKNOWN_GUA');
  });
});

describe('跨模組一致性', () => {
  it('bazhai 讀到的卦與方位名與 geo 一致(24 山 -> 宅卦)', () => {
    for (const m of geo.MOUNTAINS) {
      const z = bz.zhaiFromSitMountain(m.name);
      assert.equal(z.gua, m.gua);
      assert.equal(z.sitMountain, m.name);
      assert.equal(z.facingMountain, geo.oppositeOf(m.name));
      assert.equal(z.sitDir, geo.dirOfGua(m.gua));
    }
    assert.deepEqual(GUA8, [...geo.GUA]);
    assert.deepEqual(DIRS, [...geo.DIR8]);
  });
  it('立春/年界一律走 calendar: bazhai 的 effectiveYear 對應 calendar.fengshuiYear', () => {
    for (const local of ['2000-02-04T20:39', '2000-02-04T20:41', '2024-02-04T16:26', '2024-02-04T16:28', '2025-02-03T22:12', '1984-02-04T23:00']) {
      const ms = calendar.toInstant({ local, utcOffset: '+08:00' });
      const got = bz.mingGuaFromBirth({ local, utcOffset: '+08:00', timeKnown: true }, 'M');
      assert.equal(got.effectiveYear, calendar.fengshuiYear(ms), local);
    }
  });
});

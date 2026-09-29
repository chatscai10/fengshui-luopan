// luopan 模組測試: luopan_rings.json 72 案(其中 24 案屬 geo,這裡也經由 RINGS/readout 讀一遍)、
// 規格 4.4 的 luopan 屬性測試、4.2 第 3 點突變測試、第 6 點「規則重算 == 內嵌表」。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFixture, circDiff, assertApprox, assertAngle, assertDeepApprox, isSoft, assertRunnerCatches,
} from './helpers/harness.js';
import * as H from './helpers/luopan.js';
import * as geo from '../src/core/geo.js';
import * as cal from '../src/core/calendar.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import * as lp from '../src/core/luopan.js';

const fx = loadFixture('luopan_rings');
const caseOf = (name) => fx.cases.find((c) => c.name === name) ?? assert.fail(`luopan_rings.json 缺案例 ${name}`);
const clone = H.clone;
const cellsOf = (id) => lp.ringById(id).cells;
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
/** 半開區間 [start,end) 是否含 b(獨立寫一份;end=360 視為圓周終點)。 */
const contains = (cell, b) => (cell.startDeg < cell.endDeg ? b >= cell.startDeg && b < cell.endDeg : b >= cell.startDeg || b < cell.endDeg);
const sorted = (a) => [...a].sort();

// ═══════════════════════════ A. luopan_rings.json 的 runner ═══════════════════════════

const PLATE_ID = { 地盤正針: 'mountains24', 人盤中針: 'ren_plate', 天盤縫針: 'tian_plate' };
const TOL4 = 6e-5; // fixtures 的角度、弧度以 4 位小數存放

/** 由十二次粗表(宿 → 地支)反轉出 宿 → 地支。 */
function invertCoarseTable(sourceTable) {
  const out = {};
  for (const [branch, names] of Object.entries(sourceTable)) for (const ch of names) out[ch] = branch;
  return out;
}

const LUOPAN_RUNNERS = [
  // ── 24 山、八卦、洛書(屬 geo 的案例,這裡經由 RINGS 與 readout 再讀一遍) ──
  [/^mountains24_geometry$/, (c) => {
    const cells = cellsOf('mountains24');
    assert.equal(cells.length, 24);
    for (const e of c.expected) {
      const m = cells[e.index];
      assert.equal(m.name, e.name);
      assert.equal(m.index, e.index);
      assert.equal(m.centerDeg, e.center);
      assertAngle(m.startDeg, e.start, 1e-9, `${e.name} start`);
      assertAngle(m.endDeg, e.end, 1e-9, `${e.name} end`);
      assert.equal(m.gua, e.palace, `${e.name} 宮`);
      assert.equal(m.dragon, e.yuan, `${e.name} 元龍`);
      assert.equal(m.kind, e.kind, `${e.name} 類別`);
    }
  }],
  [/^mountains24_sanyuan_yinyang$/, (c) => {
    for (const [name, yy] of Object.entries(c.expected.by_mountain)) assert.equal(lp.yinyangOf(name, 'sanyuan'), yy, name);
    assert.deepEqual(sorted(cellsOf('mountains24').filter((m) => m.yinyangSanyuan === '陽').map((m) => m.name)), sorted(c.expected.yang));
    assert.deepEqual(sorted(cellsOf('mountains24').filter((m) => m.yinyangSanyuan === '陰').map((m) => m.name)), sorted(c.expected.yin));
  }],
  [/^mountains24_sanhe_red_black$/, (c) => {
    for (const name of c.expected.red_yang) assert.equal(lp.yinyangOf(name, 'sanhe'), '陽', `${name} 紅字`);
    for (const name of c.expected.black_yin) assert.equal(lp.yinyangOf(name, 'sanhe'), '陰', `${name} 黑字`);
    assert.equal(c.expected.red_yang.length + c.expected.black_yin.length, 24);
  }],
  [/^mountains24_wuxing$/, (c) => {
    const cells = cellsOf('mountains24');
    for (const [name, wx] of Object.entries(c.expected.own)) assert.equal(cells.find((m) => m.name === name).wuxing, wx, `${name} 本五行`);
    for (const [name, wx] of Object.entries(c.expected.by_palace)) assert.equal(cells.find((m) => m.name === name).wuxingPalace, wx, `${name} 依宮`);
  }],
  [/^bagua_houtian_ring$/, (c) => {
    const cells = cellsOf('bagua');
    for (const e of c.expected) {
      const cell = cells.find((x) => x.gua === e.name);
      assert.equal(cell.centerDeg, e.bearing, `${e.name} 方位`);
      assert.equal(cell.luoshu, e.luoshu);
      assert.equal(cell.wuxing, e.wuxing);
      assert.deepEqual([...cell.linesHoutian], e.houtian_lines_bottom_to_top);
      assert.equal(cell.unicode, e.unicode);
      assert.equal(cell.nineStarColor, e.nine_star_color);
      assert.deepEqual(sorted(cell.mountains), sorted(e.mountains));
    }
  }],
  [/^bagua_xiantian_bearings$/, (c) => {
    const cells = cellsOf('bagua');
    for (const e of c.expected) {
      const slot = cells.find((x) => x.gua === e.drawn_in_houtian_slot);
      assert.equal(slot.xiantian.gua, e.name, `${e.drawn_in_houtian_slot} 位置的先天卦`);
      assert.deepEqual([...slot.xiantian.lines], e.lines_bottom_to_top);
      assert.equal(slot.centerDeg, e.bearing, `${e.name} 先天方位`);
    }
  }],
  [/^luoshu_magic_square_south_up$/, (c) => {
    const ring = lp.ringById('luoshu');
    const num = (dir) => (dir === '中' ? ring.center.luoshu : ring.cells.find((x) => x.dir8 === dir).luoshu);
    // 南上: 上排是南側,左為東
    const grid = [['東南', '南', '西南'], ['東', '中', '西'], ['東北', '北', '西北']].map((row) => row.map(num));
    assert.deepEqual(grid, c.expected.grid);
    const sums = new Set([...grid.map((r) => r[0] + r[1] + r[2]), ...[0, 1, 2].map((k) => grid[0][k] + grid[1][k] + grid[2][k]),
      grid[0][0] + grid[1][1] + grid[2][2], grid[0][2] + grid[1][1] + grid[2][0]]);
    assert.deepEqual([...sums], c.expected.line_sums);
  }],
  [/^plates_offsets$/, (c) => {
    const zi = (id) => cellsOf(id).find((x) => x.name === '子').centerDeg;
    assertAngle(zi('mountains24'), c.expected.地盤正針, 1e-9);
    assertAngle(zi('ren_plate'), c.expected.人盤中針, 1e-9);
    assertAngle(zi('tian_plate'), c.expected.天盤縫針, 1e-9);
  }],
  [/^lookup_/, (c) => {
    assert.equal(lp.cellAt(PLATE_ID[c.input.plate], c.input.bearing).name, c.expected);
  }],
  [/^facing_sitting_convention$/, (c) => {
    const cells = cellsOf('mountains24');
    for (const [a, b] of c.expected.pairs) {
      assert.equal(cells.find((x) => x.name === a).opposite, b);
      assert.equal(cells.find((x) => x.name === b).opposite, a);
    }
    assert.equal(c.expected.pairs.length, 12);
  }],
  [/^facing_sitting_\d/, (c) => {
    const r = lp.readout(c.input.facing_bearing);
    assert.equal(r.mountain, c.expected.facing);
    assert.equal(r.sitMountain, c.expected.sit);
    assertApprox(r.analysis.dev, c.expected.offset_deg, 1e-9, 'offset_deg');
    assert.equal(r.analysis.zone === 'zheng', c.expected.centre9, 'centre9');
  }],
  [/^zheng_jian_xiang_markers$/, (c) => {
    const k = lp.kongwangBoundaries();
    assert.deepEqual([...k.da], c.expected.daKongWang_bearings);
    assert.deepEqual([...k.xiao], c.expected.xiaoKongWang_bearings);
    assert.equal(DEFAULT_SETTINGS.xiaGuaHalfWidth, c.expected.centre_half_width);
  }],

  // ── 二十八宿 ──
  [/^xiu28_kaixi_widths$/, (c) => {
    assert.deepEqual([...lp.XIU_NAMES], c.expected.order_astronomical);
    assert.deepEqual([...lp.XIU_WIDTHS_GU], c.expected.widths_gu);
    assert.equal(lp.XIU_WIDTHS_GU.reduce((a, b) => a + b, 0), c.expected.total);
    assertApprox(lp.XIU_SCALE, c.expected.scale_to_360, 1e-15);
    assert.deepEqual([...lp.XIU_ANIMALS], c.expected.animals);
  }],
  [/^xiu28_bearing_layout_kaixi$/, (c) => {
    const cells = cellsOf('xiu28');
    assert.equal(cells.length, 28);
    c.expected.forEach((e, i) => {
      const x = cells[i];
      assert.equal(x.name, e.name, `第 ${i} 格`);
      assert.equal(x.animal, e.animal);
      assert.equal(x.qiyao, e.qiyao);
      assertApprox(x.startDeg, e.start, TOL4, `${e.name} start`);
      assertApprox(x.endDeg, e.end, TOL4, `${e.name} end`);
      assertApprox(x.widthDeg, e.width, TOL4, `${e.name} width`);
      assertApprox(x.centerDeg, e.center, TOL4, `${e.name} center`);
      assert.equal(x.mountainAtCenter, e.contains_24shan_at_center, `${e.name} 中心所在山`);
      assert.equal(geo.mountainAt(x.centerDeg).name, e.contains_24shan_at_center, `${e.name} 中心所在山(geo)`);
    });
  }],
  [/^xiu28_lookup_/, (c) => {
    assert.equal(lp.xiuAt(c.input.bearing).name, c.expected);
  }],
  [/^xiu28_group_centres$/, (c) => {
    for (const [group, centre] of Object.entries(c.expected)) {
      assert.equal(lp.XIU_GROUPS[group], c.input.groups[group], `${group} 七宿`);
      assertAngle(lp.xiuGroupCenterDeg(group), centre, 1e-4, group); // fixture 由四位小數的宿界再取中點,誤差可到 1e-4
    }
  }],
  [/^xiu28_to_branch_coarse_12ci$/, (c) => {
    assert.deepEqual(invertCoarseTable(c.input.source_table), c.expected);
    assert.deepEqual(sorted(Object.keys(c.expected)), sorted([...lp.XIU_NAMES]), '28 宿各出現一次');
  }],
  [/^xiu28_narrow_labels_360px$/, (c) => {
    const { glyph_px: glyphPx, mid_radius_px: mid, min_deg: minDeg, dial_px: dial } = c.input;
    const r = lp.narrowMansions({ glyphPx, midRadiusPx: mid });
    assert.deepEqual(r.names, c.expected);
    assertApprox(r.minDeg, minDeg, 0.005, 'min_deg');
    // 版面表 r6 的中徑必須與這個基準一致(LP-8: 同一個 R 基準)
    const r6 = lp.layoutRings('A', { R: dial / 2 }).rows.find((x) => x.key === 'r6');
    assertApprox(r6.midPx, mid, 0.05, 'r6 中徑');
  }],
  [/^xiu28_kaixi_vs_12ci_mismatch$/, (c) => {
    const coarse = invertCoarseTable(caseOf('xiu28_to_branch_coarse_12ci').input.source_table);
    const cells = cellsOf('xiu28');
    const bad = [...lp.XIU_NAMES].filter((name) => lp.branchCellAt(cells.find((x) => x.name === name).centerDeg).branch !== coarse[name]);
    assert.deepEqual(bad, c.expected);
    // 兩者只差在貼近地支界線,最遠不超過 3 度
    for (const name of bad) {
      const center = cells.find((x) => x.name === name).centerDeg;
      const cellOfCoarse = lp.BRANCH_CELLS.find((b) => b.branch === coarse[name]);
      const toEdge = Math.min(circDiff(center, cellOfCoarse.startDeg), circDiff(center, cellOfCoarse.endDeg));
      assert.ok(toEdge < 3, `${name} 離粗表地支界 ${toEdge} 度`);
    }
  }],

  // ── 120 分金(八干四維山單源,confidence=low 走軟斷言) ──
  [/^fenjin120_table$/, (c) => {
    const ring = lp.ringById('fenjin120');
    assert.equal(ring.cells.length, 120);
    const low = new Set(c.low_confidence_mountains ?? []);
    for (const [mountain, names] of Object.entries(c.expected.per_mountain)) {
      const mine = ring.cells.filter((x) => x.mountain === mountain);
      assert.equal(mine.length, 5, `${mountain} 應有 5 格`);
      if (low.has(mountain)) {
        // 軟斷言: 不崩潰、帶旗標、格子是字串
        assert.ok(mine.every((x) => x.confidence === 'low' && x.displayable === false && typeof x.name === 'string'), `${mountain} 旗標`);
      } else {
        assert.deepEqual(mine.map((x) => x.name), names, `${mountain} 分金`);
        assert.ok(mine.every((x) => x.confidence !== 'low' && x.displayable === true), `${mountain} 應顯示`);
      }
    }
    assert.equal(c.expected.ring.length, 120);
    c.expected.ring.forEach((e, i) => {
      const x = ring.cells[i];
      assert.equal(x.mountain, e.mountain, `第 ${i} 格所屬山`);
      assertAngle(x.startDeg, e.start, 1e-9, `第 ${i} 格 start`);
      assertAngle(x.endDeg, e.end, 1e-9, `第 ${i} 格 end`);
      if (!low.has(e.mountain)) assert.equal(x.name, e.name, `第 ${i} 格`);
    });
    // 以規則為準的結構事實(對兩種「前一位/後一位地支」說法都成立)
    assert.equal(ring.cells.filter((x) => x.wangxiang).length, c.expected.wangxiang_count);
    const counts = new Map();
    for (const x of ring.cells) counts.set(x.name, (counts.get(x.name) ?? 0) + 1);
    assert.equal(counts.size, 60);
    assert.ok([...counts.values()].every((n) => n === 2), '60 甲子各恰出現 2 次');
  }],
  [/^fenjin120_lookup_/, (c) => {
    const hit = lp.fenjinAt(c.input.bearing);
    if (isSoft(c)) {
      assert.equal(typeof hit.name, 'string');
      assert.equal(hit.confidence, 'low');
      assert.equal(hit.displayable, false);
      return;
    }
    assert.equal(hit.name, c.expected);
    assert.equal(hit.displayable, geo.MOUNTAINS.find((m) => m.name === hit.mountain).kind === '地支', '只有地支山顯示分金');
  }],

  // ── 64 卦(預設不放;順序硬斷言,角度錨點單源走軟斷言) ──
  [/^hexagram64_xiantian_circle_order$/, (c) => {
    const e = c.expected;
    assert.deepEqual([...lp.HEXAGRAM_NAMES], e.names);
    assert.deepEqual(e.names, H.independentHexagramCircle(), '文王序表重推的圓圖序');
    assert.equal(new Set(e.names).size, 64);
    // LP-6: 名稱與 unicode 鍵一致(無妄),坤的 end 為 360
    assert.deepEqual(sorted(Object.keys(e.unicode_by_name)), sorted(e.names));
    for (const name of e.names) {
      const kw = H.KING_WEN.findIndex(([n]) => n === name) + 1;
      assert.equal(e.unicode_by_name[name].codePointAt(0), 0x4dc0 + kw - 1, `${name} 的卦符位置(文王序 ${kw})`);
    }
    assert.equal(e.ring[63].name, '坤');
    assert.equal(e.ring[63].end, 360);
    // 錨點單一來源(low): 只斷言模組帶旗標、每一格的資料形狀,不逐格比角度
    const ring = lp.ringById('hexagram64');
    assert.equal(ring.confidence, 'low');
    assert.equal(ring.defaultVisible, false);
    assert.equal(ring.cells.length, 64);
    assert.ok(ring.cells.every((x, i) => x.name === e.names[i] && x.confidence === 'low' && Math.abs(x.widthDeg - 5.625) < 1e-12));
  }],

  // ── 節氣環、十二地支、八天干 ──
  [/^solar_term_ring_taiyang_dao_shan$/, (c) => {
    const cells = cellsOf('solar_terms');
    assert.equal(cells.length, 24);
    c.expected.forEach((e, i) => {
      assert.equal(cells[i].term, e.term);
      assert.equal(cells[i].mountain, e.mountain);
      assert.equal(cells[i].centerDeg, e.center);
    });
  }],
  [/^branches12_ring$/, (c) => {
    assert.equal(lp.BRANCH_CELLS.length, 12);
    c.expected.forEach((e, i) => {
      const b = lp.BRANCH_CELLS[i];
      assert.equal(b.branch, e.branch);
      assert.equal(b.centerDeg, e.center);
      assertAngle(b.startDeg, e.start, 1e-9);
      assertAngle(b.endDeg, e.end, 1e-9);
      assert.equal(lp.branchCellAt(e.center).branch, e.branch);
    });
  }],
  [/^stems8_in_24$/, (c) => {
    assert.deepEqual({ ...lp.STEM_CENTERS }, c.expected);
    assert.ok(!('戊' in lp.STEM_CENTERS) && !('己' in lp.STEM_CENTERS), '戊己居中宮,不在 24 山');
  }],

  // ── 版面 ──
  [/^layout_rings_[AB]_/, (c) => {
    const mode = c.name.startsWith('layout_rings_A') ? 'A' : 'B';
    const layout = lp.layoutRings(mode);
    assert.equal(layout.mode, mode);
    assert.equal(layout.rows.length, c.expected.length);
    assert.ok(layout.rows.length <= 9, '至多 9 環');
    c.expected.forEach((e, i) => {
      const r = layout.rows[i];
      assert.equal(r.key, e.key);
      assert.equal(r.label, e.label);
      assertApprox(r.r0, e.r0, 1e-9, `${e.key} r0`);
      assertApprox(r.r1, e.r1, 1e-9, `${e.key} r1`);
    });
    assert.equal(layout.rows[0].r0, 0);
    for (let i = 1; i < layout.rows.length; i += 1) assert.equal(layout.rows[i].r0, layout.rows[i - 1].r1, `${layout.rows[i].key} 與前一環相接`);
    assert.equal(layout.rows.at(-1).r1, layout.outer);
  }],

  // ── 配色、字集 ──
  [/^palette_contrast$/, (c) => {
    const e = c.expected;
    assert.deepEqual({ ...lp.PALETTE }, e.palette, '色票');
    assert.deepEqual({ ...lp.LEGACY_WUXING_COLORS }, e.legacy_palette, '舊五行色(不合格反例)');
    for (const row of e.contrast) {
      const got = lp.contrastRatio(row.fg, row.bg);
      assertApprox(got, row.ratio, 0.005 + 1e-9, row.pair);
      if ('passes' in row) assert.equal(got >= e.rules.min_text_ratio, row.passes, `${row.pair} 是否過 4.5`);
    }
    // 規則敘述: 「全部 >= 4.5」只限 lacquer_800/900 底(LP-1)
    const min = e.rules.min_text_ratio;
    const pairs = e.contrast.filter((r) => !r.legacy);
    for (const r of pairs.filter((x) => e.rules.all_pairs_pass_only_on.some((bg) => lp.PALETTE[bg] === x.bg))) {
      assert.ok(lp.contrastRatio(r.fg, r.bg) >= min, `${r.pair} 在 lacquer_800/900 底應 >= 4.5`);
    }
    for (const bg of e.rules.new_wuxing_pass_on) {
      for (const wx of ['wx_wood', 'wx_fire', 'wx_earth', 'wx_metal', 'wx_water']) {
        assert.ok(lp.contrastRatio(lp.PALETTE[wx], lp.PALETTE[bg]) >= min, `${wx} on ${bg}`);
      }
    }
    const failing = e.contrast.filter((r) => r.legacy && r.passes === false).map((r) => r.pair);
    assert.deepEqual(sorted(failing), sorted(e.rules.legacy_wuxing_fail));
  }],
  [/^charset_for_font_subset$/, (c) => {
    const e = c.expected;
    assert.equal(lp.CHARSET_CORE, e.core);
    assert.equal(lp.CHARSET_CORE.length, e.core_count);
    assert.equal(lp.CHARSET_NINE_STAR_COLORS, e.nine_star_color_glyphs);
    assert.equal(lp.CHARSET_RING_NAMES, e.ring_name_glyphs);
    assert.equal(lp.fontSubsetCharset({ scope: 'core', nineStarColors: false, ringNames: false }), e.core);
    assert.equal(lp.fontSubsetCharset({ scope: 'full', nineStarColors: true, ringNames: true }), e.full);
    assert.equal(e.full.length, e.full_count);
    // 讀數列與環名用字都要在字集內(LP-10)
    for (const ch of '山宮朝') assert.ok(e.core.includes(ch), `core 缺 ${ch}`);
    for (const ch of '黑碧綠黃赤紫') assert.ok(e.full.includes(ch), `full 缺 ${ch}`);
  }],
  [/^nine_star_colors_luoshu$/, (c) => {
    assert.deepEqual({ ...lp.NINE_STAR_COLORS }, c.expected);
    const ring = lp.ringById('luoshu');
    for (const cell of ring.cells) assert.equal(cell.nineStarColor, c.expected[cell.luoshu]);
    assert.equal(ring.center.nineStarColor, c.expected['5']);
  }],

  // ── 弧形文字、Canvas 角度、拖曳、慣性 ──
  [/^arc_text_transform_/, (c) => {
    const { bearing, r, cx, cy, glyph_up: glyphUp } = c.input;
    const t = lp.arcGlyphTransform({ bearing, r, cx, cy, glyphUp });
    assertDeepApprox({ x: t.x, y: t.y, rotate_rad: t.rotateRad }, c.expected, TOL4);
  }],
  [/^arc_text_multichar_angles/, (c) => {
    const { bearing, chars, step_deg: stepDeg, inward_up: inwardUp } = c.input;
    const got = lp.arcTextBearings({ bearing, count: chars, stepDeg, glyphUp: inwardUp ? 'inward' : 'outward' });
    assert.deepEqual(got, c.expected);
  }],
  [/^bearing_to_canvas_angle$/, (c) => {
    for (const b of c.input.bearings) assertApprox(lp.bearingToCanvasRad(b), c.expected[String(b)], TOL4, `${b}`);
  }],
  [/^drag_angle_unwrap$/, (c) => {
    assert.deepEqual(c.input.map((p) => lp.unwrapAngleDelta(p.prev, p.cur)), c.expected);
  }],
  [/^inertia_total_rotation$/, (c) => {
    const { omega0_deg_per_s: w0, tau_s: tau } = c.input;
    assert.equal(lp.inertiaTotalDeg(w0, tau), c.expected.total_extra_deg);
    // 數值積分(指數衰減逐步積分)也收斂到 ω0·τ,差 <= 停止門檻 * τ
    const sim = lp.simulateInertia(w0, { tau });
    assert.ok(sim.totalDeg <= c.expected.total_extra_deg && c.expected.total_extra_deg - sim.totalDeg <= lp.GESTURE.minOmegaDegPerSec * tau + 1e-9);
    assert.match(c.expected.formula, /integral = omega0\*tau/);
  }],

  // ── 傳統環序、環序規律 ──
  [/^traditional_ring_order_/, (c) => {
    const SIZES = { sanhe16: 16, sanyuan: 11, sanyuan22_bigpeak: 12, photo18: 18 };
    const key = c.name.replace('traditional_ring_order_', '');
    assert.equal(c.expected.length, SIZES[key], `${key} 環數`);
    assert.equal(new Set(c.expected).size, c.expected.length, '環名不重複');
    assert.deepEqual(lp.ringOrderInvariants(c.expected.map(H.classifyTraditionalRing)), TRADITIONAL_EXPECTED[key], `${key} 環序規律`);
  }],
  [/^ring_order_invariants$/, (c) => {
    const results = ['A', 'B'].map((mode) => lp.ringOrderInvariants(lp.layoutRings(mode).rows.filter((r) => !r.auxiliary).map((r) => r.ringId)));
    for (const key of ['tianchi_first', 'jieqi_after_di24', 'ren_tian_outside_di', 'xiu_outermost']) {
      const camel = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
      const vals = results.map((r) => r[camel]);
      assert.ok(!vals.includes(false), `${key} 在某個模式為 false: ${JSON.stringify(vals)}`);
      assert.equal(vals.includes(true), c.expected[key], key);
    }
    assert.deepEqual(sorted(Object.keys(c.expected)), sorted(['tianchi_first', 'jieqi_after_di24', 'ren_tian_outside_di', 'xiu_outermost']));
  }],
];

/** 四份傳統環序套用 ringOrderInvariants 的結果(null = 該盤沒有那一環,規律不適用)。
 *  三元盤(S17)的易卦環夾在 24 山與太陽到山之間,所以 jieqiAfterDi24 為 false,fixture 的 check 清單也不含 S17。 */
const TRADITIONAL_EXPECTED = {
  sanhe16: { tianchiFirst: true, jieqiAfterDi24: null, renTianOutsideDi: true, xiuOutermost: true, scaleOutermost: null },
  sanyuan: { tianchiFirst: true, jieqiAfterDi24: false, renTianOutsideDi: null, xiuOutermost: true, scaleOutermost: true },
  sanyuan22_bigpeak: { tianchiFirst: true, jieqiAfterDi24: true, renTianOutsideDi: null, xiuOutermost: null, scaleOutermost: true },
  photo18: { tianchiFirst: null, jieqiAfterDi24: true, renTianOutsideDi: true, xiuOutermost: true, scaleOutermost: null },
};

const runnerFor = (name) => LUOPAN_RUNNERS.find(([re]) => re.test(name))?.[1];
const GEO_OWNED = [/^mountains24_(geometry|sanyuan_yinyang|wuxing)$/, /^bagua_/, /^luoshu_/, /^plates_offsets$/, /^lookup_/, /^facing_sitting/, /^zheng_jian_xiang_markers$/];

describe('luopan_rings.json 案例守門', () => {
  it('72 案,每一案都有 runner;24 案屬 geo(geo.test.js 已測)、48 案屬 luopan', () => {
    assert.equal(fx.cases.length, 72);
    for (const c of fx.cases) assert.ok(runnerFor(c.name), `沒有 runner: ${c.name}`);
    const geoOwned = fx.cases.filter((c) => GEO_OWNED.some((re) => re.test(c.name)));
    assert.equal(geoOwned.length, 24);
    assert.equal(fx.cases.length - geoOwned.length, 48);
  });
  it('每個案例名稱只被一個 runner 認領(正規式不重疊)', () => {
    for (const c of fx.cases) assert.equal(LUOPAN_RUNNERS.filter(([re]) => re.test(c.name)).length, 1, c.name);
  });
  it('附錄 B.6 修正後的 fixtures: 無妄、坤 end=360、版面 A 新表 medium、窄宿基準、分金 low、字集補字', () => {
    const hx = caseOf('hexagram64_xiantian_circle_order').expected;
    assert.ok('無妄' in hx.unicode_by_name && !('无妄' in hx.unicode_by_name));
    assert.equal(hx.ring[63].end, 360);
    assert.equal(caseOf('layout_rings_A_solarterms').confidence, 'medium');
    assert.equal(caseOf('layout_rings_A_solarterms').expected.find((r) => r.key === 'r5').r1, 0.7735);
    assert.equal(caseOf('xiu28_narrow_labels_360px').input.min_deg, 4.93);
    assert.equal(caseOf('xiu28_narrow_labels_360px').input.mid_radius_px, 151.1);
    for (const n of ['fenjin120_lookup_337.5', 'fenjin120_lookup_7.5']) assert.equal(caseOf(n).confidence, 'low');
    assert.equal(caseOf('fenjin120_table').low_confidence_mountains.length, 12);
    assert.ok(caseOf('charset_for_font_subset').expected.core.includes('朝'));
    assert.ok(caseOf('palette_contrast').expected.contrast.length >= 21);
  });
  for (const c of fx.cases) {
    it(c.name, () => {
      runnerFor(c.name)(c);
    });
  }
});

describe('突變測試: runner 抓得出被改錯的期望值(規格 4.2 第 3 點)', () => {
  const HARD = [
    'mountains24_geometry', 'mountains24_sanyuan_yinyang', 'mountains24_sanhe_red_black', 'mountains24_wuxing', 'bagua_houtian_ring',
    'bagua_xiantian_bearings', 'luoshu_magic_square_south_up', 'plates_offsets', 'lookup_人盤中針_3', 'lookup_天盤縫針_357',
    'facing_sitting_172', 'facing_sitting_convention', 'zheng_jian_xiang_markers', 'xiu28_kaixi_widths', 'xiu28_bearing_layout_kaixi',
    'xiu28_lookup_180', 'xiu28_group_centres', 'xiu28_to_branch_coarse_12ci', 'xiu28_narrow_labels_360px', 'xiu28_kaixi_vs_12ci_mismatch',
    'fenjin120_table', 'fenjin120_lookup_174', 'hexagram64_xiantian_circle_order', 'solar_term_ring_taiyang_dao_shan', 'branches12_ring',
    'stems8_in_24', 'layout_rings_A_solarterms', 'layout_rings_B_sanhe', 'palette_contrast', 'charset_for_font_subset',
    'nine_star_colors_luoshu', 'arc_text_transform_outward_90', 'arc_text_transform_inward_180', 'arc_text_multichar_angles',
    'arc_text_multichar_angles_inward_up', 'bearing_to_canvas_angle', 'drag_angle_unwrap', 'inertia_total_rotation', 'ring_order_invariants',
  ];
  for (const name of HARD) {
    it(name, () => {
      const base = caseOf(name);
      const runner = runnerFor(name);
      runner(base);
      assertRunnerCatches(runner, H.mutateLeaf(base));
    });
  }
  it('傳統環序: 把天池搬離第一位、宿搬離最外都被抓出', () => {
    const runner = runnerFor('traditional_ring_order_sanhe16');
    const base = caseOf('traditional_ring_order_sanhe16');
    runner(base);
    const swapFirst = clone(base);
    [swapFirst.expected[0], swapFirst.expected[1]] = [swapFirst.expected[1], swapFirst.expected[0]];
    assertRunnerCatches(runner, swapFirst);
    const moved = clone(base);
    moved.expected.splice(13, 0, moved.expected.pop()); // 把最外層的宿搬進去兩層,外面多出別的環
    assert.equal(moved.expected.length, 16);
    assertRunnerCatches(runner, moved);
  });
  it('輸入面的突變: 改窄宿的字級、改版面模式、改配色前景色都被抓出', () => {
    const narrow = clone(caseOf('xiu28_narrow_labels_360px'));
    narrow.input.glyph_px = 24;
    assertRunnerCatches(runnerFor(narrow.name), narrow);
    const lay = clone(caseOf('layout_rings_A_solarterms'));
    lay.name = 'layout_rings_B_x';
    assertRunnerCatches(runnerFor(lay.name), lay);
    const pal = clone(caseOf('palette_contrast'));
    pal.expected.contrast[0].fg = '#000000';
    assertRunnerCatches(runnerFor(pal.name), pal);
    const insidePassFlag = clone(caseOf('palette_contrast'));
    insidePassFlag.expected.contrast.find((r) => r.legacy && r.passes === false).passes = true;
    assertRunnerCatches(runnerFor(insidePassFlag.name), insidePassFlag);
  });
  it('軟斷言: low 的分金案例改錯期望值不會失敗,但旗標改成 medium 就變硬斷言(且規則輸出仍一致)', () => {
    const soft = clone(caseOf('fenjin120_lookup_337.5'));
    assert.equal(isSoft(soft), true);
    soft.expected = '乙亥X';
    runnerFor(soft.name)(soft);
    const hard = clone(caseOf('fenjin120_lookup_337.5'));
    hard.confidence = 'medium';
    runnerFor(hard.name)(hard);
    hard.expected = '乙亥X';
    assertRunnerCatches(runnerFor(hard.name), hard);
    const table = clone(caseOf('fenjin120_table'));
    table.expected.per_mountain.子[0] = '乙子';
    assertRunnerCatches(runnerFor(table.name), table); // 地支山(子)仍是硬斷言
    const lowMountain = clone(caseOf('fenjin120_table'));
    lowMountain.expected.per_mountain.癸[0] = '乙子';
    runnerFor(lowMountain.name)(lowMountain); // 八干四維山(癸)是軟斷言
  });
});

// ═══════════════════════════ B. 規格 4.4 luopan 屬性測試 ═══════════════════════════

describe('環資料: 各環連續無縫、涵蓋 360 度、格數(規格 4.4)', () => {
  const EXPECTED_COUNT = { bagua: 8, luoshu: 8, mountains24: 24, yuan_band: 24, solar_terms: 24, ren_plate: 24, tian_plate: 24, xiu28: 28, fenjin120: 120, hexagram64: 64 };
  for (const [id, n] of Object.entries(EXPECTED_COUNT)) {
    it(`${id}: ${n} 格,首尾相接、寬度和 360、格名不重複`, () => {
      assert.equal(cellsOf(id).length, n);
      // 64 卦環的 index 是圓圖序(前 32 卦方位遞減),連續性一律依起點方位排序後檢查
      const cells = [...cellsOf(id)].sort((a, b) => a.startDeg - b.startDeg);
      let width = 0;
      cells.forEach((cell, i) => {
        const next = cells[(i + 1) % n];
        assert.ok(circDiff(cell.endDeg, next.startDeg) < 1e-9, `${id}[${cell.index}].end 應等於方位上下一格的 start`);
        assert.ok(cell.widthDeg > 0);
        assertApprox(cell.widthDeg, (((cell.endDeg - cell.startDeg) % 360) + 360) % 360 || 360, 1e-9, `${id}[${cell.index}] 寬度與起迄一致`);
        assertAngle(cell.centerDeg, cell.startDeg + cell.widthDeg / 2, 1e-9);
        width += cell.widthDeg;
      });
      assertApprox(width, 360, 1e-9, `${id} 寬度和`);
    });
    it(`${id}: 每 0.05 度的方位恰落在一格內,cellAt 與獨立的區間判斷一致`, () => {
      const cells = cellsOf(id);
      for (let k = 0; k < 7200; k += 1) {
        const b = k * 0.05;
        const hit = cells.filter((cell) => contains(cell, b));
        assert.equal(hit.length, 1, `${id} @${b} 命中 ${hit.length} 格`);
        assert.equal(lp.cellAt(id, b).index, hit[0].index, `${id} @${b}`);
      }
    });
  }
  it('環的 id 唯一,label 非空,天池排第一;預設不可見的是三針(僅模式 B)、120 分金(只做讀數)、64 卦(預設不放)', () => {
    const ids = lp.RINGS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids[0], 'tianchi');
    assert.ok(lp.RINGS.every((r) => typeof r.label === 'string' && r.label.length > 0));
    assert.deepEqual(lp.RINGS.filter((r) => !r.defaultVisible).map((r) => r.id).sort(), ['fenjin120', 'hexagram64', 'ren_plate', 'tian_plate'].sort());
    for (const mode of ['A', 'B']) for (const row of lp.layoutRings(mode).rows) assert.ok(lp.ringById(row.ringId), `${mode}/${row.key} 指向不存在的環 ${row.ringId}`);
  });
  it('cellAt 跨 0 度: 359.9999999 與 0 相鄰、負值與大於 360 先正規化', () => {
    assert.equal(lp.cellAt('mountains24', 359.9999999).name, '子');
    assert.equal(lp.cellAt('mountains24', -0.0000001).name, '子');
    assert.equal(lp.cellAt('mountains24', 360).name, '子');
    assert.equal(lp.cellAt('mountains24', 352.5).name, '子');
    assert.equal(lp.cellAt('mountains24', 352.4999999).name, '壬');
    assert.equal(lp.cellAt('xiu28', 360 + 359.99).name, '危');
    assert.equal(lp.cellAt('xiu28', -0.01).name, '危');
  });
});

describe('環序規律與版面(規格 2.8.1、2.8.6)', () => {
  it('模式 A、B: 天池最內、節氣緊貼 24 山外側(A)、人盤天盤在地盤外(B)、28 宿與刻度最外', () => {
    for (const mode of ['A', 'B']) {
      const ids = lp.layoutRings(mode).rows.filter((r) => !r.auxiliary).map((r) => r.ringId);
      const inv = lp.ringOrderInvariants(ids);
      assert.equal(inv.tianchiFirst, true, mode);
      assert.equal(inv.xiuOutermost, true, mode);
      assert.equal(inv.scaleOutermost, true, mode);
      assert.equal(inv.jieqiAfterDi24, mode === 'A' ? true : null, mode);
      assert.equal(inv.renTianOutsideDi, mode === 'B' ? true : null, mode);
    }
    assert.deepEqual(lp.layoutRings('A').rows.map((r) => r.ringId),
      ['tianchi', 'bagua', 'luoshu', 'mountains24', 'yuan_band', 'solar_terms', 'xiu28', 'scale360']);
    assert.deepEqual(lp.layoutRings('B').rows.map((r) => r.ringId),
      ['tianchi', 'bagua', 'luoshu', 'mountains24', 'yuan_band', 'ren_plate', 'tian_plate', 'xiu28', 'scale360']);
  });
  it('ringOrderInvariants 抓得出違規排列', () => {
    const bad = lp.ringOrderInvariants(['bagua', 'tianchi', 'mountains24', 'xiu28', 'solar_terms', 'scale360']);
    assert.equal(bad.tianchiFirst, false);
    assert.equal(bad.jieqiAfterDi24, false);
    assert.equal(bad.xiuOutermost, false);
    assert.equal(lp.ringOrderInvariants(['tianchi', 'ren_plate', 'mountains24', 'tian_plate', 'xiu28']).renTianOutsideDi, false);
    assert.equal(lp.ringOrderInvariants(['tianchi']).xiuOutermost, null);
  });
  it('模式 A 版面: 由規則(權重 + r5 固定 0.125R)重算 == 規格 2.8.6 內嵌表(比例與像素)', () => {
    const rows = lp.layoutRings('A').rows;
    assert.equal(rows.length, H.SPEC_LAYOUT_A.length);
    H.SPEC_LAYOUT_A.forEach((s, i) => {
      assert.equal(rows[i].key, s.key);
      assertApprox(rows[i].r0, s.r0, 1e-9, `${s.key} r0`);
      assertApprox(rows[i].r1, s.r1, 1e-9, `${s.key} r1`);
      assertApprox(rows[i].widthPx, s.widthPx, 0.05, `${s.key} 環寬`);
      assertApprox(rows[i].midPx, s.midPx, 0.05, `${s.key} 中徑`);
    });
    assertApprox(rows.find((r) => r.key === 'r5').widthPx, 0.125 * 180, 1e-9, 'r5 = 0.125R');
  });
  it('模式 B 版面: 寬度累加 == 規格 2.8.6 的寬度表,外緣 0.986', () => {
    const rows = lp.layoutRings('B').rows;
    let acc = 0;
    H.SPEC_LAYOUT_B_WIDTHS.forEach(([key, width], i) => {
      assert.equal(rows[i].key, key);
      assertApprox(rows[i].r0, acc, 1e-9, `${key} r0`);
      acc = Math.round((acc + width) * 1e4) / 1e4;
      assertApprox(rows[i].r1, acc, 1e-9, `${key} r1`);
      assertApprox(rows[i].r1 - rows[i].r0, width, 1e-9, `${key} 寬`);
    });
    assert.equal(rows.at(-1).r1, 0.986);
    // r5a/r5b 各約 11.6-11.8px,放單字 10px
    for (const k of ['r5a', 'r5b']) assert.ok(rows.find((r) => r.key === k).widthPx > 11.5 && rows.find((r) => r.key === k).widthPx < 11.9);
  });
  it('LP-2 節氣環: A 模式 r5 放得下 2 字徑向堆疊 10.5px(需 >= 21.42px),舊寬 12.4px 放不下', () => {
    assertApprox(lp.stackHeightPx(2, 10.5), 21.42, 1e-9);
    const r5 = lp.layoutRings('A').rows.find((r) => r.key === 'r5');
    assert.equal(lp.glyphFits(r5), true);
    assert.ok(r5.widthPx >= 21.42);
    assert.equal(r5.glyph.stackChars, 2);
    assert.ok(0.07 * 177 < 21.42, '舊版寬度(0.07×177=12.4px)本來就放不下');
    assert.equal(lp.glyphFits({ widthPx: 0.07 * 177, glyph: r5.glyph }), false);
  });
  it('每一環的字級放得進環寬(字級 15/13/21/10.5/10/14/9.5,規格 2.8.6),沒有字的環不檢查', () => {
    const SIZES = { r1: 15, r2: 13, r3: 21, r5: 10.5, r5a: 10, r5b: 10, r6: 14, r7: 9.5 };
    for (const mode of ['A', 'B']) {
      for (const row of lp.layoutRings(mode).rows) {
        if (row.key in SIZES) {
          assert.equal(row.glyph.px, SIZES[row.key], `${mode}/${row.key} 字級`);
          assert.equal(lp.glyphFits(row), true, `${mode}/${row.key} 字放不進 ${row.widthPx}px`);
        } else {
          assert.equal(row.glyph, null, `${mode}/${row.key} 不畫字`);
        }
      }
    }
    for (const k of ['r1', 'r2', 'r3']) assert.equal(lp.layoutRings('A').rows.find((r) => r.key === k).glyph.bold, true);
  });
  it('像素基準統一為 R=180(預設),R 可換算', () => {
    const a180 = lp.layoutRings('A').rows.find((r) => r.key === 'r6');
    const a90 = lp.layoutRings('A', { R: 90 }).rows.find((r) => r.key === 'r6');
    assert.equal(lp.layoutRings('A').R, 180);
    assertApprox(a90.midPx * 2, a180.midPx, 1e-9);
    assertApprox(a180.midPx, 151.1, 0.05);
  });
  it('layoutModeFromSettings: showSanZhen 才是三合模式(設計推論),其餘為 A', () => {
    assert.equal(lp.layoutModeFromSettings(), 'A');
    assert.equal(lp.layoutModeFromSettings({ showSanZhen: true }), 'B');
    assert.throws(() => lp.layoutModeFromSettings({ nortMode: 'true' }), /未知的設定鍵/);
  });
});

describe('二十八宿(開禧宿度,規格 2.8.3)', () => {
  const cells = () => cellsOf('xiu28');
  it('由整數累加(古度×4)重算 == 實作的起迄與寬度(28/28,容差 1e-9)', () => {
    const ind = H.independentXiuLayout();
    assert.equal(ind.total, 1461);
    ind.cells.forEach((e, i) => {
      const x = cells()[i];
      assert.equal(x.name, e.name);
      assertApprox(x.startDeg, e.start, 1e-9, `${e.name} start`);
      assertApprox(x.endDeg, e.end, 1e-9, `${e.name} end`);
      assert.equal(x.widthGu, e.widthGu);
    });
  });
  it('子中心 0 度 = 虛|危之間: 虛起於 0,危止於 360;方位角增加的方向宿序倒著走', () => {
    assert.equal(cells()[0].name, '虛');
    assert.equal(cells()[0].startDeg, 0);
    assert.equal(cells().at(-1).name, '危');
    assert.equal(cells().at(-1).endDeg, 360);
    assert.deepEqual(cells().slice(0, 6).map((x) => x.name), ['虛', '女', '牛', '斗', '箕', '尾']);
    assert.deepEqual(cells().slice(-4).map((x) => x.name), ['奎', '壁', '室', '危']);
  });
  it('午中(180 度)= 張 2.125 度,落第 3 度內(口訣「南方張度縫三乘」)', () => {
    const hit = lp.xiuAt(180);
    assert.equal(hit.name, '張');
    assertApprox(hit.ruSuGu, 2.125, 1e-9, '入宿度');
    assert.ok(hit.ruSuGu > 2 && hit.ruSuGu < 3);
  });
  it('入宿度落在 [0, 該宿古度寬):每 0.1 度掃一圈', () => {
    for (let k = 0; k < 3600; k += 1) {
      const hit = lp.xiuAt(k / 10);
      assert.ok(hit.ruSuGu >= -1e-9 && hit.ruSuGu < hit.widthGu + 1e-9, `${k / 10}: ${hit.name} ${hit.ruSuGu}`);
    }
  });
  it('宿寬與規格數字: 觜 0.493、鬼 2.464、房 5.667、心 5.914、星 6.653、牛 6.899', () => {
    const w = (n) => cells().find((x) => x.name === n).widthDeg;
    const SPEC = { 觜: 0.493, 鬼: 2.464, 房: 5.667, 心: 5.914, 星: 6.653, 牛: 6.899 };
    for (const [n, v] of Object.entries(SPEC)) assertApprox(w(n), v, 0.001, n);
    const min = [...cells()].sort((a, b) => a.widthDeg - b.widthDeg).slice(0, 6).map((x) => x.name);
    assert.deepEqual(sorted(min), sorted(Object.keys(SPEC)));
  });
  it('窄宿集合 ["觜","鬼"](13px、模式 A 與 B 的 r6 中徑都一樣);字再大則變多', () => {
    for (const mode of ['A', 'B']) {
      const mid = lp.layoutRings(mode).rows.find((r) => r.key === 'r6').midPx;
      assert.deepEqual(lp.narrowMansions({ glyphPx: 13, midRadiusPx: mid }).names, ['觜', '鬼'], mode);
    }
    assert.deepEqual(lp.narrowMansions().names, ['觜', '鬼']);
    assertApprox(lp.narrowMansions().minDeg, 4.93, 0.005);
    assert.deepEqual(lp.narrowMansions({ glyphPx: 14 }).names, ['觜', '鬼']);
    assert.deepEqual(lp.narrowMansions({ glyphPx: 15 }).names, ['房', '觜', '鬼'], '字大一點,房(5.667)也放不下;回傳依天文序');
    assert.ok(lp.narrowMansions({ glyphPx: 30 }).names.length > 3);
    assertApprox(lp.minGlyphAngleDeg(13, 151.1), 4.9295, 1e-3);
  });
  it('標籤分級: 引線 = [觜,鬼];偏窄(9px + 錯位)= [房,心,星,牛];其餘正常', () => {
    const plan = lp.xiuLabelPlan();
    assert.equal(plan.length, 28);
    const of = (p) => sorted(plan.filter((x) => x.plan === p).map((x) => x.name));
    assert.deepEqual(of('leader'), sorted(['觜', '鬼']));
    assert.deepEqual(of('tight'), sorted(['房', '心', '星', '牛']));
    assert.equal(of('normal').length, 22);
    assert.ok(lp.MANSION_TIGHT_BELOW_DEG > 6.899 && lp.MANSION_TIGHT_BELOW_DEG < 9.117, '門檻介於牛(6.90)與虛(9.12)之間');
  });
  it('四象跨度中心落在東/北/西/南附近(6 度內)', () => {
    const near = { 東方青龍: 90, 北方玄武: 0, 西方白虎: 270, 南方朱雀: 180 };
    for (const [g, deg] of Object.entries(near)) assert.ok(circDiff(lp.xiuGroupCenterDeg(g), deg) < 6, g);
    throwsCode(() => lp.xiuGroupCenterDeg('中央黃龍'), 'UNKNOWN_XIU_GROUP');
  });
  it('宿的七曜依「木金土日月火水」循環,動物名 = 宿 + 七曜 + 獸(28/28)', () => {
    [...lp.XIU_NAMES].forEach((n, i) => {
      const cell = cells().find((x) => x.name === n);
      assert.equal(cell.qiyao, '木金土日月火水'[i % 7], n);
      assert.equal(cell.animal.slice(0, 2), n + cell.qiyao);
    });
  });
  it('點宿名時同時顯示所在山: 每宿的 mountainAtCenter == geo.mountainAt(中心)', () => {
    for (const x of cells()) assert.equal(x.mountainAtCenter, geo.mountainAt(x.centerDeg).name, x.name);
  });
  it('xiuAt 輸入不合法丟 INVALID_BEARING', () => {
    for (const bad of [NaN, Infinity, '90', null, undefined]) throwsCode(() => lp.xiuAt(bad), 'INVALID_BEARING');
  });
});

describe('一百二十分金(規格 2.8.4;只做即時讀數,只顯示地支山)', () => {
  it('由字串運算重排的 120 格 == 實作(名稱、所屬山、起迄)', () => {
    const ind = H.independentFenjinRing();
    const cells = cellsOf('fenjin120');
    assert.equal(ind.length, 120);
    ind.forEach((e, i) => {
      assert.equal(cells[i].name, e.name, `第 ${i} 格`);
      assert.equal(cells[i].mountain, e.mountain);
      assertAngle(cells[i].startDeg, e.start, 1e-9);
      assertAngle(cells[i].endDeg, e.end, 1e-9);
    });
  });
  it('起點在壬|子縫 352.5;每山 5 格 × 3 度;60 甲子各 2 次;丙丁庚辛開頭 48 格', () => {
    const cells = cellsOf('fenjin120');
    assert.equal(cells[0].startDeg, 352.5);
    assert.ok(cells.every((x) => x.widthDeg === 3));
    assert.equal(cells.filter((x) => x.wangxiang).length, 48);
    assert.ok(cells.filter((x) => x.wangxiang).every((x) => '丙丁庚辛'.includes(x.name[0])));
    assert.ok(cells.filter((x) => !x.wangxiang).every((x) => !'丙丁庚辛'.includes(x.name[0])));
  });
  it('午向 174 度 = 甲午(sohu 346292839 逐字,信心: 高);352.5 = 甲子', () => {
    assert.equal(lp.fenjinAt(174).name, '甲午');
    assert.equal(lp.fenjinAt(352.5).name, '甲子');
    assert.equal(lp.fenjinAt(174).confidence, 'high');
  });
  it('只有地支山的分金 displayable=true 且信心高;八干四維山 displayable=false 且 confidence=low', () => {
    for (const cell of cellsOf('fenjin120')) {
      const branch = geo.MOUNTAINS.find((m) => m.name === cell.mountain).kind === '地支';
      assert.equal(cell.displayable, branch, cell.name);
      assert.equal(cell.confidence, branch ? 'high' : 'low', cell.name);
    }
    assert.equal(cellsOf('fenjin120').filter((x) => x.displayable).length, 60);
  });
  it('規則本身(單源、八干四維山沿用前一位地支)的特性測試: 癸=子、艮=丑、甲=寅、壬=亥', () => {
    const at = (mountain) => cellsOf('fenjin120').filter((x) => x.mountain === mountain).map((x) => x.name);
    assert.deepEqual(at('癸'), at('子'));
    assert.deepEqual(at('艮'), at('丑'));
    assert.deepEqual(at('甲'), at('寅'));
    assert.deepEqual(at('壬'), at('亥'));
  });
  it('分金所屬山 == geo.mountainAt(24/24);格號 = 山序×5 + 山內格(cell = floor((dev+7.5)/3))', () => {
    for (let k = 0; k < 7200; k += 1) {
      const b = k * 0.05;
      const m = geo.mountainAt(b);
      const hit = lp.fenjinAt(b);
      assert.equal(hit.mountain, m.name, `@${b}`);
      assert.equal(hit.index, m.index * 5 + Math.min(4, Math.floor((m.dev + 7.5) / 3)), `@${b}`);
    }
  });
  it('每 3 度換一格:3 度邊界歸順時針下一格', () => {
    assert.equal(lp.fenjinAt(355.4999).name, '甲子');
    assert.equal(lp.fenjinAt(355.5).name, '丙子');
    assert.equal(lp.fenjinAt(1.4999).name, '戊子');
    assert.equal(lp.fenjinAt(1.5).name, '庚子');
  });
});

describe('六十四卦環(規格 2.8.5,預設關,錨點單源 confidence=low)', () => {
  it('規格公式 k = b<180 ? 31-floor(b/5.625) : 32+floor((b-180)/5.625) 對每 0.1 度成立', () => {
    const names = H.independentHexagramCircle();
    for (let k = 0; k < 3600; k += 1) {
      const b = k / 10;
      const idx = b < 180 ? 31 - Math.floor(b / 5.625) : 32 + Math.floor((b - 180) / 5.625);
      assert.equal(lp.hexagramAt(b).name, names[idx], `@${b}`);
      assert.equal(lp.hexagramAt(b).index, idx);
    }
  });
  it('規格列出的四個邊界: 乾 [174.375,180)、復 [0,5.625)、姤 [180,185.625)、坤 [354.375,360)', () => {
    assert.equal(lp.hexagramAt(174.375).name, '乾');
    assert.equal(lp.hexagramAt(179.999).name, '乾');
    assert.equal(lp.hexagramAt(0).name, '復');
    assert.equal(lp.hexagramAt(5.624).name, '復');
    assert.equal(lp.hexagramAt(5.625).name, '頤');
    assert.equal(lp.hexagramAt(180).name, '姤');
    assert.equal(lp.hexagramAt(185.624).name, '姤');
    assert.equal(lp.hexagramAt(354.375).name, '坤');
    assert.equal(lp.hexagramAt(359.999).name, '坤');
    const cells = cellsOf('hexagram64');
    assert.deepEqual([cells[0].startDeg, cells[0].endDeg], [174.375, 180]);
    assert.deepEqual([cells[31].startDeg, cells[31].endDeg], [0, 5.625]);
    assert.deepEqual([cells[32].startDeg, cells[32].endDeg], [180, 185.625]);
    assert.deepEqual([cells[63].startDeg, cells[63].endDeg], [354.375, 360]);
  });
  it('64 卦的六爻 = 下卦三爻 + 上卦三爻(由 geo 的卦爻表重組);既濟 101010、未濟 010101、乾全陽、坤全陰', () => {
    const byName = (n) => cellsOf('hexagram64').find((x) => x.name === n);
    assert.deepEqual([...byName('既濟').lines], [1, 0, 1, 0, 1, 0]);
    assert.deepEqual([...byName('未濟').lines], [0, 1, 0, 1, 0, 1]);
    assert.deepEqual([...byName('乾').lines], [1, 1, 1, 1, 1, 1]);
    assert.deepEqual([...byName('坤').lines], [0, 0, 0, 0, 0, 0]);
    for (const [name, upper, lower] of H.KING_WEN) {
      const cell = byName(name);
      assert.equal(cell.upper, upper, name);
      assert.equal(cell.lower, lower, name);
      assert.deepEqual([...cell.lines], [...geo.GUA_LINES[lower], ...geo.GUA_LINES[upper]], name);
    }
  });
  it('每一格都帶 confidence=low 旗標,hexagramAt 回傳同一份資料', () => {
    assert.ok(cellsOf('hexagram64').every((x) => x.confidence === 'low'));
    assert.equal(lp.hexagramAt(100).confidence, 'low');
  });
});

describe('節氣環、十二地支、天干(規格 2.8.2)', () => {
  it('節氣 → 山: 由視黃經重算(冬至 270 度 = 子,每節氣 +15 度) == 環資料,並與 calendar 的節氣名一致(24/24)', () => {
    const cells = cellsOf('solar_terms');
    cells.forEach((cell, m) => {
      const calIndex = (m + 23) % 24; // calendar: 索引 i 的視黃經 = (285 + 15 i) mod 360
      assert.equal(cell.term, cal.TERM_NAMES[calIndex], `第 ${m} 山的節氣`);
      const longitude = (285 + 15 * calIndex) % 360;
      assert.equal(cell.longitudeDeg, longitude);
      assert.equal(cell.longitudeDeg, (270 + 15 * m) % 360);
      assert.equal(cell.mountain, geo.MOUNTAINS[m].name);
    });
    // 二分二至落在子午卯酉,合天文
    const at = (term) => cells.find((x) => x.term === term).mountain;
    assert.deepEqual(['冬至', '春分', '夏至', '秋分'].map(at), ['子', '卯', '午', '酉']);
    assert.equal(at('立春'), '艮');
    assert.equal(cells.find((x) => x.term === '大寒').mountain, '丑');
  });
  it('solarTermAt: 每個節氣的中心方位查得回自己;節氣環與 24 山逐格對齊', () => {
    for (const cell of cellsOf('solar_terms')) {
      assert.equal(lp.solarTermAt(cell.centerDeg).term, cell.term);
      assert.equal(lp.solarTermAt(cell.centerDeg).mountain, geo.mountainAt(cell.centerDeg).name);
    }
    assert.equal(lp.solarTermAt(0).term, '冬至');
    assert.equal(lp.solarTermAt(352.5).term, '冬至');
    assert.equal(lp.solarTermAt(352.49).term, '大雪');
  });
  it('節氣名每個 2 字(徑向堆疊用),24 個不重複', () => {
    const terms = cellsOf('solar_terms');
    assert.equal(new Set(terms.map((x) => x.term)).size, 24);
    assert.ok(terms.every((x) => x.chars.length === 2 && x.chars.join('') === x.term));
    assert.deepEqual([...lp.SOLAR_TERMS], terms.map((x) => x.term));
  });
  it('十二地支 30 度格、八天干中心由 24 山推得', () => {
    assert.deepEqual(lp.BRANCH_CELLS.map((b) => b.branch), [...'子丑寅卯辰巳午未申酉戌亥']);
    for (const m of geo.MOUNTAINS.filter((x) => x.kind === '天干')) assert.equal(lp.STEM_CENTERS[m.name], m.centerDeg, m.name);
    assert.equal(Object.keys(lp.STEM_CENTERS).length, 8);
    assert.equal(lp.branchCellAt(344.9).branch, '亥');
    assert.equal(lp.branchCellAt(345).branch, '子');
    assert.equal(lp.branchCellAt(14.99).branch, '子');
    assert.equal(lp.branchCellAt(15).branch, '丑');
  });
  it('人盤、天盤是「整圈轉半格的 24 山複製環」,格名順序與地盤相同', () => {
    for (const id of ['ren_plate', 'tian_plate']) {
      cellsOf(id).forEach((cell, i) => assert.equal(cell.name, geo.MOUNTAINS[i].name));
    }
    cellsOf('ren_plate').forEach((c) => assertAngle(c.centerDeg, geo.MOUNTAINS[c.index].centerDeg - 7.5, 1e-9));
    cellsOf('tian_plate').forEach((c) => assertAngle(c.centerDeg, geo.MOUNTAINS[c.index].centerDeg + 7.5, 1e-9));
    // 與 geo 的三針判定一致(每 0.1 度)
    for (let k = 0; k < 3600; k += 1) {
      const b = k / 10;
      assert.equal(lp.cellAt('ren_plate', b).name, geo.mountainAt(b, 'ren').name, `人盤 @${b}`);
      assert.equal(lp.cellAt('tian_plate', b).name, geo.mountainAt(b, 'tian').name, `天盤 @${b}`);
      assert.equal(lp.cellAt('mountains24', b).name, geo.mountainAt(b).name, `地盤 @${b}`);
    }
  });
});

describe('24 山、八卦、洛書的跨模組一致性(規格 4.2 第 5 點)', () => {
  const xk = loadFixture('xuankong_core');
  it('RINGS 的 24 山 == geo.MOUNTAINS(名稱、卦、元龍、陰陽、五行、類別、中心、對山,24/24)', () => {
    cellsOf('mountains24').forEach((c, i) => {
      const m = geo.MOUNTAINS[i];
      assert.deepEqual([c.name, c.gua, c.dragon, c.yinyangSanyuan, c.wuxing, c.kind, c.centerDeg, c.opposite, c.dir8],
        [m.name, m.gua, m.dragon, m.yinyang, m.wuxing, m.kind, m.centerDeg, geo.oppositeOf(m.name), geo.dirOfGua(m.gua)]);
      assert.equal(c.wuxingPalace, geo.wuxingOfMountain(m.name, 'palace'));
    });
  });
  it('xuankong_core.json table_24_mountains(壬起算)== RINGS 的 24 山(24/24)', () => {
    const rows = xk.cases.find((c) => c.name === 'table_24_mountains').expected.rows;
    const dragonOf = ['地元', '天元', '人元'];
    assert.equal(rows.length, 24);
    for (const r of rows) {
      const cell = cellsOf('mountains24').find((x) => x.name === r.name);
      assert.equal(cell.gua, r.palace_name);
      assert.equal(cell.dragon, dragonOf[r.yuan]);
      assert.equal(cell.yinyangSanyuan === '陽', r.yang);
      assert.equal(cell.centerDeg, r.center_deg);
      assert.equal(cell.opposite, r.opposite);
    }
  });
  it('RINGS 的八卦與洛書 == geo 的表(卦爻、先天、五行、洛書數)', () => {
    for (const cell of cellsOf('bagua')) {
      assert.equal(cell.gua, geo.GUA[cell.index]);
      assert.equal(cell.dir8, geo.DIR8[cell.index]);
      assert.equal(cell.luoshu, geo.LUOSHU[cell.gua]);
      assert.equal(cell.wuxing, geo.GUA_WUXING[cell.gua]);
      assert.deepEqual([...cell.linesHoutian], [...geo.GUA_LINES[cell.gua]]);
      assert.equal(cell.xiantian.gua, geo.XIANTIAN_OF_SLOT[cell.gua]);
      assert.equal(geo.guaAt(cell.centerDeg).gua, cell.gua);
      assert.equal(cell.centerDeg, 45 * cell.index);
    }
    assert.deepEqual(lp.ringById('luoshu').cells.map((c) => c.gua), [...geo.GUA]);
    for (const c of cellsOf('bagua')) assert.equal(c.unicode, `U+${(0x2630 + [...'乾兌離震巽坎艮坤'].indexOf(c.gua)).toString(16).toUpperCase()}`);
  });
  it('三合紅黑字: 由納甲(乾納甲、坤納乙、坎納癸申辰、離納壬寅戌)重推 == 內嵌表;12 陽 12 陰', () => {
    const yang = H.sanheYangFromNajia();
    assert.equal(yang.size, 12);
    for (const c of cellsOf('mountains24')) assert.equal(c.yinyangSanhe, yang.has(c.name) ? '陽' : '陰', c.name);
    assert.equal(cellsOf('mountains24').filter((c) => c.yinyangSanhe === '陽').length, 12);
  });
  it('三元龍陰陽記憶檢查: 四正卦 地、天、人 = 陽陰陰;四隅卦 = 陰陽陽', () => {
    for (const gua of ['坎', '離', '震', '兌']) {
      const cs = cellsOf('mountains24').filter((c) => c.gua === gua);
      assert.deepEqual(['地元', '天元', '人元'].map((d) => cs.find((c) => c.dragon === d).yinyangSanyuan), ['陽', '陰', '陰'], gua);
    }
    for (const gua of ['乾', '坤', '艮', '巽']) {
      const cs = cellsOf('mountains24').filter((c) => c.gua === gua);
      assert.deepEqual(['地元', '天元', '人元'].map((d) => cs.find((c) => c.dragon === d).yinyangSanyuan), ['陰', '陽', '陽'], gua);
    }
  });
  it('兩套陰陽並存: yinyangOf 依 scheme 取,不認得的 scheme 與山名丟錯', () => {
    assert.equal(lp.yinyangOf('子', 'sanyuan'), '陰');
    assert.equal(lp.yinyangOf('子', 'sanhe'), '陽');
    assert.equal(lp.yinyangOf('艮', 'sanyuan'), '陽');
    assert.equal(lp.yinyangOf('艮', 'sanhe'), '陰');
    assert.equal(lp.yinyangOf('子'), lp.yinyangOf('子', DEFAULT_SETTINGS.yinyangScheme), '預設 scheme 取 settings');
    throwsCode(() => lp.yinyangOf('子', 'other'), 'INVALID_OPTION');
    throwsCode(() => lp.yinyangOf('X', 'sanyuan'), 'UNKNOWN_MOUNTAIN');
  });
  it('大空亡線 8 條(八卦交界)、小空亡線 16 條(宮內山界),互不重疊且合起來是 24 條山界', () => {
    const k = lp.kongwangBoundaries();
    assert.equal(k.da.length, 8);
    assert.equal(k.xiao.length, 16);
    assert.deepEqual([...k.da, ...k.xiao].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => 7.5 + 15 * i));
    for (const b of k.da) assert.equal(geo.analyzeBearing(b).kongwangKind, 'da');
    for (const b of k.xiao) assert.equal(geo.analyzeBearing(b).kongwangKind, 'xiao');
  });
  it('八卦的傳統盤式(先天爻畫在後天卦名位置)是選項,預設後天爻 + 後天名', () => {
    assert.deepEqual(lp.baguaDrawSpec('坎'), { name: '坎', lines: [0, 1, 0], mode: 'houtian' });
    assert.deepEqual(lp.baguaDrawSpec('坎', { traditional: true }), { name: '坎', lines: [0, 0, 0], mode: 'traditional' });
    assert.deepEqual(lp.baguaDrawSpec('離', { traditional: true }).lines, [1, 1, 1]);
    throwsCode(() => lp.baguaDrawSpec('X'), 'UNKNOWN_GUA');
  });
  it('360 度刻度: 1 度細線、5 度中線、10 度長線、每 30 度標數字(共 360 條)', () => {
    const t = lp.SCALE_TICKS;
    assert.equal(t.length, 360);
    const count = (kind) => t.filter((x) => x.kind === kind).length;
    assert.deepEqual([count('label'), count('long'), count('mid'), count('thin')], [12, 24, 36, 288]);
    assert.deepEqual(t.filter((x) => x.label !== null).map((x) => x.label), Array.from({ length: 12 }, (_, i) => String(30 * i)));
    assert.equal(lp.scaleTickKind(0), 'label');
    assert.equal(lp.scaleTickKind(10), 'long');
    assert.equal(lp.scaleTickKind(15), 'mid');
    assert.equal(lp.scaleTickKind(17), 'thin');
    assert.ok(t.every((x, i) => x.deg === i));
  });
});

// ═══════════════════════════ C. 配色與對比度(規格 2.8.7) ═══════════════════════════

describe('配色與對比度', () => {
  it('色票 == 規格 2.8.7(20 個 token,含新五行色)', () => {
    assert.deepEqual({ ...lp.PALETTE }, H.SPEC_PALETTE);
    assert.equal(Object.keys(lp.PALETTE).length, 20);
  });
  it('contrastRatio 對全部 token 兩兩組合 == 獨立 WCAG 實作(容差 1e-9),且對稱', () => {
    const names = Object.keys(lp.PALETTE);
    for (const a of names) {
      for (const b of names) {
        assertApprox(lp.contrastRatio(lp.PALETTE[a], lp.PALETTE[b]), H.wcagContrast(lp.PALETTE[a], lp.PALETTE[b]), 1e-9, `${a}/${b}`);
        assertApprox(lp.contrastRatio(lp.PALETTE[a], lp.PALETTE[b]), lp.contrastRatio(lp.PALETTE[b], lp.PALETTE[a]), 1e-12);
      }
      assert.equal(lp.contrastRatio(lp.PALETTE[a], lp.PALETTE[a]), 1);
    }
    assertApprox(lp.contrastRatio('#000000', '#FFFFFF'), 21, 1e-9);
    assert.equal(lp.relativeLuminance('#000000'), 0);
    assertApprox(lp.relativeLuminance('#ffffff'), 1, 1e-12);
  });
  it('新五行色在 lacquer_800/700/600 三種底皆 >= 4.5(規格表 5.99/5.52/4.95 與 6.55/6.04/5.41)', () => {
    const SPEC = { wx_fire: [5.99, 5.52, 4.95], wx_water: [6.55, 6.04, 5.41] };
    for (const [wx, ratios] of Object.entries(SPEC)) {
      ['lacquer_800', 'lacquer_700', 'lacquer_600'].forEach((bg, i) => {
        const got = lp.contrastRatio(lp.PALETTE[wx], lp.PALETTE[bg]);
        assertApprox(got, ratios[i], 0.005 + 1e-9, `${wx}/${bg}`);
        assert.ok(got >= lp.TEXT_MIN_CONTRAST);
      });
    }
    for (const wx of ['wx_wood', 'wx_fire', 'wx_earth', 'wx_metal', 'wx_water']) {
      for (const bg of ['lacquer_800', 'lacquer_700', 'lacquer_600', 'lacquer_900']) assert.ok(lp.contrastRatio(lp.PALETTE[wx], lp.PALETTE[bg]) >= 4.5, `${wx}/${bg}`);
    }
  });
  it('LP-1 舊五行色反例: 火 4.39/3.94、水 4.53/4.06 在 700/600 底(舊色不合格;水在 700 上數值 4.53 仍過)', () => {
    const L = lp.LEGACY_WUXING_COLORS;
    const r = (fg, bg) => Math.round(lp.contrastRatio(fg, lp.PALETTE[bg]) * 100) / 100;
    assert.deepEqual([r(L.wx_fire, 'lacquer_700'), r(L.wx_fire, 'lacquer_600'), r(L.wx_water, 'lacquer_700'), r(L.wx_water, 'lacquer_600')], [4.39, 3.94, 4.53, 4.06]);
    assert.ok(lp.contrastRatio(L.wx_fire, lp.PALETTE.lacquer_700) < 4.5);
    assert.ok(lp.contrastRatio(L.wx_fire, lp.PALETTE.lacquer_600) < 4.5);
    assert.ok(lp.contrastRatio(L.wx_water, lp.PALETTE.lacquer_600) < 4.5);
    // 舊色只有在 lacquer_800/900 底才全部合格
    for (const wx of ['wx_fire', 'wx_water']) for (const bg of ['lacquer_800', 'lacquer_900']) assert.ok(lp.contrastRatio(L[wx], lp.PALETTE[bg]) >= 4.5);
  });
  it('24 山格: 陽 = 金底 + 朱紅字 5.39;陰 = 漆黑底 + 亮金字 11.74;格底本身有深淺差異(不只靠顏色)', () => {
    const yang = lp.mountainCellStyle('陽');
    const yin = lp.mountainCellStyle('陰');
    assert.deepEqual([yang.bgToken, yang.fgToken, yin.bgToken, yin.fgToken], ['gold_500', 'cinnabar_800', 'lacquer_800', 'gold_300']);
    assertApprox(lp.contrastRatio(yang.fg, yang.bg), 5.39, 0.005 + 1e-9);
    assertApprox(lp.contrastRatio(yin.fg, yin.bg), 11.74, 0.005 + 1e-9);
    assert.ok(lp.relativeLuminance(yang.bg) - lp.relativeLuminance(yin.bg) > 0.3, '陽陰兩種底的亮度差要大');
    throwsCode(() => lp.mountainCellStyle('X'), 'INVALID_OPTION');
  });
  it('木紋主題(規格 2.8.7): 墨字在 #B98548 6.08、#D9A863 9.09;朱紅字只能放 #D9A863(5.05),放 #B98548 只有 3.38', () => {
    const ink = '#0E0B09';
    assertApprox(lp.contrastRatio(ink, '#B98548'), 6.08, 0.005 + 1e-9);
    assertApprox(lp.contrastRatio(ink, '#D9A863'), 9.09, 0.005 + 1e-9);
    assertApprox(lp.contrastRatio(lp.PALETTE.cinnabar_800, '#D9A863'), 5.05, 0.005 + 1e-9);
    assertApprox(lp.contrastRatio(lp.PALETTE.cinnabar_800, '#B98548'), 3.38, 0.005 + 1e-9);
    assert.ok(lp.contrastRatio(lp.PALETTE.cinnabar_800, '#B98548') < lp.TEXT_MIN_CONTRAST);
  });
  it('五行 → 色 token、三元龍色帶 token;不認得的丟錯', () => {
    assert.deepEqual(['木', '火', '土', '金', '水'].map((w) => lp.wuxingColor(w)),
      [lp.PALETTE.wx_wood, lp.PALETTE.wx_fire, lp.PALETTE.wx_earth, lp.PALETTE.wx_metal, lp.PALETTE.wx_water]);
    assert.deepEqual({ ...lp.DRAGON_BAND_TOKEN }, { 天元: 'gold_300', 地元: 'jade', 人元: 'terracotta' });
    throwsCode(() => lp.wuxingColor('雷'), 'INVALID_OPTION');
  });
  it('顏色輸入不合法丟 INVALID_COLOR', () => {
    for (const bad of ['red', '#fff', '#GGGGGG', '', null, 12, undefined]) throwsCode(() => lp.contrastRatio(bad, '#000000'), 'INVALID_COLOR');
  });
  it('疊層(規格 2.8.8、2.8.9): 天心十道 #D0342A 1px 不轉動、海底線 cinnabar_500 1.2px + 兩個 1.6px 紅點;兩處寫的紅色是同一個色票', () => {
    assert.deepEqual({ ...lp.OVERLAY_STYLE.tianxin }, { colorToken: 'cinnabar_500', widthPx: 1, rotates: false });
    assert.deepEqual({ ...lp.OVERLAY_STYLE.haidi }, { colorToken: 'cinnabar_500', widthPx: 1.2, dotRadiusPx: 1.6, dotCount: 2, from: 'center', to: 'north' });
    assert.equal(lp.PALETTE[lp.OVERLAY_STYLE.tianxin.colorToken], '#D0342A');
    assert.equal(lp.PALETTE[lp.OVERLAY_STYLE.haidi.colorToken], lp.PALETTE.cinnabar_500);
    // 紅線畫在深色漆面上要看得見
    assert.ok(lp.contrastRatio(lp.PALETTE.cinnabar_500, lp.PALETTE.lacquer_800) >= 3, '線條(非文字)至少 3:1');
  });
  it('磁針慣例(D61): 羅盤紅南黑北、現代慣例紅北黑南;天池旁小字標「北」', () => {
    assert.deepEqual({ ...lp.NEEDLE_CONVENTIONS.luopan }, { redEnd: 'south', blackEnd: 'north' });
    assert.deepEqual({ ...lp.NEEDLE_CONVENTIONS.modern }, { redEnd: 'north', blackEnd: 'south' });
    assert.equal(lp.NEEDLE_NORTH_LABEL, '北');
    assert.ok(lp.CHARSET_CORE.includes(lp.NEEDLE_NORTH_LABEL));
  });
  it('字型堆疊 == 規格 2.8.9,楷體優先、內嵌字型 LuopanKai 排第一、以 serif 收尾', () => {
    assert.equal(lp.KAI_FONT_STACK, H.SPEC_KAI_STACK);
    assert.ok(lp.KAI_FONT_STACK.startsWith('"LuopanKai"'));
    assert.ok(lp.KAI_FONT_STACK.endsWith(',serif'));
  });
});

// ═══════════════════════════ D. 字集(規格 2.8.9) ═══════════════════════════

describe('子集字型字集', () => {
  const cp = (s) => [...new Set(s)].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
  /** 由環資料與讀數列推出「預設盤面一定要有的字」,不看 fixtures。 */
  function requiredGlyphs() {
    const set = new Set([...'0123456789°']);
    const add = (s) => [...String(s)].forEach((ch) => set.add(ch));
    for (const c of cellsOf('mountains24')) { add(c.name); add(c.gua); add(c.dragon); add(c.yinyangSanyuan); add(c.wuxing); }
    for (const c of cellsOf('bagua')) { add(c.gua); add(c.dir8); add(c.wuxing); }
    for (const c of cellsOf('xiu28')) add(c.name);
    for (const c of cellsOf('solar_terms')) add(c.term);
    add('朝向坐山宮'); add('正兼空亡'); add('北');
    return set;
  }
  it('core 含預設盤面與讀數列用字(山、宮、朝已補),core 只多出 日月龍(七曜與龍字,沿用原字表)', () => {
    const core = new Set([...lp.CHARSET_CORE]);
    const need = requiredGlyphs();
    for (const ch of need) assert.ok(core.has(ch), `core 缺 ${ch}`);
    assert.deepEqual([...core].filter((ch) => !need.has(ch)).sort(), ['日', '月', '龍'].sort());
    assert.equal(lp.CHARSET_CORE, cp(lp.CHARSET_CORE), '依 codepoint 排序、不重複');
    assert.equal(new Set(lp.CHARSET_CORE).size, lp.CHARSET_CORE.length);
  });
  it('讀數列實例的每個字都在字集內(ASCII 標點走系統字型),含 24 山 × 各兼向', () => {
    const covered = new Set([...lp.fontSubsetCharset()]);
    for (let b = 0; b < 360; b += 7.5) {
      const text = lp.readout(b).text;
      for (const ch of text) {
        if (/[\s().,/\-+:]/.test(ch)) continue;
        assert.ok(covered.has(ch), `讀數 "${text}" 缺字 ${ch}`);
      }
    }
  });
  it('full = core ∪ 64 卦名 ∪ 分金名 ∪ 動物名 ∪ 太少半 ∪ 九星色字 ∪ 環名字;全部在 full 裡', () => {
    const full = new Set([...lp.fontSubsetCharset({ scope: 'full', nineStarColors: true, ringNames: true })]);
    for (const name of lp.HEXAGRAM_NAMES) for (const ch of name) assert.ok(full.has(ch), `full 缺 ${ch}(64 卦)`);
    for (const cell of cellsOf('fenjin120')) for (const ch of cell.name) assert.ok(full.has(ch), `full 缺 ${ch}(分金)`);
    for (const a of lp.XIU_ANIMALS) for (const ch of a) assert.ok(full.has(ch), `full 缺 ${ch}(動物)`);
    for (const ch of '太少半黑碧綠黃赤紫卦宿山節氣池洛書度百三二八六十四') assert.ok(full.has(ch), `full 缺 ${ch}`);
    for (const ch of lp.CHARSET_CORE) assert.ok(full.has(ch));
  });
  it('選項: 預設 core + 環名字、不含九星色;九星色字只在要顯示色名時才加(若顯示)', () => {
    const d = lp.fontSubsetCharset();
    assert.equal(d, cp(lp.CHARSET_CORE + lp.CHARSET_RING_NAMES));
    assert.ok(!'黑碧綠黃赤紫'.split('').some((ch) => d.includes(ch)));
    const withColors = lp.fontSubsetCharset({ nineStarColors: true });
    for (const ch of '黑碧綠黃赤紫') assert.ok(withColors.includes(ch));
    assert.equal(lp.fontSubsetCharset({ ringNames: false }), lp.CHARSET_CORE);
    throwsCode(() => lp.fontSubsetCharset({ scope: 'huge' }), 'INVALID_OPTION');
  });
  it('九星色字正好是九星色名扣掉 core 已有的字', () => {
    const colors = [...new Set(Object.values(lp.NINE_STAR_COLORS))].join('');
    assert.equal(cp([...colors].filter((ch) => !lp.CHARSET_CORE.includes(ch)).join('')), lp.CHARSET_NINE_STAR_COLORS);
  });
});

// ═══════════════════════════ E. 文字沿弧與 Canvas 角度 ═══════════════════════════

describe('文字沿弧(規格 2.8.8、2.8.1)', () => {
  it('位置公式 x = cx + r·sin b、y = cy - r·cos b;字頭朝外 rotate(b),朝內再轉 π', () => {
    for (let b = 0; b < 360; b += 7) {
      const t = lp.arcGlyphTransform({ bearing: b, r: 100, cx: 10, cy: 20 });
      assertApprox(t.x, 10 + 100 * Math.sin((b * Math.PI) / 180), 1e-9);
      assertApprox(t.y, 20 - 100 * Math.cos((b * Math.PI) / 180), 1e-9);
      assertApprox(t.rotateRad, (b * Math.PI) / 180, 1e-12);
      const inward = lp.arcGlyphTransform({ bearing: b, r: 100, cx: 10, cy: 20, glyphUp: 'inward' });
      assertApprox(inward.x, t.x, 1e-12);
      assertApprox(inward.y, t.y, 1e-12);
      assertApprox(circDiff((inward.rotateRad * 180) / Math.PI, (t.rotateRad * 180) / Math.PI), 180, 1e-9, `${b} 度朝內要多轉 π`);
      assert.ok(t.rotateRad >= 0 && t.rotateRad < 2 * Math.PI && inward.rotateRad >= 0 && inward.rotateRad < 2 * Math.PI);
    }
  });
  it('預設 cx=cy=0、glyphUp=outward;bearing 先正規化(-90 == 270、450 == 90)', () => {
    assert.deepEqual(lp.arcGlyphTransform({ bearing: -90, r: 50 }), lp.arcGlyphTransform({ bearing: 270, r: 50 }));
    assert.deepEqual(lp.arcGlyphTransform({ bearing: 450, r: 50 }), lp.arcGlyphTransform({ bearing: 90, r: 50 }));
  });
  it('多字沿弧: 字頭朝外時閱讀方向順時針;朝內時反向;奇偶字數對稱於 bearing', () => {
    for (const glyphUp of ['outward', 'inward']) {
      for (const count of [1, 2, 3, 4, 5]) {
        const a = lp.arcTextBearings({ bearing: 100, count, stepDeg: 4, glyphUp });
        assert.equal(a.length, count);
        assertApprox(a.reduce((x, y) => x + y, 0) / count, 100, 1e-12);
        if (count > 1) {
          const step = a[1] - a[0];
          assertApprox(Math.abs(step), 4, 1e-12);
          assert.equal(step > 0, glyphUp === 'outward');
        }
      }
    }
    assert.deepEqual(lp.arcTextBearings({ bearing: 0, count: 1, stepDeg: 9 }), [0]);
  });
  it('stepDegForWidth: 弧長 = r·θ;stackGlyphRadii 外側字先讀、字距 1.02×字級、以 r 為中心對稱', () => {
    assertApprox(lp.stepDegForWidth(13, 151.1), 4.9295, 1e-3);
    assertApprox(lp.stepDegForWidth(10, 100), (10 / 100) * (180 / Math.PI), 1e-12);
    const radii = lp.stackGlyphRadii({ count: 2, radiusPx: 128, px: 10.5 });
    assert.deepEqual(radii.map((x) => Math.round(x * 1000) / 1000), [133.355, 122.645]);
    assertApprox((radii[0] + radii[1]) / 2, 128, 1e-12);
    assert.ok(radii[0] > radii[1], '外側字先讀');
    assert.deepEqual(lp.stackGlyphRadii({ count: 1, radiusPx: 99, px: 12 }), [99]);
    assert.deepEqual(lp.stackGlyphRadii({ count: 3, radiusPx: 50, px: 10 }).map((x) => Math.round(x * 1000) / 1000), [60.2, 50, 39.8]);
  });
  it('Canvas 角度 (b-90)°: 北 = -π/2、東 = 0;bearingToCanvasRad 不正規化(270 → π)', () => {
    assert.equal(lp.bearingToCanvasRad(90), 0);
    assertApprox(lp.bearingToCanvasRad(0), -Math.PI / 2, 1e-15);
    assertApprox(lp.bearingToCanvasRad(270), Math.PI, 1e-15);
  });
  it('輸入不合法: bearing 非有限 → INVALID_BEARING;r、glyphUp、count → INVALID_OPTION', () => {
    throwsCode(() => lp.arcGlyphTransform({ bearing: NaN, r: 1 }), 'INVALID_BEARING');
    throwsCode(() => lp.arcGlyphTransform({ bearing: 0, r: -1 }), 'INVALID_OPTION');
    throwsCode(() => lp.arcGlyphTransform({ bearing: 0, r: 1, glyphUp: 'sideways' }), 'INVALID_OPTION');
    throwsCode(() => lp.arcTextBearings({ bearing: 0, count: 0, stepDeg: 5 }), 'INVALID_OPTION');
    throwsCode(() => lp.arcTextBearings({ bearing: 0, count: 2.5, stepDeg: 5 }), 'INVALID_OPTION');
    throwsCode(() => lp.arcTextBearings({ bearing: Infinity, count: 2, stepDeg: 5 }), 'INVALID_BEARING');
    throwsCode(() => lp.bearingToCanvasRad(NaN), 'INVALID_BEARING');
    throwsCode(() => lp.stackGlyphRadii({ count: 0, radiusPx: 10, px: 10 }), 'INVALID_OPTION');
  });
});

// ═══════════════════════════ F. 手勢: 角度展開、拖曳、慣性(規格 2.8.8) ═══════════════════════════

describe('拖曳角度展開', () => {
  /** 對任意 prev/cur: 結果在 [-180,180) 且 prev + d ≡ cur (mod 360)。 */
  it('屬性: 隨機 20000 組 prev、cur ∈ [-720,720],d ∈ [-180,180) 且 prev+d 與 cur 同餘', () => {
    let s = 12345;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 20000; i += 1) {
      const prev = rnd() * 1440 - 720;
      const cur = rnd() * 1440 - 720;
      const d = lp.unwrapAngleDelta(prev, cur);
      assert.ok(d >= -180 && d < 180, `${prev},${cur} → ${d}`);
      assert.ok(circDiff(prev + d, cur) < 1e-9, `${prev},${cur} → ${d}`);
    }
  });
  it('邊界: 差 180 度歸 -180;差 0 為 0;跨 ±180 不跳', () => {
    assert.equal(lp.unwrapAngleDelta(0, 180), -180);
    assert.equal(lp.unwrapAngleDelta(0, 0), 0);
    assert.equal(lp.unwrapAngleDelta(170, -170), 20);
    assert.equal(lp.unwrapAngleDelta(-170, 170), -20);
    assert.equal(lp.unwrapAngleDelta(359, 1), 2);
    assert.equal(lp.unwrapAngleDelta(1, 359), -2);
    assert.equal(lp.unwrapAngleDelta(-720, 720), 0);
  });
  it('輸入不是有限數字丟 INVALID_ANGLE', () => {
    for (const bad of [NaN, Infinity, '1', null, undefined]) {
      throwsCode(() => lp.unwrapAngleDelta(bad, 1), 'INVALID_ANGLE');
      throwsCode(() => lp.unwrapAngleDelta(1, bad), 'INVALID_ANGLE');
    }
  });
  it('pointerAngleDeg: 用 atan2(dy,dx),東 0、南 90、西 ±180、北 -90(Canvas 座標,y 向下)', () => {
    assertApprox(lp.pointerAngleDeg(10, 0, 0, 0), 0, 1e-12);
    assertApprox(lp.pointerAngleDeg(0, 10, 0, 0), 90, 1e-12);
    assertApprox(lp.pointerAngleDeg(0, -10, 0, 0), -90, 1e-12);
    assertApprox(Math.abs(lp.pointerAngleDeg(-10, 0, 0, 0)), 180, 1e-12);
    assertApprox(lp.pointerAngleDeg(15, 5, 5, 5), 0, 1e-12);
  });
});

describe('拖曳狀態機與慣性', () => {
  const G = lp.GESTURE;
  const C = { cx: 200, cy: 200 };
  const R = 180;
  const at = (deg, r = 120) => ({ px: C.cx + r * Math.cos((deg * Math.PI) / 180), py: C.cy + r * Math.sin((deg * Math.PI) / 180) });

  it('手勢參數 == 規格 2.8.8: τ=0.5 秒、停止 0.5°/s、天池內 0.16R 不啟動、放手前 80ms 內沒移動角速度歸 0', () => {
    assert.deepEqual({ ...G }, { tauSec: 0.5, minOmegaDegPerSec: 0.5, deadZoneFrac: 0.16, releaseIdleMs: 80, omegaBlend: 0.2, minDtMs: 1 });
  });
  it('天池內(離心 < 0.16R)不啟動;恰好 0.16R 啟動', () => {
    const inside = lp.dragStart(lp.createDragState(0), { ...at(10, 0.159 * R), ...C, radiusPx: R, tMs: 0 });
    assert.equal(inside.dragging, false);
    const edge = lp.dragStart(lp.createDragState(0), { ...at(10, 0.16 * R + 1e-9), ...C, radiusPx: R, tMs: 0 });
    assert.equal(edge.dragging, true);
    assert.equal(lp.isInDeadZone(C.cx, C.cy, C.cx, C.cy, R), true);
    assert.equal(lp.isInDeadZone(C.cx + 0.16 * R - 1e-6, C.cy, C.cx, C.cy, R), true);
    assert.equal(lp.isInDeadZone(C.cx + 0.16 * R + 1e-6, C.cy, C.cx, C.cy, R), false);
    // 未啟動時 dragMove 不動盤面
    const moved = lp.dragMove(inside, { ...at(50), ...C, tMs: 16 });
    assert.equal(moved.dialDeg, 0);
  });
  it('繞一整圈(每 10 度一個事件,經過 ±180 度)盤角累加 360 度,不因跨 ±180 而跳', () => {
    let st = lp.dragStart(lp.createDragState(0), { ...at(-170), ...C, radiusPx: R, tMs: 0 });
    let t = 0;
    for (let a = -160; a <= 190; a += 10) {
      t += 16;
      st = lp.dragMove(st, { ...at(a), ...C, tMs: t });
    }
    assertApprox(st.dialDeg, 360, 1e-9, '累加');
    // 反向再繞回去
    for (let a = 180; a >= -170; a -= 10) {
      t += 16;
      st = lp.dragMove(st, { ...at(a), ...C, tMs: t });
    }
    assertApprox(st.dialDeg, 0, 1e-9, '轉回原位');
  });
  it('角速度平滑 om = 0.8·om + 0.2·(d/dt·1000);等速拖曳收斂到真實角速度', () => {
    let st = lp.dragStart(lp.createDragState(0), { ...at(0), ...C, radiusPx: R, tMs: 0 });
    let t = 0;
    let a = 0;
    for (let i = 0; i < 80; i += 1) {
      t += 20; a += 2; // 100°/s
      st = lp.dragMove(st, { ...at(a), ...C, tMs: t });
    }
    assertApprox(st.omega, 100, 0.5, '收斂到 100 度/秒');
    // 第一個事件: 0.8*0 + 0.2*(2/20*1000) = 20
    let one = lp.dragStart(lp.createDragState(0), { ...at(0), ...C, radiusPx: R, tMs: 0 });
    one = lp.dragMove(one, { ...at(2), ...C, tMs: 20 });
    assertApprox(one.omega, 20, 1e-9);
  });
  it('LP-12 手勢 bug 迴歸: 按住不動超過 80ms 再放手,角速度歸 0(沒修就會甩出去)', () => {
    /** 原碼(規格 2.8.8 指出的 bug): 放手時直接沿用最後一次 pointermove 的 om。 */
    const buggyRelease = (omega) => omega;
    let st = lp.dragStart(lp.createDragState(0), { ...at(0), ...C, radiusPx: R, tMs: 0 });
    let t = 0;
    let a = 0;
    for (let i = 0; i < 20; i += 1) {
      t += 16; a += 8;
      st = lp.dragMove(st, { ...at(a), ...C, tMs: t });
    }
    assert.ok(st.omega > 100, '拖曳中有明顯角速度');
    assert.ok(buggyRelease(st.omega) > 100, '舊碼會用這個速度甩出去');
    const held = lp.dragEnd(st, { tMs: t + 1000 });
    assert.equal(held.omega0, 0, '按住 1 秒再放開');
    assert.equal(held.state.dragging, false);
    assert.equal(held.state.omega, 0);
    const heldJust = lp.dragEnd(st, { tMs: t + 81 });
    assert.equal(heldJust.omega0, 0, '81ms 已超過門檻');
    const quick = lp.dragEnd(st, { tMs: t + 80 });
    assert.equal(quick.omega0, st.omega, '恰好 80ms 仍算在動(> 80 才歸 0)');
    const quick2 = lp.dragEnd(st, { tMs: t + 10 });
    assert.ok(quick2.omega0 > 100);
  });
  it('prefers-reduced-motion(reducedMotion=true)放手後不慣性;沒在拖曳時 dragEnd 也是 0', () => {
    let st = lp.dragStart(lp.createDragState(0), { ...at(0), ...C, radiusPx: R, tMs: 0 });
    st = lp.dragMove(st, { ...at(10), ...C, tMs: 10 });
    assert.ok(st.omega > 0);
    assert.equal(lp.dragEnd(st, { tMs: 12, reducedMotion: true }).omega0, 0);
    assert.equal(lp.dragEnd(lp.createDragState(30), { tMs: 5 }).omega0, 0);
  });
  it('狀態函式不修改傳入的物件(凍結後仍可呼叫)', () => {
    const st0 = Object.freeze(lp.createDragState(15));
    const st1 = Object.freeze(lp.dragStart(st0, { ...at(0), ...C, radiusPx: R, tMs: 0 }));
    const st2 = Object.freeze(lp.dragMove(st1, { ...at(5), ...C, tMs: 16 }));
    lp.dragEnd(st2, { tMs: 20 });
    assert.equal(st0.dragging, false);
    assert.equal(st1.dialDeg, 15);
    assert.notEqual(st2.dialDeg, st1.dialDeg);
  });
  it('慣性: 單步指數衰減,總滑行 = ω0·τ;停止門檻 < 0.5°/s;符號保持', () => {
    const s = lp.inertiaStep(360, 0.1);
    assertApprox(s.omega, 360 * Math.exp(-0.1 / 0.5), 1e-9);
    assertApprox(s.deltaDeg, 360 * 0.5 * (1 - Math.exp(-0.1 / 0.5)), 1e-9);
    assert.equal(s.done, false);
    assert.equal(lp.inertiaStep(0.49, 0.016).done, true);
    assert.equal(lp.inertiaStep(-0.49, 0.016).deltaDeg, 0);
    assert.ok(lp.inertiaStep(-200, 0.016).deltaDeg < 0);
    assert.equal(lp.inertiaTotalDeg(360), 180);
    assert.equal(lp.inertiaTotalDeg(-360, 0.5), -180);
    assert.equal(lp.inertiaTotalDeg(0), 0);
  });
  it('慣性模擬: 總轉角 = τ(ω0 - ω末),與幀率無關(1/30、1/60、1/120 秒差 <= 0.25 度)', () => {
    for (const w0 of [360, 90, -720, 5]) {
      const totals = [1 / 30, 1 / 60, 1 / 120].map((dtSec) => {
        const sim = lp.simulateInertia(w0, { dtSec });
        assertApprox(sim.totalDeg, 0.5 * (w0 - sim.finalOmega), 1e-9, `ω0=${w0} dt=${dtSec}`);
        assert.ok(Math.abs(sim.finalOmega) < 0.5);
        assert.ok(Math.abs(w0 * 0.5 - sim.totalDeg) <= 0.25 + 1e-9);
        assert.equal(Math.sign(sim.totalDeg), Math.sign(w0));
        return sim.totalDeg;
      });
      assert.ok(Math.max(...totals) - Math.min(...totals) <= 0.25 + 1e-9);
    }
    const slow = lp.simulateInertia(0.3);
    assert.equal(slow.steps, 0);
    assert.equal(slow.totalDeg, 0);
    // 時間 ≈ τ·ln(ω0/0.5)
    const sim = lp.simulateInertia(360, { dtSec: 1 / 240 });
    assertApprox(sim.durationSec, 0.5 * Math.log(360 / 0.5), 1 / 240 + 1e-9);
  });
  it('輸入不合法: 慣性與拖曳丟 INVALID_ANGLE / INVALID_OPTION', () => {
    throwsCode(() => lp.inertiaStep(NaN, 0.016), 'INVALID_ANGLE');
    throwsCode(() => lp.inertiaStep(10, -1), 'INVALID_OPTION');
    throwsCode(() => lp.inertiaStep(10, 0.016, { tau: 0 }), 'INVALID_OPTION');
    throwsCode(() => lp.simulateInertia(Infinity), 'INVALID_ANGLE');
    throwsCode(() => lp.inertiaTotalDeg('1'), 'INVALID_ANGLE');
    throwsCode(() => lp.dragStart(lp.createDragState(0), { px: NaN, py: 0, ...C, radiusPx: R, tMs: 0 }), 'INVALID_POINT');
    throwsCode(() => lp.dragStart(lp.createDragState(0), { px: 1, py: 1, ...C, radiusPx: R, tMs: NaN }), 'INVALID_POINT');
    throwsCode(() => lp.dragMove(lp.createDragState(0), { px: 1, py: Infinity, ...C, tMs: 0 }), 'INVALID_POINT');
    throwsCode(() => lp.dragEnd(lp.createDragState(0), { tMs: '1' }), 'INVALID_POINT');
    throwsCode(() => lp.dragStart(lp.createDragState(0), { px: 1, py: 1, ...C, radiusPx: 0, tMs: 0 }), 'INVALID_OPTION');
    throwsCode(() => lp.createDragState(NaN), 'INVALID_ANGLE');
  });
});

describe('盤角、航向與山界觸覺', () => {
  it('盤角 = -航向: setAng(-90) → 90 度、setAng(-352.5) → 352.5;headingFromDialAngle 落在 [0,360) 且不出 -0', () => {
    assert.equal(lp.headingFromDialAngle(-90), 90);
    assert.equal(lp.headingFromDialAngle(-352.5), 352.5);
    assert.equal(lp.headingFromDialAngle(0), 0);
    assert.ok(Object.is(lp.headingFromDialAngle(0), 0));
    assert.equal(lp.headingFromDialAngle(-720), 0);
    assert.equal(lp.headingFromDialAngle(10), 350);
    for (let a = -1000; a <= 1000; a += 37.3) {
      const h = lp.headingFromDialAngle(a);
      assert.ok(h >= 0 && h < 360);
    }
  });
  it('dialAngleToward: 朝目標航向走最短弧;航向 359 → 1 時盤角只變 2 度(不倒轉一圈)', () => {
    let dial = lp.dialAngleToward(0, 359);
    assertApprox(dial, 1, 1e-9);
    const next = lp.dialAngleToward(dial, 1);
    assertApprox(next - dial, -2, 1e-9);
    assert.ok(circDiff(lp.headingFromDialAngle(next), 1) < 1e-9);
    for (let h = 0; h <= 720; h += 3.7) {
      const prev = dial;
      dial = lp.dialAngleToward(dial, h);
      assert.ok(Math.abs(dial - prev) <= 180 + 1e-9);
      assert.ok(circDiff(lp.headingFromDialAngle(dial), h % 360) < 1e-9, `h=${h}`);
    }
  });
  it('cssRotationDeg: southUp 是整盤 +180 度旋轉(不是鏡像),預設取 settings.southUp(false)', () => {
    assert.equal(DEFAULT_SETTINGS.southUp, false);
    assert.equal(lp.cssRotationDeg(30), 30);
    assert.equal(lp.cssRotationDeg(30, { southUp: true }), 210);
    assert.equal(lp.cssRotationDeg(-90, { southUp: false }), -90);
  });
  it('boundaryCrossings: 兩航向間跨過幾個 15 度山界,與 geo.mountainAt 逐 0.01 度掃描的換山次數一致', () => {
    const scan = (from, to) => {
      const d = lp.unwrapAngleDelta(from, to);
      const n = Math.ceil(Math.abs(d) / 0.01);
      let prev = geo.mountainAt(from).index;
      let changes = 0;
      for (let k = 1; k <= n; k += 1) {
        const idx = geo.mountainAt(from + (d * k) / n).index;
        if (idx !== prev) changes += 1;
        prev = idx;
      }
      return changes;
    };
    for (const [from, to] of [[0, 30], [350, 20], [20, 350], [7.4, 7.6], [7.6, 7.4], [100, 100], [0, 179], [359.9, 0.1], [10, 200], [-30, 30], [83, 97]]) {
      assert.equal(lp.boundaryCrossings(from, to), scan(from, to), `${from} → ${to}`);
    }
    assert.equal(lp.boundaryCrossings(0, 15), 1);
    assert.equal(lp.boundaryCrossings(0, 7.4), 0);
    assert.equal(lp.boundaryCrossings(0, 7.5), 1);
  });
});

// ═══════════════════════════ G. 即時讀數 readout(規格 2.8.8) ═══════════════════════════

describe('readout 讀數列', () => {
  it('規格範例: setAng(-90) → 「朝向 90.0° 卯山(震宮/天元) 坐酉」;setAng(-352.5) → 子山', () => {
    const r = lp.readout(lp.headingFromDialAngle(-90));
    assert.equal(r.text, '朝向 90.0° 卯山(震宮/天元) 坐酉');
    const z = lp.readout(lp.headingFromDialAngle(-352.5));
    assert.equal(z.mountain, '子');
    assert.equal(z.text, '朝向 352.5° 子山(坎宮/天元) 坐午');
  });
  it('欄位: 山、宮、方位、元龍、陰陽、坐山、坐方位角、宅卦、節氣、宿、分金', () => {
    const r = lp.readout(175);
    assert.equal(r.heading, 175);
    assert.equal(r.mountain, '午');
    assert.equal(r.gua, '離');
    assert.equal(r.dir8, '南');
    assert.equal(r.dragon, '天元');
    assert.equal(r.yinyang, '陰');
    assert.equal(r.sitMountain, '子');
    assert.equal(r.sitBearing, 355);
    assert.equal(r.zhaiGua, '坎');
    assert.equal(r.solarTerm, '夏至');
    assert.equal(r.xiu.name, '張');
    assert.equal(r.fenjin.name, '甲午');
    assert.equal(r.fenjin.displayable, true);
    assert.equal(r.analysis.leanTo, '丙');
    assert.equal(r.analysis.needsTiGua, true);
    assert.equal(r.analysis.mountain, r.mountain);
  });
  it('顯示的度數依 Math.floor(x*10+0.5) 取到 0.1 度;359.96 進位為 0.0 而不是 360.0', () => {
    assert.equal(lp.readout(359.96).text.startsWith('朝向 0.0° 子山'), true);
    assert.equal(lp.readout(359.96).heading, 359.96);
    assert.equal(lp.readout(-5).text.startsWith('朝向 355.0°'), true);
    assert.equal(lp.readout(365.04).text.startsWith('朝向 5.0°'), true);
    assert.equal(lp.readout(0.05).text.startsWith('朝向 0.1°'), true);
    assert.equal(lp.readout(0.04).text.startsWith('朝向 0.0°'), true);
    assert.equal(lp.readout(7.5).text.startsWith('朝向 7.5° 癸山'), true);
    assert.ok(!lp.readout(0).text.includes('-'));
    assert.ok(Object.is(lp.readout(-0).heading, 0), '-0 收成 0');
  });
  it('與 geo.analyzeBearing 逐項一致(隨機 3000 個航向,含負值與 > 360)', () => {
    let s = 987;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const opts = geo.boundaryOptsFromSettings({});
    for (let i = 0; i < 3000; i += 1) {
      const h = rnd() * 1800 - 720;
      const r = lp.readout(h);
      const a = geo.analyzeBearing(geo.normalizeBearing(h), opts);
      assert.equal(r.mountain, a.mountain);
      assert.equal(r.gua, a.gua);
      assert.equal(r.analysis.dev, a.dev);
      assert.equal(r.analysis.zone, a.zone);
      assert.equal(r.analysis.level, a.level);
      assert.equal(r.analysis.needsTiGua, a.needsTiGua);
      assert.equal(r.sitMountain, a.opposite);
      assert.equal(r.xiu.name, lp.cellAt('xiu28', h).name);
      assert.equal(r.solarTerm, lp.cellAt('solar_terms', h).term);
      assert.equal(r.fenjin.mountain, a.mountain);
    }
  });
  it('分金只顯示地支山: 174 度(午)displayable=true;10 度(癸)displayable=false 且 confidence=low', () => {
    const a = lp.readout(174).fenjin;
    assert.deepEqual([a.name, a.displayable, a.confidence], ['甲午', true, 'high']);
    const b = lp.readout(10).fenjin;
    assert.deepEqual([b.displayable, b.confidence], [false, 'low']);
  });
  it('設定: yinyangScheme 換三合紅黑字;showSanZhen 才回傳三針;southUp 不影響讀數', () => {
    assert.equal(lp.readout(0).yinyang, '陰');
    assert.equal(lp.readout(0, { yinyangScheme: 'sanhe' }).yinyang, '陽');
    assert.equal(lp.readout(0).sanzhen, null);
    const z = lp.readout(20, { showSanZhen: true }).sanzhen;
    assert.deepEqual(z, { di: geo.mountainAt(20).name, ren: geo.mountainAt(20, 'ren').name, tian: geo.mountainAt(20, 'tian').name });
    assert.equal(lp.readout(90, { southUp: true }).text, lp.readout(90).text);
    assert.equal(lp.readout(4.4, { xiaGuaHalfWidth: 3.5 }).analysis.zone, 'jian');
    assert.equal(lp.readout(4.4).analysis.zone, 'zheng');
    assert.equal(lp.readout(0, { jianLimitSchool: 'strict5' }).meta.ruleset.jianLimitSchool, 'strict5');
  });
  it('meta: schema 與 ruleset 含實際使用的設定(預設值取自 settings.js,覆寫後回存覆寫值)', () => {
    const r = lp.readout(10);
    assert.equal(r.meta.schema, 'fengshui.luopan.readout/1');
    assert.deepEqual(r.meta.ruleset, {
      xiaGuaHalfWidth: DEFAULT_SETTINGS.xiaGuaHalfWidth,
      jianLimitSchool: DEFAULT_SETTINGS.jianLimitSchool,
      kongwangLabelScheme: DEFAULT_SETTINGS.kongwangLabelScheme,
      measureUncertainty: DEFAULT_SETTINGS.measureUncertainty,
      yinyangScheme: DEFAULT_SETTINGS.yinyangScheme,
      showSanZhen: DEFAULT_SETTINGS.showSanZhen,
      southUp: DEFAULT_SETTINGS.southUp,
    });
    const o = lp.readout(10, { measureUncertainty: 8, yinyangScheme: 'sanhe', southUp: true, xiaGuaHalfWidth: 3 });
    assert.deepEqual([o.meta.ruleset.measureUncertainty, o.meta.ruleset.yinyangScheme, o.meta.ruleset.southUp, o.meta.ruleset.xiaGuaHalfWidth], [8, 'sanhe', true, 3]);
  });
  it('錯誤: 航向非有限 → INVALID_BEARING;不認得的設定鍵與值丟錯', () => {
    for (const bad of [NaN, Infinity, -Infinity, '90', null, undefined]) throwsCode(() => lp.readout(bad), 'INVALID_BEARING');
    assert.throws(() => lp.readout(0, { nortMode: 'true' }), /未知的設定鍵/);
    throwsCode(() => lp.readout(0, { yinyangScheme: 'x' }), 'INVALID_OPTION');
  });
  it('不修改傳入的 overrides;每次回傳新物件(改動結果不會污染下一次)', () => {
    const o = Object.freeze({ showSanZhen: true });
    const a = lp.readout(20, o);
    a.mountain = '被改掉';
    a.analysis.mountain = '被改掉';
    const b = lp.readout(20, o);
    assert.notEqual(b.mountain, '被改掉');
    assert.notEqual(b.analysis.mountain, '被改掉');
    assert.deepEqual(o, { showSanZhen: true });
  });
});

// ═══════════════════════════ H. JSON 可序列化、不可變、錯誤碼 ═══════════════════════════

describe('JSON 可序列化與不可變(規格 1.3)', () => {
  const roundTrips = (v) => assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
  it('常數與函式輸出都能 JSON 來回(無 undefined、NaN、函式、Date)', () => {
    roundTrips(lp.RINGS);
    roundTrips(lp.layoutRings('A'));
    roundTrips(lp.layoutRings('B', { R: 100 }));
    roundTrips(lp.readout(123.4));
    roundTrips(lp.readout(10, { showSanZhen: true }));
    roundTrips(lp.xiuAt(200));
    roundTrips(lp.fenjinAt(200));
    roundTrips(lp.hexagramAt(200));
    roundTrips(lp.solarTermAt(200));
    roundTrips(lp.kongwangBoundaries());
    roundTrips(lp.narrowMansions());
    roundTrips(lp.xiuLabelPlan());
    roundTrips(lp.arcGlyphTransform({ bearing: 12, r: 34 }));
    roundTrips(lp.simulateInertia(200));
    roundTrips(lp.dragStart(lp.createDragState(0), { px: 300, py: 200, cx: 200, cy: 200, radiusPx: 180, tMs: 0 }));
    roundTrips(lp.PALETTE);
    roundTrips(lp.SCALE_TICKS);
    const walk = (v, path) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path} 不是有限數`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      else assert.ok(v === null || ['string', 'boolean'].includes(typeof v), `${path} 型別 ${typeof v}`);
    };
    walk(lp.RINGS, 'RINGS');
    walk(lp.readout(50), 'readout');
  });
  it('匯出的常數是凍結的(嘗試修改會丟 TypeError),layoutRings 每次回傳新物件', () => {
    assert.throws(() => { lp.RINGS[0].label = 'x'; }, TypeError);
    assert.throws(() => { lp.RINGS.push({}); }, TypeError);
    assert.throws(() => { lp.PALETTE.gold_100 = '#000000'; }, TypeError);
    assert.throws(() => { cellsOf('xiu28')[0].name = 'x'; }, TypeError);
    assert.throws(() => { lp.GESTURE.tauSec = 9; }, TypeError);
    const a = lp.layoutRings('A');
    a.rows[0].r1 = 99;
    assert.equal(lp.layoutRings('A').rows[0].r1, 0.188);
  });
  it('錯誤碼: 未知的環、無格的環、模式、半徑', () => {
    throwsCode(() => lp.ringById('nope'), 'UNKNOWN_RING');
    throwsCode(() => lp.cellAt('nope', 0), 'UNKNOWN_RING');
    throwsCode(() => lp.cellAt('tianchi', 0), 'RING_NOT_CELLED');
    throwsCode(() => lp.cellAt('scale360', 0), 'RING_NOT_CELLED');
    throwsCode(() => lp.layoutRings('C'), 'INVALID_OPTION');
    throwsCode(() => lp.layoutRings('A', { R: 0 }), 'INVALID_OPTION');
    throwsCode(() => lp.layoutRings('A', { R: NaN }), 'INVALID_OPTION');
    throwsCode(() => lp.cellAt('bagua', NaN), 'INVALID_BEARING');
    throwsCode(() => lp.branchCellAt(Infinity), 'INVALID_BEARING');
    throwsCode(() => lp.fenjinAt('1'), 'INVALID_BEARING');
    throwsCode(() => lp.hexagramAt(undefined), 'INVALID_BEARING');
    throwsCode(() => lp.solarTermAt(NaN), 'INVALID_BEARING');
    throwsCode(() => lp.narrowMansions({ glyphPx: -1 }), 'INVALID_OPTION');
    throwsCode(() => lp.minGlyphAngleDeg(13, 0), 'INVALID_OPTION');
    throwsCode(() => lp.scaleTickKind(1.5), 'INVALID_OPTION');
  });
  it('bagua、luoshu 只有 8 格;luoshu 另帶中宮 5;yuan_band 的色帶 token 對應三元龍', () => {
    assert.deepEqual({ luoshu: lp.ringById('luoshu').center.luoshu, wuxing: lp.ringById('luoshu').center.wuxing }, { luoshu: 5, wuxing: '土' });
    for (const c of cellsOf('yuan_band')) assert.equal(c.bandToken, lp.DRAGON_BAND_TOKEN[c.dragon], c.name);
    const shapes = { 地支: 'circle', 天干: 'diamond', 四維卦: 'square' };
    for (const c of cellsOf('yuan_band')) assert.equal(c.markShape, shapes[c.kind], c.name);
  });
});

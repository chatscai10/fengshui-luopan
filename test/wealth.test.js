// wealth 模組測試。fixtures: wealth_position.json(附錄 B.4 修正後 72 案 = 71 案 + 補案 door_chong_slight_offset;
// 其中 61 星值表、62 五行催旺表是純資料,其餘 70 案可重算)。分數容差 0.011,幾何容差 1e-9。
// 硬/軟斷言(規格 4.1、4.2): confidence=low 原本走軟斷言,但 score_*、door_chong_*、zone_*、geom_* 的 low 案例都帶手算的期望值
// (規格 2.6.7「已驗證算術例」與各設計門檻),等於規則本身,所以本檔對所有案例一律硬斷言,另加突變測試、屬性測試、
// 規格內嵌表 == 實作常數、以及與獨立實作(test/helpers/wealth.js)的交叉比對。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, assertDeepApprox, assertRunnerCatches, circDiff } from './helpers/harness.js';
import {
  DIR8,
  DIR_OF,
  GUA8,
  LUOSHU_OF,
  deepFreeze,
  lShape,
  makePlan,
  mulberry32,
  oracleFly,
  oracleLDistances,
  oracleRectCorner,
  oracleStarDirs,
  parseSpecLShape,
  parseSpecScoreExample,
  parseSpecTables,
  randomPlanCase,
  randomRectCase,
  range,
  rectPoly,
} from './helpers/wealth.js';
import * as W from '../src/core/wealth.js';
import * as xuankong from '../src/core/xuankong.js';
import * as bazhai from '../src/core/bazhai.js';
import { guaAt } from '../src/core/geo.js';
import { sectorOfPoint } from '../src/core/plan.js';
import { toInstant } from '../src/core/calendar.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const FIX = loadFixture('wealth_position');
const TOL_SCORE = FIX.meta.tolerance.score;
const TOL_GEO = FIX.meta.tolerance.geometry;
const NOW = Date.UTC(2026, 8, 29, 4, 0, 0); // 2026-09-29 12:00 CST,九運、2026 流年
const clone = (x) => JSON.parse(JSON.stringify(x));
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.message.startsWith(`${code}:`), `應丟出 ${code}`);
const closeTo = (a, b, tol, ctx = '') => assert.ok(Math.abs(a - b) <= tol, `${ctx} expected ${b} ± ${tol}, got ${a}`);
const sameSet = (a, b, ctx = '') => assert.deepEqual([...a].sort(), [...b].sort(), ctx);
const dirToBearing = (dir) => 45 * DIR8.indexOf(dir);
const keyToDir = (k) => (k === '中' ? '中' : DIR_OF[k]);

// ═══════════════════════════ A. fixtures runner ═══════════════════════════

function runGeom(c) {
  const i = c.input;
  let door = i.door;
  if (c.name === 'geom_balcony_slider_is_real_door') {
    // 大門先進陽台(不在客廳),客廳只有落地窗滑門 → 落地窗才是客廳的門
    const picked = W.pickRoomDoor([{ kind: 'balconyDoor', ...i.door }]);
    assert.equal(picked.pos, i.door.pos);
    door = picked;
  }
  if (c.name === 'geom_two_openings_use_main_door') {
    // 走廊口屬內部動線不與大門競爭,不論清單順序
    const entrance = { kind: 'entrance', wall: i.door.wall, pos: i.door.pos, width: i.door.width };
    const corridor = { kind: 'door', ...i.other_openings[0] };
    assert.equal(W.pickRoomDoor([entrance, corridor]), entrance);
    assert.equal(W.pickRoomDoor([corridor, entrance]), entrance);
    door = entrance;
  }
  const r = W.mingCaiWei({ w: i.room.w, d: i.room.d }, { wall: door.wall, pos: door.pos, width: door.width });
  const names = r.corners.map((x) => x.name);
  if (c.expected.ordered) assert.deepEqual(names, c.expected.corners, `${c.name} 角落與順序`);
  else sameSet(names, c.expected.corners, `${c.name} 角落(不論順序)`);
  // 距離必須是歐氏距離,與獨立的「進門者左右手法」同一角(門居中的案例只驗集合)
  const doorPoint = { bottom: [door.pos, 0], top: [door.pos, i.room.d], left: [0, door.pos], right: [i.room.w, door.pos] }[door.wall];
  for (const corner of r.corners) closeTo(corner.walkDist, Math.hypot(corner.point[0] - doorPoint[0], corner.point[1] - doorPoint[1]), TOL_GEO, `${c.name} walkDist`);
  if (!r.centered) assertDeepApprox(r.corners[0].point, oracleRectCorner(i.room.w, i.room.d, door.wall, door.pos), TOL_GEO, `${c.name} oracle`);
  assert.equal(r.tied, c.expected.corners.length === 2);
}

function runRay45(c) {
  const hit = W.ray45Hit(c.input.room, c.input.door);
  assertDeepApprox(hit.hit, c.expected.hit, TOL_GEO);
  const viaMing = W.mingCaiWei(c.input.room, c.input.door, { showRay45: true });
  assertDeepApprox(viaMing.ray45.hit, c.expected.hit, TOL_GEO);
  assert.equal(W.mingCaiWei(c.input.room, c.input.door).ray45, null, '預設不顯示 45 度射線');
}

function runLShape(c) {
  const i = c.input;
  const r = W.mingCaiWei({ polygon: i.polygon }, { edgeIndex: i.door.edge_index, t: i.door.t });
  assert.equal(r.kind, 'polygon');
  assertDeepApprox(r.corners[0].point, c.expected.corner, TOL_GEO);
  closeTo(r.corners[0].walkDist, c.expected.walk_dist, 0.005 + TOL_GEO, 'L 型步行距離(fixture 取到小數 2 位)');
  // 精確值: 凹角 (2,3) 擋住直線,路徑經凹角
  closeTo(r.corners[0].walkDist, Math.hypot(2.2, 3) + Math.hypot(2, 3), 1e-9);
  assert.equal(r.tied, false, '第二遠 6.72 < 0.94 x 7.33');
  // 規格 2.6.3 印出的另外兩個距離
  const dists = W.walkDistances(i.polygon, r.door.point);
  const spec = parseSpecLShape();
  closeTo(dists[4], spec['2,6'], 0.005 + TOL_GEO);
  closeTo(dists[2], spec['5,3'], 0.005 + TOL_GEO);
}

function runZone(c) {
  const i = c.input;
  const r = W.cornerZoneStatus(i.room, i.corner, i.openings, { zone: i.zone_m, opening: W.PROFILES[i.profile].opening, onWalkway: i.on_walkway === true });
  assert.equal(r.status, c.expected.status, c.name);
}

const facingOfSitFace = (text) => dirToBearing(/朝(.+)$/.exec(text)[1]);

function runBazhaiHouse(c) {
  const r = W.bazhaiDarkWealth(facingOfSitFace(c.input.sit_face));
  assert.equal(r.houseGua, c.input.house_gua);
  assert.deepEqual(r.byStar, c.expected, `${c.name} 八星方位`);
  assert.deepEqual(oracleStarDirs(c.input.house_gua), c.expected, `${c.name} 獨立爻變重算`);
  // 財運面順序: 生氣、延年、天醫,伏位備位
  assert.deepEqual(r.order.map((o) => o.star), ['生氣', '延年', '天醫', '伏位']);
  assert.deepEqual(r.order.map((o) => o.dir), ['生氣', '延年', '天醫', '伏位'].map((s) => c.expected[s]));
}

function runBazhaiFacing(c) {
  const r = W.bazhaiDarkWealth(c.input.facing_deg);
  assert.ok(circDiff(r.sitBearing, c.expected.sit_deg) <= TOL_GEO, `${c.name} 坐 ${r.sitBearing}`);
  assert.equal(r.houseGua, c.expected.house_gua);
}

function runDoorWealth(c) {
  const r = W.bazhaiDarkWealth(dirToBearing(c.input.door_faces));
  assert.equal(r.houseGua, c.expected.house_gua);
  assert.equal(r.order[0].dir, c.expected['生氣位']);
  assert.equal(r.order[1].dir, c.expected['延年位']);
}

function runSectorBoundary(c) {
  assert.equal(guaAt(c.input.bearing_deg).gua, c.expected.sector, '22.5 度歸順時針下一宮');
}

function runLiunianYear(c) {
  const layer = W.annualWealthLayer({ fengshuiYear: c.input.year });
  assert.equal(layer.center, c.expected.center);
  for (const [k, v] of Object.entries(c.expected.grid)) assert.equal(layer.chart[k === '中' ? '中宮' : k], v, `${c.name} ${k}`);
  // 獨立飛星: 卦 → 星,再換成方位名
  const o = oracleFly(c.expected.center);
  for (const [g, star] of Object.entries(o)) assert.equal(layer.chartByGua[g], star);
}

function instantOf(datetime) {
  const m = /^(.*)([+-]\d{2}:\d{2})$/.exec(datetime);
  return toInstant({ local: m[1], utcOffset: m[2] });
}

function runLiunianBoundary(c) {
  const layer = W.annualWealthLayer({ instant: instantOf(c.input.datetime) });
  assert.equal(layer.fengshuiYear, c.expected.fengshui_year);
  assert.equal(layer.center, c.expected.center);
}

function runLiunianTable(c) {
  const [a, b] = c.input.years.split('-').map(Number);
  for (let y = a; y <= b; y += 1) assert.equal(W.annualWealthLayer({ fengshuiYear: y }).center, c.expected.centers[y], `${y}`);
  assert.equal(Object.keys(c.expected.centers).length, b - a + 1);
}

function runOccupation(c) {
  const r = W.occupationWealth(c.input.year);
  for (const job of ['文職', '外勤', '經商']) assert.equal(r[job].dir, c.expected[job], job);
  assert.deepEqual([r.文職.star, r.外勤.star, r.經商.star], [1, 6, 8]);
}

function runYunDisc(c) {
  const disc = xuankong.yunPan(c.input.yun);
  const byDir = Object.fromEntries(Object.entries(disc).map(([g, star]) => [keyToDir(g), star]));
  assert.deepEqual(byDir, c.expected.disc);
}

const palacesByDir = (chart, key) => Object.fromEntries(Object.entries(chart.palaces).map(([g, cell]) => [keyToDir(g), cell[key]]));

function runXkChart(c) {
  const chart = xuankong.buildChart(c.input.yun, c.input.sit, { ti: c.input.tigua });
  assert.equal(chart.meta.face, c.input.face);
  assert.deepEqual(palacesByDir(chart, 'shan'), c.expected.shan);
  assert.deepEqual(palacesByDir(chart, 'xiang'), c.expected.xiang);
  // 財位層讀到的是同一張盤(向 210 度 = 未山)
  const xk = xuankong.analyzeXuankong({ facing: 210, chartYun: c.input.yun, currentYun: c.input.yun });
  assert.deepEqual(palacesByDir(xk.chart, 'xiang'), c.expected.xiang);
}

/** 由 fixture 的方位名鍵組出 xuankong 形狀的盤(坐宮艮、向宮坤 = 丑山未向)。 */
function chartFromFixture(input) {
  const palaces = {};
  for (const dir of [...DIR8, '中']) {
    const g = dir === '中' ? '中' : GUA8[DIR8.indexOf(dir)];
    palaces[g] = { xiang: input.xiang[dir], shan: input.shan[dir], yun: null };
  }
  return { palaces, facePalace: '坤', sitPalace: '艮' };
}

function runXkCells(c) {
  const chart = chartFromFixture(c.input);
  const cells = W.xuankongWealthCells(chart, c.input.yun);
  for (const tier of ['primary', 'secondary', 'tertiary']) {
    const want = c.expected[tier];
    for (const [k, v] of Object.entries(want)) assert.equal(cells[tier][k], v, `${c.name} ${tier}.${k}`);
  }
  // 向宮(坤)在前方,不標 back
  assert.equal(cells.primary.wealthSide, null);
  // 與真的 丑山未向 盤一致
  const real = xuankong.buildChart(9, '丑');
  assert.deepEqual(palacesByDir(real, 'xiang'), c.input.xiang);
  assert.deepEqual(palacesByDir(real, 'shan'), c.input.shan);
}

function runEightYun(c) {
  const list = xuankong.listPatterns(c.input.yun)['雙星會向'];
  sameSet(list, c.expected.sets);
}

function runZibai(c) {
  const t = c.expected.table;
  assert.equal(c.expected.verified, true);
  for (const [gua, want] of Object.entries(t)) {
    // 坐山卦數入中順飛,表列星的所在宮
    const flown = oracleFly(LUOSHU_OF[gua]);
    const where = Object.keys(flown).find((g) => flown[g] === want.star);
    assert.equal(where === '中' ? '中宮' : DIR_OF[where], want.dir, `${gua} 宅 ${want.star} 星`);
  }
  assert.equal(Object.keys(t).length, 8);
}

/** S1 情境(九運丑山未向、2026 流年、坎命): 元件的共同前置。 */
function s1(input, profile = 'mingcai') {
  const xk = xuankong.analyzeXuankong({ facing: input.facing_deg, chartYun: input.yun, currentYun: input.yun });
  assert.equal(xk.chart.meta.sit, input.sit);
  assert.equal(xk.chart.meta.face, input.face);
  const house = W.bazhaiDarkWealth(input.facing_deg);
  const annual = W.annualWealthLayer({ fengshuiYear: input.year });
  const comps = W.sectorComponents(
    { chart: xk.chart, currentYun: input.yun, houseGua: house.houseGua, people: [{ id: 'p1', gua: input.ming_gua }], annualChartByGua: annual.chartByGua, profile },
    {},
  );
  return { xk, house, annual, comps };
}

function runComponents(c) {
  const { comps } = s1(c.input);
  for (const [g, want] of Object.entries(c.expected.components)) assertDeepApprox(comps.components[g], want, 1e-9, `${c.name} ${g}`);
}

function runSectorEnergy(c) {
  const { comps } = s1(c.input, c.input.profile);
  const energy = W.sectorEnergy(comps.components, c.input.profile);
  for (const g of GUA8) closeTo(energy[g], c.expected.scores[g], c.expected.tolerance, `${c.name} ${g}`);
  for (const g of GUA8) closeTo(W.scoreLocation(comps.components[g], { G: c.input.G, profile: c.input.profile }).score, c.expected.scores[g], c.expected.tolerance, `${c.name} scoreLocation ${g}`);
}

function runLocation(c) {
  const i = c.input;
  const { comps } = s1(i);
  // 平面圖: 外框 10x8(重心 = 房屋中心 (5,4)),客廳 6x5,門在下牆
  const plan = makePlan({
    outline: rectPoly(0, 0, 10, 8),
    rooms: [{ id: 'living', type: 'living', polygon: rectPoly(i.living_room.origin[0], i.living_room.origin[1], i.living_room.w, i.living_room.d) }],
    planUpBearing: i.plan_up_bearing_deg,
  });
  assert.deepEqual(sectorOfPoint(plan, i.house_center)?.gua ?? null, null, '房屋中心就是太極點');
  const ming = W.mingCaiWei({ w: i.living_room.w, d: i.living_room.d, origin: i.living_room.origin }, i.door);
  const primary = ming.corners[0];
  assert.equal(primary.name, c.expected.corner_name);
  assertDeepApprox(primary.point, i.corner, TOL_GEO);
  const info = sectorOfPoint(plan, primary.point);
  assert.equal(info.gua, c.expected.sector);
  assert.ok(circDiff(info.bearing, c.expected.bearing_deg) <= TOL_GEO);
  const G = primary.role === 'primary' ? W.G_VAL.mingPrimary : W.G_VAL.mingSecondCenter;
  assert.equal(G, c.expected.G);
  closeTo(W.scoreLocation(comps.components[info.gua], { G, flags: i.flags, profile: 'mingcai' }).score, c.expected.score_mingcai, c.expected.tolerance, 'mingcai');
  const xk = s1(i, 'xuankong');
  closeTo(W.scoreLocation(xk.comps.components[info.gua], { G, flags: i.flags, profile: 'xuankong' }).score, c.expected.score_xuankong, c.expected.tolerance, 'xuankong');
}

function runEnv(c) {
  const i = c.input;
  const { comps } = s1(i);
  const comp = comps.components[i.corner_sector];
  const mc = W.scoreLocation(comp, { G: i.G, flags: i.flags, profile: 'mingcai' });
  closeTo(mc.score, c.expected.score_mingcai, c.expected.tolerance ?? TOL_SCORE, `${c.name} mingcai`);
  if (c.expected.score_xuankong !== undefined) {
    const xk = s1(i, 'xuankong');
    const x = W.scoreLocation(xk.comps.components[i.corner_sector], { G: i.G, flags: i.flags, profile: 'xuankong' });
    closeTo(x.score, c.expected.score_xuankong, c.expected.tolerance ?? TOL_SCORE, `${c.name} xuankong`);
  }
}

function runRanking(c) {
  const i = c.input;
  const { comps } = s1(i);
  const scored = i.candidates.map((cd) => ({ id: cd.sector, label: cd.label, ...W.scoreLocation(comps.components[cd.sector], { G: cd.G, profile: 'mingcai' }), components: comps.components[cd.sector] }));
  const ranked = W.rankCandidates(scored);
  assert.deepEqual(ranked.map((x) => x.id), c.expected.ranking);
  for (const x of ranked) closeTo(x.score, c.expected.scores[x.id], c.expected.tolerance, `${c.name} ${x.id}`);
  assert.deepEqual(ranked.map((x) => x.rank), [1, 2, 3]);
}

const numKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v]));

function runValueTables(c) {
  assert.deepEqual(numKeys(W.XK9_VAL), c.expected.xk_9yun);
  assert.deepEqual(numKeys(W.YEAR_VAL), c.expected.liunian);
  assert.deepEqual(numKeys(W.BAZ_VAL), c.expected.bazhai);
  assert.match(c.notes, /二黑/, 'B.4: 註明二黑 -0.2 與 108s「遠生氣」衝突');
}

function runElementBoost(c) {
  const r = W.elementBoostForStar(c.input.star);
  assert.deepEqual(r.elements, c.expected.elements);
  assert.equal(r.note, c.expected.note);
  assert.equal(r.tag, 'source', '八白有直接來源');
}

function runShop(c) {
  const i = c.input;
  const r = W.seatCheck({ w: i.shop.w, d: i.shop.d }, i.door, { x: i.counter.x, y: i.counter.y }, i.counter.facing, i.counter.back_wall, i.counter.w);
  assert.equal(r.hardOk, c.expected.hard_ok, `${c.name} hard_ok`);
  assert.equal(r.alignedWithDoor, c.expected.aligned_with_door, `${c.name} aligned`);
  assert.equal(r.dragonSide, c.expected.dragon_side, `${c.name} dragon`);
  assert.equal(r.leftSideAgainstWall, c.expected.left_side_against_wall, `${c.name} left side`);
}

function runOffice(c) {
  const i = c.input;
  const r = W.seatCheck(i.room, i.door, { x: i.seat.x, y: i.seat.y }, i.seat.facing, i.seat.back_wall, i.seat.desk_w);
  assert.equal(r.backSolidWall, c.expected.back_solid_wall, `${c.name} back`);
  assert.equal(r.facesOrSeesDoor, c.expected.faces_or_sees_door, `${c.name} faces`);
  assert.equal(r.alignedWithDoor, c.expected.aligned_with_door, `${c.name} aligned`);
  assert.equal(r.inRearHalf, c.expected.in_rear_half, `${c.name} rear`);
}

function runChong(c) {
  const r = W.doorChong(c.input.front, c.input.opposite);
  assert.equal(r.chong, c.expected.chong, c.name);
  if (c.expected.level !== undefined) assert.equal(r.level, c.expected.level, `${c.name} level`);
}

const RUNNERS = [
  [/^geom_variant_ray45/, runRay45],
  [/^geom_L_shape/, runLShape],
  [/^geom_/, runGeom],
  [/^zone_/, runZone],
  [/^bazhai_house_/, runBazhaiHouse],
  [/^bazhai_facing_/, runBazhaiFacing],
  [/^bazhai_door_wealth/, runDoorWealth],
  [/^bazhai_sector_boundary/, runSectorBoundary],
  [/^liunian_(2016|2024|2025|2026)_flying_stars$/, runLiunianYear],
  [/^liunian_lichun_boundary_(before|after|minute_level)$/, runLiunianBoundary],
  [/^liunian_center_table/, runLiunianTable],
  [/^liunian_occupation/, runOccupation],
  [/^xk_9yun_base_disc$/, runYunDisc],
  [/^xk_9yun_chou_shan_wei_xiang_chart$/, runXkChart],
  [/^xk_wealth_cells/, runXkCells],
  [/^xk_8yun_double_star/, runEightYun],
  [/^zibai_/, runZibai],
  [/^score_components/, runComponents],
  [/^score_sector_energy/, runSectorEnergy],
  [/^score_location_ming_corner/, runLocation],
  [/^score_env_/, runEnv],
  [/^score_wall_backed/, runRanking],
  [/^score_star_value_tables$/, runValueTables],
  [/^element_boost/, runElementBoost],
  [/^shop_counter/, runShop],
  [/^office_/, runOffice],
  [/^door_chong/, runChong],
];
const runnerFor = (name) => RUNNERS.find(([re]) => re.test(name))?.[1];
const byName = Object.fromEntries(FIX.cases.map((c) => [c.name, c]));

describe('wealth_position.json fixtures', () => {
  it('案例數與 runner 覆蓋: 每個案例都有 runner', () => {
    assert.equal(FIX.cases.length, 72, '71 案 + 補案 door_chong_slight_offset');
    const missing = FIX.cases.filter((c) => !runnerFor(c.name)).map((c) => c.name);
    assert.deepEqual(missing, []);
    assert.equal(new Set(FIX.cases.map((c) => c.name)).size, FIX.cases.length, '案例名稱不重複');
  });
  for (const c of FIX.cases) {
    it(`${c.name} [${c.confidence}]`, () => {
      runnerFor(c.name)(c);
    });
  }
});

// ═══════════════════════════ B. 突變測試(規則 4.2 第 3 點) ═══════════════════════════

describe('突變測試: runner 抓得出被改錯的期望值', () => {
  const mutate = (name, fn) => {
    const x = clone(byName[name]);
    fn(x);
    return x;
  };
  // 必須是斷言失敗(AssertionError),不能是 TypeError 之類的程式錯誤,否則改壞的期望值不算被抓到
  const catches = (runner, bad) => {
    assertRunnerCatches(runner, bad);
    assert.throws(() => runner(bad), (e) => e instanceof assert.AssertionError, '突變沒有被斷言抓到(或是丟了非斷言錯誤)');
  };
  it('幾何: 角落、順序、L 型座標', () => {
    catches(runGeom, mutate('geom_rect_door_bottom_left', (x) => { x.expected.corners = ['TL']; }));
    catches(runGeom, mutate('geom_rect_door_bottom_near_center_within_band', (x) => { x.expected.corners = ['TR', 'TL']; }));
    catches(runGeom, mutate('geom_rect_door_bottom_outside_band', (x) => { x.expected.corners = ['TL', 'TR']; }));
    catches(runRay45, mutate('geom_variant_ray45_hit_point', (x) => { x.expected.hit = [4, 2.9]; }));
    catches(runLShape, mutate('geom_L_shape_geodesic_far_convex90_corner', (x) => { x.expected.corner = [2, 6]; }));
    catches(runLShape, mutate('geom_L_shape_geodesic_far_convex90_corner', (x) => { x.expected.walk_dist = 7.4; }));
  });
  it('角落檢核', () => {
    catches(runZone, mutate('zone_window_in_corner_mingcai', (x) => { x.expected.status = 'ok'; }));
    catches(runZone, mutate('zone_window_in_corner_xuankong_intake', (x) => { x.expected.status = 'void_window'; }));
    catches(runZone, mutate('zone_door_in_corner_blocked', (x) => { x.expected.status = 'void_window'; }));
  });
  it('八宅與流年', () => {
    catches(runBazhaiHouse, mutate('bazhai_house_坎', (x) => { [x.expected.生氣, x.expected.天醫] = [x.expected.天醫, x.expected.生氣]; }));
    catches(runBazhaiFacing, mutate('bazhai_facing_210_to_house', (x) => { x.expected.house_gua = '坤'; }));
    catches(runLiunianYear, mutate('liunian_2026_flying_stars', (x) => { x.expected.grid['東'] = 9; }));
    catches(runLiunianBoundary, mutate('liunian_lichun_boundary_before', (x) => { x.expected.fengshui_year = 2026; }));
    catches(runLiunianTable, mutate('liunian_center_table_9yun', (x) => { x.expected.centers['2030'] = 5; }));
    catches(runOccupation, mutate('liunian_occupation_layer_2024', (x) => { x.expected.經商 = '東'; }));
  });
  it('玄空', () => {
    catches(runXkCells, mutate('xk_wealth_cells_chou_wei', (x) => { x.expected.secondary.sector = '震'; }));
    catches(runXkCells, mutate('xk_wealth_cells_chou_wei', (x) => { x.expected.tertiary.note = '旺財'; }));
    catches(runZibai, mutate('zibai_zuoxiang_table_equals_zuoshan_ru_zhong', (x) => { x.expected.table.坎.dir = '南'; }));
    catches(runXkChart, mutate('xk_9yun_chou_shan_wei_xiang_chart', (x) => { x.expected.xiang['西南'] = 1; }));
  });
  it('分數', () => {
    catches(runComponents, mutate('score_components_S1', (x) => { x.expected.components['震'].XK = 0.7; }));
    catches(runSectorEnergy, mutate('score_sector_energy_mingcai_S1', (x) => { x.expected.scores['震'] = 37; }));
    catches(runLocation, mutate('score_location_ming_corner_S1', (x) => { x.expected.score_mingcai = 67; }));
    catches(runLocation, mutate('score_location_ming_corner_S1', (x) => { x.expected.sector = '巽'; }));
    catches(runEnv, mutate('score_env_toilet_adjacent_penalty', (x) => { x.expected.score_mingcai = 53.6; }));
    catches(runEnv, mutate('score_env_toilet_in_corner_zeroes_candidate', (x) => { x.expected.score_mingcai = 1; }));
    catches(runRanking, mutate('score_wall_backed_corner_vs_ming_corner_S1', (x) => { x.expected.ranking = ['震', '坎', '坤']; }));
    catches(runValueTables, mutate('score_star_value_tables', (x) => { x.expected.liunian['9'] = 1; }));
    catches(runElementBoost, mutate('element_boost_for_star', (x) => { x.expected.elements = ['金', '土']; }));
  });
  it('座位與門沖', () => {
    catches(runShop, mutate('shop_counter_ideal', (x) => { x.expected.hard_ok = false; }));
    catches(runShop, mutate('shop_counter_aligned_with_door_and_tiger_side', (x) => { x.expected.dragon_side = true; }));
    catches(runShop, mutate('shop_counter_ideal', (x) => { x.expected.left_side_against_wall = true; }));
    catches(runOffice, mutate('office_boss_seat_command_position', (x) => { x.expected.in_rear_half = false; }));
    catches(runOffice, mutate('office_desk_facing_door_directly', (x) => { x.expected.aligned_with_door = false; }));
    catches(runChong, mutate('door_chong_aligned', (x) => { x.expected.chong = false; }));
    catches(runChong, mutate('door_chong_slight_offset', (x) => { x.expected.level = 'chong'; }));
  });
});

// ═══════════════════════════ C. 規格內嵌表 == 實作常數(4.2 第 6 點) ═══════════════════════════

describe('規格內嵌資料表 == 實作', () => {
  const spec = parseSpecTables();
  it('2.6.7 的 PROFILES、BAZ_VAL、XK9_VAL、YEAR_VAL、G', () => {
    assert.deepEqual(clone(W.PROFILES), spec.PROFILES);
    assert.deepEqual(clone(W.BAZ_VAL), spec.BAZ_VAL);
    assert.deepEqual(clone(W.XK9_VAL), spec.XK9_VAL);
    assert.deepEqual(clone(W.YEAR_VAL), spec.YEAR_VAL);
    assert.deepEqual(clone(W.G_VAL), spec.G);
  });
  it('BAZ_VAL 與 bazhai 的星權重是同一份(不手打第二份)', () => {
    assert.deepEqual(clone(W.BAZ_VAL), bazhai.starWeights({}));
  });
  it('環境乘數、旗標、角區與門居中門檻 == fixtures meta.defaults', () => {
    const d = FIX.meta.defaults;
    assert.equal(W.ENV_FLAGS.opening.mult.penalty, d.opening_penalty_mingcai);
    assert.equal(W.ENV_FLAGS.opening.mult.reward, d.opening_bonus_xuankong);
    for (const k of ['beam', 'dark', 'sharp', 'no_solid_wall', 'toilet_adjacent', 'stove_facing']) assert.equal(W.ENV_FLAGS[k].mult, d[k], k);
    sameSet(W.EXCLUSION_FLAGS, d.exclusion_flags);
    assert.equal(W.ENV_FLOOR, 0.4);
    // 預設角區 1.0 公尺與門居中帶 10%: 由行為驗證(端點恰在角區邊界的窗不算,越過 5 公分才算)
    const room = { w: 4, d: 5 };
    assert.equal(W.cornerZoneStatus(room, 'TR', [{ wall: 'right', start: 3.0, end: 3.9, type: 'window' }], {}).status, 'ok', '窗止於 y=4-0.1: 角區 y∈[4,5]');
    assert.equal(W.cornerZoneStatus(room, 'TR', [{ wall: 'right', start: 3.0, end: 4.06, type: 'window' }], {}).status, 'void_window');
    assert.equal(d.zone_m, 1);
    assert.equal(d.center_band, 0.1);
  });
  it('規格 2.6.7 已驗證算術例的數字(66.88/59.25、33.44/62.21、53.50、40.00、75 度)可由實作重算', () => {
    const ex = parseSpecScoreExample();
    const input = { facing_deg: 210, sit: '丑', face: '未', yun: 9, year: 2026, ming_gua: '坎' };
    const mc = s1(input).comps.components['震'];
    const xk = s1(input, 'xuankong').comps.components['震'];
    closeTo(W.scoreLocation(mc, { G: 1, profile: 'mingcai' }).score, ex.mingcai, TOL_SCORE);
    closeTo(W.scoreLocation(xk, { G: 1, profile: 'xuankong' }).score, ex.xuankong, TOL_SCORE);
    closeTo(W.scoreLocation(mc, { G: 1, profile: 'mingcai', flags: { opening: true } }).score, ex.windowMingcai, TOL_SCORE);
    closeTo(W.scoreLocation(xk, { G: 1, profile: 'xuankong', flags: { opening: true } }).score, ex.windowXuankong, TOL_SCORE);
    closeTo(W.scoreLocation(mc, { G: 1, profile: 'mingcai', flags: { toilet_adjacent: true } }).score, ex.toiletAdjacent, TOL_SCORE);
    closeTo(W.scoreLocation(s1(input).comps.components['坤'], { G: 0.5, profile: 'mingcai' }).score, ex.southwestWall, TOL_SCORE);
    assert.equal(ex.bearing, 75);
  });
});

// ═══════════════════════════ D. 明財位幾何 ═══════════════════════════

describe('mingCaiWei 幾何', () => {
  it('屬性: 10000 組隨機矩形與門位置,距離法 == 進門者左右手法(規格說 20 萬組 0 不一致)', () => {
    const rng = mulberry32(20260929);
    for (let n = 0; n < 10000; n += 1) {
      const { w, d, wall, pos } = randomRectCase(rng);
      const r = W.mingCaiWei({ w, d }, { wall, pos, width: 0.9 });
      assertDeepApprox(r.corners[0].point, oracleRectCorner(w, d, wall, pos), 1e-9, JSON.stringify({ w, d, wall, pos }));
      assert.equal(r.corners.length, r.centered ? 2 : 1, '門在居中帶內兩角並列,否則單角');
      assert.equal(r.corners[0].role, 'primary');
    }
  });
  it('屬性: 矩形與「多邊形路徑」(門給邊上的點)的 primary 同一角', () => {
    const rng = mulberry32(7);
    for (let n = 0; n < 500; n += 1) {
      const { w, d, wall, pos } = randomRectCase(rng);
      const rect = W.mingCaiWei({ w, d }, { wall, pos });
      const doorPoint = rect.door.point;
      const poly = W.mingCaiWei({ polygon: rectPoly(0, 0, w, d) }, { point: doorPoint });
      assertDeepApprox(poly.corners[0].point, rect.corners[0].point, 1e-9);
      closeTo(poly.corners[0].walkDist, rect.corners[0].walkDist, 1e-9);
    }
  });
  it('屬性: 水平鏡射(x → w-x)讓明財位角跟著鏡射,並且與原本互為龍虎相反', () => {
    const rng = mulberry32(99);
    for (let n = 0; n < 500; n += 1) {
      const { w, d, wall, pos } = randomRectCase(rng);
      const mirrorWall = { bottom: 'bottom', top: 'top', left: 'right', right: 'left' }[wall];
      const mirrorPos = wall === 'bottom' || wall === 'top' ? w - pos : pos;
      const a = W.mingCaiWei({ w, d }, { wall, pos }).corners[0];
      const b = W.mingCaiWei({ w, d }, { wall: mirrorWall, pos: mirrorPos }).corners[0];
      assertDeepApprox(b.point, [w - a.point[0], a.point[1]], 1e-9);
      assert.notEqual(a.dragonSide, b.dragonSide, '鏡射後龍虎邊互換');
    }
  });
  it('屬性: 原點平移不改結果(origin)', () => {
    const a = W.mingCaiWei({ w: 4, d: 5 }, { wall: 'bottom', pos: 0.8 });
    const b = W.mingCaiWei({ w: 4, d: 5, origin: [10, -3] }, { wall: 'bottom', pos: 0.8 });
    assert.equal(a.corners[0].name, b.corners[0].name);
    assertDeepApprox(b.corners[0].point, [14, 2], 1e-9);
    closeTo(a.corners[0].walkDist, b.corners[0].walkDist, 1e-9);
  });
  it('門居中帶: 邊界 |pos - L/2| = 0.1L 並列,越過即單角;龍邊是進門者右手邊', () => {
    const r = (pos, opt) => W.mingCaiWei({ w: 10, d: 4 }, { wall: 'bottom', pos }, opt);
    assert.deepEqual(r(4.0).corners.map((c) => c.name), ['TR', 'TL'], '門在帶邊界偏左: 較遠的右角 primary');
    assert.equal(r(4.0).tied, true, '帶邊界恰好算居中');
    assert.equal(r(3.99).tied, false);
    assert.equal(r(3.99).corners[0].name, 'TR', '門偏左 → 遠端右角');
    assert.equal(r(6.01).corners[0].name, 'TL', '門偏右 → 遠端左角');
    // 正中: 距離相同,龍邊(進門者右手 = TR)排前
    const mid = r(5);
    assert.deepEqual(mid.corners.map((c) => c.name), ['TR', 'TL']);
    assert.equal(mid.corners[0].dragonSide, true);
    // 偏右但仍在帶內: 較遠的左角 primary,右角(龍邊)並列
    assert.deepEqual(r(5.5).corners.map((c) => c.name), ['TL', 'TR']);
    // preferDragonSide(D44): 門居中只取龍邊,不論門偏哪邊
    assert.deepEqual(r(5.5, { preferDragonSide: true }).corners.map((c) => c.name), ['TR']);
    assert.deepEqual(r(5, { preferDragonSide: true }).corners.map((c) => c.name), ['TR']);
    assert.equal(r(5, { preferDragonSide: true }).dragonOnly, true);
    // 不在居中帶時 preferDragonSide 沒作用
    assert.deepEqual(r(1, { preferDragonSide: true }).corners.map((c) => c.name), ['TR']);
    assert.deepEqual(r(9, { preferDragonSide: true }).corners.map((c) => c.name), ['TL']);
    // 自訂帶寬
    assert.equal(W.mingCaiWei({ w: 10, d: 4 }, { wall: 'bottom', pos: 3 }, { centerBand: 0.2 }).tied, true);
    assert.equal(W.mingCaiWei({ w: 10, d: 4 }, { wall: 'bottom', pos: 3 }, { centerBand: 0 }).tied, false);
  });
  it('龍邊方向對四面牆的門都一致: 進門者右手邊', () => {
    // 門在下牆正中,進門者面朝 +y,右手是 +x
    assert.equal(W.mingCaiWei({ w: 4, d: 4 }, { wall: 'bottom', pos: 2 }).corners[0].point[0], 4);
    // 門在上牆正中,進門者面朝 -y,右手是 -x
    assert.equal(W.mingCaiWei({ w: 4, d: 4 }, { wall: 'top', pos: 2 }).corners[0].point[0], 0);
    // 門在左牆正中,進門者面朝 +x,右手是 -y
    assert.equal(W.mingCaiWei({ w: 4, d: 4 }, { wall: 'left', pos: 2 }).corners[0].point[1], 0);
    // 門在右牆正中,進門者面朝 -x,右手是 +y
    assert.equal(W.mingCaiWei({ w: 4, d: 4 }, { wall: 'right', pos: 2 }).corners[0].point[1], 4);
  });
  it('45 度射線: 只在 showRay45 時附上,由門朝遠離較近端的一側射入', () => {
    assertDeepApprox(W.ray45Hit({ w: 8, d: 3 }, { wall: 'bottom', pos: 1 }).hit, [4, 3], 1e-9);
    assertDeepApprox(W.ray45Hit({ w: 8, d: 3 }, { wall: 'bottom', pos: 7 }).hit, [4, 3], 1e-9);
    assertDeepApprox(W.ray45Hit({ w: 3, d: 8 }, { wall: 'bottom', pos: 1 }).hit, [3, 2], 1e-9, '窄長房間先撞側牆');
    assert.equal(W.ray45Hit({ w: 3, d: 8 }, { wall: 'bottom', pos: 1 }).wall, 'right');
    assertDeepApprox(W.ray45Hit({ w: 6, d: 6 }, { wall: 'left', pos: 1 }).hit, [5, 6], 1e-9);
    assertDeepApprox(W.ray45Hit({ w: 6, d: 6 }, { wall: 'bottom', pos: 3 }).hit, [6, 3], 1e-9, '正中朝龍邊(右手)');
  });
  it('多邊形: 順逆時針一樣、凹角不當候選、並列門檻是「第二遠 >= 門檻 x 最遠」', () => {
    const L = [[0, 0], [5, 0], [5, 3], [2, 3], [2, 6], [0, 6]];
    const ccw = W.mingCaiWei({ polygon: L }, { edgeIndex: 0, pos: 4.2, width: 0.9 });
    const cw = W.mingCaiWei({ polygon: [...L].reverse() }, { point: [4.2, 0] });
    assertDeepApprox(cw.corners[0].point, ccw.corners[0].point, 1e-9);
    assert.deepEqual(W.rightAngleVertices(L), [0, 1, 2, 4, 5], '(2,3) 是 270 度凹角,不列');
    assert.equal(W.rightAngleVertices([...L].reverse()).length, 5);
    // 並列邊界: 10x10 方形以多邊形處理,門在下牆 x=3,遠角 (10,10) 與 (0,10) 的距離比 = hypot(3,10)/hypot(7,10) 約 0.855
    const sq = { polygon: rectPoly(0, 0, 10, 10) };
    const door = { edgeIndex: 0, pos: 3 };
    const ratio = Math.hypot(3, 10) / Math.hypot(7, 10);
    assert.equal(W.mingCaiWei(sq, door).tied, false, `${ratio.toFixed(3)} < 0.94`);
    assert.equal(W.mingCaiWei(sq, door, { tieRatio: ratio }).tied, true, '恰等於門檻算並列(>=)');
    assert.equal(W.mingCaiWei(sq, door, { tieRatio: ratio + 1e-6 }).tied, false);
    assert.deepEqual(W.mingCaiWei(sq, door, { tieRatio: ratio }).corners.map((c) => c.role), ['primary', 'second']);
    assert.equal(W.mingCaiWei(sq, { edgeIndex: 0, pos: 4.7 }).tied, true, '接近正中: 0.976 >= 0.94');
    assert.equal(W.mingCaiWei(sq, { edgeIndex: 0, pos: 5 }).tied, true, '完全對稱 → 並列');
    assert.equal(W.mingCaiWei(sq, { edgeIndex: 0, pos: 5 }).centered, null, '多邊形沒有「門居中帶」的概念');
  });
  it('U 型: 路徑可擦過凹角頂點(與凹角共線不算被擋),距離相同的兩角並列', () => {
    const U = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
    const d = W.walkDistances(U, [3, 0]);
    closeTo(d[2], Math.hypot(3, 6), 1e-9, '(6,6) 擦過 (4,2)');
    closeTo(d[7], Math.hypot(3, 6), 1e-9, '(0,6) 擦過 (2,2)');
    closeTo(d[3], Math.hypot(1, 2) + 4, 1e-9, '(4,6): (3,0)→(4,2)→(4,6)');
    closeTo(d[6], Math.hypot(1, 2) + 4, 1e-9);
    assert.deepEqual(W.rightAngleVertices(U), [0, 1, 2, 3, 6, 7], '(4,2)、(2,2) 是凹角');
    const r = W.mingCaiWei({ polygon: U }, { edgeIndex: 0, pos: 3 });
    assert.deepEqual(r.corners.map((c) => c.name), ['V2', 'V7'], '6.708 對 6.236 = 0.93 < 0.94,只有最遠的兩個並列');
    assert.equal(r.tied, true);
  });
  it('多邊形屬性: 100 組隨機 L 型,可見性圖最短路 == 獨立 oracle(精確線段對凹槽相交)', () => {
    const rng = mulberry32(424242);
    for (let n = 0; n < 100; n += 1) {
      const W0 = range(rng, 4, 10);
      const H0 = range(rng, 4, 10);
      const w1 = range(rng, 1, W0 - 1);
      const h1 = range(rng, 1, H0 - 1);
      const poly = lShape(W0, H0, w1, h1);
      const e = Math.floor(rng() * 6);
      const t = 0.1 + 0.8 * rng();
      const a = poly[e];
      const b = poly[(e + 1) % 6];
      const from = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const got = W.walkDistances(poly, from);
      const want = oracleLDistances(W0, H0, w1, h1, from);
      got.forEach((g, i) => closeTo(g, want[i], 1e-6, `L(${W0.toFixed(2)},${H0.toFixed(2)},${w1.toFixed(2)},${h1.toFixed(2)}) edge ${e} t ${t.toFixed(2)} 頂點 ${i}`));
    }
  });
  it('錯誤碼: INVALID_ROOM、INVALID_DOOR、INVALID_OPTION', () => {
    throwsCode(() => W.mingCaiWei({ w: 0, d: 3 }, { wall: 'bottom', pos: 1 }), 'INVALID_ROOM');
    throwsCode(() => W.mingCaiWei({ w: NaN, d: 3 }, { wall: 'bottom', pos: 1 }), 'INVALID_ROOM');
    throwsCode(() => W.mingCaiWei(null, { wall: 'bottom', pos: 1 }), 'INVALID_ROOM');
    throwsCode(() => W.mingCaiWei({ polygon: [[0, 0], [1, 1]] }, { point: [0, 0] }), 'INVALID_ROOM');
    throwsCode(() => W.mingCaiWei({ polygon: [[0, 0], [2, 2], [2, 0], [0, 2]] }, { point: [1, 1] }), 'INVALID_ROOM');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'north', pos: 1 }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: 3.5 }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: NaN }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: 1, width: -1 }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ polygon: rectPoly(0, 0, 3, 3) }, { point: [1, 1] }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ polygon: rectPoly(0, 0, 3, 3) }, { edgeIndex: 9, pos: 1 }), 'INVALID_DOOR');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: 1 }, { centerBand: 0.9 }), 'INVALID_OPTION');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: 1 }, { nope: 1 }), 'INVALID_OPTION');
    throwsCode(() => W.mingCaiWei({ w: 3, d: 3 }, { wall: 'bottom', pos: 1 }, { preferDragonSide: 'yes' }), 'INVALID_OPTION');
    throwsCode(() => W.walkDistances(rectPoly(0, 0, 3, 3), [9, 9]), 'INVALID_DOOR');
  });
  it('不修改輸入', () => {
    const room = deepFreeze({ polygon: [[0, 0], [5, 0], [5, 3], [2, 3], [2, 6], [0, 6]] });
    const door = deepFreeze({ edgeIndex: 0, t: 0.84 });
    assert.doesNotThrow(() => W.mingCaiWei(room, door));
  });
});

// ═══════════════════════════ E. 角落範圍檢核 ═══════════════════════════

describe('cornerZoneStatus', () => {
  const room = { w: 4, d: 5 };
  const win = (start, end, wall = 'right', type = 'window') => ({ wall, start, end, type });
  it('重疊 5 公分門檻: 恰 0.05 不算,超過才算', () => {
    // TR 角區: 右牆 y∈[4,5]、上牆 x∈[3,4]
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.0, 4.05)]).status, 'ok');
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.0, 4.0501)]).status, 'void_window');
  });
  it('四個角各自的角區座標', () => {
    const at = (corner, wall, start, end) => W.cornerZoneStatus(room, corner, [win(start, end, wall)]).status;
    assert.equal(at('BL', 'bottom', 0.2, 0.9), 'void_window');
    assert.equal(at('BL', 'left', 0.2, 0.9), 'void_window');
    assert.equal(at('BL', 'bottom', 1.2, 2), 'ok');
    assert.equal(at('BR', 'bottom', 3.2, 3.9), 'void_window');
    assert.equal(at('BR', 'right', 0.2, 0.9), 'void_window');
    assert.equal(at('TL', 'top', 0.2, 0.9), 'void_window');
    assert.equal(at('TL', 'left', 4.2, 4.9), 'void_window');
    assert.equal(at('TL', 'left', 0.2, 0.9), 'ok');
    assert.equal(at('TR', 'top', 3.2, 3.9), 'void_window');
    assert.equal(at('TR', 'bottom', 3.2, 3.9), 'ok', '別面牆不算');
  });
  it('優先序: 門 > 動線 > 落地窗 > 窗 > ok;reward 檔視窗為納氣但成立', () => {
    const both = [win(4.2, 4.8), win(3.2, 3.8, 'top', 'floor_window')];
    assert.equal(W.cornerZoneStatus(room, 'TR', both).status, 'void_floor_window');
    assert.equal(W.cornerZoneStatus(room, 'TR', [...both, win(3.1, 3.9, 'top', 'door')]).status, 'blocked_opening');
    assert.equal(W.cornerZoneStatus(room, 'TR', both, { onWalkway: true }).status, 'blocked_walkway');
    assert.equal(W.cornerZoneStatus(room, 'TR', [...both, win(3.1, 3.9, 'top', 'door')], { onWalkway: true }).status, 'blocked_opening');
    const reward = W.cornerZoneStatus(room, 'TR', both, { opening: 'reward' });
    assert.equal(reward.status, 'qi_intake_ok');
    assert.equal(reward.voidKind, 'void_floor_window');
    assert.equal(reward.holds, true);
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.1, 3.9, 'top', 'door')], { opening: 'reward' }).status, 'blocked_opening', '玄空派也不接受門與通道');
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.1, 3.9, 'top', 'door')]).holds, false);
    // 別名
    for (const type of ['floorWindow', 'floor_window']) assert.equal(W.cornerZoneStatus(room, 'TR', [win(4.2, 4.8, 'right', type)]).status, 'void_floor_window');
    for (const type of ['door', 'entrance', 'balconyDoor', 'balcony_door', 'passage', 'corridor', 'opening']) assert.equal(W.cornerZoneStatus(room, 'TR', [win(4.2, 4.8, 'right', type)]).status, 'blocked_opening', type);
  });
  it('自訂角區大小', () => {
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.4, 3.9)], { zone: 1.6 }).status, 'void_window');
    assert.equal(W.cornerZoneStatus(room, 'TR', [win(3.4, 3.9)], { zone: 1 }).status, 'ok');
  });
  it('多邊形的角: 以邊編號與自邊起點量的距離', () => {
    const L = [[0, 0], [5, 0], [5, 3], [2, 3], [2, 6], [0, 6]];
    // 頂點 5 = (0,6): 前一邊 4 [(2,6)→(0,6)] 長 2,角區 [1,2];後一邊 5 [(0,6)→(0,0)] 角區 [0,1]
    assert.equal(W.cornerZoneStatus({ polygon: L }, 5, [{ edgeIndex: 4, start: 1.2, end: 1.9, type: 'window' }]).status, 'void_window');
    assert.equal(W.cornerZoneStatus({ polygon: L }, 'V5', [{ edgeIndex: 5, start: 0.2, end: 0.9, type: 'door' }]).status, 'blocked_opening');
    assert.equal(W.cornerZoneStatus({ polygon: L }, 5, [{ edgeIndex: 5, start: 2, end: 3, type: 'window' }]).status, 'ok');
  });
  it('錯誤碼', () => {
    throwsCode(() => W.cornerZoneStatus(room, 'XX', []), 'INVALID_CORNER');
    throwsCode(() => W.cornerZoneStatus({ polygon: rectPoly(0, 0, 3, 3) }, 7, []), 'INVALID_CORNER');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [{ wall: 'right', start: 1, end: 2, type: 'skylight' }]), 'INVALID_OPENING');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [{ wall: 'up', start: 1, end: 2, type: 'window' }]), 'INVALID_OPENING');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [{ wall: 'right', start: 2, end: 1, type: 'window' }]), 'INVALID_OPENING');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', 'x'), 'INVALID_OPENING');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [], { zone: 0 }), 'INVALID_OPTION');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [], { opening: 'maybe' }), 'INVALID_OPTION');
    throwsCode(() => W.cornerZoneStatus(room, 'TR', [], { bogus: 1 }), 'INVALID_OPTION');
  });
});

// ═══════════════════════════ F. 門沖與座位 ═══════════════════════════

describe('doorChong(D49 兩級門檻)', () => {
  const f = { pos: 5, width: 1 };
  const opp = (pos, width = 1) => ({ pos, width });
  it('80% 門檻: 恰 80% 是門沖,略低是輕微偏移;50% 是輕微偏移,略低為無', () => {
    assert.equal(W.doorChong(f, opp(5.2)).level, 'chong', '重疊 0.8 = 80%');
    assert.equal(W.doorChong(f, opp(5.21)).level, 'slight');
    assert.equal(W.doorChong(f, opp(5.5)).level, 'slight', '重疊 0.5 = 50%');
    assert.equal(W.doorChong(f, opp(5.51)).level, 'none');
    assert.equal(W.doorChong(f, opp(9)).level, 'none');
  });
  it('以較窄者寬度為分母', () => {
    const r = W.doorChong({ pos: 5, width: 2 }, { pos: 5, width: 0.5 });
    assert.equal(r.ratio, 1);
    assert.equal(r.chong, true);
    // 前門 [4.75,5.25] 整個落在對門 [4.4,6.4] 內: 重疊 = 較窄者全寬
    closeTo(W.doorChong({ pos: 5, width: 0.5 }, { pos: 5.4, width: 2 }).ratio, 1, 1e-9);
    closeTo(W.doorChong({ pos: 5, width: 0.5 }, { pos: 6, width: 2 }).ratio, 0.25 / 0.5, 1e-9, '對門 [5,7] 與前門 [4.75,5.25] 重疊 0.25');
  });
  it('兩門之間有遮擋物(玄關、牆、櫃)不判沖', () => {
    const r = W.doorChong(f, opp(5), { shielded: true });
    assert.equal(r.chong, false);
    assert.equal(r.level, 'none');
    assert.equal(r.shielded, true);
    assert.equal(r.ratio, 1, '重疊比照實回報');
  });
  it('自訂門檻與錯誤碼', () => {
    assert.equal(W.doorChong(f, opp(5.3), { chongRatio: 0.7 }).level, 'chong');
    throwsCode(() => W.doorChong({ pos: 1 }, opp(1)), 'INVALID_DOOR');
    throwsCode(() => W.doorChong(f, { pos: 1, width: 0 }), 'INVALID_DOOR');
    throwsCode(() => W.doorChong(f, opp(1), { chongRatio: 0.3 }), 'INVALID_OPTION');
    throwsCode(() => W.doorChong(f, opp(1), { shielded: 1 }), 'INVALID_OPTION');
    throwsCode(() => W.doorChong(f, opp(1), { x: 1 }), 'INVALID_OPTION');
  });
});

describe('seatCheck(店面與辦公室)', () => {
  const room = { w: 6, d: 8 };
  const door = { wall: 'bottom', pos: 1.5, width: 1.2 };
  it('龍邊 = 面向店門時的左手邊: 四面牆的門各自旋轉後一致', () => {
    // 座位在「進門者右手邊」= 龍邊。四種門牆,各放一個進門者右手邊的座位。
    const cases = [
      { wall: 'bottom', seat: { x: 5, y: 4 } }, // 面朝 +y,右手 +x
      { wall: 'top', seat: { x: 1, y: 4 } }, // 面朝 -y,右手 -x
      { wall: 'left', seat: { x: 3, y: 1 } }, // 面朝 +x,右手 -y
      { wall: 'right', seat: { x: 3, y: 7 } }, // 面朝 -x,右手 +y
    ];
    for (const c of cases) {
      const len = c.wall === 'bottom' || c.wall === 'top' ? 6 : 8;
      const r = W.seatCheck({ w: 6, d: 8 }, { wall: c.wall, pos: len / 2, width: 1 }, c.seat, 'up', null, 1);
      assert.equal(r.dragonSide, true, c.wall);
    }
    // 反邊為虎邊
    assert.equal(W.seatCheck(room, { wall: 'bottom', pos: 3, width: 1 }, { x: 1, y: 4 }, 'up', null, 1).dragonSide, false);
  });
  it('左側靠牆: 座位自己的左端到牆的縫隙 <= 10 公分', () => {
    // 面朝下(-y),自己的左手是 +x(東): 左端 = x + 寬/2
    const at = (x) => W.seatCheck(room, door, { x, y: 7, }, 'down', 'top', 1.6).leftSideAgainstWall;
    assert.equal(at(5.2), true, '左端 6.0,貼右牆');
    assert.equal(at(5.1), true, '縫隙 0.1');
    assert.equal(at(5.0), false, '縫隙 0.2');
    // 面朝上(+y),自己的左手是 -x: 左端 = x - 寬/2
    assert.equal(W.seatCheck(room, door, { x: 0.8, y: 1 }, 'up', null, 1.6).leftSideAgainstWall, true);
    assert.equal(W.seatCheck(room, door, { x: 3, y: 1 }, 'up', null, 1.6).leftSideAgainstWall, false);
  });
  it('正對大門: 重疊 5 公分門檻;座位背對門仍以側向重疊計(參考實作)', () => {
    const aligned = (x, width) => W.seatCheck(room, door, { x, y: 5 }, 'down', 'top', width).alignedWithDoor;
    // 門洞 [0.9,2.1];座位 [x-0.5,x+0.5]
    assert.equal(aligned(2.55, 1), false, '重疊 0.05 不算(恰好門檻)');
    assert.equal(aligned(2.54, 1), true);
    assert.equal(aligned(1.5, 0.2), true);
    assert.equal(aligned(4, 1), false);
  });
  it('後半判定與面向', () => {
    const at = (y) => W.seatCheck(room, door, { x: 4, y }, 'down', 'top', 1).inRearHalf;
    assert.equal(at(4.01), true);
    assert.equal(at(4), false, '恰在中線不算後半');
    // 門在左牆: 離門牆的距離看 x
    assert.equal(W.seatCheck(room, { wall: 'left', pos: 4, width: 1 }, { x: 2.99, y: 4 }, 'left', 'right', 1).inRearHalf, false, '縱深 6 → 中線 3');
    assert.equal(W.seatCheck(room, { wall: 'left', pos: 4, width: 1 }, { x: 3.01, y: 4 }, 'left', 'right', 1).inRearHalf, true);
    assert.equal(W.seatCheck(room, { wall: 'left', pos: 4, width: 1 }, { x: 3.01, y: 4 }, 'left', 'right', 1).facesOrSeesDoor, true);
    // 面朝向量與名稱一致
    const byVec = W.seatCheck(room, door, { x: 4, y: 6 }, [0, -3], 'top', 1);
    const byName = W.seatCheck(room, door, { x: 4, y: 6 }, 'down', 'top', 1);
    assert.deepEqual(byVec, byName);
  });
  it('findings: 每個不理想項各一則,且帶 tag 與信心', () => {
    const r = W.seatCheck(room, door, { x: 1.5, y: 1.5 }, 'up', null, 1.6);
    const ids = r.findings.map((x) => x.id);
    for (const id of ['wealth.seat.no_back_wall', 'wealth.seat.back_to_door', 'wealth.seat.aligned_with_door', 'wealth.seat.tiger_side', 'wealth.seat.left_not_against_wall', 'wealth.seat.not_rear_half']) {
      assert.ok(ids.includes(id), id);
    }
    for (const f of r.findings) assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag));
    assert.equal(r.findings.find((x) => x.id === 'wealth.seat.not_rear_half').tag, 'design');
    assert.equal(r.findings.find((x) => x.id === 'wealth.seat.not_rear_half').confidence, 'low');
    const ok = W.seatCheck(room, door, { x: 5.2, y: 6.6 }, 'down', 'top', 1.6);
    assert.deepEqual(ok.findings, [], '理想位置沒有提示');
    assert.equal(ok.hardOk, true);
  });
  it('錯誤碼與不修改輸入', () => {
    throwsCode(() => W.seatCheck({ w: 0, d: 3 }, door, { x: 1, y: 1 }, 'up', null, 1), 'INVALID_ROOM');
    throwsCode(() => W.seatCheck(room, { wall: 'x', pos: 1, width: 1 }, { x: 1, y: 1 }, 'up', null, 1), 'INVALID_DOOR');
    throwsCode(() => W.seatCheck(room, { wall: 'bottom', pos: 1 }, { x: 1, y: 1 }, 'up', null, 1), 'INVALID_DOOR');
    throwsCode(() => W.seatCheck(room, door, { x: 7, y: 1 }, 'up', null, 1), 'INVALID_SEAT');
    throwsCode(() => W.seatCheck(room, door, { x: 1, y: 1 }, 'north', null, 1), 'INVALID_SEAT');
    throwsCode(() => W.seatCheck(room, door, { x: 1, y: 1 }, [0, 0], null, 1), 'INVALID_SEAT');
    throwsCode(() => W.seatCheck(room, door, { x: 1, y: 1 }, 'up', 'sky', 1), 'INVALID_SEAT');
    throwsCode(() => W.seatCheck(room, door, { x: 1, y: 1 }, 'up', null, 0), 'INVALID_SEAT');
    assert.doesNotThrow(() => W.seatCheck(deepFreeze({ w: 6, d: 8 }), deepFreeze({ ...door }), deepFreeze({ x: 1, y: 1 }), 'up', null, 1));
  });
});

// ═══════════════════════════ G. 暗財位各層 ═══════════════════════════

describe('暗財位各層', () => {
  it('八宅: 8 個宅 x 8 顆星 = 獨立爻變重算,坐山每一度都不回 undefined', () => {
    for (let k = 0; k < 8; k += 1) {
      const facing = (45 * k + 180) % 360; // 坐 = 45k
      const r = W.bazhaiDarkWealth(facing);
      assert.equal(r.houseGua, GUA8[k]);
      assert.deepEqual(r.byStar, oracleStarDirs(GUA8[k]), GUA8[k]);
      assert.deepEqual(Object.values(r.byDir).sort(), ['五鬼', '六煞', '天醫', '延年', '生氣', '禍害', '絕命', '伏位'].sort());
    }
    for (const f of [-720.5, -1, 0, 359.999, 360, 1e6 + 0.3]) assert.ok(GUA8.includes(W.bazhaiDarkWealth(f).houseGua), String(f));
    throwsCode(() => W.bazhaiDarkWealth(NaN), 'INVALID_BEARING');
  });
  it('八宅財位序: 生氣 > 延年 > 天醫,伏位備位;tianyiFirst 對調延年與天醫(WP-1)', () => {
    const r = W.bazhaiDarkWealth(180);
    assert.deepEqual(r.order.map((o) => [o.star, o.dir, o.gua]), [['生氣', '東南', '巽'], ['延年', '南', '離'], ['天醫', '東', '震'], ['伏位', '北', '坎']]);
    assert.equal(r.order[3].backup, true);
    assert.deepEqual(r.order.map((o) => o.value), [1, 0.75, 0.55, 0.25]);
    const t = W.bazhaiDarkWealth(180, { tianyiFirst: true });
    assert.deepEqual(t.order.slice(0, 3).map((o) => o.star), ['生氣', '天醫', '延年']);
    const custom = W.bazhaiDarkWealth(180, { bazhaiStarWeights: { 延年: 0.5, 天醫: 0.9 } });
    assert.deepEqual(custom.order.slice(0, 3).map((o) => o.star), ['生氣', '天醫', '延年']);
    throwsCode(() => W.bazhaiDarkWealth(180, { nope: 1 }), 'INVALID_SETTING');
  });
  it('本命財位: 命卦生氣為主', () => {
    const r = W.mingGuaWealth('坎');
    assert.equal(r.order[0].dir, '東南');
    assert.deepEqual(r.byStar, oracleStarDirs('坎'));
    throwsCode(() => W.mingGuaWealth('中'), 'UNKNOWN_GUA');
  });
  it('xuankongWealthCells: 九運 = 當旺 9、生氣 1、退氣 8;坐宮標 back;非九運為推論', () => {
    const chart = xuankong.buildChart(9, '丑');
    const cells = W.xuankongWealthCells(chart, 9);
    assert.deepEqual([cells.primary.sector, cells.secondary.sector, cells.tertiary.sector], ['坤', '坎', '震']);
    assert.equal(cells.primary.tag, 'source');
    assert.equal(cells.tertiary.note, '退氣財星,忌大水');
    assert.equal(cells.primary.side, 'front');
    // 雙星會坐: 向星 9 在坐宮 → wealthSide='back'
    const hui = xuankong.listPatterns(9)['雙星會坐'];
    assert.ok(hui.length > 0);
    const sit = hui[0].split('山')[0];
    const c2 = xuankong.buildChart(9, sit);
    const cell = W.xuankongWealthCells(c2, 9).primary;
    assert.equal(cell.sector, c2.sitPalace);
    assert.equal(cell.wealthSide, 'back');
    // 八運盤: 泛化為推論
    const c8 = W.xuankongWealthCells(xuankong.buildChart(8, '子'), 8);
    assert.equal(c8.primary.tag, 'inference');
    assert.equal(c8.primary.star, 8);
    assert.equal(c8.tertiary.star, 7);
    throwsCode(() => W.xuankongWealthCells({}, 9), 'INVALID_INPUT');
    throwsCode(() => W.xuankongWealthCells(chart, 10), 'INVALID_YUN');
  });
  it('流年財位: 2026 立春換年、八白在東、九紫在東南、六白在北、四綠在東北', () => {
    const l = W.annualWealthLayer({ fengshuiYear: 2026 });
    const dirOf = (star) => l.wealthStars.find((w) => w.star === star).dir;
    assert.equal(dirOf(8), '東');
    assert.equal(dirOf(9), '東南');
    assert.equal(dirOf(6), '北');
    assert.equal(dirOf(4), '東北');
    assert.equal(dirOf(1), '中宮');
    assert.equal(l.wuhuangGua, '離');
    assert.equal(l.erheiGua, '乾');
    assert.deepEqual(l.wealthStars.map((w) => w.value), [1, 0.8, 0.6, 0.6, 0.2]);
    assert.equal(l.wealthStars.find((w) => w.star === 9).tag, 'inference', '九紫 = 當運旺星加分,非傳統財星');
    assert.match(l.wealthStars.find((w) => w.star === 9).note, /並非傳統上的財星/);
    // yearVal 覆寫
    const l2 = W.annualWealthLayer({ fengshuiYear: 2026 }, { yearVal: { 9: 0.5 } });
    assert.equal(l2.wealthStars.find((w) => w.star === 9).value, 0.5);
    assert.deepEqual(W.yearValues({ yearVal: { 9: 0.5 } })[9], 0.5);
    throwsCode(() => W.yearValues({ yearVal: { 10: 1 } }), 'INVALID_SETTING');
    throwsCode(() => W.yearValues({ yearVal: { 9: 'x' } }), 'INVALID_SETTING');
    throwsCode(() => W.yearValues({ yearVal: 'weird' }), 'INVALID_SETTING');
  });
  it('立春臨界: 立春前後幾分鐘換年,不在 04:01:30-04:02:30 之間取樣', () => {
    const at = (hhmm) => W.annualWealthLayer({ instant: toInstant({ local: `2026-02-04T${hhmm}`, utcOffset: '+08:00' }) }).fengshuiYear;
    assert.equal(at('04:00'), 2025);
    assert.equal(at('04:05'), 2026);
    assert.equal(W.annualWealthLayer({ fengshuiYear: 2026 }).lichunCST.slice(0, 10), '2026-02-04');
  });
  it('九運水火提示: 通則兩層 + 個案,南方不寫「忌水」', () => {
    const chart = xuankong.buildChart(9, '丑');
    const h = W.waterHints(chart, 9);
    assert.deepEqual(h.map((x) => [x.layer, x.palace, x.tag]), [['general', '坎', 'source'], ['general', '離', 'inference'], ['case', '坎', 'inference']]);
    assert.ok(!h.some((x) => x.palace === '離' && /忌水/.test(x.text.replace('沒有提到忌水', ''))), '南方不寫忌水');
    assert.match(h[2].text, /可以考慮小水/, '丑山未向北方坎宮向星一白 → 小水');
    assert.deepEqual(W.waterHints(chart, 8), [], '通則只對九運');
    assert.equal(W.waterHints(null, 9).length, 2, '沒有盤只給通則');
  });
  it('五行催旺: 八白有來源,其他為推論', () => {
    assert.deepEqual(W.elementBoostForStar(9).elements, ['火', '木']);
    assert.equal(W.elementBoostForStar(9).tag, 'inference');
    assert.equal(W.elementBoostForStar(9).confidence, 'low');
    assert.deepEqual(W.elementBoostForStar(1).elements, ['水', '金']);
    assert.deepEqual(W.elementBoostForStar(6).elements, ['金', '土']);
    assert.deepEqual(W.elementBoostForStar(4).elements, ['木', '水']);
    throwsCode(() => W.elementBoostForStar(0), 'INVALID_STAR');
  });
});

// ═══════════════════════════ H. 元件與分數 ═══════════════════════════

describe('sectorComponents / scoreLocation / rankCandidates', () => {
  const input = { facing_deg: 210, sit: '丑', face: '未', yun: 9, year: 2026, ming_gua: '坎' };
  const base = () => s1(input);
  it('沒有的層不計: 無 chart → XK=0、無住戶 → P=0、無宅卦 → H=0、無流年 → Y=0', () => {
    const c = W.sectorComponents({}, {});
    for (const g of GUA8) assert.deepEqual(c.components[g], { XK: 0, H: 0, P: 0, Y: 0 });
    assert.equal(c.meta.hasResidents, false);
    assert.equal(c.meta.hasChart, false);
    const { xk, house, annual } = base();
    const nores = W.sectorComponents({ chart: xk.chart, currentYun: 9, houseGua: house.houseGua, annualChartByGua: annual.chartByGua });
    for (const g of GUA8) assert.equal(nores.components[g].P, 0);
  });
  it('多位住戶(D53): mean 取平均、breadwinner 加倍、each 附 perPerson', () => {
    const { xk, house, annual } = base();
    const ctx = (people) => ({ chart: xk.chart, currentYun: 9, houseGua: house.houseGua, annualChartByGua: annual.chartByGua, people });
    const people = [{ id: 'a', gua: '坎', role: 'wife' }, { id: 'b', gua: '乾', role: 'breadwinner' }];
    const val = (gua, sector) => W.BAZ_VAL[bazhai.starOf(gua, sector)];
    const mean = W.sectorComponents(ctx(people), { multiOccupantPolicy: 'mean' });
    const bw = W.sectorComponents(ctx(people), { multiOccupantPolicy: 'breadwinner' });
    const each = W.sectorComponents(ctx(people), { multiOccupantPolicy: 'each' });
    for (const g of GUA8) {
      closeTo(mean.components[g].P, (val('坎', g) + val('乾', g)) / 2, 1e-12, g);
      closeTo(bw.components[g].P, (val('坎', g) + 2 * val('乾', g)) / 3, 1e-12, g);
      closeTo(each.components[g].P, mean.components[g].P, 1e-12, 'each 主分數取平均');
      assert.equal(each.perPerson.a[g], val('坎', g));
      assert.equal(each.perPerson.b[g], val('乾', g));
    }
    assert.deepEqual(bw.meta.weights, { a: 1, b: 2 });
    // 只有一人時三種政策相同
    const one = [{ id: 'a', gua: '坎' }];
    for (const policy of ['mean', 'breadwinner', 'each']) assert.equal(W.sectorComponents(ctx(one), { multiOccupantPolicy: policy }).components['震'].P, 0.55);
    // 沒角色資料時 breadwinner 取第一位
    const nr = W.sectorComponents(ctx([{ id: 'a', gua: '坎' }, { id: 'b', gua: '乾' }]), { multiOccupantPolicy: 'breadwinner' });
    assert.deepEqual(nr.meta.weights, { a: 2, b: 1 });
    throwsCode(() => W.sectorComponents(ctx(people), { multiOccupantPolicy: 'x' }), 'INVALID_SETTING');
  });
  it('坐宮財星在後方(wealthSide=back): XK 分量乘 0.5', () => {
    const sit = xuankong.listPatterns(9)['雙星會坐'][0].split('山')[0];
    const chart = xuankong.buildChart(9, sit);
    const c = W.sectorComponents({ chart, currentYun: 9 }, {});
    const g = chart.sitPalace;
    assert.deepEqual(c.meta.backPalaces, [g]);
    const cell = chart.palaces[g];
    const raw = 0.75 * W.XK9_VAL[cell.xiang] + 0.25 * W.XK9_VAL[cell.shan];
    closeTo(c.components[g].XK, raw * 0.5, 1e-12);
    // 沒有 back 的宮不受影響
    const other = GUA8.find((x) => x !== g && chart.palaces[x].xiang === 1);
    if (other) closeTo(c.components[other].XK, 0.75 * W.XK9_VAL[chart.palaces[other].xiang] + 0.25 * W.XK9_VAL[chart.palaces[other].shan], 1e-12);
  });
  it('currentYun 不是 9: 玄空星值改用 qiScore/3,meta 標 xkValFallback', () => {
    const chart = xuankong.buildChart(8, '子');
    const c = W.sectorComponents({ chart, currentYun: 8 }, {});
    assert.equal(c.meta.xkValFallback, true);
    const g = '坎';
    const q = (star) => xuankong.qiScore(8, star) / 3;
    const cell = chart.palaces[g];
    let want = 0.75 * q(cell.xiang) + 0.25 * q(cell.shan);
    if (c.meta.backPalaces.includes(g)) want *= 0.5;
    closeTo(c.components[g].XK, want, 1e-12);
    assert.equal(W.sectorComponents({ chart: xuankong.buildChart(9, '子'), currentYun: 9 }, {}).meta.xkValFallback, false);
    assert.equal(W.xkStarValue(9, 9), 1);
    assert.equal(W.xkStarValue(8, 8), 1, '當運星 qiScore 3 / 3');
  });
  it('檔位: xuankong 檔的 xkShan、權重與 opening 不同,元件相同', () => {
    const a = s1(input, 'mingcai').comps.components;
    const b = s1(input, 'xuankong').comps.components;
    assert.deepEqual(a, b, '兩檔 xkShan 同為 0.25');
    throwsCode(() => W.sectorComponents({ profile: 'nope' }, {}), 'INVALID_SETTING');
  });
  it('錯誤碼', () => {
    throwsCode(() => W.sectorComponents(null), 'INVALID_INPUT');
    throwsCode(() => W.sectorComponents({ houseGua: '中' }), 'UNKNOWN_GUA');
    throwsCode(() => W.sectorComponents({ people: [{ id: 'a', gua: 'x' }] }), 'UNKNOWN_GUA');
    throwsCode(() => W.sectorComponents({ people: [{ gua: '坎' }] }), 'INVALID_INPUT');
    throwsCode(() => W.sectorComponents({ people: 'x' }), 'INVALID_INPUT');
    throwsCode(() => W.sectorComponents({ chart: xuankong.buildChart(9, '子') }), 'INVALID_YUN');
  });
  it('scoreLocation: 每項貢獻 + 扣分理由,points 合計 == subtotal', () => {
    const comp = base().comps.components['震'];
    const r = W.scoreLocation(comp, { G: 1, flags: { opening: true, toilet_adjacent: true }, profile: 'mingcai' });
    assert.deepEqual(r.contributions.map((c) => c.key), ['G', 'XK', 'H', 'P', 'Y']);
    closeTo(r.contributions.reduce((s, c) => s + c.points, 0) / 100, r.subtotal, 1e-12);
    assert.equal(r.envMultiplier, 0.5 * 0.8);
    assert.deepEqual(r.deductions.map((d) => [d.flag, d.kind, d.multiplier]), [['opening', 'penalty', 0.5], ['toilet_adjacent', 'penalty', 0.8]]);
    for (const d of r.deductions) {
      assert.equal(d.tag, 'source');
      assert.equal(d.magnitudeTag, 'design');
      assert.ok(d.reason.length > 0);
    }
    closeTo(r.rawScore, 66.875 * 0.4, 1e-9);
    assert.equal(r.score, Math.floor(r.rawScore * 100 + 0.5) / 100);
    assert.equal(r.excluded, false);
  });
  it('環境乘數: 排除旗標 → 0;下限 0.4;reward 檔 x1.05;疊加不高於單項', () => {
    const comp = base().comps.components['震'];
    for (const f of W.EXCLUSION_FLAGS) {
      const r = W.scoreLocation(comp, { G: 1, flags: { [f]: true } });
      assert.equal(r.score, 0, f);
      assert.equal(r.excluded, true);
      assert.equal(r.deductions[0].kind, 'exclude');
    }
    // 全部扣分旗標疊加: 0.5*0.7*0.9*0.95*0.95*0.8*0.9 < 0.4 → 取下限
    const all = W.scoreLocation(comp, { G: 1, flags: { opening: true, no_solid_wall: true, beam: true, dark: true, sharp: true, toilet_adjacent: true, stove_facing: true } });
    assert.equal(all.envMultiplier, 0.4);
    assert.equal(all.deductions.at(-1).flag, 'floor');
    const env = W.envMultiplier({ opening: true, no_solid_wall: true, beam: true, dark: true, sharp: true, toilet_adjacent: true, stove_facing: true });
    assert.equal(env.floored, true);
    assert.ok(env.product < 0.4);
    // reward
    const rw = W.scoreLocation(comp, { G: 1, flags: { opening: true }, profile: 'mingcai', opening: 'reward' });
    closeTo(rw.rawScore, 66.875 * 1.05, 1e-9);
    assert.equal(rw.deductions[0].kind, 'reward');
    assert.equal(W.envMultiplier({ opening: true }, 'reward').multiplier, 1.05);
    assert.equal(W.envMultiplier({}, 'reward').multiplier, 1);
    assert.equal(W.envMultiplier({ toilet: false, beam: false }).multiplier, 1, 'false 旗標不算');
  });
  it('屬性: 500 組隨機元件與旗標 — clamp、單調、排除、貢獻加總', () => {
    const rng = mulberry32(31337);
    const penalties = ['no_solid_wall', 'beam', 'dark', 'sharp', 'toilet_adjacent', 'stove_facing', 'opening'];
    for (let n = 0; n < 500; n += 1) {
      const comp = { XK: range(rng, -1, 1), H: range(rng, -1, 1), P: range(rng, -1, 1), Y: range(rng, -1, 1) };
      const G = [0, 0.2, 0.5, 0.9, 1][Math.floor(rng() * 5)];
      const profile = rng() < 0.5 ? 'mingcai' : 'xuankong';
      const r0 = W.scoreLocation(comp, { G, profile, opening: 'penalty' });
      assert.ok(r0.rawScore >= 0 && r0.rawScore <= 100 + 1e-9);
      closeTo(r0.contributions.reduce((s, c) => s + c.points, 0) / 100, r0.subtotal, 1e-9);
      // 加任一扣分旗標,分數不會升高
      const flags = {};
      let prev = r0.rawScore;
      for (const f of penalties.filter(() => rng() < 0.6)) {
        flags[f] = true;
        const r = W.scoreLocation(comp, { G, profile, opening: 'penalty', flags });
        assert.ok(r.rawScore <= prev + 1e-9, `${f} 讓分數升高`);
        assert.ok(r.envMultiplier >= 0.4 - 1e-12);
        prev = r.rawScore;
      }
      // 排除
      const ex = W.EXCLUSION_FLAGS[Math.floor(rng() * 5)];
      assert.equal(W.scoreLocation(comp, { G, profile, flags: { ...flags, [ex]: true } }).rawScore, 0);
      // 分量單調: G 變大分數不降
      assert.ok(W.scoreLocation(comp, { G: 1, profile }).rawScore >= W.scoreLocation(comp, { G: 0, profile }).rawScore - 1e-9);
    }
  });
  it('rankCandidates: 同分依 G、再 P、再 XK,再依原順序;不改動輸入;無分數者排最後', () => {
    const mk = (id, rawScore, G, P, XK) => ({ id, rawScore, G, components: { P, XK } });
    const list = deepFreeze([mk('a', 50, 0.5, 0, 0), mk('b', 50, 1, 0, 0), mk('c', 50, 1, 0.2, 0), mk('d', 50, 1, 0.2, 0.1), mk('e', 50, 1, 0.2, 0.1), mk('f', null, 0, 0, 0), mk('g', 60, 0, 0, 0)]);
    const r = W.rankCandidates(list);
    assert.deepEqual(r.map((x) => x.id), ['g', 'd', 'e', 'c', 'b', 'a', 'f']);
    assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4, 5, 6, null]);
    assert.equal('rank' in list[0], false);
    // 浮點雜訊內視為同分
    const near = W.rankCandidates([mk('x', 50 + 1e-12, 0, 0, 0), mk('y', 50, 1, 0, 0)]);
    assert.deepEqual(near.map((x) => x.id), ['y', 'x']);
    throwsCode(() => W.rankCandidates('x'), 'INVALID_INPUT');
  });
  it('錯誤碼: scoreLocation / envMultiplier', () => {
    const comp = { XK: 0, H: 0, P: 0, Y: 0 };
    throwsCode(() => W.scoreLocation(null), 'INVALID_INPUT');
    throwsCode(() => W.scoreLocation({ XK: 1 }), 'INVALID_INPUT');
    throwsCode(() => W.scoreLocation(comp, { G: 2 }), 'INVALID_INPUT');
    throwsCode(() => W.scoreLocation(comp, { profile: 'x' }), 'INVALID_SETTING');
    throwsCode(() => W.scoreLocation(comp, { flags: { bogus: true } }), 'INVALID_FLAG');
    throwsCode(() => W.scoreLocation(comp, { flags: { beam: 1 } }), 'INVALID_FLAG');
    throwsCode(() => W.envMultiplier([], 'penalty'), 'INVALID_FLAG');
    throwsCode(() => W.envMultiplier({}, 'x'), 'INVALID_SETTING');
  });
});

// ═══════════════════════════ I. analyzeWealth 整合 ═══════════════════════════

const BASE_OPENINGS = [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1.0, width: 0.9 }];
/** 規格 2.6.7 的算術例: 外框 10x8(重心 (5,4))、客廳 6x5、門在下牆 x=1.0、平面圖上方 30 度。 */
function s1Plan({ openings = BASE_OPENINGS, extraRooms = [], walls, planUp = 30, livingW = 6, livingD = 5 } = {}) {
  return makePlan({
    outline: rectPoly(0, 0, 10, 8),
    rooms: [{ id: 'living', type: 'living', polygon: rectPoly(0, 0, livingW, livingD) }, ...extraRooms],
    planUpBearing: planUp,
    openings,
    walls,
    mainDoor: openings.find((o) => o.kind === 'entrance')?.id ?? null,
  });
}
const S1_INPUT = (extra = {}) => ({ plan: s1Plan(), facing: 210, now: NOW, chartYun: 9, currentYun: 9, household: [{ id: 'p1', gua: '坎' }], ...extra });
const cand = (r, id) => r.candidates.find((c) => c.id === id);

describe('analyzeWealth', () => {
  it('規格 2.6.7 算術例: 明財位 TR 落震宮,mingcai 66.88、xuankong 59.25', () => {
    const r = W.analyzeWealth(S1_INPUT());
    const ming = cand(r, 'living:TR');
    assert.equal(ming.kind, 'ming');
    assert.equal(ming.isMingCai, true);
    assert.equal(ming.label, '明財位');
    assert.equal(ming.sector, '震');
    assert.equal(ming.G, 1);
    assert.equal(ming.status, 'ok');
    closeTo(ming.score, 66.88, TOL_SCORE);
    assert.ok(circDiff(ming.sectorInfo.bearing, 75) <= 1e-9);
    const x = W.analyzeWealth(S1_INPUT(), { wealthProfile: 'xuankong' });
    closeTo(cand(x, 'living:TR').score, 59.25, TOL_SCORE);
    assert.equal(x.meta.ruleset.qiIntake, 'reward', '玄空檔的開口處理預設跟著檔位');
    assert.equal(r.meta.ruleset.qiIntake, 'penalty');
    // 貢獻與扣分理由
    assert.deepEqual(ming.contributions.map((c) => c.key), ['G', 'XK', 'H', 'P', 'Y']);
    closeTo(ming.contributions[0].points, 30, 1e-9);
    assert.deepEqual(ming.deductions, []);
    assert.equal(r.bestId, 'living:TR');
    assert.equal(r.ranking[0], 'living:TR');
  });
  it('窗在角區 → 33.44 / 62.21;鄰廁所 → 53.50;玻璃牆 → x0.7', () => {
    const win = { id: 'w1', kind: 'window', roomId: 'living', wall: 'right', pos: 4.1, width: 1.0 };
    const withWindow = (profile) => W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, win] }) }), { wealthProfile: profile });
    const a = cand(withWindow('mingcai'), 'living:TR');
    assert.equal(a.status, 'void_window');
    assert.deepEqual(a.flags, { opening: true });
    closeTo(a.score, 33.44, TOL_SCORE);
    assert.deepEqual(a.deductions.map((d) => d.flag), ['opening']);
    const b = cand(withWindow('xuankong'), 'living:TR');
    assert.equal(b.status, 'qi_intake_ok');
    closeTo(b.score, 62.21, TOL_SCORE);
    // 明寫 qiIntake 才蓋過檔位
    const c = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, win] }) }), { wealthProfile: 'xuankong', qiIntake: 'penalty' });
    assert.equal(cand(c, 'living:TR').status, 'void_window');
    // 落地窗
    const fw = { id: 'w2', kind: 'floorWindow', roomId: 'living', wall: 'top', pos: 5.4, width: 1.0 };
    assert.equal(cand(W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, fw] }) })), 'living:TR').status, 'void_floor_window');
    // 鄰廁所: 共用右牆 y∈[3,5],與 TR 角區 y∈[4,5] 重疊 1.0
    const toilet = { id: 'wc', type: 'toilet', polygon: rectPoly(6, 3, 2, 2) };
    const t = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ extraRooms: [toilet] }) }));
    assert.deepEqual(cand(t, 'living:TR').flags, { toilet_adjacent: true });
    closeTo(cand(t, 'living:TR').score, 53.5, TOL_SCORE);
    assert.equal(t.candidates.some((x) => x.roomId === 'wc'), false, '廁所不當財位房間');
    // 上牆是玻璃隔間 → 背後無兩面實牆
    const g = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ walls: [{ segment: [[0, 5], [6, 5]], kind: 'glass' }] }) }));
    assert.deepEqual(cand(g, 'living:TR').flags, { no_solid_wall: true });
    closeTo(cand(g, 'living:TR').score, 66.875 * 0.7, 0.011);
    assert.equal(cand(g, 'living:TL'), undefined, '有玻璃牆的角不算兩面實牆角');
  });
  it('角區有門 / 動線 → 不成立,分數 0,但明財位仍列出', () => {
    const door2 = { id: 'd2', kind: 'door', roomId: 'living', wall: 'top', pos: 5.5, width: 0.8 };
    const r = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, door2] }) }));
    const c = cand(r, 'living:TR');
    assert.equal(c.status, 'blocked_opening');
    assert.equal(c.holds, false);
    assert.equal(c.excluded, true);
    assert.equal(c.score, 0);
    assert.deepEqual(c.flags, { door_swing: true });
    assert.equal(c.deductions[0].kind, 'exclude');
    assert.ok(r.ranking.includes('living:TR'), '明財位不論排名都在');
    assert.ok(r.mingCaiWei[0].corners.some((x) => x.candidateId === 'living:TR'));
    assert.notEqual(r.bestId, 'living:TR');
    // 動線(手動旗標): walkway
    const w = W.analyzeWealth(S1_INPUT({ flags: { 'living:TR': { walkway: true } } }));
    assert.equal(cand(w, 'living:TR').status, 'blocked_walkway');
    assert.equal(cand(w, 'living:TR').score, 0);
    // 手動旗標: 廁所、樑、昏暗;房間層級與候選層級合併
    const m = W.analyzeWealth(S1_INPUT({ flags: { living: { beam: true }, 'living:TR': { dark: true } } }));
    closeTo(cand(m, 'living:TR').score, 66.875 * 0.9 * 0.95, TOL_SCORE);
    assert.deepEqual(cand(m, 'living:TR').flags, { beam: true, dark: true });
    assert.equal(cand(m, 'living:BR').flags.beam, true);
  });
  it('明財位永遠顯示: 沒有住戶、沒有玄空資料、平面圖方位未知也一樣', () => {
    const noRes = W.analyzeWealth(S1_INPUT({ household: [] }));
    assert.equal(noRes.meta.hasResidents, false);
    assert.equal(noRes.meta.scoreCap, 85, '沒有住戶: G 0.30 + XK 0.25 + H 0.15 + Y 0.15 = 0.85');
    assert.ok(cand(noRes, 'living:TR').score <= 85 + 1e-9);
    assert.ok(noRes.meta.warnings.includes('noResidents'));
    const noXk = W.analyzeWealth({ ...S1_INPUT(), chartYun: undefined, currentYun: undefined });
    assert.equal(noXk.layers.xuankong, null);
    assert.ok(noXk.meta.warnings.includes('xuankongUnavailable'));
    assert.ok(noXk.findings.some((f) => f.id === 'wealth.xuankong.missing'));
    assert.equal(noXk.meta.scoreCap, 75);
    assert.ok(cand(noXk, 'living:TR'));
    const noUp = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ planUp: null }) }));
    const c = cand(noUp, 'living:TR');
    assert.equal(c.sector, null);
    assert.equal(c.score, null);
    assert.equal(c.rank, null);
    assert.deepEqual(noUp.ranking, []);
    assert.equal(noUp.bestId, null);
    assert.equal(noUp.mingCaiWei.length, 1, '形狀分析仍給明財位');
    assert.ok(noUp.meta.warnings.includes('planUpBearingUnknown'));
    assert.ok(noUp.findings.some((f) => f.id === 'wealth.plan.up_unknown'));
    // 暗財位各宮不需要平面圖
    for (const g of GUA8) assert.ok(Number.isFinite(noUp.sectors[g].energy));
  });
  it('沒有門的資料 → 只給暗財位;沒有平面圖 → 只有各宮分數', () => {
    const noDoor = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [] }) }));
    assert.deepEqual(noDoor.mingCaiWei, []);
    assert.equal(noDoor.candidates.some((c) => c.isMingCai), false);
    assert.ok(noDoor.meta.warnings.includes('noDoorData'));
    assert.ok(noDoor.meta.warnings.includes('noDoor:living'));
    assert.ok(noDoor.findings.some((f) => f.id === 'wealth.ming.no_door'));
    assert.ok(noDoor.layers.bazhai && noDoor.layers.annual, '暗財位仍在');
    assert.ok(noDoor.candidates.length > 0, '兩面實牆的角落仍是候選');
    const noPlan = W.analyzeWealth({ facing: 210, now: NOW, chartYun: 9, currentYun: 9 });
    assert.deepEqual(noPlan.candidates, []);
    assert.ok(noPlan.findings.some((f) => f.id === 'wealth.plan.missing'));
    assert.equal(Object.keys(noPlan.sectors).length, 8);
  });
  it('各宮 sectors 與 fixture 的元件、宮位能量一致', () => {
    const r = W.analyzeWealth(S1_INPUT());
    const c = byName.score_components_S1.expected.components;
    for (const g of GUA8) assertDeepApprox(r.sectors[g].components, c[g], 1e-9, g);
    const e = byName.score_sector_energy_mingcai_S1.expected.scores;
    for (const g of GUA8) closeTo(r.sectors[g].energy, e[g], TOL_SCORE, g);
    assert.equal(r.sectors['震'].dir, '東');
    assert.deepEqual(r.sectors['震'].stars, { xiang: 8, shan: 1, house: '六煞', year: 8, people: { p1: '天醫' } });
  });
  it('旋轉等變: 平面圖上方加 45 度,同一角落落入下一宮', () => {
    const at = (up) => cand(W.analyzeWealth(S1_INPUT({ plan: s1Plan({ planUp: up }) })), 'living:TR').sector;
    for (let k = 0; k < 8; k += 1) {
      const a = GUA8.indexOf(at(30 + 45 * k));
      assert.equal(a, (GUA8.indexOf('震') + k) % 8);
    }
  });
  it('候選: 各宮位中有兩面實牆的角落(G=0.5),門牆上有門的角不算,已列的明財位不重複', () => {
    const r = W.analyzeWealth(S1_INPUT());
    assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['living:BR', 'living:TL', 'living:TR']);
    assert.equal(cand(r, 'living:BR').kind, 'wallCorner');
    assert.equal(cand(r, 'living:BR').G, 0.5);
    assert.equal(cand(r, 'living:BL'), undefined, '門在 BL 角區');
    assert.deepEqual(r.candidates.map((c) => c.rank), [1, 2, 3]);
    for (let i = 1; i < r.candidates.length; i += 1) assert.ok(r.candidates[i - 1].rawScore >= r.candidates[i].rawScore - 1e-9);
  });
  it('門居中: 兩角並列(遠者 primary,G 1.0 與 0.9);preferDragonSide 只取龍邊', () => {
    const plan = s1Plan({ openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 3.3, width: 0.9 }] });
    const r = W.analyzeWealth(S1_INPUT({ plan }));
    assert.equal(r.mingCaiWei[0].tied, true);
    assert.deepEqual(r.mingCaiWei[0].corners.map((c) => c.corner), ['TL', 'TR']);
    assert.equal(cand(r, 'living:TL').G, 1);
    assert.equal(cand(r, 'living:TR').G, 0.9);
    assert.equal(cand(r, 'living:TR').role, 'second');
    const d = W.analyzeWealth(S1_INPUT({ plan }), { preferDragonSide: true });
    assert.deepEqual(d.mingCaiWei[0].corners.map((c) => c.corner), ['TR']);
    assert.equal(d.mingCaiWei[0].dragonOnly, true);
    assert.equal(d.meta.ruleset.preferDragonSide, true);
    assert.ok(r.findings.some((f) => f.id === 'wealth.ming.living.TL' && /左右兩個遠端角都算/.test(f.body)));
  });
  it('showRay45: 只在開關打開時附 45 度射線命中點', () => {
    assert.equal(W.analyzeWealth(S1_INPUT()).mingCaiWei[0].ray45, null);
    const r = W.analyzeWealth(S1_INPUT(), { showRay45: true });
    assert.deepEqual(r.mingCaiWei[0].ray45.wall, 'right');
    assertDeepApprox(r.mingCaiWei[0].ray45.hit, [6, 5], 1e-9);
  });
  it('門的選擇: 大門 > 落地窗/陽台門 > 室內門;doorOverride 手動指定', () => {
    // 客廳有大門與陽台門: 大門為主
    const two = [...BASE_OPENINGS, { id: 'b1', kind: 'balconyDoor', roomId: 'living', wall: 'top', pos: 3, width: 1.5 }];
    const r = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: two }) }));
    assert.equal(r.mingCaiWei[0].door.id, 'd1');
    // 手動指定陽台門: 門在上牆偏左(x=1.0)→ 遠端右角 = BR
    const o = { id: 'b1', kind: 'balconyDoor', roomId: 'living', wall: 'top', pos: 1, width: 1.0 };
    const plan = s1Plan({ openings: [...BASE_OPENINGS, o] });
    const over = W.analyzeWealth(S1_INPUT({ plan, doorOverride: { living: 'b1' } }));
    assert.equal(over.mingCaiWei[0].door.id, 'b1');
    assert.deepEqual(over.mingCaiWei[0].corners.map((c) => c.corner), ['BR']);
    throwsCode(() => W.analyzeWealth(S1_INPUT({ doorOverride: { living: 'nope' } })), 'INVALID_INPUT');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ doorOverride: 'x' })), 'INVALID_INPUT');
  });
  it('門沖: 大門對面牆上有重疊的開口 → 提示;有遮擋(shielded)不判', () => {
    const opp = { id: 'w9', kind: 'window', roomId: 'living', wall: 'top', pos: 1.0, width: 0.9 };
    const plan = s1Plan({ openings: [...BASE_OPENINGS, opp] });
    const r = W.analyzeWealth(S1_INPUT({ plan }));
    assert.equal(r.doorChong.length, 1);
    assert.equal(r.doorChong[0].level, 'chong');
    assert.ok(r.findings.some((f) => f.id === 'wealth.door.chong.living' && /沒有科學證據/.test(f.body)));
    assert.deepEqual(W.analyzeWealth(S1_INPUT({ plan, shielded: ['w9'] })).doorChong, []);
    // 輕微偏移
    const slight = { id: 'w9', kind: 'window', roomId: 'living', wall: 'top', pos: 1.35, width: 0.8 };
    const s = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, slight] }) }));
    assert.equal(s.doorChong[0].level, 'slight');
    assert.ok(s.findings.some((f) => f.id === 'wealth.door.slight.living'));
  });
  it('多位住戶 each: 每個候選附 byPerson', () => {
    const household = [{ id: 'a', gua: '坎' }, { id: 'b', gua: '乾' }];
    const r = W.analyzeWealth(S1_INPUT({ household }), { multiOccupantPolicy: 'each' });
    const c = cand(r, 'living:TR');
    assert.deepEqual(c.byPerson.map((p) => p.id), ['a', 'b']);
    assert.equal(c.byPerson[0].P, 0.55);
    assert.equal(cand(W.analyzeWealth(S1_INPUT({ household })), 'living:TR').byPerson, undefined);
    assert.equal(r.layers.mingGua.byPerson.length, 2);
    assert.equal(r.layers.mingGua.byPerson[0].order[0].dir, '東南');
  });
  it('由出生資料算命卦(1990 年,立春後): 男 mod9(2-1990)=1 坎命、女 mod9(1990+4)=5 入中寄艮', () => {
    const birth = { local: '1990-06-01T10:00', utcOffset: '+08:00' };
    const m = W.analyzeWealth(S1_INPUT({ household: [{ id: 'x', gender: 'M', birth }] }));
    const f = W.analyzeWealth(S1_INPUT({ household: [{ id: 'y', gender: 'F', birth }] }));
    assert.equal(m.layers.mingGua.byPerson[0].gua, '坎');
    assert.equal(f.layers.mingGua.byPerson[0].gua, '艮');
    assert.equal(m.layers.mingGua.byPerson[0].gua, bazhai.mingGuaFromBirth(birth, 'M').gua);
    throwsCode(() => W.analyzeWealth(S1_INPUT({ household: [{ id: 'x' }] })), 'INVALID_GENDER');
  });
  it('九運水火提示: 預設不主動建議;allowWaterHint 才有,且分層標示', () => {
    const off = W.analyzeWealth(S1_INPUT());
    assert.equal(off.layers.water, null);
    assert.equal(off.findings.some((f) => f.id.startsWith('wealth.water')), false);
    const on = W.analyzeWealth(S1_INPUT(), { allowWaterHint: true });
    assert.equal(on.layers.water.length, 3);
    const ids = on.findings.filter((f) => f.id.startsWith('wealth.water')).map((f) => f.id);
    assert.equal(ids.length, 3);
    assert.ok(on.findings.find((f) => f.id.startsWith('wealth.water.case')).tag === 'inference');
  });
  it('builtAt 決定 chartYun: 2005 年建成 = 八運盤,判讀仍用九運', () => {
    const r = W.analyzeWealth(S1_INPUT({ chartYun: undefined, currentYun: undefined, builtAt: Date.UTC(2005, 5, 1) }));
    assert.equal(r.layers.xuankong.chartYun, 8);
    assert.equal(r.layers.xuankong.currentYun, 9);
    assert.ok(r.meta.warnings.includes('chartYunDiffersFromCurrent'));
  });
  it('雙星會坐(向星旺在坐宮): 層輸出 backPalaces 並附警示 Finding', () => {
    const sit = xuankong.listPatterns(9)['雙星會坐'][0].split('山')[0];
    const face = xuankong.buildChart(9, sit).meta.face;
    const facing = 15 * ['子', '癸', '丑', '艮', '寅', '甲', '卯', '乙', '辰', '巽', '巳', '丙', '午', '丁', '未', '坤', '申', '庚', '酉', '辛', '戌', '乾', '亥', '壬'].indexOf(face);
    const r = W.analyzeWealth(S1_INPUT({ facing }));
    assert.equal(r.layers.xuankong.pattern, '雙星會坐');
    assert.ok(r.layers.xuankong.backPalaces.length >= 1);
    assert.ok(r.findings.some((f) => f.id === 'wealth.xuankong.back' && f.tag === 'source'));
  });
  it('流年凶星壓在明財位: 只做扣分與警語(U-08)', () => {
    // 2026 五黃在南(離)、二黑在西北(乾): 讓明財位角落落在離宮 → planUp 使 TR(方位 45+up)落離(180)
    const r = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ planUp: 135 }) }));
    const c = cand(r, 'living:TR');
    assert.equal(c.sector, '離');
    assert.equal(r.sectors['離'].stars.year, 5);
    const f = r.findings.find((x) => x.id === 'wealth.annual.bad_on_ming.living:TR');
    assert.ok(f);
    assert.equal(f.tag, 'design');
    assert.equal(f.level, 'caution');
  });
  it('宮位交界提示: 距扇區線小於 measureUncertainty', () => {
    // TR 方位 75 度,離扇區線 67.5 度只有 7.5 度;planUp 27.5 → 方位 72.5,距 5.0 度線恰等於預設 5.0(不小於 → 不提示);planUp 26 → 71 度 → 3.5 度
    const near = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ planUp: 26 }) }));
    assert.equal(cand(near, 'living:TR').sectorInfo.borderline, true);
    assert.ok(near.findings.some((f) => f.id === 'wealth.borderline.living:TR'));
    const far = W.analyzeWealth(S1_INPUT());
    assert.equal(cand(far, 'living:TR').sectorInfo.borderline, false);
    assert.equal(far.findings.some((f) => f.id.startsWith('wealth.borderline')), false);
    const wide = W.analyzeWealth(S1_INPUT(), { measureUncertainty: 8 });
    assert.equal(cand(wide, 'living:TR').sectorInfo.borderline, true, '不確定度放寬到 8 度 → 7.5 度算交界');
  });
  it('L 型房間: 多邊形明財位與候選(不同於矩形的步行距離)', () => {
    const L = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const plan = makePlan({
      outline: L,
      rooms: [{ id: 'living', type: 'living', polygon: L }],
      planUpBearing: 0,
      openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 5, width: 0.9 }],
      mainDoor: 'd1',
    });
    const r = W.analyzeWealth(S1_INPUT({ plan }));
    assert.equal(r.mingCaiWei[0].geometry, 'polygon');
    assert.equal(r.mingCaiWei[0].corners[0].corner, 'V5');
    assertDeepApprox(r.mingCaiWei[0].corners[0].point, [0, 6], 1e-9);
    assert.equal(cand(r, 'living:V5').isMingCai, true);
    assert.ok(r.findings.some((f) => f.id === 'wealth.ming.living.V5' && f.tag === 'design'), '非矩形標設計、信心低');
    assert.equal(r.findings.find((f) => f.id === 'wealth.ming.living.V5').confidence, 'low');
    assert.ok(!r.candidates.some((c) => c.corner === 'V3'), '凹角不當候選');
  });
  it('太極點模式(D55): plan 沒指定時吃 settings.taijiMode,凹形平面 centroid 與 bbox 讓角落落入不同方位', () => {
    const L = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const mk = (taiji) => makePlan({ outline: L, rooms: [{ id: 'living', type: 'living', polygon: L }], planUpBearing: 0, openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 5, width: 0.9 }], taiji });
    const bearing = (plan, settings) => cand(W.analyzeWealth(S1_INPUT({ plan }), settings), 'living:V5').sectorInfo.bearing;
    const auto = { mode: null, manual: null };
    // 重心 (2.5,2.5) → (0,6) 向量 (-2.5,3.5);外接框中心 (3,3) → 向量 (-3,3) = 315 度
    closeTo(bearing(mk(auto), { taijiMode: 'centroid' }), (Math.atan2(-2.5, 3.5) * 180) / Math.PI + 360, 1e-9);
    closeTo(bearing(mk(auto), { taijiMode: 'bbox' }), 315, 1e-9);
    closeTo(bearing(mk({ mode: 'manual', manual: [3, 3] }), {}), 315, 1e-9);
    assert.equal(W.analyzeWealth(S1_INPUT({ plan: mk(auto) }), { taijiMode: 'bbox' }).meta.ruleset.taijiMode, 'bbox');
    // 重心落在外框之外 → 提示
    const U = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]];
    const up = makePlan({ outline: U, rooms: [{ id: 'living', type: 'living', polygon: U }], planUpBearing: 0, openings: [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 3, width: 0.9 }] });
    const r = W.analyzeWealth(S1_INPUT({ plan: up }));
    assert.ok(r.meta.warnings.includes('taijiOutsideOutline'));
    assert.ok(r.findings.some((f) => f.id === 'wealth.plan.taiji_outside'));
  });
  it('多個主空間: 臥室、書房各自以自己的門找明財位;玄關、陽台、廁所、廚房不算', () => {
    const plan = makePlan({
      outline: rectPoly(0, 0, 10, 8),
      rooms: [
        { id: 'living', type: 'living', polygon: rectPoly(0, 0, 6, 5) },
        { id: 'bed', type: 'bedroom', polygon: rectPoly(6, 0, 4, 5) },
        { id: 'kit', type: 'kitchen', polygon: rectPoly(0, 5, 5, 3) },
        { id: 'ent', type: 'entry', polygon: rectPoly(5, 5, 5, 3) },
      ],
      planUpBearing: 0,
      openings: [
        { id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1, width: 0.9 },
        { id: 'd2', kind: 'door', roomId: 'bed', wall: 'left', pos: 1, width: 0.8 },
        { id: 'd3', kind: 'door', roomId: 'kit', wall: 'bottom', pos: 2, width: 0.8 },
      ],
    });
    const r = W.analyzeWealth(S1_INPUT({ plan }));
    assert.deepEqual(r.mingCaiWei.map((m) => m.roomId), ['living', 'bed']);
    assert.equal(r.candidates.some((c) => c.roomId === 'kit' || c.roomId === 'ent'), false);
    const bed = r.mingCaiWei.find((m) => m.roomId === 'bed');
    assert.equal(bed.corners[0].corner, 'TR', '門在左牆偏下 → 遠端 TR');
    // candidateRoomIds 明確指定
    const only = W.analyzeWealth(S1_INPUT({ plan, candidateRoomIds: ['bed'] }));
    assert.deepEqual(only.mingCaiWei.map((m) => m.roomId), ['bed']);
    throwsCode(() => W.analyzeWealth(S1_INPUT({ plan, candidateRoomIds: 'bed' })), 'INVALID_INPUT');
  });
  it('屬性: 300 組隨機平面圖不崩潰、輸出可序列化、排序正確、明財位與獨立 oracle 同一角', () => {
    const rng = mulberry32(2026);
    let withScores = 0;
    for (let n = 0; n < 300; n += 1) {
      const { plan, living, door } = randomPlanCase(rng);
      const household = rng() < 0.5 ? [] : [{ id: 'a', gua: GUA8[Math.floor(rng() * 8)] }];
      const r = W.analyzeWealth({ plan, facing: range(rng, -100, 500), now: NOW, chartYun: 1 + Math.floor(rng() * 9), household }, { wealthProfile: rng() < 0.5 ? 'mingcai' : 'xuankong' });
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
      // 明財位永遠在(有門就有)
      assert.equal(r.mingCaiWei.length, 1);
      const ming = r.candidates.filter((c) => c.isMingCai);
      assert.ok(ming.length >= 1 && ming.length <= 2);
      const primary = ming.find((c) => c.role === 'primary');
      assert.ok(primary, '一定有 primary 明財位');
      const len = door.wall === 'bottom' || door.wall === 'top' ? living.w : living.d;
      if (Math.abs(door.pos - len / 2) > 0.1 * len + 1e-9) assert.equal(ming.length, 1);
      assertDeepApprox(primary.point, oracleRectCorner(living.w, living.d, door.wall, door.pos), 1e-9);
      // 排序: 有分數者由高到低,無分數者在最後
      const scored = r.candidates.filter((c) => c.rawScore !== null);
      for (let i = 1; i < scored.length; i += 1) assert.ok(scored[i - 1].rawScore >= scored[i].rawScore - 1e-9);
      assert.deepEqual(r.ranking, scored.map((c) => c.id));
      scored.forEach((c, i) => assert.equal(c.rank, i + 1));
      for (const c of scored) {
        withScores += 1;
        assert.ok(Number.isFinite(c.score) && c.score >= 0 && c.score <= 105 + 1e-9, `${c.id} ${c.score}`);
        if (c.excluded) assert.equal(c.score, 0);
        assert.ok(c.sector !== null);
      }
      if (plan.planUpBearing === null) assert.equal(scored.length, 0);
      // 分數上限: 各層權重總和(缺的層不計、沒有住戶 P 不重分配),clamp 前的小計不會超過它
      assert.ok(r.meta.scoreCap <= 100 + 1e-9);
      for (const c of scored) assert.ok(c.subtotal <= r.meta.scoreCap / 100 + 1e-9, `${c.id} 小計 ${c.subtotal} > 上限 ${r.meta.scoreCap}`);
    }
    assert.ok(withScores > 300, '多數案例都有算分');
  });
  it('決定性、不修改輸入、JSON 可序列化', () => {
    const input = deepFreeze(S1_INPUT({ household: [{ id: 'a', gua: '坎', role: 'breadwinner' }, { id: 'b', gua: '乾' }], flags: { living: { dark: true } } }));
    const a = W.analyzeWealth(input, { showRay45: true, allowWaterHint: true });
    const b = W.analyzeWealth(input, { showRay45: true, allowWaterHint: true });
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  });
  it('meta: schema、ruleset 回存實際採用的設定、northMode 與 CST 時間', () => {
    const r = W.analyzeWealth(S1_INPUT({ northMode: 'true', declination: -5.06, declinationDate: '2026-09-29' }), { wealthProfile: 'xuankong', yearVal: { 9: 0.5 }, tianyiFirst: true, multiOccupantPolicy: 'breadwinner' });
    assert.equal(r.meta.schema, 'fengshui.wealth/1');
    assert.equal(r.meta.ruleset.wealthProfile, 'xuankong');
    assert.deepEqual(r.meta.ruleset.yearVal, { 9: 0.5 });
    assert.equal(r.meta.ruleset.tianyiFirst, true);
    assert.equal(r.meta.ruleset.multiOccupantPolicy, 'breadwinner');
    assert.equal(r.meta.northMode, 'true');
    assert.equal(r.meta.declination, -5.06);
    assert.equal(r.meta.declinationDate, '2026-09-29');
    assert.equal(r.meta.computedAtCST, '2026-09-29 12:00');
    for (const k of Object.keys(r.meta.ruleset)) assert.ok(k in DEFAULT_SETTINGS, k);
    const d = W.analyzeWealth(S1_INPUT());
    assert.equal(d.meta.northMode, 'magnetic');
    assert.equal(d.meta.declination, null);
    assert.deepEqual(d.meta.ruleset.yearVal, 'default');
  });
  it('facing: 數字同時給八宅與玄空;物件可分開給;只給一個會沿用並警示', () => {
    const a = W.analyzeWealth(S1_INPUT({ facing: 210 }));
    const b = W.analyzeWealth(S1_INPUT({ facing: { bazhai: 210, xuankong: 210 } }));
    assert.deepEqual(a.layers.bazhai, b.layers.bazhai);
    const c = W.analyzeWealth(S1_INPUT({ facing: { bazhai: 210 } }));
    assert.ok(c.meta.warnings.includes('facingReused'));
    assert.equal(c.layers.xuankong.face, '未');
    // 大門朝向與宅向不同: 八宅用大門(北 0 度 → 離宅),玄空用宅向 210
    const split = W.analyzeWealth(S1_INPUT({ facing: { bazhai: 0, xuankong: 210 } }));
    assert.equal(split.layers.bazhai.houseGua, '離');
    assert.equal(split.layers.xuankong.face, '未');
    const house = W.analyzeWealth(S1_INPUT({ facing: { bazhai: 0, xuankong: 210 } }), { bazhaiFacingBasis: 'house' });
    assert.equal(house.layers.bazhai.houseGua, '艮');
  });
  it('扣分與排除理由各有一則 Finding;排除者提示改看次選;已有 status Finding 的不重複', () => {
    const m = W.analyzeWealth(S1_INPUT({ flags: { 'living:TR': { beam: true, toilet: true } } }));
    const ids = m.findings.map((f) => f.id);
    assert.ok(ids.includes('wealth.ming.deduction.living:TR.beam'));
    const ex = m.findings.find((f) => f.id === 'wealth.ming.excluded.living:TR.toilet');
    assert.ok(ex);
    assert.equal(ex.level, 'caution');
    assert.match(ex.body, /改看次選/);
    assert.equal(cand(m, 'living:TR').score, 0);
    const stairs = W.analyzeWealth(S1_INPUT({ flags: { 'living:TR': { stairs: true } } }));
    assert.match(stairs.findings.find((f) => f.id === 'wealth.ming.excluded.living:TR.stairs').schoolNote, /單一來源/);
    // 窗: 只有 status Finding,沒有重複的 deduction Finding
    const win = { id: 'w1', kind: 'window', roomId: 'living', wall: 'right', pos: 4.1, width: 1.0 };
    const w = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, win] }) }));
    assert.ok(w.findings.some((f) => f.id === 'wealth.ming.status.living:TR'));
    assert.equal(w.findings.some((f) => f.id.startsWith('wealth.ming.deduction.living:TR.opening')), false);
    // 角區有門: status Finding,沒有重複的 excluded Finding
    const d2 = { id: 'd2', kind: 'door', roomId: 'living', wall: 'top', pos: 5.5, width: 0.8 };
    const b = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, d2] }) }));
    assert.ok(b.findings.some((f) => f.id === 'wealth.ming.status.living:TR'));
    assert.equal(b.findings.some((f) => f.id.startsWith('wealth.ming.excluded.living:TR')), false);
    // 扣分下限有註記
    const all = W.analyzeWealth(S1_INPUT({ flags: { 'living:TR': { opening: true, no_solid_wall: true, beam: true, dark: true, sharp: true, toilet_adjacent: true, stove_facing: true } } }));
    assert.equal(cand(all, 'living:TR').envMultiplier, 0.4);
    assert.equal(cand(all, 'living:TR').deductions.at(-1).flag, 'floor');
  });
  it('flags 與 doorOverride 用特殊鍵名(constructor、__proto__)也不會取到原型上的東西', () => {
    const r = W.analyzeWealth(S1_INPUT({ flags: {}, doorOverride: {} }));
    assert.ok(cand(r, 'living:TR'));
    const plan = makePlan({
      outline: rectPoly(0, 0, 10, 8),
      rooms: [{ id: 'constructor', type: 'living', polygon: rectPoly(0, 0, 6, 5) }],
      planUpBearing: 30,
      openings: [{ id: 'd1', kind: 'entrance', roomId: 'constructor', wall: 'bottom', pos: 1, width: 0.9 }],
    });
    const o = W.analyzeWealth(S1_INPUT({ plan }));
    assert.ok(cand(o, 'constructor:TR'));
  });
  it('Finding: 形狀完整、tag 合法、id 唯一、明財位與各層都有', () => {
    const r = W.analyzeWealth(S1_INPUT({ plan: s1Plan({ openings: [...BASE_OPENINGS, { id: 'w1', kind: 'window', roomId: 'living', wall: 'right', pos: 4.1, width: 1 }] }) }), { allowWaterHint: true });
    const ids = r.findings.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, 'id 唯一');
    for (const f of r.findings) {
      assert.deepEqual(Object.keys(f).sort(), ['body', 'confidence', 'id', 'level', 'refs', 'schoolNote', 'tag', 'title']);
      assert.ok(['info', 'note', 'caution'].includes(f.level), f.id);
      assert.ok(['high', 'medium', 'low'].includes(f.confidence), f.id);
      assert.ok(['source', 'inference', 'design', 'minority'].includes(f.tag), f.id);
      assert.ok(f.title.length > 0 && f.body.length > 0, f.id);
      assert.ok(Array.isArray(f.refs) && f.refs.length > 0);
      assert.ok(f.schoolNote === null || typeof f.schoolNote === 'string');
      // 文案原則: 不用恐嚇字眼當結論,不含簡體與暱稱
      assert.doesNotMatch(f.title + f.body, /大凶|絕嗣|克妻|敗財|保證/, f.id);
    }
    for (const id of ['wealth.layers.overview', 'wealth.ming.living.TR', 'wealth.ming.status.living:TR', 'wealth.bazhai.gate', 'wealth.xuankong.cells', 'wealth.annual.stars', 'wealth.ming_gua.p1', 'wealth.rank.design', 'wealth.soft.tips']) {
      assert.ok(ids.includes(id), id);
    }
    assert.equal(r.findings.find((f) => f.id === 'wealth.rank.design').tag, 'design');
    assert.match(r.findings.find((f) => f.id === 'wealth.rank.design').body, /不可跨設定比較/);
    assert.equal(r.findings.find((f) => f.id === 'wealth.ming.status.living:TR').level, 'caution');
    assert.equal(r.findings.find((f) => f.id === 'wealth.ming.living.TR').tag, 'source');
    assert.equal(r.findings.find((f) => f.id === 'wealth.annual.stars').tag, 'source');
  });
  it('錯誤碼', () => {
    throwsCode(() => W.analyzeWealth(null), 'INVALID_INPUT');
    throwsCode(() => W.analyzeWealth([]), 'INVALID_INPUT');
    throwsCode(() => W.analyzeWealth({ facing: 180 }), 'MISSING_INPUT');
    throwsCode(() => W.analyzeWealth({ facing: 180, now: 'x' }), 'INVALID_INSTANT');
    throwsCode(() => W.analyzeWealth({ now: NOW }), 'MISSING_INPUT');
    throwsCode(() => W.analyzeWealth({ facing: {}, now: NOW }), 'MISSING_INPUT');
    throwsCode(() => W.analyzeWealth({ facing: NaN, now: NOW }), 'INVALID_BEARING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { bogusKey: 1 }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { wealthProfile: 'x' }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { qiIntake: 'x' }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { multiOccupantPolicy: 'x' }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { allowWaterHint: 'yes' }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT(), { yearVal: { 0: 1 } }), 'INVALID_SETTING');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ household: 'x' })), 'INVALID_HOUSEHOLD');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ household: [1] })), 'INVALID_HOUSEHOLD');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ household: [{ id: 'a', gua: '坎' }, { id: 'a', gua: '乾' }] })), 'INVALID_HOUSEHOLD');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ household: [{ id: 'a', gua: '坎', role: 'boss' }] })), 'INVALID_HOUSEHOLD');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ flags: { 'living:TR': { nonsense: true } } })), 'INVALID_FLAG');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ flags: 'x' })), 'INVALID_INPUT');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ plan: { ...s1Plan(), outline: [[0, 0], [1, 1]] } })), 'INVALID_PLAN');
    throwsCode(() => W.analyzeWealth(S1_INPUT({ chartYun: 10 })), 'INVALID_YUN');
  });
});

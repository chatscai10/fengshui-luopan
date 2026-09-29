// 跨畫面整合:store 的預設值與壞資料防護、磁北/真北切換、以及 planUpBearing 在
// 平面圖(planRenderer)、財位縮圖(miniPlan)、引擎(wealth.sector)三處對「同一個角落落在哪一宮」的判斷一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_STATE } from '../../src/ui/store.js';
import { buildTemplate } from '../../src/ui/plan/templates.js';
import { sectorIndexAt } from '../../src/ui/canvas/planRenderer.js';
import { layoutMiniPlan } from '../../src/ui/canvas/miniPlan.js';
import { GUA, CITY_DECLINATIONS, declinationFor } from '../../src/core/geo.js';

function memStorage(initial) {
  const m = new Map();
  if (initial !== undefined) m.set('fengshui.state.v1', JSON.stringify(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

function storeWithPlan(patch = {}) {
  const st = createStore(memStorage());
  const { plan } = buildTemplate('two');
  st.update((d) => {
    d.facing.bearing = 175;
    d.building.builtYear = 2005;
    d.plan = plan;
    Object.assign(d.settings, patch);
  });
  return st;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('預設磁偏角城市是 geo 認得的鍵,選真北時磁偏角不會是 null', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(CITY_DECLINATIONS, DEFAULT_STATE.facing.cityId));
  const st = createStore(memStorage());
  st.update((d) => { d.facing.bearing = 175; d.settings.northMode = 'true'; });
  const inp = st.input();
  assert.equal(inp.facing.declination, declinationFor(DEFAULT_STATE.facing.cityId, inp.nowMs));
});

test('舊資料的城市代碼(例如 taipei)會被修成合法鍵', () => {
  const st = createStore(memStorage({ v: 1, facing: { bearing: 175, cityId: 'taipei' } }));
  assert.equal(st.get().facing.cityId, DEFAULT_STATE.facing.cityId);
  assert.notEqual(st.input().facing.declination, null);
});

test('plan.upOffset 或朝向不是數字(壞備份)時,input()/report() 不丟例外', () => {
  const { plan } = buildTemplate('two');
  plan.upOffset = 'abc';
  const st = createStore(memStorage({ v: 1, facing: { bearing: 175 }, building: { builtYear: 2005 }, plan }));
  assert.doesNotThrow(() => st.input());
  const r = st.report();
  assert.equal(r.error, undefined);
  assert.equal(st.input().plan.planUpBearing, 175);

  const bad = createStore(memStorage({ v: 1, facing: { bearing: 'abc' }, plan }));
  assert.equal(bad.get().facing.bearing, null);
  assert.equal(bad.report().error, 'NO_FACING');
});

test('report() 在 input() 丟例外時回傳 {error} 而不是丟出來', () => {
  const st = storeWithPlan();
  st.update((d) => { d.settings.northMode = 'true'; d.facing.doorBearing = 10; });
  // 模擬引擎端拒收:直接把 store 內部狀態改成不合法的值
  const s = st.get();
  s.facing.bearing = Infinity; // update() 之外的外力汙染
  let r;
  assert.doesNotThrow(() => { r = st.report(); });
  assert.ok(r && r.error);
});

test('planUpBearing:朝向模式 = 向,正北模式 = 0,真北模式 = 換算後的向,upOffset 疊加', () => {
  const st = storeWithPlan();
  assert.equal(st.input().plan.planUpBearing, 175);
  st.update((d) => { d.plan.upOffset = 10; });
  assert.equal(st.input().plan.planUpBearing, 185);
  st.update((d) => { d.plan.upOffset = 0; d.plan.upMode = 'north'; });
  assert.equal(st.input().plan.planUpBearing, 0);
  st.update((d) => { d.plan.upMode = 'facing'; d.settings.northMode = 'true'; });
  const dec = st.input().facing.declination;
  assert.ok(Math.abs(st.input().plan.planUpBearing - (175 + dec)) < 1e-9);
});

for (const mode of ['magnetic', 'true']) {
  test(`三處一致(${mode}):同一個角落在平面圖、縮圖、引擎都落在同一宮`, () => {
    const st = storeWithPlan({ northMode: mode });
    const rep = st.report();
    assert.equal(rep.error, undefined);
    const plan = st.input().plan;
    const up = plan.planUpBearing;
    const T = rep.planShares.taiji;
    assert.deepEqual(T, [4, 4]);

    // 手算:圖面上方 = up,向量 (dx,dy) 的方位 = up + atan2(dx,dy)
    const byHand = (p) => {
      const b = (((up + (Math.atan2(p[0] - T[0], p[1] - T[1]) * 180) / Math.PI) % 360) + 360) % 360;
      return Math.floor(((b + 22.5) % 360) / 45); // 坎 0、艮 1、震 2 ...(每宮 45°,以 45k 為中心)
    };

    const mini = layoutMiniPlan({ plan, taiji: T, up, markers: [] }, 320, 320);
    const miniIndex = (p) => {
      const [px, py] = mini.view.toPx(p);
      const [tx, ty] = mini.view.toPx(T);
      // 縮圖像素:x 向右、y 向下。轉成羅盤方位:up + atan2(dx, -dy_px)
      const b = (((up + (Math.atan2(px - tx, -(py - ty)) * 180) / Math.PI) % 360) + 360) % 360;
      let best = 0;
      let bd = 999;
      mini.sectors.forEach((s) => {
        // 這一宮在縮圖上的射線方向(像素)也換成方位角,與 b 比較,最近的就是所在宮
        const cb = (((up + (Math.atan2(s.end[0] - tx, -(s.end[1] - ty)) * 180) / Math.PI) % 360) + 360) % 360;
        const d = angleDiff(b, cb);
        if (d < bd) { bd = d; best = s.k; }
      });
      return best;
    };

    let checked = 0;
    for (const cand of rep.wealth.candidates) {
      const p = cand.point;
      const hand = byHand(p);
      if (cand.sectorInfo && cand.sectorInfo.borderline) continue; // 剛好壓線的不比
      assert.equal(GUA[hand], cand.sector, `${cand.id}: 手算 ${GUA[hand]} vs 引擎 ${cand.sector}`);
      assert.equal(GUA[sectorIndexAt(T, p, up)], cand.sector, `${cand.id}: 平面圖 vs 引擎`);
      assert.equal(GUA[miniIndex(p)], cand.sector, `${cand.id}: 縮圖 vs 引擎`);
      checked += 1;
    }
    assert.ok(checked >= 6, `至少要比對 6 個角落,實際 ${checked}`);
  });
}

test('已知圖:朝向 175° 時,主臥左下角 (0,0) 在東北(艮宮),左上角 (0,4.6) 在東(震宮)', () => {
  const st = storeWithPlan();
  const up = st.input().plan.planUpBearing;
  assert.equal(up, 175);
  const T = [4, 4];
  assert.equal(GUA[sectorIndexAt(T, [0, 0], up)], '艮');
  assert.equal(GUA[sectorIndexAt(T, [0, 4.6], up)], '震');
  assert.equal(GUA[sectorIndexAt(T, [4, 8], up)], '離'); // 正上方 = 向 = 南
});

test('財位標題與總覽用平面圖上看得到的房間名稱(主臥),不是籠統的「臥室」', async () => {
  const { renderReport } = await import('../../src/core/copy.js');
  const { sanitizePage, buildWealthModel } = await import('../../src/ui/views/wealth.js');
  const st = storeWithPlan();
  st.update((d) => { d.residents.push({ id: 'p1', name: '爸爸', gender: 'M', birth: '1980-06-15', utcOffsetMinutes: 480 }); d.mainResidentId = 'p1'; });
  const rep = st.report();
  const top = rep.summary.wealthTop[0];
  assert.equal(top.id, 'bed1:BL');
  const raw = renderReport(rep);
  const rawCard = raw.sections.flatMap((s) => s.cards).find((c) => c.id === `card.wealth.${top.id}`);
  assert.match(rawCard.headline, /^臥室的左下角/); // 引擎用的是類型名

  const page = sanitizePage(raw, rep, st.get().plan);
  const card = page.sections.flatMap((s) => s.cards).find((c) => c.id === `card.wealth.${top.id}`);
  assert.match(card.headline, /^主臥的左下角/);
  assert.match(page.plainSummary, /主臥的左下角/);
  assert.doesNotMatch(page.plainSummary, /臥室的左下角/);

  const model = buildWealthModel(st.get(), rep, raw);
  assert.match(model.best.lead, /^主臥的左下角/);
  // 同一個房間名稱不會影響別的候選:次臥的角落仍寫次臥
  const other = model.others.find((o) => o.id.startsWith('bed2:'));
  if (other) assert.match(other.headline, /^次臥的/);
  // 沒給 report/plan 時維持舊行為
  assert.equal(sanitizePage(raw).sections.flatMap((s) => s.cards).find((c) => c.id === rawCard.id).headline, rawCard.headline);
});

test('財位縮圖:指北針不壓到八方位名稱與財位標記', () => {
  for (const mode of ['magnetic', 'true']) {
    const st = storeWithPlan({ northMode: mode });
    st.update((d) => { d.residents.push({ id: 'p1', name: '爸爸', gender: 'M', birth: '1980-06-15', utcOffsetMinutes: 480 }); });
    const rep = st.report();
    const plan = st.input().plan;
    const markers = rep.summary.wealthTop.filter((t) => t.id).map((t) => rep.wealth.candidates.find((c) => c.id === t.id)).filter(Boolean)
      .map((c) => ({ id: c.id, point: c.point, sector: c.sector }));
    const lay = layoutMiniPlan({ plan, taiji: rep.planShares.taiji, up: plan.planUpBearing, markers }, 311, 335);
    const [nx, ny] = lay.north.at;
    for (const m of lay.markers) assert.ok(Math.hypot(m.at[0] - nx, m.at[1] - ny) >= 22, `指北針壓到標記 ${m.id}`);
    for (const s of lay.sectors) assert.ok(Math.hypot(s.label[0] - nx, s.label[1] - ny) >= 16, `指北針壓到方位名稱 ${s.gua}`);
  }
});

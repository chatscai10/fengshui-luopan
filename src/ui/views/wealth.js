// 財位畫面(產品核心):最佳財位卡 + 縮圖、其他候選、今年要留意的位置、催財小提醒。
// 文案一律來自 renderReport 的卡片;這裡只負責「挑哪些資料、怎麼排版」,不自己編風水結論。
// 任何地方都不顯示分數,只用三段標籤(較適合 / 可以考慮 / 不建議)。
// 純邏輯(buildWealthModel 等)可在 node 測試,DOM 只在 mount() 內碰。
import { h, clear } from '../dom.js';
import { renderReport, scrubText } from '../../core/copy.js';
import { guaOfDir, DIR8, normalizeBearing } from '../../core/geo.js';
import { mountMiniPlan, roomLabel } from '../canvas/miniPlan.js';
import { STAR_NAME } from '../canvas/starGrid.js';
import { ROOM_NAME, cornerText } from '../../core/wealth/findings.js';
import { ROOM_TYPE_LABEL } from '../plan/labels.js';

export { roomLabel };

// ─────────────────────────── 共用小工具(報告畫面也會用) ───────────────────────────

/** store.report() 理論上不會丟例外,但輸入前處理(座標換算)壞資料時可能丟;畫面一律當成「算不出結果」 */
export function safeReport(store) {
  try {
    return store.report();
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

export const TIER_LABEL = Object.freeze({ suitable: '較適合', consider: '可以考慮', notAdvised: '不建議' });
export const TIER_BADGE = Object.freeze({ suitable: 'badge badge--good', consider: 'badge badge--info', notAdvised: 'badge badge--warn' });

/** renderReport 卡片上的徽章文字 → 樣式。不只靠顏色,文字本身就說明意思。 */
export function badgeClass(text) {
  switch (text) {
    case '較適合':
    case '命宅相配':
      return 'badge badge--good';
    case '可以考慮':
    case '推論':
    case '少數派':
      return 'badge badge--info';
    case '不建議':
    case '需要留意':
    case '命宅不配':
      return 'badge badge--warn';
    case '傳統說法':
      return 'badge badge--wealth';
    default:
      return 'badge';
  }
}

const MARK = Object.freeze({
  good: { icon: '✓', word: '有利' },
  neutral: { icon: '－', word: '普通' },
  watch: { icon: '!', word: '需留意' },
});

/** 引擎給的加減方向 → 三種記號。門檻取自各星值表的自然分界(0.25 以上算有利、-0.2 以下算需留意)。 */
export function markOf(value) {
  if (!Number.isFinite(value)) return 'neutral';
  if (value >= 0.4) return 'good';
  if (value <= -0.2) return 'watch';
  return 'neutral';
}

const GUA_DIR_NAME = Object.freeze({ 坎: '北', 艮: '東北', 震: '東', 巽: '東南', 離: '南', 坤: '西南', 兌: '西', 乾: '西北' });

/** 某一宮裡佔比較大的房間(最多兩間)。沒有平面圖回空陣列。 */
export function roomsInGua(report, plan, gua) {
  const ps = report && report.planShares;
  if (!ps || !ps.palaces || !Array.isArray(ps.palaces[gua])) return [];
  const names = ps.palaces[gua].filter((e) => e.pct >= 0.2).slice(0, 2).map((e) => roomLabel(plan, e.roomId));
  return [...new Set(names)];
}

const STATUS_CHECK = Object.freeze({
  ok: { ok: true, text: '兩面都是實牆,角落沒有門或窗擋住' },
  void_window: { ok: false, text: '角落有窗(傳統上稱「財位見空」)' },
  void_floor_window: { ok: false, text: '角落有落地窗(傳統上稱「財位見空」)' },
  qi_intake_ok: { ok: true, text: '角落有窗;玄空派視為納氣,不扣分' },
  blocked_opening: { ok: false, text: '角落有門或通道,這個角落不成立' },
  blocked_walkway: { ok: false, text: '動線穿過這個角落,這個角落不成立' },
});

const G_TEXT = Object.freeze({
  mingPrimary: '進門後斜對角的牆角,是傳統上最通行的明財位',
  mingSecondCenter: '門開在牆的中央附近,左右兩個遠端角並列,這是其中一角',
  twoSolidWalls: '兩面都是實牆的牆角,位置比較穩',
  oneSolidWall: '只有一面實牆的位置,比較不穩',
  other: '牆角形狀一般',
});

// ─────────────────────────── 資料模型(純函式) ───────────────────────────

/**
 * 引擎文案裡偶爾還帶「分數」兩個字(例如「不進分數」),使用者看到會以為有分數可看。
 * 顯示前一律改成「排序」,句子仍然通順;數字格式的分數則由測試把關(findScoreLeaks)。
 */
export function softScoreWords(text) {
  // 畫面不能讓人以為有分數可看:分數→排序,扣分/加分→調降/調升排序
  return typeof text === 'string' ? text.replace(/分數/g, '排序').replace(/扣分/g, '調降排序').replace(/加分/g, '調升排序') : text;
}

/**
 * 引擎文案裡的房間名稱是類型名(「臥室的左下角」)。使用者幫房間取了名字、或同類型有好幾間時,
 * 畫面上要用平面圖看到的那個名字(「主臥的左下角」),否則兩間臥室會分不出是哪一間。
 * 回傳 Map<候選 id, {from, to}>;名字沒有比類型名更具體時不放進去。
 */
export function roomNameSwaps(report, plan) {
  const swaps = new Map();
  const cands = report && report.wealth && Array.isArray(report.wealth.candidates) ? report.wealth.candidates : [];
  if (!plan || !Array.isArray(plan.rooms)) return swaps;
  for (const c of cands) {
    if (!c || !c.roomId || c.corner == null) continue;
    const name = roomLabel(plan, c.roomId);
    const type = ROOM_NAME[c.roomType] ?? '這個空間';
    if (!name || name === type || name === ROOM_TYPE_LABEL[c.roomType]) continue;
    const corner = cornerText(c.corner);
    swaps.set(c.id, { from: `${type}的${corner}`, to: `${name}的${corner}` });
  }
  return swaps;
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 回傳一份文字已處理過的 renderReport 結果(不改動原物件)。給 report 與 plan 時,房間名稱換成使用者看得到的名字 */
export function sanitizePage(page, report = null, plan = null) {
  const swaps = roomNameSwaps(report, plan);
  // 候選 id 用冒號(bed2:TL),引擎的說明卡片 id 用點(wealth.ming.bed2.TL),兩種寫法都要認得
  const swapFor = (cardId) => {
    for (const [id, sw] of swaps) {
      for (const form of new Set([id, id.replace(':', '.')])) {
        if (new RegExp(`(^|[.])${escapeRe(form)}($|[.])`).test(cardId)) return sw;
      }
    }
    return null;
  };
  // 標題與內文可能各提到一次同一個角落,要全部換掉
  const apply = (text, sw) => (sw && typeof text === 'string' ? text.split(sw.from).join(sw.to) : text);
  const fix = (c) => {
    const sw = swapFor(c.id);
    const t = (v) => softScoreWords(apply(v, sw));
    return { ...c, headline: t(c.headline), body: t(c.body), schoolNote: t(c.schoolNote), footnote: t(c.footnote) };
  };
  const topId = report && report.summary && Array.isArray(report.summary.wealthTop) && report.summary.wealthTop[0]
    ? report.summary.wealthTop[0].id : null;
  return {
    ...page,
    plainSummary: softScoreWords(apply(page.plainSummary, topId ? swaps.get(topId) : null)),
    disclaimers: page.disclaimers.map(softScoreWords),
    sections: page.sections.map((s) => ({ ...s, cards: s.cards.map(fix) })),
  };
}

function allCards(page) {
  const map = new Map();
  for (const s of page.sections) for (const c of s.cards) map.set(c.id, c);
  return map;
}

function cardsMatching(page, test) {
  const out = [];
  for (const s of page.sections) for (const c of s.cards) if (test(c.id)) out.push(c);
  return out;
}

/** 「為什麼」清單:每項貢獻一行白話,用 ✓ / － / ! 記號(不靠顏色),完全不含分數 */
export function buildWhyRows(cand, sector, report) {
  const stars = (sector && sector.stars) || {};
  const nameOf = new Map((report.bazhai.residents || []).map((r) => [r.id, r.name]));
  const contribs = cand
    ? cand.contributions
    : sector ? ['XK', 'H', 'P', 'Y'].map((key) => ({ key, value: sector.components ? sector.components[key] : 0 })) : [];
  const rows = [];
  for (const c of contribs) {
    let title = '';
    let detail = '';
    if (c.key === 'G') {
      title = '位置形狀';
      detail = G_TEXT[cand && cand.gKind] || G_TEXT.other;
    } else if (c.key === 'XK') {
      if (!report.xuankong || stars.xiang == null) continue;
      title = '玄空盤(星的分布)';
      detail = `這一宮的山星是${STAR_NAME[stars.shan] || '?'}、向星是${STAR_NAME[stars.xiang] || '?'}`;
    } else if (c.key === 'H') {
      if (!stars.house) continue;
      title = '八宅(依大門定的吉方)';
      detail = `依大門定出的宅卦,這一方是「${stars.house}」位`;
    } else if (c.key === 'P') {
      const people = Object.entries(stars.people || {});
      if (people.length === 0) continue;
      title = '本命(依住戶命卦的吉方)';
      detail = people.map(([id, star]) => `依${nameOf.get(id) || '住戶'}的命卦,這一方是「${star}」位`).join(';');
    } else if (c.key === 'Y') {
      if (!stars.year) continue;
      title = '流年(今年的飛星)';
      detail = `今年飛到這一宮的星是${STAR_NAME[stars.year] || '?'}`;
    } else {
      continue;
    }
    const mark = markOf(c.value);
    rows.push({ key: c.key, title, detail, mark, markIcon: MARK[mark].icon, markWord: MARK[mark].word });
  }
  return rows;
}

/** 「現況檢查」與補救說明。補救文字直接取引擎產生的 Finding 卡片(已白話化) */
export function buildChecks(cand, page) {
  if (!cand) return { checks: [], remedies: [] };
  const checks = [];
  const st = STATUS_CHECK[cand.status];
  if (st) checks.push({ ok: st.ok, text: st.text });
  for (const d of cand.deductions || []) {
    if (d.kind === 'floor' || d.kind === 'reward') continue;
    if (d.flag === 'opening' && String(cand.status).startsWith('void')) continue; // 已在狀態那行說過
    const reason = d.reason ? `:${softScoreWords(scrubText(d.reason))}` : '';
    checks.push({ ok: false, text: `${softScoreWords(scrubText(d.label))}${reason}` });
  }
  if (cand.sectorInfo && cand.sectorInfo.borderline) {
    checks.push({ ok: false, text: '位置接近兩個方位的交界,畫圖的小誤差就可能落到另一個方位' });
  }
  const id = cand.id;
  const remedies = cardsMatching(page, (cid) =>
    cid === `wealth.ming.status.${id}` ||
    cid.startsWith(`wealth.ming.deduction.${id}.`) ||
    cid.startsWith(`wealth.ming.excluded.${id}.`) ||
    cid === `wealth.annual.bad_on_ming.${id}` ||
    cid === `wealth.borderline.${id}`).map((c) => ({ headline: c.headline, body: c.body, level: c.level }));
  return { checks, remedies };
}

function buildEntry(top, order, report, page, byId, state) {
  const cand = top.kind === 'dark' ? null : report.wealth.candidates.find((c) => c.id === top.id) || null;
  const sector = top.sector ? report.wealth.sectors[top.sector] : null;
  const card = byId.get(`card.wealth.${top.id}`) || null;
  const headline = card ? card.headline : top.label;
  const gua = top.sector;
  const dir = top.dir8 || (gua ? GUA_DIR_NAME[gua] : null);
  const hasSpot = Boolean(gua) && top.kind !== 'dark';
  const where = hasSpot ? `在房子的${dir}方(${gua}宮)。` : '';
  const lead = hasSpot ? `${headline},在房子的${dir}方(${gua}宮)` : headline;
  const { checks, remedies } = buildChecks(cand, page);
  const tier = top.tier;
  return {
    id: top.id,
    order,
    isDark: top.kind === 'dark',
    isMing: top.kind === 'ming',
    headline,
    lead,
    where,
    tier,
    tierLabel: TIER_LABEL[tier],
    // 徽章:引擎給的順序,但三段標籤已在標題旁顯示,這裡拿掉避免重複
    badges: card ? card.badges.filter((b) => b !== TIER_LABEL[tier]) : [],
    body: card ? card.body : '',
    schoolNote: card ? card.schoolNote : null,
    footnote: card ? card.footnote : null,
    level: card ? card.level : 'info',
    gua: gua || null,
    dir: dir || null,
    point: cand ? cand.point : null,
    roomName: top.roomId ? roomLabel(state.plan, top.roomId) : null,
    why: buildWhyRows(cand, sector, report),
    checks,
    remedies,
  };
}

function buildGuides(state, report, byId) {
  const guides = [];
  const has = (id) => report.findings.some((f) => f.id === id);
  if (!state.building || !state.building.builtYear) {
    guides.push({ id: 'year', text: '填上建成年份,才能排出玄空盤,看星怎麼落在各個方位。', label: '去填住宅資料', tab: 'house' });
  }
  if (!state.plan) {
    guides.push({ id: 'plan', text: '還沒有平面圖,現在只能告訴你哪個方位比較有利。畫出房子的大概格局,就能指出是家裡的哪個角落。', label: '去畫平面圖', tab: 'plan' });
  } else if (has('house.plan.invalid')) {
    const c = byId.get('house.plan.invalid');
    guides.push({ id: 'plan-invalid', text: c ? `${c.headline}。${c.body}` : '平面圖有不能使用的地方,請修正後再看結果。', label: '去修正平面圖', tab: 'plan' });
  } else if (has('wealth.plan.up_unknown')) {
    guides.push({ id: 'plan-up', text: '平面圖的方位還不明,暫時只能看房間形狀。請到平面圖確認圖面上方對應的方向。', label: '去看平面圖', tab: 'plan' });
  } else if (has('wealth.ming.no_door')) {
    guides.push({ id: 'door', text: '平面圖上還沒有標出大門,所以暫時算不出明財位(進門後斜對角的牆角)。', label: '去標大門', tab: 'plan' });
  } else if (!(Array.isArray(state.plan.openings) && state.plan.openings.some((o) => o && o.id === state.plan.mainDoor))) {
    guides.push({ id: 'door', text: '平面圖上還沒有標出大門。目前的明財位只是依各房間自己的門推算,不一定是進家門後的位置。', label: '去標大門', tab: 'plan' });
  }
  const skipped = (report.bazhai.skipped || []).length;
  if (!state.residents || state.residents.length === 0) {
    guides.push({ id: 'residents', text: '填上住戶的出生日期與性別,會補上依個人命卦的吉方,財位建議會更貼近你。(選填)', label: '去填住戶', tab: 'house' });
  } else if (skipped > 0) {
    guides.push({ id: 'residents-incomplete', text: `有 ${skipped} 位住戶的性別或出生日期不完整,還沒有算進去。`, label: '去補住戶資料', tab: 'house' });
  }
  return guides;
}

function buildAnnual(report, state, byId) {
  const an = report.annual;
  if (!an) return null;
  const item = (label, dir, gua) => ({ label, dir, gua, rooms: roomsInGua(report, state.plan, gua) });
  const sanshaGua = an.sansha ? guaOfDirSafe(an.sansha.dir) : null;
  const blocks = [
    { id: 'wuhuang', card: byId.get('card.annual.wuhuang') || null, items: [item('五黃', an.annual.wuhuang, an.annual.wuhuangGua), item('二黑', an.annual.erhei, an.annual.erheiGua)] },
    { id: 'taisui', card: byId.get('card.annual.taisui') || null, items: [item('太歲', an.taisui.dir, an.taisui.gua), item('歲破', an.taisui.suipoDir, an.taisui.suipoGua)] },
    { id: 'sansha', card: byId.get('card.annual.sansha') || null, items: [item('三煞', an.sansha.dir, sanshaGua)] },
  ].filter((b) => b.card);
  return { blocks, house: byId.get('card.annual.house') || null, hasPlan: Boolean(report.planShares) };
}

/** 圖面上方大約朝哪個方位(八方位取最近的),給縮圖圖例用 */
export function upDirText(up) {
  if (!Number.isFinite(up)) return '';
  return `${DIR8[Math.round(normalizeBearing(up) / 45) % 8]}方`;
}

function guaOfDirSafe(dir) {
  try { return guaOfDir(dir); } catch { return null; }
}

/**
 * 財位畫面的完整資料模型(純資料,無 DOM)。
 * status: 'no-facing' | 'error' | 'ok'
 */
export function buildWealthModel(state, report, rawPage) {
  if (!report || report.error === 'NO_FACING') return { status: 'no-facing' };
  if (report.error || !rawPage) return { status: 'error' };
  const page = sanitizePage(rawPage, report, state.plan);
  const byId = allCards(page);
  const tops = report.summary.wealthTop || [];
  const entries = tops.map((t, i) => buildEntry(t, i + 1, report, page, byId, state));
  const best = entries[0] || null;
  const showMap = Boolean(report.planShares && report.planShares.taiji && state.plan && entries.every((e) => e.isDark === false));
  const tips = cardsMatching(page, (id) => id === 'wealth.soft.tips' || id === 'wealth.annual.eight_white_boost' || id.startsWith('wealth.water.'))
    .map((c) => ({ id: c.id, headline: c.headline, body: c.body, badges: c.badges, schoolNote: c.schoolNote }));
  return {
    status: 'ok',
    guides: buildGuides(state, report, byId),
    best,
    others: entries.slice(1),
    map: showMap
      ? {
        plan: state.plan,
        taiji: report.planShares.taiji,
        up: report.planShares.planUpBearing,
        markers: entries.filter((e) => e.point).map((e) => ({ id: e.id, point: e.point, sector: e.gua, order: e.order })),
      }
      : null,
    annual: buildAnnual(report, state, byId),
    tips,
    disclaimers: page.disclaimers,
    hasNoGoodSpot: !best || best.tier === 'notAdvised',
  };
}

/** 給測試與畫面共用:把模型裡所有會顯示的字串蒐集起來 */
export function collectModelTexts(model) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  const { map, ...rest } = model;
  walk(rest);
  return out;
}

// ─────────────────────────── DOM ───────────────────────────

/** 一張 renderReport 卡片(財位與報告畫面共用)。caution 用醒目但不嚇人的樣式 */
export function renderInfoCard(card, { open = false } = {}) {
  const isCaution = card.level === 'caution';
  return h('article', { class: `v-card-item${isCaution ? ' is-caution' : ''}` },
    h('h3', { class: 'v-card-head' }, card.headline),
    h('div', { class: 'row tight v-card-badges' }, card.badges.map((b) => h('span', { class: badgeClass(b) }, b))),
    h('p', { class: 'v-card-body' }, card.body),
    card.schoolNote
      ? h('details', { class: 'v-card-more', open: open || null },
        h('summary', null, '根據哪一派、為什麼各派說法不同'),
        h('p', null, card.schoolNote))
      : null,
    card.footnote ? h('p', { class: 'v-card-foot faint' }, card.footnote) : null,
  );
}

function whyList(rows) {
  if (!rows.length) return null;
  return h('ul', { class: 'v-wealth-why list' }, rows.map((r) => h('li', { class: `is-${r.mark}` },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, r.markIcon),
    h('div', null,
      h('div', { class: 'v-wealth-why-t' }, r.title, h('span', { class: 'v-wealth-why-w' }, ` · ${r.markWord}`)),
      r.detail ? h('div', { class: 'sub' }, r.detail) : null),
  )));
}

function checkList(checks) {
  if (!checks.length) return null;
  return h('ul', { class: 'v-wealth-checks list' }, checks.map((c) => h('li', { class: c.ok ? 'is-ok' : 'is-bad' },
    h('span', { class: `mark ${c.ok ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }, c.ok ? '✓' : '✗'),
    h('span', null, h('span', { class: 'sr-only' }, c.ok ? '通過:' : '要留意:'), c.text),
  )));
}

function entryDetails(e, idPrefix, { showWhere = true } = {}) {
  const why = whyList(e.why);
  const checks = checkList(e.checks);
  return [
    showWhere && e.where ? h('p', { class: 'v-wealth-where' }, e.where) : null,
    h('div', { class: 'row tight' },
      h('span', { class: TIER_BADGE[e.tier] }, e.tierLabel),
      e.badges.map((b) => h('span', { class: badgeClass(b) }, b))),
    e.isDark ? h('p', { class: 'sub' }, '暗財位是依房子方位與星盤推算出來的方位,不是房間裡的固定角落。') : null,
    why ? h('h4', { class: 'v-wealth-h4' }, '為什麼是這裡') : null,
    why,
    checks ? h('h4', { class: 'v-wealth-h4' }, '現況檢查') : null,
    checks,
    e.remedies.length
      ? h('details', { class: 'v-card-more' },
        h('summary', null, '需要先處理的地方與補救辦法'),
        e.remedies.map((r) => h('div', { class: `v-wealth-remedy${r.level === 'caution' ? ' is-caution' : ''}` },
          h('div', { class: 'v-wealth-remedy-t' }, r.headline),
          h('p', null, r.body))))
      : null,
    e.body
      ? h('details', { class: 'v-card-more', id: `${idPrefix}-full` },
        h('summary', null, '完整說明'),
        h('p', { class: 'v-card-body' }, e.body),
        e.schoolNote ? h('p', { class: 'sub' }, e.schoolNote) : null,
        e.footnote ? h('p', { class: 'v-card-foot faint' }, e.footnote) : null)
      : null,
  ];
}

function annualItemText(it, hasPlan) {
  const where = `${it.label}在${it.dir}方${it.gua ? `(${it.gua}宮)` : ''}`;
  if (!hasPlan) return where;
  return it.rooms.length ? `${where},落在${it.rooms.join('、')}` : `${where},這一方沒有房間`;
}

function annualCard(a) {
  if (!a || !a.blocks.length) return null;
  return h('section', { class: 'card v-wealth-annual', 'aria-labelledby': 'v-wealth-annual-t' },
    h('h2', { class: 'card-title', id: 'v-wealth-annual-t' }, '這一年要留意的位置'),
    h('p', { class: 'sub' }, '下面是今年比較需要留意的方位,以及它落在你家的哪個空間。語氣放輕鬆看就好,平常照常生活。'),
    a.blocks.map((b) => h('div', { class: 'v-wealth-abox' },
      h('div', { class: 'v-wealth-abox-t' }, b.card.headline),
      h('ul', { class: 'v-wealth-alist' }, b.items.map((it) => h('li', null, annualItemText(it, a.hasPlan)))),
      h('p', { class: 'sub' }, b.card.body))),
    a.house
      ? h('div', { class: 'callout warn v-wealth-house' },
        h('strong', null, a.house.headline),
        h('p', null, a.house.body))
      : null,
  );
}

function tipsCard(tips) {
  if (!tips.length) return null;
  return h('section', { class: 'card v-wealth-tips', 'aria-labelledby': 'v-wealth-tips-t' },
    h('h2', { class: 'card-title', id: 'v-wealth-tips-t' }, '催財小提醒'),
    h('p', { class: 'sub' }, '這些是民間流傳的傳統說法,想參考再做,不做也沒關係。'),
    tips.map((t) => h('details', { class: 'v-card-more v-wealth-tip' },
      h('summary', null, t.headline, ' ', h('span', { class: 'badge badge--wealth' }, '傳統說法')),
      h('p', { class: 'v-card-body' }, t.body),
      t.schoolNote ? h('p', { class: 'sub' }, t.schoolNote) : null)),
  );
}

function guideCard(guides, ctx, title) {
  if (!guides.length) return null;
  return h('section', { class: 'card v-wealth-guide', 'aria-labelledby': 'v-wealth-guide-t' },
    h('h2', { class: 'card-title', id: 'v-wealth-guide-t' }, title),
    h('ul', { class: 'v-wealth-guidelist' }, guides.map((g) => h('li', null,
      h('span', null, g.text),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.go(g.tab) }, g.label)))),
  );
}

function noFacingView(ctx) {
  return h('section', { class: 'card wealth v-wealth-empty' },
    h('div', { class: 'empty' },
      h('span', { class: 'icon', html: ctx.icons.coin }),
      h('h2', { class: 'card-lead' }, '先量出你家的朝向'),
      h('p', null, '財位要先知道房子朝哪個方向。量好朝向後,這裡會告訴你家裡的財位在哪、為什麼、要注意什麼。'),
      h('p', { class: 'sub' }, '接著再補上建成年份、平面圖與住戶,結果會越來越貼近你家。'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.go('compass') }, '去量朝向')),
  );
}

function errorView(ctx) {
  return h('section', { class: 'card warn' },
    h('h2', { class: 'card-title' }, '暫時算不出財位'),
    h('p', null, '目前填的資料算不出結果,可能有哪個欄位不太對。資料沒有遺失,請回到住宅或平面圖檢查一下。'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('house') }, '檢查住宅資料'),
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('plan') }, '檢查平面圖')),
  );
}

// ─────────────────────────── 畫面 ───────────────────────────

export async function mount(root, ctx) {
  let destroyed = false;
  let mini = null;
  let selectedId = null;
  let lastReport;
  const openOthers = new Set();
  const view = h('div', { class: 'stack v-wealth' });
  root.append(view);
  const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let selectors = { caption: null, cards: new Map() };

  function select(id, { scroll = false } = {}) {
    selectedId = id;
    if (mini) mini.setSelected(id);
    for (const [cid, node] of selectors.cards) node.classList.toggle('is-selected', cid === id);
    if (selectors.caption) selectors.caption.update(id);
    if (scroll && selectors.mapEl && selectors.mapEl.scrollIntoView) {
      selectors.mapEl.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function render() {
    if (destroyed) return;
    if (mini) { mini.destroy(); mini = null; }
    selectors = { caption: null, cards: new Map(), mapEl: null };
    clear(view);
    const state = ctx.store.get();
    const report = safeReport(ctx.store);
    lastReport = report;

    let page = null;
    let model;
    try {
      page = report && !report.error ? renderReport(report) : null;
      model = buildWealthModel(state, report, page);
    } catch (e) {
      console.error('wealth', e);
      add(errorView(ctx));
      return;
    }
    if (model.status === 'no-facing') { add(noFacingView(ctx)); return; }
    if (model.status === 'error') { if (report && report.error) console.error('wealth', report.error); add(errorView(ctx)); return; }

    const entries = entriesOf(model);
    if (!entries.some((e) => e.id === selectedId)) selectedId = model.best ? model.best.id : null;

    add(guideCard(model.guides, ctx, model.guides.some((g) => g.id !== 'residents') ? '補上這些資料,結果會更完整' : '再補一項,建議會更貼近你'));

    if (!model.best) {
      add(h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, '財位'),
        h('p', null, '目前沒有可以列出的財位。請先補上上面的資料。')));
    } else {
      add(bestCard(model));
      if (model.others.length) {
        add(h('h2', { class: 'section-title' }, model.best.isDark ? '其他有利的方位' : '其他候選位置'));
        model.others.forEach((e) => add(otherCard(e)));
      }
    }
    add(annualCard(model.annual), tipsCard(model.tips));
    add(h('div', { class: 'v-wealth-more' },
      h('button', { class: 'btn btn-block', type: 'button', onclick: () => ctx.go('report') }, '看完整報告')));
    add(h('footer', { class: 'v-wealth-foot faint' },
      h('p', null, model.disclaimers[0]),
      model.disclaimers.length > 1
        ? h('details', { class: 'v-card-more' }, h('summary', null, '更多說明'), model.disclaimers.slice(1).map((d) => h('p', null, d)))
        : null));

    if (model.map) mountMap(model);
    select(selectedId);
  }

  function bestCard(model) {
    const e = model.best;
    const eyebrow = model.hasNoGoodSpot
      ? '目前沒有特別突出的位置'
      : e.isDark ? '目前看起來最有利的方位' : '你家最值得留意的財位';
    const mapHost = model.map ? h('div', { class: 'v-wealth-miniplan' }) : null;
    const caption = model.map ? h('div', { class: 'v-wealth-mapcap', 'aria-live': 'polite' }) : null;
    const legend = model.map
      ? h('p', { class: 'v-wealth-legend' },
        `十字是房子中心,金色圓點是大門,藍色短線是窗,虛線把房子分成八個方位。${Number.isFinite(model.map.up) ? `圖面上方約朝${upDirText(model.map.up)}。` : ''}`)
      : null;
    if (caption) {
      const label = (id) => (entriesOf(model).find((x) => x.id === id) || {}).headline || '';
      caption.update = (id) => {
        clear(caption);
        if (id === e.id) {
          caption.append(h('span', null, `圖上標示:${label(id)}`));
        } else {
          caption.append(
            h('span', null, `圖上標示:${label(id)}`),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => select(e.id) }, '回到最佳'));
        }
      };
      selectors.caption = caption;
    }
    selectors.mapEl = mapHost;
    const card = h('section', { class: 'card wealth v-wealth-best', 'aria-labelledby': 'v-wealth-best-t' },
      h('div', { class: 'card-title', id: 'v-wealth-best-t' }, eyebrow),
      mapHost,
      caption,
      legend,
      h('h2', { class: 'card-lead kai' }, e.lead),
      entryDetails(e, 'v-wealth-best', { showWhere: false }),
      h('p', { class: 'v-wealth-tiernote faint' }, '「較適合、可以考慮、不建議」只是本 App 的整理排序,不是保證。'),
    );
    selectors.cards.set(e.id, card);
    return card;
  }

  const entriesOf = (model) => [model.best, ...model.others].filter(Boolean);
  const add = (...nodes) => { for (const n of nodes) if (n) view.append(n); };

  function otherCard(e) {
    const bodyId = `v-wealth-other-${e.order}`;
    const isOpen = openOthers.has(e.id);
    const body = h('div', { class: 'v-wealth-otherbody', id: bodyId, hidden: isOpen ? null : true }, entryDetails(e, bodyId));
    const head = h('button', {
      class: 'v-wealth-otherhead', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': bodyId,
      onclick: () => {
        const nowOpen = body.hidden;
        body.hidden = !nowOpen;
        head.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) { openOthers.add(e.id); select(e.id, { scroll: true }); } else openOthers.delete(e.id);
      },
    },
      h('span', { class: 'v-wealth-order', 'aria-hidden': 'true' }, String(e.order)),
      h('span', { class: 'v-wealth-otitle' }, e.headline),
      h('span', { class: TIER_BADGE[e.tier] }, e.tierLabel),
      h('span', { class: 'v-wealth-chev', html: ctx.icons.chevron }),
    );
    const card = h('section', { class: 'card v-wealth-other' }, head, body);
    selectors.cards.set(e.id, card);
    return card;
  }

  function mountMap(model) {
    const host = selectors.mapEl;
    if (!host) return;
    const m = model.map;
    mini = mountMiniPlan(host, {
      plan: m.plan,
      taiji: m.taiji,
      up: m.up,
      markers: m.markers,
      selectedId,
      alt: `平面縮圖,標出 ${m.markers.length} 個財位候選位置。最佳位置:${model.best.headline}。`,
      onSelect: (id) => {
        const target = entriesOf(model).find((x) => x.id === id);
        if (target && !target.isDark && target.order > 1) openOthers.add(id);
        select(id);
        const node = selectors.cards.get(id);
        const btn = node && node.querySelector('.v-wealth-otherhead');
        const body = node && node.querySelector('.v-wealth-otherbody');
        if (btn && body) { body.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
      },
    });
  }

  const unsub = ctx.store.subscribe(() => {
    if (destroyed) return;
    const r = safeReport(ctx.store);
    if (r === lastReport && r && !r.error) return; // 只是分頁或主題變動,結果沒變
    render();
  });
  render();

  return {
    destroy() {
      destroyed = true;
      unsub();
      if (mini) { mini.destroy(); mini = null; }
    },
  };
}

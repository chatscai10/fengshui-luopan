// 財位(規格 2.6): 明財位幾何、暗財位(八宅/玄空/流年/本命)、禁忌檢核、候選排序、店面與辦公室座位。
// 純函式、無 DOM、無全域狀態、無網路;時間一律 ms epoch。依賴 geo、plan、bazhai、xuankong、annual 的真實輸出,不重算它們的規則。
// 輸出「永遠顯示明財位」(標籤「明財位」),不論排名,並列出每項貢獻與扣分理由;每個結論帶 Finding(tag=來源/推論/設計/少數派)。
// 星值、權重、乘數全是設計值(tag=設計,信心: 低),只有順序有來源;分數只用來排序,不可跨設定比較。
//
// 錯誤碼(message 開頭,後接冒號;規格沒列的自訂):
//   INVALID_INPUT       analyzeWealth 的 input 不是物件、doorOverride 或 flags 的形狀不對
//   MISSING_INPUT       缺 facing 或 now
//   INVALID_INSTANT     now 不是有限的 ms epoch
//   INVALID_HOUSEHOLD   household 不是陣列、成員不是物件、id 重複或不是非空字串
//   INVALID_SETTING     設定值不合法(檔位、qiIntake、multiOccupantPolicy、yearVal、布林開關)
//   INVALID_FLAG        環境旗標不認得或不是布林
//   INVALID_ROOM / INVALID_DOOR / INVALID_CORNER / INVALID_OPENING / INVALID_SEAT / INVALID_OPTION  見 wealth/geometry.js、wealth/seat.js
//   原樣轉出 geo、plan、bazhai、xuankong、annual、calendar 的錯誤碼: INVALID_BEARING、INVALID_PLAN、INVALID_YUN、INVALID_YEAR…
import { GUA, dirOfGua, guaAt, normalizeBearing } from './geo.js';
import { ROLES, mingGuaFromBirth } from './bazhai.js';
import { analyzeXuankong } from './xuankong.js';
import { formatCST } from './calendar.js';
import { assertValidPlan, openingCenter, sectorOfPoint, taijiPoint } from './plan.js';
import {
  BAZ_VAL,
  ENV_FLAGS,
  ENV_FLAG_NAMES,
  ENV_FLOOR,
  EXCLUSION_FLAGS,
  G_VAL,
  MAIN_ROOM_TYPES,
  MIN_OVERLAP_M,
  PROFILES,
  SOFT_ADVICE,
  WEALTH_SCHEMA,
  XK9_VAL,
  YEAR_VAL,
  ZONE_M,
} from './wealth/constants.js';
import {
  CORNERS,
  OPPOSITE_WALL,
  WALLS,
  asAxisRect,
  collinearOverlap,
  cornerZoneStatus,
  isNum,
  isObj,
  mingCaiWei,
  pickRoomDoor,
  ray45Hit,
  rightAngleVertices,
  walkDistances,
} from './wealth/geometry.js';
import { doorChong, seatCheck } from './wealth/seat.js';
import {
  annualWealthLayer,
  bazhaiDarkWealth,
  elementBoostForStar,
  mingGuaWealth,
  occupationWealth,
  settingsOf,
  waterHints,
  xuankongWealthCells,
  yearValues,
} from './wealth/layers.js';
import { envMultiplier, rankCandidates, scoreLocation, sectorComponents, sectorEnergy, xkStarValue } from './wealth/score.js';
import * as F from './wealth/findings.js';

export {
  BAZ_VAL,
  ENV_FLAGS,
  ENV_FLAG_NAMES,
  ENV_FLOOR,
  EXCLUSION_FLAGS,
  G_VAL,
  MAIN_ROOM_TYPES,
  PROFILES,
  SOFT_ADVICE,
  WEALTH_SCHEMA,
  XK9_VAL,
  YEAR_VAL,
  CORNERS,
  WALLS,
  OPPOSITE_WALL,
  asAxisRect,
  cornerZoneStatus,
  mingCaiWei,
  pickRoomDoor,
  ray45Hit,
  rightAngleVertices,
  walkDistances,
  doorChong,
  seatCheck,
  annualWealthLayer,
  bazhaiDarkWealth,
  elementBoostForStar,
  mingGuaWealth,
  occupationWealth,
  waterHints,
  xuankongWealthCells,
  yearValues,
  envMultiplier,
  rankCandidates,
  scoreLocation,
  sectorComponents,
  sectorEnergy,
  xkStarValue,
};

const EPS = 1e-9;
const fail = (code, msg) => {
  throw new Error(`${code}: ${msg}`);
};
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const MULTI_POLICIES = Object.freeze(['mean', 'breadwinner', 'each']);
const BOOL_SETTINGS = Object.freeze(['allowWaterHint', 'preferDragonSide', 'showRay45', 'virtualPartition', 'tianyiFirst']);
/** meta.ruleset 只回存財位實際讀取的設定(qiIntake 是實際採用的開口處理,見 analyzeWealth)。 */
const RULESET_KEYS = Object.freeze([
  'wealthProfile',
  'qiIntake',
  'allowWaterHint',
  'preferDragonSide',
  'showRay45',
  'virtualPartition',
  'multiOccupantPolicy',
  'taijiMode',
  'yearVal',
  'tianyiFirst',
  'bazhaiStarWeights',
  'bazhaiFacingBasis',
  'measureUncertainty',
  'xiaGuaHalfWidth',
  'jianLimitSchool',
  'useTiGua',
  'tiTable',
  'yunBasis',
  'renovation',
  'yunSystem',
  'qiScheme',
  'eightKeepsWealth',
  'wSide',
  'wYun',
]);

function validateSettings(s) {
  if (!has(PROFILES, s.wealthProfile)) fail('INVALID_SETTING', `wealthProfile 不認得: ${show(s.wealthProfile)}`);
  if (s.qiIntake !== 'penalty' && s.qiIntake !== 'reward') fail('INVALID_SETTING', `qiIntake 必須是 penalty 或 reward: ${show(s.qiIntake)}`);
  if (!MULTI_POLICIES.includes(s.multiOccupantPolicy)) fail('INVALID_SETTING', `multiOccupantPolicy 不認得: ${show(s.multiOccupantPolicy)}`);
  for (const k of BOOL_SETTINGS) if (typeof s[k] !== 'boolean') fail('INVALID_SETTING', `${k} 必須是布林: ${show(s[k])}`);
  yearValues(s);
}

// ─────────────────────────── 輸入整理 ───────────────────────────

function readFacing(facing, s) {
  let bazhai;
  let xuankong;
  if (typeof facing === 'number') {
    bazhai = facing;
    xuankong = facing;
  } else if (isObj(facing)) {
    ({ bazhai, xuankong } = facing);
  } else {
    fail('MISSING_INPUT', 'facing 必須是方位角(度)或 {bazhai, xuankong}');
  }
  if (bazhai === undefined && xuankong === undefined) fail('MISSING_INPUT', 'facing 需要 bazhai(大門朝向)或 xuankong(宅向)至少一個');
  const warnings = [];
  if (bazhai === undefined) {
    bazhai = xuankong;
    warnings.push('facingReused');
  } else if (xuankong === undefined) {
    xuankong = bazhai;
    warnings.push('facingReused');
  }
  // D08: 八宅預設用大門朝向,可切成沿用宅向。
  const house = s.bazhaiFacingBasis === 'house' ? xuankong : bazhai;
  normalizeBearing(house);
  normalizeBearing(xuankong);
  return { house, xuankong, warnings };
}

function readHousehold(list, s) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) fail('INVALID_HOUSEHOLD', 'household 必須是陣列');
  const seen = new Set();
  return list.map((p, i) => {
    if (!isObj(p)) fail('INVALID_HOUSEHOLD', `household[${i}] 必須是物件`);
    const id = p.id === undefined ? `p${i + 1}` : p.id;
    if (typeof id !== 'string' || id === '') fail('INVALID_HOUSEHOLD', `household[${i}].id 必須是非空字串`);
    if (seen.has(id)) fail('INVALID_HOUSEHOLD', `id 重複: ${id}`);
    seen.add(id);
    if (p.role !== undefined && p.role !== null && !ROLES.includes(p.role)) fail('INVALID_HOUSEHOLD', `${id} 的 role 不認得: ${show(p.role)}`);
    const gua = p.gua ?? p.mingGua ?? mingGuaFromBirth(p.birth, p.gender, s).gua;
    return { id, gua, role: p.role ?? null };
  });
}

/** 去掉連續重複點與首尾重複點,回傳新陣列(plan 允許 GeoJSON 式閉合環,幾何函式不允許)。 */
function cleanRing(poly) {
  const same = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
  const r = [];
  for (const p of poly) if (!r.length || !same(r[r.length - 1], p)) r.push([p[0], p[1]]);
  while (r.length > 1 && same(r[0], r[r.length - 1])) r.pop();
  return r;
}

const samePt = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

// ─────────────────────────── 平面圖 → 候選 ───────────────────────────

/** 開口中心所在的多邊形邊(編號與自邊起點量的距離)。 */
function edgeOfPoint(ring, point) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / len;
    const off = Math.abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / len;
    if (off <= 1e-7 && t >= -1e-9 && t <= len + 1e-9) return { edgeIndex: i, t };
  }
  return null;
}

/** 房間資訊: 環、軸向矩形(是的話)、房間內的開口。 */
function roomInfoOf(plan, room) {
  const ring = cleanRing(room.polygon);
  const rect = asAxisRect(ring);
  const openings = (plan.openings ?? []).filter((o) => o.roomId === room.id);
  return { room, ring, rect, openings, spec: rect ? { w: rect.w, d: rect.d, origin: rect.origin } : { polygon: ring } };
}

/** 供 cornerZoneStatus 用的開口清單。 */
function zoneOpeningsOf(plan, info, s) {
  return info.openings.map((o) => {
    if (info.rect) return { wall: o.wall, start: o.pos - o.width / 2, end: o.pos + o.width / 2, type: o.kind };
    const p = openingCenter(plan, o.id, s).point;
    const e = edgeOfPoint(info.ring, p);
    // 開口經 validatePlan 驗過在外接框的牆上,但凹形房間的內壁可能與外接框共線卻不在同一條邊上,
    // 這時 edgeOfPoint 找不到邊;回 edgeIndex: -1 讓 cornerZoneStatus 判為不合法而非裸讀 null 崩潰。
    if (e === null) return { edgeIndex: -1, start: 0, end: 0, type: o.kind };
    return { edgeIndex: e.edgeIndex, start: e.t - o.width / 2, end: e.t + o.width / 2, type: o.kind };
  });
}

/** 角落的名字: 矩形用 BL 等,多邊形用 V<頂點編號>。 */
function cornerNameOf(info, point) {
  if (info.rect) {
    const { w, d, origin } = info.rect;
    const pts = { BL: origin, BR: [origin[0] + w, origin[1]], TR: [origin[0] + w, origin[1] + d], TL: [origin[0], origin[1] + d] };
    return CORNERS.find((c) => samePt(pts[c], point));
  }
  return `V${info.ring.findIndex((p) => samePt(p, point))}`;
}

/** 角落兩面牆是否含玻璃或未頂天櫃體、是否與廁所共牆(自動旗標 no_solid_wall、toilet_adjacent)。 */
function adjacencyFlags(plan, info, allInfos, point) {
  const n = info.ring.length;
  const i = info.ring.findIndex((p) => samePt(p, point));
  const segs = [info.ring[(i + n - 1) % n], info.ring[(i + 1) % n]].map((q) => {
    const len = Math.hypot(q[0] - point[0], q[1] - point[1]);
    const k = Math.min(ZONE_M, len) / len;
    return [point, [point[0] + (q[0] - point[0]) * k, point[1] + (q[1] - point[1]) * k], Math.min(ZONE_M, len)];
  });
  let nonSolid = false;
  let toiletAdjacent = false;
  for (const [a, b, len] of segs) {
    for (const w of plan.walls ?? []) {
      if (w.kind !== 'solid' && collinearOverlap(a, b, w.segment[0], w.segment[1], 0, len) > MIN_OVERLAP_M + EPS) nonSolid = true;
    }
    for (const other of allInfos) {
      if (other === info || other.room.type !== 'toilet') continue;
      for (let j = 0; j < other.ring.length; j += 1) {
        const c = other.ring[j];
        const d = other.ring[(j + 1) % other.ring.length];
        if (collinearOverlap(a, b, c, d, 0, len) > MIN_OVERLAP_M + EPS) toiletAdjacent = true;
      }
    }
  }
  return { nonSolid, toiletAdjacent };
}

const round4 = (x) => Math.floor(x * 1e4 + 0.5) / 1e4;

// ─────────────────────────── 主分析 ───────────────────────────

/**
 * 財位完整分析(規格 2.6)。
 *   layers.ming     明財位(永遠顯示,含狀態、方位與分數)   layers.bazhai 八宅大門財位   layers.xuankong 玄空財位格
 *   layers.annual   流年財星                                  layers.mingGua 本命財位(有住戶才有)  layers.water 九運水火(allowWaterHint 才有)
 *   sectors         八宮各自的元件與宮位能量(不需要平面圖)
 *   candidates      候選位置(各主空間的明財位 + 各宮位中有兩面實牆的角落),依分數排序,每項列出貢獻與扣分理由;明財位不論排名都在裡面
 * 沒有門的資料時只給暗財位;平面圖方位未知時只做形狀分析(候選沒有宮位與分數)。
 * 流派開關: wealthProfile(mingcai/xuankong)、qiIntake(未明寫時跟著檔位: mingcai 扣分、xuankong 加分)、preferDragonSide、showRay45、
 * allowWaterHint、multiOccupantPolicy、taijiMode、yearVal、tianyiFirst 等,meta.ruleset 回存實際採用值。
 * @param {{
 *   facing: number|{bazhai?:number, xuankong?:number},
 *   now: number,
 *   plan?: import('./plan.js').Plan|null,
 *   chartYun?: number, currentYun?: number, builtAt?: number, movedInAt?: number, renovatedAt?: number,
 *   household?: Array<{id?:string, gua?:string, mingGua?:string, gender?:'M'|'F', birth?:{local:string, utcOffset:string, timeKnown?:boolean}, role?:string}>,
 *   flags?: Record<string, Record<string, boolean>>,
 *   candidateRoomIds?: string[], doorOverride?: Record<string,string>, shielded?: string[],
 *   northMode?: string, declination?: number, declinationDate?: string
 * }} input
 *   facing: 大門朝向與宅向(度,已依 northMode 換算;給數字則兩者相同);now: 判定流年與目前的運;
 *   玄空排盤需要 chartYun 或 builtAt(movedInAt、renovatedAt 依 yunBasis 與 renovation),都沒有則略過玄空層(XK=0);
 *   flags: 以候選 id(例 'living:TR')或房間 id 為鍵的環境旗標(beam、dark、sharp、stove_facing、toilet…);
 *   candidateRoomIds: 明確指定要找財位的房間(預設是 living、bedroom、study、other);doorOverride: 房間 id → 開口 id;
 *   shielded: 大門對面被玄關、牆或櫃遮擋的開口 id(門沖判定用)
 * @param {Partial<import('./settings.js').DEFAULT_SETTINGS>} [overrides] 流派開關,未知鍵丟 INVALID_SETTING
 * @returns {object} { meta, layers, sectors, candidates, ranking, bestId, mingCaiWei, doorChong, findings }
 * @throws {Error} 見檔頭錯誤碼
 */
export function analyzeWealth(input, overrides = {}) {
  if (!isObj(input)) fail('INVALID_INPUT', 'input 必須是物件');
  const s = settingsOf(overrides);
  validateSettings(s);
  // 玄空檔位的預設開口處理是 reward,但 qiIntake 的預設值是 penalty: 只有呼叫端明寫 qiIntake 才蓋過檔位。
  const explicitQi = isObj(overrides) && has(overrides, 'qiIntake');
  const opening = explicitQi ? s.qiIntake : PROFILES[s.wealthProfile].opening;
  const profileName = s.wealthProfile;
  const profile = PROFILES[profileName];

  if (input.now === undefined) fail('MISSING_INPUT', 'now(ms epoch)必填,用來判定流年與目前的運');
  if (!isNum(input.now)) fail('INVALID_INSTANT', `now 必須是有限數字(ms epoch): ${show(input.now)}`);
  const now = input.now;
  const facing = readFacing(input.facing, s);
  const household = readHousehold(input.household, s);
  const warnings = [...facing.warnings];
  const findings = [F.overviewFinding()];

  // ── 暗財位各層 ──
  const bazhai = bazhaiDarkWealth(facing.house, s);
  const annual = annualWealthLayer({ instant: now }, s);
  warnings.push(...annual.warnings.filter((w) => !warnings.includes(w)));

  const hasYunInfo = ['chartYun', 'builtAt', 'movedInAt', 'renovatedAt'].some((k) => input[k] !== undefined);
  let xk = null;
  if (hasYunInfo) {
    const xkInput = { facing: facing.xuankong, now };
    for (const k of ['chartYun', 'currentYun', 'builtAt', 'movedInAt', 'renovatedAt', 'northMode', 'declination', 'declinationDate']) {
      if (input[k] !== undefined) xkInput[k] = input[k];
    }
    xk = analyzeXuankong(xkInput, s);
  }
  const chart = xk ? xk.chart : null;
  const currentYun = xk ? xk.meta.currentYun : null;
  const cells = xk ? xuankongWealthCells(chart, currentYun) : null;
  if (xk) warnings.push(...xk.meta.warnings.filter((w) => !warnings.includes(w)));
  else warnings.push('xuankongUnavailable');

  const comps = sectorComponents({ chart, currentYun: currentYun ?? undefined, houseGua: bazhai.houseGua, people: household, annualChartByGua: annual.chartByGua, profile: profileName }, s);
  const energy = sectorEnergy(comps.components, profileName);
  const hasResidents = comps.meta.hasResidents;
  const scoreCap = round4(100 * (profile.G + (chart ? profile.XK : 0) + profile.H + (hasResidents ? profile.P : 0) + profile.Y));

  // ── 平面圖與候選 ──
  const plan = input.plan ?? null;
  const flagsIn = input.flags ?? {};
  if (!isObj(flagsIn)) fail('INVALID_INPUT', 'flags 必須是以候選 id 或房間 id 為鍵的物件');
  const doorOverride = input.doorOverride ?? {};
  if (!isObj(doorOverride)) fail('INVALID_INPUT', 'doorOverride 必須是房間 id → 開口 id 的物件');
  const shielded = new Set(input.shielded ?? []);

  let planUp = null;
  const mingCai = [];
  const cands = [];
  const chongList = [];
  if (plan === null) {
    warnings.push('noPlan');
    findings.push(F.noPlanFinding());
  } else {
    assertValidPlan(plan, s);
    planUp = plan.planUpBearing == null ? null : normalizeBearing(plan.planUpBearing);
    const taiji = taijiPoint(plan, s);
    if (taiji.warnings.includes('taijiOutsideOutline')) {
      warnings.push('taijiOutsideOutline');
      findings.push(F.taijiOutsideFinding());
    }
    if (planUp === null) {
      warnings.push('planUpBearingUnknown');
      findings.push(F.planUpUnknownFinding());
    }
    if (s.virtualPartition) {
      warnings.push('virtualPartitionUnsupported');
      findings.push(F.partitionFinding());
    }
    const infos = (plan.rooms ?? []).map((r) => roomInfoOf(plan, r));
    const wantIds = input.candidateRoomIds;
    if (wantIds !== undefined && !(Array.isArray(wantIds) && wantIds.every((x) => typeof x === 'string'))) fail('INVALID_INPUT', 'candidateRoomIds 必須是房間 id 字串陣列');
    const candInfos = infos.filter((i) => (wantIds ? wantIds.includes(i.room.id) : MAIN_ROOM_TYPES.includes(i.room.type)));
    let anyDoor = false;

    for (const info of candInfos) {
      const roomId = info.room.id;
      const zOps = zoneOpeningsOf(plan, info, s);
      const roomFlags = has(flagsIn, roomId) ? flagsIn[roomId] : {};
      const make = ({ point, kind, G, gKind, role }) => {
        const corner = cornerNameOf(info, point);
        const id = `${roomId}:${corner}`;
        const manual = { ...roomFlags, ...(has(flagsIn, id) ? flagsIn[id] : {}) };
        const zs = cornerZoneStatus(info.spec, corner, zOps, { opening, onWalkway: manual.walkway === true });
        const adj = adjacencyFlags(plan, info, infos, point);
        const flags = {};
        if (zs.voidKind) flags.opening = true;
        if (zs.status === 'blocked_opening') flags.door_swing = true;
        if (zs.status === 'blocked_walkway') flags.walkway = true;
        if (adj.nonSolid) flags.no_solid_wall = true;
        if (adj.toiletAdjacent) flags.toilet_adjacent = true;
        Object.assign(flags, manual);
        const sectorInfo = planUp === null ? null : sectorOfPoint(plan, point, s);
        const comp = sectorInfo ? comps.components[sectorInfo.gua] : null;
        const sc = comp ? scoreLocation(comp, { G, flags, profile: profileName, opening }) : null;
        if (!comp) envMultiplier(flags, opening); // 沒有宮位也要驗旗標名稱
        const cand = {
          id,
          kind,
          label: kind === 'ming' ? '明財位' : '兩面實牆的角落',
          isMingCai: kind === 'ming',
          roomId,
          roomType: info.room.type,
          corner,
          point: [point[0], point[1]],
          role,
          G,
          gKind,
          status: zs.status,
          holds: zs.holds,
          flags,
          sector: sectorInfo ? sectorInfo.gua : null,
          sectorInfo: sectorInfo
            ? { gua: sectorInfo.gua, dir8: sectorInfo.dir8, bearing: sectorInfo.bearing, boundaryDeg: sectorInfo.boundaryDeg, borderline: sectorInfo.borderline, otherGua: sectorInfo.otherGua }
            : null,
          components: comp ? { ...comp } : null,
          rawScore: sc ? sc.rawScore : null,
          score: sc ? sc.score : null,
          subtotal: sc ? sc.subtotal : null,
          envMultiplier: sc ? sc.envMultiplier : null,
          excluded: sc ? sc.excluded : Object.keys(flags).some((f) => flags[f] === true && EXCLUSION_FLAGS.includes(f)),
          contributions: sc ? sc.contributions : [],
          deductions: sc ? sc.deductions : [],
        };
        if (comp && s.multiOccupantPolicy === 'each' && hasResidents) {
          cand.byPerson = household.map((p) => {
            const one = scoreLocation({ ...comp, P: comps.perPerson[p.id][sectorInfo.gua] }, { G, flags, profile: profileName, opening });
            return { id: p.id, gua: p.gua, P: comps.perPerson[p.id][sectorInfo.gua], score: one.score };
          });
        }
        cands.push(cand);
        return cand;
      };

      // 明財位
      const override = has(doorOverride, roomId) ? doorOverride[roomId] : undefined;
      let doorOpening;
      if (override !== undefined) {
        doorOpening = info.openings.find((o) => o.id === override);
        if (!doorOpening) fail('INVALID_INPUT', `doorOverride.${roomId} 找不到開口: ${show(override)}`);
      } else {
        doorOpening = pickRoomDoor(info.openings);
      }
      const takenPoints = [];
      if (doorOpening) {
        anyDoor = true;
        const doorSpec = info.rect ? { wall: doorOpening.wall, pos: doorOpening.pos, width: doorOpening.width } : { point: openingCenter(plan, doorOpening.id, s).point, width: doorOpening.width };
        const mm = mingCaiWei(info.spec, doorSpec, { preferDragonSide: s.preferDragonSide, showRay45: s.showRay45 });
        const summary = {
          label: '明財位',
          roomId,
          roomType: info.room.type,
          door: { id: doorOpening.id, kind: doorOpening.kind, ...mm.door },
          geometry: mm.kind,
          centered: mm.centered,
          tied: mm.tied,
          dragonOnly: mm.dragonOnly,
          ray45: mm.ray45,
          warnings: mm.warnings,
          corners: [],
        };
        for (const c of mm.corners) {
          const cand = make({ point: c.point, kind: 'ming', G: c.role === 'primary' ? G_VAL.mingPrimary : G_VAL.mingSecondCenter, gKind: c.role === 'primary' ? 'mingPrimary' : 'mingSecondCenter', role: c.role });
          takenPoints.push(c.point);
          summary.corners.push({ corner: c.name, point: c.point, walkDist: c.walkDist, role: c.role, dragonSide: c.dragonSide, candidateId: cand.id });
          findings.push(F.mingCornerFinding({ roomId, roomType: info.room.type, corner: cand.corner, role: c.role, tied: mm.tied, sector: cand.sector, kind: mm.kind, dragonOnly: mm.dragonOnly }));
          const sf = F.statusFinding(cand.id, cand.status);
          if (sf) findings.push(sf);
        }
        if (mm.warnings.includes('noRightAngleCorner')) warnings.push(`noRightAngleCorner:${roomId}`);
        mingCai.push(summary);

        // 門沖: 只看大門(entrance)與對面牆上的開口(門、窗、落地窗、後門),矩形房間才有意義。
        if (info.rect && doorOpening.kind === 'entrance') {
          for (const opp of info.openings.filter((o) => o.wall === OPPOSITE_WALL[doorOpening.wall])) {
            const r = doorChong({ pos: doorOpening.pos, width: doorOpening.width }, { pos: opp.pos, width: opp.width }, { shielded: shielded.has(opp.id) });
            if (r.level === 'chong' || r.level === 'slight') {
              chongList.push({ roomId, front: doorOpening.id, opposite: opp.id, ...r });
              findings.push(F.doorChongFinding({ roomId, level: r.level, ratio: r.ratio, frontId: doorOpening.id, oppositeId: opp.id }));
            }
          }
        }
      } else {
        warnings.push(`noDoor:${roomId}`);
      }

      // 各宮位中有兩面實牆的角落(明財位角落已列的不重複)
      for (const i of rightAngleVertices(info.ring)) {
        const point = info.ring[i];
        if (takenPoints.some((p) => samePt(p, point))) continue;
        const corner = cornerNameOf(info, point);
        const zs = cornerZoneStatus(info.spec, corner, zOps, { opening });
        const adj = adjacencyFlags(plan, info, infos, point);
        if (zs.status !== 'ok' || adj.nonSolid) continue;
        make({ point, kind: 'wallCorner', G: G_VAL.twoSolidWalls, gKind: 'twoSolidWalls', role: null });
      }
    }
    if (!anyDoor) {
      warnings.push('noDoorData');
      findings.push(F.noDoorFinding());
    }
  }

  const ranked = rankCandidates(cands);

  // ── 逐候選的提示 ──
  for (const c of ranked) {
    if (c.isMingCai) {
      // 窗與角區的門、動線已有 status Finding,不重複
      const covered = { opening: ['void_window', 'void_floor_window', 'qi_intake_ok'], door_swing: ['blocked_opening'], walkway: ['blocked_walkway'] };
      for (const d of c.deductions) {
        if (d.kind === 'floor' || d.kind === 'reward' || covered[d.flag]?.includes(c.status)) continue;
        findings.push(F.deductionFinding(c.id, d));
      }
    }
    if (c.sectorInfo?.borderline) findings.push(F.borderlineFinding(c.id, c.sectorInfo));
    if (c.isMingCai && c.sector) {
      const ys = comps.stars[c.sector].year;
      if (ys === 5 || ys === 2) findings.push(F.badStarOnMingFinding(c.id, ys, c.sector));
    }
  }

  // ── 各層 Finding ──
  const facingDir = guaAt(facing.house).dir8;
  findings.push(F.bazhaiFinding({ houseName: bazhai.houseName, facingDir, order: bazhai.order }));
  if (xk) {
    findings.push(F.xuankongFinding({ chartYun: xk.meta.chartYun, currentYun, pattern: xk.pattern, cells }));
    for (const cell of [cells.primary, cells.secondary, cells.tertiary]) if (cell.wealthSide === 'back') findings.push(F.xuankongBackFinding(cell));
    if (comps.meta.xkValFallback) findings.push(F.xkFallbackFinding(currentYun));
  } else {
    findings.push(F.xuankongMissingFinding());
  }
  findings.push(F.annualFinding({ layer: annual }));
  const eight = annual.wealthStars.find((w) => w.star === 8);
  if (eight && eight.gua !== '中') findings.push(F.eightWhiteBoostFinding(eight.dir, elementBoostForStar(8)));
  const mingGuaLayer = household.length
    ? { byPerson: household.map((p) => ({ id: p.id, role: p.role, ...mingGuaWealth(p.gua, s) })), policy: s.multiOccupantPolicy }
    : null;
  if (mingGuaLayer) for (const p of mingGuaLayer.byPerson) findings.push(F.mingGuaFinding(p.id, p));
  let water = null;
  if (s.allowWaterHint) {
    water = waterHints(chart, currentYun ?? 0);
    water.forEach((h, i) => findings.push(F.waterFinding(h, i)));
  }
  if (mingCai.length > 0) findings.push(F.softAdviceFinding());
  if (!hasResidents) warnings.push('noResidents');
  findings.push(F.rankFinding({ noResidents: !hasResidents, cap: scoreCap }));

  const best = ranked.find((c) => c.rank !== null && c.score > 0);

  return {
    meta: {
      schema: WEALTH_SCHEMA,
      ruleset: Object.fromEntries(
        RULESET_KEYS.map((k) => {
          const v = k === 'qiIntake' ? opening : s[k];
          return [k, isObj(v) ? { ...v } : v];
        }),
      ),
      northMode: input.northMode ?? s.northMode,
      declination: input.declination ?? null,
      declinationDate: input.declinationDate ?? null,
      computedAtCST: formatCST(now),
      warnings,
      xkValFallback: comps.meta.xkValFallback,
      hasResidents,
      scoreCap,
    },
    layers: {
      ming: mingCai,
      bazhai,
      xuankong: xk
        ? {
            chartYun: xk.meta.chartYun,
            currentYun,
            pattern: xk.pattern,
            sit: xk.chart.meta.sit,
            face: xk.chart.meta.face,
            cells,
            positions: xk.positions.wealth.map((r) => ({ ...r, pairTags: [...r.pairTags] })),
            backPalaces: [...comps.meta.backPalaces],
          }
        : null,
      annual,
      mingGua: mingGuaLayer,
      water,
    },
    sectors: Object.fromEntries(
      GUA.map((g) => [g, { gua: g, dir: dirOfGua(g), components: { ...comps.components[g] }, stars: { ...comps.stars[g], people: { ...comps.stars[g].people } }, energy: energy[g] }]),
    ),
    candidates: ranked,
    ranking: ranked.filter((c) => c.rank !== null).map((c) => c.id),
    bestId: best ? best.id : null,
    mingCaiWei: mingCai,
    doorChong: chongList,
    findings,
  };
}


// analyze 測試專用工具: 黃金案例輸入、深凍結、JSON 安全檢查、隨機輸入產生器、原始碼中的 Finding id 掃描。
// 刻意不 import src/core/analyze.js 與 copy.js,測試對照用的期望值來自規格文字或獨立算法。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from './plan.js';

export { mulberry32 };

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC_CORE = path.join(here, '..', '..', 'src', 'core');
export const SPEC_TEXT = readFileSync(path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md'), 'utf8');

/** 2026-09-29 12:00 CST。九運、2026 流年(規格 2.6.7 已驗證算術例的基準時刻)。 */
export const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const clone = (x) => JSON.parse(JSON.stringify(x));

/** 規格 2.6.7: 外框 10x8(重心 (5,4))、客廳 6x5、門在下牆 x=1.0、平面圖上方 30 度。 */
export function goldenPlan({ openings, walls, rooms, planUp = 30 } = {}) {
  const plan = {
    version: 1,
    unit: 'm',
    planUpBearing: planUp,
    outline: [[0, 0], [10, 0], [10, 8], [0, 8]],
    rooms: rooms ?? [{ id: 'living', type: 'living', polygon: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
    openings: openings ?? [{ id: 'd1', kind: 'entrance', roomId: 'living', wall: 'bottom', pos: 1.0, width: 0.9 }],
    mainDoor: 'd1',
    taiji: { mode: 'centroid', manual: null },
  };
  if (walls) plan.walls = walls;
  return plan;
}

/** 黃金案例: 九運丑山未向(向 210 度)、2026-09-29、坎命一位住戶(1990 男)、10x8 外框與 6x5 客廳。 */
export function goldenInput(extra = {}) {
  return {
    nowMs: NOW,
    utcOffsetMinutes: 480,
    facing: { bearing: 210, doorBearing: null, declination: -5.06, uncertainty: null },
    building: { type: 'apartment', builtYear: 2025, moveInYear: null, renovation: 'none', floor: null },
    residents: [{ id: 'p1', name: '本人', gender: 'M', birth: '1990-05-15 10:30', utcOffsetMinutes: null }],
    mainResidentId: 'p1',
    plan: goldenPlan(),
    ...extra,
  };
}

/** 走訪物件,收集所有字串與數字;遇到 undefined、NaN、Infinity、函式、Map/Set/Date 就回報。 */
export function jsonProblems(x, at = '$', out = []) {
  if (x === undefined) out.push(`${at} 是 undefined`);
  else if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') out.push(`${at} 型別 ${typeof x}`);
  else if (typeof x === 'number') {
    if (!Number.isFinite(x)) out.push(`${at} 不是有限數字: ${x}`);
    else if (Object.is(x, -0)) out.push(`${at} 是 -0`);
  } else if (x !== null && typeof x === 'object') {
    if (x instanceof Map || x instanceof Set || x instanceof Date) out.push(`${at} 是 ${x.constructor.name}`);
    else if (Array.isArray(x)) x.forEach((v, i) => jsonProblems(v, `${at}[${i}]`, out));
    else for (const [k, v] of Object.entries(x)) jsonProblems(v, `${at}.${k}`, out);
  }
  return out;
}

/** 渲染結果裡所有給使用者看的文字(不含 id 等索引欄位)。 */
export function displayTexts(rendered) {
  const t = [rendered.plainSummary, ...rendered.disclaimers];
  for (const s of rendered.sections) {
    t.push(s.title);
    for (const c of s.cards) {
      t.push(c.headline, c.body, ...c.badges);
      if (c.schoolNote) t.push(c.schoolNote);
      if (c.footnote) t.push(c.footnote);
    }
  }
  return t;
}

/** 走遍 src/core 所有 .js(不含 copy.js),掃出程式裡寫死的 Finding id(含樣板字串,${…} 以 x 代入)。回傳 id → 出現的檔案集合。 */
export function scanFindingIds() {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.js')) files.push(p);
    }
  };
  walk(SRC_CORE);
  const ids = new Map();
  const add = (id, file) => {
    if (id.includes('#') || /\.(json|js|md)$/.test(id) || /^\S*\.\.\./.test(id)) return;
    if (!ids.has(id)) ids.set(id, new Set());
    ids.get(id).add(path.relative(SRC_CORE, file).split(path.sep).join('/'));
  };
  const prefix = '(?:geo|bz|xk|annual|wealth|house)';
  for (const f of files) {
    // copy.js 的家族表用 id 前綴當 key,不是 Finding 的產生處。
    if (path.basename(f) === 'copy.js') continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(new RegExp(`(['"])(${prefix}\\.[A-Za-z0-9_.-]+)\\1`, 'g'))) add(m[2], f);
    for (const m of text.matchAll(new RegExp('`(' + prefix + '\\.[^`]*)`', 'g'))) add(m[1].replace(/\$\{[^}]*\}/g, 'x'), f);
  }
  return ids;
}

const pick = (rng, a) => a[Math.floor(rng() * a.length)];

function randomPlan(rng, kind) {
  if (kind === 'none') return null;
  if (kind === 'upNull') return { ...clonePlanWith(rng, {}), planUpBearing: null };
  if (kind === 'rich') return clonePlanWith(rng, { window: true, toilet: true, glass: true, back: true });
  return clonePlanWith(rng, {});
}

function clonePlanWith(rng, extra) {
  const wall = pick(rng, ['bottom', 'top', 'left', 'right']);
  const opp = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' }[wall];
  const len = wall === 'bottom' || wall === 'top' ? 6 : 5;
  const pos = 1 + rng() * (len - 2);
  const openings = [{ id: 'd1', kind: 'entrance', roomId: 'living', wall, pos, width: 0.9 }];
  if (extra.window) openings.push({ id: 'w1', kind: pick(rng, ['window', 'floorWindow']), roomId: 'living', wall: pick(rng, ['right', 'top']), pos: 4, width: 1.2 });
  if (extra.back) openings.push({ id: 'w2', kind: 'window', roomId: 'living', wall: opp, pos, width: 0.9 });
  const rooms = [{ id: 'living', type: 'living', polygon: [[0, 0], [6, 0], [6, 5], [0, 5]] }];
  if (extra.toilet) rooms.push({ id: 'toilet', type: 'toilet', polygon: [[6, 0], [8, 0], [8, 2], [6, 2]] });
  const plan = {
    version: 1,
    unit: 'm',
    planUpBearing: rng() * 360,
    outline: [[0, 0], [10, 0], [10, 8], [0, 8]],
    rooms,
    openings,
    mainDoor: 'd1',
    taiji: { mode: 'centroid', manual: null },
  };
  if (extra.glass) plan.walls = [{ segment: [[6, 0], [6, 5]], kind: 'glass' }];
  return plan;
}

/**
 * 固定種子的隨機輸入與流派開關,涵蓋缺資料、多住戶、雙向、真北、各種少數派開關。全部都是「合法但可能不完整」的輸入,不應丟錯。
 * @returns {{input:object, settings:object, opts:object}}
 */
export function randomHouse(rng) {
  const declination = pick(rng, [null, -5.06, 4, -8]);
  const residentsChoices = [
    [],
    [{ gender: 'M', birth: '1990-05-15 10:30', name: '甲' }],
    [{ id: 'a', gender: 'F', birth: '1985-02-04', name: '乙' }, { id: 'b', gender: 'M', birth: '1988-11-20 08:00' }],
    [{ id: 'x', gender: 'X', birth: 'bad' }],
    [{ gender: 'F', birth: '2000-02-04 10:00' }],
    [{ id: 'm', gender: 'M', birth: '1990-05-15' }, { id: 'f', gender: 'F', birth: '1990-08-08 12:00' }],
  ];
  const input = {
    nowMs: Date.UTC(2024 + Math.floor(rng() * 6), Math.floor(rng() * 12), 1 + Math.floor(rng() * 28), Math.floor(rng() * 24), Math.floor(rng() * 60)),
    utcOffsetMinutes: 480,
    facing: { bearing: rng() * 360, doorBearing: pick(rng, [null, null, rng() * 360]), declination, uncertainty: pick(rng, [null, null, 3, 8]) },
    building: pick(rng, [
      null,
      {
        type: pick(rng, ['apartment', 'house', 'shop', 'office']),
        builtYear: pick(rng, [2024, 2025, 2010, 2004, 1995, null, 1984]),
        moveInYear: pick(rng, [null, 2025, 2015]),
        renovation: pick(rng, ['none', 'partial', 'full', 'anyRenovation']),
        floor: 5,
      },
    ]),
    residents: pick(rng, residentsChoices),
    mainResidentId: pick(rng, [null, 'a', 'zz', 'm']),
    plan: randomPlan(rng, pick(rng, ['none', 'plain', 'rich', 'upNull'])),
  };
  const settings = {};
  const flip = (p) => rng() < p;
  if (flip(0.4)) settings.northMode = 'true';
  if (flip(0.3)) settings.wealthProfile = 'xuankong';
  if (flip(0.3)) settings.showMinorityTechniques = true;
  if (flip(0.3)) settings.extraShensha = true;
  if (flip(0.3)) settings.showLianshu = true;
  if (flip(0.3)) settings.showChengmen = true;
  if (flip(0.3)) settings.allowWaterHint = true;
  if (flip(0.2)) settings.showGuimenxian = true;
  if (flip(0.2)) settings.useTiGua = true;
  if (flip(0.2)) settings.yunBasis = 'moveIn';
  if (flip(0.2)) settings.virtualPartition = true;
  if (flip(0.2)) settings.coupleBasis = pick(rng, ['wife', 'husband', 'holderOnly', 'averaged']);
  if (flip(0.15)) settings.kongwangLabelScheme = 'degree';
  if (flip(0.15)) settings.multiOccupantPolicy = pick(rng, ['breadwinner', 'each']);
  const opts = flip(0.2) ? { lunarNewYearOf: (y) => `${y}-02-01` } : {};
  if (opts.lunarNewYearOf && flip(0.7)) settings.yearBoundary = 'lunar_new_year';
  return { input, settings, opts };
}

// 平面圖範本。每個範本回傳一份 PlanV1(規格 2.7.1)外加 UI 專用欄位 upMode / upOffset。
//
// 圖面約定:上方 = 房子的向(前方),所以大門一律開在「上牆」(top)。
// 座標 x 向右、y 向上、單位公尺;開口 pos 是中心沿牆自房間外接框左下角起算的距離,
// 範本內用「絕對座標」描述,再由 openingAt 換算成 pos,避免手算出錯。
//
// 設計規則(由 test/ui/plan_templates.test.js 把關):
//  1. 通過 validatePlan 且沒有警告。
//  2. 每個客廳/臥室/書房/其他空間都有通往它的門,財位分析才不會出現「找不到門」。
//  3. 只有一個大門(kind 'entrance'),也是 mainDoor,開在上牆。
//  4. 門窗避開房間角落 1 公尺內,才不會一開始就讓每個角落都被判成「財位見空」。
//
// planUpBearing 只是引擎必填欄位的佔位值;實際數值一律由 store.input() 依朝向與 upMode 重算。

import { OPENING_DEFAULT_WIDTH } from './labels.js';

export const CUSTOM_MIN = 2.4;   // 自訂矩形的最小邊長(公尺),再小放不下一扇門
export const CUSTOM_MAX = 40;

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;

const room = (id, type, name, x0, y0, x1, y1) => ({
  id, type, name, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
});

/** 依絕對座標 at(沿牆方向的座標)放開口,換算成房間內的 pos */
function openingAt(rooms, id, kind, roomId, wall, at, width = OPENING_DEFAULT_WIDTH[kind]) {
  const r = rooms.find((x) => x.id === roomId);
  const xs = r.polygon.map((p) => p[0]);
  const ys = r.polygon.map((p) => p[1]);
  const origin = wall === 'top' || wall === 'bottom' ? Math.min(...xs) : Math.min(...ys);
  return { id, kind, roomId, wall, pos: round3(at - origin), width };
}

function makePlan(rooms, openingSpecs, outlineBox, mainDoor = 'd1') {
  const [w, d] = outlineBox;
  return {
    version: 1,
    unit: 'm',
    planUpBearing: 0,
    outline: [[0, 0], [w, 0], [w, d], [0, d]],
    rooms,
    openings: openingSpecs.map((s) => openingAt(rooms, ...s)),
    walls: [],
    mainDoor,
    taiji: { mode: 'centroid', manual: null },
    upMode: 'facing',
    upOffset: 0,
  };
}

// 開口規格:[id, kind, roomId, wall, 沿牆絕對座標, 寬度?]

function studio() {
  const rooms = [
    room('living', 'living', '客廳', 0, 3.2, 5, 7),
    room('bed', 'bedroom', '臥室', 0, 0, 3.2, 3.2),
    room('kitchen', 'kitchen', '廚房', 3.2, 1.8, 5, 3.2),
    room('toilet', 'toilet', '廁所', 3.2, 0, 5, 1.8),
  ];
  return makePlan(rooms, [
    ['d1', 'entrance', 'living', 'top', 1.7, 1.0],
    ['d2', 'door', 'bed', 'top', 1.6],
    ['d3', 'door', 'kitchen', 'top', 4.1, 0.8],
    ['d4', 'door', 'toilet', 'left', 0.9, 0.75],
    ['w1', 'window', 'living', 'left', 5.1, 1.5],
    ['w2', 'window', 'living', 'right', 5.1, 1.5],
    ['w3', 'window', 'bed', 'left', 1.6, 1.2],
    ['w4', 'window', 'bed', 'bottom', 1.6, 1.2],
  ], [5, 7]);
}

function twoBedroom() {
  const rooms = [
    room('living', 'living', '客廳', 0, 4.6, 5.6, 8),
    room('kitchen', 'kitchen', '廚房', 5.6, 4.6, 8, 8),
    room('bed1', 'bedroom', '主臥', 0, 0, 3.4, 4.6),
    room('hall', 'entry', '走道', 3.4, 0, 4.6, 4.6),
    room('bed2', 'bedroom', '次臥', 4.6, 0, 8, 2.8),
    room('toilet', 'toilet', '廁所', 4.6, 2.8, 8, 4.6),
  ];
  return makePlan(rooms, [
    ['d1', 'entrance', 'living', 'top', 1.7, 1.0],
    ['d2', 'door', 'bed1', 'right', 2.3],
    ['d3', 'door', 'bed2', 'left', 1.4],
    ['d4', 'door', 'toilet', 'left', 3.7, 0.75],
    ['d5', 'door', 'kitchen', 'left', 6.3, 0.8],
    ['w1', 'window', 'living', 'left', 6.3, 1.2],
    ['w2', 'window', 'kitchen', 'right', 6.3, 1.0],
    ['w3', 'window', 'bed1', 'left', 2.3, 1.4],
    ['w4', 'window', 'bed1', 'bottom', 1.7, 1.4],
    ['w5', 'window', 'bed2', 'bottom', 6.3, 1.4],
  ], [8, 8]);
}

function threeBedroom() {
  const rooms = [
    room('living', 'living', '客廳', 0, 6.4, 5.2, 9.8),
    room('dining', 'living', '餐廳', 5.2, 6.4, 7.4, 9.8),
    room('kitchen', 'kitchen', '廚房', 7.4, 6.4, 10, 9.8),
    room('hall', 'entry', '走道', 3.4, 0, 4.6, 6.4),
    room('bed2', 'bedroom', '次臥 1', 0, 3.2, 3.4, 6.4),
    room('bed3', 'bedroom', '次臥 2', 0, 0, 3.4, 3.2),
    room('master', 'bedroom', '主臥', 4.6, 0, 10, 3.6),
    room('bath', 'toilet', '廁所', 4.6, 3.6, 6.4, 6.4),
    room('study', 'study', '書房', 6.4, 3.6, 10, 6.4),
  ];
  return makePlan(rooms, [
    ['d1', 'entrance', 'living', 'top', 1.7, 1.0],
    ['d2', 'door', 'dining', 'left', 8.1, 1.4],
    ['d3', 'door', 'kitchen', 'left', 8.1, 0.8],
    ['d4', 'door', 'bed2', 'right', 4.8],
    ['d5', 'door', 'bed3', 'right', 1.6],
    ['d6', 'door', 'master', 'left', 1.8],
    ['d7', 'door', 'bath', 'left', 5.0, 0.75],
    ['d8', 'door', 'study', 'top', 6.9, 0.8],
    ['w1', 'window', 'living', 'left', 8.1, 1.4],
    ['w2', 'window', 'kitchen', 'right', 8.1, 1.0],
    ['w3', 'window', 'bed2', 'left', 4.8, 1.2],
    ['w4', 'window', 'bed3', 'left', 1.6, 1.2],
    ['w5', 'window', 'bed3', 'bottom', 1.7, 1.4],
    ['w6', 'window', 'master', 'bottom', 7.3, 1.8],
    ['w7', 'window', 'study', 'right', 5.0, 0.8],
  ], [10, 9.8]);
}

function shop() {
  const rooms = [
    room('shop', 'living', '營業空間', 0, 2.4, 6, 10),
    room('store', 'other', '倉庫', 0, 0, 3.6, 2.4),
    room('toilet', 'toilet', '廁所', 3.6, 0, 6, 2.4),
  ];
  return makePlan(rooms, [
    ['d1', 'entrance', 'shop', 'top', 1.7, 1.2],
    ['f1', 'floorWindow', 'shop', 'top', 3.9, 2.0],
    ['d2', 'door', 'store', 'top', 1.8, 0.9],
    ['d3', 'door', 'toilet', 'top', 4.8, 0.75],
    ['w1', 'window', 'shop', 'left', 7, 1.6],
    ['w2', 'window', 'shop', 'right', 7, 1.6],
  ], [6, 10]);
}

/** 檢查自訂矩形的寬與深;回傳 { w, d } 或 { error } */
export function parseCustomSize(width, depth) {
  const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.\-]/g, '')));
  const w = round1(num(width));
  const d = round1(num(depth));
  if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0) return { error: '請輸入寬與深(公尺,例如 6 和 8)' };
  if (w < CUSTOM_MIN || d < CUSTOM_MIN) return { error: `寬和深都至少要 ${CUSTOM_MIN} 公尺` };
  if (w > CUSTOM_MAX || d > CUSTOM_MAX) return { error: `寬和深都不要超過 ${CUSTOM_MAX} 公尺` };
  return { w, d };
}

function custom(w, d) {
  const rooms = [room('space', 'living', '室內空間', 0, 0, w, d)];
  // 大門靠左上,避開角落 1 公尺;太窄的牆就放正中央
  const doorW = 1.0;
  const doorX = w >= 4.2 ? round1(Math.min(Math.max(w * 0.3, 1.6), w - 1.6)) : round1(w / 2);
  const specs = [['d1', 'entrance', 'space', 'top', doorX, doorW]];
  // 窗:牆夠長才開,避開角落 1 公尺
  const winW = (len) => round1(Math.min(1.8, len - 2.1));
  if (w >= 3.7) specs.push(['w1', 'window', 'space', 'bottom', round1(w / 2), winW(w)]);
  if (d >= 3.7) {
    specs.push(['w2', 'window', 'space', 'left', round1(d / 2), winW(d)]);
    specs.push(['w3', 'window', 'space', 'right', round1(d / 2), winW(d)]);
  }
  return makePlan(rooms, specs, [w, d]);
}

/**
 * 範本清單(給選擇畫面)。desc 是白話一句話,size 是大約尺寸。
 * custom 需要另外輸入寬與深。
 */
export const TEMPLATES = Object.freeze([
  { id: 'studio', label: '套房', desc: '一個大空間加臥室、廚房、廁所,約 10 坪', size: '5 × 7 公尺' },
  { id: 'two', label: '2 房 1 廳', desc: '客廳、廚房、兩間臥室、廁所,約 19 坪', size: '8 × 8 公尺' },
  { id: 'three', label: '3 房 2 廳', desc: '客廳加餐廳、三間臥室、書房,約 30 坪', size: '10 × 9.8 公尺' },
  { id: 'shop', label: '店面單間', desc: '一個營業空間、倉庫與廁所', size: '6 × 10 公尺' },
  { id: 'custom', label: '自訂矩形', desc: '只有一個房間,自己輸入寬與深', size: '自訂' },
]);

/**
 * 產生範本的平面圖。custom 要帶 { width, depth }(公尺)。
 * @returns {{plan:object}|{error:string}}
 */
export function buildTemplate(id, opts = {}) {
  switch (id) {
    case 'studio': return { plan: studio() };
    case 'two': return { plan: twoBedroom() };
    case 'three': return { plan: threeBedroom() };
    case 'shop': return { plan: shop() };
    case 'custom': {
      const s = parseCustomSize(opts.width, opts.depth);
      if (s.error) return { error: s.error };
      return { plan: custom(s.w, s.d) };
    }
    default: return { error: '不認得這個範本' };
  }
}

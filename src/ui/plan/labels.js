// 平面圖畫面共用的白話名稱與預設尺寸。純資料,不碰 DOM。
// 畫面上一律用這裡的中文,不可讓 'living'、'kind' 這類內部代碼露出來。

export const ROOM_TYPE_LABEL = Object.freeze({
  living: '客廳',
  bedroom: '臥室',
  kitchen: '廚房',
  toilet: '廁所',
  study: '書房',
  entry: '玄關/走道',
  balcony: '陽台',
  stair: '樓梯',
  other: '其他空間',
});

/** 新增房間選單的順序(常用的排前面) */
export const ROOM_TYPE_ORDER = Object.freeze(['living', 'bedroom', 'kitchen', 'toilet', 'study', 'entry', 'balcony', 'stair', 'other']);

/** 新增房間的預設大小(公尺,寬 × 深) */
export const ROOM_DEFAULT_SIZE = Object.freeze({
  living: [4.5, 3.6],
  bedroom: [3.4, 3.2],
  kitchen: [2.6, 2.6],
  toilet: [1.8, 2.2],
  study: [2.8, 2.8],
  entry: [1.2, 2.6],
  balcony: [3.0, 1.4],
  stair: [1.2, 3.0],
  other: [2.6, 2.6],
});

export const OPENING_LABEL = Object.freeze({
  entrance: '大門',
  door: '室內門',
  window: '窗',
  floorWindow: '落地窗',
  balconyDoor: '陽台門',
});

/** 新增開口選單(大門另外走「設為大門」) */
export const OPENING_ADD_ORDER = Object.freeze(['door', 'window', 'floorWindow', 'balconyDoor', 'entrance']);

/** 各種開口的預設寬度(公尺) */
export const OPENING_DEFAULT_WIDTH = Object.freeze({
  entrance: 1.0,
  door: 0.85,
  window: 1.6,
  floorWindow: 2.0,
  balconyDoor: 1.8,
});

export const WALL_LABEL = Object.freeze({ bottom: '下方的牆', top: '上方的牆', left: '左側的牆', right: '右側的牆' });

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * 房間的顯示名稱。使用者有取名就用它;沒有就用類型名,同類型有多間時加編號(臥室、臥室 2)。
 */
export function roomDisplayName(plan, room) {
  if (!room) return '';
  if (isText(room.name)) return room.name.trim();
  const base = ROOM_TYPE_LABEL[room.type] || '房間';
  const rooms = (plan && Array.isArray(plan.rooms)) ? plan.rooms : [];
  const same = rooms.filter((r) => r && r.type === room.type && !isText(r.name));
  if (same.length <= 1) return base;
  const idx = same.findIndex((r) => r.id === room.id);
  return idx < 0 ? base : `${base} ${idx + 1}`;
}

/** id → 顯示名稱 */
export function roomNameMap(plan) {
  const m = new Map();
  for (const r of (plan && plan.rooms) || []) if (r) m.set(r.id, roomDisplayName(plan, r));
  return m;
}

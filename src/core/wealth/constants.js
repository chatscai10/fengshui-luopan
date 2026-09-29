// wealth 的常數與資料表(規格 2.6.5、2.6.7、3.4 D43-D55)。
// 星值與乘數全是設計值(tag=設計,信心: 低),來源只支持「順序」;數字可調。
// 八宅星值不在這裡手打第二份: 取自 bazhai.STAR_ATTRS 的 weight(同一份設計值),測試驗它等於規格 2.6.7 的 BAZ_VAL。
import { STAR_NAMES, STAR_ATTRS } from '../bazhai.js';

export function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

export const WEALTH_SCHEMA = 'fengshui.wealth/1';

/**
 * 排序檔位(規格 2.6.7)。權重 G 幾何、XK 玄空、H 宅卦、P 命卦、Y 流年;xkShan = 玄空分量中山盤的占比;
 * opening = 角區有窗時的處理(penalty 明財位派 x0.5,reward 玄空派 x1.05,D46)。
 */
export const PROFILES = deepFreeze({
  mingcai: { G: 0.3, XK: 0.25, H: 0.15, P: 0.15, Y: 0.15, xkShan: 0.25, opening: 'penalty' },
  xuankong: { G: 0.1, XK: 0.4, H: 0.1, P: 0.15, Y: 0.15, xkShan: 0.25, opening: 'reward' },
});

/** 八宅星值(財運面順序 生氣>延年>天醫>伏位;延年>天醫無來源,WP-1)。 */
export const BAZ_VAL = deepFreeze(Object.fromEntries(STAR_NAMES.map((n) => [n, STAR_ATTRS[n].weight])));

/**
 * 玄空星值,以「目前為九運」為前提(鍵是星數,對任何 chartYun 的盤皆可用,旺衰看今日的運)。
 * XK9_VAL[2] = -0.2 與 108s 稱九運二黑為「遠生氣」衝突: 運序屬生氣、星性為病符,兩種屬性混用(規格 2.6.7)。
 */
export const XK9_VAL = deepFreeze({ 9: 1.0, 1: 0.8, 8: 0.7, 6: 0.3, 4: 0, 7: -0.2, 3: -0.3, 2: -0.2, 5: -0.7 });

/**
 * 流年星值。九紫 0.8 高於一白與六白 0.6 缺乏來源: 九紫 = 當運旺星加分,非傳統財星(WP-3);四綠 0.2 只有 DesignHouse 列為財星。
 * 可由 settings.yearVal 覆寫。
 */
export const YEAR_VAL = deepFreeze({ 8: 1.0, 9: 0.8, 1: 0.6, 6: 0.6, 4: 0.2, 7: -0.4, 3: -0.4, 2: -0.7, 5: -1.0 });

/** 幾何分 G。 */
export const G_VAL = deepFreeze({ mingPrimary: 1.0, mingSecondCenter: 0.9, twoSolidWalls: 0.5, oneSolidWall: 0.2, other: 0 });

/** 排除級旗標: 乘 0(規格 2.6.5)。 */
export const EXCLUSION_FLAGS = Object.freeze(['toilet', 'stove', 'stairs', 'walkway', 'door_swing']);

/**
 * 環境旗標目錄。sources = 規格 2.6.5 表列的來源數;乘數大小全是設計值,下限 ENV_FLOOR。
 * 排除級 exclude=true;強烈建議級是乘數。opening 的乘數依檔位(penalty / reward)。
 */
export const ENV_FLAGS = deepFreeze({
  toilet: { exclude: true, sources: 3, label: '財位本身是廁所', reason: '傳統上認為財位不宜是廁所(污穢之處)' },
  stove: { exclude: true, sources: 2, label: '財位本身是爐灶或廚房', reason: '傳統上認為財位不宜是爐灶、廚房' },
  stairs: { exclude: true, sources: 1, label: '財位本身是樓梯', reason: '傳統上有「財來財去」的說法(單一來源;動線上也不易安定)' },
  walkway: { exclude: true, sources: 5, label: '動線穿過財位', reason: '傳統上認為財位不宜是走道' },
  door_swing: { exclude: true, sources: 5, label: '角區有門或門扇掃過', reason: '傳統上認為財位不宜是開門處' },
  opening: { exclude: false, sources: 5, mult: { penalty: 0.5, reward: 1.05 }, label: '角區有窗或落地窗(財位見空)', reason: '明財位派稱「財位見空」;玄空派主張旺位需開窗納氣' },
  no_solid_wall: { exclude: false, sources: 7, mult: 0.7, label: '背後沒有兩面實牆', reason: '傳統上認為財位背後需要靠山(兩面實牆),玻璃隔間也不算' },
  beam: { exclude: false, sources: 7, mult: 0.9, label: '橫樑或大櫃壓頂', reason: '傳統上認為財位頭頂不宜被樑或大櫃壓住' },
  dark: { exclude: false, sources: 5, mult: 0.95, label: '光線昏暗', reason: '傳統上認為財位宜明亮,可加燈補救' },
  sharp: { exclude: false, sources: 6, mult: 0.95, label: '尖角沖射', reason: '傳統上認為財位不宜被尖角直指' },
  toilet_adjacent: { exclude: false, sources: 3, mult: 0.8, label: '與廁所共牆或正對廁所門', reason: '傳統上認為財位不宜靠近廁所' },
  stove_facing: { exclude: false, sources: 2, mult: 0.9, label: '正對爐火', reason: '傳統上認為財位不宜正對爐火' },
});
export const ENV_FLAG_NAMES = Object.freeze(Object.keys(ENV_FLAGS));

/** 環境乘數下限(設計值,規格 2.6.5)。 */
export const ENV_FLOOR = 0.4;

/** 角區大小(公尺)與開口重疊門檻(公尺),設計值(規格 2.6.3)。 */
export const ZONE_M = 1.0;
export const MIN_OVERLAP_M = 0.05;
/** 「門居中」容差帶(牆長比例)與多邊形並列門檻(第二遠 / 最遠),設計值(規格 2.6.3)。 */
export const CENTER_BAND = 0.1;
export const TIE_RATIO = 0.94;
/** 門沖門檻(D49): 重疊 >= 較窄者寬度的 80% 且無遮擋 = 門沖;50%-80% = 輕微偏移。 */
export const CHONG_RATIO = 0.8;
export const SLIGHT_RATIO = 0.5;
/** 櫃檯左側「靠牆」的容許縫隙(公尺),設計值。潮紫微只說「左邊要靠牆為佳」,沒有數字。 */
export const LEFT_WALL_TOL_M = 0.1;

/** 主空間房型: 明財位與兩面實牆角落只在這些房型找(玄關、陽台、廁所、廚房、樓梯不算)。 */
export const MAIN_ROOM_TYPES = Object.freeze(['living', 'bedroom', 'study', 'other']);

/** 五行(星的五行,催旺外推用)。 */
export const STAR_WUXING = Object.freeze({ 1: '水', 2: '土', 3: '木', 4: '木', 5: '土', 6: '金', 7: '金', 8: '土', 9: '火' });
export const STAR_NAME = Object.freeze({ 1: '一白', 2: '二黑', 3: '三碧', 4: '四綠', 5: '五黃', 6: '六白', 7: '七赤', 8: '八白', 9: '九紫' });

/** 軟建議(不進位置分數,屬民俗性質,文案標「傳統說法」,規格 2.6.5)。 */
export const SOFT_ADVICE = deepFreeze([
  { id: 'tidy', text: '保持整潔,不堆雜物' },
  { id: 'noTrash', text: '不放垃圾桶' },
  { id: 'noMirror', text: '不放鏡子' },
  { id: 'noElectronics', text: '不放電視、空調等會震動或有噪音的電器,不放鬧鐘或電話' },
  { id: 'noDeadPlants', text: '不放假花、乾燥花、枯木、帶刺植物' },
  { id: 'godBack', text: '財神像背後要靠實牆' },
]);

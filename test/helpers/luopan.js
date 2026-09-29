// luopan 測試專用: 第二來源的獨立實作與規格內嵌表。刻意不 import src/core/luopan.js,
// 這樣「規則重算 == 實作內嵌表」與「掃描 == 公式」才有比對意義(spec 4.2 第 6 點)。
// 表內數字皆抄自 docs/DOMAIN_SPEC.md 2.8(不是抄自實作或 fixtures)。

const NAMES24 = '子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬';

/** WCAG 2.x 相對亮度與對比度(獨立寫一份,與實作互相對照)。 */
export function wcagContrast(fgHex, bgHex) {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fgHex), lum(bgHex)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ───────────── 28 宿(規格 2.8.3): 以「古度 × 4」的整數做累加,再用有理數換成度數 ─────────────
export const SPEC_XIU_NAMES = '角亢氐房心尾箕斗牛女虛危室壁奎婁胃昴畢觜參井鬼柳星張翼軫';
export const SPEC_XIU_WIDTHS_GU = [12.75, 9.75, 16.25, 5.75, 6, 18, 9.5, 22.75, 7, 11, 9.25, 16, 18.25, 9.75,
  18, 12.75, 15.25, 11, 16.5, 0.5, 9.5, 30.25, 2.5, 13.5, 6.75, 17.75, 20.25, 18.75];

/** 由整數累加算出 28 宿的方位角起迄(虛起於 0 度,宿序倒著走)。 */
export function independentXiuLayout() {
  const quarters = SPEC_XIU_WIDTHS_GU.map((w) => Math.round(w * 4));
  const total = quarters.reduce((a, b) => a + b, 0); // 1461 = 365.25 * 4
  const first = SPEC_XIU_NAMES.indexOf('虛');
  let acc = 0;
  const out = [];
  for (let k = 0; k < 28; k += 1) {
    const idx = (first - k + 28) % 28;
    const start = (360 * acc) / total;
    acc += quarters[idx];
    out.push({ name: SPEC_XIU_NAMES[idx], start, end: (360 * acc) / total, widthGu: SPEC_XIU_WIDTHS_GU[idx] });
  }
  return { total, cells: out };
}

// ───────────── 120 分金(規格 2.8.4): 用字串運算重排 ─────────────
export function independentFenjinRing() {
  const stems = [...'甲乙丙丁戊己庚辛壬癸'];
  const branches = [...'子丑寅卯辰巳午未申酉戌亥'];
  const ring = [];
  for (let i = 0; i < 24; i += 1) {
    const m = NAMES24[i];
    // 八干四維山沿用前一位地支(單一來源規則,163.com HJT97HRR)
    let j = i;
    while (!branches.includes(NAMES24[j])) j = (j + 23) % 24;
    const branch = NAMES24[j];
    const yang = branches.indexOf(branch) % 2 === 0;
    const five = stems.filter((_, s) => (s % 2 === 0) === yang).map((s) => s + branch);
    five.forEach((name, slot) => {
      const start = (352.5 + 15 * i + 3 * slot) % 360;
      ring.push({ name, mountain: m, start, end: (start + 3) % 360 });
    });
  }
  return ring;
}

// ───────────── 三合紅黑字(規格 2.8.2): 由納甲重推 ─────────────
/** 乾納甲、坤納乙、坎納癸申辰、離納壬寅戌 → 12 個陽(紅字)。 */
export function sanheYangFromNajia() {
  const byPalace = { 乾: ['乾', '甲'], 坤: ['坤', '乙'], 坎: ['子', '癸', '申', '辰'], 離: ['午', '壬', '寅', '戌'] };
  return new Set(Object.values(byPalace).flat());
}

// ───────────── 64 卦(規格 2.8.5): 文王序(名稱, 上卦, 下卦),獨立於圓圖序 ─────────────
export const KING_WEN = [
  ['乾', '乾', '乾'], ['坤', '坤', '坤'], ['屯', '坎', '震'], ['蒙', '艮', '坎'], ['需', '坎', '乾'], ['訟', '乾', '坎'],
  ['師', '坤', '坎'], ['比', '坎', '坤'], ['小畜', '巽', '乾'], ['履', '乾', '兌'], ['泰', '坤', '乾'], ['否', '乾', '坤'],
  ['同人', '乾', '離'], ['大有', '離', '乾'], ['謙', '坤', '艮'], ['豫', '震', '坤'], ['隨', '兌', '震'], ['蠱', '艮', '巽'],
  ['臨', '坤', '兌'], ['觀', '巽', '坤'], ['噬嗑', '離', '震'], ['賁', '艮', '離'], ['剝', '艮', '坤'], ['復', '坤', '震'],
  ['無妄', '乾', '震'], ['大畜', '艮', '乾'], ['頤', '艮', '震'], ['大過', '兌', '巽'], ['坎', '坎', '坎'], ['離', '離', '離'],
  ['咸', '兌', '艮'], ['恆', '震', '巽'], ['遯', '乾', '艮'], ['大壯', '震', '乾'], ['晉', '離', '坤'], ['明夷', '坤', '離'],
  ['家人', '巽', '離'], ['睽', '離', '兌'], ['蹇', '坎', '艮'], ['解', '震', '坎'], ['損', '艮', '兌'], ['益', '巽', '震'],
  ['夬', '兌', '乾'], ['姤', '乾', '巽'], ['萃', '兌', '坤'], ['升', '坤', '巽'], ['困', '兌', '坎'], ['井', '坎', '巽'],
  ['革', '兌', '離'], ['鼎', '離', '巽'], ['震', '震', '震'], ['艮', '艮', '艮'], ['漸', '巽', '艮'], ['歸妹', '震', '兌'],
  ['豐', '震', '離'], ['旅', '離', '艮'], ['巽', '巽', '巽'], ['兌', '兌', '兌'], ['渙', '巽', '坎'], ['節', '坎', '兌'],
  ['中孚', '巽', '兌'], ['小過', '震', '艮'], ['既濟', '坎', '離'], ['未濟', '離', '坎'],
];
/** 先天圓圖的卦宮序(下卦與上卦皆用)。 */
export const XIANTIAN_ORDER = [...'乾兌離震巽坎艮坤'];

/** 依「下卦宮序 × 上卦同序」,用文王序表查出 64 卦圓圖序的名稱。 */
export function independentHexagramCircle() {
  const find = (upper, lower) => KING_WEN.find(([, u, l]) => u === upper && l === lower)[0];
  const out = [];
  for (const lower of XIANTIAN_ORDER) for (const upper of XIANTIAN_ORDER) out.push(find(upper, lower));
  return out;
}

// ───────────── 版面(規格 2.8.6 內嵌表,抄自規格) ─────────────
export const SPEC_LAYOUT_A = [
  { key: 'tianchi', r0: 0.0, r1: 0.188, widthPx: 33.8, midPx: 16.9 },
  { key: 'r1', r0: 0.188, r1: 0.376, widthPx: 33.8, midPx: 50.8 },
  { key: 'r2', r0: 0.376, r1: 0.4511, widthPx: 13.5, midPx: 74.4 },
  { key: 'r3', r0: 0.4511, r1: 0.6203, widthPx: 30.5, midPx: 96.4 },
  { key: 'r4', r0: 0.6203, r1: 0.6485, widthPx: 5.1, midPx: 114.2 },
  { key: 'r5', r0: 0.6485, r1: 0.7735, widthPx: 22.5, midPx: 128.0 },
  { key: 'r6', r0: 0.7735, r1: 0.9051, widthPx: 23.7, midPx: 151.1 },
  { key: 'r7', r0: 0.9051, r1: 0.985, widthPx: 14.4, midPx: 170.1 },
];
/** 模式 B 各環寬度比例(規格 2.8.6),外緣 0.986。 */
export const SPEC_LAYOUT_B_WIDTHS = [
  ['tianchi', 0.1869], ['r1', 0.1869], ['r2', 0.0748], ['r3', 0.1682], ['r4', 0.0281],
  ['r5a', 0.0654], ['r5b', 0.0654], ['r6', 0.1308], ['r7', 0.0795],
];

/** 規格 2.8.7 色票(抄自規格)。 */
export const SPEC_PALETTE = {
  lacquer_900: '#0E0B09', lacquer_800: '#17120E', lacquer_700: '#221A13', lacquer_600: '#2D231A',
  gold_100: '#F6E6B4', gold_300: '#E8CB7A', gold_500: '#D6B25A', gold_700: '#9A7526', gold_900: '#5E4514',
  cinnabar_500: '#D0342A', cinnabar_300: '#F0665A', cinnabar_800: '#7A130C',
  ivory: '#F3EBD8', jade: '#5FA37F', terracotta: '#C9705A',
  wx_wood: '#5DAA6B', wx_fire: '#EC6A57', wx_earth: '#D0A44A', wx_metal: '#E4E0D2', wx_water: '#6A9CDC',
};

/** 規格 2.8.9 的 CSS 字型堆疊。 */
export const SPEC_KAI_STACK = '"LuopanKai","Kaiti TC","BiauKaiTC","BiauKai","DFKai-SB","KaiTi","STKaiti","Noto Serif CJK TC","Noto Serif TC","Songti TC","PMingLiU","PingFang TC",serif';

// ───────────── 傳統環序的名稱分類(fixtures 的 traditional_ring_order_*) ─────────────
/** 把傳統盤的環名分成 luopan 的語意 id;不相干的環回 'other'。 */
export function classifyTraditionalRing(name) {
  if (name.startsWith('天池')) return 'tianchi';
  if (/人盤中針二十四山|中針人盤二十四山/.test(name)) return 'ren_plate';
  if (/天盤縫針二十四山|縫針天盤二十四山/.test(name)) return 'tian_plate';
  if (/地盤正針(二十四|24)山|正針地盤二十四山|三合廿四山陰陽/.test(name)) return 'mountains24';
  if (/二十四節氣|太陽到山/.test(name)) return 'solar_terms';
  if (/二十八宿|周天宿度|廿捌宿/.test(name)) return 'xiu28';
  if (/三百六十度|叁百陸拾度|三百六十經緯度/.test(name)) return 'scale360';
  return 'other';
}

/** 測試用的深拷貝。 */
export const clone = (v) => JSON.parse(JSON.stringify(v));

/** 把 expected 中第一個葉節點改錯(突變測試用)。 */
export function mutateLeaf(c) {
  const leaf = (o, key) => {
    const v = o[key];
    if (Array.isArray(v) || (v && typeof v === 'object')) return leaf(v, Array.isArray(v) ? 0 : Object.keys(v)[0]);
    o[key] = typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : `${v}X`;
    return true;
  };
  const bad = clone(c);
  if (bad.expected !== null && typeof bad.expected === 'object') leaf(bad, 'expected');
  else bad.expected = `${bad.expected}X`;
  return bad;
}

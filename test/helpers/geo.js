// geo 測試專用: 第二來源的獨立實作與資料解析。刻意不 import src/core/geo.js,
// 這樣「規則重算 == 實作內嵌表」與「掃描 == 公式」才有比對意義(spec 4.2 第 6 點)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RESEARCH_DIR = path.join(here, '..', '..', 'docs', 'research');

export const NAME_ORDER = '子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬';
const GUA_ORDER = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];
const SIWEI = new Set([...'乾坤艮巽']);
const STEMS = new Set([...'甲乙丙丁庚辛壬癸']);
const BRANCH_WUXING = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
const STEM_WUXING = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const SIWEI_WUXING = { 乾: '金', 坤: '土', 艮: '土', 巽: '木' };

/** 由規則重算 24 山表(卦、元龍、陰陽、本五行、類別),與 geo.js 內嵌表比對。 */
export function deriveMountainTable() {
  return [...NAME_ORDER].map((name, index) => {
    const gua = GUA_ORDER[Math.floor(((index + 1) % 24) / 3)];
    const dragon = ['地元', '天元', '人元'][(index + 1) % 3]; // 宮內順時針: 地、天、人
    // 天元與人元同陰陽(乾坤艮巽為陽,坎離震兌為陰),地元與天元相反(orientation.verify.md V4)
    const tianYang = SIWEI.has(gua);
    const yinyang = dragon === '地元' ? (tianYang ? '陰' : '陽') : tianYang ? '陽' : '陰';
    const kind = SIWEI.has(name) ? '四維卦' : STEMS.has(name) ? '天干' : '地支';
    const wuxing = SIWEI_WUXING[name] ?? STEM_WUXING[name] ?? BRANCH_WUXING[name];
    return { name, index, centerDeg: 15 * index, gua, dragon, yinyang, wuxing, kind };
  });
}

/** 依規則得到的相鄰山相兼類型(供 oracle 用)。 */
export function oraclePairType(table, i, j) {
  const a = table[i];
  const b = table[j];
  if (a.gua !== b.gua) return 'chugua';
  if (a.dragon === '地元' || b.dragon === '地元') return 'yinyang';
  return a.yinyang === '陽' ? 'tongxing_yang' : 'tongxing_yin';
}

export const ORACLE_LIMITS = {
  default: { tongxing_yin: [60, 60], tongxing_yang: [70, 70], yinyang: [50, 60], chugua: [50, 60] },
  strict5: { tongxing_yin: [60, 60], tongxing_yang: [70, 70], yinyang: [50, 50], chugua: [50, 50] },
  zggdfs6: { tongxing_yin: [60, 60], tongxing_yang: [70, 70], yinyang: [60, 60], chugua: [60, 60] },
};

const TABLE = deriveMountainTable();

/**
 * 以 0.1 度為單位的整數算術版 analyzeBearing(掃描山區間,不用 floor 公式)。
 * 輸入輸出的度數都乘 10;可精確比對,沒有浮點雜訊。
 * @param {number} t10 方位角 * 10 的整數
 */
export function oracleAnalyze(t10, { threshold10 = 45, uncertainty10 = 30, school = 'default' } = {}) {
  const limits = ORACLE_LIMITS[school];
  const b = ((t10 % 3600) + 3600) % 3600;
  let i = -1;
  for (let k = 0; k < 24; k += 1) {
    const start = (((150 * k - 75) % 3600) + 3600) % 3600;
    if (((b - start + 3600) % 3600) < 150) {
      i = k;
      break;
    }
  }
  let dev = (((b - 150 * i) % 3600) + 3600) % 3600;
  if (dev >= 1800) dev -= 3600;
  const adev = Math.abs(dev);
  const zone = adev <= threshold10 ? 'zheng' : 'jian';
  const j = dev > 0 ? (i + 1) % 24 : (i + 23) % 24;
  const type = oraclePairType(TABLE, i, j);
  const [okMax, voidAbove] = limits[type];
  const level = zone === 'zheng' ? 'zheng' : adev <= okMax ? 'jian' : adev <= voidAbove ? 'jian_caution' : 'void';
  const dist = 75 - adev;
  const boundaryKind = TABLE[i].gua !== TABLE[j].gua ? 'gua' : 'shan';
  const onLine = dist < 5;
  let kongwangKind = null;
  let kongwangKindDegree = null;
  if (level === 'void' || onLine) {
    if (boundaryKind === 'gua') kongwangKind = kongwangKindDegree = 'da';
    else if (type === 'yinyang') kongwangKind = kongwangKindDegree = 'xiao';
    else {
      kongwangKind = 'xiao';
      kongwangKindDegree = 'kongxiang';
    }
  }
  return {
    mountain: TABLE[i].name,
    dev10: dev,
    zone,
    level,
    leanTo: zone === 'jian' ? TABLE[j].name : null,
    pairType: zone === 'jian' ? type : null,
    dist10: dist,
    boundaryKind,
    kongwangKind,
    kongwangKindDegree,
    onLine,
    retest: dist < uncertainty10,
    outer1p5: adev >= 60,
    needsTiGua: zone === 'jian' && (type === 'yinyang' || type === 'chugua'),
  };
}

/** 解析 orientation.md 3.5 的城市磁偏角表(第二來源,用來抓 geo.js 內嵌表的手打錯字)。 */
export function parseCityTable() {
  const lines = readFileSync(path.join(RESEARCH_DIR, 'orientation.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('### 3.5'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('### 3.6'));
  const num = '([+-]?[\\d.]+)';
  const re = new RegExp(`^\\|\\s*([^|\\s][^|]*?)\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|\\s*${num}\\s*\\|`);
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const m = re.exec(lines[i]);
    if (m) {
      rows.push({
        name: m[1],
        lat: Number(m[2]),
        lon: Number(m[3]),
        d2025: Number(m[4]),
        d2026: Number(m[5]),
        d20260929: Number(m[6]),
        rate: Number(m[7]),
      });
    }
  }
  return rows;
}

// bazhai 測試專用: 第二來源的獨立實作與規格文字解析。刻意不 import src/core/bazhai.js,
// 這樣「規則重算 == 實作內嵌表」與「掃描 == 公式」才有比對意義(spec 4.2 第 6 點)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveMountainTable } from './geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = path.join(here, '..', '..', 'docs', 'DOMAIN_SPEC.md');
let specCache = null;
export const readSpec = () => (specCache ??= readFileSync(SPEC_PATH, 'utf8'));

/** 取出規格內某標記行之後的第一個 ```json 區塊並解析。 */
export function specJsonAfter(marker) {
  const lines = readSpec().split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(marker));
  if (at < 0) throw new Error(`規格中找不到標記: ${marker}`);
  let s = -1;
  for (let i = at; i < lines.length; i += 1) {
    if (lines[i].startsWith('```json')) {
      s = i;
      break;
    }
  }
  if (s < 0) throw new Error(`標記之後沒有 json 區塊: ${marker}`);
  let e = s + 1;
  while (e < lines.length && !lines[e].startsWith('```')) e += 1;
  return JSON.parse(lines.slice(s + 1, e).join('\n'));
}

/** 解析規格 2.3.2 的八星屬性表: 星 -> {nineStar, element, level, weight}。 */
export function parseSpecStarAttrs() {
  const re = /^\|\s*(生氣|延年|天醫|伏位|禍害|六煞|五鬼|絕命)\s*\|\s*([^|\s]+)\s*\|\s*([^|\s]+)\s*\|\s*([^|\s]+)\s*\|\s*(-?\d+(?:\.\d+)?)\s*\|\s*$/;
  const out = {};
  for (const line of readSpec().split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) out[m[1]] = { nineStar: m[2], element: m[3], level: m[4], weight: Number(m[5]) };
  }
  return out;
}

// ─────────────── 星表: 兩種與實作不同的推導法 ───────────────

/** 相對爻差法: home 與 target 的卦爻(下,中,上)哪幾爻不同 -> 星(bazhai.md 1.3)。 */
export const STAR_OF_DIFF = {
  '': '伏位',
  '2': '生氣',
  '12': '五鬼',
  '012': '延年',
  '02': '六煞',
  '0': '禍害',
  '01': '天醫',
  '1': '絕命',
};

export function starByLineDiff(linesHome, linesTarget) {
  const diff = [0, 1, 2].filter((i) => linesHome[i] !== linesTarget[i]).join('');
  return STAR_OF_DIFF[diff];
}

/** 由相對爻差法產生 home -> dir -> star。lines 與 dirs 由呼叫端傳入(取自 fixture meta,不用 src)。 */
export function tableByLineDiff(lines, dirs) {
  const out = {};
  for (const home of Object.keys(lines)) {
    out[home] = {};
    for (const target of Object.keys(lines)) out[home][dirs[target]] = starByLineDiff(lines[home], lines[target]);
  }
  return out;
}

const SONG_STARS = { 六: '六煞', 天: '天醫', 五: '五鬼', 禍: '禍害', 絕: '絕命', 延: '延年', 生: '生氣' };
const HOUSE_ORDER = ['坎', '艮', '震', '巽', '離', '坤', '兌', '乾'];

/** 大遊年歌: 自本卦下一卦起依後天順序(略過本卦)逐字配星,本卦自身為伏位。 */
export function tableBySong(songs, dirs) {
  const out = {};
  for (const home of Object.keys(songs)) {
    const h = HOUSE_ORDER.indexOf(home);
    const row = { [dirs[home]]: '伏位' };
    const chars = [...songs[home]];
    for (let k = 0; k < 7; k += 1) row[dirs[HOUSE_ORDER[(h + 1 + k) % 8]]] = SONG_STARS[chars[k]];
    out[home] = row;
  }
  return out;
}

// ─────────────── 命卦: 排山掌訣與末兩位公式 ───────────────

export const mod9 = (x) => ((((x - 1) % 9) + 9) % 9) + 1;
const GUA_OF_NUM = { 1: '坎', 2: '坤', 3: '震', 4: '巽', 6: '乾', 7: '兌', 8: '艮', 9: '離' };

/**
 * 《八宅明鏡》排山掌訣: 三元甲子(1864、1924、1984)男起 1/4/7 逆行,女起 5/2/8 順行,逐年推。
 * @returns {{raw:number, num:number, gua:string}}
 */
export function palmMingGua(year, gender) {
  const idx = (((year - 1864) % 180) + 180) % 180;
  const block = Math.floor(idx / 60);
  const off = idx % 60;
  const raw = gender === 'M' ? mod9([1, 4, 7][block] - off) : mod9([5, 2, 8][block] + off);
  const num = raw === 5 ? (gender === 'M' ? 2 : 8) : raw;
  return { raw, num, gua: GUA_OF_NUM[num] };
}

/** 1900-1999 與 2000-2099 的末兩位公式(bazhai.md 1.2),只在該範圍有效。 */
export function digitMingGua(year, gender) {
  const yy = year % 100;
  let raw;
  if (year >= 1900 && year <= 1999) raw = gender === 'M' ? mod9(100 - yy) : mod9(yy - 4);
  else if (year >= 2000 && year <= 2099) raw = gender === 'M' ? mod9(99 - yy) : mod9(yy + 6);
  else throw new Error(`末兩位公式不涵蓋 ${year}`);
  const num = raw === 5 ? (gender === 'M' ? 2 : 8) : raw;
  return { raw, num, gua: GUA_OF_NUM[num] };
}

// ─────────────── 宅卦: 0.1 度整數掃描 ───────────────

const TABLE = deriveMountainTable();

/**
 * 以 0.1 度為單位的整數版宅卦: 坐 = 向 + 180,逐山掃描區間找山,取該山的卦(不用 45 度公式)。
 * @param {number} facing10 向的方位角 * 10 的整數
 * @returns {{sitMountain:string, gua:string, facingMountain:string}}
 */
export function oracleZhai(facing10) {
  const find = (t10) => {
    const b = ((t10 % 3600) + 3600) % 3600;
    for (let k = 0; k < 24; k += 1) {
      const start = (((150 * k - 75) % 3600) + 3600) % 3600;
      if (((b - start + 3600) % 3600) < 150) return TABLE[k];
    }
    throw new Error(`找不到山: ${t10}`);
  };
  const sit = find(facing10 + 1800);
  return { sitMountain: sit.name, gua: sit.gua, facingMountain: find(facing10).name };
}

export const GUA_GROUP = { 坎: 'east', 震: 'east', 巽: 'east', 離: 'east', 乾: 'west', 坤: 'west', 艮: 'west', 兌: 'west' };

/**
 * 解析規格 2.3.4 的八星用途矩陣: 星 -> 用途鍵 -> 儲存格原文。
 * 欄位順序固定為 大門 主臥 床頭 書桌 灶座 灶口 廁所 客廳。
 */
export function parseSpecUsageTable() {
  const uses = ['door', 'masterBedroom', 'bedHead', 'desk', 'stoveSeat', 'stoveMouth', 'toilet', 'living'];
  const re = /^\|\s*(生氣|延年|天醫|伏位|禍害|六煞|五鬼|絕命)\s*\|(.+)\|\s*$/;
  const out = {};
  for (const line of readSpec().split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (cells.length !== uses.length) continue; // 八星屬性表只有 4 欄,略過
    out[m[1]] = Object.fromEntries(uses.map((u, i) => [u, cells[i]]));
  }
  return out;
}

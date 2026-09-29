// 特殊格局(規格 2.4.6): 合十、父母三般卦、連數三般卦、七星打劫、宮位伏吟反吟、城門。
// 全部只讀 Chart(buildChart 的輸出),不改動它;宮位一律用宮位名,洛書數需要時查 LUOSHU。
import { LUOSHU } from '../geo.js';
import { PALACES, CHENGMEN, palaceOfStar } from './tables.js';
import { classifyChart, mod9, assertYun, assertPalace } from './chart.js';

/** 八個非中宮。 */
const OUTER_PALACES = Object.freeze(PALACES.filter((p) => p !== '中'));

/**
 * 全局合十: 九宮每宮 運+山 = 10(運山合十)或 運+向 = 10(運向合十)。共 24 局(SINA-HESHI 名單,程式重算吻合)。
 * @param {import('./chart.js').Chart} chart
 * @returns {'運山'|'運向'|null}
 */
export function heshi(chart) {
  const P = chart.palaces;
  const all = (k) => PALACES.every((p) => P[p].yun + P[p][k] === 10);
  if (all('shan')) return '運山';
  if (all('xiang')) return '運向';
  return null;
}

/**
 * 局部合十: 某宮山、向、運三數任兩數和為 10。下卦盤上與「全局合十」的 24 局集合等價(複查 R13)。
 * @param {import('./chart.js').Chart} chart
 * @returns {string[]} 宮位名
 */
export function heshiPalaces(chart) {
  return PALACES.filter((p) => {
    const { shan, xiang, yun } = chart.palaces[p];
    return shan + xiang === 10 || shan + yun === 10 || xiang + yun === 10;
  });
}

/**
 * 父母三般卦(三般巧卦): 每宮山、向、運三數對 3 同餘。16 局,全是上山下水。標吉。
 * @param {import('./chart.js').Chart} chart
 * @returns {boolean}
 */
export function parent3(chart) {
  return PALACES.every((p) => {
    const { shan, xiang, yun } = chart.palaces[p];
    const g = yun % 3;
    return shan % 3 === g && xiang % 3 === g;
  });
}

/**
 * 連數三般卦: 每宮三數為三個相鄰數(循環)。16 局。三派互相矛盾(SINA-3BAN、36FS zs36 吉 / SOHU 凶),
 * 只標記不計分(D31,showLianshu)。
 * @param {import('./chart.js').Chart} chart
 * @returns {boolean}
 */
export function lianshu3(chart) {
  return PALACES.every((p) => {
    const { shan, xiang, yun } = chart.palaces[p];
    const s = new Set([yun, shan, xiang]);
    if (s.size !== 3) return false;
    for (let a = 1; a <= 9; a += 1) if (s.has(a) && s.has(mod9(a + 1)) && s.has(mod9(a + 2))) return true;
    return false;
  });
}

// 七星打劫的兩組三宮(洛書數): 離震乾=離宮打劫(真)、坎巽兌=坎宮打劫(假)。
const QIXING_CLUSTERS = Object.freeze([
  Object.freeze({ kind: '離宮打劫', cluster: Object.freeze([9, 3, 6]) }),
  Object.freeze({ kind: '坎宮打劫', cluster: Object.freeze([1, 4, 7]) }),
]);

/**
 * 七星打劫: 前提雙星會向;向宮屬某組三宮,且該組三宮的山星與向星全部屬當運星 N 的三般組(對 3 同餘)。
 * 離宮 24 + 坎宮 24 + 三般巧卦 16 = 64 局(SINA-3BAN 陳炳聿,單一完整清單)。
 * 打劫不可用: 犯全局伏吟(5 順)6 局;另 6 局犯全局反吟不在來源清單內,只警示。
 * @param {import('./chart.js').Chart} chart
 * @returns {null|{kind:'離宮打劫'|'坎宮打劫', group:string, cluster:string[], usable:boolean, wholePlateFanyin:boolean}}
 */
export function qixing(chart) {
  if (classifyChart(chart) !== '雙星會向') return null;
  const found = QIXING_CLUSTERS.find((c) => c.cluster.includes(LUOSHU[chart.facePalace]));
  if (!found) return null;
  const g = chart.meta.chartYun % 3;
  const inGroup = found.cluster.every((n) => {
    const c = chart.palaces[palaceOfStar(n)];
    return c.shan % 3 === g && c.xiang % 3 === g;
  });
  if (!inGroup) return null;
  const group = [g, g + 3, g + 6].map((x) => (x === 0 ? 9 : x)).sort((a, b) => a - b).join('');
  const wp = chart.wholePlate;
  return {
    kind: found.kind,
    group,
    cluster: found.cluster.map(palaceOfStar),
    usable: wp.shan !== '伏吟' && wp.xiang !== '伏吟',
    wholePlateFanyin: wp.shan === '反吟' || wp.xiang === '反吟',
  };
}

/**
 * @typedef {Object} LocalYinEntry
 * @property {string} palace 宮位名
 * @property {'山'|'向'} plate
 * @property {string} basis 伏吟: '洛書本位'(星等於宮的洛書數)、'運星'(星等於該宮運星);反吟: '洛書本位合十'
 * @property {number} star
 */

/**
 * 宮位伏吟/反吟(中宮不計): 山星或向星等於該宮洛書數、或等於該宮運星 = 伏吟;星加洛書數 = 10 = 反吟。
 * 旺星不扣、衰死扣(規格 2.4.6): 給 penalizedWhen 判斷時,entry 多帶 penalized。
 * @param {import('./chart.js').Chart} chart
 * @param {{penalizedWhen?: (star:number)=>boolean}} [opts] penalizedWhen 回傳 true 表示該星屬衰死、該扣分
 * @returns {{fuyin: LocalYinEntry[], fanyin: LocalYinEntry[]}}
 */
export function localYin(chart, opts = {}) {
  opts = opts ?? {};
  const out = { fuyin: [], fanyin: [] };
  for (const palace of OUTER_PALACES) {
    const home = LUOSHU[palace];
    const c = chart.palaces[palace];
    for (const [plate, star] of [['山', c.shan], ['向', c.xiang]]) {
      const add = (list, basis) => {
        const e = { palace, plate, basis, star };
        if (opts.penalizedWhen) e.penalized = opts.penalizedWhen(star);
        list.push(e);
      };
      if (star === home) add(out.fuyin, '洛書本位');
      if (star === c.yun) add(out.fuyin, '運星');
      if (star + home === 10) add(out.fanyin, '洛書本位合十');
    }
  }
  return out;
}

/**
 * 城門位與實務可用性(D32,只顯示不進主評分)。正/副城門查 CHENGMEN;可用性 =「城門宮的向星屬 N、N+1、N+2」,
 * 是單一作者(刘燮钧)簡化規則,與 SINA-HESHI 八運子山午向「有城門可用」的說法不同義。
 * @param {import('./chart.js').Chart} chart
 * @param {number} yun 判讀旺衰用的運(currentYun,規格 2.4.4)
 * @returns {{facePalace:string, main:{palace:string, luoshu:number, usable:boolean}, sub:{palace:string, luoshu:number, usable:boolean}}}
 * @throws {Error} INVALID_YUN
 */
export function chengmen(chart, yun) {
  assertYun(yun);
  assertPalace(chart.facePalace);
  const [main, sub] = CHENGMEN[LUOSHU[chart.facePalace]];
  const usable = (n) => ((chart.palaces[palaceOfStar(n)].xiang - yun) % 9 + 9) % 9 <= 2;
  const item = (n) => ({ palace: palaceOfStar(n), luoshu: n, usable: usable(n) });
  return { facePalace: chart.facePalace, main: item(main), sub: item(sub) };
}

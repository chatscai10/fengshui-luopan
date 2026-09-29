// 設定面板(底部面板)。每個設定一行標題、一句白話說明;流派細項預設摺疊在「進階流派選項」。
// 選項清單寫在下面的表裡,預設值一律讀 DEFAULT_SETTINGS,不重複寫死。
import { h, clear } from '../dom.js';
import { DEFAULT_SETTINGS } from '../../core/settings.js';
import { DISCLAIMERS } from '../../core/copy.js';
import { segControl, switchRow, createNorthControls, nextDomId, repairDraft } from './house.js';
import { proHomeOf } from '../route.js';
import { EASY_TEXT } from '../easy/text.js';

/** 目前版本(與 package.json 同步) */
export const APP_VERSION = '0.1.0';
/** 「跟著預設」的哨兵值:選它就把這個設定從覆寫裡拿掉 */
export const AUTO = '__auto__';

const BOOL = Object.freeze([
  { value: false, label: '關' },
  { value: true, label: '開' },
]);

/** 設定分組(進階群組 advanced:true,收在摺疊區) */
export const SETTING_GROUPS = Object.freeze([
  { id: 'north', title: '北基準', advanced: false },
  { id: 'measure', title: '量測', advanced: false },
  { id: 'wealth', title: '財位', advanced: false },
  { id: 'adv-orientation', title: '方位與「向」', advanced: true },
  { id: 'adv-ming', title: '命卦與八宅', advanced: true },
  { id: 'adv-xuankong', title: '入運與玄空飛星', advanced: true },
  { id: 'adv-wealth', title: '財位細節', advanced: true },
  { id: 'adv-annual', title: '煞與少數派說法', advanced: true },
  { id: 'adv-luopan', title: '羅盤盤面', advanced: true },
]);

/**
 * 每個會顯示的設定:{ group, label, help(一句白話), options, explicit? }
 * explicit:這個設定「有明寫」和「沒寫」意義不同(引擎會依財位排序檔自動決定),所以多一個 AUTO 選項,
 * 選其他值時即使等於預設值也要寫進去。
 * 選項清單依 docs/API.md 第 6 節;不支援的選項(農曆春節換年)刻意不列,因為 App 沒有農曆資料,選了只會退回立春。
 */
export const SETTING_META = Object.freeze({
  northMode: {
    group: 'north',
    label: '羅盤讀數的北',
    help: '實體羅盤指的是磁北;地圖上的北是真北。台灣兩者差約 5 度,有時會因此換成隔壁的山。',
    options: [{ value: 'magnetic', label: '磁北(預設)' }, { value: 'true', label: '真北' }],
    custom: true, // 由 createNorthControls 畫,與住宅頁同步
  },
  measureUncertainty: {
    group: 'measure',
    label: '手機量測的誤差',
    help: '手機指北針有誤差;方位離山與山的交界比這個數字還近,就會提醒你重新量測。',
    options: [
      { value: 3, label: '3 度(戶外、好機種)' },
      { value: 5, label: '5 度(一般)' },
      { value: 8, label: '8 度(室內、鋼筋多)' },
    ],
  },
  lockSeconds: {
    group: 'measure',
    label: '鎖定讀數的秒數',
    help: '按下「鎖定讀數」後取平均的時間;越久越穩,但要拿穩手機。',
    options: [{ value: 3, label: '3 秒' }, { value: 5, label: '5 秒' }, { value: 10, label: '10 秒' }],
  },
  wealthProfile: {
    group: 'wealth',
    label: '財位怎麼排序',
    help: '不同流派對財位看法不一;預設用台灣常見的「進門斜對角」說法,也可以改用玄空(進階,依房子的星盤)。',
    options: [{ value: 'mingcai', label: '通俗:進門斜對角' }, { value: 'xuankong', label: '玄空:依星盤(進階)' }],
  },
  allowWaterHint: {
    group: 'wealth',
    label: '顯示「放水」提示',
    help: '九運傳統上有「水火」的說法;預設不主動建議放水(例如魚缸),打開後才會顯示提示。',
    options: BOOL,
  },
  preferDragonSide: {
    group: 'wealth',
    label: '門在牆正中央時只取「龍邊」',
    help: '大門開在牆正中間時,少數說法只取進門者右手邊(龍邊)的那個角;預設兩邊都列出。',
    options: BOOL,
  },

  xiaGuaHalfWidth: {
    group: 'adv-orientation',
    label: '「正中」有多寬',
    help: '方位落在山中間左右幾度內,算「下卦」(不偏向鄰近的山);較嚴格的派別用 3.5 或 3 度。',
    options: [{ value: 4.5, label: '±4.5 度' }, { value: 3.5, label: '±3.5 度' }, { value: 3, label: '±3 度' }],
  },
  jianLimitSchool: {
    group: 'adv-orientation',
    label: '兼向最多偏幾度',
    help: '方位偏向鄰近的山叫「兼向」,偏太多會提醒「空亡」(壓在交界線上,建議重量)。',
    options: [
      { value: 'default', label: '折衷' },
      { value: 'strict5', label: '較嚴(5 度)' },
      { value: 'zggdfs6', label: '較寬(6 度)' },
    ],
  },
  kongwangLabelScheme: {
    group: 'adv-orientation',
    label: '「大小空亡」的說法',
    help: '只影響文字標籤:依位置(卦界叫大空亡、山界叫小空亡),或依度數(出卦叫大、陰陽差錯叫小)。',
    options: [{ value: 'position', label: '依位置' }, { value: 'degree', label: '依度數' }],
  },
  facingPolicy: {
    group: 'adv-orientation',
    label: '「向」建議看哪一面',
    help: '量「向」時建議看哪一面。目前只有選「大門」而且填了大門朝向時,才會直接改用大門朝向。',
    options: [
      { value: 'auto', label: '自動(依建築類型)' },
      { value: 'door', label: '大門' },
      { value: 'light', label: '主採光面' },
      { value: 'building', label: '大樓正面' },
    ],
  },
  bazhaiFacingBasis: {
    group: 'adv-orientation',
    label: '八宅看哪個朝向',
    help: '八宅預設用「大門朝向」定坐向,也可以改用房子朝向;玄空一律用房子朝向。',
    options: [{ value: 'door', label: '大門朝向' }, { value: 'house', label: '房子朝向' }],
  },

  yearBoundary: {
    group: 'adv-ming',
    label: '命卦的換年時刻',
    help: '命卦以「立春」換年,預設精確到分鐘;也可以改成只比日期、固定 2 月 4 日,或元旦換年。',
    options: [
      { value: 'lichun_exact', label: '立春,精確到分鐘' },
      { value: 'lichun_date_only', label: '立春,只比日期' },
      { value: 'fixed_feb4', label: '固定 2 月 4 日' },
      { value: 'gregorian_jan1', label: '元旦(1 月 1 日)' },
    ],
  },
  coupleBasis: {
    group: 'adv-ming',
    label: '夫妻命卦不同組時聽誰的',
    help: '夫妻分屬東四命與西四命時,大門與睡向要以誰的吉方為主。',
    options: [
      { value: 'breadwinner', label: '主要收入者' },
      { value: 'wife', label: '妻子' },
      { value: 'husband', label: '丈夫' },
      { value: 'holderOnly', label: '只看戶主' },
      { value: 'averaged', label: '平均' },
    ],
  },
  multiOccupantPolicy: {
    group: 'adv-ming',
    label: '多位住戶的個人財位怎麼算',
    help: '多人同住時,個人財位取平均、以主要收入者為主(加倍),或每個人分開算。',
    options: [
      { value: 'mean', label: '取平均' },
      { value: 'breadwinner', label: '主要收入者為主' },
      { value: 'each', label: '每人分開' },
    ],
  },
  tianyiFirst: {
    group: 'adv-ming',
    label: '「天醫」排在「延年」前面',
    help: '八宅吉位的排序:港派說法會把天醫排在延年前面;預設不這樣排。',
    options: BOOL,
  },
  stovePreferAuspicious: {
    group: 'adv-ming',
    label: '灶座放在吉方',
    help: '傳統是「坐凶向吉」(灶座放凶位、灶口朝吉位);少數派主張灶座放吉方,預設不採用。',
    options: BOOL,
  },
  livingRoomGradeByEastWest: {
    group: 'adv-ming',
    label: '客廳擺設依東四命、西四命分先後',
    help: '預設客廳的四個吉位不分先後;打開後會依東四命、西四命分出先後。',
    options: BOOL,
  },

  yunSystem: {
    group: 'adv-xuankong',
    label: '運的算法',
    help: '預設是「三元九運」(2024 年起是九運);也可以改用「二元八運」,但它只涵蓋 1996 到 2043 年。',
    options: [{ value: 'san_yuan_9', label: '三元九運' }, { value: 'er_yuan_8', label: '二元八運' }],
  },
  yunBasis: {
    group: 'adv-xuankong',
    label: '玄空盤用哪一年的運',
    help: '預設用「建成年」的運起盤;改成「遷入年」後,住宅頁會多出遷入年份欄位。',
    options: [{ value: 'built', label: '建成年' }, { value: 'moveIn', label: '遷入年' }],
  },
  useTiGua: {
    group: 'adv-xuankong',
    label: '方位偏太多時改用替卦',
    help: '兼向偏太多時,傳統上換一套排法叫「替卦」;預設只排一般盤並提示。',
    options: BOOL,
  },
  tiTable: {
    group: 'adv-xuankong',
    label: '替卦用哪一張表',
    help: '替卦用的星表有 A、B 兩種;只有打開「改用替卦」才有作用。',
    options: [{ value: 'A', label: 'A 表' }, { value: 'B', label: 'B 表' }],
  },
  qiScheme: {
    group: 'adv-xuankong',
    label: '九星旺衰的標法',
    help: '九顆星的旺、退、煞分級方式;預設是台灣常見標法,另有兩種替代標法。',
    options: [{ value: 'default', label: '台灣常見' }, { value: 'S1', label: '替代標法一' }, { value: 'S2', label: '替代標法二' }],
  },
  eightKeepsWealth: {
    group: 'adv-xuankong',
    label: '八白退氣後仍當財星',
    help: '八白星過了旺期後還算不算財星,各派說法分歧,預設不催也不禁。',
    options: BOOL,
  },
  showLianshu: {
    group: 'adv-xuankong',
    label: '顯示「連數三般卦」標記',
    help: '各派對這種格局的吉凶說法互相矛盾,所以只做標記、不計入評分。',
    options: BOOL,
  },
  showChengmen: {
    group: 'adv-xuankong',
    label: '顯示「城門位」',
    help: '城門位只顯示出來,不列入主要評分。',
    options: BOOL,
  },

  qiIntake: {
    group: 'adv-wealth',
    label: '財位角落有窗時',
    help: '通俗說法認為角落有窗會散氣而扣分;玄空派認為窗口能納氣而加分。預設跟著「財位怎麼排序」自動決定。',
    options: [{ value: AUTO, label: '自動' }, { value: 'penalty', label: '扣分' }, { value: 'reward', label: '加分' }],
    explicit: true,
  },
  showRay45: {
    group: 'adv-wealth',
    label: '多顯示 45 度射線命中點',
    help: '寬扁的房間裡,從門口斜 45 度拉線的命中點可能落在遠牆中段;打開後會額外顯示。',
    options: BOOL,
  },
  taijiMode: {
    group: 'adv-wealth',
    label: '房屋中心(太極點)怎麼取',
    help: '八個方位以太極點(房屋中心)為原點:預設取面積重心,也可以取外框中心或手動點選;平面圖有指定時以平面圖為準。',
    options: [
      { value: 'centroid', label: '面積重心' },
      { value: 'bbox', label: '外框中心' },
      { value: 'manual', label: '手動點選' },
    ],
  },

  sanshaArc: {
    group: 'adv-annual',
    label: '三煞的範圍',
    help: '每年有一個方位較忌動土(三煞);預設三座山各 15 度,也可以含夾煞(75 度)或用十二地支(90 度)。',
    options: [
      { value: 'core3', label: '三山各 15 度' },
      { value: 'withJia', label: '含夾煞 75 度' },
      { value: 'branch12', label: '十二支 90 度' },
    ],
  },
  extraShensha: {
    group: 'adv-annual',
    label: '顯示夾煞',
    help: '夾煞只有少數單一來源提到,預設不顯示。',
    options: BOOL,
  },
  showMinorityTechniques: {
    group: 'adv-annual',
    label: '顯示少數派說法',
    help: '例如五鬼運財、桃花位、三煞宜向不宜坐;顯示時一律標上「少數派」。',
    options: BOOL,
  },
  showGuimenxian: {
    group: 'adv-annual',
    label: '顯示鬼門線',
    help: '鬼門線是單一來源的說法,預設不顯示。',
    options: BOOL,
  },

  yinyangScheme: {
    group: 'adv-luopan',
    label: '24 山的陰陽標法',
    help: '羅盤上 24 山的陰陽顏色:預設「三元龍」,也可以改成「三合」紅黑字。',
    options: [{ value: 'sanyuan', label: '三元龍' }, { value: 'sanhe', label: '三合' }],
  },
  southUp: {
    group: 'adv-luopan',
    label: '羅盤南方朝上',
    help: '把羅盤盤面改成南在上、北在下;預設北在上。',
    options: BOOL,
  },
  showSanZhen: {
    group: 'adv-luopan',
    label: '羅盤顯示人盤與天盤縫針',
    help: '玄空與八宅只用「地盤正針」;打開只會在羅盤上多畫另外兩圈針位。',
    options: BOOL,
  },
});

/** 刻意不顯示的設定與原因(測試會檢查 DEFAULT_SETTINGS 的每個鍵不是在上表就是在這裡) */
export const HIDDEN_SETTINGS = Object.freeze({
  renovation: '整修情形已在住宅頁的「有整修過嗎」設定,這裡再放一份會互相蓋過',
  fuyinPenalty: '工程用的扣分值,只影響玄空排序,不需要使用者調整',
  fanyinPenalty: '工程用的扣分值,只影響玄空排序,不需要使用者調整',
  wSide: '玄空財丁位的權重,工程設定',
  wYun: '玄空財丁位的權重,工程設定',
  yearVal: '流年財星的價值對照表,只影響排序,不是簡單的選項',
  bazhaiStarWeights: '八宅八星的權重對照表,只影響排序,不是簡單的選項',
  virtualPartition: '開放式空間虛擬分區目前沒有實際運算,打開只會產生提醒',
  bazhaiMatch: '目前沒有任何模組使用這個設定',
  facadeFloorRule: '只給取向輔助函式用,分析不使用,住宅頁目前也沒有接上',
});

const same = (a, b) => a === b;
// 用 hasOwn 擋掉 __proto__ 之類的原型鍵
const hasMeta = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTING_META, key);

/** 目前生效的值:有覆寫用覆寫,否則預設;explicit 的設定沒寫就是 AUTO */
export function currentValue(state, key) {
  const meta = hasMeta(key) ? SETTING_META[key] : null;
  const own = state && state.settings && Object.prototype.hasOwnProperty.call(state.settings, key);
  if (meta && meta.explicit) return own ? state.settings[key] : AUTO;
  return own ? state.settings[key] : DEFAULT_SETTINGS[key];
}

/** 這個選項是不是預設(用來標「預設」字樣) */
export function isDefaultOption(key, value) {
  const meta = hasMeta(key) ? SETTING_META[key] : null;
  if (meta && meta.explicit) return value === AUTO;
  return same(value, DEFAULT_SETTINGS[key]);
}

/**
 * 套用設定。只接受表內的鍵與選項;等於預設的值不寫進覆寫(引擎只認「使用者明寫」的設定)。
 * 回傳是否真的寫入。
 */
export function applySetting(store, key, value) {
  const meta = hasMeta(key) ? SETTING_META[key] : null;
  if (!meta || !meta.options.some((o) => same(o.value, value))) return false;
  store.update((d) => {
    if (meta.explicit) {
      if (value === AUTO) delete d.settings[key];
      else d.settings[key] = value;
    } else if (same(value, DEFAULT_SETTINGS[key])) delete d.settings[key];
    else d.settings[key] = value;
  });
  return true;
}

const kindOf = (meta) => {
  if (meta.options === BOOL) return 'switch';
  const longest = Math.max(...meta.options.map((o) => [...o.label].length));
  return meta.options.length <= 3 && longest <= 9 && meta.options.length * longest <= 22 ? 'seg' : 'select';
};

/** 備份檔名,例如 fengshui-backup-2026-09-29.json */
export function backupFileName(nowMs) {
  return `fengshui-backup-${new Date(nowMs + 8 * 3600000).toISOString().slice(0, 10)}.json`;
}

/** 把匯入失敗的原因翻成白話 */
export function importErrorMessage(err) {
  const m = String((err && err.message) || err || '');
  if (err instanceof SyntaxError || /JSON/i.test(m)) return '這個檔案不是有效的備份檔(讀不出內容)。請選用本 App 匯出的 .json 檔。';
  if (/版本/.test(m)) return '這個備份檔的格式或版本不符,無法匯入。';
  return '匯入失敗:這個檔案看起來不是本 App 的備份。';
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const THEMES = Object.freeze([
  { value: 'auto', label: '跟隨系統' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '淺色' },
]);

// ─────────────────────────── 面板 ───────────────────────────

export function openSettings(ctx) {
  const { store, toast, openSheet } = ctx;
  const controls = []; // { sync(state) }
  let blobUrl = null;
  let unsub = () => {};
  let sheet = null;

  const syncAll = () => {
    const state = store.get();
    for (const c of controls) c.sync(state);
  };

  // 單一設定的一列(標題 + 說明 + 控制項)
  const settingRow = (key) => {
    const meta = SETTING_META[key];
    const value = currentValue(store.get(), key);
    const kind = kindOf(meta);
    // 選項文字本身已有括號(例如「5 度(一般)」)時,把「預設」併進同一個括號,不要出現兩組括號
    const label = (o) => {
      if (!isDefaultOption(key, o.value) || /預設/.test(o.label)) return o.label;
      const m = /^(.*)[(（]([^()（）]*)[)）]$/.exec(o.label);
      return m ? `${m[1]}(${m[2]},預設)` : `${o.label}(預設)`;
    };
    const opts = meta.options.map((o) => ({ value: o.value, label: label(o) }));
    if (kind === 'switch') {
      const row = switchRow({
        label: meta.label,
        help: meta.help,
        checked: value === true,
        onChange: (v) => applySetting(store, key, v),
      });
      controls.push({ sync: (s) => row.set(currentValue(s, key) === true) });
      return h('div', { class: 'v-settings-item' }, row.el);
    }
    const id = nextDomId('st');
    let control;
    if (kind === 'seg') {
      const seg = segControl({ options: opts, value, label: meta.label, onChange: (v) => applySetting(store, key, v) });
      controls.push({ sync: (s) => seg.set(currentValue(s, key)) });
      control = seg.el;
    } else {
      const sel = h('select', { id, onchange: () => {
        const o = meta.options[Number(sel.value)];
        if (o) applySetting(store, key, o.value);
      } }, opts.map((o, i) => h('option', { value: String(i) }, o.label)));
      const sync = (s) => {
        const v = currentValue(s, key);
        const i = meta.options.findIndex((o) => same(o.value, v));
        sel.value = String(i < 0 ? 0 : i);
      };
      sync(store.get());
      controls.push({ sync });
      control = sel;
    }
    return h('div', { class: 'v-settings-item field' },
      h(kind === 'select' ? 'label' : 'span', kind === 'select' ? { for: id, class: 'v-settings-label' } : { class: 'v-settings-label' }, meta.label),
      h('div', { class: 'hint' }, meta.help),
      control);
  };

  const groupBlock = (g, level = 'h3') => h('section', { class: 'v-settings-sec' },
    h(level, { class: 'v-settings-h' }, g.title),
    Object.keys(SETTING_META).filter((k) => SETTING_META[k].group === g.id && !SETTING_META[k].custom).map(settingRow));

  // 介面:簡單模式 / 完整功能。只改網址,ui.mode 由 main.js 依網址寫入;切換後關閉面板
  const modeSeg = segControl({
    options: [{ value: 'easy', label: EASY_TEXT['set.easy'] }, { value: 'pro', label: EASY_TEXT['set.pro'] }],
    value: store.get().ui.mode === 'pro' ? 'pro' : 'easy',
    label: EASY_TEXT['set.label'],
    onChange: (mode) => {
      const ui = store.get().ui;
      const target = mode === 'easy' ? '#/easy' : `#/${proHomeOf(ui)}`;
      if (sheet) sheet.close();
      if (location.hash !== target) location.hash = target;
    },
  });
  controls.push({ sync: (s) => modeSeg.set(s.ui.mode === 'pro' ? 'pro' : 'easy') });
  const modeSec = h('section', { class: 'v-settings-sec' },
    h('h3', { class: 'v-settings-h' }, EASY_TEXT['set.group']),
    h('div', { class: 'v-settings-item field' }, h('span', { class: 'v-settings-label' }, EASY_TEXT['set.label']),
      h('div', { class: 'hint' }, EASY_TEXT['set.help']), modeSeg.el));

  // 外觀
  const themeSeg = segControl({
    options: THEMES, value: store.get().ui.theme, label: '主題',
    onChange: (v) => store.update((d) => { d.ui.theme = v; }),
  });
  controls.push({ sync: (s) => themeSeg.set(s.ui.theme) });
  const appearance = h('section', { class: 'v-settings-sec' },
    h('h3', { class: 'v-settings-h' }, '外觀'),
    h('div', { class: 'v-settings-item field' }, h('span', { class: 'v-settings-label' }, '主題'),
      h('div', { class: 'hint' }, '深色是漆面金字,淺色是宣紙底;預設跟著手機的深淺色設定。'), themeSeg.el));

  // 北基準(與住宅頁共用同一個元件,兩邊永遠同步)
  const northCtl = createNorthControls({ store });
  controls.push({ sync: (s) => northCtl.sync(s) });
  const northSec = h('section', { class: 'v-settings-sec' },
    h('h3', { class: 'v-settings-h' }, '北基準'), northCtl.el);

  // 進階(預設摺疊)
  const advanced = h('details', { class: 'v-settings-adv disclosure' },
    h('summary', null, '進階流派選項'),
    h('p', { class: 'hint v-settings-advnote' },
      '不同流派做法不一。這些都有合理的預設值,不確定就不用動。改了以後,財位與報告會立刻依新設定重算。'),
    SETTING_GROUPS.filter((g) => g.advanced).map((g) => groupBlock(g, 'h4')));

  // 資料:匯出、匯入、清除
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const importMsg = h('div', { class: 'hint v-settings-msg', 'aria-live': 'polite' });
  const importConfirm = h('div', { class: 'callout warn hidden v-settings-confirm', role: 'alert' });
  let pendingText = null;

  const exportBtn = h('button', { type: 'button', class: 'btn', onclick: () => {
    try {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      const a = h('a', { href: blobUrl, download: backupFileName(Date.now()), class: 'hidden' });
      document.body.append(a);
      a.click();
      a.remove();
      toast('已產生備份檔,請到下載資料夾找');
    } catch {
      toast('備份檔產生失敗,請稍後再試');
    }
  } }, '匯出備份');

  const importBtn = h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, '匯入備份');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    importMsg.textContent = '';
    // 換檔時上一個檔案的確認提示要收掉,不然按「確定匯入」會匯入舊檔
    pendingText = null;
    importConfirm.classList.add('hidden');
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { importMsg.textContent = '這個檔案太大了,不像是本 App 的備份檔。'; return; }
    try {
      const text = await file.text();
      store.parseBackup(text); // 先確認讀得出來、像本 App 的備份,再詢問是否覆蓋
      pendingText = text;
      clear(importConfirm);
      importConfirm.append(
        h('div', null, `匯入「${file.name}」會取代目前所有資料(朝向、住戶、平面圖與設定)。確定要匯入嗎?`),
        h('div', { class: 'row v-settings-confirm-actions' },
          h('button', { type: 'button', class: 'btn btn-sm', 'data-role': 'cancel-import', onclick: () => { pendingText = null; importConfirm.classList.add('hidden'); } }, '取消'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => {
            const t = pendingText;
            pendingText = null;
            importConfirm.classList.add('hidden');
            try {
              store.importJSON(t);
              store.update((d) => { repairDraft(d); }); // 舊備份或手改的檔案可能有壞欄位
              toast('已匯入備份');
            } catch (e) {
              importMsg.textContent = importErrorMessage(e);
            }
          } }, '確定匯入')));
      importConfirm.classList.remove('hidden');
    } catch (e) {
      importMsg.textContent = importErrorMessage(e);
    }
  });

  const resetConfirm = h('div', { class: 'callout warn hidden v-settings-confirm', role: 'alert' });
  const resetBtn = h('button', { type: 'button', class: 'btn btn-danger', onclick: () => {
    clear(resetConfirm);
    const cancel = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { resetConfirm.classList.add('hidden'); resetBtn.focus(); } }, '取消');
    resetConfirm.append(
      h('div', null, '這會刪除朝向、住宅資料、住戶、平面圖與所有設定,沒辦法復原。建議先匯出備份。'),
      h('div', { class: 'row v-settings-confirm-actions' }, cancel,
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => {
          store.reset();
          resetConfirm.classList.add('hidden');
          toast('已清除全部資料');
        } }, '確定全部清除')));
    resetConfirm.classList.remove('hidden');
    cancel.focus();
  } }, '清除全部資料');

  const dataSec = h('section', { class: 'v-settings-sec' },
    h('h3', { class: 'v-settings-h' }, '資料'),
    h('p', { class: 'hint' }, '所有資料只存在這支手機(或這個瀏覽器)裡,不會上傳。換手機前可以先匯出備份。'),
    h('p', { class: 'hint' }, '用 Safari 分頁開啟時,太久沒開,系統可能會清掉資料。建議點分享 > 加入主畫面,並偶爾匯出備份。(注意:主畫面版的資料和 Safari 分頁是分開的,搬過去請用匯出/匯入備份。)'),
    h('div', { class: 'row' }, exportBtn, importBtn),
    fileInput, importMsg, importConfirm,
    h('div', { class: 'row v-settings-danger' }, resetBtn),
    resetConfirm);

  // 關於
  const aboutSec = h('section', { class: 'v-settings-sec' },
    h('h3', { class: 'v-settings-h' }, '關於'),
    h('p', null, `風水羅盤 版本 ${APP_VERSION}`),
    h('details', { class: 'v-house-details disclosure' },
      h('summary', null, '資料來源說明'),
      h('div', { class: 'stack' },
        h('p', null, '磁偏角(磁北與真北的差)使用內建的城市表,依美國 NOAA 的 WMM2025 地磁模型整理,有效期到 2029 年底。'),
        h('p', null, '立春與節氣以天文公式在本機計算,不需要網路。'),
        h('p', null, '八宅、玄空飛星、財位等規則整理自公開的傳統資料。各派說法不一,每則結論都會標示是「傳統說法」「推論」「本 App 的設計」或「少數派」。'))),
    h('details', { class: 'v-house-details disclosure' },
      h('summary', null, '免責聲明'),
      h('div', { class: 'stack' }, DISCLAIMERS.map((t) => h('p', null, t)))));

  const proGroups = [
    northSec,
    groupBlock(SETTING_GROUPS.find((g) => g.id === 'measure')),
    groupBlock(SETTING_GROUPS.find((g) => g.id === 'wealth')),
    advanced,
  ];
  // 簡單模式只直接顯示「介面、外觀、資料」;北基準、量測誤差、財位與流派選項收進一個摺疊區,免得一打開就是一堆專業名詞
  const easy = store.get().ui.mode === 'easy';
  const content = easy
    ? h('div', { class: 'v-settings stack' },
      modeSec,
      appearance,
      dataSec,
      h('details', { class: 'v-settings-adv disclosure v-settings-pro' },
        h('summary', null, '專業設定(完整功能用)'),
        h('div', { class: 'stack' }, proGroups)),
      aboutSec)
    : h('div', { class: 'v-settings stack' },
      modeSec,
      appearance,
      ...proGroups,
      dataSec,
      aboutSec);

  // 匯出的暫存網址與訂閱都在面板關閉時收乾淨
  sheet = openSheet({
    title: '設定',
    content,
    onClose: () => {
      unsub();
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    },
  });
  unsub = store.subscribe(syncAll);
  syncAll();
  return sheet;
}

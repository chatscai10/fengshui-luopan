// 白話文案層(規格 5): 把 analyzeHouse 的 HouseReport 轉成結果頁的分段卡片。純函式、無 DOM、無全域狀態;不修改 report。
// 規則落實(規格 5.1): 術語第一次出現用括號解釋(GLOSSARY)、語氣依 tag 分級、主結果頁不用恐嚇字眼、不保證結果、
// 分數只轉成三段標籤而不顯示數字、流派分歧與不確定要老實說、附三類免責聲明。
// Finding.id 只當索引鍵與 UI 的 key,永遠不會出現在任何顯示文字裡;模組產生的 Finding 文字先經 scrubText 清掉
// 內部代碼(來源編號、欄位路徑、乘數),再依 tag 補語氣,最後統一做術語括號解釋。
import { dirOfGua } from './geo.js';
import { inArc } from './annual.js';
import { ROOM_NAME, cornerText, sectorText } from './wealth/findings.js';
import { SOFT_ADVICE } from './wealth/constants.js';

export const COPY_SCHEMA = 'fengshui.copy/1';

const round0 = (x) => Math.floor(x + 0.5);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ─────────────────────────── 免責聲明(規格 5.5) ───────────────────────────

/** 頁底固定的免責聲明,依序為: 文化性質、專業勘宅、測量誤差、流派說明。 */
export const DISCLAIMERS = Object.freeze([
  '風水是華人的傳統民俗文化,這些財位建議是整理與佈置空間的參考,不保證任何財運結果,也不構成投資或理財建議。',
  '以上為傳統上的說法,實際運用還需配合房屋座向、外環境與室內擺設綜合判斷;實際勘宅需專業風水師親至現場,包含外部環境、形勢與納氣。',
  '手機羅盤適合判定 24 山等級,不適合更細的分金;附近有金屬或鋼筋時誤差可能更大。',
  '不同流派對財位的看法並不一致,本 App 預設採台灣常見的「進門對角」說法,並提供「玄空」等進階檢視。',
]);

/** 每張卡片的短版免責。 */
export const CARD_DISCLAIMER = '傳統民俗參考,請勿過度迷信。';

// ─────────────────────────── 術語括號解釋(規格 5.2) ───────────────────────────

/**
 * 每列是一組共用一句解釋的術語: 該組任何一個詞第一次出現時,在它後面補括號解釋。
 * 解釋文字不可含其他組的詞(測試會驗),否則「第一次出現」的順序會被解釋文字本身打亂。
 */
export const GLOSSARY = Object.freeze([
  { key: 'zuoxiang', terms: ['坐向'], explain: '房子的背是坐、面是向,站在屋內面朝外的方向叫「向」' },
  { key: 'shan24', terms: ['24 山'], explain: '把 360 度切成 24 等分的方位名,每份 15 度,如「子山」是正北' },
  { key: 'minggua', terms: ['命卦'], explain: '依出生年與性別算出的個人方位組別,分東四命、西四命' },
  { key: 'zhaigua', terms: ['宅卦'], explain: '依房子的背與面算出的房屋組別,分東四宅、西四宅' },
  { key: 'mingzhai', terms: ['命宅相配'], explain: '個人的方位組別與房子的組別相同' },
  { key: 'mingcai', terms: ['明財位'], explain: '進門後斜對角的牆角,依空間形狀判斷' },
  { key: 'ancai', terms: ['暗財位'], explain: '依房子方位與星盤推算出的位置' },
  { key: 'caiwei', terms: ['財位'], explain: '傳統上認為適合放置催財或保持整潔的位置' },
  { key: 'liunian', terms: ['流年'], explain: '每一年的方位運勢,以立春為一年開始' },
  { key: 'feixing', terms: ['玄空飛星', '飛星'], explain: '一種把九個數字依規則排進九個方位的傳統推算法' },
  { key: 'yun', terms: ['元運', '九運'], explain: '每 20 年一個週期,2024 年 2 月起是第九運' },
  { key: 'stars3', terms: ['山星', '向星', '運星'], explain: '玄空盤每個方位上的三個數字: 山星傳統上看人丁與健康,向星看財運,運星是這一運的基準數字' },
  { key: 'geju', terms: ['旺山旺向', '上山下水', '雙星會向', '雙星會坐'], explain: '玄空盤把旺星放在房子前方或後方的四種常見組合' },
  { key: 'xiagua', terms: ['下卦', '兼向', '替卦'], explain: '方位正中稱下卦,偏向鄰近方位稱兼向;兼向偏太多時傳統上換一套排法,稱替卦' },
  { key: 'kongwang', terms: ['空亡'], explain: '方位剛好壓在兩個方位的交界線上,傳統上建議避開或重測' },
  { key: 'north', terms: ['磁北', '真北'], explain: '羅盤指的是磁北,地圖上的北是真北,台灣兩者差約 5 度' },
  { key: 'taisui', terms: ['太歲', '歲破'], explain: '當年地支所在方位與其正對面,傳統上動土裝修要留意' },
  { key: 'sansha', terms: ['三煞方', '三煞'], explain: '每年有一個方位較忌動土,依年份不同' },
  { key: 'wuhuang', terms: ['五黃', '二黑'], explain: '兩顆傳統上需要留意的星,宜靜不宜動' },
  { key: 'fuyin', terms: ['伏吟', '反吟'], explain: '盤面數字與原位相同或相反的特殊格局' },
  {
    key: 'bazhaistar',
    terms: ['遊年八星', '生氣位', '延年位', '天醫位', '禍害位', '六煞位', '五鬼位', '絕命位'],
    explain: '八宅法對八個方位的分類,生氣、延年、天醫、伏位傳統上視為吉位',
  },
]);

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERM_ENTRY = new Map(GLOSSARY.flatMap((e) => e.terms.map((t) => [t, e])));
const TERM_SUFFIXES = Object.freeze(['財位', '財星', '星', '宮', '盤']);
const TERM_RE = new RegExp(
  [...TERM_ENTRY.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escRe)
    .join('|'),
  'g',
);

/**
 * 在文字裡替「還沒解釋過的術語」的第一次出現補括號解釋。state.explained 跨多段文字共用。
 * 術語後面本來就接括號(模組文字自帶解釋)時視為已解釋,不重複補。
 * @param {string} text
 * @param {{explained:Set<string>}} state
 * @returns {string}
 */
export function explainTerms(text, state) {
  if (!text) return text;
  let out = '';
  let last = 0;
  let consumed = 0;
  for (const m of text.matchAll(TERM_RE)) {
    if (m.index < consumed) continue;
    const entry = TERM_ENTRY.get(m[0]);
    // 術語常連著後綴成詞(流年財位、五黃星、三煞方),括號要放在整個詞後面,不能插在詞中間。
    let end = m.index + m[0].length;
    const suffix = TERM_SUFFIXES.find((x) => text.startsWith(x, end));
    if (suffix) end += suffix.length;
    consumed = end;
    if (state.explained.has(entry.key)) continue;
    state.explained.add(entry.key);
    const next = text[end];
    if (next === '(' || next === '（') continue;
    out += `${text.slice(last, end)}(${entry.explain})`;
    last = end;
  }
  return out + text.slice(last);
}

// ─────────────────────────── 文字清理與語氣 ───────────────────────────

/** 移除「開頭符合 test」的成對括號群(可巢狀),例如 「(依據: 文昌位只採一四(high)與三九(low));」。 */
function stripGroups(text, test) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '(' || c === '（') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '(' || text[j] === '（') depth += 1;
        else if (text[j] === ')' || text[j] === '）') depth -= 1;
        j += 1;
      }
      if (depth === 0 && test(text.slice(i + 1, j - 1))) {
        i = j;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

const SOFTEN = Object.freeze([
  [/大凶/g, '特別需要留意'],
  [/絕嗣/g, '較不利'],
  [/克妻/g, '較不利'],
  [/敗財/g, '不利財務'],
  [/(?<!不)保證/g, '確保'],
]);

/**
 * 清掉模組文字裡不該給使用者看的內部痕跡: 來源編號、規格條號、欄位路徑、乘數與分數上限;並把恐嚇字眼改成溫和說法(規格 5.1 第 6 點)。
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function scrubText(text) {
  if (typeof text !== 'string') return '';
  let t = text;
  // 確定度已由卡片徽章顯示,本文裡的「(中信心)」是重複的內部用語;「(MyGoNews 2010)」這類英文來源名加年份也不給使用者看
  t = stripGroups(t, (g) => /^依據\s*[::]/.test(g) || /^規格\s/.test(g) || /^[A-Z]{2,}-\d+/.test(g) || /^[a-z][a-z0-9_]{0,15}$/.test(g)
    || /^[高中低]信心$/.test(g) || /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,2} \d{4}$/.test(g));
  t = t.replace(/(?:SOHU|CAF|ZGGDFS|SINA|VOCUS|SECRETCHINA)-[A-Za-z0-9-]+/g, '');
  t = t.replace(/規格\s*[A-Z]-?\d+/g, '');
  t = t.replace(/(這裡|這邊)?把這個位置的分數乘 ([\d.]+)(?:\(設計值\)|,設計值)?/g, (_, __, x) =>
    Number(x) >= 1 ? '這裡會把這個位置的排序稍微往前調(調整幅度是本 App 的設計值)' : '這裡會把這個位置的排序往後調(調整幅度是本 App 的設計值)',
  );
  t = t.replace(/(這裡)?乘 ([\d.]+),設計值/g, '排序稍微往前調,幅度是設計值');
  t = t.replace(/分數已依流年星值扣分/g, '排序已因此往後調');
  t = t.replace(/,分數上限是 [\d.]+/g, ',排序的上限也會降低');
  t = t.replace(/分數只用來排序/g, '排序只用來整理候選位置');
  for (const [re, to] of SOFTEN) t = t.replace(re, to);
  return t.replace(/\s+([,。;:、])/g, '$1').replace(/([,;:、])\1+/g, '$1').replace(/;\s*。/g, '。').replace(/\s{2,}/g, ' ').trim();
}

const HEDGE_RE = /傳統|說法|認為|主張|通常|一般|相傳/;

/**
 * 依 tag 補語氣(規格 5.1 第 4 點)。source: 「傳統上…」;inference: 推論與無古籍依據;minority: 少數流派、預設不採用;design: 本 App 的整理方式。
 * @param {'source'|'inference'|'design'|'minority'} tag
 * @param {string} body
 * @returns {string}
 */
export function applyTone(tag, body) {
  let b = body;
  if (tag === 'source') {
    if (!HEDGE_RE.test(b)) b = `傳統上的說法:${b}`;
  } else if (tag === 'inference') {
    if (!/推論|沒有直接的古籍依據/.test(b)) b += '這是依五行或位置推得的說法,沒有直接的古籍依據。';
  } else if (tag === 'minority') {
    if (!/少數/.test(b)) b = `少數流派主張:${b}`;
    if (!/不採用/.test(b)) b += '本 App 預設不採用。';
  } else if (tag === 'design') {
    if (!/本 App/.test(b)) b += '這是本 App 的整理方式,僅供整理空間的參考。';
  }
  return b;
}

const TAG_BADGE = Object.freeze({ source: '傳統說法', inference: '推論', design: '本 App 的設計', minority: '少數派' });
const CONF_BADGE = Object.freeze({ high: '確定度較高', medium: '確定度中等', low: '確定度較低' });
const TIER_LABEL = Object.freeze({ suitable: '較適合', consider: '可以考慮', notAdvised: '不建議' });

/** 財位卡片開頭的三段標籤說明句(財位卡與簡單模式共用)。 */
export const TIER_SENTENCE = Object.freeze({
  suitable: '在目前整理的候選位置中,這裡排在比較前面,較適合放置擺設或保持整潔。',
  consider: '這個位置可以考慮,但不是最突出的選擇。',
  notAdvised: '這個位置目前不建議作為財位,下面列出需要先處理的地方。',
});

/** 財位角落接近兩個方位交界時的提醒句。 */
/** 簡單模式:流年凶星落在財位角落時的白話版(同 wealth.annual.bad_on_ming 卡片,只拿掉星名與宮名) */
export const EASY_ANNUAL_REMEDY = Object.freeze({
  headline: '今年這個角落宜靜',
  body: '傳統上認為各方位的吉凶每年輪替,今年這個角落不適合大動:建議少動土、少大搬動,保持整潔。它的排序也因此往後調了。',
});
export const BORDERLINE_SENTENCE = '這個位置接近兩個方位的交界,請再確認平面圖的方位與尺寸。';
const STAR_NAME = Object.freeze({ 1: '一白', 2: '二黑', 3: '三碧', 4: '四綠', 5: '五黃', 6: '六白', 7: '七赤', 8: '八白', 9: '九紫' });
const GOOD_BAZHAI = Object.freeze(['生氣', '延年', '天醫', '伏位']);

const dirText = (d) => (d === '中宮' || d === '中' ? '中宮(房子中心)' : `${d}方`);
const groupLabel = (g) => (g === 'east' ? '東四命' : '西四命');
const houseGroupLabel = (g) => (g === 'east' ? '東四宅' : '西四宅');

// ─────────────────────────── Finding 家族(id → 分段與處理方式) ───────────────────────────

/**
 * 每個家族: re 比對 Finding.id,section 是結果頁分段(規格 5.3),order 是段內排序,tone 'auto' 依 tag 補語氣、'plain' 不補
 * (提醒類本來就是本 App 的說明),subject 為 true 時標題前加住戶名(bazhai 的 subject 是住戶 id)。
 * tag=minority 的 Finding 一律進 traditional 分段。順序即比對優先序,特例放前面。
 * @type {ReadonlyArray<{key:string, re:RegExp, section:string, order:number, tone:'auto'|'plain', subject?:boolean}>}
 */
export const COPY_FAMILIES = Object.freeze([
  // traditional(傳統說法與少數派)特例
  { key: 'wealth.soft', re: /^wealth\.soft\./, section: 'traditional', order: 10, tone: 'auto' },
  { key: 'wealth.eight_white', re: /^wealth\.annual\.eight_white_boost$/, section: 'traditional', order: 11, tone: 'auto' },
  { key: 'bz.minority', re: /^bz\.minority\./, section: 'traditional', order: 12, tone: 'auto' },
  { key: 'annual.sansha', re: /^annual\.sansha\./, section: 'traditional', order: 13, tone: 'auto' },
  // orientation
  { key: 'house.geo', re: /^house\.geo\./, section: 'orientation', order: 10, tone: 'plain' },
  { key: 'house.north', re: /^house\.north\./, section: 'orientation', order: 11, tone: 'plain' },
  { key: 'house.facing', re: /^house\.facing\./, section: 'orientation', order: 12, tone: 'plain' },
  { key: 'house.setting', re: /^house\.setting\./, section: 'orientation', order: 13, tone: 'plain' },
  { key: 'geo.near_gua_boundary', re: /^geo\.near_gua_boundary$/, section: 'orientation', order: 14, tone: 'plain' },
  { key: 'bz.house', re: /^bz\.house\./, section: 'orientation', order: 15, tone: 'plain' },
  // ming
  { key: 'house.resident', re: /^house\.residents?\./, section: 'ming', order: 10, tone: 'plain', subject: true },
  { key: 'bz.ming', re: /^bz\.ming\./, section: 'ming', order: 11, tone: 'plain', subject: true },
  { key: 'bz.household', re: /^bz\.household\./, section: 'ming', order: 12, tone: 'auto' },
  // wealth
  { key: 'wealth.layers', re: /^wealth\.layers\./, section: 'wealth', order: 10, tone: 'auto' },
  { key: 'wealth.ming_gua', re: /^wealth\.ming_gua\./, section: 'wealth', order: 11, tone: 'auto' },
  { key: 'wealth.bazhai', re: /^wealth\.bazhai\./, section: 'wealth', order: 12, tone: 'auto' },
  { key: 'wealth.xuankong', re: /^wealth\.xuankong\./, section: 'wealth', order: 13, tone: 'auto' },
  { key: 'wealth.annual', re: /^wealth\.annual\./, section: 'wealth', order: 14, tone: 'auto' },
  { key: 'wealth.ming', re: /^wealth\.ming\./, section: 'wealth', order: 15, tone: 'auto' },
  { key: 'wealth.door', re: /^wealth\.door\./, section: 'wealth', order: 16, tone: 'auto' },
  { key: 'wealth.borderline', re: /^wealth\.borderline\./, section: 'wealth', order: 17, tone: 'plain' },
  { key: 'wealth.water', re: /^wealth\.water\./, section: 'wealth', order: 18, tone: 'auto' },
  { key: 'wealth.seat', re: /^wealth\.seat\./, section: 'wealth', order: 21, tone: 'auto' },
  { key: 'wealth.plan', re: /^wealth\.plan\./, section: 'wealth', order: 19, tone: 'plain' },
  { key: 'house.plan', re: /^house\.plan\./, section: 'wealth', order: 20, tone: 'plain' },
  { key: 'wealth.rank', re: /^wealth\.rank\./, section: 'wealth', order: 90, tone: 'auto' },
  // xuankong
  { key: 'house.building', re: /^house\.building\./, section: 'xuankong', order: 1, tone: 'plain' },
  { key: 'xk.pattern', re: /^xk\.pattern\./, section: 'xuankong', order: 10, tone: 'auto' },
  { key: 'xk.form', re: /^xk\.form\./, section: 'xuankong', order: 11, tone: 'auto' },
  { key: 'xk.locate', re: /^xk\.locate\./, section: 'xuankong', order: 12, tone: 'auto' },
  { key: 'xk.wholeplate', re: /^xk\.wholeplate\./, section: 'xuankong', order: 13, tone: 'auto' },
  { key: 'xk.yun', re: /^xk\.yun\./, section: 'xuankong', order: 14, tone: 'auto' },
  { key: 'xk.special', re: /^xk\.special\./, section: 'xuankong', order: 15, tone: 'auto' },
  { key: 'xk.position', re: /^xk\.position\./, section: 'xuankong', order: 16, tone: 'auto' },
  { key: 'xk.localyin', re: /^xk\.localyin\./, section: 'xuankong', order: 17, tone: 'auto' },
  { key: 'xk.pair', re: /^xk\.pair\./, section: 'xuankong', order: 18, tone: 'auto' },
  { key: 'xk.star9', re: /^xk\.star9\./, section: 'xuankong', order: 19, tone: 'auto' },
  { key: 'xk.star', re: /^xk\.star\./, section: 'xuankong', order: 20, tone: 'auto' },
  { key: 'xk.room', re: /^xk\.room\./, section: 'xuankong', order: 21, tone: 'auto' },
  // annual
  { key: 'annual.year', re: /^annual\.year\./, section: 'annual', order: 10, tone: 'plain' },
]);

/**
 * Finding.id 對應的文案家族;沒有對應回 null(測試要求每個會產生的 id 都有)。
 * @param {string} id
 * @returns {(typeof COPY_FAMILIES)[number]|null}
 */
export function familyOfFindingId(id) {
  return COPY_FAMILIES.find((f) => f.re.test(id)) ?? null;
}

export const SECTION_ORDER = Object.freeze(['orientation', 'ming', 'wealth', 'xuankong', 'annual', 'traditional']);
const SECTION_META = Object.freeze({
  orientation: { title: '你家的方位', collapsed: false },
  ming: { title: '你的命卦組別與相配情形', collapsed: false },
  wealth: { title: '財位', collapsed: false },
  xuankong: { title: '玄空盤(進階)', collapsed: true },
  annual: { title: '今年留意的方位', collapsed: false },
  traditional: { title: '傳統說法與少數派', collapsed: true },
});

// ─────────────────────────── 卡片建立 ───────────────────────────

/** 組卡片(文字尚未做術語括號解釋)。badges 由 tag、信心、需要留意與額外標籤組成。 */
function card({ id, headline, body, schoolNote = null, tag, confidence, level = 'info', extraBadges = [], footnote = CARD_DISCLAIMER, subject = null, source = 'summary' }) {
  const badges = [...extraBadges];
  badges.push(TAG_BADGE[tag]);
  if (level === 'caution') badges.push('需要留意');
  badges.push(CONF_BADGE[confidence]);
  if (schoolNote) badges.push('各派看法不一');
  return { id, headline, body, schoolNote, badges, tag, confidence, level, footnote, subject, source };
}

/** Finding 標題的白話化: 拿掉「推論: 」前綴(徽章已標推論)。 */
const cleanTitle = (t) => scrubText(t).replace(/^推論[::]\s*/, '');

function findingCard(f, fam, section, ctx) {
  const name = f.subject ? ctx.nameOf.get(f.subject) : null;
  let headline = cleanTitle(f.title);
  const mGua = /^wealth\.ming_gua\.(.+)$/.exec(f.id);
  if (mGua) {
    const nm = ctx.nameOf.get(mGua[1]);
    headline = `${nm ?? '住戶'}的本命財位`;
  } else if (/^xk\.room\./.test(f.id)) {
    headline = headline.replace(/的位置$/, '適合的位置');
  } else if (fam.subject && name) {
    headline = `${name}: ${headline}`;
  }
  let body = scrubText(f.body);
  if (fam.tone === 'auto') body = applyTone(f.tag, body);
  const school = f.schoolNote ? scrubText(f.schoolNote) : null;
  return card({
    id: f.id,
    headline,
    body,
    schoolNote: school || null,
    tag: f.tag,
    confidence: f.confidence,
    level: f.level,
    footnote: section === 'orientation' || section === 'ming' ? null : CARD_DISCLAIMER,
    subject: f.subject ?? null,
    source: 'finding',
  });
}

const northLabelOf = (report) => (report.geo.north.mode === 'true' ? '真北' : '磁北');

function orientationCards(report) {
  const g = report.geo;
  const zhai = report.bazhai.house;
  const cards = [];
  const nl = northLabelOf(report);
  const shaky = Boolean(g.kongwangKind) || g.retest;

  let pos = `這是你家的坐向:坐${g.sitMountain}山、向${g.facingMountain}山。向約在 ${round0(g.bearing)} 度,屬 24 山中的${g.facingMountain}山,坐的位置在${g.zhaiSitDir}方。`;
  if (g.zone === 'jian') {
    pos += `方位偏向${g.lean.facing}山約 ${round0(Math.abs(g.dev))} 度,屬兼向,傳統上會標成「${g.label}」。`;
  } else {
    pos += '方位落在山的中間一帶,屬下卦(不偏向鄰近的山)。';
  }
  if (shaky) pos += '量到的方向接近山與山的交界,結果對誤差很敏感,建議重新量測。';
  cards.push(card({
    id: 'card.orientation.position',
    headline: `你家坐向: ${g.label}`,
    body: pos,
    tag: 'source',
    confidence: shaky ? 'medium' : 'high',
    footnote: null,
  }));

  const basisText = report.meta.ruleset.bazhaiFacingBasis === 'house' ? '宅向' : '大門朝向';
  cards.push(card({
    id: 'card.orientation.zhai',
    headline: `房屋的宅卦: ${zhai.name}(${houseGroupLabel(zhai.group)})`,
    body: `依房子的坐(${zhai.sitMountain}山,在${zhai.sitDir}方)定出宅卦,這間房子屬「${zhai.name}」,分組是${houseGroupLabel(zhai.group)}。`,
    schoolNote: `八宅這裡依「${basisText}」定坐向,可以在設定改變;以不同的向定宅,結果可能不同。`,
    tag: 'source',
    confidence: zhai.boundary.nearGuaBoundary ? 'medium' : 'high',
    footnote: null,
  }));

  const n = g.north;
  let nb = '';
  if (n.mode === 'true') nb += '本 App 已把手機讀到的方位換算成真北再分析。';
  else nb += '本 App 預設用磁北,和實體羅盤一致。';
  if (n.declination !== null) {
    nb += `目前這個地點的磁北比真北${n.declination < 0 ? '偏西' : '偏東'}約 ${round0(Math.abs(n.declination))} 度。`;
  } else {
    nb += '台灣的磁北比真北偏西約 5 度,你可以在設定改用真北,兩種讀法結果不同時會並列顯示。';
  }
  if (n.compare) {
    const c = n.compare;
    nb += `用磁北讀是${c.sitMountain.magnetic}山${c.facing.magneticMountain}向,用真北讀是${c.sitMountain.true}山${c.facing.trueMountain}向`;
    nb += c.differs.mountain || c.differs.gua ? ',兩種讀法的結果不同,並列供你對照。' : ',兩種讀法的結果相同。';
  }
  cards.push(card({
    id: 'card.orientation.north',
    headline: `本次採用${nl}`,
    body: nb,
    tag: 'source',
    confidence: 'high',
    footnote: null,
  }));
  return cards;
}

function residentCards(report) {
  const cards = [];
  const zhai = report.bazhai.house;
  const rs = report.bazhai.residents;
  for (const r of rs) {
    const dirOf = (star) => r.wealthOrder.find((w) => w.star === star)?.dir;
    let body = `你的命卦是${r.ming.gua}命,屬${groupLabel(r.ming.group)}。`;
    body += `依傳統的八宅法,你個人的吉方是: 生氣位在${dirOf('生氣')}方、延年位在${dirOf('延年')}方、天醫位在${dirOf('天醫')}方。`;
    if (r.matchesHouse) {
      body += `你的命卦組別與房子(${zhai.name},${houseGroupLabel(zhai.group)})屬同一組,稱為命宅相配。`;
    } else {
      body += `你的命卦屬於${groupLabel(r.ming.group)},這間房子屬於${houseGroupLabel(zhai.group)},稱為命宅不配。傳統上的做法是以你自己的吉方為主來安排床頭、書桌與灶口,大門若不能動,至少讓大門、主臥、灶口三項中有一項落在你的吉方。`;
    }
    const near = r.ming.flags.nearLichun || r.ming.flags.dateIsLichunDay;
    cards.push(card({
      id: `card.ming.${r.id}`,
      headline: `${r.name}: ${r.ming.gua}命(${groupLabel(r.ming.group)})`,
      body,
      tag: 'source',
      confidence: near ? 'medium' : 'high',
      extraBadges: [r.matchesHouse ? '命宅相配' : '命宅不配'],
      footnote: null,
      subject: r.id,
    }));
  }
  if (rs.length > 1) {
    const fit = rs.filter((r) => r.matchesHouse).length;
    const list = rs.map((r) => `${r.name}是${r.ming.gua}命(${groupLabel(r.ming.group)})`).join('、');
    cards.push(card({
      id: 'card.ming.household',
      headline: '全家的命卦組別',
      body: `${list}。其中 ${fit} 位與房子的組別相配、${rs.length - fit} 位不配。家人的組別不同時,沒有一套吉方能同時配合所有人,本 App 預設以主要收入者為主安排大門,睡向優先照顧與房子組別不同的一方。`,
      schoolNote: '夫妻命卦不同組時各派做法不一,可以在設定改成其他做法。',
      tag: 'source',
      confidence: 'medium',
      footnote: null,
    }));
  }
  return cards;
}

function whereText(e) {
  if (e.kind === 'dark') return sectorText(e.sector);
  return `${ROOM_NAME[e.roomType] ?? '這個空間'}的${cornerText(e.corner)}`;
}

const STATUS_SHORT = Object.freeze({
  void_window: '角落有窗(財位見空)',
  void_floor_window: '角落有落地窗(財位見空)',
  blocked_opening: '角落有門或通道',
  blocked_walkway: '動線穿過角落',
});

function starTone(star) {
  return GOOD_BAZHAI.includes(star) ? '傳統上視為吉位' : '傳統上屬需要留意的位置';
}

function wealthTopCards(report) {
  const cards = [];
  const w = report.wealth;
  const names = new Map(report.bazhai.residents.map((r) => [r.id, r.name]));
  for (const e of report.summary.wealthTop) {
    const sec = e.sector ? w.sectors[e.sector] : null;
    const cand = e.kind === 'dark' ? null : w.candidates.find((c) => c.id === e.id);
    const parts = [];
    parts.push(TIER_SENTENCE[e.tier] ?? TIER_SENTENCE.notAdvised);
    if (e.kind === 'ming') parts.push('這是傳統上最通行的算法(依進門的位置與空間形狀),不論排名都會列出。');
    if (sec) {
      parts.push(`它落在${sectorText(e.sector)}。`);
      const st = sec.stars;
      const reasons = [];
      if (st.xiang !== null && st.xiang !== undefined && report.xuankong) reasons.push(`玄空盤上這一宮的山星是${STAR_NAME[st.shan]}、向星是${STAR_NAME[st.xiang]}`);
      if (st.house) reasons.push(`依房屋的宅卦,按遊年八星來看,這一方是「${st.house}」(${starTone(st.house)})`);
      for (const [pid, star] of Object.entries(st.people ?? {})) reasons.push(`依${names.get(pid) ?? '住戶'}的命卦,這一方是「${star}」(${starTone(star)})`);
      if (st.year) reasons.push(`今年飛到這一宮的星是${STAR_NAME[st.year]}${st.year === 5 || st.year === 2 ? '(需要留意,宜靜不宜動)' : ''}`);
      if (reasons.length) parts.push(`${reasons.join(';')}。`);
    }
    if (cand) {
      const issues = [];
      for (const d of cand.deductions) {
        if (d.kind === 'floor' || d.kind === 'reward') continue;
        if (!issues.includes(d.label)) issues.push(d.label);
      }
      // 角區有窗的扣分理由已經講了「財位見空」,不重複列狀態。
      const stat = STATUS_SHORT[cand.status];
      if (stat && !(cand.status.startsWith('void') && issues.some((l) => l.includes('財位見空')))) issues.unshift(stat);
      if (issues.length) parts.push(`需要先處理: ${issues.join('、')}。`);
    }
    if (e.borderline) parts.push(BORDERLINE_SENTENCE);
    parts.push('這是本 App 的排序方式,僅供整理空間的參考。');
    cards.push(card({
      id: `card.wealth.${e.id}`,
      headline: e.kind === 'dark' ? `${e.label}: ${whereText(e)}` : `${whereText(e)}(${e.label})`,
      body: parts.join(''),
      schoolNote: '排序只有星的先後順序有傳統依據,數字大小是本 App 的設計;標籤不可跨設定比較。',
      tag: 'design',
      confidence: 'low',
      level: e.tier === 'notAdvised' ? 'note' : 'info',
      extraBadges: [TIER_LABEL[e.tier]],
    }));
  }
  return cards;
}

function xuankongOverview(report) {
  const xk = report.xuankong;
  if (!xk) return [];
  const g = report.geo;
  const yunDiff = xk.meta.chartYun !== xk.meta.currentYun;
  let body = `這張盤用第 ${xk.meta.chartYun} 運起盤(依建成或遷入的時間),坐${g.sitMountain}山、向${g.facingMountain}山,格局是「${xk.pattern}」。`;
  body += `目前是第 ${xk.meta.currentYun} 運。這種排盤法叫玄空飛星,每個方位有山星、向星與運星三個數字,各方位的解讀列在下面。`;
  if (yunDiff) body += '起盤的運與今天的運不同,星的旺衰以今天的運來看。';
  body += '這是進階內容,實際勘宅需專業風水師親至現場。';
  return [card({
    id: 'card.xuankong.overview',
    headline: `玄空盤: ${xk.pattern}(第 ${xk.meta.chartYun} 運起盤)`,
    body,
    tag: 'source',
    confidence: xk.locate.zone === 'jian' || xk.locate.ridingLine ? 'medium' : 'high',
    schoolNote: '玄空有多個流派,這裡採中州派的下卦排法;兼向與替卦的做法各派不同。',
  })];
}

function dateWord(cst) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(cst);
  return m ? `${Number(m[1])}月${Number(m[2])}日` : cst;
}

function annualCards(report) {
  const a = report.annual;
  const cards = [];
  const y = a.year;
  const t = a.taisui;
  cards.push(card({
    id: 'card.annual.taisui',
    headline: `太歲在${dirText(t.dir)},歲破在${dirText(t.suipoDir)}`,
    body: `今年是${y.ganzhi}年(以立春為界,${dateWord(y.lichunCST)}換年)。太歲在${dirText(t.dir)}(${t.branch}山),歲破在正對面的${dirText(t.suipoDir)}(${t.suipo}山)。傳統上這兩個方位今年動土或大幅裝修要多留意。`,
    tag: 'source',
    confidence: 'high',
  }));
  cards.push(card({
    id: 'card.annual.sansha',
    headline: `三煞在${dirText(a.sansha.dir)}`,
    body: `今年的三煞在${dirText(a.sansha.dir)}(${a.sansha.mountains}三山)。傳統上這個方位今年比較忌動土,平時不必刻意避開,只是整修時多留意。`,
    tag: 'source',
    confidence: 'high',
  }));
  cards.push(card({
    id: 'card.annual.wuhuang',
    headline: `五黃在${dirText(a.annual.wuhuang)},二黑在${dirText(a.annual.erhei)}`,
    body: `今年的飛星,五黃落在${dirText(a.annual.wuhuang)},二黑落在${dirText(a.annual.erhei)}。傳統上這兩個方位宜靜不宜動,少動土、少放爐灶,保持整潔就好。`,
    tag: 'source',
    confidence: 'high',
  }));
  if (a.month) {
    const m = a.month;
    cards.push(card({
      id: 'card.annual.month',
      headline: `這個月的五黃在${dirText(m.wuhuang)},二黑在${dirText(m.erhei)}`,
      body: `月份以節氣為界,${dateWord(m.startCST)}到${dateWord(m.endCST)}是${m.ganzhi}月。這個月的五黃在${dirText(m.wuhuang)},二黑在${dirText(m.erhei)},每個月都會換位置。`,
      tag: 'source',
      confidence: 'high',
    }));
  }
  // 把今年的方位對照到你家的坐與向(本 App 的整理,不是傳統規則)
  const g = report.geo;
  const hits = [];
  const sitInSansha = a.sansha.arc.ranges.some((r) => inArc(g.sitBearing, r));
  const faceInSansha = a.sansha.arc.ranges.some((r) => inArc(g.bearing, r));
  if (faceInSansha) hits.push(`你家的向(${g.dir8}方)落在今年的三煞方`);
  if (sitInSansha) hits.push(`你家的坐(${g.zhaiSitDir}方)落在今年的三煞方`);
  const pairs = [
    ['太歲', a.taisui.gua],
    ['歲破', a.taisui.suipoGua],
    ['五黃', a.annual.wuhuangGua],
    ['二黑', a.annual.erheiGua],
  ];
  for (const [nm, gua] of pairs) {
    if (g.gua === gua) hits.push(`你家的向(${g.dir8}方)正好是今年${nm}所在的方位`);
    if (g.zhaiGua === gua) hits.push(`你家的坐(${g.zhaiSitDir}方)正好是今年${nm}所在的方位`);
  }
  if (hits.length) {
    cards.push(card({
      id: 'card.annual.house',
      headline: '今年的方位與你家坐向的對照',
      body: `${hits.join(';')}。傳統上這些方位今年動土、大裝修要多留意;這只是把今年的方位對照到你家坐向的整理,僅供參考。`,
      tag: 'design',
      confidence: 'low',
    }));
  }
  return cards;
}

// ─────────────────────────── 總覽文字 ───────────────────────────

function plainSummaryOf(report) {
  const s = report.summary;
  const g = report.geo;
  const paras = [];
  let p1 = `你家的坐向是${s.headline},房屋的宅卦是${s.zhai}(${houseGroupLabel(s.zhaiGroup)})。`;
  if (g.kongwangKind || g.retest) p1 += '量到的方向接近山與山的交界,建議重新量測。';
  paras.push(p1);

  if (s.residents.length > 0) {
    const list = s.residents.map((r) => `${r.name}是${r.gua}命(${groupLabel(r.group)})`).join('、');
    const fit = s.residents.filter((r) => r.matchesHouse).length;
    const tail = fit === s.residents.length ? '都和房子相配。' : fit === 0 ? '與房子的組別不同,建議以自己的吉方為主安排床頭、書桌與灶口。' : '有人與房子相配、有人不配,請看命卦那一段的說明。';
    paras.push(`住戶的命卦: ${list},${tail}`);
  } else {
    paras.push('目前沒有住戶資料,輸入出生日期與性別後會補上個人的命卦與吉方。');
  }

  const top = s.wealthTop[0];
  if (top) {
    paras.push(`財位的部分,目前排在最前面的是${top.label}: ${whereText(top)},標籤是「${TIER_LABEL[top.tier]}」(只是本 App 的整理排序,不保證任何結果)。`);
  }
  paras.push(`今年(${s.year.ganzhi}年)要留意: 五黃在${dirText(s.year.wuhuang)}、二黑在${dirText(s.year.erhei)},三煞在${dirText(s.year.sansha)}。`);
  if (s.cautions.length > 0) paras.push(`另有 ${s.cautions.length} 項需要留意的提醒,詳見各段說明。`);
  paras.push(CARD_DISCLAIMER);
  return paras.join('\n');
}

// ─────────────────────────── 主入口 ───────────────────────────

/**
 * 把 HouseReport 轉成結果頁文案(規格 5.3 的固定分段: 方位、命卦、財位、玄空、今年、傳統說法,頁底免責聲明)。
 * 所有分段都會出現(卡片可能為空,UI 自行隱藏);顯示文字已清掉內部代碼並做術語括號解釋,不含任何精確分數。
 * @param {import('./analyze.js').HouseReport} report analyzeHouse 的結果
 * @param {{sections?:string[], glossary?:boolean}} [opts] sections: 只輸出指定分段;glossary=false 關閉術語括號解釋
 * @returns {{
 *   sections: Array<{id:string, title:string, collapsed:boolean, cards:Array<{id:string, headline:string, body:string, schoolNote:(string|null),
 *     badges:string[], tag:string, confidence:string, level:string, footnote:(string|null), subject:(string|null), source:string}>}>,
 *   disclaimers: string[], plainSummary: string
 * }}
 * @throws {Error} INVALID_REPORT report 不是 analyzeHouse 的結果
 */
export function renderReport(report, opts = {}) {
  if (!isObj(report) || !isObj(report.geo) || !isObj(report.bazhai) || !isObj(report.summary) || !Array.isArray(report.findings)) {
    throw new Error('INVALID_REPORT: 需要 analyzeHouse 回傳的 HouseReport');
  }
  const o = opts ?? {};
  if (o.sections !== undefined && !(Array.isArray(o.sections) && o.sections.every((x) => SECTION_ORDER.includes(x)))) {
    throw new Error(`INVALID_OPTION: sections 只能是 ${SECTION_ORDER.join('、')} 的子集`);
  }
  const ctx = { nameOf: new Map(report.bazhai.residents.map((r) => [r.id, r.name])) };
  for (const s of report.bazhai.skipped ?? []) ctx.nameOf.set(s.id, s.name);

  const buckets = Object.fromEntries(SECTION_ORDER.map((id) => [id, { lead: [], found: [] }]));
  buckets.orientation.lead.push(...orientationCards(report));
  buckets.ming.lead.push(...residentCards(report));
  buckets.wealth.lead.push(...wealthTopCards(report));
  buckets.xuankong.lead.push(...xuankongOverview(report));
  buckets.annual.lead.push(...annualCards(report));

  report.findings.forEach((f, index) => {
    const fam = familyOfFindingId(f.id) ?? { key: 'other', section: 'traditional', order: 99, tone: 'auto' };
    const section = f.tag === 'minority' ? 'traditional' : fam.section;
    buckets[section].found.push({ f, fam, section, order: fam.order, index });
  });

  const explain = o.glossary !== false;
  const sections = [];
  const state = { explained: new Set() };
  for (const id of SECTION_ORDER) {
    if (o.sections && !o.sections.includes(id)) continue;
    const b = buckets[id];
    b.found.sort((x, y) => x.order - y.order || x.index - y.index);
    const cards = [...b.lead, ...b.found.map((x) => findingCard(x.f, x.fam, x.section, ctx))];
    if (explain) {
      for (const c of cards) {
        c.body = explainTerms(c.body, state);
        if (c.schoolNote) c.schoolNote = explainTerms(c.schoolNote, state);
      }
    }
    sections.push({ id, title: SECTION_META[id].title, collapsed: SECTION_META[id].collapsed, cards });
  }

  let plain = plainSummaryOf(report);
  if (explain) plain = explainTerms(plain, { explained: new Set() });
  return { sections, disclaimers: [...DISCLAIMERS], plainSummary: plain };
}

// ─────────────────────────── 簡單模式(docs/EASY_SPEC.md 8.9) ───────────────────────────
// 簡單模式與「手機指北針準嗎?」面板用的句子。全部由既有報告衍生或是量測說明,不新增任何風水判斷。

/**
 * 簡單模式財位卡的「怎麼找出來的」一句話(依 wealthTop[0] 的種類)。
 * ming = 從大門算的進門斜對角;mingRoom = 從某個房間自己的房門算的斜對角(不是從大門,要講清楚,免得使用者以為選錯大門位置)。
 */
export const EASY_METHOD = Object.freeze({
  ming: '傳統上認為進門後斜對角遠端的牆角是財位,這個角落就是這樣找出來的。',
  mingRoom: '傳統上也把「進房門後斜對角遠端的牆角」當作財位。這個角落是從這個房間自己的房門找出來的,不是從大門。',
  corner: '這是兩面都是實牆的牆角,位置比較穩。',
  dark: '這是依房子的方位推算出來的位置,不是房間裡的固定角落。',
});
export const EASY_TITLE = Object.freeze({ spot: '你家最值得留意的財位', dark: '目前比較有利的方位', none: '目前沒有特別突出的位置' });
export const EASY_NONE_SENTENCE = '目前沒有可以列出的財位。';
export const TIER_NOTE = '「較適合、可以考慮、不建議」只是本 App 的整理排序,不保證任何結果。';
export const EASY_DOOR_WHY = '傳統上常說的財位是進門後斜對角的牆角,所以大門在哪一邊通常會影響結果。';
/** 同一個格局,大門放左、中、右算出來排第一的位置都一樣時,取代 EASY_DOOR_WHY(免得使用者以為選錯了) */
export const EASY_DOOR_SAME = '這個格局不管大門在哪一邊,排第一的財位都在同一個角落,所以換邊結果不變,不是選錯了。';
/** 簡單模式:方向是自己選的 8 方位(只在「已記下」畫面顯示一次) */
export const EASY_PICK8_NOTE = '方向是你自己選的大方位,會用那個方位的正中間來算。';
/** 簡單模式結果頁「更多說明」(白話版;完整功能仍用 DISCLAIMERS) */
export const EASY_DISCLAIMERS = Object.freeze([
  '各家說法不一樣,本 App 用台灣最常見的「進門斜對角」說法。',
  '手機指北針附近有鐵門、鋼筋時可能不準。',
  '要更仔細,請找老師到現場看。',
]);
const softAdviceText = (id) => { const a = SOFT_ADVICE.find((x) => x.id === id); return a ? a.text : ''; };
/**
 * 簡單模式結果頁的一行「這樣用:」:取 SOFT_ADVICE 的整潔(前半句)、垃圾桶、鏡子三條組成,
 * 375px 寬一行放得下(完整清單收在「看詳細說明」)。
 */
export const EASY_USE_TIP = `這樣用:${softAdviceText('tidy').split(/[,,]/)[0]},${softAdviceText('noTrash')}、${softAdviceText('noMirror').replace(/^不放/, '')}`;
/** 羅盤頁鎖定後的一句短評(8 方位會不會受誤差影響)。 */
export const IMPACT_SHORT = Object.freeze({ ok: '對 8 個大方位:不影響。', near: '對 8 個大方位:接近分界,可能影響。' });

/** 這個明財位是不是從大門(entrance)算出來的;查不到門的資料時當作是 */
function mingFromMainDoor(report, top) {
  const layers = isObj(report.wealth) && isObj(report.wealth.layers) && Array.isArray(report.wealth.layers.ming) ? report.wealth.layers.ming : null;
  const layer = layers ? layers.find((l) => isObj(l) && l.roomId === top.roomId) : null;
  if (!layer || !isObj(layer.door) || typeof layer.door.kind !== 'string') return true;
  return layer.door.kind === 'entrance';
}

/**
 * 簡單模式結果頁的財位摘要。只從既有 report 衍生(wealthTop[0] 與 findings),不新增任何風水判斷。
 * @param {import('./analyze.js').HouseReport} report
 * @returns {{status:'ok'|'none', kind:'ming'|'mingRoom'|'corner'|'dark'|null, tier:string|null, tierLabel:string|null, title:string,
 *   sentences:string[], softTips:string[], tierNote:string, borderline:boolean}}
 */
export function renderEasySummary(report) {
  const top = isObj(report) && isObj(report.summary) && Array.isArray(report.summary.wealthTop) ? report.summary.wealthTop[0] : null;
  if (!isObj(top)) {
    return { status: 'none', kind: null, tier: null, tierLabel: null, title: EASY_TITLE.none, sentences: [EASY_NONE_SENTENCE], softTips: [], tierNote: TIER_NOTE, borderline: false };
  }
  const kind = top.kind === 'ming' ? (mingFromMainDoor(report, top) ? 'ming' : 'mingRoom') : top.kind === 'dark' ? 'dark' : 'corner';
  const tier = Object.prototype.hasOwnProperty.call(TIER_SENTENCE, top.tier) ? top.tier : 'notAdvised';
  const title = tier === 'notAdvised' ? EASY_TITLE.none : kind === 'dark' ? EASY_TITLE.dark : EASY_TITLE.spot;
  const sentences = [EASY_METHOD[kind], TIER_SENTENCE[tier]];
  if (top.borderline === true) sentences.push(BORDERLINE_SENTENCE);
  const hasTips = Array.isArray(report.findings) && report.findings.some((f) => f && f.id === 'wealth.soft.tips');
  return {
    status: 'ok',
    kind,
    tier,
    tierLabel: TIER_LABEL[tier],
    title,
    sentences,
    softTips: hasTips && kind !== 'dark' ? SOFT_ADVICE.map((a) => a.text) : [],
    tierNote: TIER_NOTE,
    borderline: top.borderline === true,
  };
}

/** 度數顯示:整數或一位小數,去掉 .0 */
const deg1 = (x) => String(Math.round(x * 10) / 10);

const IMPACT_TITLE = Object.freeze({
  sensor: '手機差幾度,會不會影響結果?',
  typed: '度數差一點,會不會影響結果?',
  pick8: '方向選得不夠準,會不會影響結果?',
});

/**
 * 「手機差幾度,會不會影響結果?」區塊。判斷全部由呼叫端算好傳入(copy.js 不 import UI 檔,門檻見 EASY_SPEC 2.4):
 * - eight = eightImpact(大門方位, U):大門朝哪一方會不會算到隔壁(origin 'pick8' 時不用,方位就是使用者選的)。
 * - wealth = 「方向差 U 度,排第一的財位會不會換」(easy/stability.js 的 wealthStability 整理後):
 *   null = 還沒選格局、算不出來;{ status:'stable', u };{ status:'changes', change:'place', place };
 *   { status:'changes', change:'tier', from, to }(from/to 是「較適合」這類標籤)。
 * origin:'sensor' 手機量的、'typed' 自己輸入度數、'pick8' 自己選的 8 方位。
 * @returns {{title:string, lines:Array<{icon:'✓'|'!'|'i', head:string, text:string}>}}
 */
export function renderDirectionImpact({ eight = null, wealth = null, origin = 'sensor' } = {}) {
  const o = origin === 'pick8' || origin === 'typed' ? origin : 'sensor';
  const lines = [];
  const retry = o === 'pick8' ? '可以按「重新量」用手機量一次,會比較確定。' : o === 'typed' ? '建議用手機或羅盤再量一次。' : '建議往旁邊走一大步再量一次。';
  if (isObj(wealth) && wealth.status === 'stable') {
    lines.push({
      icon: '✓',
      head: '財位在哪個角落',
      text: o === 'pick8'
        ? '不受影響。你選的這個大方位範圍裡,排第一的都是同一個角落。'
        : `不受影響。就算方向差 ${deg1(wealth.u)} 度,排第一的還是同一個角落。`,
    });
  } else if (isObj(wealth) && wealth.status === 'changes' && wealth.change === 'tier' && wealth.from && wealth.to) {
    lines.push({ icon: '!', head: '財位在哪個角落', text: `位置不變,但方向差幾度,評等可能從「${wealth.from}」變成「${wealth.to}」。${retry}` });
  } else if (isObj(wealth) && wealth.status === 'changes') {
    const where = wealth.place ? `,排第一的可能換成「${wealth.place}」` : ',排第一的可能換成另一個位置';
    lines.push({ icon: '!', head: '財位在哪個角落', text: `可能受影響。方向差幾度${where}。${retry}` });
  } else {
    lines.push({
      icon: 'i',
      head: '財位在哪個角落',
      text: '進門斜對角的那個角落,看的是大門在屋裡的位置,不看指北針。不過哪個角落排第一,也會參考方向;選好格局後,會再幫你檢查。',
    });
  }
  if (o !== 'pick8' && isObj(eight)) {
    lines.push(eight.near
      ? { icon: '!', head: '大門朝哪一方', text: `可能受影響。你家大門剛好在${eight.dir8}方和${eight.neighbor}方中間,差幾度就可能算成另一邊。${retry}` }
      : { icon: '✓', head: '大門朝哪一方', text: `不受影響。你家大門朝${eight.dir8}方,以差 ${deg1(eight.uncertaintyDeg)} 度來看,還是${eight.dir8}方。` });
  }
  return { title: IMPACT_TITLE[o], lines };
}

/**
 * 簡單模式結果頁:方向差 U 度,排第一的財位會換(依 wealthStability 的結果)。沒有要提醒的回 ''。
 * @param {{change:'place'|'tier'|null, place?:string, from?:string, to?:string, origin?:'sensor'|'typed'|'pick8'}} p
 */
export function renderStabilityNote({ change = null, place = '', from = '', to = '', origin = 'sensor' } = {}) {
  if (change === 'tier' && from && to) return `方向差幾度,這個位置的評等可能從「${from}」變成「${to}」。`;
  if (change !== 'place') return '';
  const where = place ? `「${place}」` : '另一個位置';
  return origin === 'pick8'
    ? `你是自己選大概的方位;真正的方向如果偏一點,排第一的財位可能換成${where}。用手機量一次會比較確定。`
    : `方向差幾度,排第一的財位可能換成${where}。建議回第 1 步再量一次。`;
}

/**
 * 「手機指北針準嗎?」面板的內容(EASY_SPEC 5.4)。最上面先給結論與三個做得到的檢查方法;
 * 度數、磁北真北、iPhone 內建指南針、分金等細節收在 details(畫面上是摺疊區)。
 * declinationDeg 為 null 時差距寫「4 到 5」;磁偏角東偏(正值)時「多/少」「大/小」依實際方向對調。
 * easy = 簡單模式(不提設定裡的誤差調整);cityName = 磁偏角用的城市名稱(沒有就不寫)。
 * @param {{trueMode?:boolean, declinationDeg?:number|null, measureUncertainty?:number, easy?:boolean, cityName?:string|null}} [p]
 * @returns {{title:string, items:Array<{head:string, body:string}>, details:{title:string, items:Array<{head:string, body:string}>}}}
 */
export function compassHonesty({ trueMode = false, declinationDeg = null, measureUncertainty = 5, easy = false, cityName = null } = {}) {
  const hasD = typeof declinationDeg === 'number' && Number.isFinite(declinationDeg);
  const d = hasD ? String(Math.floor(Math.abs(declinationDeg) + 0.5)) : '4 到 5';
  const east = hasD && declinationDeg > 0; // 東偏:磁北讀數比真北小
  const mu = typeof measureUncertainty === 'number' && Number.isFinite(measureUncertainty) && measureUncertainty >= 0 ? deg1(measureUncertainty) : '5';
  const where = hasD && typeof cityName === 'string' && cityName
    ? `在台灣大約差 4 到 5 度(目前用${cityName}的值,約 ${d} 度)`
    : `在台灣大約差 ${d} 度`;
  const iphone = '打開 設定 >(App >)指南針,看「使用真北」有沒有打開(需開啟定位服務)。';
  const items = [
    { head: '結論', body: '夠用。要知道大門朝哪一邊(東、南、西、北這 8 個方位),手機通常夠準;只有大門剛好朝在兩個方位中間時,App 會提醒你再量一次。財位在哪個角落,主要看大門在屋裡的位置;方向差幾度會不會換位置,結果頁會幫你檢查。' },
    { head: '怎麼自己檢查', body: '往旁邊走一大步再量一次,兩次都是同一個方位就比較放心。' },
    { head: '用地圖對一次', body: '打開 Google 地圖,先按右上角的小指北針,讓地圖轉回北在上面。找到你家,看大門面對的那條街在房子的哪一邊(東、南、西、北)。跟 App 說的方位一樣,就對了。(不要看地圖上的藍色箭頭,那也是用手機的指北針。)' },
    { head: '量不準時', body: '拿著手機在空中慢慢畫幾個 8 字,再離鐵門、冰箱、冷氣遠一點。' },
  ];
  const details = [
    { head: '大概的誤差', body: `手機指北針平常大約有 5 到 10 度的誤差;靠近鐵門、鋼筋、冷氣或磁吸手機殼時會更大。本 App 預設以 ${mu} 度當作誤差來提醒你${easy ? '。' : '(可在設定的「手機量測的誤差」調整)。'}` },
    { head: '差幾度會換方位', body: '8 個大方位每個 45 度寬。手機差 5 度時,大約 8 成的方向還在同一個大方位;差到 10 度時,大約只剩一半。玄空飛星(有填建成年份才會用到)把一圈分成 24 格、每格只有 15 度,更容易跨格,完整功能的報告會標示建議再確認。' },
    { head: '「很穩」不等於「很準」', body: `訊號格只看得出手有沒有在晃,看不出整棟大樓的鋼筋讓每次讀數一起偏。所以建議往旁邊移一步再量一次,兩次差不到 ${mu} 度就比較放心。` },
    { head: 'iPhone 和 Android 不一樣', body: 'iPhone 會提供它自己估計的誤差,畫面會寫「手機自己估計,可能差幾度左右」,App 也會把它算進去;Android 手機在網頁裡拿不到這個數字,只能從讀數晃不晃來判斷。' },
    {
      head: '磁北和真北',
      body: trueMode
        ? '本 App 目前設定用「真北」,和手機地圖一樣。'
        : `本 App 用「磁北」,和傳統羅盤一樣;地圖用「真北」。兩者${where},所以同一個方向,本 App 的度數會比地圖大約${east ? '少' : '多'} ${d} 度。用地圖看東南西北時,這點差距通常不影響。`,
    },
    {
      head: '跟 iPhone 內建「指南針」比',
      body: `內建「指南針」和本 App 用的是同一個感測器,只能拿來檢查本 App 的設定,看不出手機本身準不準。${iphone}${trueMode
        ? `有打開:兩邊應該差不多;沒打開:iPhone 的數字會比本 App ${east ? '小' : '大'}約 ${d} 度。`
        : `有打開:iPhone 的數字會比本 App ${east ? '大' : '小'}約 ${d} 度;沒打開:兩邊應該差不多。`}扣掉這個差距後,兩邊差 2 度以內都正常;差更多,多半是北基準的設定不一樣。`,
    },
    { head: '用地圖比時差多少算正常', body: '看地圖上的街道或房子的邊來比方向時,差 10 度以內都算正常。' },
    { head: '需要更精確時', body: '手機最細只能看到 24 格這一級,而且靠近格線時仍要再確認;更細的格子(例如分金),或「兼向」「空亡」這類要準到 2 度左右的判斷,請找老師用實體羅盤確認。' },
  ];
  return { title: '手機指北針準嗎?', items, details: { title: '給想知道細節的人', items: details } };
}

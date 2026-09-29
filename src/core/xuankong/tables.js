// xuankong 的常數與資料表。24 山、卦、元龍、陰陽只從 geo.js 的 MOUNTAINS 生成(規格 2.4.1、D23),
// 不另外手打;替星表、城門表、星組合表等規格內嵌資料照規格 2.4 抄錄,測試以「規則重算 == 內嵌表」防手誤(規格 4.2 第 6 點)。
import { MOUNTAINS, LUOSHU } from '../geo.js';

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

// ─────────────────────────── 宮位與飛布 ───────────────────────────

/** 宮位名,洛書數 1..9 的順序(下標 = 洛書數 - 1);'中' 是中宮。內部識別一律用這些名稱(規格 1.3)。 */
export const PALACES = Object.freeze(
  Object.entries(LUOSHU)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name),
);

/** 飛布宮序(洛書數): 中5 乾6 兌7 艮8 離9 坎1 坤2 震3 巽4(規格 2.4.1)。 */
export const FLY_ORDER = Object.freeze([5, 6, 7, 8, 9, 1, 2, 3, 4]);
/** 同上,宮位名。 */
export const FLY_PATH = Object.freeze(FLY_ORDER.map((n) => PALACES[n - 1]));

/** 元龍代碼: 0 地 1 天 2 人(規格 2.4.1 RING 的第三欄)。 */
const DRAGON_CODE = Object.freeze({ 地元: 0, 天元: 1, 人元: 2 });

/**
 * 24 山環,自壬起順時針: [山名, 洛書宮數, 元龍(0地 1天 2人)]。由 geo 的 MOUNTAINS 旋轉生成(壬是 index 23)。
 * @type {ReadonlyArray<readonly [string, number, number]>}
 */
export const RING = Object.freeze(
  [MOUNTAINS[23], ...MOUNTAINS.slice(0, 23)].map((m) => Object.freeze([m.name, LUOSHU[m.gua], DRAGON_CODE[m.dragon]])),
);

/** 洛書數 → 宮位名。 */
export const palaceOfStar = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error(`INVALID_STAR: 星數必須是 1..9 的整數: ${typeof n === 'string' ? JSON.stringify(n) : String(n)}`);
  return PALACES[n - 1];
};

// ─────────────────────────── 替星表(規格 2.4.1) ───────────────────────────

/**
 * 替星表。A = 蔣大鴻歌訣/沈氏/中州派/Wikibooks(信心: 高,四個獨立來源逐山吻合);
 * B = 陳澤泰《陽宅鏡》無常派(信心: 中,只見無常派)。A 表實際改變數字的只有 13 山。
 */
export const TI_TABLES = Object.freeze({
  A: Object.freeze({
    子: 1, 癸: 1, 甲: 1, 申: 1,
    壬: 2, 卯: 2, 乙: 2, 未: 2, 坤: 2,
    乾: 6, 亥: 6, 辰: 6, 巽: 6, 巳: 6, 戌: 6,
    酉: 7, 辛: 7, 丑: 7, 艮: 7, 丙: 7,
    寅: 9, 午: 9, 庚: 9, 丁: 9,
  }),
  B: Object.freeze({
    坤: 2, 壬: 2, 乙: 2,
    艮: 7, 丙: 7, 辛: 7,
    巽: 6, 辰: 6, 亥: 6,
    甲: 1, 癸: 1, 申: 1,
    丑: 9, 丁: 9, 酉: 9,
    巳: 4, 戌: 4, 乾: 4,
    子: 3, 卯: 3, 未: 3,
    庚: 8, 午: 8, 寅: 8,
  }),
});

// ─────────────────────────── 格局名稱 ───────────────────────────

/** 四大格局名,鍵為 `${山盤順逆}${向盤順逆}`('+' 順、'-' 逆,規格 2.4.5)。 */
export const PATTERN_BY_DIRECTIONS = Object.freeze({
  '--': '旺山旺向',
  '++': '上山下水',
  '-+': '雙星會坐',
  '+-': '雙星會向',
});
export const PATTERN_NAMES = Object.freeze(['旺山旺向', '上山下水', '雙星會坐', '雙星會向']);

// ─────────────────────────── 城門(規格 2.4.6) ───────────────────────────

/**
 * 城門表 CHENGMEN[向宮洛書數] = [正城門, 副城門](洛書數)。
 * 規則: 向宮在八卦環上相鄰的兩宮,與向宮成河圖生成數(1-6、2-7、3-8、4-9)者為正。
 * 只顯示不進主評分(D32,showChengmen)。
 */
export const CHENGMEN = Object.freeze({
  9: Object.freeze([4, 2]),
  1: Object.freeze([6, 8]),
  3: Object.freeze([8, 4]),
  7: Object.freeze([2, 6]),
  6: Object.freeze([1, 7]),
  8: Object.freeze([3, 1]),
  4: Object.freeze([9, 3]),
  2: Object.freeze([7, 9]),
});

// ─────────────────────────── 九星資料(xuankong_patterns.md 2.1,信心: 高) ───────────────────────────

/**
 * 九星。nature 的字串沿用 fixtures star_dict 的寫法;wang/shuai 為「得令/失令象意」摘要。
 * 陰陽星: 2、4、7、9 為陰;1、3、6、8 為陽(SOHU-469457756)。顏色為工程決定,非來源。
 */
export const STAR_INFO = Object.freeze({
  1: Object.freeze({ name: '一白', alias: '貪狼', element: '水', color: '白', trigram: '坎', direction: '北', nature: '吉', yinyang: '陽', wang: '得令利文才', shuai: '失令主腎、婦科、生育' }),
  2: Object.freeze({ name: '二黑', alias: '巨門', element: '土', color: '黑', trigram: '坤', direction: '西南', nature: '凶(病符)', yinyang: '陰', wang: '得令主田莊之富', shuai: '失令脾胃腸疾' }),
  3: Object.freeze({ name: '三碧', alias: '祿存', element: '木', color: '碧', trigram: '震', direction: '東', nature: '凶(蚩尤,是非)', yinyang: '陽', wang: '得令剛毅活潑', shuai: '失令好勇鬥狠、手足傷' }),
  4: Object.freeze({ name: '四綠', alias: '文曲', element: '木', color: '綠', trigram: '巽', direction: '東南', nature: '吉(文昌)', yinyang: '陰', wang: '得令主文章、長女端妍', shuai: '失令風流、破家' }),
  5: Object.freeze({ name: '五黃', alias: '廉貞', element: '土', color: '黃', trigram: '中', direction: '中', nature: '大凶(當運時可用)', yinyang: null, wang: '當旺大發財丁', shuai: '失令為病毒星' }),
  6: Object.freeze({ name: '六白', alias: '武曲', element: '金', color: '白', trigram: '乾', direction: '西北', nature: '吉', yinyang: '陽', wang: '得令權威武職', shuai: '失令刑妻孤單' }),
  7: Object.freeze({ name: '七赤', alias: '破軍', element: '金', color: '赤', trigram: '兌', direction: '西', nature: '小凶(得令發武貴)', yinyang: '陰', wang: '得令財丁兩旺', shuai: '失令牢獄劫盜、色慾' }),
  8: Object.freeze({ name: '八白', alias: '左輔', element: '土', color: '白', trigram: '艮', direction: '東北', nature: '吉(財星)', yinyang: '陽', wang: '得令富貴綿遠、孝義', shuai: '失令傷小口' }),
  9: Object.freeze({ name: '九紫', alias: '右弼', element: '火', color: '紫', trigram: '離', direction: '南', nature: '吉(喜慶)', yinyang: '陰', wang: '得令女子興旺、發家', shuai: '失令火災、目疾' }),
});

/**
 * 九運的九星落宮模板(xuankong_patterns.md 1.9 B 表,規格 2.4.13;山星 = 丁/健康/床位桌位,向星 = 財/門窗氣口)。
 * 只適用 currentYun=9;其他運沒有來源的逐星模板,結果頁改用 STAR_INFO 的通用說法。
 * 依規格更正: 四綠欄刪除「四四仍是文昌位」(四四已移除文昌標籤,規格 2.4.9);用語依規格 5.1 改成溫和說法。
 * level 是 Finding 的層級;八白的「山向外側見高山或大水不利」是單一作者說法。
 */
export const STAR_YUN9 = deepFreeze({
  9: { state: '旺', level: 'info', text: '九紫是當令的旺星。', plate: { 山星: '山星傳統上主添丁與喜慶。', 向星: '向星是當旺的財星,宜開門窗、放乾淨的動水催財。' }, use: '客廳、主臥、旺丁房、廚房', avoid: '雜物堆積、長期暗悶' },
  1: { state: '近旺生氣', level: 'info', text: '一白是次旺的生氣星,傳統上主人緣與文昌。', plate: { 山星: '山星是次旺的人丁星。', 向星: '向星是次旺的財星。' }, use: '書房(遇四綠或六白更佳)、臥室、客廳', avoid: '與五黃同宮、與八白同宮' },
  2: { state: '遠旺生氣', level: 'note', text: '二黑是遠旺的生氣星,可用,但本性仍是病符星;與五黃同宮就是二五交加。', plate: {}, use: '輔助空間、客廳', avoid: '久居的臥室、與五黃同宮' },
  8: { state: '退氣', level: 'note', text: '八白剛退運,平常、不旺不衰,不用刻意催旺。單一作者說法: 山向外側見高山或大水反而不利。', plate: {}, use: '一般臥室、客廳', avoid: '大興土木刻意催旺' },
  7: { state: '煞衰', level: 'note', text: '七赤已失令,傳統上宜靜不宜動,尤其是大門口。', plate: {}, use: '儲藏、衛生間', avoid: '大門、常動的空間' },
  6: { state: '煞衰', level: 'note', text: '六白已失令,傳統上怕尖角沖射與火;與九紫同宮要謹慎(火燒天門)。', plate: {}, use: '書房(與一白同宮成文昌)', avoid: '廚房火位、與九紫同宮' },
  5: { state: '煞', level: 'caution', text: '五黃是傳統上需要特別留意的星,宜靜不宜動: 少動土、少開門窗、不放爐灶。', plate: {}, use: '雜物間、衛生間', avoid: '臥室、廚房、大門' },
  4: { state: '死氣', level: 'note', text: '四綠已失令,但本性是文昌星,一四組合仍是文昌位。', plate: {}, use: '書房、學生房', avoid: '與五黃、七赤同宮' },
  3: { state: '死氣', level: 'note', text: '三碧已失令,傳統上與口舌是非有關;與七赤同宮、與二黑同宮都要留意。', plate: {}, use: '儲藏、衛生間', avoid: '臥室、辦公桌' },
});

// ─────────────────────────── 九星旺衰(五氣,規格 2.4.8) ───────────────────────────

/**
 * 五氣標籤,下標 d = (星 - 當運) mod 9。default 泛化自九運公開標法(SINA-HESHI 逐宮標法獨立佐證);
 * S1 = SOHU-478153604 八運(8旺 9進 1生 765退 432死);S2 = GENDAI 八運(9生 1進 7退 6衰 5死 432煞)。
 * 三套對 d=0/1/2/8 一致,分歧在 d=3..7。
 */
export const QI_SCHEMES = Object.freeze({
  default: Object.freeze(['旺', '近旺生', '遠旺生', '死', '死', '煞衰', '煞衰', '煞衰', '退']),
  S1: Object.freeze(['旺', '進', '生', '死', '死', '死', '退', '退', '退']),
  S2: Object.freeze(['旺', '生', '進', '煞', '煞', '煞', '死', '衰', '退']),
});

/** 標籤全名(規格 2.4.8 表)。fixtures 沿用簡稱。 */
export const QI_LABEL_TEXT = Object.freeze({
  旺: '旺(當令)', 近旺生: '近旺生氣', 遠旺生: '遠旺生氣', 退: '退氣', 煞衰: '煞衰', 死: '死氣',
  進: '進氣', 生: '生氣', 衰: '衰氣', 煞: '煞氣',
});

/**
 * 預設分數,下標 d。**工程值(非來源,信心: 低)**: 5 黃在非五運 ≤ -3、2 黑在非二運 ≤ +0.5 的上限在 qiScore 內處理。
 * 分數只依距離 d,不隨 qiScheme 改變: 規格對 S1/S2 沒有給分數,只給標籤。
 */
export const QI_SCORE_BY_D = Object.freeze([3, 2, 1, -2, -2, -1, -1, -1, 0]);

// ─────────────────────────── 星組合(規格 2.4.9 已更正版) ───────────────────────────

/**
 * 星組合表(鍵為小數在前的 'a-b')。逐項核對 36FS zs37-zs42 後的版本。
 * exceptYun: 這些運當令不扣分(二五交加,D36)。組合調整分: 吉 +0.5、凶 -1、視旺衰/存疑 0。
 */
export const PAIR_TAGS = deepFreeze({
  '2-5': { tag: '二五交加', nature: '凶', exceptYun: [2, 5], confidence: 'high' },
  '3-7': { tag: '三七蚩尤煞', alias: ['三七迭至(賊匪官災)', '三七穿心煞(民間別名,未驗證)'], nature: '凶', confidence: 'high' },
  '6-7': { tag: '六七交劍煞', nature: '凶', confidence: 'high' },
  '7-9': { tag: '七九火災', nature: '凶', confidence: 'high' },
  '2-3': { tag: '三二鬥牛煞', nature: '凶', confidence: 'high' },
  '2-7': { tag: '二七同宮', nature: '凶', confidence: 'medium' },
  '3-5': { tag: '三五戊己大煞', nature: '凶', confidence: 'medium' },
  '5-7': { tag: '五七毒藥', nature: '凶', confidence: 'medium' },
  '5-9': { tag: '五九(火生五黃)', nature: '凶', confidence: 'low', note: '火生土催旺五黃;不設爐灶為推論' },
  '1-5': { tag: '一五山臨五黃(不宜安床)', nature: '凶', confidence: 'low' },
  '6-9': { tag: '六九火燒天門', nature: '視旺衰', confidence: 'medium', note: '六白得令或見八白反吉' },
  '1-4': { tag: '一四文昌', nature: '吉', confidence: 'high', note: '得令主科發;失令為四蕩一淫,主風流' },
  '1-6': { tag: '一六(水金相生;失令主水淫天門)', nature: '視旺衰', confidence: 'medium', wenchang: false },
  '3-9': { tag: '三九文昌(木火通明;個性偏刻薄)', nature: '吉', confidence: 'low' },
  '4-4': { tag: '四四(失令偏凶,存疑)', nature: '存疑', confidence: 'low', wenchang: false },
  '1-9': { tag: '一九水火既濟', nature: '吉', confidence: 'medium', note: '得運吉,失令婚姻/心眼之疾' },
  '6-8': { tag: '六八富貴', nature: '吉', confidence: 'medium' },
  '2-6': { tag: '二六財利', nature: '吉', confidence: 'medium' },
  '7-8': { tag: '七八富(八七破財)', nature: '吉', confidence: 'medium' },
  '8-9': { tag: '八九輔弼相輝', nature: '吉', confidence: 'medium' },
});

// ─────────────────────────── 形巒條件矩陣(規格 2.4.11,信心: 高) ───────────────────────────

/**
 * 四格局的形巒配合(SOHU-912417602、36FS zs31、CAF-series 一致)。雙星會坐的「偏一邊」兩派程度不同(D35):
 * SOHU-912417602 較嚴厲,CAF-series 與 36FS zs31 溫和;預設顯示溫和版並附註另一派。
 */
export const FORM_MATRIX = deepFreeze({
  旺山旺向: { ideal: '坐實朝空: 後有山、前有水或空曠', off: '反過來(坐水朝山)損丁破財' },
  上山下水: { ideal: '坐空朝滿: 後有水或空、前有山', off: '反過來損丁破財' },
  雙星會向: { ideal: '向首有水,水外有山: 丁財兩旺', off: '有水無山旺財不旺丁;有山無水旺丁不旺財' },
  雙星會坐: {
    ideal: '坐後有水環抱,水外有山: 丁財兩旺;坐後不宜見大水',
    off: '有水無山旺財不旺丁;有山無水旺丁不旺財(溫和版)',
    offStrict: '有水無山發財不發丁;有山無水破財克妻(SOHU-912417602,較嚴厲)',
  },
});

/** 文昌位只採一四(high)與三九(low,帶但書);一六與四四不當文昌依據(規格 2.4.9)。 */
export const WENCHANG_KEYS = Object.freeze({ '1-4': 'high', '3-9': 'low' });

/** 財位模組計分時,財星在後方(wealthSide='back')的宮玄空分量乘此係數(設計值,信心: 低,規格 2.4.10)。 */
export const BACK_WEALTH_FACTOR = 0.5;

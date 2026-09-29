// wealth 的 Finding 文案(規格 1.4、5.1)。每個結論都帶 tag 與信心: 「傳統上認為…」(source)、
// 推論(inference)、本 App 的排序方式(design)、少數派(minority)。不恐嚇、不做因果斷言、不用分數當結論。
import { dirOfGua } from '../geo.js';
import { SOFT_ADVICE } from './constants.js';

const REF = 'DOMAIN_SPEC.md#2.6';

/** @returns {import('../geo.js').Finding} */
export function finding(id, level, title, body, confidence, tag, schoolNote = null, refs = [REF]) {
  return { id, level, title, body, confidence, tag, schoolNote, refs };
}

export const ROOM_NAME = Object.freeze({ living: '客廳', bedroom: '臥室', study: '書房', other: '這個空間', entry: '玄關', kitchen: '廚房', toilet: '廁所', balcony: '陽台', stair: '樓梯' });
export const CORNER_NAME = Object.freeze({ BL: '左下角', BR: '右下角', TR: '右上角', TL: '左上角' });

/** 平面圖上的角落白話(矩形用左右上下,多邊形用頂點編號)。 */
export const cornerText = (name) => CORNER_NAME[name] ?? `第 ${Number(String(name).slice(1)) + 1} 個轉角`;
export const sectorText = (gua) => `${gua}宮(${dirOfGua(gua)}方)`;

const pct = (x) => `${Math.floor(x * 100 + 0.5)}%`;

export function overviewFinding() {
  return finding(
    'wealth.layers.overview',
    'info',
    '財位有四種層次',
    '傳統上財位有四種看法: 明財位(依空間形狀,房屋使用期間固定)、暗財位(依房屋方位與星盤推算,八宅固定、玄空一個運約 20 年)、流年財位(每年立春換)、本命財位(依住戶命卦,終身)。下面分開列出,時間性不同,不要混為一談。',
    'high',
    'source',
    '專業玄空派(吳尚易)主張「財位絕對不是進門斜對角」,與坊間通俗說法對立。本 App 預設兩者都算,以台灣最通行的「明財位」為主檔,可在設定切換到玄空檔。',
  );
}

export function mingCornerFinding({ roomId, roomType, corner, role, tied, sector, kind, dragonOnly }) {
  const where = `${ROOM_NAME[roomType] ?? '這個空間'}的${cornerText(corner)}`;
  const parts = [`傳統上認為進門後斜對角遠端的牆角是明財位。以進門的門為準,${where}是明財位`];
  if (tied) parts.push(role === 'primary' ? '(門開在牆的中央附近,左右兩個遠端角都算,這一角排在前面)' : '(門開在牆的中央附近,左右兩個遠端角並列)');
  parts.push('。');
  if (sector) parts.push(`這個角落落在${sectorText(sector)}。`);
  return finding(
    `wealth.ming.${roomId}.${corner}`,
    'info',
    `明財位: ${where}${tied && role !== 'primary' ? '(並列)' : ''}`,
    parts.join(''),
    kind === 'polygon' ? 'low' : 'high',
    kind === 'polygon' ? 'design' : 'source',
    dragonOnly
      ? '目前設定為「門居中只取龍邊」(進門者右手邊),這是少數說法(MyGoNews 2010)。'
      : tied
        ? '多數來源認為門居中時左右兩角並列;少數說法(MyGoNews 2010)只取龍邊(進門者右手邊)一角,可在設定開啟。'
        : kind === 'polygon'
          ? '非矩形空間取「內角剛好 90 度、室內走路最遠」的角落,各來源的說法是拆成兩個矩形,做法不同,信心較低。'
          : null,
  );
}

const STATUS_TEXT = {
  void_window: ['caution', '角區有窗,傳統上稱「財位見空」', '傳統上明財位派認為角落有窗,氣容易外流;常見的做法是用矮櫃、窗簾或屏風做成「人工實角」。這裡把這個位置的分數乘 0.5(設計值)。', 'medium', 'source', '玄空派(吳尚易)相反,主張旺位需要開窗納氣,可在設定切換到玄空檔。'],
  void_floor_window: ['caution', '角區有落地窗,傳統上稱「財位見空」', '傳統上明財位派認為落地窗佔據財位;常見的做法是在窗前放高度到窗台的矮櫃或書架,再加不透光窗簾,做成「人工實角」。這裡把這個位置的分數乘 0.5(設計值)。', 'medium', 'source', '玄空派(吳尚易)相反,主張旺位需要開窗納氣,可在設定切換到玄空檔。'],
  qi_intake_ok: ['info', '角區有窗,玄空派視為納氣', '玄空派認為旺星位需要開門窗納氣,所以不扣分(這裡乘 1.05,設計值)。', 'low', 'source', '明財位派看法相反,稱為「財位見空」並建議補實。'],
  blocked_opening: ['caution', '角區有門或通道,這個角落不成立', '傳統上認為財位不宜是走道或開門的地方,這個角落不作為明財位,建議改看暗財位(八宅、玄空、流年、本命)。', 'medium', 'source', null],
  blocked_walkway: ['caution', '動線穿過角區,這個角落不成立', '傳統上認為財位不宜是走道,這個角落不作為明財位,建議改看暗財位,或用屏風、矮櫃把動線隔開。', 'medium', 'source', null],
};

export function statusFinding(candidateId, status) {
  const t = STATUS_TEXT[status];
  if (!t) return null;
  return finding(`wealth.ming.status.${candidateId}`, t[0], t[1], t[2], t[3], t[4], t[5]);
}

/**
 * 明財位候選的扣分或排除理由(每個環境旗標一則)。排除級不作推薦並提示改看次選;扣分級乘數是設計值。
 * @param {string} candidateId
 * @param {{flag:string, kind:string, multiplier:number, label:string, reason:string, confidence:string}} d scoreLocation 的 deductions 項
 */
export function deductionFinding(candidateId, d) {
  if (d.kind === 'exclude') {
    return finding(
      `wealth.ming.excluded.${candidateId}.${d.flag}`,
      'caution',
      `${d.label},這個位置不宜作財位`,
      `${d.reason}。這個角落不作為推薦的財位,分數記為 0,建議改看次選(候選中排名下一個的位置)或暗財位。`,
      d.confidence,
      'source',
      d.flag === 'stairs' ? '樓梯作為排除條件只有單一來源(搜狐),信心較低。' : null,
    );
  }
  return finding(
    `wealth.ming.deduction.${candidateId}.${d.flag}`,
    'note',
    d.label,
    `${d.reason}。這裡把這個位置的分數乘 ${d.multiplier}(設計值),補救後可重新評估。`,
    d.confidence,
    'source',
    '乘數大小是本 App 的設計值,來源只支持「有這項問題」,沒有給數字。',
  );
}

export const noDoorFinding = () =>
  finding('wealth.ming.no_door', 'note', '沒有門的資料,只能給暗財位', '明財位要有進入空間的那扇門才算得出來。目前沒有門的資料,所以只列出暗財位(八宅、玄空、流年、本命),不列明財位。', 'high', 'design');

export const noPlanFinding = () =>
  finding('wealth.plan.missing', 'note', '沒有平面圖,只能給暗財位', '沒有平面圖就無法找出房間的角落,這裡只列出各方位的暗財位分數。', 'high', 'design');

export const planUpUnknownFinding = () =>
  finding('wealth.plan.up_unknown', 'note', '平面圖的方位未知,只做形狀分析', '不知道平面圖上方對應的方位,無法判斷角落落在哪個宮位,所以只列出明財位的形狀位置,不算分數。', 'high', 'design');

export function doorChongFinding({ roomId, level, ratio, frontId, oppositeId }) {
  if (level === 'chong') {
    return finding(
      `wealth.door.chong.${roomId}`,
      'caution',
      '大門與對面的開口成一直線(門沖)',
      `大門(${frontId})與對面牆的開口(${oppositeId})沿牆的重疊約 ${pct(ratio)}(以較窄的一個為準),兩者之間沒有遮擋。傳統上稱為「氣來直去」,常見的做法是用玄關、屏風或櫃體遮擋。「漏財」是象徵性的說法,沒有科學證據,這裡只當動線與隱私的提醒。`,
      'low',
      'source',
      '門檻(重疊 80% 以上)是本 App 的設計值,來源只說「幾乎完全成一直線」。',
    );
  }
  return finding(
    `wealth.door.slight.${roomId}`,
    'note',
    '大門與對面的開口略有錯開(輕微偏移)',
    `大門(${frontId})與對面牆的開口(${oppositeId})沿牆的重疊約 ${pct(ratio)},沒有到成一直線的程度,不判為門沖。`,
    'low',
    'design',
    '門檻(50% 到 80% 為輕微偏移)是本 App 的設計值。',
  );
}

export function bazhaiFinding({ houseName, facingDir, order }) {
  const [a, b, c] = order;
  return finding(
    'wealth.bazhai.gate',
    'info',
    `大門朝${facingDir}: ${houseName},生氣位在${a.dir}方`,
    `傳統上依大門朝向定出宅卦(${houseName}),再看遊年八星,財運面以生氣位為主(${a.dir}方),延年位(${b.dir}方)次之,天醫位(${c.dir}方)再次之。這一層固定,不隨年份變。`,
    'medium',
    'source',
    '延年與天醫的先後沒有明確來源,這裡是設計值;港派把天醫看得較高,可在設定對調。',
    ['DOMAIN_SPEC.md#2.6.4', 'DOMAIN_SPEC.md#2.3'],
  );
}

export function xuankongFinding({ chartYun, currentYun, pattern, cells }) {
  const line = (label, c) => (c.atCenter ? `${label}: 落在中宮` : `${label}: ${c.dir}方(向星 ${c.xiang}、山星 ${c.shan})`);
  return finding(
    'wealth.xuankong.cells',
    'info',
    `玄空財位(${pattern},${chartYun}運盤)`,
    `傳統上山星看人丁、向星看財,財位優先看向盤。以目前的運(${currentYun}運)來看,${line('當旺財星', cells.primary)};${line('次要', cells.secondary)};${line('退氣', cells.tertiary)}(退氣財星傳統上不宜見大水)。`,
    currentYun === 9 ? 'medium' : 'low',
    currentYun === 9 ? 'source' : 'inference',
    '玄空排盤有替卦、兼向的分歧,這裡只採用玄空模組的結果;沒有替卦與兼向時較確定。',
    ['DOMAIN_SPEC.md#2.6.4', 'DOMAIN_SPEC.md#2.4.10'],
  );
}

export const xuankongBackFinding = (cell) =>
  finding(
    'wealth.xuankong.back',
    'caution',
    '旺財星在坐宮(後方)',
    `${cell.dir}方是這張盤的坐宮,當旺的向星落在後方。傳統上說財星在後方,需要後方見水或動水才有財,所以這裡不把它列為旺財位,計分時把這一宮的玄空分量減半(設計值)。`,
    'medium',
    'source',
    '這是玄空(中州派)說法,各派定義不同。',
    ['DOMAIN_SPEC.md#2.4.10'],
  );

export const xuankongMissingFinding = () =>
  finding('wealth.xuankong.missing', 'note', '沒有建成時間,略過玄空財位', '玄空財位要知道房屋建成(或入運)屬於哪一運才排得出盤。目前沒有這項資料,玄空分量記為 0,分數上限因此降低。', 'high', 'design');

export function annualFinding({ layer }) {
  const by = (star) => layer.wealthStars.find((w) => w.star === star);
  const at = (star) => `${by(star).name}在${by(star).dir}`;
  return finding(
    'wealth.annual.stars',
    'info',
    `${layer.fengshuiYear}年(${layer.ganzhi})的流年財星`,
    `流年以立春為界換年(不是元旦)。傳統上八白是正財星,今年${at(8)};一白與六白是偏財星,今年${at(1)}、${at(6)};九紫是當運的旺星,今年${at(9)},這裡算加分,並非傳統上的財星。這一層一年有效。`,
    'medium',
    'source',
    '九紫加分只能用「九運當旺」推論;四綠只有少數來源列為財星,分數為設計值。',
    ['DOMAIN_SPEC.md#2.6.9', 'DOMAIN_SPEC.md#2.6.7'],
  );
}

export const eightWhiteBoostFinding = (dir, boost) =>
  finding(
    'wealth.annual.eight_white_boost',
    'info',
    `八白位(${dir}方)的擺設說法`,
    `民俗上八白屬土,在八白位擺放土屬性或火屬性(火生土)的物件被認為有助催旺,例如黃水晶、陶土擺飾(${boost.elements.join('、')})。所有擺設都是民俗或象徵性質,不宣稱有科學效果。`,
    'medium',
    'source',
    '只有八白有直接來源(三六風水、DesignHouse);其他星的五行催旺是外推,沒有獨立來源。',
  );

export const badStarOnMingFinding = (candidateId, star, sector) =>
  finding(
    `wealth.annual.bad_on_ming.${candidateId}`,
    'caution',
    `今年${star === 5 ? '五黃' : '二黑'}飛到這個角落所在的宮`,
    `這個角落在${sectorText(sector)},今年${star === 5 ? '五黃' : '二黑'}飛到這一宮。傳統上這顆星宜靜不宜動,這一宮今年建議少動土、保持整潔;分數已依流年星值扣分。`,
    'low',
    'design',
    '來源只有一般說法,沒有針對「明財位落在凶星位」的處置,目前只做扣分與提醒。',
    ['DOMAIN_SPEC.md#2.6.10'],
  );

export const mingGuaFinding = (personId, wealth) => {
  const [a, b, c] = wealth.order;
  return finding(
    `wealth.ming_gua.${personId}`,
    'info',
    `${personId} 的本命財位(${wealth.gua}命)`,
    `傳統上本命財位看命卦的吉方,以生氣位為主(${a.dir}方),延年(${b.dir}方)、天醫(${c.dir}方)次之,終身不變。`,
    'medium',
    'source',
    '延年與天醫的先後沒有明確來源;多位住戶時預設取平均,可在設定改成主要收入者加倍或分別顯示。',
    ['DOMAIN_SPEC.md#2.6.4'],
  );
};

export const rankFinding = ({ noResidents, cap }) =>
  finding(
    'wealth.rank.design',
    'note',
    '候選位置的排序方式',
    `這是本 App 的排序方式,僅供整理空間的參考。分數只用來排序,不可跨設定比較${noResidents ? `;沒有住戶資料時命卦分量記為 0,分數上限是 ${cap}` : ''}。明財位不論排名都會列出。`,
    'low',
    'design',
    '只有星的順序有來源(九運 9>1>8>6、流年 八白>九紫與一白六白、八宅 生氣>延年>天醫>伏位),數字大小是設計值。',
    ['DOMAIN_SPEC.md#2.6.7'],
  );

export const xkFallbackFinding = (currentYun) =>
  finding(
    'wealth.xuankong.val_fallback',
    'note',
    '目前的運不是九運,玄空星值改用五氣分數換算',
    `玄空星值表是以九運為前提訂的。目前的運是 ${currentYun} 運,改用五氣分數除以 3 換算,參考性較低。`,
    'low',
    'design',
    null,
    ['DOMAIN_SPEC.md#2.6.7'],
  );

export const borderlineFinding = (candidateId, info) =>
  finding(
    `wealth.borderline.${candidateId}`,
    'note',
    '位置接近兩個方位的交界',
    `這個位置距離${sectorText(info.gua)}與${sectorText(info.otherGua)}的交界約 ${Math.floor(info.boundaryDeg + 0.5)} 度,量測與畫圖的誤差可能讓它落到另一個宮,建議確認平面圖的方位與尺寸。`,
    'high',
    'design',
  );

export const taijiOutsideFinding = () =>
  finding('wealth.plan.taiji_outside', 'note', '太極點落在外框之外', '平面圖是凹形,面積重心落在牆外,宮位判定可能不穩。建議改選「外接框中心」或在圖上手動點選太極點。', 'high', 'design', '太極點的定義是本 App 的設計決策,沒有來源。');

export const partitionFinding = () =>
  finding('wealth.plan.partition_unsupported', 'note', '虛擬分區尚未支援', '已勾選「開放式空間用虛擬分區」,但目前仍以整個空間、以大門為基準計算。', 'high', 'design', '開放式空間整體或分區計算是流派分歧(易算數、100 室內設計主整體;藝術家推好康主分區)。');

export const softAdviceFinding = () =>
  finding(
    'wealth.soft.tips',
    'info',
    '財位佈置的傳統說法',
    `以下是傳統說法,屬民俗性質,不進分數: ${SOFT_ADVICE.map((a) => a.text).join(';')}。`,
    'medium',
    'source',
    '各家說法不一,請依自己的空間與習慣調整。',
  );

const WATER_LEVEL = { general: 'info', case: 'note' };
export const waterFinding = (hint, i) =>
  finding(`wealth.water.${hint.layer}.${hint.palace}.${i}`, WATER_LEVEL[hint.layer], `九運水火(${hint.layer === 'general' ? '通則' : '本盤個案'})`, `${hint.text}。`, hint.confidence, hint.tag, hint.schoolNote, ['DOMAIN_SPEC.md#2.6.8']);

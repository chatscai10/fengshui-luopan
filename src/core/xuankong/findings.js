// 玄空分析結果 → Finding(結果頁最小單位,規格 1.4)。文案依規格 5.1、5.4: 「傳統上認為…」、不恐嚇、不用分數當結論、
// 流派分歧老實說、推論標推論。傳統原詞(如「蚩尤煞」)只出現在 title 當名稱,body 用白話。
import { dirOfGua } from '../geo.js';
import { PALACES, STAR_INFO, QI_LABEL_TEXT, FORM_MATRIX, STAR_YUN9 } from './tables.js';
import { qiLabel, qiDist } from './assess.js';

const REFS_CORE = 'DOMAIN_SPEC.md#2.4';
const SCHOOL_ZHONGZHOU = '此為玄空(中州派)說法,各派定義不同';

/** @returns {import('../geo.js').Finding} */
function finding(id, level, title, body, confidence, tag, schoolNote, refs) {
  return { id, level, title, body, confidence, tag, schoolNote: schoolNote ?? null, refs };
}

/** 宮位的白話名稱。 */
export const palaceLabel = (p) => (p === '中' ? '中宮(房子中心)' : `${p}宮(${dirOfGua(p)}方)`);

const PATTERN_TEXT = Object.freeze({
  旺山旺向: {
    level: 'info',
    body: '傳統上認為人丁星在後方、財星在前方。後方有靠、前方開闊或見水,較適合;反過來使用則不利。',
  },
  上山下水: {
    level: 'caution',
    body: '傳統上認為人丁星與財星的位置顛倒,需要反著用(後方見水或空、前方有山),此格局建議請專業老師評估。',
  },
  雙星會向: {
    level: 'note',
    body: '傳統上認為旺星集中在前方(向首),偏旺財。向首見水或明亮開闊的氣口較有利;人丁較弱,久居的房間可在後方補實。',
  },
  雙星會坐: {
    level: 'note',
    body: '傳統上認為旺星集中在後方(坐山),偏旺人丁。後方要有靠又有水景較兼顧;財位可靠向首補氣口。財星在後方,需後方見水或動水才有財。',
  },
});

/** 形巒「偏一邊」的白話(FORM_MATRIX 保留原詞,結果頁用溫和說法,規格 5.1 第 6 點)。 */
const FORM_OFF_TEXT = Object.freeze({
  旺山旺向: '反過來(坐水朝山)使用則不利。',
  上山下水: '反過來使用則不利。',
  雙星會向: '有水無山偏旺財、不旺丁;有山無水偏旺丁、不旺財。',
  雙星會坐: '有水無山偏旺財、不旺丁;有山無水偏旺丁、不旺財(這是溫和版說法)。',
});

const PAIR_TEXT = Object.freeze({
  '2-5': '傳統上說病符星遇上五黃星,與健康較有關;二運、五運當令時另當別論,其他運建議這一宮少久待、少動土。',
  '3-7': '傳統上的說法與口舌、爭執或失竊的象徵有關,這一宮宜靜、也留意門窗安全。',
  '6-7': '傳統上的說法與爭執、尖銳物品的意外有關,這一宮留意動線與尖角。',
  '7-9': '傳統上的說法與用火用電有關,這一宮留意電器與火源。',
  '2-3': '傳統上的說法與口舌、家人不和的象徵有關,這一宮宜靜。',
  '2-7': '傳統上說兩陰星相遇火氣重,用火用電要小心(中信心)。',
  '3-5': '傳統上認為這一宮宜靜不宜動(中信心)。',
  '5-7': '傳統上的說法與飲食入口有關,這一宮不適合做廚房(中信心)。',
  '5-9': '火生土,傳統推論會催旺五黃,這一宮不設爐灶(推論,低信心)。',
  '1-5': '傳統上說這樣的組合不適合安床(低信心)。',
  '6-9': '吉凶視當時旺衰而定: 六白得令或見八白則反吉。',
  '1-4': '傳統上稱為文昌位,得令時利於讀書考試;失令則另有說法。適合書房或學生房。',
  '1-6': '水金相生,得令時偏吉;失令時傳統說法偏負面,所以不單獨當文昌位依據。',
  '3-9': '木火通明,傳統上視為文昌位(低信心),也有個性偏刻薄的說法,帶但書使用。',
  '4-4': '失令時傳統說法偏不利,說法有疑義,存疑,不當文昌位依據。',
  '1-9': '水火既濟,得運時偏吉;失令時傳統說法偏負面。',
  '6-8': '傳統上視為富貴之象,得運時偏吉。',
  '2-6': '傳統上視為財利之象,偏吉。',
  '7-8': '傳統上視為富足之象,偏吉(次序反過來的八七則有破財的說法)。',
  '8-9': '傳統上稱為輔弼相輝,偏吉。',
});

const LOCAL_YIN_TEXT = Object.freeze({
  洛書本位: '與這一宮原本的洛書數字相同',
  運星: '與這一宮的運星相同',
  洛書本位合十: '與這一宮原本的洛書數字加起來是 10',
});

const ROOM_NAME = Object.freeze({
  bedroom: '臥室',
  living: '客廳與門窗(氣口)',
  kitchen: '廚房',
  bathroom: '衛生間與儲藏',
  study: '書房與學生房',
  desk: '辦公桌',
});

const list = (ps) => ps.map(palaceLabel).join('、');

/** Finding.id 只用 ASCII(拼音),當文案與翻譯的索引鍵;顯示文字另放 title。 */
const PATTERN_ID = Object.freeze({ 旺山旺向: 'wangshanwangxiang', 上山下水: 'shangshanxiashui', 雙星會向: 'shuangxinghuixiang', 雙星會坐: 'shuangxinghuizuo' });
const PALACE_ID = Object.freeze({ 坎: 'kan', 坤: 'kun', 震: 'zhen', 巽: 'xun', 中: 'zhong', 乾: 'qian', 兌: 'dui', 艮: 'gen', 離: 'li' });
const ROLE_ID = Object.freeze({ 山向: 'shan_xiang', 山運: 'shan_yun', 向運: 'xiang_yun' });
const PLATE_ID = Object.freeze({ 山: 'shan', 向: 'xiang' });
/** 五氣標籤的白話說法('旺' 直接說當令,避免「旺(當令)」在括號裡再括一次)。 */
const qiWord = (label) => (label === '旺' ? '當令' : QI_LABEL_TEXT[label] ?? label);

/**
 * 產生 Finding 清單。
 * @param {object} ctx analyzeXuankong 的中間結果(見 xuankong.js)
 * @returns {Array<import('../geo.js').Finding>}
 */
export function buildFindings(ctx) {
  const { locate, chart, currentYun, chartYun, settings, wholePlate, specials, pairTags, positions, rooms, localYin } = ctx;
  const out = [];

  // 格局(規格 5.4 模板)
  const pt = PATTERN_TEXT[chart.pattern];
  const tiNote = chart.meta.ti && !chart.patternHolds
    ? '本盤用替卦排列,格局名稱依山向的飛行方向判定,個別星數的位置可能與下卦的定義略有出入。'
    : '';
  out.push(finding(
    `xk.pattern.${PATTERN_ID[chart.pattern]}`,
    pt.level,
    `盤面格局: ${chart.pattern}`,
    `${pt.body}${tiNote}(格局是山星、向星的旺星落在前方或後方的四種組合之一。)`,
    'high',
    'source',
    SCHOOL_ZHONGZHOU,
    ['xuankong_patterns.md#1.4', 'xuankong_patterns.md#1.9', `${REFS_CORE}.5`],
  ));

  // 形巒配合(規格 2.4.11)與室內轉譯(推論)
  const form = FORM_MATRIX[chart.pattern];
  out.push(finding(
    `xk.form.${PATTERN_ID[chart.pattern]}`,
    'info',
    `形巒配合: ${chart.pattern}`,
    `傳統上認為理想的形巒(房子外面的地形環境)是「${form.ideal}」。${FORM_OFF_TEXT[chart.pattern]}`,
    'high',
    'source',
    chart.pattern === '雙星會坐'
      ? '各派對雙星會坐「偏一邊」的說法程度不同,本 App 預設顯示溫和版;另一派的說法較嚴厲(SOHU-912417602)'
      : SCHOOL_ZHONGZHOU,
    ['xuankong_patterns.md#1.8', `${REFS_CORE}.11`],
  ));
  out.push(finding(
    'xk.form.indoor',
    'info',
    '室內怎麼轉譯山與水',
    '室內沒有山水外景時,傳統說法可以這樣轉譯(推論): 「山」= 實牆、高櫃、靠背、後方高樓;「水」= 窗外開闊的明堂、道路、水景、魚缸、風水輪(乾淨的動水)。這是依位置推得的說法,沒有直接的古籍依據。',
    'low',
    'inference',
    '推論: 室內轉譯沒有直接的古籍依據',
    ['xuankong_patterns.md#1.9', `${REFS_CORE}.11`],
  ));

  // 兼向與替卦
  if (locate) {
    const deg = Math.floor(Math.abs(locate.dev) + 0.5);
    if (locate.zone === 'jian') {
      let body = `向偏向「${locate.neighbor}山」約 ${deg} 度,屬「${locate.kind}」的兼向。`;
      if (locate.needTi && settings.useTiGua) {
        body += `傳統上(中州派、Wikibooks 的做法)這樣的偏度要改用替卦排盤,已依設定改用替卦(替星表 ${settings.tiTable})。`;
      } else if (locate.needTi) {
        body += '傳統上(中州派、Wikibooks 的做法)這樣的偏度要改用替卦排盤;本 App 預設只排下卦盤並提示,可在設定啟用替卦。';
      } else {
        body += '同性相兼,傳統上仍用下卦排盤,只作提示。';
      }
      if (locate.outer) body += '偏度落在兼向外側約 1.5 度,傳統上這一帶最需要留意。';
      const lv = locate.geo.level;
      if (lv === 'void') body += '偏度超過兼向的一般限度,落在傳統上要避開的帶(空亡),盤仍依規則排出,只作警示,建議重新量測。';
      else if (lv === 'jian_caution') body += '偏度在兼向限度的邊緣,建議重新量測確認。';
      if (locate.ridingLine) body += '方位剛好壓在分界附近(騎線),建議重新量測。';
      out.push(finding('xk.locate.jian', lv === 'void' ? 'caution' : 'note', `兼向: 向偏「${locate.neighbor}山」`, body, 'medium', 'source',
        locate.geo.schoolNote ?? '兼向度數與空亡的定義各派不同(此為玄空中州派說法)', ['xuankong_core.md#2.5', `${REFS_CORE}.3`]));
    } else if (locate.ridingLine) {
      out.push(finding('xk.locate.riding', 'note', '方位在下卦邊界(騎線)',
        '量到的方位剛好在下卦與兼向的分界附近,慣例上歸下卦,但結果對誤差很敏感,建議重新量測。',
        'medium', 'source', '下卦的端點慣例各派不同', ['xuankong_core.md#2.5', `${REFS_CORE}.3`]));
    }
  }

  // 全局伏吟反吟
  for (const a of wholePlate.penalties) {
    if (a.kind === '伏吟') {
      out.push(finding(`xk.wholeplate.fuyin.${PLATE_ID[a.plate]}`, 'caution', `全局伏吟(${a.plate}盤)`,
        `${a.plate}盤的數字與原位完全相同(伏吟)。傳統上視為較特殊、較難調整的格局,建議請專業老師到現場評估。`,
        'medium', 'source', '扣分值屬工程設定,各派看法不一', ['xuankong_patterns.md#1.5', `${REFS_CORE}.7`]));
    } else {
      const body = a.waived
        ? `${a.plate}盤的數字與原位相反(反吟)。此盤為旺山旺向且仍在當運,傳統上說旺運時仍可用;等到退運就要留意。`
        : `${a.plate}盤的數字與原位相反(反吟)。傳統上說反吟旺運時可用、退運時會轉為不利,此盤目前不在有利的狀態,請留意並建議請專業老師到現場評估。`;
      out.push(finding(`xk.wholeplate.fanyin.${PLATE_ID[a.plate]}`, 'caution', `全局反吟(${a.plate}盤)`, body,
        'medium', 'source', '各派對反吟的輕重說法不一', ['xuankong_patterns.md#1.5', `${REFS_CORE}.7`]));
    }
  }

  // 起盤的運與今日的運不同
  if (chartYun !== currentYun) {
    out.push(finding('xk.yun.differs', 'note', '起盤的運與今日的運不同',
      `這張盤用第 ${chartYun} 運起盤(依建成、遷入或整修的時間),今天已是第 ${currentYun} 運。盤面格局名稱以起盤的運為準;星的旺衰與財位、丁位則以今天所屬的運來看。`,
      'medium', 'inference', '老宅以哪一運判讀旺衰,流派意見未定,建議請玄空老師確認(規格 U-10)', [`${REFS_CORE}.4`, 'DOMAIN_SPEC.md#7']));
  }

  // 特殊格局
  if (specials.heshi.whole) {
    out.push(finding('xk.special.heshi', 'info', `全局合十(${specials.heshi.whole})`,
      '每一宮的運星與山星(或向星)加起來都是 10,傳統上稱為合十,認為氣脈較通順。', 'high', 'source', null,
      ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
  }
  if (specials.parent3) {
    out.push(finding('xk.special.parent3', 'info', '父母三般卦(三般巧卦)',
      '每一宮的山星、向星、運星都同屬一組(對 3 同餘),傳統上視為吉的特殊格局。', 'high', 'source', null,
      ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
  }
  if (specials.qixing) {
    const q = specials.qixing;
    out.push(finding('xk.special.qixing', q.usable ? 'info' : 'caution', `七星打劫(${q.kind})`,
      q.usable
        ? '傳統上認為這個雙星會向的盤可以用「打劫」的方法調整氣運,是進階說法,建議請專業老師評估。'
        : '這個盤符合打劫的條件,但犯全局伏吟,傳統上不作打劫使用。',
      'high', 'source', '打劫的完整清單只有單一來源(陳炳聿)', ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
  }
  if (specials.lianshu && settings.showLianshu) {
    out.push(finding('xk.special.lianshu', 'note', '連數三般卦(只標記)',
      '每一宮的三個數字是相鄰的三個數。各派對這種格局的吉凶說法互相矛盾,本 App 只標記、不計分。', 'low', 'source',
      '有的來源稱吉(連珠),有的稱凶(連茹)', ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
  }
  if (settings.showChengmen && specials.chengmen) {
    const c = specials.chengmen;
    out.push(finding('xk.special.chengmen', 'note', `城門位: ${palaceLabel(c.main.palace)}與${palaceLabel(c.sub.palace)}`,
      `向宮兩旁的正城門在${palaceLabel(c.main.palace)}、副城門在${palaceLabel(c.sub.palace)}。傳統上認為要讓當運旺星飛到城門;本 App 只顯示,不進主要評分。`,
      'medium', 'source', '「可用性」是單一作者的簡化規則,與古法及其他來源的說法不同義', ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
  }

  // 宮位伏吟反吟(旺星不扣、衰死扣,只在衰死時提示)
  for (const kind of ['fuyin', 'fanyin']) {
    for (const e of localYin[kind]) {
      if (!e.penalized) continue;
      // 同一宮同一盤可能同時符合兩種伏吟依據(洛書本位、運星),id 要帶依據才不重複。
      const basisKey = e.basis === '洛書本位' ? 'home' : e.basis === '運星' ? 'yun' : 'sum10';
      out.push(finding(`xk.localyin.${kind}.${PALACE_ID[e.palace]}.${PLATE_ID[e.plate]}.${basisKey}`, 'note',
        `${palaceLabel(e.palace)}的${e.plate}星${kind === 'fuyin' ? '伏吟' : '反吟'}`,
        `${palaceLabel(e.palace)}的${e.plate}星${LOCAL_YIN_TEXT[e.basis]},而且這顆星目前不在旺的狀態。傳統上認為旺星可用、衰死的星則不宜用,這一宮建議少作重要用途。`,
        'medium', 'source', '宮位伏吟反吟的判讀各派不一', ['xuankong_patterns.md#1.5', `${REFS_CORE}.6`]));
    }
  }

  // 星組合
  for (const p of PALACES) {
    for (const t of pairTags[p]) {
      const level = t.nature === '凶' && t.confidence !== 'low' ? 'caution' : t.nature === '吉' ? 'info' : 'note';
      out.push(finding(`xk.pair.${PALACE_ID[p]}.${ROLE_ID[t.role]}.${t.key}`, level, `${palaceLabel(p)}: ${t.tag}`,
        `${t.role === '山向' ? '山星與向星' : t.role === '山運' ? '山星與運星' : '向星與運星'}的組合。${PAIR_TEXT[t.key]}`,
        t.confidence, 'source', '星組合的名稱與吉凶說法各派略有不同', ['xuankong_patterns.md#2.9', `${REFS_CORE}.9`]));
    }
  }

  // 九星落宮。九運有來源的逐星模板(1.9 B 表);其他運只提當令與生氣的星,以及需留意的五黃、二黑。
  for (const p of PALACES) {
    for (const [plate, key, use] of [['山星', 'shan', '床位、書桌、神位(傳統上山星看人丁與健康)'], ['向星', 'xiang', '門窗與氣口(傳統上向星看財運)']]) {
      const star = chart.palaces[p][key];
      const info = STAR_INFO[star];
      const label = qiLabel(currentYun, star, settings.qiScheme);
      const d = qiDist(currentYun, star);
      if (currentYun === 9) {
        const t = STAR_YUN9[star];
        out.push(finding(`xk.star9.${star}.${PALACE_ID[p]}.${key}`, t.level, `${palaceLabel(p)}的${plate}是${info.name}(${t.state})`,
          `${t.text}${t.plate[plate] ?? ''}適合: ${t.use}。避免: ${t.avoid}。`,
          star === 8 ? 'low' : 'medium', 'source',
          star === 8 ? '八白退氣後的評價各派不同(有的說仍是財星,有的說失令失財),本 App 預設不催不禁' : '旺衰的分級各派略有不同,本 App 預設採台灣常見的標法',
          ['xuankong_patterns.md#1.9', `${REFS_CORE}.13`]));
      } else if (star === 5 && currentYun !== 5) {
        out.push(finding(`xk.star.5.${PALACE_ID[p]}.${key}`, 'caution', `${palaceLabel(p)}的${plate}是五黃星`,
          '五黃星是傳統上需要特別留意的星,宜靜不宜動: 這一宮少動土、少開門窗、不放爐灶。', 'high', 'source',
          '五黃在當運(五運)時另當別論', ['xuankong_patterns.md#2.1', `${REFS_CORE}.8`]));
      } else if (star === 2 && currentYun !== 2) {
        out.push(finding(`xk.star.2.${PALACE_ID[p]}.${key}`, 'note', `${palaceLabel(p)}的${plate}是二黑星`,
          `二黑星傳統上稱病符星,建議不要當久居的臥室,並留意健康相關的用途。${d <= 2 ? '目前雖然排在偏旺的位置,仍建議這樣安排。' : ''}`, 'high', 'source',
          null, ['xuankong_patterns.md#2.1', `${REFS_CORE}.8`]));
      } else if (d <= 2) {
        out.push(finding(`xk.star.${star}.${PALACE_ID[p]}.${key}`, 'info', `${palaceLabel(p)}的${plate}是${info.name}(${qiWord(label)})`,
          `${info.name}星目前是${qiWord(label)}的星,${d === 0 ? `傳統上認為當令時${info.wang}` : `屬於偏吉的生氣星,這顆星得令時的象意是「${info.wang}」`}。這一宮較適合安排${use}。`,
          'medium', 'source', '旺衰的分級各派略有不同,本 App 預設採台灣常見的標法', ['xuankong_patterns.md#2.1', `${REFS_CORE}.8`]));
      }
    }
  }

  // 財位與丁位
  const front = positions.wealth.find((r) => r.kind === 'wangcai');
  if (front) {
    out.push(finding('xk.position.wealth.front', 'info', `財位候選: ${palaceLabel(front.palace)},在前方`,
      `向星當旺的位置落在向宮(前方)。傳統上認為財星在前方,向首有水或明亮開闊的氣口才有利。`,
      'medium', 'source', '財位的判斷方式各派不同,這是玄空的說法', ['xuankong_patterns.md#1.7', `${REFS_CORE}.10`]));
  }
  const back = positions.wealth.find((r) => r.kind === 'back' && r.tier === 'wang');
  if (back) {
    out.push(finding('xk.position.wealth.back', 'note', `財星在後方: ${palaceLabel(back.palace)}`,
      '向星當旺的位置落在坐宮(後方)。傳統上說財星在後方,需要後方見水或動水才有財,所以不列為旺財位。',
      'medium', 'source', '玄空的說法,各派看法不一', ['xuankong_patterns.md#1.7', `${REFS_CORE}.10`]));
  }
  for (const r of positions.wealth.filter((x) => x.kind === 'ciwei').slice(0, 2)) {
    out.push(finding(`xk.position.wealth.side.${PALACE_ID[r.palace]}`, 'note', `次財位: ${palaceLabel(r.palace)}`,
      `向星是${STAR_INFO[r.star].name}(${qiWord(qiLabel(currentYun, r.star, settings.qiScheme))}),可作為次要的財位。${r.star === 2 ? '二黑星傳統上稱病符,使用時要小心。' : ''}`,
      'medium', 'source', null, ['xuankong_patterns.md#1.7', `${REFS_CORE}.10`]));
  }
  const dBack = positions.ding.find((r) => r.kind === 'wangding');
  if (dBack) {
    out.push(finding('xk.position.ding.back', 'info', `丁位候選: ${palaceLabel(dBack.palace)},在後方`,
      '山星當旺的位置落在坐宮(後方)。傳統上看人丁與健康以山星為主,床位、書桌、神位可優先考慮這一宮,後方要有靠。',
      'medium', 'source', '玄空的說法', ['xuankong_patterns.md#1.7', `${REFS_CORE}.10`]));
  }
  const dFront = positions.ding.find((r) => r.kind === 'front' && r.tier === 'wang');
  if (dFront) {
    out.push(finding('xk.position.ding.front', 'note', `山星在前方: ${palaceLabel(dFront.palace)}`,
      '山星當旺的位置落在向宮(前方)。傳統上認為山星宜靜、宜有靠,前方最好有實牆或高櫃補實。這是依位置對稱推得的說法。',
      'low', 'inference', '推論: 依財位的分流方式對稱推得,沒有直接的古籍依據', ['xuankong_patterns.md#1.7', `${REFS_CORE}.10`]));
  }

  // 房間用途(全部標推論)
  for (const r of rooms) {
    const parts = [];
    parts.push(r.prefer.length ? `可以優先考慮: ${list(r.prefer)}。` : '目前沒有特別適合的宮位。');
    if (r.avoid.length) parts.push(`建議避開: ${list(r.avoid)}。`);
    parts.push(`這是依五行與位置推得的說法,沒有直接的古籍依據(依據: ${r.rule})。`);
    out.push(finding(`xk.room.${r.room}`, 'info', `推論: ${ROOM_NAME[r.room]}的位置`, parts.join(''), 'low', 'inference',
      '單一作者為主,多條規則無來源', ['xuankong_patterns.md#1.9', `${REFS_CORE}.12`]));
  }

  return out;
}

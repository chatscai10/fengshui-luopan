// 風水重點擺放與禁忌分析引擎 (室內佈局: 財位、床位、工作桌、爐灶、神位)
// 依據 docs/DOMAIN_SPEC.md 2.3.4 (八宅用途矩陣/床向灶向)、2.4 (玄空山向丁位財位)、2.6.5 (環境避忌)
// 純函式,無 DOM,輸出 JSON 友好的分析結果與 Finding 提示卡。

import { GUA, DIR8 } from './geo.js';
import { starOf, USAGE_MATRIX } from './bazhai.js';
import { SOFT_ADVICE } from './wealth/constants.js';

export const PLACEMENT_SCHEMA = 'fengshui.placement/1';

const RATING_WEIGHT = Object.freeze({
  best: 100,
  good: 80,
  ok: 60,
  avoid: 30,
  worst: 0,
});

/**
 * 針對各重點空間/物件（床位、工作桌、財位、神位、爐灶）計算八方位的適合度與避忌清單。
 * @param {object} p
 * @param {string} [p.mingGua] 個人命卦 (坎艮震巽離坤兌乾); 若無則只依宅卦
 * @param {string} [p.zhaiGua] 房屋宅卦 (坎艮震巽離坤兌乾)
 * @param {object} [p.xuankong] 玄空盤物件 (含 palaces)
 * @param {object} [p.annual] 流年盤物件 (含 wuhuang, erhei, sansha, taisui)
 * @returns {object}
 */
export function analyzePlacements({ mingGua = null, zhaiGua = null, xuankong = null, annual = null } = {}) {
  const targetGua = mingGua || zhaiGua || '坎'; // 依命不依宅,無命卦則依宅卦
  const isPersonal = Boolean(mingGua);

  // 1. 床位 (安床吉方與避忌)
  // 八宅: 天醫(健康第一)、延年(感情夫妻)、生氣(精力)、伏位(安穩)
  // 玄空: 宜山星旺生(丁位宜靜)
  // 避忌: 忌沖門、忌背窗無靠、忌廁所共牆或沖門、忌樑壓、忌二黑五黃煞位
  const bedHeads = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const bazhaiRule = USAGE_MATRIX.bedHead[star] || { rating: 'ok', note: '' };
    let score = RATING_WEIGHT[bazhaiRule.rating] || 50;

    const cautions = [];
    if (annual && dir === annual.wuhuang) {
      score -= 30;
      cautions.push('今年五黃大煞飛臨此方,不宜作為主要安床動土處');
    }
    if (annual && dir === annual.erhei) {
      score -= 20;
      cautions.push('今年二黑病符星在此方,注意身心安康');
    }

    return {
      dir,
      star,
      rating: bazhaiRule.rating,
      score: Math.max(0, score),
      desc: bazhaiRule.note || `${star}方`,
      cautions,
    };
  }).sort((a, b) => b.score - a.score);

  // 2. 工作桌 / 書房辦公 (生氣/延年首選, 文昌四綠, 一白智慧)
  const deskFacings = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const bazhaiRule = USAGE_MATRIX.desk[star] || { rating: 'ok', note: '' };
    let score = RATING_WEIGHT[bazhaiRule.rating] || 50;

    const notes = [bazhaiRule.note].filter(Boolean);
    if (annual && dir === annual.wuhuang) {
      score -= 25;
      notes.push('流年逢五黃,宜靜不宜躁');
    }

    return {
      dir,
      star,
      rating: bazhaiRule.rating,
      score: Math.max(0, score),
      desc: notes.join('; ') || `${star}方`,
    };
  }).sort((a, b) => b.score - a.score);

  // 3. 爐灶 (古法坐凶向吉: 灶座壓凶方, 灶口朝吉方)
  const stoveSeats = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const bazhaiRule = USAGE_MATRIX.stoveSeat[star] || { rating: 'ok', note: '' };
    return {
      dir,
      star,
      rating: bazhaiRule.rating,
      score: RATING_WEIGHT[bazhaiRule.rating] || 50,
      desc: bazhaiRule.note || `${star}方`,
    };
  }).sort((a, b) => b.score - a.score);

  const stoveMouths = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const bazhaiRule = USAGE_MATRIX.stoveMouth[star] || { rating: 'ok', note: '' };
    return {
      dir,
      star,
      rating: bazhaiRule.rating,
      score: RATING_WEIGHT[bazhaiRule.rating] || 50,
      desc: bazhaiRule.note || `${star}方`,
    };
  }).sort((a, b) => b.score - a.score);

  // 4. 通用室內格局避忌清單 (基於環境幾何與民俗經驗的客觀指標)
  const taboos = [
    {
      id: 'taboo.beam',
      title: '橫樑壓頂 (床頭 / 書桌 / 財位)',
      rule: '樑下氣流下壓容易造成壓迫感與緊繃',
      remedy: '移開避開樑下位置,或以平頂天花板包覆修飾',
    },
    {
      id: 'taboo.door_chong',
      title: '開門正沖 (門沖床 / 門沖灶 / 門對門)',
      rule: '開門直對床鋪或爐灶,氣流直沖動靜失和',
      remedy: '設置屏風遮擋、玄關緩衝,或調整床位與家具角度',
    },
    {
      id: 'taboo.back_window',
      title: '背後無靠 (床頭靠窗 / 辦公桌背門背窗)',
      rule: '坐臥背後宜有厚實牆面為靠山,背對門窗易受驚擾缺乏安定',
      remedy: '移動桌床使背後靠實牆,若無法移動則加裝不透光厚窗簾',
    },
    {
      id: 'taboo.toilet_adjacent',
      title: '廁所共牆或正對廁所門',
      rule: '衛浴水氣污濁,床頭不宜靠廁所牆,爐灶不宜與水槽廁所相鄰相沖',
      remedy: '床位移至另一側實牆,廚房保持乾爽隔開水火區間',
    },
    {
      id: 'taboo.mirror_reflect',
      title: '鏡子正對床鋪或大門',
      rule: '夜起或進門反射易生驚悸心神不寧',
      remedy: '避免鏡面直照床面或玄關,可貼收納於衣櫃門內側',
    },
  ];

  return {
    meta: {
      schema: PLACEMENT_SCHEMA,
      targetGua,
      isPersonal,
    },
    bed: {
      title: '床位與床頭朝向安排',
      bestDirections: bedHeads.filter((x) => x.rating === 'best' || x.rating === 'good').slice(0, 3),
      avoidDirections: bedHeads.filter((x) => x.rating === 'worst' || x.rating === 'avoid').slice(0, 3),
      all: bedHeads,
    },
    desk: {
      title: '書房工作桌與辦公面向安排',
      bestDirections: deskFacings.filter((x) => x.rating === 'best' || x.rating === 'good').slice(0, 3),
      avoidDirections: deskFacings.filter((x) => x.rating === 'worst' || x.rating === 'avoid').slice(0, 3),
      all: deskFacings,
    },
    kitchen: {
      title: '廚房與爐灶配置 (坐凶向吉)',
      seatOptimal: stoveSeats.filter((x) => x.rating === 'good').slice(0, 3), // 宜壓凶
      mouthOptimal: stoveMouths.filter((x) => x.rating === 'good' || x.rating === 'best').slice(0, 3), // 宜向吉
    },
    taboos,
    softAdvice: SOFT_ADVICE.map((s) => s.text),
  };
}

function dirToGua(dir) {
  const idx = DIR8.indexOf(dir);
  return idx >= 0 ? GUA[idx] : '坎';
}

/**
 * 將 placement 分析結果轉換成純文字卡片清單 (供報告視圖使用)
 */
export function buildPlacementCards(placements) {
  if (!placements) return [];
  const cards = [];

  // 床位卡片
  if (placements.bed) {
    const goods = placements.bed.bestDirections.map((x) => `${x.dir}方(${x.desc})`).join('、');
    const avoids = placements.bed.avoidDirections.map((x) => `${x.dir}方(${x.desc})`).join('、');
    cards.push({
      id: 'placement.bed',
      headline: '安床與床頭朝向建議',
      badges: ['重點擺設', placements.meta.isPersonal ? '個人命卦' : '房屋宅卦'],
      body: `床頭宜朝向健康安穩吉方：${goods || '吉星方位'}。宜避開動盪或耗損之方：${avoids || '凶星方位'}。床頭應靠實牆、不臨門沖、不背窗。`,
      level: 'good',
    });
  }

  // 工作桌/書房卡片
  if (placements.desk) {
    const goods = placements.desk.bestDirections.map((x) => `${x.dir}方(${x.desc})`).join('、');
    cards.push({
      id: 'placement.desk',
      headline: '工作桌與書房面向安排',
      badges: ['事業學業'],
      body: `坐向宜朝生氣、延年或文昌方：${goods || '吉星方位'}。座位宜背後有靠(厚實背牆)、身前開闊、避開背對房門與背對窗戶。`,
      level: 'good',
    });
  }

  // 爐灶卡片
  if (placements.kitchen) {
    const mouths = placements.kitchen.mouthOptimal.map((x) => `${x.dir}方(${x.desc})`).join('、');
    cards.push({
      id: 'placement.kitchen',
      headline: '廚房與爐灶位置 (坐凶向吉)',
      badges: ['健康食祿'],
      body: `傳統廚房配置講究「坐凶向吉」：灶座宜設於休歇之方以壓煞，開關與灶口宜面向吉方引進生氣(${mouths || '吉方'})。注意水槽與爐灶不宜正對相沖。`,
      level: 'good',
    });
  }

  // 格局避忌卡片
  if (Array.isArray(placements.taboos)) {
    for (const t of placements.taboos) {
      cards.push({
        id: `placement.${t.id}`,
        headline: `避忌提示：${t.title}`,
        badges: ['格局避忌'],
        body: `${t.rule}。化解建議：${t.remedy}。`,
        level: 'caution',
      });
    }
  }

  return cards;
}

/**
 * 產出結構化的擺放摘要區塊
 */
export function buildPlacementBlock(report) {
  if (!report) return null;
  const resident = report.bazhai && report.bazhai.residents && report.bazhai.residents[0];
  const mingGua = resident ? resident.ming && resident.ming.gua : null;
  const zhaiGua = report.bazhai && report.bazhai.house ? report.bazhai.house.gua : null;
  const annual = report.summary && report.summary.year;

  const placements = analyzePlacements({
    mingGua,
    zhaiGua,
    annual,
  });

  return {
    placements,
    cards: buildPlacementCards(placements),
  };
}

// 風水重點擺放與禁忌分析引擎 (室內佈局: 財位、床位、工作桌、爐灶、神位、沙發、魚缸)
// 依據 docs/DOMAIN_SPEC.md 2.3.4 (八宅用途矩陣/床向灶向)、2.4 (玄空山向丁位財位)、2.6.5 (環境避忌)
// 純函式,無 DOM,輸出 JSON 友好的分析結果與 Finding 提示卡。

import { GUA, DIR8, dirOfGua, guaOfDir } from './geo.js';
import { starOf, USAGE_MATRIX } from './bazhai.js';
import { SOFT_ADVICE } from './wealth/constants.js';
export const PLACEMENT_SCHEMA = 'fengshui.placement/2';

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

  // 4. 神位 / 佛龕 (宜安坐吉方、向吉方, 背靠實牆, 嚴禁背廁、背廚、對門沖)
  const altarSeats = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const isGood = ['生氣', '延年', '天醫', '伏位'].includes(star);
    return {
      dir,
      star,
      rating: isGood ? 'best' : 'avoid',
      desc: isGood ? `神位安穩(${star}吉方)` : `不宜神位(${star}凶方)`,
    };
  }).sort((a, b) => (a.rating === 'best' ? -1 : 1));

  // 5. 客廳主沙發 (宜背靠實牆, 坐於延年/生氣/伏位, 避開背門/背窗/橫樑)
  const sofaSeats = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    const isGood = ['生氣', '延年', '天醫', '伏位'].includes(star);
    return {
      dir,
      star,
      rating: isGood ? 'good' : 'ok',
      desc: isGood ? `主位聚氣安穩(${star}方)` : `常位(${star}方)`,
    };
  }).sort((a, b) => (a.rating === 'good' ? -1 : 1));

  // 6. 流水魚缸 / 催財動水 (宜放在向星旺生方或零神方; 忌放凶煞方與太歲五黃位)
  const fishTankDirs = DIR8.map((dir) => {
    const star = starOf(targetGua, dirToGua(dir));
    let caution = '';
    if (annual && dir === annual.wuhuang) caution = '流年五黃大煞位,忌放動水刺激凶氣';
    if (annual && dir === annual.erhei) caution = '流年二黑病符位,不宜擺放流動水景';
    return {
      dir,
      star,
      caution,
      rating: caution ? 'avoid' : 'good',
      desc: caution || `${star}方(可做動水納氣參考)`,
    };
  });

  // 7. 通用室內格局避忌清單 (客觀幾何與環境力學指標)
  const taboos = [
    {
      id: 'taboo.beam',
      title: '橫樑壓頂 (床頭 / 書桌 / 財位 / 沙發)',
      rule: '上方橫樑造成垂直氣流下壓與視覺潛意識壓迫，久坐或久臥容易引起頭頸緊繃與焦慮',
      remedy: '床位或桌位向左/右平移 40 公分以上避開樑下投影；或透過裝潢平頂天花板將樑體包覆修飾',
    },
    {
      id: 'taboo.door_chong',
      title: '開門正沖 (門沖床 / 門沖灶 / 房門沖書桌)',
      rule: '房門直對床鋪（沖頭/沖胸/沖腳）或爐灶，門外氣流直貫缺乏緩衝，隱私與氣場皆受干擾',
      remedy: '調整家具擺放角度避免迎門正向；或在門口設置遮蔽屏風、玄關櫃或加掛過膝長布簾以聚氣',
    },
    {
      id: 'taboo.back_window',
      title: '背後無靠 (床頭靠窗 / 辦公桌背門背窗)',
      rule: '坐臥背後為窗戶或通道，缺乏心理依託與後盾，容易受外界光影聲響驚擾，專注度與安全感下降',
      remedy: '將床頭或辦公桌移動至實體水泥牆面；若格局限制無法移動，應加裝厚重遮光窗簾並常時拉上',
    },
    {
      id: 'taboo.toilet_adjacent',
      title: '廁所共牆或正對衛浴門',
      rule: '衛浴為排水濕氣源頭，床頭不宜緊貼廁所管道牆，廚房爐灶亦不宜與馬桶正對或共背牆',
      remedy: '床鋪移至對面乾淨實牆；廚衛共牆處可加裝隔音防潮木夾板厚層，衛浴門常關並保持抽風乾燥',
    },
    {
      id: 'taboo.mirror_reflect',
      title: '鏡子正對床鋪或大門玄關',
      rule: '夜間起臥或開門入戶時，鏡面光線反射容易引起大腦錯覺驚悸，心神不易寧靜',
      remedy: '避免鏡面正對床身與枕頭，梳妝台鏡面可旋轉、貼附於衣櫃門內側，或使用布簾隨手遮蔽',
    },
    {
      id: 'taboo.fire_water',
      title: '廚房水火相剋 (爐灶緊鄰水槽 / 冰箱正對爐灶)',
      rule: '爐灶屬火，水槽與冰箱屬水，相距不足 60 公分或門戶正對容易導致溫差水氣干擾烹飪與動線',
      remedy: '爐灶與水槽間保留至少 60 公分備料緩衝檯面；冰箱移開避免開門正射爐灶火力',
    },
  ];

  return {
    meta: {
      schema: PLACEMENT_SCHEMA,
      targetGua,
      isPersonal,
    },
    annual: annual || null,
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
    altar: {
      title: '神明廳與佛龕安放',
      seatOptimal: altarSeats.filter((x) => x.rating === 'best').slice(0, 3),
    },
    sofa: {
      title: '客廳主沙發方位',
      seatOptimal: sofaSeats.filter((x) => x.rating === 'good').slice(0, 3),
    },
    fishTank: {
      title: '催財魚缸與動水避忌',
      all: fishTankDirs,
      avoidDirections: fishTankDirs.filter((x) => x.rating === 'avoid'),
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

  // 1. 床位卡片
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

  // 2. 工作桌/書房卡片
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

  // 3. 爐灶卡片
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

  // 4. 客廳主沙發卡片
  if (placements.sofa) {
    const seats = placements.sofa.seatOptimal.map((x) => `${x.dir}方`).join('、');
    cards.push({
      id: 'placement.sofa',
      headline: '客廳主沙發安位要領',
      badges: ['家庭和諧'],
      body: `客廳主沙發為全家聚會樞紐，宜擺放於吉方(${seats || '生氣延年方'})，背靠實牆不留通道，正對大門角度宜柔和不直沖。`,
      level: 'good',
    });
  }

  // 5. 神位佛龕卡片
  if (placements.altar) {
    const seats = placements.altar.seatOptimal.map((x) => `${x.dir}方`).join('、');
    cards.push({
      id: 'placement.altar',
      headline: '神明廳與佛龕方位',
      badges: ['敬神安宅'],
      body: `神位宜安於吉方清靜處(${seats || '吉方'})，背靠牢固實牆，嚴禁背貼廁所、廚房或正對房門。`,
      level: 'good',
    });
  }

  // 6. 流水魚缸避忌
  if (placements.fishTank && placements.fishTank.avoidDirections.length) {
    const avoids = placements.fishTank.avoidDirections.map((x) => `${x.dir}方(${x.caution})`).join('；');
    cards.push({
      id: 'placement.fishTank',
      headline: '催財魚缸與動水流年避忌',
      badges: ['動水催財'],
      body: `動水能聚財亦能引煞，流年不宜擺設方位：${avoids}。其他生旺方擺放動水則有助生發氣場。`,
      level: 'caution',
    });
  }

  // 7. 格局避忌卡片
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
 * 將平面圖上的家具與八方位對照,逐件給出方位吉凶與注意事項。
 * @param {object} placements analyzePlacements 的結果
 * @param {object} plan 平面圖(含 furniture[])
 * @param {object} opt { taiji:[x,y], up:number|null } 太極點與圖面上方的羅盤方位
 * @returns {object[]} 每件家具的診斷
 */
export function analyzeFurniture(placements, plan, { taiji = null, up = null } = {}) {
  if (!placements || !plan || !Array.isArray(plan.furniture)) return [];
  const out = [];
  for (const f of plan.furniture) {
    if (!f || typeof f !== 'object' || !Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
    const cx = f.x + (Number(f.w) || 0) / 2;
    const cy = f.y + (Number(f.d) || 0) / 2;
    let dir = null;
    let gua = null;
    if (Array.isArray(taiji) && Number.isFinite(up)) {
      const dx = cx - taiji[0];
      const dy = cy - taiji[1];
      if (Math.hypot(dx, dy) > 1e-6) {
        const b = ((up + (Math.atan2(dx, dy) * 180) / Math.PI) % 360 + 360) % 360;
        const idx = Math.floor(((b + 22.5) % 360) / 45) % 8;
        dir = DIR8[idx];
        gua = GUA[idx];
      }
    }
    const star = dir && gua ? starOf(placements.meta.targetGua, gua) : null;
    const cautions = [];
    // 門沖:家具中心在任何門窗(含大門)直徑範圍內且距離 < 0.3m
    if (Array.isArray(plan.openings)) {
      for (const o of plan.openings) {
        if (!o || (o.kind !== 'entrance' && o.kind !== 'door')) continue;
        const room = (plan.rooms || []).find((r) => r.id === o.roomId);
        if (!room || !Array.isArray(room.polygon)) continue;
        const xs = room.polygon.map((p) => p[0]);
        const ys = room.polygon.map((p) => p[1]);
        const ox = Math.min(...xs);
        const oy = Math.min(...ys);
        const px = o.wall === 'left' ? ox : o.wall === 'right' ? Math.max(...xs) : ox + (o.pos || 0);
        const py = o.wall === 'bottom' ? oy : o.wall === 'top' ? Math.max(...ys) : oy + (o.pos || 0);
        const d = Math.hypot(cx - px, cy - py);
        if (d < 0.45) {
          const doorName = o.kind === 'entrance' ? '大門' : '房門';
          cautions.push(`正對${doorName}(門沖),氣流直貫;建議設置玄關矮櫃、屏風或長門簾化解`);
        }
      }
    }
    // 背窗檢測:床頭、辦公桌背後 0.5 公尺內緊鄰外窗
    if (f.kind === 'bed' || f.kind === 'desk') {
      const windows = (plan.openings || []).filter((o) => o && (o.kind === 'window' || o.kind === 'floorWindow'));
      for (const w of windows) {
        const room = (plan.rooms || []).find((r) => r.id === w.roomId);
        if (!room || !Array.isArray(room.polygon)) continue;
        const xs = room.polygon.map((p) => p[0]);
        const ys = room.polygon.map((p) => p[1]);
        const ox = Math.min(...xs);
        const oy = Math.min(...ys);
        const wx = w.wall === 'left' ? ox : w.wall === 'right' ? Math.max(...xs) : ox + (w.pos || 0);
        const wy = w.wall === 'bottom' ? oy : w.wall === 'top' ? Math.max(...ys) : oy + (w.pos || 0);
        const dist = Math.hypot(cx - wx, cy - wy);
        if (dist < 0.6) {
          cautions.push(`後方緊靠窗戶(背窗無靠),缺乏安定感;建議移靠實牆或加裝常閉厚窗簾`);
          break;
        }
      }
    }
    // 廁所共牆:本家具與任何衛浴房間共牆且貼近
    const toiletRooms = (plan.rooms || []).filter((r) => r.type === 'toilet');
    for (const tr of toiletRooms) {
      const xs = tr.polygon.map((p) => p[0]);
      const ys = tr.polygon.map((p) => p[1]);
      const tx0 = Math.min(...xs), ty0 = Math.min(...ys), tx1 = Math.max(...xs), ty1 = Math.max(...ys);
      const overlapX = Math.min(f.x + (f.w || 0), tx1) - Math.max(f.x, tx0);
      const overlapY = Math.min(f.y + (f.d || 0), ty1) - Math.max(f.y, ty0);
      if ((overlapX > -0.1 && overlapX < 0.1 && overlapY > 0.1) || (overlapY > -0.1 && overlapY < 0.1 && overlapX > 0.1)) {
        cautions.push('與衛浴廁所共牆,濕氣與管線雜訊較重;床頭/神位建議換至乾淨實牆面');
        break;
      }
    }
    // 廚房水火:爐灶與冰箱距離過近(算的是兩者邊緣的淨間距,不是中心距離)
    if (f.kind === 'stove') {
      const fridge = plan.furniture.find((x) => x && x.kind === 'fridge' && Number.isFinite(x.x) && Number.isFinite(x.y));
      if (fridge) {
        const gapX = Math.max(0, Math.max(f.x, fridge.x) - Math.min(f.x + (f.w || 0), fridge.x + (fridge.w || 0)));
        const gapY = Math.max(0, Math.max(f.y, fridge.y) - Math.min(f.y + (f.d || 0), fridge.y + (fridge.d || 0)));
        const gap = Math.hypot(gapX, gapY);
        if (gap < 0.6) cautions.push(`爐灶與冰箱相距約 ${Math.round(gap * 100) / 100} 公尺(水火相剋,建議留 60 公分以上)`);
      }
    }
    // 動水魚缸落凶星或五黃二黑
    if (f.kind === 'fishTank' && placements.annual) {
      if (dir === placements.annual.wuhuang) cautions.push('流水魚缸落在流年五黃大煞位,動水容易催動凶氣;建議流年移位');
      if (dir === placements.annual.erhei) cautions.push('流水魚缸落在流年二黑病符位,動水多擾;建議流年換位');
    }
    out.push({
      id: f.id,
      kind: f.kind,
      dir,
      gua,
      star,
      x: f.x,
      y: f.y,
      w: f.w,
      d: f.d,
      facing: Number.isFinite(f.facing) ? f.facing : null,
      cautions,
    });
  }
  return out;
}

/**
 * 家具種類 → 查哪一張用途表。回傳 null 表示這種家具只看方位不評吉凶(冰箱、電視櫃屬設備)。
 * 表名對應 bazhai.USAGE_MATRIX;'auspicious' 表示四吉位為宜(神位)。
 */
const FURNITURE_MATRIX = Object.freeze({
  bed: 'bedHead',
  desk: 'desk',
  stove: 'stoveSeat',
  sofa: 'living',
  altar: 'auspicious',
  fishTank: null,
  fridge: null,
  tv: null,
});

const AUSPICIOUS = Object.freeze(['生氣', '延年', '天醫', '伏位']);
const RATING_PHRASE = Object.freeze({
  best: '最適合',
  good: '適合',
  ok: '尚可',
  avoid: '傳統上建議避開',
  worst: '傳統上最需要避開',
});

/**
 * 依家具種類與所在方位的星,給出這件家具的方位評語(白話一句)。
 * @returns {string|null} 沒有可用評比時回 null
 */
export function furnitureVerdict(kind, star) {
  if (!star) return null;
  const key = FURNITURE_MATRIX[kind];
  if (!key) return null;
  if (key === 'auspicious') {
    return AUSPICIOUS.includes(star) ? `${star}吉方,適合安座` : `${star}屬凶方,傳統上不宜安座`;
  }
  const rule = USAGE_MATRIX[key] && USAGE_MATRIX[key][star];
  if (!rule) return null;
  const phrase = RATING_PHRASE[rule.rating] || '一般';
  return `${star}位・${phrase}${rule.note ? `(${rule.note})` : ''}`;
}

/**
 * 將家具診斷轉成報告卡片
 */
export function buildFurnitureCards(items) {
  return (items || []).map((it) => {
    const label = FURNITURE_KIND_LABEL[it.kind] || '家具';
    const verdict = furnitureVerdict(it.kind, it.star);
    const dirLine = it.star
      ? `落在${it.dir}方(${it.gua}宮),此方位對外為「${it.star}」`
      : '方位待補(需先量好房子朝向)';
    const lines = [`${label}中心${dirLine}。`];
    if (verdict) lines.push(`就這件家具而言:${verdict}。`);
    if (it.cautions.length) lines.push(`需留意:${it.cautions.join(';')}。`);
    const bad = verdict && /避開|不宜/.test(verdict);
    return {
      id: `furniture.${it.id}`,
      headline: `${label}位置分析`,
      badges: ['實體擺設', it.star ? '已對照方位' : '方位待補', bad ? '方位需調整' : '方位合宜'].filter(Boolean),
      body: lines.join(''),
      level: (it.cautions.length || bad) ? 'caution' : 'good',
    };
  });
}

const FURNITURE_KIND_LABEL = Object.freeze({
  bed: '床鋪', desk: '辦公桌/書桌', stove: '爐灶', sofa: '主沙發', altar: '神位/佛龕', fridge: '電冰箱', fishTank: '魚缸/動水', tv: '電視櫃',
});

/**
 * 產出結構化的擺放摘要區塊。plan/taiji/up 有給時,連家具逐件分析一起產出。
 */
export function buildPlacementBlock(report, { plan = null, taiji = null, up = null } = {}) {
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

  const furnitureItems = analyzeFurniture(placements, plan, { taiji, up });

  return {
    placements,
    cards: [...buildPlacementCards(placements), ...buildFurnitureCards(furnitureItems)],
    furnitureItems,
  };
}

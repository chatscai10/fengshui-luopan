// 簡單模式的操作文字(docs/EASY_SPEC.md 第 5 節的「鍵」表格,逐字)。
// 風水結論與「對結果有沒有影響」的句子在 src/core/copy.js;量測共用文字在 src/ui/sensorText.js。
// 純資料與純函式,不碰 DOM。{名稱} 是代入值,一律經 fillText 代換。

export const EASY_TEXT = Object.freeze({
  // 5.1 共用外框
  'steps.label': '步驟',
  'steps.facing': '量方向',
  'steps.layout': '選格局',
  'steps.result': '看財位',
  'steps.count': '第 {n} 步,共 3 步',
  'steps.back': '回到第 {n} 步:{name}',
  'intro.toast': '已切到簡單模式。原本的完整功能在右上角「完整功能」。',
  'mode.toPro': '完整功能',
  'mode.toProAria': '切換到完整功能:羅盤、住宅、平面圖、財位、報告五個分頁',
  'mode.toEasy': '簡單模式',
  'mode.toEasyAria': '切換到簡單模式:三個步驟看財位',
  'common.undo': '復原',
  'common.back': '上一步',
  'common.dir': '{dir}方',
  'view.aria': '簡單模式',

  // 5.2 1A 說明
  'a.title': '量出大門朝哪個方向',
  'a.lead': '先量大門朝哪邊,App 就能幫你找財位。大約 30 秒。',
  'a.step1': '站在屋內、離大門一大步(約 1 公尺),面向大門。',
  'a.step2': '手機平放在胸前,螢幕朝上,手機頂端朝向大門外。',
  'a.step3': '先拿掉磁吸手機殼,也離鐵門、冰箱、冷氣遠一點。',
  'a.start': '開始量',
  'a.starting': '啟用中…',
  'a.iosNote': '按下後,iPhone 會詢問是否允許「動作與方向」,請按「允許」。',
  'a.manual': '不能用指北針?直接選方向',
  'a.help': '手機指北針準嗎?',

  // 1B 對準
  'b.title': '慢慢轉身,讓手機頂端對準大門外',
  'b.pointer': '手機頂端',
  'b.headLabel': '手機頂端朝向',
  'b.reading': '讀取中…',
  'b.paren': '({paren})',
  'b.degree': '約 {deg} 度',
  'b.live': '手機頂端朝向{text}',
  'b.lock': '記下這個方向',
  'b.stop': '停止,改成自己選方向',
  'b.dialAria': '方向圈,手機頂端目前朝向{dir}方',

  // 1C 取平均
  'c.locking': '請保持不動… {n} 秒',
  'c.tooFew': '樣本不足,請再等一下。請再按一次「記下這個方向」,這次手機保持不動。',
  'c.cancelled': '剛剛中斷了,請再按一次「記下這個方向」。',

  // 1D 量測結果
  'd.title': '大門朝:{text}',
  'd.degree': '約 {deg} 度',
  'd.item': '第 {i} 次:{deg} 度',
  'd.dropped': '不採用',
  'd.use': '用這個方向',
  'd.again': '移一步,再量一次',
  'd.againHint': '往左或右移一大步(約 1 公尺),一樣面向大門再量。兩次差不多,就代表附近沒有東西在干擾。',
  'd.third': '再量第 3 次',
  'd.thirdHint': '往屋內走兩三步,離大門遠一點,一樣面向大門外再量一次。',
  'd.useAnyway': '還是用這個結果',
  'd.toManual': '改成自己選方向',
  'd.restart': '全部重量',
  'd.saved': '已記下:大門朝{dir}方',
  'd.systematic': '不過如果整棟大樓鋼筋很多,幾次也可能一起偏;想更放心,可以用地圖對一次(見「手機指北針準嗎?」)。',

  // 1D 自我檢查結論句(checkVerdictText 使用;表格沒有鍵名,這裡以 verdict 命名)
  'verdict.single-ok': '量得很穩,手沒有晃。想更放心,可以走一大步再量一次比對。',
  'verdict.single-noacc': '量得很穩,手沒有晃。不過這支手機不會告訴我們它自己的誤差,穩不代表準。建議走一大步再量一次,兩次一樣就比較放心。',
  'verdict.single-wide': '手機自己估計,可能差 {acc} 度左右,有點大。建議離鐵門、冰箱、電器遠一點,走一大步再量一次。',
  'verdict.single-unstable': '這 {s} 秒讀數晃得比較多(約 {sigma} 度),附近可能有會干擾的東西。建議移一步再量一次。',
  'verdict.agree': '{n} 次只差 {d} 度,附近沒有明顯干擾。',
  'verdict.warn2': '兩次差 {d} 度,有點多。可能其中一個位置附近有鐵門、電器或鋼筋。建議再量第 3 次。',
  'verdict.warn2-ok': '兩次差 {d} 度,但兩次都是{dir}方。想更放心,可以再量第 3 次。',
  'verdict.warn3': '三次最多差 {d} 度,有點多,結果僅供參考。',
  'verdict.far': '兩次差 {d} 度,差很多,附近很可能有東西在干擾指北針。建議換到離鐵門和電器遠一點的地方再量,或改成自己選方向。',
  'verdict.dropped': '第 {k} 次和另外兩次差很多,已經不採用;另外兩次只差 {d} 度,附近沒有明顯干擾。',
  'verdict.inconsistent': '三次結果都不太一致,平均值可能不準。建議改成自己選方向,或請老師用實體羅盤確認。',

  // 1M 自己選方向:原因列
  'm.noSensor': '這台裝置沒有指北針(電腦通常沒有),請直接選大門朝哪個方向。',
  'm.noEvents': '偵測不到方位感測器,請直接選大門朝哪個方向。',
  // {message} = sensorMessage(status) + DENIED_HELP(sensorSession 的 state.message 已接好)
  'm.denied': '{message}。請直接選大門朝哪個方向。',
  'm.relative': '這台裝置無法提供指北資料,請直接選大門朝哪個方向。',
  'm.inApp': '你現在是在 {app} 裡面開的網頁,這裡可能不能用指北針。請用 Safari 或 Chrome 打開這個網址再試一次。',
  // 1M 內容
  'm.title': '大門朝哪個方向?',
  'm.lead': '站在屋內面向大門,想想門外是哪一邊。',
  'm.map1': '不確定的話:打開 Google 地圖,先按右上角的小指北針,讓地圖轉回北在上面。',
  'm.map2': '找到你家,看大門面對的街道在房子的哪一邊。',
  'm.center': '你家',
  'm.cellAria': '大門朝{dir}方',
  'm.picked': '已選:{dir}方',
  'm.note': '選大概的方位就可以。方向差一點會不會換財位,後面會告訴你。',
  'm.degTitle': '知道確切度數?',
  'm.degLabel': '大門朝向度數(0 到 359.9)',
  'm.degHint': '北是 0、東是 90、南是 180、西是 270。',
  'm.degPlaceholder': '例如 225',
  'm.degEmpty': '請輸入 0 到 359.9 之間的數字',
  'm.degNan': '只能輸入數字,例如 175 或 175.5',
  'm.degRange': '度數要在 0 到 359.9 之間',
  'm.typed': '已輸入:{deg} 度,是{text}',
  'm.use': '用這個方向',
  'm.retrySensor': '再試一次手機指北針',

  // 1S 已記下
  's.title': '大門朝:{text}',
  's.sensorMulti': '約 {deg} 度 · 手機量了 {n} 次,相差 {d} 度',
  's.sensorDropped': '約 {deg} 度 · 手機量了 {n} 次(1 次不採用),相差 {d} 度',
  's.sensorOne': '約 {deg} 度 · 手機量了 1 次',
  's.pick8': '自己選的大方位',
  's.typed': '自己輸入的度數:{deg} 度',
  's.other': '約 {deg} 度',
  's.doorSep': '完整功能裡另外設定了房子朝向(約 {deg} 度)。這裡看的是大門朝向;在這裡重新量的話,兩個會合成同一個方向。',
  's.next': '就用這個,下一步',
  's.remeasure': '重新量',
  's.manual': '改成自己選方向',

  // 5.3 步驟 2:選格局
  'l.title': '你家大概長什麼樣子?',
  'l.lead': '選一個最像的格局,就能在圖上標出財位在哪個角落。大概像就好,不用很準。',
  'l.cardAria': '{label}:{desc},{size}',
  'l.desc.studio': '客廳加一間小臥室、小廚房、廁所,約 10 坪',
  'l.desc.two': '客廳、廚房、兩間房間、廁所,約 19 坪',
  'l.desc.three': '客廳、餐廳、三間房間加一間書房,約 30 坪',
  'l.desc.shop': '一間店面,後面是倉庫和廁所',
  'l.doorTitle': '大門在哪一邊?',
  'l.doorLead': '站在進門的那個空間(通常是客廳)中間,面向有大門的那面牆。大門在這面牆的哪一邊?',
  'l.left': '左邊',
  'l.center': '正中間',
  'l.right': '右邊',
  'l.previewNote': '圖的上方就是大門那一面,金色是大門。',
  'l.next': '下一步',
  'l.skip': '都不像,先跳過',
  'l.applied': '已套用「{label}」',
  'l.removed': '已拿掉格局',
  'l.cantMove': '這個格局的大門放不到那個位置,先保留原本的位置。',
  'l.ownTitle': '你已經畫好平面圖了',
  'l.ownLead': '會直接用你在完整功能裡畫的平面圖。想修改的話,請到完整功能的「平面圖」。',
  'l.ownNext': '下一步',
  'l.ownEdit': '到完整功能修改',

  // 5.5 步驟 3:看財位
  'r.retest': '大門的方向剛好在「{a}」和「{b}」兩個方位的分界附近,差幾度結果就可能不同。建議回第 1 步再量一次。',
  'r.retestBtn': '重新量方向',
  'r.shaky': '上次量的時候讀數有點晃,結果僅供參考,建議改天再量一次。',
  'r.mapNote': '金色「財」字就是財位。圖的上方是大門那一面。',
  'r.dirNote': '金色那一塊是比較有利的方位。圖的上方是大門那一面。',
  'r.inHouse': '在房子的{dir}方',
  'r.frame': '前、後、左、右都是以「站在屋內、面向大門」來說。',
  'r.remedyTitle': '先處理這一點',
  'r.tipsTitle': '財位佈置的傳統說法',
  'r.tipsNote': '屬民俗性質,請依自己的空間與習慣調整。',
  'r.moreTitle': '想看更完整的分析?',
  'r.morePlan': '選一個像你家的格局,就能指出是家裡的哪個角落。',
  'r.morePlanBtn': '選格局',
  'r.moreYear': '知道房子哪一年蓋好的話,填上後會多參考一種依建成年份推算的傳統方法。這個方法對方向比較敏感,手機差幾度就可能換位置。不知道就不用填。',
  'r.yearLabel': '建成年份',
  'r.yearPlaceholder': '例如 2005 或 民國 94',
  'r.yearRoc': '民國 {roc} 年 = 西元 {year} 年',
  'r.yearHint': '可以看房屋權狀、建物謄本,或問房東、管委會。',
  'r.yearSave': '填好了',
  'r.yearSaved': '已記下建成年份 {year} 年',
  'r.moreResidents': '填上家人的出生日期與性別,建議會更貼近你(選填)。',
  'r.moreResidentsBtn': '到完整功能填寫',
  'r.othersTitle': '其他可以考慮的位置({n})',
  'r.showing': '圖上標示:{place}',
  'r.backToBest': '回到最佳位置',
  'r.done': '完成',
  'r.doneToast': '已幫你記好,下次打開會直接看到結果。',
  'r.full': '看專業版分析(名詞較多)',
  'r.remeasure': '重新量方向',
  'r.editLayout': '修改格局',
  'r.moreDisclaimers': '更多說明',
  'r.errTitle': '暫時算不出財位',
  'r.errBody': '目前填的資料算不出結果,資料沒有遺失。可以回到第 1 步重新量,或到完整功能檢查。',
  'r.errStep1': '回到第 1 步',
  'r.errPro': '到完整功能檢查',

  // 5.6 設定面板的「介面」分組
  'set.group': '介面',
  'set.label': '畫面模式',
  'set.help': '簡單模式只問幾件事就告訴你財位;完整功能有專業羅盤、住宅資料、平面圖編輯與詳細報告。',
  'set.easy': '簡單模式',
  'set.pro': '完整功能',
});

/** 允許出現術語的鍵(目前沒有;玄空相關句子放在 copy.js)。 */
export const EASY_TEXT_ADVANCED_KEYS = Object.freeze([]);

/**
 * 取出文字並代換 {名稱}。鍵不存在、或代換後仍留有 {…}(漏給值)都丟例外,讓錯誤在測試就被抓到。
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function fillText(key, vars = {}) {
  if (!Object.prototype.hasOwnProperty.call(EASY_TEXT, key)) throw new Error(`EASY_TEXT 沒有這個鍵: ${key}`);
  const v = vars || {};
  // 只檢查範本本身的 {名稱};代入值裡剛好有大括號(例如使用者取的房間名)不算漏給
  return EASY_TEXT[key].replace(/\{(\w+)\}/g, (m, name) => {
    if (!Object.prototype.hasOwnProperty.call(v, name) || v[name] == null) throw new Error(`EASY_TEXT ${key} 缺少代入值 ${m}`);
    return String(v[name]);
  });
}

# 羅盤盤面環資料與視覺規範:獨立驗證報告(luopan_rings.verify)

- 驗證者角色:獨立懷疑論者(預設原報告有錯,查證通過才算數)
- 被驗證檔案:`fengshui/docs/research/luopan_rings.md`、`fengshui/test/fixtures/luopan_rings.json`(72 個 case)
- 驗證日期:2026-09-29
- 網路狀態:WebFetch 與 curl 可用;**WebSearch 本 session 額度已用完(200/200)**,所以本次沒有用新搜尋詞找新網站,而是「重新抓原文逐字核對 + 另抓不同頁面 + 用程式重算」。凡是只能引用原報告同一來源的,都在下面明講「非獨立來源」。
- 本檔沒有修改任何既有檔案,沒有 git commit。腳本放在暫存目錄,未進專案。

## 0. 總結

**overall = needs-fixes(有幾處需更正,但都可修,核心資料可靠)**

- 核心資料表(24 山、三元龍、兩套陰陽、八卦洛書、28 宿開禧宿度、節氣環、座向讀數、文字沿弧與手勢公式)全部用程式獨立重算,與 fixture 一致。
- 需要更正或降級的有 5 處:
  1. **節氣環寬度設計自相矛盾**:環寬 12.4px,卻要放「2 字徑向堆疊、10.5px 字」(至少需要約 21.4px)。
  2. **「所有字底組合對比度 ≥ 4.5:1」說過頭**:只驗了 lacquer_800 底。五行色在 lacquer_700/600 交錯格底上不合格(火 4.39 / 3.94、水 4.53 / 4.06)。
  3. **一百二十分金「八干四維沿用前一位地支」只有單一來源**,而 fixture 有兩筆查表(337.5→乙亥、7.5→甲子)直接依賴它,應降為低信心。
  4. **Apple 字型描述不精確**:Kaiti TC 在 macOS 也是 downloadable,不是「macOS 有」。結論(要內嵌字型)不變、反而更強。
  5. **fixture 的六十四卦名稱鍵不一致**:卦名列表用「無妄」,`unicode_by_name` 的鍵卻是「无妄」,用名稱查會查不到。
- 另外發現一個原報告手勢程式碼的小 bug(停頓後放手會誤觸發甩動),與資料無關,列在第 3 節。

## 1. 逐條驗證(規則 → 判定 → 證據 → 更正)

判定標示:confirmed(確認)/ refuted(推翻)/ uncertain(無法確認)。「部分推翻」寫在證據裡,並在 JSON 回報以 refuted 或 uncertain 標出需更正的那一部分。

### R1. 座標與 24 山幾何(北在上、順時針、子中心 0°、每山 15°、半開區間、Canvas=(b-90)°)— confirmed

- 程式重算:24 山順序 `子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥壬`,中心 15i、起迄 (15i-7.5, 15i+7.5),fixture 24/24 相同。
- 我另外重新抓 zh.wikipedia「羅庚」原始 wikitext(https://zh.wikipedia.org/w/index.php?title=羅庚&action=raw),表格為 壬(337.5-352.5) 子(352.5-7.5) 癸(7.5-22.5) …… 亥(322.5-337.5),與 fixture 一致。(此為原報告 S01 同一來源,但我自己重抓並核對;24 山範圍本身也是通行常識。)
- 已用程式重算,結果一致。

### R2. 八卦宮歸屬與三元龍(宮內順時針:地元、天元、人元;`palace=floor(((i+1)%24)/3)`、`yuan=(i+1)%3`)— confirmed

- 我用「傳統三元龍集合」獨立分類:天元=子午卯酉乾坤艮巽、地元=辰戌丑未甲庚壬丙、人元=寅申巳亥乙辛丁癸,與公式對 24 山逐一比對,24/24 一致。
- 證據 URL(不同於原報告的採用點):https://blog.csdn.net/qq_42971998/article/details/137604537 原文「子、午、卯、酉、乾、坤、艮、巽为天元龙;甲、庚、丙、壬、辰、戌、丑、未为地元龙;乙、辛、丁、癸、寅、申、巳、亥为人元龙」;https://www.sohu.com/a/346292839_435999 同樣列出。兩者對集合一致。
- 已用程式重算,結果一致。

### R3. 三元龍陰陽(天元乾坤艮巽陽/子午卯酉陰;地元壬丙甲庚陽/辰戌丑未陰;人元寅申巳亥陽/乙辛丁癸陰;從艮起 3 陽 3 陰)— confirmed

- 程式重算:陽集合 12 個相同;自艮起排出 `陽陽陽陰陰陰` 重複 4 次。
- 證據:sohu 346292839_435999 原文「地元龙之壬、丙、甲、庚为阳,丑、未、辰、戌为阴;天元龙之乾、巽、艮、坤为阳,子、午、卯、酉为阴;人元龙之寅、申、巳、亥为阳,癸、丁、乙、辛为阴」;csdn 137604537 的三元龍分類同。
- 已用程式重算,結果一致。

### R4. 三合紅黑字(紅=陽:子癸申辰午壬寅戌乾甲坤乙)— confirmed

- 我用「乾甲、坤乙、坎(子)癸申辰、離(午)壬寅戌」自己重推陽集合 12 個,與 fixture 完全相同;陰集合為艮丙巽辛卯庚亥未酉丁巳丑(補集)。
- 佐證:sohu 346292839_435999 舉例「乾方來龍、立坤向、收午水,均屬陽;酉向、收丁未,均屬陰」,與此集合吻合。
- 注意(非推翻):同一頁把「三合紅黑」與「三元龍陰陽」明說為兩套不同分法,報告的「兩套並存、預設三元龍」設計合理。
- 已用程式重算,結果一致。

### R5. 三針偏移(人盤中針 = 逆時針 7.5°、子中心 352.5°;天盤縫針 = 順時針 7.5°、子中心 7.5°)— confirmed

證據有三條,方向都指向報告的值:
1. http://www.wawlhld.com/m/lpzs/213.html 逐字:中針「逆时针转半格,即丁午与子癸的格缝正对正针子午」;縫針「顺时针转半格,即丙午与子壬的格缝正对正针子午」。把「格縫對正針子午」換成子中心:人盤 午中心 172.5(即 -7.5)、天盤 壬|子縫在 0°(即子中心 +7.5)。
2. http://www.fushantang.com/1012/1012a/j0110.html(此站憑證錯誤,我用 curl -k 讀取,big5 解碼)逐字:「人盤比地盤是逆時針旋轉了7.5度,天盤比地盤順時針旋轉了7.5度」。
3. 我重新用另一條路徑檢驗:https://www.yixiansheng.com/article/4538.html 把 28 宿配到「人盤」24 山並給圓周度(虛 360–9 在人盤「癸」、危 344–360 在人盤「子」、室 326–344 在人盤「亥壬間」)。若人盤子中心是 -7.5°,人盤癸 = 0–15°、子 = 345–360°,與該文完全吻合;若是 +7.5° 則危會落在「壬」,對不上。
- 相反說法:https://www.sohu.com/a/455508170_120828853 寫「人盘较地盘右移了7.5度,天盘较地盘左移了7.5度」(我確認原文如此)。這是「子午刻度」左右的措辭,方向與上述三處相反,無法與「格縫對正針子午」的精確敘述並存;採前三者。此分歧報告已列入,做法正確。
- 已用程式重算(9 筆 lookup fixture)結果一致。

### R6. 二十八宿開禧宿度(28 個古度寬合計 365.25 縮進 360°;虛起於 0°;宿序反著走;午中落張第 3 度;最大差 0.71°)— confirmed(信心:中)

- 我重新抓 https://www.163.com/dy/article/DRK38TTS0528KPTC.html 原文宿度表(角12.75 亢9.75 氐16.25 房5.75 心6 尾18 箕9.5 斗22.75 牛7 女11 虛9.25 危16 室18.25 壁9.75 奎18 婁12.75 胃15.25 昴11 畢16.5 觜0.5 參9.5 井30.25 鬼2.5 柳13.5 星6.75 張17.75 翼20.25 軫18.75),加總 365.25,與報告相同。
- 該文逐字:「南方午山(地盘正针)的正中位置在张宿第三度里面。地盘正针子山中央,正好是虚日鼠、危月燕的中间」。我重算 ruSu(180°)= 張 2.125 度,落第 3 度內,吻合。
- 我以自己的程式重排 28 宿(虛起於 0°、逆序),與 fixture `xiu28_bearing_layout_kaixi` 28/28 相同;8 筆 `xiu28_lookup_*` 全對;十二次粗表比對只有畢、柳兩宿不一致,與報告相同。
- 與 yixiansheng 4538 的圓周度比對:除該文自己的筆誤(翼起 142、井迄 244,原報告已更正)外,各宿邊界差 ≤ 0.71°(該文以整數四捨五入,系統性偏差屬預期)。
- 提醒:yixiansheng 4538 頂部清單把危寫成「十度太」,但同文圓周度表是 344–360(16 度),是筆誤;該文「共計三百五十五度半」也與實際總和不符(整數部分和 354、加分數後 365.25)。這兩處報告沒提,不影響結論。
- **獨立性限制**:S12、S11 都是同一條羅盤口傳表的轉載,不是兩個獨立的天文來源。「開禧宿度」是羅盤行業慣用名,本表數值與宋代實測距度並不相同(例如斗 22.75 對漢古度 26),所以信心維持「中」。我沒有找到第三個獨立來源,WebSearch 額度耗盡。
- 已用程式重算,結果一致。

### R7. 28 宿窄格可讀性(13px 字、r6 中徑 149.4px、最小角寬 4.99°;觜 0.49°、鬼 2.46° 需引線;房 5.67°、心 5.91°、星 6.65°、牛 6.90° 偏窄)— confirmed(有一處小不一致)

- 程式重算:觜 0.493、鬼 2.464、房 5.667、心 5.914、星 6.653、牛 6.899;13/149.4 rad = 4.986°,與報告一致。
- 小不一致:149.4 = 0.83×180(用整個外半徑),但同一份報告的環寬表用 0.83×177 得 r6 中徑 147px,對應最小角寬 5.07°。兩者差 1.7%,結論(觜、鬼不合格,其餘在 5° 以上)不變,fixture `xiu28_narrow_labels_360px` 只需統一半徑基準。

### R8. 一百二十分金 — 分成兩半判定

- (a)每山 5 格 × 3°、起點壬|子縫 352.5°、子山為甲子丙子戊子庚子壬子、陽支甲丙戊庚壬/陰支乙丁己辛癸、60 甲子各恰 2 次、旺相(丙丁庚辛)48 格 — **confirmed**。
  - 證據:http://www.wawlhld.com/m/lpzs/213.html 逐字「其排法是甲子始于子方,即子山十五度由甲子、丙子、戊子、庚子、壬子五个三度组成」「一百二十分金恰好两个六十甲子」「仅有四十八个分金可用」;https://www.163.com/dy/article/HJT97HRR0553X9QG.html 逐字「在地盘正针的壬山与子山之间甲子顺时针排列」「丑山有乙丑、丁丑、己丑、辛丑、癸丑」;Google Groups FengShuiPro(WebFetch)明列「子山:甲子丙子戊子庚子壬子、丑山:乙丑丁丑己丑辛丑癸丑」。
  - 我用自己重寫的程式檢查:120 格、60 個不同甲子各 2 次、旺相 48 格,一致。午向 174° = 甲午,https://www.sohu.com/a/346292839_435999 逐字「午向的174度,是甲午分金」,吻合。
- (b)「八干四維山沿用前一位地支的五個分金」(癸=子的、艮=丑的、甲=寅的、壬=亥的 …… )— **uncertain**。
  - 只有 163.com HJT97HRR0553X9QG 明說此規則;同一篇另有「甲山…甲寅、丙寅…因為甲課在寅」「乙山=乙卯…」等舉例,內部一致,但沒有第二個獨立來源。
  - 另一來源 http://www.taijizhidian.net/zhuanzaisuibi/215.html 只說「每干支歸入同組之地支」,沒說「同組」是前一位還是後一位(三合雙山慣用 壬子/癸丑/艮寅/甲卯 這種「干在前、支在後」的配對,若「同組」照雙山配對,則會變成沿用「後一位地支」,與報告相反)。wawlhld 213 只說 120 分金「其配法同七十二龍」,沒有講八干四維。
  - 影響:fixture 的 `fenjin120_lookup_337.5`(乙亥)與 `fenjin120_lookup_7.5`(甲子)、以及 `fenjin120_table` 的 12 個八干四維山,全部依賴這條規則。
  - 建議:維持「只做即時讀數」;八干四維山的分金標「單源、待驗」,或在 UI 上只顯示地支山(子丑寅…)的分金,四維/八干山不顯示,直到找到第二個來源。

### R9. 六十四卦環(圓圖序、乾盡午中錨點)— 順序 confirmed,角度錨點 uncertain

- 順序:我用「下卦宮序 乾兌離震巽坎艮坤 × 上卦同序」與自己記得的 64 卦上下卦對照(乾下坎上=需、坎下乾上=訟、坤下乾上=否、艮下坤上=謙、兌下艮上=損、巽下乾上=姤 …… 逐一核對),fixture 的 64 個名稱位置全部正確。
- 角度:fixture 規則(乾[174.375,180)、復[0,5.625)、姤[180,185.625)、坤[354.375,360))我重算一致。與邵雍「冬至子之半」(復起於子中)在概念上吻合,但我抓 zh.wikisource 皇極經世書/卷十三 查不到「午中/子中」原句(https://zh.wikisource.org/wiki/皇極經世書/卷十三),也沒有第二個可取得的來源,所以錨點維持 uncertain。因為預設不放,風險低。

### R10. 座向與正兼向讀數(向=朝向所在山、坐=對宮、正向中間 9°(±4.5°)、大空亡 8 條=八卦交界、小空亡 16 條=宮內山界)— confirmed(流派寬度有分歧)

- 6 筆 facing fixture 我用獨立程式重算全對。
- 大空亡線 = 22.5+45k(癸|丑、寅|甲、乙|辰、巳|丙、丁|未、申|庚、辛|戌、亥|壬)、小空亡 = 宮內山界 16 條,與定義一致。
- 證據:https://blog.csdn.net/qq_42971998/article/details/137604537 逐字「中间9度为正向,9度以外为兼向和空亡,山与山之间为小空亡,卦与卦之间为大空亡」;https://www.bigpeak.net/portal/article/index.html?id=15 第 20 層「正兼向度數指標(地盤各山九度之內)」;https://www.163.com/dy/article/DRK38TTS0528KPTC.html 逐字「压二十四山的交界线,为小空亡。八宫的交界线,为大空亡」。
- ±3° 說法我也沒找到來源,維持「僅作視覺提示、寬度可調」是穩妥的。

### R11. 配色與紅線慣例、磁針顏色 — 慣例 confirmed;「全部對比度 ≥ 4.5」被推翻

- 磁針/海底線/天心十道:Google Groups FengShuiPro(WebFetch)逐字「磁針居於中,紅頭指向南方,黑頭指向北方」「海底線…在北端兩側有兩個紅點」;https://www.88s1.com/mobile_ReadNews.asp?id=1819 逐字「指南针有箭头的那端所指的方位是南…天池的底面上绘有一条红线,称为海底线,在北端两侧有两个红点」「天心十道…红线」。**confirmed(信心:中)**。
- 「黑底金字=陰、金底紅字=陽」:http://www.taijizhidian.net/zhuanzaisuibi/215.html 逐字「罗盘上之黑底金字属于阴,而金底红字属于阳」,但那是**三元盤的 24 山陰陽層**。同一頁講一百二十龍分金時,「金底紅字」的意思是「吉利線度(丙丁庚辛)」,含義不同。App 若把 24 山格與分金格都用紅字,要在圖例分開說明,避免誤讀。
- 對比度:我用 WCAG 2.x 公式重算報告表 11 筆,全部相同(9.19、11.74、5.98、5.39、9.69、15.66、6.58、4.77、8.05、14.07、4.91)。木紋主題三筆也一致(6.08、9.09、5.05、3.38)。
- **推翻的部分**:「所有字底組合對比度 ≥ 4.5:1(最低 4.77)」只對 lacquer_800 底成立。報告自己指定 lacquer_700 為「交錯格底(節氣、八卦)」、lacquer_600 為「28 宿交錯格底」。五行色文字放在這兩種底上:
  - wx_fire #E0503D:lacquer_700 = 4.39、lacquer_600 = 3.94(不合格)
  - wx_water #4E86C6:lacquer_700 = 4.53(剛好過)、lacquer_600 = 4.06(不合格)
  - cinnabar_300 on lacquer_600 = 4.94(過)、gold/ivory 全過
- 更正:五行色文字只放在 lacquer_800/900 底,或把 wx_fire 提亮為 `#EC6A57`(800/700/600 底分別 5.99/5.52/4.95)、wx_water 提亮為 `#6A9CDC`(6.55/6.04/5.41)。已用程式重算。另外 13px 粗體不算 WCAG「大字」,不能用 3:1 門檻放寬。

### R12. 效能、旋轉與手勢(畫一次 + CSS rotate;DPR≤3;iOS canvas 面積上限;Pointer Events;慣性 τ=0.5s)— confirmed,附一個程式碼 bug

- iOS 上限:https://lionpuro.com/posts/canvas-is-finally-usable-on-safari/ 逐字「4096x4096」「a total area of 16,777,216 pixels」;iOS 18 起「8192x8192」「67,108,864 pixels」。與報告一致。報告寫「iOS 18 起 8192²」沒錯,但可補上面積 67,108,864。
- 「iOS 15 約 384MB 總量限制」我沒有取得來源,標 uncertain(不影響設計:只開兩張畫布)。
- 公式驗證:拖曳展開 `((a-last+540)%360)-180` 對 fixture 4 組輸入(170→-170=+20、-170→170=-20、10→25=+15、359→1=+2)全對;慣性總轉角 ω0·τ = 360×0.5 = 180° 對;Canvas 角度 (b-90)° 對。
- **程式碼 bug(不是資料錯誤)**:報告的 pointermove 只在有移動事件時才更新 `om`。手指按住不動 1 秒再放開,`om` 仍是上一次移動的速度,放手後盤面會突然甩出去。修法:放手時若 `performance.now() - lastT > 80ms` 就把 `om` 設為 0。

### R13. 文字沿弧與字距(translate+rotate 公式;不依賴 letterSpacing)— confirmed

- 重算 `arc_text_transform_*` 六筆(0/90/180/270 外朝、180 內朝)與 `arc_text_multichar_angles*` 兩筆,全部一致;推導:字頭朝外時閱讀方向為順時針,底部字頭朝內時閱讀方向為方位角遞減,fixture 的 [185,180,175] 正確。
- MDN letterSpacing:https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing 顯示「Baseline 2025 - Newly available」「Since March 2025」,與報告一致。createConicGradient:https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createConicGradient 顯示 Widely available、自 2023-04 起,一致。

### R14. 字型策略 — 大方向 confirmed,Apple 敘述需更正

- **推翻的部分**:報告表格寫 macOS「有 Kaiti TC、BiauKai(標楷)」。WebFetch https://developer.apple.com/fonts/system-fonts/ 顯示 Kaiti SC/TC 的 Regular/Bold/Black 都是「iOS downloadable、macOS downloadable」(兩個平台都要下載);BiauKai(Regular)只列「iOS downloadable」;BiauKaiTC 為「iOS downloadable、macOS downloadable」。所以 macOS 也不是預載。更正:iOS 與 macOS 皆為 downloadable,離線 App 更需要內嵌字型。
- KaiTi(Windows):https://learn.microsoft.com/en-us/typography/font-list/kaiti 逐字「KaiTi is a Simplified Chinese font」,檔名 Simkai.ttf,confirmed。
- 全字庫授權:https://www.cns11643.gov.tw/pageView.jsp?ID=59 顯示政府資料開放授權條款-第1版 與 OFL-1.1 兩種並列,顯名文字為「數位發展部,CNS11643中文標準交換碼全字庫網站,https://www.cns11643.gov.tw」;OFL 路線須附著作權聲明與 OFL 全文。confirmed。
- 霞鶩文楷 TC:https://github.com/lxgw/LxgwWenKaiTC SIL OFL 1.1、README 建議台標字形改用 Iansui。confirmed。
- 未驗證(維持原報告的自承):TW-Kai `fsType`、子集大小、字表涵蓋。我沒有下載字型檔(下載需要使用者同意)。

### R15. 傳統環序共通規律 — confirmed

- 我直接下載並看過 https://upload.wikimedia.org/wikipedia/commons/c/c2/Luopan.jpg 的圖例:第 4 層地盤正針二十四山、第 5 層二十四節氣、第 6 穿山七十二龍、第 7 二百二十龍、第 8 人盤中針二十四山、第 9 人盤中針一百二十龍、第 14 天盤縫針二十四山、第 15 天盤縫針一百二十龍、第 18 層二十八宿三環最外,與報告表格完全相同。
- 節氣環緊貼地盤外側:http://www.taijizhidian.net/zhuanzaisuibi/215.html「第六層二十四节气。二十四节气立春始艮、大寒终丑」;照片第 5 層。
- 小提醒:報告文字說 S18 節氣是「第 6 層」,但表格裡 S18 節氣在第 7 列(天池算第 1),是編號基準不一致(fixture 註明用第 0 層起算),不影響結論。

### R16. 節氣環對位(冬至=子 … 大雪=壬)— confirmed(比原報告的「單源」強)

- 程式重算:24 節氣依序對 24 山、每格 15°,fixture 一致;冬至 270° 黃經起算、每節氣相隔 15°,二分二至落在子午卯酉,合天文。
- taijizhidian 215「立春始艮、大寒終丑」+ 照片第 5 層位置。逐項「節氣↔山」表仍只有原報告 S19 可交叉,信心維持「中」。

### R17. 手機版環配置(模式 A 8 環、模式 B 9 環)— 環數與連續性 confirmed;節氣環寬度被推翻

- 重算 fixture:兩種模式 r0/r1 連續、最外 0.985/0.986,環寬(以 R=177 計)35.4/35.4/14.2/31.9/5.3/12.4/24.8/15.0 與報告表格一致。
- **推翻**:r5 二十四節氣環寬僅 0.07R = 12.4px,報告卻規定「每節氣 2 字**徑向堆疊**、字級 10.5px」。按報告自己的 `stack()`(字距 1.02×字級),2 字需要 ≥ 2×10.5×1.02 ≈ 21.4px,超出 9px。
- 更正(二選一):a) 把 r5 加寬到 ≥ 0.125R(約 22px),其餘環等比縮;b) 節氣改成兩字沿切線並排(15° 弧在 r=128px 處約 33px,可放 2 個 10.5px 字)。fixture `layout_rings_A_solarterms` 的 confidence=high 應降為 medium。
- 模式 B 的 r5a/r5b(11.6px 環放單字 10px)與 r6、r7 沒有問題。

### R18. 八卦、洛書與先天卦位 — confirmed

- 重算:後天卦位 坎0 艮45 震90 巽135 離180 坤225 兌270 乾315、洛書 坎1 坤2 震3 巽4 乾6 兌7 艮8 離9、卦爻 乾111 兌110 離101 震100 巽011 坎010 艮001 坤000、五行(震巽木離火坤艮土兌乾金坎水),fixture 16 筆(後天 8 + 先天 8)全對。先天位置 乾南坤北離東坎西兌東南震東北巽西南艮西北,https://zh.wikipedia.org/wiki/先天八卦 逐字一致。
- 洛書南上格 `4 9 2 / 3 5 7 / 8 1 6` 各線和 15;南上時東在左,與 zh.wikipedia 八卦條目「前南後北…左东右西」一致,https://zh.wikipedia.org/wiki/八卦。「南上開關 = 整盤 +180°」數學上正確(旋轉不是鏡像)。
- 傳統盤「先天為體、後天為用」:taijizhidian 215「第一层先天八卦文,后天八卦方位,先天为体,后天为用」。

### R19. 24 山五行(本五行)與九星色 — confirmed(低風險)

- 本五行 24 山我逐一核對(干支自身 + 乾金坤土艮土巽木),與 fixture 相同;九星色 一白二黑三碧四綠五黃六白七赤八白九紫為通行常識,單源信心「中」維持。

## 2. fixtures 抽驗結果

72 個 case 中,我用獨立程式(重寫算法,不重用作者程式)重算:24 山幾何 24 筆、三元龍與陰陽 2 集合、三合紅黑集合、本五行、後天八卦 8 筆、先天八卦 8 筆、lookup 9 筆(三盤)、28 宿排列 28 筆 + lookup 8 筆、十二次比對、120 分金 8 筆 + 全表統計、facing 6 筆、arc_text 7 筆、drag 4 筆、Canvas 角度 4 筆、慣性、節氣環 24 筆、64 卦順序與角度、對比度 11 筆、版面 2 種。數值皆與 fixture 一致(除下列問題)。

### fixtureIssues(含更正值)

1. `hexagram64_xiantian_circle_order`:`names`/`ring` 用「無妄」,`unicode_by_name` 鍵是「无妄」,按名稱查 Unicode 會缺 1 筆。更正:統一為「無妄」(U+4DD8)。
2. 同 case:坤(index 63)`end` 寫 `0.0`,應寫 `360.0` 或註明跨 0° 用 (b-start) mod 360 判斷,否則單純比大小會判成空區間。
3. `palette_contrast`:只含 lacquer_800/gold_500 底的 11 組;報告自己規定的 lacquer_700、lacquer_600 底沒有測。應新增組合:wx_fire on lacquer_700 = 4.39(不合格)、wx_fire on lacquer_600 = 3.94(不合格)、wx_water on lacquer_700 = 4.53、wx_water on lacquer_600 = 4.06(不合格),並把「所有字底組合 ≥ 4.5」改為「限 lacquer_800/900 底」。
4. `layout_rings_A_solarterms`:r5 環寬 0.07(12.4px)放不下 2 字徑向堆疊(需 ≥ 21.4px);confidence 由 high 降為 medium,並修環寬或改切線並排。
5. `xiu28_narrow_labels_360px`:`mid_radius_px=149.4`(0.83×180)與版面表的 147px(0.83×177)基準不同;統一後 `min_deg` 為 4.99(R=180)或 5.07(R=177),結果集合 ["觜","鬼"] 不變。
6. `fenjin120_lookup_337.5`(乙亥)、`fenjin120_lookup_7.5`(甲子)、`fenjin120_table` 八干四維 12 個山:依賴單源規則(見 R8-b),應加 `confidence: low` 標記,不要當硬規範。
7. `charset_for_font_subset`:core 117 字缺「山、宮、朝」,但報告自己的讀數範例「朝向 90.0° 卯山(震宮/天元) 坐酉」就用到;core/full 都缺九星色字「黑、碧、綠、黃、赤、紫」(若洛書環顯示「五黃」之類文字會缺字);full 也缺 UI 環名用字(卦、宿、山、節、氣、池、洛、書、度、百、三、二、八、六、十、四)。更正:補入或明講「UI 字走系統字型,不嵌」。
8. 未列入 fixture 但被報告當結論的:「iOS 15 約 384MB canvas 總量」無來源;「TW-Kai 涵蓋 205 字」未驗證。

## 3. 未能驗證的項目(誠實清單)

- WebSearch 額度耗盡,沒有做「全新搜尋詞」的第三來源搜尋;28 宿宿度、120 分金八干四維規則、64 卦錨點因此維持低或中信心。
- 台灣市面主流盤式與通行度:沒有統計,無法驗證(維持原報告「低」)。
- TW-Kai fsType、字型子集大小:未下載字型,未驗證。
- iOS/Android WebView 實機效能、Haptics:未測。
- 原報告說 build_fixture.py 有 127 項斷言全過,腳本不在專案內,我無法直接執行它;改由我自己重寫獨立驗算。

## 4. 來源(本次實際打開過內容的網址)

- https://zh.wikipedia.org/w/index.php?title=羅庚&action=raw(24 山角度表)
- http://www.wawlhld.com/m/lpzs/213.html(三針、120 分金起點、宿度)
- http://www.fushantang.com/1012/1012a/j0110.html(人盤逆、天盤順 7.5°,big5)
- https://www.sohu.com/a/455508170_120828853(相反措辭)
- https://www.sohu.com/a/346292839_435999(三元龍陰陽、甲午 174°、紅黑差異)
- https://blog.csdn.net/qq_42971998/article/details/137604537(三元龍、正向 9°、空亡)
- https://www.bigpeak.net/portal/article/index.html?id=15(正兼向度數指標)
- https://www.163.com/dy/article/DRK38TTS0528KPTC.html(開禧宿度表、張第三度、空亡定義)
- https://www.yixiansheng.com/article/4538.html(28 宿圓周度、人盤對位)
- https://www.163.com/dy/article/HJT97HRR0553X9QG.html(120 分金排法)
- http://www.taijizhidian.net/zhuanzaisuibi/215.html(節氣環、金底紅字、120 龍)
- https://www.88s1.com/mobile_ReadNews.asp?id=1819(天池、海底線、天心十道)
- https://groups.google.com/g/FengShuiPro/c/45z0nNAsEkM(紅頭指南、子/丑山分金)
- https://upload.wikimedia.org/wikipedia/commons/c/c2/Luopan.jpg(18 層圖例,我直接看了圖)
- https://zh.wikipedia.org/wiki/八卦、https://zh.wikipedia.org/wiki/先天八卦
- https://lionpuro.com/posts/canvas-is-finally-usable-on-safari/
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createConicGradient
- https://developer.apple.com/fonts/system-fonts/
- https://learn.microsoft.com/en-us/typography/font-list/kaiti
- https://www.cns11643.gov.tw/pageView.jsp?ID=59
- https://github.com/lxgw/LxgwWenKaiTC

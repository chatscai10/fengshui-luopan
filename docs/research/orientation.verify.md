# orientation 報告:獨立懷疑論驗證

- 驗證日期:2026-09-29
- 被驗對象:`docs/research/orientation.md`、`test/fixtures/orientation.json`(179 筆)
- 角色:獨立懷疑論者,預設報告有錯,直到自己查證通過
- 總判定:**needs-fixes**(核心數值、24 山表、兼向分類、磁偏角資料全部通過;有 1 條標籤定義與其自身來源衝突、1 個預設值偏樂觀、數處說明缺口,均可修)
- 限制:WebSearch 額度在驗證開始時已用盡(200/200),因此新來源全部用 WebFetch / 直接 HTTP 讀取「已知網址」取得,無法用全新搜尋詞找更多來源。下列「獨立」指:不是報告用來下結論的那一頁,或是用程式從第一原理重算。
- 所有驗算腳本在 session scratchpad 的 `sk_orient/` 子目錄(不在 repo 內):`mine.py`、`check.py`(以 Fraction 精確算術獨立重寫的坐向/兼向/空亡分類,對照全部 fixtures)、`wmm.py`+`cities.py`(自寫 WMM2025 球諧展開,對 NOAA 官方測試向量最大差 0.0046°)、`igrf.py`(自寫 IGRF-14 展開,吃 NOAA 係數檔)、`rep.js`(把報告 2.5 節 JS 原樣抽出來跑 7207 個點)。

---

## 一、逐條規則判定

### V1. 24 山每山 15°、子山 352.5°~7.5°、順序、index 公式、半開區間 → confirmed(高)

- 證據 1:https://www.108s.tw/article/info/287 逐行列出 24 山度數(子山午向 352.5~7.5、癸 7.5~22.5 …… 壬 337.5~352.5),我逐行對照無差異。
- 證據 2:https://zh-yue.wikipedia.org/wiki/%E4%BA%8C%E5%8D%81%E5%9B%9B%E5%B1%B1 「當今講法,每位佔十五度。由北順時針數,子癸丑艮寅甲…壬」「正位左右伸七度半」。
- 證據 3:http://www.fushantang.com/1012/1012a/j0110.html 「每山15度」;http://www.zggdfs.com/read/Read8_999.html 午山下卦 175.5~184.5(中心 180)。
- 程式重算:用 Fraction 精確算術獨立實作(逐山掃區間,不用 floor 公式),對 fixtures 中 70 筆 `mountainOfBearing`(含 24 中心、24 界線、邊界、負角、超 360)全部一致。報告 2.5 節 JS 原樣抽出,對 0~360° 每 0.05° 共 7200 點加 7 個離群值(-15、375、720.5 等),與我的實作 **0 差異**。
- 邊界歸屬純屬程式約定:https://ihouse.ifeng.com/news/2019_07_29-52218303_0.shtml 明說「凡压分界线，都是错的」,故「壓線=空亡」有來源支撐。
- 更正:無。

### V2. 八卦 45° 分區(坎 337.5~22.5 … 乾 292.5~337.5)→ confirmed(高)

- 108s 287:「坐北向南(337.5度~22.5度)」等八段,與報告 3.2 完全一致。
- 獨立來源 https://polaris-hs.jp/kaiteki/kaso_north.html:風水は「8方向を45度ずつ均等に分けています」。順帶:同頁指出日本「家相」是東西南北 30°、四隅 60°,與風水不同,此 App 用風水的 45°,不可混用。
- 程式:fixtures 中 `gua/dir8/zhaiGua/zhaiSitDir` 全部由我獨立表重算一致。
- 更正:無。

### V3. 向 = 坐 + 180°、宅卦由坐山決定 → confirmed(算術高;八宅對應中高)

- 算術:108s 287 的「壬山丙向 / 子山午向 / 癸山丁向 …」對山表與 index+12 完全吻合;fixtures 11 筆 `sitFromFacing` 全部重算一致。ifeng:「坐子山,向山就必然是午」「以向代坐」為常見錯誤。
- 八宅對應:https://www.secretchina.com/news/b5/2022/03/20/1000910.html 「北方屬坎(坐北向南)…坎宅(坐北向南)」;https://k.sina.cn/article_5542073509_14a5554a5001001rvl.html 「坎宅－坐正北向正南」。兩者都是八宅通俗版,且都以大門定向(見 V10 的分歧)。
- 更正:無。

### V4. 三元龍與陰陽 → confirmed(高)

- ifeng:天元=子午卯酉乾巽艮坤;地元=辰戌丑未壬丙甲庚;人元=癸丁乙辛寅申巳亥。與報告完全一致。
- https://www.sohu.com/a/274267505_435999 陽=乾巽艮坤寅申巳亥壬甲丙庚,陰=辰戌丑未子午卯酉丁辛乙癸;且說「天元龍(中間)、地元龍(左邊)、人元龍(右邊)」。
- 第三個獨立驗證:我另以「天元與人元同陰陽、地元與天元相反、乾坤艮巽為陽、子午卯酉為陰」的規則從頭導出 24 山陰陽表,與報告 YANG 集合逐山一致。
- 舊引擎檢查(見 V17)。
- 更正:無。

### V5. 三針偏移(人盤中針逆時針 7.5°、天盤縫針順時針 7.5°;玄空只用地盤正針)→ confirmed(中)

- http://www.fushantang.com/1012/1012a/j0110.html(需 big5 解碼)「人盤比地盤是逆時針旋轉了7.5度,天盤比地盤順時針旋轉了7.5度」「地盤…所有堪輿流派都用之」。
- https://www.loktinfengshui.com.au/feng-shui-luopan-man-ring-measuring-technique/ 「The Man Ring is 7.5 degrees to the left of the Earth ring, the Heaven Ring is 7.5 degrees to the right」。左右與逆順時針方向一致(dial 上向左 = 逆時針)。
- sohu 274267505:「只用正針…有人將羅盤分三盤:天盤納水,人盤消砂,地盤格龍立向,這是大錯」,支持「玄空只用地盤正針」。108s 287 也說人盤中針、天盤縫針「都是相同的二十四山」。
- 需提醒(不改判):報告 6 節把 zh-yue wiki(S2)列為「正針、中針、縫針的定義」來源,但該頁的中針/縫針是另一套說法(中針=雙山 48 方位、縫針=正針與中針之間 96 方位),不是三合三盤的 ±7.5° 偏移。三盤偏移方向的依據應只引 fushantang、loktin。
- 更正:文件註記,不影響程式與 fixtures。

### V6. 下卦/兼向界線 ±4.5°(五格每格 3°、中三格下卦)→ confirmed(中高),少數說法確認存在

- http://www.zggdfs.com/read/Read8_999.html 「左右各4.5度，共计9度…外各3度…也称兼向」「每格3度，所当中三格9度为下卦」。
- https://www.108s.tw/article/info/294 「依據沈氏玄空學…中間9度以內,用下卦…超過中間9度…替卦」,且「正針一百二十分金,每座山15度分五小格,每格3度」(360/120 = 3° 的算術我也自己核過)。
- https://www.xuankongguan.com/guide-detail/%E4%B8%8B%E5%8D%A6%E8%88%87%E6%9B%BF%E5%8D%A6 「本山中位左右三度半或四度半內」,確認 ±3.5° 為並存的少數說法。https://www.36fengshui.com/zhishi/zs60.asp 「偏左或偏右3度之内都为正向」,確認 ±3° 說法存在。
- 更正:無。預設 4.5 與可選 3.5/3.0 的設計合理。

### V7. 兼向限度(同陰 6°、同陽 7°、陰陽互兼 5~6°、出卦 5~6°)與 48 局分類 → confirmed(數值中,分類高)

- 36fengshui zs60:同陰「可兼至六度內,超過六度…"空向"」、同陽「七度內」、陰陽互兼「均不得超過五度…稱為"陰陽差錯",或叫"小空亡"」、出卦「不得超過五度…"出卦",又叫"大空亡"」。
- https://www.zggdfs.com/read/Read_52.html 「同阴…6度、同阳…7度」「阴阳互兼…不能超过…6度」「出卦…不能超出六度…靠外的1.5度最凶」。5° 與 6° 兩說並存屬實,報告的兩段式 (5,6) 是合理折衷。
- 分類獨立驗證:我用「gua 不同=出卦;同卦且含地元=陰陽互兼;同卦天元與人元=同性」重新導出,24 界線×2 方向得 陰陽互兼 16、出卦 16、同陰 8、同陽 8,與 36fengshui 各節標題(16/16/8/8)相同。把 36fengshui 的兼向清單逐條解析後,出卦 16/16 全對、同陰 7/8、陰陽互兼 14/16;不符的 3 條都是來源自身筆誤(「辛乙兼卯酉」重複、「午子兼丙午」「丙午兼午子」應為「午子兼丙壬」「丙壬兼午子」),不影響結論。報告只註明了第一個筆誤,另兩個未記(文件小疏漏)。
- 補充缺口(見 V19):zggdfs 明說同陰同陽(天人互兼)「不用替」,報告 orientation 的 `zone=jian` 對同性相兼也回傳「兼向」,下游玄空模組不可據此就套替卦。
- 更正:無數值更正。

### V8. 空亡定義與帶寬(8 卦界=大空亡、16 山界=小空亡;帶寬 ±3°/±2.5°/±1.5°)→ uncertain(部分需更正)

- 位置式來源確實存在:sohu 274267505「一卦三個山中,每兩山間的交界線…小空亡」、https://www.yixiansheng.com/article/4527.html「山與山之間的分界線稱為小空亡,宮與宮之間…大空亡」。帶寬也屬實:同頁度數表 19.5~25.5 等 8 段(6° 寬),文字寫「中間5度」(自相矛盾),我直接讀頁面核實。
- **衝突**:報告自己的來源 ifeng(S10)寫「壓在兩卦的分界線上,此為大空亡線;壓在天元龍與地元龍的分界線上,此為小空亡線;壓在天元龍與人元龍之分界線上,雖不是陰陽差錯,亦為不宜」。也就是說天元/人元(同陰同陽)的 8 條山界,ifeng 不稱小空亡;36fengshui 稱超限者為「空向」,只把陰陽差錯叫小空亡。sohu 還特別註明「大小空亡的稱謂…其它風水流派也有同樣的稱謂,不過所指的用法不盡相同」。
- 影響:報告 2.4 步驟 8 與 fixtures 把同性相兼山界(如 子/癸 7.5°、乾/亥 322.5°)的 `kongwangKind` 一律標 `xiao`,這是「所有山界=小空亡」一派的說法,不是共識。
- 更正建議:`kongwangKind` 對同性相兼(pairType = tongxing_*)改為獨立值,例如 `kongxiang`(空向,不宜),或保留 `xiao` 但在 UI 文案註明「依各派定義不同」。受影響 fixtures 見 fixtureIssues 第 3 項。

### V9. 「向」的取法預設(大樓=主採光面等)→ uncertain(產品政策,來源確認分歧屬實)

- 台灣室設與房產媒體確實分歧:https://hhh.com.tw/columns/detail/7316 「有陽台者,以此優先查出方位;沒有陽台者,再以住家的大門來查」;https://www.ailan.idv.tw/2025/02/26/%E7%A0%B4%E8%A7%A3%E9%99%BD%E5%AE%85%E5%BA%A7%E5%90%91%E8%BF%B7%E6%80%9D/ 「以採光面來判定座向…最大採光面」;https://17rent.com.tw/housesdirection/ 「人站在屋內看向大門方向」為向。三者說法與報告 4.1 轉述相符。
- 需補充兩點:(a) 幸福空間同一頁前一問自相矛盾,寫「要瞭解住家的運勢,就要以自家的大門為主」,報告只引了「陽台優先」;(b) 17rent 明說「判斷房子座向和房間財位的評估點有些微的不同」(座向看大門外,財位看落地窗/內門),也是宅向與財位基準分開的佐證,對財位模組有用。
- 無法用來源決定預設,屬產品政策。fixtures 的 12 筆 `pickFacing` 我逐筆對照報告寫明的政策規則,全部一致(公寓:樓層規則→大樓正面、否則有採光面用採光面否則退大門;透天:|門-窗|≤45° 用門否則用窗並標衝突;店面用臨街門),但這只能證明程式與政策一致,不能證明政策正確。
- 更正:無;維持 low 信心與「夾角>45° 顯示三候選由使用者確認」的設計。

### V10. 宅向 vs 門向(玄空以宅向、八宅通俗以大門)→ confirmed(中)

- 八宅通俗版以大門定坐向:secretchina「八宅風水學按大門所向的方位決定住宅的坐向…站在屋內中心點,面向大門」;sina「面向着大门,则所面向的方位便是"向"」。
- 現代台灣以採光面/陽台為主:ailan、hhh(見 V9)。兩套並存,報告「分開兩個輸入」的設計成立。
- 更正:無。

### V11. 多次量測必須用圓周平均 → confirmed(數學確認)

- 純數學:[359,1] 算術平均 180、向量平均 0;我獨立實作 `circularMean`,fixtures 6 筆(mean、r、stdDeg)在 1e-4 內全部一致。
- 其餘流程細節(左中右各量、差>5° 重量、不貼門、1 公尺)報告已自標「產品建議」或「單一來源」,我未另行驗證,不列入判定。
- 更正:無。

### V12. 手機羅盤精度(理想 ±2~5°、鋼筋室內 30~90°)與預設 uncertainty = 3° → uncertain(需更正預設)

- 直接讀 https://www.pointme.live/blog/how-accurate-are-phone-compasses.html:±2~5° 僅適用「高階機(iPhone 14+、Galaxy S23+),戶外、無干擾、已校準」;中階機 ±5~10°;入門機 ±10~20° 甚至更多。30~90° 是「磁性配件、金屬家具、牆內鋼筋等」的極端案例,並非專指鋼筋大樓室內。
- 報告只寫「理想條件 ±2~5°」,並把 `uncertainty` 預設訂為 3.0°。以來源自己的數字,3° 只有頂級手機在戶外理想條件才成立;一般手機 ±5~10° 時,「落在下卦區」的結果在 15° 的山內就不可靠(山半寬只有 7.5°)。
- 來源品質:單一部落格(信心中低),報告已自承。
- 更正建議:`uncertainty` 預設改 5°(或依 iOS `webkitCompassAccuracy` / Android 精度回報動態設定),3° 只在使用者手動選「戶外理想」時使用;說明文字補上機型分級。此為建議,不是硬性錯誤。

### V13. 磁偏角符號與換算、vocus 文章符號寫反 → confirmed(高)

- https://www.ngdc.noaa.gov/geomag/declination.shtml 「Declination is positive east of true north and negative when west」;https://en.wikipedia.org/wiki/Magnetic_declination 「positive when magnetic north is east of true north」。真 = 磁 + D 成立。
- 我逐字讀 https://vocus.cc/article/68cad068fd8978000104ed8f:「實際房子朝向為正北 0°,但羅盤因磁偏角 -6°顯示 354°」。物理上 D = -6° 時,面向真北的磁方位 = 0 - (-6) = 006°,不是 354°。報告判斷「符號寫反」**正確**。(同文另一句「羅盤指北為 355°」若解讀成「磁北位於真方位 355°」則是對的,寫反的是上面那個例子。)
- fixtures 中 `trueToMagnetic` 6 筆、`magneticToTrue` 9 筆、`compareMagVsTrue` 8 筆,我以 Fraction 獨立重算全部一致。
- 更正:無。

### V14. 磁偏角資料(WMM2025、城市表、IGRF-14 歷史趨勢、-3~-4° 為舊值)→ confirmed(高)

- 我自己用 WMM2025 係數(https://raw.githubusercontent.com/boxpet/pygeomag/main/pygeomag/wmm/WMM_2025.COF,純文字資料)寫球諧展開,對 NOAA 官方 12 組測試向量(https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt)最大差 0.0046°。
- 對報告 3.5 節 40 個城市(2025.0、2026.0、2026-09-29 三個日期 + 年變化)重算,最大差 **0.0054°**,年變化全在 0.001°/yr 內。台北 -5.033(2026.0)、-5.061(2026-09-29)、高雄 -4.323、香港 -3.293、東京 -7.910、新加坡 +0.211 等與報告一致。fixtures 的 17 筆 `declinationReference` 全部落在 0.02° 內。首爾 -8.99 也一致。
- IGRF-14:用 NOAA 係數檔(https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt)自算,台北 1980/1990/2000/2010/2020/2025 = -2.94/-3.25/-3.44/-3.86/-4.67/-4.99,與報告 3.5 節歷史表完全一致(高雄、新加坡差 0.01 為四捨五入)。因此「台灣網頁常見的 -3~-4° 是舊資料」成立(台北約 2012 年前後越過 -4°)。
- 官方交叉:https://www.landsd.gov.hk/en/resources/mapping-information/hk-geographic-data.html 「in 2026 at Lion Rock is 3°17' west…changing by approximately 1' westward annually」(= -3.283°);https://www.gsi.go.jp/buturisokuchi/press_magnetic_charts2020.html 東京「西へ…7度40分」,我的 WMM2020@2020.0 = -7.631°。
- 更正:無。

### V15. 是否校正磁偏角(預設不校正)與 iOS/Android 回傳基準 → uncertain(政策);但報告「待真機確認」的疑點可先行解決

- 政策面來源確實如報告所述:polaris-hs.jp(家相/風水多用磁北)、gerryliao pixnet「古人用磁北…現代人想要改成正北,我也不認為有何不妥,但每門術數衍生都有其邏輯」、fushantang「地盤…用地盤測量出來的方位是地磁方位」。屬產品決策,無法用來源定案。
- 平台基準(報告第 7 節第 8 點列為未解決):(a) iOS Safari `webkitCompassHeading` — WebKit 原始碼 https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm 第 318 行 `newHeading.magneticHeading`,即**磁方位**;(b) Android `TYPE_ROTATION_VECTOR`(Chrome `deviceorientationabsolute` 所依據)官方文件 https://developer.android.com/reference/android/hardware/SensorEvent 「Y is tangential to the ground…and points towards magnetic north」,即**磁北**。兩者與報告 2.6 的預期一致。Capacitor 原生外掛(如 CLHeading trueHeading)仍需逐一檢查。
- 更正:第 7 節第 8 點可改寫為「Web 端 iOS/Android 皆為磁方位(已由原始碼與官方文件確認);原生外掛仍要查」。

### V16. 忽略磁偏角的影響量(24 山 ≈ |D|/15、八卦 ≈ |D|/45)→ confirmed(高)

- 均勻分布下,方位平移 D 使山別改變的機率就是 |D|/15,卦別改變是 |D|/45(|D|<15)。逐城重算:台北 5.033/15 = 33.55%(報告 33.6%)、首爾 59.93%/19.98%、新加坡 1.41%/0.47%,fixtures `info.effect_of_ignoring_declination_2026.0` 10 城全部吻合(差 ≤ 0.0005)。
- 更正:無。

### V17. 舊引擎 `divine_xuankong.py` 陰陽表與三元註解錯誤 → confirmed(高)

- 我讀舊版玄空引擎 `divine_xuankong` 的 `SHAN_YINYANG` 中 子、卯、午、酉 為「陽」(應為陰),寅、巳、申、亥 為「陰」(應為陽),共 8 山寫反,與報告完全一致;註解「地元龍:辰戌丑未+寅申巳亥」「人元龍:甲乙丙丁庚辛壬癸」與 ifeng 來源不符(正確:地元=壬丙甲庚辰戌丑未,人元=癸丁乙辛寅申巳亥)。舊引擎無度數概念屬實(該表以山名字串為鍵)。
- 更正:無。

### V18. 人盤/天盤 fixtures 與 index 公式 → confirmed(中,受限於 V5 的方向假設)

- `ring:'ren'` `index=floor(b/15)+1`、`ring:'tian'` `index=floor(b/15)`:以「人盤=地盤逆時針 7.5°」為前提用獨立實作重算 10 筆全部一致;公式本身與前提互相自洽。前提的來源見 V5。
- 更正:無。

### V19. (報告遺漏)兼向區不等於一律用替卦 → 說明缺口,需在下游補上

- zggdfs Read8_999:「同一卦宫内,阴兼阴、阳兼阳不用替,阴阳互兼用替…天人互兼不用替,而天地互兼则必用替」「出卦不论阴阳均用替」。也就是 pairType = `tongxing_yin/yang` 的兼向區仍按下卦排盤,只有 `yinyang`、`chugua` 才替。
- 報告 orientation.md 沒有寫這條(xuankong_core.md 有寫),而 `analyzeBearing` 對同性相兼回 `zone:'jian'`、`level:'jian'`,容易被下游誤判為要替卦。
- 更正建議:在 orientation.md 2.4 節加一句「zone = jian 且 pairType 為 tongxing_* 時,玄空排盤仍用下卦,僅提示」;並在 `analyzeBearing` 輸出加旗標如 `needsTiGua = pairType in {yinyang, chugua}`。

---

## 二、fixtures 抽驗結果

- 範圍:**全部**可執行案例重算,共 162 筆函式案例(`mountainOfBearing` 70、`analyzeBearing` 33、`sitFromFacing` 11、`normalizeBearing` 7、`magneticToTrue` 9、`trueToMagnetic` 6、`compareMagVsTrue` 8、`circularMean` 6)+ `declinationReference` 17 筆(用自寫 WMM2025)。`pickFacing` 12 筆為產品政策,只核對與報告寫明規則一致。
- 結果:**0 筆期望值錯誤**(數值與分類皆一致)。額外用報告 2.5 節 JS 對 7207 個點與我的獨立實作比對,0 差異。
- 下列為需處理的 fixtures 問題(不是期望值錯,是品質/覆蓋/標籤):

1. `sitFromFacing`「facing 187.4°」:`expected.sitBearing = 7.399999999999977` 是浮點雜訊,應為 7.4;測試 harness 必須用容差(建議 1e-9)比較,或把 fixture 改成 7.4。同類:`circularMean` 的 `r`、`stdDeg` 只給 6 位小數,需容差 ≥1e-5。
2. 覆蓋缺口:`analyzeBearing` 33 筆中,同陽相兼只測了 乾/亥,沒測 艮/寅、坤/申、巽/巳;出卦只測了 癸/丑、亥/壬、丁未 3 條卦界的 5 個點,`chugua` 且 `level=jian`(≤5°)只有 1 筆;沒有 `tongxing_yang` 的 `jian_caution` 對照(該型 okMax=voidAbove=7,本就不存在,建議在 fixtures 註明);沒有多次量測 `uncertainty = max(3, 2σ)` 的案例。建議補一個「48 個有向界線各取 adev=5.5、adev=6.5」的自動生成集。
3. `kongwangKind` 標籤:同性相兼且 void 或 onLine 的案例(「子山 6.5° 兼癸 同陰 >6 空向」「乾山 322.2° 兼亥 同陽 dev 7.2 >7 空向」)期望值 `xiao`,與 V8 的衝突相關;若採更正,應改成 `kongxiang` 或標 `school-specific`。
4. 文件註記:36fengshui 兼向清單另有兩條筆誤(午子兼丙午、丙午兼午子),報告 5 節與 fixtures `verification` 欄未記載;不影響期望值。

---

## 三、我自己的補充結論

- 報告的核心(24 山、45° 八卦、兼向分類、坐向換算、磁偏角資料與公式)經獨立重算與獨立來源查證,**全部通過**,可以直接進入實作。
- 需修文件與預設的地方只有:V8 大小空亡標籤、V12 uncertainty 預設 3° 偏樂觀、V19 替卦適用性說明、V5 引用的來源歸屬、V15 平台基準疑點可結案、fixtures 容差與覆蓋。
- 「向」的取法(V9)與是否校正磁偏角(V15)本質是產品決策,我確認了各派主張在來源中屬實,但無法用來源決定哪個對,維持報告的低/中信心。

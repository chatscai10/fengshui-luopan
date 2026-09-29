# 風水羅盤 App 領域規格書 (DOMAIN_SPEC)

- 版本: 1.0 (2026-09-29)
- 定位: 把 8 份研究報告與 8 份獨立複查整合成「工程可直接照做」的規格。規則以複查更正為準,與研究報告衝突時以本檔為準。
- 專案: 離線純 HTML/CSS/JS(之後用 Capacitor 8 包 iOS/Android),繁體中文(台灣)。
- 範圍限制: 本檔只規定演算法、資料形狀、預設值、測試與文案準則,不含 UI 視覺稿。

## 0. 讀法與圖例

### 0.1 依據標示

| 標記 | 意義 |
|---|---|
| (信心: 高) | 至少 2 個彼此獨立來源一致,且已被複查者用獨立程式重算 |
| (信心: 中) | 來源一致但含設計補充,或來源間有小分歧 |
| (信心: 低) | 單一來源、推論或設計值 |
| tag=來源 / 推論 / 設計 / 少數派 | 結果頁每個結論都要帶的出處類型(見 1.4 Finding) |
| [已更正] | 複查指出的問題,本檔已改寫規則 |
| [未解決] | 來源無法裁決,本檔給出預設與開關,列入第 7 節 |

### 0.2 輸入文件與可信度

| 主題 | 研究報告 | 複查 | 複查總評 | fixtures(test/fixtures/) |
|---|---|---|---|---|
| bazhai | research/bazhai.md | bazhai.verify.md | needs-fixes | bazhai.json (135) |
| xuankong_core | xuankong_core.md | xuankong_core.verify.md | reliable | xuankong_core.json (568) |
| xuankong_patterns | xuankong_patterns.md | xuankong_patterns.verify.md | needs-fixes | xuankong_patterns.json (474) |
| wealth_position | wealth_position.md | wealth_position.verify.md | needs-fixes | wealth_position.json (71) |
| orientation | orientation.md | orientation.verify.md | needs-fixes | orientation.json (179) |
| annual | 未寫入(見下) | 未寫入 | needs-fixes | annual.json (191) |
| luopan_rings | luopan_rings.md | luopan_rings.verify.md | needs-fixes | luopan_rings.json (72) |
| device_compass | device_compass.md | device_compass.verify.md | needs-fixes | device_compass.json (99) |

**annual 沒有報告檔與複查檔**(此主題未產生獨立報告檔)。annual 的規則、23 個來源 URL、JS 參考實作(約 210 行)、測試執行器、驗證統計全部內嵌在 `annual.json` 的 `meta`(`conventions`、`sources`、`verification`、`referenceImplementation.source`、`testRunner.source`)。本檔第 2.5 節依這些內容與複查摘要撰寫。此文件缺口列為 [未解決] U-01。

### 0.3 本次整合自己重算的項目(已用程式重算)

| 項目 | 方法 | 結果 |
|---|---|---|
| annual 參考實作 vs annual.json | 抽出 `meta.referenceImplementation.source` 與 `testRunner.source`,以 node 執行 | 191/191 通過 |
| 交運 22 案 | 用 annual 參考實作(立春精確時刻)重算 xuankong_core.json 的 `yun_of_datetime` | 22/22 一致 |
| 立春表交叉 | bazhai.json `meta.lichun_cst_1900_2100`(201 年,Skyfield DE421)對 annual 參考實作(VSOP87D 截斷) | 最大差 68.9 秒(2098 年);容差 120 秒 |
| 8x8 八宅表 | 以爻變序列重算,對 bazhai.json `star_matrix` 逐格比對,並驗對稱 | 64/64 一致,對稱成立 |
| 複查建議補測的 monthly 9 案與月柱五虎遁 5 案 | 用 annual 參考實作重算 | 14/14 與複查提供的數值一致(見附錄 B) |
| 本檔內嵌資料表 | 24 山表對 orientation.json 56 筆 `mountainOfBearing`(卦/元龍/陰陽)、RING 對 24 山表生成、替星 A/B 對 xuankong_core.json `table_ti_star`、8x8 星表對 bazhai.json、三煞四組弧對 annual 參考實作 `sansha()`;另驗全檔 21 個 JSON 區塊皆可解析 | 全部一致 |
| 平面圖扇區面積(plan) | 自寫多邊形對楔形裁切 | 10x8 矩形、L 型面積守恆(80、27),數值見 2.7 |
| 手機傾角混合(sensor) | 用 `compass-core.mjs` 的 `eulerHeadings`/`tiltDeg` 加平滑混合 | 數值見附錄 B |
| 色彩對比、節氣環新寬度 | WCAG 2.x 公式、環寬正規化 | 數值見 2.8 |
| 1940 年立春與 +09:00 案例 | annual 參考實作(1940-02-05 07:07:10)與 bazhai 表(07:07:14) | 一致,見附錄 B |

未能重算、只能引用複查者結論的項目,一律在該處標註。

---

## 1. 模組清單與職責

### 1.1 模組表

原則: 全部是純函式(無 DOM、無全域狀態、無網路),輸入輸出為 JSON 可序列化物件。UI 層只負責收集輸入、呼叫模組、把 `Finding` 轉成文案。建議目錄 `fengshui/src/core/<module>/`,ES module。

| 模組 | 職責 | 主要輸出 | 依賴 |
|---|---|---|---|
| geo | 角度正規化、24 山、8 方位/八卦、坐向互換、兼向與空亡、磁北真北換算、圓周統計、「向」取法政策 | `mountainAt`、`analyzeBearing`、`sitFromFacing` | 無 |
| calendar | 立春與節氣天文計算、干支年月、九運、出生時刻換算、立春臨界旗標 | `termInstant`、`fengshuiYear`、`nineYun`、`monthOf` | 無 |
| bazhai | 命卦、遊年八星表、宅卦、命宅配、八星用途矩陣、八宅財位序 | `analyzeBazhai` | geo、calendar |
| xuankong | 山向盤(運/山/向三盤)、下卦與替卦、格局、五氣、星組合、財丁位、特殊格局 | `buildChart`、`analyzeXuankong` | geo、calendar |
| annual | 流年/流月飛星、太歲歲破三煞五黃二黑、九運位置 | `analyzeAnnual` | calendar、geo |
| wealth | 明財位幾何、暗財位(八宅/玄空/流年/命卦)、禁忌檢核、候選排序、店面辦公室 | `analyzeWealth` | geo、plan、bazhai、xuankong、annual |
| plan | 平面圖資料結構、太極點、扇區歸屬與面積佔比、角落與門窗的宮位 | `sectorOfPoint`、`sectorShares` | geo |
| luopan | 盤面資料(環、山、卦、宿、節氣、分金)、版面、配色、字型、旋轉手勢參數、即時讀數 | `RINGS`、`layoutRings`、`readout` | geo |
| sensor | 手機方位:事件解碼、姿態選擇、平滑、鎖定平均、權限流程、降級 | `createCompassSource`、`decodeOrientationEvent` | geo(圓周統計) |

### 1.2 依賴圖

```
sensor ──► geo ◄── luopan
              ▲
calendar ─────┼──► bazhai ─┐
   │          ├──► xuankong ┼──► wealth ◄── plan ◄── geo
   └────► annual ───────────┘
```

`wealth` 是唯一會同時讀取 bazhai、xuankong、annual、plan 的模組;其他模組互不依賴,方便單獨測試。

### 1.3 共通約定(全部模組遵守)

| 項目 | 約定 | 依據 |
|---|---|---|
| 方位角 `bearing` | 度,自北順時針,正規化到 [0,360)。輸入任意實數,先 `((b%360)+360)%360` | orientation.md 2.1;bazhai.verify.md 補充(偽碼對 < -180 度會出負索引) |
| 北的基準 | 預設磁北(`northMode='magnetic'`),可切真北;任何存檔的方位必須連同 `{northMode, declination, date}` | orientation.md 2.6、4.6 |
| 24 山 index | 0=子,順時針,中心 `15*i`,範圍 `[15i-7.5, 15i+7.5)` 半開區間 | orientation.md 2.1(信心: 高,設計約定) |
| 八卦/八宮 index | `GUA=['坎','艮','震','巽','離','坤','兌','乾']`,index k 中心 `45k`,範圍 `[45k-22.5, 45k+22.5)`。宮 = `floor(((i24+1)%24)/3)` | orientation.md 2.1、3.2 |
| 洛書數 | 坎1 坤2 震3 巽4 中5 乾6 兌7 艮8 離9;順飛宮序 中5→乾6→兌7→艮8→離9→坎1→坤2→震3→巽4 | xuankong_core.md 2.2 |
| 宮位識別 | 內部一律用卦名 `'坎'..'乾'` 與 `'中'`;需要洛書數時查表。**各 fixtures 的鍵不同**(annual 用 `'西北'` 方位名、xuankong 用洛書數、bazhai 用卦名或方位名),測試 adapter 負責轉換,見 4.3 | 各 fixtures |
| 方位名 | 北 東北 東 東南 南 西南 西 西北,與八卦一一對應(坎艮震巽離坤兌乾) | bazhai.md 1.1 |
| 時間 | 瞬間一律 `ms since epoch (UTC)`;顯示與輸入用 UTC+8「YYYY-MM-DD HH:mm」;出生時刻必須帶 `utcOffset` | annual.json meta.conventions |
| 「元」的命名衝突 | 上中下元(180 年週期)叫 `era`(值 上元/中元/下元);天地人元龍叫 `dragon`(值 天元/地元/人元)。annual.json 的 `yuan` 指 era,orientation 的 `yuan` 指 dragon,adapter 要區分 | annual.json;orientation.json |
| 浮點 | 數值比較用容差(見 4.2),不要對 `7.399999999999977` 之類雜訊做全等 | orientation.verify.md fixtureIssues |
| 四捨五入 | JS `Math.round` 半數進位語意;用 `Math.floor(x+0.5)`,不可用銀行家捨入 | device_compass.verify.md |

### 1.4 共通資料形狀

**Settings**(所有開關集中一處,預設值見第 3 節決策表;每次分析結果的 `meta.ruleset` 原樣回存):

```json
{
  "northMode": "magnetic",
  "xiaGuaHalfWidth": 4.5,
  "jianLimitSchool": "default",
  "kongwangLabelScheme": "position",
  "measureUncertainty": 5.0,
  "facingPolicy": "auto",
  "bazhaiFacingBasis": "door",
  "yearBoundary": "lichun_exact",
  "yunBasis": "built",
  "renovation": "none",
  "yunSystem": "san_yuan_9",
  "useTiGua": false,
  "tiTable": "A",
  "qiScheme": "default",
  "eightKeepsWealth": false,
  "fuyinPenalty": -3,
  "fanyinPenalty": -1,
  "showLianshu": false,
  "showChengmen": false,
  "wSide": 0.3, "wYun": 0.3,
  "tianyiFirst": false,
  "stovePreferAuspicious": false,
  "coupleBasis": "breadwinner",
  "showMinorityTechniques": false,
  "sanshaArc": "core3",
  "extraShensha": false,
  "wealthProfile": "mingcai",
  "qiIntake": "penalty",
  "allowWaterHint": false,
  "preferDragonSide": false,
  "showRay45": false,
  "virtualPartition": false,
  "multiOccupantPolicy": "mean",
  "taijiMode": "centroid",
  "yinyangScheme": "sanyuan",
  "southUp": false,
  "showSanZhen": false,
  "livingRoomGradeByEastWest": false,
  "showGuimenxian": false,
  "facadeFloorRule": false,
  "bazhaiMatch": false,
  "yearVal": "default",
  "bazhaiStarWeights": "default",
  "lockSeconds": 3
}
```

**Finding**(結果頁最小單位,強制帶出處類型,文案層據此決定語氣):

```json
{
  "id": "xk.pattern.shuangxinghuizuo",
  "level": "info | note | caution",
  "title": "後方是旺星位置",
  "body": "人丁星與財星都落在坐(後方)...",
  "confidence": "high | medium | low",
  "tag": "source | inference | design | minority",
  "schoolNote": "此為玄空(中州派)說法,各派定義不同",
  "refs": ["xuankong_patterns.md#1.4"]
}
```

**AnalysisMeta**(每個分析函式回傳的 `meta`):

```json
{ "schema": "fengshui.bazhai/1", "ruleset": { "yearBoundary": "lichun_exact", "useTiGua": false },
  "northMode": "magnetic", "declination": -5.06, "declinationDate": "2026-09-29",
  "computedAtCST": "2026-09-29 12:00", "warnings": ["nearLichun"] }
```

---

## 2. 模組規格

### 2.1 geo(角度、24 山、8 方位、兼向、空亡)

依據: orientation.md、orientation.verify.md、luopan_rings.md 3.1、xuankong_core.md 2.5 與 3.3。fixtures: orientation.json。

#### 2.1.1 常數表

24 山(自子起順時針,每山 15 度)。欄位: 山, 卦, 元龍(dragon), 陰陽。對山 = index+12。已與 xuankong_core 的 RING、luopan_rings 的 24 山表、orientation 表逐山比對一致(信心: 高;來源 108s.tw/article/info/287、zh.wikipedia 羅庚、ifeng 2019_07_29-52218303、36fengshui zs26、Wikibooks Period 8,複查已逐一重驗):

```json
[["子","坎","天元","陰"],["癸","坎","人元","陰"],["丑","艮","地元","陰"],["艮","艮","天元","陽"],
 ["寅","艮","人元","陽"],["甲","震","地元","陽"],["卯","震","天元","陰"],["乙","震","人元","陰"],
 ["辰","巽","地元","陰"],["巽","巽","天元","陽"],["巳","巽","人元","陽"],["丙","離","地元","陽"],
 ["午","離","天元","陰"],["丁","離","人元","陰"],["未","坤","地元","陰"],["坤","坤","天元","陽"],
 ["申","坤","人元","陽"],["庚","兌","地元","陽"],["酉","兌","天元","陰"],["辛","兌","人元","陰"],
 ["戌","乾","地元","陰"],["乾","乾","天元","陽"],["亥","乾","人元","陽"],["壬","坎","地元","陽"]]
```

記憶檢查(可寫成屬性測試): 四正卦(坎離震兌)地、天、人 = 陽、陰、陰;四隅卦(乾坤艮巽)= 陰、陽、陽。陽 = 乾坤艮巽 + 壬丙甲庚 + 寅申巳亥;陰 = 子午卯酉 + 辰戌丑未 + 乙辛丁癸。

兼向限度 `LIMITS[pairType] = [okMax, voidAbove]`(距山中心度數):

```json
{ "tongxing_yin": [6, 6], "tongxing_yang": [7, 7], "yinyang": [5, 6], "chugua": [5, 6] }
```

`pairType` 分類: 鄰山與本山不同卦 = `chugua`(出卦);同卦且兩山中含地元 = `yinyang`(陰陽互兼);同卦且為天元與人元 = 陰山 `tongxing_yin`、陽山 `tongxing_yang`。24 條界線共 48 局 = 出卦 16、陰陽互兼 16、同陰 8、同陽 8(信心: 高;36fengshui zs60 標題數字與複查獨立重導一致)。

八卦 45 度分區: 坎 337.5-22.5、艮 22.5-67.5、震 67.5-112.5、巽 112.5-157.5、離 157.5-202.5、坤 202.5-247.5、兌 247.5-292.5、乾 292.5-337.5。App 用風水的 45 度,**不可**混用日本家相的「四正 30 度、四隅 60 度」(orientation.verify.md V2)。

#### 2.1.2 函式與資料形狀

```ts
normalizeBearing(b: number): number                      // [0,360)
mountainAt(b, ring='earth'|'ren'|'tian'): MountainInfo   // ren: 子中心 352.5; tian: 子中心 7.5
guaAt(b): {gua, dir8, index}                             // 45 度
sitFromFacing(facing): {sitBearing, facingMountain, sitMountain, zhaiGua, zhaiSitDir}
analyzeBearing(b, opts): BearingAnalysis
toTrue(mag, D) / toMagnetic(tr, D)                       // D 東偏為正
circularMean(list) / circularDiff(a,b)                   // 見 2.9
pickFacing(input): {facingBearing, basis, conflict}      // 產品政策
```

`MountainInfo` 範例(`mountainAt(175.0)`):

```json
{ "name": "午", "index": 12, "centerDeg": 180, "startDeg": 172.5, "endDeg": 187.5,
  "gua": "離", "dir8": "南", "dragon": "天元", "yinyang": "陰", "opposite": "子", "dev": -5 }
```

`analyzeBearing(bearing, {threshold=4.5, uncertainty=3.0, kongwangLabelScheme='position'})` 範例(`bearing=175.0`,已用 orientation.md 2.5 的參考程式重算,並加上本檔更正欄位):

```json
{ "mountain": "午", "index": 12, "dev": -5, "zone": "jian", "level": "jian",
  "leanTo": "丙", "pairType": "yinyang",
  "boundaryDist": 2.5, "boundaryKind": "shan",
  "kongwangKind": null, "kongwangKindDegree": null,
  "onLine": false, "retest": true, "outer1p5": false,
  "needsTiGua": true,
  "gua": "離", "dir8": "南", "opposite": "子" }
```

`bearing=187.4` 的範例(同陰相兼超限,示範空亡標籤):

```json
{ "mountain": "午", "dev": 7.4, "zone": "jian", "level": "void", "leanTo": "丁", "pairType": "tongxing_yin",
  "boundaryDist": 0.1, "boundaryKind": "shan", "onLine": true,
  "kongwangKind": "xiao", "kongwangKindDegree": "kongxiang",
  "schoolNote": "山與山交界(位置式)稱小空亡;度數式說法稱此為空向。各派定義不同。",
  "needsTiGua": false, "retest": true }
```

#### 2.1.3 `analyzeBearing` 演算法(逐步)

1. `i = floor(((b'+7.5)%360)/15)%24`,`dev = ((b' - 15i + 180)%360+360)%360 - 180`,範圍 [-7.5, 7.5);`adev=|dev|`。
2. `zone = adev <= threshold + 1e-9 ? 'zheng' : 'jian'`。**恰好等於門檻歸下卦(含端點)**,浮點加 1e-9。`threshold` 可選 4.5(預設)、3.5、3.0(D02)。
3. 鄰山 `j = dev > 0 ? (i+1)%24 : (i+23)%24`;`pairType`、`[okMax, voidAbove]` 依 2.1.1。
4. `level`: `zone='zheng'` → `zheng`;否則 `adev<=okMax` → `jian`;`adev<=voidAbove` → `jian_caution`;其餘 `void`。
5. `boundaryDist = 7.5 - adev`;`boundaryKind = gua 不同 ? 'gua' : 'shan'`;`onLine = boundaryDist < 0.5`;`retest = boundaryDist < uncertainty`。
6. `outer1p5 = adev >= 6.0`(中州派「兼向 3 度中外側 1.5 度最凶」,xuankong_core.md 2.5)。與 `level` 是兩個不同的旗標,UI 兩者都可用,不要合併。
7. **[已更正] `needsTiGua = zone==='jian' && pairType in {yinyang, chugua}`**。同性相兼(`tongxing_*`)雖回 `zone:'jian'`,玄空排盤仍用下卦,只提示,不替卦(zggdfs Read8_999「天人互兼不用替,而天地互兼則必用替」;xuankong_core.md 2.5 與 Wikibooks 48 扇區 32 替 16 不替;orientation.verify.md V19)。xuankong 模組**只讀** `needsTiGua`,不得自己再用 `zone` 判斷。
8. **[已更正] 空亡標籤(D04)**。只在 `level==='void'` 或 `onLine` 時給:
   - `boundaryKind='gua'` → `kongwangKind='da'`(大空亡線)。
   - `boundaryKind='shan'` 且 `pairType='yinyang'` → `'xiao'`。
   - `boundaryKind='shan'` 且 `pairType` 為 `tongxing_*`:`kongwangKind='xiao'`(位置式,預設,sohu 274267505、yixiansheng 4527、zggdfs 的說法),同時輸出 `kongwangKindDegree='kongxiang'`(度數式:36fengshui 稱超限者為「空向」,ifeng 亦不稱其為小空亡),並附 `schoolNote`。`kongwangLabelScheme='degree'` 時把 `kongwangKind` 改取 `kongwangKindDegree`。
   - 現有 fixtures 中「子山 6.5° 兼癸」「乾山 322.2° 兼亥」期望 `xiao` 屬單一派說法,測試要標 school-specific(見附錄 A、附錄 B)。
9. 八宅附加: `boundaryKind='gua'` 且 `boundaryDist < max(uncertainty, 3)` → 產生 Finding「接近八卦分界,宅卦可能是 A 宅或 B 宅」。
10. 磁北與真北兩種讀法落在不同山或不同卦時,UI 並列顯示(orientation.md 2.11)。

#### 2.1.4 三針(選項,`showSanZhen=false`)

人盤中針 = 地盤逆時針 7.5°(子中心 352.5°,`index = (floor(b/15)+1)%24`);天盤縫針 = 順時針 7.5°(子中心 7.5°,`index = floor(b/15)%24`)。方向依據 wawlhld.com/m/lpzs/213.html(格縫對正針子午)、fushantang j0110.html(人盤逆、天盤順)、loktinfengshui.com.au(左 7.5 / 右 7.5)三處一致(信心: 中,luopan_rings.verify.md R5);sohu 455508170 的相反措辭已判為視角差異。玄空與八宅**只用地盤正針**。[已更正] 「三針偏移方向」的引用來源只可引 fushantang 與 loktin,zh-yue.wikipedia 的中針/縫針是另一套(雙山 48 方位),不可引用(orientation.verify.md V5)。

#### 2.1.5 磁北與真北(D06)

- `真方位 = 磁方位 + D`,`磁方位 = 真方位 - D`,D 東偏為正、西偏為負(NOAA ngdc.noaa.gov/geomag/declination.shtml、Wikipedia Magnetic_declination,信心: 高)。
- 台北 D = -5.03°(WMM2025,2026.0)、-5.06°(2026-09-29);面向真北時羅盤讀數約 **005°,不是 355°**(vocus 68cad068 把符號寫反,已被 fixtures 鎖定)。台灣各地 -4.3°(高雄)到 -5.1°(台北)。「-3~-4°」是舊資料(IGRF-14 台北 2000 年 -3.44°、2010 年 -3.86°、2025 年 -4.99°)。
- 不校正時方位換山的機率 = |D|/15(台北 33.6%),換卦 |D|/45(11.2%)。
- 平台事實已確認: iOS `webkitCompassHeading`(WebKit `WebCoreMotionManager.mm` 的 `magneticHeading`)與 Android `TYPE_ROTATION_VECTOR`(官方文件 Y 軸指磁北)都是**磁方位**,不需再猜(orientation.verify.md V15)[已更正]。Capacitor 原生外掛回真北或磁北仍需逐一檢查,避免重複校正。
- 預設不校正(與實體羅盤、多數風水師一致)。開關 `northMode='true'` 時,手機讀數先 `toTrue`。兩基準得出不同山或卦時並列。D 值來源: 內建城市表(orientation.md 3.5,WMM2025 2026.0,含年變化,台灣約 -0.03~-0.04°/年,每年更新)或離線 WMM2025(NOAA 係數,公有領域,pygeomag 已證明僅需一份 COF 即可;模型有效至 2029 年底,之後必須換新模型)。
- 磁偏角資料例(東偏為正,2026.0): 台北 -5.03、新北 -5.01、台中 -4.71、高雄 -4.32、花蓮 -4.79、澎湖 -4.43、金門 -4.43、香港 -3.29、北京 -7.53、東京 -7.91、新加坡 +0.21。完整 40 城見 orientation.md 3.5 與 orientation.json `info`(17 筆 `declinationReference`,容差 0.02°)。

#### 2.1.6 「向」取法政策(D07,信心: 低,產品政策)

無壓倒性共識(orientation.md 4.1、orientation.verify.md V9):

| 建築類型 | 預設的向 | 備用 |
|---|---|---|
| 電梯大樓/公寓 | 自家主採光面(最大落地窗或陽台,朝開闊處) | 整棟大樓正面;大門;「樓層 ≤9 用大樓正面」規則(Lillian Too/WOFS,`facadeFloorRule`) |
| 透天 | 大門與主採光面差 ≤45° 用大門;否則用主採光面並標 `conflict` | 主採光面、大門、獨立出租時自住入口 |
| 店面 | 臨街主出入口朝向 | 主採光面 |
| 辦公室 | 同大樓住戶;獨立門面式同店面 | 大樓正面 |

大門、主採光面、大樓正面三者夾角(取圓周差)超過 45° 一律回傳三個候選並 `conflict:true`,由使用者確認。`pickFacing` 對無採光資料退回大門並標低可信。

**[已更正] 宅向與門向分成兩個輸入**(複查 V10、bazhai.md 3.4 與 orientation.md 4.1 的預設不一致): 玄空吃 `facing.xuankong`(宅向,依上表),八宅吃 `facing.bazhai`(預設 `bazhaiFacingBasis='door'` 用大門朝向;可切 `'house'` 沿用宅向)。UI 詢問順序照 orientation.md 4.1 的 8 題(每題一句)。

#### 2.1.7 量測與不確定度

- 多次量測必須用圓周平均(`[359,1]` 算術平均 180,圓周平均 0)。`uncertainty = max(baseline, 2*σ)`。
- **[已更正] 不確定度預設**: 純函式 `analyzeBearing` 的參數預設仍為 3.0(fixtures 期望值依此);**App 層傳入的預設 `measureUncertainty=5.0`**,或依 iOS `webkitCompassAccuracy`/Android 精度、鎖定 σ 動態取 `max(5, 2σ, accuracy)`。3° 只在使用者手動選「戶外理想」時使用。理由: pointme.live 的 ±2~5° 只適用高階機戶外理想條件,中階機 ±5~10°,入門機 ±10~20°(orientation.verify.md V12)。
- 手機只適合 24 山等級判定,不適合 72 龍(5°/格)、120 分金(3°/格)。

#### 2.1.8 邊界情況

- 輸入 < 0 或 ≥ 360、NaN、Infinity: 前者正規化,後者回錯誤(`INVALID_BEARING`)。
- 恰好在界線(7.5 的整數倍)歸順時針下一山;UI 不顯示「剛好在線上」,用 `onLine`(0.5° 內)。
- `dev` 保留正負號(玄空需要知道兼哪一側)。
- 顯示「子山午向兼壬丙」: 坐山偏向 `leanTo`,向山偏向 `leanTo` 的對山。
- 分金格 `cell = floor((dev+7.5)/3)`,`dev=+4.5` 恰為第 4 格起點,與 `zone` 約定不同;UI 以 `zone` 為準,格子只做視覺參考(orientation.md 2.9)。

---

### 2.2 calendar(立春、節氣、干支、元運)

依據: annual.json meta(參考實作、23 個來源 URL、驗證統計)、xuankong_core.md 2.9、bazhai.md 1.2、各 verify。fixtures: annual.json、bazhai.json `meta.lichun_cst_1900_2100`、xuankong_core.json `yun_of_datetime`。

#### 2.2.1 實作方式

**直接採用 annual.json `meta.referenceImplementation.source`(約 210 行 UMD,無相依)作為 calendar 核心**,原樣抽出成 `src/core/calendar/fengshui-annual.js`,並以 `testRunner.source` 為單元測試入口(已重算 191/191 通過)。方法: VSOP87D 地球 37 項截斷 + 章動 4 項 + 光行差 + Espenak-Meeus ΔT,牛頓法解太陽視黃經 (285+15i) 度。規格化要點:

| 項目 | 規格 |
|---|---|
| 節氣索引 | `i=0..23`: 0=小寒 1=大寒 2=**立春** 3=雨水 ... 23=冬至;偶數為「節」(月界),奇數為「中氣」 |
| 精度 | 對 JPL Horizons DE441(1900-2049,n=3600)最大 0.8 分、平均 0.18 分;2050-2100 最大 2.96 分(ΔT 外推差);對 HKO 2019-2028 最大 0.94 分;對 CWA 2015-2027 最大 0.96 分 |
| 支援年份 | 1900-2150。**>2150 會 throw**,<1900 ΔT 夾在 1900(1864、1884 交運日 22/22 案例仍通過,誤差 < 5 秒級)。超出範圍的應用層行為: `fengshuiYear` 以 180 年週期外推並回 `approx:true`,UI 只在使用者輸入 1864 年以前或 2150 年以後才會遇到 |
| 顯示 | 顯示到分時**四捨五入到分**(HKO/CWA/PMO 都是四捨五入,不是截斷;bazhai.verify.md R7) |
| 官方表分歧 | HKO 與 CWA 在 196 個共同節氣中有 6 個差 1 分(例: 2023 立春 10:43 vs CWA 2022 版 10:42);容差 2 分可吸收。PMO 與 HKO 28/28 一致 |
| 2026 立春 | 04:01:50 CST(參考實作),四捨五入 04:02;lunar_python 04:02:08、PMO/新華社 04:02。**不可硬編 04:01:51**,也不可寫「天文台曆表一致」(HKO 曆表 PDF 只有日期,wealth_position.verify.md R9)[已更正] |

交叉驗證(已用程式重算): bazhai.json 的 201 年 Skyfield 表對本實作最大差 68.9 秒(2098 年),1900-2050 皆在數十秒內。比較容差 120 秒。**不要再維護第二張硬編立春表**(xuankong_core.md 2.9 的 `LICHUN` 表與 1864 20:13、1884 16:45 為程式估算,複查建議改 20:11、16:49;本檔以 calendar 計算值取代,見附錄 A)。

#### 2.2.2 函式

```ts
termInstant(year, i): ms            // 節氣瞬間(該年曆年內)
lichun(year): ms
fengshuiYear(ms): number            // 立春精確瞬間換年
yearGanzhi(fy): {index, stem, branch, name}
monthOf(ms): {jieName, start, end, branch, order, stem, name}   // 節為界;五虎遁
nineYun(fy): {yun, yunYear, era}    // era 對應 annual.json 的 yuan
formatCST(ms, withSeconds?): 'YYYY-MM-DD HH:mm'
toInstant({local:'YYYY-MM-DDTHH:mm', utcOffset:'+08:00'}): ms
lichunFlags(ms, timeKnown): {nearLichun, dateIsLichunDay, alternatives}
```

#### 2.2.3 規則

1. **年**: `fengshuiYear(ms) = ms >= lichun(utcYear) ? utcYear : utcYear-1`。干支年 `idx=((fy-4)%60+60)%60`,天干 `idx%10`、地支 `idx%12`。
2. **月**: 兩個相鄰「節」之間為一月;`order` 0=寅月(立春)... 11=丑月(次年小寒)。月干用五虎遁 `stem=(2*yearStem+2+order)%10`。**月的年份看立春,不看元旦**(丑月 1 月屬上一個風水年,見附錄 B 補充向量)。
3. **九運**: `d=((fy-1864)%180+180)%180`,`yun=floor(d/20)+1`,`yunYear=(d%20)+1`,`era = d<60 ? 上元 : d<120 ? 中元 : 下元`。九運 = 2024-02-04 16:27 CST 起(HKO 官方),至 2044 年立春(2044-02-04 12:44 CST,參考實作 12:44:06,bazhai 表 12:44:21,xuenb 12:43:36;日期 02-04 不變,分鐘級預測誤差約 ±6 分),所以 **2044-02-03 全日與 2044-02-04 上午仍屬九運**。交運年立春不一定在 2/4(1904、1924、1944、1964 在 2/5;1984 立春 23:18 距跨日僅 41 分鐘),App 只收日期時,落在交運日當天要提示輸入時間。(信心: 高)
4. **出生時刻**: 命卦與月柱都需要把出生時刻換成 UTC 再與立春比較。輸入必須帶 `utcOffset`。台灣 1938-1945 年(1937-10 起)使用日本標準時 +09:00,立春時刻的時鐘偏移在 1900-2050 年只有這 8 年是 +09:00(bazhai.verify.md R19,zoneinfo Asia/Taipei 逐年重算)。UI 行為: 使用者選台灣出生年 1938-1945 時預填 `+09:00` 並顯示提示「當時台灣使用日本標準時間(比現在快 1 小時),請確認時間是否為當時的鐘錶時間」。偏移查表由 `Intl`(Asia/Taipei)或 tzdata 產生,不硬寫規則;台灣夏令時間(1946-1961、1974-1975、1979)不涵蓋 1-2 月,不影響立春比較。
5. **臨界旗標**: 出生時刻與立春相差 ≤ 2 分鐘 → `nearLichun=true`,結果標「臨界,請確認出生時分」。不知出生時刻且出生日為立春日 → `dateIsLichunDay=true`,`alternatives` 同時回傳立春前/後兩種結果(每年只有 1 天,約 0.27% 的生日)。
6. **農曆春節年界**(`yearBoundary='lunar_new_year'`): 立春表不含農曆。需引入農曆庫(建議 `lunar-javascript`,即 6tail 的 lunar_python 的 JS 版,複查以 Python 版對 1982/2000/2020/2021 春節 4/4 吻合;JS 版本本次未驗證,引入時先跑同樣 4 個日期與 annual.json 的干支年)。預設不使用。
7. **年界通行度敘述 [已更正]**: 來源證明「以立春為界」是專業主流(白如雪 hokming、研易人士 sohu、周易人命網),但**沒有任何來源證明「精確到分」是通行做法**(三個來源是日期層級語氣)。精確到分是干支曆的天文定義加上工程一致性的選擇,作為預設;`lichun_date_only`(只比日期)在 UI 明列為「多數文章的做法」。年界分歧量化(1950-2050 逐日,中午出生): 立春法對春節法 2.04% 的日子不同,對元旦法 9.44%;春節與立春日期差 -14 到 +16 天,平均 1.0 天。台灣民間實務比例無統計(信心: 未知)。
8. 交運判斷一律呼叫 `calendar`,`xuankong` 不得再自帶立春表。

#### 2.2.4 輸出範例(`analyze(2026-09-29 12:00 CST)`,已用程式重算)

```json
{ "fengshuiYear": 2026, "yearGanzhi": "丙午", "lichun": "2026-02-04 04:02",
  "month": { "jie": "白露", "name": "丁酉", "order": 7, "start": "2026-09-07 22:41", "end": "2026-10-08 14:30" },
  "yun": { "yun": 9, "yunYear": 3, "era": "下元" } }
```

#### 2.2.5 邊界情況

- 立春前一秒與後一秒: 結果換年(用 ms 比較,不要先轉字串)。
- 1 月出生: 屬上一風水年(丑月)。
- 12/31 UTC 但已是 1/1 CST: `getUTCFullYear` 為前一年,立春比較仍正確(立春在 2 月)。
- `lichunFlags` 的 2 分鐘門檻與官方表 ±1 分歧一致。

---

### 2.3 bazhai(八宅)

依據: bazhai.md、bazhai.verify.md。fixtures: bazhai.json(135 案)。

#### 2.3.1 輸入與輸出

輸入:

```json
{ "household": [
    { "id": "p1", "name": "本人", "gender": "F",
      "birth": { "local": "1990-05-15T10:30", "utcOffset": "+08:00", "timeKnown": true },
      "role": "breadwinner" } ],
  "facing": { "bazhai": 180 },
  "settings": { "yearBoundary": "lichun_exact", "coupleBasis": "breadwinner" } }
```

`role`: `breadwinner`(主要收入者)、`holder`(戶主)、`wife`、`husband`、`child`。`gender`: `M`|`F`。

輸出(1990-05-15 出生女性、坐子向午的房子,已用第 2.3.3 的演算法重算):

```json
{ "meta": { "schema": "fengshui.bazhai/1" },
  "people": [ { "id": "p1",
      "ming": { "effectiveYear": 1990, "rawNumber": 5, "guaNumberUsed": 8, "gua": "艮", "group": "west",
                "flags": { "nearLichun": false, "dateIsLichunDay": false, "alternatives": [] } },
      "stars": { "北": "五鬼", "東北": "伏位", "東": "六煞", "東南": "絕命",
                 "南": "禍害", "西南": "生氣", "西": "延年", "西北": "天醫" },
      "wealthOrder": [ { "star": "生氣", "dir": "西南" }, { "star": "延年", "dir": "西" },
                       { "star": "天醫", "dir": "西北" }, { "star": "伏位", "dir": "東北", "backup": true } ] } ],
  "house": { "facingBearing": 180, "sitBearing": 0, "facingMountain": "午", "sitMountain": "子",
             "gua": "坎", "group": "east",
             "stars": { "北": "伏位", "東北": "五鬼", "東": "天醫", "東南": "生氣",
                        "南": "延年", "西南": "絕命", "西": "禍害", "西北": "六煞" } },
  "match": { "byPerson": { "p1": false }, "policy": "mingOverHouse",
             "advice": "以個人命卦重排床頭、書桌、灶口的吉方;大門若無法改,至少讓門、主臥、灶口三項中有一項落在吉方" },
  "findings": [] }
```

#### 2.3.2 常數

**遊年八星 8x8 表**(命卦或宅卦 × 方位;已用爻變序列、相對爻差法、大遊年歌三法重算,並對 9 份公開文本逐格比對,再由複查獨立重算;本檔整合時再次重算並與 bazhai.json `star_matrix` 逐格一致,表對稱)(信心: 高;獨立來源: 新玄機雜誌 fengshui-magazine.com.hk/No.273-Mar20/A301.htm、神機閣 shenjige.cn/details/igtBMFkPc.html、Feng Shui Store fengshuiweb.co.uk/eight-mansions-feng-shui-2/、Uncle Kin unclekin2604.blogspot.com/2012/03/blog-post.html):

```json
{
 "坎": {"北":"伏位","東北":"五鬼","東":"天醫","東南":"生氣","南":"延年","西南":"絕命","西":"禍害","西北":"六煞"},
 "艮": {"北":"五鬼","東北":"伏位","東":"六煞","東南":"絕命","南":"禍害","西南":"生氣","西":"延年","西北":"天醫"},
 "震": {"北":"天醫","東北":"六煞","東":"伏位","東南":"延年","南":"生氣","西南":"禍害","西":"絕命","西北":"五鬼"},
 "巽": {"北":"生氣","東北":"絕命","東":"延年","東南":"伏位","南":"天醫","西南":"五鬼","西":"六煞","西北":"禍害"},
 "離": {"北":"延年","東北":"禍害","東":"生氣","東南":"天醫","南":"伏位","西南":"六煞","西":"五鬼","西北":"絕命"},
 "坤": {"北":"絕命","東北":"生氣","東":"禍害","東南":"五鬼","南":"六煞","西南":"伏位","西":"天醫","西北":"延年"},
 "兌": {"北":"禍害","東北":"延年","東":"絕命","東南":"六煞","南":"五鬼","西南":"天醫","西":"伏位","西北":"生氣"},
 "乾": {"北":"六煞","東北":"天醫","東":"五鬼","東南":"禍害","南":"絕命","西南":"延年","西":"生氣","西北":"伏位"}
}
```

**產生規則**(可用來寫屬性測試,不要另外手打表): 從卦本身起,依序改 上爻、中爻、下爻、中爻、上爻、中爻、下爻、中爻,第 k 步所得卦的方位 = 該星位置,星序 生氣、五鬼、延年、六煞、禍害、天醫、絕命、伏位。卦爻(下→上,1=陽): 乾111 兌110 離101 震100 巽011 坎010 艮001 坤000。

**性質(屬性測試)**: (1) 對稱: `星(A看B)==星(B看A)`,共 28 對;(2) 每列每欄 8 星各一(拉丁方);(3) 東四命(坎震巽離)的四吉星必落在東四方位,西四命的四吉星必落在西四方位。

**八星屬性**:

| 星 | 九星名 | 五行 | 傳統等級 | 財運面預設權重 BAZ_VAL |
|---|---|---|---|---|
| 生氣 | 貪狼 | 木 | 上吉 | 1.0 |
| 延年 | 武曲 | 金 | 上吉 | 0.75 |
| 天醫 | 巨門 | 土 | 中吉 | 0.55 |
| 伏位 | 輔弼 | 木 | 小吉 | 0.25 |
| 禍害 | 祿存 | 土 | 次凶 | -0.3 |
| 六煞 | 文曲 | 水 | 次凶 | -0.3 |
| 五鬼 | 廉貞 | 火 | 大凶 | -0.5 |
| 絕命 | 破軍 | 金 | 大凶 | -0.6 |

等級排序有實質分歧(D14): 原文 生氣=延年 > 天醫 > 伏位、絕命=五鬼 > 禍害=六煞;研易人士、易經堂、明天機 生氣>延年>天醫>伏位、絕命>五鬼>六煞>禍害;神機閣 生氣>天醫>延年>伏位、絕命>五鬼>禍害>六煞(完全相反)。**預設** 吉 生氣>延年>天醫>伏位、凶 絕命>五鬼>六煞>禍害,做成可調權重(設定 `tianyiFirst` 對調延年與天醫)。權重數字是設計值,只有順序有來源依據。

**24 山→宅卦**: 用 geo 的 `guaAt`。

#### 2.3.3 演算法(逐步)

**A. 命卦**

1. 出生瞬間 = `calendar.toInstant({local, utcOffset})`。有效年 `Y`: `yearBoundary='lichun_exact'`(預設)= `fengshuiYear(instant)`;`lichun_date_only` = 只比日期(不知時刻的退路,也是多數速查表的做法);`fixed_feb4`;`lunar_new_year`;`gregorian_jan1`(不建議)。
2. `mod9(x) = ((x-1)%9+9)%9+1`(0 視為 9)。男 `n = mod9(2 - Y)`;女 `n = mod9(Y + 4)`。保留 `rawNumber = n`。
3. `n===5` → 男寄坤(2)、女寄艮(8)。`gua = {1:坎,2:坤,3:震,4:巽,6:乾,7:兌,8:艮,9:離}[n]`;`group = 坎震巽離 ? east : west`。
4. 等價寫法(交叉驗證用): 1900-1999 男 `mod9(100-yy)` 女 `mod9(yy-4)`;2000-2099 男 `mod9(99-yy)` 女 `mod9(yy+6)`。排山掌訣(《八宅明鏡》,上元 1864、中元 1924、下元 1984、下一上元 2044;男起 1/4/7 逆、女起 5/2/8 順)與封閉式 1400 組(1700-2399)0 不符;複查另以 1900-2099 兩套末兩位公式 400 組、西方數字和法 0 不符(信心: 高;獨立來源: fs.qqqs.org/fssj/396.html《八宅明鏡》原文、每日頭條 kknews.cc/zh-tw/geomantic/2ypj2m9.html、fengshuiweb.co.uk)。
5. **陷阱**: Your Chinese Astrology 步驟「和為 0 時用 10」會讓 2000 年男算成 8(應 9)、女 7(應 6),**不可採用**。舊引擎見第 6 節。2043 女命為巽(今日農曆、周易人命網速查表印成震,是錯字)。
6. 旗標: 見 calendar 2.2.3 第 5 點。`alternatives` 內含另一年界的結果。

**B. 宅卦**

1. `facingBearing` 取 `facing.bazhai`(預設大門朝向,`bazhaiFacingBasis`)。`sit = normalize(facing + 180)`。
2. 宅卦 `GUA[floor(((sit+22.5)%360)/45)]`,邊界 `[起,止)`(設計約定,來源無規定)。**先做角度正規化**(bazhai.md 偽碼對 facing < -180 會得 `undefined`)[已更正]。
3. 以「坐」定宅(坐北朝南=坎宅;英文站有留言不一致,以中文一致來源為準,信心: 高)。
4. 接近八卦分界: 用 geo 的 `boundaryDist` 警示。

**C. 命宅配**: `match = ming.group === house.group`。不配時預設 `mingOverHouse`(依命不依宅): 床、書桌、灶口、大門位改用命卦吉方,宅卦只作相配判斷(信心: 中)。多人處理見 2.3.5。

**D. 星位查表**: `stars[dir] = STAR_TABLE[gua][dir]`。命盤(人)與宅盤(屋)兩層同時輸出,床/灶口/書桌用命盤,大門與整屋相配用宅盤(D14、bazhai.md 3.3,信心: 中)。

**E. 財位序(D19)**: `wealthOrder` = 命卦的 生氣、延年、天醫,伏位當備位(信心: 中;易經堂: 生氣財運大好、延年很好、天醫不錯、伏位小吉)。「延年 > 天醫」只有網易說延年旺財不如生氣,沒有任何來源明說延年勝過天醫,反而搜狐、明天機把天醫當財位(wealth_position.verify.md R6),故 0.75 對 0.55 是設計值,`tianyiFirst` 開關保留(港派天醫地位較高)。**財位模組絕不可因為生氣是財星就建議把灶座放在生氣位**: 古法灶座壓生氣位是「人丁不旺、財產受損」(Uncle Kin 灶座各方應驗表,信心: 高)。

#### 2.3.4 八星用途矩陣(位置與朝向分開)

位置(position)= 房間/大門/灶座/廁所落在屋子的哪個方位(從宅中心看);朝向(facing)= 人面向/床頭指向/灶口指向。查同一張 8x8 表,只是「方位」由不同的物理量提供;兩區不互相扣分(D21,bazhai.md 3.6)。範例(`usage_position_vs_facing_lookup`): 坎命,房間在東南 → 生氣;床頭朝東 → 天醫;灶座在西南 → 絕命;灶口朝東南 → 生氣;書桌面向東南 → 生氣。

| 星 | 大門(位置) | 主臥(位置) | 床頭朝向 | 書桌/辦公桌面向 | 灶座(位置) | 灶口(朝向) | 廁所(位置) | 客廳沙發/魚缸(位置) |
|---|---|---|---|---|---|---|---|---|
| 生氣 | 最佳 | 宜 | 事業、財運、精力 | 首選(書房/辦公桌) | 不宜(古法: 人丁不旺財產受損) | 宜(催財) | 忌(幾乎一致) | 宜(四吉位不分先後) |
| 延年 | 宜 | 宜(夫妻房) | 感情、長壽 | 人際類工作 | 不宜(古法: 婚姻難成) | 宜 | 忌 | 宜 |
| 天醫 | 宜 | 宜 | 健康、久病康復 | 次選 | 不宜(古法: 久病臥床;少數派可) | 宜(主無病) | 忌(退財漏財) | 宜 |
| 伏位 | 尚可 | 宜 | 幼童、靜心 | 幼童 | 不宜(古法: 無財無壽) | 宜 | 忌 | 尚可 |
| 禍害 | 忌 | 忌 | 夫妻命卦不同時的折衷睡向 | 避免 | 宜壓(無災無病不退財) | 避免 | 宜 | 避免 |
| 六煞 | 忌 | 忌(單身者居室視為桃花位,少數派) | 避免 | 避免 | 宜壓(發丁發財) | 避免 | 宜(亦宜儲物) | 避免 |
| 五鬼 | 忌 | 忌 | 避免 | 避免 | 宜壓(古法;西方主張避開) | 避免 | 宜(亦宜儲藏) | 避免 |
| 絕命 | 大忌 | 大忌 | 避免 | 避免 | 宜壓 | 大忌 | 宜(亦宜不常用儲藏) | 避免 |

信心: 吉方開門立床、凶方放廁灶座這條主線(高);朝向細項與灶位分歧(中)。

**[已更正] 客廳沙發/魚缸(複查 R24 refuted)**: 舊寫法「首選生氣位、次選伏位」只對《八宅明鏡》網頁現代加註(標明「不屬於原書」)的東四命一半成立;西四命該來源反而把生氣列次選(西四命首選延年+天醫)。現規則: **四吉位不分先後**;東四命首選「生氣+伏位」、西四命首選「延年+天醫」的分級只有單一來源,預設不採用,僅作可選開關 `livingRoomGradeByEastWest`(D22)。**財位序仍依易經堂** 生氣>延年>天醫。

**[已更正] 位置與朝向的古法敘述(複查 R13)**: 古法兩說並存: 灶章「灶座論方不論向,灶口論向不論方」(《八宅明鏡》、Uncle Kin、乾坤網三處一致);「房門、床、碓、廁只論背座之方,不論向」出自灶章;**但同書床章另有「安床總以房門為主,坐煞向生」「床向易明不宜暗」的朝向語**(信心: 中,只有第一風水網一個版本可讀)。UI 與資料模型仍分開輸出位置與朝向,文案**不得宣稱「古法排除床向」**。

**[已更正] 細部措辭**: 「考生面向生氣」改為「書房/辦公桌面向生氣」;「學齡幼童面向伏位」改為「幼童面向伏位」(Feng Shui Store 原文只寫 very young children 與 work desk,複查補充)。usage fixtures 的 note 稱 qqqs 只支持位置,實查 qqqs 床章有朝向語,note 需同步修正(不影響期望值)。

灶: 預設「坐凶向吉」(D15,台港主流,Uncle Kin、乾坤網、明天機,信心: 高);少數派「灶座放吉方」(Feng Shui Store 天醫位放爐灶、Feng Shui Beginner 生氣延年天醫宜廚房)以 `stovePreferAuspicious=true` 切換。

#### 2.3.5 命宅不配與多人家庭

| 情境 | 預設 | 選項(`coupleBasis`) |
|---|---|---|
| 單人 | 依 2.3.3 C | 無 |
| 夫妻不同組 | `breadwinner`: 大門照顧主要收入者;睡向照顧與宅卦相剋的一方(Feng Shui Store);「兩吉給男一吉給女」(Uncle Kin) | `wife`(乾坤網: 夫妻睡房在妻子吉方)、`husband`、`holderOnly`、`averaged` |
| **[已更正] 只看戶主** | 新增選項 `holderOnly`: 搜狐研易人士「只要戶主的命卦配合宅卦即吉,其他成員的命卦可以不予理會」(複查 R11 補充,與 breadwinner 不同) | |
| 門主灶三要 | 「門、主、灶三者皆吉為上吉,兩者中吉,一者可居,皆凶大凶」(Uncle Kin)。輸出 `threeKeys` 計分供文案用 | |

「住不配的宅約只享 70%」(Feng Shui Store 單站個人估計)不放進 UI 數字。CSDN「八宅只用於門樓與灶向」為少數派,不採用。

#### 2.3.6 少數派與預設關閉項(`showMinorityTechniques=false` 時不顯示)

- **五鬼運財**(D17): 存在此說(李光東 sina.cn/news/detail/5171178382821101.html,前提為八字日主水旺而喜火;台灣文民 taiwanfolk.com/blog/detail/73;Uncle Kin「灶坐五鬼橫發資財」;《八宅明鏡》「壓五鬼方應主永無火盜」),無公開可驗證標準。預設五鬼 = 破財凶位,不做運財推薦。(信心: 中,存在此說;低,有效性)
- **六煞桃花**(不穩)與**延年桃花**(穩;Uncle Kin「延年所在方位便是桃花位」)[已更正: 複查補記延年桃花]。感情建議的少數派區並列兩說。
- **鬼門線**(D20): 只有搜狐研易人士一個來源,15 度寬,預設關閉(信心: 低)。
- 古法「延年天醫 ≥ 三吉」以外,原文「三吉」指生氣、天醫、延年,伏位另論(且原文「右弼所屬不定吉凶」),與預設相容,無需改碼。

#### 2.3.7 邊界情況與已知缺口

- 立春前後 2 分鐘內: `nearLichun`;不知時刻的立春日: `alternatives`(D10)。
- 1938-1945 年台灣出生: 輸入層換算時區(見 calendar 2.2.3 第 4 點)。**現有 fixtures 沒測這段**(minggua_birth 皆為 +08:00),見附錄 B 補測案例(1940 年立春 1940-02-05 07:07 CST)。
- facing 恰為扇區邊界(22.5+45k 度,如 22.5、157.5、337.5)與 24 山邊界(7.5+15k): 半開區間 `[起,止)`;現有 facing 案只有 0/45/90/135/158.5/180/200/225/270/293.5/315/350,補測見附錄 B。
- 負角度與超過 360 度的輸入: 先正規化。
- 出生年在 1900-2100 以外: 封閉式公式仍成立,年界需 calendar 支援(見 2.2.1 範圍);超出範圍以 `approx` 旗標提示。
- 命卦 5 的寄宮以性別決定,`rawNumber` 保留以便文案說明。
- 舊引擎差異見第 6 節。

---

### 2.4 xuankong(玄空飛星山向盤)

依據: xuankong_core.md(核心排盤)、xuankong_patterns.md(格局)、兩份 verify。fixtures: xuankong_core.json、xuankong_patterns.json。舊引擎診斷見第 6 節。

#### 2.4.1 常數

24 山環自壬起(玄空排盤慣用起點),`RING = [名, 洛書宮, 元龍(0地 1天 2人)]`,與 geo 2.1.1 是同一份資料的不同起點,實作時**由 geo 表生成**,不得另外手打:

```json
[["壬",1,0],["子",1,1],["癸",1,2],["丑",8,0],["艮",8,1],["寅",8,2],["甲",3,0],["卯",3,1],["乙",3,2],
 ["辰",4,0],["巽",4,1],["巳",4,2],["丙",9,0],["午",9,1],["丁",9,2],["未",2,0],["坤",2,1],["申",2,2],
 ["庚",7,0],["酉",7,1],["辛",7,2],["戌",6,0],["乾",6,1],["亥",6,2]]
```

陽(順飛)= 乾坤艮巽 壬丙甲庚 寅申巳亥;其餘 12 山為陰(逆飛)。**舊引擎此表 8 山寫反**(見第 6 節)。**不得引用 AI 生成的第三方速查表**(voidforall/fengshui.skill 的陰陽表是錯的,xuankong_core.verify.md R2)。

飛布宮序 `FLY_ORDER=[5,6,7,8,9,1,2,3,4]`(中 乾 兌 艮 離 坎 坤 震 巽),`fly(center, forward)[p_i] = mod9(center ± i)`。

替星表(替卦用;`TI_A` 蔣大鴻/沈氏/中州派/Wikibooks,**信心 高**: 四個獨立來源逐山吻合,複查由 medium 升 high;`TI_B` 陳澤泰《陽宅鏡》無常派,只見無常派,信心 中):

```json
{ "A": { "子":1,"癸":1,"甲":1,"申":1, "壬":2,"卯":2,"乙":2,"未":2,"坤":2,
         "乾":6,"亥":6,"辰":6,"巽":6,"巳":6,"戌":6, "酉":7,"辛":7,"丑":7,"艮":7,"丙":7,
         "寅":9,"午":9,"庚":9,"丁":9 },
  "B": { "坤":2,"壬":2,"乙":2, "艮":7,"丙":7,"辛":7, "巽":6,"辰":6,"亥":6, "甲":1,"癸":1,"申":1,
         "丑":9,"丁":9,"酉":9, "巳":4,"戌":4,"乾":4, "子":3,"卯":3,"未":3, "庚":8,"午":8,"寅":8 } }
```

A 表中實際改變數字的只有 13 山(甲申壬卯乙艮丑丙巽辰巳庚寅),其餘 11 山替星等於原星。

#### 2.4.2 排盤演算法 `buildChart(yun, sit, {ti, tiTable})`

輸入: `yun` 入運(1-9,見 2.4.4)、`sit` 坐山名。向山 `face = RING[(idx(sit)+12)%24]`(對山必同元龍同陰陽,24/24 已驗)。

1. 運盤 `Y = fly(yun, true)`(順飛,任何情況都順飛;公式 `第 i 宮 = ((yun-1+i)%9)+1`,已與 Wikibooks 213 個原盤運星一致)。
2. 對 (山盤, 坐山) 與 (向盤, 向山) 各做一次:
   - `star = Y[宮(山)]`(山盤入中星 = 運盤坐宮的星;向盤入中星 = 運盤向宮的星)。
   - **二次轉換**: `star≠5` 時,取「星本宮(洛書數即宮)內、與該山同元龍的那一山」為伴 `mate`;`star=5` 時 `mate = 山自身`(5 入中用山自身陰陽,與「用運盤中宮運星所在卦宮的同元龍山」等價,216 盤差異 0;**不是看運星奇偶**,英文維基「Period number 的陰陽」措辭含糊,實作註解要寫明,xuankong_patterns.verify.md R2)。
   - `forward = 陽(mate)`。
   - `enter = star`;**替卦**時 `enter = TI[tiTable][mate]`(5 入中不替);**順逆仍看原 mate 的陰陽,不看替星**(與 Wikibooks 替卦盤 216/216 吻合;改看替星宮會有 102 盤不同;中州派「不可以用替換后的山向阴阳去决定顺飛逆飛」)。
   - `pan = fly(enter, forward)`。
3. 每宮三數 `{yun: Y[p], shan: 山盤[p], xiang: 向盤[p]}`(左上山星、右上向星、下方運星,「左山右向」)。
4. 免查表等價(屬性測試用): 入中星奇數(1,3,7,9)時,地元龍順、天元人元逆;偶數(2,4,6,8)時,地元龍逆、天元人元順。432 次飛布與二次轉換 0 差異。

輸出範例(九運子山午向,下卦;運星/山/向與 xuankong_core.md 範例 3、陳昱勳文章、xuankong_patterns 重算三處一致,本檔再次以參考實作重算):

```json
{ "meta": { "chartYun": 9, "currentYun": 9, "sit": "子", "face": "午", "ti": false },
  "sitPalace": "坎", "facePalace": "離",
  "shan":  { "star": 5, "enter": 5, "mate": "子", "forward": false },
  "xiang": { "star": 4, "enter": 4, "mate": "巽", "forward": true },
  "palaces": {
    "巽": {"yun":8,"shan":6,"xiang":3}, "離": {"yun":4,"shan":1,"xiang":8}, "坤": {"yun":6,"shan":8,"xiang":1},
    "震": {"yun":7,"shan":7,"xiang":2}, "中": {"yun":9,"shan":5,"xiang":4}, "兌": {"yun":2,"shan":3,"xiang":6},
    "艮": {"yun":3,"shan":2,"xiang":7}, "坎": {"yun":5,"shan":9,"xiang":9}, "乾": {"yun":1,"shan":4,"xiang":5} },
  "pattern": "雙星會坐",
  "wholePlate": { "shan": "反吟", "xiang": null } }
```

(每宮寫法「山向/運」: 巽 63/8、離 18/4、坤 81/6、震 72/7、中 54/9、兌 36/2、艮 27/3、坎 99/5、乾 45/1。)

#### 2.4.3 由度數到山、下卦與替卦

1. 使用者提供向的方位角(`facing.xuankong`)→ `geo.analyzeBearing(facing)` 得向山 `mountain` 與 `needsTiGua`、`leanTo`。
2. 坐山 `sit = opposite(mountain)`。
3. `chart = buildChart(yun, sit, {ti: settings.useTiGua && needsTiGua, tiTable})`。
4. 預設**只做下卦 + 兼向提示**,替卦放進階(D24: 《沈氏玄空學》替卦原文未能取得,只有中州派與王亭之對沈氏「有誤」的轉述;無常派把替卦當趨吉手段不限超度,少數派不採用)。
5. **端點 [未解決→已定案為含端點]**: `|dev| <= 4.5` 歸下卦(中州派度數表 340.5-349.5 含端點);端點附「騎線」提示。xuankong_core.json 的 3 個 `locate_edge_*`(340.5、349.5、352.5,confidence=low)**不得當硬性斷言**,只斷言「不崩潰並帶騎線旗標」。
6. 兼向與大小空亡的文案要標學派(見 3 節 D04)。替卦要素的分類(出卦、陰陽差錯、同陰陽)由 geo 提供,48 個兼向扇區 32 替 16 不替(Wikibooks 48/48)。

#### 2.4.4 元運與入運(D11、D12)

- `chartYun`(排盤用)預設 = 建成年的運 = `calendar.nineYun(fengshuiYear(建成瞬間)).yun`(多數科普文章預設;香港玄燊師傅「大廈落成年份等於大廈出生時間」、星林學苑 108s.tw/article/info/290「元運的定義是房子建好的年份,並非搬進去的時間」)。
- **[已更正] 措辭**: 不寫「主流」,寫「多數科普文章預設落成年」;中州派《函授教材》與台灣命學研究中心(hhh.com.tw/columns/detail/7831)偏「遷入或重新裝潢」;洛派師傅自承「兩極化」(xuankong_core.verify.md R9)。
- 大修(`renovation`): `none`(預設)/`partial`/`full`。**只有 `full`(整戶翻新含天花與空調,星林學苑「改換天心」)**才以大修完工瞬間的運起盤;`anyRenovation` 開關讓任何裝潢都換運;`yunBasis='moveIn'` 改用遷入時運。大修判準無共識,UI 標「流派意見」。
- 三元九運 180 年為預設(台灣/香港飛星主流,龍羽堂 longyu.com.tw、吉祥坊 131.com.tw);二元八運(談養吾玄空六法;八運 1996-2016、九運 2017-2043)為開關 `yunSystem='er_yuan_8'`(2017-2023 建成者會由八運變九運)。
- **`currentYun` 與 `chartYun` 分開**: 排盤與格局名稱(旺山旺向等)用 `chartYun`;**旺衰與財丁位判讀用 `currentYun`**(今日所屬的運,`calendar.nineYun(fengshuiYear(now))`)。這條沒有任何報告直接寫明(patterns 的 `qiLabel(yun, star)` 只給參數),是本檔整合時補的推論(tag=推論,信心: 中),`chartYun≠currentYun` 時結果頁要顯示提示,列入 [未解決] U-10,需玄空老師確認。舊引擎 `analyze(year)` 把兩者混為一談(見第 6 節)。

#### 2.4.5 格局判定(只由兩個順逆位元決定)

令 σ、τ 為山盤、向盤飛行方向(+1 順、-1 逆),`N=chartYun`:

| (σ,τ) | 格局 | 條件(山星 M、向星 X) | 財丁 |
|---|---|---|---|
| (-,-) | 旺山旺向 | `M[坐宮]==N` 且 `X[向宮]==N` | 丁財兩旺(需形巒配合) |
| (+,+) | 上山下水 | `M[向宮]==N` 且 `X[坐宮]==N` | 丁財兩損(需反用) |
| (-,+) | 雙星會坐 | `M[坐宮]==N` 且 `X[坐宮]==N` | 旺丁不旺財 |
| (+,-) | 雙星會向 | `M[向宮]==N` 且 `X[向宮]==N` | 旺財不旺丁 |

窮盡性(代數證明見 xuankong_patterns.md 1.4): 216 個下卦盤全落在四種格局,統計 旺山旺向 48、上山下水 48、雙星會坐 60、雙星會向 60(五運只有旺山旺向與上山下水各 12;一運與九運只有雙星會坐與雙星會向各 12)。中州派識局心訣(山向入中星皆陰=旺山旺向;皆陽=上山下水;山陰向陽=雙星會坐;向陰山陽=雙星會向)對非五運 192 盤全吻合(僅適用下卦)。

**[已更正] 36FS zs33 口訣**: 原句「凡立向為陰山或陰向者,入中飛星逆飛,一定是旺山旺向」字面讀(向山為陰就一定旺山旺向)是錯的(陰山二至八運共 84 個組合,只有 28 個旺山旺向;48 個旺山旺向中有 20 個坐在陽山上)。規格改述為「**山盤逆飛且向盤逆飛**」,程式與文案不得用「山為陰」當判定條件(xuankong_patterns.verify.md R3)。

九運 24 山向(信心: 高;36FS zs31「12 坐 12 向」、hhh.com.tw/columns/detail/7831 的 9 個旺財座向全在雙星會向內、SINA-3BAN 打劫表交叉):
- 雙星會向(旺財)12 個(坐山→向): 壬丙、丑未、甲庚、巽乾、巳亥、午子、丁癸、坤艮、申寅、酉卯、辛乙、戌辰。
- 雙星會坐(旺丁)12 個: 子午、癸丁、艮坤、寅申、卯酉、乙辛、辰戌、丙壬、未丑、庚甲、乾巽、亥巳。
- 九運 24 盤都是「山星 9 與向星 9 同宮」。七運與八運各 6/6/6/6(七運信心由 medium 升 high: 12 個原本缺第二來源的盤已有 5 個以上直接旁證;八運 24 山已對兩個獨立作者一致,36FS zs31 的壬丙/丙壬互換是筆誤)。一至六運名單見 xuankong_patterns.md 2.5(程式推導,信心: 中)。

#### 2.4.6 特殊格局(形式化條件)

| 名稱 | 條件 | 預設 |
|---|---|---|
| 全局合十 | 九宮每宮 `Y+M==10`(運山)或 `Y+X==10`(運向);共 24 局(SINA-HESHI 名單,程式重算吻合;3 行來源標籤有筆誤) | 顯示 |
| 局部合十 | 某宮山、向、運三數任兩數和為 10 | 顯示 |
| 父母三般卦(三般巧卦) | 每宮山、向、運三數對 3 同餘;16 局(二五八運艮坤寅申 12 + 四六運丑未 4),且全是上山下水 | 顯示,標吉 |
| 連數三般卦 | 每宮三數為相鄰三數;16 局。三派互相矛盾: SINA-3BAN 與 36FS zs36(連珠,吉)對 SOHU(連茹,凶) | **只標記不計分**(`showLianshu`)[已更正: 補記 zs36 與 SINA 站同一邊] |
| 七星打劫 | 前提雙星會向;向宮屬 {離,震,乾} 組(離宮打劫,真)或 {坎,巽,兌} 組(坎宮打劫,假),且該組三宮所有山星向星都屬 N 的三般組(對 3 同餘);離宮 24 + 坎宮 24 + 三般巧卦 16 = 64 局(單一完整清單: SINA-3BAN 陳炳聿,信心: 高但單一清單) | 顯示 |
| 打劫不可用 | 犯全局伏吟(5 順)6 局;另 6 局犯全局反吟不在來源不可用清單內,只警示 | 顯示 |
| 全局伏吟/反吟 | 山盤或向盤入中星為 5:順飛=伏吟,逆飛=反吟 | 見 2.4.7 |
| 宮位伏吟/反吟 | 某宮(不含中宮)星等於該宮洛書數或該宮運星=伏吟;星加洛書數=10=反吟 | 旺星不扣,衰死扣 |
| 城門位 | 向宮兩旁;與向宮成河圖生成數(1-6、2-7、3-8、4-9)的為正城門 | **只顯示不進主評分**(`showChengmen`) |
| 不實作 | 山向對宮合十/形局合十(無形式化條件,試多種形式化都無區別力)、地運長短 `20×((向盤入中星-元運) mod 9)`(42 資料點吻合 38)、64 卦翻卦法、城門「同元純清」 | 第一版不做 |

城門表 `CHENGMEN[向宮] = [正, 副]`(洛書數): 離9:[4,2] 坎1:[6,8] 震3:[8,4] 兌7:[2,6] 乾6:[1,7] 艮8:[3,1] 巽4:[9,3] 坤2:[7,9]。可用性簡化規則(城門宮向星屬 N、N+1、N+2)是單一作者(刘燮钧)規則,與 SINA-HESHI 八運子山午向「有城門可用」的說法**不同義**(該盤巽宮向星4、坤宮向星6依簡化規則皆不可用),UI 註明[已更正]。

#### 2.4.7 伏吟反吟處理 [已更正,複查 R15 refuted]

- **全局伏吟**(5 順): 嚴重,`fuyinPenalty=-3` 並要求 Finding level=caution;難以調解(ZGGDFS-57 建議換屋)。
- **全局反吟**(5 逆): **一律警示**;若該盤為旺山旺向且反吟之星為 `chartYun` 當運之星 → 不扣分;否則扣 `fanyinPenalty=-1` 並註明「退運會轉凶」(zggdfs Read_60「旺運可發、退運立敗」;36FS zs35「反吟比伏吟禍害更甚」)。**舊建議「全局反吟只提示不扣分」無來源支持,已廢止**。開關: `fuyinPenalty`、`fanyinPenalty`(工程值,信心: 低)。
- 「五黃入中順飛必是上山下水」不成立(12 個反例,如一運壬山丙向為雙星會坐);只有山盤與向盤都是 5 順飛才是上山下水。
- 舉例: 九運壬山丙向 = 雙星會向 + 山盤全局伏吟(已用程式重算),UI 必須同時顯示兩件事。

#### 2.4.8 九星旺衰(五氣)與計分

`d = (star - currentYun) mod 9`(用 `currentYun`,見 2.4.4)。預設 `default`(泛化自九運公開標法;獨立佐證 SINA-HESHI 八運逐宮標法,四個標法中被佐證最好):

| d | 標籤 | 預設分數 | 說明 |
|---|---|---|---|
| 0 | 旺(當令) | +3 | 當運星 |
| 1 | 近旺生氣 | +2 | 下一運星 |
| 2 | 遠旺生氣 | +1 | 下下運星 |
| 8 | 退氣 | 0 | 剛過去的運,不旺不衰 |
| 7、6、5 | 煞衰 | -1 | |
| 4、3 | 死氣 | -2 | |

- 工程上限(**非來源,信心: 低**): 5 黃在非五運 ≤ -3;2 黑在非二運 ≤ +0.5。qi fixtures 標 medium 者要改標 low 並在 note 註明[已更正]。
- 另有 `S1`(SOHU-478153604 八運: 8 旺 9 進 1 生 765 退 432 死)、`S2`(GENDAI 八運: 9 生 1 進 7 退 6 衰 5 死 432 煞)兩套,對 d=0/1/2/8 一致,分歧在 d=3..7;`qiScheme` 可切。三張 9x9 表已逐格重算 0 差異(fixtures `qi` 81 筆)。
- **八白(D28)**: 預設 0 分(退氣,不催不禁)。`eightKeepsWealth=true` 時退氣後若分數 ≤ 0 改 +1。**[已更正] 此開關在 UI 標為「少數派說法」**: 36FS zs4 寫八白失令「失財失義、瘟疫流行」,與「退氣後仍保留財星本性」相反;SECRETCHINA 與 VOCUS 偏中性或正面;來源真的分歧。
- 星屬性與象意: 見 xuankong_patterns.md 2.1(九星名、五行、得令失令象意,信心: 高)。陰陽星: 2、4、7、9 陰;1、3、6、8 陽。

#### 2.4.9 星組合表 [已更正,複查 R18]

以 36FS zs37-zs42 逐項核對後的版本(未列出者維持 xuankong_patterns.md 2.9):

```json
{
 "2-5": {"tag":"二五交加","nature":"凶","exceptYun":[2,5],"confidence":"high"},
 "3-7": {"tag":"三七蚩尤煞","alias":["三七迭至(賊匪官災)","三七穿心煞(民間別名,未驗證)"],"nature":"凶","confidence":"high"},
 "6-7": {"tag":"六七交劍煞","nature":"凶","confidence":"high"},
 "7-9": {"tag":"七九火災","nature":"凶","confidence":"high"},
 "2-3": {"tag":"三二鬥牛煞","nature":"凶","confidence":"high"},
 "2-7": {"tag":"二七同宮","nature":"凶","confidence":"medium"},
 "3-5": {"tag":"三五戊己大煞","nature":"凶","confidence":"medium"},
 "5-7": {"tag":"五七毒藥","nature":"凶","confidence":"medium"},
 "5-9": {"tag":"五九(火生五黃)","nature":"凶","confidence":"low","note":"火生土催旺五黃;不設爐灶為推論"},
 "1-5": {"tag":"一五山臨五黃(不宜安床)","nature":"凶","confidence":"low"},
 "6-9": {"tag":"六九火燒天門","nature":"視旺衰","confidence":"medium","note":"六白得令或見八白反吉"},
 "1-4": {"tag":"一四文昌","nature":"吉","confidence":"high","note":"得令主科發;失令為四蕩一淫,主風流"},
 "1-6": {"tag":"一六(水金相生;失令主水淫天門)","nature":"視旺衰","confidence":"medium","wenchang":false},
 "3-9": {"tag":"三九文昌(木火通明;個性偏刻薄)","nature":"吉","confidence":"low"},
 "4-4": {"tag":"四四(失令偏凶,存疑)","nature":"存疑","confidence":"low","wenchang":false},
 "1-9": {"tag":"一九水火既濟","nature":"吉","confidence":"medium","note":"得運吉,失令婚姻/心眼之疾"},
 "6-8": {"tag":"六八富貴","nature":"吉","confidence":"medium"},
 "2-6": {"tag":"二六財利","nature":"吉","confidence":"medium"},
 "7-8": {"tag":"七八富(八七破財)","nature":"吉","confidence":"medium"},
 "8-9": {"tag":"八九輔弼相輝","nature":"吉","confidence":"medium"}
}
```

變更摘要: 一六 high→medium 並改標;四四移除文昌標籤(36FS zs40 寫「瘋瘟之症」,無文昌說)且 xuankong_patterns.md §0 與 §3 第 4 項同步刪除四四;五九「毒藥」名稱不見於 zs40,改「火生五黃」;三九補「個性刻薄」;「三七穿心煞」查無此詞只代表報告查過的來源沒有,列為未驗證別名,不寫成已否定。文昌位(書房/學生房建議)只用 **一四(high)** 與 **三九(low,帶但書)**。組合調整分: 吉 +0.5、凶 -1、視旺衰/存疑 0;二五在二運/五運不扣(九運一律警示)。組合的主次: 山星+向星(主)、山星+運星、向星+運星(次)。

#### 2.4.10 財位與丁位(玄空)[已更正,複查 R17 refuted]

分數(權重 `wSide=0.3`、`wYun=0.3` 為工程折衷,對應「山向組合為主、山運/向運為輔、運星最後」,優先順序有三種說法,信心: 低):

```
cai(p)  = qi(X[p]) + wSide*qi(M[p]) + wYun*qi(Y[p]) + 組合調整(p)
ding(p) = qi(M[p]) + wSide*qi(X[p]) + wYun*qi(Y[p]) + 組合調整(p)
```

候選: 財位候選 = 向星 `X[p]` 屬 `currentYun`、+1、+2(旺、近旺、遠旺)的宮,依 `cai` 排序;丁位候選同理用山星與 `ding`。**再依格局分流**:

| 宮相對位置 | 判定 | 白話 |
|---|---|---|
| 該宮 = 向宮(前方) | 可列「旺財位」(雙星會向、旺山旺向的向星旺宮) | 財星在前方,向首有水或明亮開闊的氣口才發 |
| 該宮 = 坐宮(後方) | **不列旺財位**,標 `wealthSide:'back'` | 「財星在後方,需後方見水或動水才有財」(雙星會坐、上山下水的向星旺宮) |
| 其他宮 | 次財位(近旺、遠旺) | 二黑遠旺須小心病符 |

**輸出欄位改名**: 舊 `wealth9` 表的 `xiang9`「旺財」欄對雙星會坐盤會誤導,fixtures 與程式一律改名 `xiang9_at`(向星 9 所在),`shan9_at`(山星 9 所在,雙星會坐時為旺丁位)。財位模組計分時,`wealthSide='back'` 的宮玄空分量乘 0.5(設計值,可調;信心: 低)並帶標籤。

丁位: 山星旺的宮;床位、書桌、神位看山盤;門窗、氣口、客廳動線、梯看向盤(SOHU-912417602,信心: 中)。飛星只在氣口(門、窗、冷氣機)被催旺時才應驗,大門最重要(YXS-4379)。向星宜動(水、窗口、乾淨動水),山星宜靜、宜有靠。

#### 2.4.11 形巒條件矩陣(選填輸入,信心: 高)

| 格局 | 理想 | 偏一邊 |
|---|---|---|
| 旺山旺向 | 坐實朝空: 後有山、前有水或空曠 | 反過來(坐水朝山)損丁破財 |
| 上山下水 | 坐空朝滿: 後有水或空、前有山 | 反過來損丁破財 |
| 雙星會向 | 向首有水,水外有山: 丁財兩旺 | 有水無山旺財不旺丁;有山無水旺丁不旺財 |
| 雙星會坐 | 坐後有水環抱,水外有山: 丁財兩旺;坐後不宜見大水 | 有水無山、有山無水兩派說法程度不同(SOHU-912417602 較嚴厲,CAF-series/36FS zs31 溫和),**預設顯示溫和版並附註另一派** |

室內轉譯(推論,信心: 低): 山=實牆、高櫃、靠背、後方高樓;水=窗外開闊明堂、道路、水景、魚缸、風水輪(乾淨動水)。

#### 2.4.12 房間用途規則(D37,全部 tag=推論,單一作者為主)

- 臥室: 山星旺/生、山向皆吉的宮;避山星或向星為 5、2 的宮、15 組合、三五、三七。
- 客廳/門/窗(氣口): 向星旺/生的宮並開門窗納氣;66 組合不宜開門、26 組合不宜有門路;煞氣宮不開門窗。
- 廚房: 避開五九宮(火生五黃,zs40 支持)與二五宮(**無來源,推論**)。
- 衛生間/儲藏: 丁財皆死煞、五黃、二五交加的宮(CAF-series「只宜衛生間或雜物房」);不放旺星宮(**無直接來源,推論**)。
- 書房/學生房: 一四、三九(見 2.4.9);避三七、六七。
- 辦公桌: 山星吉的宮;要催財再選向星旺的宮(推論)。

UI 對這些條目一律加「推論」徽章。

#### 2.4.13 輸出彙總 `analyzeXuankong`

`{ meta, locate(bearing analysis), chart, pattern, wholePlate, specials:{heshi,parent3,qixing,lianshu,localYin,chengmen}, qi:{byPalace}, pairTags:{byPalace}, positions:{wealth:[...], ding:[...]}, findings:[...] }`。結果頁 Finding 產生規則: 格局模板 4 則(xuankong_patterns.md 1.9 A 表)、九星落宮模板(1.9 B 表,九運)、房間用途(標推論)。

#### 2.4.14 邊界情況

- 運盤 5 入中: 五運時山向星不會是 5。
- 同性相兼(`needsTiGua=false`)超過限度: 只警示,盤仍為下卦。
- 替卦盤與下卦盤相同者 56 盤(chart_ti 期望值本來就等於下卦盤,不是錯)。
- 坐山在 24 山任何一山都有盤(9 運 x 24 山 = 216 下卦 + 216 替卦)。
- 輸入 `chartYun` 不在 1-9: 錯誤。
- 「入運」與「今日」分離時(老宅): 見 2.4.4 提示。

---

### 2.5 annual(流年、流月、太歲三煞)

依據: **annual.json `meta`**(無報告檔,見 0.2)。來源(annual.json meta.sources,皆為該研究實際使用): 香港天文台 24SolarTerms XML(hko.gov.hk/tc/gts/astronomy/data/files/24SolarTerms_{YYYY}.xml)、交通部中央氣象署日曆資料表(cwa.gov.tw/Data/astronomy/{YYYY}cal.pdf)、紫金山天文台 2025 日曆(PMO)、USNO seasons API、JPL Horizons DE441、玄空館 陳癸龍 2019-2028 神煞位置表、《欽定協紀辨方書》卷三(zh.wikisource)、新浪年月日時紫白飛星法(blog.sina.com.cn/s/blog_af85ff5f0102yhtk.html)、cnddy.com/811.html、闻道国学(sohu.com/a/353011080_120078295)。fixtures: annual.json(191 案,參考實作已重算 191/191)。複查總評 needs-fixes,數值錯誤 0。

#### 2.5.1 輸入與輸出

輸入 `instant`(ms UTC)或 `fengshuiYear`。輸出範例(2026-09-29 12:00 CST,已用參考實作重算):

```json
{ "meta": { "schema": "fengshui.annual/1" },
  "year": { "fengshuiYear": 2026, "ganzhi": "丙午", "lichun": "2026-02-04 04:02",
            "yun": 9, "yunYear": 3, "era": "下元" },
  "annual": { "center": 1,
              "chart": { "中宮":1, "西北":2, "西":3, "東北":4, "南":5, "北":6, "西南":7, "東":8, "東南":9 },
              "wuhuang": "南", "erhei": "西北" },
  "month": { "jie": "白露", "ganzhi": "丁酉", "order": 7, "start": "2026-09-07 22:41", "end": "2026-10-08 14:30",
             "center": 1 },
  "taisui": { "branch": "午", "bearing": 180, "suipo": "子", "suipoBearing": 0 },
  "sansha": { "dir": "北", "mountains": "亥子丑", "jieSha": "亥", "zaiSha": "子", "suiSha": "丑",
              "arcs": { "core3": [[322.5,337.5],[352.5,7.5],[22.5,37.5]],
                        "withJiaSha": [322.5, 37.5], "branch12": [315, 45] },
              "jiaSha": ["壬","癸"] },
  "findings": [] }
```

輸出中宮位鍵沿用 annual.json 慣例的方位名;內部對應卦名見 1.3。

#### 2.5.2 規則與演算法

1. **流年中宮星**: `center = wrap9(1 - (fy - 1864))`(1864 上元甲子=1,每年 -1)。三個獨立公式(三元甲子 1/4/7 逐年走、尾數和 `wrap9(11 - digitRoot)`、新浪數位法)對 1864-2100 逐年一致(annual.json 驗證)。例: 2026→1、2025→2、2024→3、2019→8。
2. **飛布**: `fly(center)[宮序 k] = wrap9(center + k)`,宮序 中宮、西北、西、東北、南、北、西南、東、東南(洛書順序)。2026 年中宮 1,東 8、東南 9、北 6、東北 4、南 5、西南 7、西 3、西北 2(與 DesignHouse、Cosmart 網頁來源吻合,信心: 高)。
3. **五黃與二黑方位** = `palaceOfStar(center, 5|2)`。2026 五黃在南、二黑在西北。
4. **月**: 以「節」為界,`order` 0=寅月(立春)...11=丑月(次年小寒);月中宮 `wrap9([8,5,2][yearBranch%3] - order)`,即子午卯酉年寅月起 8、辰戌丑未年起 5、寅申巳亥年起 2,之後每月 -1;月干用五虎遁(calendar 2.2.3 第 2 點)。
5. **太歲與歲破**: 太歲 = 年支,方位角 `30*branch`(24 山地支山中心);歲破 = 對沖支(`+6`)。太歲位「動土」等民俗說法不進規格。
6. **三煞**: 年支分四組(申子辰、亥卯未、寅午戌、巳酉丑),三煞在對沖那一方的「劫煞、災煞、歲煞」三支:

```json
{ "申子辰": {"dir":"南","jie":"巳","zai":"午","sui":"未","jia":["丙","丁"]},
  "亥卯未": {"dir":"西","jie":"申","zai":"酉","sui":"戌","jia":["庚","辛"]},
  "寅午戌": {"dir":"北","jie":"亥","zai":"子","sui":"丑","jia":["壬","癸"]},
  "巳酉丑": {"dir":"東","jie":"寅","zai":"卯","sui":"辰","jia":["甲","乙"]} }
```

   已用參考實作 `sansha()` 重算,2019-2028 與玄空館表一致(2026 丙午 = 寅午戌 = 北三煞,professionalwindow.com.hk 亦為太歲南/三煞北)。

7. **[已更正] 三煞弧分兩層(複查 refuted)**: 舊寫法把 `災煞支中心 ± 37.5°` 共 75° 當預設弧,並描述為「1 整宮 + 兩側各半宮」,這個描述是錯的,且 75° 把「夾煞」(兩個天干山)算進去,與「夾煞預設關(D40)」矛盾,又只有玄空館一個來源支持 75°。改為並列三層,由 UI 選:

| 層 | 定義 | 南方(申子辰年)例 | 預設 |
|---|---|---|---|
| `core3` | 三個地支山各 15°,共 45° | 142.5-157.5(巳)、172.5-187.5(午)、202.5-217.5(未) | **預設** |
| `withJiaSha` | 含夾煞兩個天干山,連續 75° | 142.5-217.5 | 開 `extraShensha` 時 |
| `branch12` | 十二地支三支 30° 共 90° | 135-225 | 選項 `sanshaArc='branch12'` |

   UI 文字改為「**三煞弧 = 主宮整宮 + 兩側鄰宮各 1/3(各一個山)**」(指 `withJiaSha` 的 75°: 離宮丙午丁 45° 加巳與未各 15°)。**不要預設就畫 75°**。四組弧(已重算): 南 core3 142.5/172.5/202.5 起各 15°、withJia 142.5-217.5、branch12 135-225;西 core3 232.5/262.5/292.5、withJia 232.5-307.5、branch12 225-315;北 core3 322.5/352.5/22.5、withJia 322.5-37.5、branch12 315-45;東 core3 52.5/82.5/112.5、withJia 52.5-127.5、branch12 45-135(全部半開區間,跨 0° 用 mod)。

8. **[已更正] 神煞分類(D40、D42)**: 太歲、歲破、三煞、五黃、二黑為主流,固定顯示;夾煞、力士、月煞為少數單一來源,預設關(`extraShensha=false`)。**力士、月煞的算法本次沒有整理進 fixtures,不實作**([未解決] U-02)。三煞「宜向不宜坐」為單一來源(闻道國學)的提示語,標少數/低信心。
9. 九運: 用 calendar `nineYun`。

#### 2.5.3 邊界情況

- 立春換年是**瞬間**判斷,不是日期: 2021 立春 02-03 22:59、2025 立春 02-03 22:10、2026 立春 02-04 04:02;立春前一分鐘仍屬上一年(fixtures `lichun_boundary_*`)。
- 1 月出生: 丑月屬上一風水年,月中宮以上一年年支組算(附錄 B 的 2025-01-20 屬甲辰年丑月丁丑、月中宮 3)。
- 2023 立春 10:40/10:46 邊界: 依 HKO 與 CWA 2023 版期望 10:43;CWA 2022 版與真值(10:42:23,四捨五入 10:42)皆為 10:42,容差 2 分足以吸收,此格官方表有 1 分歧義,fixtures 要註記。
- 2050-2100 立春誤差可達 2.96 分(ΔT 外推),不影響日期,分鐘級臨界要標示。
- 舊引擎 `get_yun(2044)`、`(2045)` 仍回傳九運(實跑驗證),見第 6 節。

---

### 2.6 wealth(財位)

依據: wealth_position.md、wealth_position.verify.md。fixtures: wealth_position.json(71 案,複查 0 個期望值錯誤)。

#### 2.6.1 四層次(信心: 高)

財位沒有單一定義,至少四層,介面要分開標示時間性:

| 層 | 決定於 | 有效期 | 預設 |
|---|---|---|---|
| 明財位 | 空間幾何(進門對角) | 房屋使用年限 | 顯示(台灣大眾最通行) |
| 暗財位(八宅) | 大門朝向定宅後的生氣位 | 固定 | 顯示,生氣為主、延年次之、天醫再次 |
| 暗財位(玄空) | 建成運與坐向的向盤 | 一個運(九運到 2044 立春) | 顯示 |
| 流年財位 | 立春換年 | 一年 | 顯示(今年加分) |
| 本命財位 | 住戶命卦生氣位 | 終身 | 有住戶資料才顯示 |

專業玄空派(吳尚易 hhh.com.tw/columns/detail/7793、7913)明說「財位絕對不是進門斜對角」,通俗派與之對立;兩者都算,預設 `wealthProfile='mingcai'`,`'xuankong'` 為進階檔(D45)。

#### 2.6.2 平面圖座標約定

x 向右、y 向上;矩形房間 `[0,w]x[0,d]`;牆 `bottom(y=0) top(y=d) left(x=0) right(x=w)`;角 `BL BR TL TR`;門位置 `pos` 為沿牆座標(bottom/top 用 x,left/right 用 y)。平面圖「上」的羅盤方位角 `planUpBearing`;平面向量 (dx,dy) 的羅盤方位 = `planUpBearing + atan2(dx,dy)`。與 plan 模組共用(2.7)。

#### 2.6.3 明財位(幾何,信心: 高)

輸入空間多邊形(逆時針頂點)、進入該空間的開口 `door`、`centerBand`(預設 0.10)。

1. 候選 = 內角恰為 90 度的頂點,排除門所在邊的兩端點(矩形即遠牆兩角)。
2. 距離 = 室內步行最短距離(矩形時等於歐氏距離);取最遠者為 primary。
3. 矩形且門在牆中央帶(`|pos - L/2| <= centerBand*L`)→ 兩角並列,遠者 primary;多邊形時第二遠者距離 ≥ 0.94 倍最遠者也並列(6% 為設計值)。
4. 等價說法: 進門者視角下,門在牆左半 → 財位在遠端右角;門在右半 → 遠端左角。已用兩種獨立實作對 10 萬到 20 萬組隨機房間與門位置 0 筆不一致,fixtures 14 個矩形手推核對。
5. **龍邊定義(必須寫進註解)**: 龍邊 = 從室內向大門外望時的左手邊 = 進門者的右手邊。`preferDragonSide`(D44)對門居中只取龍邊(MyGoNews 2010 少數說法),避免使用者把「左」當成進門視角。
6. 45 度射線命中點只作可選顯示(`showRay45`);寬扁房間會落在遠牆中段而非牆角(信心: 低)。

特殊格局: 房間用該房間的門為基準;客廳的「真正的門」= 進入客廳的那個開口(大門開在陽台、須開落地窗才入客廳時,落地窗才是門;雙出入口以大門為主);玄關為封閉獨立空間時以玄關通往客廳的開口為門,半遮擋時用大門(兩派折衷,設計,信心: 低);開放式客餐廳整體以大門為基準,`virtualPartition` 可選虛擬分區(D51);L 型或不規則取「內角恰 90 度頂點中步行距離最遠者」(來源說「拆兩個矩形取較有利者」,兩個演算法不同,信心: 低,提供手動指定,D50;手推例 (0,0),(5,0),(5,3),(2,3),(2,6),(0,6)、門在下牆 x=4.2 → (0,6) 7.33、(2,6) 6.72、(5,3) 3.10)。複式、透天每層分開判斷。

角落範圍檢核(角區 `zone=1.0` 公尺、開口重疊超過 5 公分才算,設計值):

| 狀態 | 條件 | 明財位派 | 玄空派 |
|---|---|---|---|
| `ok` | 兩面實牆、角區無開口 | 成立 | 成立 |
| `void_window` / `void_floor_window` | 角區有窗/落地窗(財位見空) | 扣分並給補救 | 視為納氣不扣 |
| `blocked_opening` | 角區有門或通道 | 不成立,改走暗財位 | 不成立 |
| `blocked_walkway` | 動線穿過角區 | 不成立 | 不成立 |

`qiIntake`(D46)切換 `penalty`(預設,x0.5)與 `reward`(玄空派,x1.05)。Mobile01 一則「落地窗不構成財位見空」為未查證單一少數說法,未採用。

#### 2.6.4 暗財位

- **八宅**(B1): 大門朝向(`facing.bazhai`)定坐與宅卦,查 8x8 表取 生氣 > 延年 > 天醫 > 伏位。例: 大門朝南 = 坎宅,生氣在東南。
- **玄空**(B2): 只吃 xuankong 模組輸出(向盤/山盤各宮星數,以及 `wealthSide`);規則見 2.4.10。已核對樣本九運丑山未向: 向宮(坤,西南)山向皆 9,東方(震)山1向8運7,北方(坎)山8向1運5;與 cafengshuinet 描述、獨立實作逐項吻合(複查建議該 fixture 信心由 medium 升 high,限「不含替卦與兼向」)。
- **流年**(B3): 用 annual 流年盤。財星價值 八白 1.0、九紫 0.8、一白與六白 0.6、四綠 0.2(設計值,見 2.6.7)。
- **本命**(B4): 命卦生氣位為主,延年、天醫次之。多位住戶預設取平均(`multiOccupantPolicy='mean'`),可選「主要收入者加倍」。
- **不採用**(D52): 坐向雙位表(觀仁自在、中文百科、MyGoNews、風水工作室、LIVING FORM 各版互相矛盾,且與八宅凶位重合,如坎宅西南為絕命)、紫白坐山入中表(住展 2016,等價關係已驗但每宅只取三碧六白八白其中一顆的原則不明)。兩者預設關閉。

#### 2.6.5 禁忌檢核

三級(排除級乘 0,強烈建議級扣分並要求補救,軟建議只是佈置檢核):

| 級 | 條件 | 處理 | 來源數 |
|---|---|---|---|
| 排除 | 走道或開門(含門扇掃過範圍) | x0 | 5 |
| 排除 | 廁所、爐灶/廚房 | x0 | 3 / 2 |
| 排除 | 樓梯(財來財去) | x0(邏輯上動線不可能安定) | 1(低) |
| 強烈建議 | 背後無兩面實牆、玻璃隔間 | x0.7 | 7 |
| 強烈建議 | 角區有窗或落地窗(財位見空) | x0.5(玄空派 x1.05) | 5 |
| 強烈建議 | 橫樑、大櫃壓頂 | x0.9 | 7 |
| 強烈建議 | 昏暗(可加燈) | x0.95 | 5 |
| 強烈建議 | 尖角沖射 | x0.95 | 6 |
| 強烈建議 | 與廁所共牆或正對廁所門 | x0.8 | 3 |
| 強烈建議 | 正對爐火 | x0.9 | 2 |

乘數大小全是設計值(來源沒有數字),下限 0.4。軟建議(整潔、不放垃圾桶/鏡子/3C/假花枯木、財神背靠實牆等)不進位置分數,屬民俗性質,文案標「傳統說法」。「直見爐火財露白」單一來源(低,未再驗證)。

**[已更正] 門沖(D49)**: 兩個相對牆上的開口沿牆座標重疊長度 ≥ 較窄者寬度 **80%** 且兩門之間無遮擋物(玄關、牆、櫃)→ 「門沖」;**50%-80% → 「輕微偏移」**(不判沖)。舊 50% 門檻比來源的「大門、走道、房門幾乎完全成一直線」寬鬆太多。fixture `door_chong_aligned`(重疊比 0.81)在 80% 門檻下仍為 true,維持。「漏財」是象徵性說法,沒有科學證據,文案不得寫成因果。

#### 2.6.6 店面與辦公室

| 項目 | 規則 | 信心 |
|---|---|---|
| 明財位 | 入口往內看最遠對角;開放式辦公室先進個人工作區再看進門斜對角 | 中 |
| 內財位/外財位 | 內財位(老闆室)優先;無合適明財位時用暗財位補 | 中(單一但邏輯明確) |
| 收銀台 | 靠實牆;面向入口;不正對大門;不被樑壓;不要透明或旁邊玻璃門窗;宜在龍邊(**店內面向店門時的左手邊**) | 中 |
| 龍邊高於虎邊 | **只有潮紫微有此說**([已更正] 518 article/1525 沒有,刪除該引用) | 低 |
| **[已更正] 櫃檯左側靠牆** | 潮紫微「原則上以左邊要靠牆為佳」: 櫃檯**自己的左側**宜貼牆,`seatCheck` 新增軟建議欄位 `leftSideAgainstWall` | 中(單一) |
| 收銀台高度 | 過高擋財、過低洩財 | 低(民俗) |
| 老闆座位 | 背靠實牆、正前方不被高櫃壓迫、不背門也不正沖門、左青龍略高右白虎略低 | 中 |
| 位於空間後半 | `inRearHalf` 為設計推論,兩個來源沒有明說「後半」,標低 | 低 |
| 辦公桌 | 不正對大門、廁所門、走道盡頭、鏡子;背後不可是樓梯、電梯、走道、大門;桌前明堂開闊 | 中 |
| 座位面向命卦吉方 | 八宅法(僅見搜尋摘要) | 低 |

`seatCheck(room, door, seat, facing, backWall, width)` 回傳 `{backSolidWall, facesOrSeesDoor, alignedWithDoor, inRearHalf, leftSideAgainstWall}`;`dragonSide = dot(seatPos - roomCenter, leftOf(facingOutward)) > 0`。

#### 2.6.7 候選排序啟發式(設計,tag=設計,信心: 低)

```
score(L) = 100 * clamp(0,1, wG*G + wXK*XK + wH*H + wP*P + wY*Y) * env(L)
```

```json
{ "PROFILES": {
    "mingcai":  { "G": 0.30, "XK": 0.25, "H": 0.15, "P": 0.15, "Y": 0.15, "xkShan": 0.25, "opening": "penalty" },
    "xuankong": { "G": 0.10, "XK": 0.40, "H": 0.10, "P": 0.15, "Y": 0.15, "xkShan": 0.25, "opening": "reward"  } },
  "BAZ_VAL":  { "生氣": 1.0, "延年": 0.75, "天醫": 0.55, "伏位": 0.25, "禍害": -0.3, "六煞": -0.3, "五鬼": -0.5, "絕命": -0.6 },
  "XK9_VAL":  { "9": 1.0, "1": 0.8, "8": 0.7, "6": 0.3, "4": 0, "7": -0.2, "3": -0.3, "2": -0.2, "5": -0.7 },
  "YEAR_VAL": { "8": 1.0, "9": 0.8, "1": 0.6, "6": 0.6, "4": 0.2, "7": -0.4, "3": -0.4, "2": -0.7, "5": -1.0 },
  "G": { "mingPrimary": 1.0, "mingSecondCenter": 0.9, "twoSolidWalls": 0.5, "oneSolidWall": 0.2, "other": 0 } }
```

- 元件: `XK = (1-xkShan)*XK9_VAL[向盤[S]] + xkShan*XK9_VAL[山盤[S]]`(S = 候選所在宮);`H = BAZ_VAL[宅卦視角下 S 的星]`;`P = mean(BAZ_VAL[各住戶命卦視角下 S 的星])`;`Y = YEAR_VAL[當年流年星[S]]`。
- 候選 = 各主空間明財位角落(含狀態)加上各宮位中「有兩面實牆的角落」。角落所在宮由「太極點到角落」的方位決定(plan 模組)。排序同分依 G、再 P、再 XK。輸出**永遠顯示明財位**(標籤「明財位」),不論排名,並列出每項貢獻與扣分理由。
- **`XK9_VAL` 的適用條件 [已更正並補註]**: 表以「目前為九運」(`currentYun=9`,2024-02-04 至 2044-02-04)為前提,鍵是星數,對任何 `chartYun` 的盤皆可用(旺衰看今日的運,見 2.4.4);`currentYun≠9` 時改用 `qiScore(default)/3` 對應並在 meta 標 `xkValFallback`。`wealthSide='back'` 的宮 `XK` 分量乘 0.5(2.4.10)。
- 星值只有**順序**有來源: 九運 9>1>8>6(108s、cafengshuinet、36fengshui)、流年 8 > 9/1/6(Cosmart、DesignHouse)、生氣>延年>天醫>伏位。**九紫 0.8 高於一白與六白 0.6 缺乏來源**(九紫加分只能用「九運當旺」推論,非傳統財星;108s 稱九紫主喜慶桃花,36FS 三大財星為八白、一白、六白)[已更正]: 文件標「九紫=當運旺星加分,非傳統財星」,`YEAR_VAL` 可調。四綠 0.2 只有 DesignHouse 列為財星(單一來源,設計值)。`XK9_VAL[2]=-0.2` 與 108s 稱九運二黑為「遠生氣」衝突(運序屬生氣、星性為病符),兩種屬性混用,程式註記。
- 無住戶資料時 `P` 歸 0 且權重不重分配,分數上限降為 0.85: UI 說明「分數不可跨設定比較」。
- 已驗證算術例(九運丑山未向、2026 流年、坎命,平面圖上方 30 度、房屋中心 (5,4)、客廳 6x5 門在下牆 x=1.0): 明財位 TR=(6,5) 方位 75 度落震宮(東),`mingcai` 檔 66.88 分,`xuankong` 檔 59.25;有窗版 33.44 與 62.21;鄰廁所 53.50;坤宮(西南)雖有玄空雙 9 與宅卦生氣,但坎命為絕命位、流年七赤,有兩面實牆的西南角只有 40.00 分。命卦與流年的凶星會大幅壓低結構性看好的位置(預期行為),多人命卦衝突時要有平均或分別顯示。

#### 2.6.8 九運水火與放水(D47、D48)

- 九運北方(坎)為零神,宜見水;李居明(stheadline)與富衛 FWD(引七師傅、雲文子)均稱「南方有山,北方有水」(信心: 中)。
- **[已更正]** 「南方(離)正神忌動水」**是推論**: 李居明與 FWD 頁面都沒有「忌水」字樣,FWD 頁面也沒有「正神、零神」用語。文案只能寫「來源只說南方宜見山」,魚缸避南方(NOWnews)只見搜尋摘要,未查證。
- 個案以向盤為準: 例如九運丑山未向北方坎宮向星一白,宜小水;與「南忌水」通則並存時,顯示為「通則提示 + 以向盤為準的個案提示」兩層並標層級。
- 財位放水/魚缸是流派分歧(忌水: 中文百科、潮紫微、英文站;催財用水: 蘇民峰「水為財」、魚缸文章)。預設**不主動建議放水**;北方零神位可選提示(`allowWaterHint=false`)。財位放重物: 頭頂不壓,地面可放矮櫃或沙發靠背。
- 星的五行催旺(生旺法): 只有八白(土,火/土物件)有直接來源(36FS zs9、DesignHouse);其餘星為五行外推,無獨立來源,tag=推論、信心低。所有擺設是民俗或象徵性質,不宣稱科學效果。

#### 2.6.9 流年財位

立春換年(不是元旦,信心: 高)。2026: 八白在東、九紫在東南、六白在北、四綠在東北、五黃在南、二黑在西北。**[已更正]** fixture `liunian_lichun_boundary_minute_level` 備註「立春前 51 秒」改為「立春前約 1 分鐘」(依曆法庫 04:02:08 為 68 秒前),**不要新增 04:01:30-04:02:30 之間的測資,交節時刻一律交給 calendar**。職業別流年財位(謝沅瑾: 2024 文職東、外勤東北、經商北)單一來源,只驗證了與 2024 飛星一致,預設不採用(低)。

#### 2.6.10 邊界情況

- 無門資料: 只能給暗財位,不給明財位。
- 太極點落在邊界: 由 plan 標 `borderline`。
- 財位落在廁所、樓梯: 排除並提示改看次選。
- 流年凶星壓在明財位(例 2026 五黃在南): 來源只有一般說法,目前只做扣分與警語(U-08)。
- 英文與西式(BTB)財位(遠端左角、東南方)與本規格流派不同,未整合。

---

### 2.7 plan(平面圖、太極點、扇區佔比)

**本模組沒有研究報告與複查**。wealth_position.md 第 7 節第 5 點明列「太極點(房屋中心)定義: 外框中心與面積重心會讓角落落入不同宮」為未解決;本次整合時嘗試補搜尋失敗(WebSearch 額度用完,用 WebFetch 讀 108s.tw/article/info/287 確認該頁未談太極點)。因此本節全部標 tag=設計,信心: 低,需風水老師審稿(U-07)。

#### 2.7.1 資料結構

```json
{ "version": 1, "unit": "m",
  "planUpBearing": 30,
  "outline": [[0,0],[6,0],[6,5],[0,5]],
  "rooms": [ { "id": "living", "type": "living", "polygon": [[0,0],[6,0],[6,5],[0,5]] } ],
  "openings": [ { "id": "d1", "kind": "entrance", "roomId": "living", "wall": "bottom", "pos": 1.0, "width": 0.9 },
                { "id": "w1", "kind": "window", "roomId": "living", "wall": "right", "pos": 2.5, "width": 1.8 } ],
  "walls": [ { "segment": [[0,5],[6,5]], "kind": "solid" } ],
  "mainDoor": "d1",
  "taiji": { "mode": "centroid", "manual": null } }
```

`kind`: `entrance`(大門)、`door`(室內門)、`window`、`floorWindow`(落地窗)、`balconyDoor`;`room.type`: living、bedroom、kitchen、toilet、study、entry、balcony、stair、other;`wall.kind`: solid、glass、partial(未頂天櫃體)。`planUpBearing` 用當下 `northMode` 的基準。

#### 2.7.2 太極點(D55)

- 預設 `centroid`: `outline` 多邊形的面積重心(矩形與外框中心重合)。選項 `bbox`(最小外接矩形中心)、`manual`(使用者在圖上點選)。
- 排除項: 預設 `outline` 為主屋(陽台不計,`type='balcony'` 的房間不併入 outline),使用者可勾選納入。
- 理由: L 型與凸字型平面下,外框中心可能落在牆外;重心穩定且有唯一解。**這是設計決策,無來源**。例: L 型 (0,0),(6,0),(6,3),(3,3),(3,6),(0,6) 重心 (2.5,2.5),外框中心 (3,3)。
- 缺角與凸出的判定(傳統上有「缺角、凸出佔邊長多少算缺」的說法)**本次沒有研究來源,不實作**,列 U-07。

#### 2.7.3 扇區歸屬與面積佔比

1. `sectorOfPoint(p)`: `v = p - taiji`;`|v|<1e-9` 回 `null`;`bearing = planUpBearing + atan2(vx, vy)`(度,正規化);宮 = `GUA[floor(((bearing+22.5)%360)/45)]`,半開區間,邊界歸順時針下一宮。`borderline = min(到最近扇區線的角度) < measureUncertainty`。
2. `sectorShares(plan)`: 對每個房間多邊形與 8 個楔形(以太極點為頂點、45 度張角,可用 Sutherland-Hodgman 對兩條半平面依序裁切,楔形為凸)求交,得 `shares[roomId][gua] = 面積`,`palaces[gua] = [{roomId, area, pct}]`(pct = 佔該宮總面積)。`mainUse[gua]` = 佔比最大的房間。
3. 角落與門窗的宮 = `sectorOfPoint(該點)`。門中心距扇區線 < `measureUncertainty` 時 `borderline=true` 並在文案提示「位置接近兩個方位的交界」。
4. 面積計算範例(已用程式重算,`planUpBearing=0`,太極點取重心): 10x8 矩形 → 坎 6.627417、艮 11.508622、震 10.355339、巽 11.508622、離 6.627417、坤 11.508622、兌 10.355339、乾 11.508622,總和 80.0。同矩形 `planUpBearing=30` → 坎 9.355193、艮 7.191836、震 12.215728、巽 11.237244、離 9.355193、坤 7.191836、兌 12.215728、乾 11.237244,總和 80.0。8x8 正方形 → 四正宮 6.627417、四隅宮 9.372583。L 型(重心 (2.5,2.5),`planUpBearing=0`)→ 坎 3.985281、艮 0.353553、震 3.985281、巽 4.918525、離 2.588835、坤 3.661165、兌 2.588835、乾 4.918525,總和 27.0。

輸出範例(`sectorShares`,10x8 單一房間 `living`,`planUpBearing=0`,太極點 (5,4);面積為 m2):

```json
{ "taiji": [5, 4], "planUpBearing": 0, "totalArea": 80,
  "palaces": {
    "坎": [ { "roomId": "living", "area": 6.627417, "pct": 1.0 } ],
    "艮": [ { "roomId": "living", "area": 11.508622, "pct": 1.0 } ],
    "震": [ { "roomId": "living", "area": 10.355339, "pct": 1.0 } ],
    "巽": [ { "roomId": "living", "area": 11.508622, "pct": 1.0 } ],
    "離": [ { "roomId": "living", "area": 6.627417, "pct": 1.0 } ],
    "坤": [ { "roomId": "living", "area": 11.508622, "pct": 1.0 } ],
    "兌": [ { "roomId": "living", "area": 10.355339, "pct": 1.0 } ],
    "乾": [ { "roomId": "living", "area": 11.508622, "pct": 1.0 } ] },
  "mainUse": { "坎": "living", "艮": "living", "震": "living", "巽": "living", "離": "living", "坤": "living", "兌": "living", "乾": "living" } }
```

#### 2.7.5 邊界情況

- 非凸多邊形(L 型、凸字型)的面積重心可能落在牆外: 此時仍照常計算,但回傳 `warnings:['taijiOutsideOutline']` 並提示使用者改選 `bbox` 或手動點選。
- 一個房間跨多個宮: 正常,以面積佔比表示,不強迫歸單一宮;`mainUse` 取佔比最大者。
- 門、角落或窗中心距扇區線 < `measureUncertainty`: `borderline=true`。
- `planUpBearing` 未知: 不輸出宮位,只輸出形狀分析(明財位幾何仍可算)。
- 多邊形自交、頂點少於 3、面積為 0: 回錯誤 `INVALID_PLAN`。
- 平面圖的北基準必須與 `northMode` 一致;切換基準時 `planUpBearing` 要跟著換算(`toTrue`/`toMagnetic`)。

#### 2.7.6 屬性測試(本模組沒有 fixtures,以屬性與上列數值為準)

- 面積守恆: 各宮面積和 = 多邊形面積(相對誤差 1e-9)。
- 旋轉等變: `planUpBearing` 加 45 度,各宮面積循環位移一格。
- 正方形四正宮相等、四隅宮相等。
- 矩形的重心 = 外框中心。

#### 2.7.7 與 wealth 的介面

`wealth` 只呼叫 `sectorOfPoint(角落)` 與 `taiji`;房間內的角落 → 宮位 → 查八宅/玄空/流年/命卦的星值。

---

### 2.8 luopan(盤面資料、版面、配色、字型、手勢)

依據: luopan_rings.md、luopan_rings.verify.md。fixtures: luopan_rings.json(72 案,複查 0 個數值錯誤,但有 8 項 fixtures 問題,見附錄 A)。傳統羅盤沒有唯一標準盤(三合、三元、綜合的環序、陰陽分法、宿度都不同),本規格把可算的寫成演算法,不可判定的並列並給預設。

#### 2.8.1 座標與共通規律

| 項目 | 約定 |
|---|---|
| 方位角 | 自北順時針,子山中心 = 0°;半開區間 `[起,迄)`,跨 0° 的山(子: 352.5→7.5)用 `(b-起) mod 360` 判斷 |
| Canvas 角度 | `rad = (b-90)*π/180`(Canvas 0 = +x 向東) |
| 字元位置 | 環半徑 r、方位角 b: `x = cx + r*sin(b)`、`y = cy - r*cos(b)`;字頭朝外時 `ctx.rotate(b)` |
| 上方向 | 預設北在上(與手機指北一致);`southUp` = 整盤 +180°(旋轉,不是鏡像;傳統「前南後北」圖是南上,D60) |
| 環序共通規律(4 份資料交叉,信心: 中高) | 天池永遠最內;28 宿與 360 度刻度最外;八卦環在 24 山內側;**節氣環緊貼地盤 24 山外側**;人盤/天盤是「整圈轉半格的 24 山複製環」各帶一圈 120 分金 |

盤面資料的**幾何真源是 geo 模組**;luopan 只做「資料 + 版面 + 繪製參數」,不重複實作 24 山計算。三針偏移見 geo 2.1.4。

#### 2.8.2 環資料(各表完整內容見 luopan_rings.md 第 3 節與 luopan_rings.json)

| 環 | 資料來源 | 要點 |
|---|---|---|
| 24 山 | geo 2.1.1 | 三元龍陰陽(D56 預設)與三合紅黑字兩套並存(`yinyangScheme`);三合紅(陽)=子癸申辰午壬寅戌乾甲坤乙,已由納甲重推並與多來源一致;兩套是不同分法,圖例要分開說明 |
| 八卦、洛書 | luopan_rings.md 3.2 | 後天方位 坎0 艮45 震90 巽135 離180 坤225 兌270 乾315;洛書南上格 `4 9 2 / 3 5 7 / 8 1 6`(各線和 15);卦爻 乾111 兌110 離101 震100 巽011 坎010 艮001 坤000;卦象**用 Canvas 三條線畫**,不依賴 ☰ 字元(舊 Android 字型缺字);預設「後天卦爻+後天卦名」(初學者不會被先天爻誤導),傳統盤式(先天爻畫在後天卦名位置)為選項 |
| 24 節氣(太陽到山) | 冬至=子、小寒=癸、大寒=丑、立春=艮(立春始艮、大寒終丑)、雨水=寅、驚蟄=甲、春分=卯、清明=乙、穀雨=辰、立夏=巽、小滿=巳、芒種=丙、夏至=午、小暑=丁、大暑=未、立秋=坤、處暑=申、白露=庚、秋分=酉、寒露=辛、霜降=戌、立冬=乾、小雪=亥、大雪=壬 | 二分二至落在子午卯酉,合天文;逐項對位只有一個明列來源,信心: 中 |
| 28 宿 | 開禧宿度(D57) | 見 2.8.3 |
| 120 分金 | 只做**即時讀數**(D58) | 見 2.8.4 |
| 64 卦 | **預設不放**(D59) | 見 2.8.5 |
| 九星色 | 一白二黑三碧四綠五黃六白七赤八白九紫 | 只有 wawlhld 220 一處直接來源,信心: 中,洛書環選用 |

#### 2.8.3 二十八宿(開禧宿度,信心: 中)

古度寬(角亢氐房心尾箕 斗牛女虛危室壁 奎婁胃昴畢觜參 井鬼柳星張翼軫)共 365.25,乘 `360/365.25` 縮進 360°。**子山中心 0° = 虛、危之間;虛起於 0° 向順時針;方位角增加的方向,宿序是反著走的(虛→女→牛→斗→箕→尾...→壁→室→危)**,這是最容易畫反的地方。

```json
{ "names": "角亢氐房心尾箕斗牛女虛危室壁奎婁胃昴畢觜參井鬼柳星張翼軫",
  "widthsGu": [12.75,9.75,16.25,5.75,6,18,9.5, 22.75,7,11,9.25,16,18.25,9.75,
               18,12.75,15.25,11,16.5,0.5,9.5, 30.25,2.5,13.5,6.75,17.75,20.25,18.75],
  "sumGu": 365.25, "firstAt0": "虛", "direction": "reverse-of-astronomical-order" }
```

驗證: 午中(180°)換算古度 182.625,落張宿第 3 度內(口訣「南方張度縫三乘」),`ruSu(180)` = 張 2.125 度;與獨立文章(yixiansheng 4538)圓周度最大差 0.71°(文章兩處筆誤已更正);與十二次粗表比對只有畢、柳兩宿因貼近地支界線落在鄰格。**限制**: 兩個來源是同一條羅盤口傳表的轉載,不是兩個獨立天文來源;開禧宿度與宋代實測距度不同(斗 22.75 對漢古度 26);365.25 縮進 360 是近似(縮放 0.9856,最遠端點差 5.25°)。時憲宿度、明師盤(鬼 3 度)不實作。28 宿↔24 山沒有標準對應,以計算結果為準,點宿名時同時顯示所在山。

窄宿可讀性: 13px 字最小角寬要 ≥ 5°(見 2.8.6 統一半徑後 4.93°),**觜 0.49°、鬼 2.46° 必須引線或錯位**,房 5.67°、心 5.91°、星 6.65°、牛 6.90° 偏窄(9px 字 + 錯位)。

#### 2.8.4 一百二十分金

每山 5 格 × 3°;起點在壬|子縫(352.5°);陽支(子寅辰午申戌)用 甲丙戊庚壬,陰支(丑卯巳未酉亥)用 乙丁己辛癸;60 甲子各恰出現 2 次;丙丁庚辛開頭共 48 格(旺相可用,72 不可用);午向 174° = 甲午(sohu 346292839 逐字,信心: 高)。子山 = 甲子 丙子 戊子 庚子 壬子(wawlhld 213、163.com HJT97HRR、Google Groups FengShuiPro 三處一致)。

**[未解決,已降級] 八干四維山「沿用前一位地支」的規則只有 163.com HJT97HRR 一個來源明說**(癸=子的分金、艮=丑的、甲=寅的、壬=亥的 ...);taijizhidian 215 只說「歸入同組之地支」,若照三合雙山配對(壬子、癸丑、艮寅、甲卯)可能變成「後一位」,與此規則相反。處理: (1) fixtures `fenjin120_lookup_337.5`(乙亥)、`fenjin120_lookup_7.5`(甲子)與 `fenjin120_table` 的 12 個八干四維山加 `confidence:'low'`,不當硬規範;(2) UI 只顯示**地支山**的分金,四維/八干山不顯示分金,直到找到第二個來源;(3) 手機羅盤誤差量級也不適合 3°/格的判定(見 geo 2.1.7),分金僅作「即時讀數」,不畫成環(每格約 5px)。

#### 2.8.5 六十四卦環(D59,預設關)

理由: 64 格每格 5.625°,手機上(r≈150px)弧長 14.7px 只夠單字;蔣盤、玄空大卦起點各家不同;財位用不到。若要放: 順序用先天圓圖(下卦宮序 乾兌離震巽坎艮坤 × 上卦同序,已與歌訣 64/64 一致);角度規則 `k = b<180 ? 31-floor(b/5.625) : 32+floor((b-180)/5.625)`,乾 [174.375,180)、復 [0,5.625)、姤 [180,185.625)、坤 [354.375,360)。**角度錨點(乾盡午中)只有單一來源(信心: 低)**。[已更正] fixtures `hexagram64_xiantian_circle_order`: (1) 卦名與 `unicode_by_name` 鍵統一用「**無妄**」(U+4DD8),原 `unicode_by_name` 鍵寫「无妄」,按名稱查會缺 1 筆;(2) 坤(index 63)的 `end` 應為 360.0(或註明跨 0° 用 `(b-start) mod 360` 判斷),原寫 0.0。

#### 2.8.6 手機版環配置(≤9 環,可讀性優先)[已更正 r5]

半徑為相對外半徑 R 的比例;**所有像素數字統一以 R=180(360px 盤半寬)計算**(舊文件 r6 中徑 149.4px 用 0.83×180、環寬表用 0.83×177,基準不一致),外緣保留 0.015R。

**模式 A(預設,含節氣環)**。原寫法 r5 節氣環寬 0.07R=12.4px,卻要放「每節氣 2 字徑向堆疊、10.5px 字」(按 `stack()` 字距 1.02 倍需 ≥ 21.4px),自相矛盾。更正: **r5 加寬到 0.125R,其餘環等比縮小**(另一解法: 節氣兩字改沿切線並排,15° 弧在 r=128px 處約 33px 可放兩個 10.5px 字)。已重算:

| key | 環 | r0 | r1 | 環寬 px | 中徑 px |
|---|---|---|---|---|---|
| tianchi | 天池 | 0.0000 | 0.1880 | 33.8 | 16.9 |
| r1 | 八卦(卦爻+卦名) | 0.1880 | 0.3760 | 33.8 | 50.8 |
| r2 | 洛書數+五行 | 0.3760 | 0.4511 | 13.5 | 74.4 |
| r3 | 二十四山(地盤正針) | 0.4511 | 0.6203 | 30.5 | 96.4 |
| r4 | 三元龍/陰陽帶 | 0.6203 | 0.6485 | 5.1 | 114.2 |
| r5 | 二十四節氣 | 0.6485 | 0.7735 | 22.5 | 128.0 |
| r6 | 二十八宿 | 0.7735 | 0.9051 | 23.7 | 151.1 |
| r7 | 360 度刻度 | 0.9051 | 0.9850 | 14.4 | 170.1 |

r6 中徑 151.1px 時 13px 字最小角寬 = 4.93°,「觜、鬼」不合格的結論集合不變。fixtures `layout_rings_A_solarterms` confidence 由 high 降 medium 並依本表更新;`xiu28_narrow_labels_360px` 統一基準後 `min_deg` = 4.93(R=180),集合 ["觜","鬼"] 不變。

**模式 B(三合模式,人盤+天盤取代節氣環,9 環)** 維持原配置(r5a/r5b 各約 11.6-11.8px 放單字 10px,r6、r7 無問題): 寬度比例 天池 0.1869、八卦 0.1869、洛書 0.0748、24 山 0.1682、三元帶 0.0281、r5a 0.0654、r5b 0.0654、二十八宿 0.1308、刻度 0.0795(外緣 0.986)。

字級建議(360px 盤): 卦名 15px 粗、洛書 13px 粗、二十四山 21px 粗、節氣 10.5px、人盤/天盤 10px、28 宿 14px(窄於 5° 者 9px + 錯位)、刻度 9.5px(1° 細線、5° 中線、10° 長線、每 30° 標數字)。

#### 2.8.7 配色與對比度 [已更正]

傳統: 三元盤 24 山陽=金底紅字、陰=黑底金字(taijizhidian 215);紅色只留給天心十道、海底線、指針南端;三合盤紅字為陽龍、黑字為陰龍。**「金底紅字」在 120 龍分金那頁的意思是「吉利線度(丙丁庚辛)」,含義不同**,若 24 山格與分金格都用紅字要在圖例分開說明。

色票(深色漆面): lacquer_900 `#0E0B09`、lacquer_800 `#17120E`、lacquer_700 `#221A13`、lacquer_600 `#2D231A`、gold_100 `#F6E6B4`、gold_300 `#E8CB7A`、gold_500 `#D6B25A`、gold_700 `#9A7526`、gold_900 `#5E4514`、cinnabar_500 `#D0342A`、cinnabar_300 `#F0665A`、cinnabar_800 `#7A130C`、ivory `#F3EBD8`、jade `#5FA37F`、terracotta `#C9705A`、wx_wood `#5DAA6B`、wx_earth `#D0A44A`、wx_metal `#E4E0D2`。

**五行色更正**: 原 `wx_fire #E0503D`、`wx_water #4E86C6` 在 lacquer_700/600 交錯格底上不合格(火 4.39/3.94、水 4.53/4.06;13px 粗體不算 WCAG 大字,不能放寬到 3:1)。新值(已用 WCAG 2.x 公式重算):

| token | hex | on 800 | on 700 | on 600 |
|---|---|---|---|---|
| wx_fire | `#EC6A57` | 5.99 | 5.52 | 4.95 |
| wx_water | `#6A9CDC` | 6.55 | 6.04 | 5.41 |

並改規則: 「所有字/底組合對比度 ≥ 4.5:1(最低 4.77)」只在 lacquer_800/900 底成立;使用新五行色後 800/700/600 三種底皆 ≥ 4.5。`palette_contrast` fixtures 補 lacquer_700/600 底各組合(舊色 fire 4.39/3.94、water 4.53/4.06 作為「不合格」反例)。木紋主題: 朱紅字 `#7A130C` 只能放淺木色 `#D9A863`(5.05),放 `#B98548` 只有 3.38 不合格。24 山格規則: 陽=金底(gold_500)+朱紅字(cinnabar_800,5.39);陰=漆黑底(lacquer_800)+亮金字(gold_300,11.74);**不要只靠顏色**,格底本身有深淺差異。五行色只用小圓點/洛書數字。

#### 2.8.8 繪製、手勢與效能

- 盤面**只畫一次**(離屏或直接畫在 canvas),旋轉用 CSS `transform: rotate()`(`will-change: transform`);疊層(天心十道 `#D0342A` 1px、指針、瞄準線)畫在**第二張不旋轉的 canvas**;隨傾斜移動的高光不可畫進會旋轉的那張。DPR 上限 3(360css × 3 = 1080² ≈ 4.7MB)。iOS Safari 單一 canvas 面積上限 16,777,216 px(iOS 18 起 8192²,67,108,864 px);「iOS 15 約 384MB canvas 總量」**無來源,未驗證,不作依據**(只開兩張畫布即可)。`getContext('2d',{alpha:false})`;字型載入完再畫(`document.fonts.load`),版面用「格寬固定」,備援字型不破版。
- 文字沿弧: 單字格用「平移到環上 + 旋轉」;多字(節氣、宿名)實物盤是**沿半徑堆疊**(外側字先讀,`stack()` 字距 1.02×字級);沿弧排字時字頭朝外的閱讀方向為順時針、字頭朝內則反向;**不使用 `ctx.letterSpacing`**(2025-03 才新近可用,舊 WebView 沒有),字寬用 `measureText`。字頭朝外或朝內實體盤無文字來源,預設朝外,「下半盤翻正」開關。
- 手勢: Pointer Events + `touch-action:none` + `setPointerCapture`;角度展開 `((a-last+540)%360)-180`;慣性摩擦時間常數 τ=0.5 秒(總滑行 = ω₀·τ),角速度 < 0.5°/s 停止;觸點離圓心 < 0.16R(天池內)不啟動旋轉;跨過每個 15° 山界可給輕觸覺(Capacitor Haptics,未實測);尊重 `prefers-reduced-motion`(關閉慣性);「鎖定到磁北」(盤角 = -手機航向)與「手動轉盤」二擇一。
- **[已更正] 手勢程式碼 bug**: 原碼只在有 `pointermove` 時更新角速度 `om`,手指按住不動 1 秒再放開,`om` 仍是上一次移動的速度,放手後盤面會突然甩出去。修法: 放手時若 `performance.now() - lastT > 80ms` 則 `om = 0`。
- 讀數列: 固定一行文字,`aria-live="polite"`。範例(`setAng(-90)`): 「朝向 90.0° 卯山(震宮/天元) 坐酉」;`setAng(-352.5)` → 子山。資料由 `geo.analyzeBearing` 提供。

#### 2.8.9 字型 [已更正 Apple 敘述]

| 平台 | 楷體狀況 |
|---|---|
| iOS | Kaiti SC/TC、BiauKai、BiauKaiTC 在 Apple 官方系統字型清單標為 iOS downloadable(非預載),離線不可依賴 |
| macOS | **Kaiti TC、BiauKaiTC 也是 downloadable(非預載)**;BiauKai 僅列 iOS(舊敘述「macOS 有 Kaiti TC、BiauKai」不精確) |
| Windows | 標楷體 DFKai-SB(繁體);KaiTi(`simkai.ttf`)為**簡體**字型(Microsoft Learn) |
| Android | 預設 CJK 為 Noto Sans CJK(黑體),**無楷體** |

結論(信心: 中,較舊敘述更強): **離線 App 必須內嵌子集字型**。候選: 全字庫 TW-Kai(政府資料開放授權條款 v1 或 OFL 1.1 二選一,須顯名「數位發展部,CNS11643中文標準交換碼全字庫網站」;OFL 路線需隨附著作權聲明與 OFL 全文,cns11643.gov.tw/pageView.jsp?ID=59)、霞鶩文楷 TC(OFL 1.1,作者聲明非台標,推薦 Iansui)、Noto Serif TC(宋體備援)。**TW-Kai `OS/2.fsType`、子集大小(預期數十 KB,`pyftsubset --flavor=woff2`)、字表涵蓋 205 字均未實測**,嵌入前要開檔確認。CSS 堆疊: `"LuopanKai","Kaiti TC","BiauKaiTC","BiauKai","DFKai-SB","KaiTi","STKaiti","Noto Serif CJK TC","Noto Serif TC","Songti TC","PMingLiU","PingFang TC",serif`。

**[已更正] 子集字表**: 核心 117 字缺「山、宮、朝」(讀數列「朝向 90.0° 卯山(震宮/天元) 坐酉」需要);core 與 full 都缺九星色字「黑、碧、綠、黃、赤、紫」(洛書環若顯示色名);full 也缺 UI 環名用字(卦、宿、山、節、氣、池、洛、書、度、百、三、二、八、六、十、四)。規格: `charset = core117 ∪ {山,宮,朝} ∪ nineStarColors{黑碧綠黃赤紫}(若顯示) ∪ ringNames`,或明講 UI 字走系統字型不嵌;二擇一必須在建置前決定,子集後大小未測。

磁針: 紅頭指南、黑頭指北(羅盤慣例,與一般指北針相反),天池旁小字標「北」;海底線 `cinnabar_500` 1.2px 從中心到北端,北端兩側各一個半徑 1.6px 紅點;天心十道為不轉動疊層(D61)。

#### 2.8.10 邊界情況

- 節氣環只有單一逐項來源;120 分金四維山低信心;28 宿本身是近似。
- 台灣市面主流盤式沒有統計,「通行度」欄多為低信心推論。
- 實機效能(iOS WKWebView、Android WebView 旋轉幀率、慣性手感、Haptics)未測,原型只在桌面 Chrome 驗證。
- 圖例「二百二十龍」疑為二百四十龍(S33),未確認,不實作。

---

### 2.9 sensor(手機方位)

依據: device_compass.md、device_compass.verify.md。fixtures: device_compass.json(99 案,複查 0 個數值錯誤)。程式來源: device_compass.md 2.10 的 `compass-core.mjs` 與 `compass-source.js`(純函式核心 + 瀏覽器感測層,已對 99 筆 fixtures 通過)。目標: Capacitor 8(iOS 15+、Xcode 26+、Android minSdk 24/target 36、Node 22+)。

#### 2.9.1 平台事實(信心: 高,均由原始碼或官方文件確認)

| 項目 | iOS Safari / WKWebView | Android Chrome / WebView |
|---|---|---|
| 北方欄位 | `webkitCompassHeading`(**磁北**、順時針;`magneticHeading` 來自 CLLocationManager) | `deviceorientationabsolute` 的 `alpha`(磁北,逆時針;`TYPE_ROTATION_VECTOR`) |
| 事件 | `deviceorientation` | 有 `'ondeviceorientationabsolute' in window` 就只聽它;否則聽 `deviceorientation`(Android 上為**相對**事件,除非 `event.absolute===true`) |
| `alpha` | 任意零點,**不能當北** | absolute 事件: 0=磁北 |
| 精度 | `webkitCompassAccuracy`(±度,**-1=未校準**);負的 heading=無效 | Web 事件無精度欄位(原生有 `values[4]`) |
| 權限 | `requestPermission()` **必須在使用者手勢內**;Capacitor iOS 的 WKUIDelegate 直接 `.grant`(不彈窗,但仍需手勢) | 舊版無;Chromium 152 起有 `requestPermission(absolute)`(見下) |
| 事件率 | 60 Hz 輪詢最新值,約 1° 一階(推論) | ≥0.1° 才發事件,上限 60 Hz,手機靜止就沒有事件 |
| 螢幕旋轉 | heading 固定直式頂端 | 軸固定於自然方向 |
| secure context | `capacitor://localhost` 視為 potentially trustworthy | `https://localhost` |

**[已更正] iOS `webkitCompassHeading`「以頂端為基準」只在手機放平時成立**: Apple 文件只保證直式放平時頂端=0;手機直立(像拍照)時 CoreLocation 的航向定義文件沒寫,唯一證據是第三方 Twilight PR #62(單一來源、未實機)稱「越過垂直後航向像跟著相機走」。信心由高降中。因此 v1 iOS 只在 `tilt <= 50°` 時採信 `webkitCompassHeading`,其餘回 `tilt-too-large` 請使用者放平。

不使用 `@capacitor/motion`(只轉手 `deviceorientation`,也註冊 `devicemotion`,無 `requestPermission`,型別只有 alpha/beta/gamma)。不為羅盤要求定位權限(磁北不需要;Cap-go 外掛在無定位時丟棄讀數是反例)。原生外掛(Capawesome 0.1.2 MIT、Cap-go 8.1.20 MPL-2.0)沒有明顯精度優勢,v1 用 Web 事件並把來源包成 `CompassSource` 介面以便日後替換(D65)。

#### 2.9.2 姿態角 → 方位

座標: W3C 裝置座標 x 朝螢幕右、y 朝螢幕頂端、z 垂直螢幕朝外;`R = Rz(alpha)·Rx(beta)·Ry(gamma)`;世界 x=東、y=北;方位 = `atan2(東分量, 北分量)`。

| 名稱 | 軸 | 世界向量(東,北) | 可靠時機 |
|---|---|---|---|
| `top` 頂端 | +Y | `(-cosβ·sinα, cosβ·cosα)` | 平放或略後仰;與 γ 無關;`cosβ>0` 時 = `(360-α) mod 360` |
| `back` 後鏡頭 | -Z | W3C 附錄 A.1 的 `Vx,Vy`;beta=90 時 heading = -(α+γ) | 直立或斜舉;完全平放時退化為 null |
| `right` 右緣 | +X | `(cosα·cosγ - sinα·sinβ·sinγ, cosγ·sinα + cosα·sinβ·sinγ)` | 橫放且平放時當螢幕上方 |

已用三種獨立實作(矩陣連乘、W3C 閉式、四元數)加 Rodrigues 逐步旋轉驗證,複查另以獨立 python 矩陣連乘重算 99 筆。W3C 範例: `alpha=90, beta=0, gamma=0`(平放)頂端朝西 270°。`tilt = acos(|cosβ·cosγ|)`(0=平放,90=直立)。

**[已更正] 頂端/後鏡頭切換(D66)**: 原設計「`top` 模式下 tilt>50° 切 `back`、`back` 模式下 tilt<40° 回 `top`」的遲滯會在有側傾時造成航向跳變(複查重算,`alpha=0`、tilt 恰 50°,頂端方位 0°,後鏡頭方位: γ=5° → 353.5°(跳 6.5°)、10° → 346.9°(13.1°)、20° → 333.5°(26.5°)、30° → 319.3°(40.7°);24 山每格 15°,盤面會突然跳一到兩格)。規格改為**平滑混合,不硬切**:

```js
const t = clamp((tilt - 40) / 10, 0, 1);
const w = t * t * (3 - 2 * t);                    // smoothstep(40°,50°)
// vec = (1-w)*unit(top) + w*unit(back); 任一為 null 則只用另一個; 皆 null 回 null
heading = atan2(vec.x, vec.y)                     // 度,正規化
mode = w === 0 ? 'top' : w === 1 ? 'back' : 'blend'
```

(替代方案: 只在 `|gamma| < 5°` 時才允許切換,否則沿用現模式並提示「請放平」。)已用 `compass-core.mjs` 的 `eulerHeadings`/`tiltDeg` 重算混合結果,alpha=0 時 γ=10°: tilt 40° → 0.0、45° → 352.892、50° → 346.898;γ=20°: 40° → 0.0、45° → 345.537、50° → 333.482;γ=30°: 45° → 337.5、50° → 319.254。航向隨傾角**連續**變化(見附錄 B 新增向量)。門檻 40/50、15° 允許鎖定傾角都是設計值。

#### 2.9.3 事件解碼 `decodeOrientationEvent`

輸出 `{source, headingDeg, accuracyDeg, status, mode}`,優先序: iOS `webkitCompassHeading` > 絕對的 alpha/beta/gamma > 不可用。

| 輸入 | status | headingDeg |
|---|---|---|
| `webkitCompassHeading` 為數字且 `webkitCompassAccuracy < 0` | `uncalibrated` | null |
| `webkitCompassHeading` 為負或非有限值 | `invalid` | null |
| iOS 且 `tilt > 50°` | `tilt-too-large` | null |
| iOS 其他 | `ok` | `webkitCompassHeading % 360`(**360 → 0**) |
| alpha/beta/gamma 任一為 null | `no-sensor` | null |
| `absolute !== true` | `relative-not-north` | null |
| `absolute === true` | `ok`(或 `degenerate`) | `pickHeadingBlend(...)` |

決策表 10 案已與參考實作逐一比對通過(信心: 中,文件推導)。複查另補測: `webkitCompassHeading=360` → 0(ok)、`NaN` → invalid、accuracy=-1 且 heading=0 → uncalibrated、無 accuracy 欄位 → ok(accuracyDeg=null)。這四個行為合理,需補進 fixtures(附錄 B)。

#### 2.9.4 取樣、平滑、鎖定

1. **計時器取樣 20 Hz**(`setInterval(50)`),事件處理函式只存最新值,不逐事件處理。
2. **圓周 EMA**(即時顯示): 單位向量 `x += k(cosθ-x)`、`y += k(sinθ-y)`,`k = 1-exp(-dt/τ)`,預設 τ=0.2 秒(設計值)。k 表(60/30/20 Hz × τ 0.1/0.2/0.3/0.5)已重算: 60 Hz [0.1535,0.0800,0.0540,0.0328]、30 Hz [0.2835,0.1535,0.1052,0.0645]、20 Hz [0.3935,0.2212,0.1535,0.0952]。**禁止**對角度數值做算術平均或線性 EMA。
3. **鎖定平均**: 3 秒(約 60 筆,最少 20),圓周平均與圓周標準差 `σ=sqrt(-2 ln R)`;樣本 < 20 → `too-few`;σ > 3° → `unstable`;合成向量近 0 → null。感測誤差在時間上相關,平均後不確定度不會照 σ/√N 縮小,所以同時顯示 σ 與 iOS accuracy。σ=3° 對應 R≈0.9986,門檻對輕微抖動很嚴格,實機可能過易判不穩,待校正。
4. **顯示**: 即時 1°,鎖定平均後 0.5°(`roundHalf` = `Math.floor(x+0.5)` 語意,359.8 → 0.0 回捲);不顯示 0.1°,不宣稱 ±1° 準確。**[已更正] 捨入語意**: 期望值依賴 JS `Math.round` 半數進位(0.25 → 0.5);Python 銀行家捨入會變 0.0,實作必須用 `Math.floor(x+0.5)`(複查)。
5. **不確定度**: `uncertainty = max(5.0, 2σ, iosAccuracy)`(見 geo 2.1.7);「品質燈號」綠 = iOS accuracy ≤10 或 Android 即時 σ ≤2°;黃 = 10-25 或 2-4°;紅 = accuracy<0、>25 或 σ>4°(門檻設計值,10 為 Apple 文件範例值)。紅燈或 `uncalibrated` 時顯示「請遠離金屬,手持手機畫 8 字」並停用鎖定;水平氣泡傾角 < 15° 才允許鎖定;`boundaryDist < max(σ, accuracy/2, 2°)` 時提示「接近分界,建議重測」。
6. 多次量測: 預設單次 3 秒平均,選項「三次取圓周平均」(實務文章建議至少三次,單一來源,信心: 低)。「上午 9-11 點磁場較穩定」只有一個來源、無依據,**不列入 UI**。

#### 2.9.5 權限與生命週期

`createCompassSource().start()` 必須從使用者手勢(點「啟用羅盤」按鈕)呼叫;流程: `isSecureContext` 為 false → `insecure-context`;無 `DeviceOrientationEvent` → `unsupported`;`requestPermission` 為函式 → `await requestPermission(true)`,非 `granted` → `permission-denied`,例外 → `permission-error`;掛監聽並啟動 1.5 秒 watchdog,逾時 → `no-events`。頁面不可見不發事件,回前景(`visibilitychange` 或 Capacitor `appStateChange`)要 `stop()` 再 `start()` 並重計 watchdog,不需再次手勢(Capacitor iOS 已快取 granted)。

**「Chromium `requestPermission`」[未解決]**: MDN BCD 稱 Chrome 152 起存在且 WebView mirror;chromestatus 另一官方頁稱 Chrome 151 出貨、「WebView: Not yet shipped」,兩個官方來源互相矛盾。「**函式存在就呼叫、失敗不致命、用 watchdog 確認有沒有事件**」的寫法在兩種情況都正確;長期若改 ask-by-default(未呼叫就沒有事件),「啟用羅盤」按鈕視為所有平台永久必要。Android System WebView 實際行為需實機驗證(U-05)。

**狀態碼→訊息(繁中,台灣用語)**:

| status | 訊息 | 動作 |
|---|---|---|
| `permission-denied`/`permission-error` | 需要允許「動作與方向」才能使用羅盤 | 顯示重試與手動輸入 |
| `no-events` | 偵測不到方位感測器 | 手動輸入/拖曳盤面 |
| `relative-not-north` | 這台裝置無法提供指北資料 | 手動輸入 |
| `uncalibrated` | 羅盤尚未校準,請遠離金屬並手持手機畫 8 字 | 停用鎖定 |
| `invalid` | 方位資料無效,請稍後再試 | 忽略該筆 |
| `tilt-too-large` | 請將手機放平再讀數 | 顯示水平氣泡 |
| `unstable` | 讀數不穩定,附近可能有磁性物體 | 提示重測 |
| `too-few` | 樣本不足,請再等一下 | 繼續收集 |
| `degenerate` | 手機太接近水平,無法判定後鏡頭方向 | 使用頂端模式 |
| `insecure-context` | (開發者訊息,正式版不應出現) | |

#### 2.9.6 專案設定

| 項目 | 設定 | 備註 |
|---|---|---|
| `capacitor.config` `server.hostname` | 保持預設 `localhost` | 才能使用需 secure context 的 Web API;`iosScheme` 預設 `capacitor`、`androidScheme` 預設 `https`,不要改成 http |
| iOS `Info.plist` | 走 Web 事件: 不需專屬 key;**建議仍加 `NSMotionUsageDescription`**(「用來讀取手機方位以測量房屋坐向」)避免審核疑慮 | Apple 文件列的適用 API 是 CoreMotion 活動類,WKWebView 的 DeviceOrientation 是否需要沒有明文,沒有實機/審核結果,信心: 中([未解決] U-05) |
| iOS 真北 | 僅原生 `trueHeading` 才需 `NSLocationWhenInUseUsageDescription` | v1 不做 |
| 鎖直式 | `@capacitor/screen-orientation` 8.0.1 `lock({orientation:'portrait'})`;`UISupportedInterfaceOrientations` 只留 Portrait;iPad 多工無法鎖,需勾 Requires full screen;偵測 `innerWidth > innerHeight` 顯示「請轉回直式」 | v1 鎖直式(D67) |
| Android | `AndroidManifest` 不需權限;`android:screenOrientation="portrait"` | |

**螢幕方向 [未解決]**: 座標系固定於自然方向(W3C、Android SensorEvent);`screen.orientation.angle` 在 iOS 與 Android 相反(2023 互通性回報: 裝置順時針轉 90°,Chrome Android 回 270,Safari iOS 16.4 回 90);映射 Android `deviceRotCCW=angle`、iOS `deviceRotCCW=(360-angle)%360` 只有單一來源(且規格用語本身有歧義,複查認為 Chrome 的 270 反而與「逆時針」文字相容),**橫式支援前必須實機量測**;group11(`iosUprightOffset`)與 group13(`screenAngleToDeviceRot`)是報告自訂映射/推論,fixtures confidence 標 low/medium(複查)。

#### 2.9.7 降級與桌機測試

- 降級: 手動輸入度數(0-359.9,步進 0.5,面向/坐可切)、拖曳盤面對齊參考物、平面圖或衛星圖旋轉對齊、實體羅盤讀值手動輸入。
- 桌機: 合成事件 `window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:90,beta:0,gamma:0,absolute:true}))`;iOS 樣式用 `Object.defineProperties(ev,{webkitCompassHeading:{value:270},webkitCompassAccuracy:{value:10}})`。**Chrome DevTools Sensors>Orientation 只驅動 relative 虛擬感測器**(`device_orientation_handler.cc`),只觸發 `deviceorientation`(absolute=false),需 debug 旗標 `debugTreatRelativeAsAbsolute` 或改用合成事件。手機區網 `http://192.168.x.x` 不是 secure context,事件會被擋;改用 port forwarding 的 `localhost`、https 隧道、或 Capacitor 原生殼。`?debug=1` 內建三個滑桿 + iOS 模式勾選 + accuracy 滑桿。
- 邊界情況: 頁面進背景再回前景要重啟(見 2.9.5);`tilt` 接近 90°(直立)時頂端方位退化為 null、後鏡頭方位有效;完全平放時後鏡頭方位退化為 null、頂端方位有效;`faceDown`(螢幕朝下)時頂端方位需 +180 才是螢幕上方,v1 直接提示「請螢幕朝上」;iOS `webkitCompassHeading` 為 360 視為 0;`accuracy` 欄位缺失視為未知(不判未校準);合成向量長度近 0(如 90° 與 270° 各半)時平均未定義回 null。
- 該做/不該做清單: device_compass.md 第 5 節(同類 App 教訓: 鎖定讀數、手動輸入、磁北/真北切換、平面圖疊圖存檔可靠、離線無廣告、台灣繁體字;不要裸用 alpha、不要算術平均角度、不要載入頁面就 `requestPermission`、不要區網 http 測試、不要顯示假精度)。

---

## 3. 流派分歧決策表

欄位: 決策 ID | 議題 | **預設選擇** | 理由與依據 | UI 開關(設定名稱)。「通行度」指台灣/華人圈,凡無統計者標「未知」。開關名稱即 1.4 `Settings` 的鍵。

### 3.1 geo 與 calendar

| ID | 議題 | 預設 | 理由與依據 | 開關 |
|---|---|---|---|---|
| D01 | 24 山邊界歸屬 | 半開區間 `[起,止)`,恰在界線歸順時針下一山 | 純程式約定;傳統壓線本身就是空亡,無公認歸屬(orientation.md 2.1) | 無 |
| D02 | 下卦(正向)寬度 | ±4.5°(中間 9°) | 沈氏玄空學與多數玄空來源(zggdfs Read8_999、108s 294、香港陳癸龍稱後學多以 4.5° 為準);少數 ±3.5°(xuankongguan)、±3°(36fengshui zs60) | `xiaGuaHalfWidth` 4.5/3.5/3.0 |
| D03 | 兼向限度 | 同陰 6、同陽 7、陰陽互兼 5-6、出卦 5-6(兩段式) | 36fengshui zs60(5°)與 zggdfs Read_52(6°)並存,兩段式為折衷;同陰同陽兩來源一致 | `jianLimitSchool` default/strict5/zggdfs6 |
| D04 | 大小空亡標籤 | 位置式(卦界=大空亡、山界=小空亡),同時輸出度數式 `kongxiang`;文案標「各派定義不同」 | 位置式: sohu 274267505、yixiansheng 4527、zggdfs;度數式: 36fengshui(差錯=小空亡、出卦=大空亡);ifeng 不稱同性相兼山界為小空亡;複查 V8 | `kongwangLabelScheme` position/degree |
| D05 | 手機不確定度 | App 層 5.0°(純函式預設仍 3.0) | pointme.live: 高階機戶外理想 ±2-5°,中階 ±5-10°,入門 ±10-20°(單一部落格,信心中低) | `measureUncertainty` |
| D06 | 北基準 | 磁北(同實體羅盤) | 與老師對照才對得上;手機讀磁方位不需位置權限;台灣偏角 4.3-5.1° 已超過 3°/格,不校正與校正讓約 34%(台北)方位換山 | `northMode` magnetic/true |
| D07 | 「向」怎麼取 | 大樓/公寓=主採光面;透天=門窗差 ≤45° 用門;店面=臨街門;夾角 >45° 三候選由使用者確認 | 無壓倒性共識(信心: 低,產品政策);幸福空間、ailan 以採光面為主,17rent 以大門 | `facingPolicy` auto/door/light/building |
| D08 | 八宅用門向或宅向 | 八宅預設大門朝向;玄空吃宅向;兩個輸入分開 | 八宅通俗版以大門定坐向(secretchina、sina);玄空以外局與氣口;複查 V10 | `bazhaiFacingBasis` door/house |
| D09 | 三針 | 只用地盤正針 | 玄空與八宅只用地盤;人盤消砂、天盤納水屬三合派 | `showSanZhen` |
| D10 | 年界 | `lichun_exact`(立春瞬間,精確到分,UTC+8) | 干支曆天文定義;**通行度敘述已更正**: 來源只證明「以立春為界」,不證明「精確到分」;與春節法差 2.04% 日子,與元旦法 9.44% | `yearBoundary` lichun_exact/lichun_date_only/fixed_feb4/lunar_new_year/gregorian_jan1 |
| D11 | 入運依據 | 建成年的運;大修欄位 `full` 才以完工運;可選遷入 | 多數科普文章預設落成年(措辭已由「主流」更正);中州派與台灣命學研究中心偏遷入/重新裝潢 | `yunBasis` built/moveIn;`renovation` none/partial/full/anyRenovation |
| D12 | 三元九運 vs 二元八運 | 三元九運(2024-2043) | 台灣/香港飛星主流;二元八運(談養吾)為另一體系 | `yunSystem` san_yuan_9/er_yuan_8 |
| D13 | 交運界線 | 立春精確瞬間 | 未見來源主張元旦或春節 | 無(可選 `gregorian_year` 僅供對照) |

### 3.2 bazhai

| ID | 議題 | 預設 | 理由與依據 | 開關 |
|---|---|---|---|---|
| D14 | 星等級排序 | 吉 生氣>延年>天醫>伏位;凶 絕命>五鬼>六煞>禍害;權重可調 | 與原文及多數現代來源相容;延年/天醫、六煞/禍害各書不一,神機閣完全相反(複查 R17) | `tianyiFirst`;`bazhaiStarWeights` |
| D15 | 灶座位置 | 坐凶向吉 | 《八宅明鏡》、乾坤網、Uncle Kin、明天機;少數派 Feng Shui Store、Feng Shui Beginner 主張灶座在吉方 | `stovePreferAuspicious` |
| D16 | 命宅不配 | 依命不依宅(用命卦重排床、書桌、灶口) | 《八宅明鏡》註解、Feng Shui Store;另有門主灶三要、夫妻不同組四法 | `coupleBasis` breadwinner/wife/husband/holderOnly/averaged |
| D17 | 五鬼運財 | 不推薦,五鬼=破財凶位 | 存在此說但無公開可驗證標準(信心: 中存在/低有效) | `showMinorityTechniques` |
| D18 | 桃花位 | 六煞=凶,不列桃花吉;少數派區並列「六煞桃花(不穩)/延年桃花(穩)」 | Feng Shui Beginner、明天機、Uncle Kin | `showMinorityTechniques` |
| D19 | 財位序 | 生氣>延年>天醫>伏位 | 易經堂;香港一派稱天醫=財位;延年>天醫無來源(設計值) | `tianyiFirst` |
| D20 | 鬼門線 | 關閉 | 只有搜狐研易人士一個來源 | `showGuimenxian` |
| D21 | 位置 vs 朝向 | 兩區分開,不互相扣分 | 古法灶章 + 現代港台西方大量使用朝向;古法床章亦有朝向語 | 無 |
| D22 | 客廳沙發/魚缸 | 四吉位不分先後 | 「生氣首選」被複查 refuted;東西四分級只有單一現代加註 | `livingRoomGradeByEastWest` |

### 3.3 xuankong

| ID | 議題 | 預設 | 理由與依據 | 開關 |
|---|---|---|---|---|
| D23 | 24 山陰陽 | 玄空標準(陽=乾坤艮巽+壬丙甲庚+寅申巳亥) | 5 個以上獨立來源一致;舊表 8 山寫反 | 無(不是分歧,是舊表錯誤) |
| D24 | 替卦 | 預設只做下卦 + 兼向提示;替卦(A 表)為進階 | 《沈氏玄空學》原文未取得;中州派/Wikibooks 規則可驗證(出卦或陰陽差錯才替,同陰陽不替);無常派把替卦當趨吉手段,不採用 | `useTiGua`;`tiTable` A/B |
| D25 | 替卦後順逆 | 看原伴山陰陽,不看替星 | 中州派、Wikibooks、無常派範例一致;改看替星宮在 216 盤中 102 盤不同 | 無 |
| D26 | 5 入中 | 用山(向)自身陰陽 | 與「用運盤中宮運星所在卦宮的同元龍山」等價(216 盤差異 0) | 無 |
| D27 | 五氣分級 | `default` | 泛化自九運公開標法,與 SINA-HESHI 逐宮標法吻合最佳;S1/S2 分歧在 d=3..7 | `qiScheme` default/S1/S2 |
| D28 | 八白退氣 | 0 分,不催不禁 | zs4 稱失令失財、SECRETCHINA 稱吉力大降、VOCUS 稱仍是財星,來源分歧;**標少數派** | `eightKeepsWealth` |
| D29 | 全局伏吟/反吟 | 伏吟: 嚴重且扣 -3;反吟: 一律警示,旺山旺向且星為當運才不扣,否則 -1 | 複查 R15 更正;ZGGDFS-57/60、zs35 | `fuyinPenalty`、`fanyinPenalty` |
| D30 | 財位公式 | 依格局分流: 向宮=旺財位;坐宮=財星在後方,不列旺財位 | 複查 R17 更正;zs31 雙星會坐旺丁不旺財 | 無 |
| D31 | 星組合與連數三般卦 | 依 2.4.9 更正表;連數三般卦只標記不計分 | 三派矛盾(SINA-3BAN、zs36 吉 / SOHU 凶) | `showLianshu` |
| D32 | 城門位 | 只顯示,不進主評分 | 可用性是單一作者簡化規則,與古法及 SINA-HESHI 例不同義 | `showChengmen` |
| D33 | 看盤權重 | 財看向星、丁看山星;副權重 0.3;運星 0.3 | 優先順序三種說法(山向組合>山運向運>運星 / 山星>向星>流年星 / 坐星為主);0.3 為工程折衷 | `wSide`、`wYun` |
| D34 | 兼向外側帶 | 外側 1.5° 標紅、其餘 1.5° 標黃 | 中州派「靠外 1.5 度最凶」;易先生表 6° 寬(自相矛盾) | 無 |
| D35 | 雙星會坐有山無水/有水無山 | 顯示溫和版並附註嚴厲版 | SOHU-912417602 與 CAF-series/zs31 兩派不同 | 無 |
| D36 | 二五交加 | 二運/五運不扣,其他運強制警示,九運一律警示 | SOHU-478153604、SOHU-469457756 | 無 |
| D37 | 房間用途規則 | 全部標「推論」徽章 | 單一作者(刘燮钧)為主,多條無來源 | 無 |

### 3.4 annual 與 wealth

| ID | 議題 | 預設 | 理由與依據 | 開關 |
|---|---|---|---|---|
| D38 | 流年何時換 | 立春瞬間 | 專業共識(來源見 2.5);少數民間元旦換 | 無 |
| D39 | 三煞弧 | 只畫 `core3`(三山各 15° 共 45°) | 複查 refuted 75° 為預設;75° 含夾煞且只有玄空館一個來源 | `sanshaArc` core3/withJia/branch12 |
| D40 | 額外神煞 | 關閉(夾煞、力士、月煞) | 少數單一來源;力士/月煞算法未整理 | `extraShensha` |
| D41 | 流年財星集合 | 八白 1.0、九紫 0.8、一白與六白 0.6、四綠 0.2 | 八白最通行;九紫加分只能推論;皆設計值 | `yearVal` 可調 |
| D42 | 主流神煞 | 太歲、歲破、三煞、五黃、二黑固定顯示 | annual 複查:主流 vs 民間分類 | 無 |
| D43 | 明財位定義 | 遠端 90° 凹角(門左則遠端右角,門右則遠端左角) | 5 個以上來源一致,20 萬組隨機 0 不一致;專業玄空派批評為坊間簡化 | `showRay45` |
| D44 | 門居中 | 兩角並列,遠者 primary | 多數(觀仁自在、中文百科、方格子、ETtoday);MyGoNews 只取龍邊 | `preferDragonSide` |
| D45 | 排序檔 | `mingcai`(通俗) | 台灣大眾最通行;`xuankong` 為進階檔 | `wealthProfile` |
| D46 | 財位見空(窗) | 明財位派: 扣分並給補救 | Yahoo、Ailan、易算數、100 室內設計 vs 吳尚易(需納氣,不可放屏風) | `qiIntake` penalty/reward |
| D47 | 財位放水 | 不主動建議 | 忌水(中文百科、潮紫微)vs 催財用水(蘇民峰、魚缸文章) | `allowWaterHint` |
| D48 | 九運水火 | 北宜水為來源說法;南忌水標**推論** | 李居明與 FWD 只說南方宜見山,沒說忌水 | 無 |
| D49 | 門沖 | ≥80% 且無遮擋=門沖;50-80%=輕微偏移 | Ailan「幾乎完全成一直線」;舊 50% 太寬 | 無 |
| D50 | L 型/不規則 | 最遠 90° 凹角(步行距離) | 來源說「拆兩個矩形」;演算法不同,低信心;可手動指定 | 手動指定 |
| D51 | 開放式空間 | 整體以大門為基準 | 易算數、100 室內設計 vs 藝術家推好康(虛擬分區) | `virtualPartition` |
| D52 | 坐向雙位表/紫白坐山表 | 關閉 | 各版本互相矛盾且與八宅凶位重合 | 無 |
| D53 | 多人命卦 | 取平均 | 產品決策 | `multiOccupantPolicy` mean/breadwinner/each |
| D54 | 收銀台/辦公桌 | 龍邊+靠牆+迎客;財位不強制 | 潮紫微、518 | `bazhaiMatch` |
| D55 | 太極點 | 主屋外框面積重心 | 設計決策,無來源 | `taijiMode` centroid/bbox/manual |

### 3.5 luopan 與 sensor

| ID | 議題 | 預設 | 理由與依據 | 開關 |
|---|---|---|---|---|
| D56 | 24 山陰陽 | 三元龍陰陽 | 玄空與八宅用;三合派用紅黑字 | `yinyangScheme` sanyuan/sanhe |
| D57 | 28 宿 | 開禧宿度、365.25 縮進 360° | 羅盤實務多為開禧;時憲/明師盤不實作 | 先只實作開禧 |
| D58 | 120 分金 | 只做即時讀數,只顯示地支山 | 八干四維規則單源;手機不夠準 | 無 |
| D59 | 64 卦環 | 不放 | 5.625°/格太窄;起點各家不同 | 資料備存 |
| D60 | 上方向 | 北在上 | 與手機指北一致 | `southUp` |
| D61 | 磁針顏色 | 羅盤慣例(紅南黑北)+「北」小標 | S16、S30 | 「現代慣例」 |
| D62 | 環配置 | 模式 A(含節氣環,r5 已加寬) | 2.8.6 | 模式 B(三合) |
| D63 | 字型 | 內嵌子集楷體 | Apple 楷體皆 downloadable | 無 |
| D64 | 五行色 | `wx_fire #EC6A57`、`wx_water #6A9CDC` | 舊值在 lacquer_700/600 底對比不足(火 4.39/3.94、水 4.53/4.06) | 無 |
| D65 | 感測來源 | Web 事件(`CompassSource` 介面) | 無明顯原生精度優勢 | 原生外掛替換 |
| D66 | 姿態選擇 | smoothstep(40°,50°) 混合頂端/後鏡頭方位 | 硬切在側傾時航向跳變(複查 R5) | 「只用平放」 |
| D67 | 螢幕方向 | v1 鎖直式 | 橫式映射需實機 | 無 |
| D68 | 鎖定與顯示 | 3 秒、σ>3° 不穩、即時 1°/鎖定 0.5° | 設計值 | 3/5/10 秒 |
| D69 | 權限流程 | 手勢內 `requestPermission`,存在就呼叫,watchdog 1.5 秒 | Chromium 版本來源矛盾 | 無 |

---

## 4. 測試策略

### 4.1 fixtures 對照與通過條件

fixtures 檔一律 UTF-8、`{meta, cases}`。「硬斷言」失敗即測試失敗;「軟斷言」(`confidence:'low'` 或標示 school-specific)只斷言不崩潰與旗標。**測試 harness 不得修改 fixtures**;附錄 B 列出 fixtures 修正/補案,由整合者更新後再啟用對應斷言。

| 模組 | fixtures | 案例 | 通過條件 |
|---|---|---|---|
| geo | orientation.json | 179(函式 162、declinationReference 17) | 162 筆函式案例全過(float 容差 1e-9;`circularMean` 的 `r`、`stdDeg` 容差 1e-5);17 筆偏角資料誤差 ≤ 該案 `tolDeg`(0.02°);`pickFacing` 12 筆屬產品政策(信心 low),只核對與 2.1.6 一致;`kongwangKind` 的 school-specific 案例走軟斷言 |
| geo + luopan | luopan_rings.json | 72 | 24 山幾何/宮/元龍/陰陽/五行、八卦/洛書/先天、三針 lookup 9 筆、28 宿 28+8+12 次比對、120 分金(低信心項走軟斷言)、facing/sitting、arc_text、drag_angle_unwrap、inertia、layout(模式 A 依本檔 2.8.6 新表)、palette_contrast(補案後)、charset(補字後) |
| calendar + annual | annual.json | 191 | 191/191(已重算);`solar_term_time` 用各案 `toleranceMinutes`(2);`solar_longitude_at_instant` 用 `toleranceDeg` |
| calendar | xuankong_core.json `yun_of_datetime` | 22 | 22/22(已用 annual 參考實作重算)|
| calendar | bazhai.json `meta.lichun_cst_1900_2100` | 201 年 | 對 calendar 差 ≤ 120 秒(已重算最大 68.9 秒) |
| bazhai | bazhai.json | 135 | 全過: `minggua_year` 34、`minggua_birth` 27(含各年界制式與時區換算)、`star_matrix` 1、`star_row` 8、`property` 3、`zhai_gua_from_sit_mountain` 24、`zhai_gua_from_facing_degree` 12、`match_matrix` 1(64 格)、`usage` 1(5 個查表值)、`legacy_regression` 24(新引擎輸出必須**不等於** `legacy_wrong_*`) |
| xuankong | xuankong_core.json | 568 | `chart_xia` 216、`chart_ti` 216、`chart_from_facing_degree` 10、`yun_pan` 9、`direction_rule` 9、`pattern` 6、`old_engine_regression` 3、`table` 2 硬斷言;`locate_degree` 75 中 72 個硬斷言 + 3 個 `locate_edge_*`(340.5、349.5、352.5)**軟斷言**(只斷言不崩潰並帶騎線旗標) |
| xuankong | xuankong_patterns.json | 474(可算 436、資料向量 38) | 可算 436 全過(polarity 24、yunpan 9、chart 31、pattern 72、patternList 36、heshi 24、qixing 48、parent3 16、qixing_fuyin 6、lianshu3 16、yin_assert 10、qi 81、chengmen 8、chengmen_use 31、wealth9 24);資料向量 `qi_classical` 9、`star_dict` 9、`pair_tag` 20 依 2.4.9 更正版比對 |
| wealth | wealth_position.json | 71 | 全過(69 可重算,2 個純資料);分數容差 0.011、幾何容差 1e-9;更正項見附錄 B |
| plan | 無 | 0 | 屬性測試與 2.7.3 數值(見 4.4) |
| sensor | device_compass.json | 99 | 全過(group1-13);角度比較用圓周差,容差 1e-6;group7 用 `Math.floor(x+0.5)` 語意;group10 用純函式參考實作 + 文件邏輯;group11、group13 是自訂映射(confidence 標 low/medium),不當來源事實 |

### 4.2 共同 harness 規則

1. 角度比較一律圓周差(359.9999995 與 0 視為相等);`null` 表示退化,需精確相等於 null。
2. 案例 `confidence` 分級: high/medium 硬斷言;low 走軟斷言(除非該 fixture 檔明說是規則本身)。
3. 突變測試: 每個 runner 要證明「故意改錯期望值會被抓出」(annual 的 runner 已示範)。
4. 舊引擎迴歸: `legacy_regression`、`old_engine_regression` 類案例用來確認新實作**不重現**舊錯誤。
5. 跨模組一致性測試: 24 山表、宮位表由同一份資料生成,測試斷言 orientation/xuankong/luopan 三處讀到的山、卦、元龍、陰陽完全一致(24/24)。
6. 每個規格內嵌的資料表(星表、TI 表、三煞表、24 山表、CHENGMEN)都要有「由規則重算 == 內嵌表」的測試,防止手打錯字。

### 4.3 Adapter(鍵轉換)

| 來源 | 宮位鍵 | 轉換 |
|---|---|---|
| annual.json | 方位名 `'中宮','西北','西','東北','南','北','西南','東','東南'` | 方位名 ↔ 卦名(西北=乾 ...) |
| xuankong_core.json | 洛書數 1-9 | 1坎 2坤 3震 4巽 5中 6乾 7兌 8艮 9離 |
| xuankong_patterns.json | 洛書數 | 同上;`wealth9` 欄位 `xiang9`→`xiang9_at` |
| bazhai.json | 卦名或方位名 | 直接 |
| wealth_position.json | 卦名 | 直接 |

`yuan`(annual: era 上中下元 / orientation: dragon 天地人元)在 adapter 內分別映射到 `era` 與 `dragon`。

### 4.4 屬性測試

- **bazhai**: 8x8 表對稱(28 對);每列每欄 8 星各一;東四命四吉星落東四方位、西四命落西四;命卦封閉式 = 排山掌訣逐年推 = 1900/2000 末兩位公式(1700-2399);宅卦 8 扇區對 24 山歸卦在 0.1° 解析度 0 不符;`zhaiGua` 對任意實數輸入(含負值、>360)不回 undefined。
- **xuankong**: 每張盤運/山/向三平面各是 1..9 的排列(9 宮不重複);運盤中宮 = 入運;山星 N 恰在坐宮或向宮之一(σ、τ 代數證明的推論),向星同理;四大格局窮盡(216 盤無「其它」,計數 48/48/60/60);九運 12/12、五運旺山旺向 12/上山下水 12;含 5 入中的盤共 48(八運 6 盤,五運無);對山與坐山同元龍同陰陽(24/24);奇偶簡式與二次轉換一致(432 次飛布);替卦盤與下卦盤相同者 56;全局合十 24、父母三般 16、打劫 24+24+16;5 入中兩種取法 216 盤差異 0。
- **calendar/annual**: 流年中宮三公式一致(1864-2100);`fengshuiYear` 恰在 `lichun` 瞬間換年;12 個月連續(前月 end = 後月 start);月中宮 `[8,5,2][branch%3]-order`;流年盤各宮 1..9 排列;三煞四組弧聯集不重疊、每組 core3 為 3 個地支山;`nineYun` 20 年一運、180 年循環。
- **geo**: `mountainAt` index 隨 bearing 單調;`sit(facing(x)) = normalize(x+180)`、對山 index+12;`dev ∈ [-7.5,7.5)`;48 局分類計數 8/8/16/16;`needsTiGua` 對同性相兼恆為 false;`circularMean` 對 `[359,1]` 得 0。
- **plan**: 面積守恆、旋轉 45° 等變、正方形對稱、矩形重心=外框中心(見 2.7.6)。
- **luopan**: `ring_order_invariants`(天池最內、28 宿與刻度最外、節氣環緊貼 24 山外側);各環連續無縫;窄宿集合 ["觜","鬼"]。
- **sensor**: 平放時頂端方位 = `(360-α) mod 360` 與 γ 無關;`tilt` 30→60° 之間航向對 tilt 連續無跳變(γ ≤ 30° 時,相鄰 0.1° 傾角變化造成的航向變化 < 1°;已用程式重算最大 0.67°);`circularMean` 跨 0;EMA 跨 0 不繞 180;`roundHalf(359.75)=0`。

### 4.5 需要更新 fixtures 後才能啟用的斷言

見附錄 B。在更新完成前,這些案例以現有期望值執行但標記為「已知待修」,不得阻擋 CI(例: `pair_tag` 的一六/四四/五九、`taisui_sansha` 的弧欄位、`palette_contrast` 的「全部 ≥4.5」敘述)。

---

## 5. 白話文案指引

### 5.1 原則

1. **不堆術語**。結果頁第一屏只出現「你家的方位」「你的命卦組別」「今年的重點」,其餘術語放展開區。
2. **術語第一次出現要括號解釋**(見 5.2),同一頁之後可省略。
3. 每個結論都要能回答三件事: 這是什麼、根據哪一派、有多確定。對應 `Finding` 的 `body`、`schoolNote`、`confidence`。
4. **語氣依 `tag` 分級**:
   - `source`: 「傳統上認為…」(不寫「會」「一定」)。
   - `inference`: 加「推論」徽章,並寫「這是依五行/位置推得的說法,沒有直接的古籍依據」。
   - `minority`: 「少數流派主張…,本 App 預設不採用」。
   - `design`: 「這是本 App 的排序方式,僅供整理空間的參考」。
5. 不保證任何結果,不做因果斷言(「漏財」是象徵說法,沒有科學證據);不構成投資、理財、醫療或婚姻建議。
6. **避免恐嚇字眼**: 主結果頁不用「大凶」「絕嗣」「克妻」「敗財」作結論句。需要引用傳統原詞時放在「傳統說法」摺疊區並附脈絡。原稱「建議換屋」(伏吟)一律改寫為「此格局傳統上較難調整,建議請專業老師到現場評估」。
7. 流派分歧要老實說: 「各派看法不一,本 App 預設採台灣常見的 X,你可以在設定改成 Y」。
8. 不確定就說不確定: 手機誤差、接近山界、立春臨界、命卦年界都要主動提示,不顯示假精度(不顯示 0.1°)。
9. 用台灣用語與繁體字: 坐向、財位、命卦、羅盤;避免簡體與大陸用語(同類 App 因簡體字被打 2 星)。
10. 不用分數當結論。`wealth` 的 0-100 分只用來排序,顯示時轉成「較適合 / 可以考慮 / 不建議」三段,並註明「分數不可跨設定比較」。

### 5.2 術語括號解釋(第一次出現時使用)

| 術語 | 白話 |
|---|---|
| 坐向 | 房子的背(坐)與面(向);站在屋內面朝外的方向叫「向」 |
| 24 山 | 把 360 度切成 24 等分的方位名,每份 15 度(如「子山」是正北) |
| 命卦 | 依出生年與性別算出的個人方位組別,分東四命、西四命 |
| 宅卦 | 依房子坐向算出的房屋組別,分東四宅、西四宅 |
| 命宅相配 | 你的命卦組別與房子組別相同 |
| 財位 | 傳統上認為適合放置催財或保持整潔的位置 |
| 明財位 | 進門後斜對角的牆角(依空間形狀判斷) |
| 暗財位 | 依房子方位與星盤推算出的位置 |
| 流年 | 每一年的方位運勢,以立春為一年開始 |
| 飛星 / 玄空飛星 | 一種把九個數字(星)依規則排進九個方位的傳統推算法 |
| 元運 / 九運 | 每 20 年一個週期,2024 年 2 月起是第九運 |
| 山星 / 向星 / 運星 | 山星傳統上看人丁與健康,向星看財運,運星是這一運的基準數字 |
| 旺山旺向、上山下水、雙星會向、雙星會坐 | 四種盤面格局;白話說明見 5.4 模板 |
| 下卦 / 兼向 / 替卦 | 方位正中(下卦)或偏向鄰近方位(兼向);兼向偏太多時傳統上換一套排法(替卦) |
| 空亡 | 方位剛好壓在兩個方位的交界線上,傳統上建議避開或重測 |
| 磁北 / 真北 | 羅盤指的北(磁北)與地圖的北(真北),台灣兩者差約 5 度 |
| 太歲 / 歲破 | 當年地支所在方位與其正對面,傳統上動土裝修要留意 |
| 三煞 | 每年有一個方位較忌動土,依年份不同 |
| 五黃 / 二黑 | 兩顆傳統上需要留意的星,宜靜不宜動 |
| 伏吟 / 反吟 | 盤面數字與原位相同或相反的特殊格局 |
| 遊年八星(生氣、延年、天醫、伏位、禍害、六煞、五鬼、絕命) | 八宅法對八個方位的分類,前四個傳統上視為吉位 |

### 5.3 結果頁固定結構(建議)

1. 你家的方位(向、坐、宅卦、可信度與是否接近分界)。
2. 你的命卦組別與相配情形。
3. 財位(明財位、暗財位、今年加分),每張卡片一句白話 + 為什麼 + 有多確定。
4. 玄空盤(進階展開)。
5. 今年留意方位(太歲、三煞、五黃、二黑)。
6. 傳統說法與少數派(摺疊)。
7. 免責聲明(頁底固定)。

### 5.4 模板

**玄空格局**(來源 xuankong_patterns.md 1.9 A 表,語氣依 5.1 調整):

| 格局 | 白話 |
|---|---|
| 旺山旺向 | 傳統上認為人丁星在後方、財星在前方。後方有靠、前方開闊或見水,較適合;反過來使用則不利。 |
| 上山下水 | 傳統上認為人丁星與財星的位置顛倒,需要反著用(後方見水或空、前方有山),此格局建議請專業老師評估。 |
| 雙星會向 | 傳統上認為旺星集中在前方(向首),偏旺財。向首見水或明亮開闊的氣口較有利;人丁較弱,久居的房間可在後方補實。 |
| 雙星會坐 | 傳統上認為旺星集中在後方(坐山),偏旺人丁。後方要有靠又有水景較兼顧;財位可靠向首補氣口。財星在後方,需後方見水或動水才有財。 |
| 全局伏吟/反吟 | 傳統上視為較特殊的格局,伏吟較難調整;反吟在當運且形巒配合時仍可用,退運則要留意。建議請專業老師到現場評估。 |

**宅命不配**: 「你的命卦屬於西四命,這間房子屬於東四宅。傳統上的做法是**以你自己的吉方為主**來安排床頭、書桌與灶口,大門若不能動,至少讓大門、主臥、灶口三項中有一項落在你的吉方。」

**方位不確定**: 「量到的方向落在午山與丙山的交界附近(距界 2.5°)。手機羅盤可能有 5° 以上誤差,建議靠窗重量 3 到 5 次,或請老師用專業羅盤複核。」

**空亡與各派差異**: 「方位剛好壓在山與山的交界線上。傳統上稱為『空亡』(各派定義不同,這裡採『山界=小空亡、卦界=大空亡』的說法),建議重量。」

**磁北真北**: 「本 App 預設用磁北,和實體羅盤一致。台灣的磁北比真北偏西約 5 度,你可以在設定改用真北,兩種讀法結果不同時會並列顯示。」

**九運水火(通則)**: 「有老師提出九運北方宜見水、南方宜見山(來源沒有提到南方忌水)。每間房子仍要看自己的盤。」

**感測器狀態**: 見 2.9.5 狀態表。

### 5.5 免責聲明

- **結果頁底部固定(主要語句)**: 「風水是華人的傳統民俗文化,這些財位建議是整理與佈置空間的參考,不保證任何財運結果,也不構成投資或理財建議。」(wealth_position.md 2.8)
- **每張卡片短版**: 「傳統民俗參考,請勿過度迷信。」
- **設定頁文化說明**: 「不同流派對財位的看法並不一致,本 App 預設採台灣常見的『進門對角』說法,並提供『玄空』等進階檢視。」
- **八宅頁**: 「以上為傳統上的說法,實際運用還需配合房屋座向、外環境與室內擺設綜合判斷。」(依 bazhai.md 6.9 與舊引擎免責改寫)
- **玄空頁**: 「實際勘宅需專業風水師親至現場,包含外部環境、形勢與納氣。」(舊引擎 `_disclaimer` 意旨)
- **測量頁**: 「手機羅盤適合判定 24 山等級,不適合更細的分金;附近有金屬或鋼筋時誤差可能更大。」
- 所有擺設與催財建議屬民俗或象徵性質,文案不宣稱有科學效果(wealth_position.md 2.5)。

---

## 6. 已知與舊引擎的差異清單

舊引擎: 舊版八宅引擎 `divine_bazhai`、舊版玄空引擎 `divine_xuankong`(本專案之外的舊程式)。本次**未修改任何舊檔**。診斷數字取自 bazhai.md、xuankong_core.md、xuankong_patterns.md 與三份複查(複查者以 AST 抽出舊表/函式唯讀執行重算,結果與研究報告完全一致)。

### 6.1 divine_bazhai.py

| # | 位置 | 舊行為 | 新規格 | 影響與證據 |
|---|---|---|---|---|
| B-1 | `BAZHAI_MAP`(80-129) | 64 格中 **18 格錯**,8 個命卦皆有。乾、兌、離、震、巽、坎六卦是「生氣/天醫」對調(各 2 格共 12);艮、坤兩卦是「生氣→延年→天醫→生氣」三角輪轉(各 3 格共 6)。表不對稱(乾看艮=生氣,艮看乾=延年等 4 對:艮-兌、艮-乾、坤-兌、坤-乾),違反兩兩配對 | 用 2.3.2 產生規則生成,對稱、拉丁方、東西四同組 | 全是吉位錯誤。伏位 8/8、凶位 32/32 正確(wealth_position.md)。修法: 整表刪除改用爻變序列生成 |
| B-2 | `calc_ming_gua`(41-65) | 只有 1900 年代公式 `(100-yy)`/`(yy-4)`;**2000-2099 年 200/200 組全錯**(2000 男應離、舊得坎;女應乾、舊得艮);1864-1899 年 72/72 錯;1900-1999 0 錯 | 封閉式 `男 mod9(2-Y)`、`女 mod9(Y+4)`,Y 為立春校正後的干支年 | 見 2.3.3 A |
| B-3 | `calc_ming_gua` | **完全沒有立春判斷**,只吃西曆年整數;無出生時刻、時區、1938-1945 +09:00 | `calendar.toInstant` + `fengshuiYear`,`yearBoundary` 開關,臨界旗標 | 例: 2000-01-15 出生(立春前)應算 1999 年、2000-02-04 傍晚 20:40 前出生也應算 1999 年,舊引擎一律以西曆年 2000 計 |
| B-4 | `calc_ming_gua` | 5 入中直接改寄,無 `rawNumber` | 保留 `rawNumber` 供文案 | 見 2.3.3 A |
| B-5 | `HOUSE_BY_SIT`(147-156)與 `get_house_camp` | 只有 8 個方位字串對應,**沒有 24 山、度數→坐山換算**,沒有處理「大門朝向 vs 建築朝向」 | `geo.sitFromFacing` + `guaAt`(邊界半開區間,角度先正規化);宅向/門向分開輸入 | 見 2.1.6、2.3.3 B |
| B-6 | `analyze` 的 `LEVEL_ORDER`(284)與 `BAZHAI_MAP` 等級 | 生氣、延年、天醫 全標「大吉」,伏位「吉」 | 傳統上吉、上吉、中吉、小吉;延年/天醫先後有分歧,可調權重 | D14 |
| B-7 | `DIRECTION_ACTIVITY`(133-142)、`JIEHUA_BY_STAR`(208-249) | 用途混合位置與朝向(「床位」「辦公桌」不分);生氣「客廳沙發、魚缸、招財植物」隱含「首選生氣位」;五帝錢、泰山石敢當、桃木劍等化解物為民俗說法 | 用途矩陣位置/朝向分開(2.3.4);沙發魚缸四吉位不分先後;灶座/灶口分開;民俗化解物本次研究**未查證**,不得直接沿用為規格,需標「民俗」並另行審稿 | 複查 R24 refuted;R13 |
| B-8 | `analyze(year, gender, sit_direction)` | 輸入只有出生年整數與方位字串;無家庭多人、無夫妻處理 | `household[]` + `coupleBasis` | 2.3.5 |
| B-9 | `evidence.citations` | 標示《八宅明鏡》化煞篇、宅卦篇等章節名 | 本次只讀到第一風水網的一個版本(含現代加註),章節名未能對照影本 | 不得把這些 citation 當已核對出處(bazhai.md 6 第 4 點) |

舊引擎 18 個差異格(命卦 / 方位 / 舊值 → 正確值):

| 命卦 | 方位 | 舊 → 正 | 命卦 | 方位 | 舊 → 正 |
|---|---|---|---|---|---|
| 乾 | 東北 | 生氣 → 天醫 | 坎 | 東 | 生氣 → 天醫 |
| 乾 | 西 | 天醫 → 生氣 | 坎 | 東南 | 天醫 → 生氣 |
| 兌 | 西南 | 生氣 → 天醫 | 艮 | 西南 | 天醫 → 生氣 |
| 兌 | 西北 | 天醫 → 生氣 | 艮 | 西 | 生氣 → 延年 |
| 離 | 東 | 天醫 → 生氣 | 艮 | 西北 | 延年 → 天醫 |
| 離 | 東南 | 生氣 → 天醫 | 坤 | 東北 | 天醫 → 生氣 |
| 震 | 北 | 生氣 → 天醫 | 坤 | 西 | 延年 → 天醫 |
| 震 | 南 | 天醫 → 生氣 | 坤 | 西北 | 生氣 → 延年 |
| 巽 | 北 | 天醫 → 生氣 | | | |
| 巽 | 南 | 生氣 → 天醫 | | | |

以上 18 格即 bazhai.json `legacy_regression` 的 18 個星格案(新引擎輸出不得等於舊值);另 6 案是舊 `calc_ming_gua` 錯誤年份。

### 6.2 divine_xuankong.py

| # | 位置 | 舊行為 | 新規格 | 影響與證據 |
|---|---|---|---|---|
| X-1 | `SHAN_YINYANG`(86-103) 與註解(82-85) | **8 山陰陽寫反**: 子、卯、午、酉標陽(應陰);寅、巳、申、亥標陰(應陽)。註解三元龍分類「地元含寅申巳亥、人元為天干」與來源不符 | 見 2.1.1、2.4.1: 地元=壬丙甲庚辰戌丑未、天元=子午卯酉乾坤艮巽、人元=癸丁乙辛寅申巳亥 | 5 個以上獨立來源一致;只修表仍只有 60/216 盤正確 |
| X-2 | `get_shan_xiang_pan`(121-198),山盤順逆(144、149) | 直接用**坐山自己的陰陽**決定順逆,**缺二次轉換**(入中星先回本宮,取與坐山同元龍的伴山看陰陽) | 2.4.2 第 2 步 | 只修演算法(保留舊表)104/216;不轉換的天真寫法 156/216 格局不同 |
| X-3 | 同上,向山選取(156-164) | 用「對宮內與坐山同陰陽的第一座山」當向山(坐子取到丙而非午);向盤順逆同樣缺二次轉換 | 向山 = 24 山環 +12(對山,同元龍同陰陽) | |
| X-4 | 同上,5 入中 | 無特殊處理,但因直接用山自身陰陽,「碰巧」與正確規則一致 | 明文規定 5 入中用山自身陰陽(2.4.2) | 整體仍不對 |
| X-5 | 以上合計 | 216 個公開盤只有 **52 個(24%)** 正確;格局判定 164/216(76%)與正確算法不同;九運 24 山全錯、八運 18 錯;例: 八運子山午向離宮舊 山8向7(應 8/8 雙星會向)、九運壬山丙向離宮舊 山9向8(應 9/9);舊碼會判「九運癸山丁向=旺山旺向」,但九運沒有旺山旺向 | | 消融實驗: 只修表 60/216,只修演算法 104/216,兩者都修 216/216(xuankong_core.md 2.10;xuankong_patterns.verify.md R1 重現 164/24/18) |
| X-6 | `get_yun`(53-57)、`NINE_YUN`(25-35) | 以**西曆整年**查表,不看立春;`>2043` 一律回傳九運(應為 2044 立春後一運);`<1864` 一律回傳一運(應循環);2043 年底才換運的假設與「九運到 2044-02-04 12:44」不符 | `calendar.nineYun`;2044-02-03 全日與 02-04 上午仍是九運 | **實跑驗證 `get_yun(2044)`、`get_yun(2045)` 仍回傳九運**(annual 複查) |
| X-7 | `analyze(year, ...)`(255-342),264-265 | 以「查詢年」推運當作排盤的運,`year` 同時是查詢年與入運年 | `chartYun`(建成年/入運)與 `currentYun`(今日)分開(2.4.4) | 老宅(八運屋在九運)會被排錯盤 |
| X-8 | `assess_star`(237-252) | 旺氣(d=0)、生氣(1)、進氣(2,「中吉」)、退氣(3,4,5,「凶」)、死氣(6,「大凶」)、煞氣(7,「大凶」)、d=8 中平 | 新規格 `default`: d0 旺、d1 近旺生、d2 遠旺生、d8 退氣(0 分)、d7/6/5 煞衰、d4/3 死(2.4.8) | 舊標籤把剛退運的 d=8(如九運八白)標「中平」,把 d=3-5 標「退氣」,與所有公開標法(default/S1/S2)不符;舊等級無來源 |
| X-9 | `detect_special_pattern`(201-234) | 四大格局**定義正確**(與中州派相同),但輸入盤面錯誤而失真;`pattern=None` 時無說明 | 保留判定式(2.4.5),格局窮盡 | 缺: 全局伏吟反吟、合十、三般卦、七星打劫、城門、星組合、財丁位 |
| X-10 | `analyze` 的 `ji_dirs/xiong_dirs`(288-292) | 由運盤(只有運星)的 `assess_star` 決定吉凶方位 | 吉凶看山向運三數與格局,不只看運盤 | |
| X-11 | 無 | 沒有度數輸入、兼向、替卦、空亡、入運年(大修)、磁北真北 | geo + xuankong 2.4.3、2.4.4 | 舊 `_disclaimer` 自承「城門訣、替卦、合十、伏吟反吟卦等進階斷盤未實作」 |
| X-12 | 保留 | `fly_star_lo_shu`(洛書順序、順逆飛布)正確;`SAN_24`、`PALACE_OPPOSITE` 分組正確 | 可沿用邏輯,但常數由 geo 表生成 | |
| X-13 | `evidence.citations` | 標示《沈氏玄空學》起例篇、斷盤訣等章節名 | 本次未取得《沈氏玄空學》原文(xuankong_core.md 8 第 1 點) | 不得把這些 citation 當已核對出處 |

---

## 7. 仍未解決的問題與建議處置

| ID | 問題 | 影響 | 建議處置 |
|---|---|---|---|
| U-01 | annual 沒有研究報告與複查檔(此主題未產生獨立報告檔);規則僅在 annual.json meta 與複查摘要中 | 文件可追溯性 | 由整合者依 annual.json meta 補寫 `annual.md` / `annual.verify.md`;規格以本檔 2.5 為準 |
| U-02 | 力士、月煞(及其他神煞)算法未整理進 fixtures | 額外神煞功能缺 | 不實作;`extraShensha` 只含夾煞;需要時先補來源 |
| U-03 | 台灣民間實務的年界比例無統計 | 預設年界的通行度 | 預設 `lichun_exact` 並在 UI 顯示兩種年界結果差異提示;上線後蒐集使用者回饋 |
| U-04 | 沈氏玄空學替卦與 ±4.5° 原文未取得;陰陽互兼/出卦 5° vs 6°;空亡帶寬 ±1.5/2.5/3°;大小空亡位置式 vs 度數式;下卦端點(恰 4.5°)慣例 | 兼向與空亡文案 | 預設 + 開關(D02-D04),UI 標學派,端點附「騎線」;請玄空老師裁決 |
| U-05 | 平台實機: iOS `webkitCompassHeading` 直立時行為與量化階數;Android WebView(Chromium ≥151/152)`requestPermission` 是否已出貨;WKWebView 是否需 `NSMotionUsageDescription`;`screen.orientation.angle` 映射;原生外掛回真北或磁北 | 感測器可靠度、審核 | 「存在就呼叫 + watchdog」;建議加 `NSMotionUsageDescription`;v1 鎖直式;建立實機測試矩陣(iPhone/Android 各 2-3 機型,含鋼筋大樓) |
| U-06 | 風水界磁北/真北: HKET「玄空要真角度」全文取不到,只有 vocus 一個風水來源(主張保留古法) | 預設基準 | 預設磁北 + 真北開關;向專業老師收集意見 |
| U-07 | plan 太極點定義(重心/外框中心)、缺角與凸出判定、玄關處理:無來源 | 宮位歸屬,尤其不規則平面 | 預設面積重心;請風水老師審稿;缺角/凸出先不實作 |
| U-08 | 流年凶星壓在明財位的處置;財位放水/重物/電器分歧;職業別流年財位(單一來源);英文與西式(BTB)財位 | 財位建議細節 | 只做扣分與警語;預設不建議;標分歧 |
| U-09 | 財位排序權重、環境乘數、角區 1.0m、`centerBand` 10%、6% 並列門檻、多人命卦策略皆設計值 | 排序穩定性 | 使用者測試後校準;UI 用三段標籤不用分數 |
| U-10 | **老宅 `chartYun` 與 `currentYun` 分離時的旺衰基準**(本檔整合推論,報告未直接寫明) | 老宅(如八運屋在九運)的財丁位判讀 | 玄空老師確認;結果頁顯示提示 |
| U-11 | 坐向雙位表、紫白坐山表的出處與選星原則 | 兩表預設關閉 | 追原典;找到後可能成為某流派的合法規則 |
| U-12 | 全局反吟的凶度說法不一(ZGGDFS 視旺衰、SOHU 表不標記);伏吟反吟扣分值 -3/-1 為工程值 | 玄空評分 | 預設條件式;待專業老師拍板 |
| U-13 | 七運 12 個盤原本只有摘要來源(複查已補 5 個以上直接旁證,信心升 high);一至六運名單為程式推導(信心 中);64 局打劫清單只有陳炳聿單一完整來源;12 張艮坤組打劫類盤未列入 | 名單型結論 | 列入資料時標來源與信心 |
| U-14 | 未實作: 山向對宮合十/形局合十、64 卦翻卦法、城門「同元純清」、地運長短公式 | 進階功能 | 第一版不做 |
| U-15 | 房間用途規則(二五宮不放廚房、衛生間不放旺星宮、辦公桌選財位)無來源 | 房間建議 | 一律標「推論」徽章 |
| U-16 | luopan: 120 分金八干四維規則(單源)、64 卦錨點(單源)、節氣環逐項對位(單一)、28 宿版本(開禧,兩來源同源)、九星色(單一)、實機繪製效能、字型 `fsType` 與子集大小與 205 字涵蓋 | 盤面細節 | 依 2.8 降級處理;字型嵌入前開檔驗證 |
| U-17 | 2051-2100 立春誤差可達 2.96 分;2044 年為預測值(各站相差約 6 分) | 分鐘級臨界 | 標臨界旗標,日期不受影響 |
| U-18 | 大修(換運)判準與入運依據無共識 | 排盤運別 | UI 顯示「流派意見」,選項明確 |
| U-19 | 農曆春節年界需農曆庫;`lunar-javascript` 本次未驗證 | `lunar_new_year` 選項 | 引入前以 2.2.3 第 6 點的 4 個春節日期與 annual.json 干支年驗證 |
| U-20 | 台灣 1937-1945 年 +09:00 的精確轉換日與 `Intl` 在 WebView 的可用性 | 舊出生資料 | 由 tzdata 產生偏移表並以 8 年結果核對 |
| U-21 | 客廳沙發東西四分級(單一現代加註)、《八宅明鏡》只讀到一個網頁版本(床章朝向語單版本) | 八宅細節 | 預設不採用分級;取得第二版本前信心維持中 |
| U-22 | 九運水火通則(南山北水)為 4 個來源轉述,「南忌水」為推論 | 文案 | 只寫來源實際說的話(D48) |

---

## 附錄 A. 複查更正逐條處理表

狀態: **[已更正]** = 本檔已改寫規則或指定 fixtures 修正;**[未解決]** = 來源無法裁決,已給預設與開關;「無需更正」= 複查確認無誤。

### A.1 bazhai(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| BZ-1 | refuted: 客廳沙發魚缸「首選生氣、次選伏位」 | 刪除通則;四吉位不分先後;東西四分級只作可選開關;財位序仍生氣>延年>天醫 | [已更正] | 2.3.4、D22 |
| BZ-2 | uncertain: 年界預設 lichun_exact 及各派歸屬(白如雪/研易人士/周易人命網) | 通行度敘述改為「以立春為界為主流;精確到分為引擎嚴謹選項」;`lichun_date_only` 列為「多數文章的做法」 | [已更正](敘述);[未解決](台灣實務比例,U-03) | 2.2.3 第 7 點、D10 |
| BZ-3 | uncertain: 位置與朝向分開;古法床只論位置 | 改「古法兩說並存」;仍分兩區輸出 | [已更正] | 2.3.4 |
| BZ-4 | uncertain: 星等級預設 | 預設不變,可調權重,`tianyiFirst` | [未解決] | D14 |
| BZ-5 | 135 案 0 案數值錯誤 | 無需更正 | 無需更正 | 4.1 |
| BZ-6 | 覆蓋缺口 1: 無 1938-1945 +09:00 案 | 規格寫明轉換;補案見附錄 B.1 | [已更正] | 2.2.3 第 4 點、B.1 |
| BZ-7 | 覆蓋缺口 2: 無扇區邊界案(22.5+45k)與 24 山邊界 | 半開區間定案;補案 B.1 | [已更正] | 2.3.3 B、B.1 |
| BZ-8 | 覆蓋缺口 3: 立春日無時刻旗標、負角度/超 360 | 加 `alternatives` 旗標與正規化;補案 B.1 | [已更正] | 2.2.3 第 5 點、2.3.3 B、B.1 |
| BZ-9 | 臨界案例結論不變;HKO 取分是四捨五入 | note 註明四捨五入分 | [已更正] | 2.2.1 |
| BZ-10 | usage note 稱 qqqs 只支持位置,實查有床章朝向語 | note 同步修正 | [已更正] | 2.3.4 |
| BZ-11 | 補充: 「考生」「學齡」措辭;只看戶主;延年桃花;偽碼補齊與角度正規化;2051-2100 有 PyEphem 佐證 | 全部改寫 | [已更正] | 2.3.4-2.3.6、2.2.1 |

### A.2 xuankong_core(reliable)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| XC-1 | uncertain: 下卦/兼向度數,端點含 4.5 | 定案含端點,附「騎線」;其餘度數分歧見 U-04 | [已更正](預設);[未解決](端點慣例本身) | 2.4.3、D02 |
| XC-2 | fixtures: 3 個 `locate_edge_*`(low)不宜當硬性斷言 | 改軟斷言 | [已更正] | 4.1 |
| XC-3 | 立春表 1864 改 20:11、1884 改 16:49,2044 寫 12:44 | 廢止硬編表,交給 calendar(重算 1864 20:11:45、1884 16:49:12、2044 12:44:06) | [已更正] | 2.2.1 |
| XC-4 | R9 措辭「主流以落成年」 | 改「多數科普文章預設落成年」 | [已更正] | 2.4.4 |
| XC-5 | R12 A 表信心 medium→high | 升 high | [已更正] | 2.4.1 |
| XC-6 | 空亡文案標學派 | 標玄空(中州派)說法 | [已更正] | 2.1.3 第 8 點、5.4 |
| XC-7 | 磁偏角符號方向 | 東偏為正,真=磁+D,寫進註解與測試 | [已更正] | 2.1.5 |
| XC-8 | AI 生成第三方速查表(voidforall)陰陽表錯 | 明文禁止引用 | [已更正] | 2.4.1 |
| XC-9 | 中州派實測盤圖 93 個(報告寫 80,計法差異) | 非錯誤 | 無需更正 | |

### A.3 xuankong_patterns(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| XP-1 | refuted: 伏吟/反吟預設(全局反吟只提示不扣分) | 全局反吟一律警示;旺山旺向且星為當運才不扣,否則小幅扣分 | [已更正] | 2.4.7、D29 |
| XP-2 | refuted: 財位公式(向星旺宮直接=旺財位;表頭「向星9(旺財)」) | 依格局分流;欄名改 `xiang9_at` | [已更正] | 2.4.10、D30 |
| XP-3 | refuted: 星組合(一六文昌 high、四四文昌、五九毒藥、三七穿心煞) | 一六降 medium 改標;四四移除文昌;五九改名;三七穿心煞列未驗證別名 | [已更正] | 2.4.9 |
| XP-4 | uncertain: 看盤優先順序、運星權重 0.3 | 維持可調,標工程預設 | [未解決] | D33 |
| XP-5 | uncertain: 八白在九運 0 分,`eightKeepsWealth` | 開關標「少數派」並補 zs4 反向說法 | [已更正](標示);[未解決](預設值) | 2.4.8、D28 |
| XP-6 | uncertain: 城門位與可用性 | 只顯示不進主評分;註明與 SINA-HESHI 不同義 | [已更正](註記);[未解決](可用性規則) | 2.4.6、D32 |
| XP-7 | uncertain: 房間用途規則 | 全部標「推論」 | [未解決] | 2.4.12、U-15 |
| XP-8 | uncertain: 地運長短公式 | 第一版不做 | [未解決] | U-14 |
| XP-9 | uncertain: 山向對宮合十/形局合十 | 不實作 | [未解決] | U-14 |
| XP-10 | fixtures: pair_tag 一六(high→medium)、四四(移除/存疑)、五九(改名)、三九(加備註) | 依 2.4.9 修正 | [已更正] | 附錄 B.3 |
| XP-11 | fixtures: qi 81 筆標 medium → low 並註明工程上限;chengmen_use 補 note;chart 7 筆部分欄位需 meta 註明;wealth9 欄位改名 | 依 4.1、附錄 B.3 | [已更正] | 2.4.8、B.3 |
| XP-12 | 其他: zs33 口訣措辭過寬;七運信心升 high;連數三般補 zs36;地運長短補 zs62 | 全部改寫 | [已更正] | 2.4.5、2.4.6 |

### A.4 wealth_position(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| WP-1 | uncertain: 大門財位=生氣位;財運排序 生氣>延年>天醫>伏位(延年>天醫無來源) | 標設計值,`tianyiFirst` 開關 | [未解決] | 2.3.3 E、D19 |
| WP-2 | uncertain: 流年立春換年、2026 立春 04:01:51 | 交節時刻交給 calendar;備註「立春前約 1 分鐘」;不再宣稱「天文台曆表一致」 | [已更正] | 2.2.1、2.6.9 |
| WP-3 | uncertain: 流年財星價值(九紫 0.8 無來源) | 標「九紫=當運旺星加分,非傳統財星」,可調 | [未解決](數值);[已更正](標示) | 2.6.7、D41 |
| WP-4 | uncertain: 九運水火「南忌水」 | 改標推論 | [已更正] | 2.6.8、D48 |
| WP-5 | uncertain: 財位候選排序啟發式 | 明標設計 | [未解決] | 2.6.7、U-09 |
| WP-6 | uncertain: L 型/不規則 | 維持最遠 90° 角 + 手動指定 | [未解決] | 2.6.3、D50 |
| WP-7 | uncertain: 門沖 50% | 改兩級 80%/50% | [已更正] | 2.6.5、D49 |
| WP-8 | fixtures 備註: `liunian_lichun_boundary_minute_level`、`door_chong_aligned`、`score_star_value_tables`(二黑)、`liunian_occupation_layer_2024`(星數對應為推得)、`xk_9yun_chou_shan_wei_xiang_chart`(升 high,限不含替卦兼向)、`shop_*` 加櫃檯左側靠牆、看中國表描述「延年與絕命互換」 | 依附錄 B.4 | [已更正] | 2.6.6、B.4 |
| WP-9 | 引用更正: 「龍邊高於虎邊」只有潮紫微,518 應刪 | 刪除 518 引用 | [已更正] | 2.6.6 |

### A.5 orientation(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| OR-1 | uncertain: 空亡(卦界大、山界小);`kongwangKind` 對山界一律 xiao | 同時輸出位置式與度數式,同性相兼超限另有 `kongxiang` | [已更正] | 2.1.3 第 8 點、D04 |
| OR-2 | uncertain: 「向」的取法預設 | 產品政策,維持低信心與三候選確認 | [未解決] | 2.1.6、D07 |
| OR-3 | uncertain: 手機羅盤精度,uncertainty 預設 3.0 | App 層預設 5.0;純函式仍 3.0 | [已更正] | 2.1.7、D05 |
| OR-4 | uncertain: 是否校正磁偏角 | 預設磁北;平台回傳基準已由原始碼確認為磁方位 | [未解決](政策);[已更正](平台基準) | 2.1.5、D06 |
| OR-5 | uncertain(報告遺漏): 兼向區與替卦的關係 | 新增 `needsTiGua` | [已更正] | 2.1.3 第 7 點 |
| OR-6 | fixtures: `sitFromFacing` 7.399999999999977 浮點雜訊;`circularMean` 6 位小數 | 容差 1e-9 / 1e-5 | [已更正] | 4.1 |
| OR-7 | fixtures: `kongwangKind` 同性相兼案 xiao 為單一派 | 標 school-specific | [已更正] | B.5 |
| OR-8 | fixtures: 覆蓋缺口(同陽只測乾/亥、出卦 3 條卦界、缺 `uncertainty=max(3,2σ)`) | 補「48 個有向界線各取 adev=5.5 與 6.5」自動生成集與多次量測案例 | [已更正] | B.5 |
| OR-9 | 註記: 36fengshui 兼向清單另有兩條筆誤(午子兼丙午、丙午兼午子,應為午子兼丙壬、丙壬兼午子) | 記入 fixtures verification 欄 | [已更正] | B.5 |

### A.6 annual(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| AN-1 | refuted: 三煞 75° 弧與「1 整宮+兩側各半宮」描述 | 拆 core3(45°)/withJiaSha(75°)/branch12(90°);UI 文字「整宮+兩側鄰宮各 1/3」;預設 core3 | [已更正] | 2.5.2 第 7 點、D39 |
| AN-2 | uncertain: 主流 vs 民間分類(夾煞/力士/月煞單一來源) | 預設關;力士月煞不實作 | [已更正](預設);[未解決](力士月煞規則,U-02) | 2.5.2 第 8 點 |
| AN-3 | fixtures 缺口 1: monthly 缺「辰戌丑未年起始 5」組;缺口 2: 月柱五虎遁只測兩個年干組 | 補 9 個 monthly 與 5 個月柱向量(本次已用參考實作重算 14/14 一致) | [已更正] | B.2 |
| AN-4 | fixtures 缺口 3: `taisui_sansha` 的 `sanshaArcFrom/To` 把夾煞算入 75° | 改存 core3 與 withJiaSha 兩組欄位 | [已更正] | B.2 |
| AN-5 | 2023 立春邊界格官方表 1 分歧義 | fixtures 註記,容差 2 分吸收 | [已更正] | 2.5.3 |
| AN-6 | usno_2100 冬至、usno_2075 秋分標 medium 合理 | 無需更正 | 無需更正 | |
| AN-7 | 舊引擎 `get_yun(2044/2045)` 仍回九運(實跑) | 列入第 6 節 | [已更正] | X-6 |
| AN-8 | annual.md 與 annual.verify.md 未寫入 | 見 U-01 | [未解決] | 0.2 |

### A.7 luopan_rings(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| LP-1 | refuted: 「所有字底組合 ≥4.5:1(最低 4.77)」 | 限 lacquer_800/900 底;五行色提亮後三種底皆 ≥4.5 | [已更正] | 2.8.7、D64 |
| LP-2 | refuted: 手機版 r5 節氣環寬 12.4px 放不下 2 字徑向堆疊 | r5 加寬到 0.125R(22.5px),其餘等比縮;`layout_rings_A_solarterms` 降 medium | [已更正] | 2.8.6 |
| LP-3 | refuted: 字型表(Apple Kaiti/BiauKai) | 改 iOS 與 macOS 皆 downloadable;BiauKai 僅列 iOS;TW-Kai fsType 標未驗證 | [已更正] | 2.8.9 |
| LP-4 | uncertain: 120 分金八干四維沿用前一位地支 | 標低信心,UI 只顯示地支山 | [未解決] | 2.8.4、D58 |
| LP-5 | uncertain: 64 卦環圓圖序與「乾盡午中」錨點 | 預設不放 | [未解決] | 2.8.5、D59 |
| LP-6 | fixtures 1: 卦名「無妄」與 unicode 鍵「无妄」不一致;2: 坤 end 0.0 | 統一「無妄」(U+4DD8);end 360.0 | [已更正] | 2.8.5 |
| LP-7 | fixtures 3: `palette_contrast` 缺 lacquer_700/600 | 補 4 個案例 | [已更正] | 2.8.7、B.6 |
| LP-8 | fixtures 4-5: r5 環寬;`xiu28_narrow_labels_360px` 基準不一致 | 統一 R=180,min_deg 4.93 | [已更正] | 2.8.6 |
| LP-9 | fixtures 6: fenjin120 三處依賴單源規則 | 加 `confidence:'low'` | [已更正] | 2.8.4 |
| LP-10 | fixtures 7: 子集字表缺字 | 補 山宮朝、色名字、環名字,或明講不嵌 | [已更正] | 2.8.9 |
| LP-11 | fixtures 8: 「iOS15 約 384MB」無來源、「TW-Kai 205 字」未驗證 | 標未驗證 | [已更正] | 2.8.8、2.8.9 |
| LP-12 | 手勢程式碼 bug(停頓後放手誤甩) | 放手時 `>80ms` 則 `om=0` | [已更正] | 2.8.8 |

### A.8 device_compass(needs-fixes)

| # | 複查內容 | 處理 | 狀態 | 位置 |
|---|---|---|---|---|
| DC-1 | uncertain: R5 50/40 遲滯自動切換 | 改 smoothstep 混合;附跳變量化 | [已更正] | 2.9.2、D66 |
| DC-2 | uncertain: R7 Chromium `requestPermission` 版本/WebView 矛盾 | 「存在就呼叫 + watchdog」 | [未解決] | 2.9.5、U-05 |
| DC-3 | uncertain: R9 專案設定(Info.plist、Capacitor 8 需求) | 建議加 `NSMotionUsageDescription`;Capacitor 8 需求已確認 | [未解決](plist 是否必要) | 2.9.6、U-05 |
| DC-4 | uncertain: R15 螢幕方向映射 | v1 鎖直式 | [未解決] | 2.9.6 |
| DC-5 | uncertain: R17 風水界磁北/真北 | 預設磁北 + 開關 | [未解決] | 2.1.5、U-06 |
| DC-6 | iOS `webkitCompassHeading`「頂端為基準」只放平時成立,信心不應是 high | 降中;iOS 只在 tilt ≤50° 採信 | [已更正] | 2.9.1 |
| DC-7 | fixtures: group7 依賴 JS `Math.round` 半數進位 | 明文 `Math.floor(x+0.5)` | [已更正] | 2.9.4、1.3 |
| DC-8 | fixtures: group13、group11 是自訂映射,confidence 應 low/medium | 標示 | [已更正] | 2.9.6 |
| DC-9 | fixtures: 缺 `webkitCompassHeading=360`、accuracy 欄位、tilt=50° 且 gamma=10/20/30 | 補案(本次已重算混合值) | [已更正] | B.7 |
| DC-10 | fixtures: group8 依賴 24 山幾何由其他主題負責 | 只驗算術,幾何由 geo 測試 | 無需更正 | 4.1 |

---

## 附錄 B. fixtures 修正與新增向量(供整合者更新;本次未動任何 fixtures)

下列「已重算」向量由本次整合用參考實作計算,與複查提供的數值一致(或為本次新增)。

### B.1 bazhai.json 補案

| 名稱 | 輸入 | 預期(lichun_exact) | 說明 |
|---|---|---|---|
| minggua_birth_1940-02-05T0800_+0900 | `birth_local=1940-02-05T08:00:00`、`utc_offset=+09:00`,男/女 | 換算 07:00 CST,早於 1940 立春 07:07,有效年 1939: 男 兌(raw 7)、女 艮(raw 8) | 1938-1945 +09:00 換算;若誤當 +08:00 會得 1940 |
| minggua_birth_1940-02-05T0830_+0900 | `08:30`、`+09:00`,男/女 | 07:30 CST,晚於立春,有效年 1940: 男 乾(raw 6)、女 離(raw 9) | 同上(1940 立春: annual 參考實作 07:07:10、bazhai 表 07:07:14) |
| minggua_birth_2000-02-04_timeUnknown | `birth_local=2000-02-04`、`timeKnown=false`,男/女 | `flags.dateIsLichunDay=true`;`alternatives`: 立春前 1999 男 坎/女 艮,立春後 2000 男 離/女 乾(2000 立春 20:40) | 立春日不知時刻 |
| zhai_boundary_facing_22.5 / 22.4999 | facing 22.5 / 22.4999 | 坤宅(sit 202.5) / 離宅(sit 202.4999) | 半開區間 |
| zhai_boundary_facing_157.5 / 157.4999 | facing 157.5 / 157.4999 | 坎宅(sit 337.5) / 乾宅 | 同上 |
| zhai_boundary_facing_337.5 / 337.4999 | facing 337.5 / 337.4999 | 離宅(sit 157.5) / 巽宅 | 同上 |
| zhai_facing_-300 | facing -300 | 正規化為 60,sit 240,坤宅 | 負角度正規化 |

另: `minggua_birth` 臨界案 note「HKO 16:27」註明為四捨五入分;usage note 依 2.3.4 修正。

### B.2 annual.json 補案與修正

| 名稱 | 輸入(UTC+8) | 預期 |
|---|---|---|
| monthly_2024-02-20 | 2024-02-20 12:00 | 風水年 2024 甲辰,月柱 丙寅,月中宮 5 |
| monthly_2024-03-20 | 2024-03-20 12:00 | 丁卯月,月中宮 4 |
| monthly_2024-07-20 | 2024-07-20 12:00 | 辛未月,月中宮 9 |
| monthly_2025-01-20 | 2025-01-20 12:00 | 屬甲辰年丑月,丁丑,月中宮 3 |
| monthly_2027-02-20 | 2027-02-20 12:00 | 丁未年 壬寅月,月中宮 5 |
| monthly_2027-07-20 | 2027-07-20 12:00 | 丁未月,月中宮 9 |
| monthly_2028-01-20 | 2028-01-20 12:00 | 屬丁未年丑月,癸丑,月中宮 3 |
| monthly_2021-02-20 | 2021-02-20 12:00 | 辛丑年 庚寅月,月中宮 5 |
| monthly_2030-02-20 | 2030-02-20 12:00 | 庚戌年 戊寅月,月中宮 5 |
| month_stem_2024/2028/2029/2023/2022 | 各年 2 月 20 日 12:00 | 寅月月柱 丙寅(甲辰年)、甲寅(戊申年)、丙寅(己酉年)、甲寅(癸卯年)、壬寅(壬寅年) |

`taisui_sansha` 12 案的 `sanshaArcFrom/To` 欄位改存 `core3`(三個 15° 山)與 `withJiaSha`(75°)兩組;2023 立春邊界格加註「官方表有 1 分歧義」。

### B.3 xuankong_patterns.json / xuankong_core.json 修正

- `pair_tag`: 一六 → confidence medium、nature 視旺衰、標籤「一六(水金相生;失令主水淫天門)」;四四 → 移除文昌標籤(nature 存疑,low);五九 → 標籤「五九(火生五黃)」(low);三九 → 標籤加「個性偏刻薄」(low)。
- `qi` 81 筆: confidence 改 low,note 註明 星2 的 0.5 與 星5 的 -3 是工程上限。
- `chengmen_use` 31 筆: note 補「單一作者簡化規則,與 SINA-HESHI 八運子山午向『有城門可用』不同義」。
- `chart` 中 7 筆「辰山戌向 運N 星盤(來源前兩列)」只有部分欄位(缺 face、sitPalace、facePalace、shanCenter、xiangCenter、shanForward、xiangForward),meta 註明,harness 對缺欄位不報錯。
- `wealth9`: `xiang9` 欄名改 `xiang9_at`、`shan9_at`,note 註明雙星會坐盤向星 9 在坐宮不算旺財。
- xuankong_core `locate_edge_340.5/349.5/352.5`: 標軟斷言。

### B.4 wealth_position.json 修正

- `liunian_lichun_boundary_minute_level` note 改「立春前約 1 分鐘」。
- `door_chong_aligned` 依 80% 門檻(重疊比 0.81 仍為 true),另補 50-80% 「輕微偏移」案例。
- `score_star_value_tables` note 註明二黑 -0.2 與 108s「遠生氣」衝突。
- `liunian_occupation_layer_2024` 星數對應為推得(low 正確)。
- `xk_9yun_chou_shan_wei_xiang_chart` 升 high(限不含替卦與兼向)。
- `shop_*` 補 `leftSideAgainstWall` 欄位。
- 來源 28(看中國)備註改「延年與絕命互換」。

### B.5 orientation.json 修正與補案

- 比較容差: `sitBearing` 1e-9,`circularMean` 的 `r`/`stdDeg` 1e-5(或把 187.4 案期望改為 7.4)。
- `kongwangKind` 同性相兼超限案(「子山 6.5°」「乾山 322.2°」)加 `schoolSpecific:true`,並補 `kongwangKindDegree:'kongxiang'`。
- 自動生成集: 48 個有向界線各取 `adev=5.5` 與 `6.5`(期望值由與研究者不同的獨立實作以 Fraction 精確算術產生);補同陽相兼 艮/寅、坤/申、巽/巳;補出卦的其餘 5 條卦界與 `chugua` 且 `level=jian` 案;補 `uncertainty=max(3,2σ)` 多次量測案例。
- verification 欄補記 36fengshui 兩條筆誤(午子兼丙午、丙午兼午子,應為午子兼丙壬、丙壬兼午子)。

### B.6 luopan_rings.json 修正

- `hexagram64_xiantian_circle_order`: 「無妄」統一、坤 end=360.0。
- `palette_contrast` 補: wx_fire on lacquer_700 = 4.39(舊色不合格)、on lacquer_600 = 3.94(不合格)、wx_water on 700 = 4.53、on 600 = 4.06(不合格);新色 wx_fire `#EC6A57` on 800/700/600 = 5.99/5.52/4.95、wx_water `#6A9CDC` = 6.55/6.04/5.41。並把「所有字底組合 ≥4.5」改為「限 lacquer_800/900 底(新五行色則三種底皆過)」。
- `layout_rings_A_solarterms`: confidence high→medium,依 2.8.6 新表。
- `xiu28_narrow_labels_360px`: `mid_radius_px` 統一,`min_deg` 4.93(R=180)。
- `fenjin120_lookup_337.5`、`fenjin120_lookup_7.5`、`fenjin120_table` 八干四維 12 山: `confidence:'low'`。
- `charset_for_font_subset`: 補 山、宮、朝(及可選色名字、環名字)。

### B.7 device_compass.json 補案

- decode: `webkitCompassHeading=360` → headingDeg 0、status ok;`NaN` → invalid;accuracy=-1 且 heading=0 → uncalibrated;無 accuracy 欄位 → ok(accuracyDeg=null)。
- 平滑混合(alpha=0;已用 `compass-core.mjs` 的 `eulerHeadings`/`tiltDeg` 加 smoothstep 重算,heading 度):

| γ | tilt 40° | 45°(β) | 50° | 55° |
|---|---|---|---|---|
| 10° | 0.000 | 352.892(β=44.109) | 346.898 | 347.761 |
| 20° | 0.000 | 345.537(β=41.194) | 333.482 | 335.321 |
| 30° | 0.000 | 337.500(β=35.264) | 319.254 | 322.382 |

  斷言: 各列隨 tilt 連續(γ ≤30° 時相鄰 0.1° 傾角航向變化 < 1°,最大 0.67°);tilt ≤40° 時等於頂端方位 0。
- group11、group13 的 confidence 標 low/medium(報告自訂映射)。

---

## 附錄 C. 索引

- 研究報告與複查: `docs/research/`(bazhai、xuankong_core、xuankong_patterns、wealth_position、orientation、luopan_rings、device_compass 各一份報告與一份 `.verify.md`;annual 無)。
- fixtures: `test/fixtures/`(8 檔,共 1,789 案: annual 191、bazhai 135、device_compass 99、luopan_rings 72、orientation 179、wealth_position 71、xuankong_core 568、xuankong_patterns 474)。
- 內嵌在 fixtures 的可執行資產: `annual.json` → `meta.referenceImplementation.source`(calendar 核心)、`meta.testRunner.source`(node 執行器);`bazhai.json` → `meta.lichun_cst_1900_2100`(立春交叉表);其餘參考實作在各報告的 JS 程式碼區塊: orientation.md 2.5、xuankong_core.md 2.7、xuankong_patterns.md 1.10、device_compass.md 2.10、luopan_rings.md 2.4-2.6。
- 重現本次整合重算: 抽出 annual.json 兩段 source 存成 `fengshui-annual.js` 與 `run_fixtures.mjs`,`node run_fixtures.mjs annual.json ./fengshui-annual.js` 應輸出 `fixtures: 191/191 pass`。


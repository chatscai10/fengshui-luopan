# 簡單模式與白話指北針 規格 (EASY_SPEC)

- 讀者:實作與維護簡單模式的工程師。本檔是**唯一依據**:畫面文字一律照本檔逐字實作,不得自行發明文案;本檔沒寫到的文字,先補進本檔再實作。
- 前置閱讀:`docs/UI_SPEC.md`(設計原則、tokens、畫面契約)、`docs/API.md`(`analyzeHouse`、`renderReport`)、`docs/research/device_compass.md`(手機指北針的精度)。
- 範圍:新增「簡單模式」(預設開啟)、讓手機指北針看得懂、誠實回答「準不準」;專業模式的羅盤頁加上白話讀數。引擎(`src/core/*` 除 `copy.js` 以外)一律不改。

---

## 0. 問題與對策

使用者在手機上用過後的回饋:「有點複雜,而且指北針我也看不懂,準不準?」

| 回饋 | 根因(已對照程式確認) | 對策 |
|---|---|---|
| 有點複雜 | 一打開就是十幾圈的傳統羅盤;5 個分頁都是專業內容;標題列摘要「丑山未向 · 九運盤」是術語 | 預設進入**簡單模式**:3 步(量方向 → 選格局 → 看財位),不顯示分頁列與標題摘要,每個畫面只有一個主按鈕 |
| 指北針看不懂 | 讀數是「向 0.0° / 子山(坎宮 · 天元)· 坐 午」;盤面跟著手機轉,看不出「我家朝哪」 | 簡單模式用只有 8 個中文方位的**方向圈**,大字寫「西南方」;專業羅盤頁最上面加一行白話「紅線指著:西南方」 |
| 準不準 | 只有「訊號良好」燈號與 σ 數字,沒有說手機能準到什麼程度、對結果有沒有影響 | 三層誠實回答:① **穩定度**(「拿得很穩」不等於「很準」,iPhone 自己估計的誤差也算進去)② **自我檢查**(移一步再量,兩次差多少)③ **對結果有沒有影響**(大門朝哪一方每格 45 度;排第一的財位會不會換,實際把朝向在誤差範圍內重算確認);另有共用說明面板「手機指北針準嗎?」,最上面先給結論 |

---

## 1. 設計取捨

**骨架**
- 簡單模式是**獨立畫面** `#/easy`(`src/ui/views/easy.js`),不改寫羅盤分頁;模式由網址決定,只有 `main.js` 的 `navigate()` 寫入 `ui.mode`。
- 路由規則、感測器狀態機、白話方位、「方向差幾度會不會換財位」等判斷全部抽成**純函式**(`src/ui/easy/*` 等),可以用 node 測試;畫面只負責組裝。
- 各模組的檔案與職責見第 7 節。既有測試不改,新行為一律加新測試。

**其他採用的做法**
- 第一次使用者流程:站在屋內離大門一步量;大字只寫大方位(「南方」),偏向放在括號小字;加 8 方位方向圈;方位只在換格時才念給讀屏;格局加問「大門在左邊、正中間、右邊」(進門斜對角通常跟著大門位置變);只在「沒有平面圖」或「平面圖是簡單模式產生且沒被改過」時才產生平面圖,使用者自己畫的圖絕不覆蓋;會覆蓋舊資料的動作都附「復原」;舊使用者第一次看到簡單模式時跳一次說明;年份接受民國年並即時顯示換算。
- 指北針準確度:燈號改成白話原因句,不說「很準」;「移一步再量」的自我檢查(兩次、必要時三次,自動排除離群的一次);iPhone 自己估計的誤差算進判斷;「手機差幾度,會不會影響結果?」逐項說明,財位那一項實際重算確認;「手機指北針準嗎?」面板(先給結論,再教移一步再量、用地圖對一次);LINE 等 App 內建瀏覽器的提示;自己選 8 方位時以半格寬(22.5 度)當誤差。

**否決的做法與原因**

| 否決 | 原因 |
|---|---|
| 結果頁用引擎的 `geo.retest` 決定要不要叫人重量 | `retest` 是「離 24 山分界 < 誤差」:預設誤差 5 度時,約三分之二的方向都會觸發(每山 15 度只有中間 ±2.5 度不觸發),簡單模式會一直叫人重量。改看「排第一的財位會不會換」(8.12)與 8 方位分界(`eightImpact`,誤差 ≤ 7.5 度時與引擎的 `bazhai.house.boundary.nearGuaBoundary` 完全一致);24 格的細節不在簡單模式顯示 |
| 把自我檢查的差距只顯示、不送進引擎 | 畫面說「接近分界」而報告沒提醒,會互相矛盾。改為把差距存進 `facing.check`,由 `store.input()` 納入不確定度(第 6 節) |
| 燈號叫「準確度:好」 | 燈號只量得出讀數晃不晃,量不出整棟鋼筋造成的整體偏差,叫「準確度」會誇大。改成講手有沒有晃(「手拿得很穩」),Android 另外說明「穩不代表準」,並在說明面板講清楚它看不出什麼 |
| 白話方位寫「正南方」 | 手機誤差通常 5 度以上,「正」會暗示做不到的精度。改成「南方」「南方(稍微偏西)」 |
| 羅盤分頁依模式分派兩種畫面 | 羅盤頁是風險最高的畫面(手勢、慣性、感測器交錯)。簡單模式另開畫面,羅盤頁只加白話行 |
| 建成年份獨立成一步(4 步流程) | 多一步就多一次放棄的機會。改放在結果頁「想看更完整的分析?」卡片,就地填寫(並說明這個方法對方向比較敏感) |
| 修改 `views/wealth.js`、`views/plan.js`、`plan/templates.js` 以共用文字或縮圖 | 這些檔服務完整功能,改了會影響專業畫面。改由 `src/ui/easy/*` 重用它們的**匯出**(唯讀 import),缺的東西在 easy 模組另寫;`canvas/miniPlan.js` 只新增一個預設關閉的選項 |
| 簡單模式裡編輯平面圖、填住戶 | 超出「一次一件事」。一律導向完整功能 |
| 財位那一項一律寫「不受指北針影響」 | 只有進門斜對角那個角落的**位置**不看度數;結果頁顯示的是排第一的候選,分數有七成看方位(每個角落落在哪個方位、玄空的 24 格),方向差幾度就可能換成另一個角落。改成實際把朝向在 ±U 範圍內重算比對(8.12),會換才提醒 |

---

## 2. 準確度的誠實說明(事實基礎)

以下每一項都已對照程式或研究文件確認,文案(第 5.4 節)只能講這裡列出的事實。

### 2.1 手機指北針的誤差

| 事實 | 出處 | 信心 |
|---|---|---|
| iPhone 網頁讀 `webkitCompassHeading`(磁北),另有 `webkitCompassAccuracy`(±度數,−1 表示未校準)。Apple 文件的範例值是 ±10 度 | `device_compass.md` 0.2、2.7 | 高 |
| Android 網頁讀 `deviceorientationabsolute`(磁北),**拿不到精度欄位**,只能用近 1 秒讀數的晃動(圓周標準差 σ)判斷 | `device_compass.md` 0.3、2.7;`sensor.js` 的 `sigmaDeg` | 高 |
| 燈號門檻:iPhone 精度 ≤10 綠、≤25 黃、<0 或 >25 紅;σ ≤2 綠、≤4 黃、>4 紅;兩者取較差 | `SENSOR_DEFAULTS.accuracyGreenMax/accuracyYellowMax/sigmaGreenMax/sigmaYellowMax`、`qualityLight()`。全部是設計值,尚未用實機資料調整 | 中 |
| 鎖定:3 秒(`settings.lockSeconds`)× 20 Hz;少於 20 筆為 too-few,σ > 3 度為 unstable;傾斜 ≥ 15 度或螢幕朝下不能鎖定 | `lockAverage`、`lockAllowed`、`SENSOR_DEFAULTS.lockMinSamples/lockMaxStdDeg/lockMaxTiltDeg` | 高(門檻為設計值) |
| 燈號只看得出讀數穩不穩,**看不出系統偏差**(例如整棟鋼筋讓每筆讀數一起偏);平均後的不確定度也不會照 σ/√N 縮小 | `device_compass.md` 2.6 第 4 點 | 高 |
| 手機適合判定到 24 山等級,不適合分金等更細的格子 | `DISCLAIMERS[2]`、`device_compass.md` 2.7 第 5 點 | 中 |
| 一般誤差量級「5 到 10 度」 | Apple 範例 ±10 度;App 預設誤差 `measureUncertainty` = 5 度 | 中 |
| iPhone 回報的誤差要算進判斷 | `summarizeLock` 已算出 `uncertaintyDeg = max(設定, 2σ, 鎖定期間精度最大值)`;簡單模式把它存進 `facing.check.accuracyDeg`,`store.input()` 與畫面都用同一個 U | 高 |
| Android 的 σ 幾乎永遠很小 | 絕對方位來自陀螺儀融合、已濾波的 rotation vector(`device_compass.md` 2.2、2.7),磁力計沒校準時也可能很穩,所以「穩」不代表「準」 | 高 |

### 2.2 各結果需要多準(對照引擎程式)

| 結果 | 依賴 | 程式證據 | 需要的精度 |
|---|---|---|---|
| **明財位的位置**(進門斜對角,預設 `wealthProfile:'mingcai'`) | 只看平面圖上大門的位置與房間形狀 | `src/core/wealth/geometry.js` 完全不讀方位;`wealth.js` 只在 `sectorOfPoint` 判斷這個角落屬於哪一個方位時用到 `planUpBearing` | **角落的位置不受度數影響**;度數會影響「它在房子的哪個方位」與候選排序 |
| **排第一的財位**(簡單模式結果頁顯示的 `wealthTop[0]`) | 候選的分數:幾何 0.3、玄空 0.25、八宅 0.15、本命 0.15、流年 0.15(`score.js PROFILES.mingcai`);後四項看角落落在哪個方位 | 用 `store.report()` 每 1 度掃一圈:4 個範本 × 3 種大門 × 有無年份全部都會隨方向換第一名;±5 度就會換的方向,兩房無年份約 59/360、有年份約 154/360 | **會受方向影響**,有年份時更敏感;所以實際重算確認(8.12) |
| 八宅宅卦與吉位、平面圖八方位 | 大門朝向(`bazhaiFacing = doorUsed ?? facingUsed`)→ 8 卦,每格 45 度 | `analyze.js`、`bazhai.zhaiFromFacing`;接近分界的旗標 `bazhai.house.boundary.nearGuaBoundary` = 離卦界 < max(誤差, 3 度) | **8 方位,每格 45 度** |
| 玄空飛星盤 | 宅向所在的 24 山 | `analyzeBearing` → `mountainAt`;`xuankong` 只在有建成年份時才排 | **24 山,每格 15 度**;`geo.retest` = 離山界 < 誤差 |

誠實結論(寫進文案):手機誤差通常 5 到 10 度 → 對 8 個大方位通常夠用,只有靠近分界時不夠(差 5 度時約 8 成的方向不受影響,差 10 度時約一半);對玄空的 24 格常常不夠;進門斜對角那個角落的**位置**不受影響,但**哪個角落排第一**會受影響,所以結果頁實際重算,會換才提醒。

### 2.3 磁北與真北

- 本 App 預設存與算的都是**磁北**(`northMode:'magnetic'`),和傳統羅盤一致。(信心: 高)
- 台灣磁偏角約 −4.3 度(高雄)到 −5.1 度(基隆)(`geo.CITY_DECLINATIONS`)。`true = magnetic + 偏角`,所以**同一個方向,本 App(磁北)的度數比手機地圖(真北)大約 4 到 5 度**。(信心: 高)
- iPhone 內建「指南針」App:多數說法是預設開啟「使用真北」(需要定位服務),開啟時它的度數會比本 App 小約 5 度;但查到的來源互相矛盾,Apple 說明只寫可以開或關。(信心: 低)**所以文案不假設預設值,而是教使用者看自己的設定**,兩種情況各講一句。

### 2.4 自我檢查的門檻

| 項目 | 值 | 依據 |
|---|---|---|
| 兩次「一致」 | 差 ≤ `settings.measureUncertainty`(預設 5 度) | 設定值;羅盤頁既有教學「幾次差超過 5 度就重量」(`compass.js` HOW_TO) |
| 兩次「差很多」 | 差 > 15 度 | 設計值:剛好一個 24 山的寬度 |
| 三次時排除離群值 | 恰有一對 ≤ 一致門檻、第三次和兩者都 > 一致門檻 → 排除第三次 | 設計值 |
| 送進引擎的誤差 U | `max(measureUncertainty, 2σ, iPhone 估計誤差, 兩次差距)`;自己選的 8 方位為 `max(measureUncertainty, 22.5)` | 延用 `geo.measurementUncertainty` 的 `max(基準, 2σ, accuracy)`,再加上差距;8 方位存的是該格正中間,真正方向可能在半格(22.5 度)內任何地方 |
| 只量一次時的結論 | 讀數晃(σ > 3)→ `single-unstable`;iPhone 估計誤差 > 10(綠燈門檻)→ `single-wide`;手機不回報誤差(Android)→ `single-noacc`;其他 → `single-ok` | `SENSOR_DEFAULTS.accuracyGreenMax`;只量一次而且沒有警告(含 Android 的 `single-noacc`)時主按鈕是「下一步」,「再量一次」是小連結,結論句收在「看說明」 |
| 8 方位「接近分界」 | 離 8 方位分界(22.5 + 45k 度)< max(U, 3) | 與引擎 `nearGuaBoundary` 同門檻(`GUA_HINT_MIN_DEG = 3`)。U ≤ 7.5 時兩者完全一致;U > 7.5 時引擎只看「最近的山界剛好是卦界」,會漏掉離卦界 7.5 到 U 度的情況,簡單模式較嚴格(較誠實),所以簡單模式的畫面一律用 `eightImpact`,不讀引擎旗標 |
| 24 山「接近分界」 | 離山界 < U | 與引擎 `geo.retest` 同式 |
| 排第一的財位會不會換 | 朝向在 [b − U, b + U] 每隔 ≤ 1.5 度重算 `analyzeHouse`,比對 `wealthTop[0]` 的 id 與評等 | 8.12;1.5 度抓得到每一次 8 方位(45 度)與 24 山(15 度)換格 |

---

## 3. 模式與路由

### 3.1 狀態欄位
- `ui.mode: 'easy' | 'pro'`,`DEFAULT_STATE.ui.mode = 'easy'`。舊存檔沒有這個鍵,`normalize()` 的 `{...base.ui, ...raw.ui}` 會自動補成 `'easy'`:**新舊使用者更新後第一次開啟都是簡單模式**。之後記住上次用的模式。
- `ui.easyStep: 'facing' | 'layout' | 'result'`(簡單模式停在哪一步);`ui.easyLayout: {template, doorSide} | null`;`ui.easyIntroShown: boolean`。
- **只有 `main.js` 的 `navigate()` 寫 `ui.mode`**。切換鈕、設定面板、畫面內按鈕都只改網址。

### 3.2 路由規則(`src/ui/route.js` 的 `resolveRoute`)

| 網址 hash | 結果 |
|---|---|
| `#/easy` | 簡單模式 |
| `#/compass`、`#/house`、`#/plan`、`#/wealth`、`#/report` | 完整功能的該分頁 |
| 空白或不認得 | `ui.mode === 'pro'` → 完整功能的 `proHomeOf(ui)`(`ui.tab` 合法就用它,否則 `compass`);否則簡單模式 |

- `navigate()` 在 hash 空白或不認得時,用 `history.replaceState(null, '', '#/easy')`(或 `#/<分頁>`)把網址補正,這樣從完整功能按「上一頁」會回到 `#/easy`。
- 從主畫面圖示開啟時網址沒有 hash(`start_url: ./`),依上次模式開啟。
- `ui.tab` 只記完整功能的分頁;簡單模式不寫 `ui.tab`。

### 3.3 切換入口

| 位置 | 簡單模式時 | 完整功能時 |
|---|---|---|
| 標題列按鈕 `#btn-mode`(在設定齒輪左邊,`.btn .btn-sm .btn-ghost`,高 ≥ 44px) | 文字「完整功能」;`aria-label`「切換到完整功能:羅盤、住宅、平面圖、財位、報告五個分頁」;點了 `location.hash = '#/' + proHomeOf(ui)` | 文字「簡單模式」;`aria-label`「切換到簡單模式:三個步驟看財位」;點了 `location.hash = '#/easy'` |
| 設定面板最上面「介面」分組 | 分段控制「簡單模式 / 完整功能」,說明文字見 5.6。切換後改網址並關閉設定面板 | 同左 |
| 簡單模式結果頁 | 沒有「完成」按鈕;「看專業版分析(名詞較多)」→ `ctx.go('wealth')` 收在「看詳細說明」裡 | — |

- 兩種模式共用同一個 store:任何一邊輸入的資料,另一邊立刻看得到。
- 從完整功能切回簡單模式時,依 `resumeStep(state)`(第 8.6 節)停在該停的步驟。
- **舊使用者第一次看到**:`ui.easyIntroShown !== true` 且 `facing.bearing` 已有值時,進入簡單模式跳一次 toast(文案 `intro.toast`),然後寫入 `ui.easyIntroShown = true`。

### 3.4 外殼在簡單模式的變化(B 實作)
- `<html data-mode="easy|pro">`:`navigate()` 每次設定;`index.html` 的內嵌腳本在載入時先依 hash 與存檔預設一次,避免分頁列閃一下。
- 簡單模式隱藏:底部分頁列 `.tabbar`、標題摘要 `.app-sub`;`--tabbar-h` 設為 0(toast 才會貼近底部)。
- 無障礙:簡單模式時 `#view` 移除 `role="tabpanel"` 與 `aria-labelledby`,改設 `aria-label="簡單模式"`,並清空分頁列;完整功能照舊。
- 寬度 < 360px 時,完整功能的 `.app-sub` 也隱藏(放不下,且是術語)。

---

## 4. 使用者流程總覽與線框(375px 寬優先)

**每個畫面的原則**:一句短標題 + 最多一行短說明 + 一個大按鈕 + 最多兩個小連結;主按鈕在 375×812 不用捲動就看得到。其他說明、數字、檢查、例外情況一律收進「看說明」摺疊區(`<details class="v-card-more v-easy-fold">`,預設關閉)。會影響結果的提醒(大門接近兩個方位中間、方向差一點財位會換)仍然出現在畫面上,但只用一行短句。

```
開啟 App ──(簡單模式)── resumeStep ─┬─ 沒有朝向 ─────────────→ 步驟 1 量方向
                                    ├─ 有朝向、沒有平面圖 ───→ 步驟 2 選格局(可跳過)
                                    └─ 有朝向、有平面圖 ─────→ 步驟 3 看財位

步驟 1:1A 開始量 →「開始量」→ 1B 量測中 →「就是這個方向」→ 1C 取平均 3 秒 → 1D 量完(需要時再量 1–2 次比對)
        └ 不能用指北針 / 權限被拒 / 偵測不到 → 1M 自己選方向
        └ 已有朝向時回到步驟 1 → 1S 已記下
步驟 2:2A 選範本 + 大門在左/中/右 ;2B 已有自己畫的平面圖
步驟 3:財位卡(圖 + 位置 + 這樣用)→ 看詳細說明(評等、檢查、其他位置、年份、專業版)→ 重新量方向 / 修改格局
```

### 共用外框(每一步)
```
┌──────────────────────────────────┐
│ 風水羅盤         [完整功能] [⚙ 設定] │  ← 標題列,摘要隱藏;齒輪旁有「設定」字樣
├──────────────────────────────────┤
│ ●量方向 ─ ○選格局 ─ ○看財位        │  ← 步驟條(已完成的可點回去)
│                                  │
│ 一句標題                          │
│ 最多一行說明                      │
│ [      主按鈕(56px 高)        ] │  ← 每畫面只有一個 .btn-primary
│    小連結        小連結           │  ← 最多兩個,觸控範圍 ≥ 44px
│ ▸ 看說明                          │  ← 預設關閉
└──────────────────────────────────┘      (沒有底部分頁列)
```

### 1A 開始量
```
│ 站在大門口,手機平放,頂端朝門外    │
│        (示意圖:人、手機、門)      │
│ [          開始量               ] │
│ iPhone 會問要不要允許,請按允許     │  ← 只有 iPhone
│  不能量?自己選方向  手機指北針準嗎? │
│ ▸ 看說明                          │
```

### 1B 量測中
```
│ 慢慢轉身,讓頂端對準門外            │
│            ▼ 手機頂端              │
│        ╭────北────╮               │  ← 方向圈:8 個中文方位,
│     西北          東北             │    整圈旋轉,目前方位的
│    西     西南方      東           │    45 度扇形淡金色
│     西南          東南             │
│        ╰────南────╯               │
│            西南方                  │  ← 大字楷體,只寫大方位
│           約 215 度                │
│ [        就是這個方向           ] │
│   ! 有點晃,手機放平、不要動        │  ← 固定一行高,只有讀數有問題或按下被擋時才有字
│          改成自己選方向            │
```

### 1D 量完
```
│ 大門朝:西南方                     │
│ ! 剛好在西南方和南方中間,換個位置… │  ← 只有需要時一行(已量 3 次時改說「結果僅供參考」)
│ [          下一步               ] │  ← 需要重量時是「再量一次」
│             再量一次               │
│ ▸ 看說明(度數、每次讀數、結論、   │
│   手機差幾度會不會影響結果)        │
```

### 1M 自己選方向
```
│ 大門朝哪個方向?                   │
│ 站在門內看出去,門外是哪一邊?     │
│ ┌──────┬──────┬──────┐           │
│ │ 西北 │  北  │ 東北 │           │  ← 每格 ≥ 64px 高
│ ├──────┼──────┼──────┤           │
│ │  西  │ 你家 │  東  │           │  ← 中間格不可點
│ ├──────┼──────┼──────┤           │
│ │ 西南 │  南  │ 東南 │           │
│ └──────┴──────┴──────┘           │
│ ▸ 知道確切度數?                   │
│ [           下一步              ] │
│ 手機指北針準嗎?  再試一次手機指北針 │  ← 權限被拒時不放「再試一次」
│ ▸ 看說明                          │
```

### 2A 選格局
```
│ 你家比較像哪一種?                 │
│ ┌──────────────┐ ┌──────────────┐ │
│ │ ▭ 套房        │ │ ▭ 2 房 1 廳   │ │  ← 縮圖 + 名稱 + 坪數
│ │ 約 10 坪      │ │ 約 19 坪      │ │
│ └──────────────┘ └──────────────┘ │
│ 站在屋內看大門,門在:              │  ← 選了範本後才出現
│ [ 左邊 | 中間 | 右邊 ]             │
│ [          看財位               ] │
│     都不像,跳過      上一步        │
│ ▸ 看說明(大門位置的說明、大預覽)  │
```

### 3 看財位
```
│ 你家的財位                         │
│ ┌ 平面縮圖:房間、大門、金色「財」┐  │
│ └──────────────────────────────┘  │
│ 站在屋內、面向大門時:              │  ← 位置用到前後左右時
│ 客廳的後方右邊角落                 │  ← 大字
│ 這樣用:保持整潔,不放垃圾桶、鏡子  │
│ ! 方向差一點,可能換到次臥 1  重新量 │  ← 只有會換時(只寫房間)
│ ▸ 看詳細說明                       │
│ [ 重新量方向 ] [ 修改格局 ]        │
│ 傳統民俗參考,請勿過度迷信。       │
```

---

## 5. 畫面規格與逐字文案

### 5.0 文案的放置規則
- **操作文字**(標題、說明、按鈕、錯誤、提示)放在 `src/ui/easy/text.js` 的 `EASY_TEXT`,鍵名即本節表格的「鍵」欄。`{名稱}` 是代入值,由 `fillText(key, vars)` 代換。
- **與量測相關、兩種模式共用的文字**(穩定度、姿勢提示、鎖定被擋)放在 `src/ui/sensorText.js`。
- **風水結論與「對結果有沒有影響」的句子**一律放在 `src/core/copy.js`(第 8.9 節),或直接取引擎/`renderReport`/`views/wealth.js` 既有文字。
- 數字格式:度數顯示用整數 `Math.floor(x + 0.5) % 360`(寫作「約 215 度」);差距與 σ 取 1 位小數以內(`2`、`2.5`,去掉 `.0`)。
- 方位名一律用 `geo.DIR8` 的「北、東北、東、東南、南、西南、西、西北」,後面加「方」。

### 5.1 共用外框

| 鍵 | 文字 |
|---|---|
| `steps.label` | 步驟 |
| `steps.facing` | 量方向 |
| `steps.layout` | 選格局 |
| `steps.result` | 看財位 |
| `steps.back` | 回到第 {n} 步:{name}(`aria-label`) |
| `intro.toast` | 已切到簡單模式。原本的完整功能在右上角「完整功能」。 |
| `mode.toPro` | 完整功能 |
| `mode.toProAria` | 切換到完整功能:羅盤、住宅、平面圖、財位、報告五個分頁 |
| `mode.toEasy` | 簡單模式 |
| `mode.toEasyAria` | 切換到簡單模式:三個步驟看財位 |
| `common.undo` | 復原 |
| `common.back` | 上一步 |
| `common.dir` | {dir}方 |
| `common.more` | 看說明 |
| `view.aria` | 簡單模式(`#view` 在簡單模式的 `aria-label`,由 main.js 設定) |

- 步驟條:`<nav aria-label="步驟"><ol>`,3 項。目前這一步 `aria-current="step"`;有朝向後,每一項都是可點的按鈕(`aria-label` 用 `steps.back`);沒有朝向時只有第 1 項可用。步驟條下面不再寫「第 N 步,共 3 步」。
- 每畫面只有一個 `.btn-primary .btn-block`(`.v-easy-big`:高 56px、字 18px),375×812 不用捲動就看得到。次要動作是小連結(`.btn.btn-ghost.v-easy-link`,文字加底線,觸控範圍 ≥ 44px),同一列最多兩個。
- 「看說明」摺疊區:`<details class="v-card-more v-easy-fold">`,標題 `common.more`(結果頁用 `r.more`),預設關閉;量字數時不算已關閉摺疊區裡的字。
- 一行短句(`.v-easy-one`):會影響結果的提醒加 `.is-warn`(警告色,前面有「!」圖示,不只靠顏色)。
- 換步驟:`store.update(d => { d.ui.easyStep = step; })`,畫面內重畫並捲回頂端,焦點移到新步驟的標題(`tabindex="-1"`)。
- 會覆蓋舊資料的動作都跳 toast 並附「復原」:`toast(msg, { action: { label: EASY_TEXT['common.undo'], onClick } })`。

### 5.2 步驟 1:量大門朝向

進入步驟 1 時依狀態顯示下面其中一種。感測器只在 1B/1C 開著;離開步驟 1 或 `destroy()` 時一律 `session.destroy()`。

- 從結果頁的「重新量方向」或提醒旁的「重新量」進來 → **1A**(使用者明確要重量)。
- 其他情況下已有朝向(步驟條點回來、重開 App 停在步驟 1)→ **1S**。
- 沒有朝向:沒有 `DeviceOrientationEvent`(`sensorSupported(window)` 為 false)→ **1M**,並顯示 `m.noSensor`;否則 → **1A**。
- 「手機指北針準嗎?」(`a.help`,小連結)只放在 1A 與 1M(有 `DeviceOrientationEvent` 時);結果頁的「看詳細說明」裡再放一次。

#### 1A 開始量

| 鍵 | 文字 |
|---|---|
| `a.title` | 站在大門口,手機平放,頂端朝門外 |
| `a.step1` | 站在屋內、離大門一大步(約 1 公尺),面向大門。 |
| `a.step2` | 手機平放在胸前,螢幕朝上,手機頂端朝向大門外。 |
| `a.step3` | 先拿掉磁吸手機殼,也離鐵門、冰箱、冷氣遠一點。 |
| `a.start` | 開始量 |
| `a.starting` | 啟用中… |
| `a.iosNote` | iPhone 會問要不要允許,請按允許 |
| `a.manual` | 不能量?自己選方向 |
| `a.help` | 手機指北針準嗎? |

- 由上到下:標題、示意圖(內嵌 SVG,`aria-hidden`,一個人站在門內一步,手機平放,箭頭指向門外)、大按鈕 `a.start`、只有 iPhone/iPad(`DeviceOrientationEvent.requestPermission` 是函式,而且 `window` 沒有 `ondeviceorientationabsolute`;Android Chrome 有這個事件)才在按鈕下方一行 `a.iosNote`、小連結 `a.manual` 與 `a.help`、「看說明」(`a.step1`–`a.step3` 的清單)。
- 「開始量」必須在點擊處理函式裡**同步**呼叫 `session.start()`(iOS 權限視窗的要求),之前不可 `await`、不可先重畫。
- 「手機指北針準嗎?」→ `openCompassHelp(ctx, store.get())`(第 5.4 節)。

#### 1B 量測中(`session.getState().phase === 'running'`)

| 鍵 | 文字 |
|---|---|
| `b.title` | 慢慢轉身,讓頂端對準門外 |
| `b.pointer` | 手機頂端 |
| `b.reading` | 讀取中… |
| `b.degree` | 約 {deg} 度 |
| `b.live` | 手機頂端朝向{text} |
| `b.lock` | 就是這個方向 |
| `b.stop` | 改成自己選方向 |
| `b.dialAria` | 方向圈,手機頂端目前朝向{dir}方 |
| `b.warnWide` | 誤差有點大,離鐵門、電器遠一點 |
| `b.warnBad` | 誤差太大,離金屬遠一點,畫幾個 8 字 |
| `b.warnJitter` | 有點晃,手機放平、不要動 |
| `b.warnJumpy` | 讀數一直跳,離金屬遠一點,畫幾個 8 字 |
| `b.warnCalib` | 還沒校準,拿著手機畫幾個 8 字 |
| `b.warnWait` | 正在判斷,手機放平、不要動 |

- 方向圈:`mountDirDial`(第 8.8 節),`set(顯示方位)`;`prefers-reduced-motion` 時不做過渡。
- 大字(楷體 40px):`common.dir`(只有大方位,例如「南方」);沒有讀數時 `b.reading`。下一行小字 `b.degree`(不寫磁北/真北,這兩個詞只在說明面板的細節裡解釋)。
- 高度 ≤ 640px 的螢幕(例如 320×568):方向圈縮到 150px、大字 30px、標題 18px,間距縮成 8px,讓「就是這個方向」和方向圈同時在第一個畫面。
- 讀屏:另一個 `aria-live="polite"` 的元素,**只在 `plainDirection` 的 `dir8` 或 `level` 改變、而且停住 350ms 後**才更新成 `b.live`。
- 按鈕下方**唯一的一行**(`role="status"`,警告色,沒有字時也固定留一行高,字出現或消失時主按鈕與連結都不跳):
  - 讀數提醒:讀數正常(`accuracyView(reading).level === 'green'`)時沒有字;`postureHint(reading)` 有值(太斜、螢幕朝下)時顯示它,否則依 `accuracyView(reading).reasonKey` 顯示縮短句(`ios-wide` → `b.warnWide`、`ios-bad` → `b.warnBad`、`jitter` → `b.warnJitter`、`jitter-bad` → `b.warnJumpy`、`uncalibrated` → `b.warnCalib`、`waiting` → `b.warnWait`;完整原因句是 5.7 的 `STABILITY_REASON`,羅盤分頁照舊用完整句)。
  - 優先序:`c.tooFew` / `c.cancelled` > 讀數提醒 > 按下被擋的原因。按下被擋的原因和讀數提醒是同一件事(例如誤差太大),所以有讀數提醒時畫面上只留讀數提醒那一行。
- 「就是這個方向」:按下先看 `session.getState().gate`;不允許時不開始鎖定,把 `lockBlockedMessage(reason, { startLabel: '開始量' })` 放進只給讀屏的 `role="alert"`(畫面上依上面的優先序只顯示一行)。姿勢恢復(`gate.allowed` 變回 true)後,這個訊息在下一筆讀數時自動清掉。
- 小連結 `b.stop`:停掉感測器,進 1M(不顯示原因)。
- `phase === 'waiting'`(1.5 秒沒有事件)或 `'failed'`:停掉感測器,進 **1M** 並顯示一行原因(見 1M)。

#### 1C 取平均(鎖定中)

| 鍵 | 文字 |
|---|---|
| `c.locking` | 請保持不動… {n} 秒 |
| `c.tooFew` | 樣本不夠,請再按一次「就是這個方向」,手機保持不動。 |
| `c.cancelled` | 剛剛中斷了,請再按一次「就是這個方向」。 |

- 主按鈕停用並顯示 `c.locking`,秒數用計時器每 200ms 更新(不用動畫幀,背景時也要走);`reduced-motion` 時不畫進度條,只更新文字。
- 方向圈與大字照常跟著手機轉。
- `session.lock()` 回 `null` 時,依 `state.note` 顯示(too-few → `c.tooFew`;cancelled → `c.cancelled`;blocked → `lockBlockedMessage`),回到 1B。

#### 1D 量完(畫面內 `readings[]`,不存 store,最多 3 筆)

每次鎖定成功(`status` 是 `ok` 或 `unstable`)就把 `{ meanDeg, sigma, lockedAtMs, status, accuracyDeg }` 加進 `readings`(`accuracyDeg` = 鎖定期間 iPhone 估計誤差的最大值,Android 為 null),並計算 `check = combineChecks(readings, settings)`。

| 鍵 | 文字 |
|---|---|
| `d.title` | 大門朝:{text} |
| `d.near` | 剛好在{a}方和{b}方中間,換個位置再量一次 |
| `d.nearOk` | 剛好在{a}方和{b}方中間,結果僅供參考 |
| `d.far` | 兩次量的差很多,換個位置再量一次 |
| `d.unsteady` | 這次不太穩,建議換個位置再量一次 |
| `d.rough` | 幾次結果差得有點多,僅供參考 |
| `d.inconsistent` | 幾次結果都不一樣,建議自己選方向 |
| `d.use` | 下一步 |
| `d.again` | 再量一次 |
| `d.useAnyway` | 還是用這個方向 |
| `d.toManual` | 自己選方向 |
| `d.degree` | 約 {deg} 度 |
| `d.item` | 第 {i} 次:{deg} 度 |
| `d.dropped` | 不採用 |
| `d.againHint` | 往左或右移一大步(約 1 公尺),一樣面向大門再量。兩次差不多,就代表附近沒有東西在干擾。 |
| `d.thirdHint` | 往屋內走兩三步,離大門遠一點,一樣面向大門外再量一次。 |
| `d.restart` | 全部重量 |
| `d.saved` | 已記下:大門朝{dir}方 |

- 標題 `d.title` 的 `{text}` 一律只寫 `common.dir`(「南方」);接近分界由下面那一行說明。
- 畫面上最多一行結論(`near` = `eightImpact(方位, check.uncertaintyDeg).near`),依序只擇一:

| 狀況 | 一行(警告色) | 主按鈕 | 小連結 |
|---|---|---|---|
| `inconsistent` | `d.inconsistent` | `d.toManual` | `d.useAnyway` |
| `far`(兩次差很多,平均值不可靠) | `d.far` | `d.again` | `d.useAnyway`、`d.toManual` |
| `single-wide`、`single-unstable`(手機誤差大或手晃;誤差範圍很寬,「剛好在中間」多半不是真的,所以排在接近分界前面) | `d.unsteady` | `d.again` | `d.useAnyway`、`d.toManual` |
| 接近分界,且量不到 3 次 | `d.near`(`{a}` = 方位,`{b}` = `eight.neighbor`) | `d.again` | `d.useAnyway` |
| 接近分界,已經量 3 次(不再叫人重量) | `d.nearOk` | `d.use` | — |
| `warn`(n=3) | `d.rough` | `d.use` | — |
| 其他(`single-ok`、`single-noacc`、`agree`、`dropped`、`warn` n=2 不接近分界) | 不顯示 | `d.use` | `d.again`(量不到 3 次時) |

- 只量一次而且沒有任何警告時,直接是這個簡短畫面(標題 + 「下一步」),不多一個中間畫面。
- 「看說明」(預設關閉)裡依序放:`d.degree`、每次讀數清單 `d.item`(不採用的那筆加 `d.dropped` 徽章並劃線)、自我檢查結論框(下表)、「手機差幾度,會不會影響結果?」區塊、下一次怎麼量(量 1 次時 `d.againHint`,量 2 次時 `d.thirdHint`)、量 2 次以上時的 `d.restart` 按鈕。
- 「再量」保留 `readings`,回到 1B(感測器仍在跑,不重問權限)。「全部重量」清空 `readings` 回到 1B。
- 「下一步」與「還是用這個方向」:寫入 store(第 6 節,origin `sensor`),停掉感測器,toast `d.saved`;原本就有朝向時 toast 附「復原」(還原整個舊的 `facing` 物件)。之後:有平面圖 → 步驟 3;沒有 → 步驟 2。

自我檢查結論句(`checkVerdictText(check, lockSeconds, { near, dir })`,放在「看說明」裡的 `.callout`,開頭有 ✓、! 或 i(說明)圖示,不只靠顏色;`dir` = 方位名):

| `check.verdict` | 圖示 | 文字 |
|---|---|---|
| `single-ok` | ✓ | 量得很穩,手沒有晃。想更放心,可以走一大步再量一次比對。 |
| `single-noacc` | i | 量得很穩,手沒有晃。不過這支手機不會告訴我們它自己的誤差,穩不代表準。建議走一大步再量一次,兩次一樣就比較放心。 |
| `single-wide` | ! | 手機自己估計,可能差 {acc} 度左右,有點大。建議離鐵門、冰箱、電器遠一點,走一大步再量一次。 |
| `single-unstable` | ! | 這 {s} 秒讀數晃得比較多(約 {sigma} 度),附近可能有會干擾的東西。建議移一步再量一次。 |
| `agree` | ✓ | {n} 次只差 {d} 度,附近沒有明顯干擾。 |
| `warn`(n=2,接近分界) | ! | 兩次差 {d} 度,有點多。可能其中一個位置附近有鐵門、電器或鋼筋。建議再量第 3 次。 |
| `warn`(n=2,不接近分界) | ✓ | 兩次差 {d} 度,但兩次都是{dir}方。想更放心,可以再量第 3 次。 |
| `warn`(n=3) | ! | 三次最多差 {d} 度,有點多,結果僅供參考。 |
| `far` | ! | 兩次差 {d} 度,差很多,附近很可能有東西在干擾指北針。建議換到離鐵門和電器遠一點的地方再量,或改成自己選方向。 |
| `dropped` | ✓ | 第 {k} 次和另外兩次差很多,已經不採用;另外兩次只差 {d} 度,附近沒有明顯干擾。 |
| `inconsistent` | ! | 三次結果都不太一致,平均值可能不準。建議改成自己選方向,或請老師用實體羅盤確認。 |

- `{acc}` = `check.accuracyDeg` 取整數。不接近分界時,兩次差得有點多也不當成問題(兩次都還在同一個大方位),和「大門朝哪一方:不受影響」不會互相矛盾。

`agree`、`dropped` 與 `warn`(n=2,不接近分界)時,**同一個結論框裡**再加一段(`d.systematic`,不用淡色小字):

| 鍵 | 文字 |
|---|---|
| `d.systematic` | 不過如果整棟大樓鋼筋很多,幾次也可能一起偏;想更放心,可以用地圖對一次(見「手機指北針準嗎?」)。 |

「手機差幾度,會不會影響結果?」區塊(`renderDirectionImpact`,第 8.9 節),U = `check.uncertaintyDeg`;財位那一項用「這次的量測當成宅向」的試算狀態跑 `wealthStability`(8.12),還沒有平面圖時顯示「選好格局後會再幫你檢查」。

#### 1M 自己選方向

原因(一行警告色 `.v-easy-one.is-warn`,只在從失敗轉過來時顯示;App 內建瀏覽器優先):

| 鍵 | 條件 | 文字 |
|---|---|---|
| `m.noSensor` | 沒有 `DeviceOrientationEvent` | 這台裝置沒有指北針,請自己選方向。 |
| `m.noEvents` | `no-events` / `unsupported` / `insecure-context` / `no-sensor` | 讀不到手機指北針,請自己選方向。 |
| `m.deniedShort` | `permission-denied` / `permission-error` | 沒有允許使用指北針,請自己選方向。 |
| `m.denied` | 同上,完整說明放在「看說明」裡 | `sensorMessage(status) + DENIED_HELP`(逐字見 5.7),後面接「請直接選大門朝哪個方向。」 |
| `m.relative` | `relative-not-north` | 這台手機給不出北方,請自己選方向。 |
| `m.inAppShort` | 上面任一失敗且 `inAppBrowserName(navigator.userAgent)` 有值(取代上面那一行) | 在 {app} 裡可能不能用指北針,請改用 Safari 或 Chrome 開 |
| `m.inApp` | 同上,完整說明放在「看說明」裡 | 你現在是在 {app} 裡面開的網頁,這裡可能不能用指北針。請用 Safari 或 Chrome 打開這個網址再試一次。 |

| 鍵 | 文字 |
|---|---|
| `m.title` | 大門朝哪個方向? |
| `m.lead` | 站在門內看出去,門外是哪一邊? |
| `m.map1` | 不確定的話:打開 Google 地圖,先按右上角的小指北針,讓地圖轉回北在上面。 |
| `m.map2` | 找到你家,看大門面對的街道在房子的哪一邊。 |
| `m.center` | 你家 |
| `m.cellAria` | 大門朝{dir}方 |
| `m.picked` | 已選:{dir}方 |
| `m.note` | 選大概的方位就可以。方向差一點會不會換財位,後面會告訴你。 |
| `m.degTitle` | 知道確切度數? |
| `m.degLabel` | 大門朝向度數(0 到 359.9) |
| `m.degHint` | 北是 0、東是 90、南是 180、西是 270。 |
| `m.degPlaceholder` | 例如 225 |
| `m.degEmpty` | 請輸入 0 到 359.9 之間的數字 |
| `m.degNan` | 只能輸入數字,例如 175 或 175.5 |
| `m.degRange` | 度數要在 0 到 359.9 之間 |
| `m.typed` | 已輸入:{deg} 度,是{text} |
| `m.use` | 下一步 |
| `m.pickFirst` | 先點大門朝的方向 |
| `m.retrySensor` | 再試一次手機指北針 |

- 由上到下:標題、一行 `m.lead`、原因(有才顯示)、3×3 按鈕格、已輸入提示、度數輸入摺疊、大按鈕 `m.use`、小連結 `a.help` 與 `m.retrySensor`(只在有 `DeviceOrientationEvent`、而且不是權限被拒(`permission-denied` / `permission-error`)時;按過「不允許」後不重開網頁多半不會再問)、「看說明」(完整的權限/內建瀏覽器說明、`m.map1`、`m.map2` 小清單、`m.note`)。
- 3×3 按鈕格(上北下南,跟地圖一樣):第一排 西北、北、東北;第二排 西、(中間格 `m.center`,不可點)、東;第三排 西南、南、東南。每格高 ≥ 64px(320px 寬時 ≥ 56px),`aria-pressed` 標示選中,`aria-label` 用 `m.cellAria`。選格子時 `m.picked` 只給讀屏(格子本身已標出選中);輸入度數時才在畫面上顯示 `m.typed`。
- 度數輸入放在 `<details>`,標題 `m.degTitle`;用 `parseBearingInput`(`views/compass.js` 既有匯出,唯讀 import)解析,錯誤訊息依 reason 用 `m.degEmpty/m.degNan/m.degRange`(`role="alert"`)。輸入有效後格子取消選取。
- 主按鈕 `m.use`:不停用(淡色停用鈕會讓人以為壞了),還沒選時按下只跳 toast `m.pickFirst`。選格子 → origin `pick8`,顯示方位 = `bearingOfDir8(dir)`;輸入度數 → origin `typed`。寫入後 toast `d.saved`(原本有朝向時附「復原」),下一步同 1D。
- `m.retrySensor` 回到 1A。

#### 1S 已記下(已有 `facing.bearing`)

| 鍵 | 文字 |
|---|---|
| `s.title` | 大門朝:{text} |
| `s.sensorMulti` | 約 {deg} 度 · 手機量了 {n} 次,相差 {d} 度 |
| `s.sensorDropped` | 約 {deg} 度 · 手機量了 {n} 次(1 次不採用),相差 {d} 度 |
| `s.sensorOne` | 約 {deg} 度 · 手機量了 1 次 |
| `s.pick8` | 自己選的大方位 |
| `s.typed` | 自己輸入的度數:{deg} 度 |
| `s.other` | 約 {deg} 度 |
| `s.doorSep` | 完整功能裡另外設定了房子朝向(約 {deg} 度)。這裡看的是大門朝向;在這裡重新量的話,兩個會合成同一個方向。 |
| `s.next` | 下一步 |
| `s.remeasure` | 重新量 |
| `s.manual` | 改成自己選方向 |

- 畫面:標題 `s.title`(`{text}` 只寫 `common.dir`)、接近分界時一行警告 `d.nearOk`(已經記下的方向不叫人重量,大按鈕仍是「下一步」;要重量用 `s.remeasure`)、大按鈕 `s.next`(依有無平面圖到步驟 3 或步驟 2)、小連結 `s.remeasure`(→ 1A,沒有感測器時 1M)。
- 大門方位 = `facing.doorBearing`(完整功能另外設了大門方向時;八宅也是看大門)否則 `facing.bearing`。
- 「看說明」裡:依 `facing.source` 與 `facingCheckOf(facing)` 選的小字(大門方向與房子朝向不同 → `s.other`(大門度數),並加 `.callout` `s.doorSep`(`{deg}` = 房子朝向);`sensor` 且 check.n ≥ 2 且 `check.dropped === 1` → `s.sensorDropped`;`sensor` 且 check.n ≥ 2 → `s.sensorMulti`;`sensor` 其他 → `s.sensorOne`;`pick8` → `s.pick8`;`manual` 且 `lockedAtMs == null` → `s.typed`(`{deg}` 先 `roundTenth` 再去掉 `.0`,不會出現 360);其餘 → `s.other`)、`pick8` 時的 `EASY_PICK8_NOTE`(copy.js)、影響區塊(`renderDirectionImpact`,U = 與 `store.input()` 相同的 `facingUncertaintyOf(state)`;`pick8` 時 U = 22.5、不顯示大門那一項;自己輸入度數時 origin `typed`)、按鈕 `s.manual`(→ 1M)。

### 5.3 步驟 2:選格局(可跳過)

判斷:`state.plan` 為 null,或 `isUntouchedTemplate(state.plan, state.ui.easyLayout)` 為 true → **2A**;否則 → **2B**(使用者自己畫或改過,絕不覆蓋)。

#### 2A 選範本與大門位置

| 鍵 | 文字 |
|---|---|
| `l.title` | 你家比較像哪一種? |
| `l.size.studio` | 約 10 坪 |
| `l.size.two` | 約 19 坪 |
| `l.size.three` | 約 30 坪 |
| `l.size.shop` | 約 18 坪 |
| `l.descItem` | {label}:{desc} |
| `l.desc.studio` | 客廳加一間小臥室、小廚房、廁所,約 10 坪 |
| `l.desc.two` | 客廳、廚房、兩間房間、廁所,約 19 坪 |
| `l.desc.three` | 客廳、餐廳、三間房間加一間書房,約 30 坪 |
| `l.desc.shop` | 一間店面,後面是倉庫和廁所 |
| `l.doorTitle` | 站在屋內看大門,門在: |
| `l.doorLead` | 站在進門的那個空間(通常是客廳)中間,面向有大門的那面牆。大門在這面牆的哪一邊? |
| `l.left` | 左邊 |
| `l.center` | 中間 |
| `l.right` | 右邊 |
| `l.doorWhy` | `EASY_DOOR_WHY` 或 `EASY_DOOR_SAME`(copy.js) |
| `l.previewNote` | 圖的上方就是大門那一面,金色是大門。 |
| `l.next` | 看財位 |
| `l.pickFirst` | 先選一個最像的 |
| `l.skip` | 都不像,跳過 |
| `l.applied` | 已套用「{label}」 |
| `l.removed` | 沒有選格局,只看方向 |
| `l.cantMove` | 這個格局的大門放不到那個位置,先保留原本的位置。 |

- 範本卡:`TEMPLATES` 去掉 `custom`,每張卡只有縮圖(`planPreviewSvg(plan, { size: 'thumb' })`;選中的那張用目前的平面圖,大門位置會跟著變)、`label`、坪數 `l.size.<id>`,`aria-pressed` 標示選中。
- 選了範本後才出現一行 `l.doorTitle`(題目本身就講明「站在屋內看大門」,左右才不會看反)與大門位置分段控制(`.seg`,`aria-labelledby` 指向那一行,預設「左邊」= 範本原樣)。「右邊」= 整張圖左右鏡射(大門在房子正面的右側,客廳也在右邊);「中間」= 進門那個空間前牆的正中間(`withDoorSide`,8.5)。
- 「看說明」裡:`l.doorLead`;同一個範本的大門放左、中、右三種位置,排第一的財位都在同一個房間的同一個角落(`sameTopForPlans`,8.12)→ `EASY_DOOR_SAME`,否則 → `EASY_DOOR_WHY`;大預覽(`planPreviewSvg(plan, { size: 'large' })`)與 `l.previewNote`(以上三項只在選了範本後);4 個範本的房間說明(`l.descItem`,`{desc}` = `l.desc.<id>`;完整功能的 `desc` 不動)。
- **寫入時機**:點範本或改大門位置時立刻寫入:
  ```js
  const res = withDoorSide(buildTemplate(id).plan, doorSide);
  store.update(d => { d.plan = res.plan; d.ui.easyLayout = { template: id, doorSide: res.moved ? doorSide : 'left' }; });
  ```
  `res.moved === false` 時跳 toast `l.cantMove`,分段控制退回「左邊」。原本有平面圖(沒被改過的簡單範本)時,第一次換範本跳 toast `l.applied` 附「復原」。
- 大按鈕「看財位」→ 步驟 3。沒選範本時按鈕不停用(淡色停用鈕會讓人以為壞了),按下只跳 toast `l.pickFirst`。
- 小連結「都不像,跳過」:目前的 plan 是沒被改過的簡單範本時,設 `plan = null`、`ui.easyLayout = null`,跳 toast `l.removed` 附「復原」;然後 `easyStep = 'result'` 進步驟 3。
- 小連結「上一步」→ 步驟 1(1S)。

#### 2B 已有自己畫的平面圖

| 鍵 | 文字 |
|---|---|
| `l.ownTitle` | 你已經畫好平面圖了 |
| `l.ownLead` | 會直接用你畫的平面圖。 |
| `l.ownNext` | 看財位 |
| `l.ownEdit` | 到完整功能修改 |

- 縮圖 `planPreviewSvg(state.plan, { size: 'large' })`,用 try/catch 包起來,失敗就不顯示。
- 小連結「到完整功能修改」→ `ctx.go('plan')`。

### 5.4 共用說明面板「手機指北針準嗎?」

`openCompassHelp(ctx, state, { opener })`(`src/ui/components/compassHelp.js`)用 `ctx.openSheet({ title, content, onClose })` 開啟;關閉後焦點回到 `opener`(開啟它的按鈕;Safari 點按鈕不會給焦點,所以由呼叫端傳入)。標題與內容全部來自 `compassHonesty(...)`(copy.js):最上面是主要四項(`<dl>`,粗體小標 + 內文),其餘收在 `<details>`「給想知道細節的人」。參數:`trueMode`、`declinationDeg`(`basisOf(state).declination`,取不到時為 null)、`measureUncertainty`(設定值,預設 5)、`easy`(`ui.mode === 'easy'`,簡單模式不提設定裡的誤差調整)、`cityName`(`facing.cityId`)。

標題:**手機指北針準嗎?**

| 小標 | 內文 |
|---|---|
| 結論 | 夠用。要知道大門朝哪一邊(東、南、西、北這 8 個方位),手機通常夠準;只有大門剛好朝在兩個方位中間時,App 會提醒你再量一次。財位在哪個角落,主要看大門在屋裡的位置;方向差幾度會不會換位置,結果頁會幫你檢查。 |
| 怎麼自己檢查 | 往旁邊走一大步再量一次,兩次都是同一個方位就比較放心。 |
| 用地圖對一次 | 打開 Google 地圖,先按右上角的小指北針,讓地圖轉回北在上面。找到你家,看大門面對的那條街在房子的哪一邊(東、南、西、北)。跟 App 說的方位一樣,就對了。(不要看地圖上的藍色箭頭,那也是用手機的指北針。) |
| 量不準時 | 拿著手機在空中慢慢畫幾個 8 字,再離鐵門、冰箱、冷氣遠一點。 |

摺疊區「給想知道細節的人」:

| 小標 | 內文 |
|---|---|
| 大概的誤差 | 手機指北針平常大約有 5 到 10 度的誤差;靠近鐵門、鋼筋、冷氣或磁吸手機殼時會更大。本 App 預設以 {mu} 度當作誤差來提醒你{set} |
| 差幾度會換方位 | 8 個大方位每個 45 度寬。手機差 5 度時,大約 8 成的方向還在同一個大方位;差到 10 度時,大約只剩一半。玄空飛星(有填建成年份才會用到)把一圈分成 24 格、每格只有 15 度,更容易跨格,完整功能的報告會標示建議再確認。 |
| 「很穩」不等於「很準」 | 訊號格只看得出手有沒有在晃,看不出整棟大樓的鋼筋讓每次讀數一起偏。所以建議往旁邊移一步再量一次,兩次差不到 {mu} 度就比較放心。 |
| iPhone 和 Android 不一樣 | iPhone 會提供它自己估計的誤差,畫面會寫「手機自己估計,可能差幾度左右」,App 也會把它算進去;Android 手機在網頁裡拿不到這個數字,只能從讀數晃不晃來判斷。 |
| 磁北和真北 | 磁北時:本 App 用「磁北」,和傳統羅盤一樣;地圖用「真北」。兩者{where},所以同一個方向,本 App 的度數會比地圖大約{more} {d} 度。用地圖看東南西北時,這點差距通常不影響。<br>真北時:本 App 目前設定用「真北」,和手機地圖一樣。 |
| 跟 iPhone 內建「指南針」比 | 磁北時:內建「指南針」和本 App 用的是同一個感測器,只能拿來檢查本 App 的設定,看不出手機本身準不準。打開 設定 >(App >)指南針,看「使用真北」有沒有打開(需開啟定位服務)。有打開:iPhone 的數字會比本 App {less}約 {d} 度;沒打開:兩邊應該差不多。扣掉這個差距後,兩邊差 2 度以內都正常;差更多,多半是北基準的設定不一樣。<br>真北時:內建「指南針」和本 App 用的是同一個感測器,只能拿來檢查本 App 的設定,看不出手機本身準不準。打開 設定 >(App >)指南針,看「使用真北」有沒有打開(需開啟定位服務)。有打開:兩邊應該差不多;沒打開:iPhone 的數字會比本 App {bigger}約 {d} 度。扣掉這個差距後,兩邊差 2 度以內都正常;差更多,多半是北基準的設定不一樣。 |
| 用地圖比時差多少算正常 | 看地圖上的街道或房子的邊來比方向時,差 10 度以內都算正常。 |
| 需要更精確時 | 手機最細只能看到 24 格這一級,而且靠近格線時仍要再確認;更細的格子(例如分金),或「兼向」「空亡」這類要準到 2 度左右的判斷,請找老師用實體羅盤確認。 |

- `{d}` = `Math.floor(Math.abs(declinationDeg) + 0.5)`;`declinationDeg` 為 null 時 `{d}` 代換成「4 到 5」。`{mu}` = 設定值(去掉 `.0`)。
- `{set}`:完整功能為「(可在設定的「手機量測的誤差」調整)。」;簡單模式為「。」。
- `{where}`:有磁偏角且有城市名稱時「在台灣大約差 4 到 5 度(目前用{城市}的值,約 {d} 度)」;否則「在台灣大約差 {d} 度」(不說「在你所在的地方」,因為城市預設是台北,不是定位)。
- `{more}`/`{less}`/`{bigger}`:磁偏角西偏(台灣)時為「多」「小」「大」;東偏(正值)時對調為「少」「大」「小」。
- 「2 度」:內建指南針和本 App 讀同一個感測器,扣掉真北/磁北差距後只剩四捨五入與平滑的差別。「10 度」:用地圖上的街道或房子的邊比對時的設計值(Apple 範例精度 ±10 度)。
- 「8 成」「一半」:到最近 8 方位分界的距離在 0 到 22.5 度均勻分布,差 5 度不換方位的比例 = 17.5/22.5 ≈ 78%,差 10 度 = 12.5/22.5 ≈ 56%。

### 5.5 步驟 3:看財位

#### 資料來源(全部重用,不自己算風水)
```js
const r = safeReport(store);                                   // views/wealth.js
const raw = r && !r.error ? renderReport(r) : null;            // core/copy.js
const model = buildWealthModel(state, r, raw);                 // views/wealth.js:best / others / map / guides / disclaimers
const sum = r && !r.error ? renderEasySummary(r) : null;       // core/copy.js(新,第 8.9 節)
```
- 位置文字:`placeText(r.summary.wealthTop[0], state.plan)`(`easy/layout.js`)。
- 現況檢查:`model.best.checks`(`views/wealth.js` 既有,已白話)。
- 要先處理的事:`model.best.remedies[0]`(引擎 Finding,已經過 `sanitizePage`)。
- U = `facingUncertaintyOf(state)`(`store.js`,與 `store.input()` 送進引擎的是同一個;含 iPhone 估計誤差;`pick8` 為 22.5),沒有就用設定值。
- 排第一的財位會不會換:`wealthStability(state, facing.bearing, U)`(8.12)。
- 接近分界:`eightImpact(大門的顯示朝向, U).near`(大門方向 = `doorBearing ?? bearing`,與八宅相同);`facing.source === 'pick8'` 時不判斷。縮圖角落接近方位交界:`sum.borderline`。

#### 畫面(由上到下)

| 鍵 | 文字 |
|---|---|
| `r.title` | 你家的財位 |
| `r.change` | 方向差一點,可能換到{place} |
| `r.changeSameRoom` | 方向差一點,可能換到同一間的另一個角落 |
| `r.changeAny` | 方向差一點,財位可能換位置 |
| `r.changeTier` | 方向差一點,評等可能會變 |
| `r.near` | 大門剛好在{a}方和{b}方中間,結果可能不同 |
| `r.nearMore` | 大門的方向剛好在「{a}」和「{b}」兩個方位的分界附近,差幾度結果就可能不同。想更準,可以回第 1 步換個位置再量一次。 |
| `r.shaky` | 上次量的時候手有點晃,結果僅供參考 |
| `r.notAdvised` | 這裡目前不建議當財位,要先處理的地方寫在說明裡 |
| `r.retestBtn` | 重新量 |
| `r.more` | 看詳細說明 |
| `r.mapNote` | 金色「財」字就是財位。圖的上方是大門那一面。 |
| `r.dirNote` | 金色那一塊是比較有利的方位。圖的上方是大門那一面。 |
| `r.inHouse` | 在房子的{dir}方 |
| `r.frame` | 前、後、左、右都是以「站在屋內、面向大門」來說。 |
| `r.frameShort` | 站在屋內、面向大門時: |
| `r.darkWhere` | 從家裡正中間看,{dir}方那一區 |
| `r.remedyTitle` | 先處理這一點 |
| `r.tipsTitle` | 財位佈置的傳統說法 |
| `r.tipsNote` | 屬民俗性質,請依自己的空間與習慣調整。 |
| `r.moreTitle` | 想看更完整的分析? |
| `r.morePlan` | 選一個像你家的格局,就能指出是家裡的哪個角落。 |
| `r.morePlanBtn` | 選格局 |
| `r.moreYear` | 知道房子哪一年蓋好的話,填上後會多參考一種依建成年份推算的傳統方法。這個方法對方向比較敏感,手機差幾度就可能換位置。不知道就不用填。 |
| `r.yearLabel` | 建成年份 |
| `r.yearPlaceholder` | 例如 2005 或 民國 94 |
| `r.yearRoc` | 民國 {roc} 年 = 西元 {year} 年 |
| `r.yearHint` | 可以看房屋權狀、建物謄本,或問房東、管委會。 |
| `r.yearSave` | 填好了 |
| `r.yearSaved` | 已記下建成年份 {year} 年 |
| `r.moreResidents` | 填上家人的出生日期與性別,建議會更貼近你(選填)。 |
| `r.moreResidentsBtn` | 到完整功能填寫 |
| `r.othersTitle` | 其他可以考慮的位置({n}) |
| `r.showing` | 圖上標示:{place} |
| `r.backToBest` | 回到最佳位置 |
| `r.full` | 看專業版分析(名詞較多) |
| `r.remeasure` | 重新量方向 |
| `r.editLayout` | 修改格局 |
| `r.errTitle` | 暫時算不出財位 |
| `r.errBody` | 目前填的資料算不出結果,資料沒有遺失。可以回到第 1 步重新量,或到完整功能檢查。 |
| `r.errStep1` | 回到第 1 步 |
| `r.errPro` | 到完整功能檢查 |

1. 步驟條(第 3 項為目前步驟)。
2. **財位卡**(`.card.wealth`):
   - 標題(`.card-title`):`sum.title` 是 `EASY_TITLE.spot` 時寫 `r.title`,否則照 `sum.title`(方位版、沒有特別突出的位置)。
   - 圖:`model.map` 有值 → `mountMiniPlan(host, { ...model.map, markers: [最佳那一個], selectedId: best.id, sectorLabels: 'dir8', plain: true })`(`plain`:只畫房間、房間名、大門與金色「財」,不畫方位扇形與虛線、中心十字、八方位名稱、指北針、窗;完整功能的縮圖不變);沒有平面圖(最佳是方位)→ `directionDiagramSvg({ upBearing: 大門的顯示朝向, highlight: best.dir })`。圖下平常不寫說明(圖上已有金色「財」字);看其他位置時才顯示 `r.showing` 與 `.btn-sm .btn-ghost` `r.backToBest`。
   - `placeText(...).usesFrame`(位置用到前後左右)時,大字上方一行小字 `r.frameShort`。
   - 大字(`.card-lead .kai`):`placeText(...)`。
   - 沒有平面圖(最佳是方位)時,大字下一行 `r.darkWhere`(`{dir}` = 那個方位),講清楚方位是從家裡正中間算的。
   - 一行 `EASY_USE_TIP`(copy.js,「這樣用:…」):只在 `sum.softTips.length > 0`(沒有平面圖的方位版照原邏輯不顯示)且排第一的不是「不建議」時。
   - 排第一的評等是「不建議」時:一行 `r.notAdvised`。
   - 會影響結果的提醒(一行警告色,後面接小連結 `r.retestBtn`「重新量」,只擇一,依序):
     - 排第一的財位會換(`wealthStability(...).status === 'changes'`):換位置 → `r.change`(`{place}` 只寫房間名 `roomLabel(plan, 會換成的那一個.roomId)`,會換成方位時寫那個方位;會換成同一間房的另一個角落時改用 `r.changeSameRoom`,免得只寫房間名看起來和答案一樣;哪個角落寫在「看詳細說明」的完整句子裡;取不到時 `r.changeAny`);換評等 → `r.changeTier`。旁邊小連結 `r.retestBtn`(→ 步驟 1 的 1A)。
     - 否則,「接近分界」為真 → `r.near`(`{a}` = 目前方位,`{b}` = `sectorOf8(大門方位).neighbor`),旁邊小連結 `r.retestBtn`;完整的 `r.nearMore` 放在「看詳細說明」。
     - 否則,`facing.source === 'sensor'` 且 `facing.sigma > SENSOR_DEFAULTS.lockMaxStdDeg` → `r.shaky`。
     - 自己選 8 方位不另外放提醒(`EASY_PICK8_NOTE` 只在 1S 的說明裡);方向不確定會不會換財位,由第一項判斷(U = 22.5)。
3. **看詳細說明**(`<details class="v-card-more v-easy-fold">`,標題 `r.more`,預設關閉;打開與否在重畫時保留;看其他位置時自動打開),依序:
   - 一行:`r.inHouse`(最佳是方位時不顯示)+ 三段標籤徽章(`TIER_BADGE[tier]`,文字 `TIER_LABEL[tier]`)。
   - `r.mapNote`(有平面圖)或 `r.dirNote`(方位圖);`placeText` 用到前後左右時 `r.frame`。
   - `sum.sentences` 每句一個 `<p>`(排第一的是從某個房間自己的房門算的斜對角時,第一句是 `EASY_METHOD.mingRoom`,講清楚不是從大門算的)。
   - `model.best.checks`:`<ul class="list">`,✓ / ✗ 記號(`.ok` / `.bad`)。
   - `model.best.remedies[0]` 有值時:`.callout`,小標 `r.remedyTitle`,接 `<strong>{headline}</strong>` 與 `<p>{body}</p>`。
   - `sum.softTips.length > 0` 時:小標 `r.tipsTitle`、`sum.softTips` 清單與 `r.tipsNote`。
   - `sum.tierNote`。
   - 排第一的財位會換時,完整的 `renderStabilityNote({ change, place, from, to, origin })`(copy.js);大門接近分界時 `r.nearMore`;上次量時手晃但畫面上已有別的提醒時,`r.shaky` 也放在這裡。
   - **其他位置**(`model.others.length > 0` 才顯示):`<details>`,標題 `r.othersTitle`。每列是一顆按鈕:`placeText` + 三段標籤徽章。點了:`mini.update({ markers: [該位置], selectedId })` 並把圖捲進畫面,圖下說明改成 `r.showing` 與 `r.backToBest`。沒有平面圖時改為切換方位圖的塗色塊。
   - **想看更完整的分析?**(`.card`,只列第一個符合的項目,依序):
     - 沒有平面圖 → `r.morePlan` + 按鈕 `r.morePlanBtn`(到步驟 2)。
     - 沒有 `building.builtYear` → `r.moreYear`,就地輸入:`inputmode="numeric"`,標籤 `r.yearLabel`,placeholder `r.yearPlaceholder`,小字 `r.yearHint`。輸入時用 `parseYearLoose(text, Date.now())`:成功且是民國年 → 即時顯示 `r.yearRoc`;失敗 → `role="alert"` 顯示 `res.message`。按 `r.yearSave` 寫入 `building.builtYear`,toast `r.yearSaved` 附「復原」。
     - 沒有住戶 → `r.moreResidents` + 按鈕 `r.moreResidentsBtn`(`ctx.go('house')`)。
     - 三樣都齊 → 整張卡不顯示。
   - 按鈕 `r.full` → `ctx.go('wealth')`(專業財位頁名詞較多)與小連結 `a.help`。
   - `model.disclaimers[0]` 與 `EASY_DISCLAIMERS`(copy.js 白話版)。
4. 兩個並排的小按鈕:`r.remeasure`(步驟 1 的 1A,使用者明確要重量)、`r.editLayout`(步驟 2;還沒有平面圖時字改成 `r.morePlanBtn`「選格局」)。流程到這裡就結束,沒有「完成」按鈕。
5. 一行小字 `CARD_DISCLAIMER`(copy.js)。

#### 空狀態與錯誤
- `r.error === 'NO_FACING'`:自動回步驟 1。
- 其他錯誤或 `model.status === 'error'`:`.card.warn`,小標 `r.errTitle`、內文 `r.errBody`,按鈕 `r.errStep1`(步驟 1)與 `r.errPro`(`ctx.go('house')`)。
- `sum.status === 'none'`(沒有候選):照常顯示財位卡框架,小標 `sum.title`,內文 `sum.sentences`,接著「想讓結果更準?」。

### 5.6 設定面板的「介面」分組(B)

| 文字 | |
|---|---|
| 分組標題 | 介面 |
| 項目名稱 | 畫面模式 |
| 說明 | 簡單模式只問幾件事就告訴你財位;完整功能有專業羅盤、住宅資料、平面圖編輯與詳細報告。 |
| 選項 | 簡單模式 / 完整功能 |

- 簡單模式時,設定面板只直接顯示「介面」「外觀」「資料」「關於」;北基準、手機量測的誤差、財位排序與進階流派選項收在摺疊區「專業設定(完整功能用)」。完整功能時照舊全部展開。
- 標題列的設定鈕改成齒輪圖示(8 齒),簡單模式在旁邊加上文字「設定」(`aria-label` 仍是「設定」)。

### 5.7 量測共用文字(`src/ui/sensorText.js`,兩種模式共用)

**穩定度**(`accuracyView(reading)`):訊號格依燈號(green 3、yellow 2、red 1、unknown 0);短標籤依原因(`reasonKey`),因為 iPhone 因自己估計的誤差變黃時,不能說成「手有點晃」。「拿得很穩」只講手有沒有晃,不暗示「很準」。

| reasonKey | 訊號格 | label |
|---|---|---|
| ios-ok | 3 | 手拿得很穩 |
| steady | 3 | 手拿得很穩 |
| ios-wide | 2 | 誤差有點大 |
| jitter | 2 | 手有點晃 |
| uncalibrated | 1 | 還沒校準 |
| ios-bad | 1 | 誤差太大 |
| jitter-bad | 1 | 晃得太多 |
| waiting | 0 | 判斷中 |

原因句(`reasonKey` → `reason`;`{acc}` 取整數,`{max}` = `SENSOR_DEFAULTS.accuracyYellowMax`;不用 ± 符號):

| reasonKey | 條件 | 文字 |
|---|---|---|
| `ios-ok` | 綠,且有 iPhone 精度 | 手機自己估計,可能差 {acc} 度左右。 |
| `steady` | 綠,沒有 iPhone 精度 | 這支手機不會告訴我們它自己的誤差,穩不代表準;記下後可以移一步再量一次比對。 |
| `ios-wide` | 黃,原因是 iPhone 精度 | 手機自己估計,可能差 {acc} 度左右,有點大。離鐵門、冰箱、電器遠一點再看看。 |
| `jitter` | 黃,原因是晃動 | 讀數有點晃。手機放平、手不要動,離鐵門、冰箱、電器遠一點。 |
| `uncalibrated` | `status === 'uncalibrated'` 或精度 < 0 | 手機說指北針還沒校準。拿著手機在空中慢慢畫幾個 8 字,再回來量。 |
| `ios-bad` | 紅,原因是 iPhone 精度 > {max} | 手機自己估計,誤差超過 {max} 度,現在量不準。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。 |
| `jitter-bad` | 紅,原因是晃動 | 讀數一直跳,附近可能有會干擾的東西。離金屬和電器 1 公尺以上,拿著手機畫幾個 8 字。 |
| `waiting` | 沒有讀數或燈號 unknown | 正在判斷,請把手機放平、保持不動 1 秒。 |

原因判斷:與 `qualityLight` 相同門檻分別算精度等級與晃動等級,取較差者;兩者同級時先講精度。

**姿勢提示**(`postureHint(reading)`,優先序由上到下,沒有就回空字串):

| 條件 | 文字 |
|---|---|
| `reading.faceDown` | 請螢幕朝上(`HINTS.faceDown`) |
| `reading.status === 'tilt-too-large'` | 請將手機放平再讀數(`sensorMessage('tilt-too-large')`) |
| `tiltDeg ≥ SENSOR_DEFAULTS.lockMaxTiltDeg` | 手機有點斜,請放平(傾斜 {n} 度) |

**權限被拒補充**(`DENIED_HELP`,從 `compass.js` 逐字搬出):
`(沒有跳出詢問的話,請完全關閉 Safari 或主畫面 App 後重開;仍不行,到 設定 > Safari > 進階 > 網站資料 移除本網站)`

`sensorMessage`、`lockBlockedMessage`、`SENSOR_FALLBACK_HINT` 的文字與 `compass.js` 現行版本逐字相同(第 8.2 節)。

### 5.8 專業羅盤頁白話化

| 位置 | 文字 |
|---|---|
| 讀數列最上方新增一行 `.v-compass-plain`(感測器跟隨中) | 手機頂端正對著:{text} |
| 同上(拖曳、輸入、鎖定後) | 上方「向」那一端指著:{text} |
| 同上(量的是坐;盤面上方標「坐」) | 上方「坐」那一端指著:{sitText}(背後)· 房子朝向:{text} |
| 品質文字 `QUALITY_TEXT` | 等於 5.7 的 `STABILITY_LABEL`,顯示 `accuracyView(reading).label` |
| 品質列下方新增 `.v-compass-qwhy` | 5.7 的 `reason` |
| 感測器卡片底部新增 ghost 按鈕 | 手機指北針準嗎?(→ `openCompassHelp`) |
| idle 提示(取代原句) | 手機放平、頂端朝向前方,按下按鈕後盤面會跟著手機轉。紅線對到的就是手機頂端指的方向。 |
| 鎖定成功後的 `lockNote`(`lockNoteText`) | 已記下約 {deg} 度。[手晃 ≥ 1 度時:手有一點晃。][24 格接近分界但 8 方位不接近時:離 24 格的分界很近,只影響細格。]`IMPACT_SHORT.ok` 或 `IMPACT_SHORT.near`(copy.js) |
| 讀數不穩時的 `lockNote` | {讀數不穩}。目前的平均約 {deg} 度,建議換個位置重測。[同上兩句] |
| 鎖定後、還沒按存檔鈕時,`lockNote` 句尾 | 還沒存。按下面的「{btn}」才會存起來。(`{btn}` = 存檔鈕目前的字,「用這個朝向」或「更新朝向」;按了存檔鈕後消失) |
| 盤面徽章:24 格接近分界 | 8 方位也接近分界 → 接近分界,建議重測(`HINTS.nearBoundary`);8 方位不接近 → 24 格接近分界(8 個大方位不受影響) |
| 「回到指北針」按鈕 | 重新跟著手機轉 |

- `{text}` = `plainDirection(度數).text`。原本的「向 175.0° · 午山(離宮 · 天元)· 坐 子」照舊保留在第二行,盤面、手勢、規格逐字的 `STATUS_INFO` 訊息都不改。
- 鎖定後的 24 格與 8 方位判斷用同一個 U = 鎖定結果的 `uncertaintyDeg`(已含 iPhone 估計誤差);徽章(拖曳時也要顯示)用 `nearBoundary` 的門檻判斷 24 格,8 方位用同一個門檻(`buildReadoutModel().near8`)。

---

## 6. 寫入 store 的欄位

| 欄位 | 值 | 寫入者 | 修復規則(`repair.js`) |
|---|---|---|---|
| `ui.mode` | `'easy'` \| `'pro'` | `main.js navigate()` | **有值但不合法**才改回 `'easy'`;沒有這個鍵時不補(`repairDraft(GOOD) === false` 必須維持) |
| `ui.easyStep` | `'facing'` \| `'layout'` \| `'result'` | `easy.js` | 有值但不合法 → 刪除 |
| `ui.easyLayout` | `{ template: 'studio'\|'two'\|'three'\|'shop', doorSide: 'left'\|'center'\|'right' }` \| null | `easy.js` 步驟 2 | 有值但格式不對 → null |
| `ui.easyIntroShown` | boolean | `easy.js` | 有值但不是 boolean → 刪除 |
| `facing.bearing` / `source` / `sigma` / `lockedAtMs` | 來自 `easyFacingPatch` | `easy.js` | 沿用現有規則 |
| `facing.source` | 新增值 `'pick8'` | `easy.js` | 有值但不是 `manual`/`sensor`/`pick8` → `'manual'` |
| `facing.check` | `{ n: 1..3, spreadDeg: number\|null, lockedAtMs: number, dropped: 0\|1, accuracyDeg: number\|null }` \| null(`dropped` = 有幾次不採用;`accuracyDeg` = iPhone 估計誤差,Android 為 null;舊資料沒有這兩鍵也有效) | `easy.js` | 有值但格式不對 → null |
| `facing.doorBearing` | `null`(簡單模式把大門朝向當成宅向) | `easy.js` | 沿用 |
| `building.builtYear` | 整數或 null | `easy.js` 結果頁 | 沿用 |
| `plan` | `withDoorSide(buildTemplate(id).plan, side).plan` 或 null | `easy.js` 步驟 2 | 沿用 |

寫入朝向的方式(與羅盤頁同一組欄位):
```js
const patch = easyFacingPatch({ displayedDeg, basis: basisOf(store.get()), origin, lock, check });
const prev = structuredClone(store.get().facing);
store.update(d => { Object.assign(d.facing, patch); d.ui.easyStep = d.plan ? 'result' : 'layout'; });
// 原本有朝向時:toast(fillText('d.saved', { dir }), { action: { label: '復原', onClick: () => store.update(d => { d.facing = prev; }) } })
```

`store.input()` 的不確定度(`store.js` 的 `facingUncertaintyOf(state)`;`store.input()` 由純函式 `inputOf(state, nowMs)` 產生,方便試算):
```js
if (facing.source === 'pick8') return Math.max(mu, 22.5);          // 自己選的 8 方位:真正方向可能在半格內任何地方
const chk = facingCheckOf(facing);                                 // 只有 source==='sensor' 且 check.lockedAtMs === facing.lockedAtMs 才有效
if (facing.sigma == null && chk?.spreadDeg == null && chk?.accuracyDeg == null) return null;   // 交給引擎用設定值
return uncertaintyFor({ measureUncertainty: mu, sigmaDeg: facing.sigma, spreadDeg: chk?.spreadDeg, accuracyDeg: chk?.accuracyDeg });
```
預設設定下,沒有 check 時結果與 `max(5, 2σ)` 完全相同。`check` 綁定 `lockedAtMs`:之後在羅盤頁或住宅頁改朝向(會改寫或清掉 `lockedAtMs`),舊的差距與精度自動失效,不必改那兩個畫面。自己選的 8 方位送 22.5 度,完整功能的報告就會對玄空等細格標示「建議再確認」。

`store.normalize` 已保留 `ui` 與 `facing` 的未知鍵,不必升 `STATE_VERSION`;匯出、匯入備份會自然帶上新欄位。

---

## 7. 模組與檔案

| 模組 | 檔案 | 測試 |
|---|---|---|
| **純邏輯與共用元件** | `src/ui/route.js`、`src/ui/sensorText.js`、`src/ui/sensorSession.js`、`src/ui/easy/direction.js`、`src/ui/easy/measure.js`、`src/ui/easy/layout.js`、`src/ui/easy/stability.js`、`src/ui/easy/svg.js`、`src/ui/easy/flow.js`、`src/ui/easy/text.js`、`src/ui/components/dirDial.js`、`src/ui/components/compassHelp.js`、`css/c-easy.css`;`src/core/copy.js` 的簡單模式匯出(`renderReport` 輸出逐字不變);`docs/API.md` | `test/ui/route.test.js`、`test/ui/sensor_session.test.js`、`test/ui/easy_direction.test.js`、`test/ui/easy_measure.test.js`、`test/ui/easy_layout.test.js`、`test/ui/easy_stability.test.js`、`test/ui/easy_svg.test.js`、`test/ui/easy_flow.test.js`、`test/ui/easy_text.test.js`、`test/easy_copy.test.js` |
| **簡單模式畫面與外殼** | `src/ui/views/easy.js`、`css/v-easy.css`;外殼接線:`src/ui/main.js`、`index.html`、`src/ui/store.js`、`src/ui/repair.js`、`src/ui/views/settings.js`、`src/ui/components/icons.js`(齒輪);`docs/UI_SPEC.md` | `test/ui/easy_shell.test.js`、`test/ui/easy_store.test.js` |
| **專業羅盤頁白話化** | `src/ui/views/compass.js`、`css/v-compass.css`;`src/ui/canvas/miniPlan.js` 的 `sectorLabels` 選項(預設不變) | `test/ui/compass_plain.test.js`(縮圖的 `sectorLabels` 在 `test/ui/easy_stability.test.js`) |

規則:
- 畫面只能依賴純邏輯模組的公開介面(第 8 節)與既有檔案的**既有匯出**(唯讀 import:`views/wealth.js`、`views/house.js`、`views/compass.js` 的 `parseBearingInput`、`canvas/miniPlan.js`、`plan/templates.js`、`plan/editor.js`、`basis.js`、`core/*`)。
- 純邏輯檔不得 import `views/compass.js`;需要的判斷直接用 `basis.js`、`core/*`。
- `sw.js` 是產生出來的檔:任何檔案新增或修改後,在 `fengshui/` 下跑 `node tools/gen-sw.mjs`,再跑 `npm test`。
- 所有新檔:程式碼、註解、文件不寫本機絕對路徑、不寫個人暱稱;路徑一律相對;不載入外部資源。

---

## 8. 公開介面(精確契約)

所有純函式不碰 DOM、不讀全域;輸入不合法時回 null 或回有 `error` 的物件,不丟例外(除非另外註明)。

### 8.1 `src/ui/route.js`
```js
export const TABS = Object.freeze([
  { id: 'compass', label: '羅盤', icon: 'compass' }, { id: 'house', label: '住宅', icon: 'home' },
  { id: 'plan', label: '平面圖', icon: 'plan' }, { id: 'wealth', label: '財位', icon: 'coin' },
  { id: 'report', label: '報告', icon: 'doc' },
]);                                               // 從 main.js 原樣搬過來
export const EASY_VIEW = 'easy';
export const MODES = Object.freeze(['easy', 'pro']);
export function hashViewId(hash)          // → string|null,與 main.js 現行 /^#\/(\w+)/ 相同
export function proHomeOf(ui)             // → TABS id;ui.tab 合法就用它,否則 'compass'
export function resolveRoute(hashId, ui)  // → { view: 'easy'|TABS id, mode: 'easy'|'pro', canonicalHash: '#/easy'|'#/<id>' }
export function modeToggleTarget(mode, ui) // → mode==='easy' ? `#/${proHomeOf(ui)}` : '#/easy'
```
範例:`resolveRoute('wealth', {mode:'easy'})` → `{view:'wealth', mode:'pro', canonicalHash:'#/wealth'}`;`resolveRoute(null, {mode:'pro', tab:'xx'})` → `{view:'compass', mode:'pro', canonicalHash:'#/compass'}`;`resolveRoute(null, {})` → `{view:'easy', mode:'easy', canonicalHash:'#/easy'}`。

### 8.2 `src/ui/sensorText.js`
```js
export const SENSOR_FALLBACK_HINT = '請拖曳盤面或輸入度數。';           // compass.js 逐字搬出
export const DENIED_HELP = '(沒有跳出詢問的話,請完全關閉 Safari 或主畫面 App 後重開;仍不行,到 設定 > Safari > 進階 > 網站資料 移除本網站)';
export function sensorMessage(status)     // → string|null;與 compass.js 現行實作逐字相同(insecure-context 顯示成 unsupported 的訊息)
export function lockBlockedMessage(reason, { startLabel = '使用手機指北針' } = {})
  // → 'tilt'→'請將手機放平再讀數';'uncalibrated'→sensorMessage('uncalibrated');'face-down'→'請螢幕朝上';
  //   'quality-red'→'請遠離金屬,手持手機畫 8 字';'not-running'→`請先按「${startLabel}」。`;其他→'還沒有讀到方位資料,請稍等一下。'
export const STABILITY_LABEL;             // reasonKey → 短標籤(5.7),例:steady → '手拿得很穩'、ios-wide → '誤差有點大'
export function accuracyView(reading)
  // → { level:'green'|'yellow'|'red'|'unknown', bars:0..3, label: STABILITY_LABEL[reasonKey], reasonKey, reason, accuracyDeg:number|null }
  // 例:{status:'ok', accuracyDeg:8, sigmaDeg:1, quality:'green'} → { level:'green', bars:3, label:'手拿得很穩', reasonKey:'ios-ok', reason:'手機自己估計,可能差 8 度左右。', accuracyDeg:8 }
export function postureHint(reading)      // → string(可能是 ''),規則見 5.7
export function sensorSupported(win)      // → typeof win.DeviceOrientationEvent !== 'undefined'
export function inAppBrowserName(ua)      // → 'LINE'|'Facebook'|'Instagram'|null;/\bLine\//i、/FBAN|FBAV/、/Instagram/
```

### 8.3 `src/ui/easy/direction.js`
```js
export function plainDirection(bearing)
  // → null(不是有限數字)| { index:0..7, dir8:'西南', deg:整數, offset:-22.5..<22.5(順時針為正),
  //     level:'center'|'lean'|'leanMore', lean:null|'北'|'東'|'南'|'西'|'東北'…, neighbor:null|DIR8 名, paren:string|null, text, short }
  // index = Math.floor(((b + 22.5) % 360) / 45) % 8(與 geo.guaAt 一致,22.5 屬東北)
  // 主方位只講一次,偏向放括號(paren),避免「東北方,偏北較多」這種互相拉扯的說法:
  // |offset| < 7.5 → center:paren null,text '西南方'
  // 7.5 ≤ |offset| < 15 → lean:paren '稍微偏{lean}',text '{dir}方(稍微偏{lean})',例 '西南方(稍微偏南)'、'南方(稍微偏西)'
  // |offset| ≥ 15 → leanMore:paren '很靠近{neighbor}方',text '{dir}方(很靠近{neighbor}方)',例 '南方(很靠近西南方)'、'東北方(很靠近北方)'
  // 偏向字 lean:正四方(index 偶數)取 DIR8[index ± 2](北東南西之一);斜四方(奇數)取 DIR8[index ± 1];± 依 offset 正負(順時針為 +)
  // neighbor = DIR8[index ± 1](offset 為 0 時取順時針那一側,只給 sectorOf8 用)
  // short:center '西南方';其他 '{dir}方偏{lean}'
  // 例:215 → { dir8:'西南', level:'lean', lean:'南', text:'西南方(稍微偏南)' };196 → '南方(很靠近西南方)';0 → '北方'
export function sectorOf8(bearing)        // → { index, dir8, fromDeg, toDeg, distDeg: 22.5-|offset|, neighbor }
  // 例:200 → { dir8:'南', fromDeg:157.5, toDeg:202.5, distDeg:2.5, neighbor:'西南' }
export function bearingOfDir8(name)       // → 0|45|…|315|null
export function uncertaintyFor({ measureUncertainty = 5, sigmaDeg = null, spreadDeg = null, accuracyDeg = null } = {})
  // → max(measureUncertainty, 2σ, accuracyDeg, spreadDeg),略過 null 與負值(iPhone 的 −1 = 未校準);
  //   用 geo.measurementUncertainty 實作(spread 以 max 併入)
export function eightImpact(bearing, uncertaintyDeg)
  // → { near: sectorOf8(b).distDeg < max(U, 3), distDeg, dir8, neighbor /* 較近那一側的鄰居 */, fromDeg, toDeg, uncertaintyDeg:U, deg }
  // U ≤ 7.5 時與引擎 bazhai.house.boundary.nearGuaBoundary 完全一致(見 2.4)
export function shanImpact(bearing, uncertaintyDeg)
  // → { near: boundaryDistance(b) < U, distDeg, mountain, neighborMountain }(與引擎 geo.retest 相同)
```

### 8.4 `src/ui/easy/measure.js`
```js
export const CHECK_DEFAULTS = Object.freeze({ warnMaxDeg: 15 });    // 設計值:一個 24 山的寬度
export function combineChecks(readings, settings = {})
  // readings: [{ meanDeg /*磁北*/, sigma, status:'ok'|'unstable', lockedAtMs, accuracyDeg? /*iPhone 估計誤差,Android null*/ }],1 到 3 筆
  // → { n, used:number[], dropped:number|null, meanDeg /*採用者的圓周平均,磁北*/, spreadDeg /*採用者兩兩最大 circularDiff,n=1 為 null*/,
  //     sigmaMax, accuracyDeg /*採用者中非負精度的最大值,沒有為 null*/, lockedAtMs /*最後一筆*/,
  //     verdict:'single-ok'|'single-noacc'|'single-wide'|'single-unstable'|'agree'|'warn'|'far'|'dropped'|'inconsistent',
  //     uncertaintyDeg /* uncertaintyFor({measureUncertainty, sigmaDeg:sigmaMax, spreadDeg, accuracyDeg}) */ }
  // agreeMax = settings.measureUncertainty(有限數字)否則 5;warnMax = CHECK_DEFAULTS.warnMaxDeg
  // n=1:unstable → 'single-unstable';精度 > SENSOR_DEFAULTS.accuracyGreenMax(10)→ 'single-wide';沒有精度 → 'single-noacc';其他 → 'single-ok'
  // n=2:差 ≤ agreeMax → 'agree';≤ warnMax → 'warn';否則 'far'
  // n=3:兩兩都 ≤ agreeMax → 'agree';恰有一對 ≤ agreeMax 且第三筆與兩者都 > agreeMax → 'dropped'(排除第三筆,
  //      以另外兩筆算 mean/spread);否則兩兩最大差 ≤ warnMax → 'warn';否則 'inconsistent'(mean 取三筆)
  // n > 3 不接受(畫面最多 3 次)
  // 例:[196,198] → agree, spread 2;[358,3] → agree, mean 0.5, spread 5;[190,200] → warn;[170,200] → far;
  //     [196,198,230] → dropped:2;[180,200,220] → inconsistent;measureUncertainty=3 時 [196,200] → warn
export function checkVerdictText(check, lockSeconds = 3, { near = false, dir = '' } = {})
  // → { icon:'✓'|'!'|'i', text, systematic:string|null },逐字見 5.2 1D;warn(n=2)且 !near 時用「兩次都是{dir}方」的 ✓ 句
export function easyFacingPatch({ displayedDeg, basis, origin, lock = null, check = null })
  // origin:'sensor'|'pick8'|'typed'
  // → { bearing: roundTenth(rawFromDisplayed(displayedDeg, basis)), source: origin==='sensor'?'sensor':origin==='pick8'?'pick8':'manual',
  //     sigma: sensor 時 Math.round(σ*100)/100 否則 null, lockedAtMs: sensor 時整數否則 null,
  //     check: sensor 時 { n, spreadDeg: 取 1 位小數或 null, lockedAtMs, dropped: 有排除 ? 1 : 0, accuracyDeg: 取 1 位小數或 null } 否則 null,
  //     doorBearing: null }
  // 與 compass.js buildFacingPatch 在 sensor/manual 兩種情況的 bearing、sigma、lockedAtMs 相同(測試比對)
export function facingCheckOf(facing)     // → 有效的 check 或 null(source==='sensor' 且 check.lockedAtMs === facing.lockedAtMs;dropped 只能 0/1、accuracyDeg 只能非負或 null)
```

### 8.5 `src/ui/easy/layout.js`
```js
export const DOOR_SIDES = Object.freeze(['left', 'center', 'right']);
export function withDoorSide(plan, side)
  // 不改動輸入,回 { plan, moved:boolean }。大門 = plan.mainDoor 那個開口,只處理開在 'top' 牆上的大門。
  // 前後左右以「站在進門的空間中間、面向有大門的那面牆」為準。
  // 'left':原樣(深度相等)。
  // 'right':整張平面圖左右鏡射(x' = minX + maxX − x;房間、外框、牆、手動太極點都翻;上/下牆開口 pos' = 房寬 − pos,
  //   左右牆互換),大門在房子正面的右側、仍在客廳的牆上。取 0.001 精度。
  // 'center':大門 pos = L/2(L = 大門所在房間的上牆長,取 0.1)。同一面牆上與大門重疊的其他開口,移到「大門邊緣到離牆角 1 公尺處」兩段空間中
  //   離它原位置較近的那一段(兩段一樣近取右段),置中放;寬度 = min(原寬, 該段長度),取 0.1;
  //   該段長度 < editor.MIN_OPENING(0.4)就回 { plan: 原樣複本, moved:false }。
  //   例:店面單間(牆長 6):大門 3.0(寬 1.2,佔 2.4–3.6);落地窗 f1 原在 3.9 寬 2.0 → 移到右段 3.6–5.0,pos 4.3、寬 1.4。
  // 結果一律再跑 editor.checkEditedPlan,不 ok 就回 { plan: 原樣複本, moved:false }。
export function isUntouchedTemplate(plan, easyLayout)
  // → plan 與 withDoorSide(buildTemplate(easyLayout.template).plan, easyLayout.doorSide).plan 深度相等(鍵順序無關)才 true;
  //   plan 或 easyLayout 為 null → false
export function plainCornerOf(plan, corner)
  // 條件:plan.upMode 為 'facing'(或沒有)、upOffset 為 0(或沒有)、大門開口的 wall === 'top'。
  // 符合 → { TL:'前方左邊角落', TR:'前方右邊角落', BL:'後方左邊角落', BR:'後方右邊角落' }[corner],usesFrame:true
  // 不符合 → `${CORNER_NAME[corner]}(圖上的位置)`(wealth/findings.js 的 CORNER_NAME),usesFrame:false
  // → { text, usesFrame }
export function placeText(top, plan)
  // top = report.summary.wealthTop[i]。
  // kind==='dark' → { text:`${top.dir8}方`, usesFrame:false }
  // 其他 → { text:`${roomLabel(plan, top.roomId)}的${plainCornerOf(plan, top.corner).text}`, usesFrame }
  // 例:兩房範本、主臥 BR → '主臥的後方右邊角落'
```
「前、後、左、右」一律以**站在屋內、面向大門**為準:圖面上方(+y)是大門那一面 = 前方,−x = 左邊。

### 8.6 `src/ui/easy/flow.js`
```js
export const EASY_STEPS = Object.freeze(['facing', 'layout', 'result']);
export function resumeStep(state)
  // bearing 不是有限數字 → 'facing';ui.easyStep==='facing' → 'facing';
  // 有 plan → (ui.easyStep==='layout' ? 'layout' : 'result');沒有 plan → (ui.easyStep==='result' ? 'result' : 'layout')
export function nextHint(state)           // → 'plan'|'year'|'residents'|null(結果頁「想讓結果更準?」要顯示哪一項,依 5.5 順序)
export function parseYearLoose(text, nowMs)
  // 全形轉半形、去空白;可帶前綴「民國」。
  // 1 到 3 位數字 → 民國年:y = n + 1911,在 house.js yearBounds(nowMs) 內 → { ok:true, value:y, roc:n };否則 { ok:false, message:`年份要在 ${min} 到 ${max} 年之間。` }
  // 空白 → { ok:true, value:null };其他交給 house.js parseYear(text, { max, label:'建成年份' })(沿用它的錯誤訊息)
  // 例:'94' → {ok:true, value:2005, roc:94};'民國94' → 同;'2005' → {ok:true, value:2005};'12345' → ok:false
```

### 8.7 `src/ui/easy/svg.js`(純字串產生器,顏色一律用 class,樣式在 `css/c-easy.css`)
```js
export function planPreviewSvg(plan, { size = 'thumb' } = {})
  // → SVG 字串:外框、房間矩形(class c-pv-room)、大門(class c-pv-door,金色)、其他門窗(c-pv-open);
  //   size 'large' 時畫房間名稱(c-pv-label),'thumb' 不畫文字。上方 = 大門那一面。role="img",aria-label = 「{範本名或 平面圖} 預覽,大門在上方」
export function directionDiagramSvg({ upBearing, highlight })
  // → SVG 字串:正方形代表房子,上方標「大門」;8 個扇形各標方位字(字保持正立);highlight 那塊用 c-dd-hl(--wealth-bg 底、金色描邊)。
  //   圖面上方的方位 = upBearing(顯示基準下的大門朝向)。role="img",aria-label = 「方位示意圖,比較有利的是{highlight}方」
```

### 8.8 共用元件
```js
// src/ui/components/dirDial.js
export const DIAL_LABELS;                 // [{ text:'北', deg:0, major:true }, { text:'東北', deg:45 }, …] 共 8 個,順序同 geo.DIR8
export function dialGeometry(size)        // 純函式:→ { r, labels:[{text, x, y}] },給測試
export function mountDirDial(container, { size = 240, pointerLabel = '手機頂端', ariaLabel = null } = {})
  // → { set(headingDeg|null), destroy() }
  // SVG(createElementNS);整圈旋轉角用 core/luopan.js 的 dialAngleToward(目前角, heading)(359→0 不會倒轉一圈);
  // 每個方位字反向旋轉保持正立;目前方位那一格 45 度扇形用 c-dial-sector(淡金),扇形跟著圈轉,指標越靠近扇形邊緣代表越接近分界;
  // 上方固定三角指標(c-dial-pointer,不旋轉)與小字 pointerLabel;「北」用硃砂色;heading 為 null 時整圈變淡(c-dial-idle)。
  // prefers-reduced-motion 時不加 transition。容器寬 = min(容器, 260px)。
// src/ui/components/compassHelp.js
export function openCompassHelp(ctx, state, { opener = null } = {})
  // 以 ctx.openSheet 開 5.4 的面板;回傳 openSheet 的 { el, close };關閉後焦點回到 opener(沒給就用開啟當下的焦點)
```
`css/c-easy.css`:只放 `.c-dial-*`、`.c-pv-*`、`.c-dd-*`、`.c-help-*`,顏色一律 tokens(`--gold`、`--gold-bright`、`--cinnabar-solid`、`--text`、`--text-faint`、`--line`、`--wealth-bg`、`--surface-2`)。由 B 在 `index.html` 加 `<link>`。

### 8.9 `src/core/copy.js` 新增匯出(風水結論與影響句都在這裡)
```js
export const TIER_SENTENCE = Object.freeze({
  suitable: '在目前整理的候選位置中,這裡排在比較前面,較適合放置擺設或保持整潔。',
  consider: '這個位置可以考慮,但不是最突出的選擇。',
  notAdvised: '這個位置目前不建議作為財位,下面列出需要先處理的地方。',
});                                        // 從 wealthTopCards 抽出,wealthTopCards 改用它,輸出逐字不變
export const BORDERLINE_SENTENCE = '這個位置接近兩個方位的交界,請再確認平面圖的方位與尺寸。';   // 同上抽出
export const EASY_METHOD = Object.freeze({
  ming: '傳統上認為進門後斜對角遠端的牆角是財位,這個角落就是這樣找出來的。',   // 從大門算的斜對角
  mingRoom: '傳統上也把「進房門後斜對角遠端的牆角」當作財位。這個角落是從這個房間自己的房門找出來的,不是從大門。',
  corner: '這是兩面都是實牆的牆角,位置比較穩。',                                // 取自 views/wealth.js G_TEXT.twoSolidWalls
  dark: '這是依房子的方位推算出來的位置,不是房間裡的固定角落。',               // 改寫自 GLOSSARY ancai 的解釋
});
export const EASY_TITLE = Object.freeze({ spot: '你家最值得留意的財位', dark: '目前比較有利的方位', none: '目前沒有特別突出的位置' });
export const EASY_NONE_SENTENCE = '目前沒有可以列出的財位。';
export const TIER_NOTE = '「較適合、可以考慮、不建議」只是本 App 的整理排序,不保證任何結果。';
export const EASY_DOOR_WHY = '傳統上常說的財位是進門後斜對角的牆角,所以大門在哪一邊通常會影響結果。';
export const EASY_DOOR_SAME = '這個格局不管大門在哪一邊,排第一的財位都在同一個角落,所以換邊結果不變,不是選錯了。';
export const EASY_PICK8_NOTE = '方向是你自己選的大方位,會用那個方位的正中間來算。';
export const EASY_DISCLAIMERS = Object.freeze([
  '各家說法不一樣,本 App 用台灣最常見的「進門斜對角」說法。',
  '手機指北針附近有鐵門、鋼筋時可能不準。',
  '要更仔細,請找老師到現場看。',
]);
export const IMPACT_SHORT = Object.freeze({ ok: '對 8 個大方位:不影響。', near: '對 8 個大方位:接近分界,可能影響。' });
export const EASY_USE_TIP = '這樣用:保持整潔,不放垃圾桶、鏡子';   // 結果頁的一行(375px 寬放得下),由 SOFT_ADVICE 的 tidy(前半句)、noTrash、noMirror 組成

export function renderEasySummary(report)
  // 只從既有 report 衍生,不新增任何風水判斷:
  // top = report.summary.wealthTop[0]
  // → { status:'ok'|'none', kind:'ming'|'corner'|'dark'|null, tier, tierLabel, title, sentences:string[],
  //     softTips:string[], tierNote:TIER_NOTE, borderline:boolean }
  // title:沒有 top 或 tier==='notAdvised' → EASY_TITLE.none;kind==='dark' → EASY_TITLE.dark;其他 → EASY_TITLE.spot
  // kind:top.kind==='ming' → 從大門(entrance)算的 'ming',從其他房門算的 'mingRoom'(查 report.wealth.layers.ming 的 door.kind);
  //       'dark' → 'dark';其他 → 'corner'
  // sentences:[EASY_METHOD[kind], TIER_SENTENCE[top.tier], top.borderline ? BORDERLINE_SENTENCE : 省略];沒有 top → [EASY_NONE_SENTENCE]
  // softTips:report.findings 有 id==='wealth.soft.tips' 且 kind!=='dark' → SOFT_ADVICE.map(a => a.text)(core/wealth/constants.js 原文);否則 []
  // borderline:top.borderline === true
export function renderDirectionImpact({ eight = null, wealth = null, origin = 'sensor' })
  // eight = eightImpact(大門的顯示方位, U)(由呼叫端用 easy/direction.js 算好傳入;copy.js 不 import ui 檔);origin 'pick8' 時不用
  // wealth = 由 wealthStability(8.12)整理:null(還沒有平面圖或算不出來)| { status:'stable', u }
  //        | { status:'changes', change:'place', place } | { status:'changes', change:'tier', from, to }(from/to 是「較適合」等標籤)
  // origin:'sensor' | 'typed'(自己輸入度數)| 'pick8'(自己選 8 方位)
  // → { title, lines:[{ icon:'✓'|'!'|'i', head, text }] }
export function renderStabilityNote({ change, place, from, to, origin })   // 結果頁「排第一的財位會換」的提醒;沒有要提醒的回 ''
```
`renderDirectionImpact` 的逐字文案(`{retry}`:sensor「建議往旁邊走一大步再量一次。」、typed「建議用手機或羅盤再量一次。」、pick8「可以按「重新量」用手機量一次,會比較確定。」):

| 項目 | 條件 | 圖示 | head | text |
|---|---|---|---|---|
| title | sensor / typed / pick8 | — | — | 手機差幾度,會不會影響結果? / 度數差一點,會不會影響結果? / 方向選得不夠準,會不會影響結果? |
| 財位 | `wealth` 為 null | i | 財位在哪個角落 | 進門斜對角的那個角落,看的是大門在屋裡的位置,不看指北針。不過哪個角落排第一,也會參考方向;選好格局後,會再幫你檢查。 |
| 財位 | stable(pick8) | ✓ | 財位在哪個角落 | 不受影響。你選的這個大方位範圍裡,排第一的都是同一個角落。 |
| 財位 | stable | ✓ | 財位在哪個角落 | 不受影響。就算方向差 {u} 度,排第一的還是同一個角落。 |
| 財位 | changes / place | ! | 財位在哪個角落 | 可能受影響。方向差幾度,排第一的可能換成「{place}」。{retry} |
| 財位 | changes / tier | ! | 財位在哪個角落 | 位置不變,但方向差幾度,評等可能從「{from}」變成「{to}」。{retry} |
| 大門 | 不接近分界 | ✓ | 大門朝哪一方 | 不受影響。你家大門朝{dir}方,以差 {u} 度來看,還是{dir}方。 |
| 大門 | 接近分界 | ! | 大門朝哪一方 | 可能受影響。你家大門剛好在{dir}方和{nb}方中間,差幾度就可能算成另一邊。{retry} |

`renderStabilityNote` 的逐字文案:change 'place' 且 origin 為 sensor/typed → 「方向差幾度,排第一的財位可能換成「{place}」。建議回第 1 步再量一次。」;pick8 → 「你是自己選大概的方位;真正的方向如果偏一點,排第一的財位可能換成「{place}」。用手機量一次會比較確定。」;change 'tier' → 「方向差幾度,這個位置的評等可能從「{from}」變成「{to}」。」

`{u}`:整數或一位小數(去掉 `.0`);`{dir}`、`{nb}` 取自 `eight.dir8`、`eight.neighbor`。24 格(玄空)的細節不在簡單模式顯示,完整功能的報告另有 `geo.retest` 提醒。

```js
export function compassHonesty({ trueMode = false, declinationDeg = null, measureUncertainty = 5, easy = false, cityName = null } = {})
  // → { title:'手機指北針準嗎?', items:[{ head, body }], details:{ title:'給想知道細節的人', items:[{ head, body }] } },逐字見 5.4
```

### 8.10 `src/ui/sensorSession.js`
把羅盤頁的感測器判斷規則包成可注入環境、可用 `test/helpers/sensor.js` 的 `createFakeEnv` 測試的控制器;底層仍用 `createCompassSource`,不重寫解碼、平滑、鎖定。
```js
export function createSensorSession({ env, settings = {}, onChange = () => {}, relativeFailAfter = 10 })
  → {
    start(): Promise<{ ok:boolean, status:string }>,  // 必須在點擊事件裡同步呼叫;內部同步執行 createCompassSource 與 source.start()
    stop(): void,                                      // 回到 idle,移除監聽
    lock(): Promise<LockResult|null>,                  // null = 被擋、樣本不足或中斷,原因在 state.note / state.noteKey
    getState(): SessionState,                          // 凍結快照
    destroy(): void,                                   // 可重複呼叫;之後不再觸發 onChange
  }
SessionState = {
  phase: 'idle'|'starting'|'running'|'waiting'|'failed',
  failStatus: string|null,        // failed / waiting 時的原始狀態碼(畫面依它選 1M 原因句)
  message: string,                // 已對應成使用者文字(拒絕時已接上 DENIED_HELP)
  reading: Reading|null, headingRaw: number|null /* 最後一筆 ok 的 smoothedDeg,磁北 */,
  gate: { allowed:boolean, reason:string|null },   // lockAllowed(reading)
  locking: boolean, lockMs: number, lockStartedAtMs: number|null,
  note: string, noteKey: null|'too-few'|'cancelled'|'blocked',
}
LockResult = { status:'ok'|'unstable', meanDeg /*磁北*/, sigma, lockedAtMs, uncertaintyDeg }
onChange(state, kind: 'phase'|'reading'|'lock')        // reading 約每秒 20 次,畫面自行用動畫幀節流
```
- `settings` 可直接傳 `store.get().settings`;內部只挑有限數字的 `lockSeconds`、`measureUncertainty` 交給 `createCompassSource`(同 `compass.js` 現行做法)。
- 狀態轉換與 `compass.js` 現行一致:`no-events` → waiting;拒絕或權限錯誤 → failed(`message = sensorMessage(status) + DENIED_HELP`);連續 `relativeFailAfter` 筆 `relative-not-north` → failed;`no-sensor` → waiting;`start()` 回 `cancelled` 忽略。

### 8.11 `src/ui/easy/text.js`
```js
export const EASY_TEXT;                   // 凍結物件,鍵與文字 = 第 5 節所有「鍵」表格(不含 copy.js 與 sensorText.js 的項目)
export function fillText(key, vars = {}) // 代換 {name};鍵不存在丟例外;代換後仍有 {…} 丟例外(測試用)
export const EASY_TEXT_ADVANCED_KEYS;     // 允許出現術語的鍵(目前為空陣列;玄空句在 copy.js)
```

### 8.12 `src/ui/easy/stability.js`(方向差幾度,排第一的財位會不會換)
```js
export const STABILITY_STEP_DEG = 1.5;
export function topOf(report)            // → wealthTop[0] 的 { id, tier, kind, roomId, corner, dir8 } 或 null
export function reportAt(state, rawBearing, { nowMs, plan } = {})
  // 把宅向換成 rawBearing(磁北)重算 analyzeHouse(inputOf(...));有 doorBearing 時一起轉同樣的度數;可另外換平面圖
export function wealthStability(state, rawBearing, U, { nowMs, stepDeg = 1.5 } = {})
  // 朝向在 [b−U, b+U] 每隔 ≤ stepDeg 重算(由近到遠),比對 wealthTop[0]:
  // → { status:'stable'|'changes'|'unknown', u, center, alt, change:'place'|'tier'|null }
  //   id 不同 → change 'place'(alt = 會換成的那一個);id 相同但評等不同 → 'tier';算不出來 → 'unknown'。有小快取。
export function sameTopForPlans(state, rawBearing, { left, center, right })
  // 三種大門位置的排第一財位是否在同一個房間的同一個角落(暗財位比方位);算不出來回 null
```
- 只重用既有引擎,不新增風水判斷;U 與 `store.input()` 相同(`facingUncertaintyOf`)。1 次重算約 2 到 4 毫秒(桌機),U = 5 時約 9 次、U = 22.5 時約 31 次。

### 8.13 其他既有檔的新增介面
- `src/ui/store.js`:`export function inputOf(state, nowMs)`(`store.input()` 的純函式版本)、`export function facingUncertaintyOf(state)`、`export const PICK8_UNCERTAINTY = 22.5`。
- `src/ui/canvas/miniPlan.js`:`mountMiniPlan` / `layoutMiniPlan` 的 model 新增 `sectorLabels:'gua'|'dir8'`(預設 `'gua'`,完整功能不變);簡單模式傳 `'dir8'`,八方位標「北、東北…」。
- `src/ui/views/compass.js`:新增匯出 `lockNoteText`、`NEAR_FINE_ONLY`、`UNSAVED_LOCK_HINT`;`buildReadoutModel` 新增 `near8`;`lockImpactShort` 可傳 `uncertaintyDeg`。

---

## 9. 簡單模式畫面與外殼

1. **`src/ui/views/easy.js`**:`export async function mount(root, ctx)` → `{ destroy }`。
   - 畫面內狀態:`step`(由 `resumeStep` 決定,換步驟時寫 `ui.easyStep`)、`sub`(1A/1B/1C/1D/1M/1S)、`readings[]`、`session`(只建一個)、`mini`(縮圖實例)、`dial`。
   - store 訂閱只比對 `[facing, plan, building.builtYear, residents.length, settings, ui.easyStep]` 的 JSON;感測器執行中不重畫量方向面板。
   - `destroy()`:`session.destroy()`、`dial.destroy()`、`mini.destroy()`、清掉所有計時器與動畫幀、取消訂閱。
   - 所有文字只能用 `fillText` / `EASY_TEXT` / `sensorText.js` / copy.js 匯出 / `views/wealth.js` 模型欄位。
   - 大門方位一律用 `facing.doorBearing ?? facing.bearing`(與八宅相同);財位試算與 U 用 `facing.bearing` 與 `facingUncertaintyOf`。
2. **`css/v-easy.css`**:畫面 class 一律 `.v-easy-*`;另含外殼規則(唯一允許寫在畫面 css 的全域規則,另外只有簡單模式設定鈕的 `html[data-mode="easy"] #btn-settings`):
   ```css
   html[data-mode="easy"] { --tabbar-h: 0px; }
   html[data-mode="easy"] .tabbar, html[data-mode="easy"] .app-sub { display: none; }
   @media (max-width: 359px) { .app-sub { display: none; } }
   ```
   大按鈕 `.v-easy-big` 高 56px、字 18px;方位大字 `font-family: var(--font-kai)`;3×3 格每格 ≥ 64px(≤ 359px 寬時 ≥ 56px);顏色一律 tokens。
3. **`src/ui/main.js`**:刪掉本地 `TABS`,改 `import { TABS, resolveRoute, hashViewId, modeToggleTarget } from './route.js'`。`navigate()`:
   ```js
   const route = resolveRoute(hashViewId(location.hash), store.get().ui);
   if (location.hash !== route.canonicalHash) history.replaceState(null, '', route.canonicalHash);
   document.documentElement.dataset.mode = route.mode;
   // 銷毀舊畫面(不變)
   if (route.mode === 'pro') { renderTabs(route.view); viewEl.setAttribute('role', 'tabpanel'); viewEl.removeAttribute('aria-label'); }
   else { clear(tabbar); viewEl.removeAttribute('role'); viewEl.removeAttribute('aria-labelledby'); viewEl.setAttribute('aria-label', '簡單模式'); }
   renderModeButton(route.mode);
   store.update((d) => { d.ui.mode = route.mode; if (route.mode === 'pro') d.ui.tab = route.view; });
   const mod = await import(`./views/${route.view}.js`);
   ```
   `boot()` 綁定 `#btn-mode`:`location.hash = modeToggleTarget(store.get().ui.mode, store.get().ui)`。`ctx` 不新增欄位(`ctx.go('easy')` 與 `ctx.go('<分頁>')` 已足夠)。
4. **`index.html`**:在 `#btn-settings` 前加 `<button class="btn btn-sm btn-ghost" id="btn-mode" type="button"></button>`;加 `<link rel="stylesheet" href="css/c-easy.css">` 與 `<link rel="stylesheet" href="css/v-easy.css">`;主題預設腳本裡加一段預設 `data-mode`:hash 是 `#/easy` → easy;hash 在 `['compass','house','plan','wealth','report']` → pro;否則存檔 `ui.mode === 'pro'` → pro,其餘 easy。路徑一律相對。
5. **`src/ui/store.js`**:`DEFAULT_STATE.ui.mode = 'easy'`;`facing` 註解補上 `source` 可為 `'pick8'`、新增 `check: null`;`input()` 改由 `inputOf()` 產生,`uncertainty` 用第 6 節的 `facingUncertaintyOf`。
6. **`src/ui/repair.js`**:依第 6 節表格加修復規則,全部是「有這個鍵且不合法才修」。
7. **`src/ui/views/settings.js`**:在「外觀」之前加「介面」分組(5.6),切換時 `location.hash = mode === 'easy' ? '#/easy' : '#/' + proHomeOf(ui)` 並關閉面板;用 `controls.push({ sync })` 讓選項跟著 `ui.mode`。簡單模式時專業設定收進摺疊區(5.6)。
8. **`docs/UI_SPEC.md`**:新增「4.0 簡單模式」摘要(指向本檔),第 7 節所有權表加入簡單模式的檔案。

---

## 10. 專業羅盤頁白話化

只改 `src/ui/views/compass.js` 與 `css/v-compass.css`,文案見 5.8。
1. `sensorMessage`、`lockBlockedMessage`、`SENSOR_FALLBACK_HINT` 的本地實作改成 `export { … } from '../sensorText.js'`;第 589 行內嵌的權限說明改用 `DENIED_HELP`。`compass.test.js` 的 import 不用改。
2. `buildReadoutModel` **只新增欄位**:`plainHeading = plainDirection(b)`、`plainFacing = plainDirection(facingBearing)`;既有欄位不變。
3. 讀數列最上方加 `.v-compass-plain`(一般字重,不用楷體);原本 r1、r2 保留為第二、三行。
4. `QUALITY_TEXT` 保留匯出,值改為 `STABILITY_LABEL`;品質列下加 `.v-compass-qwhy`(`accuracyView(lastReading).reason`)。
5. 感測器卡片加 ghost 按鈕「手機指北針準嗎?」→ `openCompassHelp(ctx, store.get())`。
6. 鎖定成功的 `lockNote` 用 `lockNoteText`(5.8),24 格與 8 方位都用鎖定結果的 `uncertaintyDeg`;還沒按存檔鈕時句尾加「還沒存」提醒;「回到指北針」改成「重新跟著手機轉」;徽章區分 24 格與 8 方位。
7. **不做**:把羅盤頁的感測器狀態機換成 `createSensorSession`(見第 13 節)。

---

## 11. 測試清單(node:test,不依賴 DOM)

### 純邏輯與共用元件
- `route.test.js`:`resolveRoute` 依 3.2 表逐列(`easy`、每個分頁、空白、不認得、`mode:'pro'` 且 `tab` 壞掉 → compass);`canonicalHash` 正確;`modeToggleTarget` 兩個方向;`TABS` 每個 id 與 `easy` 都有 `src/ui/views/<id>.js`;`hashViewId('#/plan?x') === 'plan'`。
- `sensor_session.test.js`(`createFakeEnv`):有事件 → running,`headingRaw` ≈ 輸入;1.5 秒無事件 → waiting,訊息「偵測不到方位感測器」;`requestPermission` 回 denied → failed 且訊息含 `DENIED_HELP`;連續 10 筆 relative → failed;傾斜 20 度 → `gate.allowed === false`;3 秒穩定事件 → `lock()` 回 ok、sigma < 3;±8 度抖動 → unstable;未 start 就 lock → null 且 noteKey 'blocked';`stop()` 後監聽數為 0;`destroy()` 後推進時鐘不再觸發 `onChange`。
- `easy_direction.test.js`:`plainDirection` 的 0 / 7.4 / 7.5 / 15 / 22.4 / 22.5 / 196 / 215 / 225 / 337.5 / 359.9 / −30 / 725 / NaN;0 到 360 每 0.5 度掃描時 `dir8` 與 `geo.guaAt(b).dir8` 一致;8 方位 × 兩側偏向字與括號寫法全表;`text` 不含「正」;`bearingOfDir8` 來回一致;**`eightImpact(b, U).near` 與 `analyzeHouse`(朝向 b、`facing.uncertainty = U`)的 `bazhai.house.boundary.nearGuaBoundary` 在 0 到 359 每 0.5 度、U ∈ {2, 3, 5, 7} 全部一致**;U = 10 時 `eightImpact` 為真的集合包含引擎為真的集合(簡單模式較嚴格);`shanImpact(b, U).near` 與 `report.geo.retest` 一致;`uncertaintyFor` 的 max 組合(含 iPhone 估計誤差,手機說差 20 度時 150 度一定是接近分界)。
- `easy_measure.test.js`:`combineChecks` 依 8.4 的範例全部通過;單次的 ok / noacc / wide / unstable;精度進 U(取採用者最大值);跨 0 度平均;`uncertaintyDeg` = max(基準, 2σ, 差距);`checkVerdictText` 每種 verdict 的逐字文案;`easyFacingPatch` 在磁北、真北(台北)下的 sensor / pick8 / typed(真北選「西南」存的值 = `rawFromDisplayed(225)` 取 0.1);sensor 與 typed 的 bearing/sigma/lockedAtMs 等於 `compass.js buildFacingPatch` 的結果(測試檔可以 import compass.js);`facingCheckOf` 在 lockedAtMs 不同或 source 不是 sensor 時回 null;`accuracyView` 8 種 reasonKey、短標籤與優先序(Android 幾乎不晃時也不說「準」,原因句不含 ±),且燈號與 `qualityLight` 在精度 × σ 格點下一致;`postureHint` 優先序;`inAppBrowserName` 的 LINE(iOS/Android)、FBAN、Instagram、Safari、Chrome 樣本。
- `easy_stability.test.js`:兩房(大門在右)有年份時 171 度 ±5 會換位置、150 度穩定;與逐 0.5 度掃描一致;換成 `tier`;U = 0 一定穩定;不修改狀態;`sameTopForPlans` 店面三種大門都一樣;`store.input()` 的 pick8 不確定度 22.5 且有年份時報告 `geo.retest` 為真;iPhone 精度進 `store.input()`;`facing.check` 新欄位的修復;縮圖 `sectorLabels:'dir8'` 時八方位標白話方位、預設仍是卦名。
- `easy_layout.test.js`:4 範本 × 3 大門位置全部 `moved === true`,並且通過 `checkEditedPlan`(ok 且無警告)、只有一個大門且在上牆、主要房間都有門、門窗離角落 ≥ 1 公尺(同 `plan_templates.test.js` 規則)、`analyzeHouse` 可跑完;`'left'` 與原範本深度相等;`'right'` 整張圖鏡射(大門絕對位置 x' = 房子寬 − x、在右半邊,房間與開口的牆一起翻);**朝向 180、`studio`,大門「左邊」與「右邊」算出的明財位候選(`wealthTop` 裡 `kind === 'ming'` 那一筆)不同**(實算:左邊是臥室左下角,右邊是客廳左下角;客廳原本的斜對角被廚房門擋住,所以不是單純左右互換);`isUntouchedTemplate`:剛產生 → true、動任一房間頂點 → false、plan 為 null → false;`plainCornerOf` / `placeText`:facing 上方 → 前後左右說法,`upMode:'north'` 或 `upOffset ≠ 0` → 「左上角(圖上的位置)」,暗財位 → 「東北方」。
- `easy_svg.test.js`:`planPreviewSvg` 對 4 範本輸出以 `<svg` 開頭、恰有一個 `c-pv-door`、沒有寫死的色碼(`#` 開頭的十六進位色)、large 含房間名稱;`directionDiagramSvg` 8 個方位字都在、highlight 那塊有 `c-dd-hl`。
- `easy_flow.test.js`:`resumeStep` 各分支;`nextHint` 順序;`parseYearLoose` 依 8.6 範例,超過今年 → 錯誤。
- `easy_text.test.js`:`EASY_TEXT` 所有字串與 `sensorText.js` 匯出字串不含術語黑名單(`宮`、`明財位`、`暗財位`、`八宅`、`玄空`、`飛星`、`山星`、`向星`、`命卦`、`宅卦`、`坐向`、`空亡`、`兼`、`卦`、`分數`)、不含恐嚇詞(`大凶`、`絕嗣`、`敗財`、`保證`)、不含英文內部 id、不含本機路徑樣式(`/[A-Za-z]:\\/`);`fillText` 缺值會丟例外。
- `test/easy_copy.test.js`:**`renderReport` 對既有 fixtures 的輸出與改動前逐字相同**(抽常數後);`renderEasySummary` 用下列情境:兩房 225 度無年份、套房 180 度 2005 年、無平面圖 90 度、三房 10 度 1998 年、全部不建議;檢查句數 1 到 3、每句屬於允許集合(`EASY_METHOD`、`TIER_SENTENCE`、`BORDERLINE_SENTENCE`、`EASY_NONE_SENTENCE`)、無術語黑名單、`findScoreLeaks` 抓不到分數、無平面圖時 `softTips` 為空、有 `wealth.soft.tips` 時 `softTips` 等於 `SOFT_ADVICE` 全部文字;`renderEasySummary` 從房門算的斜對角用 `EASY_METHOD.mingRoom`;`renderDirectionImpact` 與 `renderStabilityNote` 各分支逐字;`compassHonesty` 主要四項與細節兩種北基準都與 5.4 表逐字相同、`declinationDeg` 為 null 時代「4 到 5」、簡單模式不提設定;所有新字串通過 `scrubText` 後不變。

### 簡單模式畫面與外殼
- `easy_store.test.js`:新 store 的 `ui.mode === 'easy'`;舊存檔沒有 mode → 'easy';存 'pro' 保留;mode 為 'x' / 5 / null → 'easy';`easyStep`、`easyLayout`、`easyIntroShown`、`source`、`check` 的壞值修復;`repairDraft(GOOD)` 仍回 false(GOOD 同 `repair.test.js`,沒有新鍵);`parseBackup` 讀舊備份得到 'easy';`input().facing.uncertainty`:沒有 sigma 與 check → null、sigma 2 → 5、sigma 4 → 8、check 差距 7 且 lockedAtMs 相符 → 7、lockedAtMs 不符 → 忽略差距、`measureUncertainty: 8` 且 sigma 1 → 8。
- `easy_shell.test.js`:`index.html` 有 `#btn-mode`、連結 `css/c-easy.css` 與 `css/v-easy.css`、內嵌腳本的分頁 id 陣列等於 `TABS` 的 id;`main.js` 從 `./route.js` import 且不再宣告 `const TABS`;沒有以 `/` 開頭的資源路徑;`views/easy.js` 原始碼(去掉註解後)沒有中文字串常值,文字都來自 text.js / copy.js / sensorText.js / `views/wealth.js` 模型欄位。

### 專業羅盤頁
- `compass_plain.test.js`:`lockNoteText` 各分支逐字、`near8`、「重新跟著手機轉」;`buildReadoutModel({ heading: 215 }).plainHeading.dir8 === '西南'`;量坐、heading 35 → `plainHeading.dir8 === '東北'`、`plainFacing.dir8 === '西南'`;`compass.js` 的 `sensorMessage`、`lockBlockedMessage` 與 `sensorText.js` 匯出的是同一個函式(`===`);`QUALITY_TEXT` 等於 `STABILITY_LABEL`。既有 `compass.test.js` 全部維持通過。

### 全體
- 在 `fengshui/` 執行 `node tools/gen-sw.mjs`,再執行 `npm test`:0 失敗,2 項 todo 不變;`pwa.test.js` 確認新 js / css 都在預載清單。

---

## 12. 驗收條件(瀏覽器,UI_SPEC 第 6 節流程)

用本機伺服器(`npm run serve`,port 5180)自己開一個分頁,每個呼叫都帶 `tabId`。

1. **尺寸與主題**:375×812、320×640、1280×800 各截圖;深色與淺色各一次。320 寬沒有水平捲動、標題列按鈕不被擠掉、3×3 格不換行。主控台 0 錯誤、0 警告。
2. **觸控目標**:用 `javascript_tool` 列出簡單模式所有 `button, a, input, select, summary, [role=button]` 的 `getBoundingClientRect()`,高度與寬度都 ≥ 44px(3×3 格 ≥ 56px)。
3. **首次開啟**:清空資料 → 直接看到簡單模式第 1 步,沒有分頁列與標題摘要;網址被補成 `#/easy`。
4. **Android 樣式量測**:連續送 `window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 145, beta: 0, gamma: 0, absolute: true }))`(alpha 逆時針,145 = 方位 215)→ 大字「西南方」、讀數正常時沒有提醒行 → 就是這個方向 → 3 秒 → 1D 標題「大門朝:西南方」、主按鈕「下一步」、小連結「再量一次」(`single-noacc` 的結論句在「看說明」裡)→ 再量一次(alpha 147)→「看說明」裡是 `agree`「2 次只差 2 度」→ 下一步 → 進步驟 2。
5. **iOS 樣式**:送 `'deviceorientation'` 事件並以 `Object.defineProperties` 加 `webkitCompassHeading` 與 `webkitCompassAccuracy` = 8 / 18 / 40 / −1 → 依序出現 `ios-ok`、`ios-wide`、`ios-bad`、`uncalibrated` 的原因句;−1 時「就是這個方向」被擋並顯示原因。精度 20、方位 196 時記下 → 1D 為 `single-wide`:一行「這次不太穩…」、主按鈕「再量一次」,「看說明」裡影響區塊的大門那一項是「可能受影響」。
6. **姿勢**:送 beta = 40 → 顯示「手機有點斜,請放平(傾斜 40 度)」且不能記下;放平後擋下的訊息自動消失。
7. **接近分界**:alpha 使方位 = 201 → 1D 顯示一行「剛好在南方和西南方中間…」與主按鈕「再量一次」。
8. **格局**:選「2 房 1 廳」,切換左 / 中 / 右,預覽的金色大門跟著移動,「右邊」時大門在房子正面的右側;選「店面單間」時說明改成 `EASY_DOOR_SAME`,「正中間」不出錯。
9. **結果**:縮圖有「財」,四周是「北、東北…」而不是卦名;位置文字是「某房間的前方/後方左邊/右邊角落」,不含「宮」「明財位」;填年份「94」即時顯示「民國 94 年 = 西元 2005 年」,填好後結果重算;朝向 171 度有年份時出現一行「方向差一點,財位可能換到…」提醒;沒有「完成」按鈕。
10. **重新整理**:回到第 3 步,資料都在。
11. **切換**:按「完整功能」→ 5 個分頁都在,財位頁的最佳位置與簡單模式相同 → 按「上一頁」回到簡單模式 → 按「簡單模式」鈕回到第 3 步。
12. **不覆蓋**:在完整功能拖動平面圖的一個房間 → 回簡單模式第 2 步顯示「你已經畫好平面圖了」,平面圖沒被換掉。
13. **復原**:第 1 步重量後按 toast 的「復原」,舊朝向回來;第 2 步「先跳過」後按「復原」,範本回來。
14. **桌機無感測器**:按「開始量」1.5 秒後進 1M 並顯示「偵測不到方位感測器…」;選「東南」→ 1S 出現一次 `EASY_PICK8_NOTE` → 走完流程,結果頁在排第一的位置會換時出現 pick8 版提醒。
15. **權限被拒**:模擬 `DeviceOrientationEvent.requestPermission = async () => 'denied'` → 1M 顯示權限說明;把 UA 改成含 `Line/` → 多出 LINE 提示。
16. **說明面板**:在簡單模式與完整功能羅盤頁都能打開「手機指北針準嗎?」;切成真北後內容換成真北版本。
17. **專業羅盤頁**:同一組事件下白話行正確;拖曳後變「上方「向」那一端指著:…」;量坐時兩段文字正確;鎖定後 lockNote 是「已記下約…度。…對 8 個大方位:…」並提醒還沒存,按存檔鈕後提醒消失。
18. **讀屏與動畫**:步驟條有 `aria-current="step"`;方位只在換格時念一次;`prefers-reduced-motion` 下方向圈與進度環沒有動畫、倒數文字照走。
19. **收尾**:`node tools/gen-sw.mjs` → `npm test` 全過;切換模式與步驟後沒有殘留的 `deviceorientation` 監聽(用 `getEventListeners` 或計數檢查)。

回報時附:截圖檢查了什麼、發現並修掉的問題、仍存在的問題。不可只說「看起來正常」。

---

## 13. 這次不做

- **「向」的流派差異**:公寓大樓傳統上常以陽台或主採光面為向(`house.js` 的 `FACING_ADVICE`),簡單模式一律把大門朝向當成宅向。完整功能保留分開設定;簡單模式量過會把 `doorBearing` 設回 null(可復原)。
- **真手機實測與門檻調整**:燈號、σ、15 度「差很多」、偏向分級都是設計值;`device_compass.md` 第 8 節的實機清單還沒做。
- **羅盤頁改用 `createSensorSession`**:目前兩份狀態機並存,只有訊息文字已合一;遷移另外處理。
- **自己選的大方位在完整功能報告裡的專屬標示**:`house.js`、`report.js` 不改;改由 `store.input()` 送 22.5 度的不確定度,報告既有的「建議再確認」提醒會出現。
- **完整報告的「兼向」「空亡」精度提醒**:需要約 2 度的精度,手機做不到;目前只寫在「手機指北針準嗎?」的細節裡,`renderReport` 的輸出不改。
- **簡單模式裡編輯平面圖、自訂矩形範本、填住戶與整修資料**:一律導向完整功能。
- **簡單模式步驟走網址**:步驟不寫進 hash,Android 返回鍵不會回到上一步(會回到上一個模式或離開)。
- **既有小問題**:「用這個朝向」提示蓋住按鈕、平面圖小螢幕標籤重疊、盤面沒有內嵌楷體字型、iPhone 主畫面版「匯出備份」未實機確認。
- **iPhone 內建指南針的預設值**:查證前不在文案裡斷言。

---

## 14. 風險與緩解

| 風險 | 緩解 |
|---|---|
| iOS 只有在點擊當下同步呼叫 `start()` 才會跳權限視窗;桌機模擬測不出來 | 規格明寫「不可先 await 或重畫」;`sensor_session.test.js` 驗證 `start()` 同步呼叫 `requestPermission`;真機驗證列在第 13 節 |
| 舊使用者更新後被切到簡單模式,以為功能不見 | 一次性 toast、標題列常駐「完整功能」鈕、設定面板可切換、記住上次模式 |
| 範本只是近似,財位角落可能與真實的家不同 | 文案寫「大概像就好」;大門左/中/右;結果頁與步驟 2 都有到完整功能細調的出口;免責文字 |
| 大門「正中間」時店面的落地窗要讓位,移動規則寫錯會讓平面圖不合法 | `withDoorSide` 失敗一律回原樣並提示;4 × 3 組合全部由測試跑 `checkEditedPlan` 與 `analyzeHouse` |
| 抽出 `TIER_SENTENCE` 等常數時改變了 `renderReport` 的輸出 | `test/easy_copy.test.js` 逐字比對改動前後輸出,既有 copy、report、integration 測試全部要過 |
| 自己選 8 方位時存的是正中間,引擎當成精確值排玄空盤 | `store.input()` 送 22.5 度的不確定度;簡單模式以 ±22.5 度重算,排第一的位置會換才提醒 |
| `mountMiniPlan.update` 換標記在財位頁只測過 `setSelected` | 驗收第 9 項實測切換「其他位置」 |
| 改了檔案卻忘了重新產生 sw.js,手機卡在舊版 | 每次改完都跑 `node tools/gen-sw.mjs`;`pwa.test.js` 把關 |
| 320px 寬時完整功能的標題列太擠 | `.app-sub` 在 < 360px 隱藏;驗收第 1 項截圖確認 |
| 簡單模式依賴 `views/compass.js` 的 `parseBearingInput`,改羅盤頁時可能弄壞 | 改 compass.js 時保留所有既有匯出與簽章;`compass.test.js` 把關 |
| 每次畫面重畫都重算「方向差幾度會不會換財位」,手機上變慢 | 有快取(同一組資料不重算);取樣間隔 1.5 度,U = 5 時約 9 次重算 |

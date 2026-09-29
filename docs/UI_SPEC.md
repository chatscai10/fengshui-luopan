# 風水羅盤 App 介面規格 (UI_SPEC)

- 讀者: 實作各畫面的工程師。領域規則以 `docs/DOMAIN_SPEC.md` 為準;引擎介面以 `docs/API.md` 與 `src/core/*` 為準(引擎完成後才存在)。
- 使用者: 台灣繁體中文一般人,**不懂風水術語也不懂程式**。這個 App 的價值是「量出朝向 → 填幾個資料 → 看到自己家的財位在哪、為什麼、怎麼用」。
- 平台: 離線純 HTML/CSS/JS(ES modules、無框架、無外部資源),先在瀏覽器跑,之後用 Capacitor 包 iOS/Android。手機直式優先,桌面置中窄欄。

## 1. 設計原則

1. **白話**: 畫面文字全部繁體中文白話。術語第一次出現要用括號解釋,文案由 `src/core/copy.js` 的 `renderReport` 產生,UI 層不自己編風水結論。
2. **一次一件事**: 每個畫面只有一個主要動作(主按鈕用 `.btn-primary`)。缺資料時給「下一步」引導,不留空白。
3. **誠實**: 結論帶出處類型徽章(來源/推論/設計/少數派),不顯示精確分數,只顯示三段標籤;每頁底部有一句免責。不使用「大凶」「絕嗣」等恐嚇詞。
4. **可撤銷、不丟資料**: 所有輸入即時存(store 自動持久化),刪除住戶/房間要能復原(toast 上的「復原」)。
5. **離線、無追蹤**: 不載入任何外部資源;資料只在本機。
6. **無障礙**: 觸控目標 ≥ 44px;對比 ≥ 4.5:1(用 tokens);讀數列 `aria-live="polite"`;`prefers-reduced-motion` 時關閉慣性與脈動動畫;所有圖示按鈕有 `aria-label`;畫布有文字替代(讀數列或摘要)。

## 2. 已存在的地基(請重用,不要重寫)

| 檔案 | 用途 |
|---|---|
| `index.html` | 外殼:標題列(摘要 + 設定鈕)、`#view` 內容區、底部 5 個分頁。已連結 `css/tokens.css`、`css/base.css`、以及每個畫面各一支 `css/v-<view>.css` |
| `css/tokens.css` | 色票(深色漆面預設、淺色宣紙自動跟隨系統或設定切換)、間距、字型堆疊。所有顏色一律用 `var(--…)`,不寫死 hex(羅盤盤面的 Canvas 例外,見 4.1) |
| `css/base.css` | 共用元件 class:`.card .card-title .card-lead .btn .btn-primary .btn-ghost .btn-danger .btn-sm .btn-block .chip .badge(--good/--warn/--info/--wealth) .field .seg .switch .kv .list .sheet .toast .callout .empty .canvas-wrap .readout` 等。**先看過 base.css 再寫新樣式** |
| `src/ui/dom.js` | `h(tag, props, ...children)`、`$`、`$$`、`render`、`clear`、`debounce`、`rafThrottle` |
| `src/ui/store.js` | `createStore()` 由 `main.js` 建立並以 `ctx.store` 傳入。`store.get()`、`store.update(draft => {...})`、`store.subscribe(fn)`、`store.report()`(記憶化的 `analyzeHouse`)、`store.input()` |
| `src/ui/components/*` | `icons.js`(`icons.compass` 等 SVG 字串,用 `h('span',{html:icons.x})`)、`toast.js`、`sheet.js`(`openSheet({title, content})`) |
| `src/ui/canvas/canvasUtil.js` | `fitCanvas`(高 DPI)、`cssVar`、`KAI_STACK`、`polar`、`drawGlyphAt` |
| `src/ui/plan/coords.js` | 平面圖座標 ↔ 畫布像素共用轉換(`makeView`、`bearingOfVector`、`vectorOfBearing`、`wedgePolygon`)。**平面圖畫面與財位縮圖都必須用它**:只翻轉 y、不旋轉,圖面上方 = 平面圖 +y,圖面上方的羅盤方位角 = `planUpBearing`。已有單元測試 `test/ui/coords.test.js` |
| `src/ui/main.js` | 路由(`#/compass` 等)、載入 `views/<id>.js`、`ctx = { store, toast, openSheet, icons, go(tabId) }` |

**畫面契約**: `src/ui/views/<id>.js` 匯出 `async function mount(root, ctx)`,把內容畫進 `root`(已清空),回傳 `{ destroy() }`(要移除的監聽、計時器、感測器、`store.subscribe` 的取消函式都在這裡收乾淨)。切換分頁會先 `destroy()`。`settings.js` 另外匯出 `openSettings(ctx)`(以底部面板開啟)。

**樣式**: 每個畫面只改自己的 `css/v-<id>.css`,class 用 `.v-<id>-*` 前綴。共用元件不夠用時,在自己的 css 裡擴充,不要改 base.css(避免互相覆蓋);確實需要共用的新元件,另外提出,收進 base.css。

## 3. 狀態與資料流

```
使用者操作 → store.update(draft => …) → (持久化, 通知訂閱者) → 各畫面重繪
                                   ↘ store.report() = analyzeHouse(store.input(), settings)  (記憶化)
```

`store.get()` 形狀見 `src/ui/store.js` 的 `DEFAULT_STATE`。要點:
- `facing.bearing`(宅向羅盤讀數)為 `null` 表示尚未量測;`facing.doorBearing` 為 `null` 表示與宅向相同。
- `building.builtYear` 為 `null` 時,引擎降級(不排玄空盤,只給八宅與明財位幾何),UI 要說明「填建成年份後才能看玄空」。
- `residents[]`:`{ id, name, gender:'M'|'F', birth:'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm', utcOffsetMinutes:480 }`。命卦由引擎算,不存。
- `plan`:PlanV1(DOMAIN_SPEC 2.7.1)+ UI 專用欄位 `upMode:'facing'|'north'`、`upOffset`(度,微調旋轉)。`upMode='facing'`(預設)表示圖面「上方」= 宅向;`'north'` 表示圖面上方 = 正北。`store.input()` 會依目前北基準自動算出 `planUpBearing` 並移除這兩個 UI 欄位。**平面圖座標語意以 `docs/API.md` 與 `src/core/plan.js` 的 JSDoc 為準**(例如開口 `pos` 是相對房間外接框左下角的距離)。
- `settings`:`src/core/settings.js` 的覆寫值。設定畫面可改的項目與白話說明見 `docs/API.md` 的 Settings 表。
- `ui.tab/layer/theme`:分頁、平面圖圖層、主題。

**分析結果**: 一律 `const r = ctx.store.report()`。`r.error` 有值時顯示友善錯誤卡片而不是丟例外。文案一律用 `renderReport(r)`(`src/core/copy.js`)的 section/card,不要在 UI 硬寫風水結論。

## 4. 各畫面規格

### 4.0 簡單模式 `views/easy.js`(樣式 `css/v-easy.css`,共用元件樣式 `css/c-easy.css`)

完整規格與逐字文案見 `docs/EASY_SPEC.md`,這裡只列要點:
- **預設開啟**。網址 `#/easy` 是簡單模式,`#/<分頁>` 是完整功能;網址空白時依上次模式(`ui.mode`)。規則在 `src/ui/route.js`,只有 `main.js` 的 `navigate()` 寫入 `ui.mode`。
- 三個步驟:量方向(手機指北針或自己選 8 個方位)→ 選格局(4 個範本 + 大門在左/中/右,可跳過)→ 看財位。每步只有一個主按鈕;沒有底部分頁列與標題摘要(`<html data-mode="easy">`)。
- 標題列「完整功能 / 簡單模式」按鈕(`#btn-mode`)與設定面板最上面的「介面」分組可以切換;兩種模式共用同一個 store。
- 畫面文字只能來自 `src/ui/easy/text.js`、`src/ui/sensorText.js`、`src/core/copy.js` 與 `views/wealth.js` 的模型欄位;`views/easy.js` 不寫中文字串(`test/ui/easy_shell.test.js` 把關)。
- 使用者自己畫或改過的平面圖絕不覆蓋;會覆蓋舊資料的動作都附「復原」。

### 4.1 羅盤 `views/compass.js`(+ `src/ui/canvas/luopanRenderer.js`、`gestures.js`,樣式 `css/v-compass.css`)

**目標**: 量出「向」。這是使用者對 App 的第一印象,要像電視上的羅盤:金字漆盤、可以甩動旋轉、天心紅線固定不動。

畫面由上到下:
1. **讀數列**(`.readout`,`aria-live=polite`): 「向 175.0° · 午山(離宮 · 天元)· 坐 子」,大字度數用 `.big`。旁邊小徽章:`兼丙`(兼向)、`壓在分界線上,建議重測`、北基準(`磁北`/`真北`,點了可在設定切換)。若磁北與真北落在不同山,顯示「換成真北會變成 X 山」一行小字(規格 2.1.3 第 10 點)。
2. **羅盤盤面**(`.canvas-wrap`,正方形,寬 = min(容器寬, 420px)): 盤面規格照 DOMAIN_SPEC 2.8 全部(模式 A 環配置 r0–r7、環寬比例、字級、配色、24 山陰陽色、五行小圓點、28 宿窄宿處理、刻度)。
   - 盤面畫一次到離屏/底層 canvas,旋轉用 CSS `transform: rotate()`;第二張不旋轉的疊層 canvas 畫**天心十道**(`--cinnabar-solid` 1px 貫穿盤心的直線,上端外側一個小紅三角標「向」,下端外側標「坐」)、瞄準線與磁針(紅頭指南、黑頭指北,天池旁小字「北」)。高光/陰影畫在疊層,不畫進旋轉層。
   - 盤緣要有質感:外框金屬斜角(漸層)、盤面漆黑帶細微徑向漸層、環與環之間金色細線、盤下柔陰影。深淺主題下盤面都保持漆黑金字(不隨主題變)。
   - 字型:優先楷體堆疊(`KAI_STACK`);字型載入用 `document.fonts.load` 後再畫;格寬固定不因備援字型破版。
   - 卦象用三條線畫,不用 ☰ 字元。窄宿(觜、鬼)引線或錯位。
3. **手勢**(`gestures.js`): Pointer Events + `touch-action:none` + `setPointerCapture`;拖曳旋轉盤面(以指尖繞盤心的角度差,做角度展開 `((a-last+540)%360)-180`);放手慣性 τ=0.5s,角速度 < 0.5°/s 停;**放手前 80ms 內沒移動 → 角速度歸 0**(規格 2.8.8 已修 bug);觸點離盤心 < 0.16R 不啟動旋轉;跨過每個 15° 山界呼叫可選的輕觸覺(`navigator.vibrate?.(8)`,失敗忽略);`prefers-reduced-motion` 關閉慣性。使用 `src/core/luopan.js` 提供的拖曳/慣性/讀數純函式。
4. **感測器區**: 「使用手機指北針」按鈕(`.btn-primary`,必須由使用者點擊才啟動,不可載入就要權限)。啟動後:
   - 盤面自動跟著手機方位轉(盤角 = −航向),手動拖曳暫停感測(按「回到指北針」恢復)。
   - 品質燈號(綠/黃/紅,規格 2.9.4 第 5 點)+ 一行狀態文字(狀態碼→訊息表在規格 2.9.5,逐字使用)+ 水平氣泡(傾角 < 15° 才允許鎖定)。
   - 「鎖定讀數」按鈕:3 秒圓周平均(進度環動畫),完成後顯示 σ 與 0.5° 精度的結果、`too-few/unstable` 等提示。
   - 不支援或被拒絕時自動退回手動模式並顯示對應訊息,不留死畫面。
   使用 `src/core/sensor.js` 的 `createCompassSource`(全域由參數注入),不自己碰 `DeviceOrientationEvent`。
5. **手動微調**: 「−0.5°/＋0.5°」按鈕、「輸入度數」(數字輸入,0–359.9)、「量的是向/量的是坐」切換(量坐則自動 +180 換算成向)。
6. **主動作**: 「用這個朝向」(`.btn-primary .btn-block`)→ 寫入 `facing.bearing`(source 依來源、鎖定時寫 `sigma`、`lockedAtMs`)、toast「已設為宅向」,並詢問式引導「接著填住宅資料」(一個小連結 `ctx.go('house')`,不是彈窗)。已設定時按鈕顯示為「更新朝向」,並顯示目前已存的朝向。
7. **怎麼量?**(次要連結 → 底部面板): 4–6 句短步驟。內容依 `docs/research/orientation.md` 的量測流程與 DOMAIN_SPEC 2.1.7 精簡而成:站在哪、手機怎麼拿、遠離金屬電器、量三次取平均、大樓鋼筋干擾;並說明「向」是站在屋內面向外(通常是大門或陽台/落地窗方向)。

**空/錯誤狀態**: 桌面沒有感測器 → 顯示「這台裝置沒有指北針,請拖曳盤面或輸入度數」並預設手動模式。

### 4.2 住宅 `views/house.js`(樣式 `css/v-house.css`)

表單卡片(每張卡片一個主題,輸入即存,不需要「儲存」按鈕):
1. **朝向**: 顯示已量的向(可改數字);若引擎回報兼向/空亡/接近分界,顯示白話提醒卡(`.callout`)。「大門朝向跟房子朝向不一樣?」開關 → 展開大門朝向輸入(八宅用門向,玄空用宅向,一句話白話說明)。說明「向」怎麼選:依建築類型顯示預設建議與可選(規格 2.1.6 表),用兩三句白話,不做長篇。
2. **建築**: 類型(公寓大樓/透天/店面/辦公室 分段控制)、樓層(選填)、**建成年份**(數字,必填才能排玄空)、「有整修過嗎」(沒有/局部/大整修)→ 下方即時顯示「以 20XX 年的運來排盤:八運盤(2004–2023)」(從引擎/日曆取,不要 UI 自己算運)。
3. **住戶**: 列表卡(名字、性別、出生日期、命卦與「東四命/西四命」徽章),新增/編輯用底部面板表單(暱稱、性別分段控制、出生日期 `input[type=date]`、出生時間選填);出生日剛好在立春前後或不知時間時,依引擎的 warnings 顯示白話提醒(規格 bazhai 立春臨界)。可選「主要住戶」(戶長/主要收入者),用單選標示。刪除有復原。住戶為選填:沒有住戶時說明「填了住戶,財位建議會更貼近你」。
4. **地區與磁北**: 「羅盤讀數的北」選磁北(預設,與實體羅盤相同)/真北;選真北時顯示城市下拉(`geo.CITY_DECLINATIONS`)與目前磁偏角數值。用一句白話說明差別(台灣約差 5 度,可能換一座山)。
5. 頁尾: 完成度清單(朝向 ✓、建成年 ✓/✗、住戶(選填)、平面圖 ✓/✗)與「下一步」按鈕(缺什麼就導向哪個分頁)。

### 4.3 平面圖 `views/plan.js`(+ `src/ui/canvas/planRenderer.js`、`src/ui/plan/templates.js`、`src/ui/plan/editor.js`,樣式 `css/v-plan.css`)

**目標**: 用最少操作畫出屋內配置與大門,並看到八方位怎麼落在自己家。

1. **沒有平面圖時**: 顯示範本選擇卡片(套房、2 房 1 廳、3 房 2 廳、店面單間、自訂矩形〔輸入寬×深〕),點選即產生 PlanV1(含房間、大門、窗)。所有範本尺寸合理(公尺)。**圖面上方 = 向(房子的前方)**,大門通常在前方,因此範本的大門預設開在上牆。
2. **編輯**(`planRenderer` 畫、`editor.js` 處理互動)。座標約定照規格 2.6.2(平面圖座標 x 向右、**y 向上**、單位公尺;牆 bottom/top/left/right);Canvas 的 y 向下,由 renderer 統一翻轉,不要讓翻轉邏輯散落在互動程式各處:
   - 畫布:格線(1m 一格,淡)、房間矩形(依類型上色: 客廳/臥室/廚房/廁所/書房/玄關/陽台/樓梯,顏色取自 tokens 的柔和色相,文字用象牙)、牆(實牆實線、玻璃虛線)、門窗符號、大門特別標示(金色「門」符號 + 開啟方向弧)。
   - 疊加:**太極點**(金色小十字圈,可拖曳→切成 manual 模式)、**8 個方位扇形**從太極點放射(淡線 + 每個扇區外緣標卦名與方位「震·東」)、北方箭頭(依 `planUpBearing` 旋轉的小指北針)。圖層 chips(`ui.layer`):財位 / 八宅 / 玄空 / 流年 / 無:依圖層把每個扇區塗上吉(jade)/中性/注意(terracotta)淡色,並在扇區內顯示該層的星或標籤(八宅=星名、玄空=山星/向星、流年=流年星)。點扇區 → 底部面板顯示白話解讀(文案由 `renderReport` 的對應 card)。
   - 互動:選取房間 → 拖曳移動、四角/四邊手把縮放(吸附 0.1m)、雙擊或按鈕改名稱/類型/刪除;點牆上位置 → 新增門/窗/落地窗(選單);大門用「設為大門」;「新增房間」按鈕(類型選單);兩指縮放/平移(或按鈕放大縮小);還原/重做(至少單步復原)。所有操作經 `store.update`,平面圖驗證用 `src/core/plan.js` 的 `validatePlan`,不合法時 toast 說明並復原,不丟例外。
   - 圖面朝向:預設「上方 = 房子的向」(`upMode:'facing'`),提供「圖面上方改成正北」切換(`upMode:'north'`)與微調旋轉(`upOffset`)。
   - **匯入平面圖照片(選用,不持久化)**:檔案選擇 → 畫在最底層,可調透明度/縮放/位移/旋轉,用來描著畫房間;照片只留在記憶體。
3. 底部固定一條摘要:「太極點在中央 · 客廳橫跨 離、坤 兩個方位」(由 `sectorShares` 結果組句),太極點在牆外時顯示警示與「改用外框中心」建議(規格 2.7.5)。

### 4.4 財位 `views/wealth.js`(+ `src/ui/canvas/miniPlan.js`,樣式 `css/v-wealth.css`)

**目標**: 一眼看到「你家的財位在哪、為什麼、要注意什麼」,這是產品的核心畫面。

1. 缺資料時的引導卡(缺朝向/缺平面圖/缺大門/缺建成年/缺住戶,各自一行 + 對應分頁的按鈕);有多少資料就給多少結果(規格:無平面圖只給暗財位方位;無門不給明財位)。
2. **最佳財位卡**(`.card.wealth`): 迷你平面圖(`miniPlan.js`:縮圖畫房間、太極點、金色「財」標記與脈動光圈)+ 一句話結論(「客廳的遠端右角,在房子的東方(震宮)」)+ 三段標籤(很適合/可以/偏弱,不顯示分數)+ 出處徽章。下方「為什麼」列表(明財位/八宅生氣位/玄空旺星/流年/命卦 各貢獻一行白話)與「現況檢查」清單(✓ 兩面實牆、✗ 角落有窗 → 補救辦法)。
3. **其他候選**: 依排序列出 2–4 張較小卡片(同結構,可展開)。永遠包含明財位(規格 2.6.7),即使排名不高也標明。
4. **這一年要留意的位置**(流年): 五黃/二黑/太歲/歲破/三煞落在哪個方位、哪個房間(用 `sectorShares` 的 mainUse),白話一兩句與化解小提醒,語氣平和。
5. **催財小提醒**: 來自 `renderReport` 的擺設卡片(標「傳統說法」徽章);魚缸/放水依 `allowWaterHint` 設定。
6. 頁尾免責一句。

### 4.5 報告 `views/report.js`(+ `src/ui/canvas/starGrid.js`,樣式 `css/v-report.css`)

完整分析,由 `renderReport(r).sections` 逐區塊渲染成折疊卡片(預設只展開「總覽」):
- 總覽(一段白話摘要 + 三個重點)。
- 房屋坐向(24 山、宅卦、兼向/空亡提醒、磁北真北並列)。
- 八宅(每位住戶的命卦、八方位吉凶表、床/書桌/爐灶/大門建議,命宅相配)。
- 玄空飛星:**九宮星盤圖**(`starGrid.js`,DOM/SVG 皆可):傳統南上排列(上排 巽 離 坤,中排 震 中 兌,下排 艮 坎 乾),每宮顯示山星(左上)、向星(右上)、運星(下),並以顏色標旺(金)/退(灰)/煞(赭);格局名稱徽章(旺山旺向等)+白話解釋。九宮圖是羅盤方位圖(3×3 只能表示 90° 倍數),**不做旋轉切換**;圖旁加一行小字說明「圖上的方位是羅盤方位,你家朝向 X」。
- 流年盤(同樣九宮圖,中宮為今年入中星)與太歲三煞。
- 各房間建議(床頭/書桌/爐灶朝向等,標「推論」的照標)。
- 附錄:採用的設定(meta.ruleset 摘要)、資料來源與免責三段。
- 動作:「複製文字報告」(`renderReport(r).plainSummary` + 各區塊純文字,`navigator.clipboard` 失敗時退回選取文字面板)、「存成圖片」(把總覽卡 + 九宮圖畫到離屏 canvas → `toBlob` → `navigator.share({files})` 或下載,失敗時 toast)。

### 4.6 設定 `views/settings.js`(`openSettings(ctx)` 底部面板,樣式 `css/v-settings.css`)

分組(全部白話,每項一行說明,進階項摺疊在「進階流派選項」下,預設不展開):
- 外觀: 主題(跟隨系統/深色/淺色)。
- 北基準: 磁北/真北(與住宅頁同步)。
- 量測: 手機量測誤差(預設 5°,選項 3/5/8)。
- 財位: 排序檔(通俗明財位/玄空進階)、放水提示、門居中只取龍邊。
- 風水流派(進階):下卦寬度、替卦、入運依據、八宅用門向或宅向、三煞範圍、顯示少數派技法等(全部清單與白話說明見 `docs/API.md` Settings 表,選項與預設值來自 `src/core/settings.js`,不要在 UI 重複寫死預設)。
- 資料: 匯出備份(下載 JSON)、匯入備份、清除全部資料(二次確認)。
- 關於: 版本、資料來源說明入口、免責聲明全文。

## 5. 視覺方向

深色漆面 + 金色細線為基調,與羅盤盤面一致;淺色為宣紙底。標題與大數字用楷體堆疊(`--font-kai`),內文用系統黑體。強調色只用金色與硃砂(僅用於天心線/重點警示),吉/注意用 jade/terracotta 淡底色塊,不靠純色紅綠區分(同時有圖示或文字)。卡片圓角 18px、細金邊、柔陰影;留白充足;動畫只有:面板滑入、財位光圈脈動、盤面慣性(全部尊重 reduced-motion)。

## 6. 驗證(每個畫面完成前必做)

1. 用本機伺服器(port 5180)開頁,**自己開一個分頁**(`tabs_create`)並之後每個呼叫都帶 `tabId`,不要碰別人的分頁、不要關閉瀏覽器面板。
2. 以 375×812(`resize_window` mobile)與 1280×800 各截圖檢查;深色與淺色(`colorScheme`)各一次;主控台無錯誤/警告(`read_console_messages`)。
3. 實際操作主流程(不是只看靜態畫面):輸入資料 → 看結果 → 重新整理後資料還在。
4. 桌機模擬感測器:`window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:90,beta:0,gamma:0,absolute:true}))`(見規格 2.9.7)。
5. 回報時附:截圖檢查了什麼、發現並修掉的問題、仍存在的問題。不可只說「看起來正常」。

## 7. 檔案所有權(避免互相覆蓋)

| 模組 | 可建立/修改 |
|---|---|
| compass | `src/ui/views/compass.js`、`src/ui/canvas/luopanRenderer.js`、`src/ui/canvas/gestures.js`、`css/v-compass.css` |
| house+settings | `src/ui/views/house.js`、`src/ui/views/settings.js`、`css/v-house.css`、`css/v-settings.css` |
| plan | `src/ui/views/plan.js`、`src/ui/canvas/planRenderer.js`、`src/ui/plan/*`(`coords.js` 除外,它是地基)、`css/v-plan.css` |
| wealth+report | `src/ui/views/wealth.js`、`src/ui/views/report.js`、`src/ui/canvas/miniPlan.js`、`src/ui/canvas/starGrid.js`、`css/v-wealth.css`、`css/v-report.css` |
| 簡單模式的純邏輯與共用元件(EASY_SPEC 第 7 節) | `src/ui/route.js`、`src/ui/sensorText.js`、`src/ui/sensorSession.js`、`src/ui/easy/*`、`src/ui/components/dirDial.js`、`src/ui/components/compassHelp.js`、`css/c-easy.css`;`src/core/copy.js` 的簡單模式匯出 |
| 簡單模式畫面(EASY_SPEC 第 7 節) | `src/ui/views/easy.js`、`css/v-easy.css`;外殼接線在 `index.html`、`src/ui/main.js`、`src/ui/store.js`、`src/ui/repair.js`、`src/ui/views/settings.js` |

每個模組可另外新增自己的純邏輯測試 `test/ui/<view>*.test.js`(node:test,不可依賴 DOM)。

地基檔(`index.html`、`main.js`、`store.js`、`base.css`、`tokens.css`、`dom.js`、`components/*`、`canvasUtil.js`、`plan/coords.js`)改動時要一併檢查所有畫面;在畫面裡發現地基問題,另外提出,不要在畫面檔裡繞過。

# 手機指北針取得方式與同類 App 前例(device_compass)

- 研究日期:2026-09-29(網路可用,`webAvailable = true`)
- 目標平台:Capacitor 8(iOS 15+ WKWebView、Android 7+ System WebView),純 HTML/CSS/JS,離線可跑
- 信心標記:`(信心: 高|中|低|未知)`。高 = 有官方文件或原始碼佐證且已用程式驗證;中 = 有來源但含推論或屬設計值;低 = 單一來源或未驗證;未知 = 找不到證據。
- 檔案:測試向量 `test/fixtures/device_compass.json`(99 筆)。

---

## 0. 結論摘要

1. **不要用 `@capacitor/motion` 取羅盤方位**。它只是把 `window` 的 `deviceorientation` 事件轉手(Android 上是「相對」事件,alpha 零點任意),沒有 `requestPermission`,TypeScript 型別也只有 alpha/beta/gamma。直接自己 `addEventListener` 更簡單也更完整。(信心: 高)[S21]
2. **iOS(Safari 與 Capacitor WKWebView)**:北方只能從 `event.webkitCompassHeading`(磁北、順時針、以「直式手機的頂端」為基準)取得;`alpha` 的零點是任意的,不能當北。`webkitCompassAccuracy` 給 ±度數,`-1` = 未校準不可用。(信心: 高)[S11][S12][S16][S13]
3. **Android(Chrome 與 Capacitor Android WebView)**:要聽 `deviceorientationabsolute`(Chrome 50+;由 `TYPE_ROTATION_VECTOR` 而來,磁北)。`deviceorientation` 在 Android 是相對事件(Chrome 50+),除非 `event.absolute === true`(沒有陀螺儀的裝置才會退回絕對感測器)。手機平放時 **方位 = (360 − alpha) mod 360**。(信心: 高)[S5][S6][S8][S1]
4. **平放與直立是兩種不同的「指向」**:平放時看「手機頂端」指哪(= 360 − alpha,與 beta/gamma 無關);直立(像拍照)時看「後鏡頭」指哪(W3C 附錄 A.1 公式,平放時退化)。建議依傾角自動切換並加遲滯(進入 50 度、離開 40 度,設計值)。已用三種獨立實作 + 第四種 Rodrigues 逐步旋轉驗證。(信心: 高;切換門檻 中)[S1]
5. **權限與環境**:兩個平台都要 secure context;iOS 的 `requestPermission()` 必須在使用者手勢(點擊)內呼叫。**Capacitor iOS 的 WKUIDelegate 直接 `.grant`**,所以不會跳系統對話框,但仍需手勢。Chromium 依 MDN BCD 已在 152 加入 `requestPermission(absolute)`(預設仍回報 granted,未來可能改為詢問),程式要用「函式存在就呼叫」的寫法。(信心: 高;Chromium 152 行為 中)[S3][S4][S10][S17][S18]
6. **Info.plist / AndroidManifest**:走 Web 事件路徑時,iOS 不需要任何專屬 key 才能收 `deviceorientation`(Apple 文件列出的 `NSMotionUsageDescription` 適用對象是 CMSensorRecorder、CMPedometer 等活動類 API),Android 不需要任何權限。加一句 `NSMotionUsageDescription` 無害,但不是必要。只有使用原生 `trueHeading` 時才需要 `NSLocationWhenInUseUsageDescription`。(信心: 中)[S15][S23]
7. **原生外掛沒有明顯的精度優勢**:iOS 的 Web 路徑本來就用 `CLLocationManager.magneticHeading`,Android 的 Web 路徑本來就用 `TYPE_ROTATION_VECTOR`。原生外掛(Capawesome、Cap-go)的價值只在:回報 Android 精度、iOS 真北、iOS 校準提示。建議 v1 用 Web 事件,並把來源包成 `CompassSource` 介面,日後可換原生。(信心: 中)[S16][S8][S23][S24]
8. **平滑必須用圓周法**(單位向量 EMA 或最短弧差),`359°` 與 `1°` 的平均是 `0°` 不是 `180°`。已用 node + python 驗證。(信心: 高)[S30]
9. **不要逐事件處理,要用計時器取樣最新值**:Chromium 只在任一軸變化 ≥ 0.1° 時才發事件(最高 60 Hz),手機放著不動就沒有事件;WebKit 以 60 Hz 輪詢。建議 20 Hz 計時器取樣,即時顯示用 τ≈0.2 s 的圓周 EMA,「鎖定」用 3 秒(約 60 筆)圓周平均並算圓周標準差。(信心: 高;參數 中)[S6][S16]
10. **磁北 vs 真北**:網頁與原生的免權限讀數全是磁北。台北磁偏角約 −5°(WMM2025,magnetic-declination.com 給 −5.03/−5.06),相當於一座山(15°)的三分之一,不能忽略。建議預設磁北(與實體羅盤一致),提供「真北修正」開關。(信心: 中)[S32]
11. **桌機測試有陷阱**:Chrome DevTools「Sensors > Orientation」只驅動 **relative** 虛擬感測器,只會觸發 `deviceorientation`(absolute=false),不會觸發 `deviceorientationabsolute`。所以要有 debug 旗標把 relative 事件當 absolute,或直接 `dispatchEvent` 合成事件。已在 Chromium 152 驗證合成事件與 iOS 樣式(`webkitCompassHeading` 以 `Object.defineProperties` 模擬)。(信心: 高;DevTools 行為出自 Chromium 原始碼,未實際操作 DevTools UI)[S9][S31]
12. **同類 App 的教訓**:好評來自「鎖定讀數、手動輸入度數、平面圖/照片/衛星圖疊圖、無廣告、磁北/真北切換」;差評來自「方位不準/抖動、廣告與訂閱牆、改版變難用、台灣版出現簡體字、地圖疊圖存不了」。(信心: 中,評論樣本小)[S34][S35]

---

## 1. 建議預設一覽(決策表)

| 項目 | 建議預設 | 可選開關 | 依據 |
|---|---|---|---|
| 感測來源 | Web 事件(`deviceorientationabsolute` / `deviceorientation`+`webkitCompassHeading`) | 原生外掛(Capawesome compass)經 `CompassSource` 介面替換 | 2.2、表 T2 |
| 觸發方式 | 首頁放「啟用羅盤」按鈕,點擊後才 `requestPermission` | 無 | 2.1 |
| 事件監聽 | 有 `ondeviceorientationabsolute` 就只聽它;否則聽 `deviceorientation` | debug:把 relative 當 absolute | 2.2、2.9 |
| 指向模式 | 平放看頂端、直立看後鏡頭,50/40 度遲滯自動切換 | 「只用平放」(v1 iOS 建議) | 2.3 |
| 螢幕方向 | 鎖直式(`@capacitor/screen-orientation`) | 橫式補償(需實機驗證,見 2.4) | 2.4 |
| 取樣 | 20 Hz 計時器取最新事件 | 無 | 2.6 |
| 即時平滑 | 圓周 EMA,τ = 0.2 s | τ 0.1–0.5 s | 2.6、表 T5 |
| 鎖定讀數 | 3 秒平均,圓周 σ > 3° 判不穩 | 3/5/10 秒;連測 3 次再取圓周平均 | 2.6 |
| 顯示解析度 | 即時 1°,鎖定平均後 0.5° | 全部 0.5° | 4(分歧 7) |
| 北方基準 | 磁北 | 真北修正(手動輸入或離線 WMM 偏角) | 2.8 |
| 校準提示 | iOS:accuracy < 0 或偏大時提示;Android:以抖動 σ 判斷 | 原生外掛取得 Android 精度 | 2.7 |
| 降級 | 手動輸入度數 + 拖曳旋轉盤面 | 從地圖/平面圖建築邊緣取方位 | 2.9 |

---

## 2. 規則與演算法(逐步,可直接寫成程式)

### 2.1 前置條件與權限流程

1. **Secure context**:所有 DeviceOrientation 介面標有 `[SecureContext]`(W3C、WebKit IDL);Chromium 的 absolute controller 在 `!IsSecureContext()` 時直接不掛事件。Capacitor 預設 iOS 用 `capacitor://localhost`、Android 用 `https://localhost`;WebKit 對「由 scheme handler 處理的自訂 scheme」與 `localhost` 主機都視為 potentially trustworthy,所以兩者都是 secure context。啟動時仍要檢查 `window.isSecureContext`。(信心: 高)[S1][S7][S17][S19]
2. **iOS 手勢要求**:`DeviceOrientationEvent.requestPermission()` 在「權限狀態為 prompt 且沒有使用者手勢」時會 reject `NotAllowedError`(WebKit 訊息:Requesting device orientation access requires a user gesture to prompt)。狀態不允許使用(如 Permissions Policy)時 resolve `"denied"`。決定會按來源快取在 website data store,App 重開才會重置。(信心: 高,出自 WebKit 原始碼)[S17]
3. **Capacitor iOS**:`WebViewDelegationHandler.swift` 實作 `requestDeviceOrientationAndMotionPermissionFor` 並回 `.grant`(8.0.0 已逐行確認;另檢查 4.0.0、4.6.0、5.0.0、6.0.0、7.0.0 五個 tag 皆含此函式名稱)。因此 WKWebView 內不會出現系統詢問,但第一次呼叫仍要在手勢內。若沒有實作此 delegate,Apple 文件與 WebKit 原始碼都是回傳 `.prompt`(顯示系統警示)。(信心: 高)[S14][S17][S18]
4. **Chromium(含 Android WebView)**:依 MDN BCD,`DeviceOrientationEvent.requestPermission` 自 Chrome 152 起存在(`chrome_android`、`webview_android` 皆 mirror 152);Chrome Platform Status 說明第一階段「只回報目前的 Motion Sensor 設定(granted/denied),不彈窗」,未來才改成預設詢問。本機以 Chromium 152 實測:`typeof DeviceOrientationEvent.requestPermission === 'function'`。程式寫法:**函式存在就呼叫(傳 `true` 表示也要磁力計),失敗不致命,再用 watchdog 確認有沒有事件**。(信心: 中,WebView 實際行為未測)[S3][S4][S10]
5. **流程**(對應 `createCompassSource().start()`,完整程式見 2.10):
   - `isSecureContext` 為 false → 狀態 `insecure-context`
   - 無 `DeviceOrientationEvent` → `unsupported`
   - `requestPermission` 為函式 → `await requestPermission(true)`;非 `granted` → `permission-denied`;例外 → `permission-error`
   - 掛事件監聽,啟動 1.5 秒 watchdog:第一個事件到達前逾時 → `no-events`(桌機、無感測器、被封鎖)
   - 頁面不可見時瀏覽器不發事件(W3C 步驟:visibility state 不是 visible 就 return),回到前景要重新計 watchdog。(信心: 高)[S1]

### 2.2 訂閱哪個事件(平台矩陣)

| | iOS Safari / WKWebView | Android Chrome / WebView | 桌面 Chrome |
|---|---|---|---|
| 要聽的事件 | `deviceorientation` | `deviceorientationabsolute` | 無真實事件 |
| `ondeviceorientationabsolute` in window | 否(BCD:Safari 不支援) | 是(Chrome 50+) | 是 |
| 北方來源 | `webkitCompassHeading`(磁北) | `alpha`(磁北,逆時針) | n/a |
| `alpha` 意義 | 任意零點(相對啟動姿態) | absolute 事件:0 = 磁北 | n/a |
| `event.absolute` | 無此屬性(iOS 版 IDL 沒有) | absolute 事件為 true;`deviceorientation` 為 false,無陀螺儀時 fallback 為 true | |

判斷式:`'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'`。(信心: 高)[S4][S5][S6][S17]

Android 端事件來源:Chromium 的 `PlatformSensor.java` 把 `ABSOLUTE_ORIENTATION_QUATERNION` 對應到 `Sensor.TYPE_ROTATION_VECTOR`,`RELATIVE_ORIENTATION_QUATERNION` 對應 `TYPE_GAME_ROTATION_VECTOR`;`DeviceOrientationEventPump` 的 `deviceorientation` 先試 relative,連不上才退到 absolute 並把 `absolute` 設成 true。Android 文件說明 `TYPE_ROTATION_VECTOR` 的 Y 軸朝磁北,`values[4]` 是預估航向精度(弧度)但 Web 事件不提供。(信心: 高)[S6][S8][S25]

### 2.3 alpha / beta / gamma → 羅盤方位

**座標定義**(W3C):裝置座標 x 朝螢幕右、y 朝螢幕頂端、z 垂直螢幕朝外;姿態為內旋 Z-X'-Y'',`R = Rz(alpha) · Rx(beta) · Ry(gamma)`;`alpha ∈ [0,360)`、`beta ∈ [-180,180)`、`gamma ∈ [-90,90)`;旋轉為右手定則,所以 alpha 方向與羅盤方位相反。世界座標取 x = 東、y = 北、z = 上,方位 = 由北順時針 = `atan2(東分量, 北分量)`。(信心: 高)[S1]

三個常用方位都是「裝置某一軸投影到水平面」:

| 名稱 | 裝置軸 | 世界向量(東, 北) | 何時可靠 |
|---|---|---|---|
| `top` 頂端方位 | +Y | `(−cosβ · sinα , cosβ · cosα)` | 平放或略後仰;與 gamma 無關;`cosβ>0` 時 = `(360−α) mod 360` |
| `back` 後鏡頭方位 | −Z | `(−cosα·sinγ − sinα·sinβ·cosγ , −sinα·sinγ + cosα·sinβ·cosγ)`(W3C 附錄 A.1 的 Vx, Vy) | 直立或斜舉;完全平放時兩者為 0,退化為 null |
| `right` 右緣方位 | +X | `(cosα·cosγ − sinα·sinβ·sinγ , cosγ·sinα + cosα·sinβ·sinγ)` | 橫放且平放時當螢幕上方用 |

驗證要點(已用程式驗證):
- 平放:`alpha = 90, beta = 0, gamma = 0` → 頂端朝西(270°),正是 W3C 原文範例。
- 直立(`beta = 90`)時 W3C 的一致性檢查 `θ = −(alpha + gamma)`:`alpha=0, gamma=10` → 350°。
- 橫放直立(W3C 範例):使用者面向 H,螢幕頂端在其右手邊 → `alpha = 270 − H, beta = 0, gamma = 90`,後鏡頭方位 = H。
- 只有俯仰(gamma = 0)時,頂端方位與後鏡頭方位在同一鉛直面,兩者相等(`alpha=315, beta=60/80` 皆 45°)。

**模式選擇**:`tilt = acos(|cosβ · cosγ|)`(螢幕平面與水平面的夾角,0 = 平放,90 = 直立)。`top` 模式下 `tilt > 50°` 切到 `back`;`back` 模式下 `tilt < 40°` 回到 `top`;中間維持原模式。門檻是設計值,不是來源規定。(信心: 中)

**iOS 的特別處理**(信心: 中):
- `webkitCompassHeading` 出自 `CLLocationManager.heading.magneticHeading`(WebKit `WebCoreMotionManager.mm`:`double heading = (m_headingAvailable && newHeading) ? newHeading.magneticHeading : 0;`),未設定 `headingOrientation`,Apple 文件說預設以「直式時的頂端」為 0 度。所以它等同 `top` 模式,而且**不受螢幕旋轉影響**。[S16][S13]
- Twilight 專案回報:手機向後仰過垂直後,iOS 回報的航向表現得像跟著相機走(而不是頂端);他們以模擬估算,若仍按頂端假設解讀,傾角 135° 時誤差約 127°、165° 時約 175°,因應作法是只在螢幕朝上時採用羅盤讀數。這是第三方專案的回報,不是 Apple 文件。因此 **v1 建議 iOS 只在 `tilt ≤ 50°` 時採信 `webkitCompassHeading`**,其餘回報 `tilt-too-large` 請使用者放平。[S27]
- 進階做法(v1 可不做):在放平時量出 `offset = webkitCompassHeading − (360 − alpha)`,之後直立時用 `back(alpha,beta,gamma) + offset`。因為 iOS 的 alpha 零點任意但在一次啟動內相當穩定(陀螺儀+加速度計,不含磁力計)。此做法尚未在實機驗證。[S29][S27]

### 2.4 螢幕方向與鎖直式

- W3C:裝置座標系固定在「自然(標準)螢幕方向」上,螢幕旋轉不會改變 alpha/beta/gamma 的座標定義;Android `SensorEvent` 文件同樣寫「螢幕方向改變時軸不交換」。所以橫放時 `360 − alpha` 得到的仍是「手機自然頂端」的方位,不是螢幕畫面上方的方位。(信心: 高)[S1][S25]
- 平放且螢幕朝上時,「螢幕上方」對應的裝置軸取決於手機的實體旋轉 `deviceRotCCW`(從自然直式逆時針轉幾度):0 → +Y,90 → +X,180 → −Y,270 → −X。`screenUpHeading()` 已實作並驗證。(信心: 高,數學;映射 中)
- **`screen.orientation.angle` 在 iOS 與 Android 方向相反**(已知互通性回報):裝置順時針轉 90 度,Firefox/Chrome Android 回報 270,Safari iOS 16.4 回報 90;W3C 規格文字寫「螢幕逆時針旋轉的角度」。Android 文件:`ROTATION_90` = 裝置逆時針轉 90 度。故建議映射:Android `deviceRotCCW = angle`,iOS `deviceRotCCW = (360 − angle) mod 360`。此映射只有單一來源,需實機確認。(信心: 低到中)[S26][S25]
- **建議 v1 直接鎖直式**,避免上述映射:`@capacitor/screen-orientation` 8.0.1 可 `lock({orientation:'portrait'})`;iPad 預設允許多工,無法鎖定(需在 Xcode 勾「Requires full screen」)。若偵測到橫式(`innerWidth > innerHeight`)就顯示「請轉回直式」遮罩。(信心: 中)[S38]

### 2.5 事件解碼(`decodeOrientationEvent`)

輸出欄位:`source | headingDeg | accuracyDeg | status | mode`。優先序:iOS `webkitCompassHeading` > 絕對的 alpha/beta/gamma > 不可用。

| 輸入 | 輸出 status | headingDeg |
|---|---|---|
| `webkitCompassHeading` 為數字且 `webkitCompassAccuracy < 0` | `uncalibrated` | null |
| `webkitCompassHeading` 為負或非有限值 | `invalid` | null |
| iOS 且 `tilt > 50°` | `tilt-too-large` | null |
| iOS 其他 | `ok` | `webkitCompassHeading mod 360` |
| alpha/beta/gamma 任一為 null | `no-sensor` | null |
| `absolute !== true` | `relative-not-north` | null |
| `absolute === true` | `ok`(或 `degenerate`) | `pickHeading(...)` |

判斷依據:Apple 文件(accuracy −1 = 未校準無法使用、負的 heading = 無效)、W3C(無感測器時以 null 值發事件)、Chrome 50 部落格與 Chromium 原始碼(Android 的 `deviceorientation` 是相對的)。10 個決策表案例與參考實作已逐一比對通過。(信心: 中,決策表為文件推導)[S11][S12][S1][S5][S6]

### 2.6 取樣、平滑、鎖定平均

1. **計時器取樣**:事件處理函式只存最新值;另用 `setInterval(50)`(20 Hz)取出解碼。理由:Chromium 的 `IsSignificantlyDifferent` 以 `kOrientationThreshold = 0.1` 度過濾,且 pump 頻率上限 `kDefaultPumpFrequencyHz = 60`,手機靜止時根本沒有事件;WebKit 以 `NSTimer` 60 Hz 輪詢。實測:單一事件下,20 ms 計時器在 210 ms 內產生 11 筆讀數。(信心: 高)[S6][S16]
2. **圓周 EMA(即時顯示)**:對單位向量做指數平滑,`x += k(cosθ − x)`、`y += k(sinθ − y)`、輸出 `atan2(y, x)`;`k = 1 − exp(−dt/τ)` 使其與更新率無關。也可用最短弧差法 `h += k · circDiff(θ, h)`。兩者在 350→10 跨 0 時都不會繞到 180(fixtures group6)。**禁止**對角度數值直接做算術平均或線性 EMA。(信心: 高)[S30]
3. **參數表**(τ、k):

   | 更新率 | τ=0.1 s | τ=0.2 s | τ=0.3 s | τ=0.5 s |
   |---|---|---|---|---|
   | 60 Hz | k=0.1535 | k=0.0800 | k=0.0540 | k=0.0328 |
   | 30 Hz | k=0.2835 | k=0.1535 | k=0.1052 | k=0.0645 |
   | 20 Hz | k=0.3935 | k=0.2212 | k=0.1535 | k=0.0952 |

   95% 穩定時間約 3τ。(以 node 計算;τ 預設 0.2 s 為設計值)
4. **鎖定平均**:按下「鎖定」後收 N 秒樣本(預設 3 秒 × 20 Hz = 60 筆),算圓周平均與圓周標準差 `σ = sqrt(−2 ln R)`(R 為合成向量長度)。樣本 < 20 → `too-few`;σ > 3° → `unstable`(提示遠離金屬/重新校準);否則 `ok`。合成向量近 0(如 90° 與 270°)時平均未定義,回傳 null。注意感測誤差在時間上相關,平均後的不確定度不會照 `σ/√N` 縮小,所以要同時顯示 σ 與 iOS 的 accuracy,而不是只顯示平均值。(信心: 中,門檻為設計值)
5. **多次量測**:實務文章建議至少三次、不同時間取平均(miao-xian 教學摘要:上午 9 到 11 點磁場較穩定,此點僅單一來源)。可做「三次鎖定 → 再取圓周平均」的選項。(信心: 低)[S36]
6. **顯示**:即時讀數顯示整數度;鎖定平均後顯示到 0.5°(`roundHalf`,注意 359.8 → 0.0 要回捲)。W3C 規定事件角度精度限制在 0.1°,所以 0.1° 以下沒有意義;iOS 的 `CLLocationManager.headingFilter` 預設 1°,且 WebKit 讀的是最後送達的 heading,可推論 `webkitCompassHeading` 約以 1° 為一階(推論,未實測)。(信心: 中)[S1][S13][S16]

### 2.7 精度、校準與磁干擾

- **iOS**:`webkitCompassAccuracy` = ±度數(Apple 範例 10),`-1` = 未校準;CoreLocation 的 `headingAccuracy` 為負值代表「未校準或有強磁場干擾」。原生 App 可以透過 `locationManagerShouldDisplayHeadingCalibration` 顯示系統校準畫面,但 WebKit 的 `CLLocationManager` 沒有設定 delegate(`WebCoreMotionManager.mm` 全檔沒有 delegate),所以網頁與 WKWebView 不會出現校準提示,只能靠 App 自己提示。(信心: 高;「不會出現」為推論 中)[S12][S13][S16]
- **Android**:Web 事件沒有精度欄位。原生層有 `SENSOR_STATUS_ACCURACY_*` 與 rotation vector 的 `values[4]`;若要精度只能用原生外掛。(信心: 高)[S25]
- **8 字校準與干擾源**:Android/iOS 皆建議手持裝置畫 8 字並遠離金屬;手機殼上的金屬釦、磁吸支架、車輛、電腦都會干擾(Stonekick;`com.earth.fengshui` 開發者在 Google Play 的回覆也是同樣建議)。(信心: 中)[S33][S35]
- **UI 建議**:
  1. 即時顯示旁放「品質燈號」:綠 = iOS accuracy ≤ 10 或 Android 即時 σ ≤ 2°;黃 = accuracy 10–25 或 σ 2–4°;紅 = accuracy < 0、> 25 或 σ > 4°。門檻為設計值,需實機調整。
  2. 紅燈或 `uncalibrated` 時顯示「請遠離金屬,手持手機畫 8 字」動畫,並停用「鎖定」。
  3. 水平氣泡(用 beta/gamma):傾角 < 15° 才允許鎖定(降低感測融合誤差,且符合傳統羅盤「保持水平」的操作)。
  4. 鎖定結果顯示「±σ」與「距最近山分界 x°」;`boundaryDist < max(σ, accuracy/2, 2°)` 時顯示「接近分界,建議重測」。24 山每山 15 度的前提由「坐向判定」主題另行驗證。
  5. 誠實揭露:手機羅盤誤差量級(Apple 範例 ±10°、再加磁偏角約 5°)不適合 60 龍(6°/格)、72 龍(5°/格)、120 分金(3°/格)等細層,僅適合 24 山等級的判定。(格寬為算術:360 ÷ 層數)

### 2.8 磁北 vs 真北

- 所有免權限的 Web 與原生讀數都是**磁北**(Apple:`webkitCompassHeading` 相對磁北;Android:`TYPE_ROTATION_VECTOR` 的 Y 軸朝磁北)。真北需要位置或偏角資料:iOS 原生 `trueHeading` 需定位權限;Cap-go 外掛在沒有定位時會直接丟棄讀數(原始碼 `if heading < 0 || headingAccuracy < 0 { return }`),是個坑。(信心: 高)[S11][S25][S23][S24]
- 換算:`true = magnetic + declination`,偏角東正西負(NOAA)。台北 WMM2025 約 −5.0°(magnetic-declination.com:−5.06;搜尋結果摘要 −5.03;2021 年 vocus 文章引用 −4.75,台北磁北每年往西再漂移)。(信心: 中)[S32]
- 本次無法下載 WMM 係數檔(NOAA 位址回傳 HTML 錯誤頁),因此**沒有自行重算偏角**。建議 App 內建 WMM2025 係數離線計算(公有領域),或先以台灣本島 −5° 的手動輸入欄位起步。(信心: 未知,待驗證)
- 風水界對「用磁北還是真北」有爭論,見第 4 節分歧 1。

### 2.9 桌機模擬與降級

**模擬**:
1. **合成事件(推薦)**:
   ```js
   // Android 樣式
   window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',
     { alpha: 90, beta: 0, gamma: 0, absolute: true }));
   // iOS 樣式:DeviceOrientationEvent 建構子沒有 webkit 欄位,用 defineProperties 補
   const ev = new DeviceOrientationEvent('deviceorientation', { alpha: 90, beta: 0, gamma: 0 });
   Object.defineProperties(ev, { webkitCompassHeading: { value: 270 }, webkitCompassAccuracy: { value: 10 } });
   window.dispatchEvent(ev);
   ```
   已在 Chromium 152 驗證兩種做法(也可用 `new Event()` + `defineProperties`)。(信心: 高)
2. **DevTools Sensors > Orientation**:可輸入 alpha/beta/gamma,也可拖曳 3D 手機模型(按住 Shift 轉 alpha)。但 Chromium 的 `device_orientation_handler.cc` 只覆寫 `RELATIVE_ORIENTATION_QUATERNION` 虛擬感測器,所以只會觸發 `deviceorientation`(absolute=false)。解法:debug 旗標 `debugTreatRelativeAsAbsolute`(見 2.10),或改用合成事件。(信心: 中高,未實際操作 DevTools UI)[S31][S9]
3. **實機測試的 secure context**:手機用區網 `http://192.168.x.x` 開發伺服器**不是** secure context,事件會被擋。改用 (a) Chrome 遠端偵錯的 port forwarding 讓手機用 `localhost:PORT`;(b) `https` 隧道/mkcert;(c) 直接跑 Capacitor 原生殼(`capacitor://localhost` / `https://localhost`)。(信心: 高)[S7][S31]
4. **模擬器面板**(建議內建於 `?debug=1`):三個滑桿 alpha/beta/gamma + 「iOS 模式」勾選(附 webkit 欄位)+ 「準確度」滑桿,全部走同一條 `decodeOrientationEvent` 管線。

**降級**(無感測器、被拒絕、`no-events`、校準失敗時):
1. 手動輸入度數(0–359.9,步進 0.5,可切換「面向 / 坐」)。Luopan 等 App 也有此功能。
2. 拖曳/旋轉盤面到與參考物對齊(例如對齊地圖或平面圖上的建築邊緣)。
3. 在平面圖或衛星圖上旋轉圖片對齊真實朝向。
4. 提示使用實體羅盤讀值後手動輸入。

### 2.10 Capacitor 8 專案設定與參考程式

**專案設定**(Capacitor 8:iOS 最低 15.0、Xcode 26+;Android minSdk 24、compile/target SDK 36;Node 22+)[S20]:

| 項目 | 設定 | 說明 |
|---|---|---|
| `capacitor.config` `server.hostname` | 保持預設 `localhost` | Capacitor 文件:保持 localhost 才能使用需要 secure context 的 Web API |
| `server.iosScheme` / `androidScheme` | 預設 `capacitor` / `https` | 不要改成 http |
| iOS `Info.plist` | 走 Web 事件:不需專屬 key。建議仍加 `NSMotionUsageDescription`(例:「用來讀取手機方位以測量房屋坐向」)避免未來審核疑慮 | Apple 文件的適用 API 為 CoreMotion 活動類;加上無害(信心: 中) |
| iOS `Info.plist`(僅原生 true heading 時) | `NSLocationWhenInUseUsageDescription` | Capawesome:磁北不需權限,真北需要 |
| iOS 鎖直式 | `UISupportedInterfaceOrientations` 只留 Portrait;iPad 另勾 Requires full screen | iPad 多工無法鎖 |
| Android `AndroidManifest.xml` | 不需要任何權限 | Capawesome / Cap-go 皆註明 Android 免權限 |
| Android 鎖直式 | `android:screenOrientation="portrait"` 或 `@capacitor/screen-orientation` | |
| 外掛 | `@capacitor/screen-orientation`(8.0.1);羅盤不裝 `@capacitor/motion` | 見 2.1、表 T2 |

**核心純函式模組**(`compass-core.mjs`,無 DOM、無相依;對 99 筆 fixtures 全數通過):

```js
// compass-core.mjs : pure functions, no DOM, no dependencies (ES module)
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPS = 1e-9;

export const norm360 = (x) => ((x % 360) + 360) % 360;
/** a - b folded into (-180, 180] */
export const circDiff = (a, b) => {
  const d = norm360(a - b);
  return d > 180 ? d - 360 : d;
};
const headingOf = (east, north) => (Math.hypot(east, north) < EPS ? null : norm360(Math.atan2(east, north) * R2D));

/**
 * W3C device frame: x right, y top edge, z out of the screen. R = Rz(alpha) Rx(beta) Ry(gamma).
 * World: x East, y North, z Up. Heading = clockwise from (magnetic) north.
 * top   = heading of the +Y axis (top edge of the phone), valid when the phone is roughly flat (or leaning back).
 * back  = heading of the -Z axis (where the rear camera points), valid when the phone is roughly upright (W3C appendix A.1).
 * right = heading of the +X axis (right edge).
 * Any of them is null when that axis is (almost) vertical.
 */
export function eulerHeadings(alpha, beta, gamma) {
  const z = alpha * D2R, x = beta * D2R, y = gamma * D2R;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  return {
    top: headingOf(-cX * sZ, cX * cZ),
    right: headingOf(cZ * cY - sZ * sX * sY, cY * sZ + cZ * sX * sY),
    back: headingOf(-cZ * sY - sZ * sX * cY, -sZ * sY + cZ * sX * cY),
    zUp: cX * cY, // vertical component of the screen normal: +1 flat/screen up, 0 upright, -1 flat/screen down
  };
}

/** angle between the screen plane and the horizontal plane, 0 = flat (either face), 90 = upright */
export const tiltDeg = (beta, gamma) =>
  Math.acos(Math.min(1, Math.abs(Math.cos(beta * D2R) * Math.cos(gamma * D2R)))) * R2D;

/** choose top-edge or rear-camera heading with hysteresis (defaults are design values, not from a spec) */
export function pickHeading(alpha, beta, gamma, prevMode = 'top', enterBackDeg = 50, leaveBackDeg = 40) {
  const tilt = tiltDeg(beta, gamma);
  let mode = prevMode;
  if (prevMode === 'top' && tilt > enterBackDeg) mode = 'back';
  else if (prevMode === 'back' && tilt < leaveBackDeg) mode = 'top';
  const h = eulerHeadings(alpha, beta, gamma);
  return { mode, heading: mode === 'top' ? h.top : h.back, tilt, faceDown: h.zUp < 0 };
}

/** flat, screen-up phone: heading of the direction the on-screen "up" edge points to. rotCCW = physical CCW rotation of the phone from natural portrait */
export function screenUpHeading(alpha, beta, gamma, rotCCW) {
  const h = eulerHeadings(alpha, beta, gamma);
  switch (norm360(rotCCW)) {
    case 0: return h.top;
    case 90: return h.right;
    case 180: return h.top === null ? null : norm360(h.top + 180);
    case 270: return h.right === null ? null : norm360(h.right + 180);
    default: throw new RangeError('rotCCW must be 0, 90, 180 or 270');
  }
}

/** screen.orientation.angle -> physical CCW rotation. iOS and Android disagree on the sign (see report 2.4). */
export const screenAngleToDeviceRot = (platform, angle) =>
  platform === 'ios' ? (360 - norm360(angle)) % 360 : norm360(angle);

/** circular mean; mean=null when the resultant vector is (almost) zero */
export function circMean(anglesDeg, minR = 1e-6) {
  let s = 0, c = 0;
  for (const t of anglesDeg) { s += Math.sin(t * D2R); c += Math.cos(t * D2R); }
  const n = anglesDeg.length;
  const R = Math.hypot(s / n, c / n);
  return R < minR ? { mean: null, R } : { mean: norm360(Math.atan2(s, c) * R2D), R };
}
export const circStdDeg = (R) => (R >= 1 ? 0 : Math.sqrt(-2 * Math.log(R)) * R2D);

/** circular low-pass: exponential smoothing on the unit vector. k = 1 - exp(-dt/tau) makes it frame-rate independent */
export class CircularEma {
  constructor(tauSec = 0.2) { this.tau = tauSec; this.x = null; this.y = null; }
  reset() { this.x = this.y = null; }
  push(deg, dtSec) {
    const cx = Math.cos(deg * D2R), cy = Math.sin(deg * D2R);
    if (this.x === null) { this.x = cx; this.y = cy; }
    else {
      const k = 1 - Math.exp(-dtSec / this.tau);
      this.x += k * (cx - this.x);
      this.y += k * (cy - this.y);
    }
    return norm360(Math.atan2(this.y, this.x) * R2D);
  }
}
/** fixed-k variant used by the fixtures: k given directly */
export function emaVec(seq, k, init) {
  let x = Math.cos(init * D2R), y = Math.sin(init * D2R);
  return seq.map((t) => {
    x += k * (Math.cos(t * D2R) - x);
    y += k * (Math.sin(t * D2R) - y);
    return norm360(Math.atan2(y, x) * R2D);
  });
}

/** samples: latest heading sampled by a timer (NOT per event: Chromium only fires on >=0.1 deg change) */
export function lockAverage(samplesDeg, { minSamples = 20, maxStdDeg = 3 } = {}) {
  const n = samplesDeg.length;
  if (n < minSamples) return { status: 'too-few', n, meanDeg: null, stdDeg: null };
  const { mean, R } = circMean(samplesDeg);
  if (mean === null) return { status: 'unstable', n, meanDeg: null, stdDeg: null };
  const std = circStdDeg(R);
  return { status: std <= maxStdDeg ? 'ok' : 'unstable', n, meanDeg: mean, stdDeg: std };
}

export const roundHalf = (h) => norm360(Math.round(norm360(h) * 2) / 2) % 360;
/** distance to the nearest 24-mountain boundary, assuming 15 deg sectors centred on multiples of 15 */
export const boundaryDist = (h) => { const r = norm360(h) % 15; return 7.5 - Math.min(r, 15 - r); };
export const trueFromMagnetic = (mag, declEastPositive) => norm360(mag + declEastPositive);

/**
 * One orientation event -> one reading.
 * Priority: iOS webkitCompassHeading  >  absolute alpha/beta/gamma  >  unusable.
 * status: ok | uncalibrated | invalid | tilt-too-large | relative-not-north | no-sensor | degenerate
 */
export function decodeOrientationEvent(ev, prevMode = 'top', cfg = { enterBackDeg: 50, leaveBackDeg: 40 }) {
  const { alpha, beta, gamma } = ev;
  const wch = ev.webkitCompassHeading;
  const wca = ev.webkitCompassAccuracy;
  const hasAngles = [alpha, beta, gamma].every((v) => typeof v === 'number' && Number.isFinite(v));

  if (typeof wch === 'number') { // iOS: magnetic heading of the TOP EDGE (portrait reference), not screen-orientation compensated
    const accuracyDeg = typeof wca === 'number' ? wca : null;
    if (accuracyDeg !== null && accuracyDeg < 0) return { source: 'webkitCompassHeading', headingDeg: null, accuracyDeg, status: 'uncalibrated', mode: 'top-edge' };
    if (!Number.isFinite(wch) || wch < 0) return { source: 'webkitCompassHeading', headingDeg: null, accuracyDeg, status: 'invalid', mode: 'top-edge' };
    if (hasAngles && tiltDeg(beta, gamma) > cfg.enterBackDeg) return { source: 'webkitCompassHeading', headingDeg: null, accuracyDeg, status: 'tilt-too-large', mode: null };
    return { source: 'webkitCompassHeading', headingDeg: wch % 360, accuracyDeg, status: 'ok', mode: 'top-edge' };
  }
  if (!hasAngles) return { source: null, headingDeg: null, accuracyDeg: null, status: 'no-sensor', mode: null };
  if (ev.absolute !== true) return { source: 'alpha-relative', headingDeg: null, accuracyDeg: null, status: 'relative-not-north', mode: null };
  const p = pickHeading(alpha, beta, gamma, prevMode, cfg.enterBackDeg, cfg.leaveBackDeg);
  return { source: 'alpha-absolute', headingDeg: p.heading, accuracyDeg: null, status: p.heading === null ? 'degenerate' : 'ok', mode: p.mode === 'top' ? 'top-edge' : 'back-camera' };
}
```

**瀏覽器感測層**(`compass-source.js`;已在 Chromium 152 以合成事件端到端測過):

```js
// compass-source.js : browser layer. Depends on compass-core.mjs (decodeOrientationEvent).
// Usage: const src = createCompassSource({ decode, onReading, onStatus }); button.onclick = () => src.start();
export function createCompassSource({
  decode,                       // decodeOrientationEvent from compass-core.mjs
  onReading = () => {},         // (reading) called every sampleMs with the decoded latest event
  onStatus = () => {},          // (code, detail) 'insecure-context' | 'unsupported' | 'permission-denied' | 'permission-error' | 'no-events' | 'running'
  sampleMs = 50,                // timer sampling (20 Hz). Do NOT rely on per-event callbacks: Chromium only fires on >= 0.1 deg change.
  watchdogMs = 1500,            // no first event within this time => 'no-events' (desktop, no sensor, permission blocked)
  debugTreatRelativeAsAbsolute = false, // desktop DevTools Sensors panel only drives the relative sensor => set true in debug builds
  skipPermission = false,       // tests only
} = {}) {
  let latest = null, mode = 'top', timer = null, dog = null, running = false;

  const onEvent = (ev) => {
    latest = {
      type: ev.type, alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma,
      absolute: debugTreatRelativeAsAbsolute ? true : ev.absolute,
      webkitCompassHeading: ev.webkitCompassHeading,
      webkitCompassAccuracy: ev.webkitCompassAccuracy,
    };
    if (dog) { clearTimeout(dog); dog = null; }
  };
  const tick = () => {
    if (!latest) return;
    const r = decode(latest, mode);
    if (r.mode === 'back-camera') mode = 'back'; else if (r.mode === 'top-edge') mode = 'top';
    onReading({ ...r, t: performance.now() });
  };

  async function start() { // MUST be called from a user gesture (iOS requirement)
    if (running) return true;
    if (!window.isSecureContext) { onStatus('insecure-context'); return false; }
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) { onStatus('unsupported'); return false; }
    if (!skipPermission && typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission(true); // 'true' = also magnetometer (spec); Safari ignores the argument
        if (r !== 'granted') { onStatus('permission-denied'); return false; }
      } catch (e) { onStatus('permission-error', String(e)); return false; }
    }
    // Chromium/Android: deviceorientationabsolute (TYPE_ROTATION_VECTOR). iOS Safari/WKWebView: deviceorientation + webkitCompassHeading.
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onEvent);
    else window.addEventListener('deviceorientation', onEvent);
    if (debugTreatRelativeAsAbsolute) window.addEventListener('deviceorientation', onEvent);
    running = true;
    dog = setTimeout(() => onStatus('no-events'), watchdogMs);
    timer = setInterval(tick, sampleMs);
    onStatus('running');
    return true;
  }
  function stop() {
    window.removeEventListener('deviceorientationabsolute', onEvent);
    window.removeEventListener('deviceorientation', onEvent);
    clearInterval(timer); clearTimeout(dog); timer = dog = null; running = false; latest = null;
  }
  return { start, stop, get running() { return running; } };
}
```

注意事項:
- `App` 進入背景/回到前景時(`document.visibilitychange` 或 Capacitor `appStateChange`)呼叫 `stop()` 再 `start()`,並重新計 watchdog;回前景不需要再次手勢(Capacitor iOS 已快取 granted)。
- 若 `onStatus('no-events')` 觸發,顯示降級 UI(2.9),但保留監聽,事件一來就自動恢復。

---

## 3. 資料表

### T1 平台行為矩陣(整理自 2.x)

| 項目 | iOS Safari / Capacitor WKWebView(iOS ≥ 15) | Android Chrome / Capacitor WebView | 依據 |
|---|---|---|---|
| 北方欄位 | `webkitCompassHeading`(磁北、順時針) | `alpha` 於 `deviceorientationabsolute`(磁北、逆時針) | [S11][S1] |
| 內部來源 | CoreLocation `magneticHeading` + CoreMotion attitude | `TYPE_ROTATION_VECTOR` | [S16][S8] |
| 更新機制 | 60 Hz 輪詢最新值;heading 約 1° 一階(推論) | 最高 60 Hz,≥ 0.1° 才觸發 | [S16][S6] |
| 權限 | `requestPermission()` 需手勢;Capacitor 內 `.grant`(無彈窗) | 舊版無;Chromium 152 起有 `requestPermission(absolute)`,預設回報 granted | [S17][S18][S4][S10] |
| 精度資訊 | `webkitCompassAccuracy`(−1 = 未校準) | 無(原生層有 `values[4]`) | [S12][S25] |
| 螢幕旋轉 | heading 固定為直式頂端 | 座標軸固定於自然方向 | [S13][S1] |
| 校準 UI | 網頁與 WKWebView 不會顯示 | 不會顯示 | [S16] |
| 平放頂端方位 | `webkitCompassHeading` | `(360 − alpha) mod 360` | [S1] |
| 直立後鏡頭方位 | 不穩(見 Twilight);v1 拒絕或用 offset 追蹤 | W3C A.1 公式 | [S27][S1] |
| Info.plist / Manifest | 不需專屬 key(建議加 NSMotionUsageDescription);Android 免權限 | | [S15][S23] |

### T2 感測來源方案比較

| 方案 | iOS 來源 | Android 來源 | 權限 | 精度資訊 | 真北 | 成熟度/風險 |
|---|---|---|---|---|---|---|
| Web 事件(自寫,建議) | WebKit 內部 CLLocationManager 磁北 | `TYPE_ROTATION_VECTOR` | Capacitor iOS 自動 grant;Android 無 | iOS 有;Android 無 | 無 | 零相依;需自處理平台差異(本文已給) |
| `@capacitor/motion` 8.0.1 | 同 Web(只轉手 `deviceorientation`) | 只聽 `deviceorientation`(相對) | 不提供 `requestPermission` | 無 | 無 | 官方但不適合羅盤 [S21] |
| `@capawesome/capacitor-compass` 0.1.2(MIT,2026-07 首發) | `CLLocationManager` 磁北+真北+accuracy | `TYPE_ROTATION_VECTOR` + `getOrientation` 方位角,accuracy 來自 `values[4]` | 磁北免權限;真北需定位 | 有 | iOS 有 | 新、0.x;無傾斜補償說明;無 `accuracyChange` 事件 [S23] |
| `@capgo/capacitor-compass` 8.1.20(MPL-2.0) | `CLLocationManager.trueHeading`;無定位時讀數被丟棄 | 加速度計+磁力計自算 | iOS 需定位 | Android 有 `accuracyChange` | 有 | 星數少;iOS 行為對免定位使用者不友善 [S24] |
| 自寫小外掛 | CLLocationManager(可設 `headingOrientation`、顯示校準警示) | rotation vector + accuracy callback | 視需求 | 兩端皆有 | 可選 | 約 100 行 Swift/Kotlin;維護成本 |

### T3 同類 App 比較(2026-09 查得)

| App | 平台/模式 | 功能亮點 | 評論或商店資訊中的抱怨 |
|---|---|---|---|
| 堪輿透明羅盤 FengShui Transparent Compass(fate amtb) | iOS,付費 NT$1,290 / US$39.99;TW 4.4 星(5 筆評分) | 「立極尺」透明盤面套在地圖、相簿、拍照的房屋平面圖上;十字線、3 條輔助線、可調透明度;多種盤面(24 山、玄空盤、三合三元);檔案管理與 iCloud 備份;磁偏角可由 NOAA 取得或手動輸入,並可修正底圖角度 | TW 評論:地圖存不了、畫面偶爾變成黃底八卦盤時好時壞 |
| 巨峰風水羅盤(學成 黃) | iOS,免費 + 月/年/永久訂閱;TW 4.70 星(303 筆),US 4.13(15 筆) | 100+ 種盤;地圖與自選房屋設計圖;真北/磁北切換;羅層隱藏;手勢操作;資料保存 | RSS 取得的 TW 評論 82 筆:69 筆五星、9 筆四星、1 筆三星、3 筆一星;負評與抱怨摘要:2019 年度數偏差很大像壞掉的羅盤;2024 年「越更新越難用」;2020 年有人詢問如何去除廣告;2019 年單指無法轉盤;US 一則一星說內容都要付費 |
| Luopan: Feng Shui Compass(Manh Nguyen) | iOS,免費 + IAP(月 3.99 / 年 34.99 / 終身 149.99 美元);US 5.0 星(4 筆) | 現場、平面圖、衛星地圖三種讀數;「鎖定讀數」與「手動輸入度數」;水平氣泡;平面圖與照片可拖曳/旋轉/縮放並鎖定成一層;玄空九宮疊圖;八宅;無廣告;五種語言 | 好評強調無廣告;訂閱價格偏高 |
| 風水羅盤指南針(YANXIONG CHEN) | iOS,免費 + VIP 訂閱;TW 4.48 星(95 筆) | 24 山、坐向、農曆黃曆、與衛星地圖合一 | 2026-03 一則 2 星:付費功能卻是簡體字 |
| Feng-Shui Compass(9 Earth LLC)/ Google Play `com.earth.fengshui` | iOS + Android,免費含廣告;US 5.0 星(13 筆) | 多層羅盤(先天/後天八卦、24 山、60 甲子、64 卦、24 星宿)、九運飛星、放大檢視、反轉檢視;無資料蒐集 | 開發者在 Google Play 頁面回覆:強磁干擾後需畫 8 字校準(已在頁面內文確認);另有搜尋結果摘要提到使用者在移除手機殼磁性物後 App 曾卡死,該則於頁面內文未能確認 |
| FengShui Compass / Google Play `com.phoenix.compass` | Android,含廣告;4.29 星(約 3,679 筆評分) | 玄空飛星與八宅判定房屋吉凶、案例紀錄 | 評論:方向完全錯誤、指針一直扭動停不下來、希望加「鎖定測量方向」、詢問用真北還是磁北 |
| Feng Shui Compass: Luo Pan / Google Play `com.astro.fengshui` | Android | 24 山即時羅盤,標明磁北與真北,飛星,八宅,八字 | (樣本不足) |

註:評論僅為公開頁面可取得的小樣本(App Store RSS 與商店頁摘要),不代表整體,見 §8。

### T4 狀態碼 → 使用者訊息(繁中,台灣用語)

| status | 訊息 | 動作 |
|---|---|---|
| `insecure-context` | 目前的開啟方式無法使用感測器 | 開發者訊息;正式版不應出現 |
| `permission-denied` / `permission-error` | 需要允許「動作與方向」才能使用羅盤 | 顯示重試與手動輸入 |
| `no-events` | 偵測不到方位感測器 | 顯示手動輸入 / 拖曳盤面 |
| `relative-not-north` | 這台裝置無法提供指北資料 | 手動輸入 |
| `uncalibrated` | 羅盤尚未校準,請遠離金屬並手持手機畫 8 字 | 停用鎖定 |
| `invalid` | 方位資料無效,請稍後再試 | 忽略該筆 |
| `tilt-too-large` | 請將手機放平再讀數 | 顯示水平氣泡 |
| `unstable`(鎖定平均) | 讀數不穩定,附近可能有磁性物體 | 提示重測 |
| `too-few` | 樣本不足,請再等一下 | 繼續收集 |
| `degenerate` | 手機太接近水平,無法判定後鏡頭方向 | 切換 top 模式 |

### T5 建議參數與證據等級

| 參數 | 建議預設 | 證據等級 |
|---|---|---|
| 取樣頻率 | 20 Hz 計時器 | 事件上限 60 Hz 為原始碼事實;20 Hz 為設計 |
| 即時 EMA τ | 0.2 s | 設計 |
| 鎖定時間/樣本 | 3 s / 60 筆(最少 20) | 設計 |
| 不穩定門檻 | 圓周 σ > 3° | 設計 |
| 模式切換 | 進入 back 50°、離開 40° | 設計 |
| 允許鎖定的傾角 | < 15° | 設計 |
| watchdog | 1.5 s | 設計 |
| 品質燈號 | iOS accuracy ≤ 10 綠、10–25 黃、其他紅;Android 以即時 σ | 10 為 Apple 文件範例值;其餘設計 |
| 分界警示 | `boundaryDist < max(σ, accuracy/2, 2°)` | 設計 |
| 多次量測 | 3 次取圓周平均(選項) | 風水實務文章(單一來源) |

---

## 4. 流派/做法分歧與建議預設

| # | 議題 | 各方說法 | 建議預設 / 開關 |
|---|---|---|---|
| 1 | 磁北 vs 真北 | (a) 傳統羅盤磁針指磁北,師傅直接讀數。(b) 搜尋結果摘要(疑為 HKET 專欄《量度風水度數 風水學上的真角度與磁角度》,伺服器回 403,未取得全文,歸屬未確認)稱玄空飛星一定要用「真角度」,因星盤軌跡以北斗與真北為準。(c) vocus 文章記錄台北偏角 1973 年約 0、2021 年 −4.75°,主張保留古法架構但知道偏角變化。(d) App:巨峰有真北/磁北切換,堪輿透明羅盤可用 NOAA 偏角修正,`com.astro.fengshui` 同時標示兩種。台灣/華人圈最通行的是「直接讀羅盤(磁北)」,但玄空派討論真北修正者不少。 | 預設**磁北**(與實體羅盤、免權限讀數一致);設定內提供「真北修正」,可手動輸入偏角(預設台灣本島 −5°)或離線 WMM;畫面永遠標示目前基準。最終取捨需與「坐向判定」主題對齊。 |
| 2 | 量測姿勢:手機頂端(平放)還是後鏡頭(直立) | 傳統羅盤手持水平量測,面向外看「向」;AR 式 App 用後鏡頭。 | 預設平放頂端;直立後鏡頭自動切換為輔助,iOS v1 直立時拒絕或用 offset 追蹤。 |
| 3 | Web 事件 vs 原生外掛 | 官方 `@capacitor/motion` 被論壇評為「不夠完整」;原生外掛可提供精度與真北,但新且小。 | Web 事件為預設;`CompassSource` 介面保留原生替換;需要 Android 精度時用 Capawesome 或自寫。 |
| 4 | iOS 未實作 delegate 時是 deny 還是 prompt | Home Assistant 討論說 WebKit 直接拒絕(不彈窗);Apple 文件與 WebKit `UIDelegate.mm` 原始碼是回傳 prompt。 | 採 Apple 文件與原始碼(prompt)。Capacitor 已 `.grant`,此分歧不影響本專案。 |
| 5 | Android alpha 在傾斜時是否失準 | 一篇教學部落格稱 Android alpha 是原始磁力資料、只有放平準確;Chromium 原始碼顯示 absolute 事件來自融合後的 rotation vector,且數學上頂端方位 `360−alpha` 與 beta/gamma 無關。 | 不採部落格說法(該說法混淆了「頂端方位」與「後鏡頭方位」);依 2.3 模式切換處理。 |
| 6 | 橫式支援 | 規格上座標軸固定於自然方向;`screen.orientation.angle` iOS/Android 方向相反。 | v1 鎖直式;橫式補償列為後續並需實機驗證(2.4)。 |
| 7 | 顯示解析度 0.5° vs 1° | 任務建議 0.5°;iOS heading 推論約 1° 一階、accuracy 範例 ±10°。 | 即時 1°;鎖定平均後 0.5°;不顯示 0.1°。 |
| 8 | 鎖定時間與門檻 | 各 App 只提供「鎖定」,無公開門檻。 | 3 秒/σ ≤ 3°,設定可調;以實機資料再校正。 |
| 9 | Android 取得指北的舊法(GPS 走動校正,compass.js) | compass.js 文件說明 Android 上要請使用者到戶外前進、用 GPS 航向推算 `deviceorientation` 零點與真北的差;此作法應是 `deviceorientationabsolute` 出現前的替代方案(推論)。 | 不採用;`deviceorientationabsolute` 已直接提供磁北。 |
| 10 | 測量次數 | 教學文章建議至少三次、不同時段取平均;多數 App 只有單次鎖定。 | 預設單次 3 秒平均;提供「三次取平均」選項。 |

---

## 5. 同類 App 前例:我們該做 / 不該做

**該做**
1. 平放為預設姿勢,內建水平氣泡與「放平」提示。(Luopan 有氣泡;傳統羅盤講究水平)
2. 「鎖定讀數」按鈕(Google Play 評論明確要求;Luopan 已提供),並顯示 σ 與樣本數。
3. 明確標示磁北/真北並可切換、可輸入偏角(評論有人直接問;巨峰、堪輿透明羅盤、astro 皆提供)。
4. 手動輸入度數與拖曳盤面的降級路徑(Luopan 提供手動輸入)。
5. 平面圖、照片、衛星圖疊圖:可拖曳、旋轉、縮放、調透明度,並能鎖定成單一圖層;狀態要可靠地存檔(堪輿透明羅盤的評論抱怨地圖存不了)。
6. 校準與干擾提示:偵測不準時主動說明「遠離金屬、畫 8 字、拿掉磁吸手機殼」(Google Play 開發者回覆與評論顯示這是最常見的問題)。
7. 離線、無廣告、無登入、不蒐集資料(Luopan 好評;廣告與訂閱牆是差評主因)。
8. 台灣繁體用語與字形一致(台灣區 App Store 出現簡體付費功能被打 2 星)。
9. 版面穩定、專業:不要因改版讓核心羅盤變難用(巨峰 2024 年評論「越更新越難用」)。
10. 顯示不確定度與「接近分界」警告(同類 App 沒有,是差異化重點)。
11. 提供截圖/分享讀數(Luopan 有)。

**不該做**
1. 不要把裸 `alpha` 當北(iOS 任意零點;Android `deviceorientation` 相對)。
2. 不要對角度做算術平均或線性 EMA(359 與 1 會變 180)。
3. 不要在頁面載入時自動呼叫 `requestPermission`(iOS 需手勢,會 reject)。
4. 不要為了羅盤要求定位權限(磁北不需要;Cap-go 外掛無定位就丟讀數是反例)。
5. 不要在核心羅盤功能前塞廣告或強迫訂閱。
6. 不要在區網 `http://` 上測試感測器(不是 secure context,事件被擋)。
7. 不要顯示假精度(0.1° 即時讀數),也不要宣稱 ±1° 準確;手機羅盤適合 24 山,不適合 120 分金。
8. 不要用 `@capacitor/motion` 當羅盤,不要用 GPS 走動校正的舊法。
9. 不要讓 iPad 以為能鎖直式而不設 Requires full screen(iPad 多工無法鎖方向)。

---

## 6. 已用程式驗證的項目與結果

| 驗證項目 | 方法 | 結果 |
|---|---|---|
| alpha/beta/gamma → 頂端/後鏡頭/右緣方位(25 筆:平放 11、直立 9、橫放直立 5) | node 三種實作(矩陣連乘 Rz·Rx·Ry、W3C 附錄 A.1 閉式、四元數)+ 手推字面值 | **一致**(差 < 1e-6 度) |
| 同上 | python 第 4 種實作:依 W3C 文字逐步以 Rodrigues 軸角旋轉機體軸(不重用 Euler 公式) | **一致** |
| W3C 原文範例(alpha 90 平放 → 頂端朝西;橫放直立 alpha=270−H, gamma=90 → 後鏡頭 = H;beta=90 時 θ = −(α+γ)) | 直接代入 | **一致** |
| 螢幕上方方位(6 筆) | 矩陣向量投影 vs 閉式欄位、手推 | **一致** |
| 模式選擇與遲滯(7 筆) | node、python 交叉算傾角與 faceDown | **一致** |
| 圓周平均(359+1 → 0;350、10、0 → 0;355、5、15 → 5;179、181 → 180;90、270 與均勻分佈 → 未定義) | node + python | **一致** |
| 最短角差、0.5° 進位回捲(359.8 → 0)、分界距離、磁北→真北 | node + python | **一致** |
| 圓周 EMA 跨 0(350 → 10、359/1 抖動)與最短弧 EMA | node + python | **一致**,輸出未繞到 180 |
| 鎖定平均(60 筆跨 0:平均 359.597、σ 1.085;噪聲版判 unstable;8 筆判 too-few) | node + python | **一致** |
| 事件解碼決策表(10 筆:iOS ok/回捲/未校準/無效/過傾,Android absolute 平放/直立/fallback/relative,無感測器) | 參考實作對表 | **通過** |
| 全部 99 筆 fixtures 由「已寫入的 JSON 檔」重新推導 | `final_check.js`、`test_core.mjs` | **通過** |
| 瀏覽器端到端 | Chromium 152、`http://localhost`(secure context):合成事件、watchdog、relative 事件被忽略、debug 旗標、單一事件下計時器取樣 | **通過**(數值見 fixtures `meta.verification.browser`) |
| Chromium 152 事實:`isSecureContext=true`、`requestPermission` 為 function、`ondeviceorientationabsolute` in window、`webkitCompassHeading` 未定義 | 瀏覽器執行 | 已確認 |
| 來源事實 | WebKit、Chromium、Capacitor、Capawesome、Cap-go 的原始碼與 Apple 文件 JSON 直接讀取(非轉述) | 已確認(引用行為見各節) |

**未能驗證**:實機上的 `webkitCompassHeading` 行為(量化階數、直立時表現)、Android WebView(Chromium ≥ 152)的 `requestPermission` 行為、`screen.orientation.angle` 映射、WMM 偏角自行重算(係數檔下載失敗)、DevTools Sensors UI 的實際事件。

---

## 7. 來源清單

以下 URL 皆為本次實際開啟或直接下載閱讀(標註「摘要」者為搜尋結果摘要,未能取得全文)。

**規格與瀏覽器文件**
- [S1] W3C Device Orientation and Motion:座標定義、Z-X'-Y'' 順序、範例、附錄 A.1 方位公式與程式、`requestPermission(absolute)`、權限與事件派送條件。https://www.w3.org/TR/orientation-event/ 。原始碼 https://github.com/w3c/deviceorientation/blob/main/index.bs
- [S2] MDN DeviceOrientationEvent(屬性、`webkitCompassHeading`、`webkitCompassAccuracy`)。https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent
- [S3] MDN `DeviceOrientationEvent.requestPermission()`(參數 `absolute`、NotAllowedError、需 transient activation)。https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- [S4] MDN browser-compat-data:`deviceorientationabsolute` Chrome 50、Safari 不支援、Firefox 110;`requestPermission` Chrome 152、Safari iOS 14.5;Chrome 各版釋出日。https://github.com/mdn/browser-compat-data (`api/Window.json`、`api/DeviceOrientationEvent.json`、`api/DeviceMotionEvent.json`、`browsers/chrome.json`)
- [S5] Chrome 50 部落格:`deviceorientation` 改為相對、新增 `deviceorientationabsolute`。https://developer.chrome.com/blog/device-orientation-changes
- [S6] Chromium `device_orientation_event_pump.cc`:relative 優先、連不上才 fallback absolute、`kOrientationThreshold = 0.1`;`device_sensor_event_pump.h`:`kDefaultPumpFrequencyHz = 60`。https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_orientation_event_pump.cc
- [S7] Chromium `device_orientation_absolute_controller.cc`:非 secure context 不掛事件。https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_orientation_absolute_controller.cc
- [S8] Chromium `PlatformSensor.java`:ABSOLUTE → `TYPE_ROTATION_VECTOR`、RELATIVE → `TYPE_GAME_ROTATION_VECTOR`。https://github.com/chromium/chromium/blob/main/services/device/generic_sensor/android/java/src/org/chromium/device/sensors/PlatformSensor.java
- [S9] Chromium `device_orientation_handler.cc`:DevTools 只覆寫 RELATIVE_ORIENTATION_QUATERNION。https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/device_orientation_handler.cc
- [S10] Chrome Platform Status(API JSON):第一階段只回報現有設定、日後改預設詢問。https://chromestatus.com/feature/5051845089689600 、https://chromestatus.com/feature/5915984063889408 ;Chrome 151 release notes https://developer.chrome.com/release-notes/151 ;blink-dev Intent to Ship https://groups.google.com/a/chromium.org/g/blink-dev/c/jy6QmMeV9gY/m/c_2d1josGgAJ

**Apple / WebKit**
- [S11] Apple `webkitCompassHeading`:相對磁北、順時針、負值無效。https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading
- [S12] Apple `webkitCompassAccuracy`:±度數、−1 = 未校準。https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804769-webkitcompassaccuracy
- [S13] Apple CoreLocation:`headingOrientation`(預設直式頂端為 0)https://developer.apple.com/documentation/corelocation/cllocationmanager/headingorientation ;`headingFilter`(預設 1 度)https://developer.apple.com/documentation/corelocation/cllocationmanager/headingfilter ;`CLHeading.headingAccuracy`(負值 = 未校準或強干擾)https://developer.apple.com/documentation/corelocation/clheading/headingaccuracy ;`magneticHeading` https://developer.apple.com/documentation/corelocation/clheading/magneticheading ;`locationManagerShouldDisplayHeadingCalibration` https://developer.apple.com/documentation/corelocation/cllocationmanagerdelegate/locationmanagershoulddisplayheadingcalibration(_:)
- [S14] Apple `WKUIDelegate.webView(_:requestDeviceOrientationAndMotionPermissionFor:...)`(iOS 15;未實作時回 prompt)。https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestdeviceorientationandmotionpermissionfor:initiatedbyframe:decisionhandler:)
- [S15] Apple `NSMotionUsageDescription`。https://developer.apple.com/documentation/bundleresources/information-property-list/nsmotionusagedescription
- [S16] WebKit `WebCoreMotionManager.mm`(`magneticHeading`、`headingAccuracy`、未設 delegate、60 Hz NSTimer、alpha/beta/gamma 來自 CMAttitude)https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm ;`WebCoreMotionManager.h`(`kMotionUpdateInterval = 1/60`)。
- [S17] WebKit:`UIDelegate.mm`(無 delegate 時 `alertForPermission` 即 prompt)https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/UIDelegate.mm ;`DeviceOrientationEvent.cpp`(無手勢 reject NotAllowedError)https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DeviceOrientationEvent.cpp ;`WebDeviceOrientationAndMotionAccessController.cpp`(`!mayPrompt` 回傳目前狀態,結果按來源快取)https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebsiteData/WebDeviceOrientationAndMotionAccessController.cpp ;`DeviceOrientationEvent.idl`(SecureContext、iOS 才有 webkit 欄位)https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DeviceOrientationEvent.idl ;`SecurityOrigin.cpp`(scheme handler 與 localhost 視為 trustworthy)https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/SecurityOrigin.cpp

**Capacitor 與外掛**
- [S18] Capacitor iOS `WebViewDelegationHandler.swift`(8.0.0:`.grant`)。https://github.com/ionic-team/capacitor/blob/8.0.0/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift
- [S19] Capacitor 設定(`server.hostname` 建議 localhost、`iosScheme`/`androidScheme` 預設)。https://capacitorjs.com/docs/config
- [S20] Capacitor 8 升級指南(iOS 15+、Xcode 26、Android minSdk 24/target 36、Node 22)。https://capacitorjs.com/docs/updating/8-0
- [S21] `@capacitor/motion`:文件 https://capacitorjs.com/docs/apis/motion ;原始碼 https://github.com/ionic-team/capacitor-plugins/tree/main/motion (`web.ts` 僅 `registerWindowListener('deviceorientation','orientation')`、`definitions.ts` 型別 `RotationRate`、`package.json` 8.0.1);核心 `registerWindowListener` 直接轉發 DOM 事件 https://github.com/ionic-team/capacitor/blob/main/core/src/web-plugin.ts
- [S22] Capacitor issue #5327(要求原生 heading)https://github.com/ionic-team/capacitor/issues/5327 ;plugins issue #1791(iOS `requestPermission` 回 denied,無結論)https://github.com/ionic-team/capacitor-plugins/issues/1791 ;論壇《Getting compass heading in ionic capacitor in 2023》https://forum.ionicframework.com/t/getting-compass-heading-in-ionic-capacitor-in-2023/235990
- [S23] `@capawesome/capacitor-compass` 0.1.2(MIT):文件 https://capawesome.io/docs/sdks/capacitor/compass/ ;原始碼 https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/compass (Android `TYPE_ROTATION_VECTOR`+`getOrientation`、iOS `CLLocationManager`,磁北免權限、真北需 `NSLocationWhenInUseUsageDescription`)
- [S24] `@capgo/capacitor-compass` 8.1.20(MPL-2.0),iOS 使用 `trueHeading` 並丟棄無效讀數。https://github.com/Cap-go/capacitor-compass
- [S38] `@capacitor/screen-orientation`(`lock({orientation:'portrait'})`;iPad 多工無法鎖定)。https://capacitorjs.com/docs/apis/screen-orientation (僅見搜尋摘要,官方頁未開啟全文)
- npm registry 版本:https://registry.npmjs.org/@capacitor%2Fmotion 、https://registry.npmjs.org/@capawesome%2Fcapacitor-compass 、https://registry.npmjs.org/@capgo%2Fcapacitor-compass

**Android 與螢幕方向**
- [S25] Android `SensorEvent`(座標系相對自然方向、螢幕轉向時軸不交換;`TYPE_ROTATION_VECTOR` Y 軸朝磁北、`values[4]` 預估航向精度)https://developer.android.com/reference/android/hardware/SensorEvent ;`SensorManager`(`getOrientation` 方位角定義、`SENSOR_STATUS_ACCURACY_*`)https://developer.android.com/reference/android/hardware/SensorManager ;`Display.getRotation()`(ROTATION_90 = 裝置逆時針轉 90 度)https://developer.android.com/reference/android/view/Display
- [S26] W3C Screen Orientation(angle 定義)https://www.w3.org/TR/screen-orientation/ ;互通性回報(Safari 16.4 順時針 = 90,Firefox/Chrome Android = 270)https://lists.w3.org/Archives/Public/public-webapps-github/2023Apr/0185.html

**其他技術參考**
- [S27] Twilight PR #62:iOS 手機後仰過垂直時 `webkitCompassHeading` 行為與誤差表、以「螢幕朝上才採用」的緩解。https://github.com/bergeronK/Twilight/pull/62
- [S28] Home Assistant iOS 討論(主張無 delegate 即拒絕,與 Apple/WebKit 原始碼不符)。https://github.com/orgs/home-assistant/discussions/4257
- [S29] Dean Jackson(Apple)2011:alpha 不是世界準確值、基於任意參考。https://lists.w3.org/Archives/Public/public-geolocation/2011Jul/0014.html
- [S30] 圓周平均 https://en.wikipedia.org/wiki/Circular_mean ;指數平滑 https://en.wikipedia.org/wiki/Exponential_smoothing ;RunningAngle(圓周 EMA 實例,僅見搜尋摘要)https://github.com/RobTillaart/RunningAngle
- [S31] Chrome DevTools Sensors https://developer.chrome.com/docs/devtools/sensors ;Port forwarding https://developer.chrome.com/docs/devtools/remote-debugging/local-server ;CDP 定義 https://github.com/ChromeDevTools/devtools-protocol
- [S32] NOAA 偏角定義與符號(東正西負,真 = 磁 + 偏角)https://www.ngdc.noaa.gov/geomag/declination.shtml ;台北 WMM2025 約 −5.06° https://www.magnetic-declination.com/Taiwan/Taipei/2654816.html ;vocus《地磁偏角、極距差與羅盤天地人盤探討》 https://vocus.cc/article/658e9362fd897800019c87ec ;udn 部落格 https://blog.udn.com/tsao144/179181867 與 HKET 專欄 https://inews.hket.com/article/2825231/ (兩者伺服器回 403,只見搜尋摘要)
- [S33] Android 磁力計校準與干擾 https://stonekick.com/blog/magnometers-accelerometers-and-calibrating-your-android-device.html
- [S34] App Store:堪輿透明羅盤 https://apps.apple.com/tw/app/%E5%A0%AA%E8%BC%BF%E9%80%8F%E6%98%8E%E7%BE%85%E7%9B%A4/id1422196592 ;巨峰風水羅盤 https://apps.apple.com/tw/app/%E5%B7%A8%E5%B3%B0%E9%A3%8E%E6%B0%B4%E7%BD%97%E7%9B%98-%E6%8C%87%E5%8D%97%E9%92%88%E5%A5%87%E9%97%A8%E9%81%81%E7%94%B2%E6%8E%92%E7%9B%98/id687445178 ;Luopan https://apps.apple.com/us/app/luopan-feng-shui-compass/id6736584559 ;風水羅盤指南針 https://apps.apple.com/tw/app/%E9%A2%A8%E6%B0%B4%E7%BE%85%E7%9B%A4%E6%8C%87%E5%8D%97%E9%87%9D/id1637065684 ;Feng-Shui Compass https://apps.apple.com/us/app/feng-shui-compass/id6737935866 。價格、評分、描述、評論皆由 iTunes Lookup 與 Customer Reviews RSS 取得(例:https://itunes.apple.com/lookup?id=687445178&country=tw 、https://itunes.apple.com/tw/rss/customerreviews/page=1/id=687445178/sortby=mostrecent/json )
- [S35] Google Play:https://play.google.com/store/apps/details?id=com.earth.fengshui 、https://play.google.com/store/apps/details?id=com.phoenix.compass 、https://play.google.com/store/apps/details?id=com.astro.fengshui (頁面內嵌的評分與少量評論摘要)
- [S36] 羅盤測量坐向教學 https://miao-xian.com/blog/5-2 ;風水羅盤 App 與一般 App 差異 https://www.hokming.com/fengshui-fengshuicompassAppVsordinarycompassApp.htm ;另有 udn hark6510、yusoo 教學(搜尋摘要,伺服器拒絕或連線失敗)。
- [S37] compass.js(舊式 Android GPS 校正法)https://ai.github.io/compass.js/

---

## 8. 未解決問題與實機驗證清單

**待實機驗證(建議至少 iPhone 15+ 與 2 台 Android:Pixel 與 Samsung)**
1. Capacitor 8 iOS WKWebView:第一次點擊 `requestPermission()` 是否直接回 `granted` 且無彈窗;`webkitCompassHeading` 是否在自訂 scheme 下正常;`webkitCompassAccuracy` 實際值域與典型值;Info.plist 不加 `NSMotionUsageDescription` 是否不會崩潰且能通過 App Review(目前只有 Apple 文件的適用 API 列表作為推論)。
2. iOS `webkitCompassHeading` 的量化階數(推論約 1°)與直立(beta 60–90)時的實際行為,以決定 iOS 是否值得做 offset 追蹤。
3. Android WebView(Chromium ≥ 152):`DeviceOrientationEvent.requestPermission` 是否存在、呼叫是否觸發任何 UI、`deviceorientationabsolute` 是否正常;沒有陀螺儀的機型 `deviceorientation` 是否回 `absolute=true`。
4. 同一地點、同一姿勢下 iOS 與 Android 的方位差(檢驗兩端磁北一致),以及手機殼/磁吸支架的實際影響量。
5. `screen.orientation.angle` 在 Capacitor 兩端的實際值與映射(2.4),決定是否要支援橫式。
6. Android 在無精度欄位下,以即時 σ 判斷「需校準」的門檻是否合理;必要時評估自寫原生外掛或採 Capawesome。
7. 品質燈號、傾角門檻(15°)、模式遲滯(50/40)、EMA τ 與鎖定 σ 門檻(3°)全部為設計值,需以實測資料調整。

**研究上的缺口**
8. 台灣各縣市/離島的 WMM2025 磁偏角:未能下載 NOAA 係數檔,尚未自行重算。需要決定內建 WMM 計算或用查表。
9. DevTools Sensors > Orientation 只驅動 relative 感測器的結論來自 Chromium 原始碼閱讀,未實際操作 DevTools UI。
10. 同類 App 的評論樣本很小(App Store RSS 每 App 最多數十筆;Google Play 僅頁面內嵌摘要),「平面圖疊圖」相關抱怨只找到一則(地圖存不了)。若要更完整,需要抓 Google Play 評論頁或以評論工具長期蒐集。
11. 各 App 內部使用磁北或真北、有無傾斜補償、有無平滑,無法從商店頁得知,需實機逐一測試。
12. 「24 山每山 15 度、子山中心在 0 度」與「兼向」規則由其他研究主題負責;本文的 `boundaryDist` 只是借用該幾何。同專案 `test/fixtures/luopan_rings.json` 的 `mountains24_geometry`(子 center 0、start 352.5、end 7.5)與此假設一致。
13. 風水界對「磁北 vs 真北」的最終建議取決於「坐向判定」主題的結論,本文只保證兩種基準都能切換與標示。

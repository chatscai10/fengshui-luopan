# device_compass 驗證報告(獨立懷疑論者)

- 驗證日期:2026-09-29
- 被驗證對象:`docs/research/device_compass.md`、`test/fixtures/device_compass.json`(99 筆)
- 方法:另寫獨立 Python 程式(矩陣連乘 Rz·Rx·Ry,不重用報告公式)重算全部可計算的 fixtures;把報告內的 `compass-core.mjs` 原樣抽出來用 node 跑 decode 決策表與邊界案例;用「與報告不同的來源」重讀 W3C 原始碼(index.bs)、WebKit 原始碼、Chromium 原始碼、Apple 文件 JSON、MDN BCD、chromestatus、Capacitor/外掛原始碼與 npm、pygeomag(WMM2025 係數)。
- 限制:本 session 的 WebSearch 額度用完(200/200),後半段只能用 WebFetch/curl 直接讀原文;風水界「磁北 vs 真北」無法再找第二份獨立來源。

## 總評:needs-fixes(核心數學與平台事實可靠,有 3 處需更正/降級)

1. 全部 99 筆 fixtures 我獨立重算,0 筆錯誤(見第 3 節)。
2. 平台事實(iOS/Android 事件、Capacitor 行為、外掛)幾乎都被原文證實。
3. 需更正:(a) iOS `webkitCompassHeading` 「以頂端為基準」只在放平時成立,直立時的行為文件沒寫,只有第三方回報說會跟著相機走,信心不應是 high;(b) 「50/40 度遲滯自動切換」在有側傾時會造成航向跳變(量化見規則 5),設計需修;(c) Chromium `requestPermission` 上線版本與 WebView 是否已出貨,BCD 與 chromestatus 兩個官方來源互相矛盾。

## 1. 逐條規則判定

### R1 iOS 用 `webkitCompassHeading`(磁北、順時針、accuracy -1 = 未校準、負值無效、來自 CLLocationManager.magneticHeading)— 判定:confirmed(但「頂端為基準」只限放平,信心應降為中)
- Apple `webkitCompassHeading` 文件 JSON:「relative to magnetic north … north is 0 degrees, east is 90 … A negative value indicates an invalid direction」。https://developer.apple.com/tutorials/data/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading.json
- Apple `webkitCompassAccuracy`:「if this property value is 10, the heading is off by plus or minus 10 degrees. A value of -1 means that the compass is not calibrated」。https://developer.apple.com/tutorials/data/documentation/webkitjs/deviceorientationevent/1804769-webkitcompassaccuracy.json
- WebKit `WebCoreMotionManager.mm` 第 318-319 行:`newHeading.magneticHeading`、`newHeading.headingAccuracy`;全檔 grep 無 `headingOrientation`、無 delegate 設定(330 行,我自己 grep)。https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm
- Apple `headingOrientation`:「the location manager assumes that the top of the device in portrait mode represents due north (0 degrees) by default」。https://developer.apple.com/tutorials/data/documentation/corelocation/cllocationmanager/headingorientation.json
- WebKit IDL:`webkitCompassHeading` 只在 iOS(`WTF_PLATFORM_IOS_FAMILY`)分支;`absolute` 在非 iOS 分支。https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/dom/DeviceOrientationEvent.idl(與 MDN BCD `absolute`: safari_ios false 一致)
- 更正:Apple 文件只保證「直式、放平時頂端 = 0」。手機直立(像拍照)時 CoreLocation 的航向定義文件沒寫,唯一證據是第三方 Twilight PR #62 稱「越過垂直後航向像跟著相機走」(https://github.com/bergeronK/Twilight/pull/62,單一來源、未實機)。報告 2.3 已把 iOS 限制在 tilt≤50° 是保守正確做法,但摘要句「以直式手機頂端為基準」應加註「放平時」。

### R2 Android 要聽 `deviceorientationabsolute`;`deviceorientation` 是相對事件;判斷式 `'ondeviceorientationabsolute' in window` — 判定:confirmed
- MDN BCD:`deviceorientationabsolute_event` chrome 50、chrome_android/webview_android 皆 mirror(=50)、Firefox 110、Safari 不支援、safari_ios mirror(不支援)。https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Window.json(我直接解析 JSON;第一次由小模型摘要時曾誤讀成 WebView「不支援」,已用原始 JSON 更正,實際為 mirror)
- Chrome 50 部落格:`deviceorientation` 預設不再是絕對值,新增 `deviceorientationabsolute`。https://developer.chrome.com/blog/device-orientation-changes
- Chromium `device_orientation_event_pump.cc`:`absolute=false` 時先試 relative 感測器,連不上才 fallback 到 absolute。https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/device_orientation/device_orientation_event_pump.cc
- Chromium `PlatformSensor.java`:ABSOLUTE_ORIENTATION_QUATERNION → `TYPE_ROTATION_VECTOR`,RELATIVE → `TYPE_GAME_ROTATION_VECTOR`。https://raw.githubusercontent.com/chromium/chromium/main/services/device/generic_sensor/android/java/src/org/chromium/device/sensors/PlatformSensor.java
- 補充:Firefox 110+ 桌面也有此事件,不影響結論。

### R3 平放頂端方位 = (360 − alpha) mod 360,與 gamma 無關,cosβ>0 時與 beta 無關 — 判定:confirmed
- W3C 原始碼:「device lying flat … top of the screen pointing West」對應 alpha=90;旋轉為 Z-X'-Y'',right-hand rule。https://www.w3.org/TR/orientation-event/
- 我的獨立推導:Y 軸經 Ry(γ) 不變,故頂端向量 = Rz(α)Rx(β)ŷ = (−cosβ sinα, cosβ cosα);已對 25 筆 group1 與所有 pick/screenUp 案例數值重算一致。

### R4 直立後鏡頭方位公式(W3C A.1)、平放退化 null、beta=90 時 heading = −(alpha+gamma) — 判定:confirmed
- W3C `index.bs` 第 824-837 行:`Vx = - cZ * sY - sZ * sX * cY; Vy = - sZ * sY + cZ * sX * cY;` 再 `atan(Vx/Vy)` 象限修正。https://raw.githubusercontent.com/w3c/deviceorientation/main/index.bs(我 curl 下來 grep)
- 代數:sX=1 時 Vx = −sin(α+γ)、Vy = cos(α+γ),heading = −(α+γ)。與我的 −Z 軸投影矩陣結果一致(group1 upright/landscape 共 14 筆)。
- 平放時 Vx=Vy=0,W3C 原碼 `Vx/Vy` 會除以 0,報告回 null 的處理正確。

### R5 依傾角在頂端/後鏡頭間自動切換,遲滯 50/40 — 判定:uncertain(數學無誤,但設計有缺陷,需修)
- 兩種方位「只在 gamma=0 時相等」報告有說,但沒量化切換時的跳變。我用同一組矩陣算:tilt 恰為 50°、alpha=0 時,頂端方位 0°,後鏡頭方位分別為:gamma 5° → 353.5°(跳 6.5°);10° → 346.9°(13.1°);15° → 340.3°(19.7°);20° → 333.5°(26.5°);30° → 319.3°(40.7°)。
- 即使 24 山每格 15°,使用者稍微歪一點拿手機,過門檻時盤面會突然跳一格甚至兩格。
- 更正建議:不要硬切。用 w = smoothstep(40°,50°,tilt) 對兩個方位的單位向量做加權混合再取 atan2;或只在 |gamma| < 5° 時允許切換,否則沿用現模式並提示「請放平」。門檻本身(50/40、15°)報告已標為設計值,此點屬實。

### R6 Secure context 與 iOS 手勢;Capacitor iOS 的 WKUIDelegate 直接 .grant;capacitor://localhost 與 https://localhost 為 secure context — 判定:confirmed
- WebKit `DeviceOrientationEvent.cpp` 第 141-142 行:`permissionState == Prompt` 時 reject `NotAllowedError`「Requesting device orientation access requires a user gesture to prompt」;IDL 標 `SecureContext`。https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/dom/DeviceOrientationEvent.cpp
- WebKit `UIDelegate.mm` 第 1237-1245 行:沒有 delegate 或沒實作該方法 → `alertForPermission(...)`(即彈窗 prompt),不是直接 deny;Home Assistant 討論「直接拒絕」與原始碼不符,報告採原始碼正確。https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/Cocoa/UIDelegate.mm
- Capacitor `WebViewDelegationHandler.swift`(main):`decisionHandler(.grant)`。https://raw.githubusercontent.com/ionic-team/capacitor/main/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift
- WebKit `SecurityOrigin.cpp` 第 89-101 行:由 scheme handler 處理的 scheme 與 localhost 視為 potentially trustworthy。https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/SecurityOrigin.cpp
- Capacitor 文件:hostname 預設 localhost,建議保留以使用需 secure context 的 Web API;iosScheme 預設 capacitor、androidScheme 預設 https。https://capacitorjs.com/docs/config

### R7 Chromium `requestPermission(absolute)` 自 Chrome 152、WebView mirror,目前只回報既有設定 — 判定:uncertain(版本與 WebView 兩處官方來源矛盾;設計建議本身正確)
- MDN BCD:`requestPermission_static` chrome 152,chrome_android/webview_android mirror。https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/DeviceOrientationEvent.json
- chromestatus feature 5915984063889408:Desktop 與 Android 出貨 Chrome **151**,「WebView: Not yet shipped」,Intent stage 5;長期目標「Ask-by-default … websites that register event listeners will not receive motion or orientation events until they call requestPermission()」。https://chromestatus.com/api/v0/features/5915984063889408
- chromestatus feature 5051845089689600 頁面仍顯示 developer trial/flag(M105)。https://chromestatus.com/api/v0/features/5051845089689600
- Chrome 152 stable 日期 2026-08-25(chromiumdash)。https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=152
- 更正:報告寫「152 起、WebView 也 mirror」,官方另一頁寫 151、WebView 尚未出貨。實際 Android System WebView 是否已有 `requestPermission` 需實機驗證(報告 §8 第 3 項已列)。「函式存在就呼叫、失敗不致命、watchdog」的寫法在兩種情況都正確,且長期若改 ask-by-default,「必須先呼叫才有事件」使這個寫法更關鍵。

### R8 不要用 `@capacitor/motion`(只轉 deviceorientation、無 requestPermission、型別僅 RotationRate)— 判定:confirmed(措辭需微調)
- `motion/src/web.ts`:`registerWindowListener('devicemotion','accel')` 與 `('deviceorientation','orientation')`,無 requestPermission;套件目錄只有 `src` 等,無 ios/android 原生資料夾;版本 8.0.1。https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/motion/src/web.ts 、https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/motion/package.json
- `definitions.ts`:`OrientationListenerEvent = RotationRate`(alpha/beta/gamma)。
- 微調:報告寫「只 registerWindowListener('deviceorientation')」漏了同檔也註冊 devicemotion;不影響結論。

### R9 專案設定:Web 路徑 iOS 不需專屬 Info.plist key、Android 免權限;Capacitor 8 需求 — 判定:Capacitor 8 部分 confirmed;Info.plist 部分 uncertain
- Capacitor 8 升級指南:iOS 15.0、Xcode 26.0+、minSdk 24、compile/target 36、Node 22+。https://capacitorjs.com/docs/updating/8-0
- Apple `NSMotionUsageDescription` 文件列出的 API 只有 CMSensorRecorder、CMPedometer、CMMotionActivityManager、CMMovementDisorderManager,並稱「no key → app will crash when it attempts to access motion data」。https://developer.apple.com/tutorials/data/documentation/bundleresources/information-property-list/nsmotionusagedescription.json
- WebKit 讀 CMDeviceMotion(CMMotionManager)不在該清單內,所以「不需要」是合理推論,但沒有 Apple 文件明說「WKWebView 的 DeviceOrientation 不需要」,也沒有實機/審核結果。報告標中、建議仍加此 key,判斷合理。
- `trueHeading` 需定位、`magneticHeading` 不需:Apple `trueHeading` 文件「valid only if location updates are also enabled」。https://developer.apple.com/tutorials/data/documentation/corelocation/clheading/trueheading.json

### R10 外掛比較:Capawesome 0.1.2(MIT,磁北免權限)、Cap-go 8.1.20(MPL-2.0,iOS trueHeading 無定位丟讀數)— 判定:confirmed
- npm:`@capawesome/capacitor-compass` latest 0.1.2、MIT、created 2026-07-07。https://registry.npmjs.org/@capawesome/capacitor-compass
- Capawesome 文件:磁北免權限、真北需 `NSLocationWhenInUseUsageDescription`,Android 免權限,有 accuracy。https://capawesome.io/docs/sdks/capacitor/compass/
- npm:`@capgo/capacitor-compass` latest 8.1.20、MPL-2.0。https://registry.npmjs.org/@capgo%2Fcapacitor-compass
- Cap-go `CapgoCompass.swift`:`let heading = newHeading.trueHeading; if heading < 0 || newHeading.headingAccuracy < 0 { return }`,並 `startUpdatingLocation()`。https://raw.githubusercontent.com/Cap-go/capacitor-compass/main/ios/Sources/CapgoCompassPlugin/CapgoCompass.swift(用 GitHub tree API 找到路徑後 curl)

### R11 事件率:Chromium ≥0.1° 才發事件、pump 上限 60 Hz;WebKit 60 Hz 輪詢 — 判定:confirmed(「iOS heading 約 1° 一階」為推論,confirmed 其前提)
- Chromium `device_orientation_event_pump.cc`:`kOrientationThreshold = 0.1`,`fabs(a-b) >= threshold`,無四捨五入。
- Chromium `device_sensor_event_pump.h` 第 25 行:`kDefaultPumpFrequencyHz = 60`。https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/device_orientation/device_sensor_event_pump.h
- Apple `headingFilter`:「The default value of this property is 1 degree」。https://developer.apple.com/tutorials/data/documentation/corelocation/cllocationmanager/headingfilter.json
- WebKit 未設 headingFilter(grep 無),故預設 1° 的推論成立,但仍是推論。

### R12 平滑用圓周法;k = 1−exp(−dt/τ) 參數表 — 判定:confirmed
- 我用 python 重算 k 表:60 Hz [0.1535, 0.0800, 0.0540, 0.0328]、30 Hz [0.2835, 0.1535, 0.1052, 0.0645]、20 Hz [0.3935, 0.2212, 0.1535, 0.0952],與報告表逐格一致。
- 圓周平均 atan2(S,C)、圓周標準差 sqrt(−2 ln R):https://en.wikipedia.org/wiki/Directional_statistics
- 報告的 `compass-core.mjs` 原碼:`roundHalf(-0.3)=359.5`、`roundHalf(359.75)=0`、`circMean([0,180])` 與均勻分佈皆回 null,邊界案例行為正確。

### R13 鎖定讀數(3 秒/60 筆、σ>3° 不穩)— 判定:confirmed(計算);門檻為設計值(報告已自承)
- group12 三筆我用 python 由樣本重算:平均 359.596666、σ 1.085372(ok);119.978172、σ 9.185274(unstable);8 筆 too-few,全部吻合。
- 注意:σ=3° 對應合成向量長度 R≈0.9986,這門檻對「手機輕微抖動」相當嚴格,實機可能過於容易判 unstable,報告已列待校正。

### R14 校準與干擾:網頁無校準 UI、accuracy<0 代表未校準、8 字校準 — 判定:confirmed(「網頁不會出現校準提示」屬推論 confirmed 其前提)
- WebKit `WebCoreMotionManager.mm` 全檔無 delegate;Apple `webkitCompassAccuracy` 文件見 R1。
- Stonekick:「the magnetometer … very sensitive to interference from local magnetic fields, even … a metal button on your phone case」、「wave your device in a figure of 8 pattern」。https://stonekick.com/blog/magnometers-accelerometers-and-calibrating-your-android-device.html
- Android `SensorEvent`:座標軸不因螢幕方向改變;`TYPE_ROTATION_VECTOR` Y 軸指磁北、`values[4]` 為預估航向精度(弧度)。https://developer.android.com/reference/android/hardware/SensorEvent(小模型摘要,未逐字比對;與 R2 的 Chromium 對照一致)

### R15 螢幕方向:座標系固定於自然方向;screen.orientation.angle 在 iOS 與 Android 相反 — 判定:uncertain(座標系部分 confirmed;映射部分僅單一來源)
- W3C:座標系「does not affect the orientation of the coordinate frame relative to the device」(WebFetch 摘要,與 Android SensorEvent 一致)。
- 互通性回報(裝置順時針轉 90°):Firefox Nightly 113 與 Chrome Canary 113(Android 13)= 270,Safari 16.4(iOS 16.4)= 90。https://lists.w3.org/Archives/Public/public-webapps-github/2023Apr/0185.html
- Android `Display.getRotation`:「if the device is rotated 90 degrees counter-clockwise … ROTATION_90」(裝置逆時針 90 = ROTATION_90)。https://developer.android.com/reference/android/view/Display
- W3C Screen Orientation:angle = 「the angle in degrees that the screen is rotated counter-clockwise from its natural orientation」。https://www.w3.org/TR/screen-orientation/
- 我的判讀:Chrome Android 的 270(裝置順時針 90 = 逆時針 270)其實與「逆時針」文字相容,Safari 的 90 才可能是偏離者;本任務給的分歧說明寫「規格與 WebKit 一致而 Chrome 偏離」我無法證實,規格用語本身有歧義。這 6 筆 group13 是報告自訂的映射(且該互通性回報是 2023 年、單一來源、之後有沒有修正未知)。v1 鎖直式不受影響,橫式支援前必須實機量測。

### R16 磁北 vs 真北:偏角東正西負、台北 WMM2025 約 −5.0° — 判定:confirmed(並補上報告缺的自行重算)
- 我用 pygeomag(內含 WMM2025.COF)自行重算(NOAA 係數檔報告當時下載失敗):台北 25.033N 121.565E,2026.0 → **−5.033°**,2026.75 → **−5.061°**;高雄 −4.323°/−4.348°;金門 −4.425°/−4.447°;台中 −4.711°/−4.738°(pip 套件 pygeomag,只讀係數,數字與 magnetic-declination.com −5.06 一致)。
- magnetic-declination.com 台北:−5.06°,模型 WMM2025。https://www.magnetic-declination.com/Taiwan/Taipei/2654816.html
- 更正/補充:台灣各地偏角範圍約 −4.3°(高雄)到 −5.1°(台北),整島用單一預設 −5° 最多差約 0.7°,仍遠小於 24 山的 7.5° 半格,可接受;但「內建 WMM」值得做(pygeomag 證明只要一份 COF 就能離線算)。
- miao-xian 教學頁寫「台灣地區的磁北與真北大約有 3-4 度的偏角」,比 WMM2025 的 −4.3~−5.1 小,屬過時數字,報告 S36 引用時應註明。https://miao-xian.com/blog/5-2

### R17 風水界對磁北/真北的做法(vocus:1973 偏角 ≈0、2021 = −4.75°;主張保留古法)— 判定:confirmed(引用數字),流派結論 uncertain
- vocus 原文(我 curl 全文核對):「大約 1973 年這年,正北、磁北幾乎重疊 (0.02度)…現在快 2021 年已經偏到快 -4.75 度了」,並列 1971-2021 台北逐年表(2021 = −4.75);另寫「堪輿羅盤指向地磁北」「二十四山是地理磁北」。https://vocus.cc/article/658e9362fd897800019c87ec
- 作者論點是三針(正/中/縫)的 7.5° 差來自極距差而非磁偏角,不是要求用真北修正。支持「預設磁北、直接讀羅盤」。
- 缺口:除 vocus 外,「玄空一定要用真角度」的 HKET 專欄仍 403、無法取得全文;我本 session 也無搜尋額度找第二來源。此分歧維持 uncertain,建議預設磁北 + 可選修正的做法合理但不是由兩個獨立風水來源共同支持。

### R18 桌機測試:DevTools Sensors > Orientation 只驅動 relative 感測器 — 判定:confirmed(原始碼層級),UI 行為未實測
- Chromium `device_orientation_handler.cc` 只出現 `RELATIVE_ORIENTATION_QUATERNION`。https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/device_orientation_handler.cc
- 結合 R2(pump 對 `deviceorientation` 先試 relative),DevTools 只能觸發 `deviceorientation`(absolute=false)的結論成立。

### R19 同類 App 資料(價格/評分)— 判定:confirmed(可查證部分)
- iTunes Lookup(TW):堪輿透明羅盤 $1,290、4.4 星/5 筆;巨峰風水羅盤 4.69967 星/303 筆(商店名為簡體「巨峰风水罗盘」);風水羅盤指南針 4.48421/95 筆;(US)Luopan 5 星/4 筆;Feng-Shui Compass(9 Earth)5 星/13 筆。例:https://itunes.apple.com/lookup?id=687445178&country=tw
- 未逐則核對的評論內容(RSS 82 筆分布、Google Play 評論)標為 uncertain,報告本身已註明樣本小。
- 小細節:巨峰在台灣商店名為簡體字「巨峰风水罗盘」,報告 T3 寫繁體,屬轉寫,不影響結論。

## 2. 額外發現(非 fixtures 錯誤,建議納入修訂)

- 報告 2.5 的 decode 決策表 10 案例我用原碼重跑全過,並補測:`webkitCompassHeading=360` → headingDeg 0(ok)、`NaN` → invalid、accuracy=-1 且 heading=0 → uncalibrated、無 accuracy 欄位 → ok(accuracyDeg=null)。行為都合理。
- group13 與 group11 屬「自訂規則」,不是來源事實;fixtures 的 `confidence` 若標 high 應改 medium/low。
- Chromium 長期 ask-by-default:未呼叫 `requestPermission` 就不會有事件,建議 UI 把「啟用羅盤」按鈕視為永久必要,而不只是 iOS 才需要。

## 3. Fixtures 獨立重算結果

- 全部 99 筆(group1-13)獨立重算:group1(25)、group2(6)、group3(7)、group4(9)、group5(8)、group6(3)、group7(8)、group8(8)、group9(5)、group11(1)、group12(3)、group13(6)用我自己的 python 程式重算,數值差 < 1e-4°;group10(10)用報告的 `compass-core.mjs` 原樣執行加上我對 Apple/W3C 文件的邏輯核對。
- 結果:**0 筆錯誤**。group7 我按 JS `Math.round`(半數進位)計算;若改用 Python 銀行家捨入,0.25 會變 0.0,程式實作時要用 `Math.floor(x+0.5)` 語意。
- 覆蓋缺口(非錯誤):沒有 `webkitCompassHeading=360`、accuracy 欄位缺失的 decode 案例;沒有「切換點附近帶側傾」的 pick 案例(見 R5,建議補 tilt=50° 且 gamma=10/20/30 的案例,預期修正後航向連續)。
- group8 依賴的「24 山每山 15°、子山中心在 0°」由其他主題負責,本次只驗算術。

## 4. 我自己的算術/程式檢查清單(可重現)

- 獨立實作:Rz(α)Rx(β)Ry(γ) 3×3 連乘,取列向量 Y(頂端)、X(右緣)、−Z(後鏡頭),heading = atan2(東, 北)。
- 已跑:99 筆 fixtures 比對、k 參數表、WMM2025 偏角(pygeomag)、報告內 JS 決策表、tilt=50° 時頂端 vs 後鏡頭跳變表。

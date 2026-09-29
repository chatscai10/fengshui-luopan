# device_compass.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.7、附錄 A.8(DC-7、DC-8、DC-9)、2.9.2、2.9.3、2.9.7、4.1。
原檔 99 案(group1-13),修改後 115 案(原案 99 + 補案 16)。原 99 案只增不改: 已用程式把原案的 name、group、fn、input、expected、confidence、note 逐案對照修改前的傾印,0 案有差異(source、verifiedBy 未動)。
除下列項目外沒有任何改動。格式仍是 `JSON.stringify(x, null, 2)` 加結尾換行。

## 1. group10 補案 4 筆(B.7 第 1 點、DC-9)

| case 名稱 | 輸入 | 期望 | 依據 |
|---|---|---|---|
| ios_wrap_360_to_0 | `webkitCompassHeading=360`、accuracy 5 | headingDeg 0、status ok(360 回捲成 0) | B.7;2.9.3、2.9.7「iOS 360 視為 0」 |
| ios_nan_heading_invalid | `webkitCompassHeading=NaN`、accuracy 10 | headingDeg null、accuracyDeg 10、status invalid | B.7;2.9.3 表「為負或非有限值 → invalid」 |
| ios_uncalibrated_heading_0_accuracy_-1 | heading 0、accuracy -1 | headingDeg null、accuracyDeg -1、status uncalibrated | B.7;heading=0 是合法讀數,accuracy<0 優先判未校準 |
| ios_no_accuracy_field_ok | heading 45.5、無 accuracy 欄位 | headingDeg 45.5、accuracyDeg null、status ok | B.7;2.9.7「accuracy 欄位缺失視為未知,不判未校準」 |

`ios_nan_heading_invalid` 的 NaN 在 JSON 裡不能寫,改用案例層新欄位 `inputSpecials: {"webkitCompassHeading": "NaN"}`,由 sensor.test.js 的 runner 換成真的 `NaN`(值不是 `"NaN"` 就丟錯)。

## 2. 新增 group14: smoothstep(40°,50°) 混合,12 筆(B.7 第 2 點、DC-1、D66)

fn 名稱 `pickHeadingBlend`;輸入 alpha=0、gamma ∈ {10, 20, 30}、tilt ∈ {40, 45, 50, 55}(beta 由 `acos(cos(tilt)/cos(gamma))` 反解,存完整精度,不是規格表裡只有 45° 那欄給的三位小數)。期望 headingDeg、tiltDeg、mode:

| γ | tilt 40° | tilt 45° | tilt 50° | tilt 55° |
|---|---|---|---|---|
| 10° | 0(top) | 352.892074(blend) | 346.898218(back) | 347.761280(back) |
| 20° | 0(top) | 345.536675(blend) | 333.482215(back) | 335.321288(back) |
| 30° | 0(top) | 337.5(blend) | 319.254243(back) | 322.382488(back) |

- 期望值來源: `test/helpers/sensor.js` 用矩陣連乘 `R = Rz(alpha)·Rx(beta)·Ry(gamma)` 另算(與 src/core/sensor-core.js 的閉式公式是兩條獨立路徑),再套規格 2.9.2 的 smoothstep 與單位向量混合,四捨五入到 6 位小數。
- 與規格 B.7 的三位小數表逐格比對,最大差 4.9e-4(捨入誤差,表本身只有三位),沒有任何一格不一致。tilt 40° 那欄為 0,符合「tilt ≤ 40° 時等於頂端方位 0」。
- 規格 2.9.2 對 tilt 50°、alpha=0 的後鏡頭方位(γ=5→353.5、10→346.9、20→333.5、30→319.3)也已用同一個矩陣實作重算一致(test/sensor.test.js「舊遲滯做法在 tilt 50° 會跳變」)。
- 「相鄰 0.1° 傾角航向變化 < 1°」不放在 fixtures,寫成屬性測試(規格 4.4): 實測最大 0.668°(γ=30°、tilt 44.6° 處),與規格重算的 0.67° 一致。
- confidence 標 medium: 40°/50° 是規格明說的設計值。

meta 增修(只為說明新增的案例與函式):
- `meta.groups.group14` 新增。
- `meta.functions.pickHeadingBlend` 新增(規格 2.9.2 的公式)。
- `meta.functions.pickPointingModeHysteresis` 不存在;改在既有的 `meta.functions.pickPointingMode` 文字尾端加註「D66 已由 pickHeadingBlend 取代;遲滯版只留作 group3 的歷史對照,正式解碼路徑不使用」。group3 的 7 案期望值原封不動,仍以遲滯規則執行(sensor-core.js 保留 `pickPointingModeHysteresis` 給它,解碼與感測層不用)。
- `meta.functions.decodeOrientationEvent` 尾端加註 `inputSpecials` 的用法。

## 3. 檢查後不需改動的項目

- B.7 第 3 點「group11、group13 的 confidence 標 low/medium」: group11 只有 1 案且已是 medium;group13 六案已是 medium 五案、low 一案(`screen_angle_ios_270_means_device_turned_ccw`)。已符合,未改動。sensor.test.js 對 low 案走軟斷言(只要求不崩潰與輸出形狀)。
- DC-7(group7 依賴 `Math.round` 半數進位): 8 案期望值本身正確,實作用 `Math.floor(x+0.5)` 語意,已在 sensor-core.js 的 roundHalf/roundInt 註明,不需改期望值。
- DC-10(group8 依賴 24 山幾何): 只驗算術,並另以 `geo.analyzeBearing(h).boundaryDist` 交叉核對 2000 個隨機方位(屬性測試),不需改 fixtures。

# orientation.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.5、附錄 A.5(OR-1、OR-6 到 OR-9)、2.1.3 第 8 點、4.1。
原檔 179 案(函式 162、偏角參考 17),修改後 377 案(原案 179 + 生成 192 + 量測 6)。除下列項目外,原案與 meta 逐字未動(已用程式比對:原 179 案只有第 1、2 項兩案有差異,meta 只有 `functions` 與 `verification` 兩個鍵有差異)。

## 1. 既有案例修正: 同性相兼超限的空亡標籤標為單一派說法(B.5 第 2 點、OR-7)

`kongwangKind: 'xiao'` 是位置式(山界=小空亡;sohu 274267505、yixiansheng 4527、zggdfs)的說法。度數式(36fengshui zs60)稱同性相兼超限為「空向」,ifeng 亦不稱同性相兼山界為小空亡(orientation.verify.md V8)。各派定義不同,不能當硬性斷言。

| case 名稱 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| 子山 6.5° 兼癸 同陰 >6 空向 | 案例層 `schoolSpecific` | (無) | `true` | B.5、spec 2.1.3 第 8 點 |
| 子山 6.5° 兼癸 同陰 >6 空向 | `expected.kongwangKindDegree` | (無) | `"kongxiang"` | B.5;36fengshui zs60「超過六度…空向」 |
| 子山 6.5° 兼癸 同陰 >6 空向 | `note` | (無) | 位置式與度數式兩說並存的說明 | OR-7 |
| 乾山 322.2° 兼亥 同陽 dev 7.2 >7 空向 | 案例層 `schoolSpecific` | (無) | `true` | 同上 |
| 乾山 322.2° 兼亥 同陽 dev 7.2 >7 空向 | `expected.kongwangKindDegree` | (無) | `"kongxiang"` | 同上 |
| 乾山 322.2° 兼亥 同陽 dev 7.2 >7 空向 | `note` | (無) | 同上說明 | OR-7 |

`expected.kongwangKind` 兩案都維持 `"xiao"`(位置式預設,D04)。geo.test.js 對 `schoolSpecific:true` 的案例走軟斷言: `kongwangKind` 只要求落在 `xiao`/`kongxiang`,`kongwangKindDegree` 與「改用度數式時 `kongwangKind` 等於它」仍為硬斷言。

## 2. 補案: 48 個有向界線 × 4 種偏離量,共 192 案(B.5 第 3 點、OR-8)

- 有向界線 = 24 條山界 × 兩側(山 i 順時針偏向 i+1、山 i+1 逆時針偏向 i)= 48;每種偏離量 adev 各取一次:`4.75`、`5.5`、`6.5`、`7.25`(皆為二進位浮點可精確表示的值,沒有雜訊)。
  - `4.75`: 全部 zone=jian、level=jian,補到「出卦但 level=jian(<=5)」16 條有向卦界與同陽 8 條的兼向區。
  - `5.5`: 陰陽互兼與出卦 32 條為 `jian_caution`,同陰同陽 16 條為 `jian`(5 與 6 兩說夾出的注意帶)。
  - `6.5`: 陰陽互兼與出卦與同陰 40 條為 `void`,同陽 8 條仍為 `jian`(限度 7)。
  - `7.25`: 48 條全為 `void` 且壓線(`onLine=true`),補到同陽超限。
- 案名前綴「生成」,`tags` 含 `generated`、`adev-<值>`、`boundary-sweep`。`confidence`: 4.75 為 high,其餘 medium(5/6 度限度屬設計折衷)。
- 補到 B.5 指名的缺口: 同陽相兼 艮/寅、坤/申、巽/巳(原只有 乾/亥)、出卦其餘 5 條卦界(寅|甲、乙|辰、巳|丙、申|庚、辛|戌;原只有 癸|丑、亥|壬、丁|未)與 `chugua` 且 `level=jian` 案。
- 每案 expected 欄位: mountain、zone、level、leanTo、pairType、boundaryKind、kongwangKind、kongwangKindDegree、onLine、retest、dev、boundaryDist、outer1p5、needsTiGua。原案沒有的 `kongwangKindDegree`、`outer1p5`、`needsTiGua` 在生成案首次出現。
- 同陰超限(6.5 與 7.25)與同陽超限(7.25)共 24 案標 `schoolSpecific:true`,理由同第 1 項。
- 期望值的產生方式: **獨立實作**,不共用 geo.js 的任何表。Python `fractions.Fraction` 精確算術;24 山的卦以 45 度扇區掃描、元龍與陰陽以規則集合(地元龍=壬丙甲庚辰戌丑未、陽=乾坤艮巽壬丙甲庚寅申巳亥)推得;山以逐山區間掃描找出(不用 floor 公式)。產生腳本放在工作階段暫存區(不在 repo 內)。
- 三方交叉: (a) Python Fraction 產生的期望值、(b) test/helpers/geo.js 的 0.1 度整數算術掃描(-370 到 730 度共 11001 點 × 4 組選項)、(c) src/core/geo.js,三者一致。
- 自檢: 每個 adev 的 48 局分類計數 = 出卦 16、陰陽互兼 16、同陰 8、同陽 8(產生腳本內 assert)。

## 3. 補案: 多次量測 `uncertainty = max(baseline, 2σ)`,6 案(B.5 第 3 點、OR-8)

新的 `fn: "measurementAnalysis"`,input `{readings[], baseline}`,expected `{mean, r, stdDeg, uncertainty, mountain, zone, level, retest, dev, boundaryDist}`。runner 的組合 = `circularStats` + `measurementUncertainty({baseline, sigmaDeg})` + `analyzeBearing(mean, {uncertainty})`。

| case 名稱(摘要) | 驗證重點 |
|---|---|
| 午山中心附近緊密量測 5 次 | σ 小,不確定度維持 baseline 3,不需重測 |
| 午山中心但讀數散開 (σ 約 5.2) | 2σ=10.3 蓋過 baseline,雖在下卦區仍建議重測 |
| 跨 0/360 的子山量測 [358,2,1,359,0.5] | 圓周平均 0.1(算術平均會得 144) |
| 午兼丙(平均 175.4)緊密量測 | 距山界 2.9 < 3,重測 |
| 卦界(癸/丑 22.5)附近散開量測 | 2σ=8.0 拉高不確定度,level 為 jian_caution |
| baseline 5(App 層預設)蓋過小 σ | 不確定度 5 |

- mean、r、σ 以 Python 雙精度獨立計算(σ 用 sqrt(-2 ln R)),取小數 9 位;runner 容差 1e-6。
- 產生時已檢查每案的偏離量離門檻(4.5)與離「距界=不確定度」都 > 0.02,避免浮點在邊界翻邊。

## 4. meta 補記

- `meta.functions.analyzeBearing`: 回傳欄位補上 `kongwangKindDegree`、`outer1p5`、`needsTiGua`。
- `meta.functions.measurementAnalysis`: 新增。
- `meta.verification` 新增三個鍵:
  - `S4_36fengshui_source_typos_noted_by_review (OR-9)`: 36fengshui 兼向清單兩條筆誤「午子兼丙午」「丙午兼午子」應為「午子兼丙壬」「丙壬兼午子」(另「辛乙兼卯酉」重複為既有註記),不影響期望值。
  - `B5_generated_boundary_sweep (...)`: 192 案與產生方式。
  - `B5_measurement_uncertainty_cases`: 6 案。

## 5. 未改 fixtures、改在測試 runner 的處理

| 項目 | 處理 | 依據 |
|---|---|---|
| `sitFromFacing` 187.4 案 `sitBearing = 7.399999999999977`(浮點雜訊) | 保留 fixture 值,runner 以圓周差容差 1e-9 比較 | B.5 第 1 點、OR-6 |
| `circularMean` 的 `r`、`stdDeg` 只給 6 位小數 | runner 容差 1e-5 | B.5 第 1 點、OR-6 |
| `declinationReference` 17 案 `tolDeg` = 0.15,規格 4.1 與 V14 要求 0.02 | fixture 未動;runner 取 `min(tolDeg, 0.02)`,並另以 `igrf14Deg` 做第二模型檢查(容差 0.03) | spec 4.1 |
| `pickFacing` 12 案 confidence=low | 依 spec 4.1 只核對與 2.1.6 一致,但 fixture 註明「鎖定建議預設」即規則本身,故 runner 走硬斷言 | spec 4.1、4.2 第 2 點 |
| 「9樓以下用大樓正面」兩案 | 案名為「選項」,runner 以 `facadeFloorRule:true` 傳入 | spec 3.1 `facadeFloorRule` |

## 6. 已知資料差異(不影響通過)

- 首爾在 `declinationReference` 有案例(-8.99,年變化 -0.039),但不在 orientation.md 3.5 的城市表(該表實際 41 列;文件文字寫 40、42、48 三種說法)。CITY_DECLINATIONS 因此是表格 41 城 + 首爾,共 42 筆,首爾取自 orientation.json。

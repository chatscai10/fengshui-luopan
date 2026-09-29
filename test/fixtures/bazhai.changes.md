# bazhai.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.1、附錄 A.1(BZ-6 到 BZ-10)、2.2.3 第 4、5 點、2.3.3 B、2.3.7、4.1。
原檔 135 案,修改後 148 案(原案 135 + 補案 13)。除下列項目外,原案與 meta 逐字未動(已用程式比對:meta 完全相同,原 135 案只有第 2 節的 4 案 `note` 有差異,`input`、`expected`、`source`、`confidence` 全部相同)。

補案期望值一律**獨立於 src/core/bazhai.js 與 src/core/calendar.js** 重算,不從引擎輸出抄:

- 立春: lunar_python 1.4.8 `Lunar.getJieQiTable()['立春']`;第二來源 ephem 4.2.1(太陽視地心黃經 315 度二分法,UTC+8),兩者差 < 120 秒(1940 年: 07:07:32 對 07:07:28)。
- 春節: lunar_python `Lunar.fromYmd(y, 1, 1).getSolar()`(1940-02-08、2000-02-05)。
- 台灣偏移: Python 3.13 `zoneinfo` Asia/Taipei,1940-02-05 08:00 與 08:30 當地時間皆為 +09:00。
- 命卦: 封閉式 `男 mod9(2-Y)`、`女 mod9(Y+4)`,5 入中男坤女艮。
- 宅卦: `fractions.Fraction` 精確算術,`GUA[floor(((sit+22.5)%360)/45)]`,sit = facing + 180。
- 產生腳本放在工作階段暫存區(不在 repo 內)。

## 1. 補案 13 個(B.1、BZ-6 到 BZ-8)

### 1.1 台灣 1938-1945 +09:00,4 案(BZ-6)

kind `minggua_birth`,`utc_offset:"+09:00"`,格式與原案相同(五種年界期望值 + `default_boundary` + `lichun_cst_this_year` + `lunar_new_year_this_year`)。`lichun_cst_this_year` 取 fixture 自己的 Skyfield 表 `1940-02-05 07:07:14`;另有 annual 參考實作 07:07:10、lunar_python 07:07:32,三者都遠離 07:00 與 07:30。

| case 名稱 | 換算成 UTC+8 | lichun_exact | lichun_date_only | fixed_feb4 | lunar_new_year(1940-02-08) | gregorian_jan1 |
|---|---|---|---|---|---|---|
| minggua_birth_1940-02-05T0800_+0900_male | 07:00,早於立春 | 1939 兌(raw 7) | 1940 乾(raw 6) | 1940 乾 | 1939 兌 | 1940 乾 |
| minggua_birth_1940-02-05T0800_+0900_female | 07:00,早於立春 | 1939 艮(raw 8) | 1940 離(raw 9) | 1940 離 | 1939 艮 | 1940 離 |
| minggua_birth_1940-02-05T0830_+0900_male | 07:30,晚於立春 | 1940 乾(raw 6) | 1940 乾 | 1940 乾 | 1939 兌 | 1940 乾 |
| minggua_birth_1940-02-05T0830_+0900_female | 07:30,晚於立春 | 1940 離(raw 9) | 1940 離 | 1940 離 | 1939 艮 | 1940 離 |

lichun_exact 欄與 B.1 表(08:00: 男兌 raw 7、女艮 raw 8;08:30: 男乾 raw 6、女離 raw 9)逐格一致。08:00 案若誤把 +09:00 當 +08:00 會得 1940,測試另有專案斷言這一點。

### 1.2 立春日不知時刻,2 案(BZ-8)

kind `minggua_birth`,`input.timeKnown:false`,`birth_local:"2000-02-04"`。`expected` 只有 `flags`、`alternatives`、`lichun_cst_this_year`、`lunar_new_year_this_year`、`default_boundary`,**不指定主結果的年份**(B.1 沒規定;主結果取當地正午是 calendar.toInstant 的實作約定,不是規則),runner 只要求主結果是兩個候選之一。

| case 名稱 | flags | alternatives(依序) |
|---|---|---|
| minggua_birth_2000-02-04_timeUnknown_male | `nearLichun:false`、`dateIsLichunDay:true` | beforeLichun 1999 坎(raw 1)、afterLichun 2000 離(raw 9) |
| minggua_birth_2000-02-04_timeUnknown_female | 同上 | beforeLichun 1999 艮(raw 5 寄艮 8)、afterLichun 2000 乾(raw 6) |

與 B.1 一致: 立春前 1999 男坎/女艮,立春後 2000 男離/女乾;2000 立春為 2000-02-04 20:40:22(fixture 表),lunar_python 亦落在 2/4。

### 1.3 宅卦扇區邊界與負角度,7 案(BZ-7、BZ-8)

kind `zhai_gua_from_facing_degree`,半開區間 `[起,止)`(設計約定,來源沒有規定,見 fixture `meta.conventions.sector_boundary`)。

| case 名稱 | facing | sit_degree | zhai_gua | camp |
|---|---|---|---|---|
| zhai_boundary_facing_22.5 | 22.5 | 202.5 | 坤 | west |
| zhai_boundary_facing_22.4999 | 22.4999 | 202.4999 | 離 | east |
| zhai_boundary_facing_157.5 | 157.5 | 337.5 | 坎 | east |
| zhai_boundary_facing_157.4999 | 157.4999 | 337.4999 | 乾 | west |
| zhai_boundary_facing_337.5 | 337.5 | 157.5 | 離 | east |
| zhai_boundary_facing_337.4999 | 337.4999 | 157.4999 | 巽 | east |
| zhai_facing_-300 | -300(正規化為 60) | 240 | 坤 | west |

與 B.1 表一致(22.5 坤宅 / 22.4999 離宅;157.5 坎宅 / 157.4999 乾宅;337.5 離宅 / 337.4999 巽宅;-300 坤宅)。

## 2. 既有案例 `note` 修正,4 案(B.1「另」、BZ-9)

只改 `note` 文字,`expected` 與其他欄位不動。HKO 官方曆表的分是**四捨五入**,不是截斷(bazhai.verify.md R7);註明「四捨五入到分」與 fixture 表的秒數,避免讀者誤以為立春時刻就是整分。B.1 只點名 2024 的「HKO 16:27」;同類寫法的 2025 與 2021 兩案一併補上。

| case 名稱 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| minggua_birth_2024-02-04T1626_male | note | `1 min before 立春 2024 (HKO 16:27) -> 2023` | `1 min before 立春 2024 (HKO 16:27,四捨五入到分;表值 16:27:07) -> 2023` | B.1、BZ-9;表值取自 `lichun_cst_this_year` |
| minggua_birth_2024-02-04T1628_male | note | `1 min after 立春 2024 (HKO 16:27) -> 2024` | `1 min after 立春 2024 (HKO 16:27,四捨五入到分;表值 16:27:07) -> 2024` | 同上 |
| minggua_birth_2025-02-03T2212_male | note | `after 立春 2025 (HKO 22:10) -> 2025 even though date is Feb 3; fixed_feb4 wrongly 2024` | `after 立春 2025 (HKO 22:10,四捨五入到分;表值 22:10:28) -> 2025 even though date is Feb 3; fixed_feb4 wrongly 2024` | 同上 |
| minggua_birth_2021-02-03T2330_female | note | `立春 2021 = Feb 3 22:59 (HKO). after it -> 2021; fixed_feb4 / fengshuiweb table wrongly 2020` | `立春 2021 = Feb 3 22:59 (HKO,四捨五入到分;表值 22:58:47). after it -> 2021; fixed_feb4 / fengshuiweb table wrongly 2020` | 同上 |

## 3. 檢查後不需更動的項目

- B.1「usage note 依 2.3.4 修正」(BZ-10): fixture 內 `usage_position_vs_facing_lookup` 案沒有「qqqs 只支持位置」的敘述(案例只有 `expected.note` 說明「查同一張表,差別在方位由哪個物理量提供」,與 2.3.4 一致),該說法只出現在研究報告,所以 fixture 不需更動,`expected` 的 5 個查表值也不受影響。
- BZ-5(135 案 0 案數值錯誤): 新引擎對原 135 案全數通過,期望值一個都沒改。
- 沒有為了讓測試通過而改任何期望值。

## 4. 測試 runner 對補案的處理

- `minggua_birth`: 五個年界鍵有出現才比對;有 `flags` / `alternatives` 鍵就額外比對旗標與備選結果。`timeKnown` 缺省視為 true。`lunar_new_year` 需要農曆資料,runner 用該案的 `lunar_new_year_this_year` 當 `opts.lunarNewYearOf` 的回傳值(引擎不內建農曆庫,規格 2.2.3 第 6 點、U-19)。
- `zhai_gua_from_facing_degree`: 依原案格式,另走完整 `analyzeBazhai`;facing×10 為整數時再與 0.1 度整數掃描比對。

# wealth_position.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.4、附錄 A.4(WP-2 到 WP-9)、2.6.5(D49)、2.6.6、2.6.9、4.1。
原檔 71 案,修改後 72 案(原案 71 + 補案 1)。除下列項目外,原案與 meta 逐字未動: 已用程式比對修改前後,只有第 1 到 8 節列出的欄位不同(`input`、`expected` 的既有鍵、`source` 全部相同),檔案排版(1 格縮排、Python 式 `1.0`)照舊,改動是逐行文字替換而不是整檔重新序列化。

沒有任何一個既有期望值被改動。唯一動到 `expected` 的是第 6 節新增的欄位 `left_side_against_wall`(原本沒有這個欄位),以及第 8 節的新案例。

## 1. `liunian_lichun_boundary_minute_level`(WP-2)

| 欄位 | 舊 | 新 |
|---|---|---|
| `input.note` | 立春前 51 秒 | 立春前約 1 分鐘(依曆法庫 2026-02-04 04:02:08 立春,為 68 秒前) |
| `verified_by` | 立春 04:01:51 之前一分鐘仍屬 2025 年… | 立春(曆法庫 04:02:08,到分為 04:02)之前約一分鐘仍屬 2025 年…;交節時刻一律交給曆法模組,不新增 04:01:30-04:02:30 之間的測資;香港天文台 2026 曆表只有日期,沒有時分秒,不再宣稱與曆表一致 |

依據: 複查 R9 與 DOMAIN_SPEC 2.6.9。`expected`(2025 年、中宮 2)不變。測試以 `04:00`(前)與 `04:05`(後)另驗換年,避開 04:01:30-04:02:30。

## 2. `door_chong_aligned`(WP-7、D49)

`verified_by` 由「重疊 0.65m >= 較窄者 0.8 的 50%(0.4)」改為「重疊 0.65m / 較窄者 0.8m = 0.8125 >= 80% => 門沖(D49 兩級門檻…);兩門之間無遮擋物」。`expected.chong: true` 不變(重疊比 0.8125,規格寫 0.81)。

獨立算法: 前門 pos 1.0 寬 0.9 → [0.55, 1.45];對門 pos 1.2 寬 0.8 → [0.8, 1.6];重疊 = 1.45 - 0.8 = 0.65;較窄者 0.8;比值 0.65 / 0.8 = 0.8125。

## 3. `score_star_value_tables`(WP-8)

`notes` 補「XK9_VAL[2]=-0.2 與 108s 稱九運二黑為『遠生氣』衝突: 運序屬生氣、星性為病符,兩種屬性混用(複查 R16)」。`expected` 不變。

## 4. `liunian_occupation_layer_2024`(WP-8)

原本沒有 `notes`,新增: Yahoo 原文只列方位(東、東北、北),沒有寫星數;文職-一白、外勤-六白、經商-八白是由 2024 飛星推得的對應(複查驗證與飛星一致),confidence low 正確。`expected` 不變。

## 5. `xk_9yun_chou_shan_wei_xiang_chart`(WP-8)

`confidence` medium → high,限「不含替卦與兼向」(`notes` 同步註明,並補上複查的交叉證據: cafengshuinet 187/815 與八運 6 組雙星到向)。`input`、`expected` 不變。

## 6. `shop_counter_ideal`、`shop_counter_aligned_with_door_and_tiger_side`、`shop_counter_back_to_entrance`(B.4、R13 更正 2)

`expected` 新增 `left_side_against_wall`(櫃檯**自己的左側**是否貼牆,潮紫微「原則上以左邊要靠牆為佳」,單一來源軟建議)。定義: 座位中心朝「面朝方向的左手邊」走半個櫃寬到左端,左端到房間牆的縫隙 <= 10 公分(縫隙容許是設計值)。期望值由下列手算得出,獨立於 src/core/wealth*.js:

| case | 櫃檯 | 面朝 | 自己的左手邊 | 左端 | 縫隙 | 期望 |
|---|---|---|---|---|---|---|
| shop_counter_ideal | x=4.8 寬 1.6,店寬 6 | 向下(-y) | +x | 4.8 + 0.8 = 5.6 | 6 - 5.6 = 0.4 | false |
| shop_counter_aligned_with_door_and_tiger_side | x=1.5 寬 1.6,店寬 6 | 向下 | +x | 1.5 + 0.8 = 2.3 | 6 - 2.3 = 3.7 | false |
| shop_counter_back_to_entrance | x=4.8 寬 1.6 | 向上(+y) | -x | 4.8 - 0.8 = 4.0 | 4.0 - 0 = 4.0 | false |

三案的既有欄位(`hard_ok`、`aligned_with_door`、`dragon_side`)不變。三案都是 false,不足以區分「有貼牆」的行為,所以正例(縫隙 0、0.1 算貼牆,0.2 不算)寫在 test/wealth.test.js 的 `seatCheck` 測試,不動 fixtures。

## 7. `bazhai_house_坎` 到 `bazhai_house_乾`(8 案,來源 28 看中國,WP-8)

複查 R5 指出研究報告對看中國東四命表筆誤的描述有小誤: 不是「巽命延年寫成東北,與絕命重複」,而是「延年與絕命互換」(另一處離命是延年與伏位對調)。這段描述只出現在研究報告(docs/research/wealth_position.md 第 5 節,不在本任務可改範圍),fixtures 只在 8 個 `bazhai_house_*` 案的 `verified_by` 用「看中國東四命表(3 處來源筆誤除外)」帶過。為避免日後有人拿看中國那張表當測資,8 案的 `verified_by` 改為「…(3 處來源筆誤除外: 離命延年與伏位對調、巽命延年與絕命互換)…」。`expected` 不變。

## 8. 補案 `door_chong_slight_offset`(B.4: 補 50%-80% 輕微偏移案例)

| 欄位 | 值 |
|---|---|
| input | `front: {pos: 1.0, width: 0.9}`、`opposite: {pos: 1.35, width: 0.8}` |
| expected | `chong: false`、`level: "slight"` |
| confidence | low(門檻為設計值) |

獨立算法: 前門 [0.55, 1.45];對門 [0.95, 1.75];重疊 = 1.45 - 0.95 = 0.50;較窄者 0.8;比值 0.625,落在 [0.5, 0.8) → 輕微偏移,不判門沖。

## 沒有動的項目

- meta 完全未動。
- WP-1(延年 > 天醫的順序)、WP-3(九紫 0.8)、WP-5(排序啟發式)、WP-6(L 型)是 [未解決] 的設計值,只在規格與程式註解標示,不動 fixtures。
- 不新增 04:01:30-04:02:30 之間的立春測資(WP-2)。

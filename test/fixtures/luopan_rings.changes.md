# luopan_rings.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.6、附錄 A.7(LP-1、LP-2、LP-6 到 LP-10)、2.8.4 到 2.8.9、決策 D64。
原檔 72 案,修改後仍是 72 案(只改內容,沒有增刪案例)。除下列項目外,原案與 meta 逐字未動(修改腳本以 deepcopy 逐案比對: 72 案中只有下列 8 案有差異,meta 只有 `verified_checks` 一個鍵有差異)。每個被改的案例都新增案例層 `note` 欄說明依據。修改前的舊值都由腳本逐一 assert 過再覆寫。

## 1. hexagram64_xiantian_circle_order(B.6、LP-6、規格 2.8.5)

| 位置 | 舊值 | 新值 | 依據 |
|---|---|---|---|
| `expected.unicode_by_name` 的鍵 | `"无妄"` | `"無妄"`(值 ䷘ U+4DD8 不變,鍵在物件中的位置不變) | 卦名列表與 `ring` 用「無妄」,鍵不一致會造成按名稱查缺 1 筆;複查 fixtureIssues 1 |
| `expected.ring[63]`(坤)的 `end` | `0.0` | `360.0` | 單純比大小會把 [354.375, 0.0) 判成空區間;複查 fixtureIssues 2。跨 0 度的格仍可用 `(b-start) mod 360` |

`confidence` 維持 `low`(乾盡午中的角度錨點只有單一來源)。測試對名稱順序是硬斷言(由文王序上下卦表獨立重推,64/64 一致,並核對卦符碼位 U+4DC0 起依文王序),對角度錨點只斷言模組帶 `confidence:'low'` 旗標。

## 2. palette_contrast(B.6、D64、LP-1、LP-7、規格 2.8.7)

| 位置 | 舊值 | 新值 | 依據 |
|---|---|---|---|
| `expected.palette.wx_fire` | `#E0503D` | `#EC6A57` | D64: 舊值在 lacquer_700/600 底不合格 |
| `expected.palette.wx_water` | `#4E86C6` | `#6A9CDC` | 同上 |
| `expected.legacy_palette` | (無) | `{wx_fire:'#E0503D', wx_water:'#4E86C6'}` | 舊值保留作不合格反例 |
| `expected.contrast` 既有 11 列中 `wx_fire on lacquer_800`、`wx_water on lacquer_800` 兩列 | (無 `legacy`) | 加 `legacy:true` | 這兩列的前景是舊色;其餘 9 列原樣 |
| `expected.contrast` 新增 10 列 | (無) | 見下表 | B.6 |
| `expected.rules` | (無) | `min_text_ratio:4.5`、`all_pairs_pass_only_on:[lacquer_800,lacquer_900]`、`new_wuxing_pass_on:[800,700,600]`、`legacy_wuxing_fail:[3 列]` | B.6: 「所有字底組合 >= 4.5」改為限 lacquer_800/900 底(新五行色則三種底皆過) |
| `meta.verified_checks[103].name` | `all glyph pairs >= 4.5:1` | `glyph pairs >= 4.5:1 (限 lacquer_800/900 底;新五行色則 lacquer_800/700/600 三種底皆過)` | 同上;`passed`、`detail` 不動(那是建檔時的紀錄) |

新增 10 列(每列附 `passes`;舊色列附 `legacy:true`):

| pair | fg | bg | ratio | passes |
|---|---|---|---|---|
| wx_fire (舊色) on lacquer_700 | `#E0503D` | `#221A13` | 4.39 | false |
| wx_fire (舊色) on lacquer_600 | `#E0503D` | `#2D231A` | 3.94 | false |
| wx_water (舊色) on lacquer_700 | `#4E86C6` | `#221A13` | 4.53 | true(4.5295,數值上剛好過) |
| wx_water (舊色) on lacquer_600 | `#4E86C6` | `#2D231A` | 4.06 | false |
| wx_fire (新色) on lacquer_800 / 700 / 600 | `#EC6A57` | `#17120E` / `#221A13` / `#2D231A` | 5.99 / 5.52 / 4.95 | true |
| wx_water (新色) on lacquer_800 / 700 / 600 | `#6A9CDC` | 同上 | 6.55 / 6.04 / 5.41 | true |

依據與驗證: 數字取自規格 B.6;測試以獨立的 WCAG 2.x 實作(test/helpers/luopan.js)重算全部列,容差 0.005(四捨五入到兩位)。規格 2.8.7 把「水 4.53/4.06」並列為舊色不合格,但 4.53 >= 4.5,數值上通過,所以該列 `passes:true`;`rules.legacy_wuxing_fail` 只列真正低於 4.5 的三格。

## 3. layout_rings_A_solarterms(B.6、LP-2、規格 2.8.6)

`confidence` 由 `high` 降為 `medium`;各環 r0/r1 依規格 2.8.6 新表(r5 節氣環加寬到 0.125R,其餘環等比縮小,外緣仍是 0.985):

| key | 舊 r0 | 舊 r1 | 新 r0 | 新 r1 |
|---|---|---|---|---|
| tianchi | 0.0 | 0.2 | 0.0 | 0.188 |
| r1 | 0.2 | 0.4 | 0.188 | 0.376 |
| r2 | 0.4 | 0.48 | 0.376 | 0.4511 |
| r3 | 0.48 | 0.66 | 0.4511 | 0.6203 |
| r4 | 0.66 | 0.69 | 0.6203 | 0.6485 |
| r5 | 0.69 | 0.76 | 0.6485 | 0.7735 |
| r6 | 0.76 | 0.9 | 0.7735 | 0.9051 |
| r7 | 0.9 | 0.985 | 0.9051 | 0.985 |

新表的獨立重算: 原權重(0.2、0.2、0.08、0.18、0.03、0.14、0.085,合計 0.915)乘 (0.985-0.125)/0.915 = 0.93989,r5 固定 0.125,逐環累加後取四位小數,與規格 2.8.6 的表逐格相同。R=180 時 r5 環寬 22.5px >= 兩字徑向堆疊需要的 2×10.5×1.02 = 21.42px(舊寬 0.07×177 = 12.4px 放不下)。key、label 與環數(8 環)不變。

## 4. xiu28_narrow_labels_360px(B.6、LP-8、規格 2.8.6)

| 位置 | 舊值 | 新值 | 依據 |
|---|---|---|---|
| `input.mid_radius_px` | `149.4`(0.83×180) | `151.1` | 統一以 R=180 計算,r6 中徑 = (0.7735+0.9051)/2×180 = 151.07 |
| `input.min_deg` | `4.99` | `4.93` | 13px / 151.07px = 0.0861 rad = 4.93 度 |

`expected`(窄宿集合 `["觜","鬼"]`)不變。

## 5. 120 分金的低信心標記(B.6、LP-4、LP-9、規格 2.8.4)

八干四維山「沿用前一位地支」只有 163.com HJT97HRR 一個來源明說(複查 R8-b),三處依賴它:

| case | 欄位 | 舊值 | 新值 |
|---|---|---|---|
| fenjin120_lookup_337.5(乙亥,壬山) | `confidence` | `medium` | `low` |
| fenjin120_lookup_7.5(甲子,癸山) | `confidence` | `medium` | `low` |
| fenjin120_table | 案例層 `low_confidence_mountains` | (無) | `[癸,艮,甲,乙,巽,丙,丁,坤,庚,辛,乾,壬]` |

fenjin120_table 的案例層 `confidence` 維持 `medium`(12 個地支山與「60 甲子各恰出現 2 次、旺相 48 格」仍是硬斷言);測試對 `low_confidence_mountains` 這 12 山只斷言不崩潰與旗標(`confidence:'low'`、`displayable:false`),但所屬山與起迄角度(幾何,不是單源規則)仍是硬斷言。

## 6. charset_for_font_subset(B.6、LP-10、規格 2.8.9)

| 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|
| `expected.core` | 117 字 | 120 字(補「山、宮、朝」,依 codepoint 排序) | 讀數列「朝向 90.0° 卯山(震宮/天元) 坐酉」需要 |
| `expected.core_count` | 117 | 120 | |
| `expected.nine_star_color_glyphs` | (無) | `碧紫綠赤黃黑`(6 字) | 洛書環顯示九星色名時才嵌;「白」core 已有 |
| `expected.ring_name_glyphs` | (無) | `三二八六十卦四宿山度書氣池洛百節`(16 字) | 規格 2.8.9 的 UI 環名用字: 卦、宿、山、節、氣、池、洛、書、度、百、三、二、八、六、十、四 |
| `expected.full` | 205 字 | 228 字 | 205 字原表 ∪ 山宮朝 ∪ 九星色字 ∪ 環名字 |
| `expected.full_count` | 205 | 228 | 205 + 3(山宮朝)+ 6(色名)+ 14(環名字扣掉已在 full 的「節」與已補的「山」)|

字表組成規則: `charset = core ∪ (九星色字,若顯示) ∪ 環名字`;`full` 另含 64 卦名、分金名、動物名、太少半。原 205 字表已用程式驗證等於 core 117 ∪ 64 卦名 ∪ 120 分金名 ∪ 28 動物名 ∪「太少半」。

## 未動與未驗證

- `meta.verified_checks` 的其他 126 項是建檔腳本的紀錄,原樣保留。其中第 98 項(64 卦環的 `坤 end` 為 0.0)與第 110 項(窄宿 r=149.4px)描述的是修正前的值,已被本檔第 1、4 項取代。
- 「TW-Kai 涵蓋 205 字」「iOS 15 約 384MB canvas 總量」仍未驗證(不在 fixtures 內,規格 2.8.8、2.8.9 已標未驗證)。
- 其餘 64 案(含 geo 已涵蓋的 24 案)逐字未動。

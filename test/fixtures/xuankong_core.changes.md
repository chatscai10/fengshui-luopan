# xuankong_core.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.3(最後一點)、附錄 A.2 的 XC-2、2.4.3 第 5 點、4.1。
原檔 568 案,修改後 568 案。除下列項目外,原案與 meta 逐字未動(已用程式逐行比對:整檔 633 行中只有第 577、578、579 行有差異,meta 沒有任何差異)。

## 1. 三個端點案例標為軟斷言(B.3、XC-2)

下卦端點(恰好 4.5 度)與山界線(7.5 度)的歸屬,中州派度數表與 Wikibooks 兩個相鄰扇區共用端點,沒有來源可以判定;複查者的半開區間分類器對 349.5 給兼向,與 fixture 的下卦相反(xuankong_core.verify.md R10)。規格 2.4.3 第 5 點已定案為含端點(下卦)並附「騎線」提示,所以這三案**不得當硬性斷言**,只斷言「不崩潰並帶騎線旗標」。

| case 名稱 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| locate_edge_340.5 | 案例層 `assertion` | (無) | `"soft"` | B.3、2.4.3 第 5 點 |
| locate_edge_340.5 | 案例層 `note` | (無) | 端點慣例分歧的說明 | XC-2 |
| locate_edge_349.5 | 案例層 `assertion` | (無) | `"soft"` | 同上 |
| locate_edge_349.5 | 案例層 `note` | (無) | 同上 | 同上 |
| locate_edge_352.5 | 案例層 `assertion` | (無) | `"soft"` | 同上 |
| locate_edge_352.5 | 案例層 `note` | (無) | 同上 | 同上 |

三案的 `expected`(340.5 與 349.5 為下卦,352.5 為子山兼向需替)與 `confidence: "low"` 都沒有改。`confidence: "low"` 本來就走軟斷言(spec 4.2 第 2 點);`assertion: "soft"` 是把規格的「標軟斷言」寫成機器可讀的欄位。

test/xuankong.test.js 對這三案的軟斷言 = `locateFacing` 不崩潰、回傳 `ridingLine === true`(340.5、349.5 是下卦端點 `onZoneEdge`,352.5 是山界線 `onMountainLine`)、`needTi` 為布林、`zone` 落在 `xia`/`jian`。突變測試證明:換成非端點角度(0 度)時軟斷言 runner 會丟錯。其餘 72 個 `locate_degree` 案例仍是硬斷言。

## 2. 沒有修改的部分(與附錄 B 的關係)

- `chart_xia`(216)、`chart_ti`(216)、`chart_from_facing_degree`(10)、`yun_pan`(9)、`direction_rule`(9)、`pattern`(6)、`old_engine_regression`(3)、`table`(2)、`yun_of_datetime`(22)全部原樣。
- `yun_of_datetime` 的 22 案由 calendar.test.js 對 `calendar.yunOfInstant` 驗證;xuankong.test.js 再對 `resolveYuns`(chartYun 與 currentYun)驗證一次,22/22 相符。
- 附錄 A.2 的 XC-3(立春表 1864/1884/2044 分鐘值)已由 calendar 取代硬編表,fixtures 沒有相關欄位;XC-4 至 XC-8 是文字與信心層面的更正,不動 fixtures。

## 3. 發現但不屬於本次修正的事項(未動檔案)

- xuankong_core.md 3.2 節寫「替星 A、B 兩表只在 12 山不同(子丑寅卯巳午丁未庚酉戌乾)」,但丁在兩表都是 9(fixtures `table_ti_star` 的 A、B 逐山比對可見),實際差異是 11 山(子丑寅卯巳午未庚酉戌乾)。這是研究報告的筆誤,規格內嵌表與 fixtures 都沒有這個問題;test/xuankong.test.js 以 11 山為準。

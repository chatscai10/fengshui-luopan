# xuankong_patterns.json 修改記錄

依據: docs/DOMAIN_SPEC.md 附錄 B.3、附錄 A.3(XP-3、XP-5、XP-6、XP-10、XP-11)、2.4.8、2.4.9、2.4.10、4.1。
原檔 474 案,修改後 474 案。除下列項目外,原案與 meta 逐字未動(已用程式逐案比對:原 474 案中只有 pair_tag 4 案、qi 81 案、chengmen_use 31 案、wealth9 24 案有差異,其餘 334 案完全相同;meta 只多一個新鍵 `partialCharts`)。案例 `name` 全部維持原樣,當作穩定的識別碼,所以「四四文昌」案的名稱沒變、內容已改成存疑。

## 1. pair_tag 4 案(B.3 第 1 點、XP-3、XP-10;規格 2.4.9 更正版)

| case 名稱 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| 星組合 16 一六文昌 | `expected.tag` | 一六文昌 | 一六(水金相生;失令主水淫天門) | 36FS zs38 把一六寫成「水淫天門」(xuankong_patterns.verify.md R18) |
| 星組合 16 一六文昌 | `expected.nature` | 吉 | 視旺衰 | 同上 |
| 星組合 16 一六文昌 | `confidence` | high | medium | 同上;不單獨當文昌位依據 |
| 星組合 44 四四文昌 | `expected.tag` | 四四文昌 | 四四(失令偏凶,存疑) | 36FS zs40 把四四寫成「瘋瘟之症」,無文昌之說 |
| 星組合 44 四四文昌 | `expected.nature` | 吉 | 存疑 | 同上 |
| 星組合 44 四四文昌 | `confidence` | low | low(不變) | 規格 2.4.9 仍標 low |
| 星組合 59 五九毒藥(不設爐灶) | `expected.tag` | 五九毒藥(不設爐灶) | 五九(火生五黃) | 「毒藥」二字不見於 zs40(該頁為「土鈍執拗」);不設爐灶為推論 |
| 星組合 59 五九毒藥(不設爐灶) | `expected.nature`、`confidence` | 凶、low | 凶、low(不變) | 同上 |
| 星組合 39 三九文昌 | `expected.tag` | 三九文昌 | 三九文昌(木火通明;個性偏刻薄) | zs37-zs42 核對,三九為「聰明但刻薄」 |
| 星組合 39 三九文昌 | `expected.nature`、`confidence` | 吉、low | 吉、low(不變) | 文昌位只採一四(high)與三九(low,帶但書) |

四案各加案例層 `note` 說明更正原因。其餘 16 個 pair_tag 案(二五、三七、六七、七九、二三、二七、三五、五七、一五、六九、一四、一九、六八、二六、七八、八九)與 2.4.9 的 JSON 逐欄相同,沒有動。測試另把 `PAIR_TAGS` 整個物件與 DOMAIN_SPEC.md 2.4.9 的 JSON 區塊做 deepEqual(20/20)。

## 2. qi 81 案: confidence 全標 low、note 註明工程上限(B.3 第 2 點、XP-11、規格 2.4.8)

| 範圍 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| qi 81 案(9 運 x 9 星) | `confidence` | 63 案 medium、18 案 high(八運與九運各 9 案) | 81 案全部 low | 星 2 的 0.5 上限與星 5 的 -3 上限是工程值,不是來源(規格 2.4.8,信心: 低) |
| qi 81 案 | `note` | 只有星 2 與星 5 的 18 案有註記(英文) | 81 案全部有註記;原註記保留,後面以 ` | ` 接上「B.3 更正: 星2 的 0.5 上限與 星5 的 -3 上限是工程值(非來源,規格 2.4.8);五氣標籤由距離規則 d=(星-運) mod 9 推得,分數為工程值」 | XP-11 |

`expected`(default/S1/S2 標籤與 score)一個字都沒改。

因為 confidence 改成 low,harness 依 spec 4.2 第 2 點走軟斷言(不崩潰、回傳字串標籤與有限數字)。為了不讓 81 案的驗證力消失,test/xuankong.patterns.test.js 另加一個「工程值快照」測試,把 81 案的標籤與分數全部硬斷言;另有獨立寫法(if/else 距離規則,不共用實作的表)的 9 x 9 x 3 套全表比對。分數是工程值,調整時同步更新規格 2.4.8 與該測試。

## 3. chengmen_use 31 案: note 補單一作者註記(B.3 第 3 點、XP-6)

| 範圍 | 欄位 | 舊值 | 新值 |
|---|---|---|---|
| chengmen_use 31 案 | `note` | `single-author rule: usable iff the gate palace's 向星 is 9/1/2 (N, N+1, N+2); matches all quoted items after fixing 2 palace-label typos in the source`(英文,31 案相同) | 原句保留,後接 ` | B.3 補註: 單一作者簡化規則,與 SINA-HESHI 八運子山午向「有城門可用」不同義` |

`expected` 與 `confidence`(medium)沒有改。依據: 該規則是刘燮钧單一作者的簡化規則;SINA-HESHI 對八運子山午向另說「有城門可用」,而該盤巽宮向星 4、坤宮向星 6(N=8)依簡化規則兩宮皆不可用,兩者對「可用」的定義不同(xuankong_patterns.verify.md R16)。

## 4. chart 7 案部分欄位: 在 meta 註明(B.3 第 4 點、XP-11)

7 案「辰山戌向 運N 星盤(來源前兩列)」(運 1、4、5、6、7、8、9)的 `expected` 只有 `rows`、`pattern`、`shan`、`xiang`,缺 `face`、`sitPalace`、`facePalace`、`shanCenter`、`xiangCenter`、`shanForward`、`xiangForward`。案例本身沒有動,`meta` 新增鍵 `partialCharts`:

```json
"partialCharts": { "note": "...", "cases": ["辰山戌向 運1 星盤(來源前兩列)", ...共 7 個], "missingFields": ["face", "sitPalace", "facePalace", "shanCenter", "xiangCenter", "shanForward", "xiangForward"] }
```

runner 對缺欄位不報錯,只核對有給的欄位(`rows` 逐宮的「山向」兩位數字、`shan`/`xiang` 兩個平面、`pattern`);測試另外守門:這 7 案必須與 `meta.partialCharts.cases` 一一對應。

## 5. wealth9 24 案: 欄名改 xiang9_at、shan9_at(B.3 第 5 點、XP-2、規格 2.4.10)

| 範圍 | 欄位 | 舊值 | 新值 | 依據 |
|---|---|---|---|---|
| wealth9 24 案 | `expected` 的鍵 `xiang9` | 向星 9 的宮(欄頭原稱「旺財」) | 改名 `xiang9_at`,值不變 | 雙星會坐盤的向星 9 在坐宮,不算旺財位(R17) |
| wealth9 24 案 | `expected` 的鍵 `shan9` | 山星 9 的宮 | 改名 `shan9_at`,值不變(雙星會坐時為旺丁位) | 同上 |
| wealth9 24 案(全為九運) | `note` | (無) | 「B.3 更正: xiang9 改名 xiang9_at、shan9 改名 shan9_at…」 | 同上 |

其餘六個鍵(`xiang1`、`shan1`、`xiang2`、`shan2`、`xiang8`、`shan8`)不改。程式端 `nineStarPositions(chart)` 輸出同樣的欄名。測試守門:24 案都不得再出現 `xiang9`。

## 6. 沒有修改的部分

- polarity(24)、yunpan(9)、chart 其餘 24 案、pattern(72)、patternList(36)、heshi(24)、qixing(48)、parent3(16)、qixing_fuyin(6)、lianshu3(16)、yin_assert(10)、chengmen(8)、star_dict(9)、qi_classical(9)全部原樣。
- lianshu3 16 案本來就標 low(定義有爭議,只標記不計分),走軟斷言;另以規則本身的硬斷言守 16 局名單(研究報告 2.7)。
- qi_classical 9 案是資料照錄(不規則),不寫成演算法;測試只斷言能由規則確認的關係(旺 = 當運星、生氣星在 d=1、2、衰 = 剛過去的運、死氣星在 d=3..7)。

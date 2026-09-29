# 分析門面 API(給 UI 作者)

離線風水羅盤的核心只有兩個入口,其餘模組(geo、calendar、bazhai、xuankong、annual、plan、wealth)都藏在後面:

| 函式 | 檔案 | 作用 |
|---|---|---|
| `analyzeHouse(input, settingsOverrides?, opts?)` | `src/core/analyze.js` | 把一間房子的所有輸入算成一份 `HouseReport`(純資料,JSON 可序列化) |
| `renderReport(report, opts?)` | `src/core/copy.js` | 把 `HouseReport` 轉成結果頁的分段卡片(繁體中文白話文案) |

UI 只做三件事:收集輸入、呼叫這兩個函式、把卡片畫出來。兩個函式都是純函式:不讀時鐘(時間由 `nowMs` 傳入)、不碰 DOM 與網路、不修改傳入的物件、同輸入必得同輸出。

```js
import { analyzeHouse } from './src/core/analyze.js';
import { renderReport } from './src/core/copy.js';

const report = analyzeHouse(input, { wealthProfile: 'mingcai' });
const page = renderReport(report);
// page.plainSummary  第一屏的一小段白話總覽
// page.sections[]    固定六個分段,每段有卡片
// page.disclaimers[] 頁底固定的免責聲明
```

本文的 JSON 範例都是用真實程式產生的(九運丑山未向、2026-09-29、坎命一位住戶、10x8 外框與 6x5 客廳),
`test/analyze.test.js` 會用同一份輸入重新計算並與本文比對,文件與程式不一致時測試會失敗。

## 1. 輸入 `HouseInput`

全部欄位都必須是 JSON 可序列化的值(數字、字串、布林、null、陣列、物件)。時間一律是 `ms since epoch (UTC)`。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `nowMs` | number | 是 | 分析基準時刻。用來判定「今年」(立春換年)、目前是第幾運、流月 |
| `utcOffsetMinutes` | number | 否,預設 480 | 使用者所在時區(分鐘)。住戶沒給時區時的預設;為 480 時,台灣 1938-1945 年出生會由 tzdata 查成 +09:00 |
| `facing.bearing` | number | 是 | 宅向的羅盤讀數(度)。手機讀到的磁方位;任意有限實數,分析前會正規化到 [0,360) |
| `facing.doorBearing` | number \| null | 否 | 大門朝向的讀數;null = 同 `bearing`。八宅預設吃它(`bazhaiFacingBasis='door'`),玄空吃 `bearing` |
| `facing.declination` | number \| null | 否 | 磁偏角 D(度,東偏為正,台北約 -5.06)。`northMode='true'` 時必須有,否則退回磁北;有給時一律做磁北與真北並列 |
| `facing.uncertainty` | number \| null | 否 | 本次量測的不確定度(度)。null = 用設定的 `measureUncertainty`(預設 5.0) |
| `building.type` | `'apartment'` \| `'house'` \| `'shop'` \| `'office'` | building 有給時必填 | 建築類型,用來檢查大門與宅向的夾角是否需要使用者確認 |
| `building.builtYear` | number \| null | 否 | 建成年份。沒有就略過玄空盤與玄空財位 |
| `building.moveInYear` | number \| null | 否 | 遷入年份(`yunBasis='moveIn'` 或整修換運時的備援) |
| `building.renovation` | `'none'` \| `'partial'` \| `'full'` \| `'anyRenovation'` | 否 | 整修情形;有給時就是這次分析的 `renovation` 設定(除非 `settingsOverrides` 明寫了 `renovation`) |
| `building.renovatedYear` | number \| null | 否 | 整修完工年份(本檔新增的選填欄位);`full`/`anyRenovation` 時沒給就用 `moveInYear` |
| `building.floor` | number \| null | 否 | 樓層 |
| `residents[]` | 陣列 | 否 | 住戶。沒有就不做命卦與本命財位 |
| `residents[].id` | string | 否 | 沒給時自動編為 `p1`、`p2`…;不可重複 |
| `residents[].name` | string | 否 | 顯示用名字;沒給時顯示「住戶1」「住戶2」,內部 id 不會出現在文案裡 |
| `residents[].gender` | `'M'` \| `'F'` | 命卦必填 | 缺或不認得 → 這位住戶略過並產生 Finding |
| `residents[].birth` | string | 命卦必填 | `'YYYY-MM-DD HH:mm'`(當地時間)或 `'YYYY-MM-DD'`(不知時刻)。格式不對或日期不存在 → 略過並產生 Finding |
| `residents[].utcOffsetMinutes` | number \| null | 否 | 出生地時區;null = 依 `utcOffsetMinutes` 規則決定 |
| `mainResidentId` | string \| null | 否 | 主要收入者(八宅大門與睡向優先照顧的人) |
| `plan` | PlanV1 \| null | 否 | 平面圖(規格 2.7.1)。`planUpBearing` 必須已是目前 `northMode` 的基準(切換北基準時用 `plan.convertPlanNorth`) |
| `wealthOptions` | 物件 | 否 | 原樣轉給 `analyzeWealth`:`flags`(環境旗標,例如 `{"living:TR": {"beam": true}}`)、`candidateRoomIds`、`doorOverride`、`shielded` |

第二個參數 `settingsOverrides` 是部分 Settings(見第 6 節),未知的鍵丟 `INVALID_SETTING`。
第三個參數 `opts.lunarNewYearOf(year) => 'YYYY-MM-DD'` 是農曆春節解析器(函式不可序列化,所以不放在 input);沒有它時 `yearBoundary='lunar_new_year'` 會降級成立春並給 Finding。

### 範例輸入

<!-- example:input -->
```json
{
  "nowMs": 1790654400000,
  "utcOffsetMinutes": 480,
  "facing": {
    "bearing": 210,
    "doorBearing": null,
    "declination": -5.06,
    "uncertainty": null
  },
  "building": {
    "type": "apartment",
    "builtYear": 2025,
    "moveInYear": null,
    "renovation": "none",
    "floor": null
  },
  "residents": [
    {
      "id": "p1",
      "name": "本人",
      "gender": "M",
      "birth": "1990-05-15 10:30",
      "utcOffsetMinutes": null
    }
  ],
  "mainResidentId": "p1",
  "plan": {
    "version": 1,
    "unit": "m",
    "planUpBearing": 30,
    "outline": [
      [
        0,
        0
      ],
      [
        10,
        0
      ],
      [
        10,
        8
      ],
      [
        0,
        8
      ]
    ],
    "rooms": [
      {
        "id": "living",
        "type": "living",
        "polygon": [
          [
            0,
            0
          ],
          [
            6,
            0
          ],
          [
            6,
            5
          ],
          [
            0,
            5
          ]
        ]
      }
    ],
    "openings": [
      {
        "id": "d1",
        "kind": "entrance",
        "roomId": "living",
        "wall": "bottom",
        "pos": 1,
        "width": 0.9
      }
    ],
    "mainDoor": "d1",
    "taiji": {
      "mode": "centroid",
      "manual": null
    }
  }
}
```

## 2. 輸出 `HouseReport`

| 欄位 | 內容 | 來源模組 |
|---|---|---|
| `meta` | schema、實際使用的完整設定 `ruleset`、`northMode`、磁偏角、`computedAtCST`、`warnings`(彙整所有模組)、`modules`(各模組 schema)、`inputEcho`(輸入複本,含住戶名字、開口 id) | analyze |
| `geo` | `analyzeBearing` 的結果(向的山、下卦或兼向、空亡、騎線、`needsTiGua`…)加上坐山、宅卦、`label`(如「丑山未向」)、磁北真北並列 `north.compare`、大門與宅向夾角 `facingPick` | geo |
| `bazhai` | `house`(宅卦與八方位星)、`residents[]`(每位住戶的命卦、八方位星、財位序、各用途評級、是否命宅相配)、`match`(命宅相配與多人處理)、`skipped`(資料不完整而略過的住戶) | bazhai |
| `xuankong` | 玄空盤(山向運三盤、格局、特殊格局、五氣、星組合、財丁位);沒有建成年份時為 `null` | xuankong |
| `annual` | 流年盤、流月、太歲歲破、三煞、五黃二黑 | annual |
| `planShares` | 各房間在八宮的面積與佔比、太極點;沒有(合法的)平面圖時為 `null` | plan |
| `wealth` | 財位完整分析:`layers`(明、八宅、玄空、流年、本命、水火)、`sectors`(八宮各自的星與能量)、`candidates`(候選位置,依分數排序)、`ranking`、`bestId`、`doorChong` | wealth |
| `findings[]` | 所有模組的 Finding 合併(id 不重複);每則多一個 `subject`(與哪位住戶有關,住戶 id 或 null) | 各模組 + analyze |
| `summary` | 給總覽與文案用的彙整,見下 | analyze |

`Finding` 形狀(規格 1.4):

```ts
{ id: string, level: 'info'|'note'|'caution', title: string, body: string,
  confidence: 'high'|'medium'|'low', tag: 'source'|'inference'|'design'|'minority',
  schoolNote: string|null, refs: string[], subject: string|null }
```

`findings` 裡的 `title`、`body` 已是白話中文,但仍含少數內部痕跡(來源編號、乘數等)。**給使用者看的文字請一律用 `renderReport` 的輸出**。

### `summary`

<!-- example:summary -->
```json
{
  "headline": "丑山未向",
  "zhai": "艮宅",
  "zhaiGroup": "west",
  "yun": 9,
  "pattern": "雙星會向",
  "residents": [
    {
      "id": "p1",
      "name": "本人",
      "gua": "坎",
      "group": "east",
      "matchesHouse": false
    }
  ],
  "year": {
    "fengshuiYear": 2026,
    "ganzhi": "丙午",
    "wuhuang": "南",
    "erhei": "西北",
    "sansha": "北",
    "taisui": "南"
  },
  "wealthTop": [
    {
      "id": "living:TR",
      "kind": "ming",
      "label": "明財位",
      "roomId": "living",
      "roomType": "living",
      "corner": "TR",
      "sector": "震",
      "dir8": "東",
      "status": "ok",
      "borderline": false,
      "tier": "suitable",
      "score": 66.88
    }
  ],
  "cautions": [
    {
      "id": "xk.pair.xun.shan_xiang.2-7",
      "title": "巽宮(東南方): 二七同宮"
    },
    {
      "id": "xk.pair.dui.shan_yun.2-5",
      "title": "兌宮(西方): 二五交加"
    },
    {
      "id": "xk.pair.li.shan_xiang.2-7",
      "title": "離宮(南方): 二七同宮"
    },
    {
      "id": "xk.star9.5.qian.xiang",
      "title": "乾宮(西北方)的向星是五黃(煞)"
    },
    {
      "id": "xk.star9.5.dui.shan",
      "title": "兌宮(西方)的山星是五黃(煞)"
    }
  ]
}
```

- `headline` 是坐向標籤(有兼向時如「癸山丁向兼丑未」)。
- `wealthTop` 是財位前幾名:有平面圖且方位已知時取候選位置(只列「較適合」「可以考慮」,最多 3 個,明財位不論排名都列出);否則取八宮的暗財位前 3 名(`kind:'dark'`)。`score` 只供排序,**不可顯示**;顯示用 `tier`(`suitable`=較適合、`consider`=可以考慮、`notAdvised`=不建議,門檻見第 5 節)。
- `cautions` 是 `level:'caution'` 的 Finding(id 與標題),條數可用來寫「另有 N 項需要留意」。

### `geo`(完整)

<!-- example:geo -->
```json
{
  "bearing": 210,
  "mountain": "未",
  "index": 14,
  "dev": 0,
  "zone": "zheng",
  "level": "zheng",
  "leanTo": null,
  "pairType": null,
  "neighborMountain": "丁",
  "neighborGua": "離",
  "boundaryDist": 7.5,
  "boundaryKind": "gua",
  "kongwangKind": null,
  "kongwangKindDegree": null,
  "schoolNote": null,
  "onLine": false,
  "retest": false,
  "outer1p5": false,
  "needsTiGua": false,
  "gua": "坤",
  "dir8": "西南",
  "opposite": "丑",
  "facingMountain": "未",
  "sitMountain": "丑",
  "sitBearing": 30,
  "zhaiGua": "艮",
  "zhaiSitDir": "東北",
  "lean": null,
  "label": "丑山未向",
  "basis": "input",
  "door": null,
  "facingPick": null,
  "north": {
    "mode": "magnetic",
    "declination": -5.06,
    "reading": {
      "facing": 210,
      "door": null
    },
    "used": {
      "facing": 210,
      "door": null
    },
    "compare": {
      "facing": {
        "magneticBearing": 210,
        "trueBearing": 204.94,
        "magneticMountain": "未",
        "trueMountain": "未",
        "magneticGua": "坤",
        "trueGua": "坤",
        "sameMountain": true,
        "sameGua": true
      },
      "sitMountain": {
        "magnetic": "丑",
        "true": "丑"
      },
      "zhaiGua": {
        "magnetic": "艮",
        "true": "艮"
      },
      "differs": {
        "mountain": false,
        "gua": false
      }
    }
  },
  "meta": {
    "schema": "fengshui.geo.bearing/1",
    "ruleset": {
      "xiaGuaHalfWidth": 4.5,
      "jianLimitSchool": "default",
      "kongwangLabelScheme": "position",
      "measureUncertainty": 5
    }
  }
}
```

- `bearing` 是**分析採用**的向(依 `northMode` 換算後),`north.reading` 是原始讀數,`north.used` 是換算後的值。
- `mountain`(等於 `facingMountain`)是向山,`opposite`(等於 `sitMountain`)是坐山;`dev` 帶正負號,正 = 偏順時針側的鄰山。
- 不採用 `analyzeBearing` 自帶的 `geo.near_gua_boundary`:它針對「向」的卦界,文案卻稱「宅卦」,而宅卦是由「坐」決定的;宅卦臨界只採八宅的 `bz.house.near_gua_boundary`。
- `north.compare` 為 null 表示沒有磁偏角;有的話即使兩種讀法相同也會給,`differs` 說明是否需要並列。

### `meta`

<!-- example:meta -->
```json
{
  "schema": "fengshui.house/1",
  "ruleset": "(完整設定,見「設定開關」一節)",
  "northMode": "magnetic",
  "declination": -5.06,
  "declinationDate": "2026-09-29",
  "computedAtCST": "2026-09-29 12:00",
  "utcOffsetMinutes": 480,
  "warnings": [],
  "modules": {
    "geo": "fengshui.geo.bearing/1",
    "bazhai": "fengshui.bazhai/1",
    "xuankong": "fengshui.xuankong/1",
    "annual": "fengshui.annual/1",
    "plan": "fengshui.plan/1",
    "wealth": "fengshui.wealth/1"
  },
  "inputEcho": "(輸入的複本)"
}
```

`meta.ruleset` 是實際使用的完整 Settings(降級後的值,例如真北缺磁偏角時 `northMode` 會是 `magnetic`);`meta.warnings` 是各模組警告碼的聯集。

### `bazhai`(節錄)

```json
{
  "house": {
    "facingBearing": 210,
    "sitBearing": 30,
    "facingMountain": "未",
    "sitMountain": "丑",
    "gua": "艮",
    "name": "艮宅",
    "group": "west",
    "sitDir": "東北",
    "stars": {
      "北": "五鬼",
      "東北": "伏位",
      "東": "六煞",
      "東南": "絕命",
      "南": "禍害",
      "西南": "生氣",
      "西": "延年",
      "西北": "天醫"
    },
    "boundary": {
      "distDeg": 7.5,
      "kind": "gua",
      "onLine": false,
      "nearGuaBoundary": false,
      "otherGua": null
    }
  },
  "residents": [
    {
      "id": "p1",
      "name": "本人",
      "gender": "M",
      "role": "breadwinner",
      "ming": {
        "effectiveYear": 1990,
        "rawNumber": 1,
        "guaNumberUsed": 1,
        "gua": "坎",
        "group": "east",
        "flags": {
          "nearLichun": false,
          "dateIsLichunDay": false,
          "alternatives": []
        },
        "approx": false
      },
      "stars": {
        "北": "伏位",
        "東北": "五鬼",
        "東": "天醫",
        "東南": "生氣",
        "南": "延年",
        "西南": "絕命",
        "西": "禍害",
        "西北": "六煞"
      },
      "wealthOrder": [
        {
          "star": "生氣",
          "dir": "東南"
        },
        {
          "star": "延年",
          "dir": "南"
        },
        {
          "star": "天醫",
          "dir": "東"
        },
        {
          "star": "伏位",
          "dir": "北",
          "backup": true
        }
      ],
      "matchesHouse": false,
      "usage": "(各用途的八方位評級,略)",
      "threeKeys": null
    }
  ],
  "match": {
    "byPerson": {
      "p1": false
    },
    "policy": "mingOverHouse",
    "advice": "以個人命卦重排床頭、書桌、灶口的吉方;大門若無法改,至少讓門、主臥、灶口三項中有一項落在吉方",
    "basis": "breadwinner",
    "mixed": false,
    "consideredIds": [
      "p1"
    ],
    "anchorId": "p1",
    "sleepCareId": "p1",
    "combined": null
  },
  "skipped": [],
  "warnings": []
}
```

### `xuankong`(節錄)

```json
{
  "meta": {
    "schema": "fengshui.xuankong/1",
    "ruleset": "(略)",
    "chartYun": 9,
    "currentYun": 9,
    "yun": {
      "chartYun": 9,
      "currentYun": 9,
      "basis": "built",
      "basisInstant": 1751342400000,
      "differs": false,
      "warnings": [],
      "schoolNote": null
    },
    "northMode": "magnetic",
    "declination": -5.06,
    "declinationDate": "2026-09-29",
    "computedAtCST": "2026-09-29 12:00",
    "warnings": []
  },
  "locate": {
    "bearing": 210,
    "mountain": "未",
    "sit": "丑",
    "dev": 0,
    "zone": "xia",
    "side": null,
    "neighbor": null,
    "kind": null,
    "needTi": false,
    "outer": false,
    "onZoneEdge": false,
    "onMountainLine": false,
    "ridingLine": false
  },
  "chart": {
    "palaces": {
      "坤": {
        "yun": 6,
        "shan": 9,
        "xiang": 9
      },
      "坎": {
        "yun": 5,
        "shan": 8,
        "xiang": 1
      },
      "震": {
        "yun": 7,
        "shan": 1,
        "xiang": 8
      },
      "…其餘 6 宮": "略"
    },
    "pattern": "雙星會向"
  },
  "pattern": "雙星會向",
  "…": "wholePlate、specials、qi、pairTags、positions、findings 與 analyzeXuankong 的輸出相同"
}
```

### `annual`

```json
{
  "year": {
    "fengshuiYear": 2026,
    "ganzhi": "丙午",
    "lichun": 1770148910196,
    "lichunCST": "2026-02-04 04:02",
    "yun": 9,
    "yunYear": 3,
    "era": "下元"
  },
  "annual": {
    "center": 1,
    "chart": {
      "中宮": 1,
      "西北": 2,
      "西": 3,
      "東北": 4,
      "南": 5,
      "北": 6,
      "西南": 7,
      "東": 8,
      "東南": 9
    },
    "chartByGua": {
      "中": 1,
      "乾": 2,
      "兌": 3,
      "艮": 4,
      "離": 5,
      "坎": 6,
      "坤": 7,
      "震": 8,
      "巽": 9
    },
    "wuhuang": "南",
    "erhei": "西北",
    "wuhuangGua": "離",
    "erheiGua": "乾"
  },
  "month": {
    "fengshuiYear": 2026,
    "jie": "白露",
    "ganzhi": "丁酉",
    "order": 7,
    "start": 1788792081704,
    "end": 1791440973585,
    "startCST": "2026-09-07 22:41",
    "endCST": "2026-10-08 14:30",
    "center": 1,
    "chart": {
      "中宮": 1,
      "西北": 2,
      "西": 3,
      "東北": 4,
      "南": 5,
      "北": 6,
      "西南": 7,
      "東": 8,
      "東南": 9
    },
    "wuhuang": "南",
    "erhei": "西北"
  },
  "taisui": {
    "branch": "午",
    "bearing": 180,
    "gua": "離",
    "dir": "南",
    "suipo": "子",
    "suipoBearing": 0,
    "suipoGua": "坎",
    "suipoDir": "北"
  },
  "sansha": {
    "group": "寅午戌",
    "dir": "北",
    "mountains": "亥子丑",
    "jieSha": "亥",
    "zaiSha": "子",
    "suiSha": "丑",
    "jiaSha": [
      "壬",
      "癸"
    ],
    "arcs": {
      "core3": [
        [
          322.5,
          337.5
        ],
        [
          352.5,
          7.5
        ],
        [
          22.5,
          37.5
        ]
      ],
      "withJiaSha": [
        322.5,
        37.5
      ],
      "branch12": [
        315,
        45
      ]
    },
    "arc": {
      "layer": "core3",
      "ranges": [
        [
          322.5,
          337.5
        ],
        [
          352.5,
          7.5
        ],
        [
          22.5,
          37.5
        ]
      ]
    },
    "showJiaSha": false
  },
  "findings": [],
  "approx": false,
  "meta": {
    "schema": "fengshui.annual/1",
    "ruleset": {
      "yearBoundary": "lichun_exact",
      "yunSystem": "san_yuan_9",
      "sanshaArc": "core3",
      "extraShensha": false,
      "showMinorityTechniques": false
    },
    "computedAtCST": "2026-09-29 12:00",
    "warnings": []
  }
}
```

### `planShares`

```json
{
  "taiji": [
    5,
    4
  ],
  "taijiMode": "centroid",
  "planUpBearing": 30,
  "outlineArea": 80,
  "totalArea": 30,
  "roomAreas": {
    "living": 30
  },
  "shares": {
    "living": {
      "坎": 0.5857864376269051,
      "艮": 0.44948974278317816,
      "震": 0.5505102572168218,
      "巽": 0.44948974278317844,
      "離": 2.563116525311351,
      "坤": 7.191835884530851,
      "兌": 12.215727876325868,
      "乾": 5.994043533421845
    }
  },
  "palaces": {
    "坎": [
      {
        "roomId": "living",
        "area": 0.5857864376269051,
        "pct": 1
      }
    ],
    "艮": [
      {
        "roomId": "living",
        "area": 0.44948974278317816,
        "pct": 1
      }
    ],
    "震": [
      {
        "roomId": "living",
        "area": 0.5505102572168218,
        "pct": 1
      }
    ],
    "巽": [
      {
        "roomId": "living",
        "area": 0.44948974278317844,
        "pct": 1
      }
    ],
    "離": [
      {
        "roomId": "living",
        "area": 2.563116525311351,
        "pct": 1
      }
    ],
    "坤": [
      {
        "roomId": "living",
        "area": 7.191835884530851,
        "pct": 1
      }
    ],
    "兌": [
      {
        "roomId": "living",
        "area": 12.215727876325868,
        "pct": 1
      }
    ],
    "乾": [
      {
        "roomId": "living",
        "area": 5.994043533421845,
        "pct": 1
      }
    ]
  },
  "palaceArea": {
    "坎": 0.5857864376269051,
    "艮": 0.44948974278317816,
    "震": 0.5505102572168218,
    "巽": 0.44948974278317844,
    "離": 2.563116525311351,
    "坤": 7.191835884530851,
    "兌": 12.215727876325868,
    "乾": 5.994043533421845
  },
  "mainUse": {
    "坎": "living",
    "艮": "living",
    "震": "living",
    "巽": "living",
    "離": "living",
    "坤": "living",
    "兌": "living",
    "乾": "living"
  },
  "warnings": []
}
```

面積單位是平方公尺,不四捨五入(面積守恆);顯示時再取小數。

### `wealth`(節錄)

```json
{
  "meta": {
    "schema": "fengshui.wealth/1",
    "ruleset": "(略)",
    "northMode": "magnetic",
    "declination": -5.06,
    "declinationDate": "2026-09-29",
    "computedAtCST": "2026-09-29 12:00",
    "warnings": [],
    "xkValFallback": false,
    "hasResidents": true,
    "scoreCap": 100
  },
  "layers": {
    "ming": [
      {
        "label": "明財位",
        "roomId": "living",
        "roomType": "living",
        "door": {
          "id": "d1",
          "kind": "entrance",
          "wall": "bottom",
          "pos": 1,
          "width": 0.9,
          "point": [
            1,
            0
          ]
        },
        "geometry": "rect",
        "centered": false,
        "tied": false,
        "dragonOnly": false,
        "ray45": null,
        "warnings": [],
        "corners": [
          {
            "corner": "TR",
            "point": [
              6,
              5
            ],
            "walkDist": 7.0710678118654755,
            "role": "primary",
            "dragonSide": true,
            "candidateId": "living:TR"
          }
        ]
      }
    ],
    "bazhai": {
      "facingBearing": 210,
      "sitBearing": 30,
      "sitMountain": "丑",
      "houseGua": "艮",
      "houseName": "艮宅",
      "sitDir": "東北",
      "order": [
        {
          "star": "生氣",
          "dir": "西南",
          "gua": "坤",
          "value": 1
        },
        {
          "star": "延年",
          "dir": "西",
          "gua": "兌",
          "value": 0.75
        },
        {
          "star": "天醫",
          "dir": "西北",
          "gua": "乾",
          "value": 0.55
        },
        {
          "star": "伏位",
          "dir": "東北",
          "gua": "艮",
          "value": 0.25,
          "backup": true
        }
      ],
      "byStar": {
        "生氣": "西南",
        "延年": "西",
        "天醫": "西北",
        "伏位": "東北",
        "絕命": "東南",
        "五鬼": "北",
        "六煞": "東",
        "禍害": "南"
      },
      "byDir": {
        "北": "五鬼",
        "東北": "伏位",
        "東": "六煞",
        "東南": "絕命",
        "南": "禍害",
        "西南": "生氣",
        "西": "延年",
        "西北": "天醫"
      }
    },
    "…": "xuankong、annual、mingGua、water 與 analyzeWealth 的輸出相同"
  },
  "sectors": {
    "震": {
      "gua": "震",
      "dir": "東",
      "components": {
        "XK": 0.7249999999999999,
        "H": -0.3,
        "P": 0.55,
        "Y": 1
      },
      "stars": {
        "xiang": 8,
        "shan": 1,
        "house": "六煞",
        "year": 8,
        "people": {
          "p1": "天醫"
        }
      },
      "energy": 36.88
    },
    "…其餘 7 宮": "略"
  },
  "candidates": [
    {
      "id": "living:TR",
      "kind": "ming",
      "label": "明財位",
      "isMingCai": true,
      "roomId": "living",
      "roomType": "living",
      "corner": "TR",
      "point": [
        6,
        5
      ],
      "role": "primary",
      "G": 1,
      "gKind": "mingPrimary",
      "status": "ok",
      "holds": true,
      "flags": {},
      "sector": "震",
      "sectorInfo": {
        "gua": "震",
        "dir8": "東",
        "bearing": 75,
        "boundaryDeg": 7.5,
        "borderline": false,
        "otherGua": "艮"
      },
      "components": {
        "XK": 0.7249999999999999,
        "H": -0.3,
        "P": 0.55,
        "Y": 1
      },
      "rawScore": 66.875,
      "score": 66.88,
      "subtotal": 0.66875,
      "envMultiplier": 1,
      "excluded": false,
      "contributions": [
        {
          "key": "G",
          "label": "明財位幾何",
          "weight": 0.3,
          "value": 1,
          "points": 30
        },
        {
          "key": "XK",
          "label": "玄空(向盤為主,山盤為輔)",
          "weight": 0.25,
          "value": 0.7249999999999999,
          "points": 18.124999999999996
        },
        {
          "key": "H",
          "label": "八宅(大門宅卦)",
          "weight": 0.15,
          "value": -0.3,
          "points": -4.5
        },
        {
          "key": "P",
          "label": "本命(住戶命卦)",
          "weight": 0.15,
          "value": 0.55,
          "points": 8.25
        },
        {
          "key": "Y",
          "label": "流年",
          "weight": 0.15,
          "value": 1,
          "points": 15
        }
      ],
      "deductions": [],
      "rank": 1
    }
  ],
  "ranking": [
    "living:TR",
    "living:BR",
    "living:TL"
  ],
  "bestId": "living:TR",
  "doorChong": []
}
```

- `candidates[].components` 的 `XK`(玄空)、`H`(八宅)、`P`(本命)、`Y`(流年)與 `G`(明財位幾何)是排序的元件,`contributions`、`deductions` 列出每項貢獻與扣分理由;這些數字是設計值,只有順序有傳統依據。
- 沒有平面圖時 `candidates` 是空陣列,只有 `layers` 與 `sectors`(暗財位)。

### Finding 範例

```json
[
  {
    "id": "xk.pattern.shuangxinghuixiang",
    "level": "note",
    "title": "盤面格局: 雙星會向",
    "body": "傳統上認為旺星集中在前方(向首),偏旺財。向首見水或明亮開闊的氣口較有利;人丁較弱,久居的房間可在後方補實。(格局是山星、向星的旺星落在前方或後方的四種組合之一。)",
    "confidence": "high",
    "tag": "source",
    "schoolNote": "此為玄空(中州派)說法,各派定義不同",
    "refs": [
      "xuankong_patterns.md#1.4",
      "xuankong_patterns.md#1.9",
      "DOMAIN_SPEC.md#2.4.5"
    ],
    "subject": null
  },
  {
    "id": "wealth.ming.living.TR",
    "level": "info",
    "title": "明財位: 客廳的右上角",
    "body": "傳統上認為進門後斜對角遠端的牆角是明財位。以進門的門為準,客廳的右上角是明財位。這個角落落在震宮(東方)。",
    "confidence": "high",
    "tag": "source",
    "schoolNote": null,
    "refs": [
      "DOMAIN_SPEC.md#2.6"
    ],
    "subject": null
  },
  {
    "id": "wealth.rank.design",
    "level": "note",
    "title": "候選位置的排序方式",
    "body": "這是本 App 的排序方式,僅供整理空間的參考。分數只用來排序,不可跨設定比較。明財位不論排名都會列出。",
    "confidence": "low",
    "tag": "design",
    "schoolNote": "只有星的順序有來源(九運 9>1>8>6、流年 八白>九紫與一白六白、八宅 生氣>延年>天醫>伏位),數字大小是設計值。",
    "refs": [
      "DOMAIN_SPEC.md#2.6.7"
    ],
    "subject": null
  }
]
```

### 這個範例產生的 Finding(共 54 則)

```
xk.pattern.shuangxinghuixiang (note/source)
xk.form.shuangxinghuixiang (info/source)
xk.form.indoor (info/inference)
xk.localyin.fuyin.gen.xiang.yun (note/source)
xk.localyin.fanyin.qian.shan.sum10 (note/source)
xk.pair.kan.xiang_yun.1-5 (note/source)
xk.pair.kun.shan_yun.6-9 (note/source)
xk.pair.kun.xiang_yun.6-9 (note/source)
xk.pair.zhen.xiang_yun.7-8 (info/source)
xk.pair.xun.shan_xiang.2-7 (caution/source)
xk.pair.xun.xiang_yun.7-8 (info/source)
xk.pair.zhong.shan_yun.3-9 (info/source)
xk.pair.zhong.xiang_yun.6-9 (note/source)
xk.pair.qian.shan_yun.1-4 (info/source)
xk.pair.qian.xiang_yun.1-5 (note/source)
xk.pair.dui.shan_yun.2-5 (caution/source)
xk.pair.li.shan_xiang.2-7 (caution/source)
xk.star9.8.kan.shan (note/source)
xk.star9.1.kan.xiang (info/source)
xk.star9.9.kun.shan (info/source)
xk.star9.9.kun.xiang (info/source)
xk.star9.1.zhen.shan (info/source)
xk.star9.8.zhen.xiang (note/source)
xk.star9.2.xun.shan (note/source)
xk.star9.7.xun.xiang (note/source)
xk.star9.3.zhong.shan (note/source)
xk.star9.6.zhong.xiang (note/source)
xk.star9.4.qian.shan (note/source)
xk.star9.5.qian.xiang (caution/source)
xk.star9.5.dui.shan (caution/source)
xk.star9.4.dui.xiang (note/source)
xk.star9.6.gen.shan (note/source)
xk.star9.3.gen.xiang (note/source)
xk.star9.7.li.shan (note/source)
xk.star9.2.li.xiang (note/source)
xk.position.wealth.front (info/source)
xk.position.wealth.side.kan (note/source)
xk.position.wealth.side.li (note/source)
xk.position.ding.front (note/inference)
xk.room.bedroom (info/inference)
xk.room.living (info/inference)
xk.room.kitchen (info/inference)
xk.room.bathroom (info/inference)
xk.room.study (info/inference)
xk.room.desk (info/inference)
wealth.layers.overview (info/source)
wealth.ming.living.TR (info/source)
wealth.bazhai.gate (info/source)
wealth.xuankong.cells (info/source)
wealth.annual.stars (info/source)
wealth.annual.eight_white_boost (info/source)
wealth.ming_gua.p1 (info/source)
wealth.soft.tips (info/source)
wealth.rank.design (note/design)
```

## 3. 缺輸入時的降級

不丟錯,原因寫成 Finding(id 以 `house.` 開頭,`tag` 都是 `design`,除非註明)。只有型別根本錯誤才丟錯(第 7 節)。

| 情形 | 降級行為 | Finding id(level) |
|---|---|---|
| 沒有住戶 | 不做命卦與本命財位,財位分數上限降低 | `house.residents.none`(note) |
| 某位住戶的性別或出生日期缺、格式不對、日期不存在 | 略過該位(列在 `bazhai.skipped`),其他人照算 | `house.resident.incomplete.<住戶id>`(note,`subject` 為該住戶) |
| `mainResidentId` 不在住戶名單 | 當作沒指定 | `house.residents.main_unknown`(note) |
| 沒有 `building`,或沒有建成年份 | 略過玄空盤與玄空財位(`xuankong` 為 null) | `house.building.year_missing`(note)、`wealth.xuankong.missing`(note) |
| 建成年份剛好是換運的那一年 | 以該年年中(交運後)起盤 | `house.building.yun_boundary_year`(note) |
| 整修換運但沒有完工年份 | 仍以建成年份的運起盤 | `house.building.renovation_date_missing`(note) |
| `yunBasis='moveIn'` 但沒有遷入年份 | 改用建成年份 | `house.building.move_in_missing`(note) |
| 沒有平面圖 | 只給暗財位(`wealth.candidates` 為空) | `wealth.plan.missing`(note) |
| 平面圖不合法(自交、頂點不足、找不到房間…) | 當作沒有平面圖,原因用白話寫出 | `house.plan.invalid`(caution) |
| 平面圖有房間超出外框、開口重疊、大門標示不是大門類型 | 照算,另給提醒 | `house.plan.warning.roomOutsideOutline` / `.openingsOverlap` / `.mainDoorNotEntrance`(note) |
| 平面圖 `planUpBearing` 為 null | 只做形狀分析,不算宮位與分數 | `wealth.plan.up_unknown`(note) |
| `northMode='true'` 但沒有磁偏角 | 改用磁北計算 | `house.north.declination_missing`(caution) |
| 磁北與真北讀出的山或宅卦不同 | 並列;宅卦不同時 level 為 caution | `house.north.differs`(note / caution) |
| `yearBoundary='lunar_new_year'` 但沒給 `opts.lunarNewYearOf` | 改用立春 | `house.setting.lunar_unavailable`(note) |
| 方位離山界比不確定度近 | 建議重量 | `house.geo.retest`(note) |
| 方位壓線或超出兼向限度(空亡) | 建議重量,標籤依 `kongwangLabelScheme` | `house.geo.kongwang`(note,`tag:'source'`) |
| 大門與宅向夾角超過 45 度 | 提醒使用者確認「向」怎麼取 | `house.facing.conflict`(note) |

各模組自己的警告(立春臨界、接近八卦分界、太極點在外框外、缺門資料等)照原 id 進 `findings`,不重寫。

## 4. 結果頁 `renderReport(report, opts?)`

```ts
renderReport(report, { sections?: string[], glossary?: boolean }): {
  sections: Array<{ id, title, collapsed, cards: Card[] }>,
  disclaimers: string[],
  plainSummary: string
}
Card = { id, headline, body, schoolNote: string|null, badges: string[], tag, confidence,
         level: 'info'|'note'|'caution', footnote: string|null, subject: string|null, source: 'summary'|'finding' }
```

- 固定六個分段(規格 5.3),永遠全部出現,順序不變;卡片可能是空的,UI 自行隱藏空分段。`collapsed:true` 表示預設摺疊。
- `card.id` 只是 UI 的 key(Finding id 或 `card.*`),**不會出現在任何顯示文字裡**。
- `badges` 依序是:額外標籤(如「較適合」「命宅不配」)、出處類型(傳統說法 / 推論 / 本 App 的設計 / 少數派)、「需要留意」(caution 才有)、確定度、「各派看法不一」(有 `schoolNote` 才有)。
- `footnote` 是每張卡片的短版免責「傳統民俗參考,請勿過度迷信。」(方位與命卦分段的卡片為 null)。
- `schoolNote` 是「根據哪一派」的說明,UI 建議放在卡片的展開區。
- `opts.sections` 只輸出指定分段;`opts.glossary=false` 關閉術語括號解釋。

### 範例輸出(總覽、分段與免責聲明)

<!-- example:render -->
```json
{
  "plainSummary": "你家的坐向(房子的背是坐、面是向,站在屋內面朝外的方向叫「向」)是丑山未向,房屋的宅卦(依房子的背與面算出的房屋組別,分東四宅、西四宅)是艮宅(西四宅)。\n住戶的命卦(依出生年與性別算出的個人方位組別,分東四命、西四命): 本人是坎命(東四命),與房子的組別不同,建議以自己的吉方為主安排床頭、書桌與灶口。\n財位(傳統上認為適合放置催財或保持整潔的位置)的部分,目前排在最前面的是明財位(進門後斜對角的牆角,依空間形狀判斷): 客廳的右上角,標籤是「較適合」(只是本 App 的整理排序,不保證任何結果)。\n今年(丙午年)要留意: 五黃(兩顆傳統上需要留意的星,宜靜不宜動)在南方、二黑在西北方,三煞(每年有一個方位較忌動土,依年份不同)在北方。\n另有 5 項需要留意的提醒,詳見各段說明。\n傳統民俗參考,請勿過度迷信。",
  "sections": [
    {
      "id": "orientation",
      "title": "你家的方位",
      "collapsed": false,
      "cards": 3
    },
    {
      "id": "ming",
      "title": "你的命卦組別與相配情形",
      "collapsed": false,
      "cards": 1
    },
    {
      "id": "wealth",
      "title": "財位",
      "collapsed": false,
      "cards": 8
    },
    {
      "id": "xuankong",
      "title": "玄空盤(進階)",
      "collapsed": true,
      "cards": 46
    },
    {
      "id": "annual",
      "title": "今年留意的方位",
      "collapsed": false,
      "cards": 5
    },
    {
      "id": "traditional",
      "title": "傳統說法與少數派",
      "collapsed": true,
      "cards": 2
    }
  ],
  "disclaimers": [
    "風水是華人的傳統民俗文化,這些財位建議是整理與佈置空間的參考,不保證任何財運結果,也不構成投資或理財建議。",
    "以上為傳統上的說法,實際運用還需配合房屋座向、外環境與室內擺設綜合判斷;實際勘宅需專業風水師親至現場,包含外部環境、形勢與納氣。",
    "手機羅盤適合判定 24 山等級,不適合更細的分金;附近有金屬或鋼筋時誤差可能更大。",
    "不同流派對財位的看法並不一致,本 App 預設採台灣常見的「進門對角」說法,並提供「玄空」等進階檢視。"
  ]
}
```

各分段的卡片張數:orientation=3、ming=1、wealth=8、xuankong=46、annual=5、traditional=2。

### 各分段與卡片的來源欄位

| 分段 id | 標題 | 卡片(`card.id`) | 來源欄位 |
|---|---|---|---|
| `orientation` | 你家的方位 | `card.orientation.position` | `geo.label`、`geo.sitMountain`、`geo.facingMountain`、`geo.bearing`、`geo.zhaiSitDir`、`geo.zone`、`geo.lean`、`geo.dev`、`geo.kongwangKind`、`geo.retest` |
| | | `card.orientation.zhai` | `bazhai.house`(`name`、`group`、`sitMountain`、`sitDir`、`boundary.nearGuaBoundary`)、`meta.ruleset.bazhaiFacingBasis` |
| | | `card.orientation.north` | `geo.north`(`mode`、`declination`、`compare`) |
| | | 各 Finding | `house.geo.*`、`house.north.*`、`house.facing.*`、`house.setting.*`、`geo.near_gua_boundary`、`bz.house.*` |
| `ming` | 你的命卦組別與相配情形 | `card.ming.<住戶id>` | `bazhai.residents[i]`(`name`、`ming`、`wealthOrder`、`matchesHouse`)、`bazhai.house` |
| | | `card.ming.household`(2 人以上) | `bazhai.residents`、`bazhai.match` |
| | | 各 Finding | `house.resident.*`、`house.residents.*`、`bz.ming.*`(標題前加住戶名)、`bz.household.*` |
| `wealth` | 財位 | `card.wealth.<候選id 或 dark:宮>` | `summary.wealthTop[i]`、`wealth.candidates`(`status`、`deductions`)、`wealth.sectors[宮].stars`、`bazhai.residents[].name` |
| | | 各 Finding | `wealth.*`(除 `wealth.soft.*`、`wealth.annual.eight_white_boost`)、`house.plan.*` |
| `xuankong` | 玄空盤(進階,預設摺疊) | `card.xuankong.overview` | `xuankong.meta`(`chartYun`、`currentYun`)、`xuankong.pattern`、`geo` |
| | | 各 Finding | `house.building.*`、`xk.*` |
| `annual` | 今年留意的方位 | `card.annual.taisui` | `annual.year`、`annual.taisui` |
| | | `card.annual.sansha` | `annual.sansha` |
| | | `card.annual.wuhuang` | `annual.annual`(`wuhuang`、`erhei`) |
| | | `card.annual.month`(有月份時) | `annual.month` |
| | | `card.annual.house`(有對照命中時) | `geo`(`sitBearing`、`bearing`、`gua`、`zhaiGua`)、`annual.sansha.arc`、`annual.taisui`、`annual.annual` |
| | | 各 Finding | `annual.year.*` |
| `traditional` | 傳統說法與少數派(預設摺疊) | 各 Finding | 所有 `tag:'minority'` 的 Finding、`bz.minority.*`、`annual.sansha.*`、`wealth.soft.*`、`wealth.annual.eight_white_boost` |

Finding 在分段內依家族排序(下表 `order`),同家族維持原順序。未知的 id 不會丟錯,退到 `traditional`。

<details>
<summary>Finding id 家族對照表</summary>

| id 樣式(正規表示式,去掉 `^`) | 分段 | 語氣 |
|---|---|---|
| `wealth.soft.` | traditional | auto |
| `wealth.annual.eight_white_boost$` | traditional | auto |
| `bz.minority.` | traditional | auto |
| `annual.sansha.` | traditional | auto |
| `house.geo.` | orientation | plain |
| `house.north.` | orientation | plain |
| `house.facing.` | orientation | plain |
| `house.setting.` | orientation | plain |
| `geo.near_gua_boundary$` | orientation | plain |
| `bz.house.` | orientation | plain |
| `house.residents?.` | ming | plain |
| `bz.ming.` | ming | plain |
| `bz.household.` | ming | auto |
| `wealth.layers.` | wealth | auto |
| `wealth.ming_gua.` | wealth | auto |
| `wealth.bazhai.` | wealth | auto |
| `wealth.xuankong.` | wealth | auto |
| `wealth.annual.` | wealth | auto |
| `wealth.ming.` | wealth | auto |
| `wealth.door.` | wealth | auto |
| `wealth.borderline.` | wealth | plain |
| `wealth.water.` | wealth | auto |
| `wealth.seat.` | wealth | auto |
| `wealth.plan.` | wealth | plain |
| `house.plan.` | wealth | plain |
| `wealth.rank.` | wealth | auto |
| `house.building.` | xuankong | plain |
| `xk.pattern.` | xuankong | auto |
| `xk.form.` | xuankong | auto |
| `xk.locate.` | xuankong | auto |
| `xk.wholeplate.` | xuankong | auto |
| `xk.yun.` | xuankong | auto |
| `xk.special.` | xuankong | auto |
| `xk.position.` | xuankong | auto |
| `xk.localyin.` | xuankong | auto |
| `xk.pair.` | xuankong | auto |
| `xk.star9.` | xuankong | auto |
| `xk.star.` | xuankong | auto |
| `xk.room.` | xuankong | auto |
| `annual.year.` | annual | plain |

語氣 `auto` 依 tag 補語氣(見下節),`plain` 是本 App 自己的說明,不補。`tag:'minority'` 一律進 `traditional`。
</details>

### 卡片範例

`orientation`(前 3 張):

```json
[
  {
    "id": "card.orientation.position",
    "headline": "你家坐向: 丑山未向",
    "body": "這是你家的坐向(房子的背是坐、面是向,站在屋內面朝外的方向叫「向」):坐丑山、向未山。向約在 210 度,屬 24 山(把 360 度切成 24 等分的方位名,每份 15 度,如「子山」是正北)中的未山,坐的位置在東北方。方位落在山的中間一帶,屬下卦(不偏向鄰近的山)。",
    "schoolNote": null,
    "badges": [
      "傳統說法",
      "確定度較高"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": null,
    "subject": null,
    "source": "summary"
  },
  {
    "id": "card.orientation.zhai",
    "headline": "房屋的宅卦: 艮宅(西四宅)",
    "body": "依房子的坐(丑山,在東北方)定出宅卦(依房子的背與面算出的房屋組別,分東四宅、西四宅),這間房子屬「艮宅」,分組是西四宅。",
    "schoolNote": "八宅這裡依「大門朝向」定坐向,可以在設定改變;以不同的向定宅,結果可能不同。",
    "badges": [
      "傳統說法",
      "確定度較高",
      "各派看法不一"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": null,
    "subject": null,
    "source": "summary"
  },
  {
    "id": "card.orientation.north",
    "headline": "本次採用磁北",
    "body": "本 App 預設用磁北(羅盤指的是磁北,地圖上的北是真北,台灣兩者差約 5 度),和實體羅盤一致。目前這個地點的磁北比真北偏西約 5 度。用磁北讀是丑山未向,用真北讀是丑山未向,兩種讀法的結果相同。",
    "schoolNote": null,
    "badges": [
      "傳統說法",
      "確定度較高"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": null,
    "subject": null,
    "source": "summary"
  }
]
```

`ming`(第 1 張):

```json
[
  {
    "id": "card.ming.p1",
    "headline": "本人: 坎命(東四命)",
    "body": "你的命卦(依出生年與性別算出的個人方位組別,分東四命、西四命)是坎命,屬東四命。依傳統的八宅法,你個人的吉方是: 生氣位(八宅法對八個方位的分類,生氣、延年、天醫、伏位傳統上視為吉位)在東南方、延年位在南方、天醫位在東方。你的命卦屬於東四命,這間房子屬於西四宅,稱為命宅不配。傳統上的做法是以你自己的吉方為主來安排床頭、書桌與灶口,大門若不能動,至少讓大門、主臥、灶口三項中有一項落在你的吉方。",
    "schoolNote": null,
    "badges": [
      "命宅不配",
      "傳統說法",
      "確定度較高"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": null,
    "subject": "p1",
    "source": "summary"
  }
]
```

`wealth`(前 2 張):

```json
[
  {
    "id": "card.wealth.living:TR",
    "headline": "客廳的右上角(明財位)",
    "body": "在目前整理的候選位置中,這裡排在比較前面,較適合放置擺設或保持整潔。這是傳統上最通行的算法(依進門的位置與空間形狀),不論排名都會列出。它落在震宮(東方)。玄空盤上這一宮的山星(玄空盤每個方位上的三個數字: 山星傳統上看人丁與健康,向星看財運,運星是這一運的基準數字)是一白、向星是八白;依房屋的宅卦,按遊年八星來看,這一方是「六煞」(傳統上屬需要留意的位置);依本人的命卦,這一方是「天醫」(傳統上視為吉位);今年飛到這一宮的星是八白。這是本 App 的排序方式,僅供整理空間的參考。",
    "schoolNote": "排序只有星的先後順序有傳統依據,數字大小是本 App 的設計;標籤不可跨設定比較。",
    "badges": [
      "較適合",
      "本 App 的設計",
      "確定度較低",
      "各派看法不一"
    ],
    "tag": "design",
    "confidence": "low",
    "level": "info",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "summary"
  },
  {
    "id": "wealth.layers.overview",
    "headline": "財位有四種層次",
    "body": "傳統上財位(傳統上認為適合放置催財或保持整潔的位置)有四種看法: 明財位(依空間形狀,房屋使用期間固定)、暗財位(依房屋方位與星盤推算,八宅固定、玄空一個運約 20 年)、流年財位(每年立春換)、本命財位(依住戶命卦,終身)。下面分開列出,時間性不同,不要混為一談。",
    "schoolNote": "專業玄空派(吳尚易)主張「財位絕對不是進門斜對角」,與坊間通俗說法對立。本 App 預設兩者都算,以台灣最通行的「明財位」為主檔,可在設定切換到玄空檔。",
    "badges": [
      "傳統說法",
      "確定度較高",
      "各派看法不一"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "finding"
  }
]
```

`xuankong`(前 2 張):

```json
[
  {
    "id": "card.xuankong.overview",
    "headline": "玄空盤: 雙星會向(第 9 運起盤)",
    "body": "這張盤用第 9 運起盤(依建成或遷入的時間),坐丑山、向未山,格局是「雙星會向(玄空盤把旺星放在房子前方或後方的四種常見組合)」。目前是第 9 運。這種排盤法叫玄空飛星(一種把九個數字依規則排進九個方位的傳統推算法),每個方位有山星、向星與運星三個數字,各方位的解讀列在下面。這是進階內容,實際勘宅需專業風水師親至現場。",
    "schoolNote": "玄空有多個流派,這裡採中州派的下卦排法;兼向與替卦的做法各派不同。",
    "badges": [
      "傳統說法",
      "確定度較高",
      "各派看法不一"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "summary"
  },
  {
    "id": "xk.pattern.shuangxinghuixiang",
    "headline": "盤面格局: 雙星會向",
    "body": "傳統上認為旺星集中在前方(向首),偏旺財。向首見水或明亮開闊的氣口較有利;人丁較弱,久居的房間可在後方補實。(格局是山星、向星的旺星落在前方或後方的四種組合之一。)",
    "schoolNote": "此為玄空(中州派)說法,各派定義不同",
    "badges": [
      "傳統說法",
      "確定度較高",
      "各派看法不一"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "note",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "finding"
  }
]
```

`annual`(前 2 張):

```json
[
  {
    "id": "card.annual.taisui",
    "headline": "太歲在南方,歲破在北方",
    "body": "今年是丙午年(以立春為界,2月4日換年)。太歲(當年地支所在方位與其正對面,傳統上動土裝修要留意)在南方(午山),歲破在正對面的北方(子山)。傳統上這兩個方位今年動土或大幅裝修要多留意。",
    "schoolNote": null,
    "badges": [
      "傳統說法",
      "確定度較高"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "summary"
  },
  {
    "id": "card.annual.sansha",
    "headline": "三煞在北方",
    "body": "今年的三煞(每年有一個方位較忌動土,依年份不同)在北方(亥子丑三山)。傳統上這個方位今年比較忌動土,平時不必刻意避開,只是整修時多留意。",
    "schoolNote": null,
    "badges": [
      "傳統說法",
      "確定度較高"
    ],
    "tag": "source",
    "confidence": "high",
    "level": "info",
    "footnote": "傳統民俗參考,請勿過度迷信。",
    "subject": null,
    "source": "summary"
  }
]
```

## 5. 文案規則(規格 5)

| 規則 | 做法 |
|---|---|
| 術語第一次出現要括號解釋 | 內文與總覽各自獨立計算「第一次」;術語後面本來就接括號(模組文字自帶解釋)則不重複;連著後綴成詞(流年財位、五黃星)時括號放在整個詞後面;卡片標題不插括號,所以標題裡的術語會在內文第一次出現時解釋。術語表見下 |
| 語氣依 tag | `source`:「傳統上…」;`inference`:加「推論」徽章並寫「沒有直接的古籍依據」;`minority`:「少數流派主張…,本 App 預設不採用」;`design`:「這是本 App 的整理方式,僅供整理空間的參考」 |
| 不用恐嚇字眼 | 大凶、絕嗣、克妻、敗財等改成溫和說法;不用「保證」(只在「不保證」出現);伏吟類寫成「較難調整,建議請專業老師到現場評估」 |
| 不顯示精確分數 | 財位分數轉三段標籤:比值 = 分數 / 該次分析的分數上限(`wealth.meta.scoreCap`),≥ 0.60「較適合」、≥ 0.35「可以考慮」、其餘與被排除的位置「不建議」。不同設定的分數上限不同(mingcai 100、xuankong 90、沒住戶再降),所以標籤不可跨設定比較 |
| 不洩漏內部資訊 | 清掉來源編號(如 `SOHU-…`)、規格條號、開口與住戶的內部 id、欄位路徑、乘數與分數上限;方位角只顯示整數度 |
| 老實說不確定 | 接近山界、壓線、空亡、磁北真北不同、立春臨界、命卦年界、缺資料,都有對應的卡片或提醒 |
| 免責聲明 | `disclaimers` 依序是:文化性質(規格 5.5 主要語句,一字不差)、專業勘宅、測量誤差(手機羅盤)、流派說明;每張卡片另有短版 `footnote` |

術語表(GLOSSARY,同一列共用一句解釋):

| 觸發詞 | 解釋 |
|---|---|
| 坐向 | 房子的背是坐、面是向,站在屋內面朝外的方向叫「向」 |
| 24 山 | 把 360 度切成 24 等分的方位名,每份 15 度,如「子山」是正北 |
| 命卦 | 依出生年與性別算出的個人方位組別,分東四命、西四命 |
| 宅卦 | 依房子的背與面算出的房屋組別,分東四宅、西四宅 |
| 命宅相配 | 個人的方位組別與房子的組別相同 |
| 明財位 | 進門後斜對角的牆角,依空間形狀判斷 |
| 暗財位 | 依房子方位與星盤推算出的位置 |
| 財位 | 傳統上認為適合放置催財或保持整潔的位置 |
| 流年 | 每一年的方位運勢,以立春為一年開始 |
| 玄空飛星、飛星 | 一種把九個數字依規則排進九個方位的傳統推算法 |
| 元運、九運 | 每 20 年一個週期,2024 年 2 月起是第九運 |
| 山星、向星、運星 | 玄空盤每個方位上的三個數字: 山星傳統上看人丁與健康,向星看財運,運星是這一運的基準數字 |
| 旺山旺向、上山下水、雙星會向、雙星會坐 | 玄空盤把旺星放在房子前方或後方的四種常見組合 |
| 下卦、兼向、替卦 | 方位正中稱下卦,偏向鄰近方位稱兼向;兼向偏太多時傳統上換一套排法,稱替卦 |
| 空亡 | 方位剛好壓在兩個方位的交界線上,傳統上建議避開或重測 |
| 磁北、真北 | 羅盤指的是磁北,地圖上的北是真北,台灣兩者差約 5 度 |
| 太歲、歲破 | 當年地支所在方位與其正對面,傳統上動土裝修要留意 |
| 三煞方、三煞 | 每年有一個方位較忌動土,依年份不同 |
| 五黃、二黑 | 兩顆傳統上需要留意的星,宜靜不宜動 |
| 伏吟、反吟 | 盤面數字與原位相同或相反的特殊格局 |
| 遊年八星、生氣位、延年位、天醫位、禍害位、六煞位、五鬼位、絕命位 | 八宅法對八個方位的分類,生氣、延年、天醫、伏位傳統上視為吉位 |

## 6. 設定開關(`Settings`)

預設值定義在 `src/core/settings.js` 的 `DEFAULT_SETTINGS`(共 45 個);`meta.ruleset` 會回存實際使用的完整設定。
「作用」欄:**分析** = 影響 `analyzeHouse` 的結果;**羅盤盤面 / 感測 / UI** = 由其他模組或 UI 讀取,`analyzeHouse` 不使用。
設定頁的文化說明(規格 5.5):「不同流派對財位的看法並不一致,本 App 預設採台灣常見的『進門對角』說法,並提供『玄空』等進階檢視。」

| 名稱 | 預設 | 選項 | 白話說明 | 作用 |
|---|---|---|---|---|
| `northMode` | `"magnetic"` | 'magnetic' \| 'true' | 用磁北(和實體羅盤一致)或真北(地圖的北)看方位。選真北時,要在 facing.declination 提供磁偏角。 | 分析 |
| `xiaGuaHalfWidth` | `4.5` | 4.5 / 3.5 / 3.0(0 到 7.5 之間的數字) | 方位落在山中間幾度內算「下卦」(不偏向鄰山);預設 ±4.5 度,較嚴的派別用 3.5 或 3.0。 | 分析 |
| `jianLimitSchool` | `"default"` | 'default' \| 'strict5' \| 'zggdfs6' | 兼向最多可以偏幾度,超過就提醒「空亡」;default 是折衷,strict5 較嚴(5 度),zggdfs6 較寬(6 度)。 | 分析 |
| `kongwangLabelScheme` | `"position"` | 'position' \| 'degree' | 大小空亡的說法:position 是「卦界=大空亡、山界=小空亡」,degree 是「出卦=大、陰陽差錯=小、同性超限=空向」。 | 分析 |
| `measureUncertainty` | `5` | 5.0(不小於 0 的數字,單位度) | 手機量測的誤差估計;方位離山界比這個數字近,就會提醒重量。facing.uncertainty 有給時以它為準。 | 分析 |
| `facingPolicy` | `"auto"` | 'auto' \| 'door' \| 'light' \| 'building' | 「向」怎麼取。analyzeHouse 只有 door(且有 doorBearing)會改用大門朝向;其餘值給 UI 決定 facing.bearing 時參考。 | 分析(只認 door)/UI |
| `bazhaiFacingBasis` | `"door"` | 'door' \| 'house' | 八宅用大門朝向(door)還是宅向(house)定坐向;玄空一律用宅向。 | 分析 |
| `yearBoundary` | `"lichun_exact"` | 'lichun_exact' \| 'lichun_date_only' \| 'fixed_feb4' \| 'lunar_new_year' \| 'gregorian_jan1' | 命卦的換年時刻:立春精確到分(預設)、立春只比日期、固定 2/4、農曆春節(要 opts.lunarNewYearOf)、元旦。 | 分析 |
| `yunBasis` | `"built"` | 'built' \| 'moveIn' | 玄空盤用「建成年」還是「遷入年」的運起盤。 | 分析 |
| `renovation` | `"none"` | 'none' \| 'partial' \| 'full' \| 'anyRenovation' | 整修是否換運:full(整戶翻新)或 anyRenovation(任何裝潢)才改用整修完工年的運。building.renovation 有給時以它為準。 | 分析 |
| `yunSystem` | `"san_yuan_9"` | 'san_yuan_9' \| 'er_yuan_8' | 三元九運(預設,2024 起是九運)或二元八運。 | 分析 |
| `useTiGua` | `false` | false / true | 兼向偏太多時是否改用替卦排盤;預設只排下卦盤並提示。 | 分析 |
| `tiTable` | `"A"` | 'A' \| 'B' | 替卦用的替星表。 | 分析 |
| `qiScheme` | `"default"` | 'default' \| 'S1' \| 'S2' | 九星旺衰(五氣)的分級標法,預設是台灣常見標法。 | 分析 |
| `eightKeepsWealth` | `false` | false / true | 八白退氣後是否仍當財星;預設不催不禁(來源分歧)。 | 分析 |
| `fuyinPenalty` | `-3` | -3(數字) | 全局伏吟的扣分值(工程設定,只影響玄空排序,不顯示)。 | 分析 |
| `fanyinPenalty` | `-1` | -1(數字) | 全局反吟的扣分值。 | 分析 |
| `showLianshu` | `false` | false / true | 是否顯示「連數三般卦」標記(各派吉凶說法矛盾,只標記不計分)。 | 分析 |
| `showChengmen` | `false` | false / true | 是否顯示城門位(只顯示,不進主要評分)。 | 分析 |
| `wSide` | `0.3` | 0.3(數字) | 玄空財丁位的副權重。 | 分析 |
| `wYun` | `0.3` | 0.3(數字) | 玄空財丁位的運星權重。 | 分析 |
| `tianyiFirst` | `false` | false / true | 把天醫排在延年前面(港派說法)。 | 分析 |
| `stovePreferAuspicious` | `false` | false / true | 灶座放吉方(少數派);預設是傳統的「坐凶向吉」。 | 分析(bazhai 用途表) |
| `coupleBasis` | `"breadwinner"` | 'breadwinner' \| 'wife' \| 'husband' \| 'holderOnly' \| 'averaged' | 夫妻命卦不同組時聽誰的:主要收入者、妻子、丈夫、只看戶主、或平均。 | 分析 |
| `showMinorityTechniques` | `false` | false / true | 是否顯示少數派說法(五鬼運財、桃花位、三煞宜向不宜坐);顯示時一律標「少數派」。 | 分析 |
| `sanshaArc` | `"core3"` | 'core3' \| 'withJia' \| 'branch12' | 三煞弧的畫法:三山各 15 度(預設)、含夾煞 75 度、十二支 90 度。 | 分析/UI 盤面 |
| `extraShensha` | `false` | false / true | 是否顯示夾煞(少數單一來源說法)。 | 分析 |
| `wealthProfile` | `"mingcai"` | 'mingcai' \| 'xuankong' | 財位排序檔:mingcai(通俗,預設)或 xuankong(進階)。 | 分析 |
| `qiIntake` | `"penalty"` | 'penalty' \| 'reward' | 財位角落有窗時扣分(penalty)或加分(reward,玄空派)。只有明寫才蓋過檔位的預設。 | 分析 |
| `allowWaterHint` | `false` | false / true | 是否顯示九運水火(放水)提示;預設不主動建議放水。 | 分析 |
| `preferDragonSide` | `false` | false / true | 門開在牆正中央時只取龍邊(進門者右手邊)一角,少數說法。 | 分析 |
| `showRay45` | `false` | false / true | 是否額外顯示 45 度射線命中點(寬扁房間可能落在遠牆中段)。 | 分析 |
| `virtualPartition` | `false` | false / true | 開放式空間是否虛擬分區;目前尚未支援,勾選只會產生提醒。 | 分析(提醒) |
| `multiOccupantPolicy` | `"mean"` | 'mean' \| 'breadwinner' \| 'each' | 多位住戶的本命財位:取平均、主要收入者加倍、或逐人分別算。 | 分析 |
| `taijiMode` | `"centroid"` | 'centroid' \| 'bbox' \| 'manual' | 太極點(房屋中心)取面積重心、外接框中心或手動點選;plan.taiji.mode 有給時以平面圖為準。 | 分析 |
| `yinyangScheme` | `"sanyuan"` | 'sanyuan' \| 'sanhe' | 羅盤上 24 山的陰陽標法:三元龍(預設)或三合紅黑字。 | 羅盤盤面 |
| `southUp` | `false` | false / true | 羅盤盤面改成南在上。 | 羅盤盤面 |
| `showSanZhen` | `false` | false / true | 羅盤顯示人盤與天盤縫針(玄空與八宅只用地盤正針)。 | 羅盤盤面 |
| `livingRoomGradeByEastWest` | `false` | false / true | 客廳沙發與魚缸位置是否依東四命、西四命分級;預設四個吉位不分先後。 | 分析(bazhai 用途表) |
| `showGuimenxian` | `false` | false / true | 是否顯示鬼門線(單一來源說法)。 | 分析 |
| `facadeFloorRule` | `false` | false / true | 樓層 9 樓以下改用大樓正面當向(取向輔助函式 geo.pickFacing 用,analyzeHouse 不使用)。 | UI 取向 |
| `bazhaiMatch` | `false` | false / true | 保留給店面辦公桌是否強制命宅相配;目前沒有模組使用。 | 保留 |
| `yearVal` | `"default"` | 'default' \| {星數: 星值} | 流年財星的價值表,預設八白 1.0、九紫 0.8、一白與六白 0.6、四綠 0.2;可只改其中幾顆。 | 分析 |
| `bazhaiStarWeights` | `"default"` | 'default' \| {星名: 權重} | 八宅八星的權重,只影響排序,可只改其中幾顆。 | 分析 |
| `lockSeconds` | `3` | 3(可選 3 / 5 / 10) | 手機羅盤「鎖定」取平均的秒數。 | 感測 |

其他覆寫規則:

- `facing.uncertainty` 有給時蓋過 `measureUncertainty`;`building.renovation` 有給時蓋過設定的 `renovation`(除非 `settingsOverrides` 明寫);`plan.taiji.mode` 有給時蓋過 `taijiMode`。
- `wealthProfile='xuankong'` 時開口(窗)處理預設是加分;只有 `settingsOverrides` 明寫 `qiIntake` 才蓋過檔位的預設。因此 `analyzeHouse` 只把使用者明寫的設定往下傳,不會把完整預設值當成使用者明寫。
- 降級會改動實際使用的設定並回存到 `meta.ruleset`:真北缺磁偏角 → `northMode='magnetic'`;農曆春節缺農曆函式 → `yearBoundary='lichun_exact'`;整修換運缺完工年份 → `renovation='none'`;遷入年份缺 → `yunBasis='built'`。

## 7. 錯誤碼

`Error.message` 開頭是「大寫底線碼: 」。只有型別根本錯誤才丟錯,資料不完整都走第 3 節的降級。

| 碼 | 情形 |
|---|---|
| `INVALID_INPUT` | `input` 不是物件、`nowMs` 不是有限數字、`facing` 不是物件、`building.type` 不認得或 `builtYear` 不是整數年份、`residents` 不是陣列或 id 重複或 `birth` 不是字串、`plan` 不是物件、`wealthOptions` 有不認得的鍵、`opts` 型別不對 |
| `INVALID_BEARING` | `facing.bearing` 或 `facing.doorBearing` 不是有限數字(NaN、Infinity、字串) |
| `INVALID_SETTING` | `settingsOverrides` 含未知鍵、不是物件,或 `northMode` 不是 `magnetic`/`true` |
| `INVALID_DECLINATION` | 磁偏角超出 [-180,180](來自 geo) |
| `INVALID_REPORT` / `INVALID_OPTION` | `renderReport` 收到的不是 `analyzeHouse` 的結果,或 `sections` 有未知分段 |
| 其他 | 底層模組的錯誤碼原樣穿出(例如 calendar 的 `YEAR_OUT_OF_RANGE`、wealth 的 `INVALID_FLAG`) |

## 8. 給 UI 的注意事項

- 每次使用者改動輸入或設定都重新呼叫 `analyzeHouse`(整份計算是毫秒級);不要自己緩存局部結果。
- 磁北與真北切換時,平面圖的 `planUpBearing` 要跟著換算(`plan.convertPlanNorth`),`facing.bearing` 則保持原始讀數。
- 建成年份只有年份時,交運年(2024、2004…)的立春前後運不同;`house.building.yun_boundary_year` 會提醒,UI 可在此時追問完工日期。
- `card.source==='finding'` 的卡片可用 `card.subject` 找到對應住戶;`level==='caution'` 建議用醒目但不驚嚇的樣式,不要用紅色大叉之類的恐嚇視覺。
- 結果頁必須顯示 `disclaimers`;不可把 `summary.wealthTop[].score` 或 `wealth.candidates[].score` 顯示成數字。

// 所有流派開關集中於此。預設值與 docs/DOMAIN_SPEC.md 1.4 / 第 3 節決策表一致。
// 每個分析函式的 meta.ruleset 要原樣回存實際採用的設定。

export const DEFAULT_SETTINGS = Object.freeze({
  northMode: 'magnetic',
  xiaGuaHalfWidth: 4.5,
  jianLimitSchool: 'default',
  kongwangLabelScheme: 'position',
  measureUncertainty: 5.0,
  facingPolicy: 'auto',
  bazhaiFacingBasis: 'door',
  yearBoundary: 'lichun_exact',
  yunBasis: 'built',
  renovation: 'none',
  yunSystem: 'san_yuan_9',
  useTiGua: false,
  tiTable: 'A',
  qiScheme: 'default',
  eightKeepsWealth: false,
  fuyinPenalty: -3,
  fanyinPenalty: -1,
  showLianshu: false,
  showChengmen: false,
  wSide: 0.3,
  wYun: 0.3,
  tianyiFirst: false,
  stovePreferAuspicious: false,
  coupleBasis: 'breadwinner',
  showMinorityTechniques: false,
  sanshaArc: 'core3',
  extraShensha: false,
  wealthProfile: 'mingcai',
  qiIntake: 'penalty',
  allowWaterHint: false,
  preferDragonSide: false,
  showRay45: false,
  virtualPartition: false,
  multiOccupantPolicy: 'mean',
  taijiMode: 'centroid',
  yinyangScheme: 'sanyuan',
  southUp: false,
  showSanZhen: false,
  livingRoomGradeByEastWest: false,
  showGuimenxian: false,
  facadeFloorRule: false,
  bazhaiMatch: false,
  yearVal: 'default',
  bazhaiStarWeights: 'default',
  lockSeconds: 3,
});

/** 合併使用者覆寫;未知鍵直接丟錯,避免拼錯開關名稱而默默失效。 */
export function resolveSettings(overrides = {}) {
  for (const k of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, k)) throw new Error(`未知的設定鍵: ${k}`);
  }
  return { ...DEFAULT_SETTINGS, ...overrides };
}

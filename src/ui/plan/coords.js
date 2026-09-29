// 平面圖座標與畫布像素的共用轉換。平面圖與財位縮圖必須共用它,才不會對「上方」的定義不一致。
//
// 約定(規格 2.6.2):平面圖座標單位公尺、x 向右、y 向上;畫布 y 向下,所以只做「翻轉」,不做旋轉。
// 圖面上方 = 平面圖 +y;圖面上方的羅盤方位角 = planUpBearing(store.input() 已換算成目前北基準)。

export function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/**
 * 建立視圖轉換。bounds 置中、等比縮放至 cssW×cssH(留 pad),再套用 zoom 與 pan(像素)。
 * 回傳 { scale, toPx([x,y]) -> [px,py], fromPx(px,py) -> [x,y] }
 */
export function makeView(bounds, cssW, cssH, { pad = 16, zoom = 1, pan = { x: 0, y: 0 } } = {}) {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const base = Math.max(1e-6, Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h));
  const s = base * zoom;
  const ox = cssW / 2 + pan.x - s * (bounds.minX + w / 2);
  const oy = cssH / 2 + pan.y + s * (bounds.minY + h / 2);
  return {
    scale: s,
    toPx: ([x, y]) => [ox + s * x, oy - s * y],
    fromPx: (px, py) => [(px - ox) / s, (oy - py) / s],
  };
}

/** 平面向量 (dx,dy) 的羅盤方位角(度,[0,360));up = 圖面上方的方位角 */
export function bearingOfVector(dx, dy, up) {
  const b = up + (Math.atan2(dx, dy) * 180) / Math.PI;
  return ((b % 360) + 360) % 360;
}

/** 羅盤方位角 b 在平面圖上的單位向量 (x 向右、y 向上) */
export function vectorOfBearing(b, up) {
  const t = ((b - up) * Math.PI) / 180;
  return [Math.sin(t), Math.cos(t)];
}

/** 後天八卦第 k 宮(順序同 geo.GUA:坎艮震巽離坤兌乾)的中心方位角 = 45k */
export const guaCenterBearing = (k) => 45 * k;

/**
 * 某一宮的扇形多邊形(平面圖座標):頂點在太極點 taiji,半徑 R,張角 ±22.5°。
 * 用來畫 8 個方位扇形;steps 為弧線分段數。
 */
export function wedgePolygon(taiji, guaIndex, up, R, steps = 8) {
  const c = guaCenterBearing(guaIndex);
  const pts = [[taiji[0], taiji[1]]];
  for (let i = 0; i <= steps; i++) {
    const b = c - 22.5 + (45 * i) / steps;
    const [vx, vy] = vectorOfBearing(b, up);
    pts.push([taiji[0] + R * vx, taiji[1] + R * vy]);
  }
  return pts;
}

// Canvas 共用小工具:高 DPI 校正、字型堆疊、沿弧放字。

/** 依 CSS 尺寸配置畫布像素並回傳已縮放好的 2D context。DPR 上限 3(規格 2.8.8)。 */
export function fitCanvas(canvas, cssW, cssH, maxDpr = 3, opts = { alpha: true }) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', opts);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function cssVar(name, fallback = '') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 楷體堆疊(規格 2.8.9);離線 Android 沒有楷體時會落到宋/黑體,版面用固定格寬不受影響 */
export const KAI_STACK =
  '"LuopanKai","Kaiti TC","BiauKaiTC","BiauKai","DFKai-SB","KaiTi","STKaiti","Noto Serif CJK TC","Noto Serif TC","Songti TC","PMingLiU","PingFang TC",serif';
export const UI_STACK =
  'system-ui,-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';

/** 方位角(度,自北順時針)轉畫布座標。字頭朝外時再 ctx.rotate(bearingRad)。 */
export function polar(cx, cy, r, bearingDeg) {
  const t = (bearingDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) };
}

/** 在環半徑 r、方位角 b 處畫單一字,字頭朝外。 */
export function drawGlyphAt(ctx, ch, cx, cy, r, bearingDeg) {
  const { x, y } = polar(cx, cy, r, bearingDeg);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((bearingDeg * Math.PI) / 180);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

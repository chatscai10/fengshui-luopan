# tools/make_icons.py : python tools/make_icons.py  (需要 Pillow;輸出到 ./icons/)
import math, os
from PIL import Image, ImageDraw

BG, GOLD, GOLD_HI, CINNABAR, IVORY = (14, 11, 9), (214, 178, 90), (232, 203, 122), (208, 52, 42), (243, 235, 216)
SS = 4  # 超取樣倍率,縮小時邊緣才平順

def render(size, art_r):
    """size: 輸出邊長;art_r: 盤面半徑佔邊長的比例(maskable 用 0.36 以內,其餘 0.42)。背景滿版不透明。"""
    n = size * SS
    im = Image.new('RGB', (n, n), BG)
    d = ImageDraw.Draw(im)
    c = n / 2
    R = n * art_r
    d.ellipse([c - R, c - R, c + R, c + R], outline=GOLD, width=max(2, int(R * 0.07)))
    r2 = R * 0.80
    d.ellipse([c - r2, c - r2, c + r2, c + r2], outline=GOLD, width=max(1, int(R * 0.025)))
    for k in range(24):  # 24 山刻度
        a = math.radians(k * 15)
        long = k % 3 == 0
        r_in = R * (0.80 if long else 0.86)
        d.line([c + r_in * math.sin(a), c - r_in * math.cos(a), c + R * 0.93 * math.sin(a), c - R * 0.93 * math.cos(a)],
               fill=GOLD_HI if long else GOLD, width=max(1, int(R * (0.030 if long else 0.018))))
    L, W = R * 0.66, R * 0.15  # 朱砂針(北)與象牙針(南)
    d.polygon([(c, c - L), (c + W, c), (c, c + L * 0.12), (c - W, c)], fill=CINNABAR)
    d.polygon([(c, c + L), (c + W, c), (c, c - L * 0.12), (c - W, c)], fill=IVORY)
    hub = R * 0.07
    d.ellipse([c - hub, c - hub, c + hub, c + hub], fill=GOLD_HI)
    return im.resize((size, size), Image.LANCZOS)

os.makedirs('icons', exist_ok=True)
render(192, 0.42).save('icons/icon-192.png', optimize=True)
render(512, 0.42).save('icons/icon-512.png', optimize=True)
render(512, 0.34).save('icons/icon-maskable-512.png', optimize=True)   # 安全區:中心 80% 圓內
render(180, 0.40).save('icons/apple-touch-icon.png', optimize=True)    # iOS 自己套圓角,不能有透明
print('ok')

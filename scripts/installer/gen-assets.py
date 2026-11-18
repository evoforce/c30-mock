#!/usr/bin/env python3
"""生成安装器界面素材（全部 PNG 为"已合成背景的不透明图"，火箭除外）。

设计基准 560x300（96 DPI），超采样后 LANCZOS 缩小。
坐标必须与 scripts/installer/installer.iss 的布局常量一致。

踩过的坑：Inno 的 TBitmapImage 用 PngImage 加载时**不做 alpha 混合**，半透明像素会按
RGB 直接画成不透明。所以除火箭（会移动，必须真透明）外，其余素材都是先画好背景、
按控件精确位置裁一块、再在上面画圆角/描边，从而与背景严丝合缝。

火箭用 32 位 BMP（BGRA）+ TAlphaBitmap.AlphaFormat := afDefined 才有正确混合。

用法: python scripts/installer/gen-assets.py
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SUP = 4
CARD_W, CARD_H = 560, 300

# ---- 与 installer.iss 对应的布局（左上角坐标 + 尺寸）----
PAD = 28
ICON_X, ICON_Y, ICON_S = 28, 26, 40
BIG_W, BIG_H = 224, 52
BIG1 = (168, 112)          # 第 1 页 一键安装
BIG2 = (168, 190)          # 第 2/4 页 开始安装 / 完成安装
GHOST = (404, 199)         # 第 2/4 页 返回 / 关闭
BROWSE = (456, 127)        # 第 2 页 浏览…
GHOST_W, GHOST_H = 76, 34
INPUT_BOX = (28, 124)      # 第 2 页 路径底板
INPUT_W, INPUT_H = 504, 40
BAR = (28, 212)
BAR_W, BAR_H = 504, 10
SLIDE = (28, 88)
SLIDE_W, SLIDE_H = 504, 100
ROCKET_S = 44

# 品牌色
BG_TOP = (255, 255, 255)
BG_BOTTOM = (241, 246, 255)
GLOW = (37, 99, 235)
ACCENT_A = (37, 99, 235)
ACCENT_B = (96, 165, 250)
TEAL = (13, 148, 136)
FG = (16, 27, 52)
MUTED = (100, 116, 139)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "installer"
LOGO = ROOT / "assets" / "logo" / "png" / "installer-256.png"
CJK = "C:\\Windows\\Fonts\\msyh.ttc"

SLIDES = [
    ("屏幕广播", "教师画面毫秒级同步到每一块学生屏，不卡顿、不断线"),
    ("白板批注", "全屏白板配笔迹、橡皮、聚光灯，讲解随手就画"),
    ("弹幕互动", "学生弹幕实时上墙，课堂气氛不用冷场"),
    ("离线可用", "局域网直连，不依赖外网，机房断网也能上课"),
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def font(size):
    return ImageFont.truetype(CJK, size)


def supersampled(fn, size):
    return fn((size[0] * SUP, size[1] * SUP)).resize(size, Image.LANCZOS)


# ------------------------------------------------------------------ 背景


def draw_bg(size):
    w, h = size
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(BG_TOP, BG_BOTTOM, 0.45 * (y / h)))

    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy, r = int(w * 0.88), int(-h * 0.10), int(w * 0.62)
    for i in range(24, 0, -1):
        rr = r * i / 24
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(*GLOW, int(34 * (1 - i / 24) ** 1.5) + 2))
    glow = glow.filter(ImageFilter.GaussianBlur(9 * SUP))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    d = ImageDraw.Draw(img)
    edge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, w - 1, h - 1], radius=32, outline=(219, 228, 243, 255), width=2)
    return Image.alpha_composite(img.convert("RGBA"), edge).convert("RGBA")


def overlay(bg, pos, size, painter):
    """按控件位置从背景裁一块，在上面画东西，返回不透明结果。"""
    x, y = pos
    w, h = size
    tile = bg.crop((x, y, x + w, y + h)).convert("RGBA")
    painter(ImageDraw.Draw(tile), tile.size)
    return tile.convert("RGB").convert("RGBA")


# ------------------------------------------------------------- 各种小部件


def paint_rounded(d, size, radius, fill=None, outline=None, width=1):
    w, h = size
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill, outline=outline, width=width)


def paint_primary(size, hover):
    """渐变主按钮（返回 RGBA，供贴到裁片上）。"""
    w, h = size
    a = (59, 130, 246) if hover else ACCENT_A
    b = (129, 179, 252) if hover else ACCENT_B
    grad = Image.new("RGBA", (w, 1))
    for x in range(w):
        grad.putpixel((x, 0), (*lerp(a, b, x / max(1, w - 1)), 255))
    grad = grad.resize((w, h))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=16, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def btn_big(bg, pos, hover):
    def painter(d, size):
        img = paint_primary((size[0], size[1]), hover)
        d._image.paste(img, (0, 0), img)
    return supersampled(lambda s: overlay(bg, pos, (BIG_W, BIG_H), painter), (BIG_W, BIG_H))


def btn_ghost(bg, pos, hover):
    def painter(d, size):
        w, h = size
        G = 2
        fill = (238, 244, 255, 255) if hover else (255, 255, 255, 255)
        outline = (147, 178, 226, 255) if hover else (214, 224, 240, 255)
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=14, fill=fill, outline=outline, width=G)
    return supersampled(lambda s: overlay(bg, pos, (GHOST_W, GHOST_H), painter), (GHOST_W, GHOST_H))


def input_box(bg):
    def painter(d, size):
        w, h = size
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=14,
                            fill=(245, 249, 255, 255), outline=(219, 228, 243, 255), width=2)
    return supersampled(lambda s: overlay(bg, INPUT_BOX, (INPUT_W, INPUT_H), painter), (INPUT_W, INPUT_H))


def bar_track(bg):
    def painter(d, size):
        w, h = size
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=(232, 238, 249, 255))
    return supersampled(lambda s: overlay(bg, BAR, (BAR_W, BAR_H), painter), (BAR_W, BAR_H))


def bar_fill(bg):
    track_rgb = bg.convert("RGB").getpixel((BAR[0] + 3, BAR[1] + BAR_H // 2))

    def make(size):
        w, h = size
        img = Image.new("RGBA", (w, h), (*track_rgb, 255))
        grad = Image.new("RGBA", (w, 1))
        for x in range(w):
            grad.putpixel((x, 0), (*lerp(ACCENT_A, ACCENT_B, x / max(1, w - 1)), 255))
        grad = grad.resize((w, h))
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=255)
        img.paste(grad, (0, 0), mask)
        hi = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(hi).rounded_rectangle([0, 0, w - 1, h // 2], radius=h // 2, fill=(255, 255, 255, 48))
        return Image.alpha_composite(img, hi).convert("RGB").convert("RGBA")

    return supersampled(make, (BAR_W, BAR_H))


# ------------------------------------------------------------------ 轮播图


def slide(bg, index):
    title, desc = SLIDES[index]
    w, h = SLIDE_W * SUP, SLIDE_H * SUP

    def make(size):
        w, h = size
        tile = bg.crop((SLIDE[0], SLIDE[1], SLIDE[0] + SLIDE_W, SLIDE[1] + SLIDE_H)).resize(size, Image.BICUBIC)
        d = ImageDraw.Draw(tile)
        s = w / SLIDE_W
        # 卡片底
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(16 * s),
                            fill=(247, 250, 255, 255), outline=(225, 233, 247, 255), width=int(2 * s))
        # 左侧强调竖条
        d.rounded_rectangle([int(18 * s), int(22 * s), int(22 * s), int(h - 22 * s)],
                            radius=int(2 * s), fill=(*ACCENT_A, 255))
        # 文案
        d.text((int(40 * s), int(26 * s)), title, font=font(int(17 * s)), fill=(*FG, 255))
        d.text((int(40 * s), int(60 * s)), desc, font=font(int(10 * s)), fill=(*MUTED, 255))

        # 右侧图形:圆环 + 内圆 + 点缀
        cx, cy, r = int(w * 0.80), int(h * 0.52), int(30 * s)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(*ACCENT_B, 120), width=int(2 * s))
        d.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55], fill=(*ACCENT_A, 60))
        d.ellipse([cx - r * 0.26, cy - r * 0.26, cx + r * 0.26, cy + r * 0.26], fill=(*TEAL, 230))
        for ang, rad in ((210, 44), (330, 50), (30, 46)):
            import math
            ax = cx + math.cos(math.radians(ang)) * rad * s
            ay = cy + math.sin(math.radians(ang)) * rad * s
            dr = 3 * s
            d.ellipse([ax - dr, ay - dr, ax + dr, ay + dr], fill=(*ACCENT_B, 130))

        # 右下角页码点
        for i in range(len(SLIDES)):
            dx = int(w - 20 * s) - (len(SLIDES) - 1 - i) * int(14 * s)
            dy = int(h - 18 * s)
            rr = int((4 if i == index else 3) * s)
            col = (*ACCENT_A, 255) if i == index else (203, 213, 228, 255)
            d.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], fill=col)
        return tile

    return make((w, h)).resize((SLIDE_W, SLIDE_H), Image.LANCZOS)


# ---------------------------------------------------------------- 小火箭


BODY = (255, 255, 255, 255)
FIN = (58, 110, 235, 255)
FIN_DARK = (32, 74, 184, 255)


def draw_rocket(size, flame):
    W = H = size[0] * SUP
    U = float(W)
    cy = H * 0.5
    x0, x1, x2 = 0.205 * U, 0.665 * U, 0.945 * U
    hh = 0.158 * U
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    tx = x0 - hh * 0.78
    flen = 0.26 * U * flame
    for col, k in (((255, 96, 48, 225), 1.00), ((255, 166, 58, 242), 0.62), ((255, 242, 202, 255), 0.30)):
        L = flen * k
        h = hh * (0.44 * k + 0.26)
        d.polygon([(tx + 2, cy - h), (tx - L, cy), (tx + 2, cy + h)], fill=col)

    for sign in (-1, 1):
        d.polygon([(x0 + 0.185 * U, cy + sign * hh), (x0 - 0.020 * U, cy + sign * hh),
                   (x0 - 0.085 * U, cy + sign * hh * 1.72)], fill=FIN)
        d.polygon([(x0 + 0.185 * U, cy + sign * hh), (x0 + 0.030 * U, cy + sign * hh),
                   (x0 - 0.020 * U, cy + sign * hh * 1.40)], fill=FIN_DARK)

    d.rectangle([x0, cy - hh, x1, cy + hh], fill=BODY)
    d.ellipse([x0 - hh * 0.92, cy - hh, x0 + hh * 0.92, cy + hh], fill=BODY)
    d.polygon([(x1, cy - hh), (x2, cy), (x1, cy + hh)], fill=BODY)

    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse([x0, cy - hh * 0.30, x1 + 0.02 * U, cy + hh * 2.4], fill=(120, 152, 218, 100))
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle([x0, cy - hh, x1, cy + hh], fill=255)
    md.ellipse([x0 - hh * 0.92, cy - hh, x0 + hh * 0.92, cy + hh], fill=255)
    md.polygon([(x1, cy - hh), (x2, cy), (x1, cy + hh)], fill=255)
    shade.putalpha(Image.composite(shade.getchannel("A"), Image.new("L", (W, H), 0), mask))
    img = Image.alpha_composite(img, shade)
    d = ImageDraw.Draw(img)

    wc, wr = 0.545 * U, 0.086 * U
    d.ellipse([wc - wr, cy - wr, wc + wr, cy + wr], fill=(13, 25, 58, 255))
    d.ellipse([wc - wr * 0.78, cy - wr * 0.78, wc + wr * 0.78, cy + wr * 0.78], fill=(*TEAL, 255))
    d.ellipse([wc - wr * 0.56, cy - wr * 0.62, wc + wr * 0.08, cy - wr * 0.10], fill=(212, 255, 250, 252))
    d.rounded_rectangle([x0, cy - hh, x0 + 0.028 * U, cy + hh], radius=hh * 0.5, fill=(198, 214, 242, 255))

    # 浅色底上白机身看不清，整体描一圈蓝边
    hh2 = hh * 1.02
    sil = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(sil)
    sd.rectangle([x0, cy - hh2, x1, cy + hh2], fill=255)
    sd.ellipse([x0 - hh2 * 0.94, cy - hh2, x0 + hh2 * 0.94, cy + hh2], fill=255)
    sd.polygon([(x1, cy - hh2), (x2 + 0.012 * U, cy), (x1, cy + hh2)], fill=255)
    grow = sil.filter(ImageFilter.MaxFilter(7))
    ring = ImageChops.subtract(grow, sil).filter(ImageFilter.GaussianBlur(0.6))
    edge = Image.new("RGBA", (W, H), FIN[:3] + (255,))
    edge.putalpha(ring)
    img = Image.alpha_composite(edge, img)

    img = img.rotate(-8, resample=Image.BICUBIC, expand=False)
    return img.resize(size, Image.LANCZOS)


def save_bmp32(img: Image.Image, path: Path) -> None:
    """32 位 BI_RGB BMP（BGRA、自下而上），Inno 的 TAlphaBitmap 能读到 alpha。"""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    rows = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            rows += bytes((b, g, r, a))
    pixels = bytes(rows)
    info = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 32, 0, len(pixels), 2835, 2835, 0, 0)
    header = struct.pack("<2sIHHI", b"BM", 14 + len(info) + len(pixels), 0, 0, 14 + len(info))
    path.write_bytes(header + info + pixels)


# ------------------------------------------------------------------- main


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in list(OUT.glob("*.png")) + list(OUT.glob("*.bmp")):
        old.unlink()

    bg = supersampled(draw_bg, (CARD_W, CARD_H))

    # 右上角关闭 ✕（直接烘进背景，避免字体缺字时显示成方框）
    d = ImageDraw.Draw(bg)
    cx, cy, s = 526, 27, 6
    d.line([(cx - s, cy - s), (cx + s, cy + s)], fill=(148, 163, 184, 255), width=3)
    d.line([(cx - s, cy + s), (cx + s, cy - s)], fill=(148, 163, 184, 255), width=3)
    bg.save(OUT / "bg.png")

    # 图标（裁背景合成）
    icon = Image.open(LOGO).convert("RGBA").resize((ICON_S, ICON_S), Image.LANCZOS)
    base = bg.crop((ICON_X, ICON_Y, ICON_X + ICON_S, ICON_Y + ICON_S)).convert("RGBA")
    base.alpha_composite(icon)
    base.convert("RGB").convert("RGBA").save(OUT / "icon-44.png")

    btn_big(bg, BIG1, False).save(OUT / "btn-big.png")
    btn_big(bg, BIG1, True).save(OUT / "btn-big-hover.png")
    btn_big(bg, BIG2, False).save(OUT / "btn-big2.png")
    btn_big(bg, BIG2, True).save(OUT / "btn-big2-hover.png")
    btn_ghost(bg, GHOST, False).save(OUT / "btn-ghost.png")
    btn_ghost(bg, GHOST, True).save(OUT / "btn-ghost-hover.png")
    btn_ghost(bg, BROWSE, False).save(OUT / "btn-browse.png")
    btn_ghost(bg, BROWSE, True).save(OUT / "btn-browse-hover.png")

    input_box(bg).save(OUT / "inputbox.png")
    bar_track(bg).save(OUT / "bar_track.png")
    bar_fill(bg).save(OUT / "bar_fill.png")

    for i in range(len(SLIDES)):
        slide(bg, i).save(OUT / f"slide-{i + 1}.png")

    for name, flame in (("rocket-a.bmp", 1.0), ("rocket-b.bmp", 0.55)):
        save_bmp32(supersampled(lambda s, f=flame: draw_rocket(s, f), (ROCKET_S, ROCKET_S)), OUT / name)

    for p in sorted(OUT.iterdir()):
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size:>7,} B")


if __name__ == "__main__":
    main()

"""
C30 品牌 Logo 生成器
====================

从一套矢量化的设计令牌渲染出所有目标尺寸的位图 + Windows ICO。

用法:
    python scripts/gen-logo.py

产出:
    assets/logo/c30-logo.svg      矢量源文件
    assets/logo/png/*.png         各尺寸 PNG
    assets/logo/c30.ico           Windows 多尺寸图标
    apps/*/build/icon.ico         electron-builder 构建资源
"""

import math
import os
import zlib
import struct
from PIL import Image, ImageDraw

# ── 路径 ────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets", "logo")

# ── 品牌设计令牌 ────────────────────────────────────────────────────────
# 语义:C30 = 教培互动教学。图形 = 深色圆角底 + 白色白板(右上折角)
#        + "C30" 字形 + 青绿互动光点。
PRIMARY = (30, 58, 138)        # 深靛蓝 #1E3A8A
PRIMARY_DARK = (23, 37, 84)    # #172554
PRIMARY_LIGHT = (37, 99, 235)  # #2563EB
ACCENT = (20, 184, 166)        # 青绿 #14B8A6
BOARD = (255, 255, 255)        # 白板
TEXT = (23, 37, 84)            # 字形深蓝
TRAY_TINT = (56, 189, 248)     # 托盘浅蓝(深色底高对比)


def tokens(size):
    """按尺寸做视觉修正(optical sizing)。

    为什么不用一张大图缩放:
      16px 托盘图标和 256px 安装图标的信息密度完全不同。大图直接缩到 16px,
      "C30" 三个字会糊成黑块。这里每个尺寸复用同一套矢量比例,但按尺寸
      动态调整线宽、是否绘制细节,保证小尺寸形体依然清晰 —— 与图标字体
      分字号重绘同理。
    """
    return {
        "size": size,
        # 是否画 "C30" 字形(太小则只保留白板外框)
        "glyph": size >= 24,
        # 是否画强调色光点
        "accent": True,
        # 次要光点(更耗面积)
        "accent2": size >= 32,
    }


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def draw_logo(size, *, mono=False, flat=False):
    """渲染一帧 Logo 到 RGBA PIL Image。mono=托盘高对比版。"""
    S = size
    SS = 4  # 4x 超采样,抗锯齿
    s = S * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = tokens(size)

    def px(v):
        """把 0..256 设计坐标换算到当前像素。"""
        return v * s / 256.0

    # ① 圆角底 —— 保证在任何背景(浅色任务栏/深色托盘)都有实体轮廓
    base_top = PRIMARY_LIGHT if not mono else (30, 41, 59)
    base_bot = PRIMARY_DARK if not mono else (2, 6, 23)
    r_out = px(58) * 1.0
    for y in range(s):
        t = y / max(1, s - 1)
        _row_gradient(d, img, y, s, base_top, base_bot, t)
    mask_out = _rounded_mask(s, px(58))
    img.putalpha(Image.composite(Image.new("L", (s, s), 255),
                                 Image.new("L", (s, s), 0), mask_out))

    # ② 白板面(白色,右上折角)
    bl, bt = px(43), px(43)
    br, bb = px(213), px(213)
    fold = px(36)
    brad = px(14)
    board = _polygon_mask(s, [
        (bl + brad, bt), (br - fold, bt), (br, bt + fold),
        (br, bb - brad), (br, bb), (br - brad, bb),
        (bl + brad, bb), (bl, bb), (bl, bb - brad),
        (bl, bt + brad), (bl, bt), (bl + brad, bt),
    ], smooth=brad)
    white_layer = Image.new("RGBA", (s, s), BOARD + (255,))
    img.paste(white_layer, (0, 0), board)

    # ③ "C30" 字形
    if k["glyph"]:
        _draw_glyphs(img, s, mono)

    # ④ 互动光点(青绿 → 代表实时互动 / 笔迹)
    ac = TRAY_TINT if mono else ACCENT
    dot = ImageDraw.Draw(img)
    cx, cy = px(196), px(198)
    dr = max(px(7), 1.0 * SS)
    dot.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=ac + (255,))
    if k["accent2"]:
        dot.ellipse([cx - px(20) - dr * .7, cy - dr * .7,
                     cx - px(20) + dr * .7, cy + dr * .7], fill=ac + (255,))
        dot.ellipse([cx - px(38) - dr * .45, cy - dr * .45,
                     cx - px(38) + dr * .45, cy + dr * .45], fill=ac + (255,))

    # 降采样输出(高质量抗锯齿)。
    #
    # 关键:必须在「预乘 alpha」空间里做 LANCZOS。PIL 直接 resize RGBA 时,
    # 是完全透明像素(alpha=0)里残留的 RGB 垃圾值参与插值,导致圆角边缘
    # 出现一圈青色亮边(cyan halo)—— 在所有非白色背景上都可见。
    # 先把 RGB 乘以 alpha 归一,重采样后再除回去, halo 就消失了。
    out = _premul_resize(img, S)
    return out


def _premul_resize(img, size):
    """预乘 alpha 后重采样,再还原 —— 消除透明边缘的颜色渗出(halo)。"""
    import numpy as np
    arr = np.asarray(img, dtype=np.float32)          # HxWx4
    rgb, a = arr[..., :3], arr[..., 3:4]
    # ① 预乘:RGB *= alpha/255
    prem = np.concatenate([rgb * (a / 255.0), a], axis=-1)
    prem_img = Image.fromarray(prem.astype(np.uint8), "RGBA")
    # ② LANCZOS 重采样
    small = prem_img.resize((size, size), Image.LANCZOS)
    s = np.asarray(small, dtype=np.float32)
    srgb, sa = s[..., :3], s[..., 3:4]
    # ③ 还原:RGB /= alpha/255(下限 1/255 防除零)
    denom = np.maximum(sa, 1.0) / 255.0
    out_rgb = np.clip(srgb / denom, 0, 255)
    # ④ 清理:alpha≈0 处除以极小分母会放大噪声,残留 [0,0,255] / [0,255,255]
    #    这类纯色噪点(在深色托盘背景上就是亮点)。近透明像素 RGB 直接归零。
    nearly_clear = sa[..., 0] < 8
    out_rgb[nearly_clear] = 0.0
    out = np.concatenate([out_rgb, sa], axis=-1)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def _row_gradient(d, img, y, s, top, bot, t):
    c = lerp(top, bot, t)
    d.line([(0, y), (s, y)], fill=c + (255,))


def _rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                        radius=radius, fill=255)
    return m


def _polygon_mask(size, pts, smooth=0):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def _draw_glyphs(img, s, mono):
    """用几何笔画拼出 C / 3 / 0。"""
    col = (255, 255, 255, 255) if mono else TEXT + (255,)
    lay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)

    def P(v):
        return v * s / 256.0

    w = max(P(9), 1.2)          # 笔画宽
    top, bot = P(87), P(161)
    cy = (top + bot) / 2

    # C:左开口圆膛(用两段弧近似)
    c_cx, c_r = P(86), (bot - top) / 2
    d.arc([c_cx - c_r, cy - c_r, c_cx + c_r, cy + c_r],
          start=65, end=295, fill=col, width=int(w))

    # 3:两段圆弧
    t_cx = P(128)
    tw = P(22)
    d.arc([t_cx - tw, top, t_cx + tw, top + c_r], start=310, end=80,
          fill=col, width=int(w))
    d.arc([t_cx - tw, cy, t_cx + tw, bot], start=300, end=70,
          fill=col, width=int(w))

    # 0:椭圆环
    z_cx = P(170)
    zw = P(20)
    d.ellipse([z_cx - zw, cy - c_r, z_cx + zw, cy + c_r],
              outline=col, width=int(w))

    img.alpha_composite(lay)


# ── 尺寸清单 ────────────────────────────────────────────────────────────
# 名称:用途
TARGETS = [
    (16,  "tray-16",     "托盘 Windows 100% DPI"),
    (20,  "tray-20",     "托盘 Windows 125% DPI"),
    (24,  "tray-24",     "托盘 Windows 150% DPI"),
    (32,  "tray-32",     "托盘 高DPI / 任务栏小图标"),
    (40,  "tray-40",     "托盘 200% DPI"),
    (48,  "tray-48",     "托盘 250% DPI / 窗口标题栏"),
    (64,  "app-64",      "开始菜单 / 快捷方式"),
    (128, "app-128",     "Linux 安装 / 商店"),
    (256, "installer-256", "NSIS 安装程序向导大图标 / Alt-Tab"),
    (512, "store-512",   "商店 / 高DPI 大图"),
    (1024, "master-1024", "主源文件"),
]

# ICO 内嵌的尺寸(Windows 会按 DPI 自动挑)
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def build_ico(images, path):
    """手写 ICO 容器:多尺寸 PNG 直接内嵌(ICO 支持 PNG 压缩帧)。"""
    n = len(images)
    header = struct.pack("<HHH", 0, 1, n)
    offset = 6 + 16 * n
    entries, blobs = b"", b""
    for (size, data) in images:
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,   # w (0 = 256)
            size if size < 256 else 0,   # h
            0, 0,                        # palette, reserved
            1, 32,                       # planes, bpp
            len(data), offset,
        )
        blobs += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + blobs)


def png_bytes(im):
    import io
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


SVG_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <!-- C30 Logo · 教培互动教学 · 生成自 scripts/gen-logo.py -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2563EB"/>
      <stop offset="1" stop-color="#172554"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="58" fill="url(#bg)"/>
  <path d="M57 43 H177 L213 79 V199 A14 14 0 0 1 199 213 H57 A14 14 0 0 1 43 199 V57 A14 14 0 0 1 57 43 Z" fill="#fff"/>
  <g fill="none" stroke="#172554" stroke-width="9" stroke-linecap="round">
    <path d="M86 87 A37 37 0 1 0 86 161"/>
    <path d="M106 106 A22 20 0 1 1 150 106"/>
    <path d="M106 143 A22 20 0 1 1 150 143"/>
    <ellipse cx="170" cy="124" rx="20" ry="37"/>
  </g>
  <circle cx="196" cy="198" r="7" fill="#14B8A6"/>
  <circle cx="176" cy="198" r="5" fill="#14B8A6"/>
  <circle cx="158" cy="198" r="3" fill="#14B8A6"/>
</svg>
"""


def main():
    os.makedirs(os.path.join(ASSETS, "png"), exist_ok=True)

    # 矢量源
    with open(os.path.join(ASSETS, "c30-logo.svg"), "w", encoding="utf-8") as f:
        f.write(SVG_TEMPLATE)
    print(f"[svg] {os.path.join(ASSETS, 'c30-logo.svg')}")

    cache = {}
    for size, name, desc in TARGETS:
        mono = size <= 48  # 小尺寸用高对比版本
        im = draw_logo(size, mono=mono)
        p = os.path.join(ASSETS, "png", f"{name}.png")
        im.save(p, "PNG", optimize=True)
        cache[size] = png_bytes(im)
        print(f"[png] {size:>4}px  {name:<16} {desc}")

    # Windows ICO
    ico_path = os.path.join(ASSETS, "c30.ico")
    build_ico([(sz, cache[sz]) for sz in ICO_SIZES], ico_path)
    print(f"[ico] {ico_path}  ({len(ICO_SIZES)} 帧)")

    # 复制到各 Electron 应用的 buildResources(electron-builder 约定 build/icon.ico)
    ico_bytes = open(ico_path, "rb").read()
    for app in ("teacher", "student"):
        bdir = os.path.join(ROOT, "apps", app, "build")
        os.makedirs(bdir, exist_ok=True)
        dst = os.path.join(bdir, "icon.ico")
        with open(dst, "wb") as f:
            f.write(ico_bytes)
        # 顺手给一份 PNG 备用
        with open(os.path.join(bdir, "icon.png"), "wb") as f:
            f.write(cache[256])
        print(f"[app] apps/{app}/build/icon.ico")

    # 托盘专用(运行时 assets,打包后随 app 分发)
    tray_dir = os.path.join(ROOT, "apps", "teacher", "assets", "tray")
    os.makedirs(tray_dir, exist_ok=True)
    for sz in (16, 20, 24, 32, 40, 48):
        with open(os.path.join(tray_dir, f"tray-{sz}.png"), "wb") as f:
            f.write(cache[sz])
    print(f"[tray] apps/teacher/assets/tray/ (16/20/24/32/40/48)")

    print("\n完成。")


if __name__ == "__main__":
    main()

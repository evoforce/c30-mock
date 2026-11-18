#!/usr/bin/env python3
"""
C30 Logo Generator v3 — 精细化版本
改进：
  - C/3/0 用高质量字体渲染替代手绘弧线
  - 更精致的渐变背景和光影
  - 右上角在线指示点 + 底部互动连接点保留
  - 整体更干净专业
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math
from pathlib import Path

WORKSPACE = Path(r"C:\Users\25421\project\C30-mock")
PNG_DIR = WORKSPACE / "assets" / "logo" / "png"


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def generate_logo(size):
    """Generate the C30 logo at the given pixel size."""
    # Render at 4x then downscale for anti-aliasing
    scale = 4 if size >= 64 else 2
    S = size * scale  # working size

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # === BACKGROUND: diagonal gradient rounded rect ===
    pad = int(S * 0.015)
    radius = int(S * 0.22)

    # Create gradient
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    color_tl = (56, 130, 246)   # brighter blue top-left
    color_br = (15, 23, 72)     # deep navy bottom-right

    for py in range(S):
        for px in range(S):
            t = (px / max(S - 1, 1) * 0.45 + py / max(S - 1, 1) * 0.55)
            t = max(0.0, min(1.0, t))
            c = lerp_color(color_tl, color_br, t)
            grad.putpixel((px, py), (*c, 255))

    # Rounded rect mask
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [pad, pad, S - pad - 1, S - pad - 1], radius=radius, fill=255
    )
    grad.putalpha(mask)
    img = Image.alpha_composite(img, grad)

    # === TOP HIGHLIGHT: subtle glass effect ===
    highlight = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(highlight)
    glow_h = int(S * 0.40)
    for y in range(pad, pad + glow_h):
        progress = (y - pad) / max(glow_h - 1, 1)
        alpha = int(35 * (1 - progress) ** 1.5)
        h_draw.line([(pad + radius, y), (S - pad - radius, y)], fill=(255, 255, 255, alpha))
    highlight.putalpha(Image.composite(
        highlight.split()[3],
        Image.new("L", (S, S), 0),
        mask
    ))
    img = Image.alpha_composite(img, highlight)

    # === "C30" TEXT: use high-quality font rendering ===
    draw = ImageDraw.Draw(img)

    # Try to find a good bold font
    font_paths = [
        "C:/Windows/Fonts/segoeui.ttf",      # Segoe UI
        "C:/Windows/Fonts/arial.ttf",          # Arial
        "C:/Windows/Fonts/calibri.ttf",        # Calibri
    ]
    font_bold_paths = [
        "C:/Windows/Fonts/segoeuib.ttf",       # Segoe UI Bold
        "C:/Windows/Fonts/arialbd.ttf",         # Arial Bold
        "C:/Windows/Fonts/calibrib.ttf",        # Calibri Bold
    ]

    font_size = int(S * 0.42)
    font = None
    for fp in font_bold_paths + font_paths:
        try:
            font = ImageFont.truetype(fp, font_size)
            break
        except (OSError, IOError):
            continue
    if font is None:
        font = ImageFont.load_default()

    text = "C30"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Center text slightly above middle
    tx = (S - tw) / 2 - bbox[0]
    ty = (S - th) / 2 - bbox[1] - S * 0.04

    # Draw text with slight shadow for depth
    shadow_offset = max(1, int(S * 0.006))
    draw.text((tx + shadow_offset, ty + shadow_offset), text, font=font, fill=(10, 15, 50, 80))
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # === ONLINE INDICATOR: green dot top-right ===
    dot_r = S * 0.048
    dot_cx = S * 0.80
    dot_cy = S * 0.20

    # White border ring
    border_w = S * 0.018
    draw.ellipse([
        dot_cx - dot_r - border_w, dot_cy - dot_r - border_w,
        dot_cx + dot_r + border_w, dot_cy + dot_r + border_w,
    ], fill=(255, 255, 255, 230))

    # Green dot with slight gradient feel
    draw.ellipse([
        dot_cx - dot_r, dot_cy - dot_r,
        dot_cx + dot_r, dot_cy + dot_r,
    ], fill=(52, 211, 153, 255))  # emerald-400

    # Tiny highlight on the dot
    hl_r = dot_r * 0.35
    hl_cx = dot_cx - dot_r * 0.25
    hl_cy = dot_cy - dot_r * 0.25
    draw.ellipse([
        hl_cx - hl_r, hl_cy - hl_r,
        hl_cx + hl_r, hl_cy + hl_r,
    ], fill=(167, 243, 208, 180))  # lighter emerald

    # === INTERACTION DOTS: three connected dots at bottom ===
    dots_y = S * 0.79
    dot_spacing = S * 0.075
    base_r = S * 0.020

    dot_configs = [
        (-1, (96, 165, 250, 255), 1.0),    # left: medium blue
        (0,  (147, 197, 253, 255), 0.85),   # center: lighter
        (1,  (191, 219, 254, 255), 0.70),   # right: lightest
    ]

    centers = []
    for offset, color, r_scale in dot_configs:
        dx = S * 0.50 + offset * dot_spacing
        r = base_r * r_scale
        centers.append((dx, dots_y, r))
        draw.ellipse([dx - r, dots_y - r, dx + r, dots_y + r], fill=color)

    # Connection lines between dots
    line_w = max(1, int(S * 0.007))
    for i in range(len(centers) - 1):
        x1 = centers[i][0] + centers[i][2]
        x2 = centers[i + 1][0] - centers[i + 1][2]
        draw.line([(x1, dots_y), (x2, dots_y)], fill=(147, 197, 253, 100), width=line_w)

    # === Downscale with high-quality resampling ===
    final = img.resize((size, size), Image.LANCZOS)
    return final


def main():
    PNG_DIR.mkdir(parents=True, exist_ok=True)

    sizes = {
        "tray": [16, 20, 24, 32, 40, 48],
        "app": [64, 128],
        "installer": [256],
        "store": [512],
        "master": [1024],
    }

    all_paths = []
    for category, size_list in sizes.items():
        for sz in size_list:
            print(f"Generating {category}-{sz}.png ({sz}x{sz})...")
            img = generate_logo(sz)
            path = PNG_DIR / f"{category}-{sz}.png"
            img.save(str(path))
            all_paths.append(path)

    print(f"\nGenerated {len(all_paths)} files:")
    for p in all_paths:
        print(f"  {p.relative_to(WORKSPACE)}")


if __name__ == "__main__":
    main()

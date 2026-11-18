#!/usr/bin/env python3
"""
C30 Logo Generator v2 — 高品质像素级绘制
设计思路：
  - 深蓝→亮蓝对角渐变圆角矩形背景
  - 中心 "C" 字母用圆弧笔画，"3" 和 "0" 用几何造型
  - 右上角一个亮色小圆点代表"在线/连接"
  - 底部三个渐变小点暗示"多端互动"
  - 整体现代、有科技感但不冰冷
"""

from PIL import Image, ImageDraw, ImageFont
import math
from pathlib import Path

WORKSPACE = Path(r"C:\Users\25421\project\C30-mock")
PNG_DIR = WORKSPACE / "assets" / "logo" / "png"


def lerp_color(c1, c2, t):
    """Linear interpolate between two RGB colors."""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def draw_gradient_rounded_rect(draw, img, bbox, radius, color_tl, color_br):
    """Draw a rounded rectangle with diagonal gradient by compositing."""
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0

    # Create gradient image
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for py in range(h):
        for px in range(w):
            t = (px / max(w - 1, 1) * 0.5 + py / max(h - 1, 1) * 0.5)
            c = lerp_color(color_tl, color_br, t)
            grad.putpixel((px, py), (*c, 255))

    # Create mask with rounded corners
    mask = Image.new("L", (w, h), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)

    # Apply mask
    grad.putalpha(mask)
    img.paste(grad, (x0, y0), grad)


def draw_thick_arc(draw, center, radius, start_deg, end_deg, width, color):
    """Draw a thick arc using polygon approximation."""
    cx, cy = center
    steps = max(60, int(abs(end_deg - start_deg) * 2))
    outer_r = radius + width / 2
    inner_r = radius - width / 2

    points_outer = []
    points_inner = []
    for i in range(steps + 1):
        angle = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        points_outer.append((cx + outer_r * math.cos(angle), cy + outer_r * math.sin(angle)))
        points_inner.append((cx + inner_r * math.cos(angle), cy + inner_r * math.sin(angle)))

    points = points_outer + list(reversed(points_inner))
    if len(points) >= 3:
        draw.polygon(points, fill=color)


def draw_thick_circle(draw, center, radius, width, color):
    """Draw a thick circle (ring)."""
    cx, cy = center
    outer_r = radius + width / 2
    inner_r = radius - width / 2
    draw.ellipse([cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r], fill=color)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=(0, 0, 0, 0))


def generate_logo(size):
    """Generate the C30 logo at the given pixel size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size  # shorthand

    # --- Background: diagonal gradient rounded rect ---
    pad = int(s * 0.02)
    radius = int(s * 0.22)
    color_tl = (37, 99, 235)    # #2563EB bright blue
    color_br = (15, 23, 82)     # #0F1752 deep navy
    draw_gradient_rounded_rect(
        None, img,
        [pad, pad, s - pad, s - pad],
        radius, color_tl, color_br
    )

    draw = ImageDraw.Draw(img)

    # --- Subtle inner glow / lighter overlay at top ---
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_h = int(s * 0.45)
    for y in range(glow_h):
        alpha = int(40 * (1 - y / glow_h))
        glow_draw.line([(pad + radius, pad + y), (s - pad - radius, pad + y)], fill=(255, 255, 255, alpha))
    # Mask glow to rounded rect
    glow_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(glow_mask).rounded_rectangle(
        [pad, pad, s - pad, s - pad], radius=radius, fill=255
    )
    glow.putalpha(Image.composite(glow.split()[3], Image.new("L", (s, s), 0), glow_mask))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # --- "C" letter: thick arc opening to the right ---
    c_cx = s * 0.36
    c_cy = s * 0.48
    c_r = s * 0.18
    c_width = s * 0.065
    white = (255, 255, 255, 255)
    # Arc from ~50° to ~310° (opening on the right)
    draw_thick_arc(draw, (c_cx, c_cy), c_r, 50, 310, c_width, white)

    # --- "3" digit: two arcs stacked ---
    three_cx = s * 0.56
    three_top_cy = s * 0.38
    three_bot_cy = s * 0.58
    three_r = s * 0.095
    three_w = s * 0.055
    # Top arc: -80° to 80°
    draw_thick_arc(draw, (three_cx, three_top_cy), three_r, -80, 80, three_w, white)
    # Bottom arc: -80° to 80°
    draw_thick_arc(draw, (three_cx, three_bot_cy), three_r, -80, 80, three_w, white)

    # --- "0" digit: thick ellipse ring ---
    zero_cx = s * 0.74
    zero_cy = s * 0.48
    zero_rx = s * 0.10
    zero_ry = s * 0.18
    zero_w = s * 0.055
    # Outer ellipse
    draw.ellipse([
        zero_cx - zero_rx - zero_w / 2,
        zero_cy - zero_ry - zero_w / 2,
        zero_cx + zero_rx + zero_w / 2,
        zero_cy + zero_ry + zero_w / 2,
    ], fill=white)
    # Inner ellipse (cut out) — use background-ish color
    # We need to cut through, so draw with the gradient color at that point
    inner_cut = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner_draw = ImageDraw.Draw(inner_cut)
    inner_draw.ellipse([
        zero_cx - zero_rx + zero_w / 2,
        zero_cy - zero_ry + zero_w / 2,
        zero_cx + zero_rx - zero_w / 2,
        zero_cy + zero_ry - zero_w / 2,
    ], fill=(0, 0, 0, 255))
    # Use destination-out compositing
    from PIL import ImageChops
    # Actually, let's just redraw the background in that area
    # Simpler: create the "0" as a ring on a separate layer and composite
    pass  # We'll handle this differently below

    # Let me redo the "0" properly using a separate layer approach
    # Clear and restart the "0"
    # Actually the ellipse fill already drew over the gradient. Let me fix by
    # drawing the inner part with sampled gradient colors.
    for py in range(int(zero_cy - zero_ry + zero_w / 2), int(zero_cy + zero_ry - zero_w / 2) + 1):
        for px in range(int(zero_cx - zero_rx + zero_w / 2), int(zero_cx + zero_rx - zero_w / 2) + 1):
            # Check if inside inner ellipse
            dx = (px - zero_cx) / (zero_rx - zero_w / 2) if (zero_rx - zero_w / 2) > 0 else 0
            dy = (py - zero_cy) / (zero_ry - zero_w / 2) if (zero_ry - zero_w / 2) > 0 else 0
            if dx * dx + dy * dy <= 1.0:
                # Sample gradient color at this position
                t = ((px - pad) / max(s - 2 * pad - 1, 1) * 0.5 +
                     (py - pad) / max(s - 2 * pad - 1, 1) * 0.5)
                t = max(0, min(1, t))
                c = lerp_color(color_tl, color_br, t)
                img.putpixel((px, py), (*c, 255))

    # --- Online indicator dot (top-right) ---
    dot_r = s * 0.045
    dot_cx = s * 0.82
    dot_cy = s * 0.18
    # Bright green-cyan for "online"
    draw.ellipse([
        dot_cx - dot_r, dot_cy - dot_r,
        dot_cx + dot_r, dot_cy + dot_r,
    ], fill=(52, 211, 153, 255))  # #34D399 emerald
    # White border ring
    border_w = s * 0.015
    draw.ellipse([
        dot_cx - dot_r - border_w, dot_cy - dot_r - border_w,
        dot_cx + dot_r + border_w, dot_cy + dot_r + border_w,
    ], outline=(255, 255, 255, 200), width=max(1, int(border_w)))

    # --- Three interaction dots at bottom ---
    dot_y = s * 0.78
    dot_spacing = s * 0.08
    dot_small_r = s * 0.022
    colors_dots = [
        (96, 165, 250, 255),   # light blue
        (147, 197, 253, 255),  # lighter blue
        (191, 219, 254, 255),  # lightest blue
    ]
    for i, dc in enumerate(colors_dots):
        dx = s * 0.50 + (i - 1) * dot_spacing
        r = dot_small_r * (1.0 - i * 0.15)
        draw.ellipse([dx - r, dot_y - r, dx + r, dot_y + r], fill=dc)

    # --- Subtle connection lines between dots ---
    line_y = dot_y
    for i in range(2):
        x1 = s * 0.50 + (i - 1) * dot_spacing + dot_small_r
        x2 = s * 0.50 + i * dot_spacing - dot_small_r * (1.0 - (i + 1) * 0.15)
        draw.line([(x1, line_y), (x2, line_y)], fill=(147, 197, 253, 120), width=max(1, int(s * 0.008)))

    return img


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

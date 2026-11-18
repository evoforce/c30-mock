#!/usr/bin/env python3
"""Convert SVG logo to various PNG sizes for C30 application icons."""

import subprocess
import sys
from pathlib import Path

# Check if cairosvg is available, otherwise use a manual approach
try:
    import cairosvg
    HAS_CAIROSVG = True
except ImportError:
    HAS_CAIROSVG = False

def convert_svg_to_png(svg_path: Path, png_path: Path, size: int):
    """Convert SVG to PNG at specified size."""
    if HAS_CAIROSVG:
        cairosvg.svg2png(
            url=str(svg_path),
            write_to=str(png_path),
            output_width=size,
            output_height=size
        )
    else:
        # Fallback: create a simple colored square with text using Pillow
        from PIL import Image, ImageDraw, ImageFont
        
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # Background gradient approximation (solid blue)
        bg_color = (59, 130, 246)  # #3B82F6
        draw.rounded_rectangle([0, 0, size-1, size-1], radius=size//4, fill=bg_color)
        
        # White document shape
        doc_margin = size // 8
        doc_color = (255, 255, 255, 240)
        draw.rounded_rectangle(
            [doc_margin, doc_margin, size - doc_margin, size - doc_margin],
            radius=size // 16,
            fill=doc_color
        )
        
        # Try to add text
        try:
            font_size = size // 3
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
        
        text = "C30"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = (size - text_w) / 2 - bbox[0]
        y = (size - text_h) / 2 - bbox[1] + size // 8
        
        text_color = (30, 64, 175)  # #1E40AF
        draw.text((x, y), text, font=font, fill=text_color)
        
        img.save(str(png_path))

def main():
    workspace = Path(r"C:\Users\25421\project\C30-mock")
    svg_path = workspace / "assets" / "logo" / "c30-logo.svg"
    
    if not svg_path.exists():
        print(f"Error: SVG not found at {svg_path}")
        sys.exit(1)
    
    # Define output sizes and paths
    sizes = {
        "app": [64, 128],
        "tray": [16, 20, 24, 32, 40, 48],
        "installer": [256],
        "store": [512],
        "master": [1024],
    }
    
    base_png_dir = workspace / "assets" / "logo" / "png"
    base_png_dir.mkdir(parents=True, exist_ok=True)
    
    outputs = []
    
    for category, size_list in sizes.items():
        for size in size_list:
            png_path = base_png_dir / f"{category}-{size}.png"
            print(f"Generating {png_path.name} ({size}x{size})...")
            convert_svg_to_png(svg_path, png_path, size)
            outputs.append((category, size, png_path))
    
    print("\nGenerated files:")
    for cat, sz, path in outputs:
        print(f"  {path.relative_to(workspace)}")
    
    print("\nDone!")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate ICO file from PNG icons for C30 application."""

from PIL import Image
from pathlib import Path

def main():
    workspace = Path(r"C:\Users\25421\project\C30-mock")
    png_dir = workspace / "assets" / "logo" / "png"
    
    # ICO sizes to include
    ico_sizes = [16, 20, 24, 32, 48, 64, 128, 256]
    
    images = []
    for size in ico_sizes:
        # Try app icon first, then tray, then installer/store/master
        candidates = [
            png_dir / f"app-{size}.png",
            png_dir / f"tray-{size}.png",
            png_dir / f"installer-{size}.png",
            png_dir / f"store-{size}.png",
            png_dir / f"master-{size}.png",
        ]
        
        img = None
        for c in candidates:
            if c.exists():
                img = Image.open(c)
                break
        
        if img is None:
            print(f"Warning: No {size}x{size} icon found, skipping")
            continue
        
        # Ensure RGBA mode for ICO
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        images.append(img)
        print(f"Added {size}x{size} to ICO")
    
    # Save ICO file
    ico_path = workspace / "assets" / "logo" / "c30.ico"
    images[0].save(
        str(ico_path),
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:] if len(images) > 1 else []
    )
    
    print(f"\nGenerated: {ico_path.relative_to(workspace)}")
    print(f"Total sizes: {len(images)}")

if __name__ == "__main__":
    main()

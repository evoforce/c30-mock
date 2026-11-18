#!/usr/bin/env python3
"""Generate multi-size ICO files for the C30 apps from the master PNG."""

from PIL import Image
from pathlib import Path

# ICO sizes to include. Windows 任务栏/资源管理器/安装器会按场景挑选,
# 必须包含 256x256，否则 electron-builder 会直接拒绝打包。
ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main():
    workspace = Path(r"C:\Users\25421\project\C30-mock")
    png_dir = workspace / "assets" / "logo" / "png"

    # 关键：必须从最大尺寸源图开始，由 Pillow 下采样出所有尺寸。
    # 不能拿 16x16 当底图——Pillow 不会上采样，sizes 里超过底图的尺寸会被跳过，
    # 最终 ICO 只剩 16x16（之前的生成脚本就是这个 bug）。
    master = Image.open(png_dir / "master-1024.png").convert("RGBA")

    targets = [
        workspace / "assets" / "logo" / "c30.ico",
        workspace / "apps" / "student" / "build" / "icon.ico",
        workspace / "apps" / "teacher" / "build" / "icon.ico",
    ]

    for ico_path in targets:
        ico_path.parent.mkdir(parents=True, exist_ok=True)
        master.save(str(ico_path), format="ICO", sizes=ICO_SIZES)
        print(f"Generated: {ico_path.relative_to(workspace)} ({len(ICO_SIZES)} sizes)")


if __name__ == "__main__":
    main()

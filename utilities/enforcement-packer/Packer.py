import os
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent
PNG_ICON = ROOT / "MY_vert-Photoroom.png"
ICO_ICON = ROOT / "myriad.ico"


def ensure_icon():
    if ICO_ICON.exists():
        print(f"[OK] icon exists: {ICO_ICON}")
        return
    if not PNG_ICON.exists():
        print(f"[WARN] png not found: {PNG_ICON}")
        return
    try:
        from PIL import Image
        img = Image.open(PNG_ICON).convert("RGBA")
        img.save(
            ICO_ICON,
            format="ICO",
            sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
        )
        print(f"[OK] icon created: {ICO_ICON}")
    except Exception as e:
        print(f"[WARN] icon conversion failed: {e}")


def main():
    ensure_icon()
    sep = os.pathsep

    args = [
        str(ROOT / "MYRIAD_Online_Enforcement_Tools.py"),
        "--noconfirm",
        "--clean",
        "--onedir",
        "--noconsole",
        "--name=MYRIAD_Enforcement_Tools",

        f"--add-data={ROOT / 'Auction_VeRO_Macro.py'}{sep}.",
        f"--add-data={ROOT / 'Gmarket_VeRO_Macro.py'}{sep}.",
        f"--add-data={ROOT / 'VeRO_Automation_Launcher.py'}{sep}.",
        f"--add-data={ROOT / 'NaverAutomationLauncher.py'}{sep}.",
        f"--add-data={ROOT / 'Image_Crawler.py'}{sep}.",
        f"--add-data={ROOT / 'Image_Uploader.py'}{sep}.",
        f"--add-data={ROOT / 'MY_vert-Photoroom.png'}{sep}.",
        f"--add-data={ROOT / '2025_수동입력_template_업로드용.xlsm'}{sep}.",

        "--hidden-import=tkinter.scrolledtext",
        "--hidden-import=tkinter.simpledialog",
        "--hidden-import=PIL.ImageTk",
        "--hidden-import=selenium",
        "--hidden-import=undetected_chromedriver",
        "--hidden-import=pandas",
        "--hidden-import=openpyxl",
        "--hidden-import=requests",
        "--hidden-import=PIL",

        "--collect-submodules=tkinter",
        "--collect-submodules=pandas",
        "--collect-submodules=openpyxl",
        "--collect-submodules=selenium",
        "--collect-submodules=undetected_chromedriver",
        "--collect-submodules=requests",
    ]

    if ICO_ICON.exists():
        args.append(f"--icon={ICO_ICON}")

    PyInstaller.__main__.run(args)


if __name__ == "__main__":
    main()

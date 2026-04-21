# -*- coding: utf-8 -*-
"""Windows 시작프로그램 폴더에 런처 바로가기 등록/해제."""
import os
import subprocess
import sys
from pathlib import Path

STARTUP_FOLDER = (
    Path(os.environ.get("APPDATA", "")) /
    "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
)
SHORTCUT_PATH = STARTUP_FOLDER / "MYRIAD Launcher.lnk"


def _target_and_args() -> tuple[str, str, str]:
    """실행 대상 (exe/pythonw), 인자, 작업 디렉토리."""
    if getattr(sys, "frozen", False):
        # PyInstaller 로 빌드된 EXE
        target = sys.executable
        args = ""
        working = str(Path(target).parent)
    else:
        # 개발 모드: pythonw.exe (콘솔 안 뜸) + 스크립트 경로
        here = Path(__file__).resolve().parent
        pythonw = Path(sys.executable).parent / "pythonw.exe"
        target = str(pythonw if pythonw.exists() else sys.executable)
        args = f'"{here / "myriad_launcher.py"}"'
        working = str(here)
    return target, args, working


def is_autostart_installed() -> bool:
    return SHORTCUT_PATH.exists()


def install_autostart() -> None:
    STARTUP_FOLDER.mkdir(parents=True, exist_ok=True)
    target, args, working = _target_and_args()

    # PowerShell 로 .lnk 파일 생성 (pywin32 의존 회피)
    ps = (
        "$s = New-Object -ComObject WScript.Shell; "
        f'$sc = $s.CreateShortcut("{SHORTCUT_PATH}"); '
        f'$sc.TargetPath = "{target}"; '
        f"$sc.Arguments = '{args}'; "
        f'$sc.WorkingDirectory = "{working}"; '
        "$sc.WindowStyle = 7; "  # 7 = 최소화 상태로 시작
        "$sc.Save()"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def uninstall_autostart() -> None:
    if SHORTCUT_PATH.exists():
        SHORTCUT_PATH.unlink()

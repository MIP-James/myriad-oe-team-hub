# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec - MYRIAD Extension Installer (onefile, windowed).

Small tkinter app, no heavy deps -> onefile is fine (cold start ~1-2s).
truststore/certifi bundled for corporate SSL-inspection proxies (gotcha #13).
"""
import os
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("truststore", "certifi"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:
        print(f"[spec] collect_all({pkg}) skipped: {e}")

if os.path.exists("installer.ico"):
    datas.append(("installer.ico", "."))

a = Analysis(
    ["ext_installer.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    runtime_hooks=[],
    excludes=["PIL", "numpy", "httpx", "pystray", "winotify"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name="MYRIAD_Extension_Installer",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon="installer.ico" if os.path.exists("installer.ico") else None,
)

# -*- coding: utf-8 -*-
"""유틸리티 자동 다운로드 & 로컬 설치 관리.

파일 위치:
  %LOCALAPPDATA%\\MyriadLauncher\\tools\\<slug>\\
    .version             ← 현재 설치된 버전 마커
    (압축 해제된 유틸 파일들)

플로우:
  ensure_installed(utility) → 이미 같은 버전이면 경로 반환 / 아니면 download + extract
"""
from __future__ import annotations

import logging
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Optional


def tools_root() -> Path:
    """%LOCALAPPDATA%\\MyriadLauncher\\tools (Windows) 또는 ~/.local/share/..."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    else:
        base = Path.home() / ".local" / "share"
    d = base / "MyriadLauncher" / "tools"
    d.mkdir(parents=True, exist_ok=True)
    return d


def tool_dir(slug: str) -> Path:
    return tools_root() / slug


def _version_marker(slug: str) -> Path:
    return tool_dir(slug) / ".version"


def get_installed_version(slug: str) -> Optional[str]:
    m = _version_marker(slug)
    if not m.exists():
        return None
    try:
        return m.read_text(encoding="utf-8").strip() or None
    except Exception:
        return None


def _write_version(slug: str, version: str) -> None:
    _version_marker(slug).write_text(version or "", encoding="utf-8")


def _resolve_exe(target_dir: Path, entry_exe: Optional[str]) -> Path:
    """설치 폴더 기준으로 실제 실행할 EXE 경로 반환."""
    if entry_exe:
        p = target_dir / entry_exe
        if p.exists():
            return p
        raise FileNotFoundError(
            f"entry_exe '{entry_exe}' 가 {target_dir} 안에 없습니다. 압축 내용 확인 필요."
        )
    # 엔트리 미지정이면 톱 레벨 .exe 중 하나, 없으면 재귀 탐색
    exes = list(target_dir.glob("*.exe"))
    if not exes:
        exes = list(target_dir.rglob("*.exe"))
    if not exes:
        raise FileNotFoundError(f"{target_dir} 안에 .exe 파일을 찾지 못했습니다.")
    return exes[0]


def ensure_installed(
    utility: dict,
    progress_cb: Optional[Callable[[str], None]] = None,
) -> Path:
    """utility = { slug, download_url, current_version, entry_exe, name }.

    반환: 실행할 EXE 의 절대경로.
    """
    slug = utility["slug"]
    name = utility.get("name") or slug
    url = utility.get("download_url")
    version = utility.get("current_version") or "unknown"
    entry_exe = utility.get("entry_exe")

    target = tool_dir(slug)

    # 이미 같은 버전 설치돼 있으면 스킵
    installed = get_installed_version(slug)
    if installed == version and target.exists() and any(target.iterdir()):
        try:
            return _resolve_exe(target, entry_exe)
        except FileNotFoundError as e:
            # 손상됐으면 재설치
            logging.warning(f"[tools] {slug} 재설치 필요: {e}")

    if not url:
        raise RuntimeError(
            f"'{name}' 의 다운로드 URL 이 웹 관리자 페이지에 등록되지 않았습니다."
        )

    # 기존 파일 정리
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True, exist_ok=True)

    if progress_cb:
        progress_cb(f"'{name}' 다운로드 중...")
    logging.info(f"[tools] downloading {url} → {target}")

    tmp_file = target / "_download.tmp"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            downloaded = 0
            last_pct = -10
            chunk = 256 * 1024
            with open(tmp_file, "wb") as f:
                while True:
                    data = resp.read(chunk)
                    if not data:
                        break
                    f.write(data)
                    downloaded += len(data)
                    if progress_cb and total:
                        pct = int(downloaded * 100 / total)
                        if pct >= last_pct + 10:  # 10% 단위로만 업데이트
                            progress_cb(
                                f"'{name}' 다운로드 {pct}% "
                                f"({downloaded // 1024 // 1024}MB / {total // 1024 // 1024}MB)"
                            )
                            last_pct = pct
    except Exception as e:
        shutil.rmtree(target, ignore_errors=True)
        raise RuntimeError(f"다운로드 실패: {e}")

    # ZIP 이면 풀기, 아니면 단일 EXE 로 저장
    is_zip = url.lower().endswith(".zip") or zipfile.is_zipfile(tmp_file)
    if is_zip:
        if progress_cb:
            progress_cb(f"'{name}' 압축 해제 중...")
        try:
            with zipfile.ZipFile(tmp_file) as zf:
                zf.extractall(target)
        except Exception as e:
            shutil.rmtree(target, ignore_errors=True)
            raise RuntimeError(f"압축 해제 실패: {e}")
        tmp_file.unlink(missing_ok=True)
    else:
        # 단일 실행파일 — entry_exe 이름으로 리네임 (없으면 slug.exe)
        final_name = entry_exe or f"{slug}.exe"
        final = target / final_name
        final.parent.mkdir(parents=True, exist_ok=True)
        tmp_file.rename(final)

    _write_version(slug, version)

    if progress_cb:
        progress_cb(f"'{name}' 설치 완료 (v{version})")

    return _resolve_exe(target, entry_exe)


def open_tools_folder() -> None:
    """트레이 메뉴에서 호출할 수 있음 — 설치 폴더 탐색기로 열기."""
    d = tools_root()
    d.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(d))  # type: ignore[attr-defined]

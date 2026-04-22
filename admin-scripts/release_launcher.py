# -*- coding: utf-8 -*-
"""
MYRIAD Launcher 자체를 GitHub Releases 에 배포하는 스크립트.

- utilities/launcher/dist/ 의 MyriadLauncher.exe + MyriadSetup.exe 를
  MyriadLauncher.zip 으로 묶어서 'launcher-latest' 태그에 업로드.
- 기존 'launcher-latest' 태그 있으면 자동 덮어씀 (--replace 기본).

사용:
  python release_launcher.py
  python release_launcher.py --notes "트레이 UX 개선"
  python release_launcher.py --version 0.3.0 --notes "...."
"""
from __future__ import annotations

import argparse
import datetime
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
DIST_DIR = REPO_ROOT / "utilities" / "launcher" / "dist"

RELEASE_TAG = "launcher-latest"
ZIP_NAME = "MyriadLauncher.zip"
REQUIRED_EXES = ["MyriadLauncher.exe", "MyriadSetup.exe"]


def _setup_console_encoding():
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
    except Exception:
        pass
    for name in ("stdout", "stderr"):
        s = getattr(sys, name, None)
        if s is None:
            continue
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_setup_console_encoding()


def load_release_config() -> dict:
    p = HERE / "release_config.json"
    if not p.exists():
        raise SystemExit(f"[오류] release_config.json 이 없습니다: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def verify_dist() -> list[Path]:
    missing = []
    found = []
    for fn in REQUIRED_EXES:
        p = DIST_DIR / fn
        if not p.exists():
            missing.append(fn)
        else:
            found.append(p)
    if missing:
        raise SystemExit(
            f"[오류] 다음 파일이 없습니다 — 먼저 build.bat 을 완료하세요:\n"
            + "\n".join(f"  - {DIST_DIR / m}" for m in missing)
        )
    return found


def make_zip(sources: list[Path], output: Path) -> None:
    print(f"  ZIP 생성: {output.name}")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for src in sources:
            zf.write(src, arcname=src.name)
    size_mb = output.stat().st_size / 1024 / 1024
    print(f"  ✓ {size_mb:.1f} MB ({len(sources)} files)")


def gh_check() -> None:
    if shutil.which("gh") is None:
        raise SystemExit(
            "[오류] GitHub CLI 필요: `winget install GitHub.cli` + `gh auth login`"
        )


def gh_upload(tag: str, title: str, notes: str, zip_path: Path, repo: str) -> str:
    # 기존 태그 있으면 삭제 후 재생성 (URL 유지)
    r = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo],
        capture_output=True, text=True,
    )
    if r.returncode == 0:
        print(f"  기존 릴리즈 삭제: {tag}")
        subprocess.run(
            ["gh", "release", "delete", tag, "--yes", "--cleanup-tag", "--repo", repo],
            check=True, capture_output=True, text=True,
        )

    print(f"  GitHub 업로드: tag={tag}")
    r = subprocess.run(
        [
            "gh", "release", "create", tag, str(zip_path),
            "--title", title,
            "--notes", notes,
            "--latest=false",  # 유틸 릴리즈와 분리, "latest" 플래그 싸움 방지
            "--repo", repo,
        ],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"[오류] gh release 실패:\n{r.stderr}")
    url = ""
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("https://"):
            url = line
    print(f"  ✓ 릴리즈 URL: {url}")
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="MyriadLauncher 릴리즈 업로드")
    parser.add_argument(
        "--version", help="버전 문자열 (기본: 오늘 날짜 YYYY-MM-DD)"
    )
    parser.add_argument("--notes", default="런처 업데이트", help="릴리즈 노트")
    args = parser.parse_args()

    version = args.version or datetime.date.today().isoformat()

    rel_cfg = load_release_config()
    repo = rel_cfg["github_repo"]

    print("=" * 60)
    print(f"  MYRIAD Launcher 릴리즈 → {RELEASE_TAG}")
    print("=" * 60)
    print(f"  version: {version}")
    print(f"  notes:   {args.notes}")
    print(f"  repo:    {repo}")
    print()

    gh_check()
    sources = verify_dist()
    print(f"  대상 파일: {[s.name for s in sources]}")

    title = f"MYRIAD Launcher v{version}"
    notes = f"{args.notes}\n\nBuild: {version}"

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / ZIP_NAME
        make_zip(sources, zip_path)
        release_url = gh_upload(RELEASE_TAG, title, notes, zip_path, repo)

    download_url = (
        f"https://github.com/{repo}/releases/download/{RELEASE_TAG}/{ZIP_NAME}"
    )

    print()
    print("=" * 60)
    print("  ✓ 완료")
    print("=" * 60)
    print(f"  Release:       {release_url}")
    print(f"  Download URL:  {download_url}")
    print()
    print("웹 /launcher 페이지의 다운로드 버튼이 자동으로 이 URL 을 씁니다.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n취소됨.")
        sys.exit(130)
    except SystemExit:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\n[치명적 오류] {e}")
        sys.exit(1)

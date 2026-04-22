# -*- coding: utf-8 -*-
"""
MYRIAD 유틸 릴리즈 자동화 (관리자 전용).

한 번의 명령으로:
  1. 로컬 유틸 폴더를 ZIP 압축
  2. GitHub Releases 에 새 릴리즈 + ZIP 업로드 (gh CLI 사용)
  3. Supabase `utilities` 테이블의 download_url / current_version / release_notes 갱신

팀원 PC 의 런처는 다음 실행 시 current_version 변경을 감지하고 자동 재다운로드합니다.

사용법:
  python release.py <slug>
  python release.py <slug> "변경 노트"
  python release.py <slug> --version 2026-04-22 --notes "버그 수정"
  python release.py <slug> --replace     # 같은 태그 덮어쓰기

  예:
    python release.py myriad-enforcement-tools
    python release.py report-generator "CSV 파싱 수정"

설정:
  release_config.json    유틸 slug → 로컬 폴더 매핑
  Supabase 토큰은 런처의 config.json 을 재사용합니다
  (utilities/launcher/config.json 또는 utilities/launcher/dist/config.json)
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


def _setup_console_encoding():
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    for stream in ("stdout", "stderr"):
        s = getattr(sys, stream, None)
        if s is None:
            continue
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_setup_console_encoding()


# ---------------------------------------------------------------- 설정 로드

def load_release_config() -> dict:
    p = HERE / "release_config.json"
    if not p.exists():
        raise SystemExit(f"[오류] release_config.json 이 없습니다: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def _launcher_config_path() -> Path:
    candidates = [
        REPO_ROOT / "utilities" / "launcher" / "dist" / "config.json",
        REPO_ROOT / "utilities" / "launcher" / "config.json",
    ]
    for p in candidates:
        if p.exists():
            return p
    raise SystemExit(
        "[오류] 런처 config.json 을 찾지 못했습니다.\n"
        "  utilities/launcher/ 또는 utilities/launcher/dist/ 에\n"
        "  MyriadSetup 을 먼저 실행해서 설정을 완료하세요."
    )


def load_launcher_config() -> dict:
    """런처 설정에서 Supabase 토큰 재사용 (관리자 본인 계정)."""
    return json.loads(_launcher_config_path().read_text(encoding="utf-8"))


def save_launcher_config(cfg: dict) -> None:
    p = _launcher_config_path()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    import os
    os.replace(tmp, p)


# ---------------------------------------------------------------- ZIP

def zip_source(source: Path, output: Path) -> None:
    """folder 를 ZIP — 최상위 폴더 포함 구조로 압축."""
    print(f"  ZIP 생성 중: {output.name}")
    file_count = 0
    with zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
    ) as zf:
        if source.is_file():
            zf.write(source, source.name)
            file_count = 1
        else:
            # 폴더 — 최상위 폴더 이름 포함 (source.parent 기준 상대 경로)
            for item in source.rglob("*"):
                if item.is_file():
                    arcname = item.relative_to(source.parent)
                    zf.write(item, arcname)
                    file_count += 1
    size_mb = output.stat().st_size / 1024 / 1024
    print(f"  ✓ {file_count}개 파일, {size_mb:.1f} MB")


# ---------------------------------------------------------------- GitHub

def gh_check() -> None:
    if shutil.which("gh") is None:
        raise SystemExit(
            "[오류] GitHub CLI (gh) 가 설치돼 있지 않습니다.\n"
            "  winget install GitHub.cli 로 설치 후 `gh auth login` 을 먼저 완료하세요."
        )


def gh_release_exists(tag: str, repo: str) -> bool:
    r = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def gh_release_delete(tag: str, repo: str) -> None:
    print(f"  기존 릴리즈 삭제: {tag}")
    subprocess.run(
        ["gh", "release", "delete", tag, "--yes", "--cleanup-tag", "--repo", repo],
        check=True,
        capture_output=True,
        text=True,
    )


def gh_release_create(
    tag: str, title: str, notes: str, zip_path: Path, repo: str
) -> str:
    print(f"  GitHub 업로드: tag={tag}")
    r = subprocess.run(
        [
            "gh", "release", "create", tag, str(zip_path),
            "--title", title,
            "--notes", notes,
            "--repo", repo,
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"[오류] gh release create 실패:\n{r.stderr}")
    url = ""
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("https://"):
            url = line
    print(f"  ✓ 릴리즈 생성: {url}")
    return url


# ---------------------------------------------------------------- Supabase

def _load_env_file(path: Path) -> dict:
    """매우 단순한 .env 파서 (KEY=value 한 줄당)."""
    out = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _get_service_role_key() -> str | None:
    """우선순위: 환경변수 > admin-scripts/.env 파일."""
    import os
    k = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if k:
        return k
    env = _load_env_file(HERE / ".env")
    return env.get("SUPABASE_SERVICE_ROLE_KEY")


def update_supabase(
    slug: str,
    util_cfg: dict,
    download_url: str,
    version: str,
    notes: str,
    entry_exe: str | None,
    launcher_cfg: dict,
) -> None:
    try:
        from supabase import create_client
    except ImportError:
        raise SystemExit(
            "[오류] supabase 모듈 필요: pip install supabase"
        )

    sb = launcher_cfg["supabase"]
    service_key = _get_service_role_key()

    if service_key:
        # Service Role 키 사용 — 런처/웹 세션과 충돌 없이 동작
        print("  인증: Supabase Service Role 키")
        client = create_client(sb["url"], service_key)
    else:
        # Fallback: 런처의 사용자 세션 토큰
        print("  인증: 런처 사용자 세션 (런처가 꺼져있어야 안전)")
        client = create_client(sb["url"], sb["anon_key"])
        try:
            client.auth.set_session(sb["access_token"], sb["refresh_token"])
        except Exception as e:
            msg = str(e)
            if "Already Used" in msg or "refresh_token" in msg.lower():
                raise SystemExit(
                    "[오류] Supabase 토큰이 이미 소비된 상태입니다.\n\n"
                    "  원인: 런처가 돌면서 refresh token 을 먼저 회전시켰거나,\n"
                    "        웹 세션도 만료됨.\n\n"
                    "  권장 해결책 (영구적):\n"
                    "    admin-scripts/.env 에 SUPABASE_SERVICE_ROLE_KEY 설정\n"
                    "    (Supabase Dashboard → Settings → API → service_role 키)\n"
                    "    .env.example 파일 참고.\n\n"
                    "  임시 해결 (매번 번거로움):\n"
                    "    1) 런처 종료\n"
                    "    2) 웹 로그아웃 → 재로그인\n"
                    "    3) 새 토큰 발급 → MyriadSetup 으로 적용\n"
                    "    4) release.bat 재실행"
                )
            raise

    print(f"  Supabase upsert 중 (slug={slug})")

    # 기존 행 존재 여부 확인
    existing = client.table("utilities").select("id").eq("slug", slug).execute()

    utype = util_cfg.get("utility_type", "executable")
    update_payload = {
        "download_url": download_url,
        "current_version": version,
        "release_notes": notes,
        "utility_type": utype,
    }
    if entry_exe:
        update_payload["entry_exe"] = entry_exe
    elif utype == "download_only":
        # download_only 는 entry_exe null 로 명시 (이전 값 삭제)
        update_payload["entry_exe"] = None

    if existing.data:
        # UPDATE
        (
            client.table("utilities")
            .update(update_payload)
            .eq("slug", slug)
            .execute()
        )
        print(f"  ✓ UPDATE: current_version={version}, type={utype}")
    else:
        # INSERT — 새 유틸 자동 등록
        insert_payload = dict(update_payload)
        insert_payload["slug"] = slug
        insert_payload["name"] = util_cfg.get("display_name", slug)
        insert_payload["icon"] = util_cfg.get("icon")
        insert_payload["category"] = util_cfg.get("category")
        insert_payload["description"] = util_cfg.get("description")
        insert_payload["is_active"] = True
        insert_payload["sort_order"] = util_cfg.get("sort_order", 100)
        client.table("utilities").insert(insert_payload).execute()
        print(f"  ✓ INSERT (신규 유틸 생성): slug={slug}, type={utype}")

    # 회전된 토큰을 launcher config 에 저장해서 다음 실행에 사용
    try:
        new_sess = client.auth.get_session()
        if new_sess and new_sess.access_token:
            if (
                sb.get("access_token") != new_sess.access_token
                or sb.get("refresh_token") != new_sess.refresh_token
            ):
                launcher_cfg["supabase"]["access_token"] = new_sess.access_token
                launcher_cfg["supabase"]["refresh_token"] = new_sess.refresh_token
                save_launcher_config(launcher_cfg)
                print("  ✓ 회전된 토큰을 config.json 에 저장 (다음 실행 준비)")
    except Exception as e:
        print(f"  [경고] 토큰 저장 스킵: {e}")


# ---------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(
        description="MYRIAD 유틸 릴리즈 업로드 + DB 업데이트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("slug", help="유틸 slug (release_config.json 참조)")
    parser.add_argument(
        "notes_positional",
        nargs="?",
        default=None,
        help="변경 노트 (positional, --notes 대신 축약)",
    )
    parser.add_argument(
        "--version",
        help="버전 문자열 (기본: 오늘 날짜 YYYY-MM-DD)",
    )
    parser.add_argument(
        "--notes",
        help="변경 노트",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="같은 태그의 기존 릴리즈가 있으면 덮어씀 (삭제 후 재생성)",
    )
    args = parser.parse_args()

    notes = args.notes or args.notes_positional or "업데이트"
    version = args.version or datetime.date.today().isoformat()

    rel_cfg = load_release_config()
    repo = rel_cfg["github_repo"]
    utilities = rel_cfg["utilities"]

    if args.slug not in utilities:
        print(f"[오류] '{args.slug}' 가 release_config.json 에 없습니다.")
        print(f"  등록된 slug: {', '.join(utilities.keys())}")
        sys.exit(1)

    util = utilities[args.slug]
    source = Path(util["source_folder"])
    display_name = util.get("display_name", args.slug)
    exe_name = util.get("exe_name")  # 예: "Report_Generator.exe"

    if not source.exists():
        print(f"[오류] 원본 폴더/파일이 없습니다: {source}")
        sys.exit(1)

    # ZIP 은 폴더를 포함해서 압축하므로 entry_exe = "<folder>/<exe>"
    entry_exe = None
    if source.is_dir() and exe_name:
        entry_exe = f"{source.name}/{exe_name}"

    tag = f"{args.slug}-v{version}"
    title = f"{display_name} v{version}"
    zip_name = (source.name if source.is_dir() else source.stem) + ".zip"

    print("=" * 60)
    print(f"  {display_name} 릴리즈")
    print("=" * 60)
    print(f"  slug:      {args.slug}")
    print(f"  source:    {source}")
    print(f"  tag:       {tag}")
    print(f"  version:   {version}")
    print(f"  entry_exe: {entry_exe or '(자동탐지)'}")
    print(f"  notes:     {notes}")
    print()

    gh_check()

    # 기존 태그 처리
    if gh_release_exists(tag, repo):
        if args.replace:
            gh_release_delete(tag, repo)
        else:
            print(
                f"[오류] 이미 같은 태그({tag})의 릴리즈가 있습니다.\n"
                "  --replace 옵션으로 덮어쓰거나, --version 으로 다른 버전 지정하세요."
            )
            sys.exit(1)

    launcher_cfg = load_launcher_config()

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / zip_name
        zip_source(source, zip_path)
        release_url = gh_release_create(tag, title, notes, zip_path, repo)

    download_url = (
        f"https://github.com/{repo}/releases/download/{tag}/{zip_name}"
    )
    print(f"  다운로드 URL: {download_url}")

    update_supabase(args.slug, util, download_url, version, notes, entry_exe, launcher_cfg)

    print()
    print("=" * 60)
    print("  ✓ 완료")
    print("=" * 60)
    print(f"  릴리즈: {release_url}")
    print(
        "\n팀원 런처는 다음 '실행' 요청 시 새 버전을 자동 다운로드합니다."
    )


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

# -*- coding: utf-8 -*-
"""
MYRIAD Launcher 최초 설정 스크립트.

1. 웹에서 복사한 연결 토큰을 파싱해 Supabase 연결 정보를 저장합니다.
2. 이 PC의 이름을 입력받습니다.
3. 각 유틸리티의 로컬 EXE 경로를 선택적으로 입력받습니다.

재실행하면 기존 config 를 덮어씁니다 (유틸 경로만 갱신하려면 config.json 직접 편집 가능).
"""
import base64
import getpass  # noqa: F401 (향후 사용)
import json
import os
import sys
from pathlib import Path


def _setup_console_encoding():
    """Windows 한글 콘솔에서 UTF-8 출력이 깨지지 않도록 보정."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    for stream in ("stdout", "stderr", "stdin"):
        s = getattr(sys, stream, None)
        if s is None:
            continue
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_setup_console_encoding()

# 진단용: EXE 가 어디까지 진행됐는지 기록 (콘솔 출력이 깨져도 보이게)
_DIAG = Path(sys.executable).parent / "setup_diag.log" if getattr(sys, "frozen", False) \
    else Path(__file__).parent / "setup_diag.log"
try:
    with open(_DIAG, "w", encoding="utf-8") as f:
        f.write("setup started OK\n")
except Exception:
    pass

try:
    from supabase import create_client
except ImportError as e:
    print("[치명적 오류] supabase 모듈을 찾을 수 없습니다.")
    print(f"  원인: {e}")
    print()
    print("개발 모드:  pip install -r requirements.txt")
    print("EXE 모드:   관리자에게 재빌드 요청 (launcher 폴더의 build.bat 재실행)")
    try:
        input("\n종료하려면 엔터...")
    except Exception:
        pass
    sys.exit(1)

from config import CONFIG_PATH, load_config, save_config


BANNER = """
============================================================
  MYRIAD Launcher - 최초 설정
============================================================
이 스크립트는 config.json 을 생성합니다.
중단하려면 Ctrl+C.
"""


def parse_token(token: str) -> dict:
    """웹에서 복사한 myriadlauncher_v1:BASE64 문자열을 dict 로."""
    prefix = "myriadlauncher_v1:"
    token = token.strip()
    if not token.startswith(prefix):
        raise ValueError("토큰 형식이 잘못됐습니다. 'myriadlauncher_v1:' 으로 시작해야 합니다.")
    encoded = token[len(prefix):].strip()
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
        data = json.loads(decoded)
    except Exception as e:
        raise ValueError(f"토큰 디코딩 실패: {e}")
    required = {"url", "anon_key", "access_token", "refresh_token", "user_id", "email"}
    missing = required - data.keys()
    if missing:
        raise ValueError(f"토큰에 필수 정보 누락: {missing}")
    return data


def verify_session(parsed: dict) -> None:
    """실제로 Supabase 에 접속해서 토큰이 살아있는지 확인."""
    client = create_client(parsed["url"], parsed["anon_key"])
    client.auth.set_session(parsed["access_token"], parsed["refresh_token"])
    user = client.auth.get_user()
    if not user or not user.user:
        raise RuntimeError("토큰으로 사용자를 찾을 수 없습니다.")
    if user.user.email.lower() != parsed["email"].lower():
        raise RuntimeError("토큰의 이메일과 실제 사용자가 일치하지 않습니다.")


def load_utilities(parsed: dict) -> list[dict]:
    """현재 DB 에 등록된 is_active=true 유틸 목록."""
    client = create_client(parsed["url"], parsed["anon_key"])
    client.auth.set_session(parsed["access_token"], parsed["refresh_token"])
    resp = (
        client.table("utilities")
        .select("slug,name,icon,description")
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    return resp.data or []


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    val = input(f"{prompt}{suffix}: ").strip()
    return val or default


def main():
    print(BANNER)

    existing = {}
    if CONFIG_PATH.exists():
        print(f"기존 설정 파일 발견: {CONFIG_PATH}")
        ans = ask("덮어쓸까요? (y/N)", "N")
        if ans.lower() != "y":
            print("취소했습니다.")
            sys.exit(0)
        try:
            existing = load_config()
        except Exception:
            pass

    # 1. 토큰
    print("\n[1/2] 웹 대시보드의 '내 런처' 메뉴에서 발급받은 연결 토큰을 붙여넣으세요.")
    print("     (myriadlauncher_v1: 로 시작하는 긴 문자열)")
    token_raw = input("토큰: ").strip()
    try:
        parsed = parse_token(token_raw)
    except ValueError as e:
        print(f"[오류] {e}")
        sys.exit(1)
    print(f"  ✓ 파싱 성공: {parsed['email']}")

    print("  서버 접속 검증 중...")
    try:
        verify_session(parsed)
    except Exception as e:
        print(f"[오류] 토큰이 유효하지 않습니다: {e}")
        print("       웹에서 토큰을 재발급 후 다시 시도하세요.")
        sys.exit(1)
    print("  ✓ 검증 완료")

    # 2. 디바이스 이름
    print("\n[2/2] 이 PC를 웹 대시보드에 어떻게 표시할지 이름을 지정하세요.")
    default_name = existing.get("device_name") or f"{parsed['email'].split('@')[0]} PC"
    device_name = ask("디바이스 이름", default_name)

    # 유틸 경로는 더 이상 물어보지 않음 — 런처가 DB에서 가져와 자동 다운로드.
    # 단, 기존 설정에 수동 경로가 있었다면 그대로 유지 (power user override).
    utility_paths = dict(existing.get("utility_paths", {}))
    if utility_paths:
        print("\n(기존 수동 유틸 경로 설정 유지됨 — config.json 에서 직접 편집 가능)")

    print("\n유틸리티 자동 다운로드: 실행 요청 시 런처가 최초 1회 자동 설치합니다.")
    print("  (설치 경로: %LOCALAPPDATA%\\MyriadLauncher\\tools\\)")

    # 저장
    config = {
        "supabase": {
            "url": parsed["url"],
            "anon_key": parsed["anon_key"],
            "access_token": parsed["access_token"],
            "refresh_token": parsed["refresh_token"],
        },
        "device_id": existing.get("device_id"),  # myriad_launcher.py 가 최초 실행 시 생성
        "device_name": device_name,
        "user_email": parsed["email"],
        "utility_paths": utility_paths,
    }
    save_config(config)
    print(f"\n✓ 설정 저장됨: {CONFIG_PATH}")
    print("\n이제 다음 명령으로 런처를 실행하세요:")
    print("  python myriad_launcher.py")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n취소됨.")
        sys.exit(0)
    except Exception as e:
        # EXE 로 빌드된 경우 콘솔이 순식간에 닫혀서 에러를 못 보는 문제 방지
        print(f"\n[치명적 오류] {e}")
        import traceback
        traceback.print_exc()
        try:
            input("\n종료하려면 엔터...")
        except Exception:
            pass
        sys.exit(1)

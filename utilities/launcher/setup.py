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
import sys
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("[오류] supabase 패키지 설치 필요: pip install -r requirements.txt")
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
    print("\n[1/3] 웹 대시보드의 '내 런처' 메뉴에서 발급받은 연결 토큰을 붙여넣으세요.")
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
    print("\n[2/3] 이 PC를 웹 대시보드에 어떻게 표시할지 이름을 지정하세요.")
    default_name = existing.get("device_name") or f"{parsed['email'].split('@')[0]} PC"
    device_name = ask("디바이스 이름", default_name)

    # 3. 유틸 경로
    print("\n[3/3] 각 유틸리티의 로컬 EXE 경로를 입력하세요.")
    print("     입력 안 하면 해당 유틸은 실행 요청 시 '경로 미설정' 오류로 표시됩니다.")
    print("     나중에 config.json 을 직접 편집해서 추가할 수도 있습니다.")

    utilities = []
    try:
        utilities = load_utilities(parsed)
    except Exception as e:
        print(f"[경고] 유틸 목록 조회 실패: {e}")

    utility_paths = dict(existing.get("utility_paths", {}))
    if utilities:
        for u in utilities:
            slug = u["slug"]
            name = u["name"]
            icon = u.get("icon") or ""
            current = utility_paths.get(slug, "")
            print(f"\n  {icon} {name} ({slug})")
            if current:
                print(f"     현재: {current}")
            path = ask("     EXE 경로 (없으면 엔터)", current)
            if path:
                if not Path(path).exists():
                    print(f"     [경고] 파일을 찾을 수 없지만 일단 저장합니다: {path}")
                utility_paths[slug] = path
            elif slug in utility_paths:
                del utility_paths[slug]
    else:
        print("  (등록된 유틸이 없어 스킵)")

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

# -*- coding: utf-8 -*-
"""
MYRIAD Launcher 최초 설정 스크립트 (v2 — Bearer token).

1. 웹 허브 /launcher 페이지에서 발급받은 opaque 토큰 (myrlnch_...) paste
2. 서버에 첫 폴 호출로 토큰 검증 + 디바이스 페어링
3. 이 PC 의 표시 이름 입력
4. config.json 저장

재실행하면 기존 config 를 덮어씁니다.

v1 (supabase session 기반) 으로부터 마이그레이션:
    - 옛 config.json 의 supabase / access_token / refresh_token 등 모두 폐기
    - device_name / utility_paths 만 보존 (사용자 입력 유지)
"""
import json
import sys
from pathlib import Path


def _setup_console_encoding():
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

_DIAG = Path(sys.executable).parent / "setup_diag.log" if getattr(sys, "frozen", False) \
    else Path(__file__).parent / "setup_diag.log"
try:
    with open(_DIAG, "w", encoding="utf-8") as f:
        f.write("setup v2 started OK\n")
except Exception:
    pass

try:
    import httpx
except ImportError as e:
    print("[치명적 오류] httpx 모듈을 찾을 수 없습니다.")
    print(f"  원인: {e}")
    print()
    print("개발 모드:  pip install -r requirements.txt")
    print("EXE 모드:   관리자에게 재빌드 요청 (launcher 폴더의 build.bat 재실행)")
    try:
        input("\n종료하려면 엔터...")
    except Exception:
        pass
    sys.exit(1)

from config import CONFIG_PATH, load_config, save_config, DEFAULT_API_BASE_URL


BANNER = """
============================================================
  MYRIAD Launcher - 최초 설정 (v2)
============================================================
이 스크립트는 config.json 을 생성합니다.
중단하려면 Ctrl+C.
"""


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    val = input(f"{prompt}{suffix}: ").strip()
    return val or default


def verify_token(api_base_url: str, token: str, device_name: str) -> dict:
    """서버에 첫 poll 호출로 토큰 검증 + 디바이스 페어링.

    반환: { device_id, paired_now, jobs }
    실패 시 RuntimeError.
    """
    url = api_base_url.rstrip("/") + "/api/launcher-poll"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "MyriadSetup/v2",
    }
    body = {
        "device_name": device_name,
        "platform": sys.platform,
        "launcher_version": "setup-v2",
    }
    try:
        with httpx.Client(timeout=15.0) as c:
            resp = c.post(url, headers=headers, json=body)
    except httpx.RequestError as e:
        raise RuntimeError(f"네트워크 오류: {e}")
    if resp.status_code == 401:
        try:
            err = resp.json().get("error", "")
        except Exception:
            err = resp.text[:200]
        raise RuntimeError(f"토큰 인증 실패: {err}")
    if resp.status_code >= 400:
        try:
            err = resp.json().get("error", "")
        except Exception:
            err = resp.text[:200]
        raise RuntimeError(f"HTTP {resp.status_code}: {err}")
    try:
        return resp.json()
    except Exception:
        raise RuntimeError("서버 응답 JSON 파싱 실패")


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
    print("\n[1/2] 웹 허브 '내 런처' 페이지에서 발급받은 토큰을 붙여넣으세요.")
    print("     (myrlnch_ 로 시작하는 64자+ 문자열)")
    print()
    print("     아직 발급 안 했으면:")
    print("     https://myriad-oe-team-hub.pages.dev/launcher → '새 토큰 발급'")
    print()
    token = input("토큰: ").strip()
    if not token.startswith("myrlnch_") or len(token) < 70:
        print(f"[오류] 토큰 형식이 잘못됐습니다 (myrlnch_ 로 시작 + 64자 hex).")
        sys.exit(1)

    # 2. 디바이스 이름
    print("\n[2/2] 이 PC 를 웹 대시보드에 어떻게 표시할지 이름을 지정하세요.")
    default_name = existing.get("device_name") or "내 PC"
    device_name = ask("디바이스 이름", default_name)

    # 토큰 검증 + 첫 페어링
    print("\n서버 접속 검증 중...")
    api_base_url = existing.get("api_base_url") or DEFAULT_API_BASE_URL
    try:
        result = verify_token(api_base_url, token, device_name)
    except Exception as e:
        print(f"[오류] {e}")
        print()
        print("가능한 원인:")
        print(" - 토큰을 잘못 복사했거나 일부 잘림")
        print(" - 토큰이 회수된 상태 (웹 허브에서 재발급 필요)")
        print(" - 네트워크 연결 문제 (회사 프록시/방화벽)")
        sys.exit(1)
    device_id = result.get("device_id")
    if not device_id:
        print("[오류] 서버 응답에 device_id 가 없습니다.")
        sys.exit(1)
    if result.get("paired_now"):
        print(f"  ✓ 페어링 완료: device_id={device_id[:8]}...")
    else:
        print(f"  ✓ 검증 완료 (기존 device 재연결): {device_id[:8]}...")

    # 유틸 경로 — 기존 수동 설정 유지
    utility_paths = dict(existing.get("utility_paths", {}))
    if utility_paths:
        print("\n(기존 수동 유틸 경로 설정 유지됨 — config.json 에서 직접 편집 가능)")

    print("\n유틸리티 자동 다운로드: 실행 요청 시 런처가 최초 1회 자동 설치합니다.")
    print("  (설치 경로: %LOCALAPPDATA%\\MyriadLauncher\\tools\\)")

    # 저장
    config = {
        "api_base_url": api_base_url,
        "api_token": token,
        "device_id": device_id,
        "device_name": device_name,
        "utility_paths": utility_paths,
    }
    save_config(config)
    print(f"\n✓ 설정 저장됨: {CONFIG_PATH}")
    print("\n이제 MyriadLauncher.exe (또는 myriad_launcher.py) 를 실행하세요.")
    print()
    print("✨ 새 인증 모델: 토큰은 회수하기 전까지 영구 유효 — 매일 깨지던 문제 해결.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n취소됨.")
        sys.exit(0)
    except Exception as e:
        print(f"\n[치명적 오류] {e}")
        import traceback
        traceback.print_exc()
        try:
            input("\n종료하려면 엔터...")
        except Exception:
            pass
        sys.exit(1)

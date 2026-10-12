# -*- coding: utf-8 -*-
"""공용 PC 에이전트 (Phase 24) — 원격 데스크톱 세션 상태를 허브에 보고.

실행: MyriadLauncher.exe --shared-pc-agent
  - 공용 PC 에서 SYSTEM 예약 작업(부팅 시 시작)으로 실행 → 아무도 로그인 안 해도 동작
  - 트레이/작업 실행 없음. 세션 보고만.
  - 설정: %ProgramData%\\MyriadLauncher\\agent.json  { api_base_url, api_token }
    (setup_shared_pc.ps1 이 공용 PC 런처의 config.json 토큰을 복사해 만듦)

동작:
  - 30초마다 WTS API 로 세션 조회 (PC 로컬 — 네트워크/비용 0)
  - (사용자, 상태) 또는 IP 가 바뀌었을 때 + 15분 keepalive 때만 서버 보고
  - 허브 미등록 PC 면 10분마다 재확인만

세션 조회는 quser 대신 WTS API 사용 — quser 는 한글 윈도우에서 출력이 현지화됨
(함정 #54: 현지화 = 조용한 전면 실패).
"""
import ctypes
import json
import logging
import os
import socket
import sys
import time
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path

CHECK_INTERVAL_SEC = 30
KEEPALIVE_SEC = 15 * 60
UNREGISTERED_RECHECK_SEC = 10 * 60

AGENT_DIR = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "MyriadLauncher"
AGENT_CONFIG_PATH = AGENT_DIR / "agent.json"
AGENT_LOG_PATH = AGENT_DIR / "agent.log"

# ── WTS API ────────────────────────────────────────────────────────────
WTS_CURRENT_SERVER_HANDLE = None
WTSActive = 0
WTSDisconnected = 4
WTSUserName = 5
WTSSessionInfo = 24


class WTS_SESSION_INFOW(ctypes.Structure):
    _fields_ = [
        ("SessionId", wintypes.DWORD),
        ("pWinStationName", wintypes.LPWSTR),
        ("State", ctypes.c_int),
    ]


class WTSINFOW(ctypes.Structure):
    _fields_ = [
        ("State", ctypes.c_int),
        ("SessionId", wintypes.DWORD),
        ("IncomingBytes", wintypes.DWORD),
        ("OutgoingBytes", wintypes.DWORD),
        ("IncomingFrames", wintypes.DWORD),
        ("OutgoingFrames", wintypes.DWORD),
        ("IncomingCompressedBytes", wintypes.DWORD),
        ("OutgoingCompressedBytes", wintypes.DWORD),
        ("WinStationName", wintypes.WCHAR * 32),
        ("Domain", wintypes.WCHAR * 17),
        ("UserName", wintypes.WCHAR * 21),
        ("ConnectTime", ctypes.c_longlong),
        ("DisconnectTime", ctypes.c_longlong),
        ("LastInputTime", ctypes.c_longlong),
        ("LogonTime", ctypes.c_longlong),
        ("CurrentTime", ctypes.c_longlong),
    ]


def _filetime_to_iso(ft: int) -> str | None:
    """FILETIME(1601 기준 100ns) → ISO8601 UTC. 0 이면 None."""
    if not ft or ft <= 0:
        return None
    try:
        secs = (ft - 116444736000000000) / 10_000_000
        return datetime.fromtimestamp(secs, tz=timezone.utc).isoformat()
    except Exception:
        return None


def list_sessions() -> list[dict]:
    """사용자가 붙어 있는 세션만 반환 (서비스/리스너 세션 제외)."""
    wtsapi = ctypes.WinDLL("wtsapi32")
    pinfo = ctypes.POINTER(WTS_SESSION_INFOW)()
    count = wintypes.DWORD()
    if not wtsapi.WTSEnumerateSessionsW(
        WTS_CURRENT_SERVER_HANDLE, 0, 1, ctypes.byref(pinfo), ctypes.byref(count)
    ):
        raise OSError(f"WTSEnumerateSessionsW failed: {ctypes.GetLastError()}")
    result = []
    try:
        for i in range(count.value):
            s = pinfo[i]
            if s.State not in (WTSActive, WTSDisconnected):
                continue
            user = _query_str(wtsapi, s.SessionId, WTSUserName)
            if not user:
                continue
            station = (s.pWinStationName or "").lower()
            info = _query_info(wtsapi, s.SessionId)
            result.append({
                "win_user": user,
                "state": "active" if s.State == WTSActive else "disconnected",
                "via": "console" if station == "console" else "rdp",
                "connected_at": _filetime_to_iso(info.ConnectTime) if info else None,
                "disconnected_at": _filetime_to_iso(info.DisconnectTime) if info else None,
                "logon_at": _filetime_to_iso(info.LogonTime) if info else None,
            })
    finally:
        wtsapi.WTSFreeMemory(pinfo)
    return result


def _query_str(wtsapi, session_id: int, info_class: int) -> str:
    buf = wintypes.LPWSTR()
    size = wintypes.DWORD()
    if not wtsapi.WTSQuerySessionInformationW(
        WTS_CURRENT_SERVER_HANDLE, session_id, info_class, ctypes.byref(buf), ctypes.byref(size)
    ):
        return ""
    try:
        return buf.value or ""
    finally:
        wtsapi.WTSFreeMemory(buf)


def _query_info(wtsapi, session_id: int) -> WTSINFOW | None:
    buf = ctypes.c_void_p()
    size = wintypes.DWORD()
    if not wtsapi.WTSQuerySessionInformationW(
        WTS_CURRENT_SERVER_HANDLE, session_id, WTSSessionInfo, ctypes.byref(buf), ctypes.byref(size)
    ):
        return None
    try:
        if size.value < ctypes.sizeof(WTSINFOW):
            return None
        return WTSINFOW.from_buffer_copy(ctypes.string_at(buf, ctypes.sizeof(WTSINFOW)))
    finally:
        wtsapi.WTSFreeMemory(buf)


def lan_ip() -> str | None:
    """기본 경로 인터페이스의 사내 IP. UDP connect 는 패킷을 보내지 않음."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            return None if ip.startswith("127.") else ip
    except Exception:
        return None


def _signature(sessions: list[dict], ip: str | None) -> str:
    """변경 감지용 — 시각은 제외하고 (사용자, 상태, 경로) + IP 만."""
    key = sorted((s["win_user"].lower(), s["state"], s["via"]) for s in sessions)
    return json.dumps([key, ip])


# ── 실행 루프 ───────────────────────────────────────────────────────────
def run_agent(launcher_version: str, default_api_base: str) -> int:
    AGENT_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(AGENT_LOG_PATH, encoding="utf-8")],
        force=True,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)  # 요청마다 INFO 로그 → 상태 변경만 남김
    logging.info(f"Shared PC agent v{launcher_version} starting")

    try:
        cfg = json.loads(AGENT_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logging.error(f"agent.json 읽기 실패 ({AGENT_CONFIG_PATH}): {e}")
        return 1
    token = cfg.get("api_token") or ""
    if not token.startswith("myrlnch_"):
        logging.error("agent.json 의 api_token 이 런처 토큰 형식이 아님")
        return 1
    base_url = (cfg.get("api_base_url") or default_api_base).rstrip("/")
    hostname = socket.gethostname().upper()

    import httpx
    client = httpx.Client(
        timeout=httpx.Timeout(20.0, connect=10.0),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": f"MyriadSharedPcAgent/{launcher_version}",
        },
    )

    last_sig = None
    last_sent = 0.0
    unregistered_until = 0.0
    while True:
        now = time.monotonic()
        try:
            sessions = list_sessions()
            ip = lan_ip()
            sig = _signature(sessions, ip)
            due = sig != last_sig or now - last_sent >= KEEPALIVE_SEC
            if due and now >= unregistered_until:
                resp = client.post(f"{base_url}/api/shared-pc-report", json={
                    "hostname": hostname,
                    "lan_ip": ip,
                    "sessions": sessions,
                    "agent_version": launcher_version,
                })
                if resp.status_code == 401:
                    logging.error(f"토큰 인증 실패 — agent.json 토큰 재설정 필요: {resp.text[:200]}")
                    return 2
                resp.raise_for_status()
                if resp.json().get("registered"):
                    if sig != last_sig:
                        logging.info(f"보고: ip={ip} sessions={[(s['win_user'], s['state']) for s in sessions]}")
                    last_sig, last_sent = sig, now
                else:
                    logging.info(f"허브에 미등록 PC ({hostname}) — 10분 후 재확인")
                    unregistered_until = now + UNREGISTERED_RECHECK_SEC
        except Exception as e:
            # 부팅 직후 네트워크 미준비 등 — 다음 주기에 재시도 (last_sig 유지 안 함)
            logging.warning(f"보고 실패: {e}")
        time.sleep(CHECK_INTERVAL_SEC)


if __name__ == "__main__":
    # 개발용: python shared_pc_agent.py --print  → 현재 세션만 출력
    if "--print" in sys.argv:
        print(json.dumps({"hostname": socket.gethostname(), "ip": lan_ip(), "sessions": list_sessions()},
                         ensure_ascii=False, indent=2))

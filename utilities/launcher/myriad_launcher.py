# -*- coding: utf-8 -*-
"""
MYRIAD Launcher - 시스템 트레이 아이콘 기반 백그라운드 런처.

최초 1회 setup.py 로 config.json 생성 후 이 스크립트(또는 빌드된 EXE)를 실행하세요.
콘솔 없이 트레이 아이콘만 뜨고, 웹에서 요청한 유틸 실행을 처리합니다.
"""
import atexit
import logging
import os
import platform
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

def _exe_dir() -> Path:
    """빌드된 EXE 기준(혹은 스크립트 기준) 폴더 — 로그 쓰기에 쓸 것."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _setup_console_encoding():
    """Windows 콘솔 인코딩을 UTF-8 로 (한글 출력 깨짐 방지)."""
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


def _hide_internal_dir():
    """onedir 런처의 _internal 폴더를 숨김 속성 처리.

    빌드 시 attrib +h 해도 ZIP 포맷이 Windows hidden attribute 를 보존하지
    않아 실무자 PC 에서 압축 해제 후 가시 상태로 돌아옴. 매 실행 시 자가
    검사해서 가시 상태면 숨김 부여 (idempotent — 이미 숨김이면 no-op).

    관리자 권한 불필요, 0.x 밀리초급 호출.
    """
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return
    try:
        import ctypes
        internal = Path(sys.executable).resolve().parent / "_internal"
        if not internal.exists():
            return
        FILE_ATTRIBUTE_HIDDEN = 0x02
        INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF
        GetAttrs = ctypes.windll.kernel32.GetFileAttributesW
        SetAttrs = ctypes.windll.kernel32.SetFileAttributesW
        attrs = GetAttrs(str(internal))
        if attrs == INVALID_FILE_ATTRIBUTES:
            return
        if not (attrs & FILE_ATTRIBUTE_HIDDEN):
            SetAttrs(str(internal), attrs | FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        # 숨김 실패해도 런처 기능엔 영향 없음 — 조용히 패스
        pass


_hide_internal_dir()


try:
    from supabase import create_client, Client
    # SyncClientOptions = ClientOptions + storage 필드 (sync client 에 필수).
    # 베이스 ClientOptions 만 넘기면 'no attribute storage' 에러 발생.
    from supabase.lib.client_options import SyncClientOptions
    import pystray
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
    # 콘솔이 없을 수 있으므로 파일로 기록 + 메시지박스
    try:
        err_log = _exe_dir() / "launcher_error.log"
        with open(err_log, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now()}: import 실패 - {e}\n")
    except Exception:
        pass
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk(); root.withdraw()
        messagebox.showerror(
            "MYRIAD Launcher - 실행 불가",
            f"필수 모듈을 찾을 수 없습니다:\n\n{e}\n\n"
            "같은 폴더의 launcher_error.log 를 관리자에게 전달해주세요."
        )
        root.destroy()
    except Exception:
        pass
    raise

from config import CONFIG_PATH, load_config, save_config
from autostart import install_autostart, uninstall_autostart, is_autostart_installed
from tools_manager import (
    ensure_installed, deliver_to_downloads, open_tools_folder, tools_root
)

# Windows 토스트 알림 (실패해도 동작엔 지장 없음)
try:
    from winotify import Notification, audio as _wn_audio  # type: ignore
    _HAS_TOAST = True
except Exception:
    _HAS_TOAST = False


def notify(title: str, message: str, success: bool = True) -> None:
    if not _HAS_TOAST:
        return
    try:
        n = Notification(
            app_id="MYRIAD Launcher",
            title=title,
            msg=message,
            duration="short",
        )
        try:
            n.set_audio(_wn_audio.Default, loop=False)
        except Exception:
            pass
        n.show()
    except Exception as e:
        logging.warning(f"Toast failed: {e}")

# release_launcher.py 의 default version (오늘 날짜 ISO) 와 형식 일치 →
# release 의 name = "MYRIAD Launcher v{LAUNCHER_VERSION}" 와 1:1 비교 가능.
# 새 빌드 배포할 때마다 이 줄을 오늘 날짜로 갱신하고 release_launcher.bat 실행.
LAUNCHER_VERSION = "2026-04-29"
POLL_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 30.0
MAX_OUTPUT_CHARS = 8000
# access_token 만료 X초 전이면 명시 refresh — supabase-py 자동 refresh 끈
# 상태에서 우리가 직접 갱신. heartbeat 주기(30초) 보다 크게 잡아야 다음
# heartbeat 까지 충분히 살아있음.
TOKEN_REFRESH_LEAD_SEC = 90.0
LOG_PATH = _exe_dir() / "launcher.log"

# GitHub Releases 의 launcher-latest 태그 — release_launcher.py 가 업로드.
# release name 에 박힌 버전 문자열을 LAUNCHER_VERSION 과 비교해서 신버전 감지.
GITHUB_REPO = "MIP-James/myriad-oe-team-hub"
RELEASE_TAG = "launcher-latest"
GITHUB_RELEASE_API_URL = (
    f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{RELEASE_TAG}"
)
LAUNCHER_DOWNLOAD_URL = (
    f"https://github.com/{GITHUB_REPO}/releases/download/{RELEASE_TAG}/MyriadLauncher.zip"
)
LAUNCHER_PAGE_URL = "https://myriad-oe-team-hub.pages.dev/launcher"


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8")],
    )


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_icon_image(online: bool = True) -> Image.Image:
    """트레이에 표시할 아이콘을 실시간 생성. 작은 사이즈에서도 또렷하도록 대비 강조."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 선명한 주황 (online) / 중간회색 (offline). 작게 보일 때 빠져보이지 않도록 진한 색.
    fill = (255, 140, 0, 255) if online else (120, 120, 120, 255)
    outline = (30, 30, 30, 255)
    # 원을 거의 꽉 차게 + 어두운 테두리
    draw.ellipse([1, 1, size - 1, size - 1], fill=fill, outline=outline, width=2)

    # 중앙 "M" — 검정색, 두껍게
    font = None
    for candidate in ("arialbd.ttf", "segoeuib.ttf", "malgunbd.ttf"):
        try:
            font = ImageFont.truetype(candidate, 40)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()
    try:
        bbox = draw.textbbox((0, 0), "M", font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(
            (size // 2 - w // 2 - bbox[0], size // 2 - h // 2 - bbox[1] - 2),
            "M",
            fill=(20, 20, 20, 255),
            font=font,
        )
    except Exception:
        draw.text((size // 2 - 10, size // 2 - 14), "M", fill=(20, 20, 20, 255))
    return img


def show_info(title: str, message: str):
    """정보 메시지 박스.

    pystray 메뉴 콜백 스레드에서 직접 MessageBoxW 를 호출하면 스레드의
    메시지 큐가 제대로 안 돌아 "확인" 버튼이 반응하지 않는 경우가 있다.
    별도 스레드에서 띄우면 해당 스레드가 자기 메시지 루프로 처리하므로 확실.
    """
    if sys.platform == "win32":
        import threading

        def _popup():
            try:
                import ctypes
                # MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST
                flags = 0x0 | 0x40 | 0x10000 | 0x40000
                ctypes.windll.user32.MessageBoxW(0, message, title, flags)
            except Exception as e:
                logging.warning(f"MessageBoxW failed: {e}")

        threading.Thread(target=_popup, daemon=True, name="msgbox").start()
        return

    # Fallback: tkinter (macOS/Linux 용)
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo(title, message)
        root.destroy()
    except Exception:
        pass


class Launcher:
    def __init__(self, config: dict):
        self.config = config
        self.stop_event = threading.Event()
        self.client: Client | None = None
        self.device_id: str | None = config.get("device_id")
        self.user_id: str | None = None
        self.status_text = "연결 중..."
        self.last_job_info = "(아직 없음)"
        self.online = False
        self.icon: pystray.Icon | None = None
        # heartbeat / poll 스레드가 만료 직후 동시에 supabase 호출 → 둘 다 401 →
        # supabase-py 자동 refresh 가 양쪽에서 동시 실행되며 refresh_token chain
        # 이 두 갈래로 갈라지는 race 방지. RLock 으로 handle_job 재진입 허용.
        self._sb_lock = threading.RLock()

    # ------------------------------------------------------------------
    # 초기화
    # ------------------------------------------------------------------
    def connect(self) -> bool:
        """Supabase 세션 복원.

        PC 를 껐다 켠 경우 저장된 access_token 은 보통 만료된 상태(기본 1시간).
        - 1차: set_session 으로 저장된 토큰 주입 후 get_user — access_token 이
          아직 유효하면 성공.
        - 2차: refresh_session(refresh_token) 으로 새 access_token 발급 시도.
          refresh_token 은 기본 수개월 유효하므로 보통 여기서 복구됨.
        """
        sb = self.config["supabase"]
        logging.info(f"Connecting to {sb['url']}")
        try:
            # 자동 refresh / 자체 persist 모두 비활성화 — 우리가 _maybe_refresh_token
            # 으로 명시 관리. supabase-py 백그라운드 thread 가 _sb_lock 우회해서
            # 동시 refresh 호출 → 같은 refresh_token 으로 두 번 요청 → 응답 도착
            # 순서 역전 시 invalidated chain 의 토큰이 저장되는 race 가 원인 (gotcha #12-D)
            self.client = create_client(
                sb["url"],
                sb["anon_key"],
                options=SyncClientOptions(
                    auto_refresh_token=False,
                    persist_session=False,
                ),
            )
        except Exception as e:
            logging.error(f"create_client failed: {e}")
            self.status_text = "Supabase 연결 실패"
            return False

        # supabase-py 내부 auto-refresh 는 refresh_token 을 rotate 하고 새 값을
        # 메모리에만 보관. 아래 리스너가 rotation 즉시 config.json 에 저장해서
        # 다음 부팅 시 stale token 으로 "Refresh Token Not Found" 나는 걸 차단.
        try:
            def _on_auth_change(event, session):
                try:
                    if not session or not getattr(session, "refresh_token", None):
                        return
                    sb2 = self.config["supabase"]
                    # 응답 도착 순서 ≠ 서버 발급 순서일 수 있어 단순 덮어쓰기는 위험.
                    # expires_at 으로 신선도 비교해서 오래된 토큰 저장 차단.
                    new_exp = getattr(session, "expires_at", None) or 0
                    cur_exp = sb2.get("expires_at") or 0
                    if new_exp and cur_exp and new_exp < cur_exp:
                        logging.info(
                            f"[auth] {event} — older token ignored "
                            f"(exp {new_exp} < {cur_exp})"
                        )
                        return
                    if sb2.get("refresh_token") == session.refresh_token:
                        return
                    sb2["access_token"] = session.access_token
                    sb2["refresh_token"] = session.refresh_token
                    if new_exp:
                        sb2["expires_at"] = new_exp
                    save_config(self.config)
                    logging.info(f"[auth] {event} — rotated token saved (exp {new_exp})")
                except Exception as ex:
                    logging.warning(f"auth_state_change save 실패: {ex}")
            self.client.auth.on_auth_state_change(_on_auth_change)
        except Exception as e:
            # 일부 supabase-py 버전에서 콜백 시그니처가 다를 수 있음 —
            # 실패해도 heartbeat_loop 의 폴링 persist 가 안전망으로 작동.
            logging.warning(f"on_auth_state_change 등록 실패: {e}")

        user_obj = None

        # 1차: 저장된 access_token 으로 세션 복원 시도
        try:
            self.client.auth.set_session(sb["access_token"], sb["refresh_token"])
            resp = self.client.auth.get_user()
            if resp and resp.user:
                user_obj = resp.user
        except Exception as e:
            logging.warning(f"set_session/get_user 실패 (만료 가능성 높음): {e}")

        # 2차: refresh_token 으로 새 세션 발급
        if user_obj is None:
            try:
                logging.info("refresh_session 으로 토큰 갱신 시도")
                rresp = self.client.auth.refresh_session(sb["refresh_token"])
                new_session = getattr(rresp, "session", None)
                if new_session and new_session.access_token:
                    sb["access_token"] = new_session.access_token
                    sb["refresh_token"] = new_session.refresh_token
                    new_exp = getattr(new_session, "expires_at", None) or 0
                    if new_exp:
                        sb["expires_at"] = new_exp
                    save_config(self.config)
                    logging.info("토큰 갱신 & 저장 완료 (PC 재부팅 복구)")
                rr_user = getattr(rresp, "user", None)
                if rr_user:
                    user_obj = rr_user
                elif new_session:
                    # 일부 버전은 user 를 response 에 안 실음 — get_user 재시도
                    try:
                        ur = self.client.auth.get_user()
                        if ur and ur.user:
                            user_obj = ur.user
                    except Exception as ge:
                        logging.warning(f"refresh 후 get_user 실패: {ge}")
            except Exception as e:
                logging.error(f"refresh_session 실패: {e}")
                self.status_text = "인증 실패 (토큰 재설정 필요)"
                return False

        if user_obj is None:
            self.status_text = "사용자 정보 없음 (토큰 재설정 필요)"
            return False

        self.user_id = user_obj.id
        logging.info(f"Connected as {getattr(user_obj, 'email', '?')}")
        self._persist_refreshed_session()
        return True

    def _persist_refreshed_session(self):
        try:
            session = self.client.auth.get_session()
            if not (session and session.access_token):
                return
            sb = self.config["supabase"]
            new_exp = getattr(session, "expires_at", None) or 0
            cur_exp = sb.get("expires_at") or 0
            # 오래된 토큰으로 덮어쓰기 차단 (race 보호).
            if new_exp and cur_exp and new_exp < cur_exp:
                return
            # access_token 또는 refresh_token 둘 중 하나라도 바뀌면 저장.
            changed = (
                sb.get("access_token") != session.access_token
                or sb.get("refresh_token") != session.refresh_token
            )
            if changed:
                sb["access_token"] = session.access_token
                sb["refresh_token"] = session.refresh_token
                if new_exp:
                    sb["expires_at"] = new_exp
                save_config(self.config)
                logging.info("Token refreshed & saved (polling)")
        except Exception as e:
            logging.warning(f"Persist session: {e}")

    def _maybe_refresh_token(self):
        """access_token 만료 임박 시 명시 refresh.

        반드시 self._sb_lock 안에서 호출. 두 thread 가 동시에 lock 대기 시,
        먼저 잡은 쪽이 refresh 끝내면 expires_at 이 갱신되고, 다음 thread 는
        여기서 곧바로 skip 하므로 race 자체가 발생 불가능.

        supabase-py 자동 refresh 를 끈 상태이므로 이 메서드가 토큰 갱신의
        유일한 경로.
        """
        sb = self.config["supabase"]
        cur_exp = sb.get("expires_at") or 0
        now = int(time.time())
        # 만료까지 lead 초 이상 남아있으면 skip. 음수 (이미 만료) 는 즉시 refresh.
        if cur_exp and (cur_exp - now) > TOKEN_REFRESH_LEAD_SEC:
            return
        rt = sb.get("refresh_token")
        if not rt:
            return
        try:
            rresp = self.client.auth.refresh_session(rt)
            new_session = getattr(rresp, "session", None)
            if not (new_session and new_session.access_token):
                return
            sb["access_token"] = new_session.access_token
            sb["refresh_token"] = new_session.refresh_token
            new_exp = getattr(new_session, "expires_at", None) or 0
            if new_exp:
                sb["expires_at"] = new_exp
            save_config(self.config)
            logging.info(f"[auth] explicit refresh OK (exp {new_exp})")
        except Exception as e:
            # refresh_token 자체가 invalid (수일 미사용/노션 외부 회수 등) 시 여기 도달.
            # 다음 heartbeat 도 같은 에러 → online=False 자연스럽게 표시됨.
            logging.warning(f"Explicit refresh failed: {e}")

    def register_device(self) -> bool:
        if not self.device_id:
            self.device_id = str(uuid.uuid4())
            self.config["device_id"] = self.device_id
            save_config(self.config)

        payload = {
            "id": self.device_id,
            "user_id": self.user_id,
            "name": self.config.get("device_name", "Unnamed"),
            "platform": platform.system().lower(),
            "launcher_version": LAUNCHER_VERSION,
            "last_seen_at": utcnow_iso(),
            "is_online": True,
        }
        try:
            self.client.table("launcher_devices").upsert(payload).execute()
            logging.info(f"Device registered: {payload['name']}")
            self.online = True
            return True
        except Exception as e:
            logging.error(f"Device register failed: {e}")
            self.status_text = "디바이스 등록 실패"
            return False

    def mark_offline(self):
        if not self.client or not self.device_id:
            return
        with self._sb_lock:
            try:
                self.client.table("launcher_devices").update(
                    {"is_online": False, "last_seen_at": utcnow_iso()}
                ).eq("id", self.device_id).execute()
                logging.info("Marked offline")
            except Exception as e:
                logging.warning(f"Mark offline failed: {e}")

    # ------------------------------------------------------------------
    # 백그라운드 루프
    # ------------------------------------------------------------------
    def heartbeat_loop(self):
        while not self.stop_event.wait(HEARTBEAT_INTERVAL_SEC):
            # _sb_lock 으로 poll_loop 와의 동시 호출 차단 — 같은 lock 내에서
            # _maybe_refresh_token 을 먼저 호출하므로, 두 thread 가 동시에 만료
            # 임박 토큰을 쥐고 lock 대기해도 두 번째는 갱신된 expires_at 보고 skip.
            with self._sb_lock:
                try:
                    self._maybe_refresh_token()
                except Exception as e:
                    logging.warning(f"Heartbeat refresh: {e}")
                try:
                    self.client.table("launcher_devices").update(
                        {"last_seen_at": utcnow_iso(), "is_online": True}
                    ).eq("id", self.device_id).execute()
                except Exception as e:
                    logging.warning(f"Heartbeat: {e}")

    def poll_loop(self):
        self._update_status("온라인 - 대기 중")
        while not self.stop_event.wait(POLL_INTERVAL_SEC):
            jobs = []
            with self._sb_lock:
                try:
                    self._maybe_refresh_token()
                except Exception as e:
                    logging.warning(f"Poll refresh: {e}")
                try:
                    resp = (
                        self.client.table("launcher_jobs")
                        .select("*")
                        .eq("user_id", self.user_id)
                        .eq("status", "pending")
                        .order("requested_at")
                        .limit(1)
                        .execute()
                    )
                    jobs = resp.data or []
                except Exception as e:
                    logging.warning(f"Poll: {e}")
            # handle_job 은 lock 밖에서 — subprocess.run (최대 4시간) 동안
            # heartbeat 가 막혀 디바이스가 offline 으로 보이는 걸 막기 위함.
            # handle_job 내부의 짧은 supabase 호출은 각자 _sb_lock 으로 보호.
            if jobs:
                try:
                    self.handle_job(jobs[0])
                except Exception as e:
                    logging.warning(f"handle_job: {e}")

    # ------------------------------------------------------------------
    # 작업 실행
    # ------------------------------------------------------------------
    def _push_output(self, job_id: str, message: str):
        """진행 상황을 launcher_jobs.output 에 append (최근 MAX_OUTPUT_CHARS 자 유지)."""
        with self._sb_lock:
            try:
                current = (
                    self.client.table("launcher_jobs")
                    .select("output")
                    .eq("id", job_id)
                    .single()
                    .execute()
                ).data or {}
                existing = current.get("output") or ""
                line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
                combined = (existing + ("\n" if existing else "") + line)[-MAX_OUTPUT_CHARS:]
                self.client.table("launcher_jobs").update({"output": combined}).eq(
                    "id", job_id
                ).execute()
            except Exception as e:
                logging.warning(f"Output update: {e}")

    def _fetch_utility(self, slug: str) -> dict | None:
        with self._sb_lock:
            try:
                resp = (
                    self.client.table("utilities")
                    .select("slug,name,download_url,current_version,entry_exe,utility_type")
                    .eq("slug", slug)
                    .single()
                    .execute()
                )
                return resp.data
            except Exception as e:
                logging.error(f"fetch utility '{slug}' failed: {e}")
                return None

    def _resolve_exe_for_job(
        self, job_id: str, slug: str, name: str, utility: dict
    ) -> Path | None:
        """executable 타입 유틸의 실행 경로 결정.
        우선순위: config.utility_paths (수동 override) → 자동 설치.
        """
        manual = self.config.get("utility_paths", {}).get(slug)
        if manual and Path(manual).exists():
            logging.info(f"[Job {job_id[:8]}] using manual path: {manual}")
            return Path(manual)

        if not utility.get("download_url"):
            self._fail_job(
                job_id,
                f"'{name}' 의 다운로드 URL 이 웹 관리자 페이지에 등록되지 않았습니다.",
            )
            return None

        try:
            self._push_output(job_id, "설치 상태 확인 중...")
            exe = ensure_installed(
                utility,
                progress_cb=lambda msg: self._push_output(job_id, msg),
            )
            return exe
        except Exception as e:
            self._fail_job(job_id, f"자동 설치 실패: {e}")
            return None

    def handle_job(self, job: dict):
        job_id = job["id"]
        slug = job["utility_slug"]
        name = job.get("utility_name") or slug
        logging.info(f"[Job {job_id[:8]}] Received: {slug}")
        self._update_status(f"실행 중: {name}")

        with self._sb_lock:
            try:
                self.client.table("launcher_jobs").update(
                    {
                        "status": "dispatched",
                        "device_id": self.device_id,
                        "dispatched_at": utcnow_iso(),
                    }
                ).eq("id", job_id).eq("status", "pending").execute()
            except Exception as e:
                logging.warning(f"Dispatch mark: {e}")
                self._update_status("온라인 - 대기 중")
                return

        utility = self._fetch_utility(slug)
        if not utility:
            self._fail_job(job_id, f"'{slug}' 유틸 레코드를 찾지 못했습니다.")
            self.last_job_info = f"{name}: DB 조회 실패"
            self._update_status("온라인 - 대기 중")
            return

        utype = utility.get("utility_type") or "executable"

        # ─────────────────────────────────────────────
        # download_only: Downloads 폴더로 내려주고 작업 종료
        # ─────────────────────────────────────────────
        if utype == "download_only":
            with self._sb_lock:
                try:
                    self.client.table("launcher_jobs").update(
                        {"status": "running", "started_at": utcnow_iso()}
                    ).eq("id", job_id).execute()
                except Exception as e:
                    logging.warning(f"Running mark: {e}")

            try:
                # 다운로드는 lock 밖 (네트워크 IO). 진행 상황 push 는 _push_output
                # 안에서 자체적으로 lock 잡음.
                saved = deliver_to_downloads(
                    utility,
                    progress_cb=lambda msg: self._push_output(job_id, msg),
                )
                with self._sb_lock:
                    self.client.table("launcher_jobs").update(
                        {
                            "status": "done",
                            "finished_at": utcnow_iso(),
                            "exit_code": 0,
                        }
                    ).eq("id", job_id).execute()
                self.last_job_info = f"{name}: Downloads 에 저장"
                notify(
                    f"{name} 다운로드 완료",
                    f"파일 위치: {saved}",
                    success=True,
                )
            except Exception as e:
                self._fail_job(job_id, f"다운로드 실패: {e}")
                self.last_job_info = f"{name}: 오류"
                notify(f"{name} 다운로드 실패", str(e), success=False)
            self._update_status("온라인 - 대기 중")
            return

        # ─────────────────────────────────────────────
        # executable: 기존 플로우 (자동 설치 + EXE 실행)
        # ─────────────────────────────────────────────
        exe = self._resolve_exe_for_job(job_id, slug, name, utility)
        if exe is None:
            self.last_job_info = f"{name}: 설치/경로 문제"
            self._update_status("온라인 - 대기 중")
            return

        with self._sb_lock:
            try:
                self.client.table("launcher_jobs").update(
                    {"status": "running", "started_at": utcnow_iso()}
                ).eq("id", job_id).execute()
            except Exception as e:
                logging.warning(f"Running mark: {e}")

        logging.info(f"[Job {job_id[:8]}] Exec {exe}")
        try:
            # subprocess.run 은 최대 4시간 — 반드시 lock 밖에서 실행해서
            # heartbeat 가 정상 동작하게 유지.
            proc = subprocess.run(
                [str(exe)],
                cwd=str(exe.parent),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60 * 60 * 4,
            )
            stdout = (proc.stdout or "")[-MAX_OUTPUT_CHARS:]
            stderr = (proc.stderr or "")[-MAX_OUTPUT_CHARS:]
            output = stdout + (
                "\n--- STDERR ---\n" + stderr if stderr.strip() else ""
            )
            exit_code = proc.returncode
            status = "done" if exit_code == 0 else "error"
            logging.info(f"[Job {job_id[:8]}] exit={exit_code} status={status}")

            with self._sb_lock:
                self.client.table("launcher_jobs").update(
                    {
                        "status": status,
                        "finished_at": utcnow_iso(),
                        "output": output or None,
                        "exit_code": exit_code,
                        "error_message": (
                            stderr[-500:] if status == "error" and stderr else None
                        ),
                    }
                ).eq("id", job_id).execute()
            self.last_job_info = f"{name}: {'완료' if status == 'done' else '오류'}"
            if status == "done":
                notify(f"{name} 완료", "실행이 정상 종료되었습니다.", success=True)
            else:
                notify(
                    f"{name} 종료 (exit={exit_code})",
                    stderr[-200:] if stderr else "오류와 함께 종료",
                    success=False,
                )
        except subprocess.TimeoutExpired:
            self._fail_job(job_id, "실행 타임아웃 (4시간)")
            self.last_job_info = f"{name}: 타임아웃"
            notify(f"{name} 타임아웃", "4시간 내 종료되지 않음", success=False)
        except Exception as e:
            self._fail_job(job_id, f"실행 중 오류: {e}")
            self.last_job_info = f"{name}: 오류"
            notify(f"{name} 오류", str(e), success=False)

        self._update_status("온라인 - 대기 중")

    def _fail_job(self, job_id: str, message: str):
        logging.error(f"[Job {job_id[:8]}] FAIL: {message}")
        with self._sb_lock:
            try:
                self.client.table("launcher_jobs").update(
                    {
                        "status": "error",
                        "finished_at": utcnow_iso(),
                        "error_message": message,
                    }
                ).eq("id", job_id).execute()
            except Exception as e:
                logging.warning(f"Fail mark: {e}")

    # ------------------------------------------------------------------
    # Tray 메뉴
    # ------------------------------------------------------------------
    def _update_status(self, text: str):
        self.status_text = text
        if self.icon:
            try:
                self.icon.update_menu()
                self.icon.title = f"MYRIAD Launcher - {text}"
            except Exception:
                pass

    # ------------------------------------------------------------------
    # 자동 업데이트 체크 (수동 메뉴 + 시작 시 1회 백그라운드)
    # ------------------------------------------------------------------
    def _fetch_latest_version(self) -> tuple[str | None, str | None]:
        """GitHub Releases API 로 launcher-latest 의 release name 조회.

        반환: (latest_version, error_message)
            성공 시 (version, None), 실패 시 (None, error_text)

        version 추출:
            release name 형식: "MYRIAD Launcher v{version}" → "v" 뒤 문자열만.
            예) "MYRIAD Launcher v2026-04-29" → "2026-04-29"
        """
        try:
            import urllib.request, json as _json
            req = urllib.request.Request(
                GITHUB_RELEASE_API_URL,
                headers={
                    "User-Agent": f"MyriadLauncher/{LAUNCHER_VERSION}",
                    "Accept": "application/vnd.github+json",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _json.loads(resp.read().decode("utf-8"))
            name = (data.get("name") or "").strip()
            # "MYRIAD Launcher v..." 에서 마지막 'v' 다음 텍스트 추출
            if " v" in name:
                version = name.rsplit(" v", 1)[1].strip()
            else:
                # 폴백 — name 자체를 버전으로 취급
                version = name
            if not version:
                return None, "릴리즈 이름이 비어있습니다."
            return version, None
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"

    def menu_check_update(self, icon, item):
        """트레이 메뉴 → 최신 버전 확인 (사용자 수동 클릭).

        쓰레드로 빼서 GitHub API 응답 대기 동안 메뉴 콜백 thread 가 안 막히게 함.
        """
        def _worker():
            latest, err = self._fetch_latest_version()
            if err:
                show_info(
                    "MYRIAD Launcher — 버전 확인 실패",
                    f"GitHub 릴리즈 정보를 가져오지 못했습니다.\n\n{err}\n\n"
                    "잠시 후 다시 시도하거나, 회사 프록시/방화벽 설정을 확인해주세요.",
                )
                return
            if latest == LAUNCHER_VERSION:
                show_info(
                    "MYRIAD Launcher — 최신 버전",
                    f"이미 최신 버전입니다.\n\n현재: v{LAUNCHER_VERSION}",
                )
                return
            # 신버전 — 안내 후 다운로드 페이지 자동 오픈
            show_info(
                "MYRIAD Launcher — 새 버전 있음",
                f"새 버전이 배포되었습니다.\n\n"
                f"현재: v{LAUNCHER_VERSION}\n"
                f"최신: v{latest}\n\n"
                "[확인] 누르면 다운로드 페이지를 엽니다.\n"
                "압축 해제 후 기존 폴더에 덮어쓰고 런처를 다시 실행해주세요.\n"
                "(config.json / launcher.log 는 덮어쓰지 마세요)",
            )
            try:
                import webbrowser
                webbrowser.open(LAUNCHER_PAGE_URL)
            except Exception as e:
                logging.warning(f"Open launcher page: {e}")

        threading.Thread(target=_worker, daemon=True, name="check-update").start()

    def auto_check_update_on_start(self):
        """런처 시작 후 백그라운드에서 1회 체크 — 신버전이면 토스트만.

        자동 교체는 하지 않음 (PyInstaller exe 자기 자신을 덮어쓰기 까다로움).
        사용자가 토스트 보고 트레이 메뉴 → "최신 버전 확인" 으로 다운로드 진행.
        """
        def _worker():
            # 부팅 직후엔 네트워크/시작 작업이 몰리니 5초 지연.
            try:
                self.stop_event.wait(5.0)
                if self.stop_event.is_set():
                    return
                latest, err = self._fetch_latest_version()
                if err or not latest:
                    return  # 조용히 실패 — 사용자가 수동 메뉴로 재시도 가능
                if latest != LAUNCHER_VERSION:
                    logging.info(
                        f"[update] new version available: v{latest} (current v{LAUNCHER_VERSION})"
                    )
                    notify(
                        "MYRIAD Launcher — 새 버전 있음",
                        f"v{latest} 가 배포되었습니다. 트레이 아이콘 우클릭 → "
                        f"'최신 버전 확인' 을 눌러 업데이트하세요.",
                    )
            except Exception as e:
                logging.warning(f"auto_check_update: {e}")

        threading.Thread(target=_worker, daemon=True, name="auto-check-update").start()

    def menu_view_log(self, icon, item):
        try:
            os.startfile(str(LOG_PATH))
        except Exception as e:
            logging.warning(f"Open log: {e}")

    def menu_open_tools(self, icon, item):
        try:
            open_tools_folder()
        except Exception as e:
            logging.warning(f"Open tools: {e}")

    def menu_open_web(self, icon, item):
        try:
            import webbrowser
            webbrowser.open("https://myriad-oe-team-hub.pages.dev")
        except Exception as e:
            logging.warning(f"Open web: {e}")

    def menu_run_setup(self, icon, item):
        """토큰/경로 재설정 - 콘솔에서 setup 실행."""
        if getattr(sys, "frozen", False):
            setup_exe = Path(sys.executable).parent / "MyriadSetup.exe"
            if setup_exe.exists():
                subprocess.Popen([str(setup_exe)])
            else:
                show_info(
                    "MYRIAD Launcher",
                    "MyriadSetup.exe 가 같은 폴더에 없습니다.\n"
                    "런처를 먼저 종료한 뒤 MyriadSetup.exe 를 직접 실행하세요.",
                )
            return

        # 개발 모드: pythonw 로 런처를 돌리는 경우 sys.executable 이 pythonw.exe
        # 가 되는데 이걸로는 콘솔이 안 뜸 → 같은 폴더의 python.exe 를 찾아서 사용.
        python_exe = Path(sys.executable).parent / "python.exe"
        if not python_exe.exists():
            python_exe = Path(sys.executable)  # fallback
        script = Path(__file__).resolve().parent / "setup.py"
        try:
            subprocess.Popen(
                [str(python_exe), str(script)],
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                cwd=str(script.parent),
            )
        except Exception as e:
            logging.warning(f"setup launch failed: {e}")
            show_info("MYRIAD Launcher", f"setup.py 실행 실패:\n{e}")

    def menu_toggle_autostart(self, icon, item):
        try:
            if is_autostart_installed():
                uninstall_autostart()
                show_info("MYRIAD Launcher", "자동 시작이 해제되었습니다.")
            else:
                install_autostart()
                show_info(
                    "MYRIAD Launcher",
                    "PC 부팅 시 자동 실행되도록 등록되었습니다.",
                )
            icon.update_menu()
        except Exception as e:
            logging.warning(f"Autostart toggle: {e}")
            show_info("MYRIAD Launcher", f"자동 시작 설정 실패:\n{e}")

    def menu_quit(self, icon, item):
        logging.info("Quit requested")
        self.stop_event.set()
        self.mark_offline()
        icon.stop()

    def build_menu(self):
        def status_label(_):
            prefix = "[ON]" if self.online else "[OFF]"
            return f"{prefix}  {self.status_text}"

        def device_label(_):
            return f"PC:  {self.config.get('device_name', 'Unnamed')}"

        def last_job_label(_):
            return f"최근:  {self.last_job_info}"

        def autostart_checked(_):
            return is_autostart_installed()

        noop = lambda icon, item: None  # 클릭해도 아무 일 안 일어남

        return pystray.Menu(
            # 상단 3 줄은 "정보 표시" 용이지만 회색으로 보이지 않도록 enabled=True + no-op
            pystray.MenuItem(status_label, noop),
            pystray.MenuItem(device_label, noop),
            pystray.MenuItem(last_job_label, noop),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("웹 대시보드 열기", self.menu_open_web),
            pystray.MenuItem("설치된 유틸 폴더 열기", self.menu_open_tools),
            pystray.MenuItem("로그 보기", self.menu_view_log),
            pystray.MenuItem("최신 버전 확인", self.menu_check_update),
            pystray.MenuItem("토큰 / 설정 재설정", self.menu_run_setup),
            pystray.MenuItem(
                "Windows 시작 시 자동 실행",
                self.menu_toggle_autostart,
                checked=autostart_checked,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("종료", self.menu_quit),
        )

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------
    def run(self):
        # 연결 & 등록 (실패해도 아이콘은 띄움 - 메뉴에서 재설정 유도)
        ok = self.connect() and self.register_device()
        atexit.register(self.mark_offline)

        # 백그라운드 스레드
        if ok:
            threading.Thread(
                target=self.heartbeat_loop, daemon=True, name="heartbeat"
            ).start()
            threading.Thread(
                target=self.poll_loop, daemon=True, name="polling"
            ).start()
            # 시작 후 5초 뒤 신버전 1회 체크 — 있으면 토스트만 띄움 (자동 교체 X).
            # 연결 실패 시엔 안 함 (네트워크 문제일 가능성 높음 → 노이즈 회피).
            self.auto_check_update_on_start()

        # 트레이 아이콘 (메인 스레드에서 blocking run)
        self.icon = pystray.Icon(
            "myriad_launcher",
            make_icon_image(online=ok),
            f"MYRIAD Launcher - {self.status_text}",
            self.build_menu(),
        )
        self.icon.run()

        # 종료
        self.stop_event.set()


def main():
    setup_logging()
    logging.info(f"Launcher v{LAUNCHER_VERSION} starting")

    if not CONFIG_PATH.exists():
        # 최초 실행: setup 안내
        show_info(
            "MYRIAD Launcher - 최초 실행",
            "설정 파일이 없습니다.\n"
            + (
                "같은 폴더의 MyriadSetup.exe 를 먼저 실행해서 설정을 완료해주세요."
                if getattr(sys, "frozen", False)
                else "먼저 'python setup.py' 또는 setup.bat 을 실행해서 설정을 완료해주세요."
            ),
        )
        if getattr(sys, "frozen", False):
            setup_exe = Path(sys.executable).parent / "MyriadSetup.exe"
            if setup_exe.exists():
                subprocess.Popen([str(setup_exe)])
        sys.exit(0)

    try:
        config = load_config()
    except Exception as e:
        logging.error(f"Config load failed: {e}")
        show_info(
            "MYRIAD Launcher",
            f"설정 파일 읽기 실패:\n{e}\n\n설정을 다시 진행하세요.",
        )
        sys.exit(1)

    launcher = Launcher(config)
    launcher.run()


if __name__ == "__main__":
    main()

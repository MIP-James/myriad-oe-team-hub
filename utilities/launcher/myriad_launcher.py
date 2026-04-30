# -*- coding: utf-8 -*-
"""
MYRIAD Launcher - 시스템 트레이 아이콘 기반 백그라운드 런처.

v2 (2026-04-30~) — Supabase 세션 인증 → device-bound API token 으로 교체.
  - refresh_token rotation chain 자체가 사라짐 → 매일 토큰 깨지던 문제 종결
  - 모든 API 호출이 단일 Bearer 헤더 — race condition 발생 불가능
  - 슬립/리부팅/네트워크 블립 모두 안전 (토큰은 단순 string)

최초 1회 MyriadSetup.exe 로 config.json 생성 (웹 허브에서 발급한 token paste) 후
이 스크립트(또는 빌드된 EXE)를 실행하세요. 콘솔 없이 트레이 아이콘만 뜨고,
웹에서 요청한 유틸 실행을 처리합니다.
"""
import atexit
import logging
import os
import platform
import subprocess
import sys
import threading
import time
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
        pass


_hide_internal_dir()


try:
    import httpx
    import pystray
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
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

from config import CONFIG_PATH, load_config, save_config, DEFAULT_API_BASE_URL, is_v2_config
from autostart import install_autostart, uninstall_autostart, is_autostart_installed
from tools_manager import (
    ensure_installed, deliver_to_downloads, open_tools_folder, tools_root
)

try:
    from winotify import Notification, audio as _wn_audio
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


LAUNCHER_VERSION = "2026-04-30"
POLL_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 30.0
MAX_OUTPUT_CHARS = 8000
LOG_PATH = _exe_dir() / "launcher.log"

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
    """트레이에 표시할 아이콘을 실시간 생성."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    fill = (255, 140, 0, 255) if online else (120, 120, 120, 255)
    outline = (30, 30, 30, 255)
    draw.ellipse([1, 1, size - 1, size - 1], fill=fill, outline=outline, width=2)
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
    """정보 메시지 박스 — 별도 스레드에서 띄워야 메시지 큐가 막히지 않음."""
    if sys.platform == "win32":
        def _popup():
            try:
                import ctypes
                flags = 0x0 | 0x40 | 0x10000 | 0x40000
                ctypes.windll.user32.MessageBoxW(0, message, title, flags)
            except Exception as e:
                logging.warning(f"MessageBoxW failed: {e}")
        threading.Thread(target=_popup, daemon=True, name="msgbox").start()
        return
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo(title, message)
        root.destroy()
    except Exception:
        pass


# =============================================================================
# API 클라이언트 — Bearer 토큰만 헤더에 박아 모든 endpoint 호출
# =============================================================================
class LauncherApi:
    """Cloudflare Functions 백엔드와 HTTP 통신하는 단일 진입점.

    - refresh / 만료 / rotation 자체가 없음 (토큰은 fixed string)
    - 인증 실패 (401) 는 토큰이 회수됐다는 신호 → 트레이 알림 + 폴링 정지
    - 네트워크 오류는 자동 재시도 (다음 poll/heartbeat 주기까지 대기)
    """
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        # httpx 는 Connection-pool + HTTP/2 + timeout 기본 지원.
        # 쓰레드 안전 — heartbeat / poll 동시 호출 OK.
        self.client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": f"MyriadLauncher/{LAUNCHER_VERSION}",
            },
        )
        self._token_revoked = False  # 401 누적 감지

    def is_revoked(self) -> bool:
        return self._token_revoked

    def _post(self, path: str, body: dict | None = None) -> dict:
        """POST 호출. 401 면 토큰 회수 상태로 마킹 후 예외."""
        url = f"{self.base_url}{path}"
        try:
            resp = self.client.post(url, json=body or {})
        except httpx.RequestError as e:
            raise RuntimeError(f"network: {e}") from e
        if resp.status_code == 401:
            # 토큰이 잘못됐거나 revoke 됨 — 더 이상 retry 무의미.
            self._token_revoked = True
            error_body = ""
            try:
                error_body = resp.json().get("error", "")
            except Exception:
                error_body = resp.text[:200]
            raise PermissionError(f"토큰 인증 실패 (401): {error_body}")
        if resp.status_code >= 400:
            error_body = ""
            try:
                error_body = resp.json().get("error", "")
            except Exception:
                error_body = resp.text[:200]
            raise RuntimeError(f"HTTP {resp.status_code}: {error_body}")
        try:
            return resp.json()
        except Exception:
            return {}

    def poll(self, *, device_name: str = "", platform_name: str = "", launcher_version: str = "") -> dict:
        """폴링 + heartbeat + 최초 페어링.

        반환: { device_id, paired_now, jobs }
        """
        return self._post("/api/launcher-poll", {
            "device_name": device_name,
            "platform": platform_name,
            "launcher_version": launcher_version,
        })

    def heartbeat(self, *, offline: bool = False) -> dict:
        return self._post("/api/launcher-heartbeat", {"offline": offline})

    def update_job(self, job_id: str, **fields) -> dict:
        body = {"job_id": job_id}
        body.update(fields)
        return self._post("/api/launcher-job-update", body)

    def append_output(self, job_id: str, message: str) -> dict:
        return self._post("/api/launcher-job-update", {
            "job_id": job_id,
            "output_append": message,
        })

    def fetch_utility(self, slug: str) -> dict | None:
        data = self._post("/api/launcher-utility-fetch", {"slug": slug})
        return data.get("utility") if data else None

    def close(self):
        try:
            self.client.close()
        except Exception:
            pass


# =============================================================================
# Launcher
# =============================================================================
class Launcher:
    def __init__(self, config: dict):
        self.config = config
        self.stop_event = threading.Event()
        self.api: LauncherApi | None = None
        self.device_id: str | None = config.get("device_id")
        self.status_text = "연결 중..."
        self.last_job_info = "(아직 없음)"
        self.online = False
        self.icon: pystray.Icon | None = None
        self._auth_failed = False  # 토큰 revoke 감지 시 True

    # ------------------------------------------------------------------
    # 초기화
    # ------------------------------------------------------------------
    def connect(self) -> bool:
        """API 클라이언트 초기화 + 첫 폴링으로 페어링/heartbeat.

        Bearer 토큰만 검증하면 끝 — refresh 시퀀스 없음. 슬립/리부팅 후에도
        config.json 의 토큰을 그대로 다시 헤더에 박으면 동작.
        """
        base_url = self.config.get("api_base_url") or DEFAULT_API_BASE_URL
        token = self.config.get("api_token")
        if not token or not str(token).startswith("myrlnch_"):
            self.status_text = "토큰 없음 (setup 재실행 필요)"
            self._auth_failed = True
            return False

        logging.info(f"Connecting to {base_url}")
        self.api = LauncherApi(base_url, token)

        # 첫 poll 호출로 페어링/heartbeat — 이 한방에 device_id 확보 + jobs fetch.
        try:
            data = self.api.poll(
                device_name=self.config.get("device_name", "Unnamed"),
                platform_name=platform.system().lower(),
                launcher_version=LAUNCHER_VERSION,
            )
        except PermissionError as e:
            logging.error(f"Auth failed: {e}")
            self.status_text = "인증 실패 (토큰 회수됨/만료)"
            self._auth_failed = True
            return False
        except Exception as e:
            logging.error(f"Initial poll failed: {e}")
            self.status_text = "연결 실패 (네트워크 확인)"
            return False

        self.device_id = data.get("device_id")
        if self.device_id and self.device_id != self.config.get("device_id"):
            self.config["device_id"] = self.device_id
            try:
                save_config(self.config)
            except Exception as e:
                logging.warning(f"device_id save: {e}")

        self.online = True
        if data.get("paired_now"):
            logging.info(f"Device paired (first time): {self.device_id}")
        else:
            logging.info(f"Connected (existing device {self.device_id})")

        # 첫 폴 응답의 pending job 처리 — 진입 시점에 큐 들어있으면 즉시 실행
        for job in data.get("jobs", [])[:1]:
            try:
                self.handle_job(job)
            except Exception as e:
                logging.warning(f"Initial handle_job: {e}")

        return True

    def mark_offline(self):
        if not self.api or not self.device_id or self._auth_failed:
            return
        try:
            self.api.heartbeat(offline=True)
            logging.info("Marked offline")
        except Exception as e:
            logging.warning(f"Mark offline failed: {e}")

    # ------------------------------------------------------------------
    # 백그라운드 루프
    # ------------------------------------------------------------------
    def heartbeat_loop(self):
        while not self.stop_event.wait(HEARTBEAT_INTERVAL_SEC):
            if self._auth_failed or not self.api:
                return  # 토큰 revoke 감지 시 즉시 정지 (자기 DoS 방지)
            try:
                self.api.heartbeat()
            except PermissionError as e:
                self._handle_auth_failure(str(e))
                return
            except Exception as e:
                logging.warning(f"Heartbeat: {e}")

    def poll_loop(self):
        self._update_status("온라인 - 대기 중")
        while not self.stop_event.wait(POLL_INTERVAL_SEC):
            if self._auth_failed or not self.api:
                return
            try:
                # version/이름 등 메타는 connect() 첫 폴 때만 전달.
                # 매 폴마다 보내면 백엔드가 매번 UPDATE 해서 Realtime 깜빡임 발생.
                data = self.api.poll()
            except PermissionError as e:
                self._handle_auth_failure(str(e))
                return
            except Exception as e:
                logging.warning(f"Poll: {e}")
                continue
            jobs = data.get("jobs") or []
            if jobs:
                try:
                    self.handle_job(jobs[0])
                except Exception as e:
                    logging.warning(f"handle_job: {e}")

    def _handle_auth_failure(self, message: str):
        """401 누적으로 토큰 영구 무효 판단 시 — 모든 루프 정지 + 사용자 알림."""
        if self._auth_failed:
            return
        self._auth_failed = True
        self.online = False
        self.status_text = "인증 실패 — 토큰 재발급 필요"
        logging.error(f"AUTH FAILURE — stopping loops: {message}")
        notify(
            "MYRIAD Launcher — 재인증 필요",
            "토큰이 만료되었거나 회수되었습니다.\n"
            "트레이 우클릭 → '토큰 / 설정 재설정' → 웹 허브에서 새 토큰 발급 후 paste.",
            success=False,
        )
        if self.icon:
            try:
                self.icon.icon = make_icon_image(online=False)
                self.icon.title = "MYRIAD Launcher - 재인증 필요"
                self.icon.update_menu()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # 작업 실행
    # ------------------------------------------------------------------
    def _push_output(self, job_id: str, message: str):
        try:
            self.api.append_output(job_id, message)
        except PermissionError as e:
            self._handle_auth_failure(str(e))
        except Exception as e:
            logging.warning(f"Output update: {e}")

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

        try:
            self.api.update_job(
                job_id,
                status="dispatched",
                dispatched_at=utcnow_iso(),
            )
        except PermissionError as e:
            self._handle_auth_failure(str(e))
            return
        except Exception as e:
            logging.warning(f"Dispatch mark: {e}")
            self._update_status("온라인 - 대기 중")
            return

        try:
            utility = self.api.fetch_utility(slug)
        except PermissionError as e:
            self._handle_auth_failure(str(e))
            return
        except Exception as e:
            logging.error(f"fetch utility '{slug}' failed: {e}")
            utility = None

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
            try:
                self.api.update_job(job_id, status="running", started_at=utcnow_iso())
            except Exception as e:
                logging.warning(f"Running mark: {e}")

            try:
                saved = deliver_to_downloads(
                    utility,
                    progress_cb=lambda msg: self._push_output(job_id, msg),
                )
                self.api.update_job(
                    job_id,
                    status="done",
                    finished_at=utcnow_iso(),
                    exit_code=0,
                )
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
        # executable: 자동 설치 + EXE 실행
        # ─────────────────────────────────────────────
        exe = self._resolve_exe_for_job(job_id, slug, name, utility)
        if exe is None:
            self.last_job_info = f"{name}: 설치/경로 문제"
            self._update_status("온라인 - 대기 중")
            return

        try:
            self.api.update_job(job_id, status="running", started_at=utcnow_iso())
        except Exception as e:
            logging.warning(f"Running mark: {e}")

        logging.info(f"[Job {job_id[:8]}] Exec {exe}")
        try:
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

            self.api.update_job(
                job_id,
                status=status,
                finished_at=utcnow_iso(),
                output=output or None,
                exit_code=exit_code,
                error_message=(
                    stderr[-500:] if status == "error" and stderr else None
                ),
            )
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
        try:
            self.api.update_job(
                job_id,
                status="error",
                finished_at=utcnow_iso(),
                error_message=message,
            )
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
    # 자동 업데이트 체크
    # ------------------------------------------------------------------
    def _fetch_latest_version(self) -> tuple[str | None, str | None]:
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
            if " v" in name:
                version = name.rsplit(" v", 1)[1].strip()
            else:
                version = name
            if not version:
                return None, "릴리즈 이름이 비어있습니다."
            return version, None
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"

    def menu_check_update(self, icon, item):
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
        def _worker():
            try:
                self.stop_event.wait(5.0)
                if self.stop_event.is_set():
                    return
                latest, err = self._fetch_latest_version()
                if err or not latest:
                    return
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

        python_exe = Path(sys.executable).parent / "python.exe"
        if not python_exe.exists():
            python_exe = Path(sys.executable)
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
        if self.api:
            self.api.close()
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

        noop = lambda icon, item: None

        return pystray.Menu(
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
        ok = self.connect()
        atexit.register(self.mark_offline)

        if ok:
            threading.Thread(
                target=self.heartbeat_loop, daemon=True, name="heartbeat"
            ).start()
            threading.Thread(
                target=self.poll_loop, daemon=True, name="polling"
            ).start()
            self.auto_check_update_on_start()

        self.icon = pystray.Icon(
            "myriad_launcher",
            make_icon_image(online=ok),
            f"MYRIAD Launcher - {self.status_text}",
            self.build_menu(),
        )
        self.icon.run()
        self.stop_event.set()
        if self.api:
            self.api.close()


def main():
    setup_logging()
    logging.info(f"Launcher v{LAUNCHER_VERSION} starting")

    if not CONFIG_PATH.exists():
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

    # v1 (supabase 세션) 스키마면 v2 setup 안내 후 종료.
    if not is_v2_config(config):
        logging.error("v1 config detected — v2 token migration 필요")
        show_info(
            "MYRIAD Launcher - 인증 모델 변경",
            "런처가 새 인증 모델로 업그레이드되었습니다.\n\n"
            "기존 토큰은 더 이상 사용할 수 없어 재설정이 필요합니다:\n"
            "1. 웹 허브 → 내 런처 → 새 토큰 발급\n"
            "2. MyriadSetup.exe 실행 → 토큰 paste\n\n"
            "이후로는 매일 토큰이 깨지던 문제가 영구 해결됩니다.",
        )
        if getattr(sys, "frozen", False):
            setup_exe = Path(sys.executable).parent / "MyriadSetup.exe"
            if setup_exe.exists():
                subprocess.Popen([str(setup_exe)])
        sys.exit(0)

    launcher = Launcher(config)
    launcher.run()


if __name__ == "__main__":
    main()

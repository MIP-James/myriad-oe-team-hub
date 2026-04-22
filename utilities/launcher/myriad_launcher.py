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


try:
    from supabase import create_client, Client
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

LAUNCHER_VERSION = "0.2.0"
POLL_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 30.0
MAX_OUTPUT_CHARS = 8000
LOG_PATH = _exe_dir() / "launcher.log"


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

    # ------------------------------------------------------------------
    # 초기화
    # ------------------------------------------------------------------
    def connect(self) -> bool:
        sb = self.config["supabase"]
        logging.info(f"Connecting to {sb['url']}")
        try:
            self.client = create_client(sb["url"], sb["anon_key"])
            self.client.auth.set_session(sb["access_token"], sb["refresh_token"])
        except Exception as e:
            logging.error(f"Connect/session failed: {e}")
            self.status_text = "인증 실패 (토큰 재설정 필요)"
            return False

        try:
            user = self.client.auth.get_user()
            self.user_id = user.user.id if user and user.user else None
        except Exception as e:
            logging.error(f"get_user failed: {e}")
            self.status_text = "사용자 조회 실패"
            return False

        if not self.user_id:
            self.status_text = "사용자 정보 없음"
            return False
        logging.info(f"Connected as {user.user.email}")
        self._persist_refreshed_session()
        return True

    def _persist_refreshed_session(self):
        try:
            session = self.client.auth.get_session()
            if session and session.access_token:
                sb = self.config["supabase"]
                if sb.get("access_token") != session.access_token:
                    sb["access_token"] = session.access_token
                    sb["refresh_token"] = session.refresh_token
                    save_config(self.config)
                    logging.info("Token refreshed & saved")
        except Exception as e:
            logging.warning(f"Persist session: {e}")

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
            try:
                self.client.table("launcher_devices").update(
                    {"last_seen_at": utcnow_iso(), "is_online": True}
                ).eq("id", self.device_id).execute()
            except Exception as e:
                logging.warning(f"Heartbeat: {e}")

    def poll_loop(self):
        self._update_status("온라인 - 대기 중")
        while not self.stop_event.wait(POLL_INTERVAL_SEC):
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
                if jobs:
                    self.handle_job(jobs[0])
            except Exception as e:
                logging.warning(f"Poll: {e}")

    # ------------------------------------------------------------------
    # 작업 실행
    # ------------------------------------------------------------------
    def _push_output(self, job_id: str, message: str):
        """진행 상황을 launcher_jobs.output 에 append (최근 MAX_OUTPUT_CHARS 자 유지)."""
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
            try:
                self.client.table("launcher_jobs").update(
                    {"status": "running", "started_at": utcnow_iso()}
                ).eq("id", job_id).execute()
            except Exception as e:
                logging.warning(f"Running mark: {e}")

            try:
                saved = deliver_to_downloads(
                    utility,
                    progress_cb=lambda msg: self._push_output(job_id, msg),
                )
                # 완료 처리
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

        try:
            self.client.table("launcher_jobs").update(
                {"status": "running", "started_at": utcnow_iso()}
            ).eq("id", job_id).execute()
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

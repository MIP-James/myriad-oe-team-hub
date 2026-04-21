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

try:
    from supabase import create_client, Client
    import pystray
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:
    # 콘솔이 없을 수 있으므로 파일로 기록
    err_log = Path(__file__).resolve().parent / "launcher_error.log"
    with open(err_log, "a", encoding="utf-8") as f:
        f.write(f"{datetime.now()}: import 실패 - {e}\n")
    raise

from config import CONFIG_PATH, load_config, save_config
from autostart import install_autostart, uninstall_autostart, is_autostart_installed

LAUNCHER_VERSION = "0.2.0"
POLL_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 30.0
MAX_OUTPUT_CHARS = 8000
LOG_PATH = CONFIG_PATH.parent / "launcher.log"


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
    color = (255, 179, 0, 255) if online else (150, 150, 150, 255)
    draw.ellipse([4, 4, size - 4, size - 4], fill=color)

    # 중앙에 "M"
    try:
        font = ImageFont.truetype("arialbd.ttf", 34)
    except Exception:
        try:
            font = ImageFont.truetype("malgun.ttf", 34)
        except Exception:
            font = ImageFont.load_default()
    try:
        bbox = draw.textbbox((0, 0), "M", font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(
            (size // 2 - w // 2 - bbox[0], size // 2 - h // 2 - bbox[1] - 2),
            "M",
            fill=(17, 17, 17, 255),
            font=font,
        )
    except Exception:
        draw.text((size // 2 - 8, size // 2 - 12), "M", fill=(17, 17, 17, 255))
    return img


def show_info(title: str, message: str):
    """tkinter 메시지박스로 정보/경고 표시 (콘솔 없어도 보여야 하는 메시지)."""
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

        exe_path = self.config.get("utility_paths", {}).get(slug)
        if not exe_path:
            self._fail_job(job_id, f"경로 미설정: {slug}")
            self.last_job_info = f"{name}: 경로 미설정"
            self._update_status("온라인 - 대기 중")
            return
        exe = Path(exe_path)
        if not exe.exists():
            self._fail_job(job_id, f"EXE 파일 없음: {exe_path}")
            self.last_job_info = f"{name}: 파일 없음"
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
        except subprocess.TimeoutExpired:
            self._fail_job(job_id, "실행 타임아웃 (4시간)")
            self.last_job_info = f"{name}: 타임아웃"
        except Exception as e:
            self._fail_job(job_id, f"실행 중 오류: {e}")
            self.last_job_info = f"{name}: 오류"

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
        else:
            script = Path(__file__).resolve().parent / "setup.py"
            subprocess.Popen(
                [sys.executable, str(script)],
                creationflags=subprocess.CREATE_NEW_CONSOLE,
            )

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
            dot = "🟢" if self.online else "⚪"
            return f"{dot} {self.status_text}"

        def device_label(_):
            return f"💻 {self.config.get('device_name', 'Unnamed')}"

        def last_job_label(_):
            return f"📌 최근: {self.last_job_info}"

        def autostart_checked(_):
            return is_autostart_installed()

        return pystray.Menu(
            pystray.MenuItem(status_label, None, enabled=False),
            pystray.MenuItem(device_label, None, enabled=False),
            pystray.MenuItem(last_job_label, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("웹 대시보드 열기", self.menu_open_web),
            pystray.MenuItem("로그 보기", self.menu_view_log),
            pystray.MenuItem("토큰 / 경로 재설정", self.menu_run_setup),
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

# -*- coding: utf-8 -*-
"""
MYRIAD Launcher - Supabase 연동 로컬 런처

본인 PC에 상주하며 웹에서 요청한 유틸 실행을 처리합니다.
최초 1회 `python setup.py` 로 설정 후 `python myriad_launcher.py` 로 실행하세요.
"""
import atexit
import json
import platform
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    from supabase import create_client, Client
except ImportError:
    print("[오류] supabase 패키지가 설치되지 않았습니다.")
    print("      pip install -r requirements.txt")
    sys.exit(1)

from config import load_config, save_config, CONFIG_PATH

LAUNCHER_VERSION = "0.1.0"
POLL_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 30.0
MAX_OUTPUT_CHARS = 8000  # launcher_jobs.output 저장 크기 제한


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Launcher:
    def __init__(self, config: dict):
        self.config = config
        self.stop_event = threading.Event()
        self.client: Client | None = None
        self.device_id: str | None = config.get("device_id")
        self.user_id: str | None = None

    # ------------------------------------------------------------------
    # 초기화
    # ------------------------------------------------------------------
    def connect(self):
        sb = self.config["supabase"]
        log(f"Supabase 연결 중... ({sb['url']})")
        self.client = create_client(sb["url"], sb["anon_key"])
        try:
            self.client.auth.set_session(sb["access_token"], sb["refresh_token"])
        except Exception as e:
            log(f"[오류] 세션 복원 실패: {e}")
            log("      연결 토큰이 만료됐거나 잘못됐습니다. `python setup.py` 재실행하세요.")
            sys.exit(2)

        user = self.client.auth.get_user()
        self.user_id = user.user.id if user and user.user else None
        if not self.user_id:
            log("[오류] 사용자 정보 조회 실패.")
            sys.exit(2)
        log(f"연결 성공: {user.user.email}")

        # 토큰이 내부적으로 갱신됐을 수 있으니 저장
        self._persist_refreshed_session()

    def _persist_refreshed_session(self):
        try:
            session = self.client.auth.get_session()
            if session and session.access_token:
                sb = self.config["supabase"]
                if (
                    sb.get("access_token") != session.access_token
                    or sb.get("refresh_token") != session.refresh_token
                ):
                    sb["access_token"] = session.access_token
                    sb["refresh_token"] = session.refresh_token
                    save_config(self.config)
                    log("갱신된 토큰을 config 에 저장했습니다.")
        except Exception as e:
            log(f"[경고] 세션 저장 실패 (계속 진행): {e}")

    def register_device(self):
        """launcher_devices 에 본인 기기를 upsert 하고 online 상태로."""
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
            log(f"디바이스 등록 완료: {payload['name']} (id={self.device_id[:8]}...)")
        except Exception as e:
            log(f"[오류] 디바이스 등록 실패: {e}")
            sys.exit(3)

    def mark_offline(self):
        if not self.client or not self.device_id:
            return
        try:
            self.client.table("launcher_devices").update(
                {"is_online": False, "last_seen_at": utcnow_iso()}
            ).eq("id", self.device_id).execute()
            log("오프라인 상태로 표시됨.")
        except Exception as e:
            log(f"[경고] 오프라인 표시 실패: {e}")

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
                log(f"[경고] 하트비트 실패: {e}")

    def poll_loop(self):
        while not self.stop_event.wait(POLL_INTERVAL_SEC):
            try:
                # 이 디바이스 또는 아직 특정 디바이스에 묶이지 않은 pending 작업 중 오래된 것부터
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
                log(f"[경고] 폴링 중 예외: {e}")

    # ------------------------------------------------------------------
    # 작업 실행
    # ------------------------------------------------------------------
    def handle_job(self, job: dict):
        job_id = job["id"]
        slug = job["utility_slug"]
        log(f"▶ 작업 수신: {slug} (job={job_id[:8]}...)")

        # 1) dispatched 로 마킹 (타 런처가 중복 픽업 방지)
        try:
            self.client.table("launcher_jobs").update(
                {
                    "status": "dispatched",
                    "device_id": self.device_id,
                    "dispatched_at": utcnow_iso(),
                }
            ).eq("id", job_id).eq("status", "pending").execute()
        except Exception as e:
            log(f"[경고] dispatched 마킹 실패: {e}")
            return

        # 2) EXE 경로 확인
        exe_path = self.config.get("utility_paths", {}).get(slug)
        if not exe_path:
            self._fail_job(job_id, f"이 PC의 config.json 에 '{slug}' 경로가 설정되지 않았습니다.")
            return
        exe = Path(exe_path)
        if not exe.exists():
            self._fail_job(job_id, f"EXE 파일을 찾을 수 없습니다: {exe_path}")
            return

        # 3) running 상태로 업데이트 + 실행
        started_at = utcnow_iso()
        try:
            self.client.table("launcher_jobs").update(
                {"status": "running", "started_at": started_at}
            ).eq("id", job_id).execute()
        except Exception as e:
            log(f"[경고] running 업데이트 실패: {e}")

        log(f"  실행: {exe}")
        try:
            proc = subprocess.run(
                [str(exe)],
                cwd=str(exe.parent),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60 * 60 * 4,  # 4시간 하드 타임아웃
            )
            stdout = (proc.stdout or "")[-MAX_OUTPUT_CHARS:]
            stderr = (proc.stderr or "")[-MAX_OUTPUT_CHARS:]
            output = stdout + ("\n--- STDERR ---\n" + stderr if stderr.strip() else "")
            exit_code = proc.returncode

            status = "done" if exit_code == 0 else "error"
            log(f"  완료: exit_code={exit_code} ({status})")

            self.client.table("launcher_jobs").update(
                {
                    "status": status,
                    "finished_at": utcnow_iso(),
                    "output": output or None,
                    "exit_code": exit_code,
                    "error_message": (stderr[-500:] if status == "error" and stderr else None),
                }
            ).eq("id", job_id).execute()
        except subprocess.TimeoutExpired:
            self._fail_job(job_id, "실행 타임아웃 (4시간)")
        except Exception as e:
            self._fail_job(job_id, f"실행 중 오류: {e}")

    def _fail_job(self, job_id: str, message: str):
        log(f"  ✗ 실패: {message}")
        try:
            self.client.table("launcher_jobs").update(
                {
                    "status": "error",
                    "finished_at": utcnow_iso(),
                    "error_message": message,
                }
            ).eq("id", job_id).execute()
        except Exception as e:
            log(f"[경고] error 업데이트 실패: {e}")

    # ------------------------------------------------------------------
    # 실행 흐름
    # ------------------------------------------------------------------
    def run(self):
        self.connect()
        self.register_device()
        atexit.register(self.mark_offline)

        hb = threading.Thread(target=self.heartbeat_loop, daemon=True, name="heartbeat")
        hb.start()

        log(f"폴링 시작 (interval={POLL_INTERVAL_SEC}s). Ctrl+C 로 종료.")
        try:
            self.poll_loop()
        except KeyboardInterrupt:
            log("종료 신호 수신.")
        finally:
            self.stop_event.set()


def main():
    if not CONFIG_PATH.exists():
        print(f"[오류] 설정 파일이 없습니다: {CONFIG_PATH}")
        print("       먼저 `python setup.py` 를 실행해서 설정을 완료하세요.")
        sys.exit(1)

    config = load_config()

    # SIGINT/SIGTERM 시 graceful shutdown
    def _sig(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGINT, _sig)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _sig)

    print("=" * 60)
    print(f"  MYRIAD Launcher v{LAUNCHER_VERSION}")
    print(f"  Device: {config.get('device_name', 'Unnamed')}")
    print("=" * 60)

    launcher = Launcher(config)
    launcher.run()


if __name__ == "__main__":
    main()

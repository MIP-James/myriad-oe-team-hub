# -*- coding: utf-8 -*-
"""MYRIAD 확장 프로그램 설치 도우미.

컴퓨터에 익숙하지 않은 실무자(알바)도 크롬 확장을 설치·업데이트할 수 있도록
사람이 해야 하는 단계를 최소화하는 도우미 EXE.

동작
  1. GitHub 릴리즈(공개 저장소, 로그인 불필요)에서 확장별 최신 zip 을 받아
     %LOCALAPPDATA%\\Myriad\\Extensions\\<slug>\\ 에 풉니다. (이미 최신이면 건너뜀)
  2. 크롬 프로필의 Secure Preferences 를 읽어 "어느 확장이 이미 우리 폴더에서
     로드돼 있는지" 자동 판별합니다.
  3. 아직 등록 안 된 확장이 있으면 폴더 경로를 클립보드에 복사하고, 그림 안내
     (개발자 모드 → 압축해제된 확장 로드 → Ctrl+V, Enter) 를 띄웁니다.
     등록되면 체크가 자동으로 초록으로 바뀝니다.
  4. 이후 실행(시작 프로그램 --silent)은 폴더만 제자리 교체하고, 바뀐 게 있으면
     "크롬 다시 열기" 만 묻습니다. 아무 변화가 없으면 창을 띄우지 않고 종료.

크롬이 외부 자동화로 "압축해제된 확장 로드" 를 막고 있어 3번의 클릭 3번만은
사람이 합니다. 그 외에는 전부 자동입니다.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

APP_NAME = "MYRIAD 확장 프로그램 설치 도우미"
APP_VERSION = "1.0.0"
EXE_NAME = "MYRIAD_Extension_Installer.exe"
REPO = "MIP-James/myriad-oe-team-hub"
API_RELEASES = f"https://api.github.com/repos/{REPO}/releases?per_page=100&page={{page}}"
MAX_PAGES = 5

# 기본 포함 확장. slug 는 release.py 의 태그 접두어(<slug>-v<version>) 와 동일.
EXTENSIONS = [
    {"slug": "bpm-collector", "name": "BPM Collector", "folder": "bpm-collector"},
    {"slug": "band-url-collector", "name": "BAND URL Collector", "folder": "band-url-collector"},
]

ROOT_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "Myriad"
EXT_ROOT = ROOT_DIR / "Extensions"
APP_DIR = ROOT_DIR / "ExtInstaller"
STATE_FILE = APP_DIR / "state.json"
LOG_FILE = APP_DIR / "installer.log"

CREATE_NO_WINDOW = 0x08000000

# ---------------------------------------------------------------- 로깅


def setup_logging() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
    )
    logging.info("=== %s v%s 시작 (argv=%s, frozen=%s)", APP_NAME, APP_VERSION, sys.argv[1:], getattr(sys, "frozen", False))


# ---------------------------------------------------------------- 상태 파일


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


# ---------------------------------------------------------------- HTTP (회사 프록시 SSL 대응: truststore → 기본)


def _ssl_contexts():
    try:
        import truststore  # type: ignore

        yield truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception as e:  # noqa: BLE001
        logging.info("truststore 사용 불가, 기본 컨텍스트로: %s", e)
    yield ssl.create_default_context()


def http_get(url: str, timeout: int = 30, progress=None) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"MYRIAD-Ext-Installer/{APP_VERSION}",
            "Accept": "application/vnd.github+json, application/octet-stream, */*",
        },
    )
    last_err: Exception | None = None
    for ctx in _ssl_contexts():
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                total = int(r.headers.get("Content-Length") or 0)
                chunks = []
                got = 0
                while True:
                    buf = r.read(256 * 1024)
                    if not buf:
                        break
                    chunks.append(buf)
                    got += len(buf)
                    if progress:
                        progress(got, total)
                return b"".join(chunks)
        except ssl.SSLError as e:
            last_err = e
            logging.warning("SSL 실패, 다음 컨텍스트 시도: %s", e)
            continue
    raise last_err or RuntimeError("HTTP 실패")


# ---------------------------------------------------------------- GitHub 릴리즈

_release_pages: list[list[dict]] = []


def _release_page(page: int) -> list[dict]:
    while len(_release_pages) < page:
        idx = len(_release_pages) + 1
        data = json.loads(http_get(API_RELEASES.format(page=idx)).decode("utf-8"))
        _release_pages.append(data if isinstance(data, list) else [])
    return _release_pages[page - 1]


def fetch_latest_release(slug: str) -> dict | None:
    """slug-v<version> 태그 중 가장 최근 릴리즈. GitHub API 는 최신순 정렬이라 첫 매치가 최신."""
    prefix = f"{slug}-v"
    for page in range(1, MAX_PAGES + 1):
        items = _release_page(page)
        if not items:
            break
        for rel in items:
            tag = rel.get("tag_name") or ""
            if not tag.startswith(prefix) or rel.get("draft"):
                continue
            zips = [a for a in rel.get("assets", []) if str(a.get("name", "")).lower().endswith(".zip")]
            if not zips:
                continue
            asset = zips[0]
            return {
                "tag": tag,
                "version": tag[len(prefix):],
                "zip_url": asset["browser_download_url"],
                "zip_name": asset["name"],
                "published_at": rel.get("published_at"),
            }
        if len(items) < 100:
            break
    return None


# ---------------------------------------------------------------- 설치(폴더 교체)


def _find_manifest_root(extracted: Path) -> Path | None:
    if (extracted / "manifest.json").is_file():
        return extracted
    subs = [p for p in extracted.iterdir() if p.is_dir()]
    if len(subs) == 1 and (subs[0] / "manifest.json").is_file():
        return subs[0]
    found = sorted(extracted.rglob("manifest.json"), key=lambda p: len(p.parts))
    return found[0].parent if found else None


def _rmtree_retry(path: Path, tries: int = 5) -> None:
    for i in range(tries):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.6 * (i + 1))
    shutil.rmtree(path, ignore_errors=True)


def _sync_in_place(src: Path, dst: Path) -> None:
    """폴더 이름 변경이 막힌 경우(크롬이 핸들을 잡고 있음): 파일 단위로 덮어쓰고 남은 것 삭제."""
    keep = set()
    for p in src.rglob("*"):
        rel = p.relative_to(src)
        keep.add(rel)
        target = dst / rel
        if p.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
    for p in sorted(dst.rglob("*"), key=lambda x: -len(x.parts)):
        rel = p.relative_to(dst)
        if rel in keep:
            continue
        try:
            if p.is_dir():
                p.rmdir()
            else:
                p.unlink()
        except OSError:
            pass


def install_zip_bytes(data: bytes, target: Path) -> str:
    """zip 바이트를 target 폴더로 설치. 반환 = 설치된 manifest version."""
    EXT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=str(EXT_ROOT)) as tmp:
        tmpdir = Path(tmp)
        zpath = tmpdir / "pkg.zip"
        zpath.write_bytes(data)
        extracted = tmpdir / "x"
        with zipfile.ZipFile(zpath) as zf:
            zf.extractall(extracted)
        root = _find_manifest_root(extracted)
        if root is None:
            raise RuntimeError("zip 안에 manifest.json 이 없습니다")
        version = read_manifest(root).get("version", "?")

        staged = target.with_name(target.name + ".new")
        old = target.with_name(target.name + ".old")
        _rmtree_retry(staged)
        _rmtree_retry(old)
        shutil.copytree(root, staged)

        if not target.exists():
            os.replace(staged, target)
        else:
            try:
                os.rename(target, old)
                os.rename(staged, target)
                _rmtree_retry(old)
            except OSError as e:
                logging.warning("폴더 교체 실패(%s) → 제자리 덮어쓰기", e)
                if old.exists() and not target.exists():
                    os.rename(old, target)
                _sync_in_place(staged, target)
                _rmtree_retry(staged)
        return version


def read_manifest(folder: Path) -> dict:
    try:
        return json.loads((folder / "manifest.json").read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


# ---------------------------------------------------------------- 크롬


def chrome_exe() -> str | None:
    try:
        import winreg

        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as k:
                    p, _ = winreg.QueryValueEx(k, None)
                    if p and Path(p).is_file():
                        return p
            except OSError:
                continue
    except Exception:  # noqa: BLE001
        pass
    for p in (
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ):
        if p.is_file():
            return str(p)
    return None


def chrome_user_data() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"


def chrome_unpacked_extensions() -> list[dict]:
    """모든 프로필의 (Secure) Preferences 에서 location=4(압축해제 로드) 확장 목록."""
    out: list[dict] = []
    ud = chrome_user_data()
    if not ud.is_dir():
        return out
    for prof in ud.iterdir():
        if not prof.is_dir():
            continue
        for fn in ("Secure Preferences", "Preferences"):
            f = prof / fn
            if not f.is_file():
                continue
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            for eid, v in (d.get("extensions", {}).get("settings", {}) or {}).items():
                if not isinstance(v, dict):
                    continue
                path = v.get("path")
                if v.get("location") == 4 and isinstance(path, str) and ":" in path:
                    out.append({"profile": prof.name, "id": eid, "path": path, "state": v.get("state")})
    return out


def _norm(p: str | Path) -> str:
    return os.path.normcase(os.path.normpath(str(p))).rstrip("\\")


def chrome_status(ext: dict, unpacked: list[dict]) -> tuple[str, str]:
    """('installed'|'elsewhere'|'missing', detail)"""
    target = _norm(EXT_ROOT / ext["folder"])
    for u in unpacked:
        if _norm(u["path"]) == target:
            return "installed", u["profile"]
    my_name = read_manifest(EXT_ROOT / ext["folder"]).get("name")
    if my_name:
        for u in unpacked:
            other = read_manifest(Path(u["path"])).get("name")
            if other and other == my_name:
                return "elsewhere", u["path"]
    return "missing", ""


def chrome_running() -> bool:
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/NH"],
            capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=10,
        )
        return "chrome.exe" in (r.stdout or "").lower()
    except Exception:  # noqa: BLE001
        return False


def open_extensions_page() -> bool:
    exe = chrome_exe()
    if not exe:
        return False
    subprocess.Popen([exe, "chrome://extensions/"], creationflags=CREATE_NO_WINDOW)
    return True


def restart_chrome() -> None:
    subprocess.run(["taskkill", "/IM", "chrome.exe"], capture_output=True, creationflags=CREATE_NO_WINDOW)
    for _ in range(16):
        if not chrome_running():
            break
        time.sleep(0.5)
    if chrome_running():
        subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"], capture_output=True, creationflags=CREATE_NO_WINDOW)
        time.sleep(1.0)
    exe = chrome_exe()
    if exe:
        subprocess.Popen([exe, "--restore-last-session"], creationflags=CREATE_NO_WINDOW)


# ---------------------------------------------------------------- 자기 설치 + 시작 프로그램


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def installed_exe() -> Path:
    return APP_DIR / EXE_NAME


def self_install() -> None:
    """실행 파일을 %LOCALAPPDATA%\\Myriad\\ExtInstaller 로 복사(시작 프로그램이 항상 같은 경로를 가리키도록)."""
    if not is_frozen():
        return
    src = Path(sys.executable)
    dst = installed_exe()
    try:
        if _norm(src) == _norm(dst):
            return
        if dst.exists() and dst.stat().st_size == src.stat().st_size:
            return
        APP_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        logging.info("self_install: %s → %s", src, dst)
    except Exception as e:  # noqa: BLE001
        logging.warning("self_install 실패: %s", e)


def startup_lnk() -> Path:
    return Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup" / "MYRIAD Extension Updater.lnk"


def startup_enabled() -> bool:
    return startup_lnk().is_file()


def set_startup(enable: bool) -> bool:
    lnk = startup_lnk()
    if not enable:
        try:
            lnk.unlink(missing_ok=True)
        except OSError:
            return False
        return True
    exe = installed_exe() if is_frozen() else None
    if exe is None or not exe.is_file():
        logging.info("시작 프로그램 등록 건너뜀(개발 모드 또는 EXE 없음)")
        return False
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}');"
        "$s.TargetPath='{exe}';$s.Arguments='--silent';$s.WorkingDirectory='{wd}';"
        "$s.Description='MYRIAD extension auto update';$s.Save()"
    ).format(lnk=str(lnk).replace("'", "''"), exe=str(exe).replace("'", "''"), wd=str(exe.parent).replace("'", "''"))
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
            capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=30,
        )
        ok = r.returncode == 0 and lnk.is_file()
        if not ok:
            logging.warning("시작 프로그램 등록 실패: %s %s", r.stdout, r.stderr)
        return ok
    except Exception as e:  # noqa: BLE001
        logging.warning("시작 프로그램 등록 예외: %s", e)
        return False


# ---------------------------------------------------------------- 업데이트 워커


class Worker(threading.Thread):
    """릴리즈 확인 → 필요 시 다운로드/교체. 진행 상황은 큐로 UI 에 전달."""

    def __init__(self, q: queue.Queue):
        super().__init__(daemon=True)
        self.q = q
        self.updated: list[str] = []
        self.errors: list[str] = []

    def emit(self, kind: str, **kw):
        self.q.put({"kind": kind, **kw})

    def run(self):
        state = load_state()
        for ext in EXTENSIONS:
            slug = ext["slug"]
            target = EXT_ROOT / ext["folder"]
            self.emit("row", slug=slug, sub="최신 버전 확인 중…")
            try:
                rel = fetch_latest_release(slug)
            except urllib.error.HTTPError as e:
                rel = None
                msg = "GitHub 요청 한도 초과(잠시 후 다시)" if e.code in (403, 429) else f"릴리즈 조회 실패 HTTP {e.code}"
                self.errors.append(f"{ext['name']}: {msg}")
                logging.warning("%s 릴리즈 조회 실패: %s", slug, e)
            except Exception as e:  # noqa: BLE001
                rel = None
                self.errors.append(f"{ext['name']}: 인터넷 연결을 확인하세요 ({type(e).__name__})")
                logging.warning("%s 릴리즈 조회 예외: %s", slug, e)

            cur = state.get(slug, {})
            have_folder = (target / "manifest.json").is_file()
            if rel is None:
                if have_folder:
                    self.emit("row", slug=slug, sub=f"현재 v{read_manifest(target).get('version', '?')} · 새 버전 확인 실패")
                else:
                    self.emit("row", slug=slug, sub="파일 없음 · 인터넷 연결 후 다시 실행", error=True)
                continue

            if have_folder and cur.get("tag") == rel["tag"]:
                self.emit("row", slug=slug, sub=f"이미 최신 · v{read_manifest(target).get('version', '?')} ({rel['version']})")
                continue

            try:
                def prog(got, total, _slug=slug):
                    pct = f" {got * 100 // total}%" if total else ""
                    self.emit("row", slug=_slug, sub=f"내려받는 중…{pct}")

                data = http_get(rel["zip_url"], timeout=120, progress=prog)
                self.emit("row", slug=slug, sub="폴더에 푸는 중…")
                prev_ver = read_manifest(target).get("version") if have_folder else None
                ver = install_zip_bytes(data, target)
                state[slug] = {"tag": rel["tag"], "version": ver, "release_version": rel["version"], "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
                save_state(state)
                if have_folder:
                    self.updated.append(ext["name"])
                    self.emit("row", slug=slug, sub=f"v{prev_ver} → v{ver} 교체됨 ({rel['version']})")
                else:
                    self.emit("row", slug=slug, sub=f"파일 준비됨 · v{ver} ({rel['version']})")
                logging.info("%s 설치/교체 완료 %s → %s", slug, prev_ver, ver)
            except Exception as e:  # noqa: BLE001
                logging.exception("%s 설치 실패", slug)
                self.errors.append(f"{ext['name']}: 설치 실패 ({e})")
                self.emit("row", slug=slug, sub=f"설치 실패: {e}", error=True)
        self.emit("done", updated=list(self.updated), errors=list(self.errors))


# ---------------------------------------------------------------- UI


def run_ui(silent: bool) -> None:
    import tkinter as tk
    from tkinter import font as tkfont

    GOLD, CHARCOAL, TEXT, MUTED, LINE, BG2 = "#F2B100", "#3A3737", "#2B2928", "#8A8580", "#E7E3DE", "#FAF8F4"
    GREEN, GREEN_BG, AMBER, AMBER_BG, RED = "#3B6D11", "#EAF3DE", "#854F0B", "#FAEEDA", "#A32D2D"

    root = tk.Tk()
    root.withdraw()
    root.title(f"{APP_NAME}  v{APP_VERSION}")
    root.configure(bg="white")
    root.resizable(False, False)
    try:
        ico = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "installer.ico"
        if ico.is_file():
            root.iconbitmap(str(ico))
    except Exception:  # noqa: BLE001
        pass

    base = tkfont.nametofont("TkDefaultFont")
    base.configure(family="Malgun Gothic", size=10)
    F = lambda size=10, bold=False: tkfont.Font(family="Malgun Gothic", size=size, weight="bold" if bold else "normal")  # noqa: E731
    MONO = tkfont.Font(family="Consolas", size=9)

    # ---- 헤더
    head = tk.Frame(root, bg=CHARCOAL, padx=16, pady=10)
    head.grid(row=0, column=0, columnspan=2, sticky="ew")
    tk.Label(head, text="MYRIAD", fg=GOLD, bg=CHARCOAL, font=F(11, True)).pack(side="left")
    tk.Label(head, text="  확장 프로그램 설치 도우미", fg="white", bg=CHARCOAL, font=F(11)).pack(side="left")
    tk.Label(head, text=f"v{APP_VERSION}", fg="#BDB7B0", bg=CHARCOAL, font=F(9)).pack(side="right")

    # ---- 왼쪽: 확장 목록
    left = tk.Frame(root, bg="white", padx=16, pady=12)
    left.grid(row=1, column=0, sticky="nsew")
    top_msg = tk.Label(left, text="최신 파일을 확인하고 있습니다…", fg=MUTED, bg="white", font=F(9), anchor="w")
    top_msg.pack(fill="x", pady=(0, 8))

    rows: dict[str, dict] = {}
    for ext in EXTENSIONS:
        fr = tk.Frame(left, bg="white", highlightbackground=LINE, highlightthickness=1, padx=12, pady=8)
        fr.pack(fill="x", pady=(0, 6))
        dot = tk.Canvas(fr, width=22, height=22, bg="white", highlightthickness=0)
        dot.pack(side="left", padx=(0, 10))
        circ = dot.create_oval(3, 3, 19, 19, outline=MUTED, width=2, fill="white")
        chk = dot.create_text(11, 11, text="✓", fill="white", font=F(10, True), state="hidden")
        mid = tk.Frame(fr, bg="white")
        mid.pack(side="left", fill="x", expand=True)
        name = tk.Label(mid, text=ext["name"], fg=TEXT, bg="white", font=F(10, True), anchor="w")
        name.pack(fill="x")
        sub = tk.Label(mid, text="확인 중…", fg=MUTED, bg="white", font=F(9), anchor="w", wraplength=330, justify="left")
        sub.pack(fill="x")
        badge = tk.Label(fr, text="", font=F(8), padx=8, pady=2)
        badge.pack(side="right")
        rows[ext["slug"]] = {"frame": fr, "dot": dot, "circ": circ, "chk": chk, "name": name, "sub": sub, "badge": badge, "mid": mid}

    def paint(slug: str, status: str, note: str | None = None):
        r = rows[slug]
        bg = "white"
        if status == "installed":
            r["dot"].itemconfigure(r["circ"], fill=GREEN, outline=GREEN)
            r["dot"].itemconfigure(r["chk"], state="normal")
            r["badge"].configure(text="설치 완료", fg=GREEN, bg=GREEN_BG)
        elif status == "elsewhere":
            bg = AMBER_BG
            r["dot"].itemconfigure(r["circ"], fill="white", outline=AMBER)
            r["dot"].itemconfigure(r["chk"], state="hidden")
            r["badge"].configure(text="다른 위치에 있음", fg=AMBER, bg="white")
        elif status == "missing":
            bg = AMBER_BG
            r["dot"].itemconfigure(r["circ"], fill="white", outline=AMBER)
            r["dot"].itemconfigure(r["chk"], state="hidden")
            r["badge"].configure(text="오른쪽 안내대로", fg=AMBER, bg="white")
        else:
            r["dot"].itemconfigure(r["circ"], fill="white", outline=MUTED)
            r["dot"].itemconfigure(r["chk"], state="hidden")
            r["badge"].configure(text="확인 중", fg=MUTED, bg="white")
        for w in (r["frame"], r["dot"], r["mid"], r["name"], r["sub"]):
            w.configure(bg=bg)
        if note is not None:
            r["sub"].configure(text=note)

    # ---- 오른쪽: 안내 패널
    right = tk.Frame(root, bg=BG2, padx=16, pady=12, width=340)
    guide_title = tk.Label(right, text="", fg=TEXT, bg=BG2, font=F(10, True), anchor="w")
    guide_title.pack(fill="x", pady=(0, 8))

    def step(n: int, text: str):
        fr = tk.Frame(right, bg=BG2)
        fr.pack(fill="x", pady=(0, 8), anchor="w")
        c = tk.Canvas(fr, width=22, height=22, bg=BG2, highlightthickness=0)
        c.create_oval(1, 1, 21, 21, fill=GOLD, outline=GOLD)
        c.create_text(11, 11, text=str(n), fill=CHARCOAL, font=F(9, True))
        c.pack(side="left", anchor="n", padx=(0, 8))
        body = tk.Frame(fr, bg=BG2)
        body.pack(side="left", fill="x", expand=True)
        tk.Label(body, text=text, fg=TEXT, bg=BG2, font=F(9), anchor="w", justify="left", wraplength=270).pack(fill="x")
        return body

    b1 = step(1, "크롬 확장 페이지 우측 상단의 「개발자 모드」 를 켭니다")
    m1 = tk.Frame(b1, bg="white", highlightbackground=LINE, highlightthickness=1, padx=8, pady=4)
    m1.pack(anchor="w", pady=(4, 0))
    tk.Label(m1, text="개발자 모드", fg=TEXT, bg="white", font=F(9)).pack(side="left", padx=(0, 10))
    tg = tk.Canvas(m1, width=34, height=18, bg="white", highlightthickness=0)
    tg.create_oval(0, 0, 18, 18, fill="#378ADD", outline="#378ADD")
    tg.create_oval(16, 0, 34, 18, fill="#378ADD", outline="#378ADD")
    tg.create_rectangle(9, 0, 25, 18, fill="#378ADD", outline="#378ADD")
    tg.create_oval(18, 2, 32, 16, fill="white", outline="white")
    tg.pack(side="left")

    b2 = step(2, "「압축해제된 확장 프로그램을 로드합니다」 버튼을 누릅니다")
    m2 = tk.Label(b2, text="압축해제된 확장 프로그램을 로드합니다", fg="#185FA5", bg="white", font=F(9),
                  highlightbackground="#B5D4F4", highlightthickness=1, padx=10, pady=4)
    m2.pack(anchor="w", pady=(4, 0))

    b3 = step(3, "폴더 선택 창이 뜨면  Ctrl+V  를 누른 뒤  Enter  를 누릅니다")
    path_lbl = tk.Label(b3, text="", fg=MUTED, bg="white", font=MONO, anchor="w", justify="left",
                        highlightbackground=LINE, highlightthickness=1, padx=8, pady=4, wraplength=260)
    path_lbl.pack(anchor="w", pady=(4, 0), fill="x")
    tk.Label(right, text="경로는 이미 복사되어 있어 붙여넣기만 하면 됩니다.", fg=MUTED, bg=BG2, font=F(8), anchor="w").pack(fill="x")

    btns = tk.Frame(right, bg=BG2)
    btns.pack(fill="x", pady=(10, 6))
    guide_status = tk.Label(right, text="", fg=GREEN, bg=BG2, font=F(9), anchor="w", justify="left", wraplength=300)
    guide_status.pack(fill="x")

    current_target: dict = {"slug": None}

    def copy_path(slug: str | None):
        if not slug:
            return
        p = str(EXT_ROOT / next(e["folder"] for e in EXTENSIONS if e["slug"] == slug))
        try:
            root.clipboard_clear()
            root.clipboard_append(p)
            root.update_idletasks()
        except Exception:  # noqa: BLE001
            pass
        path_lbl.configure(text=p, fg=TEXT)

    def on_open_chrome():
        if not open_extensions_page():
            guide_status.configure(text="크롬을 찾지 못했습니다. 크롬을 직접 열고 주소창에 chrome://extensions 를 입력하세요.", fg=RED)
        copy_path(current_target["slug"])

    tk.Button(btns, text="크롬 확장 페이지 열기", command=on_open_chrome, font=F(9), bg=GOLD, fg=CHARCOAL,
              activebackground="#d99f00", relief="flat", padx=10, pady=4, cursor="hand2").pack(side="left", padx=(0, 6))
    tk.Button(btns, text="폴더 경로 다시 복사", command=lambda: copy_path(current_target["slug"]), font=F(9), bg="white",
              fg=TEXT, relief="flat", highlightbackground=LINE, highlightthickness=1, padx=10, pady=4, cursor="hand2").pack(side="left")

    # ---- 하단
    bottom = tk.Frame(root, bg="white", padx=16, pady=10, highlightbackground=LINE, highlightthickness=1)
    bottom.grid(row=2, column=0, columnspan=2, sticky="ew")
    status_lbl = tk.Label(bottom, text="", fg=MUTED, bg="white", font=F(9), anchor="w", justify="left", wraplength=520)
    status_lbl.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 6))

    startup_var = tk.BooleanVar(value=startup_enabled() or not STATE_FILE.exists())

    def on_startup_toggle():
        ok = set_startup(startup_var.get())
        if startup_var.get() and not ok:
            startup_var.set(False)
            status_lbl.configure(text="시작 프로그램 등록에 실패했습니다. 나중에 다시 시도해 주세요.")

    tk.Checkbutton(bottom, text="PC 를 켤 때 자동으로 새 버전 확인", variable=startup_var, command=on_startup_toggle,
                   bg="white", fg=TEXT, font=F(9), activebackground="white", selectcolor="white").grid(row=1, column=0, sticky="w")
    restart_btn = tk.Button(bottom, text="지금 크롬 다시 열기", font=F(9), bg=GOLD, fg=CHARCOAL, relief="flat", padx=12, pady=4,
                            cursor="hand2", activebackground="#d99f00")
    close_btn = tk.Button(bottom, text="닫기", command=root.destroy, font=F(9), bg="white", fg=TEXT, relief="flat",
                          highlightbackground=LINE, highlightthickness=1, padx=14, pady=4, cursor="hand2")
    close_btn.grid(row=1, column=2, sticky="e")
    bottom.grid_columnconfigure(1, weight=1)

    def on_restart():
        restart_btn.configure(state="disabled", text="크롬 다시 여는 중…")
        root.update_idletasks()
        threading.Thread(target=lambda: (restart_chrome(), q.put({"kind": "restarted"})), daemon=True).start()

    restart_btn.configure(command=on_restart)

    # ---- 상태 갱신 루프
    q: queue.Queue = queue.Queue()
    worker = Worker(q)
    worker.start()
    ctx = {"done": False, "updated": [], "errors": [], "needs_restart": False, "shown": not silent, "statuses": {}}

    def show_window():
        if ctx["shown"]:
            return
        ctx["shown"] = True
        root.deiconify()

    def refresh_chrome():
        unpacked = chrome_unpacked_extensions()
        missing_slug = None
        all_ok = True
        for ext in EXTENSIONS:
            st, detail = chrome_status(ext, unpacked)
            prev = ctx["statuses"].get(ext["slug"])
            ctx["statuses"][ext["slug"]] = st
            have_folder = (EXT_ROOT / ext["folder"] / "manifest.json").is_file()
            if st == "installed":
                paint(ext["slug"], "installed")
                if prev in ("missing", "elsewhere"):
                    guide_status.configure(text=f"{ext['name']} 등록 완료!", fg=GREEN)
            elif not have_folder:
                paint(ext["slug"], "pending")
                all_ok = False
            elif st == "elsewhere":
                paint(ext["slug"], "elsewhere", note=f"크롬에 다른 폴더로 등록돼 있습니다:\n{detail}\n→ 크롬에서 그 항목을 「삭제」 한 뒤 오른쪽 안내대로 다시 등록하세요.")
                all_ok = False
                missing_slug = missing_slug or ext["slug"]
            else:
                paint(ext["slug"], "missing")
                all_ok = False
                missing_slug = missing_slug or ext["slug"]

        if missing_slug:
            n = sum(1 for s in ctx["statuses"].values() if s != "installed")
            guide_title.configure(text=f"남은 {n}개 등록하기 · 클릭 3번")
            if current_target["slug"] != missing_slug:
                current_target["slug"] = missing_slug
                copy_path(missing_slug)
                nm = next(e["name"] for e in EXTENSIONS if e["slug"] == missing_slug)
                if ctx["done"]:
                    guide_status.configure(text=(guide_status.cget("text") + f"\n다음: {nm} (경로 복사됨)").strip(), fg=GREEN)
            if ctx["done"]:
                right.grid(row=1, column=1, sticky="nsew")
                show_window()
        else:
            current_target["slug"] = None
            if ctx["done"] and all_ok:
                right.grid_forget()
        return all_ok

    def finish_message():
        parts = []
        if ctx["updated"]:
            parts.append("새 버전으로 교체됨: " + ", ".join(ctx["updated"]) + ". 적용하려면 크롬을 한 번 다시 열어야 합니다.")
        if ctx["errors"]:
            parts.append("\n".join(ctx["errors"]))
        all_ok = all(s == "installed" for s in ctx["statuses"].values()) and len(ctx["statuses"]) == len(EXTENSIONS)
        if not parts:
            parts.append("모든 확장이 최신이고 크롬에 등록돼 있습니다." if all_ok else "파일 준비가 끝났습니다. 오른쪽 안내대로 크롬에 등록해 주세요.")
        status_lbl.configure(text="\n".join(parts), fg=RED if ctx["errors"] and not ctx["updated"] else TEXT)
        top_msg.configure(text="최신 파일 확인 완료" if not ctx["errors"] else "일부 항목 확인 실패 (아래 메시지 참고)")
        if ctx["updated"] and chrome_running():
            ctx["needs_restart"] = True
            restart_btn.grid(row=1, column=1, sticky="e", padx=(0, 8))

    def pump():
        try:
            while True:
                m = q.get_nowait()
                k = m["kind"]
                if k == "row":
                    rows[m["slug"]]["sub"].configure(text=m["sub"], fg=RED if m.get("error") else MUTED)
                elif k == "done":
                    ctx["done"] = True
                    ctx["updated"], ctx["errors"] = m["updated"], m["errors"]
                    all_ok = refresh_chrome()
                    finish_message()
                    if silent:
                        if all_ok and not ctx["updated"] and not ctx["errors"]:
                            logging.info("silent: 변화 없음 → 종료")
                            root.after(50, root.destroy)
                            return
                        show_window()
                    else:
                        if not STATE_FILE.exists() or startup_var.get():
                            if startup_var.get() and not startup_enabled():
                                set_startup(True)
                elif k == "restarted":
                    ctx["needs_restart"] = False
                    restart_btn.grid_forget()
                    status_lbl.configure(text="크롬을 다시 열었습니다. 새 버전이 적용되었습니다.", fg=TEXT)
        except queue.Empty:
            pass
        root.after(200, pump)

    def poll_chrome():
        if ctx["done"]:
            refresh_chrome()
        root.after(2000, poll_chrome)

    root.grid_columnconfigure(0, weight=1, minsize=460)
    root.grid_columnconfigure(1, minsize=0)
    right.grid(row=1, column=1, sticky="nsew")
    refresh_chrome()
    if not silent:
        root.deiconify()
    root.update_idletasks()
    x = (root.winfo_screenwidth() - 840) // 2
    y = (root.winfo_screenheight() - 480) // 2
    root.geometry(f"+{max(x, 0)}+{max(y, 0)}")
    root.after(100, pump)
    root.after(1500, poll_chrome)
    if "--screenshot" in sys.argv[1:]:
        out = sys.argv[sys.argv.index("--screenshot") + 1]

        def snap():
            try:
                from PIL import ImageGrab

                root.attributes("-topmost", True)
                root.lift()
                root.update()
                time.sleep(0.5)
                x0, y0 = root.winfo_rootx(), root.winfo_rooty()
                ImageGrab.grab((x0 - 8, y0 - 32, x0 + root.winfo_width() + 8, y0 + root.winfo_height() + 8)).save(out)
            finally:
                root.destroy()

        root.after(8000, snap)
    root.mainloop()


# ---------------------------------------------------------------- main


def main() -> int:
    setup_logging()
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # 고해상도 모니터에서 흐릿함 방지
    except Exception:  # noqa: BLE001
        pass
    silent = "--silent" in sys.argv[1:]
    try:
        self_install()
    except Exception:  # noqa: BLE001
        logging.exception("self_install")
    try:
        run_ui(silent)
    except Exception:  # noqa: BLE001
        logging.exception("UI 예외")
        if not silent:
            try:
                import tkinter.messagebox as mb

                mb.showerror(APP_NAME, f"오류가 발생했습니다.\n로그: {LOG_FILE}")
            except Exception:  # noqa: BLE001
                pass
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

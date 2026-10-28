"""자동 수집 실행기 (1단계: 수동 실행 → 엑셀 저장).

설치된 Chrome 을 자동 수집 전용 프로필로 띄워 키워드를 신규순으로 검색하고,
처음 보는 상품만 골라 엑셀로 저장한다. 상세 수집은 BPM URL 작업이 맡는다.

  py -3.13 patrol.py                       # keywords.local.json 전체
  py -3.13 patrol.py --platforms auction --limit 2 --pages 1 --dry

봇 확인(지마켓·옥션 Cloudflare)이 뜨면 그 플랫폼만 멈추고 사람이 체크박스를
누를 때까지 기다린다(기본 30분). 자동 클릭은 하지 않는다.
"""
import argparse
import json
import os
import random
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

from collections import Counter

from platforms import PLATFORMS, ORDER
from deep import Deep
import bpm
import camera
import hub
import imgsim
import report
import triage

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("LOCALAPPDATA", HERE)) / "MyriadPatrol"
PROFILE_DIR = DATA_DIR / "chrome-profile"
SEEN_PATH = DATA_DIR / "seen.json"
DEEP_PATH = DATA_DIR / "deep.json"
SWEEP_PATH = DATA_DIR / "sweep.json"  # {플랫폼: {키워드: 1~pages 를 처음 끝까지 본 날}}
UNSWEPT_PAGES = 3  # 아직 차례가 안 온(전체 훑기 전) 키워드는 예전처럼 3페이지만
CDP_PORT = 9333


@contextmanager
def browser(args, attach=True):
    """기본 = UC(undetected-chromedriver). --driver playwright 면 이전 방식(평소 크롬 실행 후 CDP 연결)."""
    if getattr(args, "driver", "uc") == "uc":
        import ucpage
        with ucpage.open_uc(PROFILE_DIR) as ctx:
            yield ctx
    else:
        with sync_playwright() as p, open_browser(p, attach and not getattr(args, "launch", False)) as ctx:
            yield ctx


def find_chrome():
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            exe = Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if exe.exists():
                return str(exe)
    sys.exit("설치된 Chrome 을 찾지 못했습니다.")


@contextmanager
def open_browser(p, attach):
    """attach=True: 크롬을 평소처럼 실행해 두고 연결만 함 (Playwright 가 띄우면 지마켓 봇 확인이 안 풀림).
    attach=False: Playwright 가 직접 띄움."""
    if not attach:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), channel="chrome", headless=False,
            viewport={"width": 1366, "height": 900}, locale="ko-KR")
        try:
            yield ctx
        finally:
            ctx.close()
        return
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen([
        find_chrome(), f"--user-data-dir={PROFILE_DIR}", f"--remote-debugging-port={CDP_PORT}",
        "--no-first-run", "--no-default-browser-check", "--window-size=1366,900", "about:blank",
    ])
    endpoint = f"http://127.0.0.1:{CDP_PORT}"
    for _ in range(40):
        try:
            urllib.request.urlopen(endpoint + "/json/version", timeout=1)
            break
        except OSError:
            time.sleep(0.5)
    browser = p.chromium.connect_over_cdp(endpoint)
    try:
        yield browser.contexts[0]
    finally:
        # 강제 종료하면 로그인 쿠키가 디스크에 안 남음 → 크롬에 정상 종료 요청
        try:
            browser.new_browser_cdp_session().send("Browser.close")
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.terminate()


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def human_pause(lo=3.0, hi=7.0):
    time.sleep(random.uniform(lo, hi))


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def scroll_through(page):
    """사람처럼 끝까지 천천히 내려 지연 로딩 카드를 채운다."""
    for _ in range(12):
        page.mouse.wheel(0, random.randint(700, 1100))
        time.sleep(random.uniform(0.3, 0.7))
        if page.evaluate("innerHeight + scrollY >= document.body.scrollHeight - 50"):
            break
    time.sleep(0.8)


def wait_bot_check(platform, page, minutes):
    log(f"⚠ {platform.name}: 봇 확인 화면 — 브라우저에서 체크박스를 눌러 주세요 (최대 {minutes}분 대기)")
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        time.sleep(5)
        try:
            st = platform.state(page)
        except Exception:
            continue
        if st != "bot_check":
            log(f"{platform.name}: 봇 확인 통과 → 재개")
            return True
    return False


def open_search(platform, page, keyword, pageno, bot_wait):
    """검색 결과 페이지를 연다. 반환: ok / empty / bot_timeout / blocked / error"""
    url = platform.search_url(keyword, pageno)
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=45000, referer=platform.referer)
    except PWTimeout:
        return "error"
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except PWTimeout:
        pass
    status = (resp.status if resp is not None else None) or 200  # UC 는 상태코드 없음(None) → 화면 상태로만 판정
    st = platform.state(page)
    if (status >= 400 and st == "ok") or st == "blocked":
        # 상태코드·첫 화면만으론 판단 불가: 지마켓 봇 확인은 403, 네이버는 418 + '접속 제한' 화면을
        # 먼저 보였다가 저절로(또는 새로고침하면) 정상 화면이 됨 → 상품이 뜰 때까지 지켜보고 한 번 새로고침
        recovered = False
        for attempt in range(4):  # 0 = 기다리기만, 1~3 = 같은 주소로 다시 접속
            if attempt:
                # F5(reload) 는 안 풀리고, 주소창 엔터(새 방문·referer 없음)는 풀림 (사용자 확인 2026-10-27)
                log(f"{platform.name}: 제한 화면 → 주소 다시 열기 {attempt}/3")
                time.sleep(random.uniform(2, 4))
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=45000)
                except PWTimeout:
                    continue
            for _ in range(5):
                time.sleep(2)
                st = platform.state(page)
                if st == "bot_check" or platform.ready(page):
                    recovered = True
                    break
            if recovered:
                break
        if not recovered:
            return "blocked"
        if st != "bot_check":
            st = "ok"
    if st == "bot_check":
        if not wait_bot_check(platform, page, bot_wait):
            return "bot_timeout"
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except PWTimeout:
            pass
        st = platform.state(page)
        if st == "bot_check":
            return "bot_timeout"
    return st


def dump_evidence(page, platform, out_dir, kind="blocked"):
    """차단·건너뜀 판정 순간의 화면·주소·본문을 남겨, 진단하려고 사이트에 다시 접속하지 않게 한다."""
    stem = Path(out_dir) / f"{kind}_{platform.key}_{datetime.now():%Y-%m-%d_%H%M%S}"
    stem.parent.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(stem) + ".png", full_page=False)
        body = page.inner_text("body", timeout=5000)[:2000]
        stem.with_suffix(".txt").write_text(
            f"url: {page.url}\ntitle: {page.title()}\nready: {platform.ready(page)}\n\n{body}", encoding="utf-8")
        log(f"화면 기록: {stem}.png / .txt")
    except Exception as e:
        log(f"화면 기록 실패: {e}")


def judge(item, kw, common_exclude, brands=None):
    """제외 사유(없으면 '')."""
    if item.get("skip"):  # 플랫폼이 카드에서 바로 판정한 제외 (쿠팡 로켓 등)
        return item["skip"]
    title = item["title"] or ""
    hit = brands.find(title, item.get("seller")) if brands else ""
    if hit:
        return f"MFi·정식 브랜드: {hit}"
    for w in list(common_exclude) + list(kw.get("exclude", [])):
        if w and w.lower() in title.lower():
            return f"제외어: {w}"
    cap = kw.get("max_price")
    if cap and item["price"] and item["price"] > cap:
        return f"가격 상한 초과 ({item['price']:,} > {cap:,})"
    return ""


def login(args):
    """자동 수집 크롬을 로그인 화면으로 띄우고, 사람이 로그인하면 닫는다 (비밀번호는 다루지 않음).
    --login = 네이버(스마트스토어용), --login coupang = 쿠팡."""
    from platforms import naver_logged_in, coupang_logged_in, COUPANG_HOME
    coupang = args.login == "coupang"
    done = False
    with browser(args) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        if coupang:
            # 로그인 주소로 바로 가면 '찾을 수 없는 페이지' (10-28 노트북) → 홈에서 사람이 '로그인' 클릭
            page.goto(COUPANG_HOME)
            log("열린 크롬의 쿠팡 화면 오른쪽 위 '로그인'을 눌러 로그인해 주세요. "
                "'자동 로그인' 체크 필수 (안 하면 크롬을 닫을 때 풀림). 최대 10분 대기")
        else:
            page.goto("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fshopping.naver.com%2F")
            log("자동 수집 크롬에서 네이버에 로그인해 주세요 ('로그인 상태 유지' 체크). 최대 10분 대기")
        deadline = time.time() + 600
        while time.time() < deadline:
            time.sleep(3)
            if coupang:
                if "login.coupang.com" in (page.url or "") or not coupang_logged_in(page, wait=0):
                    continue
            elif not naver_logged_in(ctx):
                continue
            log("로그인 확인 → 창을 닫습니다")
            time.sleep(3)
            done = True
            break
        else:
            log("로그인이 확인되지 않아 종료합니다")
    if coupang and done:
        # 세션 쿠키면 크롬을 닫는 순간 풀림 → 껐다 켜서 실제로 남았는지 확인
        log("저장됐는지 확인하려고 크롬을 다시 엽니다…")
        with browser(args) as ctx:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(COUPANG_HOME)
            time.sleep(4)
            if coupang_logged_in(page):
                log("✅ 크롬을 다시 켜도 쿠팡 로그인 유지 — 자동 수집 준비 완료")
            else:
                log("⚠ 크롬을 다시 켜니 쿠팡 로그인이 풀렸습니다 → '자동 로그인'을 체크하고 이 명령을 다시 실행해 주세요")


def scan(pf, page, kw, first, last, bot_wait, pf_seen, today, bag, early_stop=False, deep=False, deadline=None):
    """한 키워드를 first~last 페이지까지 훑어 bag 의 new/excluded 에 담는다.
    반환 (found, fresh, note, pf_stop, resume) — pf_stop = 이 플랫폼을 그만 볼 사유,
    resume = 중간에 멈춘 페이지 (끝까지 봤거나 결과가 끝났으면 None)."""
    found = fresh = 0
    for n in range(first, last + 1):
        if deadline and time.time() > deadline:
            return found, fresh, f"시간 상한 → {n}페이지부터 다음에", "", n
        st = open_search(pf, page, kw["keyword"], n, bot_wait)
        if st == "blocked":
            dump_evidence(page, pf, bag["out"])
        if st in ("bot_timeout", "blocked"):
            stop = "봇 확인 무응답 → 오늘 건너뜀" if st == "bot_timeout" else "차단 감지 → 중단"
            return found, fresh, stop, stop, n
        if st == "error":
            return found, fresh, f"{n}페이지 로딩 실패", "", n
        if st == "empty":
            return found, fresh, "", "", None
        scroll_through(page)
        items = pf.extract(page)
        if not items:
            if deep or n > first:  # 마지막 페이지 다음 = 결과 끝 (첫 페이지부터 0건일 때만 구조 변경 의심)
                return found, fresh, f"{n - 1}페이지에서 결과 끝", "", None
            note = f"{n}페이지 0건 — 사이트 구조 변경 의심"
            log(f"⚠ {pf.name} '{kw['keyword']}' {note}")
            return found, fresh, note, "", None
        page_new = 0
        for it in items:
            found += 1
            if it["id"] in pf_seen:
                continue
            pf_seen[it["id"]] = today
            page_new += 1
            row = {"platform": pf.name, "keyword": kw["keyword"], "model_type": kw.get("model_type", ""), **it}
            reason = judge(it, kw, bag["common_exclude"], bag["rules"]["_brands"])
            if reason:
                bag["excluded"].append({**row, "reason": reason})
            else:
                bag["new"].append(row)
                fresh += 1
        log(f"{pf.name} '{kw['keyword']}' p{n}: {len(items)}건 중 처음 본 것 {page_new}")
        # 신규순이라 한 페이지가 통째로 이미 본 것이면 뒤 페이지는 더 오래된 것 (깊게 보기는 끝까지)
        if early_stop and page_new == 0:
            return found, fresh, "", "", None
        human_pause()
    return found, fresh, "", "", None


def finish(label, cfg, args, rules, bag, summary, started, seen, deep):
    """썸네일 비교·카메라 판정·등급 → 엑셀 → 허브 업로드."""
    new_rows, excluded_rows = bag["new"], bag["excluded"]
    db = imgsim.RefDB.load() if new_rows else None
    if db:
        log(f"썸네일 {len(new_rows)}건 ↔ 위반 확정 이미지 {len(db.meta):,}건 비교 중…")
        imgsim.annotate(new_rows, db)
    if new_rows and camera.CLF.exists():
        try:
            n = sum(1 for r in new_rows if r.get("model_type") == "MagSafe iPhone case")
            log(f"맥세이프 케이스 {n}건 카메라 홀 판정 중…")
            camera.annotate(new_rows, imgsim.fetch_bytes)
        except Exception as e:  # 모델·torch 문제여도 자동 수집 결과는 저장
            log(f"⚠ 카메라 홀 판정 건너뜀: {e}")
    if cfg.get("triage") and new_rows:
        # 판매자 규모는 이번 단계에서 본 전체(필터 제외 포함) 기준
        counts = Counter((r["platform"], r.get("seller") or "") for r in new_rows + excluded_rows)
        triage.triage(new_rows, {k["keyword"]: k for k in cfg["keywords"]}, rules, counts)
        tiers = Counter(r["tier"] for r in new_rows)
        log(f"등급: A {tiers['A']} / B {tiers['B']} / C {tiers['C']} / X {tiers['X']}")
        deep.record(new_rows, {PLATFORMS[k].name for k in deep.platforms})
    out = Path(args.out) / f"patrol_{started:%Y-%m-%d_%H%M}{label}.xlsx"
    finished = datetime.now()
    report.write(out, new_rows, excluded_rows, summary, started, finished)
    log(f"저장: {out}  (신규 {len(new_rows)}건 / 제외 {len(excluded_rows)}건)")
    # 팀 허브 '자동 수집 결과'로 업로드 (--dry 면 안 올림). 실패해도 엑셀은 위에서 이미 저장됨
    if not args.dry and not args.no_upload and cfg.get("hub", {}).get("enabled", True):
        registered = hub.recently_registered(seen, PLATFORMS, rules.get("_bpm"))
        hub.upload(cfg.get("hub", {}), new_rows, summary, started, finished, registered,
                   db.product_type_of if db else (lambda m: None), log)


def run(args):
    cfg = load_json(args.config, None)
    if cfg is None:
        sys.exit(f"설정 파일이 없습니다: {args.config}  (keywords.example.json 을 복사해 만드세요)")
    keywords = [k for k in cfg["keywords"] if k.get("enabled", True)]
    if args.limit:
        keywords = keywords[: args.limit]
    pages = args.pages or cfg.get("pages", 3)
    bpm_cache = None
    if cfg.get("bpm", {}).get("secret_key"):
        bpm_cache = bpm.sync(cfg["bpm"], log)          # 등록 중복·공식 판매처·위반 이력 판매자
        bpm.update_ref_images(cfg["bpm"], bpm_cache, log)  # 새 위반 확정 이미지 → 기준 DB
    rules = triage.load_rules(cfg, bpm_cache)
    pf_keys = args.platforms.split(",") if args.platforms else cfg.get("platforms", ORDER)
    platforms = [PLATFORMS[k] for k in pf_keys]

    seen = load_json(SEEN_PATH, {})
    today = datetime.now().strftime("%Y-%m-%d")
    sweep = load_json(SWEEP_PATH, {})
    sweep_per_day = cfg.get("sweep_per_day", 8)
    deep = Deep(cfg.get("deep"), keywords, DEEP_PATH, today)
    deep.maybe_regroup(log)
    bag_of = lambda: {"new": [], "excluded": [], "common_exclude": cfg.get("common_exclude", []),
                      "rules": rules, "out": args.out}

    with browser(args) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # ① 매일 수집 — 전 플랫폼, 신규순 1~pages 페이지
        # 키워드마다 처음 한 번은 1~pages 를 끝까지(조기 종료 없이) = '전체 훑기', 플랫폼당 하루 sweep_per_day 개.
        # 이미 본 상품만 있는 페이지에서 멈추는 규칙 때문에, 훑기 전엔 4페이지 이후를 영영 못 봄 (10-28)
        if not args.deep_only:
            started, bag, summary = datetime.now(), bag_of(), []
            for pf in platforms:
                pf_seen = seen.setdefault(pf.key, {})
                had_history = bool(pf_seen)
                log(f"=== {pf.name} 시작 (키워드 {len(keywords)}개 × 최대 {pages}페이지)")
                skip = pf.prepare(page)
                if skip:
                    log(f"⚠ {pf.name}: {skip} → 건너뜀")
                    dump_evidence(page, pf, args.out, "skip")
                    summary.append({"platform": pf.name, "keyword": "-", "found": 0, "new": 0, "note": skip})
                    continue
                pf_sweep = sweep.setdefault(pf.key, {})
                budget = sweep_per_day
                for kw in keywords:
                    full = kw["keyword"] not in pf_sweep and budget > 0
                    if full:
                        budget -= 1
                    last = pages if (full or kw["keyword"] in pf_sweep) else min(pages, UNSWEPT_PAGES)
                    found, fresh, note, stop, resume = scan(pf, page, kw, 1, last, args.bot_wait, pf_seen, today, bag,
                                                            early_stop=had_history and not full)
                    if full and resume is None and not stop:
                        pf_sweep[kw["keyword"]] = today
                        note = f"전체 훑기 완료 (1~{pages}p)" + (f" / {note}" if note else "")
                    summary.append({"platform": pf.name, "keyword": kw["keyword"], "found": found, "new": fresh, "note": note})
                    if stop:
                        log(f"{pf.name}: {stop}")
                        break
                    human_pause(2, 5)
                if not args.dry:
                    save_json(SEEN_PATH, seen)
                    save_json(SWEEP_PATH, sweep)
            finish("", cfg, args, rules, bag, summary, started, seen, deep)

        # ② 깊게 보기 — 지마켓·옥션, 오늘 차례 키워드만 pages+1 ~ 마지막 페이지
        # 깊게 보기 플랫폼(지마켓·옥션)이 이번 실행 대상에 없으면 생략 (예: --platforms coupang 시험)
        # 1~pages 전체 훑기가 끝난 키워드만 (아니면 pages+1 부터 보는 깊게 보기가 그 사이를 건너뜀)
        swept = lambda kw: all(kw["keyword"] in sweep.get(k, {}) for k in deep.platforms if k in pf_keys)
        picks = deep.todays(swept) if deep.enabled and not args.no_deep and set(deep.platforms) & set(pf_keys) else []
        if picks:
            started, bag, summary = datetime.now(), bag_of(), []
            deadline = time.time() + deep.cfg["max_minutes"] * 60
            log("=== 깊게 보기: " + ", ".join(f"{k['keyword']}({deep.group(k['keyword'])})" for k in picks))
            for key in deep.platforms:
                if key not in pf_keys or time.time() > deadline:
                    continue
                pf = PLATFORMS[key]
                pf_seen = seen.setdefault(key, {})
                skip = pf.prepare(page)
                if skip:
                    log(f"⚠ {pf.name}: {skip} → 깊게 보기 건너뜀")
                    continue
                for kw in picks:
                    first = deep.start_page(kw["keyword"], key, pages + 1)
                    if first is None:
                        continue
                    found, fresh, note, stop, resume = scan(
                        pf, page, kw, first, deep.cfg["max_page"], deep.cfg["bot_wait"], pf_seen, today, bag,
                        deep=True, deadline=deadline)
                    deep.mark(kw["keyword"], key, resume)
                    summary.append({"platform": pf.name, "keyword": kw["keyword"], "found": found, "new": fresh,
                                    "note": f"깊게 보기 {first}p~" + (f" / {note}" if note else "")})
                    if stop:
                        log(f"{pf.name}: {stop} (깊게 보기는 다음 실행에서 {resume}페이지부터)")
                        break
                    if time.time() > deadline:
                        log("깊게 보기 시간 상한 → 나머지는 다음 실행에서 이어감")
                        break
                    human_pause(2, 5)
                if not args.dry:
                    save_json(SEEN_PATH, seen)
            finish("_deep", cfg, args, rules, bag, summary, started, seen, deep)

    if args.dry:
        log("--dry: 본 상품 기록(seen.json)·깊게 보기 진행은 갱신하지 않음")
    else:
        deep.save()


def main():
    ap = argparse.ArgumentParser(description="자동 수집 실행기 (1단계)")
    ap.add_argument("--config", default=str(HERE / "keywords.local.json"))
    ap.add_argument("--platforms", help="쉼표 구분: gmarket,auction,smartstore,11st,coupang")
    ap.add_argument("--pages", type=int, help="키워드당 페이지 수 (기본: 설정 파일 값)")
    ap.add_argument("--limit", type=int, help="앞에서부터 키워드 N개만 (시험용)")
    ap.add_argument("--bot-wait", type=float, default=30, help="봇 확인 대기 시간(분)")
    ap.add_argument("--out", default=str(HERE / "output"))
    ap.add_argument("--dry", action="store_true", help="본 상품 기록을 남기지 않음 (시험용, 허브 업로드도 안 함)")
    ap.add_argument("--no-upload", action="store_true", help="팀 허브로 올리지 않음")
    ap.add_argument("--launch", action="store_true", help="Playwright 가 크롬을 직접 띄움 (기본: 평소처럼 실행 후 연결)")
    ap.add_argument("--driver", choices=["uc", "playwright"], default="uc",
                    help="브라우저 방식 (기본 uc = undetected-chromedriver)")
    ap.add_argument("--no-deep", action="store_true", help="깊게 보기(지마켓·옥션 끝 페이지까지) 생략")
    ap.add_argument("--deep-only", action="store_true", help="매일 수집은 건너뛰고 깊게 보기만 (시험용)")
    ap.add_argument("--login", nargs="?", const="naver", choices=["naver", "coupang"],
                    help="자동 수집 크롬에 로그인 (1회): 생략 = 네이버(스마트스토어용), coupang = 쿠팡")
    args = ap.parse_args()
    login(args) if args.login else run(args)


if __name__ == "__main__":
    main()

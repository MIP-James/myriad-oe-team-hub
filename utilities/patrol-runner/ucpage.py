"""UC(undetected-chromedriver) 브라우저를 Playwright page 처럼 쓰게 하는 얇은 어댑터.

자동 수집 코드(platforms.py·patrol.py)가 쓰는 메서드만 흉내 낸다:
goto / reload / title / url / inner_text / locator().count() / evaluate / mouse.wheel / screenshot / context.cookies.
사용자 결정(2026-10-27): Playwright 연결 방식은 네이버에서 페이지마다 제한 화면 → UC 로 전환.
"""
import time
from contextlib import contextmanager


def detect_chrome_major():
    """레지스트리의 설치 Chrome major 버전 (Enforcement Tools 와 같은 방식). 실패 시 None."""
    try:
        import winreg
        for hive, path in ((winreg.HKEY_CURRENT_USER, r"Software\Google\Chrome\BLBeacon"),
                           (winreg.HKEY_LOCAL_MACHINE, r"Software\Google\Chrome\BLBeacon"),
                           (winreg.HKEY_LOCAL_MACHINE, r"Software\Wow6432Node\Google\Chrome\BLBeacon")):
            try:
                with winreg.OpenKey(hive, path) as key:
                    return int(str(winreg.QueryValueEx(key, "version")[0]).split(".")[0])
            except OSError:
                continue
    except Exception:
        pass
    return None


class _Resp:
    status = None  # Selenium 은 HTTP 상태코드를 주지 않음 → 화면 상태로만 판정


class _Locator:
    def __init__(self, driver, sel):
        self.driver, self.sel = driver, sel

    def count(self):
        from selenium.webdriver.common.by import By
        return len(self.driver.find_elements(By.CSS_SELECTOR, self.sel))


class _Mouse:
    def __init__(self, driver):
        self.driver = driver

    def wheel(self, dx, dy):
        self.driver.execute_script("window.scrollBy(arguments[0], arguments[1]);", dx, dy)


class _Context:
    def __init__(self, page):
        self.page = page
        self.pages = [page]

    def new_page(self):
        return self.page

    def cookies(self, url=None):
        """모든 도메인 쿠키 (CDP) — Selenium get_cookies 는 현재 도메인 것만 줌."""
        try:
            return self.page.driver.execute_cdp_cmd("Network.getAllCookies", {}).get("cookies", [])
        except Exception:
            return self.page.driver.get_cookies()


class UCPage:
    def __init__(self, driver):
        self.driver = driver
        self.mouse = _Mouse(driver)
        self.context = _Context(self)

    @property
    def url(self):
        return self.driver.current_url

    def goto(self, url, wait_until=None, timeout=45000, referer=None):
        from selenium.common.exceptions import TimeoutException
        from playwright.sync_api import TimeoutError as PWTimeout
        self.driver.set_page_load_timeout(timeout / 1000)
        try:
            self.driver.get(url)
        except TimeoutException:
            raise PWTimeout(f"timeout {url}")
        return _Resp()

    def reload(self, wait_until=None, timeout=45000):
        self.driver.refresh()

    def wait_for_load_state(self, state=None, timeout=None):
        time.sleep(1.5)

    def title(self):
        return self.driver.title

    def inner_text(self, selector="body", timeout=None):
        from selenium.webdriver.common.by import By
        return self.driver.find_element(By.CSS_SELECTOR, selector).text

    def locator(self, sel):
        return _Locator(self.driver, sel)

    def evaluate(self, js, arg=None):
        src = js.strip()
        if src.startswith("(") and "=>" in src.split("\n", 1)[0] or src.startswith("function"):
            return self.driver.execute_script(f"return ({src})(arguments[0]);", arg)
        return self.driver.execute_script(f"return ({src});")

    def screenshot(self, path, full_page=False):
        self.driver.save_screenshot(str(path))


@contextmanager
def open_uc(profile_dir):
    import undetected_chromedriver as uc
    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1366,900")
    opts.add_argument("--no-first-run")
    opts.add_argument("--no-default-browser-check")
    # 원격 창을 닫아(연결 끊김) 화면을 아무도 안 봐도 크롬이 스스로 느려지지 않게 (예약 실행용)
    opts.add_argument("--disable-backgrounding-occluded-windows")
    opts.add_argument("--disable-renderer-backgrounding")
    opts.add_argument("--disable-background-timer-throttling")
    opts.page_load_strategy = "eager"  # DOM 준비까지만 (광고 스크립트로 load 가 늦는 사이트 대비)
    driver = uc.Chrome(options=opts, user_data_dir=str(profile_dir), headless=False,
                       use_subprocess=True, version_main=detect_chrome_major())
    driver.implicitly_wait(0)
    page = UCPage(driver)
    try:
        yield page.context
    finally:
        try:
            driver.quit()  # 정상 종료 → 로그인 쿠키 유지
        except Exception:
            pass

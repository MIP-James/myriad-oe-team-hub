"""지마켓·옥션 '깊게 보기' — 키워드를 돌아가며 마지막 페이지(최대 50)까지 본다.

매일 수집(신규순 1~pages, 기본 20페이지)이 끝난 뒤, 오늘 차례인 키워드만 그다음 페이지부터 끝까지.
- 그룹별 주기: 상 7일 / 중 14일 / 하 30일. 가장 오래 밀린 키워드부터 하루 per_day 개
- 막히면(봇 확인·차단·시간 초과) 진행 위치를 저장 → 다음 실행에서 그 페이지부터 이어감
- 그룹 = 지마켓·옥션 결과의 A×3 + B 점수로 regroup_days 마다 다시 나눔 (상위 1/3 상, 하위 1/3 하)
  초기 그룹 = deep_seed.local.json (허브 결과 2026-10-27~28 집계), 고정 = 설정 "deep.pin"
상태 = %LOCALAPPDATA%\\MyriadPatrol\\deep.json
"""
import json
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED_PATH = HERE / "deep_seed.local.json"
GROUPS = ("상", "중", "하")
DEFAULTS = {
    "enabled": True,
    "platforms": ["gmarket", "auction"],
    "max_page": 50,          # 지마켓·옥션 검색 결과 페이지 상한
    "per_day": 5,
    "interval_days": {"상": 7, "중": 14, "하": 30},
    "regroup_days": 30,
    "max_minutes": 150,      # 깊게 보기 전체 시간 상한 → 넘으면 멈추고 다음 날 이어감
    "bot_wait": 2,           # 분. 지마켓 확인은 보통 몇 초 뒤 저절로 통과, 사람 대기는 안 함
    "pin": {},               # {"키워드": "상"} — 자동 재분류에서 빠짐
}


def _load(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


class Deep:
    def __init__(self, cfg, keywords, state_path, today):
        self.cfg = {**DEFAULTS, **(cfg or {})}
        self.path = Path(state_path)
        self.today = today
        self.keywords = keywords
        st = _load(self.path, {})
        self.groups = st.get("groups", {})
        self.groups_at = st.get("groups_at") or today
        self.stats = st.get("stats", {})        # {키워드: {"A": n, "B": n}} — 지마켓·옥션 결과만
        self.last = st.get("last", {})          # {키워드: 마지막으로 끝까지 본 날}
        self.progress = st.get("progress", {})  # {키워드: {플랫폼: 다음 페이지 | "done"}}
        seed = _load(SEED_PATH, {})
        for kw in keywords:
            self.groups.setdefault(kw["keyword"], seed.get(kw["keyword"], "중"))

    @property
    def enabled(self):
        return bool(self.cfg["enabled"])

    @property
    def platforms(self):
        return self.cfg["platforms"]

    def group(self, text):
        return self.cfg["pin"].get(text) or self.groups.get(text, "중")

    def overdue(self, text):
        """주기를 넘긴 날 수 (음수 = 아직 차례 아님). 한 번도 안 봤으면 아주 큼."""
        last = self.last.get(text)
        if not last:
            return 10_000
        return _days(last, self.today) - self.cfg["interval_days"][self.group(text)]

    def todays(self, eligible=lambda kw: True):
        """오늘 깊게 볼 키워드: 이어갈 것 → 많이 밀린 것 → 상·중·하 순. eligible = 앞 페이지 전체 훑기 끝난 것."""
        due = [kw for kw in self.keywords if eligible(kw)
               and (kw["keyword"] in self.progress or self.overdue(kw["keyword"]) >= 0)]
        due.sort(key=lambda kw: (kw["keyword"] not in self.progress, -self.overdue(kw["keyword"]),
                                 GROUPS.index(self.group(kw["keyword"]))))
        return due[: self.cfg["per_day"]]

    def start_page(self, text, pf_key, default):
        """None = 이 플랫폼은 이미 끝까지 봄."""
        p = self.progress.get(text, {}).get(pf_key, default)
        return None if p == "done" else p

    def mark(self, text, pf_key, next_page):
        """next_page=None 이면 끝까지 본 것. 모든 플랫폼이 끝나면 오늘을 마지막 날로."""
        prog = self.progress.setdefault(text, {})
        prog[pf_key] = "done" if next_page is None else next_page
        if all(prog.get(k) == "done" for k in self.platforms):
            self.last[text] = self.today
            del self.progress[text]

    def record(self, rows, platform_names):
        """등급이 매겨진 결과 중 지마켓·옥션 A·B 를 키워드별로 셈 (재분류 근거)."""
        for r in rows:
            if r.get("platform") in platform_names and r.get("tier") in ("A", "B"):
                s = self.stats.setdefault(r.get("keyword") or "", {"A": 0, "B": 0})
                s[r["tier"]] += 1

    def maybe_regroup(self, log=print):
        if _days(self.groups_at, self.today) < self.cfg["regroup_days"] or not self.stats:
            return
        texts = [kw["keyword"] for kw in self.keywords if kw["keyword"] not in self.cfg["pin"]]
        score = lambda t: self.stats.get(t, {}).get("A", 0) * 3 + self.stats.get(t, {}).get("B", 0)
        texts.sort(key=score, reverse=True)
        third = len(texts) // 3
        changed = []
        for i, t in enumerate(texts):
            g = "상" if i < third else ("하" if i >= len(texts) - third else "중")
            if self.groups.get(t) != g:
                changed.append(f"{t} {self.groups.get(t, '-')}→{g}")
            self.groups[t] = g
        self.groups_at, self.stats = self.today, {}
        log(f"깊게 보기 그룹 재분류 ({len(changed)}개 변경){': ' + ', '.join(changed) if changed else ''}")

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(self.path) + ".tmp")
        tmp.write_text(json.dumps({"groups": self.groups, "groups_at": self.groups_at, "stats": self.stats,
                                   "last": self.last, "progress": self.progress},
                                  ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

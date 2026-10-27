"""상품명 속 아이폰 기종 → 카메라 홀 모양 (약한 정답 라벨).

맥세이프 케이스 판정 기준(사용자 확정 2026-10-27): 정사각형으로 뚫린 카메라 홀만 대상.
  정사각: 11~15 전 모델, 16 Pro / 16 Pro Max
  비정사각: 16 / 16 Plus(세로 알약), 16e(단일 렌즈), 17(세로 알약), 17 Pro / 17 Pro Max(가로 전폭 바), Air(가로 바)
여러 그룹이 섞인 제목("아이폰 17 16 15 14")은 판단 불가 → None.
"""
import re

_MODEL = re.compile(r"(?:아이폰|iphone)\s*((?:\d{2}\s*(?:e|프로|pro|맥스|max|플러스|plus|미니|mini|\s|,|/|-)*)+)", re.I)
_NUM = re.compile(r"(?<!\d)(1[1-8])(?!\d)\s*(e(?![a-z])|프로|pro)?", re.I)


def camera_shape(title):
    """'square' / 'other' / None(판단 불가)."""
    t = (title or "").lower()
    groups = set()
    if re.search(r"(아이폰|iphone)\s*(에어|air)(?![a-z])", t):
        groups.add("other")
    for m in _MODEL.finditer(t):
        seg = m.group(1)
        nums = _NUM.findall(seg)
        pro_anywhere = bool(re.search(r"프로|pro", seg))
        for n, suffix in nums:
            n = int(n)
            if n >= 18:
                return None  # 아직 없는 기종 표기 → 판단 보류
            if n <= 15:
                groups.add("square")
            elif n == 16:
                if suffix and suffix.lower() == "e":
                    groups.add("other")
                elif suffix or (pro_anywhere and len(nums) == 1):
                    groups.add("square")
                else:
                    groups.add("other")
            else:  # 17 전 모델
                groups.add("other")
    return groups.pop() if len(groups) == 1 else None

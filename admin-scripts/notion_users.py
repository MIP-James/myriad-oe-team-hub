"""
Notion 워크스페이스의 사용자 ID 조회 (1회용).

사용법:
  방법 A) 환경변수로 토큰 전달 (가장 안전):
    set NOTION_TOKEN=secret_xxxxx
    python notion_users.py

  방법 B) 그냥 실행 후 토큰 붙여넣기 (화면에 보임 — 1인 PC 면 OK):
    python notion_users.py

목적:
  Cloudflare Pages 환경변수 NOTION_AUTHOR_ID 에 넣을 본인 user_id 추출용.
"""
import json
import os
import sys
import urllib.request

NOTION_VERSION = "2022-06-28"
DOMAIN_FILTER = "myriadip.com"


def main() -> int:
    print("=" * 60)
    print("Notion 워크스페이스 사용자 조회")
    print("=" * 60)
    print()

    # 1) 환경변수 우선
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if token:
        print("(환경변수 NOTION_TOKEN 사용)")
    else:
        print("Notion Integration Secret 을 붙여넣고 Enter 눌러주세요.")
        print("(노션 → 설정 → 내부 API 통합 → Myriad Team Hub → 액세스 토큰)")
        print("CMD: 마우스 오른쪽 클릭 / PowerShell: Ctrl+V")
        print()
        try:
            token = input("토큰: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n취소되었습니다.")
            return 1
    if not token:
        print("토큰이 비어 있습니다.")
        return 1

    users = []
    cursor = None
    while True:
        url = "https://api.notion.com/v1/users?page_size=100"
        if cursor:
            url += f"&start_cursor={cursor}"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": NOTION_VERSION,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"\n[오류] HTTP {e.code}: {body}")
            return 2
        except Exception as e:
            print(f"\n[오류] {e}")
            return 2

        for u in data.get("results", []):
            if u.get("type") != "person":
                continue
            email = (u.get("person") or {}).get("email", "")
            if DOMAIN_FILTER and DOMAIN_FILTER not in email:
                continue
            users.append({
                "id": u["id"],
                "name": u.get("name", ""),
                "email": email,
            })

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    if not users:
        print(f"\n@{DOMAIN_FILTER} 도메인 사용자를 찾지 못했습니다.")
        print("(Integration 이 워크스페이스에 연결돼 있는지 확인하세요)")
        return 3

    print()
    print(f"@{DOMAIN_FILTER} 도메인 사용자 {len(users)}명")
    print("-" * 60)
    for u in sorted(users, key=lambda x: x["email"]):
        print(f"이름  : {u['name']}")
        print(f"이메일: {u['email']}")
        print(f"ID    : {u['id']}    ← Cloudflare 환경변수 NOTION_AUTHOR_ID")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

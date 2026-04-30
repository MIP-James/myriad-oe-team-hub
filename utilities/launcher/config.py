# -*- coding: utf-8 -*-
"""설정 파일 로드/저장.

config.json 스키마 (v2 — Bearer token 인증):
    {
      "api_base_url": "https://myriad-oe-team-hub.pages.dev",
      "api_token": "myrlnch_<64hex>",
      "device_id": "<uuid 또는 null — 첫 폴링 시 서버에서 생성/링크>",
      "device_name": "James 노트북",
      "user_email": "james@myriadip.com",        # optional, 표시용
      "utility_paths": { "<slug>": "<exe path>" } # 수동 override
    }

이전 v1 (supabase 세션) 스키마는 더 이상 호환되지 않음 — setup 재실행 필요.
"""
import json
import os
import sys
from pathlib import Path


def _base_dir() -> Path:
    """런처가 스크립트로 실행되거나 PyInstaller 로 패키징된 경우 모두 대응."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


CONFIG_PATH = _base_dir() / "config.json"

# 기본 API base — 사용자가 dev 환경에서 다른 URL 쓰고 싶으면 config.json 에서 override
DEFAULT_API_BASE_URL = "https://myriad-oe-team-hub.pages.dev"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG_PATH)


def is_v2_config(config: dict) -> bool:
    """v2 (Bearer token) 스키마인지 검증."""
    return bool(config.get("api_token") and str(config["api_token"]).startswith("myrlnch_"))

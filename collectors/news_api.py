"""웹 화면에서 쓰는 뉴스 수집 API.

GET /api/news?keywords=AI,스타트업
→ 언론사 RSS에서 키워드에 맞는 최근 기사를 골라 NewsItem 목록으로 돌려준다.
   반환된 news는 그대로 POST /api/summarize 의 news로 보낼 수 있다.

RSS 피드는 10분 동안 서버 메모리에 캐시한다. 여러 사용자가 연달아 요청해도
언론사 서버에 같은 요청을 반복하지 않고, 응답도 빨라진다.
"""

import threading
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from collectors.rss_news import KST, fetch_all_feeds, matched_keywords, select_news


router = APIRouter(tags=["news"])

CACHE_TTL_SECONDS = 600
MAX_KEYWORDS = 20
MAX_KEYWORD_LENGTH = 100

_cache: dict = {"items": None, "fetched_at": 0.0}
_lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache["items"], _cache["fetched_at"] = None, 0.0


def parse_keywords(raw: str) -> list[str]:
    """'AI, 스타트업,,AI' → ['AI', '스타트업'] (공백 제거, 빈 값·중복 제거, 순서 유지)"""
    keywords: list[str] = []
    for part in raw.split(","):
        kw = part.strip()
        if kw and kw not in keywords:
            keywords.append(kw)

    if not keywords:
        raise HTTPException(status_code=422, detail="관심 키워드를 한 개 이상 입력하세요.")
    if len(keywords) > MAX_KEYWORDS:
        raise HTTPException(status_code=422, detail=f"관심 키워드는 최대 {MAX_KEYWORDS}개까지 입력할 수 있어요.")
    if any(len(kw) > MAX_KEYWORD_LENGTH for kw in keywords):
        raise HTTPException(status_code=422, detail=f"키워드는 {MAX_KEYWORD_LENGTH}자 이하로 입력하세요.")
    return keywords


def get_feed_items() -> tuple[list[dict], float, bool]:
    """캐시된 피드 기사를 돌려준다. 캐시가 없거나 오래됐으면 새로 수집한다.
    반환: (기사 목록, 수집 시각(epoch), 캐시 사용 여부)"""
    with _lock:  # 동시에 들어온 요청이 RSS를 중복 수집하지 않도록 한 번에 하나만 수집
        fresh = _cache["items"] is not None and time.time() - _cache["fetched_at"] < CACHE_TTL_SECONDS
        if fresh:
            return _cache["items"], _cache["fetched_at"], True

        items = fetch_all_feeds()
        if not items:
            # 전부 실패한 결과는 캐시하지 않는다 (다음 요청에서 다시 시도)
            raise HTTPException(
                status_code=503,
                detail="뉴스 피드를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
            )
        _cache["items"], _cache["fetched_at"] = items, time.time()
        return items, _cache["fetched_at"], False


@router.get("/api/news")
def get_news(
    keywords: str = Query(..., max_length=2500, description="쉼표로 구분한 관심 키워드 (예: AI,스타트업)"),
    hours: int = Query(24, ge=1, le=72, description="최근 몇 시간 이내 기사"),
    max_items: int = Query(30, alias="max", ge=1, le=30, description="최대 기사 수"),
):
    kws = parse_keywords(keywords)
    items, fetched_at, cached = get_feed_items()
    news = select_news(items, kws, hours, max_items)

    counts = {kw: 0 for kw in kws}
    for n in news:
        for kw in matched_keywords(f"{n['title']} {n['summary']}", kws):
            counts[kw] += 1

    return {
        "keywords": kws,
        "news": news,
        "keyword_counts": counts,  # 화면에서 "AI 12건 · 스타트업 3건"처럼 보여줄 때 사용
        "collected_at": datetime.fromtimestamp(fetched_at, KST).isoformat(timespec="seconds"),
        "cached": cached,
    }

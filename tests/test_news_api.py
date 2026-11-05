"""GET /api/news 테스트 — RSS 수집은 모의 처리한다."""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import collectors.news_api as news_api
import main
from collectors.rss_news import KST


client = TestClient(main.app)


def _item(i, title, minutes_ago=10):
    published = (datetime.now(KST) - timedelta(minutes=minutes_ago)).isoformat()
    return {
        "id": f"news-{i}",
        "title": title,
        "summary": f"{title} 관련 내용",
        "source": "테스트뉴스",
        "url": f"https://example.com/{i}",
        "published_at": published,
    }


FEED_ITEMS = [
    _item(1, "생성형 AI 개발 도구 공개"),
    _item(2, "초기 스타트업 투자 동향"),
    _item(3, "주말 지역 축제 개최"),
    _item(4, "AI 반도체 수출 증가"),
    _item(5, "오래된 AI 기사", minutes_ago=60 * 30),
]


@pytest.fixture(autouse=True)
def reset_cache():
    news_api.clear_cache()
    yield
    news_api.clear_cache()


def test_returns_keyword_matched_news_in_newsitem_format():
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS):
        res = client.get("/api/news", params={"keywords": "AI, 스타트업"})

    assert res.status_code == 200
    data = res.json()
    ids = {n["id"] for n in data["news"]}
    assert ids == {"news-1", "news-2", "news-4"}  # 축제·24시간 지난 기사 제외
    assert data["keywords"] == ["AI", "스타트업"]
    assert data["keyword_counts"] == {"AI": 2, "스타트업": 1}
    for n in data["news"]:
        main.NewsItem(**n)  # /api/summarize에 그대로 보낼 수 있는 형식
        assert "_matched" not in n


def test_response_can_be_sent_to_summarize_as_is():
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS):
        news = client.get("/api/news", params={"keywords": "AI"}).json()["news"]

    with patch("main.generate_summary", return_value={"results": [], "excluded_news": []}) as summarize:
        res = client.post("/api/summarize", json={"user_keywords": ["AI"], "news": news})

    assert res.status_code == 200
    summarize.assert_called_once()


def test_feeds_are_cached_between_requests():
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS) as fetch:
        first = client.get("/api/news", params={"keywords": "AI"}).json()
        second = client.get("/api/news", params={"keywords": "스타트업"}).json()

    assert fetch.call_count == 1
    assert first["cached"] is False
    assert second["cached"] is True


def test_cache_expires(monkeypatch):
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS) as fetch:
        client.get("/api/news", params={"keywords": "AI"})
        monkeypatch.setattr(news_api, "CACHE_TTL_SECONDS", 0)
        client.get("/api/news", params={"keywords": "AI"})

    assert fetch.call_count == 2


def test_all_feeds_failed_returns_503_and_is_not_cached():
    with patch.object(news_api, "fetch_all_feeds", side_effect=[[], FEED_ITEMS]) as fetch:
        failed = client.get("/api/news", params={"keywords": "AI"})
        retried = client.get("/api/news", params={"keywords": "AI"})

    assert failed.status_code == 503
    assert retried.status_code == 200
    assert fetch.call_count == 2


def test_max_limits_result_count():
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS):
        data = client.get("/api/news", params={"keywords": "AI", "max": 1}).json()
    assert len(data["news"]) == 1


@pytest.mark.parametrize("params", [
    {},                                   # keywords 누락
    {"keywords": " , ,"},                 # 빈 키워드
    {"keywords": ",".join(f"k{i}" for i in range(21))},  # 21개
    {"keywords": "가" * 101},             # 너무 긴 키워드
    {"keywords": "AI", "max": 31},
    {"keywords": "AI", "hours": 0},
])
def test_invalid_input_returns_422(params):
    with patch.object(news_api, "fetch_all_feeds", return_value=FEED_ITEMS) as fetch:
        res = client.get("/api/news", params=params)
    assert res.status_code == 422
    fetch.assert_not_called()  # 잘못된 요청에는 RSS를 수집하지 않음


def test_duplicate_keywords_are_merged():
    assert news_api.parse_keywords("AI, 스타트업 ,AI,,") == ["AI", "스타트업"]

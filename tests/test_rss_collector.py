"""RSS 수집기 테스트 — 네트워크 없이 샘플 RSS 문자열로 검증한다."""

from datetime import datetime

import feedparser

from collectors.rss_news import (
    KST,
    balance_by_keyword,
    clean_text,
    clean_url,
    filter_and_dedupe,
    make_news_id,
    matched_keywords,
    parse_entries,
)
from main import NewsItem


SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>테스트</title>
<item>
  <title><![CDATA[국내 기업, <b>생성형 AI</b> 개발 도구 공개]]></title>
  <link>https://example.com/a</link>
  <description><![CDATA[<p>코드 작성을 돕는 &quot;AI 도구&quot;가 공개됐다.</p>]]></description>
  <pubDate>Wed, 21 Oct 2026 00:00:00 GMT</pubDate>
</item>
<item>
  <title>국내 기업, 생성형 AI 개발 도구 공개</title>
  <link>https://example.com/a-copy</link>
  <description>같은 기사 다른 URL</description>
  <pubDate>Wed, 21 Oct 2026 00:10:00 GMT</pubDate>
</item>
<item>
  <title>주말 지역 축제 개최</title>
  <link>https://example.com/b</link>
  <description>EMAIL 이벤트도 열린다.</description>
  <pubDate>Wed, 21 Oct 2026 01:00:00 GMT</pubDate>
</item>
<item>
  <title>스타트업 투자 동향</title>
  <link>https://example.com/c</link>
  <description>오래된 기사</description>
  <pubDate>Mon, 12 Oct 2026 00:00:00 GMT</pubDate>
</item>
</channel></rss>"""

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=KST)


def parsed_items():
    return parse_entries(feedparser.parse(SAMPLE_RSS), "테스트뉴스")


def test_clean_text_removes_html_and_entities():
    assert clean_text("<b>AI</b> &quot;도구&quot;") == 'AI "도구"'


def test_parse_entries_matches_newsitem_schema():
    items = parsed_items()
    assert len(items) == 4
    for item in items:
        NewsItem(**item)  # 백엔드 요청 스키마와 호환되는지 확인

    first = items[0]
    assert first["title"] == "국내 기업, 생성형 AI 개발 도구 공개"
    assert first["source"] == "테스트뉴스"
    assert first["published_at"] == "2026-10-21T09:00:00+09:00"  # GMT → KST
    assert first["id"] == make_news_id("https://example.com/a")


def test_keyword_word_boundary():
    assert matched_keywords("생성형 AI가 공개됐다", ["AI"]) == ["AI"]
    assert matched_keywords("EMAIL 이벤트", ["AI"]) == []
    assert matched_keywords("스타트업의 투자", ["스타트업"]) == ["스타트업"]


def test_filter_and_dedupe():
    news = filter_and_dedupe(parsed_items(), ["AI", "스타트업"], hours=24, now=NOW)
    urls = [n["url"] for n in news]

    assert urls == ["https://example.com/a"]  # 제목 중복 제거
    assert "https://example.com/b" not in urls  # EMAIL은 AI로 매칭되지 않음
    assert "https://example.com/c" not in urls  # 24시간 이전 기사 제외


def test_clean_url_removes_tracking_params():
    url = "https://www.khan.co.kr/article/1/?utm_source=khan_rss&utm_medium=rss&id=7"
    assert clean_url(url) == "https://www.khan.co.kr/article/1/?id=7"


def test_multi_word_keyword():
    text = "개발자 채용 시장 냉각에 이직 준비 늘어"
    assert matched_keywords(text, ["개발자 이직"]) == ["개발자 이직"]
    assert matched_keywords("개발자 채용 늘어", ["개발자 이직"]) == []


def test_balance_by_keyword_prevents_domination():
    items = [
        {"id": f"ai-{i}", "published_at": f"2026-10-21T2{i}:00:00+09:00", "_matched": ["AI"]}
        for i in range(5)
    ]
    items.append({"id": "st-1", "published_at": "2026-10-21T08:00:00+09:00", "_matched": ["스타트업"]})
    items.sort(key=lambda x: x["published_at"], reverse=True)

    picked = balance_by_keyword(items, ["AI", "스타트업"], max_items=3)
    ids = {p["id"] for p in picked}
    assert len(picked) == 3
    assert "st-1" in ids  # 오래됐어도 다른 키워드 기사가 밀려나지 않음

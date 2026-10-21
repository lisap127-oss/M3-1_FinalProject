"""언론사 RSS에서 뉴스를 수집해 요약 API(/api/summarize) 입력 형식으로 변환한다.

실행 예시:
    python -m collectors.rss_news --keywords AI 스타트업 "개발자 이직"

결과는 기본적으로 data/collected_news.json 에 저장되며,
{"user_keywords": [...], "news": [...]} 형식이라 /api/summarize 에 그대로 보낼 수 있다.
"""

import argparse
import calendar
import hashlib
import html
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser


ROOT = Path(__file__).resolve().parent.parent
FEEDS_PATH = Path(__file__).resolve().parent / "feeds.json"
DEFAULT_OUT = ROOT / "data" / "collected_news.json"

KST = timezone(timedelta(hours=9))
USER_AGENT = "DayBriefBot/0.1 (student project)"
SUMMARY_MAX_LEN = 300


# ---------- 텍스트 정리 ----------

def clean_text(text: str | None) -> str:
    """HTML 태그와 엔티티(&quot; 등)를 제거하고 공백을 정리한다."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def truncate(text: str, max_len: int = SUMMARY_MAX_LEN) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len].rstrip() + "…"


TRACKING_PARAMS = ("utm_", "fbclid", "gclid")


def clean_url(url: str) -> str:
    """utm_source 같은 추적용 파라미터를 제거한다."""
    parts = urlsplit(url.strip())
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(TRACKING_PARAMS)
    ]
    return urlunsplit(parts._replace(query=urlencode(query)))


def make_news_id(url: str) -> str:
    """URL 기반 고정 ID. 같은 기사는 몇 번 수집해도 같은 ID가 나온다."""
    digest = hashlib.sha1(url.strip().encode("utf-8")).hexdigest()[:12]
    return f"news-{digest}"


def to_kst_iso(entry) -> str | None:
    """feedparser가 UTC로 파싱한 게시 시각을 KST ISO 8601 문자열로 바꾼다."""
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    dt = datetime.fromtimestamp(calendar.timegm(parsed), tz=timezone.utc)
    return dt.astimezone(KST).isoformat()


# ---------- 키워드 매칭 ----------

def keyword_pattern(keyword: str) -> re.Pattern:
    """영문 키워드는 단어 경계로 매칭한다(예: 'AI'가 'EMAIL'에 걸리지 않도록).
    한글 키워드는 조사가 붙으므로('AI가', '스타트업의') 부분 일치로 매칭한다."""
    kw = re.escape(keyword.strip())
    if re.fullmatch(r"[A-Za-z0-9 .+#-]+", keyword.strip()):
        return re.compile(rf"(?<![A-Za-z]){kw}(?![A-Za-z])", re.IGNORECASE)
    return re.compile(kw)


def keyword_matches(text: str, keyword: str) -> bool:
    """여러 단어 키워드('개발자 이직')는 각 단어가 모두 등장하면 매칭으로 본다."""
    words = keyword.split()
    return bool(words) and all(keyword_pattern(w).search(text) for w in words)


def matched_keywords(text: str, keywords: list[str]) -> list[str]:
    return [kw for kw in keywords if keyword_matches(text, kw)]


# ---------- 수집 ----------

def load_feeds(path: Path = FEEDS_PATH) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_entries(parsed, source: str) -> list[dict]:
    """feedparser 결과를 NewsItem 형식(dict) 리스트로 변환한다."""
    items = []
    for entry in parsed.entries:
        url = clean_url(entry.get("link") or "")
        title = clean_text(entry.get("title"))
        if not url or not title:
            continue

        summary = clean_text(entry.get("summary") or entry.get("description"))
        items.append(
            {
                "id": make_news_id(url),
                "title": title,
                "summary": truncate(summary) if summary else title,
                "source": source,
                "url": url,
                "published_at": to_kst_iso(entry) or "",
            }
        )
    return items


def fetch_feed(feed: dict) -> list[dict]:
    parsed = feedparser.parse(feed["url"], agent=USER_AGENT)
    status = getattr(parsed, "status", None)
    if parsed.bozo and not parsed.entries:
        raise RuntimeError(f"파싱 실패: {parsed.get('bozo_exception')}")
    if status and status >= 400:
        raise RuntimeError(f"HTTP {status}")
    return parse_entries(parsed, feed["source"])


def normalize_title(title: str) -> str:
    return re.sub(r"[\W_]+", "", title).lower()


def filter_and_dedupe(
    items: list[dict],
    keywords: list[str],
    hours: int,
    now: datetime | None = None,
) -> list[dict]:
    """최근 N시간 이내 + 키워드 포함 기사만 남기고, URL/제목 중복을 제거한다."""
    now = now or datetime.now(KST)
    cutoff = now - timedelta(hours=hours)

    seen_urls, seen_titles = set(), set()
    result = []
    for item in items:
        if item["published_at"]:
            if datetime.fromisoformat(item["published_at"]) < cutoff:
                continue

        text = f"{item['title']} {item['summary']}"
        matches = matched_keywords(text, keywords)
        if keywords and not matches:
            continue

        title_key = normalize_title(item["title"])
        if item["url"] in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(item["url"])
        seen_titles.add(title_key)
        result.append({**item, "_matched": matches})

    # 최신 기사 우선
    result.sort(key=lambda x: x["published_at"], reverse=True)
    return result


def balance_by_keyword(items: list[dict], keywords: list[str], max_items: int) -> list[dict]:
    """키워드별로 번갈아 한 건씩 뽑아, 한 키워드가 결과를 독차지하지 않게 한다.
    items는 최신순으로 정렬돼 있다고 가정한다."""
    if not keywords:
        return items[:max_items]
    buckets = {kw: [it for it in items if kw in it["_matched"]] for kw in keywords}
    picked, picked_ids = [], set()

    while len(picked) < max_items and any(buckets.values()):
        for kw in keywords:
            while buckets[kw] and buckets[kw][0]["id"] in picked_ids:
                buckets[kw].pop(0)
            if buckets[kw] and len(picked) < max_items:
                item = buckets[kw].pop(0)
                picked.append(item)
                picked_ids.add(item["id"])

    picked.sort(key=lambda x: x["published_at"], reverse=True)
    return picked


def strip_internal(items: list[dict]) -> list[dict]:
    return [{k: v for k, v in it.items() if not k.startswith("_")} for it in items]


def collect(keywords: list[str], hours: int = 24, max_items: int = 30) -> list[dict]:
    all_items = []
    for feed in load_feeds():
        try:
            items = fetch_feed(feed)
            print(f"[OK]   {feed['source']}({feed['category']}): {len(items)}건")
            all_items.extend(items)
        except Exception as e:  # 피드 하나가 실패해도 나머지는 계속 수집
            print(f"[FAIL] {feed['source']}({feed['category']}) {feed['url']} - {e}")

    news = filter_and_dedupe(all_items, keywords, hours)
    for kw in keywords:
        count = sum(1 for n in news if kw in n["_matched"])
        print(f"  - '{kw}' 매칭 {count}건")
    return strip_internal(balance_by_keyword(news, keywords, max_items))


def main():
    parser = argparse.ArgumentParser(description="DayBrief RSS 뉴스 수집기")
    parser.add_argument("--keywords", nargs="+", required=True, help="관심 키워드 목록")
    parser.add_argument("--hours", type=int, default=24, help="최근 몇 시간 이내 기사만 수집할지")
    parser.add_argument("--max", type=int, default=30, help="최대 기사 수 (LLM 토큰 절약용)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="저장 경로")
    args = parser.parse_args()

    news = collect(args.keywords, args.hours, args.max)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"user_keywords": args.keywords, "news": news}
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n키워드 매칭 기사 {len(news)}건 → {args.out}")


if __name__ == "__main__":
    main()

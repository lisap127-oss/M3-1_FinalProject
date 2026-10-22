"""DayBrief 일일 브리핑 파이프라인.

RSS 수집 → 구독자별 키워드 필터링 → 요약 API(/api/summarize) 호출 → 이메일 발송

실행 예시 (FastAPI 서버가 켜져 있어야 함: uvicorn main:app):
    python -m pipelines.daily_briefing --dry-run          # 메일 대신 HTML 파일로 저장
    python -m pipelines.daily_briefing --dry-run --no-ai  # 요약 API 없이 메일 모양만 확인
    python -m pipelines.daily_briefing                    # 실제 발송
"""

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

from collectors.rss_news import KST, fetch_all_feeds, select_news
from pipelines.email_sender import build_subject, render_html, render_text, send_email


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SUBSCRIBERS_PATH = ROOT / "data" / "subscribers.json"
BRIEFINGS_DIR = ROOT / "data" / "briefings"
API_URL = os.getenv("DAYBRIEF_API_URL", "http://127.0.0.1:8000")


def today_kst() -> date:
    """GitHub Actions 서버는 UTC라서 date.today()를 쓰면 한국 아침에 전날 날짜가 나온다."""
    return datetime.now(KST).date()


def mask_email(email: str) -> str:
    """공개 저장소의 Actions 로그에 이메일이 그대로 남지 않도록 가린다. (dml45pp@gmail.com → d***@gmail.com)"""
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def load_subscribers(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} 가 없습니다. data/subscribers.example.json 을 복사해서 만들어 주세요."
        )
    subscribers = json.loads(path.read_text(encoding="utf-8"))
    for s in subscribers:
        missing = {"user_id", "email", "keywords"} - s.keys()
        if missing:
            raise ValueError(f"구독자 정보에 {missing} 항목이 없습니다 (user_id={s.get('user_id')})")
    return subscribers


def request_summary(user_id: str, keywords: list[str], news: list[dict]) -> dict:
    """백엔드 요약 API를 호출한다. LLM 응답이 느릴 수 있어 timeout을 넉넉히 둔다."""
    response = httpx.post(
        f"{API_URL}/api/summarize",
        json={"user_id": user_id, "user_keywords": keywords, "news": news},
        timeout=180,
    )
    response.raise_for_status()
    return response.json()


def summarize_with_split(
    user_id: str,
    keywords: list[str],
    batch: list[dict],
    errors: list,
    label: str,
) -> list[dict]:
    """한 묶음을 요약한다. 실패하면(대부분 응답 길이 초과) 반으로 나눠 다시 시도한다.
    기사 1건까지 줄여도 실패하면 그 기사만 건너뛴다. 성공한 응답 목록을 반환한다."""
    try:
        return [request_summary(user_id, keywords, batch)]
    except httpx.ConnectError:
        raise  # 서버가 꺼져 있으면 나눠도 소용없음
    except Exception as e:
        if len(batch) == 1:
            errors.append(e)
            print(f"  [WARN] {label} 묶음의 기사 1건 요약 실패 → 건너뜀: {batch[0]['title'][:30]}")
            return []
        mid = len(batch) // 2
        print(f"  [INFO] {label} 묶음({len(batch)}건) 요약 실패({type(e).__name__}) → {mid}건/{len(batch) - mid}건으로 나눠 재시도")
        return (
            summarize_with_split(user_id, keywords, batch[:mid], errors, label)
            + summarize_with_split(user_id, keywords, batch[mid:], errors, label)
        )


def summarize_in_batches(
    user_id: str,
    keywords: list[str],
    news: list[dict],
    batch_size: int = 5,
) -> dict:
    """기사를 batch_size건씩 나눠 요약 API를 호출하고 결과를 합친다.

    백엔드는 모델 응답 길이를 4096토큰으로 제한하는데, gpt-oss-20b는 추론 토큰도
    이 한도에 포함돼 기사가 많으면 JSON이 잘린다(502). 그래서 나눠서 요청한다.
    일부 묶음이 실패해도 성공한 묶음의 결과로 브리핑을 만든다."""
    merged = {"briefing_date": None, "results": [], "excluded_news": []}
    seen_ids = set()
    batches = [news[i:i + batch_size] for i in range(0, len(news), batch_size)]
    errors = []

    succeeded = 0
    for idx, batch in enumerate(batches, 1):
        parts = summarize_with_split(user_id, keywords, batch, errors, label=f"{idx}/{len(batches)}")
        succeeded += bool(parts)
        for part in parts:
            merged["briefing_date"] = merged["briefing_date"] or part.get("briefing_date")
            for r in part.get("results", []):
                if r.get("id") not in seen_ids:
                    seen_ids.add(r.get("id"))
                    merged["results"].append(r)
            merged["excluded_news"].extend(part.get("excluded_news", []))

    if errors and succeeded == 0:
        raise errors[0]  # 전부 실패하면 이 구독자는 실패 처리

    merged["briefing_date"] = merged["briefing_date"] or today_kst().isoformat()
    return merged


def fake_summary(news: list[dict], keywords: list[str]) -> dict:
    """--no-ai 모드: 요약 API 대신 수집한 기사를 그대로 결과처럼 사용한다."""
    return {
        "briefing_date": today_kst().isoformat(),
        "results": [
            {**n, "matched_keywords": [k for k in keywords if k in n["title"] + n["summary"]],
             "importance_score": 0}
            for n in news
        ],
        "excluded_news": [],
    }


def run(
    subscribers: list[dict],
    dry_run: bool = False,
    no_ai: bool = False,
    hours: int = 24,
    max_items: int = 15,
    batch_size: int = 5,
) -> int:
    """구독자 전체에 브리핑을 만들고 보낸다. 실패한 구독자 수를 반환한다."""
    all_items = fetch_all_feeds()  # 피드는 한 번만 가져온다
    failures = 0

    for sub in subscribers:
        user_id, email, keywords = sub["user_id"], sub["email"], sub["keywords"]
        name = sub.get("name", user_id)
        print(f"\n▶ {user_id} ({', '.join(keywords)})")

        try:
            news = select_news(all_items, keywords, hours, max_items)
            if no_ai or not news:
                summary = fake_summary(news, keywords)
            else:
                summary = summarize_in_batches(user_id, keywords, news, batch_size)
            if not news:
                print("  매칭 기사 없음 → '새 뉴스 없음' 안내 메일")

            # LLM은 오늘 날짜를 모르므로 응답의 briefing_date 대신 실행 시점의 한국 날짜를 쓴다
            briefing_date = today_kst().isoformat()
            subject = build_subject(keywords, briefing_date)
            html = render_html(name, summary)
            text = render_text(name, summary)

            if dry_run:
                BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)
                out = BRIEFINGS_DIR / f"{briefing_date}_{user_id}.html"
                out.write_text(html, encoding="utf-8")
                print(f"  [DRY-RUN] {len(summary['results'])}건 → {out}")
            else:
                send_email(email, subject, html, text)
                print(f"  [SENT] {len(summary['results'])}건 → {mask_email(email)}")

        except httpx.ConnectError:
            failures += 1
            print(f"  [FAIL] 요약 API({API_URL})에 연결할 수 없습니다. uvicorn main:app 으로 서버를 켜 주세요.")
        except Exception as e:  # 한 명이 실패해도 다른 구독자는 계속 처리
            failures += 1
            print(f"  [FAIL] {type(e).__name__}: {e}")

    print(f"\n완료: 성공 {len(subscribers) - failures}명 / 실패 {failures}명")
    return failures


def main():
    parser = argparse.ArgumentParser(description="DayBrief 일일 브리핑 파이프라인")
    parser.add_argument("--subscribers", type=Path, default=SUBSCRIBERS_PATH)
    parser.add_argument("--dry-run", action="store_true", help="메일을 보내지 않고 HTML 파일로 저장")
    parser.add_argument("--no-ai", action="store_true", help="요약 API 없이 수집 기사로 메일 모양만 확인")
    parser.add_argument("--only", help="특정 user_id에게만 실행")
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--max", type=int, default=15, help="사용자당 요약할 최대 기사 수")
    parser.add_argument("--batch-size", type=int, default=5, help="요약 API 1회당 보낼 기사 수")
    args = parser.parse_args()

    subscribers = load_subscribers(args.subscribers)
    if args.only:
        subscribers = [s for s in subscribers if s["user_id"] == args.only]

    failures = run(subscribers, args.dry_run, args.no_ai, args.hours, args.max, args.batch_size)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()

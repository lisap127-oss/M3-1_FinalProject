"""브리핑 파이프라인 테스트 — RSS 수집, 요약 API, SMTP를 모두 모의 처리한다."""

from unittest.mock import patch

import pipelines.daily_briefing as pipeline
from pipelines.email_sender import AI_NOTICE, build_subject, render_html, render_text


NEWS = [
    {
        "id": "news-1",
        "title": "생성형 AI 개발 도구 공개",
        "summary": "AI 도구가 공개됐다.",
        "source": "테스트뉴스",
        "url": "https://example.com/1?a=1&b=<x>",
        "published_at": "2026-10-21T09:00:00+09:00",
    }
]

SUMMARY = {
    "briefing_date": "2026-10-21",
    "results": [
        {**NEWS[0], "matched_keywords": ["AI"], "importance_score": 90, "selection_reason": "관련성 높음"}
    ],
    "excluded_news": [],
}

SUBSCRIBER = {"user_id": "u1", "name": "의종", "email": "a@example.com", "keywords": ["AI"]}


def test_subject_format():
    assert build_subject(["AI", "스타트업", "취업"], "2026-10-21") == "[DayBrief] 10월 21일 브리핑 · AI 외 2개"


def test_html_contains_news_ai_notice_and_escapes():
    html = render_html("의종", SUMMARY)
    assert "생성형 AI 개발 도구 공개" in html
    assert "테스트뉴스" in html
    assert "&lt;x&gt;" in html  # URL/텍스트 이스케이프
    assert "gpt-oss-20b" in html  # AI 생성 콘텐츠 표시 (미션 윤리 요건)
    assert '<meta charset="utf-8">' in html  # 브라우저에서 한글 깨짐 방지


def test_text_version_and_empty_result():
    assert AI_NOTICE in render_text("의종", SUMMARY)
    assert "새 뉴스가 없었어요" in render_html("의종", {"results": []})


def test_run_sends_email_with_summary():
    with patch.object(pipeline, "fetch_all_feeds", return_value=[]), \
         patch.object(pipeline, "select_news", return_value=NEWS), \
         patch.object(pipeline, "request_summary", return_value=SUMMARY) as summarize, \
         patch.object(pipeline, "send_email") as send:
        failures = pipeline.run([SUBSCRIBER])

    assert failures == 0
    summarize.assert_called_once_with("u1", ["AI"], NEWS)
    to, subject, html, _ = send.call_args.args
    assert to == "a@example.com"
    assert "생성형 AI" in html


def test_run_skips_api_when_no_news():
    with patch.object(pipeline, "fetch_all_feeds", return_value=[]), \
         patch.object(pipeline, "select_news", return_value=[]), \
         patch.object(pipeline, "request_summary") as summarize, \
         patch.object(pipeline, "send_email") as send:
        pipeline.run([SUBSCRIBER])

    summarize.assert_not_called()  # 기사가 없으면 LLM을 부르지 않음
    assert "새 뉴스가 없었어요" in send.call_args.args[2]


def test_one_failure_does_not_stop_others():
    other = {**SUBSCRIBER, "user_id": "u2", "email": "b@example.com"}
    with patch.object(pipeline, "fetch_all_feeds", return_value=[]), \
         patch.object(pipeline, "select_news", return_value=NEWS), \
         patch.object(pipeline, "request_summary", side_effect=[RuntimeError("boom"), SUMMARY]), \
         patch.object(pipeline, "send_email") as send:
        failures = pipeline.run([SUBSCRIBER, other])

    assert failures == 1
    assert send.call_args.args[0] == "b@example.com"


def test_dry_run_writes_file(tmp_path):
    with patch.object(pipeline, "BRIEFINGS_DIR", tmp_path), \
         patch.object(pipeline, "fetch_all_feeds", return_value=[]), \
         patch.object(pipeline, "select_news", return_value=NEWS), \
         patch.object(pipeline, "send_email") as send:
        pipeline.run([SUBSCRIBER], dry_run=True, no_ai=True)

    send.assert_not_called()
    files = list(tmp_path.glob("*_u1.html"))
    assert len(files) == 1


def _news(n):
    return [{**NEWS[0], "id": f"news-{i}"} for i in range(n)]


def _summary_for(user_id, keywords, batch):
    return {
        "briefing_date": "2026-10-21",
        "results": [{**b, "matched_keywords": ["AI"], "importance_score": 50} for b in batch],
        "excluded_news": [],
    }


def test_summarize_in_batches_splits_and_merges():
    with patch.object(pipeline, "request_summary", side_effect=_summary_for) as summarize:
        merged = pipeline.summarize_in_batches("u1", ["AI"], _news(12), batch_size=5)

    assert summarize.call_count == 3  # 5 + 5 + 2
    assert [len(c.args[2]) for c in summarize.call_args_list] == [5, 5, 2]
    assert len(merged["results"]) == 12


def test_failed_batch_is_split_and_only_bad_article_skipped():
    """5건 묶음이 실패하면 반씩 나눠 재시도하고, 끝까지 실패하는 기사 1건만 빠진다."""
    def flaky(user_id, keywords, batch):
        if any(b["id"] == "news-0" for b in batch):
            raise RuntimeError("502")
        return _summary_for(user_id, keywords, batch)

    with patch.object(pipeline, "request_summary", side_effect=flaky):
        merged = pipeline.summarize_in_batches("u1", ["AI"], _news(10), batch_size=5)

    ids = {r["id"] for r in merged["results"]}
    assert len(ids) == 9
    assert "news-0" not in ids


class FakeSMTP:
    """smtplib.SMTP 흉내. reject=True면 로그인 시 535를 돌려준다."""
    reject = False
    instances = []

    def __init__(self, *a, **k):
        FakeSMTP.instances.append(self)
        self.sent = None

    def ehlo(self): pass
    def starttls(self): pass
    def quit(self): pass
    def auth_plain(self, challenge=None): return ""

    def auth(self, mechanism, authobject, **k):
        import smtplib
        if FakeSMTP.reject:
            raise smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")
        return 235, b"OK"

    def send_message(self, msg): self.sent = msg


def _setup_smtp(monkeypatch, ssl_blocked):
    import smtplib
    import pipelines.email_sender as sender

    monkeypatch.setenv("GMAIL_ADDRESS", "bot@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop")
    FakeSMTP.instances, FakeSMTP.reject = [], False

    def blocked(*a, **k):
        raise smtplib.SMTPServerDisconnected("Connection unexpectedly closed")

    monkeypatch.setattr(sender.smtplib, "SMTP_SSL", blocked if ssl_blocked else FakeSMTP)
    monkeypatch.setattr(sender.smtplib, "SMTP", FakeSMTP)
    return sender


def test_smtp_falls_back_to_port_587(monkeypatch):
    sender = _setup_smtp(monkeypatch, ssl_blocked=True)
    sender.send_email("a@example.com", "제목", "<p>본문</p>", "본문")

    smtp = FakeSMTP.instances[-1]
    assert smtp.password == "abcdefghijklmnop"  # 앱 비밀번호 공백 제거
    assert smtp.sent["To"] == "a@example.com"


def test_smtp_wrong_password_shows_clear_error(monkeypatch):
    import pytest

    sender = _setup_smtp(monkeypatch, ssl_blocked=False)
    FakeSMTP.reject = True
    with pytest.raises(RuntimeError, match="Gmail 로그인 실패\\(535\\)"):
        sender.send_email("a@example.com", "제목", "<p>본문</p>", "본문")

"""요약 결과를 브리핑 이메일(HTML + 텍스트)로 만들고 Gmail SMTP로 보낸다."""

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from html import escape


SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
AI_NOTICE = (
    "이 브리핑의 기사 선정과 요약은 AI(Groq · gpt-oss-20b)가 생성했습니다. "
    "AI 요약에는 오류가 있을 수 있으니 중요한 내용은 원문에서 확인해 주세요."
)


def _format_time(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%m/%d %H:%M")
    except (TypeError, ValueError):
        return ""


def _sorted_results(summary: dict) -> list[dict]:
    return sorted(
        summary.get("results", []),
        key=lambda r: r.get("importance_score", 0),
        reverse=True,
    )


def build_subject(keywords: list[str], briefing_date: str) -> str:
    try:
        d = datetime.fromisoformat(briefing_date)
        date_text = f"{d.month}월 {d.day}일"
    except ValueError:
        date_text = briefing_date
    kw = keywords[0] if keywords else "관심 뉴스"
    rest = f" 외 {len(keywords) - 1}개" if len(keywords) > 1 else ""
    return f"[DayBrief] {date_text} 브리핑 · {kw}{rest}"


def render_text(name: str, summary: dict) -> str:
    results = _sorted_results(summary)
    lines = [f"{name}님, 오늘의 DayBrief입니다.", ""]
    if not results:
        lines.append("오늘은 관심 키워드에 맞는 새 뉴스가 없었어요.")
    for i, r in enumerate(results, 1):
        lines += [
            f"{i}. {r.get('title', '')}",
            f"   {r.get('source', '')} · {_format_time(r.get('published_at', ''))}",
            f"   {r.get('summary', '')}",
            f"   원문: {r.get('url', '')}",
            "",
        ]
    lines += ["—", AI_NOTICE, "수신을 원하지 않으면 이 메일에 답장으로 알려 주세요."]
    return "\n".join(lines)


def render_html(name: str, summary: dict) -> str:
    results = _sorted_results(summary)

    if results:
        cards = []
        for r in results:
            keywords = ", ".join(r.get("matched_keywords", []))
            cards.append(
                f"""
<div style="background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:16px;margin:0 0 12px">
  <a href="{escape(r.get('url', ''), quote=True)}"
     style="font-size:16px;font-weight:700;color:#111;text-decoration:none">{escape(r.get('title', ''))}</a>
  <div style="font-size:12px;color:#888;margin:6px 0 10px">
    {escape(r.get('source', ''))} · {escape(_format_time(r.get('published_at', '')))}
    {f'· <span style="color:#2f6fdb">#{escape(keywords)}</span>' if keywords else ''}
  </div>
  <div style="font-size:14px;line-height:1.6;color:#333">{escape(r.get('summary', ''))}</div>
</div>"""
            )
        body = "".join(cards)
    else:
        body = '<p style="color:#555">오늘은 관심 키워드에 맞는 새 뉴스가 없었어요.</p>'

    return f"""<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f6f6f6">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <h1 style="font-size:20px;margin:0 0 4px">DayBrief</h1>
  <p style="color:#555;margin:0 0 20px">{escape(name)}님, 오늘의 브리핑입니다.</p>
  {body}
  <p style="font-size:12px;color:#888;line-height:1.6;margin-top:24px">
    🤖 {escape(AI_NOTICE)}<br>
    수신을 원하지 않으면 이 메일에 답장으로 알려 주세요.
  </p>
</div></body></html>"""


def send_email(to: str, subject: str, html: str, text: str) -> None:
    sender = (os.getenv("GMAIL_ADDRESS") or "").strip()
    # Google이 보여주는 앱 비밀번호는 'abcd efgh ijkl mnop'처럼 공백이 섞여 있다
    password = (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", "")
    if not sender or not password:
        raise RuntimeError(".env에 GMAIL_ADDRESS와 GMAIL_APP_PASSWORD를 설정하세요.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"DayBrief <{sender}>"
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    smtp = _connect()
    try:
        _login(smtp, sender, password)
        smtp.send_message(msg)
    finally:
        try:
            smtp.quit()
        except smtplib.SMTPException:
            pass


def _connect() -> smtplib.SMTP:
    """465(SSL)로 연결하고, 연결 자체가 안 되면 587(STARTTLS)로 재시도한다."""
    try:
        smtp = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30)
        smtp.ehlo()
        return smtp
    except OSError as e:  # SMTPServerDisconnected 등 smtplib 예외도 OSError의 하위 클래스
        print(f"  [INFO] 465 포트 연결 실패({type(e).__name__}), 587 포트로 재시도")
        smtp = smtplib.SMTP(SMTP_HOST, 587, timeout=30)
        smtp.starttls()
        smtp.ehlo()
        return smtp


def _login(smtp: smtplib.SMTP, sender: str, password: str) -> None:
    """PLAIN 방식으로 한 번만 로그인한다.

    smtp.login()은 실패하면 다른 방식(LOGIN)으로 재시도하는데, Gmail은 그 시점에
    연결을 끊어 버려서 진짜 원인(535 비밀번호 거부)이 'Connection unexpectedly closed'로
    가려진다. 그래서 직접 한 번만 시도해 정확한 오류를 보여준다."""
    smtp.user, smtp.password = sender, password
    try:
        smtp.auth("PLAIN", smtp.auth_plain)
    except smtplib.SMTPAuthenticationError as e:
        raise RuntimeError(
            f"Gmail 로그인 실패({e.smtp_code}): GMAIL_ADDRESS와 앱 비밀번호를 확인하세요. "
            "앱 비밀번호가 보내는 계정(GMAIL_ADDRESS)에서 만들어졌는지도 확인하세요."
        ) from None

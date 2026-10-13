
import json
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from openai import OpenAI
from pydantic import BaseModel, Field

# 프로젝트 경로 및 환경 변수
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("GROQ_API_KEY")
MODEL = "openai/gpt-oss-20b"

app = FastAPI(
    title="DayBrief AI API",
    description="키워드 기반 AI 뉴스 브리핑 API",
    version="0.1.0",
)

client = (
    OpenAI(
        api_key=API_KEY,
        base_url="https://api.groq.com/openai/v1",
    )
    if API_KEY
    else None
)


# 요청 데이터 형식
class NewsItem(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    url: str
    published_at: str


class SummarizeRequest(BaseModel):
    user_keywords: list[str] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)


# 서버 상태 확인
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "DayBrief AI"}


# 뉴스 요약 API
@app.post("/api/summarize")
def summarize_news(request: SummarizeRequest):
    if client is None:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY 환경 변수를 확인하세요.",
        )

    # 뉴스가 없는 경우 API 호출 없이 빈 결과 반환
    if not request.news:
        return {
            "briefing_date": date.today().isoformat(),
            "results": [],
            "excluded_news": [],
        }

    prompt_path = ROOT / "prompts" / "news_summary.md"

    try:
        prompt = prompt_path.read_text(encoding="utf-8")

        input_data = request.model_dump()

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        prompt
                        + "\n\n"
                        + "반드시 유효한 JSON 객체만 반환하세요. "
                        + "마크다운이나 추가 설명은 쓰지 마세요."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        input_data,
                        ensure_ascii=False,
                    ),
                },
            ],
            temperature=0,
            max_completion_tokens=4096,
        )

        content = response.choices[0].message.content

        if not content:
            raise ValueError("모델 응답이 비어 있습니다.")

        result = json.loads(content)

        if (
            not isinstance(result, dict)
            or not isinstance(result.get("results"), list)
            or not isinstance(result.get("excluded_news"), list)
        ):
            raise ValueError("모델 응답의 JSON 구조가 올바르지 않습니다.")

        return result

    except Exception as e:
        print(f"뉴스 요약 처리 실패: {type(e).__name__}: {e}")

        raise HTTPException(
            status_code=502,
            detail="뉴스 요약 처리에 실패했습니다. 서버 로그를 확인하세요.",
        ) from e

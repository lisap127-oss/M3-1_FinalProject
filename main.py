
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client
from deployment import configure_deployment, validate_production_settings

from agents.news_summary_agent import generate_summary
from collectors.news_api import router as news_router


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

supabase: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    if SUPABASE_URL and SUPABASE_SECRET_KEY
    else None
)


@asynccontextmanager
async def lifespan(app):
    validate_production_settings()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="DayBrief AI API",
    description="키워드 기반 AI 뉴스 브리핑 API",
    version="0.3.0",
)


class NewsItem(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    url: str
    published_at: str


class SummarizeRequest(BaseModel):
    user_id: str | None = None
    user_keywords: list[str] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)


class FeedbackRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    news_id: str = Field(min_length=1, max_length=200)
    topic: str = Field(min_length=1, max_length=100)
    feedback_type: Literal["like", "dislike"]


def get_supabase() -> Client:
    if supabase is None:
        raise HTTPException(
            status_code=500,
            detail="Supabase 연결 설정을 확인하세요.",
        )
    return supabase


def get_preferences(user_id: str) -> dict[str, int]:
    db = get_supabase()
    response = (
        db.table("user_preferences")
        .select("topic, score")
        .eq("user_id", user_id)
        .execute()
    )
    return {
        item["topic"]: item["score"]
        for item in response.data
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "DayBrief AI"}


@app.post("/api/summarize")
def summarize_news(request: SummarizeRequest):
    if not request.news:
        return {
            "briefing_date": date.today().isoformat(),
            "results": [],
            "excluded_news": [],
        }

    try:
        input_data = request.model_dump()

        if request.user_id:
            input_data["topic_preferences"] = get_preferences(
                request.user_id
            )
        else:
            input_data["topic_preferences"] = {}

        return generate_summary(input_data)

    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        ) from e
    except Exception as e:
        print(f"뉴스 요약 처리 실패: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=502,
            detail="뉴스 요약 처리에 실패했습니다. 서버 로그를 확인하세요.",
        ) from e


@app.post("/api/feedback")
def submit_feedback(request: FeedbackRequest):
    db = get_supabase()
    user_id = request.user_id
    topic = request.topic.strip()

    if not topic:
        raise HTTPException(
            status_code=422,
            detail="topic은 비어 있을 수 없습니다.",
        )

    try:
        response = db.rpc(
            "record_feedback",
            {"p_user_id": user_id, "p_news_id": request.news_id,
             "p_topic": topic, "p_feedback_type": request.feedback_type},
        ).execute()
        result = response.data
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected feedback RPC response")
        return {"message": "피드백이 반영되었습니다.", **result}

    except HTTPException:
        raise
    except Exception as e:
        print(f"피드백 저장 실패: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail="피드백 저장에 실패했습니다.",
        ) from e


@app.get("/api/memory/{user_id}")
def get_user_memory(user_id: str):
    db = get_supabase()

    try:
        preferences = get_preferences(user_id)

        response = (
            db.table("feedback_history")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )

        history = response.data

        return {
            "user_id": user_id,
            "topic_preferences": preferences,
            "feedback_count": len(history),
            "feedback_history": history,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"기억 조회 실패: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail="사용자 기억 조회에 실패했습니다.",
        ) from e


@app.get("/api/feedback/link")
def feedback_link():
    # Email scanners and browser prefetch must never mutate preferences.
    raise HTTPException(status_code=405, detail="화면에서 POST /api/feedback으로 피드백을 보내세요.")



# ---------- Keyword settings (prototype API) ----------

def require_keyword_dev_mode():
    if os.getenv("APP_ENV", "development").lower() != "development":
        raise HTTPException(
            status_code=403,
            detail="키워드 설정 API는 개발 환경에서만 사용할 수 있습니다.",
        )




class KeywordSettingsRequest(BaseModel):
    keywords: list[str] = Field(max_length=20)


def validate_keyword_settings(user_id: str, keywords: list[str] | None = None):
    if not user_id.strip() or len(user_id) > 100:
        raise HTTPException(status_code=422, detail="유효한 구독자 ID를 입력하세요.")
    if keywords is not None:
        if any(not isinstance(k, str) or not k.strip() or len(k) > 100 for k in keywords):
            raise HTTPException(status_code=422, detail="키워드는 1~100자여야 합니다.")
        if len(set(k.strip() for k in keywords)) != len(keywords):
            raise HTTPException(status_code=422, detail="중복 키워드는 저장할 수 없습니다.")


@app.get("/api/keywords/{user_id}")
def get_user_keywords(user_id: str):
    require_keyword_dev_mode()
    validate_keyword_settings(user_id)
    try:
        response = (
            get_supabase()
            .table("user_keyword_settings")
            .select("keywords")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return {"user_id": user_id, "keywords": rows[0]["keywords"] if rows else [], "exists": bool(rows)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"키워드 조회 실패: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="키워드 조회에 실패했습니다.") from e


@app.put("/api/keywords/{user_id}")
def save_user_keywords(user_id: str, request: KeywordSettingsRequest):
    require_keyword_dev_mode()
    validate_keyword_settings(user_id, request.keywords)
    try:
        keywords = [k.strip() for k in request.keywords]
        response = (
            get_supabase()
            .table("user_keyword_settings")
            .upsert(
                {"user_id": user_id, "keywords": keywords},
                on_conflict="user_id",
            )
            .execute()
        )
        return {"user_id": user_id, "keywords": keywords, "message": "저장 완료"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"키워드 저장 실패: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="키워드 저장에 실패했습니다.") from e


# 뉴스 수집 API (자동화/데이터 파트): GET /api/news
app.include_router(news_router)

# Mount after API routes so unknown /api paths do not become frontend pages.
configure_deployment(app, ROOT / "frontend")

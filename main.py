
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client

from agents.news_summary_agent import generate_summary


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

supabase: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    if SUPABASE_URL and SUPABASE_SECRET_KEY
    else None
)


app = FastAPI(
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
        
        response = (
            db.table("user_preferences")
            .select("score")
            .eq("user_id", user_id)
            .eq("topic", topic)
            .execute()
        )

        previous_score = (
            response.data[0]["score"]
            if response.data
            else 0
        )


        change = 1 if request.feedback_type == "like" else -1
        new_score = max(-5, min(5, previous_score + change))
        created_at = datetime.now(timezone.utc).isoformat()

        db.table("user_preferences").upsert(
            {
                "user_id": user_id,
                "topic": topic,
                "score": new_score,
                "updated_at": created_at,
            },
            on_conflict="user_id,topic",
        ).execute()

        db.table("feedback_history").insert(
            {
                "user_id": user_id,
                "news_id": request.news_id,
                "topic": topic,
                "feedback_type": request.feedback_type,
                "previous_score": previous_score,
                "new_score": new_score,
                "created_at": created_at,
            }
        ).execute()

        return {
            "message": "피드백이 반영되었습니다.",
            "user_id": user_id,
            "topic": topic,
            "previous_score": previous_score,
            "preference_score": new_score,
        }

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
def feedback_link(
    user_id: str,
    news_id: str,
    topic: str,
    type: Literal["like", "dislike"],
):
    return submit_feedback(
        FeedbackRequest(
            user_id=user_id,
            news_id=news_id,
            topic=topic,
            feedback_type=type,
        )
    )

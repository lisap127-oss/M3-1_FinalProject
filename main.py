
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from agents.news_summary_agent import generate_summary


app = FastAPI(
    title="DayBrief AI API",
    description="키워드 기반 AI 뉴스 브리핑 API",
    version="0.2.0",
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
    user_id: str | None = None
    user_keywords: list[str] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)



class FeedbackRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    news_id: str = Field(min_length=1, max_length=200)
    topic: str = Field(min_length=1, max_length=100)
    feedback_type: Literal["like", "dislike"]


# 임시 메모리 저장소
# 서버를 재시작하면 초기화된다.
user_preferences: dict[str, dict[str, int]] = {}
feedback_history: list[dict] = []


# 서버 상태 확인
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "DayBrief AI"}


# 뉴스 요약 API
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

        # 사용자의 기존 장기 기억을 요약 Agent 입력에 추가
        if request.user_id:
            input_data["topic_preferences"] = user_preferences.get(
                request.user_id,
                {},
            )
        else:
            input_data["topic_preferences"] = {}

        return generate_summary(input_data)


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


# 뉴스 피드백 API
@app.post("/api/feedback")
def submit_feedback(request: FeedbackRequest):
    user_id = request.user_id
    topic = request.topic.strip()

    if not topic:
        raise HTTPException(
            status_code=422,
            detail="topic은 비어 있을 수 없습니다.",
        )

    # 사용자별 주제 선호도 초기화
    preferences = user_preferences.setdefault(user_id, {})
    previous_score = preferences.get(topic, 0)

    # 좋아요는 +1, 싫어요는 -1
    change = 1 if request.feedback_type == "like" else -1

    # 점수는 -5~5 범위로 제한
    new_score = max(-5, min(5, previous_score + change))
    preferences[topic] = new_score

    # 피드백 이력 기록
    feedback_history.append(
        {
            "user_id": user_id,
            "news_id": request.news_id,
            "topic": topic,
            "feedback_type": request.feedback_type,
            "previous_score": previous_score,
            "new_score": new_score,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    return {
        "message": "피드백이 반영되었습니다.",
        "user_id": user_id,
        "topic": topic,
        "previous_score": previous_score,
        "preference_score": new_score,
    }


# 사용자 장기 기억 조회 API
@app.get("/api/memory/{user_id}")
def get_user_memory(user_id: str):
    preferences = user_preferences.get(user_id, {})

    # 해당 사용자의 피드백 이력만 반환
    history = [
        item
        for item in feedback_history
        if item["user_id"] == user_id
    ]

    return {
        "user_id": user_id,
        "topic_preferences": preferences,
        "feedback_count": len(history),
        "feedback_history": history,
    }
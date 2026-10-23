
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


# 프로젝트 경로 및 환경 변수
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MODEL = "openai/gpt-oss-20b"
API_KEY = os.getenv("GROQ_API_KEY")

client = (
    OpenAI(
        api_key=API_KEY,
        base_url="https://api.groq.com/openai/v1",
    )
    if API_KEY
    else None
)


def generate_summary(input_data: dict) -> dict:
    """입력받은 뉴스와 사용자 키워드를 바탕으로 요약 결과를 생성한다."""

    if client is None:
        raise RuntimeError("GROQ_API_KEY 환경 변수를 확인하세요.")

    prompt_path = ROOT / "prompts" / "news_summary.md"
    prompt = prompt_path.read_text(encoding="utf-8")

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
        reasoning_effort="low",
        max_completion_tokens=8192,
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

    # 중요도 점수 검증
    score_limits = {
        "relevance": 40,
        "information_value": 30,
        "recency": 20,
        "practicality": 10,
    }

    for news in result["results"]:
        breakdown = news.get("importance_breakdown")
        score = news.get("importance_score")

        if not isinstance(breakdown, dict):
            raise ValueError(
                f"{news.get('id')}: importance_breakdown이 없습니다."
            )

        for key, maximum in score_limits.items():
            value = breakdown.get(key)

            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or not 0 <= value <= maximum
            ):
                raise ValueError(
                    f"{news.get('id')}: {key} 점수가 유효하지 않습니다."
                )

        calculated_score = sum(
            breakdown[key] for key in score_limits
        )

        if (
            not isinstance(score, int)
            or isinstance(score, bool)
            or score != calculated_score
        ):
            raise ValueError(
                f"{news.get('id')}: 중요도 점수 불일치 "
                f"(응답={score}, 계산={calculated_score})"
            )

    return result

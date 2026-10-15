
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

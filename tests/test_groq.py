
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# 프로젝트 루트 경로
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Groq API 설정
api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise ValueError(
        "GROQ_API_KEY를 찾을 수 없습니다. .env 파일을 확인하세요."
    )

client = OpenAI(
    api_key=api_key,
    base_url="https://api.groq.com/openai/v1",
)

MODEL = "openai/gpt-oss-20b"


def main():
    # 프롬프트와 테스트 뉴스 불러오기
    prompt_path = ROOT / "prompts" / "news_summary.md"
    data_path = ROOT / "data" / "test_news.json"

    prompt = prompt_path.read_text(encoding="utf-8")
    news_data = json.loads(data_path.read_text(encoding="utf-8"))

    print("뉴스 요약 테스트 시작")
    print(f"입력 뉴스: {len(news_data['news'])}건")

    # Groq API 요청
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    prompt
                    + "\n\n반드시 유효한 JSON 객체만 반환하세요. "
                    "마크다운 코드 블록이나 추가 설명은 쓰지 마세요."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(news_data, ensure_ascii=False),
            },
        ],
        temperature=0,
        max_completion_tokens=4096,
    )

    result_text = response.choices[0].message.content

    if not result_text:
        raise RuntimeError("API에서 빈 응답을 받았습니다.")

    print("\n===== 모델 응답 =====")
    print(result_text)

    # JSON 형식 검사
    result = json.loads(result_text)
    print("\n[PASS] JSON 형식 검사")

    # 필수 필드 검사
    if not isinstance(result.get("results"), list):
        raise ValueError("'results'는 배열이어야 합니다.")

    if not isinstance(result.get("excluded_news"), list):
        raise ValueError("'excluded_news'는 배열이어야 합니다.")

    print("[PASS] 결과 필드 검사")

    # 입력 뉴스 ID와 결과 ID 비교
    input_ids = {item["id"] for item in news_data["news"]}
    output_items = result["results"] + result["excluded_news"]
    output_ids = [item.get("id") for item in output_items]

    if (
        any(news_id not in input_ids for news_id in output_ids)
        or len(output_ids) != len(set(output_ids))
        or set(output_ids) != input_ids
    ):
        raise ValueError("뉴스 ID가 누락되거나 중복·변경되었습니다.")

    print("[PASS] 뉴스 ID 검사")

    # 중요도 점수 검사
    for item in result["results"]:
        score = item.get("importance_score")

        if (
            not isinstance(score, (int, float))
            or isinstance(score, bool)
            or not 0 <= score <= 100
        ):
            raise ValueError(
                f"잘못된 중요도 점수: {item.get('id')} / {score}"
            )

    print("[PASS] 중요도 점수 검사")

    # 출처와 URL 보존 검사
    original_news = {
        item["id"]: item for item in news_data["news"]
    }

    for item in result["results"]:
        original = original_news[item["id"]]

        if (
            item.get("source") != original["source"]
            or item.get("url") != original["url"]
        ):
            raise ValueError(
                f"출처 또는 URL이 변경되었습니다: {item['id']}"
            )

    print("[PASS] 출처 및 URL 검사")

    # 결과 저장
    output_path = ROOT / "data" / "test_summary_result.json"
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\n모든 기본 검사를 통과했습니다.")
    print(f"선정 뉴스: {len(result['results'])}건")
    print(f"제외 뉴스: {len(result['excluded_news'])}건")
    print(f"결과 저장: {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n[FAIL] 뉴스 요약 테스트 실패")
        print(f"{type(e).__name__}: {e}")
        raise

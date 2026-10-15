
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# 프로젝트 최상위 폴더
ROOT = Path(__file__).resolve().parent.parent

# .env에서 Groq API 키 읽기
load_dotenv(ROOT / ".env")

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    raise RuntimeError(
        ".env에서 GROQ_API_KEY를 찾을 수 없습니다."
    )

# Groq의 OpenAI 호환 API 설정
client = OpenAI(
    api_key=api_key,
    base_url="https://api.groq.com/openai/v1",
)

MODEL = "openai/gpt-oss-20b"

# 프롬프트와 테스트 뉴스 읽기
prompt_path = ROOT / "prompts" / "news_summary.md"
data_path = ROOT / "data" / "test_news.json"

prompt = prompt_path.read_text(encoding="utf-8")
news_data = json.loads(
    data_path.read_text(encoding="utf-8")
)

instructions = f"""
{prompt}

반드시 유효한 JSON 객체만 반환하세요.
마크다운 코드 블록이나 JSON 바깥의 설명은 포함하지 마세요.
"""

# Groq Chat Completions API 호출
response = client.chat.completions.create(
    model=MODEL,
    messages=[
        {
            "role": "system",
            "content": instructions,
        },
        {
            "role": "user",
            "content": json.dumps(
                news_data,
                ensure_ascii=False,
            ),
        },
    ],
    temperature=0,
    max_completion_tokens=4096,
)

result_text = response.choices[0].message.content

if not result_text:
    raise RuntimeError("Groq API에서 빈 응답을 받았습니다.")

print("\n===== 뉴스 요약 API 결과 =====\n")
print(result_text)

# JSON 파싱 및 검증
try:
    result = json.loads(result_text)
except json.JSONDecodeError:
    print("\n❌ JSON 형식 검사 실패")
    raise

print("\n✅ JSON 형식 검사 성공")

results = result.get("results", [])
excluded = result.get("excluded_news", [])

print(f"선정된 뉴스: {len(results)}건")
print(f"제외된 뉴스: {len(excluded)}건")

# 입력 뉴스 ID 확인
input_ids = {item["id"] for item in news_data["news"]}
output_ids = {
    item["id"]
    for item in results + excluded
}

if output_ids.issubset(input_ids):
    print("✅ 뉴스 ID 검증 성공")
else:
    print("⚠️ 입력에 없는 뉴스 ID가 포함되어 있습니다.")

# 중요도 점수 확인
valid_scores = all(
    isinstance(item.get("importance_score"), (int, float))
    and not isinstance(item.get("importance_score"), bool)
    and 0 <= item["importance_score"] <= 100
    for item in results
)

if valid_scores:
    print("✅ 중요도 점수 범위 검사 성공")
else:
    print("⚠️ 중요도 점수를 확인해 주세요.")

# 출처 및 URL 보존 확인
source_by_id = {
    item["id"]: (item["source"], item["url"])
    for item in news_data["news"]
}

sources_preserved = all(
    item["id"] in source_by_id
    and (item.get("source"), item.get("url"))
    == source_by_id[item["id"]]
    for item in results
)

if sources_preserved:
    print("✅ 출처 및 URL 보존 검사 성공")
else:
    print("⚠️ 출처 또는 URL이 변경되었습니다.")

# 결과 저장
output_path = ROOT / "data" / "test_summary_result.json"
output_path.write_text(
    json.dumps(result, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print(f"\n결과 저장 완료: {output_path.relative_to(ROOT)}")

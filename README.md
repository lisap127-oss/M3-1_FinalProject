# DayBrief AI

관심 키워드에 맞는 뉴스를 수집하고 AI로 요약해 이메일 브리핑으로 전달하는 프로젝트입니다.
사용자 피드백을 주제별 선호도로 저장하고 다음 뉴스 선정에 참고합니다.

## 구성

- `main.py`: FastAPI 서버, 뉴스 요약·피드백·기억 조회 API
- `agents/`, `prompts/`: Groq 기반 뉴스 요약과 선정 기준
- `collectors/`: RSS 뉴스 수집 CLI
- `pipelines/`: 구독자별 요약 및 Gmail 발송
- `frontend/`: 뉴스 브리핑·관심사·피드백 기록 화면
- `tests/`: 기존 백엔드 및 파이프라인 테스트

## 프론트엔드 빠른 실행

```powershell
python frontend/server.py
```

<http://127.0.0.1:3000>에서 **예시 브리핑 먼저 보기**로 화면을 확인할 수 있습니다.
실제 API 연결, 뉴스 파일 입력, 테스트 방법은 [프론트엔드 실행 안내](frontend/README.md)를 참고하세요.

## 백엔드 실행

Python 3.10 이상(권장 3.12)의 가상환경에서 실행합니다.

```powershell
python -m pip install -r requirements.txt
# .env.example을 참고하여 .env 구성
python -m uvicorn main:app --reload
```

API 문서: <http://127.0.0.1:8000/docs>

요약은 `GROQ_API_KEY`가 필요합니다. 사용자 ID를 포함한 요약, 피드백과 기록 조회는
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` 및 해당 DB 테이블도 필요합니다.
비밀 키는 브라우저 코드나 Git에 넣지 마세요.

## 문서

- [프론트엔드 분석 및 백엔드 연동 인계](docs/frontend-integration.md)
- [디자인 기준](DESIGN.md)
- [뉴스 수집·자동 브리핑 파이프라인](docs/automation_pipeline.md)
- [장기 기억 설계](docs/long_term_memory_design.md)

기존 문서의 서버 메모리 저장 설명과 점수 예시는 이전 설계입니다.
최신 API는 Supabase와 -5~5 선호도 점수를 사용합니다.

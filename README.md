# DayBrief AI

관심 키워드에 맞는 뉴스를 수집하고 AI로 요약해 이메일 브리핑으로 전달하는 프로젝트입니다.
사용자 피드백을 주제별 선호도로 저장하고 다음 뉴스 선정에 참고합니다.

## 기획의도

현대인은 매일 쏟아지는 뉴스와 정보 속에서 "무엇을 봐야 할지"를 선별하는 데 평균 20~30분을 소비한다. 특히 직장인과 학생은 출근·등교 전 짧은 시간 안에 관심 분야의 핵심 정보를 파악해야 하지만, 포털·뉴스레터·SNS에 흩어진 정보를 일일이 확인하는 과정은 피로와 집중력 저하의 주요 원인이 된다.

본 프로젝트는 "매일 아침, 나에게 꼭 필요한 정보만 요약해 전달하는 AI 비서"를 구현하는 것을 목표로 한다. 사용자가 등록한 관심 키워드를 기반으로 AI Agent가 뉴스를 자동 수집·요약하고, 설정한 시간에 이메일로 개인화된 브리핑을 발송한다.

단순 알림 서비스를 넘어, Long-term Memory 기반으로 사용자의 피드백과 관심사 변화를 학습하여 사용할수록 더 똑똑해지는 AI Agent를 지향한다. "정보 선별"이라는 반복 노동에서 사용자를 해방시켜, 진짜 중요한 일에 집중할 수 있는 시간을 돌려주고자 한다.

---

## 역할분담

| 이름 | 역할 | 담당 업무 |
|---|---|---|
| 박연수 | PM/기획 | 프로젝트 총괄, 일정 관리, 요구사항 정의, 사용자 테스트 설계, 발표 자료 제작 |
| 백민서 | AI/Backend LLM | 프롬프트 설계, 요약 Agent 개발, Long-term Memory 구조 설계, API 서버 구축 |
| 김의종 | 자동화/데이터 | n8n 자동화 워크플로우 구축, 뉴스·메일·캘린더 API 연동, 데이터 수집 파이프라인 |
| 김준오 | Frontend/UX | 사용자 설정 페이지(관심사·발송시간) 구현, 대시보드 UI, 피드백 수집 인터페이스 |
| 조영경 | 배포/QA | 배포 환경 구축(Vercel·Render), DB 관리(Supabase), 테스트·QA, GitHub 관리 |

---

## 프로젝트 내용

### ▪ 서비스 개요

사용자가 등록한 관심 키워드 기반으로, AI가 매일 아침 정해진 시간에 개인화된 "뉴스 브리핑"을 이메일로 자동 발송하는 서비스.
사용자 피드백을 Long-term Memory로 학습하여 사용할수록 더 정교해진다.

### ▪ 기술 스택

| 구분 | 기술 |
|---|---|
| AI | OpenAI API (쓰임에 따라 Gemini, Claude 계열 API도 병행 가능성 있음) |
| Backend | Python(FastAPI), Supabase(PostgreSQL + pgvector) |
| 자동화 | n8n (뉴스 수집·메신저 발송) |
| Frontend | Next.js, TailwindCSS |
| 배포 | Vercel(FE), Render(BE), GitHub Actions(CI/CD) |

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

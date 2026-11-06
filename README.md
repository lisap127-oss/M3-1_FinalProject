# DayBrief AI

관심 키워드에 맞는 뉴스를 수집하고 AI로 요약해 이메일 브리핑으로 전달하는 프로젝트입니다.
사용자 피드백을 주제별 선호도로 저장하고 다음 뉴스 선정에 참고합니다.

- 배포 주소: <https://daybrief-demo.onrender.com/> (팀 시연용 데모)
- 저장소: <https://github.com/lisap127-oss/M3-1_FinalProject>

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
| 김의종 | 자동화/데이터 | RSS 뉴스 수집 파이프라인·뉴스 수집 API 구축, 이메일 브리핑 자동 발송(GitHub Actions) |
| 김준오 | Frontend/UX | 사용자 설정 페이지(관심사·발송시간) 구현, 대시보드 UI, 피드백 수집 인터페이스 |
| 조영경 | 배포/QA | 배포 환경 구축(Vercel·Render), DB 관리(Supabase), 테스트·QA, GitHub 관리 |

---

## 프로젝트 내용

### ▪ 서비스 개요

사용자가 등록한 관심 키워드 기반으로, AI가 매일 아침 정해진 시간에 개인화된 "뉴스 브리핑"을 이메일로 자동 발송하는 서비스.
사용자 피드백을 Long-term Memory로 학습하여 사용할수록 더 정교해진다.

### ▪ 기술 스택

| 구분 | 기술 | 선정 이유 |
|---|---|---|
| AI | OpenAI 호환 클라이언트(Groq API (`openai/gpt-oss-20b`)) | OpenAI 호환 인터페이스이며, 무료 한도 안에서 응답이 빠름 |
| Backend | Python 3.12, FastAPI, Pydantic | 자동 API 문서와 요청 검증을 기본 제공, 수집·요약 파이프라인과 같은 언어로 통일 |
| DB | Supabase(PostgreSQL) + RPC(`record_feedback`) | 선호도 갱신과 이력 저장을 한 트랜잭션으로 처리, RLS로 외부 직접 접근 차단 |
| 데이터 수집 | Python `feedparser` 기반 언론사 RSS 수집 | 네이버 검색 API가 신규 신청 중단·AI 요약 금지 약관이라 공개 RSS로 전환 |
| 자동화 | GitHub Actions 일일 실행, Gmail SMTP 발송 | PC 상태와 무관하게 무료로 정시 실행되고 실행 기록이 남음 |
| Frontend | HTML · CSS · JavaScript (FastAPI가 정적 파일 제공) | 배포를 단일 서비스로 유지해 프록시·CORS 설정 없이 화면과 API를 같은 주소에서 제공 |
| 배포 | Vercel, Render (`render.yaml` Blueprint), GitHub Actions(CI) | 환경 변수·빌드 설정을 저장소에서 관리, 배포로 커밋 검토 후 반영 |

### ▪ 시스템 아키텍처

```
[사용자]
   │  ① 키워드 입력 / 브리핑 확인 / 피드백
   ▼
[웹 화면 (HTML·CSS·JS)] ──────────────┐
   │                                  │
   │  GET /api/news                   │  POST /api/feedback
   ▼                                  ▼
[FastAPI 서버 (main.py) · Render]────────────────────────┐
   │                │                      │             │
   │ 수집           │ 요약                  │ 기억        │
   ▼                ▼                      ▼             │
[collectors/]   [agents/ + prompts/]   [Supabase]        │
 RSS 8개 피드    Summary Agent          user_preferences  │
 키워드 필터링    (Groq gpt-oss-20b)     feedback_history  │
 중복 제거                              record_feedback   │
                                                         │
[GitHub Actions · 매일 07:30 KST]────────────────────────┘
   │  pipelines/daily_briefing.py
   ▼
[Gmail SMTP] → 구독자 이메일 브리핑
```

### ▪ 핵심 AI 활용 (필수 기술 요소 3개 적용)

**1. AI Agent — 뉴스 선별·요약 Agent**

- 입력: 사용자 키워드, 주제별 선호도, 수집 기사 목록
- 처리: 관련성(40) · 정보 가치(30) · 최신성(20) · 실용성(10) 기준으로 0~100점 중요도를 평가하고, 중복 기사를 제외한 뒤 기사당 2문장 이내로 요약
- 출력: 선정 기사·요약·중요도 점수·선정 근거·제외 사유를 담은 JSON (`prompts/news_summary.md`)
- 원문에 없는 사실·수치·발언을 생성하지 않도록 프롬프트에 검증 규칙을 명시

**2. 자동화 워크플로우 — 수집에서 발송까지**

- 매일 07:30(KST) GitHub Actions가 `RSS 수집 → 구독자별 필터링 → AI 요약 → 이메일 발송`을 실행
- 요약 요청은 5건 단위로 분할하고, 실패한 묶음은 반으로 나눠 재시도
- 한 구독자의 처리가 실패해도 나머지 구독자는 계속 처리

**3. Long-term Memory — 사용자별 선호도 학습**

- 좋아요 +1 / 관심없음 -1로 주제별 선호도 점수를 갱신하며 범위는 -5~5
- Supabase `user_preferences`에 현재 선호도를, `feedback_history`에 피드백 이력을 저장하고 `record_feedback` RPC로 함께 처리
- 저장된 `topic_preferences`를 Summary Agent 입력으로 전달해 뉴스 선정의 보조 기준으로 사용
- 선호도는 중요도 점수에 합산하지 않으며, 선호도만으로 기사를 선정하거나 제외하지 않음

자세한 설계는 [장기 기억 설계](docs/long_term_memory_design.md)와 [뉴스 수집·자동 브리핑 파이프라인](docs/automation_pipeline.md)을 참고하세요.

## 구성

- `main.py`: FastAPI 서버, 뉴스 요약·피드백·기억 조회 API
- `agents/`, `prompts/`: Groq 기반 뉴스 요약과 선정 기준
- `collectors/`: 언론사 RSS 뉴스 수집(CLI) 및 웹용 뉴스 수집 API(`GET /api/news`)
- `pipelines/`: 구독자별 요약 및 Gmail 발송
- `frontend/`: 뉴스 브리핑·관심사·피드백 기록 화면
- `tests/`: 기존 백엔드 및 파이프라인 테스트

## API 개요

| 메서드 | 엔드포인트 | 기능 |
|---|---|---|
| GET | `/` | 웹 화면 |
| GET | `/health` | 서버 생존 확인 |
| GET | `/ready` | DB 테이블 조회 확인 |
| GET | `/api/news` | 키워드 기반 RSS 뉴스 수집 |
| POST | `/api/summarize` | 뉴스 요약 결과 생성 및 반환 |
| POST | `/api/feedback` | 뉴스 피드백 등록 및 선호도 갱신 |
| GET | `/api/memory/{user_id}` | 사용자별 선호도 및 피드백 이력 조회 |

메서드 : GET  
엔드포인트 : /api/feedback/link  
기능 : 메일 링크를 통한 뉴스 피드백 등록 및 선호도 갱신  
실행 중인 서버의 `/docs`에서 전체 명세를 확인할 수 있습니다.

## 자동화/데이터 (김의종 담당)

- [뉴스 수집 및 브리핑 자동화 상세](docs/automation_pipeline.md): 흐름, 기술 선정 이유, 실행 방법, 문제 해결 기록
- `.github/workflows/daily-briefing.yml`: 매일 07:30(KST) 뉴스 수집 → AI 요약 → 이메일 발송
- Google Calendar 일정 요약, 중요 메일 선별은 확장 기능으로 이번 범위에서 제외

## 배포·DB·QA (조영경 담당)

- [배포 및 환경 변수 안내](docs/DEPLOYMENT.md)
- [QA 결과와 실제 연동 체크리스트](docs/QA.md)
- [새 Supabase DB용 스키마/RPC](supabase/migrations/001_feedback.sql)
- `render.yaml`: 화면과 API를 같은 주소에서 제공하는 Render 팀 시연 배포 설정
- `.github/workflows/ci.yml`: Python/Node 및 PostgreSQL 검증

단일 서비스로 실행하려면 아래 백엔드 실행 후 `http://127.0.0.1:8000/`에 접속합니다.
기존 프론트 개발 서버도 계속 사용할 수 있습니다. 배포 주소는 공개되며,
개인별 로그인·구독 설정 동기화는 별도 구현이 필요합니다.

## 실행 방법

### 요구사항

- Python 3.10 이상 (권장 3.12)
- Groq API 키 (`GROQ_API_KEY`)
- Supabase 프로젝트 URL 및 서버용 secret key (피드백·기억 기능 사용 시)
- Gmail 주소 및 앱 비밀번호 (이메일 브리핑 발송 시)

### 설치 및 실행

```bash
git clone https://github.com/lisap127-oss/M3-1_FinalProject.git
cd M3-1_FinalProject

# 가상환경
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 의존성 설치
python -m pip install -r requirements.txt

# 환경 변수 구성 (.env.example 참고)
cp .env.example .env

# 서버 실행 — 화면과 API를 같은 주소에서 제공
python -m uvicorn main:app --reload
```

- 화면: <http://127.0.0.1:8000/>
- API 문서: <http://127.0.0.1:8000/docs>

화면만 따로 개발할 때는 기존 방식도 그대로 사용할 수 있습니다.
`python frontend/server.py` 실행 후 <http://127.0.0.1:3000>에서 **예시 브리핑 먼저 보기**로 화면을 확인합니다.
실제 API 연결, 뉴스 파일 입력, 테스트 방법은 [프론트엔드 실행 안내](frontend/README.md)를 참고하세요.

### 테스트

```bash
python -m pytest -v
```

### 이메일 브리핑 파이프라인

```bash
python -m pipelines.daily_briefing --dry-run    # 메일 대신 HTML 파일로 저장
python -m pipelines.daily_briefing              # 실제 발송
```

요약은 `GROQ_API_KEY`가 필요합니다. 사용자 ID를 포함한 요약, 피드백과 기록 조회는
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` 및 해당 DB 테이블도 필요합니다.
비밀 키는 브라우저 코드나 Git에 넣지 마세요.

## 사용자 테스트 결과

> 실사용자 테스트 진행 후 작성합니다.

- 테스터: 5명
- 테스트 기간: 
- 테스트 방법:

| 주요 피드백 | 반영 사항 | 반영 여부 |
|---|---|---|
|  |  |  |
|  |  |  |
|  |  |  |

## AI 윤리 및 개인정보

- 브리핑 메일과 화면에 기사 선정·요약이 AI(Groq · `gpt-oss-20b`) 생성물이며 오류가 있을 수 있으니 원문을 확인하라는 안내를 표시합니다.
- 모든 기사에 원문 링크와 언론사명을 함께 제공해 출처를 확인할 수 있게 합니다.
- 구독자 정보는 이름·이메일·관심 키워드만 저장하며, 저장소에 커밋하지 않고 GitHub Secrets로만 전달합니다.
- Actions 로그에는 이메일 주소를 `d***@gmail.com` 형태로 가려 기록합니다.
- 메일에 수신 거부 방법을 안내하며, 실사용자 모집 시 이메일 수집·이용 동의를 받습니다.

## 문서

- [요구사항 명세서](docs/requirements.md)
- [프론트엔드 분석 및 백엔드 연동 인계](docs/frontend-integration.md)
- [디자인 기준](DESIGN.md)
- [뉴스 수집·자동 브리핑 파이프라인](docs/automation_pipeline.md)
- [장기 기억 설계](docs/long_term_memory_design.md)
- [배포 및 환경 변수 안내](docs/DEPLOYMENT.md)
- [QA 결과와 실제 연동 체크리스트](docs/QA.md)

기존 문서의 서버 메모리 저장 설명과 점수 예시는 이전 설계입니다.
최신 API는 Supabase와 -5~5 선호도 점수를 사용합니다.

## 링크

- 배포 URL: <https://daybrief-demo.onrender.com/>
- 발표 자료: (추후 추가)  
기존 문서의 서버 메모리 저장 설명과 점수 예시는 이전 설계입니다.
최신 API는 Supabase와 -5~5 선호도 점수를 사용합니다.

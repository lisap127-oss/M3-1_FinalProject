# DayBrief 프론트엔드

기존 Python/FastAPI 프로젝트에 추가한 설치 없는 HTML/CSS/JavaScript 화면입니다.
백엔드 소스와 API 계약은 변경하지 않습니다. 브라우저와 API의 출처가 달라지는 문제는
Python 표준 라이브러리로 만든 **로컬 개발용 프록시**로 처리합니다.

## 실행

프로젝트 루트에서 다음 명령을 실행합니다. 프론트엔드만 실행할 때는 Python 3.9 이상이면 됩니다.

```powershell
python frontend/server.py
```

브라우저: <http://127.0.0.1:3000>

백엔드가 없어도 관심사 설정과 예시 브리핑을 사용할 수 있습니다.
예시는 실제 뉴스·AI 응답으로 표시되지 않으며 서버에 보내지 않습니다.

백엔드는 **Python 3.10 이상(권장 3.12)** 환경에서 기존 의존성을 설치하고 실행합니다.
`main.py`의 `Client | None` 등 타입 표현 때문에 Python 3.9로 직접 실행할 수 없습니다.

```powershell
# 터미널 1: Python 3.12 가상환경을 활성화한 뒤
python -m pip install -r requirements.txt
# .env.example을 참고하여 .env 설정
python -m uvicorn main:app --reload

# 터미널 2: 프로젝트 루트에서
python frontend/server.py --backend http://127.0.0.1:8000 --port 3000
```

`--backend` 생략 시 프로세스의 `DAYBRIEF_API_URL` 환경 변수 또는 기본 주소를 사용합니다.
프론트엔드 개발 서버는 `.env` 파일을 읽거나 전달하지 않습니다. API 키는 백엔드에서만 읽습니다.
개발 서버는 `127.0.0.1`에만 바인딩됩니다. 다른 기기 접근이나 외부 배포용 서버가 아닙니다.

## 화면과 데이터 범위

| 경로 | 동작 |
|---|---|
| `/#dashboard` (기본) | 오늘 브리핑 요약(선별·제외 기사 수, 평균 중요도, 상위 3건), 키워드별 기사 수, 서버 선호도 요약, 이메일 발송 일정(매일 07:30 KST, 읽기 전용) |
| `/#briefing` | 뉴스 파일/JSON 불러오기, 요약 요청, 검색·키워드 필터·정렬, 선정 이유, 제외 기사, 원문 링크, 피드백 |
| `/#settings` | 관심 키워드와 선택적 사용자 ID를 이 브라우저에 저장/삭제 |
| `/#memory` | 실제 서버의 주제별 선호도 및 피드백 기록 조회 |

설정 저장은 서버 구독 정보를 변경하지 않습니다. 뉴스와 피드백 응답은 메모리에만 보관합니다.
설정이 바뀌면 기존 요약을 지우고 새 설정으로 다시 만들도록 합니다.
해시 라우팅이므로 새로고침·브라우저 뒤로 가기를 지원하며 서버 라우팅 설정이 필요 없습니다.

### 실제 뉴스로 확인

1. 관심사 설정에서 관심 키워드를 쉼표로 구분해 저장합니다.
2. 기존 수집기로 뉴스 파일을 생성합니다.
   `python -m collectors.rss_news --keywords AI 스타트업 --max 15`
3. 나의 브리핑에서 `data/collected_news.json`을 선택합니다.
4. **브리핑 만들기**로 AI API를 호출합니다. Groq API 사용량이 발생할 수 있습니다.
5. 요약 검색/정렬/원문을 확인합니다.
6. Supabase가 준비된 환경에서는 팀에서 지정한 사용자 ID를 설정한 뒤 새 요약을 만들고,
   기사별 주제를 선택해 좋아요·싫어요를 전송합니다.
7. 피드백 기록에서 **기록 불러오기**를 누릅니다.

뉴스 JSON은 `{ "news": [NewsItem, ...] }` 또는 기사 배열을 받습니다.
기존 `NewsItem`의 여섯 필드 `id`, `title`, `summary`, `source`, `url`, `published_at`을 사용합니다.
수집기의 게시 시각 미상 값인 빈 문자열도 허용합니다. 원문 URL은 HTTP(S)만 허용합니다.
파일은 최대 1MB, 기사는 최대 30건입니다. 요약 요청은 5건씩 순차적으로 진행합니다.
일부 요청이 실패하면 성공분과 오류를 함께 표시하며 자동 재요청하지 않습니다.
중단 버튼은 브라우저의 응답 대기를 중단하며 이미 시작된 서버 작업을 취소하지는 않습니다.

저장소의 `data/test_news.json`은 실제 뉴스가 아닌 테스트용 입력입니다.
화면의 **예시 브리핑 먼저 보기**는 `demo.mjs`의 별도 테스트 픽스처를 사용합니다.

## 연결한 API

| API | 요청 | 필수 백엔드 설정 |
|---|---|---|
| `GET /health` | 없음 | 실행 중인 FastAPI |
| `POST /api/summarize` | `{user_id: string 또는 null, user_keywords: string[], news: NewsItem[]}` | `GROQ_API_KEY`; ID가 있으면 Supabase도 필요 |
| `POST /api/feedback` | `{user_id, news_id, topic, feedback_type: "like" 또는 "dislike"}` | Supabase 연결과 테이블 |
| `GET /api/memory/{user_id}` | URL 인코딩된 사용자 ID | Supabase 연결과 테이블 |

`/health` 성공은 HTTP 서버 응답만 확인합니다. AI·DB 정상 작동까지 보장하지 않습니다.
인증 헤더/로그인 API는 현재 백엔드에 없습니다. 사용자 ID 입력은 인증이 아닙니다.
`GET /api/feedback/link`는 조회 요청으로 데이터가 변경되는 엔드포인트라 프론트엔드에서 쓰지 않습니다.

요약 응답의 `results`와 `excluded_news`를 검증하며 원문 제목·출처·URL·시각은 업로드 원본을 사용합니다.
API가 반환한 글은 DOM `textContent`로 출력합니다. 모델이 다른 원문 링크를 만들어도 적용하지 않습니다.

피드백은 서버가 점수를 **누적**하며 취소/중복 방지 키가 없습니다.
같은 사용자·기사·주제는 현재 탭에서 한 번만 전송하고, 응답을 잃은 경우에도 자동 재전송하지 않습니다.
이 제한은 새로고침 후 유지되지 않으므로 영구적인 중복 방지는 백엔드 작업이 필요합니다.

## 파일 구조

```text
frontend/
  index.html       화면 구조, 폼, 상태 영역
  styles.css       반응형 스타일 및 디자인 토큰
  app.js           화면 상태, 해시 라우팅, 이벤트 처리
  api.mjs          기존 API 전용 클라이언트, 취소·시간 제한·오류
  domain.mjs       뉴스/응답 검증, 검색·정렬, 설정 읽기
  demo.mjs         명확하게 분리한 예시 데이터
  server.py        정적 파일 제공 + 기존 API만 프록시
  tests/           Node 단위 테스트와 Python HTTP 통합 테스트
```

런타임 라이브러리 추가, 번들러, 트랜스파일러, TypeScript는 없습니다. 글꼴(Pretendard)만 jsDelivr CDN에서 받으며, 연결이 없으면 시스템 글꼴로 표시합니다.
별도 build/typecheck/lint 설정도 없으며 `check`는 JavaScript 구문 검사입니다.
설치나 빌드 없이 위 서버로 실행합니다.

## 검증

```powershell
npm.cmd --prefix frontend run check
npm.cmd --prefix frontend test
python -m unittest discover -s frontend/tests -p test_server.py -v
# 기존 백엔드 회귀 테스트: 백엔드 의존성 설치 환경에서 실행
python -m pytest tests/test_rss_collector.py tests/test_daily_briefing.py tests/test_api.py tests/test_agent_errors.py -q
```

이번 환경에서 JavaScript 구문 검사, Node 9개 테스트, Python HTTP 통합 테스트 5개를 통과했습니다.
HTTP 통합 테스트의 백엔드는 로컬 모의 서버이며 실제 Groq/Supabase 연결을 증명하지 않습니다.
기존 백엔드 테스트는 기본 Python 3.9에서 `No module named pytest`로 실행하지 못했습니다.
추가로 설치된 Anaconda Python 3.13의 pytest로 실행을 시도했으나,
`feedparser`, `fastapi`, `openai` 의존성 누락으로 테스트 수집 단계에서 중단됐습니다.
2026-10-26 UI 개편 후 Chrome(headless)으로 360/390/760/1024/1440px 폭을 확인했습니다.
키워드 저장 → 파일 불러오기 → 브리핑 만들기 → 검색·필터 → 피드백 → 기록 조회 흐름은
API 계약을 흉내 낸 로컬 모의 백엔드로 검증했습니다. 실제 Groq/Supabase 왕복 검증은 남아 있습니다.

수동 확인 시 360px/760px/1440px 폭에서 가로 스크롤과 메뉴/폼을 확인하고,
Tab으로 메뉴·입력·버튼에 접근 가능한지 확인하세요. 잘못된 JSON, 빈 결과,
API 중단 상태, 예시에서 실제 모드 복귀, 설정 저장 후 새로고침도 확인 대상입니다.

# DayBrief AI API 서버 구축 및 테스트 결과

## 1. 담당 업무

- API를 활용한 AI 뉴스 요약 기능 구현
- 뉴스 요약 기능을 외부에서 호출할 수 있는 FastAPI 서버 구축
- 사용자 피드백을 반영하는 Long-term Memory 기본 기능 구현
- API 및 Summary Agent의 정상 동작 여부를 검증하기 위한 자동 테스트 환경 구성

## 2. 주요 구현 내용

### 2.1. Groq API 연동

- OpenAI 호환 클라이언트를 이용해 Groq API와 AI 모델 연동
- 사용 모델: `openai/gpt-oss-20b`
- `.env` 파일의 `GROQ_API_KEY` 환경 변수를 이용한 API 키 관리
- 별도 테스트 스크립트를 통해 실제 API 연결 및 모델 호출 확인

### 2.2. 뉴스 요약 프롬프트 설계

- 사용자 관심 키워드와 뉴스 정보를 바탕으로 관련 뉴스 선별
- 관련성, 정보 가치, 최신성, 실용성을 고려한 중요도 평가 기준 정의
- 뉴스 요약, 선정 이유, 관련 키워드 및 중요도 점수 출력 형식 설계
- 원본 뉴스의 ID, 출처, URL 등 주요 정보 보존
- JSON 형식의 일관된 응답을 위한 출력 규칙 및 검증 기준 정의
- 사용자별 주제 선호도를 뉴스 선별의 보조 기준으로 활용하도록 개인화 지침 추가

### 2.3. Summary Agent 개발

- 프롬프트 파일을 읽어 사용자 키워드와 뉴스 데이터를 기반으로 요약 생성
- 모델 응답을 JSON으로 파싱하고 필수 출력 구조 검증
- 빈 응답, 잘못된 JSON, 잘못된 응답 구조 및 API 키 누락에 대한 오류 처리
- 사용자별 장기 기억 데이터를 입력받아 개인화된 뉴스 선별에 활용할 수 있도록 구성

### 2.4. FastAPI 서버 구축

| 메서드 | 엔드포인트 | 기능 |
|---|---|---|
| GET | `/health` | 서버 상태 확인 |
| POST | `/api/summarize` | 뉴스 요약 결과 생성 및 반환 |
| POST | `/api/feedback` | 뉴스 피드백 등록 및 선호도 갱신 |
| GET | `/api/memory/{user_id}` | 사용자별 선호도 및 피드백 이력 조회 |

추가 구현 사항:

- Pydantic을 이용한 요청 데이터 검증
- 뉴스 목록이 비어 있는 경우 AI 모델 호출 없이 빈 결과 반환
- 모델 호출 및 응답 처리 중 오류가 발생하면 적절한 HTTP 오류 반환
- FastAPI의 자동 API 문서를 통해 엔드포인트 확인 및 테스트 가능

### 2.5. Long-term Memory 기본 기능 구현

- 사용자별 주제 선호도 점수 관리
- 좋아요 피드백은 +1, 싫어요 피드백은 -1로 반영
- 선호도 점수는 -5~5 범위로 제한
- 피드백 발생 시 변경 전후 점수와 발생 시각 기록
- 사용자별 선호도 및 피드백 이력 조회 기능 구현
- 저장된 주제 선호도를 뉴스 요약 Agent의 입력에 전달하도록 연결

## 3. 자동 테스트 결과

`pytest`와 FastAPI의 `TestClient` 등을 활용해 Summary Agent와 API의 주요 동작을 검증했다.

전체 테스트 실행 명령어:

```powershell
python -m pytest -v
```

**최종 테스트 결과: 10 passed**

| 테스트 항목 | 결과 |
|---|---|
| 정상적인 JSON 응답 처리 | PASS |
| 빈 모델 응답 처리 | PASS |
| 잘못된 JSON 응답 처리 | PASS |
| 잘못된 응답 구조 처리 | PASS |
| API 키 누락 처리 | PASS |
| 서버 상태 확인 (`/health`) | PASS |
| 빈 뉴스 목록 처리 | PASS |
| 잘못된 요청 데이터 검증 | PASS |
| 뉴스 요약 API 처리 | PASS |
| 사용자 선호도의 Agent 입력 전달 | PASS |

자동 테스트는 모델 응답을 모의 처리하는 테스트와 API 요청 검증 테스트를 포함한다. 실제 Groq API 연결 및 모델 호출은 별도 테스트 스크립트로 확인했다.

단, 사용자 선호도가 실제 뉴스 선정 결과에 미치는 영향까지 검증한 것은 아니다.

## 4. 주요 파일

- `main.py`: FastAPI 서버 및 API 엔드포인트
- `agents/news_summary_agent.py`: 뉴스 요약 Agent 및 모델 호출 로직
- `prompts/news_summary.md`: 뉴스 선별·요약 프롬프트
- `data/test_news.json`: 테스트용 뉴스 데이터
- `tests/test_api.py`: API 자동 테스트
- `tests/test_agent_errors.py`: Summary Agent 오류 처리 테스트
- `tests/test_groq.py`: Groq API 연결 및 모델 호출 테스트
- `tests/prompt_test_cases.md`: 프롬프트 테스트 케이스
- `docs/long_term_memory_design.md`: Long-term Memory 구조 설계
- `requirements.txt`: Python 의존성 목록
- `.env.example`: 환경 변수 설정 예시

## 5. 실행 방법

### 5.1. 라이브러리 설치

가상환경을 활성화한 뒤 프로젝트 루트 디렉터리에서 실행한다.

```powershell
python -m pip install -r requirements.txt
```

### 5.2. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 `.env.example`을 참고해 `GROQ_API_KEY`를 설정한다. 실제 API 키가 포함된 `.env` 파일은 Git에 커밋하지 않는다.

### 5.3. 서버 실행

```powershell
uvicorn main:app --reload
```

서버 실행 후 브라우저에서 `http://127.0.0.1:8000/docs`에 접속하면 API 문서를 통해 엔드포인트를 확인하고 요청을 테스트할 수 있다.

### 5.4. 자동 테스트 실행

```powershell
python -m pytest -v
```

## 6. Git 관리

- 작업 브랜치: `sub`
- 구현 내용은 Git을 통해 버전 관리
- `.env` 및 가상환경 등 민감 정보와 불필요한 파일의 Git 추적 방지 설정

최초 구현 커밋:

- 커밋: `627fcc4`
- 메시지: `feat: add news summary API and tests`

이후 변경 사항은 실제 커밋 및 푸시 여부를 확인해 기록한다.

## 7. 최종 진행현황

- [x] 뉴스 요약 프롬프트 설계
- [x] Groq API 연동
- [x] Summary Agent 개발 및 오류 처리
- [x] Long-term Memory 구조 설계
- [x] 사용자 피드백 기반 선호도 갱신 및 조회 기능 구현
- [x] 장기 기억 정보를 Summary Agent 입력에 연결
- [x] FastAPI 서버 및 주요 API 구축
- [x] 자동 테스트 10개 통과
- [x] 실행 방법 및 설계 문서 정리

## 8. 구현 범위 및 한계

- 현재 Long-term Memory는 서버 메모리에 저장되며, 서버 재시작 시 데이터가 초기화된다.
- 데이터베이스를 이용한 영구 저장 기능은 구현하지 않았다.
- 장기 기억을 Summary Agent 입력에 전달하는 것은 검증했으나, 실제 뉴스 선정 결과가 선호도에 따라 달라지는지는 별도 평가가 필요하다.
- 뉴스 수집 파이프라인, 이메일 발송 및 서비스 배포는 이번 담당 범위에 포함하지 않는다.

## 9. 종합 결과

Groq 기반 뉴스 요약 Agent와 FastAPI 서버를 구현하고, 사용자 피드백을 기반으로 주제 선호도를 관리하는 Long-term Memory 기본 기능을 연결했다. 주요 API와 Summary Agent의 정상 동작 및 오류 처리에 대한 자동 테스트 10개를 통과했으며, 실행 방법과 설계 문서를 정리했다.

이를 통해 DayBrief의 뉴스 수집 및 브리핑 전달 시스템에서 활용할 수 있는 AI 뉴스 요약 백엔드의 기본 기능을 구축했다.

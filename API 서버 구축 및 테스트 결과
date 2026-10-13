# API 서버 구축 및 테스트 결과

## 1. 담당 업무

Groq API를 활용한 뉴스 요약 기능을 구현하고, 해당 기능을 외부에서 호출할 수 있도록 FastAPI 서버를 구축했다. 또한 API의 정상 동작 여부를 확인하기 위한 자동 테스트 환경을 구성했다.

## 2. 구현 내용

### ① Groq API 연동
- Groq API와 OpenAI 호환 클라이언트를 이용해 AI 모델 호출 구현
- 모델: `openai/gpt-oss-20b`
- 환경 변수 `.env`에서 API 키를 불러오도록 구성 (Groq API KEY 사용했습니다.)
- 실제 API 호출을 통해 연결 성공 확인

### ② 뉴스 요약 프롬프트 설계
- 사용자 키워드와 뉴스 정보를 바탕으로 관련 뉴스 선별
- 관련성, 정보 가치, 최신성, 실용성을 고려한 중요도 점수 산정
- 뉴스 요약, 선정 이유, 관련 키워드, 중요도 점수 출력
- 입력 뉴스의 ID, 출처, URL 보존 및 JSON 출력 형식 정의
- 테스트용 뉴스 데이터와 프롬프트 테스트 케이스 작성

### ③ FastAPI 서버 구축
- `GET /health`: 서버 상태 확인
- `POST /api/summarize`: 키워드 및 뉴스 데이터를 입력받아 AI 뉴스 요약 결과 반환
- Pydantic을 이용한 요청 데이터 형식 검증
- 뉴스가 없는 경우 빈 결과 반환
- 모델 응답을 JSON으로 파싱하고 오류 발생 시 HTTP 오류 반환

### ④ 자동 테스트
`pytest`와 FastAPI의 `TestClient`를 사용해 다음 4개 테스트를 실행했다.

| 테스트 항목 | 결과 |
|---|---|
| 서버 상태 확인 (`/health`) | PASS |
| 빈 뉴스 목록 처리 | PASS |
| 필수 입력 누락 시 422 응답 | PASS |
| 가짜 AI 응답을 이용한 뉴스 요약 API 검사 | PASS |

**테스트 결과: 4 passed**

뉴스 요약 API의 자동 테스트는 가짜 모델 응답을 사용하므로 실제 Groq API를 호출하지 않음. 실제 모델 호출 및 연결은 별도 테스트 스크립트로 확인.

### ⑤ 실행 환경 및 Git 관리
- `requirements.txt` 작성
- `.env` 및 가상환경 등 민감 정보와 불필요한 파일의 Git 추적 방지 설정
- 작업 내용을 `sub` 브랜치에 커밋 및 푸시

## 3. 주요 파일

- `main.py`: FastAPI 서버 및 API 엔드포인트
- `prompts/news_summary.md`: 뉴스 요약 프롬프트
- `data/test_news.json`: 테스트용 뉴스 데이터
- `tests/test_api.py`: API 자동 테스트
- `tests/test_groq.py`: Groq API 연결 및 실제 모델 호출 테스트
- `tests/prompt_test_cases.md`: 프롬프트 테스트 케이스
- `requirements.txt`: Python 의존성 목록
- `.env.example`: 환경 변수 설정 예시

## 4. 실행 방법

가상환경을 활성화한 상태에서 필요한 라이브러리를 설치한다.

```powershell
python -m pip install -r requirements.txt
```

`.env` 파일 생성 후, `.env.example`양식에 맞춰 Groq API 키를 설정한 뒤 서버를 실행한다.

```powershell
uvicorn main:app --reload
```

브라우저에서 `http://127.0.0.1:8000/docs`에 접속하면 API 문서를 통해 엔드포인트를 테스트할 수 있다.

자동 테스트는 다음 명령어로 실행한다.

```powershell
python -m pytest tests/test_api.py -v
```

## 5. Git 작업 기록

- 브랜치: `sub`
- 커밋: `627fcc4`
- 커밋 메시지: `feat: add news summary API and tests`
- 원격 저장소 반영: 완료

---

## 진행현황


- [x] 프롬프트 설계
- [ ] 요약 Agent 개발 (AI 뉴스 선별·요약 로직 구현 완료, Agent 구조 고도화 필요)
- [ ] Long-term Memory 구조 설계
- [x] API 서버 구축 및 자동 테스트 완료


Groq API 연동, 뉴스 요약 프롬프트, FastAPI 서버 구축, 요청 데이터 검증 및 자동 테스트까지 구현.

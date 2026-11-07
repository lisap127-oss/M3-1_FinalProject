## 2026-11-08 키워드 저장 기능 QA

### 구현 및 검증 결과

| 항목 | 결과 |
|---|---|
| Supabase 키워드 테이블 생성 | 완료 |
| GET/PUT 키워드 API | 로컬 테스트 통과 |
| 프론트엔드 키워드 저장·복원 | 로컬 브라우저 테스트 통과 |
| Supabase 실제 저장·조회 | 통과 |
| Python 키워드 API 테스트 | 6개 통과 |
| 프론트엔드 자동 테스트 | 16개 통과 |
| 운영 환경 GET/PUT 차단 | HTTP 403 확인 |
| GitHub PR 병합 | 완료 |
| Render 최신 배포 | 완료 |
| 로컬 sub 브랜치 동기화 | 완료 |

### 운영 환경 제한

- 사용자 인증 기능이 없어 운영 환경에서 키워드 API를 차단함.
- `APP_ENV=production`에서 키워드 GET/PUT 요청은 HTTP 403을 반환함.
- 운영 환경의 키워드는 기존 브라우저 저장 방식을 사용함.
- 서버 기반 키워드 동기화를 운영 환경에 활성화하려면 사용자 인증 및 접근 제어가 필요함.

### 남은 검증

- 운영 환경의 뉴스 수집 및 AI 요약 전체 흐름
- 좋아요·관심없음 피드백 및 데이터베이스 영구 저장
- 모바일·데스크톱 화면 수동 QA
- 신규 키워드 기능을 포함한 GitHub Actions CI 실행 결과

---

# 배포/QA 검증 기록

작성: 2026-11-03 / 2026-11-05 갱신 / 조영경 담당 범위

## 이번 환경에서 실행한 검증

| 검사 | 결과 | 검증 범위 |
|---|---|---|
| Python 회귀·배포/API 테스트 (11/3) | 42 passed | 모의 AI/DB/SMTP, 서버 라우팅/접근 제한, 오류 처리 |
| Python API 테스트 재실행 (11/5) | 56 passed | `tests/test_news_api.py`를 포함한 CI 테스트 목록을 로컬에서 실행 |
| 프론트 Node 테스트 | 14 passed | API 계약, 뉴스 입력 검증, 설정/피드백 상태, 화면용 데이터 처리 |
| 프론트 JavaScript 구문 검사 | 통과 | 기존 JS/MJS 4개 |
| 개발 프록시 HTTP 테스트 | 5 passed | 로컬 프록시·정적 파일·오류 응답 |

모의 응답 기반 테스트는 실제 Groq, Supabase, RSS, SMTP 연결 성공의 증거가 아닙니다.
SQL 테스트는 `supabase/tests/feedback.sql`과 CI PostgreSQL job에 준비했습니다.
로컬 PostgreSQL 실행 환경이 없어 이 기록 작성 시에는 SQL 테스트를 실행하지 않았습니다.
PR의 CI 결과를 별도로 확인해야 합니다.

## 배포 후 실제 검증 (진행 중)

| 항목 | 방법 | 성공 기준 | 상태 |
|---|---|---|---|
| 사이트 접근 | HTTPS 주소 접속 | 로그인 없이 화면/정적 파일 정상 | 수동 배포 보고, 화면 확인 미기록 |
| 공개 접근 | 인증 없이 UI/API/docs 접속 | 로그인 없이 화면과 API 접근 | 미실행 |
| DB 조회 | `/ready` 요청 | 200, DB reachable | 미실행 |
| 실제 요약 | RSS 입력 파일+테스트 사용자 ID로 브리핑 생성 | 출처 링크·기사 요약 출력 | 미실행 |
| DB 피드백 | 새 기사 좋아요/관심없음 | 점수 ±1, 이력 1건 | 미실행 |
| 중복 방지 | 같은 사용자/기사/주제로 POST 재전송 | duplicate=true, 점수 추가 변경 없음 | 미실행 |
| 영구 저장 | 서버 재시작 후 `/api/memory/{user_id}` | 선호도·이력 유지 | 미실행 |
| 사용자 구분 | 다른 가명 ID로 조회 | 해당 ID 기록만 반환 (본인 인증과 별개) | 미실행 |
| 개인화 효과 | 같은 기사·키워드로 선호도 변경 전후 비교 | 선정/점수 변화를 기록, 변화 없으면 그대로 보고 | 미실행 |
| 자동화 예행연습 | Daily Briefing `dry_run=true` | 브리핑 생성, 이메일 미발송 | [11/5 실행 #14 성공](https://github.com/lisap127-oss/M3-1_FinalProject/actions/runs/42038170217): 1명 성공/0명 실패, 8건 생성 |
| 메일 수신 | 테스트 수신자에게 1회 실행 | 실제 수신·링크/한글 정상 | 미실행 |
| 예약 실행 | 기본 브랜치에 반영 후 다음 예약 실행 | 성공 로그와 실제 수신 | 미실행 |
| 화면 수동 QA | 360/760/1440px, 키보드·오류·빈 결과 확인 | 조작 가능, 가로 스크롤 없음 | 미실행 |

## 확인한 기존 장애

2026-11-03 Actions run `41573432849`에서 Check secrets/서버 시작은 성공하고,
Run daily briefing 단계에서 요약 API 500이 반복됐습니다. 당시 워크플로우는
Supabase 환경 변수를 서버로 전달하지 않았고, 최신 API는 user_id가 있으면 DB를 조회합니다.
이번 변경은 그 누락을 보완하고 HTTP 500/401/429 등의 기사 분할 재시도를 중단합니다.
2026-11-05 예약 실행 #13은 GitHub Actions에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`가 없어
`Check secrets` 단계에서 실패했습니다. 저장소 소유자가 두 Repository secrets를 등록한 뒤
[수동 실행 #14](https://github.com/lisap127-oss/M3-1_FinalProject/actions/runs/42038170217)를
`dry_run=true`로 실행해 시크릿 검사, API 서버 시작, 브리핑 생성이 모두 성공했습니다.
로그에는 1명 성공/0명 실패, 8건 생성이 기록됐습니다. 실제 메일 발송과 다음 예약 실행은 아직 확인하지 않았습니다.

## 재현 명령

```bash
python -m pip install -r requirements.txt
python -m pytest tests/test_api.py tests/test_agent_errors.py tests/test_rss_collector.py tests/test_daily_briefing.py tests/test_deployment.py tests/test_news_api.py -q
npm --prefix frontend run check
npm --prefix frontend test
python -m unittest discover -s frontend/tests -p test_server.py -v
```

최종 제출/발표 증거: 사이트/API 주소, 배포 커밋, DB 재시작 유지 결과,
메일 수신 캡처, Actions 성공 실행 링크, 테스트 결과, 남은 제한 사항.
개인 이메일/키는 캡처와 공개 로그에서 제거합니다.

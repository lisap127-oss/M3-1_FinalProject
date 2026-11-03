# 배포/QA 검증 기록

작성: 2026-11-03 / 조영경 담당 범위

## 이번 환경에서 실행한 검증

| 검사 | 결과 | 검증 범위 |
|---|---|---|
| Python 회귀·배포/API 테스트 | 42 passed | 모의 AI/DB/SMTP, 서버 라우팅/접근 제한, 오류 처리 |
| 프론트 Node 테스트 | 14 passed | API 계약, 뉴스 입력 검증, 설정/피드백 상태, 화면용 데이터 처리 |
| 프론트 JavaScript 구문 검사 | 통과 | 기존 JS/MJS 4개 |
| 개발 프록시 HTTP 테스트 | 5 passed | 로컬 프록시·정적 파일·오류 응답 |

모의 응답 기반 테스트는 실제 Groq, Supabase, RSS, SMTP 연결 성공의 증거가 아닙니다.
SQL 테스트는 `supabase/tests/feedback.sql`과 CI PostgreSQL job에 준비했습니다.
로컬 PostgreSQL 실행 환경이 없어 이 기록 작성 시에는 SQL 테스트를 실행하지 않았습니다.
PR의 CI 결과를 별도로 확인해야 합니다.

## 배포 후 실제 검증 (아직 미실행)

| 항목 | 방법 | 성공 기준 | 상태 |
|---|---|---|---|
| 사이트 접근 | HTTPS 주소 접속 | 로그인 후 화면/정적 파일 정상 | 미실행 |
| 인증 | 인증 없이 UI/API/docs 접속 | 401, `/health`만 200 | 미실행 |
| DB 조회 | `/ready` 요청 | 200, DB reachable | 미실행 |
| 실제 요약 | RSS 입력 파일+테스트 사용자 ID로 브리핑 생성 | 출처 링크·기사 요약 출력 | 미실행 |
| DB 피드백 | 새 기사 좋아요/관심없음 | 점수 ±1, 이력 1건 | 미실행 |
| 중복 방지 | 같은 사용자/기사/주제로 POST 재전송 | duplicate=true, 점수 추가 변경 없음 | 미실행 |
| 영구 저장 | 서버 재시작 후 `/api/memory/{user_id}` | 선호도·이력 유지 | 미실행 |
| 사용자 구분 | 다른 가명 ID로 조회 | 해당 ID 기록만 반환 (본인 인증과 별개) | 미실행 |
| 개인화 효과 | 같은 기사·키워드로 선호도 변경 전후 비교 | 선정/점수 변화를 기록, 변화 없으면 그대로 보고 | 미실행 |
| 자동화 예행연습 | Daily Briefing dry_run=true | AI 요약 완료, 이메일 미발송 | 미실행 |
| 메일 수신 | 테스트 수신자에게 1회 실행 | 실제 수신·링크/한글 정상 | 미실행 |
| 예약 실행 | 기본 브랜치에 반영 후 다음 예약 실행 | 성공 로그와 실제 수신 | 미실행 |
| 화면 수동 QA | 360/760/1440px, 키보드·오류·빈 결과 확인 | 조작 가능, 가로 스크롤 없음 | 미실행 |

## 확인한 기존 장애

2026-11-03 Actions run `41573432849`에서 Check secrets/서버 시작은 성공하고,
Run daily briefing 단계에서 요약 API 500이 반복됐습니다. 당시 워크플로우는
Supabase 환경 변수를 서버로 전달하지 않았고, 최신 API는 user_id가 있으면 DB를 조회합니다.
이번 변경은 그 누락을 보완하고 HTTP 500/401/429 등의 기사 분할 재시도를 중단합니다.
실계정 Secrets/DB 상태를 확인하거나 수정한 것은 아닙니다. 실제 복구는 새 실행으로 확인해야 합니다.

## 재현 명령

```bash
python -m pip install -r requirements.txt
python -m pytest tests/test_api.py tests/test_agent_errors.py tests/test_rss_collector.py tests/test_daily_briefing.py tests/test_deployment.py -q
npm --prefix frontend run check
npm --prefix frontend test
python -m unittest discover -s frontend/tests -p test_server.py -v
```

최종 제출/발표 증거: 사이트/API 주소, 배포 커밋, DB 재시작 유지 결과,
메일 수신 캡처, Actions 성공 실행 링크, 테스트 결과, 남은 제한 사항.
개인 이메일/키는 캡처와 공개 로그에서 제거합니다.

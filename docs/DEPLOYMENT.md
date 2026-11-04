# DayBrief 배포 및 운영 인계 — 조영경 담당

## 이번 배포 방식

현재 HTML/CSS/JS 화면을 FastAPI와 같은 Render 서비스에서 제공합니다.
배포된 `/`가 화면이고 `/api/*`가 API이므로 별도 프록시/CORS/Vercel 재작성 설정이 필요 없습니다.
Next.js로 바꾸지 않습니다. 기존 `python frontend/server.py` 개발 방식도 유지합니다.

이 배포는 팀 시연용입니다. 브라우저 기본 인증으로 팀 전체에 접근을 허용하며,
각 사용자의 계정을 인증하거나 사용자별 기록 접근을 분리하지 않습니다.
시연에는 가명 사용자 ID와 테스트 데이터만 사용하세요. 일반 공개 가입 서비스를 운영하려면
별도 사용자 인증/권한, 구독 관리, 요청 제한 작업이 필요합니다.

## 1. DB 준비

1. 새로운 Supabase 시연 프로젝트를 준비합니다.
2. SQL Editor에서 `supabase/migrations/001_feedback.sql` 전체를 한 번 실행합니다.
3. 프로젝트 URL과 서버용 secret key 또는 service_role key를 확인합니다.
   publishable/anon 키는 사용하지 않습니다. 키는 Render/GitHub Secrets에만 입력합니다.
4. `user_preferences`, `feedback_history`, `record_feedback` 함수가 생성됐는지 확인합니다.

**기존 DB에 같은 이름의 테이블이 있으면 바로 실행하지 마세요.** 이 SQL은 새 DB용이며
스키마 불일치를 숨기지 않도록 `IF NOT EXISTS`를 사용하지 않습니다. 기존 컬럼/제약조건과
데이터 백업을 먼저 확인하고 차이에 맞는 별도 마이그레이션을 작성해야 합니다.
기존 데이터를 삭제하거나 기존 테이블을 덮어쓰지 않습니다.

- 선호도: 사용자+주제를 기본 키로 사용, 점수 -5~5 제한.
- 이력: 사용자+기사+주제에 첫 피드백 한 번만 허용. 반복/다른 피드백 재전송도 첫 기록 유지.
- 점수 변경과 이력 저장: `record_feedback` 트랜잭션으로 함께 성공/실패.
- 같은 사용자/주제의 동시 요청: 트랜잭션 잠금으로 직렬화.
- RLS를 활성화하고 anon/authenticated 직접 접근과 함수 호출은 허용하지 않음.
- 함수는 서버의 service_role 권한으로만 호출. 벡터 검색/임베딩은 이번 범위에 포함하지 않음.

## 2. 로컬 실행 확인 (macOS)

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# .env의 GROQ_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY를 실제 값으로 설정
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --no-access-log
```

`http://127.0.0.1:8000/`에서 화면을 사용합니다. `/docs`는 API 문서입니다.
`/health`는 서버 생존 확인, `/ready`는 DB 두 테이블 조회 확인입니다.
`/ready` 성공은 AI/SMTP/피드백 RPC 성공을 의미하지 않습니다.
실제 RSS 입력은 기존 CLI로 생성한 `data/collected_news.json`을 화면의 테스트 도구로 불러옵니다.

## 3. Render 배포

1. 이 변경이 들어간 브랜치를 GitHub에 반영합니다.
2. Render에서 New → Blueprint로 이 저장소와 해당 브랜치를 선택합니다.
3. 루트의 `render.yaml`을 적용하고 아래 환경 변수를 입력합니다.
4. 배포 후 HTTPS 주소의 `/health` 확인 → `/` 접속 → 팀용 기본 인증으로 로그인합니다.
5. `/ready` 확인 후 QA 문서의 실제 외부 연동 검증을 진행합니다.

| 변수 | 위치/내용 |
|---|---|
| `APP_ENV` | Blueprint가 `production` 지정 |
| `GROQ_API_KEY` | 요약 모델 키, 서버에만 저장 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SECRET_KEY` | secret/service_role 키, 브라우저에 노출 금지 |
| `DEMO_USERNAME` | 팀 시연용 사용자명, 콜론 제외 |
| `DEMO_PASSWORD` | 팀 시연용 임의 비밀번호, 16자 이상 |

화면/API/docs는 모두 기본 인증으로 보호하고 `/health`만 공개합니다.
운영 필수 값이 빠지거나 비밀번호가 짧으면 앱 시작을 중단합니다.
Blueprint는 자동 배포를 끕니다. 검토한 커밋을 선택해서 수동 배포하세요.
무료 서비스의 절전/초기 요청 지연이 있으면 발표 전에 접속해 준비 상태를 확인합니다.
이 설정은 서비스를 생성하지 않으며 Render 계정에서 실제 적용해야 합니다.

## 4. 일일 이메일 자동화 (GitHub Actions)

현재 방식은 Actions 안에서 API를 잠깐 실행합니다. Render의 절전/SMTP 접근과 독립적으로 유지합니다.
Repository Settings → Secrets and variables → Actions에서 아래 6개를 등록/확인합니다.

- `GROQ_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `GMAIL_ADDRESS`
- `GMAIL_APP_PASSWORD`
- `SUBSCRIBERS_JSON` (`data/subscribers.example.json` 형식)

기존에 Secrets가 등록돼 있더라도 **Supabase 두 값은 추가 확인**이 필요합니다.
이번 변경은 해당 값을 서버에 전달하고 누락 시 초기에 중단합니다.
DB 마이그레이션 적용 후 Actions → Daily Briefing → Run workflow에서
`dry_run=true`로 먼저 확인합니다. 수동 테스트는 지정한 테스트 구독자로 제한하세요.
실제 메일 발송을 확인할 때만 `dry_run=false`로 실행합니다.
실제 수신 확인 후 예약 실행(현재 매일 07:30 KST)을 검증합니다.
예약 워크플로우는 저장소 기본 브랜치에 반영돼야 실행됩니다.
GitHub 예약 실행 시각은 정확한 시각을 보장하지 않습니다.

## 5. 문제 해결 / 되돌리기

| 증상 | 확인 |
|---|---|
| 배포 시작 실패 | 필수 환경 변수 이름, Python 버전, 빌드 로그 |
| 로그인 401 | 팀 인증 사용자명/비밀번호, 브라우저 저장 인증 |
| `/ready` 503 | DB URL/서버 키, 테이블/컬럼 존재 여부 |
| 피드백 500 | `record_feedback` 함수·권한·테이블 제약조건 |
| 요약 500 | Groq 키, Supabase 설정, API 서버 로그 |
| 요약 502 | 모델 응답/연결 상태. 기존 기사 분할 재시도 유지 |
| Actions 실패 | 해당 실행 로그, DB 값 전달, 구독자 JSON, Gmail 앱 비밀번호 |

코드는 이전 정상 커밋으로 재배포할 수 있습니다. 기존 API도 새 테이블의 컬럼을 사용할 수 있으나
중복 피드백은 새 유니크 제약조건에 걸릴 수 있으므로 새 API 유지가 권장됩니다.
DB 스키마와 피드백 기록은 자동으로 되돌리거나 삭제하지 않습니다.
API/DB/메일 실패 여부를 확인한 뒤 예약 발송은 필요하면 Actions 화면에서 비활성화합니다.

## 팀 협업으로 남은 기능

- 화면의 키워드는 브라우저 저장, 메일 구독자는 `SUBSCRIBERS_JSON` 저장: 자동 동기화 미구현.
- RSS는 CLI/파이프라인 방식: 화면 자동 뉴스 조회 API 미구현.
- 개인별 발송 시간, 공개 가입/해지, 사용자별 인증은 미구현.
- 이메일 GET 링크로 피드백을 변경하지 않음: 메일 검사기의 자동 클릭을 방지.
- 뉴스 선정이 선호도에 따라 달라지는 효과는 실제 모델 비교 평가 필요.

위 기능은 배포 성공과 구분해 백엔드/프론트/자동화 담당자와 진행합니다.

참고: https://render.com/docs/blueprint-spec , https://supabase.com/docs/guides/database/functions

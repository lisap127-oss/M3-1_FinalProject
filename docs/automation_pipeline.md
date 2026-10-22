# DayBrief 자동화/데이터 파트 — 뉴스 수집 및 브리핑 자동화

## 1. 담당 업무

- 실제 뉴스 데이터 수집: 언론사 RSS 수집기 구현
- 사용자 키워드 기반 기사 필터링 및 요약 API 입력 형식 변환
- **자동화 워크플로우** 구축: 뉴스 수집 → AI 요약 → 이메일 발송 파이프라인
- GitHub Actions를 이용한 매일 아침 자동 실행
- 개인정보(구독자 이메일) 보호 및 AI 생성 콘텐츠 표시

미션의 필수 기술 요소 중 **자동화 워크플로우**를 담당한다. 백엔드 파트의 AI Agent, Long-term Memory와 함께 서비스의 3개 기술 요소를 구성한다.

## 2. 전체 흐름

```
[매일 07:30 KST · GitHub Actions]
        │
        ▼
① RSS 수집 (collectors/rss_news.py)
   언론사 피드 8개 → 기사 약 550건
        │
        ▼
② 구독자별 필터링 (select_news)
   최근 24시간 + 관심 키워드 매칭 → 중복 제거 → 키워드별 균형 선택 (최대 15건)
        │
        ▼
③ AI 요약 (POST /api/summarize · 백엔드 Summary Agent)
   5건씩 나눠 요청 → 실패한 묶음은 반으로 나눠 재시도 → 결과 병합
        │
        ▼
④ 이메일 발송 (pipelines/email_sender.py)
   HTML + 텍스트 메일, 중요도순 정렬, AI 생성 안내 문구 포함
```

피드는 실행당 한 번만 수집하고, ②~④를 구독자마다 반복한다. 한 구독자가 실패해도 나머지 구독자는 계속 처리한다.

## 3. 기술 선정 및 의사결정

### 3.1. 뉴스 소스: 네이버 검색 API → 언론사 RSS

처음에는 키워드 검색을 바로 지원하는 네이버 검색 API를 검토했으나 사용하지 않기로 했다.

- 네이버 검색 API는 NAVER API HUB(네이버 클라우드)로 이관되며 개발자센터에서 신규 신청이 중단되었다.
- 개정된 이용 약관에서 **검색 결과를 AI 요약에 활용하는 것과 자동 수집을 금지**했다. DayBrief의 핵심 기능과 정면으로 충돌한다.

대신 언론사가 공개한 RSS 피드를 사용한다.

| 장점 | 보완 방법 |
|---|---|
| API 키 없이 바로 사용 가능 | — |
| 원문 링크·출처·게시 시각이 포함됨 | 메일에 원문 링크와 언론사를 그대로 표시 |
| 키워드 검색을 지원하지 않음 | 분야별 피드를 모은 뒤 코드에서 키워드 필터링, 최종 선별은 Summary Agent가 수행 |

현재 수집 피드: 연합뉴스(전체·경제·산업), 한겨레(전체·경제), 경향신문(전체), 동아일보(전체), ZDNet Korea(IT). 목록은 `collectors/feeds.json`에서 코드 수정 없이 변경할 수 있다.

### 3.2. 키워드 매칭 규칙

| 문제 | 해결 |
|---|---|
| `AI`가 `EMAIL`에도 매칭됨 | 영문 키워드는 단어 경계로 매칭 |
| `스타트업의`처럼 조사가 붙음 | 한글 키워드는 부분 일치로 매칭 |
| `개발자 이직`이 정확히 붙어 있어야만 매칭됨 | 여러 단어 키워드는 각 단어가 모두 등장하면 매칭 |
| 기사가 많은 `AI`가 결과 30건을 독차지 | 키워드별로 번갈아 한 건씩 선택 |

같은 기사가 URL만 다르게 들어오는 경우를 막기 위해 `utm_source` 등 추적 파라미터를 제거하고, URL과 정규화한 제목으로 중복을 제거한다. 언론사마다 제목이 다른 같은 사건 기사는 Summary Agent 프롬프트의 중복 제외 규칙에 맡긴다.

### 3.3. 요약 요청을 5건씩 나누는 이유

15건을 한 번에 요청하면 백엔드에서 502가 발생했다. 원인은 Summary Agent의 `max_completion_tokens=4096` 한도에 **gpt-oss-20b의 추론 토큰까지 포함**되어, 기사가 많으면 응답 JSON이 중간에 잘리는 것이었다(5건으로 줄이면 성공).

백엔드 코드를 수정하지 않고 파이프라인에서 해결했다.

- 기사를 5건씩 나눠 요청하고 결과를 병합한다.
- 그래도 실패한 묶음은 반으로 나눠 재시도하고, 1건까지 줄여도 실패한 기사만 제외한다.
- 요약 서버가 꺼져 있는 경우(연결 실패)는 재시도하지 않고 바로 알린다.

매칭 기사가 없으면 LLM을 호출하지 않고 "새 뉴스 없음" 안내만 발송해 API 사용량을 줄인다.

### 3.4. 전달 방식: 이메일 (Gmail SMTP)

- 별도 앱 설치 없이 누구나 받을 수 있어 실사용자(5명 이상) 모집에 유리하다.
- 구독자 정보는 이름·이메일·관심 키워드만 저장한다.
- Gmail 계정 비밀번호가 아닌 **앱 비밀번호**를 사용한다. 메일 발송 권한만 있고, 유출 시 해당 비밀번호만 폐기하면 된다.
- 일부 네트워크에서 465 포트가 막히는 경우를 대비해 587(STARTTLS)로 재시도한다.

### 3.5. 자동 실행: GitHub Actions

| 검토안 | 판단 |
|---|---|
| 개인 PC에서 cron 실행 | PC가 꺼져 있으면 실행되지 않음 |
| 배포 서버에서 실행 | 배포 완료 전까지 사용할 수 없음 |
| **GitHub Actions** | 무료, PC 상태와 무관, 실행 기록이 남음 → 채택 |

워크플로우 안에서 FastAPI 서버를 임시로 실행해 요약 API를 호출하므로, 서비스 배포 여부와 관계없이 동작한다. 배포가 완료되면 `DAYBRIEF_API_URL`만 배포 주소로 바꾸면 된다.

## 4. 구성 파일

| 파일 | 역할 |
|---|---|
| `collectors/rss_news.py` | RSS 수집, 텍스트 정리, 키워드 필터링, 중복 제거 |
| `collectors/feeds.json` | 수집할 RSS 피드 목록 |
| `pipelines/daily_briefing.py` | 파이프라인 본체 (구독자 처리, 요약 요청 분할, 발송) |
| `pipelines/email_sender.py` | 메일 본문(HTML·텍스트) 생성 및 Gmail SMTP 발송 |
| `data/subscribers.example.json` | 구독자 목록 예시 (실제 파일은 Git 제외) |
| `.github/workflows/daily-briefing.yml` | 매일 자동 실행 워크플로우 |
| `tests/test_rss_collector.py` | 수집기 테스트 |
| `tests/test_daily_briefing.py` | 파이프라인·메일 테스트 |

## 5. 데이터 형식

### 5.1. 수집 기사 → 요약 API 입력

백엔드 `NewsItem` 스키마와 동일하다.

```json
{
  "id": "news-037518eeeec0",
  "title": "애플 '시리 AI' 26일부터 한국어로 쓸 수 있다",
  "summary": "애플의 인공지능(AI) 비서 '시리 AI'를 한국어로 쓸 수 있게 된다. …",
  "source": "동아일보",
  "url": "https://www.donga.com/news/Economy/article/all/20261021/134882618/1",
  "published_at": "2026-10-21T21:00:00+09:00"
}
```

- `id`: URL의 SHA-1 해시 앞 12자리. 같은 기사는 몇 번 수집해도 같은 ID가 나온다.
- `summary`: RSS 본문 요약(HTML 제거, 최대 300자). 없으면 제목을 사용한다.
- `published_at`: 한국 시간(KST) ISO 8601 형식.

### 5.2. 구독자 목록 (`data/subscribers.json`)

```json
[
  {
    "user_id": "user-001",
    "name": "홍길동",
    "email": "받을사람@example.com",
    "keywords": ["AI", "스타트업", "개발자 채용"]
  }
]
```

`user_id`는 요약 API에 함께 전달되어 백엔드 Long-term Memory의 사용자별 선호도와 연결된다.

## 6. 실행 방법

### 6.1. 준비

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cp .env.example .env                                     # GROQ_API_KEY, GMAIL_ADDRESS, GMAIL_APP_PASSWORD 입력
cp data/subscribers.example.json data/subscribers.json   # 받는 사람 정보 입력
```

macOS(Homebrew Python)에서는 시스템 전역 `pip install`이 막혀 있으므로 반드시 가상환경을 사용한다.

### 6.2. 뉴스 수집만 실행

```bash
python -m collectors.rss_news --keywords AI 스타트업 "개발자 채용"
# → data/collected_news.json ({"user_keywords": [...], "news": [...]})
```

### 6.3. 브리핑 파이프라인

```bash
# 터미널 1: 요약 API 서버
uvicorn main:app

# 터미널 2
python -m pipelines.daily_briefing --dry-run --no-ai   # 요약 없이 메일 레이아웃 확인
python -m pipelines.daily_briefing --dry-run           # AI 요약까지, 메일 대신 HTML 파일 저장
python -m pipelines.daily_briefing                     # 실제 발송
```

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--dry-run` | 메일을 보내지 않고 `data/briefings/`에 HTML 저장 | — |
| `--no-ai` | 요약 API 없이 수집 기사로 메일 모양만 확인 | — |
| `--only USER_ID` | 특정 구독자에게만 실행 | 전체 |
| `--hours N` | 최근 N시간 이내 기사만 사용 | 24 |
| `--max N` | 구독자당 요약할 최대 기사 수 | 15 |
| `--batch-size N` | 요약 API 1회당 보낼 기사 수 | 5 |

## 7. 자동 실행 (GitHub Actions)

- 실행 시각: 매일 07:30 KST (cron `30 22 * * *`, UTC 기준). GitHub 사정으로 지연될 수 있다.
- 수동 실행: Actions 탭 → Daily Briefing → Run workflow. 기본값은 `dry_run`(메일 미발송).
- 예약 실행은 기본 브랜치(`sub`)에 있는 워크플로우만 동작한다.

필요한 Repository secrets:

| 이름 | 내용 |
|---|---|
| `GROQ_API_KEY` | 요약 모델 API 키 |
| `GMAIL_ADDRESS` | 보내는 Gmail 주소 |
| `GMAIL_APP_PASSWORD` | 위 계정에서 발급한 앱 비밀번호 |
| `SUBSCRIBERS_JSON` | `data/subscribers.json` 내용 전체 |

## 8. 테스트

네트워크, LLM, SMTP는 모두 모의 처리하여 API 키나 인터넷 없이 실행된다.

```bash
python -m pytest tests/test_rss_collector.py tests/test_daily_briefing.py tests/test_api.py tests/test_agent_errors.py
```

**결과: 30 passed** (자동화 파트 20개 + 기존 백엔드 10개)

| 구분 | 검증 내용 |
|---|---|
| 수집기 (7) | HTML·엔티티 제거, `NewsItem` 스키마 호환, GMT→KST 변환, 영문 단어 경계 매칭, 여러 단어 키워드, 24시간 필터·중복 제거, 추적 파라미터 제거, 키워드 균형 선택 |
| 메일 (3) | 제목 형식, HTML 이스케이프, AI 생성 안내 문구, UTF-8 charset, 텍스트 버전, 뉴스 없음 안내 |
| 파이프라인 (6) | 요약 후 발송, 기사 없으면 LLM 미호출, 한 구독자 실패 시 나머지 계속, dry-run 파일 저장, 5건 단위 분할·병합, 실패 묶음 분할 재시도 |
| 발송·보안 (4) | 587 포트 재시도, 앱 비밀번호 공백 제거, 비밀번호 오류 시 명확한 메시지, 로그 이메일 마스킹 |

실제 RSS 수집(8개 피드 정상)과 Gmail 실제 발송은 로컬에서 별도로 확인했다.

## 9. 문제 해결 기록

| 증상 | 원인 | 해결 |
|---|---|---|
| 네이버 개발자센터에 '검색' API가 없음 | API HUB 이관으로 신규 신청 중단, 약관상 AI 요약 금지 | 언론사 RSS로 전환 |
| `pip install` 시 `externally-managed-environment` | Homebrew Python의 시스템 패키지 보호(PEP 668) | 프로젝트별 가상환경(`.venv`) 사용 |
| 브라우저에서 HTML 한글 깨짐 | HTML에 문자 인코딩 선언 누락 | `<meta charset="utf-8">` 추가 |
| 요약 API 502 | 추론 토큰이 응답 한도(4096)를 소모해 JSON 잘림 | 5건 단위 분할 + 실패 시 재분할 |
| `SMTPServerDisconnected` | 실제로는 535(로그인 거부). `smtplib`이 다른 방식으로 재로그인할 때 Gmail이 연결을 끊어 원인이 가려짐. 앱 비밀번호와 발신 주소가 서로 다른 계정이었음 | 같은 계정의 앱 비밀번호로 교체, 로그인 방식을 1회로 고정해 535 오류를 그대로 표시 |
| Actions에서 날짜가 하루 전으로 표시될 위험 | GitHub 서버가 UTC 기준 | 날짜를 KST 기준으로 계산 |

## 10. AI 윤리 및 개인정보

- 모든 브리핑 메일 하단에 "기사 선정과 요약은 AI(Groq · gpt-oss-20b)가 생성했으며 오류가 있을 수 있으니 원문을 확인하라"는 문구를 표시한다.
- 원문 링크와 언론사명을 그대로 제공해 출처를 확인할 수 있게 한다.
- 구독자 이메일은 저장소에 커밋하지 않는다(`.gitignore`). 자동 실행 시에는 GitHub Secret으로만 전달한다.
- 공개 저장소의 Actions 로그에 남지 않도록 이메일 주소를 `d***@gmail.com` 형태로 가린다.
- 메일에 수신 거부 방법(답장으로 요청)을 안내한다. 실사용자 모집 시 이메일 수집·이용 동의를 받는다.

## 11. 한계 및 향후 과제

- [ ] 메일 속 기사별 👍/👎 링크 → `/api/feedback` 연결 (백엔드 GET 엔드포인트와 서비스 배포 필요)
- [ ] 선호도·피드백 데이터베이스 영구 저장 (현재 백엔드 서버 메모리 기반)
- [ ] 구독 신청 폼 및 동의 절차 (현재는 `subscribers.json` 수동 관리)
- [ ] 언론사가 다르게 쓴 같은 사건 기사의 중복 제거 정확도 개선
- [ ] 배포 환경에서 SMTP 포트가 막히는 경우 HTTP 기반 메일 API(Resend 등) 전환 검토

## 12. 진행 현황

- [x] 뉴스 소스 검토 및 RSS 채택
- [x] RSS 수집기 구현 및 실제 피드 8개 수집 확인
- [x] 키워드 필터링·중복 제거·균형 선택
- [x] 요약 API 연동 (분할 요청 및 재시도)
- [x] 이메일 브리핑 생성 및 실제 발송 확인
- [x] GitHub Actions 일일 자동 실행 워크플로우
- [x] 자동 테스트 20개 작성 (전체 30개 통과)
- [ ] Repository secrets 등록 및 Actions 실제 실행 확인
- [ ] 피드백 링크 연동

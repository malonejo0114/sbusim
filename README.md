# 스부심(SBUSIM) - Threads Scheduler MVP

Threads 공식 Graph API 기반 예약 발행 + 다계정 자동화 MVP입니다.

## 구성

- Next.js(App Router) + TypeScript
- Prisma + PostgreSQL
- Redis + BullMQ (예약 작업)
- 로그인 페이지 + 운영자 인증 쿠키
- 다중 Threads 계정 워크스페이스(계정별 진입형 UI)
- 계정별 프록시 URL 저장(계정별 고정 egress IP 구성 가능)
- AI(Perplexity/Gemini) 기반 계정별 자동발행 플랜(주제형/정보형/CTA형, 일 1회)
- AI 기반 이슈 브리핑 + 다중 글 초안 생성 + 예약 등록
- 게시물 성과(조회/좋아요/댓글/리포스트/인용) 동기화/대시보드
- access_token: DB 평문 저장 금지, `ENCRYPTION_KEY`로 AES-256-GCM 암호화 저장

## 로컬 실행

### 0) 사전 준비

- Docker / Docker Compose
- Node.js
- pnpm (없으면 `corepack` 사용 가능)

### 1) 인프라 실행 (Postgres/Redis)

```bash
docker compose up -d
# 경로/프로젝트명 이슈가 있으면:
# docker compose -p sbusim up -d
```

### 2) 환경변수 설정

```bash
cp .env.example .env
```

`ENCRYPTION_KEY`는 32바이트 키가 필요합니다:

```bash
openssl rand -base64 32
```

`.env`에 아래를 채워주세요:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `APP_BASE_URL` (dev: `http://localhost:3000`)
- `DASHBOARD_LOGIN_ID` (기본 `hasun`, 초기 bootstrap용)
- `DASHBOARD_LOGIN_PASSWORD` (초기 bootstrap용)
- `DASHBOARD_LOGIN_ACCOUNTS` (선택: `id:pw,id2:pw2` 또는 JSON 배열, 초기 bootstrap용)

로그인 계정은 운영 중에는 DB `DashboardLoginAccount` 테이블을 우선 사용합니다. env 값은 테이블이 비어 있을 때만 최초 계정 bootstrap 용도로 사용됩니다.
- `DATABASE_URL` (기본값 그대로 사용 가능)
- `REDIS_URL` (기본값 그대로 사용 가능)
- `ENCRYPTION_KEY`
- `PERPLEXITY_API_KEY` 또는 `GEMINI_API_KEY` (둘 중 하나 이상)
- `CONTENT_AI_PROVIDER` (옵션: `perplexity` | `gemini`)
- `PERPLEXITY_MODEL` (옵션, 기본 `sonar`)
- `GEMINI_MODEL` (옵션, 기본 `gemini-2.0-flash`)
- `AI_MODEL_PRICING_JSON` (옵션, AI 사용량 비용 계산 단가 override)
- `USD_KRW_RATE` (옵션, 기본 `1380`, AI 비용 KRW 환산용)
- `TELEGRAM_BOT_TOKEN` (옵션, 오류 알림)
- `TELEGRAM_CHAT_ID` (옵션, 오류 알림)
- `AUTO_REPAIR_ENABLED` (옵션, 기본 `1`: 오류 시 AI 자동복구 시도)
- `AUTO_REPAIR_MAX_ATTEMPTS` (옵션, 기본 `1`: 게시글 자동복구 최대 횟수)
- `AUTO_REPAIR_AI_PROVIDER` (옵션: `auto` | `gemini` | `perplexity`)
- `AUTO_REPAIR_AI_MODEL` (옵션, 예: `gemini-2.0-flash`)
- `LOW_VIEW_ALERT_THRESHOLD` (옵션, 기본 `100`)
- `LOW_VIEW_ALERT_LOOKBACK_HOURS` (옵션, 기본 `48`)
- `LOW_VIEW_ALERT_MIN_POSTS` (옵션, 기본 `4`)
- `LOW_VIEW_ALERT_COOLDOWN_MINUTES` (옵션, 기본 `720`)

`AI_MODEL_PRICING_JSON` 예시:

```json
{
  "gemini/gemini-2.0-flash": { "promptUsdPer1M": 0.1, "completionUsdPer1M": 0.4, "requestUsd": 0 },
  "gemini/gemini-3.0-pro-preview": { "promptUsdPer1M": 3.5, "completionUsdPer1M": 10, "requestUsd": 0 },
  "perplexity/sonar-pro": { "promptUsdPer1M": 3, "completionUsdPer1M": 15, "requestUsd": 0 },
  "perplexity/*": { "promptUsdPer1M": 1, "completionUsdPer1M": 1, "requestUsd": 0 }
}
```

### 3) 의존성 설치

```bash
pnpm install
# pnpm이 없다면: corepack pnpm install
```

### 4) DB 마이그레이션/생성

```bash
pnpm prisma:migrate
```

### 5) 웹 서버 실행

```bash
pnpm dev
```

### 6) 워커 실행 (예약 발행 처리)

별도 터미널에서:

```bash
pnpm worker
```

### 7) 접속

- http://localhost:3000
- http://localhost:3000/login
- 로그인 후 http://localhost:3000/dashboard

## 동작 방식 (요약)

1. OAuth로 Threads 계정을 연결 (`/api/auth/threads/start` → `/api/auth/threads/callback`)
2. 계정 워크스페이스에서 예약 생성 시 해당 계정으로 BullMQ `publish` 잡 추가
3. 워커가 `컨테이너 생성 → publish`로 원글 발행
4. 상태 업데이트: `PENDING` → `RUNNING` → `SUCCESS | FAILED`
5. `insights-sync` 반복 잡(30분 간격)이 최근 게시물 인게이지먼트를 동기화
6. 최근 48시간 기준 계정별 조회수 저성과(100+ 미달 지속) 조건 만족 시 텔레그램 알림 전송
7. 발행 실패가 `HTTP 400/422/413` 계열(콘텐츠/포맷 오류)일 때만 AI 자동복구 1회 후 재시도

## 신규 기능

### 1) 계정별 워크스페이스 + 고정 IP

- 관리 홈(`/dashboard`)에서 계정별 예약/발행/성과를 한눈에 확인합니다.
- 각 계정을 클릭하면 전용 워크스페이스(`/dashboard/accounts/:accountId`)로 이동합니다.
- 글 작성/설정/성과는 계정 단위로 분리되어 동작합니다.
- 각 계정에 Proxy URL(`http://user:pass@host:port`)을 저장할 수 있습니다.
- 실제 고정 IP는 프록시/VPS 인프라가 제공하며, 앱은 해당 계정 요청에 그 프록시를 사용합니다.

### 2) 이미지/영상 파일 자동 URL 변환

- 예약 폼에서 파일 첨부 시 `/api/uploads/media`로 업로드 후 URL을 자동 생성합니다.
- 생성된 URL을 Threads `image_url`/`video_url`에 사용해 발행합니다.
- 업로드 파일은 로컬 `public/uploads`에 저장됩니다.
- Threads가 미디어를 가져가려면 외부에서 접근 가능한 HTTPS 도메인(터널/실도메인)이 필요합니다.

### 3) 예약 글 삭제

- 게시 기록에서 아직 발행되지 않은 예약 글을 삭제할 수 있습니다.
- 발행 중(`RUNNING`) 또는 이미 발행된 글(`SUCCESS`, `remotePostId` 존재)은 삭제할 수 없습니다.
- API: `DELETE /api/scheduled-posts/:id`

### 4) 이슈 브리핑 + 다중 글 생성

- 대시보드에서 이슈 질의(예: 오늘 이슈 시황) 입력
- 저장형 프롬프트 템플릿 생성/수정/삭제/선택
- 생성 개수(1~10) 지정 후 글 초안 다건 생성
- 생성된 초안에서 예약 시간 지정 후 `예약발행`으로 목록에 즉시 추가

### 5) 엑셀 일괄 예약(다계정)

- 관리 홈(`/dashboard`)에서 `.xlsx/.csv` 업로드 후 미리보기(검증) → 일괄 예약 등록 가능
- 한 파일에서 여러 계정을 동시에 예약 가능(계정 식별 컬럼 사용)
- 필수 컬럼: `account`, `text`, `scheduledAt`
- 선택 컬럼: `reply1` ~ `reply10`, `mediaType`, `mediaUrl`
- 예약시간 지원 형식(예): `YYYY-MM-DD HH:mm`, `YYYY.MM.DD 오전/오후 HH:mm`, `YYYY-MM-DD`(시간 생략 시 09:00, KST)
- 템플릿 파일: `/templates/scheduled-posts-import-template.csv`

### 6) 인게이지먼트(성과) 추적

- 워커가 주기적으로 발행된 원글의 성과를 동기화합니다.
- 관리 홈/계정 워크스페이스에서 아래 지표를 확인할 수 있습니다.
  - 조회수(`views`)
  - 좋아요(`likes`)
  - 댓글(`replies`)
  - 리포스트(`reposts`)
  - 인용(`quotes`)
- 수동 동기화 API: `POST /api/insights/sync?threadsAccountId=<id>&force=1`

필요 권한(Threads 앱):

- `threads_basic`
- `threads_content_publish`
- `threads_manage_insights` (성과 지표 조회 시)

## 주의

- 스크래핑/비공식 자동화 없이, 공식 Threads(Graph) API만 사용합니다.
- 초기 개발/테스트는 Meta 앱 설정(테스터 계정 등) 및 권한 승인 상태에 따라 제한될 수 있습니다.
- 계정별 고정 IP 요구사항은 앱 코드만으로 보장되지 않으며, 각 계정에 연결할 고정 프록시 인프라가 별도로 필요합니다.

## AWS Lightsail 배포 (app/stg 동시 운영)

사전 조건:

- DNS: `app.<your-domain>`, `stg.<your-domain>` 모두 서버 IP로 A 레코드 연결
- 서버 포트: 22, 80, 443 허용

서버에서:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

코드 업로드 후, `deploy` 디렉터리에서:

```bash
cp .env.example .env
cp env/prod.env.example env/prod.env
cp env/stg.env.example env/stg.env
```

`deploy/Caddyfile`의 도메인/이메일을 실제 값으로 수정 후:

```bash
docker compose -f deploy/docker-compose.server.yml up -d --build
```

초기 마이그레이션:

```bash
docker compose -f deploy/docker-compose.server.yml run --rm app_prod_web pnpm prisma migrate deploy
docker compose -f deploy/docker-compose.server.yml run --rm app_stg_web pnpm prisma migrate deploy
```

## 자동화 기능 상태

- 차트 렌더링 / Daily Snapshot / Daily Calendar / Weekly COT 자동 생성은 비활성화 상태입니다.
- Investing RSS 수집/초안 자동화는 활성화되어 있습니다. (기본: 시간별 draft 생성 + 수동 발행)
- 계정별 완전 자동 발행 플랜(요일/운영시간/랜덤 텀/INFO-CTA 비율)은 활성화되어 있습니다.
- 활성 엔드포인트:
  - `GET /api/cron/rss-insights` (헤더 `x-cron-secret` 필요, `targetThreadsAccountId` 쿼리 또는 `RSS_REVIEW_TARGET_ACCOUNT_IDS` 설정 필요)
  - `GET /api/admin/content/queue`
  - `POST /api/admin/content/run-job` (`job: rss_insight | seed_rss_sources`, rss_insight는 `targetThreadsAccountId` 필수)
  - `POST /api/admin/content/test-post` (`postId` 재시도, 필요 시 `threadsAccountId` 지정)
  - `GET /api/daily-topic-plans?threadsAccountId=...`
  - `POST /api/daily-topic-plans`
  - `PATCH /api/daily-topic-plans/:id`
  - `DELETE /api/daily-topic-plans/:id`
  - `POST /api/daily-topic-plans/run` (수동 1회 실행)
- 비활성화 엔드포인트:
  - `GET /api/cron/daily-snapshot`
  - `GET /api/cron/daily-calendar`
  - `GET /api/cron/weekly-cot`
  - `POST /api/admin/content/preview-snapshot`
  - `POST /api/admin/content/render-chart`

### 기본 RSS 소스

- Investing KR 뉴스: `https://kr.investing.com/rss/news.rss`
- Investing 세계 뉴스: `https://www.investing.com/rss/news_287.rss`
- Investing 선물/원자재: `https://www.investing.com/rss/news_11.rss`
- Investing 주식: `https://www.investing.com/rss/news_25.rss`
- Investing 경제지표: `https://www.investing.com/rss/news_95.rss`

### Investing RSS 시간별 수집 설정

- `RSS_REVIEW_ENABLED` (기본 `1`): 시간별 RSS 검수용 초안 생성 잡 활성화 여부
- `RSS_REVIEW_INTERVAL_MINUTES` (기본 `60`): 수집 주기(분, 최소 10)
- `RSS_REVIEW_MAX_DRAFTS` (기본 `3`): 1회 실행당 생성할 신규 초안 최대 개수
- `RSS_REVIEW_TARGET_ACCOUNT_IDS` (선택): 쉼표 구분 ThreadsAccount ID 목록. 지정 시 해당 계정만 시간별 초안 생성

계정별 RSS 키워드 세트:

- `/admin/content`에서 계정별로 `포함 키워드`/`제외 키워드`/`시간별 RSS 수집 활성화`를 저장합니다.
- 시간별 수집 잡은 `활성화된 계정(rssReviewEnabled=true)`만 대상으로 초안을 생성합니다.
- RSS 큐 아이템마다 `target_threads_account_id`를 저장하고, 수동 발행 시 해당 계정으로만 발행됩니다.

적용 방법:

```bash
# Prisma 마이그레이션 반영
pnpm prisma migrate deploy

# Supabase SQL Editor 또는 Supabase CLI로 최신 RSS 마이그레이션 반영
# supabase/migrations/20260220064000_rss_sources_refresh.sql
# supabase/migrations/20260324143500_post_queue_target_threads_account.sql
```

### 프롬프트 생성 예약 간격

- 계정 워크스페이스의 글 생성 폼에 `초안 간격(분)` 입력 추가
- 기본 60분, 생성된 초안의 예약 시간이 간격 단위로 자동 분산됩니다.

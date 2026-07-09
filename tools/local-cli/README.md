# sbusim 로컬 CLI

`sbusim threads ...` 명령은 sbusim 서버의 로컬 API만 호출합니다. Meta/Threads API를 직접 호출하지 않고, Threads 토큰을 다루지 않으며, 스크래핑을 하지 않습니다.

## 설치

```bash
cd tools/local-cli
npm link
```

또는 패키지 경로를 전역 설치할 수 있습니다.

```bash
npm i -g ./tools/local-cli
```

## `.env.local` 설정

다음 중 하나에 설정 파일을 둡니다. 나중에 읽힌 값이 앞선 값을 덮어씁니다.

1. `~/.sbusim/.env.local`
2. 실행 위치의 `./.env.local`
3. 환경 변수 `SBUSIM_API_URL`, `SBUSIM_API_KEY`

예시:

```dotenv
SBUSIM_API_URL=https://app.sbusim.co.kr
SBUSIM_API_KEY=긴_랜덤_키
```

API 키는 진단 메시지에 출력하지 않습니다.

## 명령어 예시

계정 목록:

```bash
sbusim threads accounts --owners hasun,ops2
sbusim threads accounts --accounts 2pinefine --json
```

게시물 조회:

```bash
sbusim threads posts --date 2026-07-08 --owners hasun,ops2
sbusim threads posts --date 2026-07-08 --sync --out posts.json
sbusim threads posts --date 2026-07-08 --json
```

인사이트 동기화:

```bash
sbusim threads sync-insights --date 2026-07-08 --owners hasun
```

리포트 생성:

```bash
sbusim threads report --date 2026-07-08
sbusim threads report --date 2026-07-08 --xlsx --out report.xlsx
sbusim threads report --date 2026-07-08 --format json --out report.json
sbusim threads report --date 2026-07-08 --no-thread-url --sync
```

게시물 예약:

```bash
sbusim threads schedule --account 2pinefine --text "본문" --now
sbusim threads schedule --account 2pinefine --text post.txt --replies replies.txt --at "2026-07-09T18:30:00+09:00"
```

`--text` 값이 존재하는 파일 경로이면 UTF-8 파일 내용을 읽어 본문으로 사용합니다. `--replies` 파일은 `---`만 있는 줄을 기준으로 답글을 나누며 최대 10개까지 허용합니다.

도움말:

```bash
sbusim --help
sbusim threads --help
```

# API 키를 노출하지 않는 공유 방법

2026-11-06 조사 기준입니다. **현재 코드에서는 Node 서버 하나에서 화면과 AI API를 함께 제공하는 방식이 구현·운영 작업이 가장 적다고 판단합니다.** 기존 서버 코드를 재사용하고, 서로 다른 사이트 사이의 인증·CORS 설정이 필요하지 않기 때문입니다.

| 방식                                 | 키 보관 위치    | 필요한 구성                         | 적용 판단                                |
| ------------------------------------ | --------------- | ----------------------------------- | ---------------------------------------- |
| 사내 HTTPS 서버에서 Node 앱 실행     | 서버 환경변수   | Node 앱 하나 + 기존 HTTPS/접속 제한 | 사내 서버가 있으면 우선 추천             |
| Render Node Web Service              | Render 환경변수 | 앱 하나 + 접속 계정                 | 별도 사내 서버가 없을 때 간단한 대안     |
| GitHub Pages + Cloudflare Worker API | Worker Secret   | 정적 사이트 + API + 인증·CORS       | `github.io` 주소를 반드시 유지할 때 대안 |

Render는 Node 앱을 실행하고 `onrender.com` 주소로 제공하며 환경변수에 비밀값을 둘 수 있습니다. GitHub Pages에는 정적 기능만 배포할 수 있으므로, Pages에서 AI까지 사용하려면 별도 API가 필요합니다. Worker는 Secret을 서버 코드의 바인딩으로 사용할 수 있습니다. [Render Node 배포](https://render.com/docs/deploy-node-express-app), [Render 환경변수](https://render.com/docs/configure-environment-variables), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Worker Secret](https://developers.cloudflare.com/workers/configuration/secrets/)

## 준비한 공유 서버

기본 `npm start`는 계속 `127.0.0.1`에서만 실행됩니다. 공유 모드를 사용하려면 서버에 아래 환경변수를 설정합니다. 템플릿은 `.env.shared.example`입니다.

| 환경변수          | 값                                                   |
| ----------------- | ---------------------------------------------------- |
| `PUBLIC_ORIGIN`   | 접속할 HTTPS 주소. 예: `https://formula.example.com` |
| `HOST`            | `0.0.0.0`                                            |
| `PORT`            | 호스팅 서비스가 지정한 포트 또는 사내 서버 포트      |
| `ACCESS_USERNAME` | 팀에 공유할 접속 아이디                              |
| `ACCESS_PASSWORD` | 접속 비밀번호. 서버 비밀 설정에만 저장               |
| `JEV_API_KEY`     | TypeSafe API 키. 서버 비밀 설정에만 저장             |

공유 모드는 HTTPS 주소와 접속 계정이 없으면 시작하지 않습니다. 화면·상품 예제·API 모두 HTTP Basic 로그인 뒤에 제공하고, API에는 같은 사이트의 요청만 허용합니다. `/healthz`는 인증 없이 상태만 응답합니다. 브라우저에는 API 사용 가능 여부만 전달하며 API 키와 서버 비밀번호는 응답에 포함하지 않습니다.

브라우저의 로그인 창에는 **접속 계정**을 입력합니다. 방문자가 TypeSafe 키를 입력하거나 보유할 필요는 없습니다. Basic 로그인은 HTTPS에서 사용합니다. 이 구현은 소규모 팀의 공유 계정 방식이며 사용자별 계정 관리·차단·사용량 제한 기능은 없습니다. 사용자별 관리가 필요하면 기존 사내 SSO/접근 제어를 연결하는 편이 낫습니다.

## Render에 올리는 경우

1. 소스를 새 GitHub 저장소 루트에 올립니다. 실제 `.env`는 올리지 않습니다.
2. Render에서 **New → Web Service → Git Provider**로 저장소를 연결합니다.
3. 언어는 Node, 빌드 명령은 `npm ci --include=dev && npm run check`, 시작 명령은 `node server.js`로 설정합니다.
4. Node 버전은 24를 선택합니다. Environment에 `ACCESS_USERNAME`, `ACCESS_PASSWORD`, `JEV_API_KEY`를 설정합니다.
5. Render가 제공하는 `RENDER_EXTERNAL_URL`을 앱이 `PUBLIC_ORIGIN` 대신 사용할 수 있습니다. 별도 도메인을 쓰면 `PUBLIC_ORIGIN`을 직접 설정합니다.
6. Health Check Path는 `/healthz`로 설정하고, 생성된 HTTPS URL에서 로그인·분석·AI 검토를 확인합니다.

Render는 외부 HTTP 요청을 받으려면 `0.0.0.0`과 지정 `PORT`에서 수신하도록 안내합니다. 공유 모드가 이 설정을 사용합니다. 요금제는 생성 화면에서 선택하며 무료 플랜을 선택할 경우 서비스 휴면 등 제한도 확인합니다. [Render Web Services](https://render.com/docs/web-services), [Render 기본 환경변수](https://render.com/docs/environment-variables), [무료 서비스 제한](https://render.com/docs/free)

사내 서버라면 같은 환경변수로 앱을 실행하고 기존 HTTPS 프록시가 앱 포트로 전달하도록 설정합니다. 이 앱은 공개 주소의 Host와 Origin을 검증하므로 프록시가 원래 Host를 보존해야 합니다.

## `github.io`를 유지해야 하는 경우

기존 Pages 워크플로는 그대로 사용합니다. AI가 필요 없는 사용자라면 Pages만으로 분석·상품명 추천·계산식 검증·복사를 사용할 수 있습니다.

AI 검토까지 필요하면 Worker 등에서 TypeSafe 요청을 대신 처리해야 합니다. 이 경우 API 인증과 Pages Origin 허용, 프런트엔드의 API URL 연결이 추가됩니다. 현재 코드는 이 구성을 배포하거나 연결하지 않았습니다. 키 보관은 Worker Secret으로 처리할 수 있지만, 키를 숨기는 것과 무단 API 사용을 막는 것은 별개이므로 인증도 함께 구성해야 합니다.

GitHub Secret을 JavaScript 번들에 주입하는 방식은 사용하지 않습니다. Secret은 Actions 작업에 전달하는 수단이며, 공개 산출물에 기록한 값까지 숨겨 주지는 않습니다. GitHub Secret으로 서버 배포 작업을 자동화하더라도 키의 최종 보관 위치는 서버 런타임이어야 합니다. [GitHub Actions Secret](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

실제 서버 생성·외부 배포·키 등록은 아직 수행하지 않았습니다.

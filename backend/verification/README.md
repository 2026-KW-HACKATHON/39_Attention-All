# 우이런 API 기능 검증 프론트

실제 Firebase Web SDK를 이용해 Callable 49개를 호출한다. 브라우저에서 `전체 API 검증 시작`을 누르면 시나리오별 결과/응답을 확인하고 JSON을 내려받을 수 있다. scenarios.mjs는 Node SDK와 브라우저 SDK가 함께 실행하며, response-contract.mjs는 프론트 전달 명세의 필수 응답 필드·페이지 구조·PIN 비노출을 독립적으로 확인한다. 전체 JSON Schema 검증은 아니다.

## 재실행

프로젝트 루트에서 실행한다. demo-uirun은 폐기 가능한 로컬 테스트 전용이다. 준비 명령은 해당 에뮬레이터의 기존 테스트 상태를 초기화하므로 다른 로컬 테스트와 동시에 실행하지 않는다.

```sh
npm --prefix backend run emulators
```

다른 터미널에서 프로젝트 루트 기준으로 전용 로컬 서버를 실행한다:

```sh
node backend/verification/server.cjs
```

`http://127.0.0.1:5179/backend/verification/`을 연다. 전체 검증 버튼이 전용 테스트 계정·DB·Storage를 매번 준비하므로 탈퇴 검증 후에도 그대로 재실행할 수 있다. 별도 prepare 명령과 새로고침이 필요하지 않다. 같은 에뮬레이터에서 다른 테스트를 동시에 실행하지 않는다.

서버의 초기화 요청은 localhost 바인딩 + 동일 Origin JSON POST만 허용한다. 운영 관리 API를 제공하지 않는다. Python 정적 서버만으로는 자동 준비가 동작하지 않는다.

브라우저 대신 같은 시나리오의 Node SDK 실행:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
node backend/verification/prepare.cjs
node backend/verification/run.cjs
```

브라우저 또는 Node 완료 후 탈퇴 후속 처리 확인:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
GCLOUD_PROJECT=demo-uirun \
node backend/verification/maintenance.cjs
```

## 범위

84개 시나리오: 공개 조회, 동의/프로필/설정, 권한 차단, 달리기 GPS/재시도/충돌/일시정지/재개/완료/타인 차단, 산책 취소, 주·월·년 집계, JPEG 업로드와 실제 Storage 트리거, 사진·간단 제보/사진 추가/재확인/정기관찰, 관리자 승인/뉴스, 혜택 발급과 PIN 오류/정상 사용, 기여 철회, 탈퇴 요청과 차단. 후속 스크립트는 실제 서버 정리 핸들러를 로컬에서 호출해 Auth·사진·관찰 삭제까지 확인한다.

사진 getPhotoAccess의 운영 IAM signBlob은 로컬 에뮬레이터에 없다. demo-uirun의 FUNCTIONS_EMULATOR=true에서만 5분 만료 로컬 이미지 전달 경로를 제공한다. 발급 전 본인/admin 권한 검사, 이미지 조회 시 삭제/준비 상태 검사, 토큰 변조·만료 검증을 수행한다. 이 경로의 고정 HMAC 키는 테스트 전용이며 운영에는 등록하지 않는다. **운영 사진 signed URL/IAM, 실제 Google 로그인/App Check, Cloud Scheduler 실제 전달, 실외 GPS/카메라/백그라운드 동작은 이 로컬 결과의 보장 범위에 포함되지 않는다.** 합성 GPS와 JPEG를 사용했고 운영에 테스트 제보·쿠폰을 생성하지 않았다.

검증 화면은 Hosting public인 backend/web 밖에 두었으므로 Firebase Hosting에 배포되지 않는다. production 함수 목록은 기존 Callable 49개와 트리거 2개를 유지한다.

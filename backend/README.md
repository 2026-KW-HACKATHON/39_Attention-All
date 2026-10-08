# Firebase 백엔드

Node22, Java17 이상이 필요하다.

```sh
cd backend
npm ci
npm --prefix functions ci
npm test
npm run check
# 서버·보안 규칙·사진 업로드·탈퇴를 로컬에서 순서대로 검증
npm run test:integration
npm run emulators
```

에뮬레이터 실행 후 저장소 루트의 별도 터미널에서:

```sh
node backend/verification/server.cjs
```

http://127.0.0.1:5179/backend/verification/ 에서 API 검증 버튼을 누른다. demo-uirun 데이터만 초기화한다. 테스트 결과는 무시되는 output/에 생성된다.

GitHub Actions에서도 동일한 단위·통합 테스트를 실행한다. 배포는 자동으로 하지 않는다.

프론트는 [API 명세](../docs/api/FRONTEND.md)를 따른다. functions/src/는 서버, web/는 연결 검토 화면, client/api.ts는 RN 호출 예시다. 웹은 web/retouch/를 직접 수정한다. Firebase 클라이언트 JSON은 공개 설정이며 서비스 계정 키/CLI 토큰은 포함하지 않는다.

```sh
# 실제 프로젝트 변경 시에만 실행
cd backend
npx firebase deploy --project uirun-92539 --only functions,firestore:rules,firestore:indexes,storage,hosting
```

## 관리자 로그인 시크릿

관리자 화면은 `/admin.html`입니다. `adminLogin`은 Firebase Secret Manager의 `UIRUN_ADMIN_ID`, `UIRUN_ADMIN_PASSWORD`만 읽으며, 인증 성공 시 관리자 claim이 있는 Firebase Auth custom token을 발급합니다. 계정이 미설정되거나 비밀번호가 다르면 로그인을 거절합니다. IP별 1분당 10회 요청 제한을 적용합니다.

계정 변경 시 프로젝트 권한을 가진 담당자가 다음 명령으로 값을 입력하고 함수를 다시 배포합니다. 비밀번호를 코드·명령 인수·Git에 작성하지 마세요.

```sh
npx firebase functions:secrets:set UIRUN_ADMIN_ID --project uirun-92539
npx firebase functions:secrets:set UIRUN_ADMIN_PASSWORD --project uirun-92539
npx firebase deploy --only functions:uirun:adminLogin --project uirun-92539
```

로컬 Emulator에는 Git에서 제외되는 `functions/.secret.local`을 사용할 수 있습니다. 심사용 계정은 별도 채널로 전달합니다.

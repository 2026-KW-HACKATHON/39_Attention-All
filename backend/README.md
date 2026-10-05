# Firebase 백엔드

Node22, Java17 이상이 필요하다.

```sh
cd backend
npm ci
npm --prefix functions ci
npm test
npm run check
npm run emulators
```

에뮬레이터 실행 후 저장소 루트의 별도 터미널에서:

```sh
node backend/verification/server.cjs
```

http://127.0.0.1:5179/backend/verification/ 에서 API 검증 버튼을 누른다. demo-uirun 데이터만 초기화한다. 테스트 결과는 무시되는 output/에 생성된다.

프론트는 [API 명세](../docs/api/FRONTEND.md)를 따른다. functions/src/는 서버, web/는 연결 검토 화면, client/api.ts는 RN 호출 예시다. 웹은 web/retouch/를 직접 수정한다. Firebase 클라이언트 JSON은 공개 설정이며 서비스 계정 키/CLI 토큰은 포함하지 않는다.

```sh
# 실제 프로젝트 변경 시에만 실행
cd backend
npx firebase deploy --project uirun-92539 --only functions,firestore:rules,firestore:indexes,storage,hosting
```

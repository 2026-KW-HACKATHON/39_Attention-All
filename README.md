# 우이런 (UI RUN)

달리고 걸으며 환경 참여를 일상화하는 월계1동 우이천 ESG 플랫폼. 2026 광운대학교 KW해커톤 **39조 일동차렷** 프로젝트입니다.

우이천의 러닝·산책에 현장 사진 제보와 재확인을 연결하고, 유효한 정보 기여를 포인트와 지역 혜택으로 기록합니다.

## 저장소 구성

| 경로 | 용도 |
|---|---|
| `mobile/` | Expo Development Build 기반 React Native Android 앱 |
| `backend/functions/` | Firebase Callable API, 사진 처리·정리 작업, 서버 테스트 |
| `backend/client/` | 앱과 공유하는 연결 설정·점검 코드, API 호출 예시 |
| `backend/web/` | 서버 연결 웹 프로토타입·운영자 화면 |
| `backend/verification/` | Emulator 기능·부하 검증 도구 |
| `docs/api/` | API 계약과 기능·부하 검증 결과 |
| `docs/mobile/` | Android 설정·팀 테스트 안내·검증 상태 |
| `docs/project/` | 초기 기획과 출처·팀 기록 |

웹 프로토타입과 검증 도구는 서버 회귀 검사 및 시연에 사용합니다. 빌드 결과·`node_modules`·개인 Firebase/지도 설정·토큰은 Git에서 제외합니다.

## 시작하기

Node.js 22, JDK 17을 준비합니다. Android는 Android Studio/SDK가 필요하며, 저장소를 짧은 영문 경로에 두는 것을 권장합니다.

```sh
cd backend
npm ci
npm --prefix functions ci
npm test
npm run check
# 로컬 demo-uirun 서버 실행
npm run emulators
```

모바일은 별도 터미널에서 의존성을 설치한 뒤 [앱 실행 안내](mobile/README.md)에 따라 `.env.local`과 연결 대상을 설정합니다. Expo Go로 실행할 수 없습니다.

```sh
cd mobile
npm ci
npm run typecheck
npm run lint
npm test
```

실제 Firebase를 사용할 팀원은 [Android 실기기 테스트 안내](docs/mobile/ANDROID-TEAM-TEST.md)를 따릅니다. 서버 배포와 로컬 API 검증은 [백엔드 안내](backend/README.md)를 참고합니다.

## 구현·검증 상태

Android 홈·지도·우리 우이천·운동·기록·사진 제보/재확인·포인트·혜택 화면과 Firebase API가 연결돼 있습니다. 앱은 Expo SDK 57, React Native 0.86, TypeScript, React Native Firebase와 Google Maps SDK for Android를 사용합니다. 서버는 Firebase Functions(Node.js 22), Firestore, Storage, Auth, App Check로 구성합니다.

자동 테스트·Android Emulator 시험·APK 빌드와 실제 휴대폰 시험을 구분합니다. **실기기 Google 로그인, 카메라/사진 업로드, 지도, 실외 GPS·잠금 화면 기록의 전체 흐름은 아직 검증 대기입니다.** 운영 수용량은 로컬 Emulator 결과로 확정하지 않습니다.

- [실기기 직전 수정·검증](docs/mobile/PRE-DEVICE-VERIFICATION.md)
- [모바일 기능별 상태](docs/mobile/STATUS.md) · [기능 보완 검증 기록](docs/mobile/COMPLETION-VERIFICATION.md)
- [Firebase 연결 설정·검증 범위](docs/mobile/CONNECTION-STATUS.md)
- [서버 기능 검증](docs/api/FUNCTIONAL-VERIFICATION.md) · [부하 검증](docs/api/LOAD-VERIFICATION.md)
- [API 명세](docs/api/FRONTEND.md) · [머신 판독 계약](docs/api/contracts.json)

제휴점포·실제 혜택 재고, 약관·보존 정책과 릴리스 서명은 후속 확정 항목입니다. 사용자 해결 확인 보상, AI 이미지 분류, Wear OS는 현재 구현 범위에 포함되지 않습니다. [초기 기획·출처·팀 기록](docs/project/CONCEPT.md)의 기능·포인트 예시는 현재 API 계약을 대체하지 않습니다.

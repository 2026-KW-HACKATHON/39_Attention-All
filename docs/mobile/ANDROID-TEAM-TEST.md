# 팀원 Android 실기기 테스트

PR #1이 머지된 최신 `main`을 받아 테스트한다. 코드·CI·ARM64 개발 APK 빌드는 통과했고, Firebase 및 수정 서버 함수 배포는 완료됐다. 실기기 검증은 기능 보완 후 전체 흐름으로 진행한다.

## 준비

- 개발 PC에 Node.js 22, JDK 17, Android Studio/Android SDK를 준비한다. 저장소는 `C:\dev\39_Attention-All`처럼 영문 경로에 둔다.
- Android 휴대폰에서 개발자 옵션 → USB 디버깅을 켜고 PC를 허용한다. `adb devices`에서 `device`로 표시되는지 확인한다.
- Firebase `uirun-92539`의 Android 앱 `com.attentionall.uirun` 설정에서 `google-services.json`을 내려받아 `mobile/`에 둔다.
- Google Cloud 담당자에게 이 앱의 Maps SDK for Android 키를 받아 둔다. 키의 Android 제한에 아래에서 확인한 실제 개발 서명 SHA-1이 포함되어야 한다.

```sh
git fetch origin
git switch main
git pull --ff-only
cd mobile
npm ci
```

`mobile/.env.local`에 다음을 설정한다. 토큰을 비워 두면 앱이 생성한 값을 다음 단계에서 등록한다.

```dotenv
EXPO_PUBLIC_UIRUN_TARGET=firebase
GOOGLE_MAPS_API_KEY=<지도 SDK 키>
EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN=
```

설정 파일·키·App Check debug 토큰은 Git에 올리지 않는다. Mac에서 만든 APK와 로컬 설정은 저장소에 포함되어 있지 않으므로 팀원 PC에서 빌드한다. Expo Go로는 네이티브 Firebase 기능을 시험할 수 없다.

## 설치·인증 준비

```sh
npm run prebuild
```

생성된 서명을 확인한다(Windows에서도 JDK의 keytool 사용).

```sh
keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

이 SHA-1·SHA-256을 Firebase Android 앱에 등록된 값과 대조한다. 다르면 담당자가 Firebase에 추가하고 지도 키의 SHA-1 제한에도 추가한다. Firebase 설정 파일을 다시 내려받았다면 prebuild를 다시 실행한다.

```sh
npm run android -- --device
```

실기기를 선택해 설치한다. 개발 빌드이므로 Metro 서버가 실행 중이어야 한다. USB 연결에서 Metro 연결이 안 되면 `adb reverse tcp:8081 tcp:8081`을 실행하고 필요하면 별도 터미널에서 `npm start`를 실행한다.

App Check debug 토큰이 비어 있다면 앱 실행 후 로그에서 토큰을 확인한다.

```powershell
adb logcat -d | Select-String "DebugAppCheckProvider"
```

macOS/Linux에서는 `adb logcat -d | rg DebugAppCheckProvider`를 사용한다. Firebase 콘솔 → App Check → 해당 Android 앱 → 디버그 토큰 관리에 본인 토큰을 등록한다. 콘솔 권한이 없으면 담당자에게 별도 전달한다. 앱을 다시 실행해 마이 → 개발용 연결 점검을 연다.

## 확인·공유할 결과

- [ ] App Check 토큰 발급 → 공개 API → Google 로그인 → 로그인 API 점검 모두 성공
- [ ] 지도가 표시되고 위치 권한 허용 후 실제 현재 위치 표시
- [ ] 사진 제보 촬영·업로드 성공, 앱을 다시 열어 저장 내용 확인
- [ ] 운동 시작 → 일시정지 직후 빠르게 재개 → 위치 수집 계속됨
- [ ] 운동 종료 → 기록 목록·상세에 저장 내용과 시간 표시
- [ ] 운동 중 네트워크를 끊고 종료 → 연결 복구 후 동기화 및 중복 기록 없음

위치 기반 운동은 앱이 지원하는 우이천 파일럿 구간에서 확인한다. 다른 장소에서 구간 제한으로 시작할 수 없다면 위치를 기록하고 해당 항목을 미검증으로 남긴다.

결과에는 테스트한 커밋, 휴대폰 모델·Android 버전, 각 항목의 성공/실패를 적는다. 실패하면 화면의 오류 코드와 발생 순서, 민감값을 제거한 관련 로그를 함께 전달한다. Google 로그인 오류 10은 패키지·개발 서명·OAuth 설정을 먼저 확인한다. debug 토큰 검사 통과는 릴리스 Play Integrity 검증을 대신하지 않는다.

현재 상세 검증 결과: [연결 상태](CONNECTION-STATUS.md).

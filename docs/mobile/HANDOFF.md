# Android 앱 Firebase 등록 요청 (백엔드 담당자 전달용)

작성 2026-10-05. 모바일 앱 1차(로그인·홈·마이페이지 연결) 기준이다. 서버·DB를 새로 만들지 않고 기존 프로젝트 `uirun-92539`에 Android 앱만 추가한다. 서비스 계정 키나 관리자 자격증명은 앱에 필요하지 않다.

## 1. 앱 정보

| 항목 | 값 |
|---|---|
| Android `applicationId` | `com.attentionall.uirun` — **잠정 제안값**. 저장소·팀에 확정된 값이 없어 이 값으로 개발했다. 등록 전에 팀이 확정해 주면 `mobile/app.config.ts`의 `APPLICATION_ID` 한 곳만 바꾼다. 등록 후 바꾸면 앱을 다시 등록해야 한다. |
| 앱 이름 | 우이런 |
| 개발 방식 | Expo SDK 57 **Development Build**(Continuous Native Generation, `npx expo prebuild`) · React Native 0.86 · New Architecture. Expo Go로는 실행하지 않는다. |
| Firebase SDK | `@react-native-firebase/app`·`auth`·`functions`·`storage`·`app-check` 26.4.0(모듈식 API) |
| Google 로그인 | `@react-native-google-signin/google-signin` 16.1.5(Original Google Sign-In). ID 토큰을 `GoogleAuthProvider.credential`로 Firebase Auth에 교환한다. 웹 `signInWithPopup`은 쓰지 않는다. |
| 서버 호출 | Functions `asia-northeast3` HTTPS Callable만. Firestore·Storage 직접 접근 없음. |
| 동의 버전 | `v2-2026-10` (`backend/client/mobile-config.json`) |

## 2. Firebase 콘솔에서 해 줄 일

1. **Android 앱 추가**: 프로젝트 `uirun-92539` › 프로젝트 설정 › 앱 추가 › Android. 패키지 이름 `com.attentionall.uirun`(확정값).
2. **SHA 지문 등록**(Google 로그인은 SHA-1, App Check Play Integrity는 SHA-256):
   - 개발 빌드 서명(`npx expo prebuild`가 만드는 `android/app/debug.keystore`, 2026-10-05 이 저장소에서 확인):
     - SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
     - SHA-256 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
   - 이 키는 React Native 템플릿에 들어 있는 **공개 디버그 키**라 누구나 같은 서명을 만들 수 있다. 개발용으로만 등록하고, 내부 배포·릴리스 키는 팀이 따로 만들어 그 지문을 추가로 등록한다.
   - 직접 확인하는 명령(Windows, `mobile`에서 prebuild 후):
     ```powershell
     & "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore android\app\debug.keystore -alias androiddebugkey -storepass android -keypass android
     ```
     또는 `cd android; .\gradlew signingReport`(Android SDK 설치 후).
3. **Google 로그인**: Authentication › 로그인 방법 › Google이 사용 설정인지 확인한다(웹 앱에서 이미 쓰고 있으면 켜져 있다). SHA-1을 등록한 뒤 받은 `google-services.json`에는 웹 클라이언트(`client_type: 3`)가 들어 있어야 한다. 앱은 이 값을 `webClientId`로 자동으로 읽는다. 들어 있지 않으면 Google Cloud 콘솔 › 사용자 인증 정보의 "Web client (auto created by Google Service)" 클라이언트 ID를 따로 알려 달라(공개 식별자이며 비밀값이 아니다).
4. **`google-services.json` 전달**: 프론트가 `mobile/google-services.json`에 둔다. 루트 README의 보안 원칙에 따라 커밋하지 않도록 `mobile/.gitignore`에 넣었다. 커밋 여부를 팀이 다르게 정하면 알려 달라.
5. **App Check**: App Check › Android 앱에 **Play Integrity** provider를 등록한다(SHA-256 필요). 서버 함수는 이미 `enforceAppCheck`가 켜져 있으므로 끄거나 우회하지 않는다. 웹 reCAPTCHA Enterprise 키는 네이티브에 쓰지 않는다.
   - **개발 빌드**는 debug provider를 쓴다. 각 개발자가 자기 기기의 디버그 토큰을 App Check › 앱 메뉴 › 디버그 토큰 관리에 등록해야 공개 API도 통과한다. 토큰 확인 방법은 `mobile/README.md` 실행 B-5. 토큰은 개인 값이라 공유 문서나 저장소에 적지 않는다.
   - **릴리스 빌드**의 Play Integrity 판정은 Google Play로 설치한 앱을 기준으로 하므로, Play Console 테스트 트랙 없이 직접 설치한 릴리스 APK는 App Check에 실패할 수 있다(아직 실기 확인 전).

## 2-1. 지도 키(선택, 지도 화면에 필요)

- Google Cloud 콘솔(같은 프로젝트)에서 **Maps SDK for Android** 사용 설정 → API 키 발급 → 앱 제한: Android 앱, 패키지 `com.attentionall.uirun` + 위 SHA-1.
- 키는 빌드 환경변수 `GOOGLE_MAPS_API_KEY`로 넣는다(`mobile/.env.local`에 `GOOGLE_MAPS_API_KEY=...` 후 재빌드). 없으면 앱은 지도 대신 같은 서버 데이터를 목록으로 보여준다.
- 앱에 필요한 권한: 정확한 위치(사용 중), Foreground Service(위치) — 운동 중 화면이 꺼져도 기록. 백그라운드 위치(항상 허용)는 요청하지 않는다. Play 스토어 배포 시 Foreground Service 위치 사용 신고가 필요하다.

## 2-2. 앱 권한·Play 신고 메모(2026-10-06 추가)

- 알림(`POST_NOTIFICATIONS`): 운동 중 서버가 보낸 관찰 요청을 기기 안 로컬 알림으로 보여준다. FCM·원격 푸시는 쓰지 않으므로 Cloud Messaging 콘솔 설정은 필요 없다(`expo-notifications`가 FCM 서비스 선언을 넣지만 호출하지 않는다).
- 사진 저장: 사진 기록카드를 사진 앱에 저장한다(`expo-media-library`, 쓰기만). 라이브러리가 `READ_MEDIA_VISUAL_USER_SELECTED`와 Android 12 이하 저장소 권한을 매니페스트에 넣는다. Play 사진·동영상 권한 정책 검토 때 ‘쓰기 전용’임을 적는다.
- 앨범 선택은 Android 사진 선택기(권한 없음)를 쓰고, 고른 사진은 서버에 올리지 않는다.

## 3. 등록 뒤 확인 순서(프론트)

1. `google-services.json`을 넣고 `EXPO_PUBLIC_UIRUN_TARGET=firebase`로 `npx expo prebuild --platform android --clean` → `npx expo run:android`.
2. 마이 › 개발용 연결 점검: App Check 토큰 발급 → 공개 API 점검(getHome·getMapData) → Google 로그인 → 로그인 API 점검(getMy·getSettings 추가).
3. 실패 코드는 그 화면에만 표시한다. `UNAUTHENTICATED`(App Check 미등록·토큰 거절), `GOOGLE_DEVELOPER_ERROR`(SHA·패키지 불일치), `PROJECT_MISMATCH`(다른 프로젝트의 설정 파일).

## 4. iOS(이번 완료 범위 아님) — 나중에 필요한 항목

- `bundleIdentifier`: `com.attentionall.uirun`(Android와 같은 잠정값, 확정 필요)
- Firebase iOS 앱 등록과 `GoogleService-Info.plist`
- Google 로그인 URL scheme(`REVERSED_CLIENT_ID`)
- App Check: App Attest(+DeviceCheck 대체) 등록, 개발용 디버그 토큰
- Apple Developer 팀 ID, 서명 인증서·프로비저닝, 알림을 쓸 때 APNs 키
- React Native Firebase iOS 빌드 조건(공식 문서 기준): Xcode 26.2 이상, `expo-build-properties`의 `ios.useFrameworks: "dynamic"`

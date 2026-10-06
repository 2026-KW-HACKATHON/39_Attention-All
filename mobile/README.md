# 우이런 Android 앱 (React Native)

기존 Firebase 백엔드(HTTPS Callable)를 그대로 쓰는 React Native 앱이다. 홈·지도·우리 우이천·기록·마이, 현장 사진 제보·재확인·정기 관찰, 운동 GPS 기록(화면 꺼짐 포함), 포인트·Welcome·쿠폰이 서버와 연결돼 있다. 실제 검증 범위는 [docs/mobile/STATUS.md](../docs/mobile/STATUS.md)에 따로 적는다.

- Expo SDK 57 Development Build + Expo Router, React Native 0.86, TypeScript
- `@react-native-firebase/{app,auth,functions,storage,app-check}` 26.4, Google Sign-In 16.1
- `expo-location`+`expo-task-manager`(운동 Foreground Service), `expo-image-picker`(제보는 카메라 촬영만, 기록카드는 촬영·앨범), `expo-file-system`(요청·큐·사진 보관), `react-native-maps`(키가 있을 때만)
- `expo-notifications`(운동 중 관찰 요청 로컬 알림, FCM 없음), `react-native-view-shot`+`expo-media-library`+`expo-sharing`(사진 기록카드 저장·공유)
- Expo Go로는 실행할 수 없다(개발 빌드 필요). HTML WebView 래핑이 아니다.

## 구조

```
mobile/
  app.config.ts        앱 이름·applicationId(한 곳)·플러그인. google-services.json이 있을 때만 Firebase 플러그인 적용
  metro.config.js      ../backend/client를 번들에 포함(연결 상수·연결 점검을 복사하지 않음)
  env.example          .env.local 예시(연결 대상, Emulator 주소, App Check 디버그 토큰)
  src/core.ts          Firebase·React와 무관한 규칙: 오류 정규화, 요청 ID, 조회 캐시, 표시 규칙 (+ core.test.ts)
  src/runlogic.ts      운동 큐 순수 규칙: 서버와 같은 거리 규칙, 묶음 전송, 거절 맞추기, 종료 시각 (+ runlogic.test.ts)
  src/capturelogic.ts  현장 사진 규칙: 실제 JPEG 바이트·크기, 봉인 위치 시간, 이어갈 작업 고르기 (+ flows.test.ts)
  src/run.ts           운동 기록(계정·세션별 파일, 위치 작업, 순서 전송, 서버와 맞추기)
  src/capture.ts       현장 사진 작업 단계(CAPTURED→SEAL_PENDING→SEALED→UPLOADING→READY→SUBMITTING)
  src/store.ts         JSON 파일 원자적 저장, 손상 파일 보관·알림
  src/notify.ts        운동 중 관찰 요청 OS 알림
  src/paged.ts         페이지 목록(변경 뒤 갱신·계정 전환 시 비움)
  src/firebase.ts      Firebase 초기화(App Check → Auth → Functions), Google 로그인, Callable 호출
  src/session.tsx      계정 상태, 화면별 조회 훅, 변경 요청, 계정 전환 정리
  src/theme.ts, ui.tsx 디자인 토큰(웹 프로토타입 값)과 공용 부품
  src/app/             화면(Expo Router). (tabs)/ 홈·지도·우리 우이천·기록·마이, 그 밖은 하위 화면
  assets/              글꼴(OFL), 워드마크, 사진(출처는 앱의 마이 › 정보 및 출처)
```

`android/`는 `npx expo prebuild`가 만드는 생성물이라 커밋하지 않는다. 네이티브 설정은 `app.config.ts`에서만 바꾼다.

## 연결 대상

`mobile/.env.local`의 `EXPO_PUBLIC_UIRUN_TARGET`으로 명시한다. 값이 없으면 어떤 서버도 부르지 않고 설정 안내 화면을 보여준다.

| 값 | 연결 | 로그인 | App Check | 필요한 것 |
|---|---|---|---|---|
| `emulator` | 개발 PC의 Firebase Emulator(`demo-uirun`) | 익명 테스트 계정 | 사용 안 함(서버 Emulator 함수만 강제 해제) | 백엔드 Emulator 실행 |
| `firebase` | 기존 프로젝트 `uirun-92539` | Google | 개발 빌드 debug / 릴리스 Play Integrity | `google-services.json`, Firebase 콘솔 등록 |

- 연결 상수(projectId·리전·동의 버전)는 `backend/client/mobile-config.json`을 그대로 읽는다. `google-services.json`의 프로젝트가 다르면 앱이 연결하지 않는다.
- 서비스 계정 키·관리자 인증값은 앱에 넣지 않는다. `EXPO_PUBLIC_*` 값은 앱 번들에 들어가는 공개 값이다.
- Firestore를 직접 읽거나 쓰지 않는다(서버 규칙이 모두 차단한다).

## Windows에서 설치·실행 (처음 한 번)

1. **Node.js 22 LTS 이상**을 설치한다(백엔드 Functions 런타임이 Node 22다).
2. **JDK 17**을 설치하고 `JAVA_HOME`을 그 경로로 지정한다. Expo 문서 기준 버전이다. 지금 PC의 기본 Java가 26이면 Gradle이 실행되지 않을 수 있다.
   ```powershell
   winget install Microsoft.OpenJDK.17
   ```
3. **Android Studio**를 설치(Standard)하고 SDK Manager에서 **Android SDK Platform 36**, **Android SDK Build-Tools**, **Android Emulator**, **Platform-Tools**를 설치한다. Google 로그인을 시험할 에뮬레이터는 **Google Play가 들어간 시스템 이미지**로 만든다.
4. 환경 변수: `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`, `Path`에 `%LOCALAPPDATA%\Android\Sdk\platform-tools` 추가. 새 터미널에서 `adb version`이 나오면 된다.
5. 저장소는 **짧고 영문만 있는 경로**에 둔다(예: `C:\dev\39_Attention-All`). 한글·OneDrive 경로는 Gradle 경로 길이 문제와 `node_modules` 동기화 부담이 생긴다.
6. 의존성 설치:
   ```powershell
   cd C:\dev\39_Attention-All\backend; npm ci; npm --prefix functions ci
   cd ..\mobile; npm ci
   ```

## 실행 A — 로컬 Emulator (Firebase 등록 전에도 가능)

1. 터미널 1: 백엔드 Emulator와 예시 데이터
   ```powershell
   cd C:\dev\39_Attention-All\backend
   npm run emulators
   ```
   예시 코스·시설을 넣으려면 다른 터미널에서(로컬 demo-uirun만 바꾼다):
   ```powershell
   cd C:\dev\39_Attention-All\backend
   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:GCLOUD_PROJECT="demo-uirun"
   node scripts/seed.js prototype.seed.json
   ```
2. `mobile/env.example`을 `mobile/.env.local`로 복사하고 `EXPO_PUBLIC_UIRUN_TARGET=emulator`로 둔다.
3. 터미널 2: Android 에뮬레이터를 켠 뒤
   ```powershell
   cd C:\dev\39_Attention-All\mobile
   npx expo prebuild --platform android --clean
   npx expo run:android
   ```
   첫 빌드는 오래 걸린다. 이후 JS만 바꿨다면 `npx expo start --dev-client`로 다시 연결한다.
4. 앱에서 마이 › 맨 아래 **개발용 연결 점검** → 공개 API 점검 → 로그인(로컬 테스트 계정) → 로그인 API 점검.

**실기기 + Emulator**: Android Emulator는 PC를 `10.0.2.2`로 부른다. 실기기는 PC의 LAN 주소를 `EXPO_PUBLIC_EMULATOR_HOST`에 넣고, Firebase Emulator가 그 주소에서 받도록 `backend/firebase.json`의 `emulators.auth`·`emulators.functions`에 `"host": "0.0.0.0"`을 **로컬에서만** 추가해야 한다(커밋하지 않는다). Windows 방화벽에서 9099·5001 포트 인바운드 허용이 필요하고, 같은 Wi-Fi에서만 시험한다. 개발 빌드는 HTTP(cleartext)를 허용하지만 릴리스 빌드는 허용하지 않는다.

## 실행 B — 기존 Firebase 서버

1. 백엔드 담당자에게 [HANDOFF.md](../docs/mobile/HANDOFF.md)의 값을 전달하고 Android 앱 등록, Google 로그인 설정, App Check 등록을 요청한다.
2. 받은 `google-services.json`을 `mobile/google-services.json`에 둔다(커밋하지 않는다).
3. `mobile/.env.local`:
   ```
   EXPO_PUBLIC_UIRUN_TARGET=firebase
   EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN=   # 비워 두면 4번 방법으로 확인
   ```
4. 빌드·실행:
   ```powershell
   cd C:\dev\39_Attention-All\mobile
   npx expo prebuild --platform android --clean
   npx expo run:android
   ```
5. **App Check 디버그 토큰**: 토큰을 비워 두었다면 앱 실행 후 아래 명령으로 기기가 만든 토큰을 찾아 Firebase 콘솔 › App Check › 앱 메뉴 › 디버그 토큰 관리에 등록한다. 토큰은 개인 값이라 공유·커밋하지 않는다. 앱을 지우거나 데이터를 지우면 새 토큰이 생긴다.
   ```powershell
   adb logcat -d | Select-String "DebugAppCheckProvider"
   ```
   팀에서 고정 토큰을 쓰려면 콘솔에서 토큰을 만든 뒤 `.env.local`의 `EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN`에 넣는다(개발 빌드에서만 읽는다. 릴리스 빌드에는 넣지 않는다).
6. 개발용 연결 점검에서 App Check 토큰 발급 → 공개 API 점검 → Google 로그인 → 로그인 API 점검 순으로 확인한다.

## 검사

```powershell
cd C:\dev\39_Attention-All\mobile
npm run typecheck
npm run lint
npm test
npx expo-doctor
```

## 재빌드가 필요한 경우

네이티브 설정이 바뀔 때만 다시 빌드한다: 라이브러리 추가, `app.config.ts` 수정, `google-services.json` 추가, `GOOGLE_MAPS_API_KEY` 지정. JS만 바꿨으면 Metro로 충분하다.

- **2026-10-06 변경으로 재빌드가 필요하다**: `expo-notifications`·`expo-media-library`·`expo-sharing`·`react-native-view-shot` 추가와 플러그인 설정. 이 저장소에서는 `npx expo prebuild --platform android`(`--clean` 없이) → `npx expo run:android`로 빌드했다. `npm run prebuild`는 `--clean`이 들어 있어 쓰지 않았다.
- `--clean` 없이도 Expo가 `android` 폴더를 다시 만들 수 있다(이번에 실제로 그랬다). `android`는 생성물이라 손으로 고친 내용이 없어야 하고, 디버그 서명 지문은 그대로였다(HANDOFF.md 값과 같음). 다시 만들어지면 `android/local.properties`가 없어지므로 아래처럼 `ANDROID_HOME`을 지정한다.
- JDK는 17을 쓴다. JDK 26(현재 기본 `JAVA_HOME`)·Android Studio JBR 25로는 Gradle 단계(`jlink`, CMake 경고)에서 실패했다.
- Metro 화면 갱신(HMR)이 반영되지 않거나 지연 로딩한 화면이 예전 코드로 보이면, Metro를 끄고 다른 포트(`--port 8082` 등)로 다시 시작해 앱을 그 주소로 연다.

```powershell
cd C:\dev\39_Attention-All\mobile; $env:JAVA_HOME="C:\Program Files\Java\jdk-17"; $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"; npx expo run:android
```

## Emulator 데이터 유지

`npm run emulators`는 끌 때 데이터가 사라진다. 테스트 계정·제보를 이어 쓰려면 `npm run emulators:keep`(끌 때 `backend/.emulator-data`에 저장, 다음에 불러옴). 처음 실행할 때 폴더가 없으면 한 번 `npm run emulators`로 띄웠다가 다른 터미널에서 `npx firebase emulators:export ./.emulator-data --project demo-uirun`로 만든다. seed(`scripts/seed.js`)는 경로·코스·시설·정기 관찰만 바꾸고 제보·참여·운동 기록은 건드리지 않는다.

에뮬레이터 위치를 파일럿 구간으로 옮기기(운동 시작·참여에 필요, 서버는 파일럿 경로 25m 안만 허용):

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" emu geo fix 127.049923 37.624712
```

## 화면과 서버 연결

| 화면 | 호출 | 비고 |
|---|---|---|
| 홈 | getHome, getWeather, 로그인 시 getMy | 운동 시작(코스·모드), 제보·혜택 진입. 진행 중·저장 중·결과 미확인 운동은 그 운동으로 |
| 운동 | startRun·appendTrack·pause/resume/finish/discardRun(occurredAt), recordMissionExposure, getRunDetail(복구) | 프로토타입 운동 화면. 거리는 서버와 같은 규칙으로 기기에서 계산 |
| 운동 결과·기록 상세 | getRunDetail | 경로 지도(키 없으면 경로 그림), 구간 페이스 막대, 운동 중 참여, 사진 기록카드 |
| 사진 기록카드 | getRunDetail | 기본 사진(출처 표기)·촬영·앨범, 확대·위치·글자색, 1080×1350 저장·공유. 서버에 올리지 않음 |
| 지도 | getMapData(관찰 페이지 끝까지), getPilotData | 전체·코스·관찰·시설, 지난 기록 토글, 내 위치 이동, 겹친 핀 목록. 키 없으면 그림+목록 |
| 우리 우이천 | getHome.riverSummary, getRiverFeed(current·past·news) | 소식 분류 칩 한 줄, 요약 펼침, 원문, 자료 날짜·팀 확인일 구분 |
| 기록 | getWorkoutStats, getRecords(runs·participations), getMy | 기간 합계·막대, 날짜별 참여 이력, 참여 상세 시트(내 사진·적립·철회) |
| 환경 제보·참여 | issueCaptureTicket, sealCapture, getPhotoStatus, createIssue, submitQuick, submitPhotoRecheck, addDiscoveryPhoto, submitRoutine | 사진 작업 단계 저장·복구, 미리보기·이어서 보내기·버리기 |
| 관찰·정기 관찰 상세 | getIssueDetail, getRoutineDetail, getPublicPhotoAccess | 내 제보면 재확인 대신 사진 보완 |
| 마이·포인트·혜택·쿠폰 | getMy, getSettings, updateSettings, updateProfile, getLedger, getBenefits, claimWelcome, requestCouponUse, confirmCouponUse | |
| 개발용 연결 점검 | backend/client/connection-check.js | 개발 빌드에서만 열림 |

## 운동 기록 수집·전송 기준 (src/run.ts, src/runlogic.ts)

- 수집: `expo-location` Foreground Service, 3초·5m마다, 정확도 50m 이하만(서버 거리 계산은 30m 이하만 잇는다). 가짜 위치(`mocked`)는 보내지 않고 센다.
- 묶음: 위치는 받는 즉시 계정·세션 파일(`run-<uid>-<sessionId>.json`)에 저장하고, **20점이 쌓이거나 가장 오래된 점이 20초 지나면** 한 요청으로 묶는다(요청당 최대 50점, 서버 한도 100). 일시정지·종료·로그아웃 직전에는 남은 점을 먼저 묶는다. 요청은 한 번에 하나씩 순서대로 보낸다.
- 화면 거리: 서버 `workouts.js`와 같은 규칙(같은 구간, 두 점 정확도 30m 이하, 간격 0~60초, 12m/s 이하)으로 기기에서 계산한다. 서버 저장분 + 미전송분이며, 종료 뒤에는 서버 결과를 쓴다.
- 거절: 위치 묶음이 거절되면 `getRunDetail`로 서버 상태를 보고 이미 저장된 점·일시정지 구간 점만 빼서 새 요청 ID로 다시 보낸다. 걸러도 그대로면 다시 보내지 않고 파일에 보관(`rejected`)하고 화면에 알린다.
- 종료: 누른 시각을 파일에 먼저 저장하고 화면 시간을 멈춘 뒤, 남은 위치를 보내고 `finishRun({occurredAt})`. 앱 재시작 때는 서버 세션과 맞춘다(서버에서 이미 끝났으면 수집을 멈춘다).
- 세션 한도(5,000점·6시간)에 닿으면 위치 수집을 멈추고 저장된 부분으로 마칠지 묻는다.
- 이전 버전의 `run.json`은 파일 안의 UID·세션으로 이름을 바꿔 옮긴다(지우지 않음). 손상 파일은 `.corrupt-시각`으로 보관하고 화면에 알린다.

## 현장 사진 작업 정리 기준 (src/capture.ts)

- 카메라 결과를 받으면 실제 바이트가 JPEG(앞 3바이트 FF D8 FF)이고 5MiB 이하인지 확인한 뒤 앱 폴더(`evidence/`)에 먼저 보관한다.
- 봉인 위치는 셔터 뒤 30초 안에 잰 정확한 위치만 쓰고, 위치·요청 ID를 저장한 뒤 보낸다. 응답을 잃으면 같은 ID·같은 위치로만 다시 보낸다. 서버가 위치가 오래됐다고 거절하면 나중 위치로 바꾸지 않고 다시 촬영을 안내한다.
- 지우는 경우: 접수 확인, 서버의 영구 거절(만료 티켓·처리 실패 등 재촬영 필요), 사용자가 ‘이 사진 버리기’를 눌렀을 때, 사진 없이 티켓만 남고 티켓이 만료됐을 때. 그 밖에는 앱이 다시 켜져도 미리보기와 이어서 보내기·버리기를 보여준다.
- 작업은 계정별 파일(`photos-<uid>.json`)에 시작한 계정 UID와 함께 저장한다. 계정이 바뀌면 그 작업을 보내지 않는다.

## 테스트 소식 넣기 (로컬 Emulator 전용)

```powershell
cd C:\dev\39_Attention-All\backend
node scripts/seed-test-news.cjs            # [테스트] 소식 3건(생태·개선 제안·사업 계획) 추가·게시
node scripts/seed-test-news.cjs unpublish  # 이 3건만 게시 내림(삭제하지 않음)
```

`demo-uirun`과 로컬 주소(`127.0.0.1`·`localhost`)가 아니면 실행하지 않는다. 고정 ID라 다시 실행해도 늘지 않고, 다른 소식·계정·운동·사진 데이터는 건드리지 않는다. Emulator가 다른 포트면 `FIRESTORE_EMULATOR_HOST=127.0.0.1:<포트>`.

## 사용자 Emulator와 겹치지 않게 검증하기

앱의 Emulator 포트는 `EXPO_PUBLIC_EMULATOR_PORTS`(auth,functions,storage, 기본 `9099,5001,9199`)로 바꿀 수 있다. 2026-10-06 검증은 별도 폴더의 firebase.json(19099·15001·18080·19199, 데이터 저장 없음)으로 격리 Emulator를 띄우고 `EXPO_PUBLIC_EMULATOR_PORTS=19099,15001,19199`로 Metro를 시작해서 했다. `.env.local`과 `backend/.emulator-data`는 바꾸지 않았다.

## 요청·오류·계정 규칙 (src/core.ts, src/session.tsx)

- 변경 API의 `clientRequestId`는 작업마다 한 번 만든다. 결과가 모호한 실패(네트워크·unavailable·deadline-exceeded·internal)면 같은 ID·같은 내용으로 다시 보낸다. 내용이 바뀌면 새 ID다. 서버가 `{ok:false}`로 답했거나 성공했으면 확정 응답이다.
- 변경이 성공한 뒤 조회 갱신이 실패해도 변경을 다시 보내지 않는다. 조회만 다시 시도한다.
- SDK가 던진 오류와 정상 응답 안의 `{ok:false,errorCode}`를 모두 실패로 처리한다. `ok:true`는 포인트 지급을 뜻하지 않는다.
- 같은 조회가 진행 중이면 합치고, 새로 고친 뒤 늦게 도착한 이전 응답은 버린다.
- 로그아웃·계정 전환 시 개인 조회 캐시, 진행 중 조회의 화면 반영, 미확정 요청 ID를 버리고 개인 하위 화면(프로필·포인트 내역·동의)을 닫는다. 다음 로그인에서 다른 Google 계정을 고를 수 있게 Google 세션도 끊는다.
- 이름은 로그인 때 Google 이름으로 채우거나 덮어쓰지 않는다. 프로필 수정 화면에서만 바뀐다.
- 알림 선호 저장은 OS 알림 권한 요청이 아니다. OS 알림 권한은 운동을 시작할 때 묻고, 거절해도 운동·앱 안 안내는 그대로다.
- 페이지 목록은 변경 성공 뒤 `refresh(이름)`로 첫 페이지부터 다시 받고, 계정이 바뀌면 바로 비운다. 당겨서 새로 고침은 조회만 다시 한다.

### Mac 네이티브 빌드 경로 (2026-10-06)

한글 경로의 Reanimated/Worklets 네이티브 참조 오류를 피하려면 실제 영문 경로에 체크아웃한다. 이 Mac에서는 같은 커밋의 `/Users/taemin/Developer/uirun-android-build/mobile`에서 ARM64 debug APK 빌드가 성공했다. Firebase 로컬 설정 파일도 이 체크아웃에 구성되어 있다. `npm run android`로 실행하며 Metro가 필요하다. 실제 기기 연결 점검 범위는 [연결 상태](../docs/mobile/CONNECTION-STATUS.md)를 참고한다.

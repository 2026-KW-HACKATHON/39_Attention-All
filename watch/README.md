# 우이런 워치 앱 (Wear OS)

휴대폰 우이런 앱이 필요한 동반 앱이다. 폰이 GPS·거리·서버 저장을 맡고, 워치는 같은 운동(sessionId)의 상태·수치를 보여주고 시작·일시정지·재개·종료·체크포인트 응답·폰 촬영 연결을 요청한다. 화면 기준은 [FLOW 03](../docs/wear/uirun_watch_flow_v03.html), 연결 계약은 [PROTOCOL.md](../docs/wear/PROTOCOL.md), 팀 인계는 [HANDOFF.md](../docs/wear/HANDOFF.md).

워치 단독 GPS·운동 저장, 삼성 헬스·Health Connect·심박은 없다. 워치는 Firebase에 접속하지 않는다.

## 지원 대상

| 항목 | 값 |
|---|---|
| 기기 | Wear OS 3 이상(API 30+): 갤럭시워치4 이후(One UI Watch), Pixel Watch 등. **Tizen 기반 갤럭시워치(워치3·액티브2 이하)는 지원하지 않는다** |
| 앱 minSdk / targetSdk / compileSdk | 30 / 36 / 36 |
| 의존성 minSdk | wear compose material3·foundation 1.5.6: 25, wear-remote-interactions 1.1.0: 23, play-services-wearable 19.0.0: 21 → 앱 minSdk 30이 결정한다 |
| applicationId | `com.attentionall.uirun`(폰과 같음 — Data Layer 조건). Kotlin 패키지는 `com.attentionall.uirun.watch` |
| 폰 앱 | 같은 저장소 `mobile/`을 워치 연결 포함으로 **네이티브 재빌드한 개발 빌드**(아래 "폰 재빌드") |

## 버전(고정)

| 도구 | 버전 |
|---|---|
| JDK | 17 (`C:\Program Files\Java\jdk-17`). 기본 JDK 26으로는 폰 빌드가 실패했던 PC다 |
| Gradle | 9.3.1 (wrapper 포함, 폰 `mobile/android`와 같음) |
| Android Gradle Plugin | 8.12.0 (폰 RN 0.86 툴체인과 같음) |
| Kotlin / Compose 컴파일러 플러그인 | 2.1.20 |
| Android SDK | Platform 36, Build-Tools 36.0.0 |
| androidx.wear.compose (material3·foundation) | 1.5.6 |
| activity-compose / lifecycle | 1.10.1 / 2.9.4 |
| play-services-wearable | 19.0.0 (폰 브리지 모듈과 같음) |
| wear-remote-interactions | 1.1.0 (RemoteActivityHelper) |

## Android Studio에서 열기

`File › Open`에서 **저장소의 `watch` 폴더**를 연다(저장소 루트나 `mobile/android`가 아님). `Settings › Build, Execution, Deployment › Build Tools › Gradle › Gradle JDK`를 JDK 17로 둔다. 실행 구성 `app`을 Wear 에뮬레이터·워치로 실행한다.

## 서명(중요)

Data Layer는 폰·워치 **applicationId와 서명 인증서가 같아야** 연결된다. 워치 debug 빌드는 사용자 기본 `~/.android/debug.keystore`가 아니라 **폰 개발 빌드가 실제로 쓰는 키** `mobile/android/app/debug.keystore`(Expo prebuild가 템플릿에서 만든 파일)로 서명한다(`app/build.gradle.kts`). 이 PC에서는 `~/.android/debug.keystore`가 없었고, 있다 해도 폰 키와 다를 수 있다.

- 그 파일이 없으면 먼저 `mobile`에서 `npx expo prebuild --platform android`(또는 `npm run android`)를 실행한다. 다른 위치의 폰 키를 쓰려면 `-PuirunDebugKeystore=<경로>`(스크립트는 `-PhoneKeystore`).
- 확인한 지문(2026-10-07, 이 PC): SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, SHA-256 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. 팀원 PC에서는 반드시 아래 명령으로 다시 대조한다(같은 PC라도 가정하지 않는다).
- 폰 Firebase·Google 로그인·지도에 등록된 폰 서명은 바꾸지 않는다. release 키를 복사·커밋하거나 새로 만들지 않는다. 릴리스 빌드는 서명하지 않은 APK(`app-release-unsigned.apk`)만 만든다 — 배포 시 폰 앱과 같은 release 키로 팀이 서명한다.

```powershell
cd C:\dev\39_Attention-All\watch
.\scripts\verify-signing.ps1 -PhoneApk ..\mobile\android\app\build\outputs\apk\debug\app-debug.apk
.\scripts\verify-signing.ps1 -PhoneSerial <폰 serial>   # 폰에 설치된 APK를 받아 비교
```

`OK: applicationId와 서명 인증서가 같습니다.`가 나와야 한다. 직접 볼 때:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs app\build\outputs\apk\debug\app-debug.apk
& "C:\Program Files\Java\jdk-17\bin\keytool.exe" -list -v -keystore ..\mobile\android\app\debug.keystore -alias androiddebugkey -storepass android
```

## 빌드

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
cd C:\dev\39_Attention-All\watch
.\scripts\build-debug.ps1
```

같은 일을 Gradle로 직접: `.\gradlew.bat :app:assembleDebug`(SDK 경로는 `ANDROID_HOME` 또는 `watch/local.properties`의 `sdk.dir`).

| 산출물 | 경로 |
|---|---|
| debug APK(폰 debug 키 서명) | `watch/app/build/outputs/apk/debug/app-debug.apk` |
| release APK(서명 안 함, DEMO 코드 없음) | `watch/app/build/outputs/apk/release/app-release-unsigned.apk` (`.\gradlew.bat :app:assembleRelease`) |

단위 테스트(가짜 전송으로 상태 규칙 검증, 실제 연결 확인과 별개): `.\gradlew.bat :app:testDebugUnitTest`

## 설치

여러 기기가 연결돼 있어도 **지정한 워치 한 대에만** 설치한다. 대상이 Wear OS가 아니면 멈춘다.

```powershell
adb devices
.\scripts\install-debug.ps1 -Serial <워치 serial>
.\scripts\install-debug.ps1 -Serial <워치 serial> -Demo run   # 개발 빌드 DEMO 화면(폰 없이)
```

폰에는 워치 연결을 포함해 다시 빌드한 우이런 개발 빌드가 설치돼 있어야 한다(같은 서명). 한쪽만 다른 키로 설치돼 있으면 연결되지 않는다 — 다른 키의 앱이 이미 있으면 그 기기에서 우이런을 지우고 다시 설치한다(지우면 그 기기의 로컬 데이터도 지워진다).

### 폰 재빌드

워치 브리지는 네이티브 모듈(`mobile/modules/uirun-wear-bridge`)과 `expo-camera`를 추가했으므로 **폰 앱 네이티브 재빌드가 필요하다**(Metro 새로 고침만으로는 안 됨).

```powershell
cd C:\dev\39_Attention-All\mobile
npm ci
$env:JAVA_HOME="C:\Program Files\Java\jdk-17"; $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
npx expo prebuild --platform android
npx expo run:android --device
```

재빌드 전 개발 빌드에서는 워치 연결만 꺼지고 앱은 그대로 동작한다(네이티브 모듈이 없으면 브리지가 아무것도 하지 않는다).

## DEMO(개발 빌드 전용)

`--es demo <시나리오>`로 실행하면 가짜 폰 데이터로 화면을 확인한다. 화면 맨 위에 **DEMO**가 보이고 모든 수치·보상은 예시다. release 빌드에는 이 코드가 없다(`src/debug`).

```powershell
adb -s <serial> shell am start -n com.attentionall.uirun/com.attentionall.uirun.watch.MainActivity --es demo alert
```

시나리오: `ready` `login` `choose` `run` `walk` `alert` `photo` `unsupported` `handoff` `verify` `result` `paused` `confirm` `saving` `summary` `phoneResult` `disconnect` `phoneHelp` `saveError`. 화면 캡처(작은 원형 192dp·큰 원형 227dp, 글자 1.3배)는 저장소에 넣지 않았다 — 위 DEMO 시나리오로 다시 찍을 수 있다.

## 에뮬레이터 페어링

공식 안내: https://developer.android.com/training/wearables/get-started/connect-phone

1. SDK Manager에서 Wear OS 시스템 이미지(예: `system-images;android-34;android-wear;x86_64`, Wear OS 5)를 받고 Wear AVD(Small/Large Round)를 만든다. 이 PC에는 `Uirun_Wear_Small`, `Uirun_Wear_Large`를 만들어 두었다.
2. 폰 AVD는 **Google Play가 있는 이미지**(예: `Pixel_8`)로 띄우고 Play 스토어에서 Wear OS 앱(Pixel Watch 앱 등)을 설치한다(Google 계정 로그인 필요 — 사용자가 직접).
3. Android Studio `Device Manager › 폰 AVD ⋮ › Pair Wearable`(또는 Wear OS 에뮬레이터 페어링 도우미)로 두 에뮬레이터를 짝짓는다.
4. 폰 AVD에 우이런 개발 빌드, Wear AVD에 워치 debug APK를 설치하고(같은 키) 폰에서 로그인한 뒤 워치 앱을 연다. W0이 "운동 준비 완료"가 되면 Data Layer가 연결된 것이다.

### 연결이 안 될 때

워치가 "폰에 우이런이 필요해요"·"폰 연결 안 됨"에 머물면 아래로 페어링 문제와 앱 문제를 가른다(앱 데이터는 지우지 않는다). 패키지·서명, GMS 노드·우이런 capability 항목, 워치 앱을 다시 열었을 때의 `UirunDiag` 로그(capability 조회, 직접 ping, 폰 ACK)를 모아 판정을 출력한다.

```powershell
.\scripts\diagnose-datalayer.ps1 -PhoneSerial <폰 serial> -WatchSerial <워치 serial>
adb -s <워치 serial> logcat -s UirunDiag     # 실시간으로 볼 때(폰도 같은 태그)
```

## 실제 워치 무선 디버깅

공식 안내: https://developer.android.com/training/wearables/get-started/debug-wifi · 삼성: https://developer.samsung.com/health/sensor/guide/connect-watch.html

1. 워치 `설정 › 시계 정보 › 소프트웨어 정보 › 소프트웨어 버전`을 여러 번 눌러 개발자 옵션을 켠다.
2. `설정 › 개발자 옵션 › ADB 디버깅`과 `무선 디버깅`을 켠다. PC와 같은 Wi-Fi에 연결한다.
3. `무선 디버깅 › 새 기기 페어링`에 나온 주소·코드로 페어링하고, 무선 디버깅 화면의 주소로 연결한다.
   ```powershell
   adb pair <워치IP>:<페어링 포트>    # 화면의 6자리 코드 입력
   adb connect <워치IP>:<포트>
   adb devices                         # 워치 serial 확인(IP:포트)
   ```
4. `.\scripts\install-debug.ps1 -Serial <IP:포트>`. 폰은 Galaxy Wearable 앱으로 이미 짝지어져 있어야 한다.

## 구조

```
watch/
  app/build.gradle.kts            버전·서명(폰 debug 키)·브랜드 자산 가져오기(mobile/assets → build/generated/brand)
  app/src/main/…/Protocol.kt      계약 v1 파싱·명령 만들기
  app/src/main/…/PhoneLink.kt     Data Layer 연결(capability·스냅샷·명령·ACK·RemoteActivityHelper)
  app/src/main/…/WatchController.kt  화면 상태(스냅샷 + 사용자 경로), 명령 재시도, W3 15초, 보간
  app/src/main/…/AlertBook.kt     같은 체크포인트 한 번만(화면·알림)
  app/src/main/…/PhoneDataService.kt 앱 화면이 없을 때 새 체크포인트 알림 + ALERT_SHOWN
  app/src/main/…/ui/              Theme(브랜드 색·글꼴)·Screens(W0~W7-B, E1~E3, P1)
  app/src/debug/…/DemoLink.kt     DEMO 데이터(개발 빌드만)
  app/src/test/…                  WatchControllerTest(가짜 전송)
  scripts/                        build-debug.ps1 · install-debug.ps1 · verify-signing.ps1
```

글꼴은 폰 자산을 그대로 쓴다: 한글 IBM Plex Sans KR(SemiBold·Bold), 숫자 Archivo(ArchivoNum-ExtraBold). 위치·GPS 권한과 상시 wake lock은 쓰지 않는다(알림 권한·진동만).

# Android Firebase 연결 상태

2026-10-06, PR #1 수정 및 연결 점검.

## 수정

- 서버의 일시정지·재개·종료·폐기 시각은 GPS와 같은 2초 시계 오차를 허용한다. 저장된 위치와 조작의 순서는 유지하고, 시각을 생략해도 활동 시간이 음수가 되지 않는다.
- 네이티브 GPS 시작·중지는 순서대로 실행한다. 일시정지의 중지가 끝나기 전에 재개해도 위치 수집이 다시 켜진다. 재개 대기 중 종료한 경우 최종 수집은 꺼진다.
- 모바일 테스트·타입 검사·린트를 PR에서 실행하는 GitHub Actions를 추가했다.

## 실제 프로젝트 설정

| 항목 | 상태 |
|---|---|
| Firebase 프로젝트 / 리전 | `uirun-92539` / `asia-northeast3` |
| Android 패키지 | `com.attentionall.uirun` |
| Firebase Android appId | `1:722420678096:android:c39b9919465e983baa0dd5` |
| 개발용 서명 SHA-1 / SHA-256 | 실제 생성된 debug.keystore와 대조 후 등록 완료 |
| Google 로그인 | 활성화 확인. 설정 파일의 Android·웹 OAuth 클라이언트 존재 확인 |
| App Check | Play Integrity 설정 등록. 이 Mac 개발 빌드용 debug 토큰 등록 |
| 지도 | Maps SDK for Android 활성화. 별도 개발 키를 패키지·SHA-1·지도 SDK로 제한 |
| 로컬 파일 | `mobile/google-services.json`, `mobile/.env.local`에 구성. 둘 다 Git 제외 |

각 팀원은 Firebase에서 설정 파일을 내려받고 자기 기기의 App Check debug 토큰을 등록한다. 이 Mac의 `.env.local`을 공유하거나 저장소에 올리지 않는다. 릴리스·Play 서명은 별도 등록이 필요하다.

공식 설정 참고: [Play Integrity](https://firebase.google.com/docs/app-check/android/play-integrity-provider), [API 키 제한](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys).

## 검증 범위

- 백엔드 단위 테스트: 144 통과.
- 모바일 단위 테스트: 25 통과. 실제 `run.ts`를 실행한 GPS 중지·재개 경합 테스트 포함.
- 모바일 타입 검사·린트: 통과.
- 격리 포트의 Firebase Emulator 통합 테스트: 규칙 12개·API 시나리오 84개·정리 작업 모두 통과. 기존 에뮬레이터는 유지했다.
- 실제 Firebase 설정으로 Android prebuild 및 Metro/Hermes 번들 생성: 성공.
- 실제 Android App Check debug 토큰 교환: 성공.
- 실제 서버 `getHome`, `getMapData`, `getPilotData`: App Check 토큰을 첨부한 조회 성공(HTTP 200).
- 실제 서버 `getMy`: 로그인 토큰이 없을 때 HTTP 401 `UNAUTHENTICATED` 확인.

위 서버 조회는 REST 연결 점검이며 네이티브 앱 실행을 대신하지 않는다. 실제 Google 계정 로그인, 네이티브 Storage 업로드, 지도 표시, 실기기 운동 기록과 릴리스 Play Integrity는 아직 미검증이다. 연결된 Android 기기가 없어 계정 선택·권한 허용 단계는 사용자 확인이 필요하다.

## 기기 확인 순서

1. USB 디버깅이 켜진 Android 기기를 연결하고 `adb devices`에서 승인된 기기를 확인한다.
2. `mobile`에서 `.env.local` 대상이 `firebase`인지 확인한다. 설정 파일 변경 후에는 `npm run prebuild`를 실행한다.
3. `npm run android`로 설치·실행한다(Expo 개발 빌드이므로 Metro 서버가 필요하다).
4. 마이 → 개발용 연결 점검에서 App Check → 공개 API → Google 로그인 → 로그인 API 순으로 검사한다.
5. 우이천 파일럿 구간에서 위치 권한·정확한 위치를 허용하고 사진 제보·짧은 운동 저장·빠른 일시정지/재개를 확인한다.
6. 운영 서버에 최신 함수가 배포됐는지 확인한 뒤 오프라인 운동 종료도 확인한다. 로컬 테스트 통과와 운영 배포 완료는 별개다.

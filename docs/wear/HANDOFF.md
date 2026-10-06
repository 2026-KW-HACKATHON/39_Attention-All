# 우이런 워치 연동 — 팀 인계

작성 2026-10-07. 기준: `feat/mobile-foundation` `5e0d83d`(= 원격 `main` `a8f2dfe`의 파일 내용)에서 만든 작업 브랜치 **`feat/wear-companion`**. 2026-10-07 WIP 커밋으로 원격 `origin/feat/wear-companion`에 보존했다(main 미변경, PR·merge 없음). 기존 브랜치를 reset·rebase·merge하지 않았다. 로컬 전용 문서(이전 인수인계 메모, 작업 지시서 원본)와 화면 캡처는 커밋하지 않았다 — §10.

관련 문서: [PROTOCOL.md](PROTOCOL.md)(연결 계약), [watch/README.md](../../watch/README.md)(빌드·설치·서명·페어링), 화면 기준 [uirun_watch_flow_v03.html](uirun_watch_flow_v03.html). 노트북에서 이어서 하기: §10.

## 1. 바뀐 파일

### 새 파일(팀원 작업과 겹치지 않음)

| 경로 | 내용 |
|---|---|
| `watch/` | Wear OS 앱(Kotlin + Compose for Wear OS, 독립 Gradle 프로젝트, wrapper·스크립트·README 포함) |
| `mobile/modules/uirun-wear-bridge/` | 로컬 Expo 모듈(Android): `WearableListenerService`, Data Layer 쓰기·ACK, capability 리소스, 계정 세대, 보관 요청, ALERT_SHOWN 대기. 서비스·intent filter·리소스·의존성이 모듈 안에 있어 `expo prebuild`(--clean 포함)로 `android/`를 다시 만들어도 유지된다. `android/`는 손으로 고치지 않았다 |
| `mobile/src/wear.ts` | 폰 JS 브리지: 명령 처리(같은 엔진 함수), 스냅샷, 알림 경로, 촬영 연결 보관, 계정 전환 |
| `mobile/src/wearlogic.ts` (+ `.test.ts`) | 순수 규칙: 명령 검증·중복 결과·스냅샷·전송 간격·응답 지원 여부·촬영 연결 유효성 |
| `mobile/src/app/wear-capture.tsx` | 워치 요청용 **앱 안 카메라** 화면(expo-camera) + 기존 사진 파이프라인 제출 |
| `docs/wear/` | 계약(PROTOCOL)·인계(HANDOFF) 문서, 화면 기준 FLOW 03 사본. 화면 캡처(`screens/`)는 로컬 전용 |

### 기존 파일 최소 수정(팀원과 겹칠 수 있는 곳)

| 파일 | 수정 | 이유 |
|---|---|---|
| `mobile/src/run.ts` | ① `startRun`을 single-flight로 감쌈(본문은 `startRunNow`로 이름만 바꿈) ② `wearHooks.claimAlert` 추가, 노출 진동 전에 확인 | ① 폰 화면·워치 동시 시작에도 시작 처리 하나·운동 한 건 ② 워치가 알렸으면 폰 진동 생략 |
| `mobile/src/notify.ts` | `show()`에서 OS 알림 전에 `wearHooks.claimAlert` 확인(1줄 + import) | 폰·워치 알림 중복 방지, 워치 실패 시 폰으로 대체 |
| `mobile/src/capture.ts` | `capture()`에 선택 인자 `shoot`(기본값 = 기존 `launchCameraAsync`) | 같은 티켓·보관·봉인 로직을 앱 안 카메라에서도 재사용. 기존 제보 화면 동작은 그대로 |
| `mobile/src/app/report.tsx` | `LOCATION_TEXT`를 `export` | 촬영 화면에서 같은 오류 문구 재사용 |
| `mobile/src/app/_layout.tsx` | `import { wearForeground } from '../wear'` + `<WearRouter />` | 브리지 초기화, 계정 확인 뒤 보관 요청·시작 확인·촬영 이어가기 |
| `mobile/app.config.ts` | `expo-camera` 플러그인(카메라만, 녹음·바코드 끔) | 앱 안 카메라 권한 문구 |
| `mobile/package.json`, `package-lock.json` | `expo-camera ~57.0.6`(`npx expo install`, lock은 추가만), `npm test`에 `src/wearlogic.test.ts` | |

## 2. 통합 지점(팀원이 바꿀 때 함께 볼 것)

- 운동 엔진의 상태·필드(`Run.status/localM/offline/ops/problem/result/exposure/last/endAt`)를 바꾸면 `wear.ts` `snapshot()`과 `wearlogic.buildSnapshot`.
- `startRun` 시그니처·반환, `quickFromExposure`, `capture()`·`upload()`·`markSubmitting()`·`finishJob()`·`needsRetake()`·`pendingJob()`를 바꾸면 `wear.ts`·`wear-capture.tsx`.
- 로그인·계정 전환은 `session.onAccountChange`와 `firebase.watchUser`로 듣는다. 계정 파일 이름 규칙에 `wear-<uid>.json`이 추가됐다.
- 알림 채널: 폰 JS 알림 `wear`(워치 요청), 네이티브 `wear-request`(JS 없을 때). 알림 응답 처리는 기존 `handleResponse`가 무시한다(관찰 알림이 아님) — 누르면 앱이 열리고 `wearForeground()`가 이어간다.
- 딥링크 경로 `uirun://wear-capture?req=…`, 기존 `uirun://record/<id>`를 워치가 연다.

## 3. 쓰는 기존 서버 API(변경 없음)

`startRun`, `pauseRun`, `resumeRun`, `finishRun`(+ `appendTrack`·`discardRun`은 기존 엔진 큐 그대로), `recordMissionExposure`(엔진), `submitQuick`, `issueCaptureTicket`, `sealCapture`, `getPhotoStatus`, `submitPhotoRecheck`, `submitRoutine`, `getRunDetail`(종료 후 `participationStats.total`, `limit:1`), `getIssueDetail`(체크포인트 이름·기준점), `getMapData`(정기 관찰 이름), `getSettings`(동의 필요 여부), `getMy`(엔진 복구). 모든 변경 요청은 기존 `clientRequestId` 규칙(`mutate` 슬롯·운동 큐 op id)을 그대로 쓴다. backend·Firebase 콘솔은 바꾸지 않았다.

## 4. 서버에 없는 것 — 최소 추가 계약 제안

### 4.1 상태 응답 3종(ABSENT·UNKNOWN)

지금 `submitQuick`은 ‘지금도 보여요’만 받는다(`policy.cjs submitQuick`: 응답 종류 필드 없음, 저장하면 `lastSignalAt`·`signalCount`·`todaySignalAccountCount` 증가). 워치·폰은 세 응답 UI와 어댑터를 갖췄지만 실제 연결에서는 ABSENT·UNKNOWN을 **제출하지 않고** "아직 받지 않는 응답"으로 안내한다(`wearlogic.quickPlan`).

제안(팀 합의 필요):
- `submitQuick` 입력에 `answer: 'PRESENT' | 'ABSENT' | 'UNKNOWN'`(생략 = PRESENT, 기존 앱 호환).
- 저장: 같은 Observation(role RECHECK, modality QUICK)에 `answer` 기록. **ABSENT는 해결·안전 확인·Issue 종료가 아니다** — `lifecycleStatus`를 바꾸지 않는다. ABSENT·UNKNOWN은 `lastSignalAt`·`signalCount`·`todaySignalAccountCount`(‘지금도 보임’ 신호)에 넣지 않고 별도 집계(예: `absentCount`, `lastAbsentAt`)로 둔다. 사진 신선도·PEER·Welcome·사진 Mission은 기존처럼 바꾸지 않는다.
- 멱등성: 지금처럼 `uid|issueId|KST일` 마커로 하루 한 번(같은 날 다른 응답은 `ALREADY_TODAY` + 기존 결과). `clientRequestId` 같은 ID·다른 내용은 `REQUEST_CONFLICT`.
- 보상: ABSENT·UNKNOWN은 0P(새 `rewardReason` 예: `ANSWER_NOT_REWARDED`)부터 시작하고 정책이 정해지면 바꾼다. PRESENT의 1P 규칙은 그대로.
- 응답: 기존 형태 + `answer`. 클라이언트는 서버 값만 표시한다.
- 사진: ABSENT 사진(없어진 모습)을 받으려면 `submitPhotoRecheck`에도 `answer`가 필요하다. 그 전까지 워치는 PRESENT(·정기 관찰)일 때만 사진으로 잇는다.

### 4.2 그 밖에(필수 아님)

- 워치는 서버를 직접 부르지 않으므로 워치용 App Check·Firebase 등록은 필요 없다.
- `getRunDetail` 참여 수만 필요하므로 가벼운 요약 API가 있으면 좋다(지금은 `limit:1`로 track을 함께 받는다).

## 5. 알려진 제한

- **폰이 잠겨 있거나 우이런이 뒤에 있을 때 워치의 시작·재개는 바로 실행하지 않는다.** Android 12+는 백그라운드에서 위치 Foreground Service 시작을 막는다(엔진은 일시정지 때 위치 서비스를 내린다). 폰 알림 → 우이런 열기 → 확인 후 실행. 일시정지·종료·응답·촬영 요청 접수는 잠금 중에도 처리한다. 잠금 중 재개가 필요하면 엔진이 일시정지 중에도 위치 서비스를 유지하는 방식(배터리 영향 검토)을 팀이 정해야 한다.
- 폰 우이런이 강제 종료되면 기존과 같이 위치 기록이 멈춘다. 워치는 "폰 기록 상태를 확인할 수 없어요"로 표시하고 운동을 다시 시작하지 않는다.
- QUICK 결과가 모호한 실패(네트워크)면 워치는 실패로 안내한다. 폰 알림 카드에서 다시 보낼 수 있고 서버의 같은 날 마커가 중복 저장을 막는다(재시도 시 위치가 새로 측정되므로 같은 clientRequestId가 아닐 수 있다 — 서버 `LOCATION_STALE` 10초 규칙 때문).
- 워치의 W7-B 닫힘("처음으로")은 워치 메모리에만 남는다. 워치 앱을 다시 켜면 마지막 요약을 다시 보여준다(다음 운동이 시작되면 사라짐).
- 운동 중 Ongoing Activity(워치 화면 꺼짐 중 상시 표시)는 넣지 않았다.

## 6. 검증 결과

| 영역 | 상태 | 근거 |
|---|---|---|
| UI 구현(W0~W7-B, E1~E3, P1, W6 종료 확인) | **완료(에뮬레이터)** | Wear OS 5 에뮬레이터 작은 원형(192dp)·큰 원형(227dp), 글자 1.3배에서 DEMO 데이터로 전 화면 기록(캡처는 데스크톱 로컬 `docs/wear/screens/`, 커밋 안 함). 글자 잘림 대신 줄바꿈·스크롤 확인 |
| W3 10초 | **완료(에뮬레이터·단위)** | 실제 화면: W3 표시 → W2 복귀 10.000초(logcat). 단위: 9,999ms 유지·10,000ms 복귀·갱신으로 연장 안 됨·화면 떠나면 취소·응답 시 취소·시간 초과에 제출 없음·노출 만료 시 제출 막음 |
| 길게 눌러 종료 | **완료(에뮬레이터)** | 1.15초 떼면 취소, 1.6초 유지 → 종료 요청(시스템 애니메이션 꺼짐에서도 같음), 짧은 탭 → 종료 확인 화면 |
| 워치 상태 규칙 | **완료(단위 18개, 가짜 전송)** | 오래된 revision·epoch 무시, 계정 전환 시 비움, 시작 1요청·ACK만으로 W2 안 감, 같은 ID 재전송·포기, 끊김 시 E1·조작 안 보냄·복구 후 재실행 없음, 폰 무응답 E1, 일시정지 중 시간 안 늚, 종료 동결·E3·W7-B·P1, 촬영 같은 요청 ID·단계, 취소, 늦은 결과 한 번 |
| 폰 연결 규칙 | **완료(단위 10개)** | 명령 검증 순서, 깨진 명령, ABSENT·UNKNOWN 미제출, 중복 결과, 스냅샷(페이스·체크포인트·결과·로그아웃), 전송 간격, 보상 구분, 촬영 연결 유효성. 기존 25개 포함 `npm test` 35개 통과, `typecheck`·`lint` 통과 |
| 폰 네이티브 브리지 | **빌드 완료** | `expo prebuild` 후 `assembleDebug`(x86_64) 성공, 모듈 자동 연결. APK 매니페스트에 `WearListenerService`(MESSAGE_RECEIVED `/uirun/v1/command`), 리소스에 `uirun_phone_bridge` capability. CAMERA 권한, RECORD_AUDIO 없음 |
| 같은 서명 | **완료(이 PC)** | 폰 debug APK·워치 debug APK: 패키지 `com.attentionall.uirun`, 인증서 SHA-256 `fac61745…033b9c` 일치(`verify-signing.ps1`). prebuild로 다시 만든 폰 키 지문도 같음 |
| release에 DEMO 없음 | **완료** | release dex에 `DemoLink` 0건 |
| 폰↔워치 실제 Data Layer 왕복 | **미검증(외부 의존)** | 폰 에뮬레이터 페어링에 Play 스토어 Wear OS 앱·Google 계정 로그인이 필요해 진행하지 않음. 실기기 필요 |
| 운동 동기화(시작·일시정지·재개·종료 한 건) | **코드 완료, 실연결 미검증** | 같은 엔진 함수 + single-flight + 중복 결과. 실서버·실기기 필요 |
| QUICK | **PRESENT 코드 완료·미검증, ABSENT/UNKNOWN 외부 의존(서버 계약)** | |
| 앱 안 카메라 | **코드·빌드 완료, 실행 미검증** | expo-camera 미리보기·셔터 → 기존 파이프라인. 실제 카메라·서버 제출은 기기에서 확인 필요 |
| 실기기 | **미검증** | 연결된 폰·워치 없음 |

## 7. 실기기에서 확인할 것

준비: 팀원 PC에서 `mobile` 네이티브 재빌드·설치, 워치 debug 설치, `verify-signing.ps1 -PhoneSerial`로 서명 확인, 폰 로그인·동의·정확한 위치 허용, 우이천 파일럿 구간.

- [ ] 워치 W0 "운동 준비 완료"(폰 연결됨 · 위치 권한 확인됨). 폰 로그아웃 → 워치 "로그인이 필요해요"
- [ ] 폰에서 시작 → 워치 W2 같은 거리·시간(폰과 1~2초 차이 이내, 실제 지연 측정해 기록)
- [ ] 워치에서 시작(폰 화면 켜짐) → 폰 운동 화면 열림, 같은 sessionId, 기록 목록 한 건
- [ ] 폰·워치 거의 동시에 시작 → 운동 한 건
- [ ] 워치·폰 각각 일시정지·재개 → 양쪽 반영, 일시정지 중 시간 안 늚
- [ ] **폰 잠금 상태**: 기록 계속(기존), 워치 일시정지·종료 동작, 워치 재개·시작은 "폰에서 우이런을 열어…" + 폰 알림 → 열면 확인 창
- [ ] 폰 앱 강제 종료 상태에서 워치 시작 → 가짜 시작 없음, 폰 알림 → 열면 확인 후 시작
- [ ] 체크포인트(서버 노출) → 워치 W3·진동, 폰 진동·알림은 생략. 워치 알림 권한 끄면 폰이 알림
- [ ] W3 9초까지 유지, 10초 복귀, 그동안 응답 저장 없음(기록 탭 참여 이력 확인)
- [ ] ‘아직 있어요’ → W4-B → ‘사진 없이 계속하기’ → W5-B 서버 결과(포인트는 서버 값), 같은 날 재응답은 "이미 남긴 응답"
- [ ] ‘안 보여요’·‘모르겠어요’ → 서버 저장 없음, "아직 받지 않는 응답"
- [ ] ‘우이런에서 촬영’ → 폰 **우이런 앱 안 카메라**(시스템 카메라 앱으로 바뀌지 않음) → 제출 → 워치 W5-A → W5-B. 폰 잠금·권한 거절·촬영 취소·노출 만료 각각 워치 안내
- [ ] 워치 블루투스 끊기 → E1 "폰 기록 상태를 확인할 수 없어요"·마지막 수신, 다시 연결 → 최신 상태, 자동 재실행 없음
- [ ] 폰 비행기 모드에서 워치 종료 → W7-A 시간 동결 → E3 → 연결 후 같은 운동 한 건 저장 → W7-B → ‘폰에서 결과 보기’로 그 기록 상세
- [ ] 워치 재시작·폰 계정 전환 뒤 이전 계정 수치·요약이 워치에 보이지 않음
- [ ] 실제 워치 원형 화면·큰 글자에서 버튼 잘림 없음, 회전 입력 스크롤

## 8. 2026-10-07 연결 진단: 워치가 "폰에 우이런이 필요해요"에 멈춘 원인

환경: 폰 에뮬레이터 `emulator-5556`(Pixel_8, API 36, 노드 `5d4e4355`) ↔ Wear OS 5 에뮬레이터 `emulator-5554`(Uirun_Wear_Small, API 34, 노드 `823a06c`), 양쪽 `com.attentionall.uirun`, 서명 SHA-1 `5e8f…f625`.

| 확인 | 결과(로그·GMS dump) |
|---|---|
| 페어링·연결 | 양쪽 GMS `Reachable Nodes`에 상대(nearby=true), DataItem `initialSyncFinished=true`. 앱 `connectedNodes`도 상대 노드 1개 |
| capability 이름 | 폰 `uirun_phone_bridge`(정적 리소스) = 워치 조회 `Paths.PHONE_CAPABILITY`. 워치 `uirun_watch_app` = 폰 `WATCH_CAPABILITY` |
| 등록 | 폰 GMS `+ uirun_phone_bridge`, 워치 GMS `+ uirun_watch_app`. 실행 중 `addLocalCapability`는 양쪽 `4006 DUPLICATE_CAPABILITY`(이미 등록됨). 백그라운드·포그라운드 전환 뒤에도 같음 |
| 전파 | 워치 GMS DataItem에 `5d4e4355 … /capabilities/com.attentionall.uirun/5e8f…/uirun_phone_bridge` 존재 |
| **앱 조회** | **워치 `getCapability('uirun_phone_bridge', ALL/REACHABLE)`=[] · `getAllCapabilities(ALL)`=0개, 폰 `getCapability('uirun_watch_app', ALL/REACHABLE)`=[]** |
| 직접 메시지 | capability 없이 워치→폰 `HELLO` → 100ms 안에 폰 ACK `{"status":"DONE","jsReady":true}`. 폰 로그 `message from 823a06c path=/uirun/v1/command` |
| JS 초기화 | 폰 `[wear] 워치 브리지 초기화(네이티브 모듈 UirunWearBridge 로드됨)`, `JS가 onCommand 구독 시작(sink 설정)`. 앱 강제 종료 상태에서는 네이티브 서비스가 `jsReady:false`로 답함 |

결론: 페어링·서명·폰 브리지·JS 초기화는 정상이고, **GMS capability 조회 API가 이 앱에 대해 양방향 빈 목록**을 준다. 워치는 capability만으로 폰을 찾아 NO_APP에 머물렀다. 수정: 워치는 연결 노드에 HELLO를 보내 ACK한 노드를 폰으로 쓰고, 폰은 명령을 보낸 워치 노드를 기억해 `hasWatch`에 쓴다(§PROTOCOL 2). 수정 뒤 워치 로그 `ACK로 우이런 폰 확인 → phoneNode=5d4e4355, CONNECTED`, 화면 "운동 준비 완료".

**임시 진단 로그**(debug·debuggable 빌드만, logcat 태그 `UirunDiag`, 노드 ID·이름·capability만): 워치 `PhoneLink.kt`의 `diag`/`diagnose`, 폰 `WearHub.diagnose`·서비스·모듈 로그, JS `[wear]` 로그와 `Bridge.diagnose?.()`. 원인이 정리되면 지워도 된다(보완 로직 `probe`·`confirmed`·`rememberWatch`는 남긴다).

진단 스크립트(페어링 문제와 앱 문제 구분, 데이터 안 지움):

```powershell
.\watch\scripts\diagnose-datalayer.ps1 -PhoneSerial emulator-5556 -WatchSerial emulator-5554
```

## 9. 재빌드

- **폰 앱: 네이티브 재빌드 필요**(새 네이티브 모듈·expo-camera·플러그인). `npx expo prebuild --platform android` → `npx expo run:android`. 이번 검증에서 `--clean` 없이도 Expo가 `android/`를 다시 만들었고 debug 키 지문은 같았다.
- 워치: `watch/scripts/build-debug.ps1` → `install-debug.ps1 -Serial <워치>`.

## 10. 노트북에서 이어서 개발하기 (2026-10-07 WIP 기준)

작업 브랜치: **`feat/wear-companion`** (원격 `origin/feat/wear-companion`). main에는 아무것도 올리지 않았다. PR·merge 없음.

### 10.1 현재 상태

| 구분 | 내용 |
|---|---|
| 구현됨 | 워치 앱 전 화면(W0~W7-B, E1~E3, P1, 종료 확인), 워치 상태 규칙(W3 10초, 길게 눌러 종료, 재시도·오래된 상태 무시·계정 세대), 폰 네이티브 브리지(명령 수신·ACK·스냅샷·알림 경로), 폰 JS 브리지(같은 운동 엔진 함수로 처리), 앱 안 카메라 촬영 화면, capability 조회가 비면 HELLO/ACK로 상대를 찾는 보완, 진단 스크립트 |
| 에뮬레이터에서 확인됨 | 데스크톱 Pixel 8(API 36) ↔ Wear OS 5 에뮬레이터 페어링에서 HELLO/ACK 왕복, 워치 W0 "운동 준비 완료", 폰 앱 강제 종료 시 "폰 앱이 꺼져 있어요", 백그라운드 중 ACK 유지(§8) |
| 미완성·미검증 | **워치에서 운동 시작(START) 실제 처리**, 일시정지·재개·종료 실연결, 체크포인트 W3 → 간단 응답 → 앱 안 카메라 제출 실연결, 실기기 전체, 안 보여요·모르겠어요 서버 계약(§4) |

### 10.2 알려진 오류

- **워치 START 후 "폰에서 처리하지 못했어요"가 뜰 수 있다.** 이 문구는 워치가 모르는 오류 코드를 받았을 때의 기본 문구다(`watch/.../ui/Screens.kt` `noticeText`). 조사 상태: **원인 코드 미확인.** 폰은 거절 사유를 ACK의 `code`로 보내므로, 워치 logcat `UirunDiag`의 `ack from … "status":"REJECTED"(또는 "NEEDS_PHONE"),"code":"…"` 줄에서 실제 코드를 먼저 확인한다. 후보: 폰 처리 중 예외(`PHONE_ERROR`), 워치 문구에 없는 서버 코드(예: `COURSE_MODE_NOT_SUPPORTED`, `INTERNAL` 계열), Firebase Emulator 미실행·연결 대상 설정 문제. 에뮬레이터 위치는 파일럿 구간이어야 한다(`adb emu geo fix 127.064417 37.615374`). 폰 앱이 앞에 있어야 시작한다(백그라운드면 `PHONE_FOREGROUND_REQUIRED`).
- **날씨 API 실패**: 워치 작업과 별개로 보고된 문제다. **이번 브랜치에서 조사하지 않았다.** 날씨는 백엔드 `getWeather`(`backend/functions/src/weather.js`, open-meteo 호출, API 키 없음)를 거친다. Emulator 대상이면 Functions Emulator에서 외부 네트워크 호출이 되는지부터 확인한다.
- 에뮬레이터 GMS capability 조회가 빈 목록을 준다(§8). HELLO/ACK 보완으로 연결은 되지만 실기기에서 capability 조회가 정상인지 아직 모른다.
- 진단 로그(`UirunDiag`, `[wear]`)는 임시다. 원인 정리 후 지운다(보완 로직은 유지).

### 10.3 노트북에서 처음 실행할 명령 (Windows PowerShell)

```powershell
# 처음이면 클론(영문 짧은 경로), 이미 있으면 fetch만
git clone https://github.com/2026-KW-HACKATHON/39_Attention-All C:\dev\39_Attention-All
cd C:\dev\39_Attention-All
git fetch origin
git switch feat/wear-companion
git pull --ff-only

# JDK 17(설치: winget install Microsoft.OpenJDK.17 — 실제 설치 경로로 바꾼다)
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# 영구 설정이 필요하면: setx JAVA_HOME "C:\Program Files\Java\jdk-17"

cd mobile
npm ci
# (10.5의 비밀 설정 파일을 비공개 경로로 옮긴 뒤)
npx expo prebuild --platform android
```

### 10.4 실행 순서

1. **Firebase Emulator**(연결 대상이 `emulator`일 때):
   ```powershell
   cd C:\dev\39_Attention-All\backend; npm ci; npm --prefix functions ci
   npm run emulators:keep          # 처음이면 npm run emulators
   # 다른 터미널에서 예시 데이터(한 번):
   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; node scripts/seed.js prototype.seed.json; node scripts/seed-test-news.cjs
   ```
2. **Pixel 8 ↔ Wear OS 에뮬레이터 페어링**: SDK Manager에서 Wear OS 시스템 이미지(예: `system-images;android-34;android-wear;x86_64`)를 받고 Wear AVD(Small/Large Round)를 만든다. 폰 AVD는 Google Play 이미지(Pixel 8)로 띄워 Play 스토어에서 Pixel Watch(Wear OS) 앱을 설치·로그인한다(본인이 직접). Android Studio `Device Manager › 폰 AVD ⋮ › Pair Wearable`로 짝짓는다. 공식 안내: https://developer.android.com/training/wearables/get-started/connect-phone
3. **Metro**:
   ```powershell
   cd C:\dev\39_Attention-All\mobile
   adb -s <폰 serial> reverse tcp:8081 tcp:8081
   npx expo start --dev-client --clear
   ```
4. **휴대폰 설치**(다른 터미널): `npx expo run:android --device`(또는 `cd android; .\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64` 후 `adb -s <폰 serial> install -r app\build\outputs\apk\debug\app-debug.apk`)
5. **워치 설치**:
   ```powershell
   cd C:\dev\39_Attention-All\watch
   .\scripts\build-debug.ps1
   .\scripts\install-debug.ps1 -Serial <워치 serial>
   .\scripts\verify-signing.ps1 -PhoneSerial <폰 serial>
   ```
6. **연결 진단**: `.\scripts\diagnose-datalayer.ps1 -PhoneSerial <폰 serial> -WatchSerial <워치 serial>` — 서명·GMS 노드·capability·직접 ping·폰 ACK를 모아 페어링 문제/앱 문제를 판정한다. 실시간: `adb -s <serial> logcat -s UirunDiag`.

### 10.5 Git에 없는 파일(비공개로 따로 옮길 것)

| 파일 | 위치 | 비고 |
|---|---|---|
| `.env.local` | `mobile/.env.local` | 형식은 `mobile/env.example`. 연결 대상·Emulator 주소, (firebase 대상이면) App Check debug 토큰·지도 키 |
| `google-services.json` | `mobile/google-services.json` | firebase 대상 빌드에만 필요. Firebase 콘솔에서 받는다(데스크톱에는 현재 없음) |
| App Check debug 토큰 | `.env.local` 또는 기기별 생성 | 기기·설치마다 다를 수 있다. 콘솔에 등록 |
| 지도 키 | `GOOGLE_MAPS_API_KEY` 환경변수 또는 `.env.local` | 패키지·SHA-1로 제한된 키 |
| Emulator 데이터(선택) | `backend/.emulator-data/` | 테스트 계정·제보를 이어 쓰려면 |
| 로컬 전용 문서(선택) | `docs/HANDOFF-WATCH.md`, `docs/wear/`의 작업 지시서 원본 | 커밋하지 않기로 한 문서 |
| 화면 캡처(선택) | `docs/wear/screens/*.png` | DEMO 시나리오로 다시 찍을 수 있다 |

비밀 값은 메신저·저장소에 붙이지 말고 개인 저장소(USB, 비공개 드라이브 등)로 옮긴다.

### 10.6 debug.keystore

- `mobile/android/app/debug.keystore`는 `npx expo prebuild`가 Expo 템플릿에서 만드는 **생성 파일**이라 Git에 없다(`mobile/.gitignore`의 `/android`). 워치 debug 빌드는 이 파일로 서명한다(같은 서명이어야 Data Layer가 연결된다).
- 데스크톱의 지문: SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`(공개 템플릿 키의 지문). 노트북에서 prebuild 뒤 확인:
  ```powershell
  & "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore C:\dev\39_Attention-All\mobile\android\app\debug.keystore -alias androiddebugkey -storepass android
  ```
- 지문이 같으면 그대로 쓴다. 다르면 Firebase·지도에 등록된 지문과 맞는 키(데스크톱의 같은 파일)를 **비공개로** 옮겨 같은 위치에 두거나, 워치는 `.\scripts\build-debug.ps1 -PhoneKeystore <경로>`로 그 키를 쓴다. 키를 새로 만들거나 커밋하지 않는다.

### 10.7 다음 개발 우선순위

1. 워치 START 실패 원인 코드 확인(10.2) → 폰 처리 수정 또는 워치 안내 문구 매핑 추가.
2. 실연결로 시작 → W2 수치 → 일시정지·재개 → 종료 → 기록 한 건 저장 확인(§7 체크리스트).
3. 체크포인트 W3 → 간단 응답 → 앱 안 카메라 제출 실연결 확인.
4. 날씨 API 실패(별도 문제) 조사.
5. 실기기에서 capability 조회 동작 확인 후 임시 진단 로그 정리.
6. 안 보여요·모르겠어요 서버 계약을 팀과 합의(§4).

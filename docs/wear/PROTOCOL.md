# 우이런 폰↔워치 연결 계약 v1

작성 2026-10-07. 구현: 워치 `watch/app/src/main/java/com/attentionall/uirun/watch/Protocol.kt`·`WatchController.kt`, 폰 JS `mobile/src/wearlogic.ts`(순수 규칙)·`mobile/src/wear.ts`, 폰 네이티브 `mobile/modules/uirun-wear-bridge`. 필드를 바꾸면 세 곳과 이 문서를 함께 바꾼다.

## 1. 원칙

- **폰 운동 엔진(`mobile/src/run.ts`)이 유일한 권위**다. GPS·거리·페이스·오프라인 큐·Firebase 인증·서버 호출·최종 저장은 폰만 한다.
- 워치는 폰이 보낸 **스냅샷**을 표시하고 **명령**을 요청한다. 거리·보상·노출(Exposure)을 계산하거나 만들지 않는다. 기록 목록·상세 DB를 두지 않는다(현재 운동과 마지막 종료 요약만 Data Layer 항목으로 받는다).
- 워치 START는 기존 `/run-ready` 화면에서 GPS·100m 밖 동의·카운트다운을 완료한 뒤 시작한다. 다른 워치 명령은 폰 화면 버튼과 **같은 함수**(`startRun`·`pauseRun`·`resumeRun`·`finishRun`·`quickFromExposure`·사진 파이프라인)로 처리한다. `startRun`은 동시 호출을 하나로 합쳐(single-flight) 폰·워치 동시 시작에도 서버 운동은 한 건이다. 이미 운동 중이면 그 운동을 돌려준다.
- 워치에는 Firebase 로그인 토큰, App Check 토큰, 서비스 계정, 사진 원본·URL, 계정 UID를 보내지 않는다. 워치는 Firebase에 직접 접속하지 않는다.

## 2. 채널

| 경로 / 이름 | 방향 | API | 내용 |
|---|---|---|---|
| `/uirun/v1/snapshot` | 폰 → 워치 | DataClient(최신 1건, `setUrgent`) | DataMap `json`(스냅샷 JSON 문자열), `revision`(long) |
| `/uirun/v1/command` | 워치 → 폰 | MessageClient | 명령 JSON |
| `/uirun/v1/ack` | 폰 → 워치 | MessageClient(명령을 보낸 노드로) | ACK JSON |
| `uirun_phone_bridge` | 폰 capability | CapabilityClient | 우이런 폰 브리지가 있는 폰 찾기(`FILTER_REACHABLE`) |
| `uirun_watch_app` | 워치 capability | CapabilityClient | 폰이 워치 앱 존재(`FILTER_ALL`)·현재 연결(`FILTER_REACHABLE`) 확인 |
| `uirun://wear-capture?req=<요청 ID>` | 워치 → 폰 화면 | RemoteActivityHelper | 앱 안 촬영 화면. **URI에는 불투명한 요청 ID만** |
| `uirun://record/<sessionId>` | 워치 → 폰 화면 | RemoteActivityHelper | 운동 결과 상세(폰이 본인 기록인지 서버로 다시 확인) |

Data Layer 연결 조건: 폰·워치 **applicationId가 같고(`com.attentionall.uirun`) 서명 인증서가 같아야 한다.** 워치에 `.watch` 접미사를 붙이지 않는다(Kotlin namespace만 `com.attentionall.uirun.watch`).

**상대 찾기(capability + ACK 보완)**: capability는 양쪽 `res/values/wear.xml`(`android_wear_capabilities`)에 정적으로 선언하고, 실행 중에도 `addLocalCapability`로 다시 알린다(이미 있으면 GMS가 `4006 DUPLICATE_CAPABILITY` — 정상). 2026-10-07 페어링 에뮬레이터(Wear OS 5 API 34 ↔ Android 16 API 36)에서 GMS에 양쪽 capability 항목이 동기화돼 있는데도 앱의 `getCapability`·`getAllCapabilities`가 양방향 모두 빈 목록을 돌려주는 것을 로그로 확인했다. 그래서 capability 조회가 비면:
- 워치는 `connectedNodes`의 각 노드에 `HELLO`(id `probe-…`)를 보내고, **ACK를 돌려준 노드를 폰으로 쓴다**. Data Layer 메시지는 같은 패키지·서명 앱에만 전달되므로 ACK가 우이런 폰 브리지 설치의 증거다. ACK가 없으면 그대로 NO_APP.
- 폰 네이티브는 명령을 보낸 워치 노드를 기억해(`watchNode`) `hasWatch`(워치 있음/지금 연결됨) 판단에 쓴다.

MessageClient 전송 성공은 "폰 기기에 전달됨"일 뿐 폰 운동 처리 성공이 아니다. 처리 결과는 ACK와 스냅샷으로만 확인한다.

## 3. 스냅샷 (폰 → 워치)

```jsonc
{
  "v": 1,                       // 계약 버전(정수). 워치는 v가 다르면 표시하지 않고 ‘앱 버전을 맞춰주세요’
  "epoch": 1791300000000,       // 계정 세대(네이티브가 붙임). 로그인 계정이 바뀌면(로그아웃 포함) 커진다
  "revision": 418,              // 순번(네이티브가 붙임, 앱 재시작에도 줄지 않음)
  "observedAt": 1791301234567,  // 폰 시각(표시용만)
  "account": { "signedIn": true, "needs": [] },   // needs: LOGIN | CONSENT | LOCATION_PERMISSION | PRECISE_LOCATION
  "session": null | {
    "sessionId": "…", "status": "ACTIVE|PAUSED|ENDING|ENDED", "mode": "RUN|WALK",
    "distanceM": 2840.5,        // 폰 엔진 화면 거리(localM, 서버와 같은 유효 구간 규칙). ENDED면 서버 결과
    "activeMs": 1056000,        // observedAt 시점의 활동 시간(엔진 activeMs: 일시정지·종료 누른 시각 반영)
    "paceSecPerKm": 372 | null, // 10m 미만이면 null(가짜 페이스 없음)
    "sync": "OK|SENDING|OFFLINE",
    "problem": null | "LOCATION_OFF" | "SESSION_TRACK_LIMIT" | "SESSION_EXPIRED" | "SESSION_CLOSED" | "TRACK_REJECTED" | …,
    "result": null | { "sessionId", "distanceM", "activeMs", "participations": 2 | null }  // 서버가 종료를 확인했을 때만(폐기 DISCARDED 제외)
  },
  "exposure": null | {          // 서버 recordMissionExposure가 준 유효 노출만. ACTIVE일 때만 싣는다
    "id": "…", "kind": "ISSUE|ROUTINE", "title": "수면 거품",
    "distanceM": 24 | null,     // 폰 최근 정확한 위치(10초·30m 이내)로 잰 가장 가까운 관찰 기준점까지
    "answerable": true,         // ISSUE이고 distanceM ≤ radiusM (버튼 표시용, 최종 판단은 서버)
    "radiusM": 40,
    "expiresInMs": 1700000      // observedAt 기준 남은 시간. 워치는 수신 시각(단조 시계)에 더해 만료를 판단한다
  },
  "quick": null | { "commandId", "exposureId", "answer": "PRESENT|ABSENT|UNKNOWN",
                    "state": "SENDING|DONE|FAILED|UNSUPPORTED", "code": null | "…", "reward": Reward | null },
  "photo": null | { "requestId", "exposureId", "stage": Stage, "code": null | "…", "reward": Reward | null },
  "last": null | { "sessionId", "distanceM", "activeMs", "participations" }   // 마지막 종료 요약(새 운동이 시작되면 지움)
}
// Reward = { "saved": bool, "existing": bool, "points": int, "pending": int, "reason": string | null }
//   points=서버 pointsAwarded(확정 지급), pending=서버 pointsPending(검토 대기), reason=서버 rewardReason. 합치거나 만들지 않는다.
```

워치 수용 규칙(`WatchController.onSnapshot`):
- `epoch`가 지금보다 작으면 버린다. 같은 `epoch`에서 `revision`이 같거나 작으면 버린다(늦게 온 이전 상태로 되돌아가지 않음).
- `epoch`가 바뀌면 이전 계정의 화면 경로·대기 명령·W3 알림·응답·촬영 상태·체크포인트 기록을 모두 지운다.
- 워치가 꺼져 있던 사이의 최신값은 Data Layer가 워치에 보관한 항목을 시작할 때 읽는다(별도 DB 없음).

전송 빈도(`wearlogic.publishDue`): 상태·동기화·문제·결과·체크포인트(id·응답 가능)·응답·촬영 단계·계정이 바뀌면 **즉시**. 거리·시간만 바뀌면 워치 화면이 보일 때 1초, 안 보일 때 15초 간격(폰 위치 갱신 3초마다의 이벤트에 맞춰 보냄). 시간은 워치가 보간한다. 워치 HELLO마다 강제로 한 번 보낸다.

## 4. 명령 (워치 → 폰)

```json
{ "v": 1, "id": "<UUID>", "type": "PAUSE", "epoch": 1791300000000, "sessionId": "…", "revision": 418 }
```

| type | 추가 필드 | 폰 처리 | ACK |
|---|---|---|---|
| `HELLO` | `visible` | 네이티브가 즉시 `DONE` + `jsReady`로 답한다(JS가 없어도). JS가 있으면 스냅샷 강제 전송, 워치 화면 보임 여부 기록, 60초마다 준비 상태 재확인 | `DONE` |
| `START` | `mode` | 이미 운동 중 → 그 운동. 폰이 앞에 없으면 실행하지 않고 보관·폰 알림(§8). 위치 권한 없음 → 폰 확인. 그 외 기존 `/run-ready`로 전달해 GPS·구간 밖 동의·카운트다운 완료 후 시작 | `RECEIVED` → `DONE{sessionId}` / `REJECTED` / `NEEDS_PHONE` |
| `PAUSE` | `sessionId` | ACTIVE면 `pauseRun()`(누른 시각 = 폰이 받은 시각), 아니면 그대로 | `DONE` |
| `RESUME` | `sessionId` | PAUSED면 폰이 앞에 있을 때만 `resumeRun()`(§8) | `DONE` / `NEEDS_PHONE` |
| `FINISH` | `sessionId` | ACTIVE·PAUSED면 `finishRun()`. 이미 ENDING·ENDED면 그대로 | `DONE` |
| `RETRY_FINISH` | `sessionId` | ENDING이면 `pump()` — 큐에 있는 **같은 종료 요청(같은 clientRequestId)**을 다시 보낸다 | `DONE` |
| `QUICK` | `sessionId`,`exposureId`,`answer` | §6 | `RECEIVED` → `DONE` / `REJECTED` |
| `PHOTO` | `sessionId`,`exposureId`,`answer` | §7. `id`가 촬영 연결 요청 ID | `RECEIVED{opened, phoneLocked}` / `REJECTED` |
| `ALERT_SHOWN` | `exposureId` | 네이티브가 기록(폰 알림 생략 판단, §5) | 없음 |

검증 순서(`wearlogic.check`): 버전 → `epoch`(HELLO·ALERT_SHOWN 제외, 다르면 `ACCOUNT_CHANGED`) → 로그인(`LOGIN_REQUIRED`) → 세션(START 제외, 진행 중 세션과 `sessionId`가 다르면 `SESSION_MISMATCH`).

중복·재시도:
- 폰은 처리한 명령 결과를 계정별 파일 `wear-<uid>.json`에 최근 50건 보관한다. **같은 `id`가 다시 오면 다시 실행하지 않고 같은 ACK**를 보낸다(앱 재시작 뒤에도). 처리 중이면 `RECEIVED`.
- 워치는 상태 변경 명령을 **연결됐을 때만** 보내고, ACK가 없으면 **같은 id·같은 내용**으로 3초 간격 최대 3회 보낸다. 12초 안에 ACK·스냅샷으로 확인되지 않으면 대기를 풀고 HELLO로 최신 상태를 받아 사용자가 다시 조작하게 한다. 연결 복구 뒤 이전 명령을 자동으로 다시 보내지 않는다.
- 명령은 화면을 바로 바꾸지 않는다: 버튼은 대기 표시 → ACK(거절이면 이유 표시) → 스냅샷 상태로 화면 전환. 예: START는 ACK `DONE`이 와도 스냅샷에 세션이 보일 때 W2로 간다.
- 서버 멱등성은 기존 `clientRequestId`(운동 큐 op id, `mutate` 슬롯) 그대로다. 워치 commandId를 서버로 보내지 않는다.

## 5. ACK (폰 → 워치)

```json
{ "v": 1, "id": "<명령 id>", "status": "RECEIVED|DONE|REJECTED|NEEDS_PHONE", "code": "…", "sessionId": "…",
  "jsReady": true, "opened": false, "phoneLocked": false }
```

`jsReady`: 폰 우이런 JS 엔진이 이벤트를 받을 수 있음(HELLO·네이티브 답). `false`이고 운동이 진행 중이면 워치는 E1 "폰 기록 상태를 확인할 수 없어요"(계속 기록된다고 단정하지 않음). HELLO에 25초 넘게 답이 없어도 같다.

### 체크포인트 알림 경로(중복 방지)

1. 폰 엔진이 서버에서 노출을 받으면 진동·OS 알림 전에 `wearHooks.claimAlert(exposureId)`를 부른다.
2. 지금 연결된 우이런 워치(`uirun_watch_app` REACHABLE)가 있으면 스냅샷을 즉시 보내고 **네이티브에서 최대 4초** `ALERT_SHOWN`을 기다린다(앱이 백그라운드면 JS 타이머가 돌지 않으므로 Handler로 기다린다).
3. 워치는 화면이 보이면 W3를, 안 보이면 `PhoneDataService`가 진동 알림을 띄운 뒤 `ALERT_SHOWN`을 보낸다. 같은 `exposureId`는 워치에서 한 번만(화면·알림 각각 SharedPreferences 기록, epoch 바뀌면 비움).
4. ACK가 오면 폰은 진동·OS 알림을 생략한다. 연결된 워치가 없거나 4초 안에 ACK가 없으면(워치 알림 권한 없음·끊김) 폰이 기존대로 알린다.
5. 워치 매니페스트 `notificationBridgeMode=NO_BRIDGING`: 폰 우이런 알림을 워치로 복제하지 않는다(운동 기록 중 알림 포함).

## 6. 간단 응답(QUICK)

- W3 선택지: `PRESENT`(아직 있어요) / `ABSENT`(안 보여요) / `UNKNOWN`(모르겠어요). 노출마다 한 번만 만든다.
- **현재 서버 `submitQuick`은 ‘지금도 보여요’(PRESENT)만 받는다**(`{issueId,loc,sessionId?,exposureId?}`, 응답 종류 필드 없음). 폰은 PRESENT만 `quickFromExposure`(폰 알림 카드와 같은 함수·같은 요청 슬롯)로 제출한다.
- `ABSENT`·`UNKNOWN`은 **제출하지 않고** `quick.state = UNSUPPORTED`, ACK `REJECTED/ANSWER_NOT_SUPPORTED`. PRESENT로 바꿔 보내지 않는다. 워치는 "아직 받지 않는 응답이에요"로 안내하고 저장 성공으로 표시하지 않는다. 개발 DEMO 데이터에서만 세 응답 모두 결과 화면까지 보인다.
- 만료된 노출은 워치에서 W3 남은 시간과 관계없이 제출하지 않고, 폰도 `EXPOSURE_EXPIRED`로 거절한다.
- W3 10초 타이머는 최초 표시 시각 기준이며 스냅샷 갱신·재구성으로 늘어나지 않는다. 화면을 떠나면 취소된다. **시간 초과는 무응답**이며 아무것도 보내지 않는다.
- 정기 관찰(ROUTINE) 노출은 상태 응답이 없으므로 W3 대신 바로 사진 선택(W4-B "사진을 남길까요?")을 같은 10초 규칙으로 보여준다.
- QUICK은 사진 신선도·PEER·Welcome·사진 Mission을 바꾸지 않는다(서버 기존 규칙). 보상은 서버 응답값만.

## 7. 앱 안 촬영 연결(handoff)

```
워치 W4-B ‘우이런에서 촬영’
 └ PHOTO 명령(id = 요청 ID) ─→ 폰: 계정·세션·Exposure(만료·종류)·응답 확인 → 연결 정보 보관(wear-<uid>.json) → stage PHONE_RECEIVED
     ├ 폰이 앞에 있음: 바로 /wear-capture?req=ID 열기 → ACK{opened:true}
     └ 아님: 폰 알림(눌러서 이어가기) → ACK{opened:false, phoneLocked}
 └ ACK opened=false면 워치가 RemoteActivityHelper로 uirun://wear-capture?req=ID 요청(전달 여부만 앎)
 폰 촬영 화면: 같은 계정·만료 전·제출 전인 연결만 이어감 → CAMERA_OPENED → expo-camera 미리보기·셔터
   → 기존 파이프라인 capture(…, shoot) → 티켓 → 사진 보관 → 봉인 → upload → READY
   → SUBMITTED → submitPhotoRecheck / submitRoutine {ticketId, sessionId?, exposureId}(요청 슬롯 submit:<작업 id>)
   → SERVER_RESULT{reward} | FAILED{code} | CANCELLED | CAMERA_PERMISSION | EXPIRED
```

| stage | 뜻 | 워치 |
|---|---|---|
| `PHONE_RECEIVED` | 폰이 요청을 받아 보관함(화면은 아직) | W4-C "폰에서 우이런 촬영 화면을 여는 중" |
| `CAMERA_OPENED` | 앱 안 카메라 화면이 열림 | W4-C "폰의 우이런 내부 카메라로 촬영" |
| `CAMERA_PERMISSION` | 카메라 권한 거절 | E2 "카메라 권한이 필요해요" |
| `SUBMITTED` | 사진 업로드 확인 후 제출 요청 | W5-A |
| `SERVER_RESULT` | 서버 접수(보상 그대로) | W5-B(지급·검토 대기·포인트 없음 구분) |
| `FAILED` / `EXPIRED` | 다시 쓸 수 없는 사진·서버 확정 거절 / 노출 만료 | W5-B 실패 안내 |
| `CANCELLED` | 사용자가 취소 | 결과 화면 없이 운동 계속 |

- 시스템 카메라 앱(`launchCameraAsync`, `ACTION_IMAGE_CAPTURE`)을 열지 않는다. 기존 제보 화면은 계속 시스템 카메라를 쓴다(`capture()`의 기본 `shoot`).
- 딥링크만으로 제출·보상하지 않는다. URI의 요청 ID로 폰에 보관된 연결 정보를 찾고, 계정 UID·만료·단계를 다시 본다. 서버는 Exposure·세션·위치를 다시 검증한다.
- 워치 ‘다시 요청’은 **같은 요청 ID**: 폰은 같은 연결로 다시 열기만 한다. 제출은 사진 작업 하나에 한 번이며 결과가 모호한 실패만 같은 작업·같은 요청 ID로 재시도한다.
- 사용자가 우이런을 직접 열어도 같은 계정의 아직 유효한 연결이 `PHONE_RECEIVED`면 촬영 화면을 한 번 자동으로 연다. 만료됐으면 "체크포인트 시간이 지났어요" 후 운동으로 돌아간다. 새 Exposure·티켓을 만들어 대신하지 않는다(노출은 서버만 만든다).
- 사진 재확인은 상태 응답이 PRESENT일 때만 잇는다(ABSENT·UNKNOWN 사진은 서버에 그 뜻을 담을 필드가 없어 재확인 사진으로 저장되면 ‘아직 있음’ 근거로 쓰인다). 폰도 `PHOTO_NOT_FOR_ANSWER`로 거절한다.
- 워치 화면 판단: ACK 5초 없음·원격 열기 실패·12초 안에 `CAMERA_OPENED` 없음 → E2(폰 잠금이면 "폰 잠금을 해제해주세요"). 폰에서 직접 열어 `CAMERA_OPENED`가 오면 W4-C로 돌아간다.

## 8. Android 실행 제한

- 워치 명령은 `WearableListenerService`(모듈 매니페스트)가 받는다. 앱 프로세스가 없어도 Google Play 서비스가 깨우지만 **JS 엔진은 없고, 백그라운드 위치 서비스 시작 권한도 생기지 않는다**.
  - JS 없음: `START`·`PHOTO`만 네이티브에 최대 10건 보관하고 폰 알림(권한 있을 때)을 띄운 뒤 `NEEDS_PHONE/PHONE_APP_NOT_RUNNING`. 다른 명령은 보관하지 않는다. JS가 시작되면 2분 안의 것만 꺼내 같은 검증으로 처리한다(START는 확인 창).
  - JS 있음·폰이 앞에 없음(잠금·백그라운드): `START`·`RESUME`은 실행하지 않고 폰 알림 + `NEEDS_PHONE/PHONE_FOREGROUND_REQUIRED`. 우이런을 열면 2분 안이면 "워치에서 ○○을 요청했어요. 지금 할까요?" 확인 후 실행. 일시정지 중에는 엔진이 위치 Foreground Service를 내리므로 Android 12+에서 백그라운드 재시작이 막힌다.
  - `PAUSE`·`FINISH`·`RETRY_FINISH`·`QUICK`·`PHOTO` 접수는 폰이 잠겨 있어도 처리한다(이미 실행 중인 엔진, 이벤트 기반).
- 폰 JS 브리지는 이벤트로만 동작한다(Android에서 앱이 백그라운드면 RN JS 타이머가 멈춘다 — `JavaTimerManager`). 기다림은 네이티브 Handler(ALERT_SHOWN)만 쓴다.

## 9. 시간

- 워치 표시 활동 시간 = 스냅샷 `activeMs` + (ACTIVE이고 연결됐을 때만) 수신 후 워치 **단조 시계**(elapsedRealtime) 경과. 일시정지·종료 중·연결 끊김이면 늘리지 않는다. 같은 세션 ACTIVE 동안 새 스냅샷이 전달 지연만큼 작아도 표시는 뒤로 가지 않는다.
- 종료 시각은 워치 시계 값을 쓰지 않는다. 폰이 FINISH를 처리한 순간을 엔진 규칙(`markEnd` → `endTime`)으로 정하고 기존 `occurredAt` 오프라인 정책으로 보낸다. 워치–폰이 끊겨 폰이 받지 못한 종료는 성공으로 표시하지 않는다(ACK·스냅샷 ENDING 전에는 W6 그대로). 폰이 받은 뒤 서버만 오프라인이면 기존 큐가 처리하고 워치는 W7-A(시간 동결) → `sync=OFFLINE`이면 E3 → 저장되면 W7-B.

## 10. 계정 변경

- 네이티브 `setAccount(uid)`: UID 해시(폰에만 저장)가 바뀌면 `epoch = max(이전+1, 현재 ms)`로 올리고 보관 중인 워치 요청을 버린다. 폰 JS는 계정 확인 전·전환 중(현재 UID와 세대 UID가 다를 때)에는 스냅샷을 보내지 않는다.
- 로그아웃: `signedIn:false, needs:[LOGIN]`, 운동·결과·요약·응답·촬영 없이 새 epoch로 보낸다. 워치는 epoch가 바뀌면 모든 표시를 지운다. 같은 계정으로 다시 들어와도 새 세대다.
- 폰 상태 파일은 계정별(`wear-<uid>.json`, 기존 `run-<uid>-*`, `photos-<uid>`)이고 다른 계정 파일을 읽지 않는다.

## 11. 오류·안내 코드

| 코드 | 보내는 곳 | 뜻 |
|---|---|---|
| `UNSUPPORTED_VERSION` | 폰 | 명령 `v` 불일치 |
| `ACCOUNT_CHANGED` | 폰 | 명령 epoch가 현재 계정 세대와 다름 |
| `LOGIN_REQUIRED` | 폰 | 폰 로그아웃 상태 |
| `SESSION_MISMATCH` | 폰 | 진행 중 운동이 아니거나 다른 운동 |
| `PHONE_APP_NOT_RUNNING` | 폰 네이티브 | 우이런 JS 없음(보관·알림) |
| `PHONE_FOREGROUND_REQUIRED` | 폰 | 시작·재개는 우이런이 앞에 있어야 함 |
| `LOCATION_PERMISSION_REQUIRED` | 폰 | 위치 권한 없음 |
| `CANCELLED_ON_PHONE` | 폰 | 폰 확인 창에서 취소 |
| `ANSWER_NOT_SUPPORTED` | 폰 | ABSENT·UNKNOWN 서버 미지원 |
| `PHOTO_NOT_FOR_ANSWER` | 폰 | PRESENT가 아닌 응답의 사진 재확인 |
| `EXPOSURE_EXPIRED` | 폰·서버 | 노출 만료 |
| `PHONE_ERROR` | 폰 | 처리 중 예외 |
| 서버 도메인 코드 | 폰이 그대로 | `startRun`·`submitQuick`·사진 제출의 `errorCode`(예: `OUTSIDE_PILOT`, `GPS_ACCURACY_TOO_LOW`, `CONSENT_REQUIRED`, `TOO_FAR`) |
| `NOT_CONNECTED`·`SEND_FAILED`·`NO_RESPONSE`·`OPEN_FAILED`·`NOT_OPENED`·`UNLOCK_NEEDED` | 워치 내부 | 전송 실패·무응답·원격 열기 실패·카메라 미열림·폰 잠김 |

## 12. 버전 호환

- 정수 `v`는 깨지는 변경에서만 올린다. 필드 추가는 v를 유지하고 받는 쪽은 모르는 필드를 무시한다.
- 워치는 `v`가 다른 스냅샷을 표시하지 않고 W0 "앱 버전을 맞춰주세요". 폰은 `v`가 다른 명령을 `UNSUPPORTED_VERSION`으로 거절한다.
- capability 이름·경로에 `v1`이 들어 있어 v2는 경로를 나눠 공존시킬 수 있다.

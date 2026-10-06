# 우이런 프론트 API 명세

버전: 2026-10-05 / 프로젝트 `uirun-92539` / Functions `asia-northeast3` / Node22.
현재 49개 HTTPS Callable + 사진 처리 이벤트 1개 + 정리 스케줄 1개다. 이벤트·스케줄은 앱에서 호출하지 않는다.

## 모바일 프론트 연결 시작

현재 Firebase에는 웹 앱만 등록되어 있다(2026-10-05 확인). 실제 React Native 앱은 아직 빌드·검증하지 않았다. 1차 RN 프로젝트는 `mobile/`(Expo SDK 57 Development Build)이며, 아래 4번의 파일은 복사하지 않고 Metro `watchFolders`로 `backend/client`를 그대로 읽는다. Android 앱 등록에 필요한 값은 [docs/mobile/HANDOFF.md](../mobile/HANDOFF.md)에 있다. 아래는 기존 `@react-native-firebase` 호출 예시를 사용하는 경우의 연결 절차이며, 프론트 프로젝트에서 설치 버전을 확정한다.

1. 프론트가 Android `applicationId`와 iOS `bundleIdentifier`를 확정해 백엔드 담당자에게 전달한다. 백엔드는 기존 프로젝트에 각각 앱을 등록하고 `google-services.json` / `GoogleService-Info.plist`를 제공한다. 웹 firebase-config.json으로 네이티브 앱 등록을 대신하지 않는다.
2. Expo를 사용하면 Development Build가 필요하다. 앱 프로젝트에 `@react-native-firebase/app`, `auth`, `functions`, `storage`, `app-check`를 설치하고 각 플랫폼 설정을 적용한다. Google 로그인 라이브러리와 앱 서명 SHA, iOS URL scheme도 함께 설정한다.
3. Android Play Integrity, iOS App Attest 등 플랫폼 App Check를 등록하고 앱 시작 시 초기화한 뒤 API를 호출한다. 개발 빌드의 debug provider는 Firebase에 해당 debug token 등록이 필요하다. 토큰은 개인 로컬 설정으로 관리하고 커밋하지 않는다. 웹 reCAPTCHA 키를 네이티브에 재사용하지 않는다.
4. `backend/client/api.ts`, `mobile-config.json`, `connection-check.js`, `connection-check.d.ts`를 프론트 서비스 폴더에 복사한다. TypeScript는 JSON import(`resolveJsonModule`)를 지원하도록 설정한다. 이 파일들에는 서버 인증 비밀값이 없다.
5. App Check 준비 후 아래 공개 연결 점검을 실행한다. 실제 Google 로그인 credential을 Firebase Auth에 교환한 뒤 본인 API도 점검한다. 실패 시 `checks[].code`를 확인한다. 이 점검은 조회만 수행하며 동의·운동·제보·혜택 데이터를 만들지 않는다.

```ts
import {api} from './api';
import {checkConnection} from './connection-check';
const publicReport = await checkConnection(api);
// Firebase Auth 로그인 완료 후 실행한다.
const signedInReport = await checkConnection(api, {authenticated:true});
// report.ok와 checks만 개발 화면에 표시한다. 전체 API 응답이나 토큰을 로깅하지 않는다.
```

현재 서버용 수동 `.env`/서비스 계정 키 전달은 필요 없다. `mobile-config.json`의 projectId/리전/동의 버전은 공개 연결 상수다. Google 웹 client ID, 지도 SDK client key 등 추가 값은 프론트 라이브러리 선정과 앱 등록 뒤 해당 SDK 방식에 맞춰 제공한다. 실제 지도 SDK 공급자/키는 아직 확정하지 않았다. Expo의 `EXPO_PUBLIC_*`는 앱에 포함되는 공개 값이므로 관리자 인증값을 넣지 않는다.

담당 구분: 프론트는 화면, Google 로그인 UI, 권한, GPS 수집/백그라운드 실행, 카메라와 로컬 큐를 구현한다. 백엔드는 모바일 Firebase 등록·인증 설정, 서버 검증·저장·집계, API 오류 수정과 운영 권한을 담당한다. 현재 HTML 구현은 디자인/웹 검증 참고이며 모바일 기능 완성을 의미하지 않는다.

공식 참고: [Expo Firebase](https://docs.expo.dev/guides/using-firebase/), [Expo Google 로그인](https://docs.expo.dev/guides/google-authentication/), [네이티브 App Check](https://rnfirebase.io/app-check/usage).

## 1. 연결과 공통 규칙

Firebase HTTPS Callable 프로토콜을 사용한다. 일반 REST URL에 임의 JSON을 보내는 방식보다 Firebase SDK `httpsCallable` 사용을 권장한다. 로그인·App Check 토큰은 SDK가 자동 전달한다. 공개 조회도 운영 환경에서는 **App Check가 필요**하다.

```ts
import {initializeApp} from 'firebase/app';
import {getAuth, GoogleAuthProvider, signInWithPopup} from 'firebase/auth';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {initializeAppCheck, ReCaptchaEnterpriseProvider} from 'firebase/app-check';
// firebaseConfig: backend/web/firebase-config.json 내용
// siteKey: backend/web/appcheck-config.json의 siteKey
const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(siteKey),
  isTokenAutoRefreshEnabled: true,
});
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast3');
const call = async <T>(name: string, data: object = {}): Promise<T> =>
  (await httpsCallable<object,T>(functions,name)(data)).data;
await signInWithPopup(auth,new GoogleAuthProvider()); // 웹 전용
```

웹은 HTTP(S) 개발 서버에서 실행한다. HTML을 file://로 직접 열면 상대 설정 JSON·ES module·인증/권한이 정상 동작하지 않을 수 있다. 새로운 배포 도메인은 Firebase Auth authorizedDomains와 reCAPTCHA Enterprise 허용 도메인에 추가해야 한다.

React Native는 플랫폼 Google 로그인 credential을 Firebase Auth로 교환하고 `@react-native-firebase/functions` Seoul 인스턴스로 호출한다. 웹 reCAPTCHA 키를 네이티브에 그대로 사용하지 않는다. Android/iOS Firebase 앱 등록·App Check provider·앱 서명/URL scheme은 패키지 확정 후 별도 설정해야 한다.

- 인증: Google Firebase Auth. 앱이 UID를 입력으로 보내지 않는다. 관리자만 custom claim `admin === true` 필요.
- 변경 API: 모두 `clientRequestId:string`(1~100자) 필수. 논리 작업마다 UUID 한 번 생성, **payload와 함께 저장**. 전송 응답을 잃으면 같은 ID·같은 payload로 재시도. 입력 변경 시 새 ID. 같은 ID에 다른 payload는 `REQUEST_CONFLICT`.
- JSON 객체를 입력한다. 일반 Callable 입력 최대 JSON 문자열 200,000자. getWeather는 별도 공급자 조회 함수다.
- 시간: epoch milliseconds(UTC 절대시각). 날짜/일일 상한/그래프 버킷 기준은 KST. 거리 m, 운동 시간 ms, 페이스 sec/km. 표시에서 km·분으로 변환한다.
- 좌표 배열은 **[위도, 경도]**. GPS 객체는 lat/lng 별도 필드. GeoJSON [경도, 위도]와 혼용하지 않는다.
- 변경 성공 후 화면 갱신 실패는 저장 실패가 아니다. 성공한 변경을 새 ID로 다시 보내지 말고 조회만 재시도한다.
- `ok:true`는 저장/처리 성공이며 포인트 지급 보장은 아니다. `saved:false,existing:true`도 정상 응답이다. 각 응답 필드 확인.
- Firestore 직접 조회·수정 금지: 클라이언트 규칙은 deny. 사진은 발급 uploadPath에만 Storage SDK로 업로드.

```ts
type Loc = {
  lat: number; lng: number; accuracyM: number;
  measuredAt: number; precise: true; mock?: boolean;
};
type Page<T> = {items:T[]; nextCursor:string|null};
type MutationFailure = {ok:false;errorCode:string;details?:object;retryable?:boolean};
```

`loc`: 정확도 ≤30m, 측정 후 ≤10초, 서버보다 미래 최대2초, mock=true 거절. 파일럿 경로 ≤25m 및 같은 PATH/CORRIDOR 검사. GPS 주장 자체가 위변조 불가능한 증명은 아니다.

권한 표기: **공개**=로그인 없이 가능(App Check 필수), **본인**=Firebase 로그인, **운영자**=로그인+admin claim. 동의 버전 `v2-2026-10`가 필요한 변경은 아래 표시한다. 동의 기록은 서버 사용자 토큰 기준.

## 2. 화면별 조회 API (17개)

| 함수 | 권한 | 입력 (`?`는 선택) | 응답 |
|---|---|---|---|
| getHome | 공개 | `{}` | `{riverSummary,pilot,courses,recentIssues:Page<Issue>,my:UserSummary|null,config}` |
| getMapData | 공개 | `{limit?,cursor?}` | `{issues:Page<Issue>,facilities,routines,courses,pilot}` |
| getRiverFeed | 공개 | `{limit?,issuesCursor?,newsCursor?,currentCursor?,pastCursor?}` | `{summary,current:Page<Issue>,past:Page<Issue>,issues:Page<Issue>,news:Page<News>}` |
| getIssueDetail | 공개 | `{issueId,limit?,cursor?}` | `{issue:Issue,observations:Page<PublicObservation>,own:boolean}` |
| getRoutineDetail | 공개 | `{missionId}` | `{id,name,anchors,roundHours,state:RoutineState|null}` |
| getPilotData | 공개 | `{}` | `{paths,facilities,courses,categories,policy}` |
| getWeather | 공개 | `{}` | `{status:'ok'|'stale'|'error',forecast,air,fetchedAt?,source,isModelEstimate}` |
| getRecords | 본인 | `{limit?,runsCursor?,participationsCursor?,issuesCursor?}` | `{runs:Page<SessionSummary>,participations:Page<Observation>,issues:Page<Issue>}` |
| getRunDetail | 본인 | `{sessionId}` | `Session + {track,exposures,metrics}` (타인 기록 NOT_FOUND) |
| getWorkoutStats | 본인 | `{range?:'week'|'month'|'year'}` | `{range,timeZone:'Asia/Seoul',buckets,totals,period}` |
| getMy | 본인 | `{}` | `UserSummary + {activity,participationCount,couponCount,budget,welcomeCount,activeSession:string|null}` |
| getSettings | 본인 | `{}` | `UserSummary + {consent:{uid,version,acceptedAt}|null}` |
| getLedger | 본인 | `{status?,limit?,cursor?}` | `Page<Ledger>` |
| getBenefits | 본인 | `{}` | `{user,welcomeCount,contributions,routineDays,merchants,catalog,coupons}` |
| getDeletionJob | 본인 | `{}` | `{status:'NONE'}` 또는 `{status:'PENDING'|'COMPLETE',createdAt,dataCleaned}` |
| getAdminQueue | 운영자 | `{limit?,cursor?}` | `{issues:Page<Issue>,welcome:[{uid,displayName,welcomeCount}],deletions}` |
| getAdminIssue | 운영자 | `{issueId,limit?,cursor?}` | `{issue,observations:Page<Observation>,photos:[{id,status,capturedAt}]}` |

뒤의 사진 조회 2개를 합쳐 전체 조회 Callable은 19개다.

목록: 기본20/최대50. 받은 nextCursor를 **그 목록의 필드**로만 다시 보낸다. records의 runsCursor와 participationsCursor는 독립이다. 뉴스 추가 페이지는 newsCursor, 현재 제보는 currentCursor. nextCursor=null이면 종료. 동일 ID 중복은 클라이언트에서 제거한다. 정렬 중 데이터가 바뀌면 cursor가 사라져 INVALID_CURSOR가 날 수 있으므로 첫 페이지부터 새로 조회한다. 스냅샷 페이지네이션이 아니다.

### 주요 응답 DTO

- `UserSummary`: displayName, uiMode(DEFAULT/SIMPLE), repeatObservationNotifications, pointsBalance, pointsPending, welcomeStatus(LOCKED/PENDING_ADMIN/APPROVED/ISSUED/SOLD_OUT).
- `Issue`: id, categoryCode/categoryLabel, anchor, observationAnchors, pathSegmentId/corridorSegmentId, verificationLevel(NONE/PEER/ADMIN), createdAt, lastPhotoObservedAt, lifecycleStatus(OPEN/CLOSED/RESOLVED), eventEndsAt, creatorPhotoDeadlineAt, availablePhotoCount, todaySignalAccountCount 등. **creatorUid·타인 신원·사진 Storage 경로는 공개 DTO에 없음**. `own`은 상세 응답에 별도 boolean. 지도 전체 목록만으로 소유자를 추정하지 않는다.
- `RiverSummary`: currentCount,pastCount,latest(Issue|null),updatedAt(number|null). 현재=OPEN이면서 이벤트/종류별 사진 유효시간 안. 과거 기록도 제보 근거이지 확정 수질 판정이 아니다.
- `SessionSummary`: id,mode,courseId,status,startedAt,endedAt?,activeMs,distanceM,pauses,exposureIds 등; track 없음. 상세에서 track과 본인 exposure들을 읽는다. ACTIVE 상세의 activeMs는 조회 시점까지 마지막 재개 이후 경과 시간을 포함하며, PAUSED는 늘어나지 않는다.
- `TrackPoint`(응답): lat,lng,acc,recordedAt,t,altitudeM,segment. **입력 accuracyM / 응답 acc**, recordedAt은 epoch ms이고 응답 t도 epoch ms. HTML의 시작 후 상대시간 t와 혼용하지 않는다. segment가 다른 좌표를 선으로 연결하지 않는다.
- `Observation`: 본인 기록, modality,role,issueId?/missionId?,photo?:{id,path},observedAt,acceptedAt?,visibility,reward,points,pointsPending. **photo 객체를 img.src에 넣지 않는다**. photo.id로 getPhotoAccess 조회. 원 제보가 숨김/삭제돼도 참여 기록은 남을 수 있으므로 제목은 안전한 대체 문구 사용.
- `PublicObservation`: id,modality,observedAt,acceptedAt,role만. 공개 상세에는 사용자/사진 없음.
- `Ledger`: id,uid,amount,status,type,label,sourceId?,issueId?,createdAt 등. status=CONFIRMED/PENDING/EXPIRED/REJECTED/REVERSED. 과거 참여 당시 포인트보다 현재 reward/ledger 상태 우선.
- `RoutineState`: round{id,start,end},mine(string|null),accounts,slotsLeft,welcomeToday. 미로그인은 state=null. 로컬 round를 재계산해 서버 참여 여부를 덮지 않는다.
- `Merchant`: id,name,isDemo만; PIN/해시/salt 없음. catalog는 단일 WELCOME_500 운영, stock/title/condition/validDays/merchantId/isDemo. 미등록이면 catalog=[]; 준비 중 표시하고 발급 CTA 비활성화.
- `Coupon`: id,rewardId,merchantId,status,issuedAt,expiresAt,window?,failCount,lockedUntil 등. status=ISSUED/USE_REQUESTED/USED/EXPIRED/REVOKED. window={useSessionId,endsAt}. merchantId로 상호 연결. 예시 여부는 merchant/catalog.isDemo로 표시.
- 수정본3: 새 제보 자체는 재확인에 포함하지 않아 `signalCount=0`, `lastSignalAt=null`로 시작한다. 다른 계정의 QUICK 재확인만 집계하며 철회하면 제외한다.
- `News`: 수정본3은 `pub`(YYYY-MM-DD|null), `pubKind`(날짜 종류), `checked`(팀 확인일 YYYY-MM-DD|null)를 사용한다. 발행일과 팀 확인일을 분리하고 누락된 확인일은 만들지 않는다. upsertNews에서 생략하면 기존값 유지, null이면 제거한다. 기존 시안은 summary/url/date/source/dateKind를 사용한다. 운영자 새 소식은 body/sourceUrl/publishedAt/createdAt을 사용한다. 표시 어댑터는 summary??body, url??sourceUrl, date??publishedAt??createdAt을 사용한다.

### 운동 집계·상세

`buckets` 각 항목 `{key,count,distanceM,activeMs,runCount,walkCount}`. week=오늘 포함7일, month=오늘 포함30일, year=이번 달 포함12개월. key 일간 YYYY-MM-DD, 월간 YYYY-MM. `totals`=전체 완료/복구 기록, `period`=선택 기간 합계. 세션 시작 KST 날짜 기준. 진행/폐기 세션 제외. 그래프 표시에서 최근 페이지 합계를 사용하지 않는다.

`metrics`: validDistanceM,observedMs,activeMs,pauseMs,averagePaceSecPerKm(number|null),splits,paceSeries,unavailableReason(null/NO_TRACK/NO_VALID_SEGMENTS). splits=[{index,distanceM,durationMs,paceSecPerKm,partial}]. 마지막 미완성1km도 partial=true로 반환. 위치 기록 구간의 페이스와 전체 활동시간 페이스는 다를 수 있다. 양 끝 정확도>30m, 다른 segment, 시간차>60초, 속도>12m/s 구간은 거리·구간 계산에서 제외. GPS가 없으면 임의 그래프/구간을 만들지 않는다.

## 3. 계정·설정 변경 (4개)

모든 표 입력에 clientRequestId를 추가한다.

| 함수 | 권한/동의 | 입력 | 정상 응답 |
|---|---|---|---|
| recordConsent | 본인/기존 동의 불필요 | `{version:'v2-2026-10',accepted:true}` | `{ok:true,acceptedAt}` |
| updateProfile | 본인/동의 불필요 | `{displayName}` trim 후 최대30 Unicode 문자, 빈 문자열은 이름 초기화 | `{ok:true,displayName}` |
| updateSettings | 본인/동의 불필요 | `{uiMode?,repeatObservationNotifications?}` | `{ok:true}` |
| deleteMyAccountData | 본인/동의 불필요 | `{confirm:true}` | `{ok:true,deletionPending:true}` |

설정 알림 boolean은 선호 저장이며 OS 푸시 권한/푸시 전송을 대신하지 않는다. 동의 문안은 시안 수준이므로 출시 전 확정 필요. 탈퇴는 즉시 이용 제한, 시간 단위 정리 작업으로 데이터/사진/Auth 삭제. 요청 성공 시 '삭제 처리 중' 표시. 삭제 작업 조회 외 API는 ACCOUNT_DELETING. 로그아웃 전 상태 조회 가능하며 Auth 삭제 이후 새 로그인은 별도 계정이 될 수 있다.

## 4. 운동 변경 (7개)

본인 로그인+현재 동의 필요. 한 사용자 ACTIVE/PAUSED 세션 최대1개.

| 함수 | 입력 | 정상 응답/상태 |
|---|---|---|
| startRun | `{mode:'RUN'|'WALK',courseId?,loc}` | `{ok:true,sessionId,startedAt}`; ACTIVE |
| appendTrack | `{sessionId,points:[{lat,lng,accuracyM,recordedAt,altitudeM?,mock?}]}` | `{ok:true,count,distanceM}`; count=저장 총점 수 |
| pauseRun | `{sessionId,occurredAt?}` | `{ok:true}`; ACTIVE→PAUSED |
| resumeRun | `{sessionId,occurredAt?}` | `{ok:true}`; PAUSED→ACTIVE |
| finishRun | `{sessionId,expectedTrackCount?,occurredAt?}` | `{ok:true,sessionId,status,distanceM,activeMs}`; COMPLETED 또는 RECOVERED |
| discardRun | `{sessionId,occurredAt?}` | `{ok:true,sessionId,status:'DISCARDED',distanceM,activeMs}` |
| recordMissionExposure | `{sessionId,loc}` | `{ok:true,exposure:null|Exposure}` |

참여 행(`getRecords.participations`, `getRunDetail.participations`)에는 2026-10-06부터 `categoryCode`(관찰의 공개 종류, 없으면 null)가 붙는다. 목록 제목용이며 다른 필드는 그대로다.

`occurredAt`(선택, 2026-10-06 추가): 오프라인 큐가 늦게 보낸 일시정지·재개의 실제 조작 시각(epoch ms). pause는 마지막 재개 시각·마지막 저장 위치점 이후, resume은 일시정지 시작 이후이고 둘 다 서버 현재 시각 이하만 허용(벗어나면 INVALID_ARGUMENT). finishRun·discardRun(2026-10-06 추가)은 ACTIVE면 마지막 재개·마지막 저장 위치점 이후, PAUSED면 일시정지 시작 이후 ~ 서버 현재 시각을 받고 그 시각을 `endedAt`으로 저장한다(따라서 그 뒤에 찍은 관찰은 세션에 연결되지 않는다). COMPLETED/RECOVERED 판정은 서버 수신 시각 기준 그대로다. 생략하면 기존처럼 서버 수신 시각이다. 기기 시계를 그대로 믿는 값이므로 활동 시간 표시에만 영향을 주며 보상 판단에는 쓰지 않는다.

courseId 지정 시 등록된 코스이고 modes에 운동 종류가 포함되어야 한다. walk-only 코스를 RUN으로 시작하면 COURSE_MODE_NOT_SUPPORTED. courseId 생략 가능; 화면은 null 코스명 대체 표시 필요.

GPS는 요청당1~100점/세션5,000점. recordedAt 엄격 증가·서버 미래2초 이내·시작 이후. ACTIVE/PAUSED에서 일시정지 전 버퍼 전송 가능; pause 구간 내부 샘플은 거절. append는 Pilot 경로 범위로 제한하지 않으며 거리 계산이 부정확/비정상 구간을 제외한다. start와 참여/알림은 Pilot 범위 확인.

6시간 이후 append/restart 불가, finish/discard는 가능. 12시간 이후 finish는 RECOVERED. 시간 규칙에 따라 보상/알림 재개가 제한된다. 네이티브 UI가 7일 이후 복구를 제한해도 현재 API 자체는 그 제한을 강제하지 않으므로 API로 7일 SLA를 약속하지 않는다.

**전송 순서**: 수집 → 영속 큐(UID+sessionId+동일 ID) → 순차 append 응답 → pause/resume/finish. finish 전 위치 수집을 잠시 멈추고 큐를 비운 후 expectedTrackCount를 보낸다. 저장 수와 다르면 TRACK_NOT_SYNCED, 상태 유지. offline queue가 6시간을 넘겨 거절되면, 사용자에게 저장된 부분만 종료할지 안내 후 해당 세션 큐 제거·상세 저장 수 재조회. discard는 업로드 실패 때문에 막지 말고 해당 세션 큐 폐기 후 서버 discard. 계정 전환 때 이전 사용자 큐/타이머/사진/통계를 초기화한다.

앱 재실행: getMy.activeSession → getRunDetail → 해당 UID 대기 큐 복원 → 위치 감시 재시작. 새로 시작하는 API를 호출하지 않는다. 여러 기기의 동시 제어/지연 응답은 서버 상태를 재조회해 맞춘다. 노출 response를 로컬 저장하고 session.alertId에 연결, 완료 기록에서 exposures 복원. OS 배너·진동·잠금 화면 GPS는 네이티브 구현 책임.

## 5. 사진과 현장 참여 (9개: 조회2 + 변경7)

사진 조회는 본인(관리자는 getPhotoAccess 가능), 참여/촬영 변경은 본인+현재 동의 필요.

| 함수 | 입력 | 정상 응답 |
|---|---|---|
| issueCaptureTicket | `{purpose,loc,targetId?,categoryCode?}` | `{ok:true,ticketId,expiresAt,uploadPath}` |
| sealCapture | `{ticketId,loc}` | `{ok:true,capturedAt}` |
| getPhotoStatus | `{ticketId}` | `{status:'AWAITING_UPLOAD'|'READY'|'FAILED'|'DELETE_PENDING'}` |
| getPhotoAccess | `{photoId}` | `{url,expiresInSec:300}` |
| submitQuick | `{issueId,loc,exposureId?}` | `{ok,saved,existing?,resultId,pointsAwarded,pointsPending?,rewardReason,...}` |
| submitPhotoRecheck | `{issueId,ticketId,exposureId?}` | 참여 결과(+late?/welcomeCounted?/verificationLevel?) |
| createIssue | `{categoryCode,modality:'QUICK'|'PHOTO',pin,loc?,ticketId?,resolution?,reason?}` | `{ok,saved,created?,resultId,pointsAwarded,pointsPending?,rewardReason,...}` |
| addDiscoveryPhoto | `{issueId,ticketId,exposureId?}` | 참여 결과(+rewardQualificationEndsAt?) |
| submitRoutine | `{missionId,ticketId,exposureId?}` | 참여 결과(+welcomeCounted?/roundEndsAt?) |

purpose=DISCOVERY(새 제보,categoryCode 필수), RECHECK(기존 제보,targetId 필수), DISCOVERY_PHOTO(내 새 제보 보완,targetId 필수), ROUTINE(정기 관찰,targetId 필수). categoryCode는 getPilotData.categories의 키(FOAM/LITTER 등); 한글 표시명/객체 상속 이름을 코드로 보내지 않는다.

사진 흐름:
1. 실제 위치 확인 후 촬영 티켓 발급(15분).
2. 카메라 셔터 직후 sealCapture. loc와 해당 요청 ID를 고정. 실패했다면 같은 seal 요청 재시도. **재촬영은 새 티켓**을 사용한다.
3. 발급 uploadPath에 JPEG≤5MiB, contentType=image/jpeg 업로드. 소유자+sealed ticket만 허용. 덮어쓰기 불가.
4. getPhotoStatus READY까지 대기. AWAITING_UPLOAD에는 미업로드/처리 대기 모두 포함, 일정 시간 후 재확인. FAILED이면 새 촬영 흐름으로 안내. DELETE_PENDING은 재사용 금지. 업로드 응답을 잃으면 먼저 status 조회, 바로 덮어쓰지 않는다.
5. 제출 API에 **ticketId**를 전송. data URL·로컬 경로·ticket 객체를 보내지 않는다. PHOTO의 촬영 위치는 서버 ticket에서 읽으므로 제출 loc 생략 가능.
6. 접수 확인 전 로컬 사진을 지우지 않는다. 개인 이력 이미지는 getPhotoAccess URL(5분)로 표시하고 만료 시 갱신. 타인 사진은 공개 표시하지 않는다.

createIssue QUICK은 loc 필수, PHOTO는 ticketId 필수. pin=[lat,lng]; 같은 PATH/CORRIDOR와 실제 loc/촬영위치에서 50m 이내 확인. resolution={action:'CREATE_NEW'|'ATTACH_EXISTING',issueId?}. 중복: `{ok:false,errorCode:'DUPLICATE_CANDIDATES',details:{candidates:[issueId]}}`. candidates 제목을 안전하게 조회해서 보여주고, resolution을 바꾼 요청은 새 ID 사용. CREATE_NEW를 명시하면 reason(1~200자)이 필수다. ATTACH_EXISTING은 같은 종류·pin에서30m 이내·동일 Scope의 공개 대상만 허용. 없어진 후보는 목록 재조회. resultId는 신규 생성 시 Issue ID, 기존 관찰 접수 시 Observation ID이므로 created 여부를 확인한다.

포인트: 간단 재확인1P, 사진5P, 신규 PHOTO는 검토 대기. 일일/주간 상한·재참여/늦은사진/종류 조건으로 0P일 수 있음. UI에서 직접 잔액이나 지급액을 더하지 말고 응답 rewardReason/points와 getMy/getLedger 재조회 사용. 관찰 접수는 기관 자동 신고가 아니다.

## 6. 혜택·기여 변경 (4개)

본인+현재 동의 필요.

| 함수 | 입력 | 정상 응답 |
|---|---|---|
| claimWelcome | `{}` | `{ok:true,couponId}` |
| requestCouponUse | `{couponId}` | `{ok:true,useSessionId,expiresAt}` |
| confirmCouponUse | `{couponId,useSessionId,pin}` (6자리 문자열) | `{ok:true,usedAt}` |
| withdrawContribution | `{observationId}` | `{ok:true}` |

claim은 기여3회·운영자 승인·재고·제휴처 등록 필요. REWARD_NOT_CONFIGURED/REWARD_SOLD_OUT/혜택 조건 오류면 발급 성공 UI 금지. 포인트 교환 상품은 현재 없음.

requestCouponUse는 10분 사용창; 재호출해도 연장되지 않고 쿠폰 만료보다 길어지지 않는다. 응답 expiresAt은 **사용창** 끝이며 Coupon.expiresAt(쿠폰 자체 만료)과 구분. confirm에 현재 window.useSessionId 포함. 직원 PIN은 숫자 변환하지 않는다(앞자리0 유지). 클라이언트에 정답 PIN/해시 없음. 틀린 PIN·잠금·점포 제한은 서버 판단(쿠폰5회 실패시10분 잠금, 사용자·점포·KST일 기준10회 실패 제한, 같은 점포 쿠폰 사용 하루1회). 화면 COUNTDOWN은 서버 응답 시각 기준이며 로컬 0초만으로 USED 처리 금지.

withdraw는 본인 관찰 숨김+포인트 회수+기여 수 갱신+사진 삭제 예약. 같은 요청 ID 재시도 가능. 자체 UI 없으면 임의로 직접 Firestore 삭제하지 않는다.

## 7. 운영자 변경 (6개)

본인+admin===true, 현재 일반 사용자 동의는 필요하지 않음. 모두 requestId 필요.

| 함수 | 입력 | 정상 응답 |
|---|---|---|
| adminDecision | `{issueId,decision:'APPROVE'|'REJECT'|'HIDE'|'APPROVE_WELCOME'}` | `{ok:true}` |
| approveWelcome | `{userId}` | `{ok:true}` |
| configureMerchant | `{id,name,pin,isDemo?,catalog?:{stock,title,condition,validDays}}` | `{ok:true}` |
| configurePilot | `{paths,courses?,facilities?,routines?,news?}` | `{ok:true}` |
| upsertNews | `{id,title,body,sourceUrl?,type?}` | `{ok:true,id}` |
| setNewsPublished | `{id,published:boolean}` | `{ok:true,id}` |

adminDecision APPROVE는 공개 OPEN 제보만; REJECT 신규 제보 지급/기여 무효화, HIDE 공개 숨김. 승인 대상은 getAdminQueue에서 조회. approveWelcome은 PENDING_ADMIN 사용자만. 역할은 서버에서 명시적으로 UID에 부여, 일반 앱이 역할을 요청/설정하는 API 없음.

configureMerchant: PIN 6자리, stock 정수0~100000, validDays1~365. isDemo 생략=true, 실제 제휴처는 false. catalog 포함 시 단일 WELCOME_500 갱신; merchantId는 id로 연결. 같은 request retry는 재고 되돌리지 않지만 **새 설정 요청은 재고를 지정 수량으로 바꾸므로 주의**. 정답 PIN은 DB 평문 저장하지 않으며 응답하지 않는다.

configurePilot: paths 필수(배열≤200), 각각 `{id,corridorId,points:[lat,lng][]}` 최소2/최대2000점, ID 중복 금지. 나머지 제공한 배열은 해당 컬렉션 전체 대체(누락한 컬렉션은 유지); 각 ≤200행/ID 중복 금지.
- courses: `{id,name,out:[lat,lng][],modes:('RUN'|'WALK')[],...}` out2~2000점, 이름≤100자. 최신 화면에는 start/turn/bank/distanceLabel 등의 표시 metadata도 원본 시안과 같이 전달.
- facilities: `{id,name,type,lat,lng,...}` 이름≤100자,type≤80자, 위·경도 유효 범위.
- routines: `{id,name,anchors:[lat,lng][],roundHours?,enabled:boolean,...}` anchors1~100, roundHours 기본6/1~24 정수/24의 약수. 기존 rounds는 서버 보존.
- news: 기존 시안 데이터 형식; 신규 운영 소식은 upsertNews 사용 권장. paths만 갱신해도 전송 코스와 위치 범위를 함께 검수.

upsertNews: id≤80/title≤160/body≤10000/type≤40자(기본NOTICE), sourceUrl은 http(s)만 허용하며 생략하면 기존 링크 유지, null이면 제거한다. 저장 시 기존 공개 상태 보존, 신규는 초안. 공개/비공개는 setNewsPublished 별도 호출. 첫 공개시 publishedAt 기록. URL에 credentials 또는 javascript: 금지.

## 8. 오류와 재시도

SDK throw: `error.code='functions/unauthenticated'|'permission-denied'|'not-found'|'failed-precondition'|'internal'...`, `error.message=도메인 코드`, `error.details=부가 객체`. 도메인 거절은 성공 HTTP 안의 `{ok:false,errorCode,details}`로도 반환되므로 **둘 다 처리**한다. 권한 도메인 PERMISSION_DENIED는 permission-denied, 인증 UNAUTHENTICATED는 unauthenticated, 나머지 검증은 대체로 failed-precondition. 예상치 못한 서버 오류는 SERVER_ERROR.

| 코드/상황 | 프론트 처리 |
|---|---|
| UNAUTHENTICATED, App Check 실패 | 로그인/토큰·App Check 확인; 정상 토큰 없이는 반복 제출하지 않음 |
| CONSENT_REQUIRED | 현재 약관 동의 화면, 완료 뒤 원래 작업 복귀 |
| PRECISE_LOCATION_REQUIRED/GPS_ACCURACY_TOO_LOW/LOCATION_STALE | 실제 위치 재측정; 촬영 요청 payload는 재촬영/새 작업 필요 여부 확인 |
| OUTSIDE_PILOT/AMBIGUOUS_LOCATION/WRONG_SCOPE | 안전한 둑·파일럿 범위 안내, 입력 위치·대상 재검토 |
| ACTIVE_SESSION_EXISTS | getMy→getRunDetail, 기존 운동 복구 |
| COURSE_MODE_NOT_SUPPORTED | 해당 코스 modes에서 운동 종류 다시 선택 |
| INVALID_STATE/SESSION_EXPIRED/OUT_OF_ORDER/PAUSED_SAMPLE | 서버 상태·큐 순서 확인; 새 ID로 같은 불가능 요청 반복 금지 |
| TRACK_NOT_SYNCED | details.storedCount 확인, 대기 청크 처리 후 종료 재시도 |
| SESSION_TRACK_LIMIT | 수집 정지, 저장·종료 안내 (5,000점) |
| PHOTO_NOT_READY/PHOTO_REQUIRED/INVALID_TICKET/CAPTURE_TICKET_EXPIRED | 티켓·seal·상태 확인, 필요한 경우 재촬영 |
| DUPLICATE_CANDIDATES | 후보 선택/새 제보 선택, 변경 payload에는 새 ID |
| COUPON_LOCKED/COUPON_EXPIRED/COUPON_UNAVAILABLE/INVALID_MERCHANT_PIN/USE_WINDOW_EXPIRED/MERCHANT_DAILY_LIMIT | 서버 반환 잠금/만료/사용 상태 표시; 잘못된 PIN 무한 재시도 금지 |
| ACCOUNT_DELETING | 삭제 처리 중, 상세 조회를 계속 시도하지 않음 |
| INVALID_CURSOR | 해당 목록 첫 페이지부터 다시 로드 |
| REQUEST_CONFLICT | 동일 ID에 payload가 바뀌는 클라이언트 버그 확인 |
| unavailable/deadline-exceeded/network/internal | 결과 모호; 동일 ID·payload 재시도, 저장 성공 후 refresh 실패와 구분 |

네트워크 오류를 임의 '포인트 없음/미저장'으로 확정하지 않는다. 서버 오류 details에 없는 필드를 가정하지 않는다. 특정 errorCode에 사용자 문구가 없으면 일반 재확인 문구 사용.

## 9. 테스트 및 현재 한계

Emulator: demo-uirun / Auth9099 / Functions5001 / Firestore8080 / Storage9199. 웹 localhost `?emulator=1`만 테스트 anonymous 허용; 실제 배포는 Google 로그인. Android Emulator 호스트10.0.2.2, iOS Simulator127.0.0.1, 실기기는 개발 머신LAN 주소. 로컬 App Check 강제 해제는 Emulator 함수에서만 적용, 운영 우회 금지.

시안 코스·시설·경로는 현장 검수 전, 경로 metadata APPROXIMATE_PROTOTYPE(실측 아님). 제휴처/실제 재고 미등록. 실제 GPS·카메라·잠금 추적·네이티브 푸시는 실기기 검증 필요. Firestore 저장 계층은 파일럿 전체 상태 조회/전역 revision 사용으로 대규모 트래픽 최적화 미완료. App Check는 GPS 진위 증명이 아님. 서비스 운영 약관·개인정보 문안은 출시 전 확정한다.


기능 검증 화면과 재실행 방법은 `backend/verification/README.md`, 실행 결과는 `docs/api/FUNCTIONAL-VERIFICATION.md`를 참조한다. getPhotoAccess는 로컬 demo-uirun에서만 만료 토큰 기반 이미지 경로로 에뮬레이션하며, 운영에서는 기존 IAM signed URL을 사용한다.

## 10. 수정본 1번 확장 (2026-10-05)

Callable은 기존47개에 아래2개를 더해 총49개다. 기존 입력/응답은 유지하며 추가 필드는 선택값이다.

| 함수 | 권한 | 입력 | 응답 |
|---|---|---|---|
| setPhotoPublication | admin / 동의 불필요 | `{photoId,published:boolean,privacyReviewed?:true,redactions?:[{x,y,width,height}],clientRequestId}` | `{ok:true,photoId,published}` |
| getPublicPhotoAccess | 공개 / App Check 필수 | `{photoId}` | `{id,url,expiresInSec:300,takenAt,acceptedAt,publishedAt}` |

공개사진: published=true는 privacyReviewed=true가 필수다. 운영자가 원본을 직접 보고 식별 요소가 없거나 모든 필요한 영역을 가렸는지 확인한다. redactions는 원본을 회전/최대960px로 축소한 결과의 정규화 좌표(0~1), width/height>0, 이미지 경계 안, 최대50개. 지정 영역을 불투명색으로 가린 JPEG 공개 사본을 만들며 metadata를 제거한다. 자동 얼굴 탐지·비식별 검증 완료를 뜻하지 않는다. 공개된 제보에 첨부된 유효한 READY 사진만 가능하고, 공개 Issue DTO.publicPhoto는 `{id,takenAt,acceptedAt,publishedAt}|null`이다. URL/Storage경로/타인UID는 DTO에 없음. 공개 사본은 별도 getPublicPhotoAccess로 조회한다. 원본 getPhotoAccess는 본인/admin 그대로 유지한다.

공개 해제·제보 숨김·기여 철회·탈퇴·90일 사진 보관 만료는 신규 공개 접근을 차단한다. 해제 시 사본 삭제 시도, 실패한 삭제는 정기 작업에서 재시도한다. 이미 발급한 운영 signed URL은 최대5분 동안 남을 수 있다. URL 만료 후 새로 조회한다. 정책 오류 PRIVACY_REVIEW_REQUIRED/NOT_FOUND/PERMISSION_DENIED는 실제 상태에 맞게 표시한다.

뉴스 upsertNews 선택 필드: `topic:'eco'|'proposal'|'plan'`, `status`(80자), `kind:'official'|'council'|'press'|'citizen'`, `source`(160자), `date`(실제 달력 YYYY-MM-DD), `dateKind`(40자), `pub`(실제 달력 YYYY-MM-DD), `pubKind`(40자), `checked`(실제 달력 YYYY-MM-DD), `event`(200자), `summary`(2000자). 생략하면 기존 metadata 유지, null이면 지운다. type/body/sourceUrl 기존 입력도 계속 지원한다. date는 원자료 날짜, publishedAt은 앱 게시 epoch ms라 구분한다.

날씨 forecast.current.apparent_temperature 체감온도 추가. 항목 없는 구버전 캐시는 갱신하며 공급자 실패 시 기존 stale 응답을 유지한다. 값이 없는 stale/실패에는 빈 상태를 표시한다.

appendTrack 선택 입력 `altitudeAccuracyM`(0~10000, 없으면 null), 응답 TrackPoint에도 보존. metrics 추가 `elevationGainM:number|null`, `elevationUnavailableReason:null|'INSUFFICIENT_ALTITUDE_DATA'|'LOW_ALTITUDE_ACCURACY'|'NO_VALID_SEGMENTS'`. 최소10개의 저장 GPS 점과 유효 구간 양 끝의 고도 및 정확도≤15m가 필요하다. 정지·불량GPS·단절·비정상 속도 구간은 잇지 않는다. 유효 상승분만 합산하고 미확보이면 null; 0과 null을 구분한다.

참여 제출 createIssue/submitQuick/submitPhotoRecheck/addDiscoveryPhoto/submitRoutine에 선택 `sessionId`. 서버가 본인 세션과 관찰 시각의 세션 범위를 확인하며 타인 세션 NOT_FOUND, 범위 밖 OUTSIDE_SESSION, 노출과 서로 다른 세션 WRONG_SESSION. exposureId가 있으면 서버 exposure.sessionId로 자동 연결. 사진은 셔터 시각 기준, 간단 제보/응답은 접수 시각 기준이다. DISCARDED 세션에 새 참여 연결 금지. 기존 요청은 sessionId 생략 가능하며 시간만으로 과거 참여를 임의 연결하지 않는다.

getMy 추가 `participationStats:{total,report,recheck,routine,recheckPhoto,recheckQuick,photo}`. 페이지 제한과 무관한 전체 본인 합계이며 숨김/늦은사진/보완사진 중복은 제외한다. getRunDetail도 같은 participationStats와 해당 세션의 `participations:Page<Observation>`를 반환한다. 상세에 limit/cursor 선택값으로 참여 목록만 페이지 이동하며 track/metrics는 전체다. Observation의 sessionId는 서버 확인된 경우에만 존재한다.

공개 사본 경로는 관리자 UID와 요청 전체의 해시를 포함하며, Storage의 생성 전용 조건으로 덮어쓰기를 방지한다. 동시 요청 충돌로 연결되지 않은 사본은 해당 사진 기록이 삭제된 뒤, 파일 생성으로부터 최소 1시간 경과한 경우 정리 스케줄에서 삭제한다. 사진 기록이 남아 있는 동안에는 재시도와 삭제의 충돌을 방지하기 위해 그 사진의 사본 경로를 보호한다. 동일 요청의 진행 중 사본을 지우지 않기 위해 실패 직후에는 삭제하지 않는다.

웹 연결 화면은 미전송 GPS 요청을 계정별 localStorage에 보관하고 같은 요청 ID로 재전송한다. 로그아웃·계정 전환 시 지우며 저장소 접근 실패는 운동 화면에 표시한다. 탭을 다시 열면 getMy.activeSession → getRunDetail로 서버 기록과 대기 요청을 복구한다.

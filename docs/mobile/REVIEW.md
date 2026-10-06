# 모바일 연결 관점의 백엔드 검토 메모

작성 2026-10-05, 갱신 2026-10-06. 모바일 작업 중 코드를 읽고 확인한 내용이다. 49개 Callable 이름은 바꾸지 않았고, 아래 ‘이번에 바꾼 서버 코드’만 호환 확장했다. 저장 구조 재설계는 범위 밖이며, 나머지는 담당자가 판단할 항목이다.

## 이번에 바꾼 서버 코드(팀원 전달용, 2026-10-06)

| 변경 | 파일 | 호환 | 테스트 |
|---|---|---|---|
| finishRun·discardRun 선택 입력 `occurredAt`: ACTIVE면 마지막 재개·마지막 위치점 이후, PAUSED면 일시정지 시작 이후 ~ 서버 현재 시각 + 2초(GPS와 같은 시계 오차). 그 시각으로 activeMs·endedAt 계산(PAUSED 종료는 일시정지 구간을 그 시각에 닫음). COMPLETED/RECOVERED 판정은 서버 수신 시각 그대로 | `functions/src/service.js` | 생략하면 기존 동작 | `test/mobile-run.test.js`(1분 운동·10분 뒤 도착, 일시정지 중 늦은 종료, 같은 ID 재시도·다른 내용 REQUEST_CONFLICT, 범위 밖 거절) |
| `getRecords.participations`·`getRunDetail.participations` 행에 `categoryCode`(관찰의 공개 종류) 추가 | `service.js` | 필드 추가만 | `mobile-run.test.js` |
| Emulator 사진 URL 호스트를 요청 Host 헤더(형식 검사)로: A-1 해결 | `local-photo.js`, `index.js`, `photo-callables.js` | `demo-uirun` Emulator 분기에서만. 운영 signed URL 무관 | `mobile-run.test.js` |
| `scripts/seed-test-news.cjs` 추가: 로컬 Emulator에만 [테스트] 소식 3건(고정 ID) upsertNews·setNewsPublished | `backend/scripts` | 원격·비 demo 프로젝트면 실행 거절 | `mobile-run.test.js`(게시분만 getRiverFeed, 재실행 시 중복 없음) |

FRONTEND.md §4(occurredAt)·§2(categoryCode)에 반영했다. 실행 결과는 [FUNCTIONAL-VERIFICATION.md](../api/FUNCTIONAL-VERIFICATION.md).

## A. 수정이 필요한 문제

### A-1. Emulator 사진 URL이 `127.0.0.1`로 고정되어 Android에서 열리지 않음 — 2026-10-06 해결(요청 Host 사용, Emulator 분기 한정)

- 재현: Emulator 대상 앱에서 사진이 있는 관찰을 만든 뒤 `getPhotoAccess({photoId})` 또는 공개 사본 `getPublicPhotoAccess({photoId})` 호출.
- 기대: 앱이 받은 `url`을 기기에서 그대로 열 수 있다.
- 실제: `http://127.0.0.1:5001/demo-uirun/asia-northeast3/localPhoto?token=…`(`functions/src/index.js` getPhotoAccess, `functions/src/photo-callables.js` access). Android Emulator에서 `127.0.0.1`은 기기 자신이라 열리지 않는다(PC는 `10.0.2.2`, 실기기는 PC의 LAN 주소).
- 영향 화면: 다음 단계의 기록 › 환경 참여 사진, 관찰 상세의 공개 사진(로컬 Emulator 시험만). 운영 signed URL에는 영향 없다.
- 제안: Emulator(`demo-uirun`)일 때만 호스트를 환경변수(예: `LOCAL_PHOTO_HOST`)로 바꿀 수 있게 하거나 요청의 Host 헤더를 쓴다. 앱이 받은 URL의 호스트를 임의로 바꾸지 않는다(운영 URL 오염 방지). 이번 1차는 사진을 다루지 않아 앱 쪽 우회도 넣지 않았다.

### A-2. 문서 링크 누락 — 이번에 수정

`docs/api/FRONTEND.md` §9가 가리키던 `docs/api/FUNCTIONAL-VERIFICATION.md`가 저장소에 없었다. 이번 로컬 실행 결과로 새로 작성하고 링크를 유지했다.

### A-3. 오프라인 뒤 늦게 도착한 일시정지·재개·종료 — 호환 확장(종료·폐기는 2026-10-06 추가)

- 문제: `pauseRun`·`resumeRun`이 서버 수신 시각만 썼다. 오프라인에서 누른 일시정지를 10분 뒤 보내면 그 10분이 활동 시간에 더해졌다.
- 변경: 선택 입력 `occurredAt`(epoch ms). pause는 마지막 재개·마지막 저장 위치점 이후, resume은 일시정지 시작 이후, 둘 다 서버 현재 시각 + 2초까지 허용(GPS와 같은 시계 오차). 생략하면 기존 동작이라 기존 웹·클라이언트와 호환된다. 테스트 `functions/test/mobile-run.test.js`, 명세 FRONTEND.md §4.
- 남는 점: 기기 시계를 믿는 값이라 활동 시간 표시에만 쓰이고 보상 판단에는 쓰이지 않는다. 시계가 크게 틀린 기기는 INVALID_ARGUMENT로 일시정지가 거절될 수 있다(앱은 서버 상태와 다르다고 표시).

### A-4. Storage 보안 규칙과 단순 업로드

Storage 규칙의 `request.resource.contentType == 'image/jpeg'`는 메타데이터에 contentType이 있는 multipart·SDK 업로드에서만 통과한다. Storage Emulator에 본문만 보내는 단순 업로드는 403이 된다(2026-10-06 재현). 앱은 multipart로 올린다. 규칙 변경은 필요 없다.

## B. 확인이 필요한 구조·성능

1. **Store가 매 호출마다 전체 상태를 읽는다.** `functions/src/store.js`의 `load()`는 조회·변경마다 `internalTables`의 모든 테이블 문서를 트랜잭션으로 읽는다. 사용자·관찰·운동 기록이 늘면 `getHome` 같은 공개 조회도 전체 데이터 크기에 비례해 느려지고 읽기 비용이 커진다.
2. **동시 변경 충돌.** 모든 변경이 같은 문서 집합을 읽는 트랜잭션이라, 여러 계정이 동시에 저장하면 서로 충돌해 재시도가 늘어난다. 한 트랜잭션 쓰기 450건 제한(`PILOT_TRANSACTION_LIMIT`)도 있다. 다계정 동시 사용 부하 시험이 필요하다.
3. **운동 GPS.** (앱 구현: 20점 또는 20초마다 묶음, 요청당 최대 50점, 계정·세션별 파일 큐 — mobile/README.md ‘운동 기록 수집·전송 기준’) 요청당 1~100점, 세션 최대 5,000점이다. 1초 간격이면 약 83분에 한도에 닿는다. 앱은 거리(예: 5~10m)·시간(예: 3~5초) 기준으로 표본을 줄이고, 10~20점 또는 15~30초마다 묶어 보내야 한다. 사용자·세션별 영구 큐에 같은 `clientRequestId`로 보관하고, 일시정지·종료 전에 큐를 비운 뒤 `expectedTrackCount`를 보낸다. 서버의 요청 기록(receipts)은 30일 뒤 지워지므로(`lifecycle.js`) 큐 보관 기간은 그보다 훨씬 짧아야 한다(현재 6시간 뒤 append 불가 규칙과 맞춘다). 빈번한 append가 B-1·B-2 구조에서 감당되는지 확인이 필요하다.
4. **`getHome` 응답 크기.** 홈 코스만 필요한데 `pilot`(전체 경로 geometry)과 정책 상수 전체를 매번 받는다. 지금 시안 데이터(경로 146점)에서는 작지만, 현장 경로가 늘면 모바일 데이터 사용이 커진다. 필요하면 별도 경량 필드나 캐시 정책을 검토한다.
5. **공개 사진.** 앱은 관리자가 검토해 공개한 사본(`getPublicPhotoAccess`)만 공개 화면에 쓴다. 다른 사용자의 원본(`getPhotoAccess`)은 본인·관리자만 받을 수 있고 앱도 공개 화면에 쓰지 않는다.
6. **보존 정책.** 현재 서버는 사진 원본 90일 뒤 삭제 대기, 운동 원시 경로(`track`) 90일 뒤 비움(거리·시간 요약은 유지), 촬영 티켓 90일, 요청 기록 30일이다(`lifecycle.js` retentionBatch). 기획서의 개인 운동 기록 보존 기간·12개월 그래프와 맞는지, 동의 문안에 무엇을 적을지 확정이 필요하다. 앱 약관 화면은 "출시 전 확정"으로만 적었다.
7. **환경 데이터 내보내기(Export) API**는 없다. 기관 전달·내보내기는 후속 검토 대상이며 앱에서 완료된 기능처럼 표시하지 않는다.
8. **해결 상태.** DTO의 `lifecycleStatus`에 `RESOLVED` 값이 있지만 이를 설정하는 API는 없다. 현재 기획에서 사용자 ‘해결 확인’ 기능은 구현하지 않는다.

## C. 로컬 검증 환경 메모(Windows)

- Git Bash에서 `npm run test:integration`을 실행하면 Firestore Emulator가 Windows 콘솔 종료 신호(0xC000013A)로 중간에 끝났다. PowerShell에서는 끝까지 통과했다.
- 두 경우 모두 실행이 끝난 뒤에도 Firestore Emulator의 `java.exe`가 8080 포트에 남았다. 남은 Emulator에 다음 실행이 붙으면 이전 데이터 때문에 규칙 테스트 2개가 실패한다(이번에 실제로 겪음). 다시 실행하기 전에 8080 포트의 남은 `java.exe`를 종료한다. 백엔드 코드 문제는 아니다.
  ```powershell
  Get-NetTCPConnection -LocalPort 8080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
  ```

## D. 앱이 지키는 계약(1차 구현 기준)

- 변경 API는 `clientRequestId`를 작업마다 한 번 만들고, 결과가 모호한 실패에서만 같은 ID·같은 내용으로 재시도한다. 내용이 바뀌면 새 ID.
- SDK 오류(`code`/`message`/`details`)와 정상 응답 안의 `{ok:false,errorCode}`를 모두 실패로 처리한다.
- 변경 성공 뒤 조회 갱신 실패는 저장 실패로 보지 않고 조회만 다시 한다.
- 계정 전환 시 개인 조회 캐시·미확정 요청 ID·진행 중 응답 반영을 버린다. 운동 큐(`run-<uid>-<sessionId>.json`)와 사진 작업(`photos-<uid>.json`)은 계정별 파일로 남겨 두고(지우지 않음) 다른 계정 인증으로 보내지 않는다. 로그아웃 직전에는 위치 수집을 멈추고 묶지 않은 점까지 저장한다.
- 이름은 `updateProfile`로만 바꾸며 로그인 때 Google 이름으로 채우지 않는다. 알림 선호(`repeatObservationNotifications`) 저장은 OS 알림 권한이 아니다.

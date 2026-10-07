# 동시 운동 저장 측정

2026-10-07 KST. 격리된 demo-uirun Emulator, Mac, Node 22, Java 17. 운영 서버에는 부하를 보내지 않았다.

## 결과

| 계정 수 | 완료 | 논리 요청 | 실패 요청 | 클라이언트 재시도 | p50 | p95 |
|---|---|---|---|---|---|---|
| 1 | 1/1 | 12 | 0 | 0 | 703ms | 1252ms |
| 5 | 5/5 | 60 | 0 | 0 | 27ms | 4161ms |
| 10 | 5/10 | 71 | 5 | 29 | 47ms | 72558ms |

요청: 계정별 동의·운동 시작·홈 조회·GPS 3묶음·종료 동일 ID 재전송·상세·기록 목록. 완료 계정은 GPS 3점, COMPLETED 상태, 목록의 운동 1건을 검증했다. 요청 시간은 재시도 대기를 포함하며 샘플은 작다. 1계정에는 Functions 최초 실행 비용이 포함된다. 실패한 계정의 상태가 모두 정리됐다는 의미는 아니다.

10계정에서 SERVER_ERROR 4건과 LOCATION_STALE 1건으로 실패했다. Functions 로그에 `ABORTED: Transaction lock timeout`이 반복됐다. 위치가 포함된 요청은 동일 내용·동일 ID로 재시도하므로 대기가 길어지면 위치 신선도 검사에서도 거절될 수 있다. Firestore 내부 트랜잭션 재시도 수는 SDK가 노출하지 않아 위 표에는 포함하지 않았다.

## 판단과 다음 서버 작업

`functions/src/store.js`는 변경마다 모든 테이블을 읽고 `internal/meta`를 쓰므로 서로 다른 계정의 변경도 충돌한다. 단위·API 계약 테스트 통과와 동시 사용 성능은 다른 결과다. 이번 측정으로 동시 사용 통과를 선언할 수 없다.

별도 서버 변경에서는 운동·계정 단위로 읽기/쓰기 범위를 줄이는 것이 우선이다. 전역 순번·메타 데이터와 운동 GPS 변경을 분리하고, receipts의 동일 ID 재시도와 보상·계정 삭제 규칙을 유지해야 한다. 순서는 저장 계약 테스트 → 세션 저장 경로 분리 → 동일 1/5/10 계정 재측정이다. 단순 타임아웃 연장이나 위치 신선도 완화로 감추지 않는다. 저장 구조 변경은 이번 모바일 표시 변경과 분리한다.

Emulator 결과는 실제 Firestore 지연·운영 수용량을 보장하지 않는다.

## 재실행

전용 체크아웃의 로컬 Emulator에서만 실행한다. 테스트가 `configurePilot`으로 테스트 경로를 등록하므로 다른 사람의 Emulator에 연결하지 않는다. 스크립트는 계정을 생성하고 자신의 Auth 계정만 종료 시 삭제한다. 로컬 Firestore 기록은 전용 Emulator 종료로 폐기한다.

```sh
npm run test:load-core
# 아래 env는 모두 전용 로컬 Emulator 주소와 일치하도록 설정
GCLOUD_PROJECT=demo-uirun \
UIRUN_LOAD_CONFIRM=isolated-demo \
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:19099 \
UIRUN_FUNCTIONS_EMULATOR_HOST=127.0.0.1:15001 \
node verification/load.cjs
```

`backend`에서 실행한다. Firebase CLI의 emulators:exec 안에서 실행하면 Firestore/Auth env가 설정된다. 프로젝트·로컬 주소·격리 확인 중 하나라도 없으면 Admin SDK 초기화 전에 거절한다. 실패가 있으면 종료 코드 1이며 결과는 Git 제외 `output/uirun-load-verification.json`에 남는다. 안전장치·통계·동일 요청 재시도 테스트는 백엔드 CI에서 실행한다.

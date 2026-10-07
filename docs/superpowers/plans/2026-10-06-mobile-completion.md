# 모바일 기능 완성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 머지된 Android 앱의 운동 시작·지도·화면을 완성하고, 마지막에 실기기 전체 흐름을 검증한다.

**Architecture:** 기존 Expo Router 화면과 운동 큐·Callable 계약을 유지한다. 운동 준비 상태와 지도 표시용 계산은 별도 모듈로 분리하고, 서버 성능 개선은 측정 결과에 따라 독립 작업으로 결정한다.

**Tech Stack:** Expo 57, React Native 0.86, TypeScript, React Native Firebase, react-native-maps, Node.js 테스트, Firebase Emulator.

**Spec:** 이 문서의 범위·완료 기준 및 `docs/mobile/STATUS.md`, `docs/mobile/CONNECTION-STATUS.md`. 이 계획의 새로운 UX 값은 구현 전 검토할 제안이다.

## Global Constraints

- 기준 브랜치: PR #1이 머지된 main. 실제 구현 시작 시 최신 main에서 작업 브랜치를 만든다.
- 기존 운동 파일 큐·계정 격리·서버 보상 판단·App Check를 유지한다.
- Google Maps 및 Firebase 설정 파일은 Git 제외 상태로 유지한다.
- 실기기 부재는 아래 개발 작업을 막지 않는다. 자동 검증과 기기 검증을 구분해 기록한다.
- 제휴 상품·약관 내용을 임의로 만들지 않는다. iOS·기관 내보내기·해결 확인은 이번 범위에서 제외한다.
- 지도·화면 변경은 기존 디자인을 따른다. 새 라이브러리는 필요성을 확인한 뒤 추가한다.

## Review Focus

- 운동 준비 취소·연타·계정 변경 시 불필요한 서버 세션이 생기지 않아야 한다.
- 카운트다운 중 위치가 오래되면 새 위치 확인 없이 시작하지 않아야 한다.
- 지도는 비어 있는 경로·한 점·끊긴 구간을 안전하게 표시해야 한다.
- 관찰 핀을 묶어도 상세 진입과 이어 받기가 유지되어야 한다.
- 데이터가 없거나 요청이 실패해도 안내가 저장 완료·실제 혜택으로 오해되지 않아야 한다.

## 작업 1: 안내·상태 정리

**Files:** `mobile/src/app/info.tsx`, `docs/mobile/STATUS.md`, `docs/mobile/CONNECTION-STATUS.md`, `docs/mobile/ANDROID-TEAM-TEST.md`.

- [x] 정보 화면의 초기 미연결 문구를 현재 구현 상태로 수정한다.
- [x] Firebase·지도 설정 대기를 완료 상태로 정리한다. 네이티브 실기기 검증은 미검증으로 유지한다.
- [x] PR 머지 보류·옛 브랜치 테스트 안내를 main 기준 안내로 수정한다.
- [x] `mobile`에서 `npm run typecheck`, `npm run lint`, `git diff --check`를 실행하고 문구를 검토한다.
- [x] 독립 커밋으로 저장한다. 문구 자체를 그대로 검사하는 테스트는 추가하지 않는다.

**완료 기준:** 앱과 문서에서 구현·설정·실기기 검증 상태가 일치한다.

## 작업 2: 운동 시작 준비

**Files:** 시작 버튼이 있는 `mobile/src/app/(tabs)/index.tsx`, `mobile/src/run.ts`, `mobile/src/location.ts`; 새 `mobile/src/app/run-ready.tsx`, `mobile/src/run-ready.ts`, `mobile/src/run-ready.test.ts`; `mobile/package.json` 테스트 목록.

**동작 제안:** 위치 확인 → 준비 완료 → 3초 카운트다운 → 운동 세션 생성. 기존 위치 조건(정확도 30m 이내·최근 10초)을 사용한다. 준비 중에는 서버 세션을 만들지 않는다. 위치 대기는 20초 후 재시도 안내를 보여준다. 구간 허용 판단은 서버 계약을 유지한다.

- [x] 실제 시작 진입부와 서버 startRun 검증 조건을 확인하고 중복 위치 요청을 피하도록 연결을 정한다.
- [x] 취소·연타·오래된 위치·권한 거절·계정 변경·시작 실패에 대한 상태 전이 테스트를 작성해 실패를 확인한다.
- [x] 준비 상태 모듈과 준비 화면을 구현한다. 취소하면 대기·타이머를 정리하며, 시작 중 중복 호출을 막는다.
- [x] 카운트다운 완료 시 위치 신선도를 재확인하고 기존 startRun 흐름에 연결한다. 서버가 거절하면 준비 화면에서 원인·재시도를 안내한다.
- [x] `npm test`, `npm run typecheck`, `npm run lint`를 통과시키고 변경 커밋을 만든다.

**완료 기준:** 실패·취소 시 세션이 남지 않고, 유효한 위치에서 한 번만 시작한다.

## 작업 3: 운동 결과 지도

**Files:** `mobile/src/routemap.tsx`, `mobile/src/app/record/[id].tsx`; 새 경로 분할 계산 모듈과 대응 테스트.

- [x] 현재 RouteMap 사용처와 segment 의미를 확인한다. 기록카드 이미지 출력은 기존 경로 그림을 유지한다.
- [x] 빈 경로·한 점·구간 단절·동일 좌표의 경로 계산 테스트를 작성해 실패를 확인한다.
- [x] 지도 키가 있으면 결과 상세에 실제 지도와 구간별 Polyline, 시작·종료 표시를 추가한다. 단절 구간을 선으로 잇지 않는다.
- [x] 지도 키가 없으면 기존 그림을 유지하고 빈 경로 안내를 표시한다.
- [x] 모바일 테스트·타입 검사·린트를 통과시키고 변경 커밋을 만든다.

**완료 기준:** 경로 데이터 손실 없이 표시되고 기존 기록카드 저장이 유지된다. 네이티브 지도 표시는 마지막 기기 검증에 남긴다.

## 작업 4: 지도 핀·방향 보완

**Files:** `mobile/src/app/(tabs)/map.tsx`; 새 `mobile/src/map-display.ts`, `mobile/src/map-display.test.ts`.

- [x] 좁은 범위에서는 개별 핀, 넓은 범위에서는 화면상 가까운 관찰 핀을 묶는 정책을 결정한다. 시설·코스와 관찰은 섞지 않는다.
- [x] 묶음 경계·같은 좌표·빈 데이터·확대 시 분리 테스트를 작성해 실패를 확인한다.
- [x] 묶음 선택 시 확대하거나 기존 목록으로 진입하도록 구현한다. 상세 선택·50건 이상 이어 받기를 유지한다.
- [x] 서버 코스 좌표 순서가 진행 방향을 의미하는지 확인한다. 명확한 방향 정보가 있는 코스에만 화살표를 표시한다.
- [x] 모바일 테스트·타입 검사·린트를 통과시키고 변경 커밋을 만든다.

**완료 기준:** 묶음 때문에 관찰 상세가 사라지지 않고, 방향을 확인할 수 없는 코스에 방향을 만들어 표시하지 않는다.

## 작업 5: 나머지 화면 마무리

**Files:** `mobile/src/app/(tabs)/river.tsx`, `mobile/src/app/routine/[id].tsx`, `mobile/src/app/(tabs)/map.tsx`, `mobile/src/content.ts` 및 관련 UI 컴포넌트.

- [x] 기존 프로토타입과 비교해 머리 사진·지난 기록 접기·관찰 정보 안내·정기 관찰 상세의 변경안을 정리한다.
- [x] 확인된 이용 조건의 기존 사진과 디자인을 사용해 화면을 마무리한다.
- [x] 빈 데이터·로딩·실패·긴 글자·간편 모드를 점검한다. 화면 변경과 무관한 서버 재설계는 하지 않는다.
- [x] 타입 검사·린트 및 영향받은 기존 테스트를 실행하고 화면 변경 커밋을 만든다.

**완료 기준:** 데이터가 없을 때도 사용자가 다음 행동을 알 수 있고, 큰 글자에서 주요 조작이 가려지지 않는다.

## 작업 6: 서버 성능 측정

**Files:** `backend/functions/src/store.js` 참조; 새 `backend/verification/load.cjs`, `docs/api/LOAD-VERIFICATION.md`.

- [x] demo 프로젝트의 격리 Emulator에서만 실행되는 부하 측정 도구를 만든다. 운영 서버에는 부하를 보내지 않는다.
- [x] 1·5·10개 계정의 조회·GPS 묶음 전송·종료를 측정한다. 응답 시간 p50/p95·실패·재시도·기록 개수를 저장한다.
- [x] 중복 종료·기록 누락 없이 완료되는지 검증하고 측정 조건과 Emulator 한계를 문서화한다.
- [x] 문제가 확인되면 읽기 범위·트랜잭션 분리를 별도 설계한다. 측정만으로 운영 성능 통과를 선언하지 않는다.

**완료 기준:** 성능 개선의 필요성과 대상이 재현 가능한 결과로 확인된다.

## 개발 후 진행

- [x] 전체 모바일 테스트·타입 검사·린트와 영향받은 백엔드 검사를 실행한다.
- [x] 실제 Firebase 설정으로 Android prebuild·빌드를 확인한다. 기기 기능 통과로 간주하지 않는다.
- [ ] 팀원 Android에서 로그인·지도·사진·잠금 GPS·복구·오프라인 동기화·알림·카드 저장/공유를 한 번에 검증한다.
- [ ] 제휴 상품·보관 정책이 확정되면 혜택·약관을 반영한다. 릴리스 서명·Play 테스트 트랙에서 Play Integrity를 검증한다.

## 작업 단위

작업 1 → 2 → 3 → 4 → 5 → 6 순서로 진행한다. 작은 독립 PR로 제출하며 CI 통과 후 개발 기준에 반영한다. 실기기 전체 검증은 기능 완성 후 진행한다. 작업 6에서 확인된 서버 구조 변경은 이번 UI 완성과 별도 PR로 다룬다.

실행 기록: 2026-10-07 개발 항목 구현·자동 검사·Android 빌드 완료. 실제 기기 검증은 남음. 부하 측정의 10계정 실패는 docs/api/LOAD-VERIFICATION.md에 기록했으며 별도 저장 구조 개선이 필요하다.

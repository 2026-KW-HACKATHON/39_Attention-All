# 백엔드 기능 검증 결과 (로컬 Emulator)

이 문서는 아래 환경에서 **실제로 실행한 결과만** 적는다. 재실행 방법과 시나리오 범위는 [backend/verification/README.md](../../backend/verification/README.md)를 따른다.

## 실행 정보

| 항목 | 값 |
|---|---|
| 실행 일시 | 2026-10-05 21:04 KST (API 시나리오 종료 `2026-10-05T12:04:33Z`) |
| 코드 | `main` 94bf121 기준. 이 검증 시점에 백엔드 코드는 바꾸지 않았다. |
| 환경 | Windows 11, PowerShell, Node 24.19.0(저장소 기준 Node 22와 다름), JDK 26.0.1, firebase-tools 14.27.0 |
| 대상 | `demo-uirun` 로컬 Emulator(Auth·Firestore·Functions·Storage). 운영 프로젝트 `uirun-92539`는 호출하지 않았다. |

## 결과

| 명령 | 내용 | 결과 |
|---|---|---|
| `npm test` (backend) | 단위 테스트 | 131 통과 / 0 실패 |
| `npm run check` | Functions 소스 문법, 웹 스크립트·자산 | 통과(웹 스크립트 15개) |
| `npm run test:integration` › `test:rules` | Firestore·Storage 보안 규칙, 동시성 | 12 통과 / 0 실패 |
| › `functions/test/smoke.cjs` | Emulator 왕복(로그인·호출·업로드) | 통과(스크립트 종료 코드 0) |
| › `verification/run.cjs` | API 시나리오 | 84 통과 / 0 실패, 호출한 Callable 49/49, 누락 0 |
| › `verification/maintenance.cjs` | 탈퇴 후속 정리 핸들러 | PASS — 작업 COMPLETE, Auth·사진·관찰 삭제 확인 |

결과 파일은 무시되는 `output/`에 생긴다(`uirun-api-verification-node.json`, `uirun-api-maintenance.json`).

## 2026-10-06 재실행(모바일 5단계 서버 변경 뒤)

| 명령 | 결과 |
|---|---|
| `npm test` (backend) | 141 통과 / 0 실패(추가: `mobile-run.test.js` 10개) |
| `npm run check` | 통과(웹 스크립트 15개) |
| `npm run test:integration`(PowerShell, 기본 포트 비어 있음 확인 후) | 규칙 12/12, smoke 통과, API 시나리오 84 통과 / 0 실패, maintenance PASS, 종료 코드 0, 실행 뒤 남은 포트 없음 |
| 모바일 `npm test` | 23 통과 / 0 실패(core·runlogic·flows) |

Android Emulator 화면 시험은 [docs/mobile/STATUS.md](../mobile/STATUS.md). 사용자 Emulator와 겹치지 않게 별도 포트(19099·15001·18080·19199)·별도 데이터로 했다.

## 이 결과가 보장하지 않는 것

- 운영 프로젝트 호출, 실제 Google 로그인, 실제 App Check 판정, 운영 사진 signed URL(IAM), Cloud Scheduler 실제 전달
- 실기기 GPS·카메라·백그라운드 동작, Android 앱 빌드·실행
- 대규모 동시 사용 성능([docs/mobile/REVIEW.md](../mobile/REVIEW.md) B항)

## 실행 중 겪은 문제(Windows)

같은 날 첫 실행(Git Bash)은 Firestore Emulator가 콘솔 종료 신호로 끝나 중단됐고, 남은 Emulator 프로세스에 두 번째 실행이 붙어 규칙 테스트 2개가 이전 데이터 때문에 실패했다. 남은 프로세스를 종료한 뒤 PowerShell에서 다시 실행한 결과가 위 표다. 정리 방법은 [docs/mobile/REVIEW.md](../mobile/REVIEW.md) C항.

참고로 GitHub Actions의 `Backend verification`(Ubuntu, Java 21)도 같은 커밋 94bf121에서 성공으로 표시되어 있다(2026-10-05 확인, 이 문서 작성자가 실행한 것은 아니다).

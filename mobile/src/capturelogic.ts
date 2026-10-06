// 현장 사진 작업의 순수 규칙(React Native 없음). capture.ts가 쓰고 `npm test`로 검증한다.
export const MAX_BYTES = 5 * 1024 * 1024;
// 셔터 뒤 이 시간 안에 정확한 위치를 받지 못하면 봉인하지 않는다(나중 위치를 촬영 위치로 쓰지 않는다).
export const SEAL_WINDOW_MS = 30000;

// 실제 바이트가 JPEG인지(확장자·contentType이 아니라 파일 앞 3바이트 FF D8 FF)
export const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export function checkPhoto(size: number, head: Uint8Array) {
  if (!size) return 'PHOTO_FILE_MISSING';
  if (size > MAX_BYTES) return 'PHOTO_TOO_LARGE';
  if (!isJpeg(head)) return 'PHOTO_NOT_JPEG';
  return null;
}
// 봉인 위치를 새로 잡아도 되는가: 셔터 직후(허용 시간 안)에 잰 위치만
export const sealLocOk = (shotAt: number, now: number, measuredAt?: number) => now - shotAt <= SEAL_WINDOW_MS && (measuredAt === undefined || measuredAt - shotAt <= SEAL_WINDOW_MS);

// 영구적으로 다시 쓸 수 없는 오류: 새로 촬영해야 한다(같은 사진·티켓으로 재시도하지 않는다)
export const needsRetake = (code: string) =>
  ['CAPTURE_TICKET_EXPIRED', 'PHOTO_FAILED', 'PHOTO_FILE_MISSING', 'INVALID_TICKET', 'PHOTO_ALREADY_CONSUMED', 'PHOTO_TOO_LARGE', 'PHOTO_NOT_JPEG', 'PHOTO_UPLOAD_REJECTED', 'SEAL_TOO_LATE', 'LOCATION_STALE', 'PHOTO_TOO_OLD'].includes(code);

// 이 화면에서 이어갈 작업 고르기: 같은 계정·목적·대상이고 사진을 보관한 것 중 최신. 다른 목적·대상의 사진은 고르지 않는다.
export type JobLike = { uid: string; purpose: string; targetId?: string; stage: string; file?: string; createdAt: number };
export const pickJob = <J extends JobLike>(all: J[], uid: string, purpose: string, targetId?: string) =>
  all.filter(j => j.uid === uid && j.purpose === purpose && (j.targetId ?? '') === (targetId ?? '') && j.stage !== 'TICKETED' && j.file).sort((a, b) => b.createdAt - a.createdAt)[0];

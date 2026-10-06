// 현장 사진: issueCaptureTicket → 촬영 → (사진 보관) → sealCapture → Storage 업로드 → getPhotoStatus READY → 제출.
// 단계마다 계정별 파일(photos-<uid>.json)에 남겨, 앱이 꺼져도 같은 티켓·같은 사진·같은 요청 ID·같은 내용으로 이어간다.
//   TICKETED   티켓 발급, 카메라 열림
//   CAPTURED   셔터 직후 사진을 앱 폴더에 복사(봉인 전에 먼저 보관)
//   SEAL_PENDING 봉인 위치·요청 ID 고정(이후 재시도는 같은 위치·같은 ID — 나중 위치로 바꾸지 않는다)
//   SEALED → UPLOADING → READY → SUBMITTING → (접수 확인 뒤 삭제)
// 앨범 사진은 받지 않는다(카메라 촬영만). 사진 기록카드의 앨범 사진은 이 파일과 무관하다(card.tsx, 서버에 올리지 않음).
// 같은 계정·목적·대상·분류의 작업은 하나만 이어간다. 재촬영은 새 티켓이다. 접수 확인 전에는 보관 사진을 지우지 않는다.
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { call, uploadEvidence } from './firebase';
import { getUid, mutate } from './session';
import { evidenceFile, readJson, StoreError, writeJson } from './store';
import { domainFailure, toFailure, type Failure, type Result } from './core';
import { isLoc, preciseLoc, type Loc } from './location';
import { checkPhoto, pickJob, sealLocOk } from './capturelogic';
export { needsRetake } from './capturelogic';

export type Purpose = 'DISCOVERY' | 'RECHECK' | 'DISCOVERY_PHOTO' | 'ROUTINE';
export type Stage = 'TICKETED' | 'CAPTURED' | 'SEAL_PENDING' | 'SEALED' | 'UPLOADING' | 'READY' | 'SUBMITTING';
export type PhotoJob = {
  id: string;
  uid: string; // 작업을 시작한 계정(도중에 계정이 바뀌어도 이 계정 파일에만 남긴다)
  key: string; // 목적|대상|분류
  purpose: Purpose;
  targetId?: string;
  categoryCode?: string;
  sessionId?: string; // 촬영 때 진행 중이던 운동(종료를 누른 뒤 찍은 사진은 연결하지 않는다)
  stage: Stage;
  createdAt: number;
  ticketId?: string;
  uploadPath?: string;
  expiresAt?: number;
  file?: string; // 보관한 JPEG URI
  bytes?: number;
  shotAt?: number; // 사진 파일이 만들어진 시각(기기)
  sealLoc?: Loc; // 셔터 직후 위치(고정)
  sealReq?: string; // sealCapture 요청 ID(고정)
  capturedAt?: number; // 서버 봉인 시각
  pin?: [number, number]; // 봉인 위치(새 제보의 현상 위치)
  uploaded?: boolean; // 업로드 요청이 끝났다고 확인한 경우만
  rejectedAt?: number;
};

const name = (uid = getUid()) => `photos-${uid}.json`;
// 파일이 깨졌으면 store가 보관·알림하고, 여기서는 진행 중 작업이 없는 것으로 시작한다(새 촬영은 새 티켓).
function jobs(uid = getUid()): Record<string, PhotoJob> {
  if (!uid) return {};
  try {
    return readJson<Record<string, PhotoJob>>(name(uid), {});
  } catch (e) {
    if (e instanceof StoreError) return {};
    throw e;
  }
}
const save = (j: PhotoJob) => writeJson(name(j.uid), { ...jobs(j.uid), [j.id]: j });
// 다른 계정으로 바뀐 뒤에는 이 작업을 서버로 보내지 않는다(원래 계정으로 다시 로그인하면 이어서)
const mine = (j: PhotoJob) => j.uid === getUid();
const fail = (errorCode: string, retryable = false): Failure => ({ ok: false, errorCode, details: {}, retryable });
export const jobKey = (purpose: Purpose, targetId?: string, categoryCode?: string) => `${purpose}|${targetId ?? ''}|${categoryCode ?? ''}`;

// 정리 기준: 사진 없이 티켓만 남은 작업은 티켓 만료 뒤 지운다(카메라 결과를 받지 못함).
// 사진이 있는 작업은 접수 확인·서버의 영구 거절(재촬영 필요)·사용자가 버릴 때만 지운다(조용히 지우지 않는다).
export function sweepJobs() {
  const uid = getUid();
  if (!uid) return;
  const all = jobs(uid), now = Date.now();
  const stale = Object.values(all).filter(j => j.stage === 'TICKETED' && !j.file && (j.expiresAt ?? 0) <= now);
  if (!stale.length) return;
  for (const j of stale) delete all[j.id];
  writeJson(name(uid), all);
}

// 이 화면에서 이어갈 작업: 같은 목적·대상(새 제보는 분류 무관 — 분류는 사진과 함께 고정)이고 사진을 보관한 것
export const pendingJob = (purpose: Purpose, targetId?: string) => {
  const uid = getUid();
  return uid ? pickJob(Object.values(jobs(uid)), uid, purpose, targetId) : undefined;
};

// 제출이 확정된 뒤(성공 또는 서버의 영구 거절) 또는 사용자가 버릴 때만 보관 사진과 작업을 지운다.
export function finishJob(j: PhotoJob) {
  const all = jobs(j.uid);
  delete all[j.id];
  writeJson(name(j.uid), all);
  if (j.file) {
    const f = new File(j.file);
    if (f.exists) f.delete();
  }
}

// 사진 보관: 실제 바이트가 JPEG이고 5MiB 이하인지 확인한 뒤 앱 폴더로 복사한다(확장자·contentType만 바꾸지 않는다).
function keep(job: PhotoJob, uri: string): Result<PhotoJob> {
  const src = new File(uri);
  const size = src.exists ? (src.size ?? 0) : 0;
  const bad = checkPhoto(size, size ? src.bytesSync().subarray(0, 3) : new Uint8Array());
  if (bad) return fail(bad);
  const dest = evidenceFile(job.id);
  if (dest.exists) dest.delete();
  src.copy(dest);
  const mtime = src.lastModified;
  Object.assign(job, { stage: 'CAPTURED', file: dest.uri, bytes: size, shotAt: mtime && mtime <= Date.now() ? mtime : Date.now() });
  save(job);
  return { ok: true, value: job };
}

// 1) 티켓 발급 → 2) 카메라 → 3) 사진 보관 → 4) 봉인
export async function capture(purpose: Purpose, targetId?: string, categoryCode?: string, sessionId?: string): Promise<Result<PhotoJob>> {
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) return fail('CAMERA_PERMISSION_DENIED');
  const uid = getUid();
  if (!uid) return fail('UNAUTHENTICATED');
  const loc = await preciseLoc();
  if (!isLoc(loc)) return loc;
  const job: PhotoJob = { id: Crypto.randomUUID(), uid, key: jobKey(purpose, targetId, categoryCode), purpose, targetId, categoryCode, sessionId, stage: 'TICKETED', createdAt: Date.now() };
  const t = await mutate<{ ticketId: string; uploadPath: string; expiresAt: number }>(
    'issueCaptureTicket',
    { purpose, loc, ...(targetId ? { targetId } : {}), ...(categoryCode ? { categoryCode } : {}) },
    'ticket:' + job.id,
  );
  if (!t.ok) return t;
  Object.assign(job, { ticketId: t.value.ticketId, uploadPath: t.value.uploadPath, expiresAt: t.value.expiresAt });
  save(job); // 카메라가 열린 동안 앱이 정리돼도 이 티켓으로 이어간다(resumeShot)
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
  if (shot.canceled || !shot.assets[0]) {
    finishJob(job);
    return fail('CAPTURE_CANCELLED');
  }
  const k = keep(job, shot.assets[0].uri);
  if (!k.ok) {
    finishJob(job);
    return k;
  }
  return seal(job);
}

// 봉인: 위치와 요청 ID를 먼저 고정·저장한 뒤 보낸다. 응답을 잃으면 같은 ID·같은 위치로만 다시 보낸다
// (서버가 이미 처리했으면 같은 결과를 돌려준다. 위치가 오래돼 거절되면 다시 촬영).
export async function seal(job: PhotoJob): Promise<Result<PhotoJob>> {
  if (!mine(job)) return fail('ACCOUNT_CHANGED');
  if (job.stage === 'CAPTURED') {
    if (!sealLocOk(job.shotAt ?? 0, Date.now())) return fail('SEAL_TOO_LATE');
    const loc = await preciseLoc();
    if (!isLoc(loc)) return loc;
    if (!sealLocOk(job.shotAt ?? 0, Date.now(), loc.measuredAt)) return fail('SEAL_TOO_LATE');
    Object.assign(job, { stage: 'SEAL_PENDING', sealLoc: loc, sealReq: Crypto.randomUUID() });
    save(job);
  }
  if (job.stage !== 'SEAL_PENDING') return { ok: true, value: job };
  let v: unknown;
  try {
    v = await call('sealCapture', { ticketId: job.ticketId, loc: job.sealLoc, clientRequestId: job.sealReq });
  } catch (e) {
    return toFailure(e);
  }
  const f = domainFailure(v);
  if (f) return f;
  Object.assign(job, { stage: 'SEALED', capturedAt: (v as { capturedAt: number }).capturedAt, pin: [job.sealLoc!.lat, job.sealLoc!.lng] });
  save(job);
  return { ok: true, value: job };
}

// 카메라가 열린 동안 메모리 부족으로 앱이 정리됐으면, Android가 보관한 촬영 결과로 이어간다(티켓 유효 시간·봉인 허용 시간 안에서만).
export async function resumeShot(): Promise<Result<PhotoJob> | null> {
  const job = Object.values(jobs()).find(j => j.stage === 'TICKETED' && j.ticketId && (j.expiresAt ?? 0) > Date.now());
  if (!job) return null;
  const pending = await ImagePicker.getPendingResultAsync().catch(() => null);
  const asset = pending && 'assets' in pending && !pending.canceled ? pending.assets?.[0] : null;
  if (!asset) return null;
  const k = keep(job, asset.uri);
  if (!k.ok) {
    finishJob(job);
    return k;
  }
  return seal(job);
}

export const markSubmitting = (j: PhotoJob) => {
  j.stage = 'SUBMITTING';
  save(j);
};

// 업로드 → READY 확인. 응답을 잃었으면 먼저 상태를 확인하고, 이미 올라간 파일을 덮어쓰지 않는다.
export async function upload(job: PhotoJob): Promise<Result<PhotoJob>> {
  if (!mine(job)) return fail('ACCOUNT_CHANGED');
  try {
    if (job.stage === 'CAPTURED' || job.stage === 'SEAL_PENDING') {
      const s = await seal(job);
      if (!s.ok) return s;
    }
    if (job.stage === 'READY' || job.stage === 'SUBMITTING') return { ok: true, value: job };
    if (!job.ticketId || !job.file || !job.capturedAt) return fail('PHOTO_REQUIRED');
    for (let i = 0; i < 40; i++) {
      const st = await call<{ status: string }>('getPhotoStatus', { ticketId: job.ticketId });
      if (st.status === 'READY') {
        job.stage = 'READY';
        save(job);
        return { ok: true, value: job };
      }
      if (st.status === 'FAILED' || st.status === 'DELETE_PENDING') return fail('PHOTO_FAILED');
      if (!job.uploaded) {
        if (!new File(job.file).exists) return fail('PHOTO_FILE_MISSING');
        try {
          job.stage = 'UPLOADING';
          save(job);
          await uploadEvidence(job.uploadPath!, job.file);
          job.uploaded = true;
          save(job);
        } catch (e) {
          const code = String((e as { code?: string })?.code);
          if (!/unauthorized|permission/i.test(code)) return { ...toFailure(e), retryable: true }; // 통신 실패: 나중에 같은 파일로
          // 거절: 이전 업로드가 이미 도착해 덮어쓰기가 막힌 경우일 수 있다 → 상태를 몇 번 더 보고, 아니면 거절로 알린다
          job.rejectedAt ??= i;
          save(job);
          if (i - job.rejectedAt >= 5) return fail('PHOTO_UPLOAD_REJECTED');
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return fail('PHOTO_PROCESSING', true);
  } catch (e) {
    return toFailure(e);
  }
}

export const STAGE_TEXT: Record<Stage, string> = {
  TICKETED: '촬영 준비됨',
  CAPTURED: '사진 보관됨 · 촬영 확인 전',
  SEAL_PENDING: '촬영 확인을 보내는 중',
  SEALED: '촬영 확인됨 · 업로드 전',
  UPLOADING: '업로드 중',
  READY: '업로드 완료 · 제출 전',
  SUBMITTING: '제출 확인 중',
};

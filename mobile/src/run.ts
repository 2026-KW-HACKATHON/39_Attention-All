// 운동 기록: 실제 GPS → 기기 파일에 즉시 저장 → 묶어서 순서대로 서버 전송(appendTrack) → 일시정지·재개·종료.
// 화면이 꺼져도 Android Foreground Service(지속 알림)로 위치를 받는다(expo-location 백그라운드 작업).
// 강제 종료·최근 앱에서 제거 뒤에는 수집이 끊길 수 있다. 다시 열면 서버 세션과 맞춰 복구하고 끊긴 구간을 표시한다.
// 저장: 계정·세션마다 `run-<uid>-<sessionId>.json`. 이전 버전의 `run.json`은 주인 UID 파일로 옮긴다(지우지 않고 이동).
// 순수 규칙(거리·묶음·거절 맞추기·종료 시각)은 runlogic.ts — 단위 테스트 대상.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Crypto from 'expo-crypto';
import { Vibration } from 'react-native';
import { call } from './firebase';
import { getUid, mutate, onAccountChange, onBeforeSignOut, refresh } from './session';
import { fileExists, listJson, readJson, removeFile, writeJson } from './store';
import { domainFailure, toFailure, type Failure, type Result } from './core';
import { isLoc, preciseLoc, type Loc } from './location';
import { activeAt, addTrail, endTime, flush, legM, pendingPoints, rebuildDistance, reconcileRejected, shouldFlush, toTail, type Op, type Pause, type Pt, type ServerSession, type Tail, type Trail } from './runlogic';

export const RUN_TASK = 'uirun-run-location';
const LEGACY = 'run.json';
// 수집 정책: 3초·5m마다(세션 5,000점 한도 → 연속 이동 약 4시간). 정확도 50m 초과·가짜 위치·순서가 어긋난 점은 버린다.
// 버린 점을 다른 좌표로 채우지 않는다. 묶음 정책은 runlogic FLUSH_*.
const MAX_ACC = 50, GAP_MS = 60000, EXPOSURE_EVERY = 60000;

export type Exposure = { id: string; kind: 'ISSUE' | 'ROUTINE'; targetId: string; expiresAt: number };
export type Run = {
  uid: string;
  sessionId: string;
  mode: 'RUN' | 'WALK';
  courseId: string | null;
  startedAt: number; // 서버 시작 시각
  status: 'ACTIVE' | 'PAUSED' | 'ENDING' | 'ENDED';
  pauses: Pause[]; // 실제 조작 시각(서버에 occurredAt으로 같은 값을 보낸다)
  endAt: number | null; // 종료·폐기를 누른 시각(서버에 occurredAt으로 보낸다). 이 뒤로 시간이 늘지 않는다.
  buffer: Pt[]; // 아직 요청으로 묶지 않은 점
  ops: Op[]; // 순서대로 보낼 요청(요청 ID·내용 고정)
  stored: number; // 서버가 저장했다고 답한 점 수
  distanceM: number; // 서버가 계산한 거리(저장분)
  localM: number; // 기기 계산 거리(서버와 같은 규칙, 저장분 + 미전송분)
  tail: Tail | null; // 거리 계산용 마지막 점
  trail: Trail; // 화면 지도용 축약 경로
  lastAt: number;
  last: Loc | null;
  gaps: number;
  dropped: number; // 서버 규칙상 저장할 수 없어 뺀 점(일시정지 구간 안)
  rejected: Pt[]; // 서버가 거절해 보내지 못한 점(지우지 않고 보관·표시)
  skippedMock: number;
  offline: boolean;
  problem: string | null; // 사용자가 결정해야 하는 서버 거절
  timeFallback: boolean; // 기기 시각이 서버 범위를 벗어나 서버 수신 시각으로 종료함
  result: { status: string; distanceM: number; activeMs: number } | null;
  exposure: Exposure | null;
  exposureAt: number;
  unsaved?: boolean; // 기기 저장 실패(메모리에만 있음)
};

const fileName = (r: { uid: string; sessionId: string }) => `run-${r.uid}-${r.sessionId}.json`;
const newId = () => Crypto.randomUUID();
let state: Run | null = null;
let loadedFor: string | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());
export const subscribeRun = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

// 이전 버전 필드 보충
const upgrade = (r: Run): Run => ({ ...r, trail: r.trail ?? [], endAt: r.endAt ?? null, localM: r.localM ?? r.distanceM ?? 0, tail: r.tail ?? null, rejected: r.rejected ?? [], timeFallback: r.timeFallback ?? false, dropped: r.dropped ?? 0 });
const rank = (r: Run) => (r.status === 'ENDED' ? 0 : 1e15) + r.startedAt;

// 이 계정의 운동만 보인다(다른 계정의 파일은 열지 않는다). 손상된 파일은 store가 보관·알림하고 건너뛴다.
function loadFor(uid: string): Run | null {
  let best: Run | null = null;
  for (const n of listJson(`run-${uid}-`)) {
    let r: Run | null = null;
    try {
      r = readJson<Run | null>(n, null);
    } catch {
      continue;
    }
    if (r && r.uid === uid && (!best || rank(r) > rank(best))) best = upgrade(r);
  }
  return best;
}
// 이전 버전 단일 파일: 주인 UID·세션 파일로 옮긴다. 손상됐으면 store가 옆으로 보관하고 알린다.
function migrateLegacy() {
  let r: Run | null = null;
  try {
    r = readJson<Run | null>(LEGACY, null);
  } catch {
    return;
  }
  if (!r?.uid || !r.sessionId) return; // 주인을 알 수 없으면 그대로 둔다
  const name = fileName(r);
  if (fileExists(name) || writeJson(name, upgrade(r))) removeFile(LEGACY);
}

export function getRun(): Run | null {
  const uid = getUid();
  if (loadedFor !== uid) {
    state = uid ? loadFor(uid) : null;
    loadedFor = uid;
  }
  return state;
}
function put(r: Run) {
  const ok = writeJson(fileName(r), { ...r, unsaved: undefined });
  state = { ...r, unsaved: !ok };
  emit();
}
function drop(r: Run) {
  removeFile(fileName(r));
  if (state?.sessionId === r.sessionId) state = null;
  emit();
}
// 화면 표시용 활동 시간. 종료를 누르면 그 시각에서 멈추고, 종료 뒤에는 서버 값을 쓴다.
export const activeMs = (r: Run, now = Date.now()) => (r.result ? r.result.activeMs : activeAt(r.startedAt, r.pauses, now, r.endAt));
const fail = (errorCode: string): Failure => ({ ok: false, errorCode, details: {}, retryable: false });

// 위치 작업은 앱 최상위에서 정의해야 백그라운드에서도 불린다(이 파일을 루트 레이아웃이 불러온다).
TaskManager.defineTask(RUN_TASK, async ({ data, error }) => {
  if (error || !data) return;
  addPoints((data as { locations: Location.LocationObject[] }).locations);
});

// ponytail: 일시정지·종료를 누른 뒤 늦게 전달된(그 전에 찍힌) 점은 버린다. 몇 초 분량이며 큐 순서를 단순하게 유지한다.
function addPoints(locs: Location.LocationObject[]) {
  const r = getRun();
  if (!r || r.status !== 'ACTIVE') return;
  for (const l of locs) {
    if (l.mocked) {
      r.skippedMock++; // 서버가 가짜 위치를 거절한다. 묶음 전체가 거절되지 않게 미리 뺀다.
      continue;
    }
    const acc = l.coords.accuracy ?? 9999;
    if (acc > MAX_ACC || l.timestamp <= r.lastAt || l.timestamp < r.startedAt) continue;
    if (r.lastAt && l.timestamp - r.lastAt > GAP_MS) r.gaps++;
    const p: Pt = { lat: l.coords.latitude, lng: l.coords.longitude, accuracyM: acc, recordedAt: l.timestamp, altitudeM: l.coords.altitude ?? null, altitudeAccuracyM: l.coords.altitudeAccuracy ?? null };
    const t = toTail(p, r.pauses);
    if (r.tail) r.localM += legM(r.tail, t);
    r.tail = t;
    addTrail(r.trail, t);
    r.buffer.push(p);
    r.lastAt = l.timestamp;
    r.last = { lat: l.coords.latitude, lng: l.coords.longitude, accuracyM: acc, measuredAt: l.timestamp, precise: true };
  }
  if (shouldFlush(r.buffer, Date.now())) flush(r.buffer, r.ops, r.sessionId, newId);
  put(r);
  if (r.ops.length) void pump();
  void checkExposure();
}

// 위치 수집 시작. 실패하면(권한·서비스 거절) 운동은 그대로 두고 화면에 ‘위치 기록 꺼짐’을 알린다(조용히 넘어가지 않는다).
// UI 상태는 즉시 반영하지만 네이티브 시작·중지는 호출 순서대로 끝낸다.
let locationTransition: Promise<unknown> = Promise.resolve();
function queueLocation<T>(action: () => Promise<T>): Promise<T> {
  const next = locationTransition.then(action);
  locationTransition = next.catch(() => {});
  return next;
}
const startUpdates = () => queueLocation(startUpdatesNow);
async function startUpdatesNow() {
  if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false)) return true;
  try {
    await startService();
    const r = getRun();
    if (r?.problem === 'LOCATION_OFF') put({ ...r, problem: null });
    return true;
  } catch {
    const r = getRun();
    if (r) put({ ...r, problem: 'LOCATION_OFF' });
    return false;
  }
}
export const restartLocation = () => startUpdates();
async function startService() {
  await Location.startLocationUpdatesAsync(RUN_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    foregroundService: { notificationTitle: '우이런 운동 기록 중', notificationBody: '화면이 꺼져도 운동 경로를 기록해요. 앱에서 종료할 수 있어요.', notificationColor: '#384BF0' },
  });
}
const stopUpdates = () => queueLocation(stopUpdatesNow);
async function stopUpdatesNow() {
  if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(RUN_TASK).catch(() => {});
}

// 워치 연결(wear.ts)이 채운다. 워치가 체크포인트를 사용자에게 알렸다고 답하면 폰 진동·알림을 생략한다(중복 방지). 기본은 폰이 알린다.
export const wearHooks = { claimAlert: (_exposureId: string): Promise<boolean> => Promise.resolve(false) };

// 시작: 정확한 위치 확인 → 서버 세션 생성. 서버 세션이 없으면 시작으로 표시하지 않는다(오프라인 시작 불가).
// 폰 화면과 워치 명령이 동시에 눌러도 시작 처리는 하나만 진행하고 같은 운동을 돌려준다(먼저 누른 쪽의 종류로 시작).
let starting: Promise<Result<Run>> | null = null;
export const startRun = (mode: 'RUN' | 'WALK', courseId: string | null) => (starting ??= startRunNow(mode, courseId).finally(() => (starting = null)));
async function startRunNow(mode: 'RUN' | 'WALK', courseId: string | null): Promise<Result<Run>> {
  const uid = getUid();
  if (!uid) return fail('UNAUTHENTICATED');
  const existing = getRun();
  if (existing && existing.status !== 'ENDED') return { ok: true, value: existing };
  const loc = await preciseLoc();
  if (!isLoc(loc)) return loc;
  const r = await mutate<{ sessionId: string; startedAt: number }>('startRun', { mode, loc, ...(courseId ? { courseId } : {}) }, 'startRun');
  if (!r.ok) {
    // 이미 진행 중인 세션이 있거나 응답을 잃었으면 서버 세션을 이어 받는다(새 세션을 만들지 않는다)
    if (r.errorCode === 'ACTIVE_SESSION_EXISTS' || r.retryable || r.errorCode === 'LOCATION_STALE') {
      const adopted = await adoptServerSession();
      if (adopted) return { ok: true, value: adopted };
    }
    return r;
  }
  if (getUid() !== uid) return fail('ACCOUNT_CHANGED');
  if (existing) drop(existing); // 서버가 종료를 확인한 이전 기록(결과 화면을 보지 않은 것)
  const run: Run = blank(uid, r.value.sessionId, mode, courseId, r.value.startedAt);
  run.last = loc;
  put(run);
  await startUpdates();
  void refresh('getMy');
  return { ok: true, value: run };
}
const blank = (uid: string, sessionId: string, mode: Run['mode'], courseId: string | null, startedAt: number): Run => ({
  uid, sessionId, mode, courseId, startedAt, status: 'ACTIVE', pauses: [], endAt: null, buffer: [], ops: [], stored: 0, distanceM: 0, localM: 0, tail: null, trail: [],
  lastAt: 0, last: null, gaps: 0, dropped: 0, rejected: [], skippedMock: 0, offline: false, problem: null, timeFallback: false, result: null, exposure: null, exposureAt: 0,
});

type Detail = ServerSession & { mode: 'RUN' | 'WALK'; courseId: string | null };
// 서버에 진행 중 세션이 있는데 이 기기에 상태가 없을 때(재설치·다른 기기에서 시작·기기 파일 손상) 서버 기준으로 이어 받는다.
export async function adoptServerSession(): Promise<Run | null> {
  const uid = getUid();
  if (!uid) return null;
  try {
    const my = await call<{ activeSession: string | null }>('getMy', {});
    if (!my.activeSession) return null;
    const d = await call<Detail>('getRunDetail', { sessionId: my.activeSession });
    if (getUid() !== uid) return null;
    const run = blank(uid, d.id, d.mode, d.courseId, d.startedAt);
    Object.assign(run, { status: d.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE', pauses: d.pauses, stored: d.track.length, distanceM: d.distanceM, localM: d.distanceM, tail: d.track.at(-1) ?? null, lastAt: d.track.at(-1)?.recordedAt ?? 0, gaps: 1 });
    d.track.forEach(t => addTrail(run.trail, t));
    put(run);
    if (run.status === 'ACTIVE') await startUpdates();
    return run;
  } catch {
    return null;
  }
}

// 서버 세션 상태로 기기 상태를 맞춘다(앱 재시작·거절 뒤). 보낼 요청은 그대로 두고 같은 ID로 다시 보낸다.
function syncFromServer(r: Run, d: ServerSession) {
  const closed = !['ACTIVE', 'PAUSED'].includes(d.status);
  const hasEnd = r.ops.some(o => o.name === 'finishRun' || o.name === 'discardRun');
  if (closed && !hasEnd) {
    // 다른 기기에서 끝났거나 이 기기가 종료 응답을 잃은 뒤 큐가 비었다: 서버 결과를 쓰고 수집을 멈춘다.
    r.rejected.push(...pendingPoints(r.ops, r.buffer));
    r.ops = [];
    r.buffer = [];
    r.status = 'ENDED';
    r.result = { status: d.status, distanceM: d.distanceM, activeMs: d.activeMs };
    void stopUpdates();
    return;
  }
  r.stored = d.track.length;
  r.distanceM = d.distanceM;
  // 일시정지·재개 요청이 남아 있지 않으면 서버의 일시정지 기록이 기준이다
  if (!closed && !r.ops.some(o => o.name === 'pauseRun' || o.name === 'resumeRun') && r.status !== 'ENDING') {
    r.pauses = d.pauses;
    r.status = d.status as Run['status'];
  }
  const last = d.track.at(-1)?.recordedAt ?? 0;
  const pending = pendingPoints(r.ops, r.buffer).filter(p => p.recordedAt > last);
  const x = rebuildDistance(d.track, pending, r.pauses);
  r.localM = x.localM;
  r.tail = x.tail;
  r.trail = [];
  for (const t of [...d.track, ...pending.map(p => toTail(p, r.pauses))]) addTrail(r.trail, t);
}

// 앱 시작·계정 전환 때: 이 계정의 운동이 있으면 서버와 맞추고 위치 수집과 전송을 다시 켠다(끊긴 시간은 단절로 남는다).
export async function recoverRun() {
  migrateLegacy();
  const r0 = getRun();
  if (!r0) return void (await adoptServerSession());
  if (r0.status === 'ENDED') return;
  const uid = r0.uid;
  try {
    const d = await call<ServerSession>('getRunDetail', { sessionId: r0.sessionId });
    const r = getRun();
    if (!r || r.uid !== uid || getUid() !== uid) return;
    syncFromServer(r, d);
    put(r);
  } catch (e) {
    const f = toFailure(e);
    const r = getRun();
    if (r && getUid() === uid && f.errorCode === 'NOT_FOUND') put({ ...r, problem: 'SESSION_CLOSED' });
  }
  const r = getRun();
  if (!r || getUid() !== uid) return;
  if (r.status === 'ACTIVE' && !(await Location.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false))) {
    r.gaps++;
    put(r);
    await startUpdates().catch(() => {});
  }
  if (r.status === 'ENDED' || r.status === 'PAUSED') await stopUpdates();
  void pump();
}

// 조작은 상태를 먼저 동기적으로 바꾸고 저장한 뒤(위치 작업과 섞이지 않게) 수집 시작·중지 같은 비동기 작업을 한다.
// 일시정지·재개는 누른 순간의 시각을 함께 보낸다. 그 전 위치를 먼저 요청으로 묶어 순서를 지킨다.
export async function pauseRun() {
  const r = getRun();
  if (!r || r.status !== 'ACTIVE') return;
  const at = Math.max(Date.now(), r.lastAt + 1, r.startedAt + 1);
  flush(r.buffer, r.ops, r.sessionId, newId);
  r.pauses.push({ from: at, to: null });
  r.ops.push({ id: newId(), name: 'pauseRun', payload: { sessionId: r.sessionId, occurredAt: at } });
  r.status = 'PAUSED';
  put(r);
  await stopUpdates();
  void pump();
}
export async function resumeRun() {
  const r = getRun();
  if (!r || r.status !== 'PAUSED') return;
  const at = Math.max(Date.now(), (r.pauses.at(-1)?.from ?? 0) + 1);
  if (r.pauses.at(-1)) r.pauses.at(-1)!.to = at;
  r.ops.push({ id: newId(), name: 'resumeRun', payload: { sessionId: r.sessionId, occurredAt: at } });
  r.status = 'ACTIVE';
  r.lastAt = Math.max(r.lastAt, at);
  put(r);
  await startUpdates();
  void pump();
}
// 누른 순간을 종료 시각으로 저장하고 화면 시간을 멈춘다. 오프라인이면 나중에 같은 시각으로 보낸다.
function markEnd(r: Run) {
  if (r.endAt === null && (r.status === 'ACTIVE' || r.status === 'PAUSED')) {
    r.endAt = endTime(Date.now(), r.status, r.startedAt, r.pauses, r.lastAt); // 일시정지 중이면 서버가 이 시각으로 구간을 닫는다
  }
  r.status = 'ENDING';
}
const endOp = (r: Run, name: 'finishRun' | 'discardRun', payload: Record<string, unknown> | null): Op => ({ id: newId(), name, payload });
// 종료: 수집 중지 → 남은 위치 전송 → finishRun(그때까지 저장된 점 수로 확인 + 누른 시각) → 결과
export async function finishRun() {
  const r = getRun();
  if (!r || r.status === 'ENDED' || r.status === 'ENDING') return;
  markEnd(r);
  flush(r.buffer, r.ops, r.sessionId, newId);
  r.ops.push(endOp(r, 'finishRun', null)); // 내용(저장 점 수)은 큐 맨 앞에 왔을 때 채우고 그 뒤로 고정
  put(r);
  await stopUpdates();
  void pump();
}
// 폐기: 미전송 위치는 보내지 않고(사용자가 기록을 버리기로 함) 서버 세션만 폐기한다.
export async function discardRun() {
  const r = getRun();
  if (!r || r.status === 'ENDED') return;
  markEnd(r);
  r.buffer = [];
  r.ops = [endOp(r, 'discardRun', { sessionId: r.sessionId, ...(r.endAt && !r.timeFallback ? { occurredAt: r.endAt } : {}) })];
  r.problem = null;
  put(r);
  await stopUpdates();
  void pump();
}
// 서버 거절(한도·만료) 뒤 저장된 부분만으로 끝낼 때. 보내지 못한 점은 rejected에 남긴다.
export async function finishSavedOnly() {
  const r = getRun();
  if (!r || r.status === 'ENDED') return;
  markEnd(r);
  r.rejected.push(...pendingPoints(r.ops, r.buffer));
  r.buffer = [];
  r.ops = r.ops.filter(o => o.name !== 'appendTrack' && o.name !== 'finishRun');
  r.ops.push(endOp(r, 'finishRun', null));
  r.problem = null;
  put(r);
  await stopUpdates();
  void pump();
}
// 결과 화면을 닫을 때: 서버가 종료를 확인한 기록만 기기에서 지운다(서버에 남아 있다).
export const clearEnded = () => {
  const r = getRun();
  if (r?.status === 'ENDED') drop(r);
};

// 전송은 한 번에 하나(큐 맨 앞부터). 응답을 기다리는 동안 계정이 바뀌면 결과를 반영하지 않는다.
let pumping: Promise<void> | null = null;
export const pump = () => (pumping ??= pumpOnce().finally(() => (pumping = null)));

async function pumpOnce() {
  let r = getRun();
  if (!r || r.uid !== getUid()) return;
  const uid = r.uid;
  while (r && r.ops.length) {
    const op = r.ops[0];
    if (op.name === 'finishRun' && op.payload === null) {
      op.payload = { sessionId: r.sessionId, expectedTrackCount: r.stored, ...(r.endAt && !r.timeFallback ? { occurredAt: r.endAt } : {}) };
      put(r);
    }
    let v: unknown;
    try {
      v = await call(op.name, { ...op.payload, clientRequestId: op.id });
    } catch (e) {
      const f = toFailure(e);
      r = getRun();
      if (!r || getUid() !== uid) return;
      if (f.retryable) {
        r.offline = true; // 연결이 돌아오면 같은 요청 ID로 다시 보낸다
        put(r);
        return;
      }
      v = f;
    }
    r = getRun();
    if (!r || r.ops[0]?.id !== op.id || getUid() !== uid) return;
    r.offline = false;
    const f = domainFailure(v) ?? (v && typeof v === 'object' && (v as { ok?: boolean }).ok === false ? (v as Failure) : null);
    if (!f) {
      r.ops.shift();
      const ok = v as { count?: number; distanceM?: number; status?: string; activeMs?: number };
      if (op.name === 'appendTrack') {
        r.stored = ok.count ?? r.stored;
        r.distanceM = ok.distanceM ?? r.distanceM;
      }
      if (op.name === 'finishRun' || op.name === 'discardRun') {
        r.status = 'ENDED';
        r.result = { status: ok.status ?? '', distanceM: ok.distanceM ?? r.distanceM, activeMs: ok.activeMs ?? 0 };
        void refresh('getMy', 'getRecords', 'getWorkoutStats', 'getHome', 'getRunDetail');
      }
      put(r);
      continue;
    }
    if (!(await handleRejection(op, f))) return;
    r = getRun();
  }
}

// 거절 처리. 서버 상태 확인이 필요한데 연결이 안 되면 false(같은 요청을 맨 앞에 둔 채 나중에 다시).
async function handleRejection(op: Op, f: Failure): Promise<boolean> {
  const code = f.errorCode;
  const r = getRun()!;
  const uid = r.uid;
  const update = (fn: (r: Run) => void) => {
    const cur = getRun();
    if (!cur || cur.uid !== uid || cur.ops[0]?.id !== op.id) return false;
    fn(cur);
    put(cur);
    return true;
  };
  if (op.name === 'appendTrack') {
    if (code === 'SESSION_TRACK_LIMIT' || code === 'SESSION_EXPIRED') {
      // 더 보낼 수 없다: 위치 수집을 멈추고 사용자에게 저장된 부분만으로 끝낼지 묻는다(점은 큐에 그대로 둔다).
      update(c => (c.problem = code));
      void stopUpdates();
      return false;
    }
    if (code === 'INVALID_STATE' || code === 'NOT_FOUND') {
      update(c => (c.problem = 'SESSION_CLOSED'));
      return false;
    }
    // OUT_OF_ORDER·PAUSED_SAMPLE 등: 서버 세션과 맞춘 뒤 보낼 수 있는 점만 다시 보낸다.
    let d: ServerSession;
    try {
      d = await call<ServerSession>('getRunDetail', { sessionId: r.sessionId });
    } catch {
      update(c => (c.offline = true));
      return false;
    }
    return update(c => {
      const x = reconcileRejected(op, d, Date.now(), newId);
      c.ops.splice(0, 1, ...x.replace);
      c.dropped += x.dropped;
      c.rejected.push(...x.rejected);
      if (x.rejected.length) c.problem = 'TRACK_REJECTED';
      syncFromServer(c, d);
    });
  }
  if (op.name === 'finishRun' && code === 'TRACK_NOT_SYNCED') {
    return update(c => {
      c.stored = Number(f.details.storedCount ?? c.stored);
      c.ops.splice(0, 1, endOp(c, 'finishRun', null));
    });
  }
  if ((op.name === 'finishRun' || op.name === 'discardRun') && code === 'INVALID_ARGUMENT' && op.payload?.occurredAt !== undefined) {
    // 기기 시각이 서버 허용 범위를 벗어남: 누른 시각 대신 서버 수신 시각으로 끝낸다(결과 화면에 알린다).
    return update(c => {
      c.timeFallback = true;
      const { occurredAt: _drop, ...rest } = op.payload!;
      c.ops.splice(0, 1, endOp(c, op.name as 'finishRun' | 'discardRun', op.name === 'finishRun' ? null : rest));
    });
  }
  if ((op.name === 'finishRun' || op.name === 'discardRun') && (code === 'INVALID_STATE' || code === 'NOT_FOUND')) {
    // 다른 기기나 이전 요청에서 이미 끝난 세션: 서버 결과로 맞춘다.
    return update(c => {
      c.ops.shift();
      c.status = 'ENDED';
      c.result = c.result ?? { status: 'CLOSED', distanceM: c.distanceM, activeMs: activeMs(c) };
    });
  }
  // pause/resume 거절: 서버 상태와 다르다. 서버 기록으로 맞추고 알린다(요청은 큐에서 뺀다 — 같은 내용은 다시 거절된다).
  update(c => {
    c.ops.shift();
    c.problem = code;
  });
  const cur = getRun();
  if (cur && cur.uid === uid) {
    try {
      const d = await call<ServerSession>('getRunDetail', { sessionId: cur.sessionId });
      const c = getRun();
      if (c && c.uid === uid) {
        syncFromServer(c, d);
        put(c);
        if (c.status === 'ACTIVE') await startUpdates();
        else await stopUpdates();
      }
    } catch {}
  }
  return true;
}

// 운동 중 근처 관찰 요청: 서버가 정한 간격·횟수·대상만 알린다(앱이 임의로 만들지 않는다).
async function checkExposure() {
  const r = getRun();
  if (!r || r.status !== 'ACTIVE' || !r.last || r.offline || Date.now() - r.exposureAt < EXPOSURE_EVERY) return;
  if (Date.now() - r.last.measuredAt > 9000 || r.last.accuracyM > 30) return;
  r.exposureAt = Date.now();
  put(r);
  try {
    const v = await call<{ ok: boolean; exposure: Exposure | null }>('recordMissionExposure', { sessionId: r.sessionId, loc: r.last, clientRequestId: newId() });
    const cur = getRun();
    if (v.ok && v.exposure && cur?.sessionId === r.sessionId && cur.status === 'ACTIVE') {
      cur.exposure = v.exposure;
      put(cur);
      if (!(await wearHooks.claimAlert(v.exposure.id))) Vibration.vibrate(r.mode === 'RUN' ? 150 : [0, 150, 120, 150]);
    }
  } catch {
    // 위치 범위 밖 등은 알림 없음으로 둔다
  }
}

// 로그아웃 직전: 위치 수집을 멈추고 묶지 않은 점까지 이 계정 파일에 저장한다(다음 로그인 때 이어 보낸다).
onBeforeSignOut(async () => {
  const r = getRun();
  if (!r) return;
  await stopUpdates();
  flush(r.buffer, r.ops, r.sessionId, newId);
  put(r);
});
// 계정이 바뀌면 이전 계정의 운동 상태를 화면에서 내리고 수집을 멈춘다(파일은 그 계정이 다시 로그인할 때 쓴다).
onAccountChange(uid => {
  if (state && state.uid !== uid) void stopUpdates(); // 다른 계정의 운동 위치를 이 계정으로 모으거나 보내지 않는다
  loadedFor = undefined;
  state = null;
  emit();
  if (uid) void recoverRun();
});
// 시간 기준 묶음(점이 뜸할 때)과 연결 회복 뒤 재전송
setInterval(() => {
  const r = getRun();
  if (!r) return;
  if (r.status === 'ACTIVE' && shouldFlush(r.buffer, Date.now())) {
    flush(r.buffer, r.ops, r.sessionId, newId);
    put(r);
  }
  if (r.ops.length) void pump();
}, 5000);

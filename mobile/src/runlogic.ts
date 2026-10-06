// 운동 큐의 순수 규칙(React Native·Firebase 없음). `npm test`로 검증한다.
// 거리 규칙은 서버 functions/src/workouts.js validLegEntries와 같다 — 화면 거리와 서버 결과가 어긋나지 않게.

export type Pt = { lat: number; lng: number; accuracyM: number; recordedAt: number; altitudeM: number | null; altitudeAccuracyM: number | null };
export type OpName = 'appendTrack' | 'pauseRun' | 'resumeRun' | 'finishRun' | 'discardRun';
export type Op = { id: string; name: OpName; payload: Record<string, unknown> | null };
export type Pause = { from: number; to: number | null };
export type Tail = { lat: number; lng: number; acc: number; recordedAt: number; segment: number };
// 서버 getRunDetail 중 큐 맞추기에 쓰는 필드
export type ServerSession = {
  id: string; status: string; startedAt: number; lastResumeAt?: number; endedAt?: number | null; activeMs: number; distanceM: number;
  pauses: Pause[]; track: { lat: number; lng: number; acc: number; recordedAt: number; segment: number }[];
};

// 전송 묶음 정책: 위치는 쌓아 두었다가 20점 또는 가장 오래된 점이 20초 지나면 한 요청으로 보낸다.
// 일시정지·종료 직전에는 남은 점을 바로 묶는다. 한 요청은 서버 한도(100점) 안에서 최대 50점.
export const FLUSH_COUNT = 20, FLUSH_MS = 20000, BATCH_MAX = 50;
// 서버 거리 규칙: 같은 구간(segment), 두 점 정확도 30m 이하, 간격 0~60초, 속도 12m/s 이하인 이웃 점만 잇는다.
const LEG_ACC = 30, LEG_MS = 60000, LEG_SPEED = 12;

export function distM(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
// 유효한 구간이면 거리(m), 아니면 null
export function leg(a: Tail, b: Tail) {
  const ms = b.recordedAt - a.recordedAt;
  if (a.segment !== b.segment || a.acc > LEG_ACC || b.acc > LEG_ACC || ms <= 0 || ms > LEG_MS) return null;
  const d = distM([a.lat, a.lng], [b.lat, b.lng]);
  return d / (ms / 1000) > LEG_SPEED ? null : d;
}
export const legM = (a: Tail, b: Tail) => leg(a, b) ?? 0;
// 서버가 점에 붙이는 구간 번호: 그 시각 이전에 끝난 일시정지 수
export const segmentOf = (pauses: Pause[], t: number) => pauses.filter(p => p.to !== null && t >= p.to).length;
export const toTail = (p: Pt, pauses: Pause[]): Tail => ({ lat: p.lat, lng: p.lng, acc: p.accuracyM, recordedAt: p.recordedAt, segment: segmentOf(pauses, p.recordedAt) });

export function trackDistance(tails: Tail[]) {
  let m = 0;
  for (let i = 1; i < tails.length; i++) m += legM(tails[i - 1], tails[i]);
  return m;
}

export const opPoints = (o: Op) => (o.name === 'appendTrack' ? ((o.payload?.points as Pt[]) ?? []) : []);
export const pendingPoints = (ops: Op[], buffer: Pt[]) => [...ops.flatMap(opPoints), ...buffer];

export const shouldFlush = (buffer: Pt[], now: number) => buffer.length >= FLUSH_COUNT || (buffer.length > 0 && now - buffer[0].recordedAt >= FLUSH_MS);

export function flush(buffer: Pt[], ops: Op[], sessionId: string, newId: () => string) {
  while (buffer.length) ops.push({ id: newId(), name: 'appendTrack', payload: { sessionId, points: buffer.splice(0, BATCH_MAX) } });
}

// 서버가 위치 묶음을 거절했을 때(OUT_OF_ORDER·PAUSED_SAMPLE 등) 서버 세션과 맞춘다. 묶음을 통째로 버리지 않는다.
// - 이미 저장된 시각 이하의 점(응답을 잃고 다른 요청으로 저장된 점)은 중복이므로 뺀다.
// - 서버 일시정지 구간 안의 점은 서버 규칙상 저장할 수 없어 뺀다(dropped로 센다).
// - 남은 점은 새 요청 ID로 다시 보낸다(내용이 바뀌었으므로 같은 ID를 쓰지 않는다).
// - 걸러도 그대로면(서버가 다른 이유로 거절) 다시 보내지 않고 rejected에 보관해 화면에 알린다.
export function reconcileRejected(op: Op, server: ServerSession, now: number, newId: () => string) {
  const pts = opPoints(op);
  const last = server.track.at(-1)?.recordedAt ?? server.startedAt - 1;
  const inPause = (t: number) => server.pauses.some(p => t >= p.from && t < (p.to ?? now));
  const dup = pts.filter(p => p.recordedAt <= last).length;
  const keep = pts.filter(p => p.recordedAt > last && !inPause(p.recordedAt));
  const paused = pts.length - dup - keep.length;
  if (keep.length === pts.length) return { replace: [] as Op[], duplicate: 0, dropped: 0, rejected: pts };
  return {
    replace: keep.length ? [{ id: newId(), name: 'appendTrack' as const, payload: { ...op.payload, points: keep } }] : [],
    duplicate: dup,
    dropped: paused,
    rejected: [] as Pt[],
  };
}

// 서버 저장분 + 아직 안 보낸 점으로 화면 거리를 다시 계산한다(서버와 같은 규칙).
export function rebuildDistance(serverTrack: Tail[], pending: Pt[], pauses: Pause[]) {
  const tails = [...serverTrack, ...pending.map(p => toTail(p, pauses))];
  return { localM: trackDistance(tails), tail: tails.at(-1) ?? null };
}

// 종료·폐기 시각: 누른 순간. 서버 허용 범위(ACTIVE: 마지막 재개·마지막 위치점 이후, PAUSED: 일시정지 시작 이후)에 맞춘다.
export function endTime(now: number, status: 'ACTIVE' | 'PAUSED', startedAt: number, pauses: Pause[], lastAt: number) {
  if (status === 'PAUSED') return Math.max(now, pauses.at(-1)?.from ?? startedAt);
  return Math.max(now, lastAt + 1, pauses.at(-1)?.to ?? startedAt, startedAt);
}

// 표시용 활동 시간. 종료를 누른 뒤에는 그 시각에서 멈춘다(늦게 도착한 종료가 시간을 늘리지 않게).
export function activeAt(startedAt: number, pauses: Pause[], now: number, endAt: number | null) {
  const t = endAt ?? now;
  return Math.max(0, t - startedAt - pauses.reduce((n, p) => n + Math.max(0, Math.min(p.to ?? t, t) - p.from), 0));
}

// 화면 지도용 축약 경로 [위도, 경도, 시각, 구간]. 10m 이상 움직였거나 구간이 바뀐 점만 남기고 최대 1,500점.
// 그릴 때는 구간이 바뀌거나 60초 넘게 비면 선을 끊는다(서버 경로 표시와 같은 기준).
export type Trail = [number, number, number, number][];
const TRAIL_MIN_M = 10, TRAIL_MAX = 1500;
export function addTrail(trail: Trail, t: Tail) {
  const last = trail.at(-1);
  if (last && last[3] === t.segment && distM([last[0], last[1]], [t.lat, t.lng]) < TRAIL_MIN_M) return;
  trail.push([t.lat, t.lng, t.recordedAt, t.segment]);
  if (trail.length > TRAIL_MAX) trail.splice(1, 2); // ponytail: 오래된 앞부분부터 성기게. 아주 긴 운동은 서버 상세 경로를 본다
}
export function trailLines(trail: Trail) {
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [];
  trail.forEach((p, i) => {
    const prev = trail[i - 1];
    if (prev && (prev[3] !== p[3] || p[2] - prev[2] > LEG_MS)) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
    }
    cur.push([p[0], p[1]]);
  });
  if (cur.length > 1) lines.push(cur);
  return lines;
}

// 결과 지도: 서버 거리 규칙으로 유효한 이웃 점만 이어 선으로 만든다(정지·끊김·부정확 구간은 잇지 않는다)
export function validSegments(track: Tail[]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (leg(a, b) !== null) {
      if (!cur.length) cur.push([a.lat, a.lng]);
      cur.push([b.lat, b.lng]);
    } else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

// 워치(Wear OS) 연결의 순수 규칙(React Native·Firebase 없음). wear.ts가 쓰고 `npm test`(wearlogic.test.ts)로 검증한다.
// 계약: docs/wear/PROTOCOL.md. 워치 쪽 watch/app/src/main/java/com/attentionall/uirun/watch/Protocol.kt와 필드를 맞춘다.
import type { Participation, Result } from './core';

export const PROTOCOL_VERSION = 1;
export const START_PENDING_MS = 120_000; // 폰이 앞에 없을 때 받은 워치 시작·재개 요청: 이 시간 안에 우이런을 열면 확인 후 이어간다
export const ALERT_CLAIM_MS = 4_000; // 워치가 체크포인트를 알렸다고 답하길 기다리는 시간(넘으면 폰이 알린다)
export const VISIBLE_INTERVAL_MS = 1_000; // 워치 화면이 보일 때 수치 갱신 간격(상태 변화·체크포인트·결과는 즉시)
export const HIDDEN_INTERVAL_MS = 15_000;
export const WATCH_VISIBLE_TTL_MS = 25_000; // 워치 HELLO(10초마다)가 끊기면 화면이 꺼진 것으로 본다
export const RADIUS_M = 40; // 서버 policy validationRadiusM(응답 버튼 표시 판단에만, 최종 판단은 서버)
export const COMMAND_BOOK_MAX = 50;

export type CommandType = 'HELLO' | 'START' | 'PAUSE' | 'RESUME' | 'FINISH' | 'RETRY_FINISH' | 'QUICK' | 'PHOTO' | 'ALERT_SHOWN';
export type Answer = 'PRESENT' | 'ABSENT' | 'UNKNOWN';
export type Command = {
  v: number; id: string; type: CommandType; epoch?: number; sessionId?: string; revision?: number;
  mode?: 'RUN' | 'WALK'; exposureId?: string; answer?: Answer; visible?: boolean;
};
// RECEIVED: 받음(처리 중) · DONE: 폰 엔진 처리 완료 · REJECTED: 검증 거절 · NEEDS_PHONE: 폰 화면에서 확인 필요
export type AckStatus = 'RECEIVED' | 'DONE' | 'REJECTED' | 'NEEDS_PHONE';
export type Ack = { v: number; id: string; status: AckStatus; code?: string; sessionId?: string; opened?: boolean; phoneLocked?: boolean; jsReady?: boolean };

export const ack = (id: string, status: AckStatus, extra: Partial<Ack> = {}): Ack => ({ v: PROTOCOL_VERSION, id, status, ...extra });

export function parseCommand(json: string): Command | null {
  try {
    const c = JSON.parse(json);
    return c && typeof c === 'object' && typeof c.v === 'number' && typeof c.id === 'string' && c.id && typeof c.type === 'string' ? (c as Command) : null;
  } catch {
    return null;
  }
}

type RunRef = { sessionId: string; status: 'ACTIVE' | 'PAUSED' | 'ENDING' | 'ENDED' } | null;
// 명령 검증: 버전 → 계정 세대 → 로그인 → 같은 세션. 문제가 있으면 보낼 ACK, 없으면 null.
// 시작은 세션 ID 없이 받는다(이미 운동 중이면 엔진이 그 운동을 돌려준다 — 새 세션을 만들지 않는다).
export function check(c: Command, ctx: { epoch: number; uid: string | null; run: RunRef }): Ack | null {
  if (c.v !== PROTOCOL_VERSION) return ack(c.id, 'REJECTED', { code: 'UNSUPPORTED_VERSION' });
  if (c.type === 'HELLO' || c.type === 'ALERT_SHOWN') return null;
  if (c.epoch !== ctx.epoch) return ack(c.id, 'REJECTED', { code: 'ACCOUNT_CHANGED' });
  if (!ctx.uid) return ack(c.id, 'NEEDS_PHONE', { code: 'LOGIN_REQUIRED' });
  if (c.type === 'START') return null;
  const live = ctx.run && ctx.run.status !== 'ENDED' ? ctx.run : null;
  if (!live || live.sessionId !== c.sessionId) return ack(c.id, 'REJECTED', { code: 'SESSION_MISMATCH' });
  return null;
}

// 서버가 받는 상태 응답만 제출한다. 안 보여요·모르겠어요를 ‘지금도 보여요’로 바꿔 보내지 않는다(서버 계약 추가 전까지 미지원).
export const quickPlan = (answer: string | undefined): 'SUBMIT' | 'UNSUPPORTED' => (answer === 'PRESENT' ? 'SUBMIT' : 'UNSUPPORTED');

// 처리한 명령 결과(같은 commandId가 다시 오면 다시 실행하지 않고 이 결과를 돌려준다). 최근 50건만, 계정별 파일에 남긴다.
export type Book = Record<string, { ack: Ack; at: number }>;
export function remember(book: Book, a: Ack, now: number, max = COMMAND_BOOK_MAX): Book {
  const next: Book = { ...book, [a.id]: { ack: a, at: now } };
  const old = Object.keys(next).sort((x, y) => next[x].at - next[y].at);
  for (const k of old.slice(0, Math.max(0, old.length - max))) delete next[k];
  return next;
}

export type Reward = { saved: boolean; existing: boolean; points: number; pending: number; reason: string | null };
export type QuickView = { commandId: string; exposureId: string; answer: Answer; state: 'SENDING' | 'DONE' | 'FAILED' | 'UNSUPPORTED'; code: string | null; reward: Reward | null };
export type Stage = 'PHONE_RECEIVED' | 'CAMERA_OPENED' | 'CAMERA_PERMISSION' | 'SUBMITTED' | 'SERVER_RESULT' | 'CANCELLED' | 'FAILED' | 'EXPIRED';
export type PhotoView = { requestId: string; exposureId: string; stage: Stage; code: string | null; reward: Reward | null };
export type Summary = { sessionId: string; distanceM: number; activeMs: number; participations: number | null };
export type ExposureView = { id: string; kind: 'ISSUE' | 'ROUTINE'; title: string; distanceM: number | null; answerable: boolean; radiusM: number; expiresInMs: number };

// 서버 참여 결과 → 워치 표시. 지급(points)과 검토 대기(pending)를 나눠 그대로 옮긴다(합치거나 만들지 않는다).
export const rewardOf = (p: Participation): Reward => ({
  saved: p.saved !== false, existing: !!p.existing, points: p.pointsAwarded ?? 0, pending: p.pointsPending ?? 0, reason: p.rewardReason ?? null,
});
export const outcomeOf = (r: Result<Participation>) =>
  r.ok ? { state: 'DONE' as const, code: null, reward: rewardOf(r.value) } : { state: 'FAILED' as const, code: r.errorCode, reward: null };

// 촬영 연결(handoff): 워치 요청 ID 하나 = 같은 계정·운동·Exposure의 촬영 한 건. URI에는 이 ID만 들어간다.
export type Handoff = {
  requestId: string; uid: string; sessionId: string; exposureId: string; kind: 'ISSUE' | 'ROUTINE'; targetId: string; answer: Answer | null;
  expiresAt: number; stage: Stage; code: string | null; reward: Reward | null; nodeId: string | null; createdAt: number;
};
const CLOSED: Stage[] = ['SUBMITTED', 'SERVER_RESULT', 'CANCELLED', 'FAILED', 'EXPIRED'];
// 폰 촬영 화면이 이어서 쓸 수 있는가: 같은 계정, 만료 전, 아직 제출·취소되지 않음
export const handoffUsable = (h: Handoff | null | undefined, uid: string | null, now: number): boolean =>
  !!h && !!uid && h.uid === uid && now < h.expiresAt && !CLOSED.includes(h.stage);
export const photoView = (h: Handoff | null): PhotoView | null =>
  h ? { requestId: h.requestId, exposureId: h.exposureId, stage: h.stage, code: h.code, reward: h.reward } : null;

export const paceSec = (ms: number, m: number) => (m < 10 || ms <= 0 ? null : Math.round(ms / 1000 / (m / 1000)));

export type RunInput = {
  sessionId: string; mode: 'RUN' | 'WALK'; status: 'ACTIVE' | 'PAUSED' | 'ENDING' | 'ENDED'; localM: number; activeMs: number;
  offline: boolean; queued: number; problem: string | null; result: { status: string; distanceM: number; activeMs: number } | null;
};
export type SnapshotInput = {
  uid: string | null; needs: string[]; run: RunInput | null; exposure: ExposureView | null; quick: QuickView | null; photo: PhotoView | null;
  last: Summary | null; participations: number | null;
  preparation?: { phase: string; count: number; outside: boolean; error: string | null; mode: 'RUN' | 'WALK' } | null;
};

// 워치 스냅샷(epoch·revision은 네이티브가 붙인다). 계정이 없으면 운동·결과를 넣지 않는다.
export function buildSnapshot(i: SnapshotInput, now: number) {
  const r = i.uid ? i.run : null;
  const dist = r ? (r.result ? r.result.distanceM : r.localM) : 0;
  const saved = r && r.status === 'ENDED' && r.result && r.result.status !== 'DISCARDED';
  return {
    v: PROTOCOL_VERSION,
    observedAt: now,
    account: { signedIn: !!i.uid, needs: i.uid ? i.needs : ['LOGIN'] },
    session: r
      ? {
          sessionId: r.sessionId, status: r.status, mode: r.mode, distanceM: dist, activeMs: r.activeMs, paceSecPerKm: paceSec(r.activeMs, dist),
          sync: r.offline ? 'OFFLINE' : r.queued ? 'SENDING' : 'OK', problem: r.problem,
          result: saved ? { sessionId: r.sessionId, distanceM: r.result!.distanceM, activeMs: r.result!.activeMs, participations: i.participations } : null,
        }
      : null,
    exposure: r?.status === 'ACTIVE' && i.exposure && i.exposure.expiresInMs > 0 ? i.exposure : null,
    quick: i.uid ? i.quick : null,
    photo: i.uid ? i.photo : null,
    last: i.uid ? i.last : null,
    preparation: i.uid && !r ? i.preparation ?? null : null,
  };
}

// 바로 보낼 변화(상태·체크포인트·응답·촬영 단계·계정)를 가르는 키. 거리·시간만 바뀌면 간격을 둔다(시간은 워치가 보간).
export function eventKey(s: ReturnType<typeof buildSnapshot>) {
  const x = s.session;
  return JSON.stringify([s.account, x && [x.sessionId, x.status, x.sync, x.problem, x.result], s.exposure && [s.exposure.id, s.exposure.answerable], s.quick, s.photo, s.last, s.preparation]);
}
export const publishDue = (prev: { key: string; at: number } | null, key: string, now: number, watchVisible: boolean) =>
  !prev || prev.key !== key || now - prev.at >= (watchVisible ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS);

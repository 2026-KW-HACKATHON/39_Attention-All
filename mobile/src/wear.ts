// 워치(Wear OS) 연결. 폰 운동 엔진(run.ts)이 유일한 권위다. 워치 명령은 폰 화면 버튼과 같은 함수(startRun·pauseRun·finishRun…)로 처리하고,
// 결과는 ACK(명령별)와 스냅샷(Data Layer, 최신 상태 1건)으로 알린다. 워치는 거리·보상을 계산하지 않는다. 계약: docs/wear/PROTOCOL.md
// - 네이티브 모듈이 없거나(재빌드 전 개발 빌드) 우이런 워치가 없으면 아무것도 하지 않는다.
// - 이벤트로만 동작한다(Android에서 앱이 백그라운드면 JS 타이머가 돌지 않는다). 기다림이 필요한 곳은 네이티브가 한다.
// - 폰이 앞에 없으면(잠금·백그라운드) 운동 시작·재개를 하지 않는다: Android가 백그라운드 위치 서비스 시작을 막는다.
//   폰 알림을 띄우고, 사용자가 우이런을 열면 확인 뒤 같은 요청을 이어간다. 일시정지·종료·응답은 백그라운드에서도 처리한다.
import { Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import Bridge from '../modules/uirun-wear-bridge';
import { activeMs, finishRun, getRun, pauseRun, pump, resumeRun, startRun, subscribeRun, wearHooks, type Exposure, type Run } from './run';
import { getUid, onAccountChange } from './session';
import { call, CONFIG, watchUser } from './firebase';
import { nearestM, quickFromExposure } from './exposure';
import { readJson, StoreError, writeJson } from './store';
import { consentNeeded, type Issue, type MapData, type Settings } from './core';
import {
  ack, ALERT_CLAIM_MS, buildSnapshot, check, eventKey, handoffUsable, outcomeOf, parseCommand, photoView, publishDue, quickPlan, RADIUS_M, remember,
  START_PENDING_MS, WATCH_VISIBLE_TTL_MS, type Ack, type Book, type Command, type ExposureView, type Handoff, type QuickView, type Reward, type Stage, type Summary,
} from './wearlogic';

// 계정별 파일 wear-<uid>.json: 처리한 명령 결과(중복 commandId), 마지막 간단 응답, 촬영 연결, 마지막 종료 요약
type WearState = { book: Book; quick: QuickView | null; handoff: Handoff | null; last: Summary | null };
const EMPTY: WearState = { book: {}, quick: null, handoff: null, last: null };
let st: WearState = EMPTY;
let stUid: string | null = null;
const listeners = new Set<() => void>();
export const subscribeWear = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

function state(): WearState {
  const uid = getUid();
  if (uid !== stUid) {
    stUid = uid;
    try {
      st = uid ? { ...EMPTY, ...readJson<WearState>(`wear-${uid}.json`, EMPTY) } : EMPTY;
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      st = EMPTY;
    }
  }
  return st;
}
function update(fn: (s: WearState) => WearState) {
  const uid = getUid();
  if (!uid) return;
  st = fn(state());
  writeJson(`wear-${uid}.json`, st);
  listeners.forEach(f => f());
  void publish();
}

// ---------- 계정·워치 ----------
let epoch = 0;
let epochUid: string | null | undefined; // undefined: 계정 확인 전(아무것도 보내지 않는다)
let watch = false; // 우이런 워치 앱이 있는 워치와 짝지어져 있음
let watchSeenAt = 0; // 워치 화면이 보인다고 마지막으로 알린 시각
let needs: string[] = [];
let needsAt = 0;
let pending: { c: Command; nodeId: string | null; at: number } | null = null; // 폰이 앞에 없을 때 받은 시작·재개
const inflight = new Set<string>();
const claims = new Map<string, Promise<boolean>>();
const info = new Map<string, { title: string; anchors: [number, number][] }>();
const infoLoading = new Map<string, Promise<void>>();
const resumed = new Set<string>();

// 계정이 바뀌면(로그아웃 포함) 새 세대를 받고 이전 계정의 대기 요청·표시 정보를 버린다. 워치는 세대가 바뀌면 이전 표시를 모두 지운다.
function syncAccount(uid: string | null) {
  if (!Bridge || epochUid === uid) return;
  epoch = Bridge.setAccount(uid);
  epochUid = uid;
  lastPub = null;
  needs = [];
  needsAt = 0;
  pending = null;
  claims.clear();
  info.clear();
  void refreshNeeds();
  void publish(true);
}

async function detectWatch() {
  if (!Bridge) return;
  watch = await Bridge.hasWatch(false).catch(() => false);
  if (__DEV__) console.log('[wear] 우이런 워치 앱 capability(uirun_watch_app) 발견:', watch);
  if (watch) void publish(true);
}

// 워치 W0 준비 확인용: 로그인·약관·위치 권한(정확한 위치). 폰에서만 처리한다.
async function refreshNeeds() {
  const uid = getUid();
  needsAt = Date.now();
  if (!uid || !watch) return;
  const n: string[] = [];
  const p = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!p?.granted) n.push('LOCATION_PERMISSION');
  else if (p.android && p.android.accuracy !== 'fine') n.push('PRECISE_LOCATION');
  try {
    if (consentNeeded(await call<Settings>('getSettings', {}), CONFIG.consentVersion)) n.push('CONSENT');
  } catch {
    // 조회 실패: 모름으로 둔다(시작 요청에서 서버가 CONSENT_REQUIRED로 알려준다)
  }
  if (getUid() !== uid) return;
  needs = n;
  void publish(true);
}

const watchVisible = () => Date.now() - watchSeenAt < WATCH_VISIBLE_TTL_MS;

// ---------- 스냅샷 ----------
let lastPub: { key: string; at: number } | null = null;

function exposureView(r: Run): ExposureView | null {
  const ex = r.exposure;
  if (!ex || r.status !== 'ACTIVE') return null;
  const left = ex.expiresAt - Date.now();
  if (left <= 0) return null;
  void ensureInfo(ex);
  const i = info.get(ex.id);
  const here = r.last && Date.now() - r.last.measuredAt < 10000 && r.last.accuracyM <= 30 ? r.last : null;
  const d = i ? nearestM(here, i.anchors) : null;
  return { id: ex.id, kind: ex.kind, title: i?.title ?? '', distanceM: d, answerable: ex.kind === 'ISSUE' && d != null && d <= RADIUS_M, radiusM: RADIUS_M, expiresInMs: left };
}

// 체크포인트 이름·관찰 기준점(서버 공개 정보). 워치 화면 제목과 남은 거리에만 쓴다.
function ensureInfo(ex: Exposure) {
  if (info.has(ex.id)) return Promise.resolve();
  let p = infoLoading.get(ex.id);
  if (!p) {
    p = (async () => {
      try {
        if (ex.kind === 'ISSUE') {
          const d = await call<{ issue: Issue }>('getIssueDetail', { issueId: ex.targetId });
          info.set(ex.id, { title: d.issue.categoryLabel ?? '체크포인트', anchors: d.issue.observationAnchors?.length ? d.issue.observationAnchors : [d.issue.anchor] });
        } else {
          const m = await call<MapData>('getMapData', {});
          const rt = m.routines.find(x => x.id === ex.targetId);
          info.set(ex.id, { title: rt?.name ?? '정기 관찰 지점', anchors: rt?.anchors ?? [] });
        }
      } catch {
        info.set(ex.id, { title: ex.kind === 'ISSUE' ? '체크포인트' : '정기 관찰 지점', anchors: [] });
      }
      infoLoading.delete(ex.id);
      void publish(true);
    })();
    infoLoading.set(ex.id, p);
  }
  return p;
}

function snapshot() {
  const uid = getUid(), r = getRun(), s = state(), now = Date.now();
  return buildSnapshot(
    {
      uid,
      needs,
      run: r ? { sessionId: r.sessionId, mode: r.mode, status: r.status, localM: r.localM, activeMs: activeMs(r, now), offline: r.offline, queued: r.ops.length, problem: r.problem, result: r.result } : null,
      exposure: r ? exposureView(r) : null,
      quick: s.quick,
      photo: photoView(s.handoff),
      last: s.last,
      participations: r && s.last?.sessionId === r.sessionId ? s.last.participations : null,
    },
    now,
  );
}

async function publish(force = false) {
  if (!Bridge || !watch || epochUid === undefined || getUid() !== epochUid) return; // 계정 확인 전·계정 전환 중에는 보내지 않는다
  const s = snapshot();
  const key = eventKey(s), now = Date.now();
  if (!force && !publishDue(lastPub, key, now, watchVisible())) return;
  lastPub = { key, at: now };
  await Bridge.publish(JSON.stringify(s)).catch(() => {
    lastPub = null;
  });
}

// 새 운동이 시작되면 이전 종료 요약을 지우고, 서버가 종료를 확인하면 요약(+참여 횟수)을 남긴다.
function onRunChange() {
  const r = getRun(), s = state();
  if (r && (r.status === 'ACTIVE' || r.status === 'PAUSED') && s.last && s.last.sessionId !== r.sessionId) update(x => ({ ...x, last: null }));
  if (r?.status === 'ENDED' && r.result && r.result.status !== 'DISCARDED' && s.last?.sessionId !== r.sessionId) {
    const sessionId = r.sessionId;
    update(x => ({ ...x, last: { sessionId, distanceM: r.result!.distanceM, activeMs: r.result!.activeMs, participations: null } }));
    void call<{ participationStats?: { total: number } }>('getRunDetail', { sessionId, limit: 1 })
      .then(d => update(x => (x.last?.sessionId === sessionId ? { ...x, last: { ...x.last, participations: d.participationStats?.total ?? null } } : x)))
      .catch(() => {});
  }
  void publish();
}

// ---------- 체크포인트 알림 경로 ----------
// 지금 연결된 워치가 있으면 워치에 먼저 보내고, 워치가 사용자에게 알렸다는 ACK(ALERT_SHOWN)를 받으면 폰 진동·알림을 생략한다.
// 연결된 워치가 없거나 정해진 시간 안에 ACK가 없으면(워치 알림 권한 없음·끊김) 폰이 알린다. 같은 exposureId는 한 번만 판단한다.
function claimAlert(exposureId: string): Promise<boolean> {
  let p = claims.get(exposureId);
  if (!p) {
    p = (async () => {
      if (!Bridge || !watch || !(await Bridge.hasWatch(true).catch(() => false))) return false;
      const ex = getRun()?.exposure;
      if (ex?.id === exposureId) await ensureInfo(ex);
      await publish(true);
      return Bridge.awaitAlertShown(exposureId, ALERT_CLAIM_MS).catch(() => false);
    })();
    claims.set(exposureId, p);
  }
  return p;
}

// ---------- 명령 ----------
const send = (nodeId: string | null, a: Ack) => Bridge?.ack(nodeId, JSON.stringify(a)).catch(() => {});
function settle(c: Command, nodeId: string | null, a: Ack) {
  update(x => ({ ...x, book: remember(x.book, a, Date.now()) }));
  void send(nodeId, a);
}
const foreground = () => AppState.currentState === 'active';
const locked = () => Bridge?.isPhoneLocked() ?? false;

async function onCommand(json: string, nodeId: string | null) {
  watch = true;
  const c = parseCommand(json);
  if (!c) return;
  if (c.type === 'HELLO') return hello(c);
  if (c.type === 'ALERT_SHOWN') return; // 네이티브가 기록한다(awaitAlertShown)
  const done = state().book[c.id];
  if (done) return void send(nodeId, done.ack); // 같은 명령은 다시 실행하지 않고 같은 결과를 돌려준다
  if (inflight.has(c.id)) return void send(nodeId, ack(c.id, 'RECEIVED'));
  const r = getRun();
  const bad = check(c, { epoch, uid: getUid(), run: r && { sessionId: r.sessionId, status: r.status } });
  if (bad) return settle(c, nodeId, bad);
  inflight.add(c.id);
  try {
    await handle(c, nodeId);
  } catch {
    settle(c, nodeId, ack(c.id, 'REJECTED', { code: 'PHONE_ERROR' }));
  } finally {
    inflight.delete(c.id);
  }
}

function hello(c: Command) {
  watchSeenAt = c.visible === false ? 0 : Date.now();
  lastPub = null; // 다시 연결되면 최신 상태를 바로 보낸다
  if (Date.now() - needsAt > 60_000) void refreshNeeds();
  void publish(true);
}

async function handle(c: Command, nodeId: string | null) {
  const r = getRun();
  switch (c.type) {
    case 'START': {
      if (r && r.status !== 'ENDED') return settle(c, nodeId, ack(c.id, 'DONE', { sessionId: r.sessionId })); // 이미 운동 중: 같은 운동
      if (!foreground()) return later(c, nodeId);
      const p = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!p?.granted) return settle(c, nodeId, ack(c.id, 'NEEDS_PHONE', { code: 'LOCATION_PERMISSION_REQUIRED' }));
      void send(nodeId, ack(c.id, 'RECEIVED'));
      const res = await startRun(c.mode === 'WALK' ? 'WALK' : 'RUN', null); // 폰 화면 시작과 같은 처리(동시에 눌러도 한 운동)
      if (!res.ok) return settle(c, nodeId, ack(c.id, res.errorCode === 'CONSENT_REQUIRED' || res.errorCode === 'UNAUTHENTICATED' ? 'NEEDS_PHONE' : 'REJECTED', { code: res.errorCode }));
      await publish(true);
      settle(c, nodeId, ack(c.id, 'DONE', { sessionId: res.value.sessionId }));
      if (foreground()) router.push('/run' as never);
      return;
    }
    case 'PAUSE':
      if (r!.status === 'ACTIVE') await pauseRun();
      await publish(true);
      return settle(c, nodeId, ack(c.id, 'DONE', { sessionId: r!.sessionId }));
    case 'RESUME':
      if (r!.status === 'PAUSED') {
        if (!foreground()) return later(c, nodeId);
        await resumeRun();
      }
      await publish(true);
      return settle(c, nodeId, ack(c.id, 'DONE', { sessionId: r!.sessionId }));
    case 'FINISH':
      // 종료 시각은 폰이 이 명령을 받아 처리한 순간(엔진 규칙). 워치 시계 값을 쓰지 않는다. 서버 오프라인이면 기존 큐가 같은 시각으로 보낸다.
      if (r!.status === 'ACTIVE' || r!.status === 'PAUSED') await finishRun();
      await publish(true);
      return settle(c, nodeId, ack(c.id, 'DONE', { sessionId: r!.sessionId }));
    case 'RETRY_FINISH':
      if (r!.status === 'ENDING') void pump(); // 이미 큐에 있는 같은 종료 요청(같은 요청 ID)을 다시 보낸다. 새 운동·새 종료를 만들지 않는다
      return settle(c, nodeId, ack(c.id, 'DONE', { sessionId: r!.sessionId }));
    case 'QUICK':
      return quick(c, nodeId, r!);
    case 'PHOTO':
      return photo(c, nodeId, r!);
  }
}

// 폰이 앞에 없을 때의 시작·재개: 실행하지 않고 알린다. 우이런을 열면 확인 창에서 이어간다(2분 안).
async function later(c: Command, nodeId: string | null) {
  pending = { c, nodeId, at: Date.now() };
  void notifyPhone(c.type === 'START' ? '워치에서 운동 시작을 요청했어요' : '워치에서 운동 재개를 요청했어요', '눌러서 우이런에서 확인해 주세요');
  settle(c, nodeId, ack(c.id, 'NEEDS_PHONE', { code: 'PHONE_FOREGROUND_REQUIRED', phoneLocked: locked() }));
}

function confirmPending() {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > START_PENDING_MS || !foreground()) return;
  const start = p.c.type === 'START';
  const what = start ? `${p.c.mode === 'WALK' ? '산책' : '달리기'} 시작` : '운동 재개';
  Alert.alert('워치 요청', `워치에서 ${what}을 요청했어요. 지금 할까요?`, [
    { text: '취소', style: 'cancel', onPress: () => settle(p.c, p.nodeId, ack(p.c.id, 'REJECTED', { code: 'CANCELLED_ON_PHONE' })) },
    {
      text: start ? '시작' : '재개',
      onPress: () => {
        const r = getRun();
        const bad = check(p.c, { epoch, uid: getUid(), run: r && { sessionId: r.sessionId, status: r.status } });
        if (bad) return settle(p.c, p.nodeId, bad);
        void handle(p.c, p.nodeId);
      },
    },
  ]);
}

// 간단 응답: 응답마다 한 번만 만든다. 지금 서버는 ‘지금도 보여요’(PRESENT)만 받는다 — 다른 응답은 제출하지 않고 미지원으로 알린다.
async function quick(c: Command, nodeId: string | null, r: Run) {
  const ex = r.exposure;
  const answer = c.answer ?? 'PRESENT';
  const base = { commandId: c.id, exposureId: c.exposureId ?? '', answer } as const;
  if (!ex || ex.id !== c.exposureId || Date.now() >= ex.expiresAt) {
    update(x => ({ ...x, quick: { ...base, state: 'FAILED', code: 'EXPOSURE_EXPIRED', reward: null } }));
    return settle(c, nodeId, ack(c.id, 'REJECTED', { code: 'EXPOSURE_EXPIRED' }));
  }
  if (quickPlan(answer) === 'UNSUPPORTED') {
    update(x => ({ ...x, quick: { ...base, state: 'UNSUPPORTED', code: 'ANSWER_NOT_SUPPORTED', reward: null } }));
    return settle(c, nodeId, ack(c.id, 'REJECTED', { code: 'ANSWER_NOT_SUPPORTED' }));
  }
  update(x => ({ ...x, quick: { ...base, state: 'SENDING', code: null, reward: null } }));
  void send(nodeId, ack(c.id, 'RECEIVED'));
  // 폰 화면 알림 카드·OS 알림과 같은 함수(같은 요청 슬롯 — 같은 날 같은 관찰은 서버가 기존 결과로 답한다)
  const o = outcomeOf(await quickFromExposure(ex, r.sessionId));
  update(x => (x.quick?.commandId === c.id ? { ...x, quick: { ...x.quick, ...o } } : x));
  settle(c, nodeId, ack(c.id, o.state === 'DONE' ? 'DONE' : 'REJECTED', o.code ? { code: o.code } : {}));
}

// 촬영 연결: 문맥(계정·운동·Exposure·대상)은 여기 보관하고 워치에는 요청 ID만 쓴다. 폰이 앞에 있으면 바로 앱 안 카메라를 연다.
// 같은 요청 ID가 다시 오면 같은 촬영으로 다시 연다(새 촬영·새 제출을 만들지 않는다).
async function photo(c: Command, nodeId: string | null, r: Run) {
  const uid = getUid()!;
  const cur = state().handoff;
  let h = cur?.requestId === c.id ? cur : null;
  if (h && !handoffUsable(h, uid, Date.now())) return void send(nodeId, ack(c.id, 'RECEIVED', { opened: true })); // 이미 끝남: 단계는 스냅샷으로
  if (!h) {
    const ex = r.exposure;
    if (!ex || ex.id !== c.exposureId || Date.now() >= ex.expiresAt) return settle(c, nodeId, ack(c.id, 'REJECTED', { code: 'EXPOSURE_EXPIRED' }));
    // 관찰 사진 재확인은 ‘아직 있어요’ 응답에만 잇는다(안 보여요·모르겠어요 사진은 서버 계약이 없다). 정기 관찰은 응답 없이 사진.
    if (ex.kind === 'ISSUE' && quickPlan(c.answer) !== 'SUBMIT') return settle(c, nodeId, ack(c.id, 'REJECTED', { code: 'PHOTO_NOT_FOR_ANSWER' }));
    h = { requestId: c.id, uid, sessionId: r.sessionId, exposureId: ex.id, kind: ex.kind, targetId: ex.targetId, answer: c.answer ?? null, expiresAt: ex.expiresAt, stage: 'PHONE_RECEIVED', code: null, reward: null, nodeId, createdAt: Date.now() };
    const next = h;
    update(x => ({ ...x, handoff: next }));
  }
  const opened = foreground() && openCapture(h.requestId);
  if (!opened) void notifyPhone('워치에서 체크포인트 촬영을 요청했어요', '눌러서 우이런 안에서 촬영을 이어가요', h.requestId);
  void send(nodeId, ack(c.id, 'RECEIVED', { opened, phoneLocked: locked() }));
}

function openCapture(req: string) {
  if (resumed.has(req)) return true; // 이미 열림(워치 원격 열기 딥링크·알림으로 연 화면) — 같은 화면을 두 번 쌓지 않는다
  resumed.add(req);
  router.push(`/wear-capture?req=${encodeURIComponent(req)}` as never);
  return true;
}
// 촬영 화면이 딥링크로 먼저 열렸을 때 알린다
export const markCaptureOpen = (req: string) => void resumed.add(req);

// 앱 안 촬영 화면이 단계를 알린다. 워치는 스냅샷 photo.stage로 받는다.
export const getHandoff = (req: string | undefined) => {
  const h = state().handoff;
  return req && h?.requestId === req ? h : null;
};
export function handoffStage(req: string, stage: Stage, extra: { code?: string | null; reward?: Reward | null } = {}) {
  update(x => (x.handoff?.requestId === req ? { ...x, handoff: { ...x.handoff, stage, code: extra.code ?? null, reward: extra.reward ?? null } } : x));
}

// 사용자가 우이런을 직접 열었을 때도 같은 계정의 아직 유효한 촬영 연결을 이어간다(요청마다 한 번 자동으로 연다).
function resumeHandoff() {
  const h = state().handoff;
  if (!h || !foreground() || !handoffUsable(h, getUid(), Date.now()) || h.stage !== 'PHONE_RECEIVED' || resumed.has(h.requestId)) return;
  openCapture(h.requestId);
}

// 앱 JS가 없을 때 네이티브가 받아 둔 시작·촬영 요청. 시간이 지난 것은 버린다(오래된 명령을 재생하지 않는다).
function drainNative() {
  if (!Bridge) return;
  let list: { json: string; nodeId: string; receivedAt: number }[] = [];
  try {
    list = JSON.parse(Bridge.takePending());
  } catch {
    return;
  }
  for (const p of list) {
    const c = parseCommand(p.json);
    if (!c || Date.now() - p.receivedAt > START_PENDING_MS) continue;
    if (c.type === 'START') pending = { c, nodeId: p.nodeId, at: p.receivedAt };
    else void onCommand(p.json, p.nodeId);
  }
}

let channel: Promise<unknown> | null = null;
async function notifyPhone(title: string, body: string, req?: string) {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    channel ??= Notifications.setNotificationChannelAsync('wear', { name: '워치 요청', importance: Notifications.AndroidImportance.HIGH, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE });
    await channel;
    await Notifications.scheduleNotificationAsync({ identifier: 'wear-request', content: { title, body, data: { wearRequest: req ?? null } }, trigger: { channelId: 'wear' } });
  } catch {
    // 알림 실패: 워치가 ‘폰에서 우이런을 열어주세요’를 보여준다
  }
}

// 앱 화면(루트 레이아웃)이 계정 확인 뒤·앞으로 올 때 부른다: 보관 요청 처리, 시작 확인, 촬영 이어가기.
export function wearForeground() {
  if (!Bridge || epochUid === undefined) return;
  drainNative();
  confirmPending();
  resumeHandoff();
  void detectWatch();
  void refreshNeeds();
}

// ---------- 시작 ----------
if (Bridge) {
  Bridge.addListener('onCommand', e => void onCommand(e.json, e.nodeId));
  wearHooks.claimAlert = claimAlert;
  subscribeRun(onRunChange);
  onAccountChange(uid => {
    syncAccount(uid);
    void publish(true);
  });
  // 처음 로그아웃 상태로 시작하면 onAccountChange가 오지 않는다. Firebase 인증 확인 결과로 계정 세대를 정한다.
  void watchUser(u => syncAccount(u?.uid ?? null)).catch(() => {});
  AppState.addEventListener('change', s => {
    if (__DEV__) Bridge?.diagnose?.('appstate-' + s); // 임시 진단: 앞뒤 전환 뒤에도 capability가 그대로인지
    return s === 'active' ? wearForeground() : void publish(true);
  });
  void detectWatch();
  if (__DEV__) {
    console.log('[wear] 워치 브리지 초기화(네이티브 모듈 UirunWearBridge 로드됨)');
    Bridge.diagnose?.('js-init');
  }
} else if (__DEV__) {
  console.log('[wear] 네이티브 모듈 UirunWearBridge 없음 — 워치 연결 꺼짐(이 개발 빌드에 모듈이 포함되지 않음)');
}

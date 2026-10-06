// node --test src/wearlogic.test.ts — 워치 명령 검증·중복·스냅샷·응답 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ack, buildSnapshot, check, eventKey, handoffUsable, outcomeOf, parseCommand, publishDue, quickPlan, remember,
  HIDDEN_INTERVAL_MS, VISIBLE_INTERVAL_MS, type Command, type Handoff, type RunInput,
} from './wearlogic.ts';

const cmd = (x: Partial<Command>): Command => ({ v: 1, id: 'c1', type: 'PAUSE', epoch: 7, sessionId: 's1', ...x });
const ctx = { epoch: 7, uid: 'u1', run: { sessionId: 's1', status: 'ACTIVE' as const } };

test('명령 검증: 버전·계정 세대·로그인·같은 세션 순서로 거절한다', () => {
  assert.equal(check(cmd({ v: 2 }), ctx)?.code, 'UNSUPPORTED_VERSION');
  assert.equal(check(cmd({ epoch: 6 }), ctx)?.code, 'ACCOUNT_CHANGED');
  assert.deepEqual(check(cmd({}), { ...ctx, uid: null }), ack('c1', 'NEEDS_PHONE', { code: 'LOGIN_REQUIRED' }));
  assert.equal(check(cmd({ sessionId: 'other' }), ctx)?.code, 'SESSION_MISMATCH');
  assert.equal(check(cmd({}), { ...ctx, run: { sessionId: 's1', status: 'ENDED' } })?.code, 'SESSION_MISMATCH');
  assert.equal(check(cmd({}), ctx), null);
  // 시작은 세션 없이 받는다(이미 운동 중이면 엔진이 같은 운동을 돌려준다). HELLO는 계정 세대를 몰라도 받는다.
  assert.equal(check(cmd({ type: 'START', sessionId: undefined }), { ...ctx, run: null }), null);
  assert.equal(check(cmd({ type: 'HELLO', epoch: undefined }), ctx), null);
});

test('깨진 명령은 버린다', () => {
  assert.equal(parseCommand('{'), null);
  assert.equal(parseCommand('{"v":1,"type":"PAUSE"}'), null);
  assert.equal(parseCommand('{"v":1,"id":"a","type":"PAUSE"}')?.id, 'a');
});

test('안 보여요·모르겠어요는 지금도 보여요로 바꿔 제출하지 않는다', () => {
  assert.equal(quickPlan('PRESENT'), 'SUBMIT');
  assert.equal(quickPlan('ABSENT'), 'UNSUPPORTED');
  assert.equal(quickPlan('UNKNOWN'), 'UNSUPPORTED');
  assert.equal(quickPlan(undefined), 'UNSUPPORTED');
});

test('같은 commandId는 같은 결과를 돌려주고, 기록은 최근 것만 남긴다', () => {
  let b = remember({}, ack('a', 'DONE', { sessionId: 's1' }), 1);
  b = remember(b, ack('b', 'REJECTED', { code: 'SESSION_MISMATCH' }), 2);
  assert.deepEqual(b.a.ack, ack('a', 'DONE', { sessionId: 's1' }));
  b = remember(b, ack('c', 'DONE'), 3, 2);
  assert.deepEqual(Object.keys(b).sort(), ['b', 'c']);
});

const run = (x: Partial<RunInput> = {}): RunInput => ({ sessionId: 's1', mode: 'RUN', status: 'ACTIVE', localM: 2840, activeMs: 1_056_000, offline: false, queued: 0, problem: null, result: null, ...x });
const ex = { id: 'e1', kind: 'ISSUE' as const, title: '수면 거품', distanceM: 24, answerable: true, radiusM: 40, expiresInMs: 60_000 };
const base = { uid: 'u1', needs: [], run: run(), exposure: ex, quick: null, photo: null, last: null, participations: null };

test('스냅샷: 같은 세션 수치, 10m 미만 페이스 없음, 일시정지·만료 체크포인트는 보내지 않음', () => {
  const s = buildSnapshot(base, 100);
  assert.equal(s.session?.paceSecPerKm, 372);
  assert.equal(s.session?.sync, 'OK');
  assert.equal(s.exposure?.id, 'e1');
  assert.equal(buildSnapshot({ ...base, run: run({ localM: 9 }) }, 1).session?.paceSecPerKm, null);
  assert.equal(buildSnapshot({ ...base, run: run({ status: 'PAUSED' }) }, 1).exposure, null);
  assert.equal(buildSnapshot({ ...base, exposure: { ...ex, expiresInMs: 0 } }, 1).exposure, null);
  assert.equal(buildSnapshot({ ...base, run: run({ status: 'ENDING', offline: true }) }, 1).session?.sync, 'OFFLINE');
  assert.equal(buildSnapshot({ ...base, run: run({ queued: 2 }) }, 1).session?.sync, 'SENDING');
});

test('스냅샷: 서버가 확인한 종료만 결과로, 폐기는 결과 없음', () => {
  const done = buildSnapshot({ ...base, participations: 2, run: run({ status: 'ENDED', result: { status: 'COMPLETED', distanceM: 2900, activeMs: 1_100_000 } }) }, 1);
  assert.deepEqual(done.session?.result, { sessionId: 's1', distanceM: 2900, activeMs: 1_100_000, participations: 2 });
  assert.equal(done.session?.distanceM, 2900);
  assert.equal(buildSnapshot({ ...base, run: run({ status: 'ENDED', result: { status: 'DISCARDED', distanceM: 0, activeMs: 0 } }) }, 1).session?.result, null);
  assert.equal(buildSnapshot({ ...base, run: run({ status: 'ENDING' }) }, 1).session?.result, null);
});

test('스냅샷: 로그아웃이면 운동·결과·요약을 싣지 않는다', () => {
  const s = buildSnapshot({ ...base, uid: null, last: { sessionId: 's0', distanceM: 1, activeMs: 1, participations: null } }, 1);
  assert.deepEqual(s.account, { signedIn: false, needs: ['LOGIN'] });
  assert.equal(s.session, null);
  assert.equal(s.last, null);
});

test('전송 간격: 상태·체크포인트 변화는 바로, 수치만 바뀌면 워치가 보일 때 1초·안 보일 때 15초', () => {
  const k = eventKey(buildSnapshot(base, 0));
  assert.equal(eventKey(buildSnapshot({ ...base, run: run({ localM: 3000, activeMs: 1_060_000 }) }, 0)), k);
  assert.notEqual(eventKey(buildSnapshot({ ...base, run: run({ status: 'PAUSED' }) }, 0)), k);
  assert.ok(publishDue(null, k, 0, false));
  assert.ok(!publishDue({ key: k, at: 0 }, k, VISIBLE_INTERVAL_MS - 1, true));
  assert.ok(publishDue({ key: k, at: 0 }, k, VISIBLE_INTERVAL_MS, true));
  assert.ok(!publishDue({ key: k, at: 0 }, k, HIDDEN_INTERVAL_MS - 1, false));
  assert.ok(publishDue({ key: k, at: 0 }, 'other', 1, false));
});

test('참여 결과: 지급·검토 대기·중복·실패를 그대로 나눈다', () => {
  assert.deepEqual(outcomeOf({ ok: true, value: { ok: true, saved: true, pointsAwarded: 1, rewardReason: 'PAID' } }).reward, { saved: true, existing: false, points: 1, pending: 0, reason: 'PAID' });
  assert.equal(outcomeOf({ ok: true, value: { ok: true, saved: false, existing: true, pointsAwarded: 0, rewardReason: 'ALREADY_TODAY' } }).reward?.existing, true);
  assert.deepEqual(outcomeOf({ ok: false, errorCode: 'EXPOSURE_EXPIRED', details: {}, retryable: false }), { state: 'FAILED', code: 'EXPOSURE_EXPIRED', reward: null });
});

test('촬영 연결: 같은 계정·만료 전·제출 전만 이어간다', () => {
  const h: Handoff = { requestId: 'r1', uid: 'u1', sessionId: 's1', exposureId: 'e1', kind: 'ISSUE', targetId: 'i1', answer: 'PRESENT', expiresAt: 100, stage: 'PHONE_RECEIVED', code: null, reward: null, nodeId: null, createdAt: 0 };
  assert.ok(handoffUsable(h, 'u1', 99));
  assert.ok(!handoffUsable(h, 'u2', 99));
  assert.ok(!handoffUsable(h, 'u1', 100));
  assert.ok(!handoffUsable({ ...h, stage: 'SUBMITTED' }, 'u1', 1));
  assert.ok(!handoffUsable(null, 'u1', 1));
});

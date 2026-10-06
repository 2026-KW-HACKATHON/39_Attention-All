// node --test src/runlogic.test.ts — 운동 큐 규칙(서버 workouts.js·service.js와 같은 값이어야 한다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeAt, endTime, flush, legM, rebuildDistance, reconcileRejected, shouldFlush, toTail, trackDistance, FLUSH_COUNT, FLUSH_MS, type Op, type Pt, type ServerSession } from './runlogic.ts';

const t0 = Date.parse('2026-10-06T00:00:00Z');
let n = 0;
const id = () => 'id' + ++n;
// 북쪽으로 i*10m(약 0.0000899도)
const pt = (i: number, at: number, acc = 5): Pt => ({ lat: 37.62 + i * 0.0000899, lng: 127.05, accuracyM: acc, recordedAt: at, altitudeM: null, altitudeAccuracyM: null });

test('거리: 서버와 같은 규칙(정확도 30m·60초·12m/s·구간 경계)만 잇는다', () => {
  const pauses = [{ from: t0 + 30000, to: t0 + 40000 }];
  const tails = [pt(0, t0), pt(1, t0 + 3000), pt(2, t0 + 6000, 40), pt(3, t0 + 9000), pt(4, t0 + 80000), pt(30, t0 + 81000), pt(31, t0 + 84000)].map(p => toTail(p, pauses));
  // 0→1: 10m. 1→2·2→3: 정확도 40m라 제외. 3→4: 71초 간격(그리고 구간 경계) 제외. 4→30: 260m/1s 과속 제외. 30→31: 10m.
  assert.ok(Math.abs(trackDistance(tails) - 20) < 0.5, String(trackDistance(tails)));
  assert.equal(tails[4].segment, 1);
  assert.equal(legM(toTail(pt(0, t0 + 20000), pauses), toTail(pt(1, t0 + 45000), pauses)), 0); // 일시정지 전후는 잇지 않는다
});

test('묶음: 20점이 쌓이거나 가장 오래된 점이 20초 지나면 보내고, 한 요청은 최대 50점·순서 유지', () => {
  const buf = Array.from({ length: FLUSH_COUNT - 1 }, (_, i) => pt(i, t0 + i * 100));
  assert.equal(shouldFlush(buf, t0 + 2000), false);
  assert.equal(shouldFlush(buf, t0 + FLUSH_MS), true);
  buf.push(pt(99, t0 + 5000));
  assert.equal(shouldFlush(buf, t0 + 5000), true);
  const big = Array.from({ length: 120 }, (_, i) => pt(i, t0 + i * 1000)), ops: Op[] = [];
  flush(big, ops, 's', id);
  assert.deepEqual(ops.map(o => (o.payload!.points as Pt[]).length), [50, 50, 20]);
  assert.equal(big.length, 0);
  const all = ops.flatMap(o => o.payload!.points as Pt[]).map(p => p.recordedAt);
  assert.deepEqual(all, [...all].sort((a, b) => a - b));
});

const server = (track: Pt[], pauses = [] as ServerSession['pauses']): ServerSession => ({
  id: 's', status: 'ACTIVE', startedAt: t0, activeMs: 0, distanceM: 0, pauses,
  track: track.map(p => ({ lat: p.lat, lng: p.lng, acc: p.accuracyM, recordedAt: p.recordedAt, segment: 0 })),
});

test('거절된 묶음: 이미 저장된 점·일시정지 구간 점만 빼고 나머지는 새 요청 ID로 다시 보낸다', () => {
  const pts = [pt(1, t0 + 1000), pt(2, t0 + 2000), pt(3, t0 + 3000), pt(4, t0 + 9000)];
  const op: Op = { id: 'old', name: 'appendTrack', payload: { sessionId: 's', points: pts } };
  // 서버에는 앞 2점이 이미 있고(다른 요청으로 저장), 8~10초는 일시정지
  const x = reconcileRejected(op, server(pts.slice(0, 2), [{ from: t0 + 8000, to: t0 + 10000 }]), t0 + 20000, id);
  assert.equal(x.duplicate, 2);
  assert.equal(x.dropped, 1);
  assert.equal(x.replace.length, 1);
  assert.notEqual(x.replace[0].id, 'old');
  assert.deepEqual((x.replace[0].payload!.points as Pt[]).map(p => p.recordedAt), [t0 + 3000]);
  assert.equal(x.rejected.length, 0);
});

test('거절된 묶음: 걸러도 그대로면 다시 보내지 않고 보관한다(조용히 버리지 않음)', () => {
  const pts = [pt(1, t0 + 1000), pt(2, t0 + 2000)];
  const x = reconcileRejected({ id: 'a', name: 'appendTrack', payload: { sessionId: 's', points: pts } }, server([]), t0 + 5000, id);
  assert.equal(x.replace.length, 0);
  assert.deepEqual(x.rejected, pts);
});

test('거리 다시 계산: 서버 저장분 + 미전송분', () => {
  const s = server([pt(0, t0), pt(1, t0 + 3000)]);
  const x = rebuildDistance(s.track, [pt(2, t0 + 6000), pt(3, t0 + 9000)], []);
  assert.ok(Math.abs(x.localM - 30) < 0.5);
  assert.equal(x.tail!.recordedAt, t0 + 9000);
});

test('종료 시각: 누른 순간을 쓰되 서버 허용 범위에 맞추고, 그 뒤로 화면 시간이 늘지 않는다', () => {
  // 1분 달리고 오프라인에서 종료 → 10분 뒤 화면을 봐도 1분
  const end = endTime(t0 + 60000, 'ACTIVE', t0, [], t0 + 59000);
  assert.equal(end, t0 + 60000);
  assert.equal(activeAt(t0, [], t0 + 600000, end), 60000);
  // 마지막 위치점이 시계보다 늦으면 그 뒤로
  assert.equal(endTime(t0 + 60000, 'ACTIVE', t0, [], t0 + 61000), t0 + 61001);
  // 일시정지 중 종료: 일시정지 구간은 늘어나도 활동 시간은 그대로
  const pauses = [{ from: t0 + 120000, to: null }];
  const e2 = endTime(t0 + 180000, 'PAUSED', t0, pauses, t0 + 119000);
  assert.equal(activeAt(t0, pauses, t0 + 900000, e2), 120000);
  // 종료 전에는 흐른다
  assert.equal(activeAt(t0, [], t0 + 5000, null), 5000);
});

test('거리: 임의 경로에서 서버 functions/src/workouts.js trackDistance와 같은 값', async () => {
  const { createRequire } = await import('node:module');
  const W = createRequire(import.meta.url)('../../backend/functions/src/workouts.js');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 50; k++) {
    const pauses = [{ from: t0 + 100000, to: t0 + 130000 }];
    const pts: Pt[] = [];
    let at = t0, i = 0;
    for (let j = 0; j < 80; j++) {
      at += 1000 + Math.floor(rnd() * 70000 * (rnd() < 0.1 ? 1 : 0.05));
      i += rnd() < 0.05 ? 50 : rnd() * 2;
      if (at >= pauses[0].from && at < pauses[0].to) continue;
      pts.push(pt(i, at, rnd() < 0.15 ? 35 : 6));
    }
    const tails = pts.map(p => toTail(p, pauses));
    const serverTrack = tails.map(t => ({ lat: t.lat, lng: t.lng, acc: t.acc, recordedAt: t.recordedAt, segment: t.segment }));
    assert.ok(Math.abs(trackDistance(tails) - W.trackDistance(serverTrack)) < 1e-6);
  }
});

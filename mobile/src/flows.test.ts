// node --test src/flows.test.ts — 목록 갱신 연결, 사진 작업 규칙, 전송 묶음과 조작 순서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PagedRegistry } from './core.ts';
import { checkPhoto, needsRetake, pickJob, sealLocOk, SEAL_WINDOW_MS } from './capturelogic.ts';
import { flush, opPoints, shouldFlush, type Op, type Pt } from './runlogic.ts';

test('목록 갱신: 새 제보 뒤 refresh(getRecords)는 열린 참여 목록을 다시 받고, 다른 목록·닫힌 목록은 건드리지 않는다', () => {
  const r = new PagedRegistry();
  const calls: string[] = [];
  r.add('getRecords', () => calls.push('participations'));
  r.add('getRecords', () => calls.push('runs'));
  const off = r.add('getRiverFeed', () => calls.push('news'));
  r.fire(['getHome', 'getRecords']);
  assert.deepEqual(calls, ['participations', 'runs']);
  off();
  r.fire(['getRiverFeed']);
  assert.deepEqual(calls, ['participations', 'runs']);
});

test('사진 파일: 실제 바이트가 JPEG이고 5MiB 이하만 보관한다(확장자·선언만으로 통과하지 않음)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(checkPhoto(1000, jpeg), null);
  assert.equal(checkPhoto(1000, jpeg.subarray(0, 3)), null); // capture.ts는 앞 3바이트만 넘긴다(기기 시험에서 찾은 오류)
  assert.equal(checkPhoto(1000, png), 'PHOTO_NOT_JPEG');
  assert.equal(checkPhoto(6 * 1024 * 1024, jpeg), 'PHOTO_TOO_LARGE');
  assert.equal(checkPhoto(0, jpeg), 'PHOTO_FILE_MISSING');
});

test('봉인 위치: 셔터 직후에 잰 위치만 쓰고, 늦으면 나중 위치로 대신하지 않고 재촬영', () => {
  const shot = 1_000_000;
  assert.equal(sealLocOk(shot, shot + 5000, shot + 4000), true);
  assert.equal(sealLocOk(shot, shot + SEAL_WINDOW_MS + 1), false); // 앱이 오래 꺼졌다 켜진 경우
  assert.equal(sealLocOk(shot, shot + 10000, shot + SEAL_WINDOW_MS + 5000), false);
  assert.equal(needsRetake('SEAL_TOO_LATE'), true);
  assert.equal(needsRetake('CAPTURE_TICKET_EXPIRED'), true); // 만료 티켓은 같은 사진으로 다시 보내지 않는다
  assert.equal(needsRetake('NETWORK'), false); // 통신 실패는 같은 사진·같은 요청으로 재시도
  assert.equal(needsRetake('PHOTO_NOT_READY'), false);
  assert.equal(needsRetake('PHOTO_UPLOAD_REJECTED'), false); // 권한 오류만으로 보관한 사진을 버리지 않는다
});

test('이어갈 사진 작업: 같은 계정·목적·대상만. 다른 계정·다른 관찰·사진 없는 작업은 고르지 않는다', () => {
  const base = { stage: 'SEALED', file: 'f', createdAt: 1 };
  const jobs = [
    { ...base, id: 'a', uid: 'A', purpose: 'RECHECK', targetId: 'i1' },
    { ...base, id: 'b', uid: 'B', purpose: 'RECHECK', targetId: 'i1', createdAt: 5 },
    { ...base, id: 'c', uid: 'A', purpose: 'RECHECK', targetId: 'i2', createdAt: 9 },
    { ...base, id: 'd', uid: 'A', purpose: 'RECHECK', targetId: 'i1', stage: 'TICKETED', file: undefined, createdAt: 7 },
    { ...base, id: 'e', uid: 'A', purpose: 'ROUTINE', targetId: 'i1', createdAt: 8 },
  ];
  assert.equal(pickJob(jobs, 'A', 'RECHECK', 'i1')?.id, 'a');
  assert.equal(pickJob(jobs, 'B', 'RECHECK', 'i1')?.id, 'b');
  assert.equal(pickJob(jobs, 'A', 'DISCOVERY'), undefined);
});

const t0 = Date.parse('2026-10-06T00:00:00Z');
const pt = (at: number): Pt => ({ lat: 37.62, lng: 127.05, accuracyM: 5, recordedAt: at, altitudeM: null, altitudeAccuracyM: null });
let n = 0;
const id = () => 'op' + ++n;

test('전송 묶음: 모아 둔 위치는 일시정지·재개·종료 요청보다 먼저, 순서대로 보낸다(run.ts의 조작 순서와 같다)', () => {
  const ops: Op[] = [], buffer: Pt[] = [];
  // 위치 5점(아직 묶음 기준 미달) → 일시정지: 남은 점을 먼저 묶고 pause
  for (let i = 0; i < 5; i++) buffer.push(pt(t0 + i * 3000));
  assert.equal(shouldFlush(buffer, t0 + 12000), false);
  flush(buffer, ops, 's', id);
  ops.push({ id: id(), name: 'pauseRun', payload: { occurredAt: t0 + 13000 } });
  ops.push({ id: id(), name: 'resumeRun', payload: { occurredAt: t0 + 60000 } });
  for (let i = 0; i < 25; i++) buffer.push(pt(t0 + 61000 + i * 1000));
  if (shouldFlush(buffer, t0 + 86000)) flush(buffer, ops, 's', id);
  buffer.push(pt(t0 + 87000));
  flush(buffer, ops, 's', id); // 종료 직전 남은 점
  ops.push({ id: id(), name: 'finishRun', payload: null });
  assert.deepEqual(ops.map(o => o.name), ['appendTrack', 'pauseRun', 'resumeRun', 'appendTrack', 'appendTrack', 'finishRun']);
  const times = ops.flatMap(opPoints).map(p => p.recordedAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(new Set(ops.map(o => o.id)).size, ops.length);
  assert.ok(ops.flatMap(opPoints).every(p => p.recordedAt < t0 + 13000 || p.recordedAt > t0 + 60000)); // 일시정지 구간 점 없음
});

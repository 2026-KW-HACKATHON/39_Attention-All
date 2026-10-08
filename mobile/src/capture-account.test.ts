import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import type { PhotoJob } from './capture';

function harness() {
  const require = createRequire(import.meta.url);
  let uid = 'owner', now = Date.now();
  const requests: { name: string; payload: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const loc = { lat: 37.6, lng: 127.03, accuracyM: 5, measuredAt: Date.now(), precise: true };
  const native = {
    permission: async () => ({ granted: true }),
    locate: async (): Promise<typeof loc | { ok: false; errorCode: string; details: Record<string, unknown>; retryable: boolean }> => loc,
    upload: async () => {},
    call: async (name: string) => { calls.push(name); return name === 'getPhotoStatus' ? { status: 'PENDING' } : { capturedAt: Date.now() }; },
  };
  const imports: Record<string, unknown> = {
    'expo-image-picker': { requestCameraPermissionsAsync: () => native.permission(), launchCameraAsync: async () => ({ canceled: true, assets: [] }) },
    'expo-crypto': { randomUUID },
    'expo-file-system': { File: class { exists = true; } },
    './firebase': { call: (name: string) => native.call(name), uploadEvidence: async () => { calls.push('uploadEvidence'); await native.upload(); } },
    './session': { getUid: () => uid, mutate: async (name: string, payload: Record<string, unknown>) => { calls.push(name); requests.push({ name, payload }); return { ok: true, value: { ticketId: 'ticket', uploadPath: 'path', expiresAt: Date.now() + 60000 } }; } },
    './store': { readJson: () => ({}), writeJson: () => true, StoreError: class extends Error {} },
    './pilot-access': { participationLoc: () => native.locate() },
    './location': { preciseLoc: () => native.locate(), isLoc: (value: object) => !('ok' in value) },
    './capturelogic': require('./capturelogic.ts'), './core': require('./core.ts'),
  };
  const mod = { exports: {} as typeof import('./capture') };
  const source = ts.transpileModule(readFileSync(new URL('./capture.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports: mod.exports, module: mod, require: (id: string) => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  }, Date: { now: () => now }, setTimeout: (callback: () => void) => queueMicrotask(callback) }, { filename: 'capture.ts' });
  return { capture: mod.exports, native, calls, requests, loc, now: () => now, advance: (milliseconds: number) => { now += milliseconds; }, switchAccount: () => { uid = 'other'; } };
}
const job = (stage: PhotoJob['stage']): PhotoJob => ({ id: 'photo', uid: 'owner', key: 'ROUTINE|routine|', purpose: 'ROUTINE', targetId: 'routine', stage, createdAt: Date.now(), shotAt: Date.now(), ticketId: 'ticket', uploadPath: 'path', file: 'photo.jpg', capturedAt: stage === 'SEALED' ? Date.now() : undefined });

test('카메라 권한 요청 중 계정이 바뀌면 새 계정으로 촬영 티켓을 발급하지 않는다', async () => {
  const h = harness();
  h.native.permission = async () => { h.switchAccount(); return { granted: true }; };
  const result = await h.capture.capture('ROUTINE', 'routine');
  assert.equal(!result.ok && result.errorCode, 'ACCOUNT_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('촬영 위치 대기 중 계정이 바뀌면 새 계정으로 촬영 티켓을 발급하지 않는다', async () => {
  const h = harness();
  h.native.locate = async () => { h.switchAccount(); return h.loc; };
  const result = await h.capture.capture('ROUTINE', 'routine');
  assert.equal(!result.ok && result.errorCode, 'ACCOUNT_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('봉인 위치 대기 중 계정이 바뀌면 이전 계정 사진을 봉인하지 않는다', async () => {
  const h = harness();
  h.native.locate = async () => { h.switchAccount(); return h.loc; };
  const result = await h.capture.seal(job('CAPTURED'));
  assert.equal(!result.ok && result.errorCode, 'ACCOUNT_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('사진 상태 조회 중 계정이 바뀌면 이전 계정 사진을 업로드하지 않는다', async () => {
  const h = harness();
  h.native.call = async name => { h.calls.push(name); h.switchAccount(); return { status: 'PENDING' }; };
  const result = await h.capture.upload(job('SEALED'));
  assert.equal(!result.ok && result.errorCode, 'ACCOUNT_CHANGED');
  assert.deepEqual(h.calls, ['getPhotoStatus']);
});

test('우이천 참여 범위 밖이면 카메라 권한 창이나 촬영 티켓보다 먼저 차단한다', async () => {
  const h = harness(); let camera = 0;
  h.native.locate = async () => ({ ok: false, errorCode: 'OUTSIDE_PILOT', details: { radiusM: 100 }, retryable: false });
  h.native.permission = async () => { camera++; return { granted: true }; };
  const result = await h.capture.capture('ROUTINE', 'routine');
  assert.equal(!result.ok && result.errorCode, 'OUTSIDE_PILOT');
  assert.equal(camera, 0); assert.deepEqual(h.calls, []);
});

test('첫 카메라 권한 창을 15초 열어 두어도 촬영 티켓은 권한 허용 뒤 새로 잰 위치로 발급한다', async () => {
  const h = harness(); let fixes = 0;
  h.native.locate = async () => { fixes++; return { ...h.loc, measuredAt: h.now() }; };
  h.native.permission = async () => { h.advance(15000); return { granted: true }; };
  await h.capture.capture('ROUTINE', 'routine');
  assert.equal(fixes, 2);
  const position = h.requests[0]?.payload.loc as { measuredAt: number };
  assert.equal(position.measuredAt, h.now());
});

 test('저장 권한 거절은 재시도 가능한 실패로 보관하고, 다음 시도에서 같은 사진이 READY가 되면 이어간다', async () => {
  const h = harness(), j = job('SEALED');
  j.rejectedAt = 39; // 이전 호출의 반복 횟수는 다음 시도의 제한에 영향을 주지 않는다.
  h.native.upload = async () => { throw Object.assign(new Error('denied'), { code: 'storage/unauthorized' }); };
  const result = await h.capture.upload(j);
  assert.equal(!result.ok && result.errorCode, 'PHOTO_UPLOAD_REJECTED');
  assert.equal(!result.ok && result.retryable, true);
  assert.equal(j.file, 'photo.jpg');
  assert.equal(h.calls.filter(x => x === 'uploadEvidence').length, 6);
  h.native.call = async () => ({ status: 'READY' });
  const retry = await h.capture.upload(j);
  assert.equal(retry.ok, true); assert.equal(j.stage, 'READY');
});
 test('실제로 촬영 후 한 시간이 지난 거절은 재촬영 대상으로 구분한다', async () => {
  const h = harness(), j = job('SEALED');
  j.capturedAt = h.now();
  h.advance(3600001);
  h.native.upload = async () => { throw Object.assign(new Error('denied'), { code: 'storage/unauthorized' }); };
  const result = await h.capture.upload(j);
  assert.equal(!result.ok && result.errorCode, 'PHOTO_TOO_OLD');
  assert.equal(!result.ok && result.retryable, false);
});

test('선택 앱 안 셔터는 시스템 카메라 권한·실행을 건너뛰고 같은 티켓 취소 규칙을 쓴다', async () => {
  const h = harness(); let permissions = 0, shutters = 0;
  h.native.permission = async () => { permissions++; return { granted: true }; };
  const result = await h.capture.capture('ROUTINE', 'routine', undefined, 'session', async () => { shutters++; return null; });
  assert.equal(!result.ok && result.errorCode, 'CAPTURE_CANCELLED');
  assert.equal(shutters, 1); assert.equal(permissions, 0);
  assert.equal(h.requests[0]?.name, 'issueCaptureTicket');
});

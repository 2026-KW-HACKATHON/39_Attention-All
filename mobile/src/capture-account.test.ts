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
  let uid = 'owner';
  const calls: string[] = [];
  const loc = { lat: 37.6, lng: 127.03, accuracyM: 5, measuredAt: Date.now(), precise: true };
  const native = {
    permission: async () => ({ granted: true }),
    locate: async () => loc,
    call: async (name: string) => { calls.push(name); return name === 'getPhotoStatus' ? { status: 'PENDING' } : { capturedAt: Date.now() }; },
  };
  const imports: Record<string, unknown> = {
    'expo-image-picker': { requestCameraPermissionsAsync: () => native.permission(), launchCameraAsync: async () => ({ canceled: true, assets: [] }) },
    'expo-crypto': { randomUUID },
    'expo-file-system': { File: class { exists = true; } },
    './firebase': { call: (name: string) => native.call(name), uploadEvidence: async () => { calls.push('uploadEvidence'); } },
    './session': { getUid: () => uid, mutate: async (name: string) => { calls.push(name); return { ok: true, value: { ticketId: 'ticket', uploadPath: 'path', expiresAt: Date.now() + 60000 } }; } },
    './store': { readJson: () => ({}), writeJson: () => true, StoreError: class extends Error {} },
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
  }, Date, setTimeout: (callback: () => void) => queueMicrotask(callback) }, { filename: 'capture.ts' });
  return { capture: mod.exports, native, calls, loc, switchAccount: () => { uid = 'other'; } };
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

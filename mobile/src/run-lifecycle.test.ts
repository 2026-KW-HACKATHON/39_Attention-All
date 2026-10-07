// 실제 run.ts를 실행하고 네이티브 GPS·파일·서버 경계만 대체한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function harness(options: { empty?: boolean; call?: (name: string) => Promise<unknown> } = {}) {
  let running = true;
  const stopping = deferred(), stopped = deferred();
  const require = createRequire(import.meta.url);
  const files = new Map<string, unknown>();
  const uid = 'test-user', now = Date.now();
  const native = {
    hasStartedLocationUpdatesAsync: async () => running,
    stopLocationUpdatesAsync: async () => {
      stopping.resolve();
      await stopped.promise;
      running = false;
    },
    startLocationUpdatesAsync: async () => { running = true; },
    Accuracy: { BestForNavigation: 6 },
    ActivityType: { Fitness: 3 },
  };
  files.set(`run-${uid}-session.json`, {
    uid, sessionId: 'session', mode: 'WALK', courseId: null, startedAt: now - 60000,
    status: 'ACTIVE', pauses: [], endAt: null, buffer: [], ops: [], stored: 0,
    distanceM: 0, localM: 0, tail: null, trail: [], lastAt: 0, last: null,
    gaps: 0, dropped: 0, rejected: [], skippedMock: 0, offline: false,
    problem: null, timeFallback: false, result: null, exposure: null, exposureAt: 0,
  });
  if (options.empty) files.clear();
  const imports: Record<string, unknown> = {
    'expo-location': native,
    'expo-task-manager': { defineTask: () => {} },
    'expo-crypto': { randomUUID },
    'react-native': { Vibration: { vibrate: () => {} } },
    './firebase': { call: options.call ?? (async () => ({ ok: true })) },
    './session': { getUid: () => uid, onAccountChange: () => {}, onBeforeSignOut: () => {}, refresh: async () => {}, mutate: async () => ({ ok: true }) },
    './store': {
      fileExists: (n: string) => files.has(n),
      listJson: (prefix: string) => [...files.keys()].filter(n => n.startsWith(prefix)),
      readJson: (n: string, fallback: unknown) => structuredClone(files.get(n) ?? fallback),
      writeJson: (n: string, value: unknown) => { files.set(n, structuredClone(value)); return true; },
      removeFile: (n: string) => files.delete(n),
    },
    './location': {},
    './run-ready': require('./run-ready.ts'),
    './core': require('./core.ts'),
    './runlogic': require('./runlogic.ts'),
  };
  const mod = { exports: {} as Record<string, (...args: never[]) => unknown> };
  const source = ts.transpileModule(readFileSync(new URL('./run.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: mod.exports, module: mod,
    require: (id: string) => { if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`); return imports[id]; },
    setInterval: () => {}, Date, console,
  }, { filename: 'run.ts' });
  return { run: mod.exports, stopping, stopped, running: () => running };
}

test('일시정지의 GPS 중지가 진행 중일 때 재개해도 위치 수집은 다시 켜진다', async () => {
  const h = harness();
  const pausing = h.run.pauseRun();
  await h.stopping.promise;
  const resuming = h.run.resumeRun();
  // 네이티브 중지가 아직 끝나지 않았지만 UI는 이미 재개를 허용한다.
  await new Promise<void>(r => setImmediate(r));
  h.stopped.resolve();
  await Promise.all([pausing, resuming]);
  assert.equal((h.run.getRun() as { status: string }).status, 'ACTIVE');
  assert.equal(h.running(), true);
});

test('GPS 시작 대기 중에 운동을 끝내면 최종 위치 수집은 꺼진다', async () => {
  const h = harness();
  const pausing = h.run.pauseRun();
  await h.stopping.promise;
  const resuming = h.run.resumeRun();
  const finishing = h.run.finishRun();
  h.stopped.resolve();
  await Promise.all([pausing, resuming, finishing]);
  assert.equal(h.running(), false);
});

const detail = (status = 'ACTIVE') => ({ id: 'session', mode: 'WALK', courseId: null, startedAt: Date.now() - 60000, status, pauses: [], track: [], distanceM: 0, activeMs: 60000 });

test('복구 응답을 기다리는 동안 일시정지한 운동을 오래된 ACTIVE 응답으로 재개하지 않는다', async () => {
  const requested = deferred(), response = deferred();
  const h = harness({ call: async name => {
    if (name === 'getRunDetail') { requested.resolve(); await response.promise; return detail(); }
    return { ok: true };
  } });
  const recovering = h.run.recoverRun();
  await requested.promise;
  const pausing = h.run.pauseRun();
  h.stopped.resolve();
  await pausing;
  await h.run.pump();
  response.resolve();
  await recovering;
  assert.equal((h.run.getRun() as { status: string }).status, 'PAUSED');
  assert.equal(h.running(), false);
});

test('진행 중 세션 조회 뒤 이미 종료된 서버 세션은 운동으로 복원하지 않는다', async () => {
  const h = harness({ empty: true, call: async name => name === 'getMy' ? { activeSession: 'session' } : detail('FINISHED') });
  await h.run.adoptServerSession();
  assert.equal(h.run.getRun(), null);
});

test('동시에 이어받은 응답은 먼저 복원한 운동의 일시정지를 덮어쓰지 않는다', async () => {
  const requested = deferred(), response = deferred();
  let details = 0;
  const h = harness({ empty: true, call: async name => {
    if (name === 'getMy') return { activeSession: 'session' };
    if (name === 'getRunDetail') {
      if (++details === 1) { requested.resolve(); await response.promise; }
      return detail();
    }
    return { ok: true };
  } });
  const old = h.run.adoptServerSession();
  await requested.promise;
  await h.run.adoptServerSession();
  const pausing = h.run.pauseRun();
  h.stopped.resolve();
  await pausing;
  response.resolve();
  await old;
  assert.equal((h.run.getRun() as { status: string }).status, 'PAUSED');
  assert.equal(h.running(), false);
});

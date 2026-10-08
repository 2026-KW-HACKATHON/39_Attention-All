// 실제 wear.ts의 이벤트·명령·계정 파이프라인. 네이티브 Data Layer/Firebase/운동 엔진 경계만 대체한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import type { Ack, Command } from './wearlogic';
import type { Run } from './run';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const run = (): Run => ({ uid: 'owner', sessionId: 'session', mode: 'RUN', courseId: null, startedAt: Date.now() - 60000, status: 'ACTIVE', pauses: [], endAt: null, buffer: [], ops: [], stored: 0, distanceM: 500, localM: 500, tail: null, trail: [], lastAt: Date.now(), last: { lat: 37.6, lng: 127, accuracyM: 5, measuredAt: Date.now(), precise: true }, gaps: 0, dropped: 0, rejected: [], skippedMock: 0, offline: false, problem: null, timeFallback: false, result: null, exposure: { id: 'exposure', kind: 'ISSUE', targetId: 'issue', expiresAt: Date.now() + 60000 }, exposureAt: Date.now() });
function harness(options: { noBridge?: boolean; active?: boolean; initialRun?: Run | null } = {}) {
  const require = createRequire(import.meta.url);
  let uid: string | null = 'owner', epoch = 0, live = options.initialRun === undefined ? run() : options.initialRun, commands: ((e: { json: string; nodeId: string }) => void) | undefined;
  const acks: Ack[] = [], snapshots: { epoch: number; session: { status: string } | null; account: { signedIn: boolean }; quick: unknown }[] = [], routes: unknown[] = [], calls: string[] = [], alerts: { buttons: { onPress?: () => void }[] }[] = [];
  const files = new Map<string, unknown>(), runListeners: (() => void)[] = [], accounts: ((uid: string | null) => void)[] = [];
  const appState = { currentState: options.active === false ? 'background' : 'active', addEventListener: (_name: string, fn: (value: string) => void) => { appListener = fn; return { remove: () => {} }; } };
  let appListener: ((value: string) => void) | undefined;
  const native = { locked: false, reachable: true, alertShown: async () => false, quick: async () => ({ ok: true as const, value: { ok: true, saved: true, pointsAwarded: 1 } }), pause: async () => { calls.push('pause'); if (live) live.status = 'PAUSED'; runListeners.forEach(fn => fn()); }, pending: '[]' };
  const wearHooks: { claimAlert?: (id: string) => Promise<boolean> } = {};
  const bridge = {
    setAccount: () => ++epoch, takePending: () => { const out = native.pending; native.pending = '[]'; return out; }, isPhoneLocked: () => native.locked,
    hasWatch: async () => native.reachable, publish: async (json: string) => { snapshots.push(JSON.parse(json)); return snapshots.length; },
    ack: async (_node: unknown, json: string) => { acks.push(JSON.parse(json)); }, awaitAlertShown: () => native.alertShown(),
    addListener: (_name: string, listener: typeof commands) => { commands = listener; return { remove: () => {} }; },
  };
  const imports: Record<string, unknown> = {
    'react-native': { Alert: { alert: (_title: unknown, _message: unknown, buttons: { onPress?: () => void }[]) => { alerts.push({ buttons }); } }, AppState: appState },
    'expo-location': { getForegroundPermissionsAsync: async () => ({ granted: true, android: { accuracy: 'fine' } }) },
    'expo-notifications': { getPermissionsAsync: async () => ({ granted: false }) }, 'expo-router': { router: { push: (route: unknown) => { routes.push(route); } } },
    '../modules/uirun-wear-bridge': { default: options.noBridge ? null : bridge, __esModule: true },
    './run': { getRun: () => live, activeMs: () => 60000, subscribeRun: (fn: () => void) => { runListeners.push(fn); }, wearHooks,
      pauseRun: () => native.pause(), resumeRun: async () => { calls.push('resume'); if (live) live.status = 'ACTIVE'; runListeners.forEach(fn => fn()); },
      finishRun: async () => { calls.push('finish'); if (live) live.status = 'ENDING'; runListeners.forEach(fn => fn()); }, pump: async () => { calls.push('pump'); },
      startRun: async () => { calls.push('start'); live = run(); return { ok: true, value: live }; } },
    './session': { getUid: () => uid, onAccountChange: (fn: (uid: string | null) => void) => { accounts.push(fn); } },
    './firebase': { CONFIG: { consentVersion: '1' }, watchUser: async (fn: (u: { uid: string } | null) => void) => { fn(uid ? { uid } : null); return () => {}; }, call: async (name: string) => name === 'getIssueDetail' ? { issue: { categoryLabel: '관찰', anchor: [37.6, 127] } } : {} },
    './gate': { ready: async () => true }, './exposure': { nearestM: () => 0, quickFromExposure: () => native.quick() },
    './store': { readJson: (name: string, fallback: unknown) => structuredClone(files.get(name) ?? fallback), writeJson: (name: string, value: unknown) => { files.set(name, structuredClone(value)); return true; }, StoreError: class extends Error {} },
    './core': require('./core.ts'), './wearlogic': require('./wearlogic.ts'),
  };
  const module = { exports: {} as typeof import('./wear') };
  const source = ts.transpileModule(readFileSync(new URL('./wear.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, console, __DEV__: false, require: (id: string) => { if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`); return imports[id]; } }, { filename: 'wear.ts' });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise<void>(r => setImmediate(r)); };
  const emit = (cmd: Partial<Command>) => commands?.({ json: JSON.stringify({ v: 1, id: 'command', type: 'PAUSE', epoch, sessionId: 'session', ...cmd }), nodeId: 'watch' });
  return { wear: module.exports, native, acks, snapshots, routes, alerts, calls, files, hooks: wearHooks, flush, emit,
    dispatch: async (cmd: Partial<Command>) => { emit(cmd); await flush(); },
    epoch: () => epoch, setAccount: (next: string | null) => { uid = next; if (live) live = { ...live, uid: next ?? '' }; accounts.forEach(fn => fn(next)); },
    app: (value: string) => { appState.currentState = value; appListener?.(value); },
    setRun: (next: Run | null) => { live = next; runListeners.forEach(fn => fn()); },
  };
}

test('native module missing leaves phone engine and notification hooks untouched', async () => {
  const h = harness({ noBridge: true }); await h.flush(); h.wear.wearForeground();
  assert.equal(h.hooks.claimAlert, undefined); assert.deepEqual(h.calls, []); assert.deepEqual(h.routes, []);
});
test('Wear START opens existing phone preparation and never bypasses outside consent with direct startRun', async () => {
  const h = harness({ initialRun: null }); await h.flush(); await h.dispatch({ type: 'START', mode: 'WALK', sessionId: undefined });
  assert.deepEqual(h.calls, []);
  assert.equal((h.routes[0] as { pathname: string }).pathname, '/run-ready');
  assert.equal((h.routes[0] as { params: { mode: string } }).params.mode, 'WALK');
  assert.equal(h.acks.at(-1)?.status, 'NEEDS_PHONE');
  h.setRun(run()); await h.flush();
  assert.equal(h.acks.at(-1)?.status, 'DONE'); assert.equal(h.acks.at(-1)?.sessionId, 'session');
});
test('duplicate PAUSE uses recorded ACK and old-epoch duplicate cannot replay a previous result', async () => {
  const h = harness(); await h.flush(); const epoch = h.epoch();
  await h.dispatch({}); await h.dispatch({}); assert.deepEqual(h.calls, ['pause']);
  h.setAccount(null); h.setAccount('owner'); await h.flush();
  await h.dispatch({ epoch });
  assert.equal(h.acks.at(-1)?.code, 'ACCOUNT_CHANGED'); assert.deepEqual(h.calls, ['pause']);
});
test('reconnect HELLO republishes latest paused state without replaying an operation', async () => {
  const h = harness(); await h.flush(); await h.dispatch({});
  await h.dispatch({ id: 'hello1', type: 'HELLO' }); await h.dispatch({ id: 'hello2', type: 'HELLO' });
  assert.deepEqual(h.calls, ['pause']); assert.equal(h.snapshots.at(-1)?.session?.status, 'PAUSED');
});
test('account change while quick is in flight cannot persist the previous account result in the new account', async () => {
  const h = harness(); await h.flush(); const answer = deferred<{ ok: true; value: { ok: true; saved: boolean; pointsAwarded: number } }>();
  h.native.quick = () => answer.promise; h.emit({ id: 'quick', type: 'QUICK', exposureId: 'exposure', answer: 'PRESENT' }); await h.flush();
  h.setAccount('other'); answer.resolve({ ok: true, value: { ok: true, saved: true, pointsAwarded: 1 } }); await h.flush();
  const saved = h.files.get('wear-other.json') as { book: Record<string, unknown>; quick: unknown } | undefined;
  assert.equal(saved?.book.quick, undefined); assert.equal(saved?.quick ?? null, null);
  assert.equal(h.acks.at(-1)?.code, 'ACCOUNT_CHANGED');
});
test('background START goes directly to preparation when phone becomes active without an extra confirmation', async () => {
  const h = harness({ initialRun: null, active: false }); await h.flush(); await h.dispatch({ type: 'START' });
  assert.deepEqual(h.routes, []); assert.deepEqual(h.calls, []);
  h.app('active'); await h.flush(); assert.equal(h.alerts.length, 0);
  assert.equal((h.routes[0] as { pathname: string }).pathname, '/run-ready'); assert.deepEqual(h.calls, []);
});
test('photo command duplicate opens the same capture route once and never submits on receipt', async () => {
  const h = harness(); await h.flush();
  await h.dispatch({ id: 'photo', type: 'PHOTO', exposureId: 'exposure', answer: 'PRESENT' });
  await h.dispatch({ id: 'photo', type: 'PHOTO', exposureId: 'exposure', answer: 'PRESENT' });
  assert.equal(h.routes.length, 1); assert.equal(h.routes[0], '/wear-capture?req=photo'); assert.deepEqual(h.calls, []);
  assert.equal(h.wear.getHandoff('photo')?.stage, 'PHONE_RECEIVED');
});

test('locked resume waits for phone confirmation and never resumes after account changes', async () => {
  const h = harness(); await h.flush(); h.setRun({ ...run(), status: 'PAUSED' }); h.native.locked = true;
  await h.dispatch({ type: 'RESUME' }); assert.equal(h.calls.includes('resume'), false); assert.equal(h.acks.at(-1)?.status, 'NEEDS_PHONE');
  h.native.locked = false; h.wear.wearForeground(); await h.flush();
  h.setAccount('other'); h.alerts.at(-1)?.buttons[1]?.onPress?.(); await h.flush();
  assert.equal(h.calls.includes('resume'), false);
});
test('published snapshots carry the captured account epoch across reconnect and account switch', async () => {
  const h = harness(); await h.flush(); await h.dispatch({ type: 'HELLO' });
  assert.equal(h.snapshots.at(-1)?.epoch, h.epoch()); h.setAccount('other'); await h.flush();
  await h.dispatch({ type: 'HELLO' }); assert.equal(h.snapshots.at(-1)?.epoch, h.epoch());
});

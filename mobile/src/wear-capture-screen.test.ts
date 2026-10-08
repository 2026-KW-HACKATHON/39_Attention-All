import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import type { PhotoJob } from './capture';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  const require = createRequire(import.meta.url); let uid = 'owner', now = Date.now(), cursor = 0;
  let loc: unknown = { lat: 1, lng: 1 };
  const buttons: { label: string; onPress: () => void }[] = [];
  const upload = deferred(), calls: string[] = [], stages: string[] = [], slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let effects: (() => void)[] = [];
  const h = { requestId: 'photo', uid, sessionId: 'session', exposureId: 'exposure', kind: 'ISSUE', targetId: 'issue', answer: 'PRESENT', expiresAt: now + 10000, stage: 'PHONE_RECEIVED', code: null, reward: null, nodeId: 'watch', createdAt: now };
  const j: PhotoJob = { id: 'job', uid, key: 'RECHECK|issue|', purpose: 'RECHECK', targetId: 'issue', sessionId: 'session', stage: 'READY', createdAt: now, ticketId: 'ticket', file: 'photo.jpg', capturedAt: now };
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  const react = {
    useState: (initial: unknown) => { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (v: unknown) => { slots[i].value = v; }]; },
    useRef: (initial: unknown) => { const i = cursor++; slots[i] ??= { value: { current: initial } }; return slots[i].value; },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; }); },
  };
  const imports: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx: (_type: unknown, props: { label?: string; onPress?: () => void }) => { if (props.label && props.onPress) buttons.push({ label: props.label, onPress: props.onPress }); return null; }, jsxs: () => null }, 'react-native': {},
    'expo-router': { useRouter: () => ({ replace: () => {}, back: () => {} }), useLocalSearchParams: () => ({ req: 'photo' }) },
    'expo-status-bar': {}, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-camera': { useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    '../capture': { capture: async () => { calls.push('capture'); return { ok: true, value: j }; }, pendingJob: () => null, upload: async () => { calls.push('upload'); await upload.promise; return { ok: true, value: j }; }, markSubmitting: () => { calls.push('mark'); j.stage = 'SUBMITTING'; }, finishJob: () => { calls.push('finish'); }, needsRetake: () => false },
    '../pilot-access': { participationLoc: async () => loc },
    '../run': { getRun: () => ({ sessionId: 'session', status: 'ACTIVE', endAt: null }) },
    '../session': { getUid: () => uid, useCloseOnAccountChange: () => {}, useApi: () => ({}), mutate: async () => { calls.push('mutate'); return { ok: true, value: { ok: true, saved: true, pointsAwarded: 1 } }; }, refresh: async () => {} },
    '../wear': { getHandoff: () => h, subscribeWear: () => {}, markCaptureOpen: () => {}, handoffStage: (_id: string, stage: string) => { stages.push(stage); h.stage = stage; } },
    '../wearlogic': require('./wearlogic.ts'), '../core': require('./core.ts'), './report': { LOCATION_TEXT: {} }, '../theme': { color: {} }, '../ui': {},
  };
  const module = { exports: {} as { default: () => unknown } };
  const source = ts.transpileModule(readFileSync(new URL('./app/wear-capture.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {}, require: (id: string) => { if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`); return imports[id]; } }, { filename: 'wear-capture.tsx' });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise<void>(r => setImmediate(r)); };
  const render = () => { cursor = 0; effects = []; module.exports.default(); };
  const commit = () => { effects.forEach(fn => fn()); effects = []; };
  const unmount = () => slots.forEach(slot => slot.cleanup?.());
  return { calls, stages, buttons, setLoc: (next: unknown) => { loc = next; }, render, commit, flush, unmount, upload, advance: () => { now += 15000; }, switchAccount: () => { uid = 'other'; } };
}
test('wear camera account change during upload preserves photo and never submits it with the new account', async () => {
  const h = harness(); h.render(); h.commit(); await h.flush();
  assert.deepEqual(h.calls, ['capture', 'upload']); h.switchAccount(); h.upload.resolve(); await h.flush();
  assert.equal(h.calls.includes('mutate'), false); assert.equal(h.calls.includes('finish'), false); h.unmount();
});
test('leaving wear camera during upload never starts a later submission and keeps the photo', async () => {
  const h = harness(); h.render(); h.commit(); await h.flush(); h.unmount(); h.upload.resolve(); await h.flush();
  assert.equal(h.calls.includes('mutate'), false); assert.equal(h.calls.includes('finish'), false);
});
test('wear capture checks expiry when async camera preparation actually begins, not only when screen opened', async () => {
  const h = harness(); h.render(); h.advance(); h.commit(); await h.flush();
  assert.equal(h.calls.includes('capture'), false); h.upload.resolve(); h.unmount();
});
test('valid wear capture uses the original ticket once and reports server-confirmed result', async () => {
  const h = harness(); h.render(); h.commit(); await h.flush(); h.upload.resolve(); await h.flush();
  assert.deepEqual(h.calls, ['capture', 'upload', 'mark', 'mutate', 'finish']); assert.equal(h.stages.at(-1), 'SERVER_RESULT'); h.unmount();
});

test('outside participation preflight preserves the same photo for retry after returning inside', async () => {
  const h = harness(); h.setLoc({ ok: false, errorCode: 'OUTSIDE_PILOT', details: {}, retryable: false });
  h.render(); h.commit(); await h.flush(); assert.deepEqual(h.calls, ['capture']); assert.equal(h.stages.includes('FAILED'), false);
  h.setLoc({ lat: 1, lng: 1 }); h.render(); h.buttons.find(b => b.label === '같은 사진 다시 보내기')!.onPress();
  await h.flush(); h.upload.resolve(); await h.flush();
  assert.deepEqual(h.calls, ['capture', 'upload', 'mark', 'mutate', 'finish']); h.unmount();
});

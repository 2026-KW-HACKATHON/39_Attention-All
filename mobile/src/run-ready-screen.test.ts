import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const require = createRequire(import.meta.url);
  let cursor = 0, focused = true;
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: (() => void) }[] = [];
  let effects: (() => void)[] = [];
  const position = { lat: 37.62, lng: 127.05, accuracyM: 8, measuredAt: Date.now(), precise: true };
  let resolve!: (v: typeof position) => void;
  const locating = new Promise<typeof position>(r => { resolve = r; });
  let requests = 0;
  const listeners = new Map<string, Set<() => void>>();
  const navigation = () => ({ addListener: (name: string, fn: () => void) => {
    const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(fn); return () => { set.delete(fn); };
  } });
  let nav = navigation();
  const router = { replace: () => {} };
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  const hooks = {
    useState: (initial: unknown) => {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (v: unknown) => { slots[i].value = v; }];
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }; return slots[i].value;
    },
    useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) => {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
    },
  };
  const imports: Record<string, unknown> = {
    react: hooks, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'react-native': { AppState: { addEventListener: () => ({ remove: () => {} }) }, BackHandler: { addEventListener: () => ({ remove: () => {} }) } },
    'expo-router': { useRouter: () => router, useNavigation: () => nav, useLocalSearchParams: () => ({}), useIsFocused: () => focused,
      useFocusEffect: (fn: () => () => void) => hooks.useEffect(fn, [fn, nav]) },
    'expo-router/react-navigation': { usePreventRemove: () => {} },
    '../run-ready': require('./run-ready.ts'),
    '../location': { preciseLoc: () => { requests++; return locating; } },
    '../session': { getUid: () => 'user' }, '../run': { getRun: () => null, startRun: () => {} },
    '../start': { START_TEXT: {} }, '../notify': {}, '../ui': {}, '../content': { MODE_LABEL: { RUN: '달리기' } }, '../theme': { color: {} }, '../core': {},
  };
  const module = { exports: {} as { default: () => void } };
  const source = ts.transpileModule(readFileSync(new URL('./app/run-ready.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, setTimeout, require: (id: string) => {
    if (!(id in imports)) throw new Error('Unexpected dependency: ' + id); return imports[id];
  } });
  const render = () => { cursor = 0; effects = []; module.exports.default(); const queued = effects; queued.forEach(fn => fn()); };
  return { render, resolve: () => resolve(position), replaceNavigation: () => { nav = navigation(); },
    state: () => slots[0].value as { phase: string }, requests: () => requests,
    blur: () => { focused = false; listeners.get('blur')?.forEach(fn => fn()); },
    dispose: () => { resolve(position); slots.forEach(s => s.cleanup?.()); },
  };
}

test('navigation subscription replacement cannot cancel GPS or repeatedly restart preparation', async () => {
  const h = harness();
  try {
    h.render(); assert.equal(h.state().phase, 'locating');
    h.replaceNavigation(); h.render();
    assert.equal(h.state().phase, 'locating'); assert.equal(h.requests(), 1);
    h.resolve(); await new Promise(r => setImmediate(r)); h.render();
    assert.equal(h.state().phase, 'ready'); assert.equal(h.requests(), 1);
    h.blur(); assert.equal(h.state().phase, 'cancelled', 'actual route blur still cancels');
  } finally { h.dispose(); }
});

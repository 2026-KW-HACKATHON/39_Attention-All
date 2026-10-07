import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

test('actual participation hook automatically enables an outside-started workout on entering 100m and disables on leaving', () => {
  const require = createRequire(import.meta.url), now = Date.now();
  const position = (meters: number) => ({ lat: meters / 111320, lng: 0, accuracyM: 5, measuredAt: now, precise: true });
  let run = { status: 'ACTIVE', last: position(150) };
  const values: unknown[] = []; let cursor = 0;
  const imports: Record<string, unknown> = {
    react: { useState: (initial: unknown) => {
      const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    }, useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() },
    'react-native': { Alert: {}, AppState: { currentState: 'active' } },
    'expo-router': { useIsFocused: () => true, useRouter: () => ({}) }, 'expo-location': {},
    './run': { getRun: () => run, subscribeRun: () => {} },
    './session': { useApi: () => ({ data: { paths: [{ points: [[0, -0.01], [0, 0.01]] }], participationRadiusM: 100 } }) },
    './location': {}, './core': {}, './pilot-access': {}, './pilot-proximity': require('./pilot-proximity.ts'),
  };
  const module = { exports: {} as typeof import('./proximity') };
  const source = ts.transpileModule(readFileSync(new URL('./proximity.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, require: (id: string) => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  } }, { filename: 'proximity.tsx' });
  const render = () => { cursor = 0; return module.exports.useParticipationAccess(); };
  assert.equal(render().restricted, true);
  run = { ...run, last: position(100) };
  assert.equal(render().status, 'inside'); assert.equal(render().restricted, false);
  run = { ...run, last: position(101) };
  assert.equal(render().restricted, true);
  run = { ...run, last: position(20) };
  assert.equal(render().restricted, false);
});

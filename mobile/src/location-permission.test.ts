import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness(granted: boolean) {
  let requests = 0;
  const module = { exports: {} as typeof import('./location') };
  const source = ts.transpileModule(readFileSync(new URL('./location.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sdk = {
    getForegroundPermissionsAsync: async () => ({ status: granted ? 'granted' : 'undetermined', android: { accuracy: 'fine' } }),
    requestForegroundPermissionsAsync: async () => { requests++; return { status: 'granted', android: { accuracy: 'fine' } }; },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: (id: string) => {
    if (id !== 'expo-location') throw new Error('Unexpected dependency: ' + id); return sdk;
  } });
  return { location: module.exports, requests: () => requests };
}

test('already granted location permission is checked without another native request', async () => {
  const h = harness(true), signals: boolean[] = [];
  assert.equal(await h.location.askPrecise(value => signals.push(value)), null);
  assert.equal(h.requests(), 0);
  assert.deepEqual(signals, []);
});

test('only the actual native permission request marks a pending system prompt', async () => {
  const h = harness(false), signals: boolean[] = [];
  assert.equal(await h.location.askPrecise(value => signals.push(value)), null);
  assert.equal(h.requests(), 1);
  assert.deepEqual(signals, [true, false]);
});

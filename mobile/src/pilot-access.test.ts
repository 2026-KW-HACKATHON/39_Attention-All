import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import type { Loc } from './location';
function harness(loc: Loc) {
  const require = createRequire(import.meta.url);
  let uid = 'owner';
  const dependencies = { locate: async () => loc, pilot: { paths: [{ points: [[0, -0.01], [0, 0.01]] }], participationRadiusM: 100 } };
  const imports: Record<string, unknown> = {
    './firebase': { call: async () => dependencies.pilot },
    './session': { getUid: () => uid },
    './location': { preciseLoc: () => dependencies.locate(), isLoc: (value: object) => !('ok' in value) },
    './core': require('./core.ts'), './pilot-proximity': require('./pilot-proximity.ts'),
  };
  const mod = { exports: {} as typeof import('./pilot-access') };
  const source = ts.transpileModule(readFileSync(new URL('./pilot-access.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports: mod.exports, module: mod, Date, require: (id: string) => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  } }, { filename: 'pilot-access.ts' });
  return { access: mod.exports, dependencies, switchAccount: () => { uid = 'other'; } };
}
const loc = (m: number): Loc => ({ lat: m / 111320, lng: 0, accuracyM: 5, measuredAt: Date.now(), precise: true });
test('participation location permits 100m inclusive and blocks beyond the nearest path', async () => {
  const inside = await harness(loc(100)).access.participationLoc();
  assert.equal('ok' in inside, false);
  const outside = await harness(loc(101)).access.participationLoc();
  assert.equal('ok' in outside && outside.errorCode, 'OUTSIDE_PILOT');
});
test('participation location never accepts mocked position or a different account after GPS wait', async () => {
  const mocked = await harness({ ...loc(0), mock: true }).access.participationLoc();
  assert.equal('ok' in mocked && mocked.errorCode, 'REJECTED_MOCK');
  const h = harness(loc(0));
  h.dependencies.locate = async () => { h.switchAccount(); return loc(0); };
  const changed = await h.access.participationLoc();
  assert.equal('ok' in changed && changed.errorCode, 'ACCOUNT_CHANGED');
});

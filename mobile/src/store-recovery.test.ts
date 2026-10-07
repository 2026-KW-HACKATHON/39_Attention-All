import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(contents: Record<string, string>) {
  const files = new Map(Object.entries(contents));
  class File {
    name: string;
    constructor(_root: unknown, name: string) { this.name = name; }
    get exists() { return files.has(this.name); }
    textSync() { return files.get(this.name)!; }
    moveSync(destination: File) { files.set(destination.name, this.textSync()); files.delete(this.name); this.name = destination.name; }
  }
  const mod = { exports: {} as typeof import('./store') };
  const source = ts.transpileModule(readFileSync(new URL('./store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports: mod.exports, module: mod, Date,
    require: (id: string) => {
      if (id !== 'expo-file-system') throw new Error(`Unexpected dependency: ${id}`);
      return { File, Directory: class { list() { return [...files.keys()].map(name => ({ name })); } }, Paths: { document: 'document' } };
    },
  }, { filename: 'store.ts' });
  return mod.exports;
}

test('첫 운동 저장 중 파일 이동 전에 앱이 종료돼도 임시 파일의 미전송 기록을 찾고 복구한다', () => {
  const store = harness({ 'run-owner-session.json.tmp': '{"sessionId":"session","pending":3}' });
  const names = store.listJson('run-owner-');
  assert.deepEqual(Array.from(names), ['run-owner-session.json']);
  const recovered = store.readJson<{ sessionId: string; pending: number } | null>(names[0], null);
  assert.equal(recovered?.sessionId, 'session');
  assert.equal(recovered?.pending, 3);
});

test('기존 파일과 임시 파일이 함께 있으면 운동은 한 번만 조회하고 기존 파일을 읽는다', () => {
  const store = harness({ 'run-owner-session.json': '{"pending":2}', 'run-owner-session.json.tmp': '{"pending":3}', 'run-owner-session.json.corrupt-1': '{}' });
  const names = store.listJson('run-owner-');
  assert.deepEqual(Array.from(names), ['run-owner-session.json']);
  assert.equal(store.readJson<{ pending: number }>(names[0], { pending: 0 }).pending, 2);
});

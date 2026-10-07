import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(env: Record<string, string>, development = false) {
  let selected: unknown;
  const app = { options: { projectId: 'uirun-92539' } };
  const imports: Record<string, unknown> = {
    'expo-constants': { expoConfig: { extra: { hasGoogleServices: true } } },
    'expo-file-system': {},
    '@react-native-firebase/app': { getApp: () => app },
    '@react-native-firebase/auth': { getAuth: () => ({}) },
    '@react-native-firebase/functions': { getFunctions: () => ({}) },
    '@react-native-firebase/storage': { getStorage: () => ({}) },
    '@react-native-firebase/app-check': { ReactNativeFirebaseAppCheckProvider: class { configure(value: unknown) { selected = value; } }, initializeAppCheck: () => ({}) },
    '@react-native-google-signin/google-signin': {},
    '../../backend/client/mobile-config.json': { projectId: 'uirun-92539', functionsRegion: 'asia-northeast3' },
    './core': {},
  };
  const mod = { exports: {} as typeof import('./firebase') };
  const source = ts.transpileModule(readFileSync(new URL('./firebase.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, __DEV__: development, process: { env }, require: (id: string) => {
    if (!(id in imports)) throw new Error('Unexpected dependency: ' + id);
    return imports[id];
  } });
  return { api: mod.exports, selected: () => selected as { android: { provider: string; debugToken?: string } } };
}

test('일반 릴리스는 토큰이 환경에 남아 있어도 Play Integrity를 사용한다', async () => {
  const h = harness({ EXPO_PUBLIC_UIRUN_TARGET: 'firebase', EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: 'unused' });
  await h.api.client();
  assert.equal(h.selected().android.provider, 'playIntegrity');
  assert.equal(h.selected().android.debugToken, undefined);
});

test('명시적인 내부 설치 테스트만 등록된 debug provider를 사용한다', async () => {
  const h = harness({ EXPO_PUBLIC_UIRUN_TARGET: 'firebase', EXPO_PUBLIC_UIRUN_INTERNAL_TEST: 'true', EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: 'test-fixture' });
  await h.api.client();
  assert.equal(h.selected().android.provider, 'debug');
  assert.equal(h.selected().android.debugToken, 'test-fixture');
});

test('내부 APK의 테스트 토큰이 빠지면 연결 전에 설정 오류로 중단한다', async () => {
  const h = harness({ EXPO_PUBLIC_UIRUN_TARGET: 'firebase', EXPO_PUBLIC_UIRUN_INTERNAL_TEST: 'true' });
  await assert.rejects(h.api.client(), /APPCHECK_DEBUG_TOKEN_MISSING/);
  assert.equal(h.selected(), undefined);
});

test('내부 테스트 플래그도 릴리스의 Emulator 연결 차단을 해제하지 않는다', async () => {
  const h = harness({ EXPO_PUBLIC_UIRUN_TARGET: 'emulator', EXPO_PUBLIC_UIRUN_INTERNAL_TEST: 'true', EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN: 'test-fixture' });
  await assert.rejects(h.api.client(), /EMULATOR_IN_RELEASE/);
});

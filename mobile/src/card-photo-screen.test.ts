import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createCardPhotoFlow, type CardJournal } from './card-photo.ts';
type Node = { type: string; props: Record<string, unknown> };
function harness() {
  let uid = 'a', cursor = 0, nav = 0;
  const slots: unknown[] = [], frames: (() => void)[] = [], files = new Map<string, CardJournal>();
  let cameraCalls = 0, cameraError = false, closedAtLaunch = false;
  const flow = createCardPhotoFlow({ uid: () => uid, read: id => files.get(id) ?? null, write: (id, value) => { files.set(id, value); return true; }, pending: async () => null });
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: { useRef: () => ({ current: null }), useEffect: () => {}, useState: (initial: unknown) => {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value: unknown) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    } }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width: 400 }) },
    'expo-router': { useLocalSearchParams: () => ({ id: 'run1' }), useRouter: () => ({ back: () => { nav++; } }) },
    'expo-image-picker': { requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: async () => {
      cameraCalls++; closedAtLaunch = slots[4] === false;
      if (cameraError) throw Error('native camera');
      return { canceled: false, assets: [{ uri: 'file:///new.jpg', width: 1200, height: 1600 }] };
    } }, 'expo-media-library/legacy': {}, 'expo-sharing': {}, 'react-native-view-shot': {},
    'react-native-svg': { default: 'Svg', Defs: 'Defs', LinearGradient: 'Gradient', Rect: 'Rect', Stop: 'Stop' },
    '../../session': { getUid: () => uid, useApi: () => ({ data: { mode: 'RUN', startedAt: 0, courseId: null, distanceM: 1000, activeMs: 10000 } }) },
    '../../card-photo-native': { cardPhotoFlow: flow, readCardDraft: () => null, saveCardDraft: () => true, subscribeCardDraft: () => () => {} },
    '../../core': { dur: () => '1', km: () => '1', pace: () => '1' }, '../../theme': { color: {}, font: {} },
    '../../content': { CARD_PHOTOS: ['river'], PHOTOS: { river: { src: 1, w: 300, h: 400 } }, LOGO: {}, MODE_LABEL: {}, coursePhoto: () => null },
    '../../ui': Object.fromEntries(['Btn','Icon','LoadState','Micro','Notice','Num','Row','Rows','Screen','Seg','Sheet','Txt'].map(k => [k,k])),
  };
  const module = { exports: {} as { default: () => Node } };
  const source = ts.transpileModule(readFileSync(new URL('./app/card/[id].tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, Promise, requestAnimationFrame: (fn: () => void) => { frames.push(fn); }, require: (id: string) => {
    if (!(id in imports)) throw Error('Unexpected dependency: ' + id); return imports[id];
  } });
  const render = () => { cursor = 0; return module.exports.default(); };
  function find(node: unknown, key: string, value: unknown): Node | undefined {
    if (Array.isArray(node)) return node.map(n => find(n,key,value)).find(Boolean);
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const n = node as Node; if (n.props[key] === value) return n;
    return find(n.props.children,key,value);
  }
  return { render, find, files, switchAccount: () => { uid = 'b'; }, cameraFailure: () => { cameraError = true; },
    frame: () => { frames.shift()?.(); }, flush: () => new Promise(resolve => setImmediate(resolve)),
    nav: () => nav, cameraCalls: () => cameraCalls, closed: () => closedAtLaunch };
}
test('record-card camera closes sheet, applies photo to same card, and never navigates home', async () => {
  const h = harness();
  const action = h.find(h.render(), 'title', '사진 촬영')?.props.onPress as () => void;
  action(); h.frame(); h.frame(); await h.flush();
  assert.equal(h.cameraCalls(), 1); assert.equal(h.closed(), true); assert.equal(h.nav(), 0);
  assert.equal(h.files.get('a')?.id, 'run1'); assert.equal(h.files.get('a')?.pic?.kind, 'user');
  assert.ok(h.find(h.render(), 'accessibilityLabel', '기록카드 배경 사진'));
});
test('account switch while closing sheet cannot launch camera or write old card under new account', async () => {
  const h = harness(); (h.find(h.render(), 'title', '사진 촬영')?.props.onPress as () => void)();
  h.switchAccount(); h.frame(); h.frame(); await h.flush();
  assert.equal(h.cameraCalls(), 0); assert.equal(h.files.size, 0); assert.equal(h.nav(), 0);
});
test('camera error leaves card visible with retry notice rather than unhandled rejection', async () => {
  const h = harness(); h.cameraFailure();
  (h.find(h.render(), 'title', '사진 촬영')?.props.onPress as () => void)();
  h.frame(); h.frame(); await h.flush();
  assert.equal(h.nav(), 0); assert.ok(h.find(h.render(), 'text', '사진을 가져오지 못했어요. 다시 시도해 주세요.'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCardPhotoFlow, type CardDraft } from './card-photo.ts';
const draft: CardDraft = { id: 'run-1', pic: null, tone: 'light', view: { zoom: 1, fx: .5, fy: .5 } };
const photo = { canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 1200, height: 1600 }] };
function fixture() {
  let uid: string | null = 'a';
  const files = new Map();
  let recoveries = 0;
  const deps = { uid: () => uid, read: (owner: string) => files.get(owner) ?? null, write: (owner: string, value: unknown) => { files.set(owner, value); return true; }, pending: async () => { recoveries++; return photo; } };
  return { deps, files, setUid: (v: string | null) => { uid = v; }, recoveries: () => recoveries };
}
test('camera activity recreation recovers photo and original card rather than home', async () => {
  const f = fixture(), old = createCardPhotoFlow(f.deps);
  void old.pick(draft, () => new Promise(() => {}));
  assert.equal(f.files.get('a').pending, true, 'state saved before camera');
  const fresh = createCardPhotoFlow(f.deps);
  const restored = await fresh.recover();
  assert.equal(restored?.id, 'run-1');
  assert.deepEqual(restored?.pic, { kind: 'user', uri: 'file:///photo.jpg', w: 1200, h: 1600 });
  assert.equal(f.files.get('a').pending, false);
  assert.equal(await fresh.recover(), null, 'does not keep redirecting');
});
test('normal camera return and cancellation retain card; resume cannot steal active result', async () => {
  const f = fixture(), flow = createCardPhotoFlow(f.deps);
  let resolve!: (value: typeof photo) => void;
  const pending = flow.pick(draft, () => new Promise<typeof photo>(r => { resolve = r; }));
  assert.equal(await flow.recover(), null); assert.equal(f.recoveries(), 0);
  resolve(photo); assert.equal((await pending)?.pic?.kind, 'user');
  const cancelled = await flow.pick(draft, async () => ({ canceled: true, assets: [] }));
  assert.deepEqual(cancelled, draft); assert.equal(f.files.get('a').pending, false);
});
test('picker error clears pending state without navigating; account change never applies another account photo', async () => {
  const f = fixture(), flow = createCardPhotoFlow(f.deps);
  await assert.rejects(flow.pick(draft, async () => { throw Error('camera'); }));
  assert.equal(f.files.get('a').pending, false);
  const result = await flow.pick(draft, async () => { f.setUid('b'); return photo; });
  assert.equal(result, null); assert.equal(f.files.get('a').pending, false);
  assert.equal(await flow.recover(), null);
});
test('write failure prevents launch; recovery with no native result preserves existing card', async () => {
  const f = fixture(); let launches = 0;
  const flow = createCardPhotoFlow({ ...f.deps, write: () => false });
  await assert.rejects(flow.pick(draft, async () => { launches++; return photo; })); assert.equal(launches, 0);
  f.files.set('a', { ...draft, pending: true });
  const fresh = createCardPhotoFlow({ ...f.deps, pending: async () => null });
  assert.deepEqual(await fresh.recover(), draft);
});

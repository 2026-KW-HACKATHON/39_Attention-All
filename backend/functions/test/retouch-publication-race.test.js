const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const storage = require('firebase-admin/storage');
const Store = require('../src/store');
const Photo = require('../src/public-photo');
const { initialState } = require('../src/service');

const admin = { uid: 'admin-a', admin: true };
const fullCover = [{ x: 0, y: 0, width: 1, height: 1 }];
const request = redactions => ({
  photoId: 'photo', published: true, privacyReviewed: true,
  redactions, clientRequestId: 'shared-request-id',
});
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

async function fixture(t, { delayUnmaskedUntilCommit = false, synchronizePreflight = true } = {}) {
  let state = initialState();
  const now = Date.now();
  state.issues.issue = { id: 'issue', visibility: 'PUBLIC', lifecycleStatus: 'OPEN', creatorUid: 'owner' };
  state.obs.observation = { id: 'observation', uid: 'owner', issueId: 'issue', visibility: 'PUBLIC', observedAt: now };
  state.photos.photo = {
    id: 'photo', uid: 'owner', status: 'READY', issueId: 'issue',
    observationId: 'observation', capturedAt: now, createdAt: now,
    processedPath: 'processed/owner/photo.jpg',
  };
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const masked = await Photo.render(source, fullCover);
  const unmasked = await Photo.render(source, []);
  const objects = new Map(), metadata = new Map(), saves = [], deletes = [], deleteOptions = [];
  const preflight = deferred(), committed = deferred();
  let reads = 0, created = 0, preconditionFailures = 0;
  const read = Store.read, transact = Store.transact;
  const descriptor = Object.getOwnPropertyDescriptor(storage, 'getStorage');
  const callablePath = require.resolve('../src/photo-callables');
  const priorCallable = require.cache[callablePath];
  t.after(() => {
    Store.read = read;
    Store.transact = transact;
    Object.defineProperty(storage, 'getStorage', descriptor);
    delete require.cache[callablePath];
    if (priorCallable) require.cache[callablePath] = priorCallable;
  });
  Store.read = async fn => {
    const result = fn(structuredClone(state));
    // Both calls must validate before either can create a receipt.
    if (synchronizePreflight && ++reads <= 2) {
      if (reads === 2) preflight.resolve();
      await preflight.promise;
    }
    return result;
  };
  Store.transact = async fn => {
    const next = structuredClone(state);
    const result = fn(next);
    state = next;
    if (Object.keys(state.receipts).length) committed.resolve();
    return structuredClone(result);
  };
  const objectFile = path => ({
      name: path,
      download: async () => [path === state.photos.photo?.processedPath ? source : objects.get(path)],
      getMetadata: async () => [metadata.get(path) || { timeCreated: new Date(now).toISOString(), generation: '123' }],
      save: async (bytes, options) => {
        saves.push({ path, options });
        if (delayUnmaskedUntilCommit && bytes.equals(unmasked)) await committed.promise;
        if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) {
          preconditionFailures++;
          const error = new Error('Precondition Failed');
          error.code = 412;
          throw error;
        }
        objects.set(path, Buffer.from(bytes));
        created++;
      },
      delete: async options => { deletes.push(path); deleteOptions.push(options); objects.delete(path); },
    });
  Object.defineProperty(storage, 'getStorage', { value: () => ({ bucket: () => ({
    file: objectFile,
    getFiles: async () => [[...objects.keys()].map(objectFile), null],
  }) }) });
  delete require.cache[callablePath];
  const { publish, cleanupOrphans } = require('../src/photo-callables');
  return {
    publish, cleanupOrphans, masked, unmasked, objects, metadata, saves, deletes, deleteOptions,
    state: () => state, created: () => created,
    preconditionFailures: () => preconditionFailures,
  };
}

test('conflicting concurrent publication cannot replace the approved redacted bytes', { timeout: 10000 }, async t => {
  const f = await fixture(t, { delayUnmaskedUntilCommit: true });
  const results = await Promise.allSettled([
    f.publish(admin, request(fullCover)),
    f.publish(admin, request([])),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.published, true);
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /REQUEST_CONFLICT/);
  const photo = f.state().photos.photo;
  assert.equal(photo.publicApproved, true);
  assert.deepEqual(photo.publicRedactions, fullCover);
  assert.deepEqual(f.objects.get(photo.publicPath), f.masked, 'approved bytes must match the winning privacy review');
  assert.equal(new Set(f.saves.map(s => s.path)).size, 2, 'conflicting payloads must have distinct immutable paths');
  for (const save of f.saves) assert.equal(save.options?.preconditionOpts?.ifGenerationMatch, 0);
  assert.equal(f.deletes.length, 0, 'a failed receipt commit must not delete another in-flight publication');
});

test('same request ID from different administrators uses distinct publication objects', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.publish(admin, request(fullCover)),
    f.publish({ uid: 'admin-b', admin: true }, request(fullCover)),
  ]);
  assert.ok(results.every(result => result.ok && result.published));
  assert.equal(Object.keys(f.state().receipts).length, 2);
  assert.equal(new Set(f.saves.map(s => s.path)).size, 2, 'receipt ownership must be reflected in object identity');
  assert.deepEqual(f.objects.get(f.state().photos.photo.publicPath), f.masked);
});

test('identical concurrent retries reuse an immutable object after Storage precondition failure', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.publish(admin, request(fullCover)),
    f.publish(admin, request(fullCover)),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(Object.keys(f.state().receipts).length, 1);
  assert.equal(f.saves.length, 2);
  assert.equal(new Set(f.saves.map(s => s.path)).size, 1);
  for (const save of f.saves) assert.equal(save.options?.preconditionOpts?.ifGenerationMatch, 0);
  assert.equal(f.created(), 1, 'only the first retry may create the object');
  assert.equal(f.preconditionFailures(), 1);
  assert.deepEqual(f.objects.get(f.state().photos.photo.publicPath), f.masked);
  assert.equal(f.deletes.length, 0);
});

test('orphan cleanup protects old unreferenced copies while their photo record exists', async t => {
  const f = await fixture(t, { synchronizePreflight: false });
  const path = Photo.copyPath('photo', admin.uid, request(fullCover));
  f.objects.set(path, f.masked);
  f.metadata.set(path, { timeCreated: new Date(Date.now() - 7200000).toISOString(), generation: '123' });
  // A failed publication has no publicPath/receipt. A retry may reuse this object.
  assert.equal(f.state().photos.photo.publicPath, undefined);
  await f.cleanupOrphans();
  assert.equal(f.objects.has(path), true);
  assert.equal(f.deletes.length, 0);
  // Withdrawal still leaves the manifest until physical deletion finishes.
  f.state().photos.photo.status = 'DELETE_PENDING';
  await f.cleanupOrphans();
  assert.equal(f.objects.has(path), true);
});

test('orphan cleanup deletes aged copies after the photo record has been removed', async t => {
  const f = await fixture(t, { synchronizePreflight: false });
  const path = Photo.copyPath('photo', admin.uid, request(fullCover));
  f.objects.set(path, f.masked);
  f.metadata.set(path, { timeCreated: new Date(Date.now() - 7200000).toISOString(), generation: '456' });
  delete f.state().photos.photo;
  await f.cleanupOrphans();
  assert.equal(f.objects.has(path), false);
  assert.deepEqual(f.deletes, [path]);
  assert.deepEqual(f.deleteOptions, [{ ignoreNotFound: true, ifGenerationMatch: '456' }]);
});

test('orphan cleanup retains fresh copies even after the photo record was removed', async t => {
  const f = await fixture(t, { synchronizePreflight: false });
  const path = Photo.copyPath('photo', admin.uid, request(fullCover));
  f.objects.set(path, f.masked);
  f.metadata.set(path, { timeCreated: new Date(Date.now() - 60000).toISOString(), generation: '789' });
  delete f.state().photos.photo;
  await f.cleanupOrphans();
  assert.equal(f.objects.has(path), true);
  assert.equal(f.deletes.length, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireStore = createRequire(path.resolve(__dirname, '../src/store.js'));
function fixture() {
  const records = new Map(), reads = [], writes = [];
  const firestore = {
    doc: path => ({ path }),
    collection: path => ({ path, where: (field, operator, value) => ({ path, field, value }) }),
    runTransaction: async fn => {
      const pending = [];
      const result = await fn({
        get: async ref => {
          reads.push(ref);
          if (ref.path.endsWith('/entries')) return { docs: [...records].filter(([k, v]) => k.startsWith(ref.path + '/') && (!ref.field || v.value.uid === ref.value)).map(([, v]) => ({ data: () => structuredClone(v) })) };
          return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) };
        },
        set: (ref, data, options) => pending.push([ref.path, structuredClone(data), options]),
        delete: ref => pending.push([ref.path, undefined]),
      });
      for (const [key, value, options] of pending) { writes.push(key); if (value === undefined) records.delete(key); else records.set(key, options?.merge ? { ...records.get(key), ...value } : value); }
      return result;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/store.js'), 'utf8'), {
    require: name => name === 'firebase-admin/firestore' ? { getFirestore: () => firestore } : requireStore(name),
    module, Buffer, Date, console,
  });
  const store = module.exports;
  const put = (table, key, value) => records.set(`internalTables/${table}/entries/${store.idFor(key)}`, { key, value: store.pack(value) });
  const get = (table, key) => store.unpack(records.get(`internalTables/${table}/entries/${store.idFor(key)}`)?.value);
  records.set('internal/meta', { seq: 91, geometry: { paths: [{ id: 'L', corridorId: 'W', points: [[37.619, 127.05], [37.623, 127.05]] }] }, revision: 1 });
  return { store, records, reads, writes, put, get };
}
const consent = { clientRequestId: 'consent', accepted: true, version: 'v2-2026-10' };
const uid = { uid: 'u' };

test('account writes never query all users or rewrite shared metadata', async () => {
  const f = fixture();
  await f.store.mutate(uid, 'recordConsent', consent);
  await f.store.mutate(uid, 'updateProfile', { clientRequestId: 'profile', displayName: 'Tester' });
  assert.equal(f.get('users', 'u').displayName, 'Tester');
  assert.equal(f.records.get('internal/meta').revision, 1);
  assert.ok(f.reads.filter(r => r.path.endsWith('/entries')).every(r => r.field === 'value.uid' && r.value === 'u'));
  assert.ok(f.writes.includes('internalRunAccounts/' + f.store.idFor('u')));
  assert.ok(!f.reads.some(r => r.path === 'internal/meta'));
});

test('scoped runs retain ownership, one-active-session and duplicate finish semantics', async () => {
  const f = fixture();
  await f.store.mutate(uid, 'recordConsent', consent);
  const start = { clientRequestId: 'start', mode: 'WALK', loc: { lat: 37.62, lng: 127.05, accuracyM: 5, precise: true, measuredAt: Date.now() } };
  const run = await f.store.mutate(uid, 'startRun', start);
  assert.deepEqual(await f.store.mutate(uid, 'startRun', start), run);
  await assert.rejects(f.store.mutate(uid, 'startRun', { ...start, clientRequestId: 'second' }), /ACTIVE_SESSION_EXISTS/);
  await f.store.mutate({ uid: 'other' }, 'recordConsent', consent);
  await assert.rejects(f.store.mutate({ uid: 'other' }, 'discardRun', { clientRequestId: 'discard', sessionId: run.sessionId }), /NOT_FOUND/);
  const finish = { clientRequestId: 'finish', sessionId: run.sessionId, expectedTrackCount: 0 };
  const result = await f.store.mutate(uid, 'finishRun', finish);
  assert.deepEqual(await f.store.mutate(uid, 'finishRun', finish), result);
  assert.equal(f.get('sessions', run.sessionId).status, 'COMPLETED');
  await assert.rejects(f.store.mutate(uid, 'finishRun', { ...finish, expectedTrackCount: 1 }), /REQUEST_CONFLICT/);
  assert.equal(f.records.get('internal/meta').seq, 91);
});

test('account writes expire own pending rewards and preserve another account', async () => {
  const f = fixture(), expired = { id: 'tx1', uid: 'u', status: 'PENDING', expiresAt: 1, amount: 20, dayKey: 'day', issueId: 'issue' };
  f.put('users', 'u', { displayName: '' });
  f.put('ledger', 'tx1', expired);
  f.put('ledger', 'tx2', { ...expired, id: 'tx2', uid: 'other' });
  f.put('budgets', 'u|day', { base: 25, quick: 4 });
  f.put('entitlements', 'PHOTO_NEW|u|issue', { outcome: 'PENDING', at: 1 });
  await f.store.mutate(uid, 'recordConsent', consent);
  assert.equal(f.get('ledger', 'tx1').status, 'EXPIRED');
  assert.equal(f.get('ledger', 'tx2').status, 'PENDING');
  assert.equal(f.get('budgets', 'u|day').base, 5);
  assert.equal(f.get('entitlements', 'PHOTO_NEW|u|issue').outcome, 'EXPIRED');
});

test('account deletion blocks replay and failed mutations write nothing', async () => {
  const f = fixture();
  await assert.rejects(f.store.mutate({}, 'recordConsent', consent), /UNAUTHENTICATED/);
  await assert.rejects(f.store.mutate(uid, 'recordConsent', { ...consent, accepted: false }), /INVALID_ARGUMENT/);
  assert.equal(f.writes.length, 0);
  await f.store.mutate(uid, 'recordConsent', consent);
  f.put('deletionJobs', 'u', { uid: 'u' });
  const count = f.writes.length;
  await assert.rejects(f.store.mutate(uid, 'recordConsent', consent), /ACCOUNT_DELETING/);
  assert.equal(f.writes.length, count);
});

test('full reward transactions maintain the pending index used by later scoped expiry', async () => {
  const f = fixture();
  await f.store.mutate(uid, 'recordConsent', consent);
  await f.store.transact(d => {
    d.ledger.push({ id: 'reward', uid: 'u', status: 'PENDING', expiresAt: 1, amount: 10, dayKey: 'day', issueId: 'issue' });
    d.budgets['u|day'] = { base: 10, quick: 0 };
    d.entitlements['PHOTO_NEW|u|issue'] = { outcome: 'PENDING' };
    return { ok: true };
  });
  const key = 'internalRunAccounts/' + f.store.idFor('u');
  assert.deepEqual(f.records.get(key).pendingLedgerIds, ['reward']);
  f.reads.length = 0;
  await f.store.mutate(uid, 'updateSettings', { clientRequestId: 'settings', uiMode: 'SIMPLE' });
  assert.equal(f.get('ledger', 'reward').status, 'EXPIRED');
  assert.deepEqual(f.records.get(key).pendingLedgerIds, []);
  assert.ok(!f.reads.some(r => r.path.endsWith('/entries')));
  await f.store.transact(d => { delete d.users.u; return { ok: true }; });
  assert.equal(f.records.has(key), false);
});

test('legacy active session migrates once and prevents an additional start', async () => {
  const f = fixture();
  f.put('users', 'u', { displayName: '' });
  f.put('sessions', 'legacy', { id: 'legacy', uid: 'u', status: 'ACTIVE' });
  await f.store.mutate(uid, 'recordConsent', consent);
  assert.equal(f.records.get('internalRunAccounts/' + f.store.idFor('u')).activeSessionId, 'legacy');
  f.reads.length = 0;
  await assert.rejects(f.store.mutate(uid, 'startRun', { clientRequestId: 'start', mode: 'WALK', loc: { lat: 37.62, lng: 127.05, accuracyM: 5, measuredAt: Date.now(), precise: true } }), /ACTIVE_SESSION_EXISTS/);
  assert.ok(!f.reads.some(r => r.path.endsWith('/entries')));
});

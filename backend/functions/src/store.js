const { getFirestore } = require("firebase-admin/firestore");
const { initialState, execute } = require("./service");
const V = require("./validation");
const ARRAYS = new Set(["ledger", "coupons"]);
const TABLES = Object.keys(initialState()).filter(
  (k) => !["seq", "geometry"].includes(k),
);
const idFor = (k) => Buffer.from(k).toString("base64url");
const clean = (x) => JSON.parse(JSON.stringify(x));
function pack(x, inArray = false) {
  if (Array.isArray(x)) {
    const value = x.map((v) => pack(v, true));
    return inArray ? { __uirunArray: value } : value;
  }
  if (x && typeof x === "object")
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, pack(v)]));
  return x;
}
function unpack(x) {
  if (Array.isArray(x)) return x.map(unpack);
  if (x && typeof x === "object") {
    if (Object.keys(x).length === 1 && Array.isArray(x.__uirunArray))
      return x.__uirunArray.map(unpack);
    return Object.fromEntries(
      Object.entries(x).map(([k, v]) => [k, unpack(v)]),
    );
  }
  return x;
}
async function load(tx) {
  const f = getFirestore();
  const meta = await tx.get(f.doc("internal/meta"));
  const snapshots = await Promise.all(
    TABLES.map((t) => tx.get(f.collection(`internalTables/${t}/entries`))),
  );
  const d = initialState();
  d.seq = meta.data()?.seq || 0;
  d.geometry = unpack(meta.data()?.geometry) || { paths: [] };
  snapshots.forEach((snap, i) => {
    const table = TABLES[i];
    d[table] = ARRAYS.has(table)
      ? snap.docs.map((doc) => unpack(doc.data().value))
      : Object.fromEntries(
          snap.docs.map((doc) => [doc.data().key, unpack(doc.data().value)]),
        );
  });
  return d;
}
function entries(d, k) {
  return ARRAYS.has(k) ? Object.fromEntries(d[k].map((v) => [v.id, v])) : d[k];
}
function persist(tx, before, after, writeMeta = true) {
  const f = getFirestore();
  let writes = writeMeta ? 1 : 0;
  const accounts = new Set();
  for (const table of TABLES) {
    const a = entries(before, table),
      b = entries(after, table);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
      writes++;
      if (table === "sessions" || table === "ledger")
        for (const row of [a[key], b[key]]) if (row?.uid) accounts.add(row.uid);
      if (table === "users" && b[key] === undefined) {
        writes++;
        tx.delete(f.doc(`internalRunAccounts/${idFor(key)}`));
      }
      if (table === "deletionJobs") {
        writes++;
        tx.set(f.doc("accountBlocks/" + key), { blocked: true });
      }
      if (table === "tickets") {
        writes++;
        const grant = f.doc("captureGrants/" + key);
        if (b[key] === undefined) tx.delete(grant);
        else
          tx.set(grant, {
            uid: b[key].uid,
            expiresAt: b[key].expiresAt,
            shutterAt: b[key].shutterAt || null,
            consumed: !!b[key].consumed,
          });
      }
      if (writes > 450) throw new Error("PILOT_TRANSACTION_LIMIT");
      const ref = f.doc(`internalTables/${table}/entries/${idFor(key)}`);
      if (b[key] === undefined) tx.delete(ref);
      else tx.set(ref, { key, value: pack(clean(b[key])) });
    }
  }
  // Full snapshots keep the index current for reward, retention and admin work.
  // Scoped transactions update it once, with their account's partial snapshot.
  if (writeMeta) for (const uid of accounts) {
    if (!after.users[uid]) continue;
    if (++writes > 450) throw new Error("PILOT_TRANSACTION_LIMIT");
    tx.set(f.doc(`internalRunAccounts/${idFor(uid)}`), accountIndex(after, uid), { merge: true });
  }
  if (writeMeta) tx.set(f.doc("internal/meta"), {
    seq: after.seq,
    geometry: pack(after.geometry),
    revision: Date.now(),
  });
}
async function transact(fn) {
  return getFirestore().runTransaction(async (tx) => {
    const before = await load(tx);
    const after = clean(before);
    const result = await fn(after);
    persist(tx, before, after);
    return clean(result);
  });
}
async function read(fn) {
  return getFirestore().runTransaction(async (tx) => fn(await load(tx)), {
    readOnly: true,
  });
}
// These operations only change the caller's profile, consent, run and expiry records.
// Reward/admin/photo operations retain the complete transactional snapshot.
const ACCOUNT_MUTATIONS = new Set([
  "recordConsent", "updateProfile", "updateSettings", "startRun", "appendTrack",
  "pauseRun", "resumeRun", "finishRun", "discardRun",
]);
function accountIndex(d, uid) {
  return {
    version: 1,
    activeSessionId: Object.values(d.sessions).find(s => s.uid === uid && ["ACTIVE", "PAUSED"].includes(s.status))?.id || null,
    pendingLedgerIds: d.ledger.filter(r => r.uid === uid && r.status === "PENDING").map(r => r.id),
  };
}
async function loadAccount(tx, uid, name, data) {
  const f = getFirestore(), d = initialState();
  const document = async (table, key) => {
    const snap = await tx.get(f.doc(`internalTables/${table}/entries/${idFor(key)}`));
    if (snap.exists) {
      const value = unpack(snap.data().value);
      if (ARRAYS.has(table)) d[table].push(value);
      else d[table][key] = value;
    }
  };
  const receipt = V.digest([uid, name, V.text(data.clientRequestId, 100)]);
  // This account document serializes concurrent starts without a global lock.
  const guard = f.doc(`internalRunAccounts/${idFor(uid)}`);
  const index = (await tx.get(guard)).data();
  await Promise.all([
    document("users", uid), document("consents", uid),
    document("deletionJobs", uid), document("receipts", receipt),
  ]);
  if (index?.version === 1) {
    await Promise.all([
      ...(index.activeSessionId ? [document("sessions", index.activeSessionId)] : []),
      ...(index.pendingLedgerIds || []).map(id => document("ledger", id)),
    ]);
  } else if (d.users[uid]) {
    // Existing pilot accounts migrate lazily, once. Fresh accounts never query
    // shared collections on the hot path. Full transactions maintain this index.
    const snapshots = await Promise.all(["sessions", "ledger"].map(table =>
      tx.get(f.collection(`internalTables/${table}/entries`).where("value.uid", "==", uid))));
    d.sessions = Object.fromEntries(snapshots[0].docs.map(s => [s.data().key, unpack(s.data().value)]));
    d.ledger = snapshots[1].docs.map(s => unpack(s.data().value));
  }
  if (name === "startRun") {
    const meta = await tx.get(f.doc("internal/meta"));
    d.seq = meta.data()?.seq || 0;
    d.geometry = unpack(meta.data()?.geometry) || { paths: [] };
    if (data.courseId) await document("courses", V.text(data.courseId, 100));
  } else if (["appendTrack", "pauseRun", "resumeRun", "finishRun", "discardRun"].includes(name)) {
    const id = V.text(data.sessionId, 100);
    if (!d.sessions[id]) await document("sessions", id);
  }
  // Keep the caller's pending reward expiry and its original-day budget refund.
  // Scheduled retention independently expires other accounts.
  const related = new Map();
  for (const row of d.ledger.filter(r => r.status === "PENDING")) {
    const budget = row.uid + "|" + row.dayKey;
    const entitlement = "PHOTO_NEW|" + row.uid + "|" + row.issueId;
    related.set("budgets/" + budget, ["budgets", budget]);
    related.set("entitlements/" + entitlement, ["entitlements", entitlement]);
  }
  await Promise.all([...related.values()].map(([table, key]) => document(table, key)));
  return { d, guard };
}
async function mutate(auth, name, data) {
  if (!auth.uid) V.fail("UNAUTHENTICATED");
  if (!ACCOUNT_MUTATIONS.has(name))
    return transact(d => execute(d, auth, name, data, Date.now()));
  return getFirestore().runTransaction(async tx => {
    const { d: before, guard } = await loadAccount(tx, auth.uid, name, data);
    const after = clean(before);
    const result = execute(after, auth, name, data, Date.now());
    if (after.seq !== before.seq || JSON.stringify(after.geometry) !== JSON.stringify(before.geometry))
      throw Error("ACCOUNT_TRANSACTION_SCOPE_CHANGED");
    const allowed = new Set(["users", "consents", "receipts", "sessions", "ledger", "budgets", "entitlements"]);
    if (TABLES.some(table => !allowed.has(table) && JSON.stringify(before[table]) !== JSON.stringify(after[table])))
      throw Error("ACCOUNT_TRANSACTION_SCOPE_CHANGED");
    persist(tx, before, after, false);
    tx.set(guard, { ...accountIndex(after, auth.uid), revision: Date.now() });
    return clean(result);
  });
}
module.exports = { transact, mutate, read, idFor, TABLES, pack, unpack };

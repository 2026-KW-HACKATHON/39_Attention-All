const { getFirestore } = require("firebase-admin/firestore");
const { initialState } = require("./service");
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
function persist(tx, before, after) {
  const f = getFirestore();
  let writes = 1;
  for (const table of TABLES) {
    const a = entries(before, table),
      b = entries(after, table);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
      writes++;
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
  tx.set(f.doc("internal/meta"), {
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
module.exports = { transact, read, idFor, TABLES, pack, unpack };

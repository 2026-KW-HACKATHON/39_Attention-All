if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error('EMULATORS_REQUIRED');
const { initializeApp: adminInit } = require("firebase-admin/app");
adminInit({ projectId: "demo-uirun", storageBucket: "demo-uirun.appspot.com" });
const Store = require("../src/store");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
} = require("firebase/auth");
const {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} = require("firebase/functions");
const {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
} = require("firebase/storage");
const sharp = require("sharp");
const assert = require("node:assert/strict");
(async () => {
  await Store.transact((d) => {
    // This standalone test owns a disposable demo-uirun database; remove other test fixtures.
    for(const key of Object.keys(d))delete d[key];
    Object.assign(d,require("../src/service").initialState());
    d.geometry.paths = [
      {
        id: "L",
        corridorId: "W1",
        points: [
          [37.619, 127.05],
          [37.621, 127.05],
        ],
      },
    ];
    return { ok: true };
  });
  const app = initializeApp({
    projectId: "demo-uirun",
    apiKey: "demo-key",
    storageBucket: "demo-uirun.appspot.com",
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInAnonymously(auth);
  const f = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(f, "127.0.0.1", 5001);
  const storage = getStorage(app);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  const call = async (n, d = {}) => (await httpsCallable(f, n)(d)).data;
  const mutate = (n, d = {}) =>
    call(n, { clientRequestId: crypto.randomUUID(), ...d });
  const loc = () => ({
    lat: 37.62,
    lng: 127.05,
    accuracyM: 8,
    measuredAt: Date.now(),
    precise: true,
  });
  await mutate("recordConsent", { version: "v2-2026-10", accepted: true });
  const ticket = await mutate("issueCaptureTicket", {
    purpose: "DISCOVERY",
    categoryCode: "LITTER",
    loc: loc(),
  });
  await mutate("sealCapture", { ticketId: ticket.ticketId, loc: loc() });
  const jpeg = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#cccccc" },
  })
    .jpeg()
    .toBuffer();
  await uploadBytes(ref(storage, ticket.uploadPath), jpeg, {
    contentType: "image/jpeg",
  });
  let status;
  for (let i = 0; i < 25; i++) {
    status = await call("getPhotoStatus", { ticketId: ticket.ticketId });
    if (status.status === "READY") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(status.status, "READY");
  const issue = await mutate("createIssue", {
    ticketId: ticket.ticketId,
    categoryCode: "LITTER",
    modality: "PHOTO",
    pin: [37.62, 127.05],
  });
  assert.equal(issue.ok, true, JSON.stringify(issue));
  assert.equal(issue.pointsPending, 5);
  const data = await call("getIssueDetail", { issueId: issue.resultId });
  assert.equal(data.own, true);
  assert.equal(data.issue.photos.length, 0);
  const bucket = require("firebase-admin/storage").getStorage().bucket();
  const [metadata] = await bucket.file(ticket.uploadPath).getMetadata();
  process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: "demo-uirun",
    storageBucket: bucket.name,
  });
  const serverFns = require("../src/index");
  await serverFns.processEvidence.run({
    data: { ...metadata, bucket: bucket.name },
  });
  assert.equal(
    (await bucket.file(ticket.uploadPath).exists())[0],
    true,
    "duplicate event must retain an attached original",
  );
  const uid = auth.currentUser.uid;
  for (let start = 0; start < 600; start += 150)
    await Store.transact((d) => {
      for (let n = start; n < start + 150; n++)
        d.receipts["smoke-" + n] = {
          id: "smoke-" + n,
          uid,
          createdAt: Date.now(),
          result: { ok: true },
        };
      return { ok: true };
    });
  await mutate("deleteMyAccountData", { confirm: true });
  await assert.rejects(call("getRecords"), /ACCOUNT_DELETING/);
  await serverFns.hourlyMaintenance.run({});
  await Store.read((d) => {
    assert.equal(d.deletionJobs[uid].status, "COMPLETE");
    assert.equal(d.photos[ticket.ticketId], undefined);
    assert.equal(d.users[uid], undefined);
    assert.equal(
      Object.values(d.receipts).filter((r) => r.uid === uid).length,
      0,
    );
  });
  for (const path of [
    ticket.uploadPath,
    `processed/${uid}/${ticket.ticketId}.jpg`,
    `thumbnails/${ticket.ticketId}.jpg`,
  ])
    assert.equal((await bucket.file(path).exists())[0], false);
  await assert.rejects(
    require("firebase-admin/auth").getAuth().getUser(uid),
    (e) => e.code === "auth/user-not-found",
  );
  console.log(
    "PASS duplicate storage event retains evidence; 600 receipts + photos + Auth account deletion completes",
  );
  console.log(
    "PASS callable auth → consent → capture → actual JPEG upload → image trigger → pending Issue → private DTO",
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

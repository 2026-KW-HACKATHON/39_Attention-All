const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const { ref, uploadBytes, getBytes } = require("firebase/storage");
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-uirun",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: fs.readFileSync("../firestore.rules", "utf8"),
    },
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: fs.readFileSync("../storage.rules", "utf8"),
    },
  });
  // A repeat run must not inherit overwrite-protected files or deletion blocks.
  // Installed rules-unit-testing clearStorage only deletes root items, not prefixes.
  await env.withSecurityRulesDisabled(async c=>{
    const clear=async folder=>{const {items,prefixes}=await folder.listAll();await Promise.all(items.map(item=>item.delete()));for(const prefix of prefixes)await clear(prefix);};
    await clear(c.storage().ref());
  });
  await env.clearFirestore();
});
after(async () => env?.cleanup());
test("internal domain data cannot be read or altered, including own ledger", async () => {
  const f = env.authenticatedContext("u").firestore();
  await assertFails(getDoc(doc(f, "internal/meta")));
  await assertFails(
    setDoc(doc(f, "internalTables/users/entries/u"), { pointsBalance: 100 }),
  );
  await assertFails(getDoc(doc(f, "internalTables/ledger/entries/u")));
});
test("unauthenticated read denied", async () =>
  await assertFails(
    getDoc(doc(env.unauthenticatedContext().firestore(), "internal/meta")),
  ));
test("storage denies unrelated uploads and private photos", async () => {
  const s = env.authenticatedContext("other").storage();
  await assertFails(
    uploadBytes(ref(s, "evidence/u/fake/original.jpg"), new Uint8Array(5), {
      contentType: "image/jpeg",
    }),
  );
  await assertFails(getBytes(ref(s, "processed/u/x.jpg")));
  await assertFails(uploadBytes(ref(s, "thumbnails/x.jpg"), new Uint8Array(5)));
});
test("public copies stay inaccessible through Storage SDK", async()=>{
 const path="publicCopies/photo/request.jpg";
 await env.withSecurityRulesDisabled(c=>uploadBytes(ref(c.storage(),path),new Uint8Array(5),{contentType:"image/jpeg"}));
 for(const c of [env.unauthenticatedContext(),env.authenticatedContext("u"),env.authenticatedContext("admin",{admin:true})]){
  await assertFails(getBytes(ref(c.storage(),path)));
  await assertFails(uploadBytes(ref(c.storage(),path),new Uint8Array(5),{contentType:"image/jpeg"}));
 }
});
test("original upload needs server issued sealed ticket and correct MIME", async () => {
  await env.withSecurityRulesDisabled(
    async (c) =>
      await setDoc(doc(c.firestore(), "captureGrants/test-ticket"), {
        uid: "u",
        shutterAt: Date.now(),
        expiresAt: Date.now() + 600000,
        consumed: false,
      }),
  );
  const s = env.authenticatedContext("u").storage();
  await assertFails(
    uploadBytes(
      ref(s, "evidence/u/missing-ticket/original.jpg"),
      new Uint8Array(5),
      { contentType: "image/jpeg" },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(s, "evidence/u/test-ticket/original.jpg"),
      new Uint8Array(5),
      { contentType: "application/octet-stream" },
    ),
  );
  await assertSucceeds(
    uploadBytes(
      ref(s, "evidence/u/test-ticket/original.jpg"),
      new Uint8Array(5),
      { contentType: "image/jpeg" },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(s, "evidence/u/test-ticket/original.jpg"),
      new Uint8Array(5),
      { contentType: "image/jpeg" },
    ),
  );
});
test("Firestore adapter serializes retries and prevents duplicate active session", async () => {
  process.env.GCLOUD_PROJECT = "demo-uirun";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const { initializeApp, getApps } = require("firebase-admin/app");
  if (!getApps().length) initializeApp({ projectId: "demo-uirun" });
  const Store = require("../src/store");
  const { execute } = require("../src/service");
  const t = Date.now(),
    a = { uid: "race" };
  await Store.transact((d) => {
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
    return execute(
      d,
      a,
      "recordConsent",
      {
        clientRequestId: "consent-00001",
        accepted: true,
        version: "v2-2026-10",
      },
      t,
    );
  });
  const args = {
    clientRequestId: "retry-0001",
    mode: "WALK",
    loc: {
      lat: 37.62,
      lng: 127.05,
      accuracyM: 8,
      precise: true,
      measuredAt: t,
    },
  };
  const rs = await Promise.all(
    [1, 2, 3].map(() =>
      Store.transact((d) => execute(d, a, "startRun", args, t)),
    ),
  );
  assert.ok(rs.every((r) => r.sessionId === rs[0].sessionId));
  await assert.rejects(
    Store.transact((d) =>
      execute(d, a, "startRun", { ...args, clientRequestId: "new-request" }, t),
    ),
    /ACTIVE_SESSION_EXISTS/,
  );
});
async function server() {
  process.env.GCLOUD_PROJECT = "demo-uirun";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const { initializeApp, getApps } = require("firebase-admin/app");
  if (!getApps().length) initializeApp({ projectId: "demo-uirun" });
  return require("../src/store");
}
const P = require("../src/policy.cjs"),
  V = require("../src/validation");
const { execute } = require("../src/service");
const { randomUUID } = require("node:crypto");
const consentArgs = () => ({
  clientRequestId: randomUUID(),
  accepted: true,
  version: "v2-2026-10",
});
test("last welcome coupon stock is atomic across users and independent retries", async () => {
  const Store = await server(),
    t = Date.now();
  await Store.transact((d) => {
    d.catalog.WELCOME_500 = {
      stock: 1,
      merchantId: "stock-merchant",
      validDays: 30,
    };
    d.merchants["stock-merchant"] = { pin: "SERVER_VALIDATED" };
    for (const uid of ["stock-a", "stock-b"]) {
      execute(d, { uid }, "recordConsent", consentArgs(), t);
      d.users[uid].welcomeStatus = "APPROVED";
      for (let n = 0; n < 3; n++)
        d.contributions[uid + n] = { uid, status: "VALID", source: "RECHECK" };
    }
    return { ok: true };
  });
  const results = await Promise.all(
    ["stock-a", "stock-b"].map((uid) =>
      Store.transact((d) =>
        execute(
          d,
          { uid },
          "claimWelcome",
          { clientRequestId: randomUUID() },
          t,
        ),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(
    results.filter((r) => r.errorCode === "REWARD_SOLD_OUT").length,
    1,
  );
  const winner = results[0].ok ? "stock-a" : "stock-b";
  const again = await Store.transact((d) =>
    execute(
      d,
      { uid: winner },
      "claimWelcome",
      { clientRequestId: randomUUID() },
      t,
    ),
  );
  assert.equal(again.ok, false);
  await Store.read((d) => {
    assert.equal(d.catalog.WELCOME_500.stock, 0);
    assert.equal(
      d.coupons.filter((c) => ["stock-a", "stock-b"].includes(c.uid)).length,
      1,
    );
  });
});
test("parallel use windows and PIN confirmations cannot spend a coupon twice", async () => {
  const Store = await server(),
    t = Date.now(),
    uid = "coupon-race";
  await Store.transact((d) => {
    execute(d, { uid }, "recordConsent", consentArgs(), t);
    const h = V.pinHash("123456");
    d.merchants["coupon-m"] = {
      pin: "SERVER_VALIDATED",
      pinHash: h.hash,
      pinSalt: h.salt,
    };
    d.coupons.push({
      id: "coupon-race",
      uid,
      merchantId: "coupon-m",
      status: "ISSUED",
      expiresAt: t + 86400000,
      window: null,
      failCount: 0,
    });
    return { ok: true };
  });
  const windows = await Promise.all(
    [1, 2, 3].map(() =>
      Store.transact((d) =>
        execute(
          d,
          { uid },
          "requestCouponUse",
          { clientRequestId: randomUUID(), couponId: "coupon-race" },
          t,
        ),
      ),
    ),
  );
  assert.ok(windows.every((r) => r.useSessionId === windows[0].useSessionId));
  const rs = await Promise.all(
    [1, 2].map(() =>
      Store.transact((d) =>
        execute(
          d,
          { uid },
          "confirmCouponUse",
          {
            clientRequestId: randomUUID(),
            couponId: "coupon-race",
            useSessionId: windows[0].useSessionId,
            pin: "123456",
          },
          t,
        ),
      ),
    ),
  );
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.equal(
    rs.filter((r) => r.errorCode === "COUPON_UNAVAILABLE").length,
    1,
  );
});
test("concurrent photo submissions enforce one remaining daily reward slot", async () => {
  const Store = await server(),
    t = Date.now(),
    uid = "photo-race",
    loc = {
      lat: 37.62,
      lng: 127.05,
      accuracyM: 8,
      precise: true,
      measuredAt: t,
    };
  await Store.transact((d) => {
    execute(d, { uid }, "recordConsent", consentArgs(), t);
    P.budget(d, uid, t).base = 25;
    for (let n = 0; n < 3; n++) {
      const id = "race-issue-" + n,
        ticketId = "race-ticket-" + n;
      d.issues[id] = {
        id,
        creatorUid: "creator",
        categoryCode: "LITTER",
        pathSegmentId: "L",
        corridorSegmentId: "W1",
        anchor: [37.62, 127.05],
        observationAnchors: [[37.62, 127.05]],
        visibility: "PUBLIC",
        lifecycleStatus: "OPEN",
        createdAt: t,
        availablePhotoCount: 1,
        photoObservationCount: 1,
        photoAccounts: ["creator"],
        verificationLevel: "NONE",
        creatorCreditStatus: "INELIGIBLE",
      };
      d.tickets[ticketId] = {
        id: ticketId,
        uid,
        purpose: "RECHECK",
        targetId: id,
        issuedAt: t,
        shutterAt: t,
        shutterLoc: loc,
        expiresAt: t + 900000,
        consumed: false,
      };
      d.photos[ticketId] = {
        id: ticketId,
        uid,
        status: "READY",
        processedPath: "private.jpg",
      };
    }
    return { ok: true };
  });
  const rs = await Promise.all(
    [0, 1, 2].map((n) =>
      Store.transact((d) =>
        execute(
          d,
          { uid },
          "submitPhotoRecheck",
          {
            clientRequestId: randomUUID(),
            issueId: "race-issue-" + n,
            ticketId: "race-ticket-" + n,
          },
          t,
        ),
      ),
    ),
  );
  assert.ok(rs.every((r) => r.ok));
  assert.equal(
    rs.reduce((sum, r) => sum + r.pointsAwarded, 0),
    5,
  );
  assert.equal(rs.filter((r) => r.rewardReason === "DAILY_CAP").length, 2);
  await Store.read((d) => assert.equal(P.budget(d, uid, t).base, 30));
});
test("failing GPS chunk rolls back all samples and its receipt", async () => {
  const Store = await server(),
    t = Date.now(),
    uid = "chunk-rollback",
    loc = {
      lat: 37.62,
      lng: 127.05,
      accuracyM: 8,
      precise: true,
      measuredAt: t,
    };
  const { sessionId } = await Store.transact((d) => {
    execute(d, { uid }, "recordConsent", consentArgs(), t);
    return execute(
      d,
      { uid },
      "startRun",
      { clientRequestId: randomUUID(), mode: "WALK", loc },
      t,
    );
  });
  await assert.rejects(
    Store.transact((d) =>
      execute(
        d,
        { uid },
        "appendTrack",
        {
          clientRequestId: "bad-chunk",
          sessionId,
          points: [
            { ...loc, recordedAt: t + 1 },
            { ...loc, recordedAt: t },
          ],
        },
        t + 10,
      ),
    ),
    /OUT_OF_ORDER/,
  );
  await Store.read((d) => {
    assert.equal(d.sessions[sessionId].track.length, 0);
    assert.equal(
      d.receipts[V.digest([uid, "appendTrack", "bad-chunk"])],
      undefined,
    );
  });
});
test("deletion block revokes existing original reads and new uploads immediately", async () => {
  const s = env.authenticatedContext("blocked-user").storage();
  await env.withSecurityRulesDisabled(async (c) => {
    for (const id of ["blocked-existing", "blocked-new"])
      await setDoc(doc(c.firestore(), "captureGrants/" + id), {
        uid: "blocked-user",
        shutterAt: Date.now(),
        expiresAt: Date.now() + 600000,
        consumed: false,
      });
  });
  await assertSucceeds(
    uploadBytes(
      ref(s, "evidence/blocked-user/blocked-existing/original.jpg"),
      new Uint8Array(5),
      { contentType: "image/jpeg" },
    ),
  );
  await env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), "accountBlocks/blocked-user"), { blocked: true }),
  );
  await assertFails(
    getBytes(ref(s, "evidence/blocked-user/blocked-existing/original.jpg")),
  );
  await assertFails(
    uploadBytes(
      ref(s, "evidence/blocked-user/blocked-new/original.jpg"),
      new Uint8Array(5),
      { contentType: "image/jpeg" },
    ),
  );
});
test("600 personal receipts delete in bounded Firestore transactions", async () => {
  const Store = await server(),
    uid = "bulk-delete",
    t = Date.now();
  await Store.transact((d) =>
    execute(d, { uid }, "recordConsent", consentArgs(), t),
  );
  for (let start = 0; start < 600; start += 150)
    await Store.transact((d) => {
      for (let n = start; n < start + 150; n++)
        d.receipts["bulk-" + n] = {
          id: "bulk-" + n,
          uid,
          createdAt: t,
          result: { ok: true },
        };
      return { ok: true };
    });
  await Store.transact((d) =>
    execute(
      d,
      { uid },
      "deleteMyAccountData",
      { confirm: true, clientRequestId: "delete-bulk" },
      t,
    ),
  );
  const { readModel, cleanupAccountBatch } = require("../src/service");
  await assert.rejects(
    Store.read((d) => readModel(d, { uid }, "getRecords", {}, t)),
    /ACCOUNT_DELETING/,
  );
  let result;
  for (let pass = 0; pass < 15; pass++) {
    result = await Store.transact((d) => cleanupAccountBatch(d, uid));
    if (result.done) break;
  }
  assert.equal(result.done, true);
  await Store.read((d) => {
    assert.equal(
      Object.values(d.receipts).filter((r) => r.uid === uid).length,
      0,
    );
    assert.equal(d.users[uid], undefined);
  });
});

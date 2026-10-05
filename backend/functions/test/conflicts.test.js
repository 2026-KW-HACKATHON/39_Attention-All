const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initialState, execute, readModel } = require("../src/service");
const P = require("../src/policy.cjs");
const V = require("../src/validation");
const t = Date.parse("2026-10-05T03:00:00Z");
const location = (time = t, lng = 127.05) => ({
  lat: 37.62,
  lng,
  accuracyM: 8,
  precise: true,
  measuredAt: time,
});
function db() {
  const d = initialState();
  d.geometry.paths = [
    {
      id: "L",
      corridorId: "W1",
      points: [
        [37.619, 127.05],
        [37.621, 127.05],
      ],
    },
    {
      id: "R",
      corridorId: "W1",
      points: [
        [37.619, 127.0508],
        [37.621, 127.0508],
      ],
    },
  ];
  return d;
}
const call = (d, name, x = {}, uid = "u", time = t, admin = false) =>
  execute(
    d,
    { uid, admin },
    name,
    { clientRequestId: randomUUID(), ...x },
    time,
  );
function consent(d, uid = "u") {
  call(d, "recordConsent", { version: "v2-2026-10", accepted: true }, uid);
}
function photo(d, purpose = "DISCOVERY", targetId = null, uid = "u", time = t) {
  const r = call(
    d,
    "issueCaptureTicket",
    { purpose, targetId, categoryCode: "LITTER", loc: location(time) },
    uid,
    time,
  );
  call(
    d,
    "sealCapture",
    { ticketId: r.ticketId, loc: location(time) },
    uid,
    time,
  );
  d.photos[r.ticketId] = {
    id: r.ticketId,
    uid,
    status: "READY",
    createdAt: time,
    processedPath: "p",
    publicApproved: false,
  };
  return r.ticketId;
}
function newPhotoIssue(d) {
  consent(d);
  const ticketId = photo(d);
  const r = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "PHOTO",
    pin: [37.62, 127.05],
    ticketId,
  });
  return {
    id: r.resultId,
    observationId: d.issues[r.resultId].creatorPhotoObsId,
    ticketId,
  };
}
test("independent record sections accept independent pagination cursors", () => {
  const d = db();
  d.sessions.a = { id: "a", uid: "u", status: "COMPLETED", startedAt: t };
  d.obs.b = { id: "b", uid: "u", observedAt: t };
  d.obs.c = { id: "c", uid: "u", observedAt: t - 1 };
  const r = readModel(
    d,
    { uid: "u" },
    "getRecords",
    { limit: 1, participationsCursor: "b" },
    t,
  );
  assert.equal(r.participations.items[0].id, "c");
  assert.equal(r.runs.items[0].id, "a");
});
test("record reward reflects current ledger after approval", () => {
  const d = db(),
    i = newPhotoIssue(d);
  call(
    d,
    "adminDecision",
    { issueId: i.id, decision: "APPROVE" },
    "admin",
    t,
    true,
  );
  const o = readModel(d, { uid: "u" }, "getRecords", {}, t).participations
    .items[0];
  assert.equal(o.reward.status, "CONFIRMED");
  assert.equal(o.pointsPending, 0);
  assert.equal(o.points, 5);
});
test("withdrawn creator photo cannot later produce verification bonus or welcome credit", () => {
  const d = db(),
    i = newPhotoIssue(d);
  call(d, "withdrawContribution", { observationId: i.observationId });
  assert.throws(
    () =>
      call(
        d,
        "adminDecision",
        { issueId: i.id, decision: "APPROVE" },
        "admin",
        t,
        true,
      ),
    /INVALID_STATE/,
  );
  assert.equal(d.issues[i.id].availablePhotoCount, 0);
  assert.equal(P.balance(d, "u"), 0);
  assert.equal(P.welcomeCount(d, "u"), 0);
});
test("withdrawing peer photo updates issue basis and welcome participation", () => {
  const d = db(),
    i = newPhotoIssue(d);
  consent(d, "peer");
  const ticketId = photo(d, "RECHECK", i.id, "peer", t + 1000);
  const r = call(
    d,
    "submitPhotoRecheck",
    { issueId: i.id, ticketId },
    "peer",
    t + 1000,
  );
  assert.equal(P.welcomeCount(d, "peer"), 1);
  call(
    d,
    "withdrawContribution",
    { observationId: r.resultId },
    "peer",
    t + 2000,
  );
  assert.equal(d.issues[i.id].availablePhotoCount, 1);
  assert.deepEqual(d.issues[i.id].photoAccounts, ["u"]);
  assert.equal(P.welcomeCount(d, "peer"), 0);
});
test("rejection is terminal for reward settlement and frees pending budget once", () => {
  const d = db(),
    i = newPhotoIssue(d);
  call(
    d,
    "adminDecision",
    { issueId: i.id, decision: "REJECT" },
    "admin",
    t,
    true,
  );
  assert.equal(P.budget(d, "u", t).base, 0);
  call(
    d,
    "adminDecision",
    { issueId: i.id, decision: "REJECT" },
    "admin",
    t,
    true,
  );
  assert.equal(P.budget(d, "u", t).base, 0);
  assert.throws(
    () =>
      call(
        d,
        "adminDecision",
        { issueId: i.id, decision: "APPROVE" },
        "admin",
        t,
        true,
      ),
    /INVALID_STATE/,
  );
});
test("run receives pre-pause delayed samples without bridging a pause", () => {
  const d = db();
  consent(d);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: location() });
  call(d, "pauseRun", { sessionId }, "u", t + 10000);
  call(d, "resumeRun", { sessionId }, "u", t + 20000);
  call(
    d,
    "appendTrack",
    {
      sessionId,
      points: [
        { lat: 37.62, lng: 127.05, accuracyM: 8, recordedAt: t + 5000 },
        { lat: 37.6201, lng: 127.05, accuracyM: 8, recordedAt: t + 21000 },
      ],
    },
    "u",
    t + 22000,
  );
  assert.equal(d.sessions[sessionId].distanceM, 0);
  assert.equal(d.sessions[sessionId].track[0].segment, 0);
  assert.equal(d.sessions[sessionId].track[1].segment, 1);
});
test("deleting peer removes identity from issues and routine rounds", () => {
  const d = db(),
    i = newPhotoIssue(d);
  consent(d, "peer");
  const ticketId = photo(d, "RECHECK", i.id, "peer", t + 1000);
  call(d, "submitPhotoRecheck", { issueId: i.id, ticketId }, "peer", t + 1000);
  d.routines.m = { id: "m", rounds: { r: ["peer", "u"] } };
  call(d, "deleteMyAccountData", { confirm: true }, "peer", t + 2000);
  assert.ok(!d.issues[i.id].photoAccounts.includes("peer"));
  assert.deepEqual(d.routines.m.rounds.r, ["u"]);
  assert.equal(d.issues[i.id].availablePhotoCount, 1);
});
test("account deletion blocks replay of old personal receipt", () => {
  const d = db();
  consent(d);
  const x = { clientRequestId: "settings-before-delete", uiMode: "SIMPLE" };
  call(d, "updateSettings", x);
  call(d, "deleteMyAccountData", { confirm: true });
  d.receipts[V.digest(["u", "updateSettings", x.clientRequestId])] = {
    hash: V.digest(x),
    result: { ok: true },
    uid: "u",
  };
  assert.throws(
    () => execute(d, { uid: "u" }, "updateSettings", x, t),
    /ACCOUNT_DELETING/,
  );
});
test("canonical request hash ignores JSON property order", () => {
  const d = db();
  consent(d);
  const x = { clientRequestId: "order-test", mode: "WALK", loc: location() };
  const r = execute(d, { uid: "u" }, "startRun", x, t);
  assert.deepEqual(
    execute(
      d,
      { uid: "u" },
      "startRun",
      { loc: location(), mode: "WALK", clientRequestId: "order-test" },
      t,
    ),
    r,
  );
});
test("a closed use window cannot extend coupon expiration", () => {
  const d = db();
  consent(d);
  const h = V.pinHash("123456");
  d.merchants.m = { pin: "SERVER_VALIDATED", pinHash: h.hash, pinSalt: h.salt };
  d.coupons.push({
    id: "cp",
    uid: "u",
    merchantId: "m",
    status: "ISSUED",
    expiresAt: t + 5000,
    window: null,
  });
  const r = call(d, "requestCouponUse", { couponId: "cp" });
  assert.equal(r.expiresAt, t + 5000);
  const used = call(
    d,
    "confirmCouponUse",
    { couponId: "cp", useSessionId: r.useSessionId, pin: "123456" },
    "u",
    t + 6000,
  );
  assert.equal(used.ok, false);
  assert.equal(d.coupons[0].status, "EXPIRED");
});
test("wrong-bank issue never prevents an eligible nearby exposure", () => {
  const d = db();
  consent(d);
  consent(d, "creator");
  const a = call(
    d,
    "createIssue",
    {
      categoryCode: "LITTER",
      modality: "QUICK",
      pin: [37.62, 127.0508],
      loc: location(t, 127.0508),
    },
    "creator",
  );
  const b = call(
    d,
    "createIssue",
    {
      categoryCode: "LITTER",
      modality: "QUICK",
      pin: [37.62005, 127.05],
      loc: location(),
    },
    "creator",
  );
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: location() });
  const later = t + 60 * 60000;
  const r = call(
    d,
    "recordMissionExposure",
    { sessionId, loc: location(later) },
    "u",
    later,
  );
  assert.equal(r.exposure.targetId, b.resultId);
  assert.notEqual(r.exposure.targetId, a.resultId);
});
test("ineligible high-priority opposite-bank alert is skipped before candidate selection", () => {
  const d = db();
  consent(d);
  consent(d, "creator");
  call(
    d,
    "createIssue",
    {
      categoryCode: "PAVEMENT",
      modality: "QUICK",
      pin: [37.62, 127.0508],
      loc: location(t, 127.0508),
    },
    "creator",
  );
  const b = call(
    d,
    "createIssue",
    {
      categoryCode: "LITTER",
      modality: "QUICK",
      pin: [37.62005, 127.05],
      loc: location(),
    },
    "creator",
  );
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: location() });
  const later = t + 60 * 60000;
  assert.equal(
    call(
      d,
      "recordMissionExposure",
      { sessionId, loc: location(later) },
      "u",
      later,
    ).exposure.targetId,
    b.resultId,
  );
});
test("configuration update preserves routine rounds and rejects duplicate path IDs", () => {
  const d = db();
  d.routines.m = {
    id: "m",
    enabled: true,
    roundHours: 6,
    anchors: [[37.62, 127.05]],
    rounds: { r: ["u"] },
  };
  call(
    d,
    "configurePilot",
    {
      paths: d.geometry.paths,
      routines: [
        {
          id: "m",
          name: "updated",
          enabled: true,
          roundHours: 6,
          anchors: [[37.62, 127.05]],
        },
      ],
    },
    "admin",
    t,
    true,
  );
  assert.deepEqual(d.routines.m.rounds, { r: ["u"] });
  assert.throws(
    () =>
      call(
        d,
        "configurePilot",
        { paths: [d.geometry.paths[0], d.geometry.paths[0]] },
        "admin",
        t,
        true,
      ),
    /INVALID_ARGUMENT/,
  );
});
test("prototype names cannot be used as category codes", () => {
  const d = db();
  consent(d);
  assert.throws(
    () =>
      call(d, "createIssue", {
        categoryCode: "constructor",
        modality: "QUICK",
        pin: [37.62, 127.05],
        loc: location(),
      }),
    /INVALID_ARGUMENT/,
  );
});
test("paused run can receive buffered pre-pause GPS samples", () => {
  const d = db();
  consent(d);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: location() });
  call(d, "pauseRun", { sessionId }, "u", t + 10000);
  assert.equal(
    call(
      d,
      "appendTrack",
      {
        sessionId,
        points: [
          { lat: 37.62, lng: 127.05, accuracyM: 8, recordedAt: t + 5000 },
        ],
      },
      "u",
      t + 15000,
    ).count,
    1,
  );
});
test("large account deletion queues cleanup instead of exceeding transaction write limit", () => {
  const d = db();
  consent(d);
  for (let n = 0; n < 600; n++)
    d.receipts["old-" + n] = {
      id: "old-" + n,
      uid: "u",
      createdAt: t,
      result: { ok: true },
    };
  call(d, "deleteMyAccountData", { confirm: true });
  assert.equal(d.deletionJobs.u.status, "PENDING");
  assert.ok(Object.keys(d.receipts).length > 500);
  assert.throws(
    () => readModel(d, { uid: "u" }, "getRecords", {}, t),
    /ACCOUNT_DELETING/,
  );
});
test("photo commit does not resurrect a file after withdrawal or account deletion", () => {
  const d = db();
  consent(d);
  const ticketId = photo(d);
  d.photos[ticketId].status = "DELETE_PENDING";
  const life = require("../src/lifecycle");
  assert.equal(
    life.commitPhoto(d, {
      id: ticketId,
      uid: "u",
      status: "READY",
      createdAt: t,
    }),
    false,
  );
  assert.equal(d.photos[ticketId].status, "DELETE_PENDING");
});
test("failed image retry cannot overwrite an already ready manifest", () => {
  const d = db();
  consent(d);
  const ticketId = photo(d);
  const life = require("../src/lifecycle");
  life.failPhoto(d, { id: ticketId, uid: "u", createdAt: t });
  assert.equal(d.photos[ticketId].status, "READY");
});
test("bounded account cleanup drains many receipts and leaves other users intact", () => {
  const d = db();
  consent(d);
  consent(d, "other");
  for (let n = 0; n < 600; n++)
    d.receipts["old-" + n] = {
      id: "old-" + n,
      uid: "u",
      createdAt: t,
      result: { ok: true },
    };
  call(d, "deleteMyAccountData", { confirm: true });
  const { cleanupAccountBatch } = require("../src/service");
  let result;
  for (let n = 0; n < 20; n++) {
    result = cleanupAccountBatch(d, "u");
    assert.ok(result.changed <= 80);
    if (result.done) break;
  }
  assert.equal(result.done, true);
  assert.equal(
    Object.values(d.receipts).filter((r) => r.uid === "u").length,
    0,
  );
  assert.equal(d.users.u, undefined);
  assert.ok(d.users.other);
  assert.ok(d.consents.other);
});
test("retention cleanup drains more than one transaction of expired records", () => {
  const d = db();
  for (let n = 0; n < 600; n++)
    d.receipts["old-" + n] = { createdAt: t - 31 * P.DAY };
  const life = require("../src/lifecycle");
  let result;
  for (let n = 0; n < 20; n++) {
    result = life.retentionBatch(d, t);
    assert.ok(result.changed <= 80);
    if (result.done) break;
  }
  assert.equal(result.done, true);
  assert.equal(Object.keys(d.receipts).length, 0);
});
test("photo commit is blocked while an account waits for data cleanup", () => {
  const d = db();
  consent(d);
  const id = photo(d);
  d.deletionJobs.u = { uid: "u", status: "PENDING" };
  const life = require("../src/lifecycle");
  assert.equal(life.commitPhoto(d, { id, uid: "u", status: "READY" }), false);
});
test("withdrawing a quick recheck removes its public signal without counting discovery", () => {
  const d = db();
  consent(d);
  consent(d, "peer");
  const i = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc: location(),
  });
  const r = call(
    d,
    "submitQuick",
    { issueId: i.resultId, loc: location() },
    "peer",
  );
  assert.equal(d.issues[i.resultId].signalCount, 1);
  call(d, "withdrawContribution", { observationId: r.resultId }, "peer");
  assert.equal(d.issues[i.resultId].signalCount, 0);
  assert.equal(d.issues[i.resultId].todaySignalAccountCount, 0);
});
test("finishing waits for the client expected GPS count", () => {
  const d = db();
  consent(d);
  const { sessionId } = call(d, "startRun", { mode: "WALK", loc: location() });
  assert.throws(
    () => call(d, "finishRun", { sessionId, expectedTrackCount: 1 }),
    /TRACK_NOT_SYNCED/,
  );
  call(d, "appendTrack", {
    sessionId,
    points: [{ lat: 37.62, lng: 127.05, accuracyM: 8, recordedAt: t }],
  });
  assert.equal(
    call(d, "finishRun", { sessionId, expectedTrackCount: 1 }).status,
    "COMPLETED",
  );
});
test("merchant configuration retry cannot replenish coupon stock", () => {
  const d = db();
  const x = {
    clientRequestId: "merchant-config",
    id: "m",
    name: "test",
    pin: "123456",
    catalog: { stock: 1, title: "coupon", condition: "test", validDays: 30 },
  };
  call(d, "configureMerchant", x, "admin", t, true);
  d.catalog.WELCOME_500.stock = 0;
  call(d, "configureMerchant", x, "admin", t, true);
  assert.equal(d.catalog.WELCOME_500.stock, 0);
  assert.throws(
    () =>
      call(
        d,
        "configureMerchant",
        { ...x, catalog: { ...x.catalog, stock: 2 } },
        "admin",
        t,
        true,
      ),
    /REQUEST_CONFLICT/,
  );
});

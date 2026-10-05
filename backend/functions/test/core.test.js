const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execute, initialState, readModel } = require("../src/service");
const now = Date.parse("2026-10-04T03:00:00Z");
const loc = {
  lat: 37.62,
  lng: 127.05,
  accuracyM: 8,
  measuredAt: now,
  precise: true,
  mock: false,
};
function state() {
  const db = initialState();
  db.geometry.paths = [
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
  return db;
}
const call = (db, name, data = {}, uid = "u", admin = false) =>
  execute(
    db,
    { uid, admin },
    name,
    { clientRequestId: crypto.randomUUID(), ...data },
    now,
  );
function consent(db, uid = "u") {
  call(db, "recordConsent", { version: "v2-2026-10", accepted: true }, uid);
}
test("auth required for mutation", () =>
  assert.throws(
    () => execute(state(), {}, "startRun", { mode: "WALK" }, now),
    /UNAUTHENTICATED/,
  ));
test("consent required, server strips owner spoofing", () => {
  const d = state();
  assert.throws(
    () => call(d, "startRun", { mode: "WALK", loc }),
    /CONSENT_REQUIRED/,
  );
  consent(d);
  const r = call(d, "startRun", { mode: "WALK", loc, uid: "victim" });
  assert.equal(d.sessions[r.sessionId].uid, "u");
});
test("request retry same result and payload conflict denied", () => {
  const d = state();
  consent(d);
  const data = { clientRequestId: "same-request-id", mode: "WALK", loc };
  const a = call(d, "startRun", data),
    b = call(d, "startRun", data);
  assert.deepEqual(a, b);
  assert.equal(Object.keys(d.sessions).length, 1);
  assert.throws(
    () => call(d, "startRun", { ...data, mode: "RUN" }),
    /REQUEST_CONFLICT/,
  );
});
test("invalid and mock and outside GPS rejected", () => {
  const d = state();
  consent(d);
  for (const l of [
    { ...loc, lat: NaN },
    { ...loc, mock: true },
    { ...loc, accuracyM: 45 },
    { ...loc, lat: 38 },
  ])
    assert.throws(() => call(d, "startRun", { mode: "WALK", loc: l }));
});
test("run state transitions, ownership, append retry", () => {
  const d = state();
  consent(d);
  consent(d, "other");
  const { sessionId } = call(d, "startRun", { mode: "RUN", loc });
  assert.throws(() => call(d, "pauseRun", { sessionId }, "other"), /NOT_FOUND/);
  call(d, "pauseRun", { sessionId });
  assert.throws(() => call(d, "pauseRun", { sessionId }), /INVALID_STATE/);
  call(d, "resumeRun", { sessionId });
  const data = {
    sessionId,
    clientRequestId: "chunk-id-0001",
    points: [{ ...loc, altitudeM: 23, recordedAt: now }],
  };
  call(d, "appendTrack", data);
  call(d, "appendTrack", data);
  assert.equal(d.sessions[sessionId].track.length, 1);
  call(d, "finishRun", { sessionId });
  assert.equal(d.sessions[sessionId].status, "COMPLETED");
});
test("photo ticket cannot be forged or consumed by other user", () => {
  const d = state();
  consent(d);
  consent(d, "other");
  const { ticketId } = call(d, "issueCaptureTicket", {
    purpose: "DISCOVERY",
    categoryCode: "LITTER",
    loc,
  });
  assert.throws(
    () => call(d, "sealCapture", { ticketId, loc }, "other"),
    /NOT_FOUND/,
  );
  assert.throws(
    () =>
      call(d, "createIssue", {
        categoryCode: "LITTER",
        pin: [37.62, 127.05],
        modality: "PHOTO",
        ticketId: "fake",
        loc,
      }),
    /PHOTO_REQUIRED/,
  );
});
test("public DTO does not expose identity GPS or photo originals", () => {
  const d = state();
  d.issues.x = {
    id: "x",
    creatorUid: "secret",
    categoryCode: "LITTER",
    anchor: [37.62, 127.05],
    visibility: "PUBLIC",
    observationAnchors: [[37.62, 127.05]],
    photoAccounts: ["secret"],
    rawGps: loc,
  };
  const s = JSON.stringify(readModel(d, {}, "getMapData", {}, now));
  assert.ok(!s.includes("secret"));
  assert.ok(!s.includes("rawGps"));
});
test("only admin can approve and configure", () => {
  assert.throws(
    () => call(state(), "adminDecision", { decision: "APPROVE", issueId: "x" }),
    /PERMISSION_DENIED/,
  );
  assert.throws(
    () => call(state(), "configurePilot", { paths: [] }),
    /PERMISSION_DENIED/,
  );
});
test("existing HTML quick reward once per issue and photo reward cap", () => {
  const P = require("../src/policy.cjs");
  const d = P.emptyDb();
  P.ensureUser(d, "u");
  P.ensureUser(d, "creator");
  d.issues.x = {
    id: "x",
    creatorUid: "creator",
    categoryCode: "LITTER",
    anchor: [loc.lat, loc.lng],
    observationAnchors: [[loc.lat, loc.lng]],
    lifecycleStatus: "OPEN",
    visibility: "PUBLIC",
    eventEndsAt: null,
    availablePhotoCount: 1,
    signalCount: 0,
    photoObservationCount: 1,
    photoAccounts: [],
    verificationLevel: "NONE",
  };
  const a = P.submitQuick(d, { uid: "u", issueId: "x", loc }, now);
  assert.equal(a.pointsAwarded, 1);
  assert.equal(
    P.submitQuick(d, { uid: "u", issueId: "x", loc }, now).pointsAwarded,
    0,
  );
  assert.equal(P.balance(d, "u"), 1);
});
function captured(
  d,
  purpose = "DISCOVERY",
  targetId = null,
  uid = "u",
  time = now,
) {
  const r = execute(
    d,
    { uid },
    "issueCaptureTicket",
    {
      clientRequestId: crypto.randomUUID(),
      purpose,
      targetId,
      categoryCode: "LITTER",
      loc: { ...loc, measuredAt: time },
    },
    time,
  );
  execute(
    d,
    { uid },
    "sealCapture",
    {
      clientRequestId: crypto.randomUUID(),
      ticketId: r.ticketId,
      loc: { ...loc, measuredAt: time },
    },
    time,
  );
  d.photos[r.ticketId] = {
    id: r.ticketId,
    uid,
    status: "READY",
    processedPath: "private.jpg",
    thumbnailPath: "thumb.jpg",
    publicApproved: false,
  };
  return r.ticketId;
}
test("new photo issue pending, retry, admin approval and rejection", () => {
  const d = state();
  consent(d);
  const ticketId = captured(d);
  const payload = {
    clientRequestId: "photo-submit-1",
    categoryCode: "LITTER",
    modality: "PHOTO",
    pin: [37.62, 127.05],
    ticketId,
  };
  const r = call(d, "createIssue", payload);
  assert.equal(r.pointsPending, 5);
  assert.equal(d.tickets[ticketId].consumed, true);
  assert.equal(d.issues[r.resultId].pathSegmentId, "L");
  assert.deepEqual(call(d, "createIssue", payload), r);
  assert.equal(Object.keys(d.issues).length, 1);
  call(
    d,
    "adminDecision",
    { issueId: r.resultId, decision: "APPROVE" },
    "admin",
    true,
  );
  const P = require("../src/policy.cjs");
  assert.ok(P.balance(d, "u") >= 5);
  const balance = P.balance(d, "u");
  call(
    d,
    "adminDecision",
    { issueId: r.resultId, decision: "APPROVE" },
    "admin",
    true,
  );
  assert.equal(P.balance(d, "u"), balance);
});
test("duplicate candidate makes no issue; wrong bank and own recheck denied", () => {
  const d = state();
  consent(d);
  const r = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc,
  });
  const b = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc,
  });
  assert.equal(b.errorCode, "DUPLICATE_CANDIDATES");
  assert.equal(Object.keys(d.issues).length, 1);
  consent(d, "other");
  assert.throws(
    () =>
      call(
        d,
        "submitQuick",
        { issueId: r.resultId, loc: { ...loc, lng: 127.0508 } },
        "other",
      ),
    /WRONG_SCOPE/,
  );
  assert.equal(
    call(d, "submitQuick", { issueId: r.resultId, loc }).errorCode,
    "OWN_ISSUE_RECHECK",
  );
});
test("daily cap photo accepted but points zero", () => {
  const d = state();
  consent(d);
  const r = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc,
  });
  consent(d, "other");
  const ticketId = captured(d, "RECHECK", r.resultId, "other");
  const P = require("../src/policy.cjs");
  P.budget(d, "other", now).base = 30;
  const x = call(
    d,
    "submitPhotoRecheck",
    { issueId: r.resultId, ticketId },
    "other",
  );
  assert.equal(x.ok, true);
  assert.equal(x.pointsAwarded, 0);
  assert.equal(x.rewardReason, "DAILY_CAP");
});
test("forged ticket target and unrelated exposure blocked", () => {
  const d = state();
  consent(d);
  const r = call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc,
  });
  consent(d, "other");
  const ticketId = captured(d, "DISCOVERY", null, "other");
  assert.throws(
    () =>
      call(d, "submitPhotoRecheck", { issueId: r.resultId, ticketId }, "other"),
    /INVALID_TICKET/,
  );
  d.exposures.bad = { id: "bad", uid: "other", targetId: "different" };
  assert.throws(
    () =>
      call(
        d,
        "submitQuick",
        { issueId: r.resultId, loc, exposureId: "bad" },
        "other",
      ),
    /INVALID_ARGUMENT/,
  );
});
test("run gaps and inaccurate GPS excluded from distance", () => {
  const { trackDistance } = require("../src/service");
  const p = (lat, t, acc = 8, segment = 0) => ({
    lat,
    lng: 127.05,
    t,
    acc,
    segment,
  });
  assert.ok(trackDistance([p(37.62, 0), p(37.6201, 10000)]) > 10);
  assert.equal(trackDistance([p(37.62, 0), p(37.6201, 10000, 8, 1)]), 0);
  assert.equal(trackDistance([p(37.62, 0), p(37.6201, 10000, 45)]), 0);
  assert.equal(trackDistance([p(37.62, 0), p(37.6201, 70000)]), 0);
});
test("account deletion hides data, removes owner records and schedules photos", () => {
  const d = state();
  consent(d);
  const ticketId = captured(d);
  call(d, "createIssue", {
    categoryCode: "LITTER",
    modality: "PHOTO",
    pin: [37.62, 127.05],
    ticketId,
  });
  call(d, "deleteMyAccountData", { confirm: true });
  assert.equal(d.users.u, undefined);
  assert.equal(d.photos[ticketId].status, "DELETE_PENDING");
  assert.equal(readModel(d, {}, "getMapData", {}, now).issues.items.length, 0);
  assert.throws(
    () => call(d, "recordConsent", { version: "v2-2026-10", accepted: true }),
    /ACCOUNT_DELETING/,
  );
});
test("CORRIDOR issue supports opposite bank safe anchor", () => {
  const d = state();
  consent(d);
  const r = call(d, "createIssue", {
    categoryCode: "FOAM",
    modality: "QUICK",
    pin: [37.62, 127.05],
    loc,
  });
  assert.equal(d.issues[r.resultId].observationAnchors.length, 2);
  consent(d, "other");
  const x = call(
    d,
    "submitQuick",
    { issueId: r.resultId, loc: { ...loc, lng: 127.0508 } },
    "other",
  );
  assert.equal(x.ok, true);
});

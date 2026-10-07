// Requires an explicitly confirmed isolated demo Emulator; never uses production credentials.
const { localConfig, summary, retryCall } = require("./load-core.cjs");
const cfg = localConfig(process.env); // Must happen before importing Admin SDK or initializing clients.
const { createRequire } = require("node:module"),
  path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto"),
  assert = require("node:assert/strict");
const r = createRequire(path.resolve(__dirname, "../functions/package.json"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const { initializeApp: adminInit } = r("firebase-admin/app");
  const admin = adminInit({ projectId: cfg.projectId });
  const auth = r("firebase-admin/auth").getAuth(admin);
  const { initializeApp, deleteApp } = r("firebase/app"),
    { getAuth, connectAuthEmulator, signInWithEmailAndPassword } =
      r("firebase/auth"),
    { getFunctions, connectFunctionsEmulator, httpsCallable } =
      r("firebase/functions");
  const runId = randomUUID().slice(0, 8),
    apps = [],
    created = [];
  const report = {
    projectId: cfg.projectId,
    at: new Date().toISOString(),
    groups: [],
    notes: [
      "Client retries counted; internal Firestore transaction retries are not exposed.",
      "Emulator timing is not a production capacity guarantee.",
    ],
  };
  async function client(name, operator = false) {
    const uid = `load-${runId}-${name}`,
      email = `${uid}@load.test`,
      password = "Local-load-12345";
    await auth.createUser({ uid, email, password });
    created.push(uid);
    if (operator) await auth.setCustomUserClaims(uid, { admin: true });
    const app = initializeApp(
      { projectId: cfg.projectId, apiKey: "demo-key" },
      uid,
    );
    apps.push(app);
    const a = getAuth(app);
    connectAuthEmulator(a, "http://" + cfg.auth, { disableWarnings: true });
    await signInWithEmailAndPassword(a, email, password);
    const f = getFunctions(app, "asia-northeast3");
    const [host, port] = cfg.functions.split(":");
    connectFunctionsEmulator(f, host, Number(port));
    return {
      uid,
      call: async (name, data) => (await httpsCallable(f, name)(data)).data,
    };
  }
  try {
    const operator = await client("admin", true);
    const invoke = async (c, name, data = {}) => {
      const value = await c.call(name, data);
      if (value?.ok === false) throw Error(value.errorCode);
      return value;
    };
    await invoke(operator, "configurePilot", {
      clientRequestId: randomUUID(),
      paths: [
        {
          id: "L",
          corridorId: "W",
          points: [
            [37.619, 127.05],
            [37.623, 127.05],
          ],
        },
      ],
      courses: [
        {
          id: "C",
          name: "부하 검증 코스",
          modes: ["RUN", "WALK"],
          out: [
            [37.619, 127.05],
            [37.623, 127.05],
          ],
        },
      ],
      routines: [],
      facilities: [],
    });
    for (const accounts of [1, 5, 10]) {
      const clients = await Promise.all(
          Array.from({ length: accounts }, (_, i) =>
            client(`${accounts}-${i}`),
          ),
        ),
        samples = [],
        sessions = [];
      async function measured(c, name, data = {}) {
        const t = performance.now();
        try {
          const result = await retryCall((p) => invoke(c, name, p), data);
          samples.push({
            name,
            ms: performance.now() - t,
            ok: true,
            retries: result.retries,
          });
          return result.value;
        } catch (e) {
          samples.push({
            name,
            ms: performance.now() - t,
            ok: false,
            retries: e.clientRetries || 0,
            error: e.message,
          });
          throw e;
        }
      }
      const results = await Promise.allSettled(
        clients.map(async (c) => {
          await measured(c, "recordConsent", {
            clientRequestId: randomUUID(),
            version: "v2-2026-10",
            accepted: true,
          });
          const loc = () => ({
            lat: 37.62,
            lng: 127.05,
            accuracyM: 8,
            measuredAt: Date.now(),
            precise: true,
          });
          const start = await measured(c, "startRun", {
            clientRequestId: randomUUID(),
            mode: "WALK",
            loc: loc(),
          });
          sessions.push(start.sessionId);
          for (let i = 0; i < 3; i++) {
            await measured(c, "getHome");
            await sleep(1100);
            await measured(c, "appendTrack", {
              clientRequestId: randomUUID(),
              sessionId: start.sessionId,
              points: [
                {
                  lat: 37.62 + (i + 1) * 0.00005,
                  lng: 127.05,
                  accuracyM: 8,
                  recordedAt: Date.now(),
                },
              ],
            });
          }
          const end = {
            clientRequestId: randomUUID(),
            sessionId: start.sessionId,
            expectedTrackCount: 3,
          };
          await measured(c, "finishRun", end);
          await measured(c, "finishRun", end);
          const detail = await measured(c, "getRunDetail", {
            sessionId: start.sessionId,
          });
          assert.equal(detail.track.length, 3);
          assert.equal(detail.status, "COMPLETED");
          const records = await measured(c, "getRecords");
          assert.equal(
            records.runs.items.filter((s) => s.id === start.sessionId).length,
            1,
          );
        }),
      );
      const row = {
        accounts,
        ...summary(samples),
        completed: results.filter((r) => r.status === "fulfilled").length,
        sessionIds: sessions,
        byApi: Object.fromEntries(
          [...new Set(samples.map((s) => s.name))].map((name) => [
            name,
            summary(samples.filter((s) => s.name === name)),
          ]),
        ),
        errors: results
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason.message),
      };
      report.groups.push(row);
      console.log(
        JSON.stringify({ ...row, sessionIds: undefined, byApi: undefined }),
      );
    }
  } finally {
    for (const app of apps) await deleteApp(app);
    for (const uid of created) await auth.deleteUser(uid);
    await r("firebase-admin/firestore").getFirestore(admin).terminate();
    fs.mkdirSync(path.resolve(__dirname, "../../output"), { recursive: true });
    fs.writeFileSync(
      path.resolve(__dirname, "../../output/uirun-load-verification.json"),
      JSON.stringify(report, null, 2),
    );
  }
  if (
    report.groups.length !== 3 ||
    report.groups.some((g) => g.completed !== g.accounts || g.failures)
  )
    process.exitCode = 1;
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

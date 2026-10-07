const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { localConfig, summary, retryCall } = require("./load-core.cjs");
const env = {
  GCLOUD_PROJECT: "demo-uirun",
  UIRUN_LOAD_CONFIRM: "isolated-demo",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:18080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:19099",
  UIRUN_FUNCTIONS_EMULATOR_HOST: "127.0.0.1:15001",
};
test("load runner refuses production, remote host and unconfirmed fixtures", () => {
  assert.equal(localConfig(env).projectId, "demo-uirun");
  for (const e of [
    { ...env, GCLOUD_PROJECT: "uirun-92539" },
    { ...env, FIRESTORE_EMULATOR_HOST: "remote:8080" },
    { ...env, UIRUN_LOAD_CONFIRM: "" },
  ])
    assert.throws(() => localConfig(e));
});
test("summary keeps failed requests and separates retry count", () => {
  const s = summary([
    { ms: 1, ok: true, retries: 0 },
    { ms: 10, ok: false, retries: 2 },
    { ms: 5, ok: true, retries: 1 },
  ]);
  assert.deepEqual(s, {
    requests: 3,
    failures: 1,
    clientRetries: 3,
    p50Ms: 5,
    p95Ms: 10,
  });
});
test("ambiguous retries preserve payload and request identity; validation errors are not retried", async () => {
  let calls = 0;
  const seen = [];
  const data = { clientRequestId: "same" };
  const r = await retryCall(
    async (p) => {
      seen.push(p);
      if (calls++ === 0)
        throw Object.assign(Error("aborted"), { code: "functions/aborted" });
      return 1;
    },
    data,
    async () => {},
  );
  assert.equal(r.retries, 1);
  assert.ok(seen.every((p) => p === data));
  await assert.rejects(() =>
    retryCall(
      async () => {
        throw Object.assign(Error("invalid"), {
          code: "functions/invalid-argument",
        });
      },
      data,
      async () => {},
    ),
  );
});

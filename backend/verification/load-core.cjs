function localConfig(env) {
  if (
    env.GCLOUD_PROJECT !== "demo-uirun" ||
    env.UIRUN_LOAD_CONFIRM !== "isolated-demo"
  )
    throw Error("ISOLATED_DEMO_REQUIRED");
  const host = (k) => {
    const v = env[k] || "";
    if (!/^127\.0\.0\.1:\d+$/.test(v))
      throw Error("LOCAL_EMULATORS_REQUIRED: " + k);
    const port = Number(v.split(":")[1]);
    if (port < 1 || port > 65535) throw Error("INVALID_PORT");
    return v;
  };
  return {
    projectId: "demo-uirun",
    firestore: host("FIRESTORE_EMULATOR_HOST"),
    auth: host("FIREBASE_AUTH_EMULATOR_HOST"),
    functions: host("UIRUN_FUNCTIONS_EMULATOR_HOST"),
  };
}
function summary(rows) {
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) =>
    ms.length
      ? Math.round(ms[Math.max(0, Math.ceil(ms.length * p) - 1)])
      : null;
  return {
    requests: rows.length,
    failures: rows.filter((r) => !r.ok).length,
    clientRetries: rows.reduce((n, r) => n + r.retries, 0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}
async function retryCall(
  call,
  data,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  let retries = 0;
  for (;;) {
    try {
      return { value: await call(data), retries };
    } catch (e) {
      if (
        ![
          "functions/aborted",
          "functions/unavailable",
          "functions/internal",
          "functions/deadline-exceeded",
        ].includes(e.code) ||
        retries >= 3
      ) {
        e.clientRetries = retries;
        throw e;
      }
      retries++;
      await sleep(100 * 2 ** retries);
    }
  }
}
module.exports = { localConfig, summary, retryCall };

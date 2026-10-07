import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreparation } from "./run-ready.ts";
const loc = (t = 1000) => ({
  lat: 37.62,
  lng: 127.05,
  accuracyM: 8,
  measuredAt: t,
  precise: true as const,
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function setup() {
  let time = 1000,
    uid: string | null = "a",
    starts = 0;
  const states: string[] = [];
  const waits: ReturnType<typeof deferred<void>>[] = [];
  const p = createPreparation({
    uid: () => uid,
    now: () => time,
    locate: async () => loc(time),
    start: async () => {
      starts++;
      return { ok: true as const, value: "session" };
    },
    delay: () => {
      const d = deferred<void>();
      waits.push(d);
      return d.promise;
    },
    changed: (s) => states.push(s.phase),
    timeoutMs: 100,
  });
  return {
    p,
    states,
    waits,
    setTime: (v: number) => (time = v),
    setUid: (v: string | null) => (uid = v),
    starts: () => starts,
  };
}
test("preparation does not create a session until countdown completes; repeated start is ignored", async () => {
  const s = setup();
  await s.p.prepare();
  assert.equal(s.starts(), 0);
  assert.equal(s.p.state.phase, "ready");
  const done = s.p.begin();
  void s.p.begin();
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    s.waits[i].resolve();
    await Promise.resolve();
  }
  await done;
  assert.equal(s.starts(), 1);
  assert.equal(s.p.state.phase, "done");
});
test("cancelled location completion and countdown cannot start session", async () => {
  const d = deferred<ReturnType<typeof loc>>();
  let starts = 0;
  const p = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: () => d.promise,
    start: async () => {
      starts++;
      return { ok: true as const, value: 1 };
    },
    delay: async () => {},
    changed: () => {},
  });
  const work = p.prepare();
  p.cancel();
  d.resolve(loc());
  await work;
  assert.equal(p.state.phase, "cancelled");
  assert.equal(starts, 0);
  const s = setup();
  await s.p.prepare();
  const done = s.p.begin();
  s.p.cancel();
  s.waits[0].resolve();
  await done;
  assert.equal(s.starts(), 0);
});
test("stale position and account change at countdown end return error without creating session", async () => {
  for (const account of [false, true]) {
    const s = setup();
    await s.p.prepare();
    const done = s.p.begin();
    if (account) s.setUid("b");
    else s.setTime(12001);
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      s.waits[i].resolve();
      await Promise.resolve();
    }
    await done;
    assert.equal(s.starts(), 0);
    assert.equal(s.p.state.phase, "error");
  }
});
test("permission failure and GPS timeout are retryable through prepare, late response ignored", async () => {
  const d = deferred<ReturnType<typeof loc>>();
  const p = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: () => d.promise,
    start: async () => ({ ok: true as const, value: 1 }),
    delay: async () => {},
    changed: () => {},
    timeoutMs: 5,
  });
  await p.prepare();
  assert.equal(p.state.error, "LOCATION_TIMEOUT");
  d.resolve(loc());
  await Promise.resolve();
  assert.equal(p.state.phase, "error");
  const q = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: async () => ({
      ok: false as const,
      errorCode: "LOCATION_PERMISSION_DENIED",
      details: {},
      retryable: false,
    }),
    start: async () => ({ ok: true as const, value: 1 }),
    delay: async () => {},
    changed: () => {},
  });
  await q.prepare();
  assert.equal(q.state.error, "LOCATION_PERMISSION_DENIED");
});
test("start failure releases countdown and allows retry; cancellation is locked during server submission", async () => {
  const d = deferred<{ ok: false; errorCode: string }>();
  const p = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: async () => loc(),
    start: () => d.promise,
    delay: async () => {},
    changed: () => {},
  });
  await p.prepare();
  const done = p.begin();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(p.state.phase, "starting");
  assert.equal(p.cancel(), false);
  d.resolve({ ok: false, errorCode: "OUTSIDE_PILOT" });
  await done;
  assert.equal(p.state.error, "OUTSIDE_PILOT");
  await p.prepare();
  assert.equal(p.state.phase, "ready");
});

test("screen blur cancels pending countdown but preserves an already submitted session", async () => {
  const s = setup();
  await s.p.prepare();
  const done = s.p.begin();
  s.p.blur();
  s.waits[0].resolve();
  await done;
  assert.equal(s.starts(), 0);
  assert.equal(s.p.state.phase, "cancelled");
  const pending = deferred<{ ok: true; value: number }>();
  const p = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: async () => loc(),
    start: () => pending.promise,
    delay: async () => {},
    changed: () => {},
  });
  await p.prepare();
  const submitted = p.begin();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  p.blur();
  assert.equal(p.state.phase, "starting");
  pending.resolve({ ok: true, value: 1 });
  await submitted;
  assert.equal(p.state.phase, "done");
});

test("ambiguous server start failure is not presented as a confirmed failure", async () => {
  const p = createPreparation({
    uid: () => "a",
    now: () => 1000,
    locate: async () => loc(),
    start: async () => ({
      ok: false as const,
      errorCode: "NETWORK",
      retryable: true,
    }),
    delay: async () => {},
    changed: () => {},
  });
  await p.prepare();
  await p.begin();
  assert.equal(p.state.uncertain, true);
  assert.equal(p.state.phase, "error");
  await p.prepare();
  assert.equal(p.state.uncertain, false);
});

test("permission prompt app-state transition preserves GPS preparation and resume permits start", async () => {
  const d = deferred<ReturnType<typeof loc>>();
  let permission!: (pending: boolean) => void;
  const p = createPreparation({
    uid: () => 'a', now: () => 1000,
    locate: (pending) => { permission = pending; pending(true); return d.promise; },
    start: async () => ({ ok: true as const, value: 1 }), delay: async () => {}, changed: () => {},
  });
  const work = p.prepare();
  p.appStateChanged('background');
  assert.equal(p.state.phase, 'locating');
  permission(false);
  d.resolve(loc());
  await work;
  await p.begin();
  assert.equal(p.state.phase, 'ready', 'background cannot create workout');
  p.appStateChanged('active');
  await p.begin();
  assert.equal(p.state.phase, 'done');
});

test("actual background while locating or counting down still cancels preparation", async () => {
  const d = deferred<ReturnType<typeof loc>>();
  const p = createPreparation({ uid: () => 'a', now: () => 1000, locate: () => d.promise,
    start: async () => ({ ok: true as const, value: 1 }), delay: async () => {}, changed: () => {} });
  const work = p.prepare();
  p.appStateChanged('background');
  d.resolve(loc());
  await work;
  assert.equal(p.state.phase, 'cancelled');
  const s = setup(); await s.p.prepare(); const start = s.p.begin();
  s.p.appStateChanged('background'); s.waits[0].resolve(); await start;
  assert.equal(s.starts(), 0);
});

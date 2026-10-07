import type { Loc } from "./location";
export type PreparationState = {
  phase:
    | "idle"
    | "locating"
    | "ready"
    | "countdown"
    | "starting"
    | "done"
    | "error"
    | "cancelled";
  count: number;
  loc: Loc | null;
  error: string | null;
};
type Outcome<T> = { ok: true; value: T } | { ok: false; errorCode: string };
type Dependencies<T> = {
  uid: () => string | null;
  now: () => number;
  locate: () => Promise<Loc | { ok: false; errorCode: string }>;
  start: (loc: Loc, uid: string) => Promise<Outcome<T>>;
  delay: () => Promise<void>;
  changed: (s: PreparationState) => void;
  timeoutMs?: number;
};
export const usablePosition = (loc: Loc, now: number) =>
  Number.isFinite(loc.accuracyM) &&
  loc.accuracyM >= 0 &&
  loc.accuracyM <= 30 &&
  now - loc.measuredAt <= 10000 &&
  loc.measuredAt - now <= 2000;
export function createPreparation<T>(deps: Dependencies<T>) {
  let state: PreparationState = {
      phase: "idle",
      count: 0,
      loc: null,
      error: null,
    },
    generation = 0,
    owner: string | null = null;
  const publish = (patch: Partial<PreparationState>) => {
    state = { ...state, ...patch };
    deps.changed(state);
  };
  const error = (code: string) =>
    publish({ phase: "error", error: code, count: 0 });
  return {
    get state() {
      return state;
    },
    cancel() {
      if (state.phase === "starting") return false;
      generation++;
      publish({ phase: "cancelled", count: 0 });
      return true;
    },
    blur() {
      if (state.phase === "starting" || state.phase === "done") return;
      generation++;
      publish({ phase: "cancelled", count: 0 });
    },
    async prepare() {
      if (["locating", "countdown", "starting", "done"].includes(state.phase))
        return;
      const g = ++generation;
      owner = deps.uid();
      if (!owner) return error("UNAUTHENTICATED");
      publish({ phase: "locating", error: null, loc: null, count: 0 });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          deps.locate(),
          new Promise<{ ok: false; errorCode: string }>((r) => {
            timer = setTimeout(
              () => r({ ok: false, errorCode: "LOCATION_TIMEOUT" }),
              deps.timeoutMs ?? 20000,
            );
          }),
        ]);
        if (g !== generation) return;
        if (deps.uid() !== owner) return error("ACCOUNT_CHANGED");
        if ("ok" in result) return error(result.errorCode);
        if (!usablePosition(result, deps.now())) return error("LOCATION_STALE");
        publish({ phase: "ready", loc: result });
      } catch {
        if (g === generation) error("LOCATION_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
      }
    },
    async begin() {
      if (state.phase !== "ready" || !state.loc || !owner) return;
      const g = generation,
        loc = state.loc,
        uid = owner;
      publish({ phase: "countdown", count: 3, error: null });
      try {
        for (let count = 3; count > 0; count--) {
          publish({ count });
          await deps.delay();
          if (g !== generation) return;
        }
        if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
        if (!usablePosition(loc, deps.now())) return error("LOCATION_STALE");
        publish({ phase: "starting", count: 0 });
        const result = await deps.start(loc, uid);
        if (g !== generation) return;
        if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
        if (!result.ok) return error(result.errorCode);
        publish({ phase: "done" });
        return result.value;
      } catch {
        if (g === generation) error("NETWORK");
      }
    },
  };
}

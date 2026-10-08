import type { Loc } from "./location";
export type PreparationState = {
  phase:
    | "idle"
    | "locating"
    | "ready"
    | "confirming"
    | "countdown"
    | "starting"
    | "done"
    | "error"
    | "cancelled";
  count: number;
  loc: Loc | null;
  error: string | null;
  uncertain: boolean;
  outside?: boolean;
};
type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: string; retryable?: boolean };
type Dependencies<T> = {
  uid: () => string | null;
  now: () => number;
  locate: (permissionPending: (pending: boolean) => void) => Promise<Loc | { ok: false; errorCode: string }>;
  start: (loc: Loc, uid: string, allowOutsidePilot?: boolean) => Promise<Outcome<T>>;
  outsidePilot?: (loc: Loc) => Promise<boolean>;
  confirmOutside?: () => Promise<boolean>;
  delay: () => Promise<void>;
  changed: (s: PreparationState) => void;
  timeoutMs?: number;
  autoStart?: boolean;
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
      uncertain: false,
    },
    generation = 0,
    owner: string | null = null,
    permissionPending = false,
    foreground = true;
  const publish = (patch: Partial<PreparationState>) => {
    state = { ...state, ...patch };
    deps.changed(state);
  };
  const error = (code: string, uncertain = false) =>
    publish({ phase: "error", error: code, count: 0, uncertain });
  const locate = async (g: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        deps.locate((pending) => { if (g === generation) permissionPending = pending; }),
        new Promise<{ ok: false; errorCode: string }>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, errorCode: "LOCATION_TIMEOUT" }), deps.timeoutMs ?? 20000);
        }),
      ]);
    } finally {
      if (g === generation) permissionPending = false;
      clearTimeout(timer);
    }
  };
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
    appStateChanged(value: string) {
      foreground = value === "active";
      if (foreground || permissionPending || state.phase === "starting" || state.phase === "done") return;
      generation++;
      publish({ phase: "cancelled", count: 0 });
    },
    blur() {
      if (state.phase === "starting" || state.phase === "done") return;
      generation++;
      publish({ phase: "cancelled", count: 0 });
    },
    async prepare() {
      if (["locating", "confirming", "countdown", "starting", "done"].includes(state.phase))
        return;
      const g = ++generation;
      permissionPending = false;
      owner = deps.uid();
      if (!owner) return error("UNAUTHENTICATED");
      publish({
        phase: "locating",
        error: null,
        loc: null,
        count: 0,
        uncertain: false,
        outside: false,
      });
      try {
        const result = await locate(g);
        if (g !== generation) return;
        if (deps.uid() !== owner) return error("ACCOUNT_CHANGED");
        if ("ok" in result) return error(result.errorCode);
        if (!usablePosition(result, deps.now())) return error("LOCATION_STALE");
        publish({ phase: "ready", loc: result });
        if (deps.autoStart) await this.begin();
      } catch {
        if (g === generation) error("LOCATION_UNAVAILABLE");
      }
    },
    async begin() {
      if (!foreground || state.phase !== "ready" || !state.loc || !owner) return;
      const g = generation, uid = owner;
      let loc = state.loc, allowOutsidePilot = false;
      let submitted = false;
      try {
        if (deps.outsidePilot) {
          publish({ phase: "confirming", count: 0, error: null });
          if (!usablePosition(loc, deps.now())) {
            const current = await locate(g);
            if (g !== generation) return;
            if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
            if ("ok" in current) return error(current.errorCode);
            loc = current;
          }
          if (!usablePosition(loc, deps.now())) return error("LOCATION_STALE");
          const outside = await deps.outsidePilot(loc);
          if (g !== generation) return;
          if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
          if (outside) {
            publish({ outside: true });
            const confirmed = await deps.confirmOutside?.();
            if (g !== generation) return;
            if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
            if (!confirmed) { publish({ phase: deps.autoStart ? "cancelled" : "ready", count: 0 }); return; }
            if (!foreground) return;
            allowOutsidePilot = true;
            // 확인 창을 오래 열어 두어도 오래된 위치로 시작하지 않는다.
            publish({ phase: "locating", count: 0 });
            const current = await locate(g);
            if (g !== generation) return;
            if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
            if ("ok" in current) return error(current.errorCode);
            loc = current;
          }
          if (!usablePosition(loc, deps.now())) return error("LOCATION_STALE");
          publish({ loc });
        }
        publish({ phase: "countdown", count: 3, error: null });
        for (let count = 3; count > 0; count--) {
          publish({ count });
          await deps.delay();
          if (g !== generation) return;
        }
        if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
        if (!usablePosition(loc, deps.now())) return error("LOCATION_STALE");
        publish({ phase: "starting", count: 0 });
        submitted = true;
        const result = await deps.start(loc, uid, allowOutsidePilot);
        if (g !== generation) return;
        if (deps.uid() !== uid) return error("ACCOUNT_CHANGED");
        if (!result.ok)
          return error(result.errorCode, result.retryable === true);
        publish({ phase: "done" });
        return result.value;
      } catch {
        if (g === generation) error("NETWORK", submitted);
      }
    },
  };
}

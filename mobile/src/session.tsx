// 계정 상태 + 화면별 조회 + 변경 요청. 웹 bridge처럼 전체 상태를 한꺼번에 새로 고치지 않고,
// 화면이 쓰는 API만 키별로 조회한다(같은 조회 합치기, 오래된 응답 버리기는 core.QueryCache).
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { PagedRegistry, QueryCache, RequestTracker, domainFailure, stableJson, toFailure, type Failure, type Result } from './core';
import { readJson, writeJson, StoreError } from './store';
import { call, signIn as nativeSignIn, signOutAll, watchUser, SetupError, type SetupProblem, type SignInResult } from './firebase';

export type AuthState =
  | { status: 'init'; uid: null }
  | { status: 'setup'; uid: null; problem: SetupProblem }
  | { status: 'out'; uid: null }
  | { status: 'in'; uid: string; anonymous: boolean };

type Session = {
  auth: AuthState;
  signingIn: boolean;
  cache: QueryCache;
  signIn: () => Promise<SignInResult>;
  signOut: () => Promise<Failure | null>;
  mutate: <T>(name: string, payload: Record<string, unknown>, slot?: string) => Promise<Result<T>>;
  refresh: (...names: string[]) => Promise<unknown>;
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;
const fail = (errorCode: string): Failure => ({ ok: false, errorCode, details: {}, retryable: false });

// 계정 단위 상태는 모듈에 한 벌만 둔다. 화면 밖(운동 위치 작업·사진 업로드)에서도 같은 요청 규칙을 쓰기 위해서다.
const cache = new QueryCache();
const tracker = new RequestTracker(Crypto.randomUUID, (uid, pending) => writeJson(`requests-${uid}.json`, pending));
let currentUid: string | null = null;
const accountListeners = new Set<(uid: string | null) => void>();
export const getUid = () => currentUid;
// 계정이 바뀔 때 함께 정리·복원할 모듈(운동 큐, 사진 작업)이 등록한다.
export const onAccountChange = (fn: (uid: string | null) => void) => {
  accountListeners.add(fn);
  return () => accountListeners.delete(fn);
};
// 로그아웃 직전(아직 이 계정 인증이 살아 있을 때) 정리할 작업: 운동 위치 수집 중지·저장 등.
const beforeSignOut = new Set<() => Promise<void> | void>();
export const onBeforeSignOut = (fn: () => Promise<void> | void) => {
  beforeSignOut.add(fn);
  return () => beforeSignOut.delete(fn);
};

// 변경 API: clientRequestId는 작업(slot)·내용별로 한 번만 만들고 계정별 파일에 남긴다.
// 결과가 모호한 실패에서는 같은 ID로 재시도하고, 이전 계정에서 만든 요청을 새 계정 인증으로 보내지 않는다.
export async function mutate<T>(name: string, payload: Record<string, unknown>, slot = name): Promise<Result<T>> {
  const uid = currentUid;
  if (!uid) return fail('UNAUTHENTICATED');
  const id = tracker.begin(slot, payload);
  let value: unknown;
  try {
    value = await call(name, { ...payload, clientRequestId: id });
  } catch (e) {
    const f = toFailure(e);
    if (!f.retryable && currentUid === uid) tracker.settle(slot, id);
    return currentUid === uid ? f : fail('ACCOUNT_CHANGED');
  }
  if (currentUid !== uid) return fail('ACCOUNT_CHANGED');
  tracker.settle(slot, id);
  return domainFailure(value) ?? { ok: true, value: value as T };
}

// 변경 성공 뒤 해당 계정의 관련 조회만 다시 부른다. 실패해도 변경을 다시 보내지 않는다(화면에서 조회만 재시도).
// 페이지 목록(usePaged)도 같은 이름이면 첫 페이지부터 다시 받는다.
const paged = new PagedRegistry();
export const onPagedRefresh = (name: string, reload: () => void) => paged.add(name, reload);
export const refresh = (...names: string[]) => {
  paged.fire(names);
  return cache.refresh(k => names.some(n => k.startsWith(`${currentUid ?? '-'}|${n}|`)));
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'init', uid: null });
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let off: (() => void) | null = null, alive = true;
    watchUser(user => {
      const uid = user?.uid ?? null;
      // 계정이 바뀌면 이전 계정의 조회 캐시·진행 중 응답 반영·요청 ID를 버리고, 새 계정이 남긴 요청·큐만 불러온다.
      if (uid !== currentUid) {
        currentUid = uid;
        cache.reset();
        // 요청 기록 파일이 깨졌으면 보관·알림(store) 뒤 빈 기록으로 시작한다 — 이후 요청은 새 ID라 중복 반영 가능성을 화면에 알린다.
        let restored = {};
        try {
          restored = uid ? readJson(`requests-${uid}.json`, {}) : {};
        } catch (e) {
          if (!(e instanceof StoreError)) throw e;
        }
        tracker.setOwner(uid, restored);
        for (const fn of accountListeners) {
          try {
            fn(uid);
          } catch (e) {
            if (__DEV__) console.warn('[uirun] 계정 전환 처리 실패', String((e as Error)?.message ?? e));
          }
        }
      }
      setAuth(uid ? { status: 'in', uid, anonymous: !!user?.isAnonymous } : { status: 'out', uid: null });
    }).then(
      unsubscribe => (alive ? (off = unsubscribe) : unsubscribe()),
      e => {
        // 개발 빌드에서만 초기화 실패 원인을 남긴다(토큰·개인정보가 들어 있지 않은 SDK 메시지)
        if (__DEV__ && !(e instanceof SetupError)) console.warn('[uirun] Firebase 초기화 실패', String(e?.message ?? e));
        setAuth({ status: 'setup', uid: null, problem: e instanceof SetupError ? e.problem : 'FIREBASE_INIT_FAILED' });
      },
    );
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    try {
      return await nativeSignIn();
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      for (const fn of beforeSignOut) await Promise.resolve().then(fn).catch(() => {});
      await signOutAll();
      return null;
    } catch (e) {
      return toFailure(e);
    }
  }, []);

  return <Ctx.Provider value={{ auth, signingIn, cache, signIn, signOut, mutate, refresh }}>{children}</Ctx.Provider>;
}

// 조회 훅. personal=true면 로그인한 동안에만 부른다. 인증 상태를 확인하기 전에는 공개 조회도 미룬다(계정 확인 뒤 중복 조회 방지).
// skip=true면 부르지 않는다(필요한 ID가 아직 없을 때 빈 값으로 서버를 부르지 않게).
export function useApi<T>(name: string, payload: Record<string, unknown> = {}, personal = false, skip = false) {
  const { auth, cache } = useSession();
  const enabled = !skip && (auth.status === 'in' || (!personal && auth.status === 'out'));
  const json = stableJson(payload), key = `${auth.uid ?? '-'}|${name}|${json}`;
  const entry = useSyncExternalStore(cache.subscribe, () => cache.get(key));
  const load = useCallback((force = false) => (enabled ? cache.load(key, () => call(name, JSON.parse(json)), force) : Promise.resolve()), [cache, enabled, key, name, json]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data: entry?.data as T | undefined, error: entry?.error, loading: enabled && (!entry || entry.loading), reload: () => load(true), enabled };
}

// 개인 하위 화면(프로필·포인트 내역)은 연 계정이 바뀌면 닫는다 — 다른 계정의 화면·입력이 남지 않게.
export function useCloseOnAccountChange() {
  const { auth } = useSession();
  const router = useRouter();
  const [opened] = useState(auth.uid);
  useEffect(() => {
    if (auth.uid !== opened) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [auth.uid, opened, router]);
}

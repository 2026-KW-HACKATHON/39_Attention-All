// 목록 페이지 이어 받기: 목록마다 자기 커서 필드만 쓴다(records의 runsCursor·participationsCursor처럼 독립).
// ID 중복 제거, INVALID_CURSOR면 첫 페이지부터, 늦게 온 이전 응답 무시. 합계는 이 목록으로 계산하지 않는다.
// 변경 뒤 session.refresh(name)가 불리면 첫 페이지부터 다시 받는다. 계정이 바뀌면 즉시 비운다(이전 계정 목록을 보이지 않는다).
// 상태: loading(처음 받는 중, 보여줄 항목 없음) / refreshing(항목은 그대로 두고 다시 받는 중) / error(마지막 요청 실패, 항목은 유지).
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './firebase';
import { onPagedRefresh, useSession } from './session';
import { domainFailure, stableJson, toFailure, type Failure, type Page } from './core';

type St<T> = { items: T[]; next: string | null; loading: boolean; refreshing: boolean; error?: Failure; done: boolean };
const INITIAL = { items: [], next: null, loading: true, refreshing: false, done: false };

// all=true: 지도처럼 전체가 필요한 곳. 다음 페이지를 이어서 받는다(최대 MAX_PAGES — 넘으면 next가 남아 화면이 알린다).
const MAX_PAGES = 20;
export function usePaged<T extends { id: string }>(name: string, field: string | null, cursorField: string, extra: Record<string, unknown> = {}, personal = false, all = false) {
  const { auth } = useSession();
  const enabled = auth.status === 'in' || (!personal && auth.status === 'out');
  const json = stableJson(extra);
  const owner = `${auth.uid ?? '-'}|${name}|${field}|${json}`;
  const [st, setSt] = useState<St<T>>(INITIAL);
  const [shownFor, setShownFor] = useState(owner);
  // 계정·조건이 바뀌면 렌더 중에 바로 비운다(이전 계정 항목이 한 프레임도 남지 않게)
  if (shownFor !== owner) {
    setShownFor(owner);
    setSt(INITIAL);
  }
  const seq = useRef(0);
  const [reset, setReset] = useState(0);
  const fetchPage = useCallback(async (cursor: string | null) => {
    try {
      const v = await call<Record<string, unknown>>(name, { limit: 20, ...JSON.parse(json), ...(cursor ? { [cursorField]: cursor } : {}) });
      const f = domainFailure(v);
      if (f) return { error: f };
      return { page: (field ? v[field] : v) as Page<T> };
    } catch (e) {
      return { error: toFailure(e) };
    }
  }, [name, field, cursorField, json]);
  const apply = useCallback((cursor: string | null, mine: number, r: { page?: Page<T>; error?: Failure }, more = false) => {
    if (seq.current !== mine) return;
    if (r.error) {
      if (r.error.errorCode === 'INVALID_CURSOR' && cursor) return setReset(n => n + 1);
      return setSt(s => ({ ...s, loading: false, refreshing: false, error: r.error }));
    }
    setSt(s => {
      const base = cursor ? s.items : [], seen = new Set(base.map(i => i.id));
      return { items: [...base, ...r.page!.items.filter(i => !seen.has(i.id))], next: r.page!.nextCursor, loading: more, refreshing: false, done: true };
    });
  }, []);
  // 받은 페이지를 반영하고, all이면 끝까지 이어서 받는다
  const load = useCallback(async (cursor: string | null, mine: number, first: Awaited<ReturnType<typeof fetchPage>>) => {
    for (let n = 1, cur = cursor, r = first; ; n++) {
      const next = r.page?.nextCursor ?? null, more = all && !!next && n < MAX_PAGES;
      apply(cur, mine, r, more);
      if (!more || seq.current !== mine) return;
      cur = next;
      r = await fetchPage(cur);
    }
  }, [all, fetchPage, apply]);
  const begin = useCallback((cursor: string | null) => {
    const mine = ++seq.current;
    setSt(s => ({ ...s, loading: !s.done, refreshing: s.done && !cursor, error: undefined }));
    void fetchPage(cursor).then(r => load(cursor, mine, r));
  }, [fetchPage, load]);
  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current; // 첫 페이지: 상태는 이미 loading(INITIAL)이거나 기존 항목 유지
    void fetchPage(null).then(r => load(null, mine, r));
    const off = onPagedRefresh(name, () => begin(null));
    return () => {
      off();
      // 계정·조건이 바뀌거나 로그아웃하면 아직 오는 중인 이전 응답을 버린다(의도적으로 현재 값을 올린다)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
    };
  }, [enabled, begin, fetchPage, load, name, reset, owner]);
  return { ...st, more: () => (st.next && !st.loading && !st.refreshing ? begin(st.next) : undefined), reload: () => begin(null) };
}

// 포인트 내역: getLedger 페이지(기본 20건)를 ‘더 보기’로 이어 붙인다. 잔액·검토 중 합계는 getMy의 서버 값이다
// (불러온 페이지를 더해 합계처럼 보여주지 않는다). 다음 페이지 기준이 사라지면(INVALID_CURSOR) 첫 페이지부터 다시 부른다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { call } from '../firebase';
import { useApi, useCloseOnAccountChange } from '../session';
import { domainFailure, kstDateTime, toFailure, type Failure, type Home, type Ledger, type My, type Page } from '../core';
import { color } from '../theme';
import { Btn, LoadState, Micro, Num, Row, Rows, Screen, Txt } from '../ui';

const TABS: [string, string][] = [['', '전체'], ['PENDING', '검토 중'], ['CONFIRMED', '적립']];
const STATUS: Record<Ledger['status'], string> = { PENDING: '검토 중', CONFIRMED: '적립', EXPIRED: '만료', REJECTED: '취소', REVERSED: '회수' };

type ListState = { items: Ledger[]; next: string | null; loading: boolean; error?: Failure; restarted?: boolean };
type PageResult = { page: Page<Ledger> } | { error: Failure };

async function fetchLedger(status: string, cursor: string | null): Promise<PageResult> {
  try {
    const page = await call<Page<Ledger>>('getLedger', { limit: 20, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
    const f = domainFailure(page);
    return f ? { error: f } : { page };
  } catch (e) {
    return { error: toFailure(e) };
  }
}

// 탭마다 새로 마운트한다(key=status). 받은 페이지는 ID로 중복을 지우고 이어 붙인다.
function useLedger(status: string) {
  const [st, setSt] = useState<ListState>({ items: [], next: null, loading: true });
  const seq = useRef(0);
  const [restart, setRestart] = useState(0);
  const apply = useCallback((cursor: string | null, mine: number, r: PageResult) => {
    if (seq.current !== mine) return; // 더 새 요청이 있다
    if ('error' in r) {
      if (r.error.errorCode === 'INVALID_CURSOR' && cursor) {
        setSt({ items: [], next: null, loading: true, restarted: true });
        return setRestart(n => n + 1);
      }
      return setSt(s => ({ ...s, loading: false, error: r.error }));
    }
    setSt(s => {
      const base = cursor ? s.items : [], seen = new Set(base.map(i => i.id));
      return { items: [...base, ...r.page.items.filter(i => !seen.has(i.id))], next: r.page.nextCursor, loading: false, restarted: s.restarted };
    });
  }, []);
  useEffect(() => {
    const mine = ++seq.current;
    void fetchLedger(status, null).then(r => apply(null, mine, r));
  }, [apply, status, restart]);
  const begin = (cursor: string | null) => {
    const mine = ++seq.current;
    setSt(s => ({ ...s, loading: true, error: undefined }));
    void fetchLedger(status, cursor).then(r => apply(cursor, mine, r));
  };
  return { ...st, more: () => (st.next && !st.loading ? begin(st.next) : undefined), retry: () => begin(st.items.length ? st.next : null) };
}

function LedgerList({ status }: { status: string }) {
  const list = useLedger(status);
  return (
    <>
      {list.restarted ? <Micro>목록이 바뀌어 처음부터 다시 불러왔어요.</Micro> : null}
      <Rows style={{ marginTop: 8 }}>
        {list.items.map(x => (
          <Row
            key={x.id}
            title={x.label || '포인트'}
            sub={`${kstDateTime(x.createdAt)} · ${STATUS[x.status] ?? x.status}${x.status === 'PENDING' && x.expiresAt ? ' · ' + kstDateTime(x.expiresAt) + '까지' : ''}`}
            right={
              <Txt style={{ fontFamily: 'ArchivoNum-ExtraBold', textDecorationLine: x.status === 'CONFIRMED' || x.status === 'PENDING' ? 'none' : 'line-through' }} s={18} c={x.status === 'CONFIRMED' ? color.blue : x.status === 'PENDING' ? color.deep : color.sub}>
                {(x.status === 'EXPIRED' || x.amount < 0 ? '' : '+') + x.amount}P
              </Txt>
            }
          />
        ))}
      </Rows>
      <LoadState loading={list.loading} error={list.error} onRetry={list.retry} empty={!list.items.length ? '내역이 없어요' : undefined} />
      {list.next && !list.loading && !list.error ? <Btn label="더 보기" onPress={list.more} style={{ marginTop: 12 }} /> : null}
    </>
  );
}

export default function LedgerScreen() {
  useCloseOnAccountChange();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState(params.status === 'PENDING' || params.status === 'CONFIRMED' ? params.status : '');
  const my = useApi<My>('getMy', {}, true);
  const home = useApi<Home>('getHome');
  const cfg = home.data?.config, b = my.data?.budget;

  return (
    <Screen title="포인트" onClose={() => router.back()}>
      {my.data ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 28, rowGap: 10, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ gap: 6 }}>
            <Num s={56} unit="P">
              {my.data.pointsBalance}
            </Num>
            <Txt w={600} s={13} c={color.sub}>
              적립 포인트
            </Txt>
          </View>
          <View style={{ gap: 6 }}>
            <Num s={36} c={color.deep} unit="P">
              {my.data.pointsPending}
            </Num>
            <Txt w={600} s={13} c={color.sub}>
              검토 중
            </Txt>
          </View>
        </View>
      ) : (
        <LoadState loading={my.loading} error={my.error} onRetry={() => void my.reload()} />
      )}
      <Micro>포인트로 바꿀 수 있는 상품은 아직 준비 중이에요.</Micro>
      {cfg?.baseDailyCap != null && cfg.quickDailyCap != null && b ? (
        <View style={{ gap: 4, marginVertical: 8 }}>
          <Fact k="오늘 남은 적립 한도" v={`${Math.max(0, cfg.baseDailyCap - b.base)}P / ${cfg.baseDailyCap}P`} />
          <Fact k="간단 응답 한도" v={`${Math.max(0, cfg.quickDailyCap - b.quick)}P / ${cfg.quickDailyCap}P`} />
        </View>
      ) : null}

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 18, marginTop: 18, borderBottomWidth: 1, borderBottomColor: color.line }}>
        {TABS.map(([k, l]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: status === k }} onPress={() => setStatus(k)} style={{ minHeight: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: status === k ? color.blue : 'transparent', marginBottom: -1 }}>
            <Txt w={700} s={15} c={status === k ? color.black : color.sub}>
              {l}
            </Txt>
          </Pressable>
        ))}
      </View>
      <LedgerList key={status} status={status} />
    </Screen>
  );
}

const Fact = ({ k, v }: { k: string; v: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    <Txt s={15} c={color.sub}>
      {k}
    </Txt>
    <Txt w={700} s={15}>
      {v}
    </Txt>
  </View>
);

import { useParticipationAccess } from '../../proximity';
import { OUTSIDE_PARTICIPATION_TEXT } from '../../pilot-proximity';
// 기록(웹 프로토타입 기록 탭): 운동 기록과 환경 참여 이력.
// 운동: 기간(7일·30일·12개월·전체) 합계는 서버 집계(getWorkoutStats)만 쓰고, 막대를 누르면 그 날(달)의 값을 보여준다.
//       아래 목록은 같은 기간의 운동만(getRecords runs 페이지). 간편 화면은 최근 기록 카드 + 최근 7일 합계 + 지난 기록.
// 환경 참여: 참여 요약(getMy.participationStats) + 날짜별 이력(getRecords participations). 누르면 상세 시트(내 사진·적립·철회).
// 포인트 잔액·혜택은 마이페이지에서 관리한다.
import { useContext, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { refresh, useApi, useSession } from '../../session';
import { usePaged } from '../../paged';
import { dur, km, kstTime, linePath, pace, projector, type Home, type LatLng, type My, type Observation } from '../../core';
import { MODE_LABEL } from '../../content';
import { ParticipationSheet, PtsBadge, obsLabel, obsState, rewardBadge, useObsTitle } from '../../participation';
import { color, space } from '../../theme';
import { Btn, Icon, LinkBtn, LoadState, Micro, Num, Rows, Scale, SecTitle, Seg, Txt } from '../../ui';

type Bucket = { key: string; count: number; distanceM: number; activeMs: number };
type Stats = { buckets: Bucket[]; totals: Bucket; period: Bucket };
type RunRow = { id: string; mode: 'RUN' | 'WALK'; startedAt: number; distanceM: number; activeMs: number; status: string };
type Range = 'week' | 'month' | 'year' | 'all';
const RANGE_NAME: Record<Range, string> = { week: '최근 7일', month: '최근 30일', year: '최근 12개월', all: '전체 기간' };
const KST = 9 * 3600000, DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const kd = (t: number) => new Date(t + KST);
const kstDate = (t: number) => `${kd(t).getUTCFullYear()}. ${kd(t).getUTCMonth() + 1}. ${kd(t).getUTCDate()}.`;
const kstKey = (t: number, month = false) => kd(t).toISOString().slice(0, month ? 7 : 10);
const keyDate = (k: string) => new Date(k.length === 7 ? k + '-01T00:00:00Z' : k + 'T00:00:00Z');
function barLabel(b: Bucket, i: number, n: number) {
  const d = keyDate(b.key);
  if (b.key.length === 7) return { short: d.getUTCMonth() + 1 + '월', full: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월` };
  const full = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DAYS[d.getUTCDay()]})`;
  if (i === n - 1) return { short: '오늘', full };
  if (n === 7) return { short: DAYS[d.getUTCDay()], full };
  return { short: (n - 1 - i) % 7 === 0 ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '', full };
}

function RunRowView({ r, big }: { r: RunRow; big?: boolean }) {
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/record/${r.id}` as never)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: big ? 76 : 64, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line }, pressed && { backgroundColor: color.bg }]}>
      <View style={{ minWidth: 84 }}>
        <Num s={36}>{km(r.distanceM)}</Num>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt w={700}>{kstDate(r.startedAt)} {MODE_LABEL[r.mode]}</Txt>
        <Txt s={14} c={color.sub}>
          {dur(r.activeMs)} · {pace(r.activeMs, r.distanceM)}/km{r.status === 'RECOVERED' ? ' · 복구한 기록' : ''}
        </Txt>
      </View>
      <Icon name="chev" s={18} c={color.sub} />
    </Pressable>
  );
}

function Bars({ buckets }: { buckets: Bucket[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(...buckets.map(b => b.distanceM));
  const picked = buckets.find(b => b.key === sel);
  return (
    <>
      <View accessibilityLabel="기간별 거리 막대" style={{ flexDirection: 'row', alignItems: 'stretch', gap: 2, height: 128, marginTop: 6, marginBottom: 2 }}>
        {buckets.map((b, i) => {
          const on = b.key === sel, now = i === buckets.length - 1, l = barLabel(b, i, buckets.length);
          return (
            <Pressable key={b.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${l.full} ${km(b.distanceM)}km`} onPress={() => setSel(on ? null : b.key)} style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: color.line }}>
                {b.distanceM ? (
                  <View style={{ width: '64%', maxWidth: 26, height: `${Math.max(4, (b.distanceM / max) * 100).toFixed(1)}%` as `${number}%`, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: on ? color.deep : now ? color.lime : color.blue, borderWidth: now && !on ? 1 : 0, borderColor: color.deep }} />
                ) : (
                  <View style={{ width: '64%', maxWidth: 26, height: 2, backgroundColor: color.lineStrong }} />
                )}
              </View>
              <Txt w={600} s={10} c={color.sub} center lines={1} style={{ height: 14 }}>{l.short}</Txt>
            </Pressable>
          );
        })}
      </View>
      <Txt s={13} c={color.sub} style={{ minHeight: 22, marginBottom: 4 }}>
        {picked ? (
          <>
            <Txt w={700} s={13}>{barLabel(picked, buckets.indexOf(picked), buckets.length).full}</Txt> {km(picked.distanceM)}km · {picked.count}회
          </>
        ) : (
          `최대 ${km(max)}km · 막대를 누르면 값을 보여줘요`
        )}
      </Txt>
    </>
  );
}

function StatLine({ items }: { items: [string | number, string, boolean?][] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 28, rowGap: 10, paddingTop: 12, paddingBottom: 12 }}>
      {items.map(([v, label, big]) => (
        <View key={label} style={{ gap: 6 }}>
          <Num s={big ? 56 : 36} unit={big ? 'km' : undefined}>{v}</Num>
          <Txt w={600} s={13} c={color.sub}>{label}</Txt>
        </View>
      ))}
    </View>
  );
}

function Runs({ simple }: { simple: boolean }) {
  const router = useRouter();
  const [range, setRange] = useState<Range>('week');
  const stats = useApi<Stats>('getWorkoutStats', { range: simple || range === 'all' ? 'week' : range }, true);
  const runs = usePaged<RunRow>('getRecords', 'runs', 'runsCursor', {}, true);
  const s = stats.data;
  const startKey = s && range !== 'all' ? s.buckets[0]?.key : null;
  const inRange = (r: RunRow) => !startKey || kstKey(r.startedAt, startKey.length === 7) >= startKey;
  const list = simple ? runs.items : runs.items.filter(inRange);
  const reachedEnd = !runs.next || (startKey && runs.items.length > 0 && !inRange(runs.items.at(-1)!));
  if (runs.done && !runs.items.length)
    return (
      <View style={{ paddingVertical: 32, gap: 16 }}>
        <Txt c={color.sub}>아직 운동 기록이 없어요.</Txt>
        <Btn kind="start" icon="play" label={simple ? '첫 산책 시작' : '첫 운동 시작'} onPress={() => router.navigate('/')} />
      </View>
    );
  if (simple) {
    const r = runs.items[0];
    return (
      <View>
        {r ? (
          <View style={{ paddingTop: 6, paddingBottom: 4, gap: 12 }}>
            <Txt w={700} c={color.sub}>{kstDate(r.startedAt)} {MODE_LABEL[r.mode]}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 22 }}>
              <Num s={56} unit="km">{km(r.distanceM)}</Num>
              <Num s={40} c={color.sub}>{dur(r.activeMs)}</Num>
            </View>
            <Btn kind="blue" big label="기록 보기" onPress={() => router.push(`/record/${r.id}` as never)} />
            {r.distanceM > 0 ? <Btn kind="line" big icon="image" label="사진 카드 만들기" onPress={() => router.push(`/card/${r.id}` as never)} /> : null}
          </View>
        ) : (
          <LoadState loading={runs.loading} error={runs.error} onRetry={runs.reload} />
        )}
        {s ? (
          <Txt w={700} c={color.sub} style={{ marginTop: 18 }}>
            최근 7일 합계 <Num s={28}>{km(s.period.distanceM)}</Num>km · {s.period.count}회
          </Txt>
        ) : (
          <LoadState loading={stats.loading} error={stats.error} onRetry={() => void stats.reload()} />
        )}
        {runs.items.length > 1 ? (
          <>
            <SecTitle>지난 기록</SecTitle>
            <Rows>{runs.items.slice(1).map(x => <RunRowView key={x.id} r={x} big />)}</Rows>
          </>
        ) : null}
        {runs.next ? <Btn kind="line" big label="기록 더 보기" busy={runs.loading} onPress={runs.more} style={{ marginTop: 12 }} /> : null}
      </View>
    );
  }
  const total = range === 'all' ? s?.totals : s?.period;
  return (
    <View>
      <Seg label="기간" value={range} onChange={setRange} options={[['week', '7일'], ['month', '30일'], ['year', '12개월'], ['all', '전체']]} />
      {s && total ? (
        <>
          <StatLine items={[[km(total.distanceM), RANGE_NAME[range] + ' 거리', true], [total.count, '운동 횟수'], [dur(total.activeMs), '운동 시간']]} />
          {range !== 'all' && total.count ? <Bars key={range} buckets={s.buckets} /> : null}
        </>
      ) : (
        <LoadState loading={stats.loading} error={stats.error} onRetry={() => void stats.reload()} />
      )}
      <SecTitle>{RANGE_NAME[range] + ' 운동'}</SecTitle>
      <Rows>{list.map(r => <RunRowView key={r.id} r={r} />)}</Rows>
      <LoadState loading={runs.loading && !runs.items.length} error={runs.error} onRetry={runs.reload} empty={runs.done && reachedEnd && !list.length ? `${RANGE_NAME[range]} 동안 기록이 없어요` : undefined} />
      {runs.refreshing ? <Micro>새로 불러오는 중…</Micro> : null}
      {runs.next && !reachedEnd ? <LinkBtn label="더 보기" onPress={runs.more} /> : null}
    </View>
  );
}

// 내 사진 썸네일(원본, 나만). 사진이 없거나 철회한 참여는 아이콘.
function Thumb({ o }: { o: Observation }) {
  const id = o.visibility !== 'HIDDEN' && o.modality === 'PHOTO' ? o.photo?.id : undefined;
  const q = useApi<{ url: string }>('getPhotoAccess', { photoId: id ?? '' }, true, !id);
  if (q.data?.url) return <Image source={{ uri: q.data.url }} accessibilityLabel="내가 찍은 사진" style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: color.line }} />;
  return (
    <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={o.modality === 'QUICK' ? 'tap' : 'camera'} c={color.deep} />
    </View>
  );
}

function Env({ simple }: { simple: boolean }) {
  const access = useParticipationAccess();
  const router = useRouter();
  const title = useObsTitle();
  const my = useApi<My & { participationStats?: { total: number; report: number; recheck: number; routine: number; recheckPhoto: number; recheckQuick: number } }>('getMy', {}, true);
  const list = usePaged<Observation>('getRecords', 'participations', 'participationsCursor', {}, true);
  const [picked, setPicked] = useState<Observation | null>(null);
  const [more, setMore] = useState(false);
  const st = my.data?.participationStats;
  const items = simple && !more ? list.items.slice(0, 5) : list.items;
  const days = new Map<string, Observation[]>();
  for (const o of items) {
    const k = kstDate(o.acceptedAt ?? o.observedAt);
    days.set(k, [...(days.get(k) ?? []), o]);
  }
  const ptsLink = <LinkBtn label="내 포인트" chev onPress={() => router.push('/ledger' as never)} />;
  return (
    <View>
      {simple ? null : <SecTitle first>참여 요약</SecTitle>}
      {st ? (
        <>
          <StatLine items={[[st.report, '신규 제보'], [st.recheck, '현장 확인'], [st.routine, '정기 관찰']]} />
          <Micro>현장 확인은 사진 {st.recheckPhoto} · 간단 응답 {st.recheckQuick}</Micro>
        </>
      ) : (
        <LoadState loading={my.loading} error={my.error} onRetry={() => void my.reload()} />
      )}
      <SecTitle right={ptsLink}>{simple ? '최근 참여' : '참여 이력'}</SecTitle>
      {[...days].map(([day, obs]) => (
        <View key={day}>
          <Txt w={700} s={14} c={color.sub} style={{ marginTop: 18, marginBottom: 2 }}>{day}</Txt>
          <Rows>
            {obs.map(o => {
              const b = rewardBadge(o), state = obsState(o);
              return (
                <Pressable key={o.id} accessibilityRole="button" onPress={() => setPicked(o)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line }, pressed && { backgroundColor: color.bg }]}>
                  <Thumb o={o} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt w={700} c={o.visibility === 'HIDDEN' ? color.sub : color.black}>{title(o)}</Txt>
                    <Txt s={14} c={color.sub}>{obsLabel(o)} · 접수 {kstTime(o.acceptedAt ?? o.observedAt)}{state ? ' · ' + state : ''}</Txt>
                    {b.tone === 'none' || b.tone === 'gone' ? <Txt s={14} c={color.sub}>{b.note}</Txt> : null}
                  </View>
                  <PtsBadge o={o} />
                </Pressable>
              );
            })}
          </Rows>
        </View>
      ))}
      <LoadState loading={list.loading && !list.items.length} error={list.error} onRetry={list.reload} />
      {list.refreshing ? <Micro>새로 불러오는 중…</Micro> : null}
      {list.done && !list.items.length ? (
        <View style={{ paddingVertical: 32, gap: 16 }}>
          <Txt c={color.sub}>아직 환경 참여 기록이 없어요.</Txt>
          {access.restricted ? <Micro>{OUTSIDE_PARTICIPATION_TEXT}</Micro> : null}
          <Btn kind="blue" icon="flag" label="첫 환경 제보 남기기" disabled={access.restricted} onPress={() => void access.open('/report')} />
        </View>
      ) : null}
      {simple && !more && list.items.length > 5 ? (
        <Btn kind="line" big label="이력 더 보기" onPress={() => setMore(true)} style={{ marginTop: 12 }} />
      ) : list.next ? (
        <LinkBtn label="더 보기" onPress={list.more} />
      ) : null}
      <ParticipationSheet o={picked} onClose={() => setPicked(null)} />
    </View>
  );
}

// 비로그인 소개: 산책로(옅게) 위 예시 코스선. 내 기록처럼 보이지 않게 점·숫자 없이.
function Intro() {
  const router = useRouter();
  const home = useApi<Home & { pilot?: { paths?: { points: LatLng[] }[] } }>('getHome');
  const [w, setW] = useState(0);
  const paths = home.data?.pilot?.paths ?? [], course = home.data?.courses[0]?.out ?? [];
  const fit = paths.flatMap(p => p.points);
  const f = w && fit.length > 1 ? projector(fit, w, 120, 18) : null;
  return (
    <View style={{ paddingTop: 4, paddingBottom: 20 }}>
      <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 120, marginTop: 4, marginBottom: 18 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {f ? (
          <Svg width={w} height={120}>
            {paths.map((p, i) => <Path key={i} d={linePath(p.points, f)} stroke={color.water} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
            {course.length > 1 ? <Path d={linePath(course, f)} stroke={color.white} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
            {course.length > 1 ? <Path d={linePath(course, f)} stroke={color.blue} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          </Svg>
        ) : null}
      </View>
      <Txt w={700} s={14} c={color.blue}>나의 우이천 기록</Txt>
      <Txt w={800} s={28} lh={1.3} style={{ marginTop: 6, marginBottom: 10 }}>{'한 걸음씩 쌓이는\n나의 하루.'}</Txt>
      <Txt s={15} c={color.sub} lh={1.6} style={{ marginBottom: 24 }}>걸어온 경로와 운동 시간, 우이천에 남긴 관찰을 한곳에서 확인해요.</Txt>
      <Btn kind="blue" label="로그인하고 기록 모으기" onPress={() => router.push({ pathname: '/login', params: { then: '/records' } })} />
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <LinkBtn label="먼저 둘러보기" chev onPress={() => router.navigate('/')} />
      </View>
    </View>
  );
}

export default function RecordsTab() {
  const inset = useSafeAreaInsets();
  const { auth } = useSession();
  const simple = useContext(Scale) !== 1;
  const [tab, setTab] = useState<'run' | 'env'>('run');
  const [pulling, setPulling] = useState(false);
  // 당겨서 새로 고침: 조회만 다시 한다(변경 요청은 보내지 않는다)
  const pull = () => {
    setPulling(true);
    void refresh('getWorkoutStats', 'getRecords', 'getMy', 'getMapData', 'getPilotData').finally(() => setPulling(false));
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.page, paddingTop: 20 + inset.top, paddingBottom: 40 }} refreshControl={auth.status === 'in' ? <RefreshControl refreshing={pulling} onRefresh={pull} colors={[color.blue]} progressViewOffset={inset.top} /> : undefined}>
      <Txt w={700} s={28} lh={1.25} style={{ marginTop: 4, marginBottom: 12 }}>
        기록
      </Txt>
      {auth.status !== 'in' ? (
        <Intro />
      ) : (
        <>
          <Seg label="기록 종류" value={tab} onChange={setTab} options={[['run', '운동 기록'], ['env', '환경 참여']]} />
          <View style={{ marginTop: 14 }}>{tab === 'run' ? <Runs simple={simple} /> : <Env simple={simple} />}</View>
        </>
      )}
    </ScrollView>
  );
}

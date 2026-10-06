// 운동 결과(웹 프로토타입 resultBody): 경로 지도 → 거리·시간·평균 페이스 → 구간 페이스 막대 → 운동 중 환경 참여 → 사실 정보.
// 값은 getRunDetail(서버 경로·metrics·참여)만 쓴다. 경로는 서버 거리 규칙으로 유효한 구간만 잇고, 없는 값은 만들지 않는다.
// 상승 고도는 표시하지 않는다(기획 결정). 운동 직후(done=1)에는 홈으로·사진 기록카드 버튼을 둔다.
import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApi } from '../../session';
import { dur, km, kstDateTime, kstTime, pace, type Home, type Issue, type Observation, type Page } from '../../core';
import { validSegments } from '../../runlogic';
import { RouteMap } from '../../routemap';
import { MODE_LABEL } from '../../content';
import { ParticipationSheet, PtsBadge, obsLabel, useObsTitle } from '../../participation';
import { color } from '../../theme';
import { Btn, clampW, Icon, LoadState, Notice, Num, Row, Rows, Screen, SecTitle, Txt } from '../../ui';

type TP = { lat: number; lng: number; acc: number; recordedAt: number; segment: number };
type Split = { index: number; distanceM: number; durationMs: number; paceSecPerKm: number | null; partial: boolean };
type Ex = { id: string; kind: 'ISSUE' | 'ROUTINE'; targetId: string; expiresAt: number; quickObsId: string | null; photoObsId: string | null };
type Detail = {
  id: string; mode: 'RUN' | 'WALK'; status: string; courseId: string | null; startedAt: number; endedAt?: number; activeMs: number; distanceM: number; track: TP[];
  metrics: { validDistanceM: number; observedMs: number; activeMs: number; pauseMs: number; averagePaceSecPerKm: number | null; splits: Split[]; unavailableReason: string | null };
  participationStats?: { total: number; report: number; recheck: number; routine: number };
  participations?: Page<Observation>;
  exposures?: Ex[];
};
const DAY = 86400000;
const lapName = (x: Split) => (x.partial ? `마지막 ${km(x.distanceM)}km` : `${x.index}km`);
const kstDate = (t: number) => {
  const d = new Date(t + 9 * 3600000);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`;
};

// 구간 페이스(웹 lapChart): 계산 가능한 구간이 둘 이상이면 가로 막대. 막대 길이 = 속도(길수록 빠름), 오른쪽은 /km 페이스.
// ‘가장 빠름’은 표시 페이스가 유일하게 가장 빠를 때만.
function Laps({ splits }: { splits: Split[] }) {
  const laps = splits.filter(x => !x.partial || x.distanceM >= 10);
  const ok = laps.filter(x => x.distanceM >= 10 && x.durationMs > 0);
  const [table, setTable] = useState(false);
  if (!laps.length) return null;
  const chart = ok.length >= 2;
  const sp = (x: Split) => x.distanceM / x.durationMs, max = Math.max(...ok.map(sp));
  const ps = (x: Split) => Math.round(x.durationMs / 1000 / (x.distanceM / 1000));
  const top = Math.min(...ok.map(ps)), tops = ok.filter(x => ps(x) === top), best = tops.length === 1 ? tops[0] : null;
  const showTable = table || !chart;
  return (
    <>
      <SecTitle>구간 페이스</SecTitle>
      {chart ? (
        <>
          <Txt s={13} c={color.sub} style={{ marginBottom: 8 }}>막대가 길수록 빨라요</Txt>
          <View style={{ gap: 8, marginBottom: 8 }} accessibilityLabel="구간별 페이스 막대">
            {laps.map(x => (
              <View key={x.index} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 100 }}>
                  <Txt w={600} s={14}>{lapName(x)}</Txt>
                  {x === best ? <Txt w={800} s={11} c={color.deep}>가장 빠름</Txt> : null}
                </View>
                <View style={{ flex: 1, height: 14, borderRadius: 7, backgroundColor: color.line, overflow: 'hidden' }}>
                  {ok.includes(x) ? <View style={{ width: `${((sp(x) / max) * 100).toFixed(1)}%` as `${number}%`, height: '100%', borderRadius: 7, backgroundColor: x === best ? color.deep : color.blue }} /> : null}
                </View>
                <View style={{ width: 62, alignItems: 'flex-end' }}>
                  <Num s={18} upright>{pace(x.durationMs, x.distanceM)}</Num>
                </View>
              </View>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: table }} onPress={() => setTable(v => !v)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Txt w={700} c={color.blue}>구간 표</Txt>
          </Pressable>
        </>
      ) : null}
      {showTable ? (
        <Rows>
          <View style={{ flexDirection: 'row', minHeight: 34, alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
            <Txt w={700} s={12} c={color.sub} style={{ width: 115 }}>구간</Txt>
            <Txt w={700} s={12} c={color.sub} style={{ flex: 1 }}>시간</Txt>
            <Txt w={700} s={12} c={color.sub}>페이스</Txt>
          </View>
          {laps.map(x => (
            <View key={x.index} style={{ flexDirection: 'row', minHeight: 48, alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
              <Txt w={700} s={15} style={{ width: 115 }}>{lapName(x)}</Txt>
              <View style={{ flex: 1 }}><Num s={21} upright>{dur(x.durationMs)}</Num></View>
              <Num s={21} upright>{pace(x.durationMs, x.distanceM)}</Num>
            </View>
          ))}
        </Rows>
      ) : null}
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Num s={36}>{n}</Num>
      <Txt w={600} s={13} c={color.sub}>{label}</Txt>
    </View>
  );
}

export default function RecordDetail() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id, done } = useLocalSearchParams<{ id: string; done?: string }>();
  const q = useApi<Detail>('getRunDetail', { sessionId: id }, true);
  const home = useApi<Home>('getHome');
  const title = useObsTitle();
  const [picked, setPicked] = useState<Observation | null>(null);
  const [now] = useState(() => Date.now());
  const d = q.data;
  const head = done ? '운동 완료' : '운동 결과';
  if (!d)
    return (
      <Screen title={head} close={!!done} onClose={() => (done ? router.replace('/') : router.back())}>
        <LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} />
      </Screen>
    );
  const m = d.metrics, noDist = !!m.unavailableReason;
  const incomplete = !noDist && m.activeMs - m.observedMs > 60000;
  const purged = !d.track.length && d.distanceM > 0 && now - d.startedAt > 90 * DAY;
  const course = d.courseId ? home.data?.courses.find(c => c.id === d.courseId)?.name ?? '코스' : '코스 없이 기록';
  const n = d.participationStats ?? { report: 0, recheck: 0, routine: 0, total: 0 };
  const obs = (d.participations?.items ?? []).filter(o => o.visibility !== 'HIDDEN');
  const left = (d.exposures ?? []).filter(e => e.kind === 'ISSUE' && !e.quickObsId && !e.photoObsId && now < e.expiresAt);
  const card = () => router.push(`/card/${d.id}` as never);
  return (
    <Screen
      title={head}
      close={!!done}
      onClose={() => (done ? router.replace('/') : router.back())}
      foot={
        done ? (
          <>
            <Btn kind="line" label="홈으로" onPress={() => router.replace('/')} style={noDist ? { flex: 1 } : undefined} />
            {noDist ? null : <Btn kind="blue" icon="image" label="사진 기록카드 만들기" onPress={card} style={{ flex: 1 }} />}
          </>
        ) : noDist ? undefined : (
          <Btn kind="blue" icon="image" label="사진 기록카드 만들기" onPress={card} style={{ flex: 1 }} />
        )
      }>
      {d.status === 'RECOVERED' ? <Notice kind="warn" text="늦게 정리된 기록을 복구했어요. 관찰 알림과 포인트는 붙지 않아요." /> : null}
      <RouteMap segs={validSegments(d.track)} empty={purged ? '보존 기간(90일)이 지나 경로를 지웠어요' : '기록된 이동 경로가 없어요'} />
      {noDist ? (
        <Notice kind="warn" text="위치를 받지 못해 거리·페이스·구간을 계산하지 못했어요. 운동 시간만 기록했어요." />
      ) : incomplete ? (
        <Notice kind="warn" text="중간에 위치를 받지 못한 시간이 있어 실제보다 거리가 짧을 수 있어요." />
      ) : null}

      <View style={{ paddingTop: 4, paddingBottom: 8 }}>
        <Txt w={700} c={color.sub}>{kstDate(d.startedAt)} {MODE_LABEL[d.mode]}</Txt>
        {noDist ? (
          <Txt w={800} s={28} c={color.sub} style={{ marginTop: 14, marginBottom: 16 }}>거리 계산 불가</Txt>
        ) : (
          <View style={{ marginTop: 8, marginBottom: 14 }}>
            <Num fixed s={clampW(4.5, 26, 6.25, width)} unit="km">{km(d.distanceM)}</Num>
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28, rowGap: 12 }}>
          <View style={{ gap: 4 }}>
            <Num s={32}>{dur(d.activeMs)}</Num>
            <Txt w={600} s={13} c={color.sub}>{d.mode === 'WALK' ? '산책 시간' : '운동 시간'}</Txt>
          </View>
          <View style={{ gap: 4 }}>
            <Num s={32}>{noDist ? '–' : pace(d.activeMs, d.distanceM)}</Num>
            <Txt w={600} s={13} c={color.sub}>평균 페이스</Txt>
          </View>
        </View>
      </View>

      {noDist ? null : <Laps splits={m.splits} />}

      <SecTitle>운동 중 환경 참여</SecTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28, rowGap: 10, paddingTop: 8, paddingBottom: 12 }}>
        <Stat n={n.report} label="신규 제보" />
        <Stat n={n.recheck} label="현장 확인" />
        <Stat n={n.routine} label="정기 관찰" />
      </View>
      {obs.length ? (
        <Rows>
          {obs.map(o => (
            <Row key={o.id} icon={o.modality === 'QUICK' ? 'tap' : 'camera'} title={title(o)} sub={obsLabel(o)} right={<PtsBadge o={o} />} onPress={() => setPicked(o)} />
          ))}
        </Rows>
      ) : (
        <Txt s={15} c={color.sub}>이번 운동에서는 참여하지 않았어요.</Txt>
      )}
      {left.length ? (
        <>
          <Txt s={15} c={color.sub} style={{ marginTop: 12 }}>아직 남길 수 있는 관찰 요청이 있어요.</Txt>
          <Rows>
            {left.map(e => (
              <LeftRequest key={e.id} e={e} onPress={() => router.push(`/issue/${e.targetId}` as never)} />
            ))}
          </Rows>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: color.line }}>
        {[
          ['시작', kstDateTime(d.startedAt)],
          ['종료', d.endedAt ? kstDateTime(d.endedAt) : '–'],
          ['코스', course],
          ['위치', '이 기기 GPS'],
        ].map(([k, v]) => (
          <View key={k} style={{ width: '50%', paddingVertical: 10, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: color.line }}>
            <Txt s={13} c={color.sub}>{k}</Txt>
            <Txt w={700} s={15}>{v}</Txt>
          </View>
        ))}
      </View>
      <ParticipationSheet o={picked} onClose={() => setPicked(null)} />
    </Screen>
  );
}

function LeftRequest({ e, onPress }: { e: Ex; onPress: () => void }) {
  const q = useApi<{ issue: Issue }>('getIssueDetail', { issueId: e.targetId });
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
      <View style={{ flex: 1 }}>
        <Txt w={700}>{q.data?.issue.categoryLabel ?? '관찰'}</Txt>
        <Txt s={14} c={color.sub}>{kstTime(e.expiresAt)}까지 · 관찰 지점에서 직접 참여</Txt>
      </View>
      <Icon name="chev" s={18} c={color.sub} />
    </Pressable>
  );
}

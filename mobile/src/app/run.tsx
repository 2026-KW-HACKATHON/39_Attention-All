// 운동 중 화면(웹 프로토타입 flows.js 운동 화면). 어두운 화면, 정보 영역만 스크롤되고 조작부는 아래에 고정된다.
// 달리기: 거리 크게 → 시간·평균 페이스. 산책: 시간 크게 → 걸은 거리·페이스. 간편: 시간·거리만, ‘자세히 보기’로 페이스·지도.
// 거리는 기기 계산값(서버와 같은 유효 구간 규칙, 미전송분 포함). 종료를 누르면 그 시각에서 시간이 멈추고 서버 확인을 기다린다.
// 진단(전송 대기 점 수·버린 점)은 화면에 늘어놓지 않고 ‘기록 상태’ 시트에서만 본다.
import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { activeMs, clearEnded, discardRun, finishRun, finishSavedOnly, getRun, pauseRun, pump, restartLocation, resumeRun, subscribeRun, type Exposure, type Run } from '../run';
import { useParticipationAccess } from '../proximity';
import { OUTSIDE_PARTICIPATION_TEXT } from '../pilot-proximity';
import { pendingPoints, trailLines } from '../runlogic';
import { quickFromExposure, nearestM } from '../exposure';
import { useApi } from '../session';
import { dur, errorText, kstTime, km, linePath, pace, projector, rewardText, type Course, type Home, type Issue, type LatLng, type MapData } from '../core';
import { color } from '../theme';
import { Btn, clampW, Icon, Micro, Num, Scale, Sheet, TextBtn, Txt } from '../ui';

const H = 3600000;
const SUB = 'rgba(255,255,255,0.68)', DIM = '#9EA3B8', NIGHT = '#111111', NIGHT2 = '#1E2130', NOTE = '#FFD58A';
const PROBLEM: Record<string, string> = {
  SESSION_TRACK_LIMIT: '위치 기록 한도(5,000점)에 닿았어요. 저장된 부분으로 운동을 마쳐 주세요.',
  SESSION_EXPIRED: '시작 후 6시간이 지나 더 기록할 수 없어요. 저장된 부분으로 마쳐 주세요.',
  SESSION_CLOSED: '서버에서 이미 끝난 운동이에요.',
  LOCATION_OFF: '위치 기록이 꺼져 있어요. 위치 권한·위치 설정을 확인하고 다시 켜 주세요.',
  TRACK_REJECTED: '서버가 받지 않은 위치가 있어요. 그 구간은 거리에서 빠져요.',
};

export default function RunScreen() {
  const router = useRouter();
  const access = useParticipationAccess();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const k = useContext(Scale), simple = k !== 1;
  const r = useSyncExternalStore(subscribeRun, getRun);
  const [now, setNow] = useState(() => Date.now());
  const [more, setMore] = useState(false);
  const [ending, setEnding] = useState(false);
  const [diag, setDiag] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // 서버가 종료를 확인하면 결과 화면으로(폐기는 홈으로)
  useEffect(() => {
    if (r?.status !== 'ENDED') return;
    const id = r.sessionId, discarded = r.result?.status === 'DISCARDED';
    clearEnded();
    if (discarded) router.replace('/');
    else router.replace(`/record/${id}?done=1` as never);
  }, [r?.status, r?.sessionId, r?.result?.status, router]);

  if (!r || r.status === 'ENDED')
    return (
      <View style={{ flex: 1, backgroundColor: NIGHT, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <StatusBar style="light" />
        <Txt c={color.white}>{r ? '운동을 정리하고 있어요.' : '진행 중인 운동이 없어요.'}</Txt>
        <Btn kind="white" label="돌아가기" onPress={() => router.back()} />
      </View>
    );

  const ms = activeMs(r, now), dist = r.localM, walk = r.mode === 'WALK';
  const paused = r.status === 'PAUSED', closing = r.status === 'ENDING';
  const detail = !simple || more;
  const long = ms >= H;
  const numC = paused || closing ? DIM : color.white;
  const fix = r.last && now - r.last.measuredAt < 10000 ? r.last : null;
  const pending = pendingPoints(r.ops, r.buffer).length;
  // 오른쪽 위 상태: GPS 정확도, 묶어 둔 요청을 보내는 중이면 ‘동기화 중’(오프라인 안내는 아래 문구)
  const gps = [closing ? '저장 중' : paused ? '' : fix ? `GPS ${Math.round(fix.accuracyM)}m${fix.accuracyM > 30 ? ' · 거리 제외 중' : ''}` : '위치 없음', r.ops.length && !r.offline && !closing ? '동기화 중' : ''].filter(Boolean).join(' · ');
  const note = r.unsaved
    ? { icon: 'warn', text: '이 기기에 저장하지 못하고 있어요. 저장 공간을 확인해 주세요' }
    : r.offline && !closing
      ? { icon: 'wifi-off', text: '연결 없이 기록 중 · 연결되면 보내요. 관찰 알림은 꺼져 있어요' }
      : r.status === 'ACTIVE' && r.lastAt && now - r.lastAt > 60000
        ? { icon: 'locate', text: '위치를 받지 못하고 있어요 · 이 동안의 거리는 기록되지 않아요' }
        : null;
  const ex = r.exposure && !closing && now < r.exposure.expiresAt ? r.exposure : null;
  const label = closing ? '종료 중' : paused ? '일시정지' : walk ? '산책 중' : '달리기 중';

  const nums = simple ? (
    <View style={{ gap: 20, marginTop: 12 }}>
      <View style={{ gap: 6 }}>
        <Num fixed s={long ? clampW(3, 18, 4.2, width, k) : clampW(4, 25, 5.8, width, k)} c={numC}>{dur(ms)}</Num>
        <Txt s={13} c={SUB}>{walk ? '산책 시간' : '운동 시간'}</Txt>
      </View>
      <View style={{ gap: 6 }}>
        <Num fixed s={clampW(3.25, 19, 4.4, width, k)} c={numC}>{km(dist)}</Num>
        <Txt s={13} c={SUB}>{walk ? '걸은 거리(km)' : '킬로미터'}</Txt>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore(v => !v)} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
        <Txt w={700} c={color.lime}>{more ? '간단히 보기' : '자세히 보기'}</Txt>
      </Pressable>
      {detail ? <PaceLine ms={ms} m={dist} /> : null}
    </View>
  ) : walk ? (
    <View style={{ marginTop: 16, alignItems: 'flex-start' }}>
      <Txt w={700} s={14} c={SUB}>산책 시간</Txt>
      <Num fixed s={long ? clampW(3.5, 21, 5.25, width) : clampW(4.75, 29, 7, width)} c={numC} style={{ marginTop: 6, marginBottom: 20 }}>{dur(ms)}</Num>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Txt w={700} s={15} c={SUB}>걸은 거리</Txt>
        <Num s={44} c={numC}>{km(dist)}</Num>
        <Txt w={700} s={15} c={SUB}>km</Txt>
      </View>
      <PaceLine ms={ms} m={dist} />
    </View>
  ) : (
    <>
      <View style={{ marginTop: 8 }}>
        <Num fixed s={clampW(5.5, 34, 8.6, width)} c={numC}>{km(dist)}</Num>
        <Txt s={15} c={SUB} style={{ marginTop: 8 }}>킬로미터</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Num fixed s={long ? clampW(3, 18, 4.2, width) : 44} c={color.white}>{dur(ms)}</Num>
          <Txt s={13} c={SUB}>시간</Txt>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Num fixed s={44} c={color.white}>{pace(ms, dist)}</Num>
          <Txt s={13} c={SUB}>평균 페이스</Txt>
        </View>
      </View>
    </>
  );

  const report = (wide: boolean) => (
    <Pressable
      accessibilityRole="button"
      disabled={access.restricted}
      accessibilityState={{ disabled: access.restricted }}
      onPress={() => void access.open('/report')}
      style={({ pressed }) => [
        { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
        wide ? { flexDirection: 'row', gap: 6, minHeight: simple ? 64 : 56, borderRadius: 999 } : { gap: 2, width: 76, height: 64, borderRadius: 16 },
        (pressed || access.restricted) && { opacity: 0.45 },
      ]}>
      <Icon name="flag" c={color.white} />
      <Txt w={800} s={wide ? (simple ? 19 : 17) : 13} c={color.white} lh={1.2}>환경 제보</Txt>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: NIGHT, paddingTop: inset.top, paddingBottom: inset.bottom }}>
      <StatusBar style="light" />
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 20, paddingRight: 8 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: paused || closing ? '#7A7F95' : color.lime }} />
        <Txt w={800} c={color.white}>{label}</Txt>
        <Pressable onPress={() => setDiag(true)} accessibilityRole="button" accessibilityLabel="기록 상태 보기" style={{ marginLeft: 'auto', minHeight: 44, justifyContent: 'center' }}>
          <Txt s={12} c={SUB}>{gps}</Txt>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="운동 화면 접기" onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="down" c={color.white} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
        {ex && !walk ? <AlertCard r={r} ex={ex} now={now} /> : null}
        {nums}
        {detail ? <RunMap r={r} /> : null}
        {note ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 }}>
            <Icon name={note.icon} s={16} c={NOTE} />
            <Txt s={14} c={NOTE} style={{ flex: 1 }}>{note.text}</Txt>
          </View>
        ) : null}
        {r.problem ? (
          <View style={{ marginTop: 12, gap: 8, padding: 14, borderRadius: 16, backgroundColor: NIGHT2 }}>
            <Txt w={700} s={15} c={NOTE}>{PROBLEM[r.problem] ?? '서버 운동 상태와 달라 서버 기록으로 맞췄어요.'}</Txt>
            {r.problem === 'LOCATION_OFF' ? (
              <Btn kind="ghost" label="위치 기록 다시 켜기" onPress={() => void restartLocation()} />
            ) : r.problem === 'SESSION_TRACK_LIMIT' || r.problem === 'SESSION_EXPIRED' ? (
              <Btn kind="ghost" label="저장된 부분으로 마치기" onPress={() => void finishSavedOnly()} />
            ) : null}
          </View>
        ) : null}
        {access.restricted && !closing ? <Txt s={12} c={NOTE}>{OUTSIDE_PARTICIPATION_TEXT}</Txt> : null}
        {closing ? (
          <Txt s={14} c={SUB} style={{ marginTop: 12 }}>
            {r.offline ? '연결을 기다리고 있어요. 누른 시각으로 종료가 기록돼요.' : '기록을 저장하는 중이에요.'}
            {pending ? ` 보낼 위치 ${pending}점.` : ''}
          </Txt>
        ) : null}
        {ex && walk ? <AlertCard r={r} ex={ex} now={now} /> : null}
      </ScrollView>

      <View style={{ gap: 14, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }}>
        {closing ? (
          <Btn kind="ghost" label={r.offline ? '지금 다시 보내기' : '보내는 중'} busy={!r.offline} onPress={() => void pump()} />
        ) : (
          <>
            {walk || simple ? report(true) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1, alignItems: 'flex-start' }}>
                {paused ? (
                  <Pressable accessibilityRole="button" onPress={() => setEnding(true)} style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                    <Icon name="stop" s={18} c={color.white} />
                    <Txt w={700} s={12} c={color.white} lh={1.2}>종료</Txt>
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => void (paused ? resumeRun() : pauseRun())}
                style={({ pressed }) => [{ width: 92, height: 92, borderRadius: 46, backgroundColor: color.lime, alignItems: 'center', justifyContent: 'center', gap: 2 }, pressed && { transform: [{ scale: 0.95 }] }]}>
                <Icon name={paused ? 'play' : 'pause'} s={30} c={color.black} />
                <Txt w={800} s={13} lh={1.2}>{paused ? '재개' : '일시정지'}</Txt>
              </Pressable>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>{walk || simple ? null : report(false)}</View>
            </View>
          </>
        )}
      </View>

      <Sheet
        open={ending}
        onClose={() => setEnding(false)}
        title="운동을 끝낼까요?"
        sub={`${km(dist)}km · ${dur(ms)}`}
        foot={
          <>
            <Btn kind="ink" label="저장하고 종료" onPress={() => { setEnding(false); void finishRun(); }} />
            <Btn kind="line" label="계속하기" onPress={() => setEnding(false)} />
            <TextBtn
              danger
              label="기록 폐기"
              onPress={() =>
                Alert.alert('이번 운동 기록을 폐기할까요?', '경로와 시간이 저장되지 않아요. 운동 중 남긴 관찰은 남아요.', [
                  { text: '취소', style: 'cancel' },
                  { text: '폐기', style: 'destructive', onPress: () => { setEnding(false); void discardRun(); } },
                ])
              }
            />
          </>
        }>
        <Txt s={15} c={color.sub}>기록을 폐기해도 운동 중 남긴 관찰과 포인트는 그대로 남아요.</Txt>
        {r.offline ? <Micro>지금은 연결이 없어요. 누른 시각으로 종료를 기록하고, 연결되면 남은 위치와 함께 보내요.</Micro> : null}
      </Sheet>

      <Sheet open={diag} onClose={() => setDiag(false)} title="기록 상태" sub="문제 확인용 정보예요">
        <Micro c={color.black}>
          서버 저장 위치 {r.stored}점 · 보낼 위치 {pending}점{r.offline ? ' · 연결 대기' : ''}
          {'\n'}서버 저장 거리 {km(r.distanceM)}km · 화면 거리 {km(r.localM)}km
          {r.gaps ? `\n위치가 끊긴 구간 ${r.gaps}번(그 구간은 잇지 않아요)` : ''}
          {r.skippedMock ? `\n가짜 위치로 보여 보내지 않은 점 ${r.skippedMock}점` : ''}
          {r.dropped ? `\n일시정지 구간이라 서버 규칙상 저장하지 않은 점 ${r.dropped}점` : ''}
          {r.rejected.length ? `\n서버가 받지 않아 기기에 보관한 점 ${r.rejected.length}점` : ''}
        </Micro>
        <Micro>화면을 꺼도 알림이 떠 있는 동안 기록해요. 최근 앱에서 지우거나 강제 종료하면 기록이 멈춰요.</Micro>
      </Sheet>
    </View>
  );
}

function PaceLine({ ms, m }: { ms: number; m: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
      <Txt s={13} c={SUB}>평균 페이스 </Txt>
      <Num s={20} c={color.white}>{pace(ms, m)}</Num>
      <Txt s={13} c={SUB}>/km</Txt>
    </View>
  );
}

// 지도 대신 그리는 경로 그림(웹 run-map): 산책로(흐리게), 계획 코스(점선), 지금까지 경로(라임), 현재 위치
function RunMap({ r }: { r: Run }) {
  const home = useApi<Home & { pilot?: { paths?: { points: LatLng[] }[] } }>('getHome');
  const [w, setW] = useState(0);
  const h = 150, course: Course | undefined = home.data?.courses.find(c => c.id === r.courseId);
  const lines = trailLines(r.trail);
  const fit = course?.out?.length ? course.out : lines.flat();
  if (fit.length < 2) return <View style={{ flex: 1, minHeight: 110 }} />;
  const f = w ? projector(fit, w, h, 14) : null;
  const me = r.trail.at(-1);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ flex: 1, minHeight: 110, maxHeight: 190, marginTop: 16, marginHorizontal: -4, marginBottom: 4, justifyContent: 'center' }}>
      {f ? (
        <Svg width={w} height={h} accessibilityLabel="지금까지 이동한 경로">
          {(home.data?.pilot?.paths ?? []).map((p, i) => <Path key={'p' + i} d={linePath(p.points, f)} stroke="rgba(216,230,243,0.16)" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {course?.out ? <Path d={linePath(course.out, f)} stroke="rgba(255,255,255,0.28)" strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" fill="none" /> : null}
          {lines.map((l, i) => <Path key={'t' + i} d={linePath(l, f)} stroke={color.lime} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {me ? <Circle cx={f([me[0], me[1]])[0]} cy={f([me[0], me[1]])[1]} r={6} fill={color.blue} stroke={color.white} strokeWidth={2.5} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

// 운동 중 관찰 요청 카드(웹 alertHtml). 달리기는 어두운 카드, 산책은 흰 카드. 간단 응답은 이 화면에서 바로 보낸다.
function AlertCard({ r, ex, now }: { r: Run; ex: Exposure; now: number }) {
  const access = useParticipationAccess();
  const run = r.mode === 'RUN';
  const issue = useApi<{ issue: Issue }>('getIssueDetail', { issueId: ex.targetId }, false, ex.kind !== 'ISSUE');
  const map = useApi<MapData>('getMapData');
  const home = useApi<Home>('getHome');
  const [closed, setClosed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (closed === ex.id) return null;
  const i = ex.kind === 'ISSUE' ? issue.data?.issue : null;
  const anchors: LatLng[] = i ? (i.observationAnchors?.length ? i.observationAnchors : [i.anchor]) : map.data?.routines.find(m => m.id === ex.targetId)?.anchors ?? [];
  const title = ex.kind === 'ISSUE' ? `${i?.categoryLabel ?? '관찰'}이 보이나요?` : '정기 관찰 지점 근처예요';
  const d = nearestM(r.last && now - r.last.measuredAt < 10000 ? r.last : null, anchors);
  const radius = (home.data?.config as { validationRadiusM?: number } | undefined)?.validationRadiusM ?? 40;
  const far = d == null || d > radius;
  const fg = run ? color.white : color.black;
  const quick = async () => {
    setBusy(true);
    const res = await quickFromExposure(ex, r.sessionId);
    setBusy(false);
    setMsg(res.ok ? (res.value.existing ? '오늘 이미 남긴 응답이에요 · 새로 기록하지 않았어요' : '남겼어요 · ' + rewardText(res.value)) : errorText(res) + (res.retryable ? ' · 다시 눌러 주세요' : ''));
  };
  return (
    <View accessibilityRole="alert" style={[{ padding: 12, paddingRight: 4, borderRadius: 16, gap: 8 }, run ? { backgroundColor: NIGHT2, marginBottom: 8 } : { backgroundColor: color.panel, marginTop: 12, padding: 16, paddingRight: 6 }]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: run ? 'rgba(255,255,255,0.1)' : color.blueSoft }}>
          <Icon name={ex.kind === 'ISSUE' ? 'eye' : 'repeat'} c={run ? color.white : color.blue} />
        </View>
        <View style={{ flex: 1, paddingTop: 2 }}>
          <Txt w={700} s={run ? 16 : 18} c={fg}>{title}</Txt>
          {!run && ex.kind === 'ROUTINE' ? <Txt s={13} c={color.sub}>이상이 없어도 지금 모습을 남길 수 있어요.</Txt> : null}
          <Txt s={13} c={run ? SUB : color.sub}>{d == null ? '위치 없음' : d + 'm'} · {kstTime(ex.expiresAt)}까지</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="알림 닫기" onPress={() => setClosed(ex.id)} style={{ width: 44, height: 44, marginTop: -6, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" c={fg} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
        {ex.kind === 'ISSUE' ? (
          <Btn kind={run ? 'white' : 'ink'} label="지금도 보여요" busy={busy} disabled={far || access.restricted} onPress={() => void quick()} style={{ flex: 1, minHeight: run ? 44 : 52 }} />
        ) : null}
        <Btn kind={run ? 'ghost' : 'line'} icon="camera" label="사진" disabled={access.restricted} onPress={() => void access.open(`/report?kind=${ex.kind === 'ISSUE' ? 'recheck' : 'routine'}&target=${ex.targetId}&exposure=${ex.id}`)} style={{ flex: 1, minHeight: run ? 44 : 52 }} />
      </View>
      {msg || (ex.kind === 'ISSUE' && far) ? (
        <Txt s={13} c={run ? NOTE : color.blue} style={{ paddingRight: 8 }}>{msg ?? `${radius}m 안에서 남길 수 있어요`}</Txt>
      ) : null}
    </View>
  );
}

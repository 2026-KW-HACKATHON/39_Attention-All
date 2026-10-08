// 워치 ‘우이런에서 촬영’ 연결 화면(uirun://wear-capture?req=<요청 ID>). 앱 안 카메라(expo-camera)로 같은 체크포인트를 찍어
// 기존 사진 파이프라인(티켓 → 촬영 → 보관 → 봉인 → 업로드 → READY → 제출)으로 보낸다. 시스템 카메라 앱을 열지 않는다.
// - 딥링크에는 요청 ID만 있다. 계정·운동·Exposure·대상·만료는 폰이 보관한 연결 정보(wear.ts)로 다시 확인한다. 링크만으로 제출하지 않는다.
// - 단계(카메라 열림·제출·서버 결과·취소·실패)를 워치에 알린다. 취소해도 운동은 계속되고 포인트는 없다.
// - 제출은 사진 작업 하나에 한 번(같은 작업·같은 요청 ID로만 재시도). 셔터는 누르는 동안 다시 눌리지 않는다.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { capture, finishJob, markSubmitting, needsRetake, pendingJob, upload, type PhotoJob } from '../capture';
import { getRun } from '../run';
import { participationLoc } from '../pilot-access';
import { getUid, mutate, refresh, useApi, useCloseOnAccountChange } from '../session';
import { getHandoff, handoffStage, markCaptureOpen, subscribeWear } from '../wear';
import { handoffUsable, rewardOf } from '../wearlogic';
import { errorText, rewardText, type Failure, type Issue, type Participation } from '../core';
import { LOCATION_TEXT } from './report';
import { color } from '../theme';
import { Btn, Micro, Notice, Txt } from '../ui';

type Phase = 'check' | 'prepare' | 'ready' | 'shooting' | 'sending' | 'failed' | 'done' | 'stopped';
const text = (f: Failure) => LOCATION_TEXT[f.errorCode] ?? (f.errorCode === 'CAMERA_ERROR' ? '카메라를 쓰지 못했어요. 다시 눌러 주세요.' : errorText(f));

export default function WearCapture() {
  useCloseOnAccountChange();
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const { req } = useLocalSearchParams<{ req?: string }>();
  const h = useSyncExternalStore(subscribeWear, () => getHandoff(req));
  const [perm, askPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const shutter = useRef<((uri: string | null) => void) | null>(null);
  const job = useRef<PhotoJob | null>(null);
  const alive = useRef(true);
  const askedRef = useRef(false);
  const owner = useRef(getUid());
  const preparing = useRef(false);
  const sending = useRef(false);
  const shooting = useRef(false);
  const [asked, setAsked] = useState(false); // 권한을 물었는데 거절됨(화면 표시용)
  const [kept, setKept] = useState(false); // 보관 중인 사진 작업이 있음(화면 표시용, 작업 자체는 job ref)
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [phase, setPhase] = useState<Phase>('check');
  const [err, setErr] = useState<Failure | null>(null);
  const [done, setDone] = useState<Participation | null>(null);
  const [waited, setWaited] = useState(false);
  const issue = useApi<{ issue: Issue }>('getIssueDetail', { issueId: h?.targetId }, false, h?.kind !== 'ISSUE');
  const title = h?.kind === 'ROUTINE' ? '정기 관찰 지점' : (issue.data?.issue.categoryLabel ?? '체크포인트');
  const usable = handoffUsable(h, getUid(), openedAt);
  const purpose = h?.kind === 'ROUTINE' ? 'ROUTINE' : 'RECHECK';

  // 앱이 막 열렸으면(워치가 원격으로 연 경우) 보관된 요청을 처리할 때까지 잠깐 기다린다
  useEffect(() => {
    if (req) markCaptureOpen(req);
  }, [req]);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 3000);
    return () => {
      clearTimeout(t);
      alive.current = false;
      shutter.current?.(null); // 화면을 떠나면 셔터 대기를 취소로 끝낸다
    };
  }, []);

  useEffect(() => {
    if (!h) return;
    const t = setTimeout(() => { setOpenedAt(Date.now()); shutter.current?.(null); }, Math.max(0, h.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [h]);

  // 만료된 연결은 워치에도 알린다(새 Exposure·티켓을 만들지 않는다 — 서버가 정한 체크포인트만 참여할 수 있다)
  useEffect(() => {
    if (phase === 'check' && h && h.uid === getUid() && h.stage === 'PHONE_RECEIVED' && openedAt >= h.expiresAt) handoffStage(h.requestId, 'EXPIRED', { code: 'EXPOSURE_EXPIRED' });
  }, [h, phase, openedAt]);

  const setJob = (j: PhotoJob | null) => {
    job.current = j;
    setKept(!!j);
  };

  const goRun = () => (getRun() ? router.replace('/run' as never) : router.back());

  const current = () => alive.current && owner.current === getUid() && h?.uid === owner.current;
  const valid = (allowSubmitted = false) => {
    if (!current() || !h) return false;
    const run = getRun();
    if (Date.now() >= h.expiresAt || !run || run.sessionId !== h.sessionId || !['ACTIVE', 'PAUSED'].includes(run.status) || run.endAt !== null) {
      const f: Failure = { ok: false, errorCode: Date.now() >= h.expiresAt ? 'EXPOSURE_EXPIRED' : 'OUTSIDE_SESSION', details: {}, retryable: false };
      setErr(f); setPhase('stopped');
      if (f.errorCode === 'EXPOSURE_EXPIRED') handoffStage(h.requestId, 'EXPIRED', { code: f.errorCode });
      return false;
    }
    return handoffUsable(getHandoff(h.requestId), getUid(), Date.now()) || (allowSubmitted && h.stage === 'SUBMITTED');
  };

  const begin = async () => {
    if (preparing.current || !valid()) return;
    preparing.current = true;
    const hh = h!;
    setPhase('prepare');
    setErr(null);
    handoffStage(hh.requestId, 'CAMERA_OPENED');
    // 사진 앞 작업(봉인 실패 등)이 남아 있으면 그 사진으로 이어서 보낸다
    const prev = pendingJob(purpose, hh.targetId);
    if (prev && prev.uid === owner.current && prev.sessionId === hh.sessionId && prev.createdAt >= hh.createdAt) {
      setJob(prev);
      preparing.current = false;
      return submit();
    }
    const run = getRun();
    const sessionId = run && run.sessionId === hh.sessionId && (run.status === 'ACTIVE' || run.status === 'PAUSED') && run.endAt === null ? run.sessionId : undefined;
    const c = await capture(purpose, hh.targetId, undefined, sessionId, () =>
      new Promise<string | null>(res => {
        if (!valid()) return res(null);
        shutter.current = res;
        setPhase('ready');
      }),
    );
    shutter.current = null;
    preparing.current = false;
    if (!valid()) return;
    if (!c.ok) {
      if (c.errorCode === 'CAPTURE_CANCELLED') {
        handoffStage(hh.requestId, 'CANCELLED');
        return setPhase('stopped');
      }
      if (c.errorCode === 'CAMERA_PERMISSION_DENIED') handoffStage(hh.requestId, 'CAMERA_PERMISSION', { code: c.errorCode });
      setJob(needsRetake(c.errorCode) ? null : (pendingJob(purpose, hh.targetId) ?? null));
      setErr(c);
      return setPhase('failed');
    }
    setJob(c.value);
    await submit();
  };

  const submit = async () => {
    if (sending.current || !valid(true) || !job.current) return;
    const j = job.current!, hh = h!;
    if (j.uid !== owner.current || j.sessionId !== hh.sessionId) return;
    sending.current = true;
    try {
    setPhase('sending');
    setErr(null);
    const loc = await participationLoc();
    if (!valid(true)) return;
    if ('ok' in loc && !loc.ok) { setErr(loc); setPhase('failed'); return; }
    const u = await upload(j);
    if (!valid(true)) return;
    if (!u.ok) return failSend(u, j);
    markSubmitting(j);
    handoffStage(hh.requestId, 'SUBMITTED');
    const base = { ticketId: j.ticketId, ...(j.sessionId ? { sessionId: j.sessionId } : {}), exposureId: hh.exposureId };
    const r =
      hh.kind === 'ISSUE'
        ? await mutate<Participation>('submitPhotoRecheck', { ...base, issueId: hh.targetId }, 'submit:' + j.id)
        : await mutate<Participation>('submitRoutine', { ...base, missionId: hh.targetId }, 'submit:' + j.id);
    if (!current()) return;
    if (!r.ok) return failSend(r, j);
    finishJob(j);
    setJob(null);
    handoffStage(hh.requestId, 'SERVER_RESULT', { reward: rewardOf(r.value) });
    setDone(r.value);
    setPhase('done');
    void refresh('getHome', 'getMapData', 'getRiverFeed', 'getIssueDetail', 'getRoutineDetail', 'getMy', 'getRecords', 'getLedger', 'getRunDetail');
    } finally { sending.current = false; }
  };

  // 다시 쓸 수 없는 사진·서버의 확정 거절은 끝낸다. 결과가 모호한 실패는 같은 사진·같은 요청 ID로 다시 보낼 수 있게 둔다.
  const failSend = (f: Failure, j: PhotoJob) => {
    if (!current() || f.errorCode === 'ACCOUNT_CHANGED') return;
    setErr(f);
    if (needsRetake(f.errorCode) || !f.retryable) {
      finishJob(j);
      setJob(null);
      handoffStage(h!.requestId, 'FAILED', { code: f.errorCode });
      return setPhase('stopped');
    }
    setPhase('failed');
  };

  const shoot = async () => {
    if (phase !== 'ready' || shooting.current || !cam.current || !valid()) return;
    shooting.current = true;
    setPhase('shooting');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6, exif: false });
      if (valid()) shutter.current?.(pic?.uri ?? null);
      else shutter.current?.(null);
    } catch {
      if (!current()) return;
      setErr({ ok: false, errorCode: 'CAMERA_ERROR', details: {}, retryable: true });
      setPhase('ready');
    } finally { shooting.current = false; }
  };

  const cancel = () => {
    if (sending.current || !current()) return;
    if (shutter.current) return shutter.current(null);
    if (h && usable) handoffStage(h.requestId, 'CANCELLED');
    goRun();
  };

  // 카메라 권한 → 촬영 시작. 권한은 한 번만 묻고, 거절(또는 다시 물을 수 없음)이면 워치에도 ‘카메라 권한 필요’를 알린다.
  useEffect(() => {
    if (!usable || !perm || phase !== 'check') return;
    if (perm.granted) return void Promise.resolve().then(begin);
    if (askedRef.current) return;
    askedRef.current = true;
    const denied = () => {
      if (!valid()) return;
      setAsked(true);
      handoffStage(h!.requestId, 'CAMERA_PERMISSION', { code: 'CAMERA_PERMISSION_DENIED' });
    };
    if (perm.canAskAgain) void askPerm().then(p => !p.granted && denied());
    else void Promise.resolve().then(denied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, perm, phase]);

  // ---------- 화면 ----------
  const dark = { flex: 1, backgroundColor: color.black, paddingTop: inset.top + 24, paddingBottom: inset.bottom + 24, paddingHorizontal: 20, gap: 14 } as const;
  const message = (head: string, body: string) => (
    <View style={dark}>
      <StatusBar style="light" />
      <Txt w={700} s={22} c={color.white}>{head}</Txt>
      <Txt s={16} c="rgba(255,255,255,0.75)">{body}</Txt>
      <View style={{ flex: 1 }} />
      <Btn kind="white" label="운동으로 돌아가기" onPress={goRun} />
    </View>
  );

  if (phase === 'check') {
    if (!h) return waited ? message('이 촬영 요청을 찾을 수 없어요', '만료됐거나 다른 계정의 요청이에요. 운동은 계속 기록돼요.') : message('촬영 요청을 확인하고 있어요', '잠시만 기다려 주세요.');
    if (h.uid !== getUid()) return message('다른 계정의 촬영 요청이에요', '요청한 계정으로 로그인하면 이어갈 수 있어요.');
    if (openedAt >= h.expiresAt || h.stage === 'EXPIRED') return message('체크포인트 시간이 지났어요', '이번 사진은 보낼 수 없어요. 운동은 계속 기록되고 포인트는 지급되지 않아요.');
    if (!usable) return message('이미 처리한 촬영 요청이에요', '결과는 기록 탭의 참여 이력에서 볼 수 있어요.');
    if (perm && !perm.granted && asked)
      return (
        <View style={dark}>
          <StatusBar style="light" />
          <Txt w={700} s={22} c={color.white}>카메라 권한이 필요해요</Txt>
          <Txt s={16} c="rgba(255,255,255,0.75)">우이런 안에서 체크포인트를 촬영하려면 카메라를 허용해 주세요. 운동은 계속 기록돼요.</Txt>
          <View style={{ flex: 1 }} />
          <Btn kind="white" label={perm.canAskAgain ? '카메라 허용' : '설정에서 허용'} onPress={() => void (perm.canAskAgain ? askPerm() : Linking.openSettings())} />
          <Btn kind="ghost" label="사진 없이 돌아가기" onPress={cancel} />
        </View>
      );
  }
  if (phase === 'done' && done) return message('사진을 보냈어요', rewardText(done) + ' 운동은 계속 기록 중이에요.');
  if (phase === 'stopped')
    return err ? message('사진을 보내지 못했어요', text(err) + ' 운동은 계속 기록돼요.') : message('촬영을 취소했어요', '운동은 계속 기록돼요. 포인트는 지급되지 않아요.');

  const camera = phase === 'prepare' || phase === 'ready' || phase === 'shooting';
  return (
    <View style={{ flex: 1, backgroundColor: color.black }}>
      <StatusBar style="light" />
      {camera ? <CameraView ref={cam} style={{ flex: 1 }} facing="back" onMountError={() => setErr({ ok: false, errorCode: 'CAMERA_ERROR', details: {}, retryable: true })} /> : <View style={{ flex: 1 }} />}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: inset.top + 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(17,17,17,0.55)', paddingBottom: 10 }}>
        <Pressable accessibilityRole="button" onPress={cancel} hitSlop={8} style={{ minHeight: 44, minWidth: 56, justifyContent: 'center' }}>
          <Txt w={700} c={color.white}>취소</Txt>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt w={700} s={17} c={color.white} lines={1}>{title}</Txt>
          <Txt s={13} c="rgba(255,255,255,0.75)">워치에서 요청한 체크포인트 촬영</Txt>
        </View>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: inset.bottom + 20, paddingTop: 14, paddingHorizontal: 20, alignItems: 'center', gap: 12, backgroundColor: 'rgba(17,17,17,0.55)' }}>
        {err ? <Notice kind="err" text={text(err)} /> : null}
        {phase === 'prepare' ? <Micro c={color.white}>촬영 준비 중(위치 확인·촬영 티켓)</Micro> : null}
        {phase === 'sending' ? <Micro c={color.white}>사진을 보내는 중이에요. 운동은 계속 기록돼요.</Micro> : null}
        {phase === 'failed' ? (
          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <Btn kind="white" label={kept ? '같은 사진 다시 보내기' : '다시 촬영'} onPress={() => void (kept ? submit() : begin())} />
            <Btn kind="ghost" label="사진 없이 돌아가기" onPress={cancel} />
          </View>
        ) : camera ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="촬영"
            accessibilityState={{ disabled: phase !== 'ready' }}
            disabled={phase !== 'ready'}
            onPress={() => void shoot()}
            style={({ pressed }) => [{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: color.white, alignItems: 'center', justifyContent: 'center', opacity: phase === 'ready' ? 1 : 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}>
            <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: color.white }} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

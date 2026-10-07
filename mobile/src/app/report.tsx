// 현장 참여: 새 제보(간단/사진), 기존 관찰의 간단 응답·사진 재확인, 내 제보 사진 보완, 정기 관찰 사진.
// 사진은 capture.ts(티켓→촬영→봉인→업로드→READY)를 거친 ticketId만 제출한다. 포인트·조건 판단은 서버 응답을 그대로 보여준다.
// 운동 중이면 sessionId를 함께 보낸다(서버가 세션 범위를 검사한다). 사진은 촬영 때의 운동만 연결하고, 종료를 누른 뒤에는 연결하지 않는다.
import { useEffect, useState } from 'react';
import { Alert, Image, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApi, useCloseOnAccountChange, mutate, refresh } from '../session';
import { capture, finishJob, markSubmitting, needsRetake, pendingJob, resumeShot, STAGE_TEXT, sweepJobs, upload, type PhotoJob, type Purpose } from '../capture';
import { useParticipationAccess } from '../proximity';
import { participationLoc } from '../pilot-access';
import { OUTSIDE_PARTICIPATION_TEXT } from '../pilot-proximity';
import { isLoc } from '../location';
import { getRun } from '../run';
import { ready } from '../gate';
import { errorText, rewardText, type Category, type Failure, type Issue, type Participation } from '../core';
import { color, font } from '../theme';
import { Btn, LinkBtn, LoadState, Micro, Notice, Row, Rows, Screen, SecTitle, Txt } from '../ui';

type Kind = 'new' | 'quick' | 'recheck' | 'add' | 'routine';
const PURPOSE: Record<Exclude<Kind, 'quick' | 'new'>, Purpose> = { recheck: 'RECHECK', add: 'DISCOVERY_PHOTO', routine: 'ROUTINE' };
const TITLE: Record<Kind, string> = { new: '환경 제보', quick: '지금도 보여요', recheck: '사진으로 재확인', add: '내 제보 사진 보완', routine: '정기 관찰' };
const LOCATION_TEXT: Record<string, string> = {
  LOCATION_PERMISSION_DENIED: '위치 권한이 없어 참여할 수 없어요. 설정에서 위치를 허용해 주세요.',
  PRECISE_LOCATION_REQUIRED: '정확한 위치가 필요해요. 위치 권한에서 ‘정확한 위치’를 켜 주세요.',
  GPS_ACCURACY_TOO_LOW: '위치 정확도가 낮아요(30m 초과). 하늘이 보이는 곳에서 다시 시도해 주세요.',
  LOCATION_STALE: '위치를 다시 확인해야 해요. 다시 시도해 주세요.',
  REJECTED_MOCK: '가짜 위치로는 참여할 수 없어요.',
  OUTSIDE_PILOT: OUTSIDE_PARTICIPATION_TEXT,
  AMBIGUOUS_LOCATION: '어느 산책로인지 정할 수 없는 위치예요. 둑 위 산책로에서 다시 시도해 주세요.',
  WRONG_SCOPE: '이 관찰과 같은 구간에서만 참여할 수 있어요.',
  LOCATION_UNAVAILABLE: '현재 위치를 받지 못했어요. 위치 설정을 켜고 다시 시도해 주세요.',
  CAMERA_PERMISSION_DENIED: '카메라 권한이 없어 촬영할 수 없어요.',
  CAPTURE_CANCELLED: '촬영을 취소했어요.',
  PHOTO_TOO_LARGE: '사진이 5MB를 넘어요. 다시 촬영해 주세요.',
  PHOTO_NOT_JPEG: '사진 형식(JPEG)을 확인하지 못했어요. 다시 촬영해 주세요.',
  PHOTO_FILE_MISSING: '보관한 사진 파일을 찾지 못했어요. 다시 촬영해 주세요.',
  SEAL_TOO_LATE: '촬영 직후 위치를 확인하지 못했어요. 나중 위치로 대신하지 않으니 다시 촬영해 주세요.',
  CAPTURE_TICKET_EXPIRED: '촬영 가능 시간이 지났어요. 다시 촬영해 주세요.',
  PHOTO_FAILED: '사진 처리에 실패했어요. 다시 촬영해 주세요.',
  PHOTO_UPLOAD_REJECTED: '사진 업로드가 거절됐어요(촬영 후 1시간이 지났거나 촬영 확인이 끝나지 않았어요). 다시 촬영해 주세요.',
  PHOTO_PROCESSING: '사진을 처리하고 있어요. 잠시 뒤 이어서 보내 주세요.',
  CONSENT_REQUIRED: '약관 동의가 필요해요.',
  ALREADY_PARTICIPATED: '이미 참여한 관찰이에요.',
  OWN_ISSUE_RECHECK: '내가 올린 제보는 재확인할 수 없어요. 사진 보완을 이용해 주세요.',
  OBSERVATION_TOO_SOON: '조금 전에 참여했어요. 잠시 뒤 다시 참여할 수 있어요.',
  PHOTO_TOO_OLD: '촬영한 지 오래된 사진이에요. 다시 촬영해 주세요.',
  RATE_LIMITED: '오늘 새 제보 한도를 채웠어요.',
  ROUND_EXPIRED: '이번 정기 관찰 회차가 끝났어요.',
  MISSION_NOT_ACTIVE: '지금 운영하지 않는 정기 관찰이에요.',
  NOT_OWNER: '내 제보에만 사진을 보완할 수 있어요.',
  OUTSIDE_SESSION: '운동 시간 밖의 참여라 운동과 연결할 수 없어요.',
  ACCOUNT_CHANGED: '다른 계정으로 바뀌어 이 사진을 보내지 않았어요. 사진을 찍은 계정으로 다시 로그인하면 이어서 보낼 수 있어요.',
  EXPOSURE_EXPIRED: '관찰 요청 시간이 지났어요. 관찰 상세에서 직접 참여할 수 있어요.',
  INVALID_DUPLICATE_TARGET: '선택한 관찰에 더할 수 없어요. 목록을 다시 확인해 주세요.',
};
const text = (f: Failure) => LOCATION_TEXT[f.errorCode] ?? errorText(f);

function Candidate({ id, onPick }: { id: string; onPick: () => void }) {
  const q = useApi<{ issue: Issue }>('getIssueDetail', { issueId: id });
  if (!q.data) return <LoadState loading={q.loading} error={q.error} />;
  return <Row title={q.data.issue.categoryLabel ?? q.data.issue.categoryCode} sub="이 관찰에 내 사진·응답을 더해요" onPress={onPick} />;
}

export default function Report() {
  useCloseOnAccountChange();
  const router = useRouter();
  const access = useParticipationAccess();
  // exposure: 운동 중 관찰 요청(알림·알림 카드)에서 왔으면 그 요청 ID를 참여에 함께 보낸다(서버가 세션·만료를 다시 확인)
  const p = useLocalSearchParams<{ kind?: Kind; target?: string; exposure?: string }>();
  const kind: Kind = p.kind ?? 'new';
  const pilot = useApi<{ categories: Record<string, Category> }>('getPilotData');
  const [cat, setCat] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  // 앱이 꺼지기 전에 촬영·봉인한 사진이 있으면 그 사진으로 이어서 보낸다
  // 간단 응답 화면은 사진 작업을 이어받지 않는다(같은 대상의 사진 재확인 작업이 남아 있어도 사진 재확인 화면에서만)
  const [job, setJob] = useState<PhotoJob | null>(() => {
    if (p.kind === 'quick') return null;
    sweepJobs();
    return pendingJob(p.kind === 'routine' ? 'ROUTINE' : p.kind === 'add' ? 'DISCOVERY_PHOTO' : p.kind === 'recheck' ? 'RECHECK' : 'DISCOVERY', p.kind && p.kind !== 'new' ? p.target : undefined) ?? null;
  });
  const [error, setError] = useState<Failure | null>(null);
  const [done, setDone] = useState<Participation | null>(null);
  const [dups, setDups] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const run = getRun();
  const sessionId = run && (run.status === 'ACTIVE' || run.status === 'PAUSED') && run.endAt === null ? run.sessionId : undefined;
  // 만료 여부는 보낼 때 다시 본다(서버도 확인)
  const exposureOf = () => (p.exposure && run?.exposure?.id === p.exposure && Date.now() < run.exposure.expiresAt ? p.exposure : undefined);
  const here = `/report?kind=${kind}${p.target ? '&target=' + p.target : ''}`;
  const purpose: Purpose = kind === 'new' ? 'DISCOVERY' : kind === 'quick' ? 'RECHECK' : PURPOSE[kind];


  const refreshAll = () => void refresh('getHome', 'getMapData', 'getRiverFeed', 'getIssueDetail', 'getRoutineDetail', 'getMy', 'getRecords', 'getBenefits', 'getLedger');

  const submit = async (j: PhotoJob | null, resolution?: { action: 'CREATE_NEW' | 'ATTACH_EXISTING'; issueId?: string }) => {
    setError(null);
    setPhase('참여 위치 확인 중');
    const loc = await participationLoc();
    if (!isLoc(loc)) return fail(loc, j);
    const exposureId = exposureOf();
    let r;
    if (kind === 'quick' || (kind === 'new' && !j)) {
      setPhase('보내는 중');
      r =
        kind === 'quick'
          ? await mutate<Participation>('submitQuick', { issueId: p.target, loc, ...(sessionId ? { sessionId } : {}), ...(exposureId ? { exposureId } : {}) }, 'quick:' + p.target)
          : await mutate<Participation>('createIssue', { categoryCode: cat, modality: 'QUICK', pin: [loc.lat, loc.lng], loc, ...(sessionId ? { sessionId } : {}), ...(resolution ? { resolution } : {}), ...(resolution?.action === 'CREATE_NEW' ? { reason: reason.trim() } : {}) }, 'createQuick');
    } else {
      if (!j) return;
      setPhase('사진 업로드·처리 확인 중');
      const u = await upload(j);
      if (!u.ok) return fail(u, j);
      setPhase('보내는 중');
      markSubmitting(j);
      const base = { ticketId: j.ticketId, ...(j.sessionId ? { sessionId: j.sessionId } : {}), ...(exposureId && j.sessionId === run?.sessionId ? { exposureId } : {}) };
      r =
        kind === 'new'
          ? await mutate<Participation>('createIssue', { ...base, categoryCode: j.categoryCode, modality: 'PHOTO', pin: j.pin, ...(resolution ? { resolution } : {}), ...(resolution?.action === 'CREATE_NEW' ? { reason: reason.trim() } : {}) }, 'submit:' + j.id)
          : kind === 'recheck'
            ? await mutate<Participation>('submitPhotoRecheck', { ...base, issueId: p.target }, 'submit:' + j.id)
            : kind === 'add'
              ? await mutate<Participation>('addDiscoveryPhoto', { ticketId: j.ticketId, issueId: p.target }, 'submit:' + j.id)
              : await mutate<Participation>('submitRoutine', { ...base, missionId: p.target }, 'submit:' + j.id);
    }
    setPhase(null);
    if (!r.ok) {
      if (r.errorCode === 'DUPLICATE_CANDIDATES') {
        // 근처 같은 종류 제보가 있다: 사용자가 기존 관찰에 더할지, 새 제보로 남길지 고른다(내용이 바뀌면 새 요청 ID)
        setDups((r.details.candidates as string[]) ?? []);
        return;
      }
      return fail(r, j);
    }
    if (j) finishJob(j);
    setJob(null);
    setDups(null);
    setDone(r.value);
    refreshAll();
  };

  const fail = (f: Failure, j?: PhotoJob | null) => {
    setPhase(null);
    // 사진 작업에서 위치가 오래됐다는 거절은 봉인이 늦게 도착한 것: 다시 촬영 안내로 보여준다
    setError(j && f.errorCode === 'LOCATION_STALE' ? { ...f, errorCode: 'SEAL_TOO_LATE' } : f);
    if (j && needsRetake(f.errorCode)) {
      finishJob(j); // 복구할 수 없는 사진: 보관본을 지우고 새로 촬영
      setJob(null);
    }
  };

  const discard = (j: PhotoJob) =>
    Alert.alert('이 사진을 버릴까요?', '기기에 보관한 이 사진을 지워요. 아직 접수가 확인되지 않은 사진이에요.', [
      { text: '취소', style: 'cancel' },
      { text: '버리기', style: 'destructive', onPress: () => { finishJob(j); setJob(null); setError(null); } },
    ]);

  const shoot = async () => {
    if (!(await ready(here))) return;
    setError(null);
    setPhase('촬영 준비 중(위치 확인·촬영 티켓)');
    const c = await capture(purpose, kind === 'new' ? undefined : p.target, kind === 'new' ? (cat ?? undefined) : undefined, sessionId);
    if (!c.ok) {
      // 사진은 봉인 전에 이미 보관됐을 수 있다(봉인 통신 실패 등): 미리보기와 이어서 보내기·버리기를 보여준다
      fail(c);
      if (!needsRetake(c.errorCode)) setJob(pendingJob(purpose, kind === 'new' ? undefined : p.target) ?? null);
      return;
    }
    setJob(c.value);
    await submit(c.value);
  };

  useEffect(() => {
    // 카메라가 열린 사이 앱이 정리됐던 경우 Android가 보관한 촬영 결과로 이어서 봉인한다
    void resumeShot().then(r => {
      if (r?.ok) setJob(r.value);
      else if (r) setError(r);
    });
  }, []);

  const cats = Object.entries(pilot.data?.categories ?? {});
  const busy = !!phase;

  return (
    <Screen
      title={TITLE[kind]}
      close
      onClose={() => router.back()}
      foot={
        done || dups ? undefined : (
          <View style={{ flex: 1, gap: 8 }}>
            {job ? (
              <Btn kind="blue" label="사진 이어서 보내기" disabled={access.restricted} busy={busy} onPress={() => void submit(job)} />
            ) : kind === 'quick' ? (
              <Btn kind="blue" label="지금도 보여요 보내기" disabled={access.restricted} busy={busy} onPress={() => void (async () => (await ready(here)) && submit(null))()} />
            ) : (
              <>
                <Btn kind="blue" icon="flag" label="사진 찍고 보내기" busy={busy} disabled={access.restricted || (kind === 'new' && !cat)} onPress={() => void shoot()} />
                {kind === 'new' ? <Btn label="사진 없이 간단히 보내기" busy={busy} disabled={access.restricted || !cat} onPress={() => void (async () => (await ready(here)) && submit(null))()} /> : null}
              </>
            )}
            {job ? <LinkBtn label="이 사진 버리기" c={color.err} onPress={() => discard(job)} /> : null}
          </View>
        )
      }>
      {done ? (
        <View style={{ gap: 12, marginTop: 8 }}>
          <Notice kind="ok" text={done.existing ? rewardText(done) : rewardText(done)} />
          <Micro>관찰은 그때 보인 모습의 기록이에요. 기관에 자동으로 전달되지 않아요.</Micro>
          <Btn kind="ink" label="확인" onPress={() => router.back()} />
        </View>
      ) : dups ? (
        <View>
          <SecTitle first>근처에 같은 종류의 관찰이 있어요</SecTitle>
          <Rows>
            {dups.map(id => (
              <Candidate key={id} id={id} onPick={() => void submit(job, { action: 'ATTACH_EXISTING', issueId: id })} />
            ))}
          </Rows>
          <SecTitle>다른 문제라면 새 제보로</SecTitle>
          <TextInput value={reason} onChangeText={setReason} placeholder="기존 관찰과 다른 이유(필수, 200자)" maxLength={200} accessibilityLabel="새 제보 이유" style={{ minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: color.lineStrong, borderRadius: 12, backgroundColor: color.panel, fontFamily: font[400], fontSize: 16, color: color.black }} />
          <Btn label="새 제보로 남기기" disabled={access.restricted || !reason.trim() || busy} busy={busy} onPress={() => void submit(job, { action: 'CREATE_NEW' })} style={{ marginTop: 10 }} />
        </View>
      ) : (
        <>
          {access.restricted ? <Notice kind="warn" text={OUTSIDE_PARTICIPATION_TEXT} /> : null}
          {sessionId ? <Micro>운동 중 참여로 함께 기록돼요.</Micro> : null}
          {error ? (
            <View style={{ marginBottom: 8 }}>
              <Notice kind="err" text={text(error)} />
            </View>
          ) : null}
          {kind === 'new' && !job ? (
            <>
              <SecTitle first>무엇이 보이나요?</SecTitle>
              {cats.length ? (
                <Rows>
                  {cats.map(([code, c]) => (
                    <Row key={code} title={c.label} sub={c.scope === 'CORRIDOR' ? '물·하천 안' : '산책로'} onPress={() => setCat(code)} right={cat === code ? <Txt w={700} c={color.blue}>선택</Txt> : null} chev={false} />
                  ))}
                </Rows>
              ) : (
                <LoadState loading={pilot.loading} error={pilot.error} onRetry={() => void pilot.reload()} />
              )}
            </>
          ) : null}
          {job?.file ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <Image source={{ uri: job.file }} accessibilityLabel="보관 중인 촬영 사진" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: color.water }} resizeMode="cover" />
              <Txt w={700} s={15}>
                {(job.categoryCode && pilot.data?.categories[job.categoryCode]?.label) || TITLE[kind]} · {STAGE_TEXT[job.stage]}
              </Txt>
              <Micro>촬영한 사진을 기기에 보관하고 있어요. 접수가 확인되거나 직접 버릴 때까지 지우지 않아요.{job.sessionId ? ' 촬영 때 진행 중이던 운동과 함께 기록돼요.' : ''}</Micro>
            </View>
          ) : null}
          {phase ? <Micro>{phase}…</Micro> : null}
        </>
      )}
    </Screen>
  );
}

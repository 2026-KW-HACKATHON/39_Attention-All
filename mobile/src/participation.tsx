// 환경 참여 한 건의 표시(웹 obsLabel·obsTitle·rewardBadge·histRow)와 상세 시트(내 사진·적립 상태·철회).
// 철회는 확인을 받은 뒤에만 요청한다. 성공하면 기록·포인트·지도·관찰 목록을 모두 다시 받는다.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { mutate, refresh, useApi } from './session';
import { errorText, kstDateTime, kstTime, type Category, type MapData, type Observation } from './core';
import { ServerPhoto } from './photos';
import { color, font } from './theme';
import { Btn, Icon, Micro, Notice, Sheet, TextBtn, Txt } from './ui';

export function obsLabel(o: Pick<Observation, 'role' | 'modality'>) {
  if (o.role === 'ROUTINE') return '정기 관찰';
  if (o.role === 'DISCOVERY') return o.modality === 'QUICK' ? '신규 제보 · 사진 없이' : '신규 제보 · 사진';
  if (o.role === 'DISCOVERY_PHOTO') return '내 제보 사진 보완';
  return o.modality === 'QUICK' ? '현장 확인 · 간단 응답' : '현장 확인 · 사진';
}

// 참여 제목: 정기 관찰 지점 이름 또는 관찰 종류 이름(서버 자료). 모르면 일반 이름.
export function useObsTitle() {
  const pilot = useApi<{ categories: Record<string, Category> }>('getPilotData');
  const map = useApi<MapData>('getMapData');
  return (o: Observation) =>
    o.missionId ? map.data?.routines.find(r => r.id === o.missionId)?.name ?? '정기 관찰 지점' : (o.categoryCode && pilot.data?.categories[o.categoryCode]?.label) || (o.role === 'ROUTINE' ? '정기 관찰' : '환경 관찰');
}

const REASON: Record<string, string> = {
  NO_PHOTO_BASIS: '포인트 없음 · 사진 기록이 생긴 관찰부터 적립돼요',
  ALREADY_CONSUMED: '이 관찰의 포인트는 이미 받았어요',
  ALREADY_TODAY: '오늘 이미 남긴 응답이에요',
  SUBCAP: '오늘 간단 응답 포인트 한도를 채웠어요',
  DAILY_CAP: '오늘 적립 한도를 채웠어요',
  CATEGORY_NOT_REWARDED: '이 종류는 포인트가 없어요',
  QUICK_NEW_NO_POINTS: '사진 없는 제보는 포인트가 없어요',
  SUPPLEMENT_ONLY: '사진을 보완했어요 · 포인트 없음',
  LATE_PHOTO: '늦게 올린 사진이라 나만 보는 기록이 됐어요 · 포인트 없음',
  ROUTINE_DAILY_LIMIT: '정기 관찰 포인트는 하루 한도가 있어요',
};
type Tone = 'on' | 'pending' | 'gone' | 'none';
export function rewardBadge(o: Observation): { text: string; tone: Tone; note: string } {
  const x = o.reward;
  if (!x) return { text: '', tone: 'none', note: '' };
  if (x.status === 'CONFIRMED') return { text: `+${x.amount}P`, tone: 'on', note: '적립' };
  if (x.status === 'PENDING') return { text: `+${x.amount}P`, tone: 'pending', note: '검토 중' };
  if (x.status === 'EXPIRED') return { text: `${x.amount}P`, tone: 'gone', note: '기한 안에 확인되지 않아 만료' };
  if (x.status === 'REJECTED' || x.status === 'REVERSED') return { text: '0P', tone: 'gone', note: '취소됨' };
  return { text: '0P', tone: 'none', note: REASON[o.rewardReason ?? ''] ?? '포인트 없음' };
}
// 웹 .pts: 숫자 글꼴, 적립=블루, 검토 중=딥(+작은 글자), 취소·만료=취소선
export function PtsBadge({ o }: { o: Observation }) {
  const b = rewardBadge(o);
  if (!b.text) return null;
  const c = b.tone === 'on' ? color.blue : b.tone === 'pending' ? color.deep : color.sub;
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ fontFamily: font.numUpright, fontSize: 18, color: c, textDecorationLine: b.tone === 'gone' ? 'line-through' : 'none', fontVariant: ['tabular-nums'] }}>{b.text}</Text>
      {b.tone === 'pending' ? <Txt w={700} s={12} c={c}>검토 중</Txt> : null}
    </View>
  );
}
export const obsState = (o: Observation) => (o.visibility === 'HIDDEN' ? '철회됨' : o.late ? '나만 보는 기록' : '');

export function ParticipationSheet({ o, onClose }: { o: Observation | null; onClose: () => void }) {
  const router = useRouter();
  const title = useObsTitle();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  if (o && shown !== o.id) {
    setShown(o.id);
    setErr(null);
  }
  if (!o) return <Sheet open={false} onClose={onClose} title="" />;
  const b = rewardBadge(o), target = o.issueId ? '/issue/' + o.issueId : o.missionId ? '/routine/' + o.missionId : null;
  const withdraw = () =>
    Alert.alert('이 참여를 철회할까요?', '철회하면 이 참여의 포인트와 기여가 빠지고, 사진은 삭제 예약돼요. 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '철회',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setErr(null);
          const r = await mutate('withdrawContribution', { observationId: o.id }, 'withdraw:' + o.id);
          setBusy(false);
          if (!r.ok) return setErr(errorText(r));
          void refresh('getMy', 'getRecords', 'getLedger', 'getBenefits', 'getRunDetail', 'getIssueDetail', 'getRoutineDetail', 'getMapData', 'getRiverFeed', 'getHome');
          onClose();
          Alert.alert('철회했어요', '이 참여의 포인트와 기여가 빠지고 사진은 삭제 예약됐어요.');
        },
      },
    ]);
  return (
    <Sheet
      open
      onClose={onClose}
      title={title(o)}
      sub={`${obsLabel(o)} · 접수 ${kstDateTime(o.acceptedAt ?? o.observedAt)}`}
      foot={
        <>
          {target ? <Btn kind="ink" label={o.missionId ? '정기 관찰 지점 보기' : '관찰 보기'} onPress={() => { onClose(); router.push(target as never); }} /> : null}
          {o.visibility !== 'HIDDEN' ? <TextBtn danger label="참여 철회" disabled={busy} onPress={withdraw} /> : null}
        </>
      }>
      {err ? <Notice kind="err" text={err} /> : null}
      {o.modality === 'PHOTO' ? (
        <View style={{ marginBottom: 8 }}>
          <ServerPhoto own photoId={o.visibility === 'HIDDEN' ? null : o.photo?.id} takenAt={o.observedAt} height={220} emptyText={o.visibility === 'HIDDEN' ? '철회한 참여의 사진은 보여주지 않아요' : '사진 정보가 없어요'} />
          <Micro>내가 찍은 원본 사진이에요. 나만 볼 수 있어요.</Micro>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Icon name="tap" c={color.deep} />
          <Txt s={15}>사진 없이 남긴 간단 응답이에요.</Txt>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.line }}>
        <View style={{ flex: 1 }}>
          <Txt w={700}>포인트</Txt>
          <Txt s={14} c={color.sub}>{b.note || '포인트 정보 없음'}</Txt>
        </View>
        <PtsBadge o={o} />
      </View>
      {obsState(o) ? <Micro>{obsState(o)}</Micro> : null}
      <Micro>관찰 시각 {kstTime(o.observedAt)}{o.sessionId ? ' · 운동 중 참여' : ''}</Micro>
    </Sheet>
  );
}

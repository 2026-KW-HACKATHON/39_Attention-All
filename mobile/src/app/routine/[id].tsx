// 정기 관찰 지점: getRoutineDetail(회차·남은 자리·내 참여). 회차 판단은 서버 state를 그대로 쓴다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApi, useSession } from '../../session';
import { kstDateTime } from '../../core';
import { routineView } from '../../routine-view';
import { color } from '../../theme';
import { Btn, LoadState, Micro, Notice, Rows, Row, Screen, SecTitle, Txt } from '../../ui';

type R = { id: string; name: string; roundHours: number; state: { round: { id: string; start: number; end: number }; mine: string | null; accounts: number; slotsLeft: number; welcomeToday: boolean } | null };

export default function RoutineDetail() {
  const router = useRouter();
  const { auth } = useSession();
  const { id, exposure } = useLocalSearchParams<{ id: string; exposure?: string }>();
  const q = useApi<R>('getRoutineDetail', { missionId: id });
  const r = q.data;
  const participation = routineView(r?.state ?? null);
  return (
    <Screen title={r?.name ?? '정기 관찰'} onClose={() => router.back()}>
      {!r ? (
        q.error?.errorCode === 'NOT_FOUND' ? <Micro>운영하지 않는 지점이에요.</Micro> : <LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} />
      ) : (
        <View style={{ gap: 10 }}>
          <SecTitle first>같은 자리의 변화를 기록해요</SecTitle>
          <Txt s={15}>{r.roundHours}시간마다 같은 구도로 사진을 남기는 지점이에요. 현장에서 안내된 구도를 확인하고 촬영해 주세요.</Txt>
          {r.state ? (
            <>
              <Rows>
                <Row title="이번 회차" sub={`${kstDateTime(r.state.round.start)} ~ ${kstDateTime(r.state.round.end)}`} />
                <Row title="참여 현황" sub={participation.summary} />
              </Rows>
              {r.state.mine ? <Notice kind="ok" text="이번 회차에는 이미 참여했어요. 다음 회차에 다시 기록해 주세요." /> : participation.rewardLimit ? <Notice kind="warn" text="오늘 정기 관찰 적립 한도를 다 썼어요. 사진 기록은 계속 남길 수 있어요." /> : null}
            </>
          ) : auth.status !== 'in' ? (
            <Micro>로그인하면 이번 회차 참여 여부를 볼 수 있어요.</Micro>
          ) : null}
          <Btn kind="blue" label="사진으로 참여" disabled={participation.disabled} onPress={() => router.push(`/report?kind=routine&target=${r.id}${exposure ? '&exposure=' + exposure : ''}` as never)} />
          <SecTitle>촬영 전에 확인해 주세요</SecTitle>
          <Txt s={15}>사람의 얼굴이나 차량 번호가 들어가지 않도록 촬영해 주세요. 다른 장소의 사진이나 앨범 사진으로 참여할 수 없어요.</Txt>
          <Txt s={13} c={color.sub}>
            참여 가능 여부와 포인트는 보낸 뒤 서버가 알려줘요.
          </Txt>
        </View>
      )}
    </Screen>
  );
}

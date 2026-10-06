// 정기 관찰 지점: getRoutineDetail(회차·남은 자리·내 참여). 회차 판단은 서버 state를 그대로 쓴다.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApi, useSession } from '../../session';
import { kstDateTime } from '../../core';
import { color } from '../../theme';
import { Btn, LoadState, Micro, Screen, Txt } from '../../ui';

type R = { id: string; name: string; roundHours: number; state: { round: { id: string; start: number; end: number }; mine: string | null; accounts: number; slotsLeft: number; welcomeToday: boolean } | null };

export default function RoutineDetail() {
  const router = useRouter();
  const { auth } = useSession();
  const { id, exposure } = useLocalSearchParams<{ id: string; exposure?: string }>();
  const q = useApi<R>('getRoutineDetail', { missionId: id });
  const r = q.data;
  return (
    <Screen title={r?.name ?? '정기 관찰'} onClose={() => router.back()}>
      {!r ? (
        q.error?.errorCode === 'NOT_FOUND' ? <Micro>운영하지 않는 지점이에요.</Micro> : <LoadState loading={q.loading} error={q.error} onRetry={() => void q.reload()} />
      ) : (
        <View style={{ gap: 10 }}>
          <Txt s={15}>{r.roundHours}시간마다 같은 구도로 사진을 남기는 지점이에요.</Txt>
          {r.state ? (
            <Micro>
              이번 회차 {kstDateTime(r.state.round.start)}~{kstDateTime(r.state.round.end)} · 참여 {r.state.accounts}명 · 남은 자리 {r.state.slotsLeft}
              {r.state.mine ? ' · 이번 회차에 참여했어요' : ''}
            </Micro>
          ) : auth.status !== 'in' ? (
            <Micro>로그인하면 이번 회차 참여 여부를 볼 수 있어요.</Micro>
          ) : null}
          <Btn kind="blue" label="사진으로 참여" disabled={!!r.state?.mine} onPress={() => router.push(`/report?kind=routine&target=${r.id}${exposure ? '&exposure=' + exposure : ''}` as never)} />
          <Txt s={13} c={color.sub}>
            참여 가능 여부와 포인트는 보낸 뒤 서버가 알려줘요.
          </Txt>
        </View>
      )}
    </Screen>
  );
}

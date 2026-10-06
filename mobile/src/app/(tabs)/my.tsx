// 마이페이지: 포인트·혜택 관리 중심(웹 viewMy). 실제 조회: getMy(포인트·활동 요약), getSettings(이름·화면 모드·알림 선호).
// 합계는 서버가 계산한 전체 값만 쓴다(포인트 내역 일부 페이지를 더하지 않는다).
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi, useSession } from '../../session';
import { getRun } from '../../run';
import { errorText, km, welcomeText, WELCOME_TARGET, type Failure, type My, type Settings } from '../../core';
import { color, space } from '../../theme';
import { Icon, LinkBtn, LoadState, Micro, Notice, Num, Row, Rows, SecTitle, Seg, SwitchRow, Txt } from '../../ui';

export default function MyTab() {
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const { auth, mutate, refresh, signOut } = useSession();
  const my = useApi<My>('getMy', {}, true);
  const settings = useApi<Settings>('getSettings', {}, true);
  const signedIn = auth.status === 'in';

  // 탭으로 돌아올 때 개인 값을 다시 확인한다(처음 열 때는 위 조회가 이미 부른다).
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current && signedIn) {
        void my.reload();
        void settings.reload();
      }
      seen.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedIn]),
  );

  // 설정 변경: 저장 중에는 고른 값을 보여주고, 실패하면 서버 값으로 돌아가며 이유를 보여준다.
  const [pending, setPending] = useState<Partial<Pick<Settings, 'uiMode' | 'repeatObservationNotifications'>>>({});
  const [failed, setFailed] = useState<{ f: Failure; retry: () => void } | null>(null);
  const save = async (field: 'uiMode' | 'repeatObservationNotifications', value: string | boolean) => {
    if (!signedIn) return router.push({ pathname: '/login', params: { then: '/my' } });
    setFailed(null);
    setPending(p => ({ ...p, [field]: value }));
    const r = await mutate('updateSettings', { [field]: value }, 'settings.' + field);
    setPending(p => ({ ...p, [field]: undefined }));
    if (!r.ok) return setFailed({ f: r, retry: () => void save(field, value) });
    void refresh('getSettings', 'getMy', 'getHome');
  };

  const s = settings.data, m = my.data;
  const uiMode = pending.uiMode ?? s?.uiMode ?? 'DEFAULT';
  const repeat = pending.repeatObservationNotifications ?? s?.repeatObservationNotifications ?? false;
  const run = getRun();
  const unsent = run && run.status !== 'ENDED' ? run.buffer.length + run.ops.length : 0;
  const logout = () =>
    Alert.alert('로그아웃할까요?', (run && run.status !== 'ENDED' ? `진행 중인 운동이 있어요. 로그아웃하면 위치 기록을 멈춰요. 보내지 못한 기록${unsent ? `(${unsent}건)` : ''}은 기기에 보관했다가 같은 계정으로 다시 로그인하면 이어서 보내요. ` : '') + '다시 로그인하면 계정에 저장된 기록을 볼 수 있어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        onPress: async () => {
          const f = await signOut();
          if (f) Alert.alert('로그아웃하지 못했어요', '잠시 뒤 다시 시도해 주세요.');
        },
      },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ padding: space.page, paddingTop: 20 + inset.top, paddingBottom: 40 }}>
      <Txt w={700} s={28} lh={1.25} style={{ marginTop: 4, marginBottom: 18 }}>
        마이페이지
      </Txt>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingBottom: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" c={color.blue} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          {signedIn ? (
            <>
              <Txt w={700} s={18} lh={1.35} c={s?.displayName ? color.black : color.sub}>
                {s ? s.displayName || '이름 없음' : ' '}
              </Txt>
              <Txt s={13} c={color.sub}>
                {s && !s.displayName ? '이름을 정하면 여기에 보여요 · ' : ''}
                {auth.anonymous ? '로컬 테스트 계정 · Emulator' : 'Google 계정'}
              </Txt>
            </>
          ) : (
            <>
              <Txt w={700} s={18} lh={1.35}>
                둘러보는 중
              </Txt>
              <Txt s={13} c={color.sub}>
                로그인하면 포인트와 기록이 모여요
              </Txt>
            </>
          )}
        </View>
        {signedIn ? (
          s ? <LinkBtn label={s.displayName ? '수정' : '이름 정하기'} chev onPress={() => router.push('/profile')} /> : null
        ) : (
          <LinkBtn label="로그인" chev onPress={() => router.push({ pathname: '/login', params: { then: '/my' } })} />
        )}
      </View>

      {signedIn && !m ? <LoadState loading={my.loading} error={my.error} onRetry={() => void my.reload()} /> : null}
      {signedIn && m ? (
        <>
          {my.error ? <Notice kind="warn" text="최신 정보를 불러오지 못했어요. 아래는 마지막으로 받은 값이에요." /> : null}
          <PointCard m={m} />
          <SecTitle right={`전체 누적 이동 ${km(m.activity?.distanceM ?? 0)}km`}>나의 활동</SecTitle>
          <Rows>
            <Row icon="records" title="운동 기록" meta={`${m.activity?.count ?? 0}회`} onPress={() => router.navigate('/records')} />
            <Row icon="flag" title="환경 참여" meta={m.participationStats ? `${m.participationStats.total}건` : '–'} onPress={() => router.navigate('/records')} />
            <Row icon="gift" title="웰컴 혜택" meta={`${Math.min(WELCOME_TARGET, m.welcomeCount)}/${WELCOME_TARGET} · ${welcomeText(m.welcomeStatus, Math.min(WELCOME_TARGET, m.welcomeCount))}`} onPress={() => router.push('/benefits' as never)} />
          </Rows>
        </>
      ) : null}

      <SecTitle>사용 설정</SecTitle>
      <Seg label="화면 모드" value={uiMode} onChange={v => void save('uiMode', v)} options={[['DEFAULT', '일반 화면'], ['SIMPLE', '간편 화면']]} disabled={pending.uiMode !== undefined} />
      <Micro>간편 화면은 큰 글씨와 적은 선택지로 보여줘요. 포인트와 참여 조건은 같아요.</Micro>
      {signedIn ? (
        <>
          <Rows>
            <SwitchRow title="반복 관찰 알림" sub="사진을 남긴 관찰도 6시간 뒤 다시 알림 · 추가 포인트 없음" value={repeat} onChange={v => void save('repeatObservationNotifications', v)} disabled={!s || pending.repeatObservationNotifications !== undefined} />
          </Rows>
          <Micro>계정에 저장해요. 운동 중 서버가 보낸 관찰 요청은 기기 알림으로 알려요(알림 권한은 운동을 시작할 때 물어봐요. 거절하면 앱 안 안내만 보여요).</Micro>
        </>
      ) : null}
      {failed ? (
        <View style={{ marginTop: 8 }}>
          <Notice kind="err" text={errorText(failed.f)} />
          {failed.f.retryable ? <LinkBtn label="같은 내용으로 다시 시도" onPress={failed.retry} /> : null}
        </View>
      ) : null}

      <SecTitle>이용 안내</SecTitle>
      <Rows>
        <Row icon="info" title="정보 및 출처" onPress={() => router.push('/info')} />
        {signedIn ? <Row icon="logout" title="로그아웃" onPress={logout} /> : null}
      </Rows>
      <View style={{ marginTop: 28 }}>
        <Micro>우이런 · 서버 연결 개발 버전</Micro>
        {__DEV__ ? <LinkBtn label="개발용 연결 점검" chev onPress={() => router.push('/dev')} /> : null}
      </View>
    </ScrollView>
  );
}

// 포인트 카드: 확정 잔액을 크게, 검토 중은 잔액에 더하지 않고 아래 줄에 따로(웹 .pcard).
function PointCard({ m }: { m: My }) {
  const router = useRouter();
  const link = (label: string, onPress: () => void, sub?: boolean) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {sub ? <Icon name="clock" s={15} c={color.deep} /> : null}
      <Txt w={sub ? 600 : 700} s={14} c={sub ? color.deep : color.blue}>
        {label}
      </Txt>
      {sub ? null : <Icon name="chev" s={15} c={color.blue} />}
    </Pressable>
  );
  return (
    <View accessibilityLabel="내 포인트" style={{ marginTop: 4, marginBottom: 2, paddingHorizontal: 16, paddingTop: 4, borderRadius: 16, backgroundColor: color.blueSoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt w={800} s={15} c={color.deep}>
          내 포인트
        </Txt>
        {link('내역', () => router.push('/ledger'))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 12 }}>
        <Num s={56} c={color.deep}>
          {m.pointsBalance}
        </Num>
        <Txt w={800} s={18} c={color.deep}>
          P
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, borderTopWidth: 1, borderTopColor: color.deepLine }}>
        {link(`검토 중 ${m.pointsPending}P`, () => router.push({ pathname: '/ledger', params: { status: 'PENDING' } }), true)}
        {link(`사용 가능한 혜택 ${m.couponCount}장`, () => router.push('/benefits' as never))}
      </View>
    </View>
  );
}


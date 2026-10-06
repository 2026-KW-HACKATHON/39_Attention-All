// 로그인: 서버 대상은 네이티브 Google 로그인 → Firebase Auth. Emulator 대상은 로컬 테스트 계정.
// 성공하면 로그인 전 목적 화면(then)으로 돌아간다. 사용자가 취소하면 오류로 다루지 않는다.
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSession } from '../session';
import { TARGET } from '../firebase';
import type { Failure } from '../core';
import { color } from '../theme';
import { Btn, LinkBtn, Micro, Notice, Screen, Txt } from '../ui';

const LOGIN_ERRORS: Record<string, string> = {
  GOOGLE_WEB_CLIENT_ID_MISSING: 'Google 로그인 설정(웹 클라이언트 ID)이 아직 없어요. Firebase에서 Google 로그인을 켠 뒤 받은 google-services.json으로 다시 빌드해 주세요.',
  GOOGLE_DEVELOPER_ERROR: '앱 서명(SHA) 또는 패키지 이름이 Firebase에 등록된 정보와 달라요. 개발 서명 지문 등록을 확인해 주세요.',
  PLAY_SERVICES_NOT_AVAILABLE: 'Google Play 서비스가 필요해요. Play 스토어가 있는 기기나 에뮬레이터 이미지에서 시도해 주세요.',
  GOOGLE_ID_TOKEN_MISSING: 'Google에서 로그인 확인 정보를 받지 못했어요. 다시 시도해 주세요.',
  SIGN_IN_IN_PROGRESS: '로그인이 이미 진행 중이에요.',
};

export default function Login() {
  const router = useRouter();
  const { then } = useLocalSearchParams<{ then?: string }>();
  const { signIn, signingIn } = useSession();
  const [state, setState] = useState<{ cancelled?: boolean; error?: Failure }>({});

  const go = async () => {
    if (signingIn) return;
    setState({});
    const r = await signIn();
    if (r.ok) {
      router.back();
      if (then) router.navigate(then as Href);
      return;
    }
    setState('cancelled' in r ? { cancelled: true } : { error: r });
  };

  return (
    <Screen title="로그인" close onClose={() => router.back()}>
      <Txt s={16} lh={1.6} style={{ marginTop: 2, marginBottom: 14 }}>
        로그인하면 운동 기록과 환경 참여, 포인트를 모아 볼 수 있어요.
      </Txt>
      <Btn label={TARGET === 'emulator' ? '로컬 테스트 계정으로 계속' : 'Google 계정으로 계속'} onPress={() => void go()} busy={signingIn} />
      <Micro>{TARGET === 'emulator' ? '개발 PC의 Firebase Emulator에만 만들어지는 익명 테스트 계정이에요.' : 'Google 계정으로 우이런 계정 서버에 로그인해요.'}</Micro>
      {state.cancelled ? <Micro>로그인을 취소했어요.</Micro> : null}
      {state.error ? (
        <View style={{ marginTop: 8 }}>
          <Notice kind="err" text={LOGIN_ERRORS[state.error.errorCode] ?? '로그인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'} />
        </View>
      ) : null}
      <View style={{ marginTop: 8 }}>
        <LinkBtn label="둘러보기 계속" onPress={() => router.back()} c={color.blue} />
      </View>
    </Screen>
  );
}

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CardPhotoRecovery } from '../card-photo-recovery';
import { SessionProvider, useApi, useSession } from '../session';
// 운동 위치 백그라운드 작업은 앱 시작 때 최상위에서 정의돼야 한다(TaskManager 요구사항).
import '../run';
import * as Notifications from 'expo-notifications';
import { handleResponse } from '../notify';
import { CONFIG, EMULATOR_HOST, TARGET } from '../firebase';
import { consentNeeded, type Settings } from '../core';
import { color, SIMPLE_SCALE } from '../theme';
import { Micro, Scale, Txt } from '../ui';
import { dismissStoreProblem, getStoreProblems, subscribeStore } from '../store';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Gate />
    </SessionProvider>
  );
}

function Gate() {
  const { auth } = useSession();
  const settings = useApi<Settings>('getSettings', {}, true);
  if (auth.status === 'setup') return <SetupNeeded problem={auth.problem} />;
  if (auth.status === 'init') return <View style={{ flex: 1, backgroundColor: color.panel }} />;
  return (
    <Scale.Provider value={settings.data?.uiMode === 'SIMPLE' ? SIMPLE_SCALE : 1}>
      <ConsentPrompt settings={settings.data} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ presentation: 'modal' }} />
        <Stack.Screen name="consent" options={{ presentation: 'modal', gestureEnabled: false }} />
      </Stack>
      <StoreBanner />
      <NotificationRouter />
      <CardPhotoRecovery />
    </Scale.Provider>
  );
}

// 서버의 현재 동의 버전이 없으면 로그인한 계정마다 앱 실행 중 한 번 동의 화면을 연다(자동 동의하지 않는다).
// 프로필·설정 변경은 서버에서도 동의 없이 가능하므로 닫아도 그 기능은 계속 쓸 수 있다.
function ConsentPrompt({ settings }: { settings: Settings | undefined }) {
  const { auth } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (auth.status !== 'in' || pathname === '/login' || pathname === '/consent' || asked.current.has(auth.uid)) return;
    if (!consentNeeded(settings, CONFIG.consentVersion)) return;
    asked.current.add(auth.uid);
    router.push('/consent');
  }, [auth, pathname, router, settings]);
  return null;
}

// 관찰 요청 알림을 누르면 그 관찰 상세로(앱이 꺼져 있던 경우 포함). 다른 계정의 알림은 무시한다(notify.ts).
function NotificationRouter() {
  const router = useRouter();
  const { auth } = useSession();
  const res = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!res || auth.status === 'init') return; // 앱을 막 연 경우 계정 확인 뒤에 처리
    handleResponse(res, path => router.push(path as never));
    Notifications.clearLastNotificationResponse();
  }, [res, router, auth.status]);
  return null;
}

// 기기 저장 파일을 읽거나 쓰지 못했을 때(빈 상태처럼 넘기지 않는다). 손상 파일은 지우지 않고 보관해 둔다.
const STORE_WHAT = (f: string) => (f.startsWith('run') ? '운동 기록' : f.startsWith('photos') ? '사진 제보 작업' : f.startsWith('requests') ? '전송 확인 기록' : '앱 데이터');
function StoreBanner() {
  const list = useSyncExternalStore(subscribeStore, getStoreProblems);
  const inset = useSafeAreaInsets();
  const p = list[0];
  if (!p) return null;
  const text =
    p.kind === 'WRITE_FAILED'
      ? `${STORE_WHAT(p.file)}을 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요. 앱을 닫지 않으면 계속 다시 저장해요.`
      : `${STORE_WHAT(p.file)} 파일이 손상돼 읽지 못했어요. 파일은 지우지 않고 보관했어요. 서버에 저장된 내용은 그대로예요.`;
  return (
    <View accessibilityRole="alert" style={{ position: 'absolute', left: 12, right: 12, top: inset.top + 8, padding: 14, borderRadius: 14, backgroundColor: color.deep, gap: 8 }}>
      <Txt w={700} s={15} c={color.white}>
        {text}
      </Txt>
      <Pressable accessibilityRole="button" onPress={() => dismissStoreProblem(p.file)} hitSlop={8} style={{ alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' }}>
        <Txt w={700} s={15} c={color.lime}>
          확인
        </Txt>
      </Pressable>
    </View>
  );
}

// 개발 빌드 설정이 빠졌을 때만 보이는 안내. 운영 값을 임의로 만들지 않고 무엇이 빠졌는지만 알려준다.
const SETUP_TEXT = {
  APPCHECK_DEBUG_TOKEN_MISSING: '팀 테스트용 App Check 설정이 빠졌어요. 앱을 만든 담당자에게 테스트 APK를 다시 요청해 주세요.',
  TARGET_MISSING: 'mobile/.env.local에 EXPO_PUBLIC_UIRUN_TARGET=emulator 또는 firebase를 정한 뒤 Metro를 다시 시작해 주세요.',
  GOOGLE_SERVICES_MISSING: 'firebase 대상 빌드에는 mobile/google-services.json이 필요해요. 백엔드 담당자가 Android 앱을 등록한 뒤 받은 파일을 넣고 다시 빌드해 주세요.',
  PROJECT_MISMATCH: `google-services.json의 프로젝트가 ${CONFIG.projectId}가 아니에요. 올바른 파일로 바꾼 뒤 다시 빌드해 주세요.`,
  EMULATOR_IN_RELEASE: '릴리스 빌드는 로컬 Emulator에 연결할 수 없어요. EXPO_PUBLIC_UIRUN_TARGET=firebase로 다시 빌드해 주세요.',
  FIREBASE_INIT_FAILED: 'Firebase 기본 앱을 만들지 못했어요. google-services.json을 넣고 npx expo prebuild --clean 후 다시 빌드해 주세요.',
};
function SetupNeeded({ problem }: { problem: keyof typeof SETUP_TEXT }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: color.bg, gap: 12 }}>
      <Txt w={700} s={20}>
        연결 설정이 필요해요
      </Txt>
      <Txt s={16}>{SETUP_TEXT[problem]}</Txt>
      <Micro>
        코드 {problem} · 대상 {TARGET ?? '미지정'}
        {TARGET === 'emulator' ? ' · ' + EMULATOR_HOST : ''}
      </Micro>
    </View>
  );
}

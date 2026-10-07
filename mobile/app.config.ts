import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

// 앱 식별자는 여기 한 곳에서만 정한다. 팀 확정 전 잠정값이며, Firebase Android 앱 등록 전에
// 팀이 확인해야 한다(docs/mobile/HANDOFF.md). 등록 후에는 바꾸면 google-services.json도 다시 받아야 한다.
const APPLICATION_ID = 'com.attentionall.uirun';

// 백엔드 담당자가 Firebase에 Android 앱을 등록한 뒤 전달하는 파일. 없으면 Firebase 서버 연결 빌드를 만들지 않는다
// (Emulator 대상은 이 파일 없이 동작한다). 저장소 정책상 커밋하지 않는다(mobile/.gitignore).
const googleServicesPath = path.join(__dirname, 'google-services.json');
const hasGoogleServices = fs.existsSync(googleServicesPath);

type OAuthClient = { client_id?: string; client_type?: number };
type ServicesClient = {
  client_info?: { android_client_info?: { package_name?: string } };
  oauth_client?: OAuthClient[];
  services?: { appinvite_service?: { other_platform_oauth_client?: OAuthClient[] } };
};

// Google 로그인의 webClientId: Firebase가 만든 웹 클라이언트(client_type 3). 공개 식별자이며 비밀값이 아니다.
// 파일에 없으면(Google 로그인 사용 설정 전) null → 앱이 로그인 대신 설정 필요를 보여준다.
function googleWebClientId(): string | null {
  if (process.env.GOOGLE_WEB_CLIENT_ID) return process.env.GOOGLE_WEB_CLIENT_ID;
  if (!hasGoogleServices) return null;
  const json = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8')) as { client?: ServicesClient[] };
  const app = json.client?.find(c => c.client_info?.android_client_info?.package_name === APPLICATION_ID);
  const clients = [...(app?.oauth_client ?? []), ...(app?.services?.appinvite_service?.other_platform_oauth_client ?? [])];
  return clients.find(c => c.client_type === 3)?.client_id ?? null;
}

// Google Maps Android SDK 키(Google Cloud 콘솔 발급, 앱 패키지·SHA로 제한). 없으면 지도 대신 목록으로 보여준다.
const mapsKey = process.env.GOOGLE_MAPS_API_KEY || null;

const config: ExpoConfig = {
  name: '우이런',
  slug: 'uirun',
  scheme: 'uirun',
  version: '0.1.1',
  orientation: 'portrait',
  icon: './assets/brand/app-icon.png',
  userInterfaceStyle: 'light',
  android: {
    package: APPLICATION_ID,
    versionCode: 2,
    ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    ...(mapsKey ? { config: { googleMaps: { apiKey: mapsKey } } } : {}),
    adaptiveIcon: { foregroundImage: './assets/brand/adaptive-foreground.png', backgroundColor: '#FFFFFF' },
    predictiveBackGestureEnabled: false,
  },
  // iOS는 이번 완료 범위가 아니다. 등록 항목만 HANDOFF.md에 정리했다.
  ios: { bundleIdentifier: APPLICATION_ID, supportsTablet: false },
  plugins: [
    'expo-router',
    // 운동 중 화면이 꺼져도 위치를 받는 Foreground Service. 앱이 완전히 닫힌 뒤의 위치(백그라운드 위치 권한)는 요청하지 않는다.
    ['expo-location', { isAndroidForegroundServiceEnabled: true, isAndroidBackgroundLocationEnabled: false, locationWhenInUsePermission: '운동 경로 기록과 현장 참여 위치 확인에 정확한 위치를 써요.' }],
    // 현장 사진은 카메라 촬영만 받는다. 사진 기록카드의 ‘앨범에서 선택’은 Android 사진 선택기(권한 없음)를 쓰고 서버로 보내지 않는다.
    ['expo-image-picker', { cameraPermission: '환경 제보·재확인 사진을 현장에서 촬영하고, 사진 기록카드 배경을 찍어요.', photosPermission: false, microphonePermission: false }],
    // 사진 기록카드 저장만 한다(사진 읽기 권한 없음). Android 13+는 저장에 권한이 필요 없다.
    ['expo-media-library', { savePhotosPermission: '사진 기록카드를 사진 앱에 저장해요.', isAccessMediaLocationEnabled: false, granularPermissions: [] }],
    'expo-sharing',
    // 운동 중 서버가 보낸 관찰 요청만 기기 안에서 알린다(원격 푸시·FCM 없음).
    ['expo-notifications', { color: '#384BF0' }],
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/IBMPlexSansKR-Regular.ttf',
          './assets/fonts/IBMPlexSansKR-Medium.ttf',
          './assets/fonts/IBMPlexSansKR-SemiBold.ttf',
          './assets/fonts/IBMPlexSansKR-Bold.ttf',
          './assets/fonts/ArchivoNum-ExtraBold.ttf',
          './assets/fonts/ArchivoNum-ExtraBoldItalic.ttf',
        ],
      },
    ],
    // Firebase·Google 로그인 네이티브 설정은 google-services.json이 있을 때만 넣는다(이 플러그인들이 파일을 요구한다).
    // 파일이 없으면 Emulator 대상 개발 빌드만 만들 수 있다(src/firebase.ts가 JS에서 demo-uirun 앱을 만든다).
    // 파일을 넣은 뒤에는 npx expo prebuild --clean으로 네이티브 프로젝트를 다시 만든다.
    ...(hasGoogleServices ? ['@react-native-firebase/app', '@react-native-firebase/auth', '@react-native-firebase/app-check', '@react-native-google-signin/google-signin'] : []),
  ],
  extra: { applicationId: APPLICATION_ID, hasGoogleServices, hasMapsKey: !!mapsKey, googleWebClientId: googleWebClientId() },
};

export default config;

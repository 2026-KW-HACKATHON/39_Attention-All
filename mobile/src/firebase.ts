// Firebase 연결 계층. 기존 HTTPS Callable만 호출한다(Firestore 직접 접근 없음 — 서버 규칙이 차단한다).
// 순서: (서버 대상) App Check 초기화 → Auth → Functions(asia-northeast3). 토큰·응답 본문·위치는 로그로 남기지 않는다.
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { getApp, getApps, initializeApp, type FirebaseApp } from '@react-native-firebase/app';
import { initializeAppCheck, getToken, ReactNativeFirebaseAppCheckProvider, type AppCheck } from '@react-native-firebase/app-check';
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously, signInWithCredential, signOut, GoogleAuthProvider, type Auth, type User } from '@react-native-firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from '@react-native-firebase/functions';
import type { FirebaseStorage } from '@react-native-firebase/storage';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
// 백엔드가 관리하는 공개 연결 상수(projectId·리전·동의 버전)를 복사하지 않고 그대로 읽는다(metro.config.js watchFolders).
import mobileConfig from '../../backend/client/mobile-config.json';
import { toFailure, type Failure } from './core';

// Storage 네이티브 모듈은 처음 접근할 때 기본 Firebase 앱을 찾는다(google-services.json 빌드에서만 쓴다). 쓸 때 불러온다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const storageSdk = () => require('@react-native-firebase/storage') as typeof import('@react-native-firebase/storage');

export const CONFIG = mobileConfig;

// 연결 대상은 빌드 환경변수로 명시한다. 값이 없으면 어느 서버도 부르지 않고 설정 안내를 보여준다.
//  emulator: 개발 PC의 Firebase Emulator(demo-uirun). App Check 없음(서버 Emulator 함수만 강제 해제).
//  firebase: 기존 Firebase 프로젝트(uirun-92539). App Check 필수.
const rawTarget = process.env.EXPO_PUBLIC_UIRUN_TARGET;
export const TARGET: 'emulator' | 'firebase' | null = rawTarget === 'emulator' || rawTarget === 'firebase' ? rawTarget : null;
// Android Emulator에서 개발 PC는 10.0.2.2. 실기기는 PC의 LAN 주소(Emulator를 0.0.0.0에 바인딩해야 한다, mobile/README.md).
export const EMULATOR_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST || '10.0.2.2';
// Emulator 포트(auth,functions,storage). 기본은 backend/firebase.json과 같다. 검증용 격리 Emulator를 다른 포트로 띄울 때만 바꾼다.
const [AUTH_PORT, FUNCTIONS_PORT, STORAGE_PORT] = (process.env.EXPO_PUBLIC_EMULATOR_PORTS || '9099,5001,9199').split(',').map(Number);

const extra = (Constants.expoConfig?.extra ?? {}) as { applicationId?: string; hasGoogleServices?: boolean; googleWebClientId?: string | null };
export const APPLICATION_ID = extra.applicationId ?? null;

export type SetupProblem = 'TARGET_MISSING' | 'GOOGLE_SERVICES_MISSING' | 'PROJECT_MISMATCH' | 'FIREBASE_INIT_FAILED' | 'EMULATOR_IN_RELEASE' | 'APPCHECK_DEBUG_TOKEN_MISSING';
export class SetupError extends Error {
  problem: SetupProblem;
  constructor(problem: SetupProblem) {
    super(problem);
    this.problem = problem;
  }
}

type Client = {
  target: 'emulator' | 'firebase';
  app: FirebaseApp;
  auth: Auth;
  functions: Functions;
  storage: FirebaseStorage | null; // Emulator 대상은 SDK 대신 Storage Emulator 업로드 API를 쓴다(uploadEvidence)
  appCheck: AppCheck | null;
  appCheckProvider: 'debug' | 'playIntegrity' | null;
  projectId: string;
};

const EMULATOR_APP = 'uirun-emulator';
// Emulator 전용 앱 설정. 실제 프로젝트 값이 아니며 demo- 프로젝트는 외부 Firebase에 연결되지 않는다.
const EMULATOR_OPTIONS = {
  // Android SDK는 키 형식(AIza + 35자)을 검사한다. 형식만 맞춘 값이며 실제 키가 아니다(Emulator는 키를 확인하지 않는다).
  apiKey: 'AIza' + '0'.repeat(35),
  appId: '1:000000000000:android:0000000000000000',
  projectId: 'demo-uirun',
  databaseURL: 'https://demo-uirun.firebaseio.com',
  messagingSenderId: '000000000000',
  storageBucket: 'demo-uirun.appspot.com',
};

async function init(): Promise<Client> {
  if (!TARGET) throw new SetupError('TARGET_MISSING');
  // 릴리스 빌드가 로컬 Emulator(App Check 없음)를 가리키는 잘못된 조합은 시작하지 않는다.
  if (TARGET === 'emulator' && !__DEV__) throw new SetupError('EMULATOR_IN_RELEASE');
  if (TARGET === 'emulator') {
    const app = getApps().find(a => a.name === EMULATOR_APP) ?? (await initializeApp(EMULATOR_OPTIONS, EMULATOR_APP));
    const auth = getAuth(app), functions = getFunctions(app, CONFIG.functionsRegion), storage = null;
    try {
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_PORT}`);
      connectFunctionsEmulator(functions, EMULATOR_HOST, FUNCTIONS_PORT);
    } catch {
      // Fast Refresh로 다시 초기화될 때 이미 연결된 인스턴스다.
    }
    return { target: TARGET, app, auth, functions, storage, appCheck: null, appCheckProvider: null, projectId: EMULATOR_OPTIONS.projectId };
  }
  if (!extra.hasGoogleServices) throw new SetupError('GOOGLE_SERVICES_MISSING');
  let app: FirebaseApp;
  try {
    app = getApp();
  } catch {
    throw new SetupError('FIREBASE_INIT_FAILED');
  }
  if (app.options.projectId !== CONFIG.projectId) throw new SetupError('PROJECT_MISMATCH');
  // 개발·명시적인 팀 내부 설치 테스트는 등록된 debug provider, 일반 릴리스는 Play Integrity.
  // 내부 테스트 APK에는 테스트 토큰이 포함되므로 공개 배포하지 않는다.
  // 서버의 enforceAppCheck를 끄거나 우회하지 않는다. 웹 reCAPTCHA 키는 쓰지 않는다.
  const internalTest = process.env.EXPO_PUBLIC_UIRUN_INTERNAL_TEST === 'true';
  const debugAppCheck = __DEV__ || internalTest;
  if (internalTest && !process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN) throw new SetupError('APPCHECK_DEBUG_TOKEN_MISSING');
  const appCheckProvider = debugAppCheck ? 'debug' : 'playIntegrity';
  const provider = new ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    android: { provider: appCheckProvider, debugToken: debugAppCheck ? process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN || undefined : undefined },
    apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
  });
  const appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  const auth = getAuth(app), functions = getFunctions(app, CONFIG.functionsRegion), storage = storageSdk().getStorage(app);
  return { target: TARGET, app, auth, functions, storage, appCheck, appCheckProvider, projectId: app.options.projectId };
}

let ready: Promise<Client> | null = null;
export const client = () => (ready ??= init());

export async function call<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const c = await client();
  return (await httpsCallable<Record<string, unknown>, T>(c.functions, name)(payload)).data;
}

// 서버가 발급한 uploadPath에만 JPEG를 올린다(Storage 규칙이 소유자·봉인된 티켓·덮어쓰기 금지를 검사한다).
export async function uploadEvidence(uploadPath: string, localUri: string) {
  const c = await client();
  if (!c.storage) {
    // RNFB Storage Android 모듈은 기본 Firebase 앱이 없으면 쓸 수 없다(이름 붙은 Emulator 앱만 있는 경우).
    // 같은 Storage 보안 규칙을 거치는 Storage Emulator 업로드 API로 올린다(로그인 ID 토큰 사용, 로그로 남기지 않음).
    const token = await c.auth.currentUser?.getIdToken();
    if (!token) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'unauthenticated' });
    // SDK와 같은 multipart(메타데이터 contentType 포함). 단순 업로드는 규칙의 contentType 조건을 통과하지 못한다.
    const url = `http://${EMULATOR_HOST}:${STORAGE_PORT}/v0/b/${EMULATOR_OPTIONS.storageBucket}/o?name=${encodeURIComponent(uploadPath)}`;
    const boundary = 'uirun' + Date.now();
    const te = new TextEncoder(), enc = (t: string) => te.encode(t);
    const CRLF = '\r\n';
    const head = enc(['--' + boundary, 'Content-Type: application/json; charset=utf-8', '', JSON.stringify({ name: uploadPath, contentType: 'image/jpeg' }), '--' + boundary, 'Content-Type: image/jpeg', '', ''].join(CRLF));
    const photo = await new File(localUri).bytes(), tail = enc(CRLF + '--' + boundary + '--');
    const body = new Uint8Array(head.length + photo.length + tail.length);
    body.set(head, 0);
    body.set(photo, head.length);
    body.set(tail, head.length + photo.length);
    // RN fetch는 바이너리 본문을 안정적으로 보내지 못한다 → 본문을 임시 파일로 만들어 파일 업로드로 보낸다
    const tmp = new File(Paths.cache, 'upload-' + boundary + '.bin');
    tmp.create();
    tmp.write(body);
    let r;
    try {
      r = await tmp.upload(url, { httpMethod: 'POST', headers: { Authorization: 'Firebase ' + token, 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': 'multipart/related; boundary=' + boundary } });
    } finally {
      tmp.delete();
    }
    if (__DEV__ && r.status >= 300) console.warn('[uirun] Storage Emulator 업로드 응답', r.status, r.body.slice(0, 200));
    if (r.status === 403) throw Object.assign(new Error('unauthorized'), { code: 'storage/unauthorized' });
    if (r.status >= 300) throw Object.assign(new Error('upload failed'), { code: 'unavailable' });
    return;
  }
  const { putFile, ref } = storageSdk();
  await putFile(ref(c.storage, uploadPath), localUri, { contentType: 'image/jpeg' });
}

export async function watchUser(fn: (user: User | null) => void) {
  const c = await client();
  return onAuthStateChanged(c.auth, fn);
}

// 서버 대상: 네이티브 Google 로그인 → ID 토큰을 Firebase Auth credential로 교환(웹 signInWithPopup을 쓰지 않는다).
// Emulator 대상: Google 설정 없이 흐름을 시험하도록 익명 테스트 계정(웹 연결 화면의 ?emulator=1과 같다).
export type SignInResult = { ok: true } | { ok: false; cancelled: true } | Failure;
export async function signIn(): Promise<SignInResult> {
  try {
    const c = await client();
    if (c.target === 'emulator') {
      await signInAnonymously(c.auth);
      return { ok: true };
    }
    if (!extra.googleWebClientId) return { ok: false, errorCode: 'GOOGLE_WEB_CLIENT_ID_MISSING', details: {}, retryable: false };
    GoogleSignin.configure({ webClientId: extra.googleWebClientId });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (r.type === 'cancelled') return { ok: false, cancelled: true };
    if (!r.data.idToken) return { ok: false, errorCode: 'GOOGLE_ID_TOKEN_MISSING', details: {}, retryable: false };
    await signInWithCredential(c.auth, GoogleAuthProvider.credential(r.data.idToken));
    return { ok: true };
  } catch (e) {
    if (e instanceof SetupError) return { ok: false, errorCode: e.problem, details: {}, retryable: false };
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return { ok: false, cancelled: true };
      if (e.code === statusCodes.IN_PROGRESS) return { ok: false, errorCode: 'SIGN_IN_IN_PROGRESS', details: {}, retryable: false };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, errorCode: 'PLAY_SERVICES_NOT_AVAILABLE', details: {}, retryable: false };
      // Android DEVELOPER_ERROR(10): 등록한 SHA 지문·패키지명·webClientId가 맞지 않는다.
      if (String(e.code) === '10') return { ok: false, errorCode: 'GOOGLE_DEVELOPER_ERROR', details: {}, retryable: false };
    }
    return toFailure(e);
  }
}

// 다음 로그인에서 다른 Google 계정을 고를 수 있도록 Google 쪽 세션도 끊는다(계정 전환).
export async function signOutAll() {
  const c = await client();
  if (c.target === 'firebase') {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Google 세션이 이미 없으면 무시한다. Firebase 로그아웃은 계속한다.
    }
  }
  await signOut(c.auth);
}

// 개발 화면 전용: App Check 토큰 발급 가능 여부만 확인한다. 토큰 값은 반환·표시하지 않는다.
export async function appCheckStatus(): Promise<{ ok: boolean; code?: string }> {
  const c = await client();
  if (!c.appCheck) return { ok: true, code: 'EXCLUDED' };
  try {
    await getToken(c.appCheck, false);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: toFailure(e).errorCode };
  }
}

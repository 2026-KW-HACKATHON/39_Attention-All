// 운동 중 관찰 요청 OS 알림(기기 안 로컬 알림 — 원격 푸시·FCM 없음).
// - 서버가 recordMissionExposure로 보낸 요청(run.exposure)만 알린다. 앱이 대상을 만들지 않는다.
// - 운동 기록 중 알림(Foreground Service, expo-location)과 다른 채널. 잠금 화면에는 내용(위치·종류·사진)을 숨긴다(PRIVATE).
// - 알림을 누르면 관찰(또는 정기 관찰) 상세로. 만료·운동 종료·계정 전환 때 지운다.
// - ‘지금도 보여요’ 바로 응답 버튼은 관찰 요청이고, 최근 정확한 위치가 대상 근처일 때만 붙인다. 아니면 ‘앱에서 응답’만.
//   눌러도 서버가 위치·시간·중복을 다시 확인하고, 결과를 같은 알림 자리에 알린다.
// - 알림 권한이 없으면 앱 안 알림 카드·진동만 쓴다(운동은 그대로).
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getRun, subscribeRun, wearHooks, type Exposure } from './run';
import { getUid, onAccountChange } from './session';
import { quickFromExposure, nearestM } from './exposure';
import { call } from './firebase';
import { rewardText, errorText, type Issue } from './core';

const CHANNEL = 'exposure';
const CAT_QUICK = 'exposure-quick', CAT_OPEN = 'exposure-open';
const RADIUS = 40; // 서버 validationRadiusM과 같은 값(버튼 표시 판단에만 쓴다. 최종 판단은 서버)
// 즉시 알림. Android 채널은 trigger에 지정한다(content에 넣으면 expo 기본 채널로 간다 — 기기 시험에서 확인).
const TRIGGER = Platform.OS === 'android' ? { channelId: CHANNEL } : null;
type Data = { exposureId: string; kind: Exposure['kind']; targetId: string; sessionId: string; uid: string };

let ready: Promise<boolean> | null = null;
let shown: string | null = null; // 지금 떠 있는 알림(exposure id)
let expiry: ReturnType<typeof setTimeout> | null = null;

Notifications.setNotificationHandler({
  // 앱을 보고 있으면 운동 화면의 알림 카드가 같은 내용을 보여 준다
  handleNotification: async () => {
    const bg = AppState.currentState !== 'active';
    return { shouldShowBanner: bg, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  },
});

async function setup() {
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '운동 중 관찰 요청',
      description: '운동 중 근처에 확인이 필요한 관찰이 있을 때',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 150, 120, 150],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      showBadge: false,
    });
  await Notifications.setNotificationCategoryAsync(CAT_QUICK, [
    { identifier: 'QUICK', buttonTitle: '지금도 보여요', options: { opensAppToForeground: false } },
    { identifier: 'OPEN', buttonTitle: '앱에서 응답', options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(CAT_OPEN, [{ identifier: 'OPEN', buttonTitle: '앱에서 응답', options: { opensAppToForeground: true } }]);
  const cur = await Notifications.getPermissionsAsync();
  return cur.granted;
}
const ensure = () => (ready ??= setup().catch(() => false));

// 운동을 시작할 때 한 번 묻는다. 거절해도 운동·앱 안 알림은 그대로다.
export async function askNotificationPermission() {
  await ensure();
  const cur = await Notifications.getPermissionsAsync().catch(() => null);
  if (cur?.granted || cur?.canAskAgain === false) return !!cur?.granted;
  const r = await Notifications.requestPermissionsAsync().catch(() => null);
  ready = Promise.resolve(!!r?.granted);
  return !!r?.granted;
}

export async function clearExposureNotification() {
  if (expiry) clearTimeout(expiry);
  expiry = null;
  const id = shown;
  shown = null;
  if (id) await Notifications.dismissNotificationAsync(id).catch(() => {});
}

async function anchorsOf(ex: Exposure): Promise<[number, number][]> {
  if (ex.kind !== 'ISSUE') return [];
  try {
    const d = await call<{ issue: Issue }>('getIssueDetail', { issueId: ex.targetId });
    return d.issue.observationAnchors?.length ? d.issue.observationAnchors : [d.issue.anchor];
  } catch {
    return [];
  }
}

async function show(ex: Exposure, sessionId: string, uid: string) {
  shown = ex.id; // 같은 요청을 두 번 알리지 않게 먼저 표시
  if (await wearHooks.claimAlert(ex.id)) return; // 워치가 알렸다(W3). 답이 없으면 폰이 알린다
  if (!(await ensure())) return; // 권한 없음: 앱 안 알림만
  const r = getRun();
  const here = r?.last && Date.now() - r.last.measuredAt < 10000 && r.last.accuracyM <= 30 ? r.last : null;
  const d = nearestM(here, await anchorsOf(ex));
  const quick = ex.kind === 'ISSUE' && d != null && d <= RADIUS && Date.now() < ex.expiresAt;
  const data: Data = { exposureId: ex.id, kind: ex.kind, targetId: ex.targetId, sessionId, uid };
  await Notifications.scheduleNotificationAsync({
    identifier: ex.id,
    content: {
      title: ex.kind === 'ISSUE' ? '근처에 확인이 필요한 관찰이 있어요' : '정기 관찰 지점 근처예요',
      body: '운동 기록은 계속돼요. 눌러서 확인해 주세요.',
      data,
      categoryIdentifier: quick ? CAT_QUICK : CAT_OPEN,
    },
    trigger: TRIGGER,
  });
  if (shown !== ex.id) return void Notifications.dismissNotificationAsync(ex.id).catch(() => {}); // 그사이 운동이 끝났다
  if (expiry) clearTimeout(expiry);
  expiry = setTimeout(() => void clearExposureNotification(), Math.max(0, ex.expiresAt - Date.now()));
}

// 운동 상태가 바뀔 때: 새 요청이면 알리고, 끝났거나 만료됐으면 지운다
subscribeRun(() => {
  const r = getRun(), ex = r?.exposure;
  const live = r && r.status === 'ACTIVE' && ex && Date.now() < ex.expiresAt ? ex : null;
  if (!live) {
    if (shown && (!r || r.status === 'ENDING' || r.status === 'ENDED' || !ex || ex.id !== shown || Date.now() >= ex.expiresAt)) void clearExposureNotification();
    return;
  }
  if (live.id !== shown) void show(live, r!.sessionId, r!.uid);
});
onAccountChange(() => void clearExposureNotification());

// 알림 응답: 다른 계정에서 받은 알림은 처리하지 않는다. QUICK은 앱을 열지 않고 보내고 결과를 같은 자리에 알린다.
export function handleResponse(res: Notifications.NotificationResponse, open: (path: string) => void) {
  const data = res.notification.request.content.data as Partial<Data>;
  if (!data?.exposureId || data.uid !== getUid()) return;
  const path = (data.kind === 'ISSUE' ? '/issue/' : '/routine/') + data.targetId + '?exposure=' + data.exposureId;
  if (res.actionIdentifier !== 'QUICK') return open(path);
  const r = getRun();
  const ex = r?.exposure?.id === data.exposureId ? r.exposure : null;
  if (!ex || !r) return open(path);
  void quickFromExposure(ex, data.sessionId!).then(async q => {
    await ensure();
    await Notifications.scheduleNotificationAsync({
      identifier: ex.id,
      content: {
        title: q.ok ? (q.value.existing ? '오늘 이미 남긴 응답이에요' : '남겼어요') : '앱에서 응답해 주세요',
        body: q.ok ? rewardText(q.value) + ' 운동은 계속 기록 중이에요.' : errorText(q),
        data,
        categoryIdentifier: CAT_OPEN,
        },
      trigger: TRIGGER,
    }).catch(() => {});
  });
}

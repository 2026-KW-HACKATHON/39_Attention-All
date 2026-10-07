import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, AppState } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { getRun, subscribeRun } from './run';
import { useApi } from './session';
import { isLoc, preciseLoc, toLoc, type Loc } from './location';
import { participationArea, OUTSIDE_PARTICIPATION_TEXT, type PilotArea } from './pilot-proximity';
import { participationLoc } from './pilot-access';
import { errorText } from './core';

// ACTIVE 운동은 실제 수집된 run.last로 매번 판정한다. 운동 밖에서는 허용된 foreground GPS만 구독한다.
export function useParticipationAccess() {
  const router = useRouter(), focused = useIsFocused();
  const run = useSyncExternalStore(subscribeRun, getRun);
  const pilot = useApi<PilotArea>('getPilotData');
  const [local, setLocal] = useState<Loc | null>(null);
  const [watchRevision, setWatchRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const tracking = run?.status === 'ACTIVE';
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { listener.remove(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (tracking || !focused || !foreground) return;
    let alive = true, subscription: Location.LocationSubscription | undefined;
    void (async () => {
      // 화면을 보기만 할 때는 권한을 요구하지 않는다. 참여 버튼에서는 현재 위치와 권한을 확인한다.
      const permission = await Location.getForegroundPermissionsAsync();
      if (!alive || permission.status !== 'granted' || (permission.android && permission.android.accuracy !== 'fine')) return;
      const first = await preciseLoc();
      if (!alive) return;
      if (isLoc(first)) setLocal(first);
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 }, position => { if (alive) setLocal(toLoc(position)); });
      if (alive) subscription = watcher;
      else watcher.remove();
    })().catch(() => {});
    return () => { alive = false; subscription?.remove(); };
  }, [tracking, focused, foreground, watchRevision]);
  const area = participationArea(tracking ? run?.last ?? null : local, pilot.data, now);
  const check = async () => {
    const loc = await participationLoc();
    // 첫 참여 클릭에서 권한을 허용한 경우에도 이후 진입·이탈을 계속 확인한다.
    setWatchRevision(value => value + 1);
    if (isLoc(loc)) { setLocal(loc); return true; }
    Alert.alert('참여 위치 확인', loc.errorCode === 'OUTSIDE_PILOT' ? OUTSIDE_PARTICIPATION_TEXT : loc.errorCode === 'PARTICIPATION_LOCATION_UNAVAILABLE' ? '현재 위치와 우이천 참여 범위를 확인하지 못했어요. 위치를 다시 확인해 주세요.' : errorText(loc));
    return false;
  };
  const open = async (path: string) => { if (await check()) router.push(path as never); };
  return { ...area, restricted: area.status === 'outside', check, open };
}

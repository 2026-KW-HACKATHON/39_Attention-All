// 운동 시작(홈·지도 공통): 진행 중이면 그 운동으로, 아니면 로그인·동의 → 정확한 위치 → 서버 세션 생성(오프라인이면 시작하지 않는다).
import { useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { getRun, startRun, subscribeRun } from './run';
import { ready } from './gate';
import { errorText } from './core';
import { askNotificationPermission } from './notify';

const START_TEXT: Record<string, string> = {
  LOCATION_PERMISSION_DENIED: '위치 권한이 있어야 운동을 기록할 수 있어요.',
  LOCATION_UNAVAILABLE: '현재 위치를 받지 못했어요. 위치 설정을 켜고 잠시 뒤 다시 시도해 주세요.',
  LOCATION_STALE: '위치를 다시 확인해야 해요. 다시 시도해 주세요.',
  PRECISE_LOCATION_REQUIRED: '정확한 위치를 허용해 주세요.',
  GPS_ACCURACY_TOO_LOW: '위치 정확도가 낮아요(30m 초과). 하늘이 보이는 곳에서 다시 시도해 주세요.',
  OUTSIDE_PILOT: '우이천 파일럿 구간 안에서 시작할 수 있어요.',
  AMBIGUOUS_LOCATION: '어느 산책로인지 정할 수 없는 위치예요.',
  REJECTED_MOCK: '가짜 위치로는 시작할 수 없어요.',
  COURSE_MODE_NOT_SUPPORTED: '이 코스는 선택한 운동 종류를 지원하지 않아요.',
};
// 운동 시작: 진행 중이면 그 운동으로, 아니면 로그인·동의 → 정확한 위치 → 서버 세션 생성(오프라인이면 시작하지 않는다)
export function useStart() {
  const router = useRouter();
  const run = useSyncExternalStore(subscribeRun, getRun);
  const [starting, setStarting] = useState(false);
  const live = run; // 진행 중이거나, 종료가 확인됐는데 결과를 아직 보지 않은 운동
  const start = async (mode: 'RUN' | 'WALK', courseId: string | null = null) => {
    if (live) return router.push('/run' as never);
    if (!(await ready('/'))) return;
    setStarting(true);
    const r = await startRun(mode, courseId);
    setStarting(false);
    if (!r.ok) return Alert.alert('운동을 시작하지 못했어요', START_TEXT[r.errorCode] ?? (r.retryable ? '서버에 연결할 수 없어 시작하지 않았어요. 연결을 확인해 주세요.' : errorText(r)));
    router.push('/run' as never);
    void askNotificationPermission(); // 운동 중 관찰 요청 알림(거절해도 앱 안 알림으로 계속)
  };
  return { live, starting, start };
}

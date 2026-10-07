import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from './session';
import { cardPhotoFlow } from './card-photo-native';
// 카메라 실행 중 Activity가 다시 만들어져 홈으로 돌아왔으면 원래 기록카드로 복원한다.
export function CardPhotoRecovery() {
  const { auth } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (auth.status !== 'in') return;
    let alive = true;
    const recover = async () => {
      try {
        const draft = await cardPhotoFlow.recover();
        if (alive && draft) router.replace(`/card/${encodeURIComponent(draft.id)}` as never);
      } catch {
        if (alive) Alert.alert('사진 복원', '기록카드를 복원하지 못했어요. 운동 기록에서 다시 열어 주세요.');
      }
    };
    if (AppState.currentState === 'active') void recover();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void recover(); });
    return () => { alive = false; listener.remove(); };
  }, [auth.status, auth.uid, router]);
  return null;
}

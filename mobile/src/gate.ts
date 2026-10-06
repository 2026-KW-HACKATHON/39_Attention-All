// 로그인·현재 버전 동의가 필요한 행동 앞에서 확인한다. 부족하면 해당 화면을 거쳐 원래 목적지(then)로 돌아온다.
import { router } from 'expo-router';
import { call, CONFIG } from './firebase';
import { getUid } from './session';
import { consentNeeded, type Settings } from './core';

export async function ready(then: string): Promise<boolean> {
  if (!getUid()) {
    router.push({ pathname: '/login', params: { then } });
    return false;
  }
  try {
    if (consentNeeded(await call<Settings>('getSettings', {}), CONFIG.consentVersion)) {
      router.push({ pathname: '/consent', params: { then } });
      return false;
    }
  } catch {
    // 조회 실패면 서버가 실제 요청에서 CONSENT_REQUIRED로 알려준다
  }
  return true;
}

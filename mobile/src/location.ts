// 정확한 현재 위치(서버 Loc 계약: 정확도 ≤30m, 측정 후 ≤10초, precise=true, mock은 그대로 알린다).
// 대략적인 위치만 허용했으면 서버로 보내지 않고 바로 알린다. 가짜 위치를 숨기거나 값을 고치지 않는다.
import * as Location from 'expo-location';
import type { Failure } from './core';

export type Loc = { lat: number; lng: number; accuracyM: number; measuredAt: number; precise: true; mock?: true };
const fail = (errorCode: string): Failure => ({ ok: false, errorCode, details: {}, retryable: false });

export const toLoc = (p: Location.LocationObject): Loc => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  accuracyM: p.coords.accuracy ?? 9999,
  measuredAt: p.timestamp,
  precise: true,
  ...(p.mocked ? { mock: true as const } : {}),
});

export async function askPrecise(permissionPending?: (pending: boolean) => void): Promise<Failure | null> {
  let r = await Location.getForegroundPermissionsAsync();
  if (r.status !== 'granted') {
    permissionPending?.(true);
    try { r = await Location.requestForegroundPermissionsAsync(); }
    finally { permissionPending?.(false); }
  }
  if (r.status !== 'granted') return fail('LOCATION_PERMISSION_DENIED');
  if (r.android && r.android.accuracy !== 'fine') return fail('PRECISE_LOCATION_REQUIRED');
  return null;
}

export async function preciseLoc(permissionPending?: (pending: boolean) => void): Promise<Loc | Failure> {
  const denied = await askPrecise(permissionPending);
  if (denied) return denied;
  try {
    // Google 위치 정확도 동의 창은 앱이 띄우지 않는다(거절하면 요청이 실패한다). 그때는 10초 안의 최근 GPS 값을 쓴다.
    const p =
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, mayShowUserSettingsDialog: false }).catch(() => null)) ??
      (await Location.getLastKnownPositionAsync({ maxAge: 10000, requiredAccuracy: 30 }));
    if (!p) return { ok: false, errorCode: 'LOCATION_UNAVAILABLE', details: {}, retryable: true };
    const loc = toLoc(p);
    if (loc.accuracyM > 30) return fail('GPS_ACCURACY_TOO_LOW');
    return loc;
  } catch {
    return { ok: false, errorCode: 'LOCATION_UNAVAILABLE', details: {}, retryable: true };
  }
}

export const isLoc = (v: Loc | Failure): v is Loc => !('ok' in v);

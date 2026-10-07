import { call } from './firebase';
import { getUid } from './session';
import { isLoc, preciseLoc, type Loc } from './location';
import { toFailure, type Failure } from './core';
import { participationArea, type PilotArea } from './pilot-proximity';
export async function participationLoc(): Promise<Loc | Failure> {
  const uid = getUid();
  try {
    const pilot = await call<PilotArea>('getPilotData');
    const loc = await preciseLoc();
    if (getUid() !== uid) return { ok: false, errorCode: 'ACCOUNT_CHANGED', details: {}, retryable: false };
    if (!isLoc(loc)) return loc;
    if (loc.mock) return { ok: false, errorCode: 'REJECTED_MOCK', details: {}, retryable: false };
    const area = participationArea(loc, pilot, Date.now());
    if (area.status === 'inside') return loc;
    return { ok: false, errorCode: area.status === 'outside' ? 'OUTSIDE_PILOT' : 'PARTICIPATION_LOCATION_UNAVAILABLE', details: { distanceM: area.distanceM, radiusM: pilot.participationRadiusM ?? 100 }, retryable: area.status === 'unknown' };
  } catch (error) { return toFailure(error); }
}

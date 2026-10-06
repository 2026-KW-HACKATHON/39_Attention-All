// 운동 중 서버가 보낸 관찰 요청(Exposure)에 간단 응답(QUICK). 운동 화면 알림 카드와 OS 알림이 같은 규칙을 쓴다.
// 서버가 위치·시간·중복을 다시 확인한다. 앱은 정확한 현재 위치만 보내고 결과를 그대로 보여준다.
import { mutate, refresh } from './session';
import { isLoc, preciseLoc } from './location';
import { distM } from './runlogic';
import type { Participation, Result } from './core';
import type { Exposure } from './run';

export async function quickFromExposure(ex: Exposure, sessionId: string): Promise<Result<Participation>> {
  if (ex.kind !== 'ISSUE') return { ok: false, errorCode: 'INVALID_ARGUMENT', details: {}, retryable: false };
  if (Date.now() >= ex.expiresAt) return { ok: false, errorCode: 'EXPOSURE_EXPIRED', details: {}, retryable: false };
  const loc = await preciseLoc();
  if (!isLoc(loc)) return loc;
  const r = await mutate<Participation>('submitQuick', { issueId: ex.targetId, loc, exposureId: ex.id, sessionId }, 'quick:' + ex.targetId);
  if (r.ok) void refresh('getHome', 'getMapData', 'getRiverFeed', 'getIssueDetail', 'getMy', 'getRecords', 'getLedger', 'getRunDetail');
  return r;
}

// 가장 가까운 관찰 기준점까지 거리(m). 위치가 없으면 null.
export const nearestM = (here: { lat: number; lng: number } | null, anchors: [number, number][]) =>
  here && anchors.length ? Math.round(Math.min(...anchors.map(a => distM([here.lat, here.lng], a)))) : null;

import type { Loc } from './location';
export type PilotArea = { paths: { points: [number, number][] }[]; participationRadiusM?: number };
export const OUTSIDE_START_WARNING = '우이천 반경 바깥에서는 제보·재확인 등 참여 기능이 제한됩니다. 그래도 시작하시겠습니까?';
export const OUTSIDE_PARTICIPATION_TEXT = '우이천 산책로 100m 안에서 제보·재확인 등 참여 기능을 이용할 수 있어요. 운동 기록은 계속할 수 있어요.';

// 서버 validation.lineDistance와 같은 위도 기준 평면 투영. 끝점뿐 아니라 각 선분까지의 최단 거리를 잰다.
export function nearestPathDistance(loc: Pick<Loc, 'lat' | 'lng'>, paths: PilotArea['paths']): number | null {
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) return null;
  const scale = Math.cos(loc.lat * Math.PI / 180);
  let best = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      if (![...a, ...b].every(Number.isFinite)) continue;
      const ax = (a[1] - loc.lng) * 111320 * scale, ay = (a[0] - loc.lat) * 111320;
      const dx = (b[1] - a[1]) * 111320 * scale, dy = (b[0] - a[0]) * 111320;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return Number.isFinite(best) ? best : null;
}
export function participationArea(loc: Loc | null, pilot: PilotArea | undefined, now: number): { status: 'inside' | 'outside' | 'unknown'; distanceM: number | null } {
  if (!loc || !pilot || loc.mock || loc.precise !== true || !Number.isFinite(loc.accuracyM) || loc.accuracyM < 0 || loc.accuracyM > 30 || !Number.isFinite(loc.measuredAt) || now - loc.measuredAt > 10000 || loc.measuredAt - now > 2000) return { status: 'unknown', distanceM: null };
  const distanceM = nearestPathDistance(loc, pilot.paths);
  const radius = pilot.participationRadiusM ?? 100;
  if (distanceM === null || !Number.isFinite(radius) || radius <= 0) return { status: 'unknown', distanceM };
  return { status: distanceM <= radius ? 'inside' : 'outside', distanceM };
}

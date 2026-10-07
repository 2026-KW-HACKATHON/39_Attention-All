import type { LatLng } from "./core";
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
type Pin = { key: string; kind: string; at: LatLng };
const valid = (p: LatLng) =>
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 90 &&
  Math.abs(p[1]) <= 180;
export function mapRegion(points: LatLng[], pad = 1.35): Region {
  const pts = points.filter(valid);
  if (!pts.length)
    return {
      latitude: 37.618,
      longitude: 127.057,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  const a = pts.map((p) => p[0]),
    o = pts.map((p) => p[1]),
    minA = Math.min(...a),
    maxA = Math.max(...a),
    minO = Math.min(...o),
    maxO = Math.max(...o);
  return {
    latitude: (minA + maxA) / 2,
    longitude: (minO + maxO) / 2,
    latitudeDelta: Math.max(0.002, (maxA - minA) * pad),
    longitudeDelta: Math.max(0.002, (maxO - minO) * pad),
  };
}
export function routeSegments(
  track: { lat: number; lng: number; segment: number }[],
): LatLng[][] {
  const out: LatLng[][] = [];
  let previous: number | undefined,
    current: LatLng[] | null = null;
  for (const p of track) {
    const at: LatLng = [p.lat, p.lng];
    if (!valid(at)) {
      current = null;
      continue;
    }
    if (!current || p.segment !== previous) {
      current = [];
      out.push(current);
    }
    current.push(at);
    previous = p.segment;
  }
  return out;
}
export function clusterPins<T extends Pin>(
  pins: T[],
  view: Region,
  width: number,
  height: number,
): { key: string; at: LatLng; members: T[] }[] {
  const groups: {
    key: string;
    at: LatLng;
    members: T[];
    x: number;
    y: number;
  }[] = [];
  for (const p of [...pins]
    .filter((p) => valid(p.at))
    .sort((a, b) => a.key.localeCompare(b.key))) {
    const x = ((p.at[1] - view.longitude) / view.longitudeDelta) * width,
      y = ((p.at[0] - view.latitude) / view.latitudeDelta) * height;
    const g =
      width > 0 && height > 0 && p.kind === "issue"
        ? groups.find(
            (g) =>
              g.members[0].kind === "issue" &&
              Math.hypot(g.x - x, g.y - y) < 44,
          )
        : undefined;
    if (g) g.members.push(p);
    else groups.push({ key: p.key, at: p.at, members: [p], x, y });
  }
  return groups.map(({ key, at, members }) => ({ key, at, members }));
}
export function directionArrows(
  points: LatLng[],
): { at: LatLng; bearing: number }[] {
  const arrows: { at: LatLng; bearing: number }[] = [];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (!valid(a) || !valid(b)) continue;
    const dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320,
      dy = (b[0] - a[0]) * 111320,
      d = Math.hypot(dx, dy);
    if (d < 1) continue;
    distance += d;
    if (distance >= 100 || (!arrows.length && i === points.length - 1)) {
      arrows.push({
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
      });
      distance = 0;
    }
  }
  return arrows;
}

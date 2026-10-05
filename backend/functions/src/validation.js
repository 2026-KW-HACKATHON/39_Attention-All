const {
  createHash,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} = require("node:crypto");
class DomainError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}
const fail = (code, details) => {
  throw new DomainError(code, details);
};
function text(v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail("INVALID_ARGUMENT");
  return v.trim();
}
function number(v, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    fail("INVALID_ARGUMENT");
  return v;
}
function coordinate(p) {
  if (!Array.isArray(p) || p.length !== 2) fail("INVALID_ARGUMENT");
  return [number(p[0], -90, 90), number(p[1], -180, 180)];
}
function location(v, now) {
  if (!v || v.precise !== true) fail("PRECISE_LOCATION_REQUIRED");
  if (v.mock === true) fail("REJECTED_MOCK");
  const l = {
    lat: number(v.lat, -90, 90),
    lng: number(v.lng, -180, 180),
    accuracyM: number(v.accuracyM, 0, 10000),
    measuredAt: number(v.measuredAt, 0, now + 2000),
    precise: true,
  };
  if (l.accuracyM > 30) fail("GPS_ACCURACY_TOO_LOW");
  if (now - l.measuredAt > 10000) fail("LOCATION_STALE");
  return l;
}
function lineDistance(p, points) {
  const scale = Math.cos((p[0] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = [
        (points[i - 1][1] - p[1]) * 111320 * scale,
        (points[i - 1][0] - p[0]) * 111320,
      ],
      b = [
        (points[i][1] - p[1]) * 111320 * scale,
        (points[i][0] - p[0]) * 111320,
      ],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return best;
}
function nearestOnLine(point, points) {
  const scale = Math.cos((point[0] * Math.PI) / 180);
  let best = { distance: Infinity, point: null };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = (b[1] - a[1]) * scale,
      dy = b[0] - a[0];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[1] - a[1]) * scale * dx + (point[0] - a[0]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const p = [a[0] + t * dy, a[1] + t * (b[1] - a[1])],
      dist = Math.hypot((p[1] - point[1]) * scale, p[0] - point[0]);
    if (dist < best.distance) best = { distance: dist, point: p };
  }
  return best.point;
}
function match(db, l) {
  const paths = db.geometry.paths
    .map((p) => ({ ...p, d: lineDistance([l.lat, l.lng], p.points) }))
    .sort((a, b) => a.d - b.d);
  if (!paths.length) fail("PILOT_NOT_CONFIGURED");
  if (paths[0].d > 25) fail("OUTSIDE_PILOT");
  if (
    paths[1] &&
    paths[1].corridorId === paths[0].corridorId &&
    Math.abs(paths[1].d - paths[0].d) < 8
  )
    fail("AMBIGUOUS_LOCATION");
  return paths[0];
}
function scope(db, l, is, cat) {
  const p = match(db, l);
  if (cat.scope === "PATH" && is.pathSegmentId !== p.id) fail("WRONG_SCOPE");
  if (cat.scope === "CORRIDOR" && is.corridorSegmentId !== p.corridorId)
    fail("WRONG_SCOPE");
  return p;
}
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((k) => [k, canonical(x[k])]),
    );
  return x;
}
const digest = (x) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(x)))
    .digest("hex");
function pinHash(pin, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(pin, salt, 32).toString("hex") };
}
function pinValid(pin, m) {
  if (!m.pinHash) return false;
  return timingSafeEqual(
    scryptSync(pin, m.pinSalt, 32),
    Buffer.from(m.pinHash, "hex"),
  );
}
module.exports = {
  DomainError,
  fail,
  text,
  number,
  coordinate,
  location,
  match,
  scope,
  digest,
  pinHash,
  pinValid,
  lineDistance,
  nearestOnLine,
};

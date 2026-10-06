// React·Firebase에 의존하지 않는 규칙만 둔다. `npm test`(node --test)로 바로 검증한다.
// API 계약: docs/api/FRONTEND.md §1·§3·§8

export type Failure = { ok: false; errorCode: string; details: Record<string, unknown>; retryable: boolean };
export type Result<T> = { ok: true; value: T } | Failure;

// 결과가 모호한 SDK 오류: 서버가 처리했는지 알 수 없으므로 같은 clientRequestId·같은 내용으로만 다시 보낸다.
const AMBIGUOUS = new Set(['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'cancelled', 'aborted', 'resource-exhausted']);
const DOMAIN = /^[A-Z][A-Z0-9_]+$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const isFailure = (v: unknown): v is Failure => obj(v).ok === false && typeof obj(v).errorCode === 'string' && typeof obj(v).retryable === 'boolean';

// 형태 1: Firebase SDK가 throw한 오류(code=functions/…, message=서버 도메인 코드, details=부가 객체).
// 도메인 코드가 아닌 message(네트워크 문구 등)는 화면·로그로 옮기지 않는다.
export function toFailure(e: unknown): Failure {
  if (isFailure(e)) return e;
  const x = obj(e);
  const code = typeof x.code === 'string' ? x.code.replace(/^functions\//, '') : '';
  const message = typeof x.message === 'string' ? x.message : '';
  const details = obj(x.details);
  const domain = DOMAIN.test(message) ? message : typeof details.errorCode === 'string' ? details.errorCode : null;
  return {
    ok: false,
    errorCode: domain ?? (code ? code.toUpperCase().replace(/-/g, '_') : 'NETWORK'),
    details: domain ? details : {},
    retryable: !code || AMBIGUOUS.has(code),
  };
}

// 형태 2: 정상 응답 본문 안의 {ok:false,errorCode,...}. 서버가 이 응답도 요청 ID와 함께 기록하므로 확정 응답이다.
export function domainFailure(v: unknown): Failure | null {
  const r = obj(v);
  if (r.ok !== false) return null;
  return { ok: false, errorCode: typeof r.errorCode === 'string' ? r.errorCode : 'REQUEST_REJECTED', details: obj(r.details), retryable: r.retryable === true };
}

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableJson((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
}

// 변경 API의 clientRequestId: 논리 작업(slot)마다 한 번 만들고, 응답을 잃으면 같은 ID·같은 내용으로 다시 보낸다.
// 내용이 바뀌면 새 ID(이전 미확정 요청은 버린다 — 나중에 다시 보내면 새 값을 덮어쓸 수 있다). 계정이 바뀌면 모두 버린다.
// 미확정 요청(ID+내용)은 save 콜백으로 계정별 파일에 남겨 앱 재시작 뒤에도 같은 ID로 재시도한다.
export type PendingRequest = { id: string; key: string };
export class RequestTracker {
  owner: string | null = null;
  pending = new Map<string, PendingRequest>();
  newId: () => string;
  save: (uid: string, pending: Record<string, PendingRequest>) => void;
  constructor(newId: () => string, save: (uid: string, pending: Record<string, PendingRequest>) => void = () => {}) {
    this.newId = newId;
    this.save = save;
  }
  // 계정이 바뀌면 이전 계정 요청을 메모리에서 비우고, 새 계정이 남긴 요청만 불러온다.
  setOwner(uid: string | null, restored: Record<string, PendingRequest> = {}) {
    if (uid === this.owner) return;
    this.owner = uid;
    this.pending = new Map(Object.entries(restored));
  }
  private persist() {
    if (this.owner) this.save(this.owner, Object.fromEntries(this.pending));
  }
  begin(slot: string, payload: unknown): string {
    const key = stableJson(payload), cur = this.pending.get(slot);
    if (cur && cur.key === key) return cur.id;
    const id = this.newId();
    this.pending.set(slot, { id, key });
    this.persist();
    return id;
  }
  // 확정 응답(성공 또는 서버 거절)을 받았을 때만 지운다. 모호한 실패는 남겨 같은 ID로 재시도한다.
  settle(slot: string, id: string) {
    if (this.pending.get(slot)?.id === id) {
      this.pending.delete(slot);
      this.persist();
    }
  }
}

// 화면별 조회 캐시. 같은 키의 진행 중 조회는 합치고, 새로 고친 뒤나 계정이 바뀐 뒤 도착한 오래된 응답은 버린다.
export type Entry = { data?: unknown; error?: Failure; loading: boolean; at?: number; token: number; fetcher: () => Promise<unknown>; promise?: Promise<void> };

export class QueryCache {
  entries = new Map<string, Entry>();
  epoch = 0;
  listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  get = (key: string) => this.entries.get(key);
  private put(key: string, e: Entry) {
    this.entries.set(key, e);
    for (const fn of this.listeners) fn();
  }
  load(key: string, fetcher: () => Promise<unknown>, force = false): Promise<void> {
    const cur = this.entries.get(key);
    if (cur && !force && (cur.promise || cur.data !== undefined)) return cur.promise ?? Promise.resolve();
    const epoch = this.epoch, token = (cur?.token ?? 0) + 1;
    const live = () => this.epoch === epoch && this.entries.get(key)?.token === token;
    const promise = Promise.resolve().then(fetcher).then(
      data => {
        const f = domainFailure(data);
        if (live()) this.put(key, f ? { ...this.entries.get(key)!, error: f, loading: false, promise: undefined } : { data, loading: false, at: Date.now(), token, fetcher });
      },
      e => {
        if (live()) this.put(key, { ...this.entries.get(key)!, error: toFailure(e), loading: false, promise: undefined });
      },
    );
    this.put(key, { data: cur?.data, at: cur?.at, error: undefined, loading: true, token, fetcher, promise });
    return promise;
  }
  // 변경 성공 뒤 관련 조회만 다시 부른다. 이 조회가 실패해도 변경을 다시 보내지 않는다.
  refresh(match: (key: string) => boolean) {
    return Promise.all([...this.entries].filter(([k]) => match(k)).map(([k, e]) => this.load(k, e.fetcher, true)));
  }
  reset() {
    this.epoch++;
    this.entries = new Map();
    for (const fn of this.listeners) fn();
  }
}

// 페이지 목록(usePaged) 갱신 연결: 변경 성공 뒤 refresh(이름…)가 같은 API를 쓰는 열린 목록을 첫 페이지부터 다시 받게 한다.
export class PagedRegistry {
  lists = new Set<{ name: string; reload: () => void }>();
  add(name: string, reload: () => void) {
    const e = { name, reload };
    this.lists.add(e);
    return () => void this.lists.delete(e);
  }
  fire(names: string[]) {
    for (const p of [...this.lists]) if (names.includes(p.name)) p.reload();
  }
}

// ---------- 이번 단계에서 쓰는 응답 형태(FRONTEND.md §2 주요 DTO 중 화면이 읽는 필드만) ----------
export type LatLng = [number, number]; // [위도, 경도]
export type Course = { id: string; name: string; out: LatLng[]; distanceM?: number; start?: string; modes?: string[] };
export type UserSummary = { displayName: string; uiMode: 'DEFAULT' | 'SIMPLE'; repeatObservationNotifications: boolean; pointsBalance: number; pointsPending: number; welcomeStatus: string };
export type Home = { courses: Course[]; riverSummary: { currentCount: number; pastCount: number; updatedAt: number | null }; my: UserSummary | null; config: { baseDailyCap?: number; quickDailyCap?: number } };
export type My = UserSummary & {
  activity: { count: number; distanceM: number };
  participationStats?: { total: number };
  couponCount: number;
  welcomeCount: number;
  budget: { base: number; quick: number };
  activeSession: string | null;
};
export type Settings = UserSummary & { consent: { version: string; acceptedAt: number } | null };
export type Ledger = { id: string; amount: number; status: 'CONFIRMED' | 'PENDING' | 'EXPIRED' | 'REJECTED' | 'REVERSED'; label?: string; createdAt: number; expiresAt?: number };
export type Page<T> = { items: T[]; nextCursor: string | null };

export type Issue = {
  id: string; categoryCode: string; categoryLabel?: string; anchor: LatLng; observationAnchors?: LatLng[]; verificationLevel: 'NONE' | 'PEER' | 'ADMIN';
  createdAt: number; lastPhotoObservedAt: number | null; lifecycleStatus: string; eventEndsAt: number | null; availablePhotoCount: number;
  todaySignalAccountCount: number; photoObservationCount: number; visibility: string;
  publicPhoto: { id: string; takenAt: number; acceptedAt: number; publishedAt: number } | null;
};
export type Facility = { id: string; name: string; type: string; lat: number; lng: number };
export type Routine = { id: string; name: string; anchors: LatLng[]; roundHours: number; enabled: boolean };
export type MapData = { issues: Page<Issue>; facilities: Facility[]; routines: Routine[]; courses: Course[] };
export type Category = { label: string; group: string; scope: string; type: string; staleH: number; q: boolean; r: boolean };
export type News = { id: string; title: string; summary?: string; body?: string; url?: string; sourceUrl?: string; source?: string; topic?: string; status?: string; kind?: string; pub?: string | null; pubKind?: string; checked?: string | null; event?: string; publishedAt?: number; createdAt?: number };
export type Observation = {
  id: string; modality: 'QUICK' | 'PHOTO'; role: 'DISCOVERY' | 'RECHECK' | 'ROUTINE' | 'DISCOVERY_PHOTO'; issueId?: string | null; missionId?: string | null;
  categoryCode?: string; photo?: { id: string } | null; observedAt: number; acceptedAt?: number; visibility?: string; late?: boolean;
  reward: { amount: number; status: string }; points: number; pointsPending: number; rewardReason?: string; sessionId?: string;
};
export type Participation = { ok: true; saved?: boolean; existing?: boolean; created?: boolean; resultId?: string; pointsAwarded?: number; pointsPending?: number; rewardReason?: string; late?: boolean; welcomeCounted?: boolean };
export type Coupon = { id: string; rewardId: string; merchantId: string; status: 'ISSUED' | 'USE_REQUESTED' | 'USED' | 'EXPIRED' | 'REVOKED'; issuedAt: number; expiresAt: number; usedAt?: number; window?: { useSessionId: string; endsAt: number } | null };
export type Benefits = {
  user: UserSummary; welcomeCount: number; contributions: { id?: string; source?: string; createdAt?: number }[]; routineDays: string[];
  merchants: { id: string; name: string; isDemo: boolean }[]; catalog: { id?: string; title: string; condition: string; stock: number; validDays: number; merchantId: string; isDemo: boolean }[]; coupons: Coupon[];
};

// 참여 결과의 보상 사유(서버 rewardReason). 접수 성공과 포인트 지급을 구분해서 짧게 알린다.
const REWARD: Record<string, string> = {
  PAID: '포인트가 적립됐어요.',
  PENDING_REVIEW: '접수됐어요. 포인트는 검토 뒤 적립돼요.',
  QUICK_NEW_NO_POINTS: '접수됐어요. 사진 없는 새 제보는 포인트가 없어요.',
  CATEGORY_NOT_REWARDED: '접수됐어요. 이 종류는 포인트 대상이 아니에요.',
  DAILY_CAP: '접수됐어요. 오늘 적립 한도를 채워서 포인트는 없어요.',
  SUBCAP: '접수됐어요. 오늘 간단 응답 한도를 채워서 포인트는 없어요.',
  ALREADY_TODAY: '오늘 이미 남긴 응답이에요. 새로 기록하지 않았어요.',
  LATE_PHOTO: '접수됐어요. 늦게 올린 사진이라 나만 보는 기록이 됐어요.',
  NO_PHOTO_BASIS: '접수됐어요. 사진 근거가 없어 포인트는 없어요.',
  ROUTINE_DAILY_LIMIT: '접수됐어요. 오늘 정기 관찰 한도를 채웠어요.',
  SUPPLEMENT_ONLY: '보완 사진으로 접수됐어요.',
  ALREADY_CONSUMED: '이미 반영된 참여예요.',
};
export function rewardText(r: Participation) {
  const base = REWARD[r.rewardReason ?? ''] ?? '접수됐어요.';
  return r.pointsAwarded ? `${base} +${r.pointsAwarded}P` : base;
}
export const ROLE_LABEL: Record<string, string> = { DISCOVERY: '새 제보', RECHECK: '재확인', ROUTINE: '정기 관찰', DISCOVERY_PHOTO: '사진 보완' };
// 현재 관찰: 공개 OPEN이고 종류별 사진 유효 시간 안(서버 riverSummary와 같은 규칙). 지난 기록은 회색으로만 표시한다.
export const issueCurrent = (i: Issue, staleH: number, now = Date.now()) =>
  i.lifecycleStatus === 'OPEN' && !(i.eventEndsAt && now >= i.eventEndsAt) && now - (i.lastPhotoObservedAt || i.createdAt) <= staleH * 3600000;
export const pace = (ms: number, m: number) => {
  if (m < 10) return '–';
  const s = Math.round(ms / 1000 / (m / 1000));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
};
export const dur = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
};

// ---------- 표시 규칙 (프로토타입과 같은 값) ----------
export const NAME_MAX = 30; // 서버 updateProfile: trim 후 Unicode 문자 30자, 빈 문자열은 이름 초기화

export function checkName(raw: string) {
  const value = raw.trim(), length = [...value].length;
  return { value, length, ok: length <= NAME_MAX };
}

export const consentNeeded = (settings: { consent?: { version?: string } | null } | undefined, version: string) =>
  !!settings && settings.consent?.version !== version;

export const deg = (v: number) => {
  const n = Math.round(v) || 0;
  return n < 0 ? '−' + -n : String(n);
};

// 날짜·시각 표시는 KST 기준(서버 집계 기준과 같다). Hermes Intl 시간대 지원 여부와 무관하게 계산한다.
const KST = 9 * 3600000;
export const kstTime = (t: number) => new Date(t + KST).toISOString().slice(11, 16);
export const kstDateTime = (t: number) => {
  const s = new Date(t + KST).toISOString();
  return +s.slice(5, 7) + '.' + +s.slice(8, 10) + ' ' + s.slice(11, 16);
};
export const km = (m: number) => (m / 1000).toFixed(2);

const WMO: Record<number, string> = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 56: '어는 이슬비', 57: '어는 이슬비',
  61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '어는 비', 71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈', 80: '소나기', 81: '소나기', 82: '강한 소나기',
  85: '눈 소나기', 86: '눈 소나기', 95: '뇌우', 96: '우박 동반 뇌우', 99: '우박 동반 뇌우',
};
export const wxLabel = (code: number | null) => (code == null ? '날씨 정보 없음' : WMO[code] ?? '날씨 코드 ' + code);
export function wxIcon(code: number | null, isDay: number | null) {
  if (code == null) return 'wx-cloud';
  if (code >= 95) return 'wx-storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'wx-snow';
  if (code >= 51) return 'wx-rain';
  if (code === 45 || code === 48) return 'wx-fog';
  if (code === 3) return 'wx-cloud';
  if (code >= 1) return isDay === 0 ? 'wx-cloud-moon' : 'wx-cloud-sun';
  return isDay === 0 ? 'wx-moon' : 'wx-sun';
}
// 환경부 등급 구간(참고). 값이 없으면 null — 0이나 ‘좋음’으로 바꾸지 않는다.
export function pmGrade(kind: 'pm10' | 'pm2_5', v: number | null) {
  if (v == null) return null;
  const cut = kind === 'pm10' ? [30, 80, 150] : [15, 35, 75];
  return v <= cut[0] ? '좋음' : v <= cut[1] ? '보통' : v <= cut[2] ? '나쁨' : '매우 나쁨';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type Weather = {
  status: 'ok' | 'stale' | 'error';
  forecast: { current?: Record<string, unknown>; current_units?: Record<string, string> } | null;
  air: { current?: Record<string, unknown>; current_units?: Record<string, string> } | null;
  fetchedAt?: number;
  source?: string;
  isModelEstimate?: boolean;
};

// getWeather 응답 → 표시값. status=error거나 현재 기온이 없으면 none(만들어 채우지 않는다).
// 단위는 응답의 current_units를 따른다(서버는 바람을 m/s로 요청한다). 값이 없는 항목은 ‘–’.
export function weatherView(w: Weather | undefined) {
  const cur = w?.forecast?.current, units = w?.forecast?.current_units ?? {};
  const temp = num(cur?.temperature_2m);
  if (!w || w.status === 'error' || temp == null) return null;
  const code = num(cur?.weather_code), isDay = num(cur?.is_day);
  const feel = num(cur?.apparent_temperature), wind = num(cur?.wind_speed_10m), hum = num(cur?.relative_humidity_2m);
  const windUnit = units.wind_speed_10m === 'km/h' ? 'km/h' : 'm/s';
  const air = w.air?.current, airUnit = w.air?.current_units?.pm10 ?? 'μg/m³';
  return {
    stale: w.status === 'stale',
    fetchedAt: num(w.fetchedAt),
    temp: deg(temp),
    tempExact: temp.toFixed(1),
    label: wxLabel(code),
    icon: wxIcon(code, isDay),
    sub: ['체감 ' + (feel == null ? '–' : deg(feel) + '°'), '바람 ' + (wind == null ? '–' : wind.toFixed(1) + windUnit), '습도 ' + (hum == null ? '–' : Math.round(hum) + '%')],
    precipitation: num(cur?.precipitation),
    pm10: num(air?.pm10),
    pm25: num(air?.pm2_5),
    airUnit,
    source: w.source ?? null,
    isModelEstimate: w.isModelEstimate === true,
  };
}

// 코스 모양 미리보기 경로(웹 routeSvg와 같은 투영: 위도 보정 등거리, 비율 유지, 가운데 정렬)
export function routePath(pts: LatLng[], w: number, h: number, pad: number) {
  return pts.length < 2 ? '' : linePath(pts, projector(pts, w, h, pad));
}
// fit 점들이 w×h 안에 꽉 차게 들어가는 투영(다른 선·점도 같은 투영으로 그린다)
export function projector(fit: LatLng[], w: number, h: number, pad: number) {
  const k = Math.cos(((fit[0]?.[0] ?? 37.6) * Math.PI) / 180);
  const xs = fit.map(p => p[1] * k), ys = fit.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (h - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  return (p: LatLng): [number, number] => [(p[1] * k - minX) * s + ox, (-p[0] - minY) * s + oy];
}
export const linePath = (pts: LatLng[], f: (p: LatLng) => [number, number]) =>
  'M' + pts.map(p => f(p).map(v => v.toFixed(1)).join(' ')).join('L');

export const WELCOME_TARGET = 3;
export function welcomeText(status: string | undefined, n: number) {
  const m: Record<string, string> = {
    LOCKED: '사진 기여 ' + Math.max(0, WELCOME_TARGET - n) + '회 더 필요해요',
    PENDING_ADMIN: '운영자 확인 중',
    APPROVED: '받을 수 있어요',
    ISSUED: '받았어요',
    SOLD_OUT: '수량이 소진됐어요',
  };
  return m[status ?? 'LOCKED'] ?? '확인 중';
}

// 사용자에게 보여줄 오류 문구. 특정 코드 문구가 없으면 일반 재확인 문구(§8).
// 계정 상태 문구는 조회·저장 공통, 연결 문구는 저장(결과 모호)과 조회(다시 불러오기)를 구분한다.
const ACCOUNT_TEXT: Record<string, string> = {
  UNAUTHENTICATED: '로그인이 필요해요. 다시 로그인해 주세요.',
  PERMISSION_DENIED: '이 기능을 쓸 권한이 없어요.',
  ACCOUNT_DELETING: '계정 삭제를 처리하고 있어요.',
};
const SAVE_TEXT: Record<string, string> = {
  CONSENT_REQUIRED: '약관 동의가 필요해요.',
  INVALID_ARGUMENT: '입력값을 확인해 주세요.',
  REQUEST_CONFLICT: '같은 요청이 다른 내용으로 전송됐어요. 다시 시도해 주세요.',
  SERVER_ERROR: '서버에서 문제가 생겼어요. 저장 여부를 알 수 없어 같은 내용으로 다시 시도할 수 있어요.',
};
const AMBIGUOUS_SAVE = '연결이 불안정해요. 저장 여부를 알 수 없어 같은 내용으로 다시 시도할 수 있어요.';
export function errorText(f: Failure, kind: 'save' | 'load' = 'save') {
  const known = ACCOUNT_TEXT[f.errorCode] ?? (kind === 'save' ? SAVE_TEXT[f.errorCode] : null);
  if (known) return known;
  // 결과가 모호한 실패(SDK가 internal·unknown 등으로만 알려준 경우 포함)는 저장 실패로 단정하지 않는다.
  if (kind === 'save') return f.retryable ? AMBIGUOUS_SAVE : '처리하지 못했어요. 잠시 뒤 다시 확인해 주세요.';
  return f.retryable ? '연결이 불안정해 불러오지 못했어요. 다시 시도해 주세요.' : '정보를 불러오지 못했어요.';
}

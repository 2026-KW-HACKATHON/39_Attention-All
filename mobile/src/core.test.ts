// node --test src/core.test.ts (Node 22.18+/24: TypeScript 타입 제거 실행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryCache, RequestTracker, checkName, consentNeeded, deg, domainFailure, errorText, kstTime, stableJson, toFailure, weatherView } from './core.ts';

test('SDK 오류: 서버 도메인 코드만 꺼내고 결과가 모호한 오류만 재시도 대상', () => {
  const consent = toFailure(Object.assign(new Error('CONSENT_REQUIRED'), { code: 'functions/failed-precondition', details: { a: 1 } }));
  assert.deepEqual(consent, { ok: false, errorCode: 'CONSENT_REQUIRED', details: { a: 1 }, retryable: false });
  const server = toFailure(Object.assign(new Error('SERVER_ERROR'), { code: 'internal' }));
  assert.equal(server.errorCode, 'SERVER_ERROR');
  assert.equal(server.retryable, true);
  const network = toFailure(new Error('Network request failed: token=secret'));
  assert.equal(network.errorCode, 'NETWORK');
  assert.equal(network.retryable, true);
  assert.equal(JSON.stringify(network).includes('secret'), false);
  const appCheck = toFailure(Object.assign(new Error('Unauthenticated'), { code: 'unauthenticated', details: { token: 'private' } }));
  assert.deepEqual(appCheck, { ok: false, errorCode: 'UNAUTHENTICATED', details: {}, retryable: false });
});

test('정상 응답 안의 {ok:false}도 실패이며, ok:true나 일반 조회 응답은 실패가 아니다', () => {
  assert.deepEqual(domainFailure({ ok: false, errorCode: 'DAILY_CAP', details: { cap: 30 } }), { ok: false, errorCode: 'DAILY_CAP', details: { cap: 30 }, retryable: false });
  assert.equal(domainFailure({ ok: true, displayName: 'a' }), null);
  assert.equal(domainFailure({ courses: [] }), null);
  assert.equal(domainFailure(null), null);
});

test('요청 ID: 같은 작업·같은 내용은 재사용, 내용이 바뀌거나 확정되면 새 ID, 계정이 바뀌면 모두 폐기', () => {
  const t = new RequestTracker(randomUUID);
  t.setOwner('A');
  const first = t.begin('profile', { displayName: '가' });
  assert.equal(t.begin('profile', { displayName: '가' }), first, '응답을 잃은 재시도는 같은 ID');
  const changed = t.begin('profile', { displayName: '나' });
  assert.notEqual(changed, first, '내용이 바뀌면 새 ID');
  assert.equal(t.begin('settings', { uiMode: 'SIMPLE' }) !== changed, true, '작업이 다르면 별도 ID');
  t.settle('profile', changed);
  assert.notEqual(t.begin('profile', { displayName: '나' }), changed, '확정 응답 뒤 같은 내용을 다시 저장하면 새 작업');
  const pending = t.begin('consent', { version: 'v' });
  t.setOwner('B');
  assert.notEqual(t.begin('consent', { version: 'v' }), pending, '이전 계정의 미확정 요청 ID를 새 계정에서 쓰지 않는다');
  assert.equal(stableJson({ b: 1, a: [2, { d: 3, c: undefined }] }), stableJson({ a: [2, { d: 3 }], b: 1 }));
});

const later = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

test('조회 캐시: 진행 중 같은 조회는 합치고, 새로 고친 뒤 늦게 온 이전 응답은 화면을 덮지 않는다', async () => {
  const cache = new QueryCache();
  let calls = 0;
  const first = later<unknown>();
  const p1 = cache.load('A|getMy', () => { calls++; return first.promise; });
  const p2 = cache.load('A|getMy', () => { calls++; return Promise.resolve('dup'); });
  await Promise.resolve();
  assert.equal(calls, 1, '중복 조회 없음');
  const second = later<unknown>();
  const p3 = cache.load('A|getMy', () => second.promise, true);
  second.resolve({ pointsBalance: 20 });
  await p3;
  first.resolve({ pointsBalance: 10 });
  await Promise.all([p1, p2]);
  assert.deepEqual(cache.get('A|getMy')!.data, { pointsBalance: 20 });
});

test('조회 캐시: 계정 전환 후 이전 계정 응답은 버리고, 실패는 이전 값을 지우지 않는다', async () => {
  const cache = new QueryCache();
  await cache.load('A|getMy', async () => ({ pointsBalance: 5 }));
  const slow = later<unknown>();
  const p = cache.load('A|getMy', () => slow.promise, true);
  cache.reset();
  slow.resolve({ pointsBalance: 99 });
  await p;
  assert.equal(cache.get('A|getMy'), undefined, '전환 뒤 이전 계정 응답 반영 안 함');
  await cache.load('B|getMy', async () => ({ pointsBalance: 1 }));
  await cache.load('B|getMy', async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); }, true);
  const e = cache.get('B|getMy')!;
  assert.deepEqual(e.data, { pointsBalance: 1 });
  assert.equal(e.error!.errorCode, 'UNAVAILABLE');
  await cache.load('B|getSettings', async () => ({ ok: false, errorCode: 'ACCOUNT_DELETING' }));
  assert.equal(cache.get('B|getSettings')!.error!.errorCode, 'ACCOUNT_DELETING', '정상 응답 안의 거절도 성공으로 표시하지 않음');
  assert.equal(cache.get('B|getSettings')!.data, undefined);
});

test('변경 뒤 갱신: 관련 조회만 다시 부른다', async () => {
  const cache = new QueryCache();
  let n = 0;
  await cache.load('A|getSettings|{}', async () => ({ uiMode: 'DEFAULT', n: n++ }));
  await cache.load('A|getHome|{}', async () => ({ courses: [] }));
  let homeCalls = 0;
  cache.entries.get('A|getHome|{}')!.fetcher = async () => { homeCalls++; return { courses: [] }; };
  await cache.refresh(k => k.includes('|getSettings|'));
  assert.equal((cache.get('A|getSettings|{}')!.data as { n: number }).n, 1);
  assert.equal(homeCalls, 0);
});

test('이름: 서버와 같은 기준(trim 후 Unicode 문자 30자, 빈 값 허용)', () => {
  assert.deepEqual(checkName('  우이천  '), { value: '우이천', length: 3, ok: true });
  assert.equal(checkName('').ok, true);
  assert.equal(checkName('🏃'.repeat(30)).ok, true, '이모지 30개는 UTF-16으로는 60이지만 허용');
  assert.equal(checkName('가'.repeat(31)).ok, false);
});

test('동의: 서버 현재 버전과 다르거나 없으면 필요, 설정을 아직 못 받았으면 판단하지 않음', () => {
  assert.equal(consentNeeded({ consent: null }, 'v2-2026-10'), true);
  assert.equal(consentNeeded({ consent: { version: 'v1' } }, 'v2-2026-10'), true);
  assert.equal(consentNeeded({ consent: { version: 'v2-2026-10' } }, 'v2-2026-10'), false);
  assert.equal(consentNeeded(undefined, 'v2-2026-10'), false);
});

test('날씨: 실패·기온 없음은 표시하지 않고, 지연은 지연으로, 빠진 항목은 –', () => {
  assert.equal(weatherView({ status: 'error', forecast: null, air: null }), null);
  assert.equal(weatherView({ status: 'ok', forecast: { current: { weather_code: 3 } }, air: null }), null);
  const v = weatherView({ status: 'stale', fetchedAt: Date.UTC(2026, 9, 5, 3, 7), forecast: { current: { temperature_2m: -0.4, weather_code: 61, is_day: 1, wind_speed_10m: 2.345 }, current_units: { wind_speed_10m: 'm/s' } }, air: { current: { pm10: 41, pm2_5: null }, current_units: { pm10: 'μg/m³' } } })!;
  assert.equal(v.stale, true);
  assert.equal(v.temp, '0', '−0을 만들지 않는다');
  assert.deepEqual(v.sub, ['체감 –', '바람 2.3m/s', '습도 –']);
  assert.equal(v.icon, 'wx-rain');
  assert.equal(v.pm25, null, '대기질 누락은 0이 아니다');
  assert.equal(kstTime(v.fetchedAt!), '12:07');
  assert.equal(deg(-3.6), '−4');
});

test('오류 문구: 알 수 없는 코드는 일반 문구로, 네트워크 오류는 저장 실패로 단정하지 않는다', () => {
  assert.match(errorText({ ok: false, errorCode: 'SOMETHING_NEW', details: {}, retryable: false }), /다시 확인/);
  assert.match(errorText({ ok: false, errorCode: 'NETWORK', details: {}, retryable: true }), /저장 여부를 알 수 없어/);
  // 웹 SDK는 응답 유실을 internal(message 'internal')로 알려준다(웹 미리보기에서 확인)
  assert.match(errorText(toFailure(Object.assign(new Error('internal'), { code: 'functions/internal' }))), /저장 여부를 알 수 없어/);
  // 조회 실패는 저장 문구를 쓰지 않는다
  assert.match(errorText(toFailure(new Error('Failed to fetch')), 'load'), /불러오지 못했어요/);
  assert.equal(errorText({ ok: false, errorCode: 'ACCOUNT_DELETING', details: {}, retryable: false }, 'load'), '계정 삭제를 처리하고 있어요.');
});

test('요청 ID는 계정별로 저장되어 앱 재시작 뒤에도 같은 작업·같은 내용이면 같은 ID를 쓴다', () => {
  const disk: Record<string, unknown> = {};
  const save = (uid: string, v: unknown) => (disk[uid] = structuredClone(v));
  const a = new RequestTracker(randomUUID, save);
  a.setOwner('A');
  const id = a.begin('submit:job1', { ticketId: 't1' });
  // 재시작: 새 객체가 파일에서 복원
  const b = new RequestTracker(randomUUID, save);
  b.setOwner('A', disk.A as Record<string, { id: string; key: string }>);
  assert.equal(b.begin('submit:job1', { ticketId: 't1' }), id);
  assert.notEqual(b.begin('submit:job1', { ticketId: 't1', resolution: { action: 'CREATE_NEW' } }), id, '중복 후보 선택으로 내용이 바뀌면 새 ID');
  // 다른 계정은 A의 요청을 보지 않는다
  const c = new RequestTracker(randomUUID, save);
  c.setOwner('B', (disk.B as Record<string, { id: string; key: string }>) ?? {});
  assert.notEqual(c.begin('submit:job1', { ticketId: 't1' }), id);
});

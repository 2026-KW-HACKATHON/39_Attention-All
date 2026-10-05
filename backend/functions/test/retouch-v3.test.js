const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, execute, readModel } = require('../src/service');
const { mutate } = require('../src/admin');

const now = Date.parse('2026-10-05T00:00:00Z');
const admin = { uid: 'admin', admin: true };
const news = { id: 'v3-news', title: '하천 소식', body: '본문' };

test('profile accepts trimmed empty names and thirty Unicode codepoints in the returned and saved DTO', () => {
  const d = initialState();
  const cases = [['  ', ''], ['  우이천  ', '우이천'], [' ' + '가'.repeat(30) + ' ', '가'.repeat(30)], [' ' + '🏃'.repeat(30) + ' ', '🏃'.repeat(30)]];
  for (const [index, [input, expected]] of cases.entries()) {
    const result = execute(d, { uid: 'u' }, 'updateProfile', { displayName: input, clientRequestId: `profile-${index}` }, now);
    assert.deepEqual(result, { ok: true, displayName: expected });
    assert.equal(readModel(d, { uid: 'u' }, 'getSettings', {}, now).displayName, expected);
  }
});

test('profile rejects non-string and over-thirty-codepoint names without replacing the saved name', () => {
  const d = initialState();
  execute(d, { uid: 'u' }, 'updateProfile', { displayName: '기존 이름', clientRequestId: 'initial' }, now);
  for (const [index, input] of [null, 42, {}, '가'.repeat(31), '🏃'.repeat(31)].entries()) {
    assert.throws(() => execute(d, { uid: 'u' }, 'updateProfile', { displayName: input, clientRequestId: `invalid-${index}` }, now), /INVALID_ARGUMENT/);
    assert.equal(d.users.u.displayName, '기존 이름');
  }
});

test('news exposes publication and checked calendar dates separately from legacy dates and publish timestamps', () => {
  const d = initialState();
  mutate(d, admin, 'upsertNews', { ...news, pub: '2024-02-29', pubKind: '회의일', checked: '2026-10-04', date: '2020-01-01', dateKind: '발표일' }, now);
  mutate(d, admin, 'setNewsPublished', { id: news.id, published: true }, now + 1);
  const item = readModel(d, {}, 'getRiverFeed', {}, now + 2).news.items[0];
  assert.equal(item.pub, '2024-02-29');
  assert.equal(item.pubKind, '회의일');
  assert.equal(item.checked, '2026-10-04');
  assert.equal(item.date, '2020-01-01');
  assert.equal(item.dateKind, '발표일');
  assert.equal(item.publishedAt, now + 1);
});

test('omitted news metadata is preserved, null clears, and publishing never invents a checked date', () => {
  const d = initialState();
  mutate(d, admin, 'upsertNews', { ...news, pub: '2026-10-01', pubKind: '기사 발행', checked: '2026-10-04' }, now);
  mutate(d, admin, 'upsertNews', { ...news, title: '수정 제목' }, now + 1);
  assert.equal(d.news[news.id].pub, '2026-10-01');
  assert.equal(d.news[news.id].pubKind, '기사 발행');
  assert.equal(d.news[news.id].checked, '2026-10-04');
  mutate(d, admin, 'upsertNews', { ...news, pub: null, pubKind: null, checked: null }, now + 2);
  mutate(d, admin, 'setNewsPublished', { id: news.id, published: true }, now + 3);
  assert.equal(d.news[news.id].pub, null);
  assert.equal(d.news[news.id].pubKind, null);
  assert.equal(d.news[news.id].checked, null);
  mutate(d, admin, 'upsertNews', { ...news, id: 'undated' }, now + 4);
  mutate(d, admin, 'setNewsPublished', { id: 'undated', published: true }, now + 5);
  assert.equal(Object.hasOwn(d.news.undated, 'checked'), false);
  assert.equal(Object.hasOwn(d.news.undated, 'pub'), false);
});

test('news rejects malformed calendar dates and invalid publication descriptions before changing the row', () => {
  for (const fields of [
    { pub: '2023-02-29' }, { pub: '2024-04-31' }, { pub: '2024-2-01' },
    { pub: ' 2024-01-01' }, { pub: '2024-01-01 ' }, { pub: '2024-01-01T00:00:00Z' },
    { checked: '2023-02-29' }, { checked: '2026-13-01' }, { checked: '' },
    { checked: 20261005 }, { pub: {} }, { pubKind: '' }, { pubKind: 1 }, { pubKind: 'x'.repeat(41) },
  ]) {
    const d = initialState();
    mutate(d, admin, 'upsertNews', { ...news, checked: '2026-10-04' }, now);
    const before = structuredClone(d.news[news.id]);
    const auditCount = Object.keys(d.adminAudits).length;
    assert.throws(() => mutate(d, admin, 'upsertNews', { ...news, ...fields }, now + 1), /INVALID_ARGUMENT/, JSON.stringify(fields));
    assert.deepEqual(d.news[news.id], before);
    assert.equal(Object.keys(d.adminAudits).length, auditCount);
  }
});

test('version3 news metadata remains admin-only', () => {
  const d = initialState();
  assert.throws(() => mutate(d, { uid: 'u' }, 'upsertNews', { ...news, checked: '2026-10-04' }, now), /PERMISSION_DENIED/);
  assert.equal(d.news[news.id], undefined);
  assert.equal(Object.keys(d.adminAudits).length, 0);
});

function quickIssueState() {
  const d = initialState();
  d.geometry.paths = [{ id: 'L', corridorId: 'W1', points: [[37.619, 127.05], [37.621, 127.05]] }];
  for (const uid of ['creator', 'peer']) d.consents[uid] = { version: 'v2-2026-10' };
  const loc = { lat: 37.62, lng: 127.05, accuracyM: 8, measuredAt: now, precise: true };
  const result = execute(d, { uid: 'creator' }, 'createIssue', { categoryCode: 'LITTER', modality: 'QUICK', pin: [37.62, 127.05], loc, clientRequestId: 'quick-discovery' }, now);
  return { d, issueId: result.resultId, loc };
}

test('fresh QUICK discovery creates an own report without any recheck signal', () => {
  const { d, issueId, loc } = quickIssueState();
  const issue = readModel(d, {}, 'getIssueDetail', { issueId }, now).issue;
  assert.equal(issue.signalCount, 0);
  assert.equal(issue.todaySignalAccountCount, 0);
  assert.equal(d.issues[issueId].lastSignalAt, null);
  assert.equal(d.issues[issueId].signalDayKey, null);
  assert.equal(Object.values(d.obs).filter(o => o.issueId === issueId && o.role === 'DISCOVERY').length, 1);
  const own = execute(d, { uid: 'creator' }, 'submitQuick', { issueId, loc, clientRequestId: 'own-recheck' }, now);
  assert.equal(own.ok, false);
  assert.equal(own.errorCode, 'OWN_ISSUE_RECHECK');
  assert.equal(d.issues[issueId].signalCount, 0);
});

test('real QUICK recheck retains reward and replay behavior while withdrawal excludes creator discovery', () => {
  const { d, issueId, loc } = quickIssueState();
  d.obs.basis = { id: 'basis', uid: 'photographer', issueId, role: 'RECHECK', modality: 'PHOTO', observedAt: now, dayKey: '2026-10-05', visibility: 'PUBLIC' };
  d.issues[issueId].availablePhotoCount = 1;
  const payload = { issueId, loc, clientRequestId: 'peer-recheck' };
  const result = execute(d, { uid: 'peer' }, 'submitQuick', payload, now);
  assert.equal(result.pointsAwarded, 1);
  assert.equal(d.issues[issueId].signalCount, 1);
  assert.equal(d.issues[issueId].todaySignalAccountCount, 1);
  assert.deepEqual(execute(d, { uid: 'peer' }, 'submitQuick', payload, now), result);
  assert.equal(d.issues[issueId].signalCount, 1);
  execute(d, { uid: 'peer' }, 'withdrawContribution', { observationId: result.resultId, clientRequestId: 'withdraw-peer' }, now);
  assert.equal(d.issues[issueId].signalCount, 0);
  assert.equal(d.issues[issueId].todaySignalAccountCount, 0);
  assert.equal(d.issues[issueId].lastSignalAt, null);
  assert.equal(d.issues[issueId].signalDayKey, null);
  assert.equal(Object.values(d.obs).filter(o => o.role === 'DISCOVERY' && o.visibility !== 'HIDDEN').length, 1);
});

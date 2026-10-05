const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mutate } = require('../src/admin');
const { initialState, readModel } = require('../src/service');

const now = Date.parse('2026-10-05T00:00:00Z');
const auth = { uid: 'admin', admin: true };
const base = { id: 'news', title: '하천 소식', body: '본문' };
const metadata = {
  topic: 'eco', status: '추진 중', kind: 'official', source: '노원구',
  date: '2024-02-29', dateKind: '발표일', event: '하천 정비', summary: '사업 요약',
};

test('news metadata is published with the source date independent of publication time', () => {
  const d = initialState();
  mutate(d, auth, 'upsertNews', { ...base, ...metadata, sourceUrl: 'https://example.com/news' }, now);
  mutate(d, auth, 'setNewsPublished', { id: base.id, published: true }, now + 1);
  const item = readModel(d, {}, 'getRiverFeed', {}, now + 2).news.items[0];
  for (const [key, value] of Object.entries(metadata)) assert.equal(item[key], value, key);
  assert.equal(item.publishedAt, now + 1);
  assert.equal(item.createdAt, now);
});

test('legacy news edits preserve omitted metadata and publication history; null clears metadata', () => {
  const d = initialState();
  d.news.news = { ...base, ...metadata, sourceUrl: 'https://example.com/', type: 'NOTICE', published: true, publishedAt: now - 10, createdAt: now - 20 };
  mutate(d, auth, 'upsertNews', { ...base, title: '수정 제목' }, now);
  for (const [key, value] of Object.entries(metadata)) assert.equal(d.news.news[key], value, key);
  assert.equal(d.news.news.published, true);
  assert.equal(d.news.news.publishedAt, now - 10);
  assert.equal(d.news.news.createdAt, now - 20);
  assert.equal(d.news.news.sourceUrl, null);
  const clears = Object.fromEntries(Object.keys(metadata).map(key => [key, null]));
  mutate(d, auth, 'upsertNews', { ...base, ...clears }, now + 1);
  for (const key of Object.keys(metadata)) assert.equal(d.news.news[key], null, key);
});

test('news rejects invalid enums, dates, types, overlong metadata and unsafe URLs without changing the row', () => {
  const invalid = [
    { topic: 'unknown' }, { kind: 'blog' }, { date: '2023-02-29' },
    { date: '2024-04-31' }, { date: '2024-2-01' }, { date: '2024-01-01T00:00:00Z' },
    { date: ' 2024-01-01' }, { status: 1 }, { source: {} }, { event: '' },
    { status: 'x'.repeat(81) }, { source: 'x'.repeat(161) }, { dateKind: 'x'.repeat(41) },
    { event: 'x'.repeat(201) }, { summary: 'x'.repeat(2001) },
    { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://user:pass@example.com' },
  ];
  for (const fields of invalid) {
    const d = initialState();
    d.news.news = { ...base, ...metadata };
    const before = structuredClone(d.news.news);
    assert.throws(() => mutate(d, auth, 'upsertNews', { ...base, ...fields }, now), /INVALID_ARGUMENT/, JSON.stringify(fields));
    assert.deepEqual(d.news.news, before);
    assert.equal(Object.keys(d.adminAudits).length, 0);
  }
});

test('news accepts all reviewed topic and kind values and maximum metadata lengths', () => {
  const d = initialState();
  for (const topic of ['eco', 'proposal', 'plan']) {
    for (const kind of ['official', 'council', 'press', 'citizen']) {
      mutate(d, auth, 'upsertNews', { ...base, topic, kind, date: '2026-10-05', status: 'x'.repeat(80), source: 'x'.repeat(160), dateKind: 'x'.repeat(40), event: 'x'.repeat(200), summary: 'x'.repeat(2000) }, now);
      assert.equal(d.news.news.topic, topic);
      assert.equal(d.news.news.kind, kind);
    }
  }
});

// Replace only the external Firestore/fetch boundaries; getWeather runs unchanged.
async function weatherFixture(cache, failProvider, run) {
  const firebasePath = require.resolve('firebase-admin/firestore');
  const weatherPath = require.resolve('../src/weather');
  const oldFirebase = require.cache[firebasePath], oldWeather = require.cache[weatherPath], oldFetch = global.fetch;
  let stored = cache;
  const ref = { get: async () => ({ data: () => stored }), set: async data => { stored = data; } };
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { getFirestore: () => ({ doc: () => ref }) } };
  delete require.cache[weatherPath];
  global.fetch = async url => {
    if (failProvider) throw new Error('offline');
    const u = new URL(url);
    const current = u.searchParams.get('current').split(',');
    const values = { temperature_2m: 22, apparent_temperature: 21.5, relative_humidity_2m: 50, precipitation: 0, weather_code: 0, wind_speed_10m: 2, is_day: 1, pm10: 10, pm2_5: 5 };
    return { ok: true, json: async () => ({ current: Object.fromEntries(current.map(key => [key, values[key]])), hourly: {} }) };
  };
  try { await run(require('../src/weather').getWeather, () => stored); }
  finally {
    global.fetch = oldFetch;
    if (oldFirebase) require.cache[firebasePath] = oldFirebase; else delete require.cache[firebasePath];
    if (oldWeather) require.cache[weatherPath] = oldWeather; else delete require.cache[weatherPath];
  }
}

test('weather refreshes legacy fresh cache and provides apparent temperature on later cached reads', async () => {
  const old = { fetchedAt: Date.now(), forecast: { current: { temperature_2m: 22 } }, air: { current: { pm10: 10, pm2_5: 5 } }, source: 'Open-Meteo', isModelEstimate: true };
  await weatherFixture(old, false, async (getWeather, stored) => {
    const fresh = await getWeather();
    assert.equal(fresh.status, 'ok');
    assert.equal(fresh.forecast.current.apparent_temperature, 21.5);
    assert.equal(stored().forecast.current.apparent_temperature, 21.5);
    global.fetch = async () => { throw new Error('cached read must not fetch'); };
    const cached = await getWeather();
    assert.equal(cached.status, 'ok');
    assert.equal(cached.forecast.current.apparent_temperature, 21.5);
  });
});

test('legacy weather cache is marked stale if the provider cannot refresh it', async () => {
  await weatherFixture({ fetchedAt: Date.now(), forecast: { current: { temperature_2m: 22 } } }, true, async getWeather => {
    assert.equal((await getWeather()).status, 'stale');
  });
});

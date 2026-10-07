import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestPathDistance, participationArea } from './pilot-proximity.ts';
const path = { points: [[0, -0.01], [0, 0.01]] as [number, number][] };
const location = (distance: number, measuredAt = 1000) => ({ lat: distance / 111320, lng: 0, accuracyM: 5, measuredAt, precise: true as const });
test('participation measures distance to the closest path segment rather than endpoints', () => {
  assert.equal(nearestPathDistance(location(50), [path]), 50);
  assert.equal(nearestPathDistance(location(50), [{ points: [[1, 1], [1, 2]] }, path]), 50);
});
test('100m inclusive boundary and live inside-outside-inside transition use each current location', () => {
  const pilot = { paths: [path], participationRadiusM: 100 };
  const states = [150, 100, 50, 101, 0].map(m => participationArea(location(m), pilot, 1000).status);
  assert.deepEqual(states, ['outside', 'inside', 'inside', 'outside', 'inside']);
});
test('missing paths, stale/imprecise/mock/nonfinite location never activate participation', () => {
  const pilot = { paths: [path], participationRadiusM: 100 };
  for (const loc of [null, location(0, -10001), { ...location(0), accuracyM: 31 }, { ...location(0), mock: true as const }, { ...location(0), lat: NaN }]) {
    assert.equal(participationArea(loc, pilot, 1000).status, 'unknown');
  }
  assert.equal(participationArea(location(0), { paths: [] }, 1000).status, 'unknown');
});

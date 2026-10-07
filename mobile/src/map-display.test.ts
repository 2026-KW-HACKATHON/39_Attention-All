import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterPins,
  routeSegments,
  mapRegion,
  directionArrows,
} from "./map-display.ts";
const view = {
  latitude: 37.62,
  longitude: 127.05,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};
test("cluster zoom changes preserve every member and do not mix facilities", () => {
  const pins = [
    { key: "a", kind: "issue", at: [37.62, 127.05] as [number, number] },
    { key: "b", kind: "issue", at: [37.621, 127.05] as [number, number] },
    { key: "c", kind: "fac", at: [37.62, 127.05] as [number, number] },
  ];
  const wide = clusterPins(pins, view, 400, 800);
  assert.equal(wide.length, 2);
  assert.deepEqual(wide.flatMap((x) => x.members.map((p) => p.key)).sort(), [
    "a",
    "b",
    "c",
  ]);
  assert.equal(
    clusterPins(
      pins,
      { ...view, latitudeDelta: 0.001, longitudeDelta: 0.001 },
      400,
      800,
    ).length,
    3,
  );
  assert.equal(clusterPins([], view, 400, 800).length, 0);
  assert.equal(clusterPins(pins, view, 0, 0).length, 3);
});
test("same-coordinate pins remain accessible in a deterministic group", () => {
  const p = [
    { key: "b", kind: "issue", at: [37, 127] as [number, number] },
    { key: "a", kind: "issue", at: [37, 127] as [number, number] },
  ];
  assert.deepEqual(
    clusterPins(p, view, 400, 800)[0].members.map((p) => p.key),
    ["a", "b"],
  );
});
test("route segmentation retains isolated points and never bridges pauses or invalid coordinates", () => {
  assert.deepEqual(
    routeSegments([
      { lat: 37, lng: 127, segment: 0 },
      { lat: 37.1, lng: 127, segment: 1 },
      { lat: NaN, lng: 127, segment: 1 },
      { lat: 37.2, lng: 127, segment: 1 },
    ]),
    [[[37, 127]], [[37.1, 127]], [[37.2, 127]]],
  );
  assert.deepEqual(routeSegments([]), []);
  assert.ok(Number.isFinite(mapRegion([]).latitude));
  assert.equal(mapRegion([[37, 127]]).latitudeDelta, 0.002);
});
test("direction follows known outbound coordinate order; duplicate and empty paths produce no arrows", () => {
  assert.deepEqual(directionArrows([]), []);
  assert.deepEqual(
    directionArrows([
      [37, 127],
      [37, 127],
    ]),
    [],
  );
  const arrows = directionArrows([
    [37, 127],
    [37.001, 127],
    [37.002, 127],
  ]);
  assert.ok(arrows.length);
  assert.equal(Math.round(arrows[0].bearing), 0);
  assert.equal(
    Math.round(
      directionArrows([
        [37, 127],
        [37, 127.002],
      ])[0].bearing,
    ),
    90,
  );
});

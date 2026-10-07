import { test } from "node:test";
import assert from "node:assert/strict";
import { routineView } from "./routine-view.ts";
test("daily reward slots do not block recording another routine round", () => {
  const v = routineView({ mine: null, accounts: 20, slotsLeft: 0 });
  assert.equal(v.disabled, false);
  assert.equal(v.rewardLimit, true);
  assert.match(v.summary, /오늘.*적립/);
  assert.doesNotMatch(v.summary, /자리/);
});
test("only own existing participation blocks same-round submission; anonymous remains able to enter login", () => {
  assert.equal(
    routineView({ mine: "obs", accounts: 20, slotsLeft: 2 }).disabled,
    true,
  );
  assert.equal(routineView(null).disabled, false);
});

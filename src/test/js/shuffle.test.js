// Tests for the shared Fisher-Yates shuffle. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { shuffleInPlace } from "../../main/resources/static/shuffle.js";

test("shuffles in place and preserves the contents", () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const ref = shuffleInPlace(arr);
  assert.equal(ref, arr); // same array object back
  assert.deepEqual([...arr].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("handles empty and single-element arrays", () => {
  assert.deepEqual(shuffleInPlace([]), []);
  assert.deepEqual(shuffleInPlace([7]), [7]);
});

test("actually reorders (not the identity permutation every time)", () => {
  // 50 shuffles of 5 elements produce at least 2 distinct orders unless the
  // shuffle is broken. False-failure odds are (1/120)^49, effectively zero.
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    seen.add(shuffleInPlace([1, 2, 3, 4, 5]).join(","));
  }
  assert.ok(seen.size >= 2);
});

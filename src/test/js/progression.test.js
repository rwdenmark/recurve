// Tests for the card pacing track. SpawnModel.java mirrors these numbers, so if a
// pinned value here changes, the Java side must change with it. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { xpForCard, spawnCards, cardsForLevel, tierUnlocks } from "../../main/resources/static/progression.js";

test("cycle-0 per-level XP sums are 100, 150, 200", () => {
  const sum = (from, to) => {
    let s = 0;
    for (let n = from; n <= to; n++) s += xpForCard(n);
    return s;
  };
  assert.equal(sum(1, 8), 100);   // level 1
  assert.equal(sum(9, 13), 150);  // level 2
  assert.equal(sum(14, 18), 200); // level 3
  assert.equal(sum(1, 18), 450);  // full cycle
});

test("cycle-0 track starts fast and hands off cleanly to the later track", () => {
  assert.equal(xpForCard(1), 4);
  assert.equal(xpForCard(18), 45);
  assert.equal(xpForCard(19), 50);  // first card of cycle 1
  assert.equal(xpForCard(20), 55);  // +5 each after, forever
  assert.equal(xpForCard(29), 100);
});

test("the later track never decreases", () => {
  let prev = xpForCard(18);
  for (let n = 19; n <= 200; n++) {
    const cost = xpForCard(n);
    assert.ok(cost >= prev, `cost shrank at card ${n}`);
    prev = cost;
  }
});

test("cards per level: 8/5/5 in cycle 0, 5 everywhere after", () => {
  assert.equal(cardsForLevel(0, 1), 8);
  assert.equal(cardsForLevel(0, 2), 5);
  assert.equal(cardsForLevel(0, 3), 5);
  for (const level of [1, 2, 3]) {
    assert.equal(cardsForLevel(1, level), 5);
    assert.equal(cardsForLevel(4, level), 5);
  }
});

test("tier unlocks per cycle and level", () => {
  assert.deepEqual(tierUnlocks(0, 1), [0, 3, 6]);
  assert.deepEqual(tierUnlocks(0, 2), [0, 2, 4]);
  assert.deepEqual(tierUnlocks(0, 3), [0, 2, 4]);
  for (const level of [1, 2, 3]) assert.deepEqual(tierUnlocks(1, level), [0, 2, 3]);
});

test("every tier is reachable within its level's card budget", () => {
  for (const cycle of [0, 1, 2]) {
    for (const level of [1, 2, 3]) {
      const cards = cardsForLevel(cycle, level);
      for (const needed of tierUnlocks(cycle, level)) {
        assert.ok(needed <= cards, `tier needs ${needed} cards but level only has ${cards} (cycle ${cycle}, level ${level})`);
      }
    }
  }
});

test("spawn cards follow the level-end anchors, then step normally", () => {
  assert.equal(spawnCards(0), 0);
  assert.equal(spawnCards(4), 5);    // mid level 1 (4.5 rounds up)
  assert.equal(spawnCards(8), 9);    // end of cycle-0 level 1, barely above raw
  assert.equal(spawnCards(13), 15);  // end of cycle-0 level 2
  assert.equal(spawnCards(18), 24);  // end of cycle 0
  assert.equal(spawnCards(19), 25);  // +1 per card afterward
  assert.equal(spawnCards(33), 39);
  let prev = spawnCards(0);
  for (let c = 1; c <= 60; c++) {
    const sc = spawnCards(c);
    assert.ok(sc >= prev, `spawnCards shrank at ${c}`);
    prev = sc;
  }
});

test("the full cycle-0 table is pinned (SpawnModel.java mirrors these exact costs)", () => {
  const costs = [];
  for (let n = 1; n <= 18; n++) costs.push(xpForCard(n));
  assert.deepEqual(costs, [
    4, 5, 6, 10, 13, 17, 20, 25,  // level 1
    26, 28, 30, 32, 34,           // level 2
    35, 38, 40, 42, 45,           // level 3
  ]);
});

test("the spawn-interval floor lands at real card 14 (first card of level 3)", () => {
  // Interval = 600 - 25 x spawnCards, floored at 175, so the floor needs sc 17.
  assert.ok(spawnCards(13) < 17);
  assert.ok(spawnCards(14) >= 17);
});

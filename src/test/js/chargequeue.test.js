// Tests for the shared recharge queue behind the ballista slots and arrow-storm
// charges. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createChargeQueue, joinQueue, stepQueue, reduceQueue, shiftQueue, resetQueue, queueCircles,
} from "../../main/resources/static/chargequeue.js";

const CD = 10_000;

test("a spent charge joins the queue and finishes after the cooldown", () => {
  const q = createChargeQueue();
  joinQueue(q, 1000, CD);
  assert.equal(q.charging, 1);
  assert.equal(q.chargeEnd, 1000 + CD);

  stepQueue(q, 1000 + CD - 1, CD);
  assert.equal(q.charging, 1); // not done yet

  stepQueue(q, 1000 + CD, CD);
  assert.equal(q.charging, 0);
  assert.equal(q.chargeEnd, 0); // queue empty
});

test("only the head recharges, the next starts when it finishes", () => {
  const q = createChargeQueue();
  joinQueue(q, 0, CD);
  joinQueue(q, 2000, CD); // waits behind the head, does not reset the end time
  assert.equal(q.charging, 2);
  assert.equal(q.chargeEnd, CD);

  stepQueue(q, CD, CD);
  assert.equal(q.charging, 1);
  assert.equal(q.chargeEnd, CD + CD); // second charge starts a full cooldown at the handoff
});

test("kill reduction pulls the head closer but never before now", () => {
  const q = createChargeQueue();
  joinQueue(q, 0, CD);
  reduceQueue(q, 500, 500);
  assert.equal(q.chargeEnd, CD - 500);

  reduceQueue(q, 9000, 30_000); // clamped to now
  assert.equal(q.chargeEnd, 9000);

  resetQueue(q);
  reduceQueue(q, 100, 500); // an empty queue is untouched
  assert.equal(q.chargeEnd, 0);
});

test("pause shift moves the head, an empty queue stays at 0", () => {
  const q = createChargeQueue();
  shiftQueue(q, 5000);
  assert.equal(q.chargeEnd, 0);

  joinQueue(q, 0, CD);
  shiftQueue(q, 5000);
  assert.equal(q.chargeEnd, CD + 5000);
});

test("circles show full for ready, a partial head, empty for the rest of the queue", () => {
  const q = createChargeQueue();
  joinQueue(q, 0, CD);
  joinQueue(q, 0, CD);

  const circles = queueCircles(q, CD / 2, 1, CD);
  assert.equal(circles.length, 3);
  assert.deepEqual(circles[0], { fraction: 1, ready: true });
  assert.equal(circles[1].fraction, 0.5); // head is half recharged
  assert.equal(circles[1].ready, false);
  assert.deepEqual(circles[2], { fraction: 0, ready: false });
});

test("circle fraction clamps to [0, 1]", () => {
  const q = createChargeQueue();
  joinQueue(q, 0, CD);
  assert.equal(queueCircles(q, -500, 0, CD)[0].fraction, 0); // before the recharge window
  stepQueue(q, CD, CD); // done
  joinQueue(q, CD, CD);
  assert.equal(queueCircles(q, CD * 3, 0, CD)[0].fraction, 1); // past due, clamped
});

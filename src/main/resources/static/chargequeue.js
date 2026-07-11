// Recharge queue shared by the crossbow ballista slots and the green ranger's
// arrow-storm charges. N charges can be waiting, but only the head recharges;
// when it finishes, the next in line starts. DOM-free so node can test it.

export function createChargeQueue() {
  return {
    charging: 0,  // charges currently in the queue (head recharging, rest waiting)
    chargeEnd: 0, // time the head finishes (0 = queue empty)
  };
}

/** A spent charge joins the back of the queue. */
export function joinQueue(queue, now, cooldownMs) {
  queue.charging += 1;
  if (queue.chargeEnd === 0) queue.chargeEnd = now + cooldownMs;
}

/** Finish the head charge when its time is up and start the next one. */
export function stepQueue(queue, now, cooldownMs) {
  if (queue.chargeEnd !== 0 && now >= queue.chargeEnd) {
    queue.charging -= 1;
    queue.chargeEnd = queue.charging > 0 ? now + cooldownMs : 0;
  }
}

/** Pull the head charge's finish time closer (kill-based cooldown reduction). */
export function reduceQueue(queue, now, reductionMs) {
  if (queue.chargeEnd !== 0) queue.chargeEnd = Math.max(now, queue.chargeEnd - reductionMs);
}

/** Shift the head's finish time by a pause interval (see shiftTimers in game.js). */
export function shiftQueue(queue, delta) {
  if (queue.chargeEnd !== 0) queue.chargeEnd += delta;
}

export function resetQueue(queue) {
  queue.charging = 0;
  queue.chargeEnd = 0;
}

/**
 * HUD dials for the queue, one full circle per ready charge, a partial one for the
 * recharging head, and an empty one for each charge waiting behind it. Callers pad
 * or trim to their own slot count (the ballista adds empties for deployed turrets).
 */
export function queueCircles(queue, now, readyCount, cooldownMs) {
  const circles = [];
  for (let i = 0; i < readyCount; i++) circles.push({ fraction: 1, ready: true });
  if (queue.charging > 0) {
    const fraction = Math.max(0, Math.min(1, 1 - (queue.chargeEnd - now) / cooldownMs));
    circles.push({ fraction, ready: false });
    for (let i = 1; i < queue.charging; i++) circles.push({ fraction: 0, ready: false });
  }
  return circles;
}

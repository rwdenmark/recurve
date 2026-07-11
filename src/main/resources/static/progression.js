// Card pacing and level progression, split out of game.js so node can test it and
// so the server's anti-cheat bound (SpawnModel.java) has one place to mirror.
// If anything here changes, change SpawnModel.java to match or legitimate high
// scores get rejected.
//
// Cards are earned with XP, not raw kills. A tier-n enemy is worth n XP (the
// weights live in game.js, CARD_XP_BY_TYPE), while the kill counter stays 1 per
// kill. Cycle 0 runs a hand-tuned track. Cards come fast at the start (4 XP) and
// slow through the cycle, 8 cards on level 1 then 5 on levels 2 and 3, 450 XP
// total. From cycle 1 on, the first card costs LATER_BASE XP and each card after
// adds LATER_STEP forever, with 5 cards per level.

// XP cost of each cycle-0 card, in order. Level sums are 100 / 150 / 200.
const CYCLE0_CARD_COSTS = [
  4, 5, 6, 10, 13, 17, 20, 25,  // level 1 (8 cards)
  26, 28, 30, 32, 34,           // level 2 (5 cards)
  35, 38, 40, 42, 45,           // level 3 (5 cards)
];
const LATER_BASE = 50;
const LATER_STEP = 5;

const CYCLE0_CARDS_PER_LEVEL = [8, 5, 5];
const LATER_CARDS_PER_LEVEL = 5;

// Cards taken within the current level before an enemy tier spawns, indexed by tier (0-2).
// Cycle 0 level 1 unlocks late so the opening stays gentle. Levels 2 and 3 only
// have 5 cards, so their tiers land mid-level.
const CYCLE0_L1_UNLOCKS = [0, 3, 6];
const CYCLE0_UNLOCKS = [0, 2, 4];
const LATER_UNLOCKS = [0, 2, 3];

/** XP cost of card number n (1-based, run total). */
export function xpForCard(n) {
  if (n <= CYCLE0_CARD_COSTS.length) return CYCLE0_CARD_COSTS[n - 1];
  return LATER_BASE + LATER_STEP * (n - CYCLE0_CARD_COSTS.length - 1);
}

// Spawn pacing. Cycle 0 hands out 18 cards where the old track handed out 30, so
// raw cards would ramp the spawn formulas (interval, target population, batch) too
// slowly, and mapping straight onto the old 30-card curve proved too hot. Anchors
// at each cycle-0 level end keep levels 1 and 2 gentle and let level 3 catch up to
// 24 spawn-equivalents by the cycle's end, then the count continues normally
// (+1 per card) from cycle 1 on. Between anchors the value interpolates linearly.
const SPAWN_CARD_ANCHORS = [
  [0, 0],   // run start
  [8, 9],   // end of cycle-0 level 1
  [13, 15], // end of cycle-0 level 2
  [18, 24], // end of cycle 0
];

/** Effective card count for the spawn-pacing formulas in game.js. */
export function spawnCards(cardsTaken) {
  const [lastCard, lastValue] = SPAWN_CARD_ANCHORS[SPAWN_CARD_ANCHORS.length - 1];
  if (cardsTaken > lastCard) return lastValue + (cardsTaken - lastCard);
  for (let i = 1; i < SPAWN_CARD_ANCHORS.length; i++) {
    const [x1, y1] = SPAWN_CARD_ANCHORS[i];
    if (cardsTaken <= x1) {
      const [x0, y0] = SPAWN_CARD_ANCHORS[i - 1];
      return Math.round(y0 + (cardsTaken - x0) * (y1 - y0) / (x1 - x0));
    }
  }
  return 0; // unreachable, cardsTaken is never negative
}

/** Cards taken within a level before it ends. */
export function cardsForLevel(cycle, level) {
  if (cycle === 0) return CYCLE0_CARDS_PER_LEVEL[level - 1];
  return LATER_CARDS_PER_LEVEL;
}

/** [tier1, tier2, tier3] cards-this-level needed before each enemy tier spawns. */
export function tierUnlocks(cycle, level) {
  if (cycle === 0) return level === 1 ? CYCLE0_L1_UNLOCKS : CYCLE0_UNLOCKS;
  return LATER_UNLOCKS;
}

package com.recurve.service;

/**
 * Mirror of the frontend spawn schedule (game.js and buffs.js) so the server can bound
 * how many kills a run of a given length could have produced, instead of a hand-tuned cap.
 *
 * The spawner tops the board up on a timer driven by upgrade cards. The interval starts
 * at 600ms and shortens 25ms per card down to a 175ms floor, and a tick places at most
 * one enemy per spawn point (8 forts on level 1, 6 portals on level 2). Cards come from
 * kills, so the bound assumes the fastest possible run. Every spawned enemy dies
 * instantly and every kill threshold awards its card at once. Real runs always trail
 * this, so it stays a true upper bound. Keep the constants in sync with game.js and
 * buffs.js if the spawn pacing or card pacing changes.
 */
public final class SpawnModel {

    // game.js spawn pacing.
    private static final int SPAWN_INTERVAL_BASE_MS = 600;
    private static final int SPAWN_INTERVAL_FLOOR_MS = 175;
    private static final int SPAWN_INTERVAL_PER_CARD_MS = 25;
    private static final int MAX_SPAWN_POINTS = 8;      // level 1's fort count, the larger level

    // Card pacing: 10 kills per card through the first cycle (CARDS_PER_LEVEL x
    // LEVEL_COUNT cards), 20 per card once the loop wraps.
    private static final int FIRST_CYCLE_CARDS = 20;
    private static final int KILLS_PER_CARD_FIRST_CYCLE = 10;
    private static final int KILLS_PER_CARD_LATER = 20;

    private SpawnModel() {
    }

    /**
     * Upper bound on kills reachable in {@code durationSeconds}: walk the spawn ticks,
     * each spawning one enemy per free spawn point (the per-tick batch is
     * 1 + cards/2, capped at the spawn-point count), with cards derived from the
     * kills so far.
     */
    public static long maxKills(int durationSeconds) {
        long ms = (long) durationSeconds * 1000;
        long kills = 0;
        long t = 0;
        while (true) {
            long cards = cardsEarned(kills);
            t += Math.max(SPAWN_INTERVAL_FLOOR_MS, SPAWN_INTERVAL_BASE_MS - SPAWN_INTERVAL_PER_CARD_MS * cards);
            if (t > ms) {
                return kills;
            }
            kills += Math.min(MAX_SPAWN_POINTS, 1 + cards / 2);
        }
    }

    private static long cardsEarned(long kills) {
        long firstCycleKills = (long) FIRST_CYCLE_CARDS * KILLS_PER_CARD_FIRST_CYCLE;
        if (kills <= firstCycleKills) {
            return kills / KILLS_PER_CARD_FIRST_CYCLE;
        }
        return FIRST_CYCLE_CARDS + (kills - firstCycleKills) / KILLS_PER_CARD_LATER;
    }
}

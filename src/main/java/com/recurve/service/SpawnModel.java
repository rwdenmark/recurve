package com.recurve.service;

/**
 * Mirror of the frontend spawn schedule (game.js and progression.js) so the server can
 * bound how many kills a run of a given length could have produced, instead of a
 * hand-tuned cap.
 *
 * The spawner tops the board up on a timer driven by upgrade cards. The interval starts
 * at 600ms and shortens 25ms per card down to a 175ms floor, and a tick places at most
 * one enemy per spawn point (8 forts on level 1, 6 portals on level 2, 8 portals and
 * grates on level 3). Summoned skeletons never score, so they don't touch the bound.
 * Cards come from XP (a tier-n enemy is worth n XP, max tier 3), so the bound assumes
 * the fastest possible run, where every kill is worth the full 3 XP, every spawned enemy
 * dies instantly, and every threshold awards its card at once. Real runs always trail this,
 * so it stays a true upper bound. Keep the constants in sync with game.js and
 * progression.js if the spawn pacing or card pacing changes.
 */
public final class SpawnModel {

    // game.js spawn pacing.
    private static final int SPAWN_INTERVAL_BASE_MS = 600;
    private static final int SPAWN_INTERVAL_FLOOR_MS = 175;
    private static final int SPAWN_INTERVAL_PER_CARD_MS = 25;
    private static final int MAX_SPAWN_POINTS = 8;      // the most on any level (levels 1 and 3 both have 8)

    // ScoreSubmission caps a claimed kill count at 100k, so once the bound clears that
    // (with room past the controller's slack) its exact value stops mattering and the
    // walk can stop. A 24h duration would otherwise burn ~500k iterations per call on
    // client-controlled input. The same value is returned for every duration past the
    // crossing, so the bound stays non-decreasing.
    private static final long BOUND_CEILING = 101_000;

    // progression.js card pacing. Cycle 0 runs a hand-tuned per-card XP cost table
    // (8 cards on level 1, then 5 and 5, 450 XP total). Every card after the table
    // costs LATER_BASE plus LATER_STEP per card taken beyond it, forever.
    private static final int[] CYCLE0_CARD_COSTS = {
            4, 5, 6, 10, 13, 17, 20, 25,  // level 1
            26, 28, 30, 32, 34,           // level 2
            35, 38, 40, 42, 45,           // level 3
    };
    private static final int LATER_BASE = 50;
    private static final int LATER_STEP = 5;

    // XP per kill the bound assumes (tier 3, the maximum). MAX_XP_PER_KILL x kills is
    // the fastest possible XP total, so cards can never come sooner than modeled here.
    private static final int MAX_XP_PER_KILL = 3;

    // progression.js spawnCards anchors. Cycle-0 level ends map to gentle
    // spawn-equivalents on levels 1 and 2, catching up to 24 by the end of the
    // cycle, then +1 per card from cycle 1 on. Linear between anchors.
    private static final int[][] SPAWN_CARD_ANCHORS = { {0, 0}, {8, 9}, {13, 15}, {18, 24} };

    // Cumulative XP total at which each card lands, precomputed past the bound ceiling
    // (in XP terms) so the walk in maxKills earns cards with a cursor bump instead of
    // re-deriving them.
    private static final long[] CARD_XP_THRESHOLDS = buildCardXpThresholds();

    private SpawnModel() {
    }

    private static long costOfCard(int n) { // n is 1-based
        if (n <= CYCLE0_CARD_COSTS.length) {
            return CYCLE0_CARD_COSTS[n - 1];
        }
        return LATER_BASE + (long) LATER_STEP * (n - CYCLE0_CARD_COSTS.length - 1);
    }

    private static long[] buildCardXpThresholds() {
        long xpCeiling = BOUND_CEILING * MAX_XP_PER_KILL;
        int count = 0;
        long cum = 0;
        while (cum < xpCeiling) {
            cum += costOfCard(count + 1);
            count++;
        }
        long[] thresholds = new long[count];
        cum = 0;
        for (int i = 0; i < count; i++) {
            cum += costOfCard(i + 1);
            thresholds[i] = cum;
        }
        return thresholds;
    }

    private static long spawnCards(int cards) {
        int[] last = SPAWN_CARD_ANCHORS[SPAWN_CARD_ANCHORS.length - 1];
        if (cards > last[0]) {
            return last[1] + (long) (cards - last[0]);
        }
        for (int i = 1; i < SPAWN_CARD_ANCHORS.length; i++) {
            if (cards <= SPAWN_CARD_ANCHORS[i][0]) {
                int[] a = SPAWN_CARD_ANCHORS[i - 1];
                int[] b = SPAWN_CARD_ANCHORS[i];
                return Math.round(a[1] + (cards - a[0]) * (double) (b[1] - a[1]) / (b[0] - a[0]));
            }
        }
        return 0; // unreachable, cards is never negative
    }

    /**
     * Upper bound on kills reachable in {@code durationSeconds}: walk the spawn ticks,
     * each spawning one enemy per free spawn point (the per-tick batch is
     * 1 + spawnCards/2, capped at the spawn-point count), with cards earned as the
     * best-case XP total (3 per kill) crosses each threshold.
     */
    public static long maxKills(int durationSeconds) {
        long ms = (long) durationSeconds * 1000;
        long kills = 0;
        long t = 0;
        int cards = 0;
        while (true) {
            while (cards < CARD_XP_THRESHOLDS.length && kills * MAX_XP_PER_KILL >= CARD_XP_THRESHOLDS[cards]) {
                cards++;
            }
            long sc = spawnCards(cards);
            t += Math.max(SPAWN_INTERVAL_FLOOR_MS, SPAWN_INTERVAL_BASE_MS - SPAWN_INTERVAL_PER_CARD_MS * sc);
            if (t > ms || kills >= BOUND_CEILING) {
                return kills;
            }
            kills += (int) Math.min(MAX_SPAWN_POINTS, 1 + sc / 2);
        }
    }
}

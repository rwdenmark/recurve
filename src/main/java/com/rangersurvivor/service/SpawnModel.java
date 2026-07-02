package com.rangersurvivor.service;

/**
 * Mirror of the frontend spawn schedule (game.js) so the server can bound how many
 * kills a run of a given length could have produced, instead of a hand-tuned cap.
 * Keep these constants in sync with game.js if the spawn pacing changes.
 */
public final class SpawnModel {

    private static final int SPAWN_INTERVAL_MS = 600;    // one top-up tick this often
    private static final int SPAWN_BATCH_RAMP_MS = 60_000; // per-tick batch grows by 1 each minute
    private static final int MAX_FORTS = 8;              // a tick spawns at most this many

    private SpawnModel() {
    }

    /**
     * Upper bound on kills reachable in {@code durationSeconds}: the most enemies the
     * spawner could produce if the board were cleared every tick (one spawn per free
     * fort, the batch growing by one each minute, capped at the fort count).
     */
    public static long maxKills(int durationSeconds) {
        long ms = (long) durationSeconds * 1000;
        long total = 0;
        for (long tick = SPAWN_INTERVAL_MS; tick <= ms; tick += SPAWN_INTERVAL_MS) {
            long batch = 1 + tick / SPAWN_BATCH_RAMP_MS;
            total += Math.min(MAX_FORTS, batch);
        }
        return total;
    }
}

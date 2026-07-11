package com.recurve;

import com.recurve.service.SpawnModel;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SpawnModelTest {

    @Test
    void zeroDurationAllowsNoKills() {
        assertEquals(0, SpawnModel.maxKills(0));
    }

    @Test
    void boundGrowsWithDuration() {
        assertTrue(SpawnModel.maxKills(120) > SpawnModel.maxKills(60));
        assertTrue(SpawnModel.maxKills(600) > SpawnModel.maxKills(300));
    }

    @Test
    void pinnedValuesFreezeTheGameJsContract() {
        // Computed from the card-driven schedule, 600ms base interval shortening 25ms
        // per spawn-card (progression.js spawnCards mapping) to a 175ms floor, batch
        // 1 + spawnCards/2 capped at 8, and cards earned on the progression.js XP track
        // (18-card cycle-0 table then 50 + 5 per card) at the best case of 3 XP per
        // kill. If these move, game.js/progression.js must be re-synced.
        assertEquals(0, SpawnModel.maxKills(0));
        assertEquals(1049, SpawnModel.maxKills(30));
        assertEquals(2417, SpawnModel.maxKills(60));
        assertEquals(6529, SpawnModel.maxKills(150));
    }

    @Test
    void boundNeverShrinksAsDurationGrows() {
        long prev = SpawnModel.maxKills(0);
        for (int s = 1; s <= 700; s++) {
            long next = SpawnModel.maxKills(s);
            assertTrue(next >= prev, "maxKills shrank at " + s + "s");
            prev = next;
        }
    }

    @Test
    void lateGameRateCapsAtTheSpawnPointCount() {
        // Deep into a run the interval is pinned at the 175ms floor and the batch at
        // 8 spawn points, so a late 60s window holds 343 ticks of 8.
        assertEquals(2744, SpawnModel.maxKills(600) - SpawnModel.maxKills(540));
    }

    @Test
    void ceilingStopsTheWalkOnHostileDurations() {
        // durationSeconds is client-controlled up to 24h. The walk must terminate fast
        // and clear the 100k submission cap, so its exact value past the ceiling never
        // changes the controller's verdict.
        assertTrue(SpawnModel.maxKills(86_400) > 100_000);
    }
}

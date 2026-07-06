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
        // Computed from the card-driven schedule (600ms base interval shortening 25ms
        // per card to a 175ms floor, batch 1 + cards/2 capped at 8, cards from kills).
        // If these move, the spawn or card pacing changed and game.js must be re-synced.
        assertEquals(0, SpawnModel.maxKills(0));
        assertEquals(298, SpawnModel.maxKills(30));
        assertEquals(1666, SpawnModel.maxKills(60));
        assertEquals(5778, SpawnModel.maxKills(150));
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
}

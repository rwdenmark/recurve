package com.rangersurvivor;

import com.rangersurvivor.service.SpawnModel;
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
        // Hand-computed from the constants (600ms ticks, batch grows each minute).
        // 60s is 100 ticks, 99 at batch 1 plus the minute tick at batch 2, so 101.
        // 150s is 99 ticks at batch 1, 100 at batch 2, 51 at batch 3, so 99 + 200 + 153 gives 452.
        // If these move, the spawn pacing changed and game.js must be re-synced.
        assertEquals(0, SpawnModel.maxKills(0));
        assertEquals(101, SpawnModel.maxKills(60));
        assertEquals(452, SpawnModel.maxKills(150));
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
    void rateCapsAtTheFortCountLateGame() {
        // Past ~7 minutes the per-tick batch caps at 8 forts, so a 60s window late game
        // is 100 ticks of 8 = 800 kills.
        assertEquals(800, SpawnModel.maxKills(600) - SpawnModel.maxKills(540));
    }
}

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
    void rateCapsAtTheFortCountLateGame() {
        // Past ~7 minutes the per-tick batch caps at 8 forts, so a 60s window late game
        // is 100 ticks of 8 = 800 kills.
        assertEquals(800, SpawnModel.maxKills(600) - SpawnModel.maxKills(540));
    }
}

package com.recurve;

import com.recurve.service.GameSessionService;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GameSessionServiceTest {

    @Test
    void aSessionCanBeStartedReadThenConsumedOnce() {
        GameSessionService sessions = new GameSessionService();
        String id = sessions.start();
        assertNotNull(sessions.startMillis(id));
        assertTrue(sessions.consume(id));
        assertNull(sessions.startMillis(id)); // gone after consume
        assertFalse(sessions.consume(id));    // can't consume twice
    }

    @Test
    void unknownAndNullSessionsAreRejected() {
        GameSessionService sessions = new GameSessionService();
        assertNull(sessions.startMillis("nope"));
        assertNull(sessions.startMillis(null));
        assertFalse(sessions.consume(null));
    }

    @Test
    void liveSessionCountIsHardCapped() {
        // The rate limit is keyed on a spoofable header, so this cap is what actually
        // bounds the map. Past it the oldest entry is evicted and new starts keep working.
        GameSessionService sessions = new GameSessionService();
        for (int i = 0; i < GameSessionService.MAX_SESSIONS + 100; i++) {
            sessions.start();
        }
        String latest = sessions.start();
        assertTrue(sessions.liveCount() <= GameSessionService.MAX_SESSIONS);
        assertNotNull(sessions.startMillis(latest)); // the newest session survives the evictions
    }
}

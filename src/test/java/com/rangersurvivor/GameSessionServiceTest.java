package com.rangersurvivor;

import com.rangersurvivor.service.GameSessionService;
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
}

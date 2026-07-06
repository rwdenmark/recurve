package com.recurve;

import com.recurve.service.SubmissionRateLimiter;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Direct coverage of the sliding window. Time is driven through the nowMillis
 * seam, same pattern as ProfanityFilterTest overriding queryRemote.
 */
class SubmissionRateLimiterTest {

    /** Limiter on a hand-cranked clock. */
    private static class FixedClockLimiter extends SubmissionRateLimiter {
        long now = 1_000;

        FixedClockLimiter(int maxPerWindow) {
            super(maxPerWindow);
        }

        @Override
        protected long nowMillis() {
            return now;
        }
    }

    @Test
    void allowsUpToTheLimitThenBlocks() {
        FixedClockLimiter limiter = new FixedClockLimiter(3);
        assertTrue(limiter.allow("a"));
        assertTrue(limiter.allow("a"));
        assertTrue(limiter.allow("a"));
        assertFalse(limiter.allow("a"));
    }

    @Test
    void clientsAreLimitedIndependently() {
        FixedClockLimiter limiter = new FixedClockLimiter(1);
        assertTrue(limiter.allow("a"));
        assertFalse(limiter.allow("a"));
        assertTrue(limiter.allow("b"));
    }

    @Test
    void windowExpiryFreesTheBudget() {
        FixedClockLimiter limiter = new FixedClockLimiter(2);
        assertTrue(limiter.allow("a"));
        assertTrue(limiter.allow("a"));
        assertFalse(limiter.allow("a"));
        limiter.now += 60_001; // both hits now older than the 60s window
        assertTrue(limiter.allow("a"));
    }

    @Test
    void clearResetsEveryWindow() {
        FixedClockLimiter limiter = new FixedClockLimiter(1);
        assertTrue(limiter.allow("a"));
        assertFalse(limiter.allow("a"));
        limiter.clear();
        assertTrue(limiter.allow("a"));
    }
}

package com.rangersurvivor;

import com.rangersurvivor.service.ProfanityFilter;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the null/blank guard and the verdict cache. The remote call is overridden
 * so the suite never touches the live PurgoMalum API.
 */
class ProfanityFilterTest {

    @Test
    void blankOrNullNamesAreTreatedAsClean() {
        ProfanityFilter filter = new ProfanityFilter();
        assertFalse(filter.isProfane(null));
        assertFalse(filter.isProfane(""));
        assertFalse(filter.isProfane("   "));
    }

    @Test
    void repeatedNamesAreServedFromCache() {
        AtomicInteger calls = new AtomicInteger();
        ProfanityFilter filter = new ProfanityFilter() {
            @Override
            protected Boolean queryRemote(String text) {
                calls.incrementAndGet();
                return text.toLowerCase().contains("badword");
            }
        };

        assertTrue(filter.isProfane("BadWord"));    // miss, queries
        assertTrue(filter.isProfane("  badword ")); // normalized hit, no query
        assertEquals(1, calls.get());

        assertFalse(filter.isProfane("ryan"));      // miss, queries
        assertFalse(filter.isProfane("RYAN"));      // normalized hit, no query
        assertEquals(2, calls.get());
    }

    @Test
    void upstreamFailureFailsOpenAndIsNotCached() {
        AtomicInteger calls = new AtomicInteger();
        ProfanityFilter filter = new ProfanityFilter() {
            @Override
            protected Boolean queryRemote(String text) {
                calls.incrementAndGet();
                return null; // simulate PurgoMalum being unreachable
            }
        };

        assertFalse(filter.isProfane("whatever")); // fail open
        assertFalse(filter.isProfane("whatever")); // not cached, queries again
        assertEquals(2, calls.get());
    }
}

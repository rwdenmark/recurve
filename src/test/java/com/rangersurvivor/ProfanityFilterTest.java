package com.rangersurvivor;

import com.rangersurvivor.service.ProfanityFilter;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Unit test for the cheap guard branch that runs before any network call, so it
 * needs no PurgoMalum access. The fail-open behavior on an upstream error is not
 * covered here because it depends on a live HTTP call.
 */
class ProfanityFilterTest {

    private final ProfanityFilter filter = new ProfanityFilter();

    @Test
    void blankOrNullNamesAreTreatedAsClean() {
        assertFalse(filter.isProfane(null));
        assertFalse(filter.isProfane(""));
        assertFalse(filter.isProfane("   "));
    }
}

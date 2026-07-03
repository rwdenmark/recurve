package com.rangersurvivor;

import com.rangersurvivor.controller.HealthController;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins the warm-up in-flight guard. The stub query blocks until released, so a
 * second ping while the first warm-up is still running must not start another.
 */
class HealthControllerTest {

    @Test
    void overlappingPingsRunOneWarmupAtATime() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger queries = new AtomicInteger();
        JdbcTemplate jdbc = new JdbcTemplate() {
            @Override
            public <T> T queryForObject(String sql, Class<T> requiredType) {
                queries.incrementAndGet();
                try {
                    release.await(2, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {
                }
                return null;
            }
        };
        HealthController controller = new HealthController(jdbc);

        // The guard flips synchronously in health(), so the second call is
        // deterministically skipped even before the async task runs.
        assertEquals("ok", controller.health().get("status"));
        assertEquals("ok", controller.health().get("status"));

        release.countDown();
        long deadline = System.currentTimeMillis() + 2_000;
        while (queries.get() < 1 && System.currentTimeMillis() < deadline) {
            Thread.sleep(10);
        }
        assertEquals(1, queries.get());
    }
}

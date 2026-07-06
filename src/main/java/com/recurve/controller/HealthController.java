package com.recurve.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Liveness probe for platform health checks and the demo failover.
 * Returns 200 immediately, then asynchronously runs SELECT 1 to wake the database
 * (it auto-suspends on the free tier) before the visitor lands. CORS is limited
 * to the origins that poll this endpoint.
 */
@RestController
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    // One warm-up at a time. Uptime monitors poll on a timer, and a slow database
    // wake must not stack blocking tasks on the common pool.
    private final AtomicBoolean warmupInFlight = new AtomicBoolean();

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @CrossOrigin(origins = {
            "https://rwdenmark.github.io",
            "https://rdenmark.savannah-luma.ts.net"
    })
    @GetMapping("/api/health")
    public Map<String, String> health() {
        if (warmupInFlight.compareAndSet(false, true)) {
            CompletableFuture.runAsync(() -> {
                try {
                    jdbcTemplate.queryForObject("SELECT 1", Integer.class);
                } catch (Exception ignored) {
                    // Warm-up is best-effort. Never fail the health response because of it.
                } finally {
                    warmupInFlight.set(false);
                }
            });
        }
        return Map.of("status", "ok");
    }
}

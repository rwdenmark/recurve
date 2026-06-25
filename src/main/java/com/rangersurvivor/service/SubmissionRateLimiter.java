package com.rangersurvivor.service;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory sliding-window rate limiter for score submissions, keyed by client.
 * Single-instance only, which matches the free-tier deployment. If this ever
 * runs on more than one instance, move the window to a shared store.
 *
 * Idle clients are swept periodically so the keyed map cannot grow without bound
 * over a long-lived process. A client whose window has fully expired is dropped.
 */
@Service
public class SubmissionRateLimiter {

    private static final int MAX_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000;
    // Run the idle-client sweep once every this many calls. Cheap amortized cost,
    // and the map then only holds clients seen within roughly the last window.
    private static final int SWEEP_EVERY = 500;

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();
    private final AtomicInteger callsSinceSweep = new AtomicInteger();

    public boolean allow(String key) {
        long now = System.currentTimeMillis();
        if (callsSinceSweep.incrementAndGet() >= SWEEP_EVERY) {
            callsSinceSweep.set(0);
            sweepExpired(now);
        }
        Deque<Long> window = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= MAX_PER_WINDOW) {
                return false;
            }
            window.addLast(now);
            return true;
        }
    }

    // Drop clients whose entire window has aged out. Each deque is pruned under
    // its own lock, and the key is removed only if it is still mapped to that
    // same empty deque. In a rare race a concurrent allow() can add to a deque
    // that is being detached, missing one hit, which at worst lets through one
    // extra request. Harmless at this scale.
    private void sweepExpired(long now) {
        for (Map.Entry<String, Deque<Long>> entry : hits.entrySet()) {
            Deque<Long> window = entry.getValue();
            synchronized (window) {
                while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                    window.pollFirst();
                }
                if (window.isEmpty()) {
                    hits.remove(entry.getKey(), window);
                }
            }
        }
    }
}

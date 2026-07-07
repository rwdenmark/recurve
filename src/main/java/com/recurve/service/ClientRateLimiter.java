package com.recurve.service;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory sliding-window rate limiter, keyed by client. Single-instance only,
 * matching the free-tier deployment. Move to a shared store to scale out.
 */
@Service
public class ClientRateLimiter {

    private static final int DEFAULT_MAX_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000;
    private static final int SWEEP_EVERY = 500; // sweep idle clients every N calls

    private final int maxPerWindow;
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();
    private final AtomicInteger callsSinceSweep = new AtomicInteger();

    public ClientRateLimiter() {
        this(DEFAULT_MAX_PER_WINDOW);
    }

    // For callers that need their own budget, like the game-start endpoint.
    public ClientRateLimiter(int maxPerWindow) {
        this.maxPerWindow = maxPerWindow;
    }

    public boolean allow(String key) {
        long now = nowMillis();
        if (callsSinceSweep.incrementAndGet() >= SWEEP_EVERY) {
            callsSinceSweep.set(0);
            sweepExpired(now);
        }
        Deque<Long> window = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= maxPerWindow) {
                return false;
            }
            window.addLast(now);
            return true;
        }
    }

    // Clock seam so tests can drive the window without sleeping.
    protected long nowMillis() {
        return System.currentTimeMillis();
    }

    /** Drop every tracked window. For tests. */
    public void clear() {
        hits.clear();
        callsSinceSweep.set(0);
    }

    // Drop clients whose window has fully aged out. The key is removed only if still
    // mapped to the same empty deque, so a racing allow() at worst lets one through.
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

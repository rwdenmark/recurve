package com.rangersurvivor.controller;

import com.rangersurvivor.service.GameSessionService;
import com.rangersurvivor.service.SubmissionRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Opens a server-timed game session. The returned id is sent back with the score so
 * the server can check the run length against the real elapsed time.
 */
@RestController
@RequestMapping("/api/game")
public class GameSessionController {

    // Each start allocates a session entry, so cap the burst. Own limiter instance
    // with its own budget, a start storm must not eat the score submission window.
    private static final int MAX_STARTS_PER_MINUTE = 20;

    private final GameSessionService sessions;
    private final SubmissionRateLimiter rateLimiter = new SubmissionRateLimiter(MAX_STARTS_PER_MINUTE);

    public GameSessionController(GameSessionService sessions) {
        this.sessions = sessions;
    }

    @PostMapping("/start")
    public ResponseEntity<?> start(HttpServletRequest request) {
        if (!rateLimiter.allow(clientKey(request))) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("message", "Too many game starts. Try again shortly."));
        }
        return ResponseEntity.ok(Map.of("sessionId", sessions.start()));
    }

    private String clientKey(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            // First hop is the client behind a proxy. Client-settable, so it only
            // stops casual spam, not a caller who rotates the header.
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}

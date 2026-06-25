package com.rangersurvivor.controller;

import com.rangersurvivor.dto.ScoreSubmission;
import com.rangersurvivor.dto.ScoreView;
import com.rangersurvivor.model.Score;
import com.rangersurvivor.repository.ScoreRepository;
import com.rangersurvivor.service.ProfanityFilter;
import com.rangersurvivor.service.SubmissionRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scores")
public class ScoreController {

    // Plausibility gate. Enemy supply is capped by the spawn cadence (floors at
    // one every 500ms), so sustained kills can't outrun a few per second. The
    // burst allowance absorbs an early flurry on a short run. Anything past this
    // is a forged submission.
    private static final int MAX_KILLS_PER_SECOND = 4;
    private static final int KILL_BURST_ALLOWANCE = 15;

    private final ScoreRepository scoreRepository;
    private final ProfanityFilter profanityFilter;
    private final SubmissionRateLimiter rateLimiter;

    public ScoreController(ScoreRepository scoreRepository,
                           ProfanityFilter profanityFilter,
                           SubmissionRateLimiter rateLimiter) {
        this.scoreRepository = scoreRepository;
        this.profanityFilter = profanityFilter;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping
    public ResponseEntity<?> submit(@Valid @RequestBody ScoreSubmission submission,
                                    HttpServletRequest request) {
        if (!rateLimiter.allow(clientKey(request))) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("message", "Too many submissions. Try again shortly."));
        }
        if (!isPlausible(submission.kills(), submission.durationSeconds())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Score rejected"));
        }
        if (profanityFilter.isProfane(submission.name())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Name not allowed"));
        }
        Score score = new Score(submission.name(), submission.kills(), submission.durationSeconds());
        score.setSubmittedAt(Instant.now());
        Score saved = scoreRepository.save(score);
        return ResponseEntity.ok(ScoreView.from(saved));
    }

    @GetMapping("/top")
    public List<ScoreView> top(@RequestParam(defaultValue = "10") int limit) {
        int capped = Math.min(Math.max(limit, 1), 100);
        return scoreRepository.findAllByOrderByKillsDescDurationSecondsAsc(PageRequest.of(0, capped))
                .stream()
                .map(ScoreView::from)
                .toList();
    }

    private boolean isPlausible(int kills, int durationSeconds) {
        return kills <= (long) durationSeconds * MAX_KILLS_PER_SECOND + KILL_BURST_ALLOWANCE;
    }

    private String clientKey(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            // First hop is the originating client when behind a proxy.
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}

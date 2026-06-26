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

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scores")
public class ScoreController {

    // Reject kills that can't be reached in the elapsed time. Enemy supply is capped
    // by the spawn cadence (up to 8 forts every ~0.6s, so ~13/s), and the board holds
    // at most 40 at once (the burst). These sit a little above those so a strong build
    // isn't rejected. The client sends its own durationSeconds, so this catches casual
    // tampering, not a determined forger.
    private static final int MAX_KILLS_PER_SECOND = 15;
    private static final int KILL_BURST_ALLOWANCE = 50;

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
            // First hop is the client behind a proxy. Client-settable, so it only
            // stops casual spam, not a caller who rotates the header.
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}

package com.recurve.controller;

import com.recurve.dto.ScoreSubmission;
import com.recurve.dto.ScoreView;
import com.recurve.model.Score;
import com.recurve.repository.ScoreRepository;
import com.recurve.service.GameSessionService;
import com.recurve.service.ProfanityFilter;
import com.recurve.service.SpawnModel;
import com.recurve.service.ClientRateLimiter;
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

    // Slack on the spawn-model bound for tick timing jitter. The client floors
    // durationSeconds, so the bound itself is computed on duration + 1.
    private static final int KILL_SLACK = 40;
    // The client's run clock can start slightly before the server creates the session
    // (request latency), so allow this much over the server-measured elapsed time.
    private static final int CLOCK_SKEW_SECONDS = 5;

    private final ScoreRepository scoreRepository;
    private final ProfanityFilter profanityFilter;
    private final ClientRateLimiter rateLimiter;
    private final GameSessionService sessions;

    public ScoreController(ScoreRepository scoreRepository,
                           ProfanityFilter profanityFilter,
                           ClientRateLimiter rateLimiter,
                           GameSessionService sessions) {
        this.scoreRepository = scoreRepository;
        this.profanityFilter = profanityFilter;
        this.rateLimiter = rateLimiter;
        this.sessions = sessions;
    }

    @PostMapping
    public ResponseEntity<?> submit(@Valid @RequestBody ScoreSubmission submission,
                                    HttpServletRequest request) {
        if (!rateLimiter.allow(ClientKey.from(request))) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("message", "Too many submissions. Try again shortly."));
        }
        // The run must come from a real session, can't claim more time than has elapsed
        // since it started, and can't claim more kills than the spawner could produce.
        Long startMillis = sessions.startMillis(submission.sessionId());
        if (startMillis == null) {
            return rejected();
        }
        long elapsedSeconds = (System.currentTimeMillis() - startMillis) / 1000;
        if (submission.durationSeconds() > elapsedSeconds + CLOCK_SKEW_SECONDS) {
            return rejected();
        }
        // The model spans the whole run (spawn pacing is card-driven, not per-level), so
        // one bound covers every level and cycle. +1 covers the client's floored duration.
        if (submission.kills() > SpawnModel.maxKills(submission.durationSeconds() + 1) + KILL_SLACK) {
            return rejected();
        }
        // Trimmed once here so the filter and the stored row see the same name.
        // @NotBlank already guarantees there is something left after the trim.
        String name = submission.name().trim();
        if (containsInvisible(name)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Name contains invisible or control characters"));
        }
        // Checked before consuming the session so a profane name can be fixed and resubmitted.
        if (profanityFilter.isProfane(name)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Name not allowed"));
        }
        if (!sessions.consume(submission.sessionId())) {
            return rejected(); // already submitted, or swept between the checks
        }
        Score score = new Score(name, submission.kills(), submission.durationSeconds());
        Score saved = scoreRepository.save(score);
        return ResponseEntity.ok(ScoreView.from(saved));
    }

    private ResponseEntity<?> rejected() {
        return ResponseEntity.badRequest().body(Map.of("message", "Score rejected"));
    }

    // Blocklist by Unicode category plus the known stragglers. Real names in any
    // language pass. Rejected are the characters that render as nothing or reorder
    // text, since any of those can blank or spoof a leaderboard row: every format
    // character (bidi controls and marks, zero-widths, soft hyphen, BOM, tag
    // characters), line and paragraph separators, variation selectors, the Hangul
    // filler letters that render as blank glyphs, and ordinary control characters.
    // Iterates by code point because several of these sit outside the BMP.
    private static boolean containsInvisible(String name) {
        for (int i = 0; i < name.length(); ) {
            int cp = name.codePointAt(i);
            if (Character.isISOControl(cp)) return true;
            int type = Character.getType(cp);
            if (type == Character.FORMAT) return true;       // Cf: bidi, zero-widths, soft hyphen, BOM, tags
            if (type == Character.LINE_SEPARATOR || type == Character.PARAGRAPH_SEPARATOR) return true;
            if (cp >= 0xFE00 && cp <= 0xFE0F) return true;   // variation selectors
            if (cp >= 0xE0100 && cp <= 0xE01EF) return true; // variation selectors supplement
            if (cp == 0x115F || cp == 0x1160 || cp == 0x3164 || cp == 0xFFA0) return true; // hangul fillers
            i += Character.charCount(cp);
        }
        return false;
    }

    @GetMapping("/top")
    public List<ScoreView> top(@RequestParam(defaultValue = "10") int limit) {
        int capped = Math.min(Math.max(limit, 1), 100);
        return scoreRepository.findAllByOrderByKillsDescDurationSecondsAsc(PageRequest.of(0, capped))
                .stream()
                .map(ScoreView::from)
                .toList();
    }
}

package com.recurve;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recurve.service.GameSessionService;
import com.recurve.service.ProfanityFilter;
import com.recurve.service.ClientRateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ScoreControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    // Mocked so the suite never touches the live PurgoMalum API.
    @MockBean
    private ProfanityFilter profanityFilter;

    // Mocked so tests control the server-measured run time without waiting.
    @MockBean
    private GameSessionService sessions;

    // The live limiter bean, reset per test so no test inherits another's window.
    @Autowired
    private ClientRateLimiter rateLimiter;

    @BeforeEach
    void defaults() {
        // A session that started 10 minutes ago, so any plausible duration fits.
        // (ProfanityFilter is left at its default mock verdict of false. profaneName
        // stubs it true, and tests that reject earlier never reach it.)
        when(sessions.startMillis(anyString())).thenReturn(System.currentTimeMillis() - 600_000L);
        when(sessions.consume(anyString())).thenReturn(true);
        rateLimiter.clear();
    }

    private String json(String name, int kills, int durationSeconds) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "name", name,
                "kills", kills,
                "durationSeconds", durationSeconds,
                "sessionId", "test-session"));
    }

    @Test
    void validScoreRoundTripsThroughTheTopEndpoint() throws Exception {
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 42, 130)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("ryan"))
                .andExpect(jsonPath("$.kills").value(42));

        mockMvc.perform(get("/api/scores/top?limit=5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("ryan"))
                .andExpect(jsonPath("$[0].kills").value(42));
    }

    @Test
    void submittedNameIsTrimmedBeforeStorage() throws Exception {
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("  ryan  ", 42, 130)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("ryan"));
    }

    @Test
    void profaneNameIsRejected() throws Exception {
        when(profanityFilter.isProfane(anyString())).thenReturn(true);

        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("badword", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name not allowed"));
    }

    @Test
    void rtlOverrideNameIsRejected() throws Exception {
        // U+202E reverses render order, letting a name spoof how it reads on the board.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan\u202Enayr", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name contains invisible or control characters"));
    }

    @Test
    void zeroWidthNameIsRejected() throws Exception {
        // A zero-width space renders as nothing, so two visually identical names could differ.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ry\u200Ban", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name contains invisible or control characters"));
    }

    @Test
    void variationSelectorNameIsRejected() throws Exception {
        // U+FE0F renders as nothing on its own, so it can pad an otherwise identical name.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan\uFE0F", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name contains invisible or control characters"));
    }

    @Test
    void tagCharacterNameIsRejected() throws Exception {
        // Tag characters (U+E0000-E007F) are invisible and can smuggle hidden text.
        // The surrogate pair below is U+E0041, TAG LATIN CAPITAL LETTER A.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan\uDB40\uDC41", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name contains invisible or control characters"));
    }

    @Test
    void variationSelectorSupplementNameIsRejected() throws Exception {
        // The surrogate pair below is U+E0100, VARIATION SELECTOR-17, outside the BMP.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan\uDB40\uDD00", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name contains invisible or control characters"));
    }

    @Test
    void internationalNamesAreAccepted() throws Exception {
        // The check targets invisible characters only. Accented and CJK names pass.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("Jos\u00E9", 10, 60)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Jos\u00E9"));

        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("\u9F8D", 5, 61)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("\u9F8D"));
    }

    @Test
    void blankNameIsRejected() throws Exception {
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("   ", 10, 60)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void missingSessionIsRejectedBeforeProfanityCheck() throws Exception {
        when(sessions.startMillis(anyString())).thenReturn(null);

        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(profanityFilter, never()).isProfane(anyString());
    }

    @Test
    void durationLongerThanTheSessionIsRejected() throws Exception {
        // Session started 5s ago, but the run claims 130s of play.
        when(sessions.startMillis(anyString())).thenReturn(System.currentTimeMillis() - 5_000L);

        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 10, 130)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));
    }

    @Test
    void implausibleKillCountIsRejectedBeforeProfanityCheck() throws Exception {
        // 99999 kills in 5 seconds is far more than the spawner could produce.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 99999, 5)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(profanityFilter, never()).isProfane(anyString());
    }

    @Test
    void submissionsAreRateLimitedPerClient() throws Exception {
        // The limiter is cleared in defaults(). The header exercises the
        // X-Forwarded-For key path rather than the default 127.0.0.1.
        String client = "203.0.113.7";
        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/api/scores")
                            .header("X-Forwarded-For", client)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json("ryan", 5, 60)))
                    .andExpect(status().isOk());
        }
        mockMvc.perform(post("/api/scores")
                        .header("X-Forwarded-For", client)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 5, 60)))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.message").value("Too many submissions. Try again shortly."));
    }

    @Test
    void topLimitIsClampedToValidRange() throws Exception {
        // Out-of-range limits must be clamped to 1..100, not passed straight to
        // PageRequest, which would throw on a non-positive page size.
        mockMvc.perform(get("/api/scores/top?limit=100000")).andExpect(status().isOk());
        mockMvc.perform(get("/api/scores/top?limit=-5")).andExpect(status().isOk());
    }
}

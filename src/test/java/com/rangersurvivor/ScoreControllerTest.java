package com.rangersurvivor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rangersurvivor.service.ProfanityFilter;
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

    private String json(String name, int kills, int durationSeconds) throws Exception {
        return objectMapper.writeValueAsString(
                Map.of("name", name, "kills", kills, "durationSeconds", durationSeconds));
    }

    @Test
    void validScoreRoundTripsThroughTheTopEndpoint() throws Exception {
        when(profanityFilter.isProfane(anyString())).thenReturn(false);

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
    void profaneNameIsRejected() throws Exception {
        when(profanityFilter.isProfane(anyString())).thenReturn(true);

        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("badword", 10, 60)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name not allowed"));
    }

    @Test
    void blankNameIsRejected() throws Exception {
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("   ", 10, 60)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void implausibleScoreIsRejectedBeforeProfanityCheck() throws Exception {
        // 99999 kills in 5 seconds is impossible given the spawn cadence.
        mockMvc.perform(post("/api/scores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("ryan", 99999, 5)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(profanityFilter, never()).isProfane(anyString());
    }

    @Test
    void submissionsAreRateLimitedPerClient() throws Exception {
        when(profanityFilter.isProfane(anyString())).thenReturn(false);
        // Unique client so this test's window does not collide with other tests
        // sharing the limiter bean (they use the default 127.0.0.1).
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

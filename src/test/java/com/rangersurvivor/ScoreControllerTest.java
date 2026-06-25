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

    // Mocked so the suite never touches the live PurgoMalum API. Each test
    // stubs the verdict it needs.
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
}

package com.rangersurvivor;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class GameSessionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    // The controller owns its limiter instance, so each test uses a unique client
    // to keep its window separate from the other tests sharing the context.

    @Test
    void startReturnsASessionId() throws Exception {
        mockMvc.perform(post("/api/game/start").header("X-Forwarded-For", "203.0.113.20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").isNotEmpty());
    }

    @Test
    void startsAreRateLimitedPerClient() throws Exception {
        String client = "203.0.113.21";
        for (int i = 0; i < 20; i++) {
            mockMvc.perform(post("/api/game/start").header("X-Forwarded-For", client))
                    .andExpect(status().isOk());
        }
        mockMvc.perform(post("/api/game/start").header("X-Forwarded-For", client))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.message").value("Too many game starts. Try again shortly."));
    }
}

package com.rangersurvivor.service;

import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Profanity / racism filter that delegates to the free PurgoMalum REST API.
 *
 * Why an external API: keeps the wordlist (and its inevitable updates) off
 * our server. PurgoMalum is no-auth, no-signup, plain HTTP GET.
 *
 * Fail-open: if the upstream is unreachable or slow we ALLOW the submission
 * rather than blocking legitimate players when their internet is shaky. The
 * leaderboard is low-stakes; treating an outage as "all clear" is fine.
 *
 * Timeouts are set so a hung upstream trips the fail-open path quickly instead
 * of tying up a request thread.
 */
@Service
public class ProfanityFilter {

    private static final String CONTAINS_URL =
            "https://www.purgomalum.com/service/containsprofanity?text=";

    private final RestClient restClient = RestClient.builder()
            .requestFactory(timeoutFactory())
            .build();

    private static SimpleClientHttpRequestFactory timeoutFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(3));
        return factory;
    }

    public boolean isProfane(String text) {
        if (text == null || text.isBlank()) return false;
        try {
            String encoded = URLEncoder.encode(text, StandardCharsets.UTF_8);
            String body = restClient.get()
                    .uri(CONTAINS_URL + encoded)
                    .retrieve()
                    .body(String.class);
            return body != null && body.trim().equalsIgnoreCase("true");
        } catch (Exception e) {
            return false;
        }
    }
}

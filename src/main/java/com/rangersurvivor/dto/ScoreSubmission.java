package com.rangersurvivor.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Inbound score submission. The bounds here are a first gate; the controller's
 * plausibility check (kills reachable in the elapsed time) is the second.
 */
public record ScoreSubmission(
        @NotBlank @Size(max = 24) String name,
        @Min(0) @Max(100_000) int kills,
        @Min(0) @Max(86_400) int durationSeconds
) {
}

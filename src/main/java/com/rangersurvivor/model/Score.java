package com.rangersurvivor.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

@Entity
public class Score {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank
    @Size(max = 24)
    @Column(length = 24, nullable = false)
    private String name;

    @Min(0)
    private int kills;

    @Min(0)
    private int durationSeconds;

    private Instant submittedAt;

    public Score() {
    }

    public Score(String name, int kills, int durationSeconds) {
        this.name = name;
        this.kills = kills;
        this.durationSeconds = durationSeconds;
        this.submittedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getKills() {
        return kills;
    }

    public int getDurationSeconds() {
        return durationSeconds;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }
}

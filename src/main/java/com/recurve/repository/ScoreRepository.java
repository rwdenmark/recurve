package com.recurve.repository;

import com.recurve.model.Score;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScoreRepository extends JpaRepository<Score, Long> {

    List<Score> findAllByOrderByKillsDescDurationSecondsAsc(Pageable pageable);
}

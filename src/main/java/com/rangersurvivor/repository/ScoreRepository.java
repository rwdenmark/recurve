package com.rangersurvivor.repository;

import com.rangersurvivor.model.Score;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScoreRepository extends JpaRepository<Score, Long> {

    List<Score> findAllByOrderByKillsDescDurationSecondsAsc(Pageable pageable);
}

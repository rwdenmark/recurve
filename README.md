# Ranger Survivor

A top-down tile-based survival shooter. Hold WASD to move, hold an arrow key to fire, and survive waves of enemies that get faster and tougher. A college-project recreation rebuilt as a browser game on an HTML5 Canvas with a Spring Boot backend for leaderboards.

## Gameplay

- Pick one of three archer skins on the menu (cosmetic only).
- Move continuously by holding WASD. Path tiles are faster than grass, water and trees block.
- Hold an arrow key to fire in any of 8 directions at a fixed cadence.
- Three hearts. An enemy that reaches you winds up an attack, and a connected hit costs a heart. Zero hearts ends the run.
- Three enemy types spawn from the corner and edge forts: enemy_one (1 arrow to kill), enemy_two (2 arrows, unlocks at 45s), enemy_three (4 arrows, unlocks at 90s). Newer types ramp in gradually and the overall spawn rate accelerates with kills.
- Every 15 kills the run pauses and offers three random upgrade cards: extra/refilled hearts, movement speed, fire rate, arrow damage, or multi-shot (a 3-arrow fan). Buffs stack for the rest of the run.

## Architecture

**Frontend** is a single-page HTML5 Canvas game in plain JavaScript, served as static files from the Spring Boot backend at `/`.

- Game loop driven by `requestAnimationFrame`.
- Tile grid stored as a 2D array, drawn each frame from 48px tile sprites (grass, path, water, tree), with the map border built from rotated mountain side and corner pieces. Map generation runs BFS reachability so every fort can reach the player.
- Sprite-sheet animation system (idle/walk/run/attack/hurt/die) anchored per character so sprites stay put across poses.
- Enemies path toward the player with A* on the tile grid and respect the same terrain speed multipliers the player does.
- Music and sound effects play through the Web Audio API with separate volume controls.

**Backend** is a Spring Boot REST API for high scores.

- `POST /api/scores` accepts `{ name, kills, durationSeconds }`. Validated, bounds-checked, rejects implausible scores, rate-limited per client, and run through a profanity filter before persisting.
- `GET /api/scores/top?limit=N` returns the top N scores by kills (limit clamped to 1..100).
- `GET /api/health` is a fast liveness probe that also wakes the database.

H2 in-memory database for local development. The prod profile uses Postgres with Flyway-managed migrations (`db/migration`).

## Quick start

Requires Java 17+ and Maven.

```bash
cd ranger-survivor
mvn spring-boot:run
# open http://localhost:8080 in a browser
```

The H2 console is at `http://localhost:8080/h2-console` (jdbc url `jdbc:h2:mem:rangersurvivor`, user `sa`, no password).

## Project structure

```
ranger-survivor/
├── README.md
├── pom.xml
├── src/main/java/com/rangersurvivor/
│   ├── RangerSurvivorApplication.java
│   ├── controller/        # ScoreController, HealthController
│   ├── dto/               # ScoreSubmission (in), ScoreView (out)
│   ├── model/Score.java
│   ├── repository/ScoreRepository.java
│   └── service/           # ProfanityFilter, SubmissionRateLimiter
├── src/main/resources/
│   ├── application.yml
│   ├── db/migration/      # Flyway migrations (prod/Postgres)
│   └── static/
│       ├── index.html
│       ├── game.js
│       ├── styles.css
│       └── sprites/       # tile sprites + character animation sheets
└── src/test/java/com/rangersurvivor/
    ├── ScoreControllerTest.java
    └── ProfanityFilterTest.java
```

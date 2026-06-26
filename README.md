# Ranger Survivor

A top-down tile-based survival shooter. Move with WASD, aim with the mouse and left-click to shoot, and survive waves of enemies that get faster and tougher. A college-project recreation rebuilt as a browser game on an HTML5 Canvas with a Spring Boot backend for leaderboards.

## Gameplay

- Pick one of three rangers on the menu. Each has its own movement speed, damage, attack speed, and hearts, shown as filled pips on its card.
- Move continuously by holding WASD. Path tiles are faster than grass, water and trees block.
- Aim with the mouse and hold left-click to fire arrows straight at the cursor at a fixed cadence. The ranger faces the cursor. Press space to pause.
- Hearts deplete when an enemy that reaches you lands a windup attack. Zero hearts ends the run.
- Three enemy types spawn from the corner and edge forts: enemy_one, enemy_two (unlocks at 45s), enemy_three (unlocks at 90s), each tougher than the last. Newer types ramp in gradually and the overall spawn rate accelerates with kills.
- Every 15 kills the run pauses and offers three random upgrade cards: extra or refilled hearts, movement speed, fire rate, arrow damage, arrow piercing, arrow distance, multi-shot (a 3-arrow fan), or omni-shot (all 8 directions, unlocked once multi-shot is taken). Buffs stack for the rest of the run.

## Architecture

**Frontend** is a single-page HTML5 Canvas game in plain JavaScript, served as static files from the Spring Boot backend at `/`.

- Game loop driven by `requestAnimationFrame`.
- Tile grid stored as a 2D array, drawn each frame from 48px tile sprites (grass, path, water, tree), with the map border built from rotated mountain side and corner pieces. Procedural map generation lives in `mapgen.js` (a pure, DOM-free module) and runs BFS reachability so every fort can reach the player.
- Sprite-sheet animation system (idle/walk/run/attack/hurt/die) anchored per character so sprites stay put across poses.
- Every enemy chases the player, so pathfinding is a single BFS flow field (`pathfinding.js`): one breadth-first sweep from the player each time it changes tiles builds a distance field, and every enemy steps to the neighbor closest to the player. Enemies respect the same terrain speed multipliers the player does.
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

## Tests

```bash
mvn test        # backend: controller + profanity-filter tests
node --test     # frontend: map-generation property tests (requires Node 18+)
```

The frontend tests generate hundreds of maps and assert the generator's invariants: every fort reachable from the player, paths kept one tile wide, water orthogonally connected, and obstacle counts within their caps.

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
│       ├── game.js           # game loop, input, rendering
│       ├── mapgen.js         # pure tile-world model + map generation
│       ├── pathfinding.js    # pure BFS flow-field pathfinding
│       ├── styles.css
│       └── sprites/          # tile sprites + character animation sheets
├── package.json             # frontend test runner (node --test)
└── src/test/
    ├── java/com/rangersurvivor/
    │   ├── ScoreControllerTest.java
    │   └── ProfanityFilterTest.java
    └── js/
        ├── mapgen.test.js      # map-generation property tests
        └── pathfinding.test.js # flow-field tests
```

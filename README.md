# Ranger Survivor

A top-down tile-based survival shooter. Move with WASD, aim with the mouse and left-click to shoot, and survive waves of enemies that get faster and tougher. A college-project recreation rebuilt as a browser game on an HTML5 Canvas with a Spring Boot backend for leaderboards.

## Gameplay

- Pick one of three rangers on the menu. Each has its own movement speed, damage, attack speed, and hearts, shown as filled pips on its card.
- Move continuously by holding WASD. Path tiles are faster than grass, water and trees block.
- Aim with the mouse and hold left-click to fire arrows straight at the cursor at a fixed cadence. The ranger faces the cursor. Press space to pause.
- Hearts deplete when an enemy that reaches you lands a windup attack. Zero hearts ends the run.
- Three enemy types spawn from the corner and edge forts, each tougher than the last. enemy_one is there from the start, enemy_two unlocks after the third upgrade card (about 45 kills), enemy_three after the sixth (about 90 kills). A type spawns at full weight the moment it unlocks, and the overall spawn rate accelerates with elapsed time.
- Every 15 kills the run pauses and offers three random upgrade cards. The pool covers extra or refilled hearts, movement speed, fire rate, arrow damage, arrow piercing, arrow distance, multi-shot (a 3-arrow fan), and omni-shot (all 8 directions, unlocked once multi-shot is taken). Buffs stack for the rest of the run.

## Architecture

**Frontend** is a single-page HTML5 Canvas game in plain JavaScript, served as static files from the Spring Boot backend at `/`. `game.js` owns the game loop, input, and rendering, with the rest split into ES modules (`mapgen.js`, `pathfinding.js`, `audio.js`, `hud.js`, `buffs.js`, `net.js`).

- Game loop driven by `requestAnimationFrame`.
- Tile grid stored as a 2D array, drawn each frame from 48px tile sprites (grass, path, water, tree), with the map border built from rotated mountain side and corner pieces. Procedural map generation lives in `mapgen.js` (a pure, DOM-free module) and runs BFS reachability so every fort can reach the player.
- Sprite-sheet animation system (idle/walk/run/attack/hurt/die) anchored per character so sprites stay put across poses.
- Every enemy chases the player, so pathfinding is a single BFS flow field (`pathfinding.js`). One breadth-first sweep from the player each time it changes tiles builds a distance field, and every enemy steps to the neighbor closest to the player. Enemies respect the same terrain speed multipliers the player does.
- Music plays through looping HTML audio elements and sound effects through the Web Audio API, each with its own volume control (`audio.js`).

**Backend** is a Spring Boot REST API for high scores.

- `POST /api/game/start` opens a server-timed session and returns its id. Rate limited to 20 starts per minute per client.
- `POST /api/scores` accepts `{ name, kills, durationSeconds, sessionId }`. Submissions are rate-limited per client first. The server then checks the session exists, that the claimed run length doesn't exceed the real elapsed time since the session started, and that the kill count is within what the spawn schedule could produce in that time (a model mirrored from the frontend, so there's no hand-tuned cap to re-tune when balance changes). The name is trimmed server-side and rejected if it contains invisible or bidi control characters, then a profanity filter runs on it, and only then is the single-use session consumed and the score persisted. Sessions live in memory, so a server restart mid-run means that run's score can't be submitted. This stops casual tampering but isn't full anti-cheat, which would need server-side replay.
- `GET /api/scores/top?limit=N` returns the top N scores by kills (limit clamped to 1..100).
- `GET /api/health` is a fast liveness probe that also wakes the database.

H2 in-memory database for local development. The prod profile uses Postgres with Flyway-managed migrations (`db/migration`).

## Quick start

Requires Java 17+. The Maven wrapper is included.

```bash
cd ranger-survivor
./mvnw spring-boot:run
# open http://localhost:8080 in a browser
```

The H2 console is at `http://localhost:8080/h2-console` (jdbc url `jdbc:h2:mem:rangersurvivor`, user `sa`, no password).

## Tests

```bash
./mvnw test                # backend tests (controllers, sessions, health, spawn model, profanity filter, rate limiter)
node --test src/test/js    # frontend tests (map generation + pathfinding, Node 18+)
```

The frontend tests generate hundreds of maps and assert the generator's invariants. Every fort is reachable from the player, paths stay one tile wide, water is orthogonally connected, and obstacle counts stay within their caps.

## Project structure

```
ranger-survivor/
├── README.md
├── pom.xml
├── Dockerfile
├── render.yaml
├── package.json             # frontend test runner (node --test)
├── src/main/java/com/rangersurvivor/
│   ├── RangerSurvivorApplication.java
│   ├── controller/        # ScoreController, GameSessionController, HealthController
│   ├── dto/               # ScoreSubmission (in), ScoreView (out)
│   ├── model/Score.java
│   ├── repository/ScoreRepository.java
│   └── service/           # GameSessionService, SpawnModel, ProfanityFilter, SubmissionRateLimiter
├── src/main/resources/
│   ├── application.yml
│   ├── db/migration/      # Flyway migrations (prod/Postgres)
│   └── static/
│       ├── index.html
│       ├── game.js           # game loop, input, rendering
│       ├── mapgen.js         # pure tile-world model + map generation
│       ├── pathfinding.js    # pure BFS flow-field pathfinding
│       ├── audio.js          # music tracks + Web Audio SFX
│       ├── buffs.js          # stat defaults, run buffs, upgrade cards
│       ├── hud.js            # hearts, kill counter, run timer
│       ├── net.js            # leaderboard + score submission
│       ├── styles.css
│       ├── audio/            # music + SFX files
│       └── sprites/          # tile sprites + character animation sheets
└── src/test/
    ├── java/com/rangersurvivor/
    │   ├── ScoreControllerTest.java
    │   ├── GameSessionControllerTest.java
    │   ├── GameSessionServiceTest.java
    │   ├── HealthControllerTest.java
    │   ├── SpawnModelTest.java
    │   ├── ProfanityFilterTest.java
    │   └── SubmissionRateLimiterTest.java
    └── js/
        ├── mapgen.test.js      # map-generation property tests
        └── pathfinding.test.js # flow-field tests
```

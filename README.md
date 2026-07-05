# Ranger Survivor

A top-down tile-based survival shooter. Move with WASD, aim with the mouse and left-click to shoot, and survive waves of enemies that get faster and tougher. Clear the first level and the run drops into a cave for a second level against trolls. A college-project recreation rebuilt as a browser game on an HTML5 Canvas with a Spring Boot backend for leaderboards.

## Gameplay

- Pick one of three rangers on the menu. Each has its own movement speed, damage, attack speed, and hearts, shown as filled pips on its card.
- Move continuously by holding WASD. Path tiles are faster than open ground. Water and solid terrain block movement.
- Aim with the mouse and hold left-click to fire arrows straight at the cursor at a fixed cadence. The ranger faces the cursor. Press space to pause.
- Hearts deplete when an enemy that reaches you lands a windup attack. Zero hearts ends the run.
- Every 15 kills the run pauses and offers three random upgrade cards. The pool covers extra or refilled hearts, movement speed, fire rate, arrow damage, arrow piercing, arrow distance, multi-shot (a 3-arrow fan), and omni-shot (all 8 directions, unlocked once multi-shot is taken). Buffs stack for the whole run and carry across both levels.

### Level 1, the grass field

- Knights spawn from the corner and edge forts, each type tougher than the last. enemy_one is there from the start, enemy_two unlocks after the third upgrade card (about 45 kills), enemy_three after the sixth (about 90 kills). A type spawns at full weight the moment it unlocks, and the spawn rate accelerates with elapsed time.

### Level 2, the cave

- Taking the 8th upgrade card ends level 1. The screen pixelates to black over 4 seconds, then the cave pixelates in over another 4 seconds, and the ranger starts in the middle of the map.
- The enemies are three trolls that mirror the matching knight's speed, damage, and attack windup, with double the health. troll_one spawns from the start of level 2, troll_two after 2 cards taken in level 2, and troll_three after 4. They enter from the portals on the top and bottom walls.
- The cave adds water pools, lava pools, and stalagmites. Water and lava stop movement and arrows fly over them. Stalagmites block movement and arrows both.
- Kills and every buff carry over from level 1. The spawn rate restarts when level 2 begins, so it opens sparse and builds again.

## Architecture

**Frontend** is a single-page HTML5 Canvas game in plain JavaScript, served as static files from the Spring Boot backend at `/`. `game.js` owns the game loop, input, the level system, and rendering, with the rest split into ES modules (`mapgen.js`, `level2.js`, `pathfinding.js`, `audio.js`, `hud.js`, `buffs.js`, `net.js`).

- Game loop driven by `requestAnimationFrame`.
- Level 1's tile grid is stored as a 2D array, drawn each frame from 48px tile sprites (grass, path, water, tree), with the map border built from rotated mountain side and corner pieces. Its map generation lives in `mapgen.js`, a pure DOM-free module, and runs BFS reachability so every fort can reach the player.
- Level 2 is generated in the browser the same way, by `level2.js`. It grows organic water and lava pools, dirt paths from each spawn to the center, and stalagmite obstacles, then paints the whole cave once to an offscreen canvas that the loop blits each frame. Water gets a foam edge and lava a charred edge, computed at pixel resolution. A tile terrain grid drives collision and pathfinding, so the game code never branches on the level for movement or arrows.
- Sprite-sheet animation system (idle/walk/run/attack/hurt/die) anchored per character so sprites stay put across poses. Rangers, knights, and trolls all share the same 6-row 10-frame layout.
- Every enemy chases the player, so pathfinding is a single BFS flow field (`pathfinding.js`). One breadth-first sweep from the player each time it changes tiles builds a distance field, and every enemy steps to the neighbor closest to the player. The same search serves both levels, taking the cave's terrain rules as a blocked-tile test so trolls route around the pools and rocks.
- Each level has its own randomized music playlist. Music plays through looping HTML audio elements and sound effects through the Web Audio API, each with its own volume control (`audio.js`).
- Art and audio are split by level under `static/level_one/` and `static/level_two/`.

**Backend** is a Spring Boot REST API for high scores.

- `POST /api/game/start` opens a server-timed session and returns its id. Rate limited to 20 starts per minute per client.
- `POST /api/scores` accepts `{ name, kills, durationSeconds, sessionId }`. Submissions are rate-limited per client first. The server then checks the session exists, that the claimed run length doesn't exceed the real elapsed time since the session started, and that the kill count is within what the spawn schedule could produce in that time (a model mirrored from the frontend, so there's no hand-tuned cap to re-tune when balance changes). Because a run now spans two levels, the kill bound allows two levels' worth of that schedule. The name is trimmed server-side and rejected if it contains invisible or bidi control characters, then a profanity filter runs on it, and only then is the single-use session consumed and the score persisted. Sessions live in memory, so a server restart mid-run means that run's score can't be submitted. This stops casual tampering but isn't full anti-cheat, which would need server-side replay.
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

The frontend tests generate hundreds of level 1 maps and assert the generator's invariants. Every fort is reachable from the player, paths stay one tile wide, water is orthogonally connected, and obstacle counts stay within their caps.

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
│       ├── game.js           # game loop, input, level system, rendering
│       ├── mapgen.js         # level 1 tile-world model + map generation
│       ├── level2.js         # level 2 cave generation + froth/char rendering
│       ├── pathfinding.js    # pure BFS flow-field pathfinding
│       ├── audio.js          # per-level music playlists + Web Audio SFX
│       ├── buffs.js          # stat defaults, run buffs, upgrade cards
│       ├── hud.js            # hearts, kill counter, run timer
│       ├── net.js            # leaderboard + score submission
│       ├── styles.css
│       ├── level_one/        # level 1 sprites, tiles, and audio
│       └── level_two/        # cave sprites, troll sheets, and audio
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

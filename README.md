# Recurve

A top-down tile-based survival shooter. Move with WASD, aim with the mouse and left-click to shoot, and survive waves of enemies that get faster and tougher. Clear the grass field, drop into a cave against trolls, then a flooded sewer against necromancers, then loop forever, each pass tougher than the last. A college-project recreation rebuilt as a browser game on an HTML5 Canvas with a Spring Boot backend for leaderboards.

## Gameplay

- Pick one of three rangers on the menu. Each has its own movement speed, damage, attack speed, and hearts, shown as filled pips on its card.
- Move continuously by holding WASD. Path tiles are faster than open ground. Water and solid terrain block movement.
- Aim with the mouse and hold left-click to fire arrows straight at the cursor at a fixed cadence. The ranger faces the cursor. Press ESC to pause.
- Hearts deplete when an enemy that reaches you lands a windup attack. Zero hearts ends the run. After a non-fatal hit the ranger blinks and is invulnerable for 3 seconds, and can walk through enemies (but not walls, water, or rocks) to escape. If the window ends while still standing on an enemy, the ranger keeps phasing until it steps onto an open tile.
- Kills fill the XP bar toward the next upgrade card. A tier-1 enemy is worth 1 XP, a tier-2 enemy 2, and a tier-3 enemy 3, while the kill counter always ticks 1 per scoring kill. Card costs follow a hand-tuned track (`progression.js`). The first card lands after a few kills and each one costs more than the last. When the bar fills, the run pauses and offers three random upgrade cards. Take one instantly with the 1, 2, or 3 hotkey, or click a card and hit Confirm.
- The pool covers extra or refilled hearts, movement speed, fire rate, arrow damage, arrow piercing (up to three), arrow distance, multi-shot (each manual shot fans out to three arrows 10 degrees apart), and omni-shot (an automatic volley in all 8 directions, unlocked once multi-shot is taken, stacking to three levels that fire every 8, 7, then 5 seconds). Fire rate, damage, and distance ramp per copy with the later copies worth more, most cards cap at five copies, and a stacking card's final copy is offered with a gold border. Buffs stack for the whole run and carry through every level.
- Each ranger has an ultimate on Space, with its own upgrade cards that appear only for that ranger and always carry the ranger's color (blue, red, or green border). Gray vanishes for a few seconds while enemies wander, the crossbow ranger deploys ballista turrets that fight at 75% of its live stats, and the green ranger looses an arrow storm that hits every visible enemy in range at double damage.

### Level 1, the grass field

- Knights spawn from the corner and edge forts, each type tougher than the last. knight_one is there from the start, knight_two unlocks after the third upgrade card of the level, knight_three after the sixth. A type spawns at full weight the moment it unlocks, and the spawn rate climbs with every card taken (see The endless loop below).

### Level 2, the cave

- Spending a level's card budget ends it (8 cards on level 1 and 5 each on levels 2 and 3 in the first cycle, then 5 per level). The screen pixelates to black over 3 seconds, then the next level pixelates in over another 3 seconds, and the ranger starts in the middle of the map.
- The enemies are three trolls that mirror the matching knight's speed, damage, and attack windup, with far more health (8, 10, and 12 by default). troll_one spawns from the start of level 2, troll_two after the second card taken in level 2, and troll_three after the fourth (second and third from the second cycle on). They enter from the portals on the top and bottom walls.
- The cave adds water pools, lava pools, and rock and mineral obstacles. Water and lava stop movement and arrows fly over them. Rocks and minerals block movement and arrows both.
- Kills and every buff carry over between levels.

### Level 3, the sewer

- A flooded brick sewer generated in the browser by `level3.js`. WATER is the default fill and dry FLOOR is carved into it. A spaced-corridor backbone (Dijkstra, so corridors stay apart) with a loop circuit on each half links the 3x3 dry center, and each spawn, four wall portals plus four random floor grates, hangs off it as a dead-end leaf. Cleanup passes then fill any water the tileset can't paint cleanly (thin water, or a corner where two water edges meet with no matching piece) and drop any pool too small to hold a lit surface, so the autotiler always has room for clean water-to-wall and water-to-floor edges. A final pass breaks up wide open floor by punching water rooms into it, keeping every spawn connected to the center, which gives the level tighter corridors and more water. Floor grates render with a border variant matching whichever sides face water. Water blocks movement and arrows fly over it, like the cave.
- The enemies are three necromancers, ranged summoners rather than melee. They spawn from the wall portals and floor grates, path to within 4 tiles of the player, and cast a slow, non-homing orb every 5 seconds, aimed at the tile you occupy as the cast fires and fizzling there, so moving dodges it. They move at half the matching knight/troll tier's speed. necro_one spawns from the start, necro_two after the second card taken in level 3, necro_three after the fourth (second and third from the second cycle on).
- Each necromancer summons a matching skeleton minion (one at a time, on a 10-second cooldown from the first summon) when within 12 tiles. Skeletons are melee chasers that move at the knight/troll tier speed, and the third skeleton floats over water. Only necromancers count toward score and upgrade cards. Skeletons are pure threats, and they count against the performance cap so summons can never push the board past it.

### The endless loop

- The levels loop forever, level 1 to level 2 to level 3, back to level 1, and on until the ranger dies. Spending a level's card budget moves to the next level in the loop.
- Each time the loop wraps back to level 1 a new, harder cycle begins. Enemies gain a flat 10 health and 0.05 speed per cycle, so the second pass through the knights starts them at 12, 14, and 16 health, the trolls at 18, 20, and 22, and the necromancers (and their minions) at 24, 26, and 28, and it keeps climbing from there. Cards also come slower once the loop wraps. The first card of the second cycle costs 50 XP and every card after it adds 5 more, forever.
- The swarm scales with progress, not the clock. The spawn formulas read a spawn-equivalent card count (`progression.js`), anchored per level in the first cycle so levels 1 and 2 stay gentle and level 3 catches up to 24 equivalents, then stepping 1 per card. The target on-screen population is 6 plus 3 per spawn-equivalent card, and the top-up interval shortens from 600ms to a 175ms floor, so the board fills faster and faster. A per-cycle safety cap (100 plus 40 per cycle) holds the frame rate, but the intent is that the run eventually becomes unwinnable rather than dragging on forever.

## Architecture

**Frontend** is a single-page HTML5 Canvas game in plain JavaScript, served as static files from the Spring Boot backend at `/`. `game.js` owns the game loop, input, the level system, and rendering, with the rest split into ES modules (`mapgen.js`, `level2.js`, `level3.js`, `pathfinding.js`, `progression.js`, `chargequeue.js`, `shuffle.js`, `audio.js`, `hud.js`, `buffs.js`, `net.js`).

- Game loop driven by `requestAnimationFrame`.
- Card pacing (XP costs, cards per level, enemy-tier unlock timing, the spawn-equivalent card mapping) lives in `progression.js`, and the ultimate recharge queues in `chargequeue.js`. Both are DOM-free so node tests them directly, and the server's `SpawnModel.java` mirrors `progression.js` for its anti-cheat bound.
- Level 1's tile grid is stored as a 2D array, painted once per map from 48px tile sprites (grass, path, water, tree) to an offscreen canvas that the loop blits each frame, with the map border built from rotated mountain side and corner pieces. Its map generation lives in `mapgen.js`, a pure DOM-free module, and runs BFS reachability so every fort can reach the player. Level 2 reuses its wandering spawn-to-center route walker with the cave's own fort set.
- Level 2 is generated in the browser the same way, by `level2.js`. It grows organic water and lava pools, dirt paths from the spawns toward the center, and rock and mineral obstacles, then paints the whole cave once to an offscreen canvas that the loop blits each frame. Every spawn is guaranteed a walkable route to the center even when it doesn't get a dirt path. Water gets a foam edge and lava a charred edge, computed at pixel resolution. A tile terrain grid drives collision and pathfinding, so the game code never branches on the level for movement or arrows.
- Sprite-sheet animation system (idle/walk/run/attack/hurt/die) anchored per character so sprites stay put across poses. Rangers, knights, trolls, and skeletons share the same 6-row 10-frame layout, and necromancers add a seventh summon row.
- Melee enemies chase the player through a flow field (`pathfinding.js`). One weighted sweep (Dijkstra) from the player each time it changes tiles builds a least-cost field, and every chaser steps to the neighbor closest to the player. Movement is 8-directional and terrain has a cost, so enemies cut diagonals and prefer faster path tiles even when the route is a little longer, never cutting a corner past a wall. The same search serves every level, taking each level's terrain rules as a blocked-tile test so enemies route around pools and rocks. Necromancers are the exception, pathing only until they are within firing range and then holding to cast, and floating skeletons run a second flow field that treats water as walkable.
- Each level has its own randomized music playlist. Music plays through looping HTML audio elements and sound effects through the Web Audio API, each with its own volume control (`audio.js`). Volume and mute settings persist across sessions in `localStorage`.
- On first load the menu waits behind a LOADING screen until the sprite sheets and the leaderboard are both in, shown for at least 2 seconds so it never flashes.
- Art and audio are split by level under `static/level_one/`, `static/level_two/`, and `static/level_three/`.

**Backend** is a Spring Boot REST API for high scores.

- `POST /api/game/start` opens a server-timed session and returns its id. Rate limited to 20 starts per minute per client.
- `POST /api/scores` accepts `{ name, kills, durationSeconds, sessionId }`. Submissions are rate-limited per client first. The server then checks the session exists, that the claimed run length doesn't exceed the real elapsed time since the session started, and that the kill count is within what the spawn schedule could produce in that time (a model mirrored from the frontend's card-driven pacing, so there's no hand-tuned cap to re-tune when balance changes). The name is trimmed server-side and rejected if it contains invisible or bidi control characters, then a profanity filter runs on it, and only then is the single-use session consumed and the score persisted. Sessions live in memory, so a server restart mid-run means that run's score can't be submitted. This stops casual tampering but isn't full anti-cheat, which would need server-side replay.
- `GET /api/scores/top?limit=N` returns the top N scores by kills (limit clamped to 1..100).
- `GET /api/health` is a fast liveness probe that also wakes the database.

H2 in-memory database for local development. The prod profile uses Postgres with Flyway-managed migrations (`db/migration`).

## Quick start

Requires Java 17+. The Maven wrapper is included.

```bash
cd recurve
./mvnw spring-boot:run
# open http://localhost:8080 in a browser
```

The H2 console is at `http://localhost:8080/h2-console` (jdbc url `jdbc:h2:mem:recurve`, user `sa`, no password).

## Tests

```bash
./mvnw test                # backend tests (controllers, sessions, health, spawn model, profanity filter, rate limiter)
npm test                   # frontend tests (map generation, pathfinding, card pacing, charge queues, Node 18+)
```

The progression suite pins the card-pacing track (the same numbers `SpawnModel.java` mirrors), the charge-queue suite covers the ultimate recharge behavior, and the map tests generate hundreds of maps per generator and assert its invariants. For level 1, every fort is reachable from the player, paths stay one tile wide, water is orthogonally connected, and obstacle counts stay within their caps. The level 2 and level 3 suites check their own, and the sewer asserts a solid wall border, a dry 3x3 center, every spawn reaching the center over floor, and every water cell sitting in a 2x2 block.

## Project structure

```
recurve/
├── README.md
├── pom.xml
├── Dockerfile
├── render.yaml
├── package.json             # frontend test runner (node --test)
├── src/main/java/com/recurve/
│   ├── RecurveApplication.java
│   ├── controller/        # ScoreController, GameSessionController, HealthController, ClientKey
│   ├── dto/               # ScoreSubmission (in), ScoreView (out)
│   ├── model/Score.java
│   ├── repository/ScoreRepository.java
│   └── service/           # GameSessionService, SpawnModel, ProfanityFilter, ClientRateLimiter
├── src/main/resources/
│   ├── application.yml
│   ├── db/migration/      # Flyway migrations (prod/Postgres)
│   └── static/
│       ├── index.html
│       ├── game.js           # game loop, input, level system, rendering
│       ├── mapgen.js         # level 1 tile-world model + map generation
│       ├── level2.js         # level 2 cave generation + froth/char rendering
│       ├── level3.js         # level 3 sewer generation + autotiled rendering
│       ├── pathfinding.js    # pure weighted flow-field pathfinding
│       ├── progression.js    # card XP track, cards per level, tier unlocks, spawn-card mapping
│       ├── chargequeue.js    # shared ultimate recharge queue
│       ├── shuffle.js        # shared Fisher-Yates shuffle
│       ├── audio.js          # per-level music playlists + Web Audio SFX
│       ├── buffs.js          # stat defaults, run buffs, upgrade cards
│       ├── hud.js            # hearts, XP bar, ultimate dials, kill counter, run timer
│       ├── net.js            # leaderboard + score submission
│       ├── styles.css
│       ├── level_one/        # level 1 sprites, tiles, and audio
│       ├── level_two/        # cave sprites, troll sheets, and audio
│       └── level_three/      # sewer tiles, necromancer + skeleton sheets, and audio
└── src/test/
    ├── java/com/recurve/
    │   ├── ScoreControllerTest.java
    │   ├── GameSessionControllerTest.java
    │   ├── GameSessionServiceTest.java
    │   ├── HealthControllerTest.java
    │   ├── SpawnModelTest.java
    │   ├── ProfanityFilterTest.java
    │   └── ClientRateLimiterTest.java
    └── js/
        ├── mapgen.test.js      # map-generation property tests
        ├── level2.test.js      # cave-generation invariant tests
        ├── level3.test.js      # sewer-generation invariant tests
        ├── pathfinding.test.js # flow-field tests
        ├── progression.test.js # card-pacing track pins (mirrored by SpawnModel.java)
        ├── chargequeue.test.js # ultimate recharge queue tests
        └── shuffle.test.js     # Fisher-Yates tests
```

// Ranger Survivor — top-down tile-based survival shooter.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TILE_SIZE = 32;
const MAP_COLS = 16;
const MAP_ROWS = 16;

const SPRITE_PATHS = {
  archer: "sprites/Archer_clean.png",
  terrain: "sprites/Terrain.png",
  skeleton: "sprites/Skeleton_clean.png",
  // Small castle/fort sprite with grass background stripped so it composites
  // cleanly on top of the path tile. 16x16 — tight crop of the actual fort
  // body (battlements, tower, gate).
  fort: "sprites/Fort_clean.png",
  // Grass tile rolled by 16px in both axes so the texture's natural visible
  // edges fall on the 32x32 tile boundaries instead of cutting through tile
  // centers.
  grass: "sprites/Grass_shifted.png",
};

// Source rects within each sheet: (left, top, width, height). The clean
// archer sheet packs 5 walk frames horizontally at 170x133 each with the
// yellow background already removed and each frame cropped to the unified
// bbox so the character stays aligned across frames.
const SRC = {
  // Terrain tiles, all from Terrain.png (16x16 grid of 32x32 tiles).
  GRASS:         { sheet: "grass",   x: 0,   y: 0,   w: 32, h: 32 },
  PATH:          { sheet: "terrain", x: 0,   y: 96,  w: 32, h: 32 },
  MOUNTAIN:      { sheet: "terrain", x: 256, y: 256, w: 32, h: 32 },
  TREE:          { sheet: "terrain", x: 480, y: 384, w: 32, h: 32 },
  WATER:         { sheet: "terrain", x: 480, y: 64,  w: 32, h: 32 },
  // Fort sprite drawn on top of each spawn cell. Pulled from the dedicated
  // Fort_clean.png sheet (16x16) — tight crop of the actual fort body
  // (battlements + tower + gate) with grass background alpha-masked out.
  SPAWN_PORTAL:  { sheet: "fort", x: 0, y: 0, w: 16, h: 16 },
  // Archer walk frames. Sheet packs 5 body-aligned frames horizontally at
  // 119x133 each. Body x and feet y are aligned across frames so the
  // character no longer drifts during the walk cycle.
  PLAYER_0: { sheet: "archer", x: 0,   y: 0, w: 119, h: 133 },
  PLAYER_1: { sheet: "archer", x: 119, y: 0, w: 119, h: 133 },
  PLAYER_2: { sheet: "archer", x: 238, y: 0, w: 119, h: 133 },
  PLAYER_3: { sheet: "archer", x: 357, y: 0, w: 119, h: 133 },
  PLAYER_4: { sheet: "archer", x: 476, y: 0, w: 119, h: 133 },
  // Skeleton walk frames. Body-aligned, 75x71 per frame.
  ENEMY_0:  { sheet: "skeleton", x: 0,   y: 0, w: 75, h: 71 },
  ENEMY_1:  { sheet: "skeleton", x: 75,  y: 0, w: 75, h: 71 },
  ENEMY_2:  { sheet: "skeleton", x: 150, y: 0, w: 75, h: 71 },
  ENEMY_3:  { sheet: "skeleton", x: 225, y: 0, w: 75, h: 71 },
  ENEMY_4:  { sheet: "skeleton", x: 300, y: 0, w: 75, h: 71 },
};

const PLAYER_FRAMES = [SRC.PLAYER_0, SRC.PLAYER_1, SRC.PLAYER_2, SRC.PLAYER_3, SRC.PLAYER_4];
const ENEMY_FRAMES  = [SRC.ENEMY_0,  SRC.ENEMY_1,  SRC.ENEMY_2,  SRC.ENEMY_3,  SRC.ENEMY_4];

// Player render size in pixels. Slightly narrower and shorter than the
// skeleton so the archer reads as slimmer at the same scale. Feet anchor to
// the tile bottom; collision is one tile regardless of draw size.
const PLAYER_DRAW_W = 42;
const PLAYER_DRAW_H = 36;

// Enemy render size in pixels.
const ENEMY_DRAW_W = 48;
const ENEMY_DRAW_H = 36;

const TILES = {
  GRASS: 0,
  PATH: 1,
  MOUNTAIN: 2,
  TREE: 3,
  WATER: 4,
};

// Tiles that block entities (player + skeletons). Water blocks walking.
const ENTITY_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE, TILES.WATER]);
// Tiles that block projectiles. Water does NOT block arrows — they fly over.
const PROJECTILE_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE]);

function isSolid(tileId) {
  return ENTITY_SOLID_TILES.has(tileId);
}

function blocksProjectile(tileId) {
  return PROJECTILE_SOLID_TILES.has(tileId);
}

// Forts are overlay structures placed on spawn-point tiles. They block all
// movement (player, skeletons, arrows). Skeletons are exempt only at their
// own spawn tile, where they're initially placed — the A* check naturally
// allows that because the current cell is never a "neighbor".
const FORT_CELLS = new Set();
function fortKey(x, y) { return y * MAP_COLS + x; }
function isFortAt(x, y) { return FORT_CELLS.has(fortKey(x, y)); }

function tileSrc(tileId) {
  if (tileId === TILES.PATH) return SRC.PATH;
  if (tileId === TILES.MOUNTAIN) return SRC.MOUNTAIN;
  if (tileId === TILES.TREE) return SRC.TREE;
  if (tileId === TILES.WATER) return SRC.WATER;
  return SRC.GRASS;
}

function fallbackColor(tileId) {
  if (tileId === TILES.PATH) return "#94704a";
  if (tileId === TILES.MOUNTAIN) return "#5a4836";
  if (tileId === TILES.TREE) return "#2c5d2c";
  if (tileId === TILES.WATER) return "#3464a8";
  return "#5fa83c";
}

const SPAWN_POINTS = [
  { x: 1,  y: 1 },
  { x: 14, y: 1 },
  { x: 1,  y: 14 },
  { x: 14, y: 14 },
  { x: 7,  y: 1 },
  { x: 7,  y: 14 },
  { x: 1,  y: 7 },
  { x: 14, y: 7 },
];
// Mark each spawn-point tile as a fort cell so movement code can block it.
for (const s of SPAWN_POINTS) FORT_CELLS.add(fortKey(s.x, s.y));

const INITIAL_SPAWN_INTERVAL_MS = 3000;
const MIN_SPAWN_INTERVAL_MS = 500;
const SPAWN_ACCEL_PER_KILL_MS = 100;

const ARROW_STEP_MS = 50;
const ARROW_MAX_RANGE = 6;

// When the player taps a single arrow key, wait this long before committing
// the shot so a second perpendicular key can join in for a diagonal.
const SHOOT_COMBO_WINDOW_MS = 60;

// Direction vectors and visual rotation, supporting 4 cardinals + 4 diagonals.
const DIR_VECTORS = {
  up:        { dx:  0, dy: -1 },
  down:      { dx:  0, dy:  1 },
  left:      { dx: -1, dy:  0 },
  right:     { dx:  1, dy:  0 },
  upright:   { dx:  1, dy: -1 },
  upleft:    { dx: -1, dy: -1 },
  downright: { dx:  1, dy:  1 },
  downleft:  { dx: -1, dy:  1 },
};

const DIR_ROTATION = {
  right:     0,
  downright: Math.PI / 4,
  down:      Math.PI / 2,
  downleft:  3 * Math.PI / 4,
  left:      Math.PI,
  upleft:    -3 * Math.PI / 4,
  up:        -Math.PI / 2,
  upright:   -Math.PI / 4,
};

// Base ms-per-tile for the player. Path tiles run faster, grass slower.
const PLAYER_MOVE_DURATION_MS = 160;
// Terrain multipliers applied to the base duration.
//   Path: 1.5x faster  → 160 / 1.5  ≈ 107ms
//   Grass: 0.75x speed → 160 / 0.75 ≈ 213ms
const PATH_SPEED_MULT  = 1.5;
const GRASS_SPEED_MULT = 0.75;
// Diagonal moves take sqrt(2)x longer than the corresponding cardinal step
// so per-axis speed stays constant.
const DIAG_DURATION_FACTOR = 1.414;
// Movement combo window: two WASD keys pressed within this many ms commit
// as a single diagonal move (e.g. W+D = up-right).
const MOVE_COMBO_WINDOW_MS = 35;

// Enemies tween over this duration per tile. Slightly slower than the player.
const ENEMY_MOVE_DURATION_MS = 480;

// ---------------------------------------------------------------------------
// Canvas + HUD wiring
// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const killEl = document.getElementById("kill-count");
const timeEl = document.getElementById("time-value");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayButton = document.getElementById("overlay-button");
const scoreForm = document.getElementById("score-form");
const playerNameInput = document.getElementById("player-name");
const submitScoreButton = document.getElementById("submit-score-button");
const leaderboardList = document.getElementById("leaderboard-list");

// Restore the last-used player name from localStorage so they don't retype it.
try {
  const savedName = localStorage.getItem("ranger-survivor.playerName");
  if (savedName) playerNameInput.value = savedName;
} catch (_) { /* localStorage may be disabled */ }

let lastRunDurationSeconds = 0;
let scoreAlreadySubmitted = false;

// Fetch the top-10 scores from the backend and render them into the
// overlay's leaderboard list. Silently no-ops on network failure.
async function refreshLeaderboard() {
  try {
    const res = await fetch("/api/scores/top?limit=5");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const scores = await res.json();
    renderLeaderboard(scores);
  } catch (err) {
    console.warn("Leaderboard fetch failed:", err);
    leaderboardList.innerHTML = '<li class="leaderboard-empty">Leaderboard unavailable</li>';
  }
}

function renderLeaderboard(scores) {
  leaderboardList.innerHTML = "";
  if (!scores || scores.length === 0) {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">No scores yet — be the first!</li>';
    return;
  }
  scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="rank">${i + 1}.</span>` +
      `<span class="name">${escapeHtml(s.name || "Anonymous")}</span>` +
      `<span class="kills">${s.kills}</span>` +
      `<span class="duration">${s.durationSeconds}s</span>`;
    leaderboardList.appendChild(li);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function submitScore() {
  if (scoreAlreadySubmitted) return;
  const name = (playerNameInput.value || "").trim();
  // No name — silently do nothing. The player can still hit Start.
  if (!name) return;
  try {
    localStorage.setItem("ranger-survivor.playerName", name);
  } catch (_) {}
  submitScoreButton.disabled = true;
  submitScoreButton.textContent = "Submitting…";
  try {
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kills: state.kills,
        durationSeconds: lastRunDurationSeconds,
      }),
    });
    if (res.status === 400) {
      // Backend rejected the name (likely profanity). Show the message.
      let msg = "Name not allowed.";
      try {
        const body = await res.json();
        if (body && body.message) msg = body.message;
      } catch (_) {}
      submitScoreButton.disabled = false;
      submitScoreButton.textContent = msg;
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    scoreAlreadySubmitted = true;
    submitScoreButton.textContent = "Submitted";
    await refreshLeaderboard();
  } catch (err) {
    console.warn("Score submit failed:", err);
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit score";
  }
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

const state = {
  running: false,
  startedAt: 0,
  kills: 0,
  player: {
    x: 8,
    y: 8,
    facing: "right",
    moving: false,
    moveStartAt: 0,
    moveDuration: 0,
    fromX: 8,
    fromY: 8,
    toX: 8,
    toY: 8,
  },
  enemies: [],
  projectiles: [],
  tileMap: buildStartingMap(),
  spawnIntervalMs: INITIAL_SPAWN_INTERVAL_MS,
  lastSpawnAt: 0,
};

function buildStartingMap() {
  // 1. Start with all grass.
  // 2. Surround with a one-tile mountain border.
  // 3. Scatter a few impassable "strings" of trees or water — short runs of
  //    3-5 connected tiles in one direction.
  // 4. Carve a couple of winding random paths from edge to edge so the map
  //    has clear routes.
  // 5. Clear the player start tile and every spawn point so enemies can
  //    always reach the player.
  // 6. BFS-validate connectivity from the player tile to each spawn. If any
  //    spawn is unreachable, knock down obstacles until it is.

  const map = [];
  for (let y = 0; y < MAP_ROWS; y++) {
    const row = [];
    for (let x = 0; x < MAP_COLS; x++) {
      if (y === 0 || y === MAP_ROWS - 1 || x === 0 || x === MAP_COLS - 1) {
        row.push(TILES.MOUNTAIN);
      } else {
        row.push(TILES.GRASS);
      }
    }
    map.push(row);
  }

  const inInterior = (x, y) => x > 0 && x < MAP_COLS - 1 && y > 0 && y < MAP_ROWS - 1;

  // Reserve tiles that must stay walkable: player start + spawn points + a
  // 3x3 area around the player so they have room to move on spawn.
  const PLAYER_START_X = Math.floor(MAP_COLS / 2);
  const PLAYER_START_Y = Math.floor(MAP_ROWS / 2);
  const reserved = new Set();
  const reserve = (x, y) => reserved.add(y * MAP_COLS + x);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      reserve(PLAYER_START_X + dx, PLAYER_START_Y + dy);
    }
  }
  for (const s of SPAWN_POINTS) reserve(s.x, s.y);

  // ---- 1) Carve paths FIRST so obstacles can route around them ----
  function carveBetween(ax, ay, bx, by) {
    let x = ax, y = ay;
    let safety = 0;
    while ((x !== bx || y !== by) && safety++ < 200) {
      if (inInterior(x, y)) map[y][x] = TILES.PATH;
      const dx = Math.sign(bx - x);
      const dy = Math.sign(by - y);
      const wander = Math.random() < 0.2;
      if (wander) {
        if (Math.random() < 0.5 && dx !== 0) x += dx;
        else if (dy !== 0) y += dy;
        else if (dx !== 0) x += dx;
      } else if (Math.abs(bx - x) > Math.abs(by - y)) {
        x += dx;
      } else if (dy !== 0) {
        y += dy;
      } else {
        x += dx;
      }
    }
    if (inInterior(bx, by)) map[by][bx] = TILES.PATH;
  }

  function carveEdgeToEdge() {
    const sideA = Math.floor(Math.random() * 4);
    const sideB = (sideA + 1 + Math.floor(Math.random() * 3)) % 4;
    const edgePoint = (side) => {
      if (side === 0) return { x: 1 + Math.floor(Math.random() * (MAP_COLS - 2)), y: 1 };
      if (side === 1) return { x: MAP_COLS - 2, y: 1 + Math.floor(Math.random() * (MAP_ROWS - 2)) };
      if (side === 2) return { x: 1 + Math.floor(Math.random() * (MAP_COLS - 2)), y: MAP_ROWS - 2 };
      return { x: 1, y: 1 + Math.floor(Math.random() * (MAP_ROWS - 2)) };
    };
    const a = edgePoint(sideA);
    const b = edgePoint(sideB);
    carveBetween(a.x, a.y, b.x, b.y);
  }

  // Always carve at least one path THROUGH the player spawn so the player
  // has a fast lane down the middle. Path runs edge-to-edge, hitting
  // (PLAYER_START_X, PLAYER_START_Y) at the center.
  function carveThroughSpawn() {
    const horizontal = Math.random() < 0.5;
    if (horizontal) {
      carveBetween(1, PLAYER_START_Y, PLAYER_START_X, PLAYER_START_Y);
      carveBetween(PLAYER_START_X, PLAYER_START_Y, MAP_COLS - 2, PLAYER_START_Y);
    } else {
      carveBetween(PLAYER_START_X, 1, PLAYER_START_X, PLAYER_START_Y);
      carveBetween(PLAYER_START_X, PLAYER_START_Y, PLAYER_START_X, MAP_ROWS - 2);
    }
  }

  carveThroughSpawn();
  // 3-5 additional edge-to-edge paths (1.5x the prior 2-3).
  const pathCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pathCount; i++) carveEdgeToEdge();

  // ---- 2) Drop spawn forts on path tiles ----
  for (const s of SPAWN_POINTS) {
    map[s.y][s.x] = TILES.PATH;
  }

  // Helper: a cell is OK to convert to an obstacle only if it's interior
  // grass, not reserved, not a fort. Path/water/tree/mountain are off-limits.
  const obstacleSafe = (x, y) => {
    if (!inInterior(x, y)) return false;
    if (reserved.has(y * MAP_COLS + x)) return false;
    if (isFortAt(x, y)) return false;
    return map[y][x] === TILES.GRASS;
  };

  // ---- 3) Trees — doubled (24-40 short scatter strings) ----
  const treeStringCount = 24 + Math.floor(Math.random() * 17);
  for (let i = 0; i < treeStringCount; i++) {
    const length = 2 + Math.floor(Math.random() * 4);
    const horizontal = Math.random() < 0.5;
    const startX = 1 + Math.floor(Math.random() * (MAP_COLS - 2));
    const startY = 1 + Math.floor(Math.random() * (MAP_ROWS - 2));
    for (let k = 0; k < length; k++) {
      const x = horizontal ? startX + k : startX;
      const y = horizontal ? startY : startY + k;
      if (!obstacleSafe(x, y)) continue;
      map[y][x] = TILES.TREE;
    }
  }

  // ---- 4) Water — 2-3 blob clusters of 6-10 tiles each ----
  // Adjacency rule: a water tile must only ever touch other water tiles
  // orthogonally. Disconnected diagonal pairs are forbidden — any diagonal
  // water neighbour must be reachable through an orthogonal connector.
  const isWater = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.WATER;
  const waterPlaceable = (x, y) => {
    if (!obstacleSafe(x, y)) return false;
    // For each diagonal neighbour that is water, require an L-bridge:
    // either the shared horizontal neighbour or the shared vertical
    // neighbour is also water. Otherwise placing here would create an
    // isolated diagonal-only pair.
    const diagonals = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dy] of diagonals) {
      if (!isWater(x + dx, y + dy)) continue;
      if (!isWater(x + dx, y) && !isWater(x, y + dy)) return false;
    }
    return true;
  };

  // Two clusters must also not seed diagonally next to an existing cluster.
  // The waterPlaceable check already enforces that when picking the seed.

  const waterClusters = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < waterClusters; i++) {
    let cx, cy, attempts = 0;
    do {
      cx = 2 + Math.floor(Math.random() * (MAP_COLS - 4));
      cy = 2 + Math.floor(Math.random() * (MAP_ROWS - 4));
      attempts++;
    } while (!waterPlaceable(cx, cy) && attempts < 30);
    if (!waterPlaceable(cx, cy)) continue;

    const target = 6 + Math.floor(Math.random() * 5);
    const placed = [{ x: cx, y: cy }];
    map[cy][cx] = TILES.WATER;
    let guard = 0;
    while (placed.length < target && guard++ < 200) {
      const seed = placed[Math.floor(Math.random() * placed.length)];
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = seed.x + dx, ny = seed.y + dy;
      if (!waterPlaceable(nx, ny)) continue;
      map[ny][nx] = TILES.WATER;
      placed.push({ x: nx, y: ny });
    }
  }

  // Reserved tiles should be walkable (paranoia: obstacles never touch them,
  // but make absolutely sure).
  for (const idx of reserved) {
    const y = Math.floor(idx / MAP_COLS);
    const x = idx % MAP_COLS;
    if (isSolid(map[y][x])) map[y][x] = TILES.GRASS;
  }

  // BFS from player start. Each fort must reach the player through tiles that
  // are NOT solid (mountain/tree/water) AND NOT another fort, because in-game
  // skeletons can step OFF their own fort but never INTO any fort. Otherwise
  // a corner fort can be trapped by other forts on its only path.
  //
  // Reachability is measured from the player tile inward — a fort's spawn cell
  // itself is allowed as the destination, but every step LEADING to it must be
  // clear of obstacles AND other forts.
  function bfsReachable() {
    const visited = new Set();
    const q = [[PLAYER_START_X, PLAYER_START_Y]];
    visited.add(PLAYER_START_Y * MAP_COLS + PLAYER_START_X);
    while (q.length > 0) {
      const [cx, cy] = q.shift();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
        const k = ny * MAP_COLS + nx;
        if (visited.has(k)) continue;
        if (isSolid(map[ny][nx])) continue;
        // Forts (other than the BFS frontier's own cell) are impassable.
        if (isFortAt(nx, ny)) {
          // Allow visiting a fort as a leaf (so we know it's reachable),
          // but don't expand past it.
          visited.add(k);
          continue;
        }
        visited.add(k);
        q.push([nx, ny]);
      }
    }
    return visited;
  }

  // Carve a corridor from a spawn point toward the player, knocking down
  // anything solid AND routing around other forts.
  function carveCorridorToCenter(sx, sy) {
    let x = sx, y = sy;
    let safety = 0;
    while ((x !== PLAYER_START_X || y !== PLAYER_START_Y) && safety++ < 200) {
      // Pick the next step toward the player that ISN'T another fort.
      const dx = Math.sign(PLAYER_START_X - x);
      const dy = Math.sign(PLAYER_START_Y - y);
      const candidates = [];
      if (Math.abs(PLAYER_START_X - x) > Math.abs(PLAYER_START_Y - y)) {
        if (dx !== 0) candidates.push([x + dx, y]);
        if (dy !== 0) candidates.push([x, y + dy]);
      } else {
        if (dy !== 0) candidates.push([x, y + dy]);
        if (dx !== 0) candidates.push([x + dx, y]);
      }
      let next = null;
      for (const [nx, ny] of candidates) {
        if (nx === sx && ny === sy) continue;
        if (!isFortAt(nx, ny)) { next = [nx, ny]; break; }
      }
      if (!next) {
        // Both natural directions blocked by forts; nudge perpendicular.
        const alts = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of alts) {
          if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
          if (isFortAt(nx, ny)) continue;
          next = [nx, ny]; break;
        }
        if (!next) break;
      }
      x = next[0]; y = next[1];
      if (inInterior(x, y) && isSolid(map[y][x])) map[y][x] = TILES.GRASS;
    }
  }

  let reachable = bfsReachable();
  for (const s of SPAWN_POINTS) {
    if (reachable.has(s.y * MAP_COLS + s.x)) continue;
    carveCorridorToCenter(s.x, s.y);
  }
  // Re-validate after carving in case multiple forts shared a blocked path.
  reachable = bfsReachable();
  for (const s of SPAWN_POINTS) {
    if (reachable.has(s.y * MAP_COLS + s.x)) continue;
    carveCorridorToCenter(s.x, s.y);
  }

  // After all carving, some water clusters may have lost their orthogonal
  // connectors. Iteratively demote any water tile that is only diagonally
  // adjacent to another water tile (with no orthogonal water bridge between
  // them). Alternate forward/reverse scan order to converge faster.
  let changed = true;
  let iter = 0;
  function cleanupPass(reverse) {
    let anyChanged = false;
    const yStart = reverse ? MAP_ROWS - 2 : 1;
    const yEnd   = reverse ? 0 : MAP_ROWS - 1;
    const yStep  = reverse ? -1 : 1;
    const xStart = reverse ? MAP_COLS - 2 : 1;
    const xEnd   = reverse ? 0 : MAP_COLS - 1;
    const xStep  = reverse ? -1 : 1;
    for (let y = yStart; reverse ? y > yEnd : y < yEnd; y += yStep) {
      for (let x = xStart; reverse ? x > xEnd : x < xEnd; x += xStep) {
        if (map[y][x] !== TILES.WATER) continue;
        for (const [dx, dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
          const wx = x + dx, wy = y + dy;
          if (!map[wy] || map[wy][wx] !== TILES.WATER) continue;
          // Bridge tile (orthogonally adjacent to both)?
          if (map[wy][x] === TILES.WATER || map[y][wx] === TILES.WATER) continue;
          map[y][x] = TILES.GRASS;
          anyChanged = true;
          break;
        }
      }
    }
    return anyChanged;
  }
  while (changed && iter++ < 32) {
    changed = cleanupPass(false) || cleanupPass(true);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Sprite loading
// ---------------------------------------------------------------------------

const sprites = {
  archer: null,
  terrain: null,
  skeleton: null,
};

function loadSprites() {
  const tasks = Object.entries(SPRITE_PATHS).map(([key, path]) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        sprites[key] = img;
        resolve();
      };
      img.onerror = () => {
        console.warn(`Sprite sheet missing: ${path}`);
        resolve();
      };
      img.src = path;
    });
  });
  return Promise.all(tasks);
}

function drawSprite(srcDef, dx, dy, dw, dh) {
  if (!srcDef) return;
  const sheet = sprites[srcDef.sheet];
  if (!sheet) return;
  ctx.drawImage(sheet, srcDef.x, srcDef.y, srcDef.w, srcDef.h, dx, dy, dw, dh);
}

function drawSpriteFlipped(srcDef, dx, dy, dw, dh) {
  if (!srcDef) return;
  const sheet = sprites[srcDef.sheet];
  if (!sheet) return;
  ctx.save();
  ctx.translate(dx + dw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, srcDef.x, srcDef.y, srcDef.w, srcDef.h, 0, 0, dw, dh);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Input — one keypress = one move. event.repeat filters out OS auto-repeat.
// Input is also locked while a move tween is in progress.
// ---------------------------------------------------------------------------

const MOVE_KEYS = { KeyW: "up", KeyA: "left", KeyS: "down", KeyD: "right" };
const SHOOT_KEYS = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right" };

// Shoot-combo state. Arrow keys held during the combo window combine into
// diagonal directions when the timer commits.
const heldShootKeys = new Set();
let shootCommitTimer = null;

// Move-combo state. WASD keys pressed within MOVE_COMBO_WINDOW_MS combine
// into a single diagonal step (e.g. W+D = up-right).
const pendingMoveKeys = new Set();
let moveCommitTimer = null;

function onKeyDown(event) {
  // Ignore key events when the user is typing into a text input (e.g. the
  // name entry on the game-over overlay). Otherwise WASD would auto-start a
  // new game while they're entering their name.
  const t = event.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  // Filter out OS-level auto-repeat so a held key never auto-steps.
  if (event.repeat) {
    event.preventDefault();
    return;
  }

  // While stopped (initial load or after game over) the only way to start a
  // run is the Start button. Keyboard presses do nothing — the name input is
  // already exempted above so the player can still type their name into it.
  if (!state.running) return;

  // While the move tween is mid-flight, ignore new movement presses.
  if (state.player.moving && MOVE_KEYS[event.code]) {
    event.preventDefault();
    return;
  }

  if (MOVE_KEYS[event.code]) {
    onMoveKeyDown(MOVE_KEYS[event.code]);
    event.preventDefault();
  } else if (SHOOT_KEYS[event.code]) {
    onShootKeyDown(SHOOT_KEYS[event.code]);
    event.preventDefault();
  }
}

function onKeyUp(event) {
  if (SHOOT_KEYS[event.code]) {
    heldShootKeys.delete(SHOOT_KEYS[event.code]);
  }
}

function onMoveKeyDown(direction) {
  pendingMoveKeys.add(direction);
  // First key of the combo seeds the commit timer. Any extra WASD keys
  // pressed inside the window get folded into the same step.
  if (moveCommitTimer === null) {
    moveCommitTimer = setTimeout(commitMove, MOVE_COMBO_WINDOW_MS);
  }
}

function commitMove() {
  moveCommitTimer = null;
  const dx = (pendingMoveKeys.has("right") ? 1 : 0) - (pendingMoveKeys.has("left") ? 1 : 0);
  const dy = (pendingMoveKeys.has("down")  ? 1 : 0) - (pendingMoveKeys.has("up")   ? 1 : 0);
  pendingMoveKeys.clear();
  if (dx === 0 && dy === 0) return;
  queueMove(dx, dy);
}

function onShootKeyDown(direction) {
  heldShootKeys.add(direction);
  // Start a commit timer the first time an arrow key goes down. Any further
  // arrow keys pressed within the window join the shot.
  if (shootCommitTimer === null) {
    shootCommitTimer = setTimeout(commitShot, SHOOT_COMBO_WINDOW_MS);
  }
}

function commitShot() {
  shootCommitTimer = null;
  const direction = resolveShootDirection(heldShootKeys);
  // The held set keeps tracking keys until each goes up — that's fine, the
  // one-arrow-at-a-time gate in fireArrow blocks any duplicate shot.
  if (direction) fireArrow(direction);
}

function resolveShootDirection(keys) {
  const hasUp = keys.has("up");
  const hasDown = keys.has("down");
  const hasLeft = keys.has("left");
  const hasRight = keys.has("right");
  // Opposite directions cancel each other.
  if (hasUp && hasDown) return null;
  if (hasLeft && hasRight) return null;
  if (hasUp && hasRight)   return "upright";
  if (hasUp && hasLeft)    return "upleft";
  if (hasDown && hasRight) return "downright";
  if (hasDown && hasLeft)  return "downleft";
  if (hasUp)    return "up";
  if (hasDown)  return "down";
  if (hasLeft)  return "left";
  if (hasRight) return "right";
  return null;
}

function queueMove(dx, dy) {
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return;
  if (isSolid(state.tileMap[ny][nx])) return;
  if (isFortAt(nx, ny)) return;
  // Block diagonal squeezes through corners: if both cardinal neighbors are
  // solid (terrain or fort), don't allow the diagonal step.
  if (dx !== 0 && dy !== 0) {
    const sideA = state.tileMap[p.y][nx];
    const sideB = state.tileMap[ny][p.x];
    const sideABlocked = isSolid(sideA) || isFortAt(nx, p.y);
    const sideBBlocked = isSolid(sideB) || isFortAt(p.x, ny);
    if (sideABlocked && sideBBlocked) return;
  }

  // Facing: prefer horizontal component, fall back to vertical.
  if (dx > 0) p.facing = "right";
  else if (dx < 0) p.facing = "left";
  else if (dy > 0) p.facing = "down";
  else if (dy < 0) p.facing = "up";

  // Per-tile duration: path is faster, grass is slower, diagonal multiplies
  // the base by sqrt(2) so per-axis speed stays constant.
  const destTile = state.tileMap[ny][nx];
  let mult = 1.0;
  if (destTile === TILES.PATH) mult = PATH_SPEED_MULT;
  else if (destTile === TILES.GRASS) mult = GRASS_SPEED_MULT;
  let duration = PLAYER_MOVE_DURATION_MS / mult;
  if (dx !== 0 && dy !== 0) duration *= DIAG_DURATION_FACTOR;

  p.moving = true;
  p.moveStartAt = performance.now();
  p.moveDuration = duration;
  p.fromX = p.x;
  p.fromY = p.y;
  p.toX = nx;
  p.toY = ny;
}

function stepPlayerMove(now) {
  const p = state.player;
  if (!p.moving) return;
  const elapsed = now - p.moveStartAt;
  const dur = p.moveDuration || PLAYER_MOVE_DURATION_MS;
  if (elapsed >= dur) {
    p.x = p.toX;
    p.y = p.toY;
    p.moving = false;
  }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function fireArrow(direction) {
  // One arrow at a time. New shots are silently ignored until the in-flight
  // arrow despawns (hits an enemy, a solid tile, leaves the map, or reaches
  // ARROW_MAX_RANGE).
  if (state.projectiles.length > 0) return;
  // Spawn from the player's authoritative grid tile (destination of any
  // in-flight move) so arrows are predictable.
  const sx = state.player.moving ? state.player.toX : state.player.x;
  const sy = state.player.moving ? state.player.toY : state.player.y;
  state.projectiles.push({
    x: sx,
    y: sy,
    direction,
    lastStepAt: 0,
    tilesTraveled: 0,
  });
}

function stepProjectiles(now) {
  const remaining = [];
  for (const p of state.projectiles) {
    if (now - p.lastStepAt < ARROW_STEP_MS) {
      remaining.push(p);
      continue;
    }
    const v = DIR_VECTORS[p.direction];
    if (v) {
      p.x += v.dx;
      p.y += v.dy;
    }
    p.tilesTraveled++;
    p.lastStepAt = now;
    if (p.x < 0 || p.x >= MAP_COLS || p.y < 0 || p.y >= MAP_ROWS) continue;
    // Arrows are stopped by mountains, trees, and forts. They fly over water.
    if (blocksProjectile(state.tileMap[p.y][p.x])) continue;
    if (isFortAt(p.x, p.y)) continue;
    if (p.tilesTraveled >= ARROW_MAX_RANGE) continue;
    remaining.push(p);
  }
  state.projectiles = remaining;
}

// ---------------------------------------------------------------------------
// Enemies + A* pathfinding
// ---------------------------------------------------------------------------

function aStarNextStep(startX, startY, goalX, goalY, tileMap) {
  if (startX === goalX && startY === goalY) return null;
  const key = (x, y) => y * MAP_COLS + x;
  const heuristic = (x, y) => Math.abs(x - goalX) + Math.abs(y - goalY);
  const open = [{ x: startX, y: startY, g: 0, f: heuristic(startX, startY), parent: null }];
  const gScore = new Map();
  gScore.set(key(startX, startY), 0);
  const closed = new Set();
  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIndex].f) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0];
    if (current.x === goalX && current.y === goalY) {
      let node = current;
      while (node.parent && node.parent.parent) node = node.parent;
      return { x: node.x, y: node.y };
    }
    closed.add(key(current.x, current.y));
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.x >= MAP_COLS || n.y < 0 || n.y >= MAP_ROWS) continue;
      const nKey = key(n.x, n.y);
      if (closed.has(nKey)) continue;
      const isGoal = n.x === goalX && n.y === goalY;
      if (!isGoal && isSolid(tileMap[n.y][n.x])) continue;
      // Forts are impassable to skeletons (except for the cell they're
      // already standing on, which is the start node — never a neighbor).
      if (!isGoal && isFortAt(n.x, n.y)) continue;
      const tentativeG = current.g + 1;
      const existingG = gScore.get(nKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;
      gScore.set(nKey, tentativeG);
      open.push({
        x: n.x, y: n.y, g: tentativeG,
        f: tentativeG + heuristic(n.x, n.y),
        parent: current,
      });
    }
  }
  return null;
}

function maybeSpawnEnemy(now) {
  if (now - state.lastSpawnAt < state.spawnIntervalMs) return;
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  state.enemies.push({
    x: spawn.x,
    y: spawn.y,
    moving: false,
    moveStartAt: 0,
    fromX: spawn.x,
    fromY: spawn.y,
    toX: spawn.x,
    toY: spawn.y,
    facing: "left",
  });
  state.lastSpawnAt = now;
}

function stepEnemies(now) {
  const goalX = state.player.moving ? state.player.toX : state.player.x;
  const goalY = state.player.moving ? state.player.toY : state.player.y;
  for (const enemy of state.enemies) {
    // Finish any in-flight tween first.
    if (enemy.moving) {
      const elapsed = now - enemy.moveStartAt;
      if (elapsed >= ENEMY_MOVE_DURATION_MS) {
        enemy.x = enemy.toX;
        enemy.y = enemy.toY;
        enemy.moving = false;
      }
      continue;
    }
    // Path to the next tile and start a fresh tween.
    const next = aStarNextStep(enemy.x, enemy.y, goalX, goalY, state.tileMap);
    if (next === null) continue;
    enemy.fromX = enemy.x;
    enemy.fromY = enemy.y;
    enemy.toX = next.x;
    enemy.toY = next.y;
    if (next.x > enemy.x) enemy.facing = "right";
    else if (next.x < enemy.x) enemy.facing = "left";
    // Vertical-only steps keep the previous facing.
    enemy.moveStartAt = now;
    enemy.moving = true;
  }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function entityTiles(e) {
  // Tiles an entity occupies, both source and destination if mid-tween.
  if (e.moving) return [{ x: e.x, y: e.y }, { x: e.toX, y: e.toY }];
  return [{ x: e.x, y: e.y }];
}

function tilesOverlap(a, b) {
  for (const ta of a) for (const tb of b) {
    if (ta.x === tb.x && ta.y === tb.y) return true;
  }
  return false;
}

function resolveCollisions() {
  // Arrows hit enemies on the enemy's source tile (the tile they're snapped
  // to). Mid-tween enemies don't catch arrows at their destination yet.
  const survivingEnemies = [];
  const hitProjectileIds = new Set();
  for (const enemy of state.enemies) {
    const hitIndex = state.projectiles.findIndex(
      (p, i) => !hitProjectileIds.has(i) && p.x === enemy.x && p.y === enemy.y,
    );
    if (hitIndex !== -1) {
      hitProjectileIds.add(hitIndex);
      state.kills++;
      state.spawnIntervalMs = Math.max(
        MIN_SPAWN_INTERVAL_MS,
        state.spawnIntervalMs - SPAWN_ACCEL_PER_KILL_MS,
      );
      continue;
    }
    survivingEnemies.push(enemy);
  }
  const survivingProjectiles = [];
  state.projectiles.forEach((p, i) => {
    if (!hitProjectileIds.has(i)) survivingProjectiles.push(p);
  });
  state.enemies = survivingEnemies;
  state.projectiles = survivingProjectiles;

  // Player vs enemy: collision if any tile the player occupies (source or
  // destination during a tween) overlaps any tile the enemy occupies.
  const playerTiles = entityTiles(state.player);
  for (const enemy of state.enemies) {
    if (tilesOverlap(playerTiles, entityTiles(enemy))) {
      gameOver();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Vertical shift applied to the grass texture inside each 32x32 cell so the
// texture's visible edges align with the tile boundaries. The shift wraps:
// the bottom (TILE_SIZE - GRASS_SHIFT_Y) rows of the source appear at the
// top of the tile, and the top GRASS_SHIFT_Y rows appear at the bottom.
const GRASS_SHIFT_Y = 18;

function drawGrassTile(dx, dy) {
  const sheet = sprites[SRC.GRASS.sheet];
  if (!sheet) return;
  const s = SRC.GRASS;
  const topH = TILE_SIZE - GRASS_SHIFT_Y; // 14
  const botH = GRASS_SHIFT_Y;             // 18
  // Top of tile shows the BOTTOM of the source (rows TILE_SIZE-topH .. TILE_SIZE).
  ctx.drawImage(sheet, s.x, s.y + botH,  s.w, topH, dx, dy,         s.w, topH);
  // Bottom of tile shows the TOP of the source (rows 0 .. botH).
  ctx.drawImage(sheet, s.x, s.y,         s.w, botH, dx, dy + topH,  s.w, botH);
}

function renderTiles() {
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const tileId = state.tileMap[y][x];
      if (sprites.terrain) {
        // Grass underlay everywhere so transparent edges of overlay tiles
        // sit on green, not black.
        drawGrassTile(x * TILE_SIZE, y * TILE_SIZE);
        if (tileId !== TILES.GRASS) {
          drawSprite(tileSrc(tileId), x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      } else {
        ctx.fillStyle = fallbackColor(tileId);
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

// Fort drawn at 22x22 inside the 32x32 spawn tile so the path tile shows
// clearly around it. Source is 16x16 with transparent background.
const FORT_DRAW_W = 22;
const FORT_DRAW_H = 22;

function renderSpawnMarkers() {
  if (sprites.fort) {
    for (const p of SPAWN_POINTS) {
      const drawX = p.x * TILE_SIZE + (TILE_SIZE - FORT_DRAW_W) / 2;
      const drawY = p.y * TILE_SIZE + (TILE_SIZE - FORT_DRAW_H) / 2;
      drawSprite(SRC.SPAWN_PORTAL, drawX, drawY, FORT_DRAW_W, FORT_DRAW_H);
    }
  } else {
    ctx.fillStyle = "rgba(245, 185, 66, 0.18)";
    for (const p of SPAWN_POINTS) {
      ctx.fillRect(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

function renderProjectiles() {
  // Programmatic arrow: gold shaft + arrowhead pointing in the travel direction.
  for (const p of state.projectiles) {
    const cx = p.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = p.y * TILE_SIZE + TILE_SIZE / 2;
    const angle = DIR_ROTATION[p.direction] ?? 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // Shaft
    ctx.strokeStyle = "#caa64a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    // Head
    ctx.fillStyle = "#caa64a";
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(6, -4);
    ctx.lineTo(6, 4);
    ctx.closePath();
    ctx.fill();
    // Fletching
    ctx.strokeStyle = "#caa64a";
    ctx.beginPath();
    ctx.moveTo(-10, -3);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 3);
    ctx.stroke();
    ctx.restore();
  }
}

function renderEnemies(now) {
  for (const enemy of state.enemies) {
    let px, py;
    let frameIndex = 0;
    if (enemy.moving) {
      const rawT = (now - enemy.moveStartAt) / ENEMY_MOVE_DURATION_MS;
      const t = Math.max(0, Math.min(1, rawT));
      px = lerp(enemy.fromX, enemy.toX, t) * TILE_SIZE;
      py = lerp(enemy.fromY, enemy.toY, t) * TILE_SIZE;
      const rawIndex = Math.floor(t * ENEMY_FRAMES.length);
      frameIndex = Math.max(0, Math.min(ENEMY_FRAMES.length - 1, rawIndex));
    } else {
      px = enemy.x * TILE_SIZE;
      py = enemy.y * TILE_SIZE;
      frameIndex = 0;
    }
    const drawX = px + (TILE_SIZE - ENEMY_DRAW_W) / 2;
    const drawY = py + TILE_SIZE - ENEMY_DRAW_H;

    if (sprites.skeleton) {
      const frame = ENEMY_FRAMES[frameIndex];
      // The skeleton sprite naturally faces left; flip when facing right.
      if (enemy.facing === "right") {
        drawSpriteFlipped(frame, drawX, drawY, ENEMY_DRAW_W, ENEMY_DRAW_H);
      } else {
        drawSprite(frame, drawX, drawY, ENEMY_DRAW_W, ENEMY_DRAW_H);
      }
    } else {
      // Fallback: red circle if sheet failed to load.
      const cx = drawX + ENEMY_DRAW_W / 2;
      const cy = drawY + ENEMY_DRAW_H / 2;
      ctx.fillStyle = "#c93737";
      ctx.strokeStyle = "#3a0d0d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function renderPlayer(now) {
  const p = state.player;
  let px, py;
  let frameIndex = 0;
  if (p.moving) {
    // Clamp both ends. rAF's `now` can predate `performance.now()` taken
    // inside queueMove, which would make t negative for one frame.
    const dur = p.moveDuration || PLAYER_MOVE_DURATION_MS;
    const rawT = (now - p.moveStartAt) / dur;
    const t = Math.max(0, Math.min(1, rawT));
    px = lerp(p.fromX, p.toX, t) * TILE_SIZE;
    py = lerp(p.fromY, p.toY, t) * TILE_SIZE;
    const rawIndex = Math.floor(t * PLAYER_FRAMES.length);
    frameIndex = Math.max(0, Math.min(PLAYER_FRAMES.length - 1, rawIndex));
  } else {
    px = p.x * TILE_SIZE;
    py = p.y * TILE_SIZE;
    frameIndex = 0;
  }

  const drawX = px + (TILE_SIZE - PLAYER_DRAW_W) / 2;
  // Anchor feet to the bottom of the tile
  const drawY = py + TILE_SIZE - PLAYER_DRAW_H;

  if (sprites.archer) {
    const frame = PLAYER_FRAMES[frameIndex];
    // Archer sprite is essentially forward-facing with the quiver/pouch on
    // a fixed hip. Horizontal-flipping for left-facing put the quiver on
    // what looked like the front of the body, so we keep a single
    // orientation for all movement directions.
    drawSprite(frame, drawX, drawY, PLAYER_DRAW_W, PLAYER_DRAW_H);
  } else {
    ctx.fillStyle = "#7ed957";
    ctx.fillRect(drawX + 4, drawY + 4, PLAYER_DRAW_W - 8, PLAYER_DRAW_H - 8);
  }
}

function render(now) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderTiles();
  renderSpawnMarkers();
  renderProjectiles();
  renderEnemies(now);
  renderPlayer(now);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud(now) {
  killEl.textContent = String(state.kills);
  const elapsed = state.running ? Math.floor((now - state.startedAt) / 1000) : 0;
  timeEl.textContent = `${elapsed}s`;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function loop(now) {
  if (!state.running) return;
  try {
    stepPlayerMove(now);
    maybeSpawnEnemy(now);
    stepProjectiles(now);
    stepEnemies(now);
    resolveCollisions();
    render(now);
    updateHud(now);
  } catch (err) {
    // Don't let a single frame's exception kill the rAF chain (and freeze
    // the canvas mid-render). Log and keep ticking.
    console.error("ranger-survivor loop error:", err);
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function start() {
  resetState();
  state.running = true;
  state.startedAt = performance.now();
  state.lastSpawnAt = state.startedAt;
  scoreForm.classList.add("hidden");
  scoreAlreadySubmitted = false;
  submitScoreButton.disabled = false;
  submitScoreButton.textContent = "Submit score";
  overlay.classList.add("hidden");
  canvas.focus();
  requestAnimationFrame(loop);
}

function resetState() {
  state.kills = 0;
  state.player = {
    x: 8, y: 8, facing: "right",
    moving: false, moveStartAt: 0,
    fromX: 8, fromY: 8, toX: 8, toY: 8,
  };
  state.enemies = [];
  state.projectiles = [];
  state.spawnIntervalMs = INITIAL_SPAWN_INTERVAL_MS;
  state.tileMap = buildStartingMap();
}

function gameOver() {
  state.running = false;
  lastRunDurationSeconds = Math.floor((performance.now() - state.startedAt) / 1000);
  overlayTitle.textContent = `Enemies killed: ${state.kills}`;
  overlayText.textContent = "Move with WASD. Shoot with the arrow keys.";
  scoreForm.classList.remove("hidden");
  scoreAlreadySubmitted = false;
  submitScoreButton.disabled = false;
  submitScoreButton.textContent = "Submit score";
  overlay.classList.remove("hidden");
  refreshLeaderboard();
}

overlayButton.addEventListener("click", start);
submitScoreButton.addEventListener("click", submitScore);
playerNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitScore();
  }
});
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

refreshLeaderboard();

loadSprites().then(() => {
  render(performance.now());
});

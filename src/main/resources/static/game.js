// Ranger Survivor: top-down tile-based survival shooter.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TILE_SIZE = 48;
const MAP_COLS = 32;
const MAP_ROWS = 16;

// Player always starts at map center. Map generation reserves a 3x3 around it.
const PLAYER_START_X = Math.floor(MAP_COLS / 2);
const PLAYER_START_Y = Math.floor(MAP_ROWS / 2);

const SPRITE_PATHS = {
  // Character sheets: 6 rows (idle/walk/run/attack/hurt/die) x 10 frames.
  archer: "sprites/archer_anim.png",   // player variant 1 (silver)
  archer2: "sprites/archer2_anim.png", // player variant 2 (red)
  archer3: "sprites/archer3_anim.png", // player variant 3 (green)
  knight: "sprites/knight_anim.png",   // enemy_one (silver, spear)
  knight2: "sprites/knight2_anim.png", // enemy_two (bronze, axe)
  knight3: "sprites/knight3_anim.png", // enemy_three (gold, sword)
  arrow:  "sprites/arrow.png",         // projectile
  // Single castle sprite drawn on every enemy spawn fort.
  spawnCastle: "sprites/spawn_castle.png",
  // Native 48x48 terrain tiles (drawn 1:1, no shift/scaling).
  grass: "sprites/grass.png",
  path:  "sprites/path.png",
  water: "sprites/water.png",
  tree:  "sprites/tree.png",
  // Map border: side (dark edge on the right) and corner (dark inner edges,
  // transparent inner quadrant), each rotated per position so the dark side
  // faces into the map.
  mountainSide: "sprites/mountain_side.png",
  mountainCorner: "sprites/mountain_corner.png",
};

// Source rects within each sheet: (left, top, width, height).
const SRC = {
  // Grass, path, water, and tree are native 48x48 sprites (the whole image).
  // Mountain border tiles are drawn separately (see drawMountainBorder).
  GRASS: { sheet: "grass", x: 0, y: 0, w: 48, h: 48 },
  PATH:  { sheet: "path",  x: 0, y: 0, w: 48, h: 48 },
  TREE:  { sheet: "tree",  x: 0, y: 0, w: 48, h: 48 },
  WATER: { sheet: "water", x: 0, y: 0, w: 48, h: 48 },
};

// ---------------------------------------------------------------------------
// Character animations
// ---------------------------------------------------------------------------
// Each sheet is a 6-row x 10-frame grid. (ax, ay) is the character's feet-center
// within a cell, used to anchor the sprite to its tile so it stays put across
// poses. SCALE shrinks the high-res cell down to game size.
const ANIM_ROW = { IDLE: 0, WALK: 1, RUN: 2, ATTACK: 3, HURT: 4, DIE: 5 };
const ANIM_FRAMES = 10;
const ARCHER_CELL = { sheet: "archer", w: 277, h: 240, ax: 88.1, ay: 216.1, scale: 0.27 };
// Selectable player skins (cosmetic only). All three sheets share ARCHER_CELL's
// geometry, so the chosen one is drop-in. selectedArcher indexes this list.
const ARCHER_SHEETS = ["archer", "archer2", "archer3"];
let selectedArcher = 0;
function playerCell() { return { ...ARCHER_CELL, sheet: ARCHER_SHEETS[selectedArcher] }; }
// Three knight variants (enemy_one/two/three) share the same 2x cell geometry;
// only the sheet and the horizontal anchor differ. ax is each knight's body
// pixel-mass centroid (not the bbox center) so the body sits on the tile and the
// weapon (spear/axe/sword) overhangs rather than pulling the body off-center.
const KNIGHT_CELL  = { sheet: "knight",  w: 350, h: 240, ax: 141.9, ay: 235.5, scale: 0.2109 };
const KNIGHT2_CELL = { sheet: "knight2", w: 350, h: 240, ax: 152.9, ay: 235.5, scale: 0.2109 };
const KNIGHT3_CELL = { sheet: "knight3", w: 350, h: 240, ax: 147.4, ay: 235.5, scale: 0.2109 };
// Frame duration in ms per animation (lower = faster).
const ANIM_FRAME_MS = { IDLE: 130, WALK: 80, RUN: 60, ATTACK: 55, HURT: 70, DIE: 90 };
// How long the attack pose is held after firing (one full attack cycle).
const ATTACK_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.ATTACK;
// When in the attack swing the arrow actually leaves the bow (fraction of the
// cycle). The draw happens first, then the arrow releases.
const ARROW_RELEASE_MS = Math.round(ATTACK_HOLD_MS * 0.6);
// How long the hurt flinch plays after a non-fatal hit (one full cycle).
const HURT_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.HURT;

const TILES = {
  GRASS: 0,
  PATH: 1,
  MOUNTAIN: 2,
  TREE: 3,
  WATER: 4,
};

// Tiles that block entities (player + enemies). Water blocks walking.
const ENTITY_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE, TILES.WATER]);
// Tiles that block projectiles. Water does not block arrows, they fly over.
const PROJECTILE_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE]);

function isSolid(tileId) {
  return ENTITY_SOLID_TILES.has(tileId);
}

function blocksProjectile(tileId) {
  return PROJECTILE_SOLID_TILES.has(tileId);
}

// Forts (castle tiles) sit on the spawn points and block all movement (player,
// enemies, arrows). An enemy is exempt only on its own spawn tile, where A*
// never treats the current cell as a neighbor.
const FORT_CELLS = new Set();
function fortKey(x, y) { return y * MAP_COLS + x; }
function isFortAt(x, y) { return FORT_CELLS.has(fortKey(x, y)); }

function tileSrc(tileId) {
  if (tileId === TILES.PATH) return SRC.PATH;
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

// Four corners plus the midpoint of each edge, derived from the map size so
// they stay correctly placed if the dimensions change.
const SPAWN_POINTS = [
  { x: 1,              y: 1 },
  { x: MAP_COLS - 2,   y: 1 },
  { x: 1,              y: MAP_ROWS - 2 },
  { x: MAP_COLS - 2,   y: MAP_ROWS - 2 },
  { x: PLAYER_START_X, y: 1 },
  { x: PLAYER_START_X, y: MAP_ROWS - 2 },
  { x: 1,              y: PLAYER_START_Y },
  { x: MAP_COLS - 2,   y: PLAYER_START_Y },
];
// Mark each spawn-point tile as a fort cell so movement code can block it.
for (const s of SPAWN_POINTS) FORT_CELLS.add(fortKey(s.x, s.y));

const INITIAL_SPAWN_INTERVAL_MS = 3000;
const MIN_SPAWN_INTERVAL_MS = 700;
// Per-kill spawn-interval reduction. Lowered so the overall pace ramps up more
// gradually (reaches the floor around ~50 kills instead of ~25).
const SPAWN_ACCEL_PER_KILL_MS = 45;

// Cap concurrent enemies. Each living enemy runs an A* every move tick, so an
// uncapped count would degrade frame rate on long runs. The board stays
// dangerous at this cap.
const MAX_ENEMIES = 40;

const ARROW_STEP_MS = 50;
const ARROW_MAX_RANGE = 6;
// Base time between shots (one arrow per 2s). The live gap is this divided by
// fireRateMult, so Fire Rate cards shorten it.
const ARROW_COOLDOWN_MS = 2000;

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

// Clockwise ring of the 8 directions, used by Multi-Shot to find the two
// directions 45 degrees to each side of the aimed one.
const DIR_RING = ["up", "upright", "right", "downright", "down", "downleft", "left", "upleft"];
function fanDirections(direction) {
  const i = DIR_RING.indexOf(direction);
  if (i === -1) return [direction];
  return [direction, DIR_RING[(i + 1) % 8], DIR_RING[(i + 7) % 8]];
}

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

// Default ms-per-tile at 1.0x speed. All movers scale off this.
const DEFAULT_MOVE_DURATION_MS = 225;
// Player base = default speed; path tiles run faster, grass slower.
const PLAYER_MOVE_DURATION_MS = DEFAULT_MOVE_DURATION_MS;
// Terrain multipliers applied to the base duration.
//   Path: +15% speed → 225 / 1.15 ≈ 196ms
//   Grass: -15% speed → 225 / 0.85 ≈ 265ms
const PATH_SPEED_MULT  = 1.15;
const GRASS_SPEED_MULT = 0.85;
// Diagonal moves take sqrt(2)x longer than the corresponding cardinal step
// so per-axis speed stays constant.
const DIAG_DURATION_FACTOR = 1.414;

// Enemy type registry. Each spawned enemy carries a `type` key into this table;
// new enemy kinds get added here. speedScale is a fraction of the player's speed
// on the same terrain (lower = slower): enemy_one 25%, enemy_two 40%, enemy_three 60%.
const ENEMY_TYPES = {
  enemy_one: {
    cell: KNIGHT_CELL,
    speedScale: 0.25,        // 25% of default speed
    attackWindupMs: 1000,    // winds up an attack over ~1s before it lands
    damage: 1,
    hp: 1,                   // dies in 1 arrow
    spawnAfterMs: 0,         // available from the start
    spawnRampMs: 0,          // full spawn weight immediately
  },
  enemy_two: {
    cell: KNIGHT2_CELL,
    speedScale: 0.40,        // 40% of default move speed
    attackWindupMs: 1000,
    damage: 1,
    hp: 2,                   // takes 2 arrows
    spawnAfterMs: 45000,     // starts appearing 45s in
    spawnRampMs: 60000,      // rare at first, ramps to full over the next 60s
  },
  enemy_three: {
    cell: KNIGHT3_CELL,
    speedScale: 0.60,        // 60% of default move speed
    attackWindupMs: 1000,
    damage: 1,
    hp: 4,                   // takes 4 arrows
    spawnAfterMs: 90000,     // starts appearing 90s in
    spawnRampMs: 60000,      // rare at first, ramps to full over the next 60s
  },
};
// Spawn weight for a type at the given run time: 0 before unlock, then ramps
// from ~0 up to 1 over spawnRampMs so newly-unlocked enemies trickle in before
// becoming common. enemy_one (rampMs 0) is always weight 1.
function spawnWeight(typeKey, elapsed) {
  const t = ENEMY_TYPES[typeKey];
  if (elapsed < t.spawnAfterMs) return 0;
  if (!t.spawnRampMs) return 1;
  return Math.min(1, (elapsed - t.spawnAfterMs) / t.spawnRampMs);
}
// Per-tile speed multiplier (path faster, grass slower). Shared by player and
// enemies so speedScale stays a true fraction of the player's speed on the same
// terrain. Otherwise enemies (ignoring terrain) outpace a grass-slowed player.
function terrainMult(tileId) {
  if (tileId === TILES.PATH) return PATH_SPEED_MULT;
  if (tileId === TILES.GRASS) return GRASS_SPEED_MULT;
  return 1.0;
}
// Duration for an enemy of `type` stepping onto `destTileId`, matching how the
// player's own per-tile duration is computed.
function enemyStepDuration(type, destTileId) {
  return Math.round((DEFAULT_MOVE_DURATION_MS / terrainMult(destTileId)) / ENEMY_TYPES[type].speedScale);
}

// Player life: number of hearts; loses one per connected enemy hit, dies at 0.
const BASE_MAX_LIVES = 3;
const BASE_DAMAGE = 1;          // arrow damage at the start of a run

// Run buffs chosen from the upgrade cards every 15 kills. These persist until
// game over and are reset in resetState(). state.maxLives and state.lives hold
// the heart counts.
let playerDamage = BASE_DAMAGE; // hp removed per arrow hit
let playerSpeedMult = 1.0;      // movement speed multiplier (1.15x per Speed card)
let fireRateMult = 1.0;         // firing rate multiplier (1.5x per Fire Rate card)
let playerMultiShot = false;    // fire 3 arrows in a fan when true
let buffsAwarded = 0;           // how many upgrade cards have been granted

// ---------------------------------------------------------------------------
// Canvas + HUD wiring
// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
// Internal resolution tracks the tile grid (MAP_COLS x MAP_ROWS) at full 48px
// tiles, so 48px art (the spawn castle) and the high-res character sheets render
// crisply. DISPLAY_SCALE 1.0 displays the canvas 1:1 (1536x768 on screen). Must
// be set before getContext, since resizing the canvas resets context state like
// imageSmoothingEnabled.
const DISPLAY_SCALE = 1.0;
canvas.width = MAP_COLS * TILE_SIZE;
canvas.height = MAP_ROWS * TILE_SIZE;
canvas.style.width = `${canvas.width * DISPLAY_SCALE}px`;
canvas.style.height = `${canvas.height * DISPLAY_SCALE}px`;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const killEl = document.getElementById("kill-count");
const timeEl = document.getElementById("time-value");
const heartsEl = document.getElementById("hearts");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayButton = document.getElementById("overlay-button");
const scoreForm = document.getElementById("score-form");
const playerNameInput = document.getElementById("player-name");
const submitScoreButton = document.getElementById("submit-score-button");
const leaderboardList = document.getElementById("leaderboard-list");

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------
const musicMuteBtn = document.getElementById("music-mute-btn");
const musicSlider = document.getElementById("music-slider");
const sfxMuteBtn = document.getElementById("sfx-mute-btn");
const sfxSlider = document.getElementById("sfx-slider");

let musicVolume = 0.10;   // start at 10%
let musicMuted = false;
let sfxVolume = 0.25;     // effects default
let sfxMuted = false;
let musicMode = "none";   // "menu" | "game" | "none"

const menuMusic = new Audio("audio/menu.mp3");
menuMusic.loop = true;
const gameTracks = ["audio/game1.mp3", "audio/game2.mp3", "audio/game3.mp3"].map((src) => new Audio(src));
let currentGameTrack = 0;
// Loop the in-game playlist: when one track ends, start the next (1->2->3->1).
gameTracks.forEach((a, i) => {
  a.addEventListener("ended", () => {
    if (musicMode !== "game") return;
    currentGameTrack = (i + 1) % gameTracks.length;
    const next = gameTracks[currentGameTrack];
    next.currentTime = 0;
    next.volume = effectiveVolume();
    next.play().catch(() => {});
  });
});

// Music plays at a tenth of the slider value (the tracks are loud), so 10%
// on the slider is ~1% actual. SFX are unaffected.
const MUSIC_GAIN = 0.1;
function effectiveVolume() { return musicMuted ? 0 : musicVolume * MUSIC_GAIN; }
function effectiveSfxVolume() { return sfxMuted ? 0 : sfxVolume; }
function applyVolume() {
  const v = effectiveVolume();
  menuMusic.volume = v;
  for (const a of gameTracks) a.volume = v;
}
function playMenuMusic() {
  musicMode = "menu";
  for (const a of gameTracks) a.pause();
  menuMusic.volume = effectiveVolume();
  menuMusic.play().catch(() => {});
}
function playGameMusic() {
  musicMode = "game";
  menuMusic.pause();
  currentGameTrack = 0;
  const a = gameTracks[0];
  a.currentTime = 0;
  a.volume = effectiveVolume();
  a.play().catch(() => {});
}
function pauseMusic() {
  menuMusic.pause();
  for (const a of gameTracks) a.pause();
}
function resumeMusic() {
  if (musicMode === "game") gameTracks[currentGameTrack].play().catch(() => {});
  else if (musicMode === "menu") menuMusic.play().catch(() => {});
}
function updateMuteIcon() {
  musicMuteBtn.textContent = musicMuted || musicVolume === 0 ? "\u{1F507}" : "\u{1F50A}";
  sfxMuteBtn.textContent = sfxMuted || sfxVolume === 0 ? "\u{1F507}" : "\u{1F50A}";
}

musicSlider.addEventListener("input", () => {
  musicVolume = Number(musicSlider.value) / 100;
  if (musicVolume > 0) musicMuted = false;
  applyVolume();
  updateMuteIcon();
});
musicMuteBtn.addEventListener("click", () => {
  musicMuted = !musicMuted;
  applyVolume();
  updateMuteIcon();
});
sfxSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxSlider.value) / 100;
  if (sfxVolume > 0) sfxMuted = false;
  updateMuteIcon();
});
sfxMuteBtn.addEventListener("click", () => {
  sfxMuted = !sfxMuted;
  updateMuteIcon();
});

applyVolume();
updateMuteIcon();

// Sound effects via Web Audio. HTMLAudio (cloneNode + play) added tens of ms of
// latency, so the bow twang lagged the arrow by a few frames; a decoded buffer
// fired through an AudioContext plays effectively instantly. Effects have their
// own volume/mute (the SFX control), separate from music, plus a per-effect boost.
const SFX_PATHS = { bow: "audio/bow_release.mp3", hurt: "audio/male_hurt.mp3" };
// Effects play at a quarter of their computed level (overall SFX trim).
const SFX_GAIN = 0.25;
let audioCtx = null;
const sfxBuffers = {};
function ensureAudioCtx() {
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor({ latencyHint: "interactive" }); // minimize output latency
    } catch (_) { audioCtx = null; }
  }
  return audioCtx;
}
function loadSfx() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  for (const [name, url] of Object.entries(SFX_PATHS)) {
    if (sfxBuffers[name]) continue;
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { sfxBuffers[name] = buf; })
      .catch(() => {});
  }
}
function playSfx(name, boost = 1) {
  const ctx = audioCtx;
  const buf = sfxBuffers[name];
  const v = effectiveSfxVolume();
  if (!ctx || !buf || v <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, v * boost)) * SFX_GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
// Decode the clips up front so they're ready before the first shot.
loadSfx();

// Edge-of-screen red damage flash. Set when the player is hit; the vignette
// fades from the screen edges toward the center over DAMAGE_FLASH_MS.
const DAMAGE_FLASH_MS = 900;
let damageFlashUntil = 0;

// Browser autoplay blocks audio until a user gesture; start the menu track on
// the first interaction if nothing is playing yet.
function unlockAudio() {
  if (musicMode === "none" && !state.running) playMenuMusic();
  const ctx = ensureAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  loadSfx(); // ensure buffers are decoding if the eager load was blocked
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Restore the last-used player name from localStorage so they don't retype it.
try {
  const savedName = localStorage.getItem("ranger-survivor.playerName");
  if (savedName) playerNameInput.value = savedName;
} catch (_) { /* localStorage may be disabled */ }

let lastRunDurationSeconds = 0;
let scoreAlreadySubmitted = false;

// Fetch the top scores from the backend and render them into the
// overlay's leaderboard list. Silently no-ops on network failure.
async function refreshLeaderboard() {
  try {
    const res = await fetch("api/scores/top?limit=5");
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
    leaderboardList.innerHTML = '<li class="leaderboard-empty">No scores yet</li>';
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
  // No name, silently do nothing. The player can still hit Start.
  if (!name) return;
  try {
    localStorage.setItem("ranger-survivor.playerName", name);
  } catch (_) {}
  submitScoreButton.disabled = true;
  submitScoreButton.textContent = "Submitting…";
  try {
    const res = await fetch("api/scores", {
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
  paused: false,
  choosingBuff: false,
  startedAt: 0,
  kills: 0,
  maxLives: BASE_MAX_LIVES,
  lives: BASE_MAX_LIVES,
  player: {
    x: PLAYER_START_X,
    y: PLAYER_START_Y,
    facing: "right",
    moving: false,
    moveStartAt: 0,
    moveDuration: 0,
    fromX: PLAYER_START_X,
    fromY: PLAYER_START_Y,
    toX: PLAYER_START_X,
    toY: PLAYER_START_Y,
    anim: "IDLE",
    animStart: 0,
    dying: false,
    deathStart: 0,
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
  // 3. Scatter a few impassable "strings" of trees or water, short runs of
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
  // Paths weighted so most routes run from a fort to the center. They read as
  // spokes into the middle rather than random crossings, and heading inward keeps
  // them off the mountain wall.
  const pathCount = 8 + Math.floor(Math.random() * 4); // 8-11
  for (let i = 0; i < pathCount; i++) {
    if (Math.random() < 0.7) {
      const s = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      carveBetween(s.x, s.y, PLAYER_START_X, PLAYER_START_Y);
    } else {
      carveEdgeToEdge();
    }
  }

  // ---- 2) Drop spawn forts on path tiles ----
  for (const s of SPAWN_POINTS) {
    map[s.y][s.x] = TILES.PATH;
  }

  // Starting area is a deliberate 3x3 path block around the player. These tiles
  // are reserved, so the thinning pass below leaves the block intact.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      map[PLAYER_START_Y + dy][PLAYER_START_X + dx] = TILES.PATH;
    }
  }

  // ---- Thin paths to a single tile wide ----
  // A path that has bulged to width 2+ shows up as a 2x2 block of all-path
  // tiles, so demote one non-reserved, non-fort corner back to grass and repeat
  // until none remain. This trims wide paths into trails and leaves bigger grass
  // blobs. Diagonal paths never form a 2x2 block, so they're preserved. Grass
  // stays walkable (just slower), so thinning never breaks reachability.
  function thinPaths() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          const block = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
          if (!block.every(([bx, by]) => map[by][bx] === TILES.PATH)) continue;
          for (const [bx, by] of [[x + 1, y + 1], [x + 1, y], [x, y + 1], [x, y]]) {
            if (reserved.has(by * MAP_COLS + bx)) continue;
            if (isFortAt(bx, by)) continue;
            map[by][bx] = TILES.GRASS;
            changed = true;
            break;
          }
        }
      }
    }
  }
  thinPaths();

  // ---- Keep parallel paths at least 2 grass tiles apart ----
  // Two parallel straight paths separated by a single grass tile read as one
  // fat path with a seam. Demote the offending run so distinct parallel paths
  // always have >=2 grass between them.
  //
  // A tile only qualifies if it is a "pure straight" path tile: path on both
  // sides along one axis and grass on both sides of the other. Corner tiles have
  // a perpendicular path neighbour, and diagonal/staircase tiles aren't straight,
  // so neither qualifies. Corners and diagonal paths are preserved.
  //
  // It only checks the down and right sides, so of two close parallel runs one
  // is removed and the other survives. Demotions are computed on a snapshot and
  // applied together so a run is removed cleanly instead of leaving a dashed
  // remnant. Reserved tiles (start block, spawns) are never demoted.
  function spaceParallelPaths() {
    const isP = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.PATH;
    const isG = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.GRASS;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      const toGrass = [];
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.PATH) continue;
          if (reserved.has(y * MAP_COLS + x)) continue;
          if (isFortAt(x, y)) continue;
          const pureH = isP(x - 1, y) && isP(x + 1, y) && !isP(x, y - 1) && !isP(x, y + 1);
          const pureV = isP(x, y - 1) && isP(x, y + 1) && !isP(x - 1, y) && !isP(x + 1, y);
          const parallelBelow = pureH && isG(x, y + 1) && isP(x, y + 2);
          const parallelRight = pureV && isG(x + 1, y) && isP(x + 2, y);
          if (parallelBelow || parallelRight) toGrass.push([x, y]);
        }
      }
      for (const [x, y] of toGrass) {
        map[y][x] = TILES.GRASS;
        changed = true;
      }
    }
  }
  spaceParallelPaths();

  // ---- No paths hugging the mountain border ----
  // Demote path tiles on the inner ring (the tiles adjacent to the border) back
  // to grass, unless the tile is a spawn fort or directly next to one. That keeps
  // fort access but stops paths from running along the wall. Removed tiles become
  // walkable grass, so reachability is unaffected.
  function removeEdgePaths() {
    const onInnerRing = (x, y) =>
      x === 1 || x === MAP_COLS - 2 || y === 1 || y === MAP_ROWS - 2;
    for (let y = 1; y < MAP_ROWS - 1; y++) {
      for (let x = 1; x < MAP_COLS - 1; x++) {
        if (map[y][x] !== TILES.PATH) continue;
        if (!onInnerRing(x, y)) continue;
        if (isFortAt(x, y)) continue;
        let nextToSpawn = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (isFortAt(x + dx, y + dy)) { nextToSpawn = true; break; }
        }
        if (nextToSpawn) continue;
        map[y][x] = TILES.GRASS;
      }
    }
  }
  removeEdgePaths();

  // ---- Keep paths continuous and free of orphaned 1x1 tiles ----
  // Thinning and parallel-spacing can nick a single tile out of a path (leaving
  // a 1-tile break) or strand a lone tile. First bridge collinear single-tile
  // gaps so a path reconnects, then remove any small path group that isn't
  // anchored to the start block or a spawn.
  function bridgePathGaps() {
    const isP = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.PATH;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      const toPath = [];
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
          // Only fill a genuine one-tile break in a single straight path: the
          // path must continue in the SAME direction two tiles out (isP at +/-2),
          // with grass on the perpendicular sides. Requiring the +/-2 tiles to be
          // path is what tells a real line gap apart from the grass row/column
          // BETWEEN two parallel paths. Parallel paths are one tile wide, so two
          // tiles to the side is grass and the case no longer qualifies, so bridging
          // never fuses parallel paths.
          const horizontalGap =
            isP(x - 1, y) && isP(x + 1, y) && isP(x - 2, y) && isP(x + 2, y) &&
            !isP(x, y - 1) && !isP(x, y + 1);
          const verticalGap =
            isP(x, y - 1) && isP(x, y + 1) && isP(x, y - 2) && isP(x, y + 2) &&
            !isP(x - 1, y) && !isP(x + 1, y);
          if (horizontalGap || verticalGap) toPath.push([x, y]);
        }
      }
      for (const [x, y] of toPath) {
        map[y][x] = TILES.PATH;
        changed = true;
      }
    }
  }

  function removePathFragments() {
    const MIN_PATH_RUN = 4;
    const seen = new Set();
    for (let y = 1; y < MAP_ROWS - 1; y++) {
      for (let x = 1; x < MAP_COLS - 1; x++) {
        if (map[y][x] !== TILES.PATH) continue;
        if (seen.has(y * MAP_COLS + x)) continue;
        const group = [];
        let anchored = false;
        const q = [[x, y]];
        seen.add(y * MAP_COLS + x);
        while (q.length > 0) {
          const [cx, cy] = q.shift();
          group.push([cx, cy]);
          if (reserved.has(cy * MAP_COLS + cx) || isFortAt(cx, cy)) anchored = true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
            if (map[ny][nx] !== TILES.PATH) continue;
            const nk = ny * MAP_COLS + nx;
            if (seen.has(nk)) continue;
            seen.add(nk);
            q.push([nx, ny]);
          }
        }
        // Anchored groups (start block, spawn forts) stay regardless of size.
        if (!anchored && group.length < MIN_PATH_RUN) {
          for (const [px, py] of group) map[py][px] = TILES.GRASS;
        }
      }
    }
  }

  bridgePathGaps();
  removePathFragments();

  // ---- Land the path network on a tile budget ----
  // After all the shaping above, bring the total path-tile count into a random
  // 48-64 range. Trim dead-end tips if we're over, extend tips into open grass if
  // we're under. Both keep paths width-1 and connected, and growth stays off the
  // mountain wall and never forms a 2x2 block.
  function adjustPathTiles(target) {
    const isPath = (x, y) =>
      x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.PATH;
    const onInnerRing = (x, y) =>
      x === 1 || x === MAP_COLS - 2 || y === 1 || y === MAP_ROWS - 2;
    const orthoPathCount = (x, y) => {
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isPath(x + dx, y + dy)) n++;
      return n;
    };
    // Would making (x,y) a path complete a 2x2 all-path block?
    const wouldForm2x2 = (x, y) => {
      const corners = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
      for (const [ox, oy] of corners) {
        let all = true;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const cx = x + ox + dx, cy = y + oy + dy;
          if (cx === x && cy === y) continue; // the tile we're adding
          if (!isPath(cx, cy)) { all = false; break; }
        }
        if (all) return true;
      }
      return false;
    };
    let count = 0;
    for (let y = 1; y < MAP_ROWS - 1; y++)
      for (let x = 1; x < MAP_COLS - 1; x++) if (map[y][x] === TILES.PATH) count++;

    // Over budget: peel a dead-end tip (1 path neighbour) if one exists, which
    // keeps the network connected and orphan-free. If only loops remain (every
    // tile has 2+ neighbours, so no tips), break one by removing a loop tile;
    // that creates fresh tips for the next passes. Reserved/fort tiles are never
    // removed, so the start block and fort access stay intact.
    let guard = 0;
    while (count > target && guard++ < 8000) {
      let tip = null, fallback = null;
      for (let y = 1; y < MAP_ROWS - 1 && !tip; y++) {
        for (let x = 1; x < MAP_COLS - 1 && !tip; x++) {
          if (map[y][x] !== TILES.PATH) continue;
          if (reserved.has(y * MAP_COLS + x) || isFortAt(x, y)) continue;
          if (orthoPathCount(x, y) <= 1) tip = [x, y];
          else if (!fallback) fallback = [x, y];
        }
      }
      const victim = tip || fallback;
      if (!victim) break;
      map[victim[1]][victim[0]] = TILES.GRASS;
      count--;
    }

    // Under budget: extend a tip into adjacent open grass, keeping width 1.
    guard = 0;
    while (count < target && guard++ < 4000) {
      const candidates = [];
      for (let y = 2; y < MAP_ROWS - 2; y++) {
        for (let x = 2; x < MAP_COLS - 2; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
          if (onInnerRing(x, y)) continue;
          if (orthoPathCount(x, y) !== 1) continue; // extends exactly one path tip
          if (wouldForm2x2(x, y)) continue;
          candidates.push([x, y]);
        }
      }
      if (candidates.length === 0) break;
      const [gx, gy] = candidates[Math.floor(Math.random() * candidates.length)];
      map[gy][gx] = TILES.PATH;
      count++;
    }
  }
  const pathTarget = 56 + Math.floor(Math.random() * 17); // 56-72
  adjustPathTiles(pathTarget);

  // Helper: a cell is OK to convert to an obstacle only if it's interior
  // grass, not reserved, not a fort. Path/water/tree/mountain are off-limits.
  const obstacleSafe = (x, y) => {
    if (!inInterior(x, y)) return false;
    if (reserved.has(y * MAP_COLS + x)) return false;
    if (isFortAt(x, y)) return false;
    return map[y][x] === TILES.GRASS;
  };

  // ---- Protect one route per fort before any obstacles are placed ----
  // BFS from the center over the current (obstacle-free) walkable tiles, then
  // trace each fort's route back to the center and reserve those tiles. Water and
  // trees skip reserved tiles, so they can never block a fort's path. With every
  // fort already connected, the validation step below carves nothing, so the
  // water and tree budgets are never eroded.
  function protectFortRoutes() {
    const parent = new Map();
    const startK = PLAYER_START_Y * MAP_COLS + PLAYER_START_X;
    const seen = new Set([startK]);
    const q = [[PLAYER_START_X, PLAYER_START_Y]];
    while (q.length > 0) {
      const [cx, cy] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
        const k = ny * MAP_COLS + nx;
        if (seen.has(k)) continue;
        if (isSolid(map[ny][nx])) continue;
        seen.add(k);
        parent.set(k, [cx, cy]);
        if (isFortAt(nx, ny)) continue; // reachable as a leaf, don't expand past it
        q.push([nx, ny]);
      }
    }
    for (const s of SPAWN_POINTS) {
      let k = s.y * MAP_COLS + s.x;
      let cur = [s.x, s.y];
      while (parent.has(k)) {
        reserved.add(k);
        cur = parent.get(k);
        if (cur[0] === PLAYER_START_X && cur[1] === PLAYER_START_Y) break;
        k = cur[1] * MAP_COLS + cur[0];
      }
    }
  }
  protectFortRoutes();

  // ---- 3) Water: ponds of 8-16 tiles, random 32-64 water tiles total ----
  // Placed BEFORE trees so ponds get first pick of open grass and reliably reach
  // their size. Trees then fill the grass that's left.
  // Adjacency rule: a water tile must only ever touch other water tiles
  // orthogonally. Disconnected diagonal pairs are forbidden, any diagonal
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

  const MIN_WATER_TILES = 8;    // smallest pond worth keeping
  // Random total water budget for the map: lots of water, with a floor of 32.
  const waterTarget = 48 + Math.floor(Math.random() * 25); // 48-72
  const orthoDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Add ponds (8-16 tiles each) until the map reaches waterTarget water tiles.
  // Ponds may grow into each other and merge; only the total is guaranteed. A
  // pond that stalls below the minimum is rolled back and retried. Nothing
  // removes water afterward, so this total is what renders.
  let totalWater = 0;
  let clusterAttempts = 0;
  while (totalWater < waterTarget && clusterAttempts++ < 300) {
    const remaining = waterTarget - totalWater;
    let cx = -1, cy = -1;
    for (let seedAttempt = 0; seedAttempt < 60; seedAttempt++) {
      const sx = 2 + Math.floor(Math.random() * (MAP_COLS - 4));
      const sy = 2 + Math.floor(Math.random() * (MAP_ROWS - 4));
      if (waterPlaceable(sx, sy)) { cx = sx; cy = sy; break; }
    }
    if (cx < 0) break; // no placeable seed left, map is full

    // Cap the pond at the remaining budget so the total never overshoots. The
    // final pond may be smaller than the usual 8 to land the total exactly.
    const desired = MIN_WATER_TILES + Math.floor(Math.random() * 9); // 8-16
    const target = Math.min(desired, remaining);
    const placed = [{ x: cx, y: cy }];
    map[cy][cx] = TILES.WATER;

    // Grow by gathering every valid expansion tile around the current pond and
    // adding one at random, so growth only stops when the pond is truly boxed in.
    while (placed.length < target) {
      const candidates = [];
      for (const p of placed) {
        for (const [dx, dy] of orthoDirs) {
          if (waterPlaceable(p.x + dx, p.y + dy)) candidates.push([p.x + dx, p.y + dy]);
        }
      }
      if (candidates.length === 0) break;
      const [nx, ny] = candidates[Math.floor(Math.random() * candidates.length)];
      map[ny][nx] = TILES.WATER;
      placed.push({ x: nx, y: ny });
    }

    const keepThreshold = Math.min(MIN_WATER_TILES, remaining);
    if (placed.length >= keepThreshold) {
      totalWater += placed.length;                          // keep it, count the tiles
    } else {
      for (const p of placed) map[p.y][p.x] = TILES.GRASS;  // too small, undo and retry
    }
  }

  // ---- 4) Trees: random 120-144 tiles total, placed as strings and clumps ----
  // Keep laying down short strings (and the occasional 2x2 clump) until the tile
  // budget is met. Strings/clumps are preferred over singles so trees read as
  // thickets rather than scattered dots.
  const treeTarget = 144 + Math.floor(Math.random() * 25); // 144-168
  let treeTiles = 0;
  // Walk a shuffled list of every open grass tile, growing a string or clump
  // from each. Iterating real grass tiles (instead of random guesses) guarantees
  // we reach the budget as long as enough grass exists, and the inner breaks stop
  // exactly at the target so it never overshoots.
  const openGrass = [];
  for (let y = 1; y < MAP_ROWS - 1; y++) {
    for (let x = 1; x < MAP_COLS - 1; x++) {
      if (obstacleSafe(x, y)) openGrass.push([x, y]);
    }
  }
  for (let i = openGrass.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [openGrass[i], openGrass[j]] = [openGrass[j], openGrass[i]];
  }
  for (const [sx, sy] of openGrass) {
    if (treeTiles >= treeTarget) break;
    if (!obstacleSafe(sx, sy)) continue; // already filled by an earlier clump
    if (Math.random() < 0.25) {
      // 2x2 clump
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (treeTiles >= treeTarget) break;
        const x = sx + dx, y = sy + dy;
        if (!obstacleSafe(x, y)) continue;
        map[y][x] = TILES.TREE;
        treeTiles++;
      }
    } else {
      // short straight string of 2-5 tiles
      const length = 2 + Math.floor(Math.random() * 4);
      const horizontal = Math.random() < 0.5;
      for (let k = 0; k < length; k++) {
        if (treeTiles >= treeTarget) break;
        const x = horizontal ? sx + k : sx;
        const y = horizontal ? sy : sy + k;
        if (!obstacleSafe(x, y)) continue;
        map[y][x] = TILES.TREE;
        treeTiles++;
      }
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
  // are NOT solid (mountain/tree/water) AND NOT another fort, because an enemy
  // can step OFF its own fort but never INTO any fort. Otherwise a corner fort
  // can be trapped by other forts on its only path.
  //
  // Reachability is measured from the player tile inward. A fort's spawn cell
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

  // No water post-processing here. Every water tile already passed waterPlaceable
  // at placement (so there are no diagonal-only adjacencies to clean up) and
  // sub-8 ponds were rolled back during generation. Removing tiles now would only
  // break the guaranteed water total.

  // ---- Fort backdrop: grass unless a path connects ----
  // Each fort tile was forced to path during generation. Now, after all carving
  // and thinning is final, only keep it as path when a path actually reaches it
  // (an orthogonal neighbor is path); otherwise sit the castle on grass. Fort
  // tiles block movement regardless, so this only changes what shows around the
  // castle.
  for (const s of SPAWN_POINTS) {
    const connected = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = s.x + dx, ny = s.y + dy;
      return nx >= 0 && nx < MAP_COLS && ny >= 0 && ny < MAP_ROWS && map[ny][nx] === TILES.PATH;
    });
    map[s.y][s.x] = connected ? TILES.PATH : TILES.GRASS;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Sprite loading
// ---------------------------------------------------------------------------

// Populated by loadSprites() from SPRITE_PATHS; keys match those entries.
const sprites = {};

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

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

// Current frame index for an animation that started at startMs. Loops unless
// `once`, in which case it clamps on the last frame. speedMult > 1 plays it
// faster (used to speed the bow draw up with the player's fire rate).
function animFrameIndex(startMs, now, anim, once, speedMult = 1) {
  const i = Math.floor((now - startMs) * speedMult / ANIM_FRAME_MS[anim]);
  if (once) return Math.max(0, Math.min(ANIM_FRAMES - 1, i));
  return ((i % ANIM_FRAMES) + ANIM_FRAMES) % ANIM_FRAMES;
}

// True once a non-looping animation has played all its frames.
function animDone(startMs, now, anim) {
  return (now - startMs) >= ANIM_FRAMES * ANIM_FRAME_MS[anim];
}

// Draw one animation cell so the character's feet-center anchor lands at
// (centerX, baseY) in canvas pixels. Flips horizontally when facing left.
function drawAnim(cell, anim, frameIndex, centerX, baseY, faceLeft) {
  const sheet = sprites[cell.sheet];
  if (!sheet) return false;
  const sx = frameIndex * cell.w;
  const sy = ANIM_ROW[anim] * cell.h;
  const dw = cell.w * cell.scale;
  const dh = cell.h * cell.scale;
  const dx = centerX - cell.ax * cell.scale;
  const dy = baseY - cell.ay * cell.scale;
  if (faceLeft) {
    ctx.save();
    ctx.translate(centerX, 0);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, 0);
    ctx.drawImage(sheet, sx, sy, cell.w, cell.h, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(sheet, sx, sy, cell.w, cell.h, dx, dy, dw, dh);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Input: one keypress = one move. event.repeat filters out OS auto-repeat.
// Input is also locked while a move tween is in progress.
// ---------------------------------------------------------------------------

const MOVE_KEYS = { KeyW: "up", KeyA: "left", KeyS: "down", KeyD: "right" };
const SHOOT_KEYS = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right" };

// Arrow keys currently held. While any are held the bow keeps firing at its
// natural rate (one arrow in flight at a time). Holding two perpendicular keys
// fires diagonally.
const heldShootKeys = new Set();

// Timestamp until which the player shows the attack animation (set on each shot).
let playerAttackUntil = 0;
// Timestamp until which the player shows the hurt flinch (set on a non-fatal hit).
let playerHurtUntil = 0;
// Timestamp of the last shot, for the fire cooldown. Far in the past = ready.
let lastArrowFiredAt = -ARROW_COOLDOWN_MS;
// A shot that has been triggered but whose arrow hasn't left the bow yet.
let pendingShot = null;

// Movement keys currently held. Movement is tile-by-tile: while any WASD key is
// held, the player keeps stepping to the next tile at the same per-tile speed.
// A step in progress is never interrupted, so releasing always lands the player
// on a tile (the one it was entering).
const heldMoveKeys = new Set();

function onKeyDown(event) {
  // Ignore key events when the user is typing into a text input (e.g. the
  // name entry on the game-over overlay).
  const t = event.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  // We track held state ourselves, so OS auto-repeat is redundant.
  if (event.repeat) {
    event.preventDefault();
    return;
  }

  // While choosing an upgrade card, the game is frozen and only the cards
  // (clicked with the mouse) respond.
  if (state.choosingBuff) { event.preventDefault(); return; }

  // Escape toggles pause during a run.
  if (event.code === "Escape") {
    if (state.running) {
      togglePause();
      event.preventDefault();
    }
    return;
  }

  // While stopped (game over / pre-start) or paused, only the controls above run.
  if (!state.running || state.paused) return;

  if (MOVE_KEYS[event.code]) {
    heldMoveKeys.add(MOVE_KEYS[event.code]);
    tryStartMove();                 // begin stepping now if not already mid-step
    event.preventDefault();
  } else if (SHOOT_KEYS[event.code]) {
    onShootKeyDown(SHOOT_KEYS[event.code]);
    event.preventDefault();
  }
}

function onKeyUp(event) {
  if (MOVE_KEYS[event.code]) heldMoveKeys.delete(MOVE_KEYS[event.code]);
  if (SHOOT_KEYS[event.code]) heldShootKeys.delete(SHOOT_KEYS[event.code]);
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

let pausedAt = 0;

// Shift every time reference forward by `delta` so a pause (manual or for a buff
// pick) doesn't make timers jump on resume: run clock, spawns, tweens,
// animations, fire cooldown, damage flash, and per-enemy/projectile timers.
function shiftTimers(delta) {
  const p = state.player;
  state.startedAt += delta;
  state.lastSpawnAt += delta;
  p.moveStartAt += delta;
  p.animStart += delta;
  p.deathStart += delta;
  playerAttackUntil += delta;
  playerHurtUntil += delta;
  damageFlashUntil += delta;
  lastArrowFiredAt += delta;
  if (pendingShot) pendingShot.releaseAt += delta;
  for (const e of state.enemies) {
    e.moveStartAt += delta;
    e.animStart += delta;
    e.deathStart += delta;
    e.attackStart += delta;
    e.hurtUntil += delta;
  }
  for (const pr of state.projectiles) pr.lastStepAt += delta;
}

function togglePause() {
  if (state.paused) {
    // Resume: shift forward by the paused duration so nothing jumps.
    shiftTimers(performance.now() - pausedAt);
    state.paused = false;
    resumeMusic();
    requestAnimationFrame(loop);
  } else {
    state.paused = true;
    pausedAt = performance.now();
    pauseMusic();
    renderPauseScreen();
  }
}

function renderPauseScreen() {
  render(pausedAt);                                  // freeze the current frame
  ctx.fillStyle = "rgba(12, 13, 16, 0.6)";           // gray out
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "bold 78px ui-monospace, Menlo, monospace";
  ctx.fillText("PAUSE", canvas.width / 2, canvas.height / 2 - 24);
  ctx.fillStyle = "#7d8088";
  ctx.font = "33px ui-monospace, Menlo, monospace";
  ctx.fillText("Press esc to continue", canvas.width / 2, canvas.height / 2 + 45);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Upgrade cards: every BUFF_EVERY_KILLS kills, pause and offer 3 random buffs.
// ---------------------------------------------------------------------------
const BUFF_EVERY_KILLS = 15;
const buffOverlay = document.getElementById("buff-overlay");
const buffCardsEl = document.getElementById("buff-cards");
let buffPausedAt = 0;

// Each card: a title, a short description, the current stat and the buffed stat
// (shown as current -> next), an availability test, and the effect to apply.
const BUFF_CARDS = [
  {
    title: "+1 Life", desc: "Add a heart",
    available: () => true,
    current: () => `${state.maxLives} hearts`,
    next: () => `${state.maxLives + 1} hearts`,
    apply: () => { state.maxLives += 1; state.lives += 1; },
  },
  {
    title: "Heal to Full", desc: "Restore all hearts",
    available: () => state.lives < state.maxLives,
    current: () => `${state.lives}/${state.maxLives}`,
    next: () => `${state.maxLives}/${state.maxLives}`,
    apply: () => { state.lives = state.maxLives; },
  },
  {
    title: "+15% Speed", desc: "Move faster",
    available: () => true,
    current: () => `${Math.round(playerSpeedMult * 100)}%`,
    next: () => `${Math.round(playerSpeedMult * 1.15 * 100)}%`,
    apply: () => { playerSpeedMult *= 1.15; },
  },
  {
    title: "+50% Fire Rate", desc: "Shoot more often",
    available: () => true,
    current: () => `${Math.round(fireRateMult * 100)}%`,
    next: () => `${Math.round(fireRateMult * 1.5 * 100)}%`,
    apply: () => { fireRateMult *= 1.5; },
  },
  {
    title: "+100% Damage", desc: "Arrows hit harder",
    available: () => true,
    current: () => `${playerDamage} dmg`,
    next: () => `${playerDamage + BASE_DAMAGE} dmg`,
    apply: () => { playerDamage += BASE_DAMAGE; },
  },
  {
    title: "Multi-Shot", desc: "Fire a 3-arrow fan",
    available: () => !playerMultiShot,        // one-time: removed once taken
    current: () => "1 arrow",
    next: () => "3 arrows",
    apply: () => { playerMultiShot = true; },
  },
];

// Pick up to n distinct available cards (shuffled).
function pickBuffCards(n) {
  const pool = BUFF_CARDS.filter((c) => c.available());
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

function startBuffSelection(now) {
  buffsAwarded += 1;
  state.choosingBuff = true;
  buffPausedAt = now;
  heldMoveKeys.clear();   // drop held input so the player doesn't auto-move on resume
  heldShootKeys.clear();
  // Music keeps playing through the upgrade menu (no pauseMusic here).
  buffCardsEl.innerHTML = "";
  for (const card of pickBuffCards(3)) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "buff-card";
    el.innerHTML =
      `<span class="buff-title">${card.title}</span>` +
      `<span class="buff-desc">${card.desc}</span>` +
      `<span class="buff-stat">` +
        `<span class="buff-now">${card.current()}</span>` +
        `<span class="buff-arrow">→</span>` +
        `<span class="buff-after">${card.next()}</span>` +
      `</span>`;
    el.addEventListener("click", () => chooseBuff(card));
    buffCardsEl.appendChild(el);
  }
  buffOverlay.classList.remove("hidden");
}

function chooseBuff(card) {
  if (!state.choosingBuff) return; // guard against double-clicks
  card.apply();
  buffOverlay.classList.add("hidden");
  state.choosingBuff = false;
  shiftTimers(performance.now() - buffPausedAt); // un-freeze: nothing jumps
  renderHearts();
  requestAnimationFrame(loop);
}

// Start the next tile step from whatever WASD keys are held. Never interrupts a
// step already in progress, which keeps the player grid-aligned and the per-tile
// speed unchanged. Two perpendicular keys held together produce a diagonal step.
function tryStartMove() {
  if (state.player.moving) return;
  const dx = (heldMoveKeys.has("right") ? 1 : 0) - (heldMoveKeys.has("left") ? 1 : 0);
  const dy = (heldMoveKeys.has("down")  ? 1 : 0) - (heldMoveKeys.has("up")   ? 1 : 0);
  if (dx === 0 && dy === 0) return;
  // Try the full (possibly diagonal) step. If a diagonal is blocked, slide along
  // whichever single axis is open so the player runs along walls instead of
  // sticking. A fully blocked step just does nothing this frame.
  if (queueMove(dx, dy)) return;
  if (dx !== 0 && dy !== 0) {
    if (queueMove(dx, 0)) return;
    queueMove(0, dy);
  }
}


function onShootKeyDown(direction) {
  heldShootKeys.add(direction);
  fireFromHeldKeys(); // fire immediately so a quick tap always registers
}

// Fire an arrow in the held direction. fireArrow's one-arrow-at-a-time gate
// keeps the cadence at the natural rate, so calling this every frame (loop) plus
// on keydown gives continuous fire while a key is held without speeding it up.
function fireFromHeldKeys() {
  const direction = resolveShootDirection(heldShootKeys);
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

// Returns true if a step was started, false if the target tile is blocked.
function queueMove(dx, dy) {
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return false;
  if (isSolid(state.tileMap[ny][nx])) return false;
  if (isFortAt(nx, ny)) return false;
  // Can't walk onto or through a living enemy.
  if (isEnemyAt(nx, ny)) return false;
  // Block diagonal squeezes through corners: if both cardinal neighbors are
  // solid (terrain or fort), don't allow the diagonal step.
  if (dx !== 0 && dy !== 0) {
    const sideA = state.tileMap[p.y][nx];
    const sideB = state.tileMap[ny][p.x];
    const sideABlocked = isSolid(sideA) || isFortAt(nx, p.y);
    const sideBBlocked = isSolid(sideB) || isFortAt(p.x, ny);
    if (sideABlocked && sideBBlocked) return false;
  }

  // Facing tracks horizontal direction only. A vertical-only move keeps the
  // current left/right facing so the sprite stays flipped until the player
  // actually turns the other way.
  if (dx > 0) p.facing = "right";
  else if (dx < 0) p.facing = "left";

  // Per-tile duration: path is faster, grass is slower, diagonal multiplies
  // the base by sqrt(2) so per-axis speed stays constant.
  const destTile = state.tileMap[ny][nx];
  let mult = 1.0;
  if (destTile === TILES.PATH) mult = PATH_SPEED_MULT;
  else if (destTile === TILES.GRASS) mult = GRASS_SPEED_MULT;
  let duration = PLAYER_MOVE_DURATION_MS / mult / playerSpeedMult;
  if (dx !== 0 && dy !== 0) duration *= DIAG_DURATION_FACTOR;

  p.moving = true;
  p.moveStartAt = performance.now();
  p.moveDuration = duration;
  p.fromX = p.x;
  p.fromY = p.y;
  p.toX = nx;
  p.toY = ny;
  return true;
}

function stepPlayerMove(now) {
  const p = state.player;
  if (p.moving) {
    const elapsed = now - p.moveStartAt;
    const dur = p.moveDuration || PLAYER_MOVE_DURATION_MS;
    if (elapsed >= dur) {
      p.x = p.toX;
      p.y = p.toY;
      p.moving = false;
    }
  }
  // While idle, keep trying to step from held keys. This continues movement
  // tile-to-tile and, when blocked by a wall, retries every frame so the player
  // resumes the instant a direction opens up instead of sticking.
  if (!p.moving) tryStartMove();
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

// Trigger a shot: start the attack animation and queue the arrow to leave the
// bow partway through the swing (the draw plays first, then the release). The
// arrow itself spawns later in releasePendingShot. Fire rate: one shot per
// (ARROW_COOLDOWN_MS / fireRateMult), so Fire Rate cards shorten the gap.
function fireArrow(direction) {
  const now = performance.now();
  if (now - lastArrowFiredAt < ARROW_COOLDOWN_MS / fireRateMult) return;
  if (pendingShot) return; // a draw is already queued
  lastArrowFiredAt = now;
  // The whole draw/release scales with fire rate so it always finishes before
  // the next (cooldown-gated) shot, so no firing cap, the animation just gets
  // faster. ATTACK animation playback is sped up to match in renderPlayer.
  playerAttackUntil = now + ATTACK_HOLD_MS / fireRateMult;
  pendingShot = { direction, releaseAt: now + ARROW_RELEASE_MS / fireRateMult };
  // Face the shot horizontally so the player turns to aim.
  if (direction.includes("right")) state.player.facing = "right";
  else if (direction.includes("left")) state.player.facing = "left";
}

// Spawn the queued arrow once the bow reaches its release point in the swing.
function releasePendingShot(now) {
  if (!pendingShot || now < pendingShot.releaseAt) return;
  const { direction } = pendingShot;
  pendingShot = null;
  // Spawn from the player's authoritative grid tile (destination of any in-flight move).
  const sx = state.player.moving ? state.player.toX : state.player.x;
  const sy = state.player.moving ? state.player.toY : state.player.y;
  // Multi-shot fires the aimed direction plus the two 45-degree neighbors.
  const dirs = playerMultiShot ? fanDirections(direction) : [direction];
  for (const d of dirs) {
    state.projectiles.push({ x: sx, y: sy, direction: d, lastStepAt: 0, tilesTraveled: 0 });
  }
  playSfx("bow", 10); // arrow leaves the bow now; boosted so it's well audible
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
      // Forts are impassable to enemies, except the cell they start on (the
      // start node is never reached as a neighbor).
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
  if (state.enemies.length >= MAX_ENEMIES) return;
  // Weighted pick across unlocked types. Newly-unlocked enemies (two at 45s,
  // three at 90s) start with a tiny weight and ramp up, so they trickle in
  // before becoming common.
  const elapsed = now - state.startedAt;
  const keys = Object.keys(ENEMY_TYPES);
  const weights = keys.map((k) => spawnWeight(k, elapsed));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  let typeKey = "enemy_one";
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r <= 0) { typeKey = keys[i]; break; }
  }
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  state.enemies.push({
    x: spawn.x,
    y: spawn.y,
    moving: false,
    moveStartAt: 0,
    moveDuration: 0,          // set per-step (terrain-based) when a move starts
    fromX: spawn.x,
    fromY: spawn.y,
    toX: spawn.x,
    toY: spawn.y,
    facing: "left",
    type: typeKey,
    anim: "WALK",
    animStart: now,
    dying: false,
    deathStart: 0,
    attacking: false,
    attackStart: 0,
    hp: ENEMY_TYPES[typeKey].hp,  // arrows needed to kill
    hurtUntil: 0,                 // plays the hurt flinch on a non-fatal hit
  });
  state.lastSpawnAt = now;
}

// Enemy is within one tile (incl. diagonal) of the player's tile.
function enemyInAttackRange(enemy, px, py) {
  return Math.abs(enemy.x - px) <= 1 && Math.abs(enemy.y - py) <= 1;
}

function stepEnemies(now) {
  // Remove enemies whose death animation has finished playing.
  state.enemies = state.enemies.filter((e) => !(e.dying && animDone(e.deathStart, now, "DIE")));
  if (state.player.dying) return; // freeze enemies once the player is dying
  const goalX = state.player.moving ? state.player.toX : state.player.x;
  const goalY = state.player.moving ? state.player.toY : state.player.y;
  for (const enemy of state.enemies) {
    if (enemy.dying) continue; // dying enemies hold still and just animate out
    const type = ENEMY_TYPES[enemy.type];

    // Frozen mid-flinch after a non-fatal hit: hold still until the hurt ends.
    if (now < enemy.hurtUntil) { enemy.moving = false; continue; }

    // Winding up an attack: when the swing finishes, deal damage if the player
    // is still in range (so the player can dodge out during the windup).
    if (enemy.attacking) {
      if (now - enemy.attackStart >= type.attackWindupMs) {
        enemy.attacking = false;
        if (enemyInAttackRange(enemy, goalX, goalY)) damagePlayer(now, type.damage);
      }
      continue;
    }

    // Finish any in-flight tween. If still mid-tween, wait; if it just finished,
    // fall straight through to start the next step this frame so there's no
    // one-frame idle gap (which would restart the walk cycle and look jumpy).
    if (enemy.moving) {
      if (now - enemy.moveStartAt < enemy.moveDuration) continue;
      enemy.x = enemy.toX;
      enemy.y = enemy.toY;
      enemy.moving = false;
    }

    // Snapped: if in range of the player, start an attack windup;
    // otherwise path one tile toward the player.
    if (enemyInAttackRange(enemy, goalX, goalY)) {
      enemy.attacking = true;
      enemy.attackStart = now;
      if (goalX > enemy.x) enemy.facing = "right";
      else if (goalX < enemy.x) enemy.facing = "left";
      continue;
    }
    const next = aStarNextStep(enemy.x, enemy.y, goalX, goalY, state.tileMap);
    if (next === null) continue;
    enemy.fromX = enemy.x;
    enemy.fromY = enemy.y;
    enemy.toX = next.x;
    enemy.toY = next.y;
    if (next.x > enemy.x) enemy.facing = "right";
    else if (next.x < enemy.x) enemy.facing = "left";
    // Vertical-only steps keep the previous facing.
    // Duration depends on the destination tile, just like the player, so this
    // enemy moves at speedScale of the player's speed on the same terrain.
    enemy.moveDuration = enemyStepDuration(enemy.type, state.tileMap[next.y][next.x]);
    enemy.moveStartAt = now;
    enemy.moving = true;
  }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

// True if a living (non-dying) enemy occupies (x, y), counting the tile it is
// tweening into so the player can't slip onto a moving enemy either.
function isEnemyAt(x, y) {
  for (const e of state.enemies) {
    if (e.dying) continue;
    if (e.x === x && e.y === y) return true;
    if (e.moving && e.toX === x && e.toY === y) return true;
  }
  return false;
}

function resolveCollisions() {
  const now = performance.now();
  // Arrows hit a living enemy on its snapped tile. Each hit removes one HP; the
  // enemy plays a hurt flinch until its HP runs out, then dies and is removed
  // once the death animation finishes. The kill counts on the fatal hit.
  const hitProjectileIds = new Set();
  for (const enemy of state.enemies) {
    if (enemy.dying) continue;
    const hitIndex = state.projectiles.findIndex(
      (p, i) => !hitProjectileIds.has(i) && p.x === enemy.x && p.y === enemy.y,
    );
    if (hitIndex !== -1) {
      hitProjectileIds.add(hitIndex);
      enemy.hp -= playerDamage;
      if (enemy.hp <= 0) {
        enemy.dying = true;
        enemy.deathStart = now;
        enemy.moving = false; // freeze where it fell
        state.kills++;
        state.spawnIntervalMs = Math.max(
          MIN_SPAWN_INTERVAL_MS,
          state.spawnIntervalMs - SPAWN_ACCEL_PER_KILL_MS,
        );
      } else {
        // Survived: play the flinch and freeze in place for its duration.
        enemy.hurtUntil = now + HURT_HOLD_MS;
        enemy.moving = false;
        enemy.attacking = false;
      }
    }
  }
  if (hitProjectileIds.size > 0) {
    state.projectiles = state.projectiles.filter((p, i) => !hitProjectileIds.has(i));
  }
  // Player damage is dealt by enemy attack windups (see stepEnemies), not by
  // simple contact, so there's no instant-kill collision here.
}

// Lose a heart. A non-fatal hit plays the hurt flinch; the last heart starts death.
function damagePlayer(now, dmg) {
  const p = state.player;
  if (p.dying) return;
  state.lives = Math.max(0, state.lives - dmg);
  playSfx("hurt");                        // lost a heart
  damageFlashUntil = now + DAMAGE_FLASH_MS; // flash the screen edges red
  if (state.lives <= 0) {
    startPlayerDeath(now);
  } else {
    playerHurtUntil = now + HURT_HOLD_MS;
  }
}

// Begin the player's death: freeze input/movement, play the DIE animation, and
// capture the final time. The loop shows it fully before the retry screen.
function startPlayerDeath(now) {
  const p = state.player;
  p.dying = true;
  p.deathStart = now;
  p.moving = false;
  p.anim = "DIE";
  p.animStart = now;
  pendingShot = null;
  playerHurtUntil = 0;
  heldMoveKeys.clear();
  heldShootKeys.clear();
  lastRunDurationSeconds = Math.floor((now - state.startedAt) / 1000);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Draw `img` into the tile at (dx,dy), rotated clockwise by rotDeg (0/90/180/270).
function drawTileRot(img, dx, dy, rotDeg) {
  if (!img) return;
  const half = TILE_SIZE / 2;
  ctx.save();
  ctx.translate(dx + half, dy + half);
  ctx.rotate(rotDeg * Math.PI / 180);
  ctx.drawImage(img, -half, -half, TILE_SIZE, TILE_SIZE);
  ctx.restore();
}

// Border mountain tiles use the side/corner sprites, rotated so the dark
// (shadowed) edge always faces into the map. The side art has its dark edge on
// the right; the corner art is the top-left orientation (dark inner edges facing
// down-right, transparent inner quadrant).
function drawMountainBorder(x, y) {
  const left = x === 0, right = x === MAP_COLS - 1;
  const top = y === 0, bottom = y === MAP_ROWS - 1;
  if ((left || right) && (top || bottom)) {
    const rot = top && left ? 0 : top && right ? 90 : bottom && right ? 180 : 270;
    drawTileRot(sprites.mountainCorner, x * TILE_SIZE, y * TILE_SIZE, rot);
  } else {
    const rot = left ? 0 : top ? 90 : right ? 180 : 270;
    drawTileRot(sprites.mountainSide, x * TILE_SIZE, y * TILE_SIZE, rot);
  }
}

function renderTiles() {
  // Tiles are pixel art: keep crisp nearest-neighbor scaling.
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const tileId = state.tileMap[y][x];
      if (!sprites.grass) {
        ctx.fillStyle = fallbackColor(tileId);
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        continue;
      }
      // Grass underlay everywhere, then the feature tile on top.
      drawSprite(SRC.GRASS, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (tileId === TILES.GRASS) continue;
      if (tileId === TILES.MOUNTAIN) { drawMountainBorder(x, y); continue; }
      drawSprite(tileSrc(tileId), x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

// The spawn-fort castle (spawn_castle.png) is drawn taller than the tile and
// anchored to the tile's bottom edge, so it rises up and its top sits slightly
// above the 48x48 fort tile.
const SPAWN_CASTLE_W = TILE_SIZE;  // native width, drawn 1:1
const SPAWN_CASTLE_H = 54;         // taller than the tile; the top overhangs upward

function renderSpawnMarkers() {
  const castle = sprites.spawnCastle;
  if (castle) {
    // Width stays 1:1; the extra height stretches the sprite upward. Smoothing
    // off keeps the edges hard.
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const left0 = (TILE_SIZE - SPAWN_CASTLE_W) / 2;
    for (const p of SPAWN_POINTS) {
      const left = p.x * TILE_SIZE + left0;
      const bottom = (p.y + 1) * TILE_SIZE;   // castle base sits on the fort tile
      ctx.drawImage(castle, 0, 0, castle.width, castle.height,
                    left, bottom - SPAWN_CASTLE_H, SPAWN_CASTLE_W, SPAWN_CASTLE_H);
    }
    ctx.imageSmoothingEnabled = prevSmooth;
  } else {
    ctx.fillStyle = "rgba(245, 185, 66, 0.18)";
    for (const p of SPAWN_POINTS) {
      ctx.fillRect(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

// Arrow sprite (pointing right) drawn at this on-screen length, aspect kept.
// Scaled down to stay proportional with the shrunken character.
const ARROW_LEN = 36;
const ARROW_THICK = ARROW_LEN * (55 / 415);

function renderProjectiles() {
  // Arrows draw above the player and enemies. Smooth scaling for the vector arrow.
  ctx.imageSmoothingEnabled = true;
  const arrowSheet = sprites.arrow;
  // Skip an arrow sitting on the player's own tile (its spawn frame) so it does
  // not flash a stub on the archer before it steps away.
  const ptx = state.player.moving ? state.player.toX : state.player.x;
  const pty = state.player.moving ? state.player.toY : state.player.y;
  for (const p of state.projectiles) {
    if (p.x === ptx && p.y === pty) continue;
    const cx = p.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = p.y * TILE_SIZE + TILE_SIZE / 2;
    const angle = DIR_ROTATION[p.direction] ?? 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    if (arrowSheet) {
      ctx.drawImage(arrowSheet, -ARROW_LEN / 2, -ARROW_THICK / 2, ARROW_LEN, ARROW_THICK);
    } else {
      // Fallback: a simple gold arrow if the sprite failed to load.
      ctx.strokeStyle = "#caa64a";
      ctx.fillStyle = "#caa64a";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(6, -4); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

function renderEnemies(now) {
  // High-res character sheets scaled down, so smooth the downscale. (Projectiles
  // enable this too, but they now draw after the characters.)
  ctx.imageSmoothingEnabled = true;
  for (const enemy of state.enemies) {
    const type = ENEMY_TYPES[enemy.type];
    let px, py;
    if (enemy.moving) {
      const t = Math.max(0, Math.min(1, (now - enemy.moveStartAt) / enemy.moveDuration));
      px = lerp(enemy.fromX, enemy.toX, t) * TILE_SIZE;
      py = lerp(enemy.fromY, enemy.toY, t) * TILE_SIZE;
    } else {
      px = enemy.x * TILE_SIZE;
      py = enemy.y * TILE_SIZE;
    }
    const centerX = px + TILE_SIZE / 2;
    const baseY = py + TILE_SIZE;

    // die > hurt flinch > attack windup > run/walk (by terrain) > idle.
    let desired, frameIndex;
    if (enemy.dying) {
      desired = "DIE";
      enemy.anim = desired;
      frameIndex = animFrameIndex(enemy.deathStart, now, "DIE", true);
    } else if (now < enemy.hurtUntil) {
      desired = "HURT";
      enemy.anim = desired;
      frameIndex = animFrameIndex(enemy.hurtUntil - HURT_HOLD_MS, now, "HURT", true);
    } else if (enemy.attacking) {
      desired = "ATTACK";
      enemy.anim = desired;
      // Stretch the swing across the windup so it lands on the final frame.
      const stepMs = type.attackWindupMs / ANIM_FRAMES;
      frameIndex = Math.min(ANIM_FRAMES - 1, Math.floor((now - enemy.attackStart) / stepMs));
    } else {
      if (enemy.moving) {
        const destTile = state.tileMap[enemy.toY][enemy.toX];
        desired = destTile === TILES.PATH ? "RUN" : "WALK";
      } else {
        desired = "IDLE";
      }
      if (enemy.anim !== desired) { enemy.anim = desired; enemy.animStart = now; }
      frameIndex = animFrameIndex(enemy.animStart, now, enemy.anim, false);
    }

    // Knight sheet faces right; flip when facing left.
    if (!drawAnim(type.cell, enemy.anim, frameIndex, centerX, baseY, enemy.facing === "left")) {
      ctx.fillStyle = "#c93737";
      ctx.beginPath();
      ctx.arc(centerX, baseY - TILE_SIZE * 0.4, TILE_SIZE * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function renderPlayer(now) {
  const p = state.player;
  // Interpolated pixel position of the tile the player occupies.
  let px, py;
  if (p.moving) {
    const dur = p.moveDuration || PLAYER_MOVE_DURATION_MS;
    const t = Math.max(0, Math.min(1, (now - p.moveStartAt) / dur));
    px = lerp(p.fromX, p.toX, t) * TILE_SIZE;
    py = lerp(p.fromY, p.toY, t) * TILE_SIZE;
  } else {
    px = p.x * TILE_SIZE;
    py = p.y * TILE_SIZE;
  }
  const centerX = px + TILE_SIZE / 2;
  const baseY = py + TILE_SIZE;

  // Choose the animation: die > hurt > attack (while shooting) > run/walk > idle.
  let desired;
  if (p.dying) {
    desired = "DIE";
  } else if (now < playerHurtUntil) {
    desired = "HURT";
  } else if (now < playerAttackUntil) {
    desired = "ATTACK";
  } else if (p.moving) {
    const destTile = state.tileMap[p.toY][p.toX];
    desired = destTile === TILES.PATH ? "RUN" : "WALK";
  } else {
    desired = "IDLE";
  }
  if (p.anim !== desired) { p.anim = desired; p.animStart = now; }

  // DIE and HURT play once (clamp on the last frame); the rest loop. The ATTACK
  // swing is sped up by the fire-rate multiplier so it keeps pace with rapid fire.
  const once = p.anim === "DIE" || p.anim === "HURT";
  const atkSpeed = p.anim === "ATTACK" ? fireRateMult : 1;
  const frameIndex = animFrameIndex(p.animStart, now, p.anim, once, atkSpeed);

  if (!drawAnim(playerCell(), p.anim, frameIndex, centerX, baseY, p.facing === "left")) {
    // Fallback if the sheet failed to load.
    ctx.fillStyle = "#7ed957";
    ctx.fillRect(centerX - 12, baseY - 28, 24, 28);
  }
}

function render(now) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderTiles();
  renderSpawnMarkers();
  renderEnemies(now);
  renderPlayer(now);
  renderProjectiles(); // above the characters, so a vertical shot's arrow never shows through the archer
  renderDamageVignette(now);
}

// Red vignette that flashes the screen edges on taking damage and fades toward
// the center. Strongest right after the hit, then eases out over the flash window.
function renderDamageVignette(now) {
  const remaining = damageFlashUntil - now;
  if (remaining <= 0) return;
  const t = remaining / DAMAGE_FLASH_MS; // 1 -> 0 across the flash
  const alpha = Math.min(1, t) * 0.6;    // peak opacity at the edges
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // Transparent in the middle, red at the corners, fading inward.
  const inner = Math.min(cx, cy) * 0.45;
  const outer = Math.hypot(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, "rgba(200, 0, 0, 0)");
  grad.addColorStop(1, `rgba(200, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

let renderedLives = "";

function renderHearts() {
  const key = `${state.lives}/${state.maxLives}`;
  if (key === renderedLives) return; // only rebuild when it changes
  renderedLives = key;
  let html = "";
  // Filled hearts on the left, outlined on the right (deplete right-to-left).
  for (let i = 0; i < state.maxLives; i++) {
    const full = i < state.lives;
    html += `<span class="heart ${full ? "full" : "empty"}">${full ? "♥" : "♡"}</span>`;
  }
  heartsEl.innerHTML = html;
}

function updateHud(now) {
  killEl.textContent = String(state.kills);
  const elapsed = state.running ? Math.floor((now - state.startedAt) / 1000) : 0;
  timeEl.textContent = `${elapsed}s`;
  renderHearts();
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function loop(now) {
  if (!state.running || state.paused || state.choosingBuff) return;
  try {
    if (state.player.dying) {
      // Gameplay is frozen; only the death animation advances. When it finishes,
      // go to the retry screen.
      render(now);
      if (animDone(state.player.deathStart, now, "DIE")) { gameOver(); return; }
    } else {
      stepPlayerMove(now);
      maybeSpawnEnemy(now);
      stepProjectiles(now);
      fireFromHeldKeys();      // trigger a shot if an arrow key is held and ready
      releasePendingShot(now); // launch the arrow once the swing reaches release
      stepEnemies(now);
      resolveCollisions();
      render(now);
      updateHud(now);
      // Every 15 kills, pause for an upgrade card pick (then the loop halts on
      // the choosingBuff guard until a card is chosen).
      if (state.kills >= (buffsAwarded + 1) * BUFF_EVERY_KILLS) startBuffSelection(now);
    }
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
  state.paused = false;
  playGameMusic();
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
  state.maxLives = BASE_MAX_LIVES;
  state.lives = BASE_MAX_LIVES;
  state.choosingBuff = false;
  state.player = {
    x: PLAYER_START_X, y: PLAYER_START_Y, facing: "right",
    moving: false, moveStartAt: 0, moveDuration: 0,
    fromX: PLAYER_START_X, fromY: PLAYER_START_Y, toX: PLAYER_START_X, toY: PLAYER_START_Y,
    anim: "IDLE", animStart: 0, dying: false, deathStart: 0,
  };
  playerAttackUntil = 0;
  playerHurtUntil = 0;
  damageFlashUntil = 0;
  lastArrowFiredAt = -ARROW_COOLDOWN_MS;
  pendingShot = null;
  // Reset run buffs.
  playerDamage = BASE_DAMAGE;
  playerSpeedMult = 1.0;
  fireRateMult = 1.0;
  playerMultiShot = false;
  buffsAwarded = 0;
  state.enemies = [];
  state.projectiles = [];
  state.spawnIntervalMs = INITIAL_SPAWN_INTERVAL_MS;
  state.tileMap = buildStartingMap();
}

function gameOver() {
  state.running = false;
  playMenuMusic();
  // Duration was captured at the moment of death; only recompute as a fallback.
  if (!state.player.dying) {
    lastRunDurationSeconds = Math.floor((performance.now() - state.startedAt) / 1000);
  }
  overlayTitle.textContent = `Enemies killed: ${state.kills}`;
  overlayText.textContent = "Move with WASD. Shoot with the arrow keys.";
  scoreForm.classList.remove("hidden");
  scoreAlreadySubmitted = false;
  submitScoreButton.disabled = false;
  submitScoreButton.textContent = "Submit score";
  overlay.classList.remove("hidden");
  refreshLeaderboard();
  startCharPreviewLoop(); // let them re-pick an archer before the next run
}

// ---------------------------------------------------------------------------
// Character select: one card per archer skin on the menu (cosmetic only).
// ---------------------------------------------------------------------------
// Each archer is shown as its own card; click one to select it.
const charCards = Array.from(document.querySelectorAll(".char-card")).map((cv) => ({
  canvas: cv,
  ctx: cv.getContext("2d"),
  index: Number(cv.dataset.archer),
}));
let charPreviewRAF = 0;

try {
  const saved = parseInt(localStorage.getItem("ranger-survivor.archer"), 10);
  if (!Number.isNaN(saved) && saved >= 0 && saved < ARCHER_SHEETS.length) selectedArcher = saved;
} catch (_) { /* localStorage may be disabled */ }

// Pixel bounds of an archer's idle frame within its cell, so the preview can
// center on the actual sprite (not the padded cell) and scale to fill the box.
// Cached per sheet (idle frame 0 is representative).
const _archerBoxCache = {};
function archerContentBox(sheetName) {
  if (_archerBoxCache[sheetName]) return _archerBoxCache[sheetName];
  const img = sprites[sheetName];
  if (!img) return null;
  const cell = ARCHER_CELL;
  const off = document.createElement("canvas");
  off.width = cell.w; off.height = cell.h;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, ANIM_ROW.IDLE * cell.h, cell.w, cell.h, 0, 0, cell.w, cell.h);
  const data = octx.getImageData(0, 0, cell.w, cell.h).data;
  let minX = cell.w, minY = cell.h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < cell.h; y++) {
    for (let x = 0; x < cell.w; x++) {
      if (data[(y * cell.w + x) * 4 + 3] > 16) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const box = found
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : { x: 0, y: 0, w: cell.w, h: cell.h };
  _archerBoxCache[sheetName] = box;
  return box;
}

// Draw one archer's idle frame into a card, centered on its real pixels.
function drawCharCard(card, now) {
  const { canvas, ctx: cctx, index } = card;
  cctx.clearRect(0, 0, canvas.width, canvas.height);
  const sheetName = ARCHER_SHEETS[index];
  const img = sprites[sheetName];
  if (!img) return;
  const cell = ARCHER_CELL;
  const box = archerContentBox(sheetName) || { x: 0, y: 0, w: cell.w, h: cell.h };
  const frame = animFrameIndex(0, now, "IDLE", false);
  const pad = 12;
  const scale = Math.min((canvas.width - pad) / box.w, (canvas.height - pad) / box.h);
  const dx = canvas.width / 2 - (box.x + box.w / 2) * scale;
  const dy = canvas.height / 2 - (box.y + box.h / 2) * scale;
  cctx.imageSmoothingEnabled = true;
  cctx.drawImage(
    img, frame * cell.w, ANIM_ROW.IDLE * cell.h, cell.w, cell.h,
    dx, dy, cell.w * scale, cell.h * scale,
  );
}

function drawCharPreview(now) {
  for (const card of charCards) {
    drawCharCard(card, now);
    card.canvas.classList.toggle("selected", card.index === selectedArcher);
  }
}

function startCharPreviewLoop() {
  cancelAnimationFrame(charPreviewRAF);
  const tick = (now) => {
    if (state.running) return; // preview only animates on the menu, not in-game
    drawCharPreview(now);
    charPreviewRAF = requestAnimationFrame(tick);
  };
  charPreviewRAF = requestAnimationFrame(tick);
}

for (const card of charCards) {
  card.canvas.addEventListener("click", () => {
    selectedArcher = card.index;
    try { localStorage.setItem("ranger-survivor.archer", String(selectedArcher)); } catch (_) { /* ignore */ }
  });
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

// Auto-pause whenever the game leaves the foreground: switching tabs, minimizing,
// or focusing another window or app. A hidden tab suspends requestAnimationFrame,
// so the loop stops and the world freezes, but the run clock and spawn timers are
// derived from wall time and would otherwise jump ahead on return. Routing through
// togglePause freezes the clock and shifts every timer forward on resume, so
// nothing skips. The player resumes with Esc, same as a manual pause.
//
// visibilitychange covers tab switches and minimizing; window blur additionally
// covers switching to another window or app while this tab stays visible. The
// guard makes a second event a no-op if it already paused.
function autoPauseOnLeave() {
  if (state.running && !state.paused && !state.choosingBuff) togglePause();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) autoPauseOnLeave();
});
window.addEventListener("blur", autoPauseOnLeave);

refreshLeaderboard();
renderHearts();

loadSprites().then(() => {
  render(performance.now());
  startCharPreviewLoop();
});

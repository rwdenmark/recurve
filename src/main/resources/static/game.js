// Ranger Survivor, a top-down tile-based survival shooter.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import {
  MAP_COLS, MAP_ROWS, PLAYER_START_X, PLAYER_START_Y,
  TILES, isSolid, isFortAt, SPAWN_POINTS, buildStartingMap,
} from "./mapgen.js";
import { buildFlowField, nextStepFromField } from "./pathfinding.js";
import {
  musicMode, playMenuMusic, playGameMusic, pauseMusic, resumeMusic,
  playSfx, ensureAudioCtx, loadSfx,
} from "./audio.js";
import { renderHearts, updateHud } from "./hud.js";
import {
  DEFAULT_HEALTH, DEFAULT_DAMAGE, DEFAULT_ATTACK_INTERVAL_MS, DEFAULT_MOVE_DURATION_MS,
  playerDamage, playerSpeedMult, fireRateMult, playerMultiShot, playerOmniShot,
  playerPierce, playerArrowRange, buffsAwarded,
  BUFF_EVERY_KILLS, startBuffSelection, resetRunStats,
} from "./buffs.js";
import {
  refreshLeaderboard, startGameSession, setLastRunDuration, resetScoreForm, initScoreForm,
} from "./net.js";
import {
  generateLevel2, l2Solid, l2BlocksProjectile, l2SpeedMult, l2Background, l2Grid, L2_SPAWNS,
} from "./level2.js";

const TILE_SIZE = 48;

const SPRITE_PATHS = {
  // --- Level 1 assets (level_one/) ---
  // Character sheets: 6 rows (idle/walk/run/attack/hurt/die) x 10 frames.
  archer: "level_one/archer_anim.png",
  archer2: "level_one/archer2_anim.png",
  archer3: "level_one/archer3_anim.png",
  knight: "level_one/knight_anim.png",
  knight2: "level_one/knight2_anim.png",
  knight3: "level_one/knight3_anim.png",
  arrow:  "level_one/arrow.png",
  spawnCastle: "level_one/spawn_castle.png",
  grass: "level_one/grass.png",
  path:  "level_one/path.png",
  water: "level_one/water.png",
  tree:  "level_one/tree.png",
  // Border tiles are rotated per position so the dark edge faces into the map.
  mountainSide: "level_one/mountain_side.png",
  mountainCorner: "level_one/mountain_corner.png",
  // --- Level 2 assets (level_two/) ---
  troll:  "level_two/troll_anim.png",
  troll2: "level_two/troll2_anim.png",
  troll3: "level_two/troll3_anim.png",
  caveSheet: "level_two/cave.png",       // floor + scatter tiles (16px grid)
  caveWater: "level_two/water.png",      // flat deep-water colour
  caveLava:  "level_two/lava.png",       // molten lava texture
  cavePath:  "level_two/path.png",       // dark-packed dirt path tile
  caveStalagmite: "level_two/stalagmite.png",
  caveFrame: "level_two/frame.png",      // baked border: edges + corners + spawn portals
};

const SRC = {
  GRASS: { sheet: "grass", x: 0, y: 0, w: 48, h: 48 },
  PATH:  { sheet: "path",  x: 0, y: 0, w: 48, h: 48 },
  TREE:  { sheet: "tree",  x: 0, y: 0, w: 48, h: 48 },
  WATER: { sheet: "water", x: 0, y: 0, w: 48, h: 48 },
};

// ---------------------------------------------------------------------------
// Character animations
// ---------------------------------------------------------------------------
// (ax, ay) is the sprite's feet-center within a cell, used to anchor it to its tile.
const ANIM_ROW = { IDLE: 0, WALK: 1, RUN: 2, ATTACK: 3, HURT: 4, DIE: 5 };
const ANIM_FRAMES = 10;
const ARCHER_CELL = { sheet: "archer", w: 277, h: 240, ax: 88.1, ay: 216.1, scale: 0.27 };
// Player skins (cosmetic). All three share ARCHER_CELL's geometry.
const ARCHER_SHEETS = ["archer", "archer2", "archer3"];
let selectedArcher = 0;
function playerCell() { return { ...ARCHER_CELL, sheet: ARCHER_SHEETS[selectedArcher] }; }
// ax is each knight body's pixel-mass centroid (not bbox center) so the weapon
// overhangs instead of pulling the body off its tile.
const KNIGHT_CELL  = { sheet: "knight",  w: 350, h: 240, ax: 141.9, ay: 235.5, scale: 0.2109 };
const KNIGHT2_CELL = { sheet: "knight2", w: 350, h: 240, ax: 152.9, ay: 235.5, scale: 0.2109 };
const KNIGHT3_CELL = { sheet: "knight3", w: 350, h: 240, ax: 147.4, ay: 235.5, scale: 0.2109 };
// Troll enemy sheets, packed from the CraftPix troll frames into the same 6-row
// (idle/walk/run/attack/hurt/die) x 10-frame layout as the knights. ax is each troll's
// horizontal pixel-mass centroid and ay its feet baseline, so it anchors to its tile
// like the other characters. Scale matches the knights for now; tune per enemy type
// when the spawn logic is wired up.
const TROLL_CELL  = { sheet: "troll",  w: 307, h: 240, ax: 120.9, ay: 235.0, scale: 0.2109 };
const TROLL2_CELL = { sheet: "troll2", w: 305, h: 240, ax: 120.0, ay: 232.0, scale: 0.2109 };
const TROLL3_CELL = { sheet: "troll3", w: 301, h: 240, ax: 122.5, ay: 236.0, scale: 0.2109 };
const ANIM_FRAME_MS = { IDLE: 130, WALK: 80, RUN: 60, ATTACK: 55, HURT: 70, DIE: 90 };
const ATTACK_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.ATTACK;
// The arrow leaves the bow partway through the swing (draw first, then release).
const ARROW_RELEASE_MS = Math.round(ATTACK_HOLD_MS * 0.6);
const HURT_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.HURT;

// Arrows are stopped by mountains and trees. Water does not block arrows.
const PROJECTILE_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE]);

function blocksProjectile(tileId) {
  return PROJECTILE_SOLID_TILES.has(tileId);
}

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

// Cap concurrent enemies to hold frame rate and keep the board readable.
const MAX_ENEMIES = 40;

// Spawning tops up toward a target population every SPAWN_INTERVAL_MS. Both the
// target and the per-tick batch ramp with elapsed time, so the opening stays sparse
// and the late game fills toward MAX_ENEMIES even against a fast-killing build.
const SPAWN_INTERVAL_MS = 600;
const SPAWN_TARGET_START = 3;       // target population at the start of a run
const SPAWN_TARGET_RAMP_MS = 8000;  // target grows by 1 every 8s
const SPAWN_BATCH_RAMP_MS = 60000;  // per-tick spawn batch grows by 1 each minute

const ARROW_SPEED = TILE_SIZE / 50; // travel speed in px/ms (one tile per 50ms)

// The stat defaults (DEFAULT_HEALTH and friends) live in buffs.js with the
// run's live buff values (imported above).
const PLAYER_MOVE_DURATION_MS = DEFAULT_MOVE_DURATION_MS;
const PATH_SPEED_MULT  = 1.15;  // path tiles run faster
const GRASS_SPEED_MULT = 0.85;  // grass slower
// Diagonal steps take sqrt(2)x longer so per-axis speed stays constant.
const DIAG_DURATION_FACTOR = 1.414;

// speedScale = fraction of player speed on the same terrain. hpScale = multiples of
// DEFAULT_DAMAGE (so arrows-to-kill holds if the default changes). unlockCards = how
// many upgrade cards the player must have taken before this type starts spawning.
const ENEMY_TYPES = {
  enemy_one: {
    cell: KNIGHT_CELL,
    speedScale: 0.25,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 1,
    unlockCards: 0,
  },
  enemy_two: {
    cell: KNIGHT2_CELL,
    speedScale: 0.40,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 2,
    unlockCards: 3,
  },
  enemy_three: {
    cell: KNIGHT3_CELL,
    speedScale: 0.60,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 4,
    unlockCards: 6,
  },
};
// Troll enemy types for level 2. Same shape as the knights, mirroring the matching
// knight's speed/damage/windup, but with double the health (hpScale x2) and unlocking
// on level-2 cards (troll1 from the start, troll2 after 2, troll3 after 4).
const TROLL_TYPES = {
  troll_one:   { cell: TROLL_CELL,  speedScale: 0.25, attackWindupMs: 1000, damage: 1, hpScale: 2, unlockCards: 0 },
  troll_two:   { cell: TROLL2_CELL, speedScale: 0.40, attackWindupMs: 1000, damage: 1, hpScale: 4, unlockCards: 2 },
  troll_three: { cell: TROLL3_CELL, speedScale: 0.60, attackWindupMs: 1000, damage: 1, hpScale: 8, unlockCards: 4 },
};
// Every enemy across both levels, keyed by type, so lookups (HP, cell, step timing)
// don't care which level spawned it.
const ALL_TYPES = { ...ENEMY_TYPES, ...TROLL_TYPES };
// Level wiring: the 8th upgrade card ends level 1, and each level uses its own enemy
// types and spawn points.
const CARDS_TO_LEVEL2 = 8;
const LEVEL_TYPES = { 1: ["enemy_one", "enemy_two", "enemy_three"], 2: ["troll_one", "troll_two", "troll_three"] };
function levelTypes() { return LEVEL_TYPES[level]; }
function levelSpawns() { return level === 2 ? L2_SPAWNS.map(([x, y]) => ({ x, y })) : SPAWN_POINTS; }
// Cards counted within the current level. Troll unlocks use level-2-local cards, while
// the buff stats themselves carry over from level 1.
function levelCards() { return level === 2 ? Math.max(0, buffsAwarded - CARDS_TO_LEVEL2) : buffsAwarded; }
// Enemy HP in damage points, scaled off the default arrow damage.
function enemyHp(typeKey) {
  return ALL_TYPES[typeKey].hpScale * DEFAULT_DAMAGE;
}
// A type is available once the player has taken its unlockCards upgrade cards this level.
function spawnWeight(typeKey) {
  return levelCards() >= ALL_TYPES[typeKey].unlockCards ? 1 : 0;
}
// Shared by player and enemies so speedScale stays a true fraction of player
// speed on the same terrain. Otherwise enemies outpace a grass-slowed player.
function terrainMult(tileId) {
  if (tileId === TILES.PATH) return PATH_SPEED_MULT;
  if (tileId === TILES.GRASS) return GRASS_SPEED_MULT;
  return 1.0;
}
function enemyStepDuration(type, x, y) {
  return Math.round((DEFAULT_MOVE_DURATION_MS / cellSpeedMult(x, y)) / ALL_TYPES[type].speedScale);
}

// Each ranger is multipliers off the stat defaults. bars are 1-3 ratings for the
// menu pips. Resolve to concrete starting values with rangerStats().
const RANGERS = [
  { health: 1,     damage: 1,   attackSpeed: 1,   moveSpeed: 1,
    bars: { Health: 2, Damage: 2, "Attack Speed": 2, "Movement Speed": 2 } },
  { health: 4 / 3, damage: 2,   attackSpeed: 0.5, moveSpeed: 0.75,
    bars: { Health: 3, Damage: 3, "Attack Speed": 1, "Movement Speed": 1 } },
  { health: 2 / 3, damage: 0.5, attackSpeed: 2,   moveSpeed: 1.25,
    bars: { Health: 1, Damage: 1, "Attack Speed": 3, "Movement Speed": 3 } },
];

// A ranger's concrete starting stats, scaled off the defaults.
function rangerStats(i) {
  const r = RANGERS[i];
  return {
    hearts: Math.round(DEFAULT_HEALTH * r.health),
    damage: Math.round(DEFAULT_DAMAGE * r.damage),
    fireRate: r.attackSpeed, // live cooldown = DEFAULT_ATTACK_INTERVAL_MS / fireRate
    speed: r.moveSpeed,      // tile duration = DEFAULT_MOVE_DURATION_MS / speed
  };
}

// ---------------------------------------------------------------------------
// Canvas + HUD wiring
// ---------------------------------------------------------------------------

const canvas = document.getElementById("game");
// Size the canvas before getContext, since resizing resets context state.
const DISPLAY_SCALE = 1.0;
canvas.width = MAP_COLS * TILE_SIZE;
canvas.height = MAP_ROWS * TILE_SIZE;
canvas.style.width = `${canvas.width * DISPLAY_SCALE}px`;
canvas.style.height = `${canvas.height * DISPLAY_SCALE}px`;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// The header HUD elements live in hud.js, the score form and leaderboard in net.js.
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayButton = document.getElementById("overlay-button");

// Music and SFX live in audio.js (imported above).

const DAMAGE_FLASH_MS = 900;
let damageFlashUntil = 0;

// Browsers block audio until a user gesture, so start the menu track on first input.
function unlockAudio() {
  if (musicMode === "none" && !state.running) playMenuMusic();
  const ctx = ensureAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  loadSfx();
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// The leaderboard, score form, and score submission live in net.js (imported above).

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

// Which level is active (1 = grass/knights, 2 = cave/trolls) and when it began, so
// the spawn ramp restarts at level 2 while buffs and kills carry over.
let level = 1;
let levelStartedAt = 0;

const state = {
  running: false,
  paused: false,
  choosingBuff: false,
  transitioning: false,
  startedAt: 0,
  kills: 0,
  maxLives: DEFAULT_HEALTH,
  lives: DEFAULT_HEALTH,
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
  lastSpawnAt: 0,
};

// The tile-world core and buildStartingMap live in mapgen.js (imported above).

// ---------------------------------------------------------------------------
// Level-aware tile queries. Level 1 reads the mapgen tileMap; level 2 reads the cave
// terrain grid (level2.js). Movement, projectiles, pathfinding and rendering all go
// through these so the rest of the game doesn't branch on the level.
// ---------------------------------------------------------------------------
function cellSolid(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  if (level === 2) return l2Solid(x, y);
  return isSolid(state.tileMap[y][x]) || isFortAt(x, y);
}
function cellBlocksProjectile(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  if (level === 2) return l2BlocksProjectile(x, y);
  return blocksProjectile(state.tileMap[y][x]) || isFortAt(x, y);
}
function cellSpeedMult(x, y) {
  if (level === 2) return l2SpeedMult(x, y);
  const t = state.tileMap[y][x];
  if (t === TILES.PATH) return PATH_SPEED_MULT;
  if (t === TILES.GRASS) return GRASS_SPEED_MULT;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Sprite loading
// ---------------------------------------------------------------------------

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

// Frame index since startMs. Loops unless `once` (clamps on the last frame).
function animFrameIndex(startMs, now, anim, once, speedMult = 1) {
  const i = Math.floor((now - startMs) * speedMult / ANIM_FRAME_MS[anim]);
  if (once) return Math.max(0, Math.min(ANIM_FRAMES - 1, i));
  return ((i % ANIM_FRAMES) + ANIM_FRAMES) % ANIM_FRAMES;
}

function animDone(startMs, now, anim) {
  return (now - startMs) >= ANIM_FRAMES * ANIM_FRAME_MS[anim];
}

// Draw a cell so its feet-center anchor lands at (centerX, baseY). Flips on left.
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
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = { KeyW: "up", KeyA: "left", KeyS: "down", KeyD: "right" };

let playerAttackUntil = 0;
let playerHurtUntil = 0;
let lastArrowFiredAt = -DEFAULT_ATTACK_INTERVAL_MS; // far in the past = ready to fire
// A shot triggered but whose arrow hasn't left the bow yet.
let pendingShot = null;

// Aim with the mouse, fire on left button. mouseX/Y are canvas pixels (null until
// the pointer moves over the canvas). mouseDown drives continuous fire.
let mouseX = null;
let mouseY = null;
let mouseDown = false;

// A step in progress is never interrupted, so releasing always lands on a tile.
const heldMoveKeys = new Set();

function onKeyDown(event) {
  // Ignore keys while typing into the name input.
  const t = event.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  if (state.choosingBuff) { event.preventDefault(); return; }

  // Space toggles pause during a run. Escape is an undocumented alias.
  if (event.code === "Space" || event.code === "Escape") {
    if (state.running) {
      togglePause();
      event.preventDefault();
    }
    return;
  }

  // We track held state ourselves, so OS auto-repeat is redundant.
  if (event.repeat) { event.preventDefault(); return; }

  if (!state.running || state.paused) return;

  if (MOVE_KEYS[event.code]) {
    heldMoveKeys.add(MOVE_KEYS[event.code]);
    tryStartMove();
    event.preventDefault();
  }
}

function onKeyUp(event) {
  if (MOVE_KEYS[event.code]) heldMoveKeys.delete(MOVE_KEYS[event.code]);
}

// Canvas mouse position in internal pixels (the CSS display size may differ).
function setMouseFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
}

// The player's authoritative pixel center (destination of any in-flight move).
function playerCenterPx() {
  const px = state.player.moving ? state.player.toX : state.player.x;
  const py = state.player.moving ? state.player.toY : state.player.y;
  return { x: px * TILE_SIZE + TILE_SIZE / 2, y: py * TILE_SIZE + TILE_SIZE / 2 };
}

// Exact angle (radians) from the player to the cursor, for free-aim shots.
function aimAngle() {
  if (mouseX === null) return state.player.facing === "left" ? Math.PI : 0;
  const c = playerCenterPx();
  return Math.atan2(mouseY - c.y, mouseX - c.x);
}

// Face the cursor: left of the archer faces left, right faces right.
function updateFacingFromAim() {
  if (mouseX === null) return;
  const cx = playerCenterPx().x;
  if (mouseX < cx) state.player.facing = "left";
  else if (mouseX > cx) state.player.facing = "right";
}

function fireFromAim() {
  fireArrow(aimAngle());
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

let pausedAt = 0;

// Shift every wall-clock-derived timer forward by `delta` so a pause doesn't make
// them jump on resume.
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
  if (state.transitioning) return; // ignore pause while fading between levels
  if (state.paused) {
    shiftTimers(performance.now() - pausedAt);
    state.paused = false;
    resumeMusic();
    requestAnimationFrame(loop);
  } else {
    state.paused = true;
    pausedAt = performance.now();
    mouseDown = false; // drop held fire so it doesn't resume shooting on its own
    pauseMusic();
    renderPauseScreen();
  }
}

function renderPauseScreen() {
  render(pausedAt);
  ctx.fillStyle = "rgba(12, 13, 16, 0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "bold 78px ui-monospace, Menlo, monospace";
  ctx.fillText("PAUSE", canvas.width / 2, canvas.height / 2 - 24);
  ctx.fillStyle = "#7d8088";
  ctx.font = "33px ui-monospace, Menlo, monospace";
  ctx.fillText("Press space to continue", canvas.width / 2, canvas.height / 2 + 45);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Upgrade cards live in buffs.js. This handle hands them the hooks a buff pause
// needs from the game: the shared state, timer shifting, input clearing, and
// the loop resume.
// ---------------------------------------------------------------------------
const buffGame = {
  state,
  shiftTimers,
  clearHeldInput: () => { heldMoveKeys.clear(); mouseDown = false; },
  resume: () => requestAnimationFrame(loop),
};

// Start a tile step from the held WASD keys. Never interrupts a step in progress.
function tryStartMove() {
  if (state.player.moving) return;
  const dx = (heldMoveKeys.has("right") ? 1 : 0) - (heldMoveKeys.has("left") ? 1 : 0);
  const dy = (heldMoveKeys.has("down")  ? 1 : 0) - (heldMoveKeys.has("up")   ? 1 : 0);
  if (dx === 0 && dy === 0) return;
  // If a diagonal is blocked, slide along whichever axis is open instead of sticking.
  if (queueMove(dx, dy)) return;
  if (dx !== 0 && dy !== 0) {
    if (queueMove(dx, 0)) return;
    queueMove(0, dy);
  }
}

// Returns true if a step was started, false if the target tile is blocked.
function queueMove(dx, dy) {
  const p = state.player;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return false;
  if (cellSolid(nx, ny)) return false;
  if (isEnemyAt(nx, ny)) return false;
  // Block diagonal squeezes: if both cardinal neighbors are solid, no diagonal.
  if (dx !== 0 && dy !== 0) {
    const sideABlocked = cellSolid(nx, p.y);
    const sideBBlocked = cellSolid(p.x, ny);
    if (sideABlocked && sideBBlocked) return false;
  }

  // Facing follows the mouse cursor (updateFacingFromAim), not the move direction.
  const mult = cellSpeedMult(nx, ny);
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
  // Retry held keys each idle frame so the player resumes the instant a tile opens.
  if (!p.moving) tryStartMove();
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

// Queue a shot: the arrow spawns later in releasePendingShot, partway through the
// swing. The whole draw/release scales with fire rate so it never caps firing.
function fireArrow(angle) {
  const now = performance.now();
  if (now - lastArrowFiredAt < DEFAULT_ATTACK_INTERVAL_MS / fireRateMult) return;
  if (pendingShot) return; // a draw is already queued
  lastArrowFiredAt = now;
  playerAttackUntil = now + ATTACK_HOLD_MS / fireRateMult;
  pendingShot = { angle, releaseAt: now + ARROW_RELEASE_MS / fireRateMult };
}

function releasePendingShot(now) {
  if (!pendingShot || now < pendingShot.releaseAt) return;
  const { angle } = pendingShot;
  pendingShot = null;
  // Spawn from the center of the player's authoritative tile (destination of any move).
  const tileX = state.player.moving ? state.player.toX : state.player.x;
  const tileY = state.player.moving ? state.player.toY : state.player.y;
  const px = (tileX + 0.5) * TILE_SIZE;
  const py = (tileY + 0.5) * TILE_SIZE;
  // Both spread around the aim: Omni fires 8 arrows 45 degrees apart starting at the
  // aimed one; Multi-Shot a 3-arrow fan 45 degrees either side of it.
  let angles;
  if (playerOmniShot) angles = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => angle + i * Math.PI / 4);
  else if (playerMultiShot) angles = [angle, angle - Math.PI / 4, angle + Math.PI / 4];
  else angles = [angle];
  for (const a of angles) {
    state.projectiles.push({
      px, py,
      vx: Math.cos(a) * ARROW_SPEED,
      vy: Math.sin(a) * ARROW_SPEED,
      angle: a,
      traveled: 0,
      lastStepAt: now,
      hitEnemies: new Set(),
    });
  }
  playSfx("bow", 10);
}

// Advance each arrow along its angle. Dropped when it leaves the map, hits a wall
// or fort, or reaches its range. Water does not block arrows.
function stepProjectiles(now) {
  const remaining = [];
  for (const p of state.projectiles) {
    const dt = now - p.lastStepAt;
    p.lastStepAt = now;
    p.px += p.vx * dt;
    p.py += p.vy * dt;
    p.traveled += ARROW_SPEED * dt;
    const tx = Math.floor(p.px / TILE_SIZE);
    const ty = Math.floor(p.py / TILE_SIZE);
    if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
    if (cellBlocksProjectile(tx, ty)) continue;
    if (p.traveled >= playerArrowRange * TILE_SIZE) continue;
    remaining.push(p);
  }
  state.projectiles = remaining;
}

// ---------------------------------------------------------------------------
// Enemies + pathfinding
// ---------------------------------------------------------------------------

// Cache the flow field. It depends only on the goal tile and the map, not on the
// enemies or the frame, so rebuild only when the player changes tiles or a new map
// loads (the tileMap reference changes in resetState).
let flowField = null;
let flowGoalX = -1;
let flowGoalY = -1;
let flowMap = null;
function goalFlowField(goalX, goalY) {
  const mapRef = level === 2 ? l2Grid() : state.tileMap;
  if (flowField === null || goalX !== flowGoalX || goalY !== flowGoalY || flowMap !== mapRef) {
    flowField = level === 2
      ? buildFlowField(goalX, goalY, null, (x, y) => l2Solid(x, y))
      : buildFlowField(goalX, goalY, state.tileMap);
    flowGoalX = goalX;
    flowGoalY = goalY;
    flowMap = mapRef;
  }
  return flowField;
}

// Target on-screen enemy count for the current run time, ramping to MAX_ENEMIES.
function targetEnemyCount(elapsed) {
  return Math.min(MAX_ENEMIES, SPAWN_TARGET_START + Math.floor(elapsed / SPAWN_TARGET_RAMP_MS));
}

function spawnEnemyAt(fort, now) {
  // Weighted pick across the current level's unlocked types (see spawnWeight).
  const keys = levelTypes();
  const weights = keys.map((k) => spawnWeight(k));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  let typeKey = keys[0];
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r <= 0) { typeKey = keys[i]; break; }
  }
  state.enemies.push({
    x: fort.x,
    y: fort.y,
    moving: false,
    moveStartAt: 0,
    moveDuration: 0,
    fromX: fort.x,
    fromY: fort.y,
    toX: fort.x,
    toY: fort.y,
    facing: "left",
    type: typeKey,
    anim: "WALK",
    animStart: now,
    dying: false,
    deathStart: 0,
    attacking: false,
    attackStart: 0,
    hp: enemyHp(typeKey),
    hurtUntil: 0,
  });
}

function maybeSpawnEnemy(now) {
  if (now - state.lastSpawnAt < SPAWN_INTERVAL_MS) return;
  // Relative to when this level began, so level 2's ramp restarts (sparse then builds).
  const elapsed = now - levelStartedAt;
  const deficit = targetEnemyCount(elapsed) - state.enemies.length;
  if (deficit <= 0) return;
  // Spawn only on this level's points that no enemy occupies (never stack on a tile).
  const openForts = levelSpawns().filter((s) => !isEnemyAt(s.x, s.y));
  if (openForts.length === 0) return;
  // Top up toward the target. The batch grows late game so the board can refill
  // faster than a strong build clears it. Shuffle so the batch uses distinct forts.
  const batch = 1 + Math.floor(elapsed / SPAWN_BATCH_RAMP_MS);
  const count = Math.min(deficit, openForts.length, batch);
  for (let i = openForts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [openForts[i], openForts[j]] = [openForts[j], openForts[i]];
  }
  for (let n = 0; n < count; n++) spawnEnemyAt(openForts[n], now);
  state.lastSpawnAt = now;
}

// Within one tile (incl. diagonal) of the player.
function enemyInAttackRange(enemy, px, py) {
  return Math.abs(enemy.x - px) <= 1 && Math.abs(enemy.y - py) <= 1;
}

function stepEnemies(now) {
  state.enemies = state.enemies.filter((e) => !(e.dying && animDone(e.deathStart, now, "DIE")));
  if (state.player.dying) return; // freeze enemies once the player is dying
  const goalX = state.player.moving ? state.player.toX : state.player.x;
  const goalY = state.player.moving ? state.player.toY : state.player.y;
  const field = goalFlowField(goalX, goalY);
  for (const enemy of state.enemies) {
    if (enemy.dying) continue;
    const type = ALL_TYPES[enemy.type];

    if (now < enemy.hurtUntil) { enemy.moving = false; continue; }

    // Damage lands when the windup finishes, so the player can dodge out of range.
    if (enemy.attacking) {
      if (now - enemy.attackStart >= type.attackWindupMs) {
        enemy.attacking = false;
        if (enemyInAttackRange(enemy, goalX, goalY)) damagePlayer(now, type.damage);
      }
      continue;
    }

    // Finish an in-flight tween, then fall through to the next step this frame so
    // there's no one-frame idle gap that would restart the walk cycle.
    if (enemy.moving) {
      if (now - enemy.moveStartAt < enemy.moveDuration) continue;
      enemy.x = enemy.toX;
      enemy.y = enemy.toY;
      enemy.moving = false;
    }

    if (enemyInAttackRange(enemy, goalX, goalY)) {
      enemy.attacking = true;
      enemy.attackStart = now;
      if (goalX > enemy.x) enemy.facing = "right";
      else if (goalX < enemy.x) enemy.facing = "left";
      continue;
    }
    const next = nextStepFromField(field, enemy.x, enemy.y);
    if (next === null) continue;
    enemy.fromX = enemy.x;
    enemy.fromY = enemy.y;
    enemy.toX = next.x;
    enemy.toY = next.y;
    if (next.x > enemy.x) enemy.facing = "right";
    else if (next.x < enemy.x) enemy.facing = "left";
    enemy.moveDuration = enemyStepDuration(enemy.type, next.x, next.y);
    enemy.moveStartAt = now;
    enemy.moving = true;
  }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

// True if a living enemy occupies (x, y), counting the tile it is tweening into.
function isEnemyAt(x, y) {
  for (const e of state.enemies) {
    if (e.dying) continue;
    if (e.x === x && e.y === y) return true;
    if (e.moving && e.toX === x && e.toY === y) return true;
  }
  return false;
}

// Hit radius around an enemy's center. Smaller than a tile so the hitbox tracks
// the drawn body, not the whole tile (or both tiles it straddles mid-move).
const ENEMY_HIT_RADIUS = TILE_SIZE * 0.45;

// Pixel center of an enemy, interpolated mid-move so it matches where it is drawn.
function enemyCenterPx(enemy, now) {
  let cx = enemy.x;
  let cy = enemy.y;
  if (enemy.moving) {
    const t = Math.max(0, Math.min(1, (now - enemy.moveStartAt) / enemy.moveDuration));
    cx = lerp(enemy.fromX, enemy.toX, t);
    cy = lerp(enemy.fromY, enemy.toY, t);
  }
  return { x: (cx + 0.5) * TILE_SIZE, y: (cy + 0.5) * TILE_SIZE };
}

function resolveCollisions() {
  const now = performance.now();
  const r2 = ENEMY_HIT_RADIUS * ENEMY_HIT_RADIUS;
  // Each arrow hits up to (1 + playerPierce) distinct enemies. hitEnemies is tracked
  // per arrow so it never re-hits one as it passes over it across frames. Enemy
  // centers are computed once here, not per arrow, since this loop is the hot path.
  const live = [];
  for (const enemy of state.enemies) {
    if (enemy.dying) continue;
    const c = enemyCenterPx(enemy, now);
    live.push({ enemy, cx: c.x, cy: c.y });
  }
  const surviving = [];
  for (const p of state.projectiles) {
    let consumed = false;
    for (const e of live) {
      if (e.enemy.dying) continue; // killed by an earlier arrow this frame
      const dx = p.px - e.cx;
      const dy = p.py - e.cy;
      if (dx * dx + dy * dy > r2) continue;
      if (p.hitEnemies.has(e.enemy)) continue;
      p.hitEnemies.add(e.enemy);
      damageEnemy(e.enemy, now);
      if (p.hitEnemies.size > playerPierce) { consumed = true; break; }
    }
    if (!consumed) surviving.push(p);
  }
  state.projectiles = surviving;
  // Player damage comes from enemy attack windups (stepEnemies), not contact.
}

// Apply one arrow's damage. A fatal hit starts the death and counts the kill.
// A non-fatal hit plays the flinch.
function damageEnemy(enemy, now) {
  enemy.hp -= playerDamage;
  if (enemy.hp <= 0) {
    // Freeze the death at the current (possibly mid-move) position so it doesn't
    // snap back to the tile it was leaving.
    const c = enemyCenterPx(enemy, now);
    enemy.deathX = c.x - TILE_SIZE / 2;
    enemy.deathY = c.y - TILE_SIZE / 2;
    enemy.dying = true;
    enemy.deathStart = now;
    enemy.moving = false;
    state.kills++;
  } else {
    enemy.hurtUntil = now + HURT_HOLD_MS;
    enemy.moving = false;
    enemy.attacking = false;
  }
}

// Lose a heart. A non-fatal hit plays the hurt flinch. The last heart starts death.
function damagePlayer(now, dmg) {
  const p = state.player;
  if (p.dying) return;
  state.lives = Math.max(0, state.lives - dmg);
  playSfx("hurt");
  damageFlashUntil = now + DAMAGE_FLASH_MS;
  if (state.lives <= 0) {
    startPlayerDeath(now);
  } else {
    playerHurtUntil = now + HURT_HOLD_MS;
  }
}

// Freeze input, play DIE, and capture the final time. The loop shows it before
// the retry screen.
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
  mouseDown = false;
  // Run ends at death, so capture duration here, not when the animation finishes.
  setLastRunDuration(Math.floor((now - state.startedAt) / 1000));
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

// Side/corner sprites rotated so the dark edge always faces into the map.
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
  ctx.imageSmoothingEnabled = false; // pixel art: nearest-neighbor
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

// The castle is taller than its tile, anchored to the tile's bottom edge so it
// overhangs upward.
const SPAWN_CASTLE_W = TILE_SIZE;
const SPAWN_CASTLE_H = 54;

function renderSpawnMarkers() {
  const castle = sprites.spawnCastle;
  if (castle) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const left0 = (TILE_SIZE - SPAWN_CASTLE_W) / 2;
    for (const p of SPAWN_POINTS) {
      const left = p.x * TILE_SIZE + left0;
      const bottom = (p.y + 1) * TILE_SIZE;
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

// 55/415 is the arrow sprite's native aspect ratio.
const ARROW_LEN = 36;
const ARROW_THICK = ARROW_LEN * (55 / 415);

function renderProjectiles() {
  ctx.imageSmoothingEnabled = true; // smooth the vector arrow
  const arrowSheet = sprites.arrow;
  // Skip an arrow still on the player's own tile so it doesn't flash a stub.
  const ptx = state.player.moving ? state.player.toX : state.player.x;
  const pty = state.player.moving ? state.player.toY : state.player.y;
  for (const p of state.projectiles) {
    if (Math.floor(p.px / TILE_SIZE) === ptx && Math.floor(p.py / TILE_SIZE) === pty) continue;
    ctx.save();
    ctx.translate(p.px, p.py);
    ctx.rotate(p.angle);
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
  ctx.imageSmoothingEnabled = true; // smooth the downscaled character sheets

  for (const enemy of state.enemies) {
    const type = ALL_TYPES[enemy.type];
    let px, py;
    if (enemy.dying) {
      px = enemy.deathX; // frozen where it died, mid-tile if it was moving
      py = enemy.deathY;
    } else if (enemy.moving) {
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
        desired = cellSpeedMult(enemy.toX, enemy.toY) > 1.0 ? "RUN" : "WALK";
      } else {
        desired = "IDLE";
      }
      if (enemy.anim !== desired) { enemy.anim = desired; enemy.animStart = now; }
      frameIndex = animFrameIndex(enemy.animStart, now, enemy.anim, false);
    }

    // Knight sheet faces right. Flip when facing left.
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

  // Animation priority is die > hurt > attack (while shooting) > run/walk > idle.
  let desired;
  if (p.dying) {
    desired = "DIE";
  } else if (now < playerHurtUntil) {
    desired = "HURT";
  } else if (now < playerAttackUntil) {
    desired = "ATTACK";
  } else if (p.moving) {
    desired = cellSpeedMult(p.toX, p.toY) > 1.0 ? "RUN" : "WALK";
  } else {
    desired = "IDLE";
  }
  if (p.anim !== desired) { p.anim = desired; p.animStart = now; }

  // DIE and HURT play once, the rest loop. ATTACK is sped up by the fire rate.
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
  if (level === 2) {
    // Level 2's whole map (floor, water froth, lava char, paths, stalagmites, border)
    // is pre-rendered to an offscreen canvas when the level loads, so we just blit it.
    const bg = l2Background();
    if (bg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(bg, 0, 0); }
  } else {
    renderTiles();
    renderSpawnMarkers();
  }
  renderEnemies(now);
  renderPlayer(now);
  renderProjectiles(); // above the characters, so arrows never show through them
  renderDamageVignette(now);
}

// Red edge vignette on taking damage, fading toward the center over the flash window.
function renderDamageVignette(now) {
  const remaining = damageFlashUntil - now;
  if (remaining <= 0) return;
  const t = remaining / DAMAGE_FLASH_MS;
  const alpha = Math.min(1, t) * 0.6;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const inner = Math.min(cx, cy) * 0.45;
  const outer = Math.hypot(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, "rgba(200, 0, 0, 0)");
  grad.addColorStop(1, `rgba(200, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// The header HUD (hearts, kills, timer) lives in hud.js (imported above).

// ---------------------------------------------------------------------------
// Level transition (level 1 -> level 2): the screen pixelates to black over 4s,
// then level 2 pixelates in over another 4s. Gameplay is frozen for the whole 8s,
// and the cave is generated during the fade-out so the wait is hidden.
// ---------------------------------------------------------------------------
const TRANSITION_MS = 4000;
let transition = null; // { phase: "out" | "in", startAt, snap }
const pixelScratch = document.createElement("canvas");

// Draw `src` into the main canvas pixelated by `amount` (0 = crisp, 1 = coarse blocks)
// and darkened toward black by the same amount.
function drawPixelated(src, amount) {
  const block = 1 + Math.round(amount * 40);
  const sw = Math.max(1, Math.round(canvas.width / block));
  const sh = Math.max(1, Math.round(canvas.height / block));
  pixelScratch.width = sw; pixelScratch.height = sh;
  const pctx = pixelScratch.getContext("2d");
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, sw, sh);
  pctx.drawImage(src, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(pixelScratch, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
  if (amount > 0) { ctx.fillStyle = `rgba(0,0,0,${amount})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

function snapshotCanvas() {
  const snap = document.createElement("canvas");
  snap.width = canvas.width; snap.height = canvas.height;
  snap.getContext("2d").drawImage(canvas, 0, 0);
  return snap;
}

function startLevelTransition(now) {
  state.transitioning = true;
  mouseDown = false;
  heldMoveKeys.clear();
  pendingShot = null;
  render(now); // snapshot the current (level 1) scene
  transition = { phase: "out", startAt: now, snap: snapshotCanvas() };
  generateLevel2(sprites); // build the cave map + background while the screen fades out
}

// Drop the player into the middle of level 2. Kills and buffs carry over; enemies,
// projectiles and the spawn clock reset.
function enterLevelTwo(now) {
  level = 2;
  state.enemies = [];
  state.projectiles = [];
  pendingShot = null;
  state.player = {
    x: PLAYER_START_X, y: PLAYER_START_Y, facing: "right",
    moving: false, moveStartAt: 0, moveDuration: 0,
    fromX: PLAYER_START_X, fromY: PLAYER_START_Y, toX: PLAYER_START_X, toY: PLAYER_START_Y,
    anim: "IDLE", animStart: now, dying: false, deathStart: 0,
  };
  playerAttackUntil = 0;
  playerHurtUntil = 0;
  damageFlashUntil = 0;
  lastArrowFiredAt = -DEFAULT_ATTACK_INTERVAL_MS;
  flowField = null; // rebuild the flow field for the cave grid
  playGameMusic(2); // level 2 plays its own randomized playlist
}

function renderTransition(now) {
  const t = Math.min(1, (now - transition.startAt) / TRANSITION_MS);
  if (transition.phase === "out") {
    drawPixelated(transition.snap, t);
    if (t >= 1) {
      enterLevelTwo(now);
      render(now); // draw the initial cave frame, then snapshot it to pixelate in
      transition = { phase: "in", startAt: now, snap: snapshotCanvas() };
    }
  } else {
    drawPixelated(transition.snap, 1 - t);
    if (t >= 1) {
      const p = performance.now();
      levelStartedAt = p; // restart the spawn ramp from the moment play resumes
      state.lastSpawnAt = p;
      state.transitioning = false;
      transition = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function loop(now) {
  if (!state.running || state.paused || state.choosingBuff) return;
  if (state.transitioning) { renderTransition(now); requestAnimationFrame(loop); return; }
  // Level 1 ends the moment the 8th upgrade card has been taken: fade into level 2.
  if (level === 1 && buffsAwarded >= CARDS_TO_LEVEL2 && !state.player.dying) {
    startLevelTransition(now);
    requestAnimationFrame(loop);
    return;
  }
  try {
    if (state.player.dying) {
      // Only the death animation advances, then go to the retry screen.
      render(now);
      if (animDone(state.player.deathStart, now, "DIE")) { gameOver(); return; }
    } else {
      stepPlayerMove(now);
      updateFacingFromAim();
      maybeSpawnEnemy(now);
      stepProjectiles(now);
      if (mouseDown) fireFromAim();
      releasePendingShot(now);
      stepEnemies(now);
      resolveCollisions();
      render(now);
      updateHud(now, state);
      if (state.kills >= (buffsAwarded + 1) * BUFF_EVERY_KILLS) startBuffSelection(now, buffGame);
    }
  } catch (err) {
    // Keep one frame's exception from killing the rAF chain.
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
  playGameMusic(1);
  state.startedAt = performance.now();
  state.lastSpawnAt = state.startedAt;
  levelStartedAt = state.startedAt;
  startGameSession();
  resetScoreForm(false);
  overlay.classList.add("hidden");
  canvas.focus();
  requestAnimationFrame(loop);
}

function resetState() {
  const ranger = rangerStats(selectedArcher);
  level = 1;
  state.transitioning = false;
  transition = null;
  state.kills = 0;
  state.maxLives = ranger.hearts;
  state.lives = ranger.hearts;
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
  lastArrowFiredAt = -DEFAULT_ATTACK_INTERVAL_MS;
  pendingShot = null;
  mouseDown = false;
  resetRunStats(ranger);
  state.enemies = [];
  state.projectiles = [];
  state.tileMap = buildStartingMap();
}

function gameOver() {
  state.running = false;
  playMenuMusic();
  overlayTitle.textContent = `Enemies killed: ${state.kills}`;
  overlayText.textContent = "Move with WASD. Aim with the mouse, left-click to shoot.";
  resetScoreForm(true);
  overlay.classList.remove("hidden");
  refreshLeaderboard();
  startCharPreviewLoop(); // let them re-pick an archer before the next run
}

// ---------------------------------------------------------------------------
// Character select (cosmetic)
// ---------------------------------------------------------------------------
const charCards = Array.from(document.querySelectorAll(".char-option")).map((opt) => ({
  option: opt,
  canvas: opt.querySelector(".char-card"),
  ctx: opt.querySelector(".char-card").getContext("2d"),
  index: Number(opt.dataset.archer),
}));
let charPreviewRAF = 0;

// Fill each ranger's box with its stat ratings (filled pips out of 3).
function buildStatBoxes() {
  for (const card of charCards) {
    const box = card.option.querySelector(".char-stats");
    box.innerHTML = Object.entries(RANGERS[card.index].bars).map(([label, rating]) => {
      const pips = [0, 1, 2].map((i) => `<span class="pip ${i < rating ? "full" : "empty"}"></span>`).join("");
      return `<div class="stat-row"><span class="stat-label">${label}</span><span class="pips">${pips}</span></div>`;
    }).join("");
  }
}

// Reflect the selected ranger's hearts in the HUD while on the menu.
function showRangerHud() {
  const r = rangerStats(selectedArcher);
  state.maxLives = r.hearts;
  state.lives = r.hearts;
  renderHearts(state);
}

try {
  const saved = parseInt(localStorage.getItem("ranger-survivor.archer"), 10);
  if (!Number.isNaN(saved) && saved >= 0 && saved < ARCHER_SHEETS.length) selectedArcher = saved;
} catch (_) { /* localStorage may be disabled */ }

// Tight pixel bounds of an archer's idle frame, so the preview centers on the
// real sprite (not the padded cell). Cached per sheet.
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
    card.option.classList.toggle("selected", card.index === selectedArcher);
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
  card.option.addEventListener("click", () => {
    if (card.index !== selectedArcher) playSfx("select", 4); // only when switching
    selectedArcher = card.index;
    showRangerHud();
    try { localStorage.setItem("ranger-survivor.archer", String(selectedArcher)); } catch (_) { /* ignore */ }
  });
}

overlayButton.addEventListener("click", () => { playSfx("select", 4); start(); });
initScoreForm(() => state.kills); // submit button and Enter, wired in net.js
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

canvas.addEventListener("mousemove", setMouseFromEvent);
canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  setMouseFromEvent(event);
  event.preventDefault();
  if (state.running && !state.paused && !state.choosingBuff && !state.player.dying) {
    mouseDown = true;
    fireFromAim(); // fire immediately so a single click always registers
  }
});
window.addEventListener("mouseup", (event) => { if (event.button === 0) mouseDown = false; });

// Auto-pause when the game leaves the foreground. A hidden tab suspends rAF, so
// without this the wall-clock timers would jump ahead on return. togglePause shifts
// them instead. visibilitychange covers tabs/minimize, blur covers other windows.
function autoPauseOnLeave() {
  if (state.running && !state.paused && !state.choosingBuff) togglePause();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) autoPauseOnLeave();
});
window.addEventListener("blur", autoPauseOnLeave);

refreshLeaderboard();
buildStatBoxes();
showRangerHud();

loadSprites().then(() => {
  render(performance.now());
  startCharPreviewLoop();
});

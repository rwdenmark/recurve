// Recurve, a top-down tile-based survival shooter.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import {
  MAP_COLS, MAP_ROWS, PLAYER_START_X, PLAYER_START_Y,
  TILES, isSolid, isFortAt, SPAWN_POINTS, buildStartingMap,
} from "./mapgen.js";
import { shuffleInPlace } from "./shuffle.js";
import {
  createChargeQueue, joinQueue, stepQueue, reduceQueue, shiftQueue, resetQueue, queueCircles,
} from "./chargequeue.js";
import { xpForCard, spawnCards, cardsForLevel, tierUnlocks } from "./progression.js";
import { buildFlowField, nextStepFromField } from "./pathfinding.js";
import {
  musicMode, playMenuMusic, playGameMusic, pauseMusic, resumeMusic,
  playSfx, ensureAudioCtx, loadSfx,
} from "./audio.js";
import { renderHearts, updateHud, updateProgress } from "./hud.js";
import {
  DEFAULT_HEALTH, DEFAULT_DAMAGE, DEFAULT_ATTACK_INTERVAL_MS, DEFAULT_MOVE_DURATION_MS,
  playerDamage, playerSpeedMult, fireRateMult, playerMultiShot, omniLevel,
  playerPierce, playerArrowRange, buffsAwarded,
  invisBonusSec, ballistaBonus, ballistaFastCd, burstBonusTiles,
  startBuffSelection, resetRunStats, applyMaxBuffs,
} from "./buffs.js";
import {
  refreshLeaderboard, startGameSession, setLastRunDuration, resetScoreForm, initScoreForm,
} from "./net.js";
import {
  generateLevel2, l2Solid, l2BlocksProjectile, l2SpeedMult, l2Background, l2Grid, L2_SPAWNS,
} from "./level2.js";
import {
  generateLevel3, l3Solid, l3BlocksProjectile, l3SpeedMult, l3Background, l3Grid, l3Spawns,
} from "./level3.js";

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
  // Crossbow ranger's ballista turret. 5x4 sheet of 64px frames; only the first column
  // (a 4-frame fire cycle pointing "up") is used, rotated toward the target at draw time.
  dwarvenBallista: "level_one/dwarven_ballista.png",
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
  caveSheet: "level_two/cave.png",       // floor tiles (16px grid)
  caveWater: "level_two/water.png",      // flat deep-water color
  caveLava:  "level_two/lava.png",       // molten lava texture
  cavePath:  "level_two/path.png",       // dark-packed dirt path tile
  caveObjects: "level_two/objects.png",  // 5x3 grid of 48px rock and mineral sprites
  caveFrame: "level_two/frame.png",      // baked border: edges + corners + spawn portals
  // --- Level 3 assets (level_three/) ---
  // The sewer tileset is composited by level3.js (walls, water, corners, spawns, effects).
  l3Wall: "level_three/Wall.png",
  l3Floor: "level_three/Floor.png",
  l3Water: "level_three/water.png",
  l3WaterWall: "level_three/water_wall.png",
  l3FloorNextWater: "level_three/Floor_Next_To_Water.png",
  l3FloorNextWaterCorner: "level_three/floor_next_to_water_corner.png",
  l3FloorNextWaterBetween: "level_three/floor_next_to_water_between.png",
  l3WaterWallSewer: "level_three/water_wall_sewer.png",
  l3WaterWallGrate: "level_three/water_wall_grate.png",
  l3WallCorner: "level_three/wall_corner.png",
  l3WallWaterCorner: "level_three/wall_water_corner.png",
  l3WaterFloorCorner: "level_three/water_floor_corner.png",
  l3Spawn1: "level_three/enemy_spawn_1.png",   // wall portal
  l3Spawn2: "level_three/enemy_spawn_2.png",   // floor grate base (the variants below add a
  // water-wall border on each side that faces water, keyed by which neighbours are water)
  l3Spawn2T:    "level_three/enemy_spawn_2_top.png",
  l3Spawn2B:    "level_three/enemy_spawn_2_bottom.png",
  l3Spawn2L:    "level_three/enemy_spawn_2_left.png",
  l3Spawn2R:    "level_three/enemy_spawn_2_right.png",
  l3Spawn2TB:   "level_three/enemy_spawn_2_top_bottom.png",
  l3Spawn2LR:   "level_three/enemy_spawn_2_left_right.png",
  l3Spawn2TL:   "level_three/enemy_spawn_2_top_left.png",
  l3Spawn2TR:   "level_three/enemy_spawn_2_top_right.png",
  l3Spawn2BL:   "level_three/enemy_spawn_2_bottom_left.png",
  l3Spawn2BR:   "level_three/enemy_spawn_2_bottom_right.png",
  l3Spawn2TBL:  "level_three/enemy_spawn_2_top_bottom_left.png",
  l3Spawn2TBR:  "level_three/enemy_spawn_2_top_bottom_right.png",
  l3Spawn2TLR:  "level_three/enemy_spawn_2_left_right_top.png",
  l3Spawn2BLR:  "level_three/enemy_spawn_2_left_right_bottom.png",
  l3Spawn2TBLR: "level_three/enemy_spawn_2_left_right_top_bottom.png",
  l3Effects: "level_three/water_effects.png",  // water-surface decals
  // Level 3 enemies: necromancers (7-row sheet: idle/walk/run/attack/hurt/die/summon) and
  // their skeleton minions (standard 6-row), packed from the CraftPix necromancer set.
  necro1: "level_three/necro1_anim.png",
  necro2: "level_three/necro2_anim.png",
  necro3: "level_three/necro3_anim.png",
  skel1: "level_three/skel1_anim.png",
  skel2: "level_three/skel2_anim.png",
  skel3: "level_three/skel3_anim.png",
  necro1Fire: "level_three/necro1_fireball.png",
  necro2Fire: "level_three/necro2_fireball.png",
  necro3Fire: "level_three/necro3_fireball.png",
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
// SUMMON (row 6) is only present on the 7-row necromancer sheets, other characters never
// reference it, so it is harmless on their 6-row sheets.
const ANIM_ROW = { IDLE: 0, WALK: 1, RUN: 2, ATTACK: 3, HURT: 4, DIE: 5, SUMMON: 6 };
const ANIM_FRAMES = 10;
const ARCHER_CELL = { sheet: "archer", w: 277, h: 240, ax: 88.1, ay: 216.1, scale: 0.27 };
// Player rangers. All three share ARCHER_CELL's geometry. The choice also sets
// stats, ultimate, and card pool (see RANGERS and buffs.js).
const ARCHER_SHEETS = ["archer", "archer2", "archer3"];
let selectedRanger = 0;
function playerCell() { return { ...ARCHER_CELL, sheet: ARCHER_SHEETS[selectedRanger] }; }
// ax is each knight body's pixel-mass centroid (not bbox center) so the weapon
// overhangs instead of pulling the body off its tile.
const KNIGHT_CELL  = { sheet: "knight",  w: 350, h: 240, ax: 141.9, ay: 235.5, scale: 0.2109 };
const KNIGHT2_CELL = { sheet: "knight2", w: 350, h: 240, ax: 152.9, ay: 235.5, scale: 0.2109 };
const KNIGHT3_CELL = { sheet: "knight3", w: 350, h: 240, ax: 147.4, ay: 235.5, scale: 0.2109 };
// Troll enemy sheets, packed from the CraftPix troll frames into the same 6-row
// (idle/walk/run/attack/hurt/die) x 10-frame layout as the knights. ax is each troll's
// horizontal pixel-mass centroid and ay its feet baseline, so it anchors to its tile
// like the other characters. Scale is tuned per troll so the idle body renders the
// same ~44px height as the knights. The trolls need a larger scale because their wide
// club-swing attack frames inflated the packed cell, leaving the idle body smaller
// inside it.
const TROLL_CELL  = { sheet: "troll",  w: 307, h: 240, ax: 120.9, ay: 235.0, scale: 0.2958 };
const TROLL2_CELL = { sheet: "troll2", w: 305, h: 240, ax: 120.0, ay: 232.0, scale: 0.2900 };
const TROLL3_CELL = { sheet: "troll3", w: 301, h: 240, ax: 122.5, ay: 236.0, scale: 0.2721 };
// Level 3 necromancer + skeleton cells (auto-packed, ax = idle horizontal center, ay = feet
// baseline, scale tuned so the idle body renders ~52px).
const NECRO_CELL  = { sheet: "necro1", w: 397, h: 240, ax: 151.6, ay: 225.2, scale: 0.2758 };
const NECRO2_CELL = { sheet: "necro2", w: 401, h: 240, ax: 136.7, ay: 226.8, scale: 0.2759 };
const NECRO3_CELL = { sheet: "necro3", w: 428, h: 240, ax: 127.6, ay: 223.1, scale: 0.2521 };
const SKEL_CELL   = { sheet: "skel1",  w: 256, h: 240, ax: 120.7, ay: 223.5, scale: 0.2516 };
const SKEL2_CELL  = { sheet: "skel2",  w: 270, h: 240, ax: 134.0, ay: 227.9, scale: 0.2439 };
const SKEL3_CELL  = { sheet: "skel3",  w: 247, h: 240, ax: 126.5, ay: 240.0, scale: 0.2398 };
const ANIM_FRAME_MS = { IDLE: 130, WALK: 80, RUN: 60, ATTACK: 55, HURT: 70, DIE: 90, SUMMON: 90 };
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

// Safety cap on the live enemy count, purely to protect the frame rate (difficulty comes
// from the target population and the spawn interval, not this). It rises each cycle so late,
// harder runs can still pack the board on a capable machine. maxEnemies() reads it live.
const MAX_ENEMIES_BASE = 100;
const MAX_ENEMIES_PER_CYCLE = 40;

// Spawning tops up toward a target population on a timer, both driven by cards taken. The
// target grows a flat amount per card, and the interval shortens per card down to a floor,
// which is the real swarm lever. Only the few fort tiles can spawn, so a tick can place at
// most that many enemies no matter how big the target gets.
const SPAWN_INTERVAL_BASE = 600;    // ms between top-ups at the start of a run
const SPAWN_INTERVAL_FLOOR = 175;   // fastest top-up once enough cards are in
const SPAWN_INTERVAL_PER_CARD = 25; // interval shortens this much per card taken
const SPAWN_TARGET_START = 6;       // target population before any cards
const SPAWN_TARGET_PER_CARD = 3;    // target grows this much per card, uncapped by design

const ARROW_SPEED = TILE_SIZE / 50; // travel speed in px/ms (one tile per 50ms)

// --- Level 3 necromancer AI tuning ---
const NECRO_SUMMON_RANGE = 12;            // tiles: a necromancer summons within this range
const NECRO_ATTACK_RANGE = 4;             // tiles: it paths to here, then casts
const NECRO_ATTACK_COOLDOWN_MS = 5000;
const NECRO_SUMMON_COOLDOWN_MS = 10000;   // measured from the FIRST summon, not minion death
const NECRO_ATTACK_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.ATTACK;
const NECRO_SUMMON_HOLD_MS = ANIM_FRAMES * ANIM_FRAME_MS.SUMMON;
const NECRO_PROJECTILE_RELEASE_MS = Math.round(NECRO_ATTACK_HOLD_MS * 0.6);
const NECRO_PROJECTILE_SPEED = (TILE_SIZE / DEFAULT_MOVE_DURATION_MS) * 0.75; // 75% of player move speed
const NECRO_PROJECTILE_RANGE = 9;         // cap in tiles on how far an orb can be aimed
const NECRO_PROJECTILE_SCALE = 0.8;       // orbs draw 20% smaller than their source art
const SUMMON_FADE_MS = 500;               // a summoned skeleton fades in over this

// --- Ultimate abilities (Space to activate; one per ranger) ---
const ULT_COOLDOWN_MS = 30000;          // gray invisibility cooldown (before per-kill reduction)
const ARROW_STORM_COOLDOWN_MS = 20000;  // green ranger's arrow storm (before per-kill reduction)
const BALLISTA_COOLDOWN_MS = 10000;      // crossbow turret cooldown
const BALLISTA_FAST_COOLDOWN_MS = 5000;  // crossbow's reduced cooldown once the Ballista Cooldown card is taken
const ULT_KILL_REDUCTION_MS = 500;       // each scoring kill charges invisibility / arrow storm this much faster
const BALLISTA_STAT_MULT = 0.75;        // turret runs at 75% of the ranger's live stats
const BALLISTA_MIN_HP = 3;              // turret health floor; only scales past this as the ranger's hearts grow
const INVIS_DURATION_MS = 5000;         // gray ranger's base invisibility (+1s per upgrade card)
const INVIS_ENEMY_SPEED_MULT = 0.25;    // enemies wander at 25% speed while invisibility is up
const BURST_RANGE_TILES = 4;            // green ranger's base burst reach (+1 tile per card)
const MAX_BALLISTAS = 3;                // crossbow: turret slot cap (1 base + 2 cards)
// Ballista turret art: only the first column of the sheet is used, a 4-frame fire cycle whose
// art points "up", rotated toward the target at draw time.
const BALLISTA_FRAME = 64;              // source frame size in dwarven_ballista.png
const BALLISTA_FIRE_FRAMES = 4;         // frames in the first column
const BALLISTA_DRAW = 32;               // drawn 32x32, centered on its 48px tile
const BALLISTA_FIRE_ANIM_MS = 55;       // per-frame time while a shot plays

const PLAYER_MOVE_DURATION_MS = DEFAULT_MOVE_DURATION_MS;
const PATH_SPEED_MULT  = 1.15;  // path tiles run faster
const GRASS_SPEED_MULT = 0.85;  // grass slower
// Diagonal steps take sqrt(2)x longer so per-axis speed stays constant.
const DIAG_DURATION_FACTOR = 1.414;

// speedScale = fraction of player speed on the same terrain. hpScale = multiples of
// DEFAULT_DAMAGE (so arrows-to-kill holds if the default changes). A type's tier is
// its position in LEVEL_TYPES; tier unlock timing lives in progression.js.
const KNIGHT_TYPES = {
  knight_one: {
    cell: KNIGHT_CELL,
    speedScale: 0.25,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 1,
  },
  knight_two: {
    cell: KNIGHT2_CELL,
    speedScale: 0.40,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 2,
  },
  knight_three: {
    cell: KNIGHT3_CELL,
    speedScale: 0.60,
    attackWindupMs: 1000,
    damage: 1,
    hpScale: 3,
  },
};
// Troll enemy types for level 2. Same shape as the knights, mirroring the matching
// knight's speed, damage, and attack windup, with their own health (hpScale x
// DEFAULT_DAMAGE gives troll1=8, troll2=10, troll3=12 HP). Tier unlock timing is
// per cycle/level in progression.js.
const TROLL_TYPES = {
  troll_one:   { cell: TROLL_CELL,  speedScale: 0.25, attackWindupMs: 1000, damage: 1, hpScale: 4 },
  troll_two:   { cell: TROLL2_CELL, speedScale: 0.40, attackWindupMs: 1000, damage: 1, hpScale: 5 },
  troll_three: { cell: TROLL3_CELL, speedScale: 0.60, attackWindupMs: 1000, damage: 1, hpScale: 6 },
};
// Level 3 necromancers. Ranged summoners, not melee: they path to ~4 tiles from the player
// and fire slow, non-homing fireballs, and they summon a matching skeleton minion. hpScale
// continues the per-level pattern (knights 1-3, trolls 4-6, necromancers 7-9). Each
// necromancer's minion shares its health (skeleton_* hpScale matches). kind drives the AI
// branch, skeleton = the summoned minion type (skeleton_three floats over water).
const NECRO_TYPES = {
  necro_one:   { cell: NECRO_CELL,  kind: "necro", skeleton: "skeleton_one",   projectile: "necro1Fire", speedScale: 0.125, damage: 1, hpScale: 7 },
  necro_two:   { cell: NECRO2_CELL, kind: "necro", skeleton: "skeleton_two",   projectile: "necro2Fire", speedScale: 0.20, damage: 1, hpScale: 8 },
  necro_three: { cell: NECRO3_CELL, kind: "necro", skeleton: "skeleton_three", projectile: "necro3Fire", speedScale: 0.30, damage: 1, hpScale: 9 },
};
// Skeleton minions: melee chasers like knights/trolls (summoned, never spawned from forts).
// hpScale matches the summoning necromancer. skeleton_three floats over water (floats: true).
const SKELETON_TYPES = {
  skeleton_one:   { cell: SKEL_CELL,  kind: "skeleton", speedScale: 0.25, attackWindupMs: 1000, damage: 1, hpScale: 7, floats: false },
  skeleton_two:   { cell: SKEL2_CELL, kind: "skeleton", speedScale: 0.40, attackWindupMs: 1000, damage: 1, hpScale: 8, floats: false },
  skeleton_three: { cell: SKEL3_CELL, kind: "skeleton", speedScale: 0.60, attackWindupMs: 1000, damage: 1, hpScale: 9, floats: true },
};
// Every enemy across all levels, keyed by type, so lookups (HP, cell, step timing)
// don't care which level spawned it.
const ALL_TYPES = { ...KNIGHT_TYPES, ...TROLL_TYPES, ...NECRO_TYPES, ...SKELETON_TYPES };
// Each level uses its own enemy types and spawn points. Add a level's entry here (and a
// levelSpawns branch) when you add one. Only spawn-from-fort types are listed, skeletons
// are summoned, not listed here.
const LEVEL_TYPES = {
  1: ["knight_one", "knight_two", "knight_three"],
  2: ["troll_one", "troll_two", "troll_three"],
  3: ["necro_one", "necro_two", "necro_three"],
};
// XP toward the next card per scoring kill. A tier-n enemy is worth n (its 1-based
// position in its level's list), and the kill counter still counts every kill as 1.
const CARD_XP_BY_TYPE = {};
for (const types of Object.values(LEVEL_TYPES)) {
  types.forEach((key, i) => { CARD_XP_BY_TYPE[key] = i + 1; });
}
function levelTypes() { return LEVEL_TYPES[level] || LEVEL_TYPES[1]; }
function levelSpawns() {
  if (level === 3) return l3Spawns();               // sewer: wall portals + floor grates (per run)
  if (level === 2) return L2_SPAWNS.map(([x, y]) => ({ x, y }));
  return SPAWN_POINTS;
}
// Upgrade cards taken within the current level. Enemy-type unlocks are per-level (they
// subtract the cards taken in earlier levels), while the buff stats carry over.
function levelCards() { return Math.max(0, buffsAwarded - levelCardBaseline); }
// Enemy HP in damage points: base (hpScale x default arrow damage) plus the per-cycle bump.
function enemyHp(typeKey) {
  return ALL_TYPES[typeKey].hpScale * DEFAULT_DAMAGE + cycle * CYCLE_HP_STEP;
}
// A type is available once enough cards have been taken this level for its tier
// (its position in the level's type list). The timing lives in progression.js.
function spawnWeight(typeKey) {
  const tier = levelTypes().indexOf(typeKey);
  return levelCards() >= tierUnlocks(cycle, level)[tier] ? 1 : 0;
}
// Effective speed fraction for a type this cycle: base speedScale plus the per-cycle bump.
function enemySpeedScale(typeKey) {
  return ALL_TYPES[typeKey].speedScale + cycle * CYCLE_SPEED_STEP;
}
function enemyStepDuration(typeKey, x, y) {
  return Math.round((DEFAULT_MOVE_DURATION_MS / cellSpeedMult(x, y)) / enemySpeedScale(typeKey));
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
const WORLD_W = MAP_COLS * TILE_SIZE;   // fixed world the game renders in (1536 x 768)
const WORLD_H = MAP_ROWS * TILE_SIZE;
canvas.width = WORLD_W;
canvas.height = WORLD_H;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// Fit the game to the viewport. The play area is sized to on-screen pixels and the canvas buffer
// to the true device resolution, so render() draws at native res (ctx scaled by renderScale) with
// no post-scaling of the frame, which keeps motion smooth. Menu overlays sit in a separate
// 1536x768 layer that is CSS-scaled to match, and mouse mapping reads getBoundingClientRect.
const stageEl = document.querySelector(".stage");
const playAreaEl = document.querySelector(".play-area");
const overlayScaleEl = document.querySelector(".overlay-scale");
let renderScale = 1; // buffer pixels per world pixel
function fitApp() {
  if (!stageEl || !playAreaEl) return;
  const measure = () => {
    const cs = getComputedStyle(stageEl);
    const availW = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.min(availW / WORLD_W, availH / WORLD_H);
  };
  // Scale the top and bottom HUD bars proportionally with the game via the --ui-scale CSS
  // zoom, then re-measure so the canvas fills the vertical space the smaller bars free up.
  const uiScale = Math.max(0.5, Math.min(1, measure()));
  document.documentElement.style.setProperty("--ui-scale", String(uiScale));
  const s = measure();
  const dispW = Math.round(WORLD_W * s), dispH = Math.round(WORLD_H * s);
  playAreaEl.style.width = dispW + "px";
  playAreaEl.style.height = dispH + "px";
  if (overlayScaleEl) overlayScaleEl.style.transform = `scale(${dispW / WORLD_W})`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(dispW * dpr)), bh = Math.max(1, Math.round(dispH * dpr));
  canvas.style.width = dispW + "px";
  canvas.style.height = dispH + "px";
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  renderScale = bw / WORLD_W;
  playAreaEl.style.visibility = "visible"; // sized now, safe to show (CSS hides it pre-fit)
}
// Resizing the buffer clears it, and the loop only paints during live play, so a resize must
// repaint whatever static frame is on screen. Re-rendering with the last painted timestamp
// reproduces it exactly, keeping the frozen world visible behind the card screen and game-over
// overlay. Before the first game there is no world to show, so the opening menu paints dark.
let everStarted = false; // set once the first game begins
function onViewportResize() {
  fitApp();
  if (state.paused) { renderPauseScreen(); return; }
  if (!state.running || state.choosingBuff) {
    if (everStarted) render(lastRenderAt);
    else paintMenuBackdrop();
  }
}
window.addEventListener("resize", onViewportResize);
window.addEventListener("load", onViewportResize);
fitApp();

// The world-to-buffer scale, re-applied at the top of every frame since a canvas resize
// resets all context state (transform, imageSmoothingEnabled).
function applyWorldTransform() { ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0); }

// Fill the canvas with the dark menu backdrop, used behind the opening menu where there is no
// game world to show yet. Matches the overlay tint so the whole panel reads as one dark field.
function paintMenuBackdrop() {
  applyWorldTransform();
  ctx.fillStyle = "#0c0d10";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayButton = document.getElementById("overlay-button");

const DAMAGE_FLASH_MS = 900;
let damageFlashUntil = 0;

// After a non-fatal hit the ranger is invulnerable and blinks for this long, and can
// walk through enemies (but not walls, water, rocks or trees) while it lasts.
const INVULN_MS = 3000;
let invulnUntil = 0;

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

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Level configuration.
// START_LEVEL: which level a run boots into. 1 = normal play (start on level 1, the fade
// transition then carries you to later levels). Set to 2, 3, ... to jump straight into a
// level for design work, skipping the earlier ones and the transition.
// To ADD a level to the loop: bump LEVEL_COUNT, add its enemy types to LEVEL_TYPES and
// spawn points to levelSpawns(), add its map to setupLevelMap(), and add a music playlist
// for it in audio.js (playGameMusic).
// ---------------------------------------------------------------------------
const GOD_MODE = false;                 // testing helper: start with all upgrade cards maxed and take no damage.
const START_LEVEL = 1;                 // 1 = normal play (loop through 1 -> 2 -> 3). Set to 2/3 to jump into a level for design work.
const LEVEL_COUNT = 3;                 // distinct levels in the loop (1 = grass, 2 = cave, 3 = sewer)
// The run loops forever: level 1 -> 2 -> 3 -> 1 -> 2 -> 3 ... Every time it wraps back to level 1 a
// new, harder cycle begins. Enemies gain a flat HP bump and a flat speed bump per cycle
// (cycle 0 = base stats), so each pass through the same level is tougher than the last.
const CYCLE_HP_STEP = 10;
const CYCLE_SPEED_STEP = 0.05;
// Card pacing (XP per card, cards per level) lives in progression.js, which
// SpawnModel.java mirrors. The next card's cost depends only on the run total taken.
function xpForNextCard() { return xpForCard(buffsAwarded + 1); }

// Which level is active (1 = grass/knights, 2 = cave/trolls, 3 = sewer/necromancers),
// how many full loops have been completed, and the buff count when the level began (so
// per-level card unlocks reset while buffs still carry over).
let level = 1;
let cycle = 0;
let levelCardBaseline = 0;
let cardXp = 0;                // weighted card progress: tier 1/2/3 kills give 1/2/3 XP

// A fresh idle player on the center tile. Used at module init, run start, and on
// entering a level.
function freshPlayer(now) {
  return {
    x: PLAYER_START_X, y: PLAYER_START_Y, facing: "right",
    moving: false, moveStartAt: 0, moveDuration: 0,
    fromX: PLAYER_START_X, fromY: PLAYER_START_Y, toX: PLAYER_START_X, toY: PLAYER_START_Y,
    anim: "IDLE", animStart: now, dying: false, deathStart: 0,
  };
}

const state = {
  running: false,
  paused: false,
  choosingBuff: false,
  transitioning: false,
  startedAt: 0,
  kills: 0,
  maxLives: DEFAULT_HEALTH,
  lives: DEFAULT_HEALTH,
  player: freshPlayer(0),
  enemies: [],
  projectiles: [],
  enemyProjectiles: [],
  tileMap: buildStartingMap(),
  lastSpawnAt: 0,
};

// ---------------------------------------------------------------------------
// Level-aware tile queries. Level 1 reads the mapgen tileMap, level 2 the cave grid
// (level2.js), and level 3 the sewer grid (level3.js). Movement, projectiles,
// pathfinding and rendering all go through these so the rest of the game doesn't
// branch on the level.
// ---------------------------------------------------------------------------
function cellSolid(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  if (level === 3) return l3Solid(x, y);
  if (level === 2) return l2Solid(x, y);
  return isSolid(state.tileMap[y][x]) || isFortAt(x, y);
}
function cellBlocksProjectile(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  if (level === 3) return l3BlocksProjectile(x, y);
  if (level === 2) return l2BlocksProjectile(x, y);
  return blocksProjectile(state.tileMap[y][x]) || isFortAt(x, y);
}
// Shared by player and enemies so enemy speedScale stays a true fraction of player
// speed on the same terrain. Otherwise enemies outpace a grass-slowed player.
function cellSpeedMult(x, y) {
  if (level === 3) return l3SpeedMult(x, y);
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
// Flips once loadSprites resolves, so the level 1 background bake knows whether
// it painted real sprites or the pre-load fallback colors.
let spritesReady = false;

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

// Draws into `g`, not the main ctx, so the same code paints the baked background.
function drawSprite(g, srcDef, dx, dy, dw, dh) {
  if (!srcDef) return;
  const sheet = sprites[srcDef.sheet];
  if (!sheet) return;
  g.drawImage(sheet, srcDef.x, srcDef.y, srcDef.w, srcDef.h, dx, dy, dw, dh);
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
let lastOmniFireAt = 0;
// Ultimate ability state (Space). ultReadyAt drives the gray + green cooldown; the crossbow's
// turrets run their own lifecycle (up to MAX_BALLISTAS slots, each recharging one at a time).
let ultReadyAt = 0;                 // gray/green: time the ultimate comes off cooldown
let ultCastAt = -ULT_COOLDOWN_MS;   // time the current gray/green cooldown started
let invisUntil = 0;                 // gray: invisibility is active until this time
let ballistas = [];                 // crossbow: the deployed turrets
const ballistaQueue = createChargeQueue(); // crossbow: dead turret slots recharging
const stormQueue = createChargeQueue();    // green: spent arrow-storm charges recharging
let stormKillInProgress = false;    // true while an arrow-storm volley deals its kills (they don't recharge it)
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

  if (state.choosingBuff) {
    // Keep tracking held movement keys so a key pressed during the card screen still
    // moves after it closes. The buff hotkeys live in their own listener in buffs.js.
    if (MOVE_KEYS[event.code]) heldMoveKeys.add(MOVE_KEYS[event.code]);
    event.preventDefault();
    return;
  }

  // We track held state ourselves, so OS auto-repeat is redundant. This must run
  // before the Escape branch, or holding Escape rapid-toggles pause on auto-repeat.
  if (event.repeat) { event.preventDefault(); return; }

  // Escape toggles pause during a run.
  if (event.code === "Escape") {
    if (state.running) {
      togglePause();
      event.preventDefault();
    }
    return;
  }

  if (!state.running || state.paused) return;

  // Space fires the selected ranger's ultimate.
  if (event.code === "Space") {
    activateUltimate(performance.now());
    event.preventDefault();
    return;
  }

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
  mouseX = (event.clientX - rect.left) * (WORLD_W / rect.width);
  mouseY = (event.clientY - rect.top) * (WORLD_H / rect.height);
}

// The player's authoritative tile (destination of any in-flight move).
function playerTile() {
  const p = state.player;
  return { x: p.moving ? p.toX : p.x, y: p.moving ? p.toY : p.y };
}

// The player's authoritative pixel center (destination of any in-flight move).
function playerCenterPx() {
  const t = playerTile();
  return { x: t.x * TILE_SIZE + TILE_SIZE / 2, y: t.y * TILE_SIZE + TILE_SIZE / 2 };
}

// The player's interpolated pixel center mid-move, mirroring enemyCenterPx (how arrow-vs-enemy
// collision works), so enemy fireballs hit where the ranger is drawn, not its destination tile.
function playerCenterPxAt(now) {
  const p = state.player;
  let cx = p.x, cy = p.y;
  if (p.moving) {
    const dur = p.moveDuration || PLAYER_MOVE_DURATION_MS;
    const t = Math.max(0, Math.min(1, (now - p.moveStartAt) / dur));
    cx = lerp(p.fromX, p.toX, t);
    cy = lerp(p.fromY, p.toY, t);
  }
  return { x: (cx + 0.5) * TILE_SIZE, y: (cy + 0.5) * TILE_SIZE };
}

// Exact angle (radians) from the player to the cursor, for free-aim shots.
function aimAngle() {
  if (mouseX === null) return state.player.facing === "left" ? Math.PI : 0;
  const c = playerCenterPx();
  return Math.atan2(mouseY - c.y, mouseX - c.x);
}

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
  invulnUntil += delta;
  lastArrowFiredAt += delta;
  lastOmniFireAt += delta;
  ultReadyAt += delta;
  ultCastAt += delta;
  invisUntil += delta;
  shiftQueue(ballistaQueue, delta);
  shiftQueue(stormQueue, delta);
  for (const b of ballistas) { b.lastFireAt += delta; b.fireStart += delta; }
  if (pendingShot) pendingShot.releaseAt += delta;
  for (const e of state.enemies) {
    e.moveStartAt += delta;
    e.animStart += delta;
    e.deathStart += delta;
    e.attackStart += delta;
    e.hurtUntil += delta;
    e.summonStart += delta;
    e.lastAttackAt += delta;
    if (e.lastSummonAt !== null) e.lastSummonAt += delta;
    if (e.spawnFadeUntil) e.spawnFadeUntil += delta;
  }
  for (const pr of state.projectiles) pr.lastStepAt += delta;
  for (const pr of state.enemyProjectiles) pr.lastStepAt += delta;
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
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "bold 78px ui-monospace, Menlo, monospace";
  ctx.fillText("PAUSE", WORLD_W / 2, WORLD_H / 2 - 24);
  ctx.fillStyle = "#7d8088";
  ctx.font = "33px ui-monospace, Menlo, monospace";
  ctx.fillText("Press ESC to continue", WORLD_W / 2, WORLD_H / 2 + 45);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Upgrade cards live in buffs.js. This handle hands them the hooks a buff pause
// needs from the game: the shared state, timer shifting, and the loop resume.
// Held input is NOT cleared for the card screen. The window-level keyup/mouseup
// listeners keep the held flags accurate while the overlay is up, so a button or
// key held across it resumes firing or moving the instant play does.
// ---------------------------------------------------------------------------
const buffGame = {
  state,
  shiftTimers,
  resume: () => requestAnimationFrame(loop),
  get ranger() { return selectedRanger; }, // buffs.js filters ranger-specific cards on this
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
  if (isEnemyAt(nx, ny) && !playerPhasing(performance.now())) return false;
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

// Single source for the player-arrow shape, shared by manual shots, omni volleys,
// storm visuals, and ballista arrows. Overrides carry the caller's extras (visual
// flag, ballista dmg/pierce/range), so the three call sites can't drift apart.
function makeArrow(px, py, angle, now, overrides = {}) {
  return {
    px, py,
    vx: Math.cos(angle) * ARROW_SPEED,
    vy: Math.sin(angle) * ARROW_SPEED,
    angle,
    traveled: 0,
    lastStepAt: now,
    hitEnemies: new Set(),
    ...overrides,
  };
}

// Spawn one ordinary arrow per angle from the center of the player's authoritative
// tile (destination of any move). Shared by manual shots and omni volleys.
function spawnArrows(angles, now) {
  const t = playerTile();
  const px = (t.x + 0.5) * TILE_SIZE;
  const py = (t.y + 0.5) * TILE_SIZE;
  for (const a of angles) {
    state.projectiles.push(makeArrow(px, py, a, now));
  }
  playSfx("bow", 10);
}

function releasePendingShot(now) {
  if (!pendingShot || now < pendingShot.releaseAt) return;
  const { angle } = pendingShot;
  pendingShot = null;
  // Manual fire is a single arrow, or a 3-arrow fan 10 degrees either side of the aim
  // with Multi-Shot. Omni-Shot is a separate automatic volley (see maybeFireOmni).
  const angles = playerMultiShot
    ? [angle, angle - Math.PI / 18, angle + Math.PI / 18]
    : [angle];
  spawnArrows(angles, now);
}

// Omni-Shot: once taken, an automatic 8-direction volley fires on its own timer,
// independent of manual shooting. Higher levels fire it faster. The arrows are ordinary
// arrows, so they scale with damage, piercing and distance cards (never with fire rate).
const OMNI_INTERVAL_MS = [0, 8000, 7000, 5000]; // milliseconds between volleys, indexed by omniLevel

function maybeFireOmni(now) {
  if (omniLevel <= 0) return;
  if (now - lastOmniFireAt < OMNI_INTERVAL_MS[omniLevel]) return;
  lastOmniFireAt = now;
  spawnArrows(Array.from({ length: 8 }, (_, i) => i * Math.PI / 4), now);
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
    if (p.traveled >= (p.range ?? playerArrowRange) * TILE_SIZE) continue;
    remaining.push(p);
  }
  state.projectiles = remaining;
}

// ---------------------------------------------------------------------------
// Ultimate abilities (Space). One per ranger: gray = invisibility, crossbow = ballista
// turrets, green = an arrow burst. Ranger-specific upgrade cards (buffs.js) scale each.
// ---------------------------------------------------------------------------

const INVIS_MAX_BONUS_SEC = 3;
const BURST_MAX_BONUS_TILES = 3;
function invisDurationMs() { return INVIS_DURATION_MS + Math.min(INVIS_MAX_BONUS_SEC, invisBonusSec) * 1000; }
function burstRangeTiles() { return BURST_RANGE_TILES + Math.min(BURST_MAX_BONUS_TILES, burstBonusTiles); }
function arrowStormCharges() { return Math.min(3, 1 + burstBonusTiles); } // every copy adds a charge, capped at 3
function stormReadyCharges() { return arrowStormCharges() - stormQueue.charging; }
function ballistaSlots() { return Math.min(MAX_BALLISTAS, 1 + ballistaBonus); }
function ballistaCooldownMs() { return ballistaFastCd ? BALLISTA_FAST_COOLDOWN_MS : BALLISTA_COOLDOWN_MS; }
// Slots free to deploy right now: total slots minus the live turrets and those recharging.
function readyBallistaSlots() { return ballistaSlots() - ballistas.length - ballistaQueue.charging; }

function ultimateReady(now) {
  if (selectedRanger === 1) return readyBallistaSlots() > 0; // crossbow: any free slot
  if (selectedRanger === 2) return stormReadyCharges() > 0;  // green: any ready charge
  return now >= ultReadyAt;
}

// The HUD dial(s) for the active ranger. Gray/green return one circle; the crossbow returns
// one per slot: full = ready, partial = the single recharging slot, empty = deployed/queued.
function ultimateCircles(now) {
  if (selectedRanger === 1) {
    const slots = ballistaSlots();
    const circles = queueCircles(ballistaQueue, now, Math.max(0, readyBallistaSlots()), ballistaCooldownMs());
    while (circles.length < slots) circles.push({ fraction: 0, ready: false }); // deployed slots
    return circles.slice(0, slots);
  }
  if (selectedRanger === 2) {
    return queueCircles(stormQueue, now, Math.max(0, stormReadyCharges()), ARROW_STORM_COOLDOWN_MS)
        .slice(0, arrowStormCharges());
  }
  // Gray. While invisible the cooldown hasn't started, so clamp the dial to empty (never negative).
  if (now >= ultReadyAt) return [{ fraction: 1, ready: true }];
  return [{ fraction: Math.max(0, 1 - (ultReadyAt - now) / ULT_COOLDOWN_MS), ready: false }];
}

function activateUltimate(now) {
  if (!state.running || state.paused || state.choosingBuff || state.transitioning || state.player.dying) return;
  if (!ultimateReady(now)) return;
  if (selectedRanger === 0) activateInvisibility(now);
  else if (selectedRanger === 1) deployBallista(now);
  else activateArrowBurst(now);
}

// Gray ranger: vanish for 5s (+1s per card). Enemies stop pathing and wander (stepEnemies),
// the ranger takes no damage and phases through enemies, and renders at half opacity.
function activateInvisibility(now) {
  invisUntil = now + invisDurationMs();
  ultCastAt = now;
  ultReadyAt = invisUntil + ULT_COOLDOWN_MS; // cooldown starts only once invisibility wears off
  for (const e of state.enemies) { e.attacking = false; e.summoning = false; } // nothing lands as you vanish
}

// Crossbow ranger: drop a turret. It runs at 75% of the ranger's live upgraded stats and takes
// no i-frames, so several enemies landing together can cleave it. Its slot only starts
// recharging when it dies. Turrets never stack: an occupied tile picks the nearest free one.
function deployBallista(now) {
  if (readyBallistaSlots() <= 0) return;
  const spot = findBallistaTile(playerTile());
  if (!spot) return;
  const hp = Math.max(BALLISTA_MIN_HP, Math.round(BALLISTA_STAT_MULT * state.maxLives)); // 75% of hearts, floor 3
  ballistas.push({ x: spot.x, y: spot.y, hp, maxHp: hp, angle: -Math.PI / 2, lastFireAt: -1e9, firing: false, fireStart: 0 });
  invalidateBallistaFields();
}

function isFreeForBallista(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return false;
  if (cellSolid(x, y)) return false;
  for (const b of ballistas) if (b.x === x && b.y === y) return false;
  // The tile must also be routable from the player's tile, or the turret lands in a
  // sealed pocket where enemies can never attack it and every enemy that targets it
  // stalls on a field with no route. The player always stands on the walkable
  // network, so a finite distance to them means grounded enemies can reach the tile.
  // ballistaFieldAt caches the field, and a real deploy clears the cache anyway.
  const pt = playerTile();
  if (x === pt.x && y === pt.y) return true; // the player's own tile is trivially routable
  return ballistaFieldAt(x, y)[pt.y * MAP_COLS + pt.x] >= 0;
}
// The player's tile if free, otherwise the nearest free tile spiralling outward.
function findBallistaTile(t) {
  if (isFreeForBallista(t.x, t.y)) return { x: t.x, y: t.y };
  for (let r = 1; r < Math.max(MAP_COLS, MAP_ROWS); r++) {
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev radius r
        const nx = t.x + dx, ny = t.y + dy;
        if (!isFreeForBallista(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Green ranger: one arrow to every living enemy within range it can see, at double the
// ranger's current damage. A single bow twang plays for the whole volley.
function activateArrowBurst(now) {
  if (stormReadyCharges() <= 0) return;
  joinQueue(stormQueue, now, ARROW_STORM_COOLDOWN_MS); // this charge starts recharging
  const reach = burstRangeTiles();
  const t = playerTile();
  const px = (t.x + 0.5) * TILE_SIZE, py = (t.y + 0.5) * TILE_SIZE;
  stormKillInProgress = true; // kills dealt by this volley must not recharge the ult
  for (const enemy of state.enemies) {
    if (enemy.dying) continue;
    if (Math.hypot(enemy.x - t.x, enemy.y - t.y) > reach) continue;
    if (!hasLineOfSight(t.x, t.y, enemy.x, enemy.y)) continue;
    const c = enemyCenterPx(enemy, now);
    const ang = Math.atan2(c.y - py, c.x - px);
    // A visual-only arrow (skipped by resolveCollisions) plus a direct, guaranteed hit.
    state.projectiles.push(makeArrow(px, py, ang, now, { visual: true }));
    damageEnemy(enemy, now, playerDamage * 2);
  }
  stormKillInProgress = false;
  playSfx("bow", 10);
}

// True if no projectile-blocking tile sits between two tiles (endpoints excluded).
function hasLineOfSight(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1) && cellBlocksProjectile(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// The turret nearest an enemy (by tile distance), or null when none are deployed.
function nearestBallista(enemy) {
  let best = null, bestD = Infinity;
  for (const b of ballistas) {
    const d = Math.hypot(enemy.x - b.x, enemy.y - b.y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best ? { x: best.x, y: best.y, d: bestD } : null;
}
// What an enemy is going for: the player, or the nearest ballista when it is the closer of
// the two. isBallista tells callers which one to damage.
function enemyTarget(enemy) {
  const p = playerTile();
  const nb = nearestBallista(enemy);
  if (!nb) return { x: p.x, y: p.y, isBallista: false };
  const dP = Math.hypot(enemy.x - p.x, enemy.y - p.y);
  return nb.d < dP ? { x: nb.x, y: nb.y, isBallista: true } : { x: p.x, y: p.y, isBallista: false };
}

// Wander step used by every enemy while the gray ranger is invisible: a random open neighbor
// at 25% speed, no attacking.
const WANDER_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function wanderStep(enemy, now) {
  const type = ALL_TYPES[enemy.type];
  enemy.attacking = false; enemy.summoning = false;
  if (enemy.moving) {
    if (now - enemy.moveStartAt < enemy.moveDuration) return;
    enemy.x = enemy.toX; enemy.y = enemy.toY; enemy.moving = false;
  }
  const floats = type.floats === true;
  const solid = floats ? floaterSolid : cellSolid;
  const dirs = WANDER_DIRS.slice();
  shuffleInPlace(dirs);
  for (const [dx, dy] of dirs) {
    const nx = enemy.x + dx, ny = enemy.y + dy;
    if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
    if (solid(nx, ny)) continue;
    if (dx !== 0 && dy !== 0 && (solid(enemy.x + dx, enemy.y) || solid(enemy.x, enemy.y + dy))) continue;
    enemy.fromX = enemy.x; enemy.fromY = enemy.y; enemy.toX = nx; enemy.toY = ny;
    if (nx > enemy.x) enemy.facing = "right"; else if (nx < enemy.x) enemy.facing = "left";
    let dur = enemyStepDuration(enemy.type, nx, ny) / INVIS_ENEMY_SPEED_MULT;
    if (dx !== 0 && dy !== 0) dur = Math.round(dur * DIAG_DURATION_FACTOR);
    enemy.moveDuration = dur; enemy.moveStartAt = now; enemy.moving = true;
    return;
  }
}

// Step every turret: aim at the nearest visible enemy in range and fire 75%-stat arrows.
function stepBallistas(now) {
  if (!ballistas.length) return;
  const range = playerArrowRange * BALLISTA_STAT_MULT;
  for (const b of ballistas) {
    let target = null, bestD = Infinity;
    for (const e of state.enemies) {
      if (e.dying) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d <= range && d < bestD && hasLineOfSight(b.x, b.y, e.x, e.y)) { bestD = d; target = e; }
    }
    if (!target) { b.firing = false; continue; }
    const c = enemyCenterPx(target, now);
    const bx = (b.x + 0.5) * TILE_SIZE, by = (b.y + 0.5) * TILE_SIZE;
    b.angle = Math.atan2(c.y - by, c.x - bx);
    if (now - b.lastFireAt >= DEFAULT_ATTACK_INTERVAL_MS / (fireRateMult * BALLISTA_STAT_MULT)) {
      b.lastFireAt = now; b.firing = true; b.fireStart = now;
      state.projectiles.push(makeArrow(bx, by, b.angle, now, {
        dmg: playerDamage * BALLISTA_STAT_MULT, pierce: Math.floor(playerPierce * BALLISTA_STAT_MULT), range,
      }));
      playSfx("bow", 10);
    }
    if (b.firing && now - b.fireStart >= BALLISTA_FIRE_FRAMES * BALLISTA_FIRE_ANIM_MS) b.firing = false;
  }
}

function damageBallistaAt(bx, by, dmg, now) {
  const b = ballistas.find((t) => t.x === bx && t.y === by);
  if (!b) return;
  b.hp -= dmg;
  if (b.hp <= 0) killBallista(b, now);
}
function killBallista(b, now) {
  const i = ballistas.indexOf(b);
  if (i >= 0) ballistas.splice(i, 1);
  joinQueue(ballistaQueue, now, ballistaCooldownMs()); // slot joins the recharge queue
  invalidateBallistaFields();
}

// Per-turret grounded + floating flow fields, keyed by the turret's tile (turrets are static
// and few, so a small cache is plenty). Cleared when the map changes or a turret set changes.
let ballistaFields = new Map();
let ballistaFloatFields = new Map();
let ballistaFieldsMap = null;
function invalidateBallistaFields() { ballistaFields.clear(); ballistaFloatFields.clear(); }
function ballistaFieldsCheckMap() {
  const mapRef = level === 3 ? l3Grid() : level === 2 ? l2Grid() : state.tileMap;
  if (ballistaFieldsMap !== mapRef) { ballistaFields.clear(); ballistaFloatFields.clear(); ballistaFieldsMap = mapRef; }
}
function ballistaFieldAt(bx, by) {
  ballistaFieldsCheckMap();
  const key = bx + "," + by;
  let f = ballistaFields.get(key);
  if (!f) {
    const cost = (x, y) => 1 / cellSpeedMult(x, y);
    if (level === 3) f = buildFlowField(bx, by, null, (x, y) => l3Solid(x, y), cost);
    else if (level === 2) f = buildFlowField(bx, by, null, (x, y) => l2Solid(x, y), cost);
    else f = buildFlowField(bx, by, state.tileMap, null, cost);
    ballistaFields.set(key, f);
  }
  return f;
}
function ballistaFloatFieldAt(bx, by) {
  ballistaFieldsCheckMap();
  const key = bx + "," + by;
  let f = ballistaFloatFields.get(key);
  if (!f) {
    const cost = (x, y) => 1 / cellSpeedMult(x, y);
    f = buildFlowField(bx, by, null, (x, y) => floaterSolid(x, y), cost);
    ballistaFloatFields.set(key, f);
  }
  return f;
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
  const mapRef = level === 3 ? l3Grid() : level === 2 ? l2Grid() : state.tileMap;
  if (flowField === null || goalX !== flowGoalX || goalY !== flowGoalY || flowMap !== mapRef) {
    // Terrain cost = inverse of how fast the tile is walked, so cheaper (faster) path
    // tiles pull routes toward themselves even when the detour is a little longer.
    const cost = (x, y) => 1 / cellSpeedMult(x, y);
    if (level === 3) flowField = buildFlowField(goalX, goalY, null, (x, y) => l3Solid(x, y), cost);
    else if (level === 2) flowField = buildFlowField(goalX, goalY, null, (x, y) => l2Solid(x, y), cost);
    else flowField = buildFlowField(goalX, goalY, state.tileMap, null, cost);
    flowGoalX = goalX;
    flowGoalY = goalY;
    flowMap = mapRef;
  }
  return flowField;
}

// Performance safety cap, raised each cycle so later runs can still swarm.
function maxEnemies() { return MAX_ENEMIES_BASE + MAX_ENEMIES_PER_CYCLE * cycle; }
// Clamped only by the performance cap, so difficulty climbs forever with progress.
function targetEnemyCount() {
  return Math.min(maxEnemies(), SPAWN_TARGET_START + SPAWN_TARGET_PER_CARD * spawnCards(buffsAwarded));
}
// The shrinking cadence is what lets the board reach the high late-game targets.
function spawnIntervalMs() {
  return Math.max(SPAWN_INTERVAL_FLOOR, SPAWN_INTERVAL_BASE - SPAWN_INTERVAL_PER_CARD * spawnCards(buffsAwarded));
}

// Single source for the enemy shape. Fort spawns and necromancer summons both build
// from here, so a new per-enemy field is added once, not kept in sync by hand.
function makeEnemy(typeKey, x, y, now, overrides = {}) {
  return {
    x,
    y,
    moving: false,
    moveStartAt: 0,
    moveDuration: 0,
    fromX: x,
    fromY: y,
    toX: x,
    toY: y,
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
    // Necromancer AI state (ignored by melee types).
    summonedMinion: null,
    lastSummonAt: null,
    lastAttackAt: -1e9,
    summoning: false,
    summonStart: 0,
    summonReleased: false,
    projReleased: false,
    spawnFadeUntil: 0,
    ...overrides,
  };
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
  state.enemies.push(makeEnemy(typeKey, fort.x, fort.y, now));
}

function maybeSpawnEnemy(now) {
  if (now - state.lastSpawnAt < spawnIntervalMs()) return;
  // Summoned skeletons don't count toward the target population, only fort-spawned enemies
  // do. They DO count against the performance cap, so the live total never passes it.
  const room = maxEnemies() - state.enemies.length;
  if (room <= 0) return;
  const forted = state.enemies.reduce((n, e) => n + (ALL_TYPES[e.type].kind === "skeleton" ? 0 : 1), 0);
  const deficit = targetEnemyCount() - forted;
  if (deficit <= 0) return;
  // Spawn only on this level's points that no enemy occupies (never stack on a tile).
  // Also skip the player's tile. Level 2 portals and level 3 grates are walkable, and an
  // enemy must not materialize inside a player camping one.
  const pt = playerTile();
  const openForts = levelSpawns().filter((s) => !isEnemyAt(s.x, s.y) && !(s.x === pt.x && s.y === pt.y));
  if (openForts.length === 0) return;
  // Top up toward the target. The batch grows with cards (capped by the fort count anyway)
  // so a new level refills toward its high target quickly instead of easing in each time.
  // Shuffle so the batch uses distinct forts.
  const batch = 1 + Math.floor(spawnCards(buffsAwarded) / 2);
  const count = Math.min(deficit, room, openForts.length, batch);
  shuffleInPlace(openForts);
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
  const { x: goalX, y: goalY } = playerTile();
  const field = goalFlowField(goalX, goalY);
  const invisible = now < invisUntil;
  for (const enemy of state.enemies) {
    if (enemy.dying) continue;
    const type = ALL_TYPES[enemy.type];

    if (now < enemy.hurtUntil) {
      // Hold the in-progress move frozen at the hit point for the flinch, then let it resume.
      if (enemy.moving) enemy.moveStartAt = now - enemy.hurtMoveT * enemy.moveDuration;
      continue;
    }

    // Gray ranger's invisibility: every enemy stops hunting and wanders at 25% speed.
    if (invisible) { wanderStep(enemy, now); continue; }

    // Necromancers are ranged summoners with their own AI (no melee windup).
    if (type.kind === "necro") { stepNecro(enemy, now, goalX, goalY); continue; }

    // Melee chasers pick the closer of the player and the nearest ballista as their target.
    const tgt = enemyTarget(enemy);

    // Damage lands when the windup finishes, so the target can dodge out of range.
    if (enemy.attacking) {
      if (now - enemy.attackStart >= type.attackWindupMs) {
        enemy.attacking = false;
        if (enemy.attackTargetBallista) {
          if (enemyInAttackRange(enemy, enemy.attackBX, enemy.attackBY)) damageBallistaAt(enemy.attackBX, enemy.attackBY, type.damage, now);
        } else if (enemyInAttackRange(enemy, goalX, goalY)) {
          damagePlayer(now, type.damage);
        }
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

    if (enemyInAttackRange(enemy, tgt.x, tgt.y)) {
      enemy.attacking = true;
      enemy.attackStart = now;
      enemy.attackTargetBallista = tgt.isBallista;
      enemy.attackBX = tgt.x; enemy.attackBY = tgt.y;
      if (tgt.x > enemy.x) enemy.facing = "right";
      else if (tgt.x < enemy.x) enemy.facing = "left";
      continue;
    }
    // Floating skeletons path over water, grounded enemies use the normal field. Each uses the
    // field for its chosen target (player or a specific ballista tile).
    const floats = type.floats === true;
    let stepField;
    if (floats) stepField = tgt.isBallista ? ballistaFloatFieldAt(tgt.x, tgt.y) : goalFlowFieldFloat(goalX, goalY);
    else stepField = tgt.isBallista ? ballistaFieldAt(tgt.x, tgt.y) : field;
    const solidTest = floats ? floaterSolid : cellSolid;
    let next = nextStepFromField(stepField, enemy.x, enemy.y, solidTest);
    // A turret target with no route (it should never happen now that placement checks
    // reachability, but a map edit could reintroduce it) must not strand the enemy.
    // Fall back to chasing the player instead of standing still.
    if (next === null && tgt.isBallista) {
      next = nextStepFromField(floats ? goalFlowFieldFloat(goalX, goalY) : field, enemy.x, enemy.y, solidTest);
    }
    if (next === null) continue;
    enemy.fromX = enemy.x;
    enemy.fromY = enemy.y;
    enemy.toX = next.x;
    enemy.toY = next.y;
    if (next.x > enemy.x) enemy.facing = "right";
    else if (next.x < enemy.x) enemy.facing = "left";
    let dur = enemyStepDuration(enemy.type, next.x, next.y);
    if (next.x !== enemy.x && next.y !== enemy.y) dur = Math.round(dur * DIAG_DURATION_FACTOR);
    enemy.moveDuration = dur;
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

// While invulnerable the ranger phases through enemies (never through walls, water,
// rocks or trees, which cellSolid still blocks). If the window ends while the ranger is
// still stacked on an enemy, phasing persists until it reaches an enemy-free tile.
function playerPhasing(now) {
  if (now < invulnUntil || now < invisUntil) return true;
  const t = playerTile();
  return isEnemyAt(t.x, t.y);
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

function resolveCollisions(now) {
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
    if (p.visual) { surviving.push(p); continue; } // burst-effect arrows deal no collision damage
    let consumed = false;
    const pierce = p.pierce ?? playerPierce;
    for (const e of live) {
      if (e.enemy.dying) continue; // killed by an earlier arrow this frame
      const dx = p.px - e.cx;
      const dy = p.py - e.cy;
      if (dx * dx + dy * dy > r2) continue;
      if (p.hitEnemies.has(e.enemy)) continue;
      p.hitEnemies.add(e.enemy);
      damageEnemy(e.enemy, now, p.dmg ?? playerDamage);
      if (p.hitEnemies.size > pierce) { consumed = true; break; }
    }
    if (!consumed) surviving.push(p);
  }
  state.projectiles = surviving;
  // Player damage comes from enemy attack windups (stepEnemies), not contact.
}

// Apply one arrow's damage. A fatal hit starts the death and counts the kill.
// A non-fatal hit plays the flinch.
function damageEnemy(enemy, now, dmg = playerDamage) {
  enemy.hp -= dmg;
  if (enemy.hp <= 0) {
    // Freeze the death at the current (possibly mid-move) position so it doesn't
    // snap back to the tile it was leaving.
    const c = enemyCenterPx(enemy, now);
    enemy.deathX = c.x - TILE_SIZE / 2;
    enemy.deathY = c.y - TILE_SIZE / 2;
    enemy.dying = true;
    enemy.deathStart = now;
    enemy.moving = false;
    if (ALL_TYPES[enemy.type].kind !== "skeleton") {
      state.kills++; // only real enemies score, and every kill counts once here
      cardXp += CARD_XP_BY_TYPE[enemy.type] || 1; // card progress is tier-weighted
      // Each scoring kill charges the active ranger's ultimate 0.5s faster: invisibility only
      // while not vanished, arrow storm never from its own volley, the ballista stays fixed.
      if (selectedRanger === 0 && now >= invisUntil) ultReadyAt = Math.max(now, ultReadyAt - ULT_KILL_REDUCTION_MS);
      else if (selectedRanger === 2 && !stormKillInProgress) reduceQueue(stormQueue, now, ULT_KILL_REDUCTION_MS);
    }
  } else {
    // Non-fatal hit: pause the enemy in place for the flinch. Record how far into its current
    // move it had travelled so stepEnemies can hold the move frozen there for the flinch and
    // then let it finish, rather than snapping back to the tile it left or jumping to the next.
    if (now >= enemy.hurtUntil) { // first hit of a fresh flinch, not a re-hit mid-flinch
      enemy.hurtMoveT = enemy.moving
        ? Math.max(0, Math.min(1, (now - enemy.moveStartAt) / enemy.moveDuration))
        : 0;
    }
    enemy.hurtUntil = now + HURT_HOLD_MS;
    enemy.attacking = false;
  }
}

// Lose a heart. A non-fatal hit plays the hurt flinch. The last heart starts death.
function damagePlayer(now, dmg) {
  const p = state.player;
  if (p.dying) return;
  if (now < invulnUntil || now < invisUntil) return; // ignore hits during i-frames or invisibility
  if (!GOD_MODE) state.lives = Math.max(0, state.lives - dmg); // god mode: hurt fx play but no life is lost
  playSfx("hurt");
  damageFlashUntil = now + DAMAGE_FLASH_MS;
  if (state.lives <= 0) {
    startPlayerDeath(now);
  } else {
    playerHurtUntil = now + HURT_HOLD_MS;
    invulnUntil = now + INVULN_MS;
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
function drawTileRot(g, img, dx, dy, rotDeg) {
  if (!img) return;
  const half = TILE_SIZE / 2;
  g.save();
  g.translate(dx + half, dy + half);
  g.rotate(rotDeg * Math.PI / 180);
  g.drawImage(img, -half, -half, TILE_SIZE, TILE_SIZE);
  g.restore();
}

// Side/corner sprites rotated so the dark edge always faces into the map.
function drawMountainBorder(g, x, y) {
  const left = x === 0, right = x === MAP_COLS - 1;
  const top = y === 0, bottom = y === MAP_ROWS - 1;
  if ((left || right) && (top || bottom)) {
    const rot = top && left ? 0 : top && right ? 90 : bottom && right ? 180 : 270;
    drawTileRot(g, sprites.mountainCorner, x * TILE_SIZE, y * TILE_SIZE, rot);
  } else {
    const rot = left ? 0 : top ? 90 : right ? 180 : 270;
    drawTileRot(g, sprites.mountainSide, x * TILE_SIZE, y * TILE_SIZE, rot);
  }
}

function renderTiles(g) {
  g.imageSmoothingEnabled = false; // pixel art: nearest-neighbor
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const tileId = state.tileMap[y][x];
      if (!sprites.grass) {
        g.fillStyle = fallbackColor(tileId);
        g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        continue;
      }
      // Grass underlay everywhere, then the feature tile on top.
      drawSprite(g, SRC.GRASS, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (tileId === TILES.GRASS) continue;
      if (tileId === TILES.MOUNTAIN) { drawMountainBorder(g, x, y); continue; }
      drawSprite(g, tileSrc(tileId), x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

// The castle is taller than its tile, anchored to the tile's bottom edge so it
// overhangs upward.
const SPAWN_CASTLE_W = TILE_SIZE;
const SPAWN_CASTLE_H = 54;

function renderSpawnMarkers(g) {
  const castle = sprites.spawnCastle;
  if (castle) {
    const prevSmooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    const left0 = (TILE_SIZE - SPAWN_CASTLE_W) / 2;
    for (const p of SPAWN_POINTS) {
      const left = p.x * TILE_SIZE + left0;
      const bottom = (p.y + 1) * TILE_SIZE;
      g.drawImage(castle, 0, 0, castle.width, castle.height,
                  left, bottom - SPAWN_CASTLE_H, SPAWN_CASTLE_W, SPAWN_CASTLE_H);
    }
    g.imageSmoothingEnabled = prevSmooth;
  } else {
    g.fillStyle = "rgba(245, 185, 66, 0.18)";
    for (const p of SPAWN_POINTS) {
      g.fillRect(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

// ---------------------------------------------------------------------------
// Level 1 background baking. The tile map and spawn castles are static for the
// life of a map, so they are painted once to an offscreen canvas (mirroring
// level 2's cave background) and blitted each frame instead of issuing hundreds
// of per-tile draws. Rebaked when the tileMap reference changes (a new map) or
// when the sprites finish loading after a bake that used the fallback colors.
// ---------------------------------------------------------------------------
let l1Bg = null;
let l1BgMap = null;
let l1BgSpritesReady = false;

function level1Background() {
  if (l1Bg === null || l1BgMap !== state.tileMap || l1BgSpritesReady !== spritesReady) {
    const cv = document.createElement("canvas");
    cv.width = WORLD_W;
    cv.height = WORLD_H;
    const g = cv.getContext("2d");
    renderTiles(g);
    renderSpawnMarkers(g);
    l1Bg = cv;
    l1BgMap = state.tileMap;
    l1BgSpritesReady = spritesReady;
  }
  return l1Bg;
}

// 55/415 is the arrow sprite's native aspect ratio.
const ARROW_LEN = 36;
const ARROW_THICK = ARROW_LEN * (55 / 415);

function renderProjectiles() {
  ctx.imageSmoothingEnabled = true; // smooth the vector arrow
  const arrowSheet = sprites.arrow;
  // Skip an arrow still on the player's own tile so it doesn't flash a stub.
  const { x: ptx, y: pty } = playerTile();
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

// ---------------------------------------------------------------------------
// Necromancer AI + enemy projectiles (level 3)
// ---------------------------------------------------------------------------

// A floater (skeleton_three) treats only walls as solid, so it drifts over water.
function floaterSolid(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  if (level === 3) return l3BlocksProjectile(x, y);
  return cellSolid(x, y);
}
let flowFieldFloat = null, flowGoalFloatX = -1, flowGoalFloatY = -1, flowMapFloat = null;
function goalFlowFieldFloat(goalX, goalY) {
  const mapRef = level === 3 ? l3Grid() : state.tileMap;
  if (flowFieldFloat === null || goalX !== flowGoalFloatX || goalY !== flowGoalFloatY || flowMapFloat !== mapRef) {
    const cost = (x, y) => 1 / cellSpeedMult(x, y);
    flowFieldFloat = buildFlowField(goalX, goalY, null, (x, y) => floaterSolid(x, y), cost);
    flowGoalFloatX = goalX; flowGoalFloatY = goalY; flowMapFloat = mapRef;
  }
  return flowFieldFloat;
}

const tileDist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Spawn a matching skeleton minion next to the necromancer, fading in.
function summonSkeleton(necro, ntype, now) {
  // Re-check the cap at release. Fort spawns can fill the board during the 450ms cast
  // and several necromancers can cast at once, so the start-of-cast check alone can't
  // hold the ceiling. A whiffed summon retries on the normal cooldown.
  if (state.enemies.length >= maxEnemies()) {
    necro.lastSummonAt = now;
    return;
  }
  const skelKey = ntype.skeleton;
  const floats = ALL_TYPES[skelKey].floats === true;
  let sx = necro.x, sy = necro.y;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = necro.x + dx, ny = necro.y + dy;
    if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
    const blocked = floats ? floaterSolid(nx, ny) : cellSolid(nx, ny);
    if (blocked || isEnemyAt(nx, ny)) continue;
    sx = nx; sy = ny; break;
  }
  const skel = makeEnemy(skelKey, sx, sy, now, {
    facing: necro.facing,
    anim: "IDLE",
    spawnFadeUntil: now + SUMMON_FADE_MS,
  });
  state.enemies.push(skel);
  necro.summonedMinion = skel;
  necro.lastSummonAt = now;
}

// Fire a slow, non-homing orb toward where the player is right now (dodgeable).
function spawnNecroProjectile(enemy, type, now, aimTile) {
  const aimX = aimTile ? aimTile.x : playerTile().x;
  const aimY = aimTile ? aimTile.y : playerTile().y;
  const ex = (enemy.x + 0.5) * TILE_SIZE, ey = (enemy.y + 0.5) * TILE_SIZE;
  const tx = (aimX + 0.5) * TILE_SIZE, ty = (aimY + 0.5) * TILE_SIZE;
  const ang = Math.atan2(ty - ey, tx - ex);
  // The orb dies at the point it was aimed at, so standing on the aimed tile eats the
  // hit and stepping aside dodges it. The range cap still bounds a long shot.
  const maxTravel = Math.min(Math.hypot(tx - ex, ty - ey), NECRO_PROJECTILE_RANGE * TILE_SIZE);
  state.enemyProjectiles.push({
    px: ex, py: ey, vx: Math.cos(ang) * NECRO_PROJECTILE_SPEED, vy: Math.sin(ang) * NECRO_PROJECTILE_SPEED,
    angle: ang, traveled: 0, maxTravel, damage: type.damage, sprite: type.projectile, lastStepAt: now,
    targetBallista: !!aimTile, bx: aimX, by: aimY,
  });
}

function stepNecro(enemy, now, goalX, goalY) {
  const type = ALL_TYPES[enemy.type];
  // Drop a dead/removed minion reference so the necromancer can summon again.
  if (enemy.summonedMinion && (enemy.summonedMinion.dying || !state.enemies.includes(enemy.summonedMinion))) {
    enemy.summonedMinion = null;
  }
  // Path to and cast at the closer of the player and the nearest ballista.
  const tgt = enemyTarget(enemy);
  if (tgt.x > enemy.x) enemy.facing = "right"; else if (tgt.x < enemy.x) enemy.facing = "left";

  // Finish an in-progress summon (never interrupted), release the skeleton mid-cast.
  if (enemy.summoning) {
    if (!enemy.summonReleased && now - enemy.summonStart >= NECRO_SUMMON_HOLD_MS * 0.5) {
      summonSkeleton(enemy, type, now); enemy.summonReleased = true;
    }
    if (now - enemy.summonStart >= NECRO_SUMMON_HOLD_MS) enemy.summoning = false;
    return;
  }
  // Finish an in-progress attack (never interrupted), release the fireball mid-cast at the
  // tile the cast locked onto (player or a ballista).
  if (enemy.attacking) {
    if (!enemy.projReleased && now - enemy.attackStart >= NECRO_PROJECTILE_RELEASE_MS) {
      spawnNecroProjectile(enemy, type, now, enemy.attackTargetBallista ? { x: enemy.attackBX, y: enemy.attackBY } : null);
      enemy.projReleased = true;
    }
    if (now - enemy.attackStart >= NECRO_ATTACK_HOLD_MS) enemy.attacking = false;
    return;
  }
  // Finish any in-flight step before choosing the next action. Casts only ever start
  // from a standstill, so starting one never snaps the sprite back to the tile it left.
  if (enemy.moving) {
    if (now - enemy.moveStartAt < enemy.moveDuration) return;
    enemy.x = enemy.toX; enemy.y = enemy.toY; enemy.moving = false;
  }
  const dist = tileDist(enemy.x, enemy.y, tgt.x, tgt.y);
  // Priority 1: summon (one minion at a time, 10s cooldown from the first summon, and
  // never past the live-enemy performance cap).
  const cooldownOk = enemy.lastSummonAt === null || now - enemy.lastSummonAt >= NECRO_SUMMON_COOLDOWN_MS;
  if (!enemy.summonedMinion && cooldownOk && dist <= NECRO_SUMMON_RANGE && state.enemies.length < maxEnemies()) {
    enemy.summoning = true; enemy.summonStart = now; enemy.summonReleased = false;
    return;
  }
  // Priority 2: attack when in range and off cooldown. Reloading in range holds position.
  if (dist <= NECRO_ATTACK_RANGE) {
    if (now - enemy.lastAttackAt >= NECRO_ATTACK_COOLDOWN_MS) {
      enemy.attacking = true; enemy.attackStart = now; enemy.projReleased = false;
      enemy.attackTargetBallista = tgt.isBallista; enemy.attackBX = tgt.x; enemy.attackBY = tgt.y;
      enemy.lastAttackAt = now;
    }
    return;
  }
  // Otherwise close the distance to attack range (grounded pathing toward the chosen target).
  const nextField = tgt.isBallista ? ballistaFieldAt(tgt.x, tgt.y) : goalFlowField(goalX, goalY);
  let next = nextStepFromField(nextField, enemy.x, enemy.y, cellSolid);
  // Same fallback as stepEnemies, an unroutable turret target must not strand the caster.
  if (next === null && tgt.isBallista) {
    next = nextStepFromField(goalFlowField(goalX, goalY), enemy.x, enemy.y, cellSolid);
  }
  if (next === null) return;
  enemy.fromX = enemy.x; enemy.fromY = enemy.y; enemy.toX = next.x; enemy.toY = next.y;
  if (next.x > enemy.x) enemy.facing = "right"; else if (next.x < enemy.x) enemy.facing = "left";
  let dur = enemyStepDuration(enemy.type, next.x, next.y);
  if (next.x !== enemy.x && next.y !== enemy.y) dur = Math.round(dur * DIAG_DURATION_FACTOR);
  enemy.moveDuration = dur; enemy.moveStartAt = now; enemy.moving = true;
}

// Advance enemy orbs. Walls stop them (water doesn't), they fizzle at the point they
// were aimed at, and a hit costs the player a heart. Movement dodges them since they
// don't home.
function stepEnemyProjectiles(now) {
  if (!state.enemyProjectiles.length) return;
  const pc = playerCenterPxAt(now);
  const remaining = [];
  const hitR2 = (TILE_SIZE * 0.4) * (TILE_SIZE * 0.4);
  for (const p of state.enemyProjectiles) {
    const dt = now - p.lastStepAt; p.lastStepAt = now;
    p.px += p.vx * dt; p.py += p.vy * dt; p.traveled += NECRO_PROJECTILE_SPEED * dt;
    const tx = Math.floor(p.px / TILE_SIZE), ty = Math.floor(p.py / TILE_SIZE);
    if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
    if (cellBlocksProjectile(tx, ty)) continue;
    if (p.traveled >= p.maxTravel) continue;
    if (p.targetBallista) {
      const bx = (p.bx + 0.5) * TILE_SIZE, by = (p.by + 0.5) * TILE_SIZE;
      const dx = p.px - bx, dy = p.py - by;
      if (dx * dx + dy * dy <= hitR2) { damageBallistaAt(p.bx, p.by, p.damage, now); continue; }
    } else if (!state.player.dying) {
      const dx = p.px - pc.x, dy = p.py - pc.y;
      if (dx * dx + dy * dy <= hitR2) { damagePlayer(now, p.damage); continue; }
    }
    remaining.push(p);
  }
  state.enemyProjectiles = remaining;
}

// Orb sprites, punched up once per sheet (a brightness lift and much higher alpha) so
// they read as bright orbs instead of a faded haze.
const orbSprites = {};
function orbSprite(name) {
  if (orbSprites[name]) return orbSprites[name];
  const img = sprites[name];
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    a[i] = Math.min(255, Math.round(a[i] * 1.15));
    a[i + 1] = Math.min(255, Math.round(a[i + 1] * 1.15));
    a[i + 2] = Math.min(255, Math.round(a[i + 2] * 1.15));
    a[i + 3] = Math.min(255, Math.round(a[i + 3] * 1.45));
  }
  g.putImageData(d, 0, 0);
  orbSprites[name] = c;
  return c;
}

function renderEnemyProjectiles() {
  if (!state.enemyProjectiles.length) return;
  ctx.imageSmoothingEnabled = true;
  for (const p of state.enemyProjectiles) {
    const img = orbSprite(p.sprite);
    ctx.save();
    ctx.translate(p.px, p.py);
    ctx.rotate(p.angle);
    if (img) {
      const w = img.width * NECRO_PROJECTILE_SCALE, h = img.height * NECRO_PROJECTILE_SCALE;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else { ctx.fillStyle = "#8fd3ff"; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

// The ballista turrets: the first-column fire frame, drawn 32x32 and rotated to aim. The art
// points up, so it is rotated by the aim angle plus 90 degrees.
function renderBallistas(now) {
  if (!ballistas.length) return;
  const sheet = sprites.dwarvenBallista;
  for (const b of ballistas) {
    const cx = (b.x + 0.5) * TILE_SIZE, cy = (b.y + 0.5) * TILE_SIZE;
    let frame = 0;
    if (b.firing) frame = Math.min(BALLISTA_FIRE_FRAMES - 1, Math.floor((now - b.fireStart) / BALLISTA_FIRE_ANIM_MS));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(b.angle + Math.PI / 2);
    ctx.imageSmoothingEnabled = false;
    if (sheet) {
      ctx.drawImage(sheet, 0, frame * BALLISTA_FRAME, BALLISTA_FRAME, BALLISTA_FRAME,
        -BALLISTA_DRAW / 2, -BALLISTA_DRAW / 2, BALLISTA_DRAW, BALLISTA_DRAW);
    } else {
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(-BALLISTA_DRAW / 2, -BALLISTA_DRAW / 2, BALLISTA_DRAW, BALLISTA_DRAW);
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
    } else if (enemy.summoning) {
      desired = "SUMMON";
      enemy.anim = desired;
      frameIndex = animFrameIndex(enemy.summonStart, now, "SUMMON", true);
    } else if (enemy.attacking) {
      desired = "ATTACK";
      enemy.anim = desired;
      if (type.attackWindupMs) {
        // Melee: stretch the swing across the windup so it lands on the final frame.
        const stepMs = type.attackWindupMs / ANIM_FRAMES;
        frameIndex = Math.min(ANIM_FRAMES - 1, Math.floor((now - enemy.attackStart) / stepMs));
      } else {
        // Necromancer cast plays once over the fixed hold.
        frameIndex = animFrameIndex(enemy.attackStart, now, "ATTACK", true);
      }
    } else {
      if (enemy.moving) {
        desired = cellSpeedMult(enemy.toX, enemy.toY) > 1.0 ? "RUN" : "WALK";
      } else {
        desired = "IDLE";
      }
      if (enemy.anim !== desired) { enemy.anim = desired; enemy.animStart = now; }
      frameIndex = animFrameIndex(enemy.animStart, now, enemy.anim, false);
    }

    // Summoned skeletons fade into existence over their first half-second.
    const fading = enemy.spawnFadeUntil && now < enemy.spawnFadeUntil;
    if (fading) { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, 1 - (enemy.spawnFadeUntil - now) / SUMMON_FADE_MS)); }
    // Sheets face right. Flip when facing left.
    if (!drawAnim(type.cell, enemy.anim, frameIndex, centerX, baseY, enemy.facing === "left")) {
      ctx.fillStyle = "#c93737";
      ctx.beginPath();
      ctx.arc(centerX, baseY - TILE_SIZE * 0.4, TILE_SIZE * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (fading) ctx.restore();
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

  // Invisibility (gray ultimate): steady half-opacity and no blink. Otherwise the i-frame blink.
  const invisible = now < invisUntil;
  if (!invisible && now < invulnUntil && Math.floor(now / 120) % 2 === 1) return;
  if (invisible) { ctx.save(); ctx.globalAlpha = 0.5; }

  if (!drawAnim(playerCell(), p.anim, frameIndex, centerX, baseY, p.facing === "left")) {
    // Fallback if the sheet failed to load.
    ctx.fillStyle = "#7ed957";
    ctx.fillRect(centerX - 12, baseY - 28, 24, 28);
  }
  if (invisible) ctx.restore();
}

// Timestamp of the last painted frame, so a resize repaint can reproduce it exactly
// (same timestamp, same animation frames) while the loop is frozen.
let lastRenderAt = 0;

function render(now) {
  lastRenderAt = now;
  applyWorldTransform();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  if (level === 2 || level === 3) {
    // Levels 2 (cave) and 3 (sewer) pre-render their whole map to an offscreen canvas when
    // the level loads, so we just blit it each frame.
    const bg = level === 3 ? l3Background() : l2Background();
    if (bg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(bg, 0, 0); }
  } else {
    // Level 1's map is baked the same way (see level1Background) and blitted.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(level1Background(), 0, 0);
  }
  renderBallistas(now);
  renderEnemies(now);
  renderPlayer(now);
  renderProjectiles(); // above the characters, so arrows never show through them
  renderEnemyProjectiles();
  renderDamageVignette(now);
}

// Red edge vignette on taking damage, fading toward the center over the flash window.
function renderDamageVignette(now) {
  const remaining = damageFlashUntil - now;
  if (remaining <= 0) return;
  const t = remaining / DAMAGE_FLASH_MS;
  const alpha = Math.min(1, t) * 0.6;
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const inner = Math.min(cx, cy) * 0.45;
  const outer = Math.hypot(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, "rgba(200, 0, 0, 0)");
  grad.addColorStop(1, `rgba(200, 0, 0, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

// ---------------------------------------------------------------------------
// Level transition (between any two levels in the loop): the screen pixelates to
// black over 3s, then the next level pixelates in over another 3s. Gameplay is
// frozen for the whole 6s, and the next map is generated during the fade-out so
// the wait is hidden.
// ---------------------------------------------------------------------------
const TRANSITION_MS = 3000;
let transition = null; // { phase: "out" | "in", startAt, snap }
const pixelScratch = document.createElement("canvas");

// Draw `src` into the main canvas pixelated by `amount` (0 = crisp, 1 = coarse blocks)
// and darkened toward black by the same amount.
function drawPixelated(src, amount) {
  applyWorldTransform();
  const block = 1 + Math.round(amount * 40);
  const sw = Math.max(1, Math.round(WORLD_W / block));
  const sh = Math.max(1, Math.round(WORLD_H / block));
  // Assigning width/height reallocates the canvas, so only do it when the size
  // actually changes. The clearRect below covers the reuse case.
  if (pixelScratch.width !== sw) pixelScratch.width = sw;
  if (pixelScratch.height !== sh) pixelScratch.height = sh;
  const pctx = pixelScratch.getContext("2d");
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, sw, sh);
  pctx.drawImage(src, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  ctx.drawImage(pixelScratch, 0, 0, sw, sh, 0, 0, WORLD_W, WORLD_H);
  if (amount > 0) { ctx.fillStyle = `rgba(0,0,0,${amount})`; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }
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
  render(now); // snapshot the current scene to pixelate out
  // Advance to the next level, wrapping past the last one back to level 1 (a new cycle).
  // The map is built by enterLevel at the fade-out end, while the screen is fully black,
  // so the brief generation hitch is hidden.
  const nextLevel = level >= LEVEL_COUNT ? 1 : level + 1;
  transition = { phase: "out", startAt: now, snap: snapshotCanvas(), next: nextLevel };
}

// Build the map for a level. Level 1 uses the mapgen tile grid. Later levels build their
// own. Add a branch here for each new level.
function setupLevelMap(n) {
  if (n === 2) generateLevel2(sprites);
  else if (n === 3) generateLevel3(sprites);
  else state.tileMap = buildStartingMap();
}

// Enter a level: generate its map, drop the player in the middle, clear enemies and
// projectiles, restart the spawn clock, and switch to its music. Kills and buffs carry
// over. Used both by the fade transition and by the START_LEVEL design shortcut.
function enterLevel(n, now) {
  // Returning to level 1 means the loop wrapped, so start a new, harder cycle. enterLevel
  // is only ever reached for level 1 through that wrap (never at the initial start, which
  // goes through resetState), so this counts real loops.
  if (n === 1) cycle += 1;
  level = n;
  levelCardBaseline = buffsAwarded; // per-level card unlocks reset, buffs still carry over
  state.enemies = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  pendingShot = null;
  state.player = freshPlayer(now);
  playerAttackUntil = 0;
  playerHurtUntil = 0;
  damageFlashUntil = 0;
  invulnUntil = 0;
  lastArrowFiredAt = -DEFAULT_ATTACK_INTERVAL_MS;
  lastOmniFireAt = now;   // omni volleys start fresh in the new level
  // The turret vanishes and every ranger's ultimate cooldown resets on a new level.
  ultReadyAt = 0;
  ultCastAt = -ULT_COOLDOWN_MS;
  invisUntil = 0;
  ballistas = [];
  resetQueue(ballistaQueue);
  resetQueue(stormQueue);
  invalidateBallistaFields();
  flowField = null;       // rebuild the flow field for the new map
  setupLevelMap(n);
  state.lastSpawnAt = now;
  playGameMusic(n);       // each level plays its own randomized playlist
}

function renderTransition(now) {
  const t = Math.min(1, (now - transition.startAt) / TRANSITION_MS);
  if (transition.phase === "out") {
    drawPixelated(transition.snap, t);
    if (t >= 1) {
      enterLevel(transition.next, now);
      render(now); // draw the initial frame of the new level, then snapshot it to pixelate in
      transition = { phase: "in", startAt: now, snap: snapshotCanvas() };
    }
  } else {
    drawPixelated(transition.snap, 1 - t);
    if (t >= 1) {
      state.lastSpawnAt = performance.now(); // spawn clock starts when play resumes
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
  // A level ends once its card budget (progression.js) has been taken. Fade into the next one
  // (which loops back to level 1 forever, each wrap a harder cycle).
  if (!state.player.dying && levelCards() >= cardsForLevel(cycle, level)) {
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
      maybeFireOmni(now);
      stepEnemies(now);
      stepBallistas(now);
      stepQueue(ballistaQueue, now, ballistaCooldownMs());
      stepQueue(stormQueue, now, ARROW_STORM_COOLDOWN_MS);
      resolveCollisions(now);
      stepEnemyProjectiles(now);
      render(now);
      updateHud(now, state);
      updateProgress(cardXp / xpForNextCard(), ultimateCircles(now));
      // Guard on dying like the level-transition check above, or a kill and a death
      // in the same frame open the card screen over the death animation.
      if (!state.player.dying && cardXp >= xpForNextCard()) {
        cardXp -= xpForNextCard(); // overflow XP carries into the next card
        startBuffSelection(now, buffGame);
      }
    }
  } catch (err) {
    // Keep one frame's exception from killing the rAF chain.
    console.error("recurve loop error:", err);
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function start() {
  resetState();
  everStarted = true; // a real game world exists now, so resizes may repaint it behind overlays
  if (GOD_MODE) applyMaxBuffs(state); // testing: fully-kitted archer
  state.running = true;
  state.paused = false;
  state.startedAt = performance.now();
  state.lastSpawnAt = state.startedAt;
  startGameSession();
  resetScoreForm(false);
  overlay.classList.add("hidden");
  canvas.focus();
  if (START_LEVEL > 1) {
    // Design shortcut: jump straight into the chosen level, skipping the earlier ones
    // and the fade transition.
    enterLevel(START_LEVEL, performance.now());
  } else {
    playGameMusic(1);
  }
  requestAnimationFrame(loop);
}

function resetState() {
  const ranger = rangerStats(selectedRanger);
  level = 1;
  cycle = 0;
  levelCardBaseline = 0;
  state.transitioning = false;
  transition = null;
  state.kills = 0;
  cardXp = 0;
  state.maxLives = ranger.hearts;
  state.lives = ranger.hearts;
  state.choosingBuff = false;
  state.player = freshPlayer(0);
  playerAttackUntil = 0;
  playerHurtUntil = 0;
  damageFlashUntil = 0;
  invulnUntil = 0;
  lastArrowFiredAt = -DEFAULT_ATTACK_INTERVAL_MS;
  lastOmniFireAt = 0;
  pendingShot = null;
  mouseDown = false;
  ultReadyAt = 0;                    // ultimate starts ready
  ultCastAt = -ULT_COOLDOWN_MS;
  invisUntil = 0;
  ballistas = [];
  resetQueue(ballistaQueue);
  resetQueue(stormQueue);
  invalidateBallistaFields();
  resetRunStats(ranger);
  state.enemies = [];
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.tileMap = buildStartingMap();
}

function gameOver() {
  state.running = false;
  playMenuMusic();
  overlay.classList.add("game-over"); // swaps the ultimate cards for the score form, shows Main Menu
  overlayTitle.textContent = `Enemies killed: ${state.kills}`;
  overlayText.textContent = "Choose your ranger";
  resetScoreForm(true);
  overlay.classList.remove("hidden");
  refreshLeaderboard();
  updateProgress(0, [{ fraction: 1, ready: true }]);
  startCharPreviewLoop(); // let them re-pick an archer before the next run
}

// ---------------------------------------------------------------------------
// Character select (stats, ultimate, and card pool differ per ranger)
// ---------------------------------------------------------------------------
const charCards = Array.from(document.querySelectorAll(".char-option")).map((opt) => ({
  option: opt,
  canvas: opt.querySelector(".char-card"),
  ctx: opt.querySelector(".char-card").getContext("2d"),
  ult: document.querySelector(`.ult-card[data-ranger="${opt.dataset.ranger}"]`),
  index: Number(opt.dataset.ranger),
}));
// Each ranger's Space ultimate name, shown on the card beneath it on the menu.
const ULTIMATES = ["Invisibility", "Ballista", "Arrow Storm"];
// Render the preview cards at a higher buffer resolution than their CSS box, so the menu's
// scale-up stays crisp instead of upscaling a tiny bitmap. The CSS size is pinned to the
// original design size first, so only the internal detail changes, not the layout.
const CARD_RENDER_PX = 192;
for (const { canvas } of charCards) {
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  canvas.width = CARD_RENDER_PX;
  canvas.height = CARD_RENDER_PX;
}
let charPreviewRAF = 0;

// Fill each ranger's box with its stat ratings (filled pips out of 3).
function buildStatBoxes() {
  for (const card of charCards) {
    const box = card.option.querySelector(".char-stats");
    box.innerHTML = Object.entries(RANGERS[card.index].bars).map(([label, rating]) => {
      const pips = [0, 1, 2].map((i) => `<span class="pip${i < rating ? " full" : ""}"></span>`).join("");
      return `<div class="stat-row"><span class="stat-label">${label}</span><span class="pips">${pips}</span></div>`;
    }).join("");
    card.ult.innerHTML =
      `<span class="ult-label">Ultimate</span>` +
      `<span class="ult-name">${ULTIMATES[card.index]}</span>`;
  }
}

// Reflect the selected ranger's hearts in the HUD while on the menu.
function showRangerHud() {
  const r = rangerStats(selectedRanger);
  state.maxLives = r.hearts;
  state.lives = r.hearts;
  renderHearts(state);
}

try {
  const saved = parseInt(localStorage.getItem("recurve.ranger"), 10);
  if (!Number.isNaN(saved) && saved >= 0 && saved < ARCHER_SHEETS.length) selectedRanger = saved;
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
  const pad = canvas.width / 8; // proportional, so framing is identical at any buffer resolution
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
    const selected = card.index === selectedRanger;
    card.option.classList.toggle("selected", selected);
    card.ult.classList.toggle("selected", selected);
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

function selectRanger(index) {
  if (index !== selectedRanger) playSfx("select", 4); // only when switching
  selectedRanger = index;
  showRangerHud();
  try { localStorage.setItem("recurve.ranger", String(selectedRanger)); } catch (_) { /* ignore */ }
}
for (const card of charCards) {
  card.option.addEventListener("click", () => selectRanger(card.index));
  card.ult.addEventListener("click", () => selectRanger(card.index));
}

const mainMenuButton = document.getElementById("main-menu-button");
// Return from the game-over screen to the opening menu (re-show the ultimate cards, hide the
// score form) without starting a run.
function showMainMenu() {
  overlay.classList.remove("game-over");
  overlayTitle.textContent = "Recurve";
  overlayText.textContent = "Choose your ranger";
  resetScoreForm(false);
}
overlayButton.addEventListener("click", () => { playSfx("select", 4); start(); });
mainMenuButton.addEventListener("click", () => { playSfx("select", 4); showMainMenu(); });
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

buildStatBoxes();
showRangerHud();

// First-load gate: the menu sits behind the LOADING screen until the sprites and the
// leaderboard have both landed, and for at least 2 seconds so a fast load doesn't
// flash it. A failed leaderboard fetch still resolves (it renders the empty skeleton),
// so the gate can't hang on a dead API.
const LOADING_MIN_MS = 2000;
const loadingStart = performance.now();
const spritesLoaded = loadSprites().then(() => {
  spritesReady = true; // real sprites are in; the level 1 map rebakes on the first in-game frame
  paintMenuBackdrop(); // keep the opening menu dark rather than showing the level 1 map behind it
});
Promise.allSettled([spritesLoaded, refreshLeaderboard()]).then(() => {
  const wait = Math.max(0, LOADING_MIN_MS - (performance.now() - loadingStart));
  setTimeout(() => {
    overlay.classList.remove("loading");
    startCharPreviewLoop();
  }, wait);
});

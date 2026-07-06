// Level 2 (the cave) map generation and rendering. Built the same way level 1 is:
// a fresh random map every run, generated in the browser. Unlike level 1's simple
// per-tile sprite blits, the cave's water/lava edges are pixel effects (foam froth on
// water, black char on lava), so the whole map is generated and painted to an
// offscreen canvas once when level 2 loads (hidden by the fade), then blitted each
// frame. Collision and enemy pathfinding read the tile terrain grid, exactly like
// level 1's tileMap. Pure of game state: game.js calls generateLevel2() then reads the
// grid and background through the query functions below.

import {
  MAP_COLS as COLS, MAP_ROWS as ROWS, PLAYER_START_X as CX, PLAYER_START_Y as CY,
  wanderingRouteToCenter,
} from "./mapgen.js";
import { shuffleInPlace } from "./shuffle.js";

const TILE = 48;
const ART = 16;                 // art-resolution pixels per tile for the froth/char
const AW = COLS * ART, AH = ROWS * ART;

// Terrain codes stored in the grid.
export const L2 = { FLOOR: 0, PATH: 1, WATER: 2, LAVA: 3, WALL: 4, ROCK: 5 };

// The six troll spawn points: the interior tile just in front of each border portal
// (portals sit at cols 2,16,29 on the top and bottom rows).
export const L2_SPAWNS = [[2, 1], [16, 1], [29, 1], [2, 14], [16, 14], [29, 14]];

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const k = (x, y) => y * COLS + x;
const FORTSET = new Set(L2_SPAWNS.map(([x, y]) => k(x, y)));
const isFort = (x, y) => FORTSET.has(k(x, y));

// Object sprite sheet (objects.png): 5 columns of 48px cells, bottom-anchored. Sprites
// 0-3 are rocks, 4-14 are minerals (crystals plus the orange-ore rock). Scattered like
// level 1's trees.
const OBJ_CELL = 48, OBJ_COLS = 5, ROCK_COUNT = 4, MINERAL_COUNT = 11;

let grid = null;      // 2D array [ROWS][COLS] of L2.* codes
let bgCanvas = null;  // pre-rendered background

export function l2Background() { return bgCanvas; }
export function l2Grid() { return grid; }

export function l2Solid(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const t = grid[y][x];
  return t === L2.WATER || t === L2.LAVA || t === L2.WALL || t === L2.ROCK;
}
export function l2BlocksProjectile(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const t = grid[y][x];
  return t === L2.WALL || t === L2.ROCK;
}
// Fraction of base speed on this tile, matching level 1's path-fast / ground-slow feel.
export function l2SpeedMult(x, y) {
  const t = grid[y][x];
  if (t === L2.PATH) return 1.15;
  if (t === L2.FLOOR) return 0.85;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Generation helpers (ported from the Python cave prototype)
// ---------------------------------------------------------------------------

const deg = (set, x, y) => {
  let n = 0;
  for (const [dx, dy] of DIRS4) if (set.has(k(x + dx, y + dy))) n++;
  return n;
};

// Irregular accretion blob bounded loosely by an ellipse -> organic, not boxy.
function holeTiles(cx, cy, rx, ry) {
  const target = Math.max(9, Math.min(40, Math.round(Math.PI * rx * ry * (0.95 + Math.random() * 0.3))));
  const cells = new Set([k(Math.round(cx), Math.round(cy))]);
  let guard = 0;
  while (cells.size < target && guard < 3000) {
    guard++;
    const arr = [...cells];
    const c = arr[(Math.random() * arr.length) | 0];
    const px = c % COLS, py = (c / COLS) | 0;
    const [dx, dy] = DIRS4[(Math.random() * 4) | 0];
    const nx = px + dx, ny = py + dy;
    const d = ((nx - cx) / (rx + 1.4)) ** 2 + ((ny - cy) / (ry + 1.4)) ** 2;
    if (d <= 1.0 && nx >= 2 && nx < COLS - 2 && ny >= 2 && ny < ROWS - 2 && Math.random() < 0.85) cells.add(k(nx, ny));
  }
  // fill single-tile pockets so the blob is solid
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 2; y < ROWS - 2; y++) for (let x = 2; x < COLS - 2; x++) {
      if (cells.has(k(x, y))) continue;
      if (deg(cells, x, y) >= 3) { cells.add(k(x, y)); changed = true; }
    }
  }
  return cells;
}

// Remove single-tile spurs (a cell with <=1 orthogonal neighbor).
function trimSpurs(cells) {
  cells = new Set(cells);
  let ch = true;
  while (ch) {
    ch = false;
    for (const key of [...cells]) {
      const x = key % COLS, y = (key / COLS) | 0;
      if (deg(cells, x, y) <= 1) { cells.delete(key); ch = true; }
    }
  }
  return cells;
}

// Fill any interior tiles fully enclosed by the blob (no 1x1 holes inside).
function fillHoles(cells) {
  const ext = new Set();
  const q = [];
  for (let x = 0; x < COLS; x++) { for (const y of [0, ROWS - 1]) if (!cells.has(k(x, y))) { ext.add(k(x, y)); q.push([x, y]); } }
  for (let y = 0; y < ROWS; y++) { for (const x of [0, COLS - 1]) if (!cells.has(k(x, y))) { ext.add(k(x, y)); q.push([x, y]); } }
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      if (cells.has(k(nx, ny)) || ext.has(k(nx, ny))) continue;
      ext.add(k(nx, ny)); q.push([nx, ny]);
    }
  }
  const out = new Set(cells);
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (!out.has(k(x, y)) && !ext.has(k(x, y))) out.add(k(x, y));
  }
  return out;
}

// Grow small organic pools until the total tile count reaches a random target inside
// [tLo, tHi], with overshoot capped at one pool, so the totals stay in a tight band.
// A pool never overlaps the reserved path network, and keeps a one-tile gap from spawns,
// from other pools of the same type, and from the other liquid (so water and lava never
// touch). Pools may sit right up against a path. Paths and spawn routes are reserved
// before this runs, so the routes to the center are never blocked.
function placePools(tLo, tHi, reserved, others, rxR, ryR, minSize) {
  const goal = tLo + ((Math.random() * (tHi - tLo + 1)) | 0);
  const out = new Set();
  const blocked = (blob) => {
    for (const key of blob) {
      const x = key % COLS, y = (key / COLS) | 0;
      if (!(x >= 2 && x < COLS - 2 && y >= 2 && y < ROWS - 2)) return true;
      if (reserved.has(key)) return true; // never overlap paths/routes
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nk = k(x + dx, y + dy);
        if (FORTSET.has(nk) || out.has(nk) || others.has(nk)) return true; // gap from spawns, same-type, other liquid
      }
    }
    return false;
  };
  let att = 0;
  while (out.size < goal && att < 3000) {
    att++;
    const hx = 4 + ((Math.random() * (COLS - 9)) | 0);
    const hy = 3 + ((Math.random() * (ROWS - 6)) | 0);
    const rx = rxR[0] + Math.random() * (rxR[1] - rxR[0]);
    const ry = ryR[0] + Math.random() * (ryR[1] - ryR[0]);
    const blob = trimSpurs(holeTiles(hx, hy, rx, ry));
    if (blob.size < minSize) continue;
    if (out.size + blob.size > goal + minSize) continue; // cap overshoot
    if (blocked(blob)) continue;
    for (const key of blob) out.add(key);
  }
  return fillHoles(out);
}

// A short (2-4 tile) one-wide offshoot grown off an existing path tile into open
// floor, matching level 1's branches. Adds to `path`, returns true if one was placed.
function growBranch(path, reserved) {
  const isP = (x, y) => path.has(k(x, y));
  const all = [];
  for (let y = 2; y < ROWS - 2; y++) for (let x = 2; x < COLS - 2; x++) if (isP(x, y) && !isFort(x, y)) all.push([x, y]);
  const far = all.filter(([x, y]) => Math.max(Math.abs(x - CX), Math.abs(y - CY)) > 4);
  const starts = shuffleInPlace(far.length ? far : all);
  for (const [sx, sy] of starts) {
    for (const [dx, dy] of shuffleInPlace(DIRS4.slice())) {
      const cells = [];
      let x = sx + dx, y = sy + dy;
      const maxLen = 2 + ((Math.random() * 3) | 0); // 2..4
      while (cells.length < maxLen) {
        if (x < 1 || x >= COLS - 1 || y < 1 || y >= ROWS - 1) break;
        if (isP(x, y) || isFort(x, y) || reserved.has(k(x, y))) break;
        const prev = cells.length === 0 ? [sx, sy] : cells[cells.length - 1];
        let touches = false;
        for (const [ex, ey] of DIRS4) { const nx = x + ex, ny = y + ey; if (nx === prev[0] && ny === prev[1]) continue; if (isP(nx, ny)) { touches = true; break; } }
        if (touches) break;
        cells.push([x, y]); x += dx; y += dy;
      }
      if (cells.length >= 2) { for (const [cx, cy] of cells) path.add(k(cx, cy)); return true; }
    }
  }
  return false;
}

// Would turning (x, y) into path complete a 2x2 all-path block?
function wouldFill2x2(path, x, y) {
  const isP = (ax, ay) => (ax === x && ay === y) || path.has(k(ax, ay));
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    let all = true;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!isP(x + ox + dx, y + oy + dy)) { all = false; break; }
    if (all) return true;
  }
  return false;
}

// Fill a floor tile boxed in by path on all four sides, unless doing so would make a
// 2x2 block. Iterates to a fixed point, mirroring level 1's fillGrassHoles.
function fillFloorHoles(path) {
  let ch = true, g = 0;
  while (ch && g < 16) {
    ch = false; g++;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (path.has(k(x, y)) || isFort(x, y)) continue;
      if (deg(path, x, y) !== 4 || wouldFill2x2(path, x, y)) continue;
      path.add(k(x, y)); ch = true;
    }
  }
}

// One attempt at the path network: draw a random 4-6 of the routes, add a few short
// branches, thin to one tile wide, fill enclosed pockets, trim 1x1 offshoots, and return
// only the piece connected to the center. build() calls this repeatedly and keeps the
// attempt that reaches the most spawns.
function drawNetwork(routes, reserved, center3) {
  const path = new Set(center3);
  const order = shuffleInPlace(routes.map((_, i) => i));
  const routesToDraw = 4 + ((Math.random() * 3) | 0); // 4, 5 or 6
  for (let i = 0; i < routesToDraw && i < order.length; i++) {
    for (const [x, y] of routes[order[i]]) {
      if (x >= 1 && x < COLS - 1 && y >= 1 && y < ROWS - 1) path.add(k(x, y));
    }
  }
  for (let b = 3 + ((Math.random() * 3) | 0); b > 0; b--) growBranch(path, reserved);
  // thin to one tile wide, keeping the center 3x3 and fort tiles
  let ch = true, g = 0;
  while (ch && g < 64) {
    ch = false; g++;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      const blk = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      if (!blk.every(([bx, by]) => path.has(k(bx, by)))) continue;
      for (const [bx, by] of [[x + 1, y + 1], [x + 1, y], [x, y + 1], [x, y]]) {
        if (isFort(bx, by) || center3.has(k(bx, by))) continue;
        if (path.has(k(bx, by))) { path.delete(k(bx, by)); ch = true; break; }
      }
    }
  }
  fillFloorHoles(path);
  // trim 1x1 offshoots
  ch = true; g = 0;
  while (ch && g < 32) {
    ch = false; g++;
    for (const key of [...path]) {
      const x = key % COLS, y = (key / COLS) | 0;
      if (center3.has(key) || isFort(x, y) || deg(path, x, y) !== 1) continue;
      let nx = x, ny = y;
      for (const [dx, dy] of DIRS4) if (path.has(k(x + dx, y + dy))) { nx = x + dx; ny = y + dy; }
      if (deg(path, nx, ny) >= 3) { path.delete(key); ch = true; }
    }
  }
  // keep only the network connected to the center
  const seen = new Set(center3);
  const q = [...center3];
  while (q.length) {
    const key = q.pop();
    const x = key % COLS, y = (key / COLS) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy, nk = k(nx, ny);
      if (nx >= 1 && nx < COLS - 1 && ny >= 1 && ny < ROWS - 1 && path.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Map assembly
// ---------------------------------------------------------------------------

export function build() {
  grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(L2.FLOOR));
  for (let x = 0; x < COLS; x++) { grid[0][x] = L2.WALL; grid[ROWS - 1][x] = L2.WALL; }
  for (let y = 0; y < ROWS; y++) { grid[y][0] = L2.WALL; grid[y][COLS - 1] = L2.WALL; }

  let path = new Set();
  const reserved = new Set();
  const center3 = new Set();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    center3.add(k(CX + dx, CY + dy)); path.add(k(CX + dx, CY + dy)); reserved.add(k(CX + dx, CY + dy));
  }
  // Reserve a route from every spawn (so water and lava never wall a spawn off), then
  // draw the path network. Thinning and pruning can sever a route near the center, so
  // retry the draw and keep the attempt that connects the most spawns, stopping once at
  // least three of the six spawns have a path to the center.
  const routes = L2_SPAWNS.map(([sx, sy]) => wanderingRouteToCenter(sx, sy, Math.random, isFort));
  for (const rt of routes) for (const [x, y] of rt) reserved.add(k(x, y));
  let best = null, bestConnected = -1;
  for (let t = 0; t < 14; t++) {
    const attempt = drawNetwork(routes, reserved, center3);
    let c = 0;
    for (const [sx, sy] of L2_SPAWNS) if (attempt.has(k(sx, sy))) c++;
    if (c > bestConnected) { bestConnected = c; best = attempt; }
    if (c >= 3) break;
  }
  path = best;
  for (const p of path) reserved.add(p);

  // Tuned so water averages ~40 tiles (mostly 30-50) and lava ~30 (mostly 25-35).
  // Water first, then lava, which keeps a gap from the water.
  const water = placePools(33, 39, reserved, new Set(), [1.8, 2.3], [1.5, 1.9], 5);
  for (const p of water) reserved.add(p);
  const lava = placePools(28, 32, reserved, water, [1.7, 2.1], [1.4, 1.7], 3);
  for (const p of lava) reserved.add(p);

  // Rock and mineral objects, placed like level 1's trees: clumps and short strings on
  // open floor up to a 154-178 tile budget, 85% rocks (sprites 0-3) and 15% minerals
  // (sprites 4-14). Each is a solid obstacle, stored under the ROCK terrain code.
  const objects = new Map(); // tile key -> sprite index in objects.png
  const objSafe = (x, y) => x >= 1 && x < COLS - 1 && y >= 1 && y < ROWS - 1 && !reserved.has(k(x, y)) && !isFort(x, y);
  const putObj = (x, y) => {
    if (!objSafe(x, y) || objects.has(k(x, y))) return false;
    const idx = Math.random() < 0.85
      ? (Math.random() * ROCK_COUNT) | 0
      : ROCK_COUNT + ((Math.random() * MINERAL_COUNT) | 0);
    objects.set(k(x, y), idx);
    return true;
  };
  const objTarget = 154 + ((Math.random() * 25) | 0); // 154-178, matching level 1's trees
  const openObj = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (objSafe(x, y)) openObj.push([x, y]);
  shuffleInPlace(openObj);
  let placed = 0;
  for (const [sx, sy] of openObj) {
    if (placed >= objTarget) break;
    if (!objSafe(sx, sy) || objects.has(k(sx, sy))) continue;
    if (Math.random() < 0.25) { // 2x2 clump
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (placed >= objTarget) break;
        if (putObj(sx + dx, sy + dy)) placed++;
      }
    } else { // string of 2-5
      const len = 2 + ((Math.random() * 4) | 0);
      const horiz = Math.random() < 0.5;
      for (let i = 0; i < len; i++) {
        if (placed >= objTarget) break;
        const x = horiz ? sx + i : sx, y = horiz ? sy : sy + i;
        if (putObj(x, y)) placed++;
      }
    }
  }

  // write terrain codes (objects are solid, stored as ROCK)
  for (const key of path) { const x = key % COLS, y = (key / COLS) | 0; if (grid[y][x] === L2.FLOOR) grid[y][x] = L2.PATH; }
  for (const key of water) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.WATER; }
  for (const key of lava) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.LAVA; }
  for (const key of objects.keys()) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.ROCK; }

  return { path, water, lava, objects };
}

// ---------------------------------------------------------------------------
// Background rendering
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothMask(m) {
  for (let pass = 0; pass < 2; pass++) {
    const c = m.slice();
    for (let y = 1; y < AH - 1; y++) for (let x = 1; x < AW - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += c[(y + dy) * AW + (x + dx)];
      m[y * AW + x] = n >= 5 ? 1 : 0;
    }
  }
}

// Distance (in art pixels) from each in-shape pixel to the nearest outside pixel.
function distField(m) {
  const dist = new Int16Array(AW * AH).fill(-1);
  const q = new Int32Array(AW * AH);
  let head = 0, tail = 0;
  for (let i = 0; i < AW * AH; i++) if (m[i] === 0) { dist[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++], x = i % AW, y = (i / AW) | 0, d = dist[i];
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= AW || ny < 0 || ny >= AH) continue;
      const ni = ny * AW + nx;
      if (dist[ni] === -1) { dist[ni] = d + 1; q[tail++] = ni; }
    }
  }
  return dist;
}

function smoothNoise() {
  const n = new Float32Array(AW * AH);
  for (let i = 0; i < n.length; i++) n[i] = Math.random();
  const o = new Float32Array(AW * AH);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= AW || ny < 0 || ny >= AH) continue;
      s += n[ny * AW + nx]; c++;
    }
    const v = s / c; o[y * AW + x] = v;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  const span = (mx - mn) || 1;
  for (let i = 0; i < o.length; i++) o[i] = (o[i] - mn) / span;
  return o;
}

const WATER_C = [17, 25, 24];
const FOAM_MID = [127, 156, 146];
const FOAM_BRIGHT = [169, 190, 182];
const RIMS = [[74, 54, 37], [58, 42, 29], [90, 66, 45]];
const EMBER = [120, 40, 14];
const CHARS = [[18, 14, 12], [30, 22, 16], [9, 7, 6]];

// Paint a set of hole tiles (water or lava) with its edge treatment into ctx.
function renderHoles(ctx, cellSet, kind, lava16) {
  if (cellSet.size === 0) return;
  const m = new Uint8Array(AW * AH);
  for (const key of cellSet) {
    const tx = key % COLS, ty = (key / COLS) | 0;
    for (let yy = 0; yy < ART; yy++) for (let xx = 0; xx < ART; xx++) m[(ty * ART + yy) * AW + (tx * ART + xx)] = 1;
  }
  smoothMask(m);
  const dist = distField(m);
  const bub = smoothNoise();
  const art = document.createElement("canvas");
  art.width = AW; art.height = AH;
  const actx = art.getContext("2d");
  const img = actx.createImageData(AW, AH);
  const d = img.data;
  for (let i = 0; i < AW * AH; i++) {
    if (!m[i]) continue;
    const dd = dist[i], b = bub[i];
    let col;
    if (kind === "water") {
      if (dd <= 1) col = RIMS[(Math.random() * RIMS.length) | 0];
      else {
        const BAND = 4.5;
        const base = clamp01((BAND - (dd - 1)) / BAND);
        const nf = clamp01((BAND + 0.9 - dd) / 1.6);
        const foam = clamp01(base + 0.68 * (b - 0.42) * nf) * 0.72;
        if (dd <= 2.7 && b > 0.6) {
          const t = clamp01((b - 0.6) / 0.4);
          col = [lerp(FOAM_MID[0], FOAM_BRIGHT[0], t), lerp(FOAM_MID[1], FOAM_BRIGHT[1], t), lerp(FOAM_MID[2], FOAM_BRIGHT[2], t)];
        } else if (foam > 0.15) {
          col = [lerp(WATER_C[0], FOAM_MID[0], foam), lerp(WATER_C[1], FOAM_MID[1], foam), lerp(WATER_C[2], FOAM_MID[2], foam)];
        } else col = WATER_C;
      }
    } else {
      const px = (i % AW) % ART, py = ((i / AW) | 0) % ART;
      const li = (py * ART + px) * 4;
      const field = [lava16[li], lava16[li + 1], lava16[li + 2]];
      if (dd <= 1) col = CHARS[(Math.random() * CHARS.length) | 0];
      else if (dd <= 3) {
        const amt = clamp01((3 - dd) / 2.2) * 0.85;
        col = [lerp(field[0], EMBER[0], amt), lerp(field[1], EMBER[1], amt), lerp(field[2], EMBER[2], amt)];
      } else col = field;
    }
    const o = i * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  actx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, 0, 0, AW, AH, 0, 0, COLS * TILE, ROWS * TILE);
}

const FLOOR_TILES = [[1, 9], [1, 10], [0, 9], [0, 10]];

function renderBackground(sprites, data) {
  const cv = document.createElement("canvas");
  cv.width = COLS * TILE; cv.height = ROWS * TILE;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const sheet = sprites.caveSheet;

  // floor everywhere
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const [fx, fy] = FLOOR_TILES[(Math.random() * FLOOR_TILES.length) | 0];
    if (sheet) g.drawImage(sheet, fx * 16, fy * 16, 16, 16, x * TILE, y * TILE, TILE, TILE);
    else { g.fillStyle = "#58412e"; g.fillRect(x * TILE, y * TILE, TILE, TILE); }
  }

  // lava texture sampled to art resolution once
  let lava16 = null;
  if (sprites.caveLava) {
    const lc = document.createElement("canvas"); lc.width = ART; lc.height = ART;
    const lctx = lc.getContext("2d"); lctx.imageSmoothingEnabled = false;
    lctx.drawImage(sprites.caveLava, 0, 0, ART, ART);
    lava16 = lctx.getImageData(0, 0, ART, ART).data;
  } else { lava16 = new Uint8ClampedArray(ART * ART * 4).fill(200); }

  renderHoles(g, data.water, "water", lava16);
  renderHoles(g, data.lava, "lava", lava16);

  // dirt paths
  if (sprites.cavePath) for (const key of data.path) {
    const x = key % COLS, y = (key / COLS) | 0;
    if (x >= 1 && x < COLS - 1 && y >= 1 && y < ROWS - 1) g.drawImage(sprites.cavePath, x * TILE, y * TILE, TILE, TILE);
  }

  // rock and mineral objects, drawn top-to-bottom so a lower one overlaps the ones
  // behind it. Each 48px cell is bottom-anchored, so drawing it straight onto the tile
  // sits the object on the ground.
  const objSheet = sprites.caveObjects;
  if (objSheet) {
    const keys = [...data.objects.keys()].sort((a, b) => a - b); // key = y*COLS+x -> top-to-bottom
    for (const key of keys) {
      const x = key % COLS, y = (key / COLS) | 0;
      const idx = data.objects.get(key);
      const sx = (idx % OBJ_COLS) * OBJ_CELL, sy = ((idx / OBJ_COLS) | 0) * OBJ_CELL;
      g.drawImage(objSheet, sx, sy, OBJ_CELL, OBJ_CELL, x * TILE, y * TILE, TILE, TILE);
    }
  }

  // baked border frame (edges + corners + spawn portals)
  if (sprites.caveFrame) g.drawImage(sprites.caveFrame, 0, 0);

  return cv;
}

// Generate a fresh cave map and its background. Call once when entering level 2.
export function generateLevel2(sprites) {
  const data = build();
  bgCanvas = renderBackground(sprites, data);
}

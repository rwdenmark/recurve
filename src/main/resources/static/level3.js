// Level 3: the sewer. Map generation and rendering, in the same spirit as level 2:
// a fresh random map every run, generated in the browser and painted once to an offscreen
// canvas (hidden by the fade) that the loop blits each frame. Collision and enemy
// pathfinding read the tile terrain grid, exactly like level 1 and level 2.
//
// Unlike the cave, the sewer inverts the layout: WATER is the default fill and FLOOR is
// carved into it. The base is the wall border + full water + wall spawn portals, then a 3x3
// dry center, a spaced-corridor backbone with a loop circuit on each half, and four random
// floor grates are carved. Every spawn attaches to the backbone as a dead-end leaf, so all
// are guaranteed to reach the center. A final pass fills any water cell that is not part of a
// 2x2 block, or that sits isolated inside the rim, so the autotiler always has room to draw
// correct water-to-wall and water-to-floor edges.
//
// Terrain semantics (matching the cave's water for movement/arrows):
//   WATER  blocks movement, arrows fly over it.
//   FLOOR  walkable, normal speed.
//   WALL   the border, blocks movement and arrows.
//
// Rendering is a per-cell autotiler. The 2x2 corner art (wall_corner, wall_water_corner,
// water_floor_corner) is sliced into 48px quadrants so each corner cell picks the right
// oriented quadrant. Pure of game state: game.js calls generateLevel3(sprites) then reads
// the grid and background through the query functions below.

import {
  MAP_COLS as COLS, MAP_ROWS as ROWS, PLAYER_START_X as CX, PLAYER_START_Y as CY,
} from "./mapgen.js";
import { shuffleInPlace } from "./shuffle.js";

const TILE = 48;

// Terrain codes stored in the grid.
const L3 = { WATER: 0, FLOOR: 1, WALL: 2 };

// The 3x3 dry center, reserved around the player start.
const CX0 = CX - 1, CX1 = CX + 1, CY0 = CY - 1, CY1 = CY + 1;

// The four wall spawn portals sit on the top and bottom border at cols 7 and COLS-1-7,
// with enemies entering on the interior cell just inside. Grates are chosen per run.
const PORTAL_COLS = [7, COLS - 1 - 7];
const PORTAL_INTERIOR = [
  [PORTAL_COLS[0], 1], [PORTAL_COLS[1], 1],
  [PORTAL_COLS[0], ROWS - 2], [PORTAL_COLS[1], ROWS - 2],
];

let grid = null;      // 2D array [ROWS][COLS] of L3.* codes
let bgCanvas = null;  // pre-rendered background
let spawns = [];      // [{x,y}] enemy spawn tiles (portal interiors + grates)
let grates = [];      // [[x,y]] floor-grate cells (a subset of spawns)

export function l3Background() { return bgCanvas; }
export function l3Grid() { return grid; }
export function l3Spawns() { return spawns; }

export function l3Solid(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const t = grid[y][x];
  return t === L3.WATER || t === L3.WALL;
}
export function l3BlocksProjectile(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  return grid[y][x] === L3.WALL; // water lets arrows fly over, like the cave
}
export function l3SpeedMult(/* x, y */) {
  return 1.0; // dry floor is uniform speed in the sewer
}

// ---------------------------------------------------------------------------
// Generation (DOM-free): terrain grid + spawn list
// ---------------------------------------------------------------------------

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// Chebyshev distance from a cell to the 3x3 center block.
function chebCenter(x, y) {
  const dx = Math.max(CX0 - x, 0, x - CX1);
  const dy = Math.max(CY0 - y, 0, y - CY1);
  return Math.max(dx, dy);
}
const randint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const keyOf = (x, y) => y * COLS + x;
const interiorCell = (x, y) => x >= 1 && x <= COLS - 2 && y >= 1 && y <= ROWS - 2;
const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// Corridors are routed as spaced 1-wide channels: Dijkstra with a cost that penalizes
// running alongside existing floor (RAD tiles). That keeps corridors apart so the water
// between them stays >= 2 wide (no fill-merged plazas), while a little jitter keeps them
// from being dead straight.
const ROUTE_RAD = 3, ROUTE_PEN = 12, ROUTE_JIT = 0.3;

// Chebyshev distance from the nearest floor cell, capped at RAD (flat COLS*ROWS array).
function distToFloor(floor, RAD) {
  const d = new Int8Array(COLS * ROWS).fill(RAD + 1);
  const q = [];
  for (const k of floor) { d[k] = 0; q.push(k); }
  for (let head = 0; head < q.length; head++) {
    const k = q[head];
    if (d[k] >= RAD) continue;
    const x = k % COLS, y = (k / COLS) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const nk = keyOf(nx, ny);
      if (d[nk] > d[k] + 1) { d[nk] = d[k] + 1; q.push(nk); }
    }
  }
  return d;
}

// Least-cost 4-connected path (as an array of cell keys) from a to b, avoiding proximity
// to existing floor except near the two endpoints.
function routeCells(ax, ay, bx, by, floor) {
  const d = distToFloor(floor, ROUTE_RAD);
  const A = keyOf(ax, ay), B = keyOf(bx, by);
  const cheb = (x, y, tx, ty) => Math.max(Math.abs(x - tx), Math.abs(y - ty));
  const cellCost = (x, y) => {
    let c = 1 + Math.random() * ROUTE_JIT;
    const dd = d[keyOf(x, y)];
    if (cheb(x, y, ax, ay) > 3 && cheb(x, y, bx, by) > 3 && dd < ROUTE_RAD) c += ROUTE_PEN * (ROUTE_RAD - dd);
    return c;
  };
  const best = new Float64Array(COLS * ROWS).fill(Infinity);
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  best[A] = 0;
  const heap = [[0, A]]; // tiny binary min-heap of [cost, key]
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
  const down = () => { let i = 0; for (;;) { const l = 2 * i + 1, r = 2 * i + 2; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s; } };
  while (heap.length) {
    const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; down(); }
    const cc = top[0], k = top[1];
    if (k === B) break;
    if (cc > best[k]) continue;
    const x = k % COLS, y = (k / COLS) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!interiorCell(nx, ny)) continue;
      const nk = keyOf(nx, ny);
      const nc = cc + cellCost(nx, ny);
      if (nc < best[nk]) { best[nk] = nc; prev[nk] = k; heap.push([nc, nk]); up(heap.length - 1); }
    }
  }
  const path = [];
  for (let cur = B; cur !== -1; cur = prev[cur]) { path.push(cur); if (cur === A) break; }
  return path;
}

function build() {
  grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(L3.WATER));
  for (let x = 0; x < COLS; x++) { grid[0][x] = L3.WALL; grid[ROWS - 1][x] = L3.WALL; }
  for (let y = 0; y < ROWS; y++) { grid[y][0] = L3.WALL; grid[y][COLS - 1] = L3.WALL; }

  const floor = new Set();
  const key = (x, y) => y * COLS + x;
  for (let y = CY0; y <= CY1; y++) for (let x = CX0; x <= CX1; x++) floor.add(key(x, y));

  // Four floor grates, one per quadrant so the count is guaranteed and they spread out.
  // Each stays >= 5 tiles (Chebyshev) from the 3x3 center and clear of the wall portals.
  grates = [];
  const gRegions = [[3, 10, 3, 6], [22, COLS - 4, 3, 6], [3, 10, 9, 12], [22, COLS - 4, 9, 12]];
  for (const [x0, x1, y0, y1] of gRegions) {
    let placed = null;
    for (let tries = 0; tries < 4000 && !placed; tries++) {
      const x = randint(x0, x1), y = randint(y0, y1);
      if (chebCenter(x, y) < 5) continue;
      if (PORTAL_INTERIOR.some(([px, py]) => cheb(x, y, px, py) < 4)) continue;
      if (grates.some(([gx, gy]) => cheb(x, y, gx, gy) < 4)) continue;
      placed = [x, y];
    }
    if (!placed) { // relaxed fallback so a grate is always placed
      for (let tries = 0; tries < 4000 && !placed; tries++) {
        const x = randint(x0, x1), y = randint(y0, y1);
        if (chebCenter(x, y) >= 5 && grates.every(([gx, gy]) => cheb(x, y, gx, gy) >= 3)) placed = [x, y];
      }
    }
    if (placed) grates.push(placed);
  }

  spawns = PORTAL_INTERIOR.concat(grates).map(([x, y]) => ({ x, y }));

  // Build a backbone with a loop circuit on each half (a left triangle and a right triangle
  // sharing the center) plus top/bottom cross links, so circuits are spread across the map.
  // Every spawn then attaches as a single-corridor LEAF, so spawns sit at dead ends.
  const carve = (a, b) => { for (const k of routeCells(a[0], a[1], b[0], b[1], floor)) floor.add(k); };
  const C = [CX, CY];
  const A = [randint(6, 10), randint(3, 5)], B = [randint(6, 10), randint(ROWS - 6, ROWS - 4)];
  const D = [randint(COLS - 11, COLS - 7), randint(3, 5)], E = [randint(COLS - 11, COLS - 7), randint(ROWS - 6, ROWS - 4)];
  const junctions = [C, A, B, D, E];
  for (const [a, b] of [[C, A], [A, B], [B, C], [C, D], [D, E], [E, C], [A, D], [B, E]]) carve(a, b);
  for (const [sx, sy] of PORTAL_INTERIOR.concat(grates)) {
    let j = junctions[0];
    for (const q of junctions) if (manhattan([sx, sy], q) < manhattan([sx, sy], j)) j = q;
    carve([sx, sy], j);
  }

  // Write floor into the grid.
  for (const k of floor) grid[(k / COLS) | 0][k % COLS] = L3.FLOOR;

  // Enforce: every water cell must belong to some 2x2 all-water block, otherwise fill it to
  // floor. This removes 1-wide water so the autotiler always has room for correct edges.
  const isWater = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && grid[y][x] === L3.WATER;
  const in2x2 = (x, y) => {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      let all = true;
      for (let dx = 0; dx < 2 && all; dx++) for (let dy = 0; dy < 2; dy++) {
        if (!isWater(x + ox + dx, y + oy + dy)) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  };
  const solid = (x, y) => x < 0 || x >= COLS || y < 0 || y >= ROWS || grid[y][x] !== L3.WATER;
  // A water cell the autotiler can paint cleanly must be part of a 2x2 block and must not sit at
  // a corner the tileset has no piece for (two corners "lining up", which read as a black tile).
  // The uncoverable cases: 3+ solid sides, 2 opposite solid sides, a lone interior cell wedged
  // against 2 floor diagonals, or a single-edge cell with an unsupported floor diagonal on its
  // open side. Fill any such cell to floor, iterating to a fixed point since each fill exposes more.
  const uncovered = (x, y) => {
    if (!in2x2(x, y)) return true;
    const n = solid(x, y - 1), s = solid(x, y + 1), e = solid(x + 1, y), w = solid(x - 1, y);
    const cnt = n + s + e + w;
    if (cnt >= 3) return true;
    if (cnt === 2 && ((n && s) || (e && w))) return true;
    const dse = solid(x + 1, y + 1), dsw = solid(x - 1, y + 1), dne = solid(x + 1, y - 1), dnw = solid(x - 1, y - 1);
    if (cnt === 0 && dse + dsw + dne + dnw >= 2) return true;
    if (cnt === 1) {
      if (n && (dsw || dse)) return true;
      if (s && (dnw || dne)) return true;
      if (e && (dnw || dsw)) return true;
      if (w && (dne || dse)) return true;
    }
    return false;
  };
  const openCell = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWater(x + dx, y + dy)) return false;
    return true;
  };
  // Both water-cleanup passes: fill uncoverable corners to floor, then drop any pool that has no
  // "open" (bright) core so it never renders as a flat dark tile. Factored into one function so it
  // can run again after the floor is broken up.
  const cleanWater = () => {
    for (let it = 0; it < 60; it++) {
      let any = false;
      for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++)
        if (grid[y][x] === L3.WATER && uncovered(x, y)) { grid[y][x] = L3.FLOOR; any = true; }
      if (!any) break;
    }
    const seenC = new Uint8Array(COLS * ROWS);
    const toFloor = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] !== L3.WATER || seenC[keyOf(x, y)]) continue;
      const stack = [[x, y]]; seenC[keyOf(x, y)] = 1; const comp = []; let hasOpen = false;
      while (stack.length) {
        const [cx, cy] = stack.pop(); comp.push([cx, cy]);
        if (openCell(cx, cy)) hasOpen = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] === L3.WATER && !seenC[keyOf(nx, ny)]) {
            seenC[keyOf(nx, ny)] = 1; stack.push([nx, ny]);
          }
        }
      }
      if (!hasOpen) for (const c of comp) toFloor.push(c);
    }
    for (const [cx, cy] of toFloor) grid[cy][cx] = L3.FLOOR;
  };
  cleanWater();

  // Break up large open floor into corridors: punch clean 3x3 water rooms into any floor block
  // wider than 4x4, always keeping every spawn connected to the centre over floor, then re-clean
  // the water. This gives the sewer a tighter, more corridor-like feel with more water.
  const reachesAllSpawns = () => {
    const seen = new Uint8Array(COLS * ROWS); const st = [[CX, CY]]; seen[keyOf(CX, CY)] = 1;
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] === L3.FLOOR && !seen[keyOf(nx, ny)]) {
          seen[keyOf(nx, ny)] = 1; st.push([nx, ny]);
        }
      }
    }
    return spawns.every((s) => seen[keyOf(s.x, s.y)]);
  };
  const largestFloorSquare = () => {
    const dp = Array.from({ length: ROWS }, () => new Int16Array(COLS));
    let bx = -1, by = -1, bk = 0;
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (grid[y][x] === L3.FLOOR) {
        dp[y][x] = 1 + Math.min(dp[y - 1][x], dp[y][x - 1], dp[y - 1][x - 1]);
        if (dp[y][x] > bk) { bk = dp[y][x]; bx = x; by = y; }
      }
    }
    return { bx, by, bk };
  };
  const spawnKeys = new Set(spawns.map((s) => keyOf(s.x, s.y)));
  const roomBlocked = (x, y) => spawnKeys.has(keyOf(x, y)) || (Math.abs(x - CX) <= 1 && Math.abs(y - CY) <= 1);
  const punchFloor = () => {
    for (let guard = 0; guard < 400; guard++) {
      const { bx, by, bk } = largestFloorSquare();
      if (bk < 4) break; // break any floor block 4x4+ (max floor width ~3) for tighter corridors + more water
      const scx = bx - ((bk - 1) >> 1), scy = by - ((bk - 1) >> 1); // centre of the square
      let carved = false;
      for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) {
        const cx = scx + ox, cy = scy + oy;
        const cells = []; let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 1 || nx >= COLS - 1 || ny < 1 || ny >= ROWS - 1 || grid[ny][nx] !== L3.FLOOR || roomBlocked(nx, ny)) { ok = false; break; }
          cells.push([nx, ny]);
        }
        if (!ok) continue;
        for (const [x, y] of cells) grid[y][x] = L3.WATER;
        if (reachesAllSpawns()) { carved = true; break; }
        for (const [x, y] of cells) grid[y][x] = L3.FLOOR; // reverted: would disconnect a spawn
      }
      if (!carved) break; // biggest block can't be safely reduced, stop
    }
  };
  punchFloor(); cleanWater();
  punchFloor(); cleanWater();
}

// ---------------------------------------------------------------------------
// Tile preparation (canvas ops). Guarded so a missing sprite falls back to a flat color
// and the module still generates a valid grid headless (for tests).
// ---------------------------------------------------------------------------

const WATER_RGB = [17, 25, 24];
const FLOOR_RGB = "#4c525f";
const WALL_RGB = "#2b2436";

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function rotatedTile(src, deg) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.translate(c.width / 2, c.height / 2);
  g.rotate(-deg * Math.PI / 180); // canvas rotates clockwise, negate so 90/270 match the CCW-designed tiles
  g.translate(-c.width / 2, -c.height / 2);
  g.drawImage(src, 0, 0);
  return c;
}
function toCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
function stripWhite(img) {
  const c = toCanvas(img);
  const g = c.getContext("2d");
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] >= 243 && a[i + 1] >= 243 && a[i + 2] >= 243) a[i + 3] = 0;
  }
  g.putImageData(d, 0, 0);
  return c;
}
function dataOf(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}
// Average brightness of a 2px strip on one edge of a 48px tile canvas.
function edgeBrightness(canvas, side) {
  const d = dataOf(canvas), W = canvas.width;
  let sum = 0, n = 0;
  for (let i = 0; i < 48; i++) for (let j = 0; j < 2; j++) {
    let x, y;
    if (side === "top") { x = i; y = j; }
    else if (side === "bottom") { x = i; y = 47 - j; }
    else if (side === "left") { x = j; y = i; }
    else { x = 47 - j; y = i; }
    const o = (y * W + x) * 4;
    sum += (d[o] + d[o + 1] + d[o + 2]) / 3; n++;
  }
  return sum / n;
}
// Rotate img so its brightest edge faces `wantSide`.
function orientBrightest(img, wantSide) {
  let best = null, bv = -1;
  for (const deg of [0, 90, 180, 270]) {
    const r = rotatedTile(img, deg);
    const v = edgeBrightness(r, wantSide);
    if (v > bv) { bv = v; best = r; }
  }
  return best;
}
// Quadrant (qx,qy) of a 96px canvas with the most fully-transparent pixels = the "open" one.
function openQuad(canvas) {
  const d = dataOf(canvas), W = canvas.width;
  let best = [0, 0], bc = -1;
  for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
    let c = 0;
    for (let y = qy * 48; y < qy * 48 + 48; y++) for (let x = qx * 48; x < qx * 48 + 48; x++) {
      if (d[(y * W + x) * 4 + 3] === 0) c++;
    }
    if (c > bc) { bc = c; best = [qx, qy]; }
  }
  return best;
}
function quadCanvas(src, qx, qy) {
  const c = makeCanvas(48, 48);
  c.getContext("2d").drawImage(src, qx * 48, qy * 48, 48, 48, 0, 0, 48, 48);
  return c;
}

// Build the oriented straight tiles, the sliced corner quadrant lookups, and the effect
// stamps from the loaded sprites. Returns null-ish fallbacks when a sprite is absent.
// Floor corner tile: light lip on two ADJACENT edges. Keyed by the two water sides (NE/NW/SE/SW).
function orientCorner(img) {
  const out = {};
  for (const deg of [0, 90, 180, 270]) {
    const r = rotatedTile(img, deg);
    const b = { top: edgeBrightness(r, "top"), bottom: edgeBrightness(r, "bottom"), left: edgeBrightness(r, "left"), right: edgeBrightness(r, "right") };
    const sides = Object.keys(b).sort((a, c) => b[c] - b[a]).slice(0, 2);
    const key = (sides.includes("top") ? "N" : "S") + (sides.includes("left") ? "W" : "E");
    out[key] = r;
  }
  return out;
}
// Floor "between" tile: light lip on two OPPOSITE edges (a 1-wide floor path between water).
function orientBetween(img) {
  const base = toCanvas(img);
  if (edgeBrightness(base, "left") > edgeBrightness(base, "top")) return { lr: base, tb: rotatedTile(img, 90) };
  return { tb: base, lr: rotatedTile(img, 90) };
}

function prepTiles(sprites) {
  const P = {};
  P.wall = sprites.l3Wall || null;
  P.floor = sprites.l3Floor || null;
  P.water = sprites.l3Water || null;
  P.spawn1 = sprites.l3Spawn1 || null;
  P.spawn2 = sprites.l3Spawn2 || null;
  // Grate variants keyed by which orthogonal neighbours are water (T/B/L/R), so the grate's
  // border blends into the adjacent water on each side. Missing keys fall back to the base grate.
  P.spawn2Set = {
    "": P.spawn2,
    T: sprites.l3Spawn2T, B: sprites.l3Spawn2B, L: sprites.l3Spawn2L, R: sprites.l3Spawn2R,
    TB: sprites.l3Spawn2TB, LR: sprites.l3Spawn2LR,
    TL: sprites.l3Spawn2TL, TR: sprites.l3Spawn2TR, BL: sprites.l3Spawn2BL, BR: sprites.l3Spawn2BR,
    TBL: sprites.l3Spawn2TBL, TBR: sprites.l3Spawn2TBR, TLR: sprites.l3Spawn2TLR, BLR: sprites.l3Spawn2BLR,
    TBLR: sprites.l3Spawn2TBLR,
  };

  // Border walls oriented so the light-gray ledge faces inward.
  if (P.wall) {
    P.wallTop = orientBrightest(P.wall, "bottom");
    P.wallBottom = orientBrightest(P.wall, "top");
    P.wallLeft = orientBrightest(P.wall, "right");
    P.wallRight = orientBrightest(P.wall, "left");
  }
  // water_wall straights: key = side the brick faces (toward the solid).
  if (sprites.l3WaterWall) {
    const w = sprites.l3WaterWall;
    P.ww = {
      top: toCanvas(w), bottom: rotatedTile(w, 180),
      left: rotatedTile(w, 90), right: rotatedTile(w, 270),
    };
  }
  // Floor_Next_To_Water: key = side the light lip faces (toward the wall).
  if (sprites.l3FloorNextWater) {
    P.fnw = {};
    for (const s of ["top", "bottom", "left", "right"]) P.fnw[s] = orientBrightest(sprites.l3FloorNextWater, s);
  }
  if (sprites.l3FloorNextWaterCorner) P.fnwCorner = orientCorner(sprites.l3FloorNextWaterCorner);
  if (sprites.l3FloorNextWaterBetween) P.fnwBetween = orientBetween(sprites.l3FloorNextWaterBetween);
  // Decorative water-wall variants (pipe outlets, grates), oriented like the base water_wall.
  const wwVariant = (img) => ({ top: toCanvas(img), bottom: rotatedTile(img, 180), left: rotatedTile(img, 90), right: rotatedTile(img, 270) });
  P.wwSewer = sprites.l3WaterWallSewer ? wwVariant(sprites.l3WaterWallSewer) : null;
  P.wwGrate = sprites.l3WaterWallGrate ? wwVariant(sprites.l3WaterWallGrate) : null;
  // Map corners (wall border), stripped of the white filler quadrant.
  if (sprites.l3WallCorner) {
    const c = stripWhite(sprites.l3WallCorner);
    P.mapCorner = { TL: c, TR: rotatedTile(c, 270), BR: rotatedTile(c, 180), BL: rotatedTile(c, 90) };
  }
  // Convex water corner (water pokes at a corner): key = the two solid sides.
  if (sprites.l3WallWaterCorner) {
    const c = stripWhite(sprites.l3WallWaterCorner);
    P.cwc = {};
    for (const deg of [0, 90, 180, 270]) {
      const r = rotatedTile(c, deg);
      const [ox, oy] = openQuad(r);
      const horiz = ox === 1 ? "W" : "E", vert = oy === 1 ? "N" : "S";
      P.cwc[[horiz, vert].sort().join("")] = quadCanvas(r, 1 - ox, 1 - oy);
    }
  }
  // Concave water corner (water wraps a convex floor corner): key = floor diagonal.
  if (sprites.l3WaterFloorCorner) {
    const c = stripWhite(sprites.l3WaterFloorCorner);
    P.cfc = {};
    for (const deg of [0, 90, 180, 270]) {
      const r = rotatedTile(c, deg);
      const [ox, oy] = openQuad(r);
      const horiz = ox === 1 ? "E" : "W", vert = oy === 0 ? "N" : "S"; // vertical points toward the opening
      P.cfc[horiz + vert] = quadCanvas(r, 1 - ox, 1 - oy);
    }
  }
  // Water-effect stamps: segment the sprite into motifs, key out the water background,
  // boost contrast, and scale 2x (nearest) so they read as larger crisp decals.
  P.stamps = sprites.l3Effects ? extractStamps(sprites.l3Effects) : [];
  return P;
}

function extractStamps(img) {
  const src = toCanvas(img);
  const W = src.width, H = src.height, d = dataOf(src);
  const at = (x, y) => (y * W + x) * 4;
  // Background = the water color (most common), flag foreground as anything far from it.
  const bg = WATER_RGB;
  const isFg = (x, y) => {
    const o = at(x, y);
    return Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 28;
  };
  const dil = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isFg(x, y)) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) dil[ny * W + nx] = 1;
    }
  }
  const seen = new Uint8Array(W * H);
  const stamps = [];
  const BOOST = 1.7, SCALE = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!dil[y * W + x] || seen[y * W + x]) continue;
    const stack = [[x, y]]; seen[y * W + x] = 1; const cells = [];
    while (stack.length) {
      const [cx, cy] = stack.pop(); cells.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && dil[ny * W + nx] && !seen[ny * W + nx]) {
          seen[ny * W + nx] = 1; stack.push([nx, ny]);
        }
      }
    }
    if (cells.length < 6) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const [cx, cy] of cells) { if (cx < x0) x0 = cx; if (cy < y0) y0 = cy; if (cx > x1) x1 = cx; if (cy > y1) y1 = cy; }
    const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
    const s = makeCanvas(sw, sh);
    const sg = s.getContext("2d");
    const out = sg.createImageData(sw, sh), od = out.data;
    for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
      if (!isFg(x0 + xx, y0 + yy)) continue;
      const o = at(x0 + xx, y0 + yy), oo = (yy * sw + xx) * 4;
      for (let i = 0; i < 3; i++) od[oo + i] = Math.max(0, Math.min(255, Math.round(bg[i] + (d[o + i] - bg[i]) * BOOST)));
      od[oo + 3] = 255;
    }
    sg.putImageData(out, 0, 0);
    const scaled = makeCanvas(sw * SCALE, sh * SCALE);
    const g2 = scaled.getContext("2d");
    g2.imageSmoothingEnabled = false;
    g2.drawImage(s, 0, 0, sw * SCALE, sh * SCALE);
    stamps.push(scaled);
  }
  return stamps;
}

// ---------------------------------------------------------------------------
// Background rendering (the autotiler)
// ---------------------------------------------------------------------------

const isBorder = (x, y) => x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;
const isFloorCell = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && grid[y][x] === L3.FLOOR;
const isSolidCell = (x, y) => x < 0 || x >= COLS || y < 0 || y >= ROWS || grid[y][x] !== L3.WATER;
const isWaterCell = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && grid[y][x] === L3.WATER;

function waterTile(P, x, y) {
  const n = isSolidCell(x, y - 1), s = isSolidCell(x, y + 1), e = isSolidCell(x + 1, y), w = isSolidCell(x - 1, y);
  const cnt = n + s + e + w;
  if (cnt === 1 && P.ww) return n ? P.ww.top : s ? P.ww.bottom : w ? P.ww.left : P.ww.right;
  if (cnt === 2 && P.cwc) {
    if (n && w) return P.cwc.NW; if (n && e) return P.cwc.EN; // keys sorted: "EN"=={E,N}
    if (s && w) return P.cwc.SW; if (s && e) return P.cwc.ES;
  }
  if (cnt === 0 && P.cfc) {
    if (isSolidCell(x + 1, y + 1)) return P.cfc.ES;
    if (isSolidCell(x - 1, y + 1)) return P.cfc.WS;
    if (isSolidCell(x + 1, y - 1)) return P.cfc.EN;
    if (isSolidCell(x - 1, y - 1)) return P.cfc.WN;
  }
  return P.water || null;
}
function floorTileArt(P, x, y) {
  const wU = isWaterCell(x, y - 1), wD = isWaterCell(x, y + 1), wL = isWaterCell(x - 1, y), wR = isWaterCell(x + 1, y);
  if (!(wU || wD || wL || wR)) return P.floor || null;
  // 1-wide floor path between water on two opposite sides: light lip on both.
  if (P.fnwBetween) {
    if (wU && wD && !wL && !wR) return P.fnwBetween.tb;
    if (wL && wR && !wU && !wD) return P.fnwBetween.lr;
  }
  // Two (or more) adjacent water sides: light lip wraps the corner.
  if (P.fnwCorner && (wU + wD + wL + wR) >= 2) {
    if (wU && wR) return P.fnwCorner.NE;
    if (wU && wL) return P.fnwCorner.NW;
    if (wD && wR) return P.fnwCorner.SE;
    if (wD && wL) return P.fnwCorner.SW;
  }
  // Single straight edge.
  if (P.fnw) {
    if (wU) return P.fnw.top;
    if (wD) return P.fnw.bottom;
    if (wL) return P.fnw.left;
    if (wR) return P.fnw.right;
  }
  return P.floor || null;
}

function renderBackground(sprites) {
  const P = prepTiles(sprites);
  const cv = makeCanvas(COLS * TILE, ROWS * TILE);
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;

  const openWater = [];
  const straightWalls = []; // [x,y,side] straight water_wall cells for decorative variants
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const px = x * TILE, py = y * TILE;
    if (isBorder(x, y)) {
      const t = y === 0 ? P.wallTop : y === ROWS - 1 ? P.wallBottom : x === 0 ? P.wallLeft : P.wallRight;
      if (t) g.drawImage(t, px, py); else { g.fillStyle = WALL_RGB; g.fillRect(px, py, TILE, TILE); }
    } else if (grid[y][x] === L3.FLOOR) {
      const t = floorTileArt(P, x, y);
      if (t) g.drawImage(t, px, py); else { g.fillStyle = FLOOR_RGB; g.fillRect(px, py, TILE, TILE); }
    } else {
      const t = waterTile(P, x, y);
      if (t) g.drawImage(t, px, py); else { g.fillStyle = `rgb(${WATER_RGB.join(",")})`; g.fillRect(px, py, TILE, TILE); }
      const sN = isSolidCell(x, y - 1), sS = isSolidCell(x, y + 1), sE = isSolidCell(x + 1, y), sW = isSolidCell(x - 1, y);
      if (sN + sS + sE + sW === 1) {
        const side = sN ? "top" : sS ? "bottom" : sW ? "left" : "right";
        const nx = side === "left" ? x - 1 : side === "right" ? x + 1 : x;
        const ny = side === "top" ? y - 1 : side === "bottom" ? y + 1 : y;
        straightWalls.push([x, y, side, isBorder(nx, ny)]); // 4th entry: touches the outer border wall
      }
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWaterCell(x + dx, y + dy)) { all = false; break; }
      if (all) openWater.push([x, y]);
    }
  }

  if (P.mapCorner) {
    g.drawImage(P.mapCorner.TL, 0, 0);
    g.drawImage(P.mapCorner.TR, (COLS - 2) * TILE, 0);
    g.drawImage(P.mapCorner.BL, 0, (ROWS - 2) * TILE);
    g.drawImage(P.mapCorner.BR, (COLS - 2) * TILE, (ROWS - 2) * TILE);
  }

  if (P.spawn1) {
    const bottom = rotatedTile(P.spawn1, 180);
    for (const col of PORTAL_COLS) {
      g.drawImage(P.spawn1, col * TILE, 0);
      g.drawImage(bottom, col * TILE, (ROWS - 1) * TILE);
    }
  }
  // Draw each floor grate with the variant whose border matches its water-adjacent sides.
  for (const [gx, gy] of grates) {
    const key = (isWaterCell(gx, gy - 1) ? "T" : "") + (isWaterCell(gx, gy + 1) ? "B" : "") +
                (isWaterCell(gx - 1, gy) ? "L" : "") + (isWaterCell(gx + 1, gy) ? "R" : "");
    const t = P.spawn2Set[key] || P.spawn2;
    if (t) g.drawImage(t, gx * TILE, gy * TILE);
  }

  // Decorative variants: grates (2-4) only on OUTER water-walls (those against the border,
  // not the ones lining floor paths). Pipe outlets (8-12) on any straight water-wall.
  if (P.wwSewer || P.wwGrate) {
    const used = new Set();
    const chebFar = (list, wx, wy, minD, sameSide, side) => !list.some(([px, py, ps]) => (!sameSide || ps === side) && Math.max(Math.abs(px - wx), Math.abs(py - wy)) < minD);
    if (P.wwGrate) {
      const outer = straightWalls.filter((c) => c[3]);
      shuffleInPlace(outer);
      const placed = [], target = 2 + ((Math.random() * 3) | 0);
      for (const [wx, wy, side] of outer) {
        if (placed.length >= target) break;
        if (!chebFar(placed, wx, wy, 6, false)) continue; // grates >= 6 tiles apart
        placed.push([wx, wy, side]); used.add(wy * COLS + wx); g.drawImage(P.wwGrate[side], wx * TILE, wy * TILE);
      }
    }
    if (P.wwSewer) {
      const rest = straightWalls.filter((c) => !used.has(c[1] * COLS + c[0]));
      shuffleInPlace(rest);
      const placed = [], target = 8 + ((Math.random() * 5) | 0);
      for (const [wx, wy, side] of rest) {
        if (placed.length >= target) break;
        if (!chebFar(placed, wx, wy, 3, true, side)) continue; // sewers >= 3 apart on the same wall
        placed.push([wx, wy, side]); g.drawImage(P.wwSewer[side], wx * TILE, wy * TILE);
      }
    }
  }

  if (P.stamps.length) {
    shuffleInPlace(openWater);
    const n = Math.min(16, openWater.length);
    for (let i = 0; i < n; i++) {
      const [wx, wy] = openWater[i];
      const s = P.stamps[(Math.random() * P.stamps.length) | 0];
      const cxp = wx * TILE + TILE / 2 + randint(-6, 6);
      const cyp = wy * TILE + TILE / 2 + randint(-6, 6);
      g.drawImage(s, Math.round(cxp - s.width / 2), Math.round(cyp - s.height / 2));
    }
  }

  return cv;
}

export function generateLevel3(sprites) {
  build();
  bgCanvas = renderBackground(sprites || {});
}

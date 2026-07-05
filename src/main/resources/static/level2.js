// Level 2 (the cave) map generation and rendering. Built the same way level 1 is:
// a fresh random map every run, generated in the browser. Unlike level 1's simple
// per-tile sprite blits, the cave's water/lava edges are pixel effects (foam froth on
// water, black char on lava), so the whole map is generated and painted to an
// offscreen canvas once when level 2 loads (hidden by the fade), then blitted each
// frame. Collision and enemy pathfinding read the tile terrain grid, exactly like
// level 1's tileMap. Pure of game state: game.js calls generateLevel2() then reads the
// grid and background through the query functions below.

import { MAP_COLS as COLS, MAP_ROWS as ROWS, PLAYER_START_X as CX, PLAYER_START_Y as CY } from "./mapgen.js";

const TILE = 48;
const ART = 16;                 // art-resolution pixels per tile for the froth/char
const AW = COLS * ART, AH = ROWS * ART;

// Terrain codes stored in the grid.
export const L2 = { FLOOR: 0, PATH: 1, WATER: 2, LAVA: 3, WALL: 4, STAL: 5 };

// The six troll spawn points: the interior tile just in front of each border portal
// (portals sit at cols 2,16,29 on the top and bottom rows).
export const L2_SPAWNS = [[2, 1], [16, 1], [29, 1], [2, 14], [16, 14], [29, 14]];

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const k = (x, y) => y * COLS + x;
const FORTSET = new Set(L2_SPAWNS.map(([x, y]) => k(x, y)));
const isFort = (x, y) => FORTSET.has(k(x, y));

let grid = null;      // 2D array [ROWS][COLS] of L2.* codes
let bgCanvas = null;  // pre-rendered background

export function l2Background() { return bgCanvas; }
export function l2Grid() { return grid; }

export function l2Solid(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const t = grid[y][x];
  return t === L2.WATER || t === L2.LAVA || t === L2.WALL || t === L2.STAL;
}
export function l2BlocksProjectile(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  const t = grid[y][x];
  return t === L2.WALL || t === L2.STAL;
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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const RW = 0.33;
// A wandering but center-bound one-tile route from a spawn to the middle.
function wanderRoute(sx, sy) {
  const route = [[sx, sy]];
  const inI = (x, y) => x >= 1 && x < COLS - 1 && y >= 1 && y < ROWS - 1;
  const offR = (x, y) => x >= 2 && x < COLS - 2 && y >= 2 && y < ROWS - 2;
  const ok = (nx, ny) => (route.length === 1 ? inI(nx, ny) : offR(nx, ny));
  let x = sx, y = sy, px = -1, py = -1, s = 0;
  while ((x !== CX || y !== CY) && s < 400) {
    s++;
    const rX = CX - x, rY = CY - y, tw = [];
    if (rX) tw.push([Math.sign(rX), 0]);
    if (rY) tw.push([0, Math.sign(rY)]);
    tw.sort((a, b) => (b[0] !== 0 ? Math.abs(rX) : Math.abs(rY)) - (a[0] !== 0 ? Math.abs(rX) : Math.abs(rY)));
    const wander = Math.abs(rX) + Math.abs(rY) > 2 && s < 200 && Math.random() < RW;
    let cand;
    if (wander) {
      const perp = [];
      if (rX === 0) perp.push([1, 0], [-1, 0]);
      if (rY === 0) perp.push([0, 1], [0, -1]);
      if (rX && rY) perp.push([0, 1], [0, -1], [1, 0], [-1, 0]);
      cand = shuffle(perp.concat(tw));
    } else cand = tw;
    let mv = false;
    for (const [dx, dy] of cand) {
      const nx = x + dx, ny = y + dy;
      if (!ok(nx, ny) || isFort(nx, ny) || (nx === px && ny === py)) continue;
      px = x; py = y; x = nx; y = ny; route.push([x, y]); mv = true; break;
    }
    if (!mv) {
      for (const [dx, dy] of tw) {
        const nx = x + dx, ny = y + dy;
        if (!ok(nx, ny) || isFort(nx, ny)) continue;
        px = x; py = y; x = nx; y = ny; route.push([x, y]); mv = true; break;
      }
      if (!mv) break;
    }
  }
  while (x !== CX || y !== CY) {
    const dx = Math.sign(CX - x), dy = Math.sign(CY - y);
    if (dx && (Math.abs(CX - x) >= Math.abs(CY - y) || dy === 0)) x += dx; else y += dy;
    route.push([x, y]);
  }
  return route;
}

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

// Remove single-tile spurs (a cell with <=1 orthogonal neighbour).
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

// Place n organic holes on open floor, buffered one tile from reserved/other holes.
function placeHoles(n, reserved, others, rxR, ryR, minSize) {
  const out = new Set();
  const blocked = (key) => {
    const x = key % COLS, y = (key / COLS) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nk = k(x + dx, y + dy);
      if (reserved.has(nk) || others.has(nk) || out.has(nk) || FORTSET.has(nk)) return true;
    }
    return !(x >= 2 && x < COLS - 2 && y >= 2 && y < ROWS - 2);
  };
  let made = 0, att = 0;
  while (made < n && att < 800) {
    att++;
    const hx = 4 + ((Math.random() * (COLS - 9)) | 0);
    const hy = 3 + ((Math.random() * (ROWS - 6)) | 0);
    const rx = rxR[0] + Math.random() * (rxR[1] - rxR[0]);
    const ry = ryR[0] + Math.random() * (ryR[1] - ryR[0]);
    const blob = trimSpurs(holeTiles(hx, hy, rx, ry));
    if (blob.size < minSize) continue;
    let bad = false;
    for (const key of blob) if (blocked(key)) { bad = true; break; }
    if (bad) continue;
    for (const key of blob) out.add(key);
    made++;
  }
  return fillHoles(trimSpurs(out));
}

// ---------------------------------------------------------------------------
// Map assembly
// ---------------------------------------------------------------------------

function build() {
  grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(L2.FLOOR));
  for (let x = 0; x < COLS; x++) { grid[0][x] = L2.WALL; grid[ROWS - 1][x] = L2.WALL; }
  for (let y = 0; y < ROWS; y++) { grid[y][0] = L2.WALL; grid[y][COLS - 1] = L2.WALL; }

  let path = new Set();
  const reserved = new Set();
  const center3 = new Set();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    center3.add(k(CX + dx, CY + dy)); path.add(k(CX + dx, CY + dy)); reserved.add(k(CX + dx, CY + dy));
  }
  // draw every route so all six spawns connect
  for (const [sx, sy] of L2_SPAWNS) {
    for (const [x, y] of wanderRoute(sx, sy)) {
      reserved.add(k(x, y));
      if (x >= 1 && x < COLS - 1 && y >= 1 && y < ROWS - 1) path.add(k(x, y));
    }
  }
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
  path = seen;
  for (const p of path) reserved.add(p);

  const water = placeHoles(2, reserved, new Set(), [1.9, 3.0], [1.5, 2.2], 9);
  for (const p of water) reserved.add(p);
  const lava = placeHoles(2, reserved, water, [1.6, 2.5], [1.3, 1.9], 8);
  for (const p of lava) reserved.add(p);

  // stalagmite obstacles on open floor, spaced apart
  const stal = new Set();
  const free = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    const key = k(x, y);
    if (!reserved.has(key) && !isFort(x, y)) free.push(key);
  }
  shuffle(free);
  for (const key of free) {
    if (stal.size >= 10) break;
    const x = key % COLS, y = (key / COLS) | 0;
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1; dy++) if (stal.has(k(x + dx, y + dy))) { near = true; break; }
    if (!near) stal.add(key);
  }

  // write terrain codes
  for (const key of path) { const x = key % COLS, y = (key / COLS) | 0; if (grid[y][x] === L2.FLOOR) grid[y][x] = L2.PATH; }
  for (const key of water) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.WATER; }
  for (const key of lava) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.LAVA; }
  for (const key of stal) { const x = key % COLS, y = (key / COLS) | 0; grid[y][x] = L2.STAL; }

  return { path, water, lava, stal };
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
const SCATTER_TILES = [[2, 7], [2, 8]];

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

  // scatter (mounds / pits) on some open floor
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (grid[y][x] !== L2.FLOOR) continue;
    if (Math.random() < 0.05 && sheet) {
      const [sx, sy] = SCATTER_TILES[(Math.random() * SCATTER_TILES.length) | 0];
      g.drawImage(sheet, sx * 16, sy * 16, 16, 16, x * TILE, y * TILE, TILE, TILE);
    }
  }

  // stalagmites
  if (sprites.caveStalagmite) for (const key of data.stal) {
    const x = key % COLS, y = (key / COLS) | 0;
    if (Math.random() < 0.5) {
      g.drawImage(sprites.caveStalagmite, x * TILE, y * TILE, TILE, TILE);
    } else {
      g.save();
      g.translate((x + 1) * TILE, y * TILE);
      g.scale(-1, 1);
      g.drawImage(sprites.caveStalagmite, 0, 0, TILE, TILE);
      g.restore();
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

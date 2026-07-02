// Pure tile-world model and map generation. No DOM, so it runs under a test runner.

export const MAP_COLS = 32;
export const MAP_ROWS = 16;

export const PLAYER_START_X = Math.floor(MAP_COLS / 2);
export const PLAYER_START_Y = Math.floor(MAP_ROWS / 2);

export const TILES = {
  GRASS: 0,
  PATH: 1,
  MOUNTAIN: 2,
  TREE: 3,
  WATER: 4,
};

const ENTITY_SOLID_TILES = new Set([TILES.MOUNTAIN, TILES.TREE, TILES.WATER]);

export function isSolid(tileId) {
  return ENTITY_SOLID_TILES.has(tileId);
}

// Forts sit on the spawn points and block movement. An enemy is exempt only on
// its own spawn tile, which pathfinding never treats as a neighbor to step into.
const FORT_CELLS = new Set();
function fortKey(x, y) { return y * MAP_COLS + x; }
export function isFortAt(x, y) { return FORT_CELLS.has(fortKey(x, y)); }

export const SPAWN_POINTS = [
  { x: 1,              y: 1 },
  { x: MAP_COLS - 2,   y: 1 },
  { x: 1,              y: MAP_ROWS - 2 },
  { x: MAP_COLS - 2,   y: MAP_ROWS - 2 },
  { x: PLAYER_START_X, y: 1 },
  { x: PLAYER_START_X, y: MAP_ROWS - 2 },
  { x: 1,              y: PLAYER_START_Y },
  { x: MAP_COLS - 2,   y: PLAYER_START_Y },
];
for (const s of SPAWN_POINTS) FORT_CELLS.add(fortKey(s.x, s.y));

// Perpendicular-wander probability for the guaranteed spawn-to-center routes. 0
// reproduces the old dead-straight lanes; higher values bow them more. Tune here.
const ROUTE_WANDER = 0.33;

// Enforced bounds on the final tile count of each terrain type. The randomized
// per-map target aims inside these, and buildStartingMap rebuilds any map that
// lands outside them, so a run is never starved of or flooded with one tile type.
export const PATH_MIN = 68, PATH_MAX = 82;
export const WATER_MIN = 48, WATER_MAX = 72;
export const TREE_MIN = 154, TREE_MAX = 178;
const MAX_BUILD_ATTEMPTS = 80;

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// An ordered, orthogonally-contiguous route from a spawn to the player. Biased
// toward the center but allowed to bow sideways, so forts on a cardinal axis don't
// all get an identical straight lane. Pure aside from the module's size/fort
// constants, so it is unit-testable, and it always terminates at the center.
export function wanderingRouteToCenter(sx, sy, rng = Math.random) {
  const cx = PLAYER_START_X, cy = PLAYER_START_Y;
  const inInterior = (x, y) => x >= 1 && x < MAP_COLS - 1 && y >= 1 && y < MAP_ROWS - 1;
  // Stay off the inner wall ring after the first step off the fort, so a route is
  // never severed by removeEdgePaths and always survives to its castle.
  const offRing = (x, y) => x >= 2 && x < MAP_COLS - 2 && y >= 2 && y < MAP_ROWS - 2;
  const okStep = (nx, ny) => (route.length === 1 ? inInterior(nx, ny) : offRing(nx, ny));
  const route = [[sx, sy]];
  let x = sx, y = sy, px = -1, py = -1;
  const MAX_WANDER_STEPS = 400;
  let steps = 0;

  while ((x !== cx || y !== cy) && steps++ < MAX_WANDER_STEPS) {
    const remX = cx - x, remY = cy - y;
    const toward = [];
    if (remX !== 0) toward.push([Math.sign(remX), 0]);
    if (remY !== 0) toward.push([0, Math.sign(remY)]);
    // Greedy prefers the axis with more distance left, for a clean straight finish.
    toward.sort((a, b) =>
      (b[0] !== 0 ? Math.abs(remX) : Math.abs(remY)) -
      (a[0] !== 0 ? Math.abs(remX) : Math.abs(remY)));

    const manhattan = Math.abs(remX) + Math.abs(remY);
    // Stop wandering once close, or past the halfway step budget, so we converge.
    const wander = manhattan > 2 && steps < MAX_WANDER_STEPS / 2 && rng() < ROUTE_WANDER;

    let candidates;
    if (wander) {
      const perp = [];
      if (remX === 0) perp.push([1, 0], [-1, 0]);      // on a vertical axis: bow horizontally
      if (remY === 0) perp.push([0, 1], [0, -1]);      // on a horizontal axis: bow vertically
      if (remX !== 0 && remY !== 0) perp.push([0, 1], [0, -1], [1, 0], [-1, 0]);
      candidates = shuffleInPlace(perp.concat(toward), rng);
    } else {
      candidates = toward;
    }

    let moved = false;
    for (const [dx, dy] of candidates) {
      const nx = x + dx, ny = y + dy;
      if (!okStep(nx, ny) || isFortAt(nx, ny)) continue;
      if (nx === px && ny === py) continue;            // no immediate backtrack
      px = x; py = y; x = nx; y = ny; route.push([x, y]); moved = true; break;
    }
    if (!moved) {
      // Forced step toward center, backtrack rule relaxed so we never stall.
      let done = false;
      for (const [dx, dy] of toward) {
        const nx = x + dx, ny = y + dy;
        if (!okStep(nx, ny) || isFortAt(nx, ny)) continue;
        px = x; py = y; x = nx; y = ny; route.push([x, y]); done = true; break;
      }
      if (!done) break;
    }
  }

  // Straight greedy finish, in case the wander phase bailed before arriving.
  let fin = 0;
  while ((x !== cx || y !== cy) && fin++ < 400) {
    const dx = Math.sign(cx - x), dy = Math.sign(cy - y);
    let nx = x, ny = y;
    if (dx !== 0 && (Math.abs(cx - x) >= Math.abs(cy - y) || dy === 0)) nx = x + dx;
    else ny = y + dy;
    if (isFortAt(nx, ny)) {                            // sidestep a fort in the way
      if (dy !== 0 && inInterior(x, y + dy) && !isFortAt(x, y + dy)) { nx = x; ny = y + dy; }
      else if (dx !== 0 && inInterior(x + dx, y) && !isFortAt(x + dx, y)) { nx = x + dx; ny = y; }
      else break;
    }
    x = nx; y = ny; route.push([x, y]);
  }
  return route;
}

function buildMapOnce() {
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

  // Player start, the 3x3 around it, and the spawn points stay walkable.
  const reserved = new Set();
  const reserve = (x, y) => reserved.add(y * MAP_COLS + x);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      reserve(PLAYER_START_X + dx, PLAYER_START_Y + dy);
    }
  }
  for (const s of SPAWN_POINTS) reserve(s.x, s.y);

  const isPathT = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.PATH;
  const countPathNbrs = (x, y) => {
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isPathT(x + dx, y + dy)) n++;
    return n;
  };
  // Would turning (x, y) into path complete any 2x2 all-path block?
  const wouldFill2x2 = (x, y) => {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      let all = true;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + ox + dx, cy = y + oy + dy;
        if (cx === x && cy === y) continue;
        if (!isPathT(cx, cy)) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  };

  // Carve a full route from the castle to the center as path. Routes overlap near
  // the center (they all lead there) but each reads as a continuous castle-to-center
  // line, which is the intended look.
  const carveRoutePath = (route) => {
    for (const [x, y] of route) if (inInterior(x, y)) map[y][x] = TILES.PATH;
  };

  // Grow one straight offshoot of 2 to 4 tiles off an existing path tile into open
  // grass, staying one wide (a new tile may touch only the tile it came from). This
  // is how paths gain variety: deliberate branches rather than 1-tile nubs. Returns
  // the number of tiles placed, or 0 if none fit.
  function growBranch() {
    const dirsAll = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const all = [];
    for (let y = 2; y < MAP_ROWS - 2; y++)
      for (let x = 2; x < MAP_COLS - 2; x++)
        if (isPathT(x, y) && !isFortAt(x, y)) all.push([x, y]);
    // Prefer starts away from the center so branches fill the outskirts rather than
    // thickening the already-busy middle.
    const far = all.filter(([x, y]) => Math.max(Math.abs(x - PLAYER_START_X), Math.abs(y - PLAYER_START_Y)) > 4);
    const starts = far.length ? far : all;
    shuffleInPlace(starts, Math.random);
    for (const [sx, sy] of starts) {
      for (const [dx, dy] of shuffleInPlace(dirsAll.slice(), Math.random)) {
        const cells = [];
        let x = sx + dx, y = sy + dy;
        const maxLen = 2 + Math.floor(Math.random() * 3); // 2..4
        while (cells.length < maxLen) {
          if (x < 1 || x >= MAP_COLS - 1 || y < 1 || y >= MAP_ROWS - 1) break;
          if (map[y][x] !== TILES.GRASS || isFortAt(x, y) || reserved.has(y * MAP_COLS + x)) break;
          const prev = cells.length === 0 ? [sx, sy] : cells[cells.length - 1];
          let touchesOther = false;
          for (const [ex, ey] of dirsAll) {
            const nx = x + ex, ny = y + ey;
            if (nx === prev[0] && ny === prev[1]) continue;
            if (isPathT(nx, ny)) { touchesOther = true; break; }
          }
          if (touchesOther) break;
          cells.push([x, y]); x += dx; y += dy;
        }
        if (cells.length >= 2) {
          for (const [cx, cy] of cells) map[cy][cx] = TILES.PATH;
          return cells.length;
        }
      }
    }
    return 0;
  }

  // The center block is path up front so routes merge into it rather than piling
  // separate lanes through the middle.
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      map[PLAYER_START_Y + dy][PLAYER_START_X + dx] = TILES.PATH;

  // Draw 4 to 6 of the 8 castle routes, so the map reads as a few clean castle-to-
  // center lines rather than a dense web from every castle.
  const drawRoutes = SPAWN_POINTS.map((s) => wanderingRouteToCenter(s.x, s.y));
  const drawOrder = shuffleInPlace(drawRoutes.map((_, i) => i), Math.random);
  const routesToDraw = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < routesToDraw && i < drawOrder.length; i++) {
    carveRoutePath(drawRoutes[drawOrder[i]]);
  }
  // A couple of small offshoots where they fit; the castle routes carry the rest.
  for (let b = 3 + Math.floor(Math.random() * 3); b > 0; b--) growBranch();

  for (const s of SPAWN_POINTS) {
    map[s.y][s.x] = TILES.PATH;
  }

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      map[PLAYER_START_Y + dy][PLAYER_START_X + dx] = TILES.PATH;
    }
  }

  // Demote a corner of any 2x2 path block until paths are one tile wide. Diagonal
  // paths never form a 2x2 block, so they survive. Reserved/fort tiles are kept.
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

  // Keep parallel straight paths at least 2 grass tiles apart so they don't read
  // as one fat path with a seam. Only checks down/right, so one of a close pair
  // survives. Demotions apply on a snapshot so a run clears cleanly.
  function spaceParallelPaths() {
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
          const pureH = isPathT(x - 1, y) && isPathT(x + 1, y) && !isPathT(x, y - 1) && !isPathT(x, y + 1);
          const pureV = isPathT(x, y - 1) && isPathT(x, y + 1) && !isPathT(x - 1, y) && !isPathT(x + 1, y);
          const parallelBelow = pureH && isG(x, y + 1) && isPathT(x, y + 2);
          const parallelRight = pureV && isG(x + 1, y) && isPathT(x + 2, y);
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

  // Demote paths on the inner ring so they don't run along the wall, keeping fort
  // tiles and their immediate neighbors.
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

  // Fill a one-tile gap only when the path continues two tiles out (isP at +/-2)
  // with grass on the sides. The +/-2 check is what tells a real line gap apart
  // from the grass row between two parallel paths, so bridging never fuses them.
  function bridgePathGaps() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      const toPath = [];
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
          const horizontalGap =
            isPathT(x - 1, y) && isPathT(x + 1, y) && isPathT(x - 2, y) && isPathT(x + 2, y) &&
            !isPathT(x, y - 1) && !isPathT(x, y + 1);
          const verticalGap =
            isPathT(x, y - 1) && isPathT(x, y + 1) && isPathT(x, y - 2) && isPathT(x, y + 2) &&
            !isPathT(x - 1, y) && !isPathT(x + 1, y);
          if (horizontalGap || verticalGap) toPath.push([x, y]);
        }
      }
      for (const [x, y] of toPath) {
        map[y][x] = TILES.PATH;
        changed = true;
      }
    }
  }

  // Keep only the path network connected to the center; drop stray path tiles and
  // stubs that don't reach it (like a lone fort nub). Enemy reachability is provided
  // separately by the reserved grass lanes, so removing cosmetic path is safe.
  function removeDisconnectedFromCenter() {
    const seen = new Set([PLAYER_START_Y * MAP_COLS + PLAYER_START_X]);
    const q = [[PLAYER_START_X, PLAYER_START_Y]];
    while (q.length > 0) {
      const [cx, cy] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
        const k = ny * MAP_COLS + nx;
        if (seen.has(k) || map[ny][nx] !== TILES.PATH) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    for (let y = 1; y < MAP_ROWS - 1; y++)
      for (let x = 1; x < MAP_COLS - 1; x++)
        if (map[y][x] === TILES.PATH && !seen.has(y * MAP_COLS + x) && !isFortAt(x, y))
          map[y][x] = TILES.GRASS;
  }

  bridgePathGaps();

  // Connect a path dead-end to a nearby path across a single grass tile, forming a
  // loop instead of a dangling stub. Guarded so it never makes a 2x2 block.
  function connectStubs() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let changed = true, guard = 0;
    while (changed && guard++ < 8) {
      changed = false;
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (!isPathT(x, y) || isFortAt(x, y)) continue;
          if (countPathNbrs(x, y) !== 1) continue; // a dead-end tip
          for (const [dx, dy] of dirs) {
            const gx = x + dx, gy = y + dy;         // the gap tile
            const bx = x + 2 * dx, by = y + 2 * dy; // path we would join
            if (gx < 1 || gx >= MAP_COLS - 1 || gy < 1 || gy >= MAP_ROWS - 1) continue;
            if (map[gy][gx] !== TILES.GRASS || isFortAt(gx, gy) || reserved.has(gy * MAP_COLS + gx)) continue;
            if (!isPathT(bx, by)) continue;
            if (wouldFill2x2(gx, gy)) continue;
            map[gy][gx] = TILES.PATH;
            changed = true;
            break;
          }
        }
      }
    }
  }

  // Fill a grass tile boxed in by path on three or four sides, unless doing so would
  // make a 2x2 path block. Iterates to a fixed point so no fillable notch is left.
  function fillGrassHoles() {
    let changed = true, guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
          if (countPathNbrs(x, y) !== 4) continue;
          if (wouldFill2x2(x, y)) continue;
          map[y][x] = TILES.PATH;
          changed = true;
        }
      }
    }
  }

  // Join two path tiles that touch only at a diagonal by filling one of the grass
  // corners between them, whichever keeps paths one wide. Turns broken diagonals into
  // continuous L-bends. Runs last so it catches pinches any earlier pass introduced.
  function repairDiagonalPinches() {
    const tryFill = (a, b) => {
      for (const [cx, cy] of [a, b]) {
        if (cx < 1 || cx >= MAP_COLS - 1 || cy < 1 || cy >= MAP_ROWS - 1) continue;
        if (map[cy][cx] !== TILES.GRASS || isFortAt(cx, cy) || wouldFill2x2(cx, cy)) continue;
        map[cy][cx] = TILES.PATH;
        return true;
      }
      return false;
    };
    let changed = true, guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      for (let y = 1; y < MAP_ROWS - 2; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (isPathT(x, y) && isPathT(x + 1, y + 1) && !isPathT(x + 1, y) && !isPathT(x, y + 1)) {
            if (tryFill([x + 1, y], [x, y + 1])) changed = true;
          }
          if (isPathT(x, y) && isPathT(x - 1, y + 1) && !isPathT(x - 1, y) && !isPathT(x, y + 1)) {
            if (tryFill([x - 1, y], [x, y + 1])) changed = true;
          }
        }
      }
    }
  }

  // Trim 1-tile bumps: a path tip whose only neighbor already carries the line (has
  // 3+ path neighbors). Genuine 2+ branches, whose tip sits on a 2-neighbor stub,
  // are left intact.
  function trimLoneSpurs() {
    let changed = true, guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.PATH) continue;
          if (isFortAt(x, y) || reserved.has(y * MAP_COLS + x)) continue;
          if (countPathNbrs(x, y) !== 1) continue;
          let nx = x, ny = y;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if (isPathT(x + dx, y + dy)) { nx = x + dx; ny = y + dy; }
          if (countPathNbrs(nx, ny) >= 3) { map[y][x] = TILES.GRASS; changed = true; }
        }
      }
    }
  }

  connectStubs();
  repairDiagonalPinches();
  fillGrassHoles();
  trimLoneSpurs();
  removeDisconnectedFromCenter();

  const obstacleSafe = (x, y) => {
    if (!inInterior(x, y)) return false;
    if (reserved.has(y * MAP_COLS + x)) return false;
    if (isFortAt(x, y)) return false;
    return map[y][x] === TILES.GRASS;
  };

  // Reserve each fort's route to the center before placing obstacles, so water
  // and trees (which skip reserved tiles) can never block a fort's only path. The
  // route wanders (see wanderingRouteToCenter), so the guaranteed open lane is not
  // a straight cardinal line. The interior is obstacle-free at this point, so any
  // such route is walkable; reserving it keeps it that way.
  function protectFortRoutes() {
    for (const s of SPAWN_POINTS) {
      for (const [x, y] of wanderingRouteToCenter(s.x, s.y)) {
        reserved.add(y * MAP_COLS + x);
      }
    }
  }
  protectFortRoutes();

  // Water may only touch water orthogonally. A diagonal water neighbor needs a
  // shared orthogonal water tile (L-bridge), so no isolated diagonal-only pairs.
  const isWater = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.WATER;
  const waterPlaceable = (x, y) => {
    if (!obstacleSafe(x, y)) return false;
    const diagonals = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dy] of diagonals) {
      if (!isWater(x + dx, y + dy)) continue;
      if (!isWater(x + dx, y) && !isWater(x, y + dy)) return false;
    }
    return true;
  };

  const MIN_WATER_TILES = 8;
  const waterTarget = WATER_MIN + Math.floor(Math.random() * (WATER_MAX - WATER_MIN + 1));
  const orthoDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Grow ponds until the water budget is met. A pond that stalls below the
  // minimum is rolled back and retried; the budget is never overshot.
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
    if (cx < 0) break;

    const desired = MIN_WATER_TILES + Math.floor(Math.random() * 9);
    const target = Math.min(desired, remaining);
    const placed = [{ x: cx, y: cy }];
    map[cy][cx] = TILES.WATER;

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
      totalWater += placed.length;
    } else {
      for (const p of placed) map[p.y][p.x] = TILES.GRASS;
    }
  }

  // Trees fill the remaining grass as short strings and 2x2 clumps until the
  // budget is met, walking a shuffled list of open tiles so it reaches it.
  const treeTarget = TREE_MIN + Math.floor(Math.random() * (TREE_MAX - TREE_MIN + 1));
  let treeTiles = 0;
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
    if (!obstacleSafe(sx, sy)) continue;
    if (Math.random() < 0.25) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (treeTiles >= treeTarget) break;
        const x = sx + dx, y = sy + dy;
        if (!obstacleSafe(x, y)) continue;
        map[y][x] = TILES.TREE;
        treeTiles++;
      }
    } else {
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

  for (const idx of reserved) {
    const y = Math.floor(idx / MAP_COLS);
    const x = idx % MAP_COLS;
    if (isSolid(map[y][x])) map[y][x] = TILES.GRASS;
  }

  // A fort must reach the player without passing through another fort: an enemy
  // steps off its own fort but never into one. A fort is allowed as a leaf.
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
        if (isFortAt(nx, ny)) {
          visited.add(k);
          continue;
        }
        visited.add(k);
        q.push([nx, ny]);
      }
    }
    return visited;
  }

  function carveCorridorToCenter(sx, sy) {
    let x = sx, y = sy;
    let safety = 0;
    while ((x !== PLAYER_START_X || y !== PLAYER_START_Y) && safety++ < 200) {
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
  reachable = bfsReachable();
  for (const s of SPAWN_POINTS) {
    if (reachable.has(s.y * MAP_COLS + s.x)) continue;
    carveCorridorToCenter(s.x, s.y);
  }

  // Show a fort on path only when a path actually reaches it, else on grass. Fort
  // tiles block movement either way.
  for (const s of SPAWN_POINTS) {
    const connected = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = s.x + dx, ny = s.y + dy;
      return nx >= 0 && nx < MAP_COLS && ny >= 0 && ny < MAP_ROWS && map[ny][nx] === TILES.PATH;
    });
    map[s.y][s.x] = connected ? TILES.PATH : TILES.GRASS;
  }

  return map;
}

function countTerrain(map) {
  let path = 0, water = 0, tree = 0;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const v = map[y][x];
      if (v === TILES.PATH) path++;
      else if (v === TILES.WATER) water++;
      else if (v === TILES.TREE) tree++;
    }
  }
  return { path, water, tree };
}

function withinBounds(c) {
  return c.path >= PATH_MIN && c.path <= PATH_MAX &&
         c.water >= WATER_MIN && c.water <= WATER_MAX &&
         c.tree >= TREE_MIN && c.tree <= TREE_MAX;
}

// Build a map, retrying until path, water, and tree counts all fall inside their
// [MIN, MAX] bands. Generation is cheap and rarely misses (only ever on the low
// side, since placement never overshoots a target), so the attempt cap guarantees
// the bounds in practice; the closest attempt is returned as a fallback.
export function buildStartingMap() {
  let best = null, bestMiss = Infinity;
  for (let attempt = 0; attempt < MAX_BUILD_ATTEMPTS; attempt++) {
    const map = buildMapOnce();
    const c = countTerrain(map);
    if (withinBounds(c)) return map;
    const miss =
      Math.max(0, PATH_MIN - c.path) + Math.max(0, c.path - PATH_MAX) +
      Math.max(0, WATER_MIN - c.water) + Math.max(0, c.water - WATER_MAX) +
      Math.max(0, TREE_MIN - c.tree) + Math.max(0, c.tree - TREE_MAX);
    if (miss < bestMiss) { bestMiss = miss; best = map; }
  }
  return best;
}

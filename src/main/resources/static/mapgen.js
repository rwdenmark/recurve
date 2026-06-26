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

export function buildStartingMap() {
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
  const pathCount = 8 + Math.floor(Math.random() * 4);
  for (let i = 0; i < pathCount; i++) {
    if (Math.random() < 0.7) {
      const s = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      carveBetween(s.x, s.y, PLAYER_START_X, PLAYER_START_Y);
    } else {
      carveEdgeToEdge();
    }
  }

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
    const isP = (x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.PATH;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      const toPath = [];
      for (let y = 1; y < MAP_ROWS - 1; y++) {
        for (let x = 1; x < MAP_COLS - 1; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
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

  // Drop stray path groups smaller than MIN_PATH_RUN unless anchored to the start
  // block or a fort.
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
        if (!anchored && group.length < MIN_PATH_RUN) {
          for (const [px, py] of group) map[py][px] = TILES.GRASS;
        }
      }
    }
  }

  bridgePathGaps();
  removePathFragments();

  // Bring the path-tile count into a target band: peel dead-end tips when over,
  // extend a tip into open grass when under. Both keep paths width-1 and connected.
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
    const wouldForm2x2 = (x, y) => {
      const corners = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
      for (const [ox, oy] of corners) {
        let all = true;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const cx = x + ox + dx, cy = y + oy + dy;
          if (cx === x && cy === y) continue;
          if (!isPath(cx, cy)) { all = false; break; }
        }
        if (all) return true;
      }
      return false;
    };
    let count = 0;
    for (let y = 1; y < MAP_ROWS - 1; y++)
      for (let x = 1; x < MAP_COLS - 1; x++) if (map[y][x] === TILES.PATH) count++;

    // Prefer a dead-end tip; if only loops remain, break one to create fresh tips.
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

    guard = 0;
    while (count < target && guard++ < 4000) {
      const candidates = [];
      for (let y = 2; y < MAP_ROWS - 2; y++) {
        for (let x = 2; x < MAP_COLS - 2; x++) {
          if (map[y][x] !== TILES.GRASS) continue;
          if (onInnerRing(x, y)) continue;
          if (orthoPathCount(x, y) !== 1) continue;
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
  const pathTarget = 56 + Math.floor(Math.random() * 17);
  adjustPathTiles(pathTarget);

  const obstacleSafe = (x, y) => {
    if (!inInterior(x, y)) return false;
    if (reserved.has(y * MAP_COLS + x)) return false;
    if (isFortAt(x, y)) return false;
    return map[y][x] === TILES.GRASS;
  };

  // Reserve each fort's route to the center before placing obstacles, so water
  // and trees (which skip reserved tiles) can never block a fort's only path.
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
        if (isFortAt(nx, ny)) continue;
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
  const waterTarget = 48 + Math.floor(Math.random() * 25);
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
  const treeTarget = 144 + Math.floor(Math.random() * 25);
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

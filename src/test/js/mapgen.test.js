// Property tests for buildStartingMap. The generator promises a set of invariants
// (every fort reachable, paths width-1, water orthogonally connected) that are
// asserted only by construction in the source, so verify them over many runs.
//
// Run from the project root: `node --test`  (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStartingMap,
  wanderingRouteToCenter,
  PATH_MIN,
  PATH_MAX,
  WATER_MIN,
  WATER_MAX,
  TREE_MIN,
  TREE_MAX,
  MAP_COLS,
  MAP_ROWS,
  TILES,
  SPAWN_POINTS,
  PLAYER_START_X,
  PLAYER_START_Y,
  isSolid,
  isFortAt,
} from "../../main/resources/static/mapgen.js";

const RUNS = 500;
const VALID_TILE_IDS = new Set(Object.values(TILES));

// In the reserved 3x3 start block the generator deliberately keeps a solid path
// patch, so 2x2 path blocks are expected there and only there.
function inStartBlock(x, y) {
  return Math.abs(x - PLAYER_START_X) <= 1 && Math.abs(y - PLAYER_START_Y) <= 1;
}

// Mirror the generator's reachability: walk from the player tile over non-solid,
// non-fort tiles. A fort is reachable as a leaf but is never expanded past, since
// an enemy can step off its own fort but never into any fort.
function reachableFromPlayer(map) {
  const visited = new Set();
  const startK = PLAYER_START_Y * MAP_COLS + PLAYER_START_X;
  visited.add(startK);
  const q = [[PLAYER_START_X, PLAYER_START_Y]];
  while (q.length > 0) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
      const k = ny * MAP_COLS + nx;
      if (visited.has(k)) continue;
      if (isSolid(map[ny][nx])) continue;
      visited.add(k);
      if (isFortAt(nx, ny)) continue; // leaf only
      q.push([nx, ny]);
    }
  }
  return visited;
}

function countTiles(map, tileId) {
  let n = 0;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (map[y][x] === tileId) n++;
    }
  }
  return n;
}

test("map has the right shape and a mountain border", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    assert.equal(map.length, MAP_ROWS, "row count");
    for (let y = 0; y < MAP_ROWS; y++) {
      assert.equal(map[y].length, MAP_COLS, `row ${y} length`);
      for (let x = 0; x < MAP_COLS; x++) {
        assert.ok(VALID_TILE_IDS.has(map[y][x]), `tile (${x},${y}) is a known id`);
        const onBorder = x === 0 || x === MAP_COLS - 1 || y === 0 || y === MAP_ROWS - 1;
        if (onBorder) assert.equal(map[y][x], TILES.MOUNTAIN, `border (${x},${y}) is mountain`);
      }
    }
  }
});

test("player start and its 3x3 are walkable", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = PLAYER_START_X + dx, y = PLAYER_START_Y + dy;
        assert.ok(!isSolid(map[y][x]), `start cell (${x},${y}) walkable`);
      }
    }
  }
});

test("every spawn fort is reachable from the player", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    const reachable = reachableFromPlayer(map);
    for (const s of SPAWN_POINTS) {
      assert.ok(
        reachable.has(s.y * MAP_COLS + s.x),
        `spawn (${s.x},${s.y}) reachable on run ${i}`,
      );
    }
  }
});

test("no 2x2 all-path block outside the start area", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    for (let y = 0; y < MAP_ROWS - 1; y++) {
      for (let x = 0; x < MAP_COLS - 1; x++) {
        const block = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
        const allPath = block.every(([bx, by]) => map[by][bx] === TILES.PATH);
        if (!allPath) continue;
        const allInStart = block.every(([bx, by]) => inStartBlock(bx, by));
        assert.ok(allInStart, `2x2 path block at (${x},${y}) on run ${i} is outside start area`);
      }
    }
  }
});

test("water never sits in a diagonal-only adjacency", () => {
  const isWater = (map, x, y) =>
    x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && map[y][x] === TILES.WATER;
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        if (map[y][x] !== TILES.WATER) continue;
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (!isWater(map, x + dx, y + dy)) continue;
          const bridged = isWater(map, x + dx, y) || isWater(map, x, y + dy);
          assert.ok(bridged, `water (${x},${y}) has an unbridged diagonal on run ${i}`);
        }
      }
    }
  }
});

test("wanderingRouteToCenter is a contiguous fort-free path ending at center", () => {
  for (let i = 0; i < RUNS; i++) {
    for (const s of SPAWN_POINTS) {
      const route = wanderingRouteToCenter(s.x, s.y);
      assert.deepEqual(route[0], [s.x, s.y], "route starts at the fort");
      assert.deepEqual(
        route[route.length - 1],
        [PLAYER_START_X, PLAYER_START_Y],
        `route from (${s.x},${s.y}) ends at center on run ${i}`,
      );
      for (let j = 1; j < route.length; j++) {
        const [ax, ay] = route[j - 1];
        const [bx, by] = route[j];
        const step = Math.abs(ax - bx) + Math.abs(ay - by);
        assert.equal(step, 1, `step ${j} is a single orthogonal move on run ${i}`);
        assert.ok(bx >= 1 && bx < MAP_COLS - 1 && by >= 1 && by < MAP_ROWS - 1, "stays interior");
        // Only the starting tile may be a fort; the route never crosses another.
        assert.ok(!isFortAt(bx, by), `route tile (${bx},${by}) is not a fort on run ${i}`);
      }
    }
  }
});

test("routes from a cardinal fort do not all follow the straight lane", () => {
  // The top-middle fort sits directly above center. With wander enabled its route
  // should usually leave the straight column, which is what breaks the four-lane
  // funnel. Assert it deviates on a clear majority of runs.
  const top = SPAWN_POINTS.find((s) => s.x === PLAYER_START_X && s.y === 1);
  let deviated = 0;
  for (let i = 0; i < RUNS; i++) {
    const route = wanderingRouteToCenter(top.x, top.y);
    if (route.some(([x]) => x !== PLAYER_START_X)) deviated++;
  }
  assert.ok(deviated > RUNS / 2, `expected most routes to bow off the column, got ${deviated}/${RUNS}`);
});

test("paths have no 1-tile nub hanging off a line", () => {
  const isP = (m, x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && m[y][x] === TILES.PATH;
  const deg = (m, x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isP(m, x + dx, y + dy)).length;
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    for (let y = 1; y < MAP_ROWS - 1; y++) {
      for (let x = 1; x < MAP_COLS - 1; x++) {
        if (!isP(map, x, y) || isFortAt(x, y)) continue;
        if (deg(map, x, y) !== 1) continue; // a tip
        let nx = x, ny = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isP(map, x + dx, y + dy)) { nx = x + dx; ny = y + dy; }
        // A tip is fine only if it caps a 2+ branch/line (parent degree <= 2), never a lone bump off a junction.
        assert.ok(deg(map, nx, ny) <= 2, `1-tile nub at (${x},${y}) off a degree-${deg(map, nx, ny)} tile on run ${i}`);
      }
    }
  }
});

test("any grass tile boxed in by path could not have been filled", () => {
  // fillGrassHoles fills a 4-sided grass hole unless filling would make a 2x2 path
  // block, so every remaining boxed hole must be exactly that unavoidable case.
  const isP = (m, x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && m[y][x] === TILES.PATH;
  const deg = (m, x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isP(m, x + dx, y + dy)).length;
  const fillMakes2x2 = (m, x, y) => {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      let all = true;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const cx = x + ox + dx, cy = y + oy + dy;
        if (cx === x && cy === y) continue;
        if (!isP(m, cx, cy)) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  };
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    for (let y = 1; y < MAP_ROWS - 1; y++) {
      for (let x = 1; x < MAP_COLS - 1; x++) {
        if (map[y][x] !== TILES.GRASS || deg(map, x, y) !== 4) continue;
        assert.ok(fillMakes2x2(map, x, y), `fillable grass hole left at (${x},${y}) on run ${i}`);
      }
    }
  }
});

test("terrain counts stay within their enforced min/max bounds", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    const path = countTiles(map, TILES.PATH);
    const water = countTiles(map, TILES.WATER);
    const tree = countTiles(map, TILES.TREE);
    assert.ok(path >= PATH_MIN && path <= PATH_MAX, `path ${path} within [${PATH_MIN},${PATH_MAX}] on run ${i}`);
    assert.ok(water >= WATER_MIN && water <= WATER_MAX, `water ${water} within [${WATER_MIN},${WATER_MAX}] on run ${i}`);
    assert.ok(tree >= TREE_MIN && tree <= TREE_MAX, `tree ${tree} within [${TREE_MIN},${TREE_MAX}] on run ${i}`);
  }
});

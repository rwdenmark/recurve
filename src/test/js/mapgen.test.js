// Property tests for buildStartingMap. The generator promises a set of invariants
// (every fort reachable, paths width-1, water orthogonally connected) that are
// asserted only by construction in the source, so verify them over many runs.
//
// Run from the project root: `node --test`  (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildStartingMap,
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

test("obstacle budgets stay under their caps", () => {
  for (let i = 0; i < RUNS; i++) {
    const map = buildStartingMap();
    // waterTarget tops out at 71 and the generator never overshoots it.
    assert.ok(countTiles(map, TILES.WATER) <= 72, `water count within cap on run ${i}`);
    // treeTarget tops out at 168.
    assert.ok(countTiles(map, TILES.TREE) <= 168, `tree count within cap on run ${i}`);
    // Some path always survives (the start block plus carved routes).
    assert.ok(countTiles(map, TILES.PATH) >= 9, `path count plausible on run ${i}`);
  }
});

// Guard tests for level2.js's terrain queries, plus property tests for the cave
// generator in the style of mapgen.test.js. The module's generation and
// rendering need a DOM, but the query guards must answer safely for
// out-of-bounds coordinates even before any cave has been generated, since
// game.js probes neighbors that can sit on or past the border. The invariant
// tests further down build real caves through generateLevel2 with a stub
// canvas, the only DOM surface the renderer touches.
//
// Run from the project root: `node --test src/test/js`  (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  generateLevel2,
  l2Grid,
  l2Solid,
  l2BlocksProjectile,
  l2SpeedMult,
  L2_SPAWNS,
} from "../../main/resources/static/level2.js";
import {
  MAP_COLS, MAP_ROWS, PLAYER_START_X, PLAYER_START_Y,
} from "../../main/resources/static/mapgen.js";

const OUT_OF_BOUNDS = [
  [-1, 0],
  [0, -1],
  [MAP_COLS, 0],
  [0, MAP_ROWS],
  [-5, -5],
  [MAP_COLS + 3, MAP_ROWS + 3],
];

test("out-of-bounds tiles are solid and block projectiles", () => {
  for (const [x, y] of OUT_OF_BOUNDS) {
    assert.equal(l2Solid(x, y), true, `l2Solid(${x}, ${y})`);
    assert.equal(l2BlocksProjectile(x, y), true, `l2BlocksProjectile(${x}, ${y})`);
  }
});

test("out-of-bounds tiles report a neutral speed multiplier", () => {
  // Without the bounds guard this would throw on the null grid, proving the
  // guard runs before the grid is touched.
  for (const [x, y] of OUT_OF_BOUNDS) {
    assert.equal(l2SpeedMult(x, y), 1.0, `l2SpeedMult(${x}, ${y})`);
  }
});

// ---------------------------------------------------------------------------
// Generation invariants
// ---------------------------------------------------------------------------
//
// build() and the L2 terrain codes are module-private, so generation runs
// through generateLevel2 against a stub canvas and the codes and pool bands
// are read out of the module source rather than copied here. The guard tests
// above depend on the grid still being null, so the caves are generated
// lazily on first use, after those tests have run.

const SRC = readFileSync(new URL("../../main/resources/static/level2.js", import.meta.url), "utf8");

function srcMatch(re, what) {
  const m = SRC.match(re);
  assert.ok(m, `level2.js source drifted, cannot find ${what}`);
  return m;
}

// Terrain codes from the `const L2 = { ... }` table.
const L2 = Object.fromEntries(
  srcMatch(/const L2 = \{([^}]+)\}/, "the L2 code table")[1]
    .split(",")
    .map((part) => part.split(":"))
    .map(([name, val]) => [name.trim(), Number(val)]),
);

// Goal band [lo, hi] and minimum pool size from each placePools call in build().
const poolArgs = (marker, what) =>
  srcMatch(new RegExp(`placePools\\((\\d+), (\\d+), reserved, ${marker},[^)]*, (\\d+)\\)`), what)
    .slice(1, 4)
    .map(Number);
const [WATER_LO, WATER_HI, WATER_MIN_POOL] = poolArgs("new Set\\(\\)", "the water placePools call");
const [LAVA_LO, LAVA_HI, LAVA_MIN_POOL] = poolArgs("water", "the lava placePools call");

// Minimal 2d canvas stand-in. With no sprite sheets passed, the renderer only
// fills rects, blits, and pushes image data, none of which the invariants read.
const stubCtx = () => ({
  imageSmoothingEnabled: false,
  fillStyle: "",
  fillRect() {},
  drawImage() {},
  putImageData() {},
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
});

const RUNS = 500;

// Painting the pixel background makes a cave generation far costlier than a
// level 1 map, so the caves are built once and every test scans the same set.
let MAPS = null;
function maps() {
  if (MAPS) return MAPS;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: stubCtx }) };
  MAPS = [];
  for (let i = 0; i < RUNS; i++) {
    generateLevel2({});
    MAPS.push({
      grid: l2Grid().map((row) => row.slice()),
      spawnQueries: L2_SPAWNS.map(([x, y]) => ({
        solid: l2Solid(x, y),
        blocks: l2BlocksProjectile(x, y),
      })),
    });
  }
  return MAPS;
}

const tileAt = (grid, x, y) =>
  (x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS ? grid[y][x] : L2.WALL);
const solidCode = (t) => t === L2.WATER || t === L2.LAVA || t === L2.WALL || t === L2.ROCK;
const inCenter3 = (x, y) =>
  Math.abs(x - PLAYER_START_X) <= 1 && Math.abs(y - PLAYER_START_Y) <= 1;
const SPAWN_KEYS = new Set(L2_SPAWNS.map(([x, y]) => y * MAP_COLS + x));

// Mirror mapgen.test.js's reachability walk over non-solid tiles. A spawn is
// reachable as a leaf but never expanded past, since a troll can step off its
// own spawn but never into another one.
function reachableFromCenter(grid) {
  const visited = new Set([PLAYER_START_Y * MAP_COLS + PLAYER_START_X]);
  const q = [[PLAYER_START_X, PLAYER_START_Y]];
  while (q.length > 0) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 1 || nx >= MAP_COLS - 1 || ny < 1 || ny >= MAP_ROWS - 1) continue;
      const k = ny * MAP_COLS + nx;
      if (visited.has(k)) continue;
      if (solidCode(grid[ny][nx])) continue;
      visited.add(k);
      if (SPAWN_KEYS.has(k)) continue; // leaf only
      q.push([nx, ny]);
    }
  }
  return visited;
}

test("cave has the right shape, known codes, and a wall border", () => {
  const codes = new Set(Object.values(L2));
  maps().forEach(({ grid }, i) => {
    assert.equal(grid.length, MAP_ROWS, "row count");
    for (let y = 0; y < MAP_ROWS; y++) {
      assert.equal(grid[y].length, MAP_COLS, `row ${y} length`);
      for (let x = 0; x < MAP_COLS; x++) {
        assert.ok(codes.has(grid[y][x]), `tile (${x},${y}) is a known code on run ${i}`);
        const onBorder = x === 0 || x === MAP_COLS - 1 || y === 0 || y === MAP_ROWS - 1;
        if (onBorder) assert.equal(grid[y][x], L2.WALL, `border (${x},${y}) is wall on run ${i}`);
      }
    }
  });
});

test("every spawn has a walkable route to the center", () => {
  maps().forEach(({ grid }, i) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = PLAYER_START_X + dx, y = PLAYER_START_Y + dy;
        assert.equal(grid[y][x], L2.PATH, `center cell (${x},${y}) is path on run ${i}`);
      }
    }
    const reachable = reachableFromCenter(grid);
    for (const [sx, sy] of L2_SPAWNS) {
      assert.ok(reachable.has(sy * MAP_COLS + sx), `spawn (${sx},${sy}) reachable on run ${i}`);
    }
  });
});

test("water and lava pool sizes stay inside the placePools envelope", () => {
  // placePools draws a goal inside [lo, hi] but accepts a final blob that
  // overshoots by up to one minimum pool, so the enforced ceiling is hi plus
  // the minimum pool size. Lava is placed last into a crowded map and can run
  // out of attempts under its floor, so its floor only holds on most runs.
  let lavaAtFloor = 0;
  maps().forEach(({ grid }, i) => {
    let water = 0, lava = 0;
    for (const row of grid) {
      for (const t of row) {
        if (t === L2.WATER) water++;
        if (t === L2.LAVA) lava++;
      }
    }
    assert.ok(water >= WATER_LO, `water ${water} >= ${WATER_LO} on run ${i}`);
    assert.ok(
      water <= WATER_HI + WATER_MIN_POOL,
      `water ${water} <= ${WATER_HI + WATER_MIN_POOL} on run ${i}`,
    );
    assert.ok(
      lava <= LAVA_HI + LAVA_MIN_POOL,
      `lava ${lava} <= ${LAVA_HI + LAVA_MIN_POOL} on run ${i}`,
    );
    if (lava >= LAVA_LO) lavaAtFloor++;
  });
  assert.ok(
    lavaAtFloor > (RUNS * 3) / 4,
    `expected most runs to reach the lava floor, got ${lavaAtFloor}/${RUNS}`,
  );
});

test("spawn tiles are open floor and liquids keep a tile away", () => {
  maps().forEach(({ grid, spawnQueries }, i) => {
    spawnQueries.forEach((sq, s) => {
      const [sx, sy] = L2_SPAWNS[s];
      assert.equal(sq.solid, false, `spawn (${sx},${sy}) not solid on run ${i}`);
      assert.equal(sq.blocks, false, `spawn (${sx},${sy}) not projectile-blocking on run ${i}`);
      const t = grid[sy][sx];
      assert.ok(t === L2.FLOOR || t === L2.PATH, `spawn (${sx},${sy}) is floor or path on run ${i}`);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = tileAt(grid, sx + dx, sy + dy);
          assert.ok(n !== L2.WATER && n !== L2.LAVA, `no liquid beside spawn (${sx},${sy}) on run ${i}`);
        }
      }
    });
  });
});

test("no 2x2 all-path block outside the center 3x3", () => {
  maps().forEach(({ grid }, i) => {
    for (let y = 0; y < MAP_ROWS - 1; y++) {
      for (let x = 0; x < MAP_COLS - 1; x++) {
        const block = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
        if (!block.every(([bx, by]) => grid[by][bx] === L2.PATH)) continue;
        assert.ok(
          block.every(([bx, by]) => inCenter3(bx, by)),
          `2x2 path block at (${x},${y}) outside the center on run ${i}`,
        );
      }
    }
  });
});

test("water never touches lava, not even diagonally", () => {
  maps().forEach(({ grid }, i) => {
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        if (grid[y][x] !== L2.WATER) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            assert.ok(tileAt(grid, x + dx, y + dy) !== L2.LAVA, `water (${x},${y}) touches lava on run ${i}`);
          }
        }
      }
    }
  });
});

test("the path network is a single component containing the center", () => {
  // drawNetwork ends with a BFS that keeps only the piece connected to the
  // center 3x3, and pools and rocks never overwrite reserved path tiles, so
  // every PATH tile in the finished grid must be reachable from the center
  // walking PATH tiles alone. Note this is a path-network guarantee only.
  // The open floor as a whole is not kept connected, rock clumps seal off
  // floor pockets on essentially every run.
  maps().forEach(({ grid }, i) => {
    const seen = new Set([PLAYER_START_Y * MAP_COLS + PLAYER_START_X]);
    const q = [[PLAYER_START_X, PLAYER_START_Y]];
    while (q.length > 0) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        const k = ny * MAP_COLS + nx;
        if (seen.has(k) || tileAt(grid, nx, ny) !== L2.PATH) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        if (grid[y][x] !== L2.PATH) continue;
        assert.ok(seen.has(y * MAP_COLS + x), `stranded path tile (${x},${y}) on run ${i}`);
      }
    }
  });
});

test("every spawn keeps an open orthogonal first step", () => {
  // Each spawn's reserved route to the center protects its first step from
  // pools and rocks, so a troll can always walk off its portal. Rocks may
  // legitimately sit beside a spawn on the other sides, so only the existence
  // of one open step is guaranteed, not a rock-free ring.
  maps().forEach(({ grid }, i) => {
    for (const [sx, sy] of L2_SPAWNS) {
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const t = tileAt(grid, sx + dx, sy + dy);
        return t === L2.FLOOR || t === L2.PATH;
      });
      assert.ok(open, `spawn (${sx},${sy}) has no open orthogonal step on run ${i}`);
    }
  });
});

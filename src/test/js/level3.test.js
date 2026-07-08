// Property tests for level3.js's sewer generator, in the style of level2.test.js. The
// module's rendering needs a DOM, but the terrain grid is built DOM-free, so generation
// runs through generateLevel3 with a stub canvas (no sprites, so the renderer only fills
// fallback rects) and the invariants are read off the grid and spawn list.
//
// Run from the project root: `node --test src/test/js`  (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateLevel3, l3Grid, l3Solid, l3BlocksProjectile, l3SpeedMult, l3Spawns,
} from "../../main/resources/static/level3.js";
import {
  MAP_COLS, MAP_ROWS, PLAYER_START_X, PLAYER_START_Y,
} from "../../main/resources/static/mapgen.js";

const OUT_OF_BOUNDS = [
  [-1, 0], [0, -1], [MAP_COLS, 0], [0, MAP_ROWS], [-5, -5], [MAP_COLS + 3, MAP_ROWS + 3],
];

test("out-of-bounds tiles are solid and block projectiles", () => {
  // These guards must answer before any map is generated (the grid is still null),
  // because game.js probes neighbours that can sit past the border.
  for (const [x, y] of OUT_OF_BOUNDS) {
    assert.equal(l3Solid(x, y), true, `l3Solid(${x}, ${y})`);
    assert.equal(l3BlocksProjectile(x, y), true, `l3BlocksProjectile(${x}, ${y})`);
  }
});

test("speed multiplier is uniform on the dry floor", () => {
  assert.equal(l3SpeedMult(PLAYER_START_X, PLAYER_START_Y), 1.0);
});

// ---------------------------------------------------------------------------
// Generation invariants
// ---------------------------------------------------------------------------

// Minimal 2d canvas stand-in. With no sprite sheets passed, the renderer only sets
// fillStyle and blits/fills, none of which the grid invariants read.
const stubCtx = () => ({
  imageSmoothingEnabled: false, fillStyle: "",
  fillRect() {}, drawImage() {}, translate() {}, rotate() {},
  putImageData() {}, createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
  getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
});

const RUNS = 300;
let MAPS = null;
function maps() {
  if (MAPS) return MAPS;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: stubCtx }) };
  MAPS = [];
  for (let i = 0; i < RUNS; i++) {
    generateLevel3({}); // no sprites -> fallback rects, grid still built
    MAPS.push({ grid: l3Grid().map((row) => row.slice()), spawns: l3Spawns().map((s) => ({ ...s })) });
  }
  return MAPS;
}

const WATER = 0, FLOOR = 1, WALL = 2;
const CX0 = PLAYER_START_X - 1, CX1 = PLAYER_START_X + 1, CY0 = PLAYER_START_Y - 1, CY1 = PLAYER_START_Y + 1;

test("grid has known codes and a solid wall border", () => {
  maps().forEach(({ grid }, i) => {
    assert.equal(grid.length, MAP_ROWS, "row count");
    for (let y = 0; y < MAP_ROWS; y++) {
      assert.equal(grid[y].length, MAP_COLS, `row ${y} length`);
      for (let x = 0; x < MAP_COLS; x++) {
        assert.ok([WATER, FLOOR, WALL].includes(grid[y][x]), `tile (${x},${y}) known code on run ${i}`);
        if (x === 0 || x === MAP_COLS - 1 || y === 0 || y === MAP_ROWS - 1) {
          assert.equal(grid[y][x], WALL, `border (${x},${y}) is wall on run ${i}`);
        }
      }
    }
  });
});

test("the 3x3 center is dry floor", () => {
  maps().forEach(({ grid }, i) => {
    for (let y = CY0; y <= CY1; y++) for (let x = CX0; x <= CX1; x++) {
      assert.equal(grid[y][x], FLOOR, `center (${x},${y}) is floor on run ${i}`);
    }
  });
});

test("every spawn is a floor tile and reaches the center over floor", () => {
  maps().forEach(({ grid, spawns }, i) => {
    // BFS the floor from the center.
    const key = (x, y) => y * MAP_COLS + x;
    const seen = new Set([key(PLAYER_START_X, PLAYER_START_Y)]);
    const q = [[PLAYER_START_X, PLAYER_START_Y]];
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
        if (seen.has(key(nx, ny)) || grid[ny][nx] !== FLOOR) continue;
        seen.add(key(nx, ny)); q.push([nx, ny]);
      }
    }
    assert.ok(spawns.length >= 4, `at least the 4 wall portals on run ${i}`);
    for (const s of spawns) {
      assert.equal(grid[s.y][s.x], FLOOR, `spawn (${s.x},${s.y}) is floor on run ${i}`);
      assert.ok(seen.has(key(s.x, s.y)), `spawn (${s.x},${s.y}) reaches center on run ${i}`);
    }
  });
});

test("every water cell belongs to a 2x2 water block", () => {
  const isWater = (grid, x, y) => x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && grid[y][x] === WATER;
  maps().forEach(({ grid }, i) => {
    for (let y = 1; y < MAP_ROWS - 1; y++) for (let x = 1; x < MAP_COLS - 1; x++) {
      if (grid[y][x] !== WATER) continue;
      const ok = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) =>
        isWater(grid, x + ox, y + oy) && isWater(grid, x + ox + 1, y + oy) &&
        isWater(grid, x + ox, y + oy + 1) && isWater(grid, x + ox + 1, y + oy + 1));
      assert.ok(ok, `water (${x},${y}) is in a 2x2 block on run ${i}`);
    }
  });
});

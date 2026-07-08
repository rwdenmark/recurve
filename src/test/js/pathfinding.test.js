// Tests for the weighted (Dijkstra) flow field used for enemy pathfinding. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAP_COLS,
  MAP_ROWS,
  TILES,
  PLAYER_START_X,
  PLAYER_START_Y,
  SPAWN_POINTS,
  isSolid,
  isFortAt,
} from "../../main/resources/static/mapgen.js";
import { buildFlowField, nextStepFromField } from "../../main/resources/static/pathfinding.js";

const idx = (x, y) => y * MAP_COLS + x;

// All-grass interior with a mountain border. No obstacles, so the field distance to an
// on-axis tile equals its step count to the goal (the sweep is 8-directional and
// weighted, so off-axis tiles cost sqrt(2) per diagonal instead).
function openMap() {
  const map = [];
  for (let y = 0; y < MAP_ROWS; y++) {
    const row = [];
    for (let x = 0; x < MAP_COLS; x++) {
      const border = x === 0 || x === MAP_COLS - 1 || y === 0 || y === MAP_ROWS - 1;
      row.push(border ? TILES.MOUNTAIN : TILES.GRASS);
    }
    map.push(row);
  }
  return map;
}

test("goal is distance 0 and open tiles match Manhattan distance", () => {
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, openMap());
  assert.equal(field[idx(PLAYER_START_X, PLAYER_START_Y)], 0);
  assert.equal(field[idx(PLAYER_START_X + 3, PLAYER_START_Y)], 3);
  assert.equal(field[idx(PLAYER_START_X, PLAYER_START_Y - 2)], 2);
});

test("forts and the border are unreachable", () => {
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, openMap());
  for (const s of SPAWN_POINTS) {
    assert.equal(field[idx(s.x, s.y)], -1, `fort (${s.x},${s.y}) unreachable`);
  }
  assert.equal(field[idx(0, 0)], -1); // mountain border
});

test("nextStepFromField steps one tile closer to the goal", () => {
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, openMap());
  assert.deepEqual(
    nextStepFromField(field, PLAYER_START_X + 3, PLAYER_START_Y),
    { x: PLAYER_START_X + 2, y: PLAYER_START_Y },
  );
});

test("a fully enclosed tile yields no step (no corner cutting)", () => {
  const map = openMap();
  const bx = 5, by = 5; // clear of center and all forts
  map[by][bx + 1] = TILES.TREE;
  map[by][bx - 1] = TILES.TREE;
  map[by + 1][bx] = TILES.WATER;
  map[by - 1][bx] = TILES.TREE;
  const blocked = (x, y) => isSolid(map[y][x]) || isFortAt(x, y);
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, map);
  // Each orthogonal neighbor is solid and every diagonal has both sides blocked, so the
  // tile can't be reached and an enemy on it can't cut a corner out.
  assert.equal(field[idx(bx, by)], -1);
  assert.equal(nextStepFromField(field, bx, by, blocked), null);
});

test("diagonal movement rounds a single obstacle and still descends", () => {
  const map = openMap();
  // Block the straight horizontal route one tile east of the goal.
  const wx = PLAYER_START_X + 1;
  map[PLAYER_START_Y][wx] = TILES.TREE;
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, map);
  // The tree tile itself is solid, but the tile beyond it is now reached diagonally, so
  // it stays reachable while costing more than the straight-line distance (a real detour).
  assert.equal(field[idx(wx, PLAYER_START_Y)], -1);
  const behind = field[idx(PLAYER_START_X + 2, PLAYER_START_Y)];
  assert.notEqual(behind, -1);
  assert.ok(behind > 2, `expected a detour cost > 2, got ${behind}`);
  // An enemy two tiles east still finds a step toward the goal (never stuck).
  assert.notEqual(nextStepFromField(field, PLAYER_START_X + 2, PLAYER_START_Y), null);
});

test("cheaper terrain lowers the field value (path preference)", () => {
  const map = openMap();
  const gx = PLAYER_START_X, gy = PLAYER_START_Y;
  // Make the east neighbor a quarter of the normal cost to enter.
  const enterCost = (x, y) => (x === gx + 1 && y === gy ? 0.25 : 1);
  const field = buildFlowField(gx, gy, map, null, enterCost);
  assert.equal(field[idx(gx + 1, gy)], 0.25);
  assert.ok(field[idx(gx + 1, gy)] < field[idx(gx - 1, gy)]);
});

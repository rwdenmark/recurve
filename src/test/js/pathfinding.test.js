// Tests for the BFS flow field used for enemy pathfinding. Run with `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAP_COLS,
  MAP_ROWS,
  TILES,
  PLAYER_START_X,
  PLAYER_START_Y,
  SPAWN_POINTS,
} from "../../main/resources/static/mapgen.js";
import { buildFlowField, nextStepFromField } from "../../main/resources/static/pathfinding.js";

const idx = (x, y) => y * MAP_COLS + x;

// All-grass interior with a mountain border. No obstacles, so BFS distance from a
// tile equals its Manhattan distance to the goal (away from the spawn forts).
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

test("a tile walled off by obstacles yields no step", () => {
  const map = openMap();
  const bx = 5, by = 5; // clear of center and all forts
  map[by][bx + 1] = TILES.TREE;
  map[by][bx - 1] = TILES.TREE;
  map[by + 1][bx] = TILES.WATER;
  map[by - 1][bx] = TILES.TREE;
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, map);
  assert.equal(field[idx(bx, by)], -1);
  assert.equal(nextStepFromField(field, bx, by), null);
});

test("the field routes around an obstacle instead of through it", () => {
  const map = openMap();
  // Block the straight horizontal route one tile east of the goal.
  const wx = PLAYER_START_X + 1;
  map[PLAYER_START_Y][wx] = TILES.TREE;
  const field = buildFlowField(PLAYER_START_X, PLAYER_START_Y, map);
  // The blocked tile itself is unreachable from that side, but the tile beyond it
  // is still reached the long way, so its distance exceeds the Manhattan distance.
  assert.equal(field[idx(wx, PLAYER_START_Y)], -1);
  assert.ok(field[idx(PLAYER_START_X + 2, PLAYER_START_Y)] > 2);
});

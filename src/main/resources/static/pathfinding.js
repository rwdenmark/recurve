// Enemy pathfinding as a single flow field. Every enemy chases the same goal (the
// player), so instead of a separate search per enemy we sweep outward from the goal
// once and let each enemy read the result. Pure (no DOM), so it runs under a test runner.

import { MAP_COLS, MAP_ROWS, isSolid, isFortAt } from "./mapgen.js";

// Movement is 8-directional. A diagonal step costs sqrt(2)x an orthogonal one so a
// diagonal is never a free shortcut, matching the per-axis speed the enemies move at.
const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

// Least-cost distance from (goalX, goalY) to every walkable tile, as a flat array indexed
// y*MAP_COLS+x (-1 = unreachable). This is a Dijkstra sweep, not a plain BFS, so terrain
// cost matters: enterCost(x, y) returns the cost of stepping onto a tile, which lets
// cheaper tiles (paths) be preferred even when the route is a little longer. With no
// enterCost every tile costs the same and this reduces to shortest step-distance.
// isBlocked(x, y) overrides the level-1 solid/fort test so level 2 supplies its own rules.
export function buildFlowField(goalX, goalY, tileMap, isBlocked, enterCost) {
  const N = MAP_COLS * MAP_ROWS;
  const dist = new Float64Array(N).fill(Infinity);
  const k = (x, y) => y * MAP_COLS + x;
  const blocked = (x, y) => (isBlocked ? isBlocked(x, y) : (isSolid(tileMap[y][x]) || isFortAt(x, y)));
  const cost = enterCost || (() => 1);

  const start = k(goalX, goalY);
  dist[start] = 0;
  // The grid is tiny (about 500 tiles) and a rebuild only happens when the goal tile
  // changes, so a compact binary heap keeps each sweep cheap.
  const heap = new MinHeap();
  heap.push(start, 0);

  while (heap.size > 0) {
    const [cur, cd] = heap.pop();
    if (cd > dist[cur]) continue; // stale heap entry, already improved
    const cx = cur % MAP_COLS;
    const cy = (cur - cx) / MAP_COLS;
    for (const [dx, dy, stepMult] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
      if (blocked(nx, ny)) continue;
      // No corner cutting: a diagonal is only legal when both orthogonal sides are open.
      if (dx !== 0 && dy !== 0 && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      const ni = k(nx, ny);
      const nd = cd + cost(nx, ny) * stepMult;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  // Hand back the familiar -1 sentinel for unreachable tiles.
  return Array.from(dist, (v) => (v === Infinity ? -1 : v));
}

// The neighbor of (x, y) with the lowest field value, i.e. the next step toward the goal.
// Considers all 8 directions and refuses to cut corners past blocked tiles (isBlocked is
// optional). Returns null when no neighbor improves on the current tile.
export function nextStepFromField(field, x, y, isBlocked) {
  const k = (ax, ay) => ay * MAP_COLS + ax;
  const here = field[k(x, y)];
  let best = null;
  // From a reachable tile only step somewhere strictly closer. From an unreachable tile
  // (an enemy still standing on its spawn fort) take any reachable neighbor to get moving.
  let bestDist = here === -1 ? Infinity : here;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
    const d = field[k(nx, ny)];
    if (d === -1) continue;
    if (dx !== 0 && dy !== 0 && isBlocked && (isBlocked(x + dx, y) || isBlocked(x, y + dy))) continue;
    if (d < bestDist) { bestDist = d; best = { x: nx, y: ny }; }
  }
  return best;
}

// A tiny binary min-heap over (node, priority) pairs, enough for the Dijkstra sweep above.
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, prio) {
    const items = this.items;
    items.push([node, prio]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][1] <= items[i][1]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && items[l][1] < items[smallest][1]) smallest = l;
        if (r < n && items[r][1] < items[smallest][1]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

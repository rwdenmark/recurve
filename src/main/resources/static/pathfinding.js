// Enemy pathfinding as a single flow field. Every enemy chases the same goal (the
// player), so instead of a separate search per enemy we BFS outward from the goal
// once and let each enemy read the result. Pure (no DOM), so it runs under a test runner.

import { MAP_COLS, MAP_ROWS, isSolid, isFortAt } from "./mapgen.js";

// Step-distance from (goalX, goalY) over walkable, non-fort tiles. Path cost is
// uniform (every step is 1), so this is the true shortest-path distance on the grid,
// computed once for all enemies. Flat array indexed y*MAP_COLS+x; -1 = unreachable.
export function buildFlowField(goalX, goalY, tileMap) {
  const dist = new Array(MAP_COLS * MAP_ROWS).fill(-1);
  const k = (x, y) => y * MAP_COLS + x;
  dist[k(goalX, goalY)] = 0;
  const queue = [[goalX, goalY]];
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const d = dist[k(cx, cy)];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
      if (dist[k(nx, ny)] !== -1) continue;
      if (isSolid(tileMap[ny][nx])) continue;
      if (isFortAt(nx, ny)) continue;
      dist[k(nx, ny)] = d + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

// The orthogonal neighbor of (x, y) closest to the goal, i.e. the next step.
// Returns null if no neighbor is reachable.
export function nextStepFromField(field, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
    const d = field[ny * MAP_COLS + nx];
    if (d === -1) continue;
    if (d < bestDist) { bestDist = d; best = { x: nx, y: ny }; }
  }
  return best;
}

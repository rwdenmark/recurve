// Header HUD, split out of game.js. Hearts, kill counter, and run timer. Takes
// the game state as an argument, matching how mapgen and pathfinding take their
// inputs, so it holds nothing but its own DOM handles.

const killEl = document.getElementById("kill-count");
const timeEl = document.getElementById("time-value");
const heartsEl = document.getElementById("hearts");

let renderedLives = "";

// Both heart states render the same SVG path, so full and empty hearts are identical
// in size and shape. The font glyphs they replaced (a filled and an outlined heart)
// had different proportions.
const HEART_PATH = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
const heartSvg = (full) =>
  `<svg class="heart ${full ? "full" : "empty"}" viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="${HEART_PATH}"/></svg>`;

export function renderHearts(state) {
  const key = `${state.lives}/${state.maxLives}`;
  if (key === renderedLives) return; // only rebuild when it changes
  renderedLives = key;
  let html = "";
  // Filled hearts on the left, outlined on the right.
  for (let i = 0; i < state.maxLives; i++) {
    html += heartSvg(i < state.lives);
  }
  heartsEl.innerHTML = html;
}

let renderedKills = -1;
let renderedTimeSec = -1;

// Only touch the DOM when a value actually changes (the loop runs ~60x/s but kills
// and the second counter change far less often), matching renderHearts.
export function updateHud(now, state) {
  if (state.kills !== renderedKills) {
    renderedKills = state.kills;
    killEl.textContent = String(state.kills);
  }
  const elapsed = state.running ? Math.floor((now - state.startedAt) / 1000) : 0;
  if (elapsed !== renderedTimeSec) {
    renderedTimeSec = elapsed;
    timeEl.textContent = `${elapsed}s`;
  }
  renderHearts(state);
}

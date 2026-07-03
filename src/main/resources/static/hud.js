// Header HUD, split out of game.js. Hearts, kill counter, and run timer. Takes
// the game state as an argument, matching how mapgen and pathfinding take their
// inputs, so it holds nothing but its own DOM handles.

const killEl = document.getElementById("kill-count");
const timeEl = document.getElementById("time-value");
const heartsEl = document.getElementById("hearts");

let renderedLives = "";

export function renderHearts(state) {
  const key = `${state.lives}/${state.maxLives}`;
  if (key === renderedLives) return; // only rebuild when it changes
  renderedLives = key;
  let html = "";
  // Filled hearts on the left, outlined on the right.
  for (let i = 0; i < state.maxLives; i++) {
    const full = i < state.lives;
    html += `<span class="heart ${full ? "full" : "empty"}">${full ? "♥" : "♡"}</span>`;
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

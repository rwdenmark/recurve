// Leaderboard and score submission, split out of game.js. Owns the score form
// DOM, the run's server session id, and the final run duration, so game.js only
// reports events (run started, player died) and this module talks to the API.

import { playSfx } from "./audio.js";

const scoreForm = document.getElementById("score-form");
const playerNameInput = document.getElementById("callsign");
const submitScoreButton = document.getElementById("submit-score-button");
const leaderboardList = document.getElementById("leaderboard-list");

try {
  const savedName = localStorage.getItem("recurve.playerName");
  if (savedName) playerNameInput.value = savedName;
} catch (_) { /* localStorage may be disabled */ }

let lastRunDurationSeconds = 0;
let scoreAlreadySubmitted = false;
// Set from POST /api/game/start so the server can time the run. Sent with the score.
let gameSessionId = null;

export async function refreshLeaderboard() {
  try {
    const res = await fetch("api/scores/top?limit=10");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const scores = await res.json();
    renderLeaderboard(scores);
  } catch (err) {
    console.warn("Leaderboard fetch failed:", err);
    renderLeaderboard([]); // still show the numbered 1-10 skeleton
  }
}

// Always render 10 ranked rows. Slots past the available scores stay blank.
function renderLeaderboard(scores) {
  const list = scores || [];
  let html = "";
  for (let i = 0; i < 10; i++) {
    const s = list[i];
    html +=
      `<li>` +
      `<span class="rank">${i + 1}.</span>` +
      `<span class="name">${s ? escapeHtml(s.name || "Anonymous") : ""}</span>` +
      `<span class="kills">${s ? s.kills : ""}</span>` +
      `<span class="duration">${s ? s.durationSeconds + "s" : ""}</span>` +
      `</li>`;
  }
  leaderboardList.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Open a server-timed session for this run. If it fails, the score just can't be
// submitted later (the leaderboard would be unreachable anyway).
export function startGameSession() {
  gameSessionId = null;
  fetch("api/game/start", { method: "POST" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) gameSessionId = d.sessionId; })
    .catch(() => {});
}

// The run ends at death, so game.js reports the duration then, not at submit time.
export function setLastRunDuration(seconds) {
  lastRunDurationSeconds = seconds;
}

// Fresh form for a new run (hidden) or the retry screen (shown).
export function resetScoreForm(show) {
  scoreForm.classList.toggle("hidden", !show);
  scoreAlreadySubmitted = false;
  submitScoreButton.disabled = false;
  submitScoreButton.textContent = "Submit score";
}

// One submission at a time. Enter can fire faster than the network round-trip, and a
// second POST would burn on the consumed session and clobber the "Submitted" state.
let submitInFlight = false;

async function submitScore(kills) {
  if (scoreAlreadySubmitted || submitInFlight) return;
  const name = (playerNameInput.value || "").trim();
  // No name, silently do nothing. The player can still hit Start.
  if (!name) return;
  try {
    localStorage.setItem("recurve.playerName", name);
  } catch (_) {}
  submitInFlight = true;
  submitScoreButton.disabled = true;
  submitScoreButton.textContent = "Submitting…";
  try {
    const res = await fetch("api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kills,
        durationSeconds: lastRunDurationSeconds,
        sessionId: gameSessionId,
      }),
    });
    if (res.status === 400) {
      // Backend rejected the name (likely profanity). Show the message.
      let msg = "Name not allowed.";
      try {
        const body = await res.json();
        if (body && body.message) msg = body.message;
      } catch (_) {}
      submitScoreButton.disabled = false;
      submitScoreButton.textContent = msg;
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    scoreAlreadySubmitted = true;
    submitScoreButton.textContent = "Submitted";
    await refreshLeaderboard();
  } catch (err) {
    console.warn("Score submit failed:", err);
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit score";
  } finally {
    submitInFlight = false;
  }
}

// Wire the submit button and Enter in the name field. getKills reads the live
// kill count at submit time, so this module never holds game state.
export function initScoreForm(getKills) {
  submitScoreButton.addEventListener("click", () => { playSfx("select", 4); submitScore(getKills()); });
  playerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitScore(getKills());
    }
  });
}

// Run stats and upgrade cards, split out of game.js. The stat defaults live
// here with the live buff-modified values, so the baselines and the cards that
// move them stay in one place. game.js reads the exported lets (live bindings)
// each frame and never writes them directly. It resets them through
// resetRunStats and hands startBuffSelection a small game handle for the
// pause bookkeeping it can't do itself.

import { renderHearts } from "./hud.js";
import { playSfx } from "./audio.js";
import { shuffleInPlace } from "./shuffle.js";

// ---------------------------------------------------------------------------
// Stat defaults. Rangers and enemies are defined as multiples of these, so
// changing one rescales the whole roster at the same scale.
// ---------------------------------------------------------------------------
export const DEFAULT_HEALTH = 3;                 // hearts
export const DEFAULT_DAMAGE = 2;                 // arrow damage
export const DEFAULT_ATTACK_INTERVAL_MS = 2000;  // time between shots at 100% attack speed
export const DEFAULT_MOVE_DURATION_MS = 225;     // ms per tile at 100% move speed

const ARROW_MAX_RANGE = 6;          // base arrow range in tiles

// Run buffs. Reset by resetRunStats() from the chosen ranger plus any cards taken.
export let playerDamage = DEFAULT_DAMAGE;
export let playerSpeedMult = 1.0;
export let fireRateMult = 1.0;
export let playerMultiShot = false;
export let omniLevel = 0;              // omni-shot tier: 0 = not taken, 1-3 = auto-fire levels
export let playerPierce = 0;            // extra enemies an arrow passes through
export let playerArrowRange = ARROW_MAX_RANGE;
export let buffsAwarded = 0;

// ---------------------------------------------------------------------------
// Upgrade cards: every KILLS_PER_CARD_FIRST_CYCLE kills through the first cycle,
// pause and offer 3 random buffs. Later cycles pace by KILLS_PER_CARD_LATER in
// game.js, and SpawnModel.java mirrors both names.
// ---------------------------------------------------------------------------
export const KILLS_PER_CARD_FIRST_CYCLE = 10;
const STACK_CAP = 10;           // max copies of a stacking buff
const buffOverlay = document.getElementById("buff-overlay");
const buffCardsEl = document.getElementById("buff-cards");
const buffSubmitBtn = document.getElementById("buff-submit");
let buffPausedAt = 0;

// Only the title is shown, so the exact numbers stay hidden. Stacking buffs carry
// a tally of how many you already hold (drawn as dots on the card). The special-rule
// cards (Heal to Full and Multi-Shot) don't stack and show no tally.
// Cards that touch lives take the shared state object as `s`.
const BUFF_CARDS = [
  { title: "Increase Life", stacking: true, available: () => true,
    apply: (s) => { s.maxLives += 1; s.lives += 1; } },
  { title: "Heal to Full", available: (s) => s.lives < s.maxLives,
    apply: (s) => { s.lives = s.maxLives; } },
  { title: "Increase Movement Speed", stacking: true, available: () => true,
    apply: () => { playerSpeedMult += 0.25; } }, // additive: +25% of base each card
  { title: "Increase Attack Speed", stacking: true, available: () => true,
    apply: () => { fireRateMult += 0.5; } },      // additive: +50% of base each card
  { title: "Increase Damage", stacking: true, available: () => true,
    apply: () => { playerDamage += DEFAULT_DAMAGE; } },
  { title: "Arrow Piercing", stacking: true, cap: 3, dots: 3, available: () => true,
    apply: () => { playerPierce += 1; } },
  { title: "Arrow Distance", stacking: true, available: () => true,
    apply: () => { playerArrowRange += 1; } },
  { title: "Multi-Shot", available: () => !playerMultiShot, // one-time
    apply: () => { playerMultiShot = true; } },
  // Omni-Shot: unlocked by Multi-Shot, stacks to 3 (shown as 3 dots). Each level makes the
  // automatic 8-direction volley fire faster (the omni timer lives in game.js).
  { title: "Omni-Shot", stacking: true, cap: 3, dots: 3, available: () => playerMultiShot,
    apply: () => { omniLevel += 1; } },
];

function pickBuffCards(n, s) {
  // Stacking buffs drop out of the pool once they reach STACK_CAP copies.
  const pool = BUFF_CARDS.filter((c) =>
    c.available(s) && !(c.stacking && (c.taken || 0) >= (c.cap || STACK_CAP)));
  // Heal to Full is a bonus, never filler. Once every other upgrade is taken or maxed,
  // drop it so a fully upgraded run stops getting card screens (and heals) and can reach
  // its end, instead of being offered a free heal every threshold forever.
  const others = pool.filter((c) => c.title !== "Heal to Full");
  const finalPool = others.length === 0 ? others : pool;
  shuffleInPlace(finalPool);
  return finalPool.slice(0, Math.min(n, finalPool.length));
}

// Choosing a card is a two-step mouse flow (click to select, Confirm to apply) or a
// one-step hotkey (1/2/3 takes that card instantly, bypassing the Confirm button).
let pendingCards = [];   // cards on offer while the overlay is up
let selectedCard = null; // mouse-selected card awaiting the confirm click
let activeGame = null;   // the game handle for the current selection screen

// `game` is the handle game.js passes in: { state, shiftTimers, resume }. Buff
// selection pauses the run, so it needs those three hooks. Held input is left alone
// on purpose, so fire or movement held across the card screen resumes seamlessly.
export function startBuffSelection(now, game) {
  buffsAwarded += 1; // count the award (advances the next threshold) even if nothing is offered
  const cards = pickBuffCards(3, game.state);
  if (cards.length === 0) return; // everything maxed out: skip the pause, keep playing
  game.state.choosingBuff = true;
  buffPausedAt = now;
  pendingCards = cards;
  selectedCard = null;
  activeGame = game;
  buffSubmitBtn.disabled = true;
  buffCardsEl.innerHTML = "";
  cards.forEach((card, slot) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "buff-card";
    // Stacking buffs show a row of circles (STACK_CAP, or the card's own cap), filled by
    // how many copies you hold.
    const dotCount = card.dots || STACK_CAP;
    const dots = card.stacking
      ? `<span class="buff-dots">` +
        Array.from({ length: dotCount }, (_, i) =>
          `<span class="buff-dot${i < (card.taken || 0) ? " full" : ""}"></span>`).join("") +
        `</span>`
      : "";
    el.innerHTML = dots + `<span class="buff-title">${card.title}</span>` +
      `<span class="buff-key">${slot + 1}</span>`;
    el.addEventListener("click", () => selectBuffCard(card, el));
    buffCardsEl.appendChild(el);
  });
  window.addEventListener("keydown", onBuffKeyDown);
  buffOverlay.classList.remove("hidden");
}

// Mouse click on a card only selects it (yellow border + UI sound). The confirm
// button applies it.
function selectBuffCard(card, el) {
  if (selectedCard !== card) playSfx("select", 4);
  selectedCard = card;
  for (const child of buffCardsEl.children) child.classList.toggle("selected", child === el);
  buffSubmitBtn.disabled = false;
}

// Hotkeys 1/2/3 (top row or numpad) take the matching card instantly.
function onBuffKeyDown(e) {
  const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  if (idx === undefined || idx >= pendingCards.length) return;
  e.preventDefault();
  playSfx("select", 4);
  chooseBuff(pendingCards[idx], activeGame);
}

buffSubmitBtn.addEventListener("click", () => {
  if (!selectedCard || !activeGame) return;
  playSfx("select", 4);
  chooseBuff(selectedCard, activeGame);
});

function chooseBuff(card, game) {
  if (!game || !game.state.choosingBuff) return; // guard against double-fires
  window.removeEventListener("keydown", onBuffKeyDown);
  pendingCards = [];
  selectedCard = null;
  activeGame = null;
  buffSubmitBtn.disabled = true;
  card.apply(game.state);
  card.taken = (card.taken || 0) + 1;
  buffOverlay.classList.add("hidden");
  game.state.choosingBuff = false;
  game.shiftTimers(performance.now() - buffPausedAt);
  renderHearts(game.state);
  game.resume();
}

// Back to the chosen ranger's baseline. Called by resetState() at run start.
export function resetRunStats(ranger) {
  playerDamage = ranger.damage;
  playerSpeedMult = ranger.speed;
  fireRateMult = ranger.fireRate;
  playerMultiShot = false;
  omniLevel = 0;
  playerPierce = 0;
  playerArrowRange = ARROW_MAX_RANGE;
  buffsAwarded = 0;
  for (const c of BUFF_CARDS) c.taken = 0;
}

// God mode (testing): apply every upgrade card at its cap, so the archer starts fully
// kitted out. buffsAwarded is bumped so all enemy tiers unlock immediately. Called from
// start() when GOD_MODE is on, after resetRunStats.
export function applyMaxBuffs(state) {
  const STACK = STACK_CAP; // 10
  playerDamage += DEFAULT_DAMAGE * STACK;
  playerSpeedMult += 0.25 * STACK;
  fireRateMult += 0.5 * STACK;
  playerArrowRange += STACK;
  playerPierce = 3;      // Arrow Piercing cap
  playerMultiShot = true;
  omniLevel = 3;         // Omni-Shot cap
  buffsAwarded = 6;      // unlock every enemy tier from the start
  state.maxLives += STACK;
  state.lives = state.maxLives;
  for (const c of BUFF_CARDS) c.taken = c.cap || STACK; // show as maxed, drop them from the pool
}

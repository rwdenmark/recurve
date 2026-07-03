// Music and sound effects, split out of game.js. Owns the HUD sound controls,
// the menu/game tracks, and the Web Audio SFX pipeline. Holds no game state, so
// game.js just calls play/pause and reads musicMode.

const musicMuteBtn = document.getElementById("music-mute-btn");
const musicSlider = document.getElementById("music-slider");
const sfxMuteBtn = document.getElementById("sfx-mute-btn");
const sfxSlider = document.getElementById("sfx-slider");

let musicVolume = 0.10;
let musicMuted = false;
let sfxVolume = 0.25;
let sfxMuted = false;
export let musicMode = "none";   // "menu" | "game" | "none"

const menuMusic = new Audio("audio/menu.mp3");
menuMusic.loop = true;
// preload "none" so the ~7MB of game tracks download on Start, not at page load.
// The menu track stays eager so it never gaps when the menu opens.
const gameTracks = ["audio/game1.mp3", "audio/game2.mp3", "audio/game3.mp3"].map((src) => {
  const a = new Audio(src);
  a.preload = "none";
  return a;
});
let currentGameTrack = 0;
// Loop the in-game playlist: when one track ends, start the next.
gameTracks.forEach((a, i) => {
  a.addEventListener("ended", () => {
    if (musicMode !== "game") return;
    currentGameTrack = (i + 1) % gameTracks.length;
    const next = gameTracks[currentGameTrack];
    next.currentTime = 0;
    next.volume = effectiveVolume();
    next.play().catch(() => {});
  });
});

// The tracks are loud, so the slider value is scaled down by this.
const MUSIC_GAIN = 0.1;
function effectiveVolume() { return musicMuted ? 0 : musicVolume * MUSIC_GAIN; }
function effectiveSfxVolume() { return sfxMuted ? 0 : sfxVolume; }
function applyVolume() {
  const v = effectiveVolume();
  menuMusic.volume = v;
  for (const a of gameTracks) a.volume = v;
}
export function playMenuMusic() {
  musicMode = "menu";
  for (const a of gameTracks) a.pause();
  menuMusic.volume = effectiveVolume();
  menuMusic.play().catch(() => {});
}
export function playGameMusic() {
  musicMode = "game";
  menuMusic.pause();
  // Start on a random track each run so the in-game music varies between games.
  currentGameTrack = Math.floor(Math.random() * gameTracks.length);
  const a = gameTracks[currentGameTrack];
  a.currentTime = 0;
  a.volume = effectiveVolume();
  a.play().catch(() => {});
}
export function pauseMusic() {
  menuMusic.pause();
  for (const a of gameTracks) a.pause();
}
export function resumeMusic() {
  if (musicMode === "game") gameTracks[currentGameTrack].play().catch(() => {});
  else if (musicMode === "menu") menuMusic.play().catch(() => {});
}
function updateMuteIcon() {
  musicMuteBtn.textContent = musicMuted || musicVolume === 0 ? "\u{1F507}" : "\u{1F50A}";
  sfxMuteBtn.textContent = sfxMuted || sfxVolume === 0 ? "\u{1F507}" : "\u{1F50A}";
}

musicSlider.addEventListener("input", () => {
  musicVolume = Number(musicSlider.value) / 100;
  if (musicVolume > 0) musicMuted = false;
  applyVolume();
  updateMuteIcon();
});
musicMuteBtn.addEventListener("click", () => {
  musicMuted = !musicMuted;
  applyVolume();
  updateMuteIcon();
});
sfxSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxSlider.value) / 100;
  if (sfxVolume > 0) sfxMuted = false;
  updateMuteIcon();
});
sfxMuteBtn.addEventListener("click", () => {
  sfxMuted = !sfxMuted;
  updateMuteIcon();
});

applyVolume();
updateMuteIcon();

// Sound effects via Web Audio, not HTMLAudio. A decoded buffer fires with far
// less latency, so the bow twang stays in sync with the arrow.
const SFX_PATHS = { bow: "audio/bow_release.mp3", hurt: "audio/male_hurt.mp3", select: "audio/card_select.mp3" };
const SFX_GAIN = 0.25;
let audioCtx = null;
const sfxBuffers = {};
export function ensureAudioCtx() {
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor({ latencyHint: "interactive" });
    } catch (_) { audioCtx = null; }
  }
  return audioCtx;
}
export function loadSfx() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  for (const [name, url] of Object.entries(SFX_PATHS)) {
    if (sfxBuffers[name]) continue;
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => { sfxBuffers[name] = buf; })
      .catch(() => {});
  }
}
export function playSfx(name, boost = 1) {
  const ctx = audioCtx;
  const buf = sfxBuffers[name];
  const v = effectiveSfxVolume();
  if (!ctx || !buf || v <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, v * boost)) * SFX_GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
loadSfx();

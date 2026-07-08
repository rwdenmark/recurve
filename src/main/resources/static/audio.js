// Music and sound effects, split out of game.js. Owns the HUD sound controls,
// the menu/game tracks, and the Web Audio SFX pipeline. Holds no game state, so
// game.js just calls play/pause and reads musicMode.

const musicMuteBtn = document.getElementById("music-mute-btn");
const musicSlider = document.getElementById("music-slider");
const sfxMuteBtn = document.getElementById("sfx-mute-btn");
const sfxSlider = document.getElementById("sfx-slider");

// Sound preferences persist across sessions in localStorage (same approach as
// astro-siege), so the player's volume and mute choices survive a reload.
const PREFS_KEY = "recurve.sound";
// The stored blob is user-editable, so validate the shape and clamp the volumes instead
// of trusting it. A null or out-of-range value would otherwise throw during module load
// (volume above 1 raises IndexSizeError) and take the whole game down with it.
function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        const vol = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);
        return {
          musicVolume: vol(p.musicVolume),
          musicMuted: typeof p.musicMuted === "boolean" ? p.musicMuted : undefined,
          sfxVolume: vol(p.sfxVolume),
          sfxMuted: typeof p.sfxMuted === "boolean" ? p.sfxMuted : undefined,
        };
      }
    }
  } catch (_) { /* storage unavailable (private mode, etc.) */ }
  return {};
}
const savedPrefs = loadPrefs();
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ musicVolume, musicMuted, sfxVolume, sfxMuted }));
  } catch (_) { /* storage unavailable: just keep the in-memory values */ }
}

let musicVolume = savedPrefs.musicVolume ?? 0.10;
let musicMuted = savedPrefs.musicMuted ?? false;
let sfxVolume = savedPrefs.sfxVolume ?? 0.25;
let sfxMuted = savedPrefs.sfxMuted ?? false;
export let musicMode = "none";   // "menu" | "game" | "none"

const menuMusic = new Audio("level_one/audio/menu.mp3");
menuMusic.loop = true;

// The tracks are loud, so the slider value is scaled down by this.
const MUSIC_GAIN = 0.1;
function effectiveVolume() { return musicMuted ? 0 : musicVolume * MUSIC_GAIN; }
function effectiveSfxVolume() { return sfxMuted ? 0 : sfxVolume; }

// Each level has its own looping game-music playlist. A "set" remembers which of its
// tracks is current and loops within itself when a track ends. preload "none" so the
// tracks download on Start, not at page load.
function makeTrackSet(paths) {
  const tracks = paths.map((src) => { const a = new Audio(src); a.preload = "none"; return a; });
  const set = { tracks, idx: 0 };
  tracks.forEach((a, i) => {
    a.addEventListener("ended", () => {
      if (musicMode !== "game" || activeSet !== set) return;
      set.idx = (i + 1) % tracks.length;
      const next = tracks[set.idx];
      next.currentTime = 0;
      next.volume = effectiveVolume();
      next.play().catch(() => {});
    });
  });
  return set;
}
const gameSetL1 = makeTrackSet(["level_one/audio/game1.mp3", "level_one/audio/game2.mp3", "level_one/audio/game3.mp3"]);
const gameSetL2 = makeTrackSet(["level_two/audio/game1.mp3", "level_two/audio/game2.mp3", "level_two/audio/game3.mp3"]);
const gameSetL3 = makeTrackSet(["level_three/audio/game1.mp3", "level_three/audio/game2.mp3", "level_three/audio/game3.mp3"]);
const ALL_SETS = [gameSetL1, gameSetL2, gameSetL3];
let activeSet = gameSetL1;

function applyVolume() {
  const v = effectiveVolume();
  menuMusic.volume = v;
  for (const s of ALL_SETS) for (const a of s.tracks) a.volume = v;
}
export function playMenuMusic() {
  musicMode = "menu";
  for (const s of ALL_SETS) for (const a of s.tracks) a.pause();
  menuMusic.volume = effectiveVolume();
  menuMusic.play().catch(() => {});
}
// Start the game playlist for the given level on a random track, so the music varies
// between runs and each level plays its own set of songs.
export function playGameMusic(level = 1) {
  musicMode = "game";
  menuMusic.pause();
  for (const s of ALL_SETS) for (const a of s.tracks) a.pause();
  activeSet = level === 3 ? gameSetL3 : level === 2 ? gameSetL2 : gameSetL1;
  activeSet.idx = Math.floor(Math.random() * activeSet.tracks.length);
  const a = activeSet.tracks[activeSet.idx];
  a.currentTime = 0;
  a.volume = effectiveVolume();
  a.play().catch(() => {});
}
export function pauseMusic() {
  menuMusic.pause();
  for (const s of ALL_SETS) for (const a of s.tracks) a.pause();
}
export function resumeMusic() {
  if (musicMode === "game") activeSet.tracks[activeSet.idx].play().catch(() => {});
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
  savePrefs();
});
musicMuteBtn.addEventListener("click", () => {
  musicMuted = !musicMuted;
  applyVolume();
  updateMuteIcon();
  savePrefs();
});
sfxSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxSlider.value) / 100;
  if (sfxVolume > 0) sfxMuted = false;
  updateMuteIcon();
  savePrefs();
});
sfxMuteBtn.addEventListener("click", () => {
  sfxMuted = !sfxMuted;
  updateMuteIcon();
  savePrefs();
});

// Reflect the saved preferences on the sliders before the first paint.
musicSlider.value = String(Math.round(musicVolume * 100));
sfxSlider.value = String(Math.round(sfxVolume * 100));
applyVolume();
updateMuteIcon();

// Keep the volume controls from stealing keyboard focus: leave them out of the tab order and
// blur them after each interaction so WASD and ESC keep reaching the game instead of the slider.
for (const el of [musicSlider, sfxSlider, musicMuteBtn, sfxMuteBtn]) {
  el.tabIndex = -1;
  el.addEventListener("pointerup", () => el.blur());
  el.addEventListener("click", () => el.blur());
}

// Sound effects via Web Audio, not HTMLAudio. A decoded buffer fires with far
// less latency, so the bow twang stays in sync with the arrow.
const SFX_PATHS = { bow: "level_one/audio/bow_release.mp3", hurt: "level_one/audio/male_hurt.mp3", select: "level_one/audio/card_select.mp3" };
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

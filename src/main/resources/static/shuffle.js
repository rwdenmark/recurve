// Fisher-Yates in-place shuffle, shared by map generation, spawning, and the
// card picker. Takes an rng so callers under test can drive it deterministically.
export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

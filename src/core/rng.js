// Deterministic pseudo-randomness.
//
// Everything generated in this game -- units, sprites, enemy bastions, battle
// outcomes -- comes from a 32-bit seed run through these functions. Same seed,
// same result, on every machine, forever. That is what makes battles
// replayable and bastion #814,203 the same bastion for you and for me.

const U32 = 0x100000000;

// PCG-XSH-RR style output mixing on top of a 32-bit LCG. Cheap, passes the
// small-crush-tier tests we care about, and has no float math anywhere so it
// cannot drift between engines.
export function mix32(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// Stable string -> seed. FNV-1a, so "archer" means the same seed in the test
// suite as it does in the browser.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seedOf(value) {
  if (typeof value === 'number') return (value >>> 0);
  return hashString(String(value));
}

export class Rng {
  constructor(seed = 1) {
    this.state = (seedOf(seed) ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
    // Discard the first couple of outputs so nearby seeds diverge immediately.
    this.next();
    this.next();
  }

  next() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return mix32(this.state);
  }

  // [0, 1)
  float() {
    return this.next() / U32;
  }

  // [min, max)
  range(min, max) {
    return min + this.float() * (max - min);
  }

  // [min, max] inclusive integers
  int(min, max) {
    return min + (this.next() % (max - min + 1));
  }

  bool(p = 0.5) {
    return this.float() < p;
  }

  pick(arr) {
    return arr[this.next() % arr.length];
  }

  // Pick by weight. `weights` parallel to `items`.
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.next() % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Sum of three uniforms, normalised. Gives a bell-ish curve on [0,1) without
  // needing Box-Muller, which keeps generated stats clustered around average
  // instead of spraying to the extremes.
  bell() {
    return (this.float() + this.float() + this.float()) / 3;
  }

  // A fresh stream derived from this one, so a sub-generator (say, the sprite
  // for a unit) can burn as many numbers as it likes without shifting what the
  // parent generates next.
  fork(tag = 0) {
    return new Rng(mix32(this.state ^ mix32(seedOf(tag))));
  }
}

// One-shot deterministic noise: value in [0,1) for an integer lattice point.
// Used by the sprite generator, where we want "random but stable per pixel".
export function noise2(seed, x, y) {
  let h = mix32(seed ^ Math.imul(x | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(y | 0, 0x165667b1));
  return h / U32;
}

// Procedural sprite generation.
//
// No image files ship with this game. Every unit and every structure you see is
// a grid of colour indices computed from a 32-bit seed, painted to a canvas at
// runtime. That is not a stunt -- it is what makes an infinite roster possible,
// and it means the art has exactly the same licence as the code.
//
// This module is deliberately canvas-free so the shapes can be tested in Node.
// sprites.js turns the grids it returns into pixels.
//
// Three techniques stack here:
//   1. a superellipse body mask, shaped by the unit's archetype
//   2. a cellular automaton over seeded noise, for organic silhouette detail
//   3. a fractal emblem (Sierpinski carpet / triangle / dragon-ish fold)
//      stamped on the torso, which is the per-unit "heraldry"
//
// Palette indices used throughout:
//   0 empty   1 outline   2 shadow   3 body   4 highlight   5 accent   6 glow

import { Rng, noise2, seedOf } from './rng.js';

export const PX = { EMPTY: 0, OUTLINE: 1, SHADOW: 2, BODY: 3, LIGHT: 4, ACCENT: 5, GLOW: 6 };

export const GRID = 19; // odd, so there is a true centre column to mirror about

// Per-archetype body shape. n is the superellipse exponent: 2 is an ellipse,
// higher is boxier, lower is a pinched diamond.
const SHAPE = {
  vanguard:   { w: 0.62, h: 0.78, n: 2.8, headW: 0.34, headY: 0.18 },
  skirmisher: { w: 0.42, h: 0.80, n: 2.0, headW: 0.28, headY: 0.14 },
  marksman:   { w: 0.46, h: 0.82, n: 2.2, headW: 0.30, headY: 0.16 },
  bombard:    { w: 0.70, h: 0.66, n: 3.4, headW: 0.26, headY: 0.22 },
  aeronaut:   { w: 0.54, h: 0.58, n: 1.7, headW: 0.30, headY: 0.26 },
  sapper:     { w: 0.48, h: 0.62, n: 2.4, headW: 0.34, headY: 0.24 },
  warden:     { w: 0.58, h: 0.84, n: 2.4, headW: 0.30, headY: 0.14 },
  colossus:   { w: 0.86, h: 0.88, n: 3.8, headW: 0.30, headY: 0.14 },
};

function superellipse(dx, dy, w, h, n) {
  return Math.pow(Math.abs(dx / w), n) + Math.pow(Math.abs(dy / h), n) <= 1;
}

// --- fractal emblems --------------------------------------------------------
// Each returns true if the cell is "on" at that point of a 3x3 (or 2x2)
// recursive subdivision. Cheap to evaluate, and the depth of recursion is what
// makes a 5-pixel torso read as detailed rather than noisy.

function sierpinskiCarpet(x, y, depth) {
  for (let i = 0; i < depth; i++) {
    if (x % 3 === 1 && y % 3 === 1) return false;
    x = Math.floor(x / 3); y = Math.floor(y / 3);
  }
  return true;
}

function sierpinskiTriangle(x, y) {
  return (x & y) === 0;
}

function vicsekCross(x, y, depth) {
  for (let i = 0; i < depth; i++) {
    const cx = x % 3, cy = y % 3;
    if (!(cx === 1 || cy === 1)) return false;
    x = Math.floor(x / 3); y = Math.floor(y / 3);
  }
  return true;
}

function cantorBars(x, y, depth) {
  for (let i = 0; i < depth; i++) {
    if (x % 3 === 1) return false;
    x = Math.floor(x / 3);
  }
  return (y & 1) === 0;
}

const EMBLEMS = [
  (x, y) => sierpinskiCarpet(x, y, 2),
  (x, y) => sierpinskiTriangle(x, y),
  (x, y) => vicsekCross(x, y, 2),
  (x, y) => cantorBars(x, y, 2),
  (x, y) => sierpinskiCarpet(x + 1, y + 1, 2),
  (x, y) => sierpinskiTriangle(x, y) || sierpinskiTriangle(y, x),
];

// --- the generator ----------------------------------------------------------

export function unitSpriteGrid(unit) {
  const seed = seedOf(unit.seed);
  const rng = new Rng(seed ^ 0x5350);
  const shape = SHAPE[unit.archetype] ?? SHAPE.skirmisher;
  const N = GRID;
  const half = (N - 1) / 2;
  const g = new Uint8Array(N * N);
  const at = (x, y) => y * N + x;

  // 1. Body mask over the left half, mirrored. Mirror symmetry is what makes
  // random blobs read as creatures rather than as static.
  const bodyW = shape.w * half;
  const bodyH = shape.h * half;
  const cy = half + 1;

  // Density falls off toward the silhouette edge, so the CA has something to
  // erode rather than a hard cutout.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x <= half; x++) {
      const dx = x - half;
      const dy = y - cy;
      if (!superellipse(dx, dy, bodyW, bodyH, shape.n)) continue;
      const edge = Math.pow(Math.abs(dx / bodyW), shape.n) + Math.pow(Math.abs(dy / bodyH), shape.n);
      const p = 1.0 - 0.75 * edge * edge;
      if (noise2(seed, x, y) < p) g[at(x, y)] = PX.BODY;
    }
  }

  // 2. Cellular automaton smoothing. Two passes of "become what your
  // neighbours are" turns speckle into limbs and notches.
  for (let pass = 0; pass < 2; pass++) {
    const prev = g.slice();
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x <= half; x++) {
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            if (prev[at(x + ox, y + oy)]) n++;
          }
        }
        if (prev[at(x, y)]) g[at(x, y)] = n >= 3 ? PX.BODY : PX.EMPTY;
        else g[at(x, y)] = n >= 5 ? PX.BODY : PX.EMPTY;
      }
    }
  }

  // 3. Head. Always solid -- the CA is allowed to chew the body but a unit
  // without a head reads as debris.
  const headW = Math.max(1, Math.round(shape.headW * half));
  const headY = Math.round(shape.headY * N);
  const headH = Math.max(2, Math.round(headW * 1.1));
  for (let y = headY; y < headY + headH && y < N; y++) {
    for (let x = half - headW; x <= half; x++) {
      if (x >= 0) g[at(x, y)] = PX.BODY;
    }
  }

  // 4. Armour banding. A heavily armoured unit gets visible plate rows, so you
  // can read its durability off the silhouette before opening the stat card.
  if (unit.armor > 80) {
    const bands = unit.armor > 200 ? 3 : unit.armor > 140 ? 2 : 1;
    for (let b = 0; b < bands; b++) {
      const y = cy - 1 + b * 2;
      if (y < 0 || y >= N) continue;
      for (let x = 0; x <= half; x++) if (g[at(x, y)] === PX.BODY) g[at(x, y)] = PX.LIGHT;
    }
  }

  // 5. Fractal emblem on the torso. This is the per-unit heraldry and the
  // single biggest contributor to "these two units look different".
  const emblem = EMBLEMS[seed % EMBLEMS.length];
  const ex0 = half - Math.max(2, Math.round(bodyW * 0.7));
  const ey0 = cy - 1;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 4; x++) {
      const gx = ex0 + x, gy = ey0 + y;
      if (gx < 0 || gx > half || gy < 0 || gy >= N) continue;
      if (g[at(gx, gy)] && emblem(x, y)) g[at(gx, gy)] = PX.ACCENT;
    }
  }

  // Mirror the left half onto the right.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < half; x++) g[at(N - 1 - x, y)] = g[at(x, y)];
  }

  // 6. Asymmetric hardware, drawn AFTER mirroring so it stays one-sided. A
  // symmetric creature holding an asymmetric weapon is the oldest trick in
  // pixel art and it still works.
  if (unit.range > 2.2) {
    // A barrel whose length tracks actual attack range.
    const len = Math.min(half - 1, Math.round(1 + (unit.range - 1) * 0.9));
    const by = cy - 1;
    for (let i = 1; i <= len; i++) {
      const x = half + Math.round(bodyW) + i;
      if (x < N) { g[at(x, by)] = PX.ACCENT; if (by + 1 < N) g[at(x, by + 1)] = PX.SHADOW; }
    }
    const tip = half + Math.round(bodyW) + len;
    if (tip < N && by - 1 >= 0) g[at(tip, by - 1)] = PX.GLOW;
  } else {
    // Melee: a blade or maul, sized by per-hit damage.
    const heft = unit.damage / Math.max(0.2, unit.attackRate) > 200 ? 2 : 1;
    const x0 = half + Math.round(bodyW) + 1;
    for (let y = cy - 3; y <= cy + 1; y++) {
      for (let w = 0; w < heft; w++) {
        const x = x0 + w;
        if (x < N && y >= 0 && y < N) g[at(x, y)] = y < cy - 1 ? PX.LIGHT : PX.ACCENT;
      }
    }
  }

  // 7. Wings for fliers, above the shoulder line and symmetric.
  if (unit.flying) {
    const wy = cy - 3;
    for (let i = 1; i <= 4; i++) {
      const y = wy - Math.floor(i / 3);
      const lx = half - Math.round(bodyW) - i;
      const rx = half + Math.round(bodyW) + i;
      if (y >= 0) {
        if (lx >= 0) g[at(lx, y)] = i > 2 ? PX.GLOW : PX.LIGHT;
        if (rx < N) g[at(rx, y)] = i > 2 ? PX.GLOW : PX.LIGHT;
      }
    }
  }

  // 8. Splash units get orbiting charge dots, count following the radius.
  if (unit.splashRadius > 0.5) {
    const dots = Math.min(4, Math.round(unit.splashRadius * 2));
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2 + rng.float();
      const r = bodyW + 2.2;
      const x = Math.round(half + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r * 0.8);
      if (x >= 0 && x < N && y >= 0 && y < N && !g[at(x, y)]) g[at(x, y)] = PX.GLOW;
    }
  }

  // 9. Shading and outline. Lit from the upper left: a body cell with nothing
  // above it catches light, one with nothing below it falls into shadow.
  const lit = g.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (lit[at(x, y)] !== PX.BODY) continue;
      const above = y > 0 && lit[at(x, y - 1)];
      const below = y < N - 1 && lit[at(x, y + 1)];
      if (!above) g[at(x, y)] = PX.LIGHT;
      else if (!below) g[at(x, y)] = PX.SHADOW;
    }
  }
  const solid = g.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (solid[at(x, y)]) continue;
      const touches =
        (x > 0 && solid[at(x - 1, y)]) || (x < N - 1 && solid[at(x + 1, y)]) ||
        (y > 0 && solid[at(x, y - 1)]) || (y < N - 1 && solid[at(x, y + 1)]);
      if (touches) g[at(x, y)] = PX.OUTLINE;
    }
  }

  return { grid: g, size: N };
}

// --- structures -------------------------------------------------------------
//
// Buildings use recursive quadtree subdivision instead of a CA. Architecture is
// hierarchical -- a tower is a tower on a base with a crenellation -- and
// quadtree recursion produces exactly that kind of nested structure, where a CA
// would produce rubble.

export function structureSpriteGrid(def, seed) {
  const N = 16;
  const g = new Uint8Array(N * N);
  const at = (x, y) => y * N + x;
  const rng = new Rng(seedOf(seed) ^ seedOf(def.id));

  const inset = def.footprint >= 3 ? 1 : 2;
  const baseY = N - inset;
  const height = Math.round(N * (def.visualHeight ?? 0.65));
  const topY = baseY - height;

  // Main mass, slightly tapered for towers.
  const taper = def.category === 'defense' ? 1 : 0;
  for (let y = topY; y < baseY; y++) {
    const t = (y - topY) / Math.max(1, height);
    const w = Math.round((N / 2 - inset) * (1 - taper * 0.35 * (1 - t)));
    for (let x = N / 2 - w; x < N / 2 + w; x++) {
      if (x >= 0 && x < N) g[at(x, y)] = PX.BODY;
    }
  }

  // Quadtree detail: subdivide the facade and punch windows/panels into the
  // cells the recursion selects. Depth 2 on a 16px facade is the sweet spot --
  // deeper reads as noise.
  const subdivide = (x0, y0, w, h, depth) => {
    if (depth === 0 || w < 2 || h < 2) return;
    const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
    const cells = [[x0, y0], [x0 + hw, y0], [x0, y0 + hh], [x0 + hw, y0 + hh]];
    for (const [cx, cy] of cells) {
      const r = rng.float();
      if (r < 0.30) {
        for (let y = cy; y < cy + hh; y++) {
          for (let x = cx; x < cx + hw; x++) {
            if (x >= 0 && x < N && y >= 0 && y < N && g[at(x, y)]) g[at(x, y)] = PX.SHADOW;
          }
        }
      } else if (r < 0.52) {
        subdivide(cx, cy, hw, hh, depth - 1);
      }
    }
  };
  subdivide(inset, topY, N - inset * 2, height, 2);

  // Roof line: crenellations for defenses, a solid cap for everything else.
  if (def.category === 'defense') {
    const w = Math.round((N / 2 - inset) * 0.65);
    for (let x = N / 2 - w; x < N / 2 + w; x++) {
      if (x < 0 || x >= N) continue;
      if (topY - 1 >= 0) g[at(x, topY - 1)] = ((x % 2) === 0) ? PX.LIGHT : PX.EMPTY;
      if (topY >= 0) g[at(x, topY)] = PX.LIGHT;
    }
  } else {
    for (let x = inset - 1; x < N - inset + 1; x++) {
      if (x >= 0 && x < N && topY >= 0) g[at(x, topY)] = PX.LIGHT;
    }
  }

  // The accent stripe marks the building's function at a glance, and its
  // position is stable per building type so the base stays readable.
  const sy = baseY - Math.max(2, Math.round(height * 0.3));
  for (let x = 0; x < N; x++) if (g[at(x, sy)] === PX.BODY) g[at(x, sy)] = PX.ACCENT;

  // Ground shadow, then outline as above.
  for (let x = inset - 1; x < N - inset + 1; x++) {
    if (x >= 0 && x < N && baseY < N) g[at(x, baseY)] = PX.SHADOW;
  }
  const solid = g.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (solid[at(x, y)]) continue;
      const touches =
        (x > 0 && solid[at(x - 1, y)]) || (x < N - 1 && solid[at(x + 1, y)]) ||
        (y > 0 && solid[at(x, y - 1)]) || (y < N - 1 && solid[at(x, y + 1)]);
      if (touches) g[at(x, y)] = PX.OUTLINE;
    }
  }
  return { grid: g, size: N };
}

// --- palettes ---------------------------------------------------------------
//
// Hues are spaced by the golden angle so that consecutive seeds never produce
// two units you cannot tell apart, which is what a plain random hue does.

const GOLDEN_ANGLE = 137.50776405003785;

const TYPE_ACCENT = { kinetic: 205, arc: 178, pyre: 24 };

export function unitPalette(unit) {
  const seed = seedOf(unit.seed);
  const hue = (seed * GOLDEN_ANGLE) % 360;
  const accentHue = TYPE_ACCENT[unit.damageType] ?? 200;
  // Heavier armour reads as desaturated metal; light units keep their colour.
  const sat = Math.round(58 - Math.min(30, unit.armor / 10));
  return [
    'transparent',
    hsl(hue, sat + 8, 12),   // outline
    hsl(hue, sat, 30),       // shadow
    hsl(hue, sat, 47),       // body
    hsl(hue, sat - 6, 66),   // highlight
    hsl(accentHue, 74, 55),  // accent
    hsl(accentHue, 92, 72),  // glow
  ];
}

const CATEGORY_HUE = { defense: 6, resource: 46, storage: 88, core: 268, support: 200, wall: 30 };

export function structurePalette(def) {
  const hue = CATEGORY_HUE[def.category] ?? 210;
  const sat = def.category === 'wall' ? 12 : 26;
  return [
    'transparent',
    hsl(hue, sat + 10, 11),
    hsl(hue, sat, 26),
    hsl(hue, sat, 42),
    hsl(hue, sat - 4, 60),
    hsl(hue, 70, 54),
    hsl(hue, 90, 70),
  ];
}

function hsl(h, s, l) {
  return `hsl(${((h % 360) + 360) % 360} ${clamp(s, 5, 95)}% ${clamp(l, 4, 94)}%)`;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

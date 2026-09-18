// Procedural structure sprites.
//
// No image files ship with this game. Every building you see is a grid of
// colour indices computed from its type and level, painted to a canvas at
// runtime.
//
// Creatures used to be generated here too, by a cellular automaton. They are
// not any more: they moved to morph.js and became vector, because a CA cannot
// be bred. Blending two automata gives you noise; blending two polygons gives
// you a creature halfway between its parents. Buildings do not evolve, so they
// stayed raster, where the quadtree recursion below suits them better.
//
// Palette indices used throughout:
//   0 empty   1 outline   2 shadow   3 body   4 highlight   5 accent   6 glow

import { Rng, seedOf } from './rng.js';

export const PX = { EMPTY: 0, OUTLINE: 1, SHADOW: 2, BODY: 3, LIGHT: 4, ACCENT: 5, GLOW: 6 };

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

// Structure grids -> pixels. Cached by key, because a 16x16 grid is cheap to
// compute once and wasteful to compute sixty times a second.
//
// Creatures do not come through here. They are vector, and live in creature.js.

import { structureSpriteGrid, structurePalette } from '../core/spritegen.js';

const cache = new Map();

export function structureSprite(def, level, scale = 3) {
  const key = `${def.id}:${level}:${scale}`;
  let c = cache.get(key);
  if (c) return c;

  const { grid, size } = structureSpriteGrid(def, def.id + ':' + level);
  const palette = structurePalette(def);
  c = document.createElement('canvas');
  c.width = size * scale;
  c.height = size * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = grid[y * size + x];
      if (!v) continue;
      ctx.fillStyle = palette[v];
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  cache.set(key, c);
  return c;
}

export function clearSpriteCache() { cache.clear(); }

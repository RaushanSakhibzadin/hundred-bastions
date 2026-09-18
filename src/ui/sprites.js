// Grids -> pixels. Everything is cached by key, because a 19x19 grid is cheap
// to compute once and expensive to compute sixty times a second.

import { unitSpriteGrid, structureSpriteGrid, unitPalette, structurePalette } from '../core/spritegen.js';

const cache = new Map();

function paint(gridResult, palette, scale) {
  const { grid, size } = gridResult;
  const c = document.createElement('canvas');
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
  return c;
}

export function unitSprite(unit, scale = 3) {
  const key = `u:${unit.seed}:${scale}`;
  let c = cache.get(key);
  if (!c) { c = paint(unitSpriteGrid(unit), unitPalette(unit), scale); cache.set(key, c); }
  return c;
}

export function structureSprite(def, level, scale = 3) {
  const key = `s:${def.id}:${level}:${scale}`;
  let c = cache.get(key);
  if (!c) { c = paint(structureSpriteGrid(def, def.id + ':' + level), structurePalette(def), scale); cache.set(key, c); }
  return c;
}

export function clearSpriteCache() { cache.clear(); }

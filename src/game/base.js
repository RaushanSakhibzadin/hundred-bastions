// The holding: grid, placement rules, and the economy.
//
// The economy has no timers in it. Buildings appear the instant you can afford
// them. What stops you from covering the map is upkeep -- every structure draws
// against production forever, and net production may never go negative. So the
// question is never "how long until this finishes", it is "can this holding
// carry another tower", which is a decision rather than a wait.

import { STRUCTURE_BY_ID, structureCost, structureUpkeep,
         structureProduction, structureStorage, structureSupply } from './structures.js';

export const GRID_W = 44;
export const GRID_H = 44;
export const RESOURCES = ['ore', 'flux'];

export const BASE_STORAGE = { ore: 2000, flux: 1200 };
export const BASE_SUPPLY = 20;
export const BASE_PRODUCTION = { ore: 30, flux: 18 }; // the citadel's own trickle

export function createBase() {
  const base = {
    grid: { w: GRID_W, h: GRID_H },
    structures: [],
    nextId: 1,
    resources: { ore: 900, flux: 500 },
    lastTick: Date.now(),
  };
  place(base, 'citadel', Math.floor(GRID_W / 2) - 2, Math.floor(GRID_H / 2) - 2, { free: true });
  place(base, 'orepump', Math.floor(GRID_W / 2) - 7, Math.floor(GRID_H / 2) - 2, { free: true });
  place(base, 'condenser', Math.floor(GRID_W / 2) + 3, Math.floor(GRID_H / 2) - 2, { free: true });
  place(base, 'bolt', Math.floor(GRID_W / 2) - 1, Math.floor(GRID_H / 2) - 6, { free: true });
  return base;
}

export function citadelLevel(base) {
  const c = base.structures.find((s) => s.defId === 'citadel');
  return c ? c.level : 1;
}

export function countOf(base, defId) {
  return base.structures.filter((s) => s.defId === defId).length;
}

export function limitOf(base, def) {
  return def.limitPerCitadelLevel ? def.limitPerCitadelLevel(citadelLevel(base)) : 99;
}

export function occupancy(base) {
  const occ = new Int16Array(GRID_W * GRID_H).fill(-1);
  for (const s of base.structures) {
    const def = STRUCTURE_BY_ID[s.defId];
    for (let y = s.y; y < s.y + def.footprint; y++) {
      for (let x = s.x; x < s.x + def.footprint; x++) {
        if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) occ[y * GRID_W + x] = s.id;
      }
    }
  }
  return occ;
}

export function canPlaceAt(base, defId, x, y, occ = occupancy(base)) {
  const def = STRUCTURE_BY_ID[defId];
  if (!def) return false;
  if (x < 0 || y < 0 || x + def.footprint > GRID_W || y + def.footprint > GRID_H) return false;
  for (let yy = y; yy < y + def.footprint; yy++) {
    for (let xx = x; xx < x + def.footprint; xx++) {
      if (occ[yy * GRID_W + xx] !== -1) return false;
    }
  }
  return true;
}

// Every reason a placement might be refused, as a list, so the UI can say
// which one rather than just greying the button out.
export function placementProblems(base, defId, x, y, occ) {
  const def = STRUCTURE_BY_ID[defId];
  const problems = [];
  if (!canPlaceAt(base, defId, x, y, occ)) problems.push('Something is already there.');
  if (countOf(base, defId) >= limitOf(base, def)) {
    problems.push(`Citadel level ${citadelLevel(base)} allows ${limitOf(base, def)}.`);
  }
  const cost = structureCost(def, 1, countOf(base, defId));
  for (const r of RESOURCES) {
    if ((cost[r] ?? 0) > base.resources[r]) problems.push(`Short ${Math.ceil(cost[r] - base.resources[r])} ${r}.`);
  }
  const after = economy(base).net;
  const upkeep = structureUpkeep(def, 1);
  if (upkeep > 0 && after.ore - upkeep < 0 && !def.produces) {
    problems.push(`Upkeep ${upkeep}/min exceeds spare production.`);
  }
  return problems;
}

export function place(base, defId, x, y, { free = false, level = 1 } = {}) {
  const def = STRUCTURE_BY_ID[defId];
  if (!free) {
    const problems = placementProblems(base, defId, x, y);
    if (problems.length) return { ok: false, problems };
    const cost = structureCost(def, 1, countOf(base, defId));
    for (const r of RESOURCES) base.resources[r] -= (cost[r] ?? 0);
  }
  const s = { id: base.nextId++, defId, x, y, level };
  base.structures.push(s);
  return { ok: true, structure: s };
}

export function remove(base, id) {
  const i = base.structures.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const s = base.structures[i];
  if (s.defId === 'citadel') return false;
  const def = STRUCTURE_BY_ID[s.defId];
  // Full refund. Demolishing is a layout decision, and charging players to
  // rearrange their own holding only teaches them not to experiment.
  const cost = structureCost(def, s.level, countOf(base, s.defId) - 1);
  for (const r of RESOURCES) base.resources[r] += (cost[r] ?? 0);
  base.structures.splice(i, 1);
  return true;
}

export function upgradeCost(base, id) {
  const s = base.structures.find((x) => x.id === id);
  if (!s) return null;
  const def = STRUCTURE_BY_ID[s.defId];
  if (s.level >= def.maxLevel) return null;
  return structureCost(def, s.level + 1, 0);
}

export function upgrade(base, id) {
  const s = base.structures.find((x) => x.id === id);
  const cost = upgradeCost(base, id);
  if (!cost) return { ok: false, problems: ['Already at maximum level.'] };
  for (const r of RESOURCES) {
    if ((cost[r] ?? 0) > base.resources[r]) {
      return { ok: false, problems: [`Short ${Math.ceil(cost[r] - base.resources[r])} ${r}.`] };
    }
  }
  for (const r of RESOURCES) base.resources[r] -= (cost[r] ?? 0);
  s.level++;
  return { ok: true };
}

// Everything the holding produces, stores, consumes and can field.
export function economy(base) {
  const production = { ...BASE_PRODUCTION };
  const storage = { ...BASE_STORAGE };
  let upkeep = 0;
  let supply = BASE_SUPPLY;

  for (const s of base.structures) {
    const def = STRUCTURE_BY_ID[s.defId];
    const p = structureProduction(def, s.level);
    if (p) for (const [k, v] of Object.entries(p)) production[k] = (production[k] ?? 0) + v;
    const st = structureStorage(def, s.level);
    if (st) for (const [k, v] of Object.entries(st)) storage[k] = (storage[k] ?? 0) + v;
    upkeep += structureUpkeep(def, s.level);
    supply += structureSupply(def, s.level);
  }

  // Upkeep is drawn in ore. Flux is unaffected, which keeps the two resources
  // playing different roles rather than being the same number twice.
  const net = { ore: Math.round((production.ore - upkeep) * 10) / 10, flux: production.flux };
  return { production, storage, upkeep: Math.round(upkeep * 10) / 10, net, supply };
}

// Offline-friendly accrual: production is per minute and accumulates in real
// time whether or not the tab is open, capped by storage.
export function tickResources(base, now = Date.now()) {
  const elapsedMin = Math.max(0, (now - base.lastTick) / 60000);
  if (elapsedMin <= 0) return base;
  const { net, storage } = economy(base);
  for (const r of RESOURCES) {
    const gained = (net[r] ?? 0) * elapsedMin;
    base.resources[r] = clamp(base.resources[r] + gained, 0, storage[r] ?? Infinity);
  }
  base.lastTick = now;
  return base;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Loot a raider can take from this holding. Capped by a share, so a loss is a
// setback and never a wipe.
export function lootable(base) {
  const { storage } = economy(base);
  const out = {};
  for (const r of RESOURCES) out[r] = Math.floor(Math.min(base.resources[r], storage[r]) * 0.22);
  return out;
}

// --- coverage heatmap -------------------------------------------------------
//
// How many defences reach each tile. The build screen draws this live, which is
// the single most useful thing a base builder can be shown and is bizarrely
// rare in the genre -- you normally have to infer it from memory.

export function coverageField(base) {
  const field = new Uint8Array(GRID_W * GRID_H);
  for (const s of base.structures) {
    const def = STRUCTURE_BY_ID[s.defId];
    if (def.category !== 'defense') continue;
    const r = def.traits.range;
    const cx = s.x + def.footprint / 2;
    const cy = s.y + def.footprint / 2;
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(GRID_H - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GRID_W - 1, Math.ceil(cx + r)); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) field[y * GRID_W + x] = Math.min(255, field[y * GRID_W + x] + 1);
      }
    }
  }
  return field;
}

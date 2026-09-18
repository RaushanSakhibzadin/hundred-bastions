// Procedural enemy holdings.
//
// Bastion #1 and bastion #4,102,887 are both generated on demand from their
// number. Nothing is stored, nothing is downloaded, and the same number always
// produces the same holding -- so a bastion you found hard is a bastion you can
// send to somebody else as an integer.
//
// Threat scales the budget; the layout style scales the *character*. Two
// bastions of equal threat can demand completely different warbands, which is
// the only thing that keeps an endless ladder interesting.

import { Rng, seedOf } from '../core/rng.js';
import { nameBastion } from '../core/naming.js';
import { STRUCTURE_BY_ID } from './structures.js';
import { GRID_W, GRID_H } from './base.js';

export const LAYOUT_STYLES = [
  { id: 'ring',     label: 'Ringwork',   weight: 22, wallRings: 1, defenseBias: 1.0,  spread: 0.55 },
  { id: 'shell',    label: 'Double Shell', weight: 16, wallRings: 2, defenseBias: 0.9, spread: 0.62 },
  { id: 'quarters', label: 'Quartered',  weight: 18, wallRings: 1, defenseBias: 1.0,  spread: 0.60, quarters: true },
  { id: 'open',     label: 'Open Field', weight: 14, wallRings: 0, defenseBias: 1.35, spread: 0.72 },
  { id: 'core',     label: 'Tight Core', weight: 15, wallRings: 1, defenseBias: 1.1,  spread: 0.34 },
  { id: 'sprawl',   label: 'Sprawl',     weight: 15, wallRings: 1, defenseBias: 0.85, spread: 0.85 },
];

// Threat is the single difficulty number. Level scaling is intentionally
// gentler than the count scaling: more buildings is a more interesting problem
// than the same buildings with bigger numbers.
export function threatToLevel(threat) {
  return Math.max(1, Math.min(12, 1 + Math.floor(threat / 3)));
}

export function generateBastion(index, { threatOverride = null } = {}) {
  const seed = seedOf(index);
  const rng = new Rng(seed ^ 0x62615374);
  const threat = threatOverride ?? Math.max(1, index);
  const level = threatToLevel(threat);
  const style = rng.weighted(LAYOUT_STYLES, LAYOUT_STYLES.map((s) => s.weight));

  const cx = GRID_W / 2;
  const cy = GRID_H / 2;
  const occ = new Int16Array(GRID_W * GRID_H).fill(-1);
  const structures = [];
  let nextId = 1;

  const fits = (x, y, fp) => {
    if (x < 1 || y < 1 || x + fp > GRID_W - 1 || y + fp > GRID_H - 1) return false;
    for (let yy = y; yy < y + fp; yy++) {
      for (let xx = x; xx < x + fp; xx++) if (occ[yy * GRID_W + xx] !== -1) return false;
    }
    return true;
  };
  const stamp = (defId, x, y, lvl) => {
    const def = STRUCTURE_BY_ID[defId];
    const s = { id: nextId++, defId, x, y, level: lvl };
    structures.push(s);
    for (let yy = y; yy < y + def.footprint; yy++) {
      for (let xx = x; xx < x + def.footprint; xx++) occ[yy * GRID_W + xx] = s.id;
    }
    return s;
  };

  // Try to place a structure at a given radius band from the centre, walking
  // outward until something fits. Radial placement is what gives generated
  // bases an actual defensive logic instead of a random scatter.
  const placeRadial = (defId, radius, lvl) => {
    const def = STRUCTURE_BY_ID[defId];
    const fp = def.footprint;
    for (let attempt = 0; attempt < 90; attempt++) {
      const r = radius + attempt * 0.35;
      const a = rng.float() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r - fp / 2);
      const y = Math.round(cy + Math.sin(a) * r - fp / 2);
      if (fits(x, y, fp)) return stamp(defId, x, y, lvl);
    }
    return null;
  };

  // --- the citadel goes dead centre ---------------------------------------
  const citadel = STRUCTURE_BY_ID.citadel;
  stamp('citadel', Math.round(cx - citadel.footprint / 2), Math.round(cy - citadel.footprint / 2), level);

  // --- budget -------------------------------------------------------------
  // Points buy buildings. The curve is sub-linear in threat so bastion 400 is
  // hard rather than literally 400 times bastion 1.
  const points = Math.round(6 + Math.pow(threat, 0.86) * 3.4);
  const defensePoints = Math.round(points * 0.55 * style.defenseBias);
  const economyPoints = Math.max(3, points - defensePoints);

  const DEFENSE_POOL = ['bolt', 'bolt', 'bolt', 'scatter', 'trench', 'skywatch', 'lance'];
  const DEFENSE_COST = { bolt: 2, scatter: 3, trench: 2, skywatch: 3, lance: 6 };
  const DEFENSE_UNLOCK = { bolt: 1, trench: 2, scatter: 4, skywatch: 5, lance: 9 };

  const maxR = Math.min(GRID_W, GRID_H) * 0.5 * style.spread;

  let spent = 0;
  let guard = 0;
  while (spent < defensePoints && guard++ < 400) {
    const pool = DEFENSE_POOL.filter((d) => threat >= DEFENSE_UNLOCK[d] && spent + DEFENSE_COST[d] <= defensePoints + 2);
    if (!pool.length) break;
    const pick = rng.pick(pool);
    // Long-range defences sit deep; short-range ones sit on the perimeter
    // where attackers actually arrive. This is what a human would do.
    const def = STRUCTURE_BY_ID[pick];
    const depth = 1 - Math.min(1, def.traits.range / 11);
    const radius = 3 + maxR * (0.25 + depth * 0.6) * rng.range(0.7, 1.25);
    if (placeRadial(pick, radius, level)) spent += DEFENSE_COST[pick];
    else break;
  }

  // --- economy buildings: loot, and the reason to attack at all ------------
  const ECON_POOL = ['orepump', 'condenser', 'vault', 'muster'];
  const ECON_COST = { orepump: 1, condenser: 1, vault: 2, muster: 2 };
  let espent = 0;
  guard = 0;
  while (espent < economyPoints && guard++ < 400) {
    const pick = rng.weighted(ECON_POOL, [3, 3, 2, 1]);
    const radius = 4 + maxR * rng.range(0.45, 1.05);
    if (placeRadial(pick, radius, level)) espent += ECON_COST[pick];
    else break;
  }

  // --- walls ---------------------------------------------------------------
  const wallLevel = level;
  for (let ring = 0; ring < style.wallRings; ring++) {
    const r = Math.round(4 + ring * 4 + maxR * (0.45 + ring * 0.28));
    ringWall(r);
  }
  if (style.quarters) {
    const r = Math.round(4 + maxR * 0.5);
    for (let d = -r; d <= r; d++) {
      tryWall(Math.round(cx) + d, Math.round(cy));
      tryWall(Math.round(cx), Math.round(cy) + d);
    }
  }

  function tryWall(x, y) {
    if (fits(x, y, 1)) stamp('rampart', x, y, wallLevel);
  }

  function ringWall(r) {
    // A square ring with gates. Gates are not a flaw -- they are how the
    // designer of the bastion chose to route you, and reading that routing is
    // most of the skill in attacking.
    const gates = new Set();
    const gateCount = rng.int(1, 3);
    for (let i = 0; i < gateCount; i++) gates.add(rng.int(0, 3));
    const x0 = Math.round(cx - r), x1 = Math.round(cx + r);
    const y0 = Math.round(cy - r), y1 = Math.round(cy + r);
    const gateHalf = 2;
    for (let x = x0; x <= x1; x++) {
      const nearMidX = Math.abs(x - cx) <= gateHalf;
      if (!(gates.has(0) && nearMidX)) tryWall(x, y0);
      if (!(gates.has(2) && nearMidX)) tryWall(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      const nearMidY = Math.abs(y - cy) <= gateHalf;
      if (!(gates.has(3) && nearMidY)) tryWall(x0, y);
      if (!(gates.has(1) && nearMidY)) tryWall(x1, y);
    }
  }

  const loot = lootFor(threat, rng);

  return {
    index,
    seed,
    name: nameBastion(index),
    threat,
    level,
    style: style.id,
    styleLabel: style.label,
    grid: { w: GRID_W, h: GRID_H },
    structures,
    loot,
    nextId,
  };
}

function lootFor(threat, rng) {
  const base = 220 + Math.pow(threat, 1.22) * 46;
  return {
    ore: Math.round(base * rng.range(0.85, 1.2)),
    flux: Math.round(base * 0.62 * rng.range(0.85, 1.2)),
  };
}

// A short, honest summary of what a bastion will demand, shown before you
// commit a warband. Scouting for free is a convenience, not a concession: the
// interesting decision is which warband to bring, and that decision is only
// interesting if you have the information to make it.
export function scout(bastion) {
  const counts = {};
  let airDefense = 0, groundOnly = 0, walls = 0, maxRange = 0;
  for (const s of bastion.structures) {
    const def = STRUCTURE_BY_ID[s.defId];
    counts[def.name] = (counts[def.name] ?? 0) + 1;
    if (def.category === 'wall') walls++;
    if (def.category !== 'defense') continue;
    if (def.targetsAir !== false) airDefense++;
    if (def.targetsGround === false) groundOnly++;
    maxRange = Math.max(maxRange, def.traits.range);
  }
  const notes = [];
  if (airDefense === 0) notes.push('No anti-air at all. Fliers walk in.');
  else if (airDefense >= 5) notes.push('Dense anti-air. Ground assault is safer.');
  if (walls > 60) notes.push('Heavily walled. Bring something that breaches.');
  else if (walls === 0) notes.push('Unwalled. Speed gets you to the citadel fast.');
  if (maxRange >= 11) notes.push('A Rail Lance covers the whole holding.');
  if (groundOnly >= 3) notes.push('Several defences cannot elevate.');
  return { counts, airDefense, walls, maxRange, notes };
}

// Structures.
//
// Defences are priced by the same trait-cost engine as units, so a long-range
// splash turret is quantifiably weaker per point than a short-range single-
// target one, and nobody has to hand-tune a spreadsheet to keep that true.
// `budgetScale` exists as an intentional per-building dial, but every defence
// currently ships at 1.0 -- every difference between them comes out of the
// formula, not out of a thumb on the scale.
//
// Note the deliberate economic design: construction is INSTANT. There are no
// build timers anywhere in this game. What limits you instead is upkeep -- every
// structure draws continuously against your production, and you cannot place a
// building that would push net production below zero. The constraint is
// economic rather than temporal, which means the game never asks you to wait
// and never has anything to sell you for skipping a wait.

import { solveStats, traitCost, effectiveHp } from '../core/balance.js';

export const DEF_BUDGET_BASE = 340;   // combat value of a level-1 defence
export const DEF_LEVEL_STEP = 1.18;   // steeper than units: defenders are outnumbered

export const STRUCTURES = [
  {
    id: 'citadel', name: 'Citadel', category: 'core', footprint: 4, visualHeight: 0.9,
    maxLevel: 12, cost: { ore: 0, flux: 0 }, upkeep: 0, baseHp: 2600, armor: 90,
    armorClass: 'plate', limitPerCitadelLevel: () => 1,
    blurb: 'The heart of the holding. Losing it ends the siege immediately.',
  },
  {
    id: 'orepump', name: 'Ore Pump', category: 'resource', footprint: 3, visualHeight: 0.55,
    maxLevel: 10, cost: { ore: 0, flux: 120 }, upkeep: 2, baseHp: 620, armor: 20,
    armorClass: 'mesh', produces: { ore: 42 }, limitPerCitadelLevel: (l) => 1 + Math.floor(l * 0.7),
    blurb: 'Draws ore out of the seam under the holding. Produces whether or not you are playing.',
  },
  {
    id: 'condenser', name: 'Flux Condenser', category: 'resource', footprint: 3, visualHeight: 0.6,
    maxLevel: 10, cost: { ore: 160, flux: 0 }, upkeep: 2, baseHp: 620, armor: 20,
    armorClass: 'mesh', produces: { flux: 30 }, limitPerCitadelLevel: (l) => 1 + Math.floor(l * 0.55),
    blurb: 'Condenses flux out of the air. Slower than ore and worth more.',
  },
  {
    id: 'vault', name: 'Vault', category: 'storage', footprint: 3, visualHeight: 0.7,
    maxLevel: 10, cost: { ore: 200, flux: 80 }, upkeep: 1, baseHp: 980, armor: 60,
    armorClass: 'plate', stores: { ore: 4000, flux: 2600 }, limitPerCitadelLevel: (l) => 1 + Math.floor(l * 0.6),
    blurb: 'Raises your cap on both resources. Raiders take a slice of what is inside.',
  },
  {
    id: 'muster', name: 'Muster Hall', category: 'support', footprint: 3, visualHeight: 0.6,
    maxLevel: 10, cost: { ore: 240, flux: 200 }, upkeep: 3, baseHp: 760, armor: 35,
    armorClass: 'mesh', supply: 14, limitPerCitadelLevel: (l) => Math.max(1, Math.floor(l * 0.5)),
    blurb: 'Adds warband supply. More supply is more units on the field, not stronger ones.',
  },
  {
    id: 'forge', name: 'Forge', category: 'support', footprint: 3, visualHeight: 0.65,
    maxLevel: 10, cost: { ore: 420, flux: 340 }, upkeep: 4, baseHp: 900, armor: 45,
    armorClass: 'plate', limitPerCitadelLevel: () => 1,
    blurb: 'Raises unit levels and rolls new recruits. One per holding.',
  },

  // --- defences. `traits` feed the shared balance solver. -------------------
  {
    id: 'bolt', name: 'Bolt Tower', category: 'defense', footprint: 2, visualHeight: 0.85,
    maxLevel: 12, cost: { ore: 300, flux: 60 }, upkeep: 3, baseHp: 700, armor: 60,
    armorClass: 'plate', damageType: 'kinetic', budgetScale: 1.0,
    traits: { range: 6.5, speed: 0, splashRadius: 0, flying: false, attackRate: 1.1, targeting: 'any', ability: 'none', targets: 1 },
    targetsAir: true, offenseShare: 0.62,
    limitPerCitadelLevel: (l) => 1 + Math.floor(l * 0.9),
    blurb: 'The workhorse. Hits anything, ground or air, at good range.',
  },
  {
    id: 'scatter', name: 'Scatter Battery', category: 'defense', footprint: 3, visualHeight: 0.6,
    maxLevel: 12, cost: { ore: 480, flux: 140 }, upkeep: 4, baseHp: 820, armor: 45,
    armorClass: 'mesh', damageType: 'pyre', budgetScale: 1.0,
    traits: { range: 5.0, speed: 0, splashRadius: 1.8, flying: false, attackRate: 0.5, targeting: 'ground-only', ability: 'none', targets: 1 },
    targetsAir: false, offenseShare: 0.70,
    limitPerCitadelLevel: (l) => Math.floor(l * 0.6),
    blurb: 'Answers swarms. Cannot elevate, so anything airborne ignores it entirely.',
  },
  {
    id: 'skywatch', name: 'Skywatch', category: 'defense', footprint: 2, visualHeight: 0.9,
    maxLevel: 12, cost: { ore: 380, flux: 260 }, upkeep: 4, baseHp: 640, armor: 40,
    armorClass: 'ward', damageType: 'arc', budgetScale: 1.0,
    traits: { range: 8.0, speed: 0, splashRadius: 0, flying: false, attackRate: 1.6, targeting: 'air-only', ability: 'none', targets: 1 },
    targetsAir: true, targetsGround: false, offenseShare: 0.74,
    limitPerCitadelLevel: (l) => Math.floor(l * 0.5),
    blurb: 'Air only, and brutal at it. A dead weight against a ground-only warband.',
  },
  {
    id: 'trench', name: 'Flame Trench', category: 'defense', footprint: 2, visualHeight: 0.35,
    maxLevel: 12, cost: { ore: 340, flux: 180 }, upkeep: 3, baseHp: 900, armor: 80,
    armorClass: 'plate', damageType: 'pyre', budgetScale: 1.0,
    traits: { range: 2.6, speed: 0, splashRadius: 1.1, flying: false, attackRate: 2.4, targeting: 'ground-only', ability: 'none', targets: 1 },
    targetsAir: false, offenseShare: 0.66,
    limitPerCitadelLevel: (l) => Math.floor(l * 0.55),
    blurb: 'Short reach, relentless rate. Put it where the wall breaks.',
  },
  {
    id: 'lance', name: 'Rail Lance', category: 'defense', footprint: 3, visualHeight: 1.0,
    maxLevel: 12, cost: { ore: 900, flux: 620 }, upkeep: 7, baseHp: 1100, armor: 100,
    armorClass: 'plate', damageType: 'kinetic', budgetScale: 1.0,
    traits: { range: 11.0, speed: 0, splashRadius: 0, flying: false, attackRate: 0.22, targeting: 'any', ability: 'none', targets: 1 },
    targetsAir: true, offenseShare: 0.80,
    limitPerCitadelLevel: (l) => Math.max(0, Math.floor((l - 3) * 0.4)),
    blurb: 'Covers the whole holding and deletes one thing at a time. Useless against numbers.',
  },
  {
    id: 'rampart', name: 'Rampart', category: 'wall', footprint: 1, visualHeight: 0.4,
    maxLevel: 12, cost: { ore: 60, flux: 0 }, upkeep: 0, baseHp: 900, armor: 140,
    armorClass: 'plate', isWall: true, limitPerCitadelLevel: (l) => 25 + l * 25,
    blurb: 'Does not fight. Buys time, and decides which way the attackers walk.',
  },
];

export const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));

// Cost of the Nth copy, and of each level. Both climb so that going wide and
// going tall cost comparably -- otherwise one strategy trivially dominates.
export function structureCost(def, level = 1, existingCount = 0) {
  const levelMul = Math.pow(1.55, level - 1);
  const countMul = Math.pow(1.12, existingCount);
  return {
    ore: Math.round((def.cost.ore ?? 0) * levelMul * countMul),
    flux: Math.round((def.cost.flux ?? 0) * levelMul * countMul),
  };
}

export function structureHp(def, level = 1) {
  return Math.round(def.baseHp * Math.pow(1.16, level - 1));
}

export function structureUpkeep(def, level = 1) {
  return Math.round((def.upkeep ?? 0) * Math.pow(1.22, level - 1) * 10) / 10;
}

export function structureProduction(def, level = 1) {
  if (!def.produces) return null;
  const mul = Math.pow(1.24, level - 1);
  const out = {};
  for (const [k, v] of Object.entries(def.produces)) out[k] = Math.round(v * mul);
  return out;
}

export function structureStorage(def, level = 1) {
  if (!def.stores) return null;
  const mul = Math.pow(1.3, level - 1);
  const out = {};
  for (const [k, v] of Object.entries(def.stores)) out[k] = Math.round(v * mul);
  return out;
}

export function structureSupply(def, level = 1) {
  if (!def.supply) return 0;
  return Math.round(def.supply * Math.pow(1.2, level - 1));
}

// A defence's combat stats, through the same solver the units use.
export function defenseStats(def, level = 1) {
  if (def.category !== 'defense') return null;
  const budget = DEF_BUDGET_BASE * (def.budgetScale ?? 1) * Math.pow(DEF_LEVEL_STEP, level - 1);
  const hp = structureHp(def, level);
  // Structures do not spend budget on survivability -- their HP is granted by
  // the building, not bought. So the whole budget goes to offence, and
  // offenseShare only shapes how it is split between damage and rate.
  const solved = solveStats({
    budget,
    traits: def.traits,
    offenseShare: def.offenseShare ?? 0.7,
    armor: def.armor,
  });
  return {
    hp,
    armor: def.armor,
    armorClass: def.armorClass,
    damage: solved.damage,
    attackRate: def.traits.attackRate,
    range: def.traits.range,
    splashRadius: def.traits.splashRadius,
    damageType: def.damageType,
    targetsAir: def.targetsAir !== false,
    targetsGround: def.targetsGround !== false,
    dps: Math.round(solved.damage * def.traits.attackRate * 10) / 10,
    traitCost: Math.round(traitCost(def.traits) * 1000) / 1000,
    ehp: Math.round(effectiveHp(hp, def.armor)),
  };
}

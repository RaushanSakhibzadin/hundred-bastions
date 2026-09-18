// The roster: which units you have, and how you get more.
//
// Recruitment rolls candidates from the seed space rather than unlocking from a
// fixed list. You are always choosing between three specific units, which is a
// better decision than "the next thing on the tree is now affordable".

import { generateUnit } from '../core/balance.js';
import { nameUnit } from '../core/naming.js';
import { Rng } from '../core/rng.js';

export const RECRUIT_COST = { ore: 0, flux: 260 };
export const LEVEL_COST_BASE = { ore: 380, flux: 240 };

export function makeUnit(seed, level = 1) {
  const u = generateUnit(seed, { level });
  u.name = nameUnit(u);
  return u;
}

// Three candidates from a roll seed. The roll seed is stored, so the offer
// survives a reload -- you cannot reroll by refreshing the page, which is the
// kind of thing that quietly ruins an economy.
export function rollCandidates(rollSeed, { forbid = [] } = {}) {
  const rng = new Rng(rollSeed ^ 0x524f4c4c);
  const out = [];
  let guard = 0;
  while (out.length < 3 && guard++ < 60) {
    const seed = rng.next();
    if (forbid.includes(seed)) continue;
    if (out.some((u) => u.seed === seed)) continue;
    out.push(makeUnit(seed));
  }
  return out;
}

export function levelCost(level) {
  const mul = Math.pow(1.62, level - 1);
  return {
    ore: Math.round(LEVEL_COST_BASE.ore * mul),
    flux: Math.round(LEVEL_COST_BASE.flux * mul),
  };
}

// Warband validation. Supply is the only cap, and the message says exactly how
// far over you are rather than refusing silently.
export function warbandSupply(warband) {
  return warband.reduce((a, w) => a + w.unit.supply * w.count, 0);
}

export function warbandPower(warband) {
  return Math.round(warband.reduce((a, w) => a + w.unit.ecv * w.count, 0));
}

export function warbandProblems(warband, supplyCap) {
  const used = warbandSupply(warband);
  const problems = [];
  if (used > supplyCap) problems.push(`Over supply by ${used - supplyCap}. Muster Halls raise the cap.`);
  if (!warband.length) problems.push('Empty warband.');
  return problems;
}

// A rough composition read, shown next to the warband so you can see what you
// have actually built before you find out the hard way.
export function warbandShape(warband) {
  let air = 0, ground = 0, breach = 0, splash = 0, healing = 0, total = 0;
  for (const { unit, count } of warband) {
    const n = count * unit.supply;
    total += n;
    if (unit.flying) air += n; else ground += n;
    if (unit.ability === 'breach' || unit.targeting === 'walls') breach += n;
    if (unit.splashRadius > 0.5) splash += n;
    if (unit.ability === 'mend') healing += n;
  }
  if (!total) return [];
  const pct = (v) => Math.round((v / total) * 100);
  const notes = [];
  if (air === total) notes.push('All air. A single Skywatch cluster ends this.');
  else if (air > 0) notes.push(`${pct(air)}% air`);
  if (breach === 0) notes.push('Nothing to open walls with.');
  if (splash === 0) notes.push('No splash. Slow against packed structures.');
  if (healing > 0) notes.push('Sustained by menders.');
  return notes;
}

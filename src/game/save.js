// Persistence. localStorage only -- no account, no server, nothing leaves the
// machine. The whole save is a small JSON blob you can read, export, and paste
// back in, which is the least this game can do given it asks for donations
// rather than payments.

import { createBase, tickResources, economy, BASE_SUPPLY } from './base.js';
import { makeUnit } from './roster.js';

const KEY = 'hundred-bastions/save/v1';
export const SAVE_VERSION = 1;

export function newGame() {
  const state = {
    version: SAVE_VERSION,
    base: createBase(),
    // Three starting units, fixed seeds so every new player gets the same
    // comprehensible opening hand rather than a random one they cannot read.
    // These three were picked out of the seed space for being plain -- a wall
    // of a Vanguard, a fragile Marksman, a fast Skirmisher, no special
    // abilities and no targeting restrictions between them. They teach the
    // three axes the generator works on before it starts combining them.
    roster: [
      { seed: 100031, level: 1 },  // Vanguard, 4 supply, walks in front
      { seed: 100010, level: 1 },  // Marksman, 2 supply, kills from range
      { seed: 100012, level: 1 },  // Skirmisher, 3 supply, gets there first
    ],
    // Filled in below, once we know what those seeds actually cost in supply.
    warband: [],
    campaign: { highest: 0, cleared: [] },
    rollSeed: (Math.random() * 0xffffffff) >>> 0,
    stats: { sieges: 0, lootOre: 0, lootFlux: 0 },
  };
  state.warband = defaultWarband(state);
  return state;
}

// Fill the opening warband greedily up to the starting supply cap. The unit
// seeds are fixed, but their supply costs come out of the generator, so a
// hand-written count would silently break the moment a balance constant moves.
function defaultWarband(state) {
  const units = state.roster.map((r) => makeUnit(r.seed, r.level));
  const cap = economy(state.base).supply ?? BASE_SUPPLY;
  const band = [];
  let used = 0;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < units.length; i++) {
      if (used + units[i].supply > cap) continue;
      const entry = band.find((w) => w.rosterIndex === i);
      if (entry) entry.count++; else band.push({ rosterIndex: i, count: 1 });
      used += units[i].supply;
    }
  }
  return band;
}

export function hydrate(save) {
  save.units = save.roster.map((r) => makeUnit(r.seed, r.level));
  tickResources(save.base);
  return save;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return hydrate(newGame());
    const parsed = JSON.parse(raw);
    if (parsed.version !== SAVE_VERSION) return hydrate(newGame());
    return hydrate(parsed);
  } catch {
    return hydrate(newGame());
  }
}

export function save(state) {
  const { units, ...rest } = state;
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* private mode */ }
}

export function exportSave(state) {
  const { units, ...rest } = state;
  return btoa(unescape(encodeURIComponent(JSON.stringify(rest))));
}

export function importSave(text) {
  const parsed = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
  if (parsed.version !== SAVE_VERSION) throw new Error('Save is from a different version.');
  return hydrate(parsed);
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

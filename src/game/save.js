// Persistence. localStorage only -- no account, no server, nothing leaves the
// machine. The whole save is a small JSON blob you can read, export, and paste
// back in, which is the least this game can do given it asks for donations
// rather than payments.

import { createBase, tickResources, economy, BASE_SUPPLY } from './base.js';
import { makeUnit } from './roster.js';
import { randomGenome } from '../core/genome.js';
import { emptyLineage, admit, prune } from './lineage.js';

const KEY = 'hundred-bastions/save/v2';
export const SAVE_VERSION = 2;

export function newGame() {
  const state = {
    version: SAVE_VERSION,
    base: createBase(),
    // Three founder genomes: a wall of a Vanguard, a fragile Marksman, a fast
    // Skirmisher. Fixed seeds, so every new player starts from the same three
    // creatures -- and then, within an hour, from three nobody else has.
    roster: [
      { genome: randomGenome('vanguard', 100031), level: 1 },
      { genome: randomGenome('marksman', 100010), level: 1 },
      { genome: randomGenome('skirmisher', 100012), level: 1 },
    ],
    lineage: emptyLineage(),
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
  const units = state.roster.map((r) => makeUnit(r.genome, r.level));
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
  if (!save.lineage) save.lineage = emptyLineage();
  save.units = save.roster.map((r) => makeUnit(r.genome, r.level));
  // Anything in the roster belongs in its own gene pool: those are the
  // creatures you have most clearly endorsed, by still owning them.
  for (const r of save.roster) admit(save.lineage, r.genome);
  prune(save.lineage, new Set(save.roster.map((r) => r.genome.id)));
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

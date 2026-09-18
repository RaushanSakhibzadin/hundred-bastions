// Procedural names.
//
// An infinite roster needs infinite names, and "Unit #8,421,993" is not a name.
// This builds them from a syllable grammar weighted per archetype, so a
// Colossus sounds heavy and a Skirmisher sounds quick -- without any list of
// hand-written names to run out of.

import { Rng, seedOf } from './rng.js';

const ONSET = {
  heavy: ['br', 'gr', 'dr', 'kh', 'th', 'vr', 'gl', 'mor', 'kor', 'dur', 'bal'],
  quick: ['sk', 'vi', 'ze', 'ti', 'fl', 'ki', 'ra', 'sy', 'li', 'ne'],
  sharp: ['ax', 'ser', 'kes', 'tir', 'vel', 'sar', 'cin', 'per', 'xan'],
  airy:  ['ae', 'oli', 'sil', 'mia', 'nu', 'cae', 'lyr', 'io', 'ele'],
};

const CODA = {
  heavy: ['dun', 'gard', 'mok', 'thar', 'ok', 'gun', 'karn', 'grim', 'holt'],
  quick: ['ik', 'et', 'is', 'ra', 'in', 'el', 'ix', 'ka', 'ti'],
  sharp: ['ex', 'ar', 'is', 'os', 'ent', 'ast', 'ir', 'un'],
  airy:  ['eth', 'ion', 'ael', 'ume', 'ira', 'oan', 'yss', 'ora'],
};

const MID = ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'y', 'al', 'or', 'en', 'ir'];

// Epithets. These are drawn against the unit's actual numbers, so the name
// tells you something true before you read the stat block.
const EPITHET = {
  armored:  ['Bulwark', 'Ironbound', 'Shellbacked', 'Warded', 'Anvil'],
  fast:     ['Fleet', 'Quickstep', 'Racing', 'Hasty', 'Windborne'],
  ranged:   ['Longsight', 'Distant', 'Farshot', 'Reaching', 'Overwatch'],
  splash:   ['Scattering', 'Bursting', 'Wide', 'Shattering', 'Blooming'],
  flying:   ['Skyward', 'Drifting', 'Lofted', 'Soaring', 'Cloudcut'],
  fragile:  ['Brittle', 'Hollow', 'Thin', 'Paper', 'Glass'],
  hitting:  ['Heavy', 'Crushing', 'Hammering', 'Sunderer', 'Breaking'],
  plain:    ['Levied', 'Standing', 'Common', 'Steady', 'Plain'],
};

const TYPE_WORD = {
  kinetic: ['Shot', 'Iron', 'Lance', 'Stone', 'Hammer'],
  arc:     ['Spark', 'Coil', 'Storm', 'Current', 'Flash'],
  pyre:    ['Ember', 'Cinder', 'Flare', 'Ash', 'Kindle'],
};

const FLAVOUR = {
  vanguard: 'heavy', colossus: 'heavy', warden: 'heavy',
  skirmisher: 'quick', sapper: 'quick',
  marksman: 'sharp', bombard: 'sharp',
  aeronaut: 'airy',
};

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

const VOWEL = /[aeiouy]$/;

function stem(rng, flavour) {
  const onset = rng.pick(ONSET[flavour]);
  // Only insert a connecting syllable after a consonant cluster, otherwise we
  // get unpronounceable vowel pile-ups like "Ioouora".
  const mid = (!VOWEL.test(onset) && rng.bool(0.55)) ? rng.pick(MID) : '';
  const coda = rng.pick(CODA[flavour]);
  const joined = onset + mid + coda;
  // Collapse any run of three or more vowels down to two.
  return cap(joined.replace(/([aeiouy]{2})[aeiouy]+/g, '$1'));
}

// Which epithet is honest for this unit? Picks whichever trait is furthest
// from average, so the name highlights what is actually unusual about it.
function epithetKey(unit) {
  const candidates = [
    ['flying', unit.flying ? 2.2 : 0],
    ['ranged', Math.max(0, (unit.range - 2.2) / 2)],
    ['splash', Math.max(0, unit.splashRadius / 1.2)],
    ['armored', Math.max(0, (unit.armor - 90) / 110)],
    ['fast', Math.max(0, (unit.speed - 2.8) / 1.4)],
    ['fragile', Math.max(0, (60 - unit.armor) / 60) * (unit.offenseShare > 0.6 ? 1.1 : 0.5)],
    ['hitting', Math.max(0, (unit.damage / Math.max(1, unit.attackRate) - 220) / 260)],
  ];
  let best = 'plain', bestV = 0.42;
  for (const [k, v] of candidates) if (v > bestV) { best = k; bestV = v; }
  return best;
}

export function nameUnit(unit) {
  const rng = new Rng(seedOf(unit.seed) ^ 0x4e414d45);
  const flavour = FLAVOUR[unit.archetype] ?? 'sharp';
  const key = epithetKey(unit);

  // Separate streams per part. Sharing one stream made names correlate across
  // nearby seeds -- three different Marksmen all came out "Overwatch".
  const form = rng.int(0, 3);
  const s = stem(rng.fork('stem'), flavour);
  const ep = rng.fork('epithet').pick(EPITHET[key]);
  const tw = rng.fork('type').pick(TYPE_WORD[unit.damageType]);

  switch (form) {
    case 0: return `${s} ${ep}`;
    case 1: return `${ep} ${s}`;
    case 2: return `${s} ${tw}`;
    default: return `${s} of the ${ep}`;
  }
}

// Bastion names. Same idea, different grammar -- places, not people.
const PLACE_HEAD = ['Kor', 'Ash', 'Ven', 'Dun', 'Gral', 'Sev', 'Mar', 'Tolm', 'Bryn', 'Oth', 'Cael', 'Vor'];
const PLACE_TAIL = ['keep', 'march', 'hold', 'reach', 'watch', 'spire', 'fall', 'gate', 'rest', 'burn', 'mere', 'crag'];
const PLACE_OF = ['Ash', 'Nine Winters', 'Long Dark', 'Salt', 'Quiet Road', 'Broken Oath', 'Last Harvest', 'Red Hour'];

export function nameBastion(seed) {
  const rng = new Rng(seedOf(seed) ^ 0x42415354);
  const base = rng.pick(PLACE_HEAD) + rng.pick(PLACE_TAIL);
  if (rng.bool(0.25)) return `${base} of ${rng.pick(PLACE_OF)}`;
  return base;
}

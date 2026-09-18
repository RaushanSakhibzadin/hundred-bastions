// The balance engine.
//
// Every unit in Hundred Bastions is generated, not authored. The guarantee the
// generator makes is a single equation, and it holds for every seed:
//
//     ECV * traitCost / supply  ===  ECV_PER_SUPPLY * LEVEL_STEP^(level-1)
//
// Read that as: a supply point buys a fixed amount of power, and you may spend
// it either on raw stats or on traits -- range, speed, flight, splash -- at a
// published exchange rate. Note what is deliberately NOT claimed: raw combat
// value per supply is *not* equal across units. A flying long-range unit has
// visibly worse numbers than a slow melee one of the same supply, because it
// spent the difference on being flying and long-range. That is the balance,
// not a violation of it.
//
// See docs/BALANCE.md for the derivation and the reasoning behind each
// constant.

import { Rng, seedOf } from './rng.js';
import { randomGenome } from './genome.js';

// ---------------------------------------------------------------------------
// Constants. Every one of these is a design dial; none of them are magic in
// the sense of "don't touch". Change them and the whole roster rebalances
// coherently, which is the point of generating rather than authoring.
// ---------------------------------------------------------------------------

export const K_ARMOR = 100;          // armor value at which damage is halved
export const ECV_PER_SUPPLY = 120;   // the exchange rate the whole game hangs on
export const BASE_SPEED = 2.4;       // tiles/second considered "normal"
export const MELEE_RANGE = 1.0;      // tiles; the cheapest possible range
export const LEVEL_STEP = 1.12;      // combat value multiplier per unit level
export const IMMOBILE_KAPPA = 0.55;  // the discount for being unable to move at all

// ---------------------------------------------------------------------------
// Damage types and armor classes.
//
// The counter matrix is a circulant built from one triple. Because the triple's
// product is exactly 1, every row AND every column multiplies to 1 -- so no
// damage type is better on average, and no armor class is better on average.
// The triangle is pure rock-paper-scissors with zero net balance drift, and
// tests/balance.test.js asserts exactly that.
// ---------------------------------------------------------------------------

export const DAMAGE_TYPES = ['kinetic', 'arc', 'pyre'];
export const ARMOR_CLASSES = ['plate', 'mesh', 'ward'];

const COUNTER_TRIPLE = [1.25, 1.0, 0.8]; // product === 1

export const COUNTER_MATRIX = (() => {
  const m = {};
  DAMAGE_TYPES.forEach((dt, i) => {
    m[dt] = {};
    ARMOR_CLASSES.forEach((ac, j) => {
      m[dt][ac] = COUNTER_TRIPLE[(j - i + COUNTER_TRIPLE.length) % COUNTER_TRIPLE.length];
    });
  });
  return m;
})();

export function counter(damageType, armorClass) {
  const row = COUNTER_MATRIX[damageType];
  if (!row) return 1;
  return row[armorClass] ?? 1;
}

// ---------------------------------------------------------------------------
// Derived combat quantities.
// ---------------------------------------------------------------------------

// Armor is diminishing-returns damage reduction, never a flat subtraction.
// Flat armor breaks down at the extremes (it makes chip damage worthless and
// makes high-damage units mandatory); this form keeps every unit relevant.
export function damageReduction(armor) {
  return armor / (armor + K_ARMOR);
}

// Effective hit points: how much raw damage a unit actually absorbs.
export function effectiveHp(hp, armor) {
  return hp * (armor + K_ARMOR) / K_ARMOR;
}

// Effective combat value. The geometric mean of what you can take and what you
// can deal. Geometric rather than arithmetic because combat strength in a
// Lanchester-style exchange scales with the product, not the sum: doubling HP
// and doubling DPS makes a unit four times as strong, not twice.
export function ecv(stats) {
  return Math.sqrt(effectiveHp(stats.hp, stats.armor) * dps(stats));
}

export function dps(stats) {
  return stats.damage * stats.attackRate * (stats.targets ?? 1);
}

// ---------------------------------------------------------------------------
// Trait cost coefficients.
//
// Each trait multiplies the unit's price in combat value. kappa > 1 means the
// trait is an advantage and the unit pays raw stats for it; kappa < 1 means the
// trait is a restriction and the unit is compensated with raw stats.
//
// The exponents are fitted so that the cost curve is concave -- the first tile
// of range is worth much more than the tenth -- which stops the generator from
// producing degenerate snipers.
// ---------------------------------------------------------------------------

export const KAPPA = {
  // Range: standing outside the enemy's reach is the single strongest trait in
  // any auto-battler, so it is the most expensive.
  range(r) {
    return Math.pow(1 + (r - MELEE_RANGE) / 4.0, 0.62);
  },

  // Speed: matters for reaching defenses and for kiting. Square-root because
  // speed past a point stops buying anything -- you arrive, then you fight.
  //
  // Speed 0 is not "infinitely cheap movement", it is immobility, which is a
  // different thing and needs its own price. A structure cannot reposition,
  // cannot retreat, and cannot choose its engagements, so it is compensated
  // with raw stats -- which is why turrets out-stat units point for point.
  speed(s) {
    if (s <= 0) return IMMOBILE_KAPPA;
    return Math.pow(s / BASE_SPEED, 0.45);
  },

  // Splash: value scales with the area hit, but real targets are never packed
  // perfectly, so we charge for area with a damping exponent.
  splash(radius) {
    if (!radius) return 1;
    return Math.pow(1 + 0.9 * radius * radius, 0.5);
  },

  // Flight: ignores walls entirely, and only some defenses can answer it.
  flying(isFlying) {
    return isFlying ? 1.55 : 1;
  },

  // Attack rate: fast attackers waste less damage on overkill and react faster
  // to new targets. Small effect, but real, so it is priced.
  attackRate(rate) {
    return Math.pow(rate / 1.0, 0.10);
  },

  // Targeting: a unit that will only attack defenses is easier to plan around
  // but throws away damage on everything else, so it is discounted.
  targeting(pref) {
    return ({
      any: 1.0,
      defenses: 0.86,
      resources: 0.80,
      walls: 0.72,
      'air-only': 0.72,     // useless against a ground-only warband
      'ground-only': 0.92,  // useless against fliers, which are rarer
    })[pref] ?? 1;
  },

  // Abilities, priced individually. See docs/BALANCE.md for how each number
  // was arrived at.
  ability(id) {
    return ({
      none: 1.0,
      regenerate: 1.18,   // heals itself out of combat
      mend: 1.30,         // heals nearby allies
      breach: 1.22,       // extra damage to walls
      volatile: 1.26,     // detonates on death
      shielded: 1.20,     // absorbs the first hits outright
      swarm: 1.34,        // deploys as several smaller bodies
      siege: 1.28,        // bonus damage to structures
    })[id] ?? 1;
  },
};

export function traitCost(traits) {
  return (
    KAPPA.range(traits.range) *
    KAPPA.speed(traits.speed) *
    KAPPA.splash(traits.splashRadius) *
    KAPPA.flying(traits.flying) *
    KAPPA.attackRate(traits.attackRate) *
    KAPPA.targeting(traits.targeting) *
    KAPPA.ability(traits.ability)
  );
}

// ---------------------------------------------------------------------------
// The solver.
//
// Given a budget and a set of traits, produce hp / armor / damage that hit the
// budget exactly.
//
//   budget B, trait cost K  ->  effective budget B' = B / K
//   offense share s in (0,1) splits B' between dealing and taking damage
//
//   DPS = B' * s       * 2 * n(s)
//   EHP = B' * (1 - s) * 2 * n(s)     where n(s) = 0.5 / sqrt(s * (1-s))
//
// The normaliser n(s) is what makes specialisation free. Without it, a 50/50
// unit would have a strictly higher combat value than a glass cannon, and the
// generator would quietly push everything toward the middle. With it:
//
//   ECV = sqrt(EHP * DPS) = B' * 2 * n(s) * sqrt(s(1-s)) = B'
//
// exactly, for every s. Specialising costs you nothing in power and buys you a
// role -- which is the only kind of tradeoff worth having.
// ---------------------------------------------------------------------------

export function solveStats({ budget, traits, offenseShare, armor }) {
  const k = traitCost(traits);
  const bEff = budget / k;

  const s = clamp(offenseShare, 0.15, 0.85);
  const n = 0.5 / Math.sqrt(s * (1 - s));

  const targetDps = bEff * s * 2 * n;
  const targetEhp = bEff * (1 - s) * 2 * n;

  // Armor is chosen first (it is an identity trait, not a power trait), then
  // hp is solved so that effective HP lands on budget regardless. High armor
  // therefore means low HP: same durability, different shape, and a different
  // answer to the counter matrix.
  const hp = targetEhp * K_ARMOR / (armor + K_ARMOR);

  // DPS is damage * rate * targets. Rate and target count are traits, so
  // damage is whatever is left.
  const damage = targetDps / (traits.attackRate * (traits.targets ?? 1));

  return {
    hp: round2(hp),
    armor: round2(armor),
    damage: round2(damage),
    attackRate: traits.attackRate,
    targets: traits.targets ?? 1,
    traitCost: k,
    effectiveBudget: bEff,
  };
}

export function budgetFor(supply, level = 1) {
  return supply * ECV_PER_SUPPLY * Math.pow(LEVEL_STEP, level - 1);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function round2(v) { return Math.round(v * 100) / 100; }

// ---------------------------------------------------------------------------
// Archetypes.
//
// The generator does not roll traits uniformly -- that produces mush. It rolls
// an archetype first, which sets the *shape* of the roll (ranges, not values),
// and then rolls inside it. Two units of the same archetype are recognisably
// cousins and still meaningfully different.
// ---------------------------------------------------------------------------

export const ARCHETYPES = [
  {
    id: 'vanguard', label: 'Vanguard', weight: 14,
    supply: [3, 6], offense: [0.18, 0.34], armor: [90, 210],
    range: [1.0, 1.4], speed: [1.6, 2.4], attackRate: [0.7, 1.1],
    splash: [0, 0], flying: 0, targeting: ['any', 'defenses'],
    abilities: ['none', 'none', 'shielded', 'regenerate', 'breach'],
    role: 'Walks in front. Soaks the first volley so the rest of the warband lives.',
  },
  {
    id: 'skirmisher', label: 'Skirmisher', weight: 18,
    supply: [1, 3], offense: [0.52, 0.72], armor: [10, 55],
    range: [1.0, 1.6], speed: [2.6, 4.2], attackRate: [1.2, 2.2],
    splash: [0, 0], flying: 0, targeting: ['any', 'any', 'resources'],
    abilities: ['none', 'none', 'none', 'swarm', 'volatile'],
    role: 'Cheap, fast, dies fast. Wins by arriving in numbers.',
  },
  {
    id: 'marksman', label: 'Marksman', weight: 16,
    supply: [2, 4], offense: [0.60, 0.80], armor: [5, 40],
    range: [3.4, 7.0], speed: [1.8, 2.8], attackRate: [0.8, 1.6],
    splash: [0, 0], flying: 0, targeting: ['any', 'any', 'defenses'],
    abilities: ['none', 'none', 'none', 'shielded'],
    role: 'Deletes things from outside their reach. Folds the moment it is reached.',
  },
  {
    id: 'bombard', label: 'Bombard', weight: 12,
    supply: [3, 6], offense: [0.45, 0.65], armor: [25, 90],
    range: [2.6, 5.5], speed: [1.2, 2.0], attackRate: [0.35, 0.7],
    splash: [1.0, 2.4], flying: 0, targeting: ['any', 'defenses'],
    abilities: ['none', 'none', 'siege', 'volatile'],
    role: 'Slow arc fire. Clears clustered structures and packed defenders.',
  },
  {
    id: 'aeronaut', label: 'Aeronaut', weight: 11,
    supply: [3, 7], offense: [0.35, 0.62], armor: [20, 110],
    range: [1.0, 4.5], speed: [2.0, 3.4], attackRate: [0.6, 1.4],
    splash: [0, 1.4], flying: 1, targeting: ['any', 'defenses'],
    abilities: ['none', 'none', 'regenerate', 'siege'],
    role: 'Walls mean nothing. Anti-air means everything.',
  },
  {
    id: 'sapper', label: 'Sapper', weight: 9,
    supply: [1, 3], offense: [0.70, 0.85], armor: [5, 45],
    range: [1.0, 1.2], speed: [3.0, 4.6], attackRate: [0.9, 1.8],
    splash: [0, 1.2], flying: 0, targeting: ['walls', 'walls', 'defenses'],
    abilities: ['breach', 'breach', 'volatile'],
    role: 'Opens the wall so everyone else takes the short route in.',
  },
  {
    id: 'warden', label: 'Warden', weight: 8,
    supply: [4, 8], offense: [0.22, 0.40], armor: [60, 170],
    range: [2.0, 4.0], speed: [1.6, 2.6], attackRate: [0.5, 1.0],
    splash: [0, 1.0], flying: 0, targeting: ['any'],
    abilities: ['mend', 'mend', 'shielded', 'regenerate'],
    role: 'Keeps the warband alive. Contributes little damage and is worth every point.',
  },
  {
    id: 'colossus', label: 'Colossus', weight: 6,
    supply: [8, 14], offense: [0.38, 0.58], armor: [140, 300],
    range: [1.0, 2.6], speed: [1.0, 1.8], attackRate: [0.4, 0.8],
    splash: [0.8, 2.0], flying: 0, targeting: ['any', 'defenses'],
    abilities: ['siege', 'volatile', 'shielded', 'breach'],
    role: 'One body, a warband of value. Loses the whole investment in one bad angle.',
  },
];

export function pickArchetype(rng) {
  return rng.weighted(ARCHETYPES, ARCHETYPES.map((a) => a.weight));
}

// ---------------------------------------------------------------------------
// Unit generation.
//
// seed -> a complete, balanced, named, renderable unit. This is the function
// the whole "infinite roster" promise rests on.
// ---------------------------------------------------------------------------

export function generateUnit(seed, { level = 1, archetypeId = null } = {}) {
  const s = seedOf(seed);
  const rng = new Rng(s);
  const arch = archetypeId
    ? (ARCHETYPES.find((a) => a.id === archetypeId) ?? pickArchetype(rng))
    : pickArchetype(rng);
  return unitFromGenome(randomGenome(arch.id, s), level);
}

// A gene in [0,1] into a discrete choice.
function choose(gene, n) {
  return Math.min(n - 1, Math.floor(gene * n));
}

// A gene in [0,1] into an archetype band.
function band(range, gene) {
  return range[0] + (range[1] - range[0]) * gene;
}

// genome -> a complete, balanced, renderable unit.
//
// Every gene enters through an archetype band and leaves through the same
// solver as before, which is the property that matters: evolution can push a
// creature anywhere inside its archetype and cannot move its power off budget.
// A mutation makes a unit *different*, never *stronger*.
export function unitFromGenome(genome, level = 1) {
  const arch = ARCHETYPES.find((a) => a.id === genome.archetype) ?? ARCHETYPES[0];
  const g = genome.genes;

  const supply = Math.max(1, Math.round(band(arch.supply, g.supply)));

  const traits = {
    range: round2(band(arch.range, g.range)),
    speed: round2(band(arch.speed, g.speed)),
    attackRate: round2(band(arch.attackRate, g.rate)),
    splashRadius: round2(band(arch.splash, g.splash)),
    flying: !!arch.flying,
    targeting: arch.targeting[choose(g.targeting, arch.targeting.length)],
    ability: arch.abilities[choose(g.ability, arch.abilities.length)],
    targets: 1,
  };

  const damageType = DAMAGE_TYPES[choose(g.damageType, DAMAGE_TYPES.length)];
  const armorClass = ARMOR_CLASSES[choose(g.armorClass, ARMOR_CLASSES.length)];
  const armor = round2(band(arch.armor, g.armor));
  const offenseShare = round3(band(arch.offense, g.offense));

  const budget = budgetFor(supply, level);
  const stats = solveStats({ budget, traits, offenseShare, armor });

  // 'swarm' splits the same budget across several smaller bodies. More total
  // HP is lost to overkill, which is exactly why kappa charges for it.
  const count = traits.ability === 'swarm' ? 3 + choose(g.brood, 3) : 1;
  if (count > 1) {
    stats.hp = round2(stats.hp / count);
    stats.damage = round2(stats.damage / count);
  }

  const unit = {
    genome,
    seed: seedOf(genome.id),
    id: genome.id,
    level,
    archetype: arch.id,
    archetypeLabel: arch.label,
    role: arch.role,
    supply,
    count,
    damageType,
    armorClass,
    offenseShare,
    ...stats,
    ...traits,
    housing: supply,
  };

  unit.name = null;          // filled in by naming.js, kept out of the math
  unit.ecv = round2(ecv(unit) * count);
  unit.ecvPerSupply = round2(unit.ecv / supply);
  unit.dps = round2(dps(unit) * count);
  unit.ehp = round2(effectiveHp(unit.hp, unit.armor) * count);
  unit.dr = Math.round(damageReduction(unit.armor) * 100);

  // The invariant, carried on the unit so the UI can show it and the test
  // suite can assert it. Equal for every unit of the same level, always.
  unit.powerIndex = round2(unit.ecv * unit.traitCost / supply);
  return unit;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// Damage one entity actually deals to another, counter matrix and armor
// included. The single funnel every damage event in the game goes through.
export function resolveDamage(attacker, defender) {
  const raw = attacker.damage * counter(attacker.damageType, defender.armorClass ?? 'plate');
  const bonus =
    (attacker.ability === 'siege' && defender.kind === 'structure') ? 1.6 :
    (attacker.ability === 'breach' && defender.kind === 'wall') ? 3.0 : 1;
  return raw * bonus * (1 - damageReduction(defender.armor ?? 0));
}

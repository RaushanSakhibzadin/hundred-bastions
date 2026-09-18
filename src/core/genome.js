// Genomes.
//
// A unit is no longer a seed run through a generator. It is a genome: a fixed
// vector of genes, every one a number in [0,1], which crossover and mutation
// operate on directly. That change is what makes evolution possible -- you
// cannot meaningfully breed two seeds, but you can breed two gene vectors.
//
// Three things share the same vector:
//
//   stat genes   map into the archetype's bands and then through the balance
//                solver, so evolution can never break the power invariant
//   form genes   drive the vector creature in morph.js
//   anim genes   drive how it moves
//
// Keeping all three in one vector is the point. When you like a creature and
// its genes propagate, its *look*, its *movement* and its *numbers* travel
// together, because they were never separate things.

import { Rng, seedOf } from './rng.js';

// sigma is the mutation step for that gene, as a fraction of its [0,1] range.
// Form genes step further than stat genes: a silhouette that shifts visibly is
// the whole point of a mutation you are meant to notice and choose.
//
// `flat` marks genes that must be drawn UNIFORMLY in a founder rather than
// from the usual bell. Two kinds qualify. Hue, because a bell around 0.5 puts
// every founder in the same blue-green wedge and a starting population that is
// all one colour has nothing for selection to work with. And every gene that
// maps to a discrete choice -- damage type, ability, leg count, weapon shape --
// because a bell over a list makes the middle entries common and the ends
// nearly unreachable, so a founder population would simply never contain some
// of the abilities the game ships with.
const G = (key, group, sigma, flat = false) => ({ key, group, sigma, flat });

export const GENE_SPEC = [
  // --- statistics -----------------------------------------------------------
  G('supply', 'stat', 0.10),
  G('offense', 'stat', 0.09),
  G('armor', 'stat', 0.10),
  G('range', 'stat', 0.09),
  G('speed', 'stat', 0.09),
  G('rate', 'stat', 0.09),
  G('splash', 'stat', 0.10),
  G('damageType', 'stat', 0.13, true),
  G('armorClass', 'stat', 0.13, true),
  G('ability', 'stat', 0.12, true),
  G('targeting', 'stat', 0.12, true),
  G('brood', 'stat', 0.12, true),

  // --- colour ---------------------------------------------------------------
  G('hue', 'color', 0.07, true),
  G('sat', 'color', 0.10),
  G('light', 'color', 0.08),
  G('accent', 'color', 0.11),

  // --- body -----------------------------------------------------------------
  G('torsoW', 'form', 0.11),
  G('torsoH', 'form', 0.11),
  G('torsoRound', 'form', 0.13),
  G('torsoTaper', 'form', 0.13),
  G('neck', 'form', 0.12),
  G('headSize', 'form', 0.12),
  G('headShape', 'form', 0.14),
  G('eyeCount', 'form', 0.16, true),
  G('eyeSize', 'form', 0.13),
  G('jaw', 'form', 0.14),

  // --- limbs ----------------------------------------------------------------
  G('legCount', 'form', 0.15, true),
  G('legLength', 'form', 0.12),
  G('legWidth', 'form', 0.12),
  G('legSplay', 'form', 0.13),
  G('armLength', 'form', 0.12),
  G('armWidth', 'form', 0.12),

  // --- decoration -----------------------------------------------------------
  G('plateCount', 'form', 0.14),
  G('plateSize', 'form', 0.12),
  G('spikeCount', 'form', 0.16),
  G('spikeLength', 'form', 0.14),
  G('tailLength', 'form', 0.14),
  G('tailCurl', 'form', 0.15),
  G('wingSpan', 'form', 0.13),
  G('wingShape', 'form', 0.14, true),
  G('pattern', 'form', 0.15, true),
  G('patternDensity', 'form', 0.13),
  G('weaponShape', 'form', 0.15, true),
  G('weaponSize', 'form', 0.13),

  // --- animation ------------------------------------------------------------
  G('gaitFreq', 'anim', 0.11),
  G('gaitSwing', 'anim', 0.13),
  G('limbSpread', 'anim', 0.14),
  G('bobAmp', 'anim', 0.13),
  G('lean', 'anim', 0.12),
  G('headLag', 'anim', 0.14),
  G('idleSway', 'anim', 0.13),
  G('recoil', 'anim', 0.13),
  G('breathe', 'anim', 0.13),
  G('tailWag', 'anim', 0.15),
];

export const GENE_KEYS = GENE_SPEC.map((g) => g.key);
export const GENE_BY_KEY = Object.fromEntries(GENE_SPEC.map((g) => [g.key, g]));

export function genesOfGroup(group) {
  return GENE_SPEC.filter((g) => g.group === group).map((g) => g.key);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

let nextLocalId = 1;

export function makeGenomeId(rng) {
  return `g${rng.next().toString(36)}${(nextLocalId++).toString(36)}`;
}

// A founder genome. Genes are drawn from a bell rather than a flat
// distribution, so a starting population clusters near the middle of its
// archetype and the extremes are somewhere for evolution to travel *to*
// rather than where it begins.
export function randomGenome(archetypeId, seed) {
  const rng = new Rng(seedOf(seed) ^ 0x47454e45);
  const genes = {};
  for (const spec of GENE_SPEC) {
    genes[spec.key] = clamp01(spec.flat ? rng.float() : rng.bell());
  }
  return {
    id: makeGenomeId(rng),
    archetype: archetypeId,
    generation: 0,
    parents: [],
    origin: 'founder',
    genes,
  };
}

// ---------------------------------------------------------------------------
// Crossover
//
// Uniform per gene, with a blend on a minority of them. Pure uniform crossover
// can only ever recombine values the parents already hold, which makes a
// population stall once it converges; blending lets a child land between its
// parents and keeps the search continuous.
// ---------------------------------------------------------------------------

export function crossover(a, b, rng) {
  const genes = {};
  for (const spec of GENE_SPEC) {
    const va = a.genes[spec.key], vb = b.genes[spec.key];
    if (rng.bool(0.30)) {
      // BLX-style blend, allowed to overshoot slightly past either parent.
      const lo = Math.min(va, vb), hi = Math.max(va, vb);
      const d = (hi - lo) * 0.25;
      genes[spec.key] = clamp01(rng.range(lo - d, hi + d));
    } else {
      genes[spec.key] = rng.bool() ? va : vb;
    }
  }
  return {
    id: makeGenomeId(rng),
    archetype: a.archetype,
    generation: Math.max(a.generation, b.generation) + 1,
    parents: [a.id, b.id],
    origin: 'bred',
    genes,
  };
}

export function cloneGenome(g) {
  return { ...g, genes: { ...g.genes }, parents: [...(g.parents ?? [])] };
}

// ---------------------------------------------------------------------------
// Mutation
//
// `drift` is the preference signal, and it is the whole reason this system is
// interesting. It carries, per gene, what the units you actually liked look
// like: a `mean` and a `weight` in [0,1] saying how consistently they agree.
//
// A gene the population agrees on gets pulled toward that agreement and given
// a smaller step -- the design has been *found*, so stop wandering away from
// it. A gene nobody agrees on keeps a full-size step and explores. That is the
// mechanism by which "the player kept picking the spiky ones" turns into "the
// next generation is spikier", without anything ever being told what a spike is.
// ---------------------------------------------------------------------------

export const MUTATION = {
  rate: 0.30,        // fraction of genes touched per birth
  scale: 1.0,        // global multiplier on every step
  pull: 0.70,        // how hard a converged gene is pulled toward the liked mean
  macroChance: 0.05, // chance a touched gene is resampled outright
  minScale: 0.35,    // a fully converged gene still steps this much
};

export function mutate(genome, rng, { drift = null, rate = MUTATION.rate, scale = MUTATION.scale } = {}) {
  const genes = { ...genome.genes };
  const changed = [];

  for (const spec of GENE_SPEC) {
    if (!rng.bool(rate)) continue;
    const v = genes[spec.key];

    if (rng.bool(MUTATION.macroChance)) {
      // A jump. Without these a lineage can never leave the basin it started
      // in, however long you breed it.
      genes[spec.key] = clamp01(rng.float());
      changed.push(spec.key);
      continue;
    }

    const d = drift?.[spec.key];
    const weight = d ? d.weight : 0;

    // Converged genes take smaller steps, so a liked trait stays recognisable
    // across generations instead of being mutated back out immediately.
    const step = spec.sigma * scale * (1 - (1 - MUTATION.minScale) * weight);
    let next = v + gaussish(rng) * step;

    // ...and are pulled toward what the player has been choosing.
    if (d) next += (d.mean - v) * MUTATION.pull * weight;

    genes[spec.key] = clamp01(next);
    changed.push(spec.key);
  }

  return {
    ...genome,
    id: makeGenomeId(rng),
    genes,
    mutatedGenes: changed,
  };
}

// Breed two parents into a child, under the population's drift.
export function breed(a, b, rng, opts = {}) {
  const child = crossover(a, b, rng);
  const mutated = mutate(child, rng, opts);
  mutated.parents = child.parents;
  mutated.generation = child.generation;
  mutated.origin = 'bred';
  return mutated;
}

// ---------------------------------------------------------------------------
// Drift: what the liked units look like
//
// For each gene, the affinity-weighted mean across a population, plus a
// `weight` measuring agreement. Agreement is derived from the weighted standard
// deviation: a gene where every liked unit sits at 0.8 has weight near 1, and a
// gene scattered across the whole range has weight near 0.
// ---------------------------------------------------------------------------

export const MAX_SD = 0.29; // sd of a uniform [0,1]; the "no agreement" case

export function computeDrift(records) {
  if (!records.length) return null;
  const drift = {};
  let total = 0;
  for (const r of records) total += Math.max(0, r.affinity);
  if (total <= 0) return null;

  for (const spec of GENE_SPEC) {
    let mean = 0;
    for (const r of records) {
      mean += r.genome.genes[spec.key] * Math.max(0, r.affinity);
    }
    mean /= total;

    let variance = 0;
    for (const r of records) {
      const d = r.genome.genes[spec.key] - mean;
      variance += d * d * Math.max(0, r.affinity);
    }
    variance /= total;
    const sd = Math.sqrt(variance);

    drift[spec.key] = {
      mean,
      weight: clamp01(1 - sd / MAX_SD),
    };
  }
  return drift;
}

// How far apart two genomes are. Used to keep a recruitment offer from showing
// you three near-identical siblings, which is the failure mode of every
// interactive evolution system that forgets to check.
export function distance(a, b) {
  let sum = 0;
  for (const spec of GENE_SPEC) {
    const d = a.genes[spec.key] - b.genes[spec.key];
    sum += d * d;
  }
  return Math.sqrt(sum / GENE_SPEC.length);
}

// Which genes visibly separate a child from a parent. The recruitment card
// shows this, so a mutation is something you can see named rather than a
// difference you are left to spot.
export function notableDifferences(child, parent, limit = 3, expressed = null) {
  const diffs = GENE_SPEC
    .map((spec) => ({ key: spec.key, group: spec.group, delta: child.genes[spec.key] - parent.genes[spec.key] }))
    .filter((d) => Math.abs(d.delta) > 0.06)
    // A mutation in a gene this creature does not express is not a mutation
    // the player can see. Telling a wingless Sapper it has mutated "smoother
    // wings" is worse than saying nothing: it teaches them the readout is noise.
    .filter((d) => !expressed || expressed(d.key))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return diffs.slice(0, limit);
}

// Which genes actually show up on a given unit.
export function expressedGenes(unit) {
  return (key) => {
    if (key.startsWith('wing')) return !!unit.flying;
    if (key === 'brood') return unit.ability === 'swarm';
    if (key === 'splash') return unit.splashRadius > 0.05;
    if (key === 'tailCurl') return unit.genome.genes.tailLength > 0.2;
    if (key === 'patternDensity') return unit.genome.genes.pattern > 0.2;
    if (key === 'spikeLength') return unit.genome.genes.spikeCount > 0.08;
    return true;
  };
}

// Sum of three uniforms, centred and scaled to roughly unit variance. Cheaper
// than Box-Muller, has bounded tails, and cannot return the absurd outliers a
// true normal occasionally does.
function gaussish(rng) {
  return (rng.float() + rng.float() + rng.float() - 1.5) * 1.1547;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export { clamp01 };

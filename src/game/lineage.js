// Artificial selection.
//
// Nobody in this game writes a fitness function. You are the fitness function.
// Every recruitment offer is three creatures bred from the ones you have
// treated well, and "treated well" is measured from what you actually did
// rather than from anything you were asked.
//
// This is interactive evolutionary computation -- the lineage that runs from
// Dawkins' Biomorphs through Picbreeder -- with one difference that matters:
// those systems ask you to click the one you like, which makes the signal
// clean but the task a chore. Here the signal is scavenged from play. You
// level a unit up because you want it stronger, not to vote for it, and the
// vote is a side effect.
//
// The signal is weighted by how much it actually costs you to emit:

export const SIGNALS = {
  // You picked this one over two siblings that were right next to it. As close
  // to a controlled experiment as this system ever gets, so it dominates.
  chosen: 3.5,
  // ...and the two you passed over are evidence too. Without this the pool
  // only ever learns what you like, never what you keep declining.
  rejected: -1.1,
  // You spent ore and flux to make it stronger. Costly, therefore honest.
  levelUp: 2.2,
  // You threw it away. The strongest signal in the system, and negative.
  dismissed: -6.0,
  // You chose to bring it to a siege.
  deployment: 0.45,
  // It is in your warband right now, per body.
  warbandSlot: 0.6,
  // It survived on the field, per second. Cheap per unit, but it accumulates
  // over a campaign and it tracks something real: units that die instantly
  // are units you stop bringing.
  secondFielded: 0.012,
  // You opened its card. The weakest signal here, deliberately -- curiosity is
  // not preference, and weighting it any higher makes the pool chase novelty.
  inspection: 0.12,
};

export const BASE_AFFINITY = 1.0;
export const MIN_AFFINITY = 0.05;
export const POOL_CAP = 24;

// Drift is computed from the best ELITE_SIZE records, not the whole pool.
// The pool is deliberately long-memoried so parent selection can still reach
// back to something you liked twenty recruitments ago, but a mean taken over
// all of it has so much inertia that one new favourite moves it by 1/24 and
// your taste never visibly arrives. The elite is the responsive part.
export const ELITE_SIZE = 10;

// How often a recruitment offer ignores the pool entirely and shows you
// something with fresh genes. Without immigration, an interactive evolution
// system converges on whatever you liked in the first ten minutes and then
// shows you that forever. Roughly one slot in five keeps the search open.
export const IMMIGRATION = 0.20;

// Two offered candidates closer than this are near-identical siblings, and
// offering them is a wasted choice.
export const MIN_OFFER_DISTANCE = 0.09;

import { Rng } from '../core/rng.js';
import { randomGenome, breed, computeDrift, distance, cloneGenome, GENE_SPEC } from '../core/genome.js';
import { ARCHETYPES } from '../core/balance.js';

export function emptyLineage() {
  return { pools: {}, births: 0, offerSeed: (Math.random() * 0xffffffff) >>> 0 };
}

function blankStats() {
  return {
    chosen: 0, rejected: 0, levelUps: 0, dismissed: 0,
    deployments: 0, secondsFielded: 0, inspections: 0,
  };
}

export function poolOf(lineage, archetype) {
  if (!lineage.pools[archetype]) lineage.pools[archetype] = [];
  return lineage.pools[archetype];
}

export function findRecord(lineage, genomeId) {
  for (const pool of Object.values(lineage.pools)) {
    const r = pool.find((x) => x.genome.id === genomeId);
    if (r) return r;
  }
  return null;
}

export function admit(lineage, genome, stats = {}) {
  const existing = findRecord(lineage, genome.id);
  if (existing) return existing;
  const record = { genome: cloneGenome(genome), stats: { ...blankStats(), ...stats } };
  poolOf(lineage, genome.archetype).push(record);
  return record;
}

// `live` is the set of genome ids currently in the player's roster. Those are
// never culled however poorly they score -- a unit you still own staying in
// its own gene pool is the least surprising possible behaviour.
export function prune(lineage, live = new Set()) {
  for (const [arch, pool] of Object.entries(lineage.pools)) {
    if (pool.length <= POOL_CAP) continue;
    const scored = pool.map((r) => ({ r, a: live.has(r.genome.id) ? Infinity : affinityOf(r) }));
    scored.sort((x, y) => y.a - x.a);
    lineage.pools[arch] = scored.slice(0, POOL_CAP).map((s) => s.r);
  }
}

export function affinityOf(record, { warbandBodies = 0 } = {}) {
  const s = record.stats;
  const a = BASE_AFFINITY
    + s.chosen * SIGNALS.chosen
    + s.rejected * SIGNALS.rejected
    + s.levelUps * SIGNALS.levelUp
    + s.dismissed * SIGNALS.dismissed
    + s.deployments * SIGNALS.deployment
    + s.secondsFielded * SIGNALS.secondFielded
    + s.inspections * SIGNALS.inspection
    + warbandBodies * SIGNALS.warbandSlot;
  return Math.max(MIN_AFFINITY, a);
}

// Record an interaction. Everything the UI knows about goes through here, so
// there is exactly one place to look when asking why the pool drifted.
export function note(lineage, genomeId, kind, amount = 1) {
  const r = findRecord(lineage, genomeId);
  if (!r) return null;
  if (!(kind in r.stats)) return null;
  r.stats[kind] += amount;
  return r;
}

// Affinity-weighted records for an archetype, which is what drift is computed
// from and what parents are drawn from.
export function scoredPool(lineage, archetype, warbandBodies = {}) {
  return poolOf(lineage, archetype).map((r) => ({
    genome: r.genome,
    record: r,
    affinity: affinityOf(r, { warbandBodies: warbandBodies[r.genome.id] ?? 0 }),
  }));
}

export function eliteOf(lineage, archetype, warbandBodies = {}) {
  return scoredPool(lineage, archetype, warbandBodies)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, ELITE_SIZE);
}

// Taste across every class at once.
//
// Aesthetic preference is not class-specific. If you keep choosing spiny,
// red, bouncy creatures, you like spiny red bouncy creatures -- that is a
// statement about you, not about Vanguards. And it matters practically:
// with eight classes sharing three offer slots, a per-class pool sees maybe
// one generation an hour, which is far too slow for anyone to notice their
// own taste being learned.
export function globalElite(lineage, warbandBodies = {}) {
  const all = [];
  for (const a of ARCHETYPES) all.push(...scoredPool(lineage, a.id, warbandBodies));
  all.sort((x, y) => y.affinity - x.affinity);
  return all.slice(0, ELITE_SIZE * 2);
}

// The drift a child is born under: per-class for statistics, shared for
// looks and movement.
//
// Statistics stay strictly per class, because a Colossus's armour gene and a
// Skirmisher's armour gene mean different things -- they map into different
// bands and describe different roles. Form, colour and animation genes mean
// the same thing everywhere, so they are pooled across classes and then
// blended back toward the class's own taste as that class accumulates its own
// evidence. Early on you are teaching the game what you like; later you are
// teaching it what you like *in a Vanguard*.
export function driftFor(lineage, archetype, warbandBodies = {}) {
  const classElite = eliteOf(lineage, archetype, warbandBodies);
  const classDrift = computeDrift(classElite);
  const global = computeDrift(globalElite(lineage, warbandBodies));

  if (!classDrift) return global;
  if (!global) return classDrift;

  const w = Math.min(1, classElite.length / ELITE_SIZE);
  const out = {};
  for (const spec of GENE_SPEC) {
    const k = spec.key;
    if (spec.group === 'stat') { out[k] = classDrift[k]; continue; }
    out[k] = {
      mean: global[k].mean + (classDrift[k].mean - global[k].mean) * w,
      weight: global[k].weight + (classDrift[k].weight - global[k].weight) * w,
    };
  }
  return out;
}

// Fitness-proportionate draw. Not tournament selection: with pools this small
// a tournament throws away most of the ordering information, and the ordering
// is the only thing the player gave us.
function draw(scored, rng, exclude = null) {
  const pool = exclude ? scored.filter((s) => s.genome.id !== exclude.genome.id) : scored;
  if (!pool.length) return exclude ?? null;
  let total = 0;
  for (const s of pool) total += s.affinity;
  let roll = rng.float() * total;
  for (const s of pool) { roll -= s.affinity; if (roll <= 0) return s; }
  return pool[pool.length - 1];
}

// How much more likely a liked class is to appear in an offer, at most.
export const ARCHETYPE_BIAS_CAP = 3.2;

// Which class the next offer should belong to.
//
// This is weighted by the MEAN affinity of a class's elite, not the total.
// Using the total was a real bug and a instructive one: total affinity grows
// with pool size, so a class that won a couple of early offers got more slots,
// which grew its pool, which raised its total, which got it more slots. In
// testing it collapsed to a monoculture -- sixty recruitments in a row, every
// single one an Aeronaut. A mean cannot run away like that, and the cap stops
// even a strong preference from amputating two thirds of the roster.
export function archetypeWeights(lineage, warbandBodies = {}) {
  return ARCHETYPES.map((a) => {
    const elite = eliteOf(lineage, a.id, warbandBodies);
    // A class you have never touched stays reachable but is not equal to one
    // you have a line in. Without this, five of the eight classes start with
    // empty pools, so most early offers are unrelated immigrants and the first
    // half hour of play shows no inheritance at all.
    if (!elite.length) return { archetype: a.id, weight: 0.5 };
    const mean = elite.reduce((sum, s) => sum + s.affinity, 0) / elite.length;
    return {
      archetype: a.id,
      weight: Math.min(ARCHETYPE_BIAS_CAP, 1.0 + Math.sqrt(Math.max(0, mean - BASE_AFFINITY)) * 0.5),
    };
  });
}

// --- the offer --------------------------------------------------------------

export function offerCandidates(lineage, { count = 3, warbandBodies = {}, seed = null } = {}) {
  const rng = new Rng(seed ?? lineage.offerSeed);
  const weights = archetypeWeights(lineage, warbandBodies);
  const out = [];

  for (let slot = 0; slot < count; slot++) {
    let candidate = null;

    for (let attempt = 0; attempt < 8 && !candidate; attempt++) {
      // Classes already on the table this round are heavily downweighted, so
      // an offer is usually a choice between two or three kinds of creature
      // rather than three variations on one. A choice between near-identical
      // things is not a choice, and it is also a wasted generation.
      const adjusted = weights.map((w) =>
        out.some((o) => o.genome.archetype === w.archetype) ? w.weight * 0.22 : w.weight);
      const arch = rng.weighted(weights.map((w) => w.archetype), adjusted);
      const scored = scoredPool(lineage, arch, warbandBodies);

      let genome, origin, parents = [];
      if (!scored.length || rng.bool(IMMIGRATION)) {
        genome = randomGenome(arch, rng.next());
        origin = 'immigrant';
      } else if (scored.length === 1) {
        // A pool of one still breeds: with itself, which is just mutation.
        const p = scored[0];
        genome = breed(p.genome, p.genome, rng, { drift: driftFor(lineage, arch, warbandBodies) });
        origin = 'mutation';
        parents = [p];
      } else {
        const a = draw(scored, rng);
        const b = draw(scored, rng, a);
        genome = breed(a.genome, b.genome, rng, { drift: driftFor(lineage, arch, warbandBodies) });
        origin = 'bred';
        parents = [a, b];
      }

      // Reject near-duplicates of what is already on offer.
      const tooClose = out.some((o) => o.genome.archetype === genome.archetype
        && distance(o.genome, genome) < MIN_OFFER_DISTANCE);
      if (tooClose && attempt < 7) continue;

      candidate = { genome, origin, parents: parents.map((p) => p.genome) };
    }

    if (candidate) out.push(candidate);
  }
  return out;
}

// Advance the offer so the same three are not shown again. Stored rather than
// re-randomised so a page reload cannot reroll a recruitment you did not like.
export function rerollOffer(lineage) {
  lineage.offerSeed = (Math.imul(lineage.offerSeed, 1664525) + 1013904223) >>> 0;
}

// The player took one of the three. The taken genome enters the pool with a
// 'chosen'; the two passed over enter it with a 'rejected', because declining
// something is information and throwing it away wastes the most controlled
// comparison this system will ever get.
export function resolveOffer(lineage, candidates, takenIndex) {
  candidates.forEach((c, i) => {
    admit(lineage, c.genome, i === takenIndex ? { chosen: 1 } : { rejected: 1 });
  });
  lineage.births++;
  rerollOffer(lineage);
  return candidates[takenIndex].genome;
}

// --- reporting --------------------------------------------------------------
//
// The player should be able to see what the system thinks it has learned.
// An adaptive system you cannot inspect is indistinguishable from a broken one.

export function lineageReport(lineage, archetype, warbandBodies = {}) {
  const scored = scoredPool(lineage, archetype, warbandBodies)
    .sort((a, b) => b.affinity - a.affinity);
  const drift = computeDrift(scored.slice(0, ELITE_SIZE));
  if (!drift) return null;

  // Which genes your taste has actually settled. Agreement alone is not
  // enough: a gene every unit sits at 0.5 on is highly agreed and says
  // nothing. What is worth reporting is agreement WITH a direction, so the
  // score is weighted by how far the mean has travelled from the middle.
  const settled = Object.entries(drift)
    .map(([key, d]) => ({ key, ...d, force: d.weight * Math.abs(d.mean - 0.5) * 2 }))
    .filter((d) => d.force > 0.18)
    .sort((a, b) => b.force - a.force)
    .slice(0, 6);

  return { scored, drift, settled, size: scored.length };
}

// Plain-language description of a gene's settled value, for the UI. Evolution
// is only satisfying if you can watch it happen.
export const GENE_LABEL = {
  hue: ['colder colouring', 'warmer colouring'],
  sat: ['muted colouring', 'vivid colouring'],
  light: ['darker bodies', 'brighter bodies'],
  torsoW: ['narrow bodies', 'broad bodies'],
  torsoH: ['short bodies', 'tall bodies'],
  torsoRound: ['rounded bodies', 'boxy bodies'],
  torsoTaper: ['bottom-heavy bodies', 'top-heavy bodies'],
  legCount: ['fewer legs', 'more legs'],
  legLength: ['short legs', 'long legs'],
  legWidth: ['thin legs', 'thick legs'],
  legSplay: ['narrow stance', 'wide stance'],
  headSize: ['small heads', 'large heads'],
  headShape: ['soft heads', 'angular heads'],
  eyeCount: ['fewer eyes', 'more eyes'],
  eyeSize: ['small eyes', 'large eyes'],
  jaw: ['no jaw', 'heavy jaw'],
  neck: ['no neck', 'long neck'],
  plateCount: ['unplated', 'heavily plated'],
  plateSize: ['small plates', 'broad plates'],
  spikeCount: ['smooth backs', 'spiny backs'],
  spikeLength: ['short spines', 'long spines'],
  tailLength: ['no tail', 'long tail'],
  tailCurl: ['straight tails', 'curled tails'],
  wingSpan: ['short wings', 'broad wings'],
  wingShape: ['smooth wings', 'scalloped wings'],
  pattern: ['plain hides', 'patterned hides'],
  patternDensity: ['sparse markings', 'dense markings'],
  weaponShape: ['one weapon style', 'another weapon style'],
  weaponSize: ['small weapons', 'oversized weapons'],
  armLength: ['short arms', 'long arms'],
  armWidth: ['thin arms', 'thick arms'],
  gaitFreq: ['slow gait', 'quick gait'],
  gaitSwing: ['stiff stride', 'loping stride'],
  limbSpread: ['hopping gait', 'walking gait'],
  bobAmp: ['level carriage', 'bouncing carriage'],
  lean: ['upright posture', 'forward lean'],
  headLag: ['rigid head', 'trailing head'],
  idleSway: ['still when idle', 'restless when idle'],
  recoil: ['soft attacks', 'heavy recoil'],
  breathe: ['shallow breathing', 'deep breathing'],
  tailWag: ['still tail', 'swinging tail'],
  supply: ['cheap units', 'expensive units'],
  offense: ['durable builds', 'aggressive builds'],
  armor: ['light armour', 'heavy armour'],
  range: ['close range', 'long range'],
  speed: ['slow units', 'fast units'],
  rate: ['slow attacks', 'fast attacks'],
  splash: ['single target', 'wide splash'],
  damageType: ['one damage type', 'another damage type'],
  armorClass: ['one armour class', 'another armour class'],
  ability: ['one ability', 'another ability'],
  targeting: ['one targeting rule', 'another targeting rule'],
  brood: ['small broods', 'large broods'],
};

export function describeGene(key, mean) {
  const pair = GENE_LABEL[key];
  if (!pair) return key;
  return mean < 0.5 ? pair[0] : pair[1];
}

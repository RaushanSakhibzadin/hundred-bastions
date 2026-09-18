// Evolution.
//
// The claim this system makes is not "there is a genetic algorithm in here".
// It is that a player's preference measurably steers what they are offered
// next, without collapsing the variety of what they are offered. Both halves
// need asserting, because each is easy to get at the expense of the other.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/core/rng.js';
import {
  randomGenome, crossover, mutate, breed, computeDrift, distance,
  notableDifferences, GENE_SPEC, GENE_KEYS, genesOfGroup, MUTATION,
} from '../src/core/genome.js';
import { unitFromGenome, ECV_PER_SUPPLY } from '../src/core/balance.js';
import {
  emptyLineage, admit, note, affinityOf, offerCandidates, resolveOffer,
  prune, driftFor, archetypeWeights, lineageReport, scoredPool,
  POOL_CAP, ARCHETYPE_BIAS_CAP, BASE_AFFINITY,
} from '../src/game/lineage.js';
import { ARCHETYPES } from '../src/core/balance.js';

// --- genome mechanics -------------------------------------------------------

test('every gene stays inside [0,1] through any amount of breeding', () => {
  const rng = new Rng(4);
  let a = randomGenome('vanguard', 1);
  let b = randomGenome('vanguard', 2);
  for (let i = 0; i < 400; i++) {
    const child = breed(a, b, rng, { drift: null });
    for (const key of GENE_KEYS) {
      const v = child.genes[key];
      assert.ok(v >= 0 && v <= 1, `gene ${key} escaped to ${v} at generation ${i}`);
      assert.ok(Number.isFinite(v), `gene ${key} became ${v}`);
    }
    a = b; b = child;
  }
});

test('a child inherits from both parents', () => {
  const rng = new Rng(9);
  const a = randomGenome('colossus', 11);
  const b = randomGenome('colossus', 12);
  let fromA = 0, fromB = 0;
  for (let i = 0; i < 40; i++) {
    const child = crossover(a, b, rng);
    for (const key of GENE_KEYS) {
      if (child.genes[key] === a.genes[key]) fromA++;
      else if (child.genes[key] === b.genes[key]) fromB++;
    }
  }
  assert.ok(fromA > 0 && fromB > 0, `inheritance was one-sided: ${fromA} from A, ${fromB} from B`);
});

test('a child resembles its parents more than a stranger does', () => {
  const rng = new Rng(21);
  let closer = 0;
  for (let i = 0; i < 200; i++) {
    const a = randomGenome('warden', i * 3 + 1);
    const b = randomGenome('warden', i * 3 + 2);
    const stranger = randomGenome('warden', i * 3 + 3);
    const child = breed(a, b, rng, { drift: null });
    if (distance(child, a) < distance(stranger, a)) closer++;
  }
  assert.ok(closer > 150, `only ${closer}/200 children resembled a parent more than a stranger did`);
});

test('mutation is small by default and occasionally large', () => {
  const rng = new Rng(33);
  const base = randomGenome('marksman', 55);
  let small = 0, macro = 0;
  for (let i = 0; i < 600; i++) {
    const m = mutate(base, rng, {});
    const d = distance(m, base);
    if (d < 0.08) small++;
    for (const key of GENE_KEYS) {
      if (Math.abs(m.genes[key] - base.genes[key]) > 0.4) { macro++; break; }
    }
  }
  assert.ok(small > 300, `mutations were not mostly small (${small}/600)`);
  assert.ok(macro > 0, 'no large mutation in 600 tries; the lineage can never leave its basin');
});

test('the balance invariant survives arbitrary evolution', () => {
  // This is the point of putting genes through archetype bands and the solver
  // rather than letting them touch statistics directly: evolution can make a
  // creature anything except stronger than its supply cost allows.
  const rng = new Rng(77);
  for (const arch of ARCHETYPES) {
    let a = randomGenome(arch.id, 5);
    let b = randomGenome(arch.id, 6);
    for (let i = 0; i < 60; i++) {
      const child = breed(a, b, rng, { drift: null });
      const unit = unitFromGenome(child, 1);
      assert.ok(Math.abs(unit.powerIndex - ECV_PER_SUPPLY) < 0.6,
        `${arch.id} generation ${i} drifted off budget: ${unit.powerIndex}`);
      a = b; b = child;
    }
  }
});

test('archetype is inherited, never mutated', () => {
  const rng = new Rng(88);
  let a = randomGenome('sapper', 3);
  let b = randomGenome('sapper', 4);
  for (let i = 0; i < 100; i++) {
    const child = breed(a, b, rng, {});
    assert.equal(child.archetype, 'sapper', 'a child changed class');
    a = b; b = child;
  }
});

// --- drift ------------------------------------------------------------------

test('drift finds agreement and ignores scatter', () => {
  const agreed = [0.8, 0.82, 0.79, 0.81].map((v, i) => {
    const g = randomGenome('vanguard', i);
    g.genes.spikeCount = v;
    g.genes.hue = [0.1, 0.9, 0.45, 0.65][i]; // deliberately scattered
    return { genome: g, affinity: 5 };
  });
  const d = computeDrift(agreed);
  assert.ok(Math.abs(d.spikeCount.mean - 0.805) < 0.02, `mean was ${d.spikeCount.mean}`);
  assert.ok(d.spikeCount.weight > 0.9, `agreement on a settled gene was only ${d.spikeCount.weight}`);
  assert.ok(d.hue.weight < 0.2, `a scattered gene reported agreement ${d.hue.weight}`);
});

test('drift is weighted by affinity, not by headcount', () => {
  const records = [
    { genome: withGene('vanguard', 1, 'tailLength', 0.9), affinity: 20 },
    { genome: withGene('vanguard', 2, 'tailLength', 0.1), affinity: 1 },
    { genome: withGene('vanguard', 3, 'tailLength', 0.1), affinity: 1 },
  ];
  const d = computeDrift(records);
  assert.ok(d.tailLength.mean > 0.7,
    `the liked outlier should dominate three ignored ones, got ${d.tailLength.mean}`);
});

test('mutation under drift moves toward the liked mean', () => {
  const rng = new Rng(101);
  const drift = {};
  for (const spec of GENE_SPEC) drift[spec.key] = { mean: 0.9, weight: 1 };
  let g = withGene('vanguard', 7, 'spikeCount', 0.2);
  for (let i = 0; i < 25; i++) g = mutate(g, rng, { drift, rate: 1 });
  assert.ok(g.genes.spikeCount > 0.6,
    `drift failed to pull a gene toward the liked value: ended at ${g.genes.spikeCount}`);
});

test('a gene with no agreement is not pulled anywhere', () => {
  const rng = new Rng(102);
  const drift = {};
  for (const spec of GENE_SPEC) drift[spec.key] = { mean: 1.0, weight: 0 };
  const start = withGene('vanguard', 8, 'spikeCount', 0.5);
  let sum = 0;
  for (let t = 0; t < 200; t++) {
    let g = start;
    for (let i = 0; i < 6; i++) g = mutate(g, rng, { drift, rate: 1 });
    sum += g.genes.spikeCount;
  }
  const mean = sum / 200;
  assert.ok(Math.abs(mean - 0.5) < 0.09,
    `an unagreed gene drifted to ${mean.toFixed(3)} despite zero agreement`);
});

// --- affinity ---------------------------------------------------------------

test('affinity ranks a loved unit above an ignored one above a rejected one', () => {
  const L = emptyLineage();
  const loved = admit(L, randomGenome('vanguard', 1), { chosen: 1 });
  const ignored = admit(L, randomGenome('vanguard', 2));
  const rejected = admit(L, randomGenome('vanguard', 3), { rejected: 1 });
  note(L, loved.genome.id, 'levelUps', 3);
  note(L, loved.genome.id, 'deployments', 12);
  assert.ok(affinityOf(loved) > affinityOf(ignored));
  assert.ok(affinityOf(ignored) > affinityOf(rejected));
});

test('dismissing a unit is the strongest negative signal there is', () => {
  const L = emptyLineage();
  const r = admit(L, randomGenome('vanguard', 1), { chosen: 1 });
  note(L, r.genome.id, 'levelUps', 1);
  const before = affinityOf(r);
  note(L, r.genome.id, 'dismissed', 1);
  assert.ok(affinityOf(r) < before, 'dismissal did not lower affinity');
  assert.ok(affinityOf(r) <= BASE_AFFINITY, 'a dismissed unit still outranks an untouched one');
});

test('affinity never goes negative, so selection never breaks', () => {
  const L = emptyLineage();
  const r = admit(L, randomGenome('vanguard', 1), { rejected: 40, dismissed: 9 });
  assert.ok(affinityOf(r) > 0, `affinity was ${affinityOf(r)}`);
});

// --- the offer --------------------------------------------------------------

test('an offer is always full, even from an empty pool', () => {
  const L = emptyLineage();
  const c = offerCandidates(L, { count: 3, seed: 5 });
  assert.equal(c.length, 3);
  for (const x of c) {
    assert.ok(x.genome.archetype, 'a candidate has no class');
    assert.ok(unitFromGenome(x.genome, 1).name !== undefined);
  }
});

test('an offer is not three of the same class', () => {
  // Regression test. Weighting classes by TOTAL pool affinity made a class
  // that won early wins grow its pool, which grew its total, which won it more
  // offers: sixty recruitments in a row came back Aeronaut. Offers must stay a
  // choice between different kinds of creature.
  const L = emptyLineage();
  for (let i = 0; i < 20; i++) {
    const r = admit(L, randomGenome('aeronaut', i), { chosen: 1 });
    note(L, r.genome.id, 'levelUps', 5);
    note(L, r.genome.id, 'deployments', 20);
  }
  let monocultures = 0;
  for (let round = 0; round < 40; round++) {
    const c = offerCandidates(L, { count: 3, seed: 900 + round });
    const classes = new Set(c.map((x) => x.genome.archetype));
    if (classes.size === 1) monocultures++;
  }
  assert.ok(monocultures < 10,
    `${monocultures}/40 offers were a single class; the pool has collapsed`);
});

test('a class bias exists but is capped', () => {
  const L = emptyLineage();
  for (let i = 0; i < 20; i++) {
    const r = admit(L, randomGenome('colossus', i), { chosen: 1 });
    note(L, r.genome.id, 'levelUps', 40);
    note(L, r.genome.id, 'deployments', 200);
  }
  const weights = archetypeWeights(L);
  const colossus = weights.find((w) => w.archetype === 'colossus');
  const untouched = weights.find((w) => w.archetype === 'sapper');
  assert.ok(colossus.weight > untouched.weight, 'a loved class got no advantage at all');
  assert.ok(colossus.weight <= ARCHETYPE_BIAS_CAP,
    `class bias reached ${colossus.weight}, past its cap of ${ARCHETYPE_BIAS_CAP}`);
});

test('taking one candidate records the two passed over', () => {
  const L = emptyLineage();
  const c = offerCandidates(L, { count: 3, seed: 17 });
  resolveOffer(L, c, 1);
  const stats = (i) => {
    for (const pool of Object.values(L.pools)) {
      const r = pool.find((x) => x.genome.id === c[i].genome.id);
      if (r) return r.stats;
    }
    return null;
  };
  assert.equal(stats(1).chosen, 1);
  assert.equal(stats(0).rejected, 1);
  assert.equal(stats(2).rejected, 1);
  assert.equal(L.births, 1);
});

test('the same offer is not shown twice', () => {
  const L = emptyLineage();
  const first = offerCandidates(L, { count: 3, seed: L.offerSeed });
  resolveOffer(L, first, 0);
  const second = offerCandidates(L, { count: 3, seed: L.offerSeed });
  const ids = new Set(first.map((c) => c.genome.id));
  assert.ok(second.every((c) => !ids.has(c.genome.id)), 'the offer did not advance');
});

test('the pool is capped but never evicts a unit you still own', () => {
  const L = emptyLineage();
  const keeper = admit(L, randomGenome('vanguard', 999), { rejected: 50 });
  for (let i = 0; i < POOL_CAP * 2; i++) {
    admit(L, randomGenome('vanguard', i), { chosen: 1 });
  }
  prune(L, new Set([keeper.genome.id]));
  assert.ok(L.pools.vanguard.length <= POOL_CAP, 'the pool grew past its cap');
  assert.ok(L.pools.vanguard.some((r) => r.genome.id === keeper.genome.id),
    'a genome still in the roster was culled from its own gene pool');
});

// --- the whole loop ---------------------------------------------------------

test('a consistent preference measurably steers what is offered', () => {
  // The headline claim. A simulated player always takes the spiniest of the
  // three. Over eighty recruitments, what they are SHOWN should become
  // spinier -- not just what they take, which would be true by definition.
  const spikiness = (g) => (g.spikeCount + g.spikeLength) / 2;
  const trial = (seed) => {
    const L = emptyLineage();
    L.offerSeed = seed;
    for (let i = 0; i < 4; i++) admit(L, randomGenome('vanguard', seed + i));
    const shown = [];
    for (let r = 0; r < 80; r++) {
      const c = offerCandidates(L, { count: 3 });
      shown.push(c.reduce((a, x) => a + spikiness(x.genome.genes), 0) / c.length);
      let best = 0, bv = -1;
      c.forEach((x, i) => { const v = spikiness(x.genome.genes); if (v > bv) { bv = v; best = i; } });
      resolveOffer(L, c, best);
      note(L, c[best].genome.id, 'levelUps', 2);
      note(L, c[best].genome.id, 'deployments', 3);
      prune(L, new Set());
    }
    return shown;
  };

  const TRIALS = 12;
  const sums = new Array(80).fill(0);
  for (let t = 0; t < TRIALS; t++) {
    const shown = trial(1000 + t * 7919);
    for (let i = 0; i < 80; i++) sums[i] += shown[i];
  }
  const avg = sums.map((v) => v / TRIALS);
  const early = avg.slice(0, 12).reduce((a, b) => a + b) / 12;
  const late = avg.slice(-12).reduce((a, b) => a + b) / 12;

  assert.ok(late > early + 0.04,
    `preference did not steer the offers: ${early.toFixed(3)} -> ${late.toFixed(3)}`);
});

test('an indifferent player is offered no drift at all', () => {
  // The control. Without this the test above proves nothing: a system that
  // drifted regardless of input would pass it just as happily.
  const L = emptyLineage();
  L.offerSeed = 4242;
  for (let i = 0; i < 4; i++) admit(L, randomGenome('vanguard', i));
  const shown = [];
  for (let r = 0; r < 80; r++) {
    const c = offerCandidates(L, { count: 3 });
    shown.push(c.reduce((a, x) => a + x.genome.genes.spikeCount, 0) / c.length);
    resolveOffer(L, c, r % 3); // no preference whatsoever
    prune(L, new Set());
  }
  const early = shown.slice(0, 20).reduce((a, b) => a + b) / 20;
  const late = shown.slice(-20).reduce((a, b) => a + b) / 20;
  assert.ok(Math.abs(late - early) < 0.16,
    `the pool drifted without being told to: ${early.toFixed(3)} -> ${late.toFixed(3)}`);
});

test('variety survives a strong, sustained preference', () => {
  // Converging on your taste is the goal. Converging so hard that every
  // creature is the same creature is the failure mode, and it is the one every
  // interactive evolution system falls into if nobody checks.
  const L = emptyLineage();
  L.offerSeed = 77;
  for (let i = 0; i < 4; i++) admit(L, randomGenome('vanguard', i));
  for (let r = 0; r < 120; r++) {
    const c = offerCandidates(L, { count: 3 });
    let best = 0, bv = -1;
    c.forEach((x, i) => { const v = x.genome.genes.torsoW; if (v > bv) { bv = v; best = i; } });
    resolveOffer(L, c, best);
    note(L, c[best].genome.id, 'levelUps', 3);
    prune(L, new Set());
  }
  const finalOffers = [];
  for (let r = 0; r < 30; r++) finalOffers.push(...offerCandidates(L, { count: 3, seed: 5000 + r }));

  let sum = 0, n = 0;
  for (let i = 0; i < finalOffers.length; i++) {
    for (let j = i + 1; j < finalOffers.length; j++) {
      if (finalOffers[i].genome.archetype !== finalOffers[j].genome.archetype) continue;
      sum += distance(finalOffers[i].genome, finalOffers[j].genome); n++;
    }
  }
  const meanDistance = sum / n;
  assert.ok(meanDistance > 0.10,
    `after 120 rounds of one preference the pool collapsed: mean distance ${meanDistance.toFixed(3)}`);
});

test('mutations are reported in terms a player can read', () => {
  const rng = new Rng(5);
  const parent = randomGenome('vanguard', 3);
  const child = mutate(parent, rng, { rate: 1 });
  const diffs = notableDifferences(child, parent);
  assert.ok(diffs.length > 0, 'a fully mutated child reported no differences');
  for (const d of diffs) assert.ok(GENE_KEYS.includes(d.key));
});

test('the gene groups are all populated', () => {
  for (const group of ['stat', 'form', 'color', 'anim']) {
    assert.ok(genesOfGroup(group).length >= 4, `group ${group} has too few genes`);
  }
  assert.equal(GENE_SPEC.length, GENE_KEYS.length);
});

function withGene(arch, seed, key, value) {
  const g = randomGenome(arch, seed);
  g.genes[key] = value;
  return g;
}

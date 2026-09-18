// The balance invariants. These are the claims the game makes in its own
// documentation, asserted against the generator over a wide sweep of seeds. If
// one of these breaks, the README is lying.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateUnit, solveStats, traitCost, ecv, effectiveHp, dps, budgetFor,
  counter, COUNTER_MATRIX, DAMAGE_TYPES, ARMOR_CLASSES,
  ECV_PER_SUPPLY, LEVEL_STEP, ARCHETYPES, damageReduction,
} from '../src/core/balance.js';
import { STRUCTURES, defenseStats } from '../src/game/structures.js';

const SEEDS = 4000;

test('power index is identical for every generated unit at a given level', () => {
  for (let s = 0; s < SEEDS; s++) {
    const u = generateUnit(s);
    assert.ok(
      Math.abs(u.powerIndex - ECV_PER_SUPPLY) < 0.6,
      `seed ${s} (${u.archetype}) has power index ${u.powerIndex}, expected ${ECV_PER_SUPPLY}`,
    );
  }
});

test('power index scales by exactly LEVEL_STEP per level', () => {
  for (let level = 1; level <= 10; level++) {
    const expected = ECV_PER_SUPPLY * Math.pow(LEVEL_STEP, level - 1);
    for (let s = 0; s < 200; s++) {
      const u = generateUnit(s, { level });
      assert.ok(Math.abs(u.powerIndex - expected) < expected * 0.006,
        `seed ${s} level ${level}: ${u.powerIndex} vs ${expected}`);
    }
  }
});

test('specialisation is free: offense share does not change combat value', () => {
  const traits = {
    range: 2, speed: 2.4, splashRadius: 0, flying: false,
    attackRate: 1, targeting: 'any', ability: 'none', targets: 1,
  };
  const budget = 1000;
  const values = [];
  for (const share of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const st = solveStats({ budget, traits, offenseShare: share, armor: 50 });
    values.push(ecv(st));
  }
  const first = values[0];
  for (const v of values) {
    assert.ok(Math.abs(v - first) / first < 0.002,
      `combat value drifted across offense shares: ${values.join(', ')}`);
  }
});

test('armor changes shape, not durability', () => {
  const traits = {
    range: 1, speed: 2.4, splashRadius: 0, flying: false,
    attackRate: 1, targeting: 'any', ability: 'none', targets: 1,
  };
  const ehps = [10, 60, 150, 300].map((armor) => {
    const st = solveStats({ budget: 1000, traits, offenseShare: 0.5, armor });
    return effectiveHp(st.hp, st.armor);
  });
  for (const e of ehps) {
    assert.ok(Math.abs(e - ehps[0]) / ehps[0] < 0.002,
      `effective HP drifted with armor: ${ehps.join(', ')}`);
  }
});

test('the counter matrix is neutral in both directions', () => {
  // Every damage type's multipliers multiply to 1 across armor classes, and
  // every armor class's multiply to 1 across damage types. No type or class is
  // better on average; the triangle is pure rock-paper-scissors.
  for (const dt of DAMAGE_TYPES) {
    const product = ARMOR_CLASSES.reduce((a, ac) => a * counter(dt, ac), 1);
    assert.ok(Math.abs(product - 1) < 1e-9, `${dt} row product is ${product}`);
  }
  for (const ac of ARMOR_CLASSES) {
    const product = DAMAGE_TYPES.reduce((a, dt) => a * counter(dt, ac), 1);
    assert.ok(Math.abs(product - 1) < 1e-9, `${ac} column product is ${product}`);
  }
  assert.equal(Object.keys(COUNTER_MATRIX).length, DAMAGE_TYPES.length);
});

test('traits are never free: every advantage raises the trait cost', () => {
  const base = {
    range: 1, speed: 2.4, splashRadius: 0, flying: false,
    attackRate: 1, targeting: 'any', ability: 'none', targets: 1,
  };
  const k0 = traitCost(base);
  assert.ok(traitCost({ ...base, range: 6 }) > k0, 'range must cost');
  assert.ok(traitCost({ ...base, speed: 4 }) > k0, 'speed must cost');
  assert.ok(traitCost({ ...base, splashRadius: 2 }) > k0, 'splash must cost');
  assert.ok(traitCost({ ...base, flying: true }) > k0, 'flight must cost');
  assert.ok(traitCost({ ...base, ability: 'mend' }) > k0, 'abilities must cost');
  // ...and every restriction refunds.
  assert.ok(traitCost({ ...base, targeting: 'walls' }) < k0, 'restrictions must refund');
  assert.ok(traitCost({ ...base, speed: 0 }) < k0, 'immobility must refund');
});

test('generated units land inside their archetype bands', () => {
  for (let s = 0; s < SEEDS; s++) {
    const u = generateUnit(s);
    const arch = ARCHETYPES.find((a) => a.id === u.archetype);
    assert.ok(u.supply >= arch.supply[0] && u.supply <= arch.supply[1], `supply ${u.supply}`);
    assert.ok(u.range >= arch.range[0] - 1e-6 && u.range <= arch.range[1] + 1e-6, `range ${u.range}`);
    assert.ok(u.speed >= arch.speed[0] - 1e-6 && u.speed <= arch.speed[1] + 1e-6, `speed ${u.speed}`);
    assert.equal(u.flying, !!arch.flying);
  }
});

test('no generated unit has a nonsensical stat', () => {
  for (let s = 0; s < SEEDS; s++) {
    const u = generateUnit(s);
    for (const k of ['hp', 'damage', 'armor', 'attackRate', 'range', 'speed', 'ecv', 'dps', 'ehp']) {
      assert.ok(Number.isFinite(u[k]), `seed ${s}: ${k} is ${u[k]}`);
      assert.ok(u[k] > 0, `seed ${s}: ${k} is ${u[k]}`);
    }
    assert.ok(u.dr >= 0 && u.dr < 100, `seed ${s}: damage reduction ${u.dr}%`);
  }
});

test('damage reduction is asymptotic and never reaches immunity', () => {
  assert.equal(damageReduction(0), 0);
  assert.ok(Math.abs(damageReduction(100) - 0.5) < 1e-9);
  assert.ok(damageReduction(1e9) < 1);
});

test('every defence resolves through the same solver with finite stats', () => {
  for (const def of STRUCTURES.filter((d) => d.category === 'defense')) {
    for (let level = 1; level <= def.maxLevel; level++) {
      const st = defenseStats(def, level);
      assert.ok(Number.isFinite(st.damage) && st.damage > 0, `${def.id} L${level} damage ${st.damage}`);
      assert.ok(Number.isFinite(st.dps) && st.dps > 0, `${def.id} L${level} dps ${st.dps}`);
      assert.ok(st.traitCost > 0, `${def.id} trait cost ${st.traitCost}`);
    }
  }
});

test('budget is linear in supply', () => {
  assert.ok(Math.abs(budgetFor(4, 1) - 4 * budgetFor(1, 1)) < 1e-9);
  assert.ok(Math.abs(budgetFor(1, 3) - ECV_PER_SUPPLY * LEVEL_STEP ** 2) < 1e-9);
});

test('dps is damage times rate times target count', () => {
  assert.equal(dps({ damage: 10, attackRate: 2, targets: 3 }), 60);
  assert.equal(dps({ damage: 10, attackRate: 2 }), 20);
});

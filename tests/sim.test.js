// Simulation guarantees: determinism, termination, and that difficulty
// actually rises with the bastion number.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateUnit } from '../src/core/balance.js';
import { generateBastion, scout } from '../src/game/bastion.js';
import { createBattle, deploy, recall, step, runToCompletion, score, MAX_TICKS, TICK_HZ } from '../src/game/sim.js';

function warband() {
  return [
    { unit: generateUnit(100031), count: 6 },
    { unit: generateUnit(100010), count: 5 },
    { unit: generateUnit(100012), count: 4 },
  ];
}

function fight(index) {
  const bastion = generateBastion(index);
  const battle = createBattle(bastion, warband());
  deploy(battle, 0, 22, 3);
  deploy(battle, 1, 17, 3);
  deploy(battle, 2, 27, 3);
  return { battle, result: runToCompletion(battle) };
}

test('identical inputs produce identical battles', () => {
  const a = fight(30);
  const b = fight(30);
  assert.deepEqual(a.result, b.result);
  assert.equal(a.battle.tick, b.battle.tick);
  assert.equal(a.battle.events.length, b.battle.events.length);
});

test('the simulation has no hidden randomness', () => {
  // Stronger than "a seed changes the outcome": there is no seed, because
  // there is no random element. Different bastions must still differ, or the
  // inputs are not reaching the simulation at all.
  const a = fight(30).result;
  const b = fight(31).result;
  assert.notDeepEqual(a, b, 'two different bastions produced identical results');
  assert.deepEqual(fight(30).result, a, 'a repeat run diverged');
});

test('every battle terminates', () => {
  for (const index of [1, 3, 12, 40, 150, 900]) {
    const { battle } = fight(index);
    assert.ok(battle.over, `bastion ${index} never ended`);
    assert.ok(battle.tick <= MAX_TICKS, `bastion ${index} ran past the cap`);
  }
});

test('difficulty rises with the bastion number', () => {
  const easy = fight(2).result.destruction;
  const hard = fight(400).result.destruction;
  assert.ok(easy > hard, `bastion 2 scored ${easy}, bastion 400 scored ${hard}`);
});

test('scoring is continuous, not tiered', () => {
  const r = score({
    totalValue: 200, destroyedValue: 97, citadelDown: false, tick: 60,
    bastion: { loot: { ore: 1000, flux: 500 } },
  });
  assert.equal(r.percent, 49);
  // The point of continuous scoring: a 48.5% attack is worth 48.5% of the
  // loot, not nothing for having missed a 50% threshold.
  assert.equal(r.loot.ore, 485);
  assert.equal(r.loot.flux, 243);
});

test('taking the citadel is worth a bonus but cannot exceed the full pool', () => {
  const r = score({
    totalValue: 100, destroyedValue: 100, citadelDown: true, tick: 60,
    bastion: { loot: { ore: 1000, flux: 500 } },
  });
  assert.equal(r.loot.ore, 1000);
  assert.equal(r.grade, 'Total');
});

test('recall returns unengaged bodies to the warband', () => {
  const bastion = generateBastion(60);
  const battle = createBattle(bastion, warband());
  const before = battle.remaining[0];
  deploy(battle, 0, 22, 2);
  assert.equal(battle.remaining[0], 0);
  // Two seconds of nothing happening to them, then they can walk back off.
  for (let i = 0; i < TICK_HZ * 2 + 2; i++) step(battle);
  const recalled = recall(battle);
  assert.ok(recalled > 0, 'nothing was recalled');
  assert.ok(battle.remaining[0] > 0, 'recalled bodies did not return to the warband');
  assert.ok(battle.remaining[0] <= before, 'recall returned more than was deployed');
});

test('recall refuses bodies that are currently engaged', () => {
  const bastion = generateBastion(40);
  const battle = createBattle(bastion, warband());
  deploy(battle, 0, 22, 3);
  // Long enough for them to have walked into something.
  for (let i = 0; i < TICK_HZ * 40; i++) step(battle);
  const engaged = battle.entities.filter(
    (e) => e.side === 'attacker' && e.alive && battle.tick - e.engagedTick < TICK_HZ * 2);
  recall(battle);
  for (const e of engaged) assert.ok(e.alive || e.deathTick != null, 'an engaged body was recalled');
});

test('the command log fully describes a battle', () => {
  const bastion = generateBastion(25);
  const battle = createBattle(bastion, warband());
  deploy(battle, 0, 20, 3);
  for (let i = 0; i < 50; i++) step(battle);
  deploy(battle, 1, 24, 3);
  assert.equal(battle.commands.length, 2);
  assert.equal(battle.commands[0].tick, 0);
  assert.equal(battle.commands[1].tick, 50);
  assert.equal(battle.commands[1].i, 1);
});

test('a scout report never lies about anti-air', () => {
  for (const index of [1, 7, 25, 88, 300]) {
    const b = generateBastion(index);
    const rep = scout(b);
    const claimsNone = rep.notes.some((n) => n.includes('No anti-air'));
    assert.equal(claimsNone, rep.airDefense === 0, `bastion ${index} misreported anti-air`);
  }
});

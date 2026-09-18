// Generation guarantees: determinism across the RNG, sprites that are actually
// drawable, and bastions that are actually playable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, mix32, hashString, noise2 } from '../src/core/rng.js';
import { generateUnit } from '../src/core/balance.js';
import { nameUnit, nameBastion } from '../src/core/naming.js';
import { structureSpriteGrid, structurePalette } from '../src/core/spritegen.js';
import { buildCreature, poseCreature, palette } from '../src/core/morph.js';
import { randomGenome } from '../src/core/genome.js';
import { generateBastion } from '../src/game/bastion.js';
import { STRUCTURES, STRUCTURE_BY_ID } from '../src/game/structures.js';
import { createBase, economy, coverageField, place, remove, GRID_W, GRID_H } from '../src/game/base.js';

test('the RNG is deterministic and seed-stable', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  assert.equal(hashString('archer'), hashString('archer'));
  assert.notEqual(hashString('archer'), hashString('archeR'));
  assert.equal(mix32(0), mix32(0));
});

test('the RNG stays inside its declared ranges', () => {
  const r = new Rng(99);
  for (let i = 0; i < 20000; i++) {
    const f = r.float();
    assert.ok(f >= 0 && f < 1, `float out of range: ${f}`);
    const n = r.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && Number.isInteger(n), `int out of range: ${n}`);
    const b = r.bell();
    assert.ok(b >= 0 && b < 1, `bell out of range: ${b}`);
  }
});

test('forked streams do not disturb the parent', () => {
  const parent = new Rng(7);
  const expected = [];
  for (let i = 0; i < 5; i++) expected.push(parent.next());

  const parent2 = new Rng(7);
  const got = [];
  for (let i = 0; i < 5; i++) {
    const child = parent2.fork('sprite');
    for (let j = 0; j < 50; j++) child.next();
    got.push(parent2.next());
  }
  assert.deepEqual(got, expected);
});

test('noise2 is stable per lattice point', () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(noise2(42, i, 3), noise2(42, i, 3));
  }
  assert.notEqual(noise2(42, 1, 1), noise2(43, 1, 1));
});

test('every creature builds a complete body', () => {
  for (let s = 0; s < 1200; s++) {
    const unit = generateUnit(s);
    const c = buildCreature(unit);
    assert.ok(c.parts.length >= 4, `seed ${s} produced only ${c.parts.length} parts`);
    assert.ok(c.parts.some((p) => p.name === 'torso'), `seed ${s} has no torso`);
    assert.ok(c.parts.some((p) => p.name === 'head'), `seed ${s} has no head`);
    assert.ok(c.parts.some((p) => p.name.startsWith('leg')), `seed ${s} has no legs`);
    assert.ok(c.bounds.w > 0 && c.bounds.h > 0, `seed ${s} has empty bounds`);
    for (const part of c.parts) {
      for (const shape of part.shapes) {
        if (shape.kind === 'poly') {
          assert.ok(shape.pts.length >= 3, `seed ${s}: degenerate polygon in ${part.name}`);
          for (const [x, y] of shape.pts) {
            assert.ok(Number.isFinite(x) && Number.isFinite(y), `seed ${s}: NaN point in ${part.name}`);
          }
        } else {
          assert.ok(shape.r[0] > 0 && shape.r[1] > 0, `seed ${s}: degenerate ellipse in ${part.name}`);
        }
      }
    }
  }
});

test('fliers get wings and walkers do not', () => {
  let fliers = 0, walkers = 0;
  for (let s = 0; s < 600; s++) {
    const unit = generateUnit(s);
    const hasWings = buildCreature(unit).parts.some((p) => p.name.startsWith('wing'));
    assert.equal(hasWings, !!unit.flying, `seed ${s}: wings ${hasWings}, flying ${unit.flying}`);
    if (unit.flying) fliers++; else walkers++;
  }
  assert.ok(fliers > 0 && walkers > 0, 'the sample had no variety to test');
});

test('posing is continuous and bounded', () => {
  const unit = generateUnit(4242);
  const c = buildCreature(unit);
  let prev = null;
  for (let i = 0; i <= 60; i++) {
    const t = i / 30;
    const pose = poseCreature(c, t, { moving: true });
    assert.equal(pose.transforms.length, c.parts.length);
    for (const tr of pose.transforms) {
      assert.ok(Number.isFinite(tr.rot), 'NaN rotation');
      assert.ok(Math.abs(tr.rot) < Math.PI, `rotation ${tr.rot} is past half a turn`);
      assert.ok(tr.scaleY > 0.5 && tr.scaleY < 1.5, `scale ${tr.scaleY} is extreme`);
    }
    // No part may jump between adjacent frames: animation is sampled from
    // continuous functions, so a discontinuity means a real bug.
    if (prev) {
      for (let k = 0; k < prev.length; k++) {
        assert.ok(Math.abs(prev[k].rot - pose.transforms[k].rot) < 0.6,
          `part ${c.parts[k].name} jumped ${Math.abs(prev[k].rot - pose.transforms[k].rot).toFixed(2)} rad between frames`);
      }
    }
    prev = pose.transforms;
  }
});

test('an idle creature still moves, and a walking one moves more', () => {
  const c = buildCreature(generateUnit(77));
  const spread = (moving) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 120; i++) {
      const r = poseCreature(c, i / 30, { moving }).transforms
        .reduce((a, t) => a + Math.abs(t.rot), 0);
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    return hi - lo;
  };
  const idle = spread(false), walking = spread(true);
  assert.ok(idle > 0, 'an idle creature is frozen');
  assert.ok(walking > idle, `walking (${walking.toFixed(3)}) should move more than idle (${idle.toFixed(3)})`);
});

test('palettes are complete and well formed', () => {
  for (let s = 0; s < 400; s++) {
    const pal = palette(generateUnit(s));
    for (const k of ['body', 'shade', 'light', 'outline', 'accent', 'glow']) {
      assert.match(pal[k], /^hsl\(/, `seed ${s}: ${k} is "${pal[k]}"`);
    }
  }
  for (const def of STRUCTURES) {
    const pal = structurePalette(def);
    assert.equal(pal.length, 7);
    const { grid, size } = structureSpriteGrid(def, def.id);
    assert.equal(grid.length, size * size);
    assert.ok(grid.some((v) => v > 1), `${def.id} produced an empty sprite`);
  }
});

test('names are stable, non-empty, and varied', () => {
  const seen = new Set();
  for (let s = 0; s < 3000; s++) {
    const u = generateUnit(s);
    const n = nameUnit(u);
    assert.equal(n, nameUnit(u), 'naming is not deterministic');
    assert.ok(n.length > 2, `empty-ish name at seed ${s}: "${n}"`);
    assert.doesNotMatch(n, /[aeiouy]{3}/i, `unpronounceable name at seed ${s}: "${n}"`);
    seen.add(n);
  }
  assert.ok(seen.size > 2000, `only ${seen.size} distinct names in 3000 seeds`);
  assert.equal(nameBastion(5), nameBastion(5));
});

test('bastions are deterministic, in bounds, and never overlap', () => {
  for (const index of [1, 9, 42, 500, 123456]) {
    const a = generateBastion(index);
    const b = generateBastion(index);
    assert.deepEqual(a.structures, b.structures, `bastion ${index} is not deterministic`);

    const occ = new Set();
    for (const s of a.structures) {
      const def = STRUCTURE_BY_ID[s.defId];
      assert.ok(def, `unknown structure ${s.defId}`);
      for (let y = s.y; y < s.y + def.footprint; y++) {
        for (let x = s.x; x < s.x + def.footprint; x++) {
          assert.ok(x >= 0 && x < GRID_W && y >= 0 && y < GRID_H,
            `bastion ${index} placed ${s.defId} out of bounds at ${x},${y}`);
          const key = `${x},${y}`;
          assert.ok(!occ.has(key), `bastion ${index} overlapped at ${key}`);
          occ.add(key);
        }
      }
    }
    assert.ok(a.structures.some((s) => s.defId === 'citadel'), `bastion ${index} has no citadel`);
  }
});

test('the economy never lets upkeep be invisible', () => {
  const base = createBase();
  const before = economy(base);
  assert.ok(before.net.ore > 0, 'a fresh holding should be solvent');
  assert.ok(before.upkeep > 0, 'a fresh holding already has upkeep');
  assert.equal(before.production.ore - before.upkeep, before.net.ore);
});

test('demolishing refunds in full and frees the tiles', () => {
  const base = createBase();
  const oreBefore = base.resources.ore;
  const fluxBefore = base.resources.flux;
  const r = place(base, 'rampart', 2, 2);
  assert.ok(r.ok, JSON.stringify(r.problems));
  assert.ok(base.resources.ore < oreBefore);
  remove(base, r.structure.id);
  assert.equal(base.resources.ore, oreBefore);
  assert.equal(base.resources.flux, fluxBefore);
  assert.ok(place(base, 'rampart', 2, 2).ok, 'the tile was not freed');
});

test('the citadel cannot be demolished', () => {
  const base = createBase();
  const citadel = base.structures.find((s) => s.defId === 'citadel');
  assert.equal(remove(base, citadel.id), false);
  assert.ok(base.structures.includes(citadel));
});

test('coverage only counts defences and respects their range', () => {
  const base = createBase();
  const covered = coverageField(base).reduce((a, v) => a + (v ? 1 : 0), 0);
  const defenses = base.structures.filter((s) => STRUCTURE_BY_ID[s.defId].category === 'defense');
  assert.ok(defenses.length > 0);
  const maxRange = Math.max(...defenses.map((s) => STRUCTURE_BY_ID[s.defId].traits.range));
  const ceiling = defenses.length * Math.PI * (maxRange + 2) ** 2;
  assert.ok(covered > 0 && covered < ceiling, `coverage ${covered} is implausible`);
});

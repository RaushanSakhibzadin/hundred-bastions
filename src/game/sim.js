// The siege simulation.
//
// Fixed timestep, integer tick count, seeded RNG, no wall-clock anywhere. Given
// the same bastion index, the same warband and the same command log, this
// produces byte-identical results on every machine -- which is what makes the
// replay scrubber and the shareable siege code possible.
//
// Two deliberate departures from the genre's usual shape, both of which make
// the game easier to play rather than harder:
//
//   * You deploy a SQUAD with one gesture, not one body per tap. Tapping out
//     thirty individual bodies under a timer is dexterity, not strategy, and
//     the strategy was the interesting part.
//   * You can pause, retarget with a rally point, and recall anything that has
//     not yet been engaged. A misread is a decision you get to revise instead
//     of an attack you have to sit through.

import { resolveDamage } from '../core/balance.js';
import { STRUCTURE_BY_ID, structureHp, defenseStats } from './structures.js';

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const MAX_TICKS = TICK_HZ * 240; // four minutes is a long siege

const WALL_COST = 9;      // walls are passable at a price: you break through
const BUILDING_COST = 60; // buildings are avoided unless there is no way round
const IMPASSABLE = 1e9;

// No seed, and no RNG anywhere in this file. Every outcome falls out of the
// bastion, the warband and the command log. That is a stronger guarantee than
// a seeded simulation: there is nothing left that could diverge.
export function createBattle(bastion, warband) {
  const w = bastion.grid.w, h = bastion.grid.h;
  const entities = [];
  let nextId = 1;

  for (const s of bastion.structures) {
    const def = STRUCTURE_BY_ID[s.defId];
    const hp = structureHp(def, s.level);
    const ds = def.category === 'defense' ? defenseStats(def, s.level) : null;
    entities.push({
      id: nextId++, side: 'defender',
      kind: def.isWall ? 'wall' : 'structure',
      defId: s.defId, def, level: s.level,
      x: s.x + def.footprint / 2, y: s.y + def.footprint / 2,
      gx: s.x, gy: s.y, footprint: def.footprint,
      hp, maxHp: hp, armor: def.armor, armorClass: def.armorClass,
      alive: true, cooldown: 0,
      value: structureValue(def, s.level),
      ...(ds ? {
        damage: ds.damage, attackRate: ds.attackRate, range: ds.range,
        splashRadius: ds.splashRadius, damageType: ds.damageType,
        targetsAir: ds.targetsAir, targetsGround: ds.targetsGround,
      } : {}),
    });
  }

  const totalValue = entities.reduce((a, e) => a + e.value, 0);

  return {
    tick: 0,
    w, h,
    bastion,
    entities,
    nextId,
    // remaining[i] is how many bodies of warband[i] are still undeployed
    warband: warband.map((w) => ({ unit: w.unit, count: w.count })),
    remaining: warband.map((w) => w.count),
    rally: null,
    commands: [],
    events: [],
    totalValue,
    destroyedValue: 0,
    citadelDown: false,
    over: false,
    result: null,
  };
}

function structureValue(def, level) {
  // What a structure is worth toward the siege score. Walls count for very
  // little -- grinding a wall ring for score is not an attack, and the scoring
  // should not pretend otherwise.
  if (def.isWall) return 0.5;
  if (def.category === 'core') return 80;
  if (def.category === 'defense') return 12 + level * 1.5;
  return 6 + level;
}

// ---------------------------------------------------------------------------
// Commands. Everything a player does goes through here and is logged, so a
// battle is fully described by (bastion index, warband, command log).
// ---------------------------------------------------------------------------

export function deploy(battle, warbandIndex, x, y, count = null) {
  const slot = battle.warband[warbandIndex];
  if (!slot) return 0;
  const avail = battle.remaining[warbandIndex];
  if (avail <= 0) return 0;
  const n = count == null ? avail : Math.min(count, avail);
  battle.commands.push({ tick: battle.tick, type: 'deploy', i: warbandIndex, x, y, n });
  spawn(battle, warbandIndex, x, y, n);
  return n;
}

function spawn(battle, warbandIndex, x, y, n) {
  const unit = battle.warband[warbandIndex].unit;
  battle.remaining[warbandIndex] -= n;
  // Bodies land in a loose ring so a squad does not stack into one pixel and
  // get deleted by a single splash shot.
  const bodies = n * (unit.count ?? 1);
  // Spread the squad over a spiral rather than a tight ring. Bodies are drawn
  // two to four tiles wide, so a one-tile ring stacked them into a single blob
  // and handed any splash defence a free multi-kill.
  for (let i = 0; i < bodies; i++) {
    const a = i * 2.39996; // golden angle: even coverage at any squad size
    const r = bodies > 1 ? 1.1 + Math.sqrt(i) * 0.85 : 0;
    battle.entities.push({
      id: battle.nextId++, side: 'attacker', kind: 'unit',
      unit, warbandIndex,
      x: clamp(x + Math.cos(a) * r, 0.5, battle.w - 0.5),
      y: clamp(y + Math.sin(a) * r, 0.5, battle.h - 0.5),
      hp: unit.hp, maxHp: unit.hp,
      shield: unit.ability === 'shielded' ? unit.hp * 0.35 : 0,
      armor: unit.armor, armorClass: unit.armorClass, damageType: unit.damageType,
      damage: unit.damage, attackRate: unit.attackRate, range: unit.range,
      splashRadius: unit.splashRadius, speed: unit.speed, flying: unit.flying,
      targeting: unit.targeting, ability: unit.ability,
      alive: true, cooldown: 0, target: null, lastHitTick: -999,
      engagedTick: -999, spawnTick: battle.tick, value: 0,
      // Rendering state. The simulation owns it because only the simulation
      // knows when a blow actually landed.
      lastAttackTick: -999, facing: 1, moving: false,
    });
  }
}

export function setRally(battle, x, y) {
  battle.rally = { x, y };
  battle.commands.push({ tick: battle.tick, type: 'rally', x, y });
}

export function clearRally(battle) {
  battle.rally = null;
  battle.commands.push({ tick: battle.tick, type: 'rally', x: null, y: null });
}

// Recall: anything that has not been shot at or engaged for two seconds walks
// off the field and goes back into the warband, redeployable. This is the
// single biggest quality-of-life change in the game. It turns a misplaced
// squad from a lost attack into a lost ten seconds.
export function recall(battle) {
  battle.commands.push({ tick: battle.tick, type: 'recall' });
  let n = 0;
  for (const e of battle.entities) {
    if (e.side !== 'attacker' || !e.alive) continue;
    if (battle.tick - e.engagedTick < TICK_HZ * 2) continue;
    if (battle.tick - e.lastHitTick < TICK_HZ * 2) continue;
    e.alive = false;
    e.recalled = true;
    battle.remaining[e.warbandIndex] += 1 / (e.unit.count ?? 1);
    n++;
  }
  for (let i = 0; i < battle.remaining.length; i++) {
    battle.remaining[i] = Math.round(battle.remaining[i] * 1000) / 1000;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Pathing.
//
// A Dijkstra field per target, cached. Walls cost WALL_COST rather than being
// impassable, so a unit routes around a wall when going round is cheap and
// smashes through when it is not -- the same judgement a player makes.
// ---------------------------------------------------------------------------

function buildBlockField(battle) {
  const { w, h } = battle;
  const cost = new Float32Array(w * h).fill(1);
  const occupant = new Int32Array(w * h).fill(0);
  for (const e of battle.entities) {
    if (e.side !== 'defender' || !e.alive) continue;
    const c = e.kind === 'wall' ? WALL_COST : BUILDING_COST;
    for (let y = e.gy; y < e.gy + e.footprint; y++) {
      for (let x = e.gx; x < e.gx + e.footprint; x++) {
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        cost[y * w + x] = c;
        occupant[y * w + x] = e.id;
      }
    }
  }
  battle._cost = cost;
  battle._occupant = occupant;
  battle._fields = new Map();
  battle._byId = new Map(battle.entities.map((e) => [e.id, e]));
  battle._pathDirty = false;
  battle._lastRepath = battle.tick;
}

// When a structure dies we patch its tiles out of the cost map immediately --
// that part is cheap -- but we do NOT throw away the cached distance fields,
// because recomputing a Dijkstra field per attacker every time a single wall
// segment falls is what turned a four-minute siege into a four-minute stall.
// Instead we mark the paths dirty and rebuild on a fixed cadence. Units
// briefly follow a slightly stale route, which is indistinguishable from them
// not having noticed the gap yet, and is arguably more believable.
function clearTiles(battle, e) {
  if (!battle._cost) return;
  const { w, h } = battle;
  for (let y = e.gy; y < e.gy + e.footprint; y++) {
    for (let x = e.gx; x < e.gx + e.footprint; x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      battle._cost[y * w + x] = 1;
      battle._occupant[y * w + x] = 0;
    }
  }
  battle._pathDirty = true;
}

const REPATH_INTERVAL = 12;   // ticks between rebuilds of stale paths
const FIELDS_PER_TICK = 3;    // Dijkstra budget, so one tick can never spike

function flowField(battle, target) {
  if (!battle._cost) buildBlockField(battle);
  const cached = battle._fields.get(target.id);
  if (cached) return cached;
  // Respect the per-tick budget. A unit that cannot get a field this tick
  // falls back to its previous one, or to walking straight at the target.
  if (battle._fieldsThisTick >= FIELDS_PER_TICK) return null;
  battle._fieldsThisTick++;

  const { w, h } = battle;
  // Float64, not Float32. Storing a double into a Float32Array rounds it, and
  // the rounded value can compare strictly less than the double that produced
  // it -- so `nd < dist[i]` stays true after the write and the same node is
  // relaxed and re-pushed forever. This loop hung the whole simulation.
  const dist = new Float64Array(w * h).fill(Infinity);
  const cost = battle._cost;
  const occupant = battle._occupant;

  // Seed from every tile the target occupies.
  const heap = new MinHeap();
  for (let y = target.gy; y < target.gy + target.footprint; y++) {
    for (let x = target.gx; x < target.gx + target.footprint; x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      dist[y * w + x] = 0;
      heap.push(0, y * w + x);
    }
  }

  const NX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (heap.size) {
    const [d, idx] = heap.pop();
    if (d > dist[idx]) continue;
    const x = idx % w, y = (idx / w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NX[k], ny = y + NY[k];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      // Never path *through* the target's own neighbours cheaply -- entering a
      // tile occupied by something else costs that thing's cost.
      const step = (k < 4 ? 1 : 1.4142) * (occupant[nidx] === target.id ? 1 : cost[nidx]);
      const nd = d + step;
      if (nd < dist[nidx]) { dist[nidx] = nd; heap.push(nd, nidx); }
    }
  }
  battle._fields.set(target.id, dist);
  return dist;
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

const TARGET_CATEGORY = {
  defenses: (e) => e.def.category === 'defense',
  resources: (e) => e.def.category === 'resource' || e.def.category === 'storage',
  walls: (e) => e.kind === 'wall',
  any: () => true,
};

function acquire(battle, unit) {
  const pref = TARGET_CATEGORY[unit.targeting] ?? TARGET_CATEGORY.any;
  let best = null, bestScore = Infinity;
  let fallback = null, fallbackScore = Infinity;

  // A rally point biases target choice toward where the player pointed,
  // without overriding the unit's nature. It is a suggestion, not an order,
  // which keeps it from turning into micromanagement.
  const rx = battle.rally?.x, ry = battle.rally?.y;

  for (const e of battle.entities) {
    if (e.side !== 'defender' || !e.alive) continue;
    const dx = e.x - unit.x, dy = e.y - unit.y;
    let score = Math.hypot(dx, dy);
    if (rx != null) score += Math.hypot(e.x - rx, e.y - ry) * 0.55;
    // Walls are never a first choice for anyone except breachers -- they are
    // an obstacle you hit on the way, handled in the movement step.
    if (e.kind === 'wall' && unit.targeting !== 'walls') score += 400;
    if (pref(e)) { if (score < bestScore) { bestScore = score; best = e; } }
    else if (score < fallbackScore) { fallbackScore = score; fallback = e; }
  }
  // Preference is a preference. When nothing preferred is left, attack what is.
  return best ?? fallback;
}

function structureAcquire(battle, turret) {
  let best = null, bestD = Infinity;
  for (const e of battle.entities) {
    if (e.side !== 'attacker' || !e.alive) continue;
    if (e.flying && turret.targetsAir === false) continue;
    if (!e.flying && turret.targetsGround === false) continue;
    const d = Math.hypot(e.x - turret.x, e.y - turret.y);
    if (d <= turret.range && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

function applyDamage(battle, source, target, mult = 1) {
  if (!target.alive) return;
  let dmg = resolveDamage(source, target) * mult;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  target.lastHitTick = battle.tick;
  if (target.side === 'attacker') target.engagedTick = battle.tick;
  if (target.hp <= 0) kill(battle, target, source);
}

function kill(battle, e, source) {
  e.alive = false;
  e.deathTick = battle.tick;
  if (e.side === 'defender') {
    battle.destroyedValue += e.value;
    if (e.def.category === 'core') battle.citadelDown = true;
    clearTiles(battle, e);
    battle.events.push({ tick: battle.tick, type: 'destroy', x: e.x, y: e.y, id: e.id });
  } else {
    battle.events.push({ tick: battle.tick, type: 'unitDown', x: e.x, y: e.y });
    // Volatile bodies detonate where they fall. Friendly fire is off: the
    // alternative is a unit that punishes you for deploying it correctly.
    if (e.ability === 'volatile') {
      const r = 2.2;
      for (const t of battle.entities) {
        if (t.side !== 'defender' || !t.alive) continue;
        if (Math.hypot(t.x - e.x, t.y - e.y) > r) continue;
        applyDamage(battle, { ...e, damage: e.damage * 3.2 }, t);
      }
      battle.events.push({ tick: battle.tick, type: 'blast', x: e.x, y: e.y, r });
    }
  }
}

function attackFrom(battle, source, target) {
  source.lastAttackTick = battle.tick;
  if (source.side === 'attacker') {
    source.facing = target.x >= source.x ? 1 : -1;
    source.moving = false;
  }
  applyDamage(battle, source, target);
  if (source.splashRadius > 0.3) {
    const r = source.splashRadius;
    for (const t of battle.entities) {
      if (t === target || !t.alive || t.side === source.side) continue;
      if (Math.hypot(t.x - target.x, t.y - target.y) > r) continue;
      applyDamage(battle, source, t, 0.6); // splash hits neighbours for less
    }
  }
  battle.events.push({
    tick: battle.tick, type: 'shot',
    x: source.x, y: source.y, tx: target.x, ty: target.y,
    dtype: source.damageType, splash: source.splashRadius > 0.3 ? source.splashRadius : 0,
  });
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function step(battle) {
  if (battle.over) return battle;
  battle.tick++;
  const t = battle.tick;

  if (!battle._cost) buildBlockField(battle);
  if (battle._pathDirty && t - battle._lastRepath >= REPATH_INTERVAL) {
    battle._fields.clear();
    battle._pathDirty = false;
    battle._lastRepath = t;
  }
  battle._fieldsThisTick = 0;

  for (const e of battle.entities) {
    if (!e.alive) continue;
    e.cooldown -= DT;

    if (e.side === 'defender') {
      if (!e.damage) continue;
      if (e.cooldown > 0) continue;
      const target = structureAcquire(battle, e);
      if (target) { attackFrom(battle, e, target); e.cooldown = 1 / e.attackRate; }
      continue;
    }

    // --- attacker ---
    if (!e.target || !e.target.alive) { e.target = acquire(battle, e); e._field = null; }
    const target = e.target;
    if (!target) continue;

    const dx = target.x - e.x, dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    const reach = e.range + target.footprint * 0.5;

    if (dist <= reach) {
      e.engagedTick = t;
      e.moving = false;
      if (e.cooldown <= 0) { attackFrom(battle, e, target); e.cooldown = 1 / e.attackRate; }
      continue;
    }

    // Move. Fliers go straight; ground units follow the field.
    let mx, my;
    if (e.flying) {
      mx = dx / dist; my = dy / dist;
    } else {
      const field = flowField(battle, target) ?? e._field;
      if (field) e._field = field;
      const step = field ? descend(battle, field, e.x, e.y) : null;
      if (step) { mx = step.x; my = step.y; }
      else { mx = dx / dist; my = dy / dist; }

      // If the next tile is occupied by a wall, hit it. This is the "breaking
      // through" case the wall cost was priced for.
      const nx = Math.floor(e.x + mx * 0.9), ny = Math.floor(e.y + my * 0.9);
      const occId = inBounds(battle, nx, ny) ? battle._occupant[ny * battle.w + nx] : 0;
      if (occId) {
        const blocker = battle._byId.get(occId);
        if (blocker && blocker.alive && blocker.side === 'defender') {
          e.engagedTick = t;
          if (e.cooldown <= 0) { attackFrom(battle, e, blocker); e.cooldown = 1 / e.attackRate; }
          continue;
        }
      }
    }
    if (Math.abs(mx) > 0.15) e.facing = mx >= 0 ? 1 : -1;
    e.moving = true;
    e.x = clamp(e.x + mx * e.speed * DT, 0.2, battle.w - 0.2);
    e.y = clamp(e.y + my * e.speed * DT, 0.2, battle.h - 0.2);
  }

  // Abilities that run on a clock rather than on contact.
  if (t % TICK_HZ === 0) {
    for (const e of battle.entities) {
      if (!e.alive || e.side !== 'attacker') continue;
      if (e.ability === 'regenerate' && t - e.lastHitTick > TICK_HZ * 3) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.06);
      }
      if (e.ability === 'mend') {
        for (const o of battle.entities) {
          if (!o.alive || o.side !== 'attacker' || o === e) continue;
          if (Math.hypot(o.x - e.x, o.y - e.y) > 4) continue;
          o.hp = Math.min(o.maxHp, o.hp + e.damage * 0.30);
        }
      }
    }
  }

  checkOver(battle);
  return battle;
}

function inBounds(b, x, y) { return x >= 0 && x < b.w && y >= 0 && y < b.h; }

// Steepest descent on the distance field, with the eight-way neighbourhood.
function descend(battle, field, fx, fy) {
  const x = Math.floor(fx), y = Math.floor(fy);
  if (!inBounds(battle, x, y)) return null;
  let bestD = field[y * battle.w + x], bx = 0, by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (!inBounds(battle, nx, ny)) continue;
      const d = field[ny * battle.w + nx];
      if (d < bestD) { bestD = d; bx = ox; by = oy; }
    }
  }
  if (!bx && !by) return null;
  const len = Math.hypot(bx, by);
  return { x: bx / len, y: by / len };
}

function checkOver(battle) {
  const anyAlive = battle.entities.some((e) => e.side === 'attacker' && e.alive);
  const anyLeft = battle.remaining.some((r) => r >= 1);
  const anyDefender = battle.entities.some((e) => e.side === 'defender' && e.alive && e.kind !== 'wall');

  if (!anyDefender || (!anyAlive && !anyLeft) || battle.tick >= MAX_TICKS) {
    battle.over = true;
    battle.result = score(battle);
  }
}

// ---------------------------------------------------------------------------
// Scoring.
//
// Continuous, not three stars. Loot scales smoothly with how much of the
// holding you actually broke, so a 49% attack is worth 49% and not zero. The
// three-tier cliff exists to make near-misses feel bad, and making near-misses
// feel bad is not a design goal here.
// ---------------------------------------------------------------------------

export function score(battle) {
  const destruction = battle.totalValue > 0
    ? Math.min(1, battle.destroyedValue / battle.totalValue) : 0;
  const citadelBonus = battle.citadelDown ? 0.15 : 0;
  const share = Math.min(1, destruction + citadelBonus);
  const loot = {
    ore: Math.round(battle.bastion.loot.ore * share),
    flux: Math.round(battle.bastion.loot.flux * share),
  };
  return {
    destruction,
    percent: Math.round(destruction * 100),
    citadelDown: battle.citadelDown,
    ticks: battle.tick,
    seconds: Math.round(battle.tick / TICK_HZ),
    loot,
    grade: gradeFor(share),
  };
}

function gradeFor(share) {
  if (share >= 0.999) return 'Total';
  if (share >= 0.85) return 'Decisive';
  if (share >= 0.6) return 'Strong';
  if (share >= 0.35) return 'Partial';
  if (share > 0) return 'Probing';
  return 'Repulsed';
}

export function runToCompletion(battle, maxTicks = MAX_TICKS) {
  while (!battle.over && battle.tick < maxTicks) step(battle);
  if (!battle.result) battle.result = score(battle);
  return battle.result;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

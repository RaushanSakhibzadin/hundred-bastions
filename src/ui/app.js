// Screens, input, and the loop.

import * as Save from '../game/save.js';
import * as Base from '../game/base.js';
import * as Roster from '../game/roster.js';
import { STRUCTURES, STRUCTURE_BY_ID, structureCost, structureHp, structureUpkeep,
         defenseStats, structureProduction, structureStorage, structureSupply } from '../game/structures.js';
import { generateBastion, scout, LAYOUT_STYLES } from '../game/bastion.js';
import * as Sim from '../game/sim.js';
import { unitSprite } from './sprites.js';
import * as R from './render.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

export const DEPLOY_MARGIN = 5; // tiles from the edge you may land a squad in

export function boot() {
  const state = Save.load();
  const app = {
    state,
    screen: 'holding',
    canvas: $('#field'),
    ctx: $('#field').getContext('2d'),
    cam: null,
    build: { defId: null, selectedId: null, showCoverage: true },
    siege: { index: 1, battle: null, playing: false, speed: 1, selected: 0, acc: 0 },
    toast: null,
    tick: 0,
  };
  app.cam = R.makeCamera(null, state.base.grid);

  wireChrome(app);
  wireCanvas(app);
  resize(app);
  window.addEventListener('resize', () => resize(app));
  setScreen(app, 'holding');

  // Resource accrual ticks on a slow interval; the display interpolates.
  setInterval(() => {
    Base.tickResources(app.state.base);
    Save.save(app.state);
    if (app.screen !== 'siege' || !app.siege.battle) renderChrome(app);
  }, 5000);

  requestAnimationFrame(function frame() {
    loop(app);
    requestAnimationFrame(frame);
  });
  return app;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function wireChrome(app) {
  for (const btn of document.querySelectorAll('[data-screen]')) {
    btn.addEventListener('click', () => setScreen(app, btn.dataset.screen));
  }
  $('#coverage-toggle').addEventListener('change', (e) => {
    app.build.showCoverage = e.target.checked;
  });
}

function setScreen(app, screen) {
  app.screen = screen;
  for (const btn of document.querySelectorAll('[data-screen]')) {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  }
  for (const p of document.querySelectorAll('[data-panel]')) {
    p.hidden = p.dataset.panel !== screen;
  }
  const showField = screen === 'holding' || screen === 'siege';
  $('#stage').hidden = !showField;
  $('#coverage-row').hidden = screen !== 'holding';

  if (screen === 'holding') {
    app.siege.battle = null;
    app.cam = R.makeCamera(null, app.state.base.grid);
    R.fitCamera(app.cam, app.canvas);
    renderBuildPalette(app);
  }
  if (screen === 'warband') renderWarband(app);
  if (screen === 'siege' && !app.siege.battle) renderSiegePicker(app);
  if (screen === 'support') renderSupport(app);
  renderChrome(app);
}

function renderChrome(app) {
  const { base } = app.state;
  const eco = Base.economy(base);
  $('#res-ore').textContent = fmt(base.resources.ore);
  $('#res-ore-cap').textContent = fmt(eco.storage.ore);
  $('#res-flux').textContent = fmt(base.resources.flux);
  $('#res-flux-cap').textContent = fmt(eco.storage.flux);
  $('#res-net-ore').textContent = `${eco.net.ore >= 0 ? '+' : ''}${eco.net.ore}/min`;
  $('#res-net-ore').classList.toggle('bad', eco.net.ore < 0);
  $('#res-net-flux').textContent = `+${eco.net.flux}/min`;
  $('#res-supply').textContent = `${Roster.warbandSupply(currentWarband(app))} / ${eco.supply}`;
  $('#citadel-level').textContent = Base.citadelLevel(base);
}

function toast(app, msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(app._toastTimer);
  app._toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function resize(app) {
  const stage = $('#stage');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  app.canvas.width = Math.floor(stage.clientWidth * dpr);
  app.canvas.height = Math.floor(stage.clientHeight * dpr);
  app.canvas.style.width = stage.clientWidth + 'px';
  app.canvas.style.height = stage.clientHeight + 'px';
  if (app.cam) R.clampCamera(app.cam);
}

// ---------------------------------------------------------------------------
// Canvas input: pan, zoom, tap. One pointer handler for mouse and touch.
// ---------------------------------------------------------------------------

function wireCanvas(app) {
  const c = app.canvas;
  let dragging = false, moved = 0, last = null, pointers = new Map(), pinchDist = 0;
  let downAt = 0;
  const LONG_PRESS_MS = 420;

  const toCanvas = (ev) => {
    const r = c.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (c.width / r.width);
    const sy = (ev.clientY - r.top) * (c.height / r.height);
    return { sx, sy };
  };

  c.addEventListener('pointerdown', (ev) => {
    c.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, ev);
    if (pointers.size === 1) { dragging = true; moved = 0; last = toCanvas(ev); downAt = ev.timeStamp; }
  });

  c.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, ev);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchDist) { app.cam.zoom *= d / pinchDist; R.clampCamera(app.cam); }
      pinchDist = d;
      return;
    }
    if (!dragging) return;
    const p = toCanvas(ev);
    const s = R.TILE * app.cam.zoom;
    app.cam.x -= (p.sx - last.sx) / s;
    app.cam.y -= (p.sy - last.sy) / s;
    moved += Math.abs(p.sx - last.sx) + Math.abs(p.sy - last.sy);
    last = p;
    R.clampCamera(app.cam);
  });

  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!dragging) return;
    dragging = false;
    if (moved > 8) return; // it was a pan, not a tap
    const p = toCanvas(ev);
    const w = R.screenToWorld(app.cam, app.canvas, p.sx, p.sy);
    // Shift-tap splits the squad on desktop; a long press is the same gesture
    // on a touchscreen, where there is no shift key to hold.
    const single = ev.shiftKey || (ev.timeStamp - downAt) >= LONG_PRESS_MS;
    if (app.screen === 'holding') onHoldingTap(app, w);
    else if (app.screen === 'siege' && app.siege.battle) onBattleTap(app, w, single);
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', (ev) => { pointers.delete(ev.pointerId); dragging = false; });

  c.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    app.cam.zoom *= ev.deltaY < 0 ? 1.12 : 0.89;
    R.clampCamera(app.cam);
  }, { passive: false });

  // Keyboard: the whole battle bar is reachable without the mouse.
  window.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    if (app.screen === 'siege' && app.siege.battle) {
      if (ev.key === ' ') { ev.preventDefault(); togglePlay(app); }
      if (ev.key === 'r') doRecall(app);
      if (ev.key >= '1' && ev.key <= '9') {
        const i = +ev.key - 1;
        if (i < app.siege.battle.warband.length) { app.siege.selected = i; renderDeployBar(app); }
      }
    }
    if (ev.key === 'Escape') { app.build.defId = null; app.build.selectedId = null; renderBuildPalette(app); }
  });
}

// ---------------------------------------------------------------------------
// Holding screen
// ---------------------------------------------------------------------------

function onHoldingTap(app, w) {
  const { base } = app.state;
  const gx = Math.floor(w.x), gy = Math.floor(w.y);

  if (app.build.defId) {
    const def = STRUCTURE_BY_ID[app.build.defId];
    const x = gx - Math.floor(def.footprint / 2), y = gy - Math.floor(def.footprint / 2);
    const res = Base.place(base, app.build.defId, x, y);
    if (!res.ok) { toast(app, res.problems[0], true); return; }
    Save.save(app.state);
    renderChrome(app);
    renderBuildPalette(app);
    // Placement mode stays on, so laying a wall line is one tap per segment
    // rather than a trip back to the palette between every tile.
    return;
  }

  const occ = Base.occupancy(base);
  const id = (gx >= 0 && gy >= 0 && gx < base.grid.w && gy < base.grid.h) ? occ[gy * base.grid.w + gx] : -1;
  app.build.selectedId = id === -1 ? null : id;
  renderStructureInspector(app);
}

function renderBuildPalette(app) {
  const wrap = $('#build-list');
  wrap.innerHTML = '';
  const { base } = app.state;
  const clevel = Base.citadelLevel(base);

  for (const def of STRUCTURES) {
    if (def.category === 'core') continue;
    const count = Base.countOf(base, def.defId ?? def.id);
    const limit = Base.limitOf(base, def);
    const cost = structureCost(def, 1, count);
    const locked = limit <= 0;

    const card = el('button', 'build-card' + (app.build.defId === def.id ? ' picked' : '') + (locked ? ' locked' : ''));
    const head = el('div', 'bc-head');
    head.append(el('span', 'bc-name', def.name), el('span', 'bc-count', `${count}/${limit}`));
    const cost_ = el('div', 'bc-cost');
    if (cost.ore) cost_.append(el('span', 'ore', `${fmt(cost.ore)} ore`));
    if (cost.flux) cost_.append(el('span', 'flux', `${fmt(cost.flux)} flux`));
    const up = structureUpkeep(def, 1);
    if (up) cost_.append(el('span', 'upkeep', `${up} upkeep/min`));
    card.append(head, cost_, el('div', 'bc-blurb', def.blurb));

    if (locked) card.append(el('div', 'bc-lock', `Needs a higher Citadel (now ${clevel})`));

    card.addEventListener('click', () => {
      app.build.defId = app.build.defId === def.id ? null : def.id;
      app.build.selectedId = null;
      renderBuildPalette(app);
      renderStructureInspector(app);
    });
    wrap.append(card);
  }
  $('#build-hint').textContent = app.build.defId
    ? `Placing ${STRUCTURE_BY_ID[app.build.defId].name}. Tap the map. Esc to stop.`
    : 'Pick something to build, or tap a building to inspect it.';
}

function renderStructureInspector(app) {
  const box = $('#inspector');
  box.innerHTML = '';
  const id = app.build.selectedId;
  if (id == null) { box.hidden = true; return; }
  box.hidden = false;

  const s = app.state.base.structures.find((x) => x.id === id);
  if (!s) { box.hidden = true; return; }
  const def = STRUCTURE_BY_ID[s.defId];

  box.append(el('h3', null, `${def.name} — level ${s.level}`));
  const stats = el('dl', 'stat-grid');
  const row = (k, v) => { stats.append(el('dt', null, k), el('dd', null, v)); };
  row('Hit points', fmt(structureHp(def, s.level)));
  row('Armor', `${def.armor} (${Math.round(def.armor / (def.armor + 100) * 100)}% reduction)`);
  row('Armor class', def.armorClass);
  const up = structureUpkeep(def, s.level);
  if (up) row('Upkeep', `${up} ore/min`);
  const prod = structureProduction(def, s.level);
  if (prod) row('Produces', Object.entries(prod).map(([k, v]) => `${v} ${k}/min`).join(', '));
  const store = structureStorage(def, s.level);
  if (store) row('Stores', Object.entries(store).map(([k, v]) => `${fmt(v)} ${k}`).join(', '));
  const sup = structureSupply(def, s.level);
  if (sup) row('Supply', `+${sup}`);
  if (def.category === 'defense') {
    const ds = defenseStats(def, s.level);
    row('Damage', `${fmt(ds.damage)} ${ds.damageType}`);
    row('Rate', `${ds.attackRate}/s  (${fmt(ds.dps)} dps)`);
    row('Range', `${ds.range} tiles`);
    if (ds.splashRadius) row('Splash', `${ds.splashRadius} tiles`);
    row('Targets', ds.targetsAir && ds.targetsGround ? 'ground and air' : ds.targetsAir ? 'air only' : 'ground only');
    row('Trait cost', `x${ds.traitCost}`);
  }
  box.append(stats);

  const actions = el('div', 'row');
  const cost = Base.upgradeCost(app.state.base, id);
  if (cost) {
    const b = el('button', 'primary', `Upgrade to ${s.level + 1} — ${fmt(cost.ore)} ore, ${fmt(cost.flux)} flux`);
    b.addEventListener('click', () => {
      const r = Base.upgrade(app.state.base, id);
      if (!r.ok) return toast(app, r.problems[0], true);
      Save.save(app.state); renderChrome(app); renderStructureInspector(app); renderBuildPalette(app);
      toast(app, `${def.name} is now level ${s.level}.`);
    });
    actions.append(b);
  } else {
    actions.append(el('span', 'muted', 'Maximum level.'));
  }
  if (def.category !== 'core') {
    const d = el('button', 'danger', 'Demolish (full refund)');
    d.addEventListener('click', () => {
      Base.remove(app.state.base, id);
      app.build.selectedId = null;
      Save.save(app.state); renderChrome(app); renderStructureInspector(app); renderBuildPalette(app);
      toast(app, `${def.name} demolished. Resources returned in full.`);
    });
    actions.append(d);
  }
  box.append(actions);
}

// ---------------------------------------------------------------------------
// Warband screen
// ---------------------------------------------------------------------------

function currentWarband(app) {
  const { state } = app;
  return state.warband
    .map((w) => ({ unit: state.units[w.rosterIndex], count: w.count, rosterIndex: w.rosterIndex }))
    .filter((w) => w.unit);
}

function unitCard(app, unit, rosterIndex) {
  const card = el('div', 'unit-card');
  const art = el('div', 'uc-art');
  const img = unitSprite(unit, 4);
  const c = el('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  art.append(c);

  const body = el('div', 'uc-body');
  body.append(el('div', 'uc-name', unit.name));
  body.append(el('div', 'uc-sub', `${unit.archetypeLabel} · level ${unit.level} · ${unit.supply} supply${unit.count > 1 ? ` · ${unit.count} bodies` : ''}`));
  body.append(el('div', 'uc-role', unit.role));

  const chips = el('div', 'chips');
  chips.append(el('span', `chip dt-${unit.damageType}`, unit.damageType));
  chips.append(el('span', 'chip', `vs ${unit.armorClass}`));
  if (unit.flying) chips.append(el('span', 'chip good', 'flying'));
  if (unit.splashRadius > 0.3) chips.append(el('span', 'chip', `splash ${unit.splashRadius}`));
  if (unit.ability !== 'none') chips.append(el('span', 'chip good', unit.ability));
  if (unit.targeting !== 'any') chips.append(el('span', 'chip warn', `targets ${unit.targeting}`));
  body.append(chips);

  const stats = el('dl', 'stat-grid compact');
  const row = (k, v) => { stats.append(el('dt', null, k), el('dd', null, v)); };
  row('Hit points', fmt(unit.hp));
  row('Armor', `${unit.armor} (${unit.dr}%)`);
  row('Damage', `${fmt(unit.damage)} x ${unit.attackRate}/s`);
  row('DPS', fmt(unit.dps));
  row('Effective HP', fmt(unit.ehp));
  row('Range', `${unit.range} tiles`);
  row('Speed', `${unit.speed} tiles/s`);
  row('Trait cost', `x${unit.traitCost.toFixed(3)}`);
  row('Power index', `${unit.powerIndex} per supply`);
  body.append(stats);

  card.append(art, body);
  return card;
}

function renderWarband(app) {
  const { state } = app;
  const eco = Base.economy(state.base);

  const rosterBox = $('#roster-list');
  rosterBox.innerHTML = '';
  state.units.forEach((unit, i) => {
    const card = unitCard(app, unit, i);
    const actions = el('div', 'row');

    const inBand = state.warband.find((w) => w.rosterIndex === i);
    const add = el('button', 'primary', inBand ? `In warband x${inBand.count}` : 'Add to warband');
    add.addEventListener('click', () => {
      const entry = state.warband.find((w) => w.rosterIndex === i);
      if (entry) entry.count++;
      else state.warband.push({ rosterIndex: i, count: 1 });
      const used = Roster.warbandSupply(currentWarband(app));
      if (used > eco.supply) {
        const e2 = state.warband.find((w) => w.rosterIndex === i);
        e2.count--;
        if (e2.count <= 0) state.warband = state.warband.filter((w) => w.rosterIndex !== i);
        return toast(app, `No supply left. ${eco.supply} total; build a Muster Hall.`, true);
      }
      Save.save(state); renderWarband(app); renderChrome(app);
    });
    actions.append(add);

    if (inBand) {
      const rm = el('button', null, 'Remove one');
      rm.addEventListener('click', () => {
        const entry = state.warband.find((w) => w.rosterIndex === i);
        entry.count--;
        if (entry.count <= 0) state.warband = state.warband.filter((w) => w.rosterIndex !== i);
        Save.save(state); renderWarband(app); renderChrome(app);
      });
      actions.append(rm);
    }

    const cost = Roster.levelCost(unit.level);
    const lvl = el('button', null, `Level up — ${fmt(cost.ore)} ore, ${fmt(cost.flux)} flux`);
    lvl.addEventListener('click', () => {
      if (state.base.resources.ore < cost.ore || state.base.resources.flux < cost.flux) {
        return toast(app, 'Not enough to level this unit.', true);
      }
      state.base.resources.ore -= cost.ore;
      state.base.resources.flux -= cost.flux;
      state.roster[i].level++;
      Save.hydrate(state);
      Save.save(state); renderWarband(app); renderChrome(app);
      toast(app, `${unit.name} is now level ${state.roster[i].level}.`);
    });
    actions.append(lvl);

    if (state.units.length > 1) {
      const dis = el('button', 'danger', 'Dismiss');
      dis.addEventListener('click', () => {
        if (!confirm(`Dismiss ${unit.name}? This cannot be undone.`)) return;
        state.roster.splice(i, 1);
        state.warband = state.warband
          .filter((w) => w.rosterIndex !== i)
          .map((w) => ({ ...w, rosterIndex: w.rosterIndex > i ? w.rosterIndex - 1 : w.rosterIndex }));
        Save.hydrate(state); Save.save(state); renderWarband(app); renderChrome(app);
      });
      actions.append(dis);
    }

    card.querySelector('.uc-body').append(actions);
    rosterBox.append(card);
  });

  // Warband summary
  const sum = $('#warband-summary');
  sum.innerHTML = '';
  const band = currentWarband(app);
  const used = Roster.warbandSupply(band);
  sum.append(el('div', 'wb-line', `${used} / ${eco.supply} supply · combat value ${fmt(Roster.warbandPower(band))}`));
  for (const note of Roster.warbandShape(band)) sum.append(el('div', 'wb-note', note));
  for (const p of Roster.warbandProblems(band, eco.supply)) sum.append(el('div', 'wb-note bad', p));

  renderRecruit(app);
}

function renderRecruit(app) {
  const { state } = app;
  const box = $('#recruit-list');
  box.innerHTML = '';
  const candidates = Roster.rollCandidates(state.rollSeed, { forbid: state.roster.map((r) => r.seed) });

  $('#recruit-cost').textContent = `${fmt(Roster.RECRUIT_COST.flux)} flux to take one`;

  for (const unit of candidates) {
    const card = unitCard(app, unit, -1);
    const take = el('button', 'primary', 'Recruit');
    take.addEventListener('click', () => {
      if (state.base.resources.flux < Roster.RECRUIT_COST.flux) {
        return toast(app, 'Not enough flux to recruit.', true);
      }
      state.base.resources.flux -= Roster.RECRUIT_COST.flux;
      state.roster.push({ seed: unit.seed, level: 1 });
      state.rollSeed = (state.rollSeed * 1664525 + 1013904223) >>> 0;
      Save.hydrate(state); Save.save(state); renderWarband(app); renderChrome(app);
      toast(app, `${unit.name} joined the holding.`);
    });
    const row = el('div', 'row');
    row.append(take);
    card.querySelector('.uc-body').append(row);
    box.append(card);
  }
}

// ---------------------------------------------------------------------------
// Siege screen
// ---------------------------------------------------------------------------

function renderSiegePicker(app) {
  const { state } = app;
  $('#siege-setup').hidden = false;
  $('#battle-bar').hidden = true;
  $('#battle-info').hidden = true;
  $('#siege-result').hidden = true;

  const next = state.campaign.highest + 1;
  const list = $('#bastion-list');
  list.innerHTML = '';

  const offers = [];
  for (let i = Math.max(1, next - 2); i <= next + 3; i++) offers.push(i);

  for (const idx of offers) {
    const b = generateBastion(idx);
    const rep = scout(b);
    const cleared = state.campaign.cleared.includes(idx);
    const card = el('button', 'bastion-card' + (idx === app.siege.index ? ' picked' : ''));
    card.append(el('div', 'bn-title', `${b.name}`));
    card.append(el('div', 'bn-sub', `Bastion ${idx} · ${b.styleLabel} · threat ${b.threat}${cleared ? ' · taken' : ''}`));
    card.append(el('div', 'bn-loot', `up to ${fmt(b.loot.ore)} ore, ${fmt(b.loot.flux)} flux`));
    const notes = el('div', 'bn-notes');
    for (const n of rep.notes) notes.append(el('div', null, n));
    if (!rep.notes.length) notes.append(el('div', null, 'Nothing unusual.'));
    card.append(notes);
    card.addEventListener('click', () => { app.siege.index = idx; renderSiegePicker(app); });
    list.append(card);
  }

  const band = currentWarband(app);
  const eco = Base.economy(state.base);
  const problems = Roster.warbandProblems(band, eco.supply);
  $('#siege-warband').textContent = band.length
    ? band.map((w) => `${w.count}x ${w.unit.name}`).join(' · ')
    : 'No warband assembled.';

  const go = $('#start-siege');
  go.disabled = problems.length > 0;
  go.textContent = problems.length ? problems[0] : `March on bastion ${app.siege.index}`;
  go.onclick = () => startSiege(app);

  $('#custom-siege').onclick = () => {
    const v = prompt('Bastion number (any integer up to 2,147,483,647):', String(app.siege.index));
    if (v == null) return;
    const n = Math.max(1, Math.min(2147483647, Math.floor(Number(v)) || 1));
    app.siege.index = n;
    startSiege(app);
  };
}

function startSiege(app) {
  const band = currentWarband(app);
  const bastion = generateBastion(app.siege.index);
  const battle = Sim.createBattle(bastion, band);
  app.siege.battle = battle;
  app.siege.playing = true;
  app.siege.speed = 1;
  app.siege.selected = 0;
  app.siege.acc = 0;
  app.cam = R.makeCamera(null, bastion.grid);
  R.fitCamera(app.cam, app.canvas);
  $('#siege-setup').hidden = true;
  $('#siege-result').hidden = true;
  $('#battle-bar').hidden = false;
  $('#battle-info').hidden = false;
  $('#battle-title').textContent = `${bastion.name} — bastion ${app.siege.index}`;
  const rep = scout(bastion);
  const box = $('#battle-scout');
  box.innerHTML = '';
  box.append(el('h3', null, 'What you are walking into'));
  box.append(el('div', 'bn-sub', `${bastion.styleLabel} · threat ${bastion.threat} · ${bastion.structures.length} structures`));
  for (const n of rep.notes) box.append(el('div', 'wb-note', n));
  const counts = el('dl', 'stat-grid compact');
  for (const [name, n] of Object.entries(rep.counts).sort((a, b) => b[1] - a[1])) {
    counts.append(el('dt', null, name), el('dd', null, String(n)));
  }
  box.append(counts);
  renderDeployBar(app);
  wireBattleControls(app);
}

function wireBattleControls(app) {
  $('#btn-play').onclick = () => togglePlay(app);
  $('#btn-recall').onclick = () => doRecall(app);
  $('#btn-rally').onclick = () => {
    app.siege.rallyMode = !app.siege.rallyMode;
    $('#btn-rally').classList.toggle('on', app.siege.rallyMode);
    toast(app, app.siege.rallyMode ? 'Tap the map to set a rally point.' : 'Rally mode off.');
  };
  $('#btn-clear-rally').onclick = () => {
    Sim.clearRally(app.siege.battle);
    toast(app, 'Rally point cleared.');
  };
  $('#btn-abandon').onclick = () => {
    if (!confirm('Abandon the siege? You keep whatever you have already broken.')) return;
    endSiege(app);
  };
  for (const b of document.querySelectorAll('[data-speed]')) {
    b.onclick = () => {
      app.siege.speed = Number(b.dataset.speed);
      for (const o of document.querySelectorAll('[data-speed]')) {
        o.classList.toggle('on', o === b);
      }
    };
  }
}

function togglePlay(app) {
  app.siege.playing = !app.siege.playing;
  $('#btn-play').textContent = app.siege.playing ? 'Pause' : 'Resume';
  $('#btn-play').classList.toggle('on', !app.siege.playing);
}

function doRecall(app) {
  const n = Sim.recall(app.siege.battle);
  renderDeployBar(app);
  toast(app, n ? `Recalled ${n}. They are redeployable.` : 'Nothing is free to recall — everything is engaged.', !n);
}

function renderDeployBar(app) {
  const bar = $('#deploy-slots');
  bar.innerHTML = '';
  const b = app.siege.battle;
  if (!b) return;
  b.warband.forEach((slot, i) => {
    const left = Math.floor(b.remaining[i]);
    const btn = el('button', 'slot' + (i === app.siege.selected ? ' picked' : '') + (left <= 0 ? ' empty' : ''));
    const img = unitSprite(slot.unit, 2);
    const c = el('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    btn.append(c);
    btn.append(el('span', 'slot-count', `x${left}`));
    btn.append(el('span', 'slot-key', String(i + 1)));
    btn.title = `${slot.unit.name} — ${slot.unit.archetypeLabel}`;
    btn.onclick = () => { app.siege.selected = i; renderDeployBar(app); };
    bar.append(btn);
  });
  $('#deploy-hint').textContent = b.warband[app.siege.selected]
    ? `Tap inside the blue band to land the whole ${b.warband[app.siege.selected].unit.name} squad at once. Long-press, or shift-tap, to land just one.`
    : '';
}

function onBattleTap(app, w, splitSquad) {
  const b = app.siege.battle;
  if (!b || b.over) return;

  if (app.siege.rallyMode) {
    Sim.setRally(b, w.x, w.y);
    app.siege.rallyMode = false;
    $('#btn-rally').classList.remove('on');
    return;
  }

  const m = DEPLOY_MARGIN;
  const inBand = w.x < m || w.y < m || w.x > b.w - m || w.y > b.h - m;
  if (!inBand) { toast(app, 'Squads land in the outer band only.', true); return; }
  if (w.x < 0 || w.y < 0 || w.x > b.w || w.y > b.h) return;

  const i = app.siege.selected;
  // Shift-tap lands a single body instead of the squad, for when you want to
  // bait one defence without committing the whole group.
  const n = Sim.deploy(b, i, w.x, w.y, splitSquad ? 1 : null);
  if (!n) { toast(app, 'That squad is fully committed.', true); return; }
  renderDeployBar(app);
}

function endSiege(app) {
  const b = app.siege.battle;
  const result = b.result ?? Sim.score(b);
  const { state } = app;

  state.base.resources.ore = Math.min(
    Base.economy(state.base).storage.ore, state.base.resources.ore + result.loot.ore);
  state.base.resources.flux = Math.min(
    Base.economy(state.base).storage.flux, state.base.resources.flux + result.loot.flux);
  state.stats.sieges++;
  state.stats.lootOre += result.loot.ore;
  state.stats.lootFlux += result.loot.flux;

  if (result.citadelDown) {
    if (!state.campaign.cleared.includes(app.siege.index)) state.campaign.cleared.push(app.siege.index);
    state.campaign.highest = Math.max(state.campaign.highest, app.siege.index);
  }
  Save.save(state);

  const box = $('#siege-result');
  box.hidden = false;
  box.innerHTML = '';
  box.append(el('h3', null, `${result.grade} — ${result.percent}% of the holding broken`));
  box.append(el('p', null, result.citadelDown
    ? 'The citadel fell. The bastion is taken and the next one is open.'
    : 'The citadel held. You keep everything you broke on the way.'));
  box.append(el('p', 'loot-line', `Carried off ${fmt(result.loot.ore)} ore and ${fmt(result.loot.flux)} flux in ${result.seconds} seconds.`));

  const again = el('button', 'primary', 'Back to the map');
  again.onclick = () => { app.siege.battle = null; setScreen(app, 'siege'); };
  const home = el('button', null, 'Return to the holding');
  home.onclick = () => { app.siege.battle = null; setScreen(app, 'holding'); };
  const row = el('div', 'row');
  row.append(again, home);
  box.append(row);

  $('#battle-bar').hidden = true;
  $('#battle-info').hidden = true;
  app.siege.playing = false;
  renderChrome(app);
}

// ---------------------------------------------------------------------------
// Support screen
// ---------------------------------------------------------------------------

function renderSupport(app) {
  const s = app.state.stats;
  $('#support-stats').textContent =
    `${s.sieges} sieges fought · ${fmt(s.lootOre)} ore and ${fmt(s.lootFlux)} flux carried home.`;

  $('#export-save').onclick = () => {
    const text = Save.exportSave(app.state);
    navigator.clipboard?.writeText(text).then(
      () => toast(app, 'Save copied to the clipboard.'),
      () => { prompt('Copy your save:', text); });
  };
  $('#import-save').onclick = () => {
    const text = prompt('Paste a save:');
    if (!text) return;
    try {
      app.state = Save.importSave(text);
      Save.save(app.state);
      setScreen(app, 'holding');
      toast(app, 'Save loaded.');
    } catch (e) { toast(app, 'That is not a valid save.', true); }
  };
  $('#wipe-save').onclick = () => {
    if (!confirm('Erase this holding and start again? There is no undo.')) return;
    Save.wipe();
    app.state = Save.hydrate(Save.newGame());
    Save.save(app.state);
    setScreen(app, 'holding');
  };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function loop(app) {
  app.tick++;
  if ($('#stage').hidden) return;
  if (app.screen === 'siege' && app.siege.battle) {
    stepBattle(app);
    drawBattle(app);
  } else if (app.screen === 'holding') {
    drawHolding(app);
  }
}

function stepBattle(app) {
  const b = app.siege.battle;
  if (b.over) { if (!app._ending) { app._ending = true; setTimeout(() => { app._ending = false; endSiege(app); }, 700); } return; }
  if (!app.siege.playing) return;
  // Fixed-step accumulator: the simulation always advances in whole ticks, so
  // playback speed never changes the outcome. 4x is genuinely four times the
  // ticks, not a bigger dt.
  app.siege.acc += app.siege.speed;
  let budget = 0;
  while (app.siege.acc >= 1 && budget < 24) { Sim.step(b); app.siege.acc -= 1; budget++; }
  if (app.tick % 6 === 0) renderBattleStatus(app);
}

function renderBattleStatus(app) {
  const b = app.siege.battle;
  const pct = Math.round(100 * b.destroyedValue / Math.max(1, b.totalValue));
  $('#battle-progress').style.width = pct + '%';
  $('#battle-pct').textContent = pct + '%';
  $('#battle-time').textContent = `${Math.floor(b.tick / Sim.TICK_HZ)}s`;
  const alive = b.entities.filter((e) => e.side === 'attacker' && e.alive).length;
  $('#battle-alive').textContent = `${alive} standing`;
}

function drawHolding(app) {
  const { ctx, canvas, cam, state } = app;
  R.drawGround(ctx, cam, canvas);
  if (app.build.showCoverage) {
    const field = Base.coverageField(state.base);
    R.drawCoverage(ctx, cam, canvas, field, state.base.grid);
  }
  const sorted = [...state.base.structures].sort((a, b) => a.y - b.y);
  for (const s of sorted) {
    R.drawStructure(ctx, cam, canvas, s, { selected: s.id === app.build.selectedId });
    if (s.id === app.build.selectedId) R.drawRangeRing(ctx, cam, canvas, s, STRUCTURE_BY_ID[s.defId]);
  }
  if (app.build.defId) drawGhost(app);
}

function drawGhost(app) {
  const { ctx, canvas, cam, state } = app;
  const m = app._mouse;
  if (!m) return;
  const def = STRUCTURE_BY_ID[app.build.defId];
  const w = R.screenToWorld(cam, canvas, m.sx, m.sy);
  const x = Math.floor(w.x) - Math.floor(def.footprint / 2);
  const y = Math.floor(w.y) - Math.floor(def.footprint / 2);
  const ok = Base.canPlaceAt(state.base, def.id, x, y);
  R.drawStructure(ctx, cam, canvas, { defId: def.id, x, y, level: 1 }, { ghost: true, invalid: !ok });
  if (def.category === 'defense') R.drawRangeRing(ctx, cam, canvas, { x, y }, def);
}

function drawBattle(app) {
  const { ctx, canvas, cam } = app;
  const b = app.siege.battle;
  R.drawGround(ctx, cam, canvas);
  R.drawDeployZone(ctx, cam, canvas, { w: b.w, h: b.h }, DEPLOY_MARGIN);

  const structures = b.entities.filter((e) => e.side === 'defender' && e.alive).sort((a, c) => a.gy - c.gy);
  for (const e of structures) {
    R.drawStructure(ctx, cam, canvas, { defId: e.defId, x: e.gx, y: e.gy, level: e.level }, { hpFrac: e.hp / e.maxHp });
  }
  const units = b.entities.filter((e) => e.side === 'attacker' && e.alive).sort((a, c) => a.y - c.y);
  for (const e of units) R.drawUnit(ctx, cam, canvas, e, b.tick);

  R.drawEffects(ctx, cam, canvas, b);
  R.drawRally(ctx, cam, canvas, b.rally, b.tick);
}

// Track the pointer so the build ghost follows it on desktop.
window.addEventListener('pointermove', (ev) => {
  const c = document.getElementById('field');
  if (!c) return;
  const r = c.getBoundingClientRect();
  if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
  window.__app && (window.__app._mouse = {
    sx: (ev.clientX - r.left) * (c.width / r.width),
    sy: (ev.clientY - r.top) * (c.height / r.height),
  });
});

// Canvas rendering for both the holding and the siege.
//
// Top-down orthogonal, on a square grid. Deliberately not an isometric diamond:
// orthogonal means a tile is a tile, drag-to-place lands where your finger is,
// and nothing has to be un-skewed in your head before you can reason about
// coverage. It is also, not incidentally, nothing like the look of the games
// this one is obviously in conversation with.

import { STRUCTURE_BY_ID } from '../game/structures.js';
import { structureSprite, unitSprite } from './sprites.js';

export const TILE = 22;

export function makeCamera(view, grid) {
  return { x: grid.w / 2, y: grid.h / 2, zoom: 1, view, grid };
}

export function fitCamera(cam, canvas) {
  const z = Math.min(canvas.width / (cam.grid.w * TILE), canvas.height / (cam.grid.h * TILE));
  cam.zoom = clamp(z * 0.98, 0.35, 3);
  cam.x = cam.grid.w / 2;
  cam.y = cam.grid.h / 2;
}

export function worldToScreen(cam, canvas, wx, wy) {
  const s = TILE * cam.zoom;
  return { x: canvas.width / 2 + (wx - cam.x) * s, y: canvas.height / 2 + (wy - cam.y) * s };
}

export function screenToWorld(cam, canvas, sx, sy) {
  const s = TILE * cam.zoom;
  return { x: cam.x + (sx - canvas.width / 2) / s, y: cam.y + (sy - canvas.height / 2) / s };
}

export function clampCamera(cam) {
  cam.x = clamp(cam.x, -4, cam.grid.w + 4);
  cam.y = clamp(cam.y, -4, cam.grid.h + 4);
  cam.zoom = clamp(cam.zoom, 0.35, 3);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- ground -----------------------------------------------------------------

export function drawGround(ctx, cam, canvas) {
  const s = TILE * cam.zoom;
  const tl = screenToWorld(cam, canvas, 0, 0);
  const br = screenToWorld(cam, canvas, canvas.width, canvas.height);

  ctx.fillStyle = '#10161d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const x0 = Math.max(0, Math.floor(tl.x)), x1 = Math.min(cam.grid.w, Math.ceil(br.x));
  const y0 = Math.max(0, Math.floor(tl.y)), y1 = Math.min(cam.grid.h, Math.ceil(br.y));

  const origin = worldToScreen(cam, canvas, x0, y0);
  ctx.fillStyle = '#18222c';
  ctx.fillRect(origin.x, origin.y, (x1 - x0) * s, (y1 - y0) * s);

  // A faint checker rather than a grid of lines: it reads as terrain at a
  // distance and still gives you an exact tile to aim at up close.
  ctx.fillStyle = 'rgba(255,255,255,0.022)';
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (((x + y) & 1) === 0) continue;
      const p = worldToScreen(cam, canvas, x, y);
      ctx.fillRect(p.x, p.y, s, s);
    }
  }

  if (cam.zoom > 0.75) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const p = worldToScreen(cam, canvas, x, y0);
      ctx.moveTo(Math.round(p.x) + 0.5, p.y);
      ctx.lineTo(Math.round(p.x) + 0.5, worldToScreen(cam, canvas, x, y1).y);
    }
    for (let y = y0; y <= y1; y++) {
      const p = worldToScreen(cam, canvas, x0, y);
      ctx.moveTo(p.x, Math.round(p.y) + 0.5);
      ctx.lineTo(worldToScreen(cam, canvas, x1, y).x, Math.round(p.y) + 0.5);
    }
    ctx.stroke();
  }
}

// --- coverage overlay -------------------------------------------------------
//
// Live defensive coverage while you build. The single most useful overlay in a
// base builder and almost nobody shows it -- you are normally expected to hold
// every tower's radius in your head at once.

export function drawCoverage(ctx, cam, canvas, field, grid) {
  const s = TILE * cam.zoom;
  let max = 0;
  for (const v of field) if (v > max) max = v;
  if (!max) return;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const v = field[y * grid.w + x];
      if (!v) continue;
      const p = worldToScreen(cam, canvas, x, y);
      if (p.x < -s || p.y < -s || p.x > canvas.width || p.y > canvas.height) continue;
      // Colour by how many defences overlap, not by a normalised fraction --
      // with one tower on the map, normalising made every covered tile read as
      // maximum danger, which is exactly backwards. One defence is green;
      // stacked coverage warms toward amber and gets more opaque.
      const t = Math.min(1, (v - 1) / 3);
      ctx.fillStyle = `hsl(${148 - t * 100} 70% 50% / ${0.09 + t * 0.13})`;
      ctx.fillRect(p.x, p.y, s, s);
    }
  }
}

export function drawUncovered(ctx, cam, canvas, field, grid) {
  const s = TILE * cam.zoom;
  ctx.fillStyle = 'rgba(220,60,60,0.13)';
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (field[y * grid.w + x]) continue;
      const p = worldToScreen(cam, canvas, x, y);
      if (p.x < -s || p.y < -s || p.x > canvas.width || p.y > canvas.height) continue;
      ctx.fillRect(p.x, p.y, s, s);
    }
  }
}

// --- structures -------------------------------------------------------------

export function drawStructure(ctx, cam, canvas, s, { hpFrac = 1, selected = false, ghost = false, invalid = false } = {}) {
  const def = STRUCTURE_BY_ID[s.defId] ?? s.def;
  const px = TILE * cam.zoom;
  const p = worldToScreen(cam, canvas, s.x ?? s.gx, s.y ?? s.gy);
  const w = def.footprint * px;
  if (p.x + w < 0 || p.y + w < 0 || p.x > canvas.width || p.y > canvas.height) return;

  ctx.globalAlpha = ghost ? 0.55 : 1;

  if (ghost) {
    ctx.fillStyle = invalid ? 'rgba(220,70,70,0.30)' : 'rgba(120,220,160,0.28)';
    ctx.fillRect(p.x, p.y, w, w);
  }

  // How tall the drawn body is. Walls lie flat on their tile; everything else
  // stands up above it. The HP bar below needs this either way.
  const h = def.isWall ? w : w * 1.35;

  if (def.isWall) {
    // Walls get drawn flat, as a block on the ground. Running the tower sprite
    // through a 1x1 footprint turned a rampart line into a row of dashes.
    const inset = w * 0.06;
    ctx.fillStyle = '#4a4438';
    ctx.fillRect(p.x + inset, p.y + inset, w - inset * 2, w - inset * 2);
    ctx.fillStyle = '#6a6252';
    ctx.fillRect(p.x + inset, p.y + inset, w - inset * 2, (w - inset * 2) * 0.42);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + inset, p.y + inset, w - inset * 2, w - inset * 2);
  } else {
    // Buildings are drawn taller than their footprint so they read as objects
    // standing on the tile rather than as a texture painted onto it.
    const sprite = structureSprite(def, s.level ?? 1, 3);
    ctx.drawImage(sprite, p.x, p.y + w - h, w, h);
  }

  if (hpFrac < 1) {
    const bw = w * 0.9, bx = p.x + w * 0.05, by = p.y + w - h - 5;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = hpFrac > 0.5 ? '#63d67a' : hpFrac > 0.22 ? '#e0c04a' : '#e05a4a';
    ctx.fillRect(bx, by, bw * hpFrac, 3);
  }

  if (selected) {
    ctx.strokeStyle = '#8fd7ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 1, p.y + 1, w - 2, w - 2);
  }
  ctx.globalAlpha = 1;
}

export function drawRangeRing(ctx, cam, canvas, s, def) {
  if (def.category !== 'defense') return;
  const px = TILE * cam.zoom;
  const c = worldToScreen(cam, canvas, (s.x ?? s.gx) + def.footprint / 2, (s.y ?? s.gy) + def.footprint / 2);
  ctx.strokeStyle = 'rgba(143,215,255,0.55)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, def.traits.range * px, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// --- units ------------------------------------------------------------------

export function drawUnit(ctx, cam, canvas, e, tick) {
  const px = TILE * cam.zoom;
  const p = worldToScreen(cam, canvas, e.x, e.y);
  if (p.x < -40 || p.y < -40 || p.x > canvas.width + 40 || p.y > canvas.height + 40) return;

  // The sprite grid carries a lot of transparent margin, so the drawn box has
  // to be well over one tile for the body inside it to read at all. These
  // multipliers are the drawn box, not the creature.
  const size = px * (e.unit.supply >= 8 ? 4.2 : e.unit.supply >= 4 ? 3.2 : 2.5);
  // A two-frame bob, computed rather than stored. Sprites have no animation
  // frames; the motion is entirely in where we draw them.
  const bob = Math.sin((tick + e.id * 7) * 0.22) * px * 0.06;
  const lift = e.flying ? px * 0.55 : 0;

  if (e.flying) {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + px * 0.15, size * 0.22, size * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const sprite = unitSprite(e.unit, 3);
  ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2 - lift + bob, size, size);

  const frac = e.hp / e.maxHp;
  if (frac < 1) {
    const bw = size * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(p.x - bw / 2, p.y - size / 2 - lift + bob - 4, bw, 2.5);
    ctx.fillStyle = frac > 0.5 ? '#7fe08a' : frac > 0.25 ? '#e0c04a' : '#e05a4a';
    ctx.fillRect(p.x - bw / 2, p.y - size / 2 - lift + bob - 4, bw * frac, 2.5);
  }
}

// --- combat effects ---------------------------------------------------------

const DTYPE_COLOR = { kinetic: '#cfe4ff', arc: '#7ff0e0', pyre: '#ffb160' };

export function drawEffects(ctx, cam, canvas, battle) {
  const px = TILE * cam.zoom;
  const now = battle.tick;
  // Only the last handful of ticks of events are drawn; the log itself is kept
  // whole because the replay scrubber reads it.
  for (let i = battle.events.length - 1; i >= 0; i--) {
    const ev = battle.events[i];
    const age = now - ev.tick;
    if (age > 6) break;
    const a = 1 - age / 6;
    if (ev.type === 'shot') {
      const from = worldToScreen(cam, canvas, ev.x, ev.y);
      const to = worldToScreen(cam, canvas, ev.tx, ev.ty);
      ctx.strokeStyle = DTYPE_COLOR[ev.dtype] ?? '#fff';
      ctx.globalAlpha = a * 0.75;
      ctx.lineWidth = ev.splash ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (ev.splash) {
        ctx.beginPath();
        ctx.arc(to.x, to.y, ev.splash * px * (1 - a * 0.4), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (ev.type === 'blast') {
      const c = worldToScreen(cam, canvas, ev.x, ev.y);
      ctx.strokeStyle = '#ffce6b';
      ctx.globalAlpha = a;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, ev.r * px * (1.2 - a * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (ev.type === 'destroy') {
      const c = worldToScreen(cam, canvas, ev.x, ev.y);
      ctx.fillStyle = `rgba(255,190,120,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, px * (0.6 + (1 - a) * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawRally(ctx, cam, canvas, rally, tick) {
  if (!rally) return;
  const p = worldToScreen(cam, canvas, rally.x, rally.y);
  const r = 10 + Math.sin(tick * 0.14) * 3;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x + 14, p.y);
  ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x, p.y + 14); ctx.stroke();
}

// The deployment band: where you are allowed to land a squad. Drawn explicitly,
// because "why can't I deploy here" should never be a mystery.
export function drawDeployZone(ctx, cam, canvas, grid, margin) {
  const tl = worldToScreen(cam, canvas, 0, 0);
  const inner = worldToScreen(cam, canvas, margin, margin);
  const outer = worldToScreen(cam, canvas, grid.w, grid.h);
  const innerBR = worldToScreen(cam, canvas, grid.w - margin, grid.h - margin);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, outer.x - tl.x, outer.y - tl.y);
  ctx.rect(inner.x, inner.y, innerBR.x - inner.x, innerBR.y - inner.y);
  ctx.fill('evenodd');
  ctx.fillStyle = 'rgba(110,200,255,0.10)';
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(110,200,255,0.35)';
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(inner.x, inner.y, innerBR.x - inner.x, innerBR.y - inner.y);
  ctx.setLineDash([]);
  ctx.restore();
}

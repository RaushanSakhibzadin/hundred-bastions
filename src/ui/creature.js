// Drawing creatures.
//
// The morphology is plain data, so it can be painted two ways from one source:
// to a canvas for the battlefield, where there may be forty of them at 60fps,
// and to an SVG string for the roster, where one of them wants to be crisp at
// any size and exportable.
//
// Paths are built once per genome and cached. Per frame we only push
// transforms, which is what keeps a screen full of animated vector creatures
// affordable.

import { buildCreature, poseCreature } from '../core/morph.js';

const creatureCache = new Map();
const pathCache = new Map();

export function creatureFor(unit) {
  const key = unit.genome.id + ':' + unit.level;
  let c = creatureCache.get(key);
  if (!c) { c = buildCreature(unit); creatureCache.set(key, c); }
  return c;
}

export function clearCreatureCache() {
  creatureCache.clear();
  pathCache.clear();
}

function pathFor(shape) {
  let p = pathCache.get(shape);
  if (p) return p;
  p = new Path2D();
  if (shape.kind === 'poly') {
    shape.pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
  } else {
    p.ellipse(shape.c[0], shape.c[1], shape.r[0], shape.r[1], shape.rot ?? 0, 0, Math.PI * 2);
  }
  pathCache.set(shape, p);
  return p;
}

// `scale` is pixels per morphology unit. A creature is roughly 100 units tall.
export function drawCreature(ctx, unit, x, y, scale, t, state = {}) {
  const c = creatureFor(unit);
  const pose = poseCreature(c, t, state);
  const pal = c.palette;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.rotate(pose.lean);
  ctx.translate(0, pose.bob);

  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = pal.outline;

  for (const tr of pose.transforms) {
    const { part } = tr;
    ctx.save();
    ctx.translate(part.pivot[0], part.pivot[1]);
    ctx.rotate(tr.rot);
    ctx.translate(tr.dx, tr.dy);
    if (tr.scaleY !== 1) ctx.scale(1, tr.scaleY);

    for (const shape of part.shapes) {
      const p = pathFor(shape);
      if (shape.rot) { ctx.save(); ctx.rotate(shape.rot); }
      ctx.fillStyle = pal[shape.fill] ?? pal.body;
      ctx.fill(p);
      if (shape.stroke) ctx.stroke(p);
      if (shape.rot) ctx.restore();
    }
    ctx.restore();
  }

  // A hit flash, drawn as a translucent wash over the whole creature rather
  // than per part, so it reads as one body taking a hit.
  if (state.hurt > 0) {
    ctx.globalAlpha = Math.min(0.55, state.hurt);
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of pose.transforms) {
      const { part } = tr;
      ctx.save();
      ctx.translate(part.pivot[0], part.pivot[1]);
      ctx.rotate(tr.rot);
      ctx.fillStyle = '#ff9a7a';
      for (const shape of part.shapes) ctx.fill(pathFor(shape));
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// --- animated portraits -----------------------------------------------------
//
// Roster and recruit cards show the creature moving, not a still. Animation
// genes are under selection here too, and you cannot choose a gait you have
// never seen. One shared ticker drives every visible portrait, because a
// recruitment screen can hold a dozen and a dozen requestAnimationFrame loops
// is a dozen too many.

const portraits = new Set();
let portraitRaf = 0;

function portraitLoop(now) {
  const t = now / 1000;
  for (const p of portraits) {
    if (!p.canvas.isConnected) { portraits.delete(p); continue; }
    const ctx = p.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    drawCreature(ctx, p.unit, p.canvas.width / 2, p.canvas.height * 0.94, p.scale, t + p.offset, { moving: p.moving });
  }
  portraitRaf = portraits.size ? requestAnimationFrame(portraitLoop) : 0;
}

export function attachPortrait(canvas, unit, { moving = true, pad = 1.14 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 92, cssH = canvas.clientHeight || 92;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));

  const c = creatureFor(unit);
  // Fit the creature to its box whatever its genes made it, so a six-legged
  // sprawler and a narrow biped both fill the card.
  const scale = Math.min(canvas.width / (c.bounds.w * pad), canvas.height / (c.bounds.h * pad));

  const entry = { canvas, ctx, unit, scale, moving, offset: Math.random() * 6 };
  portraits.add(entry);
  if (!portraitRaf) portraitRaf = requestAnimationFrame(portraitLoop);
  return () => portraits.delete(entry);
}

export function clearPortraits() {
  portraits.clear();
}

// --- SVG --------------------------------------------------------------------
//
// The same description as real SVG, for export. Vector in, vector out: a
// creature can leave the game as a file that is still a creature.

export function creatureToSVG(unit, { width = 220, height = 240, t = 0 } = {}) {
  const c = creatureFor(unit);
  const pose = poseCreature(c, t, { moving: false });
  const pal = c.palette;
  const s = Math.min(width / (c.bounds.w * 1.15), height / (c.bounds.h * 1.12));

  const body = pose.transforms.map((tr) => {
    const { part } = tr;
    const deg = (tr.rot * 180) / Math.PI;
    const inner = part.shapes.map((shape) => {
      const fill = pal[shape.fill] ?? pal.body;
      const stroke = shape.stroke ? ` stroke="${pal.outline}" stroke-width="1.6" stroke-linejoin="round"` : '';
      const rot = shape.rot ? ` transform="rotate(${(shape.rot * 180 / Math.PI).toFixed(2)})"` : '';
      if (shape.kind === 'poly') {
        const pts = shape.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
        return `<polygon points="${pts}" fill="${fill}"${stroke}${rot}/>`;
      }
      return `<ellipse cx="${shape.c[0].toFixed(2)}" cy="${shape.c[1].toFixed(2)}" rx="${shape.r[0].toFixed(2)}" ry="${shape.r[1].toFixed(2)}" fill="${fill}"${stroke}${rot}/>`;
    }).join('');
    return `<g transform="translate(${part.pivot[0].toFixed(2)},${part.pivot[1].toFixed(2)}) rotate(${deg.toFixed(2)})">${inner}</g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<g transform="translate(${(width / 2).toFixed(2)},${(height * 0.93).toFixed(2)}) scale(${s.toFixed(4)})">${body}</g></svg>`;
}

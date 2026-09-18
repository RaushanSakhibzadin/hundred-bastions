// Vector morphology.
//
// A genome becomes a creature: a list of parts, each a set of polygons in a
// local coordinate space, each with a pivot and an animation spec. Nothing
// here touches a canvas or an SVG element, so the whole creature can be built
// and tested in Node, and the same description drives both renderers.
//
// Vector rather than pixels, because the request was evolution and pixels do
// not interpolate. Blending two cellular automata gives you noise; blending two
// polygon widths gives you a creature halfway between its parents. Every gene
// here maps to a continuous geometric quantity for exactly that reason.
//
// Coordinate space: x is centred on the body, y increases downward, and y = 0
// is the ground the creature stands on. So the body occupies negative y.

import { clamp01 } from './genome.js';

// --- gene -> quantity helpers ----------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const pick = (g, n) => Math.min(n - 1, Math.floor(g * n));

export const PATTERNS = ['none', 'stripes', 'spots', 'chevron', 'rings'];
export const WEAPON_MELEE = ['blade', 'maul', 'claw', 'pick'];
export const WEAPON_RANGED = ['barrel', 'lance', 'coil', 'sling'];

// --- shape primitives -------------------------------------------------------

// A superellipse outline, optionally tapered so the top is a different width
// from the bottom. This one function produces everything from a fat boxy
// Colossus torso to a narrow pinched Skirmisher one.
function blob(w, h, exp, taper, steps = 26) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
    const sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / exp);
    // sy < 0 is the upper half; taper it.
    const t = sy < 0 ? lerp(1, taper, -sy) : 1;
    pts.push([sx * w * t, sy * h]);
  }
  return pts;
}

// A limb as a tapered quadrilateral with a bend at the joint, returned as one
// polygon so it can be filled in a single path.
function limb(len, w0, w1, bendDeg, dirX = 0) {
  const bend = (bendDeg * Math.PI) / 180;
  const midY = len * 0.5;
  const midX = dirX * len * 0.18;
  const kneeX = midX + Math.sin(bend) * len * 0.22;
  const footX = midX + dirX * len * 0.26;
  const hw0 = w0 / 2, hw1 = w1 / 2, hwm = (w0 + w1) / 4;
  return [
    [-hw0, 0], [hw0, 0],
    [kneeX + hwm, midY], [footX + hw1, len],
    [footX - hw1, len], [kneeX - hwm, midY],
  ];
}

function triangle(len, w) {
  return [[-w / 2, 0], [w / 2, 0], [0, -len]];
}

// A wing as a swept membrane with a scalloped or smooth trailing edge.
function wing(span, depth, shapeG, sign) {
  const scallops = 2 + pick(shapeG, 3);
  const pts = [[0, 0], [sign * span * 0.30, -depth * 0.55]];
  pts.push([sign * span, -depth * 0.22]);
  for (let i = scallops; i >= 1; i--) {
    const t = i / (scallops + 1);
    const notch = lerp(0.14, 0.34, shapeG);
    pts.push([sign * span * t, depth * (0.30 - notch * Math.sin(t * Math.PI))]);
  }
  pts.push([0, depth * 0.24]);
  return pts;
}

function tail(len, curl, segments = 5) {
  const top = [], bottom = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = -len * t;
    const y = curl * len * 0.55 * t * t - len * 0.1 * t;
    const w = lerp(4.5, 0.9, t);
    top.push([x, y - w / 2]);
    bottom.unshift([x, y + w / 2]);
  }
  return [...top, ...bottom];
}

// --- the builder ------------------------------------------------------------

export function buildCreature(unit) {
  const g = unit.genome.genes;
  const parts = [];

  const torsoW = lerp(13, 33, g.torsoW);
  const torsoH = lerp(17, 38, g.torsoH);
  const torsoExp = lerp(1.7, 4.0, g.torsoRound);
  const taper = lerp(0.52, 1.28, g.torsoTaper);

  const legCount = [2, 2, 3, 4, 4, 6][pick(g.legCount, 6)];
  const legLen = lerp(7, 28, g.legLength);
  const legW = lerp(2.6, 7.0, g.legWidth);
  const splay = lerp(0.1, 1.0, g.legSplay);

  const neck = lerp(0, 10, g.neck);
  const headR = lerp(6.5, 15, g.headSize);
  const headExp = lerp(1.6, 4.0, g.headShape);

  // Ground the creature: feet at y = 0, torso stacked above.
  const hipY = -legLen;
  const torsoCY = hipY - torsoH * 0.75;
  const headCY = torsoCY - torsoH * 0.72 - neck - headR * 0.6;

  // --- wings, behind everything --------------------------------------------
  if (unit.flying) {
    const span = lerp(16, 42, g.wingSpan);
    const depth = lerp(12, 28, g.wingSpan);
    for (const sign of [-1, 1]) {
      parts.push({
        name: sign < 0 ? 'wingL' : 'wingR',
        z: -30,
        pivot: [sign * torsoW * 0.5, torsoCY - torsoH * 0.25],
        shapes: [{ kind: 'poly', pts: wing(span, depth, g.wingShape, sign), fill: 'wing', stroke: true }],
        anim: { swing: lerp(18, 46, g.gaitSwing), phase: 0, freq: 2.4, always: true },
      });
    }
  }

  // --- tail ----------------------------------------------------------------
  const tailLen = lerp(0, 30, g.tailLength);
  if (tailLen > 6) {
    parts.push({
      name: 'tail',
      z: -20,
      pivot: [-torsoW * 0.55, torsoCY + torsoH * 0.35],
      shapes: [{ kind: 'poly', pts: tail(tailLen, lerp(-1, 1, g.tailCurl)), fill: 'shade', stroke: true }],
      anim: { swing: lerp(2, 28, g.tailWag), phase: 1.2, freq: 0.75, always: true },
    });
  }

  // --- legs ----------------------------------------------------------------
  // Back legs render behind the torso, front legs in front, which is what
  // gives a flat vector creature any sense of depth at all.
  for (let i = 0; i < legCount; i++) {
    const t = legCount === 1 ? 0.5 : i / (legCount - 1);
    const x = lerp(-torsoW * splay, torsoW * splay, t);
    const back = i % 2 === 0;
    parts.push({
      name: `leg${i}`,
      z: back ? -10 : 10,
      pivot: [x, hipY],
      shapes: [{
        kind: 'poly',
        pts: limb(legLen, legW, legW * 0.72, lerp(-14, 14, g.legSplay), Math.sign(x) || 1),
        fill: back ? 'shade' : 'body',
        stroke: true,
      }],
      // The phase spread across legs is a gene. At 0 every leg moves together
      // and the thing hops; at 1 they are evenly out of phase and it walks.
      anim: {
        swing: lerp(6, 34, g.gaitSwing),
        phase: (i / Math.max(1, legCount)) * Math.PI * 2 * lerp(0.15, 1, g.limbSpread),
        freq: 1,
      },
    });
  }

  // --- torso ---------------------------------------------------------------
  const torsoPts = blob(torsoW, torsoH, torsoExp, taper);
  const torsoShapes = [{ kind: 'poly', pts: torsoPts, fill: 'body', stroke: true }];

  // Pattern, inset so it stays inside the silhouette without needing a clip.
  const pattern = PATTERNS[pick(g.pattern, PATTERNS.length)];
  const density = 1 + Math.round(lerp(1, 5, g.patternDensity));
  if (pattern === 'stripes') {
    for (let i = 0; i < density; i++) {
      const y = lerp(-torsoH * 0.6, torsoH * 0.6, (i + 0.5) / density);
      const w = torsoW * 0.72 * Math.sqrt(Math.max(0, 1 - (y / (torsoH * 0.92)) ** 2));
      torsoShapes.push({ kind: 'poly', pts: [[-w, y - 1.6], [w, y - 1.6], [w, y + 1.6], [-w, y + 1.6]], fill: 'shade' });
    }
  } else if (pattern === 'spots') {
    for (let i = 0; i < density * 2; i++) {
      const a = i * 2.39996;
      const r = torsoW * 0.45 * Math.sqrt((i + 0.5) / (density * 2));
      torsoShapes.push({
        kind: 'ellipse',
        c: [Math.cos(a) * r, Math.sin(a) * r * (torsoH / torsoW)],
        r: [2.2, 2.2], fill: 'shade',
      });
    }
  } else if (pattern === 'chevron') {
    for (let i = 0; i < density; i++) {
      const y = lerp(-torsoH * 0.5, torsoH * 0.5, (i + 0.5) / density);
      const w = torsoW * 0.55;
      torsoShapes.push({ kind: 'poly', pts: [[-w, y + 4], [0, y - 3], [w, y + 4], [0, y + 1]], fill: 'shade' });
    }
  } else if (pattern === 'rings') {
    for (let i = 1; i <= Math.min(3, density); i++) {
      const s = i / (Math.min(3, density) + 1);
      torsoShapes.push({ kind: 'poly', pts: blob(torsoW * s, torsoH * s, torsoExp, taper, 18), fill: 'shade' });
    }
  }

  // Armour plates. The count has a floor set by actual armor value, so a
  // heavily armoured creature always *looks* armoured however its plate gene
  // happens to have drifted -- evolution owns the aesthetics, the game keeps
  // the silhouette honest.
  const plateFloor = Math.floor(clamp01(unit.armor / 260) * 3);
  const plateCount = Math.max(plateFloor, Math.round(lerp(0, 4, g.plateCount)));
  const plateW = lerp(0.5, 1.0, g.plateSize);
  for (let i = 0; i < plateCount; i++) {
    const y = lerp(-torsoH * 0.55, torsoH * 0.45, plateCount === 1 ? 0.3 : i / (plateCount - 1));
    const w = torsoW * plateW * Math.sqrt(Math.max(0.05, 1 - (y / (torsoH * 1.05)) ** 2));
    torsoShapes.push({
      kind: 'poly',
      pts: [[-w, y - 2.4], [w, y - 2.4], [w * 0.92, y + 2.4], [-w * 0.92, y + 2.4]],
      fill: 'light', stroke: true,
    });
  }

  parts.push({
    name: 'torso', z: 0,
    pivot: [0, torsoCY],
    shapes: torsoShapes,
    anim: { breathe: lerp(0.02, 0.09, g.breathe), freq: lerp(0.5, 1.6, g.breathe) },
  });

  // --- spikes along the back ------------------------------------------------
  const spikeCount = Math.round(lerp(0, 6, g.spikeCount));
  const spikeLen = lerp(3, 15, g.spikeLength);
  for (let i = 0; i < spikeCount; i++) {
    const t = (i + 0.5) / spikeCount;
    const y = lerp(-torsoH * 0.7, torsoH * 0.2, t);
    const x = -torsoW * 0.72 * lerp(0.6, 1.0, Math.sin(t * Math.PI));
    parts.push({
      name: `spike${i}`, z: -5,
      pivot: [x, torsoCY + y],
      shapes: [{ kind: 'poly', pts: triangle(spikeLen, 4.5), fill: 'accent', stroke: true, rot: -0.6 }],
      anim: { swing: 3, phase: i * 0.5, freq: 0.8, always: true },
    });
  }

  // --- head -----------------------------------------------------------------
  const headShapes = [{ kind: 'poly', pts: blob(headR, headR * lerp(0.75, 1.2, g.headShape), headExp, lerp(0.7, 1.15, g.jaw)), fill: 'body', stroke: true }];
  const eyeCount = 1 + pick(g.eyeCount, 4);
  const eyeR = lerp(1.3, 3.8, g.eyeSize);
  for (let i = 0; i < eyeCount; i++) {
    const t = eyeCount === 1 ? 0.5 : i / (eyeCount - 1);
    const ex = lerp(-headR * 0.45, headR * 0.45, t);
    const ey = -headR * 0.1 + (i % 2) * eyeR * 0.7;
    headShapes.push({ kind: 'ellipse', c: [ex, ey], r: [eyeR, eyeR * 1.15], fill: 'glow' });
  }
  // A jaw, if the gene calls for one.
  if (g.jaw > 0.55) {
    const jw = headR * lerp(0.3, 0.8, g.jaw);
    headShapes.push({ kind: 'poly', pts: [[-jw, headR * 0.5], [jw, headR * 0.5], [jw * 0.6, headR * 1.05], [-jw * 0.6, headR * 1.05]], fill: 'shade', stroke: true });
  }
  parts.push({
    name: 'head', z: 20,
    pivot: [0, headCY],
    shapes: headShapes,
    anim: { lag: lerp(0, 1, g.headLag), swing: lerp(1, 9, g.idleSway), phase: 0.6, freq: 0.9, always: true },
  });

  // --- arm and weapon -------------------------------------------------------
  const armLen = lerp(8, 24, g.armLength);
  const armW = lerp(2.2, 6.2, g.armWidth);
  const shoulderY = torsoCY - torsoH * 0.35;
  const shoulderX = torsoW * 0.78;

  // The weapon *family* follows actual attack range so the silhouette stays
  // readable; which weapon within the family is the gene's business.
  const ranged = unit.range > 2.2;
  const family = ranged ? WEAPON_RANGED : WEAPON_MELEE;
  const weapon = family[pick(g.weaponShape, family.length)];
  const wSize = lerp(0.7, 1.45, g.weaponSize);

  parts.push({
    name: 'arm', z: 25,
    pivot: [shoulderX, shoulderY],
    shapes: [
      { kind: 'poly', pts: limb(armLen, armW, armW * 0.8, 10, 1), fill: 'body', stroke: true },
      ...weaponShapes(weapon, armLen, wSize, unit),
    ],
    anim: { swing: lerp(5, 22, g.gaitSwing), phase: Math.PI, freq: 1, recoil: lerp(3, 12, g.recoil) },
  });

  parts.sort((a, b) => a.z - b.z);

  return {
    parts,
    palette: palette(unit),
    // Measured from the geometry, not estimated from the genes. The estimate
    // overshot by about a fifth, which made every creature render a fifth too
    // small -- and worse, by a different fifth depending on its genes, so no
    // single fudge factor could fix it.
    bounds: measureBounds(parts),
    anim: {
      gaitFreq: lerp(1.4, 4.6, g.gaitFreq),
      bob: lerp(0, 4.2, g.bobAmp),
      lean: lerp(0, 13, g.lean),
      sway: lerp(0, 3.2, g.idleSway),
    },
  };
}

// The creature's true extent, so the renderer can fit it to a tile allowance
// exactly. Rotation is ignored: parts swing a little during animation and
// budgeting for the worst case would leave every creature sitting too small in
// its box for the sake of a pose it holds for a fraction of a second.
function measureBounds(parts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const part of parts) {
    const [px, py] = part.pivot;
    for (const shape of part.shapes) {
      if (shape.kind === 'poly') {
        for (const [x, y] of shape.pts) {
          minX = Math.min(minX, px + x); maxX = Math.max(maxX, px + x);
          minY = Math.min(minY, py + y); maxY = Math.max(maxY, py + y);
        }
      } else {
        minX = Math.min(minX, px + shape.c[0] - shape.r[0]);
        maxX = Math.max(maxX, px + shape.c[0] + shape.r[0]);
        minY = Math.min(minY, py + shape.c[1] - shape.r[1]);
        maxY = Math.max(maxY, py + shape.c[1] + shape.r[1]);
      }
    }
  }
  if (!Number.isFinite(minX)) return { w: 40, h: 60, top: -60 };
  return { w: Math.max(8, maxX - minX), h: Math.max(8, maxY - minY), top: minY };
}

function weaponShapes(weapon, armLen, size, unit) {
  const y = armLen;
  const reach = Math.min(34, 8 + unit.range * 3.2) * size;
  switch (weapon) {
    case 'blade':
      return [{ kind: 'poly', pts: [[-1.6, y], [1.6, y], [2.6, y + reach * 0.9], [0, y + reach], [-2.6, y + reach * 0.9]], fill: 'accent', stroke: true }];
    case 'maul':
      return [
        { kind: 'poly', pts: [[-1.4, y], [1.4, y], [1.4, y + reach * 0.62], [-1.4, y + reach * 0.62]], fill: 'shade', stroke: true },
        { kind: 'poly', pts: [[-5.5 * size, y + reach * 0.6], [5.5 * size, y + reach * 0.6], [5.5 * size, y + reach], [-5.5 * size, y + reach]], fill: 'accent', stroke: true },
      ];
    case 'claw':
      return [0, 1, 2].map((i) => ({
        kind: 'poly',
        pts: [[-1.2 + i * 2.6, y], [0.6 + i * 2.6, y], [(i - 1) * 3.4, y + reach * 0.7]],
        fill: 'accent', stroke: true,
      }));
    case 'pick':
      return [{ kind: 'poly', pts: [[-1.5, y], [1.5, y], [reach * 0.55, y + reach * 0.75], [reach * 0.3, y + reach * 0.85]], fill: 'accent', stroke: true }];
    case 'barrel':
      return [
        { kind: 'poly', pts: [[-2.6 * size, y], [2.6 * size, y], [2.0 * size, y + reach], [-2.0 * size, y + reach]], fill: 'accent', stroke: true },
        { kind: 'ellipse', c: [0, y + reach], r: [2.6 * size, 1.8 * size], fill: 'glow' },
      ];
    case 'lance':
      return [{ kind: 'poly', pts: [[-1.8 * size, y], [1.8 * size, y], [0, y + reach * 1.15]], fill: 'accent', stroke: true }];
    case 'coil':
      return [
        { kind: 'poly', pts: [[-1.8, y], [1.8, y], [1.8, y + reach], [-1.8, y + reach]], fill: 'shade', stroke: true },
        ...[0.35, 0.6, 0.85].map((t) => ({
          kind: 'ellipse', c: [0, y + reach * t], r: [4.2 * size, 1.7], fill: 'glow',
        })),
      ];
    default: // sling
      return [
        { kind: 'poly', pts: [[-1.4, y], [1.4, y], [1.4, y + reach * 0.8], [-1.4, y + reach * 0.8]], fill: 'shade', stroke: true },
        { kind: 'ellipse', c: [0, y + reach * 0.88], r: [3.6 * size, 3.6 * size], fill: 'accent' },
      ];
  }
}

// --- colour -----------------------------------------------------------------

const TYPE_ACCENT = { kinetic: 205, arc: 172, pyre: 22 };

export function palette(unit) {
  const g = unit.genome.genes;
  const hue = g.hue * 360;
  // Heavier armour reads as desaturated metal whatever the hue gene says.
  const sat = lerp(22, 64, g.sat) - Math.min(22, unit.armor / 12);
  const light = lerp(38, 56, g.light);
  const accentHue = (TYPE_ACCENT[unit.damageType] ?? 200) + (g.accent - 0.5) * 46;

  return {
    body: hsl(hue, sat, light),
    shade: hsl(hue, sat * 1.05, light * 0.62),
    light: hsl(hue, sat * 0.8, Math.min(88, light * 1.38)),
    dark: hsl(hue, sat, light * 0.34),
    outline: hsl(hue, sat * 0.9, 10),
    accent: hsl(accentHue, 72, 54),
    glow: hsl(accentHue, 92, 72),
    wing: hsla(accentHue, 60, 62, 0.62),
  };
}

function hsl(h, s, l) {
  return `hsl(${mod360(h)} ${clamp(s, 4, 96)}% ${clamp(l, 4, 94)}%)`;
}
function hsla(h, s, l, a) {
  return `hsl(${mod360(h)} ${clamp(s, 4, 96)}% ${clamp(l, 4, 94)}% / ${a})`;
}
function mod360(h) { return ((h % 360) + 360) % 360; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- posing -----------------------------------------------------------------
//
// Animation is computed, never stored. Given a creature and a clock, this
// returns a transform per part. Nothing is keyframed and no frames exist, so
// mutating an animation gene changes how the creature moves immediately and
// continuously -- which is the only reason animation can evolve at all.

export function poseCreature(creature, t, state = {}) {
  const { moving = false, attacking = 0, hurt = 0 } = state;
  const a = creature.anim;
  const gait = t * a.gaitFreq * (moving ? 1 : 0.35);
  const out = [];

  const bob = Math.sin(gait * 2) * a.bob * (moving ? 1 : 0.3);
  const lean = moving ? Math.sin(gait) * a.lean * 0.18 + a.lean * 0.35 : Math.sin(t * 0.7) * a.sway * 0.4;

  for (const part of creature.parts) {
    const an = part.anim ?? {};
    let rot = 0, dx = 0, dy = 0, scaleY = 1;

    if (an.swing) {
      const amp = an.always ? 1 : (moving ? 1 : 0.18);
      rot += Math.sin(gait * (an.freq ?? 1) + (an.phase ?? 0)) * an.swing * amp * (Math.PI / 180);
    }
    if (an.breathe) {
      scaleY = 1 + Math.sin(t * (an.freq ?? 1) * 2) * an.breathe;
    }
    if (an.lag) {
      // The head trails the body's motion, which is most of what makes a
      // procedural walk stop looking like a rigid toy.
      rot += -lean * an.lag * 0.02;
      dy += bob * an.lag * 0.35;
    }
    if (an.recoil && attacking > 0) {
      // attacking is a 0..1 decay from the moment of the hit.
      rot -= attacking * an.recoil * (Math.PI / 180) * 4;
      dx -= attacking * 2.2;
    }

    out.push({ part, rot, dx, dy, scaleY });
  }

  return { transforms: out, bob, lean: lean * (Math.PI / 180), hurt };
}

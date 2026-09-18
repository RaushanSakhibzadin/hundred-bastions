# Hundred Bastions

An open-source, donation-funded base-building siege game that runs in a browser
tab. No build timers, no premium currency, no advertising, no accounts, and no
network requests of any kind.

**Play:** https://raushansakhibzadin.github.io/hundred-bastions/

> First-time setup: the deploy workflow is committed and ready, but GitHub
> will not let a workflow token switch Pages on by itself. Go to
> **Settings → Pages → Build and deployment** and set **Source** to
> **GitHub Actions**, then re-run the "Deploy to GitHub Pages" workflow. It is
> a one-time click; after that every push to `main` publishes automatically.

Every creature in the game is *bred*, not authored. There are no art assets in
this repository: units are vector animals grown from a 54-gene genome, and the
genomes come from the creatures you have treated well.

## What makes it different

Four things, in order of how much they matter.

**The creatures evolve toward what you like.** Every recruitment offer is three
creatures descended from the ones you kept, levelled, fielded and chose — and
away from the ones you passed over or dismissed. Nobody writes a fitness
function; you are the fitness function, and the signal is scavenged from
ordinary play rather than collected by asking. Looks, movement and statistics
all live in one gene vector, so when a creature's line continues, all three
travel together. A player who keeps picking the spiny ones gets a spinier
world, and the test suite measures exactly that — with a control run proving an
indifferent player gets no drift at all. See
[`docs/EVOLUTION.md`](docs/EVOLUTION.md).

**The balance is a formula you can read.** One equation holds for every unit
ever generated:

```
ECV × traitCost / supply  =  a constant, per level
```

A supply point buys a fixed amount of power, and you may spend it on raw
statistics or on traits — range, speed, flight, splash — at a published
exchange rate. That is why a flying long-ranged unit has worse numbers than a
slow melee one of the same cost: it spent the difference. The derivation is in
[`docs/BALANCE.md`](docs/BALANCE.md), and the invariants are asserted over
thousands of seeds in `tests/balance.test.js`.

**The content is infinite because it is computed.** Bastion 4,102,887 is a real
place. It is generated from its number on demand, identically for everyone, and
nothing about it is stored. Units come out of the same seed space: recruitment
offers you three specific candidates rather than the next node on a tech tree.

**It respects your time by construction.** There are no build timers, so there
is nothing to skip and nothing to sell you. Buildings go up the instant you can
afford them; what limits you is *upkeep*, drawn continuously against your ore
production. The constraint is economic rather than temporal, which turns "wait
four hours" into "can this holding carry another tower?".

## How the generation works

**Statistics.** An archetype sets the shape of the roll; a budget derived from
supply cost sets its size; a solver distributes the budget across hit points,
armor and damage so that combat value lands exactly on budget whatever the
traits. Specialisation is free — a glass cannon and a balanced unit of the same
cost have identical combat value — because the solver normalises for it.
Crucially, genes never touch statistics directly: they index into archetype
bands and go through that same solver, so **evolution can make a creature
different but never stronger**. See [`docs/BALANCE.md`](docs/BALANCE.md).

**Bodies.** `src/core/morph.js`. A superellipse torso shaped by a roundness and
a taper gene, legs whose count, length, splay and stride phase are genes, plus
head, jaw, eyes, armour plates, spines, tail, wings, pattern and weapon — all
continuous quantities, because they have to interpolate. Blending two cellular
automata gives you noise; blending two polygon widths gives you a creature
halfway between its parents. That is the whole reason the art is vector.

**Movement.** Computed, never keyframed. A gait is a frequency, a swing
amplitude and a phase spread; at one extreme of the limb-phase gene the legs
move together and the thing hops, at the other they are evenly out of phase and
it walks. Mutating an animation gene changes how a creature moves immediately
and continuously, which is the only way animation can evolve at all.

**Names.** A syllable grammar weighted per archetype, with each part of the name
carried by a specific gene — so a child's name is a mutation of its parents'
names the way its body is a mutation of their bodies. Nothing implements family
names; breed Vrakgun long enough and you get Vrakgars and Brakguns for free.

**Buildings** stayed raster, using recursive quadtree subdivision: architecture
is hierarchical, buildings do not evolve, and a cellular automaton just produces
rubble.

**Holdings.** Defences are placed by radius band, with short-ranged ones on the
perimeter and long-ranged ones deep, then wrapped in walls with gates. Six
layout styles, from Open Field to Double Shell.

## The simulation

Fixed 30 Hz timestep, integer tick count, **no random element anywhere**. Given
the same bastion, the same warband and the same command log, a siege produces
byte-identical results on every machine. A four-minute siege simulates in under
a second, so playback speed is free.

## Playing

- **Holding** — build. Coverage heatmap is live while you place. Demolition
  refunds in full, so rearranging is free.
- **Warband** — your roster, with full statistics including each unit's power
  index. Recruit breeds three candidates from your own gene pool, each card
  naming its parents, its generation and which genes mutated. Below it,
  *What the pool has learned* shows the traits your choices have settled on.
- **Siege** — pick a bastion, read the free scout report, march.

During a siege: **tap the blue band** to land a whole squad in one gesture,
**long-press or shift-tap** for a single body, **1–9** to switch squads,
**Space** to pause, **R** to recall. Recall pulls back anything that has not
been engaged for two seconds and lets you land it again — a misread costs you
ten seconds, not the attack.

## Supporting it

This game is free software and will stay that way. It is funded entirely by
people who choose to donate, and it works identically whether or not you do.

- [Sponsor on GitHub](https://github.com/sponsors/RaushanSakhibzadin)

There is nothing to buy in the game, and there never will be.

## Running it locally

No build step, no bundler, no dependencies. It is ES modules and a canvas.

```sh
git clone https://github.com/RaushanSakhibzadin/hundred-bastions
cd hundred-bastions
python3 -m http.server 8000     # or any static file server
# open http://localhost:8000
```

Tests need only Node 18 or newer:

```sh
npm test
```

## Layout

```
index.html                     the whole shell
src/core/rng.js                deterministic PRNG, hashing, lattice noise
src/core/genome.js             genes, crossover, mutation, drift
src/core/morph.js              genome -> vector creature (canvas-free, testable)
src/core/balance.js            the balance engine: costs, solver, generation
src/core/naming.js             heritable syllable-grammar names
src/core/spritegen.js          raster building sprites
src/game/structures.js         buildings; defences priced by the same solver
src/game/base.js               grid, placement, upkeep economy, coverage field
src/game/bastion.js            procedural enemy holdings from an integer
src/game/sim.js                the siege: flow-field pathing, targeting, scoring
src/game/lineage.js            gene pools, affinity, selection, breeding
src/game/roster.js             levelling, warband validation
src/game/save.js               localStorage, import/export
src/ui/render.js               canvas drawing
src/ui/creature.js             creature -> canvas and SVG, cached
src/ui/sprites.js              building grid -> canvas, cached
src/ui/app.js                  screens, input, loop
tests/                         61 tests, no dependencies
docs/BALANCE.md                the formula, derived
docs/EVOLUTION.md              how selection works, and proof that it does
docs/IP-AND-DESIGN-DIFFERENCES.md   why the design is what it is
```

## Intellectual property

This game shares a genre with well-known commercial titles and is deliberately
not a clone of any of them. No assets, names, code or layouts were copied from
anything — there are no assets at all. Eleven specific mechanical departures
from the genre's conventions are documented, with reasoning, in
[`docs/IP-AND-DESIGN-DIFFERENCES.md`](docs/IP-AND-DESIGN-DIFFERENCES.md); every
one of them makes the game more convenient to play, not less.

That document is an engineering record, not legal advice.

## Licence

[AGPL-3.0-or-later](LICENSE). You may use, study, modify and redistribute this,
including over a network, provided your version stays open under the same terms.
The copyleft is the point: this is donation-funded free software, and it should
not be possible to take it closed and sell it back to the people who funded it.

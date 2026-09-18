# Hundred Bastions

An open-source, donation-funded base-building siege game that runs in a browser
tab. No build timers, no premium currency, no advertising, no accounts, and no
network requests of any kind.

**Play:** https://raushansakhibzadin.github.io/hundred-bastions/

Every unit in the game is *generated*, not authored — from a 32-bit seed,
through one published balance equation. So is every enemy holding, and so is
every sprite. There are no art assets in this repository; the pixels are
computed at runtime from a cellular automaton and a fractal.

## What makes it different

Three things, in order of how much they matter.

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
cost have identical combat value — because the solver normalises for it. See
[`docs/BALANCE.md`](docs/BALANCE.md).

**Sprites.** `src/core/spritegen.js`. A superellipse body mask shaped by
archetype, eroded by two passes of a cellular automaton over seeded noise,
mirrored, then stamped with a fractal emblem — a Sierpiński carpet, a Vicsek
cross, a Cantor bar set — chosen by the seed. Armor bands, weapon barrels sized
to actual attack range, and wings for fliers are drawn on top, so you can read a
unit's statistics off its silhouette. Palettes are spaced by the golden angle so
consecutive seeds never look alike. Buildings use recursive quadtree subdivision
instead, because architecture is hierarchical and a cellular automaton just
produces rubble.

**Names.** A syllable grammar weighted per archetype, plus an epithet chosen
against the unit's actual numbers — so the name tells you something true before
you read the stat block. 4,653 distinct names in 5,000 seeds.

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
  index. Recruit rolls three candidates from the seed space.
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
src/core/balance.js            the balance engine: costs, solver, generation
src/core/naming.js             syllable-grammar names for units and places
src/core/spritegen.js          sprites as colour-index grids (canvas-free, testable)
src/game/structures.js         buildings; defences priced by the same solver
src/game/base.js               grid, placement, upkeep economy, coverage field
src/game/bastion.js            procedural enemy holdings from an integer
src/game/sim.js                the siege: flow-field pathing, targeting, scoring
src/game/roster.js             recruitment, levelling, warband validation
src/game/save.js               localStorage, import/export
src/ui/render.js               canvas drawing
src/ui/sprites.js              grid -> canvas, cached
src/ui/app.js                  screens, input, loop
tests/                         35 tests, no dependencies
docs/BALANCE.md                the formula, derived
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

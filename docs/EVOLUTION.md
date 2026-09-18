# Evolution

Creatures in Hundred Bastions are bred, not rolled. Every recruitment offer is
three creatures descended from the ones you have treated well, and "treated
well" is measured from what you actually did rather than from anything you were
asked.

This is interactive evolutionary computation — the line that runs from Dawkins'
Biomorphs through Picbreeder — with one difference that matters. Those systems
ask you to click the one you like, which makes the signal clean and the task a
chore. Here the signal is scavenged from play. You level a unit up because you
want it stronger, not to vote for it. The vote is a side effect.

## The genome

A creature is a vector of 54 genes, each a number in `[0,1]`, in four groups:

| Group | Count | Examples |
|---|---|---|
| `stat` | 12 | supply, offense share, armor, range, speed, attack rate, ability |
| `color` | 4 | hue, saturation, lightness, accent shift |
| `form` | 28 | torso width, taper, leg count, spike count, tail curl, eye count, weapon shape |
| `anim` | 10 | gait frequency, stride swing, limb phase spread, head lag, recoil, breathing |

They live in one vector on purpose. When a creature's genes propagate, its
look, its movement and its numbers travel together, because they were never
separate things.

Class is inherited and never mutates. Vanguards breed with Vanguards.

## Why vector graphics

The art moved from a cellular automaton to polygons specifically so it could be
bred. Pixels do not interpolate: blending two automata gives you noise.
Blending two polygon widths gives you a creature halfway between its parents.
Every gene in `morph.js` maps to a continuous geometric quantity for exactly
that reason — a superellipse exponent, a limb length, a splay angle, a
scalloping depth.

Animation is computed rather than keyframed, for the same reason. There are no
frames to interpolate between; a gait is a frequency, a swing amplitude and a
phase spread, and mutating any of them changes how the creature moves
immediately and continuously.

The morphology is plain data, so one description drives both renderers: canvas
for a battlefield with forty creatures at 60fps, and SVG for a roster card that
wants to be crisp at any size.

## Evolution cannot break the balance

Stat genes do not touch statistics directly. They index into their archetype's
band and then go through the same solver documented in
[`BALANCE.md`](BALANCE.md), so the invariant

```
ECV × traitCost / supply = constant, per level
```

survives arbitrary breeding. `tests/evolution.test.js` asserts this over sixty
generations of every archetype. **A mutation can make a creature different. It
can never make it stronger.** That is the property that lets evolution run
loose without a designer watching it.

## The preference signal

Every signal is weighted by what it costs you to emit:

| Signal | Weight | Why |
|---|---|---|
| Chosen from an offer | **+3.5** | You picked it over two siblings sitting right next to it. As close to a controlled experiment as this system gets |
| Passed over in an offer | **−1.1** | The other two are evidence too. Learning only what you like and never what you decline throws away half of every choice |
| Levelled up | **+2.2** | You spent ore and flux. Costly, therefore honest |
| Dismissed | **−6.0** | The strongest signal in the system, and negative |
| Deployed in a siege | +0.45 | You chose to bring it |
| Currently in your warband | +0.6 per body | You are using it now |
| Seconds survived on the field | +0.012 | Cheap per unit, but it tracks something real |
| Card opened | +0.12 | Deliberately the weakest: curiosity is not preference |

Affinity is clamped positive so selection never divides by zero, and a genome
in your roster is never evicted from its own gene pool however badly it scores.

## Drift: what "more of the same mutation" means

For each gene, across the elite of a pool, the system computes an
affinity-weighted **mean** and a **weight** measuring how consistently the liked
creatures agree — derived from the weighted standard deviation, so a gene every
favourite sits at 0.8 on scores near 1, and a gene scattered across the range
scores near 0.

That pair then steers mutation in two ways:

1. A gene the pool agrees on is **pulled toward** the agreed value.
2. A gene the pool agrees on takes a **smaller step**, down to 35% of normal.

So a trait you keep choosing stays recognisable across generations instead of
being mutated straight back out, while a trait nobody agrees on keeps a
full-size step and goes on exploring. Nothing is ever told what a spike is. The
player keeps picking the spiny ones; the next generation is spinier.

### Per-class or shared?

Both, and the split is deliberate.

**Statistics drift per class.** A Colossus's armor gene and a Skirmisher's armor
gene index into different bands and describe different roles, so pooling them
would be meaningless.

**Looks and movement drift across all classes**, then blend back toward each
class's own taste as that class accumulates its own evidence. If you keep
choosing spiny, red, bouncy creatures, that is a fact about you, not about
Vanguards. It is also a practical necessity: with eight classes sharing three
offer slots, a strictly per-class pool sees about one generation an hour, which
is far too slow for anyone to notice their taste being learned.

Early on you are teaching the game what you like. Later you are teaching it what
you like *in a Vanguard*.

## Keeping the pool from collapsing

Converging on your taste is the goal. Converging until every creature is the
same creature is the failure mode, and it is the one every interactive
evolution system falls into if nobody checks. Four guards:

- **Immigration.** One offer slot in five ignores the pool entirely and arrives
  with fresh genes.
- **Macromutation.** One touched gene in twenty is resampled outright, so a
  lineage can leave the basin it started in.
- **Offer diversity.** Two candidates closer than a distance threshold are not
  shown together, and a class already on the table is heavily downweighted — so
  an offer is a choice between different kinds of creature, not three variations
  on one.
- **A cap on class bias.** A loved class appears more often, up to a hard
  ceiling.

### A bug worth recording

Class weighting originally used the *total* affinity of a class's pool. Total
affinity grows with pool size, so a class that won a couple of early offers got
more slots, which grew its pool, which raised its total, which won it more
slots. In testing it collapsed completely: sixty recruitments in a row, every
single one an Aeronaut.

The fix is to weight by the *mean* affinity of a class's elite, which cannot run
away, plus the cap. `tests/evolution.test.js` has a regression test that stuffs
a pool with twenty beloved Aeronauts and asserts that offers stay mixed.

## Does it actually work?

Two tests, and the second is the one that matters.

**A consistent preference steers the offers.** A simulated player always takes
the spiniest of three. Over eighty recruitments, averaged across twelve runs,
the mean spininess of what they are *shown* — not what they take, which would be
true by definition — rises from 0.50 to about 0.63 of maximum.

**An indifferent player gets no drift.** The control run picks round-robin with
no preference at all. Its mean stays pinned at 0.500. Without this the first
result proves nothing: a system that drifted regardless of input would pass it
just as happily.

Measured across five different tastes (spiny, many-legged, bouncy, long-tailed,
big-eyed), every one drifts in its own direction, monotonically, while the
control stays flat.

The ceiling is bounded by design: with one offer in five being an unrelated
immigrant at the population mean, even a perfectly converged breeding pool would
top out near 0.9. Landing at 0.63 after eighty recruitments is roughly 70% of
what is reachable while keeping the variety that makes the choice a choice.

## Seeing it happen

Two places in the UI, because an adaptive system you cannot inspect is
indistinguishable from a broken one:

- Every recruitment card names its parents, its generation, and which genes
  mutated — filtered to genes the creature actually *expresses*, since telling
  a wingless Sapper it has mutated smoother wings teaches you the readout is
  noise.
- **What the pool has learned** lists, per class, the traits your choices have
  settled on, and how many creatures that reading is based on. A class with
  fewer than four is not reported: with two creatures in a pool every gene looks
  unanimous.

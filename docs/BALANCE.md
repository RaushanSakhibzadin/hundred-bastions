# The balance formula

Every unit in Hundred Bastions is generated from a 32-bit seed. Nothing is
hand-authored. That only works if the generator can guarantee that what it
produces is fair, so this document is the guarantee, written out.

The claims below are asserted in `tests/balance.test.js` over thousands of
seeds. If a claim here stops being true, the test suite fails.

## The one equation

> **ECV × traitCost / supply = ECV_PER_SUPPLY × LEVEL_STEP^(level−1)**

for every unit, at every seed, at every level.

Read it as: *a supply point buys a fixed amount of power, and you may spend it
on raw statistics or on traits, at a published exchange rate.*

Note what is deliberately **not** claimed. Raw combat value per supply is *not*
equal across units. A flying, long-ranged, splash unit has visibly worse
numbers than a slow melee one of the same supply cost. That is not a bug in the
balance, it *is* the balance: the difference is exactly what those traits cost.

## Effective combat value

Two quantities describe a body in a fight.

**Effective hit points** — how much raw damage it absorbs before dying.

```
damageReduction(armor) = armor / (armor + K)            K = 100
effectiveHp(hp, armor) = hp × (armor + K) / K
```

Armor is a diminishing-returns multiplier, never a flat subtraction. Flat armor
breaks down at both extremes: it makes chip damage worthless and makes
high-damage units mandatory. This form keeps every unit relevant against every
other, and can never reach immunity — `damageReduction` approaches 1 but never
arrives.

**Damage per second** — how fast it removes other bodies.

```
dps = damage × attackRate × targets
```

Combat value is the **geometric** mean of the two:

```
ECV = √(effectiveHp × dps)
```

Geometric and not arithmetic, because strength in a Lanchester-style exchange
scales with the *product*. A unit with twice the hit points and twice the
damage is four times as strong, not twice — it survives twice as long while
dealing twice as much per second. The square root puts that back on a linear
scale so it can be priced linearly.

## Trait costs

Each trait multiplies the price of the unit:

```
traitCost = κ_range × κ_speed × κ_splash × κ_flying × κ_rate × κ_targeting × κ_ability
```

κ > 1 is an advantage, paid for in raw statistics. κ < 1 is a restriction,
compensated with raw statistics.

| Trait | Coefficient | Why |
|---|---|---|
| Range | `(1 + (r − 1) / 4)^0.62` | Standing outside the enemy's reach is the strongest single trait in any auto-battler, so it is the most expensive. The exponent below 1 makes the curve concave — the first tile of range is worth far more than the tenth — which stops the generator producing degenerate snipers. |
| Speed | `(s / 2.4)^0.45` | Matters for reaching defences and for kiting. Square-root-ish because speed past a point buys nothing: you arrive, then you fight. |
| Immobility | `0.55` flat | Speed 0 is not free movement, it is *immobility*: no repositioning, no retreat, no choosing engagements. Structures are compensated for it, which is why turrets out-stat units point for point. |
| Splash | `(1 + 0.9 r²)^0.5` | Value scales with area, but real targets are never packed perfectly, so the area term is damped. |
| Flight | `1.55` | Ignores walls entirely, and only some defences can answer it. |
| Attack rate | `(rate)^0.10` | Fast attackers waste less damage on overkill and retarget sooner. A small effect, but real, so it is priced. |
| Targeting | 0.72–1.0 | A unit that only attacks defences is easier to plan around but throws damage away on everything else. `air-only` is the deepest discount, because a ground-only warband makes it worth nothing. |
| Ability | 1.18–1.34 | Priced individually; see `KAPPA.ability` in `src/core/balance.js`. |

## The solver

Given a budget `B` and a trait set, the effective budget is `B' = B / traitCost`.
An **offense share** `s ∈ (0,1)` splits it:

```
n(s) = 0.5 / √(s(1−s))          the normaliser
dps  = B' × s       × 2 × n(s)
ehp  = B' × (1 − s) × 2 × n(s)
```

The normaliser is the interesting part. Without it:

```
ECV = √(ehp × dps) = 2B'√(s(1−s))
```

which peaks at `s = 0.5`. A balanced unit would be strictly stronger than a
glass cannon, and the generator would quietly push everything toward the middle
— every unit would be a slightly different shade of "average". With it:

```
ECV = 2B' × n(s) × √(s(1−s)) = B'
```

exactly, for every `s`. **Specialisation costs nothing in power and buys you a
role.** That is the only kind of trade-off worth having.

Armor is chosen first, as an identity trait rather than a power trait, and hit
points are then solved so effective HP lands on budget regardless:

```
hp = ehp × K / (armor + K)
```

So high armor means low hit points: the same durability in a different shape,
with a different answer to the counter matrix. This is asserted in the test
*"armor changes shape, not durability"*.

## The counter triangle

Three damage types (**kinetic**, **arc**, **pyre**) against three armor classes
(**plate**, **mesh**, **ward**). The matrix is a circulant built from one triple:

```
[1.25, 1.00, 0.80]      product = 1
```

| | plate | mesh | ward |
|---|---|---|---|
| **kinetic** | 1.25 | 1.00 | 0.80 |
| **arc** | 0.80 | 1.25 | 1.00 |
| **pyre** | 1.00 | 0.80 | 1.25 |

Because the triple's product is exactly 1 and every row and column is a
rotation of it, **every row multiplies to 1 and every column multiplies to 1**.
No damage type is better on average. No armor class is better on average. The
triangle is pure rock-paper-scissors with zero net balance drift — which is
rare, because most such matrices in most games quietly favour something.

## Archetypes

The generator does not roll traits uniformly; that produces mush. It rolls an
**archetype** first, which sets the *shape* of the roll — ranges, not values —
and then rolls inside it. Two units of the same archetype are recognisably
cousins and still meaningfully different.

Rolls use a bell-ish distribution (the mean of three uniforms) rather than a
flat one, so most units sit near the middle of their archetype's band and the
extremes are rare enough to feel like finds.

Archetypes and their bands are at the bottom of `src/core/balance.js`.

## Defences use the same engine

Turret statistics are not authored either. Each defence declares a trait set and
an offense share, and goes through the same `solveStats` call. A `budgetScale`
dial exists per building, and **every defence currently ships at 1.0** — every
difference between a Bolt Tower and a Rail Lance comes out of the formula, not
out of a thumb on the scale.

Structures do not spend budget on survivability: their hit points are granted by
the building rather than bought, which is why they are compared against units on
damage alone.

## Changing the balance

Every constant is a design dial. Change `ECV_PER_SUPPLY` and the entire roster
rebalances coherently against the same defences. Change `K_ARMOR` and the whole
game's relationship between armor and chip damage moves at once. That is the
real argument for generating rather than authoring: there is one place to make
a balance decision, and it applies to units that do not exist yet.

Run `npm test` after any change. The invariants above are all asserted.

# Intellectual property, and why this game is built the way it is

**This is not legal advice.** I am not a lawyer and nothing here is a legal
opinion. It is an engineering document: it records the design decisions taken
to keep this project clearly its own work, and it is written so that a lawyer
can read it quickly if you ever need one to. If you plan to take money for this
beyond donations, or to distribute it through an app store, get a real
freedom-to-operate review from a qualified attorney in your jurisdiction.

That caveat is not a formality. Patent scope depends on claim language, on
jurisdiction, and on prosecution history, and none of that can be settled by
reading a README. What follows reduces risk; it does not eliminate it.

## The three separate things people conflate

**Copyright** covers expression: code, art, audio, text, level layouts.
**Trademark** covers identifiers: names, logos, and trade dress — the overall
look-and-feel that tells a customer whose product this is.
**Patents** cover methods: a specific claimed technique, regardless of how you
implement it. You can infringe a patent with entirely original code.

Genre is not protectable. "Build a base, train units, attack another base" is an
idea, and ideas are not owned. The risk is never the genre; it is in the
specific expression, the specific identifiers, and the specific claimed methods.

## Copyright: nothing was copied

- **No art assets exist in this repository.** Every unit, turret, wall and
  building is computed at runtime from a 32-bit integer — a superellipse body
  mask, a cellular automaton, a fractal emblem, and a golden-angle palette. See
  `src/core/spritegen.js`. There is no sprite sheet to have copied from, and
  the art carries exactly the same licence as the code.
- **No audio.**
- **No names are borrowed.** Every unit name is generated from a syllable
  grammar (`src/core/naming.js`). Building names are original: Citadel, Bolt
  Tower, Scatter Battery, Skywatch, Flame Trench, Rail Lance, Rampart, Ore
  Pump, Flux Condenser, Muster Hall, Forge. Resources are Ore and Flux.
- **No code was copied from any commercial game**, which would be impossible in
  any case — the clients are compiled and the servers are not public.
- **No base layouts were copied.** Enemy holdings are generated from their
  index number (`src/game/bastion.js`).

## Trademark: stay out of the way

Rules this project follows, and that you should keep following:

- Never use another company's product names or company name in the game, the
  repository, the store listing, the domain, or the marketing.
- Never describe the game as a clone of, or a replacement for, a named product.
  Describe what it *is*. "An open-source base-building siege game" is accurate
  and safe; "an open-source Clash of Clans" is neither.
- Do not imitate anyone's logo, wordmark, colour scheme, or icon.
- Do not buy search advertising against another game's name.

The visual language here is a deliberate departure and not a near-miss: a flat,
dark, **top-down orthogonal** presentation on a square grid, with a muted
slate-and-amber palette and a data-dense interface that shows you the numbers.
It is not a bright isometric cartoon village, and it is not trying to be.

## Patents: designing around the method, not just the picture

Supercell, like most large games companies, holds granted patents covering
specific interaction methods in this genre. I have deliberately **not** listed
patent numbers here, because citing claims I have not had examined would give
you false confidence in either direction. What I have done instead is identify
the *mechanics most commonly claimed* in this space and build something
different at each point — and, critically, only in directions that make the
game **more** convenient to play, never less.

That last part matters for a reason beyond politeness. A design change that
makes a game worse in order to dodge a patent is a change you will be tempted
to revert later. A change that makes the game better is one that sticks.

### The eleven differences

| # | Common in the genre | What Hundred Bastions does | Why it is more convenient |
|---|---|---|---|
| 1 | Construction takes real-world hours; a premium currency skips the wait | **No build timers at all.** Buildings finish instantly; the limit is *upkeep*, which every structure draws against ore production forever, and you may not go net-negative | You never wait, and you never close the game because there is nothing to do. The constraint becomes a decision — "can this holding carry another tower?" — instead of a countdown |
| 2 | Deploy one body per tap, under a clock | **One gesture lands a whole squad.** Shift-tap (or long-press) lands a single body when you want to bait one defence | Tapping out thirty bodies is dexterity, not strategy, and the strategy was the interesting part |
| 3 | Once committed, you watch | **Pause, 1×/2×/4× speed, and Recall** — anything not engaged for two seconds walks off the field and is redeployable | A misread costs you ten seconds instead of the whole attack |
| 4 | Units are fully autonomous once dropped | **Rally point** biases target selection toward a place you choose, without overriding unit nature | You get to express intent mid-battle without micromanaging individual bodies |
| 5 | Three-star tiers with hard thresholds | **Continuous scoring.** Loot scales smoothly with the share of the holding you actually broke | A 49% attack pays 49%. The cliff exists to make near-misses feel bad, and that is not a goal here |
| 6 | Moving a building costs time or currency | **Demolition refunds in full**, instantly | Rearranging your holding is free, so you experiment instead of committing once and living with it |
| 7 | You infer defensive coverage from memory | **Live coverage heatmap** while you build, and range rings on selection | The most useful thing a base builder can be shown, and it is bizarrely rare |
| 8 | Scouting is limited, timed, or costs a resource | **Free, always-visible scout report** before every siege — structure counts, anti-air density, wall count, notable threats | The interesting decision is which warband to bring. That is only interesting if you have the information to make it |
| 9 | Attacks are matched against other players' live bases, with shields, revenge, and loot penalties | **Single-player procedural holdings addressed by integer.** Bastion 4,102,887 is the same holding for everyone and is generated on demand | No matchmaking, no shields, no revenge timers, no being farmed while asleep — and no matchmaking method to collide with |
| 10 | A fixed roster unlocked on a tech tree | **Units are generated from seeds** by a published formula, and recruitment offers you three specific candidates | You choose between concrete units rather than waiting for the next tree node to become affordable |
| 11 | Isometric diamond grid | **Top-down orthogonal square grid** | A tile is a tile. Drag-to-place lands where your finger is, and nothing has to be un-skewed in your head before you can reason about coverage |

### Also deliberately absent

No premium currency. No loot boxes or gacha. No energy system. No shields or
guards. No clan wars, no player-versus-player, no chat, no social graph. No
advertising. No analytics, no tracking, and no network requests of any kind —
the game is static files and `localStorage`, and your save never leaves your
browser.

Several of those absences remove whole categories of claimed method from the
picture at once. Most of them also remove whole categories of reasons to
dislike a game.

## If you ever go commercial

Donations through GitHub Sponsors are a different posture from selling a
product, but the line is not as bright as people assume. Before you charge for
anything, before you ship to an app store, and before you take investment:

1. Get a freedom-to-operate search from a patent attorney who works in games.
2. Have them look specifically at deployment interaction, base-attack scoring,
   matchmaking, and resource-collection methods — the four areas where this
   genre's patents cluster.
3. Keep this document updated as the design changes, and keep the git history
   intact. A documented, dated record of independent design decisions is
   genuinely useful evidence.
4. Do not accept contributions from anyone currently employed by a competitor
   in this genre without written clearance.

## Contributions

By contributing you confirm the work is yours to give, that you are not
reproducing anyone else's assets or code, and that you agree to license it
under this project's licence. Do not open pull requests that add ripped art,
ripped audio, or data tables extracted from another game. They will be closed.

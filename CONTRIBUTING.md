# Contributing

The project has no dependencies and no build step. Clone it, serve the
directory, and open it.

```sh
python3 -m http.server 8000
npm test          # 35 tests, Node 18+, nothing to install
```

## Before you open a pull request

**Run the tests.** The balance invariants in `tests/balance.test.js` are the
claims the documentation makes. If you change a constant in
`src/core/balance.js` and a test fails, the test is usually right — the
documentation says that invariant holds, so either the change is wrong or
`docs/BALANCE.md` needs updating in the same commit.

**Keep the simulation deterministic.** `src/game/sim.js` has no random element
and must not acquire one. No `Math.random`, no `Date.now`, no wall-clock. If
you need variation, take it from the seeded generators in `src/core/rng.js`.

**Do not add art or audio files.** Everything visible is computed from a seed
at runtime. That is a design constraint, not an accident: it is what makes the
roster infinite and what keeps the licensing clean. If you want a unit to look
different, change the generator.

**Do not add tracking, analytics, or network calls.** The game is static files
and `localStorage`. Nothing should leave the player's browser.

## What is especially welcome

- New archetypes, and new abilities with a *justified* `KAPPA.ability` cost.
  Say in the pull request why the number is what it is.
- New bastion layout styles in `src/game/bastion.js`.
- Sprite generator improvements — this is the part with the most headroom.
- Accessibility: keyboard paths, contrast, reduced motion, screen readers.
- Balance analysis. If you can show a trait is mispriced, that is a real bug
  and a welcome one.

## Intellectual property

By contributing you confirm the work is yours to give, that you are not
reproducing anyone else's assets, code, or data tables, and that you licence it
under AGPL-3.0-or-later. Please read
[`docs/IP-AND-DESIGN-DIFFERENCES.md`](docs/IP-AND-DESIGN-DIFFERENCES.md) — the
design constraints described there are deliberate, and pull requests that undo
them need to make the case.

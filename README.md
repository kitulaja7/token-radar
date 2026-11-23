# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kitulaja7/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kitulaja7/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A web dashboard that ranks pre-token protocols by implied value and gives each
one a concrete farm plan, built for the make.fun
[token-radar-01](https://make.fun/bounty/token-radar-01) competition.

## What it does

The program reads the frozen DefiLlama snapshot (758 protocols, 40 on the
watchlist, as of 2026-11-14), scores every pre-token protocol, and writes a
ranked board of **197 rows** (40 watchlist + 138 early + 19 off-list at half
credit) with an implied value, a token-odds estimate, an interval, and a
FARM / MARGINAL / SKIP verdict priced in dollars per hour — plus a static
dashboard (board, per-protocol detail view with a 7-step farm plan, protocol
ledger, and out-of-sample evidence) and three screenshots.

## The model (radar-2)

Implied value = launch value × token odds.

- **Launch value** — a log-log curve fit on the snapshot's 88 token-trading
  comparables: `log(mcap) ~ 9.0121 + 0.3992 · ln(TVL)` plus a ridge-shrunk
  category effect (λ=64). Leave-one-out miss ×3.09, walk-forward miss ×2.45
  (flat median multiple: ×4.90 / ×4.49).
- **Token odds** — a logistic regression on 437 peers (log years listed, ln TVL,
  category token share, 7-day growth). Ten-fold cross-validation Brier 0.2154
  vs base rate 0.2476.
- **Farm verdicts** — expected drop × drop share, minus gas, fees and a capital
  charge, priced against a $25/hour benchmark: 13 FARM / 58 MARGINAL / 126 SKIP.

Every term was kept only if it lowered the miss in both leave-one-out and
walk-forward tests; chains, age and 7-day growth were tested and dropped.
See `VALIDATION.md` for the full tables.

## Running it

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

This writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Running it twice writes
byte-identical output.

## License

MIT — see `LICENSE`.

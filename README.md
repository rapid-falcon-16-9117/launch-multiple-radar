# launch-multiple-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rapid-falcon-16-9117/launch-multiple-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rapid-falcon-16-9117/launch-multiple-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that prices protocols which record no token yet — as if each launched today — and tells the reader exactly how to farm each one before it does.

**The model.** The snapshot grades its own homework: for every category, the radar learns what the market already pays per dollar of TVL from the protocols whose tokens do trade (the median market-cap ÷ TVL, with samples winsorised at 8× so one mania cannot price a category). A pre-token protocol is then priced the same way — TVL × its category's multiple — adjusted only for what the snapshot says about the protocol itself: its 7-day TVL momentum (×1 + change × 0.5, clamped), its maturity (up to ×1.5 for years operated with no token), and its reach (+4% per extra chain, capped at ×1.25). No name is hardcoded; the same code re-prices any snapshot.

**The board.** 204 protocols priced and ranked, covering all 40 of the snapshot's watchlist plus the strongest pre-token protocols below the floor, with the watchlist's own hygiene applied throughout (no wrapped/staked products of trading tokens, no exchange house products). Each row carries a five-step farm plan with concrete actions, cadence, duration and budget, shaped by the protocol's category and priced by its chains' gas.

**The dashboard.** A static, no-network page: a sortable, filterable board (search, category, chain, watchlist-only), a detail view per protocol showing the full price breakdown (base × momentum × maturity × reach), and the learned category multiples up top.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, deterministically — two runs over the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9fhtyn8n&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

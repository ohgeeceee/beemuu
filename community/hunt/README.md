# Parameter Hunt — community files

The Hunt tab reads two static files from this folder at startup. Both are
updated by pull request — no server, no accounts, offline-first.

## How scoring works

| Event | Points | Awarded by |
|---|---|---|
| New responding identifier discovered | +10 | automatic (`probe_range`) |
| Unknown byte mapped to a physical value | +50 | automatic (`add_to_profile`) |
| Confirmed freeze-frame schema saved | +100 | automatic (`save_freeze_schema`) |
| Contribution merged into a release | +500 | `merged` count in `leaderboard.json` |

Each identifier/mapping/schema scores once, ever (deduped by
`ecu:mode:id`). Simulator runs are logged as **practice** and score 0 —
only a real car counts. Your local ledger lives at
`<home>/beeemuu-exports/hunt_state.json`.

## Publishing your score

1. Set your alias in the Hunt tab.
2. Open a PR adding (or updating) your entry in `leaderboard.json`:

```json
{ "alias": "yourname", "points": 340, "merged": 0, "note": "E92 N54 local ident sweep" }
```

Maintainers bump `merged` when a data/code contribution of yours ships in a
release — that's +500 each, applied automatically in-app when your alias
matches. Your local score always overrides your own published `points`
entry, so the file only needs updating when you want the world to see it.

## Adding a monthly challenge

Add an object to `challenge` in `challenges.json`:

```json
{
  "id": "2026-08-e70-dids",
  "title": "August: E70 DID Safari",
  "description": "Discover 10 new responding DIDs this month",
  "month": "2026-08",
  "kind": "discover",
  "target": 10,
  "reward": 250
}
```

`kind` is one of `discover` | `map` | `schema`. `month` is `YYYY-MM`;
leave it `""` for an evergreen challenge. Progress counts real-car events
in that month only.

## Honor system

There is no anti-cheat beyond the simulator exclusion — this is a
community game for recognition, not prizes. Verified "first to map X"
claims belong in the `note` field and in release notes.

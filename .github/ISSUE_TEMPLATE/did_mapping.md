---
name: New DID / local identifier mapped
about: Report a newly discovered DID, local ID, or OBD-II PID on your BMW
title: "[DID] <hex> on <ECU> — <chassis> <engine>"
labels: ["community-data", "did-mapping", "needs-verification"]
---

## Identifier

| Field | Your value |
|-------|-----------|
| **Identifier type** | UDS DID / KWP2000 Local ID / OBD-II PID |
| **Hex value** | (e.g., `0x4506`, `0x0B`, `0xDA12`) |
| **ECU address** | (e.g., `0x12` = DME, `0x18` = EGS, `0xA0` = DSC) |
| **Query string** | (e.g., `did:4506`, `local:10`, `obd:05`) |

## Vehicle

- **Chassis:** (e.g., F30 335i, E92 335i, G20 330i)
- **Engine:** (e.g., N55B30, B58B30, N52B30)
- **Model year:**
- **Protocol:** KWP2000 / UDS / ENET / DoIP
- **Cable:** K+DCAN USB / ENET adapter / BLE / WiFi

## Raw data

### At condition A (describe: e.g., cold start, idle, warm)
```
Request:  <hex bytes you sent>
Response: <hex bytes the ECU returned>
```

### At condition B (describe: e.g., 3000 RPM, after 10 min drive, WOT)
```
Request:  <hex bytes you sent>
Response: <hex bytes the ECU returned>
```

## What you think it means

<!-- Your best guess at the parameter — e.g., "Oil temperature" or "Boost pressure" -->

## How you verified it

<!-- Explain your cross-check method. The stronger, the faster this gets merged. -->

- [ ] Compared to OBD-II PID (if applicable): PID `0x__` gave same value
- [ ] Compared to gauge cluster / infotainment display
- [ ] Compared to known good source (forum thread, OBDb, etc.)
- [ ] Physical correlation (e.g., value rose when engine warmed up, dropped when cooled)
- [ ] Only one condition tested — needs more verification

## Source

<!-- Cite your sources. Links are gold. -->

- My own Parameter Explorer log on my car
- Forum thread: <URL>
- OBDb entry: <URL>
- Other: <describe>

## Suggested profile entry

<!-- If you're comfortable writing TOML, paste what you'd add. -->

```toml
[[profile.param]]
id = "..."
label = "..."
unit = "..."
target = 0x__
query = "..."
decode = "..."
min = 0.0
max = 0.0
```

## Confidence

<!-- Check one -->

- [ ] **High** — verified on my car + cross-checked against 2+ sources
- [ ] **Medium** — verified on my car, single source or logical inference
- [ ] **Low** — educated guess, needs community testing

## Confirmation

- [ ] This is original or community-derived knowledge, **not** extracted from ISTA, INPA, SGBD, or other proprietary BMW software.
- [ ] I am willing to be credited in the commit message and TOML file as `@<your_github_username>`.

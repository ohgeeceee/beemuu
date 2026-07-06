# BeeEmUu Chart Playback Scripts

Post-drive analysis tools for BeeEmUu logged sessions. These work with the **Export CSV** files produced by the BeeEmUu app's *Logging* tab.

## Files

| File | Purpose |
|------|---------|
| `chart_playback.py` | Turn a BeeEmUu CSV export into a rich multi-panel seaborn visualization |

## Usage

```bash
# Generate a post-drive analysis PNG from a logged session
python scripts/chart_playback.py beeemuu-log-2025-01-01T12-00-00.csv -o session_analysis.png
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output` / `-o` | `beeemuu_session_analysis.png` | Output PNG path |
| `--style` | `darkgrid` | Seaborn theme: `darkgrid`, `whitegrid`, `ticks`, `white` |
| `--width` | `16` | Figure width in inches |
| `--height` | `10` | Figure height in inches |

## What the chart shows

1. **Session Summary** — duration, sample count, effective rate, and a min/max/mean/std table for every parameter.
2. **Time-series (grouped by category)** — Temperatures, Pressures, Speeds & RPM, Percents & Positions, and Voltages each get their own subplot.
3. **Normalized Distributions** — z-scored KDE overlays of the most variable signals, making it easy to see how parameters spread relative to their own means.
4. **Correlation Heatmap** — pairwise correlation of all logged parameters, useful for spotting relationships like *load vs. throttle* or *MAP vs. RPM*.

## Workflow integration

1. In BeeEmUu, connect to your vehicle, pick a profile (e.g. `n54`), start recording, drive, then stop.
2. Click **Export CSV** in the Logging tab.
3. Run `python scripts/chart_playback.py <exported.csv>`.
4. Open the resulting PNG to review the session, share it, or keep it for tuning diagnostics.

## Demo data

`beeemuu_log_n54_demo.csv` is a synthetic 60-second N54 drive cycle (idle → two acceleration runs → idle) generated for testing the script. You can replay it with:

```bash
python scripts/chart_playback.py beeemuu_log_n54_demo.csv -o demo_analysis.png
```

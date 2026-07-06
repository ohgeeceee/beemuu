"""
BeeEmUu Chart Playback — post-drive analysis for logged sessions
Reads BeeEmUu CSV exports and generates rich seaborn visualizations.

Usage:
    python chart_playback.py <csv_file> [--output <png_path>]

Example:
    python chart_playback.py beeemuu-log-2025-01-01T12-00-00.csv --output session_analysis.png
"""
import argparse
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="BeeEmUu post-drive chart playback")
    parser.add_argument("csv", help="Path to a BeeEmUu exported CSV log")
    parser.add_argument("--output", "-o", default="beeemuu_session_analysis.png", help="Output PNG path")
    parser.add_argument("--style", default="darkgrid", choices=["darkgrid", "whitegrid", "ticks", "white"],
                        help="Seaborn style theme")
    parser.add_argument("--width", type=int, default=16, help="Figure width in inches")
    parser.add_argument("--height", type=int, default=10, help="Figure height in inches")
    return parser.parse_args()


def load_csv(path: str):
    import pandas as pd
    df = pd.read_csv(path)
    # Normalize column names: strip units from headers like "Engine speed (rpm)"
    df.columns = [c.strip() for c in df.columns]
    if "time_s" not in df.columns:
        raise ValueError(f"Expected 'time_s' column in CSV. Found: {list(df.columns)}")
    return df


def classify_columns(df):
    """Classify non-time columns into temperature, pressure, speed, percent, voltage, and generic."""
    temps, pressures, speeds, percents, volts, generics = [], [], [], [], [], []
    for col in df.columns:
        if col == "time_s":
            continue
        lc = col.lower()
        if "temp" in lc or "°c" in lc or "coolant" in lc or "oil" in lc or "iat" in lc:
            temps.append(col)
        elif "pressure" in lc or "kpa" in lc or "baro" in lc or "map" in lc or "rail" in lc or "boost" in lc:
            pressures.append(col)
        elif "speed" in lc or "rpm" in lc or "km/h" in lc:
            speeds.append(col)
        elif "%" in lc or "load" in lc or "throttle" in lc:
            percents.append(col)
        elif "volt" in lc or "v)" in lc:
            volts.append(col)
        else:
            generics.append(col)
    return temps, pressures, speeds, percents, volts, generics


def build_figure(df, args):
    import pandas as pd
    import seaborn as sns
    import matplotlib.pyplot as plt
    import matplotlib.gridspec as gridspec
    import numpy as np

    sns.set_theme(style=args.style, palette="husl")

    temps, pressures, speeds, percents, volts, generics = classify_columns(df)
    all_series = temps + pressures + speeds + percents + volts + generics

    # Determine grid layout based on what we have
    n_series = len(all_series)
    has_data = n_series > 0

    # Build a figure with a custom grid:
    # Top: summary stats panel
    # Middle: time-series line plots (tall)
    # Bottom: distribution plots + correlation heatmap
    fig = plt.figure(figsize=(args.width, args.height))
    gs = gridspec.GridSpec(3, 3, height_ratios=[1.2, 2.5, 2.0], hspace=0.35, wspace=0.3)

    # ---- Summary text panel (top, spans all columns) ----
    ax_summary = fig.add_subplot(gs[0, :])
    ax_summary.axis("off")

    duration = df["time_s"].iloc[-1] - df["time_s"].iloc[0]
    samples = len(df)
    rate = samples / duration if duration > 0 else 0

    summary_lines = [
        f"BeeEmUu  ·  Post-Drive Session Analysis",
        f"Duration: {duration:.1f}s  ·  Samples: {samples}  ·  Effective rate: {rate:.1f} Hz",
    ]
    if n_series > 0:
        summary_lines.append(f"Parameters logged: {n_series}")

    # Parameter min/max/mean summary
    stats_rows = []
    for col in all_series:
        vals = df[col].dropna()
        if len(vals) == 0:
            continue
        stats_rows.append({
            "Parameter": col,
            "Min": f"{vals.min():.2f}",
            "Max": f"{vals.max():.2f}",
            "Mean": f"{vals.mean():.2f}",
            "Std": f"{vals.std():.2f}",
        })

    if stats_rows:
        stats_df = pd.DataFrame(stats_rows)
        stats_text = stats_df.to_string(index=False)
    else:
        stats_text = "No numeric data available."

    ax_summary.text(0.02, 0.95, "\n".join(summary_lines), transform=ax_summary.transAxes,
                    fontsize=13, fontweight="bold", va="top", color="#2c3e50")
    ax_summary.text(0.02, 0.55, stats_text, transform=ax_summary.transAxes,
                    fontsize=8, va="top", fontfamily="monospace", color="#34495e")
    ax_summary.set_title("Session Summary", loc="left", fontsize=11, color="#7f8c8d")

    # ---- Time-series plots (middle row) ----
    # We use a color palette that maps to each series for consistency
    palette = sns.color_palette("husl", n_series)
    color_map = {all_series[i]: palette[i] for i in range(n_series)}

    # Group series into subplots by category
    groups = [
        ("Temperatures (°C)", temps),
        ("Pressures (kPa)", pressures),
        ("Speeds & RPM", speeds),
        ("Percents & Positions", percents),
        ("Voltages & Others", volts + generics),
    ]
    # Only keep non-empty groups
    groups = [(title, cols) for title, cols in groups if cols]
    n_groups = len(groups)

    if n_groups == 0:
        ax_ts = fig.add_subplot(gs[1, :])
        ax_ts.text(0.5, 0.5, "No time-series data found.", ha="center", va="center", transform=ax_ts.transAxes)
        ax_ts.set_axis_off()
    else:
        # Allocate middle row: one subplot per group, up to 3 wide
        for idx, (title, cols) in enumerate(groups):
            col_idx = idx % 3
            row_idx = 1 + (idx // 3)  # if more than 3 groups, we spill but we only have 1 middle row in this grid
            # For simplicity, keep to the single middle row (3 slots)
            if idx >= 3:
                break
            ax = fig.add_subplot(gs[1, col_idx])
            for c in cols:
                sns.lineplot(data=df, x="time_s", y=c, ax=ax, color=color_map[c], label=c, legend=False)
            ax.set_title(title, fontsize=10)
            ax.set_xlabel("Time (s)", fontsize=8)
            ax.set_ylabel("")
            ax.tick_params(labelsize=7)
            # Thin legend if many lines
            if len(cols) > 4:
                ax.legend(fontsize=6, loc="upper left", frameon=True, fancybox=True, shadow=True)
            else:
                ax.legend(fontsize=7, loc="upper left", frameon=True)

        # If there are leftover groups, add them to the remaining middle-row slots
        for idx in range(n_groups, 3):
            ax = fig.add_subplot(gs[1, idx])
            ax.set_axis_off()

    # ---- Bottom row: distributions + correlation ----
    # Left two columns: KDE/dist plots for the most interesting signals
    # Right column: correlation heatmap of all numeric parameters

    ax_dist = fig.add_subplot(gs[2, :2])
    ax_corr = fig.add_subplot(gs[2, 2])

    # Distribution plot (ridge-like overlapping KDEs, normalized)
    if n_series > 0:
        # Pick up to 5 most variable series for the distribution panel
        variances = []
        for col in all_series:
            vals = df[col].dropna()
            if len(vals) > 1:
                variances.append((col, vals.std()))
        variances.sort(key=lambda x: x[1], reverse=True)
        top_cols = [c for c, _ in variances[:5]]

        if top_cols:
            # Normalize each series to 0-1 for overlay comparison, then plot
            for col in top_cols:
                vals = df[col].dropna()
                if len(vals) < 2:
                    continue
                # Standardize for overlay view
                z = (vals - vals.mean()) / (vals.std() + 1e-9)
                sns.kdeplot(z, ax=ax_dist, color=color_map[col], label=col, fill=True, alpha=0.15, linewidth=1.5)
            ax_dist.set_title("Normalized Distributions (z-score)", fontsize=10)
            ax_dist.set_xlabel("Standard deviations", fontsize=8)
            ax_dist.set_ylabel("Density", fontsize=8)
            ax_dist.tick_params(labelsize=7)
            ax_dist.legend(fontsize=7, loc="upper right", frameon=True)
    else:
        ax_dist.set_axis_off()

    # Correlation heatmap
    numeric_df = df[all_series].dropna(how="all")
    if len(numeric_df.columns) > 1 and len(numeric_df) > 2:
        corr = numeric_df.corr()
        # Mask upper triangle for cleaner look
        mask = np.triu(np.ones_like(corr, dtype=bool), k=1)
        sns.heatmap(corr, mask=mask, annot=True, fmt=".2f", cmap="RdBu_r", center=0,
                    ax=ax_corr, square=True, linewidths=0.5, cbar_kws={"shrink": 0.6},
                    annot_kws={"size": 6})
        ax_corr.set_title("Correlation", fontsize=10)
        ax_corr.tick_params(labelsize=6, rotation=45)
    else:
        ax_corr.set_axis_off()

    fig.suptitle("BeeEmUu  ·  Chart Playback  ·  Post-Drive Analysis", fontsize=14, fontweight="bold", y=0.98)
    return fig


def main():
    args = parse_args()
    df = load_csv(args.csv)
    fig = build_figure(df, args)
    fig.savefig(args.output, dpi=150, bbox_inches="tight", facecolor="white")
    print(f"Saved: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

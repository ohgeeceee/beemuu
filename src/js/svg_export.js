"use strict";

// SVG export for the logging chart and the histogram.
//
// Why hand-rolled: Chart.js renders to canvas (no `toSVG()`), and the
// standard solutions (`canvas2svg.js`, `chartjs-plugin-svg-export`) pull a
// runtime dependency. For "share the trace" — paste a chart into a forum
// post — a faithful vector rendered from the same data the canvas is
// drawing is the goal; pixel-perfect mirror is not. A future contributor
// can swap in a plugin if pixel parity becomes a real user need.
//
// Pure data layer: the functions take the chart's `data` / `options`
// (already in memory after `new Chart(...)`) and return a self-contained
// `<svg>...</svg>` string. No DOM, no Chart.js, no globals — so the
// tests under `src/js/svg_export.test.js` can run with node --test
// without any browser shim.

/**
 * Build an SVG string for the logging chart (line chart, multiple series).
 *
 * @param {{data: {datasets: Array<{label: string, data: Array<{x: number, y: number}>, borderColor: string}>}, options?: object}} chart
 *   Pass the live `logChart` instance. Only the data shape is consulted.
 * @param {{width?: number, height?: number}} [opts]
 * @returns {string} Self-contained `<svg>` XML.
 */
function chartToSvg(chart, opts) {
  if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) return "";
  const datasets = chart.data.datasets.filter((d) => Array.isArray(d.data) && d.data.length > 0);
  if (datasets.length === 0) return "";

  const width = (opts && opts.width) || 900;
  const height = (opts && opts.height) || 360;
  const m = { top: 24, right: 24, bottom: 44, left: 56 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // Data bounds: x across all series (time, seconds), y across all points.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const d of datasets) {
    for (const p of d.data) {
      if (typeof p.x !== "number" || !Number.isFinite(p.x)) continue;
      if (typeof p.y !== "number" || !Number.isFinite(p.y)) continue;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin === xMax) return "";
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return "";
  // Pad y range by 5% so points don't kiss the axes.
  const yPad = (yMax - yMin) * 0.05 || 1;
  yMin -= yPad;
  yMax += yPad;

  const xToPx = (x) => m.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const yToPx = (y) => m.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // Build ticks: 5 evenly spaced on each axis.
  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);

  // SVG primitives — note the explicit XML decl so the file opens cleanly
  // when dragged into a browser (otherwise some renderers default to
  // HTML parsing and ignore the <svg> root).
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="11">`);
  // White background — matches Chart.js's default canvas surface so a
  // pasted forum screenshot looks the same as the in-app chart.
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  // Plot frame
  out.push(`<rect x="${m.left}" y="${m.top}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#cccccc" stroke-width="1"/>`);

  // Y gridlines + labels
  for (const t of yTicks) {
    const py = yToPx(t);
    out.push(`<line x1="${m.left}" y1="${py.toFixed(2)}" x2="${m.left + plotW}" y2="${py.toFixed(2)}" stroke="#e5e5e5" stroke-width="1"/>`);
    out.push(`<text x="${m.left - 6}" y="${(py + 3).toFixed(2)}" text-anchor="end" fill="#444444">${formatTick(t)}</text>`);
  }
  // X gridlines + labels
  for (const t of xTicks) {
    const px = xToPx(t);
    out.push(`<line x1="${px.toFixed(2)}" y1="${m.top}" x2="${px.toFixed(2)}" y2="${m.top + plotH}" stroke="#e5e5e5" stroke-width="1"/>`);
    out.push(`<text x="${px.toFixed(2)}" y="${m.top + plotH + 14}" text-anchor="middle" fill="#444444">${formatTick(t)}</text>`);
  }
  // Axis titles
  out.push(`<text x="${m.left + plotW / 2}" y="${height - 8}" text-anchor="middle" fill="#444444">seconds</text>`);
  out.push(`<text x="12" y="${m.top + plotH / 2}" text-anchor="middle" fill="#444444" transform="rotate(-90 12 ${m.top + plotH / 2})">value</text>`);

  // Series polylines
  for (const d of datasets) {
    const color = d.borderColor || "#4da3ff";
    const pts = [];
    for (const p of d.data) {
      if (typeof p.x !== "number" || typeof p.y !== "number") continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      pts.push(`${xToPx(p.x).toFixed(2)},${yToPx(p.y).toFixed(2)}`);
    }
    if (pts.length > 0) {
      out.push(`<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts.join(" ")}"/>`);
    }
  }

  // Legend (one entry per non-empty series; a coloured swatch + the label).
  // `legendY` is declared above both branches so the single-series branch
  // can reference it without a TDZ ReferenceError.
  const legendY = 8;
  if (datasets.length > 1) {
    let lx = m.left;
    for (const d of datasets) {
      const text = d.label || "";
      const w = Math.max(40, text.length * 6 + 18);
      out.push(`<rect x="${lx}" y="${legendY}" width="10" height="10" fill="${d.borderColor || "#4da3ff"}"/>`);
      out.push(`<text x="${lx + 14}" y="${legendY + 9}" fill="#222222">${escapeXml(text)}</text>`);
      lx += w;
    }
  } else if (datasets.length === 1) {
    const text = datasets[0].label || "";
    out.push(`<text x="${m.left}" y="${legendY + 9}" fill="#222222">${escapeXml(text)}</text>`);
  }

  out.push(`</svg>`);
  return out.join("");
}

/**
 * Build an SVG string for the histogram (bar chart, single series).
 *
 * @param {{labels: string[], counts: number[], axisLabel?: string, unit?: string}} input
 * @param {{width?: number, height?: number}} [opts]
 * @returns {string} Self-contained `<svg>` XML.
 */
function histogramToSvg(input, opts) {
  if (!input || !Array.isArray(input.labels) || !Array.isArray(input.counts)) return "";
  if (input.labels.length === 0 || input.labels.length !== input.counts.length) return "";
  if (input.counts.every((c) => c === 0)) {
    // Empty distribution — still render the frame so a user can see "no samples".
  }

  const width = (opts && opts.width) || 720;
  const height = (opts && opts.height) || 360;
  const m = { top: 24, right: 24, bottom: 64, left: 56 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const yMax = Math.max(1, ...input.counts);
  const n = input.labels.length;
  // Gap between bars — narrower as the bin count grows so it stays readable.
  const gap = n <= 10 ? 4 : n <= 30 ? 2 : 1;
  const barW = Math.max(1, (plotW - gap * (n - 1)) / n);

  const yTicks = niceTicks(0, yMax, 5);

  const yToPx = (v) => m.top + plotH - (v / yMax) * plotH;
  const xToPx = (i) => m.left + i * (barW + gap);

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="11">`);
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  out.push(`<rect x="${m.left}" y="${m.top}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#cccccc" stroke-width="1"/>`);

  // Y gridlines + labels
  for (const t of yTicks) {
    const py = yToPx(t);
    out.push(`<line x1="${m.left}" y1="${py.toFixed(2)}" x2="${m.left + plotW}" y2="${py.toFixed(2)}" stroke="#e5e5e5" stroke-width="1"/>`);
    out.push(`<text x="${m.left - 6}" y="${(py + 3).toFixed(2)}" text-anchor="end" fill="#444444">${formatTick(t)}</text>`);
  }
  // Axis titles
  out.push(`<text x="${m.left + plotW / 2}" y="${height - 8}" text-anchor="middle" fill="#444444">${escapeXml(input.axisLabel || "value")}</text>`);
  out.push(`<text x="12" y="${m.top + plotH / 2}" text-anchor="middle" fill="#444444" transform="rotate(-90 12 ${m.top + plotH / 2})">samples</text>`);

  // Bars
  for (let i = 0; i < n; i++) {
    const c = input.counts[i] || 0;
    if (c === 0) continue; // skip empty bars so the axis shows through
    const x = xToPx(i);
    const h = (c / yMax) * plotH;
    const y = m.top + plotH - h;
    out.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="#4da3ff"/>`);
  }
  // X-axis labels — every Nth so they don't overlap. For <=12 bins show all.
  const labelStep = n <= 12 ? 1 : Math.ceil(n / 8);
  for (let i = 0; i < n; i += labelStep) {
    const x = xToPx(i) + barW / 2;
    out.push(`<text x="${x.toFixed(2)}" y="${m.top + plotH + 14}" text-anchor="middle" fill="#444444">${escapeXml(input.labels[i])}</text>`);
  }

  out.push(`</svg>`);
  return out.join("");
}

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Generate `count` evenly-spaced tick values in [min, max], rounded to a
 * "nice" step (1, 2, 2.5, 5 × 10^k). No `d3-scale` available — keep it
 * dependency-free.
 */
function niceTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const out = [];
  // Guard against float drift causing infinite loops.
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    out.push(Number(v.toFixed(10)));
    if (out.length > count + 4) break;
  }
  return out;
}

/**
 * "Nice number" algorithm from Heckbert (1990). `round` controls whether
 * the result is rounded to a clean step (true) or just spaced (false).
 */
function niceNum(range, round) {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

/**
 * Format a tick value: drop trailing zeros, cap at 4 significant digits
 * so a y-axis with values like 0.0000123 doesn't read as a wall of digits.
 */
function formatTick(v) {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.001) return v.toExponential(1);
  // 4 significant digits, trimmed.
  return Number(v.toPrecision(4)).toString();
}

/**
 * Escape XML special chars so a label that contains `<` or `&` doesn't
 * produce malformed SVG. Chart.js labels are user-controlled (DID names,
 * units, fault codes), so this is worth doing correctly.
 */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Dual export — works under both `node --test` (CommonJS) and the
// Tauri webview (plain `<script>` tag, no module loader).
//
// In Node, `module.exports = …` attaches to the CommonJS module
// record and is reachable via `require()` from the test file.
//
// In the browser, `module` is undefined; the assignment would throw
// a ReferenceError. We guard with `typeof module`, and as a
// belt-and-suspenders fallback also expose `window.beeemuuSvg` so
// the renderer (main.js) can call `beeemuuSvg.chartToSvg` without
// a module loader.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { chartToSvg, histogramToSvg };
}
if (typeof window !== "undefined") {
  window.beeemuuSvg = { chartToSvg, histogramToSvg };
}

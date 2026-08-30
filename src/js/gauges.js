/* Canvas gauge rendering — round dial gauges, dark cockpit style. */

/* Default cockpit palette. Every key can be overridden per-profile via
 * the `[profile.theme]` TOML table (see docs/DECODE_FUNCTIONS.md § 9);
 * `resolveThemeColors` merges a profile's overrides onto these defaults,
 * so a theme block only needs to name the keys it changes. */
const GAUGE_COLOR_DEFAULTS = {
  dial: "#0b1119",     // dial face fill
  dialEdge: "#2a3a4e", // dial face rim
  track: "#243447",    // arc background track
  arc: "#4da3ff",      // filled arc up to the value
  arcHot: "#e05545",   // filled arc beyond 85% of range
  tick: "#5d7288",     // tick marks
  needle: "#ff7d33",   // needle + centre pivot
  readout: "#e8f0f8",  // numeric readout / enum text
  unit: "#7d92a8",     // unit caption
};

/* A colour string is accepted only when the platform CSS engine parses
 * it (`CSS.supports`). Outside the browser (Node tests) any non-empty
 * string passes — theme loading is best-effort and a bad colour is a
 * cosmetic issue, never fatal. */
function validGaugeColor(x) {
  if (typeof x !== "string" || x.length === 0) return false;
  if (typeof CSS !== "undefined" && CSS.supports) return CSS.supports("color", x);
  return true;
}

/* Merge `[profile.theme]` overrides onto the defaults. Unknown keys are
 * ignored (a theme may carry keys from a newer app version) and invalid
 * colour strings fall back to the default for that key. */
function resolveThemeColors(overrides) {
  const out = { ...GAUGE_COLOR_DEFAULTS };
  if (overrides && typeof overrides === "object") {
    for (const k of Object.keys(GAUGE_COLOR_DEFAULTS)) {
      if (validGaugeColor(overrides[k])) out[k] = overrides[k];
    }
  }
  return out;
}

class Gauge {
  constructor(canvas, { label, unit, min, max, colors }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.label = label;
    this.unit = unit;
    this.min = min;
    this.max = max;
    this.colors = resolveThemeColors(colors);
    this.value = min;
    this.displayed = min; // eased value for smooth needle motion
    this.textOverride = null; // when set, dial/needle is hidden and the
                              // label is rendered as the big readout
                              // instead of the numeric value.
    canvas.width = 220;
    canvas.height = 180;
    this.draw();
  }

  /* `text` is the optional enum label (e.g. "3rd", "Running") from
   * `LiveValue.text`. When present, the gauge enters text mode: dial,
   * ticks, and needle are hidden and the label takes the centre stage.
   * Numeric path is unchanged. */
  set(value, text) {
    if (text !== undefined && text !== null) {
      if (this.textOverride !== text) {
        this.textOverride = String(text);
        this.draw();
      }
      return;
    }
    this.textOverride = null;
    this.value = Math.max(this.min, Math.min(this.max, value));
    // Shared with the test harness (`src/js/test/live_format.test.cjs`)
    // and the CSV exporter in main.js. Keep the rule in one place.
    this.value = window.LiveFormat.clampGaugeValue(value, this.min, this.max);
  }

  /* Called on an animation loop: ease displayed value toward target.
   * Text mode skips easing — labels are discrete, not numeric. */
  tick() {
    if (this.textOverride !== null) return;
    const diff = this.value - this.displayed;
    if (Math.abs(diff) > 0.001) {
      this.displayed += diff * 0.18;
      this.draw();
    }
  }

  draw() {
    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2 + 14, r = 74;
    const C = this.colors; // resolved theme palette (defaults + [profile.theme])

    ctx.clearRect(0, 0, W, H);

    // Dial face is the only piece shared between numeric and text
    // modes; everything else depends on which mode we're in.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = C.dial;
    ctx.fill();
    ctx.strokeStyle = C.dialEdge;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (this.textOverride !== null) {
      // Text mode: a centered label with a smaller unit/description row.
      // Font auto-shrinks long labels (e.g. "Cranking") so they fit.
      // Severity-bearing labels (Light / Moderate / Severe / etc.)
      // get a coloured fillStyle so the eye lands on them
      // immediately. Pure JS, no CSS dependency — colours live in
      // the canvas layer. The CSS class is also surfaced for the
      // Logging-tab channel label via the gauge's container
      // element (handled by main.js, not here).
      // Severity colours are semantic and stay fixed across themes;
      // only the neutral readout/unit colours follow [profile.theme].
      let fontPx = 22;
      const sev = window.LiveFormat.severityClass(this.textOverride);
      if (sev === "severity-critical") ctx.fillStyle = "#e05545";
      else if (sev === "severity-warning") ctx.fillStyle = "#f4b400";
      else ctx.fillStyle = C.readout;
      ctx.textAlign = "center";
      while (fontPx > 12) {
        ctx.font = `600 ${fontPx}px 'Segoe UI', sans-serif`;
        if (ctx.measureText(this.textOverride).width <= r * 1.6) break;
        fontPx -= 2;
      }
      ctx.fillText(this.textOverride, cx, cy + 8);
      ctx.fillStyle = C.unit;
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillText(this.unit, cx, cy + 30);
      // Persist the severity class on the canvas's parent element
      // so the Logging-tab channel label can pick it up via CSS.
      // The canvas itself doesn't carry a class; the gauge's
      // container (set by main.js when it instantiates the
      // gauge) holds the class for CSS targeting.
      if (this.canvas && this.canvas.parentElement) {
        this.canvas.parentElement.classList.remove(
          "severity-critical",
          "severity-warning",
        );
        if (sev) this.canvas.parentElement.classList.add(sev);
      }
      return;
    }

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270° sweep

    // arc track
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.strokeStyle = C.track;
    ctx.lineWidth = 8;
    ctx.stroke();

    // filled arc up to value
    const frac = (this.displayed - this.min) / (this.max - this.min);
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    ctx.strokeStyle = frac > 0.85 ? C.arcHot : C.arc;
    ctx.lineWidth = 8;
    ctx.stroke();

    // ticks
    ctx.strokeStyle = C.tick;
    ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + ((a1 - a0) * i) / 10;
      const inner = i % 5 === 0 ? r - 16 : r - 11;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (r - 5), cy + Math.sin(a) * (r - 5));
      ctx.stroke();
    }

    // needle
    const av = a0 + (a1 - a0) * frac;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(av) * 12, cy - Math.sin(av) * 12);
    ctx.lineTo(cx + Math.cos(av) * (r - 18), cy + Math.sin(av) * (r - 18));
    ctx.strokeStyle = C.needle;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = C.needle;
    ctx.fill();

    // numeric readout
    const digits = this.max - this.min > 50 ? 0 : 1;
    ctx.fillStyle = C.readout;
    ctx.font = "600 22px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.displayed.toFixed(digits), cx, cy + 44);
    ctx.fillStyle = C.unit;
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillText(this.unit, cx, cy + 58);
  }
}

/* Standardised dual export (same pattern as live_format.js): CommonJS
 * for Node tests, window global for the browser <script>. The class
 * body is inert until constructed, so requiring this file under Node
 * without a DOM is safe. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { Gauge, resolveThemeColors, GAUGE_COLOR_DEFAULTS };
}
if (typeof window !== "undefined") {
  window.Gauge = Gauge;
}

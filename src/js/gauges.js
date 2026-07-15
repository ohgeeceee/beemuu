/* Canvas gauge rendering — round dial gauges, dark cockpit style. */

class Gauge {
  constructor(canvas, { label, unit, min, max }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.label = label;
    this.unit = unit;
    this.min = min;
    this.max = max;
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

    ctx.clearRect(0, 0, W, H);

    // Dial face is the only piece shared between numeric and text
    // modes; everything else depends on which mode we're in.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1119";
    ctx.fill();
    ctx.strokeStyle = "#2a3a4e";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (this.textOverride !== null) {
      // Text mode: a centered label with a smaller unit/description row.
      // Font auto-shrinks long labels (e.g. "Cranking") so they fit.
      let fontPx = 22;
      ctx.fillStyle = "#e8f0f8";
      ctx.textAlign = "center";
      while (fontPx > 12) {
        ctx.font = `600 ${fontPx}px 'Segoe UI', sans-serif`;
        if (ctx.measureText(this.textOverride).width <= r * 1.6) break;
        fontPx -= 2;
      }
      ctx.fillText(this.textOverride, cx, cy + 8);
      ctx.fillStyle = "#7d92a8";
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillText(this.unit, cx, cy + 30);
      return;
    }

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270° sweep

    // arc track
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.strokeStyle = "#243447";
    ctx.lineWidth = 8;
    ctx.stroke();

    // filled arc up to value
    const frac = (this.displayed - this.min) / (this.max - this.min);
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    ctx.strokeStyle = frac > 0.85 ? "#e05545" : "#4da3ff";
    ctx.lineWidth = 8;
    ctx.stroke();

    // ticks
    ctx.strokeStyle = "#5d7288";
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
    ctx.strokeStyle = "#ff7d33";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff7d33";
    ctx.fill();

    // numeric readout
    const digits = this.max - this.min > 50 ? 0 : 1;
    ctx.fillStyle = "#e8f0f8";
    ctx.font = "600 22px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.displayed.toFixed(digits), cx, cy + 44);
    ctx.fillStyle = "#7d92a8";
    ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillText(this.unit, cx, cy + 58);
  }
}

window.Gauge = Gauge;

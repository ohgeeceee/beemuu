"use strict";

/* Demo Scenarios — v3.1 groundwork.
 *
 * The v3 features all need a log to work on, and there is no way to see them
 * work without a car. That is a real problem for three audiences at once:
 *
 *   - A contributor cannot tell whether a change to an engine did anything,
 *     because no engine has ever run against known data.
 *   - A reviewer cannot evaluate a feature without reimplementing it against
 *     hand-made numbers.
 *   - The landing page can describe these features but cannot show them, and a
 *     feature nobody can see is a feature nobody believes.
 *
 * The simulator is the answer, but the simulator is a *transport* — it answers
 * DIDs, and the v3 engines all consume log series. This module sits between
 * them: it produces a realistic log series for a named scenario, so an engine
 * can be pointed at a known answer without a car anywhere in sight.
 *
 * Every scenario is built around a **known ground truth**, and that is the
 * point rather than a nicety: the misfire scenario asserts that the classifier
 * returns `high_load_ignition`, and the drift scenario asserts a rising trim.
 * An engine that quietly stops finding the answer it was built to find fails
 * the test. A demo that merely produces plausible-looking numbers proves
 * nothing at all.
 *
 * The data is deliberately *imperfect*:
 *
 *   - **Channels are sampled at different rates.** A real logger does not read
 *     every PID on the same tick, and an engine that assumed aligned samples
 *     would pass here and fail on a car. This is exactly the bug class that
 *     cost real debugging time in feature 1.
 *   - **Values carry noise and dropouts.** A missing sample is absent from the
 *     array, not a zero; an engine that treats a dropout as 0 °C will invent
 *     faults.
 *   - **The misfires are sparse and lumpy.** Real misfire counts arrive in
 *     bursts, not evenly.
 *
 * Pure: no DOM, no transport, no clock of its own. A caller passes `t0` and a
 * seed and gets the same log every time.
 */

(function (root) {
  "use strict";

  /* Deterministic pseudo-randomness. `Math.random()` would make every scenario
   * test flaky; a seeded LCG makes a failure reproducible from the seed alone,
   * which is what you want at 2am. */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function next() {
      // Numerical Recipes LCG: adequate for noise, identical everywhere.
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /**
   * Build a log session: Map<id, {id, label, unit, data:[{x, y}]}>.
   *
   * This is the exact shape `window.beeemuuV3.logSeries()` returns and the
   * exact shape `csv_log_export.js` writes, so a scenario can be fed to an
   * engine, a panel or a CSV export with no conversion in between.
   *
   * @param {Object} spec
   * @param {Array}  spec.channels  [{id, label, unit, hz, points: fn(t, rand)}]
   * @param {number} [spec.duration] seconds
   * @param {number} [spec.seed]
   * @param {number} [spec.dropout] probability a sample is dropped (default 0.02)
   */
  function buildSession(spec) {
    const o = spec || {};
    const duration = o.duration || 120;
    const rand = rng(o.seed == null ? 42 : o.seed);
    const dropout = o.dropout == null ? 0.02 : o.dropout;

    const session = new Map();
    for (const ch of (o.channels || [])) {
      if (!ch || !ch.id) continue;
      const step = 1 / (ch.hz || 10);
      const data = [];
      for (let t = 0; t <= duration; t += step) {
        // A dropout is a missing sample, not a zero. Skipping the entry is what
        // a logger does when a read fails, and an engine that conflates the two
        // invents a fault out of a comms error.
        if (rand() < dropout) continue;
        const value = ch.points(t, rand);
        if (value == null || !Number.isFinite(value)) continue;
        data.push({ x: t, y: value });
      }
      session.set(ch.id, {
        id: ch.id,
        label: ch.label || ch.id,
        unit: ch.unit || "",
        data,
      });
    }
    return session;
  }

  /* A shared drive cycle: idle -> cruise -> full pull -> overrun -> settle.
   * Every scenario uses it so a misfire log and a tuning log are comparable
   * and neither is a special case. */
  function driveCycle(t) {
    if (t < 8) return { rpm: 780 + Math.sin(t * 2) * 25, load: 14 + Math.sin(t) * 3 };
    if (t < 38) return { rpm: 2200 + Math.sin(t * 0.7) * 180, load: 34 + Math.sin(t * 0.5) * 6 };
    if (t < 46) return { rpm: 1500, load: 22 };
    if (t < 86) {
      // Full pull: load ramps hard, revs climb.
      const p = (t - 46) / 40;
      return { rpm: 1500 + p * 5200, load: 70 + p * 24 };
    }
    if (t < 96) return { rpm: 6700 - (t - 86) * 120, load: 40 };
    const p = Math.min(1, (t - 96) / 24);
    return { rpm: 1800 * (1 - p) + 780 * p, load: 22 * (1 - p) + 12 * p };
  }

  function baseChannels(getState, opts) {
    const o = opts || {};
    const jitter = o.jitter == null ? 1.2 : o.jitter;
    return [
      { id: "rpm", label: "Engine speed", unit: "rpm", hz: 10,
        points: (t, r) => Math.max(0, getState(t).rpm + (r() - 0.5) * jitter * 6) },
      { id: "load", label: "Engine load", unit: "%", hz: 5,
        points: (t, r) => Math.max(0, getState(t).load + (r() - 0.5) * jitter) },
      // Slower channels on purpose: real loggers do not poll every PID at the
      // same rate, and an engine that assumes aligned samples breaks here.
      { id: "coolant", label: "Coolant temp", unit: "°C", hz: 2,
        points: (t) => 20 + (98 - 20) * (1 - Math.exp(-t / 55)) },
      { id: "oilTemp", label: "Oil temp", unit: "°C", hz: 1,
        points: (t) => 18 + (105 - 18) * (1 - Math.exp(-t / 95)) },
      { id: "intakeTemp", label: "Intake air temp", unit: "°C", hz: 1,
        points: (t) => 28 + Math.sin(t * 0.3) * 3 },
      { id: "lambda", label: "Lambda", unit: "", hz: 5,
        points: (t, r) => Math.max(0.5, 1 + (r() - 0.5) * 0.03 - (getState(t).load > 80 ? 0.08 : 0)) },
      { id: "vehicleSpeed", label: "Vehicle speed", unit: "km/h", hz: 2,
        points: (t) => Math.max(0, getState(t).rpm * 0.045 + Math.sin(t) * 2) },
      { id: "knockRetard", label: "Knock retard", unit: "°", hz: 5,
        points: (t) => {
          // Knock appears only at high load, and a stock engine retards very
          // little. That difference is what the fingerprint detector looks for.
          return getState(t).load > 78 ? (o.retard == null ? 0.6 : o.retard) + Math.abs(Math.sin(t)) * 0.4 : 0;
        } },
    ];
  }

  /* ================================================================= *
   * 1 — a high-load ignition misfire on cylinder 3
   * ================================================================= */
  function highLoadMisfire(opts) {
    const o = opts || {};
    const channels = baseChannels(driveCycle, o);
    channels.push({
      id: "misfireCyl3", label: "Misfire cyl 3", unit: "", hz: 20,
      // Only during the *upper* part of the pull — above the 4000 rpm line the
      // classifier tests on — and arriving in bursts rather than evenly. The
      // window starts at 62s, not at the start of the pull, because a misfire
      // at 1500 rpm under 70% load is a different fault and the scenario must
      // not accidentally describe two problems at once.
      points: (t) => {
        if (t < 62 || t > 86) return 0;
        return Math.sin(t * 3.3) > 0.4 && Math.sin(t * 11) > 0 ? 1 : 0;
      },
    });
    return {
      id: "high_load_misfire",
      title: "Cylinder 3 misfires only under high load",
      description: "The canonical intermittent: the coil is fine at idle and warm, and fails above 4000 rpm under load.",
      expect: { engine: "misfire_patterns", pattern: "high_load_ignition", cylinder: 3 },
      session: buildSession(Object.assign({ channels, seed: 7 }, o)),
    };
  }

  /* ================================================================= *
   * 2 — a stock engine, for the tuning fingerprint
   * ================================================================= */
  function stockEngine(opts) {
    const o = opts || {};
    return {
      id: "stock_engine",
      title: "A stock engine, logged over a full pull",
      description: "Same drive cycle, no deviation. A fingerprint comparison against this must report nothing.",
      expect: { engine: "tuning_fingerprint", is_tuned: false },
      session: buildSession(Object.assign({
        channels: baseChannels(driveCycle, o), seed: 11, duration: 100,
      }, o)),
    };
  }

  /* ================================================================= *
   * 3 — a long-term fuel trim walking toward its limit
   * ================================================================= */
  function driftingFuelTrim(opts) {
    const o = opts || {};
    const base = Date.UTC(2026, 0, 1);
    const DAY = 86400000;
    // Eight readings over four months. The final value sits at 95% of the
    // threshold, which is the interesting case: the trim is not yet over the
    // line, so the engine must call it `watch` and project a crossing date.
    // A scenario that ended comfortably inside the limit would report `ok`,
    // which is correct behaviour and a useless demonstration.
    const values = [6, 8, 10, 12, 14, 16, 17.5, 19];
    const sessions = [];
    for (let i = 0; i < values.length; i++) {
      const t0 = base + i * 15 * DAY;
      const value = values[i];
      sessions.push({
        taken_at: new Date(t0).toISOString(),
        value,
        channels: [{ id: "ltft", label: "LTFT bank 1", unit: "%", hz: 1, points: () => value }],
      });
    }
    return {
      id: "drifting_fuel_trim",
      title: "A fuel trim walking steadily toward its limit",
      description: "Eight readings over four months, climbing to 95% of its limit. Nothing is broken yet; that is the point — this is the earliest honest signal a DME gives.",
      expect: { engine: "adaptation_drift", severity: "watch", crossing: true },
      // The scenario carries its own `now`, two days after the last reading.
      // The caller should not have to supply it: `now` decides whether the
      // projected crossing is in the future, and at 0.126 points/day from 19
      // the limit is ~8 days out. A `now` any later than that correctly
      // projects nothing, which is not what this scenario demonstrates.
      now: base + 7 * 15 * DAY + 2 * DAY,
      histories: {
        ltft: sessions.map(s => ({ t: Date.parse(s.taken_at), value: s.value })),
      },
      meta: { ltft: { id: "ltft", label: "Long-term fuel trim", unit: "%", threshold: 20 } },
      sessions,
    };
  }

  /* ================================================================= *
   * 4 — two snapshots proving a DME was reprogrammed
   * ================================================================= */
  function reflashedDme(opts) {
    const o = opts || {};
    const base = Date.UTC(2026, 0, 1);
    const snap = (when, count, version) => ({
      taken_at: new Date(when).toISOString(),
      modules: [
        { address: 0x12, name: "DME", flash_count: count,
          software_version: version, ident: "MEVD17.2.42-S0000000" },
        { address: 0x60, name: "TCM", flash_count: 1, software_version: "GS8.0.2.1" },
        { address: 0xD0, name: "ABS", flash_count: 0, software_version: "DSC_8.4.1" },
      ],
    });
    // Forty days apart, so they count as separate visits rather than one session.
    const snapshots = [
      snap(base, 1, "MEVD17.2.40"),
      snap(base + 40 * 86400000, 2, "MEVD17.2.44"),
    ];
    return {
      id: "reflashed_dme",
      title: "A DME that was reprogrammed between two snapshots",
      description: "The used-car case: a flash counter moved and the software version changed, while the other modules did not.",
      expect: { engine: "flash_audit", flashed: 1, module: "DME" },
      snapshots,
    };
  }

  /* ================================================================= *
   * 5 — a cold start that stumbles and clears
   * ================================================================= */
  function coldStartStumble(opts) {
    const o = opts || {};
    // The engine sits cold and off for COLD_SOAK_S before the driver turns the
    // key. That duration is not arbitrary: the monitor refuses to arm until the
    // engine has been off and cold for a full minute, precisely so a
    // stop-start in traffic is not mistaken for a cold start. A scenario whose
    // cold window is shorter than that soak can never exercise the feature, and
    // a scenario that fudges the monitor's minimum to fit is worse than none.
    const COLD_SOAK_S = 120;
    const coldState = (t) => (t < COLD_SOAK_S
      ? { rpm: 720 + Math.sin(t * 6) * 45, load: 18 + Math.sin(t * 5) * 7 }
      : { rpm: 780 + Math.sin(t * 2) * 20, load: 14 + Math.sin(t) * 3 });
    const channels = baseChannels(coldState, o).filter(c => c.id !== "rpm");
    channels.unshift({
      id: "rpm", label: "Engine speed", unit: "rpm", hz: 20,
      // Extra jitter while cold — the stumble, as the rev counter shows it.
      points: (t, r) => Math.max(0, 720 + Math.sin(t * 2) * 25 + (r() - 0.5) * (t < COLD_SOAK_S + 30 ? 40 : 4)),
    });
    // A car that sat overnight: genuinely cold and *still* cold for the whole
    // soak, then warming once the engine catches. The shared drive-cycle
    // coolant curve is wrong here — it models an engine running since t=0, so
    // it is already at 43 °C by the time a monitor would look, and a car
    // sitting at 43 °C is not a cold start.
    channels.push({
      id: "coolant", label: "Coolant temp", unit: "°C", hz: 2,
      points: (t) => (t < COLD_SOAK_S
        ? 12 + Math.sin(t * 0.2) * 0.4
        : 12 + (98 - 12) * (1 - Math.exp(-(t - COLD_SOAK_S) / 55))),
    });
    return {
      id: "cold_start_stumble",
      title: "A cold start that stumbles and then clears",
      description: "Rough for the first half-minute after the key, smooth after. The fault that is never reproducible on a lift.",
      expect: { engine: "cold_start", action: "start_logging" },
      // Exported so a replay does not have to guess where the start happens.
      engine_start_s: COLD_SOAK_S,
      session: buildSession(Object.assign({ channels, seed: 3, duration: 200 }, o)),
    };
  }

  const SCENARIOS = {
    high_load_misfire: highLoadMisfire,
    stock_engine: stockEngine,
    drifting_fuel_trim: driftingFuelTrim,
    reflashed_dme: reflashedDme,
    cold_start_stumble: coldStartStumble,
  };

  /** Build one scenario by name. Throws on an unknown name — a typo that
   *  silently returned an empty session would look like a broken engine. */
  function scenario(name, opts) {
    const build = SCENARIOS[name];
    if (!build) {
      throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(", ")}`);
    }
    return build(opts);
  }

  /** Flat text summary, for a panel or a CLI. */
  function describe(scn) {
    if (!scn) return "";
    const bits = [scn.title];
    if (scn.expect) bits.push(`expect ${scn.expect.engine} → ${JSON.stringify(scn.expect)}`);
    if (scn.session) {
      let pts = 0;
      for (const [, ch] of scn.session) pts += ch.data.length;
      bits.push(`${scn.session.size} channels, ${pts} samples`);
    }
    return bits.join(" · ");
  }

  const api = {
    SCENARIOS,
    buildSession,
    coldStartStumble,
    describe,
    driveCycle,
    driftingFuelTrim,
    highLoadMisfire,
    reflashedDme,
    rng,
    scenario,
    stockEngine,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.beeemuuDemoScenarios = api;
})(typeof window !== "undefined" ? window : globalThis);
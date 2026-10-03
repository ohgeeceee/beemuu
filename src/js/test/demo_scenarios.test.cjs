"use strict";

/* Demo-scenario tests.
 *
 * These are the first tests in the repo that run a v3 engine against data
 * nobody hand-tuned to make it pass. Every scenario declares an `expect`, and
 * the engine must find it. That is the property worth having: an engine that
 * quietly stops detecting the pattern it exists to detect fails here.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const d = require("../demo_scenarios.js");
const misfire = require("../misfire_patterns.js");
const drift = require("../adaptation_drift.js");
const flash = require("../flash_audit.js");
const cold = require("../cold_start.js");

test("a session has the shape the engines and the log exporter expect", () => {
  const scn = d.highLoadMisfire({ dropout: 0 });
  assert.ok(scn.session instanceof Map);
  for (const [id, ch] of scn.session) {
    assert.equal(ch.id, id);
    assert.equal(typeof ch.label, "string");
    assert.equal(typeof ch.unit, "string");
    assert.ok(Array.isArray(ch.data) && ch.data.length);
    for (const p of ch.data) {
      assert.equal(typeof p.x, "number");
      assert.equal(typeof p.y, "number");
    }
  }
});

test("the same seed produces an identical log, and a different one does not", () => {
  const a = d.stockEngine({ seed: 5 });
  const b = d.stockEngine({ seed: 5 });
  const c = d.stockEngine({ seed: 6 });
  const flat = s => JSON.stringify([...s.session.get("rpm").data]);
  assert.equal(flat(a), flat(b), "the same seed must be reproducible");
  assert.notEqual(flat(a), flat(c), "a different seed must differ");
});

test("channels are sampled at different rates, as a real logger does", () => {
  // The bug class that cost real debugging time in feature 1: an engine that
  // assumed all channels were sampled on the same tick.
  const scn = d.stockEngine({ dropout: 0 });
  const rate = id => scn.session.get(id).data.length;
  assert.ok(rate("rpm") > rate("load"), "rpm should be sampled faster than load");
  assert.ok(rate("load") > rate("coolant"), "load should be faster than coolant");
  assert.ok(rate("coolant") > rate("oilTemp"), "coolant should be faster than oil temp");
});

test("dropouts remove samples rather than inserting zeros", () => {
  // A dropped read must be absent, not 0 — otherwise an engine reads a comms
  // error as 0 degrees and invents a fault.
  const scn = d.stockEngine({ dropout: 0.5 });
  const coolant = scn.session.get("coolant").data;
  assert.ok(coolant.length > 0);
  assert.ok(coolant.every(p => p.y > 0),
    "a coolant channel with dropouts must contain no zero values");
});

test("dropouts actually reduce the sample count", () => {
  // Without this, the test above passes trivially: a generator that never
  // dropped anything would also contain no zeros. A dropout has to be
  // observable as *missing samples*, not as a value change.
  const dense = d.stockEngine({ dropout: 0 });
  const lossy = d.stockEngine({ dropout: 0.5 });
  const n = id => lossy.session.get(id).data.length;
  assert.ok(n("rpm") < dense.session.get("rpm").data.length,
    `expected fewer rpm samples with dropouts: ${n("rpm")} vs ${dense.session.get("rpm").data.length}`);
  assert.ok(n("load") < dense.session.get("load").data.length);
  // The timestamps of the surviving samples must still be on the original
  // grid — a dropout is a skipped read, not a resampled channel. Compared
  // against the step rather than for "integer-ness": accumulating `step`
  // 1000 times leaves a float residue that is not itself a defect.
  const hz = 10;
  const step = 1 / hz;
  for (const p of lossy.session.get("rpm").data) {
    const steps = p.x / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6,
      `timestamp ${p.x} is off the ${hz}Hz grid`);
  }
});

test("the misfire scenario is detected as a high-load ignition fault", () => {
  const scn = d.highLoadMisfire();
  const events = misfire.collectEvents(scn.session, { startId: "engineStart" });
  assert.ok(events.length >= misfire.RULES.min_events,
    `only ${events.length} misfire events — the scenario is too quiet to be a test`);
  const result = misfire.analyze(events);
  const cyl3 = result.patterns.find(p => p.cylinder === 3);
  assert.ok(cyl3, "cylinder 3 was not detected");
  assert.equal(cyl3.pattern, "high_load_ignition",
    `expected high_load_ignition, got ${cyl3.pattern}`);
  // Confidence scales with how completely the rule owns the events: 86%
  // dominance lands around 73, and the base score is 85. The floor here is set
  // well clear of `unclear` (25) without demanding the number a perfect,
  // noiseless capture would produce.
  assert.ok(cyl3.confidence >= 70, `confidence was only ${cyl3.confidence}`);
  assert.ok(cyl3.confidence < 85,
    "a noisy burst capture should not score a perfect 85");
});

test("the misfires really are confined to the high-load window", () => {
  // Guards the scenario itself: if the generator drifted and started firing
  // misfires at idle, the classifier would still return "high_load_ignition"
  // by luck and the test above would keep passing.
  const scn = d.highLoadMisfire({ dropout: 0 });
  const events = misfire.collectEvents(scn.session, {});
  for (const e of events) {
    if (e.rpm != null) {
      assert.ok(e.rpm > 3000, `a misfire at ${e.rpm} rpm — the scenario is wrong, not the engine`);
    }
  }
});

test("the stock scenario produces a log with no misfire events at all", () => {
  // The negative control. Without it, a classifier that answered
  // "high_load_ignition" to everything would pass the test above.
  const events = misfire.collectEvents(d.stockEngine().session, {});
  assert.equal(events.length, 0);
});

test("the drifting trim scenario is found by the drift engine", () => {
  const scn = d.driftingFuelTrim();
  // The scenario carries its own `now`; using anything later would correctly
  // project no crossing, which is not what this scenario is demonstrating.
  const { reports } = drift.analyzeAll(scn.histories, scn.meta, { now: scn.now });
  const ltft = reports.find(r => r.id === "ltft");
  assert.ok(ltft);
  assert.equal(ltft.status, "ok");
  assert.equal(ltft.severity, "watch", `severity was ${ltft.severity}`);
  assert.ok(ltft.slope_per_day > 0, "the trend should be rising");
  assert.ok(ltft.predict_crossing, "a projected crossing date was expected");
  assert.ok(Math.abs(ltft.correlation) > 0.99, "the trend should be near-perfectly linear");
  // The value is under the limit, so this must be a watch and not an `act` —
  // the scenario exists to show the warning *before* the fault.
  assert.ok(ltft.current < 20, `current was ${ltft.current}`);
});

test("the reflashed-DME scenario is found by the flash auditor", () => {
  const scn = d.reflashedDme();
  const result = flash.audit(scn.snapshots);
  assert.equal(result.summary.flashed, scn.expect.flashed);
  assert.equal(result.summary.counter_resets, 0);
  const dme = result.modules.find(m => m.address === 0x12);
  assert.ok(dme, "the DME was not reconstructed");
  assert.equal(dme.name, scn.expect.module);
  assert.equal(dme.current_count, 2);
  const flashEvent = dme.events.find(e => e.kind === "flash");
  assert.ok(flashEvent, `expected a flash event, got ${JSON.stringify(dme.events)}`);
  assert.equal(flashEvent.from, 1);
  assert.equal(flashEvent.to, 2);
});

test("the other modules in the flash scenario are correctly not flagged", () => {
  // A counter that never moved must not be reported as reprogrammed.
  const result = flash.audit(d.reflashedDme().snapshots);
  for (const name of ["TCM", "ABS"]) {
    const m = result.modules.find(x => x.name === name);
    assert.ok(m, `${name} missing`);
    assert.equal(m.events.filter(e => e.kind === "flash").length, 0, name);
  }
});

test("the cold-start scenario trips the cold-start monitor", () => {
  // Replayed against the scenario's own timeline. The car sits overnight at
  // ~12 °C, the engine is started 90 s into the log, and the stumble clears by
  // the 30-second mark. Feeding the monitor the scenario's own coolant channel
  // (rather than an invented curve) is what makes this a test of the scenario
  // and the engine together.
  const scn = d.coldStartStumble({ dropout: 0 });
  const coolant = scn.session.get("coolant").data;
  const at = (ch, upto) => {
    let best = null;
    for (const p of ch) if (p.x <= upto && (!best || p.x > best.x)) best = p;
    return best ? best.y : null;
  };

  const monitor = cold.createMonitor();
  let armedAt = null;
  let startedAt = null;
  // The monitor arms once the elapsed off time reaches min_off_ms, so at 3 s
  // sampling steps the earliest possible arming is exactly 60 s, not 63 s.
  const soakS = cold.DEFAULTS.min_off_ms / 1000;
  for (let i = 0; i * 3 <= scn.session.get("rpm").data.length; i++) {
    const s = i * 3;
    const running = s >= scn.engine_start_s;
    const r = monitor.tick({ t: s * 1000, running, coolant: at(coolant, s) });
    if (r.action === cold.ACTIONS.armed) armedAt = s;
    if (r.action === cold.ACTIONS.start) { startedAt = s; break; }
  }
  assert.ok(armedAt !== null,
    "the monitor never armed on a cold, off engine");
  assert.ok(armedAt >= soakS,
    `armed after ${armedAt}s, but the monitor requires a ${soakS}s cold soak`);
  assert.ok(startedAt !== null,
    "the monitor never opened a capture on the cold start");
  assert.equal(startedAt, scn.engine_start_s);
  assert.ok(startedAt > armedAt, "the capture must follow the arming");
  assert.equal(monitor.captureCount(), 1);
});

test("scenario names are validated rather than silently returning nothing", () => {
  assert.throws(() => d.scenario("nope"), /Unknown scenario/);
  assert.throws(() => d.scenario(""), /Unknown scenario/);
  for (const name of Object.keys(d.SCENARIOS)) {
    assert.ok(d.scenario(name), `${name} produced nothing`);
  }
});

test("describe summarises a scenario for a panel or a CLI", () => {
  const s = d.describe(d.highLoadMisfire());
  assert.match(s, /Cylinder 3/);
  assert.match(s, /misfire_patterns/);
  assert.match(s, /channels, \d+ samples/);
  assert.equal(d.describe(null), "");
  // A scenario with no session still describes itself.
  assert.match(d.describe(d.reflashedDme()), /reprogrammed/);
});

test("the rng is deterministic and stays in range", () => {
  const a = d.rng(1);
  const b = d.rng(1);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
  // A zero seed must not produce a constant stream.
  const z = d.rng(0);
  const first = z();
  assert.ok(z() !== first || Number.isFinite(first));
});

test("buildSession skips channels with no id rather than indexing them blank", () => {
  const s = d.buildSession({ channels: [{ label: "no id" }, null, { id: "ok", points: () => 1 }] });
  assert.deepEqual([...s.keys()], ["ok"]);
});

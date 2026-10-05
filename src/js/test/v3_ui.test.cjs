"use strict";

/* Panel-layer tests (v3.0.0 UI slice).
 *
 * The engines are pure and heavily tested; this covers the thin DOM shim on
 * top, which is where the failures that never show up in an engine test live:
 *   - a panel that throws on mount and takes the app window with it,
 *   - a panel that renders untrusted text as markup,
 *   - a panel that silently shows nothing because an engine failed to load.
 *
 * jsdom is installed with --no-save (node_modules is gitignored), so this file
 * skips itself when jsdom is absent rather than failing a CI job that has not
 * installed it.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
try { ({ JSDOM } = require("jsdom")); } catch (_) { /* not installed */ }

const ROOT = path.resolve(__dirname, "../../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/index.html"), "utf8");

/* Build a DOM from the real index.html, then load every v3 engine into it the
 * way the webview would: as plain scripts, in the order index.html declares. */
function boot({ engines = [], bridge = {} } = {}) {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  // Mirrors the bridge main.js publishes, including the try/catch: a throwing
  // listener must not stop the others, and this test asserts that contract, so
  // the stub has to be the real shape rather than a convenient one.
  window.beeemuuV3 = Object.assign({
    _listeners: [],
    onData(fn) { if (typeof fn === "function") this._listeners.push(fn); },
    _notify() {
      for (const fn of this._listeners) {
        try { fn(); } catch (_) { /* ignore */ }
      }
    },
    logSeries: () => null,
    dtcs: () => [],
    vehicleModules: () => [],
    isConnected: () => false,
    isReplay: () => false,
  }, bridge);

  for (const name of engines) {
    const src = fs.readFileSync(path.join(ROOT, "src/js", name), "utf8");
    if (name === "signal_index_data.js") {
      // It assigns window.beeemuuSignalIndexData; the `window` here is jsdom's.
      window.eval(src);
    } else {
      window.eval(src);
    }
  }
  return { dom, window, doc: window.document };
}

const ENGINES = [
  "misfire_patterns.js",
  "adaptation_drift.js",
  "tuning_fingerprint.js",
  "flash_audit.js",
  "fault_timeline.js",
  "cold_start.js",
  "parameter_hunt.js",
  "symptom_index.js",
  "signal_library.js",
  "vehicle_passport.js",
  "plugins_registry_client.js",
  "signal_index_data.js",
  "v3_signal_index.js",
];

// jsdom is a hard requirement for this file, not an optional extra. Silently
// skipping looked green in CI while the panels went untested: node's runner
// reports a skip as a pass and exits 0, so a missing dependency removed 28
// tests from the gate and nothing said so. It is now declared in
// devDependencies and installed by CI, and the guard below fails loudly
// rather than skipping.
if (!JSDOM) {
  throw new Error(
    "jsdom is required by v3_ui.test.cjs — run `npm install` first. " +
    "These panel tests must not be skipped; a skip here removes the only " +
    "coverage of the DOM layer."
  );
}

const withDom = (name, fn) => test(name, fn);

withDom("every v3 panel mount point exists in index.html", () => {
  const { doc } = boot({ engines: ENGINES });
  const ids = [
    "v3-symptom-input", "v3-symptom-run", "v3-symptom-body",
    "v3-misfire-run", "v3-misfire-body",
    "v3-drift-param", "v3-drift-value", "v3-drift-threshold", "v3-drift-add", "v3-drift-body",
    "v3-fingerprint-run", "v3-fingerprint-body",
    "v3-fault-history-refresh", "v3-fault-history-body",
    "v3-flash-refresh", "v3-flash-body",
    "v3-cold-arm", "v3-cold-disarm", "v3-cold-status", "v3-cold-count",
    "v3-signal-input", "v3-signal-engine", "v3-signal-verified", "v3-signal-body",
    "v3-passport-build", "v3-passport-save", "v3-passport-body",
    "v3-hunt-kind", "v3-hunt-engine", "v3-hunt-module", "v3-hunt-ident",
    "v3-hunt-add", "v3-hunt-body", "v3-hunt-note",
  ];
  for (const id of ids) {
    assert.ok(doc.getElementById(id), `missing #${id} in index.html`);
  }
});

withDom("index.html loads every v3 script it declares", () => {
  const declared = [...HTML.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  const required = [
    "js/misfire_patterns.js", "js/adaptation_drift.js", "js/tuning_fingerprint.js",
    "js/flash_audit.js", "js/fault_timeline.js", "js/cold_start.js", "js/parameter_hunt.js",
    "js/symptom_index.js", "js/signal_library.js", "js/vehicle_passport.js",
    "js/plugins_registry_client.js", "js/signal_index_data.js",
    "js/v3_signal_index.js", "js/v3_ui.js",
  ];
  for (const src of required) {
    assert.ok(declared.includes(src), `index.html does not load ${src}`);
  }
});

withDom("all panels mount together without throwing", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  // Each mount produced its placeholder rather than an empty box.
  assert.ok(doc.getElementById("v3-symptom-body").textContent.length > 0);
  assert.ok(doc.getElementById("v3-misfire-body").textContent.length > 0);
  assert.ok(doc.getElementById("v3-hunt-body").textContent.length > 0);
});

withDom("a missing engine degrades its own panel and no other", () => {
  // The claim the mount loop makes. A load failure must cost one panel, never
  // the app window.
  const { window, doc } = boot({ engines: ENGINES });
  delete window.beeemuuMisfirePatterns;
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  // The misfire panel kept its HTML placeholder and never rendered a result.
  assert.ok(doc.getElementById("v3-misfire-body").textContent.includes("Run after recording"));
  assert.equal(window.beeemuuV3MisfirePanel, undefined);
  // ...and every other panel still mounted.
  assert.ok(window.beeemuuV3SymptomPanel, "symptom panel should still mount");
  assert.ok(window.beeemuuV3HuntPanel, "hunt panel should still mount");
  assert.ok(window.beeemuuV3SignalPanel, "signal panel should still mount");
});

withDom("a panel that throws is isolated from the others", () => {
  const { window } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  // Make one engine's mount throw on first use.
  const original = window.beeemuuSymptomIndex.diagnose;
  window.beeemuuSymptomIndex.diagnose = () => { throw new Error("boom"); };
  // mountAll must swallow it.
  assert.doesNotThrow(() => window.mountV3Panels());
  window.beeemuuSymptomIndex.diagnose = original;
  // ...and a later panel still mounted.
  assert.ok(window.beeemuuV3PassportPanel);
});

withDom("untrusted text is rendered as text, never as markup", () => {
  // The single most important property of this layer. Every engine consumes
  // community-contributed strings; `innerHTML` with any of them is an
  // injection point.
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();

  const payload = `<img src=x onerror="window.__pwned=1">${"x".repeat(200)}`;
  // A hostile "engine" returning a payload in every string field.
  window.beeemuuSymptomIndex.diagnose = () => ({
    query: payload, is_diagnosis: false, components: [payload], checks: [payload],
    codes: [{ code: payload, note: payload, confidence: payload, sources: [payload] }],
    matched: [{ id: payload, title: payload, description: payload, score: payload, matched_terms: [payload] }],
    note: payload,
  });
  window.beeemuuV3SymptomPanel.run();

  assert.equal(window.__pwned, undefined, "an injected handler executed");
  assert.equal(doc.querySelectorAll("#v3-symptom-body img").length, 0,
    "an injected element was parsed as markup");
  // ...and the payload is still shown, as literal text.
  assert.ok(doc.getElementById("v3-symptom-body").textContent.includes(payload));
});

withDom("the symptom panel renders a real match from the real engine", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const input = doc.getElementById("v3-symptom-input");
  input.value = "it stumbles badly on a cold start in the morning";
  window.beeemuuV3SymptomPanel.run();
  const body = doc.getElementById("v3-symptom-body").textContent;
  assert.match(body, /cold start/i);
  assert.match(body, /2A82/);
  assert.match(body, /not a diagnosis/);
  assert.match(body, /no published circuit/);   // 2A98 flagged honestly
});

withDom("the symptom panel says so when nothing matches", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-symptom-input").value = "the windscreen wiper is squeaking";
  window.beeemuuV3SymptomPanel.run();
  assert.match(doc.getElementById("v3-symptom-body").textContent, /Nothing in the index matched/);
});

withDom("the signal library renders the generated index with confidence grades", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const body = doc.getElementById("v3-signal-body").textContent;
  assert.match(body, /signals:/);
  assert.match(body, /verified/);
  // The engine dropdown was populated from the generated index.
  const sel = doc.getElementById("v3-signal-engine");
  assert.ok(sel.options.length > 3, `only ${sel.options.length} engines in the dropdown`);
  // Filtering to verified-only must actually reduce the rows.
  const before = doc.querySelectorAll("#v3-signal-body .v3-signal-row").length;
  doc.getElementById("v3-signal-verified").checked = true;
  window.beeemuuV3SignalPanel.render();
  const after = doc.querySelectorAll("#v3-signal-body .v3-signal-row").length;
  assert.ok(after < before, `verified-only did not narrow: ${before} -> ${after}`);
});

withDom("the signal library shows the split verdict for a signal that has one", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const oil = window.beeemuuV3SignalPanel.index.signals.find(s => s.id === "oil");
  assert.ok(oil && oil.partially_verified, "the generated index should carry the oil split verdict");
  doc.getElementById("v3-signal-input").value = "oil temp";
  window.beeemuuV3SignalPanel.render();
  assert.match(doc.getElementById("v3-signal-body").textContent, /unverified on/);
});

withDom("the drift panel refuses to call a trend from one reading", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-drift-param").value = "ltft";
  doc.getElementById("v3-drift-value").value = "3.1";
  doc.getElementById("v3-drift-add").click();
  const body = doc.getElementById("v3-drift-body").textContent;
  assert.match(body, /1 reading\(s\)/);
  assert.doesNotMatch(body, /steady/i);
});

withDom("the drift panel surfaces an over-threshold reading", () => {
  const { window, doc } = boot({ engines: ENGINES });
  let timestamp = Date.now();
  window.Date.now = () => ++timestamp;
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  for (const v of [10, 20, 30, 45]) {
    doc.getElementById("v3-drift-param").value = "ltft";
    doc.getElementById("v3-drift-value").value = String(v);
    doc.getElementById("v3-drift-threshold").value = "40";
    doc.getElementById("v3-drift-add").click();
  }
  const body = doc.getElementById("v3-drift-body").textContent;
  assert.match(body, /need attention now/);
  assert.match(body, /past its limit/);
});

withDom("the drift panel ignores an empty or non-numeric recording", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-drift-param").value = "";
  doc.getElementById("v3-drift-value").value = "5";
  doc.getElementById("v3-drift-add").click();
  doc.getElementById("v3-drift-param").value = "x";
  doc.getElementById("v3-drift-value").value = "";
  doc.getElementById("v3-drift-add").click();
  assert.match(doc.getElementById("v3-drift-body").textContent, /Record a reading/);
});

withDom("the misfire panel explains an empty log rather than showing nothing", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  window.beeemuuV3MisfirePanel.run();
  assert.match(doc.getElementById("v3-misfire-body").textContent, /No log data/);
});

withDom("the misfire panel renders a pattern from a real log series", () => {
  const { window, doc } = boot({
    engines: ENGINES,
    bridge: {
      logSeries: () => new Map([
        ["rpm", { label: "RPM", unit: "rpm", data: [{ x: 0, y: 5200 }, { x: 1, y: 5200 }] }],
        ["load", { label: "Load", unit: "%", data: [{ x: 0, y: 92 }, { x: 1, y: 92 }] }],
        ["coolant", { label: "Coolant", unit: "°C", data: [{ x: 0, y: 88 }, { x: 1, y: 88 }] }],
        ["misfireCyl1", { label: "Misfire 1", unit: "", data: Array.from({ length: 21 }, (_, i) => ({ x: i, y: i })) }],
      ]),
    },
  });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  window.beeemuuV3MisfirePanel.run();
  const body = doc.getElementById("v3-misfire-body").textContent;
  assert.match(body, /Cylinder 1/);
  assert.match(body, /confidence/);
});

withDom("the fingerprint panel refuses without a stock baseline", () => {
  const { window, doc } = boot({
    engines: ENGINES,
    bridge: { logSeries: () => new Map([["rpm", { data: [{ x: 0, y: 800 }] }]]) },
  });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  assert.equal(window.beeemuuSignalLibraryIndex.baselines && Object.keys(window.beeemuuSignalLibraryIndex.baselines).length, 0);
  window.beeemuuV3FingerprintPanel.run();
  const body = doc.getElementById("v3-fingerprint-body").textContent;
  assert.match(body, /No stock baseline is installed/);
  assert.match(body, /will not guess/);
});

withDom("the fingerprint panel never names a tuning platform", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const src = fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8");
  // The platform disclaimer must be in the panel, and no bootmod3/mhd string
  // may appear anywhere in the UI layer.
  assert.doesNotMatch(src, /bootmod3|mhd|xentry/i);
  assert.match(src, /does not name a tuning platform/);
});

withDom("the cold-start panel arms and reports state", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const panel = window.beeemuuV3ColdPanel;
  assert.equal(panel.monitor(), null);
  doc.getElementById("v3-cold-arm").click();
  assert.ok(panel.monitor(), "arm did not create a monitor");
  // Feed observations; the monitor should arm after a cold soak.
  const base = Date.now();
  const obs = (dt, running, coolant) => ({ t: base + dt, running, coolant });
  panel.observe(obs(0, false, 12));
  panel.observe(obs(90000, false, 12));
  assert.match(doc.getElementById("v3-cold-status").textContent, /armed/);
  panel.observe(obs(95000, true, 12));
  assert.match(doc.getElementById("v3-cold-status").textContent, /capturing/);
  assert.match(doc.getElementById("v3-cold-count").textContent, /1 capture/);
  doc.getElementById("v3-cold-disarm").click();
  assert.equal(panel.monitor(), null);
});

withDom("the cold-start panel ignores observations while disarmed", () => {
  const { window } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  const r = window.beeemuuV3ColdPanel.observe({ t: Date.now(), running: true, coolant: 10 });
  assert.equal(r, null);
});

withDom("the passport panel never emits a VIN, even if handed one", () => {
  const { window, doc } = boot({
    engines: ENGINES,
    bridge: {
      vehicleModules: () => ([{ address: 0x12, name: "DME", ident: "MEVD17.2.42-S0000123" }]),
    },
  });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-passport-build").click();
  const text = doc.getElementById("v3-passport-body").textContent;
  assert.doesNotMatch(text, /S0000123/, "the module ident leaked into the passport panel");
  assert.match(text, /modules\[\]\.ident|Removed before sharing/);
  // The JSON must be shown as text, not parsed as markup.
  assert.ok(window.beeemuuV3PassportPanel.passport());
  assert.equal(window.beeemuuV3PassportPanel.passport().privacy.vin_included, false);
});

withDom("the passport save button works without a Tauri bridge", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-passport-save").click();
  assert.ok(window.beeemuuV3PassportPanel.passport(), "save did not build a passport");
});

withDom("the hunt panel records a finding and explains a duplicate", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-hunt-kind").value = "discovery";
  doc.getElementById("v3-hunt-engine").value = "n54";
  doc.getElementById("v3-hunt-module").value = "DME";
  doc.getElementById("v3-hunt-ident").value = "0x0C";
  doc.getElementById("v3-hunt-add").click();
  assert.match(doc.getElementById("v3-hunt-note").textContent, /\+5 points|points —/);
  // Same finding again must not score.
  doc.getElementById("v3-hunt-add").click();
  assert.match(doc.getElementById("v3-hunt-note").textContent, /does not score again/);
});

withDom("the hunt panel refuses to score an unattributed finding", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  doc.getElementById("v3-hunt-kind").value = "discovery";
  doc.getElementById("v3-hunt-engine").value = "";
  doc.getElementById("v3-hunt-module").value = "";
  doc.getElementById("v3-hunt-add").click();
  assert.match(doc.getElementById("v3-hunt-note").textContent, /Missing engine and module/);
  assert.match(doc.getElementById("v3-hunt-body").textContent, /0 points from 0 finding/);
});

withDom("the flash panel explains that one snapshot is not enough", async () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.__TAURI__ = { core: { invoke: async (cmd) => (cmd === "list_exports" ? ["beeemuu-session-a.json"] : "{}") } };
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  await window.beeemuuV3FlashPanel.load();
  assert.match(doc.getElementById("v3-flash-body").textContent, /at least two/);
});

withDom("panels re-render when main.js notifies", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  let rendered = 0;
  window.beeemuuV3.onData(() => { rendered++; });
  window.beeemuuV3._notify();
  assert.equal(rendered, 1);
  // A throwing listener must not stop the others.
  window.beeemuuV3.onData(() => { throw new Error("bad panel"); });
  let second = 0;
  window.beeemuuV3.onData(() => { second++; });
  assert.doesNotThrow(() => window.beeemuuV3._notify());
  assert.equal(second, 1, "a throwing listener stopped the rest");
});

withDom("corrupt localStorage does not stop the drift or hunt panels", () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.localStorage.setItem("beeemuu.drift.v1", "{not json");
  window.localStorage.setItem("beeemuu.hunt.v1", "]]]");
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  assert.doesNotThrow(() => window.mountV3Panels());
  assert.ok(doc.getElementById("v3-drift-body").textContent.includes("Record a reading"));
  assert.ok(doc.getElementById("v3-hunt-body").textContent.includes("0 points"));
});

withDom("fault history panel labels stored reads as historical and escapes source text", async () => {
  const { window, doc } = boot({ engines: ENGINES });
  window.BeemuuGarage = { read: () => ({ activeId: "car-1", vehicles: [{ id: "car-1", vin: "WBA00000000000000" }] }) };
  window.beeemuuDtcHistory = { queryDtcHistory: async () => ({ entries: [{
    code: "P0301", address: 17, text: "<img src=x onerror=alert(1)>", status_text: "stored",
    first_seen_iso: "2025-01-01T00:00:00Z", last_seen_iso: "2025-02-01T00:00:00Z", occurrences: 2,
  }] }) };
  window.eval(fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8"));
  window.mountV3Panels();
  await window.beeemuuV3FaultTimeline.refresh();
  const body = doc.getElementById("v3-fault-history-body");
  assert.match(body.textContent, /prior reads/);
  assert.match(body.textContent, /<img src=x/);
  assert.equal(body.querySelector("img"), null, "untrusted DTC text became markup");
});

withDom("every panel body uses textContent and never innerHTML", () => {
  // A guard against a future edit reintroducing innerHTML with engine data.
  const src = fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8");
  const offenders = [...src.matchAll(/\.innerHTML\s*=/g)];
  assert.equal(offenders.length, 0,
    `v3_ui.js assigns innerHTML ${offenders.length} time(s); use textContent`);
});

withDom("v3_ui.js has no inline styles and no eval", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/js/v3_ui.js"), "utf8");
  assert.doesNotMatch(src, /\.style\./, "v3_ui.js sets inline styles");
  assert.doesNotMatch(src, /\beval\s*\(/, "v3_ui.js calls eval");
});

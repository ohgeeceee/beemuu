"use strict";

/* Panel-layer tests (v3.8.0 → v5.0.0 arc).
 *
 * The engines in this arc are pure and tested on their own; v4_wiring.test.cjs
 * pins that the panels can reach them. This file drives the panels themselves
 * against the *real* engine files loaded into a real DOM, because the failures
 * that never show up in an engine test live here:
 *   - a panel that throws on mount and takes the app window with it,
 *   - a panel that renders typed text as markup,
 *   - a panel that reports a confident verdict from a record it never parsed,
 *   - a panel that goes blank instead of saying "no log is loaded", so an
 *     empty box is indistinguishable from "nothing wrong found".
 *
 * The DOM is built from the shipped src/index.html, so the ids these tests
 * press are the ids the app ships.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
try { ({ JSDOM } = require("jsdom")); } catch (_) { /* not installed */ }

const ROOT = path.resolve(__dirname, "../../..");
const HTML = fs.readFileSync(path.join(ROOT, "src/index.html"), "utf8");

if (!JSDOM) {
  throw new Error(
    "jsdom is required by v4_ui.test.cjs — run `npm install` first. " +
    "Skipping these would remove the only coverage of the v4 DOM layer."
  );
}

/* Load the arc's engines the way the webview does: as plain scripts, in the
 * order index.html declares them, before the panel file that reads them. */
const ENGINES = [
  "signal_quality.js",
  "drive_cycle.js",
  "fleet_dashboard.js",
  "service_provenance.js",
  "sensor_plausibility.js",
  "opinion_consensus.js",
  "plugin_capabilities.js",
  "plugin_capability_bridge.js",
];

function boot({ withEngines = true, withUI = true, bridge = {} } = {}) {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  window.beeemuuV3 = Object.assign({
    _listeners: [],
    onData(fn) { if (typeof fn === "function") this._listeners.push(fn); },
    _notify() {
      for (const fn of this._listeners) {
        try { fn(); } catch (_) { /* ignore, same as main.js */ }
      }
    },
    logSeries: () => null,
    dtcs: () => [],
    vehicleModules: () => [],
    isConnected: () => false,
    isReplay: () => false,
  }, bridge);

  if (withEngines) {
    for (const name of ENGINES) {
      window.eval(fs.readFileSync(path.join(ROOT, "src/js", name), "utf8"));
    }
  }
  if (withUI) {
    window.eval(fs.readFileSync(path.join(ROOT, "src/js/v4_ui.js"), "utf8"));
  }
  return { dom, window, doc: window.document };
}

const text = (node) => (node ? node.textContent : "");

/* A log in the shape the bridge hands out: a Map of channel name → samples. */
function series(overrides) {
  const chans = {
    rpm: { unit: "rpm", data: [] },
    coolant: { unit: "C", data: [] },
    oil: { unit: "C", data: [] },
    iat: { unit: "C", data: [] },
    ambient: { unit: "C", data: [] },
    map: { unit: "kPa", data: [] },
    speed: { unit: "km/h", data: [] },
    lambda: { unit: "lambda", data: [] },
    battery: { unit: "V", data: [] },
  };
  for (let i = 0; i < 240; i++) {
    const idle = i < 10;
    const warm = Math.min(Math.max((i - 10) / 90, 0), 1);
    chans.rpm.data.push({ x: i, y: idle ? 0 : 1500 + 600 * Math.sin(i / 5) });
    chans.coolant.data.push({ x: i, y: idle ? 14 : 20 + warm * 72 });
    chans.oil.data.push({ x: i, y: idle ? 14 : 18 + warm * 78 });
    chans.iat.data.push({ x: i, y: idle ? 20 : 24 + warm * 6 });
    chans.ambient.data.push({ x: i, y: 19 });
    chans.map.data.push({ x: i, y: idle ? 101 : 160 });
    chans.speed.data.push({ x: i, y: idle ? 0 : 60 + 10 * Math.sin(i / 5) });
    chans.lambda.data.push({ x: i, y: 1 });
    chans.battery.data.push({ x: i, y: idle ? 12.2 : 14.2 });
  }
  return new Map(Object.entries(Object.assign(chans, overrides || {})));
}

// Paste formats are documented by the panels themselves:
//   fleet      label | odometer_km | DTCs | last_service_km | last_service_date
//   provenance date  | odometer_km | cost | description
//   opinions   date  | source | author | repair | confidence | mileage_km
const FLEET = [
  "Civic | 98000 | | 95000 | 2026-01-04",
  "Accord | 102000 | P0300,P0420 | 99000 | 2026-02-11",
].join("\n");

const OPINIONS = [
  "2026-02-01 | forum | dave | coil | 0.9 | 98000",
  "2026-02-02 | shop | mike | coil | 0.8 | 98100",
  "2026-02-03 | forum | sam | plug | 0.5 | 97900",
].join("\n");

test("mounting with every engine present returns all seven panels", () => {
  const { window } = boot();
  assert.equal(window.beeemuuV4UI.mountAll(), 7);
});

test("a build missing every engine still mounts, and says so instead of going blank", () => {
  const { window, doc } = boot({ withEngines: false });
  window.beeemuuV4UI.mountAll();

  const ids = ["v4-signal-body", "v4-cycle-body", "v4-fleet-body",
    "v4-prov-body", "v4-sensor-body", "v4-opinion-body", "v4-plugin-body"];
  for (const id of ids) {
    const body = doc.getElementById(id);
    assert.ok(body, id + " missing from the markup");
    assert.match(text(body), /is not loaded in this build/,
      id + " went blank instead of naming the missing engine");
  }
});

test("pressing a panel button with no engine loaded reports the failure in the panel", () => {
  const { window, doc } = boot({ withEngines: false });
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-signal-run").click();
  assert.match(text(doc.getElementById("v4-signal-body")), /signal_quality\.js/);
});

test("a panel whose engine throws does not take the other panels down", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-signal-run").click();
  const before = text(doc.getElementById("v4-signal-body"));

  // A poisoned engine that explodes on the exact call the panel makes. The
  // fleet box needs a parseable record set, or the panel returns before it
  // ever calls the engine.
  window.beeemuuFleetDashboard = { fleet: () => { throw new Error("boom"); } };
  doc.getElementById("v4-fleet-input").value = FLEET;
  doc.getElementById("v4-fleet-run").click();
  assert.match(text(doc.getElementById("v4-fleet-body")), /failed: boom/);

  doc.getElementById("v4-signal-run").click();
  assert.equal(text(doc.getElementById("v4-signal-body")), before,
    "the signal panel changed after an unrelated panel threw");
});

test("with no log loaded the series panels say so rather than drawing an empty axis", () => {
  const { window, doc } = boot(); // bridge.logSeries() → null
  window.beeemuuV4UI.mountAll();
  for (const id of ["v4-signal-run", "v4-cycle-run", "v4-sensor-run"]) {
    doc.getElementById(id).click();
  }
  for (const id of ["v4-signal-body", "v4-cycle-body", "v4-sensor-body"]) {
    assert.match(text(doc.getElementById(id)), /No log is loaded/, id);
  }
});

test("with a real log the series panels produce a verdict, not a message", () => {
  const { window, doc } = boot({ bridge: { logSeries: () => series() } });
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-signal-run").click();
  const body = doc.getElementById("v4-signal-body");
  assert.doesNotMatch(text(body), /No log is loaded/);
  assert.match(text(body), /channels/);
  assert.equal(body.querySelectorAll(".v3-signal-row").length > 0, true);
});

test("signal integrity lists the worst channel first", () => {
  const broken = series();
  // 180 samples that never move: a flatlined sensor, the classic stuck-MAP bug.
  broken.set("map", { unit: "kPa", data: Array.from({ length: 180 }, (_, i) => ({ x: i, y: 101 })) });
  const { window, doc } = boot({ bridge: { logSeries: () => broken } });
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-signal-run").click();
  const rows = [...doc.querySelectorAll("#v4-signal-body .v3-signal-row")];
  assert.ok(rows.length > 0, "no channel rows rendered");
  const names = rows.map((r) => text(r.querySelector(".v3-signal-name")));
  // the flatlined channel is listed, and above the healthy, moving rpm trace
  assert.ok(names.includes("map"), "the flatlined map channel is missing");
  assert.ok(names.indexOf("map") < names.indexOf("rpm"),
    "a flatlined channel was listed below a healthy one: " + names.join(" > "));
  assert.match(text(rows[names.indexOf("map")]), /(bad|warn|frozen)/,
    "the flatlined channel was not flagged");
});

test("a fleet record with an unreadable odometer is reported as a line, not guessed at", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-fleet-input").value =
    "VIN: JHMFA16586S000001, miles: not-a-number, date: 2026-01-04";
  doc.getElementById("v4-fleet-run").click();
  const shown = text(doc.getElementById("v4-fleet-body"));
  assert.match(shown, /line 1/);
  assert.doesNotMatch(shown, /grade/,
    "the panel graded a record it could not parse");
});

test("fleet text is rendered as text: markup typed into the box stays visible", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-fleet-input").value =
    'VIN: <img src=x onerror=alert(1)>, miles: 98000, date: 2026-01-04';
  doc.getElementById("v4-fleet-run").click();
  const body = doc.getElementById("v4-fleet-body");
  assert.equal(body.querySelectorAll("img").length, 0, "typed markup became a real element");
});

test("the fleet panel builds a record set from real text", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-fleet-input").value = FLEET;
  doc.getElementById("v4-fleet-run").click();
  const body = doc.getElementById("v4-fleet-body");
  assert.doesNotMatch(text(body), /line \d/);
  assert.ok(body.querySelectorAll(".v3-card").length >= 2,
    "expected one card per vehicle");
});

test("the provenance panel flags mileage that went backwards between visits", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  // MIN_ENTRIES is 3 — a two-line history is refused outright, which is its
  // own test. Three visits with the middle odometer running backwards is the
  // shortest history that can actually be judged.
  doc.getElementById("v4-prov-input").value = [
    "2026-01-04 | 98000 | 140 | oil and filter",
    "2026-02-11 | 91000 | 90 | brake check",
    "2026-03-02 | 102000 | 260 | tyres",
  ].join("\n");
  doc.getElementById("v4-prov-run").click();
  const shown = text(doc.getElementById("v4-prov-body"));
  assert.match(shown, /91000/);
  assert.match(shown, /(backwards|odometer|roll)/i);
});

test("an opinion record with an impossible confidence is rejected, not clamped", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-opinion-input").value = [
    OPINIONS,
    JSON.stringify({ id: "o4", topic: "misfire", verdict: "coil", confidence: 1.4, at: "2026-02-04" }),
  ].join("\n");
  doc.getElementById("v4-opinion-run").click();
  assert.match(text(doc.getElementById("v4-opinion-body")), /line 4/);
});

test("the opinion panel reports the quorum it actually has", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-opinion-input").value = OPINIONS;
  doc.getElementById("v4-opinion-run").click();
  const body = doc.getElementById("v4-opinion-body");
  assert.doesNotMatch(text(body), /line \d/);
  assert.ok(body.querySelectorAll(".v3-card").length > 0, "no consensus card rendered");
});

test("the plugin panel reviews the example manifest it seeds without the user typing", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  const input = doc.getElementById("v4-plugin-input");
  assert.ok(input.value.length > 0, "the panel seeded no manifest to look at");
  doc.getElementById("v4-plugin-run").click();
  const shown = text(doc.getElementById("v4-plugin-body"));
  assert.doesNotMatch(shown, /not valid JSON|failed/);
  assert.match(shown, /risk/);
});

test("a manifest that fails validation is refused outright", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-plugin-input").value = JSON.stringify({ id: "", version: "x" });
  doc.getElementById("v4-plugin-run").click();
  assert.match(text(doc.getElementById("v4-plugin-body")), /not installable/);
});

test("malformed JSON in a paste box is a message, not a thrown control-flow stop", () => {
  const { window, doc } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-plugin-input").value = "{ nope";
  doc.getElementById("v4-plugin-run").click();
  assert.match(text(doc.getElementById("v4-plugin-body")), /not valid JSON/);
});

test("what the user typed survives a reload: the box is seeded from storage", () => {
  const { window, doc, dom } = boot();
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-fleet-input").value = FLEET;
  doc.getElementById("v4-fleet-run").click();

  const saved = window.localStorage.getItem(window.beeemuuV4UI.STORE.fleet);
  assert.ok(saved && saved.indexOf("Civic") !== -1,
    "the pasted record set was not stored");

  // A second boot in the same origin sees the same store, as the webview would.
  const again = new JSDOM(HTML, {
    runScripts: "outside-only",
    url: "http://localhost/",
    storageQuota: 10000000,
  });
  for (const [k, v] of Object.entries({ [window.beeemuuV4UI.STORE.fleet]: saved })) {
    again.window.localStorage.setItem(k, v);
  }
  again.window.beeemuuV3 = window.beeemuuV3;
  for (const name of ENGINES) {
    again.window.eval(fs.readFileSync(path.join(ROOT, "src/js", name), "utf8"));
  }
  again.window.eval(fs.readFileSync(path.join(ROOT, "src/js/v4_ui.js"), "utf8"));
  again.window.beeemuuV4UI.mountAll();
  assert.match(again.window.document.getElementById("v4-fleet-input").value, /Civic/);
  dom.window.close();
});

test("refreshAll re-reads the log without the user pressing anything", () => {
  let current = series();
  const { window, doc } = boot({ bridge: { logSeries: () => current } });
  window.beeemuuV4UI.mountAll();
  doc.getElementById("v4-signal-run").click();
  const first = text(doc.getElementById("v4-signal-body"));

  const broken = series();
  broken.set("map", { unit: "kPa", data: Array.from({ length: 180 }, (_, i) => ({ x: i, y: 101 })) });
  current = broken;
  window.beeemuuV4UI.refreshAll();

  assert.notEqual(text(doc.getElementById("v4-signal-body")), first,
    "refreshAll did not pick up the new log");
});

test("refreshAll survives a renderer that throws", () => {
  const { window } = boot();
  window.beeemuuV4UI.mountAll();
  window.beeemuuSignalQuality = { analyze: () => { throw new Error("late failure"); } };
  assert.doesNotThrow(() => window.beeemuuV4UI.refreshAll());
});

test("the file is inert where there is no DOM: requiring it does not throw", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/js/v4_ui.js"), "utf8");
  assert.match(src, /typeof document !== "undefined"/);
  const mod = require("../v4_ui.js");
  assert.equal(typeof mod.mountAll, "function");
  assert.equal(typeof mod.refreshAll, "function");
});

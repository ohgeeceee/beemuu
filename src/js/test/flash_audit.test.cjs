"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const f = require("../flash_audit.js");

const HOUR = 3600000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = ms => new Date(T0 + ms).toISOString();

/* A snapshot in the `modules` array shape the app already writes. */
function snap(whenMs, modules) {
  return {
    taken_at: at(whenMs),
    modules: modules.map(([address, name, dids]) => ({ address, name, dids })),
  };
}

test("toMs accepts Date, ISO string and millis, and rejects junk", () => {
  assert.equal(f.toMs(new Date(T0)), T0);
  // `at` adds its argument to T0, so the ISO form of the base instant is
  // at(0), not at(T0).
  assert.equal(f.toMs(at(0)), T0);
  assert.equal(f.toMs(T0), T0);
  assert.equal(f.toMs("not a date"), null);
  assert.equal(f.toMs(null), null);
  assert.equal(f.toMs(undefined), null);
  assert.equal(f.toMs(NaN), null);
  assert.equal(f.toMs({}), null);
});

test("extractModules reads the modules array shape", () => {
  const mods = f.extractModules(snap(T0, [[0x12, "DME", { flash_count: 3 }]]));
  assert.equal(mods.size, 1);
  const m = mods.get(0x12);
  assert.equal(m.name, "DME");
  assert.equal(m.flash_count, 3);
});

test("extractModules reads the address-keyed shape too", () => {
  const mods = f.extractModules({
    taken_at: at(T0),
    modules_by_address: {
      18: { name: "DME", dids: { flashCount: "4" } },
    },
  });
  assert.equal(mods.get(0x12).flash_count, 4);
});

test("extractModules falls back to a synthetic name when none is given", () => {
  const mods = f.extractModules(snap(T0, [[0x12, null, { flash_count: 1 }]]));
  assert.match(mods.get(0x12).name, /Module 0x12/);
});

test("an absent counter is null, never 0", () => {
  // "Absent" and "never flashed" are different facts, and rendering both as 0
  // would tell a used-car buyer the module was never programmed.
  const mods = f.extractModules(snap(T0, [[0x12, "DME", { software_version: "ME17.2.42" }]]));
  assert.equal(mods.get(0x12).flash_count, null);
});

test("an explicitly null counter is still absent, not zero", () => {
  // A module that does not implement the counter identifier returns an explicit
  // null, not a missing key. `Number(null)` is 0, so a naive coercion renders
  // that as "programmed zero times" — a claim about the car's history that no
  // reading supports. Both spellings have to land on null.
  for (const dids of [
    { flash_count: null },
    { flash_count: undefined },
    { flash_count: "" },
    { flash_count: "not a number" },
    { flash_count: false },
  ]) {
    const mods = f.extractModules(snap(T0, [[0x12, "DME", dids]]));
    assert.equal(mods.get(0x12).flash_count, null, `for ${JSON.stringify(dids)}`);
  }
  // ...while a genuine zero is a real reading and must survive.
  const zero = f.extractModules(snap(T0, [[0x12, "DME", { flash_count: 0 }]]));
  assert.equal(zero.get(0x12).flash_count, 0);
  const zeroStr = f.extractModules(snap(T0, [[0x12, "DME", { flash_count: "0" }]]));
  assert.equal(zeroStr.get(0x12).flash_count, 0);
});

test("a null counter is a coverage gap, not a flash event", () => {
  // The end-to-end consequence: a module that reports null then later reports
  // 1 is a counter *appearing*, not a module that was flashed.
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: null }]]),
    snap(30 * DAY, [[0x12, "DME", { flash_count: 1 }]]),
  ]);
  assert.equal(a.modules[0].events[0].kind, "counter_appeared");
  assert.equal(a.summary.flashed, 0);
  // Two snapshots were read, but only one carried a counter — so the advice is
  // "nothing to compare against", not "go take more snapshots".
  assert.equal(a.modules[0].readings, 2);
  assert.match(a.modules[0].note, /only one carried a flash counter/);
});

test("a counter that appears where there was none is not a flash", () => {
  const a = f.audit([
    snap(0, [[0x12, "DME", { software_version: "ME17.2.42" }]]),
    snap(10 * DAY, [[0x12, "DME", { flash_count: 1 }]]),
  ]);
  const dme = a.modules[0];
  assert.equal(dme.events.length, 1);
  assert.equal(dme.events[0].kind, "counter_appeared");
  assert.equal(a.summary.flashed, 0);
});

test("a rising counter between two distant snapshots is a flash", () => {
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: 1 }]]),
    snap(30 * DAY, [[0x12, "DME", { flash_count: 2 }]]),
  ]);
  const dme = a.modules[0];
  assert.equal(dme.events[0].kind, "flash");
  assert.equal(dme.events[0].from, 1);
  assert.equal(dme.events[0].to, 2);
  assert.equal(a.summary.flashed, 1);
  assert.match(dme.note, /Flash counter moved 1 time/);
});

test("a counter moving minutes apart is the same visit, not a flash", () => {
  // Two snapshots five minutes into one diagnostic session are one visit;
  // calling that a flash invents history.
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: 1 }]]),
    snap(5 * 60 * 1000, [[0x12, "DME", { flash_count: 2 }]]),
  ]);
  assert.equal(a.modules[0].events.length, 0);
  assert.equal(a.summary.flashed, 0);
  assert.match(a.modules[0].note, /steady/);
});

test("a falling counter is reported as a reset, never as a flash", () => {
  // Counters do not go down. Either the module was replaced or the scale
  // changed; calling it a flash would be a guess.
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: 5 }]]),
    snap(30 * DAY, [[0x12, "DME", { flash_count: 1 }]]),
  ]);
  const dme = a.modules[0];
  assert.equal(dme.events[0].kind, "counter_reset");
  assert.equal(a.summary.flashed, 0);
  assert.equal(a.summary.counter_resets, 1);
});

test("a forward programming date is evidence of reprogramming", () => {
  const a = f.audit([
    snap(0, [[0x12, "DME", { programming_date: at(0) }]]),
    snap(30 * DAY, [[0x12, "DME", { programming_date: at(20 * DAY) }]]),
  ]);
  assert.equal(a.modules[0].events[0].kind, "reprogrammed");
});

test("an active diagnostic session is tracked but never counted as programming", () => {
  // UDS DID 0xF184 is the current session, not a flash count. A naive reader
  // would report the session as the last programming date.
  const a = f.audit([
    snap(0, [[0x12, "DME", { active_session: "extended", flash_count: 2 }]]),
    snap(30 * DAY, [[0x12, "DME", { active_session: "extended", flash_count: 2 }]]),
  ]);
  const dme = a.modules[0];
  assert.equal(dme.events.length, 0);
  assert.equal(dme.active_session, "extended");
  assert.equal(dme.programming_date, null);
  assert.equal(a.summary.flashed, 0);
});

test("snapshots out of order are sorted before the history is built", () => {
  const a = f.audit([
    snap(30 * DAY, [[0x12, "DME", { flash_count: 2 }]]),
    snap(0, [[0x12, "DME", { flash_count: 1 }]]),
  ]);
  assert.equal(a.modules[0].first_count, 1);
  assert.equal(a.modules[0].current_count, 2);
  assert.equal(a.modules[0].events[0].kind, "flash");
});

test("a module read in only one snapshot says so instead of claiming no history", () => {
  const a = f.audit([snap(0, [[0x12, "DME", { flash_count: 1 }]])]);
  const dme = a.modules[0];
  assert.equal(dme.readings, 1);
  assert.match(dme.note, /One reading only/);
  assert.equal(a.summary.sufficient_history, false);
  assert.match(a.summary.note, /One snapshot cannot show/);
});

test("a module with no counter in any snapshot is reported as unknown", () => {
  const a = f.audit([
    snap(0, [[0x12, "DME", { software_version: "ME17.2.42" }]]),
    snap(30 * DAY, [[0x12, "DME", { software_version: "ME17.2.42" }]]),
  ]);
  assert.equal(a.modules[0].current_count, null);
  assert.match(a.modules[0].note, /never reported a flash counter/);
});

test("gaps report snapshots the module was missing from", () => {
  // A module absent from the middle of a library cannot be shown to have been
  // *un*flashed in that window, so the gap is surfaced rather than hidden.
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: 1 }]]),
    snap(DAY, [[0x60, "TCM", { flash_count: 0 }]]),
    snap(2 * DAY, [[0x12, "DME", { flash_count: 1 }]]),
  ]);
  assert.equal(a.modules.find(m => m.address === 0x12).gaps, 1);
  assert.equal(a.modules.find(m => m.address === 0x60).gaps, 2);
});

test("flashed modules sort to the top", () => {
  const a = f.audit([
    snap(0, [[0x12, "DME", { flash_count: 1 }], [0x60, "TCM", { flash_count: 1 }]]),
    snap(30 * DAY, [[0x12, "DME", { flash_count: 3 }], [0x60, "TCM", { flash_count: 1 }]]),
  ]);
  assert.equal(a.modules[0].name, "DME");
  assert.equal(a.summary.flashed, 1);
});

test("snapshots with no parseable timestamp are skipped entirely", () => {
  const a = f.audit([
    { modules: [{ address: 0x12, name: "DME", dids: { flash_count: 1 } }] },
    null,
    "nonsense",
    snap(30 * DAY, [[0x12, "DME", { flash_count: 2 }]]),
  ]);
  // The undated snapshot is not counted as a first reading, so a single dated
  // reading correctly reports "one reading only" rather than inventing a flash.
  assert.equal(a.modules[0].readings, 1);
  assert.equal(a.modules[0].events.length, 0);
});

test("audit tolerates no snapshots at all", () => {
  for (const input of [null, undefined, [], [null], [{}]]) {
    const a = f.audit(input);
    assert.equal(a.modules.length, 0);
    assert.equal(a.summary.flashed, 0);
  }
});

test("versionMismatches ignores patch differences within one series", () => {
  // ME17.2.42 and ME17.2.40 are matched modules. Flagging this would cry wolf
  // on every car in the fleet.
  const same = [
    { name: "DME", versions: { software_version: "ME17.2.42" } },
    { name: "TCM", versions: { software_version: "ME17.2.40" } },
  ];
  assert.deepEqual(f.versionMismatches(same), []);
});

test("versionMismatches flags modules sitting on different series", () => {
  // The signature of a partial or interrupted flash.
  const across = [
    { name: "DME", versions: { software_version: "ME17.2.42" } },
    { name: "TCM", versions: { software_version: "ME18.1.10" } },
  ];
  const out = f.versionMismatches(across);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(g => g[0].name), ["DME", "TCM"]);
});

test("versionMismatches ignores unversioned and single-module entries", () => {
  assert.deepEqual(f.versionMismatches(null), []);
  assert.deepEqual(f.versionMismatches([
    { name: "DME", versions: { software_version: "ME17.2.42" } },
  ]), []);
  assert.deepEqual(f.versionMismatches([
    { name: "A", versions: {} },
    { name: "B" },
  ]), []);
});

test("classifyChange is silent when nothing can honestly be said", () => {
  const m = { address: 0x12, name: "DME", flash_count: 1, programming_date: null };
  assert.equal(f.classifyChange(m, m, 30 * DAY), null);
  assert.equal(f.classifyChange({ ...m, flash_count: null }, m, 30 * DAY), "counter_appeared");
  assert.equal(f.classifyChange(m, { ...m, flash_count: 1 }, 30 * DAY), null);
});

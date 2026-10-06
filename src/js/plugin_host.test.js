"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const hostApi = require("./plugin_host.js");
const capApi = require("./plugin_capabilities.js");

const state = (over = {}) => ({
  vin: () => "WBAXX00000TEST123",
  dtcs: () => [{ code: "P0301", description: "Cylinder 1 misfire", status: "stored" }],
  logSeries: () => new Map([["rpm", { label: "RPM", unit: "rpm", data: [{ x: 1, y: 800 }] }]]),
  ...over,
});

test("readVin returns a validated VIN and never a placeholder", () => {
  const host = hostApi.createHost(state());
  assert.equal(host.readVin(), "WBAXX00000TEST123");
  // Normalised, not invented: lower case and padding are cleaned.
  assert.equal(hostApi.createHost(state({ vin: () => "  wbaxx00000test123 " })).readVin(), "WBAXX00000TEST123");
  // Anything that is not a VIN is null rather than a stand-in string.
  for (const bad of ["", "unavailable", "N/A", "WBAXX00000TEST12", "WBAXX00000TEST1234", "WBAXX00000TEST12!", null, undefined, 42, {}]) {
    assert.equal(hostApi.createHost(state({ vin: () => bad })).readVin(), null, `${String(bad)} must not become a VIN`);
  }
  // I, O and Q are not valid VIN characters.
  assert.equal(hostApi.createHost(state({ vin: () => "WBAXX00000TEIT123" })).readVin(), null);
  assert.equal(hostApi.createHost(state({ vin: () => "WBAXX00000TEO T123" })).readVin(), null);
});

test("a missing or throwing accessor degrades to an empty answer, not an error", () => {
  assert.equal(hostApi.createHost({}).readVin(), null);
  assert.deepEqual(hostApi.createHost({}).readDtc(), []);
  assert.deepEqual(hostApi.createHost({}).publish(), 0);
  assert.equal(hostApi.createHost({ vin: () => { throw new Error("not connected"); } }).readVin(), null);
  assert.deepEqual(hostApi.createHost({ dtcs: () => { throw new Error("not connected"); } }).readDtc(), []);
  assert.throws(() => hostApi.createHost(null), /must be an object/);
  assert.throws(() => hostApi.createHost("state"), /must be an object/);
});

test("readDtc returns fresh copies so a plugin cannot mutate app state", () => {
  const source = [{ code: "P0301", description: "Cylinder 1 misfire", status: "stored", internal: "secret" }];
  const host = hostApi.createHost(state({ dtcs: () => source }));
  const faults = host.readDtc();
  assert.deepEqual(faults, [{ code: "P0301", description: "Cylinder 1 misfire", status: "stored" }]);
  // Unknown internal fields are dropped, not passed through.
  assert.equal(faults[0].internal, undefined);
  // Mutating what we handed out must not touch the source.
  faults[0].code = "TAMPERED";
  faults.push({ code: "FAKE" });
  assert.equal(source[0].code, "P0301");
  assert.equal(source.length, 1);
  // And a second read is unaffected.
  assert.equal(host.readDtc()[0].code, "P0301");
});

test("readDtc caps the payload and drops rows that are not faults", () => {
  const many = Array.from({ length: hostApi.MAX_DTCS + 50 }, (_, i) => ({ code: `P${String(i).padStart(4, "0")}` }));
  assert.equal(hostApi.createHost(state({ dtcs: () => many })).readDtc().length, hostApi.MAX_DTCS);
  const junk = [null, undefined, 42, "P0301", {}, { code: "" }, { code: 123 }, { code: "P0301" }];
  assert.deepEqual(hostApi.createHost(state({ dtcs: () => junk })).readDtc(), [{ code: "P0301" }]);
  assert.deepEqual(hostApi.createHost(state({ dtcs: () => "not an array" })).readDtc(), []);
});

test("freeze frames are deep-copied rather than shared by reference", () => {
  const source = [{ code: "P0301", freeze_frame: { rpm: 3200, coolant: 91 } }];
  const faults = hostApi.createHost(state({ dtcs: () => source })).readDtc();
  assert.deepEqual(faults[0].freeze_frame, { rpm: 3200, coolant: 91 });
  faults[0].freeze_frame.rpm = 9999;
  assert.equal(source[0].freeze_frame.rpm, 3200);
});

test("subscribeLive registers, delivers, and unsubscribes idempotently", () => {
  const host = hostApi.createHost(state());
  const seen = [];
  const off = host.subscribeLive(snapshot => seen.push(snapshot));
  assert.equal(host.listenerCount(), 1);
  assert.equal(host.publish(), 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].series[0], { id: "rpm", label: "RPM", unit: "rpm", data: [{ x: 1, y: 800 }], truncated: false });
  off();
  off(); // idempotent
  assert.equal(host.listenerCount(), 0);
  assert.equal(host.publish(), 0);
  assert.equal(seen.length, 1);
  assert.throws(() => host.subscribeLive("not a function"), /expects a function/);
});

test("a listener that throws does not stop the others", () => {
  const host = hostApi.createHost(state());
  const seen = [];
  host.subscribeLive(() => { throw new Error("bad plugin"); });
  host.subscribeLive(snapshot => seen.push(snapshot));
  assert.equal(host.publish(), 1);
  assert.equal(seen.length, 1);
});

test("live snapshots are bounded in both series count and points", () => {
  const wide = new Map();
  for (let i = 0; i < hostApi.MAX_SERIES + 10; i += 1) wide.set(`s${i}`, { label: `S${i}`, unit: "", data: [{ x: 1, y: 1 }] });
  assert.equal(hostApi.createHost(state({ logSeries: () => wide })).publish() === 0, true);
  const host = hostApi.createHost(state({ logSeries: () => wide }));
  let got;
  host.subscribeLive(s => { got = s; });
  host.publish();
  assert.equal(got.series.length, hostApi.MAX_SERIES);

  const long = new Map([["rpm", { label: "RPM", unit: "rpm", data: Array.from({ length: hostApi.MAX_POINTS_PER_SERIES + 100 }, (_, i) => ({ x: i, y: i })) }]]);
  const host2 = hostApi.createHost(state({ logSeries: () => long }));
  let got2;
  host2.subscribeLive(s => { got2 = s; });
  host2.publish();
  assert.equal(got2.series[0].data.length, hostApi.MAX_POINTS_PER_SERIES);
  assert.equal(got2.series[0].truncated, true);
  // Non-finite samples are dropped rather than handed to a plugin.
  const messy = new Map([["rpm", { label: "RPM", unit: "rpm", data: [{ x: 1, y: 1 }, { x: NaN, y: 1 }, { x: 2, y: Infinity }, { x: 3, y: 3 }, "junk"] }]]);
  const host3 = hostApi.createHost(state({ logSeries: () => messy }));
  let got3;
  host3.subscribeLive(s => { got3 = s; });
  host3.publish();
  assert.deepEqual(got3.series[0].data, [{ x: 1, y: 1 }, { x: 3, y: 3 }]);
});

test("bridging this host grants exactly the declared capabilities", () => {
  const host = hostApi.createHost(state());
  const bridge = capApi.createBridge(["read-vin", "read-dtc"], host);
  assert.equal(bridge.surface.readVin(), "WBAXX00000TEST123");
  assert.deepEqual(bridge.surface.readDtc(), [{ code: "P0301", description: "Cylinder 1 misfire", status: "stored" }]);
  // live-data was not declared, so it is refused and recorded.
  assert.throws(() => bridge.surface.subscribeLive(() => {}), /without declaring the "live-data" capability/);
  assert.deepEqual(bridge.denials(), [{ call: "subscribeLive", capability: "live-data" }]);
});

test("the plugin surface cannot reach publish or the host internals", () => {
  const host = hostApi.createHost(state());
  const bridge = capApi.createBridge(["read-vin", "read-dtc", "live-data"], host);
  /* `publish` is how the app pushes new data. A plugin must never be able to
   * drive it, or it could make the app re-enter every other plugin's listener. */
  assert.equal(bridge.surface.publish, undefined);
  assert.equal(bridge.surface.listenerCount, undefined);
  assert.equal(bridge.surface.state, undefined);
  assert.equal(bridge.surface.read, undefined);
  // But a declared subscribeLive works and can be unsubscribed.
  const seen = [];
  const off = bridge.surface.subscribeLive(s => seen.push(s));
  host.publish();
  assert.equal(seen.length, 1);
  off();
  host.publish();
  assert.equal(seen.length, 1);
});
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bridgeApi = require("./plugin_bridge.js");
const capabilities = require("./plugin_capabilities.js");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* Stand in for the frame's two channels: `relay` answers with what the app
 * would, `send` records what the worker would receive. */
function harness(granted, answers = {}) {
  const calls = [];
  const sent = [];
  const bridge = bridgeApi.createFrameBridge({
    capabilities: granted,
    relay: (method, args) => {
      calls.push({ method, args });
      const answer = answers[method];
      return Promise.resolve(typeof answer === "function" ? answer() : answer);
    },
    send: (message) => sent.push(message),
  });
  return { bridge, calls, sent };
}

test("a declared read reaches the app and the answer goes back to the worker", async () => {
  const { bridge, calls, sent } = harness(["read-vin"], { readVin: "WBAXX00000TEST123" });
  bridge.handle({ t: "call", id: 1, method: "readVin", args: [] });
  await tick();
  assert.deepEqual(calls, [{ method: "readVin", args: [] }]);
  assert.deepEqual(sent, [{ t: "reply", id: 1, ok: true, value: "WBAXX00000TEST123" }]);
  assert.deepEqual(bridge.capabilities, ["read-vin"]);
});

test("an undeclared call is refused and never reaches the app", async () => {
  const { bridge, calls, sent } = harness(["read-vin"]);
  bridge.handle({ t: "call", id: 2, method: "readDtc", args: [] });
  await tick();
  assert.equal(calls.length, 0, "the host must not be reached");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ok, false);
  assert.match(sent[0].error, /without declaring the "read-dtc" capability/);
  assert.deepEqual(bridge.denials(), [{ call: "readDtc", capability: "read-dtc" }]);
});

test("a capability the run was not granted is absent even if the worker asks for it", async () => {
  const { bridge, calls, sent } = harness([], { readVin: "WBAXX00000TEST123" });
  for (const method of ["readVin", "readDtc", "subscribeLive"]) {
    bridge.handle({ t: "call", id: 3, method, args: [] });
  }
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(sent.length, 3);
  assert.ok(sent.every((message) => message.ok === false));
});

test("a host that throws or rejects becomes an error reply, not a crash", async () => {
  const throwing = harness(["read-dtc"], { readDtc: () => { throw new Error("not connected"); } });
  throwing.bridge.handle({ t: "call", id: 4, method: "readDtc", args: [] });
  await tick();
  assert.equal(throwing.sent[0].ok, false);
  assert.match(throwing.sent[0].error, /not connected/);

  const rejecting = harness(["read-dtc"], { readDtc: () => Promise.reject(new Error("bus off")) });
  rejecting.bridge.handle({ t: "call", id: 5, method: "readDtc", args: [] });
  await tick();
  assert.equal(rejecting.sent[0].ok, false);
  assert.match(rejecting.sent[0].error, /bus off/);
});

test("an answer that cannot cross the wire is refused instead of sent", async () => {
  const unserialisable = harness(["read-vin"], { readVin: () => () => {} });
  unserialisable.bridge.handle({ t: "call", id: 6, method: "readVin", args: [] });
  await tick();
  assert.equal(unserialisable.sent[0].ok, false);
  assert.match(unserialisable.sent[0].error, /cannot be sent/);

  const oversized = harness(["read-vin"], { readVin: () => "x".repeat(bridgeApi.MAX_VALUE_BYTES + 1) });
  oversized.bridge.handle({ t: "call", id: 7, method: "readVin", args: [] });
  await tick();
  assert.equal(oversized.sent[0].ok, false);
  assert.match(oversized.sent[0].error, /64 KiB/);
});

test("a malformed message is dropped rather than answered", async () => {
  const { bridge, sent } = harness(["read-vin"], { readVin: "WBAXX00000TEST123" });
  for (const message of [null, undefined, "call", 42, {}, { t: "call" }, { t: "call", id: "1", method: "readVin" }, { t: "call", id: 1 }, { t: "unknown", id: 1 }]) {
    bridge.handle(message);
  }
  await tick();
  assert.deepEqual(sent, []);
});

test("live data: subscribe, deliver to the worker, release, stop", async () => {
  const { bridge, calls, sent } = harness(["live-data"], { subscribeLive: "host-token-1" });
  bridge.handle({ t: "call", id: 9, method: "subscribeLive", args: [] });
  await tick();
  assert.deepEqual(sent[0], { t: "reply", id: 9, ok: true, value: null });
  assert.equal(bridge.listenerCount(), 1);
  assert.equal(bridge.subscriptionCount(), 1);

  // The app publishes; the frame forwards exactly what it was given.
  assert.equal(bridge.deliver("host-token-1", { series: [{ id: "rpm", data: [{ x: 1, y: 800 }] }] }), true);
  assert.deepEqual(sent[1], { t: "event", id: 9, payload: { series: [{ id: "rpm", data: [{ x: 1, y: 800 }] }] } });

  bridge.handle({ t: "release", id: 9 });
  await tick();
  assert.deepEqual(calls.map((call) => call.method), ["subscribeLive", "releaseSubscription"]);
  assert.equal(bridge.listenerCount(), 0);
  assert.equal(bridge.deliver("host-token-1", { series: [] }), false, "a released subscription gets nothing");
});

test("releasing before the subscription token lands still unsubscribes", async () => {
  const calls = [];
  const sent = [];
  let resolveToken;
  const bridge = bridgeApi.createFrameBridge({
    capabilities: ["live-data"],
    relay: (method) => {
      calls.push(method);
      if (method === "subscribeLive") return new Promise((resolve) => { resolveToken = resolve; });
      return Promise.resolve(null);
    },
    send: (message) => sent.push(message),
  });
  bridge.handle({ t: "call", id: 11, method: "subscribeLive", args: [] });
  await tick();
  bridge.handle({ t: "release", id: 11 });
  await tick();
  resolveToken("host-token-late");
  await tick();
  assert.deepEqual(calls, ["subscribeLive", "releaseSubscription"], "the late token is released, not leaked");
  assert.equal(bridge.listenerCount(), 0);
});

test("an unknown host token is refused by deliver", () => {
  const { bridge } = harness(["live-data"], { subscribeLive: "host-token-1" });
  assert.equal(bridge.deliver("nope", { series: [] }), false);
});

test("the frame bridge refuses to build without capabilities enforcement loaded", () => {
  assert.throws(() => bridgeApi.createFrameBridge({}), /relay function/);
  assert.throws(() => bridgeApi.createFrameBridge({ relay: () => {} }), /send function/);
  assert.throws(() => bridgeApi.createFrameBridge({ relay: () => {}, send: () => {}, capabilities: ["ecu-flash"] }), /not grantable/);
  assert.throws(() => bridgeApi.createFrameBridge({ relay: () => {}, send: () => {}, capabilities: ["nonsense"] }), /Unknown capability/);
});

/* ── the stubs a plugin actually holds ─────────────────────────────────────── */

/* Evaluate the generated source with fake worker globals, and hand back a way
 * to drive the frame's answers and events into it. */
function runStubs(granted) {
  const sent = [];
  const listeners = [];
  const globals = {
    postMessage: (message) => sent.push(message),
    addEventListener: (type, listener) => { if (type === "message") listeners.push(listener); },
  };
  const source = `"use strict";\n${bridgeApi.contextSource(granted)}\nreturn context;`;
  const context = new Function("globalThis", source)(globals);
  return {
    context,
    sent,
    reply: (message) => listeners.forEach((listener) => listener({ data: message })),
  };
}

test("the plugin context only carries the methods it was granted", () => {
  const all = runStubs(["read-vin", "read-dtc", "live-data"]).context;
  assert.deepEqual(Object.keys(all.vehicle).sort(), ["readDtc", "readVin", "subscribeLive"]);
  const none = runStubs([]).context;
  assert.deepEqual(Object.keys(none.vehicle), []);
  assert.ok(Object.isFrozen(none.vehicle), "the surface cannot be widened by assignment");
  const vinOnly = runStubs(["read-vin"]).context;
  assert.deepEqual(Object.keys(vinOnly.vehicle), ["readVin"]);
  assert.equal(vinOnly.vehicle.readDtc, undefined, "an ungranted method is absent, not a stub that throws");
});

test("the generated stubs resolve, reject, and unsubscribe as documented", async () => {
  const { context, sent, reply } = runStubs(["read-vin", "read-dtc", "live-data"]);
  const vin = context.vehicle.readVin();
  assert.deepEqual(sent[0], { t: "call", id: 1, method: "readVin", args: [] });
  reply({ t: "reply", id: 1, ok: true, value: "WBAXX00000TEST123" });
  assert.equal(await vin, "WBAXX00000TEST123");

  const faults = context.vehicle.readDtc();
  const call = sent.find((message) => message.method === "readDtc");
  reply({ t: "reply", id: call.id, ok: false, error: "not connected" });
  await assert.rejects(faults, /not connected/);

  const seen = [];
  const off = context.vehicle.subscribeLive((payload) => seen.push(payload));
  const sub = sent.find((message) => message.method === "subscribeLive");
  reply({ t: "event", id: sub.id, payload: { series: [{ id: "rpm" }] } });
  assert.deepEqual(seen, [{ series: [{ id: "rpm" }] }]);
  off();
  off(); // idempotent
  assert.deepEqual(sent[sent.length - 1], { t: "release", id: sub.id });
  reply({ t: "event", id: sub.id, payload: { series: [] } });
  assert.equal(seen.length, 1, "a released listener stops receiving");
});

test("a listener that throws does not break the stub's own channel", () => {
  const { context, sent, reply } = runStubs(["live-data"]);
  const seen = [];
  context.vehicle.subscribeLive(() => { throw new Error("plugin bug"); });
  const sub = sent.find((message) => message.method === "subscribeLive");
  reply({ t: "event", id: sub.id, payload: { series: [] } });
  context.vehicle.subscribeLive((payload) => seen.push(payload));
  const second = sent.filter((message) => message.method === "subscribeLive")[1];
  reply({ t: "event", id: second.id, payload: { series: [{ id: "coolant" }] } });
  assert.deepEqual(seen, [{ series: [{ id: "coolant" }] }]);
});

test("contextSource refuses capabilities the runtime will not grant", () => {
  assert.throws(() => bridgeApi.contextSource(["network"]), /not grantable/);
  assert.throws(() => bridgeApi.contextSource(["clear-dtc"]), /not grantable/);
  assert.throws(() => bridgeApi.contextSource(["made-up"]), /Unknown capability/);
  assert.throws(() => bridgeApi.contextSource("read-vin"), /must be an array/);
});

test("the capability table the bridge enforces is the one plugin_capabilities defines", () => {
  // Guards against the two modules drifting: every grantable capability must
  // produce a stub, and every stub must correspond to a grantable capability.
  for (const capability of Object.keys(capabilities.GRANTABLE)) {
    const { context } = runStubs([capability]);
    assert.equal(Object.keys(context.vehicle).length, 1, `${capability} must produce exactly one method`);
  }
});
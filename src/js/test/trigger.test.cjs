"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateThreshold, evaluateDtcTrigger, shouldAutoStart } = require("../trigger.js");

test("threshold > fires", () => {
  const tr = { channelId: "rpm", op: ">", threshold: 3000, enabled: true };
  assert.equal(evaluateThreshold(tr, [{ id: "rpm", value: 3100 }]), true);
  assert.equal(evaluateThreshold(tr, [{ id: "rpm", value: 3000 }]), false);
});
test("threshold disabled never fires", () => {
  const tr = { channelId: "rpm", op: ">", threshold: 0, enabled: false };
  assert.equal(evaluateThreshold(tr, [{ id: "rpm", value: 9999 }]), false);
});
test("threshold missing channel", () => {
  const tr = { channelId: "rpm", op: ">", threshold: 0, enabled: true };
  assert.equal(evaluateThreshold(tr, [{ id: "coolant", value: 100 }]), false);
});
test("dtc star fires on any dtc", () => {
  assert.equal(evaluateDtcTrigger({ code: "*", enabled: true }, [{ code: "2A82" }]), true);
  assert.equal(evaluateDtcTrigger({ code: "*", enabled: true }, []), false);
});
test("dtc specific code", () => {
  assert.equal(evaluateDtcTrigger({ code: "2A82", enabled: true }, [{ code: "2a82" }]), true);
  assert.equal(evaluateDtcTrigger({ code: "2A82", enabled: true }, [{ code: "30FF" }]), false);
});
test("shouldAutoStart combines", () => {
  const triggers = [
    { channelId: "knock", op: ">=", threshold: 2, enabled: true },
    { type: "dtc", code: "2A82", enabled: true },
  ];
  assert.equal(shouldAutoStart(triggers, [{ id: "knock", value: 2 }], []), true);
  assert.equal(shouldAutoStart(triggers, [{ id: "knock", value: 1 }], [{ code: "2A82" }]), true);
  assert.equal(shouldAutoStart(triggers, [{ id: "knock", value: 1 }], []), false);
});

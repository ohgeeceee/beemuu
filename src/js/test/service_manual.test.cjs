"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { manualUrl } = require("../service_manual.js");
test("known prefix", ()=>{ assert.ok(manualUrl("2A82").includes("2A82")); assert.ok(manualUrl("2a82").includes("vanos-inlet")); });
test("fallback search", ()=>{ assert.ok(manualUrl("P0171").includes("search?q=P0171")); });
test("invalid returns null", ()=>{ assert.equal(manualUrl(""), null); assert.equal(manualUrl("ZZZ"), null); });
test("4-6 hex", ()=>{ assert.ok(manualUrl("30FF")); assert.equal(manualUrl("123"), null); });

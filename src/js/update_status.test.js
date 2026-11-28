"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./update_status.js");

test("versionFromText finds the version in brand text and rejects noise", () => {
  assert.equal(api.versionFromText("Independent diagnostic tool for BMW vehicles · v5.3.0"), "5.3.0");
  assert.equal(api.versionFromText("BeeEmUu 12.0.1"), "12.0.1");
  assert.equal(api.versionFromText("Integrated Diagnostics"), null);
  assert.equal(api.versionFromText(""), null);
  assert.equal(api.versionFromText(null), null);
  assert.equal(api.versionFromText("version 5.3"), null);
});

test("releaseNotesUrl only builds URLs for exact semver", () => {
  assert.equal(api.releaseNotesUrl("5.3.0"), "https://github.com/ohgeeceee/beemuu/releases/tag/v5.3.0");
  assert.equal(api.releaseNotesUrl("5.3"), null);
  assert.equal(api.releaseNotesUrl("v5.3.0"), null);
  assert.equal(api.releaseNotesUrl("5.3.0-rc1"), null);
  assert.equal(api.releaseNotesUrl(""), null);
});

test("progressFromEvent accumulates chunks after Started", () => {
  let state = { downloaded: 0, total: 0 };
  assert.equal(api.percent(state), null); // unknown total stays indeterminate
  state = api.progressFromEvent(state, { event: "Started", data: { contentLength: 1000 } });
  assert.deepEqual(state, { downloaded: 0, total: 1000 });
  assert.equal(api.percent(state), 0);
  state = api.progressFromEvent(state, { event: "Progress", data: { chunkLength: 250 } });
  assert.equal(api.percent(state), 25);
  state = api.progressFromEvent(state, { event: "Progress", data: { chunkLength: 250 } });
  assert.equal(api.percent(state), 50);
  state = api.progressFromEvent(state, { event: "Finished", data: {} });
  assert.equal(state.downloaded, state.total);
  assert.equal(api.percent(state), 100);
});

test("progressFromEvent tolerates malformed events and caps runaway chunks", () => {
  let state = { downloaded: 0, total: 0 };
  state = api.progressFromEvent(state, null);
  state = api.progressFromEvent(state, { event: "Progress" }); // no data
  state = api.progressFromEvent(state, { event: "SomethingElse", data: { chunkLength: 50 } });
  assert.deepEqual(state, { downloaded: 0, total: 0 });
  state = api.progressFromEvent(state, { event: "Started", data: { contentLength: 100 } });
  state = api.progressFromEvent(state, { event: "Progress", data: { chunkLength: 500 } });
  assert.equal(api.percent(state), 100); // capped, not 500
  state = api.progressFromEvent(state, { event: "Started", data: { contentLength: "not a number" } });
  assert.equal(api.percent(state), null);
});

/* Tests for `src/js/workspace.js` — the pure (de)serialisation rules
 * behind the persisted workspace layout (v0.7.0 PR #2). Run with the
 * other JS tests (`node --test src/js/test/*.test.cjs`). The module is
 * dual-context; here we use the CommonJS export. File I/O lives in
 * main.js (export_text / read_export_text Tauri commands) and is not
 * covered here.
 *
 * Contract under test:
 *  - round-trip fidelity for well-formed state
 *  - corrupt / missing / non-object input -> null (caller falls back)
 *  - unknown keys dropped, wrong-typed values dropped (forward- and
 *    backward-tolerant files)
 *  - one-time migration from the pre-v0.7.0 localStorage keys
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKSPACE_VERSION,
  parseWorkspace,
  serializeWorkspace,
  migrateLegacy,
} = require("../workspace.js");

const FULL_STATE = {
  theme: "dark",
  mode: "advanced",
  activeTab: "logging",
  conn: { kind: "enet", port: "", dcan: "auto", addr: "169.254.1.2:6801", optsOpen: true },
  liveProfile: "b58",
  logProfile: "n55",
  trafficAuto: true,
  logChannels: { b58: { rpm: true, coolant: false }, n55: { boost: true } },
};

test("round-trip: serialize -> parse preserves every field", () => {
  const text = serializeWorkspace(FULL_STATE);
  assert.deepEqual(parseWorkspace(text), FULL_STATE);
});

test("serialize stamps the schema version and drops non-schema keys", () => {
  const text = serializeWorkspace({ ...FULL_STATE, junkKey: 123, version: 999 });
  const raw = JSON.parse(text);
  assert.equal(raw.version, WORKSPACE_VERSION);
  assert.equal(raw.junkKey, undefined);
  assert.equal(raw.theme, "dark");
});

test("parse: corrupt JSON returns null", () => {
  assert.equal(parseWorkspace("{not json"), null);
  assert.equal(parseWorkspace('{"theme": "dark"'), null);
});

test("parse: missing input returns null", () => {
  assert.equal(parseWorkspace(null), null);
  assert.equal(parseWorkspace(undefined), null);
  assert.equal(parseWorkspace(""), null);
  assert.equal(parseWorkspace("   \n "), null);
});

test("parse: non-object JSON returns null", () => {
  assert.equal(parseWorkspace("[1,2,3]"), null);
  assert.equal(parseWorkspace('"dark"'), null);
  assert.equal(parseWorkspace("42"), null);
  assert.equal(parseWorkspace("null"), null);
});

test("parse: object with no usable keys returns null", () => {
  assert.equal(parseWorkspace("{}"), null);
  assert.equal(parseWorkspace('{"version": 1}'), null);
  assert.equal(parseWorkspace('{"totallyUnknown": true}'), null);
});

test("parse: unknown keys are ignored, known keys survive (forward tolerance)", () => {
  const text = JSON.stringify({
    version: 99, // as if written by a newer app version
    theme: "light",
    futureFeature: { nested: true },
    conn: { kind: "kdcan", futureKnob: 7 },
  });
  assert.deepEqual(parseWorkspace(text), { theme: "light", conn: { kind: "kdcan" } });
});

test("parse: wrong-typed values are dropped", () => {
  const text = JSON.stringify({
    theme: "purple", // only dark|light are valid
    mode: 42,
    trafficAuto: "yes",
    activeTab: "live",
    conn: "kdcan",
    logChannels: {
      b58: { rpm: "yes", coolant: true }, // non-boolean leaf dropped
      n55: [1, 2], // non-object branch dropped
      n62: {}, // empty branch dropped
    },
  });
  assert.deepEqual(parseWorkspace(text), {
    activeTab: "live",
    logChannels: { b58: { coolant: true } },
  });
});

test("parse: theme accepts only dark|light", () => {
  assert.deepEqual(parseWorkspace('{"theme":"dark"}'), { theme: "dark" });
  assert.deepEqual(parseWorkspace('{"theme":"light"}'), { theme: "light" });
  assert.equal(parseWorkspace('{"theme":"blue"}'), null);
});

test("migrateLegacy: a full legacy snapshot maps onto the new shape", () => {
  const settings = JSON.stringify({
    connKind: "kdcan",
    connPort: "COM3",
    connDcan: "true",
    connAddr: "",
    connOptsOpen: false,
    liveProfile: "sim",
    logProfile: "obd2",
    trafficAuto: false,
  });
  assert.deepEqual(migrateLegacy({ dark: "1", settings, mode: "developer" }), {
    theme: "dark",
    mode: "developer",
    conn: { kind: "kdcan", port: "COM3", dcan: "true", addr: "" },
    liveProfile: "sim",
    logProfile: "obd2",
    trafficAuto: false,
  });
});

test("migrateLegacy: no legacy data returns an empty object (never null)", () => {
  assert.deepEqual(migrateLegacy({}), {});
  assert.deepEqual(migrateLegacy({ dark: null, settings: null, mode: null }), {});
  assert.deepEqual(migrateLegacy(), {});
});

test("migrateLegacy: corrupt settings blob still migrates theme + mode", () => {
  assert.deepEqual(migrateLegacy({ dark: "0", settings: "{oops", mode: "basic" }), {
    theme: "light",
    mode: "basic",
  });
});

test("migrateLegacy: connOptsOpen is inherited only when actually true", () => {
  const s = (v) => JSON.stringify({ connKind: "enet", connOptsOpen: v });
  assert.deepEqual(migrateLegacy({ settings: s(true) }).conn, { kind: "enet", optsOpen: true });
  // The legacy flag was effectively always false in the wild (it ANDed
  // the two option panels); a stored false must not resurrect as true.
  assert.deepEqual(migrateLegacy({ settings: s(false) }).conn, { kind: "enet" });
});

test("round-trip of a migrated legacy state", () => {
  const migrated = migrateLegacy({
    dark: "1",
    settings: JSON.stringify({ connKind: "sim", liveProfile: "sim" }),
    mode: "advanced",
  });
  assert.deepEqual(parseWorkspace(serializeWorkspace(migrated)), migrated);
});

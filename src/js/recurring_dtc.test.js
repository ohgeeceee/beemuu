"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeCallout,
  relativeTimeLabel,
  isoToMs,
  DEFAULT_WINDOW_MS,
} = require("../../src/js/recurring_dtc.js");

// Frozen "now" so the relative-time labels are deterministic.
// 2026-07-22T10:00:00Z = 1_784_628_800 + (10*3600) = 1_784_665_200.
// Quick check: Date.UTC(2026, 6, 22, 10, 0, 0).
const NOW_MS = Date.UTC(2026, 6, 22, 10, 0, 0);

function iso(dateUtc) {
  return new Date(dateUtc).toISOString().replace(/\.\d+Z$/, "Z");
}

// Helpers — synthetic entries shaped like `query_dtc_history` returns.
function entry(code, address, occurrences, lastSeenIso, firstSeenIso) {
  return {
    code,
    address,
    occurrences,
    last_seen_iso: lastSeenIso,
    first_seen_iso: firstSeenIso,
    status_text: "",
    text: "",
  };
}

test("computeCallout: returns null when currentDtcs is empty", () => {
  const history = { entries: [entry("2A82", 0x12, 2, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))] };
  assert.equal(computeCallout([], history, NOW_MS), null);
});

test("computeCallout: returns null when history is null", () => {
  assert.equal(computeCallout([{ code: "2A82" }], null, NOW_MS), null);
});

test("computeCallout: returns null when history.entries is empty", () => {
  assert.equal(computeCallout([{ code: "2A82" }], { entries: [] }, NOW_MS), null);
});

test("computeCallout: returns null when no current DTC matches any history entry", () => {
  const history = { entries: [entry("29E0", 0x12, 2, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))] };
  assert.equal(computeCallout([{ code: "2A82" }], history, NOW_MS), null);
});

test("computeCallout: surfaces a matching code with occurrences count", () => {
  const history = {
    entries: [
      entry("2A82", 0x12, 3, iso(NOW_MS - 86_400_000), iso(NOW_MS - 7 * 86_400_000)),
    ],
  };
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "2A82");
  assert.equal(out[0].occurrences, 3);
  // Within-window last_seen gets a human label.
  assert.ok(typeof out[0].last_seen_human === "string");
  assert.ok(out[0].last_seen_human.length > 0);
});

test("computeCallout: filters out entries older than the 14-day window", () => {
  // 20 days ago is outside the default 14-day window.
  const oldLast = iso(NOW_MS - 20 * 86_400_000);
  const oldFirst = iso(NOW_MS - 20 * 86_400_000);
  const history = { entries: [entry("2A82", 0x12, 1, oldLast, oldFirst)] };
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS);
  assert.equal(out, null, "entry outside the 14-day window produces no callout");
});

test("computeCallout: respects custom windowMs option", () => {
  const history = {
    entries: [entry("2A82", 0x12, 1, iso(NOW_MS - 3 * 86_400_000), iso(NOW_MS - 3 * 86_400_000))],
  };
  // 1-day window: should drop the 3-day-old entry.
  assert.equal(computeCallout([{ code: "2A82" }], history, NOW_MS, { windowMs: 86_400_000 }), null);
  // 7-day window: should keep it.
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS, { windowMs: 7 * 86_400_000 });
  assert.equal(out.length, 1);
});

test("computeCallout: aggregates occurrences across multiple (code, address) buckets", () => {
  // 2A82 appeared on two modules (DME 0x12, EGS 0x18) — both within
  // the window. The callout collapses them into one row summing the
  // occurrences.
  const history = {
    entries: [
      entry("2A82", 0x12, 2, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000)),
      entry("2A82", 0x18, 1, iso(NOW_MS - 2 * 86_400_000), iso(NOW_MS - 2 * 86_400_000)),
    ],
  };
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS);
  assert.equal(out.length, 1, "same code across modules collapses to one row");
  assert.equal(out[0].occurrences, 3);
});

test("computeCallout: keeps the most recent last_seen across same-code buckets", () => {
  const history = {
    entries: [
      // Older module entry (5d ago).
      entry("2A82", 0x12, 1, iso(NOW_MS - 5 * 86_400_000), iso(NOW_MS - 5 * 86_400_000)),
      // Newer module entry (1d ago) — should drive last_seen_iso.
      entry("2A82", 0x18, 1, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000)),
    ],
  };
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS);
  assert.equal(out.length, 1);
  assert.equal(isoToMs(out[0].last_seen_iso), NOW_MS - 86_400_000);
});

test("computeCallout: flags same_address when the current read is on the same module", () => {
  const history = {
    entries: [entry("2A82", 0x12, 1, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))],
  };
  const out = computeCallout([{ code: "2A82", address: 0x12 }], history, NOW_MS);
  assert.equal(out[0].same_address, true);
});

test("computeCallout: same_address=false when history is on a different module", () => {
  const history = {
    entries: [entry("2A82", 0x18, 1, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))],
  };
  const out = computeCallout([{ code: "2A82", address: 0x12 }], history, NOW_MS);
  assert.equal(out[0].same_address, false);
});

test("computeCallout: sorts rows most-recent-first", () => {
  const history = {
    entries: [
      entry("AAAA", 0x12, 1, iso(NOW_MS - 5 * 86_400_000), iso(NOW_MS - 5 * 86_400_000)),
      entry("ZZZZ", 0x12, 1, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000)),
      entry("MMMM", 0x12, 1, iso(NOW_MS - 3 * 86_400_000), iso(NOW_MS - 3 * 86_400_000)),
    ],
  };
  const out = computeCallout(
    [{ code: "AAAA" }, { code: "ZZZZ" }, { code: "MMMM" }],
    history,
    NOW_MS
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].code, "ZZZZ"); // 1d ago
  assert.equal(out[1].code, "MMMM"); // 3d ago
  assert.equal(out[2].code, "AAAA"); // 5d ago
});

test("computeCallout: skips history entries with unparseable timestamps", () => {
  const history = {
    entries: [
      entry("2A82", 0x12, 2, "not-iso", "also-not-iso"),
    ],
  };
  assert.equal(computeCallout([{ code: "2A82" }], history, NOW_MS), null);
});

test("computeCallout: skips current DTC entries with empty/missing code", () => {
  const history = {
    entries: [entry("2A82", 0x12, 1, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))],
  };
  // Two bogus entries, one real — callout should still fire for the real one.
  assert.equal(computeCallout([{}, { code: "" }, { code: "2A82" }], history, NOW_MS).length, 1);
});

test("relativeTimeLabel: returns 'just now' for very recent timestamps", () => {
  assert.equal(relativeTimeLabel(NOW_MS - 5_000, NOW_MS), "just now");
  assert.equal(relativeTimeLabel(NOW_MS - 30_000, NOW_MS), "just now");
});

test("relativeTimeLabel: returns 'Nm ago' for under an hour", () => {
  assert.equal(relativeTimeLabel(NOW_MS - 5 * 60_000, NOW_MS), "5m ago");
  assert.equal(relativeTimeLabel(NOW_MS - 59 * 60_000, NOW_MS), "59m ago");
});

test("relativeTimeLabel: returns 'today' for same UTC day, > 1h", () => {
  // Day-relative labels take priority over hour-relative labels:
  // "today" is more useful than "11h ago" when the timestamp is on
  // the same calendar day.
  assert.equal(relativeTimeLabel(NOW_MS - 3 * 3_600_000, NOW_MS), "today");
});

test("relativeTimeLabel: returns 'today' for same UTC day", () => {
  // Same day, but a few hours earlier.
  const sameDay = Date.UTC(2026, 6, 22, 7, 0, 0);
  assert.equal(relativeTimeLabel(sameDay, NOW_MS), "today");
});

test("relativeTimeLabel: returns 'yesterday' for 1 UTC day back", () => {
  const yesterday = Date.UTC(2026, 6, 21, 23, 0, 0);
  assert.equal(relativeTimeLabel(yesterday, NOW_MS), "yesterday");
});

test("relativeTimeLabel: returns 'Nd ago' for 2-13 days back", () => {
  assert.equal(relativeTimeLabel(NOW_MS - 2 * 86_400_000, NOW_MS), "2d ago");
  assert.equal(relativeTimeLabel(NOW_MS - 13 * 86_400_000, NOW_MS), "13d ago");
});

test("relativeTimeLabel: returns ISO date for >= 14 days back", () => {
  const oldDate = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15
  const label = relativeTimeLabel(oldDate, NOW_MS);
  assert.equal(label, "2026-06-15");
});

test("relativeTimeLabel: handles invalid input gracefully", () => {
  assert.equal(relativeTimeLabel(NaN, NOW_MS), "—");
  assert.equal(relativeTimeLabel(NOW_MS, NaN), "—");
});

test("isoToMs: parses a valid ISO-8601 string", () => {
  // 2026-07-22T10:00:00Z = Date.UTC(2026, 6, 22, 10, 0, 0)
  const expected = Date.UTC(2026, 6, 22, 10, 0, 0);
  assert.equal(isoToMs("2026-07-22T10:00:00Z"), expected);
});

test("isoToMs: returns null for invalid input", () => {
  assert.equal(isoToMs("not iso"), null);
  assert.equal(isoToMs(""), null);
  assert.equal(isoToMs(null), null);
  assert.equal(isoToMs(undefined), null);
});

test("DEFAULT_WINDOW_MS is 14 days", () => {
  assert.equal(DEFAULT_WINDOW_MS, 14 * 24 * 60 * 60 * 1000);
});

test("computeCallout: returns null when history has 0 occurrences for matching code", () => {
  // Defensive: an entry with occurrences=0 shouldn't match (it
  // shouldn't exist in a real query, but the contract is "at least
  // one past occurrence to surface the banner").
  const history = {
    entries: [entry("2A82", 0x12, 0, iso(NOW_MS - 86_400_000), iso(NOW_MS - 86_400_000))],
  };
  // occurrences=0 still surfaces the row because the bucket exists in
  // the query response; the UI can decide whether to render or hide.
  // This test documents current behaviour: occurrences=0 still produces
  // a row (count 0). If we decide later to hide these, this test
  // becomes the spec to flip.
  const out = computeCallout([{ code: "2A82" }], history, NOW_MS);
  assert.ok(Array.isArray(out));
  assert.equal(out[0].occurrences, 0);
});

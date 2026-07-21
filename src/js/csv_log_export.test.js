"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildLogCsv } = require("../../src/js/csv_log_export.js");

// Helper to build a fake series entry matching the shape `main.js` produces:
//   { label, unit, getAllData() -> [{x, y, text?}, ...] }
function series(label, unit, points) {
  return [label, { label, unit, getAllData: () => points }];
}

test("buildLogCsv: returns null when there are no enabled series", () => {
  assert.equal(buildLogCsv([]), null);
  assert.equal(buildLogCsv([["x", { label: "x", unit: "", getAllData: () => [] }]]), null);
});

test("buildLogCsv: default shape matches the on-disk format", () => {
  // Mirrors `beeemuu-log-2026-07-06T20-37-19.csv`:
  //   header = "time_s" + 1 col per series (label + unit)
  //   data rows = 2 cols per series (numeric `y` + LiveFormat.csvCell)
  // The first numeric cell and the LiveFormat cell are typically
  // identical for purely-numeric readings; they differ for enum-style
  // data points (text-only).
  const entries = [
    series("Engine speed", "rpm", [{ x: 24.01, y: 739 }, { x: 24.26, y: 743.75 }]),
    series("Coolant temp", "°C", [{ x: 24.01, y: 27 }, { x: 24.26, y: 27 }]),
  ];
  const csv = buildLogCsv(entries);
  const lines = csv.split("\n");
  assert.equal(lines[0], "time_s,Engine speed (rpm),Coolant temp (°C)");
  // Time column is `.toFixed(2)` per the pre-extraction behaviour.
  // Numeric cells are `.toFixed(2)` too — the current `main.js` code
  // emits both the bare `y` and the LiveFormat.csvCell-shaped second
  // cell per series, which for purely-numeric readings are equal.
  assert.equal(lines[1], "24.01,739.00,739.00,27.00,27.00");
  assert.equal(lines[2], "24.26,743.75,743.75,27.00,27.00");
  // No "units" row in the default shape.
  assert.ok(!csv.includes("\nunits,"), "default export should not include the units row");
});

test("buildLogCsv: withUnits adds a units row with one cell per series", () => {
  const entries = [
    series("Engine speed", "rpm", [{ x: 24.01, y: 739 }]),
    series("Coolant temp", "°C", [{ x: 24.01, y: 27 }]),
  ];
  const csv = buildLogCsv(entries, { withUnits: true });
  const lines = csv.split("\n");
  // Header: 1 cell per series.
  assert.equal(lines[0], "time_s,Engine speed (rpm),Coolant temp (°C)");
  // Units row: "units" + 1 cell per series. Two-cell pairing with the
  // data row is preserved by aligning the data row's second cell with
  // the same series's unit.
  assert.equal(lines[1], "units,rpm,°C");
  // Data row starts at line index 2 now. Time column is `.toFixed(2)`.
  assert.equal(lines[2], "24.01,739.00,739.00,27.00,27.00");
});

test("buildLogCsv: withUnits row can be parsed by a naive comma split", () => {
  // A consumer that doesn't know about the units row will treat it as
  // data; that's acceptable as long as the header columns line up
  // (the "units" literal in the time column signals row 2 is meta).
  const entries = [
    series("A", "u1", [{ x: 0, y: 1 }]),
    series("B", "u2", [{ x: 0, y: 2 }]),
    series("C", "u3", [{ x: 0, y: 3 }]),
  ];
  const csv = buildLogCsv(entries, { withUnits: true });
  const rows = csv.trimEnd().split("\n");
  // Header has 4 cells (time + 3 series).
  assert.equal(rows[0].split(",").length, 4);
  // Units row has 4 cells.
  assert.equal(rows[1].split(",").length, 4);
  // Data row has 7 cells (time + 2 per series).
  assert.equal(rows[2].split(",").length, 7);
  assert.equal(rows[2], "0.00,1.00,1.00,2.00,2.00,3.00,3.00");
});

test("buildLogCsv: enum text points emit JSON-quoted labels in the second cell", () => {
  // For enum-style readings, the first cell is the numeric `y` and the
  // second cell is the LiveFormat.csvCell(point) which carries the
  // human-readable enum label. (Pure-numeric readings have both cells
  // equal, which is why the default-shape test asserts the duplicate.)
  const entries = [
    series("Mode", "state", [
      { x: 0, y: 1, text: "open" },
      { x: 1, y: 0, text: "closed" },
    ]),
  ];
  const csv = buildLogCsv(entries);
  const lines = csv.split("\n");
  // Header (1 col) + 2 data rows.
  assert.equal(lines[0], "time_s,Mode (state)");
  // For enum-style readings, both cells emit the JSON-quoted text
  // (the first cell takes the `text` branch, the second is the
  // LiveFormat-shaped cell which also JSON-quotes the text). The
  // numeric `y` is ignored on this branch — preserved from the
  // pre-extraction behaviour.
  assert.equal(lines[1], '0.00,"open","open"');
  assert.equal(lines[2], '1.00,"closed","closed"');
});

test("buildLogCsv: accepts a custom liveFormat.csvCell helper", () => {
  // A caller that wants the second cell to differ from the first can
  // pass a custom `liveFormat.csvCell`. We verify the helper is honoured.
  const entries = [
    series("X", "u", [{ x: 0, y: 42 }]),
  ];
  const csv = buildLogCsv(entries, { liveFormat: { csvCell: () => "<custom>" } });
  const lines = csv.split("\n");
  assert.equal(lines[1], "0.00,42.00,<custom>");
});

test("buildLogCsv: emits the empty cell for NaN/Infinity y (LiveFormat handles it)", () => {
  // The pre-extraction code `(p.y ?? "").toFixed(2)` produces the
  // string "NaN" for non-finite `y` — preserved here on purpose so
  // the wire format is byte-identical to `main.js`'s shipped output.
  // The default `csvCell` (and the real `LiveFormat.csvCell`) emits
  // an empty cell for non-finite, which is the desired behaviour in
  // the second column.
  const entries = [
    series("X", "u", [
      { x: 0, y: 1 },
      { x: 1, y: NaN },
      { x: 2, y: Infinity },
      { x: 3, y: 3 },
    ]),
  ];
  const csv = buildLogCsv(entries);
  const lines = csv.split("\n");
  // Row 2: y is NaN -> first cell is the literal "NaN" (pre-extraction
  // behaviour), second cell is empty (default csvCell guards).
  assert.equal(lines[1], "0.00,1.00,1.00");
  assert.equal(lines[2], "1.00,NaN,");
  assert.equal(lines[3], "2.00,Infinity,");
  assert.equal(lines[4], "3.00,3.00,3.00");
  // Sanity: we did NOT introduce new "NaN" emissions; the count matches
  // what `main.js` ships today.
  assert.ok(!lines[1].includes("NaN"));
});

test("buildLogCsv: aligns rows by index across series of equal length", () => {
  // The on-disk assumption (same as the pre-extraction `main.js`
  // implementation): every enabled series has the same point count.
  const entries = [
    series("A", "u", [{ x: 0, y: 1 }, { x: 1, y: 2 }]),
    series("B", "u", [{ x: 0, y: 10 }, { x: 1, y: 20 }]),
  ];
  const csv = buildLogCsv(entries);
  const lines = csv.split("\n");
  assert.equal(lines[1], "0.00,1.00,1.00,10.00,10.00");
  assert.equal(lines[2], "1.00,2.00,2.00,20.00,20.00");
});

test("buildLogCsv: withUnits row is the second line, immediately after the header", () => {
  // Property: position of the units row matters for downstream
  // consumers — they're expected to either skip it or treat row 2
  // as metadata. Verify it's strictly row 2 (index 1 after split).
  const entries = [
    series("Pressure", "psi", [{ x: 0, y: 30 }]),
  ];
  const csv = buildLogCsv(entries, { withUnits: true });
  const lines = csv.split("\n");
  assert.equal(lines[0], "time_s,Pressure (psi)");
  assert.equal(lines[1], "units,psi");
  assert.ok(!lines[1].endsWith(","), "units row should not have a trailing comma");
});

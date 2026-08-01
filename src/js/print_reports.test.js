"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const reports = require("./print_reports.js");

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

const info = { vin: "WBA123", mileage_km: 123456, decode: { manufacturer: "BMW", model_year: 2012 } };

test("service history is stored per VIN and sorted newest first", () => {
  const storage = memoryStorage();
  reports.saveHistory(storage, "VIN-A", [{ date: "2025-01-01", service: "Oil" }, { date: "2026-01-01", service: "Brakes" }]);
  reports.saveHistory(storage, "VIN-B", [{ date: "2024-01-01", service: "Tyres" }]);
  assert.deepEqual(reports.loadHistory(storage, "VIN-A").map((e) => e.service), ["Brakes", "Oil"]);
  assert.equal(reports.loadHistory(storage, "VIN-B")[0].service, "Tyres");
});

test("health report includes vehicle, faults, and cautious recommended work", () => {
  const html = reports.buildHealthReport(info, [{ present: true, name: "DME", dtcs: [{ code: "2A82", text: "VANOS intake", status_text: "confirmed" }] }], new Date("2026-01-02T00:00:00Z"));
  assert.match(html, /Vehicle Health Report/);
  assert.match(html, /WBA123/);
  assert.match(html, /2A82/);
  assert.match(html, /Diagnose VANOS intake before replacing parts/);
});

test("service report escapes owner-entered content", () => {
  const html = reports.buildServiceHistoryReport(info, [{ date: "2026-01-01", service: "Oil <script>", notes: "A&B" }]);
  assert.match(html, /Oil &lt;script&gt;/);
  assert.match(html, /A&amp;B/);
  assert.doesNotMatch(html, /Oil <script>/);
});

test("saving without a VIN is rejected", () => {
  assert.throws(() => reports.saveHistory(memoryStorage(), "", []), /VIN/);
});

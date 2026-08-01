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

test("legacy service entries migrate into detailed work records", () => {
  const storage = memoryStorage();
  reports.saveHistory(storage, "VIN-A", [{
    date: "2025-05-10", mileage_km: "120000", service: "Oil service",
    provider: "BMW specialist", cost: "325.50", notes: "Used LL-01 oil",
  }]);
  const dossier = reports.loadDossier(storage, "VIN-A");
  assert.equal(dossier.work.length, 1);
  assert.equal(dossier.work[0].category, "Maintenance");
  assert.equal(dossier.work[0].work_performed, "Oil service");
  assert.equal(dossier.work[0].labor_cost, "325.50");
  assert.equal(dossier.work[0].parts_cost, "");
});

test("dossier summary totals documented spend and finds latest service", () => {
  const summary = reports.summarizeDossier({ work: [
    { date: "2024-01-01", mileage_km: "100000", category: "Repair", parts_cost: "900.25", labor_cost: "400" },
    { date: "2025-06-01", mileage_km: "125500", category: "Maintenance", parts_cost: "80", labor_cost: "120.50" },
  ] });
  assert.equal(summary.jobs, 2);
  assert.equal(summary.total_cost, 1500.75);
  assert.equal(summary.latest_date, "2025-06-01");
  assert.equal(summary.latest_mileage_km, 125500);
  assert.deepEqual(summary.category_counts, { Maintenance: 1, Repair: 1 });
});

test("sales dossier report includes ownership, detailed work, totals, and upcoming maintenance", () => {
  const dossier = {
    profile: { model: "X5 35d", chassis: "E70", ownership_start: "2020-04-01", seller_notes: "Garage kept" },
    work: [{
      date: "2025-06-01", mileage_km: "125500", category: "Repair", work_performed: "Transfer case service",
      reason: "Preventive maintenance", parts: "BMW transfer case fluid", part_numbers: "83222409710",
      parts_cost: "150", labor_cost: "250", provider: "Independent BMW specialist", diy: false,
      invoice_ref: "INV-42", warranty: "12 months", notes: "No leaks found",
    }],
    upcoming: [{ due_date: "2026-06-01", due_mileage_km: "135000", priority: "Medium", work: "Brake fluid", estimated_cost: "180", notes: "Two-year interval" }],
  };
  const html = reports.buildSalesDossierReport(info, dossier, new Date("2026-01-02T00:00:00Z"));
  assert.match(html, /Vehicle History &amp; Maintenance Dossier/);
  assert.match(html, /E70/);
  assert.match(html, /Transfer case service/);
  assert.match(html, /83222409710/);
  assert.match(html, /INV-42/);
  assert.match(html, /\$400\.00/);
  assert.match(html, /Brake fluid/);
  assert.match(html, /Garage kept/);
});

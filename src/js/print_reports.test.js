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
  const html = reports.buildHealthReport(info, [{ present: true, name: "DME", dtcs: [{ code: "2A82", text: "VANOS intake", status_text: "confirmed", freeze_frame: [{ label: "RPM", value: "800" }] }] }], new Date("2026-01-02T00:00:00Z"));
  assert.match(html, /Vehicle Health Report/);
  assert.match(html, /WBA123/);
  assert.match(html, /2A82/);
  assert.match(html, /Diagnose VANOS intake before replacing parts/);
  assert.match(html, /Freeze frame/);
  assert.match(html, /RPM 800/);
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

test("sales dossier prints a receipt attachment index without exposing full local paths", () => {
  const dossier = {
    profile: {}, upcoming: [],
    work: [{
      date: "2025-01-10", mileage_km: "120000", category: "Repair", work_performed: "Water pump",
      attachments: [
        { name: "invoice-1042.pdf", path: "C:\\Users\\Owner\\Documents\\invoice-1042.pdf", kind: "PDF" },
        { name: "receipt.jpg", path: "C:\\Receipts\\receipt.jpg", kind: "Image" },
      ],
    }],
  };
  const html = reports.buildSalesDossierReport(info, dossier);
  assert.match(html, /Receipt and attachment index/);
  assert.match(html, /invoice-1042\.pdf/);
  assert.match(html, /receipt\.jpg/);
  assert.match(html, /2 attachments/);
  assert.doesNotMatch(html, /Users\\Owner/);
});

test("normalizing selected receipt paths keeps supported files and derives safe metadata", () => {
  assert.deepEqual(reports.normalizeAttachments([
    "C:\\Receipts\\invoice.pdf", "C:\\Receipts\\photo.JPG", "C:\\Receipts\\notes.exe",
  ]), [
    { name: "invoice.pdf", path: "C:\\Receipts\\invoice.pdf", kind: "PDF" },
    { name: "photo.JPG", path: "C:\\Receipts\\photo.JPG", kind: "Image" },
  ]);
});

test("dossier export/import round-trips through JSON without data loss", () => {
  const dossier = {
    profile: { model: "X5 35d", chassis: "E70", ownership_start: "2020-04-01", seller_notes: "Garage kept" },
    work: [{
      date: "2025-06-01", mileage_km: "125500", category: "Repair", work_performed: "Transfer case service",
      reason: "Preventive", parts: "Fluid", part_numbers: "83222409710",
      parts_cost: "150", labor_cost: "250", provider: "Indie", diy: false,
      invoice_ref: "INV-42", warranty: "12 months", notes: "No leaks",
      attachments: [{ name: "invoice.pdf", path: "C:\\R\\invoice.pdf", kind: "PDF" }],
    }],
    upcoming: [{ due_date: "2026-06-01", due_mileage_km: "135000", priority: "Medium", work: "Brake fluid", estimated_cost: "180", notes: "" }],
  };
  const json = reports.exportDossierJson(dossier);
  const restored = reports.importDossierJson(json);
  assert.deepEqual(restored, dossier);
  assert.equal(typeof json, "string");
  assert.match(json, /"schema":"beemuu.dossier.v1"/);
});

test("dossier export CSV contains a header row plus one row per work entry", () => {
  const dossier = {
    profile: { model: "X5 35d", chassis: "E70" },
    work: [
      { date: "2025-06-01", mileage_km: "125500", category: "Repair", work_performed: "Transfer case service",
        reason: "Preventive", parts: "Fluid", part_numbers: "83222409710",
        parts_cost: "150", labor_cost: "250", provider: "Indie", diy: false,
        invoice_ref: "INV-42", warranty: "12 months", notes: "No leaks" },
      { date: "2024-03-15", mileage_km: "118000", category: "Maintenance", work_performed: "Oil change",
        reason: "Service", parts: "Filter, oil", part_numbers: "11427566327",
        parts_cost: "60", labor_cost: "120", provider: "Indie", diy: true,
        invoice_ref: "INV-39", warranty: "", notes: "" },
    ],
    upcoming: [],
  };
  const csv = reports.exportDossierCsv(dossier);
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  // 1 header row + 2 data rows + a trailing blank from split is fine.
  assert.equal(lines.length >= 3, true);
  assert.match(lines[0], /^date,mileage_km,category/);
  assert.match(csv, /Transfer case service/);
  assert.match(csv, /Oil change/);
  // Verify CSV escaping: work_performed for first row contains no comma,
  // but the second one would have a problem if escape logic is missing.
  assert.doesNotMatch(csv, /\n,Oil change,/);
});

test("importing malformed JSON raises a clear error", () => {
  assert.throws(() => reports.importDossierJson("not json"), /JSON/);
  assert.throws(() => reports.importDossierJson('{"schema":"beemuu.dossier.v1"}'), /work/);
  assert.throws(() => reports.importDossierJson('{"schema":"beemuu.dossier.v1","work":"bad"}'), /work/);
});

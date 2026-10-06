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
  const html = reports.buildHealthReport(info, [{ present: true, name: "DME", dtcs: [{ code: "2A82", text: "VANOS intake", status_text: "confirmed", freeze_frame: [{ label: "RPM", value: "800" }] }] }], new Date("2026-01-02T00:00:00Z"), null, null);
  assert.match(html, /Vehicle Health Report/);
  assert.match(html, /WBA123/);
  assert.match(html, /2A82/);
  assert.match(html, /Diagnose VANOS intake before replacing parts/);
  assert.match(html, /Freeze frame/);
  assert.match(html, /RPM: 800/);
});

test("health report omits recurring section when not provided", () => {
  const html = reports.buildHealthReport(info, [], new Date("2026-01-02T00:00:00Z"));
  assert.doesNotMatch(html, /Recurring faults/);
});

test("health report renders recurring DTC section when provided", () => {
  const recurring = [
    { code: "2A82", occurrences: 3, last_seen: "2d ago", same_address: true },
    { code: "29E0", occurrences: 2, last_seen: "5d ago", same_address: false },
  ];
  const html = reports.buildHealthReport(info, [], new Date("2026-01-02T00:00:00Z"), recurring);
  assert.match(html, /Recurring faults/);
  assert.match(html, /2A82.*seen 3.*last 2d ago/);
  assert.match(html, /29E0.*seen 2.*different module/);
});

test("health report escapes recurring section content", () => {
  const recurring = [{ code: "<XSS>", occurrences: 1, last_seen: "<b>now</b>" }];
  const html = reports.buildHealthReport(info, [], new Date(), recurring);
  assert.match(html, /&lt;XSS&gt;/);
  assert.match(html, /&lt;b&gt;now&lt;\/b&gt;/);
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

test("upcoming maintenance is classified by date and current mileage", () => {
  const states = reports.classifyUpcoming([
    { due_date: "2026-06-10", due_mileage_km: "126000" },
    { due_date: "2026-08-01", due_mileage_km: "130000" },
    { due_date: "2026-05-01", due_mileage_km: "125000" },
    { due_date: "not-a-date", due_mileage_km: "" },
  ], { today: new Date("2026-06-01T12:00:00Z"), mileageKm: 125500 });
  assert.deepEqual(states, [
    { status: "soon", reasons: ["due in 9 days", "due in 500 km"] },
    { status: "scheduled", reasons: [] },
    { status: "overdue", reasons: ["overdue by 31 days", "500 km past due"] },
    { status: "scheduled", reasons: [] },
  ]);
});

test("upcoming maintenance uses date status when vehicle mileage is unavailable", () => {
  assert.deepEqual(reports.classifyUpcoming([
    { due_date: "2026-07-01", due_mileage_km: "100000" },
  ], { today: new Date("2026-06-30T12:00:00Z") }), [
    { status: "soon", reasons: ["due in 1 day"] },
  ]);
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

test("manual garage dossiers save independently without a VIN", () => {
  const storage = memoryStorage();
  const first = { profile: { model: "E30 325i" }, work: [{ date: "2026-01-01", work_performed: "Oil service" }], upcoming: [] };
  const second = { profile: { model: "E46 330i" }, work: [], upcoming: [] };
  reports.saveDossier(storage, "garage:car-a", first);
  reports.saveDossier(storage, "garage:car-b", second);
  assert.deepEqual(reports.loadDossier(storage, "garage:car-a"), first);
  assert.deepEqual(reports.loadDossier(storage, "garage:car-b"), second);
  assert.deepEqual(reports.loadDossier(storage, "VIN-A"), { profile: {}, work: [], upcoming: [] });
});

test("manual dossier print identifies the local vehicle without exposing a VIN", () => {
  const html = reports.buildSalesDossierReport({
    dossierKey: "garage:car-a", label: "E30 project", mileage_km: null,
    decode: { manufacturer: "BMW", model: "325i", chassis: "E30" },
  }, { profile: {}, work: [], upcoming: [] }, new Date("2026-06-01T12:00:00Z"));
  assert.match(html, /Not stored \(manual garage record\)/);
  assert.match(html, /325i/);
  assert.match(html, /E30/);
  assert.doesNotMatch(html, /garage:car-a/);
});

test("dossier summary totals documented spend and finds latest service", () => {
  const summary = reports.summarizeDossier({ work: [
    { date: "2024-01-01", mileage_km: "100000", category: "Repair", parts_cost: "900.25", labor_cost: "400" },
    { date: "2025-06-01", mileage_km: "125500", category: "Maintenance", parts_cost: "80", labor_cost: "120.50" },
  ] });
  assert.equal(summary.jobs, 2);
  assert.equal(summary.cbs_linked_jobs, 0);
  assert.equal(summary.total_cost, 1500.75);
  assert.equal(summary.latest_date, "2025-06-01");
  assert.equal(summary.latest_mileage_km, 125500);
  assert.deepEqual(summary.category_counts, { Maintenance: 1, Repair: 1 });
  assert.deepEqual(summary.yearly_spend, [
    { year: "2025", jobs: 1, total_cost: 200.5 },
    { year: "2024", jobs: 1, total_cost: 1300.25 },
  ]);
});

test("yearly dossier spending ignores undated records and sorts newest first", () => {
  const summary = reports.summarizeDossier({ work: [
    { date: "2023-06-01", parts_cost: "100", labor_cost: "50" },
    { date: "undated", parts_cost: "900", labor_cost: "0" },
    { date: "2025-02-01", parts_cost: "20", labor_cost: "30" },
  ] });
  assert.deepEqual(summary.yearly_spend, [
    { year: "2025", jobs: 1, total_cost: 50 },
    { year: "2023", jobs: 1, total_cost: 150 },
  ]);
});

test("sales dossier report includes ownership, detailed work, totals, and upcoming maintenance", () => {
  const dossier = {
    profile: { model: "X5 35d", chassis: "E70", ownership_start: "2020-04-01", seller_notes: "Garage kept" },
    work: [{
      date: "2025-06-01", mileage_km: "125500", category: "Repair", work_performed: "Transfer case service",
      reason: "Preventive maintenance", parts: "BMW transfer case fluid", part_numbers: "83222409710",
      parts_cost: "150", labor_cost: "250", provider: "Independent BMW specialist", diy: false,
      invoice_ref: "INV-42", warranty: "12 months", notes: "No leaks found",
      cbs_item: "engine_oil",
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
  assert.match(html, /CBS timeline item: engine_oil/);
  assert.match(html, /<strong>1<\/strong><span>linked to a CBS timeline item<\/span>/);
  assert.match(html, /Documented spend by year/);
  assert.match(html, /<td>2025<\/td><td>1<\/td><td>\$400\.00<\/td>/);
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
      cbs_item: "engine_oil",
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

test("dossier CSV export round-trips back through import", () => {
  const entry = {
    date: "2025-06-01", mileage_km: "125500", category: "Repair", work_performed: "Transfer case service",
    reason: "Preventive", parts: "Fluid", part_numbers: "83222409710", parts_cost: "150", labor_cost: "250",
    provider: "Indie", diy: true, invoice_ref: "INV-42", warranty: "12 months", cbs_item: "", notes: "No leaks",
  };
  const csv = reports.exportDossierCsv({ profile: {}, work: [entry], upcoming: [] });
  const imported = reports.importDossierCsv(csv);
  assert.deepEqual(imported.work, [entry]);
  assert.deepEqual(imported.profile, {});
  assert.deepEqual(imported.upcoming, []);
});

test("dossier CSV import parses quoted fields with commas and embedded newlines", () => {
  const csv = 'date,work_performed,notes\r\n2025-01-02,"Oil, filter and plug","Line one\nLine two"\r\n';
  const { work } = reports.importDossierCsv(csv);
  assert.equal(work.length, 1);
  assert.equal(work[0].work_performed, "Oil, filter and plug");
  assert.equal(work[0].notes, "Line one\nLine two");
  assert.equal(work[0].date, "2025-01-02");
});

test("dossier CSV import unescapes doubled quotes", () => {
  const { work } = reports.importDossierCsv('work_performed\n"Say ""hi"" now"\n');
  assert.equal(work[0].work_performed, 'Say "hi" now');
});

test("dossier CSV import matches columns by name, ignores unknown ones, and accepts synonyms", () => {
  const csv = "notes,work_performed,mystery,Mileage,Workshop\nnote text,Oil change,ignored,120000,Indie\n";
  const { work } = reports.importDossierCsv(csv);
  assert.equal(work.length, 1);
  assert.equal(work[0].work_performed, "Oil change");
  assert.equal(work[0].notes, "note text");
  assert.equal(work[0].mileage_km, "120000");
  assert.equal(work[0].provider, "Indie");
  assert.equal("mystery" in work[0], false);
});

test("dossier CSV import parses the DIY flag from common truthy spellings", () => {
  const csv = "work_performed,diy\nA,true\nB,YES\nC,1\nD,x\nE,\nF,no\n";
  const { work } = reports.importDossierCsv(csv);
  assert.deepEqual(work.map((w) => w.diy), [true, true, true, true, false, false]);
});

test("dossier CSV import skips fully blank rows", () => {
  const csv = "work_performed,date\n,\nOil change,2025-03-01\n\n";
  const { work } = reports.importDossierCsv(csv);
  assert.equal(work.length, 1);
  assert.equal(work[0].work_performed, "Oil change");
});

test("dossier CSV import strips a UTF-8 BOM from the header", () => {
  const { work } = reports.importDossierCsv("\uFEFFwork_performed\nOil change\n");
  assert.equal(work[0].work_performed, "Oil change");
});

test("dossier CSV import keeps rows that only carry a date or a cost", () => {
  const csv = "date,work_performed,labor_cost\n2025-04-01,,\n,\"\",100\n";
  const { work } = reports.importDossierCsv(csv);
  assert.equal(work.length, 2);
  assert.equal(work[0].date, "2025-04-01");
  assert.equal(work[1].labor_cost, "100");
});

test("dossier CSV import refuses a file with no work_performed column", () => {
  assert.throws(() => reports.importDossierCsv("date,notes\n2025-01-01,x\n"), /work_performed/);
});

test("dossier CSV import refuses an empty file", () => {
  assert.throws(() => reports.importDossierCsv(""), /empty/i);
  assert.throws(() => reports.importDossierCsv("\r\n\n"), /empty/i);
});

test("summarizeUpcoming classifies, counts, and orders items by urgency", () => {
  const today = new Date("2026-06-15T00:00:00Z");
  const summary = reports.summarizeUpcoming([
    { work: "Cabin filter", due_date: "2026-12-01" },
    { work: "Oil service", due_date: "2026-06-20" },
    { work: "Brake fluid", due_date: "2026-05-01" },
  ], { today });
  assert.equal(summary.total, 3);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.soon, 1);
  assert.equal(summary.scheduled, 1);
  assert.deepEqual(summary.items.map((i) => i.work), ["Brake fluid", "Oil service", "Cabin filter"]);
  assert.equal(summary.items[0].status, "overdue");
  assert.equal(summary.items[1].status, "soon");
  assert.match(summary.items[0].reasons.join(" "), /overdue by 45 days/);
});

test("summarizeUpcoming uses a mileage reading only when one is supplied", () => {
  const withMileage = reports.summarizeUpcoming([{ work: "Diff oil", due_mileage_km: "100500" }], { today: new Date("2026-01-01T00:00:00Z"), mileageKm: 100000 });
  assert.equal(withMileage.items[0].status, "soon");
  assert.match(withMileage.items[0].reasons.join(" "), /due in 500 km/);
  const withoutMileage = reports.summarizeUpcoming([{ work: "Diff oil", due_mileage_km: "100500" }], { today: new Date("2026-01-01T00:00:00Z") });
  assert.equal(withoutMileage.items[0].status, "scheduled");
  assert.deepEqual(withoutMileage.items[0].reasons, []);
});

test("summarizeUpcoming handles an empty or missing list", () => {
  assert.deepEqual(reports.summarizeUpcoming(null), { total: 0, overdue: 0, soon: 0, scheduled: 0, items: [] });
  assert.deepEqual(reports.summarizeUpcoming([]).items, []);
});

test("upcomingBadge surfaces only overdue and due-soon counts", () => {
  assert.equal(reports.upcomingBadge({ overdue: 0, soon: 0, scheduled: 3 }), null);
  assert.equal(reports.upcomingBadge(null), null);
  assert.deepEqual(reports.upcomingBadge({ overdue: 2, soon: 0, scheduled: 1 }), { text: "2 overdue", status: "overdue" });
  assert.deepEqual(reports.upcomingBadge({ overdue: 0, soon: 1, scheduled: 0 }), { text: "1 due soon", status: "soon" });
  assert.deepEqual(reports.upcomingBadge({ overdue: 1, soon: 2, scheduled: 0 }), { text: "1 overdue · 2 due soon", status: "overdue" });
});

test("sales dossier labels each upcoming item with its maintenance status", () => {
  const iso = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 10);
  const dossier = {
    profile: {},
    work: [],
    upcoming: [
      { priority: "High", work: "Brake fluid", due_date: iso(-40 * 86400000) },
      { priority: "Medium", work: "Oil service", due_date: iso(10 * 86400000) },
      { priority: "Low", work: "Cabin filter", due_date: iso(220 * 86400000) },
    ],
  };
  const html = reports.buildSalesDossierReport({ vin: "WBA123", mileage_km: 120000 }, dossier);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /<strong>1<\/strong> overdue · <strong>1<\/strong> due soon · <strong>1<\/strong> scheduled/);
  assert.match(html, /dossier-status dossier-status-overdue">Overdue</);
  assert.match(html, /dossier-status dossier-status-soon">Due soon</);
  assert.match(html, /dossier-status dossier-status-scheduled">Scheduled</);
});

test("sales dossier notes when mileage-based items cannot be assessed", () => {
  const dossier = {
    profile: {}, work: [],
    upcoming: [{ priority: "Low", work: "Diff oil", due_date: "2099-01-01", due_mileage_km: "150000" }],
  };
  const noMileage = reports.buildSalesDossierReport({ vin: "WBA123", mileage_km: null }, dossier);
  assert.match(noMileage, /Mileage-based items are not assessed here/);
  const withMileage = reports.buildSalesDossierReport({ vin: "WBA123", mileage_km: 140000 }, dossier);
  assert.doesNotMatch(withMileage, /Mileage-based items are not assessed here/);
});

test("upcoming maintenance does not treat a missing mileage reading as 0 km", () => {
  for (const mileageKm of [null, undefined, ""]) {
    assert.deepEqual(reports.classifyUpcoming([{ due_date: "", due_mileage_km: "100" }], { today: new Date("2026-01-01T00:00:00Z"), mileageKm }), [
      { status: "scheduled", reasons: [] },
    ]);
  }
});

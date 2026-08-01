"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuPrintReports = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STORAGE_KEY = "beeemuu_service_history_v1";

  function safeText(value, fallback = "—") {
    if (value === null || value === undefined || String(value).trim() === "") return fallback;
    return String(value);
  }

  function escapeHtml(value) {
    return safeText(value, "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[ch]);
  }

  function loadHistory(storage, vin) {
    if (!storage || !vin) return [];
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
      const entries = Array.isArray(parsed[vin]) ? parsed[vin] : [];
      return entries.filter((entry) => entry && typeof entry === "object")
        .sort((a, b) => safeText(b.date, "").localeCompare(safeText(a.date, "")));
    } catch (_) {
      return [];
    }
  }

  function saveHistory(storage, vin, entries) {
    if (!storage || !vin) throw new Error("Read the vehicle VIN before saving service history.");
    let parsed = {};
    try { parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}"); } catch (_) {}
    parsed[vin] = entries;
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }

  function vehicleBlock(info) {
    const decode = info?.decode || {};
    return `<dl class="vehicle-grid">
      <div><dt>VIN</dt><dd>${escapeHtml(info?.vin)}</dd></div>
      <div><dt>Mileage</dt><dd>${info?.mileage_km != null ? escapeHtml(info.mileage_km) + " km" : "—"}</dd></div>
      <div><dt>Manufacturer</dt><dd>${escapeHtml(decode.manufacturer)}</dd></div>
      <div><dt>Model year</dt><dd>${escapeHtml(decode.model_year)}</dd></div>
    </dl>`;
  }

  function buildHealthReport(info, modules, generatedAt = new Date()) {
    const present = (modules || []).filter((m) => m.present);
    const faults = present.flatMap((m) => (m.dtcs || []).map((d) => ({ ...d, module: m.name })));
    const faultRows = faults.length ? faults.map((d) => `<tr><td>${escapeHtml(d.module)}</td><td>${escapeHtml(d.code)}</td><td>${escapeHtml(d.text)}</td><td>${escapeHtml(d.status_text)}</td></tr>`).join("") : `<tr><td colspan="4">No stored faults were included in this report.</td></tr>`;
    return `<article class="print-report"><header><h1>Beemuu Vehicle Health Report</h1><p>Generated ${escapeHtml(generatedAt.toLocaleString())}</p></header>
      ${vehicleBlock(info)}
      <h2>Diagnostic summary</h2><p>${present.length} control unit${present.length === 1 ? "" : "s"} identified · ${faults.length} stored fault${faults.length === 1 ? "" : "s"}</p>
      <table><thead><tr><th>Module</th><th>Code</th><th>Finding</th><th>Status</th></tr></thead><tbody>${faultRows}</tbody></table>
      <h2>Recommended work</h2><ul>${faults.length ? faults.map((d) => `<li><strong>${escapeHtml(d.code)}:</strong> Diagnose ${escapeHtml(d.text, "the reported condition")} before replacing parts. Confirm with BMW service information and vehicle-specific testing.</li>`).join("") : "<li>No fault-led work is indicated by the data included in this report.</li>"}</ul>
      <p class="disclaimer">Diagnostic aid only. A fault code does not by itself prove that a component needs replacement.</p></article>`;
  }

  function buildServiceHistoryReport(info, entries, generatedAt = new Date()) {
    const rows = entries.length ? entries.map((e) => `<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.mileage_km)}${e.mileage_km ? " km" : ""}</td><td>${escapeHtml(e.service)}</td><td>${escapeHtml(e.provider)}</td><td>${escapeHtml(e.cost)}</td><td>${escapeHtml(e.notes)}</td></tr>`).join("") : `<tr><td colspan="6">No service-history entries recorded.</td></tr>`;
    return `<article class="print-report"><header><h1>Beemuu Service History</h1><p>Generated ${escapeHtml(generatedAt.toLocaleString())}</p></header>
      ${vehicleBlock(info)}
      <h2>Maintenance and repairs</h2><table><thead><tr><th>Date</th><th>Mileage</th><th>Service / repair</th><th>Provider</th><th>Cost</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="disclaimer">Owner-entered record. Verify invoices and workshop documentation when proof of service is required.</p></article>`;
  }

  function printHtml(documentRef, html) {
    let host = documentRef.getElementById("print-report-host");
    if (!host) {
      host = documentRef.createElement("div");
      host.id = "print-report-host";
      documentRef.body.appendChild(host);
    }
    host.innerHTML = html;
    documentRef.defaultView.print();
  }

  return { STORAGE_KEY, loadHistory, saveHistory, buildHealthReport, buildServiceHistoryReport, printHtml };
});

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuPrintReports = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STORAGE_KEY = "beeemuu_service_history_v1";
  const DOSSIER_KEY = "beeemuu_vehicle_dossiers_v2";

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

  function emptyDossier() {
    return { profile: {}, work: [], upcoming: [] };
  }

  function migrateLegacyEntry(entry) {
    return {
      date: safeText(entry.date, ""), mileage_km: safeText(entry.mileage_km, ""), category: "Maintenance",
      work_performed: safeText(entry.service, ""), reason: "", parts: "", part_numbers: "", parts_cost: "",
      labor_cost: safeText(entry.cost, ""), provider: safeText(entry.provider, ""), diy: false,
      invoice_ref: "", warranty: "", notes: safeText(entry.notes, ""),
    };
  }

  function loadDossier(storage, vin) {
    if (!storage || !vin) return emptyDossier();
    try {
      const dossiers = JSON.parse(storage.getItem(DOSSIER_KEY) || "{}");
      const dossier = dossiers[vin];
      if (dossier && typeof dossier === "object") {
        return {
          profile: dossier.profile && typeof dossier.profile === "object" ? dossier.profile : {},
          work: Array.isArray(dossier.work) ? dossier.work : [],
          upcoming: Array.isArray(dossier.upcoming) ? dossier.upcoming : [],
        };
      }
    } catch (_) {}
    return { profile: {}, work: loadHistory(storage, vin).map(migrateLegacyEntry), upcoming: [] };
  }

  function saveDossier(storage, vin, dossier) {
    if (!storage || !vin) throw new Error("Read the vehicle VIN before saving its dossier.");
    let dossiers = {};
    try { dossiers = JSON.parse(storage.getItem(DOSSIER_KEY) || "{}"); } catch (_) {}
    dossiers[vin] = dossier;
    storage.setItem(DOSSIER_KEY, JSON.stringify(dossiers));
  }

  function moneyValue(value) {
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function summarizeDossier(dossier) {
    const work = Array.isArray(dossier?.work) ? dossier.work : [];
    const sorted = work.slice().sort((a, b) => safeText(b.date, "").localeCompare(safeText(a.date, "")));
    const categoryCounts = {};
    for (const entry of work) {
      const category = safeText(entry.category, "Other");
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
    return {
      jobs: work.length,
      total_cost: work.reduce((sum, entry) => sum + moneyValue(entry.parts_cost) + moneyValue(entry.labor_cost), 0),
      latest_date: sorted[0]?.date || "",
      latest_mileage_km: Number(sorted[0]?.mileage_km) || null,
      category_counts: Object.fromEntries(Object.entries(categoryCounts).sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  function formatMoney(value) {
    return `$${moneyValue(value).toFixed(2)}`;
  }

  function normalizeAttachments(paths) {
    return (Array.isArray(paths) ? paths : []).flatMap((path) => {
      const value = String(path || "");
      const name = value.split(/[\\/]/).pop() || "";
      const extension = (name.split(".").pop() || "").toLowerCase();
      if (extension === "pdf") return [{ name, path: value, kind: "PDF" }];
      if (["jpg", "jpeg", "png", "webp"].includes(extension)) return [{ name, path: value, kind: "Image" }];
      return [];
    });
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

  function freezeSnippet(dtc) {
    const frames = Array.isArray(dtc?.freeze_frame) ? dtc.freeze_frame : [];
    if (!frames.length) return "—";
    return frames.map((f) => `${safeText(f.label)} ${safeText(f.value)}`).join(" · ");
  }

  function buildHealthReport(info, modules, generatedAt = new Date()) {
    const present = (modules || []).filter((m) => m.present);
    const faults = present.flatMap((m) => (m.dtcs || []).map((d) => ({ ...d, module: m.name })));
    const faultRows = faults.length ? faults.map((d) => `<tr><td>${escapeHtml(d.module)}</td><td>${escapeHtml(d.code)}</td><td>${escapeHtml(d.text)}</td><td>${escapeHtml(d.status_text)}</td><td>${escapeHtml(freezeSnippet(d))}</td></tr>`).join("") : `<tr><td colspan="5">No stored faults were included in this report.</td></tr>`;
    return `<article class="print-report"><header><h1>Beemuu Vehicle Health Report</h1><p>Generated ${escapeHtml(generatedAt.toLocaleString())}</p></header>
      ${vehicleBlock(info)}
      <h2>Diagnostic summary</h2><p>${present.length} control unit${present.length === 1 ? "" : "s"} identified · ${faults.length} stored fault${faults.length === 1 ? "" : "s"}</p>
      <table><thead><tr><th>Module</th><th>Code</th><th>Finding</th><th>Status</th><th>Freeze frame</th></tr></thead><tbody>${faultRows}</tbody></table>
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

  function buildSalesDossierReport(info, dossier, generatedAt = new Date()) {
    const profile = dossier?.profile || {};
    const work = (dossier?.work || []).slice().sort((a, b) => safeText(a.date, "").localeCompare(safeText(b.date, "")));
    const upcoming = dossier?.upcoming || [];
    const summary = summarizeDossier(dossier);
    const categories = Object.entries(summary.category_counts).map(([name, count]) => `${escapeHtml(name)}: ${count}`).join(" · ") || "No categories recorded";
    const workCards = work.length ? work.map((entry) => {
      const total = moneyValue(entry.parts_cost) + moneyValue(entry.labor_cost);
      return `<section class="dossier-work"><div class="dossier-work-head"><strong>${escapeHtml(entry.date)} · ${escapeHtml(entry.category)}</strong><span>${escapeHtml(entry.mileage_km)}${entry.mileage_km ? " km" : ""}</span></div>
        <h3>${escapeHtml(entry.work_performed)}</h3>
        <dl class="dossier-details"><div><dt>Reason / symptoms</dt><dd>${escapeHtml(entry.reason)}</dd></div><div><dt>Performed by</dt><dd>${entry.diy ? "Owner / DIY" : escapeHtml(entry.provider)}</dd></div><div><dt>Parts</dt><dd>${escapeHtml(entry.parts)}</dd></div><div><dt>Part numbers</dt><dd>${escapeHtml(entry.part_numbers)}</dd></div><div><dt>Parts cost</dt><dd>${formatMoney(entry.parts_cost)}</dd></div><div><dt>Labor cost</dt><dd>${formatMoney(entry.labor_cost)}</dd></div><div><dt>Total</dt><dd>${formatMoney(total)}</dd></div><div><dt>Invoice / receipt</dt><dd>${escapeHtml(entry.invoice_ref)}</dd></div><div><dt>Warranty</dt><dd>${escapeHtml(entry.warranty)}</dd></div></dl>
        ${entry.notes ? `<p><strong>Notes:</strong> ${escapeHtml(entry.notes)}</p>` : ""}</section>`;
    }).join("") : "<p>No completed work has been recorded.</p>";
    const upcomingRows = upcoming.length ? upcoming.map((entry) => `<tr><td>${escapeHtml(entry.priority)}</td><td>${escapeHtml(entry.work)}</td><td>${escapeHtml(entry.due_date)}</td><td>${escapeHtml(entry.due_mileage_km)}${entry.due_mileage_km ? " km" : ""}</td><td>${formatMoney(entry.estimated_cost)}</td><td>${escapeHtml(entry.notes)}</td></tr>`).join("") : `<tr><td colspan="6">No upcoming maintenance recorded.</td></tr>`;
    const receiptRows = work.flatMap((entry) => {
      const rows = [];
      if (entry.invoice_ref) rows.push(`<li>☐ ${escapeHtml(entry.date)} — ${escapeHtml(entry.work_performed)} — ${escapeHtml(entry.invoice_ref)}</li>`);
      for (const attachment of (entry.attachments || [])) rows.push(`<li>☐ ${escapeHtml(entry.date)} — ${escapeHtml(entry.work_performed)} — ${escapeHtml(attachment.name)} (${escapeHtml(attachment.kind)})</li>`);
      return rows;
    }).join("") || "<li>No receipt references or attachments recorded.</li>";
    const attachmentCount = work.reduce((count, entry) => count + (entry.attachments || []).length, 0);
    return `<article class="print-report dossier-report"><header><h1>Vehicle History &amp; Maintenance Dossier</h1><p>Prepared for sale · Generated ${escapeHtml(generatedAt.toLocaleString())}</p></header>
      ${vehicleBlock(info)}
      <dl class="vehicle-grid"><div><dt>Model</dt><dd>${escapeHtml(profile.model)}</dd></div><div><dt>Chassis</dt><dd>${escapeHtml(profile.chassis)}</dd></div><div><dt>Ownership since</dt><dd>${escapeHtml(profile.ownership_start)}</dd></div><div><dt>Recorded jobs</dt><dd>${summary.jobs}</dd></div></dl>
      ${profile.seller_notes ? `<section class="dossier-overview"><h2>Owner's overview</h2><p>${escapeHtml(profile.seller_notes)}</p></section>` : ""}
      <section><h2>Documented history summary</h2><div class="dossier-stats"><div><strong>${summary.jobs}</strong><span>jobs recorded</span></div><div><strong>${formatMoney(summary.total_cost)}</strong><span>documented spend</span></div><div><strong>${escapeHtml(summary.latest_date)}</strong><span>latest service</span></div><div><strong>${summary.latest_mileage_km ? escapeHtml(summary.latest_mileage_km) + " km" : "—"}</strong><span>latest service mileage</span></div></div><p>${categories}</p></section>
      <section><h2>Completed maintenance and repairs</h2>${workCards}</section>
      <section><h2>Upcoming maintenance</h2><table><thead><tr><th>Priority</th><th>Work</th><th>Due date</th><th>Due mileage</th><th>Estimate</th><th>Notes</th></tr></thead><tbody>${upcomingRows}</tbody></table></section>
      <section><h2>Receipt and attachment index</h2><p>${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} stored as local file references.</p><ul class="receipt-list">${receiptRows}</ul></section>
      <p class="disclaimer">Owner-entered record prepared for a prospective buyer. Costs, dates, and work descriptions should be verified against the referenced invoices, receipts, and workshop documentation.</p></article>`;
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

  // -- Dossier export / import -------------------------------------------------
  // Format a dossier for backup, sharing between cars (e.g. moving the
  // history from one E70 to another), or restoring after a reinstall.
  // The schema version is checked on import so older JSON files can be
  // migrated or rejected with a clear error.

  const DOSSIER_SCHEMA = "beemuu.dossier.v1";

  function exportDossierJson(dossier) {
    return JSON.stringify({
      schema: DOSSIER_SCHEMA,
      exported_at: new Date().toISOString(),
      profile: dossier?.profile || {},
      work: Array.isArray(dossier?.work) ? dossier.work : [],
      upcoming: Array.isArray(dossier?.upcoming) ? dossier.upcoming : [],
    });
  }

  function importDossierJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error("Dossier JSON is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Dossier JSON is not an object");
    }
    if (parsed.schema !== DOSSIER_SCHEMA) {
      throw new Error(`Unsupported dossier schema: ${parsed.schema || "(missing)"}`);
    }
    if (!Array.isArray(parsed.work)) {
      throw new Error("Dossier JSON is missing the 'work' array");
    }
    return {
      profile: parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {},
      work: parsed.work,
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
    };
  }

  // CSV: header + one row per work entry. Stable column order so users
  // can paste into Excel / Google Sheets without re-mapping.
  const CSV_COLUMNS = [
    "date", "mileage_km", "category", "work_performed", "reason", "parts", "part_numbers",
    "parts_cost", "labor_cost", "provider", "diy", "invoice_ref", "warranty", "notes",
  ];

  function csvField(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function exportDossierCsv(dossier) {
    const rows = Array.isArray(dossier?.work) ? dossier.work : [];
    const lines = [CSV_COLUMNS.join(",")];
    for (const entry of rows) {
      lines.push(CSV_COLUMNS.map((c) => csvField(entry?.[c])).join(","));
    }
    return lines.join("\r\n") + "\r\n";
  }

  return {
    STORAGE_KEY, DOSSIER_KEY, loadHistory, saveHistory, loadDossier, saveDossier, summarizeDossier,
    normalizeAttachments, freezeSnippet, buildHealthReport, buildServiceHistoryReport, buildSalesDossierReport,
    exportDossierJson, importDossierJson, exportDossierCsv, printHtml,
  };
});

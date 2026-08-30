"use strict";

// E90 FRM coding dump (read-only).
//
// Formats a research capture of FRM (0x72) identify + local-ID/DID
// probe results. No write path, no bit map, no Spiegel_Komfort_einklapp
// decode — mirror-fold state is always "Unknown" until a real-car
// before/after dump is filed per docs/validation/coding-mirror-fold.md.
//
// Wrapped in an IIFE so top-level `const api` does not clash with
// can_decoders.js / live_can_source.js (classic <script> tags share
// one declarative scope). That clash was aborting this file and left
// the Service Functions card saying "FRM dump helper not loaded."
//
// Dual export: CommonJS for `node --test`, window.beeemuuFrmCodingDump
// in the Tauri webview.

(function (root, factory) {
  const api = factory();
  if (root) root.beeemuuFrmCodingDump = api;
  try {
    if (typeof module === "object" && module.exports) module.exports = api;
  } catch (_) { /* not a CommonJS host */ }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {

/** Footwell module diagnostic address (E-series K+DCAN). */
const FRM_ADDRESS = 0x72;
const FRM_NAME = "FRM";

/** We do not ship a grounded bit map. Do not invent one. */
const MIRROR_FOLD_STATE = "Unknown";

/** Full KWP local-identifier space. probe_range max is 512. */
const LOCAL_PROBE = { mode: "local", start: 0, end: 0xff };

/** First 256 UDS DIDs — E90 FRM is KWP-first; this is the secondary pass. */
const DID_PROBE = { mode: "did", start: 0, end: 0xff };

/**
 * Find FRM in a scan_modules result list.
 * @param {Array<{address: number, present?: boolean, ident?: string, name?: string}>} modules
 * @returns {object|null}
 */
function findFrm(modules) {
  if (!Array.isArray(modules)) return null;
  return modules.find((m) => m && m.address === FRM_ADDRESS) || null;
}

/**
 * One-line ident for the UI card.
 * @param {object|null} frm
 * @param {{connected?: boolean}} [opts]
 * @returns {string}
 */
function identLabel(frm, opts) {
  const connected = !!(opts && opts.connected);
  if (!connected) return "Not connected";
  if (frm && frm.present && frm.ident) return String(frm.ident);
  if (frm && frm.present) return "FRM present (no ident string)";
  return "FRM not scanned — Export will identify 0x72";
}

/**
 * VIN safe for a filename. BMW VINs are 17 graphic ASCII; anything else
 * becomes "unknown" so we never write path separators.
 * @param {string|null|undefined} vin
 * @returns {string}
 */
function sanitizeVin(vin) {
  if (typeof vin !== "string") return "unknown";
  const cleaned = vin.trim().replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length ? cleaned : "unknown";
}

/**
 * Same stamp shape as the other ~/beeemuu-exports/ writers in main.js.
 * @param {Date} [now]
 * @returns {string}
 */
function exportStamp(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * @param {{vin?: string|null, now?: Date}} [opts]
 * @returns {string}
 */
function dumpFilename(opts) {
  const vin = sanitizeVin(opts && opts.vin);
  const stamp = exportStamp(opts && opts.now);
  return `beeemuu-frm-coding-${vin}-${stamp}.txt`;
}

function formatIdentId(mode, id) {
  if (mode === "did") {
    return "0x" + Number(id).toString(16).toUpperCase().padStart(4, "0");
  }
  return "0x" + Number(id).toString(16).toUpperCase().padStart(2, "0");
}

/**
 * @param {string} mode
 * @param {Array<{id: number, hex: string}>} results
 * @returns {string}
 */
function formatProbeSection(mode, results) {
  const rows = Array.isArray(results) ? results : [];
  const label = mode === "did" ? "did (UDS 22)" : "local (KWP 21)";
  const lines = [`# ${label} — ${rows.length} answered`];
  for (const r of rows) {
    const hex = r && r.hex != null ? String(r.hex) : "";
    lines.push(`${formatIdentId(mode, r.id)}  ${hex}`.trimEnd());
  }
  return lines.join("\n");
}

/**
 * Build the on-disk dump text.
 * @param {{
 *   ident?: string|null,
 *   vin?: string|null,
 *   localResults?: Array<{id: number, hex: string}>,
 *   didResults?: Array<{id: number, hex: string}>,
 *   exportedAt?: string,
 * }} opts
 * @returns {string}
 */
function buildDumpText(opts) {
  const o = opts || {};
  const exportedAt = o.exportedAt || "";
  const vin = o.vin || "unavailable";
  const ident = o.ident || "(none)";
  const header = [
    "# BeeEmUu FRM coding dump (read-only)",
    "# Research capture only. Does not decode Spiegel_Komfort_einklapp.",
    `# Mirror-fold state: ${MIRROR_FOLD_STATE}`,
    "# See docs/validation/coding-mirror-fold.md",
    "#",
    `# exported_at: ${exportedAt}`,
    `# vin: ${vin}`,
    `# target: 0x${FRM_ADDRESS.toString(16).toUpperCase()} ${FRM_NAME}`,
    `# ident: ${ident}`,
    "#",
  ];
  return [
    header.join("\n"),
    formatProbeSection("local", o.localResults),
    "#",
    formatProbeSection("did", o.didResults),
    "",
  ].join("\n");
}

return {
  FRM_ADDRESS,
  FRM_NAME,
  MIRROR_FOLD_STATE,
  LOCAL_PROBE,
  DID_PROBE,
  findFrm,
  identLabel,
  sanitizeVin,
  exportStamp,
  dumpFilename,
  formatIdentId,
  formatProbeSection,
  buildDumpText,
};

});

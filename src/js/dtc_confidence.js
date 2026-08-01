"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.beeemuuDtcConfidence = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const BUILT_IN_HIGH = new Set([
    "2A82", "2A87", "30FF", "30F0", "2E81", "2E82", "29CC", "29CD", "29CE", "29CF",
    "29D0", "29D1", "29D2", "2C9C", "2FBF", "278A", "2DED", "5DF0", "5E20", "5E21",
    "9CBA", "9CBB", "A0B4", "9312", "D354", "4F81", "930B",
  ]);
  const FALLBACK_TEXT_PREFIX = "No description in local database";

  function classifyDtc(d) {
    const code = String(d?.code || "").toUpperCase();
    const text = String(d?.text || "");
    const isFallback = text.trim().startsWith(FALLBACK_TEXT_PREFIX);
    if (isFallback) return "unknown";
    if (BUILT_IN_HIGH.has(code)) return "verified";
    return "community";
  }

  function badgeFor(d) {
    const level = classifyDtc(d);
    if (level === "verified") return { level, label: "Verified", className: "dtc-badge dtc-badge-verified" };
    if (level === "community") return { level, label: "Community", className: "dtc-badge dtc-badge-community" };
    return { level, label: "Needs verification", className: "dtc-badge dtc-badge-unverified" };
  }

  function rowHtml(d, baseRowHtml) {
    return baseRowHtml + ` <span class="${badgeFor(d).className}" title="${badgeFor(d).label} description">${badgeFor(d).label}</span>`;
  }

  return { classifyDtc, badgeFor, rowHtml };
});
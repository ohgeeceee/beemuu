"use strict";

// Share log — POST CSV to /api/logs, get id + viewer URL
async function shareLog(csvText, apiBase) {
  const base = (apiBase || "").replace(/\/$/, "") || "";
  const res = await fetch(base + "/api/logs", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: csvText,
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error("share failed " + res.status + " " + txt);
  }
  const data = await res.json();
  return data; // {id, url, size}
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { shareLog };
}
if (typeof window !== "undefined") {
  window.beeemuuLogShare = { shareLog };
}

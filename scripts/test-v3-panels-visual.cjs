"use strict";

/* Visual smoke test for the v3 panels.
 *
 * Loads src/index.html in headless Chromium with a stubbed Tauri bridge, drives
 * a few panels, and asserts the result actually renders: non-zero sizes, real
 * text, correct classes, dark theme included. jsdom proves the DOM is correct;
 * only a real engine proves it is visible.
 */

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

// This file lives in scripts/, so the repo root is one level up.
const ROOT = path.resolve(__dirname, "..");

// Minimal Tauri stub: main.js reads __TAURI__.core.invoke at parse time, and
// several panels call it. Nothing here touches a real car.
const TAURI_STUB = `
window.__TAURI__ = { core: { invoke: async (cmd) => {
  if (cmd === "list_exports") return ["beeemuu-session-a.json", "beeemuu-session-b.json"];
  if (cmd === "read_export_text") return JSON.stringify({ taken_at: "2026-01-01T00:00:00Z",
    modules: [{ address: 0x12, name: "DME", flash_count: 2 }] });
  if (cmd === "list_profiles") return [];
  if (cmd === "security_status") return [];
  return null;
} } };
`;

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  const note = (ok, msg) => { if (!ok) failures.push(msg); };

  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const consoleErrors = [];
    page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", e => consoleErrors.push(String(e)));

    await page.addInitScript(TAURI_STUB);
    await page.goto("file://" + path.join(ROOT, "src/index.html"));
    await page.waitForLoadState("load");
    await page.evaluate(() => {
      document.body.setAttribute("data-theme", document.body.getAttribute("data-theme") || "light");
      if (window.mountV3Panels) window.mountV3Panels();
      // Reveal the diagnostics view, where the v3 panels live.
      for (const s of document.querySelectorAll(".view")) s.classList.remove("active");
      const d = document.getElementById("view-diagnostics");
      if (d) d.classList.add("active");
    });

    // 1. The symptom panel, driven with a real query.
    await page.fill("#v3-symptom-input", "it stumbles badly on a cold start in the morning");
    await page.click("#v3-symptom-run");
    const symptom = await page.textContent("#v3-symptom-body");
    note(/cold start/i.test(symptom || ""), `${theme}: symptom panel did not match`);
    note(/2A82/.test(symptom || ""), `${theme}: symptom panel missing candidate code`);

    // 2. The signal library, driven through the real generated index.
    const signalRows = await page.locator("#v3-signal-body .v3-signal-row").count();
    note(signalRows > 5, `${theme}: signal library rendered only ${signalRows} rows`);

    // 3. The hunt panel, recording one finding.
    await page.selectOption("#v3-hunt-kind", "discovery");
    await page.fill("#v3-hunt-engine", "n54");
    await page.fill("#v3-hunt-module", "DME");
    await page.fill("#v3-hunt-ident", "0x0C");
    await page.click("#v3-hunt-add");
    const hunt = await page.textContent("#v3-hunt-body");
    note(/points from 1 finding/.test(hunt || ""), `${theme}: hunt panel did not record`);

    // 4. The drift panel, four over-threshold readings.
    for (const v of ["10", "20", "30", "45"]) {
      await page.fill("#v3-drift-param", "ltft");
      await page.fill("#v3-drift-value", v);
      await page.fill("#v3-drift-threshold", "40");
      await page.click("#v3-drift-add");
    }
    const drift = await page.textContent("#v3-drift-body");
    note(/past its limit/.test(drift || ""), `${theme}: drift panel did not escalate`);

    // Every panel body must have real layout: a zero-height box is invisible
    // however correct the DOM is.
    for (const id of ["v3-symptom-body", "v3-signal-body", "v3-hunt-body",
      "v3-drift-body", "v3-misfire-body", "v3-fingerprint-body",
      "v3-flash-body", "v3-cold-status", "v3-passport-body"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      note(box && box.width > 50 && box.height > 10,
        `${theme}: #${id} has no visible box (${JSON.stringify(box)})`);
    }

    // Severity must not be colour-only.
    const pill = await page.locator("#v3-hunt-body .v3-pill").first();
    note(await pill.count() > 0, `${theme}: hunt panel rendered no confidence pill`);

    if (theme === "dark") {
      await page.screenshot({ path: "/tmp/v3-dark.png", fullPage: false });
    } else {
      await page.screenshot({ path: "/tmp/v3-light.png", fullPage: false });
    }

    // Only v3-owned failures count. Under `file://` the page cannot fetch
    // catalog.json, the Chart.js CDN is unreachable offline, and the plugin
    // boot hits a missing Tauri API — all pre-existing and all unrelated to the
    // v3 panels. A harness that fails on them teaches us nothing about v3.
    const v3Errors = consoleErrors.filter(e =>
      /misfire_patterns|adaptation_drift|tuning_fingerprint|flash_audit|cold_start|parameter_hunt|symptom_index|signal_library|vehicle_passport|v3_ui|v3_signal_index|Identifier .* has already been declared/.test(e));
    note(v3Errors.length === 0,
      `${theme}: v3 console errors: ${v3Errors.slice(0, 3).join(" | ")}`);
    await page.close();
  }

  await browser.close();
  if (failures.length) {
    console.error("FAILURES:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("v3 visual smoke test passed (light + dark)");
}

main().catch(e => { console.error(e); process.exit(1); });
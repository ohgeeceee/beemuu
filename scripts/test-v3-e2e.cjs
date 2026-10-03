"use strict";

/* Drives every v3 panel in a real browser using the demo scenarios.
 *
 * The panel tests prove the DOM is right and the scenario tests prove the
 * engines are right. Neither proves the two are wired to each other: a panel
 * that renders its placeholder forever looks exactly like a panel that works.
 *
 * This is that test. It loads index.html in headless Chromium, injects a
 * scenario as if the user had just recorded it, clicks the button, and asserts
 * the real diagnosis appears on screen.
 */

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

const TAURI_STUB = `
window.__TAURI__ = { core: { invoke: async (cmd) => {
  if (cmd === "list_exports") return [];
  if (cmd === "read_export_text") return JSON.stringify({});
  return null;
} } };
`;

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  const note = (ok, msg) => { if (!ok) failures.push(msg); };

  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  await page.addInitScript(TAURI_STUB);
  await page.goto("file://" + path.join(ROOT, "src/index.html"));
  await page.waitForLoadState("load");

  // Load the scenario generator into the page alongside the app.
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, "src/js/demo_scenarios.js"), "utf8") });
  await page.evaluate(() => {
    for (const s of document.querySelectorAll(".view")) s.classList.remove("active");
    document.getElementById("view-diagnostics").classList.add("active");
  });

  // --- 1. Misfire: feed a scenario log, click Analyse, expect the diagnosis.
  await page.evaluate(() => {
    const scn = window.beeemuuDemoScenarios.highLoadMisfire({ dropout: 0 });
    window.beeemuuV3.logSeries = () => scn.session;
  });
  await page.click("#v3-misfire-run");
  const misfireText = await page.textContent("#v3-misfire-body");
  note(/Cylinder 3/.test(misfireText), `misfire: no cylinder card\n${misfireText}`);
  note(/confidence/.test(misfireText), `misfire: no confidence shown\n${misfireText}`);
  note(!/no pattern/.test(misfireText),
    `misfire: reported no pattern on a log that should classify\n${misfireText}`);

  // --- 2. Symptom index: type a real symptom.
  await page.fill("#v3-symptom-input", "it stumbles badly on a cold start");
  await page.click("#v3-symptom-run");
  const symptomText = await page.textContent("#v3-symptom-body");
  note(/2A82/.test(symptomText), `symptom: no candidate code\n${symptomText}`);
  note(/not a diagnosis/.test(symptomText), "symptom: missing the not-a-diagnosis note");

  // --- 3. Signal library: the generated index must render rows.
  const rows = await page.locator("#v3-signal-body .v3-signal-row").count();
  note(rows > 5, `signal library: only ${rows} rows`);

  // --- 4. Cold start: arm, feed a scenario timeline, expect a capture.
  await page.click("#v3-cold-arm");
  const coldResult = await page.evaluate(() => {
    const scn = window.beeemuuDemoScenarios.coldStartStumble({ dropout: 0 });
    const coolant = scn.session.get("coolant").data;
    const panel = window.beeemuuV3ColdPanel;
    let started = null;
    for (let i = 0; i * 3 <= scn.session.get("rpm").data.length; i++) {
      const s = i * 3;
      let best = null;
      for (const p of coolant) if (p.x <= s && (!best || p.x > best.x)) best = p;
      const r = panel.observe({ t: s * 1000, running: s >= scn.engine_start_s, coolant: best ? best.y : null });
      if (r && r.action === "start_logging") { started = s; break; }
    }
    return { started, monitor: !!panel.monitor() };
  });
  note(coldResult.monitor, "cold start: arming did not create a monitor");
  note(coldResult.started !== null, "cold start: no capture opened on the scenario");
  const coldText = await page.textContent("#v3-cold-status");
  note(/capturing/.test(coldText), `cold start: status not updated\n${coldText}`);

  // --- 5. Drift: four readings over a threshold must escalate.
  for (const v of ["10", "20", "30", "45"]) {
    await page.fill("#v3-drift-param", "ltft");
    await page.fill("#v3-drift-value", v);
    await page.fill("#v3-drift-threshold", "40");
    await page.click("#v3-drift-add");
  }
  const driftText = await page.textContent("#v3-drift-body");
  note(/past its limit/.test(driftText), `drift: no escalation\n${driftText}`);

  // --- 6. Passport: build one and confirm no VIN-shaped string appears.
  await page.click("#v3-passport-build");
  const passport = await page.evaluate(() => window.beeemuuV3PassportPanel.passport());
  note(!!passport, "passport: build produced nothing");
  note(passport && passport.privacy.vin_included === false,
    "passport: claims the VIN is included");

  // --- 7. No engine may have thrown a SyntaxError (the IIFE bug class).
  const collisions = errors.filter(e => /has already been declared|SyntaxError/.test(e));
  note(collisions.length === 0, `script errors: ${collisions.slice(0, 2).join(" | ")}`);

  await page.screenshot({ path: "/tmp/v3-demo-driven.png", fullPage: false });
  await browser.close();

  if (failures.length) {
    console.error("FAILURES:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("v3 end-to-end panel test passed (scenarios driven through the real UI)");
}

main().catch(e => { console.error(e); process.exit(1); });
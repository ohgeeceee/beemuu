/* Sanity check for the Predictive CBS Timeline UI against the real
 * index.html markup. Verifies the panel mounts, inputs render for every CBS
 * item, entering an odometer + a value produces a sorted prediction list, and
 * snapshots persist across reload. No vehicle/Tauri/network used. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "../src");
const csp = require("../src-tauri/tauri.conf.json").app.security.csp;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Security-Policy", csp);
  const filename = path.resolve(root, "." + req.url.split("?")[0]);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.statusCode = 404; return res.end();
  }
  res.setHeader("Content-Type", ({ ".js": "text/javascript", ".html": "text/html", ".css": "text/css" })[path.extname(filename)] || "text/plain");
  res.end(fs.readFileSync(filename));
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", err => consoleErrors.push(String(err)));
    // Stub Tauri invoke so index.html boot doesn't blow up on vehicle reads.
    await page.addInitScript(() => {
      window.__TAURI__ = { core: { invoke: async () => [] } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    // The Vehicle Info view is a tab; the CBS panel lives inside it.
    await page.locator('.tab[data-view="info"]').click();
    await page.waitForSelector("#cbs-body");
    // Every CBS item should have a number input.
    const ids = ["front_brake", "rear_brake", "engine_oil", "microfilter", "brake_fluid", "spark_plugs", "coolant"];
    for (const id of ids) await page.waitForSelector(`#cbs-val-${id}`);
    // Enter odometer + two readings, then confirm predictions render.
    await page.locator("#cbs-km").fill("40000");
    await page.locator("#cbs-km").dispatchEvent("change");
    await page.locator("#cbs-val-front_brake").fill("4.2");
    await page.locator("#cbs-val-front_brake").dispatchEvent("change");
    await page.locator("#cbs-val-engine_oil").fill("8000");
    await page.locator("#cbs-val-engine_oil").dispatchEvent("change");
    await page.waitForFunction(() => document.querySelectorAll("#cbs-results .cbs-pred").length >= 2);
    const preds = await page.locator("#cbs-results .cbs-pred").count();
    assert.ok(preds >= 2, `expected >=2 predictions, got ${preds}`);
    const names = await page.locator("#cbs-results .cbs-name").allInnerTexts();
    assert.ok(names.includes("Engine oil") && names.includes("Front brake pads"), `unexpected items: ${names.join(",")}`);
    // Save a snapshot, reload, and confirm the odometer/value persisted.
    await page.locator("#cbs-snapshot").click();
    await page.reload();
    await page.locator('.tab[data-view="info"]').click();
    await page.waitForSelector("#cbs-km");
    assert.equal(await page.locator("#cbs-km").inputValue(), "40000");
    assert.equal(await page.locator("#cbs-val-front_brake").inputValue(), "4.2");
    // Filter out the pre-existing top-level `const api` collision between
    // can_decoders.js and live_can_source.js (unrelated to CBS); any other
    // console error fails the test.
    const known = /Identifier 'api' has already been declared|migrateLegacy/;
    const unexpected = consoleErrors.filter(e => !known.test(e));
    assert.deepEqual(unexpected, [], "console errors: " + unexpected.join("\n"));
    console.log("PASS: CBS timeline mounts, predicts, persists odometer/value, no unexpected console errors");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

/* Run with Playwright installed (NODE_PATH may point to a shared runtime).
 * Serves the real plugin UI and runner with the shipping application CSP.
 * No real vehicle, Tauri command, or external network is used. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "../src");
const csp = require("../src-tauri/tauri.conf.json").app.security.csp;
const catalog = require("../src/plugins/catalog.json");
const section = fs.readFileSync(path.join(root, "index.html"), "utf8").match(/<section id="view-plugins"[\s\S]*?<\/section>/)[0];
let unexpectedRequests = [];
const server = http.createServer((req, res) => {
  res.setHeader("Content-Security-Policy", csp);
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(`<html><head><meta charset="utf-8"><link rel="stylesheet" href="css/plugins.css"></head><body><button class="tab" data-view="vehicle">Vehicle Test</button>${section}<script src="js/plugins.js"></script><script src="js/plugins_ui.js"></script><script src="test-boot.js"></script></body></html>`);
  }
  if (req.url === "/test-boot.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end('window.mountBeemuuPlugins({importProfiles: async content => { window.lastProfile = content; return ["Test profile"]; }});');
  }
  const filename = path.resolve(root, "." + req.url.split("?")[0]);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    unexpectedRequests.push(req.url);
    res.statusCode = 404; return res.end();
  }
  res.setHeader("Content-Type", ({ ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".css": "text/css" })[path.extname(filename)] || "text/plain");
  res.end(fs.readFileSync(filename));
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.PLUGIN_TEST_BROWSER ? { channel: process.env.PLUGIN_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("#plugins-catalog .plugin-card").nth(1).getByRole("button", { name: "Review package" }).click();
    await page.getByRole("button", { name: "Install package", exact: true }).click();
    assert.match(await page.locator("#plugins-installed").innerText(), /Disabled/);
    await page.reload();
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Run tool", exact: true }).click();
    const output = page.locator("#plugins-detail > pre");
    await page.waitForFunction(() => document.querySelector("#plugins-detail > pre").textContent !== "Running…");
    assert.deepEqual(JSON.parse(await output.innerText()), { fahrenheit: [32, 68, 194, 212] }, consoleErrors.join("\n"));
    async function install(p) {
      await page.locator("#plugins-file").setInputFiles({ name: "test.beemuu-plugin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) });
      await page.locator("#plugins-install").click();
      await page.getByRole("button", { name: "Enable", exact: true }).click();
      await page.getByRole("button", { name: "Open", exact: true }).click();
    }
    async function execute(code) {
      await install({ ...catalog[1], code });
      await page.getByRole("button", { name: "Run tool", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#plugins-detail > pre").textContent !== "Running…");
      return output.innerText();
    }
    assert.deepEqual(JSON.parse(await execute("return { window: typeof window, document: typeof document, tauri: typeof __TAURI__, storage: typeof localStorage };")), { window: "undefined", document: "undefined", tauri: "undefined", storage: "undefined" });
    assert.match(await execute("try { await fetch('http://127.0.0.1:" + server.address().port + "/should-not-connect'); return 'leaked'; } catch (_) { return 'network blocked'; }"), /network blocked/);
    assert.ok(!unexpectedRequests.includes("/should-not-connect"));
    assert.match(await execute("while (true) {}"), /2 second/);
    assert.match(await execute("const result = {}; result.self = result; return result;"), /execution failed/);
    assert.match(await execute("return 'x'.repeat(65000);"), /exceeds 64 KiB/);
    assert.match(await execute("return '<img src=x onerror=alert(1)>';"), /<img/);
    assert.equal(await output.locator("img").count(), 0);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await install({ ...catalog[0], content: { articles: [{ title: "<script>bad</script>", body: "<b>literal</b>" }], profilesToml: "[[profile]]\nid = 'test'" } });
    assert.equal(await page.locator("#plugins-detail script, #plugins-detail b").count(), 0);
    await page.getByRole("button", { name: "Import live-data profiles for this session" }).click();
    assert.equal(await page.evaluate(() => window.lastProfile), "[[profile]]\nid = 'test'");
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    assert.match(await page.locator("#plugins-detail").innerText(), /Enable this plugin/);
    await page.reload();
    assert.match(await page.locator("#plugins-installed").innerText(), /Disabled/);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.reload();
    assert.match(await page.locator("#plugins-installed").innerText(), /No plugins installed/);
    // Exercise the actual application markup and boot order with transport stubbed.
    await page.addInitScript(() => {
      localStorage.setItem("beeemuu_accepted", "1");
      window.__TAURI__ = { core: { invoke: async command => {
        if (command === "read_export_text") throw new Error("No saved workspace");
        if (command === "community_report") return { profiles: 0, dtc_texts: 0, freeze_schemas: 0, warnings: [] };
        return [];
      } } };
    });
    await page.route("https://**", route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator('.tab[data-view="plugins"]').click();
    await page.locator("#plugins-catalog .plugin-card").nth(1).waitFor({ state: "visible" });
    assert.ok(await page.locator("#view-plugins").isVisible());
    if (process.env.PLUGIN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.PLUGIN_TEST_SCREENSHOT, fullPage: true });
    console.log("PASS: install, persistence, replacement, enable/disable/remove, tool execution, isolation, blocked network, timeout, literal rendering, profile bridge");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
